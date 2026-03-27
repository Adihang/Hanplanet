//go:build windows

package main

import (
	"errors"
	"fmt"
	"html/template"
	"log"
	"math"
	"os"
	"strings"
	"sync"
	"time"

	webview2 "github.com/jchv/go-webview2"
	"hanplanet/handsync/internal/api"
	"hanplanet/handsync/internal/config"
)

var (
	userInfoMu          sync.RWMutex
	cachedUserInfo      *api.UserInfo
	refreshUserInfoFunc func()
	storagePopup        popupWindow
)

type storagePopupData struct {
	Username     string          `json:"username"`
	UsedDisplay  string          `json:"used_display"`
	TotalDisplay string          `json:"total_display"`
	FreeDisplay  string          `json:"free_display"`
	Percent      float64         `json:"percent"`
	FreePercent  float64         `json:"free_percent"`
	Breakdown    []api.QuotaItem `json:"breakdown"`
	Status       string          `json:"status"`
}

func getCachedUserInfo() *api.UserInfo {
	userInfoMu.RLock()
	defer userInfoMu.RUnlock()
	return cachedUserInfo
}

func setCachedUserInfo(info *api.UserInfo) {
	userInfoMu.Lock()
	cachedUserInfo = info
	userInfoMu.Unlock()
}

func refreshUserInfo(updateTray func(*api.UserInfo)) {
	cfg, err := config.Load()
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			log.Printf("[storage] config load error: %v", err)
		}
		return
	}
	client := api.NewClient(cfg.ServerURL, config.TokensPath())
	info, err := client.GetMe()
	if err != nil {
		log.Printf("[storage] GetMe error: %v", err)
		return
	}
	setCachedUserInfo(info)
	updateTray(info)
	refreshWebPopup(&storagePopup, func(w webview2.WebView) {
		w.Eval(popupEvalJSON("window.handriveApplyStorage", storageState("최신 용량을 반영했습니다.")))
	})
}

func StartUserInfoRefresher(updateTray func(*api.UserInfo)) {
	refresh := func() { refreshUserInfo(updateTray) }
	refreshUserInfoFunc = refresh

	go refresh()
	go func() {
		t := time.NewTicker(5 * time.Minute)
		defer t.Stop()
		for range t.C {
			refresh()
		}
	}()
}

func RefreshUserInfoNow() {
	if refreshUserInfoFunc != nil {
		go refreshUserInfoFunc()
	}
}

func storageState(status string) storagePopupData {
	info := getCachedUserInfo()
	if info == nil {
		return storagePopupData{Status: "아직 불러온 계정 정보가 없습니다."}
	}
	if status == "" {
		status = fmt.Sprintf("%s / %s 사용 중", info.UsedDisplay, info.TotalDisplay)
	}
	return storagePopupData{
		Username:     info.Username,
		UsedDisplay:  info.UsedDisplay,
		TotalDisplay: info.TotalDisplay,
		FreeDisplay:  info.FreeDisplay,
		Percent:      info.Percent,
		FreePercent:  info.FreePercent,
		Breakdown:    info.Breakdown,
		Status:       status,
	}
}

func renderStorageHTML() string {
	body := `
<div class="account-storage-popup" data-drag-region>
  <button class="account-storage-popup-download-btn" id="storage-download" type="button" aria-label="handrive.exe 다운로드" title="handrive.exe 다운로드">
    <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="10" y1="3" x2="10" y2="12.5"></line><polyline points="6.5,9.5 10,13 13.5,9.5"></polyline><path d="M4 15.5h12"></path></svg>
  </button>
  <div class="account-storage-popup-header">
    <span class="account-storage-popup-title">총 사용 용량</span>
    <span class="account-storage-popup-used" id="storage-used">-</span>
    <span class="account-storage-popup-sep"> / </span>
    <span class="account-storage-popup-total" id="storage-total">-</span>
  </div>
  <div class="account-storage-popup-bar" id="storage-bar"></div>
  <div class="account-storage-popup-legend" id="storage-legend"></div>
</div>`
	script := `
const usedEl = document.getElementById('storage-used');
const totalEl = document.getElementById('storage-total');
const barEl = document.getElementById('storage-bar');
const legendEl = document.getElementById('storage-legend');

function renderStorage(payload) {
  if (!payload || !payload.used_display) {
    usedEl.textContent = "로그인 필요";
    totalEl.textContent = "";
    legendEl.innerHTML = "";
    barEl.innerHTML = "";
    if (window.handriveSetPopupSize) {
      requestAnimationFrame(() => window.handriveSetPopupSize(304, 132));
    }
    return;
  }
  usedEl.textContent = payload.used_display;
  totalEl.textContent = payload.total_display;
  barEl.innerHTML = "";
  legendEl.innerHTML = "";
  const usedSeg = document.createElement('div');
  usedSeg.className = 'account-storage-popup-bar-seg account-storage-popup-bar-fill';
  usedSeg.style.width = Math.max(payload.percent || 0, 0) + '%';
  barEl.appendChild(usedSeg);
  (payload.breakdown || []).forEach(item => {
    const row = document.createElement('div');
    row.className = 'account-storage-popup-legend-item';
    row.innerHTML = '<span class="account-storage-popup-legend-dot"></span><span class="account-storage-popup-legend-text"></span>';
    row.querySelector('.account-storage-popup-legend-dot').style.background = item.color;
    row.querySelector('.account-storage-popup-legend-text').textContent = item.label + ' (' + item.display + ')';
    legendEl.appendChild(row);
  });

  const freeRow = document.createElement('div');
  freeRow.className = 'account-storage-popup-legend-item';
  freeRow.innerHTML = '<span class="account-storage-popup-legend-dot account-storage-popup-legend-dot-free"></span><span class="account-storage-popup-legend-text"></span>';
  freeRow.querySelector('.account-storage-popup-legend-text').textContent = '여유 공간 (' + payload.free_display + ')';
  legendEl.appendChild(freeRow);
  if (window.handriveSetPopupSize) {
    requestAnimationFrame(() => window.handriveSetPopupSize(304, 154));
  }
}

document.getElementById('storage-download').addEventListener('click', () => window.handriveOpenDownload());
window.handriveApplyStorage = renderStorage;
window.handriveInitStorage().then(renderStorage);
`
	return popupHTML(popupTemplateData{
		BodyHTML:          template.HTML(body),
		Script:            template.JS(script),
		HeaderHidden:      true,
		BareBody:          true,
		DisableAutoResize: true,
	})
}

func OpenStoragePopup() {
	openWebPopup(&storagePopup, "HanDrive 용량", 304, 154, false, func(w webview2.WebView, hwnd uintptr) error {
		_ = hwnd
		if err := w.Bind("handriveBeginDrag", func() error {
			nBeginWindowDrag(uintptr(w.Window()))
			return nil
		}); err != nil {
			return err
		}
		if err := w.Bind("handriveClose", func() error {
			closeWebPopup(&storagePopup)
			return nil
		}); err != nil {
			return err
		}
		if err := w.Bind("handriveOpenDownload", func() error {
			cfg, _ := config.Load()
			serverURL := "https://www.hanplanet.com"
			if cfg != nil && strings.TrimSpace(cfg.ServerURL) != "" {
				serverURL = strings.TrimRight(cfg.ServerURL, "/")
			}
			api.OpenBrowser(serverURL + "/sync-client/handrive.exe")
			return nil
		}); err != nil {
			return err
		}
		if err := w.Bind("handriveInitStorage", func() (storagePopupData, error) {
			return storageState(""), nil
		}); err != nil {
			return err
		}
		if err := w.Bind("handriveRefreshStorage", func() (storagePopupData, error) {
			RefreshUserInfoNow()
			cfg, err := config.Load()
			if err != nil {
				return storagePopupData{Status: "설정을 먼저 확인해 주세요."}, nil
			}
			client := api.NewClient(cfg.ServerURL, config.TokensPath())
			info, err := client.GetMe()
			if err != nil {
				return storagePopupData{Status: "용량 정보를 불러오지 못했습니다: " + err.Error()}, nil
			}
			setCachedUserInfo(info)
			return storageState("최신 용량을 불러왔습니다."), nil
		}); err != nil {
			return err
		}
		w.SetHtml(renderStorageHTML())
		return nil
	})
}

func TrayStorageText(info *api.UserInfo) string {
	if info == nil {
		return "용량: 로딩 중..."
	}
	pct := int(math.Round(info.Percent))
	filled := pct / 10
	bar := strings.Repeat("█", filled) + strings.Repeat("░", 10-filled)
	return fmt.Sprintf("%s %s / %s", bar, info.UsedDisplay, info.TotalDisplay)
}
