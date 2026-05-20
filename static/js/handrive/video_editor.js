(function () {
    "use strict";

    var state = {
        entry: null,
        onDirtyChange: null,
        isDirty: false,
        duration: 0,
        subtitles: [],
        selectedSubtitleId: "",
        nextSubtitleIndex: 1,
        images: [],
        selectedImageId: "",
        nextImageIndex: 1,
        drag: null,
        appendFile: null,
        buildDownloadUrl: null,
        listApiUrl: "",
        imageDriveDir: "",
        scopedHomeDir: "",
    };

    var videoEl, resetBtn, startInput, endInput, volumeButton, volumePopover, volumeInput, volumeDisplay;
    var startRange, endRange, rangeSelection, currentTimeEl, durationEl, titleEl;
    var inputSubtitleButton, inputImageButton;
    var subtitleField, subtitleSelect, subtitleAddButton, subtitleDeleteButton, subtitleHideButton;
    var subtitleInput, subtitleFontFamilySelect, subtitleFontSizeInput, subtitleBoldButton, subtitleItalicButton, subtitleUnderlineButton;
    var subtitleFontColor, subtitleFontColorEnabled, subtitleFontStrokeColor, subtitleFontStrokeEnabled;
    var subtitleBgColor, subtitleBgEnabled, subtitleBorderColor, subtitleBorderEnabled;
    var subtitleStartRange, subtitleEndRange, subtitleRangeSelection, subtitleStartTime, subtitleEndTime;
    var imageField, imageSelect, imageAddButton, imageDeleteButton, imageHideButton, imageStartRange, imageEndRange, imageRangeSelection, imageStartTime, imageEndTime;
    var imageUploadDialog, imageUploadCloseButton, imageDropZone, imageFileInput, imageDriveButton, imageDrivePicker, imageDriveUpButton, imageDrivePathEl, imageDriveList;
    var surface, videoStage, subtitleLayer;
    var videoStageSizeFrame = 0;
    var videoStageResizeObserver = null;

    function init(options) {
        var opts = options || {};
        state.entry = opts.entry || null;
        state.onDirtyChange = opts.onDirtyChange || null;
        state.isDirty = false;
        state.duration = 0;
        state.subtitles = [];
        state.selectedSubtitleId = "";
        state.nextSubtitleIndex = 1;
        state.images = [];
        state.selectedImageId = "";
        state.nextImageIndex = 1;
        state.drag = null;
        state.appendFile = null;
        state.buildDownloadUrl = typeof opts.buildDownloadUrl === "function" ? opts.buildDownloadUrl : null;
        state.listApiUrl = opts.listApiUrl || "";
        state.scopedHomeDir = normalizePath(opts.scopedHomeDir || "");
        state.imageDriveDir = state.scopedHomeDir;

        surface = document.getElementById("handrive-video-editor-surface");
        videoEl = document.getElementById("ve-video");
        resetBtn = document.getElementById("ve-reset-btn");
        startInput = document.getElementById("ve-start-input");
        endInput = document.getElementById("ve-end-input");
        volumeButton = document.getElementById("ve-volume-btn");
        volumePopover = document.getElementById("ve-volume-popover");
        volumeInput = document.getElementById("ve-volume-input");
        volumeDisplay = document.getElementById("ve-volume-display");
        startRange = document.getElementById("ve-start-range");
        endRange = document.getElementById("ve-end-range");
        rangeSelection = document.getElementById("ve-range-selection");
        currentTimeEl = document.getElementById("ve-current-time");
        durationEl = document.getElementById("ve-duration");
        titleEl = document.getElementById("ve-title");
        videoStage = document.getElementById("ve-video-stage");
        subtitleLayer = document.getElementById("ve-subtitle-overlay-layer");
        inputSubtitleButton = document.getElementById("ve-input-subtitle-btn");
        inputImageButton = document.getElementById("ve-input-image-btn");
        subtitleField = document.getElementById("ve-subtitle-field");
        subtitleSelect = document.getElementById("ve-subtitle-select");
        subtitleAddButton = document.getElementById("ve-subtitle-add-btn");
        subtitleDeleteButton = document.getElementById("ve-subtitle-delete-btn");
        subtitleHideButton = document.getElementById("ve-subtitle-hide-btn");
        subtitleInput = document.getElementById("ve-subtitle-input");
        subtitleFontFamilySelect = document.getElementById("ve-subtitle-font-family");
        subtitleFontSizeInput = document.getElementById("ve-subtitle-font-size");
        subtitleBoldButton = document.getElementById("ve-subtitle-bold-btn");
        subtitleItalicButton = document.getElementById("ve-subtitle-italic-btn");
        subtitleUnderlineButton = document.getElementById("ve-subtitle-underline-btn");
        subtitleFontColor = document.getElementById("ve-subtitle-font-color");
        subtitleFontColorEnabled = document.getElementById("ve-subtitle-font-color-enabled");
        subtitleFontStrokeColor = document.getElementById("ve-subtitle-font-stroke-color");
        subtitleFontStrokeEnabled = document.getElementById("ve-subtitle-font-stroke-enabled");
        subtitleBgColor = document.getElementById("ve-subtitle-bg-color");
        subtitleBgEnabled = document.getElementById("ve-subtitle-bg-enabled");
        subtitleBorderColor = document.getElementById("ve-subtitle-border-color");
        subtitleBorderEnabled = document.getElementById("ve-subtitle-border-enabled");
        subtitleStartRange = document.getElementById("ve-subtitle-start-range");
        subtitleEndRange = document.getElementById("ve-subtitle-end-range");
        subtitleRangeSelection = document.getElementById("ve-subtitle-range-selection");
        subtitleStartTime = document.getElementById("ve-subtitle-start-time");
        subtitleEndTime = document.getElementById("ve-subtitle-end-time");
        imageField = document.getElementById("ve-image-field");
        imageSelect = document.getElementById("ve-image-select");
        imageAddButton = document.getElementById("ve-image-add-btn");
        imageDeleteButton = document.getElementById("ve-image-delete-btn");
        imageHideButton = document.getElementById("ve-image-hide-btn");
        imageStartRange = document.getElementById("ve-image-start-range");
        imageEndRange = document.getElementById("ve-image-end-range");
        imageRangeSelection = document.getElementById("ve-image-range-selection");
        imageStartTime = document.getElementById("ve-image-start-time");
        imageEndTime = document.getElementById("ve-image-end-time");
        imageUploadDialog = document.getElementById("ve-image-upload-dialog");
        imageUploadCloseButton = document.getElementById("ve-image-upload-close-btn");
        imageDropZone = document.getElementById("ve-image-drop-zone");
        imageFileInput = document.getElementById("ve-image-file-input");
        imageDriveButton = document.getElementById("ve-image-drive-btn");
        imageDrivePicker = document.getElementById("ve-image-drive-picker");
        imageDriveUpButton = document.getElementById("ve-image-drive-up-btn");
        imageDrivePathEl = document.getElementById("ve-image-drive-path");
        imageDriveList = document.getElementById("ve-image-drive-list");

        if (!videoEl) return;
        unbindEvents();
        resetControls();
        bindEvents();
        bindResizeObserver();
        if (titleEl) titleEl.textContent = state.entry && state.entry.name ? state.entry.name : "Video";
        setVideoSource(opts.videoServeUrl || "");
        scheduleVideoStageSizeSync();
    }

    function destroy() {
        unbindEvents();
        closeVolumePopover();
        if (videoEl) {
            var player = getVideoPlayer();
            if (player) {
                try {
                    player.pause();
                    player.reset();
                } catch (error) {}
            } else {
                videoEl.pause();
                videoEl.removeAttribute("src");
                videoEl.load();
            }
            videoEl.removeAttribute("src");
            delete videoEl.dataset.fallbackSrc;
            delete videoEl.dataset.fallbackType;
        }
        state.entry = null;
        state.onDirtyChange = null;
        state.isDirty = false;
        state.duration = 0;
        state.subtitles = [];
        state.selectedSubtitleId = "";
        state.images.forEach(function (image) {
            revokeImageObjectUrl(image);
        });
        state.images = [];
        state.selectedImageId = "";
        state.drag = null;
        state.appendFile = null;
        state.buildDownloadUrl = null;
        state.scopedHomeDir = "";
        if (videoStageSizeFrame) {
            cancelAnimationFrame(videoStageSizeFrame);
            videoStageSizeFrame = 0;
        }
        unbindResizeObserver();
    }

    function resetControls() {
        if (startInput) startInput.value = "0";
        if (endInput) endInput.value = "0";
        if (volumeInput) volumeInput.value = "1";
        showEditorField("");
        if (startRange) {
            startRange.value = "0";
            startRange.max = "0";
        }
        if (endRange) {
            endRange.value = "0";
            endRange.max = "0";
        }
        state.subtitles = [];
        state.selectedSubtitleId = "";
        state.nextSubtitleIndex = 1;
        state.images.forEach(function (image) {
            revokeImageObjectUrl(image);
        });
        state.images = [];
        state.selectedImageId = "";
        state.nextImageIndex = 1;
        state.appendFile = null;
        closeImageUploadDialog();
        syncVolumeDisplay();
        syncRangeSelection();
        syncTimeDisplays();
        renderSubtitleControls();
        renderImageControls();
        renderSubtitleOverlays();
        scheduleVideoStageSizeSync();
    }

    function bindEvents() {
        videoEl.addEventListener("loadedmetadata", onLoadedMetadata);
        videoEl.addEventListener("timeupdate", onTimeUpdate);
        if (resetBtn) resetBtn.addEventListener("click", onResetClick);
        if (startInput) startInput.addEventListener("input", onTimeInput);
        if (endInput) endInput.addEventListener("input", onTimeInput);
        if (volumeButton) volumeButton.addEventListener("click", onVolumeButtonClick);
        if (volumeInput) volumeInput.addEventListener("input", onVolumeInput);
        if (startRange) startRange.addEventListener("input", onStartRangeInput);
        if (endRange) endRange.addEventListener("input", onEndRangeInput);
        if (inputSubtitleButton) inputSubtitleButton.addEventListener("click", onInputSubtitleClick);
        if (inputImageButton) inputImageButton.addEventListener("click", onInputImageClick);
        if (subtitleSelect) subtitleSelect.addEventListener("change", onSubtitleSelectChange);
        if (subtitleAddButton) subtitleAddButton.addEventListener("click", onSubtitleAddClick);
        if (subtitleDeleteButton) subtitleDeleteButton.addEventListener("click", onSubtitleDeleteClick);
        if (subtitleHideButton) subtitleHideButton.addEventListener("click", onSubtitleHideClick);
        if (subtitleInput) subtitleInput.addEventListener("input", onSubtitleTextInput);
        if (subtitleFontFamilySelect) subtitleFontFamilySelect.addEventListener("change", onSubtitleStyleInput);
        if (subtitleFontSizeInput) subtitleFontSizeInput.addEventListener("input", onSubtitleStyleInput);
        if (subtitleBoldButton) subtitleBoldButton.addEventListener("click", onSubtitleStyleToggleClick);
        if (subtitleItalicButton) subtitleItalicButton.addEventListener("click", onSubtitleStyleToggleClick);
        if (subtitleUnderlineButton) subtitleUnderlineButton.addEventListener("click", onSubtitleStyleToggleClick);
        if (subtitleFontColor) subtitleFontColor.addEventListener("input", onSubtitleStyleInput);
        if (subtitleFontColorEnabled) subtitleFontColorEnabled.addEventListener("change", onSubtitleStyleInput);
        if (subtitleFontStrokeColor) subtitleFontStrokeColor.addEventListener("input", onSubtitleStyleInput);
        if (subtitleFontStrokeEnabled) subtitleFontStrokeEnabled.addEventListener("change", onSubtitleStyleInput);
        if (subtitleBgColor) subtitleBgColor.addEventListener("input", onSubtitleStyleInput);
        if (subtitleBgEnabled) subtitleBgEnabled.addEventListener("change", onSubtitleStyleInput);
        if (subtitleBorderColor) subtitleBorderColor.addEventListener("input", onSubtitleStyleInput);
        if (subtitleBorderEnabled) subtitleBorderEnabled.addEventListener("change", onSubtitleStyleInput);
        if (subtitleStartRange) subtitleStartRange.addEventListener("input", onSubtitleStartRangeInput);
        if (subtitleEndRange) subtitleEndRange.addEventListener("input", onSubtitleEndRangeInput);
        if (imageSelect) imageSelect.addEventListener("change", onImageSelectChange);
        if (imageAddButton) imageAddButton.addEventListener("click", openImageUploadDialog);
        if (imageDeleteButton) imageDeleteButton.addEventListener("click", onImageDeleteClick);
        if (imageHideButton) imageHideButton.addEventListener("click", onImageHideClick);
        if (imageStartRange) imageStartRange.addEventListener("input", onImageStartRangeInput);
        if (imageEndRange) imageEndRange.addEventListener("input", onImageEndRangeInput);
        if (imageUploadCloseButton) imageUploadCloseButton.addEventListener("click", closeImageUploadDialog);
        if (imageFileInput) imageFileInput.addEventListener("change", onImageFileInputChange);
        if (imageDriveButton) imageDriveButton.addEventListener("click", onImageDriveClick);
        if (imageDriveUpButton) imageDriveUpButton.addEventListener("click", onImageDriveUpClick);
        if (imageDropZone) {
            imageDropZone.addEventListener("dragover", onImageDialogDragOver);
            imageDropZone.addEventListener("drop", onImageDialogDrop);
        }
        if (subtitleLayer) subtitleLayer.addEventListener("pointerdown", onSubtitlePointerDown);
        if (surface) {
            surface.addEventListener("dragover", onEditorDragOver);
            surface.addEventListener("drop", onEditorDrop);
        }
        document.addEventListener("pointermove", onDocumentPointerMove);
        document.addEventListener("pointerup", onDocumentPointerUp);
        document.addEventListener("click", onDocumentClick);
        document.addEventListener("keydown", onDocumentKeydown);
        window.addEventListener("resize", scheduleVideoStageSizeSync);
    }

    function unbindEvents() {
        unbindVideoPlayerMetadataEvents();
        if (videoEl) {
            videoEl.removeEventListener("loadedmetadata", onLoadedMetadata);
            videoEl.removeEventListener("timeupdate", onTimeUpdate);
        }
        if (resetBtn) resetBtn.removeEventListener("click", onResetClick);
        if (startInput) startInput.removeEventListener("input", onTimeInput);
        if (endInput) endInput.removeEventListener("input", onTimeInput);
        if (volumeButton) volumeButton.removeEventListener("click", onVolumeButtonClick);
        if (volumeInput) volumeInput.removeEventListener("input", onVolumeInput);
        if (startRange) startRange.removeEventListener("input", onStartRangeInput);
        if (endRange) endRange.removeEventListener("input", onEndRangeInput);
        if (inputSubtitleButton) inputSubtitleButton.removeEventListener("click", onInputSubtitleClick);
        if (inputImageButton) inputImageButton.removeEventListener("click", onInputImageClick);
        if (subtitleSelect) subtitleSelect.removeEventListener("change", onSubtitleSelectChange);
        if (subtitleAddButton) subtitleAddButton.removeEventListener("click", onSubtitleAddClick);
        if (subtitleDeleteButton) subtitleDeleteButton.removeEventListener("click", onSubtitleDeleteClick);
        if (subtitleHideButton) subtitleHideButton.removeEventListener("click", onSubtitleHideClick);
        if (subtitleInput) subtitleInput.removeEventListener("input", onSubtitleTextInput);
        if (subtitleFontFamilySelect) subtitleFontFamilySelect.removeEventListener("change", onSubtitleStyleInput);
        if (subtitleFontSizeInput) subtitleFontSizeInput.removeEventListener("input", onSubtitleStyleInput);
        if (subtitleBoldButton) subtitleBoldButton.removeEventListener("click", onSubtitleStyleToggleClick);
        if (subtitleItalicButton) subtitleItalicButton.removeEventListener("click", onSubtitleStyleToggleClick);
        if (subtitleUnderlineButton) subtitleUnderlineButton.removeEventListener("click", onSubtitleStyleToggleClick);
        if (subtitleFontColor) subtitleFontColor.removeEventListener("input", onSubtitleStyleInput);
        if (subtitleFontColorEnabled) subtitleFontColorEnabled.removeEventListener("change", onSubtitleStyleInput);
        if (subtitleFontStrokeColor) subtitleFontStrokeColor.removeEventListener("input", onSubtitleStyleInput);
        if (subtitleFontStrokeEnabled) subtitleFontStrokeEnabled.removeEventListener("change", onSubtitleStyleInput);
        if (subtitleBgColor) subtitleBgColor.removeEventListener("input", onSubtitleStyleInput);
        if (subtitleBgEnabled) subtitleBgEnabled.removeEventListener("change", onSubtitleStyleInput);
        if (subtitleBorderColor) subtitleBorderColor.removeEventListener("input", onSubtitleStyleInput);
        if (subtitleBorderEnabled) subtitleBorderEnabled.removeEventListener("change", onSubtitleStyleInput);
        if (subtitleStartRange) subtitleStartRange.removeEventListener("input", onSubtitleStartRangeInput);
        if (subtitleEndRange) subtitleEndRange.removeEventListener("input", onSubtitleEndRangeInput);
        if (imageSelect) imageSelect.removeEventListener("change", onImageSelectChange);
        if (imageAddButton) imageAddButton.removeEventListener("click", openImageUploadDialog);
        if (imageDeleteButton) imageDeleteButton.removeEventListener("click", onImageDeleteClick);
        if (imageHideButton) imageHideButton.removeEventListener("click", onImageHideClick);
        if (imageStartRange) imageStartRange.removeEventListener("input", onImageStartRangeInput);
        if (imageEndRange) imageEndRange.removeEventListener("input", onImageEndRangeInput);
        if (imageUploadCloseButton) imageUploadCloseButton.removeEventListener("click", closeImageUploadDialog);
        if (imageFileInput) imageFileInput.removeEventListener("change", onImageFileInputChange);
        if (imageDriveButton) imageDriveButton.removeEventListener("click", onImageDriveClick);
        if (imageDriveUpButton) imageDriveUpButton.removeEventListener("click", onImageDriveUpClick);
        if (imageDropZone) {
            imageDropZone.removeEventListener("dragover", onImageDialogDragOver);
            imageDropZone.removeEventListener("drop", onImageDialogDrop);
        }
        if (subtitleLayer) subtitleLayer.removeEventListener("pointerdown", onSubtitlePointerDown);
        if (surface) {
            surface.removeEventListener("dragover", onEditorDragOver);
            surface.removeEventListener("drop", onEditorDrop);
        }
        document.removeEventListener("pointermove", onDocumentPointerMove);
        document.removeEventListener("pointerup", onDocumentPointerUp);
        document.removeEventListener("click", onDocumentClick);
        document.removeEventListener("keydown", onDocumentKeydown);
        window.removeEventListener("resize", scheduleVideoStageSizeSync);
    }

    function onLoadedMetadata() {
        state.duration = getMediaDuration();
        if (endInput) endInput.value = state.duration ? state.duration.toFixed(2) : "0";
        syncRangeInputs();
        syncSubtitleRangeInputs();
        syncImageRangeInputs();
        syncTimeDisplays();
        renderSubtitleOverlays();
        setDirty(false);
    }

    function onTimeUpdate() {
        var end = getEndTime();
        if (end && getMediaCurrentTime() >= end) {
            pauseMedia();
            setMediaCurrentTime(getStartTime());
        }
        syncTimeDisplays();
        renderSubtitleOverlays();
    }

    function onResetClick() {
        resetControls();
        if (endInput && state.duration) endInput.value = state.duration.toFixed(2);
        setMediaCurrentTime(0);
        syncRangeInputs();
        syncSubtitleRangeInputs();
        syncTimeDisplays();
        setDirty(false);
    }

    function onTimeInput() {
        clampTimeInputs();
        syncRangeInputs();
        playFromStart();
        setDirty(true);
    }

    function onStartRangeInput() {
        var start = Math.max(0, Number(startRange && startRange.value) || 0);
        var end = getEndTime();
        if (end && start > end) start = end;
        if (startInput) startInput.value = start.toFixed(2);
        clampTimeInputs();
        syncRangeInputs();
        playFromStart();
        setDirty(true);
    }

    function onEndRangeInput() {
        var start = getStartTime();
        var end = Math.max(0, Number(endRange && endRange.value) || 0);
        if (end < start) end = start;
        if (endInput) endInput.value = end.toFixed(2);
        clampTimeInputs();
        syncRangeInputs();
        playFromStart();
        setDirty(true);
    }

    function onVolumeInput() {
        var volume = Math.max(0, Math.min(1, Number(volumeInput && volumeInput.value) || 0));
        var player = getVideoPlayer();
        if (player) {
            player.volume(volume);
        } else if (videoEl) {
            videoEl.volume = volume;
        }
        syncVolumeDisplay();
        setDirty(true);
    }

    function onInputSubtitleClick(event) {
        if (event) event.stopPropagation();
        showEditorField("subtitle");
        if (state.subtitles.length === 0) {
            addSubtitle();
        }
    }

    function onInputImageClick(event) {
        if (event) event.stopPropagation();
        openImageUploadDialog();
    }

    function showEditorField(kind) {
        if (subtitleField) subtitleField.hidden = kind !== "subtitle";
        if (imageField) imageField.hidden = kind !== "image";
        scheduleVideoStageSizeSync();
    }

    function onSubtitleHideClick(event) {
        if (event) event.stopPropagation();
        showEditorField("");
    }

    function onImageHideClick(event) {
        if (event) event.stopPropagation();
        showEditorField("");
    }

    function onSubtitleSelectChange() {
        showEditorField("subtitle");
        state.selectedSubtitleId = subtitleSelect ? subtitleSelect.value : "";
        renderSubtitleControls();
        renderSubtitleOverlays();
    }

    function onSubtitleAddClick() {
        showEditorField("subtitle");
        addSubtitle();
        setDirty(true);
    }

    function onSubtitleDeleteClick() {
        var selected = getSelectedSubtitle();
        if (!selected) return;
        state.subtitles = state.subtitles.filter(function (subtitle) {
            return subtitle.id !== selected.id;
        });
        state.selectedSubtitleId = state.subtitles.length ? state.subtitles[0].id : "";
        renderSubtitleControls();
        renderSubtitleOverlays();
        setDirty(true);
    }

    function onSubtitleTextInput() {
        updateSelectedSubtitle({ text: String(subtitleInput && subtitleInput.value || "") });
    }

    function onSubtitleStyleInput() {
        updateSelectedSubtitle({
            fontFamily: subtitleFontFamilySelect ? subtitleFontFamilySelect.value : "system",
            fontSize: clamp(Number(subtitleFontSizeInput && subtitleFontSizeInput.value) || 28, 8, 160),
            fontBold: subtitleBoldButton ? subtitleBoldButton.getAttribute("aria-pressed") === "true" : false,
            fontItalic: subtitleItalicButton ? subtitleItalicButton.getAttribute("aria-pressed") === "true" : false,
            fontUnderline: subtitleUnderlineButton ? subtitleUnderlineButton.getAttribute("aria-pressed") === "true" : false,
            fontColorEnabled: subtitleFontColorEnabled ? subtitleFontColorEnabled.checked : true,
            fontColor: subtitleFontColor ? subtitleFontColor.value : "#ffffff",
            fontStrokeEnabled: subtitleFontStrokeEnabled ? subtitleFontStrokeEnabled.checked : true,
            fontStrokeColor: subtitleFontStrokeColor ? subtitleFontStrokeColor.value : "#000000",
            bgEnabled: subtitleBgEnabled ? subtitleBgEnabled.checked : true,
            bgColor: subtitleBgColor ? subtitleBgColor.value : "#000000",
            borderEnabled: subtitleBorderEnabled ? subtitleBorderEnabled.checked : true,
            borderColor: subtitleBorderColor ? subtitleBorderColor.value : "#000000",
        });
    }

    function onSubtitleStyleToggleClick(event) {
        var button = event && event.currentTarget;
        if (!button) return;
        button.setAttribute("aria-pressed", button.getAttribute("aria-pressed") === "true" ? "false" : "true");
        onSubtitleStyleInput();
    }

    function onSubtitleStartRangeInput() {
        var selected = getSelectedSubtitle();
        if (!selected) return;
        var start = Math.max(0, Number(subtitleStartRange && subtitleStartRange.value) || 0);
        var end = Number(selected.end) || state.duration || 0;
        if (start > end) start = end;
        selected.start = start;
        syncSubtitleRangeInputs();
        setMediaCurrentTime(start);
        renderSubtitleOverlays();
        playMedia();
        setDirty(true);
    }

    function onSubtitleEndRangeInput() {
        var selected = getSelectedSubtitle();
        if (!selected) return;
        var start = Number(selected.start) || 0;
        var end = Math.max(0, Number(subtitleEndRange && subtitleEndRange.value) || 0);
        if (end < start) end = start;
        selected.end = end;
        syncSubtitleRangeInputs();
        setMediaCurrentTime(start);
        renderSubtitleOverlays();
        playMedia();
        setDirty(true);
    }

    function onImageSelectChange() {
        showEditorField("image");
        state.selectedImageId = imageSelect ? imageSelect.value : "";
        renderImageControls();
        renderSubtitleOverlays();
    }

    function onImageDeleteClick() {
        var selected = getSelectedImage();
        if (!selected) return;
        revokeImageObjectUrl(selected);
        state.images = state.images.filter(function (image) {
            return image.id !== selected.id;
        });
        state.selectedImageId = state.images.length ? state.images[0].id : "";
        renderImageControls();
        renderSubtitleOverlays();
        setDirty(true);
    }

    function onImageStartRangeInput() {
        var selected = getSelectedImage();
        if (!selected) return;
        var start = Math.max(0, Number(imageStartRange && imageStartRange.value) || 0);
        var end = Number(selected.end) || state.duration || 0;
        if (start > end) start = end;
        selected.start = start;
        syncImageRangeInputs();
        setMediaCurrentTime(start);
        renderSubtitleOverlays();
        playMedia();
        setDirty(true);
    }

    function onImageEndRangeInput() {
        var selected = getSelectedImage();
        if (!selected) return;
        var start = Number(selected.start) || 0;
        var end = Math.max(0, Number(imageEndRange && imageEndRange.value) || 0);
        if (end < start) end = start;
        selected.end = end;
        syncImageRangeInputs();
        setMediaCurrentTime(start);
        renderSubtitleOverlays();
        playMedia();
        setDirty(true);
    }

    function openImageUploadDialog() {
        showEditorField("image");
        if (imageUploadDialog) imageUploadDialog.hidden = false;
    }

    function closeImageUploadDialog() {
        if (imageUploadDialog) imageUploadDialog.hidden = true;
        if (imageDrivePicker) imageDrivePicker.hidden = true;
        if (imageFileInput) imageFileInput.value = "";
    }

    function onImageFileInputChange() {
        var file = imageFileInput && imageFileInput.files && imageFileInput.files[0] ? imageFileInput.files[0] : null;
        if (file) addImageOverlayFromFile(file);
    }

    function onImageDialogDragOver(event) {
        if (!event || !event.dataTransfer || !canAcceptImageTransfer(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
    }

    function onImageDialogDrop(event) {
        if (!event || !event.dataTransfer) return;
        var payload = getImagePayloadFromTransfer(event.dataTransfer);
        if (!payload) return;
        event.preventDefault();
        if (payload.file) addImageOverlayFromFile(payload.file);
        if (payload.path) addImageOverlayFromDrivePath(payload.path);
    }

    function onImageDriveClick() {
        if (!imageDrivePicker) return;
        imageDrivePicker.hidden = false;
        loadImageDriveDirectory(state.imageDriveDir || state.scopedHomeDir || "");
    }

    function onImageDriveUpClick() {
        state.imageDriveDir = getScopedParentPath(state.imageDriveDir || state.scopedHomeDir || "");
        loadImageDriveDirectory(state.imageDriveDir);
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
                return isVideoPath(candidate && candidate.name || "");
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
            return value && isVideoPath(value);
        });
        return path ? { path: path } : null;
    }

    function canAcceptAppendTransfer(dataTransfer) {
        if (getAppendPayloadFromTransfer(dataTransfer)) return true;
        if (!dataTransfer.items || dataTransfer.items.length === 0) return false;
        return Array.from(dataTransfer.items).some(function (item) {
            if (!item || item.kind !== "file") return false;
            return String(item.type || "").toLowerCase().indexOf("video/") === 0;
        });
    }

    function canAcceptImageTransfer(dataTransfer) {
        if (getImagePayloadFromTransfer(dataTransfer)) return true;
        if (!dataTransfer.items || dataTransfer.items.length === 0) return false;
        return Array.from(dataTransfer.items).some(function (item) {
            return item && item.kind === "file" && String(item.type || "").toLowerCase().indexOf("image/") === 0;
        });
    }

    function getImagePayloadFromTransfer(dataTransfer) {
        if (dataTransfer.files && dataTransfer.files.length > 0) {
            var file = Array.from(dataTransfer.files).find(function (candidate) {
                return isImagePath(candidate && candidate.name || "");
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
            return value && isImagePath(value);
        });
        return path ? { path: path } : null;
    }

    function setAppendFile(file) {
        state.appendFile = file || null;
        setDirty(Boolean(state.appendFile) || getHasEditChanges());
    }

    function appendDrivePath(path) {
        if (!path || !state.buildDownloadUrl || !isVideoPath(path) || !isPathInPickerScope(path)) return;
        var url = state.buildDownloadUrl(path);
        if (!url) return;
        fetch(url, { credentials: "same-origin" })
            .then(function (response) {
                if (!response.ok) throw new Error("download failed");
                return response.blob();
            })
            .then(function (blob) {
                var fileName = path.split("/").pop() || "append-video";
                setAppendFile(new File([blob], fileName, { type: blob.type || "video/*" }));
            })
            .catch(function () {});
    }

    function onSubtitlePointerDown(event) {
        var imageBox = event.target && event.target.closest ? event.target.closest(".ve-image-box") : null;
        if (imageBox) {
            onImagePointerDown(event, imageBox);
            return;
        }
        var box = event.target && event.target.closest ? event.target.closest(".ve-subtitle-box") : null;
        if (!box || !subtitleLayer) return;
        var subtitle = getSubtitleById(box.dataset.subtitleId || "");
        if (!subtitle) return;
        event.preventDefault();
        showEditorField("subtitle");
        state.selectedSubtitleId = subtitle.id;
        renderSubtitleControls();
        renderSubtitleOverlays();

        state.drag = {
            type: "subtitle",
            id: subtitle.id,
            startX: event.clientX,
            startY: event.clientY,
            rect: subtitleLayer.getBoundingClientRect(),
            initial: {
                x: subtitle.x,
                y: subtitle.y,
                width: getSubtitleWidth(subtitle),
                height: getSubtitleHeight(subtitle),
            },
        };
        try {
            box.setPointerCapture(event.pointerId);
        } catch (error) {}
    }

    function onDocumentPointerMove(event) {
        if (!state.drag) return;
        if (state.drag.type === "image") {
            moveImageDrag(event);
            return;
        }
        var subtitle = getSubtitleById(state.drag.id);
        if (!subtitle) return;
        var dx = ((event.clientX - state.drag.startX) / Math.max(1, state.drag.rect.width)) * 100;
        var dy = ((event.clientY - state.drag.startY) / Math.max(1, state.drag.rect.height)) * 100;
        subtitle.x = clamp(state.drag.initial.x + dx, 0, 100 - state.drag.initial.width);
        subtitle.y = clamp(state.drag.initial.y + dy, 0, 100 - state.drag.initial.height);
        renderSubtitleOverlays();
        setDirty(true);
    }

    function onImagePointerDown(event, box) {
        if (!subtitleLayer) return;
        var image = getImageById(box.dataset.imageId || "");
        if (!image) return;
        event.preventDefault();
        showEditorField("image");
        state.selectedImageId = image.id;
        renderImageControls();
        renderSubtitleOverlays();
        var mode = event.target && event.target.classList && event.target.classList.contains("ve-image-resize-handle") ? "resize" : "move";
        state.drag = {
            type: "image",
            mode: mode,
            id: image.id,
            startX: event.clientX,
            startY: event.clientY,
            rect: subtitleLayer.getBoundingClientRect(),
            initial: {
                x: image.x,
                y: image.y,
                width: image.width,
                height: image.height,
            },
        };
        try {
            box.setPointerCapture(event.pointerId);
        } catch (error) {}
    }

    function moveImageDrag(event) {
        var image = getImageById(state.drag.id);
        if (!image) return;
        var dx = ((event.clientX - state.drag.startX) / Math.max(1, state.drag.rect.width)) * 100;
        var dy = ((event.clientY - state.drag.startY) / Math.max(1, state.drag.rect.height)) * 100;
        if (state.drag.mode === "resize") {
            image.width = clamp(state.drag.initial.width + dx, 4, 100);
            image.height = clamp(state.drag.initial.height + dy, 4, 100);
        } else {
            image.x = clamp(state.drag.initial.x + dx, 0, 100 - state.drag.initial.width);
            image.y = clamp(state.drag.initial.y + dy, 0, 100 - state.drag.initial.height);
        }
        renderSubtitleOverlays();
        setDirty(true);
    }

    function onDocumentPointerUp() {
        state.drag = null;
    }

    function onVolumeButtonClick(event) {
        if (event) event.stopPropagation();
        if (!volumePopover) return;
        volumePopover.hidden ? openVolumePopover() : closeVolumePopover();
    }

    function onDocumentClick(event) {
        var target = event && event.target;
        if (volumePopover && !volumePopover.hidden && !(target && target.closest && target.closest("#ve-volume-control"))) {
            closeVolumePopover();
        }
    }

    function onDocumentKeydown(event) {
        if (event && event.key === "Escape") closeVolumePopover();
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

    function bindResizeObserver() {
        unbindResizeObserver();
        if (typeof ResizeObserver === "undefined") {
            return;
        }
        var target = videoStage && videoStage.parentElement ? videoStage.parentElement : videoStage;
        if (!target) {
            return;
        }
        videoStageResizeObserver = new ResizeObserver(function () {
            scheduleVideoStageSizeSync();
        });
        videoStageResizeObserver.observe(target);
    }

    function unbindResizeObserver() {
        if (videoStageResizeObserver) {
            videoStageResizeObserver.disconnect();
            videoStageResizeObserver = null;
        }
    }

    function scheduleVideoStageSizeSync() {
        if (videoStageSizeFrame) cancelAnimationFrame(videoStageSizeFrame);
        videoStageSizeFrame = requestAnimationFrame(function () {
            videoStageSizeFrame = 0;
            syncVideoStageSize();
        });
    }

    function syncVideoStageSize() {
        if (!videoStage || !videoStage.parentElement) return;
        var body = videoStage.parentElement;
        var bodyStyle = window.getComputedStyle(body);
        var gap = parseFloat(bodyStyle.rowGap || bodyStyle.gap) || 0;
        var paddingY = (parseFloat(bodyStyle.paddingTop) || 0) + (parseFloat(bodyStyle.paddingBottom) || 0);
        var visibleChildren = Array.from(body.children).filter(function (child) {
            return child && !child.hidden && window.getComputedStyle(child).display !== "none";
        });
        var occupiedHeight = visibleChildren.reduce(function (sum, child) {
            return child === videoStage ? sum : sum + child.offsetHeight;
        }, 0);
        var gapHeight = Math.max(0, visibleChildren.length - 1) * gap;
        var bodyHeight = Math.max(0, body.clientHeight - paddingY);
        var bodyWidth = Math.max(0, body.clientWidth - (parseFloat(bodyStyle.paddingLeft) || 0) - (parseFloat(bodyStyle.paddingRight) || 0));
        var targetWidth = bodyWidth;
        videoStage.style.setProperty("--ve-stage-width", targetWidth + "px");
        renderSubtitleOverlays();
    }

    function addSubtitle() {
        var end = state.duration ? Math.min(state.duration, getStartTime() + 5) : 5;
        var subtitle = {
            id: "subtitle-" + Date.now() + "-" + state.nextSubtitleIndex,
            label: "자막 " + state.nextSubtitleIndex,
            text: "",
            start: getStartTime(),
            end: end,
            x: 20,
            y: 72,
            width: 60,
            height: 16,
            fontFamily: "system",
            fontSize: 28,
            fontBold: false,
            fontItalic: false,
            fontUnderline: false,
            fontColorEnabled: true,
            fontColor: "#ffffff",
            fontStrokeEnabled: true,
            fontStrokeColor: "#000000",
            bgEnabled: true,
            bgColor: "#000000",
            borderEnabled: true,
            borderColor: "#000000",
        };
        state.nextSubtitleIndex += 1;
        state.subtitles.push(subtitle);
        state.selectedSubtitleId = subtitle.id;
        renderSubtitleControls();
        renderSubtitleOverlays();
        return subtitle;
    }

    function addImageOverlayFromFile(file) {
        if (!file || !isImagePath(file.name || "")) return;
        var objectUrl = URL.createObjectURL(file);
        var end = state.duration ? Math.min(state.duration, getStartTime() + 5) : 5;
        var image = {
            id: "image-" + Date.now() + "-" + state.nextImageIndex,
            label: file.name || ("이미지 " + state.nextImageIndex),
            file: file,
            objectUrl: objectUrl,
            start: getStartTime(),
            end: end,
            x: 20,
            y: 20,
            width: 24,
            height: 24,
        };
        state.nextImageIndex += 1;
        state.images.push(image);
        state.selectedImageId = image.id;
        showEditorField("image");
        closeImageUploadDialog();
        renderImageControls();
        renderSubtitleOverlays();
        setDirty(true);
    }

    function addImageOverlayFromDrivePath(path) {
        if (!path || !state.buildDownloadUrl || !isImagePath(path) || !isPathInPickerScope(path)) return;
        fetch(state.buildDownloadUrl(path), { credentials: "same-origin" })
            .then(function (response) {
                if (!response.ok) throw new Error("download failed");
                return response.blob();
            })
            .then(function (blob) {
                var fileName = path.split("/").pop() || "overlay-image";
                addImageOverlayFromFile(new File([blob], fileName, { type: blob.type || "image/*" }));
            })
            .catch(function () {});
    }

    function revokeImageObjectUrl(image) {
        if (image && image.objectUrl) {
            try {
                URL.revokeObjectURL(image.objectUrl);
            } catch (error) {}
            image.objectUrl = "";
        }
    }

    function updateSelectedSubtitle(values) {
        var selected = getSelectedSubtitle();
        if (!selected) return;
        Object.keys(values || {}).forEach(function (key) {
            selected[key] = values[key];
        });
        renderSubtitleControls({ keepFocus: true });
        renderSubtitleOverlays();
        setDirty(true);
    }

    function renderSubtitleControls(options) {
        var settings = options || {};
        var selected = getSelectedSubtitle();
        if (subtitleSelect) {
            var currentValue = subtitleSelect.value;
            subtitleSelect.innerHTML = "";
            state.subtitles.forEach(function (subtitle, index) {
                var option = document.createElement("option");
                option.value = subtitle.id;
                option.textContent = subtitle.label || ("자막 " + (index + 1));
                subtitleSelect.appendChild(option);
            });
            subtitleSelect.value = selected ? selected.id : currentValue;
        }
        if (subtitleInput && document.activeElement !== subtitleInput) subtitleInput.value = selected ? selected.text || "" : "";
        if (subtitleFontFamilySelect) subtitleFontFamilySelect.value = selected ? selected.fontFamily || "system" : "system";
        if (subtitleFontSizeInput && document.activeElement !== subtitleFontSizeInput) subtitleFontSizeInput.value = selected ? String(selected.fontSize || 28) : "28";
        if (subtitleBoldButton) subtitleBoldButton.setAttribute("aria-pressed", selected && selected.fontBold ? "true" : "false");
        if (subtitleItalicButton) subtitleItalicButton.setAttribute("aria-pressed", selected && selected.fontItalic ? "true" : "false");
        if (subtitleUnderlineButton) subtitleUnderlineButton.setAttribute("aria-pressed", selected && selected.fontUnderline ? "true" : "false");
        if (subtitleFontColorEnabled) subtitleFontColorEnabled.checked = selected ? selected.fontColorEnabled !== false : true;
        if (subtitleFontColor) subtitleFontColor.value = selected ? selected.fontColor || "#ffffff" : "#ffffff";
        if (subtitleFontStrokeEnabled) subtitleFontStrokeEnabled.checked = selected ? selected.fontStrokeEnabled !== false : true;
        if (subtitleFontStrokeColor) subtitleFontStrokeColor.value = selected ? selected.fontStrokeColor || "#000000" : "#000000";
        if (subtitleBgEnabled) subtitleBgEnabled.checked = selected ? selected.bgEnabled !== false : true;
        if (subtitleBgColor) subtitleBgColor.value = selected ? selected.bgColor || "#000000" : "#000000";
        if (subtitleBorderEnabled) subtitleBorderEnabled.checked = selected ? selected.borderEnabled !== false : true;
        if (subtitleBorderColor) subtitleBorderColor.value = selected ? selected.borderColor || "#000000" : "#000000";
        if (subtitleDeleteButton) subtitleDeleteButton.disabled = !selected;
        syncSubtitleRangeInputs();
        if (!settings.keepFocus && subtitleInput && selected && !selected.text) {
            subtitleInput.focus({ preventScroll: true });
        }
        scheduleVideoStageSizeSync();
    }

    function renderImageControls() {
        var selected = getSelectedImage();
        if (imageSelect) {
            imageSelect.innerHTML = "";
            state.images.forEach(function (image, index) {
                var option = document.createElement("option");
                option.value = image.id;
                option.textContent = image.label || ("이미지 " + (index + 1));
                imageSelect.appendChild(option);
            });
            imageSelect.value = selected ? selected.id : "";
        }
        if (imageDeleteButton) imageDeleteButton.disabled = !selected;
        syncImageRangeInputs();
        scheduleVideoStageSizeSync();
    }

    function renderSubtitleOverlays() {
        if (!subtitleLayer) return;
        subtitleLayer.innerHTML = "";
        var currentTime = getMediaCurrentTime();
        var layerRect = subtitleLayer.getBoundingClientRect();
        state.subtitles.forEach(function (subtitle) {
            if (!isSubtitleActive(subtitle, currentTime)) {
                return;
            }
            var box = document.createElement("div");
            box.className = "ve-subtitle-box" + (subtitle.id === state.selectedSubtitleId ? " is-selected" : "");
            box.dataset.subtitleId = subtitle.id;
            box.textContent = subtitle.text || subtitle.label || "자막";
            var fontSize = getSubtitleFontSize(subtitle, layerRect);
            var size = estimateSubtitleBoxPercent(subtitle, layerRect, fontSize);
            subtitle.renderedWidth = size.width;
            subtitle.renderedHeight = size.height;
            box.style.left = clamp(subtitle.x, 0, 100 - size.width) + "%";
            box.style.top = clamp(subtitle.y, 0, 100 - size.height) + "%";
            box.style.width = "auto";
            box.style.height = "auto";
            box.style.fontFamily = getSubtitleFontFamilyCss(subtitle.fontFamily);
            box.style.fontSize = fontSize + "px";
            box.style.fontWeight = subtitle.fontBold ? "700" : "400";
            box.style.fontStyle = subtitle.fontItalic ? "italic" : "normal";
            box.style.textDecoration = subtitle.fontUnderline ? "underline" : "none";
            box.style.setProperty("--ve-subtitle-padding-y", Math.max(2, Math.round(fontSize * 0.28)) + "px");
            box.style.setProperty("--ve-subtitle-padding-x", Math.max(4, Math.round(fontSize * 0.42)) + "px");
            box.style.color = subtitle.fontColorEnabled === false ? "#ffffff" : subtitle.fontColor || "#ffffff";
            box.style.textShadow = subtitle.fontStrokeEnabled === false
                ? "none"
                : getTextStrokeShadow(subtitle.fontStrokeColor || "#000000");
            box.style.backgroundColor = subtitle.bgEnabled === false
                ? "transparent"
                : hexToRgba(subtitle.bgColor || "#000000", 0.62);
            box.style.borderColor = subtitle.borderEnabled === false
                ? "transparent"
                : subtitle.borderColor || "#000000";
            subtitleLayer.appendChild(box);
        });
        state.images.forEach(function (image) {
            if (!isImageActive(image, currentTime)) return;
            var box = document.createElement("div");
            box.className = "ve-image-box" + (image.id === state.selectedImageId ? " is-selected" : "");
            box.dataset.imageId = image.id;
            box.style.left = clamp(image.x, 0, 100 - image.width) + "%";
            box.style.top = clamp(image.y, 0, 100 - image.height) + "%";
            box.style.width = clamp(image.width, 4, 100) + "%";
            box.style.height = clamp(image.height, 4, 100) + "%";
            var img = document.createElement("img");
            img.src = image.objectUrl;
            img.alt = image.label || "image";
            box.appendChild(img);
            if (image.id === state.selectedImageId) {
                var handle = document.createElement("span");
                handle.className = "ve-image-resize-handle";
                box.appendChild(handle);
            }
            subtitleLayer.appendChild(box);
        });
    }

    function isSubtitleActive(subtitle, currentTime) {
        var start = Number(subtitle.start) || 0;
        var end = Number(subtitle.end) || 0;
        return end > start && currentTime >= start && currentTime <= end;
    }

    function isImageActive(image, currentTime) {
        var start = Number(image.start) || 0;
        var end = Number(image.end) || 0;
        return end > start && currentTime >= start && currentTime <= end;
    }

    function getSubtitleFontSize(subtitle, layerRect) {
        return Math.round(clamp(Number(subtitle.fontSize) || 28, 8, 160));
    }

    function estimateSubtitleBoxPercent(subtitle, layerRect, fontSize) {
        var layerWidth = Math.max(1, Number(layerRect && layerRect.width) || 860);
        var layerHeight = Math.max(1, Number(layerRect && layerRect.height) || 484);
        var text = String(subtitle.text || subtitle.label || "자막");
        var lines = text.split(/\r?\n/);
        var longest = lines.reduce(function (max, line) {
            return Math.max(max, line.length || 1);
        }, 1);
        var paddingX = Math.max(4, Math.round(fontSize * 0.42));
        var paddingY = Math.max(2, Math.round(fontSize * 0.28));
        var widthPx = Math.min(layerWidth - 8, Math.max(fontSize * 1.6, longest * fontSize * 0.62 + paddingX * 2 + 4));
        var heightPx = Math.max(fontSize * 1.25 + paddingY * 2 + 4, lines.length * fontSize * 1.25 + paddingY * 2 + 4);
        return {
            width: clamp((widthPx / layerWidth) * 100, 1, 100),
            height: clamp((heightPx / layerHeight) * 100, 1, 100),
        };
    }

    function getSubtitleWidth(subtitle) {
        return clamp(Number(subtitle.renderedWidth) || Number(subtitle.width) || 12, 1, 100);
    }

    function getSubtitleHeight(subtitle) {
        return clamp(Number(subtitle.renderedHeight) || Number(subtitle.height) || 8, 1, 100);
    }

    function getTextStrokeShadow(color) {
        return "-1px -1px 0 " + color + ", 1px -1px 0 " + color + ", -1px 1px 0 " + color + ", 1px 1px 0 " + color;
    }

    function getSubtitleFontFamilyCss(fontFamily) {
        var value = String(fontFamily || "system");
        if (value === "system") {
            return '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        }
        if (["sans-serif", "serif", "monospace", "cursive", "fantasy"].indexOf(value) >= 0) {
            return value;
        }
        return '"' + value.replace(/"/g, "") + '", sans-serif';
    }

    function playFromStart() {
        setMediaCurrentTime(getStartTime());
        renderSubtitleOverlays();
        playMedia();
        syncTimeDisplays();
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
        var max = state.duration ? state.duration.toFixed(2) : "0";
        if (startRange) {
            startRange.max = max;
            startRange.value = getStartTime().toFixed(2);
        }
        if (endRange) {
            endRange.max = max;
            endRange.value = getEndTime().toFixed(2);
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

    function syncSubtitleRangeInputs() {
        var selected = getSelectedSubtitle();
        var max = state.duration ? state.duration.toFixed(2) : "0";
        if (subtitleStartRange) subtitleStartRange.max = max;
        if (subtitleEndRange) subtitleEndRange.max = max;
        if (selected) {
            if (subtitleStartRange) subtitleStartRange.value = (Number(selected.start) || 0).toFixed(2);
            if (subtitleEndRange) subtitleEndRange.value = (Number(selected.end) || 0).toFixed(2);
        } else {
            if (subtitleStartRange) subtitleStartRange.value = "0";
            if (subtitleEndRange) subtitleEndRange.value = "0";
        }
        syncSubtitleRangeSelection();
    }

    function syncSubtitleRangeSelection() {
        var selected = getSelectedSubtitle();
        if (!subtitleRangeSelection || !state.duration || !selected) {
            if (subtitleRangeSelection) {
                subtitleRangeSelection.style.left = "0%";
                subtitleRangeSelection.style.width = "0%";
            }
            if (subtitleStartTime) subtitleStartTime.textContent = "0:00.00";
            if (subtitleEndTime) subtitleEndTime.textContent = "0:00.00";
            return;
        }
        var startPercent = Math.max(0, Math.min(100, ((Number(selected.start) || 0) / state.duration) * 100));
        var endPercent = Math.max(startPercent, Math.min(100, ((Number(selected.end) || 0) / state.duration) * 100));
        subtitleRangeSelection.style.left = startPercent + "%";
        subtitleRangeSelection.style.width = (endPercent - startPercent) + "%";
        if (subtitleStartTime) subtitleStartTime.textContent = formatTime(selected.start);
        if (subtitleEndTime) subtitleEndTime.textContent = formatTime(selected.end);
    }

    function syncImageRangeInputs() {
        var selected = getSelectedImage();
        var max = state.duration ? state.duration.toFixed(2) : "0";
        if (imageStartRange) imageStartRange.max = max;
        if (imageEndRange) imageEndRange.max = max;
        if (selected) {
            if (imageStartRange) imageStartRange.value = (Number(selected.start) || 0).toFixed(2);
            if (imageEndRange) imageEndRange.value = (Number(selected.end) || 0).toFixed(2);
        } else {
            if (imageStartRange) imageStartRange.value = "0";
            if (imageEndRange) imageEndRange.value = "0";
        }
        syncImageRangeSelection();
    }

    function syncImageRangeSelection() {
        var selected = getSelectedImage();
        if (!imageRangeSelection || !state.duration || !selected) {
            if (imageRangeSelection) {
                imageRangeSelection.style.left = "0%";
                imageRangeSelection.style.width = "0%";
            }
            if (imageStartTime) imageStartTime.textContent = "0:00.00";
            if (imageEndTime) imageEndTime.textContent = "0:00.00";
            return;
        }
        var startPercent = Math.max(0, Math.min(100, ((Number(selected.start) || 0) / state.duration) * 100));
        var endPercent = Math.max(startPercent, Math.min(100, ((Number(selected.end) || 0) / state.duration) * 100));
        imageRangeSelection.style.left = startPercent + "%";
        imageRangeSelection.style.width = (endPercent - startPercent) + "%";
        if (imageStartTime) imageStartTime.textContent = formatTime(selected.start);
        if (imageEndTime) imageEndTime.textContent = formatTime(selected.end);
    }

    function syncVolumeDisplay() {
        if (!volumeDisplay || !volumeInput) return;
        volumeDisplay.textContent = Math.round((Number(volumeInput.value) || 0) * 100) + "%";
    }

    function syncTimeDisplays() {
        if (currentTimeEl) currentTimeEl.textContent = formatTime(getStartTime());
        if (durationEl) durationEl.textContent = formatTime(getEndTime());
    }

    function getStartTime() {
        return Math.max(0, Number(startInput && startInput.value) || 0);
    }

    function getEndTime() {
        var end = Math.max(0, Number(endInput && endInput.value) || 0);
        return end || state.duration || 0;
    }

    function formatTime(seconds) {
        var total = Math.max(0, Number(seconds) || 0);
        var minutes = Math.floor(total / 60);
        var rest = total - minutes * 60;
        return minutes + ":" + (rest < 10 ? "0" : "") + rest.toFixed(2);
    }

    function setVideoSource(src) {
        if (!videoEl) return;
        var mimeType = getVideoMimeType(state.entry && state.entry.name ? state.entry.name : "");
        videoEl.dataset.fallbackSrc = src || "";
        videoEl.dataset.fallbackType = mimeType;
        if (window.HandriveVideoPlayer && typeof window.HandriveVideoPlayer.init === "function") {
            window.HandriveVideoPlayer.init(videoEl);
        }
        var player = getVideoPlayer();
        if (player) {
            bindVideoPlayerMetadataEvents(player);
            player.src({ src: src || "", type: mimeType });
            player.load();
            player.ready(function () {
                syncDurationFromMedia();
            });
            return;
        }
        videoEl.src = src || "";
        videoEl.load();
        syncDurationFromMedia();
    }

    function bindVideoPlayerMetadataEvents(player) {
        if (!player) return;
        player.off("loadedmetadata", onLoadedMetadata);
        player.off("durationchange", onLoadedMetadata);
        player.on("loadedmetadata", onLoadedMetadata);
        player.on("durationchange", onLoadedMetadata);
    }

    function unbindVideoPlayerMetadataEvents() {
        var player = getVideoPlayer();
        if (!player) return;
        player.off("loadedmetadata", onLoadedMetadata);
        player.off("durationchange", onLoadedMetadata);
    }

    function getVideoPlayer() {
        if (!videoEl || typeof videojs === "undefined" || typeof videojs.getPlayer !== "function") {
            return null;
        }
        return videojs.getPlayer(videoEl) || null;
    }

    function getMediaCurrentTime() {
        var player = getVideoPlayer();
        if (player) return Number(player.currentTime()) || 0;
        return Number(videoEl && videoEl.currentTime) || 0;
    }

    function getMediaDuration() {
        var player = getVideoPlayer();
        var duration = player ? Number(player.duration()) : Number(videoEl && videoEl.duration);
        return Number.isFinite(duration) && duration > 0 ? duration : 0;
    }

    function syncDurationFromMedia() {
        var duration = getMediaDuration();
        if (!duration) return;
        state.duration = duration;
        if (endInput) endInput.value = duration.toFixed(2);
        syncRangeInputs();
        syncSubtitleRangeInputs();
        syncImageRangeInputs();
        syncTimeDisplays();
        renderSubtitleOverlays();
    }

    function setMediaCurrentTime(value) {
        var time = Math.max(0, Number(value) || 0);
        var player = getVideoPlayer();
        try {
            if (player) {
                player.currentTime(time);
            } else if (videoEl) {
                videoEl.currentTime = time;
            }
        } catch (error) {}
    }

    function playMedia() {
        var player = getVideoPlayer();
        if (player) {
            try {
                player.play();
            } catch (error) {}
            return;
        }
        if (videoEl) videoEl.play().catch(function () {});
    }

    function pauseMedia() {
        var player = getVideoPlayer();
        if (player) {
            player.pause();
        } else if (videoEl) {
            videoEl.pause();
        }
    }

    function getVideoMimeType(filename) {
        var extension = String(filename || "").toLowerCase().split(".").pop();
        if (extension === "webm") return "video/webm";
        if (extension === "ogv" || extension === "ogg") return "video/ogg";
        if (extension === "mov") return "video/quicktime";
        if (extension === "m4v") return "video/x-m4v";
        return "video/mp4";
    }

    function getSelectedSubtitle() {
        return getSubtitleById(state.selectedSubtitleId);
    }

    function getSelectedImage() {
        return getImageById(state.selectedImageId);
    }

    function getSubtitleById(id) {
        return state.subtitles.find(function (subtitle) {
            return subtitle.id === id;
        }) || null;
    }

    function getImageById(id) {
        return state.images.find(function (image) {
            return image.id === id;
        }) || null;
    }

    function getHasEditChanges() {
        var start = Number(startInput && startInput.value) || 0;
        var end = Number(endInput && endInput.value) || 0;
        var volume = Number(volumeInput && volumeInput.value) || 1;
        return Math.abs(start) > 0.001 ||
            (state.duration && Math.abs(end - state.duration) > 0.01) ||
            Math.abs(volume - 1) > 0.001 ||
            Boolean(state.appendFile) ||
            state.images.length > 0 ||
            getSerializableSubtitles().length > 0;
    }

    function getSerializableImages() {
        return state.images
            .map(function (image, index) {
                return {
                    index: index,
                    label: image.label || ("image-" + index),
                    start: Number(image.start) || 0,
                    end: Number(image.end) || 0,
                    x: Number(image.x) || 0,
                    y: Number(image.y) || 0,
                    width: Number(image.width) || 0,
                    height: Number(image.height) || 0,
                };
            })
            .filter(function (image) {
                return image.end > image.start;
            });
    }

    function getSerializableSubtitles() {
        var layerRect = subtitleLayer ? subtitleLayer.getBoundingClientRect() : null;
        var layerWidth = Math.max(1, Number(layerRect && layerRect.width) || 0);
        var layerHeight = Math.max(1, Number(layerRect && layerRect.height) || 0);
        return state.subtitles
            .map(function (subtitle, index) {
                return {
                    index: index,
                    text: String(subtitle.text || "").trim(),
                    start: Number(subtitle.start) || 0,
                    end: Number(subtitle.end) || 0,
                    x: Number(subtitle.x) || 0,
                    y: Number(subtitle.y) || 0,
                    width: getSubtitleWidth(subtitle),
                    height: getSubtitleHeight(subtitle),
                    previewWidth: layerWidth,
                    previewHeight: layerHeight,
                    fontFamily: subtitle.fontFamily || "system",
                    fontSize: Number(subtitle.fontSize) || 28,
                    fontBold: Boolean(subtitle.fontBold),
                    fontItalic: Boolean(subtitle.fontItalic),
                    fontUnderline: Boolean(subtitle.fontUnderline),
                    fontColorEnabled: subtitle.fontColorEnabled !== false,
                    fontColor: subtitle.fontColor || "#ffffff",
                    fontStrokeEnabled: subtitle.fontStrokeEnabled !== false,
                    fontStrokeColor: subtitle.fontStrokeColor || "#000000",
                    bgEnabled: subtitle.bgEnabled !== false,
                    bgColor: subtitle.bgColor || "#000000",
                    borderEnabled: subtitle.borderEnabled !== false,
                    borderColor: subtitle.borderColor || "#000000",
                };
            })
            .filter(function (subtitle) {
                return subtitle.text && subtitle.end > subtitle.start;
            });
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
        var serializableSubtitles = getSerializableSubtitles();
        var formData = new FormData();
        formData.append("path", path);
        formData.append("trim_start", String(Number(startInput && startInput.value) || 0));
        formData.append("trim_end", String(Number(endInput && endInput.value) || 0));
        formData.append("volume", String(Number(volumeInput && volumeInput.value) || 1));
        formData.append("subtitles_json", JSON.stringify(serializableSubtitles));
        formData.append("images_json", JSON.stringify(getSerializableImages()));
        state.images.forEach(function (image, index) {
            if (image.file) {
                formData.append("image_overlay_" + index, image.file, image.file.name || ("overlay-" + index));
            }
        });
        if (state.appendFile) {
            formData.append("append_blob", state.appendFile, state.appendFile.name);
        }
        Promise.all(serializableSubtitles.map(function (subtitle) {
            return createSubtitleOverlayBlob(subtitle).then(function (blob) {
                if (blob) formData.append("subtitle_overlay_" + subtitle.index, blob, "subtitle-" + subtitle.index + ".png");
            });
        }))
            .then(function () {
                return fetch(saveUrl, {
                    method: "POST",
                    headers: csrfToken ? { "X-CSRFToken": csrfToken, "X-Requested-With": "XMLHttpRequest" } : { "X-Requested-With": "XMLHttpRequest" },
                    body: formData,
                });
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

    function createSubtitleOverlayBlob(subtitle) {
        return new Promise(function (resolve) {
            var previewWidth = Math.max(1, Number(subtitle.previewWidth) || 0);
            var previewHeight = Math.max(1, Number(subtitle.previewHeight) || 0);
            var width = Math.max(1, Math.ceil(previewWidth * ((Number(subtitle.width) || 0) / 100)));
            var height = Math.max(1, Math.ceil(previewHeight * ((Number(subtitle.height) || 0) / 100)));
            var fontSize = Math.max(8, Math.min(160, Number(subtitle.fontSize) || 28));
            var paddingY = Math.max(2, Math.round(fontSize * 0.28));
            var paddingX = Math.max(4, Math.round(fontSize * 0.42));
            var div = document.createElement("div");
            div.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
            div.textContent = subtitle.text || "";
            div.style.cssText = [
                "box-sizing:border-box",
                "width:" + width + "px",
                "height:" + height + "px",
                "display:flex",
                "align-items:center",
                "justify-content:center",
                "padding:" + paddingY + "px " + paddingX + "px",
                "border:2px solid " + (subtitle.borderEnabled === false ? "transparent" : (subtitle.borderColor || "#000000")),
                "border-radius:4px",
                "background:" + (subtitle.bgEnabled === false ? "transparent" : hexToRgba(subtitle.bgColor || "#000000", 0.62)),
                "color:" + (subtitle.fontColorEnabled === false ? "#ffffff" : (subtitle.fontColor || "#ffffff")),
                "font-family:" + getSubtitleFontFamilyCss(subtitle.fontFamily),
                "font-size:" + fontSize + "px",
                "font-weight:" + (subtitle.fontBold ? "700" : "400"),
                "font-style:" + (subtitle.fontItalic ? "italic" : "normal"),
                "text-decoration:" + (subtitle.fontUnderline ? "underline" : "none"),
                "text-shadow:" + (subtitle.fontStrokeEnabled === false ? "none" : getTextStrokeShadow(subtitle.fontStrokeColor || "#000000")),
                "line-height:1.25",
                "text-align:center",
                "white-space:pre-wrap",
                "overflow:hidden",
            ].join(";");
            var html = new XMLSerializer().serializeToString(div);
            var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' +
                '<foreignObject width="100%" height="100%">' + html + '</foreignObject></svg>';
            var image = new Image();
            image.onload = function () {
                var canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                var ctx = canvas.getContext("2d");
                if (!ctx) {
                    resolve(null);
                    return;
                }
                ctx.clearRect(0, 0, width, height);
                ctx.drawImage(image, 0, 0);
                canvas.toBlob(function (blob) {
                    resolve(blob || null);
                }, "image/png");
            };
            image.onerror = function () { resolve(null); };
            image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
        });
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, Number(value) || 0));
    }

    function hexToRgba(hex, alpha) {
        var value = String(hex || "").replace("#", "");
        if (value.length === 3) {
            value = value.split("").map(function (part) { return part + part; }).join("");
        }
        var red = parseInt(value.slice(0, 2), 16);
        var green = parseInt(value.slice(2, 4), 16);
        var blue = parseInt(value.slice(4, 6), 16);
        if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) {
            return "rgba(0, 0, 0, " + alpha + ")";
        }
        return "rgba(" + red + ", " + green + ", " + blue + ", " + alpha + ")";
    }

    function isVideoPath(path) {
        return /\.(mp4|mov|webm|mkv|avi|wmv|m4v|ogv)$/i.test(String(path || "").split("?")[0]);
    }

    function isImagePath(path) {
        return /\.(png|jpe?g|gif|webp|bmp|tiff?|avif)$/i.test(String(path || "").split("?")[0]);
    }

    function normalizePath(path) {
        return String(path || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    }

    function getParentPath(path) {
        var normalized = normalizePath(path);
        var index = normalized.lastIndexOf("/");
        return index > 0 ? normalized.slice(0, index) : "";
    }

    function getScopedParentPath(path) {
        var normalized = normalizePath(path);
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

    function appendQuery(url, key, value) {
        var separator = String(url || "").indexOf("?") >= 0 ? "&" : "?";
        return String(url || "") + separator + encodeURIComponent(key) + "=" + encodeURIComponent(value || "");
    }

    function loadImageDriveDirectory(dirPath) {
        if (!state.listApiUrl || !imageDriveList) return;
        state.imageDriveDir = normalizePickerPath(dirPath || "");
        if (imageDrivePathEl) imageDrivePathEl.textContent = state.imageDriveDir || "/";
        imageDriveList.textContent = "";
        fetch(appendQuery(state.listApiUrl, "path", state.imageDriveDir), {
            credentials: "same-origin",
            headers: { "X-Requested-With": "XMLHttpRequest" },
        })
            .then(function (response) { return response.json(); })
            .then(function (data) {
                renderImageDriveEntries(Array.isArray(data && data.entries) ? data.entries : []);
            })
            .catch(function () {
                renderImageDriveEntries([]);
            });
    }

    function normalizePickerPath(path) {
        var normalized = normalizePath(path);
        var scopedRoot = normalizePath(state.scopedHomeDir || "");
        if (scopedRoot && (!normalized || normalized === scopedRoot || normalized.indexOf(scopedRoot + "/") !== 0)) {
            return scopedRoot;
        }
        return normalized;
    }

    function isPathInPickerScope(path) {
        var normalized = normalizePath(path);
        var scopedRoot = normalizePath(state.scopedHomeDir || "");
        return !scopedRoot || normalized === scopedRoot || normalized.indexOf(scopedRoot + "/") === 0;
    }

    function renderImageDriveEntries(entries) {
        if (!imageDriveList) return;
        imageDriveList.textContent = "";
        entries.filter(function (entry) {
            return entry && (entry.type === "dir" || isImagePath(entry.name || entry.path || ""));
        }).forEach(function (entry) {
            var button = document.createElement("button");
            button.type = "button";
            button.className = "ae-drive-row" + (entry.type === "dir" ? " is-dir" : " is-file");
            button.textContent = (entry.type === "dir" ? "▸ " : "") + (entry.name || entry.path || "");
            button.addEventListener("click", function () {
                if (entry.type === "dir") {
                    loadImageDriveDirectory(entry.path || "");
                } else {
                    addImageOverlayFromDrivePath(entry.path || "");
                }
            });
            imageDriveList.appendChild(button);
        });
    }

    window.HandriveVideoEditor = {
        init: init,
        destroy: destroy,
        getIsDirty: function () { return state.isDirty; },
        saveToServer: saveToServer,
    };
})();
