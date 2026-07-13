<?php
declare(strict_types=1);

const WARGAME_ROOT = __DIR__ . '/..';
const WARGAME_DATA_DIR = WARGAME_ROOT . '/data';
const WARGAME_DB_PATH = WARGAME_DATA_DIR . '/wargame.sqlite3';
const WARGAME_SCHEMA_PATH = WARGAME_ROOT . '/database/schema.sql';
const WARGAME_INSTANCE_DIR = WARGAME_DATA_DIR . '/instances';
const WARGAME_MAIL_DIR = WARGAME_DATA_DIR . '/mail';
const WARGAME_SESSION_DIR = WARGAME_DATA_DIR . '/sessions';
const WARGAME_CURRICULUM_VERSION = 'web-v1';
const WARGAME_DJANGO_DEFAULT_BASE_URL = 'https://www.hanplanet.com';

ini_set('display_errors', '0');
ini_set('log_errors', '1');
ini_set('expose_php', '0');

foreach ([WARGAME_DATA_DIR, WARGAME_INSTANCE_DIR, WARGAME_MAIL_DIR, WARGAME_SESSION_DIR] as $directory) {
    if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) {
        throw new RuntimeException('런타임 디렉터리를 만들 수 없습니다.');
    }
}

ini_set('error_log', WARGAME_DATA_DIR . '/php-error.log');

function wargame_db(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $pdo = new PDO('sqlite:' . WARGAME_DB_PATH, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA busy_timeout = 5000');

    $schemaReady = (bool) $pdo
        ->query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'")
        ->fetchColumn();
    if (!$schemaReady) {
        $schema = file_get_contents(WARGAME_SCHEMA_PATH);
        if ($schema === false || trim($schema) === '') {
            throw new RuntimeException('Wargame schema is unavailable.');
        }
        $pdo->exec($schema);
    }

    return $pdo;
}

function wargame_app_secret(): string
{
    static $secret = null;
    if (is_string($secret)) {
        return $secret;
    }

    $configured = trim((string) getenv('WARGAME_APP_SECRET'));
    if ($configured !== '') {
        $secret = hash('sha256', $configured, true);
        return $secret;
    }

    $secretPath = WARGAME_DATA_DIR . '/app-secret.key';
    if (is_file($secretPath)) {
        $stored = file_get_contents($secretPath);
        if (is_string($stored) && strlen($stored) >= 32) {
            $secret = substr($stored, 0, 32);
            return $secret;
        }
    }

    $lock = fopen($secretPath . '.lock', 'c');
    if ($lock === false || !flock($lock, LOCK_EX)) {
        throw new RuntimeException('앱 비밀키 잠금을 획득할 수 없습니다.');
    }
    try {
        if (is_file($secretPath)) {
            $stored = file_get_contents($secretPath);
            if (is_string($stored) && strlen($stored) >= 32) {
                $secret = substr($stored, 0, 32);
                return $secret;
            }
        }

        $secret = random_bytes(32);
        $temporaryPath = $secretPath . '.' . bin2hex(random_bytes(4)) . '.tmp';
        if (file_put_contents($temporaryPath, $secret, LOCK_EX) === false) {
            throw new RuntimeException('앱 비밀키를 저장할 수 없습니다.');
        }
        chmod($temporaryPath, 0600);
        if (!rename($temporaryPath, $secretPath)) {
            @unlink($temporaryPath);
            throw new RuntimeException('앱 비밀키를 활성화할 수 없습니다.');
        }
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }

    return $secret;
}

function wargame_owner_key(string $username): string
{
    return hash_hmac('sha256', strtolower(trim($username)), wargame_app_secret());
}

function wargame_curriculum(): array
{
    static $curriculum = null;
    if (is_array($curriculum)) {
        return $curriculum;
    }

    $contentFile = __DIR__ . '/content/curriculum.php';
    if (!is_file($contentFile)) {
        return ['version' => WARGAME_CURRICULUM_VERSION, 'modules' => [], 'missions' => []];
    }

    $loaded = require $contentFile;
    if (!is_array($loaded)) {
        throw new RuntimeException('커리큘럼 데이터 형식이 올바르지 않습니다.');
    }

    if (array_is_list($loaded)) {
        $loaded = [
            'version' => WARGAME_CURRICULUM_VERSION,
            'modules' => [
                '01-http-and-trust' => [
                    'order' => 10,
                    'number' => '01',
                    'title' => 'HTTP와 신뢰 경계',
                    'description' => '요청을 읽고, 브라우저 값과 객체 ID가 권한을 대신할 수 없는 이유를 익힙니다.',
                ],
                '02-injection' => [
                    'order' => 20,
                    'number' => '02',
                    'title' => '인젝션과 브라우저 문맥',
                    'description' => '입력값이 SQL과 HTML 코드로 재해석되는 순간을 실제 격리 데이터로 추적합니다.',
                ],
                '03-server-boundaries' => [
                    'order' => 30,
                    'number' => '03',
                    'title' => '서버 경계와 내부 자산',
                    'description' => '파일, 업로드, 토큰, 서버 측 요청의 경계를 안전한 가상 인프라에서 공략합니다.',
                ],
                '04-operation' => [
                    'order' => 40,
                    'number' => '04',
                    'title' => 'Operation Nightfall',
                    'description' => '관찰한 증거를 연결해 IDOR, 경로 탐색, JWT 검증 실패를 하나의 작전으로 완성합니다.',
                ],
            ],
            'missions' => $loaded,
        ];
    }

    $missions = $loaded['missions'] ?? [];
    if (array_is_list($missions)) {
        $indexed = [];
        foreach ($missions as $mission) {
            if (is_array($mission) && isset($mission['id'])) {
                $indexed[(string) $mission['id']] = $mission;
            }
        }
        $loaded['missions'] = $indexed;
    }

    $curriculum = $loaded;
    return $curriculum;
}

function wargame_missions(): array
{
    $missions = (array) (wargame_curriculum()['missions'] ?? []);
    uasort($missions, static fn(array $left, array $right): int => ((int) ($left['order'] ?? 0)) <=> ((int) ($right['order'] ?? 0)));
    return $missions;
}

function wargame_mission(string $missionId): ?array
{
    $missions = wargame_missions();
    return isset($missions[$missionId]) && is_array($missions[$missionId]) ? $missions[$missionId] : null;
}

function wargame_html(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function wargame_json(mixed $value): string
{
    return (string) json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP);
}

function wargame_base64url_encode(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function wargame_base64url_decode(string $value): string|false
{
    $decoded = base64_decode(strtr($value, '-_', '+/') . str_repeat('=', (4 - strlen($value) % 4) % 4), true);
    return $decoded;
}
