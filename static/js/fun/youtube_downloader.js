(function () {
    const form = document.querySelector('[data-youtube-downloader-form]');
    if (!form) {
        return;
    }

    const urlInput = form.querySelector('input[name="url"]');
    const submitButton = form.querySelector('.youtube-downloader-submit');
    const statusEl = form.querySelector('[data-youtube-downloader-status]');
    const preview = document.querySelector('[data-youtube-downloader-preview]');
    const previewMeta = document.querySelector('[data-youtube-downloader-preview-meta]');
    const playerSlot = document.querySelector('[data-youtube-downloader-player-slot]');
    const downloadButton = document.querySelector('[data-youtube-downloader-download]');
    const saveButton = document.querySelector('[data-youtube-downloader-save]');
    const saveProgress = document.querySelector('[data-youtube-downloader-save-progress]');
    const progress = document.querySelector('[data-youtube-downloader-progress]');
    const downloadUrl = form.dataset.downloadUrl || '';
    const formatsUrl = form.dataset.formatsUrl || '';
    const emptyUrlMessage = form.dataset.emptyUrlMessage || 'URL is required.';
    const downloadFailedMessage = form.dataset.downloadFailedMessage || 'Download failed.';
    const qualityLoadingMessage = form.dataset.qualityLoadingMessage || 'Loading qualities...';
    const qualityBestLabel = form.dataset.qualityBestLabel || 'Best quality';
    const pendingSaveStorageKey = 'hanplanet.youtubeDownloader.pendingSave';

    let currentResult = null;
    let currentPlayerEl = null;
    let qualityMenu = document.querySelector('[data-youtube-downloader-quality-menu]');
    let pendingUrl = '';

    const positionQualityMenu = function () {
        if (!qualityMenu || !submitButton || qualityMenu.hidden) {
            return;
        }

        const margin = 8;
        const rect = submitButton.getBoundingClientRect();
        const menuWidth = Math.max(rect.width, 152);
        const maxLeft = window.innerWidth - menuWidth - margin;
        const left = Math.max(margin, Math.min(rect.left, maxLeft));

        qualityMenu.style.width = menuWidth + 'px';
        qualityMenu.style.minWidth = menuWidth + 'px';
        qualityMenu.style.left = left + 'px';

        const menuHeight = Math.min(qualityMenu.scrollHeight || 280, 280);
        const belowTop = rect.bottom + 6;
        const aboveTop = rect.top - menuHeight - 6;
        const top = belowTop + menuHeight + margin <= window.innerHeight
            ? belowTop
            : Math.max(margin, aboveTop);

        qualityMenu.style.top = top + 'px';
    };

    const getCsrfToken = function () {
        const input = form.querySelector('input[name="csrfmiddlewaretoken"]');
        if (input && input.value) {
            return input.value;
        }
        const meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.getAttribute('content') || '' : '';
    };

    const setStatus = function (message, isError) {
        if (!statusEl) {
            return;
        }
        statusEl.textContent = message || '';
        statusEl.classList.toggle('is-error', Boolean(isError));
    };

    const selectServerMessage = function (payload, fallback) {
        if (!payload || typeof payload !== 'object') {
            return fallback || '';
        }
        const lang = (document.documentElement.getAttribute('lang') || '').toLowerCase().indexOf('en') === 0 ? 'en' : 'ko';
        const messages = payload.error_messages || payload.messages;
        if (messages && typeof messages === 'object') {
            return messages[lang] || messages.ko || messages.en || fallback || '';
        }
        return payload.error_message || payload.message || payload.error || fallback || '';
    };

    const setBusy = function (busy) {
        if (!submitButton) {
            return;
        }
        submitButton.disabled = Boolean(busy);
        submitButton.textContent = busy
            ? (submitButton.dataset.workingLabel || submitButton.textContent)
            : (submitButton.dataset.submitLabel || submitButton.textContent);
        if (progress) {
            progress.hidden = !busy;
        }
    };

    const setQualityMenuOpen = function (opened) {
        if (!qualityMenu || !submitButton) {
            return;
        }
        if (opened && qualityMenu.parentNode !== document.body) {
            document.body.appendChild(qualityMenu);
        }
        qualityMenu.hidden = !opened;
        submitButton.setAttribute('aria-expanded', opened ? 'true' : 'false');
        if (opened) {
            positionQualityMenu();
        }
    };

    const renderQualityMenu = function (qualities, url) {
        if (!qualityMenu) {
            return;
        }
        qualityMenu.textContent = '';
        const items = Array.isArray(qualities) && qualities.length
            ? qualities
            : [{ value: 'best', label: qualityBestLabel }];
        items.forEach(function (quality) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'youtube-downloader-quality-option';
            button.setAttribute('role', 'menuitem');
            button.dataset.quality = String(quality.value || 'best');
            button.textContent = String(quality.label || quality.value || qualityBestLabel);
            button.addEventListener('click', function () {
                setQualityMenuOpen(false);
                startExtraction(url, 'mp4', button.dataset.quality || 'best');
            });
            qualityMenu.appendChild(button);
        });
        setQualityMenuOpen(true);
        const firstButton = qualityMenu.querySelector('button');
        if (firstButton) {
            firstButton.focus();
        }
    };

    const loadQualityMenu = function (url) {
        if (!formatsUrl || !url) {
            startExtraction(url, 'mp4', 'best');
            return;
        }
        setBusy(true);
        setStatus(qualityLoadingMessage, false);
        fetch(formatsUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({ url: url })
        })
            .then(function (response) {
                return response.json().catch(function () {
                    return { ok: false, error: downloadFailedMessage };
                });
            })
            .then(function (data) {
                if (!data || data.ok === false) {
                    throw new Error(selectServerMessage(data, downloadFailedMessage));
                }
                setStatus('', false);
                renderQualityMenu(data.qualities || [], url);
            })
            .catch(function (error) {
                setStatus(error.message || downloadFailedMessage, true);
            })
            .finally(function () {
                setBusy(false);
            });
    };

    const cleanupCurrentResult = function () {
        if (currentPlayerEl && window.HandriveVideoPlayer && typeof window.HandriveVideoPlayer.cleanup === 'function') {
            window.HandriveVideoPlayer.cleanup(currentPlayerEl);
        }
        currentPlayerEl = null;
        currentResult = null;
        if (playerSlot) {
            playerSlot.textContent = '';
        }
    };

    const initHandrivePlayer = function (playerEl) {
        currentPlayerEl = playerEl;
        const run = function () {
            if (window.HandriveVideoPlayer && typeof window.HandriveVideoPlayer.init === 'function') {
                window.HandriveVideoPlayer.init(playerEl);
            }
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', run, { once: true });
        } else {
            run();
        }
    };

    const renderPreview = function (fileUrl, filename, format, token) {
        cleanupCurrentResult();

        const mimeType = format === 'mp3' ? 'audio/mpeg' : 'video/mp4';
        currentResult = {
            fileUrl: fileUrl,
            filename: filename,
            mimeType: mimeType,
            token: token || ''
        };
        if (saveButton) {
            saveButton.hidden = false;
            saveButton.disabled = false;
            saveButton.classList.remove('is-saved');
        }

        const isAudio = format === 'mp3';
        const media = document.createElement(isAudio ? 'audio' : 'video');
        media.className = isAudio
            ? 'youtube-downloader-player is-audio'
            : 'video-js vjs-default-skin youtube-downloader-player';
        media.controls = true;
        media.preload = 'metadata';
        if (!isAudio) {
            media.playsInline = true;
        }

        const source = document.createElement('source');
        source.src = fileUrl;
        source.type = mimeType;
        media.appendChild(source);

        if (playerSlot) {
            playerSlot.textContent = '';
            playerSlot.appendChild(media);
        }
        if (previewMeta) {
            previewMeta.textContent = filename;
            previewMeta.title = filename;
        }

        form.hidden = true;
        if (preview) {
            preview.hidden = false;
        }
        if (!isAudio) {
            initHandrivePlayer(media);
        }
    };

    const downloadCurrentResult = function () {
        if (!currentResult || !currentResult.fileUrl) {
            return;
        }
        const link = document.createElement('a');
        link.href = currentResult.fileUrl + '?dl=1';
        link.download = currentResult.filename || 'youtube-download';
        document.body.appendChild(link);
        link.click();
        link.remove();
        if (saveButton) {
            saveButton.hidden = true;
        }
    };

    if (downloadButton) {
        downloadButton.addEventListener('click', downloadCurrentResult);
    }

    const saveToHandrive = function () {
        if (!saveButton || !currentResult || !currentResult.token) {
            return;
        }
        const saveUrl = saveButton.dataset.saveUrl || '';
        const listUrl = saveButton.dataset.saveListUrl || '';
        if (!saveUrl || !listUrl) {
            return;
        }
        saveButton.disabled = true;
        if (saveProgress) { saveProgress.hidden = false; }
        try {
            window.sessionStorage.setItem(pendingSaveStorageKey, JSON.stringify({
                createdAt: Date.now(),
                filename: currentResult.filename || 'youtube-download',
                listUrl: listUrl,
                saveUrl: saveUrl,
                targetDir: saveButton.dataset.saveTargetDir || 'youtube-downloader',
                token: currentResult.token
            }));
        } catch (error) {
            saveButton.disabled = false;
            if (saveProgress) { saveProgress.hidden = true; }
            setStatus(saveButton.dataset.saveFailedMessage || 'Save failed.', true);
            return;
        }
        window.location.assign(listUrl);
    };

    if (saveButton) {
        saveButton.addEventListener('click', saveToHandrive);
    }

    const startExtraction = function (url, format, quality) {
        setBusy(true);
        setStatus('', false);

        fetch(downloadUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({ url: url, format: format, quality: quality || 'best' })
        })
            .then(function (response) {
                return response.json().catch(function () {
                    return { ok: false, error: downloadFailedMessage };
                });
            })
            .then(function (data) {
                if (!data || !data.ok || !data.file_url) {
                    throw new Error(selectServerMessage(data, downloadFailedMessage));
                }
                renderPreview(data.file_url, data.filename || ('youtube.' + format), data.format || format, data.token || '');
            })
            .catch(function (error) {
                setStatus(error.message || downloadFailedMessage, true);
            })
            .finally(function () {
                setBusy(false);
            });
    };

    form.addEventListener('submit', function (event) {
        event.preventDefault();
        const formatInput = form.querySelector('input[name="format"]:checked');
        const url = urlInput ? urlInput.value.trim() : '';
        const format = formatInput ? formatInput.value : 'mp4';

        if (!downloadUrl || !url) {
            setStatus(emptyUrlMessage, true);
            return;
        }

        if (format === 'mp4') {
            if (!qualityMenu || qualityMenu.hidden || pendingUrl !== url) {
                pendingUrl = url;
                loadQualityMenu(url);
            } else {
                setQualityMenuOpen(false);
            }
            return;
        }

        setQualityMenuOpen(false);
        startExtraction(url, format, 'best');
    });

    document.addEventListener('click', function (event) {
        if (!qualityMenu || qualityMenu.hidden) {
            return;
        }
        if (event.target === submitButton || submitButton.contains(event.target) || qualityMenu.contains(event.target)) {
            return;
        }
        setQualityMenuOpen(false);
    });

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            setQualityMenuOpen(false);
        }
    });

    window.addEventListener('resize', positionQualityMenu);
    window.addEventListener('scroll', positionQualityMenu, true);
    window.addEventListener('beforeunload', cleanupCurrentResult);
}());
