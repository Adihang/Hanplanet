<?php
declare(strict_types=1);

require __DIR__ . '/../app/bootstrap.php';

$challenges = list_challenges();
$challengeId = $_GET['challenge'] ?? '';
$challenge = isset($challenges[$challengeId]) ? $challenges[$challengeId] : null;

if (!$challenge) {
    http_response_code(404);
    exit('Service not found.');
}

$ctx = wargame_v2_lab_context($challenge);
$kind = (string) $ctx['kind'];

function svc_header(string $name): string
{
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    if (isset($_SERVER[$key]) && is_string($_SERVER[$key])) {
        return $_SERVER[$key];
    }
    if (strtolower($name) === 'content-type' && isset($_SERVER['CONTENT_TYPE'])) {
        return (string) $_SERVER['CONTENT_TYPE'];
    }
    return '';
}

function svc_jwt_payload(string $jwt): array
{
    $parts = explode('.', trim($jwt));
    if (count($parts) < 2) {
        return [];
    }
    $payload = strtr($parts[1], '-_', '+/');
    $payload .= str_repeat('=', (4 - strlen($payload) % 4) % 4);
    $decoded = base64_decode($payload, true);
    if ($decoded === false) {
        return [];
    }
    $data = json_decode($decoded, true);
    return is_array($data) ? $data : [];
}

function svc_contains_any(string $value, array $needles): bool
{
    foreach ($needles as $needle) {
        if ($needle !== '' && stripos($value, $needle) !== false) {
            return true;
        }
    }
    return false;
}

function svc_blueprints(): array
{
    return [
        'aurora_gamenet' => ['brand' => 'Aurora GameNet', 'tagline' => 'Arcade tournament operations', 'module' => 'Prize Ops', 'nav' => ['Tournament', 'Players', 'Prize Vault'], 'asset' => '경품 보관함', 'actor' => '카운터 직원', 'record' => 'player', 'hero' => '시즌 토너먼트 경품 출고 대기열'],
        'mirror_room_hub' => ['brand' => 'MirrorRoom Hub', 'tagline' => 'Escape room reservation desk', 'module' => 'Escape Booking', 'nav' => ['Invites', 'Rooms', 'Master Key'], 'asset' => '마스터키 예약권', 'actor' => '룸 매니저', 'record' => 'booking', 'hero' => '예약 초대와 룸 입장권 관리'],
        'lumen_radio' => ['brand' => 'Lumen Radio', 'tagline' => 'Live programming backstage', 'module' => 'Backstage Desk', 'nav' => ['Schedule', 'Stream Key', 'Live Console'], 'asset' => '송출 키', 'actor' => '편성 관리자', 'record' => 'program', 'hero' => '라이브 편성표와 송출 권한 관리'],
        'pixelpet_arena' => ['brand' => 'PixelPet Arena', 'tagline' => 'Creature crafting and arena rewards', 'module' => 'GM Forge', 'nav' => ['Pets', 'Crafting', 'GM Rewards'], 'asset' => 'GM 보상 박스', 'actor' => '아레나 운영자', 'record' => 'pet', 'hero' => '펫 제작기와 경기 보상 처리'],
        'sprintboard_saas' => ['brand' => 'SprintBoard', 'tagline' => 'Multi-tenant project boards', 'module' => 'Tenant Admin', 'nav' => ['Board', 'Members', 'Workspace Root'], 'asset' => '루트 워크스페이스', 'actor' => '테넌트 관리자', 'record' => 'workspace', 'hero' => '팀 보드와 워크스페이스 권한'],
        'velvet_streaming' => ['brand' => 'Velvet Studio', 'tagline' => 'Creator premiere console', 'module' => 'Creator Console', 'nav' => ['Drafts', 'Premiere', 'Review Room'], 'asset' => '프리미어 재생 키', 'actor' => '심사 계정', 'record' => 'video', 'hero' => '공개 전 영상과 심사 대기열'],
        'blackbox_rental' => ['brand' => 'Blackbox Rental', 'tagline' => 'Equipment return kiosk', 'module' => 'Kiosk Control', 'nav' => ['Return', 'Locker', 'Maintenance'], 'asset' => '장비 보관함', 'actor' => '정비자', 'record' => 'device', 'hero' => '반납 전 장비와 원격 보관함 제어'],
        'cosmos_fanclub' => ['brand' => 'Cosmos Fanclub', 'tagline' => 'Membership community platform', 'module' => 'VIP Notice', 'nav' => ['Membership', 'Gallery', 'VIP Board'], 'asset' => 'VIP 공지', 'actor' => '팬클럽 스태프', 'record' => 'notice', 'hero' => '멤버십 공지와 팬 전용 게시판'],
        'neon_print_pipeline' => ['brand' => 'Neon Print', 'tagline' => 'On-demand print workflow', 'module' => 'Worker Queue', 'nav' => ['Job Ticket', 'Templates', 'Print Queue'], 'asset' => '작업자 큐', 'actor' => '프린터 작업자', 'record' => 'job', 'hero' => '인쇄 작업지시와 렌더링 큐'],
        'solaris_rewards' => ['brand' => 'Solaris Rewards', 'tagline' => 'Customer reward wallet', 'module' => 'Wallet Adjust', 'nav' => ['Wallet', 'Rewards', 'Adjustment'], 'asset' => '보정 승인', 'actor' => '리워드 관리자', 'record' => 'wallet', 'hero' => '포인트 지갑과 보정 승인'],
        'atlas_mapworks' => ['brand' => 'Atlas Mapworks', 'tagline' => 'Private map tile service', 'module' => 'Tile Server', 'nav' => ['Map', 'Layers', 'Tile Admin'], 'asset' => '비공개 레이어', 'actor' => '지도 편집자', 'record' => 'layer', 'hero' => '지도 레이어와 내부 타일 서버'],
        'bytecircus_gate' => ['brand' => 'ByteCircus Gate', 'tagline' => 'Event ticket scanner', 'module' => 'Ticket Scanner', 'nav' => ['Tickets', 'Seats', 'Backstage'], 'asset' => '백스테이지 티켓', 'actor' => '검표원', 'record' => 'ticket', 'hero' => '입장권 상태와 백스테이지 승인'],
        'hivenote_kb' => ['brand' => 'HiveNote KB', 'tagline' => 'Company knowledge base', 'module' => 'Private Docs', 'nav' => ['Docs', 'Share', 'Ops Archive'], 'asset' => '운영 문서', 'actor' => '문서 관리자', 'record' => 'document', 'hero' => '비공개 운영 문서와 공유 링크'],
        'rubicon_forms' => ['brand' => 'Rubicon Forms', 'tagline' => 'Survey and response builder', 'module' => 'Response Admin', 'nav' => ['Surveys', 'Templates', 'Responses'], 'asset' => '응답 관리자', 'actor' => '폼 관리자', 'record' => 'form', 'hero' => '설문 템플릿과 응답 관리'],
        'onyx_plugin_market' => ['brand' => 'Onyx Market', 'tagline' => 'Plugin publishing portal', 'module' => 'Publisher Desk', 'nav' => ['Plugins', 'Updates', 'Release Sign'], 'asset' => '릴리즈 서명', 'actor' => '게시자', 'record' => 'plugin', 'hero' => '플러그인 업데이트와 릴리즈 서명'],
        'specter_mailroom' => ['brand' => 'Specter Mailroom', 'tagline' => 'Automatic mail classification', 'module' => 'Labeler Control', 'nav' => ['Inbox', 'Quarantine', 'Labeler'], 'asset' => '격리 메일', 'actor' => '분류자', 'record' => 'mail', 'hero' => '메일 격리함과 라벨러 제어'],
        'crypt_passport' => ['brand' => 'Crypt Passport', 'tagline' => 'Event stamp passport', 'module' => 'Stamp Booth', 'nav' => ['Passports', 'Stamps', 'Judges'], 'asset' => '완주 패스포트', 'actor' => '심사위원', 'record' => 'stamp', 'hero' => '참가자 스탬프와 완주 판정'],
        'monolith_banner' => ['brand' => 'Monolith Ads', 'tagline' => 'Campaign banner exchange', 'module' => 'Campaign Reports', 'nav' => ['Campaigns', 'Preview', 'Reports'], 'asset' => '캠페인 리포트', 'actor' => '광고 관리자', 'record' => 'campaign', 'hero' => '광고 프리뷰와 캠페인 리포트'],
        'polaris_translate' => ['brand' => 'Polaris Translate', 'tagline' => 'Translation engine console', 'module' => 'Engine Admin', 'nav' => ['Glossary', 'Templates', 'Engines'], 'asset' => '관리 토큰', 'actor' => '번역 관리자', 'record' => 'engine', 'hero' => '번역 템플릿과 엔진 관리'],
        'nightfall_contracts' => ['brand' => 'Nightfall Contracts', 'tagline' => 'Contract review workflow', 'module' => 'Approval Desk', 'nav' => ['Contracts', 'Review', 'Approval'], 'asset' => '계약 승인 금고', 'actor' => '검토자', 'record' => 'contract', 'hero' => '계약 검토와 비공개 승인'],
        'zeroday_range' => ['brand' => 'ZeroDay Range', 'tagline' => 'Internal operator training', 'module' => 'Operator Lab', 'nav' => ['Labs', 'Accounts', 'Operator'], 'asset' => '운영 패널', 'actor' => '훈련장 운영자', 'record' => 'lab', 'hero' => '훈련 계정과 운영 패널'],
        'metalink_invites' => ['brand' => 'MetaLink Invites', 'tagline' => 'Private group invitation server', 'module' => 'Group Access', 'nav' => ['Invites', 'Groups', 'Approvals'], 'asset' => '비공개 그룹', 'actor' => '그룹 관리자', 'record' => 'group', 'hero' => '초대 토큰과 그룹 승인'],
        'obsidian_dashboard' => ['brand' => 'Obsidian Dash', 'tagline' => 'Operations metrics dashboard', 'module' => 'Admin Alerts', 'nav' => ['Metrics', 'Widgets', 'Alerts'], 'asset' => '관리 알림', 'actor' => '대시보드 관리자', 'record' => 'metric', 'hero' => '내부 메트릭과 관리자 알림'],
        'quartz_renderfarm' => ['brand' => 'Quartz RenderFarm', 'tagline' => 'Distributed scene rendering', 'module' => 'Render Nodes', 'nav' => ['Scenes', 'Workers', 'Nodes'], 'asset' => '렌더 노드 제어', 'actor' => '렌더 작업자', 'record' => 'scene', 'hero' => '장면 파일과 렌더 노드 큐'],
        'vega_dataroom' => ['brand' => 'Vega DataRoom', 'tagline' => 'Confidential file review room', 'module' => 'Review Vault', 'nav' => ['Files', 'Guests', 'Review'], 'asset' => '비공개 자료 금고', 'actor' => '검토자', 'record' => 'file', 'hero' => '게스트 자료실과 검토 금고'],
        'redline_final' => ['brand' => 'Redline Final', 'tagline' => 'Full-chain operator exercise', 'module' => 'Operator Chain', 'nav' => ['Entry', 'Assets', 'Shutdown'], 'asset' => '종료 코드', 'actor' => '오퍼레이터', 'record' => 'asset', 'hero' => '최종 작전 자산과 종료 절차'],
    ];
}

function svc_scene(array $challenge, array $ctx): array
{
    $blueprints = svc_blueprints();
    $caseSlug = (string) ($challenge['case_slug'] ?? '');
    $scene = $blueprints[$caseSlug] ?? [
        'brand' => (string) ($challenge['phase'] ?? 'Service'),
        'tagline' => 'Internal service',
        'module' => 'Console',
        'nav' => ['Home', 'Records', 'Admin'],
        'asset' => '관리 자산',
        'actor' => '운영자',
        'record' => 'record',
        'hero' => '운영 서비스',
    ];
    $seed = hash('sha256', (string) ($challenge['challenge_slug'] ?? $challenge['id']));
    $scene['case_slug'] = $caseSlug;
    $scene['screen_id'] = strtoupper(substr($seed, 0, 4) . '-' . substr($seed, 4, 4));
    $scene['primary_id'] = strtoupper((string) $scene['record']) . '-' . strtoupper(substr($seed, 8, 6));
    $scene['secondary_id'] = strtoupper((string) $scene['record']) . '-' . strtoupper(substr($seed, 14, 6));
    $scene['queue_id'] = 'Q-' . str_pad((string) (($challenge['week'] ?? 1) * 100 + ($challenge['day'] ?? 1)), 4, '0', STR_PAD_LEFT);
    $scene['operator'] = strtolower(str_replace(' ', '.', (string) $scene['brand'])) . '.ops';
    return $scene;
}

function svc_state(string $kind, array $ctx): array
{
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    $rawBody = file_get_contents('php://input') ?: '';
    $origin = svc_header('Origin');
    $forwardedHost = svc_header('X-Forwarded-Host');
    $host = svc_header('Host');
    $overrideMethod = strtoupper(svc_header('X-HTTP-Method-Override'));
    $authHeader = svc_header('Authorization');
    $solved = false;

    switch ($kind) {
        case 'hidden_route':
            $solved = hash_equals((string) $ctx['route'], (string) ($_GET['route'] ?? ''))
                && hash_equals((string) $ctx['gate'], (string) ($_GET['gate'] ?? ''));
            break;
        case 'idor':
            $solved = hash_equals((string) $ctx['target_id'], (string) ($_GET['record'] ?? $ctx['self_id']));
            break;
        case 'cookie_admin':
            $solved = ((string) ($_COOKIE[(string) $ctx['role_cookie']] ?? 'guest')) === 'admin';
            break;
        case 'sqli_bypass':
            $probe = (string) ($_POST['username'] ?? $_GET['username'] ?? '') . ' ' . (string) ($_POST['password'] ?? $_GET['password'] ?? '');
            $solved = svc_contains_any($probe, ["' or '1'='1", '" or "1"="1', ' or 1=1', 'union select', '--']);
            break;
        case 'open_redirect':
            $next = (string) ($_GET['next'] ?? '/');
            $nextHost = parse_url($next, PHP_URL_HOST);
            $solved = is_string($nextHost) && stripos($nextHost, 'collector.training') !== false && str_contains($next, (string) $ctx['ticket']);
            break;
        case 'path_traversal':
            $file = (string) ($_GET['file'] ?? $ctx['safe_file']);
            $solved = str_contains($file, '..') && str_contains($file, (string) $ctx['file_name']);
            break;
        case 'jwt_forge':
            $token = (string) ($_GET['token'] ?? '');
            if ($token === '' && preg_match('/Bearer\s+(.+)/i', $authHeader, $matches)) {
                $token = trim($matches[1]);
            }
            $payload = svc_jwt_payload($token);
            $solved = (($payload['role'] ?? '') === 'admin') && (($payload['scope'] ?? '') === $ctx['scope']);
            break;
        case 'method_override':
            $solved = in_array($overrideMethod, ['PUT', 'PATCH', 'DELETE'], true)
                && ((string) ($_POST['confirm'] ?? $_GET['confirm'] ?? '')) === '1';
            break;
        case 'graphql_probe':
            $solved = stripos((string) ($_POST['query'] ?? $_GET['query'] ?? ''), 'clearCodeVault') !== false;
            break;
        case 'cors_misconfig':
            $solved = $origin !== '' && stripos($origin, 'collector.training') !== false;
            if ($origin !== '') {
                header('Access-Control-Allow-Origin: ' . $origin);
                header('Access-Control-Allow-Credentials: true');
            }
            break;
        case 'ssrf_fetch':
            $solved = hash_equals((string) $ctx['metadata_url'], (string) ($_POST['url'] ?? $_GET['url'] ?? ''));
            break;
        case 'cache_poison':
            $solved = ((string) ($_GET['cache'] ?? '')) === 'prime' && stripos($forwardedHost, 'collector.training') !== false;
            break;
        case 'xxe_probe':
            $xml = (string) ($_POST['xml'] ?? $rawBody);
            $solved = stripos($xml, '<!DOCTYPE') !== false && stripos($xml, 'file:///code') !== false;
            break;
        case 'ssti_probe':
            $template = preg_replace('/\s+/', '', strtolower((string) ($_POST['template'] ?? $_GET['template'] ?? ''))) ?? '';
            $solved = str_contains($template, '{{config.clear_code}}') || str_contains($template, '{{clear_code}}');
            break;
        case 'command_injection':
            $hostParam = (string) ($_POST['host'] ?? $_GET['host'] ?? '');
            $solved = svc_contains_any($hostParam, [';', '&&', '|']) && stripos($hostParam, 'code') !== false;
            break;
        case 'upload_bypass':
            $filename = (string) ($_POST['filename'] ?? '');
            $contentType = (string) ($_POST['content_type'] ?? '');
            $solved = preg_match('/\.(php|phtml|phar)$/i', $filename) === 1 && stripos($contentType, 'image/') === 0;
            break;
        case 'nosql_injection':
            $password = $_POST['password'] ?? $_GET['password'] ?? '';
            $solved = is_array($password) || stripos($rawBody, '$ne') !== false || stripos(http_build_query($_REQUEST), '%24ne') !== false;
            break;
        case 'mass_assignment':
            $role = (string) ($_POST['role'] ?? $_GET['role'] ?? '');
            $solved = in_array($role, ['admin', 'root', 'operator'], true)
                || ((string) ($_POST['admin'] ?? $_GET['admin'] ?? '')) === '1'
                || ((string) ($_POST['operator'] ?? $_GET['operator'] ?? '')) === '1';
            break;
        case 'deserialization':
            $profile = (string) ($_COOKIE['profile'] ?? $_GET['profile'] ?? '');
            $decoded = base64_decode($profile, true);
            $profileData = $decoded === false ? [] : json_decode($decoded, true);
            $solved = is_array($profileData) && (($profileData['role'] ?? '') === 'admin');
            break;
        case 'host_header':
            $candidateHost = $forwardedHost !== '' ? $forwardedHost : $host;
            $solved = str_starts_with(strtolower($candidateHost), 'admin.');
            break;
        case 'chain_lock':
            $role = (string) ($_COOKIE[(string) $ctx['role_cookie']] ?? $_GET['role'] ?? '');
            $solved = hash_equals((string) $ctx['route'], (string) ($_GET['route'] ?? ''))
                && hash_equals((string) $ctx['target_id'], (string) ($_GET['record'] ?? ''))
                && $role === 'admin';
            break;
    }

    return [
        'solved' => $solved,
        'method' => $method,
        'origin' => $origin,
        'forwarded_host' => $forwardedHost,
        'host' => $host,
    ];
}

function svc_flag_block(array $state, array $ctx, ?string $label = null): void
{
    if (!$state['solved']) {
        return;
    }
    $label = $label ?: (string) ($ctx['answer_label'] ?? '클리어 코드');
    ?>
    <div class="svc-flag-receipt">
        <span><?= h($label) ?></span>
        <code><?= h((string) $ctx['flag']) ?></code>
    </div>
    <?php
}

function svc_render_service(string $kind, array $challenge, array $ctx, array $scene, array $state): void
{
    $selfUrl = '/lab.php?challenge=' . rawurlencode((string) $challenge['id']);

    if ($kind === 'hidden_route') {
        if ($state['solved']) {
            ?>
            <section class="svc-ops-layout">
                <div class="svc-panel svc-panel-wide">
                    <span class="svc-eyebrow">Internal Console</span>
                    <h2><?= h((string) $scene['asset']) ?> 출고 콘솔</h2>
                    <p>비공개 라우트와 게이트 토큰이 일치해 운영 콘솔이 열렸습니다.</p>
                    <?php svc_flag_block($state, $ctx); ?>
                </div>
                <div class="svc-panel">
                    <h3>출고 대기</h3>
                    <strong>17</strong>
                    <p>검수 완료 항목</p>
                </div>
                <div class="svc-panel">
                    <h3>게이트</h3>
                    <code><?= h((string) $ctx['gate']) ?></code>
                    <p>active</p>
                </div>
            </section>
            <?php
            return;
        }
        ?>
        <!-- ops memo: route="<?= h((string) $ctx['route']) ?>" gate="<?= h((string) $ctx['gate']) ?>" -->
        <section class="svc-public-home">
            <div>
                <span class="svc-eyebrow">Public Status</span>
                <h2><?= h((string) $scene['hero']) ?></h2>
                <p>현재 공개 화면에는 참가자 공지와 진행 상태만 표시됩니다. 직원용 콘솔은 일반 메뉴에 노출되지 않습니다.</p>
            </div>
            <div class="svc-scoreboard">
                <span>Open</span>
                <strong><?= h((string) $scene['queue_id']) ?></strong>
                <small>public queue</small>
            </div>
        </section>
        <section class="svc-card-grid">
            <article><h3>오늘의 진행</h3><p>예선 진행 중</p></article>
            <article><h3><?= h((string) $scene['asset']) ?></h3><p>직원 확인 후 처리</p></article>
            <article><h3>공지</h3><p>외부 방문자는 공개 상태만 조회할 수 있습니다.</p></article>
        </section>
        <?php
        return;
    }

    if ($kind === 'idor') {
        $record = (string) ($_GET['record'] ?? $ctx['self_id']);
        ?>
        <section class="svc-two-column">
            <form class="svc-panel" method="get">
                <input type="hidden" name="challenge" value="<?= h((string) $challenge['id']) ?>">
                <span class="svc-eyebrow"><?= h((string) $scene['record']) ?> lookup</span>
                <h2><?= h((string) $scene['asset']) ?> 조회</h2>
                <label><?= h((string) $scene['record']) ?> id <input name="record" value="<?= h($record) ?>"></label>
                <button type="submit">열람</button>
            </form>
            <article class="svc-record-card <?= $state['solved'] ? 'svc-sensitive' : '' ?>">
                <span><?= $state['solved'] ? 'private record' : 'my record' ?></span>
                <h3><?= h($state['solved'] ? (string) $ctx['target_id'] : (string) $ctx['self_id']) ?></h3>
                <p><?= $state['solved'] ? h((string) $scene['asset'] . ' 비공개 상태가 열렸습니다.') : '내 계정에 연결된 기본 레코드입니다.' ?></p>
                <?php svc_flag_block($state, $ctx); ?>
            </article>
        </section>
        <div class="svc-inline-note">최근 공유 항목: <code><?= h((string) $ctx['target_id']) ?></code></div>
        <?php
        return;
    }

    if ($kind === 'cookie_admin') {
        $role = (string) ($_COOKIE[(string) $ctx['role_cookie']] ?? 'guest');
        ?>
        <section class="svc-two-column">
            <article class="svc-panel">
                <span class="svc-eyebrow">Session Badge</span>
                <h2><?= h((string) $scene['actor']) ?> 권한</h2>
                <p>현재 세션 배지는 브라우저 상태 저장소에서 복원됩니다.</p>
                <dl class="svc-mini-list">
                    <dt>cookie</dt><dd><?= h((string) $ctx['role_cookie']) ?></dd>
                    <dt>role</dt><dd><?= h($role) ?></dd>
                </dl>
            </article>
            <article class="svc-panel <?= $state['solved'] ? 'svc-sensitive' : 'svc-disabled' ?>">
                <span class="svc-eyebrow"><?= h((string) $scene['module']) ?></span>
                <h2><?= h((string) $scene['asset']) ?> 관리자 패널</h2>
                <p><?= $state['solved'] ? '관리자 배지로 패널이 활성화되었습니다.' : '관리자 배지가 없어서 주요 버튼이 비활성화되어 있습니다.' ?></p>
                <?php svc_flag_block($state, $ctx); ?>
            </article>
        </section>
        <?php
        return;
    }

    if ($kind === 'sqli_bypass') {
        if ($state['solved']) {
            ?>
            <section class="svc-ops-layout">
                <article class="svc-panel svc-panel-wide svc-sensitive">
                    <span class="svc-eyebrow">Authenticated</span>
                    <h2><?= h((string) $scene['actor']) ?> 콘솔</h2>
                    <p>운영자 세션이 발급되었습니다.</p>
                    <?php svc_flag_block($state, $ctx); ?>
                </article>
                <article class="svc-panel"><h3>대기열</h3><strong><?= h((string) $scene['queue_id']) ?></strong></article>
                <article class="svc-panel"><h3>권한</h3><strong>operator</strong></article>
            </section>
            <?php
            return;
        }
        ?>
        <form class="svc-login-card" method="post">
            <span class="svc-eyebrow"><?= h((string) $scene['module']) ?></span>
            <h2><?= h((string) $scene['actor']) ?> 로그인</h2>
            <label>account <input name="username" value="<?= h((string) ($_POST['username'] ?? strtolower(str_replace(' ', '.', (string) $scene['actor'])))) ?>"></label>
            <label>password <input name="password" value="<?= h((string) ($_POST['password'] ?? '')) ?>"></label>
            <button type="submit">Sign in</button>
            <p>계정 정보가 일치하지 않습니다.</p>
        </form>
        <?php
        return;
    }

    if ($kind === 'open_redirect') {
        $next = (string) ($_GET['next'] ?? ('/accept?ticket=' . $ctx['ticket']));
        ?>
        <section class="svc-two-column">
            <form class="svc-panel" method="get">
                <input type="hidden" name="challenge" value="<?= h((string) $challenge['id']) ?>">
                <span class="svc-eyebrow">Invite Gateway</span>
                <h2><?= h((string) $scene['asset']) ?> 초대 확인</h2>
                <label>next <input name="next" value="<?= h($next) ?>"></label>
                <button type="submit">계속</button>
                <p>티켓: <code><?= h((string) $ctx['ticket']) ?></code></p>
            </form>
            <article class="svc-panel <?= $state['solved'] ? 'svc-sensitive' : '' ?>">
                <h3>이동 결과</h3>
                <p><?= $state['solved'] ? '초대 티켓이 외부 수집 주소로 전달되었습니다.' : '내부 예약 흐름으로 이동 대기 중입니다.' ?></p>
                <p class="svc-muted">collector: <?= h((string) $ctx['collector_host']) ?>?ticket=<?= h((string) $ctx['ticket']) ?></p>
                <?php svc_flag_block($state, $ctx); ?>
            </article>
        </section>
        <?php
        return;
    }

    if ($kind === 'path_traversal') {
        $file = (string) ($_GET['file'] ?? $ctx['safe_file']);
        ?>
        <section class="svc-two-column">
            <form class="svc-panel" method="get">
                <input type="hidden" name="challenge" value="<?= h((string) $challenge['id']) ?>">
                <span class="svc-eyebrow">File Viewer</span>
                <h2><?= h((string) $scene['module']) ?> 문서</h2>
                <label>file <input name="file" value="<?= h($file) ?>"></label>
                <button type="submit">열기</button>
            </form>
            <article class="svc-file-viewer <?= $state['solved'] ? 'svc-sensitive' : '' ?>">
                <div><?= h($file) ?></div>
                <pre><?= h($state['solved'] ? "restricted=true\nsecret_file=" . $ctx['file_name'] . "\n" . $ctx['flag'] : "welcome=true\nfolder=public\narchive=secrets/" . $ctx['file_name']) ?></pre>
            </article>
        </section>
        <?php
        return;
    }

    if ($kind === 'jwt_forge') {
        ?>
        <form class="svc-panel svc-panel-wide" method="get">
            <input type="hidden" name="challenge" value="<?= h((string) $challenge['id']) ?>">
            <span class="svc-eyebrow">Access Token Verifier</span>
            <h2><?= h((string) $scene['asset']) ?> 권한 검사</h2>
            <textarea name="token" rows="5"><?= h((string) ($_GET['token'] ?? $ctx['starter_jwt'])) ?></textarea>
            <button type="submit">검증</button>
            <p>필요 scope: <code><?= h((string) $ctx['scope']) ?></code></p>
            <?php svc_flag_block($state, $ctx); ?>
        </form>
        <?php
        return;
    }

    if ($kind === 'method_override') {
        ?>
        <section class="svc-two-column">
            <form class="svc-panel" method="post">
                <span class="svc-eyebrow">Status Controller</span>
                <h2><?= h((string) $scene['asset']) ?> 상태</h2>
                <input type="hidden" name="confirm" value="1">
                <button type="submit">상태 확인</button>
                <p>현재 요청 메서드: <code><?= h($state['method']) ?></code></p>
            </form>
            <article class="svc-panel <?= $state['solved'] ? 'svc-sensitive' : 'svc-disabled' ?>">
                <h3>처리 상태</h3>
                <p><?= $state['solved'] ? '프록시가 상태 변경 요청으로 처리했습니다.' : '읽기 전용 상태입니다.' ?></p>
                <?php svc_flag_block($state, $ctx); ?>
            </article>
        </section>
        <?php
        return;
    }

    if ($kind === 'graphql_probe') {
        $query = (string) ($_POST['query'] ?? $_GET['query'] ?? "query {\n  status\n}");
        ?>
        <section class="svc-two-column">
            <form class="svc-panel" method="post">
                <span class="svc-eyebrow">GraphQL Console</span>
                <h2><?= h((string) $scene['module']) ?> API</h2>
                <textarea name="query" rows="8"><?= h($query) ?></textarea>
                <button type="submit">Run</button>
            </form>
            <article class="svc-file-viewer <?= $state['solved'] ? 'svc-sensitive' : '' ?>">
                <div>response.json</div>
                <pre><?= h($state['solved'] ? json_encode(['data' => ['clearCodeVault' => $ctx['flag']]], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) : json_encode(['data' => ['status' => 'ok'], 'schemaHint' => '__schema exposes Query fields'], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)) ?></pre>
            </article>
        </section>
        <?php
        return;
    }

    if ($kind === 'cors_misconfig') {
        ?>
        <section class="svc-api-page">
            <span class="svc-eyebrow">Private JSON Resource</span>
            <h2><?= h((string) $scene['module']) ?> API 응답</h2>
            <pre><?= h(json_encode([
                'origin' => $state['origin'] !== '' ? $state['origin'] : null,
                'record' => $scene['primary_id'],
                'access' => $state['solved'] ? 'cross-origin-readable' : 'same-origin-only',
                'secret' => $state['solved'] ? $ctx['flag'] : null,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)) ?></pre>
        </section>
        <?php
        return;
    }

    if ($kind === 'ssrf_fetch') {
        $url = (string) ($_POST['url'] ?? $_GET['url'] ?? 'https://example.com/card.png');
        ?>
        <section class="svc-two-column">
            <form class="svc-panel" method="post">
                <span class="svc-eyebrow">URL Preview</span>
                <h2><?= h((string) $scene['asset']) ?> 미리보기</h2>
                <label>url <input name="url" value="<?= h($url) ?>"></label>
                <button type="submit">가져오기</button>
            </form>
            <article class="svc-file-viewer <?= $state['solved'] ? 'svc-sensitive' : '' ?>">
                <div>preview result</div>
                <pre><?= h($state['solved'] ? "metadata_key=" . $ctx['metadata_key'] . "\n" . $ctx['flag'] : "fetched_url=" . $url . "\nstatus=queued\ninternal_probe=" . $ctx['metadata_url']) ?></pre>
            </article>
        </section>
        <?php
        return;
    }

    if ($kind === 'cache_poison') {
        ?>
        <section class="svc-two-column">
            <form class="svc-panel" method="get">
                <input type="hidden" name="challenge" value="<?= h((string) $challenge['id']) ?>">
                <span class="svc-eyebrow">Edge Preview</span>
                <h2><?= h((string) $scene['asset']) ?> 캐시</h2>
                <label>cache <input name="cache" value="<?= h((string) ($_GET['cache'] ?? 'view')) ?>"></label>
                <button type="submit">프리뷰</button>
            </form>
            <article class="svc-panel <?= $state['solved'] ? 'svc-sensitive' : '' ?>">
                <h3>canonical link</h3>
                <p><?= h($state['forwarded_host'] !== '' ? 'https://' . $state['forwarded_host'] . '/cached/' . $scene['primary_id'] : 'https://' . $ctx['target_host'] . '/cached/' . $scene['primary_id']) ?></p>
                <?php svc_flag_block($state, $ctx); ?>
            </article>
        </section>
        <?php
        return;
    }

    if ($kind === 'xxe_probe') {
        $xml = (string) ($_POST['xml'] ?? '<job><name>' . $scene['primary_id'] . '</name></job>');
        ?>
        <section class="svc-two-column">
            <form class="svc-panel" method="post">
                <span class="svc-eyebrow">XML Import</span>
                <h2><?= h((string) $scene['record']) ?> 가져오기</h2>
                <textarea name="xml" rows="8"><?= h($xml) ?></textarea>
                <button type="submit">Import</button>
            </form>
            <article class="svc-file-viewer <?= $state['solved'] ? 'svc-sensitive' : '' ?>">
                <div>import.log</div>
                <pre><?= h($state['solved'] ? "entity_resolved=true\n" . $ctx['flag'] : "job=" . $scene['queue_id'] . "\nparser=legacy-xml\nstatus=accepted") ?></pre>
            </article>
        </section>
        <?php
        return;
    }

    if ($kind === 'ssti_probe') {
        $template = (string) ($_POST['template'] ?? 'Hello {{name}}, ' . $scene['asset'] . ' is queued.');
        ?>
        <section class="svc-two-column">
            <form class="svc-panel" method="post">
                <span class="svc-eyebrow">Template Preview</span>
                <h2><?= h((string) $scene['module']) ?> 미리보기</h2>
                <textarea name="template" rows="6"><?= h($template) ?></textarea>
                <button type="submit">Render</button>
            </form>
            <article class="svc-render-preview <?= $state['solved'] ? 'svc-sensitive' : '' ?>">
                <span>preview</span>
                <p><?= h($state['solved'] ? (string) $ctx['flag'] : str_replace('{{name}}', (string) $scene['operator'], $template)) ?></p>
            </article>
        </section>
        <?php
        return;
    }

    if ($kind === 'command_injection') {
        $hostParam = (string) ($_POST['host'] ?? $_GET['host'] ?? '127.0.0.1');
        ?>
        <section class="svc-two-column">
            <form class="svc-panel" method="post">
                <span class="svc-eyebrow">Health Check</span>
                <h2><?= h((string) $scene['module']) ?> 상태 확인</h2>
                <label>host <input name="host" value="<?= h($hostParam) ?>"></label>
                <button type="submit">Check</button>
            </form>
            <article class="svc-terminal">
                <div>$ ping <?= h($hostParam) ?></div>
                <pre><?= h($state['solved'] ? "PING ok\n" . $ctx['flag'] : "PING " . $hostParam . "\n1 packets transmitted, 1 received") ?></pre>
            </article>
        </section>
        <?php
        return;
    }

    if ($kind === 'upload_bypass') {
        ?>
        <section class="svc-two-column">
            <form class="svc-panel" method="post">
                <span class="svc-eyebrow">Upload Gate</span>
                <h2><?= h((string) $scene['asset']) ?> 파일 업로드</h2>
                <label>filename <input name="filename" value="<?= h((string) ($_POST['filename'] ?? strtolower((string) $scene['record']) . '.png')) ?>"></label>
                <label>content_type <input name="content_type" value="<?= h((string) ($_POST['content_type'] ?? 'image/png')) ?>"></label>
                <button type="submit">Upload</button>
            </form>
            <article class="svc-panel <?= $state['solved'] ? 'svc-sensitive' : '' ?>">
                <h3>처리 결과</h3>
                <p><?= $state['solved'] ? '파일이 처리 큐에 들어갔습니다.' : '이미지 파일만 처리됩니다.' ?></p>
                <?php svc_flag_block($state, $ctx); ?>
            </article>
        </section>
        <?php
        return;
    }

    if ($kind === 'nosql_injection') {
        if ($state['solved']) {
            ?>
            <section class="svc-panel svc-panel-wide svc-sensitive">
                <span class="svc-eyebrow">Account Session</span>
                <h2><?= h((string) $scene['actor']) ?> 계정</h2>
                <p>필터 조건이 관리자 계정과 일치했습니다.</p>
                <?php svc_flag_block($state, $ctx); ?>
            </section>
            <?php
            return;
        }
        ?>
        <form class="svc-login-card" method="get">
            <input type="hidden" name="challenge" value="<?= h((string) $challenge['id']) ?>">
            <span class="svc-eyebrow">Object Filter Login</span>
            <h2><?= h((string) $scene['module']) ?> 로그인</h2>
            <label>username <input name="username" value="<?= h((string) ($_GET['username'] ?? 'guest')) ?>"></label>
            <label>password <input name="password" value="<?= h(is_array($_GET['password'] ?? null) ? '[object]' : (string) ($_GET['password'] ?? '')) ?>"></label>
            <button type="submit">Sign in</button>
        </form>
        <?php
        return;
    }

    if ($kind === 'mass_assignment') {
        ?>
        <section class="svc-two-column">
            <form class="svc-panel" method="post">
                <span class="svc-eyebrow">Profile API</span>
                <h2><?= h((string) $scene['actor']) ?> 프로필</h2>
                <label>display_name <input name="display_name" value="<?= h((string) ($_POST['display_name'] ?? 'trainee-' . $scene['queue_id'])) ?>"></label>
                <label>role <input name="role" value="<?= h((string) ($_POST['role'] ?? 'user')) ?>"></label>
                <button type="submit">Save</button>
            </form>
            <article class="svc-panel <?= $state['solved'] ? 'svc-sensitive' : '' ?>">
                <h3>저장된 권한</h3>
                <p><?= h((string) ($_POST['role'] ?? $_GET['role'] ?? 'user')) ?></p>
                <?php svc_flag_block($state, $ctx); ?>
            </article>
        </section>
        <?php
        return;
    }

    if ($kind === 'deserialization') {
        $profile = (string) ($_COOKIE['profile'] ?? $_GET['profile'] ?? $ctx['starter_profile']);
        ?>
        <section class="svc-two-column">
            <article class="svc-panel">
                <span class="svc-eyebrow">Remembered Profile</span>
                <h2><?= h((string) $scene['module']) ?> 세션 복원</h2>
                <pre class="svc-code-inline">profile=<?= h($profile) ?></pre>
            </article>
            <article class="svc-panel <?= $state['solved'] ? 'svc-sensitive' : 'svc-disabled' ?>">
                <h3>복원된 워크스페이스</h3>
                <p><?= $state['solved'] ? 'root workspace' : 'public workspace' ?></p>
                <?php svc_flag_block($state, $ctx); ?>
            </article>
        </section>
        <?php
        return;
    }

    if ($kind === 'host_header') {
        ?>
        <section class="svc-vhost-page <?= $state['solved'] ? 'svc-sensitive' : '' ?>">
            <span class="svc-eyebrow">Virtual Host Router</span>
            <h2><?= h($state['solved'] ? 'Admin virtual host' : 'Public virtual host') ?></h2>
            <dl class="svc-mini-list">
                <dt>Host</dt><dd><?= h((string) $state['host']) ?></dd>
                <dt>X-Forwarded-Host</dt><dd><?= h($state['forwarded_host'] !== '' ? (string) $state['forwarded_host'] : '(none)') ?></dd>
                <dt>admin</dt><dd>admin.<?= h((string) $ctx['target_host']) ?></dd>
            </dl>
            <?php svc_flag_block($state, $ctx); ?>
        </section>
        <?php
        return;
    }

    ?>
    <section class="svc-two-column">
        <form class="svc-panel" method="get">
            <input type="hidden" name="challenge" value="<?= h((string) $challenge['id']) ?>">
            <span class="svc-eyebrow"><?= h((string) $scene['asset']) ?> Control</span>
            <h2><?= h((string) $scene['module']) ?> 잠금</h2>
            <label>route <input name="route" value="<?= h((string) ($_GET['route'] ?? '')) ?>"></label>
            <label>record <input name="record" value="<?= h((string) ($_GET['record'] ?? '')) ?>"></label>
            <label>role <input name="role" value="<?= h((string) ($_GET['role'] ?? '')) ?>"></label>
            <button type="submit">Execute</button>
        </form>
        <article class="svc-panel <?= $state['solved'] ? 'svc-sensitive' : 'svc-disabled' ?>">
            <h3><?= h((string) $scene['asset']) ?></h3>
            <p><?= $state['solved'] ? '운영 조건이 모두 일치했습니다.' : '운영 조건 일부가 아직 맞지 않습니다.' ?></p>
            <?php svc_flag_block($state, $ctx); ?>
        </article>
    </section>
    <?php
}

if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) === 'OPTIONS') {
    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Authorization, Content-Type, X-HTTP-Method-Override, X-Forwarded-Host');
    $origin = svc_header('Origin');
    if ($origin !== '') {
        header('Access-Control-Allow-Origin: ' . $origin);
    }
    exit;
}

$scene = svc_scene($challenge, $ctx);
$state = svc_state($kind, $ctx);

header('Referrer-Policy: no-referrer');
header('X-Content-Type-Options: nosniff');
header('X-Wargame-Challenge: ' . (string) $challenge['id']);
header('Content-Type: text/html; charset=utf-8');
header("Content-Security-Policy: default-src 'self'; img-src 'self' data: https://www.hanplanet.com; font-src 'self' https://cdn.jsdelivr.net; style-src 'self' https://www.hanplanet.com; script-src 'self' https://www.hanplanet.com; connect-src 'self' https://www.hanplanet.com; base-uri 'none'; frame-ancestors 'none'");

$user = current_django_user();
$djangoPreferences = is_array($user['preferences'] ?? null) ? $user['preferences'] : [];
$accountThemeMode = in_array(($djangoPreferences['theme_mode'] ?? ''), ['light', 'dark'], true) ? (string) $djangoPreferences['theme_mode'] : '';
$preferredUiLang = in_array(($djangoPreferences['ui_lang'] ?? ''), ['ko', 'en'], true) ? (string) $djangoPreferences['ui_lang'] : 'ko';
$bodyThemeClass = $accountThemeMode === 'light' ? '' : ' theme-dark';
$cssVersion = (string) (filemtime(__DIR__ . '/assets/wargame.css') ?: time());
$faviconVersion = (string) (filemtime(__DIR__ . '/assets/favicon.ico') ?: time());
$pageTitle = (string) $scene['brand'];
$metaDescription = $preferredUiLang === 'en'
    ? 'Solve a hands-on Hanplanet Wargame lab and practice real security reasoning.'
    : 'Hanplanet 워게임 실습 문제를 풀며 실제 보안 사고 과정을 연습합니다.';
?>
<!doctype html>
<html lang="<?= h($preferredUiLang) ?>" data-account-theme-mode="<?= h($accountThemeMode) ?>">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="<?= h($metaDescription) ?>">
    <meta property="og:title" content="<?= h($pageTitle) ?>">
    <meta property="og:description" content="<?= h($metaDescription) ?>">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="<?= h($pageTitle) ?>">
    <meta name="twitter:description" content="<?= h($metaDescription) ?>">
    <title><?= h($pageTitle) ?></title>
    <link rel="icon" href="/assets/favicon.ico?v=<?= h($faviconVersion) ?>">
    <link rel="stylesheet" href="<?= h(django_static_url('css/common/layout.css')) ?>">
    <link rel="stylesheet" href="<?= h(django_static_url('css/common/style.css')) ?>">
    <link rel="stylesheet" href="/assets/wargame.css?v=<?= h($cssVersion) ?>">
</head>
<body class="page<?= h($bodyThemeClass) ?> wargame-page">
    <main class="svc-page svc-case-<?= h(wargame_css_class((string) $scene['case_slug'])) ?> svc-kind-<?= h(wargame_css_class($kind)) ?>">
        <header class="svc-topbar">
            <div>
                <strong><?= h((string) $scene['brand']) ?></strong>
                <span><?= h((string) $scene['tagline']) ?></span>
            </div>
            <nav>
                <?php foreach ((array) $scene['nav'] as $navItem): ?>
                    <a href="#"><?= h((string) $navItem) ?></a>
                <?php endforeach; ?>
            </nav>
            <span class="svc-user"><?= h((string) $scene['operator']) ?></span>
        </header>

        <section class="svc-hero">
            <div>
                <span><?= h((string) $scene['module']) ?></span>
                <h1><?= h((string) $scene['hero']) ?></h1>
                <p><?= h((string) $scene['asset']) ?> · <?= h((string) $scene['screen_id']) ?></p>
            </div>
            <aside>
                <span>status</span>
                <strong><?= $state['solved'] ? 'elevated' : 'online' ?></strong>
            </aside>
        </section>

        <?php svc_render_service($kind, $challenge, $ctx, $scene, $state); ?>
    </main>
</body>
</html>
