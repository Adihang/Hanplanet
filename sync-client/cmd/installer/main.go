//go:build windows

package main

import (
	_ "embed"
	"os/exec"
)

//go:embed handrive.exe
var handsyncBinary []byte

//go:embed uninstall.ps1
var uninstallScript []byte

func main() {
	exec.Command("cmd", "/c", "chcp 65001").Run()
	RunWizard()
}
