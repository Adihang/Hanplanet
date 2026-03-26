//go:build windows

package main

import (
	"context"
	"fmt"
	"html/template"
	"log"
	"math"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"hanplanet/handsync/internal/api"
	"hanplanet/handsync/internal/config"
)

// ── 유저 정보 캐시 ──────────────────────────────────────────────────────────

var (
	userInfoMu     sync.RWMutex
	cachedUserInfo *api.UserInfo
	storageOpen    atomic.Bool
)

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

// StartUserInfoRefresher는 백그라운드에서 주기적으로 유저 정보를 갱신합니다.
// tray 아이템 업데이트 콜백을 전달받습니다.
func StartUserInfoRefresher(updateTray func(*api.UserInfo)) {
	refresh := func() {
		cfg, err := config.Load()
		if err != nil {
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
	}

	// 즉시 한 번 실행
	go refresh()

	// 5분마다 갱신
	go func() {
		t := time.NewTicker(5 * time.Minute)
		defer t.Stop()
		for range t.C {
			refresh()
		}
	}()
}

// ── 스토리지 팝업 ──────────────────────────────────────────────────────────

var storagePopupTmpl = template.Must(template.New("sp").Funcs(template.FuncMap{
	"barWidth": func(pct float64) string {
		// 0~100 → "0"~"100"
		v := math.Max(0, math.Min(100, pct))
		if v == 0 {
			return "0"
		}
		return fmt.Sprintf("%.2f", v)
	},
	"pctInt": func(pct float64) int {
		return int(math.Round(pct))
	},
}).Parse(storagePopupHTML))

// OpenStoragePopup는 용량 현황 팝업을 브라우저로 엽니다.
func OpenStoragePopup() {
	if !storageOpen.CompareAndSwap(false, true) {
		return
	}

	info := getCachedUserInfo()
	if info == nil {
		storageOpen.Store(false)
		return
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		storageOpen.Store(false)
		return
	}
	port := ln.Addr().(*net.TCPAddr).Port

	mux := http.NewServeMux()
	srv := &http.Server{Handler: mux}

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		storagePopupTmpl.Execute(w, getCachedUserInfo())
	})
	mux.HandleFunc("/close", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
		go func() {
			srv.Shutdown(context.Background())
			storageOpen.Store(false)
		}()
	})

	go func() {
		srv.Serve(ln)
		storageOpen.Store(false)
	}()

	api.OpenBrowser(fmt.Sprintf("http://127.0.0.1:%d/", port))
}

// ── 팝업 HTML ─────────────────────────────────────────────────────────────

const storagePopupHTML = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HanDrive 용량</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,"Segoe UI",sans-serif;background:transparent;display:flex;justify-content:center;align-items:flex-start;padding:0;min-height:100vh}
.popup{background:#fff;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.18);width:320px;padding:0;overflow:hidden;margin:20px auto}
.popup-header{background:#0055b8;padding:18px 20px 14px;color:#fff}
.popup-title{font-size:12px;font-weight:600;opacity:.75;letter-spacing:.5px;text-transform:uppercase}
.popup-used{font-size:22px;font-weight:800;margin-top:4px}
.popup-total{font-size:13px;opacity:.8;margin-top:2px}
.popup-body{padding:16px 20px 20px}
.bar-wrap{height:10px;background:#e8edf5;border-radius:99px;overflow:hidden;display:flex;margin-bottom:16px}
.bar-seg{height:100%;border-radius:0;transition:width .3s}
.bar-free{background:#e8edf5}
.legend{display:flex;flex-direction:column;gap:8px}
.legend-item{display:flex;align-items:center;gap:10px}
.legend-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.legend-dot-free{background:#e8edf5;border:1.5px solid #c0ccd8}
.legend-text{font-size:13px;color:#333;flex:1}
.legend-size{font-size:12px;color:#888;text-align:right}
.pct-badge{font-size:11px;color:#fff;background:rgba(255,255,255,.22);border-radius:99px;padding:1px 7px;margin-left:6px;font-weight:600}
.close-btn{display:block;width:100%;padding:11px;background:#f4f7fb;border:none;border-top:1px solid #e8edf5;cursor:pointer;font-size:13px;color:#666;font-family:inherit;transition:.15s}
.close-btn:hover{background:#e8edf5;color:#333}
</style>
</head>
<body>
<div class="popup">
  <div class="popup-header">
    <div class="popup-title">{{.Username}} · 용량 현황</div>
    <div class="popup-used">{{.UsedDisplay}}<span class="pct-badge">{{pctInt .Percent}}%</span></div>
    <div class="popup-total">/ {{.TotalDisplay}} 사용 중 · 여유 {{.FreeDisplay}}</div>
  </div>
  <div class="popup-body">
    <div class="bar-wrap">
      {{range .Breakdown}}<div class="bar-seg" style="width:{{barWidth .Percent}}%;background:{{.Color}}"></div>{{end}}
      <div class="bar-seg bar-free" style="width:{{barWidth .FreePercent}}%"></div>
    </div>
    <div class="legend">
      {{range .Breakdown}}
      <div class="legend-item">
        <span class="legend-dot" style="background:{{.Color}}"></span>
        <span class="legend-text">{{.Label}}</span>
        <span class="legend-size">{{.Display}}</span>
      </div>
      {{end}}
      <div class="legend-item">
        <span class="legend-dot legend-dot-free"></span>
        <span class="legend-text">여유 공간</span>
        <span class="legend-size">{{.FreeDisplay}}</span>
      </div>
    </div>
  </div>
  <button class="close-btn" onclick="fetch('/close');setTimeout(()=>window.close(),100)">닫기</button>
</div>
</body>
</html>`

// TrayStorageText는 트레이에 표시할 용량 텍스트를 반환합니다.
func TrayStorageText(info *api.UserInfo) string {
	if info == nil {
		return "용량: 로딩 중..."
	}
	pct := int(math.Round(info.Percent))
	// 10칸 ASCII 바
	filled := pct / 10
	bar := strings.Repeat("█", filled) + strings.Repeat("░", 10-filled)
	return fmt.Sprintf("%s  %s / %s", bar, info.UsedDisplay, info.TotalDisplay)
}
