(function () {
    "use strict";

    // HanDrive 목록/보기/쓰기 페이지 공통 클라이언트 엔트리.
    // 페이지 타입에 따라 list, view, write 초기화 루틴 중 하나를 실행한다.

    // 문서 페이지 루트 요소 확인
    const root = document.querySelector("[data-handrive-page]");
    if (!root) {
        return;
    }

    const pageType = root.dataset.handrivePage;
    const uiLang = String(root.dataset.uiLang || "ko").trim().toLowerCase() === "en" ? "en" : "ko";
    const sharedOwnerUsername = String(root.dataset.handriveSharedOwnerUsername || "").trim();
    const sharedSlug = String(root.dataset.handriveSharedSlug || "").trim();
    const sharedRootPath = String(root.dataset.handriveSharedRootPath || "").trim();

    window.addEventListener("message", function (event) {
        const data = event && event.data && typeof event.data === "object" ? event.data : null;
        if (!data || data.type !== "handrive-office-preview-size") {
            return;
        }
        const width = Math.max(1, Math.ceil(Number(data.width) || 0));
        const height = Math.max(1, Math.ceil(Number(data.height) || 0));
        if (!width || !height) {
            return;
        }
        const frames = Array.prototype.slice.call(document.querySelectorAll(".handrive-office .handrive-html-live-frame"));
        const frame = frames.find(function (candidate) {
            return candidate && candidate.contentWindow === event.source;
        });
        if (!frame) {
            return;
        }
        const wrap = frame.closest(".handrive-html-live-wrap");
        const article = frame.closest(".handrive-office");
        const viewportWidth = Math.max(1, Number(article ? article.clientWidth : frame.clientWidth) || 0);
        const appliedWidth = Math.max(viewportWidth, width);
        if (event.source && typeof event.source.postMessage === "function") {
            event.source.postMessage({
                type: "handrive-office-preview-viewport",
                width: viewportWidth,
            }, "null");
        }
        if (wrap) {
            wrap.style.width = appliedWidth + "px";
            wrap.style.maxWidth = "none";
            wrap.style.height = height + "px";
        }
        frame.style.width = appliedWidth + "px";
        frame.style.maxWidth = "none";
        frame.style.height = height + "px";
    });

    function hasSharedContext() {
        return Boolean(sharedOwnerUsername && sharedSlug);
    }

    function appendSharedQuery(url) {
        const baseUrl = String(url || "").trim();
        if (!baseUrl || !hasSharedContext()) {
            return baseUrl;
        }
        const separator = baseUrl.indexOf("?") === -1 ? "?" : "&";
        return baseUrl
            + separator
            + "share_owner=" + encodeURIComponent(sharedOwnerUsername)
            + "&share_slug=" + encodeURIComponent(sharedSlug);
    }

    function appendQueryParam(url, key, value) {
        const baseUrl = String(url || "").trim();
        if (!baseUrl) {
            return baseUrl;
        }
        const separator = baseUrl.indexOf("?") === -1 ? "?" : "&";
        return baseUrl + separator + encodeURIComponent(key) + "=" + encodeURIComponent(value || "");
    }

    // CSRF 토큰을 가져오는 함수
    function getCsrfToken() {
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta && meta.content) {
            return meta.content;
        }
        return "";
    }

    // 경로를 정규화하는 함수
    function normalizePath(raw, allowEmpty = true) {
        const source = String(raw || "").replace(/\\/g, "/").trim();
        const trimmed = source.replace(/^\/+|\/+$/g, "");
        if (!trimmed) {
            if (allowEmpty) {
                return "";
            }
            throw new Error(t("js_error_path_required", "경로를 입력해주세요."));
        }
        const parts = trimmed
            .split("/")
            .map(function (part) {
                return part.trim();
            })
            .filter(function (part) {
                return Boolean(part) && part !== ".";
            });

        if (parts.some(function (part) {
            return part === "..";
        })) {
            throw new Error(t("js_error_parent_path_not_allowed", "상위 경로(..)는 사용할 수 없습니다."));
        }

        return parts.join("/");
    }

    // 경로 세그먼트를 인코딩하는 함수
    function encodePathSegments(pathValue) {
        const normalized = normalizePath(pathValue, true);
        if (!normalized) {
            return "";
        }
        return normalized
            .split("/")
            .map(function (segment) {
                return encodeURIComponent(segment);
            })
            .join("/");
    }

    // 목록 URL을 구축하는 함수
    function buildListUrl(baseUrl, relativePath, rootUrl) {
        const encoded = encodePathSegments(relativePath);
        if (!encoded) {
            return appendSharedQuery(rootUrl || baseUrl);
        }
        return appendSharedQuery(baseUrl + "/" + encoded + "/list");
    }

    // 보기 URL을 구축하는 함수
    function buildViewUrl(baseUrl, slugPath) {
        const encoded = encodePathSegments(slugPath);
        if (!encoded) {
            return appendSharedQuery(baseUrl);
        }
        return appendSharedQuery(baseUrl + "/" + encoded);
    }

    function getParentPath(pathValue) {
        const normalized = normalizePath(pathValue, true);
        if (!normalized) {
            return "";
        }
        const parts = normalized.split("/");
        parts.pop();
        return parts.join("/");
    }

    // 쓰기 URL을 구축하는 함수
    function buildWriteUrl(writeBaseUrl, params) {
        const search = new URLSearchParams(params || {});
        const query = search.toString();
        return query ? writeBaseUrl + "?" + query : writeBaseUrl;
    }

    // JSON 요청을 보내는 비동기 함수
    async function requestJson(url, options) {
        // Centralize JSON error normalization so every API caller gets the same
        // user-facing message shape regardless of the backend endpoint.
        const response = await fetch(url, options || {});
        let payload = null;
        try {
            payload = await response.json();
        } catch (error) {
            payload = null;
        }

        if (!response.ok) {
            const message = payload && payload.error
                ? payload.error
                : t("js_error_request_failed", "요청 처리 중 오류가 발생했습니다.");
            throw new Error(message);
        }

        return payload;
    }

    async function requestFormDataJson(url, formData) {
        // Upload-related endpoints use FormData but still return JSON errors/success payloads.
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "X-CSRFToken": getCsrfToken()
            },
            body: formData
        });
        let payload = null;
        try {
            payload = await response.json();
        } catch (error) {
            payload = null;
        }

        if (!response.ok) {
            const message = payload && payload.error
                ? payload.error
                : t("js_error_request_failed", "요청 처리 중 오류가 발생했습니다.");
            throw new Error(message);
        }

        return payload;
    }

    function getImageFilesFromTransfer(dataTransfer) {
        if (!dataTransfer) {
            return [];
        }
        const files = [];
        if (dataTransfer.files && dataTransfer.files.length > 0) {
            Array.from(dataTransfer.files).forEach(function (file) {
                if (file && String(file.type || "").toLowerCase().startsWith("image/")) {
                    files.push(file);
                }
            });
            return files;
        }
        if (dataTransfer.items && dataTransfer.items.length > 0) {
            Array.from(dataTransfer.items).forEach(function (item) {
                if (!item || item.kind !== "file" || !String(item.type || "").toLowerCase().startsWith("image/")) {
                    return;
                }
                const file = item.getAsFile();
                if (file) {
                    files.push(file);
                }
            });
        }
        return files;
    }

    function getTextareaCaretOffsetFromPoint(textarea, clientX, clientY) {
        if (!textarea) {
            return null;
        }
        const rect = textarea.getBoundingClientRect();
        const styles = window.getComputedStyle(textarea);
        const paddingLeft = parseFloat(styles.paddingLeft) || 0;
        const paddingTop = parseFloat(styles.paddingTop) || 0;
        const borderLeft = parseFloat(styles.borderLeftWidth) || 0;
        const borderTop = parseFloat(styles.borderTopWidth) || 0;
        const lineHeight = parseFloat(styles.lineHeight) || (parseFloat(styles.fontSize) || 16) * 1.2;
        const source = textarea.value || "";
        const lines = source.split("\n");
        const rawLineIndex = Math.floor(
            (clientY - rect.top - paddingTop - borderTop + textarea.scrollTop) / Math.max(1, lineHeight)
        );
        const lineIndex = Math.max(0, Math.min(lines.length - 1, rawLineIndex));
        let lineStart = 0;
        for (let index = 0; index < lineIndex; index += 1) {
            lineStart += lines[index].length + 1;
        }

        const targetX = clientX - rect.left - paddingLeft - borderLeft + textarea.scrollLeft;
        const line = lines[lineIndex] || "";
        if (targetX <= 0 || !line) {
            return lineStart;
        }

        const canvas = getTextareaCaretOffsetFromPoint.canvas || document.createElement("canvas");
        getTextareaCaretOffsetFromPoint.canvas = canvas;
        const context = canvas.getContext("2d");
        if (!context) {
            return lineStart + line.length;
        }
        context.font = styles.font;

        let low = 0;
        let high = line.length;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            const width = context.measureText(line.slice(0, mid)).width;
            if (width < targetX) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }

        const beforeWidth = context.measureText(line.slice(0, low)).width;
        const afterWidth = low < line.length
            ? context.measureText(line.slice(0, low + 1)).width
            : beforeWidth;
        const offsetInLine = low < line.length && Math.abs(afterWidth - targetX) < Math.abs(targetX - beforeWidth)
            ? low + 1
            : low;
        return lineStart + Math.max(0, Math.min(line.length, offsetInLine));
    }

    function insertTextAtTextareaCursor(textarea, insertText, insertOffset) {
        if (!textarea) {
            return 0;
        }
        const hasInsertOffset = Number.isInteger(insertOffset);
        const start = hasInsertOffset ? Math.max(0, Math.min(textarea.value.length, insertOffset)) : (textarea.selectionStart || 0);
        const end = hasInsertOffset ? start : (textarea.selectionEnd || 0);
        textarea.setRangeText(insertText, start, end, "end");
        const nextCursor = start + String(insertText || "").length;
        textarea.setSelectionRange(nextCursor, nextCursor);
        textarea.focus();
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        return nextCursor;
    }

    function createMarkdownImageInputHandler(options) {
        const settings = options || {};
        const textarea = settings.textarea;
        const uploadApiUrl = settings.uploadApiUrl;
        const isEnabled = typeof settings.isEnabled === "function" ? settings.isEnabled : function () { return true; };
        const getMarkdownPath = typeof settings.getMarkdownPath === "function" ? settings.getMarkdownPath : function () { return ""; };
        const getMarkdownName = typeof settings.getMarkdownName === "function" ? settings.getMarkdownName : function () { return ""; };
        const getTargetDir = typeof settings.getTargetDir === "function" ? settings.getTargetDir : function () { return ""; };
        const onAfterInsert = typeof settings.onAfterInsert === "function" ? settings.onAfterInsert : function () {};

        async function uploadAndInsert(files, insertOffset) {
            if (!textarea || !uploadApiUrl || !isEnabled()) {
                return;
            }
            let nextInsertOffset = Number.isInteger(insertOffset) ? insertOffset : null;
            for (const file of files) {
                const formData = new FormData();
                formData.append("markdown_path", getMarkdownPath() || "");
                formData.append("markdown_name", getMarkdownName() || "");
                formData.append("target_dir", getTargetDir() || "");
                formData.append("image", file, file.name || "image.png");
                const data = await requestFormDataJson(uploadApiUrl, formData);
                const snippet = data && typeof data.markdown === "string" && data.markdown
                    ? data.markdown
                    : ("![" + (file.name ? file.name.replace(/\.[^.]+$/, "") : "image") + "](" + (data && data.url ? data.url : "") + ")");
                nextInsertOffset = insertTextAtTextareaCursor(textarea, snippet, nextInsertOffset);
                onAfterInsert(data || {});
            }
        }

        return {
            handlePaste: function (event) {
                if (!event || !event.clipboardData || !isEnabled()) {
                    return false;
                }
                const files = getImageFilesFromTransfer(event.clipboardData);
                if (!files.length) {
                    return false;
                }
                event.preventDefault();
                uploadAndInsert(files, null).catch(alertError);
                return true;
            },
            handleDrop: function (event) {
                if (!event || !event.dataTransfer || !isEnabled()) {
                    return false;
                }
                const files = getImageFilesFromTransfer(event.dataTransfer);
                if (!files.length) {
                    return false;
                }
                const insertOffset = getTextareaCaretOffsetFromPoint(textarea, event.clientX, event.clientY);
                event.preventDefault();
                uploadAndInsert(files, insertOffset).catch(alertError);
                return true;
            },
            handleDragOver: function (event) {
                if (!event || !event.dataTransfer || !isEnabled()) {
                    return false;
                }
                const files = getImageFilesFromTransfer(event.dataTransfer);
                if (!files.length) {
                    return false;
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                return true;
            }
        };
    }

    // POST 요청 옵션을 구축하는 함수
    function buildPostOptions(body) {
        return {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": getCsrfToken()
            },
            body: JSON.stringify(body || {})
        };
    }

    // JSON 스크립트 데이터를 가져오는 함수
    function getJsonScriptData(id, fallbackValue) {
        // Server-rendered pages pass structured config through <script type="application/json"> tags.
        const element = document.getElementById(id);
        if (!element) {
            return fallbackValue;
        }
        try {
            return JSON.parse(element.textContent || "null") || fallbackValue;
        } catch (error) {
            return fallbackValue;
        }
    }

    const i18n = getJsonScriptData("handrive-i18n", {});

    // 다국어 텍스트를 가져오는 함수
    function t(key, fallbackValue) {
        if (Object.prototype.hasOwnProperty.call(i18n, key) && typeof i18n[key] === "string") {
            return i18n[key];
        }
        return fallbackValue;
    }

    function textByLang(koValue, enValue) {
        return uiLang === "en" ? enValue : koValue;
    }

    // 분리된 helper 모듈은 모두 window 네임스페이스로 주입된다.
    // page.js 는 상태와 이벤트 wiring 을 담당하고, 순수 UI/flow 로직은 helper 에 위임한다.
    const handrivePageHelpers = window.HandrivePageHelpers || {};
    const getPathFileExtension = handrivePageHelpers.getPathFileExtension || function () { return ""; };
    const getFileIconKey = handrivePageHelpers.getFileIconKey || function () { return "file"; };
    const isGenericFileIconKey = handrivePageHelpers.isGenericFileIconKey || function () { return false; };
    const handriveContextMenuHelpers = window.HandriveContextMenuHelpers || {};
    const computeContextMenuVisibility = handriveContextMenuHelpers.computeContextMenuVisibility || function () { return {}; };
    const hasVisibleContextMenuAction = handriveContextMenuHelpers.hasVisibleContextMenuAction || function () { return false; };
    const syncContextMenuDividers = handriveContextMenuHelpers.syncContextMenuDividers || function () {};
    const handriveListRenderHelpers = window.HandriveListRenderHelpers || {};
    const appendCurrentDirRepoName = handriveListRenderHelpers.appendCurrentDirRepoName || function () {};
    const buildTreePrefixElement = handriveListRenderHelpers.buildTreePrefixElement || function () { return document.createElement("span"); };
    const createEntryMetaField = handriveListRenderHelpers.createEntryMetaField || function () { return document.createElement("span"); };
    const createTypeMarker = handriveListRenderHelpers.createTypeMarker || function () { return document.createElement("span"); };
    const handriveNavigationHelpers = window.HandriveNavigationHelpers || {};
    const buildNavigationBreadcrumbItems = handriveNavigationHelpers.buildBreadcrumbItems || function () { return []; };
    const getCachedDirectoryEntries = handriveNavigationHelpers.getCachedEntries || function () { return []; };
    const loadDirectoryEntries = handriveNavigationHelpers.loadDirectory || function () { return Promise.resolve([]); };
    const refreshDirectoryEntries = handriveNavigationHelpers.refreshCurrentDirectory || function () { return Promise.resolve(); };
    const renderNavigationBreadcrumbs = handriveNavigationHelpers.renderPathBreadcrumbs || function () {};
    const handrivePreviewHelpers = window.HandrivePreviewHelpers || {};
    const previewGetImageElement = handrivePreviewHelpers.getPreviewImageElement || function () { return null; };
    const previewGetImageMinZoom = handrivePreviewHelpers.getPreviewImageMinZoom || function () { return 0.5; };
    const previewScrollIntoViewIfPortrait = handrivePreviewHelpers.scrollPreviewIntoViewIfPortrait || function () {};
    const previewSetActionTargets = handrivePreviewHelpers.setPreviewActionTargets || function () {};
    const previewSetPlaceholder = handrivePreviewHelpers.setPreviewPlaceholder || function () {};
    const previewSetVisibility = handrivePreviewHelpers.setPreviewVisibility || function () {};
    const previewSyncImageZoom = handrivePreviewHelpers.syncPreviewImageZoom || function () {};
    const handriveModalHelpers = window.HandriveModalHelpers || {};
    const modalReadCheckedIds = handriveModalHelpers.readCheckedIds || function () { return []; };
    const modalRenderPermissionItems = handriveModalHelpers.renderPermissionItems || function () {};
    const modalSetFolderCreateModalOpen = handriveModalHelpers.setFolderCreateModalOpen || function () {};
    const modalSetFolderIconModalOpen = handriveModalHelpers.setFolderIconModalOpen || function () {};
    const modalSetPermissionModalOpen = handriveModalHelpers.setPermissionModalOpen || function (_, __, ___, ____, entries) { return entries || []; };
    const modalSetRenameModalOpen = handriveModalHelpers.setRenameModalOpen || function () {};
    const handriveEditorHelpers = window.HandriveEditorHelpers || {};
    const editorResolveFilenameAndExtension = handriveEditorHelpers.resolveEditorFilenameAndExtension || function () { return { filename: "", extension: ".md" }; };
    const editorSwitchToEditorUI = handriveEditorHelpers.switchToEditorUI || function () { return Promise.resolve(); };
    const editorSwitchToPreviewUI = handriveEditorHelpers.switchToPreviewUI || function () {};
    const handriveGitRepoHelpers = window.HandriveGitRepoHelpers || {};
    const gitRepoCloseModalUi = handriveGitRepoHelpers.closeGitRepoModalUi || function () {};
    const gitRepoResetModalUi = handriveGitRepoHelpers.resetGitRepoModalUi || function () {};
    const gitRepoShowStatusUi = handriveGitRepoHelpers.showGitRepoStatus || function () {};
    const handrivePreviewFlowHelpers = window.HandrivePreviewFlowHelpers || {};
    const loadPreviewEntryFlow = handrivePreviewFlowHelpers.loadPreviewForEntry || function () { return Promise.resolve(); };
    const renderPreviewHtmlFlow = handrivePreviewFlowHelpers.renderPreviewHtml || function () {};
    const handriveGitRepoFlowHelpers = window.HandriveGitRepoFlowHelpers || {};
    const gitRepoFlowOpenModal = handriveGitRepoFlowHelpers.openModal || function () { return Promise.resolve(); };
    const gitRepoFlowPollStatus = handriveGitRepoFlowHelpers.pollStatus || function () { return Promise.resolve(); };
    const gitRepoFlowRetryCreate = handriveGitRepoFlowHelpers.retryCreate || function () { return Promise.resolve(); };
    const gitRepoFlowStartPolling = handriveGitRepoFlowHelpers.startPolling || function () {};
    const gitRepoFlowStopPolling = handriveGitRepoFlowHelpers.stopPolling || function () {};
    const gitRepoFlowSubmitCreate = handriveGitRepoFlowHelpers.submitCreate || function () { return Promise.resolve(); };
    const handriveQueueHelpers = window.HandriveQueueHelpers || {};
    const buildQueueItemLabel = handriveQueueHelpers.buildQueueItemLabel || function (_, fallbackLabel) { return fallbackLabel || ""; };
    const configureUploadQueueContextMenu = handriveQueueHelpers.configureUploadQueueContextMenu || function () {};
    const createQueueListItem = handriveQueueHelpers.createQueueListItem || function () { return null; };
    const getQueueItemMetaLabel = handriveQueueHelpers.getQueueItemMetaLabel || function () { return ""; };
    const getQueueItemStatusLabel = handriveQueueHelpers.getQueueItemStatusLabel || function () { return ""; };
    const renderUploadQueuePanel = handriveQueueHelpers.renderUploadQueuePanel || function () {};
    const sortQueueItems = handriveQueueHelpers.sortQueueItems || function (items) { return items; };
    const summarizeUploadQueue = handriveQueueHelpers.summarizeUploadQueue || function () { return ""; };
    const handriveQueueOperationHelpers = window.HandriveQueueOperationHelpers || {};
    const enqueueQueuedUploadFiles = handriveQueueOperationHelpers.enqueueUploadFiles || function () { return Promise.resolve(); };
    const processOperationQueueWorker = handriveQueueOperationHelpers.processOperationQueue || function () { return Promise.resolve(); };
    const processUploadQueueWorker = handriveQueueOperationHelpers.processUploadQueue || function () { return Promise.resolve(); };
    const runDeleteQueueOperation = handriveQueueOperationHelpers.runDeleteOperationQueueItem || function () { return Promise.resolve(); };
    const runCreateArchiveQueueOperation = handriveQueueOperationHelpers.runCreateArchiveOperationQueueItem || function () { return Promise.resolve(); };
    const runExtractQueueOperation = handriveQueueOperationHelpers.runExtractOperationQueueItem || function () { return Promise.resolve(); };
    const runMoveQueueOperation = handriveQueueOperationHelpers.runMoveOperationQueueItem || function () { return Promise.resolve(); };

    const HANDRIVE_MEDIA_AUDIO_VOLUME_STORAGE_KEY = "handrive-media-audio-volume";

    function getStoredMediaAudioVolume() {
        // Persist preview-audio volume across files so repeated media previews feel consistent.
        try {
            const rawValue = window.localStorage
                ? window.localStorage.getItem(HANDRIVE_MEDIA_AUDIO_VOLUME_STORAGE_KEY)
                : "";
            const parsedValue = Number(rawValue);
            if (!Number.isFinite(parsedValue)) {
                return 1;
            }
            return Math.max(0, Math.min(1, parsedValue));
        } catch (error) {
            return 1;
        }
    }

    function storeMediaAudioVolume(volume) {
        try {
            if (!window.localStorage) {
                return;
            }
            const normalizedVolume = Math.max(0, Math.min(1, Number(volume)));
            window.localStorage.setItem(HANDRIVE_MEDIA_AUDIO_VOLUME_STORAGE_KEY, String(normalizedVolume));
        } catch (error) {
            // ignore storage failures
        }
    }

    function resetAudioPlaybackPosition(audioElement) {
        // Reset to the beginning whenever preview audio is hydrated so stale currentTime
        // from browser media state does not leak across file selections.
        if (!audioElement) {
            return;
        }
        const applyReset = function () {
            try {
                audioElement.currentTime = 0;
            } catch (error) {
                return;
            }
        };
        if (audioElement.readyState > 0) {
            applyReset();
            return;
        }
        audioElement.addEventListener("loadedmetadata", applyReset, { once: true });
    }

    function hydrateMediaAudioElements(container) {
        // Audio elements are created inside preview HTML, so bind volume/preload behavior
        // after each preview render rather than at page boot.
        if (!container || !(container instanceof Element)) {
            return;
        }
        const storedVolume = getStoredMediaAudioVolume();
        container.querySelectorAll(".handrive-media-audio-element").forEach(function (audioElement) {
            if (!(audioElement instanceof HTMLMediaElement)) {
                return;
            }
            audioElement.volume = storedVolume;
            audioElement.preload = "metadata";
            audioElement.autoplay = false;
            resetAudioPlaybackPosition(audioElement);
            if (audioElement.dataset.handriveVolumeBound === "1") {
                return;
            }
            audioElement.dataset.handriveVolumeBound = "1";
            audioElement.addEventListener("volumechange", function () {
                storeMediaAudioVolume(audioElement.volume);
            });
        });
    }

    function stopPreviewMediaElements(container) {
        if (!container || !(container instanceof Element)) {
            return;
        }
        container.querySelectorAll("audio, video").forEach(function (mediaElement) {
            if (!(mediaElement instanceof HTMLMediaElement)) {
                return;
            }
            try {
                mediaElement.pause();
            } catch (error) {
                // ignore media state errors
            }
            try {
                mediaElement.currentTime = 0;
            } catch (error) {
                // ignore seek failures for unloaded media
            }
        });
    }

    // 템플릿을 포맷팅하는 함수
    function formatTemplate(template, values) {
        // Small named-token formatter for localized strings such as "{count}개 항목".
        return String(template || "").replace(/\{(\w+)\}/g, function (_, token) {
            if (values && Object.prototype.hasOwnProperty.call(values, token)) {
                return String(values[token]);
            }
            return "";
        });
    }

    // 에러를 알림창으로 표시하는 함수
    function alertError(error) {
        window.alert(
            error && error.message
                ? error.message
                : t("js_error_processing_failed", "처리 중 오류가 발생했습니다.")
        );
    }

    let imagePipSession = null;

    function closeImagePipSession() {
        if (!imagePipSession) {
            return;
        }
        const session = imagePipSession;
        imagePipSession = null;
        if (session.video) {
            session.video.remove();
        }
        if (session.stream) {
            session.stream.getTracks().forEach(function (track) {
                track.stop();
            });
        }
    }

    async function openImagePictureInPicture(imageElement) {
        if (!imageElement) {
            throw new Error(t("image_pip_no_image_error", "PiP로 띄울 이미지를 찾을 수 없습니다."));
        }
        if (!document.pictureInPictureEnabled || typeof HTMLVideoElement === "undefined") {
            throw new Error(t("image_pip_unsupported_error", "이 브라우저는 이미지 PiP를 지원하지 않습니다."));
        }
        if (typeof HTMLCanvasElement === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") {
            throw new Error(t("image_pip_unsupported_error", "이 브라우저는 이미지 PiP를 지원하지 않습니다."));
        }
        if (document.pictureInPictureElement) {
            await document.exitPictureInPicture().catch(function () {});
        }
        closeImagePipSession();

        if (!imageElement.complete && typeof imageElement.decode === "function") {
            await imageElement.decode().catch(function () {});
        }

        const sourceWidth = Number(imageElement.naturalWidth || imageElement.width || imageElement.clientWidth || 0);
        const sourceHeight = Number(imageElement.naturalHeight || imageElement.height || imageElement.clientHeight || 0);
        if (!sourceWidth || !sourceHeight) {
            throw new Error(t("image_pip_no_image_error", "PiP로 띄울 이미지를 찾을 수 없습니다."));
        }

        const maxSide = 1280;
        const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(sourceWidth * scale));
        canvas.height = Math.max(1, Math.round(sourceHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error(t("image_pip_unsupported_error", "이 브라우저는 이미지 PiP를 지원하지 않습니다."));
        }
        context.clearRect(0, 0, canvas.width, canvas.height);
        try {
            context.drawImage(imageElement, 0, 0, canvas.width, canvas.height);
        } catch (error) {
            throw new Error(t("image_pip_no_image_error", "PiP로 띄울 이미지를 찾을 수 없습니다."));
        }

        const stream = canvas.captureStream(1);
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        video.style.cssText = "position:fixed;left:-1px;top:-1px;width:1px;height:1px;opacity:0;pointer-events:none;";
        document.body.appendChild(video);

        imagePipSession = { stream: stream, video: video };
        video.addEventListener("leavepictureinpicture", closeImagePipSession, { once: true });
        try {
            await video.play();
            await video.requestPictureInPicture();
        } catch (error) {
            closeImagePipSession();
            throw error;
        }
    }

    function openClickedImagePictureInPicture(event) {
        if (!event || event.button !== 0) {
            return;
        }
        const target = event.target && event.target.closest
            ? event.target.closest(".handrive-media-image-element")
            : null;
        if (!target) {
            return;
        }
        event.preventDefault();
        openImagePictureInPicture(target).catch(alertError);
    }

    // 문서 렌더링 콘텐츠 모드 클래스를 적용하는 함수
    function applyHandriveRenderedContentModeClass(targetElement, renderMode, renderClass) {
        // Preview renderers return both a high-level mode and optional CSS class hints.
        // Normalize those hints here so the preview pane has exactly one coherent style family.
        if (!targetElement || !(targetElement instanceof Element)) {
            return;
        }
        targetElement.classList.remove(
            "ui-markdown",
            "handrive-plain-text",
            "handrive-json",
            "handrive-html",
            "handrive-css",
            "handrive-js",
            "handrive-py",
            "handrive-office",
            "handrive-office-word",
            "handrive-office-sheet",
            "handrive-office-presentation",
            "handrive-media",
            "handrive-media-image",
            "handrive-media-video",
            "handrive-media-audio",
            "handrive-media-pdf",
            "handrive-unsupported"
        );
        const renderClasses = String(renderClass || "")
            .split(/\s+/)
            .filter(Boolean);
        if (
            renderMode === "media_image" ||
            renderMode === "media_video" ||
            renderMode === "media_audio" ||
            renderMode === "pdf" ||
            renderClasses.includes("handrive-media")
        ) {
            targetElement.classList.add("handrive-media");
            if (renderMode === "media_image") {
                targetElement.classList.add("handrive-media-image");
            } else if (renderMode === "media_video") {
                targetElement.classList.add("handrive-media-video");
            } else if (renderMode === "media_audio") {
                targetElement.classList.add("handrive-media-audio");
            } else if (renderMode === "pdf") {
                targetElement.classList.add("handrive-media-pdf");
            }
            renderClasses.forEach(function (className) {
                if (
                    className === "handrive-media-image" ||
                    className === "handrive-media-video" ||
                    className === "handrive-media-audio" ||
                    className === "handrive-media-pdf"
                ) {
                    targetElement.classList.add(className);
                }
            });
            return;
        }
        if (
            renderClasses.includes("handrive-json") ||
            renderClasses.includes("handrive-html") ||
            renderClasses.includes("handrive-css") ||
            renderClasses.includes("handrive-js") ||
            renderClasses.includes("handrive-py")
        ) {
            renderClasses.forEach(function (className) {
                if (
                    className === "handrive-json" ||
                    className === "handrive-html" ||
                    className === "handrive-css" ||
                    className === "handrive-js" ||
                    className === "handrive-py"
                ) {
                    targetElement.classList.add(className);
                }
            });
            return;
        }
        if (renderClasses.includes("handrive-office")) {
            renderClasses.forEach(function (className) {
                if (
                    className === "handrive-office" ||
                    className === "handrive-office-word" ||
                    className === "handrive-office-sheet" ||
                    className === "handrive-office-presentation"
                ) {
                    targetElement.classList.add(className);
                }
            });
            return;
        }
        if (renderClasses.includes("handrive-unsupported")) {
            targetElement.classList.add("handrive-unsupported");
            return;
        }
        if (renderMode === "markdown") {
            targetElement.classList.add("ui-markdown");
            return;
        }
        targetElement.classList.add("handrive-plain-text");
    }

    // HTML을 이스케이프하는 함수
    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    function calculateCursorPosition(textarea, position) {
        // Completion popups are positioned from measured text width because textarea
        // caret coordinates are not exposed directly by the browser.
        const text = textarea.value;
        const textBeforeCursor = text.substring(0, position);
        const lines = textBeforeCursor.split("\n");
        const currentLine = lines.length - 1;
        const currentColumn = lines[currentLine].length;
        const textareaStyles = window.getComputedStyle(textarea);
        const lineHeight = parseFloat(textareaStyles.lineHeight) || 20;
        const paddingLeft = parseFloat(textareaStyles.paddingLeft) || 0;
        const paddingTop = parseFloat(textareaStyles.paddingTop) || 0;
        const borderLeft = parseFloat(textareaStyles.borderLeftWidth) || 0;
        const borderTop = parseFloat(textareaStyles.borderTopWidth) || 0;
        const scrollLeft = textarea.scrollLeft;
        const scrollTop = textarea.scrollTop;

        const textareaRect = textarea.getBoundingClientRect();

        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        context.font = textareaStyles.font;

        const textLine = lines[currentLine] || "";
        const lineWidth = context.measureText(textLine.substring(0, currentColumn)).width;

        const left = textareaRect.left + paddingLeft + borderLeft + lineWidth - scrollLeft;
        const top = textareaRect.top + paddingTop + borderTop + (currentLine * lineHeight) - scrollTop;

        return {
            left: left,
            top: top,
            lineHeight: lineHeight
        };
    }

    if (!window.__handriveCalculateCursorPosition) {
        window.__handriveCalculateCursorPosition = calculateCursorPosition;
    }


    const handriveEditorCompletionExtensionAliasMap = {
        ".ts": ".js",
        ".tsx": ".js",
        ".jsx": ".js",
        ".mjs": ".js",
        ".cjs": ".js",
        ".htm": ".html",
        ".yml": ".json",
        ".yaml": ".json",
    };

    function resolveEditorCompletionItemsByExtension(extension) {
        // Reuse completion packs across adjacent extensions (ts->js, yaml->json, etc.)
        // so the editor can stay lightweight without duplicating snippet tables.
        const completionMap = window.__handriveEditorCompletionMap || {};
        const normalized = String(extension || "").trim().toLowerCase();
        if (normalized && Array.isArray(completionMap[normalized])) {
            return completionMap[normalized];
        }
        const alias = handriveEditorCompletionExtensionAliasMap[normalized];
        if (alias && Array.isArray(completionMap[alias])) {
            return completionMap[alias];
        }
        if (!normalized && Array.isArray(completionMap[".md"])) {
            return completionMap[".md"];
        }
        return [];
    }

    function extractEditorCompletionToken(sourceText, cursorIndex) {
        // Completion matching only looks at the trailing identifier fragment immediately
        // before the caret; everything else is ignored for predictable snippet insertion.
        const text = String(sourceText || "");
        const cursor = Math.max(0, Number(cursorIndex || 0));
        const prefix = text.slice(0, cursor);
        const match = prefix.match(/([A-Za-z0-9_][A-Za-z0-9_-]*)$/);
        if (!match || !match[1]) {
            return null;
        }
        const token = match[1];
        return {
            token: token,
            start: cursor - token.length,
            end: cursor,
        };
    }

    function findBestEditorCompletionItem(completionItems, tokenText) {
        const matches = findEditorCompletionItems(completionItems, tokenText, 1);
        return matches.length ? matches[0] : null;
    }

    function findEditorCompletionItems(completionItems, tokenText, limit) {
        // Rank candidates by exactness, explicit priority, and shorter trigger length
        // so the most likely snippet stays first in keyboard-only workflows.
        const normalizedToken = String(tokenText || "").toLowerCase();
        if (!normalizedToken || !Array.isArray(completionItems) || completionItems.length === 0) {
            return [];
        }

        const candidates = [];
        for (let i = 0; i < completionItems.length; i += 1) {
            const item = completionItems[i] || {};
            const trigger = String(item.trigger || "").toLowerCase();
            if (!trigger || !trigger.startsWith(normalizedToken)) {
                continue;
            }
            candidates.push({
                item: item,
                trigger: trigger,
            });
        }

        if (candidates.length === 0) {
            return [];
        }

        candidates.sort(function (a, b) {
            const aExact = a.trigger === normalizedToken ? 1 : 0;
            const bExact = b.trigger === normalizedToken ? 1 : 0;
            if (aExact !== bExact) {
                return bExact - aExact;
            }
            const aPriority = Number((a.item && a.item.priority) || 0);
            const bPriority = Number((b.item && b.item.priority) || 0);
            if (aPriority !== bPriority) {
                return bPriority - aPriority;
            }
            if (a.trigger.length !== b.trigger.length) {
                return a.trigger.length - b.trigger.length;
            }
            return a.trigger.localeCompare(b.trigger);
        });

        const maxItems = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : candidates.length;
        return candidates.slice(0, maxItems).map(function (candidate) {
            return candidate.item;
        });
    }

    // JavaScript 코드를 하이라이팅하는 함수
    function highlightJavaScriptCode(source) {
        const placeholders = [];

        const putPlaceholder = function (tokenHtml) {
            const token = "@@DOCS_JS_TOKEN_" + String(placeholders.length) + "@@";
            placeholders.push(tokenHtml);
            return token;
        };

        const restorePlaceholders = function (text) {
            return text.replace(/@@DOCS_JS_TOKEN_(\d+)@@/g, function (_, indexText) {
                const index = Number(indexText);
                if (Number.isNaN(index) || index < 0 || index >= placeholders.length) {
                    return "";
                }
                return placeholders[index];
            });
        };

        let text = escapeHtml(source);

        text = text.replace(/\/\*[\s\S]*?\*\//g, function (match) {
            return putPlaceholder('<span class="handrive-js-token-comment">' + match + "</span>");
        });
        text = text.replace(/(^|[^\S\r\n])\/\/[^\r\n]*/g, function (match) {
            return putPlaceholder('<span class="handrive-js-token-comment">' + match + "</span>");
        });
        text = text.replace(/(["'`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, function (match) {
            return putPlaceholder('<span class="handrive-js-token-string">' + match + "</span>");
        });

        text = text.replace(/\b(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi, '<span class="handrive-js-token-number">$1</span>');
        text = text.replace(
            /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|import|from|export|default|try|catch|finally|throw|async|await|typeof|instanceof|in|of|void|delete)\b/g,
            '<span class="handrive-js-token-keyword">$1</span>'
        );
        text = text.replace(/\b(true|false|null|undefined|this|super)\b/g, '<span class="handrive-js-token-literal">$1</span>');
        text = text.replace(
            /\b(Array|Object|String|Number|Boolean|Date|Math|JSON|Promise|Map|Set|RegExp|Error|console|window|document)\b/g,
            '<span class="handrive-js-token-builtin">$1</span>'
        );
        text = text.replace(/(\b[a-zA-Z_$][\w$]*)(\s*\()/g, '<span class="handrive-js-token-function">$1</span>$2');

        return restorePlaceholders(text);
    }

    // CSS 코드를 하이라이팅하는 함수
    function highlightCssCode(source) {
        const placeholders = [];

        const putPlaceholder = function (tokenHtml) {
            const token = "@@DOCS_CSS_TOKEN_" + String(placeholders.length) + "@@";
            placeholders.push(tokenHtml);
            return token;
        };

        const restorePlaceholders = function (text) {
            return text.replace(/@@DOCS_CSS_TOKEN_(\d+)@@/g, function (_, indexText) {
                const index = Number(indexText);
                if (Number.isNaN(index) || index < 0 || index >= placeholders.length) {
                    return "";
                }
                return placeholders[index];
            });
        };

        let text = escapeHtml(source);

        text = text.replace(/\/\*[\s\S]*?\*\//g, function (match) {
            return putPlaceholder('<span class="handrive-css-token-comment">' + match + "</span>");
        });
        text = text.replace(/(["'])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, function (match) {
            return putPlaceholder('<span class="handrive-css-token-string">' + match + "</span>");
        });

        text = text.replace(/(^|[}\s])([#.:\w\-\[\]=\*>\+\~,]+)(\s*\{)/g, function (_, p1, selectorText, p3) {
            return p1 + '<span class="handrive-css-token-selector">' + selectorText + "</span>" + p3;
        });
        text = text.replace(/(--[\w-]+)(\s*:)/g, '<span class="handrive-css-token-variable">$1</span>$2');
        text = text.replace(/([a-z-]+)(\s*:)/gi, '<span class="handrive-css-token-property">$1</span>$2');
        text = text.replace(/(:\s*)(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\)|\b[a-zA-Z]+\b)/g, '$1<span class="handrive-css-token-value">$2</span>');
        text = text.replace(/(-?\d+(?:\.\d+)?)(px|em|rem|vh|vw|%|deg|s|ms)?\b/g, '<span class="handrive-css-token-number">$1$2</span>');

        return restorePlaceholders(text);
    }

    // JSON 코드를 하이라이팅하는 함수
    function highlightJsonCode(source) {
        const placeholders = [];

        const putPlaceholder = function (tokenHtml) {
            const token = "@@DOCS_JSON_TOKEN_" + String(placeholders.length) + "@@";
            placeholders.push(tokenHtml);
            return token;
        };

        const restorePlaceholders = function (text) {
            return text.replace(/@@DOCS_JSON_TOKEN_(\d+)@@/g, function (_, indexText) {
                const index = Number(indexText);
                if (Number.isNaN(index) || index < 0 || index >= placeholders.length) {
                    return "";
                }
                return placeholders[index];
            });
        };

        let text = escapeHtml(source);

        text = text.replace(/"(?:\\.|[^"\\])*"(?=\s*:)/g, function (match) {
            return putPlaceholder('<span class="handrive-json-token-key">' + match + "</span>");
        });
        text = text.replace(/"(?:\\.|[^"\\])*"/g, function (match) {
            return putPlaceholder('<span class="handrive-json-token-string">' + match + "</span>");
        });
        text = text.replace(/\b(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi, '<span class="handrive-json-token-number">$1</span>');
        text = text.replace(/\b(true|false|null)\b/g, '<span class="handrive-json-token-literal">$1</span>');
        text = text.replace(/([{}\[\],:])/g, '<span class="handrive-json-token-punctuation">$1</span>');

        return restorePlaceholders(text);
    }

    // Python 코드를 하이라이팅하는 함수
    function highlightPythonCode(source) {
        const placeholders = [];

        const putPlaceholder = function (tokenHtml) {
            const token = "@@DOCS_PY_TOKEN_" + String(placeholders.length) + "@@";
            placeholders.push(tokenHtml);
            return token;
        };

        const restorePlaceholders = function (text) {
            return text.replace(/@@DOCS_PY_TOKEN_(\d+)@@/g, function (_, indexText) {
                const index = Number(indexText);
                if (Number.isNaN(index) || index < 0 || index >= placeholders.length) {
                    return "";
                }
                return placeholders[index];
            });
        };

        let text = escapeHtml(source);

        text = text.replace(/("""[\s\S]*?"""|'''[\s\S]*?''')/g, function (match) {
            return putPlaceholder('<span class="handrive-py-token-string">' + match + "</span>");
        });
        text = text.replace(/#[^\r\n]*/g, function (match) {
            return putPlaceholder('<span class="handrive-py-token-comment">' + match + "</span>");
        });
        text = text.replace(/(["'])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, function (match) {
            return putPlaceholder('<span class="handrive-py-token-string">' + match + "</span>");
        });

        text = text.replace(/(^|\s)(@[a-zA-Z_][\w.]*)/g, '$1<span class="handrive-py-token-decorator">$2</span>');
        text = text.replace(/\b(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi, '<span class="handrive-py-token-number">$1</span>');
        text = text.replace(
            /\b(def|class|return|if|elif|else|for|while|break|continue|try|except|finally|raise|import|from|as|with|pass|yield|lambda|global|nonlocal|assert|del|in|is|and|or|not|async|await|match|case)\b/g,
            '<span class="handrive-py-token-keyword">$1</span>'
        );
        text = text.replace(/\b(True|False|None)\b/g, '<span class="handrive-py-token-literal">$1</span>');
        text = text.replace(
            /\b(len|range|str|int|float|dict|list|set|tuple|print|open|type|isinstance|enumerate|zip|map|filter|sum|min|max|abs|sorted|reversed|any|all)\b/g,
            '<span class="handrive-py-token-builtin">$1</span>'
        );
        text = text.replace(/\b(def)\s+([a-zA-Z_][\w]*)/g, '$1 <span class="handrive-py-token-function">$2</span>');
        text = text.replace(/\b(class)\s+([a-zA-Z_][\w]*)/g, '$1 <span class="handrive-py-token-class">$2</span>');

        return restorePlaceholders(text);
    }

    // HTML 코드를 하이라이팅하는 함수
    function highlightHtmlCode(source) {
        const placeholders = [];

        const putPlaceholder = function (tokenHtml) {
            const token = "@@DOCS_HTML_TOKEN_" + String(placeholders.length) + "@@";
            placeholders.push(tokenHtml);
            return token;
        };

        const restorePlaceholders = function (text) {
            return text.replace(/@@DOCS_HTML_TOKEN_(\d+)@@/g, function (_, indexText) {
                const index = Number(indexText);
                if (Number.isNaN(index) || index < 0 || index >= placeholders.length) {
                    return "";
                }
                return placeholders[index];
            });
        };

        let text = escapeHtml(source);

        text = text.replace(/&lt;!--[\s\S]*?--&gt;/g, function (match) {
            return putPlaceholder('<span class="handrive-html-token-comment">' + match + "</span>");
        });
        text = text.replace(/(["'])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, function (match) {
            return putPlaceholder('<span class="handrive-html-token-string">' + match + "</span>");
        });
        text = text.replace(
            /(&lt;\/?)([a-zA-Z][\w:-]*)([\s\S]*?)(&gt;)/g,
            function (_, open, tagName, attributes, close) {
                let highlightedAttributes = attributes;
                highlightedAttributes = highlightedAttributes.replace(
                    /(\s)([a-zA-Z_:][\w:.-]*)(\s*=\s*)/g,
                    '$1<span class="handrive-html-token-attr">$2</span>$3'
                );
                return (
                    '<span class="handrive-html-token-punctuation">' + open + "</span>" +
                    '<span class="handrive-html-token-tag">' + tagName + "</span>" +
                    highlightedAttributes +
                    '<span class="handrive-html-token-punctuation">' + close + "</span>"
                );
            }
        );

        return restorePlaceholders(text);
    }

    // 마크다운 소스 코드를 하이라이팅하는 함수
    function highlightMarkdownSourceCode(source) {
        const placeholders = [];

        const putPlaceholder = function (tokenHtml) {
            const token = "@@DOCS_MD_SRC_TOKEN_" + String(placeholders.length) + "@@";
            placeholders.push(tokenHtml);
            return token;
        };

        const restorePlaceholders = function (text) {
            return text.replace(/@@DOCS_MD_SRC_TOKEN_(\d+)@@/g, function (_, indexText) {
                const index = Number(indexText);
                if (Number.isNaN(index) || index < 0 || index >= placeholders.length) {
                    return "";
                }
                return placeholders[index];
            });
        };

        let text = escapeHtml(source);

        text = text.replace(/```[\s\S]*?```/g, function (match) {
            return putPlaceholder('<span class="handrive-md-src-token-codeblock">' + match + "</span>");
        });
        text = text.replace(/`[^`\r\n]+`/g, function (match) {
            return putPlaceholder('<span class="handrive-md-src-token-code">' + match + "</span>");
        });
        text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, url) {
            return (
                '<span class="handrive-md-src-token-link">[' +
                label +
                "](" +
                url +
                ")</span>"
            );
        });
        text = text.replace(/^(\s{0,3}#{1,6}\s+)/gm, '<span class="handrive-md-src-token-heading">$1</span>');
        text = text.replace(/^(\s{0,3}(?:[-*+]|\d+\.)\s+)/gm, '<span class="handrive-md-src-token-list">$1</span>');
        text = text.replace(/^(\s{0,3}&gt;\s?)/gm, '<span class="handrive-md-src-token-quote">$1</span>');
        text = text.replace(/^(\s{0,3}(?:[-*_])(?:\s*[-*_]){2,}\s*)$/gm, '<span class="handrive-md-src-token-hr">$1</span>');
        text = text.replace(/(\*\*|__)(.+?)\1/g, '<span class="handrive-md-src-token-strong">$1$2$1</span>');
        text = text.replace(/(\*|_)([^*_][^]*?)\1/g, '<span class="handrive-md-src-token-em">$1$2$1</span>');

        return restorePlaceholders(text);
    }

    // 코드 언어 클래스를 감지하는 함수
    function detectCodeLanguageClass(codeNode) {
        if (!codeNode || !(codeNode instanceof Element)) {
            return "";
        }
        const classes = Array.from(codeNode.classList || []);
        const languageClass = classes.find(function (className) {
            return /^language-/i.test(className);
        });
        const languageValue = languageClass ? languageClass.replace(/^language-/i, "") : "";
        const normalized = String(languageValue || "").toLowerCase();
        if (normalized === "js" || normalized === "javascript" || normalized === "mjs" || normalized === "cjs") {
            return "handrive-js";
        }
        if (normalized === "css") {
            return "handrive-css";
        }
        if (normalized === "json" || normalized === "jsonc") {
            return "handrive-json";
        }
        if (normalized === "py" || normalized === "python" || normalized === "py3" || normalized === "pyi") {
            return "handrive-py";
        }
        return "";
    }

    // 문서 코드 하이라이팅을 적용하는 함수
    function applyHandriveCodeHighlighting(targetElement, renderClass) {
        if (!targetElement || !(targetElement instanceof Element)) {
            return;
        }
        if (
            renderClass !== "handrive-js" &&
            renderClass !== "handrive-css" &&
            renderClass !== "handrive-json" &&
            renderClass !== "handrive-py" &&
            renderClass !== "ui-markdown"
        ) {
            return;
        }

        const codeNodes = targetElement.querySelectorAll("pre code");
        codeNodes.forEach(function (codeNode) {
            if (!(codeNode instanceof HTMLElement)) {
                return;
            }
            if (codeNode.dataset.handriveCodeHighlighted === "1") {
                return;
            }
            const effectiveRenderClass = renderClass === "ui-markdown"
                ? detectCodeLanguageClass(codeNode)
                : renderClass;
            if (!effectiveRenderClass) {
                return;
            }
            const source = codeNode.textContent || "";
            if (effectiveRenderClass === "handrive-js") {
                codeNode.innerHTML = highlightJavaScriptCode(source);
            } else if (effectiveRenderClass === "handrive-css") {
                codeNode.innerHTML = highlightCssCode(source);
            } else if (effectiveRenderClass === "handrive-py") {
                codeNode.innerHTML = highlightPythonCode(source);
            } else {
                codeNode.innerHTML = highlightJsonCode(source);
            }
            codeNode.dataset.handriveCodeHighlighted = "1";
        });
    }

    // 열린 문서 모달이 있는지 확인하는 함수
    function hasOpenHandriveModal() {
        return Boolean(
            document.querySelector(
                ".handrive-popup-modal:not([hidden]), .handrive-save-modal:not([hidden]), .handrive-help-modal:not([hidden]), .handrive-folder-modal:not([hidden]), .handrive-sync-modal:not([hidden])"
            )
        );
    }

    // 문서 모달 바디 상태를 동기화하는 함수
    function syncHandriveModalBodyState() {
        document.body.classList.toggle("handrive-modal-open", hasOpenHandriveModal());
    }

    // 문서 확인 다이얼로그를 생성하는 함수
    function createHandriveConfirmDialog() {
        const confirmModal = document.getElementById("handrive-confirm-modal");
        const confirmBackdrop = document.getElementById("handrive-confirm-modal-backdrop");
        const confirmTitle = document.getElementById("handrive-confirm-title");
        const confirmMessage = document.getElementById("handrive-confirm-message");
        const confirmCancelButton = document.getElementById("handrive-confirm-cancel-btn");
        const confirmConfirmButton = document.getElementById("handrive-confirm-confirm-btn");

        if (
            !confirmModal ||
            !confirmBackdrop ||
            !confirmTitle ||
            !confirmMessage ||
            !confirmCancelButton ||
            !confirmConfirmButton
        ) {
            return async function () {
                return false;
            };
        }

        let resolvePending = null;
        let isOpen = false;
        let lastFocusedElement = null;

        // 다이얼로그를 닫는 함수
        const close = function (confirmed) {
            if (!isOpen) {
                return;
            }

            confirmModal.hidden = true;
            isOpen = false;

            if (resolvePending) {
                resolvePending(Boolean(confirmed));
                resolvePending = null;
            }

            if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
                lastFocusedElement.focus();
            }
            lastFocusedElement = null;
        };

        confirmBackdrop.addEventListener("click", function () {
            close(false);
        });

        confirmCancelButton.addEventListener("click", function () {
            close(false);
        });

        confirmConfirmButton.addEventListener("click", function () {
            close(true);
        });

        document.addEventListener("keydown", function (event) {
            if (event.key !== "Escape" || !isOpen) {
                return;
            }
            event.preventDefault();
            close(false);
        });

        // 확인 다이얼로그를 요청하는 함수
        return function requestConfirmDialog(options) {
            const settings = options || {};
            const titleText = settings.title || t("js_confirm_title", "확인");
            const messageText = settings.message || "";
            const cancelText = settings.cancelText || t("cancel", "취소");
            const confirmText = settings.confirmText || t("js_confirm_ok", "확인");

            if (resolvePending) {
                resolvePending(false);
                resolvePending = null;
            }

            confirmTitle.textContent = titleText;
            confirmMessage.textContent = messageText;
            confirmCancelButton.textContent = cancelText;
            confirmConfirmButton.textContent = confirmText;

            confirmModal.hidden = false;
            isOpen = true;
            lastFocusedElement = document.activeElement;
            confirmConfirmButton.focus();

            return new Promise(function (resolve) {
                resolvePending = resolve;
            });
        };
    }

    const requestConfirmDialog = createHandriveConfirmDialog();

    function createHandriveCommitMessageDialog() {
        const modal = document.getElementById("handrive-commit-message-modal");
        const backdrop = document.getElementById("handrive-commit-message-modal-backdrop");
        const target = document.getElementById("handrive-commit-message-target");
        const input = document.getElementById("handrive-commit-message-input");
        const cancelButton = document.getElementById("handrive-commit-message-cancel-btn");
        const confirmButton = document.getElementById("handrive-commit-message-confirm-btn");

        if (!modal || !backdrop || !target || !input || !cancelButton || !confirmButton) {
            return async function () {
                return null;
            };
        }

        let resolvePending = null;
        let isOpen = false;
        let lastFocusedElement = null;

        const close = function (value) {
            if (!isOpen) {
                return;
            }
            modal.hidden = true;
            isOpen = false;
            if (resolvePending) {
                resolvePending(value);
                resolvePending = null;
            }
            if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
                lastFocusedElement.focus();
            }
            lastFocusedElement = null;
        };

        const submit = function () {
            var message = String(input.value || "").trim();
            if (!message) {
                window.alert("커밋 메시지를 입력해주세요.");
                input.focus();
                return;
            }
            close(message);
        };

        backdrop.addEventListener("click", function () {
            close(null);
        });
        cancelButton.addEventListener("click", function () {
            close(null);
        });
        confirmButton.addEventListener("click", function () {
            submit();
        });
        input.addEventListener("keydown", function (event) {
            if (!isOpen) {
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                close(null);
                return;
            }
            if (event.key === "Enter") {
                event.preventDefault();
                submit();
            }
        });

        return function requestCommitMessageDialog(options) {
            if (resolvePending) {
                resolvePending(null);
                resolvePending = null;
            }

            var settings = options || {};
            target.textContent = settings.targetPath || "";
            input.value = String(settings.initialValue || "");
            modal.hidden = false;
            isOpen = true;
            lastFocusedElement = document.activeElement;
            window.setTimeout(function () {
                input.focus();
                input.select();
            }, 0);

            return new Promise(function (resolve) {
                resolvePending = resolve;
            });
        };
    }

    const requestCommitMessageDialog = createHandriveCommitMessageDialog();

    function createHandriveClipboardFilenameDialog() {
        const modal = document.getElementById("handrive-clipboard-filename-modal");
        const backdrop = document.getElementById("handrive-clipboard-filename-modal-backdrop");
        const target = document.getElementById("handrive-clipboard-filename-target");
        const input = document.getElementById("handrive-clipboard-filename-input");
        const cancelButton = document.getElementById("handrive-clipboard-filename-cancel-btn");
        const confirmButton = document.getElementById("handrive-clipboard-filename-confirm-btn");

        if (!modal || !backdrop || !target || !input || !cancelButton || !confirmButton) {
            return async function () {
                return null;
            };
        }

        let resolvePending = null;
        let isOpen = false;
        let lastFocusedElement = null;

        const close = function (value) {
            if (!isOpen) {
                return;
            }
            modal.hidden = true;
            isOpen = false;
            syncHandriveModalBodyState();
            if (resolvePending) {
                resolvePending(value);
                resolvePending = null;
            }
            if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
                lastFocusedElement.focus();
            }
            lastFocusedElement = null;
        };

        const submit = function () {
            close(String(input.value || "").trim());
        };

        backdrop.addEventListener("click", function () {
            close(null);
        });
        cancelButton.addEventListener("click", function () {
            close(null);
        });
        confirmButton.addEventListener("click", function () {
            submit();
        });
        input.addEventListener("keydown", function (event) {
            if (!isOpen) {
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                close(null);
                return;
            }
            if (event.key === "Enter") {
                event.preventDefault();
                submit();
            }
        });

        return function requestClipboardFilenameDialog(options) {
            if (resolvePending) {
                resolvePending(null);
                resolvePending = null;
            }

            const settings = options || {};
            target.textContent = settings.targetText || "";
            input.value = "";
            if (settings.placeholder) {
                input.placeholder = settings.placeholder;
            }
            modal.hidden = false;
            isOpen = true;
            lastFocusedElement = document.activeElement;
            syncHandriveModalBodyState();
            window.setTimeout(function () {
                input.focus();
                input.select();
            }, 0);

            return new Promise(function (resolve) {
                resolvePending = resolve;
            });
        };
    }

    const requestClipboardFilenameDialog = createHandriveClipboardFilenameDialog();

    function createHandriveUrlShareModal() {
        const shareModal = document.getElementById("handrive-url-share-modal");
        const shareBackdrop = document.getElementById("handrive-url-share-modal-backdrop");
        const shareCheckbox = document.getElementById("handrive-url-share-enabled-checkbox");
        const shareToggleLabel = shareCheckbox ? shareCheckbox.closest(".handrive-url-share-toggle-label") : null;
        const shareUrlRow = document.getElementById("handrive-url-share-url-row");
        const shareInput = document.getElementById("handrive-url-share-input");
        const shareCloseButton = document.getElementById("handrive-url-share-close-btn");
        const shareCopyButton = document.getElementById("handrive-url-share-copy-btn");

        if (!shareModal || !shareBackdrop || !shareCheckbox || !shareInput || !shareCloseButton || !shareCopyButton) {
            return {
                open: function () {},
                close: function () {},
            };
        }

        let lastFocusedElement = null;
        let currentOnToggle = null;
        let isToggling = false;
        let currentShareUrl = "";

        function decodeUrlForDisplay(url) {
            const rawUrl = String(url || "");
            if (!rawUrl) {
                return "";
            }
            try {
                return decodeURI(rawUrl);
            } catch (error) {
                return rawUrl;
            }
        }

        function setUrlRowVisible(visible, url) {
            currentShareUrl = visible ? String(url || "") : "";
            shareUrlRow.hidden = !visible;
            shareCopyButton.hidden = !visible;
            if (visible) {
                shareInput.value = decodeUrlForDisplay(currentShareUrl);
            } else {
                shareInput.value = "";
                shareCopyButton.textContent = t("url_share_copy_button", "복사");
            }
        }

        function close() {
            if (shareModal.hidden) {
                return;
            }
            shareModal.hidden = true;
            currentOnToggle = null;
            isToggling = false;
            shareCheckbox.disabled = false;
            if (shareToggleLabel) {
                shareToggleLabel.hidden = false;
            }
            shareCopyButton.textContent = t("url_share_copy_button", "복사");
            if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
                lastFocusedElement.focus();
            }
            lastFocusedElement = null;
            syncHandriveModalBodyState();
        }

        async function copyCurrentUrl() {
            const value = currentShareUrl || shareInput.value || "";
            if (!value) {
                return;
            }
            try {
                if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
                    await navigator.clipboard.writeText(value);
                } else {
                    shareInput.focus();
                    shareInput.select();
                    document.execCommand("copy");
                }
                shareCopyButton.textContent = t("url_share_copied", "복사됨");
            } catch (error) {
                shareInput.focus();
                shareInput.select();
            }
        }

        // options: { isUrlOnly: bool, shareUrl: string, readOnly: bool, onToggle: async (enabled) => { shareUrl, isUrlOnly } }
        function open(options) {
            const isUrlOnly = Boolean(options && options.isUrlOnly);
            const shareUrl = (options && options.shareUrl) || "";
            const readOnly = Boolean(options && options.readOnly);
            currentOnToggle = (!readOnly && options && typeof options.onToggle === "function") ? options.onToggle : null;

            shareCheckbox.checked = isUrlOnly;
            shareCheckbox.disabled = readOnly;
            if (shareToggleLabel) {
                shareToggleLabel.hidden = readOnly;
            }
            setUrlRowVisible(isUrlOnly || readOnly, shareUrl);
            shareCopyButton.textContent = t("url_share_copy_button", "복사");
            shareModal.hidden = false;
            lastFocusedElement = document.activeElement;
            syncHandriveModalBodyState();
            window.requestAnimationFrame(function () {
                if (readOnly && shareInput) {
                    shareInput.focus();
                    shareInput.select();
                    return;
                }
                shareCheckbox.focus();
            });
        }

        shareCheckbox.addEventListener("change", function () {
            if (isToggling || !currentOnToggle) {
                return;
            }
            const enabled = shareCheckbox.checked;
            isToggling = true;
            shareCheckbox.disabled = true;
            currentOnToggle(enabled).then(function (result) {
                shareCheckbox.checked = Boolean(result && result.isUrlOnly);
                setUrlRowVisible(shareCheckbox.checked, (result && result.shareUrl) || "");
            }).catch(function (error) {
                shareCheckbox.checked = !enabled;
                alertError(error);
            }).finally(function () {
                shareCheckbox.disabled = false;
                isToggling = false;
            });
        });

        shareBackdrop.addEventListener("click", close);
        shareCloseButton.addEventListener("click", close);
        shareCopyButton.addEventListener("click", function () {
            copyCurrentUrl().catch(function () {});
        });
        document.addEventListener("keydown", function (event) {
            if (event.key !== "Escape" || shareModal.hidden) {
                return;
            }
            event.preventDefault();
            close();
        });

        return { open: open, close: close };
    }

    const urlShareModal = createHandriveUrlShareModal();

    // 문서 페이지 도움말 모달을 초기화하는 함수
    function initializeHandrivePageHelpModal() {
        const pageHelpButton = document.getElementById("handrive-page-help-btn");
        const pageHelpModal = document.getElementById("handrive-page-help-modal");
        const pageHelpBackdrop = document.getElementById("handrive-page-help-backdrop");
        if (!pageHelpButton || !pageHelpModal || !pageHelpBackdrop) {
            return;
        }

        let lastFocusedElement = null;

        // 페이지 도움말 모달 열림 상태를 설정하는 함수
        function setPageHelpModalOpen(opened) {
            pageHelpModal.hidden = !opened;
            pageHelpButton.setAttribute("aria-expanded", opened ? "true" : "false");
            syncHandriveModalBodyState();
            if (opened) {
                lastFocusedElement = document.activeElement;
                return;
            }
            if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
                lastFocusedElement.focus();
            }
            lastFocusedElement = null;
        }

        pageHelpButton.addEventListener("click", function (event) {
            event.preventDefault();
            setPageHelpModalOpen(true);
        });

        pageHelpBackdrop.addEventListener("click", function () {
            setPageHelpModalOpen(false);
        });

        document.addEventListener("keydown", function (event) {
            if (event.key !== "Escape" || pageHelpModal.hidden) {
                return;
            }
            event.preventDefault();
            setPageHelpModalOpen(false);
        });
    }

    // 문서 인증 상호작용을 초기화하는 함수
    function initializeHandriveAuthInteraction() {
        const accountTrigger = document.querySelector("[data-auth-account-trigger]");
        const accountMenu = document.querySelector("[data-auth-account-menu]");
        const accountLogoutButton = document.querySelector("[data-auth-account-logout]");
        const profileUploadForm = document.querySelector("[data-root-account-profile-upload-form]");
        const profileImageTrigger = document.querySelector("[data-root-account-profile-image-trigger]");
        const profileImageInput = document.querySelector("[data-root-account-profile-image-input]");
        const logoutForm = document.getElementById("auth-logout-form");
        if (!accountTrigger || !logoutForm) {
            return;
        }

        const logoutModal = document.getElementById("handrive-auth-logout-modal");
        const logoutModalBackdrop = document.getElementById("handrive-auth-logout-modal-backdrop");
        const logoutCancelButton = document.getElementById("handrive-auth-logout-cancel-btn");
        const logoutConfirmButton = document.getElementById("handrive-auth-logout-confirm-btn");
        const logoutMessage = document.getElementById("handrive-auth-logout-message");

        let lastFocusedElement = null;

        function setAccountMenuOpen(opened) {
            if (!accountMenu) {
                return;
            }
            accountMenu.hidden = !opened;
            accountTrigger.setAttribute("aria-expanded", opened ? "true" : "false");
        }

        // 로그아웃 모달 열림 상태를 설정하는 함수
        function setLogoutModalOpen(opened) {
            if (!logoutModal) {
                return;
            }
            logoutModal.hidden = !opened;
            if (opened) {
                if (logoutCancelButton) {
                    logoutCancelButton.focus();
                }
                return;
            }
            if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
                lastFocusedElement.focus();
            }
        }

        async function requestLogout() {
            const message =
                (accountLogoutButton ? accountLogoutButton.getAttribute("data-confirm-message") : "") ||
                t("auth_logout_confirm", "로그아웃 하시겠습니까?");
            if (!logoutModal || !logoutModalBackdrop || !logoutCancelButton || !logoutConfirmButton || !logoutMessage) {
                const confirmed = await requestConfirmDialog({
                    title: t("auth_logout_button", "로그아웃"),
                    message: message,
                    cancelText: t("cancel", "취소"),
                    confirmText: t("auth_logout_button", "로그아웃")
                });
                if (!confirmed) {
                    return;
                }
                logoutForm.submit();
                return;
            }

            lastFocusedElement = document.activeElement;
            logoutMessage.textContent = message;
            setLogoutModalOpen(true);
        }

        accountTrigger.addEventListener("click", function (event) {
            event.preventDefault();
            if (!accountMenu) {
                requestLogout();
                return;
            }
            const isOpen = !accountMenu.hidden;
            setAccountMenuOpen(!isOpen);
        });

        if (accountLogoutButton) {
            accountLogoutButton.addEventListener("click", function (event) {
                event.preventDefault();
                setAccountMenuOpen(false);
                requestLogout();
            });
        }

        if (profileUploadForm && profileImageTrigger && profileImageInput) {
            profileImageTrigger.addEventListener("click", function (event) {
                event.preventDefault();
                profileImageInput.click();
            });

            profileImageInput.addEventListener("change", function () {
                if (!profileImageInput.files || !profileImageInput.files.length) {
                    return;
                }
                profileUploadForm.submit();
            });
        }

        document.addEventListener("click", function (event) {
            if (!accountMenu || accountMenu.hidden) {
                return;
            }
            const target = event.target;
            if (accountMenu.contains(target) || accountTrigger.contains(target)) {
                return;
            }
            setAccountMenuOpen(false);
        });

        if (logoutModalBackdrop) {
            logoutModalBackdrop.addEventListener("click", function () {
                setLogoutModalOpen(false);
            });
        }

        if (logoutCancelButton) {
            logoutCancelButton.addEventListener("click", function () {
                setLogoutModalOpen(false);
            });
        }

        if (logoutConfirmButton) {
            logoutConfirmButton.addEventListener("click", function () {
                logoutForm.submit();
            });
        }

        document.addEventListener("keydown", function (event) {
            if (event.key !== "Escape") {
                return;
            }
            if (accountMenu && !accountMenu.hidden) {
                event.preventDefault();
                setAccountMenuOpen(false);
                return;
            }
            if (!logoutModal || logoutModal.hidden) {
                return;
            }
            event.preventDefault();
            setLogoutModalOpen(false);
        });
    }

    // 문서 툴바 자동 축소를 초기화하는 함수
    function initializeHandriveToolbarAutoCollapse() {
        const toolbar = document.querySelector(".handrive-toolbar-wrap .handrive-toolbar");
        if (!toolbar) {
            return;
        }

        const toolbarChildren = Array.from(toolbar.children).filter(function (child) {
            return child && child.nodeType === 1 && !child.hasAttribute("data-auth-account");
        });
        if (toolbarChildren.length < 2) {
            toolbar.classList.remove("handrive-toolbar-auto-collapsed");
            return;
        }

        let rafId = null;

        const toolbarItemsMeasure = document.createElement("div");
        toolbarItemsMeasure.setAttribute("aria-hidden", "true");
        Object.assign(toolbarItemsMeasure.style, {
            position: "fixed",
            left: "-99999px",
            top: "-99999px",
            visibility: "hidden",
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            flexWrap: "nowrap",
            width: "auto",
            maxWidth: "none",
            margin: "0",
            padding: "0"
        });

        toolbarChildren.forEach(function (child) {
            const clone = child.cloneNode(true);
            Object.assign(clone.style, {
                flex: "0 0 auto",
                width: "max-content",
                minWidth: "max-content",
                maxWidth: "none",
                margin: "0",
                whiteSpace: "nowrap"
            });

            clone.querySelectorAll("*").forEach(function (node) {
                if (!(node instanceof window.HTMLElement)) {
                    return;
                }
                node.style.whiteSpace = "nowrap";
                node.style.flexWrap = "nowrap";
            });

            toolbarItemsMeasure.appendChild(clone);
        });

        document.body.appendChild(toolbarItemsMeasure);

        // 툴바 모드를 업데이트하는 함수
        const updateToolbarMode = function () {
            rafId = null;

            toolbar.classList.remove("handrive-toolbar-auto-collapsed");

            const toolbarStyle = window.getComputedStyle(toolbar);
            const gapValue = parseFloat(toolbarStyle.columnGap || toolbarStyle.gap || "0");
            const horizontalGap = Number.isFinite(gapValue) ? gapValue : 0;
            toolbarItemsMeasure.style.gap = horizontalGap + "px";

            const paddingLeftValue = parseFloat(toolbarStyle.paddingLeft || "0");
            const paddingRightValue = parseFloat(toolbarStyle.paddingRight || "0");
            const horizontalPadding =
                (Number.isFinite(paddingLeftValue) ? paddingLeftValue : 0) +
                (Number.isFinite(paddingRightValue) ? paddingRightValue : 0);
            const requiredWidth = Math.ceil(toolbarItemsMeasure.getBoundingClientRect().width);
            const availableWidth = Math.max(0, toolbar.clientWidth - horizontalPadding);
            const shouldCollapse = requiredWidth > availableWidth;

            toolbar.classList.toggle("handrive-toolbar-auto-collapsed", shouldCollapse);
        };

        // 툴바 모드 업데이트를 스케줄링하는 함수
        const scheduleToolbarModeUpdate = function () {
            if (rafId !== null) {
                return;
            }
            rafId = window.requestAnimationFrame(updateToolbarMode);
        };

        window.addEventListener("resize", scheduleToolbarModeUpdate, { passive: true });
        window.addEventListener("orientationchange", scheduleToolbarModeUpdate, { passive: true });

        if (window.ResizeObserver) {
            const observer = new ResizeObserver(scheduleToolbarModeUpdate);
            observer.observe(toolbar);
            toolbarChildren.forEach(function (child) {
                observer.observe(child);
            });
        }

        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(scheduleToolbarModeUpdate).catch(function () {});
        }

        scheduleToolbarModeUpdate();
    }

    function initializeListPage() {
        const handriveBaseUrl = root.dataset.handriveBaseUrl || "/handrive";
        const handriveRootUrl = root.dataset.handriveRootUrl || handriveBaseUrl;
        const listApiUrl = root.dataset.listApiUrl;
        const searchApiUrl = root.dataset.searchApiUrl;
        const saveApiUrl = root.dataset.saveApiUrl;
        const renameApiUrl = root.dataset.renameApiUrl;
        const deleteApiUrl = root.dataset.deleteApiUrl;
        const mkdirApiUrl = root.dataset.mkdirApiUrl;
        const moveApiUrl = root.dataset.moveApiUrl;
        const archiveExtractApiUrl = root.dataset.archiveExtractApiUrl || "";
        const archiveCreateApiUrl = root.dataset.archiveCreateApiUrl || "";
        const convertMp3ApiUrl = root.dataset.convertMp3ApiUrl || "";
        const uploadApiUrl = root.dataset.uploadApiUrl;
        const markdownImageUploadApiUrl = root.dataset.markdownImageUploadApiUrl || "";
        const markdownImageCleanupApiUrl = root.dataset.markdownImageCleanupApiUrl || "";
        const uploadCancelApiUrl = root.dataset.uploadCancelApiUrl;
        const downloadApiUrl = root.dataset.downloadApiUrl;
        const previewApiUrl = root.dataset.previewApiUrl;
        const aclApiUrl = root.dataset.aclApiUrl;
        const aclOptionsApiUrl = root.dataset.aclOptionsApiUrl;
        const urlShareApiUrl = root.dataset.urlShareApiUrl;
        const writeUrl = root.dataset.writeUrl || "/handrive/write";
        const mapCreateApiUrl = root.dataset.mapCreateApiUrl || "/handrive/api/map/create";
        const mapEditorBaseUrl = root.dataset.mapEditorBaseUrl || "/handrive/map-editor/";
        const mapViewerBaseUrl = root.dataset.mapViewerBaseUrl || "/handrive/map-viewer/";
        const folderIconUploadApiUrl = root.dataset.folderIconUploadApiUrl || "";
        const folderIconDeleteApiUrl = root.dataset.folderIconDeleteApiUrl || "";
        const pathBreadcrumbs = document.querySelector(".ui-path-breadcrumbs");
        const pathCurrentSizeEl = document.querySelector(".handrive-path-current-size");
        const originalDirSizeText = pathCurrentSizeEl ? (pathCurrentSizeEl.textContent || "") : "";
        const listLayout = document.getElementById("handrive-list-layout");
        const listPane = root.querySelector(".handrive-list-pane");
        const listContainer = document.getElementById("handrive-list");
        const listSearchForm = document.getElementById("handrive-list-search-form");
        const listSearchInput = document.getElementById("handriveListSearchInput");
        const listSearchSubmitButton = document.getElementById("handrive-list-search-submit");
        const listSearchClearButton = document.getElementById("handrive-list-search-clear");
        let currentDirSearchInput = null;
        const listLoadingOverlay = document.getElementById("handrive-list-loading");
        const previewPanel = document.getElementById("handrive-list-preview");
        const previewHead = previewPanel ? previewPanel.querySelector(".handrive-list-preview-head") : null;
        const previewTitle = document.getElementById("handrive-list-preview-title");
        const previewContent = document.getElementById("handrive-list-preview-content");
        const previewZoomWrap = document.getElementById("handrive-list-preview-zoom");
        const previewZoomOutButton = document.getElementById("handrive-list-preview-zoom-out");
        const previewZoomInButton = document.getElementById("handrive-list-preview-zoom-in");
        const previewNavPrevBtn = document.getElementById("handrive-preview-nav-prev");
        const previewNavNextBtn = document.getElementById("handrive-preview-nav-next");
        const previewNavBg = document.getElementById("handrive-preview-nav-bg");
        const previewNavBgPrev = previewNavBg ? previewNavBg.querySelector("span:first-child") : null;
        const previewNavBgNext = previewNavBg ? previewNavBg.querySelector("span:last-child") : null;
        const previewDownloadButton = document.getElementById("handrive-list-preview-download-btn");
        const previewEditButton = document.getElementById("handrive-list-preview-edit-btn");
        const previewDeleteButton = document.getElementById("handrive-list-preview-delete-btn");
        const previewUrlShareButton = document.getElementById("handrive-list-preview-url-share-btn");
        
        // 편집기 관련 요소들
        const editorPanel = document.getElementById("handrive-list-editor");
        const editorHead = editorPanel ? editorPanel.querySelector(".handrive-list-editor-head") : null;
        const editorBody = editorPanel ? editorPanel.querySelector(".handrive-list-editor-body") : null;
        const editorFilenameInput = document.getElementById("handrive-list-filename-input");
        const editorContentInput = document.getElementById("handrive-list-content-input");
        const editorCancelButton = document.getElementById("handrive-list-cancel-btn");
        const editorSaveButton = document.getElementById("handrive-list-save-btn");
        const editorHighlightCode = document.getElementById("handrive-list-editor-highlight-code");
        const editorSurface = document.getElementById("handrive-list-editor-surface");
        const editorHighlight = document.getElementById("handrive-list-editor-highlight");
        const imageEditorSurface = document.getElementById("handrive-image-editor-surface");
        const videoEditorSurface = document.getElementById("handrive-video-editor-surface");
        const audioEditorSurface = document.getElementById("handrive-audio-editor-surface");
        const imageEditorSaveUrl = root.dataset.imageEditorSaveUrl || "";
        const imageEditorRemoveBackgroundUrl = root.dataset.imageEditorRemoveBackgroundUrl || "";
        const videoEditorSaveUrl = root.dataset.videoEditorSaveUrl || "";
        const audioEditorSaveUrl = root.dataset.audioEditorSaveUrl || "";
        const editorSuggest = document.getElementById("handrive-list-editor-suggest");
        const editorSuggestLabel = document.getElementById("handrive-list-editor-suggest-label");
        const markdownSnippetMenu = document.getElementById("ui-markdown-snippet-menu");
        const markdownSnippetButtons = markdownSnippetMenu
            ? Array.from(markdownSnippetMenu.querySelectorAll("button[data-editor-snippet]"))
            : [];
        
        // API URL들
        const handriveApiPreviewUrl = previewApiUrl;
        const scopedHomeDir = normalizePath(root.dataset.scopedHomeDir || "", true);
        const isSuperuser = root.dataset.isSuperuser === "1";
        const initialBreadcrumbNode = pathBreadcrumbs
            ? pathBreadcrumbs.querySelector(".ui-path-link, .ui-path-current")
            : null;
        const breadcrumbRootLabel = (initialBreadcrumbNode && initialBreadcrumbNode.textContent
            ? initialBreadcrumbNode.textContent
            : "HanDrive").trim() || "HanDrive";
        const contextMenu = document.getElementById("handrive-context-menu");
        const contextOpenButton = contextMenu ? contextMenu.querySelector('button[data-action="open"]') : null;
        const contextDownloadButton = contextMenu ? contextMenu.querySelector('button[data-action="download"]') : null;
        const contextExtractArchiveButton = contextMenu ? contextMenu.querySelector('button[data-action="extract-archive"]') : null;
        const contextShareButton = contextMenu ? contextMenu.querySelector('button[data-action="share"]') : null;
        const contextUploadButton = contextMenu ? contextMenu.querySelector('button[data-action="upload"]') : null;
        const contextCreateArchiveButton = contextMenu ? contextMenu.querySelector('button[data-action="create-archive"]') : null;
        const contextEditButton = contextMenu ? contextMenu.querySelector('button[data-action="edit"]') : null;
        const contextRenameButton = contextMenu ? contextMenu.querySelector('button[data-action="rename"]') : null;
        const contextDeleteButton = contextMenu ? contextMenu.querySelector('button[data-action="delete"]') : null;
        const contextNewFolderButton = contextMenu ? contextMenu.querySelector('button[data-action="new-folder"]') : null;
        const contextNewDocButton = contextMenu ? contextMenu.querySelector('button[data-action="new-doc"]') : null;
        const contextPermissionsButton = contextMenu ? contextMenu.querySelector('button[data-action="permissions"]') : null;
        const contextGitCreateRepoButton = contextMenu ? contextMenu.querySelector('button[data-action="git-create-repo"]') : null;
        const contextCreateMapButton = contextMenu ? contextMenu.querySelector('button[data-action="create-map"]') : null;
        const contextConvertMp3Button = contextMenu ? contextMenu.querySelector('button[data-action="convert-mp3"]') : null;
        const contextGitManageRepoButton = contextMenu ? contextMenu.querySelector('button[data-action="git-manage-repo"]') : null;
        const contextGitDeleteRepoButton = contextMenu ? contextMenu.querySelector('button[data-action="git-delete-repo"]') : null;
        const contextGitCreateBranchButton = contextMenu ? contextMenu.querySelector('button[data-action="git-create-branch"]') : null;
        const contextGitDeleteBranchButton = contextMenu ? contextMenu.querySelector('button[data-action="git-delete-branch"]') : null;
        const contextChangeIconButton = contextMenu ? contextMenu.querySelector('button[data-action="change-icon"]') : null;
        const branchCreateModal = document.getElementById("handrive-branch-create-modal");
        const branchCreateModalBackdrop = document.getElementById("handrive-branch-create-modal-backdrop");
        const branchCreateTarget = document.getElementById("handrive-branch-create-target");
        const branchCreateInput = document.getElementById("handrive-branch-create-input");
        const branchCreateCancelButton = document.getElementById("handrive-branch-create-cancel-btn");
        const branchCreateConfirmButton = document.getElementById("handrive-branch-create-confirm-btn");
        const renameModal = document.getElementById("handrive-rename-modal");
        const renameModalBackdrop = document.getElementById("handrive-rename-modal-backdrop");
        const renameInput = document.getElementById("handrive-rename-input");
        const renameTarget = document.getElementById("handrive-rename-target");
        const renameCancelButton = document.getElementById("handrive-rename-cancel-btn");
        const renameConfirmButton = document.getElementById("handrive-rename-confirm-btn");
        const archiveExtractModal = document.getElementById("handrive-archive-extract-modal");
        const archiveExtractModalBackdrop = document.getElementById("handrive-archive-extract-modal-backdrop");
        const archiveExtractTarget = document.getElementById("handrive-archive-extract-target");
        const archiveExtractCancelButton = document.getElementById("handrive-archive-extract-cancel-btn");
        const archiveExtractCurrentButton = document.getElementById("handrive-archive-extract-current-btn");
        const archiveExtractFolderButton = document.getElementById("handrive-archive-extract-folder-btn");
        const folderCreateModal = document.getElementById("handrive-folder-create-modal");
        const folderCreateModalBackdrop = document.getElementById("handrive-folder-create-modal-backdrop");
        const folderCreateTarget = document.getElementById("handrive-folder-create-target");
        const folderCreateInput = document.getElementById("handrive-folder-create-input");
        const folderCreateCancelButton = document.getElementById("handrive-folder-create-cancel-btn");
        const folderCreateConfirmButton = document.getElementById("handrive-folder-create-confirm-btn");
        const gitRepoModal = document.getElementById("handrive-git-repo-modal");
        const gitRepoModalBackdrop = document.getElementById("handrive-git-repo-modal-backdrop");
        const gitRepoTarget = document.getElementById("handrive-git-repo-target");
        const gitRepoNameInput = document.getElementById("handrive-git-repo-name-input");
        const gitRepoCancelButton = document.getElementById("handrive-git-repo-cancel-btn");
        const gitRepoConfirmButton = document.getElementById("handrive-git-repo-confirm-btn");
        const gitRepoForm = document.getElementById("handrive-git-repo-form");
        const gitRepoStatusDiv = document.getElementById("handrive-git-repo-status");
        const gitRepoStatusMsg = document.getElementById("handrive-git-repo-status-msg");
        const gitRepoCloneInfo = document.getElementById("handrive-git-repo-clone-info");
        const gitRepoCloneUrlInput = document.getElementById("handrive-git-repo-clone-url-input");
        const gitRepoCopyButton = document.getElementById("handrive-git-repo-copy-btn");
        const gitRepoOpenButton = document.getElementById("handrive-git-repo-open-btn");
        const gitRepoCloseButton = document.getElementById("handrive-git-repo-close-btn");
        const gitRepoRetryButton = document.getElementById("handrive-git-repo-retry-btn");
        const gitRepoTitle = document.getElementById("handrive-git-repo-title");
        const mapCreateModal = document.getElementById("handrive-map-create-modal");
        const mapCreateModalBackdrop = document.getElementById("handrive-map-create-modal-backdrop");
        const mapCreateInput = document.getElementById("handrive-map-create-input");
        const mapCreateTarget = document.getElementById("handrive-map-create-target");
        const mapCreateCancelButton = document.getElementById("handrive-map-create-cancel-btn");
        const mapCreateConfirmButton = document.getElementById("handrive-map-create-confirm-btn");
        const folderIconModal = document.getElementById("handrive-folder-icon-modal");
        const folderIconModalBackdrop = document.getElementById("handrive-folder-icon-modal-backdrop");
        const folderIconTarget = document.getElementById("handrive-folder-icon-target");
        const folderIconFileInput = document.getElementById("handrive-folder-icon-file-input");
        const folderIconPreviewWrap = document.getElementById("handrive-folder-icon-preview-wrap");
        const folderIconPreviewImg = document.getElementById("handrive-folder-icon-preview-img");
        const folderIconDeleteButton = document.getElementById("handrive-folder-icon-delete-btn");
        const folderIconCancelButton = document.getElementById("handrive-folder-icon-cancel-btn");
        const folderIconConfirmButton = document.getElementById("handrive-folder-icon-confirm-btn");
        const permissionModal = document.getElementById("handrive-permission-modal");
        const permissionModalBackdrop = document.getElementById("handrive-permission-modal-backdrop");
        const permissionTarget = document.getElementById("handrive-permission-target");
        const permissionReadUsersList = document.getElementById("handrive-permission-read-users-list");
        const permissionReadGroupsList = document.getElementById("handrive-permission-read-groups-list");
        const permissionWriteUsersList = document.getElementById("handrive-permission-write-users-list");
        const permissionWriteGroupsList = document.getElementById("handrive-permission-write-groups-list");
        const permissionCancelButton = document.getElementById("handrive-permission-cancel-btn");
        const permissionSaveButton = document.getElementById("handrive-permission-save-btn");
        const syncLaunchButton = document.getElementById("account-storage-popup-sync-btn");
        const syncModal = document.getElementById("handrive-sync-modal");
        const syncModalBackdrop = document.getElementById("handrive-sync-modal-backdrop");
        const syncList = document.getElementById("handrive-sync-list");
        const syncCancelButton = document.getElementById("handrive-sync-cancel-btn");
        const syncSaveButton = document.getElementById("handrive-sync-save-btn");
        const uploadQueuePanel = document.getElementById("handrive-job-queue-panel");
        const uploadQueueSummary = document.getElementById("handrive-job-queue-summary");
        const uploadQueueList = document.getElementById("handrive-job-queue-list");
        const uploadQueueToggleButton = document.getElementById("handrive-job-queue-toggle");
        const uploadQueueCloseButton = document.getElementById("handrive-job-queue-close");
        const contextUploadInput = document.getElementById("handrive-context-upload-input");
        const defaultContextButtonLabels = {
            open: contextOpenButton ? contextOpenButton.textContent : "",
            delete: contextDeleteButton ? contextDeleteButton.textContent : "",
        };
        const nonEditableMediaExtensions = new Set([
            ".png",
            ".jpg",
            ".jpeg",
            ".gif",
            ".webp",
            ".svg",
            ".bmp",
            ".avif",
            ".mp4",
            ".webm",
            ".mov",
            ".mkv",
            ".m4v",
            ".ogv",
            ".mp3",
            ".wav",
            ".ogg",
            ".m4a",
            ".aac",
            ".flac",
            ".weba",
        ]);
        const imageEditorExtensions = new Set([
            ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif", ".avif",
        ]);
        const audioEditorExtensions = new Set([
            ".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac", ".weba",
        ]);
        const videoEditorExtensions = new Set([
            ".mp4", ".mov", ".webm", ".mkv", ".avi", ".wmv", ".m4v", ".ogv",
        ]);
        function isImageEditorEntry(entry) {
            return imageEditorExtensions.has(getEntryFileExtension(entry));
        }
        function isAudioEditorEntry(entry) {
            return audioEditorExtensions.has(getEntryFileExtension(entry));
        }
        function isVideoEditorEntry(entry) {
            return videoEditorExtensions.has(getEntryFileExtension(entry));
        }

        const mediaNavExtensions = new Set([
            ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif", ".tiff", ".tif",
            ".mp4", ".webm", ".mov", ".mkv", ".m4v", ".ogv",
        ]);
        function isMediaNavEntry(entry) {
            return Boolean(entry && entry.type === "file" && mediaNavExtensions.has(getEntryFileExtension(entry)));
        }

        function getVisibleSiblingMediaEntries(parentPath) {
            const normalizedParentPath = normalizePath(parentPath, true);
            const visiblePaths = Array.isArray(state.visibleEntryPaths) ? state.visibleEntryPaths : [];
            const visibleEntries = visiblePaths
                .map(function (pathValue) {
                    return state.entryByPath.get(pathValue) || null;
                })
                .filter(function (entry) {
                    return Boolean(entry && isMediaNavEntry(entry) && getParentPath(entry.path) === normalizedParentPath);
                });
            if (visibleEntries.length) {
                return visibleEntries;
            }
            return getCachedEntries(normalizedParentPath).filter(function (entry) {
                return Boolean(entry && isMediaNavEntry(entry) && getParentPath(entry.path) === normalizedParentPath);
            });
        }

        const currentDir = normalizePath(root.dataset.currentDir || "", true);
        const currentDirIsRoot = root.dataset.currentDirIsRoot === "1";
        const currentDirCanEdit = root.dataset.currentDirCanEdit === "1";
        const currentDirCanWriteChildren =
            root.dataset.currentDirCanWriteChildren === "1" || currentDirCanEdit;
        const currentDirHasChildren = root.dataset.currentDirHasChildren === "1";
        const currentDirIsGitRepoRoot = root.dataset.currentDirIsGitRepoRoot === "1";
        const currentDirRequiresCommitMessage = root.dataset.currentDirRequiresCommitMessage === "1";
        const currentDirGitBranchRoot = root.dataset.currentDirGitBranchRoot === "1";
        const currentDirGitCommitMessage = String(root.dataset.currentDirGitCommitMessage || "").trim();
        const currentDirGitCommitAuthorUsername = String(root.dataset.currentDirGitCommitAuthorUsername || "").trim();
        const currentDirModifiedDisplay = String(root.dataset.currentDirModifiedDisplay || "").trim();
        const currentDirSizeDisplay = String(root.dataset.currentDirSizeDisplay || "").trim();
        const accountProfileImageUrl = String(root.dataset.accountProfileImageUrl || "").trim();
        const handriveRootLabel = (root.dataset.handriveRootLabel || breadcrumbRootLabel || "HanDrive").trim() || "HanDrive";
        const effectiveRootLabel = handriveRootLabel;
        const syncSettingsApiUrl = root.dataset.syncSettingsApiUrl || "";
        const sharedRootPath = normalizePath(root.dataset.handriveSharedRootPath || "", true);
        const initialEntries = getJsonScriptData("handrive-initial-entries", []);
        const currentDirWriteAclLabels = getJsonScriptData("handrive-current-dir-write-acl-labels", []);
        const initialSyncExcludedPaths = getJsonScriptData("handrive-sync-excluded-paths", []);
        let currentDirGitRepo = getJsonScriptData("handrive-current-dir-git-repo", null);

        async function promptCommitMessage(targetPath) {
            return requestCommitMessageDialog({ targetPath: targetPath || "" });
        }

        function requiresCommitMessageForDirectory(pathValue) {
            var normalized = normalizePath(pathValue, true);
            if (normalized === state.currentDir) {
                return Boolean(getCurrentDirMeta().requires_commit_message);
            }
            var entry = state.entryByPath.get(normalized);
            return Boolean(entry && entry.requires_commit_message);
        }

        function requiresCommitMessageForEntries(entries) {
            return Array.isArray(entries) && entries.some(function (entry) {
                return Boolean(entry && entry.requires_commit_message);
            });
        }

        // list 페이지 단일 상태 저장소.
        // 선택/컨텍스트 메뉴/확장 폴더/preview/upload queue 상태를 한곳에서 추적한다.
        const state = {
            currentDir: currentDir,
            currentDirMeta: {
                path: currentDir,
                is_root: currentDirIsRoot,
                can_edit: currentDirCanEdit,
                can_write_children: currentDirCanWriteChildren,
                has_children: currentDirHasChildren,
                is_git_repo_root: currentDirIsGitRepoRoot,
                requires_commit_message: currentDirRequiresCommitMessage,
                git_branch_root: currentDirGitBranchRoot,
                git_commit_message: currentDirGitCommitMessage,
                git_commit_author_username: currentDirGitCommitAuthorUsername,
                modified_display: currentDirModifiedDisplay,
                size_display: currentDirSizeDisplay,
                write_acl_labels: Array.isArray(currentDirWriteAclLabels) ? currentDirWriteAclLabels : [],
                git_repo: currentDirGitRepo,
            },
            selectedPath: "",
            selectedPaths: new Set(),
            selectionAnchorPath: "",
            contextTarget: null,
            contextEntries: [],
            renameTargetEntry: null,
            archiveExtractTargetEntry: null,
            folderIconTargetEntry: null,
            folderCreateParentEntry: null,
            permissionTargetEntry: null,
            permissionTargetEntries: [],
            expandedFolders: new Set(),
            openingFolderPath: "",
            openingAnimationOrder: 0,
            directoryCache: new Map(),
            directoryMetaCache: new Map(),
            aclOptionsLoaded: false,
            aclOptions: {
                users: [],
                groups: [],
            },
            draggingEntries: [],
            draggingRowPaths: new Set(),
            entryByPath: new Map(),
            entryRowByPath: new Map(),
            visibleEntryPaths: [],
            dragOverElement: null,
            dragHoverElement: null,
            fileDropGroupRows: [],
            fileDropGroupPath: "",
            hoverExpandTimerId: null,
            hoverExpandPath: "",
            previewCache: new Map(),
            previewRequestToken: 0,
            activePreviewPath: "",
            activeRenderedPreviewPath: "",
            previewImageZoom: 1,
            uploadQueueItems: [],
            uploadQueueSequence: 0,
            uploadWorkerActive: false,
            operationWorkerActive: false,
            uploadRefreshPending: false,
            uploadQueueDismissed: false,
            uploadQueueCollapsed: false,
            uploadQueueContextItem: null,
            pendingContextUploadDir: "",
            searchQuery: "",
            searchResults: null,
            listSortKey: "",
            listSortDirection: "asc",
            searchGeneration: 0,
            navigationGeneration: 0,
            syncSavedUncheckedPaths: new Set(Array.isArray(initialSyncExcludedPaths) ? initialSyncExcludedPaths : []),
            syncDraftUncheckedPaths: new Set(Array.isArray(initialSyncExcludedPaths) ? initialSyncExcludedPaths : []),
            syncExpandedFolders: new Set(),
        };
        state.directoryMetaCache.set(currentDir, state.currentDirMeta);

        let activeListEditorSuggestions = [];
        let activeListEditorSuggestionIndex = -1;
        let activeListEditorEntry = null;
        let listSuggestEventsBound = false;
        let listMarkdownSnippetEventsBound = false;
        let listMarkdownImageEventsBound = false;
        let listMarkdownUploadedImagePaths = [];
        const listMarkdownImageInput = createMarkdownImageInputHandler({
            textarea: editorContentInput,
            uploadApiUrl: markdownImageUploadApiUrl,
            isEnabled: function () {
                return Boolean(activeListEditorEntry && resolveListEditorExtension() === ".md");
            },
            getMarkdownPath: function () {
                return activeListEditorEntry && activeListEditorEntry.path ? activeListEditorEntry.path : "";
            },
            getMarkdownName: function () {
                return editorFilenameInput ? editorFilenameInput.value : "";
            },
            getTargetDir: function () {
                const pathValue = activeListEditorEntry && activeListEditorEntry.path ? activeListEditorEntry.path : state.currentDir;
                return getParentPath(pathValue) || state.currentDir || "";
            },
            onAfterInsert: function (data) {
                if (data && data.path) {
                    listMarkdownUploadedImagePaths.push(data.path);
                }
                renderListEditorHighlight();
            }
        });

        function resolveListEditorExtension() {
            const entryPath = activeListEditorEntry && activeListEditorEntry.path
                ? String(activeListEditorEntry.path)
                : "";
            const entryMatch = entryPath.match(/\.[A-Za-z0-9]+$/);
            if (entryMatch) {
                return entryMatch[0].toLowerCase();
            }

            const raw = (editorFilenameInput && editorFilenameInput.value ? editorFilenameInput.value : "").trim();
            const match = raw.match(/\.[A-Za-z0-9]+$/);
            return match ? match[0].toLowerCase() : "";
        }

        function clearListEditorSuggestion() {
            activeListEditorSuggestions = [];
            activeListEditorSuggestionIndex = -1;
            if (editorSuggest) {
                editorSuggest.hidden = true;
                editorSuggest.style.left = "";
                editorSuggest.style.top = "";
                editorSuggest.innerHTML = "";
            }
            if (editorSuggestLabel) {
                editorSuggestLabel.textContent = "";
            }
        }

        function closeListMarkdownSnippetMenu() {
            if (!markdownSnippetMenu) {
                return;
            }
            markdownSnippetMenu.hidden = true;
        }

        function openListMarkdownSnippetMenu(clientX, clientY) {
            if (!markdownSnippetMenu) {
                return;
            }
            markdownSnippetMenu.hidden = false;
            markdownSnippetMenu.style.left = "0px";
            markdownSnippetMenu.style.top = "0px";

            const rect = markdownSnippetMenu.getBoundingClientRect();
            const viewportPadding = 8;
            const maxLeft = Math.max(viewportPadding, window.innerWidth - rect.width - viewportPadding);
            const maxTop = Math.max(viewportPadding, window.innerHeight - rect.height - viewportPadding);
            const left = Math.min(Math.max(viewportPadding, clientX), maxLeft);
            const top = Math.min(Math.max(viewportPadding, clientY), maxTop);

            markdownSnippetMenu.style.left = String(left) + "px";
            markdownSnippetMenu.style.top = String(top) + "px";
        }

        function syncListSnippetMenuItemsByExtension(extension) {
            if (!markdownSnippetMenu) {
                return 0;
            }
            const currentExtension = String(extension || "").trim().toLowerCase();
            let visibleCount = 0;
            markdownSnippetButtons.forEach(function (button) {
                const rawExtensions = String(button.getAttribute("data-editor-extensions") || "").trim();
                if (!rawExtensions) {
                    button.hidden = false;
                    visibleCount += 1;
                    return;
                }
                const allowed = rawExtensions
                    .split(",")
                    .map(function (value) { return String(value || "").trim().toLowerCase(); })
                    .filter(Boolean);
                const visible = allowed.includes(currentExtension);
                button.hidden = !visible;
                if (visible) {
                    visibleCount += 1;
                }
            });
            return visibleCount;
        }

        function replaceListEditorSelection(insertText, selectionStartOffset, selectionEndOffset) {
            if (!editorContentInput) {
                return;
            }
            const start = editorContentInput.selectionStart || 0;
            const end = editorContentInput.selectionEnd || 0;
            editorContentInput.setRangeText(insertText, start, end, "end");

            const nextStart = start + (selectionStartOffset || 0);
            const nextEnd = start + (selectionEndOffset || insertText.length);
            editorContentInput.setSelectionRange(nextStart, nextEnd);
            editorContentInput.focus();
            editorContentInput.dispatchEvent(new Event("input", { bubbles: true }));
        }

        function buildListWrappedSnippet(prefix, suffix, placeholder) {
            const start = editorContentInput ? (editorContentInput.selectionStart || 0) : 0;
            const end = editorContentInput ? (editorContentInput.selectionEnd || 0) : 0;
            const selected = editorContentInput ? editorContentInput.value.slice(start, end) : "";
            const body = selected || placeholder;
            const text = prefix + body + suffix;

            if (selected) {
                return { text: text, selectStart: text.length, selectEnd: text.length };
            }
            return {
                text: text,
                selectStart: prefix.length,
                selectEnd: prefix.length + body.length,
            };
        }

        function buildListPrefixedLinesSnippet(prefix, placeholder) {
            const start = editorContentInput ? (editorContentInput.selectionStart || 0) : 0;
            const end = editorContentInput ? (editorContentInput.selectionEnd || 0) : 0;
            const selected = editorContentInput ? editorContentInput.value.slice(start, end) : "";
            if (!selected) {
                const body = prefix + placeholder;
                return {
                    text: body,
                    selectStart: prefix.length,
                    selectEnd: body.length,
                };
            }
            const lines = selected.split(/\r?\n/);
            const transformed = lines.map(function (line) {
                if (!line.trim()) {
                    return line;
                }
                return prefix + line;
            }).join("\n");
            return { text: transformed, selectStart: transformed.length, selectEnd: transformed.length };
        }

        function buildListNumberedLinesSnippet(placeholder) {
            const start = editorContentInput ? (editorContentInput.selectionStart || 0) : 0;
            const end = editorContentInput ? (editorContentInput.selectionEnd || 0) : 0;
            const selected = editorContentInput ? editorContentInput.value.slice(start, end) : "";
            if (!selected) {
                const body = "1. " + placeholder;
                return {
                    text: body,
                    selectStart: 3,
                    selectEnd: body.length,
                };
            }
            let order = 1;
            const transformed = selected
                .split(/\r?\n/)
                .map(function (line) {
                    if (!line.trim()) {
                        return line;
                    }
                    const row = String(order) + ". " + line;
                    order += 1;
                    return row;
                })
                .join("\n");
            return { text: transformed, selectStart: transformed.length, selectEnd: transformed.length };
        }

        function buildListCodeBlockSnippet() {
            const lang = t("markdown_placeholder_code_lang", "text");
            const body = t("markdown_placeholder_code_body", "type your code");
            const text = "```" + lang + "\n" + body + "\n```";
            const bodyStart = ("```" + lang + "\n").length;
            return {
                text: text,
                selectStart: bodyStart,
                selectEnd: bodyStart + body.length,
            };
        }

        function buildListTableSnippet() {
            const col1 = t("markdown_placeholder_table_col1", "Column 1");
            const col2 = t("markdown_placeholder_table_col2", "Column 2");
            const table = [
                "| " + col1 + " | " + col2 + " |",
                "| --- | --- |",
                "| Value 1 | Value 2 |",
            ].join("\n");
            return {
                text: table,
                selectStart: 2,
                selectEnd: 2 + col1.length,
            };
        }

        function insertListMarkdownSnippet(snippetType) {
            if (!editorContentInput) {
                return;
            }
            let snippet = null;
            if (snippetType === "heading2") {
                snippet = buildListWrappedSnippet("## ", "", t("markdown_placeholder_heading", "Heading"));
            } else if (snippetType === "heading3") {
                snippet = buildListWrappedSnippet("### ", "", t("markdown_placeholder_heading", "Heading"));
            } else if (snippetType === "bold") {
                snippet = buildListWrappedSnippet("**", "**", t("markdown_placeholder_bold", "bold text"));
            } else if (snippetType === "italic") {
                snippet = buildListWrappedSnippet("*", "*", t("markdown_placeholder_italic", "italic text"));
            } else if (snippetType === "link") {
                snippet = buildListWrappedSnippet("[", "](https://)", t("markdown_placeholder_link_text", "link text"));
            } else if (snippetType === "image") {
                snippet = buildListWrappedSnippet("![", "](https://)", t("markdown_placeholder_image_alt", "image description"));
            } else if (snippetType === "code_inline") {
                snippet = buildListWrappedSnippet("`", "`", t("markdown_placeholder_inline_code", "code"));
            } else if (snippetType === "code_block") {
                snippet = buildListCodeBlockSnippet();
            } else if (snippetType === "list_bullet") {
                snippet = buildListPrefixedLinesSnippet("- ", t("markdown_placeholder_list_item", "item"));
            } else if (snippetType === "list_numbered") {
                snippet = buildListNumberedLinesSnippet(t("markdown_placeholder_list_item", "item"));
            } else if (snippetType === "list_check") {
                snippet = buildListPrefixedLinesSnippet("- [ ] ", t("markdown_placeholder_list_item", "item"));
            } else if (snippetType === "quote") {
                snippet = buildListPrefixedLinesSnippet("> ", t("markdown_placeholder_quote", "quote"));
            } else if (snippetType === "divider") {
                snippet = { text: "\n---\n", selectStart: 5, selectEnd: 5 };
            } else if (snippetType === "table") {
                snippet = buildListTableSnippet();
            }
            if (!snippet) {
                return;
            }
            replaceListEditorSelection(snippet.text, snippet.selectStart, snippet.selectEnd);
        }

        function findListEditorSuggestions(extension, tokenText) {
            const items = resolveEditorCompletionItemsByExtension(extension);
            return findEditorCompletionItems(items, tokenText, 8);
        }

        function renderListEditorSuggestDropdown() {
            if (!editorSuggest) {
                return;
            }
            editorSuggest.innerHTML = "";

            const list = document.createElement("div");
            list.className = "handrive-editor-suggest-list";

            for (let i = 0; i < activeListEditorSuggestions.length; i += 1) {
                const item = activeListEditorSuggestions[i] || {};
                const option = document.createElement("button");
                option.type = "button";
                option.className = "handrive-editor-suggest-item" + (i === activeListEditorSuggestionIndex ? " is-active" : "");
                option.setAttribute("data-suggest-index", String(i));

                const labelNode = document.createElement("span");
                labelNode.className = "handrive-editor-suggest-item-label";
                labelNode.textContent = item.label || item.insertText || "";

                const triggerNode = document.createElement("span");
                triggerNode.className = "handrive-editor-suggest-item-trigger";
                triggerNode.textContent = item.trigger || "";

                option.appendChild(labelNode);
                option.appendChild(triggerNode);
                list.appendChild(option);
            }

            const footer = document.createElement("div");
            footer.className = "handrive-editor-suggest-footer";
            footer.textContent = "↑↓ 이동 · Enter/Tab 적용";

            editorSuggest.appendChild(list);
            editorSuggest.appendChild(footer);
        }

        function moveListEditorSuggestion(step) {
            if (!activeListEditorSuggestions.length) {
                return;
            }
            const count = activeListEditorSuggestions.length;
            activeListEditorSuggestionIndex = (activeListEditorSuggestionIndex + step + count) % count;
            renderListEditorSuggestDropdown();
        }

        function syncListEditorHighlightScroll() {
            if (!editorContentInput || !editorHighlight) {
                return;
            }
            editorHighlight.scrollTop = editorContentInput.scrollTop;
            editorHighlight.scrollLeft = editorContentInput.scrollLeft;
        }

        function renderListEditorHighlight() {
            if (!editorContentInput || !editorHighlight || !editorHighlightCode) {
                return;
            }

            const extension = resolveListEditorExtension();
            const source = editorContentInput.value || "";
            let renderClass = "handrive-plain-text";
            let highlightedHtml = escapeHtml(source);

            if (extension === ".js") {
                renderClass = "handrive-js";
                highlightedHtml = highlightJavaScriptCode(source);
            } else if (extension === ".md") {
                renderClass = "handrive-editor-md";
                highlightedHtml = escapeHtml(source);
            } else if (extension === ".css") {
                renderClass = "handrive-css";
                highlightedHtml = highlightCssCode(source);
            } else if (extension === ".json") {
                renderClass = "handrive-json";
                highlightedHtml = highlightJsonCode(source);
            } else if (extension === ".py") {
                renderClass = "handrive-py";
                highlightedHtml = highlightPythonCode(source);
            } else if (extension === ".html") {
                renderClass = "handrive-editor-html";
                highlightedHtml = highlightHtmlCode(source);
            }

            editorHighlight.classList.remove(
                "handrive-plain-text",
                "handrive-editor-md",
                "handrive-js",
                "handrive-css",
                "handrive-json",
                "handrive-py",
                "handrive-editor-html"
            );
            editorHighlight.classList.add(renderClass);
            editorHighlightCode.innerHTML = highlightedHtml + (source.endsWith("\n") ? "\u200b" : "");
            syncListEditorHighlightScroll();
        }

        function updateListEditorSuggestion() {
            if (!editorContentInput || !editorSuggest) {
                return;
            }

            const start = editorContentInput.selectionStart || 0;
            const end = editorContentInput.selectionEnd || 0;
            if (start !== end) {
                clearListEditorSuggestion();
                return;
            }

            const extension = resolveListEditorExtension();
            const tokenInfo = extractEditorCompletionToken(editorContentInput.value || "", start);
            if (!tokenInfo) {
                clearListEditorSuggestion();
                return;
            }

            const suggestions = findListEditorSuggestions(extension, tokenInfo.token);
            if (!suggestions.length) {
                clearListEditorSuggestion();
                return;
            }

            activeListEditorSuggestions = suggestions.map(function (suggestion) {
                return {
                    start: tokenInfo.start,
                    end: tokenInfo.end,
                    insertText: suggestion.insertText,
                    cursorBack: Number(suggestion.cursorBack || 0),
                    label: suggestion.label || suggestion.insertText,
                    trigger: suggestion.trigger || "",
                };
            });
            activeListEditorSuggestionIndex = 0;
            renderListEditorSuggestDropdown();
            editorSuggest.hidden = false;

            const calc = window.__handriveCalculateCursorPosition;
            const cursorPosition = typeof calc === "function" ? calc(editorContentInput, start) : null;
            if (cursorPosition) {
                const surfaceRect = editorSurface ? editorSurface.getBoundingClientRect() : null;

                let left = cursorPosition.left + 12;
                let top = cursorPosition.top + (cursorPosition.lineHeight || 20) + 6;

                if (surfaceRect) {
                    left = (cursorPosition.left + 12) - surfaceRect.left;
                    top = (cursorPosition.top + (cursorPosition.lineHeight || 20) + 6) - surfaceRect.top;
                }

                const suggestRect = editorSuggest.getBoundingClientRect();
                if (surfaceRect) {
                    const minLeft = 8;
                    const minTop = 8;
                    const maxLeft = Math.max(minLeft, surfaceRect.width - suggestRect.width - 8);
                    const maxTop = Math.max(minTop, surfaceRect.height - suggestRect.height - 8);
                    left = Math.min(Math.max(minLeft, left), maxLeft);
                    top = Math.min(Math.max(minTop, top), maxTop);
                }

                editorSuggest.style.left = String(left) + "px";
                editorSuggest.style.top = String(top) + "px";
            }
        }

        function acceptListEditorSuggestion(index) {
            if (!editorContentInput) {
                return false;
            }
            const resolvedIndex = Number.isInteger(index) ? index : activeListEditorSuggestionIndex;
            const suggestion = activeListEditorSuggestions[resolvedIndex] || null;
            if (!suggestion) {
                return false;
            }
            editorContentInput.setRangeText(suggestion.insertText, suggestion.start, suggestion.end, "end");
            const cursorPos = (suggestion.start + suggestion.insertText.length) - Math.max(0, suggestion.cursorBack);
            editorContentInput.setSelectionRange(cursorPos, cursorPos);
            editorContentInput.focus();
            editorContentInput.dispatchEvent(new Event("input", { bubbles: true }));
            clearListEditorSuggestion();
            return true;
        }

        state.directoryCache.set(state.currentDir, initialEntries);

        function closeContextMenu() {
            if (!contextMenu) {
                return;
            }
            resetUploadQueueContextMenuState();
            contextMenu.hidden = true;
            state.contextTarget = null;
            state.contextEntries = [];
        }

        function resetUploadQueueContextMenuState() {
            state.uploadQueueContextItem = null;
            if (contextOpenButton) {
                contextOpenButton.textContent = defaultContextButtonLabels.open;
            }
            if (contextDeleteButton) {
                contextDeleteButton.textContent = defaultContextButtonLabels.delete;
            }
        }

        function setContextButtonVisible(button, visible) {
            if (!button) {
                return;
            }
            button.style.display = visible ? "" : "none";
        }

        function isEntryDeletable(entry) {
            if (!entry) {
                return false;
            }
            if (entry.type === "dir" && entry.git_repo) {
                return false;
            }
            if (entry.isCurrentFolder && !entry.can_delete) {
                return false;
            }
            if (!entry.can_edit && !entry.can_delete) {
                return false;
            }
            return !(entry.type === "file" && entry.is_public_write);
        }

        function getSelectedEntries() {
            return state.visibleEntryPaths
                .filter(function (pathValue) {
                    return state.selectedPaths.has(pathValue);
                })
                .map(function (pathValue) {
                    return state.entryByPath.get(pathValue) || null;
                })
                .filter(function (entry) {
                    return Boolean(entry);
                });
        }

        function isKeyboardEditableTarget(target) {
            if (!(target instanceof Element)) {
                return false;
            }
            const tagName = String(target.tagName || "").toLowerCase();
            if (tagName === "input" || tagName === "textarea" || tagName === "select") {
                return true;
            }
            return Boolean(target.isContentEditable);
        }

        function updateListLayoutMode() {
            if (!listLayout) {
                return;
            }
            // 강제로 리플로우 트리거
            void listLayout.offsetWidth;

            const isLandscape = window.innerWidth > window.innerHeight;
            listLayout.classList.toggle("is-landscape", isLandscape);
            listLayout.classList.toggle("is-portrait", !isLandscape);

            // 레이아웃 변경 후 동기화
            setTimeout(function() {
                scheduleSyncCurrentDirRowHeightWithSideHead();
                scheduleListBodyHeight();
                schedulePreviewBodyHeight();
                scheduleEditorBodyHeight();
                updateListColumnVisibility();
                syncSearchFormVisibility();
            }, 10);
        }

        function updateListColumnVisibility() {
            if (!listPane) {
                scheduleSyncCurrentDirRowHeightWithSideHead();
                scheduleListBodyHeight();
                return;
            }

            const metaColumnMap = [
                { selector: ".handrive-item-modified", cssVarName: "--handrive-list-col-modified", hideClass: "is-hide-modified" },
                { selector: ".handrive-item-type", cssVarName: "--handrive-list-col-type", hideClass: "is-hide-type" },
                { selector: ".handrive-item-size", cssVarName: "--handrive-list-col-size", hideClass: "is-hide-size" },
                { selector: ".handrive-item-permission", cssVarName: "--handrive-list-col-permission", hideClass: "is-hide-permission" },
                { selector: ".handrive-item-commit", cssVarName: "--handrive-list-col-commit", hideClass: "is-hide-commit" },
                { selector: ".handrive-item-id", cssVarName: "--handrive-list-col-id", hideClass: "is-hide-id" },
            ];
            const metaHideClasses = metaColumnMap.map(function (column) { return column.hideClass; });
            const responsiveHideClasses = ["is-hide-id", "is-hide-commit", "is-hide-permission", "is-hide-size", "is-hide-type", "is-hide-modified"];

            const isVisibleMetaRow = function (row) {
                return Boolean(
                    row &&
                    !row.classList.contains("handrive-current-dir-row") &&
                    !row.classList.contains("is-empty") &&
                    !row.closest("[hidden]") &&
                    row.offsetParent !== null &&
                    row.getClientRects().length > 0
                );
            };

            const getRegularItemRows = function () {
                return Array.from(listPane.querySelectorAll(".handrive-item-row")).filter(isVisibleMetaRow);
            };

            const getColumnText = function (element) {
                return String(element && element.textContent || "").trim();
            };

            const hasRegularItemColumnText = function (column) {
                const rows = getRegularItemRows();
                for (let index = 0; index < rows.length; index += 1) {
                    if (getColumnText(rows[index].querySelector(column.selector))) {
                        return true;
                    }
                }
                return false;
            };

            const syncSharedMetaColumnWidths = function () {
                const maxWidthByVarName = {};
                const rowsForWidth = getRegularItemRows();
                const currentDirRow = listPane.querySelector(".handrive-current-dir-row");
                const measureWrap = document.createElement("span");
                measureWrap.setAttribute("aria-hidden", "true");
                measureWrap.style.position = "fixed";
                measureWrap.style.left = "-10000px";
                measureWrap.style.top = "-10000px";
                measureWrap.style.visibility = "hidden";
                measureWrap.style.whiteSpace = "nowrap";
                measureWrap.style.width = "auto";
                measureWrap.style.minWidth = "0";
                measureWrap.style.maxWidth = "none";
                measureWrap.style.overflow = "visible";
                measureWrap.style.textOverflow = "clip";
                measureWrap.style.display = "inline-block";
                document.body.appendChild(measureWrap);

                const measureElementTextWidth = function (element) {
                    const text = getColumnText(element);
                    if (!text) {
                        return 0;
                    }
                    const style = window.getComputedStyle(element);
                    measureWrap.style.fontFamily = style.fontFamily;
                    measureWrap.style.fontSize = style.fontSize;
                    measureWrap.style.fontStyle = style.fontStyle;
                    measureWrap.style.fontWeight = style.fontWeight;
                    measureWrap.style.fontVariant = style.fontVariant;
                    measureWrap.style.letterSpacing = style.letterSpacing;
                    measureWrap.style.textTransform = style.textTransform;
                    measureWrap.textContent = text;
                    return Math.ceil(measureWrap.getBoundingClientRect().width || 0);
                };

                metaColumnMap.forEach(function (column) {
                    maxWidthByVarName[column.cssVarName] = 0;
                    const hasItemText = hasRegularItemColumnText(column);
                    if (!hasItemText) {
                        return;
                    }
                    const elements = rowsForWidth
                        .map(function (row) { return row.querySelector(column.selector); })
                        .filter(Boolean);
                    const headerElement = currentDirRow ? currentDirRow.querySelector(column.selector) : null;
                    if (headerElement) {
                        elements.push(headerElement);
                    }
                    elements.forEach(function (element) {
                        const measuredWidth = measureElementTextWidth(element);
                        if (measuredWidth > maxWidthByVarName[column.cssVarName]) {
                            maxWidthByVarName[column.cssVarName] = measuredWidth;
                        }
                    });
                });

                measureWrap.remove();

                Object.keys(maxWidthByVarName).forEach(function (cssVarName) {
                    const measuredWidth = maxWidthByVarName[cssVarName];
                    listPane.style.setProperty(cssVarName, measuredWidth > 0 ? (String(measuredWidth) + "px") : "0px");
                });
            };

            const hasTruncatedNameRow = function () {
                const rows = listPane.querySelectorAll(".handrive-item-row");
                for (let index = 0; index < rows.length; index += 1) {
                    const row = rows[index];
                    if (!row || row.offsetParent === null) {
                        continue;
                    }
                    const nameWrap = row.querySelector(".handrive-item-name-wrap");
                    const name = row.querySelector(".handrive-item-name");
                    if (nameWrap && (nameWrap.scrollWidth - nameWrap.clientWidth) > 1) {
                        return true;
                    }
                    if (name && (name.scrollWidth - name.clientWidth) > 1) {
                        return true;
                    }
                }
                return false;
            };

            listPane.classList.remove.apply(listPane.classList, metaHideClasses);

            metaColumnMap.forEach(function (column) {
                if (!hasRegularItemColumnText(column)) {
                    listPane.classList.add(column.hideClass);
                }
            });

            syncSharedMetaColumnWidths();

            responsiveHideClasses.forEach(function (className) {
                if (hasTruncatedNameRow()) {
                    listPane.classList.add(className);
                }
            });

            scheduleSyncCurrentDirRowHeightWithSideHead();
            scheduleListBodyHeight();
        }

        let listColumnVisibilityRafId = null;
        let listColumnVisibilityTimeoutId = null;
        function scheduleListColumnVisibilityUpdate(options) {
            const settings = options || {};
            if (listColumnVisibilityRafId === null) {
                listColumnVisibilityRafId = window.requestAnimationFrame(function () {
                    listColumnVisibilityRafId = null;
                    updateListColumnVisibility();
                });
            }
            if (!settings.afterLayout) {
                return;
            }
            if (listColumnVisibilityTimeoutId !== null) {
                window.clearTimeout(listColumnVisibilityTimeoutId);
            }
            listColumnVisibilityTimeoutId = window.setTimeout(function () {
                listColumnVisibilityTimeoutId = null;
                updateListColumnVisibility();
            }, Number.isFinite(settings.delayMs) ? settings.delayMs : 180);
        }

        function scheduleListColumnVisibilityAfterTreeToggle() {
            scheduleListColumnVisibilityUpdate({
                afterLayout: true,
                delayMs: 220,
            });
        }

        // 디바운싱된 레이아웃 업데이트 함수
        let layoutUpdateTimeout = null;
        function debouncedUpdateListLayoutMode() {
            if (layoutUpdateTimeout) {
                clearTimeout(layoutUpdateTimeout);
            }
            layoutUpdateTimeout = setTimeout(updateListLayoutMode, 50);
        }

        function getFooterReservedHeight() {
            const footerLinks = document.querySelector(".site-footer-links");
            if (!footerLinks || footerLinks.offsetParent === null) {
                return 0;
            }
            const footerRect = footerLinks.getBoundingClientRect();
            const footerStyle = window.getComputedStyle(footerLinks);
            const marginTop = parseFloat(footerStyle.marginTop) || 0;
            const marginBottom = parseFloat(footerStyle.marginBottom) || 0;
            return Math.max(0, footerRect.height + marginTop + marginBottom);
        }

        function getListSideBodyHeight(headElement) {
            const contentEl = listLayout.closest(".handrive-content, .ui-content");
            if (!contentEl) {
                return 0;
            }
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
            const layoutRect = listLayout.getBoundingClientRect();
            const contentStyle = window.getComputedStyle(contentEl);
            const padBottom = parseFloat(contentStyle.paddingBottom) || 0;
            const layoutStyle = window.getComputedStyle(listLayout);
            const layoutBorderH = (parseFloat(layoutStyle.borderTopWidth) || 0) + (parseFloat(layoutStyle.borderBottomWidth) || 0);
            const headHeight = headElement ? headElement.getBoundingClientRect().height : 0;
            const footerReservedHeight = getFooterReservedHeight();
            const availableForBody = viewportHeight - footerReservedHeight - layoutRect.top - padBottom - layoutBorderH - headHeight;
            return Math.max(0, Math.floor(availableForBody));
        }

        // preview/editor body 높이를 실제 화면 배치 기준으로 맞춘다.
        // 가로모드에서는 footer가 viewport 안에 남을 공간을 먼저 예약한 뒤 본문 높이를 정한다.
        let previewBodyHeightRafId = null;
        function syncPreviewBodyHeight() {
            if (!previewPanel || !listLayout) {
                return;
            }
            const previewBody = previewPanel.querySelector(".handrive-list-preview-body");
            if (!previewBody) {
                return;
            }
            const isLandscape = listLayout.classList.contains("is-landscape");
            const hasPreview = listLayout.classList.contains("has-preview");
            if (!isLandscape || !hasPreview) {
                previewBody.style.height = "";
                previewBody.style.minHeight = "";
                previewBody.style.maxHeight = "";
                return;
            }
            const previewHead = previewPanel.querySelector(".handrive-list-preview-head");
            const height = getListSideBodyHeight(previewHead);
            previewBody.style.height = height + "px";
            previewBody.style.minHeight = height + "px";
            previewBody.style.maxHeight = height + "px";
        }

        let editorBodyHeightRafId = null;
        function syncEditorBodyHeight() {
            if (!editorPanel || !editorBody || !listLayout) {
                return;
            }
            const isLandscape = listLayout.classList.contains("is-landscape");
            const hasEditor = listLayout.classList.contains("has-editor");
            if (!isLandscape || !hasEditor || editorPanel.hidden) {
                editorBody.style.height = "";
                editorBody.style.minHeight = "";
                editorBody.style.maxHeight = "";
                return;
            }
            const height = getListSideBodyHeight(editorHead);
            editorBody.style.height = height + "px";
            editorBody.style.minHeight = height + "px";
            editorBody.style.maxHeight = height + "px";
        }

        let listBodyHeightRafId = null;
        function syncListBodyHeight() {
            if (!listContainer || !listLayout) {
                return;
            }
            const isLandscape = listLayout.classList.contains("is-landscape");
            if (!isLandscape) {
                listContainer.style.height = "";
                listContainer.style.minHeight = "";
                listContainer.style.maxHeight = "";
                return;
            }
            const height = getListSideBodyHeight(null);
            listContainer.style.height = height + "px";
            listContainer.style.minHeight = height + "px";
            listContainer.style.maxHeight = height + "px";
        }

        function scheduleListBodyHeight() {
            if (listBodyHeightRafId !== null) {
                return;
            }
            listBodyHeightRafId = window.requestAnimationFrame(function () {
                listBodyHeightRafId = null;
                syncListBodyHeight();
            });
        }

        function schedulePreviewBodyHeight() {
            if (previewBodyHeightRafId !== null) {
                return;
            }
            previewBodyHeightRafId = window.requestAnimationFrame(function () {
                previewBodyHeightRafId = null;
                syncPreviewBodyHeight();
            });
        }
        function scheduleEditorBodyHeight() {
            if (editorBodyHeightRafId !== null) {
                return;
            }
            editorBodyHeightRafId = window.requestAnimationFrame(function () {
                editorBodyHeightRafId = null;
                syncEditorBodyHeight();
            });
        }

        let currentDirRowSyncRafId = null;

        function scheduleSyncCurrentDirRowHeightWithSideHead() {
            if (currentDirRowSyncRafId !== null) {
                return;
            }
            currentDirRowSyncRafId = window.requestAnimationFrame(function () {
                currentDirRowSyncRafId = null;
                syncCurrentDirRowHeightWithSideHead();
                window.requestAnimationFrame(function () {
                    syncCurrentDirRowHeightWithSideHead();
                });
            });
        }

        function syncCurrentDirRowHeightWithSideHead() {
            if (!listContainer) {
                return;
            }
            const currentDirRow = listContainer.querySelector(".handrive-current-dir-row");
            if (!currentDirRow) {
                return;
            }
            const clearSideHeadHeight = function (headElement) {
                if (headElement) {
                    headElement.style.minHeight = "";
                }
            };
            const scheduleSideBodyHeights = function () {
                schedulePreviewBodyHeight();
                scheduleEditorBodyHeight();
            };

            const isLandscape = Boolean(listLayout && listLayout.classList.contains("is-landscape"));
            if (!isLandscape) {
                currentDirRow.style.minHeight = "";
                clearSideHeadHeight(previewHead);
                clearSideHeadHeight(editorHead);
                scheduleSideBodyHeights();
                return;
            }

            const hasVisibleEditor = Boolean(
                listLayout &&
                listLayout.classList.contains("has-editor") &&
                editorPanel &&
                !editorPanel.hidden &&
                editorHead
            );
            const hasVisiblePreview = Boolean(
                listLayout &&
                listLayout.classList.contains("has-preview") &&
                previewPanel &&
                !previewPanel.hidden &&
                previewHead
            );

            const activeHead = hasVisibleEditor ? editorHead : (hasVisiblePreview ? previewHead : null);
            if (!activeHead) {
                currentDirRow.style.minHeight = "";
                clearSideHeadHeight(previewHead);
                clearSideHeadHeight(editorHead);
                scheduleSideBodyHeights();
                return;
            }

            const previousRowMinHeight = currentDirRow.style.minHeight;
            const previousHeadMinHeight = activeHead.style.minHeight;

            currentDirRow.style.minHeight = "";
            activeHead.style.minHeight = "";
            if (activeHead !== previewHead) {
                clearSideHeadHeight(previewHead);
            }
            if (activeHead !== editorHead) {
                clearSideHeadHeight(editorHead);
            }

            const rowHeight = Math.ceil(currentDirRow.getBoundingClientRect().height);
            const headHeight = Math.ceil(activeHead.getBoundingClientRect().height);
            const syncedHeight = Math.max(rowHeight, headHeight);
            if (syncedHeight > 0) {
                const syncedHeightValue = String(syncedHeight) + "px";
                currentDirRow.style.minHeight = syncedHeightValue;
                activeHead.style.minHeight = syncedHeightValue;
                if (previousRowMinHeight !== syncedHeightValue || previousHeadMinHeight !== syncedHeightValue) {
                    scheduleSideBodyHeights();
                }
                return;
            }
            currentDirRow.style.minHeight = "";
            activeHead.style.minHeight = "";
            if (previousRowMinHeight || previousHeadMinHeight) {
                scheduleSideBodyHeights();
            }
        }

        function syncSearchFormVisibility() {
            if (!listSearchForm) return;
            const isLandscape = listLayout.classList.contains("is-landscape");
            const panelOpen = isLandscape && (
                (previewPanel && !previewPanel.hidden) ||
                (editorPanel && !editorPanel.hidden)
            );
            listSearchForm.classList.toggle("is-search-hidden", panelOpen);
            syncCurrentDirInlineSearchVisibility(panelOpen);
            const duration = 220;
            const startTime = performance.now();
            function tick() {
                syncListBodyHeight();
                syncPreviewBodyHeight();
                syncEditorBodyHeight();
                if (performance.now() - startTime < duration) {
                    window.requestAnimationFrame(tick);
                }
            }
            window.requestAnimationFrame(tick);
        }

        function setPreviewVisibility(isVisible) {
            previewSetVisibility(previewPanel, listLayout, isVisible, scheduleSyncCurrentDirRowHeightWithSideHead);
            if (isVisible) {
                schedulePreviewBodyHeight();
            }
            scheduleEditorBodyHeight();
            syncSearchFormVisibility();
        }

        function scrollPreviewIntoViewIfPortrait() {
            previewScrollIntoViewIfPortrait(previewPanel, previewHead);
        }

        function isPreviewableFileEntry(entry) {
            return Boolean(
                entry &&
                entry.type === "file" &&
                !entry.isCurrentFolder &&
                !entry.is_archive &&
                !entry.is_archive_member
            );
        }

        function isArchiveEntry(entry) {
            return Boolean(entry && entry.is_archive && entry.archive_virtual_path);
        }

        function isArchiveMemberEntry(entry) {
            return Boolean(entry && entry.is_archive_member);
        }

        function isArchiveVirtualPath(pathValue) {
            return normalizePath(pathValue || "", true).startsWith(".handrive-archive/");
        }

        function getEntryFileExtension(entry) {
            if (!entry || entry.type !== "file") {
                return "";
            }
            const fileName = String(entry.name || "");
            const dotIndex = fileName.lastIndexOf(".");
            if (dotIndex <= 0) {
                return "";
            }
            return fileName.slice(dotIndex).toLowerCase();
        }

        function isEditableHandriveFileEntry(entry) {
            return !nonEditableMediaExtensions.has(getEntryFileExtension(entry))
                || isImageEditorEntry(entry)
                || isVideoEditorEntry(entry)
                || isAudioEditorEntry(entry);
        }

        function isSortableListMetaKey(sortKey) {
            return ["modified", "type", "size", "permission", "commit", "id"].includes(String(sortKey || ""));
        }

        function getEntryNameSortValue(entry) {
            const rawName = entry && entry.name
                ? entry.name
                : String(entry && entry.path ? entry.path : "").split("/").pop();
            return String(rawName || "").trim().toLocaleLowerCase();
        }

        function resolveEntryTypeLabel(entry) {
            const safeEntry = entry || {};
            const explicitLabel = String(safeEntry.type_display || "").trim();
            if (explicitLabel) {
                return explicitLabel;
            }
            if (safeEntry.type === "dir") {
                if (safeEntry.git_repo) {
                    return t("repository_badge", "Repository");
                }
                if (safeEntry.git_branch_root) {
                    return t("branch_badge", "Branch");
                }
                if (safeEntry.is_map_folder) {
                    return t("list_type_map", textByLang("지도", "Map"));
                }
                return t("list_type_folder", textByLang("폴더", "Folder"));
            }
            if (safeEntry.is_archive) {
                return t("list_type_archive", textByLang("압축", "Archive"));
            }
            const extension = getEntryFileExtension(safeEntry) || getPathFileExtension(safeEntry.path || safeEntry.name || "");
            if (extension) {
                return extension.replace(/^\./, "").toUpperCase();
            }
            return t("list_type_file", textByLang("파일", "File"));
        }

        function formatMetaTextParts(parts) {
            return (Array.isArray(parts) ? parts : [])
                .map(function (part) {
                    return String(part || "").trim();
                })
                .filter(Boolean)
                .join(", ");
        }

        function resolveEntryPermissionMeta(entry) {
            const safeEntry = entry || {};
            const labels = Array.isArray(safeEntry.write_acl_labels) ? safeEntry.write_acl_labels.slice() : [];
            if (safeEntry.type === "file" && safeEntry.is_public_write) {
                labels.unshift(t("public_write_badge", textByLang("전체 허용", "Public Write")));
            }
            const visibleLabels = labels.slice(0, 3);
            const text = formatMetaTextParts(visibleLabels);
            if (!text) {
                return "";
            }
            return labels.length > visibleLabels.length ? text + ", +" + String(labels.length - visibleLabels.length) : text;
        }

        function resolveEntryCommitMeta(entry) {
            return String(entry && entry.git_commit_message || "").trim();
        }

        function resolveEntryIdMeta(entry) {
            const safeEntry = entry || {};
            const commitAuthor = String(safeEntry.git_commit_author_username || "").trim();
            if (commitAuthor) {
                return commitAuthor;
            }
            const repoMeta = safeEntry.git_repo || safeEntry.git_repo_meta || null;
            if (repoMeta && !repoMeta.is_owner) {
                return String(repoMeta.owner_username || "").trim();
            }
            return "";
        }

        function parseHandriveSizeDisplay(sizeDisplay) {
            const normalized = String(sizeDisplay || "").trim().replace(/,/g, "");
            if (!normalized) {
                return null;
            }
            const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)\s*(B|KB|MB|GB)$/i);
            if (!match) {
                return null;
            }
            const value = Number(match[1]);
            if (!Number.isFinite(value)) {
                return null;
            }
            const unit = match[2].toUpperCase();
            const multipliers = {
                B: 1,
                KB: 1024,
                MB: 1024 * 1024,
                GB: 1024 * 1024 * 1024,
            };
            return value * (multipliers[unit] || 1);
        }

        function getEntrySizeSortValue(entry) {
            if (!entry) {
                return null;
            }
            const rawSize = Number(entry.size_bytes);
            if (Number.isFinite(rawSize)) {
                return rawSize;
            }
            return parseHandriveSizeDisplay(entry.size_display);
        }

        function getEntryModifiedSortValue(entry) {
            const value = String(entry && (entry.modified_sort || entry.modified_display) || "").trim();
            return value || null;
        }

        function getEntrySortValue(entry, sortKey) {
            if (sortKey === "modified") {
                return getEntryModifiedSortValue(entry);
            }
            if (sortKey === "type") {
                return resolveEntryTypeLabel(entry).toLocaleLowerCase();
            }
            if (sortKey === "size") {
                return getEntrySizeSortValue(entry);
            }
            if (sortKey === "permission") {
                return resolveEntryPermissionMeta(entry).toLocaleLowerCase();
            }
            if (sortKey === "commit") {
                return resolveEntryCommitMeta(entry).toLocaleLowerCase();
            }
            if (sortKey === "id") {
                return resolveEntryIdMeta(entry).toLocaleLowerCase();
            }
            return getEntryNameSortValue(entry);
        }

        function isMissingSortValue(value) {
            return value === null || value === undefined || value === "";
        }

        function comparePresentSortValues(leftValue, rightValue) {
            if (typeof leftValue === "number" && typeof rightValue === "number") {
                return leftValue === rightValue ? 0 : (leftValue < rightValue ? -1 : 1);
            }
            return String(leftValue).localeCompare(String(rightValue), undefined, {
                numeric: true,
                sensitivity: "base",
            });
        }

        function compareEntriesByActiveSort(leftEntry, rightEntry) {
            const sortKey = state.listSortKey;
            if (!isSortableListMetaKey(sortKey)) {
                return 0;
            }
            const leftValue = getEntrySortValue(leftEntry, sortKey);
            const rightValue = getEntrySortValue(rightEntry, sortKey);
            const leftMissing = isMissingSortValue(leftValue);
            const rightMissing = isMissingSortValue(rightValue);
            if (leftMissing || rightMissing) {
                if (leftMissing && rightMissing) {
                    return getEntryNameSortValue(leftEntry).localeCompare(getEntryNameSortValue(rightEntry), undefined, {
                        numeric: true,
                        sensitivity: "base",
                    });
                }
                return leftMissing ? 1 : -1;
            }
            let result = comparePresentSortValues(leftValue, rightValue);
            if (result !== 0 && state.listSortDirection === "desc") {
                result = -result;
            }
            if (result !== 0) {
                return result;
            }
            return getEntryNameSortValue(leftEntry).localeCompare(getEntryNameSortValue(rightEntry), undefined, {
                numeric: true,
                sensitivity: "base",
            });
        }

        function getSortedEntriesForRender(entries) {
            const items = (Array.isArray(entries) ? entries : []).slice();
            if (!isSortableListMetaKey(state.listSortKey)) {
                return items;
            }
            items.sort(compareEntriesByActiveSort);
            return items;
        }

        function updateCurrentDirSortActiveState(row) {
            if (!row) {
                return;
            }
            const labels = row.querySelectorAll(".handrive-item-meta-label[data-sort-key]");
            labels.forEach(function (label) {
                const isActive = label.getAttribute("data-sort-key") === state.listSortKey;
                label.classList.toggle("is-sort-active", isActive);
                label.setAttribute("aria-sort", isActive && state.listSortDirection === "desc" ? "descending" : (isActive ? "ascending" : "none"));
            });
        }

        function applyListSort(sortKey) {
            if (!isSortableListMetaKey(sortKey)) {
                return;
            }
            if (state.listSortKey === sortKey) {
                state.listSortDirection = state.listSortDirection === "desc" ? "asc" : "desc";
            } else {
                state.listSortKey = sortKey;
                state.listSortDirection = "asc";
            }
            renderList({ skipPreview: true });
        }

        function bindCurrentDirSortControls(row) {
            if (!row) {
                return;
            }
            const metaTrail = row.querySelector(".handrive-item-meta-trail");
            if (!metaTrail) {
                return;
            }
            if (metaTrail.dataset.sortControlsBound !== "1") {
                metaTrail.dataset.sortControlsBound = "1";
                metaTrail.addEventListener("mousedown", function (event) {
                    const target = event.target instanceof Element
                        ? event.target.closest(".handrive-item-meta-label[data-sort-key]")
                        : null;
                    if (!target || !metaTrail.contains(target)) {
                        return;
                    }
                    event.preventDefault();
                });
                metaTrail.addEventListener("click", function (event) {
                    const target = event.target instanceof Element
                        ? event.target.closest(".handrive-item-meta-label[data-sort-key]")
                        : null;
                    if (!target || !metaTrail.contains(target)) {
                        return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    applyListSort(target.getAttribute("data-sort-key") || "");
                });
            }
            updateCurrentDirSortActiveState(row);
        }

        function applyRenderedContentModeClass(targetElement, renderMode, renderClass) {
            applyHandriveRenderedContentModeClass(targetElement, renderMode, renderClass);
        }

        function setPreviewActionTargets(entry) {
            previewSetActionTargets({
                entry: entry,
                previewRenderMode: state.activePreviewRenderMode || "",
                previewDownloadButton: previewDownloadButton,
                previewEditButton: previewEditButton,
                previewDeleteButton: previewDeleteButton,
                previewUrlShareButton: previewUrlShareButton,
                urlShareApiUrl: urlShareApiUrl,
                isPreviewableFileEntry: isPreviewableFileEntry,
                isEditableHandriveFileEntry: isEditableHandriveFileEntry,
                buildDownloadUrl: buildDownloadUrl,
                onEdit: switchToEditor,
            });
        }

        function setPreviewPlaceholder(message) {
            previewSetPlaceholder(previewContent, escapeHtml, message);
        }

        function setPreviewLoading() {
            if (!previewContent) {
                return;
            }
            applyRenderedContentModeClass(previewContent, "plain_text", "handrive-plain-text");
            previewContent.innerHTML = '<div class="handrive-list-preview-loading" role="status" aria-label="' +
                escapeHtml(t("list_preview_loading", "미리보기를 불러오는 중...")) +
                '"><span class="handrive-list-preview-loading-spinner" aria-hidden="true"></span></div>';
        }

        function updateEditorHighlight() {
            if (!editorContentInput || !editorHighlightCode) {
                return;
            }
            
            const content = editorContentInput.value;
            const escapedContent = escapeHtml(content);
            editorHighlightCode.textContent = content;
        }

        function switchToEditor(entry) {
            if (!editorPanel || !editorFilenameInput) {
                return;
            }
            stopPreviewMediaElements(previewContent);

            if (isImageEditorEntry(entry)) {
                switchToImageEditor(entry);
                return;
            }
            if (isVideoEditorEntry(entry)) {
                switchToVideoEditor(entry);
                return;
            }
            if (isAudioEditorEntry(entry)) {
                switchToAudioEditor(entry);
                return;
            }

            if (!editorContentInput) return;

            activeListEditorEntry = entry || null;
            listMarkdownUploadedImagePaths = [];
            clearListEditorSuggestion();
            editorSwitchToEditorUI({
                entry: entry,
                editorPanel: editorPanel,
                editorFilenameInput: editorFilenameInput,
                editorContentInput: editorContentInput,
                previewPanel: previewPanel,
                listLayout: listLayout,
                renderHighlight: renderListEditorHighlight,
                onAfterChange: function () {
                    setPreviewVisibility(false);
                    scheduleSyncCurrentDirRowHeightWithSideHead();
                    scheduleEditorBodyHeight();
                    syncSearchFormVisibility();
                },
                loadContent: function (targetEntry) {
                    const targetUrl = buildDownloadUrl(targetEntry.path);
                    if (!targetUrl) {
                        console.error('Error loading file content: download API URL is missing');
                        return Promise.resolve('');
                    }
                    return fetch(targetUrl)
                        .then(function (response) {
                            if (!response.ok) {
                                throw new Error('Download API request failed: ' + String(response.status));
                            }
                            return response.text();
                        });
                },
            });
            setupEditorEvents(entry);
        }

        function switchToImageEditor(entry) {
            activeListEditorEntry = entry || null;
            stopPreviewMediaElements(previewContent);

            // 텍스트 surface 숨김, 이미지 surface 표시
            if (editorSurface) editorSurface.hidden = true;
            if (videoEditorSurface) videoEditorSurface.hidden = true;
            if (audioEditorSurface) audioEditorSurface.hidden = true;
            if (imageEditorSurface) imageEditorSurface.hidden = false;

            // 파일명 입력창 설정
            if (editorFilenameInput) editorFilenameInput.value = entry.name || "";

            // 패널 열기 (has-editor 클래스 추가)
            if (previewPanel) {
                previewPanel.hidden = true;
                previewPanel.setAttribute("aria-hidden", "true");
            }
            if (editorPanel) {
                editorPanel.hidden = false;
                editorPanel.setAttribute("aria-hidden", "false");
            }
            if (listLayout) {
                listLayout.classList.remove("has-preview");
                listLayout.classList.add("has-editor");
            }
            scheduleSyncCurrentDirRowHeightWithSideHead();
            syncSearchFormVisibility();

            // ImageEditor 초기화
            const imageServeUrl = buildDownloadUrl(entry.path);
            if (window.HandriveImageEditor) {
                window.HandriveImageEditor.init({
                    entry: entry,
                    imageServeUrl: imageServeUrl,
                    backgroundRemoveUrl: imageEditorRemoveBackgroundUrl,
                    onDirtyChange: function (dirty) {
                        if (editorSaveButton) {
                            editorSaveButton.classList.toggle("is-dirty", dirty);
                        }
                    },
                });
            }

            setupEditorEvents(entry);
        }

        function switchToVideoEditor(entry) {
            activeListEditorEntry = entry || null;
            stopPreviewMediaElements(previewContent);

            if (editorSurface) editorSurface.hidden = true;
            if (imageEditorSurface) imageEditorSurface.hidden = true;
            if (audioEditorSurface) audioEditorSurface.hidden = true;
            if (videoEditorSurface) videoEditorSurface.hidden = false;

            if (editorFilenameInput) editorFilenameInput.value = entry.name || "";

            if (previewPanel) {
                previewPanel.hidden = true;
                previewPanel.setAttribute("aria-hidden", "true");
            }
            if (editorPanel) {
                editorPanel.hidden = false;
                editorPanel.setAttribute("aria-hidden", "false");
            }
            if (listLayout) {
                listLayout.classList.remove("has-preview");
                listLayout.classList.add("has-editor");
            }
            scheduleSyncCurrentDirRowHeightWithSideHead();
            syncSearchFormVisibility();

            const videoServeUrl = buildDownloadUrl(entry.path);
            if (window.HandriveVideoEditor) {
                window.HandriveVideoEditor.init({
                    entry: entry,
                    videoServeUrl: videoServeUrl,
                    buildDownloadUrl: buildScopedHomeDownloadUrl,
                    listApiUrl: appendQueryParam(appendSharedQuery(listApiUrl), "scope_home", "1"),
                    scopedHomeDir: scopedHomeDir,
                    onDirtyChange: function (dirty) {
                        if (editorSaveButton) {
                            editorSaveButton.classList.toggle("is-dirty", dirty);
                        }
                    },
                });
            }

            setupEditorEvents(entry);
        }

        function switchToAudioEditor(entry) {
            activeListEditorEntry = entry || null;
            stopPreviewMediaElements(previewContent);

            if (editorSurface) editorSurface.hidden = true;
            if (imageEditorSurface) imageEditorSurface.hidden = true;
            if (videoEditorSurface) videoEditorSurface.hidden = true;
            if (audioEditorSurface) audioEditorSurface.hidden = false;

            if (editorFilenameInput) editorFilenameInput.value = entry.name || "";

            if (previewPanel) {
                previewPanel.hidden = true;
                previewPanel.setAttribute("aria-hidden", "true");
            }
            if (editorPanel) {
                editorPanel.hidden = false;
                editorPanel.setAttribute("aria-hidden", "false");
            }
            if (listLayout) {
                listLayout.classList.remove("has-preview");
                listLayout.classList.add("has-editor");
            }
            scheduleSyncCurrentDirRowHeightWithSideHead();
            syncSearchFormVisibility();

            const audioServeUrl = buildDownloadUrl(entry.path);
            if (window.HandriveAudioEditor) {
                window.HandriveAudioEditor.init({
                    entry: entry,
                    audioServeUrl: audioServeUrl,
                    listApiUrl: appendQueryParam(appendSharedQuery(listApiUrl), "scope_home", "1"),
                    buildDownloadUrl: buildScopedHomeDownloadUrl,
                    scopedHomeDir: scopedHomeDir,
                    onDirtyChange: function (dirty) {
                        if (editorSaveButton) {
                            editorSaveButton.classList.toggle("is-dirty", dirty);
                        }
                    },
                });
            }

            setupEditorEvents(entry);
        }

        function switchToPreview() {
            // 이미지 에디터 정리
            if (imageEditorSurface && !imageEditorSurface.hidden) {
                if (window.HandriveImageEditor) window.HandriveImageEditor.destroy();
                imageEditorSurface.hidden = true;
                if (editorSurface) editorSurface.hidden = false;
            }
            if (videoEditorSurface && !videoEditorSurface.hidden) {
                if (window.HandriveVideoEditor) window.HandriveVideoEditor.destroy();
                videoEditorSurface.hidden = true;
                if (editorSurface) editorSurface.hidden = false;
            }
            if (audioEditorSurface && !audioEditorSurface.hidden) {
                if (window.HandriveAudioEditor) window.HandriveAudioEditor.destroy();
                audioEditorSurface.hidden = true;
                if (editorSurface) editorSurface.hidden = false;
            }

            editorSwitchToPreviewUI({
                editorPanel: editorPanel,
                previewPanel: previewPanel,
                listLayout: listLayout,
                onAfterChange: function () {
                    scheduleSyncCurrentDirRowHeightWithSideHead();
                    schedulePreviewBodyHeight();
                    scheduleEditorBodyHeight();
                    syncSearchFormVisibility();
                },
            });
            cleanupEditorEvents();
            activeListEditorEntry = null;
        }

        function setupEditorEvents(entry) {
            if (!editorSaveButton || !editorCancelButton) {
                return;
            }
            
            // 기존 이벤트 정리
            cleanupEditorEvents();
            
            if (editorContentInput) {
                if (!listMarkdownImageEventsBound) {
                    listMarkdownImageEventsBound = true;
                    editorContentInput.addEventListener("paste", function (event) {
                        listMarkdownImageInput.handlePaste(event);
                    });
                    editorContentInput.addEventListener("dragover", function (event) {
                        listMarkdownImageInput.handleDragOver(event);
                    });
                    editorContentInput.addEventListener("drop", function (event) {
                        listMarkdownImageInput.handleDrop(event);
                    });
                }
                editorContentInput.addEventListener("input", function () {
                    renderListEditorHighlight();
                    updateListEditorSuggestion();
                });
                editorContentInput.addEventListener("scroll", syncListEditorHighlightScroll, { passive: true });
                let listEditorFontSize = 16;
                editorContentInput.addEventListener("wheel", function (event) {
                    if (!event.ctrlKey && !event.metaKey) return;
                    event.preventDefault();
                    const delta = event.deltaY < 0 ? 2 : -2;
                    listEditorFontSize = Math.max(8, Math.min(40, listEditorFontSize + delta));
                    editorContentInput.style.fontSize = listEditorFontSize + "px";
                    if (editorHighlight) {
                        editorHighlight.style.fontSize = listEditorFontSize + "px";
                    }
                    syncListEditorHighlightScroll();
                }, { passive: false });
                editorContentInput.addEventListener("click", function () {
                    clearListEditorSuggestion();
                });
                editorContentInput.addEventListener("keydown", function (event) {
                    if ((event.metaKey || event.ctrlKey) && !event.altKey && String(event.key || "").toLowerCase() === "s") {
                        event.preventDefault();
                        if (editorSaveButton && !editorSaveButton.disabled) {
                            editorSaveButton.click();
                        }
                        return;
                    }
                    if (event.key === "Escape") {
                        clearListEditorSuggestion();
                        return;
                    }
                    if (!editorSuggest.hidden && event.key === "ArrowDown") {
                        event.preventDefault();
                        moveListEditorSuggestion(1);
                        return;
                    }
                    if (!editorSuggest.hidden && event.key === "ArrowUp") {
                        event.preventDefault();
                        moveListEditorSuggestion(-1);
                        return;
                    }
                    if (!editorSuggest.hidden && event.key === "Enter") {
                        if (acceptListEditorSuggestion()) {
                            event.preventDefault();
                        }
                        return;
                    }
                    if (event.key === "Tab" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
                        if (acceptListEditorSuggestion()) {
                            event.preventDefault();
                        }
                        return;
                    }
                    if (
                        event.key === "ArrowLeft" ||
                        event.key === "ArrowRight" ||
                        event.key === "Home" ||
                        event.key === "End" ||
                        event.key === "PageUp" ||
                        event.key === "PageDown"
                    ) {
                        clearListEditorSuggestion();
                    }
                });
            }

            if (editorFilenameInput) {
                editorFilenameInput.addEventListener("input", function () {
                    renderListEditorHighlight();
                });
            }
            if (editorSuggest && !listSuggestEventsBound) {
                listSuggestEventsBound = true;
                editorSuggest.addEventListener("mousedown", function (event) {
                    event.preventDefault();
                });
                editorSuggest.addEventListener("click", function (event) {
                    const target = event.target instanceof Element
                        ? event.target.closest("[data-suggest-index]")
                        : null;
                    if (!target) {
                        return;
                    }
                    const index = Number(target.getAttribute("data-suggest-index"));
                    if (Number.isInteger(index) && acceptListEditorSuggestion(index)) {
                        event.preventDefault();
                    }
                });
            }
            
            function handleMediaEditorSaved(result, options) {
                const settings = options || {};
                const savedPath = result && typeof result.path === "string" && result.path.trim()
                    ? normalizePath(result.path, true)
                    : "";
                const targetPath = savedPath || normalizePath(entry.path || "", true);
                if (state.previewCache) {
                    state.previewCache.delete(entry.path);
                    if (savedPath) {
                        state.previewCache.delete(savedPath);
                    }
                }
                refreshCurrentDirectory({ skipPreview: true })
                    .then(async function () {
                        const savedEntryFromList = state.entryByPath.get(targetPath) || null;
                        const savedEntry = savedEntryFromList || {
                            type: "file",
                            isCurrentFolder: false,
                            can_edit: Boolean(entry && entry.can_edit),
                            path: targetPath,
                            slug_path: targetPath,
                            name: targetPath.split("/").pop() || (entry && entry.name) || "",
                        };

                        if (settings.openPreview) {
                            switchToPreview();
                            if (savedEntryFromList) {
                                applySelection([targetPath], {
                                    primaryPath: targetPath,
                                    anchorPath: targetPath,
                                    skipPreview: true,
                                });
                            } else {
                                setPreviewVisibility(true);
                            }
                            await loadPreviewForEntry(savedEntry);
                            await updatePreviewNavButtons(savedEntry);
                            return;
                        }

                        if (savedPath && state.entryByPath.has(savedPath)) {
                            applySelection([targetPath], {
                                primaryPath: targetPath,
                                anchorPath: targetPath,
                                render: false,
                            });
                        }
                    })
                    .catch(alertError);
            }

            // 저장/취소 버튼 이벤트를 현재 편집 대상(entry)에 바인딩
            editorSaveButton.onclick = function (event) {
                event.preventDefault();
                // 이미지 에디터 모드 분기
                if (imageEditorSurface && !imageEditorSurface.hidden && window.HandriveImageEditor) {
                    const csrfToken = getCsrfToken();
                    const savingText = t("image_editor_saving", "저장 중...");
                    const origText = editorSaveButton.textContent;
                    const imageFilename = String(editorFilenameInput ? editorFilenameInput.value || "" : "").trim();
                    if (!imageFilename) {
                        alertError(new Error(t("js_filename_required", "파일명을 입력해주세요.")));
                        return;
                    }
                    if (
                        typeof window.HandriveImageEditor.getIsDirty === "function" &&
                        !window.HandriveImageEditor.getIsDirty() &&
                        imageFilename !== String(entry.name || "")
                    ) {
                        editorSaveButton.disabled = true;
                        editorSaveButton.textContent = savingText;
                        (async function () {
                            let commitMessage = "";
                            if (entry.requires_commit_message) {
                                commitMessage = await promptCommitMessage(entry.path);
                                if (commitMessage === null) {
                                    return null;
                                }
                            }
                            return requestJson(renameApiUrl, buildPostOptions({
                                path: entry.path,
                                new_name: imageFilename,
                                commit_message: commitMessage,
                            }));
                        })()
                            .then(function (result) {
                                if (result) {
                                    handleMediaEditorSaved(result, { openPreview: true });
                                }
                            })
                            .catch(alertError)
                            .finally(function () {
                                editorSaveButton.disabled = false;
                                editorSaveButton.textContent = origText;
                            });
                        return;
                    }
                    editorSaveButton.disabled = true;
                    editorSaveButton.textContent = savingText;
                    window.HandriveImageEditor.saveToServer(
                        imageEditorSaveUrl,
                        csrfToken,
                        entry.path,
                        function (result) {
                            editorSaveButton.disabled = false;
                            editorSaveButton.textContent = origText;
                            if (result.ok) {
                                handleMediaEditorSaved(result, { openPreview: true });
                            } else {
                                alertError(new Error(result.error || t("image_editor_save_error", "저장 실패")));
                            }
                        },
                        { filename: imageFilename }
                    );
                    return;
                }
                if (videoEditorSurface && !videoEditorSurface.hidden && window.HandriveVideoEditor) {
                    const csrfToken = getCsrfToken();
                    const savingText = t("video_editor_saving", "저장 중...");
                    const origText = editorSaveButton.textContent;
                    editorSaveButton.disabled = true;
                    editorSaveButton.textContent = savingText;
                    window.HandriveVideoEditor.saveToServer(
                        videoEditorSaveUrl,
                        csrfToken,
                        entry.path,
                        function (result) {
                            editorSaveButton.disabled = false;
                            editorSaveButton.textContent = origText;
                            if (result && result.ok) {
                                handleMediaEditorSaved(result);
                            } else {
                                alertError(new Error((result && result.error) || t("video_editor_save_error", "비디오 저장 실패")));
                            }
                        }
                    );
                    return;
                }
                if (audioEditorSurface && !audioEditorSurface.hidden && window.HandriveAudioEditor) {
                    const csrfToken = getCsrfToken();
                    const savingText = t("audio_editor_saving", "저장 중...");
                    const origText = editorSaveButton.textContent;
                    editorSaveButton.disabled = true;
                    editorSaveButton.textContent = savingText;
                    window.HandriveAudioEditor.saveToServer(
                        audioEditorSaveUrl,
                        csrfToken,
                        entry.path,
                        function (result) {
                            editorSaveButton.disabled = false;
                            editorSaveButton.textContent = origText;
                            if (result && result.ok) {
                                handleMediaEditorSaved(result);
                            } else {
                                alertError(new Error((result && result.error) || t("audio_editor_save_error", "오디오 저장 실패")));
                            }
                        }
                    );
                    return;
                }
                saveEditorContent(entry).catch(alertError);
            };
            editorCancelButton.onclick = function (event) {
                event.preventDefault();
                if (imageEditorSurface && !imageEditorSurface.hidden && window.HandriveImageEditor) {
                    if (window.HandriveImageEditor.getIsDirty()) {
                        if (!window.confirm(t("image_editor_unsaved_warning", "저장되지 않은 변경 사항이 있습니다. 계속하시겠습니까?"))) {
                            return;
                        }
                    }
                }
                if (videoEditorSurface && !videoEditorSurface.hidden && window.HandriveVideoEditor) {
                    if (window.HandriveVideoEditor.getIsDirty()) {
                        if (!window.confirm(t("image_editor_unsaved_warning", "저장되지 않은 변경 사항이 있습니다. 계속하시겠습니까?"))) {
                            return;
                        }
                    }
                }
                if (audioEditorSurface && !audioEditorSurface.hidden && window.HandriveAudioEditor) {
                    if (window.HandriveAudioEditor.getIsDirty()) {
                        if (!window.confirm(t("image_editor_unsaved_warning", "저장되지 않은 변경 사항이 있습니다. 계속하시겠습니까?"))) {
                            return;
                        }
                    }
                }
                cleanupListMarkdownUploadedImages(entry)
                    .catch(alertError)
                    .finally(function () {
                        switchToPreview();
                    });
            };
        }

        function cleanupEditorEvents() {
            clearListEditorSuggestion();
            if (editorSaveButton) {
                editorSaveButton.onclick = null;
            }
            if (editorCancelButton) {
                editorCancelButton.onclick = null;
            }
        }

        // 입력된 파일명(확장자 포함 가능)을 API 저장 형식(filename + extension)으로 분리
        function resolveListEditorFilenameAndExtension(rawFilename, sourcePath) {
            return editorResolveFilenameAndExtension(rawFilename, sourcePath, t);
        }

        async function saveEditorContent(entry) {
            if (!editorContentInput || !editorFilenameInput) {
                return;
            }

            if (!saveApiUrl) {
                throw new Error(t("js_error_request_failed", "요청 처리 중 오류가 발생했습니다."));
            }

            const content = editorContentInput.value;
            const resolved = resolveListEditorFilenameAndExtension(editorFilenameInput.value, entry.path);
            const sourcePath = normalizePath(entry.path, false);
            const targetDir = getParentDirectory(sourcePath);

            // 중복 저장 방지를 위해 저장 중 버튼 비활성화
            if (editorSaveButton) {
                editorSaveButton.disabled = true;
            }
            try {
                // 쓰기 화면 저장 버튼과 동일한 handrive_api_save payload로 저장
                const payload = {
                    original_path: sourcePath,
                    target_dir: targetDir,
                    filename: resolved.filename,
                    extension: resolved.extension,
                    content: content,
                };
                if (entry && entry.requires_commit_message) {
                    const commitMessage = await promptCommitMessage(sourcePath);
                    if (commitMessage === null) {
                        return;
                    }
                    payload.commit_message = commitMessage;
                }
                const data = await requestJson(saveApiUrl, buildPostOptions(payload));
                listMarkdownUploadedImagePaths = [];

                // 저장 후에는 취소 버튼 동작처럼 편집기를 닫고, 해당 파일 미리보기를 다시 연다.
                const savedPath = data && typeof data.path === "string" && data.path.trim()
                    ? normalizePath(data.path, true)
                    : sourcePath;
                // 저장 직후에는 캐시를 무효화해 미리보기가 항상 최신 내용을 다시 불러오도록 한다.
                state.previewCache.delete(sourcePath);
                state.previewCache.delete(savedPath);
                await refreshCurrentDirectory({ skipPreview: true });
                switchToPreview();

                const savedEntryFromList = state.entryByPath.get(savedPath) || null;
                const savedEntry = savedEntryFromList || {
                    type: "file",
                    isCurrentFolder: false,
                    can_edit: Boolean(entry && entry.can_edit),
                    path: savedPath,
                    name: savedPath.split("/").pop() || (entry && entry.name) || "",
                };

                if (savedEntryFromList) {
                    applySelection([savedPath], {
                        primaryPath: savedPath,
                        anchorPath: savedPath,
                    });
                } else {
                    setPreviewVisibility(true);
                }

                await loadPreviewForEntry(savedEntry);
                await updatePreviewNavButtons(savedEntry);
            } finally {
                if (editorSaveButton) {
                    editorSaveButton.disabled = false;
                }
            }
        }

        async function cleanupListMarkdownUploadedImages(entry) {
            if (!markdownImageCleanupApiUrl || !listMarkdownUploadedImagePaths.length) {
                return;
            }
            const sourcePath = entry && entry.path ? normalizePath(entry.path, true) : "";
            const targetDir = getParentPath(sourcePath) || state.currentDir || "";
            const imagePaths = Array.from(new Set(listMarkdownUploadedImagePaths));
            listMarkdownUploadedImagePaths = [];
            await requestJson(
                markdownImageCleanupApiUrl,
                buildPostOptions({
                    markdown_path: sourcePath,
                    target_dir: targetDir,
                    image_paths: imagePaths,
                })
            );
        }

        async function updatePreviewNavButtons(entry) {
            if (!previewNavPrevBtn || !previewNavNextBtn) return;
            if (!entry || !isMediaNavEntry(entry)) {
                previewNavPrevBtn.hidden = true;
                previewNavNextBtn.hidden = true;
                if (previewNavBgPrev) previewNavBgPrev.hidden = true;
                if (previewNavBgNext) previewNavBgNext.hidden = true;
                setPreviewNavBackgroundVisible(false);
                previewNavPrevBtn._navTarget = null;
                previewNavNextBtn._navTarget = null;
                return;
            }
            const siblingDir = getParentPath(entry.path) || state.currentDir;
            const normalizedSiblingDir = normalizePath(siblingDir, true);
            let siblings = getVisibleSiblingMediaEntries(normalizedSiblingDir);
            if (!siblings.length && normalizedSiblingDir && normalizedSiblingDir !== state.currentDir) {
                try {
                    await loadDirectory(normalizedSiblingDir);
                    siblings = getVisibleSiblingMediaEntries(normalizedSiblingDir);
                } catch (error) {}
            }
            if (!siblings.length) {
                previewNavPrevBtn.hidden = true;
                previewNavNextBtn.hidden = true;
                if (previewNavBgPrev) previewNavBgPrev.hidden = true;
                if (previewNavBgNext) previewNavBgNext.hidden = true;
                setPreviewNavBackgroundVisible(false);
                previewNavPrevBtn._navTarget = null;
                previewNavNextBtn._navTarget = null;
                return;
            }
            const currentPath = normalizePath(entry.path, true);
            const idx = siblings.findIndex(function (e) {
                return normalizePath(e.path, true) === currentPath;
            });
            const prevEntry = idx > 0 ? siblings[idx - 1] : null;
            const nextEntry = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
            previewNavPrevBtn.hidden = !prevEntry;
            previewNavNextBtn.hidden = !nextEntry;
            if (previewNavBgPrev) previewNavBgPrev.hidden = !prevEntry;
            if (previewNavBgNext) previewNavBgNext.hidden = !nextEntry;
            previewNavPrevBtn._navTarget = prevEntry;
            previewNavNextBtn._navTarget = nextEntry;
            setPreviewNavBackgroundVisible(Boolean(prevEntry || nextEntry));
            if (prevEntry) {
                previewNavPrevBtn.classList.remove("is-revealing");
                void previewNavPrevBtn.offsetWidth;
                previewNavPrevBtn.classList.add("is-revealing");
                window.setTimeout(function () {
                    previewNavPrevBtn.classList.remove("is-revealing");
                }, 180);
            }
            if (nextEntry) {
                previewNavNextBtn.classList.remove("is-revealing");
                void previewNavNextBtn.offsetWidth;
                previewNavNextBtn.classList.add("is-revealing");
                window.setTimeout(function () {
                    previewNavNextBtn.classList.remove("is-revealing");
                }, 180);
            }
        }

        function navigateToPreviewEntry(entry) {
            if (!entry) return;
            state.selectedPaths = new Set([entry.path]);
            state.selectedPath = entry.path;
            state.activePreviewPath = normalizePath(entry.path, true);
            renderList({ skipPreview: true });
            loadPreviewForEntry(entry)
                .then(function () { return updatePreviewNavButtons(entry); })
                .catch(alertError);
        }

        function setPreviewNavBackgroundVisible(visible) {
            if (!previewNavBg) return;
            previewNavBg.hidden = !visible;
            previewNavBg.classList.toggle("is-visible", Boolean(visible));
        }

        if (previewNavPrevBtn) {
            previewNavPrevBtn.addEventListener("click", function () {
                navigateToPreviewEntry(previewNavPrevBtn._navTarget);
            });
        }
        if (previewNavNextBtn) {
            previewNavNextBtn.addEventListener("click", function () {
                navigateToPreviewEntry(previewNavNextBtn._navTarget);
            });
        }

        function clearPreviewPane() {
            state.activePreviewPath = "";
            state.activeRenderedPreviewPath = "";
            state.activePreviewRenderMode = "";
            state.previewRequestToken += 1;
            state.previewImageZoom = 1;
            setPreviewVisibility(false);
            if (previewNavBgPrev) previewNavBgPrev.hidden = true;
            if (previewNavBgNext) previewNavBgNext.hidden = true;
            setPreviewNavBackgroundVisible(false);
            
            // 편집기가 열려있으면 닫기
            if (editorPanel && !editorPanel.hidden) {
                switchToPreview();
            }
            
            if (previewTitle) {
                const previewTitleText = previewTitle.querySelector(".handrive-list-preview-title-text") || previewTitle;
                previewTitleText.textContent = t("list_preview_title", "파일 미리보기");
            }
            setPreviewActionTargets(null);
            applyRenderedContentModeClass(previewContent, "plain_text", "handrive-plain-text");
            setPreviewPlaceholder(
                t("list_preview_empty", "파일을 선택하면 미리보기가 표시됩니다.")
            );
            syncPreviewImageZoom();
            void updatePreviewNavButtons(null);
        }

        function getPreviewImageMinZoom() {
            return previewGetImageMinZoom(previewContent);
        }

        function syncPreviewImageZoom() {
            previewSyncImageZoom(previewContent, previewZoomWrap, state.previewImageZoom);
        }

        function setPreviewImageZoom(nextZoom) {
            const minZoom = getPreviewImageMinZoom();
            state.previewImageZoom = Math.max(minZoom, Math.min(3, Number(nextZoom) || 1));
            syncPreviewImageZoom();
        }

        function renderPreviewHtml(entry, html, renderMode, renderClass) {
            renderPreviewHtmlFlow({
                applyHandriveCodeHighlighting: applyHandriveCodeHighlighting,
                applyRenderedContentModeClass: applyRenderedContentModeClass,
                entry: entry,
                html: html,
                hydrateMediaAudioElements: hydrateMediaAudioElements,
                previewContent: previewContent,
                previewGetImageElement: previewGetImageElement,
                previewZoomWrap: previewZoomWrap,
                renderClass: renderClass,
                renderMode: renderMode,
                scheduleSyncCurrentDirRowHeightWithSideHead: scheduleSyncCurrentDirRowHeightWithSideHead,
                setPreviewActionTargets: setPreviewActionTargets,
                setPreviewPlaceholder: setPreviewPlaceholder,
                state: state,
                syncPreviewImageZoom: syncPreviewImageZoom,
                t: t,
            });
        }

        async function loadPreviewForEntry(entry) {
            await loadPreviewEntryFlow({
                buildPostOptions: buildPostOptions,
                clearPreviewPane: clearPreviewPane,
                editorPanel: editorPanel,
                entry: entry,
                isPreviewableFileEntry: isPreviewableFileEntry,
                normalizePath: normalizePath,
                previewApiUrl: appendSharedQuery(previewApiUrl),
                previewContent: previewContent,
                previewPanel: previewPanel,
                previewTitle: previewTitle,
                renderPreviewHtml: renderPreviewHtml,
                requestJson: requestJson,
                scrollPreviewIntoViewIfPortrait: scrollPreviewIntoViewIfPortrait,
                setPreviewActionTargets: setPreviewActionTargets,
                setPreviewLoading: setPreviewLoading,
                setPreviewPlaceholder: setPreviewPlaceholder,
                setPreviewVisibility: setPreviewVisibility,
                state: state,
                switchToPreview: switchToPreview,
                t: t,
            });
        }

        function syncPreviewFromSelection() {
            if (!previewPanel) {
                return;
            }
            const selectedEntries = getSelectedEntries();
            if (selectedEntries.length !== 1) {
                clearPreviewPane();
                return;
            }
            const entry = selectedEntries[0];
            if (!isPreviewableFileEntry(entry)) {
                // 폴더 등 미리보기 불가 항목 선택 시 현재 미리보기 유지
                return;
            }
            const entryPath = normalizePath(entry.path, true);
            if (entryPath === state.activePreviewPath) {
                // 현재 미리보기 중인 파일을 다시 선택하면 토글(닫기)
                clearPreviewPane();
                return;
            }
            // 새 파일로 전환 시 activePreviewPath를 먼저 업데이트하고 재렌더해서
            // 이전 파일의 선택 효과가 남지 않도록 함
            state.activePreviewPath = entryPath;
            renderList({ skipPreview: true });
            loadPreviewForEntry(entry)
                .then(function () { return updatePreviewNavButtons(entry); })
                .catch(alertError);
        }

        function syncContextMenuByEntries(entries) {
            const visibility = computeContextMenuVisibility(entries, {
                isEntryDeletable: isEntryDeletable,
                isEditableHandriveFileEntry: isEditableHandriveFileEntry,
            });
            setContextButtonVisible(contextOpenButton, Boolean(visibility.open));
            setContextButtonVisible(contextDownloadButton, Boolean(visibility.download));
            setContextButtonVisible(contextExtractArchiveButton, Boolean(visibility.extractArchive && archiveExtractApiUrl));
            setContextButtonVisible(contextShareButton, Boolean(visibility.share && urlShareApiUrl));
            setContextButtonVisible(contextUploadButton, Boolean(visibility.upload));
            setContextButtonVisible(contextCreateArchiveButton, Boolean(visibility.createArchive && archiveCreateApiUrl));
            setContextButtonVisible(contextEditButton, Boolean(visibility.edit));
            setContextButtonVisible(contextRenameButton, Boolean(visibility.rename));
            setContextButtonVisible(contextDeleteButton, Boolean(visibility.deleteEntry));
            setContextButtonVisible(contextNewFolderButton, Boolean(visibility.newFolder));
            setContextButtonVisible(contextNewDocButton, Boolean(visibility.newDoc));
            setContextButtonVisible(contextPermissionsButton, Boolean(visibility.permissions));
            setContextButtonVisible(contextGitCreateRepoButton, Boolean(visibility.gitCreateRepo));
            setContextButtonVisible(contextGitManageRepoButton, Boolean(visibility.gitManageRepo));
            setContextButtonVisible(contextGitDeleteRepoButton, Boolean(visibility.gitDeleteRepo));
            setContextButtonVisible(contextGitCreateBranchButton, Boolean(visibility.gitCreateBranch));
            setContextButtonVisible(contextGitDeleteBranchButton, Boolean(visibility.gitDeleteBranch));
            setContextButtonVisible(contextCreateMapButton, Boolean(visibility.createMap));
            setContextButtonVisible(contextConvertMp3Button, Boolean(visibility.convertMp3 && convertMp3ApiUrl));
            setContextButtonVisible(contextChangeIconButton, Boolean(visibility.changeIcon && folderIconUploadApiUrl));
            syncContextMenuDividers(contextMenu);
        }

        function resolveContextEntries(entry) {
            if (!entry) {
                return [];
            }
            if (state.selectedPaths.size > 1 && state.selectedPaths.has(entry.path)) {
                return getSelectedEntries();
            }
            return [entry];
        }

        function applySelection(pathValues, options) {
            const settings = options || {};
            const nextSelectedPaths = new Set();
            (Array.isArray(pathValues) ? pathValues : []).forEach(function (pathValue) {
                try {
                    nextSelectedPaths.add(normalizePath(pathValue, true));
                } catch (error) {}
            });

            state.selectedPaths = nextSelectedPaths;
            if (nextSelectedPaths.size === 0) {
                state.selectedPath = "";
                if (!settings.keepAnchor) {
                    state.selectionAnchorPath = "";
                }
            } else {
                const normalizedPrimaryPath = normalizePath(
                    settings.primaryPath !== undefined ? settings.primaryPath : Array.from(nextSelectedPaths)[0],
                    true
                );
                state.selectedPath = nextSelectedPaths.has(normalizedPrimaryPath)
                    ? normalizedPrimaryPath
                    : Array.from(nextSelectedPaths)[0];

                const normalizedAnchorPath = normalizePath(
                    settings.anchorPath !== undefined ? settings.anchorPath : state.selectedPath,
                    true
                );
                if (!settings.keepAnchor) {
                    state.selectionAnchorPath = normalizedAnchorPath;
                } else if (
                    !state.selectionAnchorPath ||
                    !nextSelectedPaths.has(state.selectionAnchorPath)
                ) {
                    state.selectionAnchorPath = state.selectedPath;
                }
            }

            if (settings.render === false) {
                updatePathCurrentSize();
                return;
            }
            renderPathBreadcrumbs(state.selectedPath || state.currentDir);
            renderList({ skipPreview: Boolean(settings.skipPreview) });
            updatePathCurrentSize();
        }

        function updatePathCurrentSize() {
            if (!pathCurrentSizeEl) {
                return;
            }
            if (state.selectedPaths.size === 1) {
                const entry = state.entryByPath.get(state.selectedPath);
                if (entry) {
                    pathCurrentSizeEl.textContent = entry.size_display || "";
                    return;
                }
            }
            pathCurrentSizeEl.textContent = getCurrentDirMeta().size_display || originalDirSizeText;
        }

        function getSelectionRangeTo(entryPath) {
            const anchorPath = state.selectionAnchorPath;
            if (!anchorPath) {
                return [entryPath];
            }
            const startIndex = state.visibleEntryPaths.indexOf(anchorPath);
            const endIndex = state.visibleEntryPaths.indexOf(entryPath);
            if (startIndex < 0 || endIndex < 0) {
                return [entryPath];
            }
            const from = Math.min(startIndex, endIndex);
            const to = Math.max(startIndex, endIndex);
            return state.visibleEntryPaths.slice(from, to + 1);
        }

        function selectEntry(entryPath, options) {
            applySelection([entryPath || ""], options);
        }

        function selectEntriesByRowClick(entry, event) {
            if (!entry) {
                return;
            }
            const entryPath = normalizePath(entry.path, true);
            const hasToggleModifier = Boolean(event && (event.metaKey || event.ctrlKey));
            const hasRangeModifier = Boolean(event && event.shiftKey);

            if (hasRangeModifier) {
                const rangePaths = getSelectionRangeTo(entryPath);
                if (hasToggleModifier) {
                    const merged = new Set(state.selectedPaths);
                    rangePaths.forEach(function (pathValue) {
                        merged.add(pathValue);
                    });
                    applySelection(Array.from(merged), {
                        primaryPath: entryPath,
                        anchorPath: state.selectionAnchorPath || entryPath,
                    });
                    return;
                }
                applySelection(rangePaths, {
                    primaryPath: entryPath,
                    anchorPath: state.selectionAnchorPath || entryPath,
                });
                return;
            }

            if (hasToggleModifier) {
                const nextSelected = new Set(state.selectedPaths);
                if (nextSelected.has(entryPath)) {
                    nextSelected.delete(entryPath);
                } else {
                    nextSelected.add(entryPath);
                }
                applySelection(Array.from(nextSelected), {
                    primaryPath: entryPath,
                    anchorPath: entryPath,
                });
                return;
            }

            applySelection([entryPath], {
                primaryPath: entryPath,
                anchorPath: entryPath,
            });
        }

        function openContextMenuAt(entry, x, y) {
            if (!contextMenu) {
                return;
            }
            const contextEntries = resolveContextEntries(entry);
            if (contextEntries.length === 0) {
                closeContextMenu();
                return;
            }
            state.contextTarget = contextEntries[0];
            state.contextEntries = contextEntries;
            syncContextMenuByEntries(contextEntries);

            const hasVisibleAction = hasVisibleContextMenuAction(contextMenu);
            if (!hasVisibleAction) {
                closeContextMenu();
                return;
            }

            contextMenu.hidden = false;
            contextMenu.style.left = "0px";
            contextMenu.style.top = "0px";

            const rect = contextMenu.getBoundingClientRect();
            const viewportPadding = 8;
            const maxLeft = Math.max(viewportPadding, window.innerWidth - rect.width - viewportPadding);
            const minTop = viewportPadding;
            const maxTop = Math.max(minTop, window.innerHeight - rect.height - viewportPadding);

            let left = Math.min(Math.max(viewportPadding, x), maxLeft);
            let top = Math.max(minTop, y);

            if (y + rect.height + viewportPadding > window.innerHeight) {
                const overflowBottom = y + rect.height + viewportPadding - window.innerHeight;
                top = y - overflowBottom - 10;
            }

            top = Math.min(Math.max(minTop, top), maxTop);

            contextMenu.style.left = String(left) + "px";
            contextMenu.style.top = String(top) + "px";
        }

        function buildBreadcrumbItems(pathValue) {
            const normalizedPath = normalizePath(pathValue, true);
            const normalizedSharedRootPath = normalizePath(sharedRootPath, true);
            if (hasSharedContext() && normalizedSharedRootPath) {
                const effectivePath = normalizedPath && (
                    normalizedPath === normalizedSharedRootPath ||
                    normalizedPath.startsWith(normalizedSharedRootPath + "/")
                )
                    ? normalizedPath
                    : normalizedSharedRootPath;
                const rootParts = normalizedSharedRootPath.split("/").filter(Boolean);
                const rootLabel = rootParts.length ? rootParts[rootParts.length - 1] : normalizedSharedRootPath;
                const sharedBaseUrl = handriveRootUrl || "";
                const crumbs = [
                    {
                        label: sharedOwnerUsername,
                        path: normalizedSharedRootPath,
                        url: sharedBaseUrl,
                        isCurrent: false,
                    },
                    {
                        label: rootLabel,
                        path: normalizedSharedRootPath,
                        url: sharedBaseUrl,
                        isCurrent: effectivePath === normalizedSharedRootPath,
                    },
                ];
                if (effectivePath === normalizedSharedRootPath) {
                    return crumbs;
                }
                const childPath = effectivePath.slice(normalizedSharedRootPath.length + 1);
                const childParts = childPath.split("/").filter(Boolean);
                childParts.forEach(function (part, index) {
                    const relativeChildPath = childParts.slice(0, index + 1).join("/");
                    crumbs.push({
                        label: part,
                        path: normalizedSharedRootPath + "/" + relativeChildPath,
                        url: sharedBaseUrl.replace(/\/$/, "") + "/" + encodePathSegments(relativeChildPath),
                        isCurrent: index === childParts.length - 1,
                    });
                });
                return crumbs;
            }
            return buildNavigationBreadcrumbItems(pathValue, {
                effectiveRootLabel: effectiveRootLabel,
                isSuperuser: isSuperuser,
                normalizePath: normalizePath,
                scopedHomeDir: scopedHomeDir,
            });
        }

        function renderPathBreadcrumbs(pathValue) {
            renderNavigationBreadcrumbs(pathValue, {
                bindHandrivePathDropTargets: bindHandrivePathDropTargets,
                buildBreadcrumbItems: buildBreadcrumbItems,
                buildListUrl: buildListUrl,
                documentRef: document,
                effectiveRootLabel: effectiveRootLabel,
                handriveBaseUrl: handriveBaseUrl,
                handriveRootUrl: handriveRootUrl,
                isSuperuser: isSuperuser,
                pathBreadcrumbs: pathBreadcrumbs,
                scopedHomeDir: scopedHomeDir,
            });
        }

        function getCachedEntries(dirPath) {
            return getCachedDirectoryEntries(dirPath, state);
        }

        async function loadDirectory(dirPath) {
            return loadDirectoryEntries(dirPath, {
                getCachedEntries: getCachedEntries,
                listApiUrl: appendSharedQuery(listApiUrl),
                normalizePath: normalizePath,
                requestJson: requestJson,
                state: state,
            });
        }

        function syncCurrentDirectoryMetaFromCache(dirPath) {
            const normalizedDirPath = normalizePath(dirPath, true);
            const cachedMeta = state.directoryMetaCache.get(normalizedDirPath);
            if (cachedMeta) {
                applyCurrentDirectoryMeta(cachedMeta);
            }
        }

        async function refreshCurrentDirectory(options) {
            const settings = options || {};
            await refreshDirectoryEntries({
                currentDir: state.currentDir,
                listApiUrl: appendSharedQuery(listApiUrl),
                loadDirectory: loadDirectory,
                normalizePath: normalizePath,
                renderList: settings.skipPreview
                    ? function () { renderList({ skipPreview: true }); }
                    : renderList,
                requestJson: requestJson,
                state: state,
            });
            syncCurrentDirectoryMetaFromCache(state.currentDir);
            renderPathBreadcrumbs(state.currentDir);
            updatePathCurrentSize();
        }

        function resetDirectoryScopedUi() {
            state.selectedPath = "";
            state.selectedPaths = new Set();
            state.selectionAnchorPath = "";
            state.contextTarget = null;
            state.contextEntries = [];
            state.expandedFolders = new Set();
            state.openingFolderPath = "";
            state.activePreviewPath = "";
            state.activeRenderedPreviewPath = "";
            state.searchQuery = "";
            state.searchResults = null;
            state.searchGeneration += 1;
            syncSearchInputValues("", null);
            closeContextMenu();
            clearPreviewPane();
        }

        function updateDirectoryHistory(dirPath, mode) {
            const historyMode = mode || "push";
            const normalizedDirPath = normalizePath(dirPath, true);
            const targetUrl = (hasSharedContext() && sharedRootPath && normalizedDirPath === sharedRootPath)
                ? handriveRootUrl
                : buildListUrl(handriveBaseUrl, normalizedDirPath, handriveRootUrl);
            const historyState = {
                handriveListDir: normalizedDirPath,
            };
            if (historyMode === "replace") {
                window.history.replaceState(historyState, "", targetUrl);
                return;
            }
            window.history.pushState(historyState, "", targetUrl);
        }

        async function navigateToDirectory(dirPath, options) {
            const settings = options || {};
            const normalizedDirPath = normalizePath(dirPath, true);
            const isSameDirectory = normalizedDirPath === state.currentDir;
            if (isSameDirectory && !settings.forceReload) {
                if (settings.historyMode === "replace") {
                    updateDirectoryHistory(normalizedDirPath, "replace");
                }
                return;
            }

            state.navigationGeneration += 1;
            const navigationGeneration = state.navigationGeneration;
            resetDirectoryScopedUi();
            setListLoading(true);
            try {
                await loadDirectory(normalizedDirPath);
                if (navigationGeneration !== state.navigationGeneration) {
                    return;
                }
                applyCurrentDirectoryMeta(
                    state.directoryMetaCache.get(normalizedDirPath) || { path: normalizedDirPath }
                );
                renderPathBreadcrumbs(state.currentDir);
                renderList();
                updatePathCurrentSize();
                if (settings.historyMode !== "skip") {
                    updateDirectoryHistory(state.currentDir, settings.historyMode === "replace" ? "replace" : "push");
                }
            } catch (error) {
                if (settings.historyMode === "replace") {
                    updateDirectoryHistory(state.currentDir, "replace");
                }
                throw error;
            } finally {
                if (navigationGeneration === state.navigationGeneration) {
                    setListLoading(false);
                }
            }
        }

        async function toggleUrlShare(entry) {
            if (!entry || entry.isCurrentFolder || !entry.can_edit || !urlShareApiUrl) {
                return null;
            }

            const data = await requestJson(
                appendSharedQuery(urlShareApiUrl),
                buildPostOptions({
                    path: entry.path,
                    enabled: !Boolean(entry.is_url_only),
                })
            );

            await refreshCurrentDirectory();
            return {
                entry: state.entryByPath.get(entry.path) || null,
                data: data,
            };
        }

        function remapExpandedFoldersForRename(fromPath, toPath) {
            const normalizedFromPath = normalizePath(fromPath, true);
            const normalizedToPath = normalizePath(toPath, true);
            if (!normalizedFromPath || !normalizedToPath || normalizedFromPath === normalizedToPath) {
                return;
            }
            const remapped = new Set();
            state.expandedFolders.forEach(function (folderPath) {
                const normalizedFolderPath = normalizePath(folderPath, true);
                if (!normalizedFolderPath) {
                    return;
                }
                if (normalizedFolderPath === normalizedFromPath) {
                    remapped.add(normalizedToPath);
                    return;
                }
                if (normalizedFolderPath.startsWith(normalizedFromPath + "/")) {
                    remapped.add(normalizedToPath + normalizedFolderPath.slice(normalizedFromPath.length));
                    return;
                }
                remapped.add(normalizedFolderPath);
            });
            state.expandedFolders = remapped;
        }

        function removeExpandedFoldersByDeletedPaths(pathValues) {
            const targets = (Array.isArray(pathValues) ? pathValues : [])
                .map(function (value) {
                    return normalizePath(value, true);
                })
                .filter(function (value) {
                    return Boolean(value);
                });
            if (targets.length === 0) {
                return;
            }

            const nextExpandedFolders = new Set();
            state.expandedFolders.forEach(function (folderPath) {
                const normalizedFolderPath = normalizePath(folderPath, true);
                if (!normalizedFolderPath) {
                    return;
                }
                const shouldRemove = targets.some(function (targetPath) {
                    return normalizedFolderPath === targetPath || normalizedFolderPath.startsWith(targetPath + "/");
                });
                if (!shouldRemove) {
                    nextExpandedFolders.add(normalizedFolderPath);
                }
            });
            state.expandedFolders = nextExpandedFolders;
        }

        function getEntryEditableName(entry) {
            if (!entry) {
                return "";
            }
            if (entry.type === "file") {
                const fileName = String(entry.name || "");
                const dotIndex = fileName.lastIndexOf(".");
                if (dotIndex > 0) {
                    return fileName.slice(0, dotIndex);
                }
            }
            return entry.name;
        }

        function syncModalBodyState() {
            syncHandriveModalBodyState();
        }

        function getHandrivePathLabel(pathValue) {
            const normalized = normalizePath(pathValue, true);
            if (!normalized) {
                return "/handrive";
            }
            const parts = normalized.split("/").filter(Boolean);
            const hiddenRootPrefixes = new Set(["users", "groups"]);
            const displayParts = hiddenRootPrefixes.has(parts[0]) && parts.length > 1
                ? parts.slice(1)
                : parts;
            return "/" + displayParts.join("/");
        }

        function getParentDirectory(pathValue) {
            const normalized = normalizePath(pathValue, true);
            if (!normalized) {
                return "";
            }
            const parts = normalized.split("/");
            parts.pop();
            return parts.join("/");
        }

        function clearDragOverTarget() {
            if (state.dragOverElement) {
                state.dragOverElement.classList.remove("is-drop-target");
                state.dragOverElement = null;
            }
            if (state.dragHoverElement) {
                state.dragHoverElement.classList.remove("is-drop-hover");
                state.dragHoverElement = null;
            }
            clearFileDropGroup();
        }

        function isFileTransfer(event) {
            const dataTransfer = event && event.dataTransfer ? event.dataTransfer : null;
            if (!dataTransfer) {
                return false;
            }
            if (dataTransfer.files && dataTransfer.files.length > 0) {
                return true;
            }
            if (!dataTransfer.types) {
                return false;
            }
            return Array.from(dataTransfer.types).includes("Files");
        }

        function setFileDropTarget(active) {
            if (!listPane) {
                return;
            }
            listPane.classList.toggle("is-file-drop-target", Boolean(active));
        }

        function clearFileDragUiState() {
            clearHoverExpandTimer();
            clearDragOverTarget();
            setFileDropTarget(false);
        }

        function clearFileDropGroup() {
            const rows = Array.isArray(state.fileDropGroupRows) ? state.fileDropGroupRows : [];
            rows.forEach(function (row) {
                if (!row || !row.classList) {
                    return;
                }
                row.classList.remove("is-file-drop-group", "is-file-drop-group-start", "is-file-drop-group-end");
                const item = row.closest(".handrive-item");
                if (item) {
                    item.classList.remove("is-file-drop-group-item", "is-file-drop-group-start", "is-file-drop-group-end");
                    item.style.removeProperty("--handrive-drop-group-left");
                }
            });
            state.fileDropGroupRows = [];
            state.fileDropGroupPath = "";
            if (listContainer) {
                listContainer.classList.remove("is-file-drop-root-target");
            }
        }

        function addFileDropGroupRow(rows, row) {
            if (!(row instanceof Element) || rows.indexOf(row) !== -1) {
                return;
            }
            rows.push(row);
        }

        function getFileDropGroupRows(targetDirPath, highlightElement) {
            const targetPath = normalizePath(targetDirPath || "", true);
            if (
                !targetPath ||
                !(highlightElement instanceof Element) ||
                !highlightElement.classList.contains("handrive-item-row")
            ) {
                return [];
            }
            const rows = [];
            addFileDropGroupRow(rows, state.entryRowByPath.get(targetPath) || highlightElement);

            const currentDirPath = normalizePath(state.currentDir || "", true);
            const includesVisibleDescendants = state.expandedFolders.has(targetPath) || targetPath === currentDirPath;
            if (!includesVisibleDescendants) {
                return rows;
            }

            const visiblePaths = Array.isArray(state.visibleEntryPaths) ? state.visibleEntryPaths : [];
            visiblePaths.forEach(function (pathValue) {
                const visiblePath = normalizePath(pathValue || "", true);
                if (!visiblePath || visiblePath === targetPath || !visiblePath.startsWith(targetPath + "/")) {
                    return;
                }
                addFileDropGroupRow(rows, state.entryRowByPath.get(visiblePath));
            });
            return rows;
        }

        function getFileDropGroupLeftOffset(highlightElement) {
            if (!(highlightElement instanceof Element)) {
                return 0;
            }
            const item = highlightElement.closest(".handrive-item");
            const prefix = item ? item.querySelector(":scope > .handrive-item-tree-prefix") : null;
            if (!item || !prefix) {
                return 0;
            }
            const segments = prefix.querySelectorAll(".handrive-tree-segment");
            const lastSegment = segments.length > 0 ? segments[segments.length - 1] : null;
            if (!(lastSegment instanceof Element)) {
                return 0;
            }
            const itemRect = item.getBoundingClientRect();
            const segmentRect = lastSegment.getBoundingClientRect();
            return Math.max(0, Math.round(segmentRect.left - itemRect.left));
        }

        function setFileDropGroup(targetDirPath, highlightElement) {
            const targetPath = normalizePath(targetDirPath || "", true);
            const rows = getFileDropGroupRows(targetPath, highlightElement);
            const groupLeftOffset = getFileDropGroupLeftOffset(highlightElement);
            const currentDirPath = normalizePath(state.currentDir || "", true);
            clearFileDropGroup();
            if (rows.length === 0) {
                return;
            }
            if (listContainer) {
                listContainer.classList.toggle("is-file-drop-root-target", Boolean(targetPath && targetPath === currentDirPath));
            }
            rows.forEach(function (row, index) {
                const item = row.closest(".handrive-item");
                row.classList.add("is-file-drop-group");
                if (item) {
                    item.classList.add("is-file-drop-group-item");
                    item.style.setProperty("--handrive-drop-group-left", String(groupLeftOffset) + "px");
                }
                if (index === 0) {
                    row.classList.add("is-file-drop-group-start");
                    if (item) {
                        item.classList.add("is-file-drop-group-start");
                    }
                }
                if (index === rows.length - 1) {
                    row.classList.add("is-file-drop-group-end");
                    if (item) {
                        item.classList.add("is-file-drop-group-end");
                    }
                }
            });
            state.fileDropGroupRows = rows;
            state.fileDropGroupPath = targetPath;
        }

        function isInsideCurrentFileDropGroup(targetNode) {
            if (!(targetNode instanceof Element) || !Array.isArray(state.fileDropGroupRows)) {
                return false;
            }
            const row = targetNode.closest(".handrive-item-row");
            if (row && state.fileDropGroupRows.indexOf(row) !== -1) {
                return true;
            }
            const item = targetNode.closest(".handrive-item");
            if (!item) {
                return false;
            }
            const itemRow = item.querySelector(".handrive-item-row");
            return Boolean(itemRow && state.fileDropGroupRows.indexOf(itemRow) !== -1);
        }

        function getCurrentDirectoryDropRow() {
            const currentDirPath = normalizePath(state.currentDir || "", true);
            if (!currentDirPath) {
                return null;
            }
            const currentEntry = state.entryByPath.get(currentDirPath);
            if (!currentEntry || !currentEntry.can_write_children) {
                return null;
            }
            return state.entryRowByPath.get(currentDirPath) || null;
        }

        function isBareListFileDropTarget(targetNode) {
            if (!(targetNode instanceof Element) || !listPane || !listPane.contains(targetNode)) {
                return false;
            }
            return !targetNode.closest(".handrive-item");
        }

        function resolveFileDropHighlightElement(targetNode) {
            if (!(targetNode instanceof Element)) {
                return null;
            }
            const row = targetNode.closest(".handrive-item-row");
            if (!row) {
                return null;
            }
            const entryPath = normalizePath(row.getAttribute("data-entry-path") || "", true);
            const entry = state.entryByPath.get(entryPath);
            if (!entry) {
                return null;
            }
            if (entry.type === "dir") {
                return row;
            }
            const parentDirPath = getParentDirectory(entry.path);
            return state.entryRowByPath.get(parentDirPath) || null;
        }

        function createOperationQueueItem(operationType, entries, targetDirPath, commitMessage, options) {
            const normalizedEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
            const settings = options || {};
            state.uploadQueueSequence += 1;
            const item = {
                id: state.uploadQueueSequence,
                kind: "operation",
                operationType: operationType,
                entries: normalizedEntries.map(function (entry) {
                    return {
                        path: entry.path,
                        slug_path: entry.slug_path || "",
                        name: getEntryEditableName(entry),
                        type: entry.type,
                        size_display: entry.size_display || "",
                        is_archive_member: Boolean(entry.is_archive_member),
                        is_archive: Boolean(entry.is_archive),
                        archive_path: entry.archive_path || "",
                        archive_member_path: entry.archive_member_path || "",
                    };
                }),
                fileName: buildQueueItemLabel(normalizedEntries, operationType, {
                    formatTemplate: formatTemplate,
                    getCurrentFolderName: getCurrentFolderName,
                    getEntryEditableName: getEntryEditableName,
                    t: t,
                }),
                sourcePath: normalizedEntries.length > 0 ? normalizedEntries[0].path : "",
                targetDirPath: normalizePath(targetDirPath || "", true),
                destinationMode: settings.destinationMode || "",
                status: "queued",
                progress: 0,
                errorMessage: "",
                savedPath: "",
                savedSlugPath: "",
                commitMessage: String(commitMessage || ""),
                isRepoDelete: Boolean(settings.repoDelete),
                abortRequested: false,
                abortController: null,
                sizeDisplay: normalizedEntries.length === 1 ? (normalizedEntries[0].size_display || "") : "",
            };
            state.uploadQueueItems.push(item);
            state.uploadQueueDismissed = false;
            renderUploadQueue();
            return item;
        }

        function enqueuePendingYoutubeDownloaderSave() {
            const storageKey = "hanplanet.youtubeDownloader.pendingSave";
            let payload = null;
            try {
                const raw = window.sessionStorage ? window.sessionStorage.getItem(storageKey) : "";
                if (!raw) {
                    return;
                }
                payload = JSON.parse(raw);
                window.sessionStorage.removeItem(storageKey);
            } catch (error) {
                try {
                    window.sessionStorage.removeItem(storageKey);
                } catch (removeError) {}
                return;
            }

            if (!payload || !payload.token || !payload.saveUrl) {
                return;
            }
            const createdAt = Number(payload.createdAt || 0);
            if (createdAt && Date.now() - createdAt > 30 * 60 * 1000) {
                return;
            }
            state.uploadQueueSequence += 1;
            state.uploadQueueItems.push({
                id: state.uploadQueueSequence,
                kind: "operation",
                operationType: "youtube-save",
                entries: [],
                fileName: String(payload.filename || "youtube-download"),
                sourcePath: "YouTube Downloader",
                targetDirPath: normalizePath(payload.targetDir || "youtube-downloader", true),
                status: "queued",
                progress: 0,
                errorMessage: "",
                savedPath: "",
                savedSlugPath: "",
                commitMessage: "",
                abortRequested: false,
                abortController: null,
                saveUrl: String(payload.saveUrl || ""),
                sizeDisplay: "",
                token: String(payload.token || ""),
            });
            state.uploadQueueDismissed = false;
            state.uploadQueueCollapsed = false;
            renderUploadQueue();
            processOperationQueue().catch(alertError);
        }

        let _uploadQueuePollTimer = null;
        function renderUploadQueue() {
            const items = state.uploadQueueItems.slice(-20);
            const hasActiveUploads = items.some(function (item) {
                return item.status === "uploading" && item.kind !== "operation";
            });
            if (hasActiveUploads) {
                if (!_uploadQueuePollTimer) {
                    _uploadQueuePollTimer = setTimeout(function () {
                        _uploadQueuePollTimer = null;
                        renderUploadQueue();
                    }, 1000);
                }
            } else {
                if (_uploadQueuePollTimer) {
                    clearTimeout(_uploadQueuePollTimer);
                    _uploadQueuePollTimer = null;
                }
            }
            renderUploadQueuePanel({
                createQueueListItem: function (item) {
                    return createQueueListItem(item, {
                        documentRef: document,
                        getMetaLabel: function (nextItem) {
                            return getQueueItemMetaLabel(nextItem, getHandrivePathLabel);
                        },
                        getStatusLabel: function (nextItem) {
                            return getQueueItemStatusLabel(nextItem, t);
                        },
                        onOpenContextMenu: openUploadQueueContextMenu,
                    });
                },
                collapsed: state.uploadQueueCollapsed,
                dismissed: state.uploadQueueDismissed,
                items: items,
                sortQueueItems: sortQueueItems,
                summarizeUploadQueue: function (nextItems) {
                    return summarizeUploadQueue(nextItems, t);
                },
                t: t,
                uploadQueueList: uploadQueueList,
                uploadQueuePanel: uploadQueuePanel,
                uploadQueueSummary: uploadQueueSummary,
                uploadQueueToggleButton: uploadQueueToggleButton,
            });
        }

        function removeUploadQueueItem(itemId) {
            state.uploadQueueItems = state.uploadQueueItems.filter(function (item) {
                return item.id !== itemId;
            });
            if (state.uploadQueueContextItem && state.uploadQueueContextItem.id === itemId) {
                closeContextMenu();
            }
            renderUploadQueue();
        }

        function cancelUploadQueueItem(item) {
            if (!item) {
                return;
            }
            item.abortRequested = true;
            if (item.xhr) {
                item.xhr.abort();
            }
            if (item.abortController) {
                item.abortController.abort();
            }
            if (uploadCancelApiUrl && item.uploadId) {
                const formData = new FormData();
                formData.append("upload_id", item.uploadId);
                const csrfToken = getCsrfToken();
                fetch(uploadCancelApiUrl, {
                    method: "POST",
                    headers: csrfToken ? { "X-CSRFToken": csrfToken } : {},
                    body: formData,
                    credentials: "same-origin",
                }).catch(function () {
                    return null;
                });
            }
            removeUploadQueueItem(item.id);
        }

        async function deleteUploadedQueueItem(item) {
            if (item && item.kind === "operation") {
                removeUploadQueueItem(item.id);
                return;
            }
            if (!item || !item.savedPath) {
                removeUploadQueueItem(item && item.id);
                return;
            }
            const confirmed = await requestConfirmDialog({
                title: t("delete_button", "삭제"),
                message: formatTemplate(
                    t("js_confirm_delete_entry", "정말 삭제할까요?\n{path}"),
                    { path: item.savedPath }
                ),
                cancelText: t("cancel", "취소"),
                confirmText: t("delete_button", "삭제")
            });
            if (!confirmed) {
                return;
            }
            await requestJson(
                deleteApiUrl,
                buildPostOptions({
                    path: item.savedPath,
                })
            );
            removeUploadQueueItem(item.id);
            await refreshCurrentDirectory();
        }

        function openUploadQueueContextMenu(item, x, y) {
            if (!contextMenu || !item) {
                return;
            }
            closeContextMenu();
            state.uploadQueueContextItem = item;
            state.contextTarget = null;
            state.contextEntries = [];

            configureUploadQueueContextMenu({
                buttons: {
                    deleteButton: contextDeleteButton,
                    download: contextDownloadButton,
                    edit: contextEditButton,
                    createArchive: contextCreateArchiveButton,
                    extractArchive: contextExtractArchiveButton,
                    share: contextShareButton,
                    gitCreateRepo: contextGitCreateRepoButton,
                    gitDeleteRepo: contextGitDeleteRepoButton,
                    gitManageRepo: contextGitManageRepoButton,
                    gitCreateBranch: contextGitCreateBranchButton,
                    gitDeleteBranch: contextGitDeleteBranchButton,
                    createMap: contextCreateMapButton,
                    convertMp3: contextConvertMp3Button,
                    newDoc: contextNewDocButton,
                    newFolder: contextNewFolderButton,
                    open: contextOpenButton,
                    permissions: contextPermissionsButton,
                    rename: contextRenameButton,
                    upload: contextUploadButton,
                },
                defaultLabels: defaultContextButtonLabels,
                item: item,
                setContextButtonVisible: setContextButtonVisible,
                t: t,
            });
            syncContextMenuDividers(contextMenu);

            contextMenu.hidden = false;
            contextMenu.style.left = "0px";
            contextMenu.style.top = "0px";

            const rect = contextMenu.getBoundingClientRect();
            const viewportPadding = 8;
            const maxLeft = Math.max(viewportPadding, window.innerWidth - rect.width - viewportPadding);
            const minTop = viewportPadding;
            const maxTop = Math.max(minTop, window.innerHeight - rect.height - viewportPadding);

            const left = Math.min(Math.max(viewportPadding, x), maxLeft);
            const top = Math.min(Math.max(minTop, y), maxTop);

            contextMenu.style.left = left + "px";
            contextMenu.style.top = top + "px";
        }

        function queueNeedsRefresh() {
            state.uploadRefreshPending = true;
        }

        const uploadChunkSize = 256 * 1024;
        const uploadRateLimitBytesPerSecond = 10 * 1024 * 1024;

        function delay(ms) {
            return new Promise(function (resolve) {
                window.setTimeout(resolve, ms);
            });
        }

        async function uploadSingleFile(item) {
            if (!uploadApiUrl) {
                throw new Error(t("job_status_failed", "실패"));
            }
            const file = item.file;
            const totalBytes = Math.max(1, file.size || 0);
            item.startTime = Date.now();
            item.uploadSpeed = 0;
            item.uploadedBytes = 0;
            const totalChunks = Math.max(1, Math.ceil(totalBytes / uploadChunkSize));
            const uploadId = (window.crypto && window.crypto.randomUUID)
                ? window.crypto.randomUUID()
                : ("upload-" + String(Date.now()) + "-" + String(Math.random()).slice(2));
            item.uploadId = uploadId;

            function sendChunk(chunkBlob, chunkIndex, chunkStart) {
                return new Promise(function (resolve, reject) {
                    const formData = new FormData();
                    formData.append("dir", item.targetDirPath);
                    formData.append("upload_id", uploadId);
                    formData.append("file_name", file.name);
                    formData.append("chunk_index", String(chunkIndex));
                    formData.append("total_chunks", String(totalChunks));
                    if (item.commitMessage) {
                        formData.append("commit_message", item.commitMessage);
                    }
                    formData.append("chunk", chunkBlob, file.name);

                    const xhr = new XMLHttpRequest();
                    item.xhr = xhr;
                    xhr.open("POST", uploadApiUrl, true);
                    xhr.timeout = 120000;
                    const csrfToken = getCsrfToken();
                    if (csrfToken) {
                        xhr.setRequestHeader("X-CSRFToken", csrfToken);
                    }

                    if (xhr.upload) {
                        xhr.upload.addEventListener("progress", function (event) {
                            if (!event.lengthComputable) {
                                return;
                            }
                            const uploadedWithinChunk = Math.max(0, Math.min(event.loaded, chunkBlob.size));
                            const uploadedSoFar = Math.min(totalBytes, chunkStart + uploadedWithinChunk);
                            item.progress = Math.min(99, (uploadedSoFar / totalBytes) * 100);
                            item.uploadedBytes = uploadedSoFar;
                            const elapsedSec = Math.max(0.001, (Date.now() - (item.startTime || Date.now())) / 1000);
                            item.uploadSpeed = uploadedSoFar / elapsedSec;
                            renderUploadQueue();
                        });
                    }

                    xhr.addEventListener("load", function () {
                        let payload = null;
                        try {
                            payload = JSON.parse(xhr.responseText || "null");
                        } catch (error) {
                            payload = null;
                        }
                        item.xhr = null;
                        if (xhr.status >= 200 && xhr.status < 300) {
                            resolve(payload);
                            return;
                        }
                        let message = payload && payload.error
                            ? payload.error
                            : t("job_status_failed", "실패");
                        if (!payload || !payload.error) {
                            if (xhr.status === 413) {
                                message = t("upload_error_file_too_large", "단일 용량 초과");
                            } else if (xhr.status === 415) {
                                message = t("upload_error_file_type_not_allowed", "업로드 불가능한 파일 형식");
                            } else if (xhr.status === 408 || xhr.status === 504) {
                                message = t("upload_error_timeout", "대기시간 초과");
                            }
                        }
                        reject(new Error(message));
                    });

                    xhr.addEventListener("error", function () {
                        item.xhr = null;
                        reject(new Error(t("job_status_failed", "실패")));
                    });

                    xhr.addEventListener("timeout", function () {
                        item.xhr = null;
                        reject(new Error(t("upload_error_timeout", "대기시간 초과")));
                    });

                    xhr.addEventListener("abort", function () {
                        item.xhr = null;
                        reject(new Error(t("upload_cancel", "업로드 취소")));
                    });

                    xhr.send(formData);
                });
            }

            let payload = null;
            let uploadedBytes = 0;
            for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
                if (item.abortRequested) {
                    throw new Error(t("upload_cancel", "업로드 취소"));
                }
                const chunkStart = chunkIndex * uploadChunkSize;
                const chunkEnd = Math.min(file.size, chunkStart + uploadChunkSize);
                const chunkBlob = file.slice(chunkStart, chunkEnd);
                const startedAt = window.performance && typeof window.performance.now === "function"
                    ? window.performance.now()
                    : Date.now();
                payload = await sendChunk(chunkBlob, chunkIndex, chunkStart);
                uploadedBytes = chunkEnd;
                item.progress = chunkIndex === totalChunks - 1
                    ? 99
                    : Math.min(99, (uploadedBytes / totalBytes) * 100);
                renderUploadQueue();

                const elapsedMs = (window.performance && typeof window.performance.now === "function"
                    ? window.performance.now()
                    : Date.now()) - startedAt;
                const minDurationMs = (chunkBlob.size / uploadRateLimitBytesPerSecond) * 1000;
                if (elapsedMs < minDurationMs) {
                    await delay(minDurationMs - elapsedMs);
                }
            }

            item.progress = 100;
            item.status = "done";
            const uploadedEntry = payload && Array.isArray(payload.entries) ? payload.entries[0] : null;
            item.savedPath = uploadedEntry && uploadedEntry.path ? uploadedEntry.path : "";
            item.savedSlugPath = uploadedEntry && uploadedEntry.slug_path ? uploadedEntry.slug_path : "";
            item.xhr = null;
            renderUploadQueue();
            queueNeedsRefresh();
        }

        async function processUploadQueue() {
            await processUploadQueueWorker({
                alertError: alertError,
                refreshCurrentDirectory: refreshCurrentDirectory,
                renderUploadQueue: renderUploadQueue,
                state: state,
                t: t,
                uploadSingleFile: uploadSingleFile,
            });
        }

        async function runDeleteOperationQueueItem(item) {
            await runDeleteQueueOperation(item, {
                applySelection: applySelection,
                buildPostOptions: buildPostOptions,
                deleteApiUrl: deleteApiUrl,
                onEntryDeleted: removeSyncExcludedStateForDelete,
                queueNeedsRefresh: queueNeedsRefresh,
                removeExpandedFoldersByDeletedPaths: removeExpandedFoldersByDeletedPaths,
                renderUploadQueue: renderUploadQueue,
                requestJson: requestJson,
                t: t,
            });
        }

        async function runCreateArchiveOperationQueueItem(item) {
            await runCreateArchiveQueueOperation(item, {
                applySelection: applySelection,
                archiveCreateApiUrl: archiveCreateApiUrl,
                buildPostOptions: buildPostOptions,
                queueNeedsRefresh: queueNeedsRefresh,
                renderUploadQueue: renderUploadQueue,
                requestJson: requestJson,
                t: t,
            });
        }

        async function runMoveOperationQueueItem(item) {
            await runMoveQueueOperation(item, {
                applySelection: applySelection,
                buildPostOptions: buildPostOptions,
                moveApiUrl: moveApiUrl,
                onEntryMoved: remapSyncExcludedStateForMove,
                queueNeedsRefresh: queueNeedsRefresh,
                renderUploadQueue: renderUploadQueue,
                requestJson: requestJson,
                t: t,
            });
        }

        async function runExtractOperationQueueItem(item) {
            await runExtractQueueOperation(item, {
                applySelection: applySelection,
                archiveExtractApiUrl: archiveExtractApiUrl,
                buildPostOptions: buildPostOptions,
                queueNeedsRefresh: queueNeedsRefresh,
                renderUploadQueue: renderUploadQueue,
                requestJson: requestJson,
                t: t,
            });
        }

        async function runYoutubeSaveOperationQueueItem(item) {
            if (!item.saveUrl || !item.token) {
                throw new Error(t("job_status_failed", "실패"));
            }
            item.progress = 10;
            renderUploadQueue();
            const data = await requestJson(item.saveUrl, buildPostOptions({ token: item.token }));
            item.progress = 90;
            item.savedPath = data && data.path
                ? data.path
                : normalizePath((item.targetDirPath || "") + "/" + (item.fileName || ""), true);
            item.savedSlugPath = data && data.slug_path ? data.slug_path : "";
            renderUploadQueue();
            queueNeedsRefresh();
        }

        async function runConvertMp3OperationQueueItem(item) {
            if (!convertMp3ApiUrl) {
                throw new Error(t("job_status_failed", "실패"));
            }
            const entries = Array.isArray(item.entries) ? item.entries.slice() : [];
            const convertedPaths = [];
            for (let index = 0; index < entries.length; index += 1) {
                if (item.abortRequested) {
                    throw new Error(t("queue_cancel", "취소"));
                }
                const controller = new AbortController();
                item.abortController = controller;
                const entry = entries[index];
                const data = await requestJson(appendSharedQuery(convertMp3ApiUrl), Object.assign(
                    buildPostOptions({ path: entry.path }),
                    { signal: controller.signal }
                ));
                const convertedPath = data && data.path ? data.path : "";
                if (convertedPath) {
                    convertedPaths.push(convertedPath);
                }
                item.progress = ((index + 1) / Math.max(1, entries.length)) * 100;
                item.savedPath = convertedPath || item.savedPath || "";
                item.savedSlugPath = data && data.slug_path ? data.slug_path : "";
                item.sizeDisplay = data && data.size_display ? data.size_display : item.sizeDisplay;
                item.abortController = null;
                renderUploadQueue();
            }
            if (convertedPaths.length > 0) {
                applySelection(convertedPaths, {
                    primaryPath: convertedPaths[0] || "",
                    anchorPath: convertedPaths[0] || "",
                    render: false,
                });
            }
            queueNeedsRefresh();
        }

        async function processOperationQueue() {
            await processOperationQueueWorker({
                alertError: alertError,
                refreshCurrentDirectory: refreshCurrentDirectory,
                removeUploadQueueItem: removeUploadQueueItem,
                renderUploadQueue: renderUploadQueue,
                runCreateArchiveOperationQueueItem: runCreateArchiveOperationQueueItem,
                runDeleteOperationQueueItem: runDeleteOperationQueueItem,
                runExtractOperationQueueItem: runExtractOperationQueueItem,
                runMoveOperationQueueItem: runMoveOperationQueueItem,
                runYoutubeSaveOperationQueueItem: runYoutubeSaveOperationQueueItem,
                runConvertMp3OperationQueueItem: runConvertMp3OperationQueueItem,
                state: state,
                t: t,
            });
        }

        async function enqueueUploadFiles(files, targetDirPath) {
            await enqueueQueuedUploadFiles(files, targetDirPath, {
                alertError: alertError,
                normalizePath: normalizePath,
                processUploadQueue: processUploadQueue,
                promptCommitMessage: promptCommitMessage,
                renderUploadQueue: renderUploadQueue,
                requiresCommitMessageForDirectory: requiresCommitMessageForDirectory,
                state: state,
                uploadApiUrl: uploadApiUrl,
            });
        }

        function openContextUploadPicker(entry) {
            if (!contextUploadInput || !entry || entry.type !== "dir" || !entry.can_write_children) {
                return;
            }
            state.pendingContextUploadDir = normalizePath(entry.path, true);
            contextUploadInput.value = "";
            contextUploadInput.click();
        }

        function shouldIgnorePasteUploadTarget() {
            const activeElement = document.activeElement;
            if (!activeElement) {
                return false;
            }
            const tagName = String(activeElement.tagName || "").toLowerCase();
            if (tagName === "input" || tagName === "textarea") {
                return true;
            }
            return Boolean(activeElement.isContentEditable);
        }

        function getClipboardDefaultFileExtension(file) {
            const type = String(file && file.type ? file.type : "").toLowerCase();
            const extensionByType = {
                "image/bmp": ".bmp",
                "image/gif": ".gif",
                "image/jpeg": ".jpg",
                "image/png": ".png",
                "image/svg+xml": ".svg",
                "image/webp": ".webp",
                "text/html": ".html",
                "text/plain": ".txt",
                "video/mp4": ".mp4",
                "video/webm": ".webm",
            };
            return extensionByType[type] || "";
        }

        function getClipboardDefaultFilename(file, index) {
            const suffix = index > 0 ? "-" + String(index + 1) : "";
            return "untitled" + suffix + getClipboardDefaultFileExtension(file);
        }

        function isLikelyGeneratedClipboardFilename(file, filename, index) {
            const rawName = String(filename || "").trim().toLowerCase();
            if (!rawName) {
                return true;
            }

            // Browsers often synthesize a generic name for pasted files instead of exposing
            // the user's original filename. Treat those names like "missing" so the filename
            // dialog still appears and the user can confirm or override them.
            const extensionlessName = rawName.replace(/\.[a-z0-9._-]{1,16}$/i, "");
            const genericNamePatterns = [
                /^(?:blob|clipboard|file|image|photo|picture|screenshot|screen shot|screen_shot|capture|untitled)(?:[-_ ]?\d+)?$/,
                /^(?:pasted[-_ ]?(?:image|clipboard))(?:[-_ ]?\d+)?$/,
                /^(?:image|photo|picture|screenshot|screen shot|screen_shot|capture|untitled)(?:[-_ ]?\d+)?\.(?:bmp|gif|jpe?g|png|svg|webp|heic|avif|tiff?)$/,
            ];

            return genericNamePatterns.some(function (pattern) {
                return pattern.test(rawName) || pattern.test(extensionlessName);
            });
        }

        function renameClipboardFile(file, filename) {
            const safeName = String(filename || "").trim();
            if (!file || !safeName) {
                return file;
            }
            try {
                return new File([file], safeName, {
                    type: file.type || "application/octet-stream",
                    lastModified: file.lastModified || Date.now(),
                });
            } catch (error) {
                const renamedBlob = file.slice(0, file.size || 0, file.type || "application/octet-stream");
                try {
                    Object.defineProperty(renamedBlob, "name", {
                        configurable: true,
                        value: safeName,
                    });
                    Object.defineProperty(renamedBlob, "lastModified", {
                        configurable: true,
                        value: file.lastModified || Date.now(),
                    });
                } catch (defineError) {
                    return file;
                }
                return renamedBlob;
            }
        }

        function resolveClipboardFilenameValue(file, inputValue, defaultFilename) {
            const safeInput = String(inputValue || "").trim();
            const fallbackName = String(defaultFilename || "").trim();
            const baseName = safeInput || fallbackName;
            if (!baseName) {
                return "";
            }

            const normalizedBaseName = baseName.replace(/\.+$/g, "");
            const baseExtMatch = normalizedBaseName.match(/\.([a-z0-9._-]{1,16})$/i);
            if (baseExtMatch) {
                return normalizedBaseName;
            }

            const clipboardExtension = getClipboardDefaultFileExtension(file);
            return clipboardExtension ? normalizedBaseName + clipboardExtension : normalizedBaseName;
        }

        async function resolveClipboardUploadFilenames(files, targetDirPath) {
            const resolvedFiles = [];
            const targetLabel = targetDirPath
                ? t("clipboard_filename_target_prefix", "업로드 위치") + ": " + targetDirPath
                : t("clipboard_filename_target_root", "업로드 위치: HanDrive");
            for (let index = 0; index < files.length; index += 1) {
                const file = files[index];
                const fileName = String(file && file.name ? file.name : "").trim();
                if (fileName && !isLikelyGeneratedClipboardFilename(file, fileName, index)) {
                    resolvedFiles.push(file);
                    continue;
                }

                const defaultFilename = getClipboardDefaultFilename(file, index);
                const inputValue = await requestClipboardFilenameDialog({
                    targetText: targetLabel,
                    placeholder: t("clipboard_filename_blank_default_prefix", "비워두면 ")
                        + defaultFilename
                        + t("clipboard_filename_blank_default_suffix", " 이름으로 업로드됩니다."),
                });
                if (inputValue === null) {
                    return null;
                }
                resolvedFiles.push(
                    renameClipboardFile(
                        file,
                        resolveClipboardFilenameValue(file, inputValue, defaultFilename)
                    )
                );
            }
            return resolvedFiles;
        }

        function setDragOverTarget(element) {
            if (!element || state.dragOverElement === element) {
                return;
            }
            clearDragOverTarget();
            state.dragOverElement = element;
            state.dragOverElement.classList.add("is-drop-target");
        }

        function clearHoverExpandTimer() {
            if (state.hoverExpandTimerId !== null) {
                window.clearTimeout(state.hoverExpandTimerId);
                state.hoverExpandTimerId = null;
            }
            state.hoverExpandPath = "";
        }

        function scheduleHoverExpand(targetDirPath) {
            const normalizedPath = normalizePath(targetDirPath, true);
            if (!normalizedPath || state.expandedFolders.has(normalizedPath)) {
                clearHoverExpandTimer();
                return;
            }
            if (state.hoverExpandPath === normalizedPath && state.hoverExpandTimerId !== null) {
                return;
            }

            clearHoverExpandTimer();
            state.hoverExpandPath = normalizedPath;
            state.hoverExpandTimerId = window.setTimeout(function () {
                state.hoverExpandTimerId = null;
                state.hoverExpandPath = "";
                const targetEntry = state.entryByPath.get(normalizedPath);
                if (!targetEntry || targetEntry.type !== "dir" || state.expandedFolders.has(normalizedPath)) {
                    return;
                }
                toggleFolderExpansion(targetEntry).catch(alertError);
            }, 500);
        }

        function canDropToDirectory(targetDirPath, options) {
            if ((!moveApiUrl && !archiveExtractApiUrl) || !Array.isArray(state.draggingEntries) || state.draggingEntries.length === 0) {
                return false;
            }

            const targetPath = normalizePath(targetDirPath, true);
            const allowSameParent = Boolean(options && options.allowSameParent);
            const hasArchiveSources = state.draggingEntries.some(function (entry) {
                return Boolean(entry && entry.is_archive_member);
            });
            const hasNormalSources = state.draggingEntries.some(function (entry) {
                return Boolean(entry && !entry.is_archive_member);
            });
            if (hasArchiveSources && (hasNormalSources || !archiveExtractApiUrl || isArchiveVirtualPath(targetPath))) {
                return false;
            }
            let hasMovableSource = false;

            for (let index = 0; index < state.draggingEntries.length; index += 1) {
                const dragEntry = state.draggingEntries[index];
                if (!dragEntry) {
                    return false;
                }
                const sourcePath = normalizePath(dragEntry.path, false);
                const sourceType = dragEntry.type;

                if (!sourcePath || sourcePath === targetPath) {
                    return false;
                }
                if (!hasArchiveSources && !allowSameParent && getParentDirectory(sourcePath) === targetPath) {
                    return false;
                }
                if (!hasArchiveSources && sourceType === "dir" && targetPath && targetPath.startsWith(sourcePath + "/")) {
                    return false;
                }
                hasMovableSource = true;
            }
            return hasMovableSource;
        }

        async function extractArchiveEntriesToDirectory(sourceEntries, targetDirPath) {
            if (!Array.isArray(sourceEntries) || sourceEntries.length === 0 || !archiveExtractApiUrl) {
                return;
            }
            createOperationQueueItem("extract", sourceEntries, targetDirPath, "", {
                destinationMode: "current",
            });
            processOperationQueue().catch(alertError);
        }

        function createArchiveFromFolder(entry) {
            if (!entry || entry.type !== "dir" || !archiveCreateApiUrl) {
                return;
            }
            createOperationQueueItem("create-archive", [entry], getParentDirectory(entry.path), "");
            processOperationQueue().catch(alertError);
        }

        async function moveEntriesToDirectory(sourceEntries, targetDirPath) {
            if (!Array.isArray(sourceEntries) || sourceEntries.length === 0) {
                return;
            }
            if (sourceEntries.every(function (entry) { return Boolean(entry && entry.is_archive_member); })) {
                await extractArchiveEntriesToDirectory(sourceEntries, targetDirPath);
                return;
            }
            if (!moveApiUrl) {
                return;
            }
            var commitMessage = "";
            if (requiresCommitMessageForEntries(sourceEntries) || requiresCommitMessageForDirectory(targetDirPath)) {
                commitMessage = await promptCommitMessage(targetDirPath);
                if (commitMessage === null) {
                    return;
                }
            }
            createOperationQueueItem("move", sourceEntries, targetDirPath, commitMessage);
            processOperationQueue().catch(alertError);
        }

        function activateFileDropTarget(event, targetDirPath, highlightElement) {
            event.preventDefault();
            event.stopPropagation();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = "copy";
            }
            setFileDropTarget(true);
            setDragOverTarget(highlightElement);
            setFileDropGroup(targetDirPath, highlightElement);
            scheduleHoverExpand(targetDirPath);
        }

        function bindDropTarget(targetElement, targetDirPath, options) {
            if (!targetElement) {
                return;
            }
            const bindOptions = options || {};
            const highlightElement = bindOptions.highlightElement || targetElement;
            const fileTransfersOnly = Boolean(bindOptions.fileTransfersOnly);

            targetElement.addEventListener("dragenter", function (event) {
                if (isFileTransfer(event)) {
                    activateFileDropTarget(event, targetDirPath, highlightElement);
                    return;
                }
                if (fileTransfersOnly) {
                    return;
                }
                if (!canDropToDirectory(targetDirPath, options)) {
                    return;
                }
                event.preventDefault();
                setDragOverTarget(highlightElement);
                scheduleHoverExpand(targetDirPath);
            });

            targetElement.addEventListener("dragover", function (event) {
                if (isFileTransfer(event)) {
                    activateFileDropTarget(event, targetDirPath, highlightElement);
                    return;
                }
                if (fileTransfersOnly) {
                    return;
                }
                if (!canDropToDirectory(targetDirPath, options)) {
                    return;
                }
                event.preventDefault();
                if (event.dataTransfer) {
                    event.dataTransfer.dropEffect = "move";
                }
                setDragOverTarget(highlightElement);
                scheduleHoverExpand(targetDirPath);
            });

            targetElement.addEventListener("dragleave", function (event) {
                if (!state.dragOverElement || state.dragOverElement !== highlightElement) {
                    return;
                }
                if (isInsideCurrentFileDropGroup(event.relatedTarget)) {
                    return;
                }
                const nextHighlightElement = resolveFileDropHighlightElement(event.relatedTarget);
                if (nextHighlightElement && nextHighlightElement === highlightElement) {
                    return;
                }
                if (event.relatedTarget && targetElement.contains(event.relatedTarget)) {
                    return;
                }
                clearHoverExpandTimer();
                clearDragOverTarget();
            });

            targetElement.addEventListener("drop", function (event) {
                if (isFileTransfer(event)) {
                    event.preventDefault();
                    event.stopPropagation();
                    clearFileDragUiState();
                    enqueueUploadFiles(
                        event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files : [],
                        targetDirPath
                    ).catch(alertError);
                    return;
                }
                if (fileTransfersOnly) {
                    return;
                }
                if (!canDropToDirectory(targetDirPath, options)) {
                    return;
                }
                event.preventDefault();
                clearHoverExpandTimer();
                clearDragOverTarget();
                moveEntriesToDirectory(state.draggingEntries.slice(), targetDirPath).catch(alertError);
            });
        }

        function pruneNestedDragEntries(entries) {
            if (!Array.isArray(entries) || entries.length === 0) {
                return [];
            }
            const uniqueEntries = [];
            const seenPaths = new Set();
            entries.forEach(function (entry) {
                if (!entry || !entry.path || seenPaths.has(entry.path)) {
                    return;
                }
                seenPaths.add(entry.path);
                uniqueEntries.push(entry);
            });

            const directoryPaths = uniqueEntries
                .filter(function (entry) {
                    return entry.type === "dir";
                })
                .map(function (entry) {
                    return entry.path;
                })
                .sort(function (left, right) {
                    if (left.length !== right.length) {
                        return left.length - right.length;
                    }
                    return left.localeCompare(right);
                });

            return uniqueEntries.filter(function (entry) {
                return !directoryPaths.some(function (directoryPath) {
                    return directoryPath !== entry.path && entry.path.startsWith(directoryPath + "/");
                });
            });
        }

        function resolveDraggingEntriesFromRow(entry) {
            if (!entry) {
                return [];
            }
            const baseEntries =
                state.selectedPaths.size > 1 && state.selectedPaths.has(entry.path)
                    ? getSelectedEntries()
                    : [entry];
            const movableEntries = baseEntries.filter(function (candidate) {
                if (!candidate) {
                    return false;
                }
                if (candidate.isCurrentFolder) {
                    return false;
                }
                if (candidate.is_archive_member && candidate.can_extract) {
                    return true;
                }
                if (!(candidate.can_edit || candidate.can_delete)) {
                    return false;
                }
                return !(candidate.type === "file" && candidate.is_public_write);
            });

            const normalized = pruneNestedDragEntries(movableEntries);
            normalized.sort(function (left, right) {
                const leftDepth = left.path.split("/").length;
                const rightDepth = right.path.split("/").length;
                if (leftDepth !== rightDepth) {
                    return leftDepth - rightDepth;
                }
                return left.path.localeCompare(right.path);
            });
            return normalized;
        }

        function getCurrentFolderName(pathValue) {
            const normalized = normalizePath(pathValue, true);
            if (!normalized) {
                return effectiveRootLabel;
            }
            const parts = normalized.split("/");
            return parts[parts.length - 1] || effectiveRootLabel;
        }

        function getCurrentDirMeta() {
            const cachedMeta = state.directoryMetaCache.get(state.currentDir);
            if (cachedMeta && typeof cachedMeta === "object") {
                state.currentDirMeta = Object.assign({}, state.currentDirMeta || {}, cachedMeta, {
                    path: normalizePath(cachedMeta.path || state.currentDir, true),
                });
            }
            return state.currentDirMeta || {};
        }

        function applyCurrentDirectoryMeta(meta) {
            const normalizedPath = normalizePath(meta && meta.path !== undefined ? meta.path : state.currentDir, true);
            const nextMeta = Object.assign({}, state.currentDirMeta || {}, meta || {}, { path: normalizedPath });
            state.currentDir = normalizedPath;
            state.currentDirMeta = nextMeta;
            state.directoryMetaCache.set(normalizedPath, nextMeta);
            root.dataset.currentDir = normalizedPath;
            root.dataset.currentDirIsRoot = nextMeta.is_root ? "1" : "0";
            root.dataset.currentDirCanEdit = nextMeta.can_edit ? "1" : "0";
            root.dataset.currentDirCanWriteChildren = nextMeta.can_write_children ? "1" : "0";
            root.dataset.currentDirHasChildren = nextMeta.has_children ? "1" : "0";
            root.dataset.currentDirIsGitRepoRoot = nextMeta.is_git_repo_root ? "1" : "0";
            root.dataset.currentDirRequiresCommitMessage = nextMeta.requires_commit_message ? "1" : "0";
            root.dataset.currentDirGitBranchRoot = nextMeta.git_branch_root ? "1" : "0";
            root.dataset.currentDirGitCommitMessage = nextMeta.git_commit_message || "";
            root.dataset.currentDirGitCommitAuthorUsername = nextMeta.git_commit_author_username || "";
            root.dataset.currentDirModifiedDisplay = nextMeta.modified_display || "";
            root.dataset.currentDirSizeDisplay = nextMeta.size_display || "";
            currentDirGitRepo = nextMeta.git_repo || null;
        }

        function buildCurrentDirectoryEntry() {
            const currentDirMeta = getCurrentDirMeta();
            return {
                path: state.currentDir,
                type: "dir",
                isCurrentFolder: true,
                can_edit: Boolean(currentDirMeta.can_edit),
                can_write_children: Boolean(currentDirMeta.can_write_children),
                can_delete: Boolean(currentDirMeta.git_repo && currentDirMeta.is_git_repo_root),
                requires_commit_message: Boolean(currentDirMeta.requires_commit_message),
                git_repo: currentDirMeta.is_git_repo_root ? (currentDirMeta.git_repo || null) : null,
                git_repo_meta: currentDirMeta.git_repo || null,
                git_branch_root: Boolean(currentDirMeta.git_branch_root),
                is_git_virtual: Boolean(currentDirMeta.git_repo || currentDirMeta.git_branch_root || currentDirMeta.requires_commit_message),
                git_commit_message: currentDirMeta.git_commit_message || "",
                git_commit_author_username: currentDirMeta.git_commit_author_username || "",
                write_acl_labels: Array.isArray(currentDirMeta.write_acl_labels) ? currentDirMeta.write_acl_labels : [],
                is_public_write: false,
                modified_display: currentDirMeta.modified_display || "",
                size_display: currentDirMeta.size_display || "",
            };
        }

        function appendEntryMetaColumns(row, entry) {
            if (!row) {
                return;
            }
            const safeEntry = entry || {};
            const metaTrail = ensureEntryMetaTrail(row);
            if (!metaTrail) {
                return;
            }
            const modifiedField = createEntryMetaField("handrive-item-modified", safeEntry.modified_display || "");
            modifiedField.setAttribute("data-sort-key", "modified");
            const typeField = createEntryMetaField("handrive-item-type", resolveEntryTypeLabel(safeEntry));
            typeField.setAttribute("data-sort-key", "type");
            const sizeField = createEntryMetaField("handrive-item-size", safeEntry.size_display || "");
            sizeField.setAttribute("data-sort-key", "size");
            const permissionField = createEntryMetaField("handrive-item-permission", resolveEntryPermissionMeta(safeEntry));
            permissionField.setAttribute("data-sort-key", "permission");
            const commitField = createEntryMetaField("handrive-item-commit", resolveEntryCommitMeta(safeEntry));
            commitField.setAttribute("data-sort-key", "commit");
            const idField = createEntryMetaField("handrive-item-id", resolveEntryIdMeta(safeEntry));
            idField.setAttribute("data-sort-key", "id");
            metaTrail.appendChild(modifiedField);
            metaTrail.appendChild(typeField);
            metaTrail.appendChild(sizeField);
            metaTrail.appendChild(permissionField);
            metaTrail.appendChild(commitField);
            metaTrail.appendChild(idField);
        }

        function appendCurrentDirMetaColumns(row) {
            if (!row) {
                return;
            }
            const metaTrail = ensureEntryMetaTrail(row);
            if (!metaTrail) {
                return;
            }
            const modifiedField = createEntryMetaField("handrive-item-modified", t("list_sort_modified", textByLang("수정한 날짜", "Modified")));
            modifiedField.setAttribute("data-sort-key", "modified");
            const typeField = createEntryMetaField("handrive-item-type", t("list_sort_type", textByLang("유형", "Type")));
            typeField.setAttribute("data-sort-key", "type");
            const sizeField = createEntryMetaField("handrive-item-size", t("list_sort_size", textByLang("크기", "Size")));
            sizeField.setAttribute("data-sort-key", "size");
            const permissionField = createEntryMetaField("handrive-item-permission", t("list_sort_permission", textByLang("권한", "Permission")));
            permissionField.setAttribute("data-sort-key", "permission");
            const commitField = createEntryMetaField("handrive-item-commit", t("list_sort_commit", textByLang("커밋", "Commit")));
            commitField.setAttribute("data-sort-key", "commit");
            const idField = createEntryMetaField("handrive-item-id", t("list_sort_id", "ID"));
            idField.setAttribute("data-sort-key", "id");
            metaTrail.appendChild(modifiedField);
            metaTrail.appendChild(typeField);
            metaTrail.appendChild(sizeField);
            metaTrail.appendChild(permissionField);
            metaTrail.appendChild(commitField);
            metaTrail.appendChild(idField);
        }

        function ensureEntryMetaTrail(row) {
            if (!row) {
                return null;
            }
            let metaTrail = row.querySelector(".handrive-item-meta-trail");
            if (metaTrail) {
                return metaTrail;
            }
            metaTrail = document.createElement("span");
            metaTrail.className = "handrive-item-meta-trail";
            row.appendChild(metaTrail);
            return metaTrail;
        }

        function syncSearchInputValues(value, sourceInput) {
            const nextValue = String(value || "");
            if (listSearchInput && listSearchInput !== sourceInput && listSearchInput.value !== nextValue) {
                listSearchInput.value = nextValue;
            }
            if (currentDirSearchInput && currentDirSearchInput !== sourceInput && currentDirSearchInput.value !== nextValue) {
                currentDirSearchInput.value = nextValue;
            }
            updateSearchClearButtonVisibility();
        }

        function updateSearchClearButtonVisibility() {
            const hasValue = Boolean(String(listSearchInput && listSearchInput.value || "").length);
            if (listSearchClearButton) {
                listSearchClearButton.hidden = !hasValue;
            }
            if (currentDirSearchInput) {
                const clearButton = currentDirSearchInput
                    .closest(".handrive-current-dir-search-wrap")
                    ?.querySelector(".handrive-current-dir-search-clear");
                if (clearButton) {
                    clearButton.hidden = !Boolean(String(currentDirSearchInput.value || "").length);
                }
            }
        }

        function isCurrentDirInlineSearchVisible() {
            return Boolean(
                currentDirSearchInput &&
                currentDirSearchInput.closest(".handrive-current-dir-search-wrap:not([hidden])")
            );
        }

        function getSearchInputForCurrentContext(sourceInput) {
            if (sourceInput) {
                return sourceInput;
            }
            if (currentDirSearchInput && document.activeElement === currentDirSearchInput) {
                return currentDirSearchInput;
            }
            if (isCurrentDirInlineSearchVisible()) {
                return currentDirSearchInput;
            }
            return listSearchInput;
        }

        function ensureCurrentDirInlineSearch(row) {
            if (!row) {
                return null;
            }
            const bindCurrentDirSearchButton = function (button, input) {
                if (!button || !input || button.dataset.handriveSearchBound === "1") {
                    return;
                }
                button.dataset.handriveSearchBound = "1";
                button.addEventListener("click", function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    syncSearchInputValues(input.value, input);
                    applyListSearch(input).catch(alertError);
                });
            };
            const bindCurrentDirClearButton = function (button, input) {
                if (!button || !input || button.dataset.handriveClearBound === "1") {
                    return;
                }
                button.dataset.handriveClearBound = "1";
                button.addEventListener("click", function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    input.value = "";
                    syncSearchInputValues("", input);
                    applyListSearch(input).catch(alertError);
                    input.focus();
                });
            };
            const createCurrentDirSearchButton = function (input) {
                const button = document.createElement("button");
                button.className = "handrive-current-dir-search-button";
                button.type = "button";
                button.setAttribute("aria-label", t("search_button", textByLang("검색", "Search")));
                button.title = t("search_button", textByLang("검색", "Search"));
                bindCurrentDirSearchButton(button, input);
                return button;
            };
            const createCurrentDirClearButton = function (input) {
                const button = document.createElement("button");
                button.className = "root-input-clear handrive-current-dir-search-clear";
                button.type = "button";
                button.hidden = true;
                button.setAttribute("aria-label", t("clear_button", textByLang("지우기", "Clear")));
                button.title = t("clear_button", textByLang("지우기", "Clear"));
                bindCurrentDirClearButton(button, input);
                return button;
            };
            let wrap = row.querySelector(".handrive-current-dir-search-wrap");
            if (wrap) {
                currentDirSearchInput = wrap.querySelector(".handrive-current-dir-search-input");
                const existingButton = wrap.querySelector(".handrive-current-dir-search-button");
                if (existingButton && currentDirSearchInput) {
                    bindCurrentDirSearchButton(existingButton, currentDirSearchInput);
                } else if (currentDirSearchInput) {
                    wrap.insertBefore(createCurrentDirSearchButton(currentDirSearchInput), currentDirSearchInput);
                }
                const existingClearButton = wrap.querySelector(".handrive-current-dir-search-clear");
                if (existingClearButton && currentDirSearchInput) {
                    bindCurrentDirClearButton(existingClearButton, currentDirSearchInput);
                } else if (currentDirSearchInput) {
                    wrap.appendChild(createCurrentDirClearButton(currentDirSearchInput));
                }
                updateSearchClearButtonVisibility();
                return wrap;
            }

            wrap = document.createElement("span");
            wrap.className = "handrive-current-dir-search-wrap";
            wrap.hidden = true;

            const input = document.createElement("input");
            input.className = "root-search-input handrive-current-dir-search-input";
            input.type = "text";
            input.autocomplete = "off";
            input.spellcheck = false;
            input.placeholder = t("search_placeholder", textByLang("파일 검색", "Search files"));
            input.setAttribute("aria-label", t("search_button", textByLang("검색", "Search")));

            ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "contextmenu"].forEach(function (eventName) {
                wrap.addEventListener(eventName, function (event) {
                    event.stopPropagation();
                });
            });
            input.addEventListener("input", function () {
                syncSearchInputValues(input.value, input);
            });
            input.addEventListener("keydown", function (event) {
                event.stopPropagation();
                if (event.key === "Enter") {
                    event.preventDefault();
                    applyListSearch(input).catch(alertError);
                    return;
                }
                if (event.key === "Escape") {
                    event.preventDefault();
                    input.value = "";
                    syncSearchInputValues("", input);
                    applyListSearch(input).catch(alertError);
                }
            });

            wrap.appendChild(createCurrentDirSearchButton(input));
            wrap.appendChild(input);
            wrap.appendChild(createCurrentDirClearButton(input));
            row.appendChild(wrap);
            currentDirSearchInput = input;
            syncSearchInputValues(listSearchInput ? listSearchInput.value : state.searchQuery, null);
            return wrap;
        }

        function syncCurrentDirInlineSearchVisibility(visible) {
            const currentDirRow = listContainer
                ? listContainer.querySelector(".handrive-current-dir-row")
                : null;
            const wrap = ensureCurrentDirInlineSearch(currentDirRow);
            if (!currentDirRow || !wrap) {
                return;
            }
            const shouldShow = Boolean(visible);
            currentDirRow.classList.toggle("has-inline-search", shouldShow);
            wrap.hidden = !shouldShow;
            if (currentDirSearchInput) {
                currentDirSearchInput.tabIndex = shouldShow ? 0 : -1;
            }
            syncSearchInputValues(listSearchInput ? listSearchInput.value : state.searchQuery, null);
            if (shouldShow && document.activeElement === listSearchInput && currentDirSearchInput) {
                currentDirSearchInput.focus();
                currentDirSearchInput.setSelectionRange(currentDirSearchInput.value.length, currentDirSearchInput.value.length);
            } else if (!shouldShow && document.activeElement === currentDirSearchInput && listSearchInput) {
                listSearchInput.focus();
                listSearchInput.setSelectionRange(listSearchInput.value.length, listSearchInput.value.length);
            }
            updateListColumnVisibility();
        }

        function addCurrentDirectoryNode(fragment) {
            const currentFolderEntry = buildCurrentDirectoryEntry();
            const currentDirMeta = getCurrentDirMeta();

            const item = document.createElement("li");
            item.className = "handrive-item handrive-current-dir-item";

            const row = document.createElement("div");
            row.className = "handrive-item-row handrive-current-dir-row";
            row.setAttribute("role", "button");
            row.tabIndex = 0;
            row.setAttribute("data-entry-path", currentFolderEntry.path);
            state.entryRowByPath.set(currentFolderEntry.path, row);
            row.draggable = false;
            if (state.selectedPaths.has(currentFolderEntry.path) || normalizePath(currentFolderEntry.path, true) === state.activePreviewPath) {
                row.classList.add("is-selected");
            }

            const typeMarker = createTypeMarker({
                isDir: true,
                isRootAvatar: Boolean(currentDirMeta.is_root),
                accountProfileImageUrl: accountProfileImageUrl,
                isRepo: Boolean(currentDirMeta.is_git_repo_root),
                isBranch: Boolean(currentDirMeta.git_branch_root),
                isEmpty: !currentDirMeta.has_children,
            });

            const name = document.createElement("span");
            name.className = "handrive-item-name";
            name.textContent = getCurrentFolderName(state.currentDir);

            const nameWrap = document.createElement("span");
            nameWrap.className = "handrive-item-name-wrap";

            row.appendChild(typeMarker);
            row.appendChild(nameWrap);
            nameWrap.appendChild(name);

            appendCurrentDirRepoName(nameWrap, currentDirMeta.git_repo || null, {
                showForBranchOrRepoInner: Boolean(currentDirMeta.git_branch_root || currentDirMeta.requires_commit_message),
            });
            appendCurrentDirMetaColumns(row);
            ensureCurrentDirInlineSearch(row);
            bindCurrentDirSortControls(row);

            row.addEventListener("click", function (event) {
                if (event.button !== 0) { return; }
                event.preventDefault();
                closeContextMenu();
                selectEntriesByRowClick(currentFolderEntry, event);
            });

            row.addEventListener("contextmenu", function (event) {
                event.preventDefault();
                openContextMenuForEntry(currentFolderEntry, event.clientX, event.clientY);
            });

            row.addEventListener("keydown", function (event) {
                if (isKeyboardEditableTarget(event.target)) {
                    return;
                }
                if (event.key !== "Enter" && event.key !== " ") {
                    return;
                }
                event.preventDefault();
                closeContextMenu();
                selectEntriesByRowClick(currentFolderEntry, event);
            });

            if (currentFolderEntry.can_write_children) {
                bindDropTarget(row, currentFolderEntry.path, { allowSameParent: true });
            }

            state.entryByPath.set(currentFolderEntry.path, currentFolderEntry);
            state.visibleEntryPaths.push(currentFolderEntry.path);
            item.appendChild(row);
            fragment.appendChild(item);
        }

        function isSyncPathChecked(pathValue) {
            const normalized = normalizePath(pathValue, true);
            for (const uncheckedPath of state.syncDraftUncheckedPaths) {
                if (uncheckedPath === normalized) {
                    return false;
                }
                if (uncheckedPath && normalized && normalized.startsWith(uncheckedPath + "/")) {
                    return false;
                }
                if (normalized && uncheckedPath.startsWith(normalized + "/")) {
                    return false;
                }
                if (!normalized && uncheckedPath) {
                    return false;
                }
            }
            return true;
        }

        function isSyncHiddenEntry(entry) {
            return Boolean(
                entry
                && entry.type === "dir"
                && (entry.git_repo || entry.git_branch_root || entry.is_git_virtual)
            );
        }

        function pruneSyncUncheckedPaths(pathValue, options) {
            const normalized = normalizePath(pathValue, true);
            const settings = options || {};
            const removeSelf = settings.removeSelf !== false;
            const nextUncheckedPaths = new Set();

            state.syncDraftUncheckedPaths.forEach(function (uncheckedPath) {
                const isSelf = uncheckedPath === normalized;
                const isDescendant = normalized
                    ? uncheckedPath.startsWith(normalized + "/")
                    : Boolean(uncheckedPath);
                if ((removeSelf && isSelf) || isDescendant) {
                    return;
                }
                nextUncheckedPaths.add(uncheckedPath);
            });

            state.syncDraftUncheckedPaths = nextUncheckedPaths;
        }

        function remapSyncUncheckedPathSetForMove(pathSet, sourcePath, destinationPath) {
            const sourceNormalized = normalizePath(sourcePath, true);
            const destinationNormalized = normalizePath(destinationPath, true);
            if (!sourceNormalized || !destinationNormalized || sourceNormalized === destinationNormalized) {
                return pathSet;
            }

            const nextPaths = new Set();
            pathSet.forEach(function (rawPath) {
                const normalized = normalizePath(rawPath, true);
                if (normalized === sourceNormalized) {
                    nextPaths.add(destinationNormalized);
                    return;
                }
                if (normalized.startsWith(sourceNormalized + "/")) {
                    nextPaths.add(destinationNormalized + normalized.slice(sourceNormalized.length));
                    return;
                }
                nextPaths.add(normalized);
            });
            return nextPaths;
        }

        function pruneSyncUncheckedPathSetForDelete(pathSet, targetPath) {
            const targetNormalized = normalizePath(targetPath, true);
            const nextPaths = new Set();
            pathSet.forEach(function (rawPath) {
                const normalized = normalizePath(rawPath, true);
                if (normalized === targetNormalized) {
                    return;
                }
                if (targetNormalized && normalized.startsWith(targetNormalized + "/")) {
                    return;
                }
                nextPaths.add(normalized);
            });
            return nextPaths;
        }

        function remapSyncExcludedStateForMove(sourcePath, destinationPath) {
            state.syncSavedUncheckedPaths = remapSyncUncheckedPathSetForMove(
                state.syncSavedUncheckedPaths,
                sourcePath,
                destinationPath
            );
            state.syncDraftUncheckedPaths = remapSyncUncheckedPathSetForMove(
                state.syncDraftUncheckedPaths,
                sourcePath,
                destinationPath
            );
        }

        function removeSyncExcludedStateForDelete(pathValue) {
            state.syncSavedUncheckedPaths = pruneSyncUncheckedPathSetForDelete(
                state.syncSavedUncheckedPaths,
                pathValue
            );
            state.syncDraftUncheckedPaths = pruneSyncUncheckedPathSetForDelete(
                state.syncDraftUncheckedPaths,
                pathValue
            );
        }

        async function collectSyncDescendantPaths(dirPath, visitedDirs) {
            const normalizedDir = normalizePath(dirPath, true);
            if (visitedDirs.has(normalizedDir)) {
                return new Set();
            }
            visitedDirs.add(normalizedDir);

            await loadDirectory(normalizedDir);
            const descendantPaths = new Set();
            const entries = getCachedEntries(normalizedDir);
            for (const entry of entries) {
                if (isSyncHiddenEntry(entry)) {
                    continue;
                }
                descendantPaths.add(entry.path);
                if (entry.type === "dir") {
                    const childDescendants = await collectSyncDescendantPaths(entry.path, visitedDirs);
                    childDescendants.forEach(function (pathValue) {
                        descendantPaths.add(pathValue);
                    });
                }
            }
            return descendantPaths;
        }

        async function setSyncPathChecked(pathValue, checked, entryType) {
            const normalized = normalizePath(pathValue, true);
            if (!normalized && normalized !== "") {
                return;
            }
            const isDir = entryType === "dir";
            if (checked) {
                if (isDir) {
                    const descendantPaths = await collectSyncDescendantPaths(normalized, new Set());
                    pruneSyncUncheckedPaths(normalized, { removeSelf: true });
                    descendantPaths.forEach(function (descendantPath) {
                        state.syncDraftUncheckedPaths.delete(descendantPath);
                    });
                } else {
                    state.syncDraftUncheckedPaths.delete(normalized);
                }
                return;
            }
            if (isDir) {
                const descendantPaths = await collectSyncDescendantPaths(normalized, new Set());
                descendantPaths.forEach(function (descendantPath) {
                    state.syncDraftUncheckedPaths.add(descendantPath);
                });
                state.syncDraftUncheckedPaths.delete(normalized);
                return;
            }
            state.syncDraftUncheckedPaths.add(normalized);
        }

        function createSyncCheckbox(pathValue, entryType) {
            const wrap = document.createElement("span");
            wrap.className = "handrive-sync-item-checkbox-wrap";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.className = "handrive-sync-item-checkbox";
            checkbox.checked = isSyncPathChecked(pathValue);
            checkbox.setAttribute("aria-label", getHandrivePathLabel(pathValue));
            checkbox.addEventListener("click", function (event) {
                event.stopPropagation();
            });
            checkbox.addEventListener("change", async function () {
                checkbox.disabled = true;
                try {
                    await setSyncPathChecked(pathValue, checkbox.checked, entryType);
                } finally {
                    checkbox.disabled = false;
                }
                renderSyncModalList();
            });

            wrap.appendChild(checkbox);
            return wrap;
        }

        async function collectSyncExcludedEntriesForDirectory(dirPath, visitedDirs) {
            const normalizedDir = normalizePath(dirPath, true);
            if (visitedDirs.has(normalizedDir)) {
                return {
                    excludedPaths: new Set(),
                    totalFileCount: 0,
                    excludedFileCount: 0,
                };
            }
            visitedDirs.add(normalizedDir);

            const excludedPaths = new Set();
            let totalFileCount = 0;
            let excludedFileCount = 0;
            const entries = getCachedEntries(normalizedDir);
            for (const entry of entries) {
                if (isSyncHiddenEntry(entry)) {
                    continue;
                }
                if (entry.type === "file") {
                    totalFileCount += 1;
                    if (!isSyncPathChecked(entry.path)) {
                        excludedPaths.add(entry.path);
                        excludedFileCount += 1;
                    }
                    continue;
                }
                if (entry.type === "dir") {
                    await loadDirectory(entry.path);
                    const childResult = await collectSyncExcludedEntriesForDirectory(entry.path, visitedDirs);
                    childResult.excludedPaths.forEach(function (pathValue) {
                        excludedPaths.add(pathValue);
                    });
                    totalFileCount += childResult.totalFileCount;
                    excludedFileCount += childResult.excludedFileCount;

                    if (
                        childResult.totalFileCount > 0
                        && childResult.excludedFileCount === childResult.totalFileCount
                        && !isSyncPathChecked(entry.path)
                    ) {
                        childResult.excludedPaths.forEach(function (pathValue) {
                            excludedPaths.delete(pathValue);
                        });
                        excludedPaths.add(entry.path);
                    }
                }
            }

            return {
                excludedPaths: excludedPaths,
                totalFileCount: totalFileCount,
                excludedFileCount: excludedFileCount,
            };
        }

        function addSyncCurrentDirectoryNode(fragment) {
            const currentFolderEntry = buildCurrentDirectoryEntry();
            const currentDirMeta = getCurrentDirMeta();
            const item = document.createElement("li");
            item.className = "handrive-item handrive-current-dir-item";

            const row = document.createElement("button");
            row.type = "button";
            row.className = "handrive-item-row handrive-current-dir-row";
            row.setAttribute("data-entry-path", currentFolderEntry.path);

            const typeMarker = createTypeMarker({
                isDir: true,
                isRootAvatar: Boolean(currentDirMeta.is_root),
                accountProfileImageUrl: accountProfileImageUrl,
                isRepo: Boolean(currentDirMeta.is_git_repo_root),
                isBranch: Boolean(currentDirMeta.git_branch_root),
                isEmpty: !currentDirMeta.has_children,
            });

            const nameWrap = document.createElement("span");
            nameWrap.className = "handrive-item-name-wrap";

            const name = document.createElement("span");
            name.className = "handrive-item-name";
            name.textContent = getCurrentFolderName(state.currentDir);

            row.appendChild(typeMarker);
            row.appendChild(nameWrap);
            nameWrap.appendChild(name);

            appendCurrentDirRepoName(nameWrap, currentDirMeta.git_repo || null, {
                showForBranchOrRepoInner: Boolean(currentDirMeta.git_branch_root || currentDirMeta.requires_commit_message),
            });
            appendEntryMetaColumns(row, currentFolderEntry);
            const currentDirMetaTrail = ensureEntryMetaTrail(row);
            if (currentDirMetaTrail) {
                currentDirMetaTrail.appendChild(createSyncCheckbox(currentFolderEntry.path, currentFolderEntry.type));
            }

            row.addEventListener("click", function (event) {
                if (event.button !== 0) {
                    return;
                }
                event.preventDefault();
            });

            item.appendChild(row);
            fragment.appendChild(item);
        }

        function addSyncEntryNode(entry, fragment, ancestorHasNextSiblings, isLastSibling) {
            if (isSyncHiddenEntry(entry)) {
                return;
            }
            const item = document.createElement("li");
            item.className = "handrive-item";

            const row = document.createElement("button");
            row.type = "button";
            row.className = "handrive-item-row has-tree-prefix";
            row.setAttribute("data-entry-path", entry.path);

            const treePrefix = buildTreePrefixElement(ancestorHasNextSiblings, Boolean(isLastSibling));
            const fileIconKey = entry.type === "file" ? getFileIconKey(entry.path) : "";
            const typeMarker = createTypeMarker({
                isDir: entry.type === "dir",
                isRepo: entry.type === "dir" && entry.git_repo,
                isBranch: entry.type === "dir" && entry.git_branch_root,
                isMap: entry.type === "dir" && entry.is_map_folder,
                isEmpty: entry.type === "dir" && entry.has_children === false,
                fileIconKey: fileIconKey,
                isGenericFileIcon: entry.type === "file" && isGenericFileIconKey(fileIconKey),
                customIconUrl: (entry.type === "dir" && entry.folder_icon_url) ? entry.folder_icon_url : "",
            });

            row.appendChild(typeMarker);
            const nameWrap = document.createElement("span");
            nameWrap.className = "handrive-item-name-wrap";
            const name = document.createElement("span");
            name.className = "handrive-item-name";
            name.textContent = entry.name;
            nameWrap.appendChild(name);
            row.appendChild(nameWrap);
            appendEntryMetaColumns(row, entry);
            const metaTrail = ensureEntryMetaTrail(row);
            if (metaTrail) {
                metaTrail.appendChild(createSyncCheckbox(entry.path, entry.type));
            }

            row.addEventListener("click", function (event) {
                if (event.button !== 0) {
                    return;
                }
                event.preventDefault();
                if (entry.type !== "dir") {
                    return;
                }
                toggleSyncFolderExpansion(entry).catch(alertError);
            });

            item.appendChild(treePrefix);
            item.appendChild(row);
            fragment.appendChild(item);

            if (entry.type === "dir" && state.syncExpandedFolders.has(entry.path)) {
                const childEntries = getCachedEntries(entry.path);
                const nextAncestorHasNextSiblings = (ancestorHasNextSiblings || []).slice();
                nextAncestorHasNextSiblings.push(!isLastSibling);
                childEntries.forEach(function (child, index) {
                    addSyncEntryNode(child, fragment, nextAncestorHasNextSiblings, index === childEntries.length - 1);
                });
            }
        }

        async function toggleSyncFolderExpansion(entry) {
            if (!entry || entry.type !== "dir") {
                return;
            }
            if (state.syncExpandedFolders.has(entry.path)) {
                state.syncExpandedFolders.delete(entry.path);
                renderSyncModalList();
                return;
            }
            await loadDirectory(entry.path);
            state.syncExpandedFolders.add(entry.path);
            renderSyncModalList();
        }

        function renderSyncModalList() {
            if (!syncList) {
                return;
            }
            syncList.innerHTML = "";
            const fragment = document.createDocumentFragment();
            const currentFolderEntry = buildCurrentDirectoryEntry();
            if (!isSyncHiddenEntry(currentFolderEntry)) {
                addSyncCurrentDirectoryNode(fragment);
            }
            const entries = getCachedEntries(state.currentDir).filter(function (entry) {
                return !isSyncHiddenEntry(entry);
            });
            if (!entries.length) {
                const emptyItem = document.createElement("li");
                emptyItem.className = "handrive-item";
                const emptyRow = document.createElement("div");
                emptyRow.className = "handrive-item-row is-empty";
                emptyRow.textContent = t("js_empty_documents", "문서가 없습니다.");
                emptyItem.appendChild(emptyRow);
                fragment.appendChild(emptyItem);
                syncList.appendChild(fragment);
                return;
            }
            entries.forEach(function (entry, index) {
                addSyncEntryNode(entry, fragment, [], index === entries.length - 1);
            });
            syncList.appendChild(fragment);
        }

        function setSyncModalOpen(opened) {
            if (!syncModal) {
                return;
            }
            syncModal.hidden = !opened;
            syncModalBodyState();
            if (!opened) {
                return;
            }
            state.syncDraftUncheckedPaths = new Set(state.syncSavedUncheckedPaths);
            state.syncExpandedFolders = new Set(state.expandedFolders);
            renderSyncModalList();
        }

        async function submitSyncSettings() {
            if (!syncSettingsApiUrl) {
                throw new Error(t("js_error_request_failed", "요청 처리 중 오류가 발생했습니다."));
            }
            await loadDirectory(state.currentDir);
            const collected = await collectSyncExcludedEntriesForDirectory(state.currentDir, new Set());
            const excludedPaths = Array.from(collected.excludedPaths).sort();
            const data = await requestJson(syncSettingsApiUrl, buildPostOptions({
                excluded_paths: excludedPaths,
            }));
            state.syncSavedUncheckedPaths = new Set(Array.isArray(data && data.excluded_paths) ? data.excluded_paths : []);
            setSyncModalOpen(false);
        }

        function setRenameModalOpen(opened, entry) {
            if (!renameModal) {
                return;
            }
            if (!opened) {
                modalSetRenameModalOpen(renameModal, renameTarget, renameInput, syncModalBodyState, false, null, getEntryEditableName);
                state.renameTargetEntry = null;
                return;
            }
            state.renameTargetEntry = entry || null;
            modalSetRenameModalOpen(renameModal, renameTarget, renameInput, syncModalBodyState, true, state.renameTargetEntry, getEntryEditableName);
        }

        function setArchiveExtractModalOpen(opened, entry) {
            if (!archiveExtractModal) {
                return;
            }
            archiveExtractModal.hidden = !opened;
            syncModalBodyState();
            if (!opened) {
                state.archiveExtractTargetEntry = null;
                return;
            }
            state.archiveExtractTargetEntry = entry || null;
            if (archiveExtractTarget) {
                archiveExtractTarget.textContent = getHandrivePathLabel(entry && entry.path ? entry.path : "");
            }
        }

        async function submitArchiveExtract(destinationMode, entryOverride, targetDirOverride) {
            const entry = entryOverride || state.archiveExtractTargetEntry;
            if (!entry || !archiveExtractApiUrl) {
                return;
            }
            const sourcePath = entry.path || "";
            const targetDir = targetDirOverride !== undefined
                ? targetDirOverride
                : getParentDirectory(sourcePath);
            const data = await requestJson(
                archiveExtractApiUrl,
                buildPostOptions({
                    source_path: sourcePath,
                    target_dir: targetDir,
                    destination_mode: destinationMode || "current",
                })
            );
            setArchiveExtractModalOpen(false);
            await refreshCurrentDirectory({ skipPreview: true });
            const paths = data && Array.isArray(data.paths) ? data.paths : [];
            const selectedPath = paths[0] || (data && data.path) || "";
            if (selectedPath) {
                applySelection(paths.length > 0 ? paths : [selectedPath], {
                    primaryPath: selectedPath,
                    anchorPath: selectedPath,
                });
            }
        }

        function setFolderCreateModalOpen(opened, entry) {
            if (!folderCreateModal) {
                return;
            }
            if (!opened) {
                modalSetFolderCreateModalOpen(folderCreateModal, folderCreateTarget, folderCreateInput, syncModalBodyState, false, null, "");
                state.folderCreateParentEntry = null;
                return;
            }
            state.folderCreateParentEntry = entry || null;
            const parentPath = entry && entry.path ? entry.path : "";
            const targetLabel = t("create_folder_in_label", "생성 위치") + ": " + getHandrivePathLabel(parentPath);
            modalSetFolderCreateModalOpen(folderCreateModal, folderCreateTarget, folderCreateInput, syncModalBodyState, true, state.folderCreateParentEntry, targetLabel);
        }

        function setFolderIconModalOpen(opened, entry) {
            if (!folderIconModal) {
                return;
            }
            if (!opened) {
                modalSetFolderIconModalOpen(
                    folderIconModal,
                    folderIconTarget,
                    folderIconFileInput,
                    syncModalBodyState,
                    false,
                    null,
                    ""
                );
                if (folderIconFileInput) { folderIconFileInput.value = ""; }
                if (folderIconPreviewWrap) { folderIconPreviewWrap.hidden = true; }
                if (folderIconPreviewImg) { folderIconPreviewImg.src = ""; }
                state.folderIconTargetEntry = null;
                return;
            }
            state.folderIconTargetEntry = entry || null;
            modalSetFolderIconModalOpen(
                folderIconModal,
                folderIconTarget,
                folderIconFileInput,
                syncModalBodyState,
                true,
                state.folderIconTargetEntry,
                entry ? entry.path : ""
            );
            const hasExistingIcon = Boolean(entry && entry.folder_icon_url);
            if (folderIconDeleteButton) { folderIconDeleteButton.hidden = !hasExistingIcon; }
            if (folderIconPreviewWrap) { folderIconPreviewWrap.hidden = !hasExistingIcon; }
            if (folderIconPreviewImg && hasExistingIcon) { folderIconPreviewImg.src = entry.folder_icon_url; }
            if (folderIconFileInput) { folderIconFileInput.value = ""; }
        }

        function renderPermissionItems(container, items, selectedIdSet, emptyMessage, options) {
            modalRenderPermissionItems(container, items, selectedIdSet, emptyMessage, options);
        }

        function readCheckedIds(container) {
            return modalReadCheckedIds(container);
        }

        function setPermissionModalOpen(opened, entryOrEntries) {
            if (!permissionModal) {
                return;
            }
            if (!opened) {
                modalSetPermissionModalOpen(permissionModal, permissionTarget, syncModalBodyState, false, [], "");
                state.permissionTargetEntry = null;
                state.permissionTargetEntries = [];
                return;
            }
            const entries = Array.isArray(entryOrEntries)
                ? entryOrEntries.filter(Boolean)
                : (entryOrEntries ? [entryOrEntries] : []);
            const multipleLabel = formatTemplate(
                t("js_permission_target_multiple", "{count}개 항목"),
                { count: entries.length }
            );
            state.permissionTargetEntries = modalSetPermissionModalOpen(
                permissionModal,
                permissionTarget,
                syncModalBodyState,
                true,
                entries,
                multipleLabel
            );
            state.permissionTargetEntry = state.permissionTargetEntries[0] || null;
        }

        async function ensureAclOptionsLoaded() {
            if (state.aclOptionsLoaded || !aclOptionsApiUrl) {
                return;
            }

            const data = await requestJson(aclOptionsApiUrl);
            const users = Array.isArray(data.users) ? data.users : [];
            const groups = Array.isArray(data.groups) ? data.groups : [];
            state.aclOptions = {
                users: users.map(function (user) {
                    return { id: Number(user.id), label: String(user.username || "") };
                }).filter(function (user) {
                    return user.id > 0 && user.label;
                }),
                groups: groups.map(function (group) {
                    return {
                        id: Number(group.id),
                        label: String(group.label || group.name || ""),
                        isPublicAll: Boolean(group.is_public_all)
                    };
                }).filter(function (group) {
                    return group.id > 0 && group.label;
                }),
            };
            state.aclOptionsLoaded = true;
        }

        async function openPermissionModal(entryOrEntries) {
            const entries = Array.isArray(entryOrEntries)
                ? entryOrEntries.filter(Boolean)
                : (entryOrEntries ? [entryOrEntries] : []);
            if (entries.length === 0 || !aclApiUrl || !aclOptionsApiUrl) {
                return;
            }

            setPermissionModalOpen(true, entries);
            if (permissionReadUsersList) {
                permissionReadUsersList.textContent = t("permission_loading", "불러오는 중...");
            }
            if (permissionReadGroupsList) {
                permissionReadGroupsList.textContent = t("permission_loading", "불러오는 중...");
            }
            if (permissionWriteUsersList) {
                permissionWriteUsersList.textContent = t("permission_loading", "불러오는 중...");
            }
            if (permissionWriteGroupsList) {
                permissionWriteGroupsList.textContent = t("permission_loading", "불러오는 중...");
            }

            await ensureAclOptionsLoaded();
            let selectedReadUserIds = new Set();
            let selectedReadGroupIds = new Set();
            let selectedWriteUserIds = new Set();
            let selectedWriteGroupIds = new Set();

            if (entries.length === 1) {
                const data = await requestJson(aclApiUrl + "?path=" + encodeURIComponent(entries[0].path));
                selectedReadUserIds = new Set(
                    Array.isArray(data.read_user_ids) ? data.read_user_ids.map(Number) : []
                );
                selectedReadGroupIds = new Set(
                    Array.isArray(data.read_group_ids) ? data.read_group_ids.map(Number) : []
                );
                selectedWriteUserIds = new Set(
                    Array.isArray(data.write_user_ids) ? data.write_user_ids.map(Number) : []
                );
                selectedWriteGroupIds = new Set(
                    Array.isArray(data.write_group_ids) ? data.write_group_ids.map(Number) : []
                );
            }

            const includesDirectory = entries.some(function (entry) {
                return entry.type === "dir";
            });
            renderPermissionItems(
                permissionReadUsersList,
                state.aclOptions.users,
                selectedReadUserIds,
                t("permission_empty_users", "표시할 사용자가 없습니다.")
            );
            renderPermissionItems(
                permissionReadGroupsList,
                state.aclOptions.groups,
                selectedReadGroupIds,
                t("permission_empty_groups", "표시할 그룹이 없습니다."),
                {
                    isItemDisabled: function (group) {
                        return includesDirectory && Boolean(group && group.isPublicAll);
                    }
                }
            );
            renderPermissionItems(
                permissionWriteUsersList,
                state.aclOptions.users,
                selectedWriteUserIds,
                t("permission_empty_users", "표시할 사용자가 없습니다.")
            );
            renderPermissionItems(
                permissionWriteGroupsList,
                state.aclOptions.groups,
                selectedWriteGroupIds,
                t("permission_empty_groups", "표시할 그룹이 없습니다."),
                {
                    isItemDisabled: function (group) {
                        return includesDirectory && Boolean(group && group.isPublicAll);
                    }
                }
            );
        }

        async function submitPermissionSettings() {
            const entries = state.permissionTargetEntries.length > 0
                ? state.permissionTargetEntries.slice()
                : (state.permissionTargetEntry ? [state.permissionTargetEntry] : []);
            if (entries.length === 0) {
                return;
            }

            const readUserIds = readCheckedIds(permissionReadUsersList);
            const readGroupIds = readCheckedIds(permissionReadGroupsList);
            const writeUserIds = readCheckedIds(permissionWriteUsersList);
            const writeGroupIds = readCheckedIds(permissionWriteGroupsList);
            await requestJson(
                aclApiUrl,
                buildPostOptions({
                    path: entries.length === 1 ? entries[0].path : undefined,
                    paths: entries.length > 1
                        ? entries.map(function (entry) {
                            return entry.path;
                        })
                        : undefined,
                    read_user_ids: readUserIds,
                    read_group_ids: readGroupIds,
                    write_user_ids: writeUserIds,
                    write_group_ids: writeGroupIds,
                })
            );
            setPermissionModalOpen(false);
            await refreshCurrentDirectory();
        }

        function renameEntry(entry) {
            if (!entry) {
                return;
            }
            setRenameModalOpen(true, entry);
        }

        function newDocumentInFolder(entry) {
            if (!entry || entry.type !== "dir") {
                return;
            }
            window.location.href = buildWriteUrl(writeUrl, { dir: entry.path });
        }

        async function submitRename() {
            const entry = state.renameTargetEntry;
            if (!entry) {
                return;
            }

            const currentName = getEntryEditableName(entry);
            const trimmed = String(renameInput ? renameInput.value : "").trim();
            if (!trimmed || trimmed === currentName) {
                setRenameModalOpen(false);
                return;
            }

            var commitMessage = "";
            if (entry.requires_commit_message) {
                commitMessage = await promptCommitMessage(entry.path);
                if (commitMessage === null) {
                    return;
                }
            }

            const data = await requestJson(renameApiUrl, buildPostOptions({
                path: entry.path,
                new_name: trimmed,
                commit_message: commitMessage
            }));
            const renamedPath = data && data.path ? data.path : "";
            if (entry.type === "dir" && renamedPath) {
                remapExpandedFoldersForRename(entry.path, renamedPath);
            }
            if (renamedPath) {
                remapSyncExcludedStateForMove(entry.path, renamedPath);
            }
            applySelection([data && data.path ? data.path : ""], {
                primaryPath: data && data.path ? data.path : "",
                anchorPath: data && data.path ? data.path : "",
                render: false,
            });
            setRenameModalOpen(false);
            await refreshCurrentDirectory();
        }

        async function submitFolderCreate() {
            const parentEntry = state.folderCreateParentEntry;
            if (!parentEntry || parentEntry.type !== "dir") {
                window.alert(t("js_folder_create_requires_folder", "폴더에서만 새 폴더를 만들 수 있습니다."));
                return;
            }

            const folderName = String(folderCreateInput ? folderCreateInput.value : "").trim();
            if (!folderName) {
                window.alert(t("js_folder_name_required", "폴더 이름을 입력해주세요."));
                return;
            }

            var commitMessage = "";
            if (parentEntry.requires_commit_message) {
                commitMessage = await promptCommitMessage(parentEntry.path);
                if (commitMessage === null) {
                    return;
                }
            }

            await requestJson(
                mkdirApiUrl,
                buildPostOptions({
                    parent_dir: parentEntry.path,
                    folder_name: folderName,
                    commit_message: commitMessage
                })
            );

            setFolderCreateModalOpen(false);
            await refreshCurrentDirectory();
        }

        async function deleteEntries(entriesOrEntry, options) {
            const entries = Array.isArray(entriesOrEntry)
                ? entriesOrEntry.filter(Boolean)
                : (entriesOrEntry ? [entriesOrEntry] : []);
            const settings = options || {};
            if (entries.length === 0) {
                return;
            }

            const isMultiple = entries.length > 1;
            const targetPaths = entries.map(function (entry) {
                return entry.path;
            });
            const includesRepo = entries.some(function (entry) {
                return Boolean(entry && entry.type === "dir" && entry.git_repo);
            });
            const isSingleRepoDelete = entries.length === 1 && includesRepo;
            if (includesRepo && !settings.repoDelete) {
                throw new Error(t("js_repo_delete_requires_button", "Repo는 일반 삭제가 아니라 Repo 삭제를 사용해야 합니다."));
            }
            const confirmed = await requestConfirmDialog({
                title: isSingleRepoDelete ? t("delete_repo_button", "Repo 삭제") : t("delete_button", "삭제"),
                message: includesRepo
                    ? (isMultiple
                        ? formatTemplate(
                            t("js_confirm_delete_repo_entries", "선택한 {count}개 항목 중 Repo 폴더를 삭제하면 Forgejo 저장소도 함께 삭제됩니다.\n정말 삭제할까요?"),
                            { count: entries.length }
                        )
                        : formatTemplate(
                            t("js_confirm_delete_repo_entry", "이 Repo 폴더를 삭제하면 Forgejo 저장소도 함께 삭제됩니다.\n정말 삭제할까요?\n{path}"),
                            { path: targetPaths[0] }
                        ))
                    : (isMultiple
                        ? formatTemplate(
                            t("js_confirm_delete_entries", "선택한 {count}개 항목을 삭제할까요?"),
                            { count: entries.length }
                        )
                        : formatTemplate(
                            t("js_confirm_delete_entry", "정말 삭제할까요?\n{path}"),
                            { path: targetPaths[0] }
                        )),
                cancelText: t("cancel", "취소"),
                confirmText: isSingleRepoDelete ? t("delete_repo_button", "Repo 삭제") : t("delete_button", "삭제")
            });
            if (!confirmed) {
                return;
            }

            var commitMessage = "";
            if (requiresCommitMessageForEntries(entries)) {
                commitMessage = await promptCommitMessage(targetPaths[0] || "");
                if (commitMessage === null) {
                    return;
                }
            }
            createOperationQueueItem("delete", entries, "", commitMessage, {
                repoDelete: Boolean(settings.repoDelete),
            });
            processOperationQueue().catch(alertError);
        }

        async function toggleFolderExpansion(entry) {
            if (!entry || entry.type !== "dir") {
                return;
            }
            const folderPath = normalizePath(entry.path, false);

            if (state.expandedFolders.has(folderPath)) {
                state.expandedFolders.delete(folderPath);
                renderList();
                scheduleListColumnVisibilityAfterTreeToggle();
                return;
            }

            await loadDirectory(folderPath);
            state.expandedFolders.add(folderPath);
            state.openingFolderPath = folderPath;
            renderList();
            scheduleListColumnVisibilityAfterTreeToggle();
        }

        async function toggleArchiveExpansion(entry) {
            if (!isArchiveEntry(entry)) {
                return;
            }
            const archivePath = normalizePath(entry.path, false);
            const virtualPath = normalizePath(entry.archive_virtual_path || "", false);
            if (!archivePath || !virtualPath) {
                return;
            }
            if (state.expandedFolders.has(archivePath)) {
                state.expandedFolders.delete(archivePath);
                renderList();
                scheduleListColumnVisibilityAfterTreeToggle();
                return;
            }
            await loadDirectory(virtualPath);
            state.expandedFolders.add(archivePath);
            state.openingFolderPath = archivePath;
            renderList();
            scheduleListColumnVisibilityAfterTreeToggle();
        }

        function openEntry(entry) {
            if (!entry) {
                return;
            }
            if (isArchiveEntry(entry)) {
                setArchiveExtractModalOpen(true, entry);
                return;
            }
            if (isArchiveMemberEntry(entry)) {
                if (entry.type === "dir") {
                    toggleFolderExpansion(entry).catch(alertError);
                }
                return;
            }
            if (entry.type === "dir") {
                if (entry.is_map_folder) {
                    const targetUrl = (mapViewerBaseUrl || "/handrive/map-viewer/") + (entry.path || "");
                    window.location.href = appendSharedQuery(targetUrl);
                    return;
                }
                navigateToDirectory(entry.path).catch(alertError);
                return;
            }
            window.location.href = buildViewUrl(handriveBaseUrl, entry.slug_path || entry.path);
        }

        function openEntriesInNewTabs(entries) {
            if (!Array.isArray(entries) || entries.length === 0) {
                return;
            }
            entries.forEach(function (entry) {
                const targetUrl = entry.type === "dir"
                    ? buildListUrl(handriveBaseUrl, entry.path, handriveRootUrl)
                    : buildViewUrl(handriveBaseUrl, entry.slug_path || entry.path);
                window.open(targetUrl, "_blank", "noopener");
            });
        }

        function buildDownloadUrl(pathValue) {
            if (!downloadApiUrl) {
                return "";
            }
            const query = new URLSearchParams({ path: pathValue || "" }).toString();
            return appendSharedQuery(query ? downloadApiUrl + "?" + query : downloadApiUrl);
        }

        function buildScopedHomeDownloadUrl(pathValue) {
            return appendQueryParam(buildDownloadUrl(pathValue), "scope_home", "1");
        }

        function triggerDownload(targetUrl) {
            if (!targetUrl) {
                return;
            }
            const anchor = document.createElement("a");
            anchor.href = targetUrl;
            anchor.setAttribute("download", "");
            anchor.style.display = "none";
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
        }

        function downloadEntries(entries) {
            if (!Array.isArray(entries) || entries.length === 0 || !downloadApiUrl) {
                return;
            }
            const fileEntries = entries.filter(function (entry) {
                return Boolean(entry) && entry.type === "file" && !entry.isCurrentFolder;
            });
            fileEntries.forEach(function (entry) {
                const targetUrl = buildDownloadUrl(entry.path);
                if (!targetUrl) {
                    return;
                }
                triggerDownload(targetUrl);
            });
        }

        function editEntry(entry) {
            if (!entry) {
                return;
            }
            if (entry.type === "dir") {
                window.location.href = buildWriteUrl(writeUrl, { dir: entry.path });
                return;
            }
            if (!isEditableHandriveFileEntry(entry)) {
                return;
            }
            if (isImageEditorEntry(entry) || isVideoEditorEntry(entry) || isAudioEditorEntry(entry)) {
                switchToEditor(entry);
                return;
            }
            window.location.href = buildWriteUrl(writeUrl, { path: entry.path });
        }

        async function convertEntryToMp3(entry) {
            if (!entry || entry.type !== "file" || !entry.can_edit || !convertMp3ApiUrl) {
                return;
            }
            createOperationQueueItem("convert-mp3", [entry], getParentDirectory(entry.path), "");
            processOperationQueue().catch(alertError);
        }

        function syncSearchQueryFromInput(sourceInput) {
            const searchInput = getSearchInputForCurrentContext(sourceInput);
            const rawValue = String(searchInput && searchInput.value || "");
            state.searchQuery = rawValue.trim();
            syncSearchInputValues(rawValue, searchInput);
        }

        function setListLoading(isLoading) {
            if (listPane) {
                listPane.classList.toggle("is-loading", Boolean(isLoading));
            }
            if (listLoadingOverlay) {
                listLoadingOverlay.hidden = !isLoading;
            }
        }

        async function applyListSearch(sourceInput) {
            const preservePreview = Boolean(sourceInput && currentDirSearchInput && sourceInput === currentDirSearchInput);
            state.searchGeneration += 1;
            const generation = state.searchGeneration;
            setListLoading(true);
            try {
                syncSearchQueryFromInput(sourceInput);
                const query = String(state.searchQuery || "").trim();
                if (!query) {
                    if (generation === state.searchGeneration) {
                        state.searchResults = null;
                        renderList({ skipPreview: preservePreview });
                    }
                    return;
                }

                state.searchResults = [];
                renderList({ skipPreview: preservePreview });

                const params = new URLSearchParams({ path: state.currentDir, q: query });
                const data = await requestJson(appendSharedQuery(searchApiUrl + "?" + params.toString()));
                if (generation !== state.searchGeneration) {
                    return;
                }
                state.searchResults = data.entries || [];
                renderList({ skipPreview: preservePreview });
            } finally {
                if (generation === state.searchGeneration) {
                    setListLoading(false);
                }
            }
        }

        function addEntryNode(entry, fragment, ancestorHasNextSiblings, isLastSibling) {
            const item = document.createElement("li");
            item.className = "handrive-item";
            const openingFolderPath = state.openingFolderPath;
            if (
                openingFolderPath &&
                entry.path &&
                entry.path !== openingFolderPath &&
                entry.path.startsWith(openingFolderPath + "/")
            ) {
                item.classList.add("is-entering");
                item.style.animationDelay = String(Math.min(140, state.openingAnimationOrder * 14)) + "ms";
                state.openingAnimationOrder += 1;
            }

            const row = document.createElement("button");
            row.type = "button";
            row.className = "handrive-item-row has-tree-prefix";
            row.setAttribute("data-entry-path", entry.path);
            state.entryRowByPath.set(entry.path, row);
            const isPublicWriteFile = Boolean(entry.type === "file" && entry.is_public_write);
            row.draggable = Boolean((moveApiUrl || archiveExtractApiUrl) && (entry.can_edit || entry.can_delete || (entry.is_archive_member && entry.can_extract)) && !isPublicWriteFile);
            if (state.selectedPaths.has(entry.path) || normalizePath(entry.path, true) === state.activePreviewPath) {
                row.classList.add("is-selected");
            }

            const treePrefix = buildTreePrefixElement(ancestorHasNextSiblings, Boolean(isLastSibling));

            const fileIconKey = entry.type === "file" ? getFileIconKey(entry.path) : "";
            const typeMarker = createTypeMarker({
                isDir: entry.type === "dir",
                isRepo: entry.type === "dir" && entry.git_repo,
                isBranch: entry.type === "dir" && entry.git_branch_root,
                isMap: entry.type === "dir" && entry.is_map_folder,
                isEmpty: entry.type === "dir" && entry.has_children === false,
                fileIconKey: fileIconKey,
                isGenericFileIcon: entry.type === "file" && isGenericFileIconKey(fileIconKey),
                customIconUrl: (entry.type === "dir" && entry.folder_icon_url) ? entry.folder_icon_url : "",
            });

            row.appendChild(typeMarker);
            const nameWrap = document.createElement("span");
            nameWrap.className = "handrive-item-name-wrap";
            const name = document.createElement("span");
            name.className = "handrive-item-name";
            name.textContent = entry.name;
            nameWrap.appendChild(name);
            row.appendChild(nameWrap);
            appendEntryMetaColumns(row, entry);

            row.addEventListener("click", function (event) {
                if (event.button !== 0) { return; }
                event.preventDefault();
                closeContextMenu();
                selectEntriesByRowClick(entry, event);
                if (event.detail >= 2) {
                    openEntry(entry);
                    return;
                }
                if (isArchiveEntry(entry)) {
                    if (event.detail === 1 && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
                        toggleArchiveExpansion(entry).catch(alertError);
                    }
                    return;
                }
                if (entry.type === "dir") {
                    if (event.detail === 1 && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
                        if (hasSharedContext() && entry.is_map_folder) {
                            openEntry(entry);
                            return;
                        }
                        toggleFolderExpansion(entry).catch(alertError);
                    }
                    return;
                }
            });

            row.addEventListener("dblclick", function (event) {
                if (event.button !== 0) { return; }
                event.preventDefault();
                event.stopPropagation();
                openEntry(entry);
            });

            row.addEventListener("contextmenu", function (event) {
                event.preventDefault();
                if (isArchiveMemberEntry(entry)) {
                    return;
                }
                openContextMenuForEntry(entry, event.clientX, event.clientY);
            });

            if (moveApiUrl) {
                row.addEventListener("dragstart", function (event) {
                    const draggingEntries = resolveDraggingEntriesFromRow(entry);
                    if (draggingEntries.length === 0) {
                        if (event.dataTransfer) {
                            event.dataTransfer.effectAllowed = "none";
                        }
                        event.preventDefault();
                        return;
                    }
                    state.draggingEntries = draggingEntries;
                    state.draggingRowPaths = new Set(
                        draggingEntries.map(function (item) {
                            return item.path;
                        })
                    );
                    row.classList.add("is-dragging");
                    clearDragOverTarget();
                    closeContextMenu();
                    if (event.dataTransfer) {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData(
                            "text/plain",
                            draggingEntries.map(function (item) {
                                return item.path;
                            }).join("\n")
                        );
                    }
                });

                row.addEventListener("dragend", function () {
                    row.classList.remove("is-dragging");
                    state.draggingEntries = [];
                    state.draggingRowPaths = new Set();
                    clearDragOverTarget();
                });
            }

            if (entry.type === "dir") {
                const canWriteChildren = Boolean(entry.can_write_children);
                if (canWriteChildren) {
                    bindDropTarget(row, entry.path);
                }
            } else {
                const parentDirPath = getParentDirectory(entry.path);
                const parentEntry = state.entryByPath.get(parentDirPath);
                const parentRow = state.entryRowByPath.get(parentDirPath);
                if (parentEntry && parentRow && parentEntry.type === "dir" && parentEntry.can_write_children) {
                    bindDropTarget(row, parentDirPath, {
                        highlightElement: parentRow,
                    });
                }
            }

            item.appendChild(treePrefix);
            item.appendChild(row);
            fragment.appendChild(item);
            state.entryByPath.set(entry.path, entry);
            state.visibleEntryPaths.push(entry.path);

            const expandsAsArchive = isArchiveEntry(entry) && state.expandedFolders.has(entry.path);
            const expandsAsDirectory = entry.type === "dir" && state.expandedFolders.has(entry.path);
            if (expandsAsArchive || expandsAsDirectory) {
                const childEntries = getSortedEntriesForRender(getCachedEntries(expandsAsArchive ? entry.archive_virtual_path : entry.path));
                const nextAncestorHasNextSiblings = (ancestorHasNextSiblings || []).slice();
                nextAncestorHasNextSiblings.push(!isLastSibling);
                childEntries.forEach(function (child, index) {
                    const childIsLast = index === childEntries.length - 1;
                    addEntryNode(child, fragment, nextAncestorHasNextSiblings, childIsLast);
                });
            }
        }

        function renderSearchResultItems(fragment, entries) {
            entries.forEach(function (entry) {
                addEntryNode(entry, fragment, [], true);
            });
        }

        function renderList(options) {
            const renderListOptions = options || {};
            if (!listContainer) {
                return;
            }
            const existingCurrentDirItem = listContainer.querySelector(".handrive-current-dir-item");
            const existingCurrentDirRow = existingCurrentDirItem
                ? existingCurrentDirItem.querySelector(".handrive-current-dir-row")
                : null;
            const savedCurrentDirPath = existingCurrentDirRow
                ? (existingCurrentDirRow.dataset.entryPath || null)
                : null;
            if (existingCurrentDirItem) {
                existingCurrentDirItem.remove();
            }
            listContainer.innerHTML = "";
            state.openingAnimationOrder = 0;
            state.entryByPath = new Map();
            state.entryRowByPath = new Map();
            state.visibleEntryPaths = [];
            const fragment = document.createDocumentFragment();
            const entries = state.searchQuery && Array.isArray(state.searchResults)
                ? state.searchResults
                : getCachedEntries(state.currentDir);
            const renderEntries = getSortedEntriesForRender(entries);
            const currentFolderEntryForReuse = buildCurrentDirectoryEntry();
            if (existingCurrentDirItem && savedCurrentDirPath === currentFolderEntryForReuse.path) {
                if (existingCurrentDirRow) {
                    existingCurrentDirRow.classList.toggle("is-selected",
                        state.selectedPaths.has(currentFolderEntryForReuse.path) ||
                        normalizePath(currentFolderEntryForReuse.path, true) === state.activePreviewPath
                    );
                    state.entryRowByPath.set(currentFolderEntryForReuse.path, existingCurrentDirRow);
                    ensureCurrentDirInlineSearch(existingCurrentDirRow);
                    bindCurrentDirSortControls(existingCurrentDirRow);
                }
                state.entryByPath.set(currentFolderEntryForReuse.path, currentFolderEntryForReuse);
                state.visibleEntryPaths.push(currentFolderEntryForReuse.path);
                fragment.appendChild(existingCurrentDirItem);
            } else {
                addCurrentDirectoryNode(fragment);
            }

            if (renderEntries.length === 0) {
                const emptyItem = document.createElement("li");
                emptyItem.className = "handrive-item";
                const emptyRow = document.createElement("div");
                emptyRow.className = "handrive-item-row is-empty";
                emptyRow.textContent = state.searchQuery
                    ? t("js_search_no_results", "검색 결과가 없습니다.")
                    : t("js_empty_documents", "문서가 없습니다.");
                emptyItem.appendChild(emptyRow);
                fragment.appendChild(emptyItem);
                const filteredSelection = Array.from(state.selectedPaths).filter(function (pathValue) {
                    return state.entryByPath.has(pathValue);
                });
                state.selectedPaths = new Set(filteredSelection);
                state.selectedPath = state.selectedPaths.has(state.selectedPath) ? state.selectedPath : (filteredSelection[0] || "");
                state.selectionAnchorPath = state.selectedPaths.has(state.selectionAnchorPath)
                    ? state.selectionAnchorPath
                    : (state.selectedPath || "");
                listContainer.appendChild(fragment);
                syncCurrentDirInlineSearchVisibility(Boolean(listSearchForm && listSearchForm.classList.contains("is-search-hidden")));
                updateListColumnVisibility();
                scheduleListBodyHeight();
                if (!renderListOptions.skipPreview) { syncPreviewFromSelection(); }
                state.openingFolderPath = "";
                return;
            }
            if (state.searchQuery) {
                renderSearchResultItems(fragment, renderEntries);
            } else {
                renderEntries.forEach(function (entry, index) {
                    const isLastRootEntry = index === renderEntries.length - 1;
                    addEntryNode(entry, fragment, [], isLastRootEntry);
                });
            }
            const filteredSelection = Array.from(state.selectedPaths).filter(function (pathValue) {
                return state.entryByPath.has(pathValue);
            });
            state.selectedPaths = new Set(filteredSelection);
            state.selectedPath = state.selectedPaths.has(state.selectedPath) ? state.selectedPath : (filteredSelection[0] || "");
            state.selectionAnchorPath = state.selectedPaths.has(state.selectionAnchorPath)
                ? state.selectionAnchorPath
                : (state.selectedPath || "");
            listContainer.appendChild(fragment);
            syncCurrentDirInlineSearchVisibility(Boolean(listSearchForm && listSearchForm.classList.contains("is-search-hidden")));
            updateListColumnVisibility();
            scheduleListBodyHeight();
            if (!renderListOptions.skipPreview) { syncPreviewFromSelection(); }
            scheduleSyncCurrentDirRowHeightWithSideHead();
            state.openingFolderPath = "";
        }

        function openContextMenuForEntry(entry, x, y) {
            if (!entry) {
                return;
            }
            if (!state.selectedPaths.has(entry.path)) {
                applySelection([entry.path], {
                    primaryPath: entry.path,
                    anchorPath: entry.path,
                    skipPreview: true,
                });
            }
            openContextMenuAt(entry, x, y);
        }

        function bindHandrivePathDropTargets() {
            if (!moveApiUrl) {
                return;
            }
            const pathTargets = document.querySelectorAll(".ui-path-link[data-handrive-dir], .ui-path-current[data-handrive-dir]");
            pathTargets.forEach(function (target) {
                const targetDirPath = normalizePath(target.getAttribute("data-handrive-dir") || "", true);
                bindDropTarget(target, targetDirPath);
            });
        }

        if (contextMenu) {
            contextMenu.addEventListener("click", function (event) {
                const button = event.target.closest("button[data-action]");
                if (!button) {
                    return;
                }

                const action = button.dataset.action;
                const uploadQueueItem = state.uploadQueueContextItem;
                if (uploadQueueItem) {
                    closeContextMenu();
                    if (action === "open") {
                        if (uploadQueueItem.status === "uploading" || uploadQueueItem.status === "queued") {
                            cancelUploadQueueItem(uploadQueueItem);
                            return;
                        }
                        if (uploadQueueItem.kind === "operation") {
                            if (
                                uploadQueueItem.operationType !== "delete" &&
                                (uploadQueueItem.savedPath || uploadQueueItem.targetDirPath)
                            ) {
                                navigateToDirectory(
                                    getParentDirectory(uploadQueueItem.savedPath || "") || uploadQueueItem.targetDirPath
                                ).catch(alertError);
                            }
                            return;
                        }
                        if (uploadQueueItem.savedPath || uploadQueueItem.savedSlugPath) {
                            window.location.href = buildViewUrl(
                                handriveBaseUrl,
                                uploadQueueItem.savedSlugPath || uploadQueueItem.savedPath
                            );
                        }
                        return;
                    }
                    if (action === "delete") {
                        deleteUploadedQueueItem(uploadQueueItem).catch(alertError);
                        return;
                    }
                    return;
                }

                if (!state.contextTarget) {
                    return;
                }

                const entry = state.contextTarget;
                const entries = state.contextEntries.length > 0
                    ? state.contextEntries.slice()
                    : [entry];
                closeContextMenu();

                if (action === "open") {
                    if (entries.length > 1) {
                        openEntriesInNewTabs(entries);
                    } else {
                        openEntry(entry);
                    }
                    return;
                }
                if (action === "download") {
                    downloadEntries(entries);
                    return;
                }
                if (action === "extract-archive") {
                    if (isArchiveEntry(entry)) {
                        setArchiveExtractModalOpen(true, entry);
                    }
                    return;
                }
                if (action === "share") {
                    if (!entry || entry.isCurrentFolder || !entry.can_edit || !urlShareApiUrl) {
                        return;
                    }
                    function resolveShareUrl(rawUrl) {
                        return rawUrl || "";
                    }
                    urlShareModal.open({
                        isUrlOnly: Boolean(entry.is_url_only),
                        shareUrl: resolveShareUrl(entry.share_url),
                        readOnly: Boolean(entry.share_is_inherited),
                        onToggle: async function (enabled) {
                            const data = await requestJson(
                                appendSharedQuery(urlShareApiUrl),
                                buildPostOptions({ path: entry.path, enabled: enabled })
                            );
                            await refreshCurrentDirectory();
                            return { isUrlOnly: Boolean(data.is_url_only), shareUrl: resolveShareUrl(data.share_url) };
                        },
                    });
                    return;
                }
                if (action === "upload") {
                    openContextUploadPicker(entry);
                    return;
                }
                if (action === "create-archive") {
                    createArchiveFromFolder(entry);
                    return;
                }
                if (action === "rename") {
                    renameEntry(entry);
                    return;
                }
                if (action === "permissions") {
                    openPermissionModal(entries.length > 1 ? entries : entry).catch(alertError);
                    return;
                }
                if (action === "edit") {
                    editEntry(entry);
                    return;
                }
                if (action === "new-folder") {
                    setFolderCreateModalOpen(true, entry);
                    return;
                }
                if (action === "new-doc") {
                    newDocumentInFolder(entry);
                    return;
                }
                if (action === "delete") {
                    deleteEntries(entries.length > 1 ? entries : entry).catch(alertError);
                }
                if (action === "create-map") {
                    openMapCreateModal(entry);
                }
                if (action === "convert-mp3") {
                    convertEntryToMp3(entry).catch(alertError);
                }
                if (action === "git-create-repo") {
                    openGitRepoModal(entry);
                }
                if (action === "git-manage-repo") {
                    openGitRepoModal(entry);
                }
                if (action === "git-delete-repo") {
                    deleteEntries(entry, { repoDelete: true }).catch(alertError);
                }
                if (action === "git-create-branch") {
                    openBranchCreateModal(entry);
                }
                if (action === "git-delete-branch") {
                    deleteBranch(entry).catch(alertError);
                }
                if (action === "change-icon") {
                    if (entry && entry.type === "dir") {
                        window.requestAnimationFrame(function () {
                            setFolderIconModalOpen(true, entry);
                        });
                    }
                    return;
                }
            });
        }

        if (contextUploadInput) {
            contextUploadInput.addEventListener("change", function () {
                const targetDirPath = normalizePath(state.pendingContextUploadDir || "", true);
                state.pendingContextUploadDir = "";
                if (!contextUploadInput.files || contextUploadInput.files.length === 0) {
                    contextUploadInput.value = "";
                    return;
                }
                enqueueUploadFiles(contextUploadInput.files, targetDirPath).catch(alertError);
                contextUploadInput.value = "";
            });
        }

        if (folderIconFileInput) {
            folderIconFileInput.addEventListener("change", function () {
                if (!folderIconFileInput.files || folderIconFileInput.files.length === 0) {
                    if (folderIconPreviewWrap) { folderIconPreviewWrap.hidden = true; }
                    return;
                }
                if (folderIconPreviewImg) { folderIconPreviewImg.src = URL.createObjectURL(folderIconFileInput.files[0]); }
                if (folderIconPreviewWrap) { folderIconPreviewWrap.hidden = false; }
            });
        }

        if (folderIconModalBackdrop) {
            folderIconModalBackdrop.addEventListener("click", function () { setFolderIconModalOpen(false); });
        }

        if (folderIconCancelButton) {
            folderIconCancelButton.addEventListener("click", function () { setFolderIconModalOpen(false); });
        }

        if (folderIconDeleteButton) {
            folderIconDeleteButton.addEventListener("click", function () {
                const entry = state.folderIconTargetEntry;
                if (!entry || !folderIconDeleteApiUrl) { return; }
                requestJson(folderIconDeleteApiUrl, buildPostOptions({ path: entry.path }))
                    .then(function () { setFolderIconModalOpen(false); return refreshCurrentDirectory(); })
                    .catch(alertError);
            });
        }

        if (folderIconConfirmButton) {
            folderIconConfirmButton.addEventListener("click", function () {
                const entry = state.folderIconTargetEntry;
                if (!entry || !folderIconUploadApiUrl) { return; }
                if (!folderIconFileInput || !folderIconFileInput.files || folderIconFileInput.files.length === 0) {
                    window.alert("이미지 파일을 선택해주세요.");
                    return;
                }
                const formData = new FormData();
                formData.append("path", entry.path);
                formData.append("icon", folderIconFileInput.files[0]);
                requestFormDataJson(folderIconUploadApiUrl, formData)
                    .then(function () { setFolderIconModalOpen(false); return refreshCurrentDirectory(); })
                    .catch(alertError);
            });
        }

        if (renameModalBackdrop) {
            renameModalBackdrop.addEventListener("click", function () {
                setRenameModalOpen(false);
            });
        }

        if (renameCancelButton) {
            renameCancelButton.addEventListener("click", function () {
                setRenameModalOpen(false);
            });
        }

        if (renameConfirmButton) {
            renameConfirmButton.addEventListener("click", function () {
                submitRename().catch(alertError);
            });
        }

        if (renameInput) {
            renameInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    submitRename().catch(alertError);
                }
            });
        }

        if (archiveExtractModalBackdrop) {
            archiveExtractModalBackdrop.addEventListener("click", function () {
                setArchiveExtractModalOpen(false);
            });
        }

        if (archiveExtractCancelButton) {
            archiveExtractCancelButton.addEventListener("click", function () {
                setArchiveExtractModalOpen(false);
            });
        }

        if (archiveExtractCurrentButton) {
            archiveExtractCurrentButton.addEventListener("click", function () {
                submitArchiveExtract("current").catch(alertError);
            });
        }

        if (archiveExtractFolderButton) {
            archiveExtractFolderButton.addEventListener("click", function () {
                submitArchiveExtract("folder").catch(alertError);
            });
        }

        if (folderCreateModalBackdrop) {
            folderCreateModalBackdrop.addEventListener("click", function () {
                setFolderCreateModalOpen(false);
            });
        }

        if (folderCreateCancelButton) {
            folderCreateCancelButton.addEventListener("click", function () {
                setFolderCreateModalOpen(false);
            });
        }

        if (folderCreateConfirmButton) {
            folderCreateConfirmButton.addEventListener("click", function () {
                submitFolderCreate().catch(alertError);
            });
        }

        if (folderCreateInput) {
            folderCreateInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    submitFolderCreate().catch(alertError);
                }
            });
        }

        // ── 브랜치 생성 모달 ──────────────────────────────────────────────
        var _branchCreateSourceEntry = null;

        function setBranchCreateModalOpen(isOpen, entry) {
            if (!branchCreateModal) { return; }
            if (isOpen) {
                _branchCreateSourceEntry = entry || null;
                if (branchCreateTarget) {
                    branchCreateTarget.textContent = entry ? entry.name : "";
                }
                if (branchCreateInput) {
                    branchCreateInput.value = "";
                }
                branchCreateModal.hidden = false;
                syncModalBodyState();
                if (branchCreateInput) {
                    branchCreateInput.focus();
                }
            } else {
                _branchCreateSourceEntry = null;
                branchCreateModal.hidden = true;
                syncModalBodyState();
            }
        }

        function openBranchCreateModal(entry) {
            setBranchCreateModalOpen(true, entry);
        }

        async function submitBranchCreate() {
            if (!_branchCreateSourceEntry) { return; }
            const entry = _branchCreateSourceEntry;
            const repoId = entry.git_repo_id;
            const sourceBranch = entry.git_repo_branch;
            const newBranch = (branchCreateInput ? branchCreateInput.value : "").trim();
            if (!newBranch) {
                if (branchCreateInput) { branchCreateInput.focus(); }
                return;
            }
            if (!repoId || !sourceBranch) {
                alertError(new Error("브랜치 정보를 확인할 수 없습니다."));
                return;
            }
            setBranchCreateModalOpen(false);
            const apiUrl = "/api/git/repos/" + repoId + "/branches/";
            try {
                await requestJson(apiUrl, buildPostOptions({ source_branch: sourceBranch, new_branch: newBranch }));
                await loadDirectory(state.currentDir);
            } catch (err) {
                alertError(err);
            }
        }

        if (branchCreateModalBackdrop) {
            branchCreateModalBackdrop.addEventListener("click", function () {
                setBranchCreateModalOpen(false);
            });
        }

        if (branchCreateCancelButton) {
            branchCreateCancelButton.addEventListener("click", function () {
                setBranchCreateModalOpen(false);
            });
        }

        if (branchCreateConfirmButton) {
            branchCreateConfirmButton.addEventListener("click", function () {
                submitBranchCreate().catch(alertError);
            });
        }

        if (branchCreateInput) {
            branchCreateInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    submitBranchCreate().catch(alertError);
                }
            });
        }

        async function deleteBranch(entry) {
            const repoId = entry.git_repo_id;
            const branch = entry.git_repo_branch;
            if (!repoId || !branch) { return; }
            const confirmed = await requestConfirmDialog({
                title: "브랜치 삭제",
                message: "\"" + branch + "\" 브랜치를 삭제할까요?\n삭제된 브랜치는 복구할 수 없습니다.",
                cancelText: t("cancel", "취소"),
                confirmText: "삭제",
            });
            if (!confirmed) { return; }
            const apiUrl = "/api/git/repos/" + repoId + "/branches/delete/";
            await requestJson(apiUrl, Object.assign(buildPostOptions({ branch: branch }), { method: "DELETE" }));
            await loadDirectory(state.currentDir);
        }

        // ── Git 리포지토리 생성 모달 ──────────────────────────────────────
        var _gitRepoPollingTimer = null;
        var _gitRepoCurrentId = null;
        const gitRepoFlowState = {
            get currentId() {
                return _gitRepoCurrentId;
            },
            set currentId(value) {
                _gitRepoCurrentId = value;
            },
            get timer() {
                return _gitRepoPollingTimer;
            },
            set timer(value) {
                _gitRepoPollingTimer = value;
            },
        };

        function _gitRepoStopPolling() {
            gitRepoFlowStopPolling(gitRepoFlowState);
        }

        // manageMode=true: 기존 repo 조회 목적 (생성 폼 표시 안 함)
        function openGitRepoModal(entry, manageMode) {
            gitRepoFlowOpenModal({
                entry: entry,
                gitRepoForm: gitRepoForm,
                gitRepoModal: gitRepoModal,
                gitRepoNameInput: gitRepoNameInput,
                gitRepoTitle: gitRepoTitle,
                manageMode: manageMode,
                requestJson: requestJson,
                resetModalUi: function (nextEntry, isManageMode) {
                    if (!gitRepoModal) {
                        return;
                    }
                    gitRepoResetModalUi({
                        gitRepoForm: gitRepoForm,
                        gitRepoStatusDiv: gitRepoStatusDiv,
                        gitRepoNameInput: gitRepoNameInput,
                        gitRepoTarget: gitRepoTarget,
                        gitRepoTitle: gitRepoTitle,
                        gitRepoModal: gitRepoModal,
                        syncModalBodyState: syncModalBodyState,
                        entry: nextEntry,
                        isManageMode: isManageMode,
                        t: t,
                    });
                },
                showStatus: _showGitRepoStatus,
                startPolling: function () {
                    gitRepoFlowStartPolling({
                        intervalMs: 2000,
                        pollStatus: function () {
                            return _pollGitRepoStatus(gitRepoFlowState.currentId);
                        },
                        showStatus: _showGitRepoStatus,
                        state: gitRepoFlowState,
                        t: t,
                    });
                },
                state: gitRepoFlowState,
                stopPolling: _gitRepoStopPolling,
                t: t,
            }).catch(function () {});
        }

        function closeGitRepoModal() {
            _gitRepoStopPolling();
            gitRepoCloseModalUi({
                gitRepoModal: gitRepoModal,
                syncModalBodyState: syncModalBodyState,
            });
        }

        function _showGitRepoStatus(msg, showRetry, cloneUrl, webUrl) {
            gitRepoShowStatusUi({
                gitRepoForm: gitRepoForm,
                gitRepoStatusDiv: gitRepoStatusDiv,
                gitRepoStatusMsg: gitRepoStatusMsg,
                gitRepoRetryButton: gitRepoRetryButton,
                gitRepoCloneInfo: gitRepoCloneInfo,
                gitRepoCloneUrlInput: gitRepoCloneUrlInput,
                gitRepoOpenButton: gitRepoOpenButton,
                msg: msg,
                showRetry: showRetry,
                cloneUrl: cloneUrl,
                webUrl: webUrl,
            });
        }

        async function _pollGitRepoStatus(repoId) {
            gitRepoFlowState.currentId = repoId;
            await gitRepoFlowPollStatus({
                buildListUrl: buildListUrl,
                currentDir: state.currentDir,
                getParentDirectory: getParentDirectory,
                gitRepoModal: gitRepoModal,
                gitRepoTitle: gitRepoTitle,
                handriveBaseUrl: handriveBaseUrl,
                handriveRootUrl: handriveRootUrl,
                normalizePath: normalizePath,
                onCurrentDirRepoActivate: function (activeRepoId) {
                    currentDirGitRepo = { id: activeRepoId, status: "active" };
                },
                refreshCurrentDirectory: refreshCurrentDirectory,
                requestJson: requestJson,
                showStatus: _showGitRepoStatus,
                state: gitRepoFlowState,
                t: t,
            });
        }

        async function submitGitRepoCreate() {
            await gitRepoFlowSubmitCreate({
                buildPostOptions: buildPostOptions,
                gitRepoModal: gitRepoModal,
                gitRepoNameInput: gitRepoNameInput,
                requestJson: requestJson,
                showStatus: _showGitRepoStatus,
                startPolling: function () {
                    gitRepoFlowStartPolling({
                        intervalMs: 2000,
                        pollStatus: function () {
                            return _pollGitRepoStatus(gitRepoFlowState.currentId);
                        },
                        showStatus: _showGitRepoStatus,
                        state: gitRepoFlowState,
                        t: t,
                    });
                },
                state: gitRepoFlowState,
                t: t,
            });
        }

        async function retryGitRepo() {
            await gitRepoFlowRetryCreate({
                buildPostOptions: buildPostOptions,
                requestJson: requestJson,
                showStatus: _showGitRepoStatus,
                startPolling: function () {
                    gitRepoFlowStartPolling({
                        intervalMs: 2000,
                        pollStatus: function () {
                            return _pollGitRepoStatus(gitRepoFlowState.currentId);
                        },
                        showStatus: _showGitRepoStatus,
                        state: gitRepoFlowState,
                        t: t,
                    });
                },
                state: gitRepoFlowState,
                t: t,
            });
        }

        if (gitRepoModalBackdrop) {
            gitRepoModalBackdrop.addEventListener("click", closeGitRepoModal);
        }
        if (gitRepoCancelButton) {
            gitRepoCancelButton.addEventListener("click", closeGitRepoModal);
        }
        if (gitRepoCloseButton) {
            gitRepoCloseButton.addEventListener("click", closeGitRepoModal);
        }
        if (gitRepoCopyButton) {
            gitRepoCopyButton.addEventListener("click", function () {
                var url = gitRepoCloneUrlInput ? gitRepoCloneUrlInput.value : "";
                if (!url) return;
                navigator.clipboard.writeText(url).then(function () {
                    gitRepoCopyButton.textContent = t("git_repo_copied_button", "복사됨!");
                    setTimeout(function () {
                        gitRepoCopyButton.textContent = t("git_repo_copy_button", "복사");
                    }, 1500);
                }).catch(function () {
                    if (gitRepoCloneUrlInput) {
                        gitRepoCloneUrlInput.select();
                        document.execCommand("copy");
                    }
                });
            });
        }
        if (gitRepoConfirmButton) {
            gitRepoConfirmButton.addEventListener("click", function () {
                submitGitRepoCreate().catch(alertError);
            });
        }
        if (gitRepoNameInput) {
            gitRepoNameInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    submitGitRepoCreate().catch(alertError);
                }
            });
        }
        if (gitRepoRetryButton) {
            gitRepoRetryButton.addEventListener("click", function () {
                retryGitRepo().catch(alertError);
            });
        }
        // ─────────────────────────────────────────────────────────────────

        // 지도 생성 모달
        let _mapCreateTargetEntry = null;

        function openMapCreateModal(entry) {
            if (!window.HandriveMapFlowHelpers) { return; }
            _mapCreateTargetEntry = entry;
            HandriveMapFlowHelpers.openMapCreateModal({
                modal: mapCreateModal,
                input: mapCreateInput,
                target: mapCreateTarget,
                entry: entry,
                syncModalBodyState: syncModalBodyState,
            });
        }

        function closeMapCreateModal() {
            if (!window.HandriveMapFlowHelpers) { return; }
            HandriveMapFlowHelpers.closeMapCreateModal({
                modal: mapCreateModal,
                syncModalBodyState: syncModalBodyState,
            });
        }

        function submitMapCreate() {
            if (!window.HandriveMapFlowHelpers) { return; }
            HandriveMapFlowHelpers.submitMapCreate({
                entry: _mapCreateTargetEntry,
                input: mapCreateInput,
                mapCreateApiUrl: mapCreateApiUrl,
                mapEditorBaseUrl: mapEditorBaseUrl,
                requestJson: requestJson,
                buildPostOptions: buildPostOptions,
                onClose: closeMapCreateModal,
                onError: alertError,
            });
        }

        if (mapCreateModalBackdrop) {
            mapCreateModalBackdrop.addEventListener("click", closeMapCreateModal);
        }
        if (mapCreateCancelButton) {
            mapCreateCancelButton.addEventListener("click", closeMapCreateModal);
        }
        if (mapCreateConfirmButton) {
            mapCreateConfirmButton.addEventListener("click", submitMapCreate);
        }
        if (mapCreateInput) {
            mapCreateInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    submitMapCreate();
                }
            });
        }
        // ─────────────────────────────────────────────────────────────────

        if (permissionModalBackdrop) {
            permissionModalBackdrop.addEventListener("click", function () {
                setPermissionModalOpen(false);
            });
        }

        if (permissionCancelButton) {
            permissionCancelButton.addEventListener("click", function () {
                setPermissionModalOpen(false);
            });
        }

        if (permissionSaveButton) {
            permissionSaveButton.addEventListener("click", function () {
                submitPermissionSettings().catch(function (error) {
                    window.alert(
                        error && error.message
                            ? error.message
                            : t("js_permission_save_failed", "권한 저장 중 오류가 발생했습니다.")
                    );
                });
            });
        }

        if (previewDeleteButton) {
            previewDeleteButton.addEventListener("click", function () {
                const selectedEntries = getSelectedEntries();
                if (selectedEntries.length !== 1) {
                    return;
                }
                const selectedEntry = selectedEntries[0];
                if (!isPreviewableFileEntry(selectedEntry) || !selectedEntry.can_edit) {
                    return;
                }
                deleteEntries(selectedEntry).catch(alertError);
            });
        }

        if (previewZoomOutButton) {
            previewZoomOutButton.addEventListener("click", function () {
                setPreviewImageZoom(state.previewImageZoom - 0.25);
            });
        }

        if (previewZoomInButton) {
            previewZoomInButton.addEventListener("click", function () {
                setPreviewImageZoom(state.previewImageZoom + 0.25);
            });
        }

        if (previewContent) {
            previewContent.addEventListener("click", openClickedImagePictureInPicture);

            let listPreviewFontSize = 16;
            previewContent.addEventListener("wheel", function (event) {
                if (!event.ctrlKey && !event.metaKey) return;
                if (previewContent.classList.contains("handrive-media")) {
                    event.preventDefault();
                    const delta = event.deltaY < 0 ? 0.15 : -0.15;
                    setPreviewImageZoom(state.previewImageZoom + delta);
                    return;
                }
                event.preventDefault();
                const delta = event.deltaY < 0 ? 2 : -2;
                listPreviewFontSize = Math.max(8, Math.min(40, listPreviewFontSize + delta));
                previewContent.style.setProperty("--handrive-text-font-size", listPreviewFontSize + "px");
            }, { passive: false });
        }

        if (previewUrlShareButton) {
            previewUrlShareButton.addEventListener("click", function () {
                const selectedEntries = getSelectedEntries();
                const selectedEntry = selectedEntries.length === 1
                    ? selectedEntries[0]
                    : (state.activePreviewPath ? state.entryByPath.get(state.activePreviewPath) || null : null);
                if (!isPreviewableFileEntry(selectedEntry) || !selectedEntry.can_edit) {
                    return;
                }
                urlShareModal.open({
                    isUrlOnly: Boolean(selectedEntry.is_url_only),
                    shareUrl: selectedEntry.share_url || "",
                    readOnly: Boolean(selectedEntry.share_is_inherited),
                    onToggle: async function (enabled) {
                        const data = await requestJson(
                            appendSharedQuery(urlShareApiUrl),
                            buildPostOptions({ path: selectedEntry.path, enabled: enabled })
                        );
                        await refreshCurrentDirectory();
                        const refreshedEntry = state.entryByPath.get(selectedEntry.path);
                        if (refreshedEntry) {
                            await loadPreviewForEntry(refreshedEntry);
                            await updatePreviewNavButtons(refreshedEntry);
                        } else {
                            clearPreviewPane();
                        }
                        return { isUrlOnly: Boolean(data.is_url_only), shareUrl: data.share_url || "" };
                    },
                });
            });
        }

        if (listContainer) {
            listContainer.addEventListener("contextmenu", function (event) {
                if (event.defaultPrevented) {
                    return;
                }
                const targetElement = event.target instanceof Element ? event.target : null;
                if (!targetElement) {
                    return;
                }
                const row = targetElement.closest(".handrive-item-row");
                if (!row || !listContainer.contains(row)) {
                    return;
                }
                const entryPath = normalizePath(row.getAttribute("data-entry-path") || "", true);
                const entry = state.entryByPath.get(entryPath) || null;
                if (!entry) {
                    return;
                }
                event.preventDefault();
                openContextMenuForEntry(entry, event.clientX, event.clientY);
            });
        }

        if (!listMarkdownSnippetEventsBound && markdownSnippetMenu) {
            listMarkdownSnippetEventsBound = true;

            markdownSnippetButtons.forEach(function (button) {
                button.addEventListener("click", function () {
                    const snippetType = button.getAttribute("data-editor-snippet") || "";
                    insertListMarkdownSnippet(snippetType);
                    closeListMarkdownSnippetMenu();
                });
            });

            if (editorSurface) {
                editorSurface.addEventListener("contextmenu", function (event) {
                    if (editorPanel && editorPanel.hidden) {
                        return;
                    }
                    const currentExtension = resolveListEditorExtension() || ".md";
                    if (currentExtension !== ".md") {
                        closeListMarkdownSnippetMenu();
                        return;
                    }
                    const visibleCount = syncListSnippetMenuItemsByExtension(currentExtension);
                    if (visibleCount <= 0) {
                        closeListMarkdownSnippetMenu();
                        return;
                    }
                    event.preventDefault();
                    openListMarkdownSnippetMenu(event.clientX, event.clientY);
                });
            }
        }

        document.addEventListener("click", function (event) {
            if (!contextMenu || contextMenu.hidden) {
                return;
            }
            if (!contextMenu.contains(event.target)) {
                closeContextMenu();
            }
        });

        document.addEventListener("keydown", function (event) {
            const key = String(event.key || "");
            if (key === "Delete" || key === "Backspace") {
                if (
                    isKeyboardEditableTarget(event.target) ||
                    (contextMenu && !contextMenu.hidden) ||
                    hasOpenHandriveModal()
                ) {
                    return;
                }

                const selectedEntries = getSelectedEntries().filter(function (entry) {
                    return isEntryDeletable(entry);
                });
                if (selectedEntries.length === 0) {
                    if (key === "Backspace") {
                        event.preventDefault();
                    }
                    return;
                }

                event.preventDefault();
                deleteEntries(selectedEntries.length > 1 ? selectedEntries : selectedEntries[0]).catch(alertError);
                return;
            }

            if (key === "Escape") {
                if (folderCreateModal && !folderCreateModal.hidden) {
                    setFolderCreateModalOpen(false);
                    return;
                }
                if (archiveExtractModal && !archiveExtractModal.hidden) {
                    setArchiveExtractModalOpen(false);
                    return;
                }
                if (renameModal && !renameModal.hidden) {
                    setRenameModalOpen(false);
                    return;
                }
                if (permissionModal && !permissionModal.hidden) {
                    setPermissionModalOpen(false);
                    return;
                }
                if (markdownSnippetMenu && !markdownSnippetMenu.hidden) {
                    closeListMarkdownSnippetMenu();
                    return;
                }
                if (syncModal && !syncModal.hidden) {
                    setSyncModalOpen(false);
                    return;
                }
                if (folderIconModal && !folderIconModal.hidden) {
                    setFolderIconModalOpen(false);
                    return;
                }
                closeContextMenu();
            }
        });

        document.addEventListener("mousedown", function (event) {
            if (!markdownSnippetMenu || markdownSnippetMenu.hidden) {
                return;
            }
            if (event.target instanceof Element && markdownSnippetMenu.contains(event.target)) {
                return;
            }
            closeListMarkdownSnippetMenu();
        });

        if (listPane && uploadApiUrl) {
            listPane.addEventListener("dragenter", function (event) {
                if (!isFileTransfer(event)) {
                    return;
                }
                if (isInsideCurrentFileDropGroup(event.target)) {
                    event.preventDefault();
                    return;
                }
                const currentDirRow = getCurrentDirectoryDropRow();
                if (currentDirRow && isBareListFileDropTarget(event.target)) {
                    activateFileDropTarget(event, state.currentDir, currentDirRow);
                    return;
                }
                clearFileDragUiState();
            });

            listPane.addEventListener("dragover", function (event) {
                if (!isFileTransfer(event)) {
                    return;
                }
                if (!isInsideCurrentFileDropGroup(event.target)) {
                    const currentDirRow = getCurrentDirectoryDropRow();
                    if (currentDirRow && isBareListFileDropTarget(event.target)) {
                        activateFileDropTarget(event, state.currentDir, currentDirRow);
                        return;
                    }
                    clearFileDragUiState();
                    return;
                }
                event.preventDefault();
                if (event.dataTransfer) {
                    event.dataTransfer.dropEffect = "copy";
                }
            });

            listPane.addEventListener("dragleave", function (event) {
                if (!isFileTransfer(event)) {
                    return;
                }
                if (event.relatedTarget && listPane.contains(event.relatedTarget)) {
                    return;
                }
                clearFileDragUiState();
            });

            listPane.addEventListener("drop", function (event) {
                if (!isFileTransfer(event)) {
                    return;
                }
                event.preventDefault();
                const targetDirPath = isInsideCurrentFileDropGroup(event.target) && state.fileDropGroupPath
                    ? state.fileDropGroupPath
                    : state.currentDir;
                clearFileDragUiState();
                enqueueUploadFiles(
                    event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files : [],
                    targetDirPath
                ).catch(alertError);
            });
        }

        document.addEventListener("drop", function () {
            clearFileDragUiState();
        });

        document.addEventListener("dragend", function () {
            clearFileDragUiState();
        });

        document.addEventListener("paste", function (event) {
            if (!uploadApiUrl || shouldIgnorePasteUploadTarget()) {
                return;
            }
            const clipboardData = event.clipboardData;
            if (!clipboardData) {
                return;
            }

            const files = [];
            if (clipboardData.files && clipboardData.files.length > 0) {
                Array.from(clipboardData.files).forEach(function (file) {
                    if (file) {
                        files.push(file);
                    }
                });
            } else if (clipboardData.items && clipboardData.items.length > 0) {
                Array.from(clipboardData.items).forEach(function (item) {
                    if (!item || item.kind !== "file") {
                        return;
                    }
                    const file = item.getAsFile();
                    if (file) {
                        files.push(file);
                    }
                });
            }

            if (!files.length) {
                return;
            }

            event.preventDefault();
            var pasteTargetDir = state.currentDir;
            if (state.selectedPaths.size === 1) {
                var selectedEntries = getSelectedEntries();
                if (selectedEntries.length === 1 && selectedEntries[0].type === "dir") {
                    pasteTargetDir = normalizePath(selectedEntries[0].path, true);
                }
            }
            resolveClipboardUploadFilenames(files, pasteTargetDir)
                .then(function (resolvedFiles) {
                    if (!resolvedFiles || !resolvedFiles.length) {
                        return null;
                    }
                    return enqueueUploadFiles(resolvedFiles, pasteTargetDir);
                })
                .catch(alertError);
        });

        if (uploadQueueToggleButton) {
            uploadQueueToggleButton.addEventListener("click", function () {
                state.uploadQueueCollapsed = !state.uploadQueueCollapsed;
                renderUploadQueue();
            });
        }

        if (uploadQueueCloseButton) {
            uploadQueueCloseButton.addEventListener("click", function () {
                state.uploadQueueDismissed = true;
                renderUploadQueue();
            });
        }

        if (syncLaunchButton && syncModal) {
            syncLaunchButton.hidden = false;
            syncLaunchButton.addEventListener("click", function (event) {
                event.preventDefault();
                event.stopPropagation();
                setSyncModalOpen(true);
            });
        }

        if (syncModalBackdrop) {
            syncModalBackdrop.addEventListener("click", function () {
                setSyncModalOpen(false);
            });
        }

        if (syncCancelButton) {
            syncCancelButton.addEventListener("click", function () {
                setSyncModalOpen(false);
            });
        }

        if (syncSaveButton) {
            syncSaveButton.addEventListener("click", async function () {
                syncSaveButton.disabled = true;
                try {
                    await submitSyncSettings();
                } catch (error) {
                    alertError(error);
                } finally {
                    syncSaveButton.disabled = false;
                }
            });
        }

        window.addEventListener("scroll", closeContextMenu, { passive: true });
        window.addEventListener("resize", closeContextMenu, { passive: true });
        window.addEventListener("scroll", closeListMarkdownSnippetMenu, { passive: true });
        window.addEventListener("resize", closeListMarkdownSnippetMenu, { passive: true });
        window.addEventListener("resize", debouncedUpdateListLayoutMode, { passive: true });
        window.addEventListener("orientationchange", debouncedUpdateListLayoutMode, { passive: true });
        window.addEventListener("resize", updateListColumnVisibility, { passive: true });
        window.addEventListener("orientationchange", updateListColumnVisibility, { passive: true });
        window.addEventListener("resize", scheduleListBodyHeight, { passive: true });
        window.addEventListener("orientationchange", scheduleListBodyHeight, { passive: true });
        window.addEventListener("resize", schedulePreviewBodyHeight, { passive: true });
        window.addEventListener("orientationchange", schedulePreviewBodyHeight, { passive: true });
        window.addEventListener("resize", scheduleEditorBodyHeight, { passive: true });
        window.addEventListener("orientationchange", scheduleEditorBodyHeight, { passive: true });

        if (window.ResizeObserver && previewHead) {
            const previewHeadResizeObserver = new ResizeObserver(function () {
                scheduleSyncCurrentDirRowHeightWithSideHead();
            });
            previewHeadResizeObserver.observe(previewHead);
        }

        if (previewTitle) {
            const previewTitleText = previewTitle.querySelector(".handrive-list-preview-title-text");
            if (previewTitleText) {
                previewTitleText.addEventListener("dblclick", function () {
                    const entry = state.activePreviewPath
                        ? state.entryByPath.get(state.activePreviewPath) || null
                        : null;
                    if (entry) {
                        openEntry(entry);
                    }
                });
            }
        }

        if (window.ResizeObserver) {
            if (listPane) {
                const listPaneResizeObserver = new ResizeObserver(function () {
                    updateListColumnVisibility();
                    scheduleListBodyHeight();
                });
                listPaneResizeObserver.observe(listPane);
            }
            const toolbarWrap = document.querySelector(".handrive-toolbar-wrap");
            if (toolbarWrap) {
                const listToolbarResizeObserver = new ResizeObserver(function () {
                    scheduleListBodyHeight();
                    schedulePreviewBodyHeight();
                    scheduleEditorBodyHeight();
                });
                listToolbarResizeObserver.observe(toolbarWrap);
            }
            const footerLinks = document.querySelector(".site-footer-links");
            if (footerLinks) {
                const listFooterResizeObserver = new ResizeObserver(function () {
                    scheduleListBodyHeight();
                    schedulePreviewBodyHeight();
                    scheduleEditorBodyHeight();
                });
                listFooterResizeObserver.observe(footerLinks);
            }
        }

        if (listPane) {
            listPane.addEventListener("handrive:metacontentchange", function () {
                window.requestAnimationFrame(updateListColumnVisibility);
            });
            if (window.MutationObserver) {
                const metaMutationObserver = new MutationObserver(function (mutations) {
                    const hasMetaMutation = mutations.some(function (mutation) {
                        if (!(mutation.target instanceof Element)) {
                            return false;
                        }
                        if (mutation.target.closest(".handrive-item-permission, .handrive-item-commit, .handrive-item-id")) {
                            return true;
                        }
                        for (let index = 0; index < mutation.addedNodes.length; index += 1) {
                            const node = mutation.addedNodes[index];
                            if (node instanceof Element && node.closest(".handrive-item-permission, .handrive-item-commit, .handrive-item-id")) {
                                return true;
                            }
                        }
                        for (let index = 0; index < mutation.removedNodes.length; index += 1) {
                            const node = mutation.removedNodes[index];
                            if (node instanceof Element && (node.matches(".handrive-item-permission, .handrive-item-commit, .handrive-item-id") || node.querySelector(".handrive-item-permission, .handrive-item-commit, .handrive-item-id"))) {
                                return true;
                            }
                        }
                        return false;
                    });
                    if (hasMetaMutation) {
                        window.requestAnimationFrame(updateListColumnVisibility);
                    }
                });
                metaMutationObserver.observe(listPane, {
                    childList: true,
                    characterData: true,
                    subtree: true,
                });
            }
        }

        schedulePreviewBodyHeight();
        scheduleEditorBodyHeight();
        scheduleListBodyHeight();

        updateDirectoryHistory(state.currentDir, "replace");

        if (pathBreadcrumbs) {
            pathBreadcrumbs.addEventListener("click", function (event) {
                const link = event.target instanceof Element
                    ? event.target.closest("a.ui-path-link[data-handrive-dir]")
                    : null;
                if (!link) {
                    return;
                }
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                    return;
                }
                event.preventDefault();
                navigateToDirectory(link.getAttribute("data-handrive-dir") || "").catch(alertError);
            });
            renderPathBreadcrumbs(state.currentDir);
        } else {
            bindHandrivePathDropTargets();
        }

        window.addEventListener("popstate", function (event) {
            const historyState = event.state || {};
            if (!Object.prototype.hasOwnProperty.call(historyState, "handriveListDir")) {
                return;
            }
            navigateToDirectory(historyState.handriveListDir || "", {
                historyMode: "skip",
            }).catch(alertError);
        });

        if (listSearchForm && listSearchInput) {
            listSearchForm.addEventListener("submit", function (event) {
                event.preventDefault();
                event.stopPropagation();
                applyListSearch(listSearchInput).catch(alertError);
            });

            listSearchInput.addEventListener("input", function () {
                syncSearchInputValues(listSearchInput.value, listSearchInput);
            });

            listSearchInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    applyListSearch(listSearchInput).catch(alertError);
                }
            });
        }

        if (listSearchSubmitButton) {
            listSearchSubmitButton.addEventListener("click", function (event) {
                event.preventDefault();
                applyListSearch(listSearchInput).catch(alertError);
            });
        }

        if (listSearchClearButton && listSearchInput) {
            listSearchClearButton.addEventListener("click", function (event) {
                event.preventDefault();
                listSearchInput.value = "";
                syncSearchInputValues("", listSearchInput);
                applyListSearch(listSearchInput).catch(alertError);
                listSearchInput.focus();
            });
            updateSearchClearButtonVisibility();
        }
        
        // 초기화 시 약간의 지연 후 레이아웃 업데이트
        setTimeout(function() {
            updateListLayoutMode();
            updateListColumnVisibility();
        }, 100);
        
        clearPreviewPane();
        renderList();
        enqueuePendingYoutubeDownloaderSave();
        var initialSearchQuery = listSearchInput
            ? String(new URLSearchParams(window.location.search).get("q") || "").trim()
            : "";
        setListLoading(true);
        loadDirectory(state.currentDir)
            .then(function () {
                if (initialSearchQuery && listSearchInput) {
                    listSearchInput.value = initialSearchQuery;
                    syncSearchInputValues(initialSearchQuery, listSearchInput);
                    return applyListSearch();
                }
                renderList();
                return null;
            })
            .finally(function () {
                setListLoading(false);
            })
            .catch(alertError);
    }

    function initializeViewPage() {
        const handriveBaseUrl = root.dataset.handriveBaseUrl || "/handrive";
        const handriveRootUrl = root.dataset.handriveRootUrl || handriveBaseUrl;
        const deleteApiUrl = root.dataset.deleteApiUrl;
        const urlShareApiUrl = root.dataset.urlShareApiUrl;
        const listApiUrl = root.dataset.listApiUrl || "";
        const previewApiUrl = root.dataset.previewApiUrl || "";
        let currentDocPath = root.dataset.docPath || "";
        let currentDocSlugPath = root.dataset.docSlugPath || currentDocPath;
        const docIsUrlOnly = root.dataset.docIsUrlOnly === "1";
        const parentDir = root.dataset.parentDir || "";
        const deleteButton = document.getElementById("handrive-delete-btn");
        const urlShareButton = document.getElementById("handrive-url-share-btn");
        const contentArticle = document.querySelector(".handrive-content > article");
        const viewZoomWrap = document.getElementById("handrive-view-zoom");
        const viewZoomOutButton = document.getElementById("handrive-view-zoom-out");
        const viewZoomInButton = document.getElementById("handrive-view-zoom-in");
        const viewNavPrevBtn = document.getElementById("handrive-view-nav-prev");
        const viewNavNextBtn = document.getElementById("handrive-view-nav-next");
        const viewNavBg = document.getElementById("handrive-view-nav-bg");
        const viewNavBgPrev = viewNavBg ? viewNavBg.querySelector("span:first-child") : null;
        const viewNavBgNext = viewNavBg ? viewNavBg.querySelector("span:last-child") : null;
        let viewImageZoom = 1;

        const viewMediaNavExtensions = new Set([
            ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif", ".tiff", ".tif",
            ".mp4", ".webm", ".mov", ".mkv", ".m4v", ".ogv",
        ]);

        function isViewMediaNavEntry(entry) {
            return Boolean(entry && entry.type === "file" && viewMediaNavExtensions.has(getPathFileExtension(entry.name)));
        }

        function getViewImageElement() {
            return contentArticle
                ? contentArticle.querySelector(".handrive-media-image-element")
                : null;
        }

        function syncViewImageZoom() {
            const imageWrap = contentArticle
                ? contentArticle.querySelector(".handrive-media-image-wrap")
                : null;
            const hasImage = Boolean(imageWrap && contentArticle && contentArticle.classList.contains("handrive-media"));
            if (viewZoomWrap) {
                viewZoomWrap.hidden = !hasImage;
            }
            if (!hasImage || !imageWrap) {
                return;
            }
            imageWrap.style.transform = "scale(" + String(viewImageZoom) + ")";
            if (contentArticle) {
                contentArticle.scrollLeft = 0;
                contentArticle.scrollTop = 0;
            }
        }

        function getViewImageMinZoom() {
            const imageElement = getViewImageElement();
            if (!contentArticle || !imageElement) {
                return 0.5;
            }
            const naturalWidth = Number(imageElement.naturalWidth || imageElement.width || 0);
            const availableWidth = Math.max(1, contentArticle.clientWidth || 0);
            if (!naturalWidth) {
                return 0.5;
            }
            return Math.max(0.05, Math.min(0.1, availableWidth / naturalWidth));
        }

        function setViewImageZoom(nextZoom) {
            const minZoom = getViewImageMinZoom();
            viewImageZoom = Math.max(minZoom, Math.min(3, Number(nextZoom) || 1));
            syncViewImageZoom();
        }

        function setViewNavBackgroundVisible(visible) {
            if (!viewNavBg) return;
            viewNavBg.hidden = !visible;
            viewNavBg.classList.toggle("is-visible", Boolean(visible));
        }

        function bindViewNavButtonEffects(btn) {
            if (!btn || btn._viewNavFxBound) return;
            btn._viewNavFxBound = true;
            const clearPressed = function () {
                btn.classList.remove("is-pressed");
            };
            const clearHovered = function () {
                btn.classList.remove("is-hovered");
            };
            const playReveal = function () {
                if (btn.hidden) return;
                btn.classList.remove("is-revealing");
                void btn.offsetWidth;
                btn.classList.add("is-revealing");
                window.setTimeout(function () {
                    btn.classList.remove("is-revealing");
                }, 200);
            };

            btn.addEventListener("pointerenter", function () {
                btn.classList.add("is-hovered");
            });
            btn.addEventListener("pointerleave", function () {
                clearHovered();
                clearPressed();
            });
            btn.addEventListener("focus", function () {
                btn.classList.add("is-hovered");
            });
            btn.addEventListener("blur", function () {
                clearHovered();
                clearPressed();
            });
            btn.addEventListener("pointerdown", function (event) {
                if (event.button !== 0) return;
                btn.classList.add("is-pressed");
                playReveal();
            });
            btn.addEventListener("pointerup", clearPressed);
            btn.addEventListener("pointercancel", clearPressed);
            btn.addEventListener("click", playReveal);
        }

        function updateViewNavButtons(siblings, currentPath) {
            if (!viewNavPrevBtn || !viewNavNextBtn) return;
            const normalizedCurrent = normalizePath(currentPath, true);
            const idx = siblings.findIndex(function (e) {
                return normalizePath(e.path, true) === normalizedCurrent;
            });
            const prevEntry = idx > 0 ? siblings[idx - 1] : null;
            const nextEntry = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
            const wasPrevHidden = viewNavPrevBtn.hidden;
            const wasNextHidden = viewNavNextBtn.hidden;
            viewNavPrevBtn.hidden = !prevEntry;
            viewNavNextBtn.hidden = !nextEntry;
            viewNavPrevBtn._navTarget = prevEntry || null;
            viewNavNextBtn._navTarget = nextEntry || null;
            if (viewNavBgPrev) viewNavBgPrev.hidden = !prevEntry;
            if (viewNavBgNext) viewNavBgNext.hidden = !nextEntry;
            setViewNavBackgroundVisible(Boolean(prevEntry || nextEntry));
            if (wasPrevHidden && prevEntry) {
                bindViewNavButtonEffects(viewNavPrevBtn);
                viewNavPrevBtn.classList.remove("is-revealing");
                void viewNavPrevBtn.offsetWidth;
                viewNavPrevBtn.classList.add("is-revealing");
                window.setTimeout(function () {
                    viewNavPrevBtn.classList.remove("is-revealing");
                }, 180);
            }
            if (wasNextHidden && nextEntry) {
                bindViewNavButtonEffects(viewNavNextBtn);
                viewNavNextBtn.classList.remove("is-revealing");
                void viewNavNextBtn.offsetWidth;
                viewNavNextBtn.classList.add("is-revealing");
                window.setTimeout(function () {
                    viewNavNextBtn.classList.remove("is-revealing");
                }, 180);
            }
        }

        let viewNavSiblings = [];

        async function loadViewNavSiblings() {
            if (!listApiUrl || !contentArticle) return;
            try {
                const data = await requestJson(
                    appendSharedQuery(listApiUrl + "?path=" + encodeURIComponent(parentDir))
                );
                const entries = Array.isArray(data.entries) ? data.entries : [];
                viewNavSiblings = entries.filter(isViewMediaNavEntry);
                updateViewNavButtons(viewNavSiblings, currentDocPath);
            } catch (e) {}
        }

        async function navigateViewToEntry(entry) {
            if (!entry || !previewApiUrl || !contentArticle) return;
            try {
                const data = await requestJson(
                    appendSharedQuery(previewApiUrl),
                    buildPostOptions({ path: entry.path })
                );
                const newHtml = data.html || "";
                const newClass = data.render_class || "";

                contentArticle.className = newClass;
                contentArticle.innerHTML = newHtml;

                hydrateMediaAudioElements(contentArticle);

                viewImageZoom = 1;
                syncViewImageZoom();

                currentDocPath = entry.path;
                currentDocSlugPath = entry.slug_path || entry.path;

                const fileName = entry.name || "";
                const titleEl = document.querySelector(".handrive-toolbar-left .handrive-title");
                if (titleEl) titleEl.textContent = fileName;
                const pathCurrentEl = document.querySelector(".handrive-toolbar-left .ui-path-current");
                if (pathCurrentEl) pathCurrentEl.textContent = fileName;
                document.title = fileName;

                const newUrl = buildViewUrl(handriveBaseUrl, currentDocSlugPath);
                window.history.pushState({ handriveViewPath: currentDocPath }, "", newUrl);

                updateViewNavButtons(viewNavSiblings, currentDocPath);
            } catch (error) {
                alertError(error);
            }
        }

        if (viewNavPrevBtn) {
            bindViewNavButtonEffects(viewNavPrevBtn);
            viewNavPrevBtn.addEventListener("click", function () {
                navigateViewToEntry(viewNavPrevBtn._navTarget);
            });
        }
        if (viewNavNextBtn) {
            bindViewNavButtonEffects(viewNavNextBtn);
            viewNavNextBtn.addEventListener("click", function () {
                navigateViewToEntry(viewNavNextBtn._navTarget);
            });
        }

        if (contentArticle && contentArticle.classList.contains("handrive-js")) {
            applyHandriveCodeHighlighting(contentArticle, "handrive-js");
        } else if (contentArticle && contentArticle.classList.contains("handrive-css")) {
            applyHandriveCodeHighlighting(contentArticle, "handrive-css");
        } else if (contentArticle && contentArticle.classList.contains("handrive-json")) {
            applyHandriveCodeHighlighting(contentArticle, "handrive-json");
        } else if (contentArticle && contentArticle.classList.contains("handrive-py")) {
            applyHandriveCodeHighlighting(contentArticle, "handrive-py");
        } else if (contentArticle && contentArticle.classList.contains("ui-markdown")) {
            applyHandriveCodeHighlighting(contentArticle, "ui-markdown");
        }

        hydrateMediaAudioElements(contentArticle);

        viewImageZoom = 1;
        syncViewImageZoom();

        loadViewNavSiblings();

        if (viewZoomOutButton) {
            viewZoomOutButton.addEventListener("click", function () {
                setViewImageZoom(viewImageZoom - 0.25);
            });
        }

        if (viewZoomInButton) {
            viewZoomInButton.addEventListener("click", function () {
                setViewImageZoom(viewImageZoom + 0.25);
            });
        }

        if (contentArticle) {
            contentArticle.addEventListener("click", openClickedImagePictureInPicture);
        }

        const isTextArticle = contentArticle && !contentArticle.classList.contains("handrive-media");
        if (isTextArticle) {
            let viewTextFontSize = 16;
            contentArticle.addEventListener("wheel", function (event) {
                if (!event.ctrlKey && !event.metaKey) return;
                event.preventDefault();
                const delta = event.deltaY < 0 ? 2 : -2;
                viewTextFontSize = Math.max(8, Math.min(40, viewTextFontSize + delta));
                contentArticle.style.setProperty("--handrive-text-font-size", viewTextFontSize + "px");
            }, { passive: false });
        } else if (contentArticle && contentArticle.classList.contains("handrive-media")) {
            contentArticle.addEventListener("wheel", function (event) {
                if (!event.ctrlKey && !event.metaKey) return;
                event.preventDefault();
                const delta = event.deltaY < 0 ? 0.15 : -0.15;
                setViewImageZoom(viewImageZoom + delta);
            }, { passive: false });
        }

        if (urlShareButton && urlShareApiUrl && currentDocPath) {
            urlShareButton.addEventListener("click", function () {
                const initialShareUrl = root.dataset.docShareUrl || "";
                urlShareModal.open({
                    isUrlOnly: docIsUrlOnly,
                    shareUrl: initialShareUrl,
                    readOnly: root.dataset.docShareIsInherited === "1",
                    onToggle: async function (enabled) {
                        const data = await requestJson(
                            appendSharedQuery(urlShareApiUrl),
                            buildPostOptions({ path: currentDocPath, enabled: enabled })
                        );
                        if (!enabled) {
                            window.location.reload();
                        }
                        return { isUrlOnly: Boolean(data.is_url_only), shareUrl: data.share_url || "" };
                    },
                });
            });
        }

        if (!deleteButton) {
            return;
        }

        deleteButton.addEventListener("click", async function () {
            const confirmed = await requestConfirmDialog({
                title: t("delete_button", "삭제"),
                message: t("js_confirm_delete_doc", "이 문서를 삭제할까요?"),
                cancelText: t("cancel", "취소"),
                confirmText: t("delete_button", "삭제")
            });
            if (!confirmed) {
                return;
            }

            try {
                await requestJson(deleteApiUrl, buildPostOptions({ path: currentDocPath }));
                window.location.href = buildListUrl(handriveBaseUrl, parentDir, handriveRootUrl);
            } catch (error) {
                alertError(error);
            }
        });
    }

    function initializeWritePage() {
        const handriveBaseUrl = root.dataset.handriveBaseUrl || "/handrive";
        const handriveRootUrl = root.dataset.handriveRootUrl || handriveBaseUrl;
        const saveApiUrl = root.dataset.saveApiUrl;
        const renameApiUrl = root.dataset.renameApiUrl || "";
        const previewApiUrl = root.dataset.previewApiUrl;
        const listApiUrl = root.dataset.listApiUrl || "";
        const downloadApiUrl = root.dataset.downloadApiUrl || "";
        const imageEditorSaveUrl = root.dataset.imageEditorSaveUrl || "";
        const imageEditorRemoveBackgroundUrl = root.dataset.imageEditorRemoveBackgroundUrl || "";
        const audioEditorSaveUrl = root.dataset.audioEditorSaveUrl || "";
        const videoEditorSaveUrl = root.dataset.videoEditorSaveUrl || "";
        const markdownImageUploadApiUrl = root.dataset.markdownImageUploadApiUrl || "";
        const markdownImageCleanupApiUrl = root.dataset.markdownImageCleanupApiUrl || "";
        const mkdirApiUrl = root.dataset.mkdirApiUrl;
        const originalPath = root.dataset.originalPath || "";
        const initialDir = root.dataset.initialDir || "";
        const writeEditorKind = String(root.dataset.writeEditorKind || "text").trim().toLowerCase();
        const isMediaWriteEditor = writeEditorKind === "image" || writeEditorKind === "audio" || writeEditorKind === "video";
        const isPublicWriteDirectSave = root.dataset.publicWriteDirectSave === "1";
        const writeRequiresCommitMessage = root.dataset.writeRequiresCommitMessage === "1";

        const filenameInput = document.getElementById("handrive-filename-input");
        const saveFilenameInput = document.getElementById("handrive-save-filename-input");
        const saveExtensionSelect = document.getElementById("handrive-save-extension-select");
        const contentInput = document.getElementById("handrive-content-input");
        const editorSurface = document.getElementById("handrive-editor-surface");
        const imageEditorSurface = document.getElementById("handrive-image-editor-surface");
        const videoEditorSurface = document.getElementById("handrive-video-editor-surface");
        const audioEditorSurface = document.getElementById("handrive-audio-editor-surface");
        const editorHighlight = document.getElementById("handrive-editor-highlight");
        const editorHighlightCode = document.getElementById("handrive-editor-highlight-code");
        const editorSuggest = document.getElementById("handrive-editor-suggest");
        const editorSuggestLabel = document.getElementById("handrive-editor-suggest-label");
        const markdownHelpButton = document.getElementById("ui-markdown-help-btn");
        const markdownHelpModal = document.getElementById("ui-markdown-help-modal");
        const markdownHelpBackdrop = document.getElementById("ui-markdown-help-backdrop");
        const markdownPreviewButton = document.getElementById("ui-markdown-preview-btn");
        const markdownPreviewModal = document.getElementById("ui-markdown-preview-modal");
        const markdownPreviewBackdrop = document.getElementById("ui-markdown-preview-backdrop");
        const markdownPreviewContent = document.getElementById("ui-markdown-preview-content");
        const cancelButton = document.getElementById("handrive-cancel-btn");
        const saveButton = document.getElementById("handrive-save-btn");
        const createFolderButton = document.getElementById("handrive-create-folder-btn");
        const saveModal = document.getElementById("handrive-save-modal");
        const saveModalBackdrop = document.getElementById("handrive-save-modal-backdrop");
        const saveCloseButton = document.getElementById("handrive-save-close-btn");
        const saveCancelButton = document.getElementById("handrive-save-cancel-btn");
        const saveConfirmButton = document.getElementById("handrive-save-confirm-btn");
        const saveUpButton = document.getElementById("handrive-save-up-btn");
        const saveBreadcrumb = document.getElementById("handrive-save-breadcrumb");
        const saveQuickList = document.getElementById("handrive-save-quick-list");
        const saveFolderList = document.getElementById("handrive-save-folder-list");
        const folderModal = document.getElementById("handrive-folder-modal");
        const folderModalBackdrop = document.getElementById("handrive-folder-modal-backdrop");
        const folderNameInput = document.getElementById("handrive-folder-name-input");
        const folderTargetPath = document.getElementById("handrive-folder-target-path");
        const folderCancelButton = document.getElementById("handrive-folder-cancel-btn");
        const folderCreateButton = document.getElementById("handrive-folder-create-btn");
        const unsavedModal = document.getElementById("handrive-unsaved-modal");
        const unsavedModalBackdrop = document.getElementById("handrive-unsaved-modal-backdrop");
        const unsavedMessage = document.getElementById("handrive-unsaved-message");
        const unsavedCancelButton = document.getElementById("handrive-unsaved-cancel-btn");
        const unsavedLeaveButton = document.getElementById("handrive-unsaved-leave-btn");
        const unsavedSaveButton = document.getElementById("handrive-unsaved-save-btn");
        const directoryOptions = document.getElementById("handrive-directory-options");
        const markdownSnippetMenu = document.getElementById("ui-markdown-snippet-menu");
        const markdownSnippetButtons = Array.from(
            document.querySelectorAll("button[data-editor-snippet]")
        );
        const DOCS_CUSTOM_EXTENSION_OPTION_VALUE = "__custom__";
        async function promptWriteCommitMessage(targetPath) {
            return requestCommitMessageDialog({ targetPath: targetPath || "" });
        }
        const extensionPresetValues = saveExtensionSelect
            ? Array.from(saveExtensionSelect.options)
                .map(function (option) {
                    return String(option.value || "").trim().toLowerCase();
                })
                .filter(function (value) {
                    return Boolean(value) && value !== DOCS_CUSTOM_EXTENSION_OPTION_VALUE;
                })
            : [".md"];
        const extensionPresetSet = new Set(extensionPresetValues);
        const scopedHomeDir = normalizePath(root.dataset.scopedHomeDir || "", true);
        const isSuperuser = root.dataset.isSuperuser === "1";
        const handriveRootLabel = (root.dataset.handriveRootLabel || "HanDrive").trim() || "HanDrive";
        const effectiveRootLabel = handriveRootLabel;

        const rawDirectories = getJsonScriptData("handrive-directory-data", []);
        const directories = [];
        const directorySet = new Set();
        const DOCS_DEFAULT_EXTENSION = ".md";
        let customExtensionValue = DOCS_DEFAULT_EXTENSION;
        // write 페이지 상태는 파일명/디렉터리 선택과 미저장 변경 추적에 집중한다.
        const state = {
            browserDir: "",
            selectedDir: "",
        };
        let contentHeightRafId = null;
        let savedFilenameValue = filenameInput ? filenameInput.value : "";
        let savedContentValue = contentInput ? contentInput.value : "";
        let bypassUnsavedBeforeUnload = false;
        let pendingSaveThenLeaveAction = null;
        let resolveUnsavedChoice = null;
        let unsavedModalOpen = false;
        let lastUnsavedFocusedElement = null;
        let activeEditorSuggestions = [];
        let activeEditorSuggestionIndex = -1;
        let writeSuggestEventsBound = false;
        let writeMarkdownUploadedImagePaths = [];
        // 자동완성 단어 리스트는 전역 단일 맵(window.__handriveEditorCompletionMap)만 사용
        const editorCompletionMap = window.__handriveEditorCompletionMap || {};
        const writeMarkdownImageInput = createMarkdownImageInputHandler({
            textarea: contentInput,
            uploadApiUrl: markdownImageUploadApiUrl,
            isEnabled: function () {
                const originalExtension = getPathFileExtension(originalPath);
                if (originalExtension) {
                    return originalExtension === DOCS_DEFAULT_EXTENSION;
                }
                const rawName = filenameInput ? String(filenameInput.value || "").trim() : "";
                const match = rawName.match(/\.[A-Za-z0-9]+$/);
                return !match || match[0].toLowerCase() === DOCS_DEFAULT_EXTENSION;
            },
            getMarkdownPath: function () {
                return originalPath || "";
            },
            getMarkdownName: function () {
                return filenameInput ? filenameInput.value : "";
            },
            getTargetDir: function () {
                return normalizePath(initialDir, true);
            },
            onAfterInsert: function (data) {
                if (data && data.path) {
                    writeMarkdownUploadedImagePaths.push(data.path);
                }
                renderWriteEditorHighlight();
            }
        });

        function markCurrentAsSaved() {
            savedFilenameValue = filenameInput ? filenameInput.value : "";
            savedContentValue = contentInput ? contentInput.value : "";
        }

        function getActiveWriteMediaEditor() {
            if (writeEditorKind === "image" && window.HandriveImageEditor) {
                return window.HandriveImageEditor;
            }
            if (writeEditorKind === "video" && window.HandriveVideoEditor) {
                return window.HandriveVideoEditor;
            }
            if (writeEditorKind === "audio" && window.HandriveAudioEditor) {
                return window.HandriveAudioEditor;
            }
            return null;
        }

        function getActiveWriteMediaSaveUrl() {
            if (writeEditorKind === "image") return imageEditorSaveUrl;
            if (writeEditorKind === "video") return videoEditorSaveUrl;
            if (writeEditorKind === "audio") return audioEditorSaveUrl;
            return "";
        }

        function hasUnsavedMediaWriteChanges() {
            const editor = getActiveWriteMediaEditor();
            return Boolean(editor && typeof editor.getIsDirty === "function" && editor.getIsDirty());
        }

        function hasUnsavedWriteChanges() {
            if (isMediaWriteEditor) {
                const filenameChanged = writeEditorKind === "image" && filenameInput
                    ? filenameInput.value !== savedFilenameValue
                    : false;
                return hasUnsavedMediaWriteChanges() || filenameChanged;
            }
            const currentFilename = filenameInput ? filenameInput.value : "";
            const currentContent = contentInput ? contentInput.value : "";
            return currentFilename !== savedFilenameValue || currentContent !== savedContentValue;
        }

        async function cleanupWriteMarkdownUploadedImages() {
            if (!markdownImageCleanupApiUrl || !writeMarkdownUploadedImagePaths.length) {
                return;
            }
            const imagePaths = Array.from(new Set(writeMarkdownUploadedImagePaths));
            writeMarkdownUploadedImagePaths = [];
            await requestJson(
                markdownImageCleanupApiUrl,
                buildPostOptions({
                    markdown_path: originalPath || "",
                    target_dir: normalizePath(initialDir, true),
                    image_paths: imagePaths,
                })
            );
        }

        function runWithBeforeUnloadBypass(action) {
            if (typeof action !== "function") {
                return;
            }
            bypassUnsavedBeforeUnload = true;
            action();
            window.setTimeout(function () {
                bypassUnsavedBeforeUnload = false;
            }, 1200);
        }

        function buildWriteDownloadUrl(pathValue) {
            if (!downloadApiUrl) {
                return "";
            }
            const query = new URLSearchParams({ path: pathValue || "" }).toString();
            return appendSharedQuery(query ? downloadApiUrl + "?" + query : downloadApiUrl);
        }

        function buildWriteScopedHomeDownloadUrl(pathValue) {
            return appendQueryParam(buildWriteDownloadUrl(pathValue), "scope_home", "1");
        }

        function getWriteMediaFilenameValue() {
            return String(filenameInput ? filenameInput.value || "" : "").trim();
        }

        function getWriteMediaOriginalFilename() {
            return String(originalPath || "").split("/").pop() || "";
        }

        async function submitImageRenameOnly() {
            const nextName = getWriteMediaFilenameValue();
            if (!nextName) {
                alertError(new Error(t("js_filename_required", "파일명을 입력해주세요.")));
                return;
            }
            if (!renameApiUrl || !originalPath) {
                alertError(new Error(t("js_request_failed", "요청 처리 중 오류가 발생했습니다.")));
                return;
            }
            let commitMessage = "";
            if (writeRequiresCommitMessage) {
                commitMessage = await promptWriteCommitMessage(originalPath);
                if (commitMessage === null) {
                    return;
                }
            }
            const data = await requestJson(renameApiUrl, buildPostOptions({
                path: originalPath,
                new_name: nextName,
                commit_message: commitMessage,
            }));
            markCurrentAsSaved();
            const targetPath = data && (data.slug_path || data.path);
            if (targetPath) {
                runWithBeforeUnloadBypass(function () {
                    window.location.href = buildViewUrl(handriveBaseUrl, targetPath);
                });
            }
        }

        function getWriteMediaEntry() {
            if (!originalPath) {
                return null;
            }
            return {
                path: originalPath,
                slug_path: originalPath,
                name: originalPath.split("/").pop() || originalPath,
                type: "file",
            };
        }

        function showWriteMediaSurface() {
            if (!isMediaWriteEditor) {
                if (imageEditorSurface) imageEditorSurface.hidden = true;
                if (videoEditorSurface) videoEditorSurface.hidden = true;
                if (audioEditorSurface) audioEditorSurface.hidden = true;
                return;
            }
            if (editorSurface) editorSurface.hidden = true;
            if (contentInput) contentInput.disabled = true;
            if (filenameInput && writeEditorKind !== "image") {
                filenameInput.readOnly = true;
                filenameInput.setAttribute("aria-readonly", "true");
            }
            if (imageEditorSurface) imageEditorSurface.hidden = writeEditorKind !== "image";
            if (videoEditorSurface) videoEditorSurface.hidden = writeEditorKind !== "video";
            if (audioEditorSurface) audioEditorSurface.hidden = writeEditorKind !== "audio";

            const entry = getWriteMediaEntry();
            const mediaUrl = buildWriteDownloadUrl(originalPath);
            const dirtyHandler = function (dirty) {
                if (saveButton) {
                    saveButton.classList.toggle("is-dirty", Boolean(dirty));
                }
            };
            if (writeEditorKind === "image" && window.HandriveImageEditor && entry) {
                window.HandriveImageEditor.init({
                    entry: entry,
                    imageServeUrl: mediaUrl,
                    backgroundRemoveUrl: imageEditorRemoveBackgroundUrl,
                    onDirtyChange: dirtyHandler,
                });
            } else if (writeEditorKind === "video" && window.HandriveVideoEditor && entry) {
                window.HandriveVideoEditor.init({
                    entry: entry,
                    videoServeUrl: mediaUrl,
                    buildDownloadUrl: buildWriteScopedHomeDownloadUrl,
                    listApiUrl: appendQueryParam(appendSharedQuery(listApiUrl), "scope_home", "1"),
                    scopedHomeDir: scopedHomeDir,
                    onDirtyChange: dirtyHandler,
                });
            } else if (writeEditorKind === "audio" && window.HandriveAudioEditor && entry) {
                window.HandriveAudioEditor.init({
                    entry: entry,
                    audioServeUrl: mediaUrl,
                    listApiUrl: appendQueryParam(appendSharedQuery(listApiUrl), "scope_home", "1"),
                    buildDownloadUrl: buildWriteScopedHomeDownloadUrl,
                    scopedHomeDir: scopedHomeDir,
                    onDirtyChange: dirtyHandler,
                });
            }
        }

        function setUnsavedModalOpen(opened) {
            if (!unsavedModal) {
                return;
            }
            unsavedModal.hidden = !opened;
            unsavedModalOpen = opened;
            syncModalBodyState();
            if (!opened && lastUnsavedFocusedElement && typeof lastUnsavedFocusedElement.focus === "function") {
                lastUnsavedFocusedElement.focus();
            }
            if (!opened) {
                lastUnsavedFocusedElement = null;
            }
        }

        function closeUnsavedModal(choice) {
            if (!unsavedModalOpen) {
                return;
            }
            setUnsavedModalOpen(false);
            if (resolveUnsavedChoice) {
                resolveUnsavedChoice(choice || "cancel");
                resolveUnsavedChoice = null;
            }
        }

        function requestUnsavedLeaveDecision() {
            if (
                !unsavedModal ||
                !unsavedModalBackdrop ||
                !unsavedCancelButton ||
                !unsavedLeaveButton ||
                !unsavedSaveButton
            ) {
                return requestConfirmDialog({
                    title: t("unsaved_changes_title", "수정 사항이 있습니다"),
                    message: t("unsaved_changes_message", "저장되지 않은 변경 사항이 있습니다. 이동 전에 저장할까요?"),
                    cancelText: t("cancel", "취소"),
                    confirmText: t("unsaved_changes_leave_button", "확인")
                }).then(function (confirmed) {
                    return confirmed ? "leave" : "cancel";
                });
            }

            if (resolveUnsavedChoice) {
                resolveUnsavedChoice("cancel");
                resolveUnsavedChoice = null;
            }

            if (unsavedMessage) {
                unsavedMessage.textContent = t(
                    "unsaved_changes_message",
                    "저장되지 않은 변경 사항이 있습니다. 이동 전에 저장할까요?"
                );
            }

            lastUnsavedFocusedElement = document.activeElement;
            setUnsavedModalOpen(true);
            unsavedCancelButton.focus();

            return new Promise(function (resolve) {
                resolveUnsavedChoice = resolve;
            });
        }

        function submitSaveThenLeave() {
            if (!pendingSaveThenLeaveAction) {
                return;
            }
            if (isMediaWriteEditor) {
                submitMediaEditorSave({
                    redirectOnSuccess: false,
                    onSuccess: function () {
                        const nextAction = pendingSaveThenLeaveAction;
                        pendingSaveThenLeaveAction = null;
                        if (typeof nextAction === "function") {
                            runWithBeforeUnloadBypass(nextAction);
                        }
                    }
                });
                return;
            }

            submitSave({
                redirectOnSuccess: false,
                onSuccess: function () {
                    const nextAction = pendingSaveThenLeaveAction;
                    pendingSaveThenLeaveAction = null;
                    if (typeof nextAction === "function") {
                        runWithBeforeUnloadBypass(nextAction);
                    }
                }
            });
        }

        function attemptLeaveWithUnsavedGuard(action) {
            if (typeof action !== "function") {
                return;
            }
            if (!hasUnsavedWriteChanges()) {
                runWithBeforeUnloadBypass(action);
                return;
            }

            requestUnsavedLeaveDecision().then(function (choice) {
                if (choice === "leave") {
                    runWithBeforeUnloadBypass(action);
                    return;
                }
                if (choice === "save") {
                    pendingSaveThenLeaveAction = action;
                    if (isMediaWriteEditor) {
                        submitSaveThenLeave();
                        return;
                    }
                    if (isPublicWriteDirectSave || !saveModal) {
                        submitSaveThenLeave();
                        return;
                    }
                    setSaveModalOpen(true);
                }
            });
        }

        function closeMarkdownSnippetMenu() {
            if (!markdownSnippetMenu) {
                return;
            }
            markdownSnippetMenu.hidden = true;
        }

        function openMarkdownSnippetMenu(clientX, clientY) {
            if (!markdownSnippetMenu) {
                return;
            }

            markdownSnippetMenu.hidden = false;
            markdownSnippetMenu.style.left = "0px";
            markdownSnippetMenu.style.top = "0px";

            const rect = markdownSnippetMenu.getBoundingClientRect();
            const viewportPadding = 8;
            const maxLeft = Math.max(viewportPadding, window.innerWidth - rect.width - viewportPadding);
            const maxTop = Math.max(viewportPadding, window.innerHeight - rect.height - viewportPadding);
            const left = Math.min(Math.max(viewportPadding, clientX), maxLeft);
            const top = Math.min(Math.max(viewportPadding, clientY), maxTop);

            markdownSnippetMenu.style.left = left + "px";
            markdownSnippetMenu.style.top = top + "px";
        }

        function getCurrentEditorExtension() {
            const extension = resolveWriteFilenameExtension();
            return extension || DOCS_DEFAULT_EXTENSION;
        }

        function syncSnippetMenuItemsByExtension(extension) {
            if (!markdownSnippetMenu) {
                return 0;
            }
            const currentExtension = String(extension || "").trim().toLowerCase();
            let visibleCount = 0;
            markdownSnippetButtons.forEach(function (button) {
                const rawExtensions = String(button.getAttribute("data-editor-extensions") || "").trim();
                if (!rawExtensions) {
                    button.hidden = false;
                    visibleCount += 1;
                    return;
                }
                const allowed = rawExtensions
                    .split(",")
                    .map(function (value) { return String(value || "").trim().toLowerCase(); })
                    .filter(Boolean);
                const visible = allowed.includes(currentExtension);
                button.hidden = !visible;
                if (visible) {
                    visibleCount += 1;
                }
            });
            return visibleCount;
        }

        function replaceTextareaSelection(insertText, selectionStartOffset, selectionEndOffset) {
            if (!contentInput) {
                return;
            }
            const start = contentInput.selectionStart || 0;
            const end = contentInput.selectionEnd || 0;
            contentInput.setRangeText(insertText, start, end, "end");

            const nextStart = start + (selectionStartOffset || 0);
            const nextEnd = start + (selectionEndOffset || insertText.length);
            contentInput.setSelectionRange(nextStart, nextEnd);
            contentInput.focus();
            contentInput.dispatchEvent(new Event("input", { bubbles: true }));
        }

        function buildWrappedSnippet(prefix, suffix, placeholder) {
            const start = contentInput ? (contentInput.selectionStart || 0) : 0;
            const end = contentInput ? (contentInput.selectionEnd || 0) : 0;
            const selected = contentInput ? contentInput.value.slice(start, end) : "";
            const body = selected || placeholder;
            const text = prefix + body + suffix;

            if (selected) {
                return { text: text, selectStart: text.length, selectEnd: text.length };
            }

            return {
                text: text,
                selectStart: prefix.length,
                selectEnd: prefix.length + body.length,
            };
        }

        function buildPrefixedLinesSnippet(prefix, placeholder) {
            const start = contentInput ? (contentInput.selectionStart || 0) : 0;
            const end = contentInput ? (contentInput.selectionEnd || 0) : 0;
            const selected = contentInput ? contentInput.value.slice(start, end) : "";
            if (!selected) {
                const body = prefix + placeholder;
                return {
                    text: body,
                    selectStart: prefix.length,
                    selectEnd: body.length,
                };
            }

            const lines = selected.split(/\r?\n/);
            const transformed = lines.map(function (line) {
                if (!line.trim()) {
                    return line;
                }
                return prefix + line;
            }).join("\n");
            return { text: transformed, selectStart: transformed.length, selectEnd: transformed.length };
        }

        function buildTableSnippet() {
            const col1 = t("markdown_placeholder_table_col1", "Column 1");
            const col2 = t("markdown_placeholder_table_col2", "Column 2");
            const table = [
                "| " + col1 + " | " + col2 + " |",
                "| --- | --- |",
                "| Value 1 | Value 2 |",
            ].join("\n");
            return {
                text: table,
                selectStart: 2,
                selectEnd: 2 + col1.length,
            };
        }

        function buildNumberedLinesSnippet(placeholder) {
            const start = contentInput ? (contentInput.selectionStart || 0) : 0;
            const end = contentInput ? (contentInput.selectionEnd || 0) : 0;
            const selected = contentInput ? contentInput.value.slice(start, end) : "";
            if (!selected) {
                const body = "1. " + placeholder;
                return {
                    text: body,
                    selectStart: 3,
                    selectEnd: body.length,
                };
            }

            let order = 1;
            const transformed = selected
                .split(/\r?\n/)
                .map(function (line) {
                    if (!line.trim()) {
                        return line;
                    }
                    const row = order + ". " + line;
                    order += 1;
                    return row;
                })
                .join("\n");
            return { text: transformed, selectStart: transformed.length, selectEnd: transformed.length };
        }

        function buildCodeBlockSnippet() {
            const lang = t("markdown_placeholder_code_lang", "text");
            const body = t("markdown_placeholder_code_body", "type your code");
            const text = "```" + lang + "\n" + body + "\n```";
            const bodyStart = ("```" + lang + "\n").length;
            return {
                text: text,
                selectStart: bodyStart,
                selectEnd: bodyStart + body.length,
            };
        }

        function insertMarkdownSnippet(snippetType) {
            if (!contentInput) {
                return;
            }

            let snippet = null;
            if (snippetType === "heading2") {
                snippet = buildWrappedSnippet("## ", "", t("markdown_placeholder_heading", "Heading"));
            } else if (snippetType === "heading3") {
                snippet = buildWrappedSnippet("### ", "", t("markdown_placeholder_heading", "Heading"));
            } else if (snippetType === "bold") {
                snippet = buildWrappedSnippet("**", "**", t("markdown_placeholder_bold", "bold text"));
            } else if (snippetType === "italic") {
                snippet = buildWrappedSnippet("*", "*", t("markdown_placeholder_italic", "italic text"));
            } else if (snippetType === "link") {
                snippet = buildWrappedSnippet("[", "](https://)", t("markdown_placeholder_link_text", "link text"));
            } else if (snippetType === "image") {
                snippet = buildWrappedSnippet("![", "](https://)", t("markdown_placeholder_image_alt", "image description"));
            } else if (snippetType === "code_inline") {
                snippet = buildWrappedSnippet("`", "`", t("markdown_placeholder_inline_code", "code"));
            } else if (snippetType === "code_block") {
                snippet = buildCodeBlockSnippet();
            } else if (snippetType === "list_bullet") {
                snippet = buildPrefixedLinesSnippet("- ", t("markdown_placeholder_list_item", "item"));
            } else if (snippetType === "list_numbered") {
                snippet = buildNumberedLinesSnippet(t("markdown_placeholder_list_item", "item"));
            } else if (snippetType === "list_check") {
                snippet = buildPrefixedLinesSnippet("- [ ] ", t("markdown_placeholder_list_item", "item"));
            } else if (snippetType === "quote") {
                snippet = buildPrefixedLinesSnippet("> ", t("markdown_placeholder_quote", "quote"));
            } else if (snippetType === "divider") {
                snippet = {
                    text: "\n---\n",
                    selectStart: 5,
                    selectEnd: 5,
                };
            } else if (snippetType === "table") {
                snippet = buildTableSnippet();
            }

            if (!snippet) {
                return;
            }
            replaceTextareaSelection(snippet.text, snippet.selectStart, snippet.selectEnd);
        }

        function insertLanguageSnippet(snippetType, extension) {
            if (!contentInput) {
                return false;
            }

            let snippet = null;
            if (extension === ".py") {
                if (snippetType === "py_def") {
                    const body = "def function_name(params):\n    pass";
                    snippet = { text: body, selectStart: 4, selectEnd: 17 };
                } else if (snippetType === "py_class") {
                    const body = "class ClassName:\n    def __init__(self):\n        pass";
                    snippet = { text: body, selectStart: 6, selectEnd: 15 };
                } else if (snippetType === "py_ifmain") {
                    snippet = { text: "if __name__ == \"__main__\":\n    main()", selectStart: 29, selectEnd: 33 };
                } else if (snippetType === "py_comment") {
                    snippet = buildPrefixedLinesSnippet("# ", t("markdown_placeholder_list_item", "item"));
                }
            } else if (extension === ".js") {
                if (snippetType === "js_function") {
                    const body = "function functionName(params) {\n    \n}";
                    snippet = { text: body, selectStart: 9, selectEnd: 21 };
                } else if (snippetType === "js_if") {
                    snippet = { text: "if (condition) {\n    \n}", selectStart: 4, selectEnd: 13 };
                } else if (snippetType === "js_comment") {
                    snippet = buildPrefixedLinesSnippet("// ", t("markdown_placeholder_list_item", "item"));
                }
            } else if (extension === ".css") {
                if (snippetType === "css_rule") {
                    snippet = { text: ".selector {\n    property: value;\n}", selectStart: 1, selectEnd: 9 };
                } else if (snippetType === "css_media") {
                    snippet = { text: "@media (max-width: 768px) {\n    \n}", selectStart: 8, selectEnd: 23 };
                } else if (snippetType === "css_var") {
                    snippet = { text: ":root {\n    --color-name: #000;\n}", selectStart: 14, selectEnd: 24 };
                }
            } else if (extension === ".json") {
                if (snippetType === "json_pair") {
                    snippet = { text: "\"key\": \"value\"", selectStart: 1, selectEnd: 4 };
                } else if (snippetType === "json_object") {
                    snippet = { text: "{\n  \"key\": \"value\"\n}", selectStart: 5, selectEnd: 8 };
                }
            } else if (extension === ".html") {
                if (snippetType === "html_basic") {
                    snippet = {
                        text: "<!doctype html>\n<html lang=\"ko\">\n<head>\n  <meta charset=\"utf-8\">\n  <title>File</title>\n</head>\n<body>\n  \n</body>\n</html>",
                        selectStart: 82,
                        selectEnd: 90
                    };
                } else if (snippetType === "html_div") {
                    snippet = { text: "<div class=\"box\">\n  \n</div>", selectStart: 12, selectEnd: 15 };
                }
            }

            if (!snippet) {
                return false;
            }
            replaceTextareaSelection(snippet.text, snippet.selectStart, snippet.selectEnd);
            return true;
        }

        function updateContentInputAutoHeight() {
            contentHeightRafId = null;
            if (!contentInput) {
                return;
            }

            const rootStyle = window.getComputedStyle(root);
            const rootBottomPadding = parseFloat(rootStyle.paddingBottom || "0");
            const paddingBottom = Number.isFinite(rootBottomPadding) ? rootBottomPadding : 0;
            const viewport = window.visualViewport;
            const viewportHeight = viewport ? viewport.height : window.innerHeight;
            const viewportOffsetTop = viewport ? viewport.offsetTop : 0;
            const inputRect = contentInput.getBoundingClientRect();
            const inputStyle = window.getComputedStyle(contentInput);
            const minHeightValue = parseFloat(inputStyle.minHeight || "0");
            const minHeight = Number.isFinite(minHeightValue) ? minHeightValue : 0;
            const availableHeight = viewportHeight + viewportOffsetTop - inputRect.top - paddingBottom;
            const targetHeight = Math.max(minHeight, Math.floor(availableHeight));

            contentInput.style.height = Math.max(0, targetHeight) + "px";
            if (editorSurface) {
                editorSurface.style.height = contentInput.style.height;
            }
            if (editorHighlight) {
                editorHighlight.style.height = contentInput.style.height;
            }
        }

        function scheduleContentInputAutoHeight() {
            if (contentHeightRafId !== null) {
                return;
            }
            contentHeightRafId = window.requestAnimationFrame(updateContentInputAutoHeight);
        }

        function upsertDirectory(pathValue) {
            const normalized = normalizePath(pathValue, true);
            if (directorySet.has(normalized)) {
                return normalized;
            }
            directorySet.add(normalized);
            directories.push(normalized);
            return normalized;
        }

        function hasDirectory(pathValue) {
            const normalized = normalizePath(pathValue, true);
            return directorySet.has(normalized);
        }

        function normalizeDirectoryInput() {
            return normalizePath(state.selectedDir || state.browserDir || "", true);
        }

        function getParentPath(pathValue) {
            const normalized = normalizePath(pathValue, true);
            if (!normalized) {
                return "";
            }
            const parts = normalized.split("/");
            parts.pop();
            return parts.join("/");
        }

        function getCancelTargetDirectory() {
            if (originalPath) {
                return getParentPath(originalPath);
            }
            return normalizePath(state.selectedDir || state.browserDir || initialDir || "", true);
        }

        function getPathFileStem(pathValue) {
            const normalized = normalizePath(pathValue, true);
            if (!normalized) {
                return "";
            }
            const segments = normalized.split("/");
            const fileName = segments[segments.length - 1] || "";
            const dotIndex = fileName.lastIndexOf(".");
            if (dotIndex > 0) {
                return fileName.slice(0, dotIndex);
            }
            return fileName;
        }

        function normalizeFileExtensionValue(rawValue, allowEmpty) {
            const candidate = String(rawValue || "").trim().toLowerCase();
            if (!candidate) {
                if (allowEmpty) {
                    return "";
                }
                throw new Error(t("js_extension_required", "확장자를 입력해주세요."));
            }

            const normalized = candidate.startsWith(".") ? candidate : "." + candidate;
            if (!/^\.[a-z0-9][a-z0-9._-]{0,15}$/.test(normalized)) {
                throw new Error(t("js_extension_invalid", "확장자 형식이 올바르지 않습니다. 예: .md"));
            }
            return normalized;
        }

        function parseFileNameWithExtension(rawValue) {
            const trimmed = String(rawValue || "").trim();
            if (!trimmed) {
                return { filename: "", extension: "" };
            }

            const dotIndex = trimmed.lastIndexOf(".");
            if (dotIndex > 0 && dotIndex < trimmed.length - 1) {
                return {
                    filename: trimmed.slice(0, dotIndex).trim(),
                    extension: trimmed.slice(dotIndex).toLowerCase()
                };
            }
            return { filename: trimmed, extension: "" };
        }

        function syncExtensionSelectFromValue(extensionValue) {
            if (!saveExtensionSelect) {
                return;
            }
            let normalized = "";
            try {
                normalized = normalizeFileExtensionValue(extensionValue, true);
            } catch (error) {
                normalized = "";
            }
            if (!normalized) {
                normalized = DOCS_DEFAULT_EXTENSION;
            }
            if (extensionPresetSet.has(normalized)) {
                saveExtensionSelect.value = normalized;
                customExtensionValue = DOCS_DEFAULT_EXTENSION;
                return;
            }
            customExtensionValue = normalized;
            if (saveExtensionSelect.querySelector('option[value="' + DOCS_CUSTOM_EXTENSION_OPTION_VALUE + '"]')) {
                saveExtensionSelect.value = DOCS_CUSTOM_EXTENSION_OPTION_VALUE;
                return;
            }
            saveExtensionSelect.value = DOCS_DEFAULT_EXTENSION;
        }

        function getSelectedExtensionOrDefault() {
            if (!saveExtensionSelect) {
                return DOCS_DEFAULT_EXTENSION;
            }
            const selected = String(saveExtensionSelect.value || "").trim();
            if (!selected) {
                return DOCS_DEFAULT_EXTENSION;
            }
            if (selected === DOCS_CUSTOM_EXTENSION_OPTION_VALUE) {
                try {
                    return normalizeFileExtensionValue(customExtensionValue, false);
                } catch (error) {
                    return DOCS_DEFAULT_EXTENSION;
                }
            }
            return normalizeFileExtensionValue(selected, false);
        }

        function getSaveModalFilenameAndExtension() {
            const parsed = parseFileNameWithExtension(saveFilenameInput ? saveFilenameInput.value : "");
            const finalFilename = String(parsed.filename || "").trim();
            if (!finalFilename) {
                throw new Error(t("js_filename_required", "파일명을 입력해주세요."));
            }

            let extensionCandidate = parsed.extension;
            if (!extensionCandidate) {
                extensionCandidate = getSelectedExtensionOrDefault();
            }
            const targetExtension = normalizeFileExtensionValue(extensionCandidate, false);
            return {
                filename: finalFilename,
                extension: targetExtension,
            };
        }

        function resolveWriteFilenameExtension() {
            const parsed = parseFileNameWithExtension(filenameInput ? filenameInput.value : "");
            if (!parsed.extension) {
                return "";
            }
            try {
                return normalizeFileExtensionValue(parsed.extension, false);
            } catch (error) {
                return "";
            }
        }

        function resolveWriteEditorRenderClass() {
            const extension = resolveWriteFilenameExtension();
            if (extension === ".md") {
                return "handrive-editor-md";
            }
            if (extension === ".js") {
                return "handrive-js";
            }
            if (extension === ".css") {
                return "handrive-css";
            }
            if (extension === ".json") {
                return "handrive-json";
            }
            if (extension === ".py") {
                return "handrive-py";
            }
            if (extension === ".html") {
                return "handrive-editor-html";
            }
            return "handrive-plain-text";
        }

        function syncEditorHighlightScroll() {
            if (!contentInput || !editorHighlight) {
                return;
            }
            editorHighlight.scrollTop = contentInput.scrollTop;
            editorHighlight.scrollLeft = contentInput.scrollLeft;
        }

        function clearEditorSuggestion() {
            activeEditorSuggestions = [];
            activeEditorSuggestionIndex = -1;
            if (editorSuggest) {
                editorSuggest.hidden = true;
                // 위치 스타일 초기화
                editorSuggest.style.left = '';
                editorSuggest.style.top = '';
                editorSuggest.innerHTML = "";
            }
            if (editorSuggestLabel) {
                editorSuggestLabel.textContent = "";
            }
        }

        function findEditorSuggestions(extension, tokenText) {
            const items = resolveEditorCompletionItemsByExtension(extension);
            return findEditorCompletionItems(items, tokenText, 8);
        }

        function renderWriteEditorSuggestDropdown() {
            if (!editorSuggest) {
                return;
            }
            editorSuggest.innerHTML = "";
            const list = document.createElement("div");
            list.className = "handrive-editor-suggest-list";
            for (let i = 0; i < activeEditorSuggestions.length; i += 1) {
                const item = activeEditorSuggestions[i] || {};
                const option = document.createElement("button");
                option.type = "button";
                option.className = "handrive-editor-suggest-item" + (i === activeEditorSuggestionIndex ? " is-active" : "");
                option.setAttribute("data-suggest-index", String(i));

                const labelNode = document.createElement("span");
                labelNode.className = "handrive-editor-suggest-item-label";
                labelNode.textContent = item.label || item.insertText || "";

                const triggerNode = document.createElement("span");
                triggerNode.className = "handrive-editor-suggest-item-trigger";
                triggerNode.textContent = item.trigger || "";

                option.appendChild(labelNode);
                option.appendChild(triggerNode);
                list.appendChild(option);
            }
            const footer = document.createElement("div");
            footer.className = "handrive-editor-suggest-footer";
            footer.textContent = "↑↓ 이동 · Enter/Tab 적용";
            editorSuggest.appendChild(list);
            editorSuggest.appendChild(footer);
        }

        function moveWriteEditorSuggestion(step) {
            if (!activeEditorSuggestions.length) {
                return;
            }
            const count = activeEditorSuggestions.length;
            activeEditorSuggestionIndex = (activeEditorSuggestionIndex + step + count) % count;
            renderWriteEditorSuggestDropdown();
        }

        function updateEditorSuggestion() {
            if (!contentInput || !editorSuggest) {
                return;
            }
            const start = contentInput.selectionStart || 0;
            const end = contentInput.selectionEnd || 0;
            if (start !== end) {
                clearEditorSuggestion();
                return;
            }

            const extension = getCurrentEditorExtension();
            const tokenInfo = extractEditorCompletionToken(contentInput.value || "", start);
            if (!tokenInfo) {
                clearEditorSuggestion();
                return;
            }
            const suggestions = findEditorSuggestions(extension, tokenInfo.token);
            if (!suggestions.length) {
                clearEditorSuggestion();
                return;
            }

            activeEditorSuggestions = suggestions.map(function (suggestion) {
                return {
                    start: tokenInfo.start,
                    end: tokenInfo.end,
                    insertText: suggestion.insertText,
                    cursorBack: Number(suggestion.cursorBack || 0),
                    label: suggestion.label || suggestion.insertText,
                    trigger: suggestion.trigger || "",
                };
            });
            activeEditorSuggestionIndex = 0;
            renderWriteEditorSuggestDropdown();
            
            // 커서 위치 계산
            const cursorPosition = calculateCursorPosition(contentInput, start);
            if (cursorPosition) {
                // 에디터 서페이스 내에서의 상대 위치 계산
                const editorRect = contentInput.getBoundingClientRect();
                const surfaceRect = editorSurface ? editorSurface.getBoundingClientRect() : null;
                
                // 커서 기준으로 오른쪽 12픽셀, 아래 6픽셀
                let left = cursorPosition.left + 12;
                let top = cursorPosition.top + (cursorPosition.lineHeight || 20) + 6;
                
                // 에디터 서페이스가 있으면 상대 위치 조정
                if (surfaceRect) {
                    left = (cursorPosition.left + 12) - surfaceRect.left;
                    top = (cursorPosition.top + (cursorPosition.lineHeight || 20) + 6) - surfaceRect.top;
                }

                const suggestRect = editorSuggest.getBoundingClientRect();
                if (surfaceRect) {
                    const minLeft = 8;
                    const minTop = 8;
                    const maxLeft = Math.max(minLeft, surfaceRect.width - suggestRect.width - 8);
                    const maxTop = Math.max(minTop, surfaceRect.height - suggestRect.height - 8);
                    left = Math.min(Math.max(minLeft, left), maxLeft);
                    top = Math.min(Math.max(minTop, top), maxTop);
                }
                
                editorSuggest.style.left = left + 'px';
                editorSuggest.style.top = top + 'px';
            }
            editorSuggest.hidden = false;
        }

        function calculateCursorPosition(textarea, position) {
            // 텍스트 영역에서 커서의 픽셀 위치 계산
            const text = textarea.value;
            const textBeforeCursor = text.substring(0, position);
            const lines = textBeforeCursor.split('\n');
            const currentLine = lines.length - 1;
            const currentColumn = lines[lines.length - 1].length;
            
            // textarea의 스타일 정보 가져오기
            const styles = window.getComputedStyle(textarea);
            const fontSize = parseFloat(styles.fontSize);
            const lineHeight = parseFloat(styles.lineHeight) || fontSize * 1.2;
            const fontFamily = styles.fontFamily;
            const paddingLeft = parseFloat(styles.paddingLeft) || 0;
            const paddingTop = parseFloat(styles.paddingTop) || 0;
            const borderLeft = parseFloat(styles.borderLeftWidth) || 0;
            const borderTop = parseFloat(styles.borderTopWidth) || 0;
            
            // 캔버스를 사용해서 텍스트 너비 계산
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            context.font = `${fontSize}px ${fontFamily}`;
            
            // 현재 라인의 텍스트 너비 계산
            const lineWidth = context.measureText(lines[lines.length - 1]).width;
            
            // textarea의 실제 위치
            const textareaRect = textarea.getBoundingClientRect();
            
            // 스크롤 위치 고려
            const scrollTop = textarea.scrollTop;
            const scrollLeft = textarea.scrollLeft;
            
            // 커서의 절대 위치 계산
            const left = textareaRect.left + paddingLeft + borderLeft + lineWidth - scrollLeft;
            const top = textareaRect.top + paddingTop + borderTop + (currentLine * lineHeight) - scrollTop;
            
            return {
                left: left,
                top: top,
                lineHeight: lineHeight
            };
        }

        window.__handriveCalculateCursorPosition = calculateCursorPosition;

        function acceptEditorSuggestion() {
            if (!contentInput) {
                return false;
            }
            const suggestion = activeEditorSuggestions[activeEditorSuggestionIndex] || null;
            if (!suggestion) {
                return false;
            }
            contentInput.setRangeText(suggestion.insertText, suggestion.start, suggestion.end, "end");
            const cursorPos = (suggestion.start + suggestion.insertText.length) - Math.max(0, suggestion.cursorBack);
            contentInput.setSelectionRange(cursorPos, cursorPos);
            contentInput.focus();
            contentInput.dispatchEvent(new Event("input", { bubbles: true }));
            clearEditorSuggestion();
            return true;
        }

        function renderWriteEditorHighlight() {
            if (!contentInput || !editorHighlight || !editorHighlightCode) {
                return;
            }

            const renderClass = resolveWriteEditorRenderClass();
            const source = contentInput.value || "";
            let highlightedHtml = escapeHtml(source);
            
            // .md 파일일 때는 마크다운 렌더링을 하지 않음
            if (renderClass === "handrive-js") {
                highlightedHtml = highlightJavaScriptCode(source);
            } else if (renderClass === "handrive-editor-md") {
                // .md 파일은 plain text로 표시
                highlightedHtml = escapeHtml(source);
            } else if (renderClass === "handrive-css") {
                highlightedHtml = highlightCssCode(source);
            } else if (renderClass === "handrive-json") {
                highlightedHtml = highlightJsonCode(source);
            } else if (renderClass === "handrive-py") {
                highlightedHtml = highlightPythonCode(source);
            } else if (renderClass === "handrive-editor-html") {
                highlightedHtml = highlightHtmlCode(source);
            }

            editorHighlight.classList.remove("handrive-plain-text", "handrive-editor-md", "handrive-js", "handrive-css", "handrive-json", "handrive-py", "handrive-editor-html");
            editorHighlight.classList.add(renderClass);
            editorHighlightCode.innerHTML = highlightedHtml + (source.endsWith("\n") ? "\u200b" : "");
            syncEditorHighlightScroll();
        }

        function syncMarkdownHelpButtonVisibility() {
            if (!markdownHelpButton && !markdownPreviewButton) {
                renderWriteEditorHighlight();
                return;
            }
            const resolvedExtension = resolveWriteFilenameExtension();
            const isMarkdownTarget = resolvedExtension === DOCS_DEFAULT_EXTENSION;
            if (markdownHelpButton) {
                markdownHelpButton.hidden = !isMarkdownTarget;
                markdownHelpButton.disabled = !isMarkdownTarget;
            }
            if (markdownPreviewButton) {
                markdownPreviewButton.hidden = !isMarkdownTarget;
                markdownPreviewButton.disabled = !isMarkdownTarget;
            }
            renderWriteEditorHighlight();
        }

        function buildFilenameWithExtension(filenameValue, extensionValue) {
            const baseName = String(filenameValue || "").trim();
            if (!baseName) {
                return "";
            }
            const normalizedExtension = normalizeFileExtensionValue(extensionValue, false);
            return baseName + normalizedExtension;
        }

        function getChildDirectories(pathValue) {
            const normalized = normalizePath(pathValue, true);
            return directories
                .filter(function (dirPath) {
                    if (!dirPath) {
                        return false;
                    }
                    return getParentPath(dirPath) === normalized;
                })
                .sort(function (a, b) {
                    return a.localeCompare(b);
                });
        }

        function renderDirectoryOptions() {
            if (!directoryOptions) {
                return;
            }
            directoryOptions.innerHTML = "";
            directories
                .slice()
                .sort(function (a, b) {
                    return String(a).localeCompare(String(b));
                })
                .forEach(function (pathValue) {
                    const option = document.createElement("option");
                    option.value = pathValue;
                    directoryOptions.appendChild(option);
                });
        }

        function updateSelectedDir(pathValue) {
            const normalized = normalizePath(pathValue, true);
            state.selectedDir = normalized;
        }

        function getSaveBrowserRootDir() {
            return scopedHomeDir || "";
        }

        function getSaveBrowserRootLabel() {
            if (!scopedHomeDir) {
                return effectiveRootLabel;
            }
            const homeParts = scopedHomeDir.split("/").filter(Boolean);
            const homeLabel = homeParts.length ? homeParts[homeParts.length - 1] : scopedHomeDir;
            return homeLabel;
        }

        function getScopedVisiblePath(pathValue) {
            const normalized = normalizePath(pathValue, true);
            if (!scopedHomeDir) {
                return normalized;
            }
            if (!normalized || normalized === scopedHomeDir) {
                return "";
            }
            if (normalized.startsWith(scopedHomeDir + "/")) {
                return normalized.slice(scopedHomeDir.length + 1);
            }
            return normalized;
        }

        function isPathInsideScopedHome(pathValue) {
            const normalized = normalizePath(pathValue, true);
            if (!scopedHomeDir || !normalized) {
                return false;
            }
            return normalized === scopedHomeDir || normalized.startsWith(scopedHomeDir + "/");
        }

        function getSaveQuickPaths() {
            const rootDir = getSaveBrowserRootDir();
            const quickPathSet = new Set();
            const quickPaths = [];
            const activePath = normalizePath(state.selectedDir || state.browserDir || initialDir, true);

            function pushQuickPath(pathValue) {
                const normalized = normalizePath(pathValue, true);
                if (!isSuperuser && normalized === "users") {
                    return;
                }
                if (quickPathSet.has(normalized)) {
                    return;
                }
                quickPathSet.add(normalized);
                quickPaths.push(normalized);
            }

            if (isSuperuser && hasDirectory("")) {
                pushQuickPath("");
            } else if (rootDir && hasDirectory(rootDir)) {
                pushQuickPath(rootDir);
            }
            getWritableAncestorPaths(activePath).forEach(function (ancestorPath) {
                if (ancestorPath && ancestorPath !== rootDir) {
                    pushQuickPath(ancestorPath);
                }
            });
            getChildDirectories(rootDir).forEach(function (dirPath) {
                pushQuickPath(dirPath);
            });
            return quickPaths;
        }

        function getWritableAncestorPaths(pathValue) {
            const normalized = normalizePath(pathValue, true);
            const visibleAncestors = [];

            function appendVisible(pathCandidate) {
                const normalizedCandidate = normalizePath(pathCandidate, true);
                if (!normalizedCandidate) {
                    if (isSuperuser && hasDirectory("")) {
                        visibleAncestors.push("");
                    }
                    return;
                }
                if (!hasDirectory(normalizedCandidate)) {
                    return;
                }
                if (!isSuperuser && normalizedCandidate === "users") {
                    return;
                }
                visibleAncestors.push(normalizedCandidate);
            }

            if (!normalized) {
                appendVisible("");
                return visibleAncestors;
            }

            const parts = normalized.split("/").filter(Boolean);
            const accumulated = [];
            appendVisible("");
            parts.forEach(function (part) {
                accumulated.push(part);
                appendVisible(accumulated.join("/"));
            });
            return visibleAncestors;
        }

        function getWritablePathLabel(pathValue) {
            return getWritableAncestorPaths(pathValue)
                .map(function (ancestorPath) {
                    if (!ancestorPath) {
                        return effectiveRootLabel;
                    }
                    return ancestorPath.split("/").slice(-1)[0];
                })
                .join("/");
        }

        function getNearestWritableDirectory(pathValue) {
            let normalized = normalizePath(pathValue, true);
            while (normalized) {
                if (hasDirectory(normalized)) {
                    return normalized;
                }
                normalized = getParentPath(normalized);
            }
            if (scopedHomeDir && hasDirectory(scopedHomeDir)) {
                return scopedHomeDir;
            }
            return isSuperuser && hasDirectory("") ? "" : "";
        }

        function getSaveUpTarget(pathValue) {
            const normalized = normalizePath(pathValue, true);
            if (!normalized) {
                return null;
            }
            const rootDir = getSaveBrowserRootDir();
            if (rootDir && normalized === rootDir) {
                return null;
            }
            const parentPath = getParentPath(normalized);
            if (!parentPath) {
                return isSuperuser ? "" : null;
            }
            if (rootDir && !isPathInsideScopedHome(parentPath)) {
                return rootDir;
            }
            return parentPath;
        }

        function renderBreadcrumb() {
            if (!saveBreadcrumb) {
                return;
            }
            saveBreadcrumb.innerHTML = "";
            const fragment = document.createDocumentFragment();

            function addCrumb(label, pathValue, isCurrent) {
                const crumbButton = document.createElement("button");
                crumbButton.type = "button";
                crumbButton.className = "handrive-save-crumb-btn";
                if (isCurrent) {
                    crumbButton.classList.add("is-current");
                }
                crumbButton.textContent = label;
                crumbButton.addEventListener("click", function () {
                    state.browserDir = pathValue;
                    updateSelectedDir(pathValue);
                    renderBrowser();
                });
                fragment.appendChild(crumbButton);
            }

            const currentPath = normalizePath(state.selectedDir || state.browserDir, true);
            if (scopedHomeDir && isPathInsideScopedHome(currentPath || scopedHomeDir)) {
                buildBreadcrumbItems(currentPath || scopedHomeDir).forEach(function (crumb, index) {
                    if (index > 0) {
                        const separator = document.createElement("span");
                        separator.className = "handrive-save-crumb-sep";
                        separator.textContent = "/";
                        fragment.appendChild(separator);
                    }
                    addCrumb(crumb.label, crumb.path, crumb.isCurrent);
                });
                saveBreadcrumb.appendChild(fragment);
                return;
            }
            const writableAncestors = getWritableAncestorPaths(currentPath);
            if (!writableAncestors.length) {
                if (isSuperuser) {
                    addCrumb(effectiveRootLabel, "", true);
                }
            } else {
                writableAncestors.forEach(function (ancestorPath, index) {
                    if (index > 0) {
                        const separator = document.createElement("span");
                        separator.className = "handrive-save-crumb-sep";
                        separator.textContent = "/";
                        fragment.appendChild(separator);
                    }
                    const label = ancestorPath
                        ? ancestorPath.split("/").slice(-1)[0]
                        : effectiveRootLabel;
                    addCrumb(label, ancestorPath, ancestorPath === currentPath);
                });
            }

            saveBreadcrumb.appendChild(fragment);
        }

        function renderQuickList() {
            if (!saveQuickList) {
                return;
            }
            saveQuickList.innerHTML = "";

            const quickPaths = getSaveQuickPaths();
            quickPaths.forEach(function (pathValue) {
                const item = document.createElement("li");
                const button = document.createElement("button");
                button.type = "button";
                button.className = "handrive-save-shandrive-row";
                if (pathValue === state.browserDir) {
                    button.classList.add("is-active");
                }
                button.textContent = pathValue ? pathValue.split("/").slice(-1)[0] : "HanDrive";
                if (pathValue === scopedHomeDir) {
                    button.textContent = getSaveBrowserRootLabel();
                } else if (!pathValue) {
                    button.textContent = effectiveRootLabel;
                }
                button.addEventListener("click", function () {
                    state.browserDir = pathValue;
                    updateSelectedDir(pathValue);
                    renderBrowser();
                });
                item.appendChild(button);
                saveQuickList.appendChild(item);
            });
        }

        function renderFolderList() {
            if (!saveFolderList) {
                return;
            }
            saveFolderList.innerHTML = "";

            const childDirs = getChildDirectories(state.browserDir);
            if (childDirs.length === 0) {
                const emptyItem = document.createElement("li");
                emptyItem.className = "handrive-save-folder-empty";
                emptyItem.textContent = t("js_no_child_folders", "하위 폴더가 없습니다.");
                saveFolderList.appendChild(emptyItem);
                return;
            }

            childDirs.forEach(function (dirPath) {
                const item = document.createElement("li");
                const row = document.createElement("button");
                row.type = "button";
                row.className = "handrive-save-folder-row";
                if (dirPath === state.selectedDir) {
                    row.classList.add("is-selected");
                }

                const icon = document.createElement("span");
                icon.className = "handrive-save-folder-icon";
                icon.setAttribute("aria-hidden", "true");

                const name = document.createElement("span");
                name.className = "handrive-save-folder-name";
                name.textContent = dirPath.split("/").slice(-1)[0];

                row.appendChild(icon);
                row.appendChild(name);

                row.addEventListener("click", function () {
                    updateSelectedDir(dirPath);
                    renderBreadcrumb();
                    renderFolderList();
                });

                row.addEventListener("dblclick", function () {
                    state.browserDir = dirPath;
                    updateSelectedDir(dirPath);
                    renderBrowser();
                });

                item.appendChild(row);
                saveFolderList.appendChild(item);
            });
        }

        function renderBrowser() {
            if (!saveModal || saveModal.hidden) {
                return;
            }
            renderBreadcrumb();
            renderQuickList();
            renderFolderList();
            if (saveUpButton) {
                saveUpButton.disabled = !getSaveUpTarget(state.browserDir);
            }
        }

        function getHandrivePathLabel(pathValue) {
            if (scopedHomeDir && isPathInsideScopedHome(pathValue || scopedHomeDir)) {
                return buildBreadcrumbItems(pathValue || scopedHomeDir)
                    .map(function (crumb) {
                        return crumb.label;
                    })
                    .join("/");
            }
            return getWritablePathLabel(pathValue) || (isSuperuser ? effectiveRootLabel : "");
        }

        function getFolderCreateBasePath() {
            return normalizeDirectoryInput();
        }

        function setFolderModalOpen(opened) {
            if (!folderModal) {
                return;
            }
            folderModal.hidden = !opened;
            if (opened) {
                const basePath = getFolderCreateBasePath();
                if (folderTargetPath) {
                    folderTargetPath.textContent = getHandrivePathLabel(basePath);
                }
                if (folderNameInput) {
                    folderNameInput.value = "";
                    folderNameInput.focus();
                    folderNameInput.select();
                }
            }
        }

        function syncModalBodyState() {
            syncHandriveModalBodyState();
        }

        function setMarkdownHelpModalOpen(opened) {
            if (!markdownHelpModal) {
                return;
            }
            markdownHelpModal.hidden = !opened;
            syncModalBodyState();
        }

        function setMarkdownPreviewModalOpen(opened) {
            if (!markdownPreviewModal) {
                return;
            }
            markdownPreviewModal.hidden = !opened;
            syncModalBodyState();
        }

        async function openMarkdownPreviewModal() {
            if (!markdownPreviewModal || !markdownPreviewContent) {
                return;
            }

            applyHandriveRenderedContentModeClass(markdownPreviewContent, "plain_text", "handrive-plain-text");
            markdownPreviewContent.innerHTML = "<p>" + t("markdown_preview_loading", "Loading preview...") + "</p>";
            setMarkdownPreviewModalOpen(true);

            if (!previewApiUrl) {
                markdownPreviewContent.innerHTML = "<p>" + t("js_error_request_failed", "요청 처리 중 오류가 발생했습니다.") + "</p>";
                return;
            }

            try {
                let previewExtension = getPathFileExtension(originalPath) || DOCS_DEFAULT_EXTENSION;
                if (!originalPath && saveFilenameInput) {
                    const parsed = parseFileNameWithExtension(saveFilenameInput.value);
                    if (parsed.extension) {
                        previewExtension = parsed.extension;
                    } else if (saveExtensionSelect) {
                        previewExtension = getSelectedExtensionOrDefault();
                    }
                }
                const data = await requestJson(
                    previewApiUrl,
                    buildPostOptions({
                        original_path: originalPath,
                        target_dir: normalizePath(initialDir, true),
                        extension: previewExtension,
                        content: contentInput ? contentInput.value : "",
                    })
                );
                const renderMode = data && (data.render_mode === "markdown" || data.render_mode === "office")
                    ? data.render_mode
                    : "plain_text";
                const renderClass = data && typeof data.render_class === "string" ? data.render_class : "";
                applyHandriveRenderedContentModeClass(markdownPreviewContent, renderMode, renderClass);
                markdownPreviewContent.innerHTML = data && typeof data.html === "string" ? data.html : "";
                applyHandriveCodeHighlighting(markdownPreviewContent, renderClass || "ui-markdown");
            } catch (error) {
                applyHandriveRenderedContentModeClass(markdownPreviewContent, "plain_text", "handrive-plain-text");
                markdownPreviewContent.innerHTML =
                    "<p>" +
                    (error && error.message ? error.message : t("js_error_processing_failed", "처리 중 오류가 발생했습니다.")) +
                    "</p>";
            }
        }

        function setSaveModalOpen(opened) {
            if (!saveModal) {
                return;
            }
            saveModal.hidden = !opened;
            syncModalBodyState();

            if (!opened) {
                setFolderModalOpen(false);
                return;
            }

            let modalInitialDir = "";
            try {
                modalInitialDir = normalizeDirectoryInput();
            } catch (error) {
                modalInitialDir = "";
            }
            if (!modalInitialDir) {
                modalInitialDir = normalizePath(initialDir, true) || (isSuperuser ? "" : scopedHomeDir);
            }
            if (!hasDirectory(modalInitialDir)) {
                modalInitialDir = getNearestWritableDirectory(modalInitialDir || initialDir);
            }
            state.browserDir = modalInitialDir;
            updateSelectedDir(modalInitialDir);
            renderBrowser();

            const parsedMainFilename = parseFileNameWithExtension(filenameInput ? filenameInput.value : "");
            const extensionCandidate = parsedMainFilename.extension || getPathFileExtension(originalPath) || DOCS_DEFAULT_EXTENSION;
            syncExtensionSelectFromValue(extensionCandidate);
            const filenameCandidate = String(parsedMainFilename.filename || "").trim();

            if (saveFilenameInput) {
                saveFilenameInput.value = buildFilenameWithExtension(filenameCandidate, extensionCandidate);
            }

            if (saveFilenameInput) {
                saveFilenameInput.focus();
                saveFilenameInput.select();
            }
        }

        function submitMediaEditorSave(options) {
            const settings = options || {};
            const redirectOnSuccess = settings.redirectOnSuccess !== false;
            const onSuccess = typeof settings.onSuccess === "function" ? settings.onSuccess : null;
            const editor = getActiveWriteMediaEditor();
            const saveUrl = getActiveWriteMediaSaveUrl();
            if (!isMediaWriteEditor || !editor || typeof editor.saveToServer !== "function") {
                alertError(new Error(t("js_preview_unavailable", "미리보기를 표시할 수 없습니다.")));
                return;
            }
            if (!saveUrl || !originalPath) {
                alertError(new Error(t("js_request_failed", "요청 처리 중 오류가 발생했습니다.")));
                return;
            }

            if (
                writeEditorKind === "image" &&
                editor &&
                typeof editor.getIsDirty === "function" &&
                !editor.getIsDirty() &&
                getWriteMediaFilenameValue() &&
                getWriteMediaFilenameValue() !== getWriteMediaOriginalFilename()
            ) {
                submitImageRenameOnly().catch(alertError);
                return;
            }

            const csrfToken = getCsrfToken();
            const savingText = writeEditorKind === "image"
                ? t("image_editor_saving", "저장 중...")
                : writeEditorKind === "video"
                    ? t("video_editor_saving", "저장 중...")
                    : t("audio_editor_saving", "저장 중...");
            const originalButtonText = saveButton ? saveButton.textContent : "";
            if (saveButton) {
                saveButton.disabled = true;
                saveButton.textContent = savingText;
            }

            let imageFilename = "";
            if (writeEditorKind === "image") {
                imageFilename = String(filenameInput ? filenameInput.value || "" : "").trim();
                if (!imageFilename) {
                    alertError(new Error(t("js_filename_required", "파일명을 입력해주세요.")));
                    if (saveButton) {
                        saveButton.disabled = false;
                        saveButton.textContent = originalButtonText;
                    }
                    return;
                }
            }

            editor.saveToServer(saveUrl, csrfToken, originalPath, function (result) {
                if (saveButton) {
                    saveButton.disabled = false;
                    saveButton.textContent = originalButtonText;
                    saveButton.classList.toggle("is-dirty", hasUnsavedMediaWriteChanges());
                }
                if (!result || !result.ok) {
                    const fallbackMessage = writeEditorKind === "image"
                        ? t("image_editor_save_error", "저장 실패")
                        : writeEditorKind === "video"
                            ? t("video_editor_save_error", "비디오 저장 실패")
                            : t("audio_editor_save_error", "오디오 저장 실패");
                    alertError(new Error((result && result.error) || fallbackMessage));
                    return;
                }
                markCurrentAsSaved();
                if (onSuccess) {
                    onSuccess(result || {});
                    return;
                }
                if (!redirectOnSuccess) {
                    return;
                }
                const targetPath = (result && (result.slug_path || result.path)) || originalPath;
                runWithBeforeUnloadBypass(function () {
                    window.location.href = buildViewUrl(handriveBaseUrl, targetPath);
                });
            }, writeEditorKind === "image" ? { filename: imageFilename } : {});
        }

        async function submitSave(options) {
            const settings = options || {};
            const redirectOnSuccess = settings.redirectOnSuccess !== false;
            const onSuccess = typeof settings.onSuccess === "function" ? settings.onSuccess : null;

            let finalFilename = String(filenameInput ? filenameInput.value : "").trim();
            let targetExtension = DOCS_DEFAULT_EXTENSION;
            let targetDir = "";
            if (isPublicWriteDirectSave && originalPath) {
                targetDir = getParentPath(originalPath);
                finalFilename = getPathFileStem(originalPath) || finalFilename;
                targetExtension = getPathFileExtension(originalPath) || DOCS_DEFAULT_EXTENSION;
            } else {
                try {
                    targetDir = normalizeDirectoryInput();
                    if (saveModal && !saveModal.hidden && saveFilenameInput) {
                        const saveTarget = getSaveModalFilenameAndExtension();
                        finalFilename = saveTarget.filename;
                        targetExtension = saveTarget.extension;
                    } else {
                        if (!finalFilename) {
                            throw new Error(t("js_filename_required", "파일명을 입력해주세요."));
                        }
                        targetExtension = getSelectedExtensionOrDefault();
                    }
                } catch (error) {
                    alertError(error);
                    return;
                }
            }

            if (!isPublicWriteDirectSave && !hasDirectory(targetDir)) {
                window.alert(
                    t("js_select_or_create_folder", "저장 위치를 선택하거나 폴더를 먼저 생성해주세요.")
                );
                return;
            }

            upsertDirectory(targetDir);
            if (filenameInput) {
                filenameInput.value = finalFilename;
            }
            if (saveFilenameInput) {
                saveFilenameInput.value = buildFilenameWithExtension(finalFilename, targetExtension);
            }

            try {
                const payload = {
                    original_path: originalPath,
                    target_dir: targetDir,
                    filename: finalFilename,
                    extension: targetExtension,
                    content: contentInput ? contentInput.value : ""
                };
                if (writeRequiresCommitMessage) {
                    const commitMessage = await promptWriteCommitMessage(originalPath || targetDir);
                    if (commitMessage === null) {
                        return;
                    }
                    payload.commit_message = commitMessage;
                }
                const data = await requestJson(saveApiUrl, buildPostOptions(payload));
                writeMarkdownUploadedImagePaths = [];
                markCurrentAsSaved();

                if (saveModal && !saveModal.hidden) {
                    setSaveModalOpen(false);
                }

                if (onSuccess) {
                    onSuccess(data || {});
                    return data || {};
                }

                if (!redirectOnSuccess) {
                    return data || {};
                }

                if (data && data.slug_path) {
                    runWithBeforeUnloadBypass(function () {
                        window.location.href = buildViewUrl(handriveBaseUrl, data.slug_path);
                    });
                    return data || {};
                }
                runWithBeforeUnloadBypass(function () {
                    window.location.href = handriveRootUrl;
                });
                return data || {};
            } catch (error) {
                alertError(error);
            }
        }

        rawDirectories.forEach(function (pathValue) {
            const normalized = upsertDirectory(pathValue);
            if (!normalized) {
                return;
            }
            const parts = normalized.split("/").filter(Boolean);
            const accumulated = [];
            parts.forEach(function (part) {
                accumulated.push(part);
                upsertDirectory(accumulated.join("/"));
            });
        });
        if (isSuperuser) {
            upsertDirectory("");
        }
        upsertDirectory(initialDir || "");
        renderDirectoryOptions();
        if (saveExtensionSelect) {
            const initialExtension = getPathFileExtension(originalPath) || DOCS_DEFAULT_EXTENSION;
            syncExtensionSelectFromValue(initialExtension);
        }
        syncMarkdownHelpButtonVisibility();
        showWriteMediaSurface();

        async function createFolderFromModal() {
            const folderName = folderNameInput ? folderNameInput.value : "";
            const trimmed = String(folderName || "").trim();
            if (!trimmed) {
                window.alert(t("js_folder_name_required", "폴더 이름을 입력해주세요."));
                return;
            }

            const parentDir = getFolderCreateBasePath();
            if (!hasDirectory(parentDir)) {
                window.alert(
                    t("js_invalid_selected_path", "선택 경로가 유효하지 않습니다. 목록에서 폴더를 선택해주세요.")
                );
                return;
            }

            try {
                var commitMessage = "";
                if (writeRequiresCommitMessage) {
                    commitMessage = await promptWriteCommitMessage(parentDir);
                    if (commitMessage === null) {
                        return;
                    }
                }
                const data = await requestJson(
                    mkdirApiUrl,
                    buildPostOptions({
                        parent_dir: parentDir,
                        folder_name: trimmed,
                        commit_message: commitMessage
                    })
                );
                const createdPath = upsertDirectory(data.path || "");
                renderDirectoryOptions();
                updateSelectedDir(createdPath);
                state.browserDir = parentDir;
                renderBrowser();
                setFolderModalOpen(false);
            } catch (error) {
                alertError(error);
            }
        }

        if (createFolderButton) {
            createFolderButton.addEventListener("click", function () {
                setFolderModalOpen(true);
            });
        }

        if (saveButton) {
            saveButton.addEventListener("click", function () {
                if (isMediaWriteEditor) {
                    submitMediaEditorSave();
                    return;
                }
                if (isPublicWriteDirectSave) {
                    submitSave();
                    return;
                }
                if (saveModal) {
                    setSaveModalOpen(true);
                    return;
                }
                submitSave();
            });
        }

        if (cancelButton) {
            cancelButton.addEventListener("click", function () {
                const targetDir = getCancelTargetDirectory();
                attemptLeaveWithUnsavedGuard(function () {
                    cleanupWriteMarkdownUploadedImages()
                        .catch(alertError)
                        .finally(function () {
                            bypassUnsavedBeforeUnload = true;
                            window.location.assign(buildListUrl(handriveBaseUrl, targetDir, handriveRootUrl));
                        });
                });
            });
        }

        if (saveExtensionSelect && saveFilenameInput) {
            saveExtensionSelect.addEventListener("change", function () {
                const selectedValue = String(saveExtensionSelect.value || "").trim().toLowerCase();
                let selectedExtension = DOCS_DEFAULT_EXTENSION;
                if (selectedValue === DOCS_CUSTOM_EXTENSION_OPTION_VALUE) {
                    const parsedCurrent = parseFileNameWithExtension(saveFilenameInput.value);
                    if (parsedCurrent.extension) {
                        customExtensionValue = parsedCurrent.extension;
                    }
                    try {
                        selectedExtension = getSelectedExtensionOrDefault();
                    } catch (error) {
                        selectedExtension = DOCS_DEFAULT_EXTENSION;
                    }
                } else {
                    try {
                        selectedExtension = getSelectedExtensionOrDefault();
                    } catch (error) {
                        alertError(error);
                        return;
                    }
                }

                const parsed = parseFileNameWithExtension(saveFilenameInput.value);
                const baseName = parsed.filename || String(filenameInput ? filenameInput.value : "").trim();
                saveFilenameInput.value = buildFilenameWithExtension(baseName, selectedExtension);
                saveFilenameInput.focus();
                syncMarkdownHelpButtonVisibility();
            });

            saveFilenameInput.addEventListener("input", function () {
                try {
                    const parsed = parseFileNameWithExtension(saveFilenameInput.value);
                    if (parsed.extension && extensionPresetSet.has(parsed.extension)) {
                        saveExtensionSelect.value = parsed.extension;
                        return;
                    }
                    if (parsed.extension) {
                        customExtensionValue = parsed.extension;
                        if (saveExtensionSelect.querySelector('option[value="' + DOCS_CUSTOM_EXTENSION_OPTION_VALUE + '"]')) {
                            saveExtensionSelect.value = DOCS_CUSTOM_EXTENSION_OPTION_VALUE;
                        }
                    }
                } catch (error) {
                    // Ignore extension auto-sync errors while typing.
                }
            });
        }

        if (filenameInput) {
            const refreshMarkdownButtonVisibility = function () {
                syncMarkdownHelpButtonVisibility();
            };
            filenameInput.addEventListener("input", refreshMarkdownButtonVisibility);
            filenameInput.addEventListener("change", refreshMarkdownButtonVisibility);
        }

        if (contentInput) {
            contentInput.addEventListener("paste", function (event) {
                writeMarkdownImageInput.handlePaste(event);
            });
            contentInput.addEventListener("dragover", function (event) {
                writeMarkdownImageInput.handleDragOver(event);
            });
            contentInput.addEventListener("drop", function (event) {
                writeMarkdownImageInput.handleDrop(event);
            });
            contentInput.addEventListener("input", function () {
                renderWriteEditorHighlight();
                updateEditorSuggestion();
            });
            contentInput.addEventListener("scroll", syncEditorHighlightScroll, { passive: true });
            let editorFontSize = 16;
            contentInput.addEventListener("wheel", function (event) {
                if (!event.ctrlKey && !event.metaKey) return;
                event.preventDefault();
                const delta = event.deltaY < 0 ? 2 : -2;
                editorFontSize = Math.max(8, Math.min(40, editorFontSize + delta));
                contentInput.style.fontSize = editorFontSize + "px";
                if (editorHighlight) {
                    editorHighlight.style.fontSize = editorFontSize + "px";
                }
                syncEditorHighlightScroll();
            }, { passive: false });
            contentInput.addEventListener("click", function () {
                clearEditorSuggestion();
            });
            contentInput.addEventListener("keydown", function (event) {
                if ((event.metaKey || event.ctrlKey) && !event.altKey && String(event.key || "").toLowerCase() === "s") {
                    event.preventDefault();
                    if (saveButton && !saveButton.disabled) {
                        saveButton.click();
                    }
                    return;
                }
                if (event.key === "Escape") {
                    clearEditorSuggestion();
                    return;
                }
                if (!editorSuggest.hidden && event.key === "ArrowDown") {
                    event.preventDefault();
                    moveWriteEditorSuggestion(1);
                    return;
                }
                if (!editorSuggest.hidden && event.key === "ArrowUp") {
                    event.preventDefault();
                    moveWriteEditorSuggestion(-1);
                    return;
                }
                if (!editorSuggest.hidden && event.key === "Enter") {
                    if (acceptEditorSuggestion()) {
                        event.preventDefault();
                    }
                    return;
                }
                if (event.key !== "Tab" || event.shiftKey) {
                    return;
                }
                if (acceptEditorSuggestion()) {
                    event.preventDefault();
                    return;
                }
                event.preventDefault();
                replaceTextareaSelection("    ", 4, 4);
                return;
            });
            contentInput.addEventListener("keydown", function (event) {
                if (
                    event.key === "ArrowLeft" ||
                    event.key === "ArrowRight" ||
                    event.key === "Home" ||
                    event.key === "End" ||
                    event.key === "PageUp" ||
                    event.key === "PageDown"
                ) {
                    clearEditorSuggestion();
                }
            });
        }

        if (editorSuggest && !writeSuggestEventsBound) {
            writeSuggestEventsBound = true;
            editorSuggest.addEventListener("mousedown", function (event) {
                event.preventDefault();
            });
            editorSuggest.addEventListener("click", function (event) {
                const target = event.target instanceof Element
                    ? event.target.closest("[data-suggest-index]")
                    : null;
                if (!target) {
                    return;
                }
                const index = Number(target.getAttribute("data-suggest-index"));
                if (!Number.isInteger(index)) {
                    return;
                }
                activeEditorSuggestionIndex = index;
                if (acceptEditorSuggestion()) {
                    event.preventDefault();
                }
            });
        }

        if (markdownHelpButton) {
            markdownHelpButton.addEventListener("click", function () {
                setMarkdownHelpModalOpen(true);
            });
            markdownHelpButton.addEventListener("mouseup", function (event) {
                if (event.currentTarget && typeof event.currentTarget.blur === "function") {
                    event.currentTarget.blur();
                }
            });
        }

        if (markdownPreviewButton) {
            markdownPreviewButton.addEventListener("click", function () {
                openMarkdownPreviewModal();
            });
            markdownPreviewButton.addEventListener("mouseup", function (event) {
                if (event.currentTarget && typeof event.currentTarget.blur === "function") {
                    event.currentTarget.blur();
                }
            });
        }

        markdownSnippetButtons.forEach(function (button) {
            button.addEventListener("click", function () {
                const snippetType = button.getAttribute("data-editor-snippet") || "";
                const currentExtension = getCurrentEditorExtension();
                if (currentExtension === DOCS_DEFAULT_EXTENSION) {
                    insertMarkdownSnippet(snippetType);
                } else if (!insertLanguageSnippet(snippetType, currentExtension)) {
                    insertMarkdownSnippet(snippetType);
                }
                closeMarkdownSnippetMenu();
            });
        });

        if (editorSurface) {
            editorSurface.addEventListener("contextmenu", function (event) {
                const currentExtension = getCurrentEditorExtension();
                if (currentExtension !== DOCS_DEFAULT_EXTENSION) {
                    closeMarkdownSnippetMenu();
                    return;
                }
                const visibleCount = syncSnippetMenuItemsByExtension(currentExtension);
                if (visibleCount <= 0) {
                    closeMarkdownSnippetMenu();
                    return;
                }
                event.preventDefault();
                openMarkdownSnippetMenu(event.clientX, event.clientY);
            });
        }

        if (markdownHelpBackdrop) {
            markdownHelpBackdrop.addEventListener("click", function () {
                setMarkdownHelpModalOpen(false);
            });
        }

        if (markdownPreviewBackdrop) {
            markdownPreviewBackdrop.addEventListener("click", function () {
                setMarkdownPreviewModalOpen(false);
            });
        }

        if (unsavedModalBackdrop) {
            unsavedModalBackdrop.addEventListener("click", function () {
                closeUnsavedModal("cancel");
            });
        }

        if (unsavedCancelButton) {
            unsavedCancelButton.addEventListener("click", function () {
                closeUnsavedModal("cancel");
            });
        }

        if (unsavedLeaveButton) {
            unsavedLeaveButton.addEventListener("click", function () {
                closeUnsavedModal("leave");
            });
        }

        if (unsavedSaveButton) {
            unsavedSaveButton.addEventListener("click", function () {
                closeUnsavedModal("save");
            });
        }

        if (saveModalBackdrop) {
            saveModalBackdrop.addEventListener("click", function () {
                pendingSaveThenLeaveAction = null;
                setSaveModalOpen(false);
            });
        }

        if (saveCloseButton) {
            saveCloseButton.addEventListener("click", function () {
                pendingSaveThenLeaveAction = null;
                setSaveModalOpen(false);
            });
        }

        if (saveCancelButton) {
            saveCancelButton.addEventListener("click", function () {
                pendingSaveThenLeaveAction = null;
                setSaveModalOpen(false);
            });
        }

        if (saveConfirmButton) {
            saveConfirmButton.addEventListener("click", function () {
                if (pendingSaveThenLeaveAction) {
                    submitSaveThenLeave();
                    return;
                }
                if (isMediaWriteEditor) {
                    submitMediaEditorSave();
                    return;
                }
                submitSave();
            });
        }

        if (folderModalBackdrop) {
            folderModalBackdrop.addEventListener("click", function () {
                setFolderModalOpen(false);
            });
        }

        if (folderCancelButton) {
            folderCancelButton.addEventListener("click", function () {
                setFolderModalOpen(false);
            });
        }

        if (folderCreateButton) {
            folderCreateButton.addEventListener("click", function () {
                createFolderFromModal();
            });
        }

        if (saveUpButton) {
            saveUpButton.addEventListener("click", function () {
                const nextPath = getSaveUpTarget(state.browserDir);
                if (!nextPath && nextPath !== "") {
                    return;
                }
                state.browserDir = nextPath;
                updateSelectedDir(nextPath);
                renderBrowser();
            });
        }

        if (folderNameInput) {
            folderNameInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    createFolderFromModal();
                }
            });
        }

        document.addEventListener("keydown", function (event) {
            if (event.key !== "Escape") {
                return;
            }
            if (unsavedModal && !unsavedModal.hidden) {
                closeUnsavedModal("cancel");
                return;
            }
            if (markdownSnippetMenu && !markdownSnippetMenu.hidden) {
                closeMarkdownSnippetMenu();
                return;
            }
            if (markdownPreviewModal && !markdownPreviewModal.hidden) {
                setMarkdownPreviewModalOpen(false);
                return;
            }
            if (markdownHelpModal && !markdownHelpModal.hidden) {
                setMarkdownHelpModalOpen(false);
                return;
            }
            if (folderModal && !folderModal.hidden) {
                setFolderModalOpen(false);
                return;
            }
            if (saveModal && !saveModal.hidden) {
                setSaveModalOpen(false);
                return;
            }
        });

        window.addEventListener("beforeunload", function (event) {
            if (bypassUnsavedBeforeUnload || !hasUnsavedWriteChanges()) {
                return;
            }
            event.preventDefault();
            event.returnValue = "";
        });

        document.addEventListener("click", function (event) {
            if (event.defaultPrevented || !hasUnsavedWriteChanges()) {
                return;
            }
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                return;
            }
            if (!(event.target instanceof Element)) {
                return;
            }

            const anchor = event.target.closest("a[href]");
            if (!anchor) {
                return;
            }
            if (anchor.hasAttribute("download")) {
                return;
            }

            const targetAttr = String(anchor.getAttribute("target") || "").toLowerCase();
            if (targetAttr && targetAttr !== "_self") {
                return;
            }

            const hrefAttr = String(anchor.getAttribute("href") || "").trim();
            if (!hrefAttr || hrefAttr === "#" || hrefAttr.startsWith("javascript:")) {
                return;
            }

            if (hrefAttr.startsWith("#")) {
                return;
            }

            event.preventDefault();
            attemptLeaveWithUnsavedGuard(function () {
                window.location.assign(anchor.href);
            });
        }, true);

        document.addEventListener("mousedown", function (event) {
            if (!markdownSnippetMenu || markdownSnippetMenu.hidden) {
                return;
            }
            if (event.target instanceof Element && markdownSnippetMenu.contains(event.target)) {
                return;
            }
            closeMarkdownSnippetMenu();
        });

        document.addEventListener("submit", function (event) {
            if (event.defaultPrevented) {
                return;
            }
            if (!(event.target instanceof HTMLFormElement)) {
                return;
            }
            const form = event.target;
            if (form.hasAttribute("data-bypass-unsaved-guard")) {
                return;
            }
            if (!hasUnsavedWriteChanges()) {
                return;
            }
            event.preventDefault();
            attemptLeaveWithUnsavedGuard(function () {
                form.submit();
            });
        }, true);

        document.addEventListener("keydown", function (event) {
            const key = String(event.key || "");
            const loweredKey = key.toLowerCase();
            const isReloadHotkey = key === "F5" || ((event.metaKey || event.ctrlKey) && loweredKey === "r");
            if (!isReloadHotkey || !hasUnsavedWriteChanges()) {
                return;
            }
            event.preventDefault();
            attemptLeaveWithUnsavedGuard(function () {
                window.location.reload();
            });
        }, true);

        window.addEventListener("resize", scheduleContentInputAutoHeight, { passive: true });
        window.addEventListener("orientationchange", scheduleContentInputAutoHeight, { passive: true });
        window.addEventListener("scroll", closeMarkdownSnippetMenu, { passive: true });
        window.addEventListener("resize", closeMarkdownSnippetMenu, { passive: true });

        if (window.visualViewport) {
            window.visualViewport.addEventListener("resize", scheduleContentInputAutoHeight, { passive: true });
            window.visualViewport.addEventListener("scroll", scheduleContentInputAutoHeight, { passive: true });
        }

        if (window.ResizeObserver) {
            const autoHeightObserver = new ResizeObserver(scheduleContentInputAutoHeight);
            autoHeightObserver.observe(root);
            const toolbarWrap = document.querySelector(".handrive-toolbar-wrap");
            if (toolbarWrap) {
                autoHeightObserver.observe(toolbarWrap);
            }
        }

        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(scheduleContentInputAutoHeight).catch(function () {});
        }

        scheduleContentInputAutoHeight();
        renderWriteEditorHighlight();
    }

    initializeHandriveAuthInteraction();
    initializeHandrivePageHelpModal();
    initializeHandriveToolbarAutoCollapse();

    if (pageType === "list") {
        initializeListPage();
        return;
    }

    if (pageType === "view") {
        initializeViewPage();
        return;
    }

    if (pageType === "write") {
        initializeWritePage();
    }
})();
