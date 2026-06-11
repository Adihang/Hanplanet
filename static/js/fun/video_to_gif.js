(function () {
    "use strict";

    var root = document.querySelector("[data-video-to-gif]");
    if (!root) return;

    var form = root.querySelector("[data-video-to-gif-form]");
    var urlForm = root.querySelector("[data-video-to-gif-url-form]");
    var urlInput = root.querySelector("[data-video-to-gif-url]");
    var urlSubmitButton = root.querySelector("[data-video-to-gif-url-submit]");
    var stage = root.querySelector("[data-video-to-gif-dropzone]");
    var emptyState = root.querySelector("[data-video-to-gif-empty]");
    var video = root.querySelector("[data-video-to-gif-video]");
    var fileInput = root.querySelector("[data-video-to-gif-file]");
    var fileOpenButton = root.querySelector("[data-video-to-gif-file-open]");
    var convertButton = root.querySelector("[data-video-to-gif-convert]");
    var statusEl = root.querySelector("[data-video-to-gif-status]");
    var modeInputs = root.querySelectorAll("[data-video-to-gif-resolution-mode]");
    var ratioField = root.querySelector("[data-video-to-gif-ratio-field]");
    var pixelsField = root.querySelector("[data-video-to-gif-pixels-field]");
    var ratioInput = root.querySelector("[data-video-to-gif-scale-ratio]");
    var widthInput = root.querySelector("[data-video-to-gif-width]");
    var heightInput = root.querySelector("[data-video-to-gif-height]");
    var framesInput = root.querySelector("[data-video-to-gif-frames]");
    var frameMaxEl = root.querySelector("[data-video-to-gif-frame-max]");
    var sourceMetaEl = root.querySelector("[data-video-to-gif-source-meta]");
    var outputMetaEl = root.querySelector("[data-video-to-gif-output-meta]");
    var resultEmpty = root.querySelector("[data-video-to-gif-result-empty]");
    var resultStage = root.querySelector(".video-to-gif-result-stage");
    var resultImage = root.querySelector("[data-video-to-gif-result-image]");
    var resultMeta = root.querySelector("[data-video-to-gif-result-meta]");
    var downloadLink = root.querySelector("[data-video-to-gif-download]");
    var sourceModal = document.querySelector("[data-upload-source-modal]");
    var sourceLocalButton = sourceModal ? sourceModal.querySelector("[data-upload-source-local]") : null;
    var sourceHandriveButton = sourceModal ? sourceModal.querySelector("[data-upload-source-handrive]") : null;
    var sourceCloseButton = sourceModal ? sourceModal.querySelector("[data-upload-source-close]") : null;
    var handriveModal = document.querySelector("[data-video-to-gif-handrive-modal]");
    var handriveCloseButton = handriveModal ? handriveModal.querySelector("[data-video-to-gif-handrive-close]") : null;
    var handriveList = handriveModal ? handriveModal.querySelector("[data-video-to-gif-handrive-list]") : null;
    var handriveStatus = handriveModal ? handriveModal.querySelector("[data-video-to-gif-handrive-status]") : null;
    var handrivePageHelpers = window.HandrivePageHelpers || {};
    var handriveListRenderHelpers = window.HandriveListRenderHelpers || {};
    var buildTreePrefixElement = handriveListRenderHelpers.buildTreePrefixElement || buildFallbackTreePrefixElement;
    var createTypeMarker = handriveListRenderHelpers.createTypeMarker || createFallbackTypeMarker;
    var getFileIconKey = handrivePageHelpers.getFileIconKey || function () { return "video"; };
    var isGenericFileIconKey = handrivePageHelpers.isGenericFileIconKey || function () { return true; };

    var metadataUrl = root.dataset.metadataUrl || "";
    var convertUrl = root.dataset.convertUrl || "";
    var handriveEnabled = root.dataset.handriveEnabled === "1";
    var handriveListUrl = root.dataset.handriveListUrl || "";
    var handriveDownloadUrl = root.dataset.handriveDownloadUrl || "";
    var maxUploadBytes = parseInt(root.dataset.maxUploadBytes || "0", 10) || 250 * 1024 * 1024;
    var maxOutputBytes = parseInt(root.dataset.maxOutputBytes || "0", 10) || 80 * 1024 * 1024;
    var maxDimension = parseInt(root.dataset.maxDimension || "0", 10) || 1920;
    var gifEstimateBytesPerPixelFrame = 0.14;
    var gifEstimateFrameOverheadBytes = 512;
    var gifEstimateBaseOverheadBytes = 32 * 1024;
    var videoExtensions = new Set([
        ".3g2",
        ".3gp",
        ".asf",
        ".avi",
        ".divx",
        ".dv",
        ".f4v",
        ".flv",
        ".m2ts",
        ".m4v",
        ".mkv",
        ".mod",
        ".mov",
        ".mp4",
        ".mpeg",
        ".mpg",
        ".mts",
        ".mxf",
        ".ogv",
        ".rm",
        ".rmvb",
        ".tod",
        ".ts",
        ".vob",
        ".webm",
        ".wmv",
    ]);
    var state = {
        file: null,
        sourceKind: "",
        sourceUrl: "",
        sourceName: "",
        metadata: null,
        objectUrl: "",
        resultUrl: "",
        handrivePath: "",
        handriveRootPath: "",
        handriveEntriesByPath: new Map(),
        handriveExpandedPaths: new Set(),
        handriveLoadingPaths: new Set(),
        stageLoadingReasons: new Set(),
        resolutionMode: "ratio",
        sizeEditAxis: "width",
        busy: false,
        metadataController: null,
        convertController: null,
        handriveController: null,
    };

    function message(name, fallback) {
        return root.dataset[name] || fallback || "";
    }

    function isEnglishUi() {
        return String(document.documentElement.lang || "").toLowerCase().indexOf("en") === 0;
    }

    function selectServerMessage(payload, fallback) {
        if (!payload || typeof payload !== "object") return fallback || "";
        var lang = isEnglishUi() ? "en" : "ko";
        var messages = payload.error_messages || payload.messages;
        if (messages && typeof messages === "object") {
            return messages[lang] || messages.ko || messages.en || fallback || "";
        }
        return payload.error_message || payload.message || payload.error || fallback || "";
    }

    function getCsrfToken() {
        var input = form ? form.querySelector('input[name="csrfmiddlewaretoken"]') : null;
        if (input && input.value) return input.value;
        var meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.getAttribute("content") || "" : "";
    }

    function setStatus(text, isError) {
        if (!statusEl) return;
        statusEl.textContent = text || "";
        statusEl.classList.toggle("is-error", Boolean(isError));
    }

    function setInlineStatus(target, text, isError) {
        if (!target) return;
        target.textContent = text || "";
        target.classList.toggle("is-error", Boolean(isError));
    }

    function setStageLoading(reason, isLoading) {
        if (!stage) return;
        var key = String(reason || "loading");
        if (isLoading) {
            state.stageLoadingReasons.add(key);
        } else {
            state.stageLoadingReasons.delete(key);
        }
        var loading = state.stageLoadingReasons.size > 0;
        stage.classList.toggle("is-loading", loading);
        stage.setAttribute("aria-busy", loading ? "true" : "false");
    }

    function clearStageLoading() {
        state.stageLoadingReasons.clear();
        setStageLoading("loading", false);
    }

    function setResultLoading(isLoading) {
        if (!resultStage) return;
        resultStage.classList.toggle("is-loading", Boolean(isLoading));
        resultStage.setAttribute("aria-busy", isLoading ? "true" : "false");
    }

    function getPathExtension(pathValue) {
        var name = String(pathValue || "").split("?")[0].split("#")[0].split("/").pop() || "";
        var dotIndex = name.lastIndexOf(".");
        if (dotIndex <= 0) return "";
        return name.slice(dotIndex).toLowerCase();
    }

    function isAcceptedFile(file) {
        if (!file) return false;
        var type = String(file.type || "").toLowerCase();
        if (type.indexOf("video/") === 0) return true;
        return videoExtensions.has(getPathExtension(file.name || ""));
    }

    function getClipboardFile(event) {
        var clipboardData = event && event.clipboardData;
        if (!clipboardData) return null;
        var files = [];
        if (clipboardData.files && clipboardData.files.length) {
            files = Array.from(clipboardData.files);
        } else if (clipboardData.items && clipboardData.items.length) {
            Array.from(clipboardData.items).forEach(function (item) {
                if (item.kind !== "file") return;
                var file = item.getAsFile();
                if (file) files.push(file);
            });
        }
        if (!files.length) return null;
        for (var i = 0; i < files.length; i += 1) {
            if (isAcceptedFile(files[i])) return files[i];
        }
        return files[0];
    }

    function isVideoName(pathValue) {
        return videoExtensions.has(getPathExtension(pathValue));
    }

    function guessVideoMimeType(pathValue) {
        return {
            ".3g2": "video/3gpp2",
            ".3gp": "video/3gpp",
            ".asf": "video/x-ms-asf",
            ".avi": "video/x-msvideo",
            ".divx": "video/divx",
            ".dv": "video/dv",
            ".f4v": "video/x-f4v",
            ".flv": "video/x-flv",
            ".m2ts": "video/mp2t",
            ".m4v": "video/x-m4v",
            ".mkv": "video/x-matroska",
            ".mod": "video/mpeg",
            ".mov": "video/quicktime",
            ".mp4": "video/mp4",
            ".mpeg": "video/mpeg",
            ".mpg": "video/mpeg",
            ".mts": "video/mp2t",
            ".mxf": "application/mxf",
            ".ogv": "video/ogg",
            ".rm": "application/vnd.rn-realmedia",
            ".rmvb": "application/vnd.rn-realmedia-vbr",
            ".tod": "video/mpeg",
            ".ts": "video/mp2t",
            ".vob": "video/dvd",
            ".webm": "video/webm",
            ".wmv": "video/x-ms-wmv",
        }[getPathExtension(pathValue)] || "video/mp4";
    }

    function revokeObjectUrl(key) {
        if (state[key]) {
            URL.revokeObjectURL(state[key]);
            state[key] = "";
        }
    }

    function showVideoPreview(source, options) {
        var settings = options || {};
        revokeObjectUrl("objectUrl");
        var previewUrl = "";
        if (settings.remote) {
            previewUrl = String(source || "");
        } else {
            var objectUrl = URL.createObjectURL(source);
            state.objectUrl = objectUrl;
            previewUrl = objectUrl;
        }
        if (video) {
            setStageLoading("video", true);
            video.src = previewUrl;
            video.hidden = false;
            video.load();
            window.setTimeout(function () {
                if (video.readyState >= 2) {
                    setStageLoading("video", false);
                }
            }, 0);
        } else {
            setStageLoading("video", false);
        }
        if (emptyState) emptyState.hidden = true;
        if (stage) stage.classList.add("has-image");
    }

    function clearResult() {
        revokeObjectUrl("resultUrl");
        if (resultImage) {
            resultImage.removeAttribute("src");
            resultImage.hidden = true;
        }
        if (resultStage) resultStage.classList.remove("has-result");
        if (resultEmpty) resultEmpty.hidden = false;
        if (resultMeta) {
            resultMeta.textContent = "";
            resultMeta.hidden = true;
        }
        if (downloadLink) {
            downloadLink.href = "#";
            downloadLink.hidden = true;
        }
    }

    function formatDuration(seconds) {
        var value = Number(seconds || 0);
        if (!Number.isFinite(value) || value <= 0) return "0s";
        var minutes = Math.floor(value / 60);
        var remaining = Math.round((value - minutes * 60) * 10) / 10;
        if (!minutes) return String(remaining) + "s";
        return String(minutes) + "m " + String(remaining) + "s";
    }

    function formatBytes(bytes) {
        var value = Number(bytes || 0);
        if (!Number.isFinite(value) || value <= 0) return "0 B";
        var units = ["B", "KB", "MB", "GB"];
        var index = 0;
        while (value >= 1024 && index < units.length - 1) {
            value /= 1024;
            index += 1;
        }
        var rounded = value >= 10 || index === 0 ? Math.round(value) : Math.round(value * 10) / 10;
        return String(rounded) + " " + units[index];
    }

    function formatFps(value) {
        var fps = Number(value || 0);
        if (!Number.isFinite(fps) || fps <= 0) return "0";
        var rounded = Math.round(fps * 100) / 100;
        return String(rounded);
    }

    function activeResolutionMode() {
        for (var i = 0; i < modeInputs.length; i += 1) {
            if (modeInputs[i].checked) return modeInputs[i].value || "ratio";
        }
        return "ratio";
    }

    function fitWithinMaxDimension(width, height) {
        var scale = Math.min(1, maxDimension / Math.max(1, width), maxDimension / Math.max(1, height));
        return {
            width: Math.max(1, Math.round(width * scale)),
            height: Math.max(1, Math.round(height * scale)),
            scale: scale,
        };
    }

    function parsePositiveInt(value) {
        var parsed = parseInt(String(value || "").trim(), 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }

    function parsePositiveFloat(value) {
        var parsed = parseFloat(String(value || "").trim());
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }

    function sourceDimensions() {
        var metadata = state.metadata;
        if (!metadata) return null;
        var sourceWidth = parsePositiveInt(metadata.width);
        var sourceHeight = parsePositiveInt(metadata.height);
        if (!sourceWidth || !sourceHeight) return null;
        return { width: sourceWidth, height: sourceHeight };
    }

    function sourceFps() {
        var metadata = state.metadata;
        if (!metadata) return 0;
        var fps = parsePositiveFloat(metadata.fps);
        if (fps) return fps;
        var frameCount = parsePositiveInt(metadata.frame_count);
        var duration = parsePositiveFloat(metadata.duration);
        return frameCount && duration ? frameCount / duration : 0;
    }

    function sourceDurationSeconds() {
        var metadata = state.metadata;
        if (!metadata) return 0;
        var duration = parsePositiveFloat(metadata.duration);
        if (duration) return duration;
        var frameCount = parsePositiveInt(metadata.frame_count);
        var fps = sourceFps();
        return frameCount && fps ? frameCount / fps : 0;
    }

    function currentOutputFps() {
        return parsePositiveFloat(framesInput ? framesInput.value : "") || sourceFps();
    }

    function maxScaleRatio() {
        var dimensions = sourceDimensions();
        if (!dimensions) return 100;
        var fit = fitWithinMaxDimension(dimensions.width, dimensions.height);
        return Math.max(1, Math.min(100, fit.scale * 100));
    }

    function ratioFromPixelInputs() {
        var dimensions = sourceDimensions();
        if (!dimensions) return 0;
        var width = parsePositiveInt(widthInput ? widthInput.value : "");
        var height = parsePositiveInt(heightInput ? heightInput.value : "");
        var ratio = 0;
        if (state.sizeEditAxis === "height" && height) {
            ratio = height / dimensions.height * 100;
        } else if (width) {
            ratio = width / dimensions.width * 100;
        } else if (height) {
            ratio = height / dimensions.height * 100;
        }
        if (!ratio) return 0;
        return Math.max(1, Math.min(maxScaleRatio(), ratio));
    }

    function dimensionsFromRatio(ratioValue) {
        var dimensions = sourceDimensions();
        if (!dimensions) return null;
        var ratio = parsePositiveFloat(ratioValue) || 100;
        ratio = Math.max(1, Math.min(maxScaleRatio(), ratio));
        return {
            width: Math.max(1, Math.round(dimensions.width * ratio / 100)),
            height: Math.max(1, Math.round(dimensions.height * ratio / 100)),
        };
    }

    function syncPixelsFromRatio() {
        var output = dimensionsFromRatio(ratioInput ? ratioInput.value : "");
        if (!output) return;
        if (widthInput) widthInput.value = String(output.width);
        if (heightInput) heightInput.value = String(output.height);
    }

    function syncRatioFromPixels() {
        if (!ratioInput) return;
        var ratio = ratioFromPixelInputs();
        if (!ratio) return;
        ratioInput.value = formatFps(ratio);
    }

    function syncPixelsForAspect(axis) {
        var dimensions = sourceDimensions();
        if (!dimensions) return;
        var width = parsePositiveInt(widthInput ? widthInput.value : "");
        var height = parsePositiveInt(heightInput ? heightInput.value : "");
        state.sizeEditAxis = axis === "height" ? "height" : "width";
        if (state.sizeEditAxis === "height" && height) {
            width = Math.max(1, Math.round(dimensions.width * (height / dimensions.height)));
            if (widthInput) widthInput.value = String(width);
        } else if (width) {
            height = Math.max(1, Math.round(dimensions.height * (width / dimensions.width)));
            if (heightInput) heightInput.value = String(height);
        }
    }

    function currentOutputDimensions() {
        var dimensions = sourceDimensions();
        if (!dimensions) return null;
        if (activeResolutionMode() === "pixels") {
            var width = parsePositiveInt(widthInput ? widthInput.value : "");
            var height = parsePositiveInt(heightInput ? heightInput.value : "");
            if (state.sizeEditAxis === "height" && height) {
                width = Math.max(1, Math.round(dimensions.width * (height / dimensions.height)));
            } else if (width) {
                height = Math.max(1, Math.round(dimensions.height * (width / dimensions.width)));
            } else if (height) {
                width = Math.max(1, Math.round(dimensions.width * (height / dimensions.height)));
            }
            if (!width || !height) return null;
            return { width: width, height: height };
        }
        return dimensionsFromRatio(ratioInput ? ratioInput.value : "");
    }

    function estimateOutputFrameCount() {
        var duration = sourceDurationSeconds();
        var fps = currentOutputFps();
        if (!duration || !fps) return 0;
        return Math.max(1, Math.ceil(duration * fps));
    }

    function estimateOutputBytes() {
        var outputSize = currentOutputDimensions();
        var frameCount = estimateOutputFrameCount();
        if (!outputSize || !frameCount) return null;
        var pixelFrames = outputSize.width * outputSize.height * frameCount;
        var bytes = pixelFrames * gifEstimateBytesPerPixelFrame
            + frameCount * gifEstimateFrameOverheadBytes
            + gifEstimateBaseOverheadBytes;
        if (!Number.isFinite(bytes) || bytes <= 0) return null;
        return {
            bytes: Math.ceil(bytes),
            frames: frameCount,
            width: outputSize.width,
            height: outputSize.height,
            fps: currentOutputFps(),
        };
    }

    function estimatedOutputLimitMessage(estimate) {
        var estimateText = estimate ? formatBytes(estimate.bytes) : formatBytes(maxOutputBytes + 1);
        var limitText = formatBytes(maxOutputBytes);
        if (isEnglishUi()) {
            return "Estimated GIF size is " + estimateText + ". Lower the resolution or FPS to keep it under " + limitText + ".";
        }
        return "예상 GIF 용량이 " + estimateText + "입니다. " + limitText + " 이하가 되도록 해상도나 FPS를 낮춰주세요.";
    }

    function updateModeFields(syncForModeSwitch) {
        var isPixels = activeResolutionMode() === "pixels";
        if (state.metadata && syncForModeSwitch) {
            if (isPixels) {
                syncPixelsFromRatio();
            } else {
                syncRatioFromPixels();
            }
        }
        if (ratioField) ratioField.hidden = isPixels;
        if (pixelsField) pixelsField.hidden = !isPixels;
        state.resolutionMode = isPixels ? "pixels" : "ratio";
        syncControlState();
        updateMetadataDisplay();
    }

    function updateMetadataDisplay() {
        var metadata = state.metadata;
        if (!metadata) {
            if (sourceMetaEl) sourceMetaEl.textContent = "-";
            if (outputMetaEl) outputMetaEl.textContent = "-";
            if (frameMaxEl) frameMaxEl.textContent = "";
            return;
        }
        var fps = parsePositiveFloat(framesInput ? framesInput.value : "") || 0;
        var outputSize = currentOutputDimensions();
        var outputEstimate = estimateOutputBytes();
        if (sourceMetaEl) {
            sourceMetaEl.textContent = [
                String(metadata.width) + "x" + String(metadata.height),
                formatFps(sourceFps()) + " fps",
                formatDuration(metadata.duration),
            ].join(" · ");
        }
        if (outputMetaEl) {
            outputMetaEl.textContent = outputSize
                ? [
                    String(outputSize.width) + "x" + String(outputSize.height),
                    formatFps(fps) + " fps",
                    outputEstimate ? (isEnglishUi() ? "est. " : "예상 ") + formatBytes(outputEstimate.bytes) : "",
                ].filter(Boolean).join(" · ")
                : "-";
        }
        if (frameMaxEl) {
            frameMaxEl.textContent = message("frameMaxLabel", "Max") + " " + formatFps(sourceFps()) + " fps";
        }
    }

    function syncControlState() {
        var ready = Boolean((state.file || state.sourceUrl) && state.metadata);
        var isPixels = activeResolutionMode() === "pixels";
        if (fileOpenButton) fileOpenButton.disabled = state.busy;
        if (fileInput) fileInput.disabled = state.busy;
        if (urlInput) urlInput.disabled = state.busy;
        if (urlSubmitButton) urlSubmitButton.disabled = state.busy;
        if (convertButton) convertButton.disabled = state.busy || !ready;
        if (framesInput) framesInput.disabled = state.busy || !ready;
        if (ratioInput) ratioInput.disabled = state.busy || !ready || isPixels;
        if (widthInput) widthInput.disabled = state.busy || !ready || !isPixels;
        if (heightInput) heightInput.disabled = state.busy || !ready || !isPixels;
        modeInputs.forEach(function (input) {
            input.disabled = state.busy || !ready;
        });
    }

    function setBusy(isBusy) {
        state.busy = Boolean(isBusy);
        syncControlState();
    }

    function applyMetadata(metadata) {
        state.metadata = metadata || null;
        if (!state.metadata) {
            syncControlState();
            updateMetadataDisplay();
            return;
        }
        if (state.sourceKind === "url") {
            state.sourceUrl = String(state.metadata.source_url || state.sourceUrl || "");
            state.sourceName = String(state.metadata.filename || state.sourceName || "");
        }

        var sourceWidth = parsePositiveInt(state.metadata.width);
        var sourceHeight = parsePositiveInt(state.metadata.height);
        var fit = fitWithinMaxDimension(sourceWidth, sourceHeight);
        var maxRatio = Math.max(1, Math.min(100, fit.scale * 100));
        var maxFps = sourceFps() || 12;
        var defaultRatio = Math.min(100, maxRatio);
        var defaultFps = Math.min(12, maxFps);
        state.sizeEditAxis = "width";
        if (ratioInput) {
            ratioInput.max = formatFps(maxRatio);
            ratioInput.value = formatFps(defaultRatio);
        }
        syncPixelsFromRatio();
        if (framesInput) {
            framesInput.max = formatFps(maxFps);
            framesInput.value = formatFps(defaultFps);
        }
        setStatus(message("statusConvertReady", "Ready to convert."), false);
        syncControlState();
        updateMetadataDisplay();
    }

    function parseJsonResponse(response, fallback) {
        return response.json().catch(function () {
            return { ok: false, error: fallback || message("statusFailed", "GIF conversion failed.") };
        }).then(function (payload) {
            if (!response.ok || !payload || payload.ok === false) {
                throw new Error(selectServerMessage(payload, fallback));
            }
            return payload;
        });
    }

    function requestMetadataFormData(formData) {
        if (!metadataUrl || !formData) {
            setStageLoading("upload", false);
            return;
        }
        if (state.metadataController) state.metadataController.abort();
        var controller = new AbortController();
        state.metadataController = controller;
        state.metadata = null;
        setStatus(message("statusMetadataLoading", "Reading video..."), false);
        setStageLoading("upload", true);
        setBusy(true);
        fetch(metadataUrl, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "X-CSRFToken": getCsrfToken(),
            },
            body: formData,
            signal: controller.signal,
        })
            .then(function (response) {
                return parseJsonResponse(response, message("statusInvalidFile", "Use a video file."));
            })
            .then(function (metadata) {
                applyMetadata(metadata);
                setStatus(message("statusMetadataLoaded", "Video loaded."), false);
            })
            .catch(function (error) {
                if (error && error.name === "AbortError") return;
                state.metadata = null;
                setStatus(error && error.message ? error.message : message("statusInvalidFile", "Use a video file."), true);
                syncControlState();
                updateMetadataDisplay();
            })
            .finally(function () {
                if (state.metadataController === controller) state.metadataController = null;
                setStageLoading("upload", false);
                setBusy(false);
            });
    }

    function requestMetadata(file) {
        if (!file) {
            setStageLoading("upload", false);
            return;
        }
        var formData = new FormData();
        formData.append("file", file, file.name || "video");
        requestMetadataFormData(formData);
    }

    function requestUrlMetadata(urlValue) {
        var formData = new FormData();
        formData.append("url", urlValue);
        requestMetadataFormData(formData);
    }

    function loadFile(file) {
        if (!file) return;
        if (!isAcceptedFile(file) || file.size > maxUploadBytes) {
            setStatus(message("statusInvalidFile", "Use a video file."), true);
            clearStageLoading();
            setBusy(false);
            return;
        }
        setStageLoading("upload", true);
        setStageLoading("video", true);
        clearResult();
        state.file = file;
        state.sourceKind = "file";
        state.sourceUrl = "";
        state.sourceName = file.name || "video";
        state.metadata = null;
        showVideoPreview(file);
        syncControlState();
        updateMetadataDisplay();
        requestMetadata(file);
    }

    function loadUrlVideo(event) {
        if (event && event.preventDefault) event.preventDefault();
        var value = urlInput ? String(urlInput.value || "").trim() : "";
        if (!value) {
            setStatus(message("statusEmptyUrl", "Enter a video URL."), true);
            if (urlInput) urlInput.focus();
            return;
        }
        setStageLoading("upload", true);
        setStageLoading("video", true);
        clearResult();
        state.file = null;
        state.sourceKind = "url";
        state.sourceUrl = value;
        state.sourceName = "";
        state.metadata = null;
        showVideoPreview(value, { remote: true });
        syncControlState();
        updateMetadataDisplay();
        requestUrlMetadata(value);
    }

    function buildConversionFormData() {
        var formData = new FormData();
        if (state.sourceKind === "url") {
            formData.append("url", state.sourceUrl || "");
        } else {
            formData.append("file", state.file, state.file.name || "video");
        }
        formData.append("resolution_mode", activeResolutionMode());
        formData.append("scale_ratio", ratioInput ? ratioInput.value || "100" : "100");
        formData.append("width", widthInput ? widthInput.value || "" : "");
        formData.append("height", heightInput ? heightInput.value || "" : "");
        formData.append("size_axis", state.sizeEditAxis || "width");
        formData.append("fps", framesInput ? framesInput.value || "" : "");
        return formData;
    }

    function filenameFromResponse(response) {
        var disposition = response.headers.get("Content-Disposition") || "";
        var utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
        if (utfMatch) {
            try {
                return decodeURIComponent(utfMatch[1]);
            } catch (error) {
                return utfMatch[1];
            }
        }
        var quotedMatch = disposition.match(/filename="([^"]+)"/i);
        if (quotedMatch) return quotedMatch[1];
        var plainMatch = disposition.match(/filename=([^;]+)/i);
        if (plainMatch) return plainMatch[1].trim();
        return "hanplanet.gif";
    }

    function showResult(response, blob) {
        clearResult();
        var resultUrl = URL.createObjectURL(blob);
        state.resultUrl = resultUrl;
        if (resultImage) {
            resultImage.src = resultUrl;
            resultImage.hidden = false;
        }
        if (resultStage) resultStage.classList.add("has-result");
        if (resultEmpty) resultEmpty.hidden = true;
        if (downloadLink) {
            downloadLink.href = resultUrl;
            downloadLink.download = filenameFromResponse(response);
            downloadLink.hidden = false;
        }
        if (resultMeta) {
            var width = response.headers.get("X-Video-Gif-Width") || "";
            var height = response.headers.get("X-Video-Gif-Height") || "";
            var fps = response.headers.get("X-Video-Gif-Fps") || "";
            resultMeta.textContent = [
                width && height ? width + "x" + height : "",
                fps ? formatFps(fps) + " fps" : "",
                formatBytes(blob.size),
            ].filter(Boolean).join(" · ");
            resultMeta.hidden = false;
        }
    }

    function convertToGif(event) {
        if (event) event.preventDefault();
        if (!(state.file || state.sourceUrl) || !state.metadata || !convertUrl) {
            setStatus(message("statusMissingFile", "Choose a video file."), true);
            return;
        }
        var outputEstimate = estimateOutputBytes();
        if (outputEstimate && maxOutputBytes > 0 && outputEstimate.bytes > maxOutputBytes) {
            setStatus(estimatedOutputLimitMessage(outputEstimate), true);
            return;
        }
        if (state.convertController) state.convertController.abort();
        var controller = new AbortController();
        state.convertController = controller;
        setStatus(message("statusConverting", "Converting..."), false);
        setResultLoading(true);
        setBusy(true);
        fetch(convertUrl, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "X-CSRFToken": getCsrfToken(),
            },
            body: buildConversionFormData(),
            signal: controller.signal,
        })
            .then(function (response) {
                var contentType = response.headers.get("Content-Type") || "";
                if (!response.ok || contentType.indexOf("image/gif") !== 0) {
                    return response.json().catch(function () {
                        return { ok: false, error: message("statusFailed", "GIF conversion failed.") };
                    }).then(function (payload) {
                        throw new Error(selectServerMessage(payload, message("statusFailed", "GIF conversion failed.")));
                    });
                }
                return response.blob().then(function (blob) {
                    showResult(response, blob);
                });
            })
            .then(function () {
                setStatus(message("statusDone", "GIF created."), false);
            })
            .catch(function (error) {
                if (error && error.name === "AbortError") return;
                setStatus(error && error.message ? error.message : message("statusFailed", "GIF conversion failed."), true);
            })
            .finally(function () {
                if (state.convertController === controller) state.convertController = null;
                setResultLoading(false);
                setBusy(false);
            });
    }

    function setSourceModalOpen(open) {
        if (!sourceModal) return;
        sourceModal.hidden = !open;
        if (open && sourceLocalButton) {
            sourceLocalButton.focus();
        }
    }

    function setHandriveModalOpen(open) {
        if (!handriveModal) return;
        handriveModal.hidden = !open;
        if (open && handriveCloseButton) {
            handriveCloseButton.focus();
        }
    }

    function buildApiUrl(baseUrl, params) {
        var url = new URL(baseUrl, window.location.origin);
        Object.keys(params || {}).forEach(function (key) {
            if (params[key] !== undefined && params[key] !== null) {
                url.searchParams.set(key, params[key]);
            }
        });
        return url.toString();
    }

    function normalizeHandrivePath(pathValue) {
        return String(pathValue || "").replace(/^\/+|\/+$/g, "");
    }

    function buildFallbackTreePrefixElement(ancestorHasNextSiblings, isLastSibling) {
        var prefix = document.createElement("span");
        prefix.className = "handrive-item-tree-prefix";
        prefix.setAttribute("aria-hidden", "true");
        (ancestorHasNextSiblings || []).forEach(function (hasNextSibling) {
            var segment = document.createElement("span");
            segment.className = "handrive-tree-segment" + (hasNextSibling ? " has-next" : "");
            prefix.appendChild(segment);
        });
        var branch = document.createElement("span");
        branch.className = "handrive-tree-segment handrive-tree-branch " + (isLastSibling ? "is-last" : "is-middle");
        prefix.appendChild(branch);
        if (!(ancestorHasNextSiblings || []).length) {
            prefix.classList.add("is-root-depth");
        }
        return prefix;
    }

    function createFallbackTypeMarker(options) {
        var settings = options || {};
        var marker = document.createElement("span");
        marker.className = "handrive-item-type-icon " + (settings.isDir ? "is-dir" : "is-file");
        if (settings.isGoogleDrive) marker.classList.add("is-google-drive");
        else if (settings.isGithubRepo) marker.classList.add("is-github-repo");
        else if (settings.isRepo) marker.classList.add("is-repo");
        else if (settings.isBranch) marker.classList.add("is-branch");
        else if (settings.isEmpty) marker.classList.add("is-empty");
        if (!settings.isDir) {
            marker.classList.add("is-generic");
            marker.dataset.fileIcon = settings.fileIconKey || "video";
        }
        return marker;
    }

    function createHandriveTypeIcon(entry) {
        var isDir = entry && entry.type === "dir";
        var fileIconKey = isDir ? "" : getFileIconKey(entry.path || entry.name || "");
        return createTypeMarker({
            isDir: isDir,
            isGoogleDrive: isDir && entry && (entry.is_google_drive || entry.google_drive),
            isGithubRepo: isDir && entry && entry.github_repo,
            isRepo: isDir && entry && entry.git_repo,
            isBranch: isDir && entry && entry.git_branch_root,
            isMap: isDir && entry && entry.is_map_folder,
            isEmpty: isDir && entry && entry.has_children === false,
            fileIconKey: fileIconKey || "video",
            isGenericFileIcon: !isDir && isGenericFileIconKey(fileIconKey || "video"),
            customIconUrl: isDir && entry && entry.folder_icon_url ? entry.folder_icon_url : "",
        });
    }

    function createHandriveRow(entry, ancestorHasNextSiblings, isLastSibling) {
        var item = document.createElement("li");
        item.className = "handrive-item";
        var row = document.createElement("button");
        row.type = "button";
        row.className = "handrive-item-row has-tree-prefix";
        row.setAttribute("data-entry-path", entry && entry.path ? entry.path : "");
        var isDir = entry && entry.type === "dir";
        if (isDir) {
            row.setAttribute("aria-expanded", state.handriveExpandedPaths.has(normalizeHandrivePath(entry.path)) ? "true" : "false");
        }
        var icon = createHandriveTypeIcon(entry);
        var nameWrap = document.createElement("span");
        nameWrap.className = "handrive-item-name-wrap";
        var name = document.createElement("span");
        name.className = "handrive-item-name";
        name.textContent = String(entry.name || entry.path || "");
        nameWrap.appendChild(name);
        var action = document.createElement("span");
        action.className = "handrive-item-meta-label image-color-picker-handrive-action";
        action.textContent = isDir
            ? message("handriveOpenFolderLabel", "Open folder")
            : message("handriveSelectFileLabel", "Select video");
        row.appendChild(icon);
        row.appendChild(nameWrap);
        row.appendChild(action);
        row.addEventListener("click", function (event) {
            event.preventDefault();
            if (isDir) {
                toggleHandriveFolder(entry);
                return;
            }
            loadHandriveVideo(entry);
        });
        item.appendChild(buildTreePrefixElement(ancestorHasNextSiblings || [], Boolean(isLastSibling)));
        item.appendChild(row);
        return item;
    }

    function appendHandriveEmptyRow(fragment, ancestorHasNextSiblings, isLastSibling, text) {
        var item = document.createElement("li");
        item.className = "handrive-item";
        var empty = document.createElement("div");
        empty.className = "handrive-item-row is-empty image-color-picker-handrive-empty" + (ancestorHasNextSiblings ? " has-tree-prefix" : "");
        empty.textContent = text || message("handriveEmptyLabel", "No videos in this folder.");
        if (ancestorHasNextSiblings) {
            item.appendChild(buildTreePrefixElement(ancestorHasNextSiblings, Boolean(isLastSibling)));
        }
        item.appendChild(empty);
        fragment.appendChild(item);
    }

    function filterHandriveEntries(entries) {
        return (entries || []).filter(function (entry) {
            return entry && (entry.type === "dir" || (entry.type === "file" && isVideoName(entry.name || entry.path)));
        });
    }

    function appendHandriveTreeNode(entry, fragment, ancestorHasNextSiblings, isLastSibling) {
        fragment.appendChild(createHandriveRow(entry, ancestorHasNextSiblings, isLastSibling));
        if (!entry || entry.type !== "dir") return;
        var entryPath = normalizeHandrivePath(entry.path);
        if (!state.handriveExpandedPaths.has(entryPath)) return;

        var childAncestorFlags = (ancestorHasNextSiblings || []).slice();
        childAncestorFlags.push(!isLastSibling);
        if (state.handriveLoadingPaths.has(entryPath)) {
            appendHandriveEmptyRow(fragment, childAncestorFlags, true, message("handriveLoadingLabel", "Loading..."));
            return;
        }
        var childEntries = filterHandriveEntries(state.handriveEntriesByPath.get(entryPath) || []);
        if (!childEntries.length) {
            appendHandriveEmptyRow(fragment, childAncestorFlags, true);
            return;
        }
        childEntries.forEach(function (child, index) {
            appendHandriveTreeNode(child, fragment, childAncestorFlags, index === childEntries.length - 1);
        });
    }

    function renderHandriveTree() {
        if (!handriveList) return;
        handriveList.replaceChildren();
        var fragment = document.createDocumentFragment();
        var rootPath = normalizeHandrivePath(state.handriveRootPath);
        var visible = rootPath ? filterHandriveEntries(state.handriveEntriesByPath.get(rootPath) || []) : [];
        if (!visible.length) {
            appendHandriveEmptyRow(fragment);
            handriveList.appendChild(fragment);
            return;
        }
        visible.forEach(function (entry, index) {
            appendHandriveTreeNode(entry, fragment, [], index === visible.length - 1);
        });
        handriveList.appendChild(fragment);
    }

    function toggleHandriveFolder(entry) {
        var entryPath = normalizeHandrivePath(entry && entry.path);
        if (!entryPath) return;
        if (state.handriveExpandedPaths.has(entryPath)) {
            state.handriveExpandedPaths.delete(entryPath);
            renderHandriveTree();
            return;
        }
        state.handriveExpandedPaths.add(entryPath);
        if (state.handriveEntriesByPath.has(entryPath)) {
            renderHandriveTree();
            return;
        }
        loadHandriveDirectory(entryPath);
    }

    function loadHandriveDirectory(pathValue) {
        if (!handriveEnabled || !handriveListUrl) return Promise.resolve();
        var controller = new AbortController();
        state.handriveController = controller;
        var normalizedPath = normalizeHandrivePath(pathValue);
        state.handriveLoadingPaths.add(normalizedPath);
        renderHandriveTree();
        setInlineStatus(handriveStatus, message("handriveLoadingLabel", "Loading..."), false);
        return fetch(buildApiUrl(handriveListUrl, { path: normalizedPath, scope_home: "1" }), {
            credentials: "same-origin",
            signal: controller.signal,
        })
            .then(function (response) {
                return response.json().catch(function () {
                    return { ok: false, error: message("statusInvalidFile", "Use a video file.") };
                });
            })
            .then(function (data) {
                if (!data || data.ok === false) {
                    throw new Error(selectServerMessage(data, message("statusInvalidFile", "Use a video file.")));
                }
                state.handrivePath = normalizeHandrivePath(data.path || normalizedPath || "");
                if (!normalizedPath && !state.handriveRootPath) {
                    state.handriveRootPath = state.handrivePath;
                }
                state.handriveEntriesByPath.set(state.handrivePath, data.entries || []);
                if (normalizedPath && normalizedPath !== state.handrivePath) {
                    state.handriveEntriesByPath.set(normalizedPath, data.entries || []);
                }
                renderHandriveTree();
                setInlineStatus(handriveStatus, "", false);
            })
            .catch(function (error) {
                if (error && error.name === "AbortError") return;
                setInlineStatus(handriveStatus, error && error.message ? error.message : message("statusInvalidFile", "Use a video file."), true);
            })
            .finally(function () {
                state.handriveLoadingPaths.delete(normalizedPath);
                if (state.handriveController === controller) state.handriveController = null;
                renderHandriveTree();
            });
    }

    function loadHandriveVideo(entry) {
        if (!entry || !entry.path || !handriveDownloadUrl) return;
        setHandriveModalOpen(false);
        setStatus(message("statusMetadataLoading", "Reading video..."), false);
        setStageLoading("upload", true);
        setBusy(true);
        fetch(buildApiUrl(handriveDownloadUrl, { path: entry.path, scope_home: "1" }), {
            credentials: "same-origin",
        })
            .then(function (response) {
                if (!response.ok || response.redirected) {
                    throw new Error(message("statusInvalidFile", "Use a video file."));
                }
                return response.blob();
            })
            .then(function (blob) {
                if (!blob || !blob.size) {
                    throw new Error(message("statusInvalidFile", "Use a video file."));
                }
                var fileName = String(entry.name || entry.path || "video").split("/").pop() || "video";
                var guessedType = guessVideoMimeType(fileName);
                var type = blob.type && blob.type.indexOf("video/") === 0 ? blob.type : guessedType;
                var videoBlob = blob.type === type ? blob : blob.slice(0, blob.size, type);
                var videoFile = typeof window.File === "function"
                    ? new window.File([videoBlob], fileName, { type: type })
                    : videoBlob;
                loadFile(videoFile);
            })
            .catch(function (error) {
                setStatus(error && error.message ? error.message : message("statusInvalidFile", "Use a video file."), true);
                setStageLoading("upload", false);
                setStageLoading("video", false);
                setBusy(false);
            });
    }

    if (urlSubmitButton) {
        urlSubmitButton.addEventListener("click", loadUrlVideo);
    }
    if (urlInput) {
        urlInput.addEventListener("keydown", function (event) {
            if (event.key !== "Enter") return;
            loadUrlVideo(event);
        });
    }
    if (urlForm) {
        urlForm.addEventListener("submit", loadUrlVideo);
    }
    if (fileOpenButton && fileInput) {
        fileOpenButton.addEventListener("click", function () {
            setSourceModalOpen(true);
        });
    }
    if (sourceLocalButton && fileInput) {
        sourceLocalButton.addEventListener("click", function () {
            setSourceModalOpen(false);
            fileInput.click();
        });
    }
    if (sourceHandriveButton) {
        sourceHandriveButton.addEventListener("click", function () {
            setSourceModalOpen(false);
            setHandriveModalOpen(true);
            loadHandriveDirectory(state.handriveRootPath || "");
        });
    }
    if (sourceCloseButton) {
        sourceCloseButton.addEventListener("click", function () {
            setSourceModalOpen(false);
        });
    }
    if (fileInput) {
        fileInput.addEventListener("change", function () {
            var file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
            if (file) loadFile(file);
            fileInput.value = "";
        });
    }
    if (stage) {
        ["dragenter", "dragover"].forEach(function (name) {
            stage.addEventListener(name, function (event) {
                event.preventDefault();
                stage.classList.add("is-dragover");
            });
        });
        ["dragleave", "dragend"].forEach(function (name) {
            stage.addEventListener(name, function () {
                stage.classList.remove("is-dragover");
            });
        });
        stage.addEventListener("drop", function (event) {
            event.preventDefault();
            stage.classList.remove("is-dragover");
            var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]
                ? event.dataTransfer.files[0]
                : null;
            if (file) loadFile(file);
        });
    }
    document.addEventListener("paste", function (event) {
        if (event.defaultPrevented) return;
        var file = getClipboardFile(event);
        if (!file) return;
        event.preventDefault();
        if (stage) stage.classList.remove("is-dragover");
        loadFile(file);
    });
    if (video) {
        ["loadeddata", "canplay"].forEach(function (name) {
            video.addEventListener(name, function () {
                setStageLoading("video", false);
            });
        });
        ["error", "abort"].forEach(function (name) {
            video.addEventListener(name, function () {
                setStageLoading("video", false);
            });
        });
    }
    if (form) {
        form.addEventListener("submit", convertToGif);
    }
    modeInputs.forEach(function (input) {
        input.addEventListener("change", function () {
            updateModeFields(true);
        });
    });
    if (ratioInput) {
        ratioInput.addEventListener("input", function () {
            syncPixelsFromRatio();
            updateMetadataDisplay();
        });
    }
    if (widthInput) {
        widthInput.addEventListener("input", function () {
            syncPixelsForAspect("width");
            syncRatioFromPixels();
            updateMetadataDisplay();
        });
    }
    if (heightInput) {
        heightInput.addEventListener("input", function () {
            syncPixelsForAspect("height");
            syncRatioFromPixels();
            updateMetadataDisplay();
        });
    }
    if (framesInput) {
        framesInput.addEventListener("input", updateMetadataDisplay);
    }
    if (handriveCloseButton) {
        handriveCloseButton.addEventListener("click", function () {
            setHandriveModalOpen(false);
        });
    }
    if (sourceModal) {
        sourceModal.addEventListener("click", function (event) {
            if (event.target === sourceModal) {
                setSourceModalOpen(false);
            }
        });
    }
    if (handriveModal) {
        handriveModal.addEventListener("click", function (event) {
            if (event.target === handriveModal) {
                setHandriveModalOpen(false);
            }
        });
    }
    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && sourceModal && !sourceModal.hidden) {
            setSourceModalOpen(false);
            return;
        }
        if (event.key === "Escape" && handriveModal && !handriveModal.hidden) {
            setHandriveModalOpen(false);
        }
    });
    window.addEventListener("beforeunload", function () {
        revokeObjectUrl("objectUrl");
        revokeObjectUrl("resultUrl");
    });

    updateModeFields();
    syncControlState();
})();
