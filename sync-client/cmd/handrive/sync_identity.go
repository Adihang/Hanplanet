//go:build windows

package main

import (
	"log"
	"os"
	"path/filepath"
	"strings"

	"hanplanet/handsync/internal/api"
	"hanplanet/handsync/internal/config"
	"hanplanet/handsync/internal/db"
)

func resolveCurrentUsername(cfg *config.Config) string {
	if info := getCachedUserInfo(); info != nil && strings.TrimSpace(info.Username) != "" {
		return strings.TrimSpace(info.Username)
	}
	client := api.NewClient(cfg.ServerURL, config.TokensPath())
	info, err := client.GetMe()
	if err != nil {
		log.Printf("[sync-user] GetMe failed while resolving username: %v", err)
		return ""
	}
	setCachedUserInfo(info)
	return strings.TrimSpace(info.Username)
}

func resolveEffectiveSyncDir(cfg *config.Config) string {
	if cfg == nil {
		return ""
	}
	username := resolveCurrentUsername(cfg)
	return config.ResolveUserSyncDir(cfg.SyncDir, username)
}

func ensureEffectiveSyncDir(cfg *config.Config) string {
	effective := resolveEffectiveSyncDir(cfg)
	if strings.TrimSpace(effective) == "" {
		effective = config.NormalizeSyncRoot(cfg.SyncDir)
	}
	if err := os.MkdirAll(effective, 0755); err != nil {
		log.Printf("[sync-user] mkdir failed path=%s err=%v", effective, err)
	}
	return effective
}

func ensureSyncIdentity(database *db.DB, mode, username string) {
	username = strings.TrimSpace(username)
	if username == "" || database == nil {
		return
	}
	savedUsername, _ := database.GetMeta("sync_username")
	if savedUsername == username {
		return
	}
	log.Printf("[daemon] sync user changed: %q -> %q, resetting local sync state", savedUsername, username)
	if err := database.ResetForModeSwitch(mode); err != nil {
		log.Printf("[daemon] user switch reset error: %v", err)
		return
	}
	if err := database.SetMeta("sync_username", username); err != nil {
		log.Printf("[daemon] failed to persist sync username %q: %v", username, err)
	}
}

func effectiveLogDir(exePath string) string {
	return filepath.Join(filepath.Dir(exePath), "logs")
}
