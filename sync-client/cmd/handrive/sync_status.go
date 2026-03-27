//go:build windows

package main

import (
	"fmt"
	"html/template"
	"sort"

	webview2 "github.com/jchv/go-webview2"
	"hanplanet/handsync/internal/config"
	"hanplanet/handsync/internal/db"
)

type pendingSyncItem struct {
	Type        string  `json:"type"`
	Path        string  `json:"path"`
	Retry       int     `json:"retry"`
	Direction   string  `json:"direction"`
	Percent     float64 `json:"percent"`
	Transferred int64   `json:"transferred"`
	Total       int64   `json:"total"`
	Active      bool    `json:"active"`
}

type syncStatusData struct {
	Username  string            `json:"username"`
	SyncDir   string            `json:"sync_dir"`
	Count     int               `json:"count"`
	Items     []pendingSyncItem `json:"items"`
	IsClean   bool              `json:"is_clean"`
	ItemLimit int               `json:"item_limit"`
	Status    string            `json:"status"`
}

var syncStatusPopup popupWindow

func loadSyncStatusData(status string) (*syncStatusData, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}
	database, err := db.Open(config.DefaultConfigDir())
	if err != nil {
		return nil, err
	}
	defer database.Close()

	items, err := database.QueueSnapshot(200)
	if err != nil {
		return nil, err
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Retry != items[j].Retry {
			return items[i].Retry > items[j].Retry
		}
		if items[i].Type != items[j].Type {
			return items[i].Type < items[j].Type
		}
		return items[i].Path < items[j].Path
	})

	data := &syncStatusData{
		SyncDir:   ensureEffectiveSyncDir(cfg),
		Username:  resolveCurrentUsername(cfg),
		Count:     len(items),
		IsClean:   len(items) == 0,
		ItemLimit: 200,
		Status:    status,
	}
	if data.Status == "" {
		if data.IsClean {
			data.Status = "현재 대기 중인 동기화 작업이 없습니다."
		} else {
			data.Status = fmt.Sprintf("아직 동기화되지 않은 작업 %d개", data.Count)
		}
	}
	for _, item := range items {
		progressItem, ok := transferProgress.Get(item.Type, item.Path)
		data.Items = append(data.Items, pendingSyncItem{
			Type:        item.Type,
			Path:        item.Path,
			Retry:       item.Retry,
			Direction:   progressItem.Direction,
			Percent:     progressItem.Percent,
			Transferred: progressItem.Transferred,
			Total:       progressItem.Total,
			Active:      ok && progressItem.Active,
		})
	}
	return data, nil
}

func renderSyncStatusHTML() string {
	body := `
<aside class="handrive-job-queue-panel" id="handrive-job-queue-panel" aria-live="polite" data-drag-region>
  <header class="handrive-job-queue-head" data-drag-region>
    <div class="handrive-job-queue-head-main">
      <h3 class="handrive-job-queue-title" id="handrive-job-queue-title">동기화 상태</h3>
      <span class="handrive-job-queue-summary" id="handrive-job-queue-summary">로딩 중...</span>
    </div>
    <div class="handrive-job-queue-head-actions">
      <button class="handrive-job-queue-toggle" id="handrive-job-queue-toggle" type="button" aria-controls="handrive-job-queue-list" aria-expanded="true" aria-label="접기" title="접기" data-no-drag>
        <span class="handrive-job-queue-toggle-icon" aria-hidden="true"></span>
      </button>
    </div>
  </header>
  <ul class="handrive-job-queue-list" id="handrive-job-queue-list"></ul>
</aside>`
	script := `
const panel = document.getElementById('handrive-job-queue-panel');
const summaryEl = document.getElementById('handrive-job-queue-summary');
const listEl = document.getElementById('handrive-job-queue-list');
const toggleBtn = document.getElementById('handrive-job-queue-toggle');

function formatBytes(value) {
  const n = Number(value) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function applySize(payload) {
  if (!window.handriveSetPopupSize) return;
  const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
  if (!payload || payload.is_clean || !expanded) {
    requestAnimationFrame(() => window.handriveSetPopupSize(350, 58));
    return;
  }
  const visibleCount = Math.min((payload.items || []).length, 4);
  const popupHeight = Math.min(392, 88 + (visibleCount * 82));
  requestAnimationFrame(() => window.handriveSetPopupSize(350, popupHeight));
}

function renderSync(payload) {
  if (!payload) return;
  summaryEl.textContent = payload.status || "";
  listEl.innerHTML = "";
  if (payload.is_clean) {
    summaryEl.textContent = '현재 대기 중인 동기화 작업이 없습니다.';
    applySize(payload);
    return;
  }
  (payload.items || []).forEach(item => {
    const row = document.createElement('li');
    row.className = 'handrive-job-queue-item';
    row.dataset.status = 'queued';

    const head = document.createElement('div');
    head.className = 'handrive-job-queue-item-head';

    const name = document.createElement('span');
    name.className = 'handrive-job-queue-item-name';
    name.textContent = item.path.split(/[\\\\/]/).pop() || item.path;
    head.appendChild(name);
    row.appendChild(head);

    const sub = document.createElement('div');
    sub.className = 'handrive-job-queue-item-sub';

    const status = document.createElement('span');
    status.className = 'handrive-job-queue-item-status';
    if (item.active) {
      const directionLabel = item.direction === 'download' ? '다운로드 중' : '업로드 중';
      status.textContent = directionLabel + ' ' + Math.round(item.percent || 0) + '%';
    } else {
      status.textContent = '대기 중';
    }
    sub.appendChild(status);
    row.appendChild(sub);

    const meta = document.createElement('div');
    meta.className = 'handrive-job-queue-item-meta';
    if (item.active && item.total > 0) {
      meta.textContent = formatBytes(item.transferred) + ' / ' + formatBytes(item.total);
    } else {
      meta.textContent = item.path;
    }
    row.appendChild(meta);

    const progress = document.createElement('div');
    progress.className = 'handrive-job-queue-progress';
    const progressBar = document.createElement('span');
    progressBar.className = 'handrive-job-queue-progress-bar';
    if (item.active) {
      progressBar.style.width = Math.max(2, Math.min(100, item.percent || 0)) + '%';
    } else {
      progressBar.classList.add('is-queued');
    }
    progress.appendChild(progressBar);
    row.appendChild(progress);

    listEl.appendChild(row);
  });
  applySize(payload);
}

toggleBtn.addEventListener('click', () => {
  const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
  toggleBtn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
  panel.classList.toggle('is-collapsed', expanded);
  window.handriveInitSyncStatus().then(applySize);
});
setInterval(() => {
  if (window.handriveRefreshSyncStatus) {
    window.handriveRefreshSyncStatus().then(renderSync);
  }
}, 1000);
window.handriveApplySyncStatus = renderSync;
window.handriveInitSyncStatus().then(renderSync);
`
	return popupHTML(popupTemplateData{
		BodyHTML:          template.HTML(body),
		Script:            template.JS(script),
		HeaderHidden:      true,
		BareBody:          true,
		DisableAutoResize: true,
	})
}

func OpenSyncStatusPopup() {
	openWebPopup(&syncStatusPopup, "HanDrive 동기화 상태", 350, 86, true, func(w webview2.WebView, hwnd uintptr) error {
		_ = hwnd
		if err := w.Bind("handriveBeginDrag", func() error {
			nBeginWindowDrag(uintptr(w.Window()))
			return nil
		}); err != nil {
			return err
		}
		if err := w.Bind("handriveClose", func() error {
			closeWebPopup(&syncStatusPopup)
			return nil
		}); err != nil {
			return err
		}
		if err := w.Bind("handriveInitSyncStatus", func() (*syncStatusData, error) {
			return loadSyncStatusData("")
		}); err != nil {
			return err
		}
		if err := w.Bind("handriveRefreshSyncStatus", func() (*syncStatusData, error) {
			return loadSyncStatusData("최신 대기 작업을 반영했습니다.")
		}); err != nil {
			return err
		}
		w.SetHtml(renderSyncStatusHTML())
		return nil
	})
}
