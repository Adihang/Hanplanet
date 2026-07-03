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
node server.js            # Run with default PORT
PORT=8081 node server.js  # Dev override (port 8080 is often occupied locally)
```

## Production Deployment (Docker and launchd)

> Docker Compose is the current production runtime. Native macOS launchd plists remain supported as a fallback path, but the services owned by Docker must stay disabled while Docker is running production web traffic.

### Docker production runtime

Quick path:

```bash
cp .env.docker.example .env
docker compose up -d --build
docker compose ps
```

Production traffic path:

1. Host launchd `cloudflared` sends all HTTP hostnames to `http://localhost:80`.
2. Docker Compose publishes `nginx` on host port `80` with `HTTP_PORT=80`.
3. Docker Nginx routes by hostname to `django:8000`, `gitea:3000`, `bumpercar-spiky-server:8080`, `map-collab-server:8083`, and `wargame:8090`.
4. `mc.hanplanet.com` uses Docker Nginx for Django/static/media and proxies BlueMap to host `host.docker.internal:8100`.
5. `ssh.hanplanet.com` remains host SSH at `localhost:22`.

Docker services:

| Service | Role | Public/local port |
|---------|------|-------------------|
| `django` | Django/Gunicorn app, migrations, collectstatic | `${DJANGO_PORT:-8000}` -> `8000` |
| `celery` | Git/HanDrive async worker | internal only |
| `celery-beat` | Celery periodic scheduler for sessions and HanDrive tutorial cleanup | internal only |
| `redis` | Celery broker | internal only |
| `nginx` | Hostname router, static/media, BlueMap proxy | `${HTTP_PORT:-8080}` -> `80`; production uses `80` |
| `gitea` | Git web UI and bare repo service | `${GITEA_PORT:-3000}` -> `3000` |
| `bumpercar-spiky-server` | Game WebSocket + admin API | `${GAME_PORT:-8081}` -> `8080`, `127.0.0.1:${GAME_ADMIN_PORT:-8082}` |
| `map-collab-server` | Map collaboration WebSocket + admin API | `${MAP_COLLAB_PORT:-8083}` -> `8083`, `127.0.0.1:${MAP_COLLAB_ADMIN_PORT:-8084}` |
| `wargame` | Wargame PHP app | `${WARGAME_PORT:-8090}` -> `8090` |

Host services that still remain outside Docker: HPmail Postfix/Dovecot, Minecraft/Paper/BlueMap, Ollama, Cloudflare Tunnel, external HDD mount/cleanup, and host SSH.

macOS Docker production uses `deploy/launchd/com.hanplanet.docker-stack.plist` plus `scripts/start_docker_stack.sh`. The script starts Colima, mounts `$HOME` and `/Volumes/HANPLANET_HDD` when present, waits for the HDD if `.env` references it, then runs `docker compose up -d --remove-orphans`. It also uses `deploy/launchd/com.hanplanet.docker-health-watchdog.plist` plus `scripts/docker_health_watchdog.sh` every 60 seconds to inspect Docker healthchecks and run `docker compose restart <service>` for services whose health is `unhealthy`.

While Docker owns web traffic, keep these native web launchd labels disabled: `com.hanplanet.gunicorn`, `com.hanplanet.nginx`, `com.hanplanet.gitea`, `com.hanplanet.celery`, `com.hanplanet.bumpercar-spiky-server`, `com.hanplanet.map-collab-server`, `com.hanplanet.wargame-apache`, `com.hanplanet.healthcheck`, and `homebrew.mxcl.nginx`.

### Docker change application

Use Docker commands for production unless the user explicitly asks for native launchd:

```bash
# Django/templates/static/Python dependency changes
docker compose up -d --build django celery celery-beat nginx

# Nginx routing/config changes
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload

# Gitea custom templates/assets/image changes
docker compose up -d --build gitea nginx

# Node game server changes
docker compose up -d --build bumpercar-spiky-server nginx

# Map collaboration server changes
docker compose up -d --build map-collab-server nginx

# Wargame changes
docker compose up -d --build wargame nginx
```

Verification:

```bash
docker compose ps
docker compose logs --since=10m nginx django celery celery-beat gitea bumpercar-spiky-server map-collab-server wargame
curl -I https://www.hanplanet.com/
curl -I https://git.hanplanet.com/
curl -fsS https://mc.hanplanet.com/status.json >/dev/null
curl -I https://mc.hanplanet.com/map/
curl -I https://wargame.hanplanet.com/
```

### Native launchd fallback

The native launchd path remains documented because these stable paths still exist and some host services still use launchd. Do not use these commands for Docker-owned production services unless switching intentionally away from Docker.

launchd service map:

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

### Native Django 변경 후 운영 적용

```bash
.venv/bin/python manage.py collectstatic --noinput
./scripts/restart_gunicorn_and_wait.py
```

체크 순서:
1. `static/css/*`, `static/js/*`, 또는 이를 참조하는 템플릿을 수정했으면 먼저 `collectstatic --noinput` 실행 (`0 copied` 여도 실행)
2. `./scripts/restart_gunicorn_and_wait.py` 실행
3. 상태 확인: `launchctl print gui/$(id -u)/com.hanplanet.gunicorn | sed -n '1,30p'` → `state = running` 확인
4. 브라우저에서 변경이 안 보이면 서버 문제보다 브라우저 캐시를 먼저 의심 → hard refresh로 확인

### Native game server 변경 후 운영 적용

```bash
launchctl kickstart -k gui/$(id -u)/com.hanplanet.bumpercar-spiky-server
# 확인: tail -f /tmp/bumpercar-spiky-server.log
```

### Native Wargame Apache 변경 후 운영 적용

```bash
httpd -t -f /Users/imhanbyeol/Development/Hanplanet/Wargame/deploy/apache/httpd-wargame.conf
launchctl kickstart -k gui/$(id -u)/com.hanplanet.wargame-apache
# 확인: curl -I http://localhost:8090/
```

### Native Celery worker 변경 후 운영 적용

```bash
launchctl kickstart -k gui/$(id -u)/com.hanplanet.celery
# 확인: tail -f log/celery.stdout.log
```

### Native 헬스체크 (`com.hanplanet.healthcheck`)

Docker production keeps `com.hanplanet.healthcheck` disabled and relies on Compose healthchecks, `restart: unless-stopped`, and `com.hanplanet.docker-health-watchdog` to restart containers whose Docker health status becomes `unhealthy`. The native fallback healthcheck is `scripts/healthcheck_and_restart.py`, 60초마다 실행:
1. `https://www.hanplanet.com/` → **502** 감지: gunicorn 프로세스 자체가 다운된 상태
2. `https://www.hanplanet.com/media/healthcheck.txt` → **503** 감지: gunicorn은 살아있지만 HDD 마운트 전에 시작돼 미디어를 못 읽는 상태

두 경우 모두 `launchctl kickstart -k`로 gunicorn 재시작 후 HTTP 준비 확인. 쿨다운 180초.

- 로그: `~/Library/Logs/hanplanet-healthcheck.out.log`
- sentinel 파일: `/Volumes/HANPLANET_HDD/Hanplanet/media/healthcheck.txt`

### HDD .DS_Store 정리 (`com.hanplanet.external-hdd-keepalive`)

`scripts/cleanup_hdd_ds_store.py` — 600초마다 `/Volumes/HANPLANET_HDD/` 전체 재귀 탐색해 `.DS_Store` 삭제.

- 로그: `/tmp/com.hanplanet.external-hdd-keepalive.stdout.log`

### HDD 마운트 (`com.hanplanet.mount-hanplanet-hdd`)

로그인 시 1회 `diskutil mount HANPLANET_HDD` 실행. Docker production에서는 `.env`가 `/Volumes/HANPLANET_HDD` bind mount를 참조하면 `scripts/start_docker_stack.sh`가 최대 `HANPLANET_HDD_WAIT_SECONDS` 동안 mount를 기다린다. Native fallback에서는 HDD가 마운트되지 않은 채로 gunicorn이 먼저 뜨면 미디어 파일 503이 발생하며, 헬스체크가 이를 감지해 자동 재시작한다.

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
- `Dockerfile`: Django/Celery worker/beat shared image.
- `docker-compose.yml`: Docker production stack for Django, Celery worker/beat, Redis, Nginx, Gitea, Bumpercar, Map Collab, and Wargame.
- `docker/`: Docker-only runtime files: Django entrypoint, Nginx config, Gitea image, optional Cloudflared config.
- `bumpercar-spiky-server/`: Separate Node.js WebSocket game server (see its own `AGENTS.md`).
- `map-collab-server/`: Separate Node.js WebSocket/admin server for HanDrive map collaboration.
- `Wargame/`: Separate PHP + SQLite site for `wargame.hanplanet.com`; Docker uses a PHP built-in server and native launchd uses Apache. Django APIs may be used only for non-challenge site integration such as account identity, solve records, and shared navigation (see `Wargame/AGENTS.md`).
- `deploy/launchd/com.hanplanet.docker-stack.plist`: macOS launchd wrapper for Docker production startup.
- `deploy/launchd/com.hanplanet.docker-health-watchdog.plist`: macOS launchd timer that restarts unhealthy Docker Compose services.
- `scripts/start_docker_stack.sh`: Colima + Docker Compose startup script used by the Docker launchd plist.
- `scripts/docker_health_watchdog.sh`: Docker Compose health watchdog used by the Docker health launchd plist.
- `docs/plans/`: Development plans and product notes.
- `docs/samples/`: Preserved samples, HTML dumps, and reference outputs.
- `.local/`: Local-only preserved scratch artifacts; git-ignored.

**launchd-sensitive stable paths:** repository launchd plists and installed LaunchAgents use absolute paths and `WorkingDirectory` values for `scripts/`, `nginx/`, `forgejo/`, `bumpercar-spiky-server/`, `map-collab-server/`, `Wargame/`, `docker-compose.yml`, `docker/`, and `storage_profile.py`. Docker production additionally depends on `HANPLANET_APP_DIR` or the absolute project path inside `deploy/launchd/com.hanplanet.docker-stack.plist`. Do not move these paths unless you update the plist files, docs, `.env`, and installed LaunchAgents together.

Generated verification output and scratch files do not belong in source control. Keep `output/`, `tmp/`, `test-results/`, `.playwright*`, HPmail generated/backups, and built sync-client binaries out of Git; use `.local/` for local preservation when needed.

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

**AI chatbot:** Ollama is a host service; Docker reaches it at `http://host.docker.internal:11434` and native launchd reaches it at `http://localhost:11434`. The model is injected via `OLLAMA_MODEL`, accessed via `/api/chat/`.

**OpenHarness AI 프록시:** Django `ai` 앱이 Ollama를 외부에 OpenAI-compatible API로 노출한다.
- 엔드포인트: `https://hanplanet.com/ai/v1`
- 인증: `Authorization: Bearer <OLLAMA_PROXY_API_KEY>` (`.env` 또는 native `config/secrets.json` 참고)
- 지원 경로: `POST /ai/v1/chat/completions`, `GET /ai/v1/models`
- OpenHarness 설정: `oh setup` → OpenAI-compatible → Base URL `https://hanplanet.com/ai/v1` → API Key = `OLLAMA_PROXY_API_KEY` 값

**Infrastructure:** Cloudflare Tunnel (host launchd) -> Docker Nginx `:80` -> Docker services. Host services that remain outside Docker are reached from containers through `host.docker.internal`.

**Wargame integration boundary:** `wargame.hanplanet.com` routes through Docker Nginx to the Docker `wargame:8090` service. Native launchd fallback uses Apache + PHP under `Wargame/`. PHP must not directly read Django DB/session/cookie/filesystem state. Django site APIs may be used only for non-challenge integration such as token-based identity, solve read/write, and navbar/common UI; do not use Django APIs for challenge mechanics, vulnerable problem files, flags, hints, or challenge-local data. Challenge-local data remains in `Wargame/data/wargame.sqlite3` or the Docker `WARGAME_DATA_VOLUME`.

**Git 서버:** Docker `gitea` service on port `3000` + Docker `celery` worker/`celery-beat` scheduler + Docker `redis` broker. Native Homebrew Gitea/launchd remains a fallback only.

**Game/admin internal APIs:** Docker Django calls `GAME_ADMIN_URL=http://bumpercar-spiky-server:8082` and `MAP_COLLAB_ADMIN_URL=http://map-collab-server:8084`. The host-published admin ports are bound to `127.0.0.1` only. Bumpercar runtime settings are shared through `BUMPERCAR_SPIKY_SETTINGS_PATH` on `DJANGO_DATA_VOLUME`, and stats writes require `BUMPERCAR_SPIKY_INTERNAL_SECRET` when they come from non-loopback container addresses.

## Configuration

Docker production reads `.env` through `docker-compose.yml`; start from `.env.docker.example` and override for production. Native launchd fallback may still read `config/secrets.json` (git-ignored). For secrets in Docker, prefer the supported `_FILE` variables with files under `HANPLANET_DOCKER_SECRETS_DIR` when possible.

Key env vars:
- `HANPLANET_RUNTIME=docker`, `HTTP_PORT=80`, `PUBLIC_BASE_URL=https://www.hanplanet.com`
- `DJANGO_DEBUG=false`, `DJANGO_SECRET_KEY` or `DJANGO_SECRET_KEY_FILE`, `DJANGO_ALLOWED_HOSTS`, `DJANGO_CSRF_TRUSTED_ORIGINS`
- `DJANGO_SQLITE_PATH=/data/django/db.sqlite3`, `RUN_MIGRATIONS`, `COLLECTSTATIC_ON_START`, `GUNICORN_WORKERS`, `GUNICORN_TIMEOUT`
- `HANPLANET_MEDIA_ROOT=/data/media`, `HANPLANET_FORGEJO_REPOS_ROOT=/data/forgejo-repos`, `HANPLANET_GITHUB_REPO_CACHE_ROOT=/data/github-repo-cache`, `HPMAIL_STORAGE_ROOT=/data/mail`, `DATA_BACKUP_ROOT=/data/backups`
- `DJANGO_DATA_VOLUME`, `HANPLANET_MEDIA_VOLUME`, `HANPLANET_MAIL_VOLUME`, `HANPLANET_GITHUB_CACHE_VOLUME`, `FORGEJO_REPOS_VOLUME`, `GITEA_DATA_VOLUME`, `REDIS_DATA_VOLUME`, `WARGAME_DATA_VOLUME`, `MINECRAFT_SERVER_VOLUME`
- `CELERY_BROKER_URL=redis://redis:6379/0`
- `FORGEJO_BASE_URL=http://gitea:3000`, `FORGEJO_ADMIN_TOKEN` or `FORGEJO_ADMIN_TOKEN_FILE`, `PUBLIC_GIT_BASE_URL=https://git.hanplanet.com`, `GITEA_DOMAIN=git.hanplanet.com`, `GITEA_SSH_DOMAIN=git.hanplanet.com`
- `GAME_JWT_SECRET` or `GAME_JWT_SECRET_FILE`, `GAME_WS_PUBLIC_URL=wss://game.hanplanet.com`, `GAME_WS_LOCAL_URL=ws://bumpercar-spiky-server:8080`, `GAME_ADMIN_URL=http://bumpercar-spiky-server:8082`
- `BUMPERCAR_SPIKY_SETTINGS_PATH=/data/django/bumpercar_spiky_settings.json`, `BUMPERCAR_SPIKY_INTERNAL_SECRET` or `BUMPERCAR_SPIKY_INTERNAL_SECRET_FILE`
- `MAP_COLLAB_WS_PUBLIC_URL=wss://map-collab.hanplanet.com`, `MAP_COLLAB_WS_LOCAL_URL=ws://map-collab-server:8083`, `MAP_COLLAB_ADMIN_URL=http://map-collab-server:8084`
- `SYNC_JWT_SECRET` or `SYNC_JWT_SECRET_FILE`
- `OLLAMA_BASE_URL=http://host.docker.internal:11434`, `OLLAMA_MODEL`, `OLLAMA_PROXY_API_KEY` or `OLLAMA_PROXY_API_KEY_FILE`
- `HPMAIL_IMAP_HOST=host.docker.internal`, `HPMAIL_SMTP_HOST=host.docker.internal`
- `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` (Cloudflare CAPTCHA)
- `BUNGIE_API_KEY`, `BUNGIE_API_BASE_URL`, `BUNGIE_MEDIA_BASE_URL`
- `YOUTUBE_DOWNLOAD_EXTRACTOR_ARGS` — optional yt-dlp extractor override; keep empty unless a current YouTube workaround requires it.
- `GITHUB_AUTH_SCOPE` — GitHub OAuth 권한 범위 (기본: `repo user:email`, collaborator/private repo 목록 조회용)

Do not commit `.env`, API keys, private keys, OAuth client secrets, generated Gitea tokens, or Docker secret files. Production uses `DEBUG = False`.

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
- Before creating new UI controls, loaders, spinners, modals, icons, or other reusable elements, search for and prefer existing shared components/classes/partials. Add page-specific CSS only for placement or documented variable overrides when the shared component already covers the behavior.
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
- Manual/browser testing against the persistent local or production-like DB must use the single fixed test account `codex_test`. Do not create ad-hoc accounts such as `tmp_*`, `*_check`, or feature-specific usernames for each task. If login credentials are needed, reset only this account's password locally and do not write the password into tracked files.
- Django `TestCase`/temporary test databases may still create per-test users inside tests; those users must not be used as persistent manual testing accounts.

## Commit & Pull Request Guidelines

- Commit history uses short, descriptive messages (often Korean). Keep messages concise and task-focused.
- PRs should include: a brief summary, key files/paths touched, and screenshots for UI changes (templates/static).
- Link related issues or deployment notes when relevant (e.g., migrations or `collectstatic`).

## Git 서버 (Gitea + Celery)

**구성:**
- **Gitea Docker service** — `docker/gitea/Dockerfile`, 포트 3000, SQLite DB
  - 설정/템플릿: `forgejo/custom/conf/app.ini`, `forgejo/custom/templates/`
  - 컨테이너 runtime data: `gitea` 컨테이너 `/data`, `django`/`celery` 컨테이너 `/data/gitea` via `GITEA_DATA_VOLUME`
  - Django의 Forgejo direct session DB path: `FORGEJO_DB_PATH=/data/gitea/gitea.db`
  - bare repositories: `/data/git/repositories` via `FORGEJO_REPOS_VOLUME`
  - Docker internal URL: `FORGEJO_BASE_URL=http://gitea:3000`
  - Public URL: `PUBLIC_GIT_BASE_URL=https://git.hanplanet.com`
  - `gitea` depends on healthy `django` so OIDC discovery does not fail with startup-time 502.
- **Redis Docker service** — Celery broker (`redis://redis:6379/0`)
- **Celery Docker service** — `django-celery-results` backend, concurrency=2
  - Logs: `docker compose logs -f celery`
- **Celery beat Docker service** — periodic sessions and HanDrive tutorial workspace cleanup scheduler
  - Logs: `docker compose logs -f celery-beat`
- **Native fallback** — Homebrew Gitea (`/opt/homebrew/bin/gitea`), Redis brew service, and launchd labels `com.hanplanet.gitea`/`com.hanplanet.celery` remain available only when Docker does not own production.

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

**Gitea 초기 설정:** Docker에서는 `gitea` 컨테이너가 뜬 뒤 관리자 토큰을 발급해 `.env`의 `FORGEJO_ADMIN_TOKEN` 또는 `FORGEJO_ADMIN_TOKEN_FILE`에 저장한다. Native fallback에서는 `forgejo/setup.sh` 실행 → 출력된 토큰을 `config/secrets.json`의 `FORGEJO_ADMIN_TOKEN`에 저장.

**Git 서버 관련 gitignore 항목:** `forgejo/bin/`, `forgejo/data/`, `forgejo/log/`, `.local/docker-secrets/`

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

## 외장 스토리지와 Docker volumes

Docker production stores runtime data through Compose volumes or bind mounts. For production clones, set these in `.env` instead of relying on repository-local generated data.

| Purpose | Docker env | Container path | Typical production bind mount |
|---------|------------|----------------|-------------------------------|
| Django SQLite/settings | `DJANGO_DATA_VOLUME` | `/data/django` | `/Volumes/HANPLANET_HDD/Hanplanet/django-data` or named volume |
| Uploaded media/HanDrive files | `HANPLANET_MEDIA_VOLUME` | `/data/media` | `/Volumes/HANPLANET_HDD/Hanplanet/media` |
| HPmail storage used by Django UI | `HANPLANET_MAIL_VOLUME` | `/data/mail` | host mail storage path or named volume |
| GitHub cache | `HANPLANET_GITHUB_CACHE_VOLUME` | `/data/github-repo-cache` | `/Volumes/HANPLANET_HDD/Hanplanet/github-repo-cache` |
| Gitea bare repositories | `FORGEJO_REPOS_VOLUME` | `/data/forgejo-repos`, `/data/git/repositories` | `/Volumes/HANPLANET_HDD/Hanplanet/forgejo-repos` |
| Gitea DB/config/runtime | `GITEA_DATA_VOLUME` | `/data` in `gitea`, `/data/gitea` in Django/Celery | `/Volumes/HANPLANET_HDD/Hanplanet/gitea` or named volume |
| Backups | `HANPLANET_BACKUP_VOLUME` | `/data/backups` | `/Volumes/HANPLANET_HDD/Hanplanet/backups` |
| Wargame SQLite/data | `WARGAME_DATA_VOLUME` | `/app/Wargame/data` | `/Volumes/HANPLANET_HDD/Hanplanet/wargame-data` or named volume |
| Minecraft host server | `MINECRAFT_SERVER_VOLUME` | `/Users/imhanbyeol/Development/minecraft` | `/Users/imhanbyeol/Development/minecraft` |

`scripts/start_docker_stack.sh` waits for `/Volumes/HANPLANET_HDD` when `.env` references that mount, then starts Colima with the HDD mounted into the VM. If the bind mount is missing, containers may still start with empty named volumes or broken paths, but media, Git repositories, Minecraft status, or BlueMap-adjacent views can fail.

Native fallback still uses `DISC`/`storage_profile.py` and may keep `media/` and Forgejo repository roots as symlinks into the APFS RAID 0 volume:

| 항목 | 경로 |
|------|------|
| 외장 볼륨 마운트 | `/Volumes/HANPLANET_HDD/` |
| media 실경로 | `/Volumes/HANPLANET_HDD/Hanplanet/media/` |
| Gitea repos 실경로 | `/Volumes/HANPLANET_HDD/Hanplanet/forgejo-repos/` |
| native symlink examples | `media/` -> 위 media 경로, `forgejo/data/repos/` -> 위 repos 경로 |

**외장 디스크 미연결 시:** Docker production은 `scripts/start_docker_stack.sh`의 wait 단계와 Compose healthchecks를 먼저 확인한다. Native fallback은 `media/` 또는 Forgejo repo symlink가 깨져 Django 500/503 에러가 발생할 수 있으며, `com.hanplanet.healthcheck`가 503을 감지해 gunicorn을 자동 재시작한다. HDD 연결 없이는 재시작해도 복구되지 않으므로 디스크 연결 후 기다릴 것.

**macOS TCC (Full Disk Access) 주의사항:**
- 외장 볼륨 접근 권한은 launchd 컨텍스트에서 쉘 래퍼를 통해 실행되면 TCC가 적용되지 않는다.
- `.venv/bin/python`은 `#!/bin/sh` 쉘 스크립트이므로 launchd에서 실행 시 TCC가 `/bin/sh`로 인식한다.
- 따라서 **모든 launchd plist는 `.venv/bin/python` 대신 `/usr/bin/python3`를 직접 호출**하고, `EnvironmentVariables`에 `PYTHONPATH`로 venv site-packages를 지정한다.
  - 적용 대상: `com.hanplanet.gunicorn.plist`, `com.hanplanet.celery.plist`, `com.hanplanet.healthcheck.plist`, `scripts/summarize-nginx-access-json.sh`
  - PYTHONPATH 값: `/Users/imhanbyeol/Development/Hanplanet/.venv/lib/python3.9/site-packages`
- 시스템 환경설정 → 개인 정보 보호 및 보안 → 전체 디스크 접근 권한에 `/usr/bin/python3`가 등록되어 있어야 한다.

## Access Logs

- Docker Nginx writes JSON access logs to `/var/log/nginx/access_json.log` inside the `nginx` container. Use `docker compose logs -f nginx` unless that file is explicitly mounted to the host.
- Native Nginx access log: `/opt/homebrew/var/log/nginx/access_json.log` (JSON format)
- Native rotation: `scripts/rotate-nginx-access-json.sh` (30-day retention, file-only — not in DB)
- Daily summary: `summarize_access_logs` command reads the configured Nginx JSON log path and writes summaries under the Nginx summaries directory.
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
