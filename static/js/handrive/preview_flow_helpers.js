(function () {
    "use strict";

    // Preview flow helpers orchestrate fetch -> cache -> render without touching the broader
    // selection logic. page.js passes state/callbacks so these helpers stay mostly pure.

    function renderPreviewHtml(options) {
        // Take one API preview payload and hydrate the preview pane without depending on
        // the caller's page state structure beyond the callbacks passed in.
        var settings = options || {};
        var previewContent = settings.previewContent || null;
        var previewZoomWrap = settings.previewZoomWrap || null;
        var previewGetImageElement = settings.previewGetImageElement || function () { return null; };
        var applyRenderedContentModeClass = settings.applyRenderedContentModeClass || function () {};
        var setPreviewPlaceholder = settings.setPreviewPlaceholder || function () {};
        var applyHandriveCodeHighlighting = settings.applyHandriveCodeHighlighting || function () {};
        var hydrateMediaAudioElements = settings.hydrateMediaAudioElements || function () {};
        var setPreviewActionTargets = settings.setPreviewActionTargets || function () {};
        var syncPreviewImageZoom = settings.syncPreviewImageZoom || function () {};
        var scheduleSyncCurrentDirRowHeightWithSideHead = settings.scheduleSyncCurrentDirRowHeightWithSideHead || function () {};
        var state = settings.state || {};
        var entry = settings.entry || null;
        var html = settings.html;
        var renderMode = settings.renderMode;
        var renderClass = settings.renderClass;
        var t = settings.t || function (_, fallbackValue) { return fallbackValue || ""; };

        if (!previewContent) {
            return;
        }
        var safeHtml = typeof html === "string" ? html : "";
        var normalizedRenderMode =
            renderMode === "markdown" ||
            renderMode === "office" ||
            renderMode === "pdf" ||
            renderMode === "media_image" ||
            renderMode === "media_video" ||
            renderMode === "media_audio" ||
            renderMode === "unsupported"
                ? renderMode
                : "plain_text";
        var normalizedRenderClass = String(renderClass || "").trim();

        applyRenderedContentModeClass(previewContent, normalizedRenderMode, normalizedRenderClass);
        if (!safeHtml.trim()) {
            setPreviewPlaceholder(t("list_preview_empty", "파일을 선택하면 미리보기가 표시됩니다."));
            return;
        }

        state.activePreviewRenderMode = normalizedRenderMode;
        previewContent.innerHTML = safeHtml;
        state.previewImageZoom = 1;
        applyHandriveCodeHighlighting(previewContent, normalizedRenderClass || "ui-markdown");
        hydrateMediaAudioElements(previewContent);
        setPreviewActionTargets(entry);
        window.requestAnimationFrame(function () {
            syncPreviewImageZoom();
        });

        var imageElement = previewGetImageElement(previewContent);
        if (imageElement && !imageElement.complete) {
            imageElement.addEventListener("load", function () {
                var wrap = previewContent
                    ? previewContent.querySelector(".handrive-media-image-wrap")
                    : null;
                if (wrap) {
                    wrap.style.transform = "scale(" + String(state.previewImageZoom) + ")";
                }
                if (previewZoomWrap) {
                    previewZoomWrap.hidden = false;
                }
            }, { once: true });
        }
        scheduleSyncCurrentDirRowHeightWithSideHead();
    }

    async function loadPreviewForEntry(options) {
        // Preview loading is centralized here so cache hits, editor/preview switching,
        // request cancellation semantics, and placeholder handling stay consistent.
        var settings = options || {};
        var entry = settings.entry || null;
        var previewPanel = settings.previewPanel || null;
        var previewContent = settings.previewContent || null;
        var previewTitle = settings.previewTitle || null;
        var previewApiUrl = settings.previewApiUrl || "";
        var editorPanel = settings.editorPanel || null;
        var state = settings.state || {};
        var isPreviewableFileEntry = settings.isPreviewableFileEntry || function () { return false; };
        var clearPreviewPane = settings.clearPreviewPane || function () {};
        var switchToPreview = settings.switchToPreview || function () {};
        var setPreviewVisibility = settings.setPreviewVisibility || function () {};
        var normalizePath = settings.normalizePath || function (value) { return value || ""; };
        var setPreviewActionTargets = settings.setPreviewActionTargets || function () {};
        var renderPreviewHtml = settings.renderPreviewHtml || function () {};
        var scrollPreviewIntoViewIfPortrait = settings.scrollPreviewIntoViewIfPortrait || function () {};
        var setPreviewLoading = settings.setPreviewLoading || null;
        var setPreviewPlaceholder = settings.setPreviewPlaceholder || function () {};
        var beforePreviewContentReplace = settings.beforePreviewContentReplace || function () {
            return Promise.resolve();
        };
        var requestJson = settings.requestJson || function () { return Promise.resolve({}); };
        var buildPostOptions = settings.buildPostOptions || function () { return {}; };
        var t = settings.t || function (_, fallbackValue) { return fallbackValue || ""; };

        if (!previewPanel || !previewContent) {
            return;
        }
        if (!isPreviewableFileEntry(entry) || !previewApiUrl) {
            clearPreviewPane();
            return;
        }

        if (editorPanel && !editorPanel.hidden) {
            switchToPreview();
        }

        setPreviewVisibility(true);

        var pathValue = normalizePath(entry.path, true);
        if (state.activeRenderedPreviewPath === pathValue && !previewPanel.hidden) {
            setPreviewActionTargets(entry);
            return;
        }

        state.activePreviewPath = pathValue;
        if (previewTitle) {
            var previewTitleText = previewTitle.querySelector(".handrive-list-preview-title-text") || previewTitle;
            previewTitleText.textContent = entry.name || t("list_preview_title", "파일 미리보기");
        }
        setPreviewActionTargets(entry);

        if (state.previewCache.has(pathValue)) {
            var cached = state.previewCache.get(pathValue);
            await beforePreviewContentReplace();
            if (state.activePreviewPath !== pathValue) {
                return;
            }
            if (cached && typeof cached === "object") {
                renderPreviewHtml(entry, cached.html, cached.renderMode, cached.renderClass);
                state.activeRenderedPreviewPath = pathValue;
                scrollPreviewIntoViewIfPortrait();
                return;
            }
            renderPreviewHtml(entry, cached, "markdown", "ui-markdown");
            state.activeRenderedPreviewPath = pathValue;
            scrollPreviewIntoViewIfPortrait();
            return;
        }

        await beforePreviewContentReplace();
        if (state.activePreviewPath !== pathValue) {
            return;
        }
        if (typeof setPreviewLoading === "function") {
            setPreviewLoading();
        } else {
            setPreviewPlaceholder(t("list_preview_loading", "미리보기를 불러오는 중..."));
        }
        var requestToken = state.previewRequestToken + 1;
        state.previewRequestToken = requestToken;

        try {
            var data = await requestJson(
                previewApiUrl,
                buildPostOptions({ path: pathValue })
            );
            if (requestToken !== state.previewRequestToken || state.activePreviewPath !== pathValue) {
                return;
            }
            var html = data && typeof data.html === "string" ? data.html : "";
            var renderMode = data && typeof data.render_mode === "string" ? data.render_mode : "plain_text";
            var renderClass = data && typeof data.render_class === "string" ? data.render_class : "";
            state.previewCache.set(pathValue, {
                html: html,
                renderMode: renderMode,
                renderClass: renderClass,
            });
            if (previewTitle && data && typeof data.title === "string" && data.title.trim()) {
                var previewTitleText2 = previewTitle.querySelector(".handrive-list-preview-title-text") || previewTitle;
                previewTitleText2.textContent = data.title;
            }
            renderPreviewHtml(entry, html, renderMode, renderClass);
            state.activeRenderedPreviewPath = pathValue;
            scrollPreviewIntoViewIfPortrait();
        } catch (error) {
            if (requestToken !== state.previewRequestToken || state.activePreviewPath !== pathValue) {
                return;
            }
            state.previewCache.delete(pathValue);
            setPreviewPlaceholder(
                error && error.message
                    ? error.message
                    : t("list_preview_error", "미리보기를 불러오지 못했습니다.")
            );
            scrollPreviewIntoViewIfPortrait();
        }
    }

    window.HandrivePreviewFlowHelpers = {
        loadPreviewForEntry: loadPreviewForEntry,
        renderPreviewHtml: renderPreviewHtml,
    };
})();
