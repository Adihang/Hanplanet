<?php
declare(strict_types=1);

/**
 * Renders each challenge response as the target company's own web application.
 *
 * This renderer deliberately contains no portal controls. Requests are made by
 * ordinary links and forms, while header-only operations remain read-only in
 * the browser so they can be exercised with an HTTP client of the user's choice.
 */
final class TargetSiteRenderer
{
    /** @var array<string, array{title:string,tone:string}> */
    private const SERVICES = [
        LabEngine::HTTP_HEADERS => ['title' => '오로라 문구점', 'tone' => 'aurora'],
        LabEngine::CLIENT_TRUST => ['title' => 'LeafPeer Review', 'tone' => 'leaf'],
        LabEngine::IDOR => ['title' => 'Nova Vault', 'tone' => 'nova'],
        LabEngine::SQLI_LOGIN => ['title' => 'Comet StockFlow', 'tone' => 'comet'],
        LabEngine::SQLI_UNION => ['title' => 'Helios Supply Catalog', 'tone' => 'helios'],
        LabEngine::REFLECTED_XSS => ['title' => 'PrismCare Help Desk', 'tone' => 'prism'],
        LabEngine::PATH_TRAVERSAL => ['title' => 'Atlas Field Manual', 'tone' => 'atlas'],
        LabEngine::UPLOAD_VALIDATION => ['title' => 'PixelPet', 'tone' => 'pixelpet'],
        LabEngine::JWT_VALIDATION => ['title' => 'Vector Cloud', 'tone' => 'vector'],
        LabEngine::SSRF => ['title' => 'Lumen Studio', 'tone' => 'lumen'],
        LabEngine::OPERATION_NIGHTFALL => ['title' => 'Nightfall RelayOps', 'tone' => 'nightfall'],
    ];

    /** @param array<string, mixed> $response */
    public static function render(string $missionId, array $response): void
    {
        $service = self::SERVICES[$missionId] ?? ['title' => 'Service', 'tone' => 'default'];
        $cssPath = dirname(__DIR__) . '/public/assets/targets.css';
        $cssVersion = is_file($cssPath) ? (string) filemtime($cssPath) : '1';
        $jsPath = dirname(__DIR__) . '/public/assets/lab.js';
        $jsVersion = is_file($jsPath) ? (string) filemtime($jsPath) : '1';

        echo '<!doctype html><html lang="ko"><head>';
        echo '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
        echo '<meta name="robots" content="noindex,nofollow,noarchive">';
        echo '<title>' . self::h($service['title']) . '</title>';
        echo '<link rel="stylesheet" href="/assets/targets.css?v=' . self::h($cssVersion) . '">';
        echo '<style>html,body{min-height:100%;margin:0}.target-site-viewport,.target-site-viewport>.service-app{min-height:100vh}.target-site-viewport{overflow:auto}.native-file{min-width:0;max-width:100%;height:auto;padding:7px;background:#fff}.site-notice{margin:14px 0;padding:12px 14px;border:1px solid currentColor;border-radius:7px;font-size:10px;line-height:1.6;opacity:.82}.site-link{color:inherit;text-decoration:none}.site-link:hover{text-decoration:underline}.native-disabled{cursor:not-allowed;opacity:.58}</style>';
        if ($missionId !== LabEngine::REFLECTED_XSS) {
            echo '<script src="/assets/lab.js?v=' . self::h($jsVersion) . '" defer></script>';
        }
        echo '</head><body class="target-body target-' . self::h($service['tone']) . '">';
        echo '<main class="service-viewport target-site-viewport">';

        match ($missionId) {
            LabEngine::HTTP_HEADERS => self::renderAurora($response),
            LabEngine::CLIENT_TRUST => self::renderLeaf($response),
            LabEngine::IDOR => self::renderNova($response),
            LabEngine::SQLI_LOGIN => self::renderComet($response),
            LabEngine::SQLI_UNION => self::renderHelios($response),
            LabEngine::REFLECTED_XSS => self::renderPrism($response),
            LabEngine::PATH_TRAVERSAL => self::renderAtlas($response),
            LabEngine::UPLOAD_VALIDATION => self::renderPixelPet($response),
            LabEngine::JWT_VALIDATION => self::renderVector($response),
            LabEngine::SSRF => self::renderLumen($response),
            LabEngine::OPERATION_NIGHTFALL => self::renderNightfall($response),
            default => self::renderUnavailableBody(),
        };

        echo '</main></body></html>';
    }

    /** @param array<string, mixed> $response */
    private static function renderAurora(array $response): void
    {
        $output = self::output($response);
        $records = self::rows($output['records'] ?? []);
        $promotion = self::array(self::nested($output, 'page.promotion', []));
        $diagnostic = self::array($output['reconciliation'] ?? $output['diagnostic'] ?? []);
        ?>
        <div class="service-app aurora-app">
            <header class="retail-header"><a class="retail-logo site-link" href="/aurora/discount/check"><span>A</span><b>오로라 문구점 · SmartCoupon</b></a><nav><span>신상품</span><span>기획전</span><span class="active">할인 확인</span><span>고객센터</span></nav><button class="cart-button" type="button">장바구니 2</button></header>
            <section class="aurora-promo"><span>WEEKLY SALE</span><strong>공부가 즐거워지는<br>여름 문구 할인전</strong><small>매장과 온라인의 할인 적용 상태를 확인하세요</small></section>
            <div class="aurora-content">
                <section class="sale-checker">
                    <span class="service-eyebrow"><?= self::h($diagnostic !== [] ? 'STORE OPERATIONS' : 'DISCOUNT CHECK') ?></span>
                    <h2><?= self::h($diagnostic !== [] ? '성수점 할인 운영 현황' : ($promotion['name'] ?? '오늘의 할인 확인')) ?></h2>
                    <p><?= self::h($diagnostic !== [] ? '매장 가격과 쿠폰 규칙의 반영 상태입니다.' : '결제 전 할인 조회 서비스의 상태를 확인합니다.') ?></p>
                    <?php if ($diagnostic !== []): ?>
                        <dl class="header-values"><dt>매장</dt><dd><?= self::h($diagnostic['store'] ?? '성수점') ?></dd><dt>프로모션</dt><dd><?= self::h($diagnostic['promotion'] ?? '') ?></dd><dt>가격 서비스</dt><dd><?= self::h($diagnostic['pricing_node'] ?? '') ?></dd><dt>쿠폰 규칙</dt><dd><?= self::h($diagnostic['coupon_rules_loaded'] ?? '') ?>개 적용</dd><dt>상태</dt><dd>정상</dd></dl>
                    <?php else: ?>
                        <form class="target-action-form" method="get" action="/aurora/discount/check"><button class="target-primary" type="submit">할인 적용 상태 새로고침</button></form>
                        <div class="store-status"><span class="status-lamp"></span><div><b>온라인 할인 정상 운영 중</b><small>마지막 확인 · 방금 전</small></div></div>
                    <?php endif; ?>
                </section>
                <section class="sale-checker">
                    <span class="service-eyebrow">TODAY'S PICKS</span><h2>할인 상품</h2><p>성수점 즉시 픽업 가능 상품입니다.</p>
                    <div class="product-grid">
                        <?php foreach ($records as $row): ?><article><div class="product-art data">AUR</div><span><?= self::h($row['sku'] ?? '') ?></span><h3><?= self::h($row['name'] ?? '') ?></h3><b><?= self::h($row['discounted_price'] ?? $row['price'] ?? '') ?></b><small>재고 <?= self::h($row['stock'] ?? 0) ?>개</small></article><?php endforeach; ?>
                        <?php if ($records === []): ?><article class="placeholder-product"><div></div><span>할인 상품을 불러오는 중입니다</span></article><?php endif; ?>
                    </div>
                </section>
            </div>
        </div>
        <?php
    }

    /** @param array<string, mixed> $response */
    private static function renderLeaf(array $response): void
    {
        $output = self::output($response);
        $records = self::rows($output['records'] ?? []);
        $archive = self::rows($output['archive'] ?? $output['documents'] ?? []);
        $isArchive = self::nested($output, 'page.template', '') === 'review_archive' || ($response['completed'] ?? false) === true;
        ?>
        <div class="service-app leaf-app">
            <header class="leaf-header"><a class="leaf-logo site-link" href="/leaf/inbox"><span>◒</span><div><b>LeafPeer Review</b><small>리프 연구센터</small></div></a><div class="leaf-account"><span>강하늘 · <?= $isArchive ? '검토자' : '외부 열람자' ?></span><i>KH</i></div></header>
            <div class="leaf-layout">
                <nav class="leaf-nav"><a class="<?= $isArchive ? '' : 'active' ?>" href="/leaf/inbox">대시보드</a><a>내 검토 12</a><a>품질 리포트</a><?php if ($isArchive): ?><a class="active" href="/leaf/inbox/archive">리뷰 보관함</a><?php else: ?><span class="leaf-locked-nav">리뷰 보관함 <small>잠김</small></span><?php endif; ?><small>파트너</small><a>지원 요청</a></nav>
                <main class="leaf-main">
                    <div class="leaf-heading"><div><span>REVIEW WORKSPACE</span><h2><?= $isArchive ? '검토 보관함' : '안녕하세요, 분석가님' ?></h2><p><?= $isArchive ? '완료된 검토와 팀 품질 기록을 확인하세요.' : '이번 주 할당된 파트너 리뷰를 확인하세요.' ?></p></div><div class="leaf-score"><b>4.8</b><small>평균 품질 점수</small></div></div>
                    <div class="leaf-cards"><article><span>진행 중</span><b>3</b><small>오늘 마감 1건</small></article><article><span>제출 완료</span><b>27</b><small>이번 분기</small></article><article class="locked-card"><span>검토 보관함</span><b><?= $isArchive ? '열림' : '권한 필요' ?></b><small>완료 자료 및 팀 품질 기록</small></article></div>
                    <section class="session-card"><div class="session-card-head"><div><span class="session-icon">◈</span><div><h3><?= $isArchive ? '보관 문서' : '할당된 리뷰' ?></h3><p>열람할 문서를 선택하세요.</p></div></div><span class="badge-viewer"><?= $isArchive ? 'ARCHIVE' : 'INBOX' ?></span></div>
                        <?php $shown = $isArchive && $archive !== [] ? $archive : $records; ?>
                        <?php foreach ($shown as $row): ?><article class="site-notice"><b><?= self::h($row['title'] ?? $row['name'] ?? '검토 문서') ?></b><br><span><?= self::h($row['author'] ?? $row['owner'] ?? '') ?> · <?= self::h($row['status'] ?? $row['category'] ?? '') ?> · <?= self::h($row['due'] ?? '') ?></span></article><?php endforeach; ?>
                        <?php if (!$isArchive): ?><div class="leaf-archive-locked"><span>보관함</span><div><b>추가 권한이 필요합니다</b><small>소속 관리자에게 검토자 권한을 요청해 주세요.</small></div></div><?php endif; ?>
                    </section>
                </main>
            </div>
        </div>
        <?php
    }

    /** @param array<string, mixed> $response */
    private static function renderNova(array $response): void
    {
        $output = self::output($response);
        $document = self::array($output['document'] ?? []);
        if ($document === []) {
            $rows = self::rows($output['records'] ?? []);
            $document = $rows[0] ?? [];
        }
        $request = self::request($response);
        $id = self::nested($request, 'query.id', $document['id'] ?? $output['self_id'] ?? $output['my_document_id'] ?? '');
        $activity = self::array($output['activity_feed'] ?? []);
        ?>
        <div class="service-app nova-app">
            <header class="nova-header"><a class="nova-logo site-link" href="/nova/documents"><span>N</span><b>Nova</b><small>Vault</small></a><div class="nova-search">⌕ 문서함 검색</div><div class="nova-user">강하늘 · 외부 자문 <i>KH</i></div></header>
            <div class="nova-layout"><nav class="nova-nav"><button type="button">＋ 새 문서</button><a class="active">▣ 내 문서</a><a>♧ 공유 문서</a><a>☆ 즐겨찾기</a><a>⌁ 최근 활동</a><a>♲ 휴지통</a><small>저장공간 18% 사용</small><meter value="18" min="0" max="100"></meter></nav>
                <main class="nova-main"><div class="nova-breadcrumb">내 문서 <span>/</span> 문서 상세</div><div class="nova-doc-head"><div><span class="doc-icon">DOC</span><div><h2><?= self::h($document['title'] ?? '문서 선택') ?></h2><p>문서 번호 #<b><?= self::h($document['id'] ?? $id) ?></b> · <?= self::h($document['owner'] ?? '강하늘') ?></p></div></div><button type="button">공유</button></div>
                    <a class="nova-url-edit nova-document-link site-link" href="/nova/documents?id=<?= self::h(rawurlencode((string) $id)) ?>"><span>내 문서</span><b>#<?= self::h($id) ?> · <?= self::h($document['title'] ?? '최근 문서') ?></b><small>열기 →</small></a>
                    <article class="nova-paper"><span class="paper-label"><?= self::h(strtoupper((string) ($document['category'] ?? 'EXTERNAL SHARE'))) ?> / NOVA VAULT</span><h3><?= self::h($document['title'] ?? '문서를 선택하세요') ?></h3><?php if ($document !== []): ?><dl><dt>소유자</dt><dd><?= self::h($document['owner'] ?? '') ?></dd><dt>수정 시각</dt><dd><?= self::h($document['updated_at'] ?? '') ?></dd><dt>본문</dt><dd><?= self::h($document['body'] ?? '이 문서는 본문 미리보기를 제공하지 않습니다.') ?></dd><?php if (isset($document['audit_marker'])): ?><dt>감사 표식</dt><dd><?= self::h($document['audit_marker']) ?></dd><?php endif; ?></dl><?php endif; ?></article>
                </main>
                <aside class="nova-activity"><h3>최근 활동</h3><div><i class="avatar-purple">JY</i><p><?= self::h($activity['message'] ?? '정유나님이 문서 공유 범위를 변경했습니다.') ?><small><?= self::h($activity['at'] ?? '방금 전') ?></small></p></div><div><i>나</i><p>자문 질문지를 열었습니다<small>#<?= self::h($output['my_document_id'] ?? $output['self_id'] ?? $id) ?> · 오늘</small></p></div></aside>
            </div>
        </div>
        <?php
    }

    /** @param array<string, mixed> $response */
    private static function renderComet(array $response): void
    {
        $output = self::output($response);
        $request = self::request($response);
        $authenticated = ($output['authenticated'] ?? false) === true;
        ?>
        <div class="service-app comet-app">
            <div class="comet-brand-panel"><div class="comet-logo"><span>✦</span> COMET STOCKFLOW</div><div class="warehouse-art"><span>A-12</span><span>C-04</span><span>COLD-02</span><i></i><i></i><i></i></div><div><h2>남부 물류센터<br>야간 재고 관리.</h2><p>입출고·실사·저온창고 상태 동기화</p></div><small>COMET LOGISTICS · NIGHT-02 · INTERNAL</small></div>
            <div class="comet-login"><div class="login-status"><span></span> 시스템 정상 · KST <?= self::h(date('H:i')) ?></div><div class="login-box"><span class="service-eyebrow">STAFF ACCESS</span><h1><?= $authenticated ? '인증 완료' : '재고 운영 로그인' ?></h1><p><?= $authenticated ? '남부 물류센터 운영 콘솔에 접속했습니다.' : '승인된 매장 및 본사 직원만 사용할 수 있습니다.' ?></p>
                <?php if (!$authenticated): ?><form class="target-action-form" method="post" action="/comet/login"><label>직원 아이디<input name="username" autocomplete="username" value="<?= self::h(self::nested($request, 'body.username', '')) ?>"></label><label>비밀번호<input name="password" type="password" autocomplete="current-password"></label><div class="remember-row"><label><input type="checkbox"> 이 기기 기억하기</label><a>접속 문제 신고</a></div><button type="submit">재고 콘솔 로그인</button></form><?php endif; ?>
                <?php if (array_key_exists('authenticated', $output) && !$authenticated): ?><div class="login-result"><b>로그인할 수 없습니다</b><span>아이디 또는 비밀번호를 확인해 주세요.</span></div><?php endif; ?>
                <?php if ($authenticated): ?><div class="login-result success"><b>야간 운영 계정</b><span>입출고 현황과 재고 실사 대기열을 불러왔습니다.</span></div><?php endif; ?>
            </div></div>
        </div>
        <?php
    }

    /** @param array<string, mixed> $response */
    private static function renderHelios(array $response): void
    {
        $output = self::output($response);
        $request = self::request($response);
        $rows = self::rows($output['rows'] ?? $output['records'] ?? []);
        ?>
        <div class="service-app helios-app"><header class="helios-header"><a class="helios-logo site-link" href="/helios/products"><span>☀</span><b>HELIOS</b><small>SUPPLY CATALOG</small></a><nav><a class="active">상품</a><a>주문 내역</a><a>거래처 견적</a></nav><div class="helios-profile">파트너 대리점 2048 <i>H2</i></div></header>
            <section class="helios-hero"><span>OFFICE ESSENTIALS</span><h1>일하는 순간을 더 밝게.</h1><p>검증된 사무용품을 사내 예산으로 빠르게 주문하세요.</p><form class="helios-search target-action-form" method="get" action="/helios/products"><span>⌕</span><input name="q" aria-label="상품 검색어" value="<?= self::h(self::nested($request, 'query.q', '')) ?>" placeholder="상품명 또는 SKU 검색"><button type="submit">검색</button></form></section>
            <main class="helios-results"><div class="result-heading"><div><span>SEARCH RESULTS</span><h2>상품 검색</h2></div><b><?= count($rows) ?>개 결과</b></div>
                <?php if (isset($output['database_error'])): ?><div class="sql-error" role="alert"><b>상품 검색을 완료하지 못했습니다</b><code><?= self::h($output['database_error']) ?></code></div><?php endif; ?>
                <div class="product-grid"><?php if ($rows === []): ?><article class="placeholder-product"><div></div><span>검색 결과가 없습니다</span></article><?php else: ?><?php foreach ($rows as $row): ?><article><div class="product-art data">HLS</div><span><?= self::h($row['sku'] ?? 'CATALOG') ?></span><h3><?= self::h($row['name'] ?? '') ?></h3><b><?= self::h($row['price'] ?? '') ?></b><?php if (isset($row['stock'])): ?><small>재고 <?= self::h($row['stock']) ?>개</small><?php endif; ?></article><?php endforeach; ?><?php endif; ?></div>
            </main>
        </div>
        <?php
    }

    /** @param array<string, mixed> $response */
    private static function renderPrism(array $response): void
    {
        $output = self::output($response);
        $request = self::request($response);
        $fragment = is_string($output['rendered_fragment'] ?? null) ? $output['rendered_fragment'] : '';
        ?>
        <div class="service-app prism-app"><header class="prism-header"><a class="prism-logo site-link" href="/prism/search"><span></span><b>PrismCare</b><small>Help Desk</small></a><div class="prism-actions"><a>서비스 상태</a><a>문의하기</a><i>?</i></div></header>
            <section class="prism-hero"><div class="prism-orb"></div><span>PRISM CLOUD SUPPORT</span><h1>무엇을 도와드릴까요?</h1><form class="prism-search target-action-form" method="get" action="/prism/search"><span>⌕</span><input name="q" aria-label="도움말 검색어" value="<?= self::h(self::nested($request, 'query.q', '')) ?>" placeholder="문서, 오류 코드, 기능 검색"><button type="submit">검색</button></form><div class="popular-links"><span>인기 검색어</span><a>계정 복구</a><a>API 키</a><a>결제</a></div></section>
            <main class="prism-results"><div class="category-row"><article><i>◇</i><b>시작하기</b><span>12개 문서</span></article><article><i>⌘</i><b>개발자 API</b><span>34개 문서</span></article><article><i>◌</i><b>문제 해결</b><span>28개 문서</span></article></div>
                <?php if ($fragment !== ''): ?><section class="prism-preview"><div><span>SEARCH RESULTS</span><b>도움말 검색 결과</b></div><div class="search-result" style="padding:22px"><?= $fragment ?></div></section><?php else: ?><section class="prism-empty"><span>⌕</span><h2>도움말을 검색해 보세요</h2><p>검색어와 일치하는 문서가 여기에 표시됩니다.</p></section><?php endif; ?>
            </main>
        </div>
        <?php
    }

    /** @param array<string, mixed> $response */
    private static function renderAtlas(array $response): void
    {
        $output = self::output($response);
        $request = self::request($response);
        $content = (string) ($output['content'] ?? $output['notice'] ?? "AF-27 설비 문서 이관 안내\n\n이전 점검 자료는 별도 보관 위치로 이동되었습니다.");
        $file = self::nested($request, 'query.file', 'notice.txt');
        ?>
        <div class="service-app atlas-app"><header class="atlas-header"><a class="atlas-logo site-link" href="/atlas/viewer?file=notice.txt"><span>△</span><b>ATLAS</b><small>FIELD MANUAL</small></a><div class="atlas-project">Equipment / <b>AF-27 압력 밸브</b>⌄</div><div class="atlas-user">현장 기술자 <i>FT</i></div></header>
            <div class="atlas-workspace"><aside class="file-tree"><div class="tree-heading"><b>AF-27 현장 문서</b><button type="button">⋯</button></div><ul><li class="folder open">▾ public</li><li class="file active"><a class="site-link" href="/atlas/viewer?file=notice.txt">▤ notice.txt</a></li><li class="file"><a class="site-link" href="/atlas/viewer?file=equipment-checklist.md">▤ equipment-checklist.md</a></li><li class="folder locked">▸ private <span>🔒</span></li><li class="folder">▸ archive</li></ul><div class="tree-storage"><span>현장 단말 동기화</span><small>방금 전</small></div></aside>
                <main class="file-viewer"><div class="file-pathbar"><span>/public/</span><code><?= self::h($file) ?></code></div><div class="file-toolbar"><div><b><?= self::h(basename((string) ($output['logical_file'] ?? $file))) ?></b><span><?= self::h($output['zone'] ?? 'public') ?> · TEXT</span></div><div><button type="button">다운로드</button><button type="button">⋯</button></div></div><article class="text-document"><div class="doc-ruler">1<br>2<br>3<br>4<br>5</div><pre><?= self::h($content) ?></pre></article><?php if (isset($output['error'])): ?><div class="file-error">요청한 파일을 열 수 없습니다.</div><?php endif; ?></main>
            </div>
        </div>
        <?php
    }

    /** @param array<string, mixed> $response */
    private static function renderPixelPet(array $response): void
    {
        $output = self::output($response);
        ?>
        <div class="service-app pixelpet-app"><header class="pixelpet-header"><a class="pixelpet-logo site-link" href="/pixelpet/avatar"><span>▦</span><b>PIXELPET</b></a><nav><a>홈</a><a class="active">내 프로필</a><a>친구</a><a>펫 일지</a></nav><div class="pixel-coins">★ 2,480 <i>MO</i></div></header>
            <div class="pixel-bg"><span class="cloud c1"></span><span class="cloud c2"></span><span class="pixel-star s1">✦</span><span class="pixel-star s2">✦</span><main class="profile-card"><div class="pet-preview"><span class="pet-avatar">🐕</span><button type="button">LV. 18</button><h2>보리</h2><p>@bori_on_walk · 산책을 사랑해요</p><div class="pet-stats"><span><b>1,284</b>팔로워</span><span><b>38</b>일지</span><span><b>9</b>배지</span></div></div>
                <section class="avatar-settings"><span class="service-eyebrow">PROFILE SETTINGS</span><h1>프로필 아바타 변경</h1><p>펫을 잘 알아볼 수 있는 정사각형 이미지를 올려주세요.</p><form class="avatar-upload target-action-form" method="post" action="/pixelpet/avatar" enctype="multipart/form-data"><label class="file-dropzone"><span>▧</span><b>이미지 선택</b><small>JPG, PNG, WEBP · 최대 5MB</small><input class="native-file" type="file" name="file" accept="image/jpeg,image/png,image/webp"></label><div class="upload-policy"><span>✓ JPG, PNG, WEBP</span><span>최대 5MB</span></div><button type="submit">새 아바타 저장</button></form>
                    <?php if (array_key_exists('accepted', $output)): ?><div class="upload-result <?= ($output['accepted'] ?? false) ? 'success' : '' ?>"><b><?= ($output['accepted'] ?? false) ? '프로필 이미지가 저장되었습니다' : '파일을 저장할 수 없습니다' ?></b><span><?= ($output['accepted'] ?? false) ? '변경 내용은 잠시 후 반영됩니다.' : '파일 형식과 크기를 확인해 주세요.' ?></span></div><?php endif; ?>
                </section></main></div>
        </div>
        <?php
    }

    /** @param array<string, mixed> $response */
    private static function renderVector(array $response): void
    {
        $output = self::output($response);
        $rows = self::rows($output['records'] ?? []);
        $release = self::array($output['release'] ?? ($rows[0] ?? []));
        $accepted = ($output['accepted'] ?? false) === true || ($response['completed'] ?? false) === true;
        ?>
        <div class="service-app vector-app"><aside class="vector-nav"><a class="vector-logo site-link" href="/vector/approvals"><span>V</span><b>VECTOR</b></a><a>⌂<span>Overview</span></a><a>⌁<span>Projects</span></a><a>◫<span>Deployments</span></a><a class="active">✓<span>Approval gates</span></a><a>⚙<span>Settings</span></a><div class="vector-org"><i>H</i><span>Helix Team<small>Production</small></span></div></aside>
            <main class="vector-main"><header><div><span>PROJECT / VECTOR-API</span><h1>Production approval</h1></div><div class="vector-status"><i></i> All systems operational</div></header><div class="deploy-summary"><div><span>RELEASE</span><b><?= self::h($release['name'] ?? $release['release'] ?? 'vector-api-2026.07.15-rc3') ?></b><small>commit <?= self::h($release['commit'] ?? '9f3a11d') ?></small></div><div><span>ENVIRONMENT</span><b><?= self::h($release['environment'] ?? 'production-apne2') ?></b><small>ap-northeast-2</small></div><div><span>OWNER</span><b><?= self::h($release['owner'] ?? 'Platform API') ?></b><small>External audit</small></div><div><span>RISK</span><b class="risk-medium"><?= self::h(strtoupper((string) ($release['risk'] ?? 'MEDIUM'))) ?></b><small><?= self::h($release['status'] ?? ($accepted ? '승인됨' : '승인 대기')) ?></small></div></div>
                <section class="approval-panel"><div class="approval-head"><div><span class="lock-shield">✓</span><div><h2>관리자 승인 게이트</h2><p>배포 요청의 정책 검증 및 승인 현황입니다.</p></div></div><span class="gate-locked"><?= $accepted ? 'APPROVED' : 'LOCKED' ?></span></div><div style="padding:20px"><div class="site-notice"><b><?= $accepted ? '생산 배포가 승인되었습니다.' : '관리자 승인을 기다리고 있습니다.' ?></b><br><span><?= $accepted ? '릴리스 파이프라인이 진행 중입니다.' : '외부 감사 계정은 배포 정보를 열람할 수 있지만 승인할 수 없습니다.' ?></span></div><button class="vector-approve native-disabled" type="button" disabled style="width:100%;min-height:44px;border:0;border-radius:7px">관리자 승인 필요</button></div></section>
            </main>
        </div>
        <?php
    }

    /** @param array<string, mixed> $response */
    private static function renderLumen(array $response): void
    {
        $output = self::output($response);
        $request = self::request($response);
        $fetched = self::array($output['response'] ?? $output['body'] ?? []);
        $event = self::array($response['event'] ?? []);
        $url = ($event['type'] ?? '') === 'started' ? '' : self::nested($request, 'body.url', '');
        $previewState = self::lumenPreviewState($fetched);
        ?>
        <div class="service-app lumen-app"><header class="lumen-header"><a class="lumen-logo site-link" href="/lumen/cards"><span>◐</span><b>LUMEN</b><small>CAMPAIGN PREVIEW</small></a><nav><a>Workspace</a><a class="active">Campaign cards</a><a>Templates</a><a>Assets</a></nav><div class="lumen-user">2026 Summer Paper <i>SP</i></div></header>
            <div class="lumen-workspace"><aside class="lumen-tools"><span class="service-eyebrow">CAMPAIGN CARDS</span><h1>캠페인 URL을<br>미리 확인하세요.</h1><p>링크를 추가하면 이미지와 페이지 정보를 불러와 캠페인 카드를 만듭니다.</p><form class="target-action-form" method="post" action="/lumen/cards"><label>미리보기 URL<input name="url" value="<?= self::h($url) ?>" placeholder="https://..."></label><button type="submit">미리보기 생성</button></form><div class="allowlist"><b>사용 가능한 링크</b><span>http:// 또는 https:// 주소</span><span>공개된 이미지 및 페이지</span></div></aside>
                <main class="card-canvas"><div class="canvas-toolbar"><span>Preview canvas</span><div><button type="button">50%</button><button type="button">Fit</button></div></div><article class="link-card"><div class="card-image"><span>◐</span><small>CAMPAIGN PREVIEW</small></div><div class="card-copy"><span><?= isset($fetched['assignment_id']) ? 'INTERNAL ASSET' : '2026 SUMMER PAPER' ?></span><h2><?= self::h(isset($fetched['assignment_id']) ? 'Restricted campaign metadata' : '캠페인 카드 미리보기') ?></h2><p><?= self::h($fetched['proof'] ?? $fetched['campaign'] ?? '링크를 입력하면 가져온 이미지와 설명이 여기에 표시됩니다.') ?></p><small><?= self::h($url) ?></small></div></article><?php if (isset($output['error'])): ?><div class="site-notice">해당 링크의 미리보기를 만들 수 없습니다.</div><?php endif; ?></main>
            </div>
            <?php if ($previewState !== []): ?><script type="application/json" id="lumen-preview-state"><?= self::json($previewState) ?></script><?php endif; ?>
        </div>
        <?php
    }

    /** @param array<string, mixed> $response */
    private static function renderNightfall(array $response): void
    {
        $output = self::output($response);
        $request = self::request($response);
        $report = self::array($output['report'] ?? $output['case'] ?? []);
        $activity = self::array($output['activity_feed'] ?? []);
        $records = self::rows($output['records'] ?? []);
        $content = is_string($output['content'] ?? null) ? $output['content'] : '';
        $accepted = ($output['accepted'] ?? false) === true || ($output['token_accepted'] ?? false) === true;
        $vaultOpen = ($output['vault_status'] ?? '') === 'open' || ($response['completed'] ?? false) === true;
        $id = self::nested($request, 'query.id', $output['my_report_id'] ?? $output['self_id'] ?? ($records[0]['id'] ?? ''));
        ?>
        <div class="service-app nightfall-app"><aside class="night-nav"><a class="night-brand site-link" href="/nightfall/reports"><span>NF</span><b>NIGHTFALL</b><small>RELAYOPS</small></a><div class="clearance">CLEARANCE <b>EXTERNAL / AUDIT</b></div><nav><a>▦ <span>Overview</span></a><a class="active" href="/nightfall/reports">◇ <span>Reports</span><i>3</i></a><a>⌁ <span>Evidence</span></a><a>▣ <span>Relay nodes</span></a><a href="/nightfall/reports/vault">⚿ <span>Evidence vault</span></a></nav><div class="night-clock"><span>UTC / LIVE</span><b><?= self::h(gmdate('H:i:s')) ?></b><small>RELAY GRID KR-02</small></div></aside>
            <main class="night-main"><header><div><span>OPERATION / NF-742</span><h1>Incident Command</h1></div><div class="threat-level"><span></span><b>THREAT LEVEL 03</b><small>CONTAINMENT ACTIVE</small></div></header><section class="night-stats"><article><span>OPEN INCIDENTS</span><b>03</b><small>1 critical</small></article><article><span>MONITORED NODES</span><b>128</b><small>127 online</small></article><article><span>EVENTS / MIN</span><b>2.4K</b><small>+12.8%</small></article><article><span>VAULT STATUS</span><b><?= $vaultOpen ? 'OPEN' : 'SEALED' ?></b><small><?= $accepted ? 'authorization accepted' : 'restricted access' ?></small></article></section>
                <div class="night-grid"><section class="incident-panel"><div class="night-panel-head"><div><span>RELAY AUDIT REPORTS</span><h2><?= self::h($report['title'] ?? '운영 보고서') ?></h2></div><span class="severity"><?= self::h($report['severity'] ?? 'RESTRICTED') ?></span></div>
                    <?php if ($report === []): ?><div class="night-form"><a class="night-report-link site-link" href="/nightfall/reports?id=<?= self::h(rawurlencode((string) $id)) ?>"><span>MY ASSIGNED REPORT</span><b>#<?= self::h($id) ?> · Relay K-04 외부 점검 준비</b><small>OPEN REPORT →</small></a></div><?php endif; ?>
                    <?php if ($report !== []): ?><div class="night-form"><div class="case-data"><span><?= self::h($report['station'] ?? 'Relay station') ?></span><code>#<?= self::h($report['id'] ?? '') ?> · <?= self::h($report['owner'] ?? '') ?></code></div><div class="site-notice"><b><?= self::h($report['title'] ?? '') ?></b><br><span><?= nl2br(self::h($report['body'] ?? '')) ?></span></div><?php if (isset($report['verifier_config'])): ?><div class="case-data"><span>ATTACHMENT</span><code><?= self::h($report['verifier_config']) ?></code></div><?php endif; ?></div><?php endif; ?>
                    <?php if ($content !== ''): ?><div class="night-form"><div class="case-data"><span><?= self::h($output['logical_file'] ?? 'ATTACHMENT') ?></span><code>READ ONLY</code></div><pre style="margin:0;padding:15px;border:1px solid #203740;background:#071015;color:#8bc4c5;white-space:pre-wrap;overflow-wrap:anywhere"><?= self::h($content) ?></pre></div><?php endif; ?>
                    <?php if ($accepted): ?><div class="vault-open"><span>✓</span><h2>AUTHORIZATION ACCEPTED</h2><p>요청이 관제 정책을 통과했습니다.</p></div><?php endif; ?>
                    <?php if ($vaultOpen): ?><div class="vault-open"><span>✓</span><h2>RELAY EVIDENCE VAULT OPEN</h2><p>요청한 감사 자료에 접근할 수 있습니다.</p></div><?php endif; ?>
                </section><aside class="night-log"><div class="night-panel-head"><div><span>LIVE EVENT STREAM</span><h2>Audit log</h2></div><i></i></div><div class="log-lines"><p><time><?= self::h(gmdate('H:i:s')) ?></time><b>AUTH</b>Contractor session established</p><p><time><?= self::h(gmdate('H:i:s', time() - 18)) ?></time><b>CASE</b><?= self::h($activity['message'] ?? 'Relay report index synchronized') ?></p><p><time><?= self::h(gmdate('H:i:s', time() - 41)) ?></time><b>NODE</b>Verifier-02 heartbeat received</p><p><time><?= self::h(gmdate('H:i:s', time() - 56)) ?></time><b>SYS</b>Containment policy active</p></div><?php foreach ($records as $row): ?><div class="site-notice" style="margin-inline:13px"><a class="site-link" href="/nightfall/reports?id=<?= self::h(rawurlencode((string) ($row['id'] ?? ''))) ?>"><b>#<?= self::h($row['id'] ?? '') ?> · <?= self::h($row['station'] ?? '') ?></b><br><?= self::h($row['title'] ?? '') ?></a></div><?php endforeach; ?></aside></div>
            </main>
        </div>
        <?php
    }

    public static function renderUnavailable(string $message = '주소를 확인한 뒤 다시 시도해 주세요.', int $status = 404): void
    {
        $cssPath = dirname(__DIR__) . '/public/assets/targets.css';
        $cssVersion = is_file($cssPath) ? (string) filemtime($cssPath) : '1';
        echo '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
        echo '<meta name="robots" content="noindex,nofollow,noarchive"><title>서비스 연결 오류</title>';
        echo '<link rel="stylesheet" href="/assets/targets.css?v=' . self::h($cssVersion) . '"></head><body class="target-body">';
        echo '<div class="service-app"><main class="target-expired"><span class="target-expired-mark">SERVICE / ' . self::h($status) . '</span>';
        echo '<h1>서비스에 연결할 수 없습니다</h1><p>' . self::h($message) . '</p></main></div></body></html>';
    }

    private static function renderUnavailableBody(): void
    {
        echo '<div class="service-app"><main class="target-expired"><span class="target-expired-mark">SERVICE / 404</span>';
        echo '<h1>페이지를 찾을 수 없습니다</h1><p>주소를 확인한 뒤 다시 시도해 주세요.</p></main></div>';
    }

    /** @param array<string, mixed> $response @return array<string, mixed> */
    private static function output(array $response): array
    {
        return self::array($response['output'] ?? []);
    }

    /** @param array<string, mixed> $response @return array<string, mixed> */
    private static function request(array $response): array
    {
        return self::array($response['request'] ?? []);
    }

    /** @return array<string, mixed> */
    private static function array(mixed $value): array
    {
        return is_array($value) ? $value : [];
    }

    /** @return list<array<string, mixed>> */
    private static function rows(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }
        $rows = [];
        foreach ($value as $row) {
            if (is_array($row)) {
                $rows[] = $row;
            }
        }
        return $rows;
    }

    /** @param array<string, mixed> $source */
    private static function nested(array $source, string $path, mixed $fallback = ''): mixed
    {
        $value = $source;
        foreach (explode('.', $path) as $segment) {
            if (!is_array($value) || !array_key_exists($segment, $value)) {
                return $fallback;
            }
            $value = $value[$segment];
        }
        return $value;
    }

    private static function h(mixed $value): string
    {
        if (is_bool($value)) {
            $value = $value ? 'true' : 'false';
        } elseif (!is_scalar($value) && $value !== null) {
            $value = '';
        }
        return wargame_html((string) $value);
    }

    /**
     * Keep only the preview data the campaign editor itself consumes. Internal
     * source coordinates remain inspectable in page state without exposing the
     * engine's implementation labels or response bookkeeping.
     *
     * @param array<string, mixed> $fetched
     * @return array<string, mixed>
     */
    private static function lumenPreviewState(array $fetched): array
    {
        if ($fetched === []) {
            return [];
        }

        $state = [];
        foreach (['asset', 'campaign', 'dimensions', 'bytes', 'palette', 'assignment_id', 'service', 'workspace', 'network_zone', 'proof'] as $key) {
            if (array_key_exists($key, $fetched)) {
                $state[$key] = $fetched[$key];
            }
        }

        $source = self::array($fetched['debug'] ?? []);
        if ($source !== []) {
            $state['source'] = [
                'worker' => $source['requester'] ?? null,
                'host' => $source['metadata_host'] ?? null,
                'path' => $source['metadata_endpoint'] ?? null,
            ];
        }

        return $state;
    }

    /** @param array<string, mixed> $value */
    private static function json(array $value): string
    {
        return (string) json_encode(
            $value,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_INVALID_UTF8_SUBSTITUTE
        );
    }
}
