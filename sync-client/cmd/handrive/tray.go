//go:build windows

package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/getlantern/systray"
	"hanplanet/handsync/internal/api"
	"hanplanet/handsync/internal/config"
)

// 트레이 메뉴 아이템 (storage.go 에서 텍스트 갱신에 사용)
var (
	trayAccount *systray.MenuItem
	trayStorage *systray.MenuItem
)

// setupTray는 시스템 트레이 아이콘과 메뉴를 초기화합니다.
// onSettingsSaved: 설정 저장 시 호출 (데몬 재시작 트리거)
func setupTray(exePath string, onSettingsSaved func()) {
	systray.SetIcon(appIcon)
	systray.SetTitle("HanDrive")
	systray.SetTooltip("HanDrive — 동기화 중")
	systray.SetOnTrayLeftClick(func() {
		toggleTrayMenuPopup(exePath, onSettingsSaved)
	})
	systray.SetOnTrayRightClick(func() {
		toggleTrayMenuPopup(exePath, onSettingsSaved)
	})

	// ── 계정 정보 (상단 고정) ──────────────────────────────────────────────
	trayAccount = systray.AddMenuItem("로그인 중...", "")
	trayAccount.Disable() // 클릭 불가 — 계정 아이디 표시용

	trayStorage = systray.AddMenuItem("용량: 로딩 중...", "용량 현황 보기")
	setTrayMenuState("로그인 중...", "용량: 로딩 중...")

	systray.AddSeparator()

	// ── 주요 동작 ──────────────────────────────────────────────────────────
	mOpen := systray.AddMenuItem("열기", "동기화 폴더를 탐색기로 열기")
	mLogs := systray.AddMenuItem("로그", "로그 폴더를 탐색기로 열기")
	mSyncView := systray.AddMenuItem("동기화", "아직 동기화되지 않은 파일 보기")
	mWebOpen := systray.AddMenuItem("웹으로 열기", "hanplanet.com/handrive 열기")

	systray.AddSeparator()

	mSettings := systray.AddMenuItem("설정", "서버·폴더·계정 설정")

	systray.AddSeparator()

	mQuit := systray.AddMenuItem("종료", "HanDrive 종료")

	// ── 유저 정보 주기적 갱신 ──────────────────────────────────────────────
	StartUserInfoRefresher(func(info *api.UserInfo) {
		if info == nil {
			return
		}
		accountTitle := info.Username
		storageTitle := TrayStorageText(info)
		trayAccount.SetTitle(accountTitle)
		trayStorage.SetTitle(storageTitle)
		setTrayMenuState(accountTitle, storageTitle)
		systray.SetTooltip(fmt.Sprintf("HanDrive — %s · %s / %s",
			info.Username, info.UsedDisplay, info.TotalDisplay))
	})

	// ── 이벤트 루프 ────────────────────────────────────────────────────────
	go func() {
		for {
			select {
			case <-mOpen.ClickedCh:
				openLocalFolder()

			case <-mLogs.ClickedCh:
				openLogFolder(exePath)

			case <-mSyncView.ClickedCh:
				OpenSyncStatusPopup()

			case <-mWebOpen.ClickedCh:
				cfg, _ := config.Load()
				if cfg != nil && cfg.ServerURL != "" {
					api.OpenBrowser(cfg.ServerURL + "/handrive")
				} else {
					api.OpenBrowser("https://www.hanplanet.com/handrive")
				}

			case <-trayStorage.ClickedCh:
				OpenStoragePopup()

			case <-mSettings.ClickedCh:
				openSettings(exePath, onSettingsSaved)

			case <-mQuit.ClickedCh:
				log.Println("[tray] quit requested")
				systray.Quit()
				return
			}
		}
	}()
}

// openLocalFolder는 설정된 동기화 폴더를 Windows 탐색기로 엽니다.
func openLocalFolder() {
	cfg, err := config.Load()
	if err != nil || cfg.SyncDir == "" {
		log.Printf("[tray] sync dir not configured: %v", err)
		return
	}
	dir := filepath.FromSlash(ensureEffectiveSyncDir(cfg))
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		if mkErr := os.MkdirAll(dir, 0755); mkErr != nil {
			log.Printf("[tray] cannot create sync dir: %v", mkErr)
			return
		}
	}
	if err := api.OpenPath(dir); err != nil {
		log.Printf("[tray] explorer error: %v", err)
	}
}

func openLogFolder(exePath string) {
	logDir := effectiveLogDir(exePath)
	if err := os.MkdirAll(logDir, 0755); err != nil {
		log.Printf("[tray] cannot create log dir: %v", err)
		return
	}
	if err := api.OpenPath(logDir); err != nil {
		log.Printf("[tray] log explorer error: %v", err)
	}
}
