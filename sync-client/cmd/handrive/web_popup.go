//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"runtime"
	"strings"
	"sync"

	webview2 "github.com/jchv/go-webview2"
)

type popupWindow struct {
	mu   sync.Mutex
	view webview2.WebView
	hwnd uintptr
	open bool
}

var popupCoordinatorMu sync.Mutex

func closeOtherPopups(current *popupWindow) {
	for _, p := range []*popupWindow{&trayMenuPopup, &storagePopup, &syncStatusPopup, &settingsPopup} {
		if p == nil || p == current {
			continue
		}
		p.mu.Lock()
		isOpen := p.open
		p.mu.Unlock()
		if isOpen {
			closeWebPopup(p)
		}
	}
}

type popupTemplateData struct {
	Title             string
	Subtitle          string
	BodyClass         string
	BodyHTML          template.HTML
	Script            template.JS
	HeaderClass       string
	HeaderHidden      bool
	BareBody          bool
	DisableAutoResize bool
}

var popupShellTmpl = template.Must(template.New("popup-shell").Parse(`<!DOCTYPE html>
<html lang="ko" class="{{if .BareBody}}is-bare{{end}}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<style>
:root {
  color-scheme: light dark;
  --bg: #eef3f8;
  --panel: rgba(255,255,255,0.96);
  --panel-strong: #ffffff;
  --panel-soft: #f5f5f5;
  --border: rgba(15,23,42,0.09);
  --shadow: 0 18px 48px rgba(15,23,42,0.18);
  --text: #18202b;
  --text-stronger: #111827;
  --text-soft: #647184;
  --text-faint: #8a96a8;
  --accent: #0055b8;
  --accent-soft: rgba(0,85,184,0.12);
  --success: #2c9b58;
  --success-soft: rgba(44,155,88,0.14);
  --danger: #c24545;
  --hover-soft: rgba(15,23,42,0.06);
  --elevated-bg: rgba(255,255,255,0.96);
  --surface-muted: #f5f5f5;
  --surface-muted-strong: rgba(255,255,255,0.98);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f141b;
    --panel: rgba(46,46,46,0.97);
    --panel-strong: #2c2c2c;
    --panel-soft: rgba(40,40,40,0.94);
    --border: rgba(255,255,255,0.08);
    --shadow: 0 22px 54px rgba(0,0,0,0.42);
    --text: #f2f2f2;
    --text-stronger: #fafafa;
    --text-soft: #d6d6d6;
    --text-faint: #b2b2b2;
    --accent: #d8e5fb;
    --accent-soft: rgba(255,255,255,0.08);
    --success: #7fd79e;
    --success-soft: rgba(127,215,158,0.14);
    --danger: #ff8c8c;
    --hover-soft: rgba(255,255,255,0.08);
    --elevated-bg: rgba(46,46,46,0.97);
    --surface-muted: rgba(40,40,40,0.94);
    --surface-muted-strong: rgba(46,46,46,0.96);
  }
}
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; }
html.is-bare, body.is-bare { width: 100%; height: 100%; }
body {
  margin: 0;
  background:
    radial-gradient(circle at top left, rgba(0,85,184,0.14), transparent 36%),
    linear-gradient(180deg, rgba(255,255,255,0.18), transparent 24%),
    var(--bg);
  color: var(--text);
  font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
  overflow: hidden;
  user-select: none;
}
body.is-bare {
  background: transparent;
  display: block;
  overflow: hidden;
}
.popup-shell {
  width: 100%;
  height: 100%;
  padding: 14px;
}
.popup-shell.is-bare {
  padding: 0;
}
.popup-card {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 24px;
  background: var(--panel);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  overflow: hidden;
  backdrop-filter: blur(18px);
}
.popup-card.is-bare {
  border: 0;
  box-shadow: none;
  background: transparent;
  backdrop-filter: none;
}
.popup-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 18px 14px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(255,255,255,0.18), transparent), var(--panel-strong);
}
.popup-card.is-headerless .popup-head {
  display: none;
}
.popup-card.is-headerless .popup-body {
  padding: 14px;
}
.popup-card.is-bare .popup-body {
  padding: 0;
}
.popup-head-main {
  min-width: 0;
  flex: 1;
}
.popup-title {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--text);
}
.popup-subtitle {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-soft);
  line-height: 1.45;
}
.popup-close {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background .15s ease, color .15s ease;
}
.popup-close:hover {
  background: var(--panel-soft);
  color: var(--text);
}
.popup-close::before,
.popup-close::after {
  content: "";
  position: absolute;
  width: 14px;
  height: 2px;
  border-radius: 999px;
  background: currentColor;
}
.popup-close::before { transform: rotate(45deg); }
.popup-close::after { transform: rotate(-45deg); }
.popup-body {
  flex: 1;
  min-height: 0;
  padding: 16px 18px 18px;
  overflow: auto;
}
.section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--panel-strong);
}
.section + .section {
  margin-top: 12px;
}
.section-label {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field label {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-soft);
}
.field input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel-soft);
  color: var(--text);
  padding: 12px 14px;
  font: inherit;
  outline: none;
}
.field input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 4px var(--accent-soft);
}
.status-card {
  border-radius: 16px;
  padding: 14px;
  background: var(--panel-soft);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.hint-card {
  border-radius: 16px;
  padding: 13px 14px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}
.btn {
  flex: 1;
  min-height: 42px;
  border: 0;
  border-radius: 999px;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: transform .12s ease, opacity .12s ease, background .12s ease;
}
.btn:active { transform: translateY(1px); }
.btn-primary {
  background: var(--panel-soft);
  color: var(--text);
  border: 1px solid var(--border);
}
.btn-secondary {
  background: var(--panel-soft);
  color: var(--text);
  border: 1px solid var(--border);
}
.btn-muted {
  background: transparent;
  color: var(--text-soft);
  border: 1px solid var(--border);
}
.metric-hero {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 16px 14px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(0,85,184,0.12), transparent), var(--panel-strong);
  border: 1px solid var(--border);
}
.metric-kicker {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent);
}
.metric-value {
  font-size: 27px;
  font-weight: 800;
  letter-spacing: -0.03em;
}
.metric-sub {
  font-size: 12px;
  color: var(--text-soft);
}
.bar {
  display: flex;
  gap: 2px;
  height: 12px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--panel-soft);
  border: 1px solid var(--border);
}
.bar-seg { height: 100%; min-width: 2px; }
.legend {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text);
}
.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  flex: 0 0 auto;
}
.legend-text {
  flex: 1;
  min-width: 0;
}
.legend-size {
  font-size: 12px;
  color: var(--text-soft);
}
.queue-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.queue-item {
  padding: 13px 14px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--panel-strong);
}
.queue-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.queue-badge,
.queue-retry {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
}
.queue-badge {
  background: var(--accent-soft);
  color: var(--accent);
}
.queue-retry {
  background: var(--panel-soft);
  color: var(--text-soft);
}
.queue-path {
  margin-top: 10px;
  font-size: 13px;
  color: var(--text);
  word-break: break-all;
  line-height: 1.55;
}
.account-storage-popup {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  background: var(--elevated-bg);
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
.account-storage-popup-title {
  font-weight: 600;
  color: var(--text-stronger);
  margin-right: 4px;
}
.account-storage-popup-used {
  font-weight: 700;
  color: #3aaa5c;
  font-size: 15px;
}
@media (prefers-color-scheme: dark) {
  .account-storage-popup-used {
    color: var(--accent);
  }
}
.account-storage-popup-sep,
.account-storage-popup-total {
  color: var(--text);
}
.account-storage-popup-bar {
  position: relative;
  width: 100%;
  height: 20px;
  border-radius: 6px;
  overflow: hidden;
  background: color-mix(in srgb, var(--border) 82%, transparent);
}
.account-storage-popup-bar-seg {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  border-radius: 6px;
  transition: opacity 0.15s;
}
.account-storage-popup-bar-seg:hover { opacity: .82; }
.account-storage-popup-bar-fill {
  background: #3aaa5c;
}
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
  font-variant-numeric: tabular-nums;
}
.account-storage-popup-status {
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-soft);
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
  border-radius: 0;
  cursor: pointer;
}
.account-storage-popup-download-btn:hover,
.account-storage-popup-download-btn:focus-visible {
  background: transparent;
  color: var(--text);
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
  background: var(--elevated-bg);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.handrive-job-queue-panel.is-collapsed { gap: 0; max-height: none; }
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
  color: var(--text);
}
.handrive-job-queue-summary {
  font-size: 12px;
  color: var(--text-soft);
  line-height: 1.45;
  white-space: normal;
}
.handrive-job-queue-head-actions {
  flex: 0 0 auto;
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.handrive-job-queue-toggle,
.handrive-job-queue-close {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-soft);
  font-size: 27px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.handrive-job-queue-close { font-size: 0; position: relative; }
.handrive-job-queue-toggle-icon {
  position: relative;
  display: block;
  width: 14px;
  height: 14px;
}
.handrive-job-queue-toggle-icon::before {
  content: "";
  position: absolute;
  left: 1px;
  right: 1px;
  top: 50%;
  height: 2px;
  transform: translateY(-50%);
  border-radius: 999px;
  background: currentColor;
}
.handrive-job-queue-toggle[aria-expanded="false"] .handrive-job-queue-toggle-icon::before {
  top: 1px;
  bottom: 1px;
  height: auto;
  transform: none;
  border-radius: 2px;
  border: 2px solid currentColor;
  background: transparent;
}
.handrive-job-queue-close-icon {
  position: relative;
  display: block;
  width: 14px;
  height: 14px;
}
.handrive-job-queue-close-icon::before,
.handrive-job-queue-close-icon::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 2px;
  height: 14px;
  border-radius: 999px;
  background: currentColor;
  transform-origin: center;
}
.handrive-job-queue-close-icon::before { transform: translate(-50%, -50%) rotate(45deg); }
.handrive-job-queue-close-icon::after { transform: translate(-50%, -50%) rotate(-45deg); }
.handrive-job-queue-toggle:hover,
.handrive-job-queue-toggle:focus-visible,
.handrive-job-queue-close:hover,
.handrive-job-queue-close:focus-visible {
  background: var(--hover-soft);
  color: var(--text-stronger);
}
.handrive-job-queue-panel.is-collapsed .handrive-job-queue-list { display: none; }
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
  background: var(--surface-muted);
  cursor: pointer;
}
.handrive-job-queue-item:hover {
  background: color-mix(in srgb, #4f8fe8 16%, var(--surface-muted));
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
  color: var(--text);
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
  white-space: nowrap;
}
.handrive-job-queue-progress {
  position: relative;
  width: 100%;
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--border) 72%, transparent);
  overflow: hidden;
}
.handrive-job-queue-progress-bar {
  display: block;
  height: 100%;
  border-radius: inherit;
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
.tray-menu-panel {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--elevated-bg);
  box-shadow: var(--shadow);
}
.tray-menu-summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 2px 2px 8px;
  border-bottom: 1px solid var(--border);
  position: relative;
}
.tray-menu-quit-btn {
  width: 100%;
  min-height: 42px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-muted);
  color: var(--danger);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  text-align: left;
}
.tray-menu-quit-btn:hover,
.tray-menu-quit-btn:focus-visible {
  background: var(--hover-soft);
}
.tray-menu-close {
  position: absolute;
  top: 0;
  right: 0;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-soft);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tray-menu-close:hover,
.tray-menu-close:focus-visible {
  background: var(--hover-soft);
  color: var(--text-stronger);
}
.tray-menu-app {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.tray-menu-account {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-stronger);
}
.tray-menu-storage {
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-soft);
}
.tray-menu-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tray-menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 42px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-muted);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  transition: background .12s ease, border-color .12s ease, transform .12s ease;
}
.tray-menu-item:active { transform: translateY(1px); }
.tray-menu-item:hover,
.tray-menu-item:focus-visible {
  background: color-mix(in srgb, var(--accent) 10%, var(--surface-muted));
  border-color: color-mix(in srgb, var(--accent) 18%, var(--border));
}
.tray-menu-item.is-danger {
  color: var(--danger);
}
.tray-menu-item-label {
  min-width: 0;
}
.tray-menu-item-hint {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-faint);
}
.settings-sheet {
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
.settings-card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}
.settings-card-subtitle {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-soft);
}
.settings-actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}
.settings-status {
  border-radius: 14px;
  padding: 12px 14px;
  background: var(--panel-soft);
  border: 1px solid var(--border);
  color: var(--text-soft);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}
</style>
</head>
<body class="{{if .BareBody}}is-bare{{end}}">
  {{if .BareBody}}
  {{.BodyHTML}}
  {{else}}
  <div class="popup-shell {{if .BareBody}}is-bare{{end}}">
    <div class="popup-card {{if .HeaderHidden}}is-headerless{{end}} {{if .BareBody}}is-bare{{end}}">
      <div class="popup-head {{.HeaderClass}}" id="drag-region">
        <div class="popup-head-main">
          <h1 class="popup-title">{{.Title}}</h1>
          <div class="popup-subtitle">{{.Subtitle}}</div>
        </div>
        <button class="popup-close" type="button" id="popup-close" aria-label="닫기"></button>
      </div>
      <div class="popup-body {{.BodyClass}}">
        {{.BodyHTML}}
      </div>
    </div>
  </div>
  {{end}}
<script>
(function(){
  const drag = document.getElementById('drag-region');
  const closeBtn = document.getElementById('popup-close');
  function tryDrag(e) {
    if (e.target.closest('[data-no-drag], button, input, textarea, a')) return;
    if (e.target.closest('[data-drag-region], .popup-head, .account-storage-popup, .handrive-job-queue-head, .settings-card-header')) {
      if (window.handriveBeginDrag) window.handriveBeginDrag();
    }
  }
  if (drag) drag.addEventListener('mousedown', tryDrag);
  document.addEventListener('mousedown', tryDrag);
  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      if (window.handriveClose) window.handriveClose();
    });
  }
  function requestResize() {
    if (!window.handriveResizeToContent) return;
    const doc = document.documentElement;
    const body = document.body;
    const root = body && body.firstElementChild ? body.firstElementChild : body;
    const rect = root ? root.getBoundingClientRect() : { width: 0, height: 0 };
    const isBare = body && body.classList.contains('is-bare');
    const width = Math.ceil(isBare
      ? Math.max(rect.width || 0, root ? root.scrollWidth || 0 : 0)
      : Math.max(
          rect.width || 0,
          root ? root.scrollWidth || 0 : 0,
          body ? body.scrollWidth || 0 : 0,
          doc ? doc.scrollWidth || 0 : 0
        ));
    const height = Math.ceil(isBare
      ? Math.max(rect.height || 0, root ? root.scrollHeight || 0 : 0)
      : Math.max(
          rect.height || 0,
          root ? root.scrollHeight || 0 : 0,
          body ? body.scrollHeight || 0 : 0,
          doc ? doc.scrollHeight || 0 : 0
        ));
    if (width > 0 && height > 0) window.handriveResizeToContent(width, height);
  }
  window.handriveRequestResize = requestResize;
  const autoResizeDisabled = {{if .DisableAutoResize}}true{{else}}false{{end}};
  if (!autoResizeDisabled) {
    window.addEventListener('load', () => setTimeout(requestResize, 0));
    window.addEventListener('resize', () => setTimeout(requestResize, 0));
    requestAnimationFrame(() => setTimeout(requestResize, 0));
  }
})();
{{.Script}}
</script>
</body>
</html>`))

func popupHTML(data popupTemplateData) string {
	var b strings.Builder
	_ = popupShellTmpl.Execute(&b, data)
	return b.String()
}

func openWebPopup(p *popupWindow, title string, width, height int, autoCloseOnDeactivate bool, setup func(webview2.WebView, uintptr) error) {
	popupCoordinatorMu.Lock()
	closeOtherPopups(p)
	p.mu.Lock()
	if p.open && p.hwnd != 0 {
		hwnd := p.hwnd
		p.mu.Unlock()
		popupCoordinatorMu.Unlock()
		nBringToFront(hwnd)
		return
	}
	p.open = true
	p.mu.Unlock()
	popupCoordinatorMu.Unlock()

	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[popup] panic while opening %s: %v", title, r)
				p.mu.Lock()
				p.view = nil
				p.hwnd = 0
				p.open = false
				p.mu.Unlock()
			}
		}()

		w := webview2.NewWithOptions(webview2.WebViewOptions{
			Debug:     false,
			AutoFocus: true,
			WindowOptions: webview2.WindowOptions{
				Title:  title,
				Width:  uint(width),
				Height: uint(height),
				Center: false,
			},
		})
		if w == nil {
			p.mu.Lock()
			p.open = false
			p.mu.Unlock()
			log.Printf("[popup] failed to create webview: %s", title)
			return
		}

		hwnd := uintptr(w.Window())
		nStylePopupWindow(hwnd, int32(width), int32(height), 28)

		p.mu.Lock()
		p.view = w
		p.hwnd = hwnd
		p.mu.Unlock()

		if autoCloseOnDeactivate {
			nWatchPopupDeactivation(hwnd, func() bool {
				p.mu.Lock()
				defer p.mu.Unlock()
				return p.open && p.hwnd == hwnd
			}, func() {
				closeWebPopup(p)
			})
		}

		if err := w.Bind("handriveResizeToContent", func(contentWidth, contentHeight int) error {
			const minWidth = 280
			const maxWidth = 720
			const minHeight = 120
			const maxHeight = 720
			if contentWidth < minWidth {
				contentWidth = minWidth
			}
			if contentWidth > maxWidth {
				contentWidth = maxWidth
			}
			if contentHeight < minHeight {
				contentHeight = minHeight
			}
			if contentHeight > maxHeight {
				contentHeight = maxHeight
			}
			nResizeWindow(hwnd, int32(contentWidth), int32(contentHeight))
			nRoundWindow(hwnd, int32(contentWidth), int32(contentHeight), 28)
			return nil
		}); err != nil {
			log.Printf("[popup] resize bind error: %s: %v", title, err)
		}
		if err := w.Bind("handriveSetPopupSize", func(popupWidth, popupHeight int) error {
			if popupWidth < 240 {
				popupWidth = 240
			}
			if popupHeight < 100 {
				popupHeight = 100
			}
			nResizeWindow(hwnd, int32(popupWidth), int32(popupHeight))
			nRoundWindow(hwnd, int32(popupWidth), int32(popupHeight), 28)
			return nil
		}); err != nil {
			log.Printf("[popup] set-size bind error: %s: %v", title, err)
		}

		if err := setup(w, hwnd); err != nil {
			log.Printf("[popup] setup error: %s: %v", title, err)
		}
		nRevealPopupWindow(hwnd)

		w.Run()
		w.Destroy()

		p.mu.Lock()
		p.view = nil
		p.hwnd = 0
		p.open = false
		p.mu.Unlock()
	}()
}

func closeWebPopup(p *popupWindow) {
	p.mu.Lock()
	view := p.view
	p.mu.Unlock()
	if view != nil {
		view.Dispatch(func() {
			view.Terminate()
		})
	}
}

func refreshWebPopup(p *popupWindow, fn func(webview2.WebView)) {
	p.mu.Lock()
	view := p.view
	p.mu.Unlock()
	if view != nil {
		view.Dispatch(func() { fn(view) })
	}
}

func popupEvalJSON(name string, value any) string {
	b, _ := json.Marshal(value)
	return fmt.Sprintf("%s(%s);", name, string(b))
}
