<?php
declare(strict_types=1);

const WARGAME_TEST_COMPLETION_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

putenv('WARGAME_DISPATCH_PREVIEW=1');
putenv('WARGAME_COMPLETION_SECRET=' . WARGAME_TEST_COMPLETION_SECRET);
putenv('WARGAME_PUBLIC_URL=https://wargame.hanplanet.com/');
require_once __DIR__ . '/../app/bootstrap.php';
require_once __DIR__ . '/../app/MissionMailer.php';
require_once __DIR__ . '/../app/CampaignService.php';
require_once __DIR__ . '/../app/MarkdownRenderer.php';

$assertions = 0;
$assert = static function (bool $condition, string $message) use (&$assertions): void {
    $assertions++;
    if (!$condition) {
        throw new RuntimeException('Portal assertion failed: ' . $message);
    }
};

$missions = wargame_missions();
$first = array_values($missions)[0];
$markdown = wargame_mission_markdown($first);
$introHtml = wargame_markdown_render((string) $markdown['technical_intro']);
$briefingHtml = wargame_markdown_render((string) $markdown['technical_details']);
$assert(str_contains((string) $markdown['dossier'], '## 의뢰 배경'), 'dossier markdown heading');
$assert(str_starts_with($introHtml, '<h2>학습 노트 · 웹 해킹의 첫 단계') && !str_contains($introHtml, '�'), 'markdown preserves Korean learning headings');
$assert(str_contains($briefingHtml, '<table>') && str_contains($briefingHtml, '<pre><code class="language-http">'), 'briefing markdown table and code');
$unsafeMarkdown = wargame_markdown_render("## 안전성\n\n<script>alert(1)</script>");
$assert(!str_contains($unsafeMarkdown, '<script>') && str_contains($unsafeMarkdown, '&lt;script&gt;'), 'markdown escapes raw HTML');
foreach ($missions as $mission) {
    $missionMarkdown = wargame_mission_markdown($mission);
    foreach (['dossier', 'objective', 'technical_intro', 'resources', 'hints_intro'] as $blockName) {
        $assert(str_starts_with(wargame_markdown_render((string) $missionMarkdown[$blockName]), '<h2>'), "{$blockName} markdown heading");
    }
    $detailHtml = wargame_markdown_render((string) $missionMarkdown['technical_details']);
    $assert(str_contains($detailHtml, '<table>') && str_contains($detailHtml, '<pre><code'), 'technical markdown details');
}
$mailUser = [
    'user_id' => '910001',
    'username' => 'mail-preview-operator',
    'display_name' => '메일 검증 오퍼레이터',
    'email' => 'operator@example.com',
];
$delivery = MissionMailer::dispatch($mailUser['email'], $mailUser, $first);
$assert($delivery['status'] === 'preview', 'preview transport');
$assert($delivery['transport'] === 'preview', 'preview transport label');

foreach ($missions as $missionId => $mission) {
    $composed = MissionMailer::compose($mailUser, $mission);
    $target = (array) ($mission['target'] ?? []);
    $email = (array) ($mission['email'] ?? []);
    $expectedUrl = 'https://wargame.hanplanet.com/?mission=' . rawurlencode($missionId) . '&launch=1';
    $expectedTargetAddress = 'https://wargame.hanplanet.com' . (string) ($target['entry_url'] ?? '');
    foreach (['story', 'brief'] as $field) {
        $assert(str_contains((string) $composed['text'], trim((string) ($mission[$field] ?? ''))), "{$missionId} mail contains {$field}");
    }
    foreach (['service_name', 'hostname', 'entry_path', 'objective'] as $field) {
        $assert(str_contains((string) $composed['text'], trim((string) ($target[$field] ?? ''))), "{$missionId} mail contains target {$field}");
    }
    foreach (['urgency', 'contact_context', 'closing'] as $field) {
        $assert(str_contains((string) $composed['text'], trim((string) ($email[$field] ?? ''))), "{$missionId} mail contains {$field}");
    }
    $assert(count((array) ($email['scope'] ?? [])) >= 3, "{$missionId} mail scope is detailed");
    $assert(count((array) ($email['deliverables'] ?? [])) >= 3, "{$missionId} mail deliverables are detailed");
    $assert(count((array) ($email['cautions'] ?? [])) >= 2, "{$missionId} mail cautions are detailed");
    $assert(
        LabSessionService::targetEntryPath($missionId) === (string) ($target['entry_url'] ?? ''),
        "{$missionId} curriculum entry URL matches live target route"
    );
    $assert((string) ($composed['target_address'] ?? '') === $expectedTargetAddress, "{$missionId} mail exposes live target address");
    $assert(str_contains((string) $composed['text'], '접속 주소: ' . $expectedTargetAddress), "{$missionId} text mail contains live target address");
    $assert(
        str_contains((string) $composed['html'], htmlspecialchars($expectedTargetAddress, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')),
        "{$missionId} HTML mail contains live target address"
    );
    $assert((string) $composed['cta_url'] === $expectedUrl, "{$missionId} mail deep-links to target launch");
    $assert(
        str_contains((string) $composed['html'], 'href="' . htmlspecialchars($expectedUrl, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '"'),
        "{$missionId} HTML mail contains escaped target launch link"
    );
    $assert(!str_contains((string) $composed['cta_url'], '/lab.php'), "{$missionId} mail CTA excludes legacy lab wrapper");
    $assert(!str_contains((string) $composed['text'], 'Bearer eyJ'), "{$missionId} mail excludes bearer secrets");
}

$longSubject = '[FIELD//OPS] 긴급 보안 진단 의뢰 · 오로라 문구점 할인 확인 서비스 운영 응답 검증 요청';
$encodedSubject = MissionMailer::subjectHeader($longSubject);
$assert(str_contains($encodedSubject, "\r\n "), 'long UTF-8 subject is folded');
preg_match_all('/=\?UTF-8\?B\?([^?]+)\?=/i', $encodedSubject, $encodedWords, PREG_SET_ORDER);
$decodedSubject = '';
foreach ($encodedWords as $encodedWord) {
    $fullWord = (string) $encodedWord[0];
    $assert(strlen($fullWord) <= 75, 'RFC 2047 encoded-word stays within 75 characters');
    $decodedChunk = base64_decode((string) $encodedWord[1], true);
    $assert(is_string($decodedChunk), 'RFC 2047 subject chunk is valid base64');
    $decodedSubject .= (string) $decodedChunk;
}
$assert($decodedSubject === $longSubject, 'folded UTF-8 subject decodes without character loss');
$assert(!str_contains(MissionMailer::subjectHeader("정상 제목\r\nBcc: attacker@example.test"), "Bcc:"), 'subject folding prevents header injection');

$mailerSource = (string) file_get_contents(__DIR__ . '/../app/MissionMailer.php');
$assert(str_contains($mailerSource, "['none', 'tls']"), 'SMTP security mode is an explicit enum');
$assert(str_contains($mailerSource, 'smtp_auth_requires_tls'), 'SMTP authentication fails closed without TLS');
$assert(str_contains($mailerSource, 'WARGAME_SMTP_TLS_PEER_NAME'), 'SMTP certificate peer name is configurable');
$dataAcceptedAt = strpos($mailerSource, 'self::expect($socket, [250]);');
$bestEffortQuitAt = strpos($mailerSource, 'Best effort only after the server accepted the message.');
$assert(is_int($dataAcceptedAt) && is_int($bestEffortQuitAt) && $bestEffortQuitAt > $dataAcceptedAt, 'SMTP QUIT is best effort only after DATA acceptance');

$ids = array_keys($missions);
$progress = wargame_progress(array_slice($ids, 0, 3));
$assert($progress['completed'] === 3, 'completed count');
$assert($progress['current_id'] === $ids[3], 'next mission selection');
$assert($progress['states'][$ids[2]] === 'completed', 'completed state');
$assert($progress['states'][$ids[3]] === 'available', 'available state');
$assert($progress['states'][$ids[4]] === 'locked', 'locked state');
$gapProgress = wargame_progress([$ids[2]]);
$assert($gapProgress['current_id'] === $ids[0], 'gap cannot skip first mission');
$assert($gapProgress['states'][$ids[3]] === 'locked', 'gap solve cannot unlock later mission');

$receiptUser = ['user_id' => 42, 'username' => 'training-user'];
$receipt = django_completion_payload($receiptUser, $ids[0], str_repeat('a', 64));
$assert(isset($receipt['receipt'], $receipt['timestamp'], $receipt['nonce']), 'signed receipt fields');
$message = implode("\n", [
    'django-user-id:v1:42',
    $ids[0],
    str_repeat('a', 64),
    (string) $receipt['timestamp'],
    (string) $receipt['nonce'],
]);
$assert(
    hash_equals(hash_hmac('sha256', $message, WARGAME_TEST_COMPLETION_SECRET), (string) $receipt['receipt']),
    'completion receipt signature'
);
$renamedReceiptUser = ['user_id' => 42, 'username' => 'renamed-training-user'];
$renamedReceipt = django_completion_payload($renamedReceiptUser, $ids[0], str_repeat('c', 64));
$renamedMessage = implode("\n", [
    'django-user-id:v1:42',
    $ids[0],
    str_repeat('c', 64),
    (string) $renamedReceipt['timestamp'],
    (string) $renamedReceipt['nonce'],
]);
$assert(
    hash_equals(hash_hmac('sha256', $renamedMessage, WARGAME_TEST_COMPLETION_SECRET), (string) $renamedReceipt['receipt']),
    'completion receipt remains bound to immutable user id after username change'
);
$assert(wargame_completion_secret() === WARGAME_TEST_COMPLETION_SECRET, 'strong completion secret is accepted');
putenv('WARGAME_COMPLETION_SECRET=change-this-to-a-separate-long-random-wargame-secret');
$assert(wargame_completion_secret() === '', 'known completion secret placeholder is rejected');
putenv('WARGAME_COMPLETION_SECRET=' . str_repeat('a', 64));
$assert(wargame_completion_secret() === '', 'low-entropy completion secret is rejected');
putenv('WARGAME_COMPLETION_SECRET=' . WARGAME_TEST_COMPLETION_SECRET);

$masked = CampaignService::maskedEmail('operator@example.com');
$assert(str_ends_with($masked, '@example.com') && !str_contains($masked, 'operator@'), 'email masking');
$assert(strlen(csrf_token()) === 64, 'CSRF token length');
$assert(wargame_bearer_token('header.payload.signature') === 'header.payload.signature', 'JWT-shaped bearer token is accepted');
$headerInjectionRejected = false;
try {
    accept_django_token("header.payload.signature\r\nX-Injected: true");
} catch (InvalidArgumentException) {
    $headerInjectionRejected = true;
}
$assert($headerInjectionRejected, 'browser token cannot inject headers into the internal Django request');
$malformedBearerRejected = false;
try {
    wargame_bearer_token('not-a-three-segment-jwt');
} catch (InvalidArgumentException) {
    $malformedBearerRejected = true;
}
$assert($malformedBearerRejected, 'non-JWT bearer token is rejected before internal API access');
$missionReturnPath = '/?mission=web-v1-01-http&launch=1';
$missionLoginUrl = django_login_url($missionReturnPath);
$missionLoginQuery = [];
parse_str((string) parse_url($missionLoginUrl, PHP_URL_QUERY), $missionLoginQuery);
$assert(
    (string) ($missionLoginQuery['next'] ?? '') === 'https://wargame.hanplanet.com' . $missionReturnPath,
    'Django login preserves exact email mission deep-link'
);
$invalidLoginQuery = [];
parse_str((string) parse_url(django_login_url('//evil.example/steal'), PHP_URL_QUERY), $invalidLoginQuery);
$assert((string) ($invalidLoginQuery['next'] ?? '') === 'https://wargame.hanplanet.com/', 'Django login rejects protocol-relative return paths');
$backslashLoginQuery = [];
parse_str((string) parse_url(django_login_url('/\\evil.example/steal'), PHP_URL_QUERY), $backslashLoginQuery);
$assert((string) ($backslashLoginQuery['next'] ?? '') === 'https://wargame.hanplanet.com/', 'Django login rejects backslash return paths');
$assert(wargame_return_path('/?mission=web-v1-01-http') === '/?mission=web-v1-01-http', 'local return path preserves a valid mission query');
$assert(wargame_return_path('/\\evil.example/steal') === '/', 'local redirect rejects browser-normalized backslash host');
$assert(wargame_return_path("/safe\r\nLocation: https://evil.example") === '/', 'local redirect rejects control characters');

$upperIdentity = ['user_id' => '930001', 'username' => 'Alice'];
$lowerIdentity = ['user_id' => '930002', 'username' => 'alice'];
$renamedIdentity = ['user_id' => '930001', 'username' => 'alice-renamed'];
$assert(wargame_owner_key($upperIdentity) !== wargame_owner_key($lowerIdentity), 'case-colliding accounts have distinct stable owner keys');
$assert(wargame_owner_key($upperIdentity) === wargame_owner_key($renamedIdentity), 'owner key survives username changes');
$legacyLowercaseOwner = hash_hmac('sha256', 'alice', wargame_app_secret());
$assert($legacyLowercaseOwner !== wargame_owner_key($upperIdentity), 'legacy username ownership is not inherited by a stable account');
$missingStableIdRejected = false;
try {
    wargame_owner_key(['username' => 'Alice']);
} catch (InvalidArgumentException) {
    $missingStableIdRejected = true;
}
$assert($missingStableIdRejected, 'owner key requires the immutable Django user id');

$wargameCss = (string) file_get_contents(__DIR__ . '/../public/assets/wargame.css');
$assert(str_contains($wargameCss, 'font-family: "KakaoSmallFont"') && str_contains($wargameCss, 'font-family: var(--display)') && str_contains($wargameCss, '"Inter"'), 'Django-compatible Wargame font stack');
$assert(is_file(__DIR__ . '/../public/assets/fonts/kakao/KakaoSmallSans-Regular.ttf'), 'bundled Kakao font asset');
$themeBootstrap = (string) file_get_contents(__DIR__ . '/../public/assets/theme.js');
$assert(str_contains($themeBootstrap, "localStorage.getItem('wargame-theme')") && str_contains($themeBootstrap, 'document.documentElement.dataset.theme = theme'), 'theme applies before page styles');
$portalScript = (string) file_get_contents(__DIR__ . '/../public/assets/portal.js');
$syncAwaitAt = strpos($portalScript, 'const accountState = await syncAccount();');
$autoLaunchAt = strpos($portalScript, "if (accountState.status === 'ready') openTargetFromEmail();");
$assert(is_int($syncAwaitAt) && is_int($autoLaunchAt) && $autoLaunchAt > $syncAwaitAt, 'email auto-launch waits for account refresh');

$dispatchUser = [
    'user_id' => (string) random_int(920000, 929999),
    'username' => 'portal-test-' . bin2hex(random_bytes(5)),
    'display_name' => '포털 테스트',
    'email' => 'learner@example.com',
];
$dispatchOwner = wargame_owner_key($dispatchUser);
$assert(!campaign_started($dispatchOwner), 'fresh account cannot bypass first mission email flow');
$firstDispatch = CampaignService::dispatchMission($dispatchUser, $first, 'test');
$secondDispatch = CampaignService::dispatchMission($dispatchUser, $first, 'test');
$assert($firstDispatch['status'] === 'preview', 'campaign preview dispatch');
$assert($secondDispatch['id'] === $firstDispatch['id'], 'campaign dispatch idempotency');
$countDispatch = wargame_db()->prepare('SELECT COUNT(*) FROM mission_dispatches WHERE owner_key_hash = :owner');
$countDispatch->execute(['owner' => $dispatchOwner]);
$assert((int) $countDispatch->fetchColumn() === 1, 'one dispatch row');
$assert(campaign_started($dispatchOwner), 'first mission dispatch activates campaign');
wargame_db()->prepare('DELETE FROM mission_dispatches WHERE owner_key_hash = :owner')->execute(['owner' => $dispatchOwner]);

$handoffUser = [
    'user_id' => (string) random_int(960000, 969999),
    'username' => 'handoff-test-' . bin2hex(random_bytes(5)),
    'display_name' => '완료 인계 테스트',
    'email' => 'handoff@example.com',
];
$handoffOwner = wargame_owner_key($handoffUser);
$handoffInstance = bin2hex(random_bytes(16));
$handoffTicket = bin2hex(random_bytes(32));
$handoffTicketHash = hash('sha256', $handoffTicket);
wargame_db()->prepare(
    "INSERT INTO lab_instances (id, challenge_id, owner_key_hash, access_token_hash, state_json, created_at, expires_at) VALUES (:id, :challenge, :owner, :access, '{}', :created, :expires)"
)->execute([
    'id' => $handoffInstance,
    'challenge' => $ids[0],
    'owner' => $handoffOwner,
    'access' => hash('sha256', random_bytes(32)),
    'created' => time(),
    'expires' => time() + 600,
]);
wargame_db()->prepare(
    'INSERT INTO completion_tickets (ticket_hash, instance_id, challenge_id, owner_key_hash, expires_at, consumed_at) '
    . 'VALUES (:ticket, :instance, :challenge, :owner, :expires, NULL)'
)->execute([
    'ticket' => $handoffTicketHash,
    'instance' => $handoffInstance,
    'challenge' => $ids[0],
    'owner' => $handoffOwner,
    'expires' => time() + 600,
]);

$handoffToken = LabSessionService::completionHandoffToken($handoffTicket);
LabSessionService::requireCompletionHandoff($handoffTicket, $handoffToken);
$assert(strlen($handoffToken) === 64, 'completion handoff has a signed CSRF token');
$invalidHandoffRejected = false;
try {
    LabSessionService::requireCompletionHandoff($handoffTicket, str_repeat('0', 64));
} catch (InvalidArgumentException) {
    $invalidHandoffRejected = true;
}
$assert($invalidHandoffRejected, 'completion handoff rejects an invalid CSRF token');

$solveCalls = 0;
$solveRecorder = static function (array $user, string $challengeId, string $ticketHash) use (
    &$solveCalls,
    $handoffUser,
    $handoffTicketHash,
    $ids,
): array {
    $solveCalls++;
    if ((string) $user['user_id'] !== (string) $handoffUser['user_id']
        || $challengeId !== $ids[0]
        || !hash_equals($handoffTicketHash, $ticketHash)) {
        throw new RuntimeException('Unexpected solve recorder payload.');
    }
    return ['solves' => [$challengeId]];
};
$firstHandoff = CampaignService::completeAndDispatch($handoffUser, $handoffTicket, $solveRecorder);
$secondHandoff = CampaignService::completeAndDispatch($handoffUser, $handoffTicket, $solveRecorder);
$assert(($firstHandoff['claim']['already_claimed'] ?? true) === false, 'first completion handoff claims ticket');
$assert(($secondHandoff['claim']['already_claimed'] ?? false) === true, 'replayed completion handoff is idempotent');
$assert($solveCalls === 1, 'replayed completion handoff records solve exactly once');
$assert((string) ($firstHandoff['next_mission']['id'] ?? '') === $ids[1], 'completion selects the immediate next mission');
$assert((string) ($firstHandoff['dispatch']['status'] ?? '') === 'preview', 'completion automatically dispatches the next mission');
$assert(
    (string) ($firstHandoff['dispatch']['id'] ?? '') === (string) ($secondHandoff['dispatch']['id'] ?? ''),
    'replayed completion reuses the next mission dispatch'
);
$handoffDispatchCount = wargame_db()->prepare(
    'SELECT COUNT(*) FROM mission_dispatches WHERE owner_key_hash = :owner AND mission_id = :mission'
);
$handoffDispatchCount->execute(['owner' => $handoffOwner, 'mission' => $ids[1]]);
$assert((int) $handoffDispatchCount->fetchColumn() === 1, 'next mission email has exactly one dispatch reservation');
$claimEventCount = wargame_db()->prepare(
    "SELECT COUNT(*) FROM lab_events WHERE instance_id = :instance AND event_name = 'completion_claimed'"
);
$claimEventCount->execute(['instance' => $handoffInstance]);
$assert((int) $claimEventCount->fetchColumn() === 1, 'completion claim event is recorded exactly once');
$consumedTicket = wargame_db()->prepare('SELECT consumed_at FROM completion_tickets WHERE ticket_hash = :ticket');
$consumedTicket->execute(['ticket' => $handoffTicketHash]);
$assert((int) $consumedTicket->fetchColumn() > 0, 'completion ticket is atomically finalized');

$legacyLabSource = (string) file_get_contents(__DIR__ . '/../public/lab.php');
$targetControllerSource = (string) file_get_contents(__DIR__ . '/../public/target.php');
$targetBootstrapSource = (string) file_get_contents(__DIR__ . '/../app/target_bootstrap.php');
$targetRendererSource = (string) file_get_contents(__DIR__ . '/../app/TargetSiteRenderer.php');
$labScript = (string) file_get_contents(__DIR__ . '/../public/assets/lab.js');
$portalSource = (string) file_get_contents(__DIR__ . '/../public/index.php');

$assert(
    str_contains($legacyLabSource, "header('Location: /', true, 303);")
        && !str_contains($legacyLabSource, 'request_json'),
    'legacy lab endpoint is a redirect-only compatibility route'
);
$assert(
    str_contains($targetControllerSource, 'target_http_request($slug)')
        && str_contains($targetControllerSource, 'LabSessionService::handleTargetRequest($context, $request)')
        && str_contains($targetControllerSource, 'TargetSiteRenderer::render($missionId, $response)'),
    'target controller handles native HTTP requests and renders the service directly'
);
$assert(
    str_contains($targetBootstrapSource, "'query' => \$_GET")
        && str_contains($targetBootstrapSource, '$body = $_POST;')
        && str_contains($targetBootstrapSource, "'files' => target_uploaded_files()")
        && str_contains($targetBootstrapSource, "\$_SERVER['HTTP_AUTHORIZATION']"),
    'target adapter exposes real query, form, multipart, and Authorization inputs'
);
$assert(
    str_contains($targetControllerSource, 'target_dispatch_completion($context, $response)')
        && str_contains($targetBootstrapSource, 'CampaignService::completeAndDispatch($user, $ticket)'),
    'completed targets dispatch the next mission server-side without a visible handoff panel'
);
$assert(
    str_contains($portalSource, 'LabSessionService::launchFor($user, $missionId);')
        && str_contains($portalSource, 'redirect_to(LabSessionService::targetEntryPath($missionId));')
        && str_contains($portalSource, 'name="action" value="launch_lab"')
        && str_contains($portalSource, 'data-email-target-launch')
        && str_contains($portalSource, '타깃 사이트 접속'),
    'portal launch CTA provisions a target and redirects to its live service path'
);

foreach ($missions as $missionId => $mission) {
    $entryUrl = (string) ($mission['target']['entry_url'] ?? '');
    $slug = trim((string) parse_url($entryUrl, PHP_URL_PATH), '/');
    $slug = explode('/', $slug, 2)[0] ?? '';
    $assert($entryUrl !== '' && str_contains($targetRendererSource, $entryUrl), "{$missionId} renderer links its live entry route");
    $assert(
        LabSessionService::missionForTargetSlug($slug) === $missionId,
        "{$missionId} live route slug resolves back to the mission"
    );
}

$assert(
    str_contains($targetRendererSource, 'method="get"')
        && str_contains($targetRendererSource, 'method="post"')
        && str_contains($targetRendererSource, 'enctype="multipart/form-data"'),
    'target services use native GET, POST, and multipart forms'
);
foreach ([
    'request_json',
    'target-shell',
    'simulated-browser',
    'data-nightfall-command-form',
    'RELAYOPS SOC TERMINAL',
    'window.nightfall_command_to_request',
    'data-completion-handoff',
    'target-completion',
] as $legacyToolMarker) {
    $productionTargetSource = $targetControllerSource . $targetRendererSource . $labScript;
    $assert(!str_contains($productionTargetSource, $legacyToolMarker), 'production target excludes legacy tool marker ' . $legacyToolMarker);
}

$previousForwardedProto = $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? null;
putenv('WARGAME_TRUST_PROXY=1');
$_SERVER['HTTP_X_FORWARDED_PROTO'] = 'https';
$httpsProbe = new ReflectionMethod(LabSessionService::class, 'requestIsHttps');
$assert($httpsProbe->invoke(null) === true, 'target cookies honor trusted reverse-proxy HTTPS');
if ($previousForwardedProto === null) {
    unset($_SERVER['HTTP_X_FORWARDED_PROTO']);
} else {
    $_SERVER['HTTP_X_FORWARDED_PROTO'] = $previousForwardedProto;
}
putenv('WARGAME_TRUST_PROXY');

wargame_db()->prepare('DELETE FROM lab_instances WHERE id = :id')->execute(['id' => $handoffInstance]);
wargame_db()->prepare('DELETE FROM mission_dispatches WHERE owner_key_hash = :owner')->execute(['owner' => $handoffOwner]);

$sessionFile = WARGAME_SESSION_DIR . '/sess_' . session_id();
session_write_close();
@unlink($sessionFile);

echo "Portal services: {$assertions} assertions passed\n";
