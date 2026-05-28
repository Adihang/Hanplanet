(function () {
    "use strict";

    const panel = document.querySelector("[data-image-pip-demo]");
    if (!panel) return;

    const dropzone = panel.querySelector("[data-image-pip-dropzone]");
    const image = panel.querySelector("[data-image-pip-image]");
    const status = panel.querySelector("[data-image-pip-status]");
    const uploadOpenButton = panel.querySelector("[data-image-pip-upload-open]");
    const uploadInput = panel.querySelector("[data-image-pip-upload-input]");
    const codeOpenButton = panel.querySelector("[data-image-pip-code-open]");
    const codeModal = document.querySelector("[data-image-pip-code-modal]");
    const codeCloseButton = document.querySelector("[data-image-pip-code-close]");
    const codeCopyButton = document.querySelector("[data-image-pip-code-copy]");
    const codeElement = document.querySelector("[data-image-pip-code]");
    let currentObjectUrl = "";
    let pipSession = null;
    const exampleCode = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Image PiP</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafc; }
    img { max-width: 80vw; max-height: 80vh; cursor: pointer; border-radius: 12px; }
  </style>
</head>
<body>
  <img id="image" alt="Image PiP" crossorigin="anonymous" src="https://www.hanplanet.com/sub/image-pip-demo/sample-image.png">

  <script>
    const image = document.getElementById("image");
    let pipVideo = null;

    function closePreviousPiP() {
      if (!pipVideo) return;
      pipVideo.srcObject?.getTracks().forEach(track => track.stop());
      pipVideo.remove();
      pipVideo = null;
    }

    image.addEventListener("click", async () => {
      if (!document.pictureInPictureEnabled || !HTMLCanvasElement.prototype.captureStream) {
        alert("이 브라우저는 PiP를 지원하지 않습니다.");
        return;
      }
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      closePreviousPiP();
      if (!image.complete && image.decode) await image.decode().catch(() => {});

      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);

      const video = document.createElement("video");
      video.srcObject = canvas.captureStream(1);
      video.muted = true;
      video.playsInline = true;
      video.style.cssText = "position:fixed;left:-1px;top:-1px;width:1px;height:1px;opacity:0;pointer-events:none;";
      document.body.appendChild(video);
      pipVideo = video;
      video.addEventListener("leavepictureinpicture", closePreviousPiP, { once: true });
      await video.play();
      await video.requestPictureInPicture();
    });
    window.addEventListener("pagehide", closePreviousPiP);
  </script>
</body>
</html>`;

    function getMessage(key, fallback) {
        return panel.dataset[key] || fallback;
    }

    function setStatus(message) {
        if (status) status.textContent = message;
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    function highlightExampleCode(source) {
        return escapeHtml(source)
            .replace(/(&lt;\/?[a-zA-Z][^&]*?&gt;)/g, function (tag) {
                return tag
                    .replace(/^(&lt;\/?)([a-zA-Z0-9-]+)/, '$1<span class="image-pip-token-tag">$2</span>')
                    .replace(/([a-zA-Z-:]+)=(".*?"|'.*?')/g, '<span class="image-pip-token-attr">$1</span>=<span class="image-pip-token-string">$2</span>');
            });
    }

    function setCodeModalOpen(open) {
        if (!codeModal) return;
        codeModal.hidden = !open;
        if (open) {
            if (codeElement && !codeElement.dataset.rendered) {
                codeElement.innerHTML = highlightExampleCode(exampleCode);
                codeElement.dataset.rendered = "1";
            }
            if (codeCopyButton) codeCopyButton.focus();
        } else if (codeOpenButton) {
            codeOpenButton.focus();
        }
    }

    function closePipSession() {
        if (!pipSession) return;
        const session = pipSession;
        pipSession = null;
        if (session.frameRequest) window.cancelAnimationFrame(session.frameRequest);
        if (session.video) session.video.remove();
        if (session.stream) {
            session.stream.getTracks().forEach(function (track) {
                track.stop();
            });
        }
    }

    function replaceImageWithFile(file) {
        if (!file || !String(file.type || "").startsWith("image/")) {
            setStatus(getMessage("statusInvalidFile", "Use an image file."));
            return;
        }
        if (currentObjectUrl) {
            URL.revokeObjectURL(currentObjectUrl);
            currentObjectUrl = "";
        }
        currentObjectUrl = URL.createObjectURL(file);
        image.src = currentObjectUrl;
        image.alt = file.name || "Image PiP demo";
        setStatus(getMessage("statusLoaded", "Image loaded"));
    }

    function getImageFileFromDataTransfer(dataTransfer) {
        if (!dataTransfer) return null;
        const files = Array.prototype.slice.call(dataTransfer.files || []);
        return files.find(function (file) {
            return file && String(file.type || "").startsWith("image/");
        }) || null;
    }

    async function openImagePictureInPicture() {
        if (!image) {
            throw new Error(getMessage("statusMissingImage", "Could not find an image."));
        }
        if (!document.pictureInPictureEnabled || typeof HTMLCanvasElement === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") {
            throw new Error(getMessage("statusUnsupported", "This browser does not support image Picture-in-Picture."));
        }
        if (document.pictureInPictureElement) {
            await document.exitPictureInPicture().catch(function () {});
        }
        closePipSession();

        if (!image.complete && typeof image.decode === "function") {
            await image.decode().catch(function () {});
        }

        const sourceWidth = Number(image.naturalWidth || image.width || image.clientWidth || 0);
        const sourceHeight = Number(image.naturalHeight || image.height || image.clientHeight || 0);
        if (!sourceWidth || !sourceHeight) {
            throw new Error(getMessage("statusMissingImage", "Could not find an image."));
        }

        const maxSide = 1280;
        const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(sourceWidth * scale));
        canvas.height = Math.max(1, Math.round(sourceHeight * scale));

        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error(getMessage("statusUnsupported", "This browser does not support image Picture-in-Picture."));
        }
        function drawPipFrame() {
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
        }
        drawPipFrame();

        const stream = canvas.captureStream(30);
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        video.style.cssText = "position:fixed;left:-1px;top:-1px;width:1px;height:1px;opacity:0;pointer-events:none;";
        document.body.appendChild(video);
        pipSession = { stream: stream, video: video, frameRequest: 0 };
        function tickPipFrame() {
            if (!pipSession || pipSession.video !== video) return;
            drawPipFrame();
            pipSession.frameRequest = window.requestAnimationFrame(tickPipFrame);
        }
        pipSession.frameRequest = window.requestAnimationFrame(tickPipFrame);
        video.addEventListener("leavepictureinpicture", closePipSession, { once: true });

        try {
            await video.play();
            await video.requestPictureInPicture();
            setStatus(getMessage("statusPipOpened", "Picture-in-Picture opened"));
        } catch (error) {
            closePipSession();
            throw error;
        }
    }

    if (dropzone) {
        dropzone.addEventListener("dragover", function (event) {
            event.preventDefault();
            dropzone.classList.add("is-dragover");
        });

        dropzone.addEventListener("dragleave", function () {
            dropzone.classList.remove("is-dragover");
        });

        dropzone.addEventListener("drop", function (event) {
            event.preventDefault();
            dropzone.classList.remove("is-dragover");
            replaceImageWithFile(getImageFileFromDataTransfer(event.dataTransfer));
        });
    }

    document.addEventListener("paste", function (event) {
        const file = getImageFileFromDataTransfer(event.clipboardData);
        if (file) {
            replaceImageWithFile(file);
        }
    });

    if (image) {
        image.addEventListener("click", function (event) {
            if (event.button !== 0) return;
            openImagePictureInPicture().catch(function (error) {
                setStatus(error && error.message ? error.message : getMessage("statusUnsupported", "This browser does not support image Picture-in-Picture."));
            });
        });
    }

    if (uploadOpenButton && uploadInput) {
        uploadOpenButton.addEventListener("click", function () {
            uploadInput.click();
        });
        uploadInput.addEventListener("change", function () {
            replaceImageWithFile(uploadInput.files && uploadInput.files[0]);
            uploadInput.value = "";
        });
    }

    if (codeOpenButton) {
        codeOpenButton.addEventListener("click", function () {
            setCodeModalOpen(true);
        });
    }

    if (codeCloseButton) {
        codeCloseButton.addEventListener("click", function () {
            setCodeModalOpen(false);
        });
    }

    if (codeModal) {
        codeModal.addEventListener("click", function (event) {
            if (event.target === codeModal) setCodeModalOpen(false);
        });
    }

    if (codeCopyButton) {
        codeCopyButton.addEventListener("click", function () {
            const copyLabel = codeCopyButton.dataset.copyLabel || "Copy";
            const copiedLabel = codeCopyButton.dataset.copiedLabel || "Copied";
            navigator.clipboard.writeText(exampleCode).then(function () {
                codeCopyButton.textContent = copiedLabel;
                window.setTimeout(function () {
                    codeCopyButton.textContent = copyLabel;
                }, 1200);
            }).catch(function () {
                codeCopyButton.textContent = copyLabel;
            });
        });
    }

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && codeModal && !codeModal.hidden) {
            setCodeModalOpen(false);
        }
    });

    window.addEventListener("pagehide", function () {
        closePipSession();
        if (currentObjectUrl) {
            URL.revokeObjectURL(currentObjectUrl);
            currentObjectUrl = "";
        }
    });
})();
