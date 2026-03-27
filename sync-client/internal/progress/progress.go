package progress

import "sync"

type Item struct {
	Type        string
	Path        string
	Direction   string
	Transferred int64
	Total       int64
	Percent     float64
	Active      bool
}

type Store struct {
	mu    sync.RWMutex
	items map[string]Item
}

func NewStore() *Store {
	return &Store{items: make(map[string]Item)}
}

func key(typ, path string) string {
	return typ + ":" + path
}

func (s *Store) Start(typ, path, direction string, total int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items[key(typ, path)] = Item{
		Type:      typ,
		Path:      path,
		Direction: direction,
		Total:     total,
		Active:    true,
	}
}

func (s *Store) Update(typ, path string, transferred, total int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.items[key(typ, path)]
	if !ok {
		return
	}
	item.Active = true
	item.Transferred = transferred
	if total > 0 {
		item.Total = total
		item.Percent = float64(transferred) * 100 / float64(total)
		if item.Percent < 0 {
			item.Percent = 0
		}
		if item.Percent > 100 {
			item.Percent = 100
		}
	}
	s.items[key(typ, path)] = item
}

func (s *Store) Finish(typ, path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.items, key(typ, path))
}

func (s *Store) Get(typ, path string) (Item, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	item, ok := s.items[key(typ, path)]
	return item, ok
}
