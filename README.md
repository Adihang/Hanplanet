# Hanplanet

Hanplanet은 하나의 Django 프로젝트 안에 아래 기능을 함께 운영하는 통합 서비스입니다.

- 루트 탐색/검색 홈
- 포트폴리오/프로젝트 상세
- HanDrive 문서·파일 작업 공간
- HanDrive와 연결된 Git 저장소 관리
- Forgejo(Gitea) 기반 Git 웹 UI
- HanDrive 지도 뷰어/에디터와 실시간 맵 협업 서버
- 실시간 멀티플레이어 게임 `Bumper Car Spiky`
- 독립 Apache/PHP/SQLite 기반 Wargame 서비스
- 기타 `Stratagem Hero`, `Salvation's Edge 4`
- Ollama 기반 AI 챗봇
- Ollama를 OpenAI-compatible API로 노출하는 `/ai/v1` 프록시
- 접속 로그 수집/요약과 운영용 관리 화면

운영 기준 주소:

- 메인 서비스: [https://www.hanplanet.com](https://www.hanplanet.com)
- 루트 도메인: [https://hanplanet.com](https://hanplanet.com)
- Git 웹 UI: [https://git.hanplanet.com](https://git.hanplanet.com)
- 게임 WebSocket: `wss://game.hanplanet.com`
- 맵 협업 WebSocket: `wss://map-collab.hanplanet.com`
- Wargame: [https://wargame.hanplanet.com](https://wargame.hanplanet.com)
- OpenAI-compatible AI 프록시: `https://hanplanet.com/ai/v1`

추가 운영 규칙과 에이전트용 상세 작업 규칙은 [PROJECT_GUIDELINES.md](./PROJECT_GUIDELINES.md)를 참고하세요.

## 서비스 전체 구조

### 1. 공개 트래픽 경로

현재 실제 운영 ingress는 Cloudflare Tunnel이 먼저 받고, 호스트 내부 포트로 직접 연결합니다.

```mermaid
flowchart LR
  U["Client Browser"] --> CF["Cloudflare"]
  CF --> T["cloudflared tunnel"]
  T --> WWW["localhost:8000 (Django/Gunicorn)"]
  T --> GIT["localhost:3000 (Gitea)"]
  T --> GAME["localhost:8081 (Node game server)"]
  T --> MAP["localhost:8083 (Map collab WS)"]
  T --> WG["localhost:8090 (Wargame Apache)"]
  T --> SSH["localhost:22 (SSH)"]
```

현재 `~/.cloudflared/config.yml` 기준:

- `www.hanplanet.com`, `hanplanet.com` -> `http://localhost:8000`
- `git.hanplanet.com` -> `http://localhost:3000`
- `game.hanplanet.com` -> `http://localhost:8081`
- `map-collab.hanplanet.com` -> `http://localhost:8083`
- `ssh.hanplanet.com` -> `ssh://localhost:22`
- `wargame.hanplanet.com` -> `http://localhost:8090`

메인 도메인은 현재 Cloudflare Tunnel이 Gunicorn `:8000`으로 직접 전달합니다. Nginx `:80`도 launchd로 실행되지만, 현재 역할은 로컬 reverse proxy, 정적/미디어 alias, JSON access log, 직접 IP/로컬 접속 대응입니다.

### 2. 호스트 내부 서비스 구조

```mermaid
flowchart TD
  Django["Django / Gunicorn :8000"]
  Nginx["Nginx :80 (host local reverse proxy, static/media alias, logs)"]
  Forgejo["Forgejo(Gitea) :3000"]
  Redis["Redis :6379"]
  Celery["Celery worker"]
  Ollama["Ollama :11434"]
  Game["Bumpercar Node WS :8081"]
  MapCollab["Map collab Node WS :8083"]
  MapAdmin["Map collab admin :8084"]
  Wargame["Wargame Apache :8090"]
  PHPFPM["PHP-FPM :9000"]
  SQLite["SQLite (Django DB / Forgejo DB)"]
  WargameDB["Wargame SQLite"]
  Media["media/"]
  Static["staticfiles/"]
  RepoData["forgejo/data/repos/"]

  Django --> SQLite
  Django --> Media
  Django --> Static
  Django --> Ollama
  Django --> Redis
  Django --> Celery
  Django --> Forgejo
  Django --> MapAdmin
  Celery --> Forgejo
  Celery --> Redis
  Forgejo --> RepoData
  Forgejo --> SQLite
  Django --> Game
  MapCollab -. exposes .-> MapAdmin
  Wargame --> PHPFPM
  Wargame --> WargameDB
  Nginx --> Django
  Nginx --> Static
  Nginx --> Media
```

### 3. 서버별 역할

| 서버/서비스 | 역할 | 주요 설정 파일 |
| --- | --- | --- |
| Django + Gunicorn | 메인 웹, API, 템플릿 렌더링, HanDrive, 포트폴리오, 게임 토큰 발급 | [`config/settings.py`](./config/settings.py), [`config/urls.py`](./config/urls.py), [`main/views.py`](./main/views.py), [`main/handrive_views.py`](./main/handrive_views.py) |
| Forgejo / Gitea | Git 저장소 웹 UI, bare repo 저장소, OAuth/세션 기반 Git 웹 | [`forgejo/custom/conf/app.ini`](./forgejo/custom/conf/app.ini), [`forgejo/custom/templates/`](./forgejo/custom/templates/) |
| Celery worker | HanDrive -> Git 저장소 생성/재시도 같은 비동기 작업 | [`main/git_tasks.py`](./main/git_tasks.py), [`deploy/launchd/com.hanplanet.celery.plist`](./deploy/launchd/com.hanplanet.celery.plist) |
| Redis | Celery broker | launchd/brew services 환경 |
| Node game server | 실시간 범퍼카 월드 시뮬레이션, JWT 검증, WebSocket | [`bumpercar-spiky-server/server.js`](./bumpercar-spiky-server/server.js), [`bumpercar-spiky-server/world/world.js`](./bumpercar-spiky-server/world/world.js) |
| Map collab server | HanDrive 지도 뷰어 실시간 협업, presence/admin endpoint | [`map-collab-server/server.js`](./map-collab-server/server.js), [`map-collab-server/network/websocket.js`](./map-collab-server/network/websocket.js) |
| Wargame Apache/PHP | `wargame.hanplanet.com` 전용 PHP 앱, 문제/플래그/SQLite 격리 | [`Wargame/README.md`](./Wargame/README.md), [`Wargame/deploy/apache/httpd-wargame.conf`](./Wargame/deploy/apache/httpd-wargame.conf) |
| Ollama | `/api/chat/`, `/ai/v1/*`의 LLM 백엔드 | [`config/settings.py`](./config/settings.py), [`ai/views.py`](./ai/views.py) |
| Nginx | host local reverse proxy, static/media alias, access log JSON, `/ai/` long-streaming proxy 설정 | [`nginx/nginx.autorun.conf`](./nginx/nginx.autorun.conf), [`nginx/portfolio.conf`](./nginx/portfolio.conf) |
| Cloudflare Tunnel | 공개 도메인 -> 로컬 포트 라우팅 | `~/.cloudflared/config.yml` |

## 서버들은 어떻게 연동되는가

### HanDrive + Git 연동

1. 사용자가 HanDrive에서 폴더를 Git 저장소로 생성 요청
2. Django API가 `GitRepository` 레코드를 만들고 Celery 작업을 큐에 넣음
3. Celery가 Forgejo API를 호출해 저장소를 만들고 파일을 push
4. HanDrive는 이 저장소를 가상 폴더/브랜치 구조처럼 렌더링
5. 브랜치 내부 수정/업로드/이동/삭제는 temp clone -> commit -> push 경로로 처리

관련 코드:

- 요청/상태 API: [`main/views.py`](./main/views.py)
- Forgejo API client: [`main/forgejo_client.py`](./main/forgejo_client.py)
- 서비스 계층: [`main/git_service.py`](./main/git_service.py)
- Celery task: [`main/git_tasks.py`](./main/git_tasks.py)
- HanDrive 가상 Git 경로 처리: [`main/handrive_views.py`](./main/handrive_views.py)

### 게임 서버 연동

1. 브라우저가 범퍼카 페이지를 Django에서 렌더링
2. 클라이언트가 `/api/game-auth-token/`으로 JWT 요청
3. Django가 게임 전용 JWT 발급
4. 브라우저가 `wss://game.hanplanet.com`으로 WebSocket 연결
5. Node 게임 서버가 JWT를 검증하고 월드 시뮬레이션에 플레이어를 추가
6. 월드 상태를 msgpack/WebSocket으로 브라우저에 지속 전송

관련 코드:

- 게임 페이지/토큰 API: [`main/views.py`](./main/views.py)
- WS 서버: [`bumpercar-spiky-server/network/websocket.js`](./bumpercar-spiky-server/network/websocket.js)
- 게임 루프: [`bumpercar-spiky-server/game/gameLoop.js`](./bumpercar-spiky-server/game/gameLoop.js)
- 월드 판정: [`bumpercar-spiky-server/world/world.js`](./bumpercar-spiky-server/world/world.js)

### HanDrive 맵 협업 연동

1. 사용자가 HanDrive map viewer/editor를 열면 Django가 맵 경로와 사용자 권한을 확인
2. 브라우저가 `/api/map-collab-auth-token/`으로 협업 JWT와 WebSocket URL을 요청
3. 브라우저가 `wss://map-collab.hanplanet.com`으로 연결
4. Node 맵 협업 서버가 JWT를 검증하고 방 단위로 stroke/text/ping/presence 이벤트를 중계
5. Django admin의 맵 협업 세션 화면은 `127.0.0.1:8084` admin endpoint로 현재 방/사용자 상태를 조회

관련 코드:

- 토큰/프레즌스 API: [`main/views.py`](./main/views.py)
- 맵 뷰어 UI: [`templates/handrive/map_viewer.html`](./templates/handrive/map_viewer.html)
- WS 서버: [`map-collab-server/network/websocket.js`](./map-collab-server/network/websocket.js)
- admin endpoint: [`map-collab-server/network/admin.js`](./map-collab-server/network/admin.js)

### Wargame 연동

1. `wargame.hanplanet.com`은 Cloudflare Tunnel이 Apache `:8090`으로 직접 전달
2. Apache는 `Wargame/public/`만 DocumentRoot로 노출하고 PHP-FPM `127.0.0.1:9000`으로 PHP 실행
3. 문제/플래그/힌트/문제별 상태는 `Wargame/data/wargame.sqlite3`만 사용
4. 사이트 통합이 필요한 로그인 상태, navbar, 풀이 기록, 사용자 설정만 Django API와 통신
5. Wargame PHP는 Django DB, Django session, `media/` 파일 시스템에 직접 접근하지 않음

관련 코드:

- Wargame 앱: [`Wargame/`](./Wargame/)
- Apache 설정: [`Wargame/deploy/apache/httpd-wargame.conf`](./Wargame/deploy/apache/httpd-wargame.conf)
- Django 통합 API: [`main/views.py`](./main/views.py)

### AI 챗봇 연동

1. 브라우저가 `/api/chat/` 호출
2. Django가 입력을 정리하고 Ollama HTTP API로 프록시
3. 응답을 HTML/markdown 안전 규칙에 맞춰 다시 반환

OpenAI-compatible API가 필요한 외부 도구는 `/ai/v1/*`를 사용합니다. 이 경로는 Django `ai` 앱이 Ollama `/v1/*`로 투명 프록시하며, `OLLAMA_PROXY_API_KEY`가 설정되어 있으면 `Authorization: Bearer ...` 인증을 요구합니다.

관련 코드:

- API: [`main/views.py`](./main/views.py)
- OpenAI-compatible proxy: [`ai/views.py`](./ai/views.py), [`ai/urls.py`](./ai/urls.py)
- 위젯 UI: [`static/js/common/chat_widget.js`](./static/js/common/chat_widget.js)

## 기술 스택

### Backend

- Python
- Django 5
- SQLite
- Celery
- Redis
- django-celery-results
- django-cors-headers
- oauthlib / django-oauth-toolkit (`oauth2_provider`)
- Markdown
- Pillow
- LibreOffice headless (HanDrive 오피스 미리보기 변환)

### Frontend

- Django Templates
- Vanilla JavaScript
- Bootstrap vendor asset
- 공용 CSS + 페이지 전용 CSS 분리 구조
- Google Fonts (`Inter`, `Noto Sans KR`)

### Git / infra

- Forgejo/Gitea
- Cloudflare Tunnel
- Nginx
- macOS launchd
- Apache HTTP Server
- PHP-FPM
- Homebrew PHP

### Realtime / Game

- Node.js
- `ws`
- `jsonwebtoken`
- `@msgpack/msgpack`
- Map collaboration WebSocket server

### AI / preview / ops

- Ollama
- OpenAI-compatible `/ai/v1` proxy
- LibreOffice
- JSON access logs + 일일 요약 command

## API 맵

전체 라우트 등록 위치는 [`main/urls.py`](./main/urls.py) 입니다. 아래는 기능별로 어디에 정의되어 있는지 정리한 표입니다.

### 공통/PWA/API

| 경로 | 용도 | 실제 처리 함수 |
| --- | --- | --- |
| `/manifest.webmanifest` | PWA manifest | [`main/views.py`](./main/views.py) `pwa_manifest` |
| `/service-worker.js` | service worker | [`main/views.py`](./main/views.py) `service_worker` |
| `/api/chat/` | Ollama 챗봇 | [`main/views.py`](./main/views.py) `chat_with_ai` |
| `/api/theme-preference/` | 테마 저장 | [`main/views.py`](./main/views.py) `theme_preference` |
| `/api/user-preferences/` | 사용자 선호 저장 | [`main/views.py`](./main/views.py) `user_preferences` |
| `/api/root-shortcuts/` | 루트 바로가기 CRUD | [`main/views.py`](./main/views.py) `root_shortcuts`, `root_shortcuts_detail`, `root_shortcuts_reorder` |
| `/account/profile-image/` | 프로필 이미지 업로드 | [`main/views.py`](./main/views.py) `account_profile_image_upload` |

### 게임 API

| 경로 | 용도 | 실제 처리 함수 |
| --- | --- | --- |
| `/api/game-auth-token/` | 게임 JWT 발급 | [`main/views.py`](./main/views.py) `game_auth_token` |
| `/api/internal/bumpercar-spiky/stats/` | 게임 통계 수집 | [`main/views.py`](./main/views.py) `bumpercar_spiky_stats_record` |
| `/sub/bumpercar-spiky/admin/` | 게임 관리자 화면 | [`main/views.py`](./main/views.py) `bumpercar_spiky_admin_page` |
| `/sub/bumpercar-spiky/restart-server/` | 게임 서버 재시작 | [`main/views.py`](./main/views.py) `bumpercar_spiky_restart_server` |
| `/sub/bumpercar-spiky/set-npc-health/` | NPC 체력 조정 | [`main/views.py`](./main/views.py) `bumpercar_spiky_set_npc_health` |

### Wargame / Map Collab API

| 경로 | 용도 | 실제 처리 함수 |
| --- | --- | --- |
| `/api/wargame/session/` | Wargame용 로그인 토큰 발급 | [`main/views.py`](./main/views.py) `wargame_session` |
| `/api/wargame/navbar/` | Wargame 공통 navbar HTML 조각 | [`main/views.py`](./main/views.py) `wargame_navbar` |
| `/api/wargame/solves/` | Wargame 풀이 기록 읽기/저장 | [`main/views.py`](./main/views.py) `wargame_solves` |
| `/api/wargame/preferences/` | Wargame UI/언어/검색 설정 | [`main/views.py`](./main/views.py) `wargame_preferences` |
| `/api/map-collab-auth-token/` | 지도 협업 JWT + WS URL 발급 | [`main/views.py`](./main/views.py) `map_collab_auth_token` |
| `/api/map-collab-presence/` | 지도 협업 presence 조회 | [`main/views.py`](./main/views.py) `map_collab_presence` |

### HanDrive API

HanDrive 파일/권한/미리보기/공유 관련 요청은 대부분 [`main/handrive_views.py`](./main/handrive_views.py)에 있습니다.

| 경로 | 용도 |
| --- | --- |
| `/handrive/api/list` | 폴더 목록 |
| `/handrive/api/save` | 파일 저장 |
| `/handrive/api/preview` | 파일 미리보기 |
| `/handrive/api/rename` | 이름 변경 |
| `/handrive/api/delete` | 삭제 |
| `/handrive/api/mkdir` | 폴더 생성 |
| `/handrive/api/move` | 이동 |
| `/handrive/api/archive/extract` | 압축 해제 |
| `/handrive/api/archive/create` | 압축 생성 |
| `/handrive/api/convert/mp3` | 오디오 MP3 변환 |
| `/handrive/api/upload` | 업로드 |
| `/handrive/api/markdown-image-upload` | Markdown 이미지 업로드 |
| `/handrive/api/upload/cancel` | 업로드 취소 |
| `/handrive/api/download` | 다운로드 |
| `/handrive/api/hls/*` | 비디오 HLS/썸네일/스프라이트 |
| `/handrive/api/map/*` | 지도 생성/데이터/이미지/아이콘 |
| `/handrive/api/acl` | 권한 설정 |
| `/handrive/api/acl-options` | 권한 설정 후보 조회 |
| `/handrive/api/url-share` | 링크 공유 |
| `/handrive/api/sync-settings` | 동기화 클라이언트 설정 |
| `/handrive/api/login-captcha-status` | 로그인 캡차 상태 |

### Git / Device Flow API

Git repo 생성/조회/협업자/clone URL/API와 device flow는 [`main/views.py`](./main/views.py)에 있습니다.

| 경로 | 용도 |
| --- | --- |
| `/api/git/repos/` | 저장소 생성 |
| `/api/git/repos/by-path/` | 경로로 저장소 조회 |
| `/api/git/repos/<id>/status/` | 작업 상태 조회 |
| `/api/git/repos/<id>/retry/` | 실패 작업 재시도 |
| `/api/git/repos/<id>/clone/` | clone URL 조회 |
| `/api/git/repos/<id>/collaborators/` | 협업자 추가 |
| `/api/git/auth/device/` | device code 발급 |
| `/api/git/auth/token/` | device flow polling |
| `/api/git/auth/approve/` | 승인 처리 |
| `/git-auth/` | 브라우저 승인 화면 |
| `/git-auth/credential-helper/` | Git credential helper 다운로드 |

### WebSocket / 실시간 프로토콜

HTTP URL이 아니라 Node 서버 내부 프로토콜로 정의된 부분:

- WebSocket 연결/메시지 처리: [`bumpercar-spiky-server/network/websocket.js`](./bumpercar-spiky-server/network/websocket.js)
- JWT 검증: [`bumpercar-spiky-server/auth/jwt.js`](./bumpercar-spiky-server/auth/jwt.js)

## 폴더 구조와 목적

### 최상위 폴더

| 경로 | 목적 |
| --- | --- |
| [`config/`](./config/) | Django settings, project URLConf, WSGI/ASGI, Celery bootstrap |
| [`main/`](./main/) | 메인 Django 앱. 모델, 뷰, Git 서비스, HanDrive 뷰, admin, management command |
| [`templates/`](./templates/) | Django 템플릿. 공통 partial, popup, handrive, portfolio, fun 페이지 템플릿 |
| [`static/`](./static/) | 소스 정적 파일. CSS/JS/아이콘/게임 자산 |
| [`staticfiles/`](./staticfiles/) | `collectstatic` 결과물. 직접 수정 금지 |
| [`media/`](./media/) | 업로드 파일, HanDrive 실제 파일, 포트폴리오 업로드 |
| [`forgejo/`](./forgejo/) | Gitea work path, custom templates/assets, data/log |
| [`bumpercar-spiky-server/`](./bumpercar-spiky-server/) | 별도 Node 게임 서버 |
| [`map-collab-server/`](./map-collab-server/) | HanDrive 지도 실시간 협업 WebSocket/admin 서버 |
| [`Wargame/`](./Wargame/) | `wargame.hanplanet.com` 전용 Apache/PHP/SQLite 앱 |
| [`sync-client/`](./sync-client/) | HanDrive 동기화 클라이언트 |
| [`deploy/`](./deploy/) | launchd plist, helper script |
| [`nginx/`](./nginx/) | nginx 설정 |
| [`scripts/`](./scripts/) | launchd 실행 래퍼, access log rotate/summary, 헬스체크, HDD 정리 스크립트 |
| [`docs/readme-assets/`](./docs/readme-assets/) | README에서 참조하는 이미지 자산 |

### `main/` 핵심 파일

| 파일 | 목적 |
| --- | --- |
| [`main/views.py`](./main/views.py) | 루트/포트폴리오/게임/API/Git/device flow/PWA 등 메인 뷰 |
| [`main/handrive_views.py`](./main/handrive_views.py) | HanDrive 파일 브라우저, 편집기, ACL, Git virtual path 처리 |
| [`main/handrive/preview.py`](./main/handrive/preview.py) | PDF/HTML/LibreOffice 기반 미리보기 helper |
| [`main/handrive/html_assets.py`](./main/handrive/html_assets.py) | HTML companion asset 로더 |
| [`main/models.py`](./main/models.py) | 포트폴리오, HanDrive ACL, quick link, user profile, Git model |
| [`main/forgejo_client.py`](./main/forgejo_client.py) | Forgejo/Gitea REST 호출 |
| [`main/git_service.py`](./main/git_service.py) | Git repo 생성/상태 추상화 |
| [`main/git_tasks.py`](./main/git_tasks.py) | Celery에서 실행되는 Git 작업 |
| [`main/middleware.py`](./main/middleware.py) | 글로벌 rate limit middleware |
| [`main/access_log_scheduler.py`](./main/access_log_scheduler.py) | 접속 로그 요약 scheduler |
| [`main/access_log_summary.py`](./main/access_log_summary.py) | access log summary helper |
| [`main/management/commands/summarize_access_logs.py`](./main/management/commands/summarize_access_logs.py) | 일일 로그 요약 command |

### `static/js/` 구조

| 경로 | 목적 |
| --- | --- |
| [`static/js/common/`](./static/js/common/) | 사이트 전역 JS. nav, popup, chat widget, print helper 등 |
| [`static/js/pages/`](./static/js/pages/) | 특정 Django page 전용 엔트리 |
| [`static/js/handrive/`](./static/js/handrive/) | Handrive 전용 모듈. list, preview, queue, modal, git repo UI |
| [`static/js/fun/`](./static/js/fun/) | 게임/기타 전용 JS |
| [`static/js/vendor/`](./static/js/vendor/) | 직접 수정하지 않는 vendor asset |

### `static/css/` 구조

| 경로 | 목적 |
| --- | --- |
| [`static/css/common/`](./static/css/common/) | 공용 레이아웃, 공통 팝업, 계정 위젯, 채팅 위젯 |
| [`static/css/pages/`](./static/css/pages/) | 페이지 전용 스타일 |
| [`static/css/fun/`](./static/css/fun/) | 게임/기타 전용 스타일 |
| [`static/css/vendor/`](./static/css/vendor/) | vendor CSS |

### `templates/` 구조

| 경로 | 목적 |
| --- | --- |
| [`templates/base.html`](./templates/base.html) | 공통 베이스 템플릿 |
| [`templates/none.html`](./templates/none.html) | 루트 탐색/검색 홈 |
| [`templates/main/`](./templates/main/) | 포트폴리오와 프로젝트 상세 |
| [`templates/handrive/`](./templates/handrive/) | HanDrive 화면 |
| [`templates/fun/`](./templates/fun/) | 범퍼카/Stratagem/Salvation's Edge |
| [`templates/partials/`](./templates/partials/) | 공통 재사용 파셜 |
| [`templates/popup/`](./templates/popup/) | 팝업/모달 전용 템플릿 |

### `forgejo/` 구조

| 경로 | 목적 |
| --- | --- |
| [`forgejo/custom/conf/app.ini`](./forgejo/custom/conf/app.ini) | Gitea 설정 |
| [`forgejo/custom/templates/`](./forgejo/custom/templates/) | Gitea 템플릿 오버라이드 |
| [`forgejo/custom/public/assets/`](./forgejo/custom/public/assets/) | Gitea가 쓰는 커스텀 CSS/JS/이미지 |
| `forgejo/data/repos/` | 실제 bare Git 저장소 |
| `forgejo/data/gitea.db` | Gitea SQLite DB |
| `forgejo/log/` | Gitea stdout/stderr 및 app 로그 |

### `bumpercar-spiky-server/` 구조

| 경로 | 목적 |
| --- | --- |
| [`server.js`](./bumpercar-spiky-server/server.js) | 진입점 |
| [`config/config.js`](./bumpercar-spiky-server/config/config.js) | 런타임 기본 설정 |
| [`config/gameplaySettings.js`](./bumpercar-spiky-server/config/gameplaySettings.js) | Django 공유 게임 설정 로더 |
| [`network/websocket.js`](./bumpercar-spiky-server/network/websocket.js) | WebSocket 연결/메시지 처리 |
| [`game/gameLoop.js`](./bumpercar-spiky-server/game/gameLoop.js) | fixed tick 루프 |
| [`world/world.js`](./bumpercar-spiky-server/world/world.js) | 월드 핵심 판정 |
| [`world/worldDeath.js`](./bumpercar-spiky-server/world/worldDeath.js) | 사망/리스폰 처리 |
| [`world/worldEncounter.js`](./bumpercar-spiky-server/world/worldEncounter.js) | encounter phase 처리 |
| [`world/player.js`](./bumpercar-spiky-server/world/player.js) | player/NPC 상태 구조 |

### `map-collab-server/` 구조

| 경로 | 목적 |
| --- | --- |
| [`server.js`](./map-collab-server/server.js) | WebSocket/admin 서버 진입점 |
| [`config/config.js`](./map-collab-server/config/config.js) | 포트/JWT/presence TTL 설정 |
| [`network/websocket.js`](./map-collab-server/network/websocket.js) | 맵 협업 WebSocket 연결/메시지 처리 |
| [`network/admin.js`](./map-collab-server/network/admin.js) | Django admin이 조회하는 로컬 admin endpoint |
| [`rooms/roomManager.js`](./map-collab-server/rooms/roomManager.js) | 방별 사용자 presence 관리 |

### `Wargame/` 구조

| 경로 | 목적 |
| --- | --- |
| [`Wargame/public/`](./Wargame/public/) | Apache DocumentRoot. 공개 PHP/CSS/JS만 위치 |
| [`Wargame/app/`](./Wargame/app/) | Wargame PHP 애플리케이션 로직 |
| [`Wargame/data/`](./Wargame/data/) | Wargame SQLite DB와 Apache/launchd 로그 |
| [`Wargame/deploy/apache/httpd-wargame.conf`](./Wargame/deploy/apache/httpd-wargame.conf) | 전용 Apache 인스턴스 설정 |
| [`Wargame/deploy/launchd/com.hanplanet.wargame-apache.plist`](./Wargame/deploy/launchd/com.hanplanet.wargame-apache.plist) | Wargame Apache launchd 설정 |

## 코드를 이해할 때 권장 읽기 순서

주석과 docstring을 읽으면서 들어가기 가장 편한 순서는 아래입니다.

### 전체 서비스 파악 순서

1. [`PROJECT_GUIDELINES.md`](./PROJECT_GUIDELINES.md)
2. [`README.md`](./README.md)
3. [`config/settings.py`](./config/settings.py)
4. [`config/urls.py`](./config/urls.py)
5. [`main/urls.py`](./main/urls.py)

### 포트폴리오 / 루트 홈

1. [`templates/base.html`](./templates/base.html)
2. [`templates/none.html`](./templates/none.html)
3. [`static/js/pages/none/root_search.js`](./static/js/pages/none/root_search.js)
4. [`main/views.py`](./main/views.py)

### HanDrive

1. [`templates/handrive/`](./templates/handrive/)
2. [`static/js/handrive/page.js`](./static/js/handrive/page.js)
3. [`static/js/handrive/preview_flow_helpers.js`](./static/js/handrive/preview_flow_helpers.js)
4. [`static/js/handrive/queue_operation_helpers.js`](./static/js/handrive/queue_operation_helpers.js)
5. [`main/handrive_views.py`](./main/handrive_views.py)
6. [`main/handrive/preview.py`](./main/handrive/preview.py)
7. [`main/handrive/html_assets.py`](./main/handrive/html_assets.py)

### Git 연동

1. [`main/views.py`](./main/views.py) 의 `git_*` API
2. [`main/forgejo_client.py`](./main/forgejo_client.py)
3. [`main/git_service.py`](./main/git_service.py)
4. [`main/git_tasks.py`](./main/git_tasks.py)
5. [`forgejo/custom/conf/app.ini`](./forgejo/custom/conf/app.ini)
6. [`forgejo/custom/templates/`](./forgejo/custom/templates/)

### 범퍼카 게임

1. [`templates/fun/Hanplanet_Multiplayer.html`](./templates/fun/Hanplanet_Multiplayer.html)
2. [`static/js/fun/bumpercar_spiky/multiplayer.js`](./static/js/fun/bumpercar_spiky/multiplayer.js)
3. [`main/views.py`](./main/views.py) 의 범퍼카 페이지/토큰 함수
4. [`bumpercar-spiky-server/README.md`](./bumpercar-spiky-server/README.md)
5. [`bumpercar-spiky-server/network/websocket.js`](./bumpercar-spiky-server/network/websocket.js)
6. [`bumpercar-spiky-server/world/world.js`](./bumpercar-spiky-server/world/world.js)

### HanDrive 지도 협업

1. [`templates/handrive/map_viewer.html`](./templates/handrive/map_viewer.html)
2. [`main/views.py`](./main/views.py) 의 `map_collab_*` API
3. [`map-collab-server/server.js`](./map-collab-server/server.js)
4. [`map-collab-server/network/websocket.js`](./map-collab-server/network/websocket.js)
5. [`map-collab-server/network/admin.js`](./map-collab-server/network/admin.js)

### Wargame

1. [`Wargame/README.md`](./Wargame/README.md)
2. [`Wargame/public/index.php`](./Wargame/public/index.php)
3. [`Wargame/public/lab.php`](./Wargame/public/lab.php)
4. [`Wargame/app/bootstrap.php`](./Wargame/app/bootstrap.php)
5. [`main/views.py`](./main/views.py) 의 `wargame_*` 통합 API

### 공용 UI / 위젯

1. [`static/js/common/site.js`](./static/js/common/site.js)
2. [`static/js/common/site_nav_responsive_manager.js`](./static/js/common/site_nav_responsive_manager.js)
3. [`static/js/common/popup_common.js`](./static/js/common/popup_common.js)
4. [`static/js/common/chat_widget.js`](./static/js/common/chat_widget.js)
5. [`static/css/common/`](./static/css/common/)

## 초기 세팅

### 1. 필수 도구

권장 환경:

- macOS
- Python 3.x
- Node.js + npm
- Homebrew

운영 또는 로컬 재현에 필요한 도구:

```bash
brew install nginx redis gitea php libreoffice
```

선택:

- `ollama` - 챗봇 기능 테스트 시
- `cloudflared` - 공개 도메인/터널 재현 시

### 2. Python 환경

```bash
cd /Users/imhanbyeol/Development/Hanplanet
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Django 초기화

```bash
cd /Users/imhanbyeol/Development/Hanplanet
.venv/bin/python manage.py migrate
.venv/bin/python manage.py collectstatic --noinput
.venv/bin/python manage.py createsuperuser
```

### 4. 시크릿 파일

`config/secrets.json`은 git에 올리지 않습니다.

예시:

```json
{
  "SECRET_KEY": "change-this-in-real-env",
  "DISC": "hdd",
  "FORGEJO_BASE_URL": "http://localhost:3000",
  "FORGEJO_ADMIN_TOKEN": "gitea-admin-api-token",
  "PUBLIC_GIT_BASE_URL": "https://git.hanplanet.com",
  "OLLAMA_PROXY_API_KEY": "optional-openai-compatible-api-key",
  "GAME_JWT_SECRET": "game-jwt-secret",
  "GAME_JWT_ISSUER": "https://www.hanplanet.com",
  "GAME_JWT_AUDIENCE": "hanplanet-game",
  "DATA_BACKUP_ROOT": "/Volumes/HANPLANET_HDD/Hanplanet/back-up",
  "DATA_BACKUP_RETENTION_DAYS": 3,
  "TURNSTILE_SITE_KEY": "",
  "TURNSTILE_SECRET_KEY": ""
}
```

권한:

```bash
chmod 600 config/secrets.json
```

### 4-1. 저장소 프로필 전환 (`DISC`)

Hanplanet은 `config/secrets.json`의 `DISC` 값으로 저장소 위치를 전환합니다.

- `DISC = "hdd"`
  - 운영 기본값
  - `MEDIA_ROOT` -> `/Volumes/HANPLANET_HDD/Hanplanet/media`
  - `FORGEJO_REPOS_ROOT` -> `/Volumes/HANPLANET_HDD/Hanplanet/forgejo-repos`
  - gunicorn / gitea / celery는 외장 스토리지를 기다린 뒤 실행
- `DISC = "ssd"`
  - 외장 디스크 장애 시 임시 운영 모드
  - `MEDIA_ROOT` -> `/Users/imhanbyeol/temporary/hanplanet-ssd/media`
  - `FORGEJO_REPOS_ROOT` -> `/Users/imhanbyeol/temporary/hanplanet-ssd/forgejo-repos`
  - 외장 스토리지 대기 없이 바로 실행

예시:

```json
{
  "DISC": "ssd"
}
```

`DISC`를 바꾼 뒤 즉시 적용하려면:

```bash
cd /Users/imhanbyeol/Development/Hanplanet
mkdir -p /Users/imhanbyeol/temporary/hanplanet-ssd/media/HanDrive
mkdir -p /Users/imhanbyeol/temporary/hanplanet-ssd/media/uploads
mkdir -p /Users/imhanbyeol/temporary/hanplanet-ssd/forgejo-repos

launchctl kickstart -k gui/$(id -u)/com.hanplanet.gunicorn
launchctl kickstart -k gui/$(id -u)/com.hanplanet.gitea
launchctl kickstart -k gui/$(id -u)/com.hanplanet.celery
launchctl kickstart -k gui/$(id -u)/com.hanplanet.nginx
```

재부팅만으로 반영해도 되는가:

- 된다. `gunicorn`, `gitea`, `celery`, `nginx` 모두 부팅 시 `DISC` 값을 읽는다.
- 즉시 반영이 필요할 때만 위 `kickstart`를 실행하면 된다.

확인:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://www.hanplanet.com/ko/login/
curl -s -o /dev/null -w '%{http_code}\n' https://www.hanplanet.com/ko/signup/
curl -s -o /dev/null -w '%{http_code}\n' https://git.hanplanet.com/user/login
```

참고:

- `DISC`는 Django 설정, Gitea repo root, launchd 런처가 같이 읽습니다.
- Gitea 런타임 설정 파일은 `/tmp/hanplanet_gitea_runtime.ini`에 생성됩니다.
- nginx 런타임 설정 파일은 `/tmp/hanplanet_nginx_runtime.conf`에 생성됩니다.

### 5. 범퍼카 게임 서버 초기화

```bash
cd /Users/imhanbyeol/Development/Hanplanet/bumpercar-spiky-server
cp .env.example .env
npm install
```

`.env`에서 Django의 게임 JWT 값과 동일하게 맞춰야 하는 키:

- `JWT_SECRET`
- `JWT_ISSUER`
- `JWT_AUDIENCE`

### 6. 맵 협업 서버 초기화

```bash
cd /Users/imhanbyeol/Development/Hanplanet/map-collab-server
npm install
```

기본 포트:

- WebSocket: `8083`
- 로컬 admin endpoint: `127.0.0.1:8084`

Django 설정은 환경변수로 조정할 수 있습니다.

- `MAP_COLLAB_WS_PUBLIC_URL` — 기본 `wss://map-collab.hanplanet.com`
- `MAP_COLLAB_WS_LOCAL_URL` — 기본 `ws://127.0.0.1:8083`
- `MAP_COLLAB_ADMIN_URL` — 기본 `http://127.0.0.1:8084`

`map-collab-server/.env`의 JWT 값은 Django의 게임 JWT 값과 맞춥니다.

### 7. Gitea / Git 기능 초기화

```bash
brew services start redis
cd /Users/imhanbyeol/Development/Hanplanet/forgejo
bash setup.sh
```

`setup.sh`가 출력한 토큰을 `config/secrets.json`의 `FORGEJO_ADMIN_TOKEN`으로 넣어야 HanDrive Git API가 정상 동작합니다.

### 8. 로컬 실행

```bash
# Django
cd /Users/imhanbyeol/Development/Hanplanet
.venv/bin/python manage.py runserver

# Game server
cd /Users/imhanbyeol/Development/Hanplanet/bumpercar-spiky-server
PORT=8081 node server.js

# Map collab server
cd /Users/imhanbyeol/Development/Hanplanet/map-collab-server
PORT=8083 ADMIN_PORT=8084 node server.js
```

필요하면 Ollama도 별도로 올립니다.

```bash
ollama pull gemma4:latest
ollama serve
```

## 운영 배포 / 재시작

### launchd 서비스

운영은 Docker가 아니라 macOS `launchd` 네이티브 데몬으로 유지합니다. 저장소의 plist가 원본이고, 실제 로드된 파일은 보통 `~/Library/LaunchAgents/`에 복사되어 있습니다.

| 서비스 | 라벨 | 원본 plist / 위치 | 역할 |
| --- | --- | --- | --- |
| Django/Gunicorn | `com.hanplanet.gunicorn` | [`deploy/launchd/com.hanplanet.gunicorn.plist`](./deploy/launchd/com.hanplanet.gunicorn.plist) | `127.0.0.1:8000`, 메인 Django |
| Nginx | `com.hanplanet.nginx` | [`deploy/launchd/com.hanplanet.nginx.plist`](./deploy/launchd/com.hanplanet.nginx.plist) | `:80`, 로컬 reverse proxy/static/media/log |
| Gitea | `com.hanplanet.gitea` | [`deploy/launchd/com.hanplanet.gitea.plist`](./deploy/launchd/com.hanplanet.gitea.plist) | `:3000`, Git 웹 UI |
| Celery | `com.hanplanet.celery` | [`deploy/launchd/com.hanplanet.celery.plist`](./deploy/launchd/com.hanplanet.celery.plist) | HanDrive Git 작업 |
| 범퍼카 게임 서버 | `com.hanplanet.bumpercar-spiky-server` | [`bumpercar-spiky-server/deploy/launchd/com.hanplanet.bumpercar-spiky-server.plist`](./bumpercar-spiky-server/deploy/launchd/com.hanplanet.bumpercar-spiky-server.plist) | `:8081`, 게임 WS |
| 맵 협업 서버 | `com.hanplanet.map-collab-server` | [`map-collab-server/deploy/launchd/com.hanplanet.map-collab-server.plist`](./map-collab-server/deploy/launchd/com.hanplanet.map-collab-server.plist) | `:8083`, admin `127.0.0.1:8084` |
| Wargame Apache | `com.hanplanet.wargame-apache` | [`Wargame/deploy/launchd/com.hanplanet.wargame-apache.plist`](./Wargame/deploy/launchd/com.hanplanet.wargame-apache.plist) | `:8090`, Wargame PHP |
| 헬스체크 | `com.hanplanet.healthcheck` | [`deploy/launchd/com.hanplanet.healthcheck.plist`](./deploy/launchd/com.hanplanet.healthcheck.plist) | 60초마다 메인/미디어 상태 확인 |
| Nginx access log rotate | `com.hanplanet.nginx-accesslog-rotate` | [`deploy/launchd/com.hanplanet.nginx-accesslog-rotate.plist`](./deploy/launchd/com.hanplanet.nginx-accesslog-rotate.plist) | access JSON rotate |
| Nginx access log summary | `com.hanplanet.nginx-accesslog-summary` | [`deploy/launchd/com.hanplanet.nginx-accesslog-summary.plist`](./deploy/launchd/com.hanplanet.nginx-accesslog-summary.plist) | access summary 생성 |
| 외장 HDD 자동 마운트 | `com.hanplanet.mount-hanplanet-hdd` | `~/Library/LaunchAgents/com.hanplanet.mount-hanplanet-hdd.plist` | 로그인 시 `HANPLANET_HDD` 마운트 |
| 외장 HDD .DS_Store 정리 | `com.hanplanet.external-hdd-keepalive` | `~/Library/LaunchAgents/com.hanplanet.external-hdd-keepalive.plist` | 600초마다 HDD `.DS_Store` 삭제 |

### 외장 HDD 유지 / 백업 위치

- 외장 자동 마운트는 `launchd`의 `com.hanplanet.mount-hanplanet-hdd`가 담당합니다.
- 외장 HDD `.DS_Store` 정리는 `launchd`의 `com.hanplanet.external-hdd-keepalive`가 담당합니다.
  - 실행 파일: [`scripts/cleanup_hdd_ds_store.py`](./scripts/cleanup_hdd_ds_store.py)
  - 실행 주기: 600초마다
  - 대상: `/Volumes/HANPLANET_HDD/` 전체
  - 로그: `/tmp/com.hanplanet.external-hdd-keepalive.log`
- 일일 데이터 백업은 별도 `launchd` 작업이 아니라 Django/Gunicorn 프로세스 내부에서 돕니다.
  - 시작 위치: [`main/apps.py`](./main/apps.py) -> [`main/access_log_scheduler.py`](./main/access_log_scheduler.py)
  - 실제 실행 프로세스: `com.hanplanet.gunicorn`
  - 백업 시각: 매일 `00:05` 이후 첫 스케줄 루프에서 1회
  - 백업 대상: `MEDIA_ROOT`, `FORGEJO_REPOS_ROOT`
  - 백업 저장 경로: `DATA_BACKUP_ROOT` 또는 `DJANGO_DATA_BACKUP_ROOT`
  - 현재 기본 보관 개수: 최근 3일치 (`hanplanet_data_YYYY-MM-DD.tar.gz`)

### 자주 쓰는 명령

```bash
# Django 변경
cd /Users/imhanbyeol/Development/Hanplanet
.venv/bin/python manage.py collectstatic --noinput
./scripts/restart_gunicorn_and_wait.py

# Celery 변경
launchctl kickstart -k gui/$(id -u)/com.hanplanet.celery

# Gitea 변경
launchctl kickstart -k gui/$(id -u)/com.hanplanet.gitea

# 게임 서버 변경
launchctl kickstart -k gui/$(id -u)/com.hanplanet.bumpercar-spiky-server

# 맵 협업 서버 변경
launchctl kickstart -k gui/$(id -u)/com.hanplanet.map-collab-server

# Wargame Apache 변경
httpd -t -f /Users/imhanbyeol/Development/Hanplanet/Wargame/deploy/apache/httpd-wargame.conf
launchctl kickstart -k gui/$(id -u)/com.hanplanet.wargame-apache
```

### 로그

| 대상 | 위치 |
| --- | --- |
| Gunicorn stdout/stderr | `~/Library/Logs/gunicorn.out.log`, `~/Library/Logs/gunicorn.err.log` |
| Nginx launchd stdout/stderr | `~/Library/Logs/hanplanet-nginx.out.log`, `~/Library/Logs/hanplanet-nginx.err.log` |
| Celery stdout | [`log/celery.stdout.log`](./log/celery.stdout.log) |
| Celery stderr | [`log/celery.stderr.log`](./log/celery.stderr.log) |
| 범퍼카 게임 stdout | `/tmp/bumpercar-spiky-server.log` |
| 범퍼카 게임 stderr | `/tmp/bumpercar-spiky-server-error.log` |
| 맵 협업 stdout/stderr | `/tmp/map-collab-server.log`, `/tmp/map-collab-server-error.log` |
| Wargame Apache/access/error | `Wargame/data/launchd.*.log`, `Wargame/data/apache-*.log` |
| Gitea logs | `forgejo/log/` |
| Nginx access JSON | `/opt/homebrew/var/log/nginx/access_json.log` |
| 헬스체크 | `~/Library/Logs/hanplanet-healthcheck.out.log`, `~/Library/Logs/hanplanet-healthcheck.err.log` |

## 운영 스크립트

| 파일 | 목적 |
| --- | --- |
| [`deploy/scripts/git-credential-hanplanet`](./deploy/scripts/git-credential-hanplanet) | Git credential helper. OAuth2 device flow로 Git clone/push 인증 |
| [`scripts/launch_service_by_disc.py`](./scripts/launch_service_by_disc.py) | `DISC` 값에 맞춰 gunicorn/gitea/celery/nginx 실행 전 storage profile 적용 |
| [`scripts/restart_gunicorn_and_wait.py`](./scripts/restart_gunicorn_and_wait.py) | gunicorn 재시작 후 HTTP 준비 상태 대기 |
| [`scripts/healthcheck_and_restart.py`](./scripts/healthcheck_and_restart.py) | 메인/미디어 헬스체크 후 필요 시 gunicorn 재시작 |
| [`scripts/cleanup_hdd_ds_store.py`](./scripts/cleanup_hdd_ds_store.py) | 외장 HDD `.DS_Store` 정리 |
| [`scripts/rotate-nginx-access-json.sh`](./scripts/rotate-nginx-access-json.sh) | access JSON log rotate 및 30일 보관 |
| [`scripts/summarize-nginx-access-json.sh`](./scripts/summarize-nginx-access-json.sh) | 일일 access log summary 생성 |

## 이 프로젝트에서 주의할 점

- `staticfiles/`는 결과물이라 직접 수정하지 않습니다.
- CSS/JS 또는 이를 참조하는 템플릿을 바꾸면 항상 `collectstatic` 후 gunicorn 재시작이 필요합니다.
- HanDrive Git 기능은 Django + Celery + Redis + Forgejo 네 요소가 모두 살아 있어야 정상 동작합니다.
- 범퍼카 게임은 Django만 살아 있어도 안 되고, Node 게임 서버와 JWT 설정이 같이 맞아야 합니다.
- HanDrive 지도 협업은 Django 토큰 API + `map-collab-server` `:8083` + admin endpoint `:8084`가 같이 살아 있어야 합니다.
- Wargame은 Django 앱 안에 있지 않고 Apache/PHP/SQLite로 분리되어 있으며, 문제 로직은 Django DB나 media에 직접 의존하면 안 됩니다.
- Forgejo custom asset은 [`forgejo/custom/public/assets/`](./forgejo/custom/public/assets/) 아래에서 관리합니다.
- Office 미리보기는 LibreOffice가 설치되어 있어야 품질이 제대로 나옵니다.

## 같이 보면 좋은 문서

- [PROJECT_GUIDELINES.md](./PROJECT_GUIDELINES.md)
- [DEPLOYMENT.md](./DEPLOYMENT.md)
- [bumpercar-spiky-server/README.md](./bumpercar-spiky-server/README.md)
- [Wargame/README.md](./Wargame/README.md)
- [AGENTS.md](./AGENTS.md)

## 커스텀 내역

### 2026-04-10 — AI 프록시 / HanHarness 기능 추가 및 버그 수정

**AI 토큰 사용량 로깅 (`ai/` 앱)**
- `AITokenUsage` 모델 추가 — 유저별 스트리밍/논스트리밍 토큰 사용 기록
- 스트리밍 응답에서 `stream_options: {include_usage: true}` 주입 → 마지막 청크에서 토큰 파싱 후 DB 저장
- `tools` 파라미터가 있을 때는 `stream_options` 미주입 (Ollama 400 에러 방지)

**HanHarness 사용 권한 및 5시간 토큰 쿼터 (`main/` 앱)**
- `HandriveUserQuota` 모델에 `hanharness_enabled`, `hanharness_token_limit_5h` 컬럼 추가
- 텀블링 윈도우 방식 5시간 세션 쿼터 적용 (0 = 무제한)
- `/admin/` 에서 유저별 설정 가능

**Admin UI**
- `/admin/main/ai-usage/` — 날짜·유저·모델·이벤트 타입 필터 + 페이지네이션 포함 AI 사용 로그 뷰

**Ollama `num_ctx` 고정**
- `settings.OLLAMA_NUM_CTX = 16384` 추가, 모든 요청에 주입
- `~/.local/bin/start-ollama.sh`: `OLLAMA_CONTEXT_LENGTH=16384`
- `deploy/launchd/com.hanplanet.gunicorn.plist`: `OLLAMA_NUM_CTX=16384` 환경변수 추가

**HanHarness 로딩 스피너 개선 (`HanHarness/src/openharness/ui/output.py`)**
- 스피너에 경과 시간 및 누적 토큰 수 실시간 표시 (`Thinking...  3s  1.2k↓ 0.4k↑`)
- 백그라운드 데몬 스레드가 매초 스피너 텍스트 갱신

**HanHarness auto-compact 임계값 수정 (`HanHarness/src/openharness/services/compact/`)**
- `get_context_window()`: Ollama 모델(gemma, llama, qwen 등)에 `OLLAMA_NUM_CTX` 반환
- `get_autocompact_threshold()`: 고정값 대신 컨텍스트 크기 비례 계산으로 수정 (16384 ctx → 임계값 10240)

**SSE keep-alive로 "incomplete chunked read" 에러 해결**
- `ai/views.py`: `_stream_response`를 threading+queue 패턴으로 재작성
  - 백그라운드 스레드가 Ollama 스트림 수신 → queue에 청크 삽입
  - Django generator가 25초마다 `: ping\n\n` SSE 주석 전송 → nginx `proxy_read_timeout` 타이머 리셋
- `nginx/nginx.autorun.conf`: `/ai/` 전용 location 블록 추가 (`proxy_buffering off`, `proxy_read_timeout 120s`)
- `scripts/launch_service_by_disc.py`: gunicorn `--timeout 120` → `--timeout 360`
