// Package queue는 sync 작업 큐를 관리합니다.
// debounce(500ms), retry backoff(1s→2s→4s, 최대 3회)를 제공합니다.
package queue

import (
	"log"
	"sync"
	"time"

	"hanplanet/handsync/internal/db"
)

const (
	MaxRetry = 3

	TypeUpload   = "UPLOAD"
	TypeDownload = "DOWNLOAD"
	TypeDelete   = "DELETE"
	TypeMove     = "MOVE"
)

// Manager는 debounce + retry 큐를 관리합니다.
type Manager struct {
	db      *db.DB
	mu      sync.Mutex
	pending map[string]*time.Timer // path → debounce timer
}

// New는 새 큐 매니저를 반환합니다.
func New(database *db.DB) *Manager {
	return &Manager{
		db:      database,
		pending: make(map[string]*time.Timer),
	}
}

// Enqueue는 작업을 500ms debounce 후 DB 큐에 추가합니다.
// 같은 path에 대해 debounce 시간 내 중복 요청은 타이머를 리셋합니다.
func (m *Manager) Enqueue(item db.QueueItem) {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := item.Type + ":" + item.Path
	log.Printf("[queue] debounce enqueue type=%s path=%s old_path=%s", item.Type, item.Path, item.OldPath)
	if t, ok := m.pending[key]; ok {
		t.Stop()
	}

	m.pending[key] = time.AfterFunc(500*time.Millisecond, func() {
		m.mu.Lock()
		delete(m.pending, key)
		m.mu.Unlock()

		log.Printf("[queue] enqueue now type=%s path=%s old_path=%s", item.Type, item.Path, item.OldPath)
		if err := m.db.EnqueueItem(item); err != nil {
			log.Printf("[queue] enqueue error: %v", err)
		}
	})
}

// EnqueueImmediate는 debounce 없이 즉시 큐에 추가합니다 (초기 sync, DOWNLOAD 등).
func (m *Manager) EnqueueImmediate(item db.QueueItem) error {
	log.Printf("[queue] enqueue immediate type=%s path=%s old_path=%s", item.Type, item.Path, item.OldPath)
	return m.db.EnqueueItem(item)
}

// retryDelay는 retry 횟수에 따른 백오프 대기 시간을 반환합니다.
// 1s → 2s → 4s
func RetryDelay(retry int) time.Duration {
	if retry <= 0 {
		return time.Second
	}
	if retry >= 3 {
		return 4 * time.Second
	}
	return time.Duration(1<<uint(retry)) * time.Second
}
