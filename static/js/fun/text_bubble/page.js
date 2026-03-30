/**
 * text-bubble page
 * pretext(chenglou/pretext)로 텍스트를 한 줄씩 레이아웃하고,
 * 버블이 떠있는 y-band의 칸을 줄여 텍스트가 버블 주위를 흘러가게 만든다.
 * 버블 물리 로직은 fun/bubble(site.js initInteractiveBubbleBackground)과 동일.
 */
import { prepareWithSegments, layoutNextLine } from 'https://esm.sh/@chenglou/pretext';

(function () {
    'use strict';

    const canvas = document.getElementById('textBubbleCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // ── Config ────────────────────────────────────────────────────────────────
    const FONT_SIZE       = 17;
    const BODY_FONT       = FONT_SIZE + 'px Georgia, "Times New Roman", serif';
    const LINE_HEIGHT     = 29;
    const LINE_ASCENT     = 20;   // px from line top to text baseline
    const COL_MAX_WIDTH   = 680;
    const COL_H_MARGIN    = 64;   // min horizontal padding each side
    const TOP_PADDING     = 56;   // height of the HTML header overlay
    const MIN_LINE_WIDTH  = 60;   // don't render lines narrower than this
    const BUBBLE_COUNT    = 5;
    const BG_COLOR        = { r: 248, g: 245, b: 238 }; // cream

    // ── State ─────────────────────────────────────────────────────────────────
    let canvasW = 0, canvasH = 0, dpr = 1;
    let colX = 0, colW = 0;
    let rafId = null, lastFrameTime = 0;
    let prepared = null;
    let articleLoaded    = false;
    let bubblesExhausted = false;

    const bubbles    = [];
    const popEffects = [];
    const pointer    = { x: 0, y: 0, active: false };

    // ── Color utilities (same pattern as site.js bubble code) ─────────────────
    const clampUnit = v => Math.min(1, Math.max(0, v));
    const clampByte = v => Math.min(255, Math.max(0, Math.round(v)));
    const clamp     = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const rnd       = (min, max) => Math.random() * (max - min) + min;

    const rgbaFrom = (c, a) =>
        'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';

    const mixRgb = (a, b, t) => ({
        r: clampByte(a.r + (b.r - a.r) * clampUnit(t)),
        g: clampByte(a.g + (b.g - a.g) * clampUnit(t)),
        b: clampByte(a.b + (b.b - a.b) * clampUnit(t))
    });

    const invertRgb = c => ({ r: 255 - c.r, g: 255 - c.g, b: 255 - c.b });

    const buildPalette = (bg) => {
        const inv   = invertRgb(bg);
        const white = { r: 255, g: 255, b: 255 };
        const black = { r: 0,   g: 0,   b: 0   };
        return {
            bodyCore:    mixRgb(inv, white, 0.12),
            bodyMid:     mixRgb(inv, white, 0.02),
            bodyEdge:    mixRgb(inv, black, 0.20),
            innerShadow: mixRgb(inv, black, 0.44),
            highlight:   mixRgb(inv, white, 0.45),
            stroke:      mixRgb(inv, white, 0.20),
            popRing:     mixRgb(inv, white, 0.26),
            popFlash:    mixRgb(inv, white, 0.48),
            popParticle: mixRgb(inv, black, 0.08)
        };
    };

    let palette = buildPalette(BG_COLOR);

    // ── Canvas / column geometry ──────────────────────────────────────────────
    const resizeCanvas = () => {
        dpr     = Math.min(window.devicePixelRatio || 1, 2);
        canvasW = window.innerWidth;
        canvasH = window.innerHeight;
        canvas.width  = Math.floor(canvasW * dpr);
        canvas.height = Math.floor(canvasH * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        colW = Math.min(COL_MAX_WIDTH, Math.max(200, canvasW - COL_H_MARGIN * 2));
        colX = Math.floor((canvasW - colW) / 2);

        bubbles.forEach(b => {
            b.x = clamp(b.x, b.radius, canvasW - b.radius);
            b.y = clamp(b.y, b.radius, canvasH - b.radius);
        });
    };

    // ── Bubble creation ───────────────────────────────────────────────────────
    const getBubbleRadius = () => {
        const base = Math.min(canvasW || window.innerWidth, canvasH || window.innerHeight);
        const mn   = Math.max(55, base * 0.075);
        const mx   = Math.max(mn + 24, base * 0.13);
        return rnd(mn, mx);
    };

    const createBubble = () => ({
        x:             rnd(80, (canvasW || window.innerWidth)  - 80),
        y:             rnd(TOP_PADDING + 60, (canvasH || window.innerHeight) - 60),
        radius:        getBubbleRadius(),
        vx:            rnd(-0.14, 0.14),
        vy:            rnd(-0.10, 0.10),
        alpha:         rnd(0.46, 0.74),
        phase:         rnd(0, Math.PI * 2),
        drift:         rnd(0.85, 1.15),
        spawnElapsed:  0,
        spawnDuration: rnd(300, 500)
    });

    const initBubbles = () => {
        bubbles.length = 0;
        for (let i = 0; i < BUBBLE_COUNT; i++) bubbles.push(createBubble());
    };

    // ── Physics constants (same as site.js bubble) ────────────────────────────
    const WALL_POP_SPEED  = 10.65;
    const IMPACT_POP_SPEED = 9.65;
    const POINTER_REACTION = 200;
    const POINTER_KEEPOUT  = 40;

    // ── Spawn ease helper ─────────────────────────────────────────────────────
    const getSpawnEase = (b) => {
        const p = b.spawnDuration > 0 ? clampUnit(b.spawnElapsed / b.spawnDuration) : 1;
        return 1 - Math.pow(1 - p, 3);
    };

    // ── Draw a single bubble ──────────────────────────────────────────────────
    const drawBubble = (b, time) => {
        const ease  = getSpawnEase(b);
        const scale = 0.72 + 0.28 * ease;
        const eAlph = 0.12 + 0.88 * ease;
        const pulse = 1 + Math.sin(time * 0.0012 + b.phase) * 0.03;
        const r     = b.radius * pulse * scale;
        const alpha = b.alpha * eAlph;

        // Body gradient
        const bodyGrad = ctx.createRadialGradient(
            b.x - r * 0.28, b.y - r * 0.32, r * 0.14,
            b.x, b.y, r
        );
        bodyGrad.addColorStop(0,    rgbaFrom(palette.bodyCore, 0));
        bodyGrad.addColorStop(0.45, rgbaFrom(palette.bodyCore, 0.032 * alpha));
        bodyGrad.addColorStop(0.80, rgbaFrom(palette.bodyMid,  0.082 * alpha));
        bodyGrad.addColorStop(1,    rgbaFrom(palette.bodyEdge, 0.14  * alpha));
        ctx.beginPath();
        ctx.fillStyle = bodyGrad;
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.fill();

        // Inner shadow (clipped to circle)
        ctx.save();
        ctx.beginPath();
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.clip();
        const shadow = ctx.createRadialGradient(
            b.x + r * 0.34, b.y + r * 0.38, r * 0.06,
            b.x, b.y, r * 0.92
        );
        shadow.addColorStop(0,    rgbaFrom(palette.innerShadow, 0));
        shadow.addColorStop(0.72, rgbaFrom(palette.innerShadow, 0.11 * alpha));
        shadow.addColorStop(1,    rgbaFrom(palette.innerShadow, 0.24 * alpha));
        ctx.fillStyle = shadow;
        ctx.fillRect(b.x - r, b.y - r, r * 2, r * 2);
        ctx.restore();

        // Highlight
        const hl = ctx.createRadialGradient(
            b.x - r * 0.22, b.y - r * 0.24, r * 0.05,
            b.x - r * 0.08, b.y - r * 0.10, r * 0.82
        );
        hl.addColorStop(0,    rgbaFrom(palette.highlight, 0));
        hl.addColorStop(0.42, rgbaFrom(palette.highlight, 0.035 * alpha));
        hl.addColorStop(1,    rgbaFrom(palette.highlight, 0));
        ctx.beginPath();
        ctx.fillStyle = hl;
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.fill();

        // Stroke ring
        ctx.beginPath();
        ctx.strokeStyle = rgbaFrom(palette.stroke, 0.18 * alpha);
        ctx.lineWidth   = 1.2;
        ctx.arc(b.x, b.y, r * 0.98, 0, Math.PI * 2);
        ctx.stroke();
    };

    // ── Pop effects ───────────────────────────────────────────────────────────
    const createPopEffect = (b) => {
        const particles = [];
        for (let i = 0; i < 12; i++) {
            const angle = rnd(0, Math.PI * 2);
            const speed = rnd(0.5, 1.8) + b.radius * 0.02;
            particles.push({
                x: b.x, y: b.y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size:  rnd(Math.max(1.6, b.radius * 0.08), Math.max(2.8, b.radius * 0.16)),
                alpha: rnd(0.55, 0.95) * b.alpha,
                life:  rnd(180, 320),
                age:   0
            });
        }
        popEffects.push({
            x: b.x, y: b.y, age: 0, duration: 320,
            innerRadius: Math.max(4, b.radius * 0.35),
            outerRadius: b.radius * 1.9,
            alpha:       Math.min(1, b.alpha + 0.2),
            particles
        });
    };

    const updatePopEffects = (dt) => {
        const fs = dt / 16.666;
        for (let i = popEffects.length - 1; i >= 0; i--) {
            const e = popEffects[i];
            e.age += dt;
            for (let j = e.particles.length - 1; j >= 0; j--) {
                const p = e.particles[j];
                p.age += dt;
                if (p.age >= p.life) { e.particles.splice(j, 1); continue; }
                p.x += p.vx * fs;
                p.y += p.vy * fs;
                p.vx *= 0.965;
                p.vy *= 0.965;
            }
            if (e.age >= e.duration && e.particles.length === 0) popEffects.splice(i, 1);
        }
    };

    const drawPopEffects = () => {
        popEffects.forEach(e => {
            const progress = Math.min(e.age / e.duration, 1);
            const exp      = 1 - Math.pow(1 - progress, 3);
            const ringR    = e.innerRadius + (e.outerRadius - e.innerRadius) * exp;
            const ringA    = (1 - progress) * 0.46 * e.alpha;
            if (ringA > 0.01) {
                ctx.beginPath();
                ctx.strokeStyle = rgbaFrom(palette.popRing, ringA);
                ctx.lineWidth   = Math.max(1.1, (1 - progress) * e.innerRadius * 0.5);
                ctx.arc(e.x, e.y, ringR, 0, Math.PI * 2);
                ctx.stroke();
            }
            const flashA = (1 - progress) * (1 - progress) * 0.4 * e.alpha;
            if (flashA > 0.01) {
                ctx.beginPath();
                ctx.fillStyle = rgbaFrom(palette.popFlash, flashA);
                ctx.arc(e.x, e.y, e.innerRadius * 0.5, 0, Math.PI * 2);
                ctx.fill();
            }
            e.particles.forEach(p => {
                const pp = p.age / p.life;
                const pa = (1 - pp) * (1 - pp) * 0.75 * p.alpha;
                if (pa <= 0.01) return;
                ctx.beginPath();
                ctx.fillStyle = rgbaFrom(palette.popParticle, pa);
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
            });
        });
    };

    // ── Physics update (same logic as site.js) ────────────────────────────────
    const updatePhysics = (dt, time) => {
        const fs        = dt / 16.666;
        const poppedSet = new Set();

        // Drift + pointer repulsion
        bubbles.forEach(b => {
            if (b.spawnElapsed < b.spawnDuration) {
                b.spawnElapsed = Math.min(b.spawnDuration, b.spawnElapsed + dt);
            }

            b.vx += Math.sin(time * 0.0005 * b.drift + b.phase) * 0.007;
            b.vy += Math.cos(time * 0.00042 * b.drift + b.phase) * 0.006;

            if (pointer.active) {
                const dx = b.x - pointer.x;
                const dy = b.y - pointer.y;
                const distSq  = dx * dx + dy * dy;
                const reactR  = b.radius + POINTER_REACTION;
                if (distSq < reactR * reactR) {
                    const dist  = Math.max(Math.sqrt(distSq), 0.0001);
                    const prox  = 1 - dist / reactR;
                    const force = 0.42 + prox * prox * 0.72;
                    b.vx += (dx / dist) * force;
                    b.vy += (dy / dist) * force;
                }
            }

            b.x += b.vx * fs;
            b.y += b.vy * fs;
            b.vx *= 0.986;
            b.vy *= 0.986;

            if (pointer.active) {
                const dxA   = b.x - pointer.x;
                const dyA   = b.y - pointer.y;
                const distA = Math.max(Math.sqrt(dxA * dxA + dyA * dyA), 0.0001);
                const ko    = b.radius + POINTER_KEEPOUT;
                if (distA < ko) {
                    const nx = dxA / distA, ny = dyA / distA;
                    const push = ko - distA;
                    b.x += nx * push;  b.y += ny * push;
                    b.vx += nx * 1.55; b.vy += ny * 1.55;
                }
            }
        });

        // Bubble–bubble collision
        for (let i = 0; i < bubbles.length; i++) {
            const a = bubbles[i];
            if (poppedSet.has(a)) continue;
            for (let j = i + 1; j < bubbles.length; j++) {
                const b = bubbles[j];
                if (poppedSet.has(b)) continue;
                let dx = b.x - a.x, dy = b.y - a.y;
                let distSq = dx * dx + dy * dy;
                const minD = a.radius + b.radius + 2;
                if (distSq >= minD * minD) continue;
                if (distSq < 0.0001) {
                    const ang = (i + j + 1) * 0.61803398875;
                    dx = Math.cos(ang); dy = Math.sin(ang); distSq = 1;
                }
                const dist = Math.sqrt(distSq);
                const nx = dx / dist, ny = dy / dist;
                const sep = (minD - dist) * 0.5;
                a.x -= nx * sep; a.y -= ny * sep;
                b.x += nx * sep; b.y += ny * sep;
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

        // Wall bounce
        bubbles.forEach(b => {
            if (poppedSet.has(b)) return;
            const minX = b.radius, maxX = Math.max(minX, canvasW - b.radius);
            const minY = b.radius, maxY = Math.max(minY, canvasH - b.radius);
            if (b.x < minX) {
                const spd = Math.abs(b.vx);
                b.x = minX; b.vx = Math.abs(b.vx) * 0.92;
                if (spd > WALL_POP_SPEED) { poppedSet.add(b); return; }
            } else if (b.x > maxX) {
                const spd = Math.abs(b.vx);
                b.x = maxX; b.vx = -Math.abs(b.vx) * 0.92;
                if (spd > WALL_POP_SPEED) { poppedSet.add(b); return; }
            }
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

        // Remove popped bubbles — no immediate respawn; wait until all are gone
        if (poppedSet.size > 0) {
            for (let i = bubbles.length - 1; i >= 0; i--) {
                if (poppedSet.has(bubbles[i])) {
                    createPopEffect(bubbles[i]);
                    bubbles.splice(i, 1);
                }
            }
            if (bubbles.length === 0 && !bubblesExhausted) {
                bubblesExhausted = true;
                fetchAndRespawn();
            }
        }
    };

    // ── Free interval calculation for a text line ─────────────────────────────
    // Returns { x, w } of the widest bubble-free horizontal stretch within [colX, colX+colW]
    const getLineRange = (lineY) => {
        const mid = lineY + LINE_HEIGHT / 2;

        // Start with the full column as one free interval [colX, colX+colW]
        let free = [[colX, colX + colW]];

        bubbles.forEach(b => {
            const dy        = mid - b.y;
            const ease      = getSpawnEase(b);
            const effectiveR = b.radius * (0.72 + 0.28 * ease);
            if (Math.abs(dy) >= effectiveR) return;

            const chordHalf = Math.sqrt(Math.max(0, effectiveR * effectiveR - dy * dy));
            const bLeft  = b.x - chordHalf;
            const bRight = b.x + chordHalf;

            // Subtract the blocked x-range from every free interval
            const next = [];
            free.forEach(([lo, hi]) => {
                if (bRight <= lo || bLeft >= hi) {
                    next.push([lo, hi]);
                } else {
                    if (lo < bLeft)  next.push([lo, bLeft]);
                    if (hi > bRight) next.push([bRight, hi]);
                }
            });
            free = next;
        });

        // Pick the widest remaining interval
        let bestX = colX, bestW = 0;
        free.forEach(([lo, hi]) => {
            const w = hi - lo;
            if (w > bestW) { bestW = w; bestX = lo; }
        });

        return { x: bestX, w: bestW };
    };

    // ── Text layout + draw with pretext ───────────────────────────────────────
    const drawText = () => {
        if (!prepared || !articleLoaded) return;

        ctx.font         = BODY_FONT;
        ctx.fillStyle    = '#1a1a1a';
        ctx.textBaseline = 'alphabetic';

        let cursor = { segmentIndex: 0, graphemeIndex: 0 };
        let y      = TOP_PADDING + 18;   // first text line below header

        while (y < canvasH + LINE_HEIGHT) {
            const { x: lineX, w: lineW } = getLineRange(y);

            if (lineW >= MIN_LINE_WIDTH) {
                const line = layoutNextLine(prepared, cursor, lineW);
                if (!line) break;
                ctx.fillText(line.text, lineX, y + LINE_ASCENT);
                cursor = line.end;
            }
            // If lineW < MIN_LINE_WIDTH the bubble covers the full column here —
            // leave a blank line gap and keep cursor position (text resumes next y).

            y += LINE_HEIGHT;
        }
    };

    // ── Click / tap to pop ────────────────────────────────────────────────────
    const removeBubbleAtPoint = (px, py) => {
        for (let i = bubbles.length - 1; i >= 0; i--) {
            const b  = bubbles[i];
            const dx = px - b.x, dy = py - b.y;
            const ease = getSpawnEase(b);
            const hitR = b.radius * (0.72 + 0.28 * ease) * 1.05;
            if (dx * dx + dy * dy <= hitR * hitR) {
                createPopEffect(b);
                bubbles.splice(i, 1);
                if (bubbles.length === 0 && !bubblesExhausted) {
                    bubblesExhausted = true;
                    fetchAndRespawn();
                }
                return true;
            }
        }
        return false;
    };

    // ── Main animation loop ───────────────────────────────────────────────────
    const frame = (time) => {
        rafId = requestAnimationFrame(frame);
        if (document.hidden) { lastFrameTime = time; return; }

        const dt = lastFrameTime > 0 ? clamp(time - lastFrameTime, 8, 40) : 16.67;
        lastFrameTime = time;

        // Background fill
        ctx.fillStyle = 'rgb(' + BG_COLOR.r + ',' + BG_COLOR.g + ',' + BG_COLOR.b + ')';
        ctx.fillRect(0, 0, canvasW, canvasH);

        // Update physics
        updatePhysics(dt, time);

        // Draw text with bubble-shaped gaps
        drawText();

        // Draw bubbles on top
        bubbles.forEach(b => drawBubble(b, time));

        // Pop effects
        updatePopEffects(dt);
        drawPopEffects();
    };

    // ── Article fetch ─────────────────────────────────────────────────────────
    const loadingEl  = document.getElementById('tbLoading');
    const refreshBtn = document.getElementById('tbRefresh');

    const setLoading = (on) => {
        if (loadingEl) loadingEl.style.opacity = on ? '1' : '0';
    };

    // 기사 로드 후 버블 전체 재생성 — 모든 버블이 터지면 자동 호출
    const fetchAndRespawn = async () => {
        prepared      = null;
        articleLoaded = false;
        setLoading(true);
        try {
            const res  = await fetch('/api/nyt-article/');
            const data = await res.json();
            const text = (data.text || '').trim() || 'No content available.';
            prepared      = prepareWithSegments(text, BODY_FONT, { whiteSpace: 'pre-wrap' });
            articleLoaded = true;
        } catch (_) {
            const fallback = 'Could not connect to the article feed.\nPlease try refreshing.';
            prepared      = prepareWithSegments(fallback, BODY_FONT, { whiteSpace: 'pre-wrap' });
            articleLoaded = true;
        }
        setLoading(false);
        // 버블 재생성 후 exhausted 해제
        initBubbles();
        bubblesExhausted = false;
    };

    // ── Init ──────────────────────────────────────────────────────────────────
    resizeCanvas();
    initBubbles();
    fetchAndRespawn();

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            // 수동 새로고침: 현재 버블 모두 팝 → fetchAndRespawn 트리거
            if (bubblesExhausted) return;
            bubbles.forEach(b => createPopEffect(b));
            bubbles.length   = 0;
            bubblesExhausted = true;
            fetchAndRespawn();
        });
    }

    window.addEventListener('pointermove', e => {
        pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true;
    }, { passive: true });

    window.addEventListener('pointerleave', () => { pointer.active = false; });
    window.addEventListener('blur',         () => { pointer.active = false; });

    window.addEventListener('resize',            resizeCanvas, { passive: true });
    window.addEventListener('orientationchange', resizeCanvas, { passive: true });

    window.addEventListener('pointerdown', e => {
        if (!e.isPrimary || e.button !== 0) return;
        const rect = canvas.getBoundingClientRect();
        const lx   = e.clientX - rect.left;
        const ly   = e.clientY - rect.top;
        if (lx < 0 || ly < 0 || lx > rect.width || ly > rect.height) return;
        removeBubbleAtPoint(lx, ly);
    }, { passive: true });

    rafId = requestAnimationFrame(frame);
}());
