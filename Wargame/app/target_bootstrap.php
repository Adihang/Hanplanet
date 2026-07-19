<?php
declare(strict_types=1);

require_once __DIR__ . '/runtime.php';
require_once __DIR__ . '/LabSessionService.php';

const WARGAME_TARGET_MAX_BODY = 65536;

function target_request_is_https(): bool
{
    if ((string) getenv('WARGAME_FORCE_SECURE_COOKIE') === '1') {
        return true;
    }
    if (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off') {
        return true;
    }
    return (string) getenv('WARGAME_TRUST_PROXY') === '1'
        && strtolower(trim((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''))) === 'https';
}

function target_security_headers(string $missionId = ''): void
{
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store, private');
    header('Pragma: no-cache');
    header('Referrer-Policy: no-referrer');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Cross-Origin-Opener-Policy: same-origin');
    header('Cross-Origin-Resource-Policy: same-origin');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()');

    if ($missionId === LabEngine::REFLECTED_XSS) {
        // Prism intentionally executes reflected inline handlers. The top-level
        // document receives an opaque origin, so that code cannot read or call
        // the Hanplanet portal even though both routes share one public host.
        header(
            "Content-Security-Policy: sandbox allow-scripts allow-forms allow-top-navigation-by-user-activation; "
            . "default-src 'none'; img-src data:; style-src 'self' 'unsafe-inline' https://wargame.hanplanet.com http://localhost:8090 http://127.0.0.1:8090; "
            . "script-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'; "
            . "form-action 'self' https://wargame.hanplanet.com http://localhost:8090 http://127.0.0.1:8090; frame-ancestors 'none'"
        );
        return;
    }

    header(
        "Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; "
        . "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    );
}

/** @return array<string, string> */
function target_request_headers(): array
{
    $headers = [];
    $rawHeaders = function_exists('getallheaders') ? getallheaders() : [];
    if (!is_array($rawHeaders)) {
        $rawHeaders = [];
    }
    foreach ($rawHeaders as $name => $value) {
        if (!is_string($name) || (!is_scalar($value) && $value !== null)) {
            continue;
        }
        $normalizedName = trim($name);
        $normalizedValue = trim((string) $value);
        if ($normalizedName === '' || preg_match('/^[A-Za-z0-9-]{1,128}$/', $normalizedName) !== 1
            || str_contains($normalizedValue, "\r") || str_contains($normalizedValue, "\n")) {
            continue;
        }
        if (in_array(strtolower($normalizedName), [
            'cookie', 'host', 'connection', 'content-length', 'transfer-encoding',
            'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto',
        ], true)) {
            continue;
        }
        $headers[$normalizedName] = substr($normalizedValue, 0, 16384);
    }

    $authorization = trim((string) ($_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '')));
    if ($authorization !== '' && !isset($headers['Authorization'])) {
        $headers['Authorization'] = substr($authorization, 0, 16384);
    }

    // Challenge code sees only the intentionally mutable Leaf role cookie.
    // Portal sessions and opaque instance credentials never enter LabEngine.
    $leafRole = (string) ($_COOKIE['leaf_role'] ?? '');
    if ($leafRole !== '' && strlen($leafRole) <= 16384 && !str_contains($leafRole, "\r") && !str_contains($leafRole, "\n")) {
        $headers['Cookie'] = 'leaf_role=' . rawurlencode($leafRole);
    }
    return $headers;
}

/** @return array<string, array{name:string,type:string,content:string}> */
function target_uploaded_files(): array
{
    $files = [];
    foreach ($_FILES as $field => $upload) {
        if (!is_string($field) || !is_array($upload) || is_array($upload['name'] ?? null)) {
            continue;
        }
        $error = (int) ($upload['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($error === UPLOAD_ERR_NO_FILE) {
            continue;
        }
        if ($error !== UPLOAD_ERR_OK) {
            throw new InvalidArgumentException('업로드 전송을 완료하지 못했습니다.');
        }
        $size = (int) ($upload['size'] ?? 0);
        $temporaryPath = (string) ($upload['tmp_name'] ?? '');
        if ($size < 0 || $size > WARGAME_TARGET_MAX_BODY || $temporaryPath === '' || !is_file($temporaryPath)) {
            throw new InvalidArgumentException('업로드 파일은 64KB 이하여야 합니다.');
        }
        $content = file_get_contents($temporaryPath, false, null, 0, WARGAME_TARGET_MAX_BODY + 1);
        if (!is_string($content) || strlen($content) > WARGAME_TARGET_MAX_BODY) {
            throw new InvalidArgumentException('업로드 파일을 안전하게 읽지 못했습니다.');
        }
        $files[$field] = [
            'name' => substr((string) ($upload['name'] ?? ''), 0, 255),
            'type' => substr((string) ($upload['type'] ?? 'application/octet-stream'), 0, 128),
            'content' => $content,
        ];
    }
    return $files;
}

/** @return array<string, mixed> */
function target_http_request(string $slug): array
{
    $requestUri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
    $publicPath = parse_url($requestUri, PHP_URL_PATH);
    $publicPath = is_string($publicPath) ? rawurldecode($publicPath) : '/';
    $prefix = '/' . $slug;
    if ($publicPath !== $prefix && !str_starts_with($publicPath, $prefix . '/')) {
        throw new InvalidArgumentException('요청한 서비스 경로가 현재 타깃과 일치하지 않습니다.');
    }
    $path = substr($publicPath, strlen($prefix));
    $path = $path === '' ? '/' : $path;

    $contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($contentLength > WARGAME_TARGET_MAX_BODY * 2) {
        throw new InvalidArgumentException('요청 본문이 허용 크기를 초과했습니다.');
    }

    $body = $_POST;
    $contentType = strtolower(trim(explode(';', (string) ($_SERVER['CONTENT_TYPE'] ?? ''), 2)[0] ?? ''));
    if ($body === [] && in_array($contentType, ['application/json', 'text/json'], true)) {
        $raw = file_get_contents('php://input', false, null, 0, WARGAME_TARGET_MAX_BODY + 1);
        if (!is_string($raw) || strlen($raw) > WARGAME_TARGET_MAX_BODY) {
            throw new InvalidArgumentException('요청 본문은 64KB 이하여야 합니다.');
        }
        if ($raw !== '') {
            try {
                $decoded = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
            } catch (JsonException $exception) {
                throw new InvalidArgumentException('JSON 요청 본문을 해석할 수 없습니다.', 0, $exception);
            }
            $body = is_array($decoded) ? $decoded : $raw;
        }
    }

    return [
        'method' => strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')),
        'path' => $path,
        'query' => $_GET,
        'headers' => target_request_headers(),
        'body' => $body,
        'files' => target_uploaded_files(),
    ];
}

function target_public_engine_path(string $missionId, string $enginePath): string
{
    if ($enginePath === '' || $enginePath[0] !== '/' || str_contains($enginePath, "\r") || str_contains($enginePath, "\n")) {
        throw new InvalidArgumentException('타깃 응답 경로가 올바르지 않습니다.');
    }
    return LabSessionService::targetBasePath($missionId) . $enginePath;
}

/** @param array<string, mixed> $response */
function target_emit_engine_response(string $missionId, array $response): void
{
    $status = (int) ($response['status'] ?? 500);
    http_response_code($status >= 100 && $status <= 599 ? $status : 500);

    foreach ((array) ($response['headers'] ?? []) as $name => $value) {
        if (!is_string($name) || (!is_scalar($value) && $value !== null)) {
            continue;
        }
        $headerValue = (string) $value;
        if (str_contains($headerValue, "\r") || str_contains($headerValue, "\n")) {
            continue;
        }
        $lowerName = strtolower($name);
        if ($lowerName === 'set-cookie' && $missionId === LabEngine::CLIENT_TRUST
            && preg_match('/^leaf_role=([^;]+)/', $headerValue, $match) === 1) {
            setcookie('leaf_role', rawurldecode($match[1]), [
                'expires' => 0,
                'path' => LabSessionService::targetBasePath($missionId) . '/',
                'domain' => '',
                'secure' => target_request_is_https(),
                'httponly' => false,
                'samesite' => 'Strict',
            ]);
            continue;
        }
        if ($lowerName === 'x-aurora-route' && $missionId === LabEngine::HTTP_HEADERS) {
            header('X-Aurora-Route: ' . target_public_engine_path($missionId, $headerValue));
            continue;
        }
        if ($lowerName === 'x-vector-session' && $missionId === LabEngine::JWT_VALIDATION
            && strlen($headerValue) <= 4096) {
            header('X-Vector-Session: ' . $headerValue);
            continue;
        }
        if ($lowerName === 'allow' && preg_match('/^[A-Z, ]{1,64}$/', $headerValue) === 1) {
            header('Allow: ' . $headerValue);
            continue;
        }
        if ($lowerName === 'etag' && strlen($headerValue) <= 128) {
            header('ETag: ' . $headerValue);
        }
    }
}

/** @param array<string, mixed> $context @param array<string, mixed> $response */
function target_dispatch_completion(array $context, array $response): void
{
    if (($response['completed'] ?? false) !== true) {
        return;
    }
    try {
        $ticket = LabSessionService::issueCompletionTicket($context);
        require_once __DIR__ . '/bootstrap.php';
        require_once __DIR__ . '/CampaignService.php';
        $user = current_django_user();
        if (!is_array($user) || !LabSessionService::contextBelongsTo($context, $user)) {
            if (session_status() === PHP_SESSION_ACTIVE) {
                $_SESSION['pending_completion_ticket'] = $ticket;
            }
            return;
        }
        CampaignService::completeAndDispatch($user, $ticket);
        unset($_SESSION['pending_completion_ticket']);
    } catch (Throwable $exception) {
        error_log('Wargame target completion handoff failed: ' . $exception->getMessage());
    }
}

function target_pretty_json(mixed $value): string
{
    return (string) json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_INVALID_UTF8_SUBSTITUTE);
}
