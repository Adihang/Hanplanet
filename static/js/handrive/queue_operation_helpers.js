(function () {
    "use strict";

    // Queue operation helpers run the side-effectful upload/move/delete workers that back the
    // floating queue panel. They are intentionally serial to keep progress ordering predictable.

    async function processUploadQueue(options) {
        // One worker drains queued items serially so progress state, conflict prompts,
        // and post-upload refresh timing stay deterministic.
        var settings = options || {};
        var state = settings.state || {};
        var renderUploadQueue = settings.renderUploadQueue || function () {};
        var uploadSingleFile = settings.uploadSingleFile || function () { return Promise.resolve(); };
        var refreshCurrentDirectory = settings.refreshCurrentDirectory || function () { return Promise.resolve(); };
        var alertError = settings.alertError || function () {};
        var t = settings.t || function (_, fallbackValue) { return fallbackValue || ""; };

        if (state.uploadWorkerActive) {
            return;
        }
        state.uploadWorkerActive = true;
        try {
            while (true) {
                var nextItem = (state.uploadQueueItems || []).find(function (item) {
                    return item.status === "queued";
                });
                if (!nextItem) {
                    break;
                }

                nextItem.status = "uploading";
                nextItem.progress = 0;
                nextItem.errorMessage = "";
                renderUploadQueue();

                try {
                    await uploadSingleFile(nextItem);
                } catch (error) {
                    if (nextItem.abortRequested) {
                        continue;
                    }
                    nextItem.status = "failed";
                    nextItem.errorMessage = error && error.message
                        ? error.message
                        : t("job_status_failed", "실패");
                    renderUploadQueue();
                }
            }
        } finally {
            state.uploadWorkerActive = false;
            if (state.uploadRefreshPending) {
                state.uploadRefreshPending = false;
                try {
                    await refreshCurrentDirectory({ skipPreview: true });
                } catch (error) {
                    alertError(error);
                }
            }
            renderUploadQueue();
        }
    }

    async function runDeleteOperationQueueItem(item, options) {
        // Delete queue items can represent multiple selected paths, so progress is computed
        // per child deletion while preserving one logical queue row in the UI.
        var settings = options || {};
        var requestJson = settings.requestJson || function () { return Promise.resolve(); };
        var buildPostOptions = settings.buildPostOptions || function () { return {}; };
        var deleteApiUrl = settings.deleteApiUrl || "";
        var renderUploadQueue = settings.renderUploadQueue || function () {};
        var removeExpandedFoldersByDeletedPaths = settings.removeExpandedFoldersByDeletedPaths || function () {};
        var applySelection = settings.applySelection || function () {};
        var queueNeedsRefresh = settings.queueNeedsRefresh || function () {};
        var onEntryDeleted = settings.onEntryDeleted || function () {};
        var t = settings.t || function (_, fallbackValue) { return fallbackValue || ""; };

        var entries = Array.isArray(item.entries) ? item.entries.slice() : [];
        var totalCount = entries.length;
        var deletedPaths = [];
        item.resultEntries = entries.map(function (entry) {
            return {
                path: entry.path,
                sourcePath: entry.path,
                name: entry.name || "",
                type: entry.type || "",
                size_display: entry.size_display || "",
                status: "queued",
            };
        });

        for (var index = 0; index < entries.length; index += 1) {
            if (item.abortRequested) {
                throw new Error(t("queue_cancel", "취소"));
            }
            var controller = new AbortController();
            item.abortController = controller;
            var entry = entries[index];
            await requestJson(deleteApiUrl, Object.assign(
                buildPostOptions({
                    path: entry.path,
                    commit_message: item.commitMessage || "",
                    repo_delete: Boolean(item.isRepoDelete),
                }),
                { signal: controller.signal }
            ));
            onEntryDeleted(entry.path);
            deletedPaths.push(entry.path);
            item.resultEntries[index] = Object.assign({}, item.resultEntries[index] || {}, {
                path: entry.path,
                sourcePath: entry.path,
                status: "done",
            });
            item.progress = ((index + 1) / totalCount) * 100;
            item.savedPath = entry.path;
            item.abortController = null;
            renderUploadQueue();
        }

        removeExpandedFoldersByDeletedPaths(deletedPaths);
        applySelection([], { render: false });
        queueNeedsRefresh();
    }

    async function runRestoreOperationQueueItem(item, options) {
        // Restore jobs keep the same per-entry progress and history detail as delete jobs,
        // while recording the final restored path for the queue row.
        var settings = options || {};
        var requestJson = settings.requestJson || function () { return Promise.resolve({}); };
        var buildPostOptions = settings.buildPostOptions || function () { return {}; };
        var trashRestoreApiUrl = settings.trashRestoreApiUrl || "";
        var renderUploadQueue = settings.renderUploadQueue || function () {};
        var applySelection = settings.applySelection || function () {};
        var queueNeedsRefresh = settings.queueNeedsRefresh || function () {};
        var t = settings.t || function (_, fallbackValue) { return fallbackValue || ""; };

        if (!trashRestoreApiUrl) {
            throw new Error(t("job_status_failed", "실패"));
        }

        var entries = Array.isArray(item.entries) ? item.entries.slice() : [];
        var totalCount = entries.length;
        item.resultEntries = entries.map(function (entry) {
            return {
                path: "",
                sourcePath: entry.path,
                name: entry.name || "",
                type: entry.type || "",
                size_display: entry.size_display || "",
                status: "queued",
            };
        });

        for (var index = 0; index < entries.length; index += 1) {
            if (item.abortRequested) {
                throw new Error(t("queue_cancel", "취소"));
            }
            var controller = new AbortController();
            item.abortController = controller;
            var entry = entries[index];
            var data = await requestJson(trashRestoreApiUrl, Object.assign(
                buildPostOptions({ paths: [entry.path] }),
                { signal: controller.signal }
            ));
            if (!data || data.ok !== true) {
                throw new Error(t("job_status_failed", "실패"));
            }
            item.resultEntries[index] = Object.assign({}, item.resultEntries[index] || {}, {
                path: "",
                sourcePath: entry.path,
                status: "done",
            });
            item.progress = ((index + 1) / totalCount) * 100;
            item.abortController = null;
            renderUploadQueue();
        }

        applySelection([], { render: false });
        queueNeedsRefresh();
    }

    async function runMoveOperationQueueItem(item, options) {
        // Move queue items mirror delete semantics but persist the last moved target path
        // so the queue row can still show a useful destination after completion.
        var settings = options || {};
        var requestJson = settings.requestJson || function () { return Promise.resolve({}); };
        var buildPostOptions = settings.buildPostOptions || function () { return {}; };
        var moveApiUrl = settings.moveApiUrl || "";
        var renderUploadQueue = settings.renderUploadQueue || function () {};
        var applySelection = settings.applySelection || function () {};
        var queueNeedsRefresh = settings.queueNeedsRefresh || function () {};
        var onEntryMoved = settings.onEntryMoved || function () {};
        var t = settings.t || function (_, fallbackValue) { return fallbackValue || ""; };

        var entries = Array.isArray(item.entries) ? item.entries.slice() : [];
        var totalCount = entries.length;
        var movedPaths = [];
        item.resultEntries = entries.map(function (entry) {
            return {
                path: "",
                sourcePath: entry.path,
                name: entry.name || "",
                type: entry.type || "",
                size_display: entry.size_display || "",
                status: "queued",
            };
        });

        for (var index = 0; index < entries.length; index += 1) {
            if (item.abortRequested) {
                throw new Error(t("queue_cancel", "취소"));
            }
            var controller = new AbortController();
            item.abortController = controller;
            var entry = entries[index];
            var data = await requestJson(moveApiUrl, Object.assign(
                buildPostOptions({
                    source_path: entry.path,
                    target_dir: item.targetDirPath,
                    commit_message: item.commitMessage || "",
                }),
                { signal: controller.signal }
            ));
            if (data && Object.prototype.hasOwnProperty.call(data, "copied")) {
                item.isCopyOperation = data.copied === true;
            }
            var movedPath = data && data.path ? data.path : entry.path;
            if (!data || data.copied !== true) {
                onEntryMoved(entry.path, movedPath);
            }
            movedPaths.push(movedPath);
            item.resultEntries[index] = Object.assign({}, item.resultEntries[index] || {}, {
                path: movedPath,
                slug_path: data && data.slug_path ? data.slug_path : "",
                sourcePath: entry.path,
                status: "done",
            });
            item.progress = ((index + 1) / totalCount) * 100;
            item.savedPath = movedPath;
            item.savedSlugPath = data && data.slug_path ? data.slug_path : "";
            item.abortController = null;
            renderUploadQueue();
        }

        applySelection(movedPaths, {
            primaryPath: movedPaths[0] || "",
            anchorPath: movedPaths[0] || "",
            render: false,
        });
        queueNeedsRefresh();
    }

    async function runCreateArchiveOperationQueueItem(item, options) {
        var settings = options || {};
        var requestJson = settings.requestJson || function () { return Promise.resolve({}); };
        var buildPostOptions = settings.buildPostOptions || function () { return {}; };
        var archiveCreateApiUrl = settings.archiveCreateApiUrl || "";
        var renderUploadQueue = settings.renderUploadQueue || function () {};
        var applySelection = settings.applySelection || function () {};
        var queueNeedsRefresh = settings.queueNeedsRefresh || function () {};
        var resolveArchiveExtractTargetDir = settings.resolveArchiveExtractTargetDir || function (_entry, targetDirPath) {
            return targetDirPath || "";
        };
        var t = settings.t || function (_, fallbackValue) { return fallbackValue || ""; };
        var entries = Array.isArray(item.entries) ? item.entries.slice() : [];
        var archivedPaths = [];

        if (!archiveCreateApiUrl) {
            throw new Error(t("job_status_failed", "실패"));
        }

        if (item.archiveName && entries.length > 1) {
            if (item.abortRequested) {
                throw new Error(t("queue_cancel", "취소"));
            }
            var multiController = new AbortController();
            item.abortController = multiController;
            var multiData = await requestJson(archiveCreateApiUrl, Object.assign(
                buildPostOptions({
                    source_paths: entries.map(function (entry) {
                        return entry.path;
                    }),
                    archive_name: item.archiveName,
                }),
                { signal: multiController.signal }
            ));
            var multiPaths = multiData && Array.isArray(multiData.paths) ? multiData.paths : [];
            if (multiPaths.length === 0 && multiData && multiData.path) {
                multiPaths = [multiData.path];
            }
            archivedPaths = archivedPaths.concat(multiPaths);
            item.progress = 100;
            item.savedPath = multiPaths[0] || (multiData && multiData.path) || item.targetDirPath || "";
            item.savedSlugPath = multiData && multiData.slug_path ? multiData.slug_path : "";
            item.abortController = null;
            renderUploadQueue();
            applySelection(archivedPaths, {
                primaryPath: archivedPaths[0] || "",
                anchorPath: archivedPaths[0] || "",
                render: false,
            });
            queueNeedsRefresh();
            return;
        }

        for (var index = 0; index < entries.length; index += 1) {
            if (item.abortRequested) {
                throw new Error(t("queue_cancel", "취소"));
            }
            var controller = new AbortController();
            item.abortController = controller;
            var entry = entries[index];
            var data = await requestJson(archiveCreateApiUrl, Object.assign(
                buildPostOptions({
                    source_path: entry.path,
                }),
                { signal: controller.signal }
            ));
            var paths = data && Array.isArray(data.paths) ? data.paths : [];
            if (paths.length === 0 && data && data.path) {
                paths = [data.path];
            }
            archivedPaths = archivedPaths.concat(paths);
            item.progress = ((index + 1) / entries.length) * 100;
            item.savedPath = paths[0] || (data && data.path) || item.targetDirPath || "";
            item.savedSlugPath = data && data.slug_path ? data.slug_path : "";
            item.abortController = null;
            renderUploadQueue();
        }

        applySelection(archivedPaths, {
            primaryPath: archivedPaths[0] || "",
            anchorPath: archivedPaths[0] || "",
            render: false,
        });
        queueNeedsRefresh();
    }

    async function runExtractOperationQueueItem(item, options) {
        var settings = options || {};
        var requestJson = settings.requestJson || function () { return Promise.resolve({}); };
        var buildPostOptions = settings.buildPostOptions || function () { return {}; };
        var archiveExtractApiUrl = settings.archiveExtractApiUrl || "";
        var renderUploadQueue = settings.renderUploadQueue || function () {};
        var applySelection = settings.applySelection || function () {};
        var queueNeedsRefresh = settings.queueNeedsRefresh || function () {};
        var t = settings.t || function (_, fallbackValue) { return fallbackValue || ""; };

        var entries = Array.isArray(item.entries) ? item.entries.slice() : [];
        var totalCount = entries.length;
        var extractedPaths = [];

        if (!archiveExtractApiUrl) {
            throw new Error(t("job_status_failed", "실패"));
        }

        for (var index = 0; index < entries.length; index += 1) {
            if (item.abortRequested) {
                throw new Error(t("queue_cancel", "취소"));
            }
            var controller = new AbortController();
            item.abortController = controller;
            var entry = entries[index];
            var data = await requestJson(archiveExtractApiUrl, Object.assign(
                buildPostOptions({
                    source_path: entry.path,
                    target_dir: resolveArchiveExtractTargetDir(entry, item.targetDirPath),
                    destination_mode: item.destinationMode || "current",
                }),
                { signal: controller.signal }
            ));
            var paths = data && Array.isArray(data.paths) ? data.paths : [];
            if (paths.length === 0 && data && data.path) {
                paths = [data.path];
            }
            extractedPaths = extractedPaths.concat(paths);
            item.progress = ((index + 1) / totalCount) * 100;
            item.savedPath = paths[0] || (data && data.destination_dir) || item.targetDirPath || "";
            item.abortController = null;
            renderUploadQueue();
        }

        applySelection(extractedPaths, {
            primaryPath: extractedPaths[0] || "",
            anchorPath: extractedPaths[0] || "",
            render: false,
        });
        queueNeedsRefresh();
    }

    async function processOperationQueue(options) {
        // Synthetic move/delete jobs share the same queue panel as uploads but run in
        // a dedicated worker so destructive operations stay serialized and inspectable.
        var settings = options || {};
        var state = settings.state || {};
        var renderUploadQueue = settings.renderUploadQueue || function () {};
        var removeUploadQueueItem = settings.removeUploadQueueItem || function () {};
        var runCreateArchiveOperationQueueItem = settings.runCreateArchiveOperationQueueItem || function () { return Promise.resolve(); };
        var runDeleteOperationQueueItem = settings.runDeleteOperationQueueItem || function () { return Promise.resolve(); };
        var runRestoreOperationQueueItem = settings.runRestoreOperationQueueItem || function () { return Promise.resolve(); };
        var runExtractOperationQueueItem = settings.runExtractOperationQueueItem || function () { return Promise.resolve(); };
        var runMoveOperationQueueItem = settings.runMoveOperationQueueItem || function () { return Promise.resolve(); };
        var runYoutubeSaveOperationQueueItem = settings.runYoutubeSaveOperationQueueItem || function () { return Promise.resolve(); };
        var runConvertMp3OperationQueueItem = settings.runConvertMp3OperationQueueItem || function () { return Promise.resolve(); };
        var refreshCurrentDirectory = settings.refreshCurrentDirectory || function () { return Promise.resolve(); };
        var alertError = settings.alertError || function () {};
        var t = settings.t || function (_, fallbackValue) { return fallbackValue || ""; };

        if (state.operationWorkerActive) {
            return;
        }
        state.operationWorkerActive = true;
        try {
            while (true) {
                var nextItem = (state.uploadQueueItems || []).find(function (item) {
                    return item.kind === "operation" && item.status === "queued";
                });
                if (!nextItem) {
                    break;
                }
                nextItem.status = "uploading";
                nextItem.progress = 0;
                nextItem.errorMessage = "";
                renderUploadQueue();
                try {
                    if (nextItem.operationType === "create-archive") {
                        await runCreateArchiveOperationQueueItem(nextItem);
                    } else if (nextItem.operationType === "delete") {
                        await runDeleteOperationQueueItem(nextItem);
                    } else if (nextItem.operationType === "restore") {
                        await runRestoreOperationQueueItem(nextItem);
                    } else if (nextItem.operationType === "extract") {
                        await runExtractOperationQueueItem(nextItem);
                    } else if (nextItem.operationType === "move") {
                        await runMoveOperationQueueItem(nextItem);
                    } else if (nextItem.operationType === "youtube-save") {
                        await runYoutubeSaveOperationQueueItem(nextItem);
                    } else if (nextItem.operationType === "convert-mp3") {
                        await runConvertMp3OperationQueueItem(nextItem);
                    }
                    if (nextItem.abortRequested) {
                        removeUploadQueueItem(nextItem.id);
                        continue;
                    }
                    nextItem.status = "done";
                    nextItem.progress = 100;
                    renderUploadQueue();
                } catch (error) {
                    if (nextItem.abortRequested) {
                        removeUploadQueueItem(nextItem.id);
                        continue;
                    }
                    nextItem.status = "failed";
                    nextItem.errorMessage = error && error.message ? error.message : t("job_status_failed", "실패");
                    renderUploadQueue();
                }
            }
        } finally {
            state.operationWorkerActive = false;
            if (state.uploadRefreshPending) {
                state.uploadRefreshPending = false;
                try {
                    await refreshCurrentDirectory({ skipPreview: true });
                } catch (error) {
                    alertError(error);
                }
            }
            renderUploadQueue();
        }
    }

    function isDirectoryLikeUploadFile(file) {
        if (!file) {
            return false;
        }
        var relativePath = String(file.webkitRelativePath || "");
        return Boolean(relativePath && relativePath.indexOf("/") >= 0);
    }

    async function enqueueUploadFiles(files, targetDirPath, options) {
        // Queue raw File objects first, then let the worker handle transport so drag/drop
        // and picker uploads can reuse the same status UI.
        var settings = options || {};
        var state = settings.state || {};
        var uploadApiUrl = settings.uploadApiUrl || "";
        var normalizePath = settings.normalizePath || function (value) { return value || ""; };
        var renderUploadQueue = settings.renderUploadQueue || function () {};
        var processUploadQueue = settings.processUploadQueue || function () { return Promise.resolve(); };
        var alertError = settings.alertError || function () {};
        var folderUploadErrorMessage = settings.folderUploadErrorMessage || "폴더는 업로드할 수 없습니다. 파일만 업로드해주세요.";
        var hasDirectoryLikeFile = false;

        var fileList = Array.from(files || []).filter(function (file) {
            if (isDirectoryLikeUploadFile(file)) {
                hasDirectoryLikeFile = true;
                return false;
            }
            return Boolean(file);
        });
        if (hasDirectoryLikeFile) {
            alertError(new Error(folderUploadErrorMessage));
            return;
        }
        if (!uploadApiUrl || fileList.length === 0) {
            return;
        }

        var normalizedTargetDir = normalizePath(targetDirPath, true);
        var commitMessage = "";

        fileList.forEach(function (file) {
            state.uploadQueueSequence += 1;
            state.uploadQueueItems.push({
                id: state.uploadQueueSequence,
                file: file,
                fileName: file.name || "untitled",
                fileSize: file.size || 0,
                targetDirPath: normalizedTargetDir,
                status: "queued",
                progress: 0,
                errorMessage: "",
                savedPath: "",
                savedSlugPath: "",
                commitMessage: commitMessage,
                abortRequested: false,
                xhr: null,
                startTime: null,
                uploadSpeed: 0,
                uploadedBytes: 0,
            });
        });
        state.uploadQueueDismissed = false;
        renderUploadQueue();
        processUploadQueue().catch(alertError);
    }

    window.HandriveQueueOperationHelpers = {
        enqueueUploadFiles: enqueueUploadFiles,
        processOperationQueue: processOperationQueue,
        processUploadQueue: processUploadQueue,
        runCreateArchiveOperationQueueItem: runCreateArchiveOperationQueueItem,
        runDeleteOperationQueueItem: runDeleteOperationQueueItem,
        runRestoreOperationQueueItem: runRestoreOperationQueueItem,
        runExtractOperationQueueItem: runExtractOperationQueueItem,
        runMoveOperationQueueItem: runMoveOperationQueueItem,
    };
})();
