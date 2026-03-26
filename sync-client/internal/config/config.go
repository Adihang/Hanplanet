// Package config는 ~/.handsync/config.json 설정 파일을 관리합니다.
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// Config는 handsync 클라이언트 설정입니다.
type Config struct {
	ServerURL           string `json:"server_url"`            // Django API 서버 URL
	SyncDir             string `json:"sync_dir"`              // 로컬 동기화 폴더 (SSD/HDD 모드와 무관하게 고정)
	PollIntervalSeconds int    `json:"poll_interval_seconds"` // 폴링 간격 (기본 30초)
}

// DefaultConfigDir는 설정 파일이 저장되는 기본 디렉토리입니다.
func DefaultConfigDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".handsync"
	}
	return filepath.Join(home, ".handsync")
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
	if err := os.MkdirAll(DefaultConfigDir(), 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(ConfigPath(), data, 0600)
}

// WriteDefault는 기본 설정 파일 예시를 생성합니다.
func WriteDefault(serverURL, syncDir string) error {
	cfg := &Config{
		ServerURL:           serverURL,
		SyncDir:             syncDir,
		PollIntervalSeconds: 30,
	}
	return Save(cfg)
}

