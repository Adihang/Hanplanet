<?php
declare(strict_types=1);

const WARGAME_ROOT = __DIR__ . '/..';
const WARGAME_DB_PATH = WARGAME_ROOT . '/data/wargame.sqlite3';
const WARGAME_SCHEMA_PATH = WARGAME_ROOT . '/database/schema.sql';
const WARGAME_DJANGO_DEFAULT_BASE_URL = 'https://www.hanplanet.com';

ini_set('display_errors', '0');
ini_set('log_errors', '1');
ini_set('error_log', WARGAME_ROOT . '/data/php-error.log');

session_name('wargame_session');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'domain' => '',
    'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'),
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_start();

function db(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dataDir = dirname(WARGAME_DB_PATH);
    if (!is_dir($dataDir)) {
        mkdir($dataDir, 0770, true);
    }

    $pdo = new PDO('sqlite:' . WARGAME_DB_PATH, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA busy_timeout = 3000');

    if (!has_schema($pdo)) {
        initialize_database($pdo);
    }

    return $pdo;
}

function has_schema(PDO $pdo): bool
{
    $stmt = $pdo->query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'level2_users'");
    return (bool) $stmt->fetchColumn();
}

function initialize_database(PDO $pdo): void
{
    $schema = file_get_contents(WARGAME_SCHEMA_PATH);
    if ($schema === false) {
        throw new RuntimeException('Schema file not found.');
    }

    $pdo->exec($schema);
}

function h(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function redirect_to(string $path): never
{
    header('Location: ' . $path, true, 303);
    exit;
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }

    return $_SESSION['csrf_token'];
}

function require_csrf(): void
{
    $token = $_POST['csrf_token'] ?? '';
    if (!is_string($token) || !hash_equals(csrf_token(), $token)) {
        http_response_code(400);
        exit('Bad request.');
    }
}

function django_base_url(): string
{
    $baseUrl = getenv('WARGAME_DJANGO_BASE_URL') ?: WARGAME_DJANGO_DEFAULT_BASE_URL;
    return rtrim($baseUrl, '/');
}

function django_api_url(string $path): string
{
    return django_base_url() . '/ko/api/wargame/' . ltrim($path, '/');
}

function django_login_url(): string
{
    return django_base_url() . '/ko/login/?next=' . rawurlencode('https://wargame.hanplanet.com/');
}

function django_static_url(string $path): string
{
    return django_base_url() . '/static/' . ltrim($path, '/');
}

function django_api_request(string $method, string $path, ?string $token = null, ?array $payload = null): array
{
    $headers = [
        'Accept: application/json',
    ];
    $content = null;
    if ($token) {
        $headers[] = 'Authorization: Bearer ' . $token;
    }
    if ($payload !== null) {
        $content = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $headers[] = 'Content-Type: application/json';
    }

    $context = stream_context_create([
        'http' => [
            'method' => strtoupper($method),
            'header' => implode("\r\n", $headers),
            'content' => $content ?? '',
            'ignore_errors' => true,
            'timeout' => 5,
        ],
    ]);

    $responseBody = @file_get_contents(django_api_url($path), false, $context);
    $status = 0;
    foreach (($http_response_header ?? []) as $header) {
        if (preg_match('/^HTTP\/\S+\s+(\d+)/', $header, $matches)) {
            $status = (int) $matches[1];
            break;
        }
    }

    if ($responseBody === false) {
        return ['status' => $status, 'data' => null];
    }

    $data = json_decode($responseBody, true);
    return ['status' => $status, 'data' => is_array($data) ? $data : null];
}

function current_django_user(): ?array
{
    $token = $_SESSION['django_token'] ?? '';
    if (!is_string($token) || $token === '') {
        return null;
    }

    $response = django_api_request('GET', 'solves/', $token);
    if ($response['status'] !== 200 || !is_array($response['data'])) {
        unset($_SESSION['django_token']);
        return null;
    }

    return [
        'username' => (string) ($response['data']['username'] ?? ''),
        'display_name' => (string) ($response['data']['display_name'] ?? ''),
        'solves' => array_values(array_filter((array) ($response['data']['solves'] ?? []), 'is_string')),
        'preferences' => current_django_preferences($token),
        'token' => $token,
    ];
}

function current_django_preferences(string $token): array
{
    $response = django_api_request('GET', 'preferences/', $token);
    if ($response['status'] !== 200 || !is_array($response['data'])) {
        return [
            'theme_mode' => null,
            'ui_lang' => null,
            'root_search_engine' => null,
        ];
    }

    return [
        'theme_mode' => $response['data']['theme_mode'] ?? null,
        'ui_lang' => $response['data']['ui_lang'] ?? null,
        'root_search_engine' => $response['data']['root_search_engine'] ?? null,
    ];
}

function mark_solved_with_django(string $token, string $challengeId): array
{
    $response = django_api_request('POST', 'solves/', $token, ['challenge_id' => $challengeId]);
    if ($response['status'] !== 200 || !is_array($response['data'])) {
        throw new RuntimeException('Django 워게임 API에 해결 기록을 저장하지 못했습니다.');
    }

    return $response['data'];
}

function wargame_slug(string $value): string
{
    $slug = strtolower(preg_replace('/[^a-zA-Z0-9]+/', '_', $value) ?? '');
    return trim($slug, '_') ?: 'challenge';
}

function wargame_css_class(string $value): string
{
    $className = strtolower(preg_replace('/[^a-zA-Z0-9]+/', '-', $value) ?? '');
    return trim($className, '-') ?: 'tag';
}

require_once __DIR__ . '/curriculum.php';

function list_challenges(): array
{
    return wargame_v2_list_challenges();
}
