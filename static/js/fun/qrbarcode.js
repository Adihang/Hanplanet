(function () {
    "use strict";

    var form = document.querySelector("[data-qrbarcode-form]");
    if (!form) return;

    var valueInput = form.querySelector('textarea[name="value"]');
    var barcodeKindField = form.querySelector("[data-qrbarcode-barcode-kind-field]");
    var barcodeKindSelect = form.querySelector("[data-qrbarcode-barcode-kind]");
    var statusEl = document.querySelector("[data-qrbarcode-status]");
    var preview = document.querySelector("[data-qrbarcode-preview]");
    var previewFrame = document.querySelector("[data-qrbarcode-preview-frame]");
    var previewImage = document.querySelector("[data-qrbarcode-image]");
    var copyButton = document.querySelector("[data-qrbarcode-copy]");
    var downloadJpegButton = document.querySelector("[data-qrbarcode-download-jpeg]");
    var downloadPngButton = document.querySelector("[data-qrbarcode-download-png]");
    var generateUrl = form.dataset.generateUrl || "";
    var emptyMessage = form.dataset.emptyMessage || "Enter a value.";
    var invalidUrlMessage = form.dataset.invalidUrlMessage || "Enter a valid URL.";
    var failedMessage = form.dataset.failedMessage || "Generation failed.";
    var copiedMessage = form.dataset.copiedMessage || "Copied.";
    var copyLabel = copyButton ? copyButton.textContent : "";
    var currentImage = "";
    var currentFilename = "hanplanet-code.png";
    var generateTimer = null;
    var generateController = null;
    var pipSession = null;

    function getCsrfToken() {
        var input = form.querySelector('input[name="csrfmiddlewaretoken"]');
        if (input && input.value) return input.value;
        var meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.getAttribute("content") || "" : "";
    }

    function getCheckedValue(name, fallback) {
        var checked = form.querySelector('input[name="' + name + '"]:checked');
        return checked ? checked.value : fallback;
    }

    function setStatus(message, isError) {
        if (!statusEl) return;
        statusEl.textContent = message || "";
        statusEl.classList.toggle("is-error", Boolean(isError));
    }

    function selectServerMessage(payload, fallback) {
        if (!payload || typeof payload !== "object") return fallback || "";
        var lang = (document.documentElement.getAttribute("lang") || "").toLowerCase().indexOf("en") === 0 ? "en" : "ko";
        var messages = payload.error_messages || payload.messages;
        if (messages && typeof messages === "object") {
            return messages[lang] || messages.ko || messages.en || fallback || "";
        }
        return payload.error_message || payload.message || payload.error || fallback || "";
    }

    function updatePlaceholder() {
        if (!valueInput) return;
        var inputKind = getCheckedValue("input_kind", "url");
        var codeKind = getCheckedValue("code_kind", "qr");
        var barcodeKind = barcodeKindSelect ? barcodeKindSelect.value : "code128";
        if (codeKind === "barcode") {
            valueInput.placeholder = {
                ean: "5901234123457",
                code39: "HANPLANET-123",
                itf: "123456",
                codabar: "A123456A",
                code128: "https://www.hanplanet.com/",
            }[barcodeKind] || "Text";
            valueInput.inputMode = barcodeKind === "ean" || barcodeKind === "itf" ? "numeric" : "text";
            return;
        }
        valueInput.placeholder = inputKind === "url" ? "https://www.hanplanet.com/" : "Text";
        valueInput.inputMode = inputKind === "url" ? "url" : "text";
    }

    function updateBarcodeKindVisibility() {
        var isBarcode = getCheckedValue("code_kind", "qr") === "barcode";
        if (barcodeKindField) barcodeKindField.hidden = !isBarcode;
        updatePlaceholder();
    }

    function isEnglishUi() {
        return String(document.documentElement.lang || "").toLowerCase().indexOf("en") === 0;
    }

    function localizedMessage(english, korean) {
        return isEnglishUi() ? english : korean;
    }

    function barcodeValidationMessage(barcodeKind) {
        if (isEnglishUi()) {
            return {
                ean: "EAN accepts only 12 or 13 digits.",
                code39: "CODE39 accepts English letters, numbers, spaces, and these symbols: . $ / + % -",
                itf: "ITF accepts only numbers.",
                codabar: "CODABAR accepts numbers, A-D, and these symbols: - $ : / . +",
                code128: "CODE128 accepts English letters, numbers, and common symbols. Korean text is not supported.",
            }[barcodeKind] || "Enter a valid value for this barcode type.";
        }
        return {
            ean: "EAN은 숫자 12자리 또는 13자리만 입력할 수 있습니다.",
            code39: "CODE39는 영문, 숫자, 공백과 . $ / + % - 기호만 입력할 수 있습니다.",
            itf: "ITF는 숫자만 입력할 수 있습니다.",
            codabar: "CODABAR는 숫자, A-D와 - $ : / . + 기호만 입력할 수 있습니다.",
            code128: "CODE128은 영문, 숫자, 일반 기호만 입력할 수 있습니다. 한글은 지원하지 않습니다.",
        }[barcodeKind] || "선택한 바코드 종류에 맞는 내용을 입력해주세요.";
    }

    function normalizeUrlValue(value) {
        var normalized = value;
        if (/\s/.test(normalized)) return "";
        if (normalized && !/^https?:\/\//i.test(normalized)) {
            normalized = "https://" + normalized;
        }
        try {
            var parsed = new URL(normalized);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
            if (!parsed.host) return "";
            if (parsed.hostname === "localhost") return normalized;
            if (/^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.hostname)) {
                var parts = parsed.hostname.split(".");
                return parts.every(function (part) {
                    var number = Number(part);
                    return number >= 0 && number <= 255;
                }) ? normalized : "";
            }
            if (parsed.hostname.indexOf(":") !== -1) return normalized;
            if (parsed.hostname.indexOf(".") === -1) return "";
        } catch (error) {
            return "";
        }
        return normalized;
    }

    function normalizeBarcodeValue(barcodeKind, value) {
        var normalized = String(value || "").trim();
        if (barcodeKind === "code39" || barcodeKind === "codabar") {
            normalized = normalized.toUpperCase();
        }
        if (barcodeKind === "codabar" && normalized && !/^[A-D]/.test(normalized)) {
            normalized = "A" + normalized + "A";
        }
        return normalized;
    }

    function isValidBarcodeValue(barcodeKind, value) {
        return {
            ean: /^\d{12,13}$/.test(value) && value.length <= 13,
            code39: /^[0-9A-Z .$/+%-]+$/i.test(value) && value.length <= 80,
            itf: /^\d+$/.test(value) && value.length <= 80,
            codabar: /^[0-9A-D\-$:/.+]+$/i.test(value) && value.length <= 80,
            code128: /^[\x20-\x7e]+$/.test(value) && value.length <= 256,
        }[barcodeKind] === true;
    }

    function validateGenerateValue(rawValue) {
        var inputKind = getCheckedValue("input_kind", "url");
        var codeKind = getCheckedValue("code_kind", "qr");
        var barcodeKind = barcodeKindSelect ? barcodeKindSelect.value : "code128";
        var value = String(rawValue || "").trim();
        if (!value) return { ok: false, error: emptyMessage };
        if (inputKind === "url" && (codeKind !== "barcode" || barcodeKind === "code128")) {
            if (value.length > 2048) return { ok: false, error: failedMessage };
            value = normalizeUrlValue(value);
            if (!value) return { ok: false, error: invalidUrlMessage };
        } else if (value.length > 4096) {
            return { ok: false, error: failedMessage };
        }
        if (codeKind === "barcode") {
            value = normalizeBarcodeValue(barcodeKind, value);
            if (!isValidBarcodeValue(barcodeKind, value)) {
                return { ok: false, error: barcodeValidationMessage(barcodeKind) };
            }
        }
        return { ok: true, value: value, codeKind: codeKind, inputKind: inputKind, barcodeKind: barcodeKind };
    }

    function renderResult(data) {
        currentImage = data.image || "";
        currentFilename = data.filename || "hanplanet-code.png";
        if (previewImage) previewImage.src = currentImage;
        if (preview) preview.hidden = !currentImage;
        if (copyButton) copyButton.textContent = copyLabel;
        setStatus("", false);
    }

    function generate() {
        var validation = validateGenerateValue(valueInput ? valueInput.value : "");
        if (!validation.ok) {
            if (generateController) generateController.abort();
            generateController = null;
            setStatus(validation.error || emptyMessage, true);
            if (valueInput) valueInput.focus();
            return;
        }
        if (generateController) generateController.abort();
        var controller = new AbortController();
        generateController = controller;
        setStatus("", false);
        fetch(generateUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": getCsrfToken(),
            },
            body: JSON.stringify({
                input_kind: validation.inputKind,
                code_kind: validation.codeKind,
                barcode_kind: validation.barcodeKind,
                value: validation.value,
            }),
            signal: controller.signal,
        })
            .then(function (response) {
                return response.json().catch(function () {
                    return { ok: false, error: failedMessage };
                });
            })
            .then(function (data) {
                if (!data || data.ok === false) {
                    throw new Error(selectServerMessage(data, failedMessage));
                }
                renderResult(data);
            })
            .catch(function (error) {
                if (error && error.name === "AbortError") return;
                setStatus(error && error.message ? error.message : failedMessage, true);
            })
            .finally(function () {
                if (generateController === controller) generateController = null;
            });
    }

    function scheduleGenerate(delay) {
        if (generateTimer) window.clearTimeout(generateTimer);
        generateTimer = window.setTimeout(function () {
            generateTimer = null;
            generate();
        }, delay);
    }

    function submit(event) {
        event.preventDefault();
        scheduleGenerate(0);
    }

    function filenameWithExtension(extension) {
        var cleanExtension = String(extension || "png").replace(/^\./, "");
        var base = String(currentFilename || "hanplanet-code.png").replace(/\.[^.]+$/, "");
        return base + "." + cleanExtension;
    }

    function loadImage(dataUrl) {
        return new Promise(function (resolve, reject) {
            var image = new Image();
            image.onload = function () {
                resolve(image);
            };
            image.onerror = reject;
            image.src = dataUrl;
        });
    }

    function makeDownloadImage(format) {
        return loadImage(currentImage).then(function (image) {
            var canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth || image.width;
            canvas.height = image.naturalHeight || image.height;
            var context = canvas.getContext("2d");
            if (!context) return currentImage;
            if (format === "jpeg") {
                context.fillStyle = "#fff";
                context.fillRect(0, 0, canvas.width, canvas.height);
                context.drawImage(image, 0, 0);
                return canvas.toDataURL("image/jpeg", 0.92);
            }
            context.drawImage(image, 0, 0);
            var imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            var pixels = imageData.data;
            for (var i = 0; i < pixels.length; i += 4) {
                var luminance = (pixels[i] * 0.2126) + (pixels[i + 1] * 0.7152) + (pixels[i + 2] * 0.0722);
                var alpha = Math.max(0, Math.min(255, Math.round(255 - luminance)));
                if (alpha < 8) alpha = 0;
                pixels[i] = 0;
                pixels[i + 1] = 0;
                pixels[i + 2] = 0;
                pixels[i + 3] = alpha;
            }
            context.putImageData(imageData, 0, 0);
            return canvas.toDataURL("image/png");
        });
    }

    function downloadDataUrl(dataUrl, filename) {
        if (!dataUrl) return;
        if (!currentImage) return;
        var link = document.createElement("a");
        link.href = dataUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    function downloadCurrent(format) {
        if (!currentImage) return;
        var normalizedFormat = format === "jpeg" ? "jpeg" : "png";
        makeDownloadImage(normalizedFormat).then(function (dataUrl) {
            downloadDataUrl(dataUrl, filenameWithExtension(normalizedFormat === "jpeg" ? "jpg" : "png"));
        }).catch(function () {
            downloadDataUrl(currentImage, filenameWithExtension("png"));
        });
    }

    function closePipSession() {
        if (!pipSession) return;
        var session = pipSession;
        pipSession = null;
        if (session.frameTimer) window.clearInterval(session.frameTimer);
        if (session.frameRequest) window.cancelAnimationFrame(session.frameRequest);
        if (session.video) {
            try {
                session.video.srcObject = null;
                session.video.removeAttribute("src");
                session.video.load();
            } catch (error) {
                // ignore cleanup failures on detached mobile video layers
            }
        }
        if (session.stream) {
            session.stream.getTracks().forEach(function (track) {
                track.stop();
            });
        }
        if (session.video) session.video.remove();
    }

    function createManualCanvasStream(canvas, fallbackFrameRate) {
        var stream = canvas.captureStream(0);
        var track = stream.getVideoTracks()[0] || null;
        if (track && typeof track.requestFrame === "function") {
            return { stream: stream, track: track };
        }
        stream.getTracks().forEach(function (streamTrack) {
            streamTrack.stop();
        });
        stream = canvas.captureStream(fallbackFrameRate || 1);
        track = stream.getVideoTracks()[0] || null;
        return { stream: stream, track: track };
    }

    function requestCanvasStreamFrame(session) {
        var track = session && session.track;
        if (track && typeof track.requestFrame === "function") {
            try {
                track.requestFrame();
            } catch (error) {
                // Some mobile browsers throw while a tab is backgrounding.
            }
        }
    }

    function openImagePictureInPicture() {
        if (!previewImage || !currentImage) {
            return Promise.reject(new Error(localizedMessage("Could not find an image to show in PiP.", "PiP로 띄울 이미지를 찾을 수 없습니다.")));
        }
        if (!document.pictureInPictureEnabled || typeof HTMLCanvasElement === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") {
            return Promise.reject(new Error(localizedMessage("This browser does not support image PiP.", "이 브라우저는 이미지 PiP를 지원하지 않습니다.")));
        }
        return Promise.resolve()
            .then(function () {
                if (document.pictureInPictureElement) {
                    return document.exitPictureInPicture().catch(function () {});
                }
                return null;
            })
            .then(function () {
                closePipSession();
                if (!previewImage.complete && typeof previewImage.decode === "function") {
                    return previewImage.decode().catch(function () {});
                }
                return null;
            })
            .then(function () {
                var initialFrameRect = previewFrame ? previewFrame.getBoundingClientRect() : null;
                var initialImageRect = previewImage.getBoundingClientRect();
                var initialFrameWidth = Number(initialFrameRect && initialFrameRect.width ? initialFrameRect.width : previewImage.clientWidth || 0);
                var initialFrameHeight = Number(initialFrameRect && initialFrameRect.height ? initialFrameRect.height : previewImage.clientHeight || 0);
                if (!initialFrameWidth || !initialFrameHeight || !initialImageRect.width || !initialImageRect.height) {
                    throw new Error(localizedMessage("Could not find an image to show in PiP.", "PiP로 띄울 이미지를 찾을 수 없습니다."));
                }
                var maxSide = 1280;
                var canvas = document.createElement("canvas");
                var context = null;
                function configurePipCanvas(frameWidth, frameHeight) {
                    var scale = Math.min(1, maxSide / Math.max(frameWidth, frameHeight));
                    var nextWidth = Math.max(1, Math.round(frameWidth * scale));
                    var nextHeight = Math.max(1, Math.round(frameHeight * scale));
                    if (canvas.width !== nextWidth) canvas.width = nextWidth;
                    if (canvas.height !== nextHeight) canvas.height = nextHeight;
                    context = canvas.getContext("2d");
                    return scale;
                }
                var scale = configurePipCanvas(initialFrameWidth, initialFrameHeight);
                if (!context) {
                    throw new Error(localizedMessage("This browser does not support image PiP.", "이 브라우저는 이미지 PiP를 지원하지 않습니다."));
                }
                function drawPipFrame() {
                    var currentFrameRect = previewFrame ? previewFrame.getBoundingClientRect() : initialFrameRect;
                    var currentImageRect = previewImage.getBoundingClientRect();
                    var frameWidth = Number(currentFrameRect && currentFrameRect.width ? currentFrameRect.width : previewImage.clientWidth || 0);
                    var frameHeight = Number(currentFrameRect && currentFrameRect.height ? currentFrameRect.height : previewImage.clientHeight || 0);
                    if (!frameWidth || !frameHeight || !currentImageRect.width || !currentImageRect.height) return;
                    scale = configurePipCanvas(frameWidth, frameHeight);
                    if (!context) return;
                    var imageX = ((currentImageRect.left - currentFrameRect.left) + (previewFrame ? previewFrame.scrollLeft : 0)) * scale;
                    var imageY = ((currentImageRect.top - currentFrameRect.top) + (previewFrame ? previewFrame.scrollTop : 0)) * scale;
                    context.fillStyle = "#fff";
                    context.fillRect(0, 0, canvas.width, canvas.height);
                    context.drawImage(
                        previewImage,
                        imageX,
                        imageY,
                        currentImageRect.width * scale,
                        currentImageRect.height * scale
                    );
                }
                drawPipFrame();

                var capture = createManualCanvasStream(canvas, 1);
                var stream = capture.stream;
                var video = document.createElement("video");
                video.muted = true;
                video.playsInline = true;
                video.srcObject = stream;
                video.style.cssText = "position:fixed;left:-1px;top:-1px;width:1px;height:1px;opacity:0;pointer-events:none;";
                document.body.appendChild(video);
                pipSession = { stream: stream, track: capture.track, video: video, frameRequest: 0 };
                video.addEventListener("leavepictureinpicture", closePipSession, { once: true });
                requestCanvasStreamFrame(pipSession);
                return video.play().then(function () {
                    requestCanvasStreamFrame(pipSession);
                    return video.requestPictureInPicture();
                }).then(function () {
                    requestCanvasStreamFrame(pipSession);
                }).catch(function (error) {
                    closePipSession();
                    throw error;
                });
            });
    }

    function dataUrlToBlob(dataUrl) {
        var parts = String(dataUrl || "").split(",");
        var header = parts[0] || "";
        var body = parts[1] || "";
        var match = header.match(/data:([^;]+)/);
        var mime = match ? match[1] : "image/png";
        var binary = atob(body);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new Blob([bytes], { type: mime });
    }

    function copyCurrent() {
        if (!currentImage || !navigator.clipboard || !window.ClipboardItem) {
            downloadCurrent("png");
            return;
        }
        navigator.clipboard.write([
            new ClipboardItem({ "image/png": dataUrlToBlob(currentImage) }),
        ]).then(function () {
            copyButton.textContent = copiedMessage;
        }).catch(function () {
            downloadCurrent("png");
        });
    }

    form.addEventListener("submit", submit);
    if (valueInput) {
        valueInput.addEventListener("input", function () {
            scheduleGenerate(3000);
        });
        valueInput.addEventListener("keydown", function (event) {
            if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
            event.preventDefault();
            scheduleGenerate(0);
        });
    }
    form.querySelectorAll('input[name="input_kind"]').forEach(function (input) {
        input.addEventListener("change", function () {
            updatePlaceholder();
            scheduleGenerate(0);
        });
    });
    form.querySelectorAll('input[name="code_kind"]').forEach(function (input) {
        input.addEventListener("change", function () {
            updateBarcodeKindVisibility();
            scheduleGenerate(0);
        });
    });
    if (barcodeKindSelect) {
        barcodeKindSelect.addEventListener("change", function () {
            updatePlaceholder();
            scheduleGenerate(0);
        });
    }
    if (downloadJpegButton) {
        downloadJpegButton.addEventListener("click", function () {
            downloadCurrent("jpeg");
        });
    }
    if (downloadPngButton) {
        downloadPngButton.addEventListener("click", function () {
            downloadCurrent("png");
        });
    }
    if (copyButton) copyButton.addEventListener("click", copyCurrent);
    if (previewFrame) {
        previewFrame.addEventListener("click", function (event) {
            if (event.button !== 0) return;
            openImagePictureInPicture().catch(function (error) {
                setStatus(error && error.message ? error.message : localizedMessage("This browser does not support image PiP.", "이 브라우저는 이미지 PiP를 지원하지 않습니다."), true);
            });
        });
    }
    window.addEventListener("pagehide", closePipSession);
    updateBarcodeKindVisibility();
    if (valueInput && !String(valueInput.value || "").trim()) {
        valueInput.value = valueInput.dataset.defaultValue || "https://www.hanplanet.com/";
    }
    scheduleGenerate(0);
})();
