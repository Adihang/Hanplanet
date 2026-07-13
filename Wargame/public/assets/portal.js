(() => {
    'use strict';

    const root = document.documentElement;
    const body = document.body;

    const wargameMermaidSources = {
        operations: [
            'flowchart TB',
            '    operator[OPERATOR] -->|authorized session| gateway[LAB GATE]',
            '    gateway -->|isolated access| target[WEB TARGET]',
            '    target --> database[(SQLite)]',
            '    target --> virtualNetwork[V-NET]',
            '    target --> terminal[TERMINAL]',
        ].join('\n'),
        'http-flow': [
            'flowchart LR',
            '    browser[브라우저] -->|HTTP 요청| server[훈련 서버]',
            '    server -->|상태 코드 · 헤더 · 본문| browser',
            '    browser --> network[Network 패널에서 관찰]',
        ].join('\n'),
        'access-control': [
            'flowchart TB',
            '    client[클라이언트 값: role=admin] --> decision{서버가 인가를 검증하는가?}',
            '    decision -->|아니오| exposed[다른 사용자의 자원 노출]',
            '    decision -->|예| policy[세션 역할 + 자원 소유자 확인]',
            '    policy --> result[허용 또는 거부]',
        ].join('\n'),
        'sql-injection': [
            'flowchart TB',
            '    input[특수문자를 포함한 사용자 입력] --> concat[문자열 직접 결합]',
            '    concat --> changed[SQL 조건의 의미 변경]',
            '    input --> binding[Prepared statement 바인딩]',
            '    binding --> value[입력을 값으로만 처리]',
        ].join('\n'),
        'xss-context': [
            'flowchart LR',
            '    input[검색 입력] --> template[HTML 문자열 결합]',
            '    template --> parser[브라우저 HTML 파서]',
            '    parser --> event[이벤트 핸들러 실행]',
            '    event --> sandbox[격리된 sandbox]',
            '    input --> safe[textContent로 출력]',
        ].join('\n'),
        'filesystem-boundary': [
            'flowchart TB',
            '    path[사용자 제공 경로 또는 파일명] --> resolve[정규화와 경로 해석]',
            '    resolve --> boundary{인스턴스 루트 안인가?}',
            '    boundary -->|아니오| reject[요청 차단]',
            '    boundary -->|예| resource[훈련용 파일 접근]',
            '    upload[업로드 파일] --> generated[서버 생성 이름으로 별도 저장]',
        ].join('\n'),
        'server-trust-chain': [
            'flowchart TB',
            '    request[요청] --> token[JWT 또는 세션 정보]',
            '    token --> verify{서명 · 만료 · 대상 검증}',
            '    verify -->|실패| reject[요청 거부]',
            '    verify -->|통과| app[훈련 애플리케이션]',
            '    app --> outbound{허용된 가상 서비스인가?}',
            '    outbound -->|예| service[격리된 내부 서비스]',
            '    outbound -->|아니오| blocked[외부 연결 차단]',
        ].join('\n'),
    };
    let wargameMermaidRenderSequence = 0;

    const themeColor = (name, fallback) => {
        const value = getComputedStyle(root).getPropertyValue(name).trim();
        return value || fallback;
    };

    function renderWargameMermaidDiagrams() {
        if (!window.mermaid || typeof window.mermaid.render !== 'function') return;

        const diagrams = Array.from(document.querySelectorAll('[data-wargame-mermaid]')).filter((diagram) => {
            return Boolean(wargameMermaidSources[diagram.dataset.wargameMermaid || '']);
        });
        if (!diagrams.length) return;

        const renderSequence = ++wargameMermaidRenderSequence;
        const text = themeColor('--text', '#ecf3f0');
        const surface = themeColor('--surface-strong', '#10232d');
        const surfaceSoft = themeColor('--surface-soft', '#0b1a23');
        const line = themeColor('--line-bright', '#345d68');
        const muted = themeColor('--muted', '#76909a');
        const accent = themeColor('--accent', '#72f1c5');

        window.mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: 'base',
            flowchart: { htmlLabels: false, useMaxWidth: true },
            themeVariables: {
                background: 'transparent',
                primaryColor: surface,
                primaryTextColor: text,
                primaryBorderColor: line,
                secondaryColor: surfaceSoft,
                secondaryTextColor: text,
                secondaryBorderColor: line,
                tertiaryColor: surface,
                tertiaryTextColor: text,
                tertiaryBorderColor: line,
                lineColor: muted,
                textColor: text,
                edgeLabelBackground: surface,
                nodeBorder: line,
                nodeTextColor: text,
                arrowheadColor: accent,
            },
        });

        diagrams.forEach((diagram, index) => {
            const source = wargameMermaidSources[diagram.dataset.wargameMermaid || ''];
            Promise.resolve(window.mermaid.render(`wargame-mermaid-${renderSequence}-${index}`, source))
                .then((result) => {
                    if (renderSequence !== wargameMermaidRenderSequence || !result?.svg) return;
                    const output = document.createElement('div');
                    output.className = 'wargame-mermaid-output';
                    output.innerHTML = result.svg;
                    diagram.replaceChildren(output);
                    diagram.classList.remove('is-unavailable');
                    diagram.classList.add('is-rendered');
                    if (typeof result.bindFunctions === 'function') result.bindFunctions(output);
                })
                .catch(() => {
                    if (renderSequence !== wargameMermaidRenderSequence) return;
                    diagram.classList.add('is-unavailable');
                });
        });
    }

    document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
        const nextTheme = root.dataset.theme === 'light' ? 'dark' : 'light';
        root.dataset.theme = nextTheme;
        localStorage.setItem('wargame-theme', nextTheme);
        renderWargameMermaidDiagrams();
    });

    const accountMenuTrigger = document.querySelector('[data-account-menu-trigger]');
    const accountMenu = document.querySelector('[data-account-menu]');
    const setAccountMenuOpen = (opened) => {
        if (!accountMenu || !accountMenuTrigger) return;
        accountMenu.hidden = !opened;
        accountMenuTrigger.setAttribute('aria-expanded', String(opened));
    };

    accountMenuTrigger?.addEventListener('click', () => {
        setAccountMenuOpen(accountMenu?.hidden ?? false);
    });

    document.addEventListener('click', (event) => {
        if (!accountMenu || accountMenu.hidden || !accountMenuTrigger) return;
        if (accountMenu.contains(event.target) || accountMenuTrigger.contains(event.target)) return;
        setAccountMenuOpen(false);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !accountMenu || accountMenu.hidden) return;
        event.preventDefault();
        setAccountMenuOpen(false);
        accountMenuTrigger?.focus();
    });

    document.querySelectorAll('[data-copy-target]').forEach((button) => {
        button.addEventListener('click', async () => {
            const target = document.getElementById(button.dataset.copyTarget || '');
            if (!target) return;
            try {
                await navigator.clipboard.writeText(target.textContent || '');
                const original = button.textContent;
                button.textContent = 'COPIED';
                window.setTimeout(() => { button.textContent = original; }, 1200);
            } catch (_) {
                button.textContent = 'FAILED';
            }
        });
    });

    document.querySelectorAll('form[data-loading-form]').forEach((form) => {
        form.addEventListener('submit', () => {
            const button = form.querySelector('button[type="submit"]');
            if (!button) return;
            button.classList.add('is-loading');
            button.setAttribute('aria-busy', 'true');
            button.textContent = button.dataset.loadingLabel || '처리 중…';
        });
    });

    const syncAccount = async () => {
        if (body.dataset.needsAuthRefresh !== '1') return;
        const sessionUrl = body.dataset.djangoSessionUrl;
        const csrf = body.dataset.csrf;
        if (!sessionUrl || !csrf) return;

        const bridge = document.querySelector('[data-account-bridge]');
        if (bridge) bridge.textContent = '계정 확인 중…';
        try {
            const response = await fetch(sessionUrl, {
                method: 'GET',
                credentials: 'include',
                headers: { 'Accept': 'application/json' },
            });
            if (!response.ok) throw new Error('session_request_failed');
            const payload = await response.json();
            if (!payload.authenticated || !payload.token) {
                if (bridge) bridge.textContent = '로그인 필요';
                return;
            }

            const form = new FormData();
            form.set('action', 'connect_account');
            form.set('csrf_token', csrf);
            form.set('django_token', payload.token);
            const connected = await fetch('/', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Accept': 'application/json', 'X-Requested-With': 'fetch' },
                body: form,
            });
            if (!connected.ok) throw new Error('portal_session_failed');
            const result = await connected.json();
            if (result.authenticated) window.location.reload();
        } catch (_) {
            if (bridge) bridge.textContent = '계정 연결 실패';
        }
    };

    renderWargameMermaidDiagrams();
    syncAccount();
})();
