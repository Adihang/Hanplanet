(function () {
    "use strict";

    var state = {
        entry: null,
        onDirtyChange: null,
        onReady: null,
        onError: null,
        isDirty: false,
        isReady: false,
        loadFailed: false,
        isSaving: false,
        isDisabled: false,
        changeRevision: 0,
        sessionVersion: 0,
        duration: 0,
        appendFile: null,
        audioServeUrl: "",
        listApiUrl: "",
        buildDownloadUrl: null,
        driveDir: "",
        scopedHomeDir: "",
        previewObjectUrl: "",
        previewTimer: null,
        previewShouldPlay: false,
        previewVersion: 0,
        appendRequestVersion: 0,
        decodeAbortController: null,
        decodedBufferPromise: null,
        decodedBuffer: null,
        appendDecodedBufferPromise: null,
        appendDecodedBuffer: null,
        waveformBuffer: null,
        usingTrimmedPreview: false,
        hasLoadedOriginalMetadata: false,
    };

    var surface, audioEl, resetBtn, startInput, endInput, volumeInput;
    var volumeButton, volumePopover, volumeDisplay, appendButton, appendPopover, appendPcButton, appendDriveButton;
    var appendInput, appendName, drivePicker, driveCloseButton, driveUpButton, drivePathEl, driveList;
    var startRange, endRange, rangeSelection;
    var currentTimeEl, durationEl, trackCard, waveformVisual, waveformCanvas, waveformPlayhead;
    var waveformResizeObserver = null;

    function init(options) {
        var opts = options || {};
        cancelPendingAudioWork();
        state.entry = opts.entry || null;
        state.onDirtyChange = opts.onDirtyChange || null;
        state.onReady = typeof opts.onReady === "function" ? opts.onReady : null;
        state.onError = typeof opts.onError === "function" ? opts.onError : null;
        state.isDirty = false;
        state.isReady = false;
        state.loadFailed = false;
        state.isSaving = false;
        state.isDisabled = false;
        state.changeRevision = 0;
        state.sessionVersion += 1;
        state.duration = 0;
        state.appendFile = null;
        state.audioServeUrl = opts.audioServeUrl || "";
        state.listApiUrl = opts.listApiUrl || "";
        state.buildDownloadUrl = typeof opts.buildDownloadUrl === "function" ? opts.buildDownloadUrl : null;
        state.scopedHomeDir = normalizePath(opts.scopedHomeDir || "");
        state.driveDir = normalizePickerPath(getParentPath(state.entry && state.entry.path ? state.entry.path : ""));
        state.previewObjectUrl = "";
        state.previewTimer = null;
        state.previewShouldPlay = false;
        state.previewVersion += 1;
        state.appendRequestVersion += 1;
        state.decodeAbortController = null;
        state.decodedBufferPromise = null;
        state.decodedBuffer = null;
        state.appendDecodedBufferPromise = null;
        state.appendDecodedBuffer = null;
        state.waveformBuffer = null;
        state.usingTrimmedPreview = false;
        state.hasLoadedOriginalMetadata = false;

        surface = document.getElementById("handrive-audio-editor-surface");
        audioEl = document.getElementById("ae-audio");
        resetBtn = document.getElementById("ae-reset-btn");
        startInput = document.getElementById("ae-start-input");
        endInput = document.getElementById("ae-end-input");
        volumeInput = document.getElementById("ae-volume-input");
        volumeButton = document.getElementById("ae-volume-btn");
        volumePopover = document.getElementById("ae-volume-popover");
        volumeDisplay = document.getElementById("ae-volume-display");
        appendButton = document.getElementById("ae-append-btn");
        appendPopover = document.getElementById("ae-append-popover");
        appendPcButton = document.getElementById("ae-append-pc-btn");
        appendDriveButton = document.getElementById("ae-append-drive-btn");
        appendInput = document.getElementById("ae-append-input");
        appendName = document.getElementById("ae-append-name");
        drivePicker = document.getElementById("ae-drive-picker");
        driveCloseButton = document.getElementById("ae-drive-close-btn");
        driveUpButton = document.getElementById("ae-drive-up-btn");
        drivePathEl = document.getElementById("ae-drive-path");
        driveList = document.getElementById("ae-drive-list");
        startRange = document.getElementById("ae-start-range");
        endRange = document.getElementById("ae-end-range");
        rangeSelection = document.getElementById("ae-range-selection");
        currentTimeEl = document.getElementById("ae-current-time");
        durationEl = document.getElementById("ae-duration");
        trackCard = surface ? surface.querySelector(".ae-track-card") : null;
        waveformVisual = document.getElementById("ae-waveform-visual");
        waveformCanvas = document.getElementById("ae-waveform-canvas");
        waveformPlayhead = document.getElementById("ae-waveform-playhead");

        if (!audioEl) return;
        unbindEvents();
        setDisabled(false);
        setMediaLoading(true);
        resetControls();
        clearWaveform();
        bindEvents();
        bindWaveformResizeObserver();

        audioEl.src = state.audioServeUrl;
        audioEl.load();
    }

    function destroy() {
        unbindEvents();
        cancelPendingAudioWork();
        unbindWaveformResizeObserver();
        if (audioEl) {
            audioEl.pause();
            audioEl.removeAttribute("src");
            audioEl.load();
        }
        state.entry = null;
        state.onDirtyChange = null;
        state.onReady = null;
        state.onError = null;
        state.appendFile = null;
        state.isDirty = false;
        state.isReady = false;
        state.loadFailed = false;
        state.isSaving = false;
        state.sessionVersion += 1;
        state.appendRequestVersion += 1;
        state.audioServeUrl = "";
        state.listApiUrl = "";
        state.buildDownloadUrl = null;
        state.scopedHomeDir = "";
        state.driveDir = "";
        state.decodedBufferPromise = null;
        state.decodedBuffer = null;
        state.appendDecodedBufferPromise = null;
        state.appendDecodedBuffer = null;
        state.waveformBuffer = null;
        state.usingTrimmedPreview = false;
        state.hasLoadedOriginalMetadata = false;
        clearWaveform();
        setPreviewBuilding(false);
        setMediaLoading(false);
        setDisabled(false);
    }

    function resetControls() {
        if (startInput) startInput.value = formatTime(0);
        if (endInput) endInput.value = formatTime(0);
        if (volumeInput) volumeInput.value = "1";
        state.appendFile = null;
        state.appendRequestVersion += 1;
        resetAppendDecodeCache();
        closeVolumePopover();
        closeAppendPopover();
        closeDrivePicker();
        if (appendInput) appendInput.value = "";
        if (appendName) appendName.textContent = appendName.dataset.emptyText || appendName.textContent || "";
        if (startRange) {
            startRange.value = "0";
            startRange.max = "0";
        }
        if (endRange) {
            endRange.value = "0";
            endRange.max = "0";
        }
        syncRangeSelection();
        syncVolumeDisplay();
        syncTimeDisplays();
    }

    function bindEvents() {
        audioEl.addEventListener("loadedmetadata", onLoadedMetadata);
        audioEl.addEventListener("error", onMediaError);
        audioEl.addEventListener("timeupdate", onTimeUpdate);
        if (resetBtn) resetBtn.addEventListener("click", onResetClick);
        if (startInput) startInput.addEventListener("input", onControlInput);
        if (endInput) endInput.addEventListener("input", onControlInput);
        if (startInput) startInput.addEventListener("change", onControlInputCommit);
        if (endInput) endInput.addEventListener("change", onControlInputCommit);
        if (volumeButton) volumeButton.addEventListener("click", onVolumeButtonClick);
        if (volumeInput) volumeInput.addEventListener("input", onVolumeInput);
        if (appendButton) appendButton.addEventListener("click", onAppendButtonClick);
        if (appendPcButton) appendPcButton.addEventListener("click", onAppendPcClick);
        if (appendDriveButton) appendDriveButton.addEventListener("click", onAppendDriveClick);
        if (appendInput) appendInput.addEventListener("change", onAppendChange);
        if (driveCloseButton) driveCloseButton.addEventListener("click", closeDrivePicker);
        if (driveUpButton) driveUpButton.addEventListener("click", onDriveUpClick);
        if (startRange) startRange.addEventListener("input", onStartRangeInput);
        if (endRange) endRange.addEventListener("input", onEndRangeInput);
        if (surface) {
            surface.addEventListener("dragover", onEditorDragOver);
            surface.addEventListener("drop", onEditorDrop);
        }
        document.addEventListener("click", onDocumentClick);
        document.addEventListener("keydown", onDocumentKeydown);
    }

    function unbindEvents() {
        if (audioEl) {
            audioEl.removeEventListener("loadedmetadata", onLoadedMetadata);
            audioEl.removeEventListener("loadedmetadata", playAudioPreview);
            audioEl.removeEventListener("error", onMediaError);
            audioEl.removeEventListener("timeupdate", onTimeUpdate);
        }
        if (resetBtn) resetBtn.removeEventListener("click", onResetClick);
        if (startInput) startInput.removeEventListener("input", onControlInput);
        if (endInput) endInput.removeEventListener("input", onControlInput);
        if (startInput) startInput.removeEventListener("change", onControlInputCommit);
        if (endInput) endInput.removeEventListener("change", onControlInputCommit);
        if (volumeButton) volumeButton.removeEventListener("click", onVolumeButtonClick);
        if (volumeInput) volumeInput.removeEventListener("input", onVolumeInput);
        if (appendButton) appendButton.removeEventListener("click", onAppendButtonClick);
        if (appendPcButton) appendPcButton.removeEventListener("click", onAppendPcClick);
        if (appendDriveButton) appendDriveButton.removeEventListener("click", onAppendDriveClick);
        if (appendInput) appendInput.removeEventListener("change", onAppendChange);
        if (driveCloseButton) driveCloseButton.removeEventListener("click", closeDrivePicker);
        if (driveUpButton) driveUpButton.removeEventListener("click", onDriveUpClick);
        if (startRange) startRange.removeEventListener("input", onStartRangeInput);
        if (endRange) endRange.removeEventListener("input", onEndRangeInput);
        if (surface) {
            surface.removeEventListener("dragover", onEditorDragOver);
            surface.removeEventListener("drop", onEditorDrop);
        }
        document.removeEventListener("click", onDocumentClick);
        document.removeEventListener("keydown", onDocumentKeydown);
    }

    function onLoadedMetadata() {
        if (state.usingTrimmedPreview && state.hasLoadedOriginalMetadata) {
            syncTimeDisplays();
            return;
        }
        var duration = Number.isFinite(audioEl.duration) ? audioEl.duration : 0;
        if (duration <= 0 || state.isReady) return;
        state.duration = duration;
        state.hasLoadedOriginalMetadata = true;
        if (endInput) endInput.value = state.duration ? formatTime(state.duration) : formatTime(0);
        if (startRange) startRange.max = state.duration ? state.duration.toFixed(2) : "0";
        if (endRange) {
            endRange.max = state.duration ? state.duration.toFixed(2) : "0";
            endRange.value = state.duration ? state.duration.toFixed(2) : "0";
        }
        syncRangeSelection();
        syncTimeDisplays();
        setDirty(false);
        state.isReady = true;
        setMediaLoading(false);
        loadWaveform(state.sessionVersion);
        if (state.onReady) state.onReady();
    }

    function onMediaError() {
        if (state.isReady || state.loadFailed) return;
        state.loadFailed = true;
        setMediaLoading(false);
        if (state.onError) state.onError(new Error("audio load failed"));
    }

    function onTimeUpdate() {
        if (state.usingTrimmedPreview) {
            syncTimeDisplays();
            return;
        }
        var end = getEndTime();
        if (end && audioEl.currentTime >= end) {
            audioEl.pause();
            audioEl.currentTime = end;
        }
        syncTimeDisplays();
    }

    function onResetClick() {
        resetControls();
        if (startInput) startInput.value = formatTime(0);
        if (endInput && state.duration) endInput.value = formatTime(state.duration);
        if (audioEl) audioEl.currentTime = 0;
        syncRangeInputs();
        syncTimeDisplays();
        schedulePreviewRefresh();
        setDirty(false);
    }

    function onControlInput() {
        syncRangeInputs();
        setDirty(true);
        schedulePreviewRefresh(true);
    }

    function onControlInputCommit() {
        clampTimeInputs();
        syncRangeInputs();
        schedulePreviewRefresh(false);
    }

    function onVolumeInput() {
        if (audioEl && volumeInput) {
            audioEl.volume = Math.max(0, Math.min(1, Number(volumeInput.value) || 0));
        }
        syncVolumeDisplay();
        setDirty(true);
    }

    function onVolumeButtonClick(event) {
        if (event) event.stopPropagation();
        if (!volumePopover) return;
        if (volumePopover.hidden) {
            openVolumePopover();
        } else {
            closeVolumePopover();
        }
    }

    function onDocumentClick(event) {
        if (!volumePopover || volumePopover.hidden) return;
        var target = event && event.target;
        if (target && target.closest && target.closest("#ae-volume-control")) return;
        if (target && target.closest && target.closest("#ae-append-control")) return;
        closeVolumePopover();
        closeAppendPopover();
    }

    function onDocumentKeydown(event) {
        if (event && event.key === "Escape") {
            closeVolumePopover();
            closeAppendPopover();
            closeDrivePicker();
        }
    }

    function openVolumePopover() {
        if (volumePopover) volumePopover.hidden = false;
        if (volumeButton) volumeButton.setAttribute("aria-expanded", "true");
        if (volumeInput) volumeInput.focus({ preventScroll: true });
    }

    function closeVolumePopover() {
        if (volumePopover) volumePopover.hidden = true;
        if (volumeButton) volumeButton.setAttribute("aria-expanded", "false");
    }

    function onAppendButtonClick(event) {
        if (event) event.stopPropagation();
        if (!appendPopover) return;
        if (appendPopover.hidden) openAppendPopover();
        else closeAppendPopover();
    }

    function openAppendPopover() {
        if (appendPopover) appendPopover.hidden = false;
        if (appendButton) appendButton.setAttribute("aria-expanded", "true");
    }

    function closeAppendPopover() {
        if (appendPopover) appendPopover.hidden = true;
        if (appendButton) appendButton.setAttribute("aria-expanded", "false");
    }

    function onAppendPcClick(event) {
        if (event) event.stopPropagation();
        closeAppendPopover();
        if (appendInput) appendInput.click();
    }

    function onAppendDriveClick(event) {
        if (event) event.stopPropagation();
        closeAppendPopover();
        openDrivePicker();
    }

    function onAppendChange() {
        var file = appendInput && appendInput.files && appendInput.files[0] ? appendInput.files[0] : null;
        setAppendFile(file);
    }

    function onEditorDragOver(event) {
        if (!event || !event.dataTransfer || !canAcceptAppendTransfer(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
    }

    function onEditorDrop(event) {
        if (!event || !event.dataTransfer) return;
        var payload = getAppendPayloadFromTransfer(event.dataTransfer);
        if (!payload) return;
        event.preventDefault();
        if (payload.file) {
            setAppendFile(payload.file);
            return;
        }
        if (payload.path) {
            appendDrivePath(payload.path);
        }
    }

    function getAppendPayloadFromTransfer(dataTransfer) {
        if (dataTransfer.files && dataTransfer.files.length > 0) {
            var file = Array.from(dataTransfer.files).find(function (candidate) {
                return isAudioPath(candidate && candidate.name || "");
            });
            return file ? { file: file } : null;
        }
        var text = "";
        try {
            text = dataTransfer.getData("text/plain") || "";
        } catch (error) {}
        var path = text.split(/\r?\n/).map(function (value) {
            return value.trim();
        }).find(function (value) {
            return value && isAudioPath(value);
        });
        return path ? { path: path } : null;
    }

    function canAcceptAppendTransfer(dataTransfer) {
        if (getAppendPayloadFromTransfer(dataTransfer)) return true;
        if (!dataTransfer.items || dataTransfer.items.length === 0) return false;
        return Array.from(dataTransfer.items).some(function (item) {
            if (!item || item.kind !== "file") return false;
            return String(item.type || "").toLowerCase().indexOf("audio/") === 0;
        });
    }

    function setAppendFile(file) {
        state.appendRequestVersion += 1;
        state.appendFile = file || null;
        resetAppendDecodeCache();
        if (appendInput) appendInput.value = "";
        syncAppendName();
        closeDrivePicker();
        setDirty(Boolean(state.appendFile) || getHasEditChanges());
        schedulePreviewRefresh(Boolean(state.appendFile));
    }

    function syncAppendName() {
        if (!appendName) return;
        appendName.textContent = state.appendFile ? state.appendFile.name : (appendName.dataset.emptyText || "선택된 파일 없음");
    }

    function openDrivePicker() {
        if (!drivePicker) return;
        drivePicker.hidden = false;
        loadDriveDirectory(state.driveDir || state.scopedHomeDir || "");
    }

    function closeDrivePicker() {
        if (drivePicker) drivePicker.hidden = true;
    }

    function onDriveUpClick() {
        state.driveDir = getScopedParentPath(state.driveDir || state.scopedHomeDir || "");
        loadDriveDirectory(state.driveDir);
    }

    function loadDriveDirectory(dirPath) {
        if (!state.listApiUrl || !driveList) return;
        state.driveDir = normalizePickerPath(dirPath || "");
        var requestedDir = state.driveDir;
        var sessionVersion = state.sessionVersion;
        if (drivePathEl) drivePathEl.textContent = state.driveDir || "/";
        driveList.textContent = "";
        fetch(appendQuery(state.listApiUrl, "path", state.driveDir), {
            credentials: "same-origin",
            headers: { "X-Requested-With": "XMLHttpRequest" },
        })
            .then(function (response) { return response.json(); })
            .then(function (data) {
                if (sessionVersion !== state.sessionVersion || requestedDir !== state.driveDir) return;
                renderDriveEntries(Array.isArray(data && data.entries) ? data.entries : []);
            })
            .catch(function () {
                if (sessionVersion !== state.sessionVersion || requestedDir !== state.driveDir) return;
                renderDriveEntries([]);
            });
    }

    function renderDriveEntries(entries) {
        if (!driveList) return;
        driveList.textContent = "";
        var visibleEntries = entries.filter(function (entry) {
            return entry && (entry.type === "dir" || isAudioPath(entry.name || entry.path || ""));
        });
        if (visibleEntries.length === 0) {
            var empty = document.createElement("div");
            empty.className = "ae-drive-empty";
            empty.textContent = driveList.dataset.emptyText || "No audio files";
            driveList.appendChild(empty);
            return;
        }
        visibleEntries.forEach(function (entry) {
            var button = document.createElement("button");
            button.type = "button";
            button.className = "ae-drive-row" + (entry.type === "dir" ? " is-dir" : " is-file");
            button.textContent = (entry.type === "dir" ? "▸ " : "") + (entry.name || entry.path || "");
            button.addEventListener("click", function () {
                if (entry.type === "dir") {
                    loadDriveDirectory(entry.path || "");
                } else {
                    selectDriveAudio(entry);
                }
            });
            driveList.appendChild(button);
        });
    }

    function selectDriveAudio(entry) {
        if (!entry || !state.buildDownloadUrl) return;
        appendDrivePath(entry.path || "", entry.name || "");
    }

    function appendDrivePath(path, fallbackName) {
        if (!path || !state.buildDownloadUrl || !isAudioPath(path) || !isPathInPickerScope(path)) return;
        var url = state.buildDownloadUrl(path);
        if (!url) return;
        var sessionVersion = state.sessionVersion;
        state.appendRequestVersion += 1;
        var requestVersion = state.appendRequestVersion;
        fetch(url, { credentials: "same-origin" })
            .then(function (response) {
                if (!response.ok) throw new Error("download failed");
                return response.blob();
            })
            .then(function (blob) {
                if (sessionVersion !== state.sessionVersion || requestVersion !== state.appendRequestVersion) return;
                var fileName = fallbackName || (path ? path.split("/").pop() : "append-audio");
                setAppendFile(new File([blob], fileName, { type: blob.type || "audio/*" }));
            })
            .catch(function () {});
    }

    function onStartRangeInput() {
        var start = Math.max(0, Number(startRange && startRange.value) || 0);
        var end = getEndTime();
        if (end && start > end) start = end;
        if (startInput) startInput.value = formatTime(start);
        if (audioEl) audioEl.currentTime = 0;
        clampTimeInputs();
        syncRangeInputs();
        syncTimeDisplays();
        setDirty(true);
        schedulePreviewRefresh(true);
    }

    function onEndRangeInput() {
        var start = getStartTime();
        var end = Math.max(0, Number(endRange && endRange.value) || 0);
        if (end < start) end = start;
        if (endInput) endInput.value = formatTime(end);
        clampTimeInputs();
        syncRangeInputs();
        syncTimeDisplays();
        setDirty(true);
        schedulePreviewRefresh(true);
    }

    function clampTimeInputs() {
        var start = Math.max(0, readTimeValue(startInput && startInput.value, 0));
        var end = Math.max(0, readTimeValue(endInput && endInput.value, 0));
        if (state.duration) {
            start = Math.min(start, state.duration);
            end = Math.min(end || state.duration, state.duration);
        }
        if (end && end < start) end = start;
        if (startInput) startInput.value = formatTime(start);
        if (endInput) endInput.value = formatTime(end);
    }

    function readFiniteNumber(value, fallback) {
        var parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function readTimeValue(value, fallback) {
        var raw = String(value == null ? "" : value).trim();
        if (!raw) return fallback;
        if (!raw.includes(":")) return readFiniteNumber(raw, fallback);
        var parts = raw.split(":");
        if (parts.length > 3) return fallback;
        var total = 0;
        for (var index = 0; index < parts.length; index += 1) {
            var part = Number(parts[index]);
            if (!Number.isFinite(part) || part < 0) return fallback;
            total = total * 60 + part;
        }
        return total;
    }

    function syncRangeInputs() {
        var start = getStartTime();
        var end = getEndTime();
        if (startRange) {
            startRange.max = state.duration ? state.duration.toFixed(2) : "0";
            startRange.value = start.toFixed(2);
        }
        if (endRange) {
            endRange.max = state.duration ? state.duration.toFixed(2) : "0";
            endRange.value = end.toFixed(2);
        }
        syncRangeSelection();
    }

    function syncRangeSelection() {
        if (!rangeSelection || !state.duration) {
            if (rangeSelection) {
                rangeSelection.style.left = "0%";
                rangeSelection.style.width = "0%";
            }
            return;
        }
        var startPercent = Math.max(0, Math.min(100, (getStartTime() / state.duration) * 100));
        var endPercent = Math.max(startPercent, Math.min(100, (getEndTime() / state.duration) * 100));
        rangeSelection.style.left = startPercent + "%";
        rangeSelection.style.width = (endPercent - startPercent) + "%";
    }

    function getStartTime() {
        return Math.max(0, readTimeValue(startInput && startInput.value, 0));
    }

    function getEndTime() {
        var end = Math.max(0, readTimeValue(endInput && endInput.value, 0));
        return end || state.duration || 0;
    }

    function getSelectedDuration() {
        return Math.max(0, getEndTime() - getStartTime());
    }

    function normalizePath(pathValue) {
        return String(pathValue || "")
            .replace(/\\/g, "/")
            .replace(/^\/+|\/+$/g, "")
            .replace(/\/{2,}/g, "/");
    }

    function getParentPath(pathValue) {
        var normalized = normalizePath(pathValue);
        var slashIndex = normalized.lastIndexOf("/");
        return slashIndex > 0 ? normalized.slice(0, slashIndex) : "";
    }

    function getScopedParentPath(pathValue) {
        var normalized = normalizePath(pathValue);
        var scopedRoot = normalizePath(state.scopedHomeDir || "");
        if (scopedRoot && (!normalized || normalized === scopedRoot || normalized.indexOf(scopedRoot + "/") !== 0)) {
            return scopedRoot;
        }
        var parent = getParentPath(normalized);
        if (scopedRoot && (!parent || parent === scopedRoot || parent.indexOf(scopedRoot + "/") !== 0)) {
            return scopedRoot;
        }
        return parent;
    }

    function normalizePickerPath(pathValue) {
        var normalized = normalizePath(pathValue);
        var scopedRoot = normalizePath(state.scopedHomeDir || "");
        if (scopedRoot && (!normalized || normalized === scopedRoot || normalized.indexOf(scopedRoot + "/") !== 0)) {
            return scopedRoot;
        }
        return normalized;
    }

    function isPathInPickerScope(pathValue) {
        var normalized = normalizePath(pathValue);
        var scopedRoot = normalizePath(state.scopedHomeDir || "");
        return !scopedRoot || normalized === scopedRoot || normalized.indexOf(scopedRoot + "/") === 0;
    }

    function appendQuery(url, key, value) {
        var separator = String(url || "").indexOf("?") === -1 ? "?" : "&";
        return String(url || "") + separator + encodeURIComponent(key) + "=" + encodeURIComponent(value || "");
    }

    function isAudioPath(pathValue) {
        return /\.(mp3|wav|ogg|m4a|aac|flac|weba)$/i.test(String(pathValue || ""));
    }

    function isFullSelection() {
        return getStartTime() <= 0.01 && Math.abs(getEndTime() - (state.duration || 0)) <= 0.01;
    }

    function resetAppendDecodeCache() {
        state.appendDecodedBufferPromise = null;
        state.appendDecodedBuffer = null;
    }

    function clearPreviewTimer() {
        if (state.previewTimer) {
            window.clearTimeout(state.previewTimer);
            state.previewTimer = null;
        }
    }

    function schedulePreviewRefresh(shouldPlay) {
        clearPreviewTimer();
        state.previewVersion += 1;
        var version = state.previewVersion;
        var sessionVersion = state.sessionVersion;
        state.previewShouldPlay = Boolean(shouldPlay);
        setPreviewBuilding(true);
        state.previewTimer = window.setTimeout(function () {
            refreshTrimmedPreview(version, sessionVersion);
        }, 180);
    }

    function cancelPendingAudioWork() {
        clearPreviewTimer();
        state.previewVersion += 1;
        if (state.decodeAbortController) {
            state.decodeAbortController.abort();
            state.decodeAbortController = null;
        }
        revokePreviewObjectUrl();
        setPreviewBuilding(false);
    }

    function revokePreviewObjectUrl() {
        if (state.previewObjectUrl) {
            URL.revokeObjectURL(state.previewObjectUrl);
            state.previewObjectUrl = "";
        }
    }

    function setAudioSource(sourceUrl, usingTrimmedPreview, shouldPlay) {
        if (!audioEl || !sourceUrl || audioEl.src === sourceUrl) {
            if (shouldPlay) playAudioPreview();
            return;
        }
        audioEl.pause();
        audioEl.removeEventListener("loadedmetadata", playAudioPreview);
        state.usingTrimmedPreview = Boolean(usingTrimmedPreview);
        if (shouldPlay) {
            audioEl.addEventListener("loadedmetadata", playAudioPreview, { once: true });
        }
        audioEl.src = sourceUrl;
        audioEl.load();
    }

    function refreshTrimmedPreview(version, sessionVersion) {
        state.previewTimer = null;
        var shouldPlay = state.previewShouldPlay;
        state.previewShouldPlay = false;
        if (version !== state.previewVersion || sessionVersion !== state.sessionVersion) return;
        if (!audioEl || !state.audioServeUrl || !state.duration) {
            setPreviewBuilding(false);
            return;
        }
        if (isFullSelection() && !state.appendFile) {
            revokePreviewObjectUrl();
            state.usingTrimmedPreview = false;
            setAudioSource(state.audioServeUrl, false, shouldPlay);
            setWaveformBuffer(state.decodedBuffer);
            setPreviewBuilding(false);
            return;
        }
        var startTime = getStartTime();
        var endTime = getEndTime();
        var selectedDuration = Math.max(0, endTime - startTime);
        if (selectedDuration <= 0.01) {
            setPreviewBuilding(false);
            return;
        }
        var AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass || typeof fetch !== "function") {
            if (shouldPlay) playAudioPreview();
            setPreviewBuilding(false);
            return;
        }
        Promise.all([
            getDecodedBuffer(AudioContextClass),
            state.appendFile ? getAppendDecodedBuffer(AudioContextClass) : Promise.resolve(null),
        ])
            .then(function (buffers) {
                var sourceBuffer = buffers[0];
                var appendBuffer = buffers[1];
                if (!sourceBuffer || version !== state.previewVersion || sessionVersion !== state.sessionVersion) return;
                var preview = buildPreviewWav(AudioContextClass, sourceBuffer, startTime, endTime, appendBuffer);
                if (!preview || !preview.blob || version !== state.previewVersion || sessionVersion !== state.sessionVersion) return;
                var nextUrl = URL.createObjectURL(preview.blob);
                if (version !== state.previewVersion || sessionVersion !== state.sessionVersion) {
                    URL.revokeObjectURL(nextUrl);
                    return;
                }
                var previousUrl = state.previewObjectUrl;
                state.previewObjectUrl = nextUrl;
                setAudioSource(nextUrl, true, shouldPlay);
                setWaveformBuffer(preview.buffer);
                if (previousUrl) URL.revokeObjectURL(previousUrl);
            })
            .catch(function (error) {
                if (error && error.name === "AbortError") return;
            })
            .finally(function () {
                if (version === state.previewVersion && sessionVersion === state.sessionVersion) {
                    setPreviewBuilding(false);
                }
            });
    }

    function playAudioPreview() {
        if (!audioEl) return;
        try {
            audioEl.currentTime = state.usingTrimmedPreview ? 0 : getStartTime();
        } catch (error) {
            // ignore seek failures before metadata is available
        }
        audioEl.play().catch(function () {});
    }

    function getDecodedBuffer(AudioContextClass) {
        if (state.decodedBuffer) {
            return Promise.resolve(state.decodedBuffer);
        }
        if (state.decodedBufferPromise) {
            return state.decodedBufferPromise;
        }
        var sessionVersion = state.sessionVersion;
        var sourceUrl = state.audioServeUrl;
        var abortController = typeof AbortController !== "undefined" ? new AbortController() : null;
        state.decodeAbortController = abortController;
        var fetchOptions = { credentials: "same-origin" };
        if (abortController) fetchOptions.signal = abortController.signal;
        state.decodedBufferPromise = fetch(sourceUrl, fetchOptions)
            .then(function (response) {
                if (!response.ok) throw new Error("audio fetch failed");
                return response.arrayBuffer();
            })
            .then(function (arrayBuffer) {
                var context = new AudioContextClass();
                return context.decodeAudioData(arrayBuffer.slice(0))
                    .then(function (decodedBuffer) {
                        if (sessionVersion !== state.sessionVersion || sourceUrl !== state.audioServeUrl) {
                            throw new DOMException("Stale audio session", "AbortError");
                        }
                        state.decodedBuffer = decodedBuffer;
                        return decodedBuffer;
                    })
                    .finally(function () {
                        if (context.close) context.close();
                    });
            })
            .catch(function (error) {
                if (sessionVersion === state.sessionVersion && sourceUrl === state.audioServeUrl) {
                    state.decodedBufferPromise = null;
                }
                throw error;
            })
            .finally(function () {
                if (state.decodeAbortController === abortController) state.decodeAbortController = null;
            });
        return state.decodedBufferPromise;
    }

    function getAppendDecodedBuffer(AudioContextClass) {
        if (!state.appendFile) {
            return Promise.resolve(null);
        }
        if (state.appendDecodedBuffer) {
            return Promise.resolve(state.appendDecodedBuffer);
        }
        if (state.appendDecodedBufferPromise) {
            return state.appendDecodedBufferPromise;
        }
        var appendFile = state.appendFile;
        var sessionVersion = state.sessionVersion;
        state.appendDecodedBufferPromise = appendFile.arrayBuffer()
            .then(function (arrayBuffer) {
                var context = new AudioContextClass();
                return context.decodeAudioData(arrayBuffer.slice(0))
                    .then(function (decodedBuffer) {
                        if (sessionVersion !== state.sessionVersion || appendFile !== state.appendFile) {
                            throw new DOMException("Stale appended audio", "AbortError");
                        }
                        state.appendDecodedBuffer = decodedBuffer;
                        return decodedBuffer;
                    })
                    .finally(function () {
                        if (context.close) context.close();
                    });
            })
            .catch(function (error) {
                if (sessionVersion === state.sessionVersion && appendFile === state.appendFile) {
                    state.appendDecodedBufferPromise = null;
                }
                throw error;
            });
        return state.appendDecodedBufferPromise;
    }

    function buildPreviewWav(AudioContextClass, sourceBuffer, startSeconds, endSeconds, appendBuffer) {
        var sampleRate = sourceBuffer.sampleRate;
        var startSample = Math.max(0, Math.floor(startSeconds * sampleRate));
        var endSample = Math.min(sourceBuffer.length, Math.ceil(endSeconds * sampleRate));
        var trimFrameCount = Math.max(1, endSample - startSample);
        var appendFrameCount = appendBuffer ? Math.max(1, Math.round(appendBuffer.duration * sampleRate)) : 0;
        var frameCount = trimFrameCount + appendFrameCount;
        var channels = Math.max(sourceBuffer.numberOfChannels, appendBuffer ? appendBuffer.numberOfChannels : 0);
        var context = new AudioContextClass();
        var trimmedBuffer = context.createBuffer(channels, frameCount, sampleRate);
        for (var channel = 0; channel < channels; channel += 1) {
            var sourceData = sourceBuffer.getChannelData(Math.min(channel, sourceBuffer.numberOfChannels - 1));
            var targetData = trimmedBuffer.getChannelData(channel);
            targetData.set(sourceData.subarray(startSample, endSample), 0);
            if (appendBuffer) {
                copyResampledChannel(appendBuffer, channel, targetData, trimFrameCount, sampleRate, appendFrameCount);
            }
        }
        if (context.close) context.close();
        return {
            blob: encodeWavBlob(trimmedBuffer),
            buffer: trimmedBuffer,
        };
    }

    function copyResampledChannel(sourceBuffer, channel, targetData, targetOffset, targetSampleRate, targetFrameCount) {
        var sourceChannel = Math.min(channel, sourceBuffer.numberOfChannels - 1);
        var sourceData = sourceBuffer.getChannelData(sourceChannel);
        var ratio = sourceBuffer.sampleRate / targetSampleRate;
        for (var index = 0; index < targetFrameCount; index += 1) {
            var sourceIndex = Math.min(sourceData.length - 1, Math.floor(index * ratio));
            targetData[targetOffset + index] = sourceData[sourceIndex] || 0;
        }
    }

    function encodeWavBlob(buffer) {
        var channels = buffer.numberOfChannels;
        var sampleRate = buffer.sampleRate;
        var frameCount = buffer.length;
        var bytesPerSample = 2;
        var blockAlign = channels * bytesPerSample;
        var dataSize = frameCount * blockAlign;
        var arrayBuffer = new ArrayBuffer(44 + dataSize);
        var view = new DataView(arrayBuffer);
        writeAscii(view, 0, "RIFF");
        view.setUint32(4, 36 + dataSize, true);
        writeAscii(view, 8, "WAVE");
        writeAscii(view, 12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, channels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, 16, true);
        writeAscii(view, 36, "data");
        view.setUint32(40, dataSize, true);
        var offset = 44;
        for (var index = 0; index < frameCount; index += 1) {
            for (var channel = 0; channel < channels; channel += 1) {
                var sample = buffer.getChannelData(channel)[index];
                sample = Math.max(-1, Math.min(1, sample));
                view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
                offset += 2;
            }
        }
        return new Blob([arrayBuffer], { type: "audio/wav" });
    }

    function writeAscii(view, offset, text) {
        for (var index = 0; index < text.length; index += 1) {
            view.setUint8(offset + index, text.charCodeAt(index));
        }
    }

    function loadWaveform(sessionVersion) {
        var AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass || !waveformCanvas) return;
        getDecodedBuffer(AudioContextClass)
            .then(function (buffer) {
                if (sessionVersion !== state.sessionVersion || !buffer) return;
                if (!state.usingTrimmedPreview) setWaveformBuffer(buffer);
            })
            .catch(function (error) {
                if ((!error || error.name !== "AbortError") && !state.usingTrimmedPreview) {
                    setWaveformBuffer(null);
                }
            });
    }

    function setWaveformBuffer(buffer) {
        state.waveformBuffer = buffer || null;
        if (state.waveformBuffer) {
            drawWaveform(state.waveformBuffer);
        } else {
            clearWaveform();
        }
    }

    function drawWaveform(buffer) {
        if (!waveformCanvas || !waveformVisual || !buffer || !buffer.length) return;
        var width = Math.max(1, Math.round(waveformVisual.clientWidth || 1));
        var height = Math.max(1, Math.round(waveformVisual.clientHeight || 1));
        var dpr = Math.max(1, window.devicePixelRatio || 1);
        waveformCanvas.width = Math.round(width * dpr);
        waveformCanvas.height = Math.round(height * dpr);
        waveformCanvas.style.width = width + "px";
        waveformCanvas.style.height = height + "px";
        var context = waveformCanvas.getContext("2d");
        if (!context) return;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, width, height);
        var style = surface ? window.getComputedStyle(surface) : null;
        var accent = style ? style.getPropertyValue("--hme-accent").trim() : "";
        context.strokeStyle = accent || "#2563eb";
        context.lineWidth = 1.35;
        context.globalAlpha = 0.9;
        var channelCount = Math.max(1, Math.min(2, buffer.numberOfChannels || 1));
        var samplesPerPixel = Math.max(1, Math.floor(buffer.length / width));
        var center = height / 2;
        context.beginPath();
        for (var x = 0; x < width; x += 1) {
            var startSample = x * samplesPerPixel;
            var endSample = Math.min(buffer.length, startSample + samplesPerPixel);
            var peak = 0;
            for (var channel = 0; channel < channelCount; channel += 1) {
                var channelData = buffer.getChannelData(channel);
                var stride = Math.max(1, Math.floor((endSample - startSample) / 32));
                for (var sampleIndex = startSample; sampleIndex < endSample; sampleIndex += stride) {
                    peak = Math.max(peak, Math.abs(channelData[sampleIndex] || 0));
                }
            }
            var amplitude = Math.max(1, peak * (height * 0.44));
            context.moveTo(x + 0.5, center - amplitude);
            context.lineTo(x + 0.5, center + amplitude);
        }
        context.stroke();
        waveformVisual.classList.add("has-waveform");
        syncWaveformPlayhead();
    }

    function clearWaveform() {
        if (waveformCanvas) {
            var context = waveformCanvas.getContext("2d");
            if (context) context.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
        }
        if (waveformVisual) waveformVisual.classList.remove("has-waveform");
        if (waveformPlayhead) waveformPlayhead.style.left = "0%";
    }

    function bindWaveformResizeObserver() {
        unbindWaveformResizeObserver();
        if (typeof ResizeObserver === "undefined" || !waveformVisual) return;
        waveformResizeObserver = new ResizeObserver(function () {
            if (state.waveformBuffer) drawWaveform(state.waveformBuffer);
        });
        waveformResizeObserver.observe(waveformVisual);
    }

    function unbindWaveformResizeObserver() {
        if (!waveformResizeObserver) return;
        waveformResizeObserver.disconnect();
        waveformResizeObserver = null;
    }

    function syncWaveformPlayhead() {
        if (!waveformPlayhead || !audioEl) return;
        var waveformDuration = state.waveformBuffer && Number.isFinite(state.waveformBuffer.duration)
            ? state.waveformBuffer.duration
            : 0;
        var denominator = waveformDuration || (state.usingTrimmedPreview ? Number(audioEl.duration) || 0 : state.duration);
        var ratio = denominator > 0 ? (Number(audioEl.currentTime) || 0) / denominator : 0;
        waveformPlayhead.style.left = Math.max(0, Math.min(100, ratio * 100)) + "%";
    }

    function setPreviewBuilding(building) {
        if (!trackCard) return;
        trackCard.classList.toggle("is-preview-building", Boolean(building));
        trackCard.setAttribute("aria-busy", building ? "true" : "false");
    }

    function setMediaLoading(loading) {
        if (!surface) return;
        surface.classList.toggle("is-loading", Boolean(loading));
        surface.setAttribute("aria-busy", loading ? "true" : "false");
    }

    function setDisabled(disabled) {
        state.isDisabled = Boolean(disabled);
        if (!surface) return;
        surface.inert = state.isDisabled;
        surface.classList.toggle("is-disabled", state.isDisabled);
        surface.setAttribute("aria-disabled", state.isDisabled ? "true" : "false");
    }

    function syncVolumeDisplay() {
        if (!volumeDisplay || !volumeInput) return;
        volumeDisplay.textContent = Math.round((Number(volumeInput.value) || 0) * 100) + "%";
    }

    function syncTimeDisplays() {
        var currentTime = audioEl ? Number(audioEl.currentTime) || 0 : 0;
        if (state.usingTrimmedPreview) currentTime += getStartTime();
        if (currentTimeEl) currentTimeEl.textContent = formatTime(currentTime);
        if (durationEl) durationEl.textContent = formatTime(getEndTime());
        syncWaveformPlayhead();
    }

    function formatTime(seconds) {
        var total = Math.max(0, Number(seconds) || 0);
        var centiseconds = Math.round(total * 100);
        var minutes = Math.floor(centiseconds / 6000);
        var rest = centiseconds % 6000;
        var secondsPart = Math.floor(rest / 100);
        var fractionalPart = rest % 100;
        return minutes + ":" + (secondsPart < 10 ? "0" : "") + secondsPart + "." + (fractionalPart < 10 ? "0" : "") + fractionalPart;
    }

    function getHasEditChanges() {
        var start = readTimeValue(startInput && startInput.value, 0);
        var end = readTimeValue(endInput && endInput.value, 0);
        var volume = readFiniteNumber(volumeInput && volumeInput.value, 1);
        return Math.abs(start) > 0.001 ||
            (state.duration && Math.abs(end - state.duration) > 0.01) ||
            Math.abs(volume - 1) > 0.001 ||
            Boolean(state.appendFile);
    }

    function setDirty(isDirty) {
        var nextDirty = Boolean(isDirty);
        if (nextDirty) state.changeRevision += 1;
        state.isDirty = nextDirty;
        if (state.onDirtyChange) state.onDirtyChange(state.isDirty);
    }

    function saveToServer(saveUrl, csrfToken, path, onDone, options) {
        var saveOptions = options || {};
        var targetFilename = String(saveOptions.filename || "").trim();
        if (!saveUrl || !path) {
            onDone && onDone({ ok: false, error: "요청 처리 중 오류가 발생했습니다." });
            return;
        }
        if (!state.isReady) {
            onDone && onDone({ ok: false, error: "오디오 로드가 완료되지 않았습니다." });
            return;
        }
        if (state.isSaving) {
            onDone && onDone({ ok: false, error: "이미 저장 중입니다." });
            return;
        }
        state.isSaving = true;
        var saveRevision = state.changeRevision;
        var saveSessionVersion = state.sessionVersion;
        clampTimeInputs();
        var formData = new FormData();
        formData.append("path", path);
        formData.append("trim_start", String(getStartTime()));
        formData.append("trim_end", String(getEndTime()));
        formData.append("volume", String(readFiniteNumber(volumeInput && volumeInput.value, 1)));
        if (targetFilename) {
            formData.append("filename", targetFilename);
        }
        if (state.appendFile) {
            formData.append("append_blob", state.appendFile, state.appendFile.name);
        }
        fetch(saveUrl, {
            method: "POST",
            headers: csrfToken ? { "X-CSRFToken": csrfToken, "X-Requested-With": "XMLHttpRequest" } : { "X-Requested-With": "XMLHttpRequest" },
            body: formData,
        })
            .then(function (response) { return response.json(); })
            .then(function (data) {
                if (saveSessionVersion !== state.sessionVersion) return;
                state.isSaving = false;
                if (data && data.ok && state.changeRevision === saveRevision) setDirty(false);
                onDone && onDone(data || { ok: false });
            })
            .catch(function (error) {
                if (saveSessionVersion !== state.sessionVersion) return;
                state.isSaving = false;
                onDone && onDone({ ok: false, error: String(error) });
            });
    }

    window.HandriveAudioEditor = {
        init: init,
        destroy: destroy,
        getIsDirty: function () { return state.isDirty; },
        getIsReady: function () { return state.isReady; },
        setDisabled: setDisabled,
        saveToServer: saveToServer,
    };
})();
