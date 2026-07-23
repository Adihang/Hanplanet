# Hanplanet Wargame

`wargame.hanplanet.com`은 Apache + PHP + SQLite로 실행되는 독립 학습 포털입니다. 공개 웹 루트는 `public/`뿐이며, 실습 상태·세션·메일 전송 상태는 모두 `Wargame/data/` 안에 둡니다.

## 보안 경계

- PHP는 Django DB, 세션 저장소, 모델, `config/`, `main/`, `media/`, Redis, Celery, Gitea 또는 게임 서버 파일을 직접 읽지 않습니다.
- Django 연동은 Hanplanet OIDC Authorization Code + PKCE 로그인으로 시작하고, 콜백 이후 서버 간 Wargame API 호출에만 Bearer token을 사용합니다. 계정과 solve 기록은 Wargame SQLite에 저장하지 않습니다.
- solve 쓰기는 Bearer token만으로 허용하지 않습니다. instance 완료 ticket의 SHA-256, 90초 수명의 timestamp/nonce, portal만 가진 `WARGAME_COMPLETION_SECRET` HMAC 영수증이 함께 검증되어야 합니다.
- OIDC access token과 Wargame API Bearer token은 portal의 host-only PHP session에만 보관합니다. HTML, JavaScript, 실습 instance 또는 메일 payload에 넣지 않습니다.
- Lab engine은 Django API와 메일 transport를 사용하지 않으며, instance 전용 SQLite·파일만 다룹니다.
- `public/` 밖의 `app/`, `data/`, `database/`, `deploy/`, `scripts/`는 HTTP로 접근할 수 없습니다.
- 실제 SMTP outbound는 portal의 의뢰 발송 흐름에서만 호출합니다. 실습의 SSRF·명령 실행·메일 기능은 외부 네트워크에 연결하지 않는 격리된 동작이어야 합니다.
- Wargame cookie에는 `Domain`을 지정하지 않습니다. Wargame은 Django session/CSRF cookie를 직접 읽지 않고 OIDC 콜백만 사용합니다.

## 디렉터리

| 경로 | 용도 | 공개 여부 |
| --- | --- | --- |
| `app/` | portal 및 lab application code | 비공개 |
| `public/` | Apache `DocumentRoot` | 공개 |
| `database/schema.sql` | 현재 SQLite schema | 비공개, 읽기 전용 |
| `scripts/init_db.php` | schema 초기화·검증 | 비공개 |
| `data/wargame.sqlite3` | portal의 challenge-local runtime state | 비공개 |
| `data/sessions/` | PHP file session (`0700`) | 비공개 |
| `data/instances/` | instance별 SQLite·파일 | 비공개 |

`data/`에는 사용자 계정, Django session, solve 원본, Django secret을 저장하지 않습니다.

## SQLite schema

현재 schema version은 `1`이며 `schema_meta`와 SQLite `user_version`에 기록됩니다.

- `lab_instances`: opaque owner hash와 challenge instance 수명·상태
- `lab_events`: instance 안에서 발생한 학습 이벤트
- `completion_tickets`: 짧은 수명의 one-time completion ticket hash
- `mission_dispatches`: 학습 mission 안내 전송 상태와 중복 방지 기록

`owner_key_hash`, `access_token_hash`, `ticket_hash`에는 원문 token을 저장하지 않습니다. `users`, `posts`, `solves`, `level*_users`, `level*_flag` 같은 과거 table은 존재하지 않습니다.

초기화는 매 기동 시 실행되며 idempotent합니다. 기존 DB에 `schema_meta`가 없으면 과거 게시판·레벨 DB로 간주하고 SQLite DB, WAL, SHM을 삭제한 뒤 version 1 schema를 새로 만듭니다. 과거 계정·게시물·플래그는 보존하지 않습니다. 새 schema가 이미 있으면 lab state를 유지하면서 table, index, 무결성, foreign key를 다시 확인합니다.

수동 초기화:

```bash
php scripts/init_db.php
```

정상 출력 예:

```text
Initialized /absolute/path/Wargame/data/wargame.sqlite3 at schema version 1.
```

## 메일 transport

앱 자체의 안전 기본값은 실제 메일을 보내지 않는 `preview`이고, Docker Compose 운영 경로는 host HPmail SMTP를 사용하는 `smtp`를 기본값으로 주입합니다. 로컬 UI 개발에서는 명시적으로 `preview`를 사용합니다.

| 환경 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `WARGAME_MAIL_TRANSPORT` | 앱 `preview`, Compose `smtp` | `preview`, `smtp`, `mail` 중 하나 |
| `WARGAME_MAIL_FROM` | `operations@wargame.hanplanet.com` | 의뢰서 발신 envelope 주소 |
| `WARGAME_SMTP_HOST` | HPmail host 또는 `host.docker.internal` | Wargame portal이 연결할 SMTP relay |
| `WARGAME_SMTP_PORT` | `25` | SMTP relay port |
| `WARGAME_SMTP_SECURITY` | `none` | STARTTLS 사용 시 `tls` |
| `WARGAME_SMTP_TLS_PEER_NAME` | SMTP host와 동일 | relay 주소와 인증서 hostname이 다를 때 검증할 인증서 hostname |
| `WARGAME_SMTP_USERNAME` | 없음 | relay 인증 사용자 |
| `WARGAME_SMTP_PASSWORD` | 없음 | relay 인증 비밀번호 |
| `WARGAME_SMTP_TIMEOUT` | `5` | 연결·응답 timeout(초) |
| `WARGAME_PUBLIC_URL` | `https://wargame.hanplanet.com/` | 메일의 미션별 타깃 시작 링크 기준 URL |
| `WARGAME_COMPLETION_SECRET` | 없음 | Django와 Wargame portal에만 동일하게 주입하는 별도 32-byte 이상 random secret (`openssl rand -hex 32` 권장) |

- `preview`: 실제 수신자나 본문 파일을 남기지 않고 `mission_dispatches.status=preview` 상태만 기록합니다.
- `smtp`: 운영 권장 transport입니다. credential은 저장소나 image가 아닌 배포 secret manager가 제공하는 환경 변수로 주입합니다.
- `mail`: PHP `mail()` 호환 경로이며, host MTA가 명확하게 격리된 경우에만 사용합니다.

Portal과 실습 요청은 같은 Apache/PHP worker 환경에서 처리되므로 process-level 환경 변수 자체는 공유됩니다. 다만 실습 요청 경로는 `MissionMailer`나 portal bootstrap을 include하지 않고, `LabEngine`은 환경 변수 조회·외부 socket·shell 호출을 사용하지 않습니다. 더 강한 process-level 분리가 필요한 배포에서는 portal과 target을 별도 PHP-FPM pool/service로 나눠야 합니다.

SMTP 인증(`WARGAME_SMTP_USERNAME`)을 설정하면 `WARGAME_SMTP_SECURITY=tls`가 아니면 fail closed 합니다. `host.docker.internal`을 통해 실제 인증서 hostname이 다른 relay에 연결할 때는 `WARGAME_SMTP_TLS_PEER_NAME`에 인증서의 hostname을 지정하십시오. 운영 시작 전 `WARGAME_COMPLETION_SECRET`과 실제 SMTP relay를 설정한 뒤 Django와 Wargame 서비스를 재생성해야 합니다.

`WARGAME_COMPLETION_SECRET`은 `GAME_JWT_SECRET`, Django `SECRET_KEY`, SMTP password와 다른 값이어야 합니다. Docker Compose에서는 Django와 Wargame 두 서비스에 같은 환경 변수 이름으로 주입되며, 브라우저·메일·instance·SQLite에는 출력하거나 저장하지 않습니다.

## Docker 실행

Docker build context는 상위 `Hanplanet/` 디렉터리입니다.

```bash
cd /Users/imhanbyeol/Development/Hanplanet
docker compose build wargame
docker compose up -d wargame nginx
docker compose ps wargame
```

Docker image는 `app/`, `public/`, `database/`, `scripts/`와 entrypoint만 명시적으로 복사합니다. host의 `Wargame/data/`에 남은 DB, flag, log, screenshot, backup은 image에 들어가지 않습니다. 새 named volume은 image에 미리 들어 있는 runtime 데이터를 물려받지 않습니다.

Apache와 초기화 스크립트는 container 안에서 `www-data` 비루트 사용자로 실행됩니다. bind mount를 사용할 때는 미리 UID/GID 33이 쓸 수 있게 준비합니다.

과거 root container가 만든 기존 named volume은 최초 전환 전에 한 번만 소유권을 바꿉니다. 이 maintenance command 이후의 entrypoint와 Apache는 root로 실행되지 않습니다.

```bash
docker compose run --rm --user root --entrypoint sh wargame -c \
  'mkdir -p /app/Wargame/data/sessions /app/Wargame/data/instances && chown -R 33:33 /app/Wargame/data && chmod 0770 /app/Wargame/data /app/Wargame/data/instances && chmod 0700 /app/Wargame/data/sessions'
```

```bash
sudo install -d -o 33 -g 33 -m 0770 /srv/hanplanet/wargame
sudo install -d -o 33 -g 33 -m 0700 /srv/hanplanet/wargame/sessions
sudo install -d -o 33 -g 33 -m 0770 /srv/hanplanet/wargame/instances
```

상위 Compose는 Wargame host port를 loopback에 고정합니다.

```yaml
ports:
  - "127.0.0.1:${WARGAME_PORT:-8090}:8090"
```

`.env`의 `WARGAME_PORT`에는 포트 숫자만 둡니다. Docker Nginx는 Compose network에서 `wargame:8090`으로 접근하므로 public host port가 필요하지 않습니다.

Docker PHP는 production `php.ini`를 사용하며 다음 값을 강제합니다.

```ini
expose_php = Off
open_basedir = "/app/Wargame:/tmp:/etc/ssl"
disable_functions = exec,passthru,shell_exec,system,proc_open,popen
session.save_path = "/app/Wargame/data/sessions"
session.use_strict_mode = 1
session.use_only_cookies = 1
```

Docker와 native reverse-proxy 경로는 `WARGAME_TRUST_PROXY=1`을 portal request에 전달합니다. Apache의 Docker host port는 loopback으로 제한하고, 외부 client가 임의의 `X-Forwarded-Proto`를 직접 보낼 수 있게 공개하지 않습니다. Nginx 또는 Cloudflare가 전달한 `X-Forwarded-Proto: https`에서만 `Secure` session cookie가 발급됩니다.

## Native Apache fallback

Native fallback은 `localhost:8090`에만 bind합니다. Homebrew PHP-FPM이 `127.0.0.1:9000`에서 실행 중이어야 합니다.

```bash
brew install php
brew services start php
mkdir -p data/sessions data/instances
sudo chown -R _www:staff data
sudo chmod 0770 data data/instances
sudo chmod 0700 data/sessions
sudo -u _www /opt/homebrew/bin/php scripts/init_db.php
httpd -t -f /Users/imhanbyeol/Development/Hanplanet/Wargame/deploy/apache/httpd-wargame.conf
launchctl bootstrap gui/$(id -u) /Users/imhanbyeol/Development/Hanplanet/Wargame/deploy/launchd/com.hanplanet.wargame-apache.plist
launchctl kickstart -k gui/$(id -u)/com.hanplanet.wargame-apache
```

Apache 설정은 다음을 적용합니다.

- `Listen 127.0.0.1:8090`
- 허용 Host: `wargame.hanplanet.com`, `localhost`, `127.0.0.1`
- `ServerTokens Prod`, `ServerSignature Off`, `TraceEnable Off`
- `public/` 전용 `DocumentRoot`, directory listing·`.htaccess`·path info 비활성화
- app/data/database/deploy/scripts 및 DB·SQL·log·backup 확장자 HTTP 차단
- access log에서 query string을 제외해 instance token이 log에 남지 않도록 제한
- `X-Powered-By`와 credentialed CORS header 제거
- FPM request에 trusted-proxy/public URL, `expose_php=Off`, Wargame 경로 `open_basedir`, shell/process 함수 차단, strict file session, `data/sessions` 경로 전달

공용 PHP-FPM pool보다 Wargame 전용 pool/user/socket을 권장합니다. 전용 pool을 쓸 때 `wargame-vhost.conf`의 handler를 Unix socket으로 바꾸고 pool에서 `session.save_path`, `open_basedir`, 메일 환경 변수를 제한합니다. FPM worker 사용자는 `data/`만 쓰고 나머지 Wargame source는 읽기 전용이어야 합니다.

## 검증

PHP와 schema:

```bash
php -l scripts/init_db.php
php scripts/init_db.php
php scripts/init_db.php
php scripts/test_curriculum.php
php scripts/test_labs.php
php scripts/test_portal.php
sqlite3 data/wargame.sqlite3 '.tables'
sqlite3 data/wargame.sqlite3 'PRAGMA integrity_check; PRAGMA foreign_key_check; PRAGMA user_version;'
```

`.tables`에는 `schema_meta`, `lab_instances`, `lab_events`, `completion_tickets`, `mission_dispatches`만 보여야 합니다. 두 번째 초기화가 성공하고 기존 instance를 지우지 않아야 합니다.

Docker:

```bash
docker compose exec -T wargame id
docker compose exec -T wargame apache2ctl -t
docker compose exec -T wargame php -r 'echo ini_get("expose_php"), PHP_EOL, ini_get("session.save_path"), PHP_EOL;'
docker inspect --format '{{.State.Health.Status}}' hanplanet-wargame-1
```

HTTP 경계:

```bash
curl -I -H 'Host: wargame.hanplanet.com' http://127.0.0.1:8090/
curl -I -H 'Host: invalid.example' http://127.0.0.1:8090/
curl -I -H 'Host: wargame.hanplanet.com' http://127.0.0.1:8090/data/wargame.sqlite3
```

정상 Host는 응답하고, 잘못된 Host는 `421`, 비공개 경로는 `403` 또는 `404`여야 합니다. 응답에 `X-Powered-By`, `Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials`가 없어야 합니다.

운영 확인:

```bash
curl -I https://wargame.hanplanet.com/
docker compose logs --since=10m wargame nginx
```

실제 lab에는 이 문서의 portal credential, SMTP credential, Django cookie 또는 Bearer token이 전달되지 않는지 배포 후 다시 확인합니다.

Django 연동 계약 검증:

```bash
cd /Users/imhanbyeol/Development/Hanplanet
.venv/bin/python manage.py test main.tests.WargameApiSecurityTests
```

등록 이메일, stable solve ID, HMAC 완료 영수증, 만료 영수증 거부, 정확한 CORS origin, host-only Django cookie 설정을 함께 검사합니다.
