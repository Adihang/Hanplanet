<?php
declare(strict_types=1);

require_once __DIR__ . '/../app/bootstrap.php';
require_once __DIR__ . '/../app/LabSessionService.php';

/** @param list<string> $instanceIds @param list<string> $sessionIds */
function cleanup_browser_fixtures(array $instanceIds, array $sessionIds): void
{
    $base = realpath(WARGAME_INSTANCE_DIR);
    foreach ($instanceIds as $instanceId) {
        if (!is_string($instanceId) || preg_match('/^[a-f0-9]{32}$/', $instanceId) !== 1) {
            continue;
        }
        wargame_db()->prepare('DELETE FROM lab_instances WHERE id = :id')->execute(['id' => $instanceId]);
        $path = realpath(WARGAME_INSTANCE_DIR . '/' . $instanceId);
        if ($base === false || $path === false || !str_starts_with($path, $base . DIRECTORY_SEPARATOR)) {
            continue;
        }
        $items = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST,
        );
        foreach ($items as $item) {
            if ($item->isFile() || $item->isLink()) {
                @unlink($item->getPathname());
            } elseif ($item->isDir()) {
                @rmdir($item->getPathname());
            }
        }
        @rmdir($path);
    }
    foreach ($sessionIds as $sessionId) {
        if (is_string($sessionId) && preg_match('/^[A-Za-z0-9,-]{16,128}$/', $sessionId) === 1) {
            @unlink(WARGAME_SESSION_DIR . '/sess_' . $sessionId);
        }
    }
}

if (($argv[1] ?? '') === '--cleanup') {
    $payload = json_decode((string) ($argv[2] ?? '{}'), true);
    cleanup_browser_fixtures(
        array_values(array_filter((array) ($payload['instances'] ?? []), 'is_string')),
        array_values(array_filter((array) ($payload['sessions'] ?? []), 'is_string')),
    );
    echo "clean\n";
    exit;
}

$user = [
    'user_id' => '910001',
    'username' => 'codex_test',
    'display_name' => 'Codex Test',
    'email' => 'codex_test@example.invalid',
    'solves' => [],
];
$targets = [];
foreach (wargame_missions() as $missionId => $_mission) {
    LabSessionService::launchFor($user, $missionId);
    $active = (array) ($_SESSION['active_targets'][$missionId] ?? []);
    $instanceId = (string) ($active['id'] ?? '');
    $token = (string) ($active['token'] ?? '');
    if (preg_match('/^[a-f0-9]{32}$/', $instanceId) !== 1 || preg_match('/^[a-f0-9]{64}$/', $token) !== 1) {
        throw new RuntimeException('Unable to seed target context for ' . $missionId);
    }
    $targets[$missionId] = [
        'instance_id' => $instanceId,
        'cookie' => $instanceId . '.' . $token,
        'cookie_path' => LabSessionService::targetBasePath($missionId) . '/',
        'entry_path' => LabSessionService::targetEntryPath($missionId),
    ];
}

$seedSessionId = session_id();
session_write_close();
@unlink(WARGAME_SESSION_DIR . '/sess_' . $seedSessionId);
echo json_encode(['targets' => $targets], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES) . "\n";
