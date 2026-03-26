package engine

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"hanplanet/handsync/internal/api"
	"hanplanet/handsync/internal/db"
	"hanplanet/handsync/internal/queue"
)

const (
	maxParallelUploads = 5
	maxRetry           = 3
)

// Engine은 sync 결정 및 실행 로직입니다.
type Engine struct {
	syncDir string
	db      *db.DB
	api     *api.Client
	queue   *queue.Manager
}

// New는 새 Engine을 반환합니다.
func New(syncDir string, database *db.DB, apiClient *api.Client, q *queue.Manager) *Engine {
	return &Engine{
		syncDir: syncDir,
		db:      database,
		api:     apiClient,
		queue:   q,
	}
}

// InitialSync는 첫 실행 시 서버 ↔ 로컬 diff를 계산하고 큐를 생성합니다.
// 반드시 Watcher 시작 전에 호출해야 합니다.
func (e *Engine) InitialSync() error {
	log.Println("[engine] initial sync: fetching server file list...")
	serverFiles, err := e.api.ListFiles()
	if err != nil {
		return fmt.Errorf("list server files: %w", err)
	}

	// 서버 파일 맵 (path → ServerFile)
	serverMap := make(map[string]api.ServerFile, len(serverFiles))
	for _, f := range serverFiles {
		if !f.Deleted {
			serverMap[f.Path] = f
		}
	}

	// 로컬 파일 스캔
	log.Println("[engine] initial sync: scanning local directory...")
	localMap := make(map[string]string) // path → hash
	err = filepath.WalkDir(e.syncDir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		rel := RelPath(e.syncDir, path)
		hash, err := HashFile(path)
		if err != nil {
			log.Printf("[engine] hash error %s: %v", rel, err)
			return nil
		}
		localMap[rel] = hash
		return nil
	})
	if err != nil {
		return fmt.Errorf("scan local dir: %w", err)
	}

	// diff 계산
	for path, hash := range localMap {
		srv, onServer := serverMap[path]
		if !onServer {
			// 로컬 only → UPLOAD
			_ = e.queue.EnqueueImmediate(db.QueueItem{Type: queue.TypeUpload, Path: path})
		} else if hash != srv.Hash {
			// 양쪽 존재 + hash 다름 → version 비교
			localRec, _ := e.db.GetFile(path)
			if localRec != nil && localRec.Version >= srv.Version {
				// 로컬이 최신 → UPLOAD
				_ = e.queue.EnqueueImmediate(db.QueueItem{Type: queue.TypeUpload, Path: path})
			} else {
				// 서버가 최신 → DOWNLOAD
				_ = e.queue.EnqueueImmediate(db.QueueItem{Type: queue.TypeDownload, Path: path})
			}
		}
		// hash 동일하면 skip
	}

	for path := range serverMap {
		if _, exists := localMap[path]; !exists {
			// 서버 only → DOWNLOAD
			_ = e.queue.EnqueueImmediate(db.QueueItem{Type: queue.TypeDownload, Path: path})
		}
	}

	// sync cursor 초기화 (첫 실행)
	cursor, _ := e.db.GetMeta("sync_cursor")
	if cursor == "" {
		_ = e.db.SetMeta("sync_cursor", "0")
	}

	log.Printf("[engine] initial sync: queued %d local uploads + downloads", len(localMap))
	return nil
}

// ProcessQueue는 큐 아이템을 병렬로 처리합니다 (최대 maxParallelUploads goroutine).
func (e *Engine) ProcessQueue() {
	items, err := e.db.PeekQueue(50)
	if err != nil || len(items) == 0 {
		return
	}

	sem := make(chan struct{}, maxParallelUploads)
	var wg sync.WaitGroup

	for _, item := range items {
		item := item
		sem <- struct{}{}
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			e.processItem(item)
		}()
	}
	wg.Wait()
}

func (e *Engine) processItem(item db.QueueItem) {
	var err error
	switch item.Type {
	case queue.TypeUpload:
		err = e.doUpload(item.Path)
	case queue.TypeDownload:
		err = e.doDownload(item.Path)
	case queue.TypeDelete:
		err = e.doDelete(item.Path)
	case queue.TypeMove:
		err = e.doMove(item.OldPath, item.Path)
	default:
		log.Printf("[engine] unknown queue type: %s", item.Type)
		_ = e.db.DequeueItem(item.ID)
		return
	}

	if err == nil {
		_ = e.db.DequeueItem(item.ID)
		return
	}

	log.Printf("[engine] item %d (%s %s) failed (retry=%d): %v", item.ID, item.Type, item.Path, item.Retry, err)
	if item.Retry >= maxRetry {
		log.Printf("[engine] item %d exceeded max retries, dropping", item.ID)
		_ = e.db.DequeueItem(item.ID)
		return
	}
	_ = e.db.IncrementRetry(item.ID)
	time.Sleep(queue.RetryDelay(item.Retry + 1))
}

// doUpload는 로컬 파일을 서버에 업로드합니다.
func (e *Engine) doUpload(relPath string) error {
	absPath := AbsPath(e.syncDir, relPath)

	fi, err := os.Stat(absPath)
	if err != nil {
		return fmt.Errorf("stat %s: %w", absPath, err)
	}
	hash, err := HashFile(absPath)
	if err != nil {
		return err
	}

	// 로컬 DB에서 현재 version 조회
	localRec, _ := e.db.GetFile(relPath)
	var expectedVersion int64
	if localRec != nil {
		expectedVersion = localRec.Version
	}

	// init-upload
	initResp, err := e.api.InitUpload(api.InitUploadRequest{
		Path:             relPath,
		Size:             fi.Size(),
		Hash:             hash,
		ClientModifiedAt: fi.ModTime().UnixMilli(),
	})
	if err != nil {
		return fmt.Errorf("init-upload: %w", err)
	}

	if !initResp.SkipUpload {
		// presigned URL에 파일 직접 업로드
		data, err := os.ReadFile(absPath)
		if err != nil {
			return fmt.Errorf("read file: %w", err)
		}
		if err := e.api.UploadToPresignedURL(initResp.UploadURL, data); err != nil {
			return fmt.Errorf("presigned upload: %w", err)
		}
	}

	// complete
	serverFile, err := e.api.CompleteUpload(api.CompleteUploadRequest{
		UploadID:        initResp.UploadID,
		ExpectedVersion: expectedVersion,
	})
	if err != nil {
		return fmt.Errorf("complete-upload: %w", err)
	}

	// 로컬 DB 갱신
	return e.db.UpsertFile(db.FileRecord{
		Path:     relPath,
		Hash:     hash,
		Size:     fi.Size(),
		Version:  serverFile.Version,
		FileID:   serverFile.ID,
		SyncedAt: time.Now().UnixMilli(),
	})
}

// doDownload는 서버 파일을 로컬에 다운로드합니다.
func (e *Engine) doDownload(relPath string) error {
	// 서버 파일 목록에서 file_id 조회
	files, err := e.api.ListFiles()
	if err != nil {
		return err
	}
	var target *api.ServerFile
	for i := range files {
		if files[i].Path == relPath && !files[i].Deleted {
			target = &files[i]
			break
		}
	}
	if target == nil {
		return fmt.Errorf("file not found on server: %s", relPath)
	}

	// presigned 다운로드 URL
	downloadURL, err := e.api.DownloadURL(target.ID)
	if err != nil {
		return err
	}
	data, err := e.api.DownloadFile(downloadURL)
	if err != nil {
		return err
	}

	absPath := AbsPath(e.syncDir, relPath)
	if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
		return err
	}
	if err := os.WriteFile(absPath, data, 0644); err != nil {
		return err
	}

	hash, _ := HashFile(absPath)
	return e.db.UpsertFile(db.FileRecord{
		Path:     relPath,
		Hash:     hash,
		Size:     int64(len(data)),
		Version:  target.Version,
		FileID:   target.ID,
		SyncedAt: time.Now().UnixMilli(),
	})
}

// doDelete는 서버 파일을 soft delete합니다.
func (e *Engine) doDelete(relPath string) error {
	localRec, err := e.db.GetFile(relPath)
	if err != nil || localRec == nil {
		return nil // 이미 없으면 skip
	}
	if err := e.api.DeleteFile(localRec.FileID); err != nil {
		if strings.Contains(err.Error(), "HTTP 404") {
			// 서버에 없으면 무시
		} else {
			return err
		}
	}
	return e.db.DeleteFile(relPath)
}

// doMove는 서버 파일 경로를 변경합니다.
func (e *Engine) doMove(oldRelPath, newRelPath string) error {
	localRec, err := e.db.GetFile(oldRelPath)
	if err != nil || localRec == nil {
		// 로컬 DB에 없으면 새 파일로 UPLOAD
		return e.doUpload(newRelPath)
	}

	serverFile, err := e.api.MoveFile(localRec.FileID, newRelPath, localRec.Version)
	if err != nil {
		if strings.Contains(err.Error(), "HTTP 409") {
			// path_conflict: conflict rename 후 재시도
			conflictPath := conflictName(newRelPath)
			log.Printf("[engine] move conflict, renaming to %s", conflictPath)
			if renameErr := os.Rename(AbsPath(e.syncDir, newRelPath), AbsPath(e.syncDir, conflictPath)); renameErr == nil {
				_ = e.queue.EnqueueImmediate(db.QueueItem{Type: queue.TypeUpload, Path: conflictPath})
			}
			return nil
		}
		return err
	}

	_ = e.db.DeleteFile(oldRelPath)
	return e.db.UpsertFile(db.FileRecord{
		Path:     newRelPath,
		Hash:     localRec.Hash,
		Size:     localRec.Size,
		Version:  serverFile.Version,
		FileID:   serverFile.ID,
		SyncedAt: time.Now().UnixMilli(),
	})
}

// PollChanges는 서버 변경 이력을 polling하고 다운로드 큐에 추가합니다.
func (e *Engine) PollChanges() error {
	cursorStr, _ := e.db.GetMeta("sync_cursor")
	var cursor int64
	if cursorStr != "" {
		cursor, _ = strconv.ParseInt(cursorStr, 10, 64)
	}

	changes, nextCursor, err := e.api.GetChanges(cursor)
	if err != nil {
		return fmt.Errorf("get changes: %w", err)
	}

	for _, c := range changes {
		switch c.Type {
		case "CREATE", "UPDATE":
			localRec, _ := e.db.GetFile(c.Path)
			if localRec == nil || localRec.Version < c.Version {
				_ = e.queue.EnqueueImmediate(db.QueueItem{Type: queue.TypeDownload, Path: c.Path})
			}
		case "DELETE":
			absPath := AbsPath(e.syncDir, c.Path)
			_ = os.Remove(absPath)
			_ = e.db.DeleteFile(c.Path)
		case "MOVE":
			localRec, _ := e.db.GetFile(c.OldPath)
			if localRec != nil {
				oldAbs := AbsPath(e.syncDir, c.OldPath)
				newAbs := AbsPath(e.syncDir, c.Path)
				_ = os.MkdirAll(filepath.Dir(newAbs), 0755)
				_ = os.Rename(oldAbs, newAbs)
				_ = e.db.DeleteFile(c.OldPath)
				_ = e.db.UpsertFile(db.FileRecord{
					Path:     c.Path,
					Hash:     localRec.Hash,
					Size:     localRec.Size,
					Version:  c.Version,
					FileID:   localRec.FileID,
					SyncedAt: time.Now().UnixMilli(),
				})
			}
		}
	}

	if nextCursor != cursor {
		_ = e.db.SetMeta("sync_cursor", strconv.FormatInt(nextCursor, 10))
	}
	return nil
}

// conflictName은 충돌 파일명을 생성합니다: "file.txt" → "file (conflict).txt"
func conflictName(path string) string {
	ext := filepath.Ext(path)
	base := strings.TrimSuffix(path, ext)
	return base + " (conflict)" + ext
}
