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

function assert_response_shape(array $response, string $labId): void
{
    foreach (['lab_id', 'lab_type', 'surface', 'title', 'output', 'request', 'status', 'headers', 'completed', 'event', 'hints'] as $field) {
        check(array_key_exists($field, $response), "{$labId} response has {$field}");
    }
    check($response['lab_id'] === $labId, "{$labId} response keeps stable id");
    check(in_array($response['surface'], ['browser', 'terminal', 'network'], true), "{$labId} has a supported surface");
    check(is_int($response['status']), "{$labId} status is HTTP-like integer");
    check(is_array($response['headers']), "{$labId} headers are structured");
    check(is_array($response['event']) && is_string($response['event']['type'] ?? null), "{$labId} event is structured");
    check(is_array($response['hints']), "{$labId} hints are structured");
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
    $expectedIds = [
        'web-v1-01-http',
        'web-v1-02-client-trust',
        'web-v1-03-idor',
        'web-v1-04-sqli-login',
        'web-v1-05-sqli-union',
        'web-v1-06-reflected-xss',
        'web-v1-07-path-traversal',
        'web-v1-08-upload-validation',
        'web-v1-09-jwt-validation',
        'web-v1-10-ssrf',
        'web-v1-11-operation-nightfall',
    ];
    check(LabEngine::stableIds() === $expectedIds, 'all 11 stable ids are exact and ordered');
    $expectedTypes = [
        'http_headers', 'role_token', 'idor_sqlite', 'sqli_login', 'union_sqlite', 'xss_nonce',
        'path_traversal', 'upload_mime', 'jwt_none', 'virtual_network', 'final_chain',
    ];
    check(array_column(array_values($engine->listLabs()), 'type') === $expectedTypes, 'all curriculum lab types are exact and ordered');

    foreach ($expectedIds as $id) {
        assert_response_shape($engine->start($id), $id);
        assert_response_shape($engine->serialize($id), $id);
    }

    // 01: response header observation, then replay the discovered path/token.
    $id = LabEngine::HTTP_HEADERS;
    $negative = $engine->handle($id, request_data('GET', '/operations/wrong', [], ['X-Case-Token' => 'wrong']));
    check(!$negative['completed'], 'HTTP lab rejects guessed route');
    $status = $engine->handle($id, request_data('GET', '/status'));
    check(isset($status['headers']['X-Operations-Path'], $status['headers']['X-Case-Token']), 'HTTP lab exposes clues as headers');
    $positive = $engine->handle($id, request_data(
        'GET',
        (string) $status['headers']['X-Operations-Path'],
        [],
        ['X-Case-Token' => (string) $status['headers']['X-Case-Token']]
    ));
    check($positive['completed'] && $positive['event']['type'] === 'http_diagnostic_reached', 'HTTP lab positive path completes');

    // 02: unsigned client role token.
    $id = LabEngine::CLIENT_TRUST;
    $start = $engine->start($id);
    $viewerToken = (string) $start['output']['client_token'];
    $negative = $engine->handle($id, request_data('GET', '/admin', [], ['Authorization' => 'Client ' . $viewerToken]));
    check(!$negative['completed'] && $negative['status'] === 403, 'client-trust lab rejects viewer role');
    $payload = decode_json_segment($viewerToken);
    $payload['role'] = 'admin';
    $adminToken = b64url(json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    $positive = $engine->handle($id, request_data('GET', '/admin', [], ['Authorization' => 'Client ' . $adminToken]));
    check($positive['completed'] && $positive['event']['type'] === 'review_archive_opened', 'client-trust token modification completes');

    // 03: actual instance-local SQLite IDOR.
    $id = LabEngine::IDOR;
    $start = $engine->start($id);
    $negative = $engine->handle($id, request_data('GET', '/api/invoices', ['id' => (string) $start['output']['my_invoice_id']]));
    check(!$negative['completed'] && $negative['output']['invoice']['owner'] === 'freelance-analyst', 'IDOR own object is not completion');
    $positive = $engine->handle($id, request_data('GET', '/api/invoices', ['id' => (string) $start['output']['activity_feed']['recently_shared_invoice']]));
    check($positive['completed'] && $positive['event']['type'] === 'foreign_document_viewed', 'IDOR foreign SQLite object completes');
    check(is_file($rootA . '/' . $id . '/lab.sqlite3'), 'IDOR database is inside instance');

    // 04: real vulnerable SQLite login string concatenation.
    $id = LabEngine::SQLI_LOGIN;
    $negative = $engine->handle($id, request_data('POST', '/login', [], [], ['username' => 'admin', 'password' => 'wrong']));
    check(!$negative['completed'] && $negative['status'] === 401, 'SQLi login rejects ordinary bad password');
    $positive = $engine->handle($id, request_data('POST', '/login', [], [], [
        'username' => "' OR '1'='1' -- ",
        'password' => 'irrelevant',
    ]));
    check($positive['completed'] && $positive['event']['type'] === 'manager_session_started', 'SQLite login injection completes');

    // 05: real UNION query against instance SQLite.
    $id = LabEngine::SQLI_UNION;
    $negative = $engine->handle($id, request_data('GET', '/search', ['q' => 'Keyboard']));
    check(!$negative['completed'] && $negative['output']['row_count'] >= 1, 'UNION lab normal search remains incomplete');
    $unionPayload = "%' UNION SELECT 'vault', secret, 0 FROM vault_notes -- ";
    $positive = $engine->handle($id, request_data('GET', '/search', ['q' => $unionPayload]));
    check($positive['completed'] && $positive['event']['type'] === 'training_note_extracted', 'UNION extraction completes');

    // 06: text-only render plus a nonce-gated virtual event.
    $id = LabEngine::REFLECTED_XSS;
    $start = $engine->start($id);
    $negative = $engine->handle($id, request_data('GET', '/search', ['q' => "<script nonce=wrong>lab.report('complete')</script>"]));
    check(!$negative['completed'] && $negative['output']['virtual_console']['event'] === 'csp_nonce_blocked', 'XSS wrong nonce is blocked');
    check(preg_match("/nonce-([a-f0-9]+)/", (string) $start['headers']['Content-Security-Policy'], $nonceMatch) === 1, 'XSS nonce is observable in CSP');
    $xss = "<script nonce=\"{$nonceMatch[1]}\">lab.report('complete')</script>";
    $positive = $engine->handle($id, request_data('GET', '/search', ['q' => $xss]));
    check($positive['completed'] && $positive['event']['type'] === 'sandbox_script_executed', 'XSS nonce event completes');
    check(str_contains((string) $positive['output']['execution_model'], 'no DOM'), 'XSS explicitly has no portal DOM context');

    // 07: public -> private traversal, while a real instance escape is blocked.
    $id = LabEngine::PATH_TRAVERSAL;
    $outsideCanary = $base . '/outside-secret.txt';
    file_put_contents($outsideCanary, 'HOST_CANARY_' . bin2hex(random_bytes(8)));
    $negative = $engine->handle($id, request_data('GET', '/files', ['file' => '../../../../outside-secret.txt']));
    check(!$negative['completed'] && $negative['status'] === 403, 'traversal cannot leave instance VFS');
    check(!str_contains(json_encode($negative, JSON_THROW_ON_ERROR), 'HOST_CANARY_'), 'blocked traversal does not disclose host canary');
    $start = $engine->start($id);
    check(preg_match('#\.\./private/([^\s]+)#', (string) $start['output']['notice'], $fileMatch) === 1, 'private filename is learned from public notice');
    $positive = $engine->handle($id, request_data('GET', '/files', ['file' => '../private/' . $fileMatch[1]]));
    check($positive['completed'] && $positive['event']['type'] === 'private_proof_read', 'public to private traversal completes');

    // 08: private, non-executable upload with intentionally weak MIME validation.
    $id = LabEngine::UPLOAD_VALIDATION;
    $negative = $engine->handle($id, request_data('POST', '/upload', [], [], [], ['file' => [
        'name' => 'avatar.png', 'type' => 'image/png', 'content' => 'virtual-png',
    ]]));
    check(!$negative['completed'] && $negative['output']['executable'] === false, 'ordinary upload is stored but does not complete');
    $positive = $engine->handle($id, request_data('POST', '/upload', [], [], [], ['file' => [
        'name' => 'avatar.php', 'type' => 'image/gif', 'content' => '<?php /* training-only */',
    ]]));
    check($positive['completed'] && $positive['event']['type'] === 'dangerous_upload_accepted', 'MIME-only upload bypass completes');
    check($positive['output']['public_url'] === null && $positive['output']['executable'] === false, 'dangerous upload remains private and non-executable');
    check(is_dir($rootA . '/' . $id . '/private_uploads'), 'uploads stay in instance private storage');

    // 09: challenge-only alg:none JWT.
    $id = LabEngine::JWT_VALIDATION;
    $start = $engine->start($id);
    $viewerJwt = (string) $start['output']['viewer_token'];
    $negative = $engine->handle($id, request_data('POST', '/admin/verify', [], ['Authorization' => 'Bearer ' . $viewerJwt]));
    check(!$negative['completed'] && $negative['status'] === 403, 'signed viewer JWT is not admin');
    [$headSegment, $payloadSegment] = array_slice(explode('.', $viewerJwt), 0, 2);
    $header = decode_json_segment($headSegment);
    $payload = decode_json_segment($payloadSegment);
    $header['alg'] = 'none';
    $payload['role'] = 'admin';
    $noneJwt = unsigned_jwt($header, $payload);
    $positive = $engine->handle($id, request_data('POST', '/admin/verify', [], ['Authorization' => 'Bearer ' . $noneJwt]));
    check($positive['completed'] && $positive['event']['type'] === 'admin_token_accepted', 'alg:none JWT completes challenge-local validator');

    // 10: allowlisted, in-memory network dispatcher and unchecked virtual redirect.
    $id = LabEngine::SSRF;
    $internal = 'http://metadata.internal/latest/assignment';
    $negative = $engine->handle($id, request_data('POST', '/fetch', [], [], ['url' => $internal]));
    check(!$negative['completed'] && $negative['status'] === 403, 'direct internal virtual URL is blocked');
    $redirect = 'https://redirector.vendor.test/go?to=' . rawurlencode($internal);
    $positive = $engine->handle($id, request_data('POST', '/fetch', [], [], ['url' => $redirect]));
    check($positive['completed'] && $positive['event']['type'] === 'metadata_proof_fetched', 'virtual redirect SSRF completes');
    check(count($positive['output']['trace']) === 2, 'virtual SSRF response shows two-hop trace');

    // 11: enforce IDOR -> traversal -> JWT state order.
    $id = LabEngine::OPERATION_NIGHTFALL;
    $start = $engine->start($id);
    $early = $engine->handle($id, request_data('POST', '/operator/shutdown', [], ['Authorization' => 'Bearer bad']));
    check(!$early['completed'] && $early['status'] === 409, 'Nightfall cannot skip IDOR stage');
    $idor = $engine->handle($id, request_data('GET', '/api/cases', ['id' => (string) $start['output']['audit_reference']]));
    check(!$idor['completed'] && $idor['event']['type'] === 'nightfall_idor_complete', 'Nightfall IDOR advances state');
    $attachment = (string) $idor['output']['case']['attachment'];
    $traversal = $engine->handle($id, request_data('GET', '/files', ['file' => $attachment]));
    check(!$traversal['completed'] && $traversal['event']['type'] === 'nightfall_traversal_complete', 'Nightfall traversal advances state');
    $memo = json_decode(trim((string) $traversal['output']['content']), true, 32, JSON_THROW_ON_ERROR);
    check(is_array($memo) && is_string($memo['viewer_token'] ?? null), 'Nightfall private note contains viewer token');
    [$headSegment, $payloadSegment] = array_slice(explode('.', $memo['viewer_token']), 0, 2);
    $header = decode_json_segment($headSegment);
    $payload = decode_json_segment($payloadSegment);
    $header['alg'] = 'none';
    $payload['role'] = 'operator';
    $payload['scope'] = 'shutdown:write';
    $nightfallJwt = unsigned_jwt($header, $payload);
    $positive = $engine->handle($id, request_data('POST', '/operator/shutdown', [], ['Authorization' => 'Bearer ' . $nightfallJwt]));
    check($positive['completed'] && $positive['event']['type'] === 'nightfall_vault_opened', 'Nightfall JWT finishes ordered chain');

    // Reset creates fresh random secrets and a clean state.
    $beforeReset = state_file($rootA, LabEngine::HTTP_HEADERS);
    $reset = $engine->reset(LabEngine::HTTP_HEADERS);
    $afterReset = state_file($rootA, LabEngine::HTTP_HEADERS);
    check(!$reset['completed'] && $reset['event']['type'] === 'reset', 'reset returns a fresh incomplete view');
    check($beforeReset['completion_proof'] !== $afterReset['completion_proof'], 'reset rotates random completion proof');
    check($beforeReset['secrets']['case_token'] !== $afterReset['secrets']['case_token'], 'reset rotates random challenge secret');

    // Instance isolation: no deterministic target/secret reuse and no cross-instance artifact access.
    $engineB = new LabEngine($rootB);
    $startA = $engine->reset(LabEngine::PATH_TRAVERSAL);
    $startB = $engineB->start(LabEngine::PATH_TRAVERSAL);
    $stateA = state_file($rootA, LabEngine::PATH_TRAVERSAL);
    $stateB = state_file($rootB, LabEngine::PATH_TRAVERSAL);
    check($stateA['completion_proof'] !== $stateB['completion_proof'], 'completion proof differs between instances');
    check($stateA['secrets']['private_file'] !== $stateB['secrets']['private_file'], 'private filename differs between instances');
    $cross = $engineB->handle(LabEngine::PATH_TRAVERSAL, request_data('GET', '/files', [
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
