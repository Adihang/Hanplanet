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

    function syncPreviewImageZoom(previewContent, previewZoomWrap, nextZoom) {
        var imageWrap = previewContent
            ? previewContent.querySelector(".handrive-media-image-wrap")
            : null;
        var hasImage = Boolean(imageWrap);
        if (previewZoomWrap) {
            previewZoomWrap.hidden = !hasImage;
        }
        if (!hasImage) {
            return;
        }
        imageWrap.style.transform = "scale(" + String(nextZoom) + ")";
        if (previewContent) {
            previewContent.scrollLeft = 0;
            previewContent.scrollTop = 0;
        }
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
        syncPreviewImageZoom: syncPreviewImageZoom,
    };
})();
