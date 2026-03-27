package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"strings"
)

type quotaItem struct {
	Label   string  `json:"label"`
	Display string  `json:"display"`
	Percent float64 `json:"percent"`
	Color   string  `json:"color"`
}

type previewData struct {
	Storage  any
	Sync     any
	Settings any
}

func main() {
	addr := flag.String("addr", "127.0.0.1:38641", "preview listen address")
	flag.Parse()

	data := previewData{
		Storage: map[string]any{
			"used_display":  "11.4 MB",
			"total_display": "10 GB",
			"free_display":  "10 GB",
			"free_percent":  99.89,
			"breakdown": []quotaItem{
				{Label: "사진", Display: "229.8 KB", Percent: 0.01, Color: "#facc15"},
				{Label: "문서", Display: "100.9 KB", Percent: 0.01, Color: "#f43f5e"},
				{Label: "동영상", Display: "11 MB", Percent: 0.11, Color: "#34d399"},
				{Label: "기타", Display: "6 KB", Percent: 0.00, Color: "#111827"},
			},
		},
		Sync: map[string]any{
			"status":   "현재 대기 중인 동기화 작업이 없습니다.",
			"is_clean": true,
			"sync_dir": `C:\Users\limha\Hanplanet`,
			"items": []map[string]any{
				{"type": "upload", "path": `docs\design\landing-spec.pdf`, "retry": 0},
				{"type": "delete", "path": `images\old-banner.png`, "retry": 1},
			},
		},
		Settings: map[string]any{
			"server_url": "https://www.hanplanet.com",
			"sync_dir":   `C:\Users\limha\Hanplanet`,
			"username":   "limha",
			"status":     "로그인 완료. 트레이 정보를 갱신했습니다.",
		},
	}

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		payload, _ := json.Marshal(data)
		_, _ = fmt.Fprint(w, strings.Replace(pageHTML, "__PREVIEW_JSON__", string(payload), 1))
	})

	log.Printf("[popup-preview] http://%s", *addr)
	log.Fatal(http.ListenAndServe(*addr, nil))
}

const pageHTML = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HanDrive Popup Preview</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #222222;
  --panel: rgba(46,46,46,0.97);
  --panel-soft: rgba(40,40,40,0.94);
  --panel-strong: #2c2c2c;
  --border: rgba(255,255,255,0.08);
  --text: #f2f2f2;
  --text-soft: #d6d6d6;
  --accent: #d8e5fb;
  --shadow: 0 18px 48px rgba(0,0,0,0.38);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 28px;
  background:
    radial-gradient(circle at top left, rgba(123,177,255,0.15), transparent 30%),
    #222222;
  color: var(--text);
  font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.preview-note {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-soft);
}
.toolbar button {
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
}
.toolbar .active {
  background: #28446f;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 22px;
}
.preview {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.preview h2 {
  margin: 0;
  font-size: 15px;
}
.host {
  display: inline-flex;
  align-items: flex-start;
  justify-content: flex-start;
  padding: 18px;
  border-radius: 18px;
  background: #000;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04);
  width: fit-content;
}
.host.tight { padding: 0; background: transparent; box-shadow: none; }
.host[data-kind="storage"] { width: 304px; height: 154px; }
.host[data-kind="sync"] { width: 350px; height: 122px; }
.host[data-kind="settings"] { width: 560px; height: 560px; }
.account-storage-popup {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  background: rgba(46, 46, 46, 0.97);
  border-radius: 12px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.22);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.account-storage-popup-header {
  font-size: 14px;
  line-height: 1.3;
  color: var(--text);
  display: flex;
  align-items: baseline;
  gap: 3px;
  flex-wrap: wrap;
}
.account-storage-popup-title { font-weight: 600; margin-right: 4px; }
.account-storage-popup-used { font-weight: 700; color: var(--accent); font-size: 15px; }
.account-storage-popup-bar {
  display: flex;
  width: 100%;
  height: 20px;
  border-radius: 6px;
  overflow: hidden;
  background: color-mix(in srgb, var(--border) 72%, transparent);
}
.account-storage-popup-bar-seg { height: 100%; flex-shrink: 0; }
.account-storage-popup-bar-free { background: color-mix(in srgb, var(--border) 72%, transparent); flex: 1 0 0; }
.account-storage-popup-legend {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 12px;
}
.account-storage-popup-legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.account-storage-popup-legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}
.account-storage-popup-legend-dot-free { background: color-mix(in srgb, var(--border) 72%, transparent); }
.account-storage-popup-legend-text {
  font-size: 12px;
  line-height: 1.3;
  color: var(--text);
  white-space: nowrap;
}
.account-storage-popup-download-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 28px;
  height: 28px;
  color: var(--text-soft);
  background: transparent;
  border: none;
}
.handrive-job-queue-panel {
  width: 100%;
  height: 100%;
  max-height: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--panel);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.handrive-job-queue-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.handrive-job-queue-head-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.handrive-job-queue-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}
.handrive-job-queue-summary {
  font-size: 12px;
  color: var(--text-soft);
  line-height: 1.45;
  white-space: normal;
}
.handrive-job-queue-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.handrive-job-queue-toggle,
.handrive-job-queue-close {
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-soft);
}
.handrive-job-queue-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
}
.handrive-job-queue-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel-soft);
  cursor: pointer;
}
.handrive-job-queue-item:hover {
  background: color-mix(in srgb, #4f8fe8 16%, var(--panel-soft));
  border-color: color-mix(in srgb, #4f8fe8 28%, var(--border));
}
.handrive-job-queue-item-head,
.handrive-job-queue-item-sub {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.handrive-job-queue-item-name {
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.handrive-job-queue-item-size,
.handrive-job-queue-item-speed,
.handrive-job-queue-item-status,
.handrive-job-queue-item-meta {
  font-size: 11px;
  color: var(--text-soft);
}
.handrive-job-queue-progress {
  width: 100%;
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--border) 72%, transparent);
  overflow: hidden;
}
.handrive-job-queue-progress-bar {
  display: block;
  height: 100%;
  background: #22c55e;
}
@keyframes handriveQueuePulse {
  0% { width: 22%; transform: translateX(0); }
  100% { width: 62%; transform: translateX(38%); }
}
.handrive-job-queue-progress-bar.is-queued {
  width: 42%;
  animation: handriveQueuePulse 1.25s ease-in-out infinite alternate;
}
.handrive-job-queue-progress-bar.is-failed {
  width: 28%;
  background: #ef4444;
}
.settings-sheet {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.settings-card {
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--panel-strong);
}
.settings-card-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 14px;
}
.settings-card-title { font-size: 15px; font-weight: 700; }
.settings-card-subtitle {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-soft);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field + .field { margin-top: 12px; }
.field label {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-soft);
}
.field input {
  width: 100%;
  min-height: 42px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel-soft);
  color: var(--text);
  padding: 12px 14px;
}
.status-card,
.settings-status {
  border-radius: 14px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  white-space: pre-wrap;
}
.status-card { background: var(--panel-soft); }
.settings-status { background: var(--panel-soft); color: var(--text-soft); margin-top: 12px; }
.settings-actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}
.btn {
  flex: 1;
  min-height: 42px;
  border: 0;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
}
.btn-primary { background: var(--panel-soft); color: var(--text); border: 1px solid var(--border); }
.btn-secondary { background: var(--panel-soft); color: var(--text); border: 1px solid var(--border); }
.btn-muted { background: transparent; color: var(--text-soft); border: 1px solid var(--border); }
</style>
</head>
<body>
<div class="toolbar">
  <button id="tight-btn" class="active" type="button">타이트 호스트</button>
  <button id="oversized-btn" type="button">검은 배경 재현</button>
</div>
<div class="grid">
  <section class="preview">
    <h2>총 사용 용량</h2>
    <div class="host tight" data-kind="storage" id="storage-host">
      <div class="account-storage-popup">
        <button class="account-storage-popup-download-btn" id="storage-download-btn" type="button" aria-label="다운로드">↓</button>
        <div class="account-storage-popup-header">
          <span class="account-storage-popup-title">총 사용 용량</span>
          <span class="account-storage-popup-used" id="storage-used"></span>
          <span> / </span>
          <span id="storage-total"></span>
        </div>
        <div class="account-storage-popup-bar" id="storage-bar"></div>
        <div class="account-storage-popup-legend" id="storage-legend"></div>
      </div>
    </div>
  </section>
  <section class="preview">
    <h2>동기화 상태</h2>
    <div class="host tight" data-kind="sync" id="sync-host">
      <aside class="handrive-job-queue-panel">
        <header class="handrive-job-queue-head">
          <div class="handrive-job-queue-head-main">
            <h3 class="handrive-job-queue-title">동기화 상태</h3>
            <span class="handrive-job-queue-summary" id="sync-summary"></span>
          </div>
          <div class="handrive-job-queue-head-actions">
            <button class="handrive-job-queue-toggle" id="sync-toggle-btn" type="button">-</button>
          </div>
        </header>
        <ul class="handrive-job-queue-list" id="sync-list"></ul>
      </aside>
    </div>
  </section>
  <section class="preview">
    <h2>설정</h2>
    <div class="host tight" data-kind="settings" id="settings-host">
      <div class="settings-sheet">
        <div class="settings-card">
          <div class="settings-card-header">
            <div class="settings-card-title">연결 정보</div>
            <div class="settings-card-subtitle">서버 URL과 동기화 루트를 먼저 저장한 뒤 브라우저 로그인을 시작할 수 있습니다.</div>
          </div>
          <div class="field">
            <label>서버 URL</label>
            <input id="settings-server">
          </div>
          <div class="field">
            <label>동기화 루트</label>
            <input id="settings-dir">
          </div>
          <div class="settings-card-header" style="margin-top:18px">
            <div class="settings-card-title">계정 상태</div>
            <div class="settings-card-subtitle">현재 연결된 계정과 즉시 반영되는 로그인 상태를 보여줍니다.</div>
          </div>
          <div class="status-card" id="settings-account"></div>
          <div class="settings-status" id="settings-status"></div>
          <div class="settings-actions">
            <button class="btn btn-primary" id="settings-save-btn">저장</button>
            <button class="btn btn-secondary" id="settings-login-btn">다시 로그인</button>
          </div>
        </div>
      </div>
    </div>
  </section>
</div>
<div class="toolbar" style="margin-top:16px">
  <span class="preview-note" id="preview-note">미리보기 버튼 동작 대기 중</span>
</div>
<script>
const preview = __PREVIEW_JSON__;
let syncCollapsed = false;
let syncHidden = false;
let settingsHidden = false;
let storageHidden = false;

function setPreviewNote(message) {
  document.getElementById('preview-note').textContent = message;
}

function applyStorage() {
  const host = document.getElementById('storage-host');
  host.style.visibility = storageHidden ? 'hidden' : 'visible';
  document.getElementById('storage-used').textContent = preview.Storage.used_display;
  document.getElementById('storage-total').textContent = preview.Storage.total_display;
  const bar = document.getElementById('storage-bar');
  const legend = document.getElementById('storage-legend');
  bar.innerHTML = '';
  legend.innerHTML = '';
  (preview.Storage.breakdown || []).forEach(item => {
    const seg = document.createElement('div');
    seg.className = 'account-storage-popup-bar-seg';
    seg.style.width = Math.max(item.percent || 0, 0) + '%';
    seg.style.background = item.color;
    bar.appendChild(seg);
    const row = document.createElement('div');
    row.className = 'account-storage-popup-legend-item';
    row.innerHTML = '<span class="account-storage-popup-legend-dot"></span><span class="account-storage-popup-legend-text"></span>';
    row.querySelector('.account-storage-popup-legend-dot').style.background = item.color;
    row.querySelector('.account-storage-popup-legend-text').textContent = item.label + ' (' + item.display + ')';
    legend.appendChild(row);
  });
  const freeSeg = document.createElement('div');
  freeSeg.className = 'account-storage-popup-bar-seg account-storage-popup-bar-free';
  freeSeg.style.width = Math.max(preview.Storage.free_percent || 0, 0) + '%';
  bar.appendChild(freeSeg);
  const freeRow = document.createElement('div');
  freeRow.className = 'account-storage-popup-legend-item';
  freeRow.innerHTML = '<span class="account-storage-popup-legend-dot account-storage-popup-legend-dot-free"></span><span class="account-storage-popup-legend-text"></span>';
  freeRow.querySelector('.account-storage-popup-legend-text').textContent = '여유 공간 (' + preview.Storage.free_display + ')';
  legend.appendChild(freeRow);
}

function applySync() {
  const host = document.getElementById('sync-host');
  const list = document.getElementById('sync-list');
  const panel = host.querySelector('.handrive-job-queue-panel');
  host.style.visibility = syncHidden ? 'hidden' : 'visible';
  document.getElementById('sync-summary').textContent = preview.Sync.status;
  list.innerHTML = '';
  panel.classList.toggle('is-collapsed', syncCollapsed);
  list.style.display = syncCollapsed ? 'none' : 'flex';
  if (syncCollapsed) {
    return;
  }
  (preview.Sync.items || []).forEach(item => {
    const row = document.createElement('li');
    row.className = 'handrive-job-queue-item';
    row.dataset.status = item.retry > 0 ? 'failed' : 'queued';
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
    status.textContent = item.retry > 0 ? ('재시도 ' + item.retry) : '대기 중';
    sub.appendChild(status);
    row.appendChild(sub);

    const meta = document.createElement('div');
    meta.className = 'handrive-job-queue-item-meta';
    meta.textContent = item.path;
    row.appendChild(meta);

    if (item.retry > 0) {
      const reason = document.createElement('div');
      reason.className = 'handrive-job-queue-item-reason';
      reason.textContent = '이전 동기화 시도가 실패해 다시 대기 중입니다.';
      row.appendChild(reason);
    }
    const progress = document.createElement('div');
    progress.className = 'handrive-job-queue-progress';
    const progressBar = document.createElement('span');
    progressBar.className = 'handrive-job-queue-progress-bar';
    if (item.retry > 0) {
      progressBar.classList.add('is-failed');
    } else {
      progressBar.classList.add('is-queued');
    }
    progress.appendChild(progressBar);
    row.appendChild(progress);
    list.appendChild(row);
  });
}

function applySettings() {
  const host = document.getElementById('settings-host');
  host.style.visibility = settingsHidden ? 'hidden' : 'visible';
  document.getElementById('settings-server').value = preview.Settings.server_url;
  document.getElementById('settings-dir').value = preview.Settings.sync_dir;
  document.getElementById('settings-account').textContent = [
    '연결된 계정: ' + preview.Settings.username,
    '서버: ' + preview.Settings.server_url,
    '동기화 루트: ' + preview.Settings.sync_dir,
  ].join('\n');
  document.getElementById('settings-status').textContent = preview.Settings.status;
}

function setHostMode(tight) {
  document.querySelectorAll('.host').forEach((host) => {
    host.classList.toggle('tight', tight);
  });
  document.getElementById('tight-btn').classList.toggle('active', tight);
  document.getElementById('oversized-btn').classList.toggle('active', !tight);
}

document.getElementById('tight-btn').addEventListener('click', () => setHostMode(true));
document.getElementById('oversized-btn').addEventListener('click', () => setHostMode(false));
document.getElementById('storage-download-btn').addEventListener('click', () => {
  storageHidden = false;
  setPreviewNote('다운로드 버튼 클릭 미리보기');
});
document.getElementById('sync-toggle-btn').addEventListener('click', () => {
  syncCollapsed = !syncCollapsed;
  syncHidden = false;
  applySync();
  setPreviewNote(syncCollapsed ? '동기화 패널 접힘' : '동기화 패널 펼침');
});
document.getElementById('settings-save-btn').addEventListener('click', () => {
  preview.Settings.server_url = document.getElementById('settings-server').value;
  preview.Settings.sync_dir = document.getElementById('settings-dir').value;
  preview.Settings.status = '저장되었습니다. 동기화를 다시 시작합니다.';
  settingsHidden = false;
  applySettings();
  setPreviewNote('설정 저장 미리보기');
});
document.getElementById('settings-login-btn').addEventListener('click', () => {
  preview.Settings.server_url = document.getElementById('settings-server').value;
  preview.Settings.sync_dir = document.getElementById('settings-dir').value;
  preview.Settings.username = 'preview-user';
  preview.Settings.status = '로그인 완료. 트레이 정보를 갱신했습니다.';
  settingsHidden = false;
  applySettings();
  setPreviewNote('다시 로그인 미리보기');
});
document.addEventListener('mousedown', (event) => {
  const syncHost = document.getElementById('sync-host');
  const settingsHost = document.getElementById('settings-host');
  const insideSync = syncHost.contains(event.target);
  const insideSettings = settingsHost.contains(event.target);
  if (!insideSync && !insideSettings) {
    let changed = false;
    if (!syncHidden) {
      syncHidden = true;
      changed = true;
    }
    if (!settingsHidden) {
      settingsHidden = true;
      changed = true;
    }
    if (changed) {
      applySync();
      applySettings();
      setPreviewNote('바깥 클릭으로 설정/동기화 패널 숨김');
    }
  }
});

applyStorage();
applySync();
applySettings();
</script>
</body>
</html>`
