//go:build windows

package main

import (
	_ "embed"
	"os"
	"os/exec"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

//go:embed handrive.exe
var handsyncBinary []byte

//go:embed uninstall.ps1
var uninstallScript []byte

// ── UAC ──────────────────────────────────────────────────────────────────────

func isAdmin() bool {
	var sid *windows.SID
	windows.AllocateAndInitializeSid(
		&windows.SECURITY_NT_AUTHORITY, 2,
		windows.SECURITY_BUILTIN_DOMAIN_RID,
		windows.DOMAIN_ALIAS_RID_ADMINS,
		0, 0, 0, 0, 0, 0, &sid,
	)
	defer windows.FreeSid(sid)
	ok, _ := windows.Token(0).IsMember(sid)
	return ok
}

func elevate() {
	exe, _ := os.Executable()
	exePtr, _ := syscall.UTF16PtrFromString(exe)
	verbPtr, _ := syscall.UTF16PtrFromString("runas")
	shell32 := syscall.NewLazyDLL("shell32.dll")
	shell32.NewProc("ShellExecuteW").Call(
		0, uintptr(unsafe.Pointer(verbPtr)), uintptr(unsafe.Pointer(exePtr)),
		0, 0, uintptr(syscall.SW_NORMAL),
	)
	os.Exit(0)
}

func main() {
	exec.Command("cmd", "/c", "chcp 65001").Run()
	if !isAdmin() {
		elevate()
	}
	RunWizard()
}
