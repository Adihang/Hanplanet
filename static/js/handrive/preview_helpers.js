(function () {
    "use strict";

    // Preview UI helpers handle panel visibility, image zoom, and action-button targeting.
    // They do not fetch preview payloads; that orchestration lives in preview_flow_helpers.js.

    function setPreviewVisibility(previewPanel, listLayout, isVisible, onAfterChange) {
        // Preview visibility also drives list layout classes, so keep both updates atomic.
        if (!previewPanel) {
            return;
        }
        var visible = Boolean(isVisible);
        if (!visible) {
            var focused = document.activeElement;
            if (focused && previewPanel.contains(focused)) {
                focused.blur();
            }
        }
        previewPanel.hidden = !visible;
        previewPanel.setAttribute("aria-hidden", visible ? "false" : "true");
        if (listLayout) {
            listLayout.classList.toggle("has-preview", visible);
        }
        if (typeof onAfterChange === "function") {
            onAfterChange();
        }
    }

    var previewScrollObserver = null;
    var previewScrollCleanupTimer = null;
    var previewScrollFrameId = null;
    var previewScrollNestedFrameId = null;

    function cancelPreviewScrollIntoView(options) {
        if (previewScrollObserver) {
            previewScrollObserver.disconnect();
            previewScrollObserver = null;
        }
        if (previewScrollCleanupTimer !== null) {
            window.clearTimeout(previewScrollCleanupTimer);
            previewScrollCleanupTimer = null;
        }
        if (previewScrollFrameId !== null) {
            window.cancelAnimationFrame(previewScrollFrameId);
            previewScrollFrameId = null;
        }
        if (previewScrollNestedFrameId !== null) {
            window.cancelAnimationFrame(previewScrollNestedFrameId);
            previewScrollNestedFrameId = null;
        }
        if (options && options.freezePosition) {
            window.scrollTo(window.pageXOffset, window.pageYOffset);
        }
    }

    function schedulePreviewScroll(callback) {
        if (previewScrollFrameId !== null) {
            window.cancelAnimationFrame(previewScrollFrameId);
        }
        if (previewScrollNestedFrameId !== null) {
            window.cancelAnimationFrame(previewScrollNestedFrameId);
            previewScrollNestedFrameId = null;
        }
        previewScrollFrameId = window.requestAnimationFrame(function () {
            previewScrollFrameId = null;
            previewScrollNestedFrameId = window.requestAnimationFrame(function () {
                previewScrollNestedFrameId = null;
                callback();
            });
        });
    }

    function scrollPreviewIntoViewIfPortrait(previewPanel, previewHead) {
        if (document.documentElement.dataset.googlePickerOpening === "1") {
            cancelPreviewScrollIntoView({ freezePosition: true });
            return;
        }
        if (!previewPanel || previewPanel.hidden) {
            return;
        }
        var isPortrait = window.innerHeight > window.innerWidth;
        if (!isPortrait) {
            return;
        }
        var targetElement = previewHead || previewPanel;
        var scrollToPreviewTop = function () {
            if (document.documentElement.dataset.googlePickerOpening === "1") {
                cancelPreviewScrollIntoView({ freezePosition: true });
                return;
            }
            if (!previewPanel || previewPanel.hidden || !targetElement) {
                return;
            }
            var previewTop = targetElement.getBoundingClientRect().top + window.pageYOffset;
            window.scrollTo({
                top: Math.max(0, Math.floor(previewTop)),
                behavior: "smooth",
            });
        };

        cancelPreviewScrollIntoView();

        schedulePreviewScroll(scrollToPreviewTop);

        if (typeof ResizeObserver === "function") {
            previewScrollObserver = new ResizeObserver(function () {
                schedulePreviewScroll(scrollToPreviewTop);
            });
            previewScrollObserver.observe(previewPanel);
            if (previewHead && previewHead !== previewPanel) {
                previewScrollObserver.observe(previewHead);
            }
            previewScrollCleanupTimer = window.setTimeout(function () {
                if (previewScrollObserver) {
                    previewScrollObserver.disconnect();
                    previewScrollObserver = null;
                }
                previewScrollCleanupTimer = null;
            }, 1200);
        }
    }

    function setPreviewPlaceholder(previewContent, escapeHtml, message) {
        if (!previewContent) {
            return;
        }
        previewContent.innerHTML = '<p class="handrive-list-preview-placeholder">' + escapeHtml(message) + '</p>';
    }

    function getPreviewImageElement(previewContent) {
        if (!previewContent) {
            return null;
        }
        return previewContent.querySelector(".handrive-media-image-element");
    }

    function getPreviewImageMinZoom(previewContent) {
        var imageElement = getPreviewImageElement(previewContent);
        if (!previewContent || !imageElement) {
            return 0.5;
        }
        var naturalWidth = Number(imageElement.naturalWidth || imageElement.width || 0);
        var availableWidth = Math.max(1, previewContent.clientWidth || 0);
        if (!naturalWidth) {
            return 0.5;
        }
        return Math.max(0.05, Math.min(0.1, availableWidth / naturalWidth));
    }

    // Image previews use a transform-based viewport rather than resetting the
    // scroll position for every zoom step.  Keeping the pan state here lets the
    // list preview and read page share the same cursor/pinch centred behaviour.
    var imageZoomPanStates = typeof WeakMap === "function" ? new WeakMap() : null;

    function getImageZoomPanState(surface) {
        if (!surface) {
            return { imageWrap: null, zoom: 1, panX: 0, panY: 0 };
        }
        if (imageZoomPanStates && imageZoomPanStates.has(surface)) {
            return imageZoomPanStates.get(surface);
        }
        var state = { imageWrap: null, zoom: 1, panX: 0, panY: 0 };
        if (imageZoomPanStates) {
            imageZoomPanStates.set(surface, state);
        }
        return state;
    }

    function resolveImageWrap(surface, options) {
        if (options && typeof options.getImageWrap === "function") {
            return options.getImageWrap() || null;
        }
        return surface && typeof surface.querySelector === "function"
            ? surface.querySelector(".handrive-media-image-wrap")
            : null;
    }

    function clampImageZoom(value, options) {
        var settings = options || {};
        var minZoom = typeof settings.min === "function" ? settings.min() : settings.min;
        var maxZoom = typeof settings.max === "function" ? settings.max() : settings.max;
        var safeValue = Number(value);
        if (!Number.isFinite(safeValue)) {
            safeValue = 1;
        }
        if (Number.isFinite(Number(minZoom))) {
            safeValue = Math.max(Number(minZoom), safeValue);
        }
        if (Number.isFinite(Number(maxZoom))) {
            safeValue = Math.min(Number(maxZoom), safeValue);
        }
        return safeValue;
    }

    function applyImageZoomPan(surface, imageWrap, state) {
        if (!imageWrap || !state) {
            return;
        }
        var imageElement = imageWrap.querySelector
            ? imageWrap.querySelector(".handrive-media-image-element")
            : null;
        if (imageElement) {
            // Prevent the browser's native image ghost-drag (which shows a
            // forbidden cursor) while keeping pointer events available for pan.
            imageElement.draggable = false;
            imageElement.setAttribute("draggable", "false");
        }
        imageWrap.style.transformOrigin = "center center";
        imageWrap.style.transform =
            "translate3d(" + String(state.panX) + "px, " + String(state.panY) + "px, 0) " +
            "scale(" + String(state.zoom) + ")";
    }

    function syncImageZoomPan(surface, imageWrap, nextZoom, options) {
        if (!surface) {
            return;
        }
        if (surface.classList) {
            surface.classList.toggle("handrive-image-zoom-pan-surface", Boolean(imageWrap));
        }
        if (!imageWrap) {
            return;
        }
        var state = getImageZoomPanState(surface);
        if (state.imageWrap !== imageWrap || (options && options.resetPan)) {
            state.imageWrap = imageWrap;
            state.panX = 0;
            state.panY = 0;
        }
        state.zoom = clampImageZoom(nextZoom, options || {});
        applyImageZoomPan(surface, imageWrap, state);
    }

    function resetImageZoomPan(surface) {
        if (!surface) {
            return;
        }
        var state = getImageZoomPanState(surface);
        state.imageWrap = null;
        state.panX = 0;
        state.panY = 0;
        state.zoom = 1;
    }

    function adjustImageZoomAt(surface, nextZoom, context, options) {
        if (!surface) {
            return;
        }
        var imageWrap = resolveImageWrap(surface, options);
        if (!imageWrap) {
            return;
        }
        var state = getImageZoomPanState(surface);
        if (state.imageWrap !== imageWrap) {
            state.imageWrap = imageWrap;
            state.panX = 0;
            state.panY = 0;
            state.zoom = Number(options && options.currentZoom) || 1;
        }
        var oldZoom = Number(state.zoom) > 0 ? Number(state.zoom) : 1;
        var boundedZoom = clampImageZoom(nextZoom, options || {});
        var ratio = boundedZoom / oldZoom;
        var rect = surface.getBoundingClientRect ? surface.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
        var clientX = Number(context && context.clientX);
        var clientY = Number(context && context.clientY);
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
            clientX = Number(rect.left) + Number(rect.width || surface.clientWidth || 0) / 2;
            clientY = Number(rect.top) + Number(rect.height || surface.clientHeight || 0) / 2;
        }
        var centerX = Number(rect.left) + Number(rect.width || surface.clientWidth || 0) / 2;
        var centerY = Number(rect.top) + Number(rect.height || surface.clientHeight || 0) / 2;
        var focalX = clientX - centerX;
        var focalY = clientY - centerY;
        state.panX = focalX - (focalX - state.panX) * ratio;
        state.panY = focalY - (focalY - state.panY) * ratio;
        state.zoom = boundedZoom;
        applyImageZoomPan(surface, imageWrap, state);
    }

    function bindImageZoomPan(surface, options) {
        if (!surface || typeof surface.addEventListener !== "function") {
            return null;
        }
        if (surface._handriveImageZoomPanDestroy) {
            surface._handriveImageZoomPanDestroy();
        }
        var settings = Object.assign({
            min: 0.05,
            max: 4,
            wheelRatio: 1.125,
            wheelDeltaUnit: 100,
            stopPropagation: true,
        }, options || {});
        var state = getImageZoomPanState(surface);
        var pointers = new Map();
        var dragging = false;
        var moved = false;
        var lastPoint = null;
        var pinchDistance = 0;
        var pinchCenter = null;
        var pinchZoom = 1;
        var suppressClick = false;

        function getImageWrap() {
            return resolveImageWrap(surface, settings);
        }

        function shouldHandle(event) {
            if (typeof settings.shouldHandle === "function") {
                try {
                    return settings.shouldHandle(event) !== false;
                } catch (error) {
                    return false;
                }
            }
            return Boolean(getImageWrap());
        }

        function stopEvent(event) {
            if (!event) {
                return;
            }
            event.preventDefault();
            if (settings.stopPropagation) {
                event.stopPropagation();
            }
        }

        function readZoom(context) {
            var value = typeof settings.getValue === "function" ? settings.getValue(context || {}) : state.zoom;
            return clampImageZoom(value, settings);
        }

        function applyZoom(nextZoom, context) {
            var imageWrap = getImageWrap();
            if (!imageWrap) {
                return;
            }
            state.imageWrap = imageWrap;
            if (!(Number(state.zoom) > 0)) {
                state.zoom = readZoom(context);
            }
            adjustImageZoomAt(surface, nextZoom, context, Object.assign({}, settings, {
                getImageWrap: getImageWrap,
                currentZoom: state.zoom,
            }));
            if (typeof settings.setValue === "function") {
                settings.setValue(state.zoom, context || {});
            }
            applyImageZoomPan(surface, imageWrap, state);
        }

        function handleWheel(event) {
            if (!shouldHandle(event) || !event || event.defaultPrevented || !(event.ctrlKey || event.metaKey)) {
                return;
            }
            var delta = Number(event.deltaY) || Number(event.deltaX) || 0;
            if (Math.abs(delta) < 0.01) {
                return;
            }
            if (event.deltaMode === 1) {
                delta *= 16;
            } else if (event.deltaMode === 2) {
                delta *= window.innerHeight || 800;
            }
            stopEvent(event);
            var context = {
                inputType: "wheel",
                originalEvent: event,
                delta: Number(event.deltaY) || Number(event.deltaX) || 0,
                normalizedDelta: delta,
                clientX: Number(event.clientX) || 0,
                clientY: Number(event.clientY) || 0,
            };
            var currentZoom = readZoom(context);
            var ratio = Number(settings.wheelRatio) > 1 ? Number(settings.wheelRatio) : 1.125;
            var unit = Number(settings.wheelDeltaUnit) > 0 ? Number(settings.wheelDeltaUnit) : 100;
            applyZoom(currentZoom * Math.pow(ratio, -delta / unit), context);
        }

        function getPointerCenter() {
            var values = Array.from(pointers.values());
            if (!values.length) {
                return { x: 0, y: 0 };
            }
            var totalX = 0;
            var totalY = 0;
            values.forEach(function (point) {
                totalX += point.x;
                totalY += point.y;
            });
            return { x: totalX / values.length, y: totalY / values.length };
        }

        function getPointerDistance() {
            var values = Array.from(pointers.values());
            if (values.length < 2) {
                return 0;
            }
            var dx = values[0].x - values[1].x;
            var dy = values[0].y - values[1].y;
            return Math.sqrt(dx * dx + dy * dy);
        }

        function handlePointerDown(event) {
            if (!shouldHandle(event) || !event || (event.pointerType === "mouse" && event.button !== 0)) {
                return;
            }
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            try {
                surface.setPointerCapture(event.pointerId);
            } catch (error) {}
            if (pointers.size === 1) {
                dragging = true;
                moved = false;
                lastPoint = { x: event.clientX, y: event.clientY };
                return;
            }
            if (pointers.size === 2) {
                dragging = false;
                pinchDistance = getPointerDistance();
                pinchCenter = getPointerCenter();
                pinchZoom = readZoom({ inputType: "pinch-start", originalEvent: event });
                stopEvent(event);
            }
        }

        function handlePointerMove(event) {
            if (!pointers.has(event.pointerId) || !shouldHandle(event)) {
                return;
            }
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            var imageWrap = getImageWrap();
            if (!imageWrap) {
                return;
            }
            if (pointers.size >= 2 && pinchCenter) {
                var nextCenter = getPointerCenter();
                var nextDistance = getPointerDistance();
                if (!nextDistance || !pinchDistance) {
                    return;
                }
                var stateForPinch = getImageZoomPanState(surface);
                stateForPinch.panX += nextCenter.x - pinchCenter.x;
                stateForPinch.panY += nextCenter.y - pinchCenter.y;
                var nextZoom = pinchZoom * (nextDistance / pinchDistance);
                applyZoom(nextZoom, {
                    inputType: "pinch",
                    originalEvent: event,
                    clientX: nextCenter.x,
                    clientY: nextCenter.y,
                    ratio: nextDistance / pinchDistance,
                });
                pinchCenter = nextCenter;
                stopEvent(event);
                return;
            }
            if (!dragging || !lastPoint) {
                return;
            }
            var deltaX = event.clientX - lastPoint.x;
            var deltaY = event.clientY - lastPoint.y;
            if (Math.abs(deltaX) < 0.01 && Math.abs(deltaY) < 0.01) {
                return;
            }
            var stateForDrag = getImageZoomPanState(surface);
            stateForDrag.imageWrap = imageWrap;
            stateForDrag.panX += deltaX;
            stateForDrag.panY += deltaY;
            applyImageZoomPan(surface, imageWrap, stateForDrag);
            lastPoint = { x: event.clientX, y: event.clientY };
            if (Math.abs(stateForDrag.panX) + Math.abs(stateForDrag.panY) > 2) {
                moved = true;
            }
            stopEvent(event);
        }

        function handlePointerUp(event) {
            if (!pointers.has(event.pointerId)) {
                return;
            }
            pointers.delete(event.pointerId);
            try {
                surface.releasePointerCapture(event.pointerId);
            } catch (error) {}
            if (moved) {
                suppressClick = true;
            }
            if (pointers.size < 2) {
                pinchDistance = 0;
                pinchCenter = null;
            }
            if (!pointers.size) {
                dragging = false;
                lastPoint = null;
                moved = false;
            } else if (pointers.size === 1) {
                var remaining = Array.from(pointers.values())[0];
                dragging = true;
                lastPoint = { x: remaining.x, y: remaining.y };
            }
        }

        function suppressDraggedClick(event) {
            if (!suppressClick) {
                return;
            }
            suppressClick = false;
            event.preventDefault();
            event.stopPropagation();
        }

        function preventNativeImageDrag(event) {
            var target = event && event.target;
            if (!target || !target.closest || !target.closest(".handrive-media-image-element")) {
                return;
            }
            event.preventDefault();
        }

        surface.addEventListener("wheel", handleWheel, { passive: false });
        surface.addEventListener("pointerdown", handlePointerDown, { passive: false });
        surface.addEventListener("pointermove", handlePointerMove, { passive: false });
        surface.addEventListener("pointerup", handlePointerUp, { passive: false });
        surface.addEventListener("pointercancel", handlePointerUp, { passive: false });
        surface.addEventListener("click", suppressDraggedClick, true);
        surface.addEventListener("dragstart", preventNativeImageDrag, true);

        var destroy = function () {
            surface.removeEventListener("wheel", handleWheel, { passive: false });
            surface.removeEventListener("pointerdown", handlePointerDown, { passive: false });
            surface.removeEventListener("pointermove", handlePointerMove, { passive: false });
            surface.removeEventListener("pointerup", handlePointerUp, { passive: false });
            surface.removeEventListener("pointercancel", handlePointerUp, { passive: false });
            surface.removeEventListener("click", suppressDraggedClick, true);
            surface.removeEventListener("dragstart", preventNativeImageDrag, true);
            surface.classList.remove("handrive-image-zoom-pan-surface");
            if (surface._handriveImageZoomPanDestroy === destroy) {
                delete surface._handriveImageZoomPanDestroy;
            }
        };
        surface._handriveImageZoomPanDestroy = destroy;
        return { destroy: destroy };
    }

    function syncPreviewImageZoom(previewContent, previewZoomWrap, nextZoom, options) {
        var imageWrap = previewContent
            ? previewContent.querySelector(".handrive-media-image-wrap")
            : null;
        var hasImage = Boolean(imageWrap);
        if (previewZoomWrap) {
            previewZoomWrap.hidden = !hasImage;
        }
        if (!hasImage) {
            if (previewContent && previewContent.classList) {
                previewContent.classList.remove("handrive-image-zoom-pan-surface");
            }
            return;
        }
        syncImageZoomPan(previewContent, imageWrap, nextZoom, options);
    }

    var printablePreviewRenderModes = new Set([
        "markdown",
        "plain_text",
        "media_image",
        "office",
        "pdf"
    ]);

    function isPrintablePreviewRenderMode(renderMode) {
        return printablePreviewRenderModes.has(String(renderMode || "").trim().toLowerCase());
    }

    function getHandriveActionVisibility(options) {
        var settings = options || {};
        var entry = settings.entry || null;
        var isFileEntry = settings.isFileEntry !== undefined
            ? Boolean(settings.isFileEntry)
            : Boolean(entry && entry.type === "file");
        var canRead = settings.canRead !== undefined
            ? Boolean(settings.canRead)
            : Boolean(!entry || entry.can_read !== false);
        var canEdit = settings.canEdit !== undefined
            ? Boolean(settings.canEdit)
            : Boolean(entry && entry.can_edit);
        var canOpenEditor = settings.canOpenEditor !== undefined
            ? Boolean(settings.canOpenEditor)
            : Boolean(canEdit || (entry && entry.can_demo_edit));
        var renderMode = String(settings.renderMode || "").trim().toLowerCase();

        return {
            download: settings.canDownload !== undefined
                ? Boolean(settings.canDownload)
                : Boolean(isFileEntry && !(entry && entry.is_trash_item)),
            print: settings.canPrint !== undefined
                ? Boolean(settings.canPrint)
                : Boolean(isFileEntry && canRead && isPrintablePreviewRenderMode(renderMode)),
            edit: settings.canEditAction !== undefined
                ? Boolean(settings.canEditAction)
                : Boolean(isFileEntry && canOpenEditor && renderMode !== "unsupported"),
            delete: settings.canDelete !== undefined
                ? Boolean(settings.canDelete)
                : Boolean(isFileEntry && canEdit),
            urlShare: settings.canUrlShare !== undefined
                ? Boolean(settings.canUrlShare)
                : Boolean(isFileEntry && canEdit && settings.urlShareApiUrl),
        };
    }

    function syncHandriveActionVisibility(buttons, visibility) {
        var actionButtons = buttons || {};
        var actionVisibility = visibility || {};
        Object.keys(actionButtons).forEach(function (actionName) {
            var button = actionButtons[actionName];
            if (!button) {
                return;
            }
            button.hidden = actionVisibility[actionName] !== true;
        });
    }

    function setPreviewActionTargets(options) {
        // Preview action buttons follow the selected entry rather than the currently visible HTML,
        // which keeps download/edit/delete targets correct across cached preview renders.
        var settings = options || {};
        var entry = settings.entry || null;
        var previewDownloadButton = settings.previewDownloadButton || null;
        var previewPrintButton = settings.previewPrintButton || null;
        var previewEditButton = settings.previewEditButton || null;
        var previewSpreadsheetSaveButton = settings.previewSpreadsheetSaveButton || null;
        var previewDeleteButton = settings.previewDeleteButton || null;
        var previewUrlShareButton = settings.previewUrlShareButton || null;
        var urlShareApiUrl = settings.urlShareApiUrl || "";
        var isPreviewableFileEntry = settings.isPreviewableFileEntry || function () { return false; };
        var isEditableHandriveFileEntry = settings.isEditableHandriveFileEntry || function () { return false; };
        var buildDownloadUrl = settings.buildDownloadUrl || function () { return ""; };
        var onEdit = settings.onEdit || function () {};
        var previewRenderMode = String(settings.previewRenderMode || "").trim();
        var previewCanPrint = Boolean(settings.previewCanPrint);

        var isFileEntry = Boolean(isPreviewableFileEntry(entry));
        var canRead = Boolean(entry && entry.can_read !== false);
        var canEdit = Boolean(entry && entry.can_edit);
        var canOpenEditor = Boolean(entry && (entry.can_edit || entry.can_demo_edit));
        var canEditPreview = previewRenderMode !== "unsupported";
        var canPrintPreview = isPrintablePreviewRenderMode(previewRenderMode);
        var actionVisibility = getHandriveActionVisibility({
            entry: entry,
            isFileEntry: isFileEntry,
            canRead: canRead,
            canEdit: canEdit,
            canOpenEditor: canOpenEditor,
            canPrint: isFileEntry && canRead && previewCanPrint && canPrintPreview,
            canEditAction: isFileEntry && canOpenEditor && canEditPreview && isEditableHandriveFileEntry(entry),
            canDelete: isFileEntry && canEdit,
            canUrlShare: isFileEntry && canEdit && Boolean(urlShareApiUrl),
            urlShareApiUrl: urlShareApiUrl,
            renderMode: previewRenderMode,
        });
        syncHandriveActionVisibility({
            download: previewDownloadButton,
            print: previewPrintButton,
            edit: previewEditButton,
            delete: previewDeleteButton,
            urlShare: previewUrlShareButton,
        }, actionVisibility);
        if (previewDownloadButton) {
            if (!actionVisibility.download) {
                previewDownloadButton.hidden = true;
                previewDownloadButton.removeAttribute("href");
            } else {
                var downloadUrl = buildDownloadUrl(entry.path);
                previewDownloadButton.hidden = !downloadUrl;
                if (downloadUrl) {
                    previewDownloadButton.href = downloadUrl;
                } else {
                    previewDownloadButton.removeAttribute("href");
                }
            }
        }

        if (previewPrintButton) {
            previewPrintButton.hidden = !actionVisibility.print;
        }

        if (previewEditButton) {
            previewEditButton.hidden = !actionVisibility.edit;
            if (!previewEditButton.hidden) {
                previewEditButton.onclick = function (event) {
                    event.preventDefault();
                    onEdit(entry);
                };
            } else {
                previewEditButton.removeAttribute("href");
                previewEditButton.onclick = null;
            }
        }

        if (previewSpreadsheetSaveButton) {
            previewSpreadsheetSaveButton.hidden = true;
            previewSpreadsheetSaveButton.disabled = true;
            previewSpreadsheetSaveButton.onclick = null;
        }

        if (previewDeleteButton) {
            previewDeleteButton.hidden = !actionVisibility.delete;
        }

        if (previewUrlShareButton) {
            previewUrlShareButton.hidden = !actionVisibility.urlShare;
        }
    }

    window.HandrivePreviewHelpers = {
        cancelScrollIntoView: cancelPreviewScrollIntoView,
        getPreviewImageElement: getPreviewImageElement,
        getPreviewImageMinZoom: getPreviewImageMinZoom,
        getHandriveActionVisibility: getHandriveActionVisibility,
        isPrintablePreviewRenderMode: isPrintablePreviewRenderMode,
        scrollPreviewIntoViewIfPortrait: scrollPreviewIntoViewIfPortrait,
        setPreviewActionTargets: setPreviewActionTargets,
        setPreviewPlaceholder: setPreviewPlaceholder,
        setPreviewVisibility: setPreviewVisibility,
        syncHandriveActionVisibility: syncHandriveActionVisibility,
        adjustImageZoomAt: adjustImageZoomAt,
        bindImageZoomPan: bindImageZoomPan,
        resetImageZoomPan: resetImageZoomPan,
        syncImageZoomPan: syncImageZoomPan,
        syncPreviewImageZoom: syncPreviewImageZoom,
    };
})();
