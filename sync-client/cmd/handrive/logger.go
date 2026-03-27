//go:build windows

package main

import (
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var currentLogFile *os.File

const logRetentionDays = 7

// setupLogger는 <exeDir>/logs/handrive-YYYY-MM-DD.log 파일로 로그를 씁니다.
// 자정에 자동으로 새 파일로 전환합니다.
func setupLogger(exeDir string) {
	rotateLog(exeDir)
	go midnightRotator(exeDir)
}

func rotateLog(exeDir string) {
	logDir := filepath.Join(exeDir, "logs")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return
	}
	pruneOldLogs(logDir)
	today := time.Now().Format("2006-01-02")
	logPath := filepath.Join(logDir, "handrive-"+today+".log")

	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return
	}
	if currentLogFile != nil {
		currentLogFile.Close()
	}
	currentLogFile = f
	log.SetOutput(f)
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Printf("[logger] log file: %s", logPath)
}

func pruneOldLogs(logDir string) {
	entries, err := os.ReadDir(logDir)
	if err != nil {
		return
	}
	cutoff := time.Now().AddDate(0, 0, -(logRetentionDays - 1))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasPrefix(name, "handrive-") || !strings.HasSuffix(name, ".log") {
			continue
		}
		datePart := strings.TrimSuffix(strings.TrimPrefix(name, "handrive-"), ".log")
		logDate, err := time.Parse("2006-01-02", datePart)
		if err != nil {
			continue
		}
		if logDate.Before(time.Date(cutoff.Year(), cutoff.Month(), cutoff.Day(), 0, 0, 0, 0, cutoff.Location())) {
			_ = os.Remove(filepath.Join(logDir, name))
		}
	}
}

func midnightRotator(exeDir string) {
	for {
		now := time.Now()
		next := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 1, 0, now.Location())
		time.Sleep(time.Until(next))
		rotateLog(exeDir)
	}
}
