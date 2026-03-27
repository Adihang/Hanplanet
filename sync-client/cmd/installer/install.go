//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows/registry"

	"hanplanet/handsync/internal/api"
	"hanplanet/handsync/internal/config"
)

// InstallParams는 설치 파라미터입니다.
type InstallParams struct {
	InstallDir string
	ServerURL  string
	SyncDir    string
	AutoStart  bool
}

// Progress는 진행 상황 콜백입니다. pct=0~100, msg=상태 메시지.
type Progress func(pct int, msg string)

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

func defaultInstallDir() string {
	base := os.Getenv("LocalAppData")
	if strings.TrimSpace(base) == "" {
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, "AppData", "Local")
	}
	return filepath.Join(base, "Hanplanet", "HanDrive")
}

func isAlreadyInstalled(exePath string) bool {
	_, err := os.Stat(exePath)
	return err == nil
}

func stopRunningProcess() {
	exec.Command("taskkill", "/F", "/IM", "handrive.exe").Run()
}

func setAutoStart(exePath string, enabled bool) error {
	k, err := registry.OpenKey(
		registry.CURRENT_USER,
		`Software\Microsoft\Windows\CurrentVersion\Run`,
		registry.QUERY_VALUE|registry.SET_VALUE,
	)
	if err != nil {
		return err
	}
	defer k.Close()
	if !enabled {
		err = k.DeleteValue("HanDrive")
		if err == registry.ErrNotExist {
			return nil
		}
		return err
	}
	return k.SetStringValue("HanDrive", `"`+exePath+`"`)
}

func writeConfig(serverURL, syncDir string) error {
	return config.WriteDefault(strings.TrimRight(serverURL, "/"), syncDir)
}

// ── RunInstall: 신규 설치 ──────────────────────────────────────────────────────

func RunInstall(p InstallParams, report Progress) error {
	exePath := filepath.Join(p.InstallDir, "handrive.exe")

	report(5, "설치 폴더 생성 중...")
	if err := os.MkdirAll(p.InstallDir, 0755); err != nil {
		return fmt.Errorf("설치 폴더 생성 실패: %w", err)
	}

	report(15, "파일 복사 중...")
	if err := os.WriteFile(exePath, handsyncBinary, 0755); err != nil {
		return fmt.Errorf("handrive.exe 복사 실패: %w", err)
	}
	uninstallPath := filepath.Join(p.InstallDir, "uninstall.ps1")
	os.WriteFile(uninstallPath, uninstallScript, 0644)

	report(40, "설정 저장 중...")
	os.MkdirAll(config.NormalizeSyncRoot(p.SyncDir), 0755)
	if err := writeConfig(p.ServerURL, p.SyncDir); err != nil {
		return fmt.Errorf("설정 저장 실패: %w", err)
	}

	report(55, "로그인 중... (브라우저에서 완료해 주세요)")
	if err := api.BrowserLogin(p.ServerURL, config.TokensPath(), false); err != nil {
		report(55, fmt.Sprintf("로그인 경고 (나중에 재시도 가능): %v", err))
	}

	report(75, "자동 시작 설정 중...")
	if err := setAutoStart(exePath, p.AutoStart); err != nil {
		report(75, fmt.Sprintf("자동 시작 설정 경고: %v", err))
	}

	report(100, "설치가 완료되었습니다!")
	return nil
}

// ── RunUpdate: 업데이트 ────────────────────────────────────────────────────────

func RunUpdate(installDir string, report Progress) error {
	exePath := filepath.Join(installDir, "handrive.exe")

	report(10, "실행 중인 HanDrive 종료 중...")
	stopRunningProcess()

	report(45, "파일 교체 중...")
	if err := os.WriteFile(exePath, handsyncBinary, 0755); err != nil {
		return fmt.Errorf("handrive.exe 교체 실패: %w", err)
	}
	uninstallPath := filepath.Join(installDir, "uninstall.ps1")
	os.WriteFile(uninstallPath, uninstallScript, 0644)

	report(85, "동기화 재시작 중...")
	_ = exec.Command(exePath).Start()

	report(100, "업데이트가 완료되었습니다!")
	return nil
}
