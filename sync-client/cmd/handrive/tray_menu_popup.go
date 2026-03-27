//go:build windows

package main

import (
	"html/template"
	"strings"
	"sync"
	"time"

	"github.com/getlantern/systray"
	webview2 "github.com/jchv/go-webview2"
	"hanplanet/handsync/internal/api"
	"hanplanet/handsync/internal/config"
)

type trayMenuData struct {
	AccountTitle string `json:"account_title"`
	StorageTitle string `json:"storage_title"`
}

var (
	trayMenuPopup       popupWindow
	trayMenuStateMu     sync.RWMutex
	trayMenuAccountText = "로그인 중..."
	trayMenuStorageText = "용량: 로딩 중..."
)

func setTrayMenuState(accountTitle, storageTitle string) {
	trayMenuStateMu.Lock()
	trayMenuAccountText = accountTitle
	trayMenuStorageText = storageTitle
	trayMenuStateMu.Unlock()
	refreshWebPopup(&trayMenuPopup, func(w webview2.WebView) {
		w.Eval(popupEvalJSON("window.handriveApplyTrayMenu", currentTrayMenuData()))
	})
}

func currentTrayMenuData() trayMenuData {
	trayMenuStateMu.RLock()
	defer trayMenuStateMu.RUnlock()
	return trayMenuData{
		AccountTitle: trayMenuAccountText,
		StorageTitle: trayMenuStorageText,
	}
}

func renderTrayMenuHTML() string {
	body := `
<div class="tray-menu-panel">
  <div class="tray-menu-summary">
    <button class="tray-menu-close" id="tray-menu-close" type="button" aria-label="메뉴 닫기">×</button>
    <div class="tray-menu-app">HanDrive</div>
    <div class="tray-menu-account" id="tray-menu-account"></div>
    <div class="tray-menu-storage" id="tray-menu-storage"></div>
  </div>
  <div class="tray-menu-actions">
    <button class="tray-menu-item" type="button" data-action="storage"><span class="tray-menu-item-label">용량 현황</span><span class="tray-menu-item-hint">Space</span></button>
    <button class="tray-menu-item" type="button" data-action="open"><span class="tray-menu-item-label">동기화 폴더 열기</span><span class="tray-menu-item-hint">Open</span></button>
    <button class="tray-menu-item" type="button" data-action="logs"><span class="tray-menu-item-label">로그 폴더 열기</span><span class="tray-menu-item-hint">Logs</span></button>
    <button class="tray-menu-item" type="button" data-action="sync"><span class="tray-menu-item-label">동기화 상태</span><span class="tray-menu-item-hint">Queue</span></button>
    <button class="tray-menu-item" type="button" data-action="web"><span class="tray-menu-item-label">웹으로 열기</span><span class="tray-menu-item-hint">Web</span></button>
    <button class="tray-menu-item" type="button" data-action="settings"><span class="tray-menu-item-label">설정</span><span class="tray-menu-item-hint">Config</span></button>
  </div>
  <button class="tray-menu-quit-btn" id="tray-menu-quit-btn" type="button" aria-label="프로그램 종료">프로그램 종료</button>
</div>`
	script := `
const trayMenuAccount = document.getElementById('tray-menu-account');
const trayMenuStorage = document.getElementById('tray-menu-storage');
function applyTrayMenu(payload) {
  trayMenuAccount.textContent = payload.account_title || 'HanDrive';
  trayMenuStorage.textContent = payload.storage_title || '용량 정보를 불러오는 중입니다.';
}
window.handriveApplyTrayMenu = applyTrayMenu;
window.handriveInitTrayMenu().then(applyTrayMenu);
document.getElementById('tray-menu-quit-btn').addEventListener('click', () => {
  if (window.handriveTrayAction) window.handriveTrayAction('quit');
});
document.getElementById('tray-menu-close').addEventListener('click', () => {
  if (window.handriveClose) window.handriveClose();
});
document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.getAttribute('data-action');
    if (window.handriveTrayAction) window.handriveTrayAction(action);
  });
});
`
	return popupHTML(popupTemplateData{
		BodyHTML:          template.HTML(body),
		Script:            template.JS(script),
		HeaderHidden:      true,
		BareBody:          true,
		DisableAutoResize: true,
	})
}

func toggleTrayMenuPopup(exePath string, onSettingsSaved func()) {
	trayMenuPopup.mu.Lock()
	isOpen := trayMenuPopup.open
	trayMenuPopup.mu.Unlock()
	if isOpen {
		closeWebPopup(&trayMenuPopup)
		return
	}
	openWebPopup(&trayMenuPopup, "HanDrive 메뉴", 286, 388, true, func(w webview2.WebView, hwnd uintptr) error {
		_ = hwnd
		if err := w.Bind("handriveClose", func() error {
			closeWebPopup(&trayMenuPopup)
			return nil
		}); err != nil {
			return err
		}
		if err := w.Bind("handriveInitTrayMenu", func() (trayMenuData, error) {
			return currentTrayMenuData(), nil
		}); err != nil {
			return err
		}
		if err := w.Bind("handriveTrayAction", func(action string) error {
			go runTrayMenuAction(strings.TrimSpace(action), exePath, onSettingsSaved)
			return nil
		}); err != nil {
			return err
		}
		w.SetHtml(renderTrayMenuHTML())
		return nil
	})
}

func runTrayMenuAction(action, exePath string, onSettingsSaved func()) {
	closeWebPopup(&trayMenuPopup)
	go func() {
		deadline := time.Now().Add(1200 * time.Millisecond)
		for time.Now().Before(deadline) {
			trayMenuPopup.mu.Lock()
			stillOpen := trayMenuPopup.open
			trayMenuPopup.mu.Unlock()
			if !stillOpen {
				break
			}
			time.Sleep(25 * time.Millisecond)
		}
		time.Sleep(50 * time.Millisecond)

		switch action {
		case "storage":
			OpenStoragePopup()
		case "open":
			openLocalFolder()
		case "logs":
			openLogFolder(exePath)
		case "sync":
			OpenSyncStatusPopup()
		case "web":
			cfg, _ := config.Load()
			if cfg != nil && cfg.ServerURL != "" {
				api.OpenBrowser(strings.TrimRight(cfg.ServerURL, "/") + "/handrive")
			} else {
				api.OpenBrowser("https://www.hanplanet.com/handrive")
			}
		case "settings":
			openSettings(exePath, onSettingsSaved)
		case "quit":
			systray.Quit()
		}
	}()
}
