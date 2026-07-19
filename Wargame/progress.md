Original prompt: 워게임의 모든 의뢰에서 이메일의 스토리·타깃 정보·목표가 실제 의뢰처럼 구체적이어야 하며, 메일의 연결 URL은 해당 의뢰와 일치하는 가상 운영 타깃으로 이어져야 한다. 모든 문제의 배경과 가상 웹·터미널·네트워크 화면을 다시 확인하고 실감 나게 고친다.

## 2026-07-15

- 사용자 피드백 확인: 현재 메일이 피상적이고 링크가 브리핑/메일 전송 화면으로 돌아가며, 공통 실습 UI가 각 의뢰의 운영 타깃처럼 보이지 않음.
- 작업 목표: 11개 미션별 메일 → 브리핑 → 타깃 브랜드/데이터/인터랙션 → 완료 흐름의 서사 일치성을 전수 검증하고 재구현.
- TODO: 메일 본문과 딥링크 재설계.
- TODO: 미션별 실제 서비스형 타깃 렌더러 구현.
- TODO: 모든 미션의 성공/실패 경로와 모바일 화면을 브라우저에서 검증.

### LabEngine 서사·데이터 일치 완료

- `app/labs/LabEngine.php` state schema를 v2로 갱신하고, 기존 v1 instance는 오류 대신 가상 자료를 안전하게 재생성하도록 마이그레이션 경로를 추가함.
- 11개 타깃의 canonical `product` / `host` / `entry_path`를 `targetProfiles()`로 공개하고 모든 응답의 `target`, `output.service`, `output.page`, `output.records`에 구조화된 렌더링 데이터를 제공함.
- Aurora는 `/discount/check` → `X-Lab-Next` → `X-Debug-Mode: inspect`, LeafPeer는 `leaf_role` reviewer 쿠키, Nova는 실제 문서 SQLite 데이터로 수정함.
- Comet은 `inventory_manager` 재고 대시보드, Helios는 2열 `training_notes` UNION, PrismCare는 opaque sandbox의 `completeLab()` 이벤트, Atlas는 AF-27 안전점검 문서로 서사를 맞춤.
- PixelPet은 `training.php` + `LAB_UPLOAD_MARKER` + image MIME을 모두 요구하고 private/non-executable 저장을 유지함. Vector는 aud/scope/nonce를 보존한 admin JWT를 검증함.
- Lumen은 외부 연결 없는 고정 virtual dispatcher에서 정상 카드의 `metadata.training` 단서 → 내부 proof 직접 fetch 흐름으로 정렬함.
- Nightfall은 `/reports` IDOR → `/reports/file` verifier config → `/reports/token` admin 승인 → `/reports/vault` 증거 금고의 4단계 상태 기계로 보강함. 중간 token 승인만으로는 완료되지 않음.
- `scripts/test_labs.php`를 전면 갱신해 각 미션의 정상 탐색, 잘못된 요청/권한 실패, 완료 증거, reset, v1 상태 재생성, cross-instance 격리, shell/outbound-network 금지를 검증함.
- 검증: `php scripts/test_labs.php` 793 assertions, `php scripts/test_curriculum.php` 11 missions / 228 assertions, `php scripts/test_portal.php` 254 assertions, PHP lint, `git diff --check` 모두 통과.
- TODO: mission별 서비스 UI와 메일 딥링크의 모바일/데스크톱 Playwright 검증은 `public/lab.php` 통합 작업에서 최종 수행.

- 가상 타깃 렌더러 전면 교체: 11개 mission ID 각각에 운영 서비스형 독립 화면과 직접 조작 폼을 구현함. 공통 JSON 편집기는 하단의 접힌 고급 요청 도구로 이동함.
- `public/assets/targets.css` 추가: Aurora SmartCoupon, LeafPeer Review, Nova Vault, Comet StockFlow, Helios Supply Catalog, PrismCare, Atlas, PixelPet, Vector, Lumen, Nightfall을 서로 다른 정보 구조·브랜드·반응형 화면으로 구현함.
- curriculum/engine의 `service_name`, `.training` hostname, `entry_path`를 타깃 UI의 source-of-truth로 연결함. Aurora X-Lab-Next/X-Debug-Mode, Leaf leaf_role Cookie, Prism completeLab(), Nightfall 4단계 RelayOps 흐름으로 정렬함.
- `public/assets/lab.js`를 실제 폼 → 가상 HTTP 요청 변환, Cookie Base64URL 편집, JWT 디코드/재인코드, Lumen URL preset, XSS postMessage, `render_game_to_text()` 상태 출력으로 재구현함.
- 중간 정적 검사: `public/lab.php` PHP lint 및 `public/assets/lab.js` Node syntax check 통과. 다음: engine 최종 변경 반영 후 11개 renderer 자동 검사와 Playwright 데스크톱/모바일 렌더 검증.
- 메일 아키텍처 확인: challenge 서사를 Django notification API에 보내지 않고 Wargame portal이 등록 이메일로 직접 SMTP 발송하도록 복구한다. 메일 CTA는 비밀값 없이 `/?mission=<id>&launch=1`을 사용하고 portal이 계정·진행 상태를 검사한 뒤 타깃 인스턴스를 만든다.
- CASE 01~04의 클라이언트 사고 배경, 실제형 서비스명·가상 host·진입 경로, 발신자·긴급도·연락 맥락·허가 범위·납품 증거·주의사항을 상세화했다.
- CASE 05~08도 각각 Helios Supply Catalog, PrismCare Help Desk, Atlas Field Manual, PixelPet Profile로 운영 서비스 배경을 구체화하고, 메일 의뢰서의 범위·납품물·안전 제약을 미션별로 분리했다.
- CASE 09~11을 Vector Deploy Gate, Lumen Campaign Preview, Nightfall RelayOps로 재구성했다. 최종 의뢰는 02:30~04:00 승인 창, 3자 공동 승인, 제어 명령 금지, IDOR→경로 이동→JWT 증거 패키지를 명시한다.
- `MissionMailer` 직접 SMTP/mail/preview transport와 multipart plain+HTML 의뢰서를 구현했다. 메일은 클라이언트 연락처, 사고 배경, 타깃 service·host·path·접근법, 목표, 범위, 납품 증거, 주의사항을 포함하고 CTA는 `/?mission=<id>&launch=1`로 연결된다. Bearer·비밀번호·완료 증표는 포함하지 않는다.
- 검증: `php -l`(curriculum, MissionMailer, CampaignService, portal test) 통과, curriculum 228 assertions 통과, portal 254 assertions 통과. 11개 의뢰의 서사·타깃·범위·증거·주의사항 포함과 고유 launch URL을 추가 검증했다. CASE 01 메일 상단과 CASE 11 범위·증거·CTA 하단을 Playwright로 렌더링해 시각 확인했고 console error artifact는 없었다.
- 통합 확인 중 `php scripts/test_labs.php`는 현재 `HTTP lab exposes clues as headers` assertion에서 실패했다. 동시 작업 중인 LabEngine HTTP 응답 헤더와 테스트 기대치 불일치로 보이며 engine 담당자에게 전달했다.

### 전수 검수 기준

- CASE 01: 메일과 타깃 모두 `오로라 문구점`이며 첫 화면은 실제 할인 확인 서비스. 응답 헤더 단서로 진단 경로 이동.
- CASE 02: `리프 리뷰 센터`의 공개 리뷰 화면과 검토자 보관함, 역할 쿠키가 같은 업무 맥락을 유지.
- CASE 03: `노바 문서함`의 내 문서·활동 로그·타인 문서가 실제 문서 서비스 UI로 연결.
- CASE 04: `코멧 재고 관리` 야간 로그인과 로그인 후 재고 대시보드가 일치.
- CASE 05: `헬리오스 마켓` 상품 검색 결과와 운영 메모 추출이 같은 검색 서비스 안에 표시.
- CASE 06: `프리즘 고객지원` 도움말 검색과 격리된 반사 결과가 고객지원 UI 안에 표시.
- CASE 07: `아틀라스 문서 뷰어` 공개 파일 트리와 비공개 점검 문서가 동일 뷰어 안에서 동작.
- CASE 08: `픽셀펫` 프로필·아바타 업로드 UI와 취약 검증 결과가 일치.
- CASE 09: `벡터 배포 콘솔` 로그인 토큰·릴리스 승인 화면이 실제 배포 도구처럼 연결.
- CASE 10: `루멘 링크 카드` 미리보기 폼·가상 네트워크 trace·내부 metadata 결과가 같은 서비스에 표시.
- CASE 11: `Nightfall 관제 포털`의 보고서→파일 설정→토큰→vault 3단계가 하나의 사건으로 이어짐.
- 모든 메일: 고객 담당자, 사건 시각/업무 영향, 자산 호스트, 허용 범위, 제외 범위, 성공 기준, 제출 증거, CTA 포함.
- 모든 CTA: 비밀값 없는 `/?mission=<stable-id>&launch=1` 링크이며 계정 연결 후 해당 타깃 instance로 자동 진입.

### 통합·보안 보완

- 메일 CTA의 `mission`/`launch=1` query를 Django 로그인 전후 그대로 보존하고, Wargame exact HTTPS host만 `next` 대상에 추가했다. lookalike host, HTTP downgrade, userinfo, protocol-relative/backslash redirect는 거부한다.
- account token refresh와 메일 auto-launch를 직렬화해 갱신 fetch가 실습 이동에 의해 중단되는 race를 제거했다.
- CASE 01 직접 POST로 첫 메일을 우회하지 못하도록 UI와 서버 모두 campaign dispatch를 강제한다.
- 목표 달성 즉시 signed handoff form을 자동 제출한다. solve 기록·completion claim·다음 mission dispatch는 replay/CAS/idempotency 테스트에서 각각 1회만 처리된다. JavaScript가 없을 때는 같은 서명 토큰을 쓰는 수동 fallback을 유지한다.
- 로컬 owner hash를 Django immutable `user_id` 기반으로 전환해 `Alice`/`alice`와 username 변경을 분리했다. 귀속 근거가 없는 legacy lowercase instance/ticket/dispatch는 자동 승계하지 않으며 solve 진행은 Django API에서 유지한다.
- UTF-8 메일 제목을 RFC 2047 encoded-word 제한 안에서 접고, SMTP security enum·AUTH/TLS fail-closed·TLS peer-name 검증·DATA 250 이후 QUIT best-effort를 추가했다.
- completion secret은 32-byte random hex/base64url 형식과 최소 문자 다양성을 요구하며 known placeholder/반복 문자열을 Django와 PHP 양쪽에서 fail closed 한다.
- reverse proxy HTTPS에서 target/completion cookie도 `Secure`가 되도록 trusted `X-Forwarded-Proto` 판정을 portal과 맞췄다.

### 브라우저 검증

- 제공된 web-game Playwright client로 Aurora 초기 타깃을 렌더하고 `render_game_to_text()` 및 console error 0건을 확인했다.
- 11개 타깃 전체 desktop, Aurora/Atlas/Nightfall mobile 포함 14개 viewport를 캡처해 service/host/path와 화면 서사를 확인했다. console/page error 0건.
- 실제 UI 조작으로 11개 모두 완료: completed=true, 완료 패널 visible=true, console/page error 0건.
- PHP 자동 검증: curriculum 228, LabEngine 793, portal 300 assertions. Django Wargame API security 8 tests 통과.
- 테스트가 남긴 orphan completion/event row와 instance directory를 정확히 정리했고 `PRAGMA foreign_key_check` 및 `scripts/init_db.php`가 다시 통과한다.

### 배포 전 필수 확인

- 아래 운영 반영 절에서 해소됨. 구 image·누락 secret·연결 거부 relay 상태를 확인한 뒤 별도 random completion secret과 기존 인증 TLS SMTP relay를 설정하고 서비스를 recreate했다.

### CASE 11 브라우저 SOC 터미널 추가

- Nightfall RelayOps 화면에 `external.audit@relayops:~$` 프롬프트의 실제 입력 가능한 SOC 터미널을 추가함. 기존 4단계 입력 폼은 접근성·no-JS 보조 경로로 그대로 유지.
- 순수 JS parser가 `help`, `report <id>`, `cat <path>`, `token <jwt>`, `vault`, `clear`만 해석하고 각각 기존 `/reports`, `/reports/file`, `/reports/token`, `/reports/vault` 가상 요청 JSON으로 변환. shell·fetch·WebSocket·외부 network를 호출하지 않음.
- LabEngine의 Nightfall `surface` 값을 `terminal`로 변경하고 start/serialize/4단계 응답과 curriculum의 target surface·설명·실습 코드를 명령 계약에 맞춤.
- `render_game_to_text()`가 terminal stage, 허용 명령, no-shell/no-egress 경계, 현재 transcript와 보이는 control을 출력하도록 확장.
- 검증 완료: LabEngine 801 assertions, curriculum 234 assertions, portal 318 assertions, PHP lint, Node syntax, diff check 통과.
- supplied web-game Playwright client를 실행하고 screenshot·`render_game_to_text` 산출물을 육안 확인. 인증 cookie를 적용한 실제 타깃에서 `help → report → cat → token → vault` 전체 체인, 알 수 없는 명령 거부, 기존 단계별 폼 표시, 자동 completion handoff 트리거를 확인함.
- 브라우저 결과: idor→traversal→jwt→vault→complete 상태 전이 일치, console error 0, page error 0, 외부 request 0. 데스크톱 초기/help/완료 터미널과 390px 모바일 터미널 스크린샷을 실제로 열어 가독성을 확인.

### 완료 직후 다음 의뢰 자동 인계

- 타깃 성공 화면의 signed ticket-bound CSRF handoff 폼을 `lab.js`가 즉시 자동 제출하며, JavaScript가 꺼진 경우에는 동일한 보호 폼의 수동 버튼을 유지함.
- completion ticket을 instance·mission·proof에 결속된 결정적 HMAC으로 발급해 돌아가기/새로고침에서도 같은 인계가 재사용됨. claim은 SQLite CAS marker로 동시 처리를 방지하고, 재전송은 `already_claimed` 멱등 결과를 반환함.
- `CampaignService::completeAndDispatch()`가 solve 기록과 다음 mission dispatch reservation을 하나의 인계 흐름으로 묶음. `(owner, mission)` unique 예약으로 중복 메일을 차단하며 실패 시만 기존 수동 retry를 사용함.
- 검증: portal 300 assertions, LabEngine 793, curriculum 228, PHP/JS syntax·diff check 통과. 실제 브라우저에서 성공 후 POST 1회 → CASE 02 redirect·플래시·다음 dispatch를 확인했고, 동일 증표 재전송 후에도 claim event 1건·dispatch 1건을 확인함.

### 운영 반영 및 최종 검증

- completion receipt의 사용자 결속도 username이 아닌 `django-user-id:v1:<immutable-id>`로 통일했다. 실습 도중 username을 바꾼 뒤에도 기존 Bearer token으로 완료 기록이 성공하는 Django 회귀 테스트를 추가했다.
- 브라우저가 전달하는 Django token은 3개 base64url JWT segment와 8KB 제한을 모두 만족해야 내부 `Authorization` header에 사용한다. CR/LF header injection과 malformed token을 내부 API 요청 전에 거부한다.
- 공개 DocumentRoot의 임시 `__codex_target_fixture.php`를 삭제하고 최종 image에도 존재하지 않음을 확인했다.
- 운영 `.env`에 별도 32-byte random completion secret을 값 노출 없이 추가하고 Django/Wargame 양쪽 일치를 검증했다. 기존 Django 인증 SMTP relay를 Wargame `tls` transport에도 연결했다.
- `docker compose up -d --build django celery celery-beat wargame nginx`로 운영 서비스를 recreate했다. 공개 `https://wargame.hanplanet.com/` 200, Django/Wargame healthy, host/container curriculum checksum 일치.
- 운영 SMTP canary와 실제 `codex_test`의 `의뢰 메일 다시 보내기`가 모두 `sent / smtp / accepted`를 반환했다. 기존 수신 메일은 저장된 구 사본이라 바뀌지 않으며 새 resend부터 상세 의뢰서가 전달된다.
- 공개 운영 URL에서 token bridge → CASE 01 mission → launch POST(303) → `/lab.php`까지 실제 요청했고, 타깃이 `Aurora SmartCoupon`, `coupon.aurora-stationery.training`, `/discount/check`, 할인 확인 화면으로 일치함을 확인했다.
- 실제 headless Chromium에 운영 `codex_test` portal session을 넣고 이메일 CTA와 동일한 `/?mission=web-v1-01-http&launch=1`을 열어 `/lab.php` 자동 이동과 `Aurora SmartCoupon`/`/discount/check` 렌더링을 재확인했다. 공개 응답에 Cloudflare가 삽입한 inline challenge script는 의도한 CSP에 의해 차단되지만 portal auto-launch와 target JS는 정상 동작한다.
- 최종 자동 검증: curriculum 234 assertions, LabEngine 801 assertions, portal 322 assertions, Django Wargame security 9 tests, exact login deep-link 2 tests, PHP/JS syntax, Compose config, diff check 통과.

### 실제 HTTP 운영 타깃 전환 (사용자 재요청)

- 구형 `/lab.php` 시뮬레이터, 가상 브라우저 chrome, 내장 요청 편집기, Cookie/JWT 도우미, Nightfall 터미널, JSON 콘솔, visible 완료 패널을 제거하고 `/lab.php`는 포털 303 호환 redirect로 축소했다.
- 11개 서비스에 실제 공개 경로(`/aurora/…`, `/leaf/…`, `/nova/…`, `/comet/…`, `/helios/…`, `/prism/…`, `/atlas/…`, `/pixelpet/…`, `/vector/…`, `/lumen/…`, `/nightfall/…`)와 Apache rewrite/front controller를 추가했다.
- 실제 브라우저 요청의 method/path/query/header/body/`$_FILES`/Authorization을 LabEngine으로 전달하고 status/Allow/ETag/Aurora route/Vector session/Leaf cookie를 실제 HTTP 응답 헤더로 내보낸다. 포털·instance cookie는 challenge 입력에서 제거한다.
- 타깃은 각 회사의 운영 화면만 full viewport로 렌더하며, 학습 설명과 도구 사용법은 포털 미션 브리핑에만 남긴다. 성공 후 solve 기록과 다음 메일은 서버에서 멱등 처리해 타깃 화면에 Wargame handoff UI가 나타나지 않는다.
- Prism 반사 XSS 응답은 sandbox의 `allow-same-origin` 없이 고유 출처로 격리하고 `connect-src 'none'`을 적용해 같은 public host의 포털 세션에 접근하지 못하게 했다.
- 11개 메일에 사건 배경, 실제 서비스, 식별 host, 실제 접속 URL, 목표, 허가 범위, 증거, 주의사항과 자동 launch CTA를 정렬했다. 포털의 TARGET ADDRESS도 실제 접속 경로를 표시한다.
- 현재 자동 검증: curriculum 244 assertions, LabEngine 800 assertions, portal 392 assertions 통과. 다음 TODO: 실제 HTTP adapter 통합 테스트, Docker/Apache routing, Playwright desktop/mobile 및 Prism opaque-origin, 운영 deploy/메일 재전송 검증.
