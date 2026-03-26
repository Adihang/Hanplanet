# Handsync — Hanplanet 클라우드 드라이브 동기화 클라이언트

Hanplanet 서버와 로컬 폴더를 양방향 동기화하는 Go 클라이언트입니다.

---

## 목차

- [빌드](#빌드)
  - [Windows 설치파일 생성](#windows-설치파일-생성)
  - [macOS 빌드](#macos-빌드)
- [설치 (Windows)](#설치-windows)
- [사용법](#사용법)
- [설정 파일](#설정-파일)
- [SSD / HDD 모드 전환 대응](#ssd--hdd-모드-전환-대응)

---

## 빌드

### 사전 조건

- Go 1.21 이상
- macOS / Linux 에서 크로스 컴파일 가능 (CGO 불필요)

### Windows 설치파일 생성

`Handsync Setup.exe` 한 파일 안에 `handsync.exe` 가 내장됩니다.

```bash
cd sync-client
make build-windows
```

완료되면 `sync-client/Handsync Setup.exe` 가 생성됩니다.

**빌드 단계 (make 내부 동작):**

1. `handsync.exe` 빌드 — Windows 64비트 동기화 데몬
2. `handsync.exe` 를 `cmd/installer/` 에 embed 소스로 복사
3. `Handsync Setup.exe` 빌드 — handsync.exe 가 내장된 설치파일

> **주의:** `make build-windows` 는 macOS / Linux 에서 실행합니다.
> Windows에서 직접 빌드하려면 아래 명령어를 순서대로 실행하세요.
>
> ```powershell
> go build -ldflags="-s -w" -o handsync.exe ./cmd/handsync
> copy handsync.exe cmd\installer\handsync.exe
> copy uninstall.ps1 cmd\installer\uninstall.ps1
> go build -ldflags="-s -w" -o "Handsync Setup.exe" ./cmd/installer
> ```

### macOS 빌드

```bash
make build-mac     # arm64 (Apple Silicon)
make build         # 현재 플랫폼
```

---

## 설치 (Windows)

1. `Handsync Setup.exe` 를 Windows 로 복사
2. 더블클릭
3. UAC 창 → **예**
4. 안내에 따라 서버 URL, 동기화 폴더 입력 후 로그인

설치 결과:

| 항목 | 경로 |
|------|------|
| 실행파일 | `C:\Program Files\Hanplanet\Handsync\handsync.exe` |
| 시작 메뉴 | `시작 > Hanplanet > Handsync` |
| 시작 메뉴 | `시작 > Hanplanet > Handsync 제거` |
| 자동 시작 | 작업 스케줄러 `HandsyncDaemon` (로그인 시 실행) |

---

## 사용법

```
handsync                         동기화 데몬 실행
handsync login                   로그인 (tokens.json 갱신)
handsync init <url> <dir>        설정 초기화
handsync version                 버전 확인
```

---

## 설정 파일

`~/.handsync/config.json`

```json
{
  "server_url": "https://www.hanplanet.com",
  "sync_dir": "C:\\Users\\user\\Hanplanet",
  "poll_interval_seconds": 30
}
```

| 키 | 설명 |
|----|------|
| `server_url` | Django API 서버 주소 |
| `sync_dir` | 로컬 동기화 폴더 (SSD/HDD 모드와 무관하게 고정) |
| `poll_interval_seconds` | 서버 변경 polling 주기 (기본 30초) |

---

## SSD / HDD 모드 전환 대응

서버는 `DISC` 환경변수(또는 `secrets.json`)로 스토리지 모드를 전환합니다.

| 모드 | 서버 MEDIA_ROOT |
|------|----------------|
| `hdd` | `/Volumes/HANPLANET_HDD/Hanplanet/media` |
| `ssd` | `/Users/.../temporary/hanplanet-ssd/media` |

모드가 전환되면 MinIO가 다른 물리 디렉토리를 사용하므로 서버의 파일 목록 자체가 달라집니다.

**클라이언트 동작:**

- 60초마다 `GET /api/sync/storage-mode` 로 현재 모드 확인
- 모드 변경 감지 시:
  1. 로컬 DB 전체 초기화 (files, queue, sync_cursor)
  2. 같은 `sync_dir` 유지한 채 full InitialSync 재수행
  3. 서버의 새 MinIO 스토리지 기준으로 diff 계산 후 동기화 재개

클라이언트 로컬 폴더(`sync_dir`)는 모드와 무관하게 항상 동일합니다.
