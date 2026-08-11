(function () {
    "use strict";

    // Queue helpers format the upload/operation queue into compact UI labels and DOM rows.
    // The actual worker side effects live in queue_operation_helpers.js.

    function summarizeUploadQueue(items, t) {
        // Summaries collapse heterogeneous upload/move/delete work into one short status line
        // for the floating queue header without exposing the full item list every time.
        var normalizedItems = Array.isArray(items) ? items : [];
        var uploadingCount = 0, movingCount = 0, copyingCount = 0, deletingCount = 0, restoringCount = 0, extractingCount = 0, archiveCreatingCount = 0, youtubeSavingCount = 0, mp3ConvertingCount = 0;
        var uploadDoneCount = 0, moveDoneCount = 0, copyDoneCount = 0, deleteDoneCount = 0, restoreDoneCount = 0, extractDoneCount = 0, archiveCreateDoneCount = 0, youtubeSaveDoneCount = 0, mp3ConvertDoneCount = 0;
        var queuedCount = 0, failedCount = 0;

        normalizedItems.forEach(function (item) {
            var isOp = item.kind === "operation";
            var opType = item.operationType;
            if (item.status === "uploading") {
                if (isOp && opType === "move") {
                    if (item.isCopyOperation) { copyingCount += 1; }
                    else { movingCount += 1; }
                }
                else if (isOp && opType === "delete") { deletingCount += 1; }
                else if (isOp && opType === "restore") { restoringCount += 1; }
                else if (isOp && opType === "extract") { extractingCount += 1; }
                else if (isOp && opType === "create-archive") { archiveCreatingCount += 1; }
                else if (isOp && opType === "youtube-save") { youtubeSavingCount += 1; }
                else if (isOp && opType === "convert-mp3") { mp3ConvertingCount += 1; }
                else { uploadingCount += 1; }
            } else if (item.status === "queued") {
                queuedCount += 1;
            } else if (item.status === "done") {
                if (isOp && opType === "move") {
                    if (item.isCopyOperation) { copyDoneCount += 1; }
                    else { moveDoneCount += 1; }
                }
                else if (isOp && opType === "delete") { deleteDoneCount += 1; }
                else if (isOp && opType === "restore") { restoreDoneCount += 1; }
                else if (isOp && opType === "extract") { extractDoneCount += 1; }
                else if (isOp && opType === "create-archive") { archiveCreateDoneCount += 1; }
                else if (isOp && opType === "youtube-save") { youtubeSaveDoneCount += 1; }
                else if (isOp && opType === "convert-mp3") { mp3ConvertDoneCount += 1; }
                else { uploadDoneCount += 1; }
            } else if (item.status === "failed") {
                failedCount += 1;
            }
        });

        var parts = [];
        if (uploadingCount > 0) { parts.push(t("job_status_uploading", "업로드 중") + " " + uploadingCount); }
        if (copyingCount > 0) { parts.push(t("queue_status_copying", "복사 중") + " " + copyingCount); }
        if (movingCount > 0) { parts.push(t("queue_status_moving", "이동 중") + " " + movingCount); }
        if (deletingCount > 0) { parts.push(t("queue_status_deleting", "삭제 중") + " " + deletingCount); }
        if (restoringCount > 0) { parts.push(t("queue_status_restoring", "복원 중") + " " + restoringCount); }
        if (extractingCount > 0) { parts.push(t("queue_status_extracting", "압축해제 중") + " " + extractingCount); }
        if (archiveCreatingCount > 0) { parts.push(t("queue_status_archive_creating", "압축파일 생성 중") + " " + archiveCreatingCount); }
        if (youtubeSavingCount > 0) { parts.push(t("queue_status_youtube_saving", "YouTube 저장 중") + " " + youtubeSavingCount); }
        if (mp3ConvertingCount > 0) { parts.push(t("queue_status_convert_mp3_converting", "mp3 변환 중") + " " + mp3ConvertingCount); }
        if (queuedCount > 0) { parts.push(t("queue_status_pending", "대기") + " " + queuedCount); }
        if (uploadDoneCount > 0) { parts.push(t("job_status_done", "업로드 완료") + " " + uploadDoneCount); }
        if (copyDoneCount > 0) { parts.push(t("queue_status_copy_done", "복사 완료") + " " + copyDoneCount); }
        if (moveDoneCount > 0) { parts.push(t("queue_status_move_done", "이동 완료") + " " + moveDoneCount); }
        if (deleteDoneCount > 0) { parts.push(t("queue_status_delete_done", "삭제 완료") + " " + deleteDoneCount); }
        if (restoreDoneCount > 0) { parts.push(t("queue_status_restore_done", "복원 완료") + " " + restoreDoneCount); }
        if (extractDoneCount > 0) { parts.push(t("queue_status_extract_done", "압축해제 완료") + " " + extractDoneCount); }
        if (archiveCreateDoneCount > 0) { parts.push(t("queue_status_archive_create_done", "압축파일 생성 완료") + " " + archiveCreateDoneCount); }
        if (youtubeSaveDoneCount > 0) { parts.push(t("queue_status_youtube_save_done", "YouTube 저장 완료") + " " + youtubeSaveDoneCount); }
        if (mp3ConvertDoneCount > 0) { parts.push(t("queue_status_convert_mp3_done", "mp3 변환 완료") + " " + mp3ConvertDoneCount); }
        if (failedCount > 0) { parts.push(t("job_status_failed", "실패") + " " + failedCount); }
        return parts.join(" · ");
    }

    function getQueueItemStatusLabel(item, t) {
        // Queue rows reuse the same label slot for uploads and synthetic move/delete operations.
        if (!item) {
            return "";
        }
        var progressText = " " + Math.round(item.progress || 0) + "%";
        if (item.kind === "operation") {
            if (item.operationType === "delete") {
                if (item.status === "uploading") {
                    return t("queue_status_deleting", "삭제 중") + progressText;
                }
                if (item.status === "queued") {
                    return t("queue_status_delete_queued", "삭제 대기");
                }
                if (item.status === "done") {
                    return t("queue_status_delete_done", "삭제 완료");
                }
                return t("job_status_failed", "실패");
            }
            if (item.operationType === "move") {
                var statusLabelPrefix = item.isCopyOperation ? "복사" : "이동";
                var statusLabelKey = item.isCopyOperation ? "copy" : "move";
                var statusLabelProgressKey = item.isCopyOperation ? "copying" : "moving";
                if (item.status === "uploading") {
                    return t("queue_status_" + statusLabelProgressKey, statusLabelPrefix + " 중") + progressText;
                }
                if (item.status === "queued") {
                    return t("queue_status_" + statusLabelKey + "_queued", statusLabelPrefix + " 대기");
                }
                if (item.status === "done") {
                    return t("queue_status_" + statusLabelKey + "_done", statusLabelPrefix + " 완료");
                }
                return t("job_status_failed", "실패");
            }
            if (item.operationType === "restore") {
                if (item.status === "uploading") {
                    return t("queue_status_restoring", "복원 중") + progressText;
                }
                if (item.status === "queued") {
                    return t("queue_status_restore_queued", "복원 대기");
                }
                if (item.status === "done") {
                    return t("queue_status_restore_done", "복원 완료");
                }
                return t("job_status_failed", "실패");
            }
            if (item.operationType === "extract") {
                if (item.status === "uploading") {
                    return t("queue_status_extracting", "압축해제 중") + progressText;
                }
                if (item.status === "queued") {
                    return t("queue_status_extract_queued", "압축해제 대기");
                }
                if (item.status === "done") {
                    return t("queue_status_extract_done", "압축해제 완료");
                }
                return t("job_status_failed", "실패");
            }
            if (item.operationType === "create-archive") {
                if (item.status === "uploading") {
                    return t("queue_status_archive_creating", "압축파일 생성 중") + progressText;
                }
                if (item.status === "queued") {
                    return t("queue_status_archive_create_queued", "압축파일 생성 대기");
                }
                if (item.status === "done") {
                    return t("queue_status_archive_create_done", "압축파일 생성 완료");
                }
                return t("job_status_failed", "실패");
            }
            if (item.operationType === "youtube-save") {
                if (item.status === "uploading") {
                    return t("queue_status_youtube_saving", "YouTube 저장 중") + progressText;
                }
                if (item.status === "queued") {
                    return t("queue_status_youtube_save_queued", "YouTube 저장 대기");
                }
                if (item.status === "done") {
                    return t("queue_status_youtube_save_done", "YouTube 저장 완료");
                }
                return t("job_status_failed", "실패");
            }
            if (item.operationType === "convert-mp3") {
                if (item.status === "uploading") {
                    return t("queue_status_convert_mp3_converting", "mp3 변환 중") + progressText;
                }
                if (item.status === "queued") {
                    return t("queue_status_convert_mp3_queued", "mp3 변환 대기");
                }
                if (item.status === "done") {
                    return t("queue_status_convert_mp3_done", "mp3 변환 완료");
                }
                return t("job_status_failed", "실패");
            }
        }
        if (item.status === "uploading") {
            return t("job_status_uploading", "업로드 중") + progressText;
        }
        if (item.status === "queued") {
            return t("job_status_queued", "대기 중");
        }
        if (item.status === "done") {
            return t("job_status_done", "완료");
        }
        return t("job_status_failed", "실패");
    }

    function getQueueItemMetaLabel(item, getHandrivePathLabel) {
        if (!item) {
            return "";
        }
        if (item.kind === "operation") {
            if (item.status === "done") {
                if (item.operationType === "move" || item.operationType === "restore" || item.operationType === "extract" || item.operationType === "create-archive" || item.operationType === "youtube-save" || item.operationType === "convert-mp3") {
                    return getHandrivePathLabel(item.savedPath || item.targetDirPath || item.sourcePath || "");
                }
                return getHandrivePathLabel(item.sourcePath || "");
            }
            if (item.operationType === "move" || item.operationType === "restore" || item.operationType === "extract" || item.operationType === "create-archive" || item.operationType === "youtube-save" || item.operationType === "convert-mp3") {
                return getHandrivePathLabel(item.targetDirPath || item.sourcePath || "");
            }
            return getHandrivePathLabel(item.sourcePath || "");
        }
        return getHandrivePathLabel(item.savedPath || item.targetDirPath);
    }

    function buildQueueItemLabel(entries, fallbackLabel, options) {
        // Multi-entry queue actions need one stable label, even when they originated from
        // mixed file/folder selections or the current-folder pseudo entry.
        var settings = options || {};
        var normalizedEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
        var getEntryEditableName = settings.getEntryEditableName || function () { return ""; };
        var getCurrentFolderName = settings.getCurrentFolderName || function () { return ""; };
        var formatTemplate = settings.formatTemplate || function (template) { return template; };
        var t = settings.t || function (_, fallbackValue) { return fallbackValue || ""; };

        if (normalizedEntries.length === 0) {
            return fallbackLabel || "";
        }
        if (normalizedEntries.length === 1) {
            var entry = normalizedEntries[0];
            return entry.name || getEntryEditableName(entry) || getCurrentFolderName(entry.path || "") || fallbackLabel || "";
        }
        return formatTemplate(t("js_selected_items_count", "{count}개 항목"), {
            count: normalizedEntries.length,
        });
    }

    function sortQueueItems(items) {
        return (Array.isArray(items) ? items : []).slice().sort(function (left, right) {
            function getPriority(item) {
                if (item.status === "uploading") {
                    return 0;
                }
                if (item.status === "queued") {
                    return 1;
                }
                return 2;
            }

            var leftPriority = getPriority(left);
            var rightPriority = getPriority(right);
            if (leftPriority !== rightPriority) {
                return leftPriority - rightPriority;
            }
            if (leftPriority === 1) {
                return right.id - left.id;
            }
            if (leftPriority === 2) {
                return right.id - left.id;
            }
            return right.id - left.id;
        });
    }

    function formatQueueFileSize(bytes) {
        var n = Number(bytes) || 0;
        if (n < 1024) { return n + " B"; }
        if (n < 1024 * 1024) { return (n / 1024).toFixed(1) + " KB"; }
        if (n < 1024 * 1024 * 1024) { return (n / (1024 * 1024)).toFixed(1) + " MB"; }
        return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
    }

    function formatQueueSpeed(bytesPerSec) {
        var n = Number(bytesPerSec) || 0;
        if (n < 1024) { return n.toFixed(0) + " B/s"; }
        if (n < 1024 * 1024) { return (n / 1024).toFixed(1) + " KB/s"; }
        return (n / (1024 * 1024)).toFixed(1) + " MB/s";
    }

    function formatQueueElapsed(startTime) {
        if (!startTime) { return ""; }
        var sec = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
        var m = Math.floor(sec / 60);
        var s = sec % 60;
        return m + ":" + (s < 10 ? "0" : "") + s;
    }

    function createQueueListItem(item, options) {
        var settings = options || {};
        var documentRef = settings.documentRef || document;
        var onActivate = settings.onActivate || function () {};
        var onChildActivate = settings.onChildActivate || function () {};
        var onChildOpen = settings.onChildOpen || function () {};
        var onOpen = settings.onOpen || function () {};
        var onOpenContextMenu = settings.onOpenContextMenu || function () {};
        var onToggleDetails = settings.onToggleDetails || function () {};
        var getStatusLabel = settings.getStatusLabel || function () { return ""; };
        var getMetaLabel = settings.getMetaLabel || function () { return ""; };
        var getChildItems = settings.getChildItems || function () { return []; };
        var getChildMetaLabel = settings.getChildMetaLabel || getMetaLabel;
        var getChildStatusLabel = settings.getChildStatusLabel || getStatusLabel;
        var childItems = getChildItems(item).filter(Boolean);

        var isFileUpload = item.kind !== "operation";
        var isUploading = item.status === "uploading";

        var listItem = documentRef.createElement("li");
        listItem.className = "handrive-job-queue-item";
        listItem.dataset.status = item.status;
        if (childItems.length > 0) {
            listItem.classList.add("has-child-items");
            listItem.classList.toggle("is-expanded", Boolean(item.detailsExpanded));
            listItem.setAttribute("aria-expanded", item.detailsExpanded ? "true" : "false");
        }

        // ── 행 1: 파일명(좌) + 파일 용량(우) ───────────────────────────
        var head = documentRef.createElement("div");
        head.className = "handrive-job-queue-item-head";

        var name = documentRef.createElement("span");
        name.className = "handrive-job-queue-item-name";
        name.textContent = item.fileName;
        head.appendChild(name);

        var sizeText = isFileUpload
            ? (item.fileSize > 0 ? formatQueueFileSize(item.fileSize) : "")
            : (item.sizeDisplay || "");
        if (sizeText) {
            var sizeEl = documentRef.createElement("span");
            sizeEl.className = "handrive-job-queue-item-size";
            sizeEl.textContent = sizeText;
            head.appendChild(sizeEl);
        }

        listItem.appendChild(head);

        // ── 행 2: 속도·경과(좌, 업로드 중) + 상태(우) ─────────────────
        var sub = documentRef.createElement("div");
        sub.className = "handrive-job-queue-item-sub";

        if (isFileUpload && isUploading && item.startTime) {
            var speedEl = documentRef.createElement("span");
            speedEl.className = "handrive-job-queue-item-speed";
            var speedText = item.uploadSpeed > 0 ? formatQueueSpeed(item.uploadSpeed) : "";
            var elapsedText = formatQueueElapsed(item.startTime);
            speedEl.textContent = speedText && elapsedText
                ? speedText + " · " + elapsedText
                : speedText || elapsedText;
            sub.appendChild(speedEl);
        }

        var status = documentRef.createElement("span");
        status.className = "handrive-job-queue-item-status";
        status.textContent = getStatusLabel(item);
        sub.appendChild(status);

        listItem.appendChild(sub);

        // ── 메타(경로) ─────────────────────────────────────────────────
        var meta = documentRef.createElement("div");
        meta.className = "handrive-job-queue-item-meta";
        meta.textContent = getMetaLabel(item);
        listItem.appendChild(meta);

        if (item.errorMessage) {
            var reason = documentRef.createElement("div");
            reason.className = "handrive-job-queue-item-reason";
            reason.textContent = item.errorMessage;
            listItem.appendChild(reason);
        }

        if (childItems.length > 0) {
            var childList = documentRef.createElement("ul");
            childList.className = "handrive-job-queue-child-list";
            childList.hidden = !item.detailsExpanded;
            childItems.forEach(function (childItem) {
                var childRow = documentRef.createElement("li");
                childRow.className = "handrive-job-queue-child-row";
                var childAction = documentRef.createElement(childItem.canOpen ? "button" : "div");
                childAction.className = "handrive-job-queue-child-item";
                if (childItem.canOpen) {
                    childAction.type = "button";
                    childAction.addEventListener("click", function (event) {
                        event.preventDefault();
                        event.stopPropagation();
                        onChildActivate(childItem, item, event);
                    });
                    childAction.addEventListener("dblclick", function (event) {
                        event.preventDefault();
                        event.stopPropagation();
                        onChildOpen(childItem, item, event);
                    });
                } else {
                    childAction.addEventListener("click", function (event) {
                        event.preventDefault();
                        event.stopPropagation();
                    });
                }

                var childHead = documentRef.createElement("div");
                childHead.className = "handrive-job-queue-item-head handrive-job-queue-child-head";

                var childName = documentRef.createElement("span");
                childName.className = "handrive-job-queue-item-name handrive-job-queue-child-name";
                childName.textContent = childItem.fileName || "";
                childHead.appendChild(childName);

                var childSizeText = String(childItem.sizeDisplay || childItem.size_display || "").trim();
                if (childSizeText) {
                    var childSize = documentRef.createElement("span");
                    childSize.className = "handrive-job-queue-item-size handrive-job-queue-child-size";
                    childSize.textContent = childSizeText;
                    childHead.appendChild(childSize);
                }
                childAction.appendChild(childHead);

                var childSub = documentRef.createElement("div");
                childSub.className = "handrive-job-queue-item-sub handrive-job-queue-child-sub";

                var childStatus = documentRef.createElement("span");
                childStatus.className = "handrive-job-queue-item-status handrive-job-queue-child-status";
                childStatus.textContent = getChildStatusLabel(childItem, item);
                childSub.appendChild(childStatus);
                childAction.appendChild(childSub);

                var childMetaText = getChildMetaLabel(childItem, item);
                if (childMetaText) {
                    var childMeta = documentRef.createElement("div");
                    childMeta.className = "handrive-job-queue-item-meta handrive-job-queue-child-meta";
                    childMeta.textContent = childMetaText;
                    childAction.appendChild(childMeta);
                }
                childRow.appendChild(childAction);
                childList.appendChild(childRow);
            });
            listItem.appendChild(childList);
        }

        var progress = documentRef.createElement("div");
        progress.className = "handrive-job-queue-progress";
        var progressBar = documentRef.createElement("span");
        progressBar.className = "handrive-job-queue-progress-bar";
        progressBar.style.width = Math.max(0, Math.min(100, item.status === "done" ? 100 : item.progress || 0)) + "%";
        progress.appendChild(progressBar);
        listItem.appendChild(progress);

        listItem.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (childItems.length > 0) {
                item.detailsExpanded = !item.detailsExpanded;
                onToggleDetails(item, event);
                return;
            }
            onActivate(item, event);
        });
        listItem.addEventListener("dblclick", function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (childItems.length > 0) {
                return;
            }
            onOpen(item, event);
        });
        listItem.addEventListener("contextmenu", function (event) {
            event.preventDefault();
            event.stopPropagation();
            onOpenContextMenu(item, event.clientX, event.clientY);
        });

        return listItem;
    }

    var uploadQueueBehaviorStates = new WeakMap();
    var uploadQueueAutoCollapseDelay = 10000;
    var uploadQueueActiveStatuses = {
        active: true,
        in_progress: true,
        "in-progress": true,
        pending: true,
        processing: true,
        queued: true,
        uploading: true,
    };

    function getUploadQueueBehaviorState(panel) {
        var state = uploadQueueBehaviorStates.get(panel);
        if (!state) {
            state = {
                autoCollapseTimer: null,
                autoExpandQueued: false,
                autoCollapseEnabled: true,
                allComplete: false,
                collapsed: false,
                dismissed: false,
                initialized: false,
                itemKeys: new Set(),
                onAutoCollapse: null,
                onAutoExpand: null,
            };
            uploadQueueBehaviorStates.set(panel, state);
        }
        return state;
    }

    function clearUploadQueueAutoCollapseTimer(state) {
        if (state.autoCollapseTimer !== null) {
            window.clearTimeout(state.autoCollapseTimer);
            state.autoCollapseTimer = null;
        }
    }

    function scheduleUploadQueueAutoCollapse(state) {
        clearUploadQueueAutoCollapseTimer(state);
        if (!state.autoCollapseEnabled || state.dismissed || state.collapsed || !state.allComplete) {
            return;
        }
        state.autoCollapseTimer = window.setTimeout(function () {
            state.autoCollapseTimer = null;
            if (!state.autoCollapseEnabled || state.dismissed || state.collapsed || !state.allComplete) {
                return;
            }
            if (typeof state.onAutoCollapse === "function") {
                state.onAutoCollapse();
            }
        }, uploadQueueAutoCollapseDelay);
    }

    function bindUploadQueueBehavior(panel, state) {
        if (state.interactionBound) {
            return;
        }
        state.interactionBound = true;
        ["pointerdown", "click", "keydown", "wheel", "touchstart"].forEach(function (eventName) {
            panel.addEventListener(eventName, function () {
                scheduleUploadQueueAutoCollapse(state);
            });
        });
    }

    function getUploadQueueItemKey(item, index) {
        if (item && item.id !== undefined && item.id !== null) {
            return String(item.id);
        }
        return [
            item && (item.fileName || item.file_name || item.name) || "",
            item && (item.targetDirPath || item.target_dir_path || item.sourcePath || "") || "",
            index,
        ].join("|");
    }

    function isUploadQueueItemComplete(item) {
        var status = String(item && item.status || "").toLowerCase();
        return Boolean(status) && !uploadQueueActiveStatuses[status];
    }

    function syncUploadQueueBehavior(options) {
        var settings = options || {};
        var panel = settings.uploadQueuePanel || null;
        if (!panel) {
            return;
        }
        var state = getUploadQueueBehaviorState(panel);
        var items = Array.isArray(settings.items) ? settings.items : [];
        var itemKeys = new Set(items.map(getUploadQueueItemKey));
        var hasNewItems = state.initialized;
        if (hasNewItems) {
            hasNewItems = Array.from(itemKeys).some(function (key) {
                return !state.itemKeys.has(key);
            });
        }
        state.itemKeys = itemKeys;
        state.initialized = true;
        state.autoCollapseEnabled = settings.autoCollapseEnabled !== false;
        state.allComplete = items.length > 0 && items.every(isUploadQueueItemComplete);
        state.collapsed = Boolean(settings.collapsed);
        state.dismissed = Boolean(settings.dismissed);
        state.onAutoCollapse = settings.onAutoCollapse || null;
        state.onAutoExpand = settings.onAutoExpand || null;
        bindUploadQueueBehavior(panel, state);

        if (hasNewItems) {
            clearUploadQueueAutoCollapseTimer(state);
            if (state.collapsed && typeof state.onAutoExpand === "function" && !state.autoExpandQueued) {
                state.autoExpandQueued = true;
                window.setTimeout(function () {
                    state.autoExpandQueued = false;
                    if (state.collapsed && !state.dismissed && typeof state.onAutoExpand === "function") {
                        state.onAutoExpand();
                    }
                }, 0);
                return;
            }
        }
        scheduleUploadQueueAutoCollapse(state);
    }

    function renderUploadQueuePanel(options) {
        var settings = options || {};
        var uploadQueuePanel = settings.uploadQueuePanel || null;
        var uploadQueueList = settings.uploadQueueList || null;
        var uploadQueueSummary = settings.uploadQueueSummary || null;
        var uploadQueueToggleButton = settings.uploadQueueToggleButton || null;
        var items = Array.isArray(settings.items) ? settings.items : [];
        var collapsed = Boolean(settings.collapsed);
        var dismissed = Boolean(settings.dismissed);
        var t = settings.t || function (_, fallbackValue) { return fallbackValue || ""; };
        var createQueueListItem = settings.createQueueListItem || function () { return null; };
        var summarizeUploadQueue = settings.summarizeUploadQueue || function () { return ""; };
        var sortQueueItems = settings.sortQueueItems || function (nextItems) { return nextItems; };

        if (!uploadQueuePanel || !uploadQueueList || !uploadQueueSummary) {
            return;
        }

        syncUploadQueueBehavior(settings);

        uploadQueuePanel.classList.toggle("is-collapsed", collapsed);
        uploadQueueList.hidden = false;
        uploadQueueList.setAttribute("aria-hidden", collapsed ? "true" : "false");
        uploadQueueList.inert = collapsed;
        if (uploadQueueToggleButton) {
            var expanded = collapsed ? "false" : "true";
            var toggleLabel = collapsed
                ? t("expand", "펼치기")
                : t("collapse", "접기");
            uploadQueueToggleButton.setAttribute("aria-expanded", expanded);
            uploadQueueToggleButton.setAttribute("aria-label", toggleLabel);
            uploadQueueToggleButton.setAttribute("title", toggleLabel);
        }

        if (items.length === 0) {
            uploadQueuePanel.hidden = true;
            uploadQueueList.innerHTML = "";
            uploadQueueSummary.textContent = t("job_queue_empty", "작업 대기 없음");
            return;
        }

        uploadQueuePanel.hidden = dismissed;
        uploadQueueSummary.textContent = summarizeUploadQueue(items);
        uploadQueueList.innerHTML = "";

        sortQueueItems(items).forEach(function (item) {
            var listItem = createQueueListItem(item);
            if (listItem) {
                uploadQueueList.appendChild(listItem);
            }
        });
    }

    function configureUploadQueueContextMenu(options) {
        var settings = options || {};
        var item = settings.item || null;
        var t = settings.t || function (_, fallbackValue) { return fallbackValue || ""; };
        var buttons = settings.buttons || {};
        var setContextButtonVisible = settings.setContextButtonVisible || function () {};
        var defaultLabels = settings.defaultLabels || {};

        var contextOpenButton = buttons.open || null;
        var contextOpenLocationButton = buttons.openLocation || null;
        var contextDownloadButton = buttons.download || null;
        var contextShareButton = buttons.share || null;
        var contextUploadButton = buttons.upload || null;
        var contextEditButton = buttons.edit || null;
        var contextRenameButton = buttons.rename || null;
        var contextDeleteButton = buttons.deleteButton || null;
        var contextNewFolderButton = buttons.newFolder || null;
        var contextNewDocButton = buttons.newDoc || null;
        var contextGitCreateRepoButton = buttons.gitCreateRepo || null;
        var contextGitManageRepoButton = buttons.gitManageRepo || null;
        var contextGitDeleteRepoButton = buttons.gitDeleteRepo || null;
        var contextGitCreateBranchButton = buttons.gitCreateBranch || null;
        var contextGitDeleteBranchButton = buttons.gitDeleteBranch || null;
        var contextCreateMapButton = buttons.createMap || null;
        var contextConvertMp3Button = buttons.convertMp3 || null;
        var contextCreateArchiveButton = buttons.createArchive || null;
        var contextExtractArchiveButton = buttons.extractArchive || null;

        setContextButtonVisible(contextOpenButton, false);
        setContextButtonVisible(contextOpenLocationButton, false);
        setContextButtonVisible(contextDownloadButton, false);
        setContextButtonVisible(contextCreateArchiveButton, false);
        setContextButtonVisible(contextExtractArchiveButton, false);
        setContextButtonVisible(contextShareButton, false);
        setContextButtonVisible(contextUploadButton, false);
        setContextButtonVisible(contextEditButton, false);
        setContextButtonVisible(contextRenameButton, false);
        setContextButtonVisible(contextDeleteButton, false);
        setContextButtonVisible(contextNewFolderButton, false);
        setContextButtonVisible(contextNewDocButton, false);
        setContextButtonVisible(contextGitCreateRepoButton, false);
        setContextButtonVisible(contextGitManageRepoButton, false);
        setContextButtonVisible(contextGitDeleteRepoButton, false);
        setContextButtonVisible(contextGitCreateBranchButton, false);
        setContextButtonVisible(contextGitDeleteBranchButton, false);
        setContextButtonVisible(contextCreateMapButton, false);
        setContextButtonVisible(contextConvertMp3Button, false);

        if (!item) {
            setContextButtonVisible(contextOpenButton, false);
            setContextButtonVisible(contextOpenLocationButton, false);
            setContextButtonVisible(contextDeleteButton, false);
            return;
        }

        if (item.status === "uploading" || item.status === "queued") {
            if (contextOpenButton) {
                contextOpenButton.textContent = item.kind === "operation"
                    ? t("queue_cancel", "취소")
                    : t("upload_cancel", "업로드 취소");
            }
            setContextButtonVisible(contextOpenButton, true);
            setContextButtonVisible(contextOpenLocationButton, false);
            setContextButtonVisible(contextDeleteButton, false);
            return;
        }

        if (item.status === "done") {
            var canOpenLocation = Boolean(
                !(item.kind === "operation" && item.operationType === "delete") &&
                (item.savedPath || item.targetDirPath)
            );
            if (contextOpenButton) {
                contextOpenButton.textContent = item.kind === "operation" && item.operationType === "delete"
                    ? ""
                    : defaultLabels.open;
            }
            if (contextDeleteButton) {
                contextDeleteButton.textContent = item.kind === "operation"
                    ? t("queue_remove", "목록에서 제거")
                    : defaultLabels.delete;
            }
            setContextButtonVisible(contextOpenButton, !(item.kind === "operation" && item.operationType === "delete"));
            setContextButtonVisible(contextOpenLocationButton, canOpenLocation);
            setContextButtonVisible(contextDeleteButton, true);
            return;
        }

        setContextButtonVisible(contextOpenButton, false);
        setContextButtonVisible(contextOpenLocationButton, false);
        if (contextDeleteButton) {
            contextDeleteButton.textContent = item.kind === "operation"
                ? t("queue_remove", "목록에서 제거")
                : defaultLabels.delete;
        }
        setContextButtonVisible(contextDeleteButton, true);
    }

    window.HandriveQueueHelpers = {
        buildQueueItemLabel: buildQueueItemLabel,
        configureUploadQueueContextMenu: configureUploadQueueContextMenu,
        createQueueListItem: createQueueListItem,
        getQueueItemMetaLabel: getQueueItemMetaLabel,
        getQueueItemStatusLabel: getQueueItemStatusLabel,
        renderUploadQueuePanel: renderUploadQueuePanel,
        sortQueueItems: sortQueueItems,
        summarizeUploadQueue: summarizeUploadQueue,
    };
})();
