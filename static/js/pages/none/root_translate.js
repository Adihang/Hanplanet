(function () {
    'use strict';

    const panel = document.querySelector('[data-root-translate-panel]');
    if (!panel) {
        return;
    }

    const sourceInput = panel.querySelector('[data-root-translate-source]');
    const targetOutput = panel.querySelector('[data-root-translate-target]');
    const swapButton = panel.querySelector('[data-root-translate-swap]');
    const apiUrl = String(panel.dataset.translateApiUrl || '').trim();

    if (!sourceInput || !targetOutput || !swapButton || !apiUrl) {
        return;
    }

    const csrfMeta = document.querySelector('meta[name="csrf-token"]');
    const csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';
    const translatingLabel = String(panel.dataset.translatingLabel || 'Translating...');
    const translateErrorLabel = String(panel.dataset.translateErrorLabel || 'Translation failed.');
    const placeholderKo = String(panel.dataset.placeholderKo || '한국어');
    const placeholderEn = String(panel.dataset.placeholderEn || 'English');
    const resultPlaceholder = String(panel.dataset.placeholderResult || '번역 결과');

    let sourceLang = 'ko';
    let targetLang = 'en';
    let activeRequestId = 0;

    const getTextareaNaturalHeight = function (element) {
        const style = window.getComputedStyle(element);
        const minHeight = parseFloat(style.minHeight) || 0;
        const lineHeight = parseFloat(style.lineHeight) || ((parseFloat(style.fontSize) || 14) * 1.45);
        const paddingY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
        const borderY = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
        const singleLineHeight = Math.ceil(lineHeight + paddingY + borderY);

        if (!String(element.value || '').length) {
            return Math.max(singleLineHeight, minHeight, 38);
        }

        element.style.height = '0px';
        const naturalHeight = Math.ceil(element.scrollHeight + borderY);
        return Math.max(singleLineHeight, naturalHeight, minHeight, 38);
    };

    const syncTextareaHeights = function () {
        const nextHeight = Math.max(
            getTextareaNaturalHeight(sourceInput),
            getTextareaNaturalHeight(targetOutput)
        );
        sourceInput.style.height = String(nextHeight) + 'px';
        targetOutput.style.height = String(nextHeight) + 'px';
    };

    const syncPlaceholders = function () {
        sourceInput.setAttribute('placeholder', sourceLang === 'ko' ? placeholderKo : placeholderEn);
        targetOutput.setAttribute('placeholder', resultPlaceholder);
    };

    const setBusy = function (busy) {
        swapButton.disabled = busy;
        panel.classList.toggle('is-translating', busy);
    };

    const swapLanguages = function () {
        const nextSourceLang = targetLang;
        const nextTargetLang = sourceLang;
        const previousSourceValue = sourceInput.value;
        sourceLang = nextSourceLang;
        targetLang = nextTargetLang;
        sourceInput.value = targetOutput.value;
        targetOutput.value = previousSourceValue;
        syncPlaceholders();
        syncTextareaHeights();
    };

    const requestTranslation = function () {
        const text = sourceInput.value.trim();
        const requestId = activeRequestId + 1;
        activeRequestId = requestId;
        if (!text) {
            targetOutput.value = '';
            targetOutput.setAttribute('placeholder', resultPlaceholder);
            syncTextareaHeights();
            setBusy(false);
            return;
        }

        setBusy(true);
        targetOutput.value = '';
        targetOutput.setAttribute('placeholder', translatingLabel);
        syncTextareaHeights();

        window.fetch(apiUrl, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify({
                text: text,
                source: sourceLang,
                target: targetLang
            })
        })
            .then(function (response) {
                return response.json().catch(function () {
                    return {};
                }).then(function (payload) {
                    if (!response.ok) {
                        throw new Error(String(payload.error || translateErrorLabel));
                    }
                    return payload;
                });
            })
            .then(function (payload) {
                if (requestId !== activeRequestId) {
                    return;
                }
                targetOutput.value = String(payload.translation || '');
                if (!targetOutput.value) {
                    targetOutput.setAttribute('placeholder', resultPlaceholder);
                }
                syncTextareaHeights();
            })
            .catch(function (error) {
                if (requestId !== activeRequestId) {
                    return;
                }
                targetOutput.value = '';
                targetOutput.setAttribute('placeholder', error && error.message ? error.message : translateErrorLabel);
                syncTextareaHeights();
            })
            .finally(function () {
                if (requestId !== activeRequestId) {
                    return;
                }
                setBusy(false);
            });
    };

    swapButton.addEventListener('click', function () {
        swapLanguages();
    });

    sourceInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            requestTranslation();
        }
    });

    sourceInput.addEventListener('input', function () {
        syncTextareaHeights();
    });

    window.addEventListener('resize', syncTextareaHeights, { passive: true });

    syncPlaceholders();
    syncTextareaHeights();
})();
