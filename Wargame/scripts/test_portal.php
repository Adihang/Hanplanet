<?php
declare(strict_types=1);

putenv('WARGAME_MAIL_TRANSPORT=preview');
putenv('WARGAME_COMPLETION_SECRET=portal-test-secret');
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
$assert(str_starts_with($introHtml, '<h2>웹 해킹의 첫 단계') && !str_contains($introHtml, '�'), 'markdown preserves Korean headings');
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
$mail = MissionMailer::compose(
    ['username' => 'training-user', 'display_name' => '훈련 사용자'],
    $first,
);
$assert(str_contains((string) $mail['subject'], 'CASE 01'), 'mission subject');
$assert(str_contains((string) $mail['text'], (string) $first['story']), 'story in plain text');
$assert(str_contains((string) $mail['text'], (string) $first['target']['objective']), 'objective in plain text');
$assert(str_contains((string) $mail['html'], 'wargame.hanplanet.com'), 'portal link in HTML');

$delivery = MissionMailer::dispatch(
    'learner@example.com',
    ['username' => 'training-user', 'display_name' => '훈련 사용자'],
    $first,
);
$assert($delivery['status'] === 'preview', 'preview transport');
$assert($delivery['transport'] === 'preview', 'preview transport label');
$invalidDelivery = MissionMailer::dispatch("bad\naddress@example.com", [], $first);
$assert($invalidDelivery['status'] === 'failed', 'header injection address rejected');

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

$receipt = django_completion_payload('training-user', $ids[0], str_repeat('a', 64));
$assert(isset($receipt['receipt'], $receipt['timestamp'], $receipt['nonce']), 'signed receipt fields');
$message = implode("\n", [
    'training-user',
    $ids[0],
    str_repeat('a', 64),
    (string) $receipt['timestamp'],
    (string) $receipt['nonce'],
]);
$assert(
    hash_equals(hash_hmac('sha256', $message, 'portal-test-secret'), (string) $receipt['receipt']),
    'completion receipt signature'
);

$masked = CampaignService::maskedEmail('operator@example.com');
$assert(str_ends_with($masked, '@example.com') && !str_contains($masked, 'operator@'), 'email masking');
$assert(strlen(csrf_token()) === 64, 'CSRF token length');
$wargameCss = (string) file_get_contents(__DIR__ . '/../public/assets/wargame.css');
$assert(str_contains($wargameCss, 'font-family: "KakaoSmallFont"') && str_contains($wargameCss, 'font-family: var(--display)') && str_contains($wargameCss, '"Inter"'), 'Django-compatible Wargame font stack');
$assert(is_file(__DIR__ . '/../public/assets/fonts/kakao/KakaoSmallSans-Regular.ttf'), 'bundled Kakao font asset');
$themeBootstrap = (string) file_get_contents(__DIR__ . '/../public/assets/theme.js');
$assert(str_contains($themeBootstrap, "localStorage.getItem('wargame-theme')") && str_contains($themeBootstrap, 'document.documentElement.dataset.theme = theme'), 'theme applies before page styles');

$dispatchUser = [
    'username' => 'portal-test-' . bin2hex(random_bytes(5)),
    'display_name' => '포털 테스트',
    'email' => 'learner@example.com',
];
$dispatchOwner = wargame_owner_key($dispatchUser['username']);
$firstDispatch = CampaignService::dispatchMission($dispatchUser, $first, 'test');
$secondDispatch = CampaignService::dispatchMission($dispatchUser, $first, 'test');
$assert($firstDispatch['status'] === 'preview', 'campaign preview dispatch');
$assert($secondDispatch['id'] === $firstDispatch['id'], 'campaign dispatch idempotency');
$countDispatch = wargame_db()->prepare('SELECT COUNT(*) FROM mission_dispatches WHERE owner_key_hash = :owner');
$countDispatch->execute(['owner' => $dispatchOwner]);
$assert((int) $countDispatch->fetchColumn() === 1, 'one dispatch row');
wargame_db()->prepare('DELETE FROM mission_dispatches WHERE owner_key_hash = :owner')->execute(['owner' => $dispatchOwner]);

$sessionFile = WARGAME_SESSION_DIR . '/sess_' . session_id();
session_write_close();
@unlink($sessionFile);

echo "Portal services: {$assertions} assertions passed\n";
