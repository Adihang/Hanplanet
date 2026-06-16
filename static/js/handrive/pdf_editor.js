(function () {
    "use strict";

    var surface = null;
    var pageArea = null;
    var pageList = null;
    var statusEl = null;
    var lineWidthInput = null;
    var lineWidthDisplay = null;
    var fontFamilySelect = null;
    var fontSizeInput = null;
    var fontColorInput = null;
    var textMeasureCanvas = null;
    var TEXT_BOX_LINE_HEIGHT = 1.22;
    var TEXT_BOX_VERTICAL_CHROME = 8;
    var TEXT_BOX_DEFAULT_HEIGHT_RATIO = 1.5;
    var TEXT_BOX_MIN_PIXEL_HEIGHT = 24;

    var state = {
        entry: null,
        path: "",
        metaUrl: "",
        pageUrlBuilder: null,
        onDirtyChange: null,
        pages: [],
        annotations: [],
        selectedTextId: "",
        activeTool: "draw",
        zoom: 1.18,
        drawColor: "#111827",
        lineWidth: 2.5,
        fontFamily: "system",
        fontSize: 18,
        fontColor: "#111827",
        drawing: null,
        textDrag: null,
        undoStack: ["[]"],
        redoStack: [],
        savedSnapshot: "[]",
        commitTimer: null,
        disabled: false,
        lastTextCreate: null,
    };

    function $(id) {
        return document.getElementById(id);
    }

    function t(key, fallback) {
        try {
            var script = document.getElementById("handrive-i18n");
            var data = script ? JSON.parse(script.textContent || "{}") : {};
            return data && data[key] ? data[key] : fallback;
        } catch (error) {
            return fallback;
        }
    }

    function setStatus(message) {
        if (statusEl) {
            statusEl.textContent = message || "";
        }
    }

    function setDirty(dirty) {
        if (typeof state.onDirtyChange === "function") {
            state.onDirtyChange(Boolean(dirty));
        }
    }

    function serializeAnnotations() {
        return JSON.stringify(getSerializableAnnotations());
    }

    function serializeHistoryAnnotations() {
        return JSON.stringify(state.annotations.map(function (annotation) {
            if (annotation.type === "draw") {
                return {
                    id: annotation.id || buildId(),
                    type: "draw",
                    page: annotation.page,
                    color: normalizeColor(annotation.color, "#111827"),
                    width: Math.max(0.5, Number(annotation.width) || 2.5),
                    points: (annotation.points || []).map(function (point) {
                        return { x: Number(point.x) || 0, y: Number(point.y) || 0 };
                    }),
                };
            }
            return {
                id: annotation.id || buildId(),
                type: "text",
                page: annotation.page,
                x: Number(annotation.x) || 0,
                y: Number(annotation.y) || 0,
                width: Math.max(20, Number(annotation.width) || 180),
                height: Math.max(12, Number(annotation.height) || getTextBoxDefaultHeight(annotation.fontSize)),
                text: String(annotation.text || ""),
                fontFamily: annotation.fontFamily || "system",
                fontSize: Math.max(8, Math.min(96, Number(annotation.fontSize) || 18)),
                color: normalizeColor(annotation.color, "#111827"),
            };
        }));
    }

    function getIsDirty() {
        return serializeAnnotations() !== state.savedSnapshot;
    }

    function pushHistorySnapshot(snapshot, clearRedo) {
        if (state.undoStack[state.undoStack.length - 1] !== snapshot) {
            state.undoStack.push(snapshot);
            if (state.undoStack.length > 100) {
                state.undoStack.shift();
            }
            if (clearRedo) {
                state.redoStack = [];
            }
        }
    }

    function commitChange() {
        clearCommitTimer();
        pushHistorySnapshot(serializeHistoryAnnotations(), true);
        setDirty(getIsDirty());
        syncUndoRedoButtons();
    }

    function scheduleCommitChange() {
        setDirty(getIsDirty());
        clearCommitTimer();
        state.commitTimer = window.setTimeout(commitChange, 350);
    }

    function clearCommitTimer() {
        if (state.commitTimer) {
            window.clearTimeout(state.commitTimer);
            state.commitTimer = null;
        }
    }

    function applySnapshot(snapshot) {
        try {
            state.annotations = JSON.parse(snapshot || "[]");
        } catch (error) {
            state.annotations = [];
        }
        state.selectedTextId = "";
        renderAllOverlays();
        setDirty(getIsDirty());
        syncUndoRedoButtons();
        syncToolbarFromSelection();
    }

    function flushPendingHistoryChange() {
        clearCommitTimer();
        pushHistorySnapshot(serializeHistoryAnnotations(), true);
        syncUndoRedoButtons();
    }

    function undo() {
        flushPendingHistoryChange();
        if (state.undoStack.length <= 1) {
            return;
        }
        var current = state.undoStack.pop();
        state.redoStack.push(current);
        applySnapshot(state.undoStack[state.undoStack.length - 1]);
    }

    function redo() {
        clearCommitTimer();
        if (!state.redoStack.length) {
            return;
        }
        var snapshot = state.redoStack.pop();
        state.undoStack.push(snapshot);
        applySnapshot(snapshot);
    }

    function syncUndoRedoButtons() {
        if (!surface) {
            return;
        }
        var undoBtn = surface.querySelector('[data-pdf-action="undo"]');
        var redoBtn = surface.querySelector('[data-pdf-action="redo"]');
        if (undoBtn) undoBtn.disabled = state.undoStack.length <= 1 || state.disabled;
        if (redoBtn) redoBtn.disabled = !state.redoStack.length || state.disabled;
    }

    function buildId() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return window.crypto.randomUUID();
        }
        return "pdf-text-" + String(Date.now()) + "-" + String(Math.random()).slice(2);
    }

    function clamp(value, min, max) {
        var resolved = Number(value);
        if (!Number.isFinite(resolved)) {
            resolved = min;
        }
        return Math.max(min, Math.min(max, resolved));
    }

    function normalizeColor(value, fallback) {
        var raw = String(value || "").trim();
        if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
            return raw;
        }
        return fallback || "#111827";
    }

    var PDF_FONT_CSS_FALLBACKS = {
        system: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
        "sans-serif": "Arial, Helvetica, sans-serif",
        serif: "Georgia, \"Times New Roman\", serif",
        monospace: "\"Courier New\", Menlo, Monaco, monospace",
        "Apple SD Gothic Neo": "\"Apple SD Gothic Neo\", \"Malgun Gothic\", \"Noto Sans KR\", sans-serif",
        "Malgun Gothic": "\"Malgun Gothic\", \"Apple SD Gothic Neo\", \"Noto Sans KR\", sans-serif",
        "Noto Sans KR": "\"Noto Sans KR\", \"Apple SD Gothic Neo\", \"Malgun Gothic\", sans-serif",
        "Nanum Gothic": "\"Nanum Gothic\", \"Noto Sans KR\", \"Apple SD Gothic Neo\", sans-serif",
        Inter: "Inter, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
        "Segoe UI": "\"Segoe UI\", system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        Roboto: "Roboto, Arial, Helvetica, sans-serif",
        "Noto Sans": "\"Noto Sans\", Arial, Helvetica, sans-serif",
        "Open Sans": "\"Open Sans\", Arial, Helvetica, sans-serif",
        Calibri: "Calibri, Arial, Helvetica, sans-serif",
        Cambria: "Cambria, Georgia, \"Times New Roman\", serif",
        Garamond: "Garamond, Georgia, \"Times New Roman\", serif",
        "Palatino Linotype": "\"Palatino Linotype\", Palatino, Georgia, serif",
        Consolas: "Consolas, \"Courier New\", Menlo, Monaco, monospace",
        Menlo: "Menlo, Monaco, \"Courier New\", monospace",
        "SF Mono": "\"SF Mono\", Menlo, Monaco, \"Courier New\", monospace",
    };

    function cssFontFamily(value) {
        var family = String(value || "system").trim();
        if (PDF_FONT_CSS_FALLBACKS[family]) return PDF_FONT_CSS_FALLBACKS[family];
        return "\"" + family.replace(/"/g, "") + "\", sans-serif";
    }

    function syncFontFamilySelectPreview(select) {
        if (!select) return;
        select.style.fontFamily = cssFontFamily(select.value || "system");
        Array.prototype.slice.call(select.options || []).forEach(function (option) {
            option.style.fontFamily = cssFontFamily(option.value || "system");
        });
    }

    function getTextBoxDefaultHeight(fontSize) {
        return (Number(fontSize) || state.fontSize || 18) * TEXT_BOX_DEFAULT_HEIGHT_RATIO;
    }

    function getTextBoxPixelMinHeight(fontSize) {
        return Math.max(
            TEXT_BOX_MIN_PIXEL_HEIGHT,
            ((Number(fontSize) || state.fontSize || 18) * state.zoom * TEXT_BOX_LINE_HEIGHT) + TEXT_BOX_VERTICAL_CHROME
        );
    }

    function getCssPixelValue(style, property) {
        var value = parseFloat(style.getPropertyValue(property));
        return Number.isFinite(value) ? value : 0;
    }

    function measureTextLineWidth(style, text) {
        if (!textMeasureCanvas) {
            textMeasureCanvas = document.createElement("canvas");
        }
        var context = textMeasureCanvas.getContext("2d");
        if (!context) {
            return String(text || "").length * (getCssPixelValue(style, "font-size") || 12);
        }
        context.font = style.font;
        return context.measureText(String(text || "")).width;
    }

    function isTextBoxMoveStartPoint(box, event) {
        var rect = box.getBoundingClientRect();
        var style = window.getComputedStyle(box);
        var x = event.clientX - rect.left;
        var y = event.clientY - rect.top;
        var contentLeft = getCssPixelValue(style, "border-left-width") + getCssPixelValue(style, "padding-left");
        var contentRight = rect.width - getCssPixelValue(style, "border-right-width") - getCssPixelValue(style, "padding-right");
        var contentTop = getCssPixelValue(style, "border-top-width") + getCssPixelValue(style, "padding-top");
        var contentBottom = rect.height - getCssPixelValue(style, "border-bottom-width") - getCssPixelValue(style, "padding-bottom");

        if (x < contentLeft || x > contentRight || y < contentTop || y > contentBottom) {
            return true;
        }
        if (!String(box.value || "")) {
            return false;
        }

        var fontSize = getCssPixelValue(style, "font-size") || 16;
        var lineHeight = getCssPixelValue(style, "line-height") || (fontSize * TEXT_BOX_LINE_HEIGHT);
        var lines = String(box.value || "").split(/\r\n|\r|\n/);
        var lineIndex = Math.floor(((y - contentTop) + box.scrollTop) / Math.max(1, lineHeight));
        if (lineIndex < 0 || lineIndex >= lines.length) {
            return true;
        }

        var line = lines[lineIndex] || "";
        if (!line) {
            return true;
        }
        var xInContent = (x - contentLeft) + box.scrollLeft;
        return xInContent > measureTextLineWidth(style, line) + 8;
    }

    function syncTextBoxCursor(box, event) {
        if (!box) {
            return;
        }
        if (state.disabled || !event) {
            box.style.cursor = "default";
            return;
        }
        box.style.cursor = isTextBoxMoveStartPoint(box, event) ? "default" : "text";
    }

    function getPageMeta(pageIndex) {
        return state.pages[pageIndex] || null;
    }

    function pagePointFromEvent(event, canvas) {
        var pageIndex = Number(canvas.getAttribute("data-page-index")) || 0;
        var rect = canvas.getBoundingClientRect();
        var x = (event.clientX - rect.left) / state.zoom;
        var y = (event.clientY - rect.top) / state.zoom;
        var page = getPageMeta(pageIndex);
        if (page) {
            x = clamp(x, 0, Number(page.width) || 0);
            y = clamp(y, 0, Number(page.height) || 0);
        }
        return { page: pageIndex, x: x, y: y };
    }

    function getPageCanvas(pageIndex) {
        return pageList ? pageList.querySelector('.pe-draw-layer[data-page-index="' + String(pageIndex) + '"]') : null;
    }

    function getTextLayer(pageIndex) {
        return pageList ? pageList.querySelector('.pe-text-layer[data-page-index="' + String(pageIndex) + '"]') : null;
    }

    function setupCanvasSize(canvas, width, height) {
        var dpr = Math.max(1, window.devicePixelRatio || 1);
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
        var ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function isSurfaceVisible() {
        return Boolean(surface && !surface.hidden && surface.getClientRects().length);
    }

    function isEditableTarget(target) {
        if (!(target instanceof Element)) {
            return false;
        }
        var tagName = String(target.tagName || "").toLowerCase();
        return tagName === "input" ||
            tagName === "textarea" ||
            tagName === "select" ||
            target.isContentEditable;
    }

    function isShortcutScope(event) {
        if (!isSurfaceVisible() || state.disabled) {
            return false;
        }
        var target = event.target instanceof Element ? event.target : null;
        var active = document.activeElement instanceof Element ? document.activeElement : null;
        if ((target && surface.contains(target)) || (active && surface.contains(active))) {
            return true;
        }
        return !active || active === document.body || active === document.documentElement;
    }

    function getHistoryShortcutKey(event) {
        var key = String(event.key || "").toLowerCase();
        if (key === "z" || key === "y") {
            return key;
        }
        var code = String(event.code || "").toLowerCase();
        if (code === "keyz") {
            return "z";
        }
        if (code === "keyy") {
            return "y";
        }
        return "";
    }

    function handleKeydown(event) {
        var key = getHistoryShortcutKey(event);
        if (!key || event.defaultPrevented || event.altKey || event.isComposing || !isShortcutScope(event)) {
            return;
        }
        var hasHistoryModifier = event.ctrlKey || event.metaKey;
        var shortcutTarget = event.target instanceof Element ? event.target : document.activeElement;
        var isTargetInSurface = shortcutTarget instanceof Element && surface.contains(shortcutTarget);
        var isBareSurfaceShortcut = !hasHistoryModifier &&
            !event.shiftKey &&
            !isEditableTarget(event.target) &&
            (isTargetInSurface ||
                document.activeElement === document.body ||
                document.activeElement === document.documentElement);
        if (!hasHistoryModifier && !isBareSurfaceShortcut) {
            return;
        }
        event.preventDefault();
        if (key === "z" && hasHistoryModifier && event.shiftKey) {
            redo();
        } else if (key === "z") {
            undo();
        } else {
            redo();
        }
    }

    function drawStroke(ctx, annotation) {
        var points = annotation.points || [];
        if (points.length < 2) {
            return;
        }
        ctx.save();
        ctx.strokeStyle = normalizeColor(annotation.color, "#111827");
        ctx.lineWidth = Math.max(0.5, Number(annotation.width) || 2.5) * state.zoom;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(points[0].x * state.zoom, points[0].y * state.zoom);
        for (var i = 1; i < points.length; i += 1) {
            ctx.lineTo(points[i].x * state.zoom, points[i].y * state.zoom);
        }
        ctx.stroke();
        ctx.restore();
    }

    function renderDrawLayer(pageIndex) {
        var canvas = getPageCanvas(pageIndex);
        if (!canvas) {
            return;
        }
        var ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        state.annotations.forEach(function (annotation) {
            if (annotation.type === "draw" && annotation.page === pageIndex) {
                drawStroke(ctx, annotation);
            }
        });
        if (state.drawing && state.drawing.page === pageIndex) {
            drawStroke(ctx, state.drawing);
        }
    }

    function focusTextBox(box) {
        if (!box) {
            return;
        }
        window.requestAnimationFrame(function () {
            if (!document.body.contains(box) || box.disabled) {
                return;
            }
            try {
                box.focus({ preventScroll: true });
            } catch (error) {
                box.focus();
            }
            try {
                var length = String(box.value || "").length;
                box.setSelectionRange(length, length);
            } catch (error) {}
        });
    }

    function updateTextBoxSize(box, annotation) {
        if (!box || !annotation) {
            return;
        }
        var minHeight = getTextBoxPixelMinHeight(annotation.fontSize);
        box.style.minHeight = minHeight + "px";
        box.style.height = "auto";
        var height = Math.max(minHeight, box.scrollHeight + 2);
        box.style.height = height + "px";
        annotation.height = height / state.zoom;
        annotation.width = Math.max(40, box.offsetWidth / state.zoom);
    }

    function renderTextLayer(pageIndex) {
        var layer = getTextLayer(pageIndex);
        if (!layer) {
            return;
        }
        layer.innerHTML = "";
        state.annotations.forEach(function (annotation) {
            if (annotation.type !== "text" || annotation.page !== pageIndex) {
                return;
            }
            renderTextBox(layer, annotation);
        });
    }

    function renderTextBox(layer, annotation) {
        var box = document.createElement("textarea");
        box.className = "pe-text-box";
        if (annotation.id === state.selectedTextId) {
            box.classList.add("is-selected");
        }
        box.value = annotation.text || "";
        box.rows = 1;
        box.spellcheck = false;
        box.setAttribute("data-text-id", annotation.id);
        box.style.left = (annotation.x * state.zoom) + "px";
        box.style.top = (annotation.y * state.zoom) + "px";
        box.style.width = Math.max(70, (Number(annotation.width) || 180) * state.zoom) + "px";
        box.style.minHeight = getTextBoxPixelMinHeight(annotation.fontSize) + "px";
        box.style.fontFamily = cssFontFamily(annotation.fontFamily);
        box.style.fontSize = (Number(annotation.fontSize) || state.fontSize) * state.zoom + "px";
        box.style.color = normalizeColor(annotation.color, state.fontColor);

        box.addEventListener("focus", function () {
            selectText(annotation.id);
        });
        box.addEventListener("mousemove", function (event) {
            if (event.buttons) {
                return;
            }
            syncTextBoxCursor(box, event);
        });
        box.addEventListener("mouseleave", function () {
            box.style.cursor = "";
        });
        box.addEventListener("input", function () {
            annotation.text = box.value;
            updateTextBoxSize(box, annotation);
            scheduleCommitChange();
        });
        box.addEventListener("blur", function () {
            annotation.text = box.value;
            updateTextBoxSize(box, annotation);
            if (!String(annotation.text || "").trim()) {
                removeAnnotation(annotation.id);
            } else {
                commitChange();
            }
        });
        box.addEventListener("pointerdown", function (event) {
            if (state.disabled || event.button !== 0) {
                return;
            }
            state.textDrag = null;
            selectText(annotation.id);
            if (!isTextBoxMoveStartPoint(box, event)) {
                box.style.cursor = "text";
                return;
            }
            box.style.cursor = "default";
            event.preventDefault();
            state.textDrag = {
                id: annotation.id,
                box: box,
                page: annotation.page,
                startClientX: event.clientX,
                startClientY: event.clientY,
                startX: annotation.x,
                startY: annotation.y,
                moved: false,
            };
            box.setPointerCapture(event.pointerId);
        });
        box.addEventListener("pointermove", function (event) {
            var drag = state.textDrag;
            if (!drag || drag.id !== annotation.id) {
                return;
            }
            var dx = (event.clientX - drag.startClientX) / state.zoom;
            var dy = (event.clientY - drag.startClientY) / state.zoom;
            if (!drag.moved && Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) < 4) {
                return;
            }
            drag.moved = true;
            event.preventDefault();
            var page = getPageMeta(annotation.page);
            var maxX = page ? Math.max(0, Number(page.width) - (Number(annotation.width) || 120)) : 100000;
            var maxY = page ? Math.max(0, Number(page.height) - (Number(annotation.height) || 24)) : 100000;
            annotation.x = clamp(drag.startX + dx, 0, maxX);
            annotation.y = clamp(drag.startY + dy, 0, maxY);
            box.style.left = (annotation.x * state.zoom) + "px";
            box.style.top = (annotation.y * state.zoom) + "px";
            setDirty(true);
        });
        box.addEventListener("pointerup", function (event) {
            var drag = state.textDrag;
            if (drag && drag.id === annotation.id) {
                try {
                    box.releasePointerCapture(event.pointerId);
                } catch (error) {}
                state.textDrag = null;
                if (drag.moved) {
                    commitChange();
                } else {
                    focusTextBox(box);
                }
            }
        });

        layer.appendChild(box);
        updateTextBoxSize(box, annotation);
    }

    function renderAllOverlays() {
        state.pages.forEach(function (_page, index) {
            renderDrawLayer(index);
            renderTextLayer(index);
        });
    }

    function selectText(id) {
        state.selectedTextId = id || "";
        syncToolbarFromSelection();
        if (!pageList) {
            return;
        }
        Array.prototype.slice.call(pageList.querySelectorAll(".pe-text-box")).forEach(function (box) {
            box.classList.toggle("is-selected", box.getAttribute("data-text-id") === state.selectedTextId);
        });
    }

    function getSelectedTextAnnotation() {
        if (!state.selectedTextId) {
            return null;
        }
        return state.annotations.find(function (annotation) {
            return annotation.type === "text" && annotation.id === state.selectedTextId;
        }) || null;
    }

    function removeAnnotation(id) {
        var before = state.annotations.length;
        state.annotations = state.annotations.filter(function (annotation) {
            return annotation.id !== id;
        });
        if (state.selectedTextId === id) {
            state.selectedTextId = "";
        }
        if (state.annotations.length !== before) {
            renderAllOverlays();
            commitChange();
        }
    }

    function syncToolbarFromSelection() {
        var selected = getSelectedTextAnnotation();
        if (selected) {
            state.fontFamily = selected.fontFamily || state.fontFamily;
            state.fontSize = Number(selected.fontSize) || state.fontSize;
            state.fontColor = normalizeColor(selected.color, state.fontColor);
            state.drawColor = state.fontColor;
        }
        if (fontFamilySelect) {
            fontFamilySelect.value = state.fontFamily;
            syncFontFamilySelectPreview(fontFamilySelect);
        }
        if (fontSizeInput) fontSizeInput.value = String(Math.round(state.fontSize));
        if (fontColorInput) fontColorInput.value = state.fontColor;
        if (lineWidthInput) lineWidthInput.value = String(state.lineWidth);
        if (lineWidthDisplay) lineWidthDisplay.textContent = String(state.lineWidth).replace(/\.0$/, "") + "px";
    }

    function applyTextStyleChange() {
        state.fontFamily = fontFamilySelect ? fontFamilySelect.value : state.fontFamily;
        syncFontFamilySelectPreview(fontFamilySelect);
        state.fontSize = clamp(fontSizeInput ? fontSizeInput.value : state.fontSize, 8, 96);
        state.fontColor = normalizeColor(fontColorInput ? fontColorInput.value : state.fontColor, "#111827");
        state.drawColor = state.fontColor;

        var selected = getSelectedTextAnnotation();
        if (!selected) {
            syncToolbarFromSelection();
            return;
        }
        selected.fontFamily = state.fontFamily;
        selected.fontSize = state.fontSize;
        selected.color = state.fontColor;
        renderTextLayer(selected.page);
        commitChange();
    }

    function createTextAt(pageIndex, x, y) {
        var annotation = {
            id: buildId(),
            type: "text",
            page: pageIndex,
            x: x,
            y: y,
            width: 210,
            height: getTextBoxDefaultHeight(state.fontSize),
            text: "",
            fontFamily: state.fontFamily,
            fontSize: state.fontSize,
            color: state.fontColor,
        };
        state.annotations.push(annotation);
        renderTextLayer(pageIndex);
        selectText(annotation.id);
        var box = pageList ? pageList.querySelector('.pe-text-box[data-text-id="' + annotation.id + '"]') : null;
        focusTextBox(box);
        commitChange();
        setDirty(getIsDirty());
    }

    function onCanvasPointerDown(event) {
        if (state.disabled || event.button !== 0) {
            return;
        }
        var canvas = event.currentTarget;
        var point = pagePointFromEvent(event, canvas);
        selectText("");
        if (state.activeTool === "text") {
            event.preventDefault();
            event.stopPropagation();
            state.lastTextCreate = {
                time: Date.now(),
                clientX: event.clientX,
                clientY: event.clientY,
            };
            createTextAt(point.page, point.x, point.y);
            return;
        }
        event.preventDefault();
        canvas.setPointerCapture(event.pointerId);
        state.drawing = {
            id: buildId(),
            type: "draw",
            page: point.page,
            color: state.drawColor,
            width: state.lineWidth,
            points: [{ x: point.x, y: point.y }],
        };
        renderDrawLayer(point.page);
    }

    function onCanvasPointerMove(event) {
        if (!state.drawing) {
            return;
        }
        var canvas = event.currentTarget;
        var point = pagePointFromEvent(event, canvas);
        if (point.page !== state.drawing.page) {
            return;
        }
        var points = state.drawing.points;
        var last = points[points.length - 1];
        if (last && Math.hypot(last.x - point.x, last.y - point.y) < 0.8) {
            return;
        }
        points.push({ x: point.x, y: point.y });
        renderDrawLayer(point.page);
        setDirty(true);
    }

    function onCanvasPointerUp(event) {
        if (!state.drawing) {
            return;
        }
        var drawing = state.drawing;
        state.drawing = null;
        try {
            event.currentTarget.releasePointerCapture(event.pointerId);
        } catch (error) {}
        if (drawing.points.length >= 2) {
            state.annotations.push(drawing);
            renderDrawLayer(drawing.page);
            commitChange();
        } else {
            renderDrawLayer(drawing.page);
        }
    }

    function pagePointFromPageWrapEvent(event, wrap) {
        var pageIndex = Number(wrap.getAttribute("data-page-index")) || 0;
        var rect = wrap.getBoundingClientRect();
        var x = (event.clientX - rect.left) / state.zoom;
        var y = (event.clientY - rect.top) / state.zoom;
        var page = getPageMeta(pageIndex);
        if (page) {
            x = clamp(x, 0, Number(page.width) || 0);
            y = clamp(y, 0, Number(page.height) || 0);
        }
        return { page: pageIndex, x: x, y: y };
    }

    function onPageWrapClick(event) {
        if (state.disabled || state.activeTool !== "text") {
            return;
        }
        if (event.target instanceof Element && event.target.closest(".pe-text-box")) {
            return;
        }
        var recent = state.lastTextCreate;
        if (
            recent &&
            Date.now() - recent.time < 500 &&
            Math.hypot(event.clientX - recent.clientX, event.clientY - recent.clientY) < 8
        ) {
            return;
        }
        event.preventDefault();
        var point = pagePointFromPageWrapEvent(event, event.currentTarget);
        state.lastTextCreate = {
            time: Date.now(),
            clientX: event.clientX,
            clientY: event.clientY,
        };
        createTextAt(point.page, point.x, point.y);
    }

    function buildPageImageUrl(pageIndex) {
        if (typeof state.pageUrlBuilder === "function") {
            return state.pageUrlBuilder(pageIndex, 2);
        }
        return "";
    }

    function renderPages() {
        if (!pageList) {
            return;
        }
        pageList.innerHTML = "";
        state.pages.forEach(function (page, index) {
            var width = Math.max(1, Math.round(Number(page.width || 0) * state.zoom));
            var height = Math.max(1, Math.round(Number(page.height || 0) * state.zoom));
            var item = document.createElement("section");
            item.className = "pe-page";
            item.setAttribute("data-page-index", String(index));

            var label = document.createElement("div");
            label.className = "pe-page-label";
            label.textContent = t("pdf_editor_page_label", "페이지") + " " + String(index + 1) + " / " + String(state.pages.length);

            var wrap = document.createElement("div");
            wrap.className = "pe-page-wrap";
            wrap.setAttribute("data-page-index", String(index));
            wrap.style.width = width + "px";
            wrap.style.height = height + "px";
            wrap.addEventListener("click", onPageWrapClick);

            var img = document.createElement("img");
            img.className = "pe-page-image";
            img.alt = label.textContent;
            img.draggable = false;
            img.src = buildPageImageUrl(index);

            var canvas = document.createElement("canvas");
            canvas.className = "pe-draw-layer";
            canvas.setAttribute("data-page-index", String(index));
            setupCanvasSize(canvas, width, height);
            canvas.addEventListener("pointerdown", onCanvasPointerDown);
            canvas.addEventListener("pointermove", onCanvasPointerMove);
            canvas.addEventListener("pointerup", onCanvasPointerUp);
            canvas.addEventListener("pointercancel", onCanvasPointerUp);

            var textLayer = document.createElement("div");
            textLayer.className = "pe-text-layer";
            textLayer.setAttribute("data-page-index", String(index));

            wrap.appendChild(img);
            wrap.appendChild(canvas);
            wrap.appendChild(textLayer);
            item.appendChild(label);
            item.appendChild(wrap);
            pageList.appendChild(item);
        });
        renderAllOverlays();
    }

    function bindControls() {
        if (!surface || surface.dataset.pdfEditorBound === "1") {
            return;
        }
        surface.dataset.pdfEditorBound = "1";
        window.addEventListener("keydown", handleKeydown, true);

        surface.addEventListener("click", function (event) {
            var toolButton = event.target instanceof Element ? event.target.closest("[data-pdf-tool]") : null;
            if (toolButton && surface.contains(toolButton)) {
                state.activeTool = toolButton.getAttribute("data-pdf-tool") || "draw";
                Array.prototype.slice.call(surface.querySelectorAll("[data-pdf-tool]")).forEach(function (button) {
                    button.classList.toggle("is-active", button === toolButton);
                });
                if (pageList) {
                    pageList.classList.toggle("is-pdf-text-mode", state.activeTool === "text");
                }
                return;
            }
            var actionButton = event.target instanceof Element ? event.target.closest("[data-pdf-action]") : null;
            if (actionButton && surface.contains(actionButton)) {
                var action = actionButton.getAttribute("data-pdf-action");
                if (action === "undo") undo();
                if (action === "redo") redo();
            }
        });

        if (lineWidthInput) {
            lineWidthInput.addEventListener("input", function () {
                state.lineWidth = clamp(lineWidthInput.value, 1, 12);
                if (lineWidthDisplay) {
                    lineWidthDisplay.textContent = String(state.lineWidth).replace(/\.0$/, "") + "px";
                }
            });
        }
        [fontFamilySelect, fontSizeInput, fontColorInput].forEach(function (control) {
            if (control) {
                control.addEventListener("input", applyTextStyleChange);
                control.addEventListener("change", applyTextStyleChange);
            }
        });
    }

    function loadMeta() {
        if (!state.metaUrl) {
            return Promise.reject(new Error(t("pdf_editor_load_error", "PDF 편집기를 불러오지 못했습니다.")));
        }
        setStatus(t("pdf_editor_loading", "PDF 불러오는 중..."));
        return fetch(state.metaUrl, {
            headers: { "X-Requested-With": "XMLHttpRequest" },
        })
            .then(function (response) {
                return response.json().then(function (data) {
                    if (!response.ok || !data || data.ok === false) {
                        throw new Error((data && (data.error || data.message)) || t("pdf_editor_load_error", "PDF 편집기를 불러오지 못했습니다."));
                    }
                    return data;
                });
            })
            .then(function (data) {
                state.pages = Array.isArray(data.pages) ? data.pages : [];
                if (!state.pages.length) {
                    throw new Error(t("pdf_editor_load_error", "PDF 편집기를 불러오지 못했습니다."));
                }
                renderPages();
                setStatus("");
            });
    }

    function init(options) {
        var settings = options || {};
        surface = $("handrive-pdf-editor-surface");
        pageArea = $("pe-page-area");
        pageList = $("pe-page-list");
        statusEl = $("pe-status");
        lineWidthInput = $("pe-line-width");
        lineWidthDisplay = $("pe-line-width-display");
        fontFamilySelect = $("pe-font-family");
        fontSizeInput = $("pe-font-size");
        fontColorInput = $("pe-font-color");
        if (!surface || !pageList) {
            return Promise.reject(new Error(t("pdf_editor_load_error", "PDF 편집기를 불러오지 못했습니다.")));
        }
        clearCommitTimer();
        state.entry = settings.entry || null;
        state.path = state.entry ? String(state.entry.path || "") : "";
        state.metaUrl = settings.metaUrl || "";
        state.pageUrlBuilder = settings.pageUrlBuilder || null;
        state.onDirtyChange = typeof settings.onDirtyChange === "function" ? settings.onDirtyChange : null;
        state.pages = [];
        state.annotations = [];
        state.selectedTextId = "";
        state.drawing = null;
        state.textDrag = null;
        state.lastTextCreate = null;
        state.undoStack = [serializeHistoryAnnotations()];
        state.redoStack = [];
        state.savedSnapshot = "[]";
        state.disabled = false;
        state.activeTool = "draw";
        state.drawColor = "#111827";
        state.lineWidth = 2.5;
        state.fontFamily = "system";
        state.fontSize = 18;
        state.fontColor = "#111827";
        if (pageList) pageList.innerHTML = "";
        if (lineWidthInput) lineWidthInput.value = "2.5";
        if (fontFamilySelect) {
            fontFamilySelect.value = "system";
            syncFontFamilySelectPreview(fontFamilySelect);
        }
        if (fontSizeInput) fontSizeInput.value = "18";
        if (fontColorInput) fontColorInput.value = "#111827";
        Array.prototype.slice.call(surface.querySelectorAll("[data-pdf-tool]")).forEach(function (button) {
            button.classList.toggle("is-active", button.getAttribute("data-pdf-tool") === "draw");
        });
        if (pageList) pageList.classList.remove("is-pdf-text-mode");
        bindControls();
        syncToolbarFromSelection();
        setDirty(false);
        syncUndoRedoButtons();
        return loadMeta();
    }

    function destroy() {
        clearCommitTimer();
        if (pageList) {
            pageList.innerHTML = "";
        }
        state.pages = [];
        state.annotations = [];
        state.drawing = null;
        state.textDrag = null;
        state.lastTextCreate = null;
        state.selectedTextId = "";
        setStatus("");
        setDirty(false);
    }

    function setDisabled(disabled) {
        state.disabled = Boolean(disabled);
        if (!surface) {
            return;
        }
        Array.prototype.slice.call(surface.querySelectorAll("button, input, select, textarea")).forEach(function (control) {
            control.disabled = state.disabled;
        });
        syncUndoRedoButtons();
    }

    function getSerializableAnnotations() {
        return state.annotations
            .filter(function (annotation) {
                return annotation.type === "draw" || (annotation.type === "text" && String(annotation.text || "").trim());
            })
            .map(function (annotation) {
                if (annotation.type === "draw") {
                    return {
                        type: "draw",
                        page: annotation.page,
                        color: normalizeColor(annotation.color, "#111827"),
                        width: Math.max(0.5, Number(annotation.width) || 2.5),
                        points: (annotation.points || []).map(function (point) {
                            return { x: Number(point.x) || 0, y: Number(point.y) || 0 };
                        }),
                    };
                }
                return {
                    type: "text",
                    page: annotation.page,
                    x: Number(annotation.x) || 0,
                    y: Number(annotation.y) || 0,
                    width: Math.max(20, Number(annotation.width) || 180),
                    height: Math.max(12, Number(annotation.height) || getTextBoxDefaultHeight(annotation.fontSize)),
                    text: String(annotation.text || ""),
                    fontFamily: annotation.fontFamily || "system",
                    fontSize: Math.max(8, Math.min(96, Number(annotation.fontSize) || 18)),
                    color: normalizeColor(annotation.color, "#111827"),
                };
            });
    }

    function saveToServer(saveUrl, csrfToken, path, onDone, options) {
        clearCommitTimer();
        var saveOptions = options || {};
        var targetFilename = String(saveOptions.filename || "").trim();
        var originalFilename = state.entry ? String(state.entry.name || "").trim() : "";
        var annotations = getSerializableAnnotations();
        if (!saveUrl || !path) {
            onDone && onDone({ ok: false, error: t("js_request_failed", "요청 처리 중 오류가 발생했습니다.") });
            return;
        }
        if (!annotations.length && (!targetFilename || targetFilename === originalFilename)) {
            onDone && onDone({ ok: false, error: t("pdf_editor_save_error", "PDF 저장 실패") });
            return;
        }
        var formData = new FormData();
        formData.append("path", path);
        formData.append("annotations_json", JSON.stringify(annotations));
        if (targetFilename) {
            formData.append("filename", targetFilename);
        }
        if (csrfToken) {
            formData.append("csrfmiddlewaretoken", csrfToken);
        }
        fetch(saveUrl, {
            method: "POST",
            headers: csrfToken
                ? { "X-CSRFToken": csrfToken, "X-Requested-With": "XMLHttpRequest" }
                : { "X-Requested-With": "XMLHttpRequest" },
            body: formData,
        })
            .then(function (response) { return response.json(); })
            .then(function (data) {
                if (data && data.ok) {
                    state.savedSnapshot = serializeAnnotations();
                    setDirty(false);
                }
                onDone && onDone(data || { ok: false });
            })
            .catch(function (error) {
                onDone && onDone({ ok: false, error: String(error) });
            });
    }

    window.HandrivePdfEditor = {
        init: init,
        destroy: destroy,
        saveToServer: saveToServer,
        getIsDirty: getIsDirty,
        setDisabled: setDisabled,
        undo: undo,
        redo: redo,
    };
})();
