//go:build windows

package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"syscall"
	"time"
	"unsafe"
)

// OpenBrowser는 Windows ShellExecuteW를 통해 URL을 기본 브라우저로 엽니다.
// UAC 관리자 권한 상태에서도 정상 동작합니다.
func OpenBrowser(rawURL string) {
	_, _ = shellOpen(rawURL)
}

// OpenPath는 Windows ShellExecuteW를 통해 파일/폴더를 엽니다.
func OpenPath(path string) error {
	_, err := shellOpen(path)
	return err
}

func shellOpen(target string) (uintptr, error) {
	urlPtr, err := syscall.UTF16PtrFromString(target)
	if err != nil {
		return 0, err
	}
	verbPtr, _ := syscall.UTF16PtrFromString("open")
	shell32 := syscall.NewLazyDLL("shell32.dll")
	shellExec := shell32.NewProc("ShellExecuteW")
	ret, _, _ := shellExec.Call(
		0,
		uintptr(unsafe.Pointer(verbPtr)),
		uintptr(unsafe.Pointer(urlPtr)),
		0, 0,
		uintptr(syscall.SW_SHOWNORMAL),
	)
	if ret <= 32 {
		return ret, fmt.Errorf("ShellExecuteW failed with code %d", ret)
	}
	return ret, nil
}

// BrowserLogin은 브라우저를 통한 OAuth-style 로그인을 수행합니다.
//
// forceRelogin=true 이면 서버 세션을 먼저 로그아웃한 뒤 로그인 페이지로 이동합니다.
//
// 흐름:
//  1. 로컬 임시 HTTP 서버 시작 (127.0.0.1:랜덤포트)
//  2. 브라우저로 {serverURL}/login/handrive?callback=...&state=... 오픈
//  3. 서버가 로그인 확인 후 토큰을 콜백 URL로 전달
//  4. 토큰을 tokensPath에 저장
//
// 5분 내에 완료되지 않으면 timeout 에러를 반환합니다.
func BrowserLogin(serverURL, tokensPath string, forceRelogin bool) error {
	// random state (CSRF 방지)
	stateBytes := make([]byte, 16)
	if _, err := rand.Read(stateBytes); err != nil {
		return fmt.Errorf("random state: %w", err)
	}
	state := hex.EncodeToString(stateBytes)

	// 로컬 콜백 서버
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port

	type result struct {
		tokens Tokens
		err    error
	}
	resultCh := make(chan result, 1)

	mux := http.NewServeMux()
	srv := &http.Server{Handler: mux, ReadTimeout: 5 * time.Minute}

	mux.HandleFunc("/auth", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("state") != state {
			http.Error(w, "invalid state", http.StatusBadRequest)
			resultCh <- result{err: fmt.Errorf("state mismatch — 다시 시도해 주세요")}
			return
		}
		t := Tokens{
			AccessToken:  q.Get("access_token"),
			RefreshToken: q.Get("refresh_token"),
		}
		if t.AccessToken == "" || t.RefreshToken == "" {
			http.Error(w, "missing tokens", http.StatusBadRequest)
			resultCh <- result{err: fmt.Errorf("서버에서 토큰이 전달되지 않았습니다")}
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(`<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><title>HanDrive 로그인 완료</title>
<meta name="color-scheme" content="light dark">
<style>
:root{color-scheme:light dark;--bg:#f3f3f3;--card:#ffffff;--text:#111111;--muted:#5f6b7a;--shadow:0 12px 32px rgba(15,23,42,.12)}
@media (prefers-color-scheme: dark){
  :root{--bg:#222222;--card:#2c2c2c;--text:#f5f7fb;--muted:#c8c8c8;--shadow:0 18px 36px rgba(0,0,0,.38)}
}
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;background:var(--bg)}
.box{text-align:center;padding:40px 34px;background:var(--card);border-radius:18px;box-shadow:var(--shadow);max-width:360px;width:100%}
h2{color:var(--text);font-size:22px;line-height:1.2;margin:0 0 12px}
p{color:var(--muted);font-size:14px;line-height:1.7;margin:0}
</style></head>
<body><div class="box">
<h2>로그인 완료!</h2>
<p>HanDrive에 성공적으로 로그인되었습니다.<br>이 창을 닫아도 됩니다.</p>
</div></body></html>`))
		resultCh <- result{tokens: t}
	})

	go func() { srv.Serve(ln) }()

	// 브라우저 열기 (ShellExecuteW — UAC 관리자 환경에서도 동작)
	callbackURL := fmt.Sprintf("http://127.0.0.1:%d/auth", port)
	loginURL := fmt.Sprintf("%s/login/handrive?callback=%s&state=%s",
		serverURL,
		url.QueryEscape(callbackURL),
		url.QueryEscape(state),
	)
	if forceRelogin {
		loginURL += "&force_relogin=1"
	}
	OpenBrowser(loginURL)

	// 결과 대기 (최대 5분)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	defer srv.Shutdown(context.Background())

	select {
	case res := <-resultCh:
		if res.err != nil {
			return res.err
		}
		store := newTokenStore(tokensPath)
		return store.save(res.tokens)
	case <-ctx.Done():
		return fmt.Errorf("로그인 시간 초과 (5분)")
	}
}
