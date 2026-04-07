# 운영/배포 가이드 (macOS launchd — Docker 미사용)

이 문서는 현재 프로젝트의 운영 배포 방법을 정리합니다.

> **Docker는 현재 사용하지 않습니다.** 모든 서비스는 macOS launchd 네이티브 데몬으로 실행합니다.

현재 기본 구성:

- Django: `config.wsgi:application`, Gunicorn 바인드 `127.0.0.1:8000`
- Nginx: 리버스 프록시 + static/media 서빙
- Cloudflare Tunnel: `hanplanet.com`, `www.hanplanet.com` → `http://localhost:8000`
- Gitea: `http://localhost:3000` (HanDrive Git 기능)
- Redis: `127.0.0.1:6379` (Celery 브로커)
- Celery Worker: git 비동기 태스크 처리
- Ollama: `http://127.0.0.1:11434`

---

## 1. 필수 준비

```bash
cd /Users/imhanbyeol/Development/Hanplanet

# 가상환경 (이미 있으면 생략)
python3 -m venv .venv
source .venv/bin/activate

# 의존성 설치
pip install -r requirements.txt

# DB 마이그레이션
python manage.py migrate

# 정적 파일 수집
python manage.py collectstatic --noinput
```

---

## 2. 시크릿/환경변수 설정

`config/secrets.json` (`.gitignore` 대상):

```json
{
  "SECRET_KEY": "여기에_충분히_긴_랜덤_키",
  "FORGEJO_BASE_URL": "http://localhost:3000",
  "FORGEJO_ADMIN_TOKEN": "gitea-admin-api-token",
  "PUBLIC_GIT_BASE_URL": "https://hanplanet.com/git"
}
```

```bash
chmod 600 config/secrets.json
```

주요 환경변수:

- `DJANGO_DEBUG` (기본: `false`)
- `DJANGO_SECRET_KEY`
- `DJANGO_ALLOWED_HOSTS` (쉼표 구분)
- `DJANGO_CSRF_TRUSTED_ORIGINS` (쉼표 구분, 스킴 포함)
- `PUBLIC_BASE_URL` (예: `https://hanplanet.com`)
- `DJANGO_SERVE_FILES` (기본: `true`)
- `OLLAMA_BASE_URL` (기본: `http://localhost:11434`)
- `OLLAMA_MODEL` (기본: `gemma4:latest`)
- `GAME_JWT_SECRET`, `GAME_JWT_ISSUER`, `GAME_JWT_AUDIENCE`
- `FORGEJO_BASE_URL`, `FORGEJO_ADMIN_TOKEN`, `PUBLIC_GIT_BASE_URL`

---

## 3. 서비스 목록 (launchd)

| 서비스 | 라벨 | plist 위치 |
|--------|------|-----------|
| Django (gunicorn) | `com.hanplanet.gunicorn` | `~/Library/LaunchAgents/` |
| Nginx | `com.hanplanet.nginx` | `~/Library/LaunchAgents/` |
| Git 서버 (Gitea) | `com.hanplanet.gitea` | `deploy/launchd/com.hanplanet.gitea.plist` |
| Celery Worker | `com.hanplanet.celery` | `deploy/launchd/com.hanplanet.celery.plist` |
| 게임 서버 | `com.hanplanet.bumpercar-spiky-server` | `bumpercar-spiky-server/deploy/launchd/` |

공통 명령 패턴:

```bash
# 재시작
launchctl kickstart -k gui/$(id -u)/<라벨>

# 상태 확인
launchctl print gui/$(id -u)/<라벨>

# 목록 확인
launchctl list | grep hanplanet
```

---

## 4. Django (Gunicorn)

상태 확인:

```bash
launchctl print gui/$(id -u)/com.hanplanet.gunicorn
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

재시작:

```bash
launchctl kickstart -k gui/$(id -u)/com.hanplanet.gunicorn
```

**변경 후 운영 적용 순서:**

```bash
.venv/bin/python manage.py collectstatic --noinput
./scripts/restart_gunicorn_and_wait.py
```

---

## 5. Git 서버 (Gitea + Celery)

### 5-1. Gitea 초기 설정 (최초 1회)

```bash
brew install gitea
brew services start redis

cd /Users/imhanbyeol/Development/Hanplanet/forgejo
bash setup.sh
# 출력된 토큰을 config/secrets.json의 FORGEJO_ADMIN_TOKEN에 저장
```

설정 파일: `forgejo/custom/conf/app.ini`

### 5-2. launchd 등록

```bash
# Gitea
cp deploy/launchd/com.hanplanet.gitea.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hanplanet.gitea.plist
launchctl kickstart -k gui/$(id -u)/com.hanplanet.gitea

# Celery
cp deploy/launchd/com.hanplanet.celery.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hanplanet.celery.plist
launchctl kickstart -k gui/$(id -u)/com.hanplanet.celery
```

### 5-3. 상태 확인

```bash
launchctl print gui/$(id -u)/com.hanplanet.gitea
launchctl print gui/$(id -u)/com.hanplanet.celery
tail -f /Users/imhanbyeol/Development/Hanplanet/log/celery.stdout.log
```

### 5-4. Celery 변경 후 운영 적용

```bash
launchctl kickstart -k gui/$(id -u)/com.hanplanet.celery
```

---

## 6. 게임 서버 (bumpercar-spiky)

위치: `bumpercar-spiky-server/`

초기 설치:

```bash
cd bumpercar-spiky-server
cp .env.example .env
npm install
```

launchd 등록:

```bash
cp bumpercar-spiky-server/deploy/launchd/com.hanplanet.bumpercar-spiky-server.plist \
  ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) \
  ~/Library/LaunchAgents/com.hanplanet.bumpercar-spiky-server.plist
launchctl kickstart -k gui/$(id -u)/com.hanplanet.bumpercar-spiky-server
```

**변경 후 운영 적용:**

```bash
launchctl kickstart -k gui/$(id -u)/com.hanplanet.bumpercar-spiky-server
# 확인
tail -f /tmp/bumpercar-spiky-server.log
```

상태/로그:

```bash
launchctl print gui/$(id -u)/com.hanplanet.bumpercar-spiky-server
tail -f /tmp/bumpercar-spiky-server.log
tail -f /tmp/bumpercar-spiky-server-error.log
```

삭제:

```bash
launchctl bootout gui/$(id -u) \
  ~/Library/LaunchAgents/com.hanplanet.bumpercar-spiky-server.plist
rm -f ~/Library/LaunchAgents/com.hanplanet.bumpercar-spiky-server.plist
```

JWT 연동 (Django ↔ 게임 서버 값 반드시 동일):

- Django `secrets.json`: `GAME_JWT_SECRET`, `GAME_JWT_ISSUER`, `GAME_JWT_AUDIENCE`
- 게임 서버 `.env`: `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`

---

## 7. Ollama 서비스

설치:

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull gemma4:latest
```

확인:

```bash
curl http://127.0.0.1:11434/api/tags
```

---

## 8. Cloudflare Tunnel

`~/.cloudflared/config.yml` 예시:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /Users/<USER>/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: www.hanplanet.com
    service: http://localhost:8000
  - hostname: hanplanet.com
    service: http://localhost:8000
  - hostname: ssh.hanplanet.com
    service: ssh://localhost:22
  - service: http_status:404
```

실행:

```bash
cloudflared tunnel ingress validate
cloudflared tunnel run <TUNNEL_NAME>
```

SSH 보안 권장:

- Cloudflare Access에서 `ssh.hanplanet.com` 애플리케이션 생성, MFA 필수
- 서버 22 포트는 인터넷 직접 노출 금지, Cloudflare 경유만 허용

클라이언트 `~/.ssh/config`:

```sshconfig
Host ssh.hanplanet.com
  User <SSH_USER>
  ProxyCommand /opt/homebrew/bin/cloudflared access ssh --hostname %h
```

---

## 9. 정적/미디어 서빙 정책

- `DEBUG=True`: Django 개발용 서빙
- `DEBUG=False` + `DJANGO_SERVE_FILES=true`: Django가 `/static/`, `/media/` 직접 서빙
- `DEBUG=False` + `DJANGO_SERVE_FILES=false`: Nginx alias 서빙 (권장)

---

## 10. 배포 검증 체크리스트

```bash
.venv/bin/python manage.py check
DJANGO_SECRET_KEY='<YOUR_SECRET>' .venv/bin/python manage.py check --deploy

curl -I http://127.0.0.1:8000
curl -I -H 'X-Forwarded-Proto: https' http://127.0.0.1:8000/portfolio/
curl -I https://hanplanet.com

launchctl list | grep hanplanet
```

---

## 11. 트러블슈팅

### Gunicorn 부팅 실패 (`ImproperlyConfigured: DJANGO_SECRET_KEY ... required`)

- `config/secrets.json` 존재 여부 확인
- 또는 서비스에 `DJANGO_SECRET_KEY` 환경변수 주입

### CSS/이미지 404

- `DJANGO_SERVE_FILES=true` 확인
- `collectstatic` 재실행
- gunicorn 재시작

### Celery 태스크 미등록 (`Task not found`)

- Celery worker 재시작: `launchctl kickstart -k gui/$(id -u)/com.hanplanet.celery`
- `config/celery.py`에 `autodiscover_tasks(related_name="git_tasks")` 확인

### Gitea 연결 실패

- Gitea 프로세스 확인: `launchctl print gui/$(id -u)/com.hanplanet.gitea`
- 로그 확인: `tail -f forgejo/log/gitea.stdout.log`
- `FORGEJO_ADMIN_TOKEN` 값 확인

---

## 12. 자주 쓰는 명령

```bash
# 전체 서비스 상태
launchctl list | grep hanplanet

# Gunicorn 프로세스 확인
lsof -nP -iTCP:8000 -sTCP:LISTEN

# Celery 로그
tail -f log/celery.stdout.log

# Gitea 로그
tail -f forgejo/log/gitea.stdout.log

# Nginx 재적용
/opt/homebrew/opt/nginx/bin/nginx -t -c /Users/imhanbyeol/Development/Hanplanet/nginx/nginx.autorun.conf
launchctl kickstart -k gui/$(id -u)/homebrew.mxcl.nginx

# cloudflared 상태
ps aux | grep cloudflared | grep -v grep
curl -I https://hanplanet.com
```

---

## 13. 접속 로그 30일 보관 (Nginx JSON Access Log)

- Nginx 로그 포맷: `nginx/nginx.autorun.conf` (`access_json`)
- 로그 파일: `/opt/homebrew/var/log/nginx/access_json.log`
- 회전/정리 스크립트: `scripts/rotate-nginx-access-json.sh`
- macOS launchd 에이전트: `deploy/launchd/com.hanplanet.nginx-accesslog-rotate.plist`
- 로그 조회: `/admin/main/accesslog/` (파일 직접 조회, DB 미적재)
- 일일 요약 명령어: `python manage.py summarize_access_logs --date YYYY-MM-DD`
- 요약 파일: `/opt/homebrew/var/log/nginx/summaries/access_summary_YYYY-MM-DD.(json|md)`
- 요약 조회: `/admin/main/accesslog-summary/`
- 자동 스케줄: Django 서버 내부 스케줄러 (매일 00:05, 전날 날짜)

### Nginx 재적용

```bash
/opt/homebrew/opt/nginx/bin/nginx -t -c /Users/imhanbyeol/Development/Hanplanet/nginx/nginx.autorun.conf
launchctl kickstart -k gui/$(id -u)/homebrew.mxcl.nginx
```

### 수동 회전 테스트

```bash
./scripts/rotate-nginx-access-json.sh
ls -lh /opt/homebrew/var/log/nginx/access_json*
```

### 자동 회전 등록 (00:05)

```bash
cp deploy/launchd/com.hanplanet.nginx-accesslog-rotate.plist \
  ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) \
  ~/Library/LaunchAgents/com.hanplanet.nginx-accesslog-rotate.plist
launchctl kickstart -k gui/$(id -u)/com.hanplanet.nginx-accesslog-rotate
```

### 일일 요약 수동 생성

```bash
.venv/bin/python manage.py summarize_access_logs --date "$(date -v-1d '+%Y-%m-%d')"
```

---

## 14. Docker (미사용 — 참고용)

> Docker는 현재 사용하지 않습니다. 아래는 이전 설계 참고용 정보입니다.

관련 파일: `docker-compose.yml`, `Dockerfile`, `docker/entrypoint.sh`,
`docker/nginx/default.conf`, `docker/cloudflared/config.yml.example`, `.env.docker.example`
