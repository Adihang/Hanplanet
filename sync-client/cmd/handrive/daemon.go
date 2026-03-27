//go:build windows

package main

import (
	"context"
	"errors"
	"log"
	"os"
	"sync/atomic"
	"time"

	"hanplanet/handsync/internal/api"
	"hanplanet/handsync/internal/config"
	"hanplanet/handsync/internal/db"
	"hanplanet/handsync/internal/engine"
	"hanplanet/handsync/internal/progress"
	"hanplanet/handsync/internal/queue"
	"hanplanet/handsync/internal/watcher"
)

const modeCheckInterval = 60 * time.Second

var daemonWaitingForConfig atomic.Bool
var transferProgress = progress.NewStore()

// runDaemon은 sync 루프를 실행합니다.
// ctx가 취소되면 정상 종료합니다.
// config가 없으면 10초마다 재시도합니다 (설정 완료 대기).
func runDaemon(ctx context.Context) {
	for {
		cfg, err := config.Load()
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				if daemonWaitingForConfig.CompareAndSwap(false, true) {
					log.Printf("[daemon] config not ready yet, waiting for initial setup")
				}
			} else {
				log.Printf("[daemon] config load error: %v", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(10 * time.Second):
				continue
			}
		}
		daemonWaitingForConfig.Store(false)

		database, err := db.Open(config.DefaultConfigDir())
		if err != nil {
			log.Printf("[daemon] db open failed: %v", err)
			return
		}

		apiClient := api.NewClient(cfg.ServerURL, config.TokensPath())
		currentMode := fetchMode(apiClient, database)
		username := resolveCurrentUsername(cfg)
		effectiveSyncDir := ensureEffectiveSyncDir(cfg)
		ensureSyncIdentity(database, currentMode, username)
		log.Printf("[daemon] starting — mode=%q sync_root=%s sync_dir=%s username=%s", currentMode, cfg.SyncDir, effectiveSyncDir, username)

		for {
			select {
			case <-ctx.Done():
				database.Close()
				return
			default:
			}

			newMode := syncSession(ctx, cfg, apiClient, database, effectiveSyncDir, currentMode)
			if ctx.Err() != nil {
				database.Close()
				return
			}
			if newMode == currentMode {
				database.Close()
				return
			}

			log.Printf("[daemon] storage mode changed: %q → %q  resetting db...", currentMode, newMode)
			if err := database.ResetForModeSwitch(newMode); err != nil {
				log.Printf("[daemon] db reset error: %v", err)
			}
			currentMode = newMode
		}
	}
}

// syncSession은 지정 syncDir 로 동기화 세션을 실행합니다.
// mode 가 변경되면 새 mode 를 반환합니다.
func syncSession(ctx context.Context, cfg *config.Config, apiClient *api.Client, database *db.DB, syncDir, mode string) string {
	q := queue.New(database)
	eng := engine.New(syncDir, database, apiClient, q, transferProgress)

	if err := eng.InitialSync(); err != nil {
		log.Printf("[session] initial sync error: %v", err)
	}
	eng.ProcessQueue()

	w, err := watcher.New(syncDir, database, q)
	if err != nil {
		log.Printf("[session] watcher create error: %v", err)
		return mode
	}
	if err := w.Start(); err != nil {
		log.Printf("[session] watcher start error: %v", err)
		return mode
	}
	defer w.Close()

	log.Printf("[session] watching %s  poll=%ds  mode=%q", syncDir, cfg.PollIntervalSeconds, mode)

	syncTicker := time.NewTicker(time.Duration(cfg.PollIntervalSeconds) * time.Second)
	defer syncTicker.Stop()
	modeTicker := time.NewTicker(modeCheckInterval)
	defer modeTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return mode
		case <-syncTicker.C:
			eng.ProcessQueue()
			if err := eng.PollChanges(); err != nil {
				log.Printf("[session] poll error: %v", err)
			}
		case <-modeTicker.C:
			newMode, err := apiClient.GetStorageMode()
			if err != nil {
				log.Printf("[session] mode check failed: %v", err)
				continue
			}
			if newMode != mode {
				log.Printf("[session] server mode changed: %q → %q", mode, newMode)
				return newMode
			}
		}
	}
}

func fetchMode(apiClient *api.Client, database *db.DB) string {
	mode, err := apiClient.GetStorageMode()
	if err != nil {
		log.Printf("[daemon] storage mode fetch failed: %v", err)
		saved, _ := database.GetMeta("storage_mode")
		if saved != "" {
			log.Printf("[daemon] using last known mode: %q", saved)
			return saved
		}
		return ""
	}
	saved, _ := database.GetMeta("storage_mode")
	if saved != mode {
		if saved != "" {
			log.Printf("[daemon] startup mode mismatch (db=%q server=%q): resetting", saved, mode)
			database.ResetForModeSwitch(mode)
		} else {
			database.SetMeta("storage_mode", mode)
		}
	}
	return mode
}
