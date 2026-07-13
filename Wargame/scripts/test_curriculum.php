<?php
declare(strict_types=1);

require_once __DIR__ . '/../app/runtime.php';
require_once __DIR__ . '/../app/labs/LabEngine.php';

$assertions = 0;
$assert = static function (bool $condition, string $message) use (&$assertions): void {
    $assertions++;
    if (!$condition) {
        throw new RuntimeException('Curriculum assertion failed: ' . $message);
    }
};

$curriculum = wargame_curriculum();
$missions = wargame_missions();
$expectedIds = LabEngine::stableIds();
$assert((string) ($curriculum['version'] ?? '') === WARGAME_CURRICULUM_VERSION, 'version');
$assert(count((array) ($curriculum['modules'] ?? [])) === 4, 'four modules');
$assert(array_keys($missions) === $expectedIds, 'stable IDs match lab engine order');
$assert(count($missions) === 11, 'eleven missions');

$previousId = null;
$events = [];
$assetRoot = realpath(WARGAME_ROOT . '/public/assets/lessons');
$assert(is_string($assetRoot), 'lesson asset directory exists');

foreach ($missions as $missionId => $mission) {
    $assert((string) ($mission['id'] ?? '') === $missionId, $missionId . ' key');
    $assert((int) ($mission['minutes'] ?? 0) >= 15, $missionId . ' duration');
    $assert(count((array) ($mission['objectives'] ?? [])) >= 2, $missionId . ' objectives');
    $assert(count((array) ($mission['hints'] ?? [])) === 3, $missionId . ' progressive hints');
    $assert(count((array) ($mission['resources'] ?? [])) >= 1, $missionId . ' resources');

    $prerequisites = array_values((array) ($mission['prerequisites'] ?? []));
    $assert(
        $previousId === null ? $prerequisites === [] : $prerequisites === [$previousId],
        $missionId . ' prerequisite chain'
    );
    $previousId = $missionId;

    $lesson = (array) ($mission['lesson'] ?? []);
    $assert(count((array) ($lesson['paragraphs'] ?? [])) >= 3, $missionId . ' lesson paragraphs');
    $assert(count((array) ($lesson['table']['rows'] ?? [])) >= 3, $missionId . ' comparison table');
    $assert(trim((string) ($lesson['code']['content'] ?? '')) !== '', $missionId . ' code example');

    $diagram = (string) ($lesson['diagram'] ?? '');
    $assert(str_starts_with($diagram, '/assets/lessons/'), $missionId . ' local diagram path');
    $diagramReal = realpath(WARGAME_ROOT . '/public' . $diagram);
    $assert(
        is_string($diagramReal) && is_string($assetRoot) && str_starts_with($diagramReal, $assetRoot . DIRECTORY_SEPARATOR),
        $missionId . ' diagram stays in lesson assets'
    );

    foreach ((array) ($mission['resources'] ?? []) as $resource) {
        $url = (string) ($resource['url'] ?? '');
        $assert(str_starts_with($url, 'https://'), $missionId . ' HTTPS resource');
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));
        $assert(
            in_array($host, ['developer.mozilla.org', 'portswigger.net', 'cheatsheetseries.owasp.org'], true),
            $missionId . ' authoritative resource host'
        );
    }

    $event = (string) ($mission['completion']['event'] ?? '');
    $assert($event !== '' && !isset($events[$event]), $missionId . ' unique completion event');
    $events[$event] = true;
}

echo 'Curriculum: ' . count($missions) . " missions, {$assertions} assertions passed\n";
