(function () {
    "use strict";

    // 6열 × 2행 기본 12색
    var DEFAULT_PALETTE = [
        "#ff0000","#ff8000","#ffff00","#88dd00","#00bb00","#00bfff",
        "#0055ff","#7700ff","#cc0055","#884400","#000000","#ffffff",
    ];

    function selectServerMessage(payload, fallback) {
        if (window.HandriveSelectServerMessage) {
            return window.HandriveSelectServerMessage(payload, fallback);
        }
        if (!payload || typeof payload !== "object") {
            return fallback || "";
        }
        var lang = (document.documentElement.getAttribute("lang") || "").toLowerCase().indexOf("en") === 0 ? "en" : "ko";
        var messages = payload.error_messages || payload.messages;
        if (messages && typeof messages === "object") {
            return messages[lang] || messages.ko || messages.en || fallback || "";
        }
        return payload.error_message || payload.message || payload.error || fallback || "";
    }

    var state = {
        activeTool: "pencil",
        brushSize: 4,
        eraserSize: 16,
        eraserMode: "white",
        shapeMode: "outline",
        primaryColor: "#000000",
        secondaryColor: "#ffffff",
        recentColors: [],
        zoom: 1.0,
        canvasWidth: 0,
        canvasHeight: 0,
        isDrawing: false,
        lastX: 0, lastY: 0,
        drawStartX: 0, drawStartY: 0,
        // 자유형 선택: 폴리곤 경로를 유지 (bounding box 변환 안 함)
        freeSelectPoints: [],
        freeSelectPath: null,   // confirmed polygon path (endSelectFree 후 유지)
        freeSelectBuilding: false,
        selectionMask: null,    // { x, y, w, h, data } exact pixel mask for auto border selection
        selection: null,        // { x, y, w, h } bounding box
        selectionImageData: null,
        selectionFloating: false,
        selectionDragging: false,
        selectionDragOffsetX: 0, selectionDragOffsetY: 0,
        marchingAntsOffset: 0,
        marchingRafId: null,
        undoHistory: [],
        redoHistory: [],
        MAX_UNDO: 50,
        isDirty: false,
        textOverlayActive: false,
        textFont: "16px sans-serif",
        textSize: 16,
        textBold: false,
        textItalic: false,
        entry: null,
        onDirtyChange: null,
        backgroundRemoveUrl: "",
        backgroundRemoveRunning: false,
        forcePngOnSave: false,
        panDragging: false,
        panStartClientX: 0,
        panStartClientY: 0,
        panStartScrollLeft: 0,
        panStartScrollTop: 0,
    };

    var imageEditorSurface;
    var mainCanvas, mainCtx, overlayCanvas, overlayCtx, textOverlay;
    var canvasArea, canvasWrap;
    var coordsDisplay, sizeDisplay, zoomDisplay;
    var brushSizeInput, brushSizeDisplay;
    var primarySwatch, secondarySwatch;
    var paletteEl, customColorInput;
    var resizeModal, saveAsModal;
    var boundKeyDown, boundWheel, boundContextMenu;
    var modalsAlreadyBound = false;
    var ribbonAlreadyBound = false;
    var canvasAlreadyBound = false;
    var keyboardAlreadyBound = false;

    // 캔버스 테두리 드래그 리사이즈 상태
    var resizeDragging = false;
    var resizeHandlePos = "";
    var resizeStartClientX = 0, resizeStartClientY = 0;
    var resizeStartW = 0, resizeStartH = 0;
    var resizeOriginalImageData = null;
    var resizeHandleBoundMove = null, resizeHandleBoundUp = null;

    // ── 초기화 ────────────────────────────────────────────────────────────
    function init(options) {
        var opts = options || {};
        state.entry = opts.entry || null;
        state.onDirtyChange = opts.onDirtyChange || null;
        state.backgroundRemoveUrl = opts.backgroundRemoveUrl || "";
        state.backgroundRemoveRunning = false;
        state.forcePngOnSave = false;
        state.panDragging = false;

        imageEditorSurface = document.getElementById("handrive-image-editor-surface");
        mainCanvas    = document.getElementById("ie-main-canvas");
        overlayCanvas = document.getElementById("ie-overlay-canvas");
        textOverlay   = document.getElementById("ie-text-overlay");
        canvasArea    = document.getElementById("ie-canvas-area");
        canvasWrap    = document.getElementById("ie-canvas-wrap");
        coordsDisplay = document.getElementById("ie-coords-display");
        sizeDisplay   = document.getElementById("ie-size-display");
        zoomDisplay   = document.getElementById("ie-zoom-display");
        brushSizeInput   = document.getElementById("ie-brush-size");
        brushSizeDisplay = document.getElementById("ie-brush-size-display");
        primarySwatch   = document.getElementById("ie-primary-swatch");
        secondarySwatch = document.getElementById("ie-secondary-swatch");
        paletteEl       = document.getElementById("ie-palette");
        customColorInput = document.getElementById("ie-custom-color");
        resizeModal = document.getElementById("ie-resize-modal");
        saveAsModal = document.getElementById("ie-save-as-modal");

        if (!mainCanvas || !overlayCanvas) return;
        mainCtx    = mainCanvas.getContext("2d", { willReadFrequently: true });
        overlayCtx = overlayCanvas.getContext("2d");

        state.isDirty = false;
        state.undoHistory = [];
        state.redoHistory = [];
        state.selection = null;
        state.selectionMask = null;
        state.selectionImageData = null;
        state.selectionFloating = false;
        state.selectionDragging = false;
        state.freeSelectPath = null;
        state.freeSelectBuilding = false;
        state.selectionMask = null;
        state.isDrawing = false;
        state.textOverlayActive = false;
        state.zoom = 1.0;
        state.MAX_UNDO = 50;

        // 기존 리사이즈 핸들 제거 후 재생성
        if (canvasWrap) {
            canvasWrap.querySelectorAll(".ie-canvas-resize-handle").forEach(function (h) { h.remove(); });
        }

        buildPalette();
        syncSwatches();
        bindRibbonEvents();
        bindCanvasEvents();
        bindKeyboard();
        bindModals();
        createResizeHandles();

        if (opts.imageServeUrl) {
            loadImage(opts.imageServeUrl);
        }
    }

    function destroy() {
        if (state.marchingRafId) {
            cancelAnimationFrame(state.marchingRafId);
            state.marchingRafId = null;
        }
        if (boundKeyDown)     document.removeEventListener("keydown",      boundKeyDown);
        if (boundWheel)       canvasArea && canvasArea.removeEventListener("wheel", boundWheel);
        if (boundContextMenu) overlayCanvas && overlayCanvas.removeEventListener("contextmenu", boundContextMenu);
        boundKeyDown = boundWheel = boundContextMenu = null;

        if (resizeHandleBoundMove) document.removeEventListener("pointermove", resizeHandleBoundMove);
        if (resizeHandleBoundUp)   document.removeEventListener("pointerup",   resizeHandleBoundUp);
        resizeHandleBoundMove = resizeHandleBoundUp = null;
        resizeDragging = false;

        if (canvasWrap) {
            canvasWrap.querySelectorAll(".ie-canvas-resize-handle").forEach(function (h) { h.remove(); });
        }

        if (textOverlay) {
            textOverlay.hidden = true;
            textOverlay.value = "";
        }
        if (overlayCtx && overlayCanvas) {
            overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        }

        state.entry = null;
        state.onDirtyChange = null;
        state.backgroundRemoveUrl = "";
        state.backgroundRemoveRunning = false;
        state.forcePngOnSave = false;
        state.panDragging = false;
        if (canvasArea) canvasArea.classList.remove("is-panning");
        setEditorBusy(false);
        state.isDirty = false;
    }

    // ── 이미지 로드 ───────────────────────────────────────────────────────
    function loadImage(url) {
        var img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = function () {
            var w = img.naturalWidth;
            var h = img.naturalHeight;
            state.canvasWidth  = w;
            state.canvasHeight = h;
            mainCanvas.width   = w;
            mainCanvas.height  = h;
            overlayCanvas.width  = w;
            overlayCanvas.height = h;
            mainCtx.drawImage(img, 0, 0);
            state.MAX_UNDO = (w > 2048 || h > 2048) ? 20 : 50;
            commitHistoryState();
            updateSizeDisplay();
            // 레이아웃 완료 후 zoomFit 실행
            setTimeout(zoomFit, 0);
        };
        img.onerror = function () {
            console.error("이미지 로드 실패:", url);
        };
        img.src = url;
    }

    // ── 팔레트 ───────────────────────────────────────────────────────────
    function buildPalette() {
        if (!paletteEl) return;
        paletteEl.innerHTML = "";
        DEFAULT_PALETTE.forEach(function (color) {
            var cell = document.createElement("div");
            cell.className = "ie-palette-cell";
            cell.style.background = color;
            cell.title = color;
            cell.addEventListener("click", function (e) {
                if (e.button === 2 || e.shiftKey) setSecondaryColor(color);
                else setPrimaryColor(color);
            });
            cell.addEventListener("contextmenu", function (e) {
                e.preventDefault();
                setSecondaryColor(color);
            });
            paletteEl.appendChild(cell);
        });
    }

    function syncSwatches() {
        if (primarySwatch)   primarySwatch.style.background   = state.primaryColor;
        if (secondarySwatch) secondarySwatch.style.background = state.secondaryColor;
        if (customColorInput) customColorInput.value = state.primaryColor;
    }

    function setPrimaryColor(color) { state.primaryColor = color; syncSwatches(); }
    function setSecondaryColor(color) { state.secondaryColor = color; syncSwatches(); }

    // ── 리본 이벤트 ───────────────────────────────────────────────────────
    function bindRibbonEvents() {
        if (ribbonAlreadyBound) return;
        ribbonAlreadyBound = true;
        var ribbon = document.getElementById("ie-ribbon");
        if (!ribbon) return;

        ribbon.querySelectorAll("button").forEach(function (btn) {
            btn.type = "button";
        });

        ribbon.querySelectorAll(".ie-tool-btn[data-tool]").forEach(function (btn) {
            btn.addEventListener("click", function (event) {
                event.preventDefault();
                setActiveTool(btn.dataset.tool);
            });
        });

        ribbon.querySelectorAll(".ie-action-btn[data-action]").forEach(function (btn) {
            btn.addEventListener("click", function (event) {
                event.preventDefault();
                if (state.backgroundRemoveRunning) return;
                handleAction(btn.dataset.action);
            });
        });

        ribbon.querySelectorAll(".ie-mode-btn[data-shape-mode]").forEach(function (btn) {
            btn.addEventListener("click", function (event) {
                event.preventDefault();
                state.shapeMode = btn.dataset.shapeMode;
                ribbon.querySelectorAll(".ie-mode-btn[data-shape-mode]").forEach(function (b) {
                    b.classList.toggle("is-active", b === btn);
                });
            });
        });

        if (brushSizeInput) {
            brushSizeInput.addEventListener("input", function () {
                state.brushSize = parseInt(brushSizeInput.value, 10);
                state.eraserSize = state.brushSize * 2;
                if (brushSizeDisplay) brushSizeDisplay.textContent = state.brushSize + "px";
            });
        }

        if (primarySwatch) {
            primarySwatch.addEventListener("click", function () {
                if (customColorInput) customColorInput.click();
            });
            primarySwatch.addEventListener("contextmenu", function (e) {
                e.preventDefault();
                var tmp = document.createElement("input");
                tmp.type = "color"; tmp.value = state.secondaryColor;
                tmp.addEventListener("input", function () { setSecondaryColor(tmp.value); });
                tmp.click();
            });
        }
        if (secondarySwatch) {
            secondarySwatch.addEventListener("click", function () {
                var tmp = document.createElement("input");
                tmp.type = "color"; tmp.value = state.secondaryColor;
                tmp.addEventListener("input", function () { setSecondaryColor(tmp.value); });
                tmp.click();
            });
        }

        var swapBtn = document.getElementById("ie-swatch-swap");
        if (swapBtn) {
            swapBtn.addEventListener("click", function (event) {
                event.preventDefault();
                var t = state.primaryColor;
                state.primaryColor   = state.secondaryColor;
                state.secondaryColor = t;
                syncSwatches();
            });
        }

        if (customColorInput) {
            customColorInput.addEventListener("input", function () { setPrimaryColor(customColorInput.value); });
        }
    }

    function setActiveTool(tool) {
        if (state.textOverlayActive) commitTextOverlay();
        if (tool !== "select-free" && state.freeSelectBuilding) {
            cancelFreeSelectBuild();
        }
        if (tool !== "select-rect" && tool !== "select-free" && state.selection) {
            flattenFloatingSelection();
            clearSelection();
        }
        state.activeTool = tool;
        var ribbon = document.getElementById("ie-ribbon");
        if (ribbon) {
            ribbon.querySelectorAll(".ie-tool-btn[data-tool]").forEach(function (btn) {
                btn.classList.toggle("is-active", btn.dataset.tool === tool);
            });
        }
        if (overlayCanvas) {
            var cursors = {
                pencil: "crosshair", brush: "crosshair", eraser: "cell",
                fill: "crosshair", eyedropper: "crosshair", text: "text",
                "select-rect": "crosshair", "select-free": "crosshair",
            };
            overlayCanvas.style.cursor = cursors[tool] || "crosshair";
            overlayCanvas.style.pointerEvents = "all";
        }
    }

    function handleAction(action) {
        switch (action) {
            case "undo":        undoEditorChange();             break;
            case "redo":        redoEditorChange();             break;
            case "rotate-cw":  rotateCanvas(90);               break;
            case "rotate-ccw": rotateCanvas(-90);              break;
            case "flip-h":     flipCanvas("h");                break;
            case "flip-v":     flipCanvas("v");                break;
            case "auto-select-border": autoSelectBorder();     break;
            case "remove-bg":  removeBackground();             break;
            case "resize":     openResizeModal();              break;
            case "crop":       cropToSelection();              break;
            case "zoom-fit":   zoomFit();                      break;
            case "zoom-100":   setZoom(1);                     break;
            case "zoom-in":    setZoom(nextZoomLevel(state.zoom));  break;
            case "zoom-out":   setZoom(prevZoomLevel(state.zoom)); break;
            case "save-as":    openSaveAsModal();              break;
        }
    }

    // ── 캔버스 이벤트 ─────────────────────────────────────────────────────
    function bindCanvasEvents() {
        if (canvasAlreadyBound) return;
        canvasAlreadyBound = true;
        if (!overlayCanvas) return;

        overlayCanvas.style.pointerEvents = "all";
        overlayCanvas.style.cursor = "crosshair";

        overlayCanvas.addEventListener("pointerdown",  onPointerDown);
        overlayCanvas.addEventListener("pointermove",  onPointerMove);
        overlayCanvas.addEventListener("pointerup",    onPointerUp);
        overlayCanvas.addEventListener("pointerleave", onPointerLeave);
        overlayCanvas.addEventListener("pointercancel", onPointerCancel);
        overlayCanvas.addEventListener("auxclick", function (e) {
            if (e.button === 1) e.preventDefault();
        });

        boundContextMenu = function (e) { e.preventDefault(); };
        overlayCanvas.addEventListener("contextmenu", boundContextMenu);

        if (canvasArea) {
            boundWheel = function (e) {
                e.preventDefault();
                setZoom(state.zoom * (e.deltaY < 0 ? 1.15 : (1 / 1.15)));
            };
            canvasArea.addEventListener("wheel", boundWheel, { passive: false });
        }

        overlayCanvas.addEventListener("mousemove", function (e) {
            var pos = clientToCanvas(e.clientX, e.clientY);
            if (coordsDisplay) coordsDisplay.textContent = "X: " + pos.x + ", Y: " + pos.y;
        });
        overlayCanvas.addEventListener("mouseleave", function () {
            if (coordsDisplay) coordsDisplay.textContent = "X: -, Y: -";
        });
    }

    function clientToCanvas(clientX, clientY) {
        var rect = mainCanvas.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(state.canvasWidth  - 1, Math.floor((clientX - rect.left) / state.zoom))),
            y: Math.max(0, Math.min(state.canvasHeight - 1, Math.floor((clientY - rect.top)  / state.zoom))),
        };
    }

    function onPointerDown(e) {
        if (!mainCanvas) return;
        if (state.backgroundRemoveRunning) {
            e.preventDefault();
            return;
        }
        if (e.button === 1) {
            e.preventDefault();
            beginCanvasPan(e);
            return;
        }
        if (e.button === 2) {
            e.preventDefault();
            handleRightPointerDown(e);
            return;
        }
        overlayCanvas.setPointerCapture(e.pointerId);
        var pos = clientToCanvas(e.clientX, e.clientY);
        var useSecondary = false;

        state.isDrawing  = true;
        state.drawStartX = pos.x;
        state.drawStartY = pos.y;
        state.lastX = pos.x;
        state.lastY = pos.y;

        var tool = state.activeTool;

        if (tool === "pencil" || tool === "brush") {
            beginStroke(pos.x, pos.y, useSecondary);
        } else if (tool === "eraser") {
            beginErase(pos.x, pos.y);
        } else if (tool === "fill") {
            state.isDrawing = false;
            floodFill(pos.x, pos.y, useSecondary ? state.secondaryColor : state.primaryColor);
        } else if (tool === "eyedropper") {
            state.isDrawing = false;
            pickColor(pos.x, pos.y, useSecondary);
        } else if (tool === "text") {
            state.isDrawing = false;
            if (state.textOverlayActive) commitTextOverlay();
            else activateTextOverlay(pos.x, pos.y);
        } else if (tool === "select-free") {
            state.isDrawing = false;
            handleFreeSelectClick(pos.x, pos.y, e.detail >= 2);
        } else if (tool === "select-rect") {
            // 기존 선택 영역 안쪽 클릭 → 드래그 이동
            if (state.selection && state.selection.w > 0 && isInsideSelection(pos.x, pos.y)) {
                if (!state.selectionFloating) liftSelection();
                state.selectionDragging = true;
                state.selectionDragOffsetX = pos.x - state.selection.x;
                state.selectionDragOffsetY = pos.y - state.selection.y;
            } else {
                if (state.selectionFloating) flattenFloatingSelection();
                clearSelection();
                beginSelectRect(pos.x, pos.y);
            }
        } else {
            beginShape(pos.x, pos.y, useSecondary);
        }
    }

    function handleRightPointerDown(e) {
        overlayCanvas.setPointerCapture(e.pointerId);
        var pos = clientToCanvas(e.clientX, e.clientY);
        if (state.textOverlayActive) commitTextOverlay();
        setActiveTool("select-rect");
        state.isDrawing = true;
        state.drawStartX = pos.x;
        state.drawStartY = pos.y;
        state.lastX = pos.x;
        state.lastY = pos.y;
        if (state.selection && state.selection.w > 0 && isInsideSelection(pos.x, pos.y)) {
            if (!state.selectionFloating) liftSelection();
            state.selectionDragging = true;
            state.selectionDragOffsetX = pos.x - state.selection.x;
            state.selectionDragOffsetY = pos.y - state.selection.y;
            return;
        }
        if (state.selectionFloating) flattenFloatingSelection();
        clearSelection();
        beginSelectRect(pos.x, pos.y);
    }

    function onPointerMove(e) {
        if (state.panDragging) {
            continueCanvasPan(e);
            return;
        }
        if ((!state.isDrawing && !state.freeSelectBuilding) || state.backgroundRemoveRunning) return;
        var pos = clientToCanvas(e.clientX, e.clientY);
        var tool = state.activeTool;

        if (tool === "select-free" && state.freeSelectBuilding) {
            continueSelectFree(pos.x, pos.y);
        } else if (state.selectionDragging && state.selection) {
            // 선택 영역 이동
            var dx = pos.x - state.lastX;
            var dy = pos.y - state.lastY;
            state.selection.x += dx;
            state.selection.y += dy;
            if (state.freeSelectPath) {
                state.freeSelectPath = state.freeSelectPath.map(function (p) {
                    return [p[0] + dx, p[1] + dy];
                });
            }
            if (state.selectionMask) {
                state.selectionMask.x += dx;
                state.selectionMask.y += dy;
            }
        } else if (tool === "pencil" || tool === "brush") {
            continueStroke(pos.x, pos.y);
        } else if (tool === "eraser") {
            continueErase(pos.x, pos.y);
        } else if (tool === "select-rect") {
            continueSelectRect(pos.x, pos.y);
        } else if (isShapeTool(tool)) {
            previewShape(pos.x, pos.y);
        }

        state.lastX = pos.x;
        state.lastY = pos.y;
    }

    function onPointerUp(e) {
        if (state.panDragging) {
            endCanvasPan(e);
            return;
        }
        if (!state.isDrawing || state.backgroundRemoveRunning) return;
        state.isDrawing = false;
        var pos = clientToCanvas(e.clientX, e.clientY);
        var tool = state.activeTool;

        if (state.selectionDragging) {
            state.selectionDragging = false;
            // 이동 완료 — floating 상태 유지, 계속 이동 가능
        } else if (tool === "pencil" || tool === "brush") {
            endStroke();
        } else if (tool === "eraser") {
            endErase();
        } else if (tool === "select-rect") {
            endSelectRect(pos.x, pos.y);
        } else if (isShapeTool(tool)) {
            commitShape(pos.x, pos.y, e.button === 2);
        }
    }

    function onPointerLeave(e) {
        if (state.panDragging) return;
        if (state.isDrawing) onPointerUp(e);
    }

    function onPointerCancel(e) {
        if (state.panDragging) endCanvasPan(e);
    }

    function beginCanvasPan(e) {
        if (!canvasArea || !overlayCanvas) return;
        overlayCanvas.setPointerCapture(e.pointerId);
        state.panDragging = true;
        state.isDrawing = false;
        state.selectionDragging = false;
        state.panStartClientX = e.clientX;
        state.panStartClientY = e.clientY;
        state.panStartScrollLeft = canvasArea.scrollLeft;
        state.panStartScrollTop = canvasArea.scrollTop;
        canvasArea.classList.add("is-panning");
    }

    function continueCanvasPan(e) {
        if (!canvasArea) return;
        e.preventDefault();
        canvasArea.scrollLeft = state.panStartScrollLeft - (e.clientX - state.panStartClientX);
        canvasArea.scrollTop = state.panStartScrollTop - (e.clientY - state.panStartClientY);
    }

    function endCanvasPan(e) {
        if (overlayCanvas && e && typeof e.pointerId !== "undefined") {
            try { overlayCanvas.releasePointerCapture(e.pointerId); } catch (err) { /* 이미 해제된 경우 무시 */ }
        }
        state.panDragging = false;
        if (canvasArea) canvasArea.classList.remove("is-panning");
    }

    function isShapeTool(tool) {
        return ["line","rect","rounded-rect","ellipse","triangle","diamond","arrow","star"].indexOf(tool) >= 0;
    }

    // ── 연필 / 브러시 ─────────────────────────────────────────────────────
    function beginStroke(x, y, useSecondary) {
        mainCtx.save();
        mainCtx.globalAlpha = 1.0;
        mainCtx.strokeStyle = useSecondary ? state.secondaryColor : state.primaryColor;
        mainCtx.lineWidth   = state.brushSize;
        mainCtx.lineCap     = "round";
        mainCtx.lineJoin    = "round";
        mainCtx.beginPath();
        mainCtx.moveTo(x, y);
        if (state.activeTool === "brush" && state.brushSize > 2) {
            mainCtx.shadowBlur  = state.brushSize * 0.6;
            mainCtx.shadowColor = useSecondary ? state.secondaryColor : state.primaryColor;
        }
    }

    function continueStroke(x, y) {
        mainCtx.lineTo(x, y);
        mainCtx.stroke();
        mainCtx.beginPath();
        mainCtx.moveTo(x, y);
    }

    function endStroke() {
        mainCtx.shadowBlur = 0;
        mainCtx.restore();
        commitHistoryState();
    }

    // ── 지우개 ────────────────────────────────────────────────────────────
    function beginErase(x, y) { drawEraser(x, y); }

    function continueErase(x, y) {
        var dx = x - state.lastX, dy = y - state.lastY;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var steps = Math.max(1, Math.floor(dist / (state.eraserSize / 4)));
        for (var i = 1; i <= steps; i++) {
            drawEraser(state.lastX + dx * (i / steps), state.lastY + dy * (i / steps));
        }
    }

    function drawEraser(x, y) {
        var r = state.eraserSize / 2;
        if (state.eraserMode === "transparent") {
            mainCtx.save();
            mainCtx.globalCompositeOperation = "destination-out";
            mainCtx.fillStyle = "rgba(0,0,0,1)";
            mainCtx.beginPath();
            mainCtx.arc(x, y, r, 0, Math.PI * 2);
            mainCtx.fill();
            mainCtx.restore();
        } else {
            mainCtx.fillStyle = state.secondaryColor;
            mainCtx.beginPath();
            mainCtx.arc(x, y, r, 0, Math.PI * 2);
            mainCtx.fill();
        }
    }

    function endErase() { commitHistoryState(); }

    // ── 색 선택 ───────────────────────────────────────────────────────────
    function pickColor(x, y, useSecondary) {
        var px = mainCtx.getImageData(x, y, 1, 1).data;
        var hex = "#" + byteHex(px[0]) + byteHex(px[1]) + byteHex(px[2]);
        if (useSecondary) setSecondaryColor(hex);
        else              setPrimaryColor(hex);
    }

    function byteHex(n) { return ("0" + n.toString(16)).slice(-2); }

    // ── 채우기 ────────────────────────────────────────────────────────────
    function floodFill(startX, startY, fillColor) {
        var imageData = mainCtx.getImageData(0, 0, state.canvasWidth, state.canvasHeight);
        var data = imageData.data;
        var w = state.canvasWidth, h = state.canvasHeight;
        var idx = (startY * w + startX) * 4;
        var tr = data[idx], tg = data[idx+1], tb = data[idx+2], ta = data[idx+3];
        var fill = hexToRGBA(fillColor);
        if (tr === fill[0] && tg === fill[1] && tb === fill[2] && ta === fill[3]) return;
        var stack = [[startX, startY]];
        var visited = new Uint8Array(w * h);
        while (stack.length) {
            var pt = stack.pop();
            var cx = pt[0], cy = pt[1];
            if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;
            var pi = cy * w + cx;
            if (visited[pi]) continue;
            var di = pi * 4;
            if (data[di] !== tr || data[di+1] !== tg || data[di+2] !== tb || data[di+3] !== ta) continue;
            visited[pi] = 1;
            data[di] = fill[0]; data[di+1] = fill[1]; data[di+2] = fill[2]; data[di+3] = fill[3];
            stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
        }
        mainCtx.putImageData(imageData, 0, 0);
        commitHistoryState();
    }

    function hexToRGBA(hex) {
        return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16), 255];
    }

    // ── 텍스트 ────────────────────────────────────────────────────────────
    function activateTextOverlay(canvasX, canvasY) {
        if (!textOverlay || !canvasWrap) return;
        state.textOverlayActive = true;
        state.textX = canvasX;
        state.textY = canvasY;
        textOverlay.style.left     = canvasX + "px";
        textOverlay.style.top      = (canvasY - state.textSize) + "px";
        textOverlay.style.fontSize = state.textSize + "px";
        textOverlay.style.color    = state.primaryColor;
        textOverlay.hidden = false;
        textOverlay.value  = "";
        textOverlay.focus();
    }

    function commitTextOverlay() {
        if (!state.textOverlayActive || !textOverlay) return;
        var lines = textOverlay.value.split("\n");
        mainCtx.save();
        mainCtx.font      = (state.textItalic ? "italic " : "") + (state.textBold ? "bold " : "") + state.textSize + "px sans-serif";
        mainCtx.fillStyle = state.primaryColor;
        mainCtx.textBaseline = "top";
        var lineH = state.textSize * 1.3;
        lines.forEach(function (line, i) {
            mainCtx.fillText(line, state.textX, state.textY + i * lineH);
        });
        mainCtx.restore();
        textOverlay.hidden = true;
        textOverlay.value  = "";
        state.textOverlayActive = false;
        commitHistoryState();
    }

    // ── 선택 도구 ─────────────────────────────────────────────────────────

    // 점이 선택 영역 안에 있는지 확인 (폴리곤 또는 사각형)
    function isInsideSelection(x, y) {
        if (!state.selection) return false;
        var s = state.selection;
        if (x < s.x || x > s.x + s.w || y < s.y || y > s.y + s.h) return false;
        if (state.selectionMask) {
            return isInsideSelectionMask(x, y);
        }
        if (state.freeSelectPath && state.freeSelectPath.length > 2) {
            return pointInPolygon(x, y, state.freeSelectPath);
        }
        return true;
    }

    function isInsideSelectionMask(x, y) {
        var mask = state.selectionMask;
        if (!mask) return false;
        var mx = Math.floor(x - mask.x);
        var my = Math.floor(y - mask.y);
        if (mx < 0 || my < 0 || mx >= mask.w || my >= mask.h) return false;
        return Boolean(mask.data[my * mask.w + mx]);
    }

    function pointInPolygon(x, y, polygon) {
        var inside = false;
        var j = polygon.length - 1;
        for (var i = 0; i < polygon.length; i++) {
            var xi = polygon[i][0], yi = polygon[i][1];
            var xj = polygon[j][0], yj = polygon[j][1];
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
            j = i;
        }
        return inside;
    }

    // 선택 영역을 캔버스에서 들어올리기 (폴리곤 클리핑 지원)
    function liftSelection() {
        if (!state.selection || state.selectionFloating) return;
        var s = state.selection;
        var tmp = document.createElement("canvas");
        tmp.width = s.w; tmp.height = s.h;
        var tmpCtx = tmp.getContext("2d");
        var hasPoly = state.freeSelectPath && state.freeSelectPath.length > 2;

        tmpCtx.drawImage(mainCanvas, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
        if (hasPoly) applyPolygonMaskToCanvas(tmpCtx, s.w, s.h, state.freeSelectPath, s.x, s.y);
        if (state.selectionMask) applySelectionMaskToCanvas(tmpCtx, s.w, s.h);
        state.selectionImageData = tmpCtx.getImageData(0, 0, s.w, s.h);

        clearSelectionAreaToTransparent(s, hasPoly ? state.freeSelectPath : null, state.selectionMask);

        state.selectionFloating = true;
    }

    function beginSelectRect(x, y) {
        state.freeSelectPath = null;
        state.selectionMask = null;
        state.selection = { x: x, y: y, w: 0, h: 0 };
    }

    function continueSelectRect(x, y) {
        var x0 = state.drawStartX, y0 = state.drawStartY;
        state.selection = {
            x: Math.min(x0, x), y: Math.min(y0, y),
            w: Math.abs(x - x0), h: Math.abs(y - y0),
        };
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        drawSelectionBorder(overlayCtx, state.selection, null, state.marchingAntsOffset);
    }

    function endSelectRect(x, y) {
        continueSelectRect(x, y);
        if (state.selection && state.selection.w > 0 && state.selection.h > 0) {
            startMarchingAnts();
        } else {
            clearSelection();
        }
    }

    function handleFreeSelectClick(x, y, shouldClose) {
        if (state.freeSelectBuilding) {
            if (shouldClose || isNearFreeSelectStart(x, y)) {
                endSelectFree();
                return;
            }
            addFreeSelectPoint(x, y);
            return;
        }

        if (state.selection && state.selection.w > 0 && isInsideSelection(x, y)) {
            if (!state.selectionFloating) liftSelection();
            state.isDrawing = true;
            state.selectionDragging = true;
            state.selectionDragOffsetX = x - state.selection.x;
            state.selectionDragOffsetY = y - state.selection.y;
            state.lastX = x;
            state.lastY = y;
            return;
        }

        if (state.selectionFloating) flattenFloatingSelection();
        clearSelection();
        beginSelectFree(x, y);
    }

    function beginSelectFree(x, y) {
        state.freeSelectPath = null;
        state.selectionMask = null;
        state.freeSelectPoints = [[x, y]];
        state.freeSelectBuilding = true;
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        drawFreeSelectPreview(x, y);
    }

    function addFreeSelectPoint(x, y) {
        state.freeSelectPoints.push([x, y]);
        drawFreeSelectPreview(x, y);
    }

    function continueSelectFree(x, y) {
        if (!state.freeSelectBuilding) return;
        drawFreeSelectPreview(x, y);
    }

    function drawFreeSelectPreview(x, y) {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        if (!state.freeSelectPoints.length) return;
        var lineWidth = screenPxToCanvasPx(1);
        var dashSize = screenPxToCanvasPx(4);
        var pointRadius = screenPxToCanvasPx(3.5);
        overlayCtx.save();
        overlayCtx.beginPath();
        overlayCtx.setLineDash([dashSize, dashSize]);
        overlayCtx.strokeStyle = "#000";
        overlayCtx.lineWidth = lineWidth;
        state.freeSelectPoints.forEach(function (p, i) {
            if (i === 0) overlayCtx.moveTo(p[0], p[1]);
            else overlayCtx.lineTo(p[0], p[1]);
        });
        if (state.freeSelectPoints.length) overlayCtx.lineTo(x, y);
        overlayCtx.stroke();
        overlayCtx.setLineDash([]);
        state.freeSelectPoints.forEach(function (p, i) {
            overlayCtx.beginPath();
            overlayCtx.fillStyle = i === 0 ? "#fff" : "#000";
            overlayCtx.strokeStyle = "#000";
            overlayCtx.lineWidth = lineWidth;
            overlayCtx.arc(p[0], p[1], pointRadius, 0, Math.PI * 2);
            overlayCtx.fill();
            overlayCtx.stroke();
        });
        overlayCtx.setLineDash([]);
        overlayCtx.restore();
    }

    function isNearFreeSelectStart(x, y) {
        if (!state.freeSelectPoints.length || state.freeSelectPoints.length < 3) return false;
        var first = state.freeSelectPoints[0];
        var dx = x - first[0];
        var dy = y - first[1];
        var threshold = Math.max(6, 8 / Math.max(0.25, state.zoom));
        return dx * dx + dy * dy <= threshold * threshold;
    }

    function endSelectFree() {
        if (state.freeSelectPoints.length < 3) { cancelFreeSelectBuild(); return; }
        // 폴리곤 경로 보존 (사각형으로 변환하지 않음)
        var pts = state.freeSelectPoints.slice();
        state.freeSelectPath = pts;
        state.freeSelectPoints = [];
        state.freeSelectBuilding = false;

        var xs = pts.map(function (p) { return p[0]; });
        var ys = pts.map(function (p) { return p[1]; });
        state.selection = {
            x: Math.min.apply(null, xs), y: Math.min.apply(null, ys),
            w: Math.max.apply(null, xs) - Math.min.apply(null, xs),
            h: Math.max.apply(null, ys) - Math.min.apply(null, ys),
        };

        if (state.selection.w > 0 && state.selection.h > 0) {
            startMarchingAnts();
        } else {
            clearSelection();
        }
    }

    function cancelFreeSelectBuild() {
        state.freeSelectPoints = [];
        state.freeSelectBuilding = false;
        if (overlayCtx) overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }

    function clearSelection() {
        state.selection = null;
        state.selectionMask = null;
        state.selectionImageData = null;
        state.selectionFloating  = false;
        state.selectionDragging  = false;
        state.freeSelectPoints   = [];
        state.freeSelectBuilding = false;
        state.freeSelectPath     = null;
        if (state.marchingRafId) {
            cancelAnimationFrame(state.marchingRafId);
            state.marchingRafId = null;
        }
        if (overlayCtx) overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }

    function flattenFloatingSelection() {
        if (!state.selectionFloating || !state.selectionImageData || !state.selection) return;
        drawImageDataSkippingTransparent(mainCtx, state.selectionImageData, state.selection.x, state.selection.y);
        state.selectionFloating  = false;
        state.selectionImageData = null;
        state.selectionMask = null;
        commitHistoryState();
    }

    function drawImageDataSkippingTransparent(ctx, imageData, x, y) {
        var targetX = Math.floor(x);
        var targetY = Math.floor(y);
        var srcW = imageData.width;
        var srcH = imageData.height;
        var dstX = Math.max(0, targetX);
        var dstY = Math.max(0, targetY);
        var srcX = Math.max(0, -targetX);
        var srcY = Math.max(0, -targetY);
        var copyW = Math.min(srcW - srcX, state.canvasWidth - dstX);
        var copyH = Math.min(srcH - srcY, state.canvasHeight - dstY);
        if (copyW <= 0 || copyH <= 0) return;

        var dst = ctx.getImageData(dstX, dstY, copyW, copyH);
        var srcData = imageData.data;
        var dstData = dst.data;
        for (var row = 0; row < copyH; row++) {
            for (var col = 0; col < copyW; col++) {
                var srcIdx = ((srcY + row) * srcW + (srcX + col)) * 4;
                if (srcData[srcIdx + 3] <= 1) continue;
                var dstIdx = (row * copyW + col) * 4;
                dstData[dstIdx] = srcData[srcIdx];
                dstData[dstIdx + 1] = srcData[srcIdx + 1];
                dstData[dstIdx + 2] = srcData[srcIdx + 2];
                dstData[dstIdx + 3] = srcData[srcIdx + 3];
            }
        }
        ctx.putImageData(dst, dstX, dstY);
    }

    function selectAll() {
        state.freeSelectPath = null;
        state.selection = { x: 0, y: 0, w: state.canvasWidth, h: state.canvasHeight };
        startMarchingAnts();
    }

    function autoSelectBorder() {
        if (!mainCtx || !state.canvasWidth || !state.canvasHeight) return;
        if (state.selectionFloating) flattenFloatingSelection();
        var imageData = mainCtx.getImageData(0, 0, state.canvasWidth, state.canvasHeight);
        var data = imageData.data;
        var hasTransparency = false;
        for (var ai = 3; ai < data.length; ai += 4) {
            if (data[ai] < 250) {
                hasTransparency = true;
                break;
            }
        }

        var width = state.canvasWidth;
        var height = state.canvasHeight;
        var bg = getCanvasEdgeBackgroundColor(data, width, height);
        var foreground = new Uint8Array(width * height);
        var minX = state.canvasWidth, minY = state.canvasHeight, maxX = -1, maxY = -1;
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var pixelIndex = y * width + x;
                var idx = pixelIndex * 4;
                var isForeground = hasTransparency
                    ? data[idx + 3] > 12
                    : colorDistanceSq(data[idx], data[idx + 1], data[idx + 2], bg[0], bg[1], bg[2]) > 34 * 34;
                if (!isForeground) continue;
                foreground[pixelIndex] = 1;
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }

        if (maxX < minX || maxY < minY) {
            window.alert(getEditorText("image_editor_auto_select_border_empty", "선택할 테두리를 찾을 수 없습니다."));
            return;
        }
        var borderPath = traceForegroundBorder(foreground, width, height, minX, minY, maxX, maxY);
        state.freeSelectPath = borderPath.length > 2 ? borderPath : null;
        state.selectionMask = createSelectionMaskFromForeground(foreground, width, minX, minY, maxX, maxY);
        state.selection = {
            x: minX,
            y: minY,
            w: Math.max(1, maxX - minX + 1),
            h: Math.max(1, maxY - minY + 1),
        };
        startMarchingAnts();
    }

    function traceForegroundBorder(foreground, width, height, minX, minY, maxX, maxY) {
        var leftEdge = [];
        var rightEdge = [];
        for (var y = minY; y <= maxY; y++) {
            var left = -1;
            var right = -1;
            for (var x = minX; x <= maxX; x++) {
                if (!foreground[y * width + x]) continue;
                if (left < 0) left = x;
                right = x;
            }
            if (left < 0) continue;
            leftEdge.push([left, y]);
            rightEdge.push([right + 1, y]);
        }
        if (!leftEdge.length) return [];
        rightEdge.reverse();
        return simplifyPolygonPath(leftEdge.concat(rightEdge), 1.5);
    }

    function createSelectionMaskFromForeground(foreground, width, minX, minY, maxX, maxY) {
        var maskW = Math.max(1, maxX - minX + 1);
        var maskH = Math.max(1, maxY - minY + 1);
        var maskData = new Uint8Array(maskW * maskH);
        for (var y = 0; y < maskH; y++) {
            for (var x = 0; x < maskW; x++) {
                maskData[y * maskW + x] = foreground[(minY + y) * width + (minX + x)] ? 1 : 0;
            }
        }
        return { x: minX, y: minY, w: maskW, h: maskH, data: maskData };
    }

    function simplifyPolygonPath(points, tolerance) {
        if (points.length <= 4) return points;
        var simplified = [points[0]];
        for (var i = 1; i < points.length - 1; i++) {
            var prev = simplified[simplified.length - 1];
            var current = points[i];
            var next = points[i + 1];
            var sameDirection =
                Math.abs((current[0] - prev[0]) * (next[1] - current[1]) - (current[1] - prev[1]) * (next[0] - current[0])) <= tolerance;
            if (!sameDirection) simplified.push(current);
        }
        simplified.push(points[points.length - 1]);
        return simplified;
    }

    function getCanvasEdgeBackgroundColor(data, width, height) {
        var samples = [];
        var sampleSize = Math.min(12, width, height);
        function addSample(x, y) {
            var idx = (y * width + x) * 4;
            samples.push([data[idx], data[idx + 1], data[idx + 2]]);
        }
        for (var i = 0; i < sampleSize; i++) {
            addSample(i, 0);
            addSample(width - 1 - i, 0);
            addSample(i, height - 1);
            addSample(width - 1 - i, height - 1);
            addSample(0, i);
            addSample(width - 1, i);
            addSample(0, height - 1 - i);
            addSample(width - 1, height - 1 - i);
        }
        var r = 0, g = 0, b = 0;
        samples.forEach(function (sample) {
            r += sample[0]; g += sample[1]; b += sample[2];
        });
        var count = Math.max(1, samples.length);
        return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
    }

    function colorDistanceSq(r1, g1, b1, r2, g2, b2) {
        var dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
        return dr * dr + dg * dg + db * db;
    }

    function applySelectionMaskToCanvas(ctx, width, height) {
        if (!state.selectionMask) return;
        var mask = state.selectionMask;
        var imageData = ctx.getImageData(0, 0, width, height);
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                if (x < mask.w && y < mask.h && mask.data[y * mask.w + x]) continue;
                imageData.data[(y * width + x) * 4 + 3] = 0;
            }
        }
        ctx.putImageData(imageData, 0, 0);
    }

    function applyPolygonMaskToCanvas(ctx, width, height, polyPath, offsetX, offsetY) {
        if (!polyPath || polyPath.length <= 2) return;
        var imageData = ctx.getImageData(0, 0, width, height);
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                if (pointInPolygon(offsetX + x + 0.5, offsetY + y + 0.5, polyPath)) continue;
                imageData.data[(y * width + x) * 4 + 3] = 0;
            }
        }
        ctx.putImageData(imageData, 0, 0);
    }

    function clearSelectionAreaToTransparent(selection, polyPath, mask) {
        if (!selection) return;
        if (mask) {
            clearSelectionMaskToTransparent(selection, mask);
            return;
        }
        if (polyPath && polyPath.length > 2) {
            clearSelectionPolygonToTransparent(selection, polyPath);
            return;
        }
        mainCtx.save();
        mainCtx.clearRect(selection.x, selection.y, selection.w, selection.h);
        mainCtx.restore();
        state.forcePngOnSave = true;
        setDirty(true);
    }

    function clearSelectionPolygonToTransparent(selection, polyPath) {
        var s = selection;
        var imageData = mainCtx.getImageData(s.x, s.y, s.w, s.h);
        for (var y = 0; y < s.h; y++) {
            for (var x = 0; x < s.w; x++) {
                if (!pointInPolygon(s.x + x + 0.5, s.y + y + 0.5, polyPath)) continue;
                imageData.data[(y * s.w + x) * 4 + 3] = 0;
            }
        }
        mainCtx.putImageData(imageData, s.x, s.y);
        state.forcePngOnSave = true;
        setDirty(true);
    }

    function clearSelectionMaskToTransparent(selection, mask) {
        if (!selection || !mask) return;
        var s = selection;
        var imageData = mainCtx.getImageData(s.x, s.y, s.w, s.h);
        for (var y = 0; y < s.h; y++) {
            for (var x = 0; x < s.w; x++) {
                if (!mask.data[y * mask.w + x]) continue;
                var idx = (y * s.w + x) * 4;
                imageData.data[idx + 3] = 0;
            }
        }
        mainCtx.putImageData(imageData, s.x, s.y);
        state.forcePngOnSave = true;
        setDirty(true);
    }

    // 복사 (시스템 클립보드 + 내부 클립보드)
    function copySelection() {
        if (!state.selection || state.selection.w <= 0) return;
        var s = state.selection;
        var tmp = document.createElement("canvas");
        tmp.width = s.w; tmp.height = s.h;
        var tmpCtx = tmp.getContext("2d");
        var hasPoly = state.freeSelectPath && state.freeSelectPath.length > 2;

        tmpCtx.drawImage(mainCanvas, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
        if (hasPoly) applyPolygonMaskToCanvas(tmpCtx, s.w, s.h, state.freeSelectPath, s.x, s.y);
        if (state.selectionMask) applySelectionMaskToCanvas(tmpCtx, s.w, s.h);

        state.selectionImageData = tmpCtx.getImageData(0, 0, s.w, s.h);

        // 시스템 클립보드에 복사
        if (navigator.clipboard && navigator.clipboard.write) {
            tmp.toBlob(function (blob) {
                try {
                    navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
                } catch (err) { /* 권한 없을 때 무시 */ }
            }, "image/png");
        }
    }

    function cutSelection() {
        if (!state.selection || state.selection.w <= 0) return;
        copySelection();
        var s = state.selection;
        clearSelectionAreaToTransparent(s, state.freeSelectPath, state.selectionMask);
        clearSelection();
        commitHistoryState();
    }

    // 붙여넣기 (시스템 클립보드 우선)
    function pasteSelection() {
        if (navigator.clipboard && navigator.clipboard.read) {
            navigator.clipboard.read().then(function (items) {
                var found = false;
                for (var i = 0; i < items.length; i++) {
                    var types = items[i].types;
                    var imgType = null;
                    for (var j = 0; j < types.length; j++) {
                        if (types[j].startsWith("image/")) { imgType = types[j]; break; }
                    }
                    if (imgType) {
                        found = true;
                        (function (item, type) {
                            item.getType(type).then(function (blob) {
                                var url = URL.createObjectURL(blob);
                                var img = new Image();
                                img.onload = function () {
                                    var c = document.createElement("canvas");
                                    c.width = img.width; c.height = img.height;
                                    c.getContext("2d").drawImage(img, 0, 0);
                                    var pastedImageData = c.getContext("2d").getImageData(0, 0, img.width, img.height);
                                    URL.revokeObjectURL(url);
                                    pasteSelectionInternal(pastedImageData);
                                };
                                img.src = url;
                            }).catch(function () { pasteSelectionInternal(); });
                        })(items[i], imgType);
                        break;
                    }
                }
                if (!found) pasteSelectionInternal();
            }).catch(function () { pasteSelectionInternal(); });
        } else {
            pasteSelectionInternal();
        }
    }

    function pasteSelectionInternal(imageData) {
        var pastedImageData = imageData || state.selectionImageData;
        if (!pastedImageData) return;
        flattenFloatingSelection();
        state.freeSelectPath = null;
        state.selectionImageData = pastedImageData;
        var iw = pastedImageData.width;
        var ih = pastedImageData.height;
        state.selection = {
            x: Math.max(0, Math.floor((state.canvasWidth  - iw) / 2)),
            y: Math.max(0, Math.floor((state.canvasHeight - ih) / 2)),
            w: iw, h: ih,
        };
        state.selectionFloating = true;
        startMarchingAnts();
    }

    function deleteSelection() {
        if (!state.selection || state.selection.w <= 0) return;
        var s = state.selection;
        clearSelectionAreaToTransparent(s, state.freeSelectPath, state.selectionMask);
        clearSelection();
        commitHistoryState();
    }

    // ── Marching Ants (사각형 + 폴리곤 지원) ─────────────────────────────
    function startMarchingAnts() {
        if (state.marchingRafId) cancelAnimationFrame(state.marchingRafId);
        function tick() {
            if (!state.selection) return;
            overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            if (state.selectionFloating && state.selectionImageData) {
                overlayCtx.putImageData(state.selectionImageData, state.selection.x, state.selection.y);
            }
            drawSelectionBorder(overlayCtx, state.selection, state.freeSelectPath, state.marchingAntsOffset);
            state.marchingAntsOffset = (state.marchingAntsOffset + 1) % 16;
            state.marchingRafId = requestAnimationFrame(tick);
        }
        state.marchingRafId = requestAnimationFrame(tick);
    }

    function drawSelectionBorder(ctx, sel, polyPath, offset) {
        if (!sel || sel.w <= 0 || sel.h <= 0) return;
        var lineWidth = screenPxToCanvasPx(1);
        var dashSize = screenPxToCanvasPx(6);
        var dashOffset = screenPxToCanvasPx(offset);
        ctx.save();
        ctx.lineWidth = lineWidth;
        ctx.setLineDash([dashSize, dashSize]);

        if (polyPath && polyPath.length > 2) {
            // 폴리곤 marching ants
            function drawPoly(dashOff, color) {
                ctx.lineDashOffset = -dashOff;
                ctx.strokeStyle = color;
                ctx.beginPath();
                polyPath.forEach(function (p, i) {
                    if (i === 0) ctx.moveTo(p[0], p[1]);
                    else ctx.lineTo(p[0], p[1]);
                });
                ctx.closePath();
                ctx.stroke();
            }
            drawPoly(dashOffset, "#000");
            drawPoly(dashOffset - dashSize, "#fff");
        } else {
            // 사각형 marching ants
            ctx.lineDashOffset = -dashOffset;
            ctx.strokeStyle = "#000";
            ctx.strokeRect(sel.x + 0.5, sel.y + 0.5, sel.w, sel.h);
            ctx.lineDashOffset = -dashOffset + dashSize;
            ctx.strokeStyle = "#fff";
            ctx.strokeRect(sel.x + 0.5, sel.y + 0.5, sel.w, sel.h);
        }

        ctx.setLineDash([]);
        ctx.restore();
    }

    function screenPxToCanvasPx(value) {
        return value / Math.max(0.125, state.zoom || 1);
    }

    // ── 도형 도구 ─────────────────────────────────────────────────────────
    function beginShape(x, y, useSecondary) { state.shapeUseSecondary = useSecondary; }

    function previewShape(x, y) {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        renderShape(overlayCtx, state.activeTool,
            state.drawStartX, state.drawStartY, x, y,
            state.shapeUseSecondary ? state.secondaryColor : state.primaryColor,
            state.shapeMode, state.brushSize);
    }

    function commitShape(x, y, useSecondary) {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        renderShape(mainCtx, state.activeTool,
            state.drawStartX, state.drawStartY, x, y,
            (useSecondary || state.shapeUseSecondary) ? state.secondaryColor : state.primaryColor,
            state.shapeMode, state.brushSize);
        commitHistoryState();
    }

    function renderShape(ctx, tool, x1, y1, x2, y2, color, mode, lineW) {
        ctx.save();
        ctx.strokeStyle = color; ctx.fillStyle = color;
        ctx.lineWidth = lineW; ctx.lineCap = "round"; ctx.lineJoin = "round";
        var cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
        var rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
        ctx.beginPath();
        switch (tool) {
            case "line":
                ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); break;
            case "rect":
                if (mode === "filled" || mode === "both") ctx.fillRect(Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1));
                if (mode === "outline" || mode === "both") ctx.strokeRect(Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1));
                break;
            case "rounded-rect":
                var rr = Math.min(12, rx * 0.3, ry * 0.3);
                roundedRect(ctx, Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1), rr);
                if (mode === "filled" || mode === "both") ctx.fill();
                if (mode === "outline" || mode === "both") ctx.stroke();
                break;
            case "ellipse":
                ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
                if (mode === "filled" || mode === "both") ctx.fill();
                if (mode === "outline" || mode === "both") ctx.stroke();
                break;
            case "triangle":
                ctx.moveTo(cx, y1); ctx.lineTo(x2, y2); ctx.lineTo(x1, y2); ctx.closePath();
                if (mode === "filled" || mode === "both") ctx.fill();
                if (mode === "outline" || mode === "both") ctx.stroke();
                break;
            case "diamond":
                ctx.moveTo(cx, y1); ctx.lineTo(x2, cy); ctx.lineTo(cx, y2); ctx.lineTo(x1, cy); ctx.closePath();
                if (mode === "filled" || mode === "both") ctx.fill();
                if (mode === "outline" || mode === "both") ctx.stroke();
                break;
            case "arrow":
                drawArrow(ctx, x1, y1, x2, y2, lineW); ctx.stroke(); break;
            case "star":
                drawStar(ctx, cx, cy, rx, ry, 5);
                if (mode === "filled" || mode === "both") ctx.fill();
                if (mode === "outline" || mode === "both") ctx.stroke();
                break;
        }
        ctx.restore();
    }

    function roundedRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    }

    function drawArrow(ctx, x1, y1, x2, y2, lineW) {
        var angle = Math.atan2(y2 - y1, x2 - x1);
        var headLen = Math.max(lineW * 3, 12);
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI/6), y2 - headLen * Math.sin(angle - Math.PI/6));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI/6), y2 - headLen * Math.sin(angle + Math.PI/6));
    }

    function drawStar(ctx, cx, cy, rx, ry, points) {
        var step = Math.PI / points;
        ctx.beginPath();
        for (var i = 0; i < points * 2; i++) {
            var r = (i % 2 === 0) ? Math.max(rx, ry) : Math.max(rx, ry) * 0.4;
            var angle = i * step - Math.PI / 2;
            var sx = cx + r * Math.cos(angle) * (rx / Math.max(rx, ry));
            var sy = cy + r * Math.sin(angle) * (ry / Math.max(rx, ry));
            if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        }
        ctx.closePath();
    }

    // ── Undo / Redo ───────────────────────────────────────────────────────
    function commitHistoryState() {
        if (!mainCanvas) return;
        var snapshot = mainCtx.getImageData(0, 0, state.canvasWidth, state.canvasHeight);
        state.undoHistory.push(snapshot);
        if (state.undoHistory.length > state.MAX_UNDO) state.undoHistory.shift();
        state.redoHistory = [];
        setDirty(true);
    }

    function undoEditorChange() {
        if (state.undoHistory.length <= 1) return;
        var current = state.undoHistory.pop();
        state.redoHistory.push(current);
        var prev = state.undoHistory[state.undoHistory.length - 1];
        resizeCanvasTo(prev.width, prev.height);
        mainCtx.putImageData(prev, 0, 0);
        clearSelection();
        updateSizeDisplay();
    }

    function redoEditorChange() {
        if (!state.redoHistory.length) return;
        var next = state.redoHistory.pop();
        state.undoHistory.push(next);
        resizeCanvasTo(next.width, next.height);
        mainCtx.putImageData(next, 0, 0);
        clearSelection();
        updateSizeDisplay();
    }

    // ── 이미지 조작 ───────────────────────────────────────────────────────
    function rotateCanvas(degrees) {
        if (!mainCanvas) return;
        var tmp = document.createElement("canvas");
        var abs = Math.abs(degrees) % 360;
        if (abs === 90) { tmp.width = state.canvasHeight; tmp.height = state.canvasWidth; }
        else            { tmp.width = state.canvasWidth;  tmp.height = state.canvasHeight; }
        var ctx = tmp.getContext("2d");
        ctx.save();
        ctx.translate(tmp.width / 2, tmp.height / 2);
        ctx.rotate(degrees * Math.PI / 180);
        ctx.drawImage(mainCanvas, -state.canvasWidth / 2, -state.canvasHeight / 2);
        ctx.restore();
        resizeCanvasTo(tmp.width, tmp.height);
        mainCtx.drawImage(tmp, 0, 0);
        clearSelection();
        commitHistoryState();
        updateSizeDisplay();
    }

    function flipCanvas(axis) {
        if (!mainCanvas) return;
        var tmp = document.createElement("canvas");
        tmp.width = state.canvasWidth; tmp.height = state.canvasHeight;
        var ctx = tmp.getContext("2d");
        ctx.save();
        if (axis === "h") { ctx.translate(state.canvasWidth, 0); ctx.scale(-1, 1); }
        else              { ctx.translate(0, state.canvasHeight); ctx.scale(1, -1); }
        ctx.drawImage(mainCanvas, 0, 0);
        ctx.restore();
        mainCtx.clearRect(0, 0, state.canvasWidth, state.canvasHeight);
        mainCtx.drawImage(tmp, 0, 0);
        clearSelection();
        commitHistoryState();
    }

    function resizeCanvasTo(w, h) {
        state.canvasWidth  = w; state.canvasHeight = h;
        mainCanvas.width   = w; mainCanvas.height  = h;
        overlayCanvas.width = w; overlayCanvas.height = h;
    }

    function resizeCanvasContent(newW, newH) {
        if (!mainCanvas) return;
        newW = Math.max(1, newW); newH = Math.max(1, newH);
        var tmp = document.createElement("canvas");
        tmp.width = newW; tmp.height = newH;
        var ctx = tmp.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(mainCanvas, 0, 0, newW, newH);
        resizeCanvasTo(newW, newH);
        mainCtx.drawImage(tmp, 0, 0);
        clearSelection();
        commitHistoryState();
        updateSizeDisplay();
        setTimeout(zoomFit, 0);
    }

    function cropToSelection() {
        if (!state.selection || state.selection.w <= 0 || state.selection.h <= 0) return;
        flattenFloatingSelection();
        var s = state.selection;
        var cropped = mainCtx.getImageData(s.x, s.y, s.w, s.h);
        resizeCanvasTo(s.w, s.h);
        mainCtx.putImageData(cropped, 0, 0);
        clearSelection();
        commitHistoryState();
        updateSizeDisplay();
        setTimeout(zoomFit, 0);
    }

    // ── 캔버스 테두리 드래그 리사이즈 핸들 ───────────────────────────────
    function createResizeHandles() {
        if (!canvasWrap) return;
        ["n","ne","e","se","s","sw","w","nw"].forEach(function (pos) {
            var h = document.createElement("div");
            h.className = "ie-canvas-resize-handle ie-resize-handle--" + pos;
            h.dataset.handlePos = pos;
            h.addEventListener("pointerdown", onResizeHandleDown);
            canvasWrap.appendChild(h);
        });
    }

    function onResizeHandleDown(e) {
        e.preventDefault();
        e.stopPropagation();
        if (state.selectionFloating) flattenFloatingSelection();
        resizeDragging = true;
        resizeHandlePos = e.currentTarget.dataset.handlePos;
        resizeStartClientX = e.clientX;
        resizeStartClientY = e.clientY;
        resizeStartW = state.canvasWidth;
        resizeStartH = state.canvasHeight;
        resizeOriginalImageData = mainCtx.getImageData(0, 0, state.canvasWidth, state.canvasHeight);
        e.currentTarget.setPointerCapture(e.pointerId);

        resizeHandleBoundMove = function (ev) { onResizeHandleMove(ev); };
        resizeHandleBoundUp   = function (ev) { onResizeHandleUp(ev); };
        document.addEventListener("pointermove", resizeHandleBoundMove);
        document.addEventListener("pointerup",   resizeHandleBoundUp);
    }

    function onResizeHandleMove(e) {
        if (!resizeDragging) return;
        var dx = Math.round((e.clientX - resizeStartClientX) / state.zoom);
        var dy = Math.round((e.clientY - resizeStartClientY) / state.zoom);
        var pos = resizeHandlePos;

        var newW = resizeStartW, newH = resizeStartH;
        if (pos.indexOf("e") >= 0) newW = Math.max(1, resizeStartW + dx);
        if (pos.indexOf("w") >= 0) newW = Math.max(1, resizeStartW - dx);
        if (pos.indexOf("s") >= 0) newH = Math.max(1, resizeStartH + dy);
        if (pos.indexOf("n") >= 0) newH = Math.max(1, resizeStartH - dy);

        if (newW === state.canvasWidth && newH === state.canvasHeight) return;

        // 원래 크기로 복원 후 새 크기로 적용 (드래그 중 실시간 미리보기)
        resizeCanvasTo(resizeStartW, resizeStartH);
        mainCtx.putImageData(resizeOriginalImageData, 0, 0);
        applyCanvasResize(newW, newH, pos);
    }

    function onResizeHandleUp(e) {
        if (!resizeDragging) return;
        resizeDragging = false;
        resizeOriginalImageData = null;
        document.removeEventListener("pointermove", resizeHandleBoundMove);
        document.removeEventListener("pointerup",   resizeHandleBoundUp);
        resizeHandleBoundMove = resizeHandleBoundUp = null;
        commitHistoryState();
        updateSizeDisplay();
    }

    function applyCanvasResize(newW, newH, handlePos) {
        var oldW = state.canvasWidth, oldH = state.canvasHeight;
        var savedData = mainCtx.getImageData(0, 0, oldW, oldH);

        state.canvasWidth  = newW; state.canvasHeight = newH;
        mainCanvas.width   = newW; mainCanvas.height  = newH;
        overlayCanvas.width = newW; overlayCanvas.height = newH;

        // 새 영역을 배경색으로 채우기
        mainCtx.fillStyle = state.secondaryColor;
        mainCtx.fillRect(0, 0, newW, newH);

        // 기존 내용 배치 (N/W 핸들이면 오른쪽/아래쪽에 배치)
        var drawX = 0, drawY = 0;
        if (handlePos && handlePos.indexOf("w") >= 0) drawX = newW - oldW;
        if (handlePos && handlePos.indexOf("n") >= 0) drawY = newH - oldH;
        mainCtx.putImageData(savedData, drawX, drawY);
    }

    // ── 줌 ───────────────────────────────────────────────────────────────
    var ZOOM_LEVELS = [0.125, 0.25, 0.333, 0.5, 0.667, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

    function setZoom(newZoom) {
        state.zoom = Math.max(0.125, Math.min(8, newZoom));
        if (canvasWrap) {
            canvasWrap.style.transform = "scale(" + state.zoom + ")";
            canvasWrap.style.setProperty("--ie-inverse-zoom", String(1 / state.zoom));
        }
        if (zoomDisplay) zoomDisplay.textContent = Math.round(state.zoom * 100) + "%";
        if (canvasArea) canvasArea.classList.toggle("show-pixel-grid", state.zoom > 4);
    }

    function zoomFit() {
        if (!canvasArea || !state.canvasWidth) return;
        var areaW = canvasArea.clientWidth  - 32;
        var areaH = canvasArea.clientHeight - 32;
        if (areaW <= 0 || areaH <= 0) {
            // 레이아웃 미완료 시 재시도
            setTimeout(function () {
                var w = canvasArea.clientWidth  - 32;
                var h = canvasArea.clientHeight - 32;
                if (w > 0 && h > 0) setZoom(Math.min(w / state.canvasWidth, h / state.canvasHeight, 1));
            }, 50);
            return;
        }
        setZoom(Math.min(areaW / state.canvasWidth, areaH / state.canvasHeight, 1));
    }

    function nextZoomLevel(current) {
        for (var i = 0; i < ZOOM_LEVELS.length; i++) {
            if (ZOOM_LEVELS[i] > current + 0.001) return ZOOM_LEVELS[i];
        }
        return ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
    }

    function prevZoomLevel(current) {
        for (var i = ZOOM_LEVELS.length - 1; i >= 0; i--) {
            if (ZOOM_LEVELS[i] < current - 0.001) return ZOOM_LEVELS[i];
        }
        return ZOOM_LEVELS[0];
    }

    // ── 상태바 ───────────────────────────────────────────────────────────
    function updateSizeDisplay() {
        if (sizeDisplay) sizeDisplay.textContent = state.canvasWidth + " × " + state.canvasHeight + " px";
    }

    function setDirty(isDirty) {
        state.isDirty = isDirty;
        if (state.onDirtyChange) state.onDirtyChange(isDirty);
    }

    function getEditorText(key, fallback) {
        var script = document.getElementById("handrive-i18n");
        if (!script) return fallback;
        try {
            var data = JSON.parse(script.textContent || "{}");
            return data && data[key] ? data[key] : fallback;
        } catch (error) {
            return fallback;
        }
    }

    function getCsrfToken() {
        var meta = document.querySelector('meta[name="csrf-token"]');
        if (meta && meta.content) return meta.content;
        var input = document.querySelector('input[name="csrfmiddlewaretoken"]');
        return input ? input.value : "";
    }

    function setActionButtonBusy(action, busy) {
        var btn = document.querySelector('.ie-action-btn[data-action="' + action + '"]');
        if (!btn) return;
        btn.disabled = Boolean(busy);
        btn.classList.toggle("is-busy", Boolean(busy));
        btn.setAttribute("aria-busy", busy ? "true" : "false");
    }

    function setEditorBusy(busy) {
        if (!imageEditorSurface) return;
        imageEditorSurface.classList.toggle("is-processing", Boolean(busy));
        var overlay = imageEditorSurface.querySelector(".ie-processing-overlay");
        if (busy && !overlay) {
            overlay = document.createElement("div");
            overlay.className = "ie-processing-overlay";
            overlay.setAttribute("role", "status");
            overlay.setAttribute("aria-live", "polite");
            overlay.innerHTML = '<span class="ie-processing-spinner" aria-hidden="true"></span><span class="ie-processing-text">' +
                getEditorText("image_editor_remove_bg_processing", "배경제거 중...") +
                "</span>";
            imageEditorSurface.appendChild(overlay);
        }
        if (overlay) overlay.hidden = !busy;
    }

    function drawBlobToCanvas(blob, onDone) {
        var img = new Image();
        var objectUrl = URL.createObjectURL(blob);
        img.onload = function () {
            URL.revokeObjectURL(objectUrl);
            state.canvasWidth = img.naturalWidth || img.width;
            state.canvasHeight = img.naturalHeight || img.height;
            resizeCanvasTo(state.canvasWidth, state.canvasHeight);
            mainCtx.clearRect(0, 0, state.canvasWidth, state.canvasHeight);
            mainCtx.drawImage(img, 0, 0);
            clearSelection();
            updateSizeDisplay();
            commitHistoryState();
            if (typeof onDone === "function") onDone();
        };
        img.onerror = function () {
            URL.revokeObjectURL(objectUrl);
            window.alert(getEditorText("image_editor_remove_bg_error", "배경제거 실패"));
            if (typeof onDone === "function") onDone();
        };
        img.src = objectUrl;
    }

    function removeBackground() {
        if (!mainCanvas || state.backgroundRemoveRunning) return;
        if (!state.backgroundRemoveUrl) {
            window.alert(getEditorText("image_editor_remove_bg_error", "배경제거 실패"));
            return;
        }
        if (state.selectionFloating) flattenFloatingSelection();
        state.backgroundRemoveRunning = true;
        setActionButtonBusy("remove-bg", true);
        setEditorBusy(true);
        mainCanvas.toBlob(function (blob) {
            if (!blob) {
                state.backgroundRemoveRunning = false;
                setActionButtonBusy("remove-bg", false);
                setEditorBusy(false);
                window.alert(getEditorText("image_editor_remove_bg_error", "배경제거 실패"));
                return;
            }
            var fd = new FormData();
            fd.append("image_blob", blob, "image.png");
            fd.append("path", state.entry && state.entry.path ? state.entry.path : "");
            var csrfToken = getCsrfToken();
            if (csrfToken) fd.append("csrfmiddlewaretoken", csrfToken);
            fetch(state.backgroundRemoveUrl, {
                method: "POST",
                headers: csrfToken
                    ? { "X-CSRFToken": csrfToken, "X-Requested-With": "XMLHttpRequest" }
                    : { "X-Requested-With": "XMLHttpRequest" },
                body: fd,
            })
                .then(function (response) {
                    if (!response.ok) {
                        return response.json().catch(function () { return {}; }).then(function (data) {
                            throw new Error(selectServerMessage(data, getEditorText("image_editor_remove_bg_error", "배경제거 실패")));
                        });
                    }
                    return response.blob();
                })
                .then(function (resultBlob) {
                    drawBlobToCanvas(resultBlob, function () {
                        state.forcePngOnSave = true;
                        state.backgroundRemoveRunning = false;
                        setActionButtonBusy("remove-bg", false);
                        setEditorBusy(false);
                    });
                })
                .catch(function (error) {
                    state.backgroundRemoveRunning = false;
                    setActionButtonBusy("remove-bg", false);
                    setEditorBusy(false);
                    window.alert(error && error.message ? error.message : getEditorText("image_editor_remove_bg_error", "배경제거 실패"));
                });
        }, "image/png");
    }

    // ── 키보드 단축키 ─────────────────────────────────────────────────────
    function bindKeyboard() {
        if (keyboardAlreadyBound) return;
        keyboardAlreadyBound = true;
        boundKeyDown = function (e) {
            var tag = e.target.tagName;
            var isEditing = tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable;
            var ctrl = e.ctrlKey || e.metaKey;

            if (ctrl && !e.shiftKey && e.key.toLowerCase() === "s") {
                e.preventDefault();
                var saveBtn = document.getElementById("handrive-list-save-btn");
                if (saveBtn) saveBtn.click();
                return;
            }

            if (isEditing) return;

            if (ctrl && !e.shiftKey && e.key.toLowerCase() === "z") {
                e.preventDefault(); undoEditorChange(); return;
            }
            if (ctrl && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
                e.preventDefault(); redoEditorChange(); return;
            }

            if (ctrl && e.key.toLowerCase() === "a") { e.preventDefault(); selectAll(); return; }
            if (ctrl && e.key.toLowerCase() === "c") { e.preventDefault(); copySelection(); return; }
            if (ctrl && e.key.toLowerCase() === "x") { e.preventDefault(); cutSelection();  return; }
            if (ctrl && e.key.toLowerCase() === "v") { e.preventDefault(); pasteSelection(); return; }

            if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                if (state.selection) deleteSelection();
                return;
            }
            if (e.key === "Enter" && state.freeSelectBuilding) {
                e.preventDefault();
                endSelectFree();
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                if (state.textOverlayActive) commitTextOverlay();
                else if (state.freeSelectBuilding) cancelFreeSelectBuild();
                else if (state.selectionFloating) flattenFloatingSelection();
                else clearSelection();
                return;
            }

            if (!ctrl && e.key.toLowerCase() === "x") {
                var t = state.primaryColor;
                state.primaryColor = state.secondaryColor;
                state.secondaryColor = t;
                syncSwatches();
                return;
            }

            var toolKeys = {
                "p": "pencil", "b": "brush", "e": "eraser", "f": "fill",
                "i": "eyedropper", "t": "text", "l": "line", "r": "rect",
                "o": "ellipse", "m": "select-rect",
            };
            var k = e.key.toLowerCase();
            if (!ctrl && toolKeys[k]) { setActiveTool(toolKeys[k]); return; }

            if (ctrl && e.key === "=") { e.preventDefault(); setZoom(nextZoomLevel(state.zoom)); return; }
            if (ctrl && e.key === "-") { e.preventDefault(); setZoom(prevZoomLevel(state.zoom)); return; }
            if (ctrl && e.key === "0") { e.preventDefault(); setZoom(1); return; }
        };
        document.addEventListener("keydown", boundKeyDown);
    }

    // ── 모달 ─────────────────────────────────────────────────────────────
    function bindModals() {
        if (modalsAlreadyBound) return;
        modalsAlreadyBound = true;
        if (resizeModal) {
            var wInput = document.getElementById("ie-resize-width");
            var hInput = document.getElementById("ie-resize-height");
            var lockCb = document.getElementById("ie-resize-lock-ratio");
            var unitInputs = resizeModal.querySelectorAll("input[name='ie-resize-unit-type']");
            var unitLabels = resizeModal.querySelectorAll(".ie-resize-unit");
            var syncingResizeInputs = false;

            function getActiveResizeUnit() {
                var activeUnit = "px";
                unitInputs.forEach(function (r) { if (r.checked) activeUnit = r.value; });
                return activeUnit;
            }

            function getResizeNumber(input, fallback) {
                var value = parseFloat(input ? input.value : "");
                return Number.isFinite(value) && value > 0 ? value : fallback;
            }

            function setResizeInputValue(input, value) {
                if (!input) return;
                input.value = String(Math.max(1, Math.round(value)));
            }

            function syncResizeRatio(changedAxis) {
                if (!wInput || !hInput || !lockCb || !lockCb.checked || syncingResizeInputs) return;
                var baseW = Math.max(1, state.canvasWidth || 1);
                var baseH = Math.max(1, state.canvasHeight || 1);
                var activeUnit = getActiveResizeUnit();
                if (changedAxis === "width") {
                    var widthValue = getResizeNumber(wInput, null);
                    if (widthValue === null) return;
                    syncingResizeInputs = true;
                    setResizeInputValue(hInput, activeUnit === "percent" ? widthValue : widthValue * baseH / baseW);
                } else {
                    var heightValue = getResizeNumber(hInput, null);
                    if (heightValue === null) return;
                    syncingResizeInputs = true;
                    setResizeInputValue(wInput, activeUnit === "percent" ? heightValue : heightValue * baseW / baseH);
                }
                syncingResizeInputs = false;
            }

            function setResizeFieldsForUnit() {
                var activeUnit = getActiveResizeUnit();
                unitLabels.forEach(function (label) {
                    label.textContent = activeUnit === "percent" ? "%" : "px";
                });
                if (activeUnit === "percent") {
                    setResizeInputValue(wInput, 100);
                    setResizeInputValue(hInput, 100);
                    return;
                }
                setResizeInputValue(wInput, state.canvasWidth || 1);
                setResizeInputValue(hInput, state.canvasHeight || 1);
            }

            if (wInput && hInput && lockCb) {
                wInput.addEventListener("input", function () { syncResizeRatio("width"); });
                hInput.addEventListener("input", function () { syncResizeRatio("height"); });
            }
            unitInputs.forEach(function (r) {
                r.addEventListener("change", setResizeFieldsForUnit);
            });

            var confirmBtn = document.getElementById("ie-resize-confirm-btn");
            var cancelBtn  = document.getElementById("ie-resize-cancel-btn");
            var backdrop   = document.getElementById("ie-resize-modal-backdrop");

            if (confirmBtn) {
                confirmBtn.addEventListener("click", function () {
                    var newW = Math.round(getResizeNumber(wInput, state.canvasWidth || 1));
                    var newH = Math.round(getResizeNumber(hInput, state.canvasHeight || 1));
                    var activeUnit = "px";
                    unitInputs.forEach(function (r) { if (r.checked) activeUnit = r.value; });
                    if (activeUnit === "percent") {
                        newW = Math.round(state.canvasWidth  * newW / 100);
                        newH = Math.round(state.canvasHeight * newH / 100);
                    }
                    closeModal(resizeModal);
                    resizeCanvasContent(newW, newH);
                });
            }
            if (cancelBtn) cancelBtn.addEventListener("click", function () { closeModal(resizeModal); });
            if (backdrop)  backdrop.addEventListener("click",  function () { closeModal(resizeModal); });
        }

        if (saveAsModal) {
            var saConfirm  = document.getElementById("ie-save-as-confirm-btn");
            var saCancel   = document.getElementById("ie-save-as-cancel-btn");
            var saBackdrop = document.getElementById("ie-save-as-modal-backdrop");

            if (saConfirm) {
                saConfirm.addEventListener("click", function () {
                    var fmt = "png";
                    saveAsModal.querySelectorAll("input[name='ie-save-as-format']").forEach(function (r) {
                        if (r.checked) fmt = r.value;
                    });
                    closeModal(saveAsModal);
                    saveAsDownload(fmt);
                });
            }
            if (saCancel)   saCancel.addEventListener("click",   function () { closeModal(saveAsModal); });
            if (saBackdrop) saBackdrop.addEventListener("click", function () { closeModal(saveAsModal); });
        }
    }

    function openResizeModal() {
        if (!resizeModal) return;
        var wInput = document.getElementById("ie-resize-width");
        var hInput = document.getElementById("ie-resize-height");
        var unitInputs = resizeModal.querySelectorAll("input[name='ie-resize-unit-type']");
        var unitLabels = resizeModal.querySelectorAll(".ie-resize-unit");
        unitInputs.forEach(function (r) { r.checked = r.value === "px"; });
        unitLabels.forEach(function (label) { label.textContent = "px"; });
        if (wInput) wInput.value = state.canvasWidth;
        if (hInput) hInput.value = state.canvasHeight;
        openModal(resizeModal);
    }

    function openSaveAsModal() { if (saveAsModal) openModal(saveAsModal); }
    function openModal(modal)  { modal.hidden = false; }
    function closeModal(modal) { modal.hidden = true; }

    // ── 저장 ─────────────────────────────────────────────────────────────
    function saveToServer(saveUrl, csrfToken, path, onDone, options) {
        var saveOptions = options || {};
        var targetFilename = String(saveOptions.filename || "").trim();
        if (!mainCanvas) { onDone && onDone({ ok: false, error: "캔버스 없음" }); return; }
        if (state.selectionFloating) {
            flattenFloatingSelection();
            clearSelection();
        }
        var selectionCanvas = createSelectionExportCanvas();
        if (selectionCanvas) {
            selectionCanvas.toBlob(function (blob) {
                if (!blob) { onDone && onDone({ ok: false, error: "변환 실패" }); return; }
                var stem = (path.split("/").pop() || "image").replace(/\.[^.]+$/, "") || "image";
                var fd = new FormData();
                fd.append("image_blob", blob, stem + ".png");
                fd.append("path", path);
                fd.append("force_png", "1");
                fd.append("selected_only", "1");
                if (targetFilename) fd.append("filename", targetFilename);
                fd.append("csrfmiddlewaretoken", csrfToken);
                fetch(saveUrl, { method: "POST", headers: { "X-Requested-With": "XMLHttpRequest" }, body: fd })
                    .then(function (r) { return r.json(); })
                    .then(function (data) { if (data.ok) setDirty(false); onDone && onDone(data); })
                    .catch(function (err) { onDone && onDone({ ok: false, error: String(err) }); });
            }, "image/png");
            return;
        }
        var ext = (path.match(/\.([a-z0-9]+)$/i) || [])[1] || "png";
        var forcePng = Boolean(state.forcePngOnSave);
        var mime = forcePng ? "image/png" : ext.toLowerCase() === "jpg" || ext.toLowerCase() === "jpeg"
            ? "image/jpeg" : ext.toLowerCase() === "webp" ? "image/webp" : "image/png";

        mainCanvas.toBlob(function (blob) {
            if (!blob) { onDone && onDone({ ok: false, error: "변환 실패" }); return; }
            var filename = path.split("/").pop() || "image.png";
            if (forcePng) filename = filename.replace(/\.[^.]+$/, "") + ".png";
            var fd = new FormData();
            fd.append("image_blob", blob, filename);
            fd.append("path", path);
            if (targetFilename) fd.append("filename", targetFilename);
            if (forcePng) fd.append("force_png", "1");
            fd.append("csrfmiddlewaretoken", csrfToken);
            fetch(saveUrl, { method: "POST", headers: { "X-Requested-With": "XMLHttpRequest" }, body: fd })
                .then(function (r) { return r.json(); })
                .then(function (data) { if (data.ok) { state.forcePngOnSave = false; setDirty(false); } onDone && onDone(data); })
                .catch(function (err) { onDone && onDone({ ok: false, error: String(err) }); });
        }, mime);
    }

    function createSelectionExportCanvas() {
        if (!state.selection || state.selection.w <= 0 || state.selection.h <= 0) {
            return null;
        }
        var s = {
            x: Math.max(0, Math.floor(state.selection.x)),
            y: Math.max(0, Math.floor(state.selection.y)),
            w: Math.max(1, Math.ceil(state.selection.w)),
            h: Math.max(1, Math.ceil(state.selection.h)),
        };
        s.w = Math.min(s.w, state.canvasWidth - s.x);
        s.h = Math.min(s.h, state.canvasHeight - s.y);
        if (s.w <= 0 || s.h <= 0) return null;

        var tmp = document.createElement("canvas");
        tmp.width = s.w;
        tmp.height = s.h;
        var tmpCtx = tmp.getContext("2d");
        var hasPoly = state.freeSelectPath && state.freeSelectPath.length > 2;

        if (state.selectionFloating && state.selectionImageData) {
            tmpCtx.putImageData(state.selectionImageData, 0, 0);
            return tmp;
        }

        tmpCtx.drawImage(mainCanvas, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
        if (hasPoly) applyPolygonMaskToCanvas(tmpCtx, s.w, s.h, state.freeSelectPath, s.x, s.y);
        if (state.selectionMask) applySelectionMaskToCanvas(tmpCtx, s.w, s.h);
        return tmp;
    }

    function saveAsDownload(format) {
        if (!mainCanvas) return;
        if (state.selectionFloating) flattenFloatingSelection();
        var mime = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" }[format] || "image/png";
        var stem = state.entry && state.entry.name ? state.entry.name.replace(/\.[^.]+$/, "") : "image";
        mainCanvas.toBlob(function (blob) {
            if (!blob) return;
            var url = URL.createObjectURL(blob);
            var a = document.createElement("a");
            a.href = url; a.download = stem + "." + format;
            document.body.appendChild(a); a.click();
            document.body.removeChild(a); URL.revokeObjectURL(url);
        }, mime);
    }

    // ── 공개 API ──────────────────────────────────────────────────────────
    window.HandriveImageEditor = {
        init: init,
        destroy: destroy,
        saveToServer: saveToServer,
        getIsDirty: function () { return state.isDirty; },
        setZoom: setZoom,
        triggerAction: handleAction,
    };

})();
