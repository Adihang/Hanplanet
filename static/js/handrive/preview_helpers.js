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
        previewPanel.hidden = !visible;
        previewPanel.setAttribute("aria-hidden", visible ? "false" : "true");
        if (listLayout) {
            listLayout.classList.toggle("has-preview", visible);
        }
        if (typeof onAfterChange === "function") {
            onAfterChange();
        }
    }

    function scrollPreviewIntoViewIfPortrait(previewPanel) {
        if (!previewPanel || previewPanel.hidden) {
            return;
        }
        var isPortrait = window.innerHeight > window.innerWidth;
        if (!isPortrait) {
            return;
        }
        var scrollToPreviewTop = function () {
            var previewTop = previewPanel.getBoundingClientRect().top + window.pageYOffset;
            window.scrollTo({
                top: Math.max(0, Math.floor(previewTop)),
                behavior: "smooth",
            });
        };
        window.requestAnimationFrame(function () {
            window.requestAnimationFrame(function () {
                scrollToPreviewTop();
            });
        });
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
        return Math.max(0.05, Math.min(1, availableWidth / naturalWidth));
    }

    function syncPreviewImageZoom(previewContent, previewZoomWrap, nextZoom) {
        // Image previews reset scroll when zoom changes so users never land on stale pan offsets.
        var imageElement = getPreviewImageElement(previewContent);
        var imageWrap = previewContent
            ? previewContent.querySelector(".handrive-media-image-wrap")
            : null;
        var hasImage = Boolean(imageElement && imageWrap);
        if (previewZoomWrap) {
            previewZoomWrap.hidden = !hasImage;
        }
        if (!hasImage || !imageWrap) {
            return;
        }
        imageWrap.style.transform = "scale(" + String(nextZoom) + ")";
        if (previewContent) {
            previewContent.scrollLeft = 0;
            previewContent.scrollTop = 0;
        }
    }

    function setPreviewActionTargets(options) {
        // Preview action buttons follow the selected entry rather than the currently visible HTML,
        // which keeps download/edit/delete targets correct across cached preview renders.
        var settings = options || {};
        var entry = settings.entry || null;
        var previewDownloadButton = settings.previewDownloadButton || null;
        var previewEditButton = settings.previewEditButton || null;
        var previewDeleteButton = settings.previewDeleteButton || null;
        var previewUrlShareButton = settings.previewUrlShareButton || null;
        var urlShareApiUrl = settings.urlShareApiUrl || "";
        var isPreviewableFileEntry = settings.isPreviewableFileEntry || function () { return false; };
        var isEditableHandriveFileEntry = settings.isEditableHandriveFileEntry || function () { return false; };
        var buildDownloadUrl = settings.buildDownloadUrl || function () { return ""; };
        var onEdit = settings.onEdit || function () {};
        var previewRenderMode = String(settings.previewRenderMode || "").trim();

        var isFileEntry = Boolean(isPreviewableFileEntry(entry));
        var canEdit = Boolean(entry && entry.can_edit);
        var canEditPreview = previewRenderMode !== "unsupported";

        if (previewDownloadButton) {
            if (!isFileEntry) {
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

        if (previewEditButton) {
            previewEditButton.hidden = !(isFileEntry && canEdit && canEditPreview && isEditableHandriveFileEntry(entry));
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

        if (previewDeleteButton) {
            previewDeleteButton.hidden = !(isFileEntry && canEdit);
        }

        if (previewUrlShareButton) {
            previewUrlShareButton.hidden = !(isFileEntry && canEdit && urlShareApiUrl);
        }
    }

    window.HandrivePreviewHelpers = {
        getPreviewImageElement: getPreviewImageElement,
        getPreviewImageMinZoom: getPreviewImageMinZoom,
        scrollPreviewIntoViewIfPortrait: scrollPreviewIntoViewIfPortrait,
        setPreviewActionTargets: setPreviewActionTargets,
        setPreviewPlaceholder: setPreviewPlaceholder,
        setPreviewVisibility: setPreviewVisibility,
        syncPreviewImageZoom: syncPreviewImageZoom,
    };
})();
