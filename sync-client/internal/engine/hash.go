// Package engine은 sync 결정 로직과 유틸리티를 제공합니다.
package engine

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
)

// HashFile은 파일의 SHA-256 hex digest를 반환합니다.
func HashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// RelPath는 syncDir 기준 상대 경로를 슬래시 구분자로 반환합니다.
// 예) syncDir="C:\Hanplanet", absPath="C:\Hanplanet\docs\a.txt" → "docs/a.txt"
func RelPath(syncDir, absPath string) string {
	rel, err := filepath.Rel(syncDir, absPath)
	if err != nil {
		return filepath.ToSlash(absPath)
	}
	return filepath.ToSlash(rel)
}

// AbsPath는 syncDir + relPath → 절대 경로를 반환합니다.
func AbsPath(syncDir, relPath string) string {
	return filepath.Join(syncDir, filepath.FromSlash(relPath))
}
