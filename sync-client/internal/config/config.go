// Package config는 sync root 상위의 .handsync/config.json 설정 파일을 관리합니다.
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Config는 handsync 클라이언트 설정입니다.
type Config struct {
	ServerURL           string `json:"server_url"`            // Django API 서버 URL
	SyncDir             string `json:"sync_dir"`              // 로컬 동기화 폴더 (SSD/HDD 모드와 무관하게 고정)
	PollIntervalSeconds int    `json:"poll_interval_seconds"` // 폴링 간격 (기본 30초)
}

// DefaultConfigDir는 설정 파일이 저장되는 기본 디렉토리입니다.
func DefaultConfigDir() string {
	return resolveConfigDir()
}

func userHomeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "."
	}
	return home
}

func legacyConfigDir() string {
	return filepath.Join(userHomeDir(), ".handsync")
}

func locatorPath() string {
	return filepath.Join(userHomeDir(), ".handsync-location")
}

func DefaultSyncRoot() string {
	return filepath.Join(userHomeDir(), "Hanplanet")
}

func ConfigDirForSyncRoot(syncRoot string) string {
	root := NormalizeSyncRoot(syncRoot)
	if strings.TrimSpace(root) == "" || root == "." {
		root = DefaultSyncRoot()
	}
	return filepath.Join(root, ".handsync")
}

func resolveConfigDir() string {
	if path := strings.TrimSpace(os.Getenv("HANDRIVE_CONFIG_DIR")); path != "" {
		return filepath.Clean(path)
	}
	if data, err := os.ReadFile(locatorPath()); err == nil {
		if path := strings.TrimSpace(string(data)); path != "" {
			return filepath.Clean(path)
		}
	}
	defaultDir := ConfigDirForSyncRoot(DefaultSyncRoot())
	if _, err := os.Stat(filepath.Join(defaultDir, "config.json")); err == nil {
		return defaultDir
	}
	legacyDir := legacyConfigDir()
	if _, err := os.Stat(filepath.Join(legacyDir, "config.json")); err == nil {
		return legacyDir
	}
	return defaultDir
}

func writeLocator(dir string) error {
	if err := os.WriteFile(locatorPath(), []byte(filepath.Clean(dir)), 0600); err != nil {
		return err
	}
	return nil
}

func migrateStateFiles(oldDir, newDir string) {
	if oldDir == "" || newDir == "" {
		return
	}
	if filepath.Clean(oldDir) == filepath.Clean(newDir) {
		return
	}
	for _, name := range []string{"tokens.json", "handsync.db"} {
		oldPath := filepath.Join(oldDir, name)
		newPath := filepath.Join(newDir, name)
		if _, err := os.Stat(oldPath); err != nil {
			continue
		}
		if _, err := os.Stat(newPath); err == nil {
			continue
		}
		_ = os.Rename(oldPath, newPath)
	}
}

// ConfigPath는 설정 파일 경로입니다.
func ConfigPath() string {
	return filepath.Join(DefaultConfigDir(), "config.json")
}

// TokensPath는 토큰 파일 경로입니다. (비밀번호 저장 금지)
func TokensPath() string {
	return filepath.Join(DefaultConfigDir(), "tokens.json")
}

// Load는 설정 파일을 읽어 Config를 반환합니다.
func Load() (*Config, error) {
	path := ConfigPath()
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("config file not found at %s: %w", path, err)
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("invalid config JSON: %w", err)
	}
	if cfg.ServerURL == "" {
		return nil, fmt.Errorf("server_url is required in config")
	}
	if cfg.SyncDir == "" {
		return nil, fmt.Errorf("sync_dir is required in config")
	}
	if cfg.PollIntervalSeconds <= 0 {
		cfg.PollIntervalSeconds = 30
	}
	return &cfg, nil
}

// Save는 Config를 파일에 저장합니다.
func Save(cfg *Config) error {
	targetDir := ConfigDirForSyncRoot(cfg.SyncDir)
	previousDir := resolveConfigDir()
	if err := os.MkdirAll(targetDir, 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(targetDir, "config.json"), data, 0600); err != nil {
		return err
	}
	migrateStateFiles(previousDir, targetDir)
	return writeLocator(targetDir)
}

// WriteDefault는 기본 설정 파일 예시를 생성합니다.
func WriteDefault(serverURL, syncDir string) error {
	cfg := &Config{
		ServerURL:           serverURL,
		SyncDir:             NormalizeSyncRoot(syncDir),
		PollIntervalSeconds: 30,
	}
	return Save(cfg)
}

func NormalizeSyncRoot(syncDir string) string {
	cleaned := filepath.Clean(strings.TrimSpace(syncDir))
	if cleaned == "." || cleaned == "" {
		return cleaned
	}
	parent := filepath.Base(filepath.Dir(cleaned))
	if strings.EqualFold(parent, "HanDrive") {
		return filepath.Dir(cleaned)
	}
	return cleaned
}

func ResolveUserSyncDir(syncRoot, username string) string {
	root := NormalizeSyncRoot(syncRoot)
	if strings.TrimSpace(username) == "" {
		return root
	}
	return filepath.Join(root, username)
}
