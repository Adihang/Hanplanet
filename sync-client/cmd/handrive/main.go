//go:build windows

// HanDrive — Hanplanet 클라우드 드라이브 동기화 클라이언트 (GUI)
//
// 시스템 트레이에서 실행됩니다.
// 우클릭 메뉴: 열기 | 설정 | 종료
package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"

	"github.com/getlantern/systray"
	"hanplanet/handsync/internal/api"
	"hanplanet/handsync/internal/config"
)

var (
	mu           sync.Mutex
	cancelDaemon context.CancelFunc
)

const defaultServerURL = "https://www.hanplanet.com"

func main() {
	// systray.Run 은 반드시 main goroutine 에서 호출해야 합니다 (Windows OS 요구사항).
	systray.Run(onReady, onExit)
}

func onReady() {
	exePath, err := os.Executable()
	if err != nil {
		exePath = os.Args[0]
	}
	exeDir := filepath.Dir(exePath)

	setupLogger(exeDir)
	log.Println("[main] HanDrive starting")

	restartDaemon := func() {
		log.Println("[main] settings saved → restarting daemon")
		mu.Lock()
		if cancelDaemon != nil {
			cancelDaemon()
		}
		mu.Unlock()
		startDaemon()
	}

	// 트레이 설정 (설정 저장 시 데몬 재시작 콜백 전달)
	setupTray(exePath, restartDaemon)

	cfg, err := ensureInitialConfig()
	if err != nil {
		log.Printf("[main] initial config failed: %v", err)
		openSettings(exePath, restartDaemon)
		return
	}

	if !hasStoredTokens() {
		log.Println("[main] no stored login found → opening browser login")
		go func() {
			if err := api.BrowserLogin(cfg.ServerURL, config.TokensPath(), false); err != nil {
				log.Printf("[main] browser login error: %v", err)
				return
			}
			log.Println("[main] browser login success → refreshing tray and starting daemon")
			RefreshUserInfoNow()
			restartDaemon()
		}()
		return
	}

	startDaemon()
}

func onExit() {
	log.Println("[main] HanDrive exiting")
	mu.Lock()
	if cancelDaemon != nil {
		cancelDaemon()
	}
	mu.Unlock()
	if currentLogFile != nil {
		currentLogFile.Close()
	}
}

func startDaemon() {
	mu.Lock()
	ctx, cancel := context.WithCancel(context.Background())
	cancelDaemon = cancel
	mu.Unlock()
	go runDaemon(ctx)
}

func ensureInitialConfig() (*config.Config, error) {
	cfg, err := config.Load()
	if err == nil {
		return cfg, nil
	}

	home, homeErr := os.UserHomeDir()
	if homeErr != nil {
		return nil, homeErr
	}
	defaultSyncRoot := filepath.Join(home, "Hanplanet")
	if err := os.MkdirAll(defaultSyncRoot, 0755); err != nil {
		return nil, err
	}
	if err := config.WriteDefault(defaultServerURL, defaultSyncRoot); err != nil {
		return nil, err
	}
	log.Printf("[main] created initial config: server=%s sync_root=%s", defaultServerURL, defaultSyncRoot)
	return config.Load()
}

func hasStoredTokens() bool {
	data, err := os.ReadFile(config.TokensPath())
	if err != nil {
		return false
	}
	var tokens struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.Unmarshal(data, &tokens); err != nil {
		return false
	}
	return tokens.AccessToken != "" && tokens.RefreshToken != ""
}
