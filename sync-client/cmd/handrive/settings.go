//go:build windows

package main

import (
	"context"
	"fmt"
	"html/template"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync/atomic"

	"hanplanet/handsync/internal/api"
	"hanplanet/handsync/internal/config"
)

var settingsOpen atomic.Bool

var settingsTmpl = template.Must(template.New("s").Parse(settingsHTML))

const settingsHTML = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HanDrive 설정</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,"Segoe UI",sans-serif;background:#eef2f7;min-height:100vh;display:flex;justify-content:center;align-items:flex-start;padding:48px 16px}
.card{background:#fff;border-radius:14px;box-shadow:0 6px 32px rgba(0,0,0,.10);width:100%;max-width:460px;overflow:hidden}
.card-header{background:#0055b8;padding:28px 28px 20px;color:#fff}
.card-header h1{font-size:20px;font-weight:700;letter-spacing:-.3px}
.card-header p{font-size:13px;opacity:.75;margin-top:4px}
.card-body{padding:28px}
.field{margin-bottom:20px}
.field label{display:block;font-size:12px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.6px;margin-bottom:7px}
.field input{width:100%;padding:11px 14px;border:1.5px solid #dde3ed;border-radius:9px;font-size:14px;color:#222;transition:border .2s,box-shadow .2s}
.field input:focus{outline:none;border-color:#0055b8;box-shadow:0 0 0 3px rgba(0,85,184,.12)}
.divider{height:1px;background:#f0f3f8;margin:24px 0}
.account-box{display:flex;align-items:center;gap:14px;padding:14px;background:#f4f7fb;border-radius:10px}
.avatar{width:40px;height:40px;background:#0055b8;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:800;color:#fff;flex-shrink:0}
.account-info{flex:1;min-width:0}
.account-name{font-size:14px;font-weight:600;color:#1a1a2e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.account-sub{font-size:12px;color:#888;margin-top:1px}
.relogin-btn{font-size:12px;color:#0055b8;text-decoration:none;font-weight:600;padding:6px 12px;border:1.5px solid #0055b8;border-radius:7px;white-space:nowrap;transition:.15s}
.relogin-btn:hover{background:#0055b8;color:#fff}
.save-btn{width:100%;padding:13px;background:#0055b8;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;margin-top:4px;letter-spacing:-.2px;transition:.15s}
.save-btn:hover{background:#0044a0}
.toast{display:none;margin-top:14px;padding:11px 14px;background:#e8f5e9;border-radius:9px;font-size:13px;color:#2e7d32;font-weight:600}
.toast.show{display:block}
.status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#28a745;margin-right:6px;vertical-align:middle}
</style>
</head>
<body>
<div class="card">
  <div class="card-header">
    <h1>HanDrive 설정</h1>
    <p>Hanplanet 클라우드 드라이브 동기화 클라이언트</p>
  </div>
  <div class="card-body">
    <form method="POST" action="/settings/save">
      <div class="field">
        <label>서버 URL</label>
        <input type="text" name="server_url" value="{{.ServerURL}}" placeholder="https://www.hanplanet.com">
      </div>
      <div class="field">
        <label>동기화 폴더</label>
        <input type="text" name="sync_dir" value="{{.SyncDir}}" placeholder="C:\Users\user\HanDrive">
      </div>
      <div class="divider"></div>
      <div class="field">
        <label>계정</label>
        <div class="account-box">
          <div class="avatar">H</div>
          <div class="account-info">
            <div class="account-name">{{if .ServerURL}}{{.ServerURL}}{{else}}서버 미설정{{end}}</div>
            <div class="account-sub"><span class="status-dot"></span>동기화 중</div>
          </div>
          <a class="relogin-btn" href="/settings/relogin">다시 로그인</a>
        </div>
      </div>
      <button type="submit" class="save-btn">저장</button>
    </form>
    <div class="toast{{if .Saved}} show{{end}}">✓ 저장되었습니다. 동기화가 재시작됩니다.</div>
  </div>
</div>
</body>
</html>`

type settingsData struct {
	ServerURL string
	SyncDir   string
	Saved     bool
}

// openSettings는 로컬 HTTP 서버를 시작하고 기본 브라우저로 설정 페이지를 엽니다.
// 동시에 하나만 열립니다.
func openSettings(exePath string, onSaved func()) {
	if !settingsOpen.CompareAndSwap(false, true) {
		// 이미 열려 있으면 무시
		return
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Printf("[settings] listen error: %v", err)
		settingsOpen.Store(false)
		return
	}
	port := ln.Addr().(*net.TCPAddr).Port

	mux := http.NewServeMux()
	srv := &http.Server{Handler: mux}

	loadData := func() settingsData {
		cfg, _ := config.Load()
		if cfg == nil {
			return settingsData{}
		}
		return settingsData{ServerURL: cfg.ServerURL, SyncDir: cfg.SyncDir}
	}

	// GET /settings
	mux.HandleFunc("/settings", func(w http.ResponseWriter, r *http.Request) {
		settingsTmpl.Execute(w, loadData())
	})

	// POST /settings/save
	mux.HandleFunc("/settings/save", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Redirect(w, r, "/settings", http.StatusFound)
			return
		}
		r.ParseForm()
		serverURL := strings.TrimRight(strings.TrimSpace(r.FormValue("server_url")), "/")
		syncDir := strings.TrimSpace(r.FormValue("sync_dir"))

		d := settingsData{ServerURL: serverURL, SyncDir: syncDir}
		if serverURL != "" && syncDir != "" {
			cfg, _ := config.Load()
			if cfg == nil {
				cfg = &config.Config{PollIntervalSeconds: 30}
			}
			cfg.ServerURL = serverURL
			cfg.SyncDir = syncDir
			if err := config.Save(cfg); err != nil {
				log.Printf("[settings] save error: %v", err)
			} else {
				os.MkdirAll(syncDir, 0755)
				d.Saved = true
				log.Printf("[settings] saved: server=%s sync_dir=%s", serverURL, syncDir)
				if onSaved != nil {
					go onSaved()
				}
			}
		}
		settingsTmpl.Execute(w, d)
	})

	// GET /settings/relogin → 브라우저 OAuth 로그인
	mux.HandleFunc("/settings/relogin", func(w http.ResponseWriter, r *http.Request) {
		cfg, err := config.Load()
		if err != nil || cfg.ServerURL == "" {
			http.Redirect(w, r, "/settings", http.StatusFound)
			return
		}
		serverURL := cfg.ServerURL
		go func() {
			log.Println("[settings] starting browser login")
			if err := api.BrowserLogin(serverURL, config.TokensPath(), true); err != nil {
				log.Printf("[settings] browser login error: %v", err)
			} else {
				log.Println("[settings] browser login success")
			}
		}()
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(`<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><title>HanDrive 로그인</title>
<style>body{font-family:-apple-system,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#eef2f7}
.box{text-align:center;padding:48px 40px;background:#fff;border-radius:16px;box-shadow:0 6px 32px rgba(0,0,0,.10);max-width:380px}
.icon{font-size:48px;margin-bottom:16px}h2{font-size:18px;color:#1a1a2e;margin-bottom:10px}
p{color:#666;font-size:14px;line-height:1.6;margin-bottom:20px}
a{display:inline-block;padding:10px 22px;background:#0055b8;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600}
a:hover{background:#0044a0}</style></head>
<body><div class="box">
<div class="icon">🌐</div>
<h2>브라우저에서 로그인 중...</h2>
<p>브라우저 창이 열렸습니다.<br>Hanplanet 계정으로 로그인하세요.<br><br>로그인 완료 후 설정 창으로 돌아오세요.</p>
<a href="/settings">← 설정으로 돌아가기</a>
</div></body></html>`))
	})

	// GET /settings/close → 서버 종료
	mux.HandleFunc("/settings/close", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("닫을 수 있습니다."))
		go func() {
			srv.Shutdown(context.Background())
			settingsOpen.Store(false)
		}()
	})

	go func() {
		srv.Serve(ln)
		settingsOpen.Store(false)
	}()

	settingsURL := fmt.Sprintf("http://127.0.0.1:%d/settings", port)
	api.OpenBrowser(settingsURL)
	log.Printf("[settings] opened at %s", settingsURL)
}
