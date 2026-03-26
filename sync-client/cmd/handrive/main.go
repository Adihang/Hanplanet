//go:build windows

// HanDrive — Hanplanet 클라우드 드라이브 동기화 클라이언트 (GUI)
//
// 시스템 트레이에서 실행됩니다.
// 우클릭 메뉴: 열기 | 설정 | 종료
package main

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"sync"

	"github.com/getlantern/systray"
)

var (
	mu           sync.Mutex
	cancelDaemon context.CancelFunc
)

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

	// 동기화 데몬 시작
	startDaemon()

	// 트레이 설정 (설정 저장 시 데몬 재시작 콜백 전달)
	setupTray(exePath, func() {
		log.Println("[main] settings saved → restarting daemon")
		mu.Lock()
		if cancelDaemon != nil {
			cancelDaemon()
		}
		mu.Unlock()
		startDaemon()
	})
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
