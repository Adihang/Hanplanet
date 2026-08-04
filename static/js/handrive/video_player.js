(function bootstrapHandriveVideoPlayer() {
    'use strict';

    if (window.HandriveVideoPlayer) return;
    if (typeof videojs === 'undefined') {
        if (window.__handriveVideoPlayerRetryTimer) return;
        let retryCount = Number(window.__handriveVideoPlayerRetryCount || 0);
        const retry = () => {
            window.__handriveVideoPlayerRetryTimer = null;
            if (window.HandriveVideoPlayer) return;
            if (typeof videojs !== 'undefined') {
                window.__handriveVideoPlayerRetryCount = 0;
                bootstrapHandriveVideoPlayer();
                return;
            }
            retryCount += 1;
            window.__handriveVideoPlayerRetryCount = retryCount;
            if (retryCount < 80) {
                window.__handriveVideoPlayerRetryTimer = window.setTimeout(retry, 100);
            }
        };
        window.__handriveVideoPlayerRetryTimer = window.setTimeout(retry, 0);
        return;
    }

    // ── 저장 유틸 ─────────────────────────────────────────────────────
    const ls = {
        get:    (k)    => { try { return localStorage.getItem(k); }    catch { return null; } },
        set:    (k, v) => { try { localStorage.setItem(k, v); }        catch {} },
        remove: (k)    => { try { localStorage.removeItem(k); }        catch {} },
    };
    const timeKey = (src) => `vjs-time-${encodeURIComponent(src)}`;
    const MEDIA_LOOP_STORAGE_KEY = 'handrive-media-loop-enabled';
    const MEDIA_PLAYBACK_MODE_STORAGE_KEY = 'handrive-media-playback-mode';
    const MEDIA_PLAYBACK_MODE_NORMAL = 'normal';
    const MEDIA_PLAYBACK_MODE_REPEAT = 'repeat';
    const MEDIA_PLAYBACK_MODE_NEXT = 'next';
    const MEDIA_PLAYBACK_MODES = [
        MEDIA_PLAYBACK_MODE_NORMAL,
        MEDIA_PLAYBACK_MODE_REPEAT,
        MEDIA_PLAYBACK_MODE_NEXT,
    ];
    const MEDIA_VOLUME_COOKIE_NAME = 'handrive-media-volume';
    const MEDIA_MUTED_COOKIE_NAME = 'handrive-media-muted';
    const LEGACY_MEDIA_AUDIO_VOLUME_STORAGE_KEY = 'handrive-media-audio-volume';
    const MEDIA_VOLUME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
    let mediaVolumeSourceId = 0;

    // ── Player registry ────────────────────────────────────────────────
    const players = new Map(); // videoEl → { player, cleanups[] }

    // ── UA 판별 ───────────────────────────────────────────────────────
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isIOS    = /iPhone|iPad|iPod/i.test(navigator.userAgent);

    // ── Analytics hook (추후 GA / Sentry 연결) ────────────────────────
    function emitPlayerEvent(type, payload) { // eslint-disable-line no-unused-vars
    }

    // ── 시간 포맷 ─────────────────────────────────────────────────────
    function fmtTime(s) {
        s = Math.max(0, Math.floor(s));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const ss = s % 60;
        if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
        return `${m}:${String(ss).padStart(2,'0')}`;
    }

    function getUiLang() {
        const root = document.querySelector('[data-handrive-page]');
        return String(root && root.dataset && root.dataset.uiLang || document.documentElement.lang || 'ko')
            .trim()
            .toLowerCase() === 'en' ? 'en' : 'ko';
    }

    function textByLang(ko, en) {
        return getUiLang() === 'en' ? en : ko;
    }

    function parseStoredVolume(value) {
        if (value === null || value === undefined || String(value).trim() === '') {
            return null;
        }
        const parsedValue = Number(value);
        if (!Number.isFinite(parsedValue)) {
            return null;
        }
        return Math.max(0, Math.min(1, parsedValue));
    }

    function getCookieValue(name) {
        const prefix = encodeURIComponent(name) + '=';
        try {
            const parts = String(document.cookie || '').split(';');
            for (let index = 0; index < parts.length; index += 1) {
                const part = parts[index].trim();
                if (part.indexOf(prefix) === 0) {
                    return decodeURIComponent(part.slice(prefix.length));
                }
            }
        } catch (_) {}
        return '';
    }

    function setCookieValue(name, value) {
        try {
            let cookie = encodeURIComponent(name) + '=' + encodeURIComponent(String(value))
                + '; Max-Age=' + MEDIA_VOLUME_COOKIE_MAX_AGE
                + '; Path=/; SameSite=Lax';
            if (window.location && window.location.protocol === 'https:') {
                cookie += '; Secure';
            }
            document.cookie = cookie;
        } catch (_) {}
    }

    function getStoredMediaVolume() {
        const cookieVolume = parseStoredVolume(getCookieValue(MEDIA_VOLUME_COOKIE_NAME));
        if (cookieVolume !== null) {
            return cookieVolume;
        }
        const legacyVolume = parseStoredVolume(ls.get(LEGACY_MEDIA_AUDIO_VOLUME_STORAGE_KEY));
        if (legacyVolume !== null) {
            setCookieValue(MEDIA_VOLUME_COOKIE_NAME, legacyVolume);
            return legacyVolume;
        }
        return 1;
    }

    function storeMediaVolume(volume) {
        const normalizedVolume = parseStoredVolume(volume);
        if (normalizedVolume === null) {
            return;
        }
        setCookieValue(MEDIA_VOLUME_COOKIE_NAME, normalizedVolume);
    }

    function getStoredMediaMuted() {
        return getCookieValue(MEDIA_MUTED_COOKIE_NAME) === '1';
    }

    function storeMediaMuted(muted) {
        setCookieValue(MEDIA_MUTED_COOKIE_NAME, muted ? '1' : '0');
    }

    function dispatchMediaVolumeChange(volume, muted, sourceId) {
        window.dispatchEvent(new CustomEvent('handrive:media-volume-change', {
            detail: {
                volume: Math.max(0, Math.min(1, Number(volume) || 0)),
                muted: Boolean(muted),
                sourceId: sourceId || '',
            },
        }));
    }

    function shouldPersistMediaVolume(el) {
        if (!el || typeof el.closest !== 'function') {
            return true;
        }
        return !(
            el.id === 've-video' ||
            el.closest('#handrive-video-editor-surface') ||
            el.closest('.handrive-video-editor-surface')
        );
    }

    function getHandriveI18nText(key, fallback) {
        const element = document.getElementById('handrive-i18n');
        if (!element) {
            return fallback;
        }
        try {
            const values = JSON.parse(element.textContent || '{}') || {};
            return typeof values[key] === 'string' ? values[key] : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function canPlayVideoSourceType(type) {
        const normalizedType = String(type || '').trim();
        if (!normalizedType) return false;
        try {
            if (!canPlayVideoSourceType.probe) {
                canPlayVideoSourceType.probe = document.createElement('video');
            }
            return Boolean(canPlayVideoSourceType.probe.canPlayType(normalizedType));
        } catch (_) {
            return false;
        }
    }

    function isAbortError(error) {
        return Boolean(error && error.name === 'AbortError');
    }

    function isPlayerDisposed(player) {
        return Boolean(player && player.isDisposed && player.isDisposed());
    }

    function releaseNativeMediaElement(mediaElement) {
        if (
            !mediaElement ||
            typeof HTMLMediaElement === 'undefined' ||
            !(mediaElement instanceof HTMLMediaElement)
        ) {
            return;
        }
        try { mediaElement.pause(); } catch (_) {}
        try {
            if ('srcObject' in mediaElement && mediaElement.srcObject) {
                mediaElement.srcObject = null;
            }
        } catch (_) {}
        try {
            mediaElement.querySelectorAll('source, track').forEach(source => {
                source.removeAttribute('src');
                source.removeAttribute('srcset');
            });
        } catch (_) {}
        try { mediaElement.removeAttribute('src'); } catch (_) {}
        try { mediaElement.load(); } catch (_) {}
    }

    function releasePlayerMediaResources(player, el) {
        if (player && !isPlayerDisposed(player)) {
            try { player.pause(); } catch (_) {}
            try { player.src({ src: '', type: '' }); } catch (_) {}
            try { player.reset(); } catch (_) {}
            try {
                const tech = typeof player.tech === 'function' ? player.tech(true) : null;
                const techEl = tech && typeof tech.el === 'function' ? tech.el() : null;
                releaseNativeMediaElement(techEl);
            } catch (_) {}
        }
        releaseNativeMediaElement(el);
    }

    function resolveStartupSource(el, options) {
        const allowUnsupportedFallback = Boolean(options && options.allowUnsupportedFallback);
        const fallbackSrc = el.dataset.fallbackSrc || '';
        const fallbackType = el.dataset.fallbackType || 'video/mp4';
        const faststartSrc = el.dataset.faststartUrl || '';

        if (faststartSrc && canPlayVideoSourceType('video/mp4')) {
            return {
                src: faststartSrc,
                type: 'video/mp4',
                kind: 'faststart',
                fallbackSrc,
                fallbackType,
                faststartSrc,
            };
        }
        if (fallbackSrc && (allowUnsupportedFallback || canPlayVideoSourceType(fallbackType))) {
            return {
                src: fallbackSrc,
                type: fallbackType,
                kind: 'fallback',
                fallbackSrc,
                fallbackType,
                faststartSrc,
            };
        }
        return {
            src: '',
            type: '',
            kind: 'none',
            fallbackSrc,
            fallbackType,
            faststartSrc,
        };
    }

    function normalizeMediaPlaybackMode(mode) {
        const normalizedMode = String(mode || '').trim().toLowerCase();
        return MEDIA_PLAYBACK_MODES.includes(normalizedMode)
            ? normalizedMode
            : MEDIA_PLAYBACK_MODE_NORMAL;
    }

    function getStoredMediaPlaybackMode() {
        const storedMode = normalizeMediaPlaybackMode(ls.get(MEDIA_PLAYBACK_MODE_STORAGE_KEY));
        if (storedMode !== MEDIA_PLAYBACK_MODE_NORMAL || ls.get(MEDIA_PLAYBACK_MODE_STORAGE_KEY)) {
            return storedMode;
        }
        return ls.get(MEDIA_LOOP_STORAGE_KEY) === '1'
            ? MEDIA_PLAYBACK_MODE_REPEAT
            : MEDIA_PLAYBACK_MODE_NORMAL;
    }

    function getNextMediaPlaybackMode(mode) {
        const currentIndex = MEDIA_PLAYBACK_MODES.indexOf(normalizeMediaPlaybackMode(mode));
        return MEDIA_PLAYBACK_MODES[(currentIndex + 1) % MEDIA_PLAYBACK_MODES.length];
    }

    function storeMediaPlaybackMode(mode) {
        const nextMode = normalizeMediaPlaybackMode(mode);
        ls.set(MEDIA_PLAYBACK_MODE_STORAGE_KEY, nextMode);
        ls.set(MEDIA_LOOP_STORAGE_KEY, nextMode === MEDIA_PLAYBACK_MODE_REPEAT ? '1' : '0');
        window.dispatchEvent(new CustomEvent('handrive:media-loop-change', {
            detail: {
                mode: nextMode,
                enabled: nextMode === MEDIA_PLAYBACK_MODE_REPEAT,
                next: nextMode === MEDIA_PLAYBACK_MODE_NEXT,
            },
        }));
    }

    function buildLoopIconSvg(mode) {
        const normalizedMode = normalizeMediaPlaybackMode(mode);
        const checkPath = normalizedMode === MEDIA_PLAYBACK_MODE_REPEAT
            ? '<path class="handrive-loop-check-path" d="M8.4 12.8l2.4 2.4 5.2-5.7"/>'
            : '';
        const nextPath = normalizedMode === MEDIA_PLAYBACK_MODE_NEXT
            ? '<path class="handrive-loop-next-path" d="M10 8l5 4-5 4V8z"/><path class="handrive-loop-next-path" d="M17 8v8"/>'
            : '';
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
            + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="1.35em" height="1.35em">'
            + '<path d="M17 2l4 4-4 4"/>'
            + '<path d="M3 11V9a4 4 0 0 1 4-4h14"/>'
            + '<path d="M7 22l-4-4 4-4"/>'
            + '<path d="M21 13v2a4 4 0 0 1-4 4H3"/>'
            + checkPath
            + nextPath
            + '</svg>';
    }

    // ── 진입점 ────────────────────────────────────────────────────────
    function init(el) {
        if (el.dataset.vjsInitialized || videojs.getPlayer(el)) return;
        el.dataset.vjsInitialized = '1';

        const cleanups = [];
        const player   = buildPlayer(el);
        players.set(el, { player, cleanups });

        setupVideoAspectRatio(player, el, cleanups);
        setupControls(player);
        setupControlBarHoverState(player, cleanups);
        setupDelayedMenuPopups(player, cleanups);
        setupResponsiveControlBar(player, cleanups);
        setupLoop(player, cleanups);
        setupVolumePreference(player, el, cleanups);
        setupPip(player, cleanups);
        setupCast(player);
        setupThumbnailPreview(player, el, cleanups);
        setupPersist(player);
        setupMobile(player, cleanups);
        setupErrors(player);
        setupAnalytics(player);
        setupMediaSession(player, el);
        setupHls(player, el, cleanups);
    }

    // ── Player 생성 ───────────────────────────────────────────────────
    function buildPlayer(el) {
        const isPreview  = !!el.closest('.handrive-list-preview-content');
        const savedRate  = parseFloat(ls.get('vjs-playback-rate')) || 1;
        const hasHlsFallback = Boolean(el.dataset.hlsManifestUrl && el.dataset.hlsStatusUrl);
        const startupSource = resolveStartupSource(el, {
            allowUnsupportedFallback: !hasHlsFallback,
        });
        const startupSrc = startupSource.src;
        const startupType = startupSource.type;
        const preloadMode = (isPreview || hasHlsFallback) ? 'metadata' : 'auto';
        el.preload = preloadMode;

        const player = videojs(el, {
            controls:            true,
            preload:             preloadMode,
            playbackRates:       [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
            defaultPlaybackRate: savedRate,
            muted:               false,
            controlBar: {
                // progressControl은 CSS로 컨트롤바 위 행으로 올림
                children: [
                    'playToggle',
                    { name: 'volumePanel', inline: true },
                    'progressControl',
                    'currentTimeDisplay',
                    'timeDivider',
                    'durationDisplay',
                    'customControlSpacer',
                    'playbackRateMenuButton',
                    'fullscreenToggle',
                ],
            },
        });

        // 초기 소스: native 재생 가능한 faststart MP4/fallback만 먼저 사용한다.
        if (startupSrc) {
            player.src({ src: startupSrc, type: startupType });
        }

        // 포스터 이미지
        const posterUrl = el.dataset.posterUrl;
        if (posterUrl) {
            player.ready(() => player.poster(posterUrl));
        }

        // 상세 재생 화면은 idle 시점에 미리 로드를 걸어 첫 클릭 지연을 줄인다.
        if (!isPreview && startupSrc && !hasHlsFallback) {
            player.ready(() => {
                const hasStartedPlayback = () => {
                    return Number(player.currentTime() || 0) > 0.05 || !player.paused();
                };
                const warmup = () => {
                    if (player.isDisposed && player.isDisposed()) return;
                    try {
                        player.preload('auto');
                        if (!hasStartedPlayback()) {
                            player.load();
                        }
                    } catch (_) {}
                };
                if ('requestIdleCallback' in window) {
                    window.requestIdleCallback(warmup, { timeout: 800 });
                } else {
                    window.setTimeout(warmup, 250);
                }
            });
        }

        // 미리보기 패널은 hover/touch 직전에만 warmup 한다.
        if (isPreview) {
            const warmupPreview = () => {
                if (player.isDisposed && player.isDisposed()) return;
                try {
                    player.preload('metadata');
                    if (Number(player.currentTime() || 0) <= 0.05 && player.paused()) {
                        player.load();
                    }
                } catch (_) {}
            };
            ['mouseenter', 'pointerdown', 'touchstart', 'focusin'].forEach(eventName => {
                el.addEventListener(eventName, warmupPreview, { once: true, passive: true });
            });
        }

        return player;
    }

    // ── 원본 영상 비율에 맞춘 플레이어 크기 ─────────────────────────────
    function setupVideoAspectRatio(player, el, cleanups) {
        const mediaWrap = el.closest('.handrive-media-video-wrap');
        if (!mediaWrap) {
            return;
        }
        const layoutHost = mediaWrap.parentElement;
        const playerElement = player && typeof player.el === 'function' ? player.el() : null;
        const videoElement = playerElement && playerElement.querySelector('video')
            ? playerElement.querySelector('video')
            : el;
        if (!layoutHost || !playerElement || !videoElement) {
            return;
        }

        const applyAspectRatio = () => {
            const sourceWidth = Number(videoElement.videoWidth || 0);
            const sourceHeight = Number(videoElement.videoHeight || 0);
            if (!sourceWidth || !sourceHeight) {
                return;
            }

            const ratio = sourceWidth / sourceHeight;
            const ratioValue = `${sourceWidth} / ${sourceHeight}`;
            mediaWrap.style.setProperty('--handrive-video-aspect-ratio', ratioValue);
            playerElement.style.setProperty('--handrive-video-aspect-ratio', ratioValue);
            mediaWrap.dataset.videoAspectReady = '1';

            const hostRect = layoutHost.getBoundingClientRect();
            const maxWidth = Math.max(0, Number(layoutHost.clientWidth || hostRect.width || 0));
            const maxHeight = Math.max(0, Number(layoutHost.clientHeight || hostRect.height || 0));
            if (!maxWidth) {
                return;
            }

            let frameWidth = maxWidth;
            let frameHeight = frameWidth / ratio;
            if (maxHeight > 0 && frameHeight > maxHeight) {
                frameHeight = maxHeight;
                frameWidth = frameHeight * ratio;
            }
            if (!Number.isFinite(frameWidth) || !Number.isFinite(frameHeight) || frameWidth <= 0 || frameHeight <= 0) {
                return;
            }

            mediaWrap.style.width = `${Math.round(frameWidth)}px`;
            mediaWrap.style.height = `${Math.round(frameHeight)}px`;
        };

        player.on('loadedmetadata', applyAspectRatio);
        player.ready(applyAspectRatio);
        videoElement.addEventListener('loadedmetadata', applyAspectRatio);

        const resizeObserver = typeof ResizeObserver === 'function'
            ? new ResizeObserver(applyAspectRatio)
            : null;
        if (resizeObserver) {
            resizeObserver.observe(layoutHost);
        } else {
            window.addEventListener('resize', applyAspectRatio);
            cleanups.push(() => window.removeEventListener('resize', applyAspectRatio));
        }

        cleanups.push(() => {
            videoElement.removeEventListener('loadedmetadata', applyAspectRatio);
            if (resizeObserver) {
                resizeObserver.disconnect();
            }
            mediaWrap.style.removeProperty('--handrive-video-aspect-ratio');
            mediaWrap.style.removeProperty('width');
            mediaWrap.style.removeProperty('height');
            delete mediaWrap.dataset.videoAspectReady;
            playerElement.style.removeProperty('--handrive-video-aspect-ratio');
        });
    }

    // ── 컨트롤 공통 ──────────────────────────────────────────────────
    function setupControls(player) {
        // Space: 재생/정지 | ←→: 10초 | ↑↓: 볼륨 | F: 풀스크린 | M: 음소거
        if (typeof player.hotkeys === 'function') {
            player.hotkeys({
                volumeStep:                0.1,
                seekStep:                  10,
                enableModifiersForNumbers: false,
            });
        }

        // 새 재생 시작 → 다른 플레이어 일시정지
        player.on('play', () => {
            players.forEach(({ player: other }) => {
                if (other !== player && !other.paused()) other.pause();
            });
        });
    }

    function setupVolumePreference(player, el, cleanups) {
        if (!shouldPersistMediaVolume(el)) {
            return;
        }
        const sourceId = 'video-' + (++mediaVolumeSourceId);
        let applyingPreference = false;
        const applyPreference = (volume, muted) => {
            const normalizedVolume = parseStoredVolume(volume);
            applyingPreference = true;
            try {
                if (normalizedVolume !== null) {
                    player.volume(normalizedVolume);
                }
                player.muted(Boolean(muted));
            } catch (_) {
            } finally {
                window.setTimeout(() => {
                    applyingPreference = false;
                }, 0);
            }
        };
        const onVolumeChange = () => {
            if (applyingPreference) {
                return;
            }
            const volume = Math.max(0, Math.min(1, Number(player.volume()) || 0));
            const muted = Boolean(player.muted());
            storeMediaVolume(volume);
            storeMediaMuted(muted);
            dispatchMediaVolumeChange(volume, muted, sourceId);
        };
        const onGlobalVolumeChange = (event) => {
            const detail = event && event.detail ? event.detail : {};
            if (detail.sourceId === sourceId) {
                return;
            }
            applyPreference(detail.volume, detail.muted);
        };

        player.ready(() => applyPreference(getStoredMediaVolume(), getStoredMediaMuted()));
        player.on('volumechange', onVolumeChange);
        window.addEventListener('handrive:media-volume-change', onGlobalVolumeChange);
        cleanups.push(() => {
            try { player.off('volumechange', onVolumeChange); } catch (_) {}
            window.removeEventListener('handrive:media-volume-change', onGlobalVolumeChange);
        });
    }

    function setupControlBarHoverState(player, cleanups) {
        const root = player.el();
        if (!root) return;

        const showControls = () => root.classList.add('is-controlbar-hovered');
        const hideControls = () => root.classList.remove('is-controlbar-hovered');

        root.addEventListener('pointerenter', showControls);
        root.addEventListener('pointerleave', hideControls);
        cleanups.push(() => {
            root.removeEventListener('pointerenter', showControls);
            root.removeEventListener('pointerleave', hideControls);
            hideControls();
        });
    }

    function setupDelayedMenuPopups(player, cleanups) {
        const barComponent = player.getChild('controlBar');
        const bar = barComponent && typeof barComponent.el === 'function' ? barComponent.el() : null;
        if (!bar) return;

        const boundTargets = new WeakSet();
        const selector = '.vjs-playback-rate, .vjs-quality-selector';

        function bindTarget(target) {
            if (!target || boundTargets.has(target)) return;

            const getMenu = () => target.querySelector('.vjs-menu');
            const menu = getMenu();
            if (!menu) return;

            boundTargets.add(target);

            let closeTimer = null;
            const clearCloseTimer = () => {
                if (!closeTimer) return;
                window.clearTimeout(closeTimer);
                closeTimer = null;
            };
            const openMenu = () => {
                clearCloseTimer();
                const currentMenu = getMenu();
                if (!currentMenu) return;
                target.classList.add('handrive-delayed-menu-open');
                currentMenu.classList.add('vjs-lock-showing');
            };
            const closeMenu = () => {
                clearCloseTimer();
                target.classList.remove('handrive-delayed-menu-open');
                target.querySelectorAll('.vjs-menu.vjs-lock-showing').forEach(currentMenu => {
                    currentMenu.classList.remove('vjs-lock-showing');
                });
            };
            const scheduleCloseMenu = () => {
                clearCloseTimer();
                closeTimer = window.setTimeout(closeMenu, 500);
            };
            const closeWhenLeavingPopup = (event) => {
                if (event.relatedTarget && target.contains(event.relatedTarget)) return;
                if (event.target && event.target.closest('.vjs-menu')) {
                    closeMenu();
                }
            };
            const closeAfterSelection = (event) => {
                if (event.target && event.target.closest('.vjs-menu-item')) {
                    closeMenu();
                }
            };

            target.addEventListener('pointerenter', openMenu);
            target.addEventListener('pointerleave', scheduleCloseMenu);
            target.addEventListener('pointerout', closeWhenLeavingPopup);
            target.addEventListener('focusin', openMenu);
            target.addEventListener('focusout', scheduleCloseMenu);
            target.addEventListener('click', closeAfterSelection);

            cleanups.push(() => {
                target.removeEventListener('pointerenter', openMenu);
                target.removeEventListener('pointerleave', scheduleCloseMenu);
                target.removeEventListener('pointerout', closeWhenLeavingPopup);
                target.removeEventListener('focusin', openMenu);
                target.removeEventListener('focusout', scheduleCloseMenu);
                target.removeEventListener('click', closeAfterSelection);
                closeMenu();
            });
        }

        function bindMenus() {
            bar.querySelectorAll(selector).forEach(bindTarget);
        }

        const observer = typeof MutationObserver === 'function'
            ? new MutationObserver(bindMenus)
            : null;

        player.ready(bindMenus);
        bindMenus();

        if (observer) {
            observer.observe(bar, { childList: true, subtree: true });
            cleanups.push(() => observer.disconnect());
        }
    }

    function setupResponsiveControlBar(player, cleanups) {
        const root = player.el();
        const barComponent = player.getChild('controlBar');
        const bar = barComponent && typeof barComponent.el === 'function' ? barComponent.el() : null;
        if (!root || !bar) return;

        let frameId = 0;
        const toggleButton = document.createElement('button');
        const toggleIcon = document.createElement('span');
        toggleButton.type = 'button';
        toggleButton.className = 'vjs-control vjs-button vjs-handrive-right-actions-toggle';
        toggleButton.setAttribute('aria-expanded', 'false');
        toggleButton.setAttribute('aria-label', textByLang('우측 버튼 펼치기', 'Expand right controls'));
        toggleButton.setAttribute('title', textByLang('우측 버튼 펼치기', 'Expand right controls'));
        toggleIcon.className = 'vjs-icon-placeholder';
        toggleIcon.setAttribute('aria-hidden', 'true');
        toggleIcon.textContent = '<';
        toggleButton.appendChild(toggleIcon);

        function isHiddenControl(element) {
            return !element || element.hidden || element.classList.contains('vjs-hidden');
        }

        function getHorizontalSize(element) {
            if (!element || element.classList.contains('vjs-progress-control')) return 0;
            if (element.classList.contains('vjs-custom-control-spacer')) return 0;
            if (isHiddenControl(element)) return 0;
            if (!element.classList.contains('vjs-control')) return 0;
            const style = window.getComputedStyle(element);
            const width = element.offsetWidth
                || element.getBoundingClientRect().width
                || parseFloat(style.width)
                || 36;
            return width
                + (parseFloat(style.marginLeft) || 0)
                + (parseFloat(style.marginRight) || 0);
        }

        function getControls() {
            return Array.from(bar.children);
        }

        function getSpacerIndex(controls) {
            return controls.findIndex(child => child.classList.contains('vjs-custom-control-spacer'));
        }

        function isToggleControl(element) {
            return element && element.classList.contains('vjs-handrive-right-actions-toggle');
        }

        function isFullscreenControl(element) {
            return element && element.classList.contains('vjs-fullscreen-control');
        }

        function isAuxiliaryRightControl(element, index, spacerIndex) {
            return index > spacerIndex
                && !isHiddenControl(element)
                && !isToggleControl(element)
                && !isFullscreenControl(element)
                && !element.classList.contains('vjs-progress-control')
                && !element.classList.contains('vjs-custom-control-spacer');
        }

        function getAuxiliaryRightControls(controls) {
            const spacerIndex = getSpacerIndex(controls);
            if (spacerIndex < 0) return [];
            return controls.filter((child, index) => isAuxiliaryRightControl(child, index, spacerIndex));
        }

        function placeToggleButton() {
            const spacer = bar.querySelector('.vjs-custom-control-spacer');
            if (!spacer) return;
            const fullscreen = bar.querySelector('.vjs-fullscreen-control');
            if (fullscreen && toggleButton.nextElementSibling === fullscreen) return;
            if (fullscreen) {
                bar.insertBefore(toggleButton, fullscreen);
                return;
            }
            const next = spacer.nextElementSibling;
            if (next === toggleButton) return;
            bar.insertBefore(toggleButton, next);
        }

        function assignOverlayIndexes() {
            const auxiliaryControls = getAuxiliaryRightControls(getControls());
            auxiliaryControls.forEach((element, index) => {
                const reverseIndex = auxiliaryControls.length - index - 1;
                element.style.setProperty('--handrive-right-action-overlay-index', String(reverseIndex));
                element.classList.toggle('is-right-actions-overlay-first', index === 0);
                element.classList.toggle('is-right-actions-overlay-last', index === auxiliaryControls.length - 1);
                element.classList.toggle('is-right-actions-overlay-only', auxiliaryControls.length === 1);
            });
        }

        function syncToggleButton() {
            const expanded = root.classList.contains('is-right-actions-expanded');
            toggleIcon.textContent = expanded ? '>' : '<';
            toggleButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            toggleButton.setAttribute(
                'aria-label',
                expanded ? textByLang('우측 버튼 접기', 'Collapse right controls') : textByLang('우측 버튼 펼치기', 'Expand right controls')
            );
            toggleButton.setAttribute(
                'title',
                expanded ? textByLang('우측 버튼 접기', 'Collapse right controls') : textByLang('우측 버튼 펼치기', 'Expand right controls')
            );
        }

        function update() {
            frameId = 0;
            placeToggleButton();
            assignOverlayIndexes();

            const style = window.getComputedStyle(bar);
            const availableWidth = bar.clientWidth
                - (parseFloat(style.paddingLeft) || 0)
                - (parseFloat(style.paddingRight) || 0);
            const controls = getControls();
            const spacerIndex = getSpacerIndex(controls);
            const fullRequiredWidth = controls.reduce((total, child) => {
                if (isToggleControl(child)) return total;
                return total + getHorizontalSize(child);
            }, 0);
            const isWrapped = bar.getBoundingClientRect().height > 80;
            const shouldCollapse = spacerIndex >= 0
                && (fullRequiredWidth > availableWidth || isWrapped);

            root.classList.toggle('is-right-actions-collapsible', shouldCollapse);
            if (!shouldCollapse) {
                root.classList.remove('is-right-actions-collapsed', 'is-right-actions-expanded');
            } else {
                root.classList.toggle('is-right-actions-collapsed', !root.classList.contains('is-right-actions-expanded'));
            }
            syncToggleButton();
        }

        function scheduleUpdate() {
            if (frameId) return;
            frameId = window.requestAnimationFrame(update);
        }

        const resizeObserver = typeof ResizeObserver === 'function'
            ? new ResizeObserver(scheduleUpdate)
            : null;
        if (resizeObserver) {
            resizeObserver.observe(root);
            resizeObserver.observe(bar);
        } else {
            window.addEventListener('resize', scheduleUpdate);
            cleanups.push(() => window.removeEventListener('resize', scheduleUpdate));
        }

        const mutationObserver = typeof MutationObserver === 'function'
            ? new MutationObserver(scheduleUpdate)
            : null;
        if (mutationObserver) {
            mutationObserver.observe(bar, { childList: true, subtree: false });
        }

        player.ready(scheduleUpdate);
        scheduleUpdate();
        toggleButton.addEventListener('click', () => {
            if (!root.classList.contains('is-right-actions-collapsible')) return;
            const expanded = !root.classList.contains('is-right-actions-expanded');
            root.classList.toggle('is-right-actions-expanded', expanded);
            root.classList.toggle('is-right-actions-collapsed', !expanded);
            syncToggleButton();
        });
        cleanups.push(() => {
            if (frameId) {
                window.cancelAnimationFrame(frameId);
                frameId = 0;
            }
            if (resizeObserver) resizeObserver.disconnect();
            if (mutationObserver) mutationObserver.disconnect();
            toggleButton.remove();
            root.classList.remove('is-right-actions-collapsible', 'is-right-actions-collapsed', 'is-right-actions-expanded');
        });
    }

    // ── 반복 재생 ────────────────────────────────────────────────────
    function setupLoop(player, cleanups) {
        const buttonLabel = () => getHandriveI18nText('media_loop_toggle', textByLang('재생 모드 변경', 'Change playback mode'));
        const repeatLabel = () => getHandriveI18nText('media_loop_on', textByLang('반복재생', 'Repeat playback'));
        const normalLabel = () => getHandriveI18nText('media_loop_off', textByLang('일반 재생', 'Normal playback'));
        const nextLabel = () => getHandriveI18nText('media_loop_next', textByLang('끝나면 다음 파일 재생', 'Play next file when ended'));

        function labelForMode(mode) {
            const normalizedMode = normalizeMediaPlaybackMode(mode);
            if (normalizedMode === MEDIA_PLAYBACK_MODE_REPEAT) return repeatLabel();
            if (normalizedMode === MEDIA_PLAYBACK_MODE_NEXT) return nextLabel();
            return normalLabel();
        }

        function requestNextMediaPlayback() {
            if (getStoredMediaPlaybackMode() !== MEDIA_PLAYBACK_MODE_NEXT) return;
            const root = player.el();
            const mediaElement = root ? root.querySelector('video, audio') : null;
            window.dispatchEvent(new CustomEvent('handrive:media-play-next-request', {
                detail: {
                    mediaElement,
                    player,
                },
            }));
        }

        class HandriveLoopButton extends videojs.getComponent('Button') {
            constructor(p, opts) {
                super(p, opts);
                this.controlText(buttonLabel());
                this.addClass('vjs-handrive-loop-button');
                this.el().setAttribute('title', buttonLabel());
                const icon = this.el().querySelector('.vjs-icon-placeholder');
                if (icon) {
                    icon.innerHTML = buildLoopIconSvg(MEDIA_PLAYBACK_MODE_NORMAL);
                }
                this.syncLoopState(getStoredMediaPlaybackMode());
                this._syncFromEvent = (event) => {
                    const detail = event && event.detail ? event.detail : {};
                    const mode = detail.mode || (detail.enabled ? MEDIA_PLAYBACK_MODE_REPEAT : MEDIA_PLAYBACK_MODE_NORMAL);
                    this.syncLoopState(mode);
                };
                window.addEventListener('handrive:media-loop-change', this._syncFromEvent);
                p.on('dispose', () => {
                    window.removeEventListener('handrive:media-loop-change', this._syncFromEvent);
                });
            }

            syncLoopState(mode) {
                const nextMode = normalizeMediaPlaybackMode(mode);
                const isRepeat = nextMode === MEDIA_PLAYBACK_MODE_REPEAT;
                const isNext = nextMode === MEDIA_PLAYBACK_MODE_NEXT;
                this.player().loop(isRepeat);
                this.el().setAttribute('aria-pressed', isRepeat ? 'true' : (isNext ? 'mixed' : 'false'));
                this.el().setAttribute('aria-label', labelForMode(nextMode));
                this.el().setAttribute('title', labelForMode(nextMode));
                this.el().dataset.mediaPlaybackMode = nextMode;
                this.el().classList.toggle('is-loop-enabled', isRepeat);
                this.el().classList.toggle('is-next-enabled', isNext);
                const icon = this.el().querySelector('.vjs-icon-placeholder');
                if (icon) {
                    icon.innerHTML = buildLoopIconSvg(nextMode);
                }
            }

            handleClick() {
                storeMediaPlaybackMode(getNextMediaPlaybackMode(getStoredMediaPlaybackMode()));
            }

            buildCSSClass() {
                return `vjs-handrive-loop-button ${super.buildCSSClass()}`;
            }
        }

        if (!videojs.getComponent('HandriveLoopButton')) {
            videojs.registerComponent('HandriveLoopButton', HandriveLoopButton);
        }

        player.ready(() => {
            const bar = player.getChild('controlBar');
            if (!bar || bar.getChild('handriveLoopButton') || bar.getChild('HandriveLoopButton')) {
                return;
            }
            const rateIdx = bar.children().findIndex(
                c => c.name_ === 'playbackRateMenuButton' || c.name_ === 'PlaybackRateMenuButton'
            );
            const fsIdx = bar.children().findIndex(
                c => c.name_ === 'fullscreenToggle' || c.name_ === 'FullscreenToggle'
            );
            const idx = rateIdx >= 0 ? rateIdx + 1 : (fsIdx >= 0 ? fsIdx : undefined);
            bar.addChild('HandriveLoopButton', {}, idx);
        });

        player.on('ended', requestNextMediaPlayback);
    }

    // ── 미니 플레이어 (PiP) ───────────────────────────────────────────
    function setupPip(player, cleanups) {
        const videoEl = player.el().querySelector('video');
        if (!document.pictureInPictureEnabled || !videoEl || videoEl.disablePictureInPicture) return;

        class PipButton extends videojs.getComponent('Button') {
            constructor(p, opts) {
                super(p, opts);
                this.controlText('미니 플레이어');
                this.addClass('vjs-pip-button');
                const icon = this.el().querySelector('.vjs-icon-placeholder');
                if (icon) {
                    icon.innerHTML =
                        '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="1.4em" height="1.4em">'
                        + '<path d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 '
                        + '1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z"/></svg>';
                }
                const syncActiveClass = () => {
                    if (document.pictureInPictureElement === videoEl) {
                        this.addClass('vjs-pip-active');
                        return;
                    }
                    this.removeClass('vjs-pip-active');
                };
                document.addEventListener('enterpictureinpicture', syncActiveClass);
                document.addEventListener('leavepictureinpicture', syncActiveClass);
                if (Array.isArray(cleanups)) {
                    cleanups.push(() => {
                        document.removeEventListener('enterpictureinpicture', syncActiveClass);
                        document.removeEventListener('leavepictureinpicture', syncActiveClass);
                    });
                }
            }
            async handleClick() {
                if (this.player().isFullscreen()) this.player().exitFullscreen();
                if (document.pictureInPictureElement === videoEl) {
                    document.exitPictureInPicture().catch(() => {});
                    return;
                }
                try {
                    await videoEl.requestPictureInPicture();
                } catch (_) {
                    if (document.pictureInPictureElement && document.pictureInPictureElement !== videoEl) {
                        await document.exitPictureInPicture().catch(() => {});
                        await videoEl.requestPictureInPicture().catch(() => {});
                    }
                }
            }
            buildCSSClass() { return `vjs-pip-button ${super.buildCSSClass()}`; }
        }

        videojs.registerComponent('PipButton', PipButton);

        const bar   = player.getChild('controlBar');
        const fsIdx = bar ? bar.children().findIndex(
            c => c.name_ === 'fullscreenToggle' || c.name_ === 'FullscreenToggle'
        ) : -1;
        bar && bar.addChild('PipButton', {}, fsIdx >= 0 ? fsIdx : undefined);
    }

    function isHandriveImagePipVideo(el) {
        return Boolean(el && el.dataset && el.dataset.handriveImagePipHost === '1');
    }

    function getActiveVideoPictureInPictureElement(scope) {
        const active = document.pictureInPictureElement;
        if (!active || active.tagName !== 'VIDEO' || isHandriveImagePipVideo(active)) {
            return null;
        }
        if (scope && scope !== document && typeof scope.contains === 'function' && !scope.contains(active)) {
            return null;
        }
        return active;
    }

    function closeVideoPictureInPicture(scope) {
        if (
            !document.pictureInPictureElement ||
            typeof document.exitPictureInPicture !== 'function' ||
            !getActiveVideoPictureInPictureElement(scope)
        ) {
            return Promise.resolve();
        }
        return document.exitPictureInPicture().catch(() => {});
    }

    // ── Google Cast ───────────────────────────────────────────────────
    function setupCast(player) {
        function tryAdd() {
            if (!window.cast?.framework) return;
            if (!videojs.getComponent('ChromecastButton')) return; // 플러그인 미로드
            try {
                player.chromecast();
                const bar = player.getChild('controlBar');
                if (!bar) return;
                const pipIdx = bar.children().findIndex(c => c.name_ === 'pipButton' || c.name_ === 'PipButton');
                const fsIdx  = bar.children().findIndex(c => c.name_ === 'fullscreenToggle' || c.name_ === 'FullscreenToggle');
                const idx    = pipIdx >= 0 ? pipIdx : (fsIdx >= 0 ? fsIdx : undefined);
                bar.addChild('ChromecastButton', {}, idx);
            } catch (_) {}
        }

        // Cast SDK가 이미 로드된 경우 (defer 순서상 우리 스크립트보다 먼저 실행 가능)
        if (window.cast?.framework) {
            player.ready(tryAdd);
            return;
        }

        // Cast SDK가 나중에 로드될 때를 대비한 콜백 체인
        const prev = window.__onGCastApiAvailable;
        window.__onGCastApiAvailable = (ok) => {
            if (prev) prev(ok);
            if (ok) player.ready(tryAdd);
        };
    }

    // ── 썸네일 프리뷰 ────────────────────────────────────────────────
    function setupThumbnailPreview(player, el, cleanups) {
        if (isMobile) return;
        setupProgressHoverIndicator(player);
        const videoEl = player.el().querySelector('video');
        const vttUrl  = (videoEl && videoEl.dataset.thumbnailVttUrl) || (el && el.dataset.thumbnailVttUrl);
        if (vttUrl) {
            setupVttThumbnails(player, vttUrl, el, cleanups);
        } else {
            setupRealtimeThumbnails(player, el, cleanups);
        }
    }

    function setupProgressHoverIndicator(player) {
        player.ready(() => {
            const bar     = player.getChild('controlBar');
            const progCtl = bar && bar.getChild('progressControl');
            const barEl   = bar && typeof bar.el === 'function' ? bar.el() : null;
            const progEl  = progCtl && typeof progCtl.el === 'function' ? progCtl.el() : null;
            const holderEl = progEl && progEl.querySelector('.vjs-progress-holder');
            if (!barEl || !progEl || !holderEl || progEl.dataset.handriveProgressHoverIndicator === '1') return;

            progEl.dataset.handriveProgressHoverIndicator = '1';
            const indicator = document.createElement('span');
            indicator.className = 'vjs-progress-hover-indicator';
            indicator.setAttribute('aria-hidden', 'true');
            indicator.innerHTML = '<span class="vjs-progress-hover-fill"></span>';
            holderEl.appendChild(indicator);

            function update(event) {
                const rect = holderEl.getBoundingClientRect();
                if (!rect.width) return;
                const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
                progEl.style.setProperty('--handrive-progress-hover-ratio', String(ratio));
                progEl.classList.add('is-progress-hovering');
            }

            function hide() {
                progEl.classList.remove('is-progress-hovering');
            }

            barEl.addEventListener('mousemove', update);
            barEl.addEventListener('mouseleave', hide);
            player.on('dispose', () => {
                barEl.removeEventListener('mousemove', update);
                barEl.removeEventListener('mouseleave', hide);
                indicator.remove();
            });
        });
    }

    function attachThumbOverlay(player, tooltip) {
        tooltip.hidden = true;
        tooltip.classList.add('vjs-thumb-preview--floating');
        document.body.appendChild(tooltip);
        player.on('dispose', () => tooltip.remove());
    }

    function positionThumbOverlay(tooltip, progEl, event, thumbWidth) {
        const progRect = progEl.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
        const margin = 8;
        const tooltipHeight = tooltip.offsetHeight || 118;
        const minLeft = margin + (thumbWidth / 2);
        const maxLeft = Math.max(minLeft, viewportWidth - margin - (thumbWidth / 2));
        const left = Math.max(minLeft, Math.min(event.clientX, maxLeft));
        let top = progRect.top - tooltipHeight - 8;
        if (top < margin) {
            top = progRect.bottom + 8;
        }
        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
        tooltip.style.bottom = '';
    }

    // VTT 스프라이트 방식: 미리 생성된 sprite.jpg + sprite.vtt 사용
    function setupVttThumbnails(player, vttUrl, el, cleanups) {
        const THUMB_W = 160;
        const THUMB_H = 90;

        const tooltip = document.createElement('div');
        tooltip.className = 'vjs-thumb-preview vjs-thumb-preview--vtt';
        tooltip.hidden = true;
        const thumbImg = document.createElement('div');
        thumbImg.className = 'vjs-thumb-sprite';
        thumbImg.style.cssText = `width:${THUMB_W}px;height:${THUMB_H}px;background-repeat:no-repeat;`;
        const timeLabel = document.createElement('span');
        timeLabel.className = 'vjs-thumb-time';
        tooltip.appendChild(thumbImg);
        tooltip.appendChild(timeLabel);
        attachThumbOverlay(player, tooltip);

        let entries = null; // [{start, end, x, y, w, h, spriteUrl}]
        let spritePreloaded = false;
        let disposed = false;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const abort = () => {
            disposed = true;
            if (controller) {
                try { controller.abort(); } catch (_) {}
            }
        };
        if (Array.isArray(cleanups)) {
            cleanups.push(abort);
        }
        player.on('dispose', abort);

        // VTT 파싱
        fetch(vttUrl, controller ? { signal: controller.signal } : undefined)
            .then(r => {
                if (!r.ok) throw new Error('thumbnail vtt unavailable');
                return r.text();
            })
            .then(text => {
                if (disposed || isPlayerDisposed(player)) return;
                const lines = text.split(/\r?\n/);
                const parsed = [];
                for (let i = 0; i < lines.length; i++) {
                    const m = lines[i].match(/^(\S+)\s+-->\s+(\S+)/);
                    if (!m) continue;
                    const urlLine = lines[i + 1] || '';
                    const hashIdx = urlLine.lastIndexOf('#xywh=');
                    if (hashIdx < 0) continue;
                    const spriteUrl = urlLine.slice(0, hashIdx);
                    const coords    = urlLine.slice(hashIdx + 6).split(',').map(Number);
                    parsed.push({
                        start: _vttTimeToSec(m[1]),
                        end:   _vttTimeToSec(m[2]),
                        x: coords[0], y: coords[1],
                        w: coords[2] || THUMB_W, h: coords[3] || THUMB_H,
                        spriteUrl,
                    });
                }
                entries = parsed;
            })
            .catch(error => {
                if (disposed || isAbortError(error) || isPlayerDisposed(player)) return;
                tooltip.remove();
                setupRealtimeThumbnails(player, el, cleanups);
            });

        player.ready(() => {
            const bar     = player.getChild('controlBar');
            const progCtl = bar && bar.getChild('progressControl');
            if (!progCtl) return;

            const progEl = progCtl.el();

            progEl.addEventListener('mousemove', (e) => {
                const dur = player.duration();
                if (!dur || !entries) return;

                const progRect = progEl.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - progRect.left) / progRect.width));
                const time  = ratio * dur;

                const entry = entries.find(en => time >= en.start && time < en.end)
                           || entries[entries.length - 1];
                if (!entry) return;

                if (!spritePreloaded) {
                    spritePreloaded = true;
                    const img = new Image();
                    img.src = entry.spriteUrl;
                }

                thumbImg.style.backgroundImage    = `url("${entry.spriteUrl}")`;
                thumbImg.style.backgroundPosition = `-${entry.x}px -${entry.y}px`;
                thumbImg.style.width  = entry.w + 'px';
                thumbImg.style.height = entry.h + 'px';
                timeLabel.textContent = fmtTime(time);

                tooltip.hidden = false;
                positionThumbOverlay(tooltip, progEl, e, entry.w || THUMB_W);
            });

            progEl.addEventListener('mouseleave', () => {
                tooltip.hidden = true;
            });
        });
    }

    function _vttTimeToSec(t) {
        const parts = t.split(':').map(parseFloat);
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        return parts[0] || 0;
    }

    function drawVideoContain(ctx, videoEl, width, height) {
        const sourceWidth = Number(videoEl.videoWidth || width || 0);
        const sourceHeight = Number(videoEl.videoHeight || height || 0);
        if (!sourceWidth || !sourceHeight) return false;

        const scale = Math.min(width / sourceWidth, height / sourceHeight);
        const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
        const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
        const drawX = Math.floor((width - drawWidth) / 2);
        const drawY = Math.floor((height - drawHeight) / 2);

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(videoEl, drawX, drawY, drawWidth, drawHeight);
        return true;
    }

    // 실시간 seek 방식: canvas + 숨김 video (VTT 없을 때 fallback)
    function setupRealtimeThumbnails(player, el, cleanups) {
        const THUMB_W = 160;
        const THUMB_H = 90;

        const canvas = document.createElement('canvas');
        canvas.width  = THUMB_W;
        canvas.height = THUMB_H;
        const ctx = canvas.getContext('2d');

        const tooltip = document.createElement('div');
        tooltip.className = 'vjs-thumb-preview';
        tooltip.hidden = true;
        tooltip.appendChild(canvas);
        const timeLabel = document.createElement('span');
        timeLabel.className = 'vjs-thumb-time';
        tooltip.appendChild(timeLabel);
        attachThumbOverlay(player, tooltip);

        const thumbVid = document.createElement('video');
        thumbVid.setAttribute('muted', '');
        thumbVid.muted   = true;
        thumbVid.preload = 'auto';
        thumbVid.playsInline = true;
        thumbVid.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none;';

        let pendingTime  = -1;
        let seeking      = false;
        let metaReady    = false;
        let lastRatio    = -1;  // 마지막 hover 위치 (metadata 로드 후 재처리용)
        let lastClientX  = -1;
        let lastProgEl   = null;
        let hoveringProgress = false;
        let disposed     = false;

        function hideThumbnailPreview() {
            hoveringProgress = false;
            lastRatio = -1;
            lastClientX = -1;
            lastProgEl = null;
            tooltip.hidden = true;
        }

        function cleanupThumbVideo() {
            if (disposed) return;
            disposed = true;
            releaseNativeMediaElement(thumbVid);
            try { thumbVid.remove(); } catch (_) {}
        }
        if (Array.isArray(cleanups)) {
            cleanups.push(cleanupThumbVideo);
        }
        player.on('dispose', cleanupThumbVideo);

        function tryDraw() {
            if (thumbVid.readyState < 2) return;
            try { drawVideoContain(ctx, thumbVid, THUMB_W, THUMB_H); } catch (_) {}
            if (Math.abs(thumbVid.currentTime - pendingTime) > 0.5) {
                thumbVid.currentTime = pendingTime;
            } else {
                seeking = false;
            }
        }

        function doSeek() {
            if (!metaReady) return;
            seeking = true;
            thumbVid.currentTime = pendingTime;
        }

        thumbVid.addEventListener('loadedmetadata', () => {
            metaReady = true;
            // preload:none 미니 플레이어: metadata 로드 후 마지막 hover 위치로 즉시 seek
            if (hoveringProgress && lastRatio >= 0 && thumbVid.duration) {
                pendingTime = lastRatio * thumbVid.duration;
                tooltip.hidden = false;
                if (lastProgEl && lastClientX >= 0) {
                    positionThumbOverlay(tooltip, lastProgEl, { clientX: lastClientX }, THUMB_W);
                }
                doSeek();
            }
        });
        thumbVid.addEventListener('seeked', tryDraw);

        player.on('emptied', () => {
            thumbVid.removeAttribute('src');
            thumbVid.load();
            seeking   = false;
            metaReady = false;
            pendingTime = -1;
            ctx.clearRect(0, 0, THUMB_W, THUMB_H);
        });

        player.ready(() => {
            const bar     = player.getChild('controlBar');
            const progCtl = bar && bar.getChild('progressControl');
            if (!progCtl) return;

            const progEl   = progCtl.el();
            const playerEl = player.el();
            playerEl.appendChild(thumbVid);

            // preload:none 미니 플레이어용: mouseenter 시 thumbVid 소스 미리 로드
            progEl.addEventListener('mouseenter', () => {
                hoveringProgress = true;
                if (!thumbVid.src) {
                    const startup = resolveStartupSource(el, { allowUnsupportedFallback: false });
                    const src = (startup.kind === 'faststart' ? startup.src : '')
                        || player.currentSrc()
                        || startup.src;
                    if (src) {
                        thumbVid.src = src;
                        thumbVid.load();
                    }
                }
            });

            progEl.addEventListener('mousemove', (e) => {
                hoveringProgress = true;
                const progRect   = progEl.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - progRect.left) / progRect.width));
                lastRatio = ratio;  // metadata 로드 후 재처리용
                lastClientX = e.clientX;
                lastProgEl = progEl;

                const dur = player.duration() || thumbVid.duration || 0;
                if (!dur) return;

                const time  = ratio * dur;

                timeLabel.textContent = fmtTime(time);

                tooltip.hidden = false;
                positionThumbOverlay(tooltip, progEl, e, THUMB_W);

                pendingTime = time;
                if (!seeking) doSeek();
            });

            progEl.addEventListener('mouseleave', hideThumbnailPreview);
        });
    }

    // ── 재생위치 · 배속 저장 ──────────────────────────────────────────
    function setupPersist(player) {
        let lastSave   = 0;
        let didRestore = false; // src당 한 번만 복원

        player.on('loadedmetadata', () => {
            if (didRestore) return;
            didRestore = true;
            const saved = parseFloat(ls.get(timeKey(player.currentSrc())));
            if (saved > 5 && saved < player.duration() - 3) player.currentTime(saved);
        });

        // src 변경 시 복원 플래그 초기화
        player.on('emptied', () => { didRestore = false; });

        player.on('timeupdate', () => {
            const now = Date.now();
            if (now - lastSave < 5000) return; // throttle 5초
            lastSave = now;
            const t = player.currentTime();
            if (t > 5) ls.set(timeKey(player.currentSrc()), t);
        });

        player.on('ended',      () => ls.remove(timeKey(player.currentSrc())));
        player.on('ratechange', () => ls.set('vjs-playback-rate', player.playbackRate()));
    }

    // ── 모바일 대응 ───────────────────────────────────────────────────
    function setupMobile(player, cleanups) {
        // videojs-mobile-ui: iOS 제외 (native 컨트롤 충돌 방지)
        if (isMobile && !isIOS && typeof player.mobileUi === 'function') {
            player.mobileUi({ touchControls: { seekSeconds: 10, tapTimeout: 300 } });
        }

        if (!isMobile) return;

        const videoEl = player.el().querySelector('video');
        const mq      = window.matchMedia('(orientation: landscape)');

        const handler = (e) => {
            if (e.matches) {
                if (player.paused()) return;
                player.requestFullscreen().catch(() => {
                    if (videoEl && videoEl.webkitEnterFullscreen) videoEl.webkitEnterFullscreen();
                });
            } else if (player.isFullscreen()) {
                player.exitFullscreen();
            }
        };

        mq.addEventListener('change', handler);
        cleanups.push(() => mq.removeEventListener('change', handler));
    }

    // ── 에러 UI ───────────────────────────────────────────────────────
    function setupErrors(player) {
        let renderTimer = null;
        const msgs = {
            1: '재생이 중단되었습니다.',
            2: '네트워크 오류가 발생했습니다.',
            3: '지원하지 않는 파일 형식입니다.',
            4: '파일을 재생할 수 없습니다.',
        };

        function getVideoElement() {
            return player.el().querySelector('video');
        }

        function hasPlayableState() {
            const videoEl = getVideoElement();
            return Boolean(videoEl && videoEl.readyState >= 2 && (!player.paused() || player.currentTime() > 0));
        }

        function getRetrySource() {
            const currentSource = typeof player.currentSource === 'function' ? player.currentSource() : null;
            const currentSrc = player.currentSrc() || (currentSource && currentSource.src) || '';
            if (currentSrc) {
                return {
                    src: currentSrc,
                    type: currentSource && currentSource.type ? currentSource.type : '',
                };
            }
            const videoEl = getVideoElement();
            if (!videoEl) return null;
            const startupSource = resolveStartupSource(videoEl, { allowUnsupportedFallback: true });
            return startupSource && startupSource.src
                ? { src: startupSource.src, type: startupSource.type || '' }
                : null;
        }

        function hasRecoverableTransientError(code) {
            if (code === 1) return true;
            if (player.handriveHlsSwitching_) return true;
            if (player.handriveHlsSourceActive_ && player.handriveHlsRecoverable_) return true;
            return Number(player.handriveSourceTransitionUntil_ || 0) > Date.now();
        }

        function getRecoverableErrorDelay() {
            const remaining = Number(player.handriveSourceTransitionUntil_ || 0) - Date.now();
            return Math.max(180, Math.min(1500, remaining > 0 ? remaining + 80 : 260));
        }

        function clearErrorState() {
            const root = player.el();
            try { player.error(null); } catch (_) {}
            if (root) root.classList.remove('vjs-error');
        }

        function renderError() {
            const err  = player.error();
            const code = err ? err.code : 0;
            if (!err) return;
            if (code === 1 || hasPlayableState()) {
                clearErrorState();
                return;
            }
            if (hasRecoverableTransientError(code)) {
                if (renderTimer) clearTimeout(renderTimer);
                renderTimer = setTimeout(() => {
                    renderTimer = null;
                    renderError();
                }, getRecoverableErrorDelay());
                return;
            }
            const msg  = msgs[code] || '알 수 없는 오류가 발생했습니다.';

            console.error('[VideoPlayer]', { code, msg, src: player.currentSrc(), userAgent: navigator.userAgent });

            const content = player.el().querySelector('.vjs-error-display .vjs-modal-dialog-content');
            if (!content) return;
            content.innerHTML =
                '<p class="vjs-error-msg">' + msg + '</p>'
                + '<button class="vjs-retry-btn" type="button">다시 시도</button>';

            const btn = content.querySelector('.vjs-retry-btn');
            if (btn) {
                btn.addEventListener('click', () => {
                    const retrySource = getRetrySource();
                    player.error(null);
                    if (retrySource && retrySource.src) {
                        player.src({ src: retrySource.src, type: retrySource.type || undefined });
                    }
                    try { player.load(); } catch (_) {}
                    player.play().catch(() => {});
                });
            }
        }

        player.on('error', () => {
            if (renderTimer) clearTimeout(renderTimer);

            const err = player.error();
            const code = err ? err.code : 0;
            if (code === 1 || hasPlayableState()) {
                renderTimer = setTimeout(() => {
                    renderTimer = null;
                    if (player.error()) clearErrorState();
                }, 0);
                return;
            }

            renderTimer = setTimeout(() => {
                renderTimer = null;
                renderError();
            }, 120);
        });

        ['loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'playing', 'timeupdate'].forEach(eventName => {
            player.on(eventName, () => {
                if (player.error() && hasPlayableState()) clearErrorState();
            });
        });

        player.on('dispose', () => {
            if (renderTimer) clearTimeout(renderTimer);
        });
    }

    // ── Analytics ─────────────────────────────────────────────────────
    function setupAnalytics(player) {
        const payload = () => ({
            src:          player.currentSrc(),
            currentTime:  player.currentTime(),
            duration:     player.duration(),
            playbackRate: player.playbackRate(),
        });
        ['play', 'pause', 'seeked', 'ended', 'waiting'].forEach(ev =>
            player.on(ev, () => emitPlayerEvent(ev, payload()))
        );
    }

    // ── Media Session API (잠금 화면 / 미디어 키 제어) ──────────────
    function setupMediaSession(player, el) {
        if (!('mediaSession' in navigator)) return;

        const title     = (el && el.dataset.filename) || document.title;
        const posterUrl = (el && el.dataset.posterUrl) || '';

        function setPlaybackState(state) {
            try { navigator.mediaSession.playbackState = state; } catch (_) {}
        }

        function setPlaybackPosition() {
            try {
                navigator.mediaSession.setPositionState?.({
                    duration:     player.duration() || 0,
                    position:     player.currentTime(),
                    playbackRate: player.playbackRate(),
                });
            } catch (_) {}
        }

        player.on('play', () => {
            navigator.mediaSession.metadata = new MediaMetadata({
                title,
                artwork: posterUrl ? [{ src: posterUrl, sizes: '1280x720', type: 'image/jpeg' }] : [],
            });
            setPlaybackState('playing');
        });
        player.on('pause', () => { setPlaybackState('paused'); });

        const actions = {
            play:         () => player.play().catch(() => {}),
            pause:        () => player.pause(),
            seekforward:  ({ seekOffset }) => player.currentTime(player.currentTime() + (seekOffset ?? 10)),
            seekbackward: ({ seekOffset }) => player.currentTime(player.currentTime() - (seekOffset ?? 10)),
            seekto:       ({ seekTime })   => { if (seekTime != null) player.currentTime(seekTime); },
        };
        Object.entries(actions).forEach(([action, fn]) => {
            try { navigator.mediaSession.setActionHandler(action, fn); } catch (_) {}
        });

        player.on('timeupdate', setPlaybackPosition);

        player.on('dispose', () => {
            try { navigator.mediaSession.metadata = null; } catch (_) {}
        });
    }

    // ── HLS 소스 선택 + 화질 선택기 ──────────────────────────────────
    function setupHls(player, el, cleanups) {
        const manifestUrl = el.dataset.hlsManifestUrl || '';
        const statusUrl   = el.dataset.hlsStatusUrl   || '';
        if (!manifestUrl || !statusUrl) return;
        const startupSource = resolveStartupSource(el, { allowUnsupportedFallback: false });
        const startupSrc = startupSource.src;
        const startupType = startupSource.type;
        const canUseNativeStartupSource = Boolean(startupSrc);

        const POLL_MS = 3000;
        let pollTimer = null;
        let qualitySelectorRetryTimer = null;
        let qualitySelectorRetryCount = 0;
        let qualitySelectorEnabled = false;
        let hlsKickoffStarted = false;
        let hlsSwitching = false;
        let hlsActive = false;
        let hlsSwitchTimer = null;
        let hlsReadyProbeTimer = null;
        let hlsReadyProbeIdleId = null;
        let hlsQualityGateButton = null;
        let hlsStatusInFlight = false;
        let pendingHlsPreparationOptions = null;
        let hlsPlaybackPending = false;
        let hlsQualityGateLoading = false;
        let hlsQualityGateDismissed = false;
        let resumeAfterHlsSwitch = false;
        let userWantsPlayback = false;
        let latestHlsStatus = '';
        let hlsPollingOptions = {};
        let disposed = false;
        const hlsAbortController = typeof AbortController !== 'undefined' ? new AbortController() : null;

        player.handriveHlsRecoverable_ = Boolean(startupSrc);
        player.handriveHlsSourceActive_ = false;

        function shouldIgnoreHlsAsync() {
            return disposed || isPlayerDisposed(player);
        }

        function hlsFetch(url, options) {
            if (shouldIgnoreHlsAsync()) {
                return Promise.reject({ name: 'AbortError' });
            }
            const fetchOptions = Object.assign({}, options || {});
            if (hlsAbortController) {
                fetchOptions.signal = hlsAbortController.signal;
            }
            return fetch(url, fetchOptions);
        }

        function handleHlsFetchError(error) {
            if (shouldIgnoreHlsAsync() || isAbortError(error)) return;
            stopHlsFallback();
        }

        function stopPoll() {
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        }
        function stopHlsSwitchTimer() {
            if (hlsSwitchTimer) {
                clearTimeout(hlsSwitchTimer);
                hlsSwitchTimer = null;
            }
        }
        function clearHlsReadyProbe() {
            if (hlsReadyProbeTimer) {
                clearTimeout(hlsReadyProbeTimer);
                hlsReadyProbeTimer = null;
            }
            if (hlsReadyProbeIdleId && 'cancelIdleCallback' in window) {
                window.cancelIdleCallback(hlsReadyProbeIdleId);
            }
            hlsReadyProbeIdleId = null;
        }
        cleanups.push(stopPoll);
        cleanups.push(stopHlsSwitchTimer);
        cleanups.push(() => {
            disposed = true;
            if (hlsAbortController) {
                try { hlsAbortController.abort(); } catch (_) {}
            }
            if (qualitySelectorRetryTimer) {
                clearTimeout(qualitySelectorRetryTimer);
                qualitySelectorRetryTimer = null;
            }
            pendingHlsPreparationOptions = null;
            clearHlsReadyProbe();
            if (hlsQualityGateButton) {
                hlsQualityGateButton.removeEventListener('click', onHlsQualityGateClick);
                hlsQualityGateButton.remove();
                hlsQualityGateButton = null;
            }
            player.handriveHlsSwitching_ = false;
            player.handriveHlsSourceActive_ = false;
            player.handriveSourceTransitionUntil_ = 0;
            setHlsLoading(false);
        });

        player.on('play', () => { userWantsPlayback = true; });
        function markHlsPlaybackReady() {
            hlsPlaybackPending = false;
            stopHlsSwitchTimer();
            setHlsLoading(false);
        }

        player.on('playing', () => {
            userWantsPlayback = true;
            markHlsPlaybackReady();
        });
        player.on('loadeddata', markHlsPlaybackReady);
        player.on('canplay', markHlsPlaybackReady);
        player.on('canplaythrough', markHlsPlaybackReady);
        player.on('pause', () => {
            if (!hlsSwitching) userWantsPlayback = false;
        });
        player.on('ended', () => { userWantsPlayback = false; });

        function markSourceTransition(ms = 3500) {
            player.handriveSourceTransitionUntil_ = Date.now() + ms;
        }

        function clearSourceTransitionSoon() {
            setTimeout(() => {
                if (!hlsSwitching) player.handriveSourceTransitionUntil_ = 0;
            }, 600);
        }

        function setHlsLoading(loading) {
            const root = player.el();
            if (!root) return;
            root.classList.toggle('vjs-waiting', Boolean(loading));
            root.classList.toggle('is-handrive-hls-loading', Boolean(loading));
        }

        function getQualitySelectorControl() {
            const root = player.el();
            return root
                ? root.querySelector('.vjs-quality-selector:not(.vjs-handrive-hls-quality-gate)')
                : null;
        }

        function hasQualitySelectorControl() {
            const selector = getQualitySelectorControl();
            return Boolean(selector && !selector.classList.contains('vjs-hidden'));
        }

        function setQualitySelectorVisible(visible) {
            const selector = getQualitySelectorControl();
            if (!selector) return;
            const shouldShow = Boolean(visible);
            selector.hidden = !shouldShow;
            selector.classList.toggle('vjs-hidden', !shouldShow);
        }

        function syncQualitySelectorVisibility() {
            setQualitySelectorVisible(hlsActive && !hlsSwitching);
            syncHlsQualityGateVisibility();
        }

        // 화질 선택기 활성화
        function enableQualitySelector() {
            if (qualitySelectorEnabled) {
                syncQualitySelectorVisibility();
                return;
            }
            if (typeof player.hlsQualitySelector !== 'function') {
                if (!qualitySelectorRetryTimer && qualitySelectorRetryCount < 40) {
                    qualitySelectorRetryCount += 1;
                    qualitySelectorRetryTimer = setTimeout(() => {
                        qualitySelectorRetryTimer = null;
                        enableQualitySelector();
                    }, 250);
                }
                return;
            }
            try {
                const bar = player.getChild('controlBar');
                const children = bar ? bar.children() : [];
                const rateIdx = children.findIndex(c => {
                    const name = String(c.name_ || c.name?.() || '').toLowerCase();
                    const el = typeof c.el === 'function' ? c.el() : null;
                    return name.includes('playbackrate') || Boolean(el && el.classList.contains('vjs-playback-rate'));
                });
                player.hlsQualitySelector({
                    displayCurrentQuality: false,
                    placementIndex: rateIdx >= 0 ? rateIdx + 1 : undefined,
                });
                qualitySelectorEnabled = true;
                window.setTimeout(syncQualitySelectorVisibility, 0);
            } catch (_) {}
        }

        function sourceIsHls() {
            const currentSource = typeof player.currentSource === 'function' ? player.currentSource() : null;
            return Boolean(
                hlsActive
                || hlsSwitching
                || player.handriveHlsSourceActive_
                || (currentSource && currentSource.src === manifestUrl)
            );
        }

        function handleOptionalVideoScriptsReady() {
            if (sourceIsHls()) {
                enableQualitySelector();
            }
        }
        window.addEventListener('handrive:video-optional-scripts-ready', handleOptionalVideoScriptsReady);
        cleanups.push(() => {
            window.removeEventListener('handrive:video-optional-scripts-ready', handleOptionalVideoScriptsReady);
        });

        function hasCurrentSource() {
            const currentSource = typeof player.currentSource === 'function' ? player.currentSource() : null;
            return Boolean(player.currentSrc() || (currentSource && currentSource.src));
        }

        function finishHlsSwitch(previousTime) {
            hlsSwitching = false;
            hlsActive = true;
            player.handriveHlsSwitching_ = false;
            player.handriveHlsSourceActive_ = true;
            clearSourceTransitionSoon();
            enableQualitySelector();
            syncQualitySelectorVisibility();

            if (previousTime > 1) {
                try { player.currentTime(previousTime); } catch (_) {}
            }
            if (resumeAfterHlsSwitch) {
                hlsPlaybackPending = true;
                player.play().catch(() => {});
            } else {
                markHlsPlaybackReady();
            }
        }

        function restoreStartupSource(previousTime, shouldResume) {
            if (!startupSrc) return false;

            stopHlsSwitchTimer();
            hlsSwitching = false;
            hlsActive = false;
            hlsPlaybackPending = false;
            player.handriveHlsSwitching_ = false;
            player.handriveHlsSourceActive_ = false;
            markSourceTransition();

            try { player.error(null); } catch (_) {}
            player.one('loadedmetadata', () => {
                clearSourceTransitionSoon();
                if (previousTime > 1) {
                    try { player.currentTime(previousTime); } catch (_) {}
                }
                if (shouldResume) {
                    player.play().catch(() => {});
                }
            });
            player.src({ src: startupSrc, type: startupType });
            return true;
        }

        // HLS 소스로 전환 (재생 중이면 위치 보존)
        function switchToHls(options = {}) {
            dismissHlsQualityGate();
            if (sourceIsHls()) {
                enableQualitySelector();
                if (options.resume || userWantsPlayback) {
                    hlsPlaybackPending = true;
                    player.play().catch(() => {});
                }
                return;
            }
            const currentTime = player.currentTime();
            resumeAfterHlsSwitch = Boolean(options.resume || userWantsPlayback || !player.paused());
            hlsSwitching = true;
            hlsPlaybackPending = false;
            player.handriveHlsSwitching_ = true;
            player.handriveHlsSourceActive_ = true;
            markSourceTransition();
            setHlsLoading(true);

            player.one('loadedmetadata', () => {
                finishHlsSwitch(currentTime);
            });
            try { player.error(null); } catch (_) {}
            player.src({ src: manifestUrl, type: 'application/x-mpegURL' });
            if (resumeAfterHlsSwitch) {
                hlsPlaybackPending = true;
            }
            player.ready(() => {
                enableQualitySelector();
            });
            stopHlsSwitchTimer();
            hlsSwitchTimer = setTimeout(() => {
                if (!hlsSwitching && !hlsPlaybackPending) return;
                restoreStartupSource(currentTime, resumeAfterHlsSwitch);
            }, 12000);
        }

        function getOrCreateHlsQualityGateButton() {
            const barComponent = player.getChild('controlBar');
            const bar = barComponent && typeof barComponent.el === 'function' ? barComponent.el() : null;
            if (!bar) return null;
            if (hlsQualityGateButton && hlsQualityGateButton.isConnected) {
                return hlsQualityGateButton;
            }

            const button = document.createElement('button');
            const icon = document.createElement('span');
            button.type = 'button';
            button.className = 'vjs-control vjs-button vjs-quality-selector vjs-handrive-hls-quality-gate vjs-hidden';
            button.hidden = true;
            button.setAttribute('aria-label', textByLang('화질 선택', 'Select quality'));
            button.setAttribute('title', textByLang('화질 선택', 'Select quality'));
            icon.className = 'vjs-icon-placeholder';
            icon.classList.add('vjs-icon-hd');
            icon.setAttribute('aria-hidden', 'true');
            button.appendChild(icon);
            button.addEventListener('click', onHlsQualityGateClick);
            hlsQualityGateButton = button;

            placeHlsQualityGateButton();
            syncHlsQualityGateLoading();
            return button;
        }

        function placeHlsQualityGateButton() {
            const barComponent = player.getChild('controlBar');
            const bar = barComponent && typeof barComponent.el === 'function' ? barComponent.el() : null;
            const button = hlsQualityGateButton;
            if (!bar || !button) return;
            const rate = bar.querySelector('.vjs-playback-rate');
            if (rate && rate.nextSibling !== button) {
                bar.insertBefore(button, rate.nextSibling || null);
                return;
            }
            if (!rate && !button.parentNode) {
                const insertBefore = bar.querySelector('.vjs-pip-button, .vjs-fullscreen-control');
                bar.insertBefore(button, insertBefore || null);
            }
        }

        function syncHlsQualityGateLoading() {
            const button = hlsQualityGateButton;
            if (!button) return;
            button.classList.toggle('is-hls-loading', hlsQualityGateLoading);
            button.setAttribute('aria-busy', hlsQualityGateLoading ? 'true' : 'false');
        }

        function setHlsQualityGateLoading(loading) {
            hlsQualityGateLoading = Boolean(loading);
            syncHlsQualityGateLoading();
        }

        function setHlsQualityGateVisible(visible) {
            const button = visible ? getOrCreateHlsQualityGateButton() : hlsQualityGateButton;
            if (!button) return;
            const shouldShow = Boolean(visible) && !hlsQualityGateDismissed && !hasQualitySelectorControl();
            button.hidden = !shouldShow;
            button.classList.toggle('vjs-hidden', !shouldShow);
            button.classList.toggle('is-hls-ready', latestHlsStatus === 'ready' && shouldShow);
            placeHlsQualityGateButton();
        }

        function syncHlsQualityGateVisibility() {
            setHlsQualityGateVisible(!hasQualitySelectorControl());
        }

        function showHlsQualityGate() {
            hlsQualityGateDismissed = false;
            setHlsLoading(false);
            hideBadge();
            setHlsQualityGateLoading(false);
            setHlsQualityGateVisible(true);
        }

        function hideHlsQualityGate() {
            setHlsQualityGateVisible(false);
        }

        function dismissHlsQualityGate() {
            hlsQualityGateDismissed = true;
            setHlsQualityGateVisible(false);
        }

        function onHlsQualityGateClick(event) {
            event.preventDefault();
            event.stopPropagation();
            if (sourceIsHls()) {
                enableQualitySelector();
                syncQualitySelectorVisibility();
                return;
            }
            dismissHlsQualityGate();
            setHlsQualityGateLoading(true);
            if (latestHlsStatus === 'ready') {
                useHlsWhenReady({ resume: userWantsPlayback || !player.paused() });
                return;
            }
            requestHlsPreparation({
                allowPolling: true,
                allowTranscode: true,
                forceSwitch: true,
                resume: userWantsPlayback || !player.paused(),
                showPreparing: true,
            });
        }

        // 트랜스코딩 진행 배지
        function getOrCreateBadge() {
            let b = player.el().querySelector('.vjs-hls-badge');
            if (!b) {
                b = document.createElement('div');
                b.className = 'vjs-hls-badge';
                player.el().appendChild(b);
            }
            return b;
        }
        function showBadge(text) {
            const b = getOrCreateBadge();
            b.textContent = text;
            b.hidden = false;
        }
        function hideBadge() {
            const b = player.el().querySelector('.vjs-hls-badge');
            if (b) {
                b.hidden = true;
            }
        }
        function showHlsUnavailableBadge() {
            setHlsLoading(false);
            hideHlsQualityGate();
            if (startupSrc) {
                hideBadge();
                return;
            }
            showBadge(textByLang('재생 변환을 준비하지 못했습니다.', 'Playback conversion is unavailable.'));
        }
        function useHlsWhenReady(options = {}) {
            hideBadge();
            dismissHlsQualityGate();
            switchToHls(options);
        }

        function rememberPlayIntent(options = {}) {
            userWantsPlayback = true;
            resumeAfterHlsSwitch = true;
            if (sourceIsHls()) {
                player.play().catch(() => {});
                return;
            }
            if (latestHlsStatus === 'ready') {
                useHlsWhenReady({ resume: true });
                return;
            }
            if (!startupSrc) {
                requestHlsPreparation({
                    allowPolling: true,
                    allowTranscode: true,
                    forceSwitch: true,
                    resume: true,
                    showPreparing: options.showPreparing !== false,
                });
            }
            if (options.showPreparing !== false && !hasCurrentSource()) {
                setHlsLoading(true);
                showBadge('화질 선택 준비 중... 0%');
            }
        }

        function bindPlayIntentHandlers() {
            const root = player.el();
            if (!root) return;
            const playSelector = '.vjs-big-play-button, .vjs-play-control';
            const isPlayTarget = target => Boolean(target && target.closest && target.closest(playSelector));
            const interceptIfWaitingForHls = event => {
                if (!isPlayTarget(event.target)) return;
                if (startupSrc || sourceIsHls() || hasCurrentSource()) {
                    userWantsPlayback = true;
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                if (typeof event.stopImmediatePropagation === 'function') {
                    event.stopImmediatePropagation();
                }
                rememberPlayIntent({ showPreparing: true });
            };
            const handlePlayKey = event => {
                if (!isPlayTarget(event.target)) return;
                if (event.key !== 'Enter' && event.key !== ' ') return;
                interceptIfWaitingForHls(event);
            };

            root.addEventListener('pointerdown', interceptIfWaitingForHls, true);
            root.addEventListener('click', interceptIfWaitingForHls, true);
            root.addEventListener('keydown', handlePlayKey, true);
            cleanups.push(() => {
                root.removeEventListener('pointerdown', interceptIfWaitingForHls, true);
                root.removeEventListener('click', interceptIfWaitingForHls, true);
                root.removeEventListener('keydown', handlePlayKey, true);
            });
        }

        function handleHlsStatus(data, options = {}) {
            if (shouldIgnoreHlsAsync()) return;
            const status = String(data && data.status || '');
            latestHlsStatus = status;
            if (status === 'ready') {
                stopPoll();
                if (options.forceSwitch || !startupSrc) {
                    useHlsWhenReady({ resume: Boolean(options.resume || userWantsPlayback) });
                } else {
                    showHlsQualityGate();
                }
            } else if (status === 'error') {
                stopPoll();
                setHlsQualityGateLoading(false);
                showHlsUnavailableBadge();
            } else if (status === 'not_started') {
                if (options.allowTranscode) {
                    kickoffHlsTranscoding(options);
                } else if (!startupSrc) {
                    showBadge('화질 선택 준비 중... 0%');
                }
            } else if (options.allowPolling) {
                showBadge(`화질 선택 준비 중... ${data.progress || 0}%`);
                startPolling(options);
            }
        }

        function requestHlsPreparation(options = {}) {
            if (sourceIsHls()) {
                enableQualitySelector();
                if (options.resume || userWantsPlayback) {
                    player.play().catch(() => {});
                }
                return;
            }
            if (hlsStatusInFlight) {
                pendingHlsPreparationOptions = Object.assign({}, pendingHlsPreparationOptions || {}, options);
                return;
            }
            hlsStatusInFlight = true;
            fetchHlsStatus()
                .then(data => handleHlsStatus(data, options))
                .catch(handleHlsFetchError)
                .finally(() => {
                    hlsStatusInFlight = false;
                    const pendingOptions = pendingHlsPreparationOptions;
                    pendingHlsPreparationOptions = null;
                    if (pendingOptions && !shouldIgnoreHlsAsync()) {
                        requestHlsPreparation(pendingOptions);
                    }
                });
        }

        function fetchHlsStatus() {
            return hlsFetch(statusUrl).then(r => {
                if (!r.ok) {
                    throw new Error('HLS status failed');
                }
                return r.json();
            });
        }

        function startPolling(options = {}) {
            hlsPollingOptions = Object.assign({}, hlsPollingOptions, options);
            if (pollTimer) return;
            pollTimer = setInterval(() => {
                fetchHlsStatus()
                    .then(d => {
                        handleHlsStatus(d, hlsPollingOptions);
                    })
                    .catch(handleHlsFetchError);
            }, POLL_MS);
        }

        function kickoffHlsTranscoding(options = {}) {
            if (hlsKickoffStarted) return;
            hlsKickoffStarted = true;
            setHlsQualityGateLoading(true);
            if (userWantsPlayback) {
                setHlsLoading(true);
            }
            if (options.showPreparing !== false) {
                showBadge('화질 선택 준비 중... 0%');
            }
            hlsFetch(manifestUrl).then(r => {
                if (!r.ok && r.status !== 202) {
                    throw new Error('HLS manifest failed');
                }
                return r;
            }).then(() => {
                if (!shouldIgnoreHlsAsync()) {
                    startPolling(options);
                }
            }).catch(handleHlsFetchError);
        }

        function scheduleHlsReadyProbe() {
            if (!startupSrc || latestHlsStatus === 'ready' || sourceIsHls()) return;
            if (hlsReadyProbeTimer || hlsReadyProbeIdleId) return;
            const runProbe = () => {
                hlsReadyProbeTimer = null;
                hlsReadyProbeIdleId = null;
                if (shouldIgnoreHlsAsync() || sourceIsHls()) return;
                requestHlsPreparation({
                    allowPolling: false,
                    allowTranscode: false,
                    showPreparing: false,
                });
            };
            if ('requestIdleCallback' in window) {
                hlsReadyProbeIdleId = window.requestIdleCallback(runProbe, { timeout: 1800 });
            } else {
                hlsReadyProbeTimer = setTimeout(runProbe, 900);
            }
        }

        function stopHlsFallback() {
            stopPoll();
            showHlsUnavailableBadge();
        }

        player.on('error', () => {
            const err = player.error();
            if (!err || !sourceIsHls()) return;
            const currentTime = player.currentTime();
            if (!restoreStartupSource(currentTime, resumeAfterHlsSwitch || userWantsPlayback || !player.paused())) {
                try { player.error(null); } catch (_) {}
                hlsSwitching = false;
                hlsPlaybackPending = false;
                player.handriveHlsSwitching_ = false;
                player.handriveHlsSourceActive_ = false;
                clearSourceTransitionSoon();
                setHlsLoading(false);
                showHlsUnavailableBadge();
            }
        });

        bindPlayIntentHandlers();
        player.ready(syncHlsQualityGateVisibility);
        scheduleHlsReadyProbe();
    }

    // ── Cleanup ───────────────────────────────────────────────────────
    function disposePlayer(el) {
        const entry = players.get(el);
        if (!entry) return;
        players.delete(el);
        entry.cleanups.forEach(fn => {
            try { fn(); } catch (_) {}
        });
        releasePlayerMediaResources(entry.player, el);
        try { entry.player.dispose(); } catch (_) {}
        releaseNativeMediaElement(el);
        if (el && el.dataset) {
            delete el.dataset.vjsInitialized;
        }
    }

    function cleanup(el) {
        if (!el) return Promise.resolve();
        const activePip = getActiveVideoPictureInPictureElement(null);
        if (activePip === el) {
            return closeVideoPictureInPicture(el).then(() => disposePlayer(el), () => disposePlayer(el));
        }
        disposePlayer(el);
        return Promise.resolve();
    }

    function cleanupPreview(root) {
        const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
        const videos = Array.from(scope.querySelectorAll('video.video-js'));
        return closeVideoPictureInPicture(scope).then(() => {
            return Promise.all(videos.map(cleanup));
        });
    }

    function cleanupRemovedVideoPlayers(node) {
        if (!(node instanceof Element)) return;
        if (node.matches('video.video-js')) {
            cleanup(node);
        }
        node.querySelectorAll('video.video-js').forEach(cleanup);
    }

    // ── DOM 스캔 · 감시 ───────────────────────────────────────────────
    function scanAndInit(root) {
        root.querySelectorAll('video.video-js:not([data-vjs-initialized])').forEach(el => {
            if (!('IntersectionObserver' in window)) { init(el); return; }
            const io = new IntersectionObserver((entries, obs) => {
                if (!entries[0].isIntersecting) return;
                obs.disconnect();
                init(el);
            }, { rootMargin: '100px' });
            io.observe(el);
        });
    }

    function ready(fn) {
        document.readyState !== 'loading' ? fn() : document.addEventListener('DOMContentLoaded', fn);
    }

    ready(() => {
        scanAndInit(document);

        document.querySelectorAll('.handrive-list-preview-content').forEach(container => {
            new MutationObserver(records => {
                records.forEach(record => {
                    record.removedNodes.forEach(cleanupRemovedVideoPlayers);
                });
                scanAndInit(container);
            })
                .observe(container, { childList: true, subtree: true });
        });

        document.addEventListener('handrive:preview:hide', (e) => {
            const panel = e && e.detail && e.detail.panel;
            cleanupPreview(panel || document);
        });
    });

    window.HandriveVideoPlayer = {
        init,
        cleanup,
        cleanupPreview,
        closeVideoPictureInPicture,
        players,
    };
})();
