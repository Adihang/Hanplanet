<?php
declare(strict_types=1);

require __DIR__ . '/../app/labs/LabEngine.php';

$assertions = 0;

function check(bool $condition, string $message): void
{
    global $assertions;
    $assertions++;
    if (!$condition) {
        throw new RuntimeException('Assertion failed: ' . $message);
    }
}

/** @return array<string, mixed> */
function request_data(
    string $method,
    string $path,
    array $query = [],
    array $headers = [],
    array $body = [],
    array $files = []
): array {
    return compact('method', 'path', 'query', 'headers', 'body', 'files');
}

function b64url(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

/** @return array<string, mixed> */
function decode_json_segment(string $segment): array
{
    $padding = (4 - strlen($segment) % 4) % 4;
    $decoded = base64_decode(strtr($segment, '-_', '+/') . str_repeat('=', $padding), true);
    check(is_string($decoded), 'base64url segment decodes');
    $value = json_decode($decoded, true, 32, JSON_THROW_ON_ERROR);
    check(is_array($value), 'decoded segment is a JSON object');
    return $value;
}

/** @param array<string, mixed> $header @param array<string, mixed> $payload */
function unsigned_jwt(array $header, array $payload): string
{
    return b64url(json_encode($header, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)) . '.'
        . b64url(json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)) . '.';
}

/** @return array<string, mixed> */
function state_file(string $root, string $labId): array
{
    $raw = file_get_contents($root . '/' . $labId . '/state.json');
    check(is_string($raw), 'state file exists for ' . $labId);
    $state = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    check(is_array($state), 'state file is JSON for ' . $labId);
    return $state;
}

function remove_tree(string $path): void
{
    if (is_link($path) || is_file($path)) {
        @unlink($path);
        return;
    }
    if (!is_dir($path)) {
        return;
    }
    foreach (scandir($path) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') {
            continue;
        }
        remove_tree($path . DIRECTORY_SEPARATOR . $entry);
    }
    @rmdir($path);
}

/** @param array<string, string> $expectedProfile */
function assert_response_shape(array $response, string $labId, array $expectedProfile): void
{
    foreach (['mission_id', 'lab_id', 'lab_type', 'surface', 'title', 'target', 'output', 'request', 'status', 'headers', 'completed', 'event', 'hints'] as $field) {
        check(array_key_exists($field, $response), "{$labId} response has {$field}");
    }
    check($response['mission_id'] === $labId && $response['lab_id'] === $labId, "{$labId} keeps stable mission id");
    check(in_array($response['surface'], ['browser', 'terminal', 'network'], true), "{$labId} has a supported surface");
    check(is_int($response['status']), "{$labId} status is HTTP-like integer");
    check(is_array($response['headers']), "{$labId} headers are structured");
    check(is_array($response['event']) && is_string($response['event']['type'] ?? null), "{$labId} event is structured");
    check(is_array($response['hints']) && count($response['hints']) >= 2, "{$labId} has progressive hints");
    check(is_array($response['target']), "{$labId} target metadata is structured");
    check(($response['target']['product'] ?? null) === $expectedProfile['product'], "{$labId} target product is canonical");
    check(($response['target']['host'] ?? null) === $expectedProfile['host'], "{$labId} target host is canonical");
    check(($response['target']['entry_path'] ?? null) === $expectedProfile['entry_path'], "{$labId} target path is canonical");
    check(($response['target']['entry_url'] ?? null) === 'https://' . $expectedProfile['host'] . $expectedProfile['entry_path'], "{$labId} target URL is canonical");
    check(is_array($response['output']['service'] ?? null), "{$labId} output has a service model");
    check(($response['output']['service']['name'] ?? null) === $expectedProfile['product'], "{$labId} service name matches target");
    check(($response['output']['service']['hostname'] ?? null) === $expectedProfile['host'], "{$labId} service hostname matches target");
    check(is_array($response['output']['page'] ?? null), "{$labId} output has a renderable page model");
    json_encode($response, JSON_THROW_ON_ERROR);
}

$base = sys_get_temp_dir() . '/wargame-labs-test-' . bin2hex(random_bytes(8));
$rootA = $base . '/instance-a';
$rootB = $base . '/instance-b';
if (!mkdir($rootA, 0700, true) || !mkdir($rootB, 0700, true)) {
    throw new RuntimeException('Unable to create test instance roots.');
}

try {
    $engine = new LabEngine($rootA);
    $expectedProfiles = [
        LabEngine::HTTP_HEADERS => ['product' => 'Aurora SmartCoupon', 'host' => 'coupon.aurora-stationery.training', 'entry_path' => '/discount/check'],
        LabEngine::CLIENT_TRUST => ['product' => 'LeafPeer Review', 'host' => 'review.leaf-center.training', 'entry_path' => '/inbox'],
        LabEngine::IDOR => ['product' => 'Nova Vault', 'host' => 'docs.nova-office.training', 'entry_path' => '/documents'],
        LabEngine::SQLI_LOGIN => ['product' => 'Comet StockFlow', 'host' => 'night.comet-logistics.training', 'entry_path' => '/login'],
        LabEngine::SQLI_UNION => ['product' => 'Helios Supply Catalog', 'host' => 'catalog.helios-supply.training', 'entry_path' => '/products'],
        LabEngine::REFLECTED_XSS => ['product' => 'PrismCare Help Desk', 'host' => 'help.prismcare.training', 'entry_path' => '/search'],
        LabEngine::PATH_TRAVERSAL => ['product' => 'Atlas Field Manual', 'host' => 'manuals.atlas-field.training', 'entry_path' => '/viewer'],
        LabEngine::UPLOAD_VALIDATION => ['product' => 'PixelPet Profile', 'host' => 'profile.pixelpet.training', 'entry_path' => '/avatar'],
        LabEngine::JWT_VALIDATION => ['product' => 'Vector Deploy Gate', 'host' => 'deploy.vector-cloud.training', 'entry_path' => '/approvals'],
        LabEngine::SSRF => ['product' => 'Lumen Campaign Preview', 'host' => 'preview.lumen-studio.training', 'entry_path' => '/cards'],
        LabEngine::OPERATION_NIGHTFALL => ['product' => 'Nightfall RelayOps', 'host' => 'ops.nightfall-grid.training', 'entry_path' => '/reports'],
    ];
    check(LabEngine::stableIds() === array_keys($expectedProfiles), 'all 11 stable ids are exact and ordered');
    $labDefinitions = $engine->listLabs();
    check(($labDefinitions[LabEngine::OPERATION_NIGHTFALL]['surface'] ?? null) === 'browser', 'Nightfall declares its primary surface as the RelayOps web portal');
    $profiles = LabEngine::targetProfiles();
    check(array_keys($profiles) === array_keys($expectedProfiles), 'all 11 target profiles are exact and ordered');
    foreach ($expectedProfiles as $id => $expected) {
        check(($profiles[$id]['product'] ?? null) === $expected['product'], "{$id} profile product is canonical");
        check(($profiles[$id]['host'] ?? null) === $expected['host'], "{$id} profile host is canonical");
        check(($profiles[$id]['entry_path'] ?? null) === $expected['entry_path'], "{$id} profile path is canonical");
        $start = $engine->start($id);
        assert_response_shape($start, $id, $expected);
        check(($start['request']['path'] ?? null) === $expected['entry_path'], "{$id} initial request opens the real target entry path");
        if ($id === LabEngine::OPERATION_NIGHTFALL) {
            check($start['surface'] === 'browser', 'Nightfall start view is the RelayOps reports portal');
            check(!isset($start['output']['terminal']), 'Nightfall start view contains no built-in terminal or command cheat sheet');
        }
        assert_response_shape($engine->serialize($id), $id, $expected);
    }

    $allStarts = json_encode(array_map(fn (string $id): array => $engine->start($id), array_keys($expectedProfiles)), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    foreach (['client-gateway', '/api/invoices', 'vault_notes', 'assets.vendor.test', 'metadata.internal', '/operator/shutdown'] as $obsolete) {
        check(!str_contains($allStarts, $obsolete), "start views do not contain obsolete generic contract {$obsolete}");
    }

    // 01 Aurora: load the actual discount page, inspect its service route header, then replay as the store client.
    $id = LabEngine::HTTP_HEADERS;
    $missing = $engine->handle($id, request_data('GET', '/discount/reconciliation', ['batch' => 'guess']));
    check(!$missing['completed'] && $missing['status'] === 403, 'Aurora rejects a guessed reconciliation batch');
    $discount = $engine->handle($id, request_data('GET', '/discount/check'));
    check(!$discount['completed'] && $discount['event']['type'] === 'headers_observed', 'Aurora discount page is a normal exploratory request');
    check(isset($discount['headers']['X-Aurora-Route']), 'Aurora exposes its canonical service route clue as a real response header');
    check(!isset($discount['headers']['X-Operations-Path'], $discount['headers']['X-Case-Token']), 'Aurora removes obsolete generic headers');
    check(count((array) ($discount['output']['records'] ?? [])) === 2, 'Aurora renders believable discounted products');
    $next = parse_url((string) $discount['headers']['X-Aurora-Route']);
    check(is_array($next) && ($next['path'] ?? null) === '/discount/reconciliation', 'Aurora reconciliation path comes from the response header');
    parse_str((string) ($next['query'] ?? ''), $nextQuery);
    $withoutHeader = $engine->handle($id, request_data('GET', '/discount/reconciliation', $nextQuery));
    check(!$withoutHeader['completed'] && $withoutHeader['status'] === 403, 'Aurora reconciliation route requires the store channel header');
    $positive = $engine->handle($id, request_data('GET', '/discount/reconciliation', $nextQuery, ['X-Store-Channel' => 'operations']));
    check($positive['completed'] && $positive['event']['type'] === 'http_diagnostic_reached', 'Aurora header workflow completes');
    check(($positive['output']['reconciliation']['store'] ?? null) === '성수점', 'Aurora completion evidence belongs to the commissioned store');

    // 02 LeafPeer: visit the inbox, decode its leaf_role cookie, retain nonce, and elevate only to reviewer.
    $id = LabEngine::CLIENT_TRUST;
    $inbox = $engine->handle($id, request_data('GET', '/inbox'));
    $viewerToken = (string) $inbox['output']['client_token'];
    check(str_contains((string) ($inbox['headers']['Set-Cookie'] ?? ''), 'leaf_role='), 'LeafPeer sets the fictional role cookie');
    $denied = $engine->handle($id, request_data('GET', '/inbox/archive', [], ['Cookie' => 'leaf_role=' . $viewerToken]));
    check(!$denied['completed'] && $denied['status'] === 403 && $denied['output']['role'] === 'reader', 'LeafPeer reader cannot open reviewer archive');
    $invalid = $engine->handle($id, request_data('GET', '/inbox/archive', [], ['Cookie' => 'leaf_role=not-json']));
    check(!$invalid['completed'] && $invalid['status'] === 400, 'LeafPeer rejects malformed cookie tokens');
    $payload = decode_json_segment($viewerToken);
    $payload['role'] = 'reviewer';
    $reviewerToken = b64url(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    $positive = $engine->handle($id, request_data('GET', '/inbox/archive', [], ['Cookie' => 'leaf_role=' . $reviewerToken]));
    check($positive['completed'] && $positive['event']['type'] === 'review_archive_opened', 'LeafPeer reviewer cookie completes');
    check(count((array) ($positive['output']['records'] ?? [])) >= 2, 'LeafPeer archive contains realistic review records');

    // 03 Nova: actual instance SQLite document data, not the old invoice fiction.
    $id = LabEngine::IDOR;
    $start = $engine->start($id);
    $invalid = $engine->handle($id, request_data('GET', '/documents', ['id' => 'not-a-number']));
    check(!$invalid['completed'] && $invalid['status'] === 400, 'Nova requires a numeric document id');
    $own = $engine->handle($id, request_data('GET', '/documents', ['id' => (string) $start['output']['my_document_id']]));
    check(!$own['completed'] && ($own['output']['document']['category'] ?? null) === '외부 공유', 'Nova own document is normal exploration');
    $missing = $engine->handle($id, request_data('GET', '/documents', ['id' => '9999999999']));
    check(!$missing['completed'] && $missing['status'] === 404, 'Nova missing document follows a believable 404 path');
    $targetDocument = (string) $start['output']['activity_feed']['recently_unshared_document'];
    $positive = $engine->handle($id, request_data('GET', '/documents', ['id' => $targetDocument]));
    check($positive['completed'] && $positive['event']['type'] === 'foreign_document_viewed', 'Nova foreign document completes IDOR mission');
    check(($positive['output']['document']['title'] ?? null) === '미래바이오 NDA 갱신 검토안', 'Nova leaked record matches the mission story');
    check(is_file($rootA . '/' . $id . '/lab.sqlite3'), 'Nova document database stays inside the instance');

    // 04 Comet: observe normal login failure and SQLite syntax error before authenticating as inventory manager.
    $id = LabEngine::SQLI_LOGIN;
    $landing = $engine->handle($id, request_data('GET', '/login'));
    check(!$landing['completed'] && $landing['status'] === 200, 'Comet serves an ordinary login page over GET');
    $negative = $engine->handle($id, request_data('POST', '/login', [], [], ['username' => 'manager', 'password' => 'wrong']));
    check(!$negative['completed'] && $negative['status'] === 401, 'Comet rejects an ordinary bad password');
    $syntax = $engine->handle($id, request_data('POST', '/login', [], [], ['username' => "'", 'password' => 'x']));
    check(!$syntax['completed'] && $syntax['status'] === 400 && isset($syntax['output']['database_error']), 'Comet exposes the intended SQLite boundary error');
    $positive = $engine->handle($id, request_data('POST', '/login', [], [], [
        'username' => "manager' OR '1'='1' -- ",
        'password' => 'irrelevant',
    ]));
    check($positive['completed'] && $positive['event']['type'] === 'manager_session_started', 'Comet SQL injection opens manager session');
    check(($positive['output']['role'] ?? null) === 'inventory_manager', 'Comet completion lands in the real stock manager role');
    check(count((array) ($positive['output']['records'] ?? [])) === 3, 'Comet dashboard contains warehouse zone data');

    // 05 Helios: the rendered catalog has exactly two columns and UNIONs training_notes into them.
    $id = LabEngine::SQLI_UNION;
    $normal = $engine->handle($id, request_data('GET', '/products', ['q' => '커터']));
    check(!$normal['completed'] && $normal['output']['row_count'] === 1, 'Helios normal product search remains incomplete');
    check(array_keys((array) $normal['output']['rows'][0]) === ['name', 'price'], 'Helios visible query really returns two columns');
    $columnError = $engine->handle($id, request_data('GET', '/products', ['q' => "%' UNION SELECT 1,2,3 -- "]));
    check(!$columnError['completed'] && $columnError['status'] === 400 && $columnError['output']['visible_columns'] === 2, 'Helios reports a two-column UNION mismatch');
    $unionPayload = "%' UNION SELECT note_title, note_body FROM training_notes -- ";
    $positive = $engine->handle($id, request_data('GET', '/products', ['q' => $unionPayload]));
    check($positive['completed'] && $positive['event']['type'] === 'training_note_extracted', 'Helios training note extraction completes');
    check(str_contains((string) ($positive['output']['rows'][0]['name'] ?? ''), '[OPS]'), 'Helios extracted row looks like an operations note');

    // 06 PrismCare: plain reflection is incomplete; an actual HTML event handler completes.
    $id = LabEngine::REFLECTED_XSS;
    $normal = $engine->handle($id, request_data('GET', '/search', ['q' => '센서 초기화']));
    check(!$normal['completed'] && $normal['event']['type'] === 'fragment_rendered', 'PrismCare ordinary search is safe exploration');
    $textOnly = $engine->handle($id, request_data('GET', '/search', ['q' => 'onerror 사용법']));
    check(!$textOnly['completed'], 'PrismCare does not complete on event-handler text alone');
    $positive = $engine->handle($id, request_data('GET', '/search', ['q' => '<img src=x onerror="document.body.dataset.probe=\'verified\'">']));
    check($positive['completed'] && $positive['event']['type'] === 'sandbox_script_executed', 'PrismCare reflected event handler completes');
    check(str_contains((string) $positive['output']['execution_model'], 'opaque-origin'), 'PrismCare execution remains opaque-origin sandboxed');
    check(str_contains((string) $positive['output']['execution_model'], 'no portal origin'), 'PrismCare explicitly excludes portal-origin access');

    // 07 Atlas: public manual browsing, missing path, instance escape block, then sibling private proof.
    $id = LabEngine::PATH_TRAVERSAL;
    $normal = $engine->handle($id, request_data('GET', '/viewer', ['file' => 'notice.txt']));
    check(!$normal['completed'] && $normal['event']['type'] === 'public_file_read', 'Atlas public migration notice is normal exploration');
    check(str_contains((string) $normal['output']['content'], 'ATLAS FIELD SERVICE'), 'Atlas notice belongs to the field service client');
    $missing = $engine->handle($id, request_data('GET', '/viewer', ['file' => 'missing.md']));
    check(!$missing['completed'] && $missing['status'] === 404, 'Atlas missing manual follows 404 path');
    $outsideCanary = $base . '/outside-secret.txt';
    file_put_contents($outsideCanary, 'HOST_CANARY_' . bin2hex(random_bytes(8)));
    $blocked = $engine->handle($id, request_data('GET', '/viewer', ['file' => '../../../../outside-secret.txt']));
    check(!$blocked['completed'] && $blocked['status'] === 403, 'Atlas cannot leave instance VFS');
    check(!str_contains(json_encode($blocked, JSON_THROW_ON_ERROR), 'HOST_CANARY_'), 'Atlas never discloses host canary');
    check(preg_match('#\.\./private/([^\s]+)#', (string) $normal['output']['content'], $fileMatch) === 1, 'Atlas notice discloses only the intended relative proof path');
    $positive = $engine->handle($id, request_data('GET', '/viewer', ['file' => '../private/' . $fileMatch[1]]));
    check($positive['completed'] && $positive['event']['type'] === 'private_proof_read', 'Atlas sibling private traversal completes');
    check(str_contains((string) $positive['output']['content'], 'ATLAS SAFETY AUDIT'), 'Atlas completion evidence matches safety audit story');

    // 08 PixelPet: wrong method/MIME, benign upload, dangerous file without marker, then exact commissioned mismatch.
    $id = LabEngine::UPLOAD_VALIDATION;
    $landing = $engine->handle($id, request_data('GET', '/avatar'));
    check(!$landing['completed'] && $landing['status'] === 200, 'PixelPet serves an ordinary avatar settings page over GET');
    $wrongMime = $engine->handle($id, request_data('POST', '/avatar', [], [], [], ['file' => [
        'name' => 'bori.txt', 'type' => 'text/plain', 'content' => 'hello',
    ]]));
    check(!$wrongMime['completed'] && $wrongMime['status'] === 415, 'PixelPet rejects non-image claimed MIME');
    $benign = $engine->handle($id, request_data('POST', '/avatar', [], [], [], ['file' => [
        'name' => 'bori.png', 'type' => 'image/png', 'content' => 'virtual-png',
    ]]));
    check(!$benign['completed'] && $benign['output']['stored'] === true && $benign['output']['executable'] === false, 'PixelPet benign avatar stores privately without completion');
    $noMarker = $engine->handle($id, request_data('POST', '/avatar', [], [], [], ['file' => [
        'name' => 'training.php', 'type' => 'image/png', 'content' => '<?php /* no marker */',
    ]]));
    check(!$noMarker['completed'] && $noMarker['output']['training_marker'] === false, 'PixelPet requires the commissioned training marker as evidence');
    $positive = $engine->handle($id, request_data('POST', '/avatar', [], [], [], ['file' => [
        'name' => 'training.php', 'type' => 'image/png', 'content' => 'LAB_UPLOAD_MARKER',
    ]]));
    check($positive['completed'] && $positive['event']['type'] === 'dangerous_upload_accepted', 'PixelPet MIME-only validator bypass completes');
    check($positive['output']['public_url'] === null && $positive['output']['executable'] === false, 'PixelPet training payload is never public or executable');
    check(is_dir($rootA . '/' . $id . '/private_uploads'), 'PixelPet files stay in instance private storage');

    // 09 Vector: signed viewer and wrong-scope none token fail; same-instance aud/scope/nonce admin token succeeds.
    $id = LabEngine::JWT_VALIDATION;
    $start = $engine->start($id);
    $malformed = $engine->handle($id, request_data('POST', '/approvals', [], ['Authorization' => 'Bearer broken']));
    check(!$malformed['completed'] && $malformed['status'] === 400, 'Vector rejects malformed JWT');
    $viewerJwt = (string) $start['output']['viewer_token'];
    $viewer = $engine->handle($id, request_data('POST', '/approvals', [], ['Authorization' => 'Bearer ' . $viewerJwt]));
    check(!$viewer['completed'] && $viewer['status'] === 403, 'Vector signed viewer JWT cannot approve production');
    [$headSegment, $payloadSegment] = array_slice(explode('.', $viewerJwt), 0, 2);
    $header = decode_json_segment($headSegment);
    $payload = decode_json_segment($payloadSegment);
    $header['alg'] = 'none';
    $payload['role'] = 'admin';
    $wrongPayload = $payload;
    $wrongPayload['scope'] = 'other:release';
    $wrongScope = $engine->handle($id, request_data('POST', '/approvals', [], ['Authorization' => 'Bearer ' . unsigned_jwt($header, $wrongPayload)]));
    check(!$wrongScope['completed'] && $wrongScope['status'] === 403, 'Vector preserves the instance release scope boundary');
    $noneJwt = unsigned_jwt($header, $payload);
    $positive = $engine->handle($id, request_data('POST', '/approvals', [], ['Authorization' => 'Bearer ' . $noneJwt]));
    check($positive['completed'] && $positive['event']['type'] === 'admin_token_accepted', 'Vector alg:none admin token completes');
    check(($positive['output']['release']['name'] ?? null) === 'vector-api-2026.07.15-rc3', 'Vector evidence references the commissioned release');

    // 10 Lumen: normal public card reveals an asset-manifest clue; direct server-side fetch retrieves it.
    $id = LabEngine::SSRF;
    $landing = $engine->handle($id, request_data('GET', '/cards'));
    check(!$landing['completed'] && $landing['status'] === 200, 'Lumen serves an ordinary campaign card workspace over GET');
    $invalid = $engine->handle($id, request_data('POST', '/cards', [], [], ['url' => 'not a url']));
    check(!$invalid['completed'] && $invalid['status'] === 400, 'Lumen URL parser rejects malformed input');
    $unknown = $engine->handle($id, request_data('POST', '/cards', [], [], ['url' => 'https://unknown.training/a.png']));
    check(!$unknown['completed'] && $unknown['status'] === 404, 'Lumen virtual dispatcher has no arbitrary network route');
    $normal = $engine->handle($id, request_data('POST', '/cards', [], [], ['url' => 'https://images.training/campaign/summer-card.png']));
    check(!$normal['completed'] && $normal['event']['type'] === 'virtual_fetch_completed', 'Lumen public campaign card is normal exploration');
    check(
        ($normal['output']['response']['asset_manifest']['health_reference'] ?? null) === 'http://metadata.training/latest/lab-proof',
        'Lumen public asset manifest exposes the story-aligned internal canary clue'
    );
    check(($normal['output']['trace'][0]['requester'] ?? null) === 'preview-worker.lumen.internal', 'Lumen trace makes the server-side requester explicit');
    $positive = $engine->handle($id, request_data('POST', '/cards', [], [], ['url' => 'http://metadata.training/latest/lab-proof']));
    check($positive['completed'] && $positive['event']['type'] === 'metadata_proof_fetched', 'Lumen direct virtual metadata SSRF completes');
    check(count($positive['output']['trace']) === 1 && ($positive['output']['trace'][0]['network_zone'] ?? null) === 'internal', 'Lumen evidence shows the internal virtual hop');

    // 11 Nightfall: report IDOR -> verifier traversal -> admin token verification -> vault opening.
    $id = LabEngine::OPERATION_NIGHTFALL;
    $start = $engine->start($id);
    $early = $engine->handle($id, request_data('POST', '/reports/vault', [], ['Authorization' => 'Bearer bad']));
    check(!$early['completed'] && $early['status'] === 409, 'Nightfall cannot skip report stage');
    $own = $engine->handle($id, request_data('GET', '/reports', ['id' => (string) $start['output']['my_report_id']]));
    check(!$own['completed'] && $own['event']['type'] === 'nightfall_own_report', 'Nightfall own K-04 report is normal exploration');
    $foreign = $engine->handle($id, request_data('GET', '/reports', ['id' => (string) $start['output']['audit_reference']]));
    check(!$foreign['completed'] && $foreign['event']['type'] === 'nightfall_idor_complete', 'Nightfall foreign N-17 report advances IDOR stage');
    check($foreign['surface'] === 'browser', 'Nightfall report opens in the web portal');
    check(($foreign['output']['report']['station'] ?? null) === 'Relay N-17', 'Nightfall leaked report matches the commissioned relay');
    $configPath = (string) $foreign['output']['report']['verifier_config'];
    $missing = $engine->handle($id, request_data('GET', '/reports/file', ['file' => '../private/missing.json']));
    check(!$missing['completed'] && $missing['status'] === 404, 'Nightfall verifier viewer has a realistic missing-file path');
    $config = $engine->handle($id, request_data('GET', '/reports/file', ['file' => $configPath]));
    check(!$config['completed'] && $config['event']['type'] === 'nightfall_traversal_complete', 'Nightfall verifier config advances traversal stage');
    check($config['surface'] === 'browser', 'Nightfall attachment opens in the web portal');
    check(($config['output']['config']['allow_none'] ?? null) === true, 'Nightfall config contains the exact next-stage clue');
    $viewerJwt = (string) $config['output']['viewer_token'];
    [$headSegment, $payloadSegment] = array_slice(explode('.', $viewerJwt), 0, 2);
    $header = decode_json_segment($headSegment);
    $payload = decode_json_segment($payloadSegment);
    $header['alg'] = 'none';
    $payload['role'] = 'viewer';
    $viewerNone = unsigned_jwt($header, $payload);
    $rejected = $engine->handle($id, request_data('POST', '/reports/token', [], ['Authorization' => 'Bearer ' . $viewerNone]));
    check(!$rejected['completed'] && $rejected['status'] === 403, 'Nightfall verifier rejects a non-admin token');
    $payload['role'] = 'admin';
    $adminToken = unsigned_jwt($header, $payload);
    $approved = $engine->handle($id, request_data('POST', '/reports/token', [], ['Authorization' => 'Bearer ' . $adminToken]));
    check(!$approved['completed'] && $approved['event']['type'] === 'nightfall_admin_token_accepted', 'Nightfall admin token advances without prematurely completing');
    check($approved['surface'] === 'browser', 'Nightfall token approval returns a web response');
    $wrongVault = $engine->handle($id, request_data('POST', '/reports/vault', [], ['Authorization' => 'Bearer ' . $viewerNone]));
    check(!$wrongVault['completed'] && $wrongVault['status'] === 403, 'Nightfall vault requires the same approved token');
    $positive = $engine->handle($id, request_data('POST', '/reports/vault', [], ['Authorization' => 'Bearer ' . $adminToken]));
    check($positive['completed'] && $positive['event']['type'] === 'nightfall_vault_opened', 'Nightfall ordered chain opens evidence vault');
    check($positive['surface'] === 'browser', 'Nightfall evidence vault completes on the web surface');
    check(($positive['output']['vault_status'] ?? null) === 'open' && count((array) ($positive['output']['evidence'] ?? [])) === 2, 'Nightfall completion returns realistic vault evidence');

    // Completed labs are immutable until reset.
    $afterComplete = $engine->handle(LabEngine::HTTP_HEADERS, request_data('GET', '/discount/check'));
    check($afterComplete['completed'] && $afterComplete['event']['type'] === 'already_completed', 'completed mission cannot mutate without reset');

    // Reset creates fresh random secrets and a clean state.
    $beforeReset = state_file($rootA, LabEngine::HTTP_HEADERS);
    $reset = $engine->reset(LabEngine::HTTP_HEADERS);
    $afterReset = state_file($rootA, LabEngine::HTTP_HEADERS);
    check(!$reset['completed'] && $reset['event']['type'] === 'reset', 'reset returns a fresh incomplete view');
    check($beforeReset['completion_proof'] !== $afterReset['completion_proof'], 'reset rotates random completion proof');
    check($beforeReset['secrets']['diagnostic_view'] !== $afterReset['secrets']['diagnostic_view'], 'reset rotates Aurora diagnostic view');

    // Version-1 state is safely rebuilt instead of crashing after the narrative/data migration.
    $legacyRoot = $base . '/legacy-instance';
    $legacyLab = $legacyRoot . '/' . LabEngine::HTTP_HEADERS;
    check(mkdir($legacyLab, 0700, true), 'legacy test directory created');
    file_put_contents($legacyLab . '/state.json', json_encode([
        'version' => 1,
        'lab_id' => LabEngine::HTTP_HEADERS,
        'secrets' => ['case_token' => 'obsolete'],
        'progress' => ['headers_observed' => false],
    ], JSON_THROW_ON_ERROR));
    file_put_contents($legacyLab . '/obsolete.txt', 'old runtime artifact');
    $legacyEngine = new LabEngine($legacyRoot);
    $legacyStart = $legacyEngine->start(LabEngine::HTTP_HEADERS);
    $legacyState = state_file($legacyRoot, LabEngine::HTTP_HEADERS);
    check(($legacyState['version'] ?? null) === 3, 'legacy state migrates by clean instance rebuild');
    check(!is_file($legacyLab . '/obsolete.txt'), 'version migration removes obsolete challenge artifacts');
    check(($legacyStart['request']['path'] ?? null) === '/discount/check', 'migrated instance uses canonical Aurora path');

    // Instance isolation: no deterministic target/secret reuse and no cross-instance artifact access.
    $engineB = new LabEngine($rootB);
    $engine->reset(LabEngine::PATH_TRAVERSAL);
    $engineB->start(LabEngine::PATH_TRAVERSAL);
    $stateA = state_file($rootA, LabEngine::PATH_TRAVERSAL);
    $stateB = state_file($rootB, LabEngine::PATH_TRAVERSAL);
    check($stateA['completion_proof'] !== $stateB['completion_proof'], 'completion proof differs between instances');
    check($stateA['secrets']['private_file'] !== $stateB['secrets']['private_file'], 'private filename differs between instances');
    $cross = $engineB->handle(LabEngine::PATH_TRAVERSAL, request_data('GET', '/viewer', [
        'file' => '../private/' . $stateA['secrets']['private_file'],
    ]));
    check(!$cross['completed'] && $cross['status'] === 404, 'instance B cannot read instance A private artifact');
    check(!file_exists($rootB . '/' . LabEngine::PATH_TRAVERSAL . '/vfs/private/' . $stateA['secrets']['private_file']), 'instance A artifact was never copied to B');

    // Static guard: the engine has no command runner or real outbound network primitive.
    $source = file_get_contents(__DIR__ . '/../app/labs/LabEngine.php');
    check(is_string($source), 'LabEngine source is readable for safety scan');
    $forbiddenCalls = [
        'exec', 'shell_exec', 'system', 'passthru', 'proc_open', 'popen',
        'curl_init', 'curl_exec', 'fsockopen', 'pfsockopen', 'stream_socket_client',
        'gethostbyname', 'gethostbynamel', 'dns_get_record',
    ];
    foreach ($forbiddenCalls as $function) {
        check(preg_match('/(?<![A-Za-z0-9_>])' . preg_quote($function, '/') . '\s*\(/i', $source) !== 1, "source does not call {$function}");
    }
    check(preg_match('/file_get_contents\s*\(\s*["\'](?:https?|ftp):/i', $source) !== 1, 'source does not read remote URLs');
    check(!str_contains($source, '`$') && !str_contains($source, '`./'), 'source contains no shell command interpolation');

    echo "LabEngine: {$assertions} assertions passed\n";
} finally {
    remove_tree($base);
}
