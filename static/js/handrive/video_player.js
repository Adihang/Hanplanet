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

    // ── localStorage 유틸 ──────────────────────────────────────────────
    const ls = {
        get:    (k)    => { try { return localStorage.getItem(k); }    catch { return null; } },
        set:    (k, v) => { try { localStorage.setItem(k, v); }        catch {} },
        remove: (k)    => { try { localStorage.removeItem(k); }        catch {} },
    };
    const timeKey = (src) => `vjs-time-${encodeURIComponent(src)}`;
    const MEDIA_LOOP_STORAGE_KEY = 'handrive-media-loop-enabled';

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

    function isMediaLoopEnabled() {
        return ls.get(MEDIA_LOOP_STORAGE_KEY) === '1';
    }

    function storeMediaLoopEnabled(enabled) {
        ls.set(MEDIA_LOOP_STORAGE_KEY, enabled ? '1' : '0');
        window.dispatchEvent(new CustomEvent('handrive:media-loop-change', {
            detail: { enabled: Boolean(enabled) },
        }));
    }

    function buildLoopIconSvg(enabled) {
        const checkPath = enabled
            ? '<path class="handrive-loop-check-path" d="M8.4 12.8l2.4 2.4 5.2-5.7"/>'
            : '';
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
            + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="1.35em" height="1.35em">'
            + '<path d="M17 2l4 4-4 4"/>'
            + '<path d="M3 11V9a4 4 0 0 1 4-4h14"/>'
            + '<path d="M7 22l-4-4 4-4"/>'
            + '<path d="M21 13v2a4 4 0 0 1-4 4H3"/>'
            + checkPath
            + '</svg>';
    }

    // ── 진입점 ────────────────────────────────────────────────────────
    function init(el) {
        if (el.dataset.vjsInitialized || videojs.getPlayer(el)) return;
        el.dataset.vjsInitialized = '1';

        const cleanups = [];
        const player   = buildPlayer(el);
        players.set(el, { player, cleanups });

        setupControls(player);
        setupControlBarHoverState(player, cleanups);
        setupDelayedMenuPopups(player, cleanups);
        setupResponsiveControlBar(player, cleanups);
        setupLoop(player, cleanups);
        setupPip(player, cleanups);
        setupCast(player);
        setupThumbnailPreview(player, el);
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
        const fallbackSrc  = el.dataset.fallbackSrc  || '';
        const fallbackType = el.dataset.fallbackType || 'video/mp4';
        const faststartSrc = el.dataset.faststartUrl || '';
        const startupSrc = faststartSrc || fallbackSrc;
        const startupType = faststartSrc ? 'video/mp4' : fallbackType;
        const preloadMode = isPreview ? 'metadata' : 'auto';
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

        // 초기 소스: faststart MP4가 있으면 먼저 사용해 첫 재생 버퍼링을 줄인다.
        if (startupSrc) {
            player.src({ src: startupSrc, type: startupType });
        }

        // 포스터 이미지
        const posterUrl = el.dataset.posterUrl;
        if (posterUrl) {
            player.ready(() => player.poster(posterUrl));
        }

        // 상세 재생 화면은 idle 시점에 미리 로드를 걸어 첫 클릭 지연을 줄인다.
        if (!isPreview && startupSrc) {
            player.ready(() => {
                const warmup = () => {
                    if (player.isDisposed && player.isDisposed()) return;
                    try {
                        player.preload('auto');
                        player.load();
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
                try {
                    player.preload('metadata');
                    player.load();
                } catch (_) {}
            };
            ['mouseenter', 'pointerdown', 'touchstart', 'focusin'].forEach(eventName => {
                el.addEventListener(eventName, warmupPreview, { once: true, passive: true });
            });
        }

        return player;
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
        const buttonLabel = () => getHandriveI18nText('media_loop_toggle', textByLang('연속재생 켜기/끄기', 'Toggle loop playback'));
        const enabledLabel = () => getHandriveI18nText('media_loop_on', textByLang('연속재생 켜짐', 'Loop playback on'));
        const disabledLabel = () => getHandriveI18nText('media_loop_off', textByLang('연속재생 꺼짐', 'Loop playback off'));

        class HandriveLoopButton extends videojs.getComponent('Button') {
            constructor(p, opts) {
                super(p, opts);
                this.controlText(buttonLabel());
                this.addClass('vjs-handrive-loop-button');
                this.el().setAttribute('title', buttonLabel());
                const icon = this.el().querySelector('.vjs-icon-placeholder');
                if (icon) {
                    icon.innerHTML = buildLoopIconSvg(false);
                }
                this.syncLoopState(isMediaLoopEnabled());
                this._syncFromEvent = (event) => {
                    const enabled = Boolean(event && event.detail && event.detail.enabled);
                    this.syncLoopState(enabled);
                };
                window.addEventListener('handrive:media-loop-change', this._syncFromEvent);
                p.on('dispose', () => {
                    window.removeEventListener('handrive:media-loop-change', this._syncFromEvent);
                });
            }

            syncLoopState(enabled) {
                const nextEnabled = Boolean(enabled);
                this.player().loop(nextEnabled);
                this.el().setAttribute('aria-pressed', nextEnabled ? 'true' : 'false');
                this.el().setAttribute('aria-label', nextEnabled ? enabledLabel() : disabledLabel());
                this.el().setAttribute('title', nextEnabled ? enabledLabel() : disabledLabel());
                this.el().classList.toggle('is-loop-enabled', nextEnabled);
                const icon = this.el().querySelector('.vjs-icon-placeholder');
                if (icon) {
                    icon.innerHTML = buildLoopIconSvg(nextEnabled);
                }
            }

            handleClick() {
                storeMediaLoopEnabled(!this.player().loop());
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
    function setupThumbnailPreview(player, el) {
        if (isMobile) return;
        setupProgressHoverIndicator(player);
        const videoEl = player.el().querySelector('video');
        const vttUrl  = (videoEl && videoEl.dataset.thumbnailVttUrl) || (el && el.dataset.thumbnailVttUrl);
        if (vttUrl) {
            setupVttThumbnails(player, vttUrl, el);
        } else {
            setupRealtimeThumbnails(player, el);
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
    function setupVttThumbnails(player, vttUrl, el) {
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

        // VTT 파싱
        fetch(vttUrl)
            .then(r => {
                if (!r.ok) throw new Error('thumbnail vtt unavailable');
                return r.text();
            })
            .then(text => {
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
            .catch(() => {
                tooltip.remove();
                setupRealtimeThumbnails(player, el);
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
    function setupRealtimeThumbnails(player, el) {
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
            if (lastRatio >= 0 && thumbVid.duration) {
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
                if (!thumbVid.src) {
                    const videoEl = player.el().querySelector('video');
                    const src = (el && el.dataset.faststartUrl)
                        || (videoEl && videoEl.dataset.fallbackSrc)
                        || player.currentSrc();
                    if (src) {
                        thumbVid.src = src;
                        thumbVid.load();
                    }
                }
            });

            progEl.addEventListener('mousemove', (e) => {
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

            progEl.addEventListener('mouseleave', () => { tooltip.hidden = true; });
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
                    const src = player.currentSrc();
                    player.error(null);
                    player.src(src);
                    player.load();
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
        const faststartUrl = el.dataset.faststartUrl || '';
        const fallbackSrc = el.dataset.fallbackSrc || '';
        const fallbackType = el.dataset.fallbackType || 'video/mp4';
        const startupSrc = faststartUrl || fallbackSrc;
        const startupType = faststartUrl ? 'video/mp4' : fallbackType;
        const hasFaststartStartupSource = Boolean(faststartUrl);
        const canUseNativeStartupSource = hasFaststartStartupSource
            || /^(video\/mp4|video\/quicktime|video\/x-m4v)$/i.test(fallbackType);

        const POLL_MS = 3000;
        let pollTimer = null;
        let qualitySelectorRetryTimer = null;
        let qualitySelectorRetryCount = 0;
        let qualitySelectorEnabled = false;
        let hlsKickoffStarted = false;
        let hlsSwitching = false;
        let hlsActive = false;
        let hlsSwitchTimer = null;
        let hlsPlaybackPending = false;
        let resumeAfterHlsSwitch = false;
        let userWantsPlayback = false;

        player.handriveHlsRecoverable_ = Boolean(startupSrc);
        player.handriveHlsSourceActive_ = false;

        function stopPoll() {
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        }
        function stopHlsSwitchTimer() {
            if (hlsSwitchTimer) {
                clearTimeout(hlsSwitchTimer);
                hlsSwitchTimer = null;
            }
        }
        cleanups.push(stopPoll);
        cleanups.push(stopHlsSwitchTimer);
        cleanups.push(() => {
            if (qualitySelectorRetryTimer) {
                clearTimeout(qualitySelectorRetryTimer);
                qualitySelectorRetryTimer = null;
            }
            player.handriveHlsSwitching_ = false;
            player.handriveHlsSourceActive_ = false;
            player.handriveSourceTransitionUntil_ = 0;
        });

        player.on('play', () => { userWantsPlayback = true; });
        function markHlsPlaybackReady() {
            hlsPlaybackPending = false;
            stopHlsSwitchTimer();
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

        // 화질 선택기 활성화
        function enableQualitySelector() {
            if (qualitySelectorEnabled) return;
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
            qualitySelectorEnabled = true;
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

        function finishHlsSwitch(previousTime) {
            hlsSwitching = false;
            hlsActive = true;
            player.handriveHlsSwitching_ = false;
            player.handriveHlsSourceActive_ = true;
            clearSourceTransitionSoon();

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
            player.src({ src: startupSrc, type: startupType });
            player.one('loadedmetadata', () => {
                clearSourceTransitionSoon();
                if (previousTime > 1) {
                    try { player.currentTime(previousTime); } catch (_) {}
                }
                if (shouldResume) {
                    player.play().catch(() => {});
                }
            });
            return true;
        }

        // HLS 소스로 전환 (재생 중이면 위치 보존)
        function switchToHls() {
            if (sourceIsHls()) {
                enableQualitySelector();
                return;
            }
            const currentTime = player.currentTime();
            resumeAfterHlsSwitch = userWantsPlayback || !player.paused();
            hlsSwitching = true;
            hlsPlaybackPending = false;
            player.handriveHlsSwitching_ = true;
            player.handriveHlsSourceActive_ = true;
            markSourceTransition();

            try { player.error(null); } catch (_) {}
            player.src({ src: manifestUrl, type: 'application/x-mpegURL' });
            player.ready(() => {
                enableQualitySelector();
                player.one('loadedmetadata', () => {
                    finishHlsSwitch(currentTime);
                });
            });
            stopHlsSwitchTimer();
            hlsSwitchTimer = setTimeout(() => {
                if (!hlsSwitching && !hlsPlaybackPending) return;
                restoreStartupSource(currentTime, resumeAfterHlsSwitch);
            }, 12000);
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
            if (b) b.hidden = true;
        }
        function useHlsWhenReady() {
            hideBadge();
            switchToHls();
        }

        function fetchHlsStatus() {
            return fetch(statusUrl).then(r => {
                if (!r.ok) {
                    throw new Error('HLS status failed');
                }
                return r.json();
            });
        }

        function startPolling() {
            if (pollTimer) return;
            pollTimer = setInterval(() => {
                fetchHlsStatus()
                    .then(d => {
                        if (d.status === 'ready') {
                            stopPoll();
                            useHlsWhenReady();
                        } else if (d.status === 'error') {
                            stopPoll();
                            hideBadge();
                        } else {
                            showBadge(`화질 선택 준비 중... ${d.progress || 0}%`);
                        }
                    })
                    .catch(stopHlsFallback);
            }, POLL_MS);
        }

        function kickoffHlsTranscoding() {
            if (hlsKickoffStarted) return;
            hlsKickoffStarted = true;
            showBadge('화질 선택 준비 중... 0%');
            fetch(manifestUrl).then(r => {
                if (!r.ok && r.status !== 202) {
                    throw new Error('HLS manifest failed');
                }
                return r;
            }).then(startPolling).catch(stopHlsFallback);
        }

        function deferHlsKickoffUntilStartupBuffered() {
            const kickoffAfterStartup = () => {
                if (player.isDisposed && player.isDisposed()) return;
                kickoffHlsTranscoding();
            };
            player.one('canplay', kickoffAfterStartup);
            player.one('loadeddata', kickoffAfterStartup);
            player.one('error', kickoffHlsTranscoding);
        }

        function stopHlsFallback() {
            stopPoll();
            hideBadge();
        }

        player.on('error', () => {
            const err = player.error();
            if (!err || !sourceIsHls()) return;
            const currentTime = player.currentTime();
            restoreStartupSource(currentTime, resumeAfterHlsSwitch || userWantsPlayback || !player.paused());
        });

        // 상태 조회 → 필요하면 트랜스코딩 시작
        fetchHlsStatus()
            .then(data => {
                if (data.status === 'ready') {
                    // HLS가 준비되면 바로 전환해 control bar에 화질 선택기를 만든다.
                    useHlsWhenReady();
                } else if (data.status === 'error') {
                    // 오류 → fallback MP4 그대로 유지
                } else {
                    // not_started 또는 transcoding → 첫 재생 버퍼링을 방해하지 않도록 가능하면 지연
                    if (data.status === 'not_started') {
                        if (canUseNativeStartupSource) {
                            deferHlsKickoffUntilStartupBuffered();
                            return;
                        }
                        kickoffHlsTranscoding();
                        return;
                    }
                    showBadge(`화질 선택 준비 중... ${data.progress || 0}%`);
                    startPolling();
                }
            })
            .catch(stopHlsFallback); // 상태 조회 실패 시 fallback MP4 그대로
    }

    // ── Cleanup ───────────────────────────────────────────────────────
    function disposePlayer(el) {
        const entry = players.get(el);
        if (!entry) return;
        entry.cleanups.forEach(fn => fn());
        try { entry.player.dispose(); } catch (_) {}
        players.delete(el);
        delete el.dataset.vjsInitialized;
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
