// Package watcher는 fsnotify 기반 파일 시스템 변경 감지를 제공합니다.
// rename 감지: DELETE + CREATE가 500ms 내에 같은 hash로 발생하면 MOVE로 처리합니다.
package watcher

import (
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"hanplanet/handsync/internal/db"
	"hanplanet/handsync/internal/engine"
	"hanplanet/handsync/internal/queue"
)

const renameDebounceDuration = 500 * time.Millisecond

// pendingDelete는 짧은 시간 내 rename 감지를 위한 임시 삭제 정보입니다.
type pendingDelete struct {
	path string
	hash string
	at   time.Time
}

// Watcher는 파일 시스템 이벤트를 감지하고 큐에 추가합니다.
type Watcher struct {
	syncDir string
	db      *db.DB
	queue   *queue.Manager

	fsw *fsnotify.Watcher

	mu             sync.Mutex
	pendingDeletes []pendingDelete
}

// New는 새 Watcher를 생성합니다.
func New(syncDir string, database *db.DB, q *queue.Manager) (*Watcher, error) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	return &Watcher{
		syncDir: syncDir,
		db:      database,
		queue:   q,
		fsw:     fsw,
	}, nil
}

// Start는 syncDir을 재귀적으로 감시하기 시작합니다.
func (w *Watcher) Start() error {
	if err := w.addRecursive(w.syncDir); err != nil {
		return err
	}
	go w.loop()
	return nil
}

func (w *Watcher) addRecursive(dir string) error {
	return filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil || !d.IsDir() {
			return nil
		}
		return w.fsw.Add(path)
	})
}

func (w *Watcher) loop() {
	for {
		select {
		case event, ok := <-w.fsw.Events:
			if !ok {
				return
			}
			w.handleEvent(event)
		case err, ok := <-w.fsw.Errors:
			if !ok {
				return
			}
			log.Printf("[watcher] error: %v", err)
		}
	}
}

func (w *Watcher) handleEvent(event fsnotify.Event) {
	absPath := event.Name
	relPath := engine.RelPath(w.syncDir, absPath)

	switch {
	case event.Has(fsnotify.Create):
		// 새 디렉토리면 감시 대상 추가
		if fi, err := os.Stat(absPath); err == nil && fi.IsDir() {
			_ = w.fsw.Add(absPath)
			return
		}
		// rename 감지: 최근 삭제된 파일과 hash 비교
		if move := w.matchPendingDelete(absPath); move != nil {
			w.queue.Enqueue(db.QueueItem{
				Type:    queue.TypeMove,
				Path:    relPath,
				OldPath: move.path, // 이미 상대경로
			})
			return
		}
		w.queue.Enqueue(db.QueueItem{Type: queue.TypeUpload, Path: relPath})

	case event.Has(fsnotify.Write):
		w.queue.Enqueue(db.QueueItem{Type: queue.TypeUpload, Path: relPath})

	case event.Has(fsnotify.Remove), event.Has(fsnotify.Rename):
		// hash를 기억해 두고 일정 시간 내 CREATE가 오면 MOVE로 판단
		hash := w.lastKnownHash(relPath)
		w.mu.Lock()
		w.pendingDeletes = append(w.pendingDeletes, pendingDelete{
			path: relPath, // 상대경로로 저장
			hash: hash,
			at:   time.Now(),
		})
		w.mu.Unlock()

		// debounce 후에도 CREATE가 안 오면 DELETE 처리
		time.AfterFunc(renameDebounceDuration+10*time.Millisecond, func() {
			if w.consumePendingDelete(relPath) {
				w.queue.Enqueue(db.QueueItem{Type: queue.TypeDelete, Path: relPath})
			}
		})
	}
}

// lastKnownHash는 로컬 DB에서 마지막으로 알려진 파일 hash를 반환합니다.
// relPath는 syncDir 기준 상대경로입니다.
func (w *Watcher) lastKnownHash(relPath string) string {
	rec, err := w.db.GetFile(relPath)
	if err != nil || rec == nil {
		return ""
	}
	return rec.Hash
}

// matchPendingDelete는 CREATE된 파일의 hash와 최근 삭제 파일의 hash를 비교해
// 500ms 이내 rename 이면 해당 pendingDelete를 반환합니다.
func (w *Watcher) matchPendingDelete(newPath string) *pendingDelete {
	newHash, err := engine.HashFile(newPath)
	if err != nil || newHash == "" {
		return nil
	}

	w.mu.Lock()
	defer w.mu.Unlock()

	cutoff := time.Now().Add(-renameDebounceDuration)
	for i, pd := range w.pendingDeletes {
		if pd.at.After(cutoff) && pd.hash == newHash {
			// 매칭 성공 → pendingDeletes에서 제거
			w.pendingDeletes = append(w.pendingDeletes[:i], w.pendingDeletes[i+1:]...)
			return &pd
		}
	}
	return nil
}

// consumePendingDelete는 path의 pendingDelete를 소비합니다.
// 아직 남아 있으면 true (= DELETE 처리 필요), 이미 MOVE로 처리됐으면 false.
func (w *Watcher) consumePendingDelete(path string) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	for i, pd := range w.pendingDeletes {
		if pd.path == path {
			w.pendingDeletes = append(w.pendingDeletes[:i], w.pendingDeletes[i+1:]...)
			return true
		}
	}
	return false
}

// Close는 watcher를 종료합니다.
func (w *Watcher) Close() error { return w.fsw.Close() }
