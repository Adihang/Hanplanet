/**
 * text-bubble page
 *
 * 물리: sub/bubble (site.js initInteractiveBubbleBackground) 완전 동일
 *   - 벽 충돌 + 버블 간 충돌 → 속도 임계값 초과 시 팝
 *   - 클릭으로 팝
 *   - 전체 팝 → 새 기사 fetch + 버블 재생성
 *
 * 텍스트: pretext로 전체 폭 기준 줄바꿈은 고정하고, 같은 줄 안의 글자만 버블 주변에서 좌우로 민다
 *   - 버블이 와도 개행은 변하지 않고 각 라인의 글자 위치만 옆으로 이동한다
 *   - 버블 자체는 그리지 않음 — 텍스트 레이아웃 변화만으로 존재 표현
 */
import { prepareWithSegments, layoutNextLine } from 'https://esm.sh/@chenglou/pretext';

(function () {
    'use strict';

    const canvas = document.getElementById('textBubbleCanvas');
    const cursorSprite = document.getElementById('speakiCursor');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // ── Config ────────────────────────────────────────────────────────────────
    const BODY_FONT  = '17px Georgia, "Times New Roman", serif';
    const LINE_HEIGHT = 29;
    const LINE_ASCENT = 20;
    const PAGE_MARGIN      = 10;  // 상/좌/우 여백 px
    const SPINE_EFFECT_R   = 120; // spine 영향 반경 px
    const SPINE_CURVE_Y    = 7;   // 최대 y 휨 px (spine 바로 옆)
    const SPINE_SQUEEZE_X  = 0.1; // 최대 x 압축 비율 (spine 옆 글자 좁아짐)
    const SPINE_ALPHA_MIN  = 0.55;// spine 바로 옆 최소 alpha
    const SPINE_SHADOW_W   = 52;  // spine 그림자 너비 px
    const COL_H_MARGIN   = PAGE_MARGIN + 18;
    const COL_GUTTER     = 44; // 두 컬럼 사이 간격
    const FOOTER_H       = 30; // 하단 footer 영역 높이
    const FOOTER_FONT    = '13px Georgia, "Times New Roman", serif';
    const MIN_SEG_WIDTH = 8;
    const TEXT_BUBBLE_PADDING = 6;
    const lineSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

    // sub/bubble 동일 물리 상수
    const POP_SENSITIVITY = 0.5;
    const WALL_POP_SPEED   = 10.65 / POP_SENSITIVITY;
    const IMPACT_POP_SPEED = 9.65 / POP_SENSITIVITY;
    const POINTER_DEFEAT_CURSOR_SPEED = IMPACT_POP_SPEED; // 버블 팝 충돌속도와 동일
    const POINTER_OCCUPY_RADIUS = 32;
    const GHOST_CURSOR_DRAG         = 0.991;
    const GHOST_CURSOR_WALL_BOUNCE  = 0.88;
    const POINTER_REACTION = POINTER_OCCUPY_RADIUS;
    const POINTER_KEEPOUT  = 32;
    const POINTER_TRAIL_RADIUS = 42;
    const POINTER_TRAIL_DURATION = 560;
    const POINTER_TRAIL_INTERVAL = 7;
    const POINTER_TRAIL_MOVE_THRESHOLD = 4;
    const POINTER_SPRITE_OFFSET_X = 14;
    const POINTER_SPRITE_OFFSET_Y = 10;
    const POINTER_VISUAL_MIN_MOVE = 0.001;
    const POINTER_FLIP_DURATION = 0.16;
    const POINTER_ROTATION_LERP_PER_SECOND = 18;
    const POINTER_CRASH_IMAGE_MS = 960;
    const POINTER_DEFEAT_IMAGE_MS = 3120;
    const POINTER_ACC_IMAGE_MS = 1080;
    const POINTER_DEFAULT_FRAME_MS = 220;
    const POINTER_IDLE_THRESHOLD_MS = 120;
    const BUBBLE_SPRITE_ASPECT = 3091 / 3641;
    const BUBBLE_COLLISION_SCALE = 0.94;
    const BUBBLE_VISUAL_SCALE = 2;
    const BUBBLE_COUNT     = 7;
    const BG_CSS           = 'rgb(248,245,238)';
    const TEXT_COLOR       = '#1a1a1a';

    // ── State ─────────────────────────────────────────────────────────────────
    let canvasW = 0, canvasH = 0, dpr = 1;
    let leftColX = 0, leftColW = 0, rightColX = 0, rightColW = 0, dividerX = 0;
    let rafId = null, lastFrameTime = 0;
    let prepared = null, articleLoaded = false;
    let bubblesExhausted = false;
    let articleTitle = '';
    let pageSpread   = 1; // 현재 스프레드: 1→(1,2), 2→(3,4), ...
    let pageTurnActive = false; // 책넘김 애니메이션 진행 중 → 물리 업데이트 정지

    const bubbles      = [];
    const dyingBubbles = []; // 팝 애니메이션 중인 버블 (스케일 업 플래시 → 페이드 아웃)
    const popRings     = []; // 팝 충격파 링 (확장 → 페이드)
    const pointer   = { x: 0, y: 0, vx: 0, vy: 0, active: false, held: false };
    // spritePos: 커서 이미지 + 물리효과의 단일 위치
    //   pointer.active → lerp로 커서 추적 (멀수록 빠름)
    //   !pointer.active → 자율 드리프트 (ghost cursor 대체)
    const spritePos = { x: 0, y: 0, vx: 0, vy: 0, drift: 1, phase: 0, initialized: false, movingAway: false };
    let lastSpritePosTrailX = 0, lastSpritePosTrailY = 0;
    const pointerEchoes = [];
    const pointerVisual = {
        currentFlipX: 1,
        targetFlipX: 1,
        flipFromX: 1,
        flipProgress: 1,
        currentRotation: 0,
        targetRotation: 0,
        spriteState: 'default',
        defaultSetIndex: 0,
        crashSetIndex: 0,
        crashUntil: 0,
        crashStartedAt: 0,
        defeatUntil: 0,
        defeatStartedAt: 0,
        accUntil: 0,
        accStartedAt: 0,
        pointerMovedAt: 0
    };

    // ── Helpers ───────────────────────────────────────────────────────────────
    const clampUnit = v => Math.min(1, Math.max(0, v));
    const clamp     = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const rnd       = (min, max) => Math.random() * (max - min) + min;
    const normalizeAngle = angle => {
        let nextAngle = angle;
        while (nextAngle > Math.PI) nextAngle -= Math.PI * 2;
        while (nextAngle < -Math.PI) nextAngle += Math.PI * 2;
        return nextAngle;
    };
    const easeInOut = value => 0.5 - Math.cos(value * Math.PI) / 2;
    const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const cursorAssets = window.__textBubbleCursorAssets || {
        defaultSets: [],
        crashSets: [],
        defeatStages: [],
        accStages: []
    };
    const bubbleSprite = new window.Image();
    bubbleSprite.decoding = 'sync';
    bubbleSprite.loading = 'eager';
    bubbleSprite.src = window.__textBubbleBubbleAssetUrl || '';
    const pickRandomIndex = (count) => (count > 0 ? Math.floor(Math.random() * count) : 0);

    const getDefaultCursorSrc = (now) => {
        const sets = Array.isArray(cursorAssets.defaultSets) ? cursorAssets.defaultSets : [];
        const activeSet = sets[pointerVisual.defaultSetIndex % Math.max(1, sets.length)] || sets[0] || [];
        if (!activeSet.length) return cursorSprite ? cursorSprite.src : '';
        const isMoving = (now - pointerVisual.pointerMovedAt) < POINTER_IDLE_THRESHOLD_MS;
        const frameIndex = isMoving ? Math.min(1, activeSet.length - 1) : 0;
        return activeSet[frameIndex] || activeSet[0];
    };

    const getCrashCursorSrc = (now) => {
        const sets = Array.isArray(cursorAssets.crashSets) ? cursorAssets.crashSets : [];
        const activeSet = sets[pointerVisual.crashSetIndex % Math.max(1, sets.length)] || sets[0] || [];
        if (!activeSet.length) return getDefaultCursorSrc(now);
        const duration = Math.max(1, pointerVisual.crashUntil - pointerVisual.crashStartedAt);
        const progress = Math.max(0, Math.min(1, (now - pointerVisual.crashStartedAt) / duration));
        return progress <= (1 / 3) ? (activeSet[0] || activeSet[activeSet.length - 1]) : (activeSet[1] || activeSet[0]);
    };

    const getStagedCursorSrc = (stages, startedAt, until, now) => {
        if (!Array.isArray(stages) || !stages.length) return getDefaultCursorSrc(now);
        const duration = Math.max(1, until - startedAt);
        const progress = Math.max(0, Math.min(1, (now - startedAt) / duration));
        let stageIndex = 0;
        if (progress >= (1 / 3)) stageIndex = 1;
        if (progress >= 0.5) stageIndex = 2;
        stageIndex = Math.max(0, Math.min(stages.length - 1, stageIndex));
        return stages[stageIndex] || stages[0];
    };

    const getCursorSpriteSrc = (state, now) => {
        if (!cursorSprite) return '';
        if (state === 'defeat') {
            return getStagedCursorSrc(cursorAssets.defeatStages, pointerVisual.defeatStartedAt, pointerVisual.defeatUntil, now);
        }
        if (state === 'acc') {
            return getStagedCursorSrc(cursorAssets.accStages, pointerVisual.accStartedAt, pointerVisual.accUntil, now);
        }
        if (state === 'crash') {
            return getCrashCursorSrc(now);
        }
        return getDefaultCursorSrc(now);
    };

    const triggerPointerSpriteState = (state, duration) => {
        const startedAt = nowMs();
        const until = startedAt + duration;
        if (state === 'defeat') {
            // 이미 defeat 진행 중이면 startedAt 유지 (애니메이션 리셋 방지)
            if (startedAt >= pointerVisual.defeatUntil) {
                pointerVisual.defeatStartedAt = startedAt;
            }
            pointerVisual.defeatUntil = until;
        } else if (state === 'acc') {
            if (startedAt >= pointerVisual.accUntil) {
                pointerVisual.accStartedAt = startedAt;
            }
            pointerVisual.accUntil = until;
        } else if (state === 'crash') {
            // 이미 crash 진행 중이면 세트 유지, 새 충돌 시에만 랜덤 교체
            const isNewCrash = startedAt >= pointerVisual.crashUntil;
            if (isNewCrash) {
                pointerVisual.crashStartedAt = startedAt;
                pointerVisual.crashSetIndex = pickRandomIndex((cursorAssets.crashSets || []).length);
            }
            pointerVisual.crashUntil = until;
        }
    };

    const updatePointerSpriteState = () => {
        if (!cursorSprite) return;

        const now = nowMs();
        let nextState = 'default';
        if (pointerVisual.defeatUntil > now) nextState = 'defeat';
        else if (pointerVisual.accUntil > now) nextState = 'acc';
        else if (pointerVisual.crashUntil > now) nextState = 'crash';

        if (pointerVisual.spriteState !== nextState && nextState === 'default') {
            pointerVisual.defaultSetIndex = pickRandomIndex((cursorAssets.defaultSets || []).length);
            pointerVisual.pointerMovedAt = 0;
        }
        pointerVisual.spriteState = nextState;
        cursorSprite.src = getCursorSpriteSrc(nextState, now);
    };

    const initBubbleVisualState = (bubble) => {
        bubble.currentFlipX = 1;
        bubble.targetFlipX = 1;
        bubble.flipFromX = 1;
        bubble.flipProgress = 1;
        bubble.currentRotation = 0;
        bubble.targetRotation = 0;
        return bubble;
    };

    const getBubbleCollisionRadii = (bubble) => ({
        rx: bubble.radius * BUBBLE_SPRITE_ASPECT * BUBBLE_COLLISION_SCALE,
        ry: bubble.radius * BUBBLE_COLLISION_SCALE
    });

    const setBubbleVisualDirection = (bubble, dx, dy) => {
        const movementMagnitude = Math.hypot(dx, dy);
        if (movementMagnitude < POINTER_VISUAL_MIN_MOVE) return;

        if (Math.abs(dx) > POINTER_VISUAL_MIN_MOVE) {
            const nextFlipX = dx < 0 ? -1 : 1;
            if (bubble.targetFlipX !== nextFlipX) {
                bubble.flipFromX = bubble.currentFlipX;
                bubble.targetFlipX = nextFlipX;
                bubble.flipProgress = 0;
            }
        }

        const baseRotation = Math.atan2(dy, Math.abs(dx));
        bubble.targetRotation = bubble.targetFlipX < 0 ? -baseRotation : baseRotation;
    };

    const updateBubbleVisualAnimation = (bubble, deltaSeconds) => {
        const rotationDiff = normalizeAngle(bubble.targetRotation - bubble.currentRotation);
        const rotationStep = Math.min(1, POINTER_ROTATION_LERP_PER_SECOND * deltaSeconds);
        bubble.currentRotation = normalizeAngle(bubble.currentRotation + rotationDiff * rotationStep);

        if (bubble.flipProgress < 1) {
            bubble.flipProgress = Math.min(1, bubble.flipProgress + deltaSeconds / POINTER_FLIP_DURATION);
            bubble.currentFlipX =
                bubble.flipFromX +
                (bubble.targetFlipX - bubble.flipFromX) * easeInOut(bubble.flipProgress);
            return;
        }

        bubble.currentFlipX +=
            (bubble.targetFlipX - bubble.currentFlipX) * Math.min(1, 18 * deltaSeconds);
    };

    // ── Spine curve helpers ───────────────────────────────────────────────────
    // dist: 0(spine 바로 옆) ~ 1(영향 밖), 2차 감쇠
    const spineStrength = (x) => {
        const dist = Math.abs(x - dividerX);
        if (dist >= SPINE_EFFECT_R) return 0;
        const t = 1 - dist / SPINE_EFFECT_R;
        return t * t;
    };

    // 글자별로 x압축, y곡률, alpha 적용하여 텍스트 렌더
    const drawTextWithSpine = (text, startX, y) => {
        if (!text) return;
        // spine 영향이 없는 경우 빠른 경로
        const midX = startX + ctx.measureText(text).width * 0.5;
        if (Math.abs(midX - dividerX) > SPINE_EFFECT_R + ctx.measureText(text).width) {
            ctx.fillText(text, startX, y);
            return;
        }
        // 글자별 렌더
        let cx = startX;
        for (const part of lineSegmenter.segment(text)) {
            const ch    = part.segment;
            const w     = ctx.measureText(ch).width;
            const charMidX = cx + w * 0.5;
            const str   = spineStrength(charMidX);
            if (str < 0.001) {
                ctx.fillText(ch, cx, y);
                cx += w;
                continue;
            }
            const yOffset = str * SPINE_CURVE_Y; // 좌우 모두 아래로
            const squeeze = 1 - str * SPINE_SQUEEZE_X;
            const alpha   = 1 - str * (1 - SPINE_ALPHA_MIN);
            ctx.save();
            ctx.globalAlpha *= alpha;
            ctx.translate(cx, y + yOffset);
            ctx.scale(squeeze, 1);
            ctx.fillText(ch, 0, 0);
            ctx.restore();
            cx += w * squeeze;
        }
    };

    const drawBubbleSprite = (bubble) => {
        if (!bubbleSprite.complete || !bubbleSprite.naturalWidth || !bubbleSprite.naturalHeight) return;
        const width  = bubble.radius * 2 * BUBBLE_SPRITE_ASPECT * BUBBLE_VISUAL_SCALE;
        const height = bubble.radius * 2 * BUBBLE_VISUAL_SCALE;
        const str    = spineStrength(bubble.x);
        // spine 근처에서 아래쪽으로 기울어지는 tilt
        const spineTiltRot  = str * 0.18; // 좌우 모두 동일 방향
        const spineSqueezeX = 1 - str * 0.15;    // x 압축 (원근감)
        const spineAlpha    = 1 - str * (1 - SPINE_ALPHA_MIN);
        ctx.save();
        ctx.globalAlpha *= spineAlpha;
        ctx.translate(bubble.x, bubble.y);
        ctx.rotate(bubble.currentRotation + spineTiltRot);
        ctx.scale(bubble.currentFlipX * spineSqueezeX, 1);
        ctx.drawImage(bubbleSprite, -width / 2, -height / 2, width, height);
        ctx.restore();
    };

    // ── Canvas / column geometry ──────────────────────────────────────────────
    const resizeCanvas = () => {
        dpr     = Math.min(window.devicePixelRatio || 1, 2);
        canvasW = window.innerWidth;
        canvasH = window.innerHeight;
        canvas.width  = Math.floor(canvasW * dpr);
        canvas.height = Math.floor(canvasH * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        leftColW  = Math.max(0, Math.floor((canvasW - COL_H_MARGIN * 2 - COL_GUTTER) / 2));
        leftColX  = COL_H_MARGIN;
        rightColX = leftColX + leftColW + COL_GUTTER;
        rightColW = leftColW;
        dividerX  = leftColX + leftColW + COL_GUTTER / 2;
        bubbles.forEach(b => {
            b.x = clamp(b.x, b.radius, canvasW - b.radius);
            b.y = clamp(b.y, b.radius, canvasH - b.radius);
        });
    };

    // ── Bubble creation (sub/bubble 동일 비율) ────────────────────────────────
    const createBubble = () => {
        const base = Math.min(canvasW || window.innerWidth, canvasH || window.innerHeight);
        const min  = Math.max(26, Math.round(base * 0.045)) * 2 * 0.56;
        const max  = Math.max(min + 16, Math.round(base * 0.063) * 2 * 0.56);
        const r    = rnd(min, max);
        return initBubbleVisualState({
            x:             rnd(r, (canvasW || window.innerWidth)  - r),
            y:             rnd(r, (canvasH || window.innerHeight) - r),
            radius:        r,
            vx:            rnd(-0.18, 0.18),
            vy:            rnd(-0.12, 0.12),
            alpha:         rnd(0.35, 0.72),
            phase:         rnd(0, Math.PI * 2),
            drift:         rnd(0.85, 1.2),
            spawnElapsed:  0,
            spawnDuration: rnd(260, 420)
        });
    };

    const initBubbles = () => {
        bubbles.length      = 0;
        dyingBubbles.length = 0;
        popRings.length     = 0;
        for (let i = 0; i < BUBBLE_COUNT; i++) bubbles.push(createBubble());
    };

    // ── Spawn ease ────────────────────────────────────────────────────────────
    const getSpawnEase = b => {
        const p = b.spawnDuration > 0 ? clampUnit(b.spawnElapsed / b.spawnDuration) : 1;
        return 1 - Math.pow(1 - p, 3);
    };

    const createPointerEcho = (x, y, radius = POINTER_TRAIL_RADIUS) => {
        pointerEchoes.push({
            x,
            y,
            radius,
            elapsed: 0,
            duration: POINTER_TRAIL_DURATION
        });
        if (pointerEchoes.length > 24) {
            pointerEchoes.splice(0, pointerEchoes.length - 24);
        }
    };

    const updatePointerEchoes = (dt) => {
        for (let i = pointerEchoes.length - 1; i >= 0; i--) {
            const echo = pointerEchoes[i];
            echo.elapsed += dt;
            if (echo.elapsed >= echo.duration) pointerEchoes.splice(i, 1);
        }
    };

    const getPointerEchoEffR = (echo) => {
        const t = clampUnit(echo.elapsed / echo.duration);
        return echo.radius * Math.pow(1 - t, 1.25);
    };

    const setPointerVisualDirection = (dx, dy) => {
        const movementMagnitude = Math.hypot(dx, dy);
        if (movementMagnitude < POINTER_VISUAL_MIN_MOVE) return;

        if (Math.abs(dx) > POINTER_VISUAL_MIN_MOVE) {
            const nextFlipX = dx < 0 ? -1 : 1;
            if (pointerVisual.targetFlipX !== nextFlipX) {
                pointerVisual.flipFromX = pointerVisual.currentFlipX;
                pointerVisual.targetFlipX = nextFlipX;
                pointerVisual.flipProgress = 0;
            }
        }

        const baseRotation = Math.atan2(dy, Math.abs(dx));
        pointerVisual.targetRotation = pointerVisual.targetFlipX < 0 ? -baseRotation : baseRotation;
    };

    const updatePointerVisualAnimation = (deltaSeconds) => {
        const rotationDiff = normalizeAngle(pointerVisual.targetRotation - pointerVisual.currentRotation);
        const rotationStep = Math.min(1, POINTER_ROTATION_LERP_PER_SECOND * deltaSeconds);
        pointerVisual.currentRotation = normalizeAngle(pointerVisual.currentRotation + rotationDiff * rotationStep);

        if (pointerVisual.flipProgress < 1) {
            pointerVisual.flipProgress = Math.min(1, pointerVisual.flipProgress + deltaSeconds / POINTER_FLIP_DURATION);
            pointerVisual.currentFlipX =
                pointerVisual.flipFromX +
                (pointerVisual.targetFlipX - pointerVisual.flipFromX) * easeInOut(pointerVisual.flipProgress);
            return;
        }

        pointerVisual.currentFlipX +=
            (pointerVisual.targetFlipX - pointerVisual.currentFlipX) * Math.min(1, 18 * deltaSeconds);
    };

    const SPRITE_FOLLOW_K = 1.665; // lerp 강도 (높을수록 더 빠르게 따라옴)

    const updateSpritePos = (dt, time) => {
        if (!spritePos.initialized) return;
        const fs = dt / 16.666;

        if (pointer.held) {
            // 스프링 힘으로 커서 추적 — 튕겨난 속도가 유지되다가 점차 커서 방향으로 복귀
            const k = SPRITE_FOLLOW_K * (pointerVisual.spriteState === 'acc' ? 2 : 1);
            const ddx = pointer.x - spritePos.x;
            const ddy = pointer.y - spritePos.y;

            // 커서 방향으로 전환되는 순간 속도를 0.5배로 줄여 서서히 가속
            const velDotCursor = spritePos.vx * ddx + spritePos.vy * ddy;
            const nowMovingAway = velDotCursor < 0;
            if (spritePos.movingAway && !nowMovingAway) {
                spritePos.vx *= 0.5;
                spritePos.vy *= 0.5;
            }
            spritePos.movingAway = nowMovingAway;

            spritePos.vx += ddx * k * 0.004;
            spritePos.vy += ddy * k * 0.004;
            // 감쇠 (과도한 진동 방지)
            spritePos.vx *= 0.88;
            spritePos.vy *= 0.88;
            spritePos.x += spritePos.vx * fs;
            spritePos.y += spritePos.vy * fs;

        } else {
            // 자율 드리프트 (버블 4.5배 속도)
            spritePos.vx += Math.sin(time * 0.0005 * spritePos.drift + spritePos.phase) * 0.0315;
            spritePos.vy += Math.cos(time * 0.00042 * spritePos.drift + spritePos.phase) * 0.027;
            spritePos.x += spritePos.vx * fs;
            spritePos.y += spritePos.vy * fs;
            spritePos.vx *= 0.986;
            spritePos.vy *= 0.986;
        }

        // 벽 바운스 (홀드/드리프트 공통)
        {
            const r   = POINTER_OCCUPY_RADIUS;
            const spd = Math.hypot(spritePos.vx, spritePos.vy);
            const wallState    = spd >= POINTER_DEFEAT_CURSOR_SPEED ? 'defeat' : 'crash';
            const wallDuration = wallState === 'defeat' ? POINTER_DEFEAT_IMAGE_MS : POINTER_CRASH_IMAGE_MS;
            if (spritePos.x < r) {
                spritePos.x = r;
                spritePos.vx = Math.abs(spritePos.vx) * GHOST_CURSOR_WALL_BOUNCE;
                triggerPointerSpriteState(wallState, wallDuration);
            } else if (spritePos.x > canvasW - r) {
                spritePos.x = canvasW - r;
                spritePos.vx = -Math.abs(spritePos.vx) * GHOST_CURSOR_WALL_BOUNCE;
                triggerPointerSpriteState(wallState, wallDuration);
            }
            if (spritePos.y < r) {
                spritePos.y = r;
                spritePos.vy = Math.abs(spritePos.vy) * GHOST_CURSOR_WALL_BOUNCE;
                triggerPointerSpriteState(wallState, wallDuration);
            } else if (spritePos.y > canvasH - r) {
                spritePos.y = canvasH - r;
                spritePos.vy = -Math.abs(spritePos.vy) * GHOST_CURSOR_WALL_BOUNCE;
                triggerPointerSpriteState(wallState, wallDuration);
            }
        }

        // 잔상 에코 (공통)
        {
            const dx = spritePos.x - lastSpritePosTrailX;
            const dy = spritePos.y - lastSpritePosTrailY;
            if (dx * dx + dy * dy >= POINTER_TRAIL_MOVE_THRESHOLD * POINTER_TRAIL_MOVE_THRESHOLD) {
                createPointerEcho(spritePos.x, spritePos.y);
                lastSpritePosTrailX = spritePos.x;
                lastSpritePosTrailY = spritePos.y;
            }
        }

        setPointerVisualDirection(spritePos.vx, spritePos.vy);
        if (Math.hypot(spritePos.vx, spritePos.vy) > POINTER_VISUAL_MIN_MOVE) {
            pointerVisual.pointerMovedAt = nowMs();
        }
    };

    const drawPointerSprite = () => {
        if (!cursorSprite || !spritePos.initialized) return;
        cursorSprite.style.opacity = '1';
        cursorSprite.style.transform =
            `translate(${spritePos.x - POINTER_SPRITE_OFFSET_X}px, ${spritePos.y - POINTER_SPRITE_OFFSET_Y}px) ` +
            `translate(-50%, -50%) rotate(${pointerVisual.currentRotation}rad) scale(${pointerVisual.currentFlipX}, 1)`;
    };

    // ── 팝 애니메이션: 반지름 빠르게 수축 → 소멸 ────────────────────────────────
    const DIE_DURATION  = 320; // ms
    const RING_DURATION = 460; // ms — 충격파 링 지속 시간

    const createPopEffect = (b) => {
        dyingBubbles.push({
            x: b.x, y: b.y,
            radius:          b.radius,
            phase:           b.phase,
            currentFlipX:    b.currentFlipX    || 1,
            currentRotation: b.currentRotation || 0,
            dieElapsed:  0,
            dieDuration: DIE_DURATION
        });
        popRings.push({
            x: b.x, y: b.y,
            radius:   b.radius,
            elapsed:  0,
            duration: RING_DURATION
        });
    };

    // dying 버블 진행 + 소멸 — "전부 사라짐" 판정도 여기서
    const updateDyingBubbles = (dt) => {
        for (let i = dyingBubbles.length - 1; i >= 0; i--) {
            const d = dyingBubbles[i];
            d.dieElapsed += dt;
            if (d.dieElapsed >= d.dieDuration) dyingBubbles.splice(i, 1);
        }
        // active 버블도 없고 dying 버블도 모두 소멸 완료 → 초기화
        if (bubbles.length === 0 && dyingBubbles.length === 0 && !bubblesExhausted) {
            bubblesExhausted = true;
            fetchAndRespawn();
        }
    };


    // ── Physics (sub/bubble / site.js 완전 동일) ──────────────────────────────
    const updatePhysics = (dt, time) => {
        const fs        = dt / 16.666;
        const poppedSet = new Set();

        // 드리프트 + 포인터 반발
        bubbles.forEach(b => {
            if (b.spawnElapsed < b.spawnDuration) {
                b.spawnElapsed = Math.min(b.spawnDuration, b.spawnElapsed + dt);
            }

            b.vx += Math.sin(time * 0.0005 * b.drift + b.phase) * 0.007;
            b.vy += Math.cos(time * 0.00042 * b.drift + b.phase) * 0.006;

            // spritePos 반발 (항상 활성 — pointer/ghost 구분 없음)
            if (spritePos.initialized) {
                const collision = getBubbleCollisionRadii(b);
                const dx = b.x - spritePos.x;
                const dy = b.y - spritePos.y;
                const reactRx = collision.rx + POINTER_REACTION;
                const reactRy = collision.ry + POINTER_REACTION;
                const scaledDx = dx / reactRx;
                const scaledDy = dy / reactRy;
                const dSq = scaledDx * scaledDx + scaledDy * scaledDy;
                if (dSq < 1) {
                    const dist  = Math.max(Math.sqrt(dSq), 0.0001);
                    const prox  = 1 - dist;
                    const force = 0.42 + prox * prox * 0.72;
                    b.vx += (scaledDx / dist) * force;
                    b.vy += (scaledDy / dist) * force;
                    const spd = Math.hypot(spritePos.vx, spritePos.vy);
                    if (spd >= POINTER_DEFEAT_CURSOR_SPEED) {
                        triggerPointerSpriteState('defeat', POINTER_DEFEAT_IMAGE_MS);
                    } else {
                        triggerPointerSpriteState('crash', POINTER_CRASH_IMAGE_MS);
                    }
                }
            }

            b.x += b.vx * fs;
            b.y += b.vy * fs;
            b.vx *= 0.986;
            b.vy *= 0.986;
            setBubbleVisualDirection(b, b.vx, b.vy);

            if (spritePos.initialized) {
                const collision = getBubbleCollisionRadii(b);
                const dxA = b.x - spritePos.x;
                const dyA = b.y - spritePos.y;
                const keepRx = collision.rx + POINTER_KEEPOUT;
                const keepRy = collision.ry + POINTER_KEEPOUT;
                const scaledDxA = dxA / keepRx;
                const scaledDyA = dyA / keepRy;
                const dA  = Math.max(Math.sqrt(scaledDxA * scaledDxA + scaledDyA * scaledDyA), 0.0001);
                if (dA < 1) {
                    const nx = scaledDxA / dA, ny = scaledDyA / dA;
                    b.x += nx * (1 - dA) * keepRx;
                    b.y += ny * (1 - dA) * keepRy;
                    // spritePos 속도를 버블 법선 방향으로 반사, 0.7배 전달
                    const spriteDotN = spritePos.vx * nx + spritePos.vy * ny;
                    const reflectX = spritePos.vx - 2 * spriteDotN * nx;
                    const reflectY = spritePos.vy - 2 * spriteDotN * ny;
                    const reflectSpd = Math.hypot(reflectX, reflectY);
                    const transfer = Math.max(reflectSpd * 0.7, 1.55);
                    b.vx += nx * transfer; b.vy += ny * transfer;
                    const spd = Math.hypot(spritePos.vx, spritePos.vy);
                    if (spd >= POINTER_DEFEAT_CURSOR_SPEED) {
                        poppedSet.add(b);
                        triggerPointerSpriteState('defeat', POINTER_DEFEAT_IMAGE_MS);
                    } else {
                        triggerPointerSpriteState('crash', POINTER_CRASH_IMAGE_MS);
                    }
                    // 버블 충돌 시 튕겨냄 — 홀드 중: 3배 강도, 비홀드: 0.8배
                    const dot = spritePos.vx * (-nx) + spritePos.vy * (-ny);
                    if (dot < 0) { // 버블 쪽으로 향하고 있을 때만
                        const scale = pointer.held ? 1.5 : 0.8;
                        spritePos.vx = (spritePos.vx - 2 * dot * (-nx)) * scale;
                        spritePos.vy = (spritePos.vy - 2 * dot * (-ny)) * scale;
                    }
                }
            }
        });

        // 버블 간 충돌 — 속도 임계값 초과 시 팝 (sub/bubble 동일)
        for (let i = 0; i < bubbles.length; i++) {
            const a = bubbles[i];
            if (poppedSet.has(a)) continue;
            for (let j = i + 1; j < bubbles.length; j++) {
                const b = bubbles[j];
                if (poppedSet.has(b)) continue;
                let dx = b.x - a.x, dy = b.y - a.y;
                const aCollision = getBubbleCollisionRadii(a);
                const bCollision = getBubbleCollisionRadii(b);
                const rx = aCollision.rx + bCollision.rx + 2;
                const ry = aCollision.ry + bCollision.ry + 2;
                let normDistSq = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
                if (normDistSq >= 1) continue;
                if (normDistSq < 0.0001) {
                    const ang = (i + j + 1) * 0.61803398875;
                    dx = Math.cos(ang); dy = Math.sin(ang); normDistSq = 1;
                }
                const scaledDx = dx / rx;
                const scaledDy = dy / ry;
                const scaledDist = Math.max(Math.sqrt(scaledDx * scaledDx + scaledDy * scaledDy), 0.0001);
                const nx = scaledDx / scaledDist;
                const ny = scaledDy / scaledDist;
                const sep = (1 - scaledDist) * 0.5;
                a.x -= nx * sep * rx;
                a.y -= ny * sep * ry;
                b.x += nx * sep * rx;
                b.y += ny * sep * ry;
                const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
                const nv  = rvx * nx + rvy * ny;
                if (-nv > IMPACT_POP_SPEED) {
                    poppedSet.add(a); poppedSet.add(b); continue;
                }
                if (nv < 0) {
                    const imp = -((1 + 0.84) * nv) / 2;
                    a.vx -= nx * imp; a.vy -= ny * imp;
                    b.vx += nx * imp; b.vy += ny * imp;
                }
            }
        }

        // 벽 바운스 — 속도 임계값 초과 시 팝 (sub/bubble 동일)
        bubbles.forEach(b => {
            if (poppedSet.has(b)) return;
            const collision = getBubbleCollisionRadii(b);
            const minX = collision.rx, maxX = Math.max(minX, canvasW - collision.rx);
            const minY = collision.ry, maxY = Math.max(minY, canvasH - collision.ry);
            if (b.x < minX) {
                const spd = Math.abs(b.vx);
                b.x = minX; b.vx = Math.abs(b.vx) * 0.92;
                if (spd > WALL_POP_SPEED) { poppedSet.add(b); return; }
            } else if (b.x > maxX) {
                const spd = Math.abs(b.vx);
                b.x = maxX; b.vx = -Math.abs(b.vx) * 0.92;
                if (spd > WALL_POP_SPEED) { poppedSet.add(b); return; }
            }
            if (poppedSet.has(b)) return;
            if (b.y < minY) {
                const spd = Math.abs(b.vy);
                b.y = minY; b.vy = Math.abs(b.vy) * 0.92;
                if (spd > WALL_POP_SPEED) { poppedSet.add(b); return; }
            } else if (b.y > maxY) {
                const spd = Math.abs(b.vy);
                b.y = maxY; b.vy = -Math.abs(b.vy) * 0.92;
                if (spd > WALL_POP_SPEED) { poppedSet.add(b); return; }
            }
        });

        // 팝된 버블 → dying으로 이동 ("전부 사라짐" 판정은 updateDyingBubbles에서)
        if (poppedSet.size > 0) {
            for (let i = bubbles.length - 1; i >= 0; i--) {
                if (poppedSet.has(bubbles[i])) {
                    createPopEffect(bubbles[i]);
                    bubbles.splice(i, 1);
                }
            }
        }
    };

    // ── Dying 버블의 현재 유효 반지름 (수축 중) ──────────────────────────────────
    // 빠르게 작아지다가 소멸: scale = (1-t)^2 (t=0→1)
    const getDyingEffR = (d) => {
        const t = clampUnit(d.dieElapsed / d.dieDuration);
        return d.radius * (1 - t) * (1 - t);
    };

    // ── 팝 dying 버블 렌더 — 스케일 업 플래시 + 알파 페이드 ──────────────────────
    const drawDyingBubbles = () => {
        if (!bubbleSprite.complete || !bubbleSprite.naturalWidth || !bubbleSprite.naturalHeight) return;
        dyingBubbles.forEach(d => {
            const t     = clampUnit(d.dieElapsed / d.dieDuration);
            // 0→peak(t=0.25): 1.0→1.4 커졌다가, peak→1: 1.4→0 수축
            const scale = (1 + Math.sin(t * Math.PI) * 0.45) * (1 - t);
            const alpha = Math.pow(1 - t, 0.65);
            if (scale <= 0 || alpha <= 0) return;
            const width  = d.radius * 2 * BUBBLE_SPRITE_ASPECT * BUBBLE_VISUAL_SCALE * scale;
            const height = d.radius * 2 * BUBBLE_VISUAL_SCALE * scale;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(d.x, d.y);
            ctx.rotate(d.currentRotation);
            ctx.scale(d.currentFlipX, 1);
            ctx.drawImage(bubbleSprite, -width / 2, -height / 2, width, height);
            ctx.restore();
        });
    };

    // ── 팝 충격파 링 — 확장 타원 + 페이드 ───────────────────────────────────────
    const updatePopRings = (dt) => {
        for (let i = popRings.length - 1; i >= 0; i--) {
            popRings[i].elapsed += dt;
            if (popRings[i].elapsed >= popRings[i].duration) popRings.splice(i, 1);
        }
    };

    const drawPopRings = () => {
        popRings.forEach(ring => {
            const t       = clampUnit(ring.elapsed / ring.duration);
            const expand  = 1 + t * 1.8;
            const rx      = ring.radius * BUBBLE_SPRITE_ASPECT * BUBBLE_COLLISION_SCALE * expand;
            const ry      = ring.radius * BUBBLE_COLLISION_SCALE * expand;
            const alpha   = Math.pow(1 - t, 1.6);
            const lineW   = Math.max(0.5, (1 - t) * ring.radius * 0.22);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = 'rgba(160, 110, 50, 1)';
            ctx.lineWidth   = lineW;
            ctx.beginPath();
            ctx.ellipse(ring.x, ring.y, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        });
    };

    const getActiveBubbleEffR = b => b.radius * (0.72 + 0.28 * getSpawnEase(b));

    const getLineBubbleSpans = (lineTop) => {
        const spans = [];
        const lineBottom = lineTop + LINE_HEIGHT;
        const lineCenterY = (lineTop + lineBottom) * 0.5;

        const pushSpan = (x, y, r) => {
            const dy = Math.max(0, Math.abs(y - lineCenterY) - LINE_HEIGHT * 0.5);
            if (dy >= r) return;

            const halfW = Math.sqrt(Math.max(0, r * r - dy * dy)) + TEXT_BUBBLE_PADDING;
            spans.push({
                centerX: x,
                halfW
            });
        };

        bubbles.forEach(b => {
            pushSpan(b.x, b.y, getActiveBubbleEffR(b));
        });

        dyingBubbles.forEach(d => {
            const r = getDyingEffR(d);
            if (r >= 0.5) pushSpan(d.x, d.y, r);
        });

        if (spritePos.initialized) {
            pushSpan(spritePos.x, spritePos.y, POINTER_OCCUPY_RADIUS);
        }

        pointerEchoes.forEach(echo => {
            const r = getPointerEchoEffR(echo);
            if (r >= 0.5) pushSpan(echo.x, echo.y, r);
        });

        popRings.forEach(ring => {
            const t      = clampUnit(ring.elapsed / ring.duration);
            const expand = 1 + t * 1.8;
            const alpha  = Math.pow(1 - t, 1.6);
            const r      = ring.radius * BUBBLE_COLLISION_SCALE * expand * alpha;
            if (r >= 0.5) pushSpan(ring.x, ring.y, r);
        });

        return spans;
    };

    const getGlyphs = (text) => {
        const glyphs = [];
        let x = 0;
        for (const part of lineSegmenter.segment(text)) {
            const glyph = part.segment;
            const width = ctx.measureText(glyph).width;
            glyphs.push({
                text: glyph,
                centerX: x + width * 0.5,
                width
            });
            x += width;
        }
        return glyphs;
    };

    const findSplitIndex = (text, targetX, minIndex = 0, maxIndex = text.length) => {
        const glyphs = getGlyphs(text);
        if (glyphs.length <= 1) return maxIndex;

        let closest = clamp(minIndex + 1, minIndex + 1, maxIndex - 1);
        let bestDist = Infinity;
        let prefixWidth = 0;

        glyphs.forEach((glyph, index) => {
            prefixWidth += glyph.width;
            const charIndex = index + 1;
            if (charIndex <= minIndex || charIndex >= maxIndex) return;
            const dist = Math.abs(prefixWidth - targetX);
            if (dist < bestDist) {
                bestDist = dist;
                closest = charIndex;
            }
        });

        const boundaries = [];
        for (const segment of wordSegmenter.segment(text)) {
            const start = segment.index;
            const end = start + segment.segment.length;
            if (start > minIndex && start < maxIndex) boundaries.push(start);
            if (end > minIndex && end < maxIndex) boundaries.push(end);
        }

        if (boundaries.length > 0) {
            boundaries.sort((a, b) => a - b);
            let bestBoundary = closest;
            let bestBoundaryDist = Infinity;
            boundaries.forEach(boundary => {
                const dist = Math.abs(boundary - closest);
                if (dist < bestBoundaryDist) {
                    bestBoundary = boundary;
                    bestBoundaryDist = dist;
                }
            });
            closest = bestBoundary;
        }

        return clamp(closest, minIndex + 1, maxIndex - 1);
    };

    const getLinePushZones = (lineTop, cx, cw) => {
        const spans = getLineBubbleSpans(lineTop);
        if (spans.length === 0) return [];

        const zones = spans
            .map(span => ({
                centerX: span.centerX,
                start: clamp(span.centerX - span.halfW, cx, cx + cw),
                end: clamp(span.centerX + span.halfW, cx, cx + cw)
            }))
            .sort((a, b) => a.start - b.start);

        const merged = [];
        zones.forEach(zone => {
            const last = merged[merged.length - 1];
            if (!last || zone.start > last.end) {
                merged.push({ ...zone });
                return;
            }
            const widthA = last.end - last.start;
            const widthB = zone.end - zone.start;
            const totalWidth = widthA + widthB;
            last.centerX = totalWidth > 0
                ? ((last.centerX * widthA) + (zone.centerX * widthB)) / totalWidth
                : (last.centerX + zone.centerX) * 0.5;
            last.start = Math.min(last.start, zone.start);
            last.end = Math.max(last.end, zone.end);
        });

        return merged;
    };

    const getAvailableSegments = (zones, cx, cw) => {
        const segments = [];
        let start = cx;

        zones.forEach(zone => {
            if (zone.start - start >= MIN_SEG_WIDTH) {
                segments.push({ start, end: zone.start, width: zone.start - start });
            }
            start = Math.max(start, zone.end);
        });

        if (cx + cw - start >= MIN_SEG_WIDTH) {
            segments.push({ start, end: cx + cw, width: cx + cw - start });
        }

        return segments;
    };

    const mergeTightestZonePair = (zones) => {
        if (zones.length <= 1) return zones;

        let bestIndex = 0;
        let bestGap = Infinity;

        for (let i = 0; i < zones.length - 1; i++) {
            const gap = zones[i + 1].start - zones[i].end;
            if (gap < bestGap) {
                bestGap = gap;
                bestIndex = i;
            }
        }

        return zones.reduce((acc, zone, index) => {
            if (index === bestIndex) {
                const next = zones[index + 1];
                const widthA = zone.end - zone.start;
                const widthB = next.end - next.start;
                const totalWidth = widthA + widthB;
                acc.push({
                    start: zone.start,
                    end: next.end,
                    centerX: totalWidth > 0
                        ? ((zone.centerX * widthA) + (next.centerX * widthB)) / totalWidth
                        : (zone.centerX + next.centerX) * 0.5
                });
                return acc;
            }
            if (index === bestIndex + 1) return acc;
            acc.push(zone);
            return acc;
        }, []);
    };

    const getChunkRanges = (text, segments, totalWidth) => {
        if (segments.length <= 1 || text.length <= 1) {
            return [{ start: 0, end: text.length }];
        }

        const ranges = [];
        let startIndex = 0;
        let usedWidth = 0;
        const availableWidth = segments.reduce((sum, segment) => sum + segment.width, 0);
        if (availableWidth <= 0) {
            return [{ start: 0, end: text.length }];
        }

        for (let i = 0; i < segments.length - 1; i++) {
            usedWidth += segments[i].width;
            const targetX = totalWidth * (usedWidth / availableWidth);
            const splitIndex = findSplitIndex(text, targetX, startIndex, text.length);
            ranges.push({ start: startIndex, end: splitIndex });
            startIndex = splitIndex;
            if (startIndex >= text.length - 1) break;
        }

        ranges.push({ start: startIndex, end: text.length });
        return ranges.filter(range => range.end > range.start);
    };

    const drawSingleZoneFallback = (line, lineTop, zone, baseX) => {
        const splitIndex = findSplitIndex(line.text, zone.centerX - baseX);
        const leftText = line.text.slice(0, splitIndex);
        const rightText = line.text.slice(splitIndex);

        if (!leftText || !rightText) {
            drawTextWithSpine(line.text, baseX, lineTop + LINE_ASCENT);
            return;
        }

        const leftWidth = ctx.measureText(leftText).width;
        const leftX = zone.start - leftWidth;
        const rightX = zone.end;

        drawTextWithSpine(leftText,  leftX,  lineTop + LINE_ASCENT);
        drawTextWithSpine(rightText, rightX, lineTop + LINE_ASCENT);
    };

    const cursorGe = (a, b) =>
        a.segmentIndex > b.segmentIndex ||
        (a.segmentIndex === b.segmentIndex && a.graphemeIndex >= b.graphemeIndex);

    const drawShiftedLine = (lineTop, cursorState, cx, cw) => {
        const zones = getLinePushZones(lineTop, cx, cw);
        if (zones.length === 0) {
            const line = layoutNextLine(prepared, cursorState, cw);
            if (!line) return null;
            drawTextWithSpine(line.text, cx, lineTop + LINE_ASCENT);
            return line.end;
        }

        const segments = getAvailableSegments(zones, cx, cw);
        if (segments.length === 0) return cursorState;

        // 전체 컬럼 폭 기준으로 이 행의 자연스러운 끝 위치를 미리 구함
        // (hard break가 있으면 거기서 끝남) — 세그먼트 루프가 다음 단락으로 넘어가는 것을 막기 위해 사용
        const probeLine = layoutNextLine(prepared, cursorState, cw);
        if (!probeLine) return null;

        let nextCursor = cursorState;
        let drewAny = false;

        for (const segment of segments) {
            const line = layoutNextLine(prepared, nextCursor, segment.width);
            if (!line) break;
            if (
                line.start.segmentIndex === line.end.segmentIndex &&
                line.start.graphemeIndex === line.end.graphemeIndex
            ) {
                break;
            }

            drawTextWithSpine(line.text, segment.start, lineTop + LINE_ASCENT);
            nextCursor = line.end;
            drewAny = true;

            // hard break(개행)에 도달했으면 이 행에서 더 이상 진행하지 않음
            if (cursorGe(nextCursor, probeLine.end)) break;
        }

        return drewAny ? nextCursor : cursorState;
    };

    // ── Turn.js 페이지 넘김 애니메이션 ──────────────────────────────────────────
    // oldDataURL: 현재(이전) 캔버스 스냅샷, newDataURL: 다음 페이지 캔버스 스냅샷
    const triggerLandscapePageTurnAnimation = (oldDataURL, newDataURL) => {
        const $ = window.jQuery;
        if (!$ || !$.fn || !$.fn.turn) return;

        const overlay = document.getElementById('pageTurnOverlay');
        if (!overlay) return;

        const w  = canvasW, h = canvasH;
        const hw = Math.floor(w / 2);

        // 기존 Turn 인스턴스 정리 후 book 엘리먼트 자체를 교체
        // (turn.js가 destroy 후에도 jQuery data/이벤트를 잔류시켜 재초기화 실패하는 것 방지)
        const oldBook = document.getElementById('turnBook');
        if (oldBook) {
            try { $(oldBook).turn('destroy'); } catch (_) {}
        }
        const book = document.createElement('div');
        book.id = 'turnBook';
        overlay.innerHTML = '';
        overlay.appendChild(book);

        // 5페이지: page1=더미(cover 회피용), page2/3=현재 좌/우, page4/5=다음 좌/우
        // turn.js double 모드에서 page=2 시작 → view=[2,3] → next → view=[4,5]
        // 애니메이션 종료 후 캔버스 좌측=new left, 우측=new right와 슬롯이 정확히 대응됨
        const oldBg = `url('${oldDataURL}') no-repeat`;
        const newBg = `url('${newDataURL}') no-repeat`;
        const pages = [
            `background: rgb(248,245,238);`,                                                           // page1: 더미
            `background: ${oldBg}; background-size: ${w}px ${h}px; background-position: 0 0;`,        // page2: 현재 좌
            `background: ${oldBg}; background-size: ${w}px ${h}px; background-position: -${hw}px 0;`, // page3: 현재 우
            `background: ${newBg}; background-size: ${w}px ${h}px; background-position: 0 0;`,        // page4: 다음 좌
            `background: ${newBg}; background-size: ${w}px ${h}px; background-position: -${hw}px 0;`, // page5: 다음 우
        ];
        pages.forEach(style => {
            const p = document.createElement('div');
            p.className = 'page';
            p.style.cssText = style;
            book.appendChild(p);
        });

        book.style.width  = w + 'px';
        book.style.height = h + 'px';
        pageTurnActive = true;
        overlay.style.display = 'block';

        $(book).turn({
            width:        w,
            height:       h,
            duration:     700,
            page:         2,
            display:      'double',
            acceleration: true,
            gradients:    true,
        });

        // 짧은 딜레이 후 우측 페이지 넘기기
        setTimeout(() => {
            try { $(book).turn('next'); } catch (_) {}
        }, 40);

        // page=2 시작 → next → page=4, turned 이벤트는 page=4로 발생
        const dismiss = () => {
            try { $(book).turn('destroy'); } catch (_) {}
            overlay.style.display = 'none';
            pageTurnActive = false;
        };
        const fallbackTimer = setTimeout(dismiss, 1100);
        $(book).on('turned', function (e, page) {
            if (page >= 4) {
                clearTimeout(fallbackTimer);
                setTimeout(dismiss, 80);
            }
        });
    };

    const triggerPageTurnAnimation = (oldDataURL, newDataURL) => {
        triggerLandscapePageTurnAnimation(oldDataURL, newDataURL);
    };

    // ── Text layout + draw ────────────────────────────────────────────────────
    // 항상 좌/우 두 컬럼으로 렌더링한다.
    const drawText = () => {
        if (!prepared || !articleLoaded) return;

        const textAreaBottom = canvasH - FOOTER_H;

        ctx.font         = BODY_FONT;
        ctx.fillStyle    = TEXT_COLOR;
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign    = 'left';

        // 책등 그림자 + 구분선
        ctx.save();
        const shadowL = ctx.createLinearGradient(dividerX - SPINE_SHADOW_W, 0, dividerX, 0);
        shadowL.addColorStop(0,   'rgba(60,40,10,0)');
        shadowL.addColorStop(0.6, 'rgba(60,40,10,0.04)');
        shadowL.addColorStop(1,   'rgba(30,15,0,0.18)');
        ctx.fillStyle = shadowL;
        ctx.fillRect(dividerX - SPINE_SHADOW_W, 0, SPINE_SHADOW_W, canvasH);
        const shadowR = ctx.createLinearGradient(dividerX, 0, dividerX + SPINE_SHADOW_W, 0);
        shadowR.addColorStop(0,   'rgba(30,15,0,0.18)');
        shadowR.addColorStop(0.4, 'rgba(60,40,10,0.04)');
        shadowR.addColorStop(1,   'rgba(60,40,10,0)');
        ctx.fillStyle = shadowR;
        ctx.fillRect(dividerX, 0, SPINE_SHADOW_W, canvasH);
        ctx.globalAlpha = 0.28;
        ctx.strokeStyle = '#5a4a2a';
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(dividerX, 0);
        ctx.lineTo(dividerX, canvasH);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = TEXT_COLOR;

        const columns = [
            { cx: leftColX,  cw: leftColW,  y: PAGE_MARGIN, h: textAreaBottom - PAGE_MARGIN },
            { cx: rightColX, cw: rightColW, y: PAGE_MARGIN, h: textAreaBottom - PAGE_MARGIN }
        ];

        let cursor  = { segmentIndex: 0, graphemeIndex: 0 };
        let wrapped = false;

        for (const col of columns) {
            let lineTop = col.y;
            const colBottom = col.y + col.h;
            while (lineTop + LINE_HEIGHT <= colBottom) {
                let nextCursor = drawShiftedLine(lineTop, cursor, col.cx, col.cw);
                if (
                    !nextCursor ||
                    (
                        nextCursor.segmentIndex === cursor.segmentIndex &&
                        nextCursor.graphemeIndex === cursor.graphemeIndex
                    )
                ) {
                    if (wrapped) break;
                    wrapped = true;
                    cursor = { segmentIndex: 0, graphemeIndex: 0 };
                    nextCursor = drawShiftedLine(lineTop, cursor, col.cx, col.cw);
                    if (
                        !nextCursor ||
                        (
                            nextCursor.segmentIndex === cursor.segmentIndex &&
                            nextCursor.graphemeIndex === cursor.graphemeIndex
                        )
                    ) break;
                }
                cursor  = nextCursor;
                lineTop += LINE_HEIGHT;
            }
        }

        // ── footer 텍스트 ─────────────────────────────────────────────────────
        const footerY    = textAreaBottom + 20;
        const leftPageN  = (pageSpread - 1) * 2 + 1;
        const rightPageN = leftPageN + 1;

        ctx.font         = FOOTER_FONT;
        ctx.fillStyle    = 'rgba(80,60,30,0.55)';
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign    = 'left';

        ctx.textAlign = 'left';
        ctx.fillText(String(leftPageN), leftColX, footerY);

        const maxTitleW = Math.max(0, leftColW - ctx.measureText(String(leftPageN)).width - 8);
        let titleText = articleTitle || '';
        if (titleText && ctx.measureText(titleText).width > maxTitleW) {
            while (titleText.length > 1 && ctx.measureText(titleText + '…').width > maxTitleW) {
                titleText = titleText.slice(0, -1);
            }
            titleText += '…';
        }
        const titleX = leftColX + ctx.measureText(String(leftPageN)).width + 8;
        drawTextWithSpine(titleText, titleX, footerY);

        ctx.textAlign = 'right';
        ctx.fillText(String(rightPageN), rightColX + rightColW, footerY);
    };

    // ── 클릭으로 버블 팝 ──────────────────────────────────────────────────────

    // ── 메인 루프 ─────────────────────────────────────────────────────────────
    const frame = (time) => {
        rafId = requestAnimationFrame(frame);
        if (document.hidden) { lastFrameTime = time; return; }

        const dt = lastFrameTime > 0 ? clamp(time - lastFrameTime, 8, 40) : 16.67;
        lastFrameTime = time;

        ctx.fillStyle = BG_CSS;
        ctx.fillRect(0, 0, canvasW, canvasH);

        if (!pageTurnActive) {
            updateSpritePos(dt, time);
            updatePhysics(dt, time);
            updatePointerEchoes(dt);
            updateDyingBubbles(dt);
            updatePopRings(dt);
            updatePointerVisualAnimation(dt / 1000);
            bubbles.forEach(b => updateBubbleVisualAnimation(b, dt / 1000));
            updatePointerSpriteState();
        }
        drawText();
        drawPopRings();
        drawDyingBubbles();
        bubbles.forEach(drawBubbleSprite);
        drawPointerSprite();
    };

    // ── 기사 fetch + 버블 재생성 ──────────────────────────────────────────────
    const fetchAndRespawn = async () => {
        let nextPrepared = null;
        let nextTitle    = '';
        try {
            const res  = await fetch('/api/nyt-article/');
            const data = await res.json();
            const text = (data.text || '').trim() || 'No content available.';
            nextTitle    = (data.title || '').trim();
            nextPrepared = prepareWithSegments(text, BODY_FONT, { whiteSpace: 'pre-wrap' });
        } catch (_) {
            nextPrepared = prepareWithSegments('Could not connect to the article feed.', BODY_FONT);
        }
        // 초기 로드가 아니면 Turn.js 페이지 넘김 애니메이션
        if (articleLoaded) {
            // 1. 현재(이전) 캔버스 스냅샷
            const oldDataURL = canvas.toDataURL();

            // 2. 새 내용 반영 + 버블 초기화
            pageSpread   += 1;
            prepared      = nextPrepared;
            articleTitle  = nextTitle;
            initBubbles();

            // 3. 새 내용을 캔버스에 미리 렌더링해 스냅샷 확보
            //    버블을 완전 스폰 상태로 임시 설정해 스냅샷에 보이게 함
            bubbles.forEach(b => { b.spawnElapsed = b.spawnDuration; });
            ctx.fillStyle = BG_CSS;
            ctx.fillRect(0, 0, canvasW, canvasH);
            drawText();
            bubbles.forEach(b => drawBubbleSprite(b));
            const newDataURL = canvas.toDataURL();

            // 4. 두 스냅샷으로 애니메이션 실행
            triggerPageTurnAnimation(oldDataURL, newDataURL);
        } else {
            prepared      = nextPrepared;
            articleTitle  = nextTitle;
            articleLoaded = true;
            initBubbles();
        }
        bubblesExhausted = false;
    };

    // ── Init ──────────────────────────────────────────────────────────────────
    resizeCanvas();
    initBubbles();
    fetchAndRespawn();

    window.addEventListener('pointermove', e => {
        const prevX = pointer.x;
        const prevY = pointer.y;
        pointer.x = e.clientX;
        pointer.y = e.clientY;
        pointer.vx = pointer.x - prevX;
        pointer.vy = pointer.y - prevY;
        pointer.active = true;
        if (!spritePos.initialized) {
            spritePos.x     = pointer.x;
            spritePos.y     = pointer.y;
            spritePos.drift = rnd(0.7, 1.4);
            spritePos.phase = Math.random() * Math.PI * 2;
            const ang = Math.random() * Math.PI * 2;
            spritePos.vx = Math.cos(ang) * 4.5;
            spritePos.vy = Math.sin(ang) * 4.5;
            spritePos.initialized   = true;
            lastSpritePosTrailX = spritePos.x;
            lastSpritePosTrailY = spritePos.y;
        }

    }, { passive: true });
    window.addEventListener('pointerleave', () => {
        pointer.active = false;
        pointer.held   = false;
    });
    window.addEventListener('blur', () => {
        pointer.active = false;
        pointer.held   = false;
    });
    window.addEventListener('pointercancel', () => {
        pointer.active = false;
        pointer.held   = false;
    });
    window.addEventListener('pointerup', e => {
        if (!e.isPrimary || e.button !== 0) return;
        pointer.held = false;
    });
    window.addEventListener('resize',            resizeCanvas, { passive: true });
    window.addEventListener('orientationchange', resizeCanvas, { passive: true });

    window.addEventListener('pointerdown', e => {
        if (!e.isPrimary || e.button !== 0) return;
        pointer.held = true;
        triggerPointerSpriteState('acc', POINTER_ACC_IMAGE_MS);
    }, { passive: true });

    rafId = requestAnimationFrame(frame);
}());
