(function () {
    "use strict";

    var state = {
        entry: null,
        onDirtyChange: null,
        isDirty: false,
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
        decodedBufferPromise: null,
        decodedBuffer: null,
        appendDecodedBufferPromise: null,
        appendDecodedBuffer: null,
        usingTrimmedPreview: false,
        hasLoadedOriginalMetadata: false,
    };

    var surface, audioEl, resetBtn, startInput, endInput, volumeInput;
    var volumeButton, volumePopover, volumeDisplay, appendButton, appendPopover, appendPcButton, appendDriveButton;
    var appendInput, appendName, drivePicker, driveCloseButton, driveUpButton, drivePathEl, driveList;
    var startRange, endRange, rangeSelection;
    var currentTimeEl, durationEl, titleEl;

    function init(options) {
        var opts = options || {};
        state.entry = opts.entry || null;
        state.onDirtyChange = opts.onDirtyChange || null;
        state.isDirty = false;
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
        state.previewVersion = 0;
        state.decodedBufferPromise = null;
        state.decodedBuffer = null;
        state.appendDecodedBufferPromise = null;
        state.appendDecodedBuffer = null;
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
        titleEl = document.getElementById("ae-title");

        if (!audioEl) return;
        unbindEvents();
        resetControls();
        bindEvents();

        if (titleEl) titleEl.textContent = state.entry && state.entry.name ? state.entry.name : "Audio";
        audioEl.src = state.audioServeUrl;
        audioEl.load();
    }

    function destroy() {
        unbindEvents();
        clearPreviewTimer();
        revokePreviewObjectUrl();
        if (audioEl) {
            audioEl.pause();
            audioEl.removeAttribute("src");
            audioEl.load();
        }
        state.entry = null;
        state.onDirtyChange = null;
        state.appendFile = null;
        state.isDirty = false;
        state.audioServeUrl = "";
        state.listApiUrl = "";
        state.buildDownloadUrl = null;
        state.scopedHomeDir = "";
        state.driveDir = "";
        state.decodedBufferPromise = null;
        state.decodedBuffer = null;
        state.appendDecodedBufferPromise = null;
        state.appendDecodedBuffer = null;
        state.usingTrimmedPreview = false;
        state.hasLoadedOriginalMetadata = false;
    }

    function resetControls() {
        if (startInput) startInput.value = "0";
        if (endInput) endInput.value = "0";
        if (volumeInput) volumeInput.value = "1";
        state.appendFile = null;
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
        audioEl.addEventListener("timeupdate", onTimeUpdate);
        if (resetBtn) resetBtn.addEventListener("click", onResetClick);
        if (startInput) startInput.addEventListener("input", onControlInput);
        if (endInput) endInput.addEventListener("input", onControlInput);
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
            audioEl.removeEventListener("timeupdate", onTimeUpdate);
        }
        if (resetBtn) resetBtn.removeEventListener("click", onResetClick);
        if (startInput) startInput.removeEventListener("input", onControlInput);
        if (endInput) endInput.removeEventListener("input", onControlInput);
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
        state.duration = Number.isFinite(audioEl.duration) ? audioEl.duration : 0;
        state.hasLoadedOriginalMetadata = true;
        if (endInput) endInput.value = state.duration ? state.duration.toFixed(2) : "0";
        if (startRange) startRange.max = state.duration ? state.duration.toFixed(2) : "0";
        if (endRange) {
            endRange.max = state.duration ? state.duration.toFixed(2) : "0";
            endRange.value = state.duration ? state.duration.toFixed(2) : "0";
        }
        syncRangeSelection();
        syncTimeDisplays();
        setDirty(false);
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
        if (startInput) startInput.value = "0";
        if (endInput && state.duration) endInput.value = state.duration.toFixed(2);
        if (audioEl) audioEl.currentTime = 0;
        syncRangeInputs();
        syncTimeDisplays();
        schedulePreviewRefresh();
        setDirty(false);
    }

    function onControlInput() {
        clampTimeInputs();
        syncRangeInputs();
        setDirty(true);
        schedulePreviewRefresh(true);
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
        state.appendFile = appendInput && appendInput.files && appendInput.files[0] ? appendInput.files[0] : null;
        resetAppendDecodeCache();
        syncAppendName();
        setDirty(Boolean(state.appendFile) || getHasEditChanges());
        schedulePreviewRefresh(Boolean(state.appendFile));
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
        if (drivePathEl) drivePathEl.textContent = state.driveDir || "/";
        driveList.textContent = "";
        fetch(appendQuery(state.listApiUrl, "path", state.driveDir), {
            credentials: "same-origin",
            headers: { "X-Requested-With": "XMLHttpRequest" },
        })
            .then(function (response) { return response.json(); })
            .then(function (data) {
                renderDriveEntries(Array.isArray(data && data.entries) ? data.entries : []);
            })
            .catch(function () {
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
        fetch(url, { credentials: "same-origin" })
            .then(function (response) {
                if (!response.ok) throw new Error("download failed");
                return response.blob();
            })
            .then(function (blob) {
                var fileName = fallbackName || (path ? path.split("/").pop() : "append-audio");
                setAppendFile(new File([blob], fileName, { type: blob.type || "audio/*" }));
            })
            .catch(function () {});
    }

    function onStartRangeInput() {
        var start = Math.max(0, Number(startRange && startRange.value) || 0);
        var end = getEndTime();
        if (end && start > end) start = end;
        if (startInput) startInput.value = start.toFixed(2);
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
        if (endInput) endInput.value = end.toFixed(2);
        clampTimeInputs();
        syncRangeInputs();
        syncTimeDisplays();
        setDirty(true);
        schedulePreviewRefresh(true);
    }

    function clampTimeInputs() {
        var start = Math.max(0, Number(startInput && startInput.value) || 0);
        var end = Math.max(0, Number(endInput && endInput.value) || 0);
        if (state.duration) {
            start = Math.min(start, state.duration);
            end = Math.min(end || state.duration, state.duration);
        }
        if (end && end < start) end = start;
        if (startInput) startInput.value = start.toFixed(2);
        if (endInput) endInput.value = end.toFixed(2);
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
        return Math.max(0, Number(startInput && startInput.value) || 0);
    }

    function getEndTime() {
        var end = Math.max(0, Number(endInput && endInput.value) || 0);
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
        state.previewShouldPlay = Boolean(shouldPlay);
        state.previewTimer = window.setTimeout(refreshTrimmedPreview, 180);
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
        state.usingTrimmedPreview = Boolean(usingTrimmedPreview);
        if (shouldPlay) {
            audioEl.addEventListener("loadedmetadata", playAudioPreview, { once: true });
        }
        audioEl.src = sourceUrl;
        audioEl.load();
    }

    function refreshTrimmedPreview() {
        state.previewTimer = null;
        var shouldPlay = state.previewShouldPlay;
        state.previewShouldPlay = false;
        if (!audioEl || !state.audioServeUrl || !state.duration) return;
        if (isFullSelection() && !state.appendFile) {
            revokePreviewObjectUrl();
            state.usingTrimmedPreview = false;
            setAudioSource(state.audioServeUrl, false, shouldPlay);
            return;
        }
        var selectedDuration = getSelectedDuration();
        if (selectedDuration <= 0.01) return;
        var AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass || typeof fetch !== "function") {
            if (shouldPlay) playAudioPreview();
            return;
        }
        var version = state.previewVersion + 1;
        state.previewVersion = version;
        Promise.all([
            getDecodedBuffer(AudioContextClass),
            state.appendFile ? getAppendDecodedBuffer(AudioContextClass) : Promise.resolve(null),
        ])
            .then(function (buffers) {
                var sourceBuffer = buffers[0];
                var appendBuffer = buffers[1];
                if (!sourceBuffer || version !== state.previewVersion) return;
                var wavBlob = buildPreviewWavBlob(AudioContextClass, sourceBuffer, getStartTime(), getEndTime(), appendBuffer);
                if (!wavBlob || version !== state.previewVersion) return;
                var nextUrl = URL.createObjectURL(wavBlob);
                var previousUrl = state.previewObjectUrl;
                state.previewObjectUrl = nextUrl;
                setAudioSource(nextUrl, true, shouldPlay);
                if (previousUrl) URL.revokeObjectURL(previousUrl);
            })
            .catch(function () {});
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
        state.decodedBufferPromise = fetch(state.audioServeUrl, { credentials: "same-origin" })
            .then(function (response) {
                if (!response.ok) throw new Error("audio fetch failed");
                return response.arrayBuffer();
            })
            .then(function (arrayBuffer) {
                var context = new AudioContextClass();
                return context.decodeAudioData(arrayBuffer.slice(0))
                    .then(function (decodedBuffer) {
                        if (context.close) context.close();
                        state.decodedBuffer = decodedBuffer;
                        return decodedBuffer;
                    });
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
        state.appendDecodedBufferPromise = state.appendFile.arrayBuffer()
            .then(function (arrayBuffer) {
                var context = new AudioContextClass();
                return context.decodeAudioData(arrayBuffer.slice(0))
                    .then(function (decodedBuffer) {
                        if (context.close) context.close();
                        state.appendDecodedBuffer = decodedBuffer;
                        return decodedBuffer;
                    });
            });
        return state.appendDecodedBufferPromise;
    }

    function buildPreviewWavBlob(AudioContextClass, sourceBuffer, startSeconds, endSeconds, appendBuffer) {
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
        return encodeWavBlob(trimmedBuffer);
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

    function syncVolumeDisplay() {
        if (!volumeDisplay || !volumeInput) return;
        volumeDisplay.textContent = Math.round((Number(volumeInput.value) || 0) * 100) + "%";
    }

    function syncTimeDisplays() {
        if (currentTimeEl) currentTimeEl.textContent = formatTime(getStartTime());
        if (durationEl) durationEl.textContent = formatTime(getEndTime());
    }

    function formatTime(seconds) {
        var total = Math.max(0, Number(seconds) || 0);
        var minutes = Math.floor(total / 60);
        var rest = total - minutes * 60;
        return minutes + ":" + (rest < 10 ? "0" : "") + rest.toFixed(2);
    }

    function getHasEditChanges() {
        var start = Number(startInput && startInput.value) || 0;
        var end = Number(endInput && endInput.value) || 0;
        var volume = Number(volumeInput && volumeInput.value) || 1;
        return Math.abs(start) > 0.001 ||
            (state.duration && Math.abs(end - state.duration) > 0.01) ||
            Math.abs(volume - 1) > 0.001 ||
            Boolean(state.appendFile);
    }

    function setDirty(isDirty) {
        state.isDirty = Boolean(isDirty);
        if (state.onDirtyChange) state.onDirtyChange(state.isDirty);
    }

    function saveToServer(saveUrl, csrfToken, path, onDone) {
        if (!saveUrl || !path) {
            onDone && onDone({ ok: false, error: "요청 처리 중 오류가 발생했습니다." });
            return;
        }
        clampTimeInputs();
        var formData = new FormData();
        formData.append("path", path);
        formData.append("trim_start", String(Number(startInput && startInput.value) || 0));
        formData.append("trim_end", String(Number(endInput && endInput.value) || 0));
        formData.append("volume", String(Number(volumeInput && volumeInput.value) || 1));
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
                if (data && data.ok) setDirty(false);
                onDone && onDone(data || { ok: false });
            })
            .catch(function (error) {
                onDone && onDone({ ok: false, error: String(error) });
            });
    }

    window.HandriveAudioEditor = {
        init: init,
        destroy: destroy,
        getIsDirty: function () { return state.isDirty; },
        saveToServer: saveToServer,
    };
})();
