(function () {
    'use strict';

    if (typeof videojs === 'undefined') return;

    // ── localStorage 유틸 ──────────────────────────────────────────────
    const ls = {
        get:    (k)    => { try { return localStorage.getItem(k); }    catch { return null; } },
        set:    (k, v) => { try { localStorage.setItem(k, v); }        catch {} },
        remove: (k)    => { try { localStorage.removeItem(k); }        catch {} },
    };
    const timeKey = (src) => `vjs-time-${encodeURIComponent(src)}`;

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

    // ── 진입점 ────────────────────────────────────────────────────────
    function init(el) {
        if (el.dataset.vjsInitialized || videojs.getPlayer(el)) return;
        el.dataset.vjsInitialized = '1';

        const cleanups = [];
        const player   = buildPlayer(el);
        players.set(el, { player, cleanups });

        setupControls(player);
        setupPip(player);
        setupCast(player);
        setupThumbnailPreview(player, el);
        setupPersist(player);
        setupMobile(player, cleanups);
        setupErrors(player);
        setupNetwork(player);
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

        const player = videojs(el, {
            controls:            true,
            preload:             isPreview ? 'none' : 'metadata',
            playbackRates:       [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
            defaultPlaybackRate: savedRate,
            muted:               false,
            controlBar: {
                // progressControl은 CSS로 컨트롤바 위 행으로 올림
                children: [
                    'playToggle',
                    // setupControls의 ready()에서 index 1,2에 back/forward 삽입
                    'progressControl',
                    'currentTimeDisplay',
                    'timeDivider',
                    'durationDisplay',
                    'customControlSpacer',
                    { name: 'volumePanel', inline: true },
                    'playbackRateMenuButton',
                    'fullscreenToggle',
                ],
            },
        });

        // 초기 소스: fallback MP4로 먼저 설정 (setupHls가 HLS로 교체)
        if (fallbackSrc) {
            player.src({ src: fallbackSrc, type: fallbackType });
        }

        // 포스터 이미지
        const posterUrl = el.dataset.posterUrl;
        if (posterUrl) {
            player.ready(() => player.poster(posterUrl));
        }

        // preload:none 패널에서 hover 시 warmup (첫 재생 딜레이 완화)
        if (isPreview) {
            el.addEventListener('mouseenter', () => player.load(), { once: true });
        }

        return player;
    }

    // ── 컨트롤 공통 ──────────────────────────────────────────────────
    function setupControls(player) {
        // 10초 스킵 버튼: play 바로 뒤 index 1(back), 2(forward)에 직접 삽입
        player.ready(() => {
            const bar = player.getChild('controlBar');
            if (!bar) return;
            const SeekButton = videojs.getComponent('SeekButton');
            if (!SeekButton) {
                if (typeof player.seekButtons === 'function') {
                    player.seekButtons({ back: 10, forward: 10, backIndex: 1, forwardIndex: 2 });
                }
                return;
            }
            bar.addChild('SeekButton', { direction: 'back',    seconds: 10 }, 1);
            bar.addChild('SeekButton', { direction: 'forward', seconds: 10 }, 2);
        });

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

    // ── 미니 플레이어 (PiP) ───────────────────────────────────────────
    function setupPip(player) {
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
                document.addEventListener('enterpictureinpicture', () => this.addClass('vjs-pip-active'));
                document.addEventListener('leavepictureinpicture',  () => this.removeClass('vjs-pip-active'));
            }
            handleClick() {
                if (this.player().isFullscreen()) this.player().exitFullscreen();
                (document.pictureInPictureElement
                    ? document.exitPictureInPicture()
                    : videoEl.requestPictureInPicture()
                ).catch(() => {});
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
        const videoEl = player.el().querySelector('video');
        const vttUrl  = (videoEl && videoEl.dataset.thumbnailVttUrl) || (el && el.dataset.thumbnailVttUrl);
        if (vttUrl) {
            setupVttThumbnails(player, vttUrl);
        } else {
            setupRealtimeThumbnails(player, el);
        }
    }

    // VTT 스프라이트 방식: 미리 생성된 sprite.jpg + sprite.vtt 사용
    function setupVttThumbnails(player, vttUrl) {
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

        let entries = null; // [{start, end, x, y, w, h, spriteUrl}]
        let spritePreloaded = false;

        // VTT 파싱
        fetch(vttUrl)
            .then(r => r.text())
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
            .catch(() => {});

        player.ready(() => {
            const bar     = player.getChild('controlBar');
            const progCtl = bar && bar.getChild('progressControl');
            if (!progCtl) return;

            const progEl = progCtl.el();
            progEl.style.position = 'relative';
            progEl.appendChild(tooltip);

            progEl.addEventListener('mousemove', (e) => {
                const dur = player.duration();
                if (!dur || !entries) return;

                const rect  = progEl.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
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

                const localX   = e.clientX - rect.left;
                const clampedX = Math.max(THUMB_W / 2, Math.min(localX, rect.width - THUMB_W / 2));
                tooltip.style.left = clampedX + 'px';
                tooltip.hidden = false;
            });

            progEl.addEventListener('mouseleave', () => { tooltip.hidden = true; });
        });
    }

    function _vttTimeToSec(t) {
        const parts = t.split(':').map(parseFloat);
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        return parts[0] || 0;
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

        const thumbVid = document.createElement('video');
        thumbVid.setAttribute('muted', '');
        thumbVid.muted   = true;
        thumbVid.preload = 'auto';
        thumbVid.playsInline = true;
        thumbVid.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none;';

        let pendingTime  = -1;
        let seeking      = false;
        let metaReady    = false;

        function tryDraw() {
            if (thumbVid.readyState < 2) return;
            try { ctx.drawImage(thumbVid, 0, 0, THUMB_W, THUMB_H); } catch (_) {}
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
            if (pendingTime >= 0) doSeek();
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

            const progEl = progCtl.el();
            progEl.style.position = 'relative';
            progEl.appendChild(tooltip);
            player.el().appendChild(thumbVid);

            progEl.addEventListener('mousemove', (e) => {
                const dur = player.duration();
                if (!dur) return;

                const rect  = progEl.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const time  = ratio * dur;

                timeLabel.textContent = fmtTime(time);

                const localX   = e.clientX - rect.left;
                const clampedX = Math.max(THUMB_W / 2, Math.min(localX, rect.width - THUMB_W / 2));
                tooltip.style.left = clampedX + 'px';
                tooltip.hidden = false;

                if (!thumbVid.src) {
                    const videoEl = player.el().querySelector('video');
                    const faststartUrl = el && el.dataset.faststartUrl;
                    const src = faststartUrl
                        || (videoEl && videoEl.dataset.fallbackSrc)
                        || player.currentSrc();
                    thumbVid.src = src;
                }

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
        const msgs = {
            1: '재생이 중단되었습니다.',
            2: '네트워크 오류가 발생했습니다.',
            3: '지원하지 않는 파일 형식입니다.',
            4: '파일을 재생할 수 없습니다.',
        };

        player.on('error', () => {
            const err  = player.error();
            const code = err ? err.code : 0;
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
        });
    }

    // ── 버퍼링 · 네트워크 UI ─────────────────────────────────────────
    function setupNetwork(player) {
        let timer  = null;
        const root = player.el();

        function getOverlay() {
            let ov = root.querySelector('.vjs-network-overlay');
            if (!ov) {
                ov = document.createElement('div');
                ov.className = 'vjs-network-overlay';
                root.appendChild(ov);
            }
            return ov;
        }

        function showOverlay(msg) {
            const ov = getOverlay();
            ov.textContent = msg;
            ov.hidden = false;
        }

        function hideOverlay() {
            clearTimeout(timer);
            timer = null;
            const ov = root.querySelector('.vjs-network-overlay');
            if (ov) ov.hidden = true;
        }

        player.on('waiting', () => { timer = setTimeout(() => showOverlay('버퍼링 중...'), 1500); });
        player.on('stalled', () => showOverlay('네트워크가 느립니다...'));
        player.on('playing', hideOverlay);
        player.on('ended',   hideOverlay);
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

        player.on('play', () => {
            navigator.mediaSession.metadata = new MediaMetadata({
                title,
                artwork: posterUrl ? [{ src: posterUrl, sizes: '1280x720', type: 'image/jpeg' }] : [],
            });
            navigator.mediaSession.playbackState = 'playing';
        });
        player.on('pause', () => { navigator.mediaSession.playbackState = 'paused'; });

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

        player.on('timeupdate', () => {
            try {
                navigator.mediaSession.setPositionState?.({
                    duration:     player.duration() || 0,
                    position:     player.currentTime(),
                    playbackRate: player.playbackRate(),
                });
            } catch (_) {}
        });

        player.on('dispose', () => {
            try { navigator.mediaSession.metadata = null; } catch (_) {}
        });
    }

    // ── HLS 소스 선택 + 화질 선택기 ──────────────────────────────────
    function setupHls(player, el, cleanups) {
        const manifestUrl = el.dataset.hlsManifestUrl || '';
        const statusUrl   = el.dataset.hlsStatusUrl   || '';
        if (!manifestUrl || !statusUrl) return;

        const POLL_MS = 3000;
        let pollTimer = null;

        function stopPoll() {
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        }
        cleanups.push(stopPoll);

        // 화질 선택기 활성화
        function enableQualitySelector() {
            if (typeof player.hlsQualitySelector === 'function') {
                try { player.hlsQualitySelector({ displayCurrentQuality: true }); } catch (_) {}
            }
        }

        // HLS 소스로 전환 (재생 중이면 위치 보존)
        function switchToHls() {
            const currentTime = player.currentTime();
            const wasPlaying  = !player.paused();
            player.src({ src: manifestUrl, type: 'application/x-mpegURL' });
            player.ready(() => {
                enableQualitySelector();
                player.one('loadedmetadata', () => {
                    if (currentTime > 1) player.currentTime(currentTime);
                    if (wasPlaying) player.play().catch(() => {});
                });
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
            if (b) b.hidden = true;
        }
        // "HD 사용 가능" 배지 — 클릭 시 HLS로 전환
        function showHdBadge() {
            const b = getOrCreateBadge();
            b.textContent = 'HD 화질 사용 가능 ▸';
            b.className = 'vjs-hls-badge vjs-hls-badge--ready';
            b.hidden = false;
            b.onclick = () => { b.hidden = true; switchToHls(); };
        }

        function handleStatus(data) {
            if (data.status === 'ready') {
                stopPoll();
                hideBadge();
                switchToHls();
            } else if (data.status === 'error') {
                stopPoll();
                hideBadge();
            } else {
                const pct = data.progress || 0;
                showBadge(`화질 선택 준비 중... ${pct}%`);
            }
        }

        // 상태 조회 → 필요하면 트랜스코딩 시작
        fetch(statusUrl)
            .then(r => r.json())
            .then(data => {
                if (data.status === 'ready') {
                    // 이미 완료 → 바로 HLS
                    switchToHls();
                } else if (data.status === 'error') {
                    // 오류 → fallback MP4 그대로 유지
                } else {
                    // not_started 또는 transcoding → 트랜스코딩 킥오프
                    if (data.status === 'not_started') {
                        fetch(manifestUrl).catch(() => {}); // 202 무시
                    }
                    showBadge(`화질 선택 준비 중... ${data.progress || 0}%`);
                    pollTimer = setInterval(() => {
                        fetch(statusUrl)
                            .then(r => r.json())
                            .then(d => {
                                if (d.status === 'ready') {
                                    stopPoll();
                                    hideBadge();
                                    showHdBadge();
                                } else if (d.status === 'error') {
                                    stopPoll();
                                    hideBadge();
                                } else {
                                    showBadge(`화질 선택 준비 중... ${d.progress || 0}%`);
                                }
                            })
                            .catch(() => {});
                    }, POLL_MS);
                }
            })
            .catch(() => {}); // 상태 조회 실패 시 fallback MP4 그대로
    }

    // ── Cleanup ───────────────────────────────────────────────────────
    function cleanup(el) {
        const entry = players.get(el);
        if (!entry) return;
        entry.cleanups.forEach(fn => fn());
        try { entry.player.dispose(); } catch (_) {}
        players.delete(el);
        delete el.dataset.vjsInitialized;
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
            new MutationObserver(() => scanAndInit(container))
                .observe(container, { childList: true, subtree: true });
        });

        document.addEventListener('handrive:preview:hide', (e) => {
            const panel = e && e.detail && e.detail.panel;
            (panel || document).querySelectorAll('video.video-js').forEach(cleanup);
        });
    });

    window.HandriveVideoPlayer = { init, cleanup, players };
})();
