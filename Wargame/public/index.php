<?php
declare(strict_types=1);

require __DIR__ . '/../app/bootstrap.php';

header('Content-Type: text/html; charset=utf-8');
header('Referrer-Policy: no-referrer');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'self'; img-src 'self' data: https://www.hanplanet.com; font-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://www.hanplanet.com; script-src 'self' 'unsafe-inline' https://www.hanplanet.com; connect-src 'self' https://www.hanplanet.com; base-uri 'none'; frame-ancestors 'none'");

db();
$notice = null;
$error = null;

try {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        require_csrf();
        $action = $_POST['action'] ?? '';

        if ($action === 'set_django_token') {
            $token = trim((string) ($_POST['django_token'] ?? ''));
            if ($token === '') {
                throw new InvalidArgumentException('Django 인증 토큰이 비어 있습니다.');
            }
            $_SESSION['django_token'] = $token;
            $next = (string) ($_POST['next'] ?? '/');
            if (strpos($next, '/') !== 0) {
                $next = '/';
            }
            redirect_to($next);
        }

        if ($action === 'submit_code' || $action === 'submit_flag') {
            $user = current_django_user();
            if (!$user) {
                throw new InvalidArgumentException('Django 로그인이 필요합니다.');
            }
            $challenge_id = $_POST['challenge_id'] ?? '';
            $submittedCode = trim((string) ($_POST['clear_code'] ?? $_POST['flag'] ?? ''));
            
            $challenges = list_challenges();
            if (isset($challenges[$challenge_id])) {
                if (hash_equals($challenges[$challenge_id]['flag'], $submittedCode)) {
                    mark_solved_with_django((string) $user['token'], (string) $challenge_id);
                    $_SESSION['wargame_notice'] = "정답입니다! 성공적으로 취약점을 해결했습니다.";
                    redirect_to('/?challenge=' . urlencode($challenge_id));
                } else {
                    throw new InvalidArgumentException("오답입니다. 클리어 코드가 일치하지 않습니다.");
                }
            } else {
                throw new InvalidArgumentException("잘못된 문제 식별자입니다.");
            }
        }
    }
} catch (Throwable $e) {
    $error = $e->getMessage();
}

$user = current_django_user();
$notice = $_SESSION['wargame_notice'] ?? null;
unset($_SESSION['wargame_notice']);

$challenges = list_challenges();
$solved_challenges = $user ? (array) $user['solves'] : [];
$challengeId = $_GET['challenge'] ?? '';
$selectedChallenge = isset($challenges[$challengeId]) ? $challenges[$challengeId] : null;
$difficultyOptions = array_values(array_unique(array_map(static fn(array $challenge): string => (string) $challenge['difficulty'], $challenges)));
$difficultyOrder = ['Easy' => 1, 'Medium' => 2, 'Hard' => 3];
usort($difficultyOptions, static fn(string $a, string $b): int => ($difficultyOrder[$a] ?? 99) <=> ($difficultyOrder[$b] ?? 99));
$tagOptions = [];
foreach ($challenges as $challenge) {
    foreach ((array) $challenge['tags'] as $tag) {
        $tagOptions[(string) $tag] = true;
    }
}
$tagOptions = array_keys($tagOptions);
sort($tagOptions, SORT_NATURAL | SORT_FLAG_CASE);

$cssVersion = (string) (filemtime(__DIR__ . '/assets/wargame.css') ?: time());
$faviconVersion = (string) (filemtime(__DIR__ . '/assets/favicon.ico') ?: time());
$currentDjangoToken = is_string($_SESSION['django_token'] ?? null) ? (string) $_SESSION['django_token'] : '';
$djangoPreferences = is_array($user['preferences'] ?? null) ? $user['preferences'] : [];
$accountThemeMode = in_array(($djangoPreferences['theme_mode'] ?? ''), ['light', 'dark'], true) ? (string) $djangoPreferences['theme_mode'] : '';
$preferredUiLang = in_array(($djangoPreferences['ui_lang'] ?? ''), ['ko', 'en'], true) ? (string) $djangoPreferences['ui_lang'] : 'ko';
$bodyThemeClass = $accountThemeMode === 'light' ? '' : ' theme-dark';
$metaDescription = $preferredUiLang === 'en'
    ? 'Practice web and system security through hands-on Hanplanet Wargame challenges.'
    : '직접 문제를 풀며 웹과 시스템 보안을 연습하는 Hanplanet 워게임입니다.';
?>
<!doctype html>
<html lang="<?= h($preferredUiLang) ?>" data-account-theme-mode="<?= h($accountThemeMode) ?>">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="<?= h(csrf_token()) ?>">
    <meta name="description" content="<?= h($metaDescription) ?>">
    <meta property="og:title" content="Hanplanet Wargame">
    <meta property="og:description" content="<?= h($metaDescription) ?>">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="Hanplanet Wargame">
    <meta name="twitter:description" content="<?= h($metaDescription) ?>">
    <title>Hanplanet Wargame</title>
    <link rel="icon" href="/assets/favicon.ico?v=<?= h($faviconVersion) ?>">
    <link rel="stylesheet" href="<?= h(django_static_url('css/vendor/bootstrap.min.css')) ?>">
    <link rel="stylesheet" href="<?= h(django_static_url('css/common/layout.css')) ?>">
    <link rel="stylesheet" href="<?= h(django_static_url('css/common/account_widget.css')) ?>">
    <link rel="stylesheet" href="<?= h(django_static_url('css/common/style.css')) ?>">
    <link rel="stylesheet" href="<?= h(django_static_url('css/common/popup_common.css')) ?>">
    <link rel="stylesheet" href="/assets/wargame.css?v=<?= h($cssVersion) ?>">
    <script src="<?= h(django_static_url('js/common/popup_common.js')) ?>" defer></script>
    <script src="<?= h(django_static_url('js/common/site_nav_responsive_manager.js')) ?>" defer></script>
    <script src="<?= h(django_static_url('js/common/site.js')) ?>" defer></script>
    <script src="<?= h(django_static_url('js/vendor/bootstrap.min.js')) ?>" defer></script>
</head>
<body
    class="page<?= h($bodyThemeClass) ?> wargame-page"
    data-authenticated="<?= $user ? '1' : '0' ?>"
    data-theme-preference-url=""
    data-user-preference-url=""
    data-portfolio-owner-username=""
>
    <div id="django-navbar-root" class="django-navbar-root"></div>

    <main class="layout">
        <?php if ($error): ?>
            <div class="message error"><?= h($error) ?></div>
        <?php endif; ?>
        <?php if ($notice): ?>
            <div class="message success-toast"><?= h($notice) ?></div>
        <?php endif; ?>

        <section class="board">
                <div class="panel challenge-list">
                    <div class="panel-head">
                        <div class="filters">
                            <select id="filter_difficulty" onchange="filterChallenges()">
                                <option value="">난이도</option>
                                <?php foreach ($difficultyOptions as $difficulty): ?>
                                    <option value="<?= h($difficulty) ?>"><?= h($difficulty) ?></option>
                                <?php endforeach; ?>
                            </select>
                            <select id="filter_tag" onchange="filterChallenges()">
                                <option value="">기술</option>
                                <?php foreach ($tagOptions as $tag): ?>
                                    <option value="<?= h($tag) ?>"><?= h($tag) ?></option>
                                <?php endforeach; ?>
                            </select>
                        </div>
                    </div>
                    <ul>
                        <?php foreach ($challenges as $id => $ch): ?>
                            <?php 
                                $isSolved = in_array($id, $solved_challenges, true); 
                                $isSelected = ($challengeId === $id);
                            ?>
                            <li class="<?= $isSelected ? 'selected' : '' ?>" data-difficulty="<?= h($ch['difficulty']) ?>" data-tags="<?= h(implode(',', $ch['tags'])) ?>">
                                <a href="/?challenge=<?= h($id) ?>">
                                    <div class="challenge-info">
                                        <strong><?= h($ch['name']) ?></strong>
                                        <div class="tags">
                                            <?php foreach ($ch['tags'] as $tag): ?>
                                                <span class="tag-badge <?= h(wargame_css_class((string) $tag)) ?>"><?= h($tag) ?></span>
                                            <?php endforeach; ?>
                                        </div>
                                    </div>
                                    <?php if ($isSolved): ?>
                                        <span class="check-icon" title="Solved">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ef037" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                                <polyline points="20 6 9 17 4 12"></polyline>
                                            </svg>
                                        </span>
                                    <?php endif; ?>
                                </a>
                            </li>
                        <?php endforeach; ?>
                    </ul>
                </div>

                <div class="panel challenge-view">
                    <?php if ($selectedChallenge): ?>
                        <?php
                            $isSolved = in_array($selectedChallenge['id'], $solved_challenges, true);
                            $answerLabel = (string) ($selectedChallenge['answer_label'] ?? '클리어 코드');
                            $answerFormat = (string) ($selectedChallenge['answer_format'] ?? 'clear{...}');
                        ?>
                        <article>
                            <div class="challenge-view-head">
                                <h2><?= h($selectedChallenge['name']) ?></h2>
                                <div style="display: flex; gap: 8px; align-items: center;">
                                    <span class="difficulty-badge <?= strtolower($selectedChallenge['difficulty']) ?>"><?= h($selectedChallenge['difficulty']) ?></span>
                                    <?php if ($isSolved): ?>
                                        <span class="status-badge solved">Solved</span>
                                    <?php else: ?>
                                        <span class="status-badge unsolved">Unsolved</span>
                                    <?php endif; ?>
                                </div>
                            </div>
                            
                            <div class="challenge-desc">
                                <p><?= nl2br(h($selectedChallenge['desc'])) ?></p>
                            </div>
                            
                            <div class="challenge-playground-wrapper">
                                <h3>실습 환경</h3>
                                
                                <?php if (!empty($selectedChallenge['lab_url']) || !empty($selectedChallenge['tips'])): ?>
                                    <div class="challenge-playground curriculum-playground">
                                        <p><strong><?= h($selectedChallenge['phase'] ?? 'Curriculum') ?></strong> / <?= h((string) ($selectedChallenge['week'] ?? '?')) ?>주차 <?= h((string) ($selectedChallenge['day'] ?? '?')) ?>일차 대상 서비스입니다.</p>
                                        <?php if (!empty($selectedChallenge['lab_url'])): ?>
                                            <a class="lab-link" href="<?= h($selectedChallenge['lab_url']) ?>" target="_blank" rel="noopener noreferrer">문제 페이지 열기</a>
                                        <?php endif; ?>
                                        <?php if (!empty($selectedChallenge['tips'])): ?>
                                            <h4>막히면 볼 핵심 키워드</h4>
                                            <p class="keyword-note">이전 문제 풀이에서 다룬 기본기는 알고 있다고 가정하고, 이 단계에서 막힐 때 참고할 키워드만 표시합니다.</p>
                                            <ul class="curriculum-list search-tips">
                                                <?php foreach ($selectedChallenge['tips'] as $tip): ?>
                                                    <li><code><?= h($tip) ?></code></li>
                                                <?php endforeach; ?>
                                            </ul>
                                        <?php endif; ?>
                                        <div class="message curriculum-note">정답은 서술형이 아니라 대상 서비스가 표시하는 <code><?= h($answerFormat) ?></code> 한 줄입니다. 이 워게임 내부 실습 대상에만 시도하세요.</div>
                                    </div>
                                <?php endif; ?>
                            </div>

                            <div class="flag-submission">
                                <h3><?= h($answerLabel) ?> 제출</h3>
                                <form method="post" class="flag-form" action="/?challenge=<?= h($selectedChallenge['id']) ?>">
                                    <input type="hidden" name="csrf_token" value="<?= h(csrf_token()) ?>">
                                    <input type="hidden" name="action" value="submit_code">
                                    <input type="hidden" name="challenge_id" value="<?= h($selectedChallenge['id']) ?>">
                                    <div class="flag-input-group">
                                        <input name="clear_code" placeholder="<?= h($answerFormat) ?>" required <?= $isSolved ? 'disabled' : '' ?> value="<?= $isSolved ? h($selectedChallenge['flag']) : '' ?>">
                                        <button type="submit" <?= $isSolved ? 'disabled' : '' ?>><?= $isSolved ? '해결 완료' : '제출' ?></button>
                                    </div>
                                </form>
                            </div>
                        </article>
                    <?php else: ?>
                        <div class="welcome-screen">
                            <h2>Hanplanet Wargame에 오신 것을 환영합니다!</h2>
                            <p>이곳은 가상 사건을 따라가며 단서를 분석하는 워게임 서버입니다.</p>
                            <p>왼쪽 문제 목록에서 취약점을 선택하여 실습을 진행하고, 각 단계의 <strong>클리어 코드</strong>를 획득하여 제출해보세요.</p>
                            <div class="intro-steps">
                                <div class="step-card">
                                    <span class="step-num">1</span>
                                    <h4>문제 선택</h4>
                                    <p>반년 과정의 가상 사건을 순서대로 따라가며 각 문제의 단서를 분석합니다.</p>
                                </div>
                                <div class="step-card">
                                    <span class="step-num">2</span>
                                    <h4>문제 페이지</h4>
                                    <p>각 문제에 연결된 전용 페이지에서 요청, 로그, 토큰, 설정 자료를 확인합니다.</p>
                                </div>
                                <div class="step-card">
                                    <span class="step-num">3</span>
                                    <h4>코드 인증</h4>
                                    <p>대상 서비스가 표시하는 한 줄짜리 클리어 코드를 제출하여 통과 판정을 받습니다.</p>
                                </div>
                            </div>
                        </div>
                    <?php endif; ?>
                </div>
        </section>
    </main>
    <script>
        (() => {
            const djangoBase = <?= json_encode(django_base_url(), JSON_UNESCAPED_SLASHES) ?>;
            const currentToken = <?= json_encode($currentDjangoToken, JSON_UNESCAPED_SLASHES) ?>;
            const initialPreferences = <?= json_encode($djangoPreferences, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?>;
            const csrfToken = <?= json_encode(csrf_token(), JSON_UNESCAPED_SLASHES) ?>;
            const navbarRoot = document.getElementById('django-navbar-root');

            function writeThemeCookie(mode) {
                try {
                    document.cookie = `portfolio_theme_mode=${encodeURIComponent(mode)}; domain=.hanplanet.com; path=/; max-age=31536000; SameSite=Lax`;
                } catch (error) {}
            }

            function setActiveControl(selector, value, attributeName) {
                document.querySelectorAll(selector).forEach(control => {
                    control.classList.toggle('is-active', control.getAttribute(attributeName) === value);
                });
            }

            function applyThemePreference(mode) {
                const normalizedMode = mode === 'light' ? 'light' : 'dark';
                document.documentElement.dataset.accountThemeMode = normalizedMode;
                document.body.classList.toggle('theme-dark', normalizedMode === 'dark');
                setActiveControl('.ui-theme-toggle [data-theme-mode]', normalizedMode, 'data-theme-mode');
                try {
                    window.localStorage.setItem('portfolio_theme_mode', normalizedMode);
                } catch (error) {}
                writeThemeCookie(normalizedMode);
            }

            function applyLanguagePreference(uiLang) {
                const normalizedLang = uiLang === 'en' ? 'en' : 'ko';
                document.documentElement.lang = normalizedLang;
                document.querySelectorAll('.ui-lang-toggle-inline .ui-lang-link').forEach(link => {
                    const text = link.textContent.trim().toLowerCase();
                    link.href = '#';
                    link.classList.toggle('is-active', text === normalizedLang);
                });
            }

            function applyPreferences(preferences) {
                let mode = preferences && preferences.theme_mode ? preferences.theme_mode : initialPreferences.theme_mode;
                const uiLang = preferences && preferences.ui_lang ? preferences.ui_lang : initialPreferences.ui_lang;
                if (mode !== 'light' && mode !== 'dark') {
                    try {
                        const storedMode = window.localStorage.getItem('portfolio_theme_mode');
                        if (storedMode === 'light' || storedMode === 'dark') {
                            mode = storedMode;
                        }
                    } catch (error) {}
                }
                if (mode !== 'light' && mode !== 'dark') {
                    mode = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
                }
                applyThemePreference(mode);
                applyLanguagePreference(uiLang || 'ko');
            }

            function wargamePreferenceRequest(method, payload) {
                if (!currentToken) {
                    return Promise.resolve(null);
                }

                return fetch(`${djangoBase}/ko/api/wargame/preferences/`, {
                    method,
                    credentials: 'include',
                    headers: {
                        'Authorization': `Bearer ${currentToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: payload ? JSON.stringify(payload) : undefined
                })
                    .then(response => response.ok ? response.json() : null)
                    .catch(() => null);
            }

            function initializeControls() {
                applyPreferences(initialPreferences || {});

                document.querySelectorAll('.ui-theme-toggle [data-theme-mode]').forEach(control => {
                    control.addEventListener('click', event => {
                        event.preventDefault();
                        const mode = control.dataset.themeMode === 'light' ? 'light' : 'dark';
                        applyThemePreference(mode);
                        wargamePreferenceRequest('PATCH', { mode }).then(data => {
                            if (data) {
                                applyPreferences(data);
                            }
                        });
                    });
                });

                document.querySelectorAll('.ui-lang-toggle-inline .ui-lang-link').forEach(control => {
                    control.addEventListener('click', event => {
                        event.preventDefault();
                        const uiLang = control.textContent.trim().toLowerCase() === 'en' ? 'en' : 'ko';
                        applyLanguagePreference(uiLang);
                        wargamePreferenceRequest('PATCH', { ui_lang: uiLang }).then(data => {
                            if (data) {
                                applyPreferences(data);
                            }
                        });
                    });
                });

                wargamePreferenceRequest('GET').then(data => {
                    if (data) {
                        applyPreferences(data);
                    }
                });
            }

            function initializeNavbar() {
                const init = () => {
                    if (typeof window.__initSiteNavResponsiveManager === 'function') {
                        window.__initSiteNavResponsiveManager();
                    }
                    window.dispatchEvent(new Event('resize'));
                };

                init();
                window.setTimeout(init, 120);
                window.setTimeout(init, 500);
            }

            function postToken(token) {
                const form = document.createElement('form');
                form.method = 'post';
                form.action = '/';
                const fields = {
                    csrf_token: csrfToken,
                    action: 'set_django_token',
                    django_token: token,
                    next: window.location.pathname + window.location.search
                };
                Object.entries(fields).forEach(([name, value]) => {
                    const input = document.createElement('input');
                    input.type = 'hidden';
                    input.name = name;
                    input.value = value;
                    form.appendChild(input);
                });
                document.body.appendChild(form);
                form.submit();
            }

            fetch(`${djangoBase}/ko/api/wargame/navbar/`, { credentials: 'include' })
                .then(response => response.ok ? response.json() : null)
                .then(data => {
                    if (!navbarRoot || !data || !data.html) {
                        return;
                    }
                    navbarRoot.innerHTML = data.html;
                    navbarRoot.querySelectorAll('a[href^="/"]').forEach(link => {
                        link.href = djangoBase + link.getAttribute('href');
                    });
                    navbarRoot.querySelectorAll('form[action^="/"]').forEach(form => {
                        form.action = djangoBase + form.getAttribute('action');
                    });
                    initializeControls();
                    initializeNavbar();
                })
                .catch(() => {});

            fetch(`${djangoBase}/ko/api/wargame/session/`, { credentials: 'include' })
                .then(response => response.ok ? response.json() : null)
                .then(data => {
                    if (data && data.authenticated && data.token && !currentToken) {
                        postToken(data.token);
                    }
                })
                .catch(() => {});
        })();

        function filterChallenges() {
            const diffSelect = document.getElementById('filter_difficulty');
            const tagSelect = document.getElementById('filter_tag');
            if (!diffSelect || !tagSelect) return;
            
            const diff = diffSelect.value;
            const tag = tagSelect.value;
            const items = document.querySelectorAll('.challenge-list ul li');
            
            items.forEach(item => {
                const itemDiff = item.getAttribute('data-difficulty') || '';
                const itemTagsAttr = item.getAttribute('data-tags') || '';
                const itemTags = itemTagsAttr ? itemTagsAttr.split(',') : [];
                
                const diffMatch = !diff || itemDiff === diff;
                const tagMatch = !tag || itemTags.includes(tag);
                
                if (diffMatch && tagMatch) {
                    item.style.display = '';
                } else {
                    item.style.display = 'none';
                }
            });
        }
        
        document.addEventListener('DOMContentLoaded', () => {
            // Apply filter on page load to restore selected filter states
            if (document.getElementById('filter_difficulty') || document.getElementById('filter_tag')) {
                filterChallenges();
            }
        });
    </script>
</body>
</html>
