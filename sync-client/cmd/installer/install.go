//go:build windows

package main

import (
	"encoding/json"
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

func isAlreadyInstalled(exePath string) bool {
	_, err := os.Stat(exePath)
	return err == nil
}

func stopRunningProcess() {
	exec.Command("schtasks", "/End", "/TN", "HanDriveDaemon").Run()
	exec.Command("taskkill", "/F", "/IM", "handrive.exe").Run()
}

func addToSystemPath(dir string) error {
	k, err := registry.OpenKey(
		registry.LOCAL_MACHINE,
		`SYSTEM\CurrentControlSet\Control\Session Manager\Environment`,
		registry.QUERY_VALUE|registry.SET_VALUE,
	)
	if err != nil {
		return err
	}
	defer k.Close()
	current, _, err := k.GetStringValue("Path")
	if err != nil {
		return err
	}
	if strings.Contains(current, dir) {
		return nil
	}
	return k.SetStringValue("Path", current+";"+dir)
}

func registerScheduledTask(exePath string) error {
	return exec.Command("schtasks", "/Create", "/F",
		"/TN", "HanDriveDaemon",
		"/TR", `"`+exePath+`"`,
		"/SC", "ONLOGON",
		"/RL", "LIMITED",
		"/IT",
	).Run()
}

func writeConfig(serverURL, syncDir string) error {
	home, _ := os.UserHomeDir()
	cfgDir := filepath.Join(home, ".handsync")
	if err := os.MkdirAll(cfgDir, 0755); err != nil {
		return err
	}
	cfg := map[string]interface{}{
		"server_url":            strings.TrimRight(serverURL, "/"),
		"sync_dir":              syncDir,
		"poll_interval_seconds": 30,
	}
	data, _ := json.MarshalIndent(cfg, "", "  ")
	return os.WriteFile(filepath.Join(cfgDir, "config.json"), data, 0644)
}

func createShortcut(target, linkPath, desc string) error {
	script := fmt.Sprintf(
		`$ws = New-Object -COM WScript.Shell; `+
			`$s = $ws.CreateShortcut('%s'); `+
			`$s.TargetPath = '%s'; `+
			`$s.Description = '%s'; `+
			`$s.Save()`,
		linkPath, target, desc,
	)
	return exec.Command("powershell", "-NoProfile", "-Command", script).Run()
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

	report(28, "시스템 PATH 등록 중...")
	if err := addToSystemPath(p.InstallDir); err != nil {
		report(28, fmt.Sprintf("PATH 등록 경고 (무시): %v", err))
	}

	report(40, "시작 메뉴 바로가기 생성 중...")
	startMenuDir := filepath.Join(
		os.Getenv("ProgramData"),
		"Microsoft", "Windows", "Start Menu", "Programs", "Hanplanet",
	)
	os.MkdirAll(startMenuDir, 0755)
	createShortcut(exePath, filepath.Join(startMenuDir, "HanDrive.lnk"),
		"HanDrive - Hanplanet 클라우드 드라이브")
	uniScript := fmt.Sprintf(
		`$ws = New-Object -COM WScript.Shell; `+
			`$s = $ws.CreateShortcut('%s'); `+
			`$s.TargetPath = 'powershell.exe'; `+
			`$s.Arguments = '-ExecutionPolicy Bypass -File "%s"'; `+
			`$s.Description = 'HanDrive 제거'; `+
			`$s.Save()`,
		filepath.Join(startMenuDir, "HanDrive 제거.lnk"), uninstallPath,
	)
	exec.Command("powershell", "-NoProfile", "-Command", uniScript).Run()

	report(55, "설정 저장 중...")
	os.MkdirAll(p.SyncDir, 0755)
	if err := writeConfig(p.ServerURL, p.SyncDir); err != nil {
		return fmt.Errorf("설정 저장 실패: %w", err)
	}

	report(65, "로그인 중... (브라우저에서 완료해 주세요)")
	if err := api.BrowserLogin(p.ServerURL, config.TokensPath(), false); err != nil {
		report(65, fmt.Sprintf("로그인 경고 (나중에 재시도 가능): %v", err))
	}

	report(82, "자동 시작 등록 중...")
	if p.AutoStart {
		if err := registerScheduledTask(exePath); err != nil {
			report(82, fmt.Sprintf("자동 시작 등록 경고: %v", err))
		}
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
	exec.Command("schtasks", "/Run", "/TN", "HanDriveDaemon").Run()

	report(100, "업데이트가 완료되었습니다!")
	return nil
}
