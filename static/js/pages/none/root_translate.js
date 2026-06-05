(function () {
    'use strict';

    const panel = document.querySelector('[data-root-translate-panel]');
    if (!panel) {
        return;
    }

    const sourceInput = panel.querySelector('[data-root-translate-source]');
    const sourceInputShell = panel.querySelector('[data-root-translate-source-shell]');
    const sourcePlaceholder = panel.querySelector('[data-root-translate-source-placeholder]');
    const sourceClearButton = panel.querySelector('[data-root-translate-source-clear]');
    const targetOutput = panel.querySelector('[data-root-translate-target]');
    const targetOutputShell = panel.querySelector('[data-root-translate-target-shell]');
    const copyButton = panel.querySelector('[data-root-translate-copy]');
    const swapButton = panel.querySelector('[data-root-translate-swap]');
    const apiUrl = String(panel.dataset.translateApiUrl || '').trim();

    if (!sourceInput || !sourceInputShell || !targetOutput || !swapButton || !apiUrl) {
        return;
    }

    const csrfMeta = document.querySelector('meta[name="csrf-token"]');
    const csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';
    const translatingLabel = String(panel.dataset.translatingLabel || 'Translating...');
    const translateErrorLabel = String(panel.dataset.translateErrorLabel || 'Translation failed.');
    const placeholderKo = String(panel.dataset.placeholderKo || '한국어');
    const placeholderEn = String(panel.dataset.placeholderEn || 'English');
    const resultPlaceholder = String(panel.dataset.placeholderResult || '번역 결과');
    const copyLabel = String(panel.dataset.copyLabel || '복사');
    const copiedLabel = String(panel.dataset.copiedLabel || '복사됨');
    let copyResetTimer = 0;

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

    const escapeHtml = function (value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    const setCopyButtonState = function (hasText) {
        if (!copyButton) {
            return;
        }
        copyButton.disabled = !hasText;
        copyButton.setAttribute('aria-label', copyLabel);
        copyButton.setAttribute('title', copyLabel);
        copyButton.classList.remove('is-copied');
    };

    const getCopyText = function () {
        const rawText = String(targetOutput.dataset.rawText || '').trim();
        if (rawText) {
            return rawText;
        }
        return String(targetOutput.innerText || targetOutput.textContent || '').trim();
    };

    const writeClipboardText = function (text) {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            return navigator.clipboard.writeText(text);
        }
        return new Promise(function (resolve, reject) {
            const tempInput = document.createElement('textarea');
            tempInput.value = text;
            tempInput.setAttribute('readonly', 'readonly');
            tempInput.style.position = 'fixed';
            tempInput.style.left = '-9999px';
            tempInput.style.top = '0';
            document.body.appendChild(tempInput);
            tempInput.select();
            try {
                if (!document.execCommand('copy')) {
                    throw new Error('copy failed');
                }
                resolve();
            } catch (error) {
                reject(error);
            } finally {
                document.body.removeChild(tempInput);
            }
        });
    };

    const showCopiedState = function () {
        if (!copyButton) {
            return;
        }
        if (copyResetTimer) {
            window.clearTimeout(copyResetTimer);
        }
        copyButton.classList.add('is-copied');
        copyButton.setAttribute('aria-label', copiedLabel);
        copyButton.setAttribute('title', copiedLabel);
        copyResetTimer = window.setTimeout(function () {
            copyResetTimer = 0;
            copyButton.classList.remove('is-copied');
            copyButton.setAttribute('aria-label', copyLabel);
            copyButton.setAttribute('title', copyLabel);
        }, 1200);
    };

    const highlightJavaScriptCode = function (source) {
        const placeholders = [];

        const putPlaceholder = function (tokenHtml) {
            const token = '@@ROOT_TRANSLATE_JS_TOKEN_' + String(placeholders.length) + '@@';
            placeholders.push(tokenHtml);
            return token;
        };

        const restorePlaceholders = function (text) {
            return text.replace(/@@ROOT_TRANSLATE_JS_TOKEN_(\d+)@@/g, function (_, indexText) {
                const index = Number(indexText);
                if (Number.isNaN(index) || index < 0 || index >= placeholders.length) {
                    return '';
                }
                return placeholders[index];
            });
        };

        let text = escapeHtml(source);
        text = text.replace(/\/\*[\s\S]*?\*\//g, function (match) {
            return putPlaceholder('<span class="root-translate-token-comment">' + match + '</span>');
        });
        text = text.replace(/(^|[^\S\r\n])\/\/[^\r\n]*/g, function (match) {
            return putPlaceholder('<span class="root-translate-token-comment">' + match + '</span>');
        });
        text = text.replace(/(["'`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, function (match) {
            return putPlaceholder('<span class="root-translate-token-string">' + match + '</span>');
        });
        text = text.replace(/\b(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi, '<span class="root-translate-token-number">$1</span>');
        text = text.replace(
            /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|import|from|export|default|try|catch|finally|throw|async|await|typeof|instanceof|in|of|void|delete)\b/g,
            '<span class="root-translate-token-keyword">$1</span>'
        );
        text = text.replace(/\b(true|false|null|undefined|this|super)\b/g, '<span class="root-translate-token-literal">$1</span>');
        text = text.replace(
            /\b(Array|Object|String|Number|Boolean|Date|Math|JSON|Promise|Map|Set|RegExp|Error|console|window|document)\b/g,
            '<span class="root-translate-token-builtin">$1</span>'
        );
        text = text.replace(/(\b[a-zA-Z_$][\w$]*)(\s*\()/g, '<span class="root-translate-token-function">$1</span>$2');
        return restorePlaceholders(text);
    };

    const highlightCssCode = function (source) {
        const placeholders = [];

        const putPlaceholder = function (tokenHtml) {
            const token = '@@ROOT_TRANSLATE_CSS_TOKEN_' + String(placeholders.length) + '@@';
            placeholders.push(tokenHtml);
            return token;
        };

        const restorePlaceholders = function (text) {
            return text.replace(/@@ROOT_TRANSLATE_CSS_TOKEN_(\d+)@@/g, function (_, indexText) {
                const index = Number(indexText);
                if (Number.isNaN(index) || index < 0 || index >= placeholders.length) {
                    return '';
                }
                return placeholders[index];
            });
        };

        let text = escapeHtml(source);
        text = text.replace(/\/\*[\s\S]*?\*\//g, function (match) {
            return putPlaceholder('<span class="root-translate-token-comment">' + match + '</span>');
        });
        text = text.replace(/(["'])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, function (match) {
            return putPlaceholder('<span class="root-translate-token-string">' + match + '</span>');
        });
        text = text.replace(/(^|[}\s])([#.:\w\-\[\]=\*>\+\~,]+)(\s*\{)/g, function (_, p1, selectorText, p3) {
            return p1 + '<span class="root-translate-token-selector">' + selectorText + '</span>' + p3;
        });
        text = text.replace(/(--[\w-]+)(\s*:)/g, '<span class="root-translate-token-variable">$1</span>$2');
        text = text.replace(/([a-z-]+)(\s*:)/gi, '<span class="root-translate-token-property">$1</span>$2');
        text = text.replace(/(:\s*)(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\)|\b[a-zA-Z]+\b)/g, '$1<span class="root-translate-token-value">$2</span>');
        text = text.replace(/(-?\d+(?:\.\d+)?)(px|em|rem|vh|vw|%|deg|s|ms)?\b/g, '<span class="root-translate-token-number">$1$2</span>');
        return restorePlaceholders(text);
    };

    const highlightJsonCode = function (source) {
        const placeholders = [];

        const putPlaceholder = function (tokenHtml) {
            const token = '@@ROOT_TRANSLATE_JSON_TOKEN_' + String(placeholders.length) + '@@';
            placeholders.push(tokenHtml);
            return token;
        };

        const restorePlaceholders = function (text) {
            return text.replace(/@@ROOT_TRANSLATE_JSON_TOKEN_(\d+)@@/g, function (_, indexText) {
                const index = Number(indexText);
                if (Number.isNaN(index) || index < 0 || index >= placeholders.length) {
                    return '';
                }
                return placeholders[index];
            });
        };

        let text = escapeHtml(source);
        text = text.replace(/"(?:\\.|[^"\\])*"(?=\s*:)/g, function (match) {
            return putPlaceholder('<span class="root-translate-token-key">' + match + '</span>');
        });
        text = text.replace(/"(?:\\.|[^"\\])*"/g, function (match) {
            return putPlaceholder('<span class="root-translate-token-string">' + match + '</span>');
        });
        text = text.replace(/\b(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi, '<span class="root-translate-token-number">$1</span>');
        text = text.replace(/\b(true|false|null)\b/g, '<span class="root-translate-token-literal">$1</span>');
        text = text.replace(/([{}\[\],:])/g, '<span class="root-translate-token-punctuation">$1</span>');
        return restorePlaceholders(text);
    };

    const highlightPythonCode = function (source) {
        const placeholders = [];

        const putPlaceholder = function (tokenHtml) {
            const token = '@@ROOT_TRANSLATE_PY_TOKEN_' + String(placeholders.length) + '@@';
            placeholders.push(tokenHtml);
            return token;
        };

        const restorePlaceholders = function (text) {
            return text.replace(/@@ROOT_TRANSLATE_PY_TOKEN_(\d+)@@/g, function (_, indexText) {
                const index = Number(indexText);
                if (Number.isNaN(index) || index < 0 || index >= placeholders.length) {
                    return '';
                }
                return placeholders[index];
            });
        };

        let text = escapeHtml(source);
        text = text.replace(/("""[\s\S]*?"""|'''[\s\S]*?''')/g, function (match) {
            return putPlaceholder('<span class="root-translate-token-string">' + match + '</span>');
        });
        text = text.replace(/#[^\r\n]*/g, function (match) {
            return putPlaceholder('<span class="root-translate-token-comment">' + match + '</span>');
        });
        text = text.replace(/(["'])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, function (match) {
            return putPlaceholder('<span class="root-translate-token-string">' + match + '</span>');
        });
        text = text.replace(/(^|\s)(@[a-zA-Z_][\w.]*)/g, '$1<span class="root-translate-token-decorator">$2</span>');
        text = text.replace(/\b(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi, '<span class="root-translate-token-number">$1</span>');
        text = text.replace(
            /\b(def|class|return|if|elif|else|for|while|break|continue|try|except|finally|raise|import|from|as|with|pass|yield|lambda|global|nonlocal|assert|del|in|is|and|or|not|async|await|match|case)\b/g,
            '<span class="root-translate-token-keyword">$1</span>'
        );
        text = text.replace(/\b(True|False|None)\b/g, '<span class="root-translate-token-literal">$1</span>');
        text = text.replace(
            /\b(len|range|str|int|float|dict|list|set|tuple|print|open|type|isinstance|enumerate|zip|map|filter|sum|min|max|abs|sorted|reversed|any|all)\b/g,
            '<span class="root-translate-token-builtin">$1</span>'
        );
        text = text.replace(/\b(def)\s+([a-zA-Z_][\w]*)/g, '$1 <span class="root-translate-token-function">$2</span>');
        text = text.replace(/\b(class)\s+([a-zA-Z_][\w]*)/g, '$1 <span class="root-translate-token-class">$2</span>');
        return restorePlaceholders(text);
    };

    const highlightHtmlCode = function (source) {
        const placeholders = [];

        const putPlaceholder = function (tokenHtml) {
            const token = '@@ROOT_TRANSLATE_HTML_TOKEN_' + String(placeholders.length) + '@@';
            placeholders.push(tokenHtml);
            return token;
        };

        const restorePlaceholders = function (text) {
            return text.replace(/@@ROOT_TRANSLATE_HTML_TOKEN_(\d+)@@/g, function (_, indexText) {
                const index = Number(indexText);
                if (Number.isNaN(index) || index < 0 || index >= placeholders.length) {
                    return '';
                }
                return placeholders[index];
            });
        };

        let text = escapeHtml(source);
        text = text.replace(/&lt;!--[\s\S]*?--&gt;/g, function (match) {
            return putPlaceholder('<span class="root-translate-token-comment">' + match + '</span>');
        });
        text = text.replace(/(["'])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, function (match) {
            return putPlaceholder('<span class="root-translate-token-string">' + match + '</span>');
        });
        text = text.replace(
            /(&lt;\/?)([a-zA-Z][\w:-]*)([\s\S]*?)(&gt;)/g,
            function (_, open, tagName, attributes, close) {
                let highlightedAttributes = attributes.replace(
                    /(\s)([a-zA-Z_:][\w:.-]*)(\s*=\s*)/g,
                    '$1<span class="root-translate-token-attr">$2</span>$3'
                );
                return (
                    '<span class="root-translate-token-punctuation">' + open + '</span>' +
                    '<span class="root-translate-token-tag">' + tagName + '</span>' +
                    highlightedAttributes +
                    '<span class="root-translate-token-punctuation">' + close + '</span>'
                );
            }
        );
        return restorePlaceholders(text);
    };

    const detectCodeLanguageClass = function (codeNode) {
        if (!codeNode || !(codeNode instanceof Element)) {
            return '';
        }
        const classes = Array.from(codeNode.classList || []);
        const languageClass = classes.find(function (className) {
            return /^language-/i.test(className);
        });
        const languageValue = languageClass ? languageClass.replace(/^language-/i, '') : '';
        const normalized = String(languageValue || '').toLowerCase();
        if (normalized === 'js' || normalized === 'javascript' || normalized === 'mjs' || normalized === 'cjs') {
            return 'javascript';
        }
        if (normalized === 'css') {
            return 'css';
        }
        if (normalized === 'json' || normalized === 'jsonc') {
            return 'json';
        }
        if (normalized === 'py' || normalized === 'python' || normalized === 'py3' || normalized === 'pyi') {
            return 'python';
        }
        if (normalized === 'html' || normalized === 'xml' || normalized === 'svg') {
            return 'html';
        }
        return '';
    };

    const applyTranslationCodeHighlighting = function (targetElement) {
        if (!targetElement || !(targetElement instanceof Element)) {
            return;
        }
        const codeNodes = targetElement.querySelectorAll('pre code');
        codeNodes.forEach(function (codeNode) {
            if (!(codeNode instanceof HTMLElement)) {
                return;
            }
            if (codeNode.dataset.rootTranslateHighlighted === '1') {
                return;
            }
            const source = codeNode.textContent || '';
            const language = detectCodeLanguageClass(codeNode);
            if (!language) {
                codeNode.dataset.rootTranslateHighlighted = '1';
                return;
            }
            if (language === 'javascript') {
                codeNode.innerHTML = highlightJavaScriptCode(source);
            } else if (language === 'css') {
                codeNode.innerHTML = highlightCssCode(source);
            } else if (language === 'json') {
                codeNode.innerHTML = highlightJsonCode(source);
            } else if (language === 'python') {
                codeNode.innerHTML = highlightPythonCode(source);
            } else if (language === 'html') {
                codeNode.innerHTML = highlightHtmlCode(source);
            }
            codeNode.dataset.rootTranslateHighlighted = '1';
        });
    };

    let heightSyncFrame = 0;

    const scheduleTextareaHeightsSync = function () {
        if (heightSyncFrame) {
            window.cancelAnimationFrame(heightSyncFrame);
        }
        heightSyncFrame = window.requestAnimationFrame(function () {
            heightSyncFrame = 0;
            syncTextareaHeights();
        });
    };

    const setRenderedOutput = function (html, fallbackText, rawText) {
        const nextHtml = String(html || '').trim();
        targetOutput.dataset.rawText = String(rawText || '');
        if (nextHtml) {
            targetOutput.innerHTML = nextHtml;
            targetOutput.removeAttribute('data-empty');
            if (targetOutputShell) {
                targetOutputShell.setAttribute('data-empty', '0');
            }
            setCopyButtonState(Boolean(getCopyText()));
            applyTranslationCodeHighlighting(targetOutput);
            scheduleTextareaHeightsSync();
            return;
        }
        targetOutput.innerHTML = '';
        targetOutput.setAttribute('data-empty', '1');
        targetOutput.setAttribute('data-placeholder', fallbackText || resultPlaceholder);
        if (targetOutputShell) {
            targetOutputShell.setAttribute('data-empty', '1');
        }
        setCopyButtonState(false);
        scheduleTextareaHeightsSync();
    };

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
            return Math.max(singleLineHeight, minHeight);
        }

        element.style.height = 'auto';
        const naturalHeight = Math.ceil(element.scrollHeight + borderY);
        return Math.max(singleLineHeight, naturalHeight, minHeight);
    };

    const getRenderedOutputNaturalHeight = function (element) {
        const style = window.getComputedStyle(element);
        const minHeight = parseFloat(style.minHeight) || 0;
        const lineHeight = parseFloat(style.lineHeight) || ((parseFloat(style.fontSize) || 14) * 1.45);
        const paddingY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
        const borderY = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
        const singleLineHeight = Math.ceil(lineHeight + paddingY + borderY);
        if (element.dataset.empty === '1') {
            return Math.max(singleLineHeight, minHeight);
        }
        const naturalHeight = Math.ceil(element.scrollHeight + borderY);
        return Math.max(singleLineHeight, naturalHeight, minHeight);
    };

    const syncTextareaHeights = function () {
        sourceInput.style.height = 'auto';
        const sourceHeight = Math.max(36, getTextareaNaturalHeight(sourceInput) - 3);
        const outputHeight = Math.max(36, getRenderedOutputNaturalHeight(targetOutput) - 3);
        const sharedHeight = Math.max(sourceHeight, outputHeight);
        sourceInputShell.style.height = '';
        sourceInput.style.height = String(sharedHeight) + 'px';
        targetOutput.style.height = String(sharedHeight) + 'px';
    };

    const syncPlaceholders = function () {
        if (sourcePlaceholder) {
            sourcePlaceholder.textContent = sourceLang === 'ko' ? placeholderKo : placeholderEn;
        }
        targetOutput.setAttribute('data-placeholder', resultPlaceholder);
    };

    const syncSourcePlaceholderState = function () {
        const hasValue = Boolean(sourceInput.value.length);
        sourceInputShell.setAttribute('data-empty', hasValue ? '0' : '1');
        if (sourceClearButton) {
            sourceClearButton.hidden = !hasValue;
        }
    };

    const setBusy = function (busy) {
        swapButton.disabled = busy;
        panel.classList.toggle('is-translating', busy);
    };

    const swapLanguages = function () {
        const nextSourceLang = targetLang;
        const nextTargetLang = sourceLang;
        const previousSourceValue = sourceInput.value;
        const previousTranslationValue = String(targetOutput.dataset.rawText || '');
        sourceLang = nextSourceLang;
        targetLang = nextTargetLang;
        sourceInput.value = previousTranslationValue;
        syncSourcePlaceholderState();
        setRenderedOutput(
            previousSourceValue ? '<p>' + escapeHtml(previousSourceValue).replace(/\n/g, '<br>') + '</p>' : '',
            resultPlaceholder,
            previousSourceValue
        );
        syncPlaceholders();
        scheduleTextareaHeightsSync();
    };

    const requestTranslation = function () {
        const text = sourceInput.value.trim();
        const requestId = activeRequestId + 1;
        activeRequestId = requestId;
        if (!text) {
            setRenderedOutput('', resultPlaceholder, '');
            scheduleTextareaHeightsSync();
            setBusy(false);
            return;
        }

        setBusy(true);
        setRenderedOutput('', translatingLabel, '');
        targetOutput.setAttribute('data-placeholder', translatingLabel);
        scheduleTextareaHeightsSync();

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
                        throw new Error(String(selectServerMessage(payload, translateErrorLabel)));
                    }
                    return payload;
                });
            })
            .then(function (payload) {
                if (requestId !== activeRequestId) {
                    return;
                }
                const rawTranslation = String(payload.translation || '');
                const renderedTranslation = String(payload.translation_html || '');
                setRenderedOutput(
                    renderedTranslation || (rawTranslation ? '<p>' + escapeHtml(rawTranslation).replace(/\n/g, '<br>') + '</p>' : ''),
                    resultPlaceholder,
                    rawTranslation
                );
                targetOutput.setAttribute('data-placeholder', resultPlaceholder);
            })
            .catch(function (error) {
                if (requestId !== activeRequestId) {
                    return;
                }
                setRenderedOutput('', error && error.message ? error.message : translateErrorLabel, '');
                targetOutput.setAttribute('data-placeholder', error && error.message ? error.message : translateErrorLabel);
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

    if (copyButton) {
        copyButton.addEventListener('click', function () {
            const copyText = getCopyText();
            if (!copyText) {
                return;
            }
            writeClipboardText(copyText).then(showCopiedState).catch(function () {});
        });
    }

    if (sourceClearButton) {
        sourceClearButton.addEventListener('click', function () {
            activeRequestId += 1;
            sourceInput.value = '';
            syncSourcePlaceholderState();
            setRenderedOutput('', resultPlaceholder, '');
            targetOutput.setAttribute('data-placeholder', resultPlaceholder);
            setBusy(false);
            scheduleTextareaHeightsSync();
            sourceInput.focus();
        });
    }

    sourceInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            requestTranslation();
        }
    });

    sourceInput.addEventListener('input', function () {
        syncSourcePlaceholderState();
        scheduleTextareaHeightsSync();
    });

    window.addEventListener('resize', scheduleTextareaHeightsSync, { passive: true });

    syncPlaceholders();
    syncSourcePlaceholderState();
    setCopyButtonState(false);
    scheduleTextareaHeightsSync();
})();
