# Hanplanet Wargame

`https://wargame.hanplanet.com/` 전용 Apache + PHP + SQLite 게시판입니다.

공개 DocumentRoot는 `public/`만 사용하고, SQLite 파일은 `data/wargame.sqlite3`에 둡니다.

## 경로

| 항목 | 경로 |
| --- | --- |
| 앱 루트 | `/Users/imhanbyeol/Development/Hanplanet/Wargame` |
| 공개 루트 | `/Users/imhanbyeol/Development/Hanplanet/Wargame/public` |
| 전용 DB | `/Users/imhanbyeol/Development/Hanplanet/Wargame/data/wargame.sqlite3` |
| Apache vhost 예시 | `deploy/apache/wargame-vhost.conf` |
| Cloudflare Tunnel 예시 | `deploy/cloudflared/ingress-snippet.yml` |

## 초기화

macOS 기본 Apache에는 PHP가 포함되어 있지 않은 경우가 많습니다. PHP가 없다면 Homebrew PHP를 설치하고 PHP-FPM을 실행합니다.

```bash
brew install php
brew services start php
php /Users/imhanbyeol/Development/Hanplanet/Wargame/scripts/init_db.php
```

Apache가 macOS 기본 `_www` 사용자로 실행된다면 DB 쓰기 권한을 부여합니다.

```bash
sudo chown -R _www:_www /Users/imhanbyeol/Development/Hanplanet/Wargame/data
sudo chmod 750 /Users/imhanbyeol/Development/Hanplanet/Wargame/data
sudo chmod 640 /Users/imhanbyeol/Development/Hanplanet/Wargame/data/wargame.sqlite3
```

## Apache

권장 방식은 사용자 권한으로 별도 Apache 인스턴스를 `localhost:8090`에 띄우고 PHP-FPM으로 PHP를 처리하는 것입니다. 기존 Nginx/Django와 프로세스, 포트, 데이터 경로가 분리됩니다.

```bash
httpd -t -f /Users/imhanbyeol/Development/Hanplanet/Wargame/deploy/apache/httpd-wargame.conf
launchctl bootstrap gui/$(id -u) /Users/imhanbyeol/Development/Hanplanet/Wargame/deploy/launchd/com.hanplanet.wargame-apache.plist
launchctl kickstart -k gui/$(id -u)/com.hanplanet.wargame-apache
```

시스템 Apache에 vhost를 포함하려면 `deploy/apache/wargame-vhost.conf`를 Apache 설정에 포함합니다. 이 설정은 Homebrew PHP-FPM의 기본 `127.0.0.1:9000` 리스너를 사용합니다.

예:

```apache
Include /Users/imhanbyeol/Development/Hanplanet/Wargame/deploy/apache/wargame-vhost.conf
```

Apache 설정 검사 후 재시작:

```bash
apachectl configtest
sudo apachectl restart
```

## Cloudflare Tunnel

`~/.cloudflared/config.yml`의 `ingress:` 목록에서 catch-all `http_status:404`보다 위에 추가합니다.

```yaml
  - hostname: wargame.hanplanet.com
    service: http://localhost:8090
```

DNS 라우팅:

```bash
cloudflared tunnel route dns <TUNNEL_NAME> wargame.hanplanet.com
cloudflared tunnel ingress validate
```

## 격리 원칙

- `wargame.hanplanet.com`은 Django, Nginx 앱 라우팅, Node 게임 서버, Celery, Forgejo/Gitea 등 다른 Hanplanet 서비스와 완전히 분리되어 동작해야 합니다.
- Django `db.sqlite3`, `media/`, 세션, 모델, 파일 시스템 상태를 직접 사용하지 않습니다.
- Django API는 워게임 문제 구현에 쓰지 않는 범위에서만 사용할 수 있습니다. 허용 범위는 토큰 기반 사용자 확인, 문제 클리어 저장/읽기, 공통 navbar/사용자 설정 같은 사이트 통합 기능입니다.
- 문제 파일, 플래그, 힌트, 취약점 동작, 문제별 상태는 Wargame 앱 내부 PHP와 `data/wargame.sqlite3`만 사용합니다.
- `.hanplanet.com` 공유 쿠키를 쓰지 않습니다.
- Django 내부 URL 구현, 모델, 템플릿, 미들웨어, static collect 흐름에 직접 연결하지 않습니다. 통신은 허용된 Wargame API 엔드포인트로만 합니다.
- 공개 루트는 `public/`만 사용합니다.
- SQLite 파일은 `public/` 밖에 있습니다.
- Apache vhost는 `wargame.hanplanet.com`만 받습니다.
- `data/`는 게시판 전용 DB와 로그만 저장합니다.
