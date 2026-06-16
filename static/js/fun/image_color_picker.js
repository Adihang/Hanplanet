(function () {
    "use strict";

    var root = document.querySelector("[data-image-color-picker]");
    if (!root) return;

    var stage = root.querySelector("[data-image-color-picker-dropzone]");
    var image = root.querySelector("[data-image-color-picker-image]");
    var clearButton = root.querySelector("[data-image-color-picker-clear]");
    var emptyState = root.querySelector("[data-image-color-picker-empty]");
    var crosshair = root.querySelector("[data-image-color-picker-crosshair]");
    var canvas = root.querySelector("[data-image-color-picker-canvas]");
    var statusEl = root.querySelector("[data-image-color-picker-status]");
    var urlForm = root.querySelector("[data-image-color-picker-url-form]");
    var urlInput = root.querySelector("[data-image-color-picker-url]");
    var fileInput = root.querySelector("[data-image-color-picker-file]");
    var fileOpenButton = root.querySelector("[data-image-color-picker-file-open]");
    var urlSubmitButton = root.querySelector("[data-image-color-picker-url-submit]");
    var swatch = root.querySelector("[data-image-color-picker-swatch]");
    var valueNodes = {
        hex: root.querySelector('[data-image-color-picker-value="hex"]'),
        rgb: root.querySelector('[data-image-color-picker-value="rgb"]'),
        hsv: root.querySelector('[data-image-color-picker-value="hsv"]'),
    };
    var copyButtons = root.querySelectorAll("[data-image-color-picker-copy]");
    var sourceModal = document.querySelector("[data-upload-source-modal]");
    var sourceLocalButton = sourceModal ? sourceModal.querySelector("[data-upload-source-local]") : null;
    var sourceHandriveButton = sourceModal ? sourceModal.querySelector("[data-upload-source-handrive]") : null;
    var sourceCloseButton = sourceModal ? sourceModal.querySelector("[data-upload-source-close]") : null;
    var modal = document.querySelector("[data-media-handrive-picker-modal]");
    var handriveCloseButton = modal ? modal.querySelector("[data-media-handrive-picker-close]") : null;
    var handriveList = modal ? modal.querySelector("[data-media-handrive-picker-list]") : null;
    var handriveStatus = modal ? modal.querySelector("[data-media-handrive-picker-status]") : null;
    var context = canvas ? canvas.getContext("2d", { willReadFrequently: true }) : null;
    var handrivePageHelpers = window.HandrivePageHelpers || {};
    var handriveListRenderHelpers = window.HandriveListRenderHelpers || {};
    var buildBaseTreePrefixElement = handriveListRenderHelpers.buildTreePrefixElement || buildFallbackTreePrefixElement;
    var createBaseTypeMarker = handriveListRenderHelpers.createTypeMarker || createFallbackTypeMarker;
    var getFileIconKey = handrivePageHelpers.getFileIconKey || function () { return "image"; };
    var isGenericFileIconKey = handrivePageHelpers.isGenericFileIconKey || function () { return true; };

    var fetchUrl = root.dataset.fetchUrl || "";
    var handriveEnabled = root.dataset.handriveEnabled === "1";
    var handriveListUrl = root.dataset.handriveListUrl || "";
    var handriveDownloadUrl = root.dataset.handriveDownloadUrl || "";
    var imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico"]);
    var imageMimeTypes = new Set([
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/gif",
        "image/webp",
        "image/bmp",
        "image/x-icon",
        "image/vnd.microsoft.icon",
    ]);
    var maxClientImageBytes = 50 * 1024 * 1024;
    var state = {
        imageReady: false,
        objectUrl: "",
        handrivePath: "",
        handriveRootPath: "",
        handriveEntriesByPath: new Map(),
        handriveExpandedPaths: new Set(),
        handriveLoadingPaths: new Set(),
        urlController: null,
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
        var input = urlForm ? urlForm.querySelector('input[name="csrfmiddlewaretoken"]') : null;
        if (input && input.value) return input.value;
        var meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.getAttribute("content") || "" : "";
    }

    function setStatus(target, text, isError) {
        if (!target) return;
        target.textContent = text || "";
        target.classList.toggle("is-error", Boolean(isError));
    }

    function setMainStatus(text, isError) {
        setStatus(statusEl, text, isError);
    }

    function setBusy(isBusy) {
        if (urlSubmitButton) urlSubmitButton.disabled = Boolean(isBusy);
        if (fileOpenButton) fileOpenButton.disabled = Boolean(isBusy);
    }

    function getPathExtension(pathValue) {
        var name = String(pathValue || "").split("?")[0].split("#")[0].split("/").pop() || "";
        var dotIndex = name.lastIndexOf(".");
        if (dotIndex <= 0) return "";
        return name.slice(dotIndex).toLowerCase();
    }

    function isImageName(pathValue) {
        return imageExtensions.has(getPathExtension(pathValue));
    }

    function isAcceptedFile(file) {
        if (!file) return false;
        var type = String(file.type || "").toLowerCase();
        if (type && imageMimeTypes.has(type)) return true;
        return isImageName(file.name || "");
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

    function guessMimeType(pathValue) {
        return {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".webp": "image/webp",
            ".bmp": "image/bmp",
            ".ico": "image/x-icon",
        }[getPathExtension(pathValue)] || "image/png";
    }

    function revokeCurrentObjectUrl(nextObjectUrl) {
        if (state.objectUrl && state.objectUrl !== nextObjectUrl) {
            URL.revokeObjectURL(state.objectUrl);
        }
        state.objectUrl = nextObjectUrl || "";
    }

    function setImageVisible(visible) {
        if (image) image.hidden = !visible;
        if (clearButton) clearButton.hidden = !visible;
        if (emptyState) emptyState.hidden = visible;
        if (stage) stage.classList.toggle("has-image", Boolean(visible));
    }

    function resetImageToEmptyState() {
        if (state.urlController) {
            state.urlController.abort();
            state.urlController = null;
        }
        state.imageReady = false;
        revokeCurrentObjectUrl("");
        if (image) {
            image.onload = null;
            image.onerror = null;
            image.removeAttribute("src");
            image.hidden = true;
        }
        if (crosshair) {
            crosshair.hidden = true;
        }
        if (canvas && context) {
            context.clearRect(0, 0, canvas.width, canvas.height);
            canvas.width = 0;
            canvas.height = 0;
        }
        setImageVisible(false);
        setBusy(false);
    }

    function clearLoadedImage() {
        resetImageToEmptyState();
        setMainStatus(message("statusReady", "Ready"), false);
        if (fileOpenButton) fileOpenButton.focus();
    }

    function componentToHex(value) {
        var hex = Math.max(0, Math.min(255, value)).toString(16);
        return hex.length === 1 ? "0" + hex : hex;
    }

    function rgbToHex(r, g, b) {
        return ("#" + componentToHex(r) + componentToHex(g) + componentToHex(b)).toUpperCase();
    }

    function trimNumber(value) {
        return String(Math.round(value * 100) / 100);
    }

    function rgbToHsv(r, g, b) {
        var rAbs = r / 255;
        var gAbs = g / 255;
        var bAbs = b / 255;
        var value = Math.max(rAbs, gAbs, bAbs);
        var diff = value - Math.min(rAbs, gAbs, bAbs);
        var hue = 0;
        var saturation = value === 0 ? 0 : diff / value;

        if (diff !== 0) {
            if (value === rAbs) {
                hue = (gAbs - bAbs) / diff + (gAbs < bAbs ? 6 : 0);
            } else if (value === gAbs) {
                hue = (bAbs - rAbs) / diff + 2;
            } else {
                hue = (rAbs - gAbs) / diff + 4;
            }
            hue /= 6;
        }

        return {
            h: Math.round(hue * 360),
            s: trimNumber(saturation * 100),
            v: trimNumber(value * 100),
        };
    }

    function updateResult(r, g, b) {
        var hex = rgbToHex(r, g, b);
        var hsv = rgbToHsv(r, g, b);
        if (valueNodes.hex) valueNodes.hex.textContent = hex;
        if (valueNodes.rgb) valueNodes.rgb.textContent = "rgb(" + r + "," + g + "," + b + ")";
        if (valueNodes.hsv) valueNodes.hsv.textContent = hsv.h + "\u00b0 " + hsv.s + "% " + hsv.v + "%";
        if (swatch) swatch.style.backgroundColor = hex;
    }

    function drawImageToCanvas() {
        if (!canvas || !context || !image || !image.naturalWidth || !image.naturalHeight) {
            throw new Error("canvas unavailable");
        }
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
    }

    function loadImageSource(source, options) {
        var settings = options || {};
        var nextObjectUrl = settings.objectUrl || "";
        return new Promise(function (resolve, reject) {
            if (!image || !source) {
                reject(new Error("missing image"));
                return;
            }
            state.imageReady = false;
            setImageVisible(false);
            if (crosshair) crosshair.hidden = true;
            setMainStatus(message("statusLoading", "Loading image..."), false);
            setBusy(true);

            image.onload = function () {
                try {
                    drawImageToCanvas();
                    revokeCurrentObjectUrl(nextObjectUrl);
                    state.imageReady = true;
                    setImageVisible(true);
                    setMainStatus(message("statusLoaded", "Image loaded."), false);
                    resolve();
                } catch (error) {
                    if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
                    state.imageReady = false;
                    setImageVisible(false);
                    setMainStatus(message("statusCanvasFailed", "This image cannot be sampled by the browser."), true);
                    reject(error);
                } finally {
                    setBusy(false);
                }
            };

            image.onerror = function () {
                if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
                state.imageReady = false;
                setImageVisible(false);
                setMainStatus(message("statusLoadFailed", "Could not load this image."), true);
                setBusy(false);
                reject(new Error("image load failed"));
            };

            image.removeAttribute("src");
            image.src = source;
        });
    }

    function loadFile(file) {
        if (!isAcceptedFile(file) || file.size > maxClientImageBytes) {
            setMainStatus(message("statusInvalidFile", "Use an image file."), true);
            return;
        }
        var objectUrl = URL.createObjectURL(file);
        loadImageSource(objectUrl, { objectUrl: objectUrl }).catch(function () {});
    }

    function getRenderedImageRect() {
        if (!image || !image.naturalWidth || !image.naturalHeight) return null;
        var rect = image.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        var scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
        var width = image.naturalWidth * scale;
        var height = image.naturalHeight * scale;
        return {
            left: rect.left + (rect.width - width) / 2,
            top: rect.top + (rect.height - height) / 2,
            right: rect.left + (rect.width + width) / 2,
            bottom: rect.top + (rect.height + height) / 2,
            width: width,
            height: height,
        };
    }

    function getImageCoordinates(event) {
        if (!image || !state.imageReady) return null;
        var rect = getRenderedImageRect();
        if (!rect || !rect.width || !rect.height) return null;
        var clientX = event.clientX;
        var clientY = event.clientY;
        if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
            return null;
        }
        var x = Math.floor(((clientX - rect.left) / rect.width) * image.naturalWidth);
        var y = Math.floor(((clientY - rect.top) / rect.height) * image.naturalHeight);
        x = Math.max(0, Math.min(image.naturalWidth - 1, x));
        y = Math.max(0, Math.min(image.naturalHeight - 1, y));
        return { x: x, y: y };
    }

    function moveCrosshair(event) {
        if (!crosshair || !stage || !state.imageReady) return;
        var coords = getImageCoordinates(event);
        if (!coords) {
            crosshair.hidden = true;
            return;
        }
        var stageRect = stage.getBoundingClientRect();
        crosshair.style.left = String(event.clientX - stageRect.left) + "px";
        crosshair.style.top = String(event.clientY - stageRect.top) + "px";
        crosshair.hidden = false;
    }

    function pickColor(event) {
        var coords = getImageCoordinates(event);
        if (!coords || !context) return;
        try {
            var pixel = context.getImageData(coords.x, coords.y, 1, 1).data;
            updateResult(pixel[0], pixel[1], pixel[2]);
            setMainStatus(message("statusPick", "Color picked"), false);
        } catch (error) {
            setMainStatus(message("statusCanvasFailed", "This image cannot be sampled by the browser."), true);
        }
    }

    function loadUrlImage(event) {
        event.preventDefault();
        var value = urlInput ? String(urlInput.value || "").trim() : "";
        if (!value) {
            resetImageToEmptyState();
            setMainStatus(message("statusEmptyUrl", "Enter an image URL."), true);
            if (urlInput) urlInput.focus();
            return;
        }
        if (!fetchUrl) return;
        if (state.urlController) state.urlController.abort();
        var controller = new AbortController();
        state.urlController = controller;
        setMainStatus(message("statusLoading", "Loading image..."), false);
        setBusy(true);
        fetch(fetchUrl, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": getCsrfToken(),
            },
            body: JSON.stringify({ url: value }),
            signal: controller.signal,
        })
            .then(function (response) {
                return response.json().catch(function () {
                    return { ok: false, error: message("statusLoadFailed", "Could not load this image.") };
                });
            })
            .then(function (data) {
                if (!data || data.ok === false || !data.image) {
                    throw new Error(selectServerMessage(data, message("statusLoadFailed", "Could not load this image.")));
                }
                return loadImageSource(data.image);
            })
            .catch(function (error) {
                if (error && error.name === "AbortError") return;
                setMainStatus(error && error.message ? error.message : message("statusLoadFailed", "Could not load this image."), true);
                setBusy(false);
            })
            .finally(function () {
                if (state.urlController === controller) state.urlController = null;
            });
    }

    function copyText(value) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(value);
        }
        return new Promise(function (resolve, reject) {
            var textarea = document.createElement("textarea");
            textarea.value = value;
            textarea.setAttribute("readonly", "readonly");
            textarea.style.position = "fixed";
            textarea.style.left = "-9999px";
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand("copy");
                resolve();
            } catch (error) {
                reject(error);
            } finally {
                textarea.remove();
            }
        });
    }

    function handleCopy(event) {
        var key = event.currentTarget.getAttribute("data-image-color-picker-copy");
        var node = valueNodes[key];
        var value = node ? node.textContent || "" : "";
        if (!value) return;
        copyText(value).then(function () {
            setMainStatus(message("statusCopied", "Copied"), false);
        }).catch(function () {});
    }

    function setModalOpen(open) {
        if (!modal) return;
        modal.hidden = !open;
        if (open && handriveCloseButton) {
            handriveCloseButton.focus();
        }
    }

    function setSourceModalOpen(open) {
        if (!sourceModal) return;
        sourceModal.hidden = !open;
        if (open && sourceLocalButton) {
            sourceLocalButton.focus();
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
        prefix.className = "media-handrive-picker-tree-prefix";
        prefix.setAttribute("aria-hidden", "true");
        (ancestorHasNextSiblings || []).forEach(function (hasNextSibling) {
            var segment = document.createElement("span");
            segment.className = "media-handrive-picker-tree-segment" + (hasNextSibling ? " has-next" : "");
            prefix.appendChild(segment);
        });
        var branch = document.createElement("span");
        branch.className = "media-handrive-picker-tree-segment media-handrive-picker-tree-branch " + (isLastSibling ? "is-last" : "is-middle");
        prefix.appendChild(branch);
        if (!(ancestorHasNextSiblings || []).length) {
            prefix.classList.add("is-root-depth");
        }
        return prefix;
    }

    function createPickerTreePrefixElement(ancestorHasNextSiblings, isLastSibling) {
        var prefix = buildBaseTreePrefixElement(ancestorHasNextSiblings || [], Boolean(isLastSibling));
        if (!prefix) return buildFallbackTreePrefixElement(ancestorHasNextSiblings, isLastSibling);
        prefix.classList.remove("handrive-item-tree-prefix");
        prefix.classList.add("media-handrive-picker-tree-prefix");
        Array.prototype.forEach.call(prefix.querySelectorAll(".handrive-tree-segment"), function (segment) {
            segment.classList.remove("handrive-tree-segment");
            segment.classList.add("media-handrive-picker-tree-segment");
            if (segment.classList.contains("handrive-tree-branch")) {
                segment.classList.remove("handrive-tree-branch");
                segment.classList.add("media-handrive-picker-tree-branch");
            }
        });
        return prefix;
    }

    function createFallbackTypeMarker(options) {
        var settings = options || {};
        var marker = document.createElement("span");
        marker.className = "media-handrive-picker-icon " + (settings.isDir ? "is-dir" : "is-file");
        if (settings.isGoogleDrive) marker.classList.add("is-google-drive");
        else if (settings.isGithubRepo) marker.classList.add("is-github-repo");
        else if (settings.isRepo) marker.classList.add("is-repo");
        else if (settings.isBranch) marker.classList.add("is-branch");
        else if (settings.isEmpty) marker.classList.add("is-empty");
        if (!settings.isDir) {
            marker.classList.add("is-generic");
            marker.dataset.fileIcon = settings.fileIconKey || "image";
        }
        return marker;
    }

    function createPickerTypeMarker(options) {
        var marker = createBaseTypeMarker(options || {});
        if (!marker) return createFallbackTypeMarker(options);
        marker.classList.remove("handrive-item-type-icon");
        marker.classList.add("media-handrive-picker-icon");
        Array.prototype.forEach.call(marker.querySelectorAll(".handrive-folder-custom-icon"), function (customIcon) {
            customIcon.classList.remove("handrive-folder-custom-icon");
            customIcon.classList.add("media-handrive-picker-folder-custom-icon");
        });
        return marker;
    }

    function createHandriveTypeIcon(entry) {
        var isDir = entry && entry.type === "dir";
        var fileIconKey = isDir ? "" : getFileIconKey(entry.path || entry.name || "");
        return createPickerTypeMarker({
            isDir: isDir,
            isGoogleDrive: isDir && entry && (entry.is_google_drive || entry.google_drive),
            isGithubRepo: isDir && entry && entry.github_repo,
            isRepo: isDir && entry && entry.git_repo,
            isBranch: isDir && entry && entry.git_branch_root,
            isMap: isDir && entry && entry.is_map_folder,
            isEmpty: isDir && entry && entry.has_children === false,
            fileIconKey: fileIconKey || "image",
            isGenericFileIcon: !isDir && isGenericFileIconKey(fileIconKey || "image"),
            customIconUrl: isDir && entry && entry.folder_icon_url ? entry.folder_icon_url : "",
        });
    }

    function createHandriveRow(entry, ancestorHasNextSiblings, isLastSibling) {
        var item = document.createElement("li");
        item.className = "media-handrive-picker-item";
        var row = document.createElement("button");
        row.type = "button";
        row.className = "media-handrive-picker-row has-tree-prefix";
        row.setAttribute("data-entry-path", entry && entry.path ? entry.path : "");
        var isDir = entry && entry.type === "dir";
        if (isDir) {
            row.setAttribute("aria-expanded", state.handriveExpandedPaths.has(normalizeHandrivePath(entry.path)) ? "true" : "false");
        }
        var icon = createHandriveTypeIcon(entry);
        var nameWrap = document.createElement("span");
        nameWrap.className = "media-handrive-picker-name-wrap";
        var name = document.createElement("span");
        name.className = "media-handrive-picker-name";
        name.textContent = String(entry.name || entry.path || "");
        nameWrap.appendChild(name);
        var action = document.createElement("span");
        action.className = "media-handrive-picker-meta-label media-handrive-picker-action";
        action.textContent = isDir
            ? message("handriveOpenFolderLabel", "Open folder")
            : message("handriveSelectFileLabel", "Select image");
        row.appendChild(icon);
        row.appendChild(nameWrap);
        row.appendChild(action);
        row.addEventListener("click", function (event) {
            event.preventDefault();
            if (isDir) {
                toggleHandriveFolder(entry);
                return;
            }
            loadHandriveImage(entry);
        });
        item.appendChild(createPickerTreePrefixElement(ancestorHasNextSiblings || [], Boolean(isLastSibling)));
        item.appendChild(row);
        return item;
    }

    function appendHandriveEmptyRow(fragment, ancestorHasNextSiblings, isLastSibling, text) {
        var item = document.createElement("li");
        item.className = "media-handrive-picker-item";
        var empty = document.createElement("div");
        empty.className = "media-handrive-picker-row is-empty" + (ancestorHasNextSiblings ? " has-tree-prefix" : "");
        if (ancestorHasNextSiblings) {
            item.appendChild(createPickerTreePrefixElement(ancestorHasNextSiblings, Boolean(isLastSibling)));
        }
        var label = document.createElement("span");
        label.className = "media-handrive-picker-empty-label";
        label.textContent = text || message("handriveEmptyLabel", "No images in this folder.");
        empty.appendChild(label);
        item.appendChild(empty);
        fragment.appendChild(item);
    }

    function filterHandriveEntries(entries) {
        return (entries || []).filter(function (entry) {
            return entry && (entry.type === "dir" || (entry.type === "file" && isImageName(entry.name || entry.path)));
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
        setStatus(handriveStatus, message("handriveLoadingLabel", "Loading..."), false);
        return fetch(buildApiUrl(handriveListUrl, { path: normalizedPath, scope_home: "1" }), {
            credentials: "same-origin",
            signal: controller.signal,
        })
            .then(function (response) {
                return response.json().catch(function () {
                    return { ok: false, error: message("statusLoadFailed", "Could not load this image.") };
                });
            })
            .then(function (data) {
                if (!data || data.ok === false) {
                    throw new Error(selectServerMessage(data, message("statusLoadFailed", "Could not load this image.")));
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
                setStatus(handriveStatus, "", false);
            })
            .catch(function (error) {
                if (error && error.name === "AbortError") return;
                setStatus(handriveStatus, error && error.message ? error.message : message("statusLoadFailed", "Could not load this image."), true);
            })
            .finally(function () {
                state.handriveLoadingPaths.delete(normalizedPath);
                if (state.handriveController === controller) state.handriveController = null;
                renderHandriveTree();
            });
    }

    function loadHandriveImage(entry) {
        if (!entry || !entry.path || !handriveDownloadUrl) return;
        setModalOpen(false);
        setMainStatus(message("statusLoading", "Loading image..."), false);
        setBusy(true);
        fetch(buildApiUrl(handriveDownloadUrl, { path: entry.path, scope_home: "1" }), {
            credentials: "same-origin",
        })
            .then(function (response) {
                if (!response.ok || response.redirected) {
                    throw new Error(message("statusLoadFailed", "Could not load this image."));
                }
                return response.blob();
            })
            .then(function (blob) {
                if (!blob || !blob.size) {
                    throw new Error(message("statusLoadFailed", "Could not load this image."));
                }
                var type = blob.type && blob.type.indexOf("image/") === 0 ? blob.type : guessMimeType(entry.name || entry.path);
                var imageBlob = blob.type === type ? blob : blob.slice(0, blob.size, type);
                var objectUrl = URL.createObjectURL(imageBlob);
                return loadImageSource(objectUrl, { objectUrl: objectUrl });
            })
            .catch(function (error) {
                setMainStatus(error && error.message ? error.message : message("statusLoadFailed", "Could not load this image."), true);
                setBusy(false);
            });
    }

    if (urlForm) {
        urlForm.addEventListener("submit", loadUrlImage);
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
            setModalOpen(true);
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
    if (image) {
        image.addEventListener("mousemove", moveCrosshair);
        image.addEventListener("mouseenter", moveCrosshair);
        image.addEventListener("mouseleave", function () {
            if (crosshair) crosshair.hidden = true;
        });
        image.addEventListener("click", pickColor);
    }
    if (clearButton) {
        clearButton.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            clearLoadedImage();
        });
    }
    copyButtons.forEach(function (button) {
        button.addEventListener("click", handleCopy);
    });
    if (handriveCloseButton) {
        handriveCloseButton.addEventListener("click", function () {
            setModalOpen(false);
        });
    }
    if (modal) {
        modal.addEventListener("click", function (event) {
            if (event.target === modal) {
                setModalOpen(false);
            }
        });
    }
    if (sourceModal) {
        sourceModal.addEventListener("click", function (event) {
            if (event.target === sourceModal) {
                setSourceModalOpen(false);
            }
        });
    }
    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && sourceModal && !sourceModal.hidden) {
            setSourceModalOpen(false);
            return;
        }
        if (event.key === "Escape" && modal && !modal.hidden) {
            setModalOpen(false);
        }
    });
    window.addEventListener("beforeunload", function () {
        revokeCurrentObjectUrl("");
    });
})();
