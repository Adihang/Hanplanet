// Shared popup positioning helper used by multiple pages with viewport-constrained dropdowns/modals.
(function () {
    // Keep a small inset so popups never touch the viewport edge.
    const viewportPadding = 10;
    const inlineCopyFeedbackFadeMs = 190;
    const popupSelector = ".site-dropdown-menu:not(.site-custom-select-menu), [data-popup-fit-bottom], [data-popup-fit-top]";
    const modalRootSelector = [
        ".root-auth-modal",
        ".handrive-popup-modal",
        ".handrive-drive-modal",
        ".handrive-folder-modal",
        ".handrive-help-modal",
        ".handrive-sync-modal",
        ".site-legal-modal",
        ".hpmail-mailbox-modal",
        ".portfolio-print-selector-overlay",
        ".media-tool-modal-backdrop",
        ".image-demo-modal-backdrop",
        ".bumpercar-stats-modal-backdrop",
        ".multiplayer-skin-modal-backdrop",
        ".multiplayer-idle-modal-backdrop",
        ".multiplayer-death-modal-backdrop",
        ".map-image-viewer-modal",
        ".map-media-viewer-modal",
        ".map-video-viewer-modal",
        ".map-name-popup-overlay",
        ".map-bind-picker-overlay",
        ".ve-image-upload-dialog",
        ".ae-drive-picker"
    ].join(", ");
    const draggableHeaderSelector = [
        ".site-modal-head",
        ".handrive-popup-head",
        ".handrive-drive-modal-head",
        ".auth-modal-head",
        ".hpmail-mailbox-modal-head",
        ".image-demo-modal-head",
        ".media-tool-modal-head",
        ".bumpercar-stats-modal-header",
        ".multiplayer-skin-modal-header",
        ".ve-image-upload-head",
        ".ae-drive-head"
    ].join(", ");
    const draggableDialogSelector = [
        ".site-modal-dialog",
        ".handrive-popup-modal-dialog",
        ".handrive-drive-modal-dialog",
        ".handrive-folder-modal-dialog",
        ".auth-modal-dialog",
        ".hpmail-mailbox-modal-dialog",
        ".image-demo-modal",
        ".media-tool-modal",
        ".bumpercar-stats-modal",
        ".multiplayer-skin-modal",
        ".ve-image-upload-panel",
        ".ae-drive-dialog"
    ].join(", ");
    const helpModalResizeHandleSelector = "[data-handrive-help-modal-resize-handle]";
    const interactiveDragSkipSelector = [
        "button",
        "a",
        "input",
        "textarea",
        "select",
        "label",
        "summary",
        "[role='button']",
        "[contenteditable='true']"
    ].join(",");
    const dragMargin = 8;
    const modalStack = [];
    const customSelects = new Set();
    let customSelectIdCounter = 0;
    let popupPositionFrame = 0;
    let modalStackFrame = 0;
    let draggableClampFrame = 0;
    let activeModalDrag = null;
    let activeHelpModalResize = null;
    let activeCustomSelect = null;
    const observedDraggableDialogs = new WeakSet();
    const draggableDialogResizeObserver = window.ResizeObserver
        ? new window.ResizeObserver(function () {
            scheduleClampDraggableDialogsToViewport();
        })
        : null;
    const selectValueDescriptor = window.HTMLSelectElement
        ? Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")
        : null;
    let activeInlineCopyFeedback = null;

    function isVisible(element) {
        // Popups are repositioned only when actually visible; hidden-but-mounted nodes
        // are ignored so style resets do not waste layout work.
        if (!element || !element.isConnected) {
            return false;
        }
        if (element.hidden || element.closest("[hidden]")) {
            return false;
        }
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
            return false;
        }
        return true;
    }

    function getViewportHeight() {
        // VisualViewport is preferred on mobile because browser UI chrome changes the
        // usable height independently from window.innerHeight.
        if (window.visualViewport && Number.isFinite(window.visualViewport.height)) {
            return window.visualViewport.height;
        }
        return window.innerHeight;
    }

    function getViewportSize() {
        return {
            width: Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0),
            height: Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0)
        };
    }

    function clamp(value, min, max) {
        if (min > max) {
            return (min + max) / 2;
        }
        return Math.max(min, Math.min(max, value));
    }

    function readRootZIndex(name, fallback) {
        const rootValue = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        const bodyValue = document.body
            ? window.getComputedStyle(document.body).getPropertyValue(name).trim()
            : "";
        const value = bodyValue || rootValue;
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function getInlineCopyFeedbackElement() {
        let element = document.querySelector(".handrive-inline-copy-feedback");
        if (element) {
            return element;
        }
        element = document.createElement("div");
        element.className = "handrive-inline-copy-feedback";
        element.hidden = true;
        element.setAttribute("role", "status");
        element.setAttribute("aria-live", "polite");
        document.body.appendChild(element);
        return element;
    }

    function getInlineCopyFeedbackBoundary(button) {
        const viewport = getViewportSize();
        const viewportBoundary = {
            left: viewportPadding,
            top: viewportPadding,
            right: viewport.width - viewportPadding,
            bottom: viewport.height - viewportPadding
        };
        const modalRoot = getModalRoot(button);
        const modalDialog = modalRoot && modalRoot.querySelector
            ? modalRoot.querySelector(draggableDialogSelector)
            : null;
        const boundarySource = modalDialog && isVisible(modalDialog)
            ? modalDialog
            : (modalRoot && isVisible(modalRoot) ? modalRoot : null);

        if (!boundarySource) {
            return viewportBoundary;
        }

        const rect = boundarySource.getBoundingClientRect();
        const modalPadding = 8;
        const boundary = {
            left: Math.max(viewportBoundary.left, rect.left + modalPadding),
            top: Math.max(viewportBoundary.top, rect.top + modalPadding),
            right: Math.min(viewportBoundary.right, rect.right - modalPadding),
            bottom: Math.min(viewportBoundary.bottom, rect.bottom - modalPadding)
        };

        if (boundary.right - boundary.left < 80 || boundary.bottom - boundary.top < 32) {
            return viewportBoundary;
        }
        return boundary;
    }

    function clearInlineCopyFeedbackState(state) {
        if (!state) {
            return;
        }
        if (state.button) {
            state.button.removeEventListener("pointerleave", state.hide);
            state.button.removeEventListener("blur", state.hide);
        }
        if (state.fallbackTimer) {
            window.clearTimeout(state.fallbackTimer);
        }
    }

    function getInlineCopyDefaultMessage() {
        const lang = String(document.documentElement.getAttribute("lang") || "").toLowerCase();
        return lang.indexOf("en") === 0 ? "Copied!" : "복사됨!";
    }

    function hideInlineCopyFeedback() {
        const state = activeInlineCopyFeedback;
        const element = state && state.element
            ? state.element
            : document.querySelector(".handrive-inline-copy-feedback");
        clearInlineCopyFeedbackState(state);
        activeInlineCopyFeedback = null;
        if (!element) {
            return;
        }
        element.classList.remove("is-visible");
        window.setTimeout(function () {
            if (!activeInlineCopyFeedback && !element.classList.contains("is-visible")) {
                element.hidden = true;
                element.classList.remove(
                    "is-placement-top",
                    "is-placement-bottom",
                    "is-placement-left",
                    "is-placement-right"
                );
                element.style.removeProperty("z-index");
            }
        }, inlineCopyFeedbackFadeMs);
    }

    function chooseInlineCopyFeedbackPlacement(rect, boundary, feedbackWidth, feedbackHeight) {
        const gap = 10;
        const spaces = {
            top: rect.top - boundary.top,
            bottom: boundary.bottom - rect.bottom,
            left: rect.left - boundary.left,
            right: boundary.right - rect.right
        };

        if (spaces.top >= feedbackHeight + gap) return "top";
        if (spaces.bottom >= feedbackHeight + gap) return "bottom";
        if (spaces.right >= feedbackWidth + gap) return "right";
        if (spaces.left >= feedbackWidth + gap) return "left";
        return spaces.bottom > spaces.top ? "bottom" : "top";
    }

    function syncInlineCopyFeedbackZIndex(element, button) {
        const modalRoot = getModalRoot(button);
        const modalZIndex = modalRoot
            ? Number.parseInt(window.getComputedStyle(modalRoot).zIndex || "", 10)
            : NaN;
        const fallbackZIndex = readRootZIndex("--site-modal-base-z-index", 4000) + 50;

        element.style.zIndex = Number.isFinite(modalZIndex)
            ? String(Math.max(fallbackZIndex, modalZIndex + 20))
            : "";
    }

    function positionInlineCopyFeedback(element, button) {
        const rect = button.getBoundingClientRect();
        const boundary = getInlineCopyFeedbackBoundary(button);
        const feedbackWidth = element.offsetWidth || 70;
        const feedbackHeight = element.offsetHeight || 28;
        const arrowInset = 12;
        const gap = 10;
        const centerX = rect.left + (rect.width / 2);
        const centerY = rect.top + (rect.height / 2);
        const placement = chooseInlineCopyFeedbackPlacement(rect, boundary, feedbackWidth, feedbackHeight);
        let left = centerX - (feedbackWidth / 2);
        let top = rect.top - feedbackHeight - gap;
        let arrowOffset = feedbackWidth / 2;

        element.classList.remove(
            "is-placement-top",
            "is-placement-bottom",
            "is-placement-left",
            "is-placement-right"
        );
        element.classList.add("is-placement-" + placement);

        if (placement === "bottom") {
            top = rect.bottom + gap;
        } else if (placement === "right" || placement === "left") {
            top = centerY - (feedbackHeight / 2);
            left = placement === "right"
                ? rect.right + gap
                : rect.left - feedbackWidth - gap;
        }

        left = clamp(left, boundary.left, boundary.right - feedbackWidth);
        top = clamp(top, boundary.top, boundary.bottom - feedbackHeight);

        if (placement === "right" || placement === "left") {
            arrowOffset = clamp(centerY - top, arrowInset, feedbackHeight - arrowInset);
            element.style.setProperty("--handrive-inline-copy-arrow-y", Math.round(arrowOffset) + "px");
            element.style.removeProperty("--handrive-inline-copy-arrow-x");
        } else {
            arrowOffset = clamp(centerX - left, arrowInset, feedbackWidth - arrowInset);
            element.style.setProperty("--handrive-inline-copy-arrow-x", Math.round(arrowOffset) + "px");
            element.style.removeProperty("--handrive-inline-copy-arrow-y");
        }

        element.style.left = Math.round(left) + "px";
        element.style.top = Math.round(top) + "px";
        syncInlineCopyFeedbackZIndex(element, button);
    }

    function showInlineCopyFeedback(button, label) {
        if (!button || typeof button.getBoundingClientRect !== "function" || !document.body) {
            return;
        }

        hideInlineCopyFeedback();

        const element = getInlineCopyFeedbackElement();
        const message = String(label || getInlineCopyDefaultMessage());
        const state = {
            button: button,
            element: element,
            hide: null,
            fallbackTimer: 0
        };
        state.hide = function () {
            if (activeInlineCopyFeedback === state) {
                hideInlineCopyFeedback();
            }
        };

        activeInlineCopyFeedback = state;
        element.textContent = message;
        element.hidden = false;
        element.classList.remove("is-visible");
        element.style.left = "0px";
        element.style.top = "0px";

        button.addEventListener("pointerleave", state.hide);
        button.addEventListener("blur", state.hide);
        positionInlineCopyFeedback(element, button);

        window.requestAnimationFrame(function () {
            if (activeInlineCopyFeedback !== state) {
                return;
            }
            positionInlineCopyFeedback(element, button);
            element.classList.add("is-visible");
        });

        if (!(button.matches && button.matches(":hover"))) {
            state.fallbackTimer = window.setTimeout(state.hide, 1400);
        }
    }

    function getModalRoot(target) {
        if (!target || !target.closest) return null;
        if (target.matches && target.matches(modalRootSelector)) return target;
        return target.closest(modalRootSelector);
    }

    function getDraggableDialog(header) {
        if (!header || !header.closest) return null;
        if (header.matches(".ae-drive-head")) {
            return header.closest(".ae-drive-dialog");
        }
        if (header.matches(".ve-image-upload-head")) {
            return header.closest(".ve-image-upload-panel");
        }
        return header.closest(draggableDialogSelector);
    }

    function getDragOffset(element, propertyName) {
        const value = Number.parseFloat(element.style.getPropertyValue(propertyName) || "0");
        return Number.isFinite(value) ? value : 0;
    }

    function observeDraggableDialog(dialog) {
        if (!dialog || !draggableDialogResizeObserver || observedDraggableDialogs.has(dialog)) {
            return;
        }
        observedDraggableDialogs.add(dialog);
        draggableDialogResizeObserver.observe(dialog);
    }

    function unobserveDraggableDialog(dialog) {
        if (!dialog || !draggableDialogResizeObserver || !observedDraggableDialogs.has(dialog)) {
            return;
        }
        draggableDialogResizeObserver.unobserve(dialog);
        observedDraggableDialogs.delete(dialog);
    }

    function setDialogDragOffset(dialog, x, y) {
        const nextX = String(Math.round(x)) + "px";
        const nextY = String(Math.round(y)) + "px";
        if (dialog.getAttribute("data-popup-draggable-dialog") !== "true") {
            dialog.setAttribute("data-popup-draggable-dialog", "true");
        }
        if (dialog.style.getPropertyValue("--popup-drag-x") !== nextX) {
            dialog.style.setProperty("--popup-drag-x", nextX);
        }
        if (dialog.style.getPropertyValue("--popup-drag-y") !== nextY) {
            dialog.style.setProperty("--popup-drag-y", nextY);
        }
        observeDraggableDialog(dialog);
    }

    function clampModalResizeValue(value, min, max) {
        if (min > max) {
            return (min + max) / 2;
        }
        return Math.max(min, Math.min(max, value));
    }

    function clearHelpModalResizeState() {
        if (!activeHelpModalResize) {
            return;
        }
        if (activeHelpModalResize.target) {
            activeHelpModalResize.target.classList.remove("is-handrive-help-modal-resizing");
        }
        document.body.classList.remove("handrive-help-modal-resizing");
        document.body.style.removeProperty("cursor");
        activeHelpModalResize = null;
    }

    function clearHelpModalResizeInRoot(root) {
        if (activeHelpModalResize && root && root.contains(activeHelpModalResize.target)) {
            clearHelpModalResizeState();
        }
    }

    function onHelpModalResizeMove(event) {
        if (!activeHelpModalResize || event.pointerId !== activeHelpModalResize.pointerId) {
            return;
        }
        event.preventDefault();
        const state = activeHelpModalResize;
        const margin = viewportPadding;
        const minWidth = Math.min(320, Math.max(0, state.viewportWidth - (margin * 2)));
        const minHeight = Math.min(220, Math.max(0, state.viewportHeight - (margin * 2)));
        const maxWidth = Math.max(minWidth, state.viewportWidth - (margin * 2));
        const maxHeight = Math.max(minHeight, state.viewportHeight - (margin * 2));
        const maxRight = state.viewportWidth - margin;
        const maxBottom = state.viewportHeight - margin;
        let left = state.startRect.left;
        let right = state.startRect.right;
        let top = state.startRect.top;
        let bottom = state.startRect.bottom;
        const dx = event.clientX - state.startClientX;
        const dy = event.clientY - state.startClientY;

        if (state.direction.indexOf("e") !== -1) {
            right = clampModalResizeValue(state.startRect.right + dx, left + minWidth, Math.min(maxRight, left + maxWidth));
        }
        if (state.direction.indexOf("w") !== -1) {
            left = clampModalResizeValue(state.startRect.left + dx, Math.max(margin, right - maxWidth), right - minWidth);
        }
        if (state.direction.indexOf("s") !== -1) {
            bottom = clampModalResizeValue(state.startRect.bottom + dy, top + minHeight, Math.min(maxBottom, top + maxHeight));
        }
        if (state.direction.indexOf("n") !== -1) {
            top = clampModalResizeValue(state.startRect.top + dy, Math.max(margin, bottom - maxHeight), bottom - minHeight);
        }

        const nextWidth = Math.max(minWidth, right - left);
        const nextHeight = Math.max(minHeight, bottom - top);
        const startCenterX = state.startRect.left + (state.startRect.width / 2);
        const startCenterY = state.startRect.top + (state.startRect.height / 2);
        const nextCenterX = left + (nextWidth / 2);
        const nextCenterY = top + (nextHeight / 2);

        state.target.style.width = String(Math.round(nextWidth)) + "px";
        state.target.style.height = String(Math.round(nextHeight)) + "px";
        setDialogDragOffset(
            state.target,
            state.startOffsetX + nextCenterX - startCenterX,
            state.startOffsetY + nextCenterY - startCenterY
        );
    }

    function endHelpModalResize(event) {
        if (!activeHelpModalResize || (event && event.pointerId !== activeHelpModalResize.pointerId)) {
            return;
        }
        clearHelpModalResizeState();
    }

    function onHelpModalResizePointerDown(event) {
        if (event.defaultPrevented || event.button !== 0 || event.isPrimary === false) {
            return;
        }
        const target = event.target && event.target.closest ? event.target : null;
        const handle = target ? target.closest(helpModalResizeHandleSelector) : null;
        if (!handle || !isVisible(handle)) {
            return;
        }
        const dialog = handle.closest(".handrive-help-modal-dialog");
        if (!dialog || dialog.closest("[hidden]")) {
            return;
        }
        const direction = String(handle.getAttribute("data-handrive-help-modal-resize-handle") || "").trim();
        if (!direction) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        activeHelpModalResize = {
            target: dialog,
            pointerId: event.pointerId,
            direction: direction,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startRect: dialog.getBoundingClientRect(),
            startOffsetX: getDragOffset(dialog, "--popup-drag-x"),
            startOffsetY: getDragOffset(dialog, "--popup-drag-y"),
            viewportWidth: Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0),
            viewportHeight: Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0)
        };
        dialog.style.setProperty("--handrive-help-modal-max-width", "var(--handrive-help-modal-viewport-max-width, calc(100vw - 20px))");
        setDialogDragOffset(dialog, activeHelpModalResize.startOffsetX, activeHelpModalResize.startOffsetY);
        dialog.classList.add("is-handrive-help-modal-resizing");
        document.body.classList.add("handrive-help-modal-resizing");
        document.body.style.cursor = window.getComputedStyle(handle).cursor || "nwse-resize";
        bringModalToFront(dialog);
        try {
            handle.setPointerCapture(event.pointerId);
        } catch (error) {}
    }

    function resetDialogDragOffset(dialog) {
        if (!dialog) return;
        unobserveDraggableDialog(dialog);
        dialog.removeAttribute("data-popup-draggable-dialog");
        dialog.style.removeProperty("--popup-drag-x");
        dialog.style.removeProperty("--popup-drag-y");
        dialog.classList.remove("is-popup-dragging");
        dialog.querySelectorAll(draggableHeaderSelector).forEach(function (header) {
            header.classList.remove("is-popup-dragging");
        });
    }

    function resetDraggedDialogsInRoot(root) {
        if (!root || !root.querySelectorAll) return;
        root.querySelectorAll("[data-popup-draggable-dialog]").forEach(resetDialogDragOffset);
    }

    function isInteractiveDragTarget(target, header) {
        if (!target || target === header || !target.closest) {
            return false;
        }
        const interactive = target.closest(interactiveDragSkipSelector);
        return Boolean(interactive && header.contains(interactive));
    }

    function clampDialogOffset(context, rawX, rawY) {
        const viewport = getViewportSize();
        const minX = dragMargin - context.startRect.left + context.startOffsetX;
        const maxX = viewport.width - dragMargin - context.startRect.right + context.startOffsetX;
        const minY = dragMargin - context.startRect.top + context.startOffsetY;
        const maxY = viewport.height - dragMargin - context.startRect.bottom + context.startOffsetY;
        return {
            x: clamp(rawX, minX, maxX),
            y: clamp(rawY, minY, maxY)
        };
    }

    function clampCurrentDraggableDialog(dialog) {
        if (!dialog || !isVisible(dialog)) {
            return;
        }
        const viewport = getViewportSize();
        const rect = dialog.getBoundingClientRect();
        let nextX = getDragOffset(dialog, "--popup-drag-x");
        let nextY = getDragOffset(dialog, "--popup-drag-y");
        if (rect.width > viewport.width - dragMargin * 2) {
            nextX += (viewport.width - rect.width) / 2 - rect.left;
        } else if (rect.left < dragMargin) {
            nextX += dragMargin - rect.left;
        } else if (rect.right > viewport.width - dragMargin) {
            nextX -= rect.right - (viewport.width - dragMargin);
        }
        if (rect.height > viewport.height - dragMargin * 2) {
            nextY += (viewport.height - rect.height) / 2 - rect.top;
        } else if (rect.top < dragMargin) {
            nextY += dragMargin - rect.top;
        } else if (rect.bottom > viewport.height - dragMargin) {
            nextY -= rect.bottom - (viewport.height - dragMargin);
        }
        setDialogDragOffset(dialog, nextX, nextY);
    }

    function clampDraggableDialogsToViewport() {
        document.querySelectorAll("[data-popup-draggable-dialog]").forEach(clampCurrentDraggableDialog);
    }

    function scheduleClampDraggableDialogsToViewport() {
        if (draggableClampFrame) return;
        draggableClampFrame = window.requestAnimationFrame(function () {
            draggableClampFrame = 0;
            clampDraggableDialogsToViewport();
        });
    }

    function clearModalStackStyle(element) {
        element.style.removeProperty("z-index");
        element.style.removeProperty("--site-modal-stack-z");
        element.removeAttribute("data-site-modal-stack-index");
    }

    function resetPopupFitWidth(element) {
        element.style.removeProperty("--popup-fit-max-width");
        if (element.dataset && element.dataset.popupFitMaxWidthOverride === "1") {
            element.style.removeProperty("max-width");
            delete element.dataset.popupFitMaxWidthOverride;
        }
        if (element.dataset && element.dataset.popupFitMinWidthOverride === "1") {
            element.style.removeProperty("min-width");
            delete element.dataset.popupFitMinWidthOverride;
        }
    }

    function preparePopupFitWidth(element, availableWidth) {
        if (!element.classList || !element.classList.contains("site-dropdown-menu") || element.classList.contains("site-custom-select-menu")) {
            return;
        }
        const width = Math.max(80, Math.floor(availableWidth));
        element.style.setProperty("--popup-fit-max-width", String(width) + "px");
        if (element.dataset && element.dataset.popupFitMaxWidthOverride === "1") {
            element.style.removeProperty("max-width");
            delete element.dataset.popupFitMaxWidthOverride;
        }
        if (element.dataset && element.dataset.popupFitMinWidthOverride === "1") {
            element.style.removeProperty("min-width");
            delete element.dataset.popupFitMinWidthOverride;
        }
        const computedStyle = window.getComputedStyle(element);
        const maxWidth = computedStyle.maxWidth === "none"
            ? Number.POSITIVE_INFINITY
            : Number.parseFloat(computedStyle.maxWidth || "0");
        if (Number.isFinite(maxWidth) && maxWidth > width || maxWidth === Number.POSITIVE_INFINITY) {
            element.style.maxWidth = String(width) + "px";
            if (element.dataset) {
                element.dataset.popupFitMaxWidthOverride = "1";
            }
        }
        const minWidth = Number.parseFloat(computedStyle.minWidth || "0");
        if (Number.isFinite(minWidth) && minWidth > width) {
            element.style.minWidth = "0px";
            if (element.dataset) {
                element.dataset.popupFitMinWidthOverride = "1";
            }
        }
    }

    function repositionPopup(element) {
        // Skin modal popups shift through a parent CSS variable so the child transform stack stays simple.
        const skinModalParent = element.closest(".multiplayer-skin-modal");

        if (!isVisible(element)) {
            element.style.removeProperty("--popup-fit-x-shift");
            element.style.removeProperty("--popup-fit-bottom-shift");
            element.style.removeProperty("--popup-fit-top-shift");
            resetPopupFitWidth(element);
            if (skinModalParent) {
                skinModalParent.style.removeProperty("--popup-fit-child-top-shift");
            }
            return;
        }

        element.style.setProperty("--popup-fit-x-shift", "0px");
        element.style.setProperty("--popup-fit-bottom-shift", "0px");
        element.style.setProperty("--popup-fit-top-shift", "0px");
        if (skinModalParent) {
            skinModalParent.style.setProperty("--popup-fit-child-top-shift", "0px");
        }

        const viewport = getViewportSize();
        const leftLimit = viewportPadding;
        const rightLimit = viewport.width - viewportPadding;
        const availableWidth = Math.max(80, rightLimit - leftLimit);
        preparePopupFitWidth(element, availableWidth);

        const rect = element.getBoundingClientRect();
        let shiftX = 0;
        if (rect.width > availableWidth) {
            shiftX = leftLimit - rect.left;
        } else if (rect.left < leftLimit) {
            shiftX = leftLimit - rect.left;
        } else if (rect.right > rightLimit) {
            shiftX = rightLimit - rect.right;
        }
        element.style.setProperty("--popup-fit-x-shift", String(Math.round(shiftX)) + "px");

        const viewportHeight = getViewportHeight();
        const overflowBottom = rect.bottom + viewportPadding - viewportHeight;
        const overflowTop = viewportPadding - rect.top;

        if (overflowBottom > 0) {
            const availableTopShift = Math.max(0, rect.top - viewportPadding);
            const shift = Math.min(overflowBottom, availableTopShift);
            element.style.setProperty("--popup-fit-bottom-shift", String(shift) + "px");
        }

        if (overflowTop > 0) {
            const shift = overflowTop;
            if (skinModalParent) {
                skinModalParent.style.setProperty("--popup-fit-child-top-shift", String(shift) + "px");
                element.style.setProperty("--popup-fit-top-shift", "0px");
            } else {
                element.style.setProperty("--popup-fit-top-shift", String(shift) + "px");
            }
        }
    }

    function refreshPopupPositions() {
        // Re-evaluate every registered popup because multiple overlays can be open at once.
        document.querySelectorAll(popupSelector).forEach(repositionPopup);
    }

    const refreshPopupPositionsDeferred = () => {
        // Batch repeated DOM/scroll events onto the next frame to avoid layout thrashing.
        if (popupPositionFrame) return;
        popupPositionFrame = window.requestAnimationFrame(function () {
            popupPositionFrame = 0;
            refreshPopupPositions();
        });
    };

    function syncModalZStack() {
        const openRoots = Array.from(document.querySelectorAll(modalRootSelector)).filter(isVisible);
        openRoots.forEach(function (root) {
            if (modalStack.indexOf(root) === -1) {
                modalStack.push(root);
            }
        });

        for (let index = modalStack.length - 1; index >= 0; index -= 1) {
            const root = modalStack[index];
            if (openRoots.indexOf(root) === -1) {
                clearHelpModalResizeInRoot(root);
                clearModalStackStyle(root);
                resetDraggedDialogsInRoot(root);
                modalStack.splice(index, 1);
            }
        }

        const baseZ = readRootZIndex("--site-z-modal", 1400);
        const step = Math.max(1, readRootZIndex("--site-z-modal-stack-step", 5));
        modalStack.forEach(function (root, index) {
            const zIndex = baseZ + (index * step);
            root.style.setProperty("--site-modal-stack-z", String(zIndex));
            root.style.zIndex = String(zIndex);
            root.setAttribute("data-site-modal-stack-index", String(index));
        });
    }

    function refreshModalZStackDeferred() {
        if (modalStackFrame) return;
        modalStackFrame = window.requestAnimationFrame(function () {
            modalStackFrame = 0;
            syncModalZStack();
        });
    }

    function refreshCommonPopupStateDeferred() {
        refreshPopupPositionsDeferred();
        refreshModalZStackDeferred();
        scheduleClampDraggableDialogsToViewport();
    }

    function bringModalToFront(target) {
        const root = getModalRoot(target);
        if (!root) return;
        const currentIndex = modalStack.indexOf(root);
        if (currentIndex !== -1) {
            modalStack.splice(currentIndex, 1);
        }
        modalStack.push(root);
        syncModalZStack();
    }

    function startModalHeaderDrag(event, header) {
        const dialog = getDraggableDialog(header);
        if (!dialog || dialog.closest("[hidden]")) {
            return false;
        }
        const startOffsetX = getDragOffset(dialog, "--popup-drag-x");
        const startOffsetY = getDragOffset(dialog, "--popup-drag-y");
        setDialogDragOffset(dialog, startOffsetX, startOffsetY);
        dialog.classList.add("is-popup-dragging");
        header.classList.add("is-popup-dragging");
        activeModalDrag = {
            target: dialog,
            header: header,
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startOffsetX: startOffsetX,
            startOffsetY: startOffsetY,
            startRect: dialog.getBoundingClientRect()
        };
        bringModalToFront(dialog);
        return true;
    }

    function endModalHeaderDrag(event) {
        if (!activeModalDrag || event.pointerId !== activeModalDrag.pointerId) {
            return;
        }
        activeModalDrag.target.classList.remove("is-popup-dragging");
        if (activeModalDrag.header) {
            activeModalDrag.header.classList.remove("is-popup-dragging");
        }
        document.body.classList.remove("handrive-popup-dragging");
        activeModalDrag = null;
    }

    function onModalHeaderDragMove(event) {
        if (!activeModalDrag || event.pointerId !== activeModalDrag.pointerId) {
            return;
        }
        event.preventDefault();
        const rawX = activeModalDrag.startOffsetX + event.clientX - activeModalDrag.startClientX;
        const rawY = activeModalDrag.startOffsetY + event.clientY - activeModalDrag.startClientY;
        const offset = clampDialogOffset(activeModalDrag, rawX, rawY);
        setDialogDragOffset(activeModalDrag.target, offset.x, offset.y);
    }

    function onModalHeaderPointerDown(event) {
        if (event.defaultPrevented || event.button !== 0 || event.isPrimary === false) {
            return;
        }
        const target = event.target && event.target.closest ? event.target : null;
        const header = target ? target.closest(draggableHeaderSelector) : null;
        if (!header || !isVisible(header) || isInteractiveDragTarget(target, header)) {
            return;
        }
        const started = startModalHeaderDrag(event, header);
        if (!started) {
            return;
        }
        event.preventDefault();
        document.body.classList.add("handrive-popup-dragging");
        try {
            header.setPointerCapture(event.pointerId);
        } catch (error) {}
    }

    function onProxyClickTarget(event) {
        if (event.defaultPrevented) {
            return;
        }
        const proxyButton = event.target && event.target.closest
            ? event.target.closest("[data-handrive-click-target]")
            : null;
        if (!proxyButton || proxyButton.disabled) {
            return;
        }
        const targetId = proxyButton.getAttribute("data-handrive-click-target");
        const targetElement = targetId ? document.getElementById(targetId) : null;
        if (!targetElement || typeof targetElement.click !== "function") {
            return;
        }
        event.preventDefault();
        targetElement.click();
    }

    function getCustomSelectLabel(option) {
        const visibleText = String(option ? option.textContent || "" : "").trim();
        if (option && option.hasAttribute && option.hasAttribute("data-site-custom-select-option-label")) {
            const optionLabel = String(option.getAttribute("data-site-custom-select-option-label") || "").trim();
            return visibleText && visibleText !== optionLabel ? visibleText : optionLabel;
        }
        return visibleText || String(option ? option.label || option.value || "" : "").trim();
    }

    function getCustomSelectSelectedLabel(option) {
        if (option && option.hasAttribute && option.hasAttribute("data-site-custom-select-selected-label")) {
            return String(option.getAttribute("data-site-custom-select-selected-label") || "").trim();
        }
        return getCustomSelectLabel(option);
    }

    function shouldEnhanceCustomSelect(select) {
        return Boolean(
            select &&
            select.tagName === "SELECT" &&
            !select.multiple &&
            (!select.dataset || select.dataset.siteCustomSelect !== "0")
        );
    }

    function getCustomSelectSelectedOption(select) {
        if (!select || !select.options || select.selectedIndex < 0) {
            return null;
        }
        return select.options[select.selectedIndex] || null;
    }

    function isFontFamilyCustomSelect(select) {
        return Boolean(select && select.classList && Array.prototype.some.call(select.classList, function (className) {
            return className.indexOf("font-family-select") !== -1;
        }));
    }

    function applyFontFamilyPreview(element, select, option) {
        if (!element || !isFontFamilyCustomSelect(select)) {
            return;
        }
        const value = String(option ? option.value || "" : "").trim();
        if (!value || value === "system") {
            element.style.removeProperty("font-family");
            return;
        }
        element.style.fontFamily = value;
    }

    function getCustomSelectWrapper(select) {
        if (!select || !select.closest) {
            return null;
        }
        return select.closest(".site-custom-select");
    }

    function getCustomSelectMenu(select) {
        const menuId = select && select.dataset ? select.dataset.siteCustomSelectMenuId : "";
        return menuId ? document.getElementById(menuId) : null;
    }

    function getCustomSelectButton(select) {
        const wrapper = getCustomSelectWrapper(select);
        return wrapper ? wrapper.querySelector(".site-custom-select-button") : null;
    }

    function syncCustomSelect(select) {
        if (!select || !select.dataset || select.dataset.siteCustomSelectBound !== "1") {
            return;
        }
        const wrapper = getCustomSelectWrapper(select);
        const button = getCustomSelectButton(select);
        const label = button ? button.querySelector(".site-custom-select-label") : null;
        const menu = getCustomSelectMenu(select);
        const selectedOption = getCustomSelectSelectedOption(select);
        const selectedLabel = getCustomSelectSelectedLabel(selectedOption);

        if (wrapper) {
            wrapper.hidden = select.hidden;
            wrapper.classList.toggle("is-disabled", Boolean(select.disabled));
            wrapper.setAttribute("aria-disabled", select.disabled ? "true" : "false");
        }
        if (button) {
            button.disabled = select.disabled;
            button.setAttribute("aria-disabled", select.disabled ? "true" : "false");
            button.setAttribute("aria-label", select.getAttribute("aria-label") || selectedLabel || "Select");
            applyFontFamilyPreview(button, select, selectedOption);
        }
        if (label) {
            label.textContent = selectedLabel;
        }
        if (menu) {
            Array.prototype.slice.call(menu.querySelectorAll(".site-custom-select-option")).forEach(function (item) {
                const isActive = item.getAttribute("data-value") === String(select.value || "");
                item.classList.toggle("is-active", isActive);
                item.setAttribute("aria-selected", isActive ? "true" : "false");
                if (isActive) {
                    item.setAttribute("tabindex", "0");
                } else {
                    item.setAttribute("tabindex", "-1");
                }
            });
            if (!menu.hidden) {
                positionCustomSelectMenu(select);
            }
        }
    }

    function syncCustomSelectDeferred(select) {
        window.requestAnimationFrame(function () {
            syncCustomSelect(select);
        });
    }

    function syncAllCustomSelects() {
        customSelects.forEach(syncCustomSelect);
    }

    function bindCustomSelectValueProperty(select) {
        if (!selectValueDescriptor || !selectValueDescriptor.get || !selectValueDescriptor.set) {
            return;
        }
        if (select.dataset.siteCustomSelectValueBound === "1") {
            return;
        }
        try {
            Object.defineProperty(select, "value", {
                configurable: true,
                enumerable: false,
                get: function () {
                    return selectValueDescriptor.get.call(this);
                },
                set: function (value) {
                    selectValueDescriptor.set.call(this, value);
                    syncCustomSelectDeferred(this);
                }
            });
            select.dataset.siteCustomSelectValueBound = "1";
        } catch (error) {}
    }

    function copyCustomSelectVisualStyle(select, wrapper) {
        if (!select || !wrapper) {
            return;
        }
        const computed = window.getComputedStyle(select);
        const rect = select.getBoundingClientRect();
        const styleProps = [
            "min-width",
            "max-width",
            "min-height",
            "max-height",
            "border-top",
            "border-right",
            "border-bottom",
            "border-left",
            "border-radius",
            "background",
            "background-color",
            "box-shadow",
            "box-sizing",
            "color",
            "cursor",
            "font-family",
            "font-size",
            "font-style",
            "font-weight",
            "font-variant",
            "letter-spacing",
            "line-height",
            "padding-top",
            "padding-right",
            "padding-bottom",
            "padding-left",
            "text-align",
            "text-transform"
        ];
        if (rect.width > 0) {
            wrapper.style.width = Math.round(rect.width) + "px";
        } else if (computed.width && computed.width !== "auto") {
            wrapper.style.width = computed.width;
        }
        if (rect.height > 0) {
            wrapper.style.height = Math.round(rect.height) + "px";
        } else if (computed.height && computed.height !== "auto") {
            wrapper.style.height = computed.height;
        }
        styleProps.forEach(function (property) {
            const value = computed.getPropertyValue(property);
            if ((property === "min-width" || property === "min-height") && value === "0px") {
                return;
            }
            if (value) {
                wrapper.style.setProperty(property, value);
            }
        });
        wrapper.style.setProperty("padding-right", "0px");
    }

    function getCustomSelectViewport() {
        if (window.visualViewport) {
            return {
                left: window.visualViewport.offsetLeft || 0,
                top: window.visualViewport.offsetTop || 0,
                width: window.visualViewport.width || window.innerWidth,
                height: window.visualViewport.height || window.innerHeight
            };
        }
        return {
            left: 0,
            top: 0,
            width: window.innerWidth,
            height: window.innerHeight
        };
    }

    function getCustomSelectMenuZIndex(select) {
        if (select && select.classList && select.classList.contains("handrive-guest-demo-steps")) {
            return readRootZIndex("--handrive-tutorial-step-select-menu-z", 1241);
        }
        const root = getModalRoot(select);
        if (root && isVisible(root)) {
            const inlineValue = Number.parseInt(root.style.zIndex || "", 10);
            const computedValue = Number.parseInt(window.getComputedStyle(root).zIndex || "", 10);
            const rootZIndex = Number.isFinite(inlineValue) ? inlineValue : computedValue;
            if (Number.isFinite(rootZIndex)) {
                return rootZIndex + 2;
            }
        }
        return readRootZIndex("--site-z-popup-raised", 1125);
    }

    function positionCustomSelectMenu(select) {
        const wrapper = getCustomSelectWrapper(select);
        const menu = getCustomSelectMenu(select);
        if (!wrapper || !menu || menu.hidden || !isVisible(wrapper)) {
            return;
        }
        const viewport = getCustomSelectViewport();
        const rect = wrapper.getBoundingClientRect();
        const gap = 4;
        const minWidth = Math.max(96, rect.width);
        const maxWidth = Math.max(minWidth, viewport.width - viewportPadding * 2);
        menu.style.minWidth = Math.round(minWidth) + "px";
        menu.style.maxWidth = Math.round(maxWidth) + "px";
        menu.style.zIndex = String(getCustomSelectMenuZIndex(select));
        menu.style.setProperty("--site-custom-select-menu-max-height", "260px");

        const menuRect = menu.getBoundingClientRect();
        const spaceBelow = viewport.top + viewport.height - rect.bottom - viewportPadding - gap;
        const spaceAbove = rect.top - viewport.top - viewportPadding - gap;
        const openAbove = menuRect.height > spaceBelow && spaceAbove > spaceBelow;
        const availableHeight = Math.max(80, Math.floor(openAbove ? spaceAbove : spaceBelow));
        menu.style.setProperty("--site-custom-select-menu-max-height", Math.min(260, availableHeight) + "px");

        const measuredHeight = Math.min(menu.scrollHeight || menuRect.height, Math.min(260, availableHeight));
        const top = openAbove
            ? Math.max(viewport.top + viewportPadding, rect.top - measuredHeight - gap)
            : Math.min(viewport.top + viewport.height - viewportPadding - measuredHeight, rect.bottom + gap);
        const left = clamp(rect.left, viewport.left + viewportPadding, viewport.left + viewport.width - viewportPadding - minWidth);
        menu.style.left = Math.round(left) + "px";
        menu.style.top = Math.round(top) + "px";
    }

    function positionOpenCustomSelects() {
        customSelects.forEach(function (select) {
            const menu = getCustomSelectMenu(select);
            if (menu && !menu.hidden) {
                positionCustomSelectMenu(select);
            }
        });
    }

    function closeCustomSelect(select) {
        const wrapper = getCustomSelectWrapper(select);
        const menu = getCustomSelectMenu(select);
        const button = getCustomSelectButton(select);
        if (wrapper) {
            wrapper.classList.remove("is-open");
        }
        if (button) {
            button.setAttribute("aria-expanded", "false");
        }
        if (menu) {
            menu.hidden = true;
            menu.setAttribute("aria-hidden", "true");
        }
        if (activeCustomSelect === select) {
            activeCustomSelect = null;
        }
    }

    function closeAllCustomSelects(exceptSelect) {
        customSelects.forEach(function (select) {
            if (select !== exceptSelect) {
                closeCustomSelect(select);
            }
        });
    }

    function focusCustomSelectOption(menu, option) {
        if (!menu || !option || typeof option.focus !== "function") {
            return;
        }
        Array.prototype.slice.call(menu.querySelectorAll(".site-custom-select-option")).forEach(function (item) {
            item.setAttribute("tabindex", item === option ? "0" : "-1");
        });
        option.focus({ preventScroll: true });
        if (typeof option.scrollIntoView === "function") {
            option.scrollIntoView({ block: "nearest" });
        }
    }

    function chooseCustomSelectOption(select, option) {
        if (!select || !option || option.disabled) {
            return;
        }
        const nextValue = option.getAttribute("data-value");
        const changed = String(select.value || "") !== String(nextValue || "");
        select.value = nextValue;
        syncCustomSelect(select);
        if (changed) {
            select.dispatchEvent(new Event("input", { bubbles: true }));
            select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        closeCustomSelect(select);
        const button = getCustomSelectButton(select);
        if (button) {
            button.focus({ preventScroll: true });
        }
    }

    function rebuildCustomSelectOptions(select) {
        const menu = getCustomSelectMenu(select);
        if (!select || !menu) {
            return;
        }
        menu.innerHTML = "";
        Array.prototype.slice.call(select.options || []).forEach(function (option) {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "site-custom-select-option";
            item.setAttribute("role", "option");
            item.setAttribute("data-value", String(option.value || ""));
            item.textContent = getCustomSelectLabel(option);
            item.disabled = Boolean(option.disabled);
            applyFontFamilyPreview(item, select, option);
            item.addEventListener("click", function () {
                chooseCustomSelectOption(select, item);
            });
            menu.appendChild(item);
        });
        syncCustomSelect(select);
    }

    function openCustomSelect(select) {
        const wrapper = getCustomSelectWrapper(select);
        const menu = getCustomSelectMenu(select);
        const button = getCustomSelectButton(select);
        if (!select || select.disabled || select.hidden || !wrapper || !menu || !button) {
            return;
        }
        closeAllCustomSelects(select);
        rebuildCustomSelectOptions(select);
        activeCustomSelect = select;
        wrapper.classList.add("is-open");
        button.setAttribute("aria-expanded", "true");
        menu.hidden = false;
        menu.setAttribute("aria-hidden", "false");
        positionCustomSelectMenu(select);
        const activeOption = menu.querySelector(".site-custom-select-option.is-active:not(:disabled)") ||
            menu.querySelector(".site-custom-select-option:not(:disabled)");
        if (activeOption) {
            focusCustomSelectOption(menu, activeOption);
        }
    }

    function toggleCustomSelect(select) {
        const wrapper = getCustomSelectWrapper(select);
        if (wrapper && wrapper.classList.contains("is-open")) {
            closeCustomSelect(select);
            return;
        }
        openCustomSelect(select);
    }

    function onCustomSelectButtonKeydown(event, select) {
        if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openCustomSelect(select);
            return;
        }
        if (event.key === "Escape") {
            closeCustomSelect(select);
        }
    }

    function onCustomSelectMenuKeydown(event, select) {
        const menu = getCustomSelectMenu(select);
        if (!menu) {
            return;
        }
        const options = Array.prototype.slice.call(menu.querySelectorAll(".site-custom-select-option:not(:disabled)"));
        const currentIndex = Math.max(0, options.indexOf(document.activeElement));
        if (event.key === "Escape") {
            event.preventDefault();
            closeCustomSelect(select);
            const button = getCustomSelectButton(select);
            if (button) {
                button.focus({ preventScroll: true });
            }
            return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
            event.preventDefault();
            if (!options.length) {
                return;
            }
            let nextIndex = currentIndex;
            if (event.key === "ArrowDown") {
                nextIndex = Math.min(options.length - 1, currentIndex + 1);
            } else if (event.key === "ArrowUp") {
                nextIndex = Math.max(0, currentIndex - 1);
            } else if (event.key === "Home") {
                nextIndex = 0;
            } else if (event.key === "End") {
                nextIndex = options.length - 1;
            }
            focusCustomSelectOption(menu, options[nextIndex]);
            return;
        }
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            const option = document.activeElement && document.activeElement.closest
                ? document.activeElement.closest(".site-custom-select-option")
                : null;
            chooseCustomSelectOption(select, option);
        }
    }

    function enhanceCustomSelect(select) {
        if (!shouldEnhanceCustomSelect(select)) {
            return;
        }
        if (select.dataset.siteCustomSelectBound === "1") {
            syncCustomSelect(select);
            return;
        }
        const wrapper = document.createElement("span");
        wrapper.className = ["site-custom-select"].concat(Array.prototype.slice.call(select.classList)).join(" ").trim();
        wrapper.hidden = select.hidden;
        copyCustomSelectVisualStyle(select, wrapper);

        const button = document.createElement("button");
        button.type = "button";
        button.className = "site-custom-select-button";
        button.setAttribute("aria-haspopup", "listbox");
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-label", select.getAttribute("aria-label") || "Select");

        const label = document.createElement("span");
        label.className = "site-custom-select-label";
        const caret = document.createElement("span");
        caret.className = "site-custom-select-caret";
        caret.setAttribute("aria-hidden", "true");
        button.appendChild(label);
        button.appendChild(caret);

        const menu = document.createElement("div");
        const menuId = "site-custom-select-menu-" + String(++customSelectIdCounter);
        menu.id = menuId;
        menu.className = "site-custom-select-menu site-dropdown-menu";
        if (select.classList && select.classList.contains("handrive-guest-demo-steps")) {
            menu.classList.add("handrive-guest-demo-steps-menu");
        }
        menu.setAttribute("role", "listbox");
        menu.setAttribute("aria-hidden", "true");
        menu.hidden = true;

        select.parentNode.insertBefore(wrapper, select);
        wrapper.appendChild(select);
        wrapper.appendChild(button);
        document.body.appendChild(menu);

        select.dataset.siteCustomSelectBound = "1";
        select.dataset.siteCustomSelectMenuId = menuId;
        select.classList.add("site-custom-select-native");
        select.setAttribute("aria-hidden", "true");
        select.tabIndex = -1;
        button.setAttribute("aria-controls", menuId);

        bindCustomSelectValueProperty(select);
        button.addEventListener("click", function (event) {
            event.preventDefault();
            toggleCustomSelect(select);
        });
        button.addEventListener("keydown", function (event) {
            onCustomSelectButtonKeydown(event, select);
        });
        menu.addEventListener("keydown", function (event) {
            onCustomSelectMenuKeydown(event, select);
        });
        select.addEventListener("input", function () {
            syncCustomSelect(select);
        });
        select.addEventListener("change", function () {
            syncCustomSelect(select);
        });

        const selectObserver = new MutationObserver(function () {
            rebuildCustomSelectOptions(select);
        });
        selectObserver.observe(select, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["hidden", "disabled", "selected", "label", "value", "style"]
        });

        customSelects.add(select);
        rebuildCustomSelectOptions(select);
    }

    function enhanceCustomSelects(root) {
        const scope = root && root.querySelectorAll ? root : document;
        const selects = [];
        if (scope.matches && scope.matches("select:not([multiple])")) {
            selects.push(scope);
        }
        Array.prototype.slice.call(scope.querySelectorAll("select:not([multiple])")).forEach(function (select) {
            selects.push(select);
        });
        selects.forEach(enhanceCustomSelect);
    }

    function initializeCommonPopupState() {
        enhanceCustomSelects(document);
        refreshCommonPopupStateDeferred();
    }

    function handleCommonDomMutation(records) {
        let shouldEnhanceSelects = false;
        const selectsToSync = new Set();
        Array.prototype.slice.call(records || []).forEach(function (record) {
            if (record.type === "childList") {
                Array.prototype.slice.call(record.addedNodes || []).forEach(function (node) {
                    if (!node || node.nodeType !== 1) {
                        return;
                    }
                    if ((node.matches && node.matches("select:not([multiple])")) ||
                        (node.querySelector && node.querySelector("select:not([multiple])"))) {
                        shouldEnhanceSelects = true;
                    }
                });
                return;
            }
            if (record.type === "attributes") {
                const target = record.target;
                if (target && target.matches && target.matches("select")) {
                    if (record.attributeName === "data-site-custom-select") {
                        shouldEnhanceSelects = true;
                    }
                    if (target.dataset && target.dataset.siteCustomSelectBound === "1") {
                        selectsToSync.add(target);
                    }
                }
            }
        });
        if (shouldEnhanceSelects) {
            enhanceCustomSelects(document);
        }
        selectsToSync.forEach(syncCustomSelect);
        refreshCommonPopupStateDeferred();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initializeCommonPopupState, { once: true });
    } else {
        initializeCommonPopupState();
    }

    window.addEventListener("resize", function () {
        refreshCommonPopupStateDeferred();
        scheduleClampDraggableDialogsToViewport();
        positionOpenCustomSelects();
        hideInlineCopyFeedback();
    });
    window.addEventListener("scroll", function () {
        refreshPopupPositionsDeferred();
        positionOpenCustomSelects();
        hideInlineCopyFeedback();
    }, true);

    if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", function () {
            refreshCommonPopupStateDeferred();
            scheduleClampDraggableDialogsToViewport();
            positionOpenCustomSelects();
            hideInlineCopyFeedback();
        });
        window.visualViewport.addEventListener("scroll", function () {
            refreshPopupPositionsDeferred();
            positionOpenCustomSelects();
            hideInlineCopyFeedback();
        });
    }

    document.addEventListener("pointerdown", function (event) {
        const customSelectTarget = event.target && event.target.closest
            ? event.target.closest(".site-custom-select, .site-custom-select-menu")
            : null;
        if (!customSelectTarget) {
            closeAllCustomSelects();
        }
        const root = getModalRoot(event.target);
        if (root && isVisible(root)) {
            bringModalToFront(root);
        }
    }, true);

    document.addEventListener("click", onProxyClickTarget);

    if (window.PointerEvent) {
        document.addEventListener("pointerdown", onHelpModalResizePointerDown);
        document.addEventListener("pointermove", onHelpModalResizeMove, { passive: false });
        document.addEventListener("pointerup", endHelpModalResize);
        document.addEventListener("pointercancel", endHelpModalResize);
        document.addEventListener("pointerdown", onModalHeaderPointerDown);
        document.addEventListener("pointermove", onModalHeaderDragMove, { passive: false });
        document.addEventListener("pointerup", endModalHeaderDrag);
        document.addEventListener("pointercancel", endModalHeaderDrag);
    }

    document.addEventListener("focusin", function (event) {
        const root = getModalRoot(event.target);
        if (root && isVisible(root)) {
            bringModalToFront(root);
        }
    }, true);

    window.SiteModalStack = {
        selector: modalRootSelector,
        sync: syncModalZStack,
        bringToFront: bringModalToFront
    };
    window.SiteCustomSelect = {
        enhance: enhanceCustomSelects,
        refresh: syncAllCustomSelects,
        closeAll: closeAllCustomSelects
    };
    window.showHandriveInlineCopyFeedback = showInlineCopyFeedback;

    const observer = new MutationObserver(handleCommonDomMutation);
    // Watch for popup visibility/class changes so positioning also updates when menus open without resize/scroll.
    observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["hidden", "class", "style", "aria-hidden", "disabled", "data-site-custom-select"],
    });
})();
