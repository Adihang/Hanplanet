<?php
declare(strict_types=1);

require_once __DIR__ . '/../app/bootstrap.php';
require_once __DIR__ . '/../app/CampaignService.php';
require_once __DIR__ . '/../app/LabSessionService.php';
require_once __DIR__ . '/../app/MarkdownRenderer.php';

wargame_db();

function request_return_path(): string
{
    return wargame_return_path((string) ($_POST['return_to'] ?? '/'));
}

function mission_number(array $mission): string
{
    return str_pad((string) max(1, (int) (($mission['order'] ?? 10) / 10)), 2, '0', STR_PAD_LEFT);
}

function mission_client(array $mission): string
{
    $client = $mission['client'] ?? '비공개 의뢰인';
    return is_array($client) ? (string) ($client['name'] ?? '비공개 의뢰인') : (string) $client;
}

function text_prefix(string $value, int $length, string $fallback = ''): string
{
    $value = trim($value);
    if ($value === '') {
        return $fallback;
    }

    $length = max(1, $length);
    if (function_exists('mb_substr')) {
        $prefix = mb_substr($value, 0, $length, 'UTF-8');
    } elseif (preg_match_all('/./us', $value, $matches) !== false && !empty($matches[0])) {
        $prefix = implode('', array_slice($matches[0], 0, $length));
    } else {
        $prefix = substr($value, 0, $length);
    }

    $prefix = is_string($prefix) ? trim($prefix) : '';
    return $prefix !== '' ? $prefix : $fallback;
}

function account_initial(string $value, string $fallback = 'OP'): string
{
    $initial = text_prefix($value, 1, $fallback);
    return preg_match('/\A[A-Za-z]\z/', $initial) === 1 ? strtoupper($initial) : $initial;
}

function dispatch_notice(array $dispatch): string
{
    return match ((string) ($dispatch['status'] ?? 'failed')) {
        'sent' => '등록된 이메일로 보안 의뢰서를 전송했습니다.',
        'preview' => '의뢰가 시작되었습니다. 현재 메일 전송은 개발 미리보기 모드입니다.',
        default => '의뢰는 활성화됐지만 이메일 전송에 실패했습니다. 작전 화면에서 다시 보낼 수 있습니다.',
    };
}

$isFetch = strtolower((string) ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '')) === 'fetch'
    || str_contains(strtolower((string) ($_SERVER['HTTP_ACCEPT'] ?? '')), 'application/json');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = (string) ($_POST['action'] ?? '');
    try {
        if ($action === 'connect_account') {
            require_csrf();
            $connected = accept_django_token((string) ($_POST['django_token'] ?? ''));
            if ($isFetch) {
                header('Content-Type: application/json; charset=utf-8');
                header('Cache-Control: no-store');
                echo wargame_json(['authenticated' => true, 'display_name' => $connected['display_name']]);
                exit;
            }
            flash_message('success', 'Hanplanet 계정을 안전하게 연결했습니다.');
            redirect_to(request_return_path());
        }

        if ($action === 'logout_portal') {
            require_csrf();
            forget_django_user();
            flash_message('success', '이 브라우저의 Wargame 연결을 해제했습니다.');
            redirect_to('/');
        }

        $completionTicket = '';
        if ($action === 'claim_completion') {
            $completionTicket = (string) ($_POST['ticket'] ?? ($_SESSION['pending_completion_ticket'] ?? ''));
            $handoffToken = (string) ($_POST['handoff_token'] ?? '');
            if ($handoffToken !== '') {
                LabSessionService::requireCompletionHandoff($completionTicket, $handoffToken);
            } else {
                // Recovery from the portal uses its ordinary session CSRF token.
                // The target page cannot read the portal session, so its first
                // handoff uses the separately signed, ticket-bound token above.
                require_csrf();
            }
        }

        $user = current_django_user();
        if (!is_array($user)) {
            if ($action === 'claim_completion' && preg_match('/^[a-f0-9]{64}$/', $completionTicket)) {
                $_SESSION['pending_completion_ticket'] = $completionTicket;
                flash_message('error', '완료 기록을 저장하려면 Hanplanet 계정을 다시 연결해 주세요. 증표는 잠시 보관했습니다.');
                redirect_to('/');
            }
            throw new RuntimeException('Hanplanet 로그인이 필요합니다.');
        }

        $progress = wargame_progress((array) $user['solves']);
        $ownerKey = wargame_owner_key($user);
        $hasStartedCampaign = campaign_started($ownerKey) || (int) $progress['completed'] > 0;
        if ($action === 'start_campaign') {
            require_csrf();
            $firstMission = array_values(wargame_missions())[0] ?? null;
            if (!is_array($firstMission)) {
                throw new RuntimeException('시작할 의뢰가 없습니다.');
            }
            $dispatch = CampaignService::dispatchMission($user, $firstMission, 'campaign_start');
            flash_message((string) $dispatch['status'] === 'failed' ? 'error' : 'success', dispatch_notice($dispatch));
            redirect_to('/?mission=' . rawurlencode((string) $firstMission['id']));
        }

        if ($action === 'resend_mission') {
            require_csrf();
            if (!$hasStartedCampaign) {
                throw new InvalidArgumentException('먼저 게임을 시작해 첫 의뢰를 수신해 주세요.');
            }
            $missionId = (string) ($_POST['mission_id'] ?? '');
            $mission = wargame_mission($missionId);
            if (!is_array($mission) || (($progress['states'][$missionId] ?? 'locked') === 'locked')) {
                throw new InvalidArgumentException('아직 수신할 수 없는 의뢰입니다.');
            }
            $dispatch = CampaignService::dispatchMission($user, $mission, 'manual_retry', true);
            flash_message((string) $dispatch['status'] === 'failed' ? 'error' : 'success', dispatch_notice($dispatch));
            redirect_to('/?mission=' . rawurlencode($missionId));
        }

        if ($action === 'launch_lab') {
            require_csrf();
            if (!$hasStartedCampaign) {
                throw new InvalidArgumentException('먼저 게임을 시작해 등록 이메일로 첫 의뢰를 수신해 주세요.');
            }
            $missionId = (string) ($_POST['mission_id'] ?? '');
            $state = (string) ($progress['states'][$missionId] ?? 'locked');
            if ($state === 'locked' || wargame_mission($missionId) === null) {
                throw new InvalidArgumentException('선행 의뢰를 먼저 완료해야 합니다.');
            }
            LabSessionService::launchFor($user, $missionId);
            redirect_to(LabSessionService::targetEntryPath($missionId));
        }

        if ($action === 'claim_completion') {
            $handoff = CampaignService::completeAndDispatch($user, $completionTicket);
            unset($_SESSION['pending_completion_ticket']);
            $nextMission = $handoff['next_mission'];
            if (is_array($nextMission)) {
                $dispatch = (array) ($handoff['dispatch'] ?? []);
                $mailSuffix = (string) $dispatch['status'] === 'sent'
                    ? ' 다음 의뢰를 이메일로 전송했습니다.'
                    : ((string) $dispatch['status'] === 'preview' ? ' 다음 의뢰가 미리보기 모드로 등록되었습니다.' : ' 다음 의뢰 이메일은 전송에 실패해 화면에서 다시 보낼 수 있습니다.');
                flash_message('success', '의뢰 완료가 계정에 기록되었습니다.' . $mailSuffix);
                redirect_to('/?mission=' . rawurlencode((string) $nextMission['id']));
            }
            flash_message('success', '모든 FIELD//OPS 의뢰를 완료했습니다. 최종 작전 보고서가 계정에 기록되었습니다.');
            redirect_to('/');
        }

        throw new InvalidArgumentException('알 수 없는 작업입니다.');
    } catch (Throwable $exception) {
        if ($isFetch) {
            http_response_code(400);
            header('Content-Type: application/json; charset=utf-8');
            header('Cache-Control: no-store');
            echo wargame_json(['authenticated' => false, 'error' => $exception->getMessage()]);
            exit;
        }
        flash_message('error', $exception->getMessage());
        redirect_to(request_return_path());
    }
}

wargame_portal_headers();
$user = current_django_user();
$missions = wargame_missions();
$curriculum = wargame_curriculum();
$progress = wargame_progress(is_array($user) ? (array) $user['solves'] : []);
$ownerKey = is_array($user) ? wargame_owner_key($user) : '';
$dispatches = $ownerKey !== '' ? CampaignService::dispatchesFor($ownerKey) : [];
$campaignStarted = is_array($user) && (campaign_started($ownerKey) || (int) $progress['completed'] > 0);
$selectedMissionId = (string) ($_GET['mission'] ?? '');
$selectedMission = $selectedMissionId !== '' ? wargame_mission($selectedMissionId) : null;
$selectedState = is_array($selectedMission) ? (string) ($progress['states'][$selectedMissionId] ?? 'locked') : '';
$autoLaunchRequested = is_array($selectedMission) && (string) ($_GET['launch'] ?? '') === '1';
$currentMission = $progress['current_id'] ? wargame_mission((string) $progress['current_id']) : null;
$flash = take_flash_message();
$pendingTicket = (string) ($_SESSION['pending_completion_ticket'] ?? '');
$cssVersion = (string) (filemtime(__DIR__ . '/assets/wargame.css') ?: time());
$themeVersion = (string) (filemtime(__DIR__ . '/assets/theme.js') ?: time());
$jsVersion = (string) (filemtime(__DIR__ . '/assets/portal.js') ?: time());
$faviconVersion = (string) (filemtime(__DIR__ . '/assets/favicon.ico') ?: time());
$loginUrl = is_array($user) ? '' : wargame_oidc_login_url(wargame_return_path());
$initial = is_array($user) ? account_initial((string) ($user['display_name'] ?: $user['username'])) : 'OP';
$profileImageUrl = is_array($user) ? trim((string) ($user['profile_image_url'] ?? '')) : '';
$djangoHomeUrl = django_base_url() . '/';
$djangoSiteIconUrl = django_base_url() . '/static/media/icons/favicon-192.png';
$metaTitle = 'Hanplanet Wargame';
$metaDescription = '실전 의뢰를 수행하며 웹 보안의 원리와 공격·방어 과정을 익히는 Hanplanet Wargame 학습 플랫폼';
$metaImage = 'https://wargame.hanplanet.com/assets/operations-map.svg';
?>
<!doctype html>
<html lang="ko" data-theme="dark">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="<?= wargame_html($metaDescription) ?>">
    <meta name="hanplanet:sub-category" content="game">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="wargame.hanplanet.com">
    <meta property="og:url" content="https://wargame.hanplanet.com/">
    <meta property="og:title" content="<?= wargame_html($metaTitle) ?>">
    <meta property="og:description" content="<?= wargame_html($metaDescription) ?>">
    <meta property="og:image" content="<?= wargame_html($metaImage) ?>">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="<?= wargame_html($metaTitle) ?>">
    <meta name="twitter:description" content="<?= wargame_html($metaDescription) ?>">
    <meta name="twitter:image" content="<?= wargame_html($metaImage) ?>">
    <meta name="csrf-token" content="<?= wargame_html(csrf_token()) ?>">
    <title><?= is_array($selectedMission) ? wargame_html((string) $selectedMission['title']) . ' · ' : '' ?>FIELD//OPS Wargame</title>
    <link rel="icon" href="/assets/favicon.ico?v=<?= wargame_html($faviconVersion) ?>">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&family=Noto+Sans+KR:wght@100..900&display=swap" rel="stylesheet">
    <script src="/assets/theme.js?v=<?= wargame_html($themeVersion) ?>"></script>
    <link rel="stylesheet" href="/assets/wargame.css?v=<?= wargame_html($cssVersion) ?>">
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.3/dist/mermaid.min.js" integrity="sha384-R63zfMfSwJF4xCR11wXii+QUsbiBIdiDzDbtxia72oGWfkT7WHJfmD/I/eeHPJyT" crossorigin="anonymous" defer></script>
    <script src="/assets/portal.js?v=<?= wargame_html($jsVersion) ?>" defer></script>
</head>
<body
    data-authenticated="<?= is_array($user) ? '1' : '0' ?>"
    data-auto-launch="<?= $autoLaunchRequested ? '1' : '0' ?>"
    data-login-url="<?= wargame_html($loginUrl) ?>"
>
    <a class="skip-link" href="#main-content">본문으로 이동</a>
    <header class="site-header">
        <div class="header-inner">
            <div class="brand" aria-label="브랜드 링크">
                <a class="brand-mark-link" href="<?= wargame_html($djangoHomeUrl) ?>" aria-label="Hanplanet 홈">
                    <img class="brand-mark" src="<?= wargame_html($djangoSiteIconUrl) ?>" alt="" width="38" height="38" decoding="async">
                </a>
                <a class="brand-copy" href="/" aria-label="FIELD OPS Wargame 홈"><strong>FIELD//OPS</strong><span>WARGAME ACADEMY</span></a>
            </div>
            <nav class="main-nav" aria-label="주요 메뉴">
                <a href="/#operations">작전 현황</a>
                <a href="/#curriculum">학습 경로</a>
                <a href="/#safety">안전 수칙</a>
                <a href="https://www.hanplanet.com/" rel="noopener">Hanplanet</a>
            </nav>
            <div class="header-tools">
                <button class="theme-toggle" type="button" data-theme-toggle aria-label="화면 테마 전환">◐</button>
                <?php if (is_array($user)): ?>
                    <div class="account-menu">
                        <button
                            class="account-chip"
                            type="button"
                            data-account-menu-trigger
                        aria-expanded="false"
                        aria-controls="wargame-account-menu"
                    >
                            <?php if ($profileImageUrl !== ''): ?>
                                <img class="account-avatar" src="<?= wargame_html($profileImageUrl) ?>" alt="" loading="lazy">
                            <?php else: ?>
                                <span class="account-avatar"><?= wargame_html($initial) ?></span>
                            <?php endif; ?>
                            <span class="account-copy"><strong><?= wargame_html((string) $user['display_name']) ?></strong><small>ACCOUNT LINKED</small></span>
                        </button>
                        <section id="wargame-account-menu" class="account-menu-popup" data-account-menu hidden aria-label="연결된 Hanplanet 계정">
                            <div class="account-menu-profile">
                                <?php if ($profileImageUrl !== ''): ?>
                                    <img class="account-menu-avatar" src="<?= wargame_html($profileImageUrl) ?>" alt="" loading="lazy">
                                <?php else: ?>
                                    <span class="account-menu-avatar" aria-hidden="true"><?= wargame_html($initial) ?></span>
                                <?php endif; ?>
                                <strong><?= wargame_html((string) $user['display_name']) ?></strong>
                                <span><?= wargame_html((string) ($user['email'] ?: $user['username'])) ?></span>
                                <small>HANPLANET ACCOUNT LINKED</small>
                            </div>
                            <form class="account-menu-actions" method="post">
                                <input type="hidden" name="csrf_token" value="<?= wargame_html(csrf_token()) ?>">
                                <input type="hidden" name="action" value="logout_portal">
                                <button type="submit">Wargame 연결 해제</button>
                            </form>
                        </section>
                    </div>
                <?php else: ?>
                    <a class="account-chip" href="<?= wargame_html($loginUrl) ?>">
                        <span class="account-avatar">OP</span>
                        <span class="account-copy"><strong data-account-bridge>Hanplanet 로그인</strong><small>SECURE ACCOUNT LINK</small></span>
                    </a>
                <?php endif; ?>
            </div>
        </div>
    </header>

    <main id="main-content" class="page-shell">
        <?php if (is_array($flash)): ?>
            <div class="flash <?= ($flash['type'] ?? '') === 'error' ? 'error' : '' ?>" role="status">
                <?= wargame_html((string) ($flash['message'] ?? '')) ?>
            </div>
        <?php endif; ?>

        <?php if ($pendingTicket !== '' && is_array($user)): ?>
            <section class="ticket-panel" aria-labelledby="pending-title">
                <span class="eyebrow">VERIFIED EVIDENCE</span>
                <h2 id="pending-title">완료 증표가 대기 중입니다</h2>
                <p>재연결된 Hanplanet 계정에 방금 완료한 의뢰를 기록합니다.</p>
                <form method="post" data-loading-form>
                    <input type="hidden" name="csrf_token" value="<?= wargame_html(csrf_token()) ?>">
                    <input type="hidden" name="action" value="claim_completion">
                    <input type="hidden" name="ticket" value="<?= wargame_html($pendingTicket) ?>">
                    <button class="button" type="submit" data-loading-label="검증 중…">완료 기록 복구</button>
                </form>
            </section>
        <?php endif; ?>

        <?php if (is_array($selectedMission)): ?>
            <?php
                $lesson = (array) ($selectedMission['lesson'] ?? []);
                $target = (array) ($selectedMission['target'] ?? []);
                $markdown = wargame_mission_markdown($selectedMission);
                $selectedDispatch = $dispatches[$selectedMissionId] ?? null;
                $diagram = (string) ($lesson['diagram'] ?? '');
                $diagramId = str_starts_with($diagram, '/assets/lessons/') ? pathinfo($diagram, PATHINFO_FILENAME) : '';
                $targetAddress = wargame_public_origin() . LabSessionService::targetEntryPath($selectedMissionId);
            ?>
            <article class="mission-page">
                <a class="back-link" href="/#curriculum">← 전체 학습 경로</a>
                <header class="mission-hero">
                    <span class="case-id">CASE <?= wargame_html(mission_number($selectedMission)) ?> · <?= wargame_html(strtoupper((string) ($selectedMission['difficulty'] ?? ''))) ?></span>
                    <h1><?= wargame_html((string) $selectedMission['title']) ?></h1>
                    <p><?= wargame_html((string) ($selectedMission['brief'] ?? '')) ?></p>
                    <div class="mission-facts">
                        <div class="fact"><span>CLIENT</span><strong><?= wargame_html(mission_client($selectedMission)) ?></strong></div>
                        <div class="fact"><span>TARGET SERVICE</span><strong><?= wargame_html((string) ($target['service_name'] ?? 'Assessment target')) ?></strong></div>
                        <div class="fact"><span>TARGET ADDRESS</span><strong><?= wargame_html($targetAddress) ?></strong></div>
                        <div class="fact"><span>ESTIMATED TIME</span><strong><?= (int) ($selectedMission['minutes'] ?? 30) ?> MIN</strong></div>
                    </div>
                </header>

                <div class="lesson-grid section">
                    <section class="lesson-card lesson-card-half lesson-card-markdown">
                        <span class="panel-label">CLIENT DOSSIER</span>
                        <div class="wargame-markdown"><?= wargame_markdown_render((string) $markdown['dossier']) ?></div>
                        <?php if (is_array($selectedDispatch)): ?>
                            <div class="button-row">
                                <span class="status-pill <?= wargame_html((string) $selectedDispatch['status']) ?>">MAIL <?= wargame_html((string) $selectedDispatch['status']) ?></span>
                                <span class="surface-pill"><?= wargame_html(CampaignService::maskedEmail((string) ($user['email'] ?? ''))) ?></span>
                            </div>
                        <?php endif; ?>
                    </section>

                    <section class="lesson-card lesson-card-half lesson-card-markdown">
                        <span class="panel-label">MISSION OBJECTIVE</span>
                        <div class="wargame-markdown"><?= wargame_markdown_render((string) $markdown['objective']) ?></div>
                    </section>

                    <section class="lesson-card lesson-card-full lesson-card-markdown">
                        <span class="panel-label">TECHNICAL BRIEFING</span>
                        <div class="wargame-markdown"><?= wargame_markdown_render((string) $markdown['technical_intro']) ?></div>
                        <?php if ($diagramId !== ''): ?>
                            <div class="diagram-frame wargame-mermaid" data-wargame-mermaid="<?= wargame_html($diagramId) ?>" role="img" aria-label="<?= wargame_html((string) $selectedMission['title']) ?> 기술 흐름도">
                                <span class="wargame-mermaid-fallback">기술 흐름도를 불러오는 중입니다.</span>
                            </div>
                        <?php endif; ?>
                        <?php if ((string) $markdown['technical_details'] !== ''): ?>
                            <div class="wargame-markdown wargame-markdown-details"><?= wargame_markdown_render((string) $markdown['technical_details']) ?></div>
                        <?php endif; ?>
                    </section>

                    <section class="lesson-card lesson-card-half lesson-card-markdown">
                        <span class="panel-label">FIELD REFERENCES</span>
                        <div class="wargame-markdown"><?= wargame_markdown_render((string) $markdown['resources']) ?></div>
                    </section>

                    <section class="lesson-card lesson-card-half lesson-card-markdown">
                        <span class="panel-label">PROGRESSIVE HINTS</span>
                        <div class="wargame-markdown"><?= wargame_markdown_render((string) $markdown['hints_intro']) ?></div>
                        <div class="hint-stack">
                            <?php foreach ((array) ($selectedMission['hints'] ?? []) as $hint): ?>
                                <details>
                                    <summary>힌트 <?= (int) ($hint['level'] ?? 1) ?> · <?= wargame_html((string) ($hint['title'] ?? '단서')) ?></summary>
                                    <div class="wargame-markdown wargame-markdown-hint"><?= wargame_markdown_render((string) ($hint['body'] ?? '')) ?></div>
                                </details>
                            <?php endforeach; ?>
                        </div>
                    </section>
                </div>

                <section class="launch-panel">
                    <div>
                        <h3><?= $selectedState === 'locked' ? '선행 의뢰가 잠겨 있습니다' : '검증 타깃 접속 준비 완료' ?></h3>
                        <p><?= $selectedState === 'locked' ? '이전 단계를 완료하면 자동으로 의뢰 메일과 실습 환경이 열립니다.' : '타깃은 실제 HTTP 요청을 처리하며, 데이터는 이 계정의 임시 instance 안에서 2시간 뒤 폐기됩니다.' ?></p>
                    </div>
                    <?php if (!is_array($user)): ?>
                        <a class="button" href="<?= wargame_html($loginUrl) ?>">로그인 후 실습</a>
                    <?php elseif (!$campaignStarted): ?>
                        <form method="post" data-loading-form>
                            <input type="hidden" name="csrf_token" value="<?= wargame_html(csrf_token()) ?>">
                            <input type="hidden" name="action" value="start_campaign">
                            <button class="button" type="submit" data-loading-label="첫 의뢰 준비 중…">첫 의뢰를 이메일로 수신하기</button>
                        </form>
                    <?php elseif ($selectedState === 'locked'): ?>
                        <span class="button secondary" aria-disabled="true">LOCKED</span>
                    <?php else: ?>
                        <div class="button-row">
                            <form method="post" data-loading-form <?= $autoLaunchRequested && $campaignStarted ? 'data-email-target-launch' : '' ?>>
                                <input type="hidden" name="csrf_token" value="<?= wargame_html(csrf_token()) ?>">
                                <input type="hidden" name="action" value="launch_lab">
                                <input type="hidden" name="mission_id" value="<?= wargame_html($selectedMissionId) ?>">
                                <input type="hidden" name="return_to" value="/?mission=<?= wargame_html(rawurlencode($selectedMissionId)) ?>">
                                <button class="button" type="submit" data-loading-label="타깃 연결 중…"><?= $selectedState === 'completed' ? '다시 점검하기' : '타깃 사이트 접속' ?> ↗</button>
                            </form>
                            <form method="post" data-loading-form>
                                <input type="hidden" name="csrf_token" value="<?= wargame_html(csrf_token()) ?>">
                                <input type="hidden" name="action" value="resend_mission">
                                <input type="hidden" name="mission_id" value="<?= wargame_html($selectedMissionId) ?>">
                                <input type="hidden" name="return_to" value="/?mission=<?= wargame_html(rawurlencode($selectedMissionId)) ?>">
                                <button class="button ghost" type="submit" data-loading-label="전송 중…">의뢰 메일 다시 보내기</button>
                            </form>
                        </div>
                    <?php endif; ?>
                </section>
            </article>
        <?php else: ?>
            <section class="hero" aria-labelledby="hero-title">
                <div>
                    <span class="eyebrow">ISOLATED RANGE · LIVE TRAINING</span>
                    <?php if (is_array($user) && $campaignStarted): ?>
                        <h1 id="hero-title">환영합니다,<br><span><?= wargame_html((string) $user['display_name']) ?></span> 오퍼레이터.</h1>
                        <p class="hero-lead">현재 의뢰의 기술 브리핑을 읽고 타깃의 실제 HTTP 요청·응답을 직접 조사하세요. 성공 증거가 검증되면 다음 의뢰가 등록 이메일로 전달됩니다.</p>
                        <div class="hero-actions">
                            <?php if (is_array($currentMission)): ?><a class="button" href="/?mission=<?= wargame_html(rawurlencode((string) $currentMission['id'])) ?>">현재 의뢰 계속하기</a><?php endif; ?>
                            <a class="button secondary" href="#curriculum">전체 경로 보기</a>
                        </div>
                    <?php else: ?>
                        <h1 id="hero-title">읽고, 추론하고,<br><span>직접 침투하라.</span></h1>
                        <p class="hero-lead">가상의 의뢰인이 보낸 보안 진단을 수행하며 HTTP부터 인젝션, 서버 경계, 연쇄 공격까지 단계적으로 익히는 실전형 웹 보안 아카데미입니다.</p>
                        <div class="hero-actions">
                            <?php if (is_array($user)): ?>
                                <form method="post" data-loading-form>
                                    <input type="hidden" name="csrf_token" value="<?= wargame_html(csrf_token()) ?>">
                                    <input type="hidden" name="action" value="start_campaign">
                                    <button class="button" type="submit" data-loading-label="첫 의뢰 준비 중…">첫 의뢰 수신하기</button>
                                </form>
                            <?php else: ?>
                                <a class="button" href="<?= wargame_html($loginUrl) ?>">Hanplanet 계정으로 시작</a>
                            <?php endif; ?>
                            <a class="button secondary" href="#how-it-works">훈련 방식 살펴보기</a>
                        </div>
                    <?php endif; ?>
                    <div class="stat-strip">
                        <div class="stat"><strong>11</strong><span>점진적 보안 의뢰</span></div>
                        <div class="stat"><strong>4</strong><span>핵심 학습 모듈</span></div>
                        <div class="stat"><strong>0</strong><span>실제 외부 공격 트래픽</span></div>
                    </div>
                </div>
                <div class="hero-visual" aria-hidden="true">
                    <div class="range-frame">
                        <div class="operations-diagram wargame-mermaid" data-wargame-mermaid="operations">
                            <span class="wargame-mermaid-fallback">격리된 훈련 환경을 불러오는 중입니다.</span>
                        </div>
                        <span class="range-status">RANGE ISOLATED</span>
                    </div>
                </div>
            </section>

            <?php if (is_array($user) && $campaignStarted): ?>
                <section id="operations" class="section">
                    <div class="section-heading">
                        <div><span class="kicker">OPERATIONS DESK</span><h2>현재 작전 현황</h2></div>
                        <p>계정 진행 기록과 실습 완료 증거가 일치할 때만 다음 의뢰가 열립니다.</p>
                    </div>
                    <div class="command-grid">
                        <article class="command-card command-primary">
                            <?php if (is_array($currentMission)): ?>
                                <span class="case-id">ACTIVE CASE <?= wargame_html(mission_number($currentMission)) ?></span>
                                <h2><?= wargame_html((string) $currentMission['title']) ?></h2>
                                <p><?= wargame_html((string) ($currentMission['brief'] ?? '')) ?></p>
                                <div class="client-line">
                                    <div><strong><?= wargame_html(mission_client($currentMission)) ?></strong><span>VERIFIED TRAINING CLIENT</span></div>
                                </div>
                                <a class="button" href="/?mission=<?= wargame_html(rawurlencode((string) $currentMission['id'])) ?>">브리핑 열기 →</a>
                            <?php else: ?>
                                <span class="case-id">CAMPAIGN COMPLETE</span>
                                <h2>모든 작전을 완료했습니다</h2>
                                <p>11개 의뢰의 증거가 계정에 기록되었습니다. 완료한 실습은 언제든 다시 실행할 수 있습니다.</p>
                                <a class="button" href="#curriculum">완료 기록 보기</a>
                            <?php endif; ?>
                        </article>
                        <div class="command-side">
                            <article class="command-card progress-card">
                                <div class="progress-top"><div><span class="panel-label">FIELD READINESS</span><h3>전체 진척도</h3></div><strong><?= (int) $progress['percent'] ?>%</strong></div>
                                <progress value="<?= (int) $progress['completed'] ?>" max="<?= max(1, (int) $progress['total']) ?>"><?= (int) $progress['percent'] ?>%</progress>
                                <p><?= (int) $progress['completed'] ?> / <?= (int) $progress['total'] ?> 의뢰 완료</p>
                            </article>
                            <article class="mail-card">
                                <div class="mail-meta">
                                    <span class="panel-label">SECURE DISPATCH</span>
                                    <h3>의뢰 수신함</h3>
                                    <strong><?= wargame_html(CampaignService::maskedEmail((string) $user['email'])) ?></strong>
                                    <span><?= count($dispatches) ?> MISSION DISPATCHES</span>
                                </div>
                            </article>
                        </div>
                    </div>
                </section>
            <?php endif; ?>

            <section id="how-it-works" class="section">
                <div class="section-heading">
                    <div><span class="kicker">TRAINING PROTOCOL</span><h2>하나의 의뢰가 실력이 되는 과정</h2></div>
                    <p>공격 문자열을 외우는 대신 관찰 → 가설 → 검증 → 방어의 순서로 반복합니다.</p>
                </div>
                <div class="onboarding-grid">
                    <article class="card onboarding-card"><span class="step-number">01</span><h3>의뢰 메일 수신</h3><p>등록 이메일로 스토리, 허가 범위, 타깃 정보와 명확한 목표가 담긴 의뢰서가 전달됩니다.</p></article>
                    <article class="card onboarding-card"><span class="step-number">02</span><h3>기술 브리핑 학습</h3><p>Mermaid 흐름도, 취약/안전 비교표, 실제 요청 예시와 공식 참고 자료로 원리를 먼저 이해합니다.</p></article>
                    <article class="card onboarding-card"><span class="step-number">03</span><h3>격리 타깃 침투</h3><p>운영 사이트처럼 동작하는 독립 타깃에 직접 HTTP 요청을 보내 증거를 확보하면 다음 의뢰가 자동으로 열립니다.</p></article>
                </div>
            </section>

            <section id="curriculum" class="section">
                <div class="section-heading">
                    <div><span class="kicker">LEARNING PATH</span><h2>11단계 현장 커리큘럼</h2></div>
                    <p>기초 프로토콜에서 복합 공격 경로까지, 앞 단계에서 얻은 사고법을 다음 의뢰가 이어받습니다.</p>
                </div>
                <div class="module-list">
                    <?php foreach ((array) ($curriculum['modules'] ?? []) as $moduleId => $module): ?>
                        <?php $moduleMissions = array_filter($missions, static fn(array $mission): bool => (string) ($mission['module'] ?? '') === (string) $moduleId); ?>
                        <article class="module-card">
                            <header class="module-summary">
                                <span class="module-index">MODULE <?= wargame_html((string) ($module['number'] ?? '')) ?></span>
                                <h3><?= wargame_html((string) ($module['title'] ?? '')) ?></h3>
                                <p><?= wargame_html((string) ($module['description'] ?? '')) ?></p>
                            </header>
                            <div class="mission-list">
                                <?php foreach ($moduleMissions as $missionId => $mission): ?>
                                    <?php $state = is_array($user) ? (string) ($progress['states'][$missionId] ?? 'locked') : 'available'; ?>
                                    <a class="mission-row <?= wargame_html($state) ?> <?= $progress['current_id'] === $missionId ? 'current' : '' ?>" href="/?mission=<?= wargame_html(rawurlencode((string) $missionId)) ?>">
                                        <span class="mission-node"><?= $state === 'completed' ? '✓' : wargame_html(mission_number($mission)) ?></span>
                                        <span class="mission-copy"><strong><?= wargame_html((string) $mission['title']) ?></strong><span><?= wargame_html(mission_client($mission)) ?> · <?= (int) ($mission['minutes'] ?? 30) ?>분</span></span>
                                        <span class="mission-meta"><span class="difficulty"><?= wargame_html((string) ($mission['difficulty'] ?? '')) ?></span><span class="status-pill <?= wargame_html($state) ?>"><?= wargame_html($state) ?></span></span>
                                    </a>
                                <?php endforeach; ?>
                            </div>
                        </article>
                    <?php endforeach; ?>
                </div>
            </section>

            <section id="safety" class="section">
                <div class="section-heading"><div><span class="kicker">RULES OF ENGAGEMENT</span><h2>훈련 범위와 안전 경계</h2></div></div>
                <div class="safety-banner">
                    <strong>AUTHORIZED RANGE ONLY</strong>
                    <span>모든 실습은 Hanplanet Wargame이 발급한 임시 instance에만 허가됩니다. 실제 도메인, 타인의 계정, 외부 네트워크에는 동일한 기법을 시도하지 마세요. SQL과 파일은 개인별 격리 저장소에서만 처리되며, 서버 측 URL 검증도 승인된 고정 내부 서비스 맵 밖으로 연결되지 않습니다.</span>
                </div>
            </section>
        <?php endif; ?>
    </main>

    <footer class="site-footer">
        <div class="site-footer-inner">
            <span>FIELD//OPS · HANPLANET WARGAME · CURRICULUM <?= wargame_html(WARGAME_CURRICULUM_VERSION) ?></span>
            <span class="footer-links"><a href="https://www.hanplanet.com/">HANPLANET</a><a href="/#safety">SCOPE</a></span>
        </div>
    </footer>
</body>
</html>
