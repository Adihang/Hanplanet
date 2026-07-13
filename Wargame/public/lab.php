<?php
declare(strict_types=1);

require_once __DIR__ . '/../app/target_bootstrap.php';

wargame_db();

function target_mission_number(array $mission): string
{
    return str_pad((string) max(1, (int) (($mission['order'] ?? 10) / 10)), 2, '0', STR_PAD_LEFT);
}

$context = LabSessionService::targetContext();
$error = null;
$completionTicket = null;
$response = is_array($context) ? (array) $context['response'] : [];

if (is_array($context) && $_SERVER['REQUEST_METHOD'] === 'POST') {
    try {
        LabSessionService::requireTargetCsrf($context, $_POST['target_csrf'] ?? null);
        $action = (string) ($_POST['action'] ?? 'request');
        if ($action === 'reset') {
            $response = LabSessionService::resetTarget($context);
        } elseif ($action === 'request') {
            $virtualRequest = target_request_from_json((string) ($_POST['request_json'] ?? ''));
            $response = LabSessionService::handleTargetRequest($context, $virtualRequest);
        } else {
            throw new InvalidArgumentException('알 수 없는 실습 작업입니다.');
        }
        if (($response['completed'] ?? false) === true) {
            $completionTicket = LabSessionService::issueCompletionTicket($context);
        }
    } catch (Throwable $exception) {
        $error = $exception->getMessage();
    }
}

if (is_array($context) && ($response['completed'] ?? false) === true && $completionTicket === null && $error === null) {
    try {
        $completionTicket = LabSessionService::issueCompletionTicket($context);
    } catch (Throwable $exception) {
        $error = $exception->getMessage();
    }
}

$missionId = is_array($context) ? (string) $context['row']['challenge_id'] : '';
$mission = $missionId !== '' ? wargame_mission($missionId) : null;
$surface = (string) ($response['surface'] ?? 'terminal');
$requestTemplate = (array) ($response['request'] ?? [
    'method' => 'GET', 'path' => '/', 'query' => [], 'headers' => [], 'body' => [], 'files' => [],
]);
$responseOutput = (array) ($response['output'] ?? []);
$responseHeaders = (array) ($response['headers'] ?? []);
$event = (array) ($response['event'] ?? []);
$target = is_array($mission) ? (array) ($mission['target'] ?? []) : [];
$cssVersion = (string) (filemtime(__DIR__ . '/assets/wargame.css') ?: time());
$jsVersion = (string) (filemtime(__DIR__ . '/assets/lab.js') ?: time());

$sandboxDocument = '';
$sandboxNonce = '';
if ($missionId === LabEngine::REFLECTED_XSS && is_string($responseOutput['rendered_fragment'] ?? null)) {
    $nonce = '';
    if (preg_match("/nonce-([^'\"; ]+)/", (string) ($responseHeaders['Content-Security-Policy'] ?? ''), $nonceMatch)) {
        $nonce = $nonceMatch[1];
    }
    if ($nonce !== '') {
        $sandboxNonce = $nonce;
        $sandboxDocument = '<!doctype html><meta charset="utf-8">'
            . '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'nonce-' . wargame_html($nonce) . '\'; script-src \'nonce-' . wargame_html($nonce) . '\'">'
            . '<style nonce="' . wargame_html($nonce) . '">body{margin:0;padding:24px;background:#f4f7f6;color:#14221e;font:15px system-ui}.search-result{padding:18px;border:1px solid #cad8d3;border-radius:10px;background:white}</style>'
            . '<script nonce="' . wargame_html($nonce) . '">window.lab={report:function(value){parent.postMessage({source:"field-ops-xss",value:value},"*")}};</script>'
            . (string) $responseOutput['rendered_fragment'];
    }
}

target_security_headers($sandboxNonce);
?>
<!doctype html>
<html lang="ko">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow,noarchive">
    <title><?= is_array($mission) ? wargame_html((string) $mission['title']) : '격리 실습' ?> · FIELD//OPS RANGE</title>
    <link rel="stylesheet" href="/assets/wargame.css?v=<?= wargame_html($cssVersion) ?>">
    <script src="/assets/lab.js?v=<?= wargame_html($jsVersion) ?>" defer></script>
</head>
<body class="lab-body">
    <main class="lab-shell">
        <?php if (!is_array($context) || !is_array($mission)): ?>
            <section class="ticket-panel">
                <span class="eyebrow">TARGET SESSION REQUIRED</span>
                <h1>활성 실습 인스턴스가 없습니다</h1>
                <p>작전 브리핑에서 가상 타깃을 시작하면 이 페이지에 개인별 격리 환경이 연결됩니다.</p>
                <a class="button" href="/">작전 콘솔로 돌아가기</a>
            </section>
        <?php else: ?>
            <header class="lab-topbar">
                <span class="lab-brand">FIELD//OPS RANGE</span>
                <span class="lab-scope">INSTANCE <?= wargame_html(strtoupper(substr((string) $context['instance_id'], 0, 8))) ?> · NO OUTBOUND NETWORK · TTL 02:00:00</span>
                <span class="status-pill <?= ($response['completed'] ?? false) ? 'completed' : 'sent' ?>"><?= ($response['completed'] ?? false) ? 'OBJECTIVE COMPLETE' : 'TARGET ONLINE' ?></span>
            </header>

            <div class="lab-grid">
                <aside class="lab-sidebar">
                    <div>
                        <span class="case-id">CASE <?= wargame_html(target_mission_number($mission)) ?></span>
                        <h1><?= wargame_html((string) $mission['title']) ?></h1>
                        <p><?= wargame_html((string) ($mission['brief'] ?? '')) ?></p>
                        <div class="lab-objective"><strong>MISSION OBJECTIVE</strong><p><?= wargame_html((string) ($target['objective'] ?? '')) ?></p></div>
                    </div>
                    <div>
                        <span class="panel-label">LIVE HINT FEED</span>
                        <div class="hint-stack">
                            <?php foreach ((array) ($response['hints'] ?? []) as $index => $hint): ?>
                                <details><summary>현장 힌트 <?= $index + 1 ?></summary><p><?= wargame_html((string) $hint) ?></p></details>
                            <?php endforeach; ?>
                        </div>
                        <div class="lab-sidebar-actions">
                            <a class="button ghost" href="/?mission=<?= wargame_html(rawurlencode($missionId)) ?>">브리핑으로 돌아가기</a>
                            <form method="post" data-loading-form>
                                <input type="hidden" name="target_csrf" value="<?= wargame_html(LabSessionService::targetCsrf($context)) ?>">
                                <input type="hidden" name="action" value="reset">
                                <button class="button danger" type="submit" data-loading-label="초기화 중…">인스턴스 초기화</button>
                            </form>
                        </div>
                    </div>
                </aside>

                <section class="lab-workspace" aria-label="가상 타깃 작업 공간">
                    <div class="lab-tabs">
                        <span class="lab-tab active"><?= $surface === 'terminal' ? 'TERMINAL' : ($surface === 'network' ? 'NETWORK MAP' : 'TARGET BROWSER') ?></span>
                        <span class="lab-tab">REQUEST COMPOSER</span>
                        <span class="lab-tab">RESPONSE INSPECTOR</span>
                    </div>
                    <div class="lab-surface">
                        <?php if ($error !== null): ?><div class="lab-result error" role="alert"><?= wargame_html($error) ?></div><?php endif; ?>

                        <?php if ($surface === 'browser'): ?>
                            <div class="browser-window">
                                <div class="browser-head">
                                    <span class="window-dot red"></span><span class="window-dot amber"></span><span class="window-dot green"></span>
                                    <span class="browser-address">https://target.instance<?= wargame_html((string) ($requestTemplate['path'] ?? '/')) ?></span>
                                </div>
                                <div class="browser-page">
                                    <span class="panel-label">VIRTUAL CLIENT SERVICE</span>
                                    <h2><?= wargame_html((string) ($response['title'] ?? $mission['title'])) ?></h2>
                                    <p>이 브라우저는 현재 instance의 가상 HTTP 요청만 처리합니다. 실제 주소로 트래픽을 보내지 않습니다.</p>
                                    <?php if ($sandboxDocument !== ''): ?>
                                        <div class="sandbox-label">OPAQUE-ORIGIN XSS SANDBOX</div>
                                        <iframe class="xss-sandbox" sandbox="allow-scripts" srcdoc="<?= wargame_html($sandboxDocument) ?>" title="격리된 XSS 렌더링 결과"></iframe>
                                        <div class="lab-result" data-xss-event>샌드박스 이벤트 대기 중</div>
                                    <?php endif; ?>
                                    <pre class="response-inspector"><?= wargame_html(target_pretty_json($responseOutput)) ?></pre>
                                </div>
                            </div>
                        <?php elseif ($surface === 'network'): ?>
                            <div class="network-window">
                                <div class="network-head">
                                    <span class="window-dot red"></span><span class="window-dot amber"></span><span class="window-dot green"></span>
                                    <span class="window-title">IN-MEMORY VIRTUAL NETWORK</span>
                                </div>
                                <div class="network-canvas">
                                    <div class="network-route">
                                        <?php $trace = (array) ($responseOutput['trace'] ?? []); ?>
                                        <?php if ($trace === []): ?>
                                            <div class="network-node"><strong>PREVIEW API</strong><span>waiting for URL</span></div>
                                            <span class="network-edge"></span>
                                            <div class="network-node"><strong>ALLOWLIST</strong><span>vendor.test only</span></div>
                                            <span class="network-edge"></span>
                                            <div class="network-node"><strong>INTERNAL</strong><span>metadata isolated</span></div>
                                        <?php else: ?>
                                            <?php foreach ($trace as $index => $hop): ?>
                                                <?php if ($index > 0): ?><span class="network-edge"></span><?php endif; ?>
                                                <div class="network-node"><strong><?= wargame_html((string) ($hop['host'] ?? 'virtual')) ?></strong><span>HTTP <?= (int) ($hop['status'] ?? 0) ?></span></div>
                                            <?php endforeach; ?>
                                        <?php endif; ?>
                                    </div>
                                </div>
                                <pre class="response-inspector dark"><?= wargame_html(target_pretty_json($responseOutput)) ?></pre>
                            </div>
                        <?php else: ?>
                            <div class="terminal">
                                <div class="terminal-head">
                                    <span class="window-dot red"></span><span class="window-dot amber"></span><span class="window-dot green"></span>
                                    <span class="window-title">operator@range:~/<?= wargame_html((string) ($response['lab_type'] ?? 'target')) ?></span>
                                </div>
                                <pre class="terminal-output"><span class="accent">$ virtual-request --inspect</span>
HTTP <?= (int) ($response['status'] ?? 0) ?>
EVENT <?= wargame_html((string) ($event['type'] ?? 'ready')) ?>

<?= wargame_html(target_pretty_json($responseOutput)) ?></pre>
                            </div>
                        <?php endif; ?>

                        <div class="request-response-grid">
                            <form class="request-composer" method="post" data-loading-form>
                                <div class="composer-head"><div><span class="panel-label">VIRTUAL REQUEST</span><h2>요청 편집기</h2></div><span class="surface-pill"><?= wargame_html((string) ($requestTemplate['method'] ?? 'GET')) ?> <?= wargame_html((string) ($requestTemplate['path'] ?? '/')) ?></span></div>
                                <input type="hidden" name="target_csrf" value="<?= wargame_html(LabSessionService::targetCsrf($context)) ?>">
                                <input type="hidden" name="action" value="request">
                                <label for="request_json">method, path, query, headers, body, files를 JSON으로 편집</label>
                                <textarea id="request_json" name="request_json" rows="17" spellcheck="false"><?= wargame_html(target_pretty_json($requestTemplate)) ?></textarea>
                                <button class="button" type="submit" data-loading-label="가상 요청 전송 중…">요청 전송 <span aria-hidden="true">⌁</span></button>
                            </form>

                            <section class="response-card">
                                <div class="composer-head"><div><span class="panel-label">VIRTUAL RESPONSE</span><h2>응답 검사기</h2></div><span class="status-pill <?= (int) ($response['status'] ?? 500) < 400 ? 'sent' : 'failed' ?>">HTTP <?= (int) ($response['status'] ?? 0) ?></span></div>
                                <div class="response-event"><strong><?= wargame_html((string) ($event['type'] ?? 'ready')) ?></strong><span><?= wargame_html((string) ($event['message'] ?? '가상 타깃이 준비되었습니다.')) ?></span></div>
                                <div class="header-list">
                                    <?php if ($responseHeaders === []): ?><span>응답 헤더 없음</span><?php endif; ?>
                                    <?php foreach ($responseHeaders as $name => $value): ?><code><?= wargame_html((string) $name) ?>: <?= wargame_html((string) $value) ?></code><?php endforeach; ?>
                                </div>
                            </section>
                        </div>

                        <?php if (is_string($completionTicket)): ?>
                            <section class="completion-receipt">
                                <h2>목표 증거가 검증되었습니다</h2>
                                <p>일회용 완료 증표를 작전 콘솔로 보내 계정에 기록하고 다음 의뢰를 수신하세요.</p>
                                <form action="/" method="post" data-loading-form>
                                    <input type="hidden" name="action" value="claim_completion">
                                    <input type="hidden" name="ticket" value="<?= wargame_html($completionTicket) ?>">
                                    <button class="button" type="submit" data-loading-label="증거 전송 중…">완료 기록 및 다음 의뢰 수신</button>
                                </form>
                            </section>
                        <?php endif; ?>
                    </div>
                </section>
            </div>
        <?php endif; ?>
    </main>
</body>
</html>
