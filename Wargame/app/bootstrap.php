<?php
declare(strict_types=1);

require_once __DIR__ . '/runtime.php';

ini_set('session.save_handler', 'files');
ini_set('session.save_path', WARGAME_SESSION_DIR);
ini_set('session.use_only_cookies', '1');
ini_set('session.use_strict_mode', '1');
ini_set('session.cookie_httponly', '1');
ini_set('session.cookie_samesite', 'Lax');
ini_set('session.gc_maxlifetime', '7200');

function wargame_is_https(): bool
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

session_name('wargame_portal');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'domain' => '',
    'secure' => wargame_is_https(),
    'httponly' => true,
    'samesite' => 'Lax',
]);
if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}

function wargame_portal_headers(): void
{
    $djangoParts = parse_url(django_base_url());
    $djangoOrigin = is_array($djangoParts) && isset($djangoParts['scheme'], $djangoParts['host'])
        ? $djangoParts['scheme'] . '://' . $djangoParts['host'] . (isset($djangoParts['port']) ? ':' . $djangoParts['port'] : '')
        : WARGAME_DJANGO_DEFAULT_BASE_URL;
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store, private');
    header('Pragma: no-cache');
    header('Referrer-Policy: no-referrer');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Cross-Origin-Opener-Policy: same-origin');
    header('Cross-Origin-Resource-Policy: same-origin');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    $upgrade = wargame_is_https() ? '; upgrade-insecure-requests' : '';
    header("Content-Security-Policy: default-src 'self'; img-src 'self' data: " . $djangoOrigin . "; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' https://cdn.jsdelivr.net; script-src-elem 'self' 'unsafe-inline' https://cdn.jsdelivr.net; script-src-attr 'none'; connect-src 'self' " . $djangoOrigin . "; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" . $upgrade);
}

function csrf_token(): string
{
    if (!isset($_SESSION['csrf_token']) || !is_string($_SESSION['csrf_token']) || strlen($_SESSION['csrf_token']) < 64) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function require_csrf(): void
{
    $submitted = $_POST['csrf_token'] ?? ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
    if (!is_string($submitted) || !hash_equals(csrf_token(), $submitted)) {
        throw new InvalidArgumentException('요청이 만료되었습니다. 페이지를 새로고침해 다시 시도해 주세요.');
    }
}

function redirect_to(string $path): never
{
    $path = wargame_return_path($path);
    header('Location: ' . $path, true, 303);
    exit;
}

function flash_message(string $type, string $message): void
{
    $_SESSION['flash'] = ['type' => $type, 'message' => $message];
}

function take_flash_message(): ?array
{
    $flash = $_SESSION['flash'] ?? null;
    unset($_SESSION['flash']);
    return is_array($flash) ? $flash : null;
}

function django_base_url(): string
{
    $configured = trim((string) getenv('WARGAME_DJANGO_BASE_URL'));
    return rtrim($configured !== '' ? $configured : WARGAME_DJANGO_DEFAULT_BASE_URL, '/');
}

function django_api_url(string $endpoint): string
{
    $allowed = ['session/', 'solves/', 'preferences/', 'navbar/'];
    $normalized = ltrim($endpoint, '/');
    if (!in_array($normalized, $allowed, true)) {
        throw new InvalidArgumentException('허용되지 않은 Django API 경로입니다.');
    }
    return django_base_url() . '/ko/api/wargame/' . $normalized;
}

function django_internal_api_url(string $endpoint): string
{
    $allowed = ['session/', 'solves/', 'preferences/', 'navbar/'];
    $normalized = ltrim($endpoint, '/');
    if (!in_array($normalized, $allowed, true)) {
        throw new InvalidArgumentException('허용되지 않은 Django API 경로입니다.');
    }
    $configured = trim((string) getenv('WARGAME_DJANGO_INTERNAL_BASE_URL'));
    $base = $configured !== '' ? rtrim($configured, '/') : django_base_url();
    return $base . '/ko/api/wargame/' . $normalized;
}

function wargame_oidc_client_id(): string
{
    $configured = trim((string) getenv('WARGAME_OIDC_CLIENT_ID'));
    return $configured !== '' ? $configured : 'hanplanet-wargame-sso';
}

function wargame_oidc_client_secret(): string
{
    return trim((string) getenv('WARGAME_OIDC_CLIENT_SECRET'));
}

function wargame_oidc_redirect_uri(): string
{
    $configured = trim((string) getenv('WARGAME_OIDC_REDIRECT_URI'));
    if ($configured !== '') {
        return $configured;
    }
    return wargame_public_origin() . '/auth/callback.php';
}

function wargame_oidc_authorize_url(): string
{
    return django_base_url() . '/o/authorize/';
}

function wargame_oidc_token_url(): string
{
    $configured = trim((string) getenv('WARGAME_DJANGO_INTERNAL_BASE_URL'));
    $base = $configured !== '' ? rtrim($configured, '/') : django_base_url();
    return $base . '/o/token/';
}

function wargame_oidc_base64url(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function wargame_oidc_login_url(?string $returnPath = null): string
{
    $state = bin2hex(random_bytes(24));
    $verifier = wargame_oidc_base64url(random_bytes(48));
    $challenge = wargame_oidc_base64url(hash('sha256', $verifier, true));
    $_SESSION['oidc_pending'] = [
        'state' => $state,
        'verifier' => $verifier,
        'return_path' => wargame_return_path($returnPath),
        'created_at' => time(),
    ];

    $query = http_build_query([
        'response_type' => 'code',
        'client_id' => wargame_oidc_client_id(),
        'redirect_uri' => wargame_oidc_redirect_uri(),
        'scope' => 'openid profile email',
        'state' => $state,
        'code_challenge' => $challenge,
        'code_challenge_method' => 'S256',
    ], '', '&', PHP_QUERY_RFC3986);
    return wargame_oidc_authorize_url() . '?' . $query;
}

function wargame_oidc_pending_state(string $state): array
{
    $pending = $_SESSION['oidc_pending'] ?? null;
    unset($_SESSION['oidc_pending']);
    if (!is_array($pending)
        || !is_string($pending['state'] ?? null)
        || !hash_equals((string) $pending['state'], $state)
        || !is_string($pending['verifier'] ?? null)
        || (int) ($pending['created_at'] ?? 0) < time() - 600) {
        throw new InvalidArgumentException('인증 요청이 만료되었거나 유효하지 않습니다. 다시 로그인해 주세요.');
    }
    return $pending;
}

function wargame_oidc_http_post(string $url, array $payload): array
{
    $body = http_build_query($payload, '', '&', PHP_QUERY_RFC3986);
    $context = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => implode("\r\n", [
                'Accept: application/json',
                'Content-Type: application/x-www-form-urlencoded',
                'Content-Length: ' . strlen($body),
                'User-Agent: Hanplanet-Wargame-Portal/1.0',
            ]),
            'content' => $body,
            'ignore_errors' => true,
            'timeout' => 5,
            'max_redirects' => 0,
        ],
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
        ],
    ]);
    $http_response_header = [];
    $responseBody = @file_get_contents($url, false, $context);
    $status = 0;
    foreach ($http_response_header as $headerLine) {
        if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $headerLine, $match)) {
            $status = (int) $match[1];
            break;
        }
    }
    $decoded = is_string($responseBody) && strlen($responseBody) <= 1048576
        ? json_decode($responseBody, true)
        : null;
    return ['status' => $status, 'data' => is_array($decoded) ? $decoded : null];
}

function wargame_oidc_exchange_code(string $code, string $verifier): array
{
    $payload = [
        'grant_type' => 'authorization_code',
        'code' => trim($code),
        'redirect_uri' => wargame_oidc_redirect_uri(),
        'client_id' => wargame_oidc_client_id(),
        'code_verifier' => $verifier,
    ];
    $secret = wargame_oidc_client_secret();
    if ($secret !== '') {
        $payload['client_secret'] = $secret;
    }
    return wargame_oidc_http_post(wargame_oidc_token_url(), $payload);
}

function wargame_oidc_refresh_token(string $refreshToken): array
{
    $payload = [
        'grant_type' => 'refresh_token',
        'refresh_token' => $refreshToken,
        'client_id' => wargame_oidc_client_id(),
    ];
    $secret = wargame_oidc_client_secret();
    if ($secret !== '') {
        $payload['client_secret'] = $secret;
    }
    return wargame_oidc_http_post(wargame_oidc_token_url(), $payload);
}

function wargame_public_origin(): string
{
    $configured = trim((string) getenv('WARGAME_PUBLIC_URL')) ?: 'https://wargame.hanplanet.com/';
    $parts = parse_url($configured);
    if (!is_array($parts)
        || !in_array(strtolower((string) ($parts['scheme'] ?? '')), ['http', 'https'], true)
        || empty($parts['host'])
        || isset($parts['user'])
        || isset($parts['pass'])
        || preg_match('/[\r\n]/', $configured)) {
        return 'https://wargame.hanplanet.com';
    }

    $scheme = strtolower((string) $parts['scheme']);
    $host = (string) $parts['host'];
    if (str_contains($host, ':') && !str_starts_with($host, '[')) {
        $host = '[' . $host . ']';
    }
    $port = isset($parts['port']) ? ':' . (int) $parts['port'] : '';
    return $scheme . '://' . $host . $port;
}

function wargame_return_path(?string $candidate = null): string
{
    $path = $candidate ?? (string) ($_SERVER['REQUEST_URI'] ?? '/');
    if (strlen($path) > 4096
        || !str_starts_with($path, '/')
        || str_starts_with($path, '//')
        || preg_match('/[\x00-\x1f\x7f\\\\]/', $path)) {
        return '/';
    }
    $parts = parse_url($path);
    if (!is_array($parts)
        || isset($parts['scheme'])
        || isset($parts['host'])
        || isset($parts['user'])
        || isset($parts['pass'])
        || isset($parts['fragment'])) {
        return '/';
    }
    return $path;
}

function django_login_url(?string $returnPath = null): string
{
    $returnUrl = wargame_public_origin() . wargame_return_path($returnPath);
    return django_base_url() . '/ko/login/?next=' . rawurlencode($returnUrl);
}

function wargame_bearer_token(string $token): string
{
    $token = trim($token);
    if (strlen($token) > 8192
        || preg_match('/\A[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\z/D', $token) !== 1) {
        throw new InvalidArgumentException('로그인 토큰이 올바르지 않습니다.');
    }

    return $token;
}

function django_api_request(string $method, string $endpoint, ?string $token = null, ?array $payload = null): array
{
    $headers = ['Accept: application/json', 'User-Agent: Hanplanet-Wargame-Portal/1.0'];
    $body = '';
    if (is_string($token) && $token !== '') {
        $headers[] = 'Authorization: Bearer ' . wargame_bearer_token($token);
    }
    if ($payload !== null) {
        $body = wargame_json($payload);
        $headers[] = 'Content-Type: application/json';
    }

    $context = stream_context_create([
        'http' => [
            'method' => strtoupper($method),
            'header' => implode("\r\n", $headers),
            'content' => $body,
            'ignore_errors' => true,
            'timeout' => 5,
            'max_redirects' => 0,
        ],
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
        ],
    ]);

    $http_response_header = [];
    $responseBody = @file_get_contents(django_internal_api_url($endpoint), false, $context);
    $status = 0;
    foreach ($http_response_header as $headerLine) {
        if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $headerLine, $match)) {
            $status = (int) $match[1];
            break;
        }
    }

    if (!is_string($responseBody) || strlen($responseBody) > 1048576) {
        return ['status' => $status, 'data' => null];
    }
    $decoded = json_decode($responseBody, true);
    return ['status' => $status, 'data' => is_array($decoded) ? $decoded : null];
}

function wargame_oauth_token(string $token): string
{
    $token = trim($token);
    if (strlen($token) > 8192 || preg_match('/\A[A-Za-z0-9._~-]+\z/D', $token) !== 1) {
        throw new InvalidArgumentException('OAuth 액세스 토큰이 올바르지 않습니다.');
    }
    return $token;
}

function django_oidc_api_request(string $endpoint, string $accessToken): array
{
    $normalized = ltrim($endpoint, '/');
    $headers = [
        'Accept: application/json',
        'Authorization: Bearer ' . wargame_oauth_token($accessToken),
        'User-Agent: Hanplanet-Wargame-Portal/1.0',
    ];
    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => implode("\r\n", $headers),
            'ignore_errors' => true,
            'timeout' => 5,
            'max_redirects' => 0,
        ],
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
        ],
    ]);
    $http_response_header = [];
    $responseBody = @file_get_contents(django_internal_api_url($normalized), false, $context);
    $status = 0;
    foreach ($http_response_header as $headerLine) {
        if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $headerLine, $match)) {
            $status = (int) $match[1];
            break;
        }
    }
    $decoded = is_string($responseBody) && strlen($responseBody) <= 1048576
        ? json_decode($responseBody, true)
        : null;
    return ['status' => $status, 'data' => is_array($decoded) ? $decoded : null];
}

function token_expiry(string $token): int
{
    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        return 0;
    }
    $payload = wargame_base64url_decode($parts[1]);
    $decoded = is_string($payload) ? json_decode($payload, true) : null;
    return is_array($decoded) ? (int) ($decoded['exp'] ?? 0) : 0;
}

function wargame_store_django_identity(array $identity, string $oauthAccessToken, string $oauthRefreshToken = '', int $oauthExpiresIn = 0): array
{
    $gameToken = wargame_bearer_token((string) ($identity['token'] ?? ''));
    $username = trim((string) ($identity['username'] ?? ''));
    if ($username === '') {
        throw new InvalidArgumentException('로그인 사용자 정보가 비어 있습니다.');
    }
    $userId = wargame_django_user_id($identity);
    $auth = [
        'token' => $gameToken,
        'expires_at' => token_expiry($gameToken),
        'oauth_access_token' => wargame_oauth_token($oauthAccessToken),
        'oauth_refresh_token' => $oauthRefreshToken !== '' ? wargame_oauth_token($oauthRefreshToken) : '',
        'oauth_expires_at' => time() + max(60, $oauthExpiresIn),
        'user_id' => $userId,
        'username' => $username,
        'display_name' => trim((string) ($identity['display_name'] ?? $username)),
        'email' => trim((string) ($identity['email'] ?? '')),
        'profile_image_url' => trim((string) ($identity['profile_image_url'] ?? '')),
        'solves' => array_values(array_filter((array) ($identity['solves'] ?? []), 'is_string')),
        'checked_at' => time(),
    ];
    session_regenerate_id(true);
    $_SESSION['django_auth'] = $auth;
    unset($_SESSION['csrf_token']);
    return current_django_user(false) ?? throw new RuntimeException('로그인 세션을 만들지 못했습니다.');
}

function accept_oidc_access_token(string $accessToken, string $refreshToken = '', int $expiresIn = 0): array
{
    $accessToken = wargame_oauth_token($accessToken);
    $response = django_oidc_api_request('session/', $accessToken);
    if ($response['status'] !== 200 || !is_array($response['data']) || !($response['data']['authenticated'] ?? false)) {
        throw new InvalidArgumentException('Hanplanet OIDC 로그인을 확인하지 못했습니다.');
    }
    return wargame_store_django_identity($response['data'], $accessToken, $refreshToken, $expiresIn);
}

function refresh_django_auth_token(): bool
{
    $auth = $_SESSION['django_auth'] ?? null;
    if (!is_array($auth)) {
        return false;
    }
    $accessToken = trim((string) ($auth['oauth_access_token'] ?? ''));
    $refreshToken = trim((string) ($auth['oauth_refresh_token'] ?? ''));
    if ($accessToken === '') {
        return false;
    }

    $oauthExpiresAt = (int) ($auth['oauth_expires_at'] ?? 0);
    if ($oauthExpiresAt <= time() + 30 && $refreshToken !== '') {
        $refreshResponse = wargame_oidc_refresh_token($refreshToken);
        if ($refreshResponse['status'] !== 200 || !is_array($refreshResponse['data'])) {
            return false;
        }
        $accessToken = trim((string) ($refreshResponse['data']['access_token'] ?? ''));
        $refreshToken = trim((string) ($refreshResponse['data']['refresh_token'] ?? $refreshToken));
        $expiresIn = (int) ($refreshResponse['data']['expires_in'] ?? 3600);
        if ($accessToken === '') {
            return false;
        }
    } else {
        $expiresIn = max(60, $oauthExpiresAt - time());
    }

    $response = django_oidc_api_request('session/', $accessToken);
    if ($response['status'] !== 200 || !is_array($response['data']) || !($response['data']['authenticated'] ?? false)) {
        return false;
    }
    $gameToken = wargame_bearer_token((string) ($response['data']['token'] ?? ''));
    $auth['token'] = $gameToken;
    $auth['expires_at'] = token_expiry($gameToken);
    $auth['oauth_access_token'] = wargame_oauth_token($accessToken);
    $auth['oauth_refresh_token'] = $refreshToken !== '' ? wargame_oauth_token($refreshToken) : '';
    $auth['oauth_expires_at'] = time() + $expiresIn;
    $auth['user_id'] = wargame_django_user_id($response['data']);
    $auth['username'] = trim((string) ($response['data']['username'] ?? $auth['username'] ?? ''));
    $auth['display_name'] = trim((string) ($response['data']['display_name'] ?? $auth['display_name'] ?? $auth['username']));
    $auth['email'] = trim((string) ($response['data']['email'] ?? $auth['email'] ?? ''));
    $auth['profile_image_url'] = trim((string) ($response['data']['profile_image_url'] ?? $auth['profile_image_url'] ?? ''));
    $auth['checked_at'] = time();
    $_SESSION['django_auth'] = $auth;
    return true;
}

function accept_django_token(string $token): array
{
    $token = wargame_bearer_token($token);

    $response = django_api_request('GET', 'solves/', $token);
    if ($response['status'] !== 200 || !is_array($response['data'])) {
        throw new InvalidArgumentException('Hanplanet 로그인을 확인하지 못했습니다.');
    }

    $data = $response['data'];
    $username = trim((string) ($data['username'] ?? ''));
    if ($username === '') {
        throw new InvalidArgumentException('로그인 사용자 정보가 비어 있습니다.');
    }
    try {
        $userId = wargame_django_user_id($data);
    } catch (InvalidArgumentException) {
        throw new InvalidArgumentException('Hanplanet 계정의 안정적인 식별자를 확인하지 못했습니다.');
    }

    $auth = [
        'token' => $token,
        'expires_at' => token_expiry($token),
        'user_id' => $userId,
        'username' => $username,
        'display_name' => trim((string) ($data['display_name'] ?? $username)),
        'email' => trim((string) ($data['email'] ?? '')),
        'profile_image_url' => trim((string) ($data['profile_image_url'] ?? '')),
        'solves' => array_values(array_filter((array) ($data['solves'] ?? []), 'is_string')),
        'checked_at' => time(),
    ];

    session_regenerate_id(true);
    $_SESSION['django_auth'] = $auth;
    unset($_SESSION['csrf_token']);

    return current_django_user(false) ?? throw new RuntimeException('로그인 세션을 만들지 못했습니다.');
}

function current_django_user(bool $refresh = true): ?array
{
    $auth = $_SESSION['django_auth'] ?? null;
    if (!is_array($auth) || !is_string($auth['token'] ?? null) || (string) $auth['token'] === '') {
        return null;
    }

    $expiresAt = (int) ($auth['expires_at'] ?? 0);
    if ($expiresAt > 0 && $expiresAt <= time()) {
        if (!refresh_django_auth_token()) {
            unset($_SESSION['django_auth']);
            return null;
        }
        $auth = $_SESSION['django_auth'] ?? null;
        if (!is_array($auth)) {
            return null;
        }
    }

    $hasStableUserId = preg_match('/^[1-9][0-9]{0,18}$/', trim((string) ($auth['user_id'] ?? ''))) === 1;
    if ($refresh && (!$hasStableUserId || time() - (int) ($auth['checked_at'] ?? 0) >= 30)) {
        $response = django_api_request('GET', 'solves/', (string) $auth['token']);
        if ($response['status'] !== 200 || !is_array($response['data'])) {
            if (!refresh_django_auth_token()) {
                unset($_SESSION['django_auth']);
                return null;
            }
            $auth = $_SESSION['django_auth'] ?? null;
            if (!is_array($auth)) {
                return null;
            }
            $response = django_api_request('GET', 'solves/', (string) $auth['token']);
            if ($response['status'] !== 200 || !is_array($response['data'])) {
                unset($_SESSION['django_auth']);
                return null;
            }
        }
        $data = $response['data'];
        try {
            $auth['user_id'] = wargame_django_user_id($data);
        } catch (InvalidArgumentException) {
            unset($_SESSION['django_auth']);
            return null;
        }
        $auth['username'] = trim((string) ($data['username'] ?? $auth['username'] ?? ''));
        $auth['display_name'] = trim((string) ($data['display_name'] ?? $auth['display_name'] ?? $auth['username']));
        $auth['email'] = trim((string) ($data['email'] ?? $auth['email'] ?? ''));
        $auth['profile_image_url'] = trim((string) ($data['profile_image_url'] ?? $auth['profile_image_url'] ?? ''));
        $auth['solves'] = array_values(array_filter((array) ($data['solves'] ?? []), 'is_string'));
        $auth['checked_at'] = time();
        $_SESSION['django_auth'] = $auth;
    }

    try {
        $userId = wargame_django_user_id($auth);
    } catch (InvalidArgumentException) {
        unset($_SESSION['django_auth']);
        return null;
    }

    return [
        'user_id' => $userId,
        'username' => (string) ($auth['username'] ?? ''),
        'display_name' => (string) ($auth['display_name'] ?? ''),
        'email' => (string) ($auth['email'] ?? ''),
        'profile_image_url' => (string) ($auth['profile_image_url'] ?? ''),
        'solves' => (array) ($auth['solves'] ?? []),
        'expires_at' => (int) ($auth['expires_at'] ?? 0),
    ];
}

function django_token(): ?string
{
    $token = $_SESSION['django_auth']['token'] ?? null;
    return is_string($token) && $token !== '' ? $token : null;
}

function auth_refresh_needed(): bool
{
    $expiresAt = (int) ($_SESSION['django_auth']['expires_at'] ?? 0);
    return $expiresAt === 0 || $expiresAt - time() < 90;
}

function forget_django_user(): void
{
    unset($_SESSION['django_auth']);
    unset($_SESSION['oidc_pending']);
    session_regenerate_id(true);
    unset($_SESSION['csrf_token']);
}

function wargame_completion_secret(): string
{
    $secret = trim((string) getenv('WARGAME_COMPLETION_SECRET'));
    $normalized = strtolower($secret);
    $knownPlaceholders = [
        'change-this-to-a-separate-long-random-wargame-secret',
        'replace-me',
        'changeme',
    ];
    $supportedFormat = preg_match('/^(?:[a-f0-9]{64,}|[a-z0-9_-]{43,})$/i', $secret) === 1;
    $distinctCharacters = count(array_unique(str_split($secret)));
    if (!$supportedFormat || $distinctCharacters < 12 || in_array($normalized, $knownPlaceholders, true)) {
        return '';
    }
    return $secret;
}

function django_completion_payload(array $user, string $challengeId, string $ticketHash): array
{
    $payload = ['challenge_id' => $challengeId];
    $secret = wargame_completion_secret();
    if ($secret === '') {
        return $payload;
    }

    $timestamp = time();
    $nonce = bin2hex(random_bytes(16));
    $identity = 'django-user-id:v1:' . wargame_django_user_id($user);
    $message = implode("\n", [$identity, $challengeId, $ticketHash, (string) $timestamp, $nonce]);
    return $payload + [
        'ticket_hash' => $ticketHash,
        'timestamp' => $timestamp,
        'nonce' => $nonce,
        'receipt' => hash_hmac('sha256', $message, $secret),
    ];
}

function mark_solved_with_django(array $user, string $challengeId, string $ticketHash): array
{
    $token = django_token();
    if ($token === null) {
        throw new RuntimeException('로그인이 만료되었습니다. 다시 연결해 주세요.');
    }
    $payload = django_completion_payload($user, $challengeId, $ticketHash);
    $response = django_api_request('POST', 'solves/', $token, $payload);
    if ($response['status'] !== 200 || !is_array($response['data'])) {
        throw new RuntimeException('진행 기록을 Hanplanet 계정에 저장하지 못했습니다.');
    }
    $_SESSION['django_auth']['solves'] = array_values(array_filter((array) ($response['data']['solves'] ?? []), 'is_string'));
    $_SESSION['django_auth']['checked_at'] = time();
    return $response['data'];
}

function wargame_progress(array $solves): array
{
    $missions = wargame_missions();
    $solved = array_fill_keys(array_values(array_intersect(array_keys($missions), $solves)), true);
    $states = [];
    $currentId = null;
    $priorMissionIds = [];
    foreach ($missions as $missionId => $mission) {
        $completed = isset($solved[$missionId]);
        $prerequisites = array_values(array_filter((array) ($mission['prerequisites'] ?? []), 'is_string'));
        $requiredIds = array_values(array_unique(array_merge($priorMissionIds, $prerequisites)));
        $locked = !$completed && count(array_diff($requiredIds, array_keys($solved))) > 0;
        if ($currentId === null && !$completed && !$locked) {
            $currentId = $missionId;
        }
        $states[$missionId] = $completed ? 'completed' : ($locked ? 'locked' : 'available');
        $priorMissionIds[] = $missionId;
    }

    $total = count($missions);
    $completedCount = count($solved);
    return [
        'states' => $states,
        'current_id' => $currentId,
        'completed' => $completedCount,
        'total' => $total,
        'percent' => $total > 0 ? (int) floor($completedCount / $total * 100) : 0,
        'finished' => $total > 0 && $completedCount === $total,
    ];
}

function campaign_started(string $ownerKey): bool
{
    $statement = wargame_db()->prepare('SELECT 1 FROM mission_dispatches WHERE owner_key_hash = :owner LIMIT 1');
    $statement->execute(['owner' => $ownerKey]);
    return (bool) $statement->fetchColumn();
}
