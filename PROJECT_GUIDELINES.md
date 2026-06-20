# Project Guidelines

Shared reference for all AI coding agents (Claude Code, Codex, etc.) working in this repository.

## Commands

```bash
# Development
.venv/bin/python manage.py runserver          # Start local dev server
.venv/bin/python manage.py migrate            # Apply DB migrations
.venv/bin/python manage.py makemigrations     # Generate migrations after model changes
.venv/bin/python manage.py collectstatic      # Collect static assets into staticfiles/
.venv/bin/python manage.py createsuperuser    # Create admin account for /admin/

# Tests
.venv/bin/python manage.py test               # Run all tests (main/tests.py)
.venv/bin/python manage.py test main.tests.TestClassName  # Run a specific test class

# Access log summary
.venv/bin/python manage.py summarize_access_logs --date YYYY-MM-DD

# Game server (bumpercar-spiky-server/) — local dev only
node server.js            # Production mode
PORT=8081 node server.js  # Dev (port 8080 is often occupied locally)
```

## Production Deployment (launchd)

> Docker는 사용하지 않는다. 모든 서비스는 macOS launchd 네이티브 데몬으로 실행.

| Service | launchd label | 동작 | Restart |
|---------|--------------|------|---------|
| Django (gunicorn) | `com.hanplanet.gunicorn` | KeepAlive | `launchctl kickstart -k gui/$(id -u)/com.hanplanet.gunicorn` |
| Game server | `com.hanplanet.bumpercar-spiky-server` | KeepAlive | `launchctl kickstart -k gui/$(id -u)/com.hanplanet.bumpercar-spiky-server` |
| Map collab server | `com.hanplanet.map-collab-server` | KeepAlive | `launchctl kickstart -k gui/$(id -u)/com.hanplanet.map-collab-server` |
| Wargame Apache | `com.hanplanet.wargame-apache` | KeepAlive | `launchctl kickstart -k gui/$(id -u)/com.hanplanet.wargame-apache` |
| Git server (Gitea) | `com.hanplanet.gitea` | KeepAlive | `launchctl kickstart -k gui/$(id -u)/com.hanplanet.gitea` |
| Celery worker | `com.hanplanet.celery` | KeepAlive | `launchctl kickstart -k gui/$(id -u)/com.hanplanet.celery` |
| Nginx | `com.hanplanet.nginx` | KeepAlive | `launchctl kickstart -k gui/$(id -u)/com.hanplanet.nginx` |
| HDD 마운트 | `com.hanplanet.mount-hanplanet-hdd` | RunAtLoad (1회) | `launchctl kickstart gui/$(id -u)/com.hanplanet.mount-hanplanet-hdd` |
| 헬스체크 | `com.hanplanet.healthcheck` | 60초마다 | `launchctl kickstart gui/$(id -u)/com.hanplanet.healthcheck` |
| HDD .DS_Store 정리 | `com.hanplanet.external-hdd-keepalive` | 600초마다 | `launchctl kickstart gui/$(id -u)/com.hanplanet.external-hdd-keepalive` |

**Plist 위치:**
- `deploy/launchd/` — Django, Gitea, Celery, Nginx, 헬스체크 (저장소에 포함)
- `bumpercar-spiky-server/deploy/launchd/` — 게임 서버
- `map-collab-server/deploy/launchd/` — 맵 협업 서버
- `Wargame/deploy/launchd/` — Wargame 전용 Apache
- `~/Library/LaunchAgents/` only — HDD 마운트, HDD .DS_Store 정리 (저장소 미포함, 수동 설치)

### Django 변경 후 운영 적용

```bash
.venv/bin/python manage.py collectstatic --noinput
./scripts/restart_gunicorn_and_wait.py
```

체크 순서:
1. `static/css/*`, `static/js/*`, 또는 이를 참조하는 템플릿을 수정했으면 먼저 `collectstatic --noinput` 실행 (`0 copied` 여도 실행)
2. `./scripts/restart_gunicorn_and_wait.py` 실행
3. 상태 확인: `launchctl print gui/$(id -u)/com.hanplanet.gunicorn | sed -n '1,30p'` → `state = running` 확인
4. 브라우저에서 변경이 안 보이면 서버 문제보다 브라우저 캐시를 먼저 의심 → hard refresh로 확인

### Game server 변경 후 운영 적용

```bash
launchctl kickstart -k gui/$(id -u)/com.hanplanet.bumpercar-spiky-server
# 확인: tail -f /tmp/bumpercar-spiky-server.log
```

### Wargame Apache 변경 후 운영 적용

```bash
httpd -t -f /Users/imhanbyeol/Development/Hanplanet/Wargame/deploy/apache/httpd-wargame.conf
launchctl kickstart -k gui/$(id -u)/com.hanplanet.wargame-apache
# 확인: curl -I http://localhost:8090/
```

### Celery worker 변경 후 운영 적용

```bash
launchctl kickstart -k gui/$(id -u)/com.hanplanet.celery
# 확인: tail -f log/celery.stdout.log
```

### 헬스체크 (`com.hanplanet.healthcheck`)

`scripts/healthcheck_and_restart.py` — 60초마다 실행:
1. `https://www.hanplanet.com/` → **502** 감지: gunicorn 프로세스 자체가 다운된 상태
2. `https://www.hanplanet.com/media/healthcheck.txt` → **503** 감지: gunicorn은 살아있지만 HDD 마운트 전에 시작돼 미디어를 못 읽는 상태

두 경우 모두 `launchctl kickstart -k`로 gunicorn 재시작 후 HTTP 준비 확인. 쿨다운 180초.

- 로그: `~/Library/Logs/hanplanet-healthcheck.out.log`
- sentinel 파일: `/Volumes/HANPLANET_HDD/Hanplanet/media/healthcheck.txt`

### HDD .DS_Store 정리 (`com.hanplanet.external-hdd-keepalive`)

`scripts/cleanup_hdd_ds_store.py` — 600초마다 `/Volumes/HANPLANET_HDD/` 전체 재귀 탐색해 `.DS_Store` 삭제.

- 로그: `/tmp/com.hanplanet.external-hdd-keepalive.stdout.log`

### HDD 마운트 (`com.hanplanet.mount-hanplanet-hdd`)

로그인 시 1회 `diskutil mount HANPLANET_HDD` 실행. HDD가 마운트되지 않은 채로 gunicorn이 먼저 뜨면 미디어 파일 503이 발생하며, 헬스체크가 이를 감지해 자동 재시작한다.

## Project Structure

- `config/`: Django project settings, URLs, and ASGI/WSGI entry points.
- `main/`: Primary Django app — models, views, URLs, admin, migrations.
- `templates/main/`: Portfolio page templates.
- `templates/fun/`: Mini-game templates (Salvations_Edge_4, Stratagem_Hero, bumpercar-spiky, etc.).
- `templates/handrive/`: Document editor templates.
- `templates/partials/`: Shared reusable partials (including `ui_i18n.html` for all i18n strings).
- `templates/popup/`: Popup/modal templates (never inline in page templates).
- `static/`: Source static assets; `staticfiles/` is the collected output — do not edit directly.
- `media/`: User-uploaded images and files.
- `manage.py`: Django management entry point.
- `requirements.txt`: Python dependencies.
- `bumpercar-spiky-server/`: Separate Node.js WebSocket game server (see its own `AGENTS.md`).
- `Wargame/`: Separate Apache + PHP + SQLite site for `wargame.hanplanet.com`; Django APIs may be used only for non-challenge site integration such as account identity, solve records, and shared navigation (see `Wargame/AGENTS.md`).

## Architecture

This is a Django 5.0.1 portfolio + content management + multiplayer game platform.

**Backend (`main/`):**
- `views.py` (~155KB) — main page views
- `handrive_views.py` (~145KB) — document editor (HanDrive) views
- `models.py` — `Project`, `Project_Tag`, `Project_Comment`, `Career` models
- `middleware.py` — global rate limiting (240 req/60s, file-based cache)

**Static assets:**
- `main/templatetags/static_versioned.py` — provides `static_v` tag that appends `?v=<mtime>` for cache busting

**Game server (`bumpercar-spiky-server/`):**
- Separate Node.js WebSocket server (port 8080/8081)
- Django issues JWT tokens at `/api/game-auth-token/`; game server verifies them
- `world/world.js` — core game simulation; `world/spatialGrid.js` — AOI optimization

**AI chatbot:** Ollama at `http://localhost:11434` (default model: `gemma4:12b`, injected via `OLLAMA_MODEL`), accessed via `/api/chat/`

**OpenHarness AI 프록시:** Django `ai` 앱이 Ollama를 외부에 OpenAI-compatible API로 노출한다.
- 엔드포인트: `https://hanplanet.com/ai/v1`
- 인증: `Authorization: Bearer <OLLAMA_PROXY_API_KEY>` (secrets.json 참고)
- 지원 경로: `POST /ai/v1/chat/completions`, `GET /ai/v1/models`
- OpenHarness 설정: `oh setup` → OpenAI-compatible → Base URL `https://hanplanet.com/ai/v1` → API Key = `OLLAMA_PROXY_API_KEY` 값

**Infrastructure:** Gunicorn → Nginx → Cloudflare Tunnel → hanplanet.com

**Wargame integration boundary:** `wargame.hanplanet.com` runs as its own Apache + PHP + SQLite app under `Wargame/`, listens on its own local port, and Cloudflare Tunnel routes the hostname directly to that port. PHP must not directly read Django DB/session/cookie/filesystem state. Django site APIs may be used only for non-challenge integration such as token-based identity, solve read/write, and navbar/common UI; do not use Django APIs for challenge mechanics, vulnerable problem files, flags, hints, or challenge-local data. Challenge-local data remains in `Wargame/data/wargame.sqlite3`.

**Git 서버:** Gitea (Homebrew, `/opt/homebrew/bin/gitea`, 포트 3000) + Celery Worker (Redis 브로커) — HanDrive 폴더를 Git 저장소로 변환하는 비동기 작업 처리.

## Configuration

Secrets go in `config/secrets.json` (git-ignored). Key env vars:
- `DJANGO_DEBUG`, `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`
- `OLLAMA_BASE_URL`, `OLLAMA_MODEL` (launchd sets `gemma4:12b` by default)
- `OLLAMA_PROXY_API_KEY` — OpenHarness 프록시 인증 키 (secrets.json에 저장, 비어있으면 인증 없음)
- `GAME_JWT_SECRET`, `GAME_WS_PUBLIC_URL`
- `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` (Cloudflare CAPTCHA)
- `FORGEJO_BASE_URL` — Gitea 서버 주소 (기본: `http://localhost:3000`)
- `FORGEJO_ADMIN_TOKEN` — Gitea 관리자 API 토큰 (repo 생성/collaborator 관리용)
- `PUBLIC_GIT_BASE_URL` — 외부 노출 Git URL (운영: `https://hanplanet.com/git`)
- `GITHUB_AUTH_SCOPE` — GitHub OAuth 권한 범위 (기본: `repo user:email`, collaborator/private repo 목록 조회용)

Do not commit API keys or secrets. Production uses `DEBUG = False`.

## Coding Style & Naming Conventions

- Python: 4-space indentation, PEP 8 naming (`snake_case` for functions/vars, `CamelCase` for models/classes).
- Django conventions: app modules in `main/`, URL routes in `config/urls.py` and `main/urls.py`.
- No formatter or linter is enforced — keep changes small and consistent with existing style.
- Commit messages: short, descriptive (Korean is fine).

## UI Rules

- **Never use `!important` in CSS.** Use correct selector specificity or CSS load order instead. `gitea_ui.css` is the last loaded stylesheet on Forgejo pages — rules there win without `!important`.
- Do not change visual design, responsive breakpoints, or animations unless explicitly requested.
- Do not break responsive mode-switch timing or breakpoint behavior when viewport size changes.
- Keep existing transition/animation behavior intact unless explicitly requested.
- Korean/English UI strings must go in `templates/partials/ui_i18n.html` — no per-view duplicates.
- Repeated or similar UI designs must be implemented with shared markup, CSS, and JS behavior wherever practical. Do not create page-specific duplicate controls or styles when a common component/class can express the same role.
- Class and ID names for shared UI must describe the common role or component (`*-file-meta-*`, `*-modal-*`, `*-toolbar-*`, etc.), not the first page or feature where they happened to be introduced. Keep feature-specific names only for genuinely unique behavior or API hooks.
- Account popup UI (`ide-auth-account-menu`) must be maintained as a separate shared partial template — do not duplicate popup markup across page templates.
- Popup/modal markup must live in `templates/popup/` or `templates/partials/` — never inline in page templates.
- Popups with similar structure should be merged into a shared base partial and parameterized includes instead of duplicated HTML blocks.
- 공통 팝업에서 재사용하는 class 명은 기능명(`rename`, `auth_logout` 등)으로 두지 말고, `handrive-popup-*` 같은 공용 이름으로 다시 지정한다.
- Static assets should be split by responsibility — do not grow monolithic `style.css` or single JS files.

## Testing Guidelines

- Tests live in `main/tests.py` using Django's test framework.
- Run all tests with `python manage.py test`.
- No coverage threshold is defined; add tests when you change model logic or views.

## Commit & Pull Request Guidelines

- Commit history uses short, descriptive messages (often Korean). Keep messages concise and task-focused.
- PRs should include: a brief summary, key files/paths touched, and screenshots for UI changes (templates/static).
- Link related issues or deployment notes when relevant (e.g., migrations or `collectstatic`).

## Git 서버 (Gitea + Celery)

**구성:**
- **Gitea** — Homebrew 설치 (`brew install gitea`), 포트 3000, SQLite DB
  - 바이너리: `/opt/homebrew/bin/gitea`
  - 설정: `forgejo/custom/conf/app.ini`
  - work-path: `forgejo/` (data, log, custom 하위 디렉토리)
  - launchd: `com.hanplanet.gitea`
- **Redis** — Celery 브로커 (`redis://127.0.0.1:6379/0`), `brew services start redis`
- **Celery Worker** — `django-celery-results` 백엔드, concurrency=2
  - launchd: `com.hanplanet.celery`
  - 로그: `log/celery.stdout.log`, `log/celery.stderr.log`

**Django 모델:** `GitRepository`, `GitUserMapping`, `GitCollaborator` (`main/models.py`)

**Celery 태스크** (`main/git_tasks.py`):
- `create_repo_task(repo_id)` — 일반 폴더 → Gitea repo 생성 + 파일 push
- `import_repo_task(repo_id)` — 기존 `.git` 폴더 → Gitea mirror push 후 `.git` 삭제

**API 엔드포인트:**
- `POST /api/git/repos/` — repo 생성 요청
- `GET /api/git/repos/by-path/` — 경로로 repo 조회
- `GET /api/git/repos/<id>/status/` — 상태 폴링 (pending/active/failed)
- `POST /api/git/repos/<id>/retry/` — 실패 시 재시도
- `GET /api/git/repos/<id>/clone/` — clone URL 반환
- `POST /api/git/repos/<id>/collaborators/` — collaborator 추가

**Gitea 초기 설정:** `forgejo/setup.sh` 실행 → 출력된 토큰을 `config/secrets.json`의 `FORGEJO_ADMIN_TOKEN`에 저장.

**Git 서버 관련 gitignore 항목:** `forgejo/bin/`, `forgejo/data/`, `forgejo/log/`

### Forgejo 커스텀 테마 구조

커스텀 파일 위치:
- 템플릿: `forgejo/custom/templates/` (Gitea 내장 템플릿 오버라이드)
- 에셋: `forgejo/custom/public/assets/` — **www.hanplanet.com과 공유하는 공통 에셋**

> ⚠️ **에셋 우선 원칙 — 반드시 준수:**
> - **Forgejo 전용 CSS 오버라이드 파일을 따로 만들지 않는다.** Gitea 기본 디자인을 별도 파일로 덮어쓰지 않는다.
> - **운영 캐시 주의:** Windows Chrome/Edge에서 Forgejo 기본 CSS(`index.css`, `theme-gitea-auto.css`)만 stale 캐시가 남고, 커스텀 CSS는 정상 갱신되는 경우가 있었다. 이 경우 Gitea 원본 스타일이 "안 먹는 것처럼" 보인다.
> - **대응 규칙:** `forgejo/custom/templates/custom/header.tmpl`에서 기본 Gitea CSS도 cache-buster 쿼리로 다시 로드한다. 예: `/assets/css/index.css?v={{AppVer}}-orig1`, `/assets/css/theme-gitea-auto.css?v={{AppVer}}-orig1`
> - **판단 기준:** macOS 브라우저는 정상인데 Windows 브라우저만 Gitea 원본 CSS가 빠진 것처럼 보이면, 서버 렌더링보다 stale asset 캐시를 먼저 의심한다.
> - **검증:** `curl -s https://git.hanplanet.com/ | sed -n '124,140p'` 로 실제 HTML의 CSS 링크 버전을 확인하고, `curl -I 'https://git.hanplanet.com/assets/css/index.css?v=<version>'` 로 새 URL이 `200`으로 내려오는지 확인한다.

## 외장 스토리지 (APFS RAID 0)

`media/`와 Gitea 저장소(`forgejo/data/repositories/`)는 외장 APFS RAID 0 볼륨에 위치한다.

| 항목 | 경로 |
|------|------|
| 외장 볼륨 마운트 | `/Volumes/HANPLANET_HDD/` |
| media 실경로 | `/Volumes/HANPLANET_HDD/Hanplanet/media/` |
| Gitea repos 실경로 | `/Volumes/HANPLANET_HDD/Hanplanet/forgejo/data/repositories/` |
| 프로젝트 내 심볼릭 링크 | `media/` → 위 media 경로, `forgejo/data/repositories/` → 위 repos 경로 |

**외장 디스크 미연결 시:** `media/`, `forgejo/data/repositories/` 심볼릭 링크가 깨져 Django 500/503 에러 발생. 헬스체크(`com.hanplanet.healthcheck`)가 503을 감지해 gunicorn을 자동 재시작한다. HDD 연결 없이는 재시작해도 복구되지 않으므로 디스크 연결 후 기다릴 것.

**macOS TCC (Full Disk Access) 주의사항:**
- 외장 볼륨 접근 권한은 launchd 컨텍스트에서 쉘 래퍼를 통해 실행되면 TCC가 적용되지 않는다.
- `.venv/bin/python`은 `#!/bin/sh` 쉘 스크립트이므로 launchd에서 실행 시 TCC가 `/bin/sh`로 인식한다.
- 따라서 **모든 launchd plist는 `.venv/bin/python` 대신 `/usr/bin/python3`를 직접 호출**하고, `EnvironmentVariables`에 `PYTHONPATH`로 venv site-packages를 지정한다.
  - 적용 대상: `com.hanplanet.gunicorn.plist`, `com.hanplanet.celery.plist`, `com.hanplanet.healthcheck.plist`, `scripts/summarize-nginx-access-json.sh`
  - PYTHONPATH 값: `/Users/imhanbyeol/Development/Hanplanet/.venv/lib/python3.9/site-packages`
- 시스템 환경설정 → 개인 정보 보호 및 보안 → 전체 디스크 접근 권한에 `/usr/bin/python3`가 등록되어 있어야 한다.

## Access Logs

- Nginx access log: `/opt/homebrew/var/log/nginx/access_json.log` (JSON format)
- Rotation: `scripts/rotate-nginx-access-json.sh` (30-day retention, file-only — not in DB)
- Daily summary: `summarize_access_logs` command → `/opt/homebrew/var/log/nginx/summaries/`
- Admin view: `/admin/main/accesslog/` (file read mode), summaries at `/admin/main/accesslog-summary/`
- Default scheduler: in-process Django scheduler (00:05 local time, summarizes previous day)
- Optional external scheduler: `deploy/launchd/com.hanplanet.nginx-accesslog-summary.plist`
- Logs are not imported into DB; `AccessLog` model/table and `import_access_logs` command are removed.

## Browser JS Load Incident Notes

Observed symptom: private mode works, but normal profile sometimes fails to apply navbar style, mobile nav toggle, chatbot toggle, and bubble animation at the same time. This indicates stale/blocked JS in a specific browser profile (cache/extension/privacy setting), not a server outage.

Mitigations applied:
- `main/templatetags/static_versioned.py` adds `static_v` tag to append `?v=<mtime>` for static assets.
- Main templates use `static_v` for CSS/JS (`templates/base.html`, `templates/none.html`, `templates/fun/*.html`, `templates/main/ProjectDetail.html`).
- `templates/partials/static_script_fallback.html` adds `window.__reloadStaticScript` and `onerror` retry with cache-buster query.
- `config/settings.py` forces JS MIME mapping to `application/javascript`.

Quick verify:
```bash
curl -s https://hanplanet.com/portfolio/ | rg "script.js\?v=|chat_widget.js\?v=|style.css\?v="
curl -I https://hanplanet.com/static/js/script.js  # should return content-type: application/javascript
```
