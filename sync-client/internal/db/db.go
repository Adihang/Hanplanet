// Package db는 로컬 SQLite 데이터베이스를 관리합니다.
package db

import (
	"database/sql"
	_ "embed"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schema string

// DB는 로컬 sync 상태를 저장하는 SQLite 래퍼입니다.
type DB struct {
	sql *sql.DB
}

// Open은 SQLite DB를 열고 스키마를 초기화합니다.
func Open(dir string) (*DB, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("create db dir: %w", err)
	}
	path := filepath.Join(dir, "handsync.db")
	conn, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	if _, err := conn.Exec(schema); err != nil {
		return nil, fmt.Errorf("init schema: %w", err)
	}
	return &DB{sql: conn}, nil
}

func (d *DB) Close() error { return d.sql.Close() }

// ── files 테이블 ────────────────────────────────────────────────────────────

// FileRecord는 로컬 파일 동기화 상태입니다.
type FileRecord struct {
	Path     string
	Hash     string
	Size     int64
	Version  int64
	FileID   string
	SyncedAt int64
}

// UpsertFile은 파일 레코드를 삽입하거나 갱신합니다.
func (d *DB) UpsertFile(r FileRecord) error {
	_, err := d.sql.Exec(
		`INSERT INTO files (path, hash, size, version, file_id, synced_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(path) DO UPDATE SET
		   hash=excluded.hash, size=excluded.size, version=excluded.version,
		   file_id=excluded.file_id, synced_at=excluded.synced_at`,
		r.Path, r.Hash, r.Size, r.Version, r.FileID, r.SyncedAt,
	)
	return err
}

// GetFile은 경로로 파일 레코드를 조회합니다.
func (d *DB) GetFile(path string) (*FileRecord, error) {
	row := d.sql.QueryRow(
		`SELECT path, hash, size, version, file_id, synced_at FROM files WHERE path = ?`, path,
	)
	var r FileRecord
	err := row.Scan(&r.Path, &r.Hash, &r.Size, &r.Version, &r.FileID, &r.SyncedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &r, err
}

// AllFiles는 전체 파일 레코드를 반환합니다.
func (d *DB) AllFiles() ([]FileRecord, error) {
	rows, err := d.sql.Query(`SELECT path, hash, size, version, file_id, synced_at FROM files`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []FileRecord
	for rows.Next() {
		var r FileRecord
		if err := rows.Scan(&r.Path, &r.Hash, &r.Size, &r.Version, &r.FileID, &r.SyncedAt); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// DeleteFile은 파일 레코드를 삭제합니다.
func (d *DB) DeleteFile(path string) error {
	_, err := d.sql.Exec(`DELETE FROM files WHERE path = ?`, path)
	return err
}

// ── queue 테이블 ────────────────────────────────────────────────────────────

// QueueItem은 처리 대기 중인 sync 작업입니다.
type QueueItem struct {
	ID      int64
	Type    string // UPLOAD / DOWNLOAD / DELETE / MOVE
	Path    string
	OldPath string // MOVE 시 이전 경로
	Retry   int
}

// EnqueueItem은 작업을 큐에 추가합니다.
func (d *DB) EnqueueItem(item QueueItem) error {
	_, err := d.sql.Exec(
		`INSERT INTO queue (type, path, old_path, retry) VALUES (?, ?, ?, ?)`,
		item.Type, item.Path, item.OldPath, 0,
	)
	return err
}

// PeekQueue는 처리되지 않은 큐 아이템을 최대 n개 반환합니다.
func (d *DB) PeekQueue(n int) ([]QueueItem, error) {
	rows, err := d.sql.Query(
		`SELECT id, type, path, old_path, retry FROM queue ORDER BY id LIMIT ?`, n,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []QueueItem
	for rows.Next() {
		var it QueueItem
		var oldPath sql.NullString
		if err := rows.Scan(&it.ID, &it.Type, &it.Path, &oldPath, &it.Retry); err != nil {
			return nil, err
		}
		it.OldPath = oldPath.String
		items = append(items, it)
	}
	return items, rows.Err()
}

// QueueSnapshot은 현재 큐 전체를 반환합니다.
func (d *DB) QueueSnapshot(limit int) ([]QueueItem, error) {
	if limit <= 0 {
		limit = 200
	}
	return d.PeekQueue(limit)
}

// DequeueItem은 처리 완료된 아이템을 큐에서 제거합니다.
func (d *DB) DequeueItem(id int64) error {
	_, err := d.sql.Exec(`DELETE FROM queue WHERE id = ?`, id)
	return err
}

// IncrementRetry는 재시도 횟수를 증가시킵니다.
func (d *DB) IncrementRetry(id int64) error {
	_, err := d.sql.Exec(`UPDATE queue SET retry = retry + 1 WHERE id = ?`, id)
	return err
}

// ── meta 테이블 (sync cursor) ───────────────────────────────────────────────

// GetMeta는 meta 값을 반환합니다.
func (d *DB) GetMeta(key string) (string, error) {
	var val string
	err := d.sql.QueryRow(`SELECT value FROM meta WHERE key = ?`, key).Scan(&val)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return val, err
}

// SetMeta는 meta 값을 저장합니다.
func (d *DB) SetMeta(key, value string) error {
	_, err := d.sql.Exec(
		`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
		key, value,
	)
	return err
}

// ResetForModeSwitch는 storage mode 전환 시 로컬 상태를 초기화합니다.
// files 테이블, queue 테이블, sync_cursor 를 모두 리셋하고 새 mode 를 저장합니다.
// InitialSync 가 새 syncDir 기준으로 처음부터 diff 를 계산합니다.
func (d *DB) ResetForModeSwitch(newMode string) error {
	tx, err := d.sql.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM files`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM queue`); err != nil {
		return err
	}
	if _, err := tx.Exec(
		`INSERT INTO meta (key, value) VALUES ('sync_cursor', '0')
		 ON CONFLICT(key) DO UPDATE SET value='0'`,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(
		`INSERT INTO meta (key, value) VALUES ('storage_mode', ?)
		 ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
		newMode,
	); err != nil {
		return err
	}
	return tx.Commit()
}
