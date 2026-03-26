// Handsync — Hanplanet 클라우드 드라이브 동기화 클라이언트
//
// 사용법:
//
//	handsync login                        — 서버 로그인 (refresh token 저장)
//	handsync init <server_url> <sync_dir> — 기본 config.json 생성
//	handsync                              — 동기화 데몬 실행
package main

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"hanplanet/handsync/internal/api"
	"hanplanet/handsync/internal/config"
	"hanplanet/handsync/internal/db"
	"hanplanet/handsync/internal/engine"
	"hanplanet/handsync/internal/queue"
	"hanplanet/handsync/internal/watcher"
)

// modeCheckInterval 은 서버 storage mode 를 확인하는 주기입니다.
const modeCheckInterval = 60 * time.Second

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)

	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "init":
			cmdInit()
			return
		case "login":
			cmdLogin()
			return
		case "version":
			fmt.Println("handsync v0.1.0")
			return
		}
	}

	runDaemon()
}

// cmdInit은 기본 config.json을 생성합니다.
func cmdInit() {
	if len(os.Args) < 4 {
		fmt.Fprintln(os.Stderr, "usage: handsync init <server_url> <sync_dir>")
		os.Exit(1)
	}
	serverURL := strings.TrimRight(os.Args[2], "/")
	syncDir := os.Args[3]

	if err := config.WriteDefault(serverURL, syncDir); err != nil {
		log.Fatalf("init config: %v", err)
	}
	fmt.Printf("config saved to %s\n", config.ConfigPath())
	fmt.Println("next: handsync login")
}

// cmdLogin은 username/password를 입력받아 tokens.json을 저장합니다.
func cmdLogin() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	reader := bufio.NewReader(os.Stdin)
	fmt.Print("username: ")
	username, _ := reader.ReadString('\n')
	username = strings.TrimSpace(username)

	fmt.Print("password: ")
	password, _ := reader.ReadString('\n')
	password = strings.TrimSpace(password)

	client := api.NewClient(cfg.ServerURL, config.TokensPath())
	if err := client.Login(username, password); err != nil {
		log.Fatalf("login failed: %v", err)
	}
	fmt.Printf("logged in. tokens saved to %s\n", config.TokensPath())
}

// runDaemon은 메인 sync 루프를 실행합니다.
// 서버 storage mode 가 바뀌면 syncDir 을 전환하고 세션을 재시작합니다.
func runDaemon() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v\nrun: handsync init <server_url> <sync_dir>", err)
	}

	database, err := db.Open(config.DefaultConfigDir())
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer database.Close()

	apiClient := api.NewClient(cfg.ServerURL, config.TokensPath())

	// 서버에서 현재 storage mode 조회
	currentMode := fetchMode(apiClient, database)
	log.Printf("[main] storage mode=%q  sync_dir=%s", currentMode, cfg.SyncDir)

	for {
		newMode := syncSession(cfg, apiClient, database, cfg.SyncDir, currentMode)
		if newMode == currentMode {
			// 모드 변경이 아닌 비정상 종료 — 그냥 리턴
			return
		}

		// 서버 storage mode 전환 감지
		// 서버의 MinIO 데이터 디렉토리가 물리적으로 바뀌므로
		// 로컬 DB 상태를 초기화하고 full re-sync 수행
		log.Printf("[main] storage mode changed: %q → %q  resetting local db...", currentMode, newMode)
		if err := database.ResetForModeSwitch(newMode); err != nil {
			log.Printf("[main] db reset error: %v (continuing)", err)
		}

		currentMode = newMode
	}
}

// fetchMode 는 서버에서 현재 storage mode 를 가져옵니다.
// 실패하면 DB 에 저장된 마지막 mode 를 사용하고, 그마저 없으면 빈 문자열을 반환합니다.
func fetchMode(apiClient *api.Client, database *db.DB) string {
	mode, err := apiClient.GetStorageMode()
	if err != nil {
		log.Printf("[main] storage mode fetch failed: %v", err)
		// DB 에 저장된 마지막 mode 사용
		saved, _ := database.GetMeta("storage_mode")
		if saved != "" {
			log.Printf("[main] using last known mode from db: %q", saved)
			return saved
		}
		log.Printf("[main] no saved mode, using default sync_dir")
		return ""
	}

	// 처음 실행이거나 DB mode 와 다르면 DB 에 저장
	saved, _ := database.GetMeta("storage_mode")
	if saved != mode {
		if saved != "" {
			// 이전에 다른 모드로 실행된 적 있음 → 리셋
			log.Printf("[main] mode mismatch at startup (db=%q server=%q): resetting db", saved, mode)
			if err := database.ResetForModeSwitch(mode); err != nil {
				log.Printf("[main] db reset error: %v", err)
			}
		} else {
			// 첫 실행: mode 만 저장
			_ = database.SetMeta("storage_mode", mode)
		}
	}
	return mode
}

// syncSession 은 지정된 syncDir 로 동기화 세션을 실행합니다.
// 서버 storage mode 가 바뀌면 새 mode 를 반환합니다.
// 오류 등으로 종료 시 현재 mode 를 그대로 반환합니다.
func syncSession(cfg *config.Config, apiClient *api.Client, database *db.DB, syncDir, mode string) string {
	q := queue.New(database)
	eng := engine.New(syncDir, database, apiClient, q)

	// 초기 sync (서버 ↔ 로컬 diff)
	if err := eng.InitialSync(); err != nil {
		log.Printf("[session] initial sync error (continuing): %v", err)
	}
	eng.ProcessQueue()

	// 파일 감시 시작
	w, err := watcher.New(syncDir, database, q)
	if err != nil {
		log.Fatalf("create watcher: %v", err)
	}
	if err := w.Start(); err != nil {
		log.Fatalf("start watcher: %v", err)
	}
	defer w.Close()

	log.Printf("[session] watching %s  poll=%ds  mode=%q", syncDir, cfg.PollIntervalSeconds, mode)

	syncTicker := time.NewTicker(time.Duration(cfg.PollIntervalSeconds) * time.Second)
	defer syncTicker.Stop()

	modeTicker := time.NewTicker(modeCheckInterval)
	defer modeTicker.Stop()

	for {
		select {
		case <-syncTicker.C:
			eng.ProcessQueue()
			if err := eng.PollChanges(); err != nil {
				log.Printf("[session] poll error: %v", err)
			}

		case <-modeTicker.C:
			newMode, err := apiClient.GetStorageMode()
			if err != nil {
				log.Printf("[session] mode check failed: %v (will retry)", err)
				continue
			}
			if newMode != mode {
				log.Printf("[session] server mode changed: %q → %q", mode, newMode)
				return newMode
			}
		}
	}
}
