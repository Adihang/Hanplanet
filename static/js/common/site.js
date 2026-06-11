    // site.js — Hanplanet 공용 프론트엔드 엔트리.
    // 테마, 공용 네비게이션, 배경/인쇄 표면 처리, 검색/팝업이 아닌
    // 기본 사이트 상호작용을 한곳에서 초기화한다.
document.addEventListener('DOMContentLoaded', function () {
    // 페이지 배경을 강제로 바꿔야 하는 인쇄/라이트 서피스 override 에서 공통으로 쓰는 색 값.
    const SURFACE_COLOR = {
        light: '#ffffff',
        dark: '#222222',
        transparent: 'transparent'
    };

    // 페이지 종류를 보고 "항상 밝은 콘텐츠 표면"을 유지해야 하는 화면을 먼저 판정한다.
    const currentPath = window.location.pathname;
    const localizedLightBgPattern = /^\/(?:ko|en)\/(?:portfolio\/?|project\/\d+\/?|handrive(?:\/.*)?)$/;
    const isLightBackgroundPage = document.body.classList.contains('portfolio-page') ||
        document.body.classList.contains('project-page') ||
        document.body.classList.contains('handrive-page') ||
        document.body.classList.contains('handrive-page') ||
        currentPath === '/portfolio/' ||
        currentPath === '/portfolio' ||
        currentPath === '/handrive/' ||
        currentPath === '/handrive' ||
        currentPath.startsWith('/handrive/') ||
        currentPath.startsWith('/project/') ||
        localizedLightBgPattern.test(currentPath);
    // 아래 공통 상태들은 테마 전환, bubble 배경, navbar, print override 가 함께 공유한다.
    const bubbleCanvas = document.getElementById('interactiveBubbleCanvas');
    const portfolioMainLayer = document.querySelector('.main-surface-layer');
    const bubbleLayer = document.querySelector('.bubble-bg-layer');
    const themeToggle = document.querySelector('.ui-theme-toggle');
    const themeToggleButtons = themeToggle
        ? Array.from(themeToggle.querySelectorAll('.ui-control-link[data-theme-mode]'))
        : [];
    const languageToggleButtons = Array.from(document.querySelectorAll('.ui-lang-link[data-ui-lang-mode]'));
    const THEME_MODE_STORAGE_KEY = 'portfolio_theme_mode';
    const THEME_MODE_COOKIE_KEY = 'portfolio_theme_mode';
    const UI_LANG_COOKIE_KEY = 'portfolio_ui_lang';
    const COOKIE_MAX_AGE_SECONDS = 31536000;
    const SYSTEM_DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';
    const ACCOUNT_THEME_MODE_KEY = (document.documentElement.dataset.accountThemeMode || '').trim().toLowerCase();
    const THEME_PREFERENCE_URL = (document.body.dataset.themePreferenceUrl || '').trim();
    const IS_AUTHENTICATED_USER = document.body.dataset.authenticated === '1';
    const csrfMeta = document.querySelector('meta[name="csrf-token"]');
    const CSRF_TOKEN = csrfMeta ? csrfMeta.getAttribute('content') : '';
    // beforeprint / afterprint 사이에 원래 inline style 을 복원하기 위한 스냅샷.
    const printSurfaceSnapshot = {
        active: false,
        htmlStyle: null,
        bodyStyle: null,
        bubbleLayerStyle: null,
        bubbleCanvasStyle: null
    };

    // Theme state is split so manual overrides can coexist with system-following behavior.
    let currentSurfaceMode = null;
    let manualThemeMode = null;
    let followsSystemTheme = false;

    // 메뉴바 숨김/복원 스크롤 상태.
    const navbar = document.querySelector('.ui-nav');
    let lastScrollTop = 0;
    let scrollTimer = null;
    let isNavbarHidden = false;

    // Hide-on-scroll behavior is shared by pages that use the common top navigation bar.
    const handleNavbarScroll = function () {
        if (!navbar) return;

        const currentScrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollDirection = currentScrollTop > lastScrollTop ? 'down' : 'up';
        const scrollDistance = Math.abs(currentScrollTop - lastScrollTop);

        // 스크롤이 일정 거리 이상일 때만 처리
        if (scrollDistance > 10) {
            if (scrollDirection === 'down' && currentScrollTop > 100 && !isNavbarHidden) {
                // 아래로 스크롤 시 메뉴바 숨김
                navbar.classList.add('navbar-hidden');
                isNavbarHidden = true;
            } else if (scrollDirection === 'up' && isNavbarHidden) {
                // 위로 스크롤 시 메뉴바 표시
                navbar.classList.remove('navbar-hidden');
                isNavbarHidden = false;
            }
        }

        lastScrollTop = currentScrollTop;
    };

    // Throttle to one layout-sensitive navbar update per frame-ish interval.
    const throttledHandleNavbarScroll = function () {
        if (scrollTimer) {
            return;
        }
        scrollTimer = window.setTimeout(function () {
            handleNavbarScroll();
            scrollTimer = null;
        }, 16); // 약 60fps
    };

    // Background overrides are centralized here so print/theme code always resets the same properties.
    const setSurfaceBackground = function (element, color) {
        if (!element) {
            return;
        }

        element.style.background = color;
        element.style.backgroundColor = color;
        element.style.backgroundImage = 'none';
    };

    // Restore inline styles exactly after temporary print overrides are removed.
    const restoreStyleAttribute = function (element, styleText) {
        if (!element) {
            return;
        }

        if (styleText === null || typeof styleText === 'undefined') {
            element.removeAttribute('style');
            return;
        }

        element.setAttribute('style', styleText);
    };

    // Print mode forces light surfaces so exported pages do not inherit dark UI backgrounds.
    const applyPrintSurfaceOverride = function () {
        if (!isLightBackgroundPage || printSurfaceSnapshot.active) {
            return;
        }

        printSurfaceSnapshot.active = true;
        printSurfaceSnapshot.htmlStyle = document.documentElement.getAttribute('style');
        printSurfaceSnapshot.bodyStyle = document.body.getAttribute('style');
        printSurfaceSnapshot.bubbleLayerStyle = bubbleLayer ? bubbleLayer.getAttribute('style') : null;
        printSurfaceSnapshot.bubbleCanvasStyle = bubbleCanvas ? bubbleCanvas.getAttribute('style') : null;

        setSurfaceBackground(document.documentElement, SURFACE_COLOR.light);
        setSurfaceBackground(document.body, SURFACE_COLOR.light);

        if (bubbleLayer) {
            bubbleLayer.style.display = 'block';
            bubbleLayer.style.visibility = 'visible';
            setSurfaceBackground(bubbleLayer, SURFACE_COLOR.transparent);
        }

        if (bubbleCanvas) {
            bubbleCanvas.style.display = 'none';
            bubbleCanvas.style.visibility = 'hidden';
        }
    };

    // Return the page to its pre-print visual state once the browser leaves print mode.
    const clearPrintSurfaceOverride = function () {
        if (!printSurfaceSnapshot.active) {
            return;
        }

        restoreStyleAttribute(document.documentElement, printSurfaceSnapshot.htmlStyle);
        restoreStyleAttribute(document.body, printSurfaceSnapshot.bodyStyle);
        restoreStyleAttribute(bubbleLayer, printSurfaceSnapshot.bubbleLayerStyle);
        restoreStyleAttribute(bubbleCanvas, printSurfaceSnapshot.bubbleCanvasStyle);

        printSurfaceSnapshot.active = false;
    };

    window.addEventListener('beforeprint', applyPrintSurfaceOverride);
    window.addEventListener('afterprint', clearPrintSurfaceOverride);

    // Some pages inject dedicated light-surface style blocks that are toggled as one unit.
    const setLightSurfaceStylesEnabled = function (enabled) {
        const mediaValue = enabled ? 'all' : 'not all';
        const taggedStyles = document.querySelectorAll('style[data-surface-light]');

        taggedStyles.forEach(function (styleElement) {
            styleElement.media = mediaValue;
        });

        const legacyStyles = document.querySelectorAll('style:not([data-surface-light])');
        legacyStyles.forEach(function (styleElement) {
            const cssText = styleElement.textContent || '';
            const isLegacySurfaceStyle = cssText.includes('preload-light-bg') ||
                (cssText.includes('interactiveBubbleCanvas') && cssText.includes('#ffffff')) ||
                (cssText.includes('body') && cssText.includes('#ffffff') && cssText.includes('background'));

            if (!isLegacySurfaceStyle) {
                return;
            }

            styleElement.media = mediaValue;
        });
    };

    // .hanplanet.com 공유 쿠키에서 테마 읽기
    const readThemeCookie = function () {
        try {
            const m = document.cookie.match(/(?:^|;\s*)portfolio_theme_mode=([^;]+)/);
            if (m) return decodeURIComponent(m[1]);
        } catch (error) {}
        return null;
    };

    const writePreferenceCookie = function (name, value) {
        try {
            const normalizedName = encodeURIComponent(String(name || ''));
            const normalizedValue = encodeURIComponent(String(value || ''));
            const maxAge = value ? COOKIE_MAX_AGE_SECONDS : 0;
            const cookie = normalizedName + '=' + normalizedValue + '; path=/; max-age=' + maxAge + '; SameSite=Lax';
            document.cookie = cookie;

            const hostname = String(window.location.hostname || '').toLowerCase();
            if (hostname === 'hanplanet.com' || hostname.endsWith('.hanplanet.com')) {
                document.cookie = cookie + '; domain=.hanplanet.com';
            }
        } catch (error) {}
    };

    // .hanplanet.com 공유 쿠키와 현재 host 쿠키에 테마 쓰기
    const writeThemeCookie = function (value) {
        writePreferenceCookie(THEME_MODE_COOKIE_KEY, value);
    };

    const writeUiLangCookie = function (value) {
        if (value !== 'ko' && value !== 'en') {
            return;
        }
        writePreferenceCookie(UI_LANG_COOKIE_KEY, value);
    };

    // Read theme preference from the widest shared scope first, then local page storage.
    const readStoredThemeMode = function () {
        try {
            const cookieMode = readThemeCookie();
            const storedMode = cookieMode || window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
            if (storedMode === 'dark') {
                return true;
            }
            if (storedMode === 'light') {
                return false;
            }
        } catch (error) {}
        return null;
    };

    // Account theme preference wins when the user is authenticated and a profile preference exists.
    const readAccountThemeMode = function () {
        if (ACCOUNT_THEME_MODE_KEY === 'dark') {
            return true;
        }
        if (ACCOUNT_THEME_MODE_KEY === 'light') {
            return false;
        }
        return null;
    };

    // Persist the browser-side theme so subdomains and later visits stay in sync.
    const persistThemeMode = function (darkMode) {
        try {
            if (darkMode === true) {
                window.localStorage.setItem(THEME_MODE_STORAGE_KEY, 'dark');
                writeThemeCookie('dark');
                return;
            }
            if (darkMode === false) {
                window.localStorage.setItem(THEME_MODE_STORAGE_KEY, 'light');
                writeThemeCookie('light');
                return;
            }
            window.localStorage.removeItem(THEME_MODE_STORAGE_KEY);
            writeThemeCookie('');
        } catch (error) {}
    };

    // System preference is the final fallback when neither account nor browser storage has a choice.
    const readSystemThemeMode = function () {
        if (!window.matchMedia) {
            return false;
        }
        return window.matchMedia(SYSTEM_DARK_MEDIA_QUERY).matches;
    };

    // Keep the server-side preference aligned so authenticated pages render with the same theme immediately.
    const persistThemeModeToAccount = function (darkMode) {
        if (!IS_AUTHENTICATED_USER || !THEME_PREFERENCE_URL || !window.fetch || !CSRF_TOKEN) {
            return;
        }

        const modeValue = darkMode ? 'dark' : 'light';
        window.fetch(THEME_PREFERENCE_URL, {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': CSRF_TOKEN
            },
            body: JSON.stringify({ mode: modeValue })
        }).catch(function () {});
    };

    // 테마 토글 버튼 상태를 동기화하는 함수
    const syncThemeToggleState = function () {
        if (!themeToggle) {
            return;
        }
        themeToggle.style.display = '';
        const darkActive = Boolean(currentSurfaceMode);

        themeToggleButtons.forEach(function (button) {
            const isDarkButton = button.dataset.themeMode === 'dark';
            const isActive = isDarkButton === darkActive;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    };

    // 페이지 표면 모드를 적용하는 함수
    const applyPageSurfaceMode = function (useDarkTheme) {
        currentSurfaceMode = useDarkTheme;
        document.body.classList.toggle('theme-dark', useDarkTheme);

        if (useDarkTheme) {
            document.documentElement.classList.remove('preload-light-bg');
            document.documentElement.classList.add('preload-dark-bg');
        } else {
            document.documentElement.classList.remove('preload-dark-bg');
            document.documentElement.classList.add('preload-light-bg');
        }

        if (!isLightBackgroundPage) {
            return;
        }

        const surfaceColor = useDarkTheme ? SURFACE_COLOR.dark : SURFACE_COLOR.light;
        setLightSurfaceStylesEnabled(!useDarkTheme);
        setSurfaceBackground(document.documentElement, surfaceColor);
        setSurfaceBackground(document.body, surfaceColor);

        if (portfolioMainLayer) {
            portfolioMainLayer.style.backgroundColor = 'transparent';
        }

        if (bubbleLayer) {
            bubbleLayer.style.display = 'block';
            setSurfaceBackground(bubbleLayer, surfaceColor);
        }

        if (bubbleCanvas) {
            setSurfaceBackground(bubbleCanvas, surfaceColor);
        }
    };

    // 테마 모드를 적용하는 함수
    const applyThemeMode = function () {
        applyPageSurfaceMode(Boolean(manualThemeMode));
        syncThemeToggleState();
    };

    // 수동 테마 모드를 설정하는 함수
    const setManualThemeMode = function (useDarkTheme) {
        followsSystemTheme = false;
        manualThemeMode = Boolean(useDarkTheme);
        persistThemeMode(manualThemeMode);
        persistThemeModeToAccount(manualThemeMode);
        applyThemeMode();
    };

    manualThemeMode = readAccountThemeMode();
    if (manualThemeMode !== null) {
        persistThemeMode(manualThemeMode);
    }
    if (manualThemeMode === null) {
        manualThemeMode = readStoredThemeMode();
    }
    if (manualThemeMode === null) {
        followsSystemTheme = true;
        manualThemeMode = readSystemThemeMode();
    }

    if (window.matchMedia) {
        const systemThemeMediaQuery = window.matchMedia(SYSTEM_DARK_MEDIA_QUERY);
        const handleSystemThemeChange = function (event) {
            if (!followsSystemTheme) {
                return;
            }

            manualThemeMode = Boolean(event.matches);
            applyThemeMode();
        };

        if (typeof systemThemeMediaQuery.addEventListener === 'function') {
            systemThemeMediaQuery.addEventListener('change', handleSystemThemeChange);
        } else if (typeof systemThemeMediaQuery.addListener === 'function') {
            systemThemeMediaQuery.addListener(handleSystemThemeChange);
        }
    }

    themeToggleButtons.forEach(function (button) {
        button.addEventListener('click', function (event) {
            event.preventDefault();
            const useDarkTheme = button.dataset.themeMode === 'dark';
            setManualThemeMode(useDarkTheme);
        });
    });

    languageToggleButtons.forEach(function (button) {
        button.addEventListener('click', function () {
            writeUiLangCookie(String(button.dataset.uiLangMode || '').trim().toLowerCase());
        });
    });

    applyThemeMode();
    window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
            document.body.classList.remove('theme-preinit');
        });
    });

    // 중첩 스크롤 우선순위를 활성화하는 함수
    // 페이지 자체가 먼저 휠 이벤트를 먹지 않도록, 안쪽 스크롤 컨테이너가
    // 실제로 더 스크롤할 수 있는 경우에는 그 요소가 우선 소비하게 만든다.
    const enableNestedScrollPriority = function () {
        // 오버플로우 스크롤 가능 여부를 확인하는 함수
        const canUseOverflowScroll = function (overflowValue) {
            return overflowValue === 'auto' || overflowValue === 'scroll' || overflowValue === 'overlay';
        };

        // Y축 스크롤 가능 여부를 확인하는 함수
        const hasScrollableY = function (element, style) {
            return canUseOverflowScroll(style.overflowY) && (element.scrollHeight - element.clientHeight) > 1;
        };

        // X축 스크롤 가능 여부를 확인하는 함수
        const hasScrollableX = function (element, style) {
            return canUseOverflowScroll(style.overflowX) && (element.scrollWidth - element.clientWidth) > 1;
        };

        // Y축 델타 값을 소비할 수 있는지 확인하는 함수
        const canConsumeY = function (element, deltaY) {
            if (deltaY < 0) {
                return element.scrollTop > 0;
            }

            if (deltaY > 0) {
                const maxScrollTop = element.scrollHeight - element.clientHeight;
                return element.scrollTop < maxScrollTop - 1;
            }

            return false;
        };

        // X축 델타 값을 소비할 수 있는지 확인하는 함수
        const canConsumeX = function (element, deltaX) {
            if (deltaX < 0) {
                return element.scrollLeft > 0;
            }

            if (deltaX > 0) {
                const maxScrollLeft = element.scrollWidth - element.clientWidth;
                return element.scrollLeft < maxScrollLeft - 1;
            }

            return false;
        };

        // 휠 델타 값을 정규화하는 함수
        const normalizeWheelDelta = function (delta, deltaMode) {
            if (deltaMode === 1) {
                return delta * 16;
            }

            if (deltaMode === 2) {
                return delta * window.innerHeight;
            }

            return delta;
        };

        // 편집 가능한 요소인지 확인하는 함수
        const isEditableElement = function (element) {
            if (!element || !element.closest) {
                return false;
            }

            return Boolean(element.closest('input, textarea, select, option, [contenteditable="true"]'));
        };

        document.addEventListener('wheel', function (event) {
            if (event.defaultPrevented || event.ctrlKey) {
                return;
            }

            const eventTarget = event.target;
            if (!(eventTarget instanceof Element) || isEditableElement(eventTarget)) {
                return;
            }

            let deltaX = normalizeWheelDelta(event.deltaX, event.deltaMode);
            let deltaY = normalizeWheelDelta(event.deltaY, event.deltaMode);

            if (Math.abs(deltaX) < 0.01 && Math.abs(deltaY) < 0.01) {
                return;
            }

            let current = eventTarget;
            while (current && current !== document.body && current !== document.documentElement) {
                if (!(current instanceof HTMLElement)) {
                    current = current.parentElement;
                    continue;
                }

                const style = window.getComputedStyle(current);
                const canScrollY = hasScrollableY(current, style);
                const canScrollX = hasScrollableX(current, style);

                if (!canScrollX && !canScrollY) {
                    current = current.parentElement;
                    continue;
                }

                if (canScrollY && canConsumeY(current, deltaY)) {
                    current.scrollTop += deltaY;
                    event.preventDefault();
                    return;
                }

                let horizontalDelta = deltaX;
                const isYtoXFallback = Math.abs(horizontalDelta) < 0.01 && Math.abs(deltaY) > 0.01;
                if (isYtoXFallback) {
                    horizontalDelta = deltaY;
                }

                if (canScrollX && canConsumeX(current, horizontalDelta)) {
                    if (isYtoXFallback && current.closest('[data-scroll-y-priority]')) {
                        current = current.parentElement;
                        continue;
                    }
                    current.scrollLeft += horizontalDelta;
                    event.preventDefault();
                    return;
                }

                current = current.parentElement;
            }
        }, { passive: false });
    };

    enableNestedScrollPriority();

    // 인터랙티브 버블 배경을 초기화하는 함수
    // Bubble 페이지에서만 쓰는 독립적인 캔버스 장면이라 관련 수학/렌더 helper를
    // 이 클로저 안에 묶어 다른 페이지 전역 상태와 섞이지 않게 유지한다.
    const initInteractiveBubbleBackground = function (canvas) {
        const ctx = canvas.getContext('2d');

        if (!ctx) {
            return;
        }

        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const pointer = { x: 0, y: 0, active: false };
        const bubbles = [];
        const popEffects = [];
        let width = 0;
        let height = 0;
        let viewportMinDimension = 0;
        let topInset = 0;
        let rafBubbleId = null;
        let lastFrameTime = 0;
        let bubblesExhausted = false;
        let hasInitializedBubbles = false;
        let respawnTimerId = null;
        const isBubbleFunPage = document.body.classList.contains('bubble-page');
        const bubbleRespawnDelayMs = prefersReducedMotion ? 260 : 420;
        const bubblePhysicsConfig = {
            wallPopSpeedThreshold: prefersReducedMotion ? 12.31 : 10.65,
            bubblePopImpactThreshold: prefersReducedMotion ? 11.31 : 9.65,
            fixedBubbleCount: 7,
            pointerReactionPadding: 180,
            pointerKeepOutPadding: 32
        };

        // 최소값과 최대값 사이의 랜덤 값을 생성하는 함수
        const randomBetween = function (min, max) {
            return Math.random() * (max - min) + min;
        };

        // 값을 0-1 사이로 제한하는 함수
        const clampUnit = function (value) {
            return Math.min(1, Math.max(0, value));
        };

        // CMYK 색상을 RGB로 변환하는 함수
        const cmykToRgb = function (c, m, y, k) {
            const cyan = clampUnit(c);
            const magenta = clampUnit(m);
            const yellow = clampUnit(y);
            const black = clampUnit(k);

            return {
                r: Math.round(255 * (1 - cyan) * (1 - black)),
                g: Math.round(255 * (1 - magenta) * (1 - black)),
                b: Math.round(255 * (1 - yellow) * (1 - black))
            };
        };

        // 값을 0-255 바이트로 제한하는 함수
        const clampByte = function (value) {
            return Math.min(255, Math.max(0, Math.round(value)));
        };

        // RGB 색상을 CSS 문자열로 변환하는 함수
        const rgbToCss = function (color) {
            return 'rgb(' + color.r + ', ' + color.g + ', ' + color.b + ')';
        };

        // RGB 색상에서 RGBA를 생성하는 함수
        const rgbaFrom = function (color, alpha) {
            return 'rgba(' + color.r + ', ' + color.g + ', ' + color.b + ', ' + alpha + ')';
        };

        // RGB 색상을 반전시키는 함수
        const invertRgb = function (color) {
            return {
                r: 255 - color.r,
                g: 255 - color.g,
                b: 255 - color.b
            };
        };

        // 두 RGB 색상을 혼합하는 함수
        const mixRgb = function (fromColor, toColor, ratio) {
            const t = clampUnit(ratio);
            return {
                r: clampByte(fromColor.r + ((toColor.r - fromColor.r) * t)),
                g: clampByte(fromColor.g + ((toColor.g - fromColor.g) * t)),
                b: clampByte(fromColor.b + ((toColor.b - fromColor.b) * t))
            };
        };

        // 버블 시각 팔레트를 구축하는 함수
        const buildBubbleVisualPalette = function (backgroundColor) {
            const inverse = invertRgb(backgroundColor);
            const white = { r: 255, g: 255, b: 255 };
            const black = { r: 0, g: 0, b: 0 };

            return {
                bodyCore: mixRgb(inverse, white, 0.12),
                bodyMid: mixRgb(inverse, white, 0.02),
                bodyEdge: mixRgb(inverse, black, 0.2),
                innerShadow: mixRgb(inverse, black, 0.44),
                highlight: mixRgb(inverse, white, 0.45),
                stroke: mixRgb(inverse, white, 0.2),
                popRing: mixRgb(inverse, white, 0.26),
                popFlash: mixRgb(inverse, white, 0.48),
                popParticle: mixRgb(inverse, black, 0.08)
            };
        };

        let bubbleVisualPalette = buildBubbleVisualPalette({ r: 191, g: 191, b: 191 });

        // 랜덤 버블 배경색을 선택하는 함수
        const pickRandomBubbleBackgroundColor = function () {
            // Keep a consistent tone by fixing K and keeping total C+M+Y ink in a narrow band.
            const k = randomBetween(0.2, 0.28);
            const targetInk = randomBetween(0.92, 1.18);
            const neutralMix = randomBetween(0.05, 0.12);
            const weights = [
                Math.random() + 0.08,
                Math.random() + 0.08,
                Math.random() + 0.08
            ];
            const weightSum = weights[0] + weights[1] + weights[2];

            let c = (targetInk * weights[0]) / weightSum;
            let m = (targetInk * weights[1]) / weightSum;
            let y = (targetInk * weights[2]) / weightSum;

            c = clampUnit(c * (1 - neutralMix) + (0.42 * neutralMix));
            m = clampUnit(m * (1 - neutralMix) + (0.42 * neutralMix));
            y = clampUnit(y * (1 - neutralMix) + (0.42 * neutralMix));

            return cmykToRgb(c, m, y, k);
        };

        // 버블 페이지 배경을 설정하는 함수
        const setBubblePageBackground = function (color) {
            if (!isBubbleFunPage || !color) {
                return;
            }

            const hasRgbObject = typeof color === 'object' && color !== null;
            const cssColor = hasRgbObject ? rgbToCss(color) : String(color);

            if (hasRgbObject) {
                bubbleVisualPalette = buildBubbleVisualPalette(color);
            }

            document.body.style.backgroundColor = cssColor;
            document.body.style.backgroundImage = 'none';

            if (bubbleLayer) {
                bubbleLayer.style.backgroundColor = cssColor;
                bubbleLayer.style.backgroundImage = 'none';
            }

            if (bubbleCanvas) {
                bubbleCanvas.style.backgroundColor = cssColor;
                bubbleCanvas.style.backgroundImage = 'none';
            }
        };

        // 버블 재생성을 스케줄링하는 함수
        const scheduleBubbleRespawn = function () {
            if (!isBubbleFunPage || respawnTimerId !== null) {
                return;
            }

            setBubblePageBackground(pickRandomBubbleBackgroundColor());
            respawnTimerId = window.setTimeout(function () {
                respawnTimerId = null;
                bubblesExhausted = false;
                hasInitializedBubbles = false;
                resizeCanvas();
            }, bubbleRespawnDelayMs);
        };

        // 값을 최소-최대 범위로 제한하는 함수
        const clamp = function (value, min, max) {
            return Math.min(max, Math.max(min, value));
        };

        // 뷰포트 최소 크기를 가져오는 함수
        const getViewportMinDimension = function () {
            const viewportWidth = width || window.innerWidth;
            const viewportHeight = height || window.innerHeight;
            return Math.max(320, Math.min(viewportWidth, viewportHeight));
        };

        // 버블 반지름 범위를 계산하는 함수
        const getBubbleRadiusRange = function () {
            const base = getViewportMinDimension();
            const baseMinRadius = Math.max(26, Math.round(base * 0.045));
            const baseMaxRadius = Math.max(baseMinRadius + 8, Math.round(base * 0.063));
            const minRadius = baseMinRadius * 2;
            const maxRadius = Math.max(minRadius + 16, baseMaxRadius * 2);
            return { min: minRadius, max: maxRadius };
        };

        // 상단 인셋 값을 계산하는 함수
        const getTopInset = function () {
            const navElement = document.querySelector('.ui-nav');

            if (!navElement) {
                return 0;
            }

            const navRect = navElement.getBoundingClientRect();
            return Math.max(0, Math.ceil(navRect.bottom + 4));
        };

        // 새 버블을 생성하는 함수
        const createBubble = function () {
            const radiusRange = getBubbleRadiusRange();
            const radius = randomBetween(radiusRange.min, radiusRange.max);
            const minX = radius;
            const maxX = Math.max(minX, (width || window.innerWidth) - radius);
            const minY = radius + topInset;
            const maxY = Math.max(minY, (height || window.innerHeight) - radius);
            const spawnDuration = prefersReducedMotion
                ? randomBetween(120, 220)
                : randomBetween(260, 420);

            return {
                x: randomBetween(minX, maxX),
                y: randomBetween(minY, maxY),
                radius: radius,
                vx: randomBetween(-0.18, 0.18),
                vy: randomBetween(-0.12, 0.12),
                alpha: randomBetween(0.35, 0.72),
                phase: randomBetween(0, Math.PI * 2),
                drift: randomBetween(0.85, 1.2),
                spawnElapsed: 0,
                spawnDuration: spawnDuration
            };
        };

        // 버블 생성 진행률을 가져오는 함수
        const getBubbleSpawnProgress = function (bubble) {
            if (!bubble || !bubble.spawnDuration || bubble.spawnDuration <= 0) {
                return 1;
            }
            return clampUnit((bubble.spawnElapsed || 0) / bubble.spawnDuration);
        };

        // 버블 생성 이징을 계산하는 함수
        const getBubbleSpawnEase = function (bubble) {
            const progress = getBubbleSpawnProgress(bubble);
            return 1 - Math.pow(1 - progress, 3);
        };

        // 캔버스 크기를 조정하는 함수
        // 화면 크기, 네비 높이, 현재 버블 개수를 함께 다시 계산해
        // 리사이즈 이후에도 즉시 자연스러운 배치를 유지한다.
        const resizeCanvas = function () {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const previousViewportMinDimension = viewportMinDimension || getViewportMinDimension();
            width = window.innerWidth;
            height = window.innerHeight;
            topInset = getTopInset();
            canvas.width = Math.max(1, Math.floor(width * dpr));
            canvas.height = Math.max(1, Math.floor(height * dpr));
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const nextViewportMinDimension = getViewportMinDimension();

            if (bubblesExhausted) {
                bubbles.length = 0;
                viewportMinDimension = nextViewportMinDimension;
                return;
            }

            if (!hasInitializedBubbles) {
                while (bubbles.length < bubblePhysicsConfig.fixedBubbleCount) {
                    bubbles.push(createBubble());
                }

                bubbles.length = bubblePhysicsConfig.fixedBubbleCount;
                hasInitializedBubbles = true;
            } else if (previousViewportMinDimension > 0 && nextViewportMinDimension > 0) {
                const resizeScale = nextViewportMinDimension / previousViewportMinDimension;
                const radiusRange = getBubbleRadiusRange();

                bubbles.forEach(function (bubble) {
                    bubble.radius = clamp(bubble.radius * resizeScale, radiusRange.min, radiusRange.max);
                });
            }

            viewportMinDimension = nextViewportMinDimension;

            bubbles.forEach(function (bubble) {
                const minX = bubble.radius;
                const maxX = Math.max(minX, width - bubble.radius);
                const minY = topInset + bubble.radius;
                const maxY = Math.max(minY, height - bubble.radius);
                bubble.x = Math.min(maxX, Math.max(minX, bubble.x));
                bubble.y = Math.min(maxY, Math.max(minY, bubble.y));
            });
        };

        // 버블을 그리는 함수
        const drawBubble = function (bubble, time) {
            const spawnEase = getBubbleSpawnEase(bubble);
            const entranceScale = 0.72 + (0.28 * spawnEase);
            const entranceAlpha = 0.12 + (0.88 * spawnEase);
            const pulse = 1 + Math.sin((time * 0.0012) + bubble.phase) * 0.03;
            const radius = bubble.radius * pulse * entranceScale;
            const bubbleAlpha = bubble.alpha * entranceAlpha;
            const bodyGradient = ctx.createRadialGradient(
                bubble.x - (radius * 0.28),
                bubble.y - (radius * 0.32),
                radius * 0.14,
                bubble.x,
                bubble.y,
                radius
            );

            bodyGradient.addColorStop(0, rgbaFrom(bubbleVisualPalette.bodyCore, 0));
            bodyGradient.addColorStop(0.45, rgbaFrom(bubbleVisualPalette.bodyCore, 0.032 * bubbleAlpha));
            bodyGradient.addColorStop(0.8, rgbaFrom(bubbleVisualPalette.bodyMid, 0.082 * bubbleAlpha));
            bodyGradient.addColorStop(1, rgbaFrom(bubbleVisualPalette.bodyEdge, 0.14 * bubbleAlpha));

            ctx.beginPath();
            ctx.fillStyle = bodyGradient;
            ctx.arc(bubble.x, bubble.y, radius, 0, Math.PI * 2);
            ctx.fill();

            // Inner shadow clipped inside the bubble to avoid outer glow.
            ctx.save();
            ctx.beginPath();
            ctx.arc(bubble.x, bubble.y, radius, 0, Math.PI * 2);
            ctx.clip();
            const innerShadow = ctx.createRadialGradient(
                bubble.x + (radius * 0.34),
                bubble.y + (radius * 0.38),
                radius * 0.06,
                bubble.x,
                bubble.y,
                radius * 0.92
            );
            innerShadow.addColorStop(0, rgbaFrom(bubbleVisualPalette.innerShadow, 0));
            innerShadow.addColorStop(0.72, rgbaFrom(bubbleVisualPalette.innerShadow, 0.11 * bubbleAlpha));
            innerShadow.addColorStop(1, rgbaFrom(bubbleVisualPalette.innerShadow, 0.24 * bubbleAlpha));
            ctx.fillStyle = innerShadow;
            ctx.fillRect(
                bubble.x - radius,
                bubble.y - radius,
                radius * 2,
                radius * 2
            );
            ctx.restore();

            const highlight = ctx.createRadialGradient(
                bubble.x - (radius * 0.22),
                bubble.y - (radius * 0.24),
                radius * 0.05,
                bubble.x - (radius * 0.08),
                bubble.y - (radius * 0.1),
                radius * 0.82
            );
            highlight.addColorStop(0, rgbaFrom(bubbleVisualPalette.highlight, 0));
            highlight.addColorStop(0.42, rgbaFrom(bubbleVisualPalette.highlight, 0.035 * bubbleAlpha));
            highlight.addColorStop(1, rgbaFrom(bubbleVisualPalette.highlight, 0));
            ctx.beginPath();
            ctx.fillStyle = highlight;
            ctx.arc(bubble.x, bubble.y, radius, 0, Math.PI * 2);
            ctx.fill();
        };

        // 팝업 효과를 생성하는 함수
        const createPopEffect = function (bubble) {
            const particleCount = prefersReducedMotion ? 4 : 12;
            const particles = [];
            const popPalette = {
                popRing: bubbleVisualPalette.popRing,
                popFlash: bubbleVisualPalette.popFlash,
                popParticle: bubbleVisualPalette.popParticle
            };

            for (let i = 0; i < particleCount; i += 1) {
                const angle = randomBetween(0, Math.PI * 2);
                const speed = randomBetween(0.5, 1.8) + (bubble.radius * 0.02);

                particles.push({
                    x: bubble.x,
                    y: bubble.y,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    size: randomBetween(Math.max(1.6, bubble.radius * 0.08), Math.max(2.8, bubble.radius * 0.16)),
                    alpha: randomBetween(0.55, 0.95) * bubble.alpha,
                    life: randomBetween(180, 320),
                    age: 0
                });
            }

            popEffects.push({
                x: bubble.x,
                y: bubble.y,
                age: 0,
                duration: prefersReducedMotion ? 180 : 320,
                innerRadius: Math.max(4, bubble.radius * 0.35),
                outerRadius: bubble.radius * 1.9,
                alpha: Math.min(1, bubble.alpha + 0.2),
                palette: popPalette,
                particles: particles
            });
        };

        // 팝업 효과를 업데이트하는 함수
        const updatePopEffects = function (deltaMs) {
            const frameScale = deltaMs / 16.666;

            for (let i = popEffects.length - 1; i >= 0; i -= 1) {
                const effect = popEffects[i];
                effect.age += deltaMs;

                for (let j = effect.particles.length - 1; j >= 0; j -= 1) {
                    const particle = effect.particles[j];
                    particle.age += deltaMs;

                    if (particle.age >= particle.life) {
                        effect.particles.splice(j, 1);
                        continue;
                    }

                    particle.x += particle.vx * frameScale;
                    particle.y += particle.vy * frameScale;
                    particle.vx *= 0.965;
                    particle.vy *= 0.965;
                }

                if (effect.age >= effect.duration && effect.particles.length === 0) {
                    popEffects.splice(i, 1);
                }
            }
        };

        // 팝업 효과를 그리는 함수
        const drawPopEffects = function () {
            popEffects.forEach(function (effect) {
                const effectPalette = effect.palette || bubbleVisualPalette;
                const progress = Math.min(effect.age / effect.duration, 1);
                const expansion = 1 - Math.pow(1 - progress, 3);
                const ringRadius = effect.innerRadius + ((effect.outerRadius - effect.innerRadius) * expansion);
                const ringAlpha = (1 - progress) * 0.46 * effect.alpha;

                if (ringAlpha > 0.01) {
                    ctx.beginPath();
                    ctx.strokeStyle = rgbaFrom(effectPalette.popRing, ringAlpha);
                    ctx.lineWidth = Math.max(1.1, (1 - progress) * (effect.innerRadius * 0.5));
                    ctx.arc(effect.x, effect.y, ringRadius, 0, Math.PI * 2);
                    ctx.stroke();
                }

                const flashAlpha = (1 - progress) * (1 - progress) * 0.4 * effect.alpha;
                if (flashAlpha > 0.01) {
                    ctx.beginPath();
                    ctx.fillStyle = rgbaFrom(effectPalette.popFlash, flashAlpha);
                    ctx.arc(effect.x, effect.y, effect.innerRadius * 0.5, 0, Math.PI * 2);
                    ctx.fill();
                }

                effect.particles.forEach(function (particle) {
                    const particleProgress = particle.age / particle.life;
                    const particleAlpha = (1 - particleProgress) * (1 - particleProgress) * 0.75 * particle.alpha;

                    if (particleAlpha <= 0.01) {
                        return;
                    }

                    ctx.beginPath();
                    ctx.fillStyle = rgbaFrom(effectPalette.popParticle, particleAlpha);
                    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
                    ctx.fill();
                });
            });
        };

        // 특정 지점의 버블을 제거하는 함수
        const removeBubbleAtPoint = function (x, y) {
            for (let i = bubbles.length - 1; i >= 0; i -= 1) {
                const bubble = bubbles[i];
                const dx = x - bubble.x;
                const dy = y - bubble.y;
                const spawnEase = getBubbleSpawnEase(bubble);
                const hitRadius = (bubble.radius * (0.72 + (0.28 * spawnEase))) * 1.05;

                if ((dx * dx) + (dy * dy) <= (hitRadius * hitRadius)) {
                    createPopEffect(bubble);
                    bubbles.splice(i, 1);
                    return true;
                }
            }

            return false;
        };

        // 애니메이션 메인 루프 함수
        const animate = function (time) {
            rafBubbleId = window.requestAnimationFrame(animate);

            if (document.hidden) {
                lastFrameTime = time;
                return;
            }

            const deltaMs = lastFrameTime > 0 ? Math.min(40, Math.max(8, time - lastFrameTime)) : 16.67;
            lastFrameTime = time;
            topInset = getTopInset();

            ctx.clearRect(0, 0, width, height);
            const poppedBubbles = new Set();

            bubbles.forEach(function (bubble) {
                if (bubble.spawnElapsed < bubble.spawnDuration) {
                    bubble.spawnElapsed = Math.min(bubble.spawnDuration, bubble.spawnElapsed + deltaMs);
                }

                bubble.vx += Math.sin((time * 0.0005 * bubble.drift) + bubble.phase) * 0.007;
                bubble.vy += Math.cos((time * 0.00042 * bubble.drift) + bubble.phase) * 0.006;

                if (!prefersReducedMotion && pointer.active) {
                    const dx = bubble.x - pointer.x;
                    const dy = bubble.y - pointer.y;
                    const distanceSquared = (dx * dx) + (dy * dy);
                    const reactionRadius = bubble.radius + bubblePhysicsConfig.pointerReactionPadding;
                    const reactionRadiusSquared = reactionRadius * reactionRadius;

                    if (distanceSquared < reactionRadiusSquared) {
                        const distance = Math.max(Math.sqrt(distanceSquared), 0.0001);
                        const proximity = 1 - (distance / reactionRadius);
                        const force = 0.42 + (proximity * proximity * 0.72);
                        bubble.vx += (dx / distance) * force;
                        bubble.vy += (dy / distance) * force;
                    }
                }

                bubble.x += bubble.vx;
                bubble.y += bubble.vy;
                bubble.vx *= 0.986;
                bubble.vy *= 0.986;

                if (!prefersReducedMotion && pointer.active) {
                    const dxAfterMove = bubble.x - pointer.x;
                    const dyAfterMove = bubble.y - pointer.y;
                    const distanceAfterMove = Math.max(Math.sqrt((dxAfterMove * dxAfterMove) + (dyAfterMove * dyAfterMove)), 0.0001);
                    const keepOutRadius = bubble.radius + bubblePhysicsConfig.pointerKeepOutPadding;

                    if (distanceAfterMove < keepOutRadius) {
                        const nx = dxAfterMove / distanceAfterMove;
                        const ny = dyAfterMove / distanceAfterMove;
                        const pushOut = keepOutRadius - distanceAfterMove;
                        bubble.x += nx * pushOut;
                        bubble.y += ny * pushOut;
                        bubble.vx += nx * 1.55;
                        bubble.vy += ny * 1.55;
                    }
                }
            });

            for (let i = 0; i < bubbles.length; i += 1) {
                const bubbleA = bubbles[i];

                if (poppedBubbles.has(bubbleA)) {
                    continue;
                }

                for (let j = i + 1; j < bubbles.length; j += 1) {
                    const bubbleB = bubbles[j];

                    if (poppedBubbles.has(bubbleB)) {
                        continue;
                    }
                    let dx = bubbleB.x - bubbleA.x;
                    let dy = bubbleB.y - bubbleA.y;
                    let distanceSquared = (dx * dx) + (dy * dy);
                    const minDistance = bubbleA.radius + bubbleB.radius + 2;
                    const minDistanceSquared = minDistance * minDistance;

                    if (distanceSquared >= minDistanceSquared) {
                        continue;
                    }

                    if (distanceSquared < 0.0001) {
                        const angle = (i + j + 1) * 0.61803398875;
                        dx = Math.cos(angle);
                        dy = Math.sin(angle);
                        distanceSquared = 1;
                    }

                    const distance = Math.sqrt(distanceSquared);
                    const nx = dx / distance;
                    const ny = dy / distance;
                    const overlap = minDistance - distance;
                    const separation = overlap * 0.5;

                    bubbleA.x -= nx * separation;
                    bubbleA.y -= ny * separation;
                    bubbleB.x += nx * separation;
                    bubbleB.y += ny * separation;

                    const relativeVelocityX = bubbleB.vx - bubbleA.vx;
                    const relativeVelocityY = bubbleB.vy - bubbleA.vy;
                    const normalVelocity = (relativeVelocityX * nx) + (relativeVelocityY * ny);
                    const impactSpeed = -normalVelocity;

                    if (impactSpeed > bubblePhysicsConfig.bubblePopImpactThreshold) {
                        poppedBubbles.add(bubbleA);
                        poppedBubbles.add(bubbleB);
                        continue;
                    }

                    if (normalVelocity < 0) {
                        const restitution = 0.84;
                        const impulse = -((1 + restitution) * normalVelocity) / 2;
                        bubbleA.vx -= nx * impulse;
                        bubbleA.vy -= ny * impulse;
                        bubbleB.vx += nx * impulse;
                        bubbleB.vy += ny * impulse;
                    }
                }
            }

            bubbles.forEach(function (bubble) {
                if (poppedBubbles.has(bubble)) {
                    return;
                }

                const minX = bubble.radius;
                const maxX = Math.max(minX, width - bubble.radius);
                const minY = topInset + bubble.radius;
                const maxY = Math.max(minY, height - bubble.radius);

                if (bubble.x < minX) {
                    const impactSpeed = Math.abs(bubble.vx);
                    bubble.x = minX;
                    bubble.vx = Math.abs(bubble.vx) * 0.92;

                    if (impactSpeed > bubblePhysicsConfig.wallPopSpeedThreshold) {
                        poppedBubbles.add(bubble);
                        return;
                    }
                } else if (bubble.x > maxX) {
                    const impactSpeed = Math.abs(bubble.vx);
                    bubble.x = maxX;
                    bubble.vx = -Math.abs(bubble.vx) * 0.92;

                    if (impactSpeed > bubblePhysicsConfig.wallPopSpeedThreshold) {
                        poppedBubbles.add(bubble);
                        return;
                    }
                }

                if (bubble.y < minY) {
                    const impactSpeed = Math.abs(bubble.vy);
                    bubble.y = minY;
                    bubble.vy = Math.abs(bubble.vy) * 0.92;

                    if (impactSpeed > bubblePhysicsConfig.wallPopSpeedThreshold) {
                        poppedBubbles.add(bubble);
                        return;
                    }
                } else if (bubble.y > maxY) {
                    const impactSpeed = Math.abs(bubble.vy);
                    bubble.y = maxY;
                    bubble.vy = -Math.abs(bubble.vy) * 0.92;

                    if (impactSpeed > bubblePhysicsConfig.wallPopSpeedThreshold) {
                        poppedBubbles.add(bubble);
                        return;
                    }
                }

                if (poppedBubbles.has(bubble)) {
                    return;
                }

                drawBubble(bubble, time);
            });

            if (poppedBubbles.size > 0) {
                for (let i = bubbles.length - 1; i >= 0; i -= 1) {
                    const bubble = bubbles[i];

                    if (!poppedBubbles.has(bubble)) {
                        continue;
                    }

                    createPopEffect(bubble);
                    bubbles.splice(i, 1);
                }
            }

            if (bubbles.length === 0 && !bubblesExhausted) {
                bubblesExhausted = true;
                scheduleBubbleRespawn();
            }

            updatePopEffects(deltaMs);
            drawPopEffects();
        };

        window.addEventListener('pointermove', function (event) {
            pointer.x = event.clientX;
            pointer.y = event.clientY;
            pointer.active = true;
        }, { passive: true });

        window.addEventListener('pointerdown', function (event) {
            if (!event.isPrimary || event.button !== 0) {
                return;
            }

            const target = event.target;
            if (target && target.closest && target.closest('a, button, input, textarea, select, label, [role="button"], .chat-widget, .chatbot-container, .chatbot-toggle-btn')) {
                return;
            }

            const rect = canvas.getBoundingClientRect();
            const localX = event.clientX - rect.left;
            const localY = event.clientY - rect.top;

            if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) {
                return;
            }

            removeBubbleAtPoint(localX, localY);
        }, { passive: true });

        window.addEventListener('pointerleave', function () {
            pointer.active = false;
        });

        window.addEventListener('blur', function () {
            pointer.active = false;
        });

        window.addEventListener('resize', resizeCanvas, { passive: true });
        window.addEventListener('orientationchange', resizeCanvas, { passive: true });

        if (isBubbleFunPage) {
            setBubblePageBackground(pickRandomBubbleBackgroundColor());
        }

        resizeCanvas();

        if (rafBubbleId !== null) {
            window.cancelAnimationFrame(rafBubbleId);
        }

        rafBubbleId = window.requestAnimationFrame(animate);
    };

    if (bubbleCanvas) {
        const initBubbleWhenIdle = function () {
            if (document.visibilityState === 'hidden') {
                const startWhenVisible = function () {
                    if (document.visibilityState !== 'visible') {
                        return;
                    }

                    document.removeEventListener('visibilitychange', startWhenVisible);
                    initInteractiveBubbleBackground(bubbleCanvas);
                };
                document.addEventListener('visibilitychange', startWhenVisible, { passive: true });
                return;
            }

            initInteractiveBubbleBackground(bubbleCanvas);
        };

        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(initBubbleWhenIdle, { timeout: 650 });
        } else {
            window.setTimeout(initBubbleWhenIdle, 140);
        }
    }

    const pageLang = (document.documentElement.getAttribute('lang') || 'ko').toLowerCase();
    const isEnglishPage = pageLang.startsWith('en');
    const printText = isEnglishPage ? {
        dialogTitle: 'Select Projects to Print',
        dialogDescription: 'Checked project detail pages will be printed with the summary.\nIf none are selected, only the summary will be printed.',
        selectAll: 'Select All',
        clearAll: 'Clear',
        cancel: 'Cancel',
        print: 'Print',
        noProjects: 'No project pages available. Summary only will be printed.',
        loading: 'Preparing print document...',
        popupBlocked: 'Popup was blocked. Allow popups and try again.',
        loadFailed: 'Failed to load this project page.'
    } : {
        dialogTitle: '프로젝트 선택',
        dialogDescription: '체크한 프로젝트 상세 페이지를 요약과 함께 인쇄합니다.\n선택이 없으면 요약만 인쇄됩니다.',
        selectAll: '전체 선택',
        clearAll: '선택 해제',
        cancel: '취소',
        print: '인쇄',
        noProjects: '선택 가능한 프로젝트가 없습니다. 요약만 인쇄됩니다.',
        loading: '인쇄 문서를 준비하고 있습니다...',
        popupBlocked: '팝업이 차단되었습니다. 브라우저 팝업 허용 후 다시 시도해 주세요.',
        loadFailed: '프로젝트 페이지를 불러오지 못했습니다.'
    };

    const printContentHelpers = window.__portfolioPrintContentHelpers || {};
    const escapeHtml = typeof printContentHelpers.escapeHtml === 'function'
        ? printContentHelpers.escapeHtml
        : function (value) { return String(value == null ? '' : value); };
    const absolutizeResourceUrls = typeof printContentHelpers.absolutizeResourceUrls === 'function'
        ? printContentHelpers.absolutizeResourceUrls
        : function () {};
    const normalizeProjectPrintMediaLayout = typeof printContentHelpers.normalizeProjectPrintMediaLayout === 'function'
        ? printContentHelpers.normalizeProjectPrintMediaLayout
        : function () {};
    const waitForImagesReady = typeof printContentHelpers.waitForImagesReady === 'function'
        ? printContentHelpers.waitForImagesReady
        : function () { return Promise.resolve(); };
    const PRINT_IMAGE_LAYOUT = printContentHelpers.PRINT_IMAGE_LAYOUT || {
        portraitMaxWidthMm: 45.6,
        landscapeWidthByPortraitMultiplier: 2.0
    };

    const collectProjectPrintOptions = function () {
        // 인쇄 대상 프로젝트 목록은 현재 보이는 카드에서 한 번 스냅샷으로 추출한다.
        // 이후 다이얼로그/팝업 단계에서는 live DOM 대신 이 정제된 목록만 사용한다.
        const projectMap = new Map();
        const projectAnchors = document.querySelectorAll('.main_projects .project_card a[href*="/project/"]');

        projectAnchors.forEach(function (anchor) {
            const href = anchor.getAttribute('href');
            if (!href) {
                return;
            }

            let absoluteUrl = '';
            try {
                absoluteUrl = new URL(href, window.location.origin).toString();
            } catch (error) {
                return;
            }

            if (projectMap.has(absoluteUrl)) {
                return;
            }

            const projectCard = anchor.closest('.project_card');
            const titleElement = projectCard ? projectCard.querySelector('.project_card_contents_title') : null;
            const title = (titleElement ? titleElement.textContent : anchor.textContent || '').trim() || absoluteUrl;
            projectMap.set(absoluteUrl, title);
        });

        return Array.from(projectMap.entries()).map(function (entry) {
            return { url: entry[0], title: entry[1] };
        });
    };

    const buildSummaryPrintHtml = function () {
        const container = document.createElement('section');
        container.className = 'print-summary';

        const banner = document.querySelector('.main_banner');
        if (banner) {
            container.appendChild(banner.cloneNode(true));
        }

        const mainContents = document.querySelector('.main_contents');
        if (mainContents) {
            const contentsClone = mainContents.cloneNode(true);
            const projectsSection = contentsClone.querySelector('.main_projects');
            const hobbysSection = contentsClone.querySelector('.main_hobbys');

            if (projectsSection) {
                projectsSection.remove();
            }
            if (hobbysSection) {
                hobbysSection.remove();
            }

            container.appendChild(contentsClone);
        }

        return container.outerHTML;
    };

    const fetchProjectPrintSectionHtml = async function (projectUrl, projectTitle) {
        const response = await fetch(projectUrl, { credentials: 'same-origin' });
        if (!response.ok) {
            throw new Error('Failed to fetch project page');
        }

        const html = await response.text();
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        const detailNode = parsed.querySelector('.project_detail_page') || parsed.querySelector('.project_detail');

        if (!detailNode) {
            throw new Error('Project detail content not found');
        }

        const contentNode = detailNode.cloneNode(true);
        contentNode.querySelectorAll('script').forEach(function (scriptNode) {
            scriptNode.remove();
        });
        normalizeProjectPrintMediaLayout(contentNode, projectTitle);
        absolutizeResourceUrls(contentNode, response.url || projectUrl);

        return '<section class="print-project">' + contentNode.outerHTML + '</section>';
    };

    const openProjectPrintSelector = function (projectOptions) {
        if (typeof window.__openProjectPrintSelectorDialog !== 'function') {
            return Promise.resolve(null);
        }
        return window.__openProjectPrintSelectorDialog(projectOptions, printText);
    };

    const printSummaryWithProjects = async function (selectedProjects) {
        if (typeof window.__printSummaryWithProjects !== 'function') {
            return;
        }

        await window.__printSummaryWithProjects({
            selectedProjects: selectedProjects,
            printText: printText,
            escapeHtml: escapeHtml,
            isEnglishPage: isEnglishPage,
            PRINT_IMAGE_LAYOUT: PRINT_IMAGE_LAYOUT,
            buildSummaryPrintHtml: buildSummaryPrintHtml,
            fetchProjectPrintSectionHtml: fetchProjectPrintSectionHtml,
            waitForImagesReady: waitForImagesReady
        });
    };

    const printButton = document.querySelector('[data-portfolio-print]');
    if (printButton) {
        printButton.addEventListener('click', async function () {
            const projectOptions = collectProjectPrintOptions();
            const selectedUrls = await openProjectPrintSelector(projectOptions);
            if (selectedUrls === null) {
                return;
            }

            const selectedProjects = selectedUrls.map(function (url) {
                const matched = projectOptions.find(function (project) {
                    return project.url === url;
                });
                return {
                    url: url,
                    title: matched ? matched.title : url
                };
            });

            await printSummaryWithProjects(selectedProjects);
        });
    }

    if (typeof window.__initSiteNavResponsiveManager === 'function') {
        window.__initSiteNavResponsiveManager({
            throttledHandleNavbarScroll: throttledHandleNavbarScroll
        });
    }
});
