//go:build windows

package main

import (
	"fmt"
	"html/template"
	"log"
	"os"
	"strings"

	webview2 "github.com/jchv/go-webview2"
	"hanplanet/handsync/internal/api"
	"hanplanet/handsync/internal/config"
)

type settingsData struct {
	ServerURL string `json:"server_url"`
	SyncDir   string `json:"sync_dir"`
	Username  string `json:"username"`
	Status    string `json:"status"`
}

var settingsPopup popupWindow

func saveSettings(serverURL, syncDir string) (*config.Config, error) {
	serverURL = strings.TrimRight(strings.TrimSpace(serverURL), "/")
	syncDir = strings.TrimSpace(syncDir)
	if serverURL == "" {
		return nil, fmt.Errorf("server URL is required")
	}
	if syncDir == "" {
		return nil, fmt.Errorf("sync dir is required")
	}
	cfg, _ := config.Load()
	if cfg == nil {
		cfg = &config.Config{PollIntervalSeconds: 30}
	}
	cfg.ServerURL = serverURL
	cfg.SyncDir = config.NormalizeSyncRoot(syncDir)
	if err := config.Save(cfg); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(cfg.SyncDir, 0755); err != nil {
		return nil, err
	}
	return cfg, nil
}

func loadSettingsData(status string) settingsData {
	cfg, _ := config.Load()
	if cfg == nil {
		return settingsData{Status: status}
	}
	if status == "" {
		status = "저장 후 바로 로그인할 수 있습니다."
	}
	return settingsData{
		ServerURL: cfg.ServerURL,
		SyncDir:   cfg.SyncDir,
		Username:  resolveCurrentUsername(cfg),
		Status:    status,
	}
}

func renderSettingsHTML() string {
	body := `
<div class="settings-sheet">
  <div class="settings-card">
    <div class="settings-card-header" data-drag-region>
      <div class="settings-card-title">연결 정보</div>
      <div class="settings-card-subtitle">서버 URL과 동기화 루트를 먼저 저장한 뒤 브라우저 로그인을 시작할 수 있습니다.</div>
    </div>
    <div class="field">
      <label for="server-url">서버 URL</label>
      <input id="server-url" type="text" autocomplete="off" spellcheck="false" placeholder="https://www.hanplanet.com">
    </div>
    <div class="field">
      <label for="sync-dir">동기화 루트</label>
      <input id="sync-dir" type="text" autocomplete="off" spellcheck="false" placeholder="C:\Users\user\Hanplanet">
    </div>
    <div class="settings-card-header" data-drag-region style="margin-top:18px">
      <div class="settings-card-title">계정 상태</div>
      <div class="settings-card-subtitle">현재 연결된 계정과 즉시 반영되는 로그인 상태를 보여줍니다.</div>
    </div>
    <div class="status-card" id="account-card"></div>
    <div class="settings-status" id="status-card"></div>
    <div class="settings-actions">
      <button class="btn btn-primary" id="save-btn" type="button">저장</button>
      <button class="btn btn-secondary" id="login-btn" type="button">다시 로그인</button>
    </div>
  </div>
</div>
`
	script := `
const state = { server_url: "", sync_dir: "", username: "", status: "" };
const serverInput = document.getElementById('server-url');
const syncInput = document.getElementById('sync-dir');
const accountCard = document.getElementById('account-card');
const statusCard = document.getElementById('status-card');
const saveBtn = document.getElementById('save-btn');
const loginBtn = document.getElementById('login-btn');

function accountText(payload) {
  if (!payload.username) {
    return "로그인이 아직 연결되지 않았습니다.\n'다시 로그인'을 누르면 브라우저 인증이 시작됩니다.";
  }
  const lines = ["연결된 계정: " + payload.username];
  if (payload.server_url) lines.push("서버: " + payload.server_url);
  if (payload.sync_dir) lines.push("동기화 루트: " + payload.sync_dir);
  return lines.join("\n");
}

function applyState(payload) {
  state.server_url = payload.server_url || "";
  state.sync_dir = payload.sync_dir || "";
  state.username = payload.username || "";
  state.status = payload.status || "";
  serverInput.value = state.server_url;
  syncInput.value = state.sync_dir;
  accountCard.textContent = accountText(payload);
  statusCard.textContent = state.status;
  if (window.handriveRequestResize) {
    requestAnimationFrame(() => window.handriveRequestResize());
  }
}

async function save() {
  applyState(await window.handriveSaveSettings(serverInput.value, syncInput.value));
}

async function relogin() {
  saveBtn.disabled = true;
  loginBtn.disabled = true;
  try {
    applyState(await window.handriveRelogin(serverInput.value, syncInput.value));
  } finally {
    saveBtn.disabled = false;
    loginBtn.disabled = false;
  }
}

saveBtn.addEventListener('click', save);
loginBtn.addEventListener('click', relogin);
window.handriveApplySettings = applyState;
window.handriveInitSettings().then(applyState);
`
	return popupHTML(popupTemplateData{
		BodyHTML:          template.HTML(body),
		Script:            template.JS(script),
		HeaderHidden:      true,
		BareBody:          true,
		DisableAutoResize: true,
	})
}

func openSettings(exePath string, onSaved func()) {
	_ = exePath
	openWebPopup(&settingsPopup, "HanDrive 설정", 560, 468, true, func(w webview2.WebView, hwnd uintptr) error {
		_ = hwnd
		if err := w.Bind("handriveBeginDrag", func() error {
			nBeginWindowDrag(uintptr(w.Window()))
			return nil
		}); err != nil {
			return err
		}
		if err := w.Bind("handriveClose", func() error {
			closeWebPopup(&settingsPopup)
			return nil
		}); err != nil {
			return err
		}
		if err := w.Bind("handriveInitSettings", func() (settingsData, error) {
			return loadSettingsData(""), nil
		}); err != nil {
			return err
		}
		if err := w.Bind("handriveSaveSettings", func(serverURL, syncDir string) (settingsData, error) {
			cfg, err := saveSettings(serverURL, syncDir)
			if err != nil {
				return loadSettingsData("저장 실패: " + err.Error()), nil
			}
			log.Printf("[settings] saved: server=%s sync_root=%s", cfg.ServerURL, cfg.SyncDir)
			if onSaved != nil {
				go onSaved()
			}
			return loadSettingsData("저장되었습니다. 동기화를 다시 시작합니다."), nil
		}); err != nil {
			return err
		}
		if err := w.Bind("handriveRelogin", func(serverURL, syncDir string) (settingsData, error) {
			cfg, err := saveSettings(serverURL, syncDir)
			if err != nil {
				return loadSettingsData("로그인 준비 실패: " + err.Error()), nil
			}
			log.Printf("[settings] relogin saved: server=%s sync_root=%s", cfg.ServerURL, cfg.SyncDir)
			if onSaved != nil {
				go onSaved()
			}
			if err := api.BrowserLogin(cfg.ServerURL, config.TokensPath(), true); err != nil {
				log.Printf("[settings] browser login error: %v", err)
				return loadSettingsData("로그인 실패: " + err.Error()), nil
			}
			client := api.NewClient(cfg.ServerURL, config.TokensPath())
			if info, err := client.GetMe(); err == nil && strings.TrimSpace(info.Username) != "" {
				setCachedUserInfo(info)
			} else if err != nil {
				log.Printf("[settings] GetMe after login failed: %v", err)
			}
			RefreshUserInfoNow()
			return loadSettingsData("로그인 완료. 트레이 정보를 갱신했습니다."), nil
		}); err != nil {
			return err
		}

		w.SetHtml(renderSettingsHTML())
		return nil
	})
}
