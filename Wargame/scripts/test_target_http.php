<?php
declare(strict_types=1);

require_once __DIR__ . '/../app/target_bootstrap.php';
require_once __DIR__ . '/../app/TargetSiteRenderer.php';

$assertions = 0;
$assert = static function (bool $condition, string $message) use (&$assertions): void {
    $assertions++;
    if (!$condition) {
        throw new RuntimeException('Target HTTP assertion failed: ' . $message);
    }
};

$originalServer = $_SERVER;
$originalGet = $_GET;
$originalPost = $_POST;
$originalFiles = $_FILES;
$originalCookies = $_COOKIE;
$uploadPath = null;
$instanceDirectories = [];

try {
    $_SERVER = [
        'REQUEST_URI' => '/aurora/discount/check?store=seongsu',
        'REQUEST_METHOD' => 'GET',
        'CONTENT_LENGTH' => '0',
        'HTTP_AUTHORIZATION' => 'Bearer integration-token',
    ];
    $_GET = ['store' => 'seongsu'];
    $_POST = [];
    $_FILES = [];
    $_COOKIE = [
        'wargame_portal' => 'must-not-enter-engine',
        'wargame_target' => 'must-not-enter-engine',
        'leaf_role' => 'eyJyb2xlIjoicmVhZGVyIn0',
    ];

    $request = target_http_request('aurora');
    $assert($request['method'] === 'GET', 'adapter preserves the real HTTP method');
    $assert($request['path'] === '/discount/check', 'adapter removes only the service route prefix');
    $assert(($request['query']['store'] ?? null) === 'seongsu', 'adapter preserves the real query string');
    $assert(($request['headers']['Authorization'] ?? null) === 'Bearer integration-token', 'adapter preserves Authorization');
    $assert(($request['headers']['Cookie'] ?? null) === 'leaf_role=eyJyb2xlIjoicmVhZGVyIn0', 'adapter exposes only the challenge role cookie');
    $assert(!str_contains((string) ($request['headers']['Cookie'] ?? ''), 'wargame_portal'), 'portal cookie never enters challenge input');
    $assert(!str_contains((string) ($request['headers']['Cookie'] ?? ''), 'wargame_target'), 'opaque instance cookie never enters challenge input');

    $_SERVER['REQUEST_URI'] = '/comet/login';
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_POST = ['username' => 'night.operator', 'password' => 'redacted'];
    $_GET = [];
    $formRequest = target_http_request('comet');
    $assert(($formRequest['body']['username'] ?? null) === 'night.operator', 'adapter preserves native form fields');
    $assert(($formRequest['body']['password'] ?? null) === 'redacted', 'adapter preserves native form values');

    $uploadPath = tempnam(WARGAME_DATA_DIR, 'target-upload-test-');
    if (!is_string($uploadPath) || file_put_contents($uploadPath, "LAB_UPLOAD_MARKER\n") === false) {
        throw new RuntimeException('Unable to create upload fixture.');
    }
    $_SERVER['REQUEST_URI'] = '/pixelpet/avatar';
    $_SERVER['CONTENT_LENGTH'] = (string) filesize($uploadPath);
    $_POST = [];
    $_FILES = [
        'file' => [
            'name' => 'avatar.php',
            'type' => 'image/png',
            'tmp_name' => $uploadPath,
            'error' => UPLOAD_ERR_OK,
            'size' => filesize($uploadPath),
        ],
    ];
    $uploadRequest = target_http_request('pixelpet');
    $assert(($uploadRequest['files']['file']['name'] ?? null) === 'avatar.php', 'adapter preserves multipart filename');
    $assert(($uploadRequest['files']['file']['type'] ?? null) === 'image/png', 'adapter preserves multipart content type');
    $assert(($uploadRequest['files']['file']['content'] ?? null) === "LAB_UPLOAD_MARKER\n", 'adapter reads multipart bytes');

    $mismatchRejected = false;
    try {
        target_http_request('aurora');
    } catch (InvalidArgumentException) {
        $mismatchRejected = true;
    }
    $assert($mismatchRejected, 'adapter rejects a request routed to the wrong service');

    foreach (wargame_missions() as $missionId => $mission) {
        $target = (array) ($mission['target'] ?? []);
        $entryUrl = (string) ($target['entry_url'] ?? '');
        $assert(LabSessionService::targetEntryPath($missionId) === $entryUrl, $missionId . ' curriculum and live route agree');

        $instanceDirectory = WARGAME_INSTANCE_DIR . '/' . bin2hex(random_bytes(16));
        if (!mkdir($instanceDirectory, 0700, true) && !is_dir($instanceDirectory)) {
            throw new RuntimeException('Unable to create renderer fixture.');
        }
        $instanceDirectories[] = $instanceDirectory;
        $engine = new LabEngine($instanceDirectory);
        $response = $engine->start($missionId);
        ob_start();
        TargetSiteRenderer::render($missionId, $response);
        $html = (string) ob_get_clean();

        $assert(str_starts_with($html, '<!doctype html>'), $missionId . ' renders a standalone document');
        $assert(str_contains($html, 'class="service-app'), $missionId . ' renders the service as the full page');
        $assert(str_contains($html, $entryUrl), $missionId . ' links its real entry route');
        foreach (['request_json', 'simulated-browser', 'target-shell', '개발자도구', '디버그 모드', 'SOC TERMINAL'] as $forbidden) {
            $assert(!str_contains($html, $forbidden), $missionId . ' excludes embedded training control ' . $forbidden);
        }
    }
} finally {
    $_SERVER = $originalServer;
    $_GET = $originalGet;
    $_POST = $originalPost;
    $_FILES = $originalFiles;
    $_COOKIE = $originalCookies;
    if (is_string($uploadPath)) {
        @unlink($uploadPath);
    }
    foreach ($instanceDirectories as $instanceDirectory) {
        $items = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($instanceDirectory, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST,
        );
        foreach ($items as $item) {
            if ($item->isFile() || $item->isLink()) {
                @unlink($item->getPathname());
            } elseif ($item->isDir()) {
                @rmdir($item->getPathname());
            }
        }
        @rmdir($instanceDirectory);
    }
}

echo "Target HTTP: {$assertions} assertions passed\n";
