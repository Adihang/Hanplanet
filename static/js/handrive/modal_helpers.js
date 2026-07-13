(function () {
    "use strict";

    // Modal helpers keep open/close state and checkbox list rendering outside page.js so the
    // page controller only manages target entries and follow-up API calls.

    var popupDragInitialized = false;
    var activePopupDrag = null;
    var draggedElementClampFrame = 0;
    var DRAG_MARGIN = 8;
    var DRAGGABLE_HEADER_SELECTOR = ".handrive-popup-head, .handrive-job-queue-head";
    var MODAL_DIALOG_SELECTOR = ".handrive-popup-modal-dialog, .handrive-folder-modal-dialog";
    var MODAL_ROOT_SELECTOR = ".handrive-popup-modal, .handrive-folder-modal";
    var INTERACTIVE_DRAG_SKIP_SELECTOR = [
        "button",
        "a",
        "input",
        "textarea",
        "select",
        "label",
        "summary",
        "[role='button']",
        "[contenteditable='true']",
    ].join(",");
    var observedDraggedElements = typeof WeakSet !== "undefined" ? new WeakSet() : null;
    var draggedElementResizeObserver = window.ResizeObserver
        ? new window.ResizeObserver(function () {
            scheduleClampDraggedElementsToViewport();
        })
        : null;

    function getViewportSize() {
        return {
            width: Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0),
            height: Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0),
        };
    }

    function clamp(value, min, max) {
        if (min > max) {
            return (min + max) / 2;
        }
        return Math.max(min, Math.min(max, value));
    }

    function getDragOffset(element, propertyName) {
        var raw = element.style.getPropertyValue(propertyName);
        var value = parseFloat(raw || "0");
        return isFinite(value) ? value : 0;
    }

    function observeDraggedElement(element) {
        if (!element || !draggedElementResizeObserver || !observedDraggedElements || observedDraggedElements.has(element)) {
            return;
        }
        observedDraggedElements.add(element);
        draggedElementResizeObserver.observe(element);
    }

    function unobserveDraggedElement(element) {
        if (!element || !draggedElementResizeObserver || !observedDraggedElements || !observedDraggedElements.has(element)) {
            return;
        }
        draggedElementResizeObserver.unobserve(element);
        observedDraggedElements.delete(element);
    }

    function setModalDragOffset(dialog, x, y) {
        var nextX = Math.round(x) + "px";
        var nextY = Math.round(y) + "px";
        if (dialog.getAttribute("data-popup-draggable-dialog") !== "true") {
            dialog.setAttribute("data-popup-draggable-dialog", "true");
        }
        if (dialog.style.getPropertyValue("--popup-drag-x") !== nextX) {
            dialog.style.setProperty("--popup-drag-x", nextX);
        }
        if (dialog.style.getPropertyValue("--popup-drag-y") !== nextY) {
            dialog.style.setProperty("--popup-drag-y", nextY);
        }
        observeDraggedElement(dialog);
    }

    function appendPopupTargetPathPart(target, text, className) {
        if (!target || !text) {
            return;
        }
        var span = document.createElement("span");
        span.className = className;
        span.textContent = text;
        target.appendChild(span);
    }

    function renderPopupTargetPath(target, value) {
        if (!target) {
            return;
        }
        var raw = String(value || "").trim();
        target.textContent = "";
        target.setAttribute("title", raw);
        if (!raw) {
            return;
        }

        var prefix = "";
        var suffix = "";
        var pathText = raw;
        var suffixMatch = pathText.match(/(\s+·\s+.*)$/);
        if (suffixMatch) {
            suffix = suffixMatch[1];
            pathText = pathText.slice(0, -suffix.length);
        }
        var prefixMatch = pathText.match(/^([^/]*?:\s+)(.+)$/);
        if (prefixMatch) {
            prefix = prefixMatch[1];
            pathText = prefixMatch[2];
        }

        var parts = pathText.split(/(\s*\/\s*)/).filter(function (part) {
            return part !== "";
        });
        var lastSegmentIndex = -1;
        parts.forEach(function (part, index) {
            if (part.indexOf("/") === -1 && part.trim()) {
                lastSegmentIndex = index;
            }
        });

        appendPopupTargetPathPart(target, prefix, "handrive-popup-target-prefix");
        if (lastSegmentIndex === -1) {
            appendPopupTargetPathPart(target, pathText, "handrive-popup-target-current");
        } else {
            parts.forEach(function (part, index) {
                appendPopupTargetPathPart(
                    target,
                    part,
                    part.indexOf("/") !== -1
                        ? "handrive-popup-target-separator"
                        : (index === lastSegmentIndex ? "handrive-popup-target-current" : "handrive-popup-target-segment")
                );
            });
        }
        appendPopupTargetPathPart(target, suffix, "handrive-popup-target-suffix");
    }

    function resetModalDragOffset(dialog) {
        if (!dialog) {
            return;
        }
        unobserveDraggedElement(dialog);
        dialog.removeAttribute("data-popup-draggable-dialog");
        dialog.style.removeProperty("--popup-drag-x");
        dialog.style.removeProperty("--popup-drag-y");
        dialog.classList.remove("is-popup-dragging");
        var head = dialog.querySelector(":scope > .handrive-popup-head");
        if (head) {
            head.classList.remove("is-popup-dragging");
        }
    }

    function resetDraggedModalsInRoot(root) {
        if (!root) {
            return;
        }
        Array.prototype.slice.call(root.querySelectorAll("[data-popup-draggable-dialog]")).forEach(resetModalDragOffset);
    }

    function watchModalRootForReset(root) {
        if (!root || root._handrivePopupDragObserver) {
            return;
        }
        var observer = new MutationObserver(function () {
            if (root.hidden) {
                resetDraggedModalsInRoot(root);
            }
        });
        observer.observe(root, { attributes: true, attributeFilter: ["hidden"] });
        root._handrivePopupDragObserver = observer;
    }

    function isInteractiveDragTarget(target, header) {
        if (!target || target === header || !target.closest) {
            return false;
        }
        var interactive = target.closest(INTERACTIVE_DRAG_SKIP_SELECTOR);
        return Boolean(interactive && header.contains(interactive));
    }

    function clampModalOffset(context, rawX, rawY) {
        var viewport = getViewportSize();
        var minX = DRAG_MARGIN - context.startRect.left + context.startOffsetX;
        var maxX = viewport.width - DRAG_MARGIN - context.startRect.right + context.startOffsetX;
        var minY = DRAG_MARGIN - context.startRect.top + context.startOffsetY;
        var maxY = viewport.height - DRAG_MARGIN - context.startRect.bottom + context.startOffsetY;
        return {
            x: clamp(rawX, minX, maxX),
            y: clamp(rawY, minY, maxY),
        };
    }

    function clampCurrentModalDialogToViewport(dialog) {
        if (!dialog || dialog.closest("[hidden]")) {
            return;
        }
        var viewport = getViewportSize();
        var rect = dialog.getBoundingClientRect();
        var nextX = getDragOffset(dialog, "--popup-drag-x");
        var nextY = getDragOffset(dialog, "--popup-drag-y");
        if (rect.width > viewport.width - DRAG_MARGIN * 2) {
            nextX += (viewport.width - rect.width) / 2 - rect.left;
        } else if (rect.left < DRAG_MARGIN) {
            nextX += DRAG_MARGIN - rect.left;
        } else if (rect.right > viewport.width - DRAG_MARGIN) {
            nextX -= rect.right - (viewport.width - DRAG_MARGIN);
        }
        if (rect.height > viewport.height - DRAG_MARGIN * 2) {
            nextY += (viewport.height - rect.height) / 2 - rect.top;
        } else if (rect.top < DRAG_MARGIN) {
            nextY += DRAG_MARGIN - rect.top;
        } else if (rect.bottom > viewport.height - DRAG_MARGIN) {
            nextY -= rect.bottom - (viewport.height - DRAG_MARGIN);
        }
        setModalDragOffset(dialog, nextX, nextY);
    }

    function clampFixedPanelPosition(panel, left, top) {
        var viewport = getViewportSize();
        var rect = panel.getBoundingClientRect();
        var maxLeft = viewport.width - DRAG_MARGIN - rect.width;
        var maxTop = viewport.height - DRAG_MARGIN - rect.height;
        return {
            left: clamp(left, DRAG_MARGIN, maxLeft),
            top: clamp(top, DRAG_MARGIN, maxTop),
        };
    }

    function setFixedPanelPosition(panel, left, top) {
        var clamped = clampFixedPanelPosition(panel, left, top);
        var nextLeft = Math.round(clamped.left) + "px";
        var nextTop = Math.round(clamped.top) + "px";
        if (panel.getAttribute("data-popup-draggable-panel") !== "true") {
            panel.setAttribute("data-popup-draggable-panel", "true");
        }
        if (panel.style.left !== nextLeft) {
            panel.style.left = nextLeft;
        }
        if (panel.style.top !== nextTop) {
            panel.style.top = nextTop;
        }
        if (panel.style.right !== "auto") {
            panel.style.right = "auto";
        }
        if (panel.style.bottom !== "auto") {
            panel.style.bottom = "auto";
        }
        observeDraggedElement(panel);
    }

    function startModalHeaderDrag(event, header) {
        var dialog = header.closest(MODAL_DIALOG_SELECTOR);
        if (!dialog || dialog.closest("[hidden]")) {
            return false;
        }
        var root = dialog.closest(MODAL_ROOT_SELECTOR);
        var startOffsetX = getDragOffset(dialog, "--popup-drag-x");
        var startOffsetY = getDragOffset(dialog, "--popup-drag-y");
        setModalDragOffset(dialog, startOffsetX, startOffsetY);
        dialog.classList.add("is-popup-dragging");
        header.classList.add("is-popup-dragging");
        watchModalRootForReset(root);
        activePopupDrag = {
            type: "modal",
            target: dialog,
            header: header,
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startOffsetX: startOffsetX,
            startOffsetY: startOffsetY,
            startRect: dialog.getBoundingClientRect(),
        };
        return true;
    }

    function startJobQueueHeaderDrag(event, header) {
        var panel = header.closest(".handrive-job-queue-panel");
        if (!panel || panel.hidden) {
            return false;
        }
        var rect = panel.getBoundingClientRect();
        panel.classList.add("is-popup-dragging");
        header.classList.add("is-popup-dragging");
        panel.style.width = Math.round(rect.width) + "px";
        setFixedPanelPosition(panel, rect.left, rect.top);
        activePopupDrag = {
            type: "fixed-panel",
            target: panel,
            header: header,
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startLeft: rect.left,
            startTop: rect.top,
        };
        return true;
    }

    function endPopupDrag() {
        if (!activePopupDrag) {
            return;
        }
        activePopupDrag.target.classList.remove("is-popup-dragging");
        if (activePopupDrag.header) {
            activePopupDrag.header.classList.remove("is-popup-dragging");
        }
        document.body.classList.remove("handrive-popup-dragging");
        activePopupDrag = null;
    }

    function onPopupDragMove(event) {
        if (!activePopupDrag || event.pointerId !== activePopupDrag.pointerId) {
            return;
        }
        event.preventDefault();
        if (activePopupDrag.type === "modal") {
            var rawX = activePopupDrag.startOffsetX + event.clientX - activePopupDrag.startClientX;
            var rawY = activePopupDrag.startOffsetY + event.clientY - activePopupDrag.startClientY;
            var offset = clampModalOffset(activePopupDrag, rawX, rawY);
            setModalDragOffset(activePopupDrag.target, offset.x, offset.y);
            return;
        }
        setFixedPanelPosition(
            activePopupDrag.target,
            activePopupDrag.startLeft + event.clientX - activePopupDrag.startClientX,
            activePopupDrag.startTop + event.clientY - activePopupDrag.startClientY
        );
    }

    function onPopupDragEnd(event) {
        if (!activePopupDrag || event.pointerId !== activePopupDrag.pointerId) {
            return;
        }
        endPopupDrag();
    }

    function onPopupHeaderPointerDown(event) {
        if (event.defaultPrevented || event.button !== 0 || event.isPrimary === false) {
            return;
        }
        var target = event.target && event.target.closest ? event.target : null;
        var header = target ? target.closest(DRAGGABLE_HEADER_SELECTOR) : null;
        if (!header || isInteractiveDragTarget(target, header)) {
            return;
        }
        var started = header.classList.contains("handrive-job-queue-head")
            ? startJobQueueHeaderDrag(event, header)
            : startModalHeaderDrag(event, header);
        if (!started) {
            return;
        }
        event.preventDefault();
        document.body.classList.add("handrive-popup-dragging");
        try {
            header.setPointerCapture(event.pointerId);
        } catch (error) {}
    }

    function clampDraggedElementsToViewport() {
        Array.prototype.slice.call(document.querySelectorAll("[data-popup-draggable-dialog]")).forEach(clampCurrentModalDialogToViewport);
        Array.prototype.slice.call(document.querySelectorAll("[data-popup-draggable-panel]")).forEach(function (panel) {
            if (!panel || panel.hidden || panel.closest("[hidden]")) {
                return;
            }
            var rect = panel.getBoundingClientRect();
            setFixedPanelPosition(panel, rect.left, rect.top);
        });
    }

    function scheduleClampDraggedElementsToViewport() {
        if (draggedElementClampFrame) {
            return;
        }
        draggedElementClampFrame = window.requestAnimationFrame(function () {
            draggedElementClampFrame = 0;
            clampDraggedElementsToViewport();
        });
    }

    function enablePopupDragging() {
        if (popupDragInitialized || !window.PointerEvent) {
            return;
        }
        popupDragInitialized = true;
        document.addEventListener("pointerdown", onPopupHeaderPointerDown);
        document.addEventListener("pointermove", onPopupDragMove, { passive: false });
        document.addEventListener("pointerup", onPopupDragEnd);
        document.addEventListener("pointercancel", onPopupDragEnd);
        window.addEventListener("resize", scheduleClampDraggedElementsToViewport);
    }

    function getRenameInputSelectionEnd(entry, value) {
        const text = String(value || "");
        if (!entry || entry.type !== "file") {
            return text.length;
        }
        const dotIndex = text.lastIndexOf(".");
        if (dotIndex > 0 && dotIndex < text.length - 1) {
            return dotIndex;
        }
        return text.length;
    }

    function focusRenameInput(renameInput, entry) {
        if (!renameInput) {
            return;
        }
        const selectionEnd = getRenameInputSelectionEnd(entry, renameInput.value);
        renameInput.focus();
        try {
            renameInput.setSelectionRange(0, selectionEnd);
        } catch (error) {
            renameInput.select();
        }
        try {
            renameInput.scrollLeft = 0;
        } catch (error) {}
        if (typeof window.requestAnimationFrame === "function") {
            window.requestAnimationFrame(function () {
                try {
                    renameInput.scrollLeft = 0;
                } catch (error) {}
            });
        }
    }

    function setRenameModalOpen(modal, renameTarget, renameInput, syncModalBodyState, opened, entry, getEntryEditableName, targetLabel) {
        if (!modal) {
            return;
        }
        modal.hidden = !opened;
        if (typeof syncModalBodyState === "function") {
            syncModalBodyState();
        }
        if (!opened) {
            return;
        }
        if (renameTarget) {
            renderPopupTargetPath(renameTarget, targetLabel || (entry ? entry.path : ""));
        }
        if (renameInput) {
            renameInput.value = typeof getEntryEditableName === "function" ? getEntryEditableName(entry) : "";
            focusRenameInput(renameInput, entry);
        }
    }

    function setFolderCreateModalOpen(modal, folderCreateTarget, folderCreateInput, syncModalBodyState, opened, entry, targetLabel) {
        if (!modal) {
            return;
        }
        modal.hidden = !opened;
        if (typeof syncModalBodyState === "function") {
            syncModalBodyState();
        }
        if (!opened) {
            return;
        }
        if (folderCreateTarget) {
            renderPopupTargetPath(folderCreateTarget, targetLabel || "");
        }
        if (folderCreateInput) {
            folderCreateInput.value = "";
            folderCreateInput.focus();
            folderCreateInput.select();
        }
    }

    function setFolderIconModalOpen(modal, folderIconTarget, folderIconFileInput, syncModalBodyState, opened, entry, targetLabel) {
        if (!modal) {
            return;
        }
        modal.hidden = !opened;
        if (typeof syncModalBodyState === "function") {
            syncModalBodyState();
        }
        if (!opened) {
            if (folderIconFileInput) {
                folderIconFileInput.value = "";
            }
            return;
        }
        if (folderIconTarget) {
            renderPopupTargetPath(folderIconTarget, targetLabel || "");
        }
        if (folderIconFileInput) {
            folderIconFileInput.focus();
        }
    }

    window.HandriveModalHelpers = {
        setFolderCreateModalOpen: setFolderCreateModalOpen,
        setFolderIconModalOpen: setFolderIconModalOpen,
        enablePopupDragging: enablePopupDragging,
        renderPopupTargetPath: renderPopupTargetPath,
        setRenameModalOpen: setRenameModalOpen,
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", enablePopupDragging, { once: true });
    } else {
        enablePopupDragging();
    }
})();
