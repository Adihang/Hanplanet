(function () {
    "use strict";

    // HanDrive 목록/보기/쓰기 페이지 공통 클라이언트 엔트리.
    // 페이지 타입에 따라 list, view, write 초기화 루틴 중 하나를 실행한다.

    // 문서 페이지 루트 요소 확인
    const root = document.querySelector("[data-handrive-page]");
    if (!root) {
        return;
    }

    const pageType = root.dataset.handrivePage;
    const uiLang = String(root.dataset.uiLang || "ko").trim().toLowerCase() === "en" ? "en" : "ko";
    const sharedOwnerUsername = String(root.dataset.handriveSharedOwnerUsername || "").trim();
    const sharedSlug = String(root.dataset.handriveSharedSlug || "").trim();
    const sharedRootPath = String(root.dataset.handriveSharedRootPath || "").trim();
    const handriveAdminUser = String(root.dataset.handriveAdminUser || "").trim();
    const handriveAdminUserParam = String(root.dataset.handriveAdminUserParam || "handrive_user").trim() || "handrive_user";

    document.addEventListener("click", function (event) {
        const proxyButton = event.target && event.target.closest
            ? event.target.closest("[data-handrive-click-target]")
            : null;
        if (!proxyButton || proxyButton.disabled) {
            return;
        }
        const targetId = proxyButton.getAttribute("data-handrive-click-target");
        const targetButton = targetId ? document.getElementById(targetId) : null;
        if (!targetButton || typeof targetButton.click !== "function") {
            return;
        }
        event.preventDefault();
        targetButton.click();
    });

    window.addEventListener("message", function (event) {
        const data = event && event.data && typeof event.data === "object" ? event.data : null;
        if (!data || data.type !== "handrive-office-preview-size") {
            return;
        }
        const width = Math.max(1, Math.ceil(Number(data.width) || 0));
        const height = Math.max(1, Math.ceil(Number(data.height) || 0));
        if (!width || !height) {
            return;
        }
        const frames = Array.prototype.slice.call(document.querySelectorAll(".handrive-office .handrive-html-live-frame"));
        const frame = frames.find(function (candidate) {
            return candidate && candidate.contentWindow === event.source;
        });
        if (!frame) {
            return;
        }
        const wrap = frame.closest(".handrive-html-live-wrap");
        const article = frame.closest(".handrive-office");
        const viewportWidth = Math.max(1, Number(article ? article.clientWidth : frame.clientWidth) || 0);
        const appliedWidth = Math.max(viewportWidth, width);
        if (event.source && typeof event.source.postMessage === "function") {
            event.source.postMessage({
                type: "handrive-office-preview-viewport",
                width: viewportWidth,
            }, "null");
        }
        if (wrap) {
            wrap.style.width = appliedWidth + "px";
            wrap.style.maxWidth = "none";
            wrap.style.height = height + "px";
        }
        frame.style.width = appliedWidth + "px";
        frame.style.maxWidth = "none";
        frame.style.height = height + "px";
    });

    function hasSharedContext() {
        return Boolean(sharedOwnerUsername && sharedSlug);
    }

    function appendSharedQuery(url) {
        let nextUrl = String(url || "").trim();
        if (!nextUrl) {
            return nextUrl;
        }
        if (hasSharedContext()) {
            nextUrl = appendQueryParam(nextUrl, "share_owner", sharedOwnerUsername);
            nextUrl = appendQueryParam(nextUrl, "share_slug", sharedSlug);
        }
        return appendAdminHandriveUserQuery(nextUrl);
    }

    function appendQueryParam(url, key, value) {
        const baseUrl = String(url || "").trim();
        if (!baseUrl) {
            return baseUrl;
        }
        const hashIndex = baseUrl.indexOf("#");
        const hash = hashIndex === -1 ? "" : baseUrl.slice(hashIndex);
        const beforeHash = hashIndex === -1 ? baseUrl : baseUrl.slice(0, hashIndex);
        const queryIndex = beforeHash.indexOf("?");
        const pathPart = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);
        const queryPart = queryIndex === -1 ? "" : beforeHash.slice(queryIndex + 1);
        const params = new URLSearchParams(queryPart);
        params.set(key, value || "");
        const queryString = params.toString();
        return pathPart + (queryString ? "?" + queryString : "") + hash;
    }

    function appendAdminHandriveUserQuery(url) {
        if (!handriveAdminUser) {
            return String(url || "").trim();
        }
        return appendQueryParam(url, handriveAdminUserParam, handriveAdminUser);
    }

    function syncEditorMirrorScroll(textarea, mirror, mirrorCode) {
        if (!textarea || !mirror) {
            return;
        }
        const scrollTop = Number(textarea.scrollTop) || 0;
        const scrollLeft = Number(textarea.scrollLeft) || 0;
        if (mirrorCode && mirrorCode.style) {
            mirrorCode.style.transform = "translate(" + (-scrollLeft) + "px, " + (-scrollTop) + "px)";
        }
        mirror.scrollTop = 0;
        mirror.scrollLeft = 0;
    }

    const lazyScriptLoadPromises = Object.create(null);

    function loadLazyScriptOnce(scriptUrl, globalName) {
        const url = String(scriptUrl || "").trim();
        if (globalName && window[globalName]) {
            return Promise.resolve(window[globalName]);
        }
        if (!url) {
            return Promise.reject(new Error("Required script URL is missing."));
        }
        if (lazyScriptLoadPromises[url]) {
            return lazyScriptLoadPromises[url];
        }
        lazyScriptLoadPromises[url] = new Promise(function (resolve, reject) {
            const existingScript = Array.prototype.slice.call(document.scripts || []).find(function (candidate) {
                return candidate && candidate.getAttribute("src") === url;
            });
            if (existingScript && (globalName ? window[globalName] : true)) {
                resolve(globalName ? window[globalName] : existingScript);
                return;
            }
            const script = document.createElement("script");
            script.src = url;
            script.async = false;
            script.onload = function () {
                resolve(globalName ? window[globalName] : script);
            };
            script.onerror = function () {
                delete lazyScriptLoadPromises[url];
                reject(new Error("Script load failed: " + url));
            };
            document.head.appendChild(script);
        });
        return lazyScriptLoadPromises[url];
    }

    function renderHandriveMermaidDiagrams(container) {
        if (
            !window.HanplanetMarkdownMermaid ||
            typeof window.HanplanetMarkdownMermaid.render !== "function"
        ) {
            return Promise.resolve([]);
        }
        return window.HanplanetMarkdownMermaid.render(container);
    }

    function clampMarkdownIndex(value, index) {
        const length = String(value || "").length;
        const numberValue = Number(index);
        if (!Number.isFinite(numberValue)) {
            return 0;
        }
        return Math.max(0, Math.min(length, Math.floor(numberValue)));
    }

    function stripMarkdownOuterDecorations(text) {
        let result = String(text || "");
        let removedCodeFence = false;
        let changed = true;

        while (changed) {
            changed = false;
            const patterns = [
                {
                    pattern: /^(\s*)```[^\r\n`]*\r?\n([\s\S]*?)\r?\n```(\s*)$/,
                    isCodeFence: true,
                },
                { pattern: /^(\s*)!\[([\s\S]*?)\]\([^\r\n)]*\)(\s*)$/ },
                { pattern: /^(\s*)\[([\s\S]*?)\]\([^\r\n)]*\)(\s*)$/ },
                { pattern: /^(\s*)(\*\*|__)([\s\S]*?)\2(\s*)$/, bodyIndex: 3 },
                { pattern: /^(\s*)`([\s\S]*?)`(\s*)$/ },
                { pattern: /^(\s*)(\*|_)([\s\S]*?)\2(\s*)$/, bodyIndex: 3 },
            ];

            for (let index = 0; index < patterns.length; index += 1) {
                const entry = patterns[index];
                const match = result.match(entry.pattern);
                if (!match) {
                    continue;
                }
                const bodyIndex = entry.bodyIndex || 2;
                const suffixIndex = bodyIndex + 1;
                result = (match[1] || "") + (match[bodyIndex] || "") + (match[suffixIndex] || "");
                removedCodeFence = removedCodeFence || Boolean(entry.isCodeFence);
                changed = true;
                break;
            }
        }

        return { text: result, removedCodeFence: removedCodeFence };
    }

    function stripMarkdownLinePrefixes(text) {
        const lines = String(text || "").split(/\r?\n/);
        let changed = false;
        const transformed = lines.map(function (line) {
            if (!line.trim()) {
                return line;
            }
            const nextLine = line.replace(
                /^(\s{0,3})(?:#{1,6}\s+|>\s?|-\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+)/,
                "$1"
            );
            if (nextLine !== line) {
                changed = true;
            }
            return nextLine;
        });
        return changed ? transformed.join("\n") : String(text || "");
    }

    function stripMarkdownDecorations(text) {
        const outer = stripMarkdownOuterDecorations(text);
        if (outer.removedCodeFence) {
            return outer.text;
        }

        let result = stripMarkdownLinePrefixes(outer.text);
        let previous = "";
        while (result !== previous) {
            previous = result;
            const nextOuter = stripMarkdownOuterDecorations(result);
            result = nextOuter.removedCodeFence ? nextOuter.text : stripMarkdownLinePrefixes(nextOuter.text);
        }
        return result;
    }

    function getMarkdownLineStart(value, index) {
        const previousBreak = String(value || "").lastIndexOf("\n", Math.max(0, index - 1));
        return previousBreak === -1 ? 0 : previousBreak + 1;
    }

    function expandMarkdownInlineWrapper(value, range) {
        const text = String(value || "");
        const wrappers = [
            ["**", "**"],
            ["__", "__"],
            ["`", "`"],
            ["*", "*"],
            ["_", "_"],
        ];

        for (let index = 0; index < wrappers.length; index += 1) {
            const prefix = wrappers[index][0];
            const suffix = wrappers[index][1];
            if (
                range.start >= prefix.length &&
                text.slice(range.start - prefix.length, range.start) === prefix &&
                text.slice(range.end, range.end + suffix.length) === suffix
            ) {
                return {
                    start: range.start - prefix.length,
                    end: range.end + suffix.length,
                    changed: true,
                };
            }
        }

        const linkSuffix = text.slice(range.end).match(/^\]\([^\r\n)]*\)/);
        if (linkSuffix) {
            if (range.start >= 2 && text.slice(range.start - 2, range.start) === "![") {
                return {
                    start: range.start - 2,
                    end: range.end + linkSuffix[0].length,
                    changed: true,
                };
            }
            if (range.start >= 1 && text.slice(range.start - 1, range.start) === "[") {
                return {
                    start: range.start - 1,
                    end: range.end + linkSuffix[0].length,
                    changed: true,
                };
            }
        }

        return { start: range.start, end: range.end, changed: false };
    }

    function expandMarkdownLinePrefix(value, range) {
        const text = String(value || "");
        const lineStart = getMarkdownLineStart(text, range.start);
        if (lineStart >= range.start) {
            return { start: range.start, end: range.end, changed: false };
        }

        const prefix = text.slice(lineStart, range.start);
        if (/^(?:\s{0,3})(?:#{1,6}\s+|>\s?|-\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+)$/.test(prefix)) {
            return { start: lineStart, end: range.end, changed: true };
        }

        return { start: range.start, end: range.end, changed: false };
    }

    function expandMarkdownSelectionRange(value, start, end) {
        let range = {
            start: clampMarkdownIndex(value, Math.min(start, end)),
            end: clampMarkdownIndex(value, Math.max(start, end)),
        };

        let changed = true;
        while (changed) {
            changed = false;
            const inlineRange = expandMarkdownInlineWrapper(value, range);
            if (inlineRange.changed) {
                range = { start: inlineRange.start, end: inlineRange.end };
                changed = true;
                continue;
            }

            const lineRange = expandMarkdownLinePrefix(value, range);
            if (lineRange.changed) {
                range = { start: lineRange.start, end: lineRange.end };
                changed = true;
            }
        }

        return range;
    }

    function getMarkdownSnippetSelection(textarea) {
        if (!textarea) {
            return { body: "", hasSelection: false, replaceStart: 0, replaceEnd: 0 };
        }

        const value = String(textarea.value || "");
        const rawStart = clampMarkdownIndex(value, textarea.selectionStart || 0);
        const rawEnd = clampMarkdownIndex(value, textarea.selectionEnd || 0);
        const hasSelection = rawStart !== rawEnd;
        if (!hasSelection) {
            return { body: "", hasSelection: false, replaceStart: rawStart, replaceEnd: rawEnd };
        }

        const range = expandMarkdownSelectionRange(value, rawStart, rawEnd);
        return {
            body: stripMarkdownDecorations(value.slice(range.start, range.end)),
            hasSelection: true,
            replaceStart: range.start,
            replaceEnd: range.end,
        };
    }

    function parseDelimitedRows(text, delimiter) {
        const source = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        const rows = [];
        let row = [];
        let field = "";
        let inQuotes = false;

        for (let index = 0; index < source.length; index += 1) {
            const char = source[index];

            if (inQuotes) {
                if (char === "\"") {
                    if (source[index + 1] === "\"") {
                        field += "\"";
                        index += 1;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    field += char;
                }
                continue;
            }

            if (char === "\"" && field === "") {
                inQuotes = true;
                continue;
            }

            if (char === delimiter) {
                row.push(field);
                field = "";
                continue;
            }

            if (char === "\n") {
                row.push(field);
                rows.push(row);
                row = [];
                field = "";
                continue;
            }

            field += char;
        }

        row.push(field);
        rows.push(row);

        return rows.filter(function (candidate) {
            return candidate.some(function (cell) {
                return String(cell || "").trim();
            });
        });
    }

    function detectDelimitedRows(text) {
        const source = String(text || "").trim();
        if (!source) {
            return null;
        }

        const candidates = [",", "\t", ";"];
        let best = null;

        candidates.forEach(function (delimiter) {
            const rows = parseDelimitedRows(source, delimiter);
            const maxColumns = rows.reduce(function (maxValue, row) {
                return Math.max(maxValue, row.length);
            }, 0);
            const multiColumnRows = rows.filter(function (row) {
                return row.length > 1;
            }).length;

            if (maxColumns < 2 || multiColumnRows < 1) {
                return;
            }

            const consistentRows = rows.filter(function (row) {
                return row.length === maxColumns;
            }).length;
            const score = (multiColumnRows * 100) + (consistentRows * 10) + maxColumns;
            if (!best || score > best.score) {
                best = {
                    rows: rows,
                    columnCount: maxColumns,
                    score: score,
                };
            }
        });

        if (!best) {
            return null;
        }

        return best.rows.map(function (row) {
            const nextRow = row.slice(0, best.columnCount);
            while (nextRow.length < best.columnCount) {
                nextRow.push("");
            }
            return nextRow;
        });
    }

    function escapeMarkdownTableCell(value) {
        return String(value || "")
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n")
            .trim()
            .replace(/\n/g, "<br>")
            .replace(/\|/g, "\\|");
    }

    function buildMarkdownTableFromDelimitedText(text) {
        const rows = detectDelimitedRows(text);
        if (!rows || !rows.length || rows[0].length < 2) {
            return "";
        }

        const columnCount = rows[0].length;
        const formatRow = function (cells) {
            return "| " + cells.map(escapeMarkdownTableCell).join(" | ") + " |";
        };

        const lines = [
            formatRow(rows[0]),
            formatRow(Array(columnCount).fill("---")),
        ];

        rows.slice(1).forEach(function (row) {
            lines.push(formatRow(row));
        });

        return lines.join("\n");
    }

    function getMediaEditorGlobalName(kind) {
        if (kind === "image") return "HandriveImageEditor";
        if (kind === "video") return "HandriveVideoEditor";
        if (kind === "audio") return "HandriveAudioEditor";
        if (kind === "pdf") return "HandrivePdfEditor";
        return "";
    }

    let videoPlayerStackPromise = null;

    function loadOptionalLazyScriptOnce(scriptUrl) {
        const url = String(scriptUrl || "").trim();
        if (!url) {
            return Promise.resolve(null);
        }
        return loadLazyScriptOnce(url).catch(function () {
            return null;
        });
    }

    function notifyVideoOptionalScriptsReady() {
        try {
            window.dispatchEvent(new CustomEvent("handrive:video-optional-scripts-ready"));
        } catch (_) {}
    }

    function loadVideoPlayerStack() {
        if (
            window.HandriveVideoPlayer &&
            typeof window.HandriveVideoPlayer.init === "function"
        ) {
            return Promise.resolve(window.HandriveVideoPlayer);
        }
        if (videoPlayerStackPromise) {
            return videoPlayerStackPromise;
        }

        const videojsScriptUrl = root.dataset.videojsScriptUrl || "";
        const compatScriptUrl = root.dataset.videojsCompatScriptUrl || "";
        const seekButtonsScriptUrl = root.dataset.videojsSeekButtonsScriptUrl || "";
        const hotkeysScriptUrl = root.dataset.videojsHotkeysScriptUrl || "";
        const mobileUiScriptUrl = root.dataset.videojsMobileUiScriptUrl || "";
        const videoPlayerScriptUrl = root.dataset.videoPlayerScriptUrl || "";
        const chromecastScriptUrl = root.dataset.videojsChromecastScriptUrl || "https://cdn.jsdelivr.net/npm/@silvermine/videojs-chromecast@1.5.0/dist/silvermine-videojs-chromecast.min.js";
        const castSenderScriptUrl = root.dataset.googleCastSenderScriptUrl || "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
        const hlsQualitySelectorScriptUrl = root.dataset.videojsHlsQualitySelectorScriptUrl || "https://cdn.jsdelivr.net/npm/videojs-hls-quality-selector@2.0.0/dist/videojs-hls-quality-selector.min.js";

        videoPlayerStackPromise = loadLazyScriptOnce(videojsScriptUrl, "videojs")
            .then(function () {
                return loadOptionalLazyScriptOnce(compatScriptUrl);
            })
            .then(function () {
                const deferredOptionalLoads = [
                    chromecastScriptUrl,
                    castSenderScriptUrl,
                    hlsQualitySelectorScriptUrl,
                ].filter(function (scriptUrl) {
                    return Boolean(String(scriptUrl || "").trim());
                }).map(loadOptionalLazyScriptOnce);
                if (deferredOptionalLoads.length) {
                    Promise.all(deferredOptionalLoads).then(
                        notifyVideoOptionalScriptsReady,
                        notifyVideoOptionalScriptsReady
                    );
                } else {
                    notifyVideoOptionalScriptsReady();
                }
                return Promise.all([
                    loadOptionalLazyScriptOnce(seekButtonsScriptUrl),
                    loadOptionalLazyScriptOnce(hotkeysScriptUrl),
                    loadOptionalLazyScriptOnce(mobileUiScriptUrl),
                ]);
            })
            .then(function () {
                return loadLazyScriptOnce(videoPlayerScriptUrl, "HandriveVideoPlayer");
            })
            .catch(function (error) {
                videoPlayerStackPromise = null;
                throw error;
            });
        return videoPlayerStackPromise;
    }

    function getAbsoluteResourceUrl(rawUrl) {
        const url = String(rawUrl || "").trim();
        if (!url) {
            return "";
        }
        try {
            return new URL(url, window.location.href).href;
        } catch (error) {
            return url;
        }
    }

    function getPrintStylesheetLinks() {
        return Array.from(document.querySelectorAll('link[rel~="stylesheet"][href]'))
            .map(function (link) {
                return '<link rel="stylesheet" href="' + escapeHtml(link.href) + '">';
            })
            .join("");
    }

    function waitForPrintImages(printDocument, timeoutMs) {
        const images = Array.from(printDocument.querySelectorAll("img"));
        if (!images.length) {
            return Promise.resolve();
        }
        const imagePromises = images.map(function (image) {
            if (image.complete && image.naturalWidth > 0) {
                return Promise.resolve();
            }
            if (typeof image.decode === "function") {
                return image.decode().catch(function () {});
            }
            return new Promise(function (resolve) {
                image.addEventListener("load", resolve, { once: true });
                image.addEventListener("error", resolve, { once: true });
            });
        });
        return Promise.race([
            Promise.all(imagePromises),
            new Promise(function (resolve) {
                window.setTimeout(resolve, timeoutMs || 3000);
            }),
        ]);
    }

    function sanitizeStyleTextForPrint(styleText) {
        return String(styleText || "").replace(/<\/style/gi, "<\\/style");
    }

    function sanitizePrintHtmlFragment(rootElement) {
        if (!rootElement) {
            return;
        }
        rootElement.querySelectorAll("script,iframe,object,embed,form").forEach(function (node) {
            node.remove();
        });
        rootElement.querySelectorAll("*").forEach(function (node) {
            Array.from(node.attributes || []).forEach(function (attribute) {
                const name = String(attribute.name || "").toLowerCase();
                const value = String(attribute.value || "").trim();
                if (
                    name.indexOf("on") === 0 ||
                    name === "srcdoc" ||
                    ((name === "href" || name === "src") && /^javascript:/i.test(value))
                ) {
                    node.removeAttribute(attribute.name);
                }
            });
        });
    }

    function extractSrcdocForOfficePrint(srcdoc) {
        const source = String(srcdoc || "").trim();
        if (!source || typeof DOMParser === "undefined") {
            return null;
        }
        const parsed = new DOMParser().parseFromString(source, "text/html");
        if (!parsed || !parsed.body) {
            return null;
        }
        sanitizePrintHtmlFragment(parsed.body);
        const cssText = Array.from(parsed.querySelectorAll("style"))
            .map(function (styleNode) {
                return styleNode.textContent || "";
            })
            .join("\n");
        const bodyHtml = parsed.body.innerHTML || "";
        if (!bodyHtml.trim()) {
            return null;
        }
        return {
            bodyHtml: bodyHtml,
            cssText: sanitizeStyleTextForPrint(cssText),
        };
    }

    function getOfficePrintStyle(options) {
        const settings = options || {};
        const pageRule = settings.isSheet
            ? "@page{size:landscape;margin:10mm;}@media print{@page{size:landscape;margin:10mm;}}"
            : "@page{margin:12mm;}@media print{@page{margin:12mm;}}";
        return pageRule
            + "body.handrive-print-office-body{overflow:visible;padding:0;background:#fff;color:#111;}"
            + ".handrive-print-office-live{display:block;width:100%;max-width:100%;overflow:visible;margin:0;padding:0;background:#fff;color:#111;font-family:KakaoSmallFont,Inter,Arial,sans-serif;font-size:12px;line-height:1.35;}"
            + ".handrive-print-office-live *{box-sizing:border-box;}"
            + ".handrive-print-office-live #handrive-office-zoom-viewport,.handrive-print-office-live #handrive-office-zoom-content{display:block;width:auto;height:auto;min-width:0;min-height:0;max-width:none;max-height:none;overflow:visible;transform:none;}"
            + ".handrive-print-office-live table{width:100%;max-width:100%;border-collapse:collapse;border-spacing:0;table-layout:auto;break-inside:auto;page-break-inside:auto;background:#fff;}"
            + ".handrive-print-office-live col{width:auto;}"
            + ".handrive-print-office-live tr{break-inside:avoid;page-break-inside:avoid;}"
            + ".handrive-print-office-live td,.handrive-print-office-live th{border:1px solid #d0d7de;padding:4px 6px;vertical-align:top;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;background:#fff;color:#111;}"
            + ".handrive-print-office-live th{font-weight:700;background:#f6f8fa;}"
            + ".handrive-print-office-live img{max-width:100%;height:auto;}"
            + ".handrive-print-office-live p{margin:0 0 8px;}"
            + ".handrive-print-office-live h1,.handrive-print-office-live h2,.handrive-print-office-live h3{break-after:avoid;page-break-after:avoid;}";
    }

    function writePrintDocument(printWindow, options) {
        const settings = options || {};
        const title = String(settings.title || document.title || "HanDrive").trim() || "HanDrive";
        const bodyClass = String(settings.bodyClass || "").trim();
        const bodyHtml = String(settings.bodyHtml || "");
        const extraStyle = String(settings.extraStyle || "");
        printWindow.document.open();
        printWindow.document.write(
            "<!doctype html><html><head><meta charset=\"utf-8\">"
            + "<title>" + escapeHtml(title) + "</title>"
            + "<base href=\"" + escapeHtml(window.location.href) + "\">"
            + getPrintStylesheetLinks()
            + "<style>"
            + "html,body{margin:0;padding:0;background:#fff;color:#111;}"
            + "body.handrive-print-document{display:block;min-height:0;overflow:visible;padding:12mm;box-sizing:border-box;}"
            + ".handrive-print-rendered{display:block;width:100%;max-width:none;height:auto;min-height:0;max-height:none;overflow:visible;margin:0;padding:0;border:0;border-radius:0;background:#fff;color:#111;box-shadow:none;}"
            + ".handrive-print-rendered pre,.handrive-print-rendered code{white-space:pre-wrap;overflow:visible;}"
            + ".handrive-print-rendered table{max-width:none;break-inside:auto;page-break-inside:auto;}"
            + ".handrive-print-rendered.ui-markdown table,.handrive-print-rendered.handrive-markdown table,.handrive-print-rendered .ui-markdown table,.handrive-print-rendered .handrive-markdown table{width:calc(100% - 1px);max-width:calc(100% - 1px);box-sizing:border-box;}"
            + ".handrive-print-rendered.ui-markdown th,.handrive-print-rendered.ui-markdown td,.handrive-print-rendered.handrive-markdown th,.handrive-print-rendered.handrive-markdown td,.handrive-print-rendered .ui-markdown th,.handrive-print-rendered .ui-markdown td,.handrive-print-rendered .handrive-markdown th,.handrive-print-rendered .handrive-markdown td{box-sizing:border-box;}"
            + ".handrive-print-rendered.handrive-office,.handrive-print-rendered .handrive-office{display:block;overflow:visible;max-width:100%;}"
            + ".handrive-print-rendered.handrive-office .handrive-office-sheet-section,.handrive-print-rendered.handrive-office .handrive-office-slide,.handrive-print-rendered .handrive-office .handrive-office-sheet-section,.handrive-print-rendered .handrive-office .handrive-office-slide{break-inside:auto;page-break-inside:auto;border:1px solid #d0d7de;border-radius:0;background:#fff;}"
            + ".handrive-print-rendered.handrive-office .handrive-office-table-wrap,.handrive-print-rendered .handrive-office .handrive-office-table-wrap{overflow:visible;max-width:100%;}"
            + ".handrive-print-rendered.handrive-office .handrive-office-table,.handrive-print-rendered .handrive-office .handrive-office-table{width:100%;max-width:100%;min-width:0;table-layout:auto;}"
            + ".handrive-print-rendered.handrive-office .handrive-office-table td,.handrive-print-rendered.handrive-office .handrive-office-table th,.handrive-print-rendered .handrive-office .handrive-office-table td,.handrive-print-rendered .handrive-office .handrive-office-table th{box-sizing:border-box;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;}"
            + ".handrive-print-rendered tr,.handrive-print-rendered img{break-inside:avoid;page-break-inside:avoid;}"
            + ".handrive-print-rendered .handrive-office-table-wrap,.handrive-print-rendered .handrive-html-live-wrap,.handrive-print-rendered .handrive-media-wrap{overflow:visible;max-width:none;}"
            + ".handrive-print-image{display:flex;align-items:center;justify-content:center;min-height:calc(100vh - 24mm);margin:0;}"
            + ".handrive-print-image img{display:block;max-width:100%;max-height:calc(100vh - 24mm);object-fit:contain;}"
            + ".handrive-print-file-card{font-family:KakaoSmallFont,Inter,Arial,sans-serif;border:1px solid #d0d0d0;border-radius:8px;padding:18px;}"
            + ".handrive-print-file-card-title{font-size:18px;font-weight:700;margin:0 0 8px;color:#111;}"
            + ".handrive-print-file-card-meta{font-size:13px;color:#555;word-break:break-all;}"
            + ".handrive-print-frame-body{padding:0;}"
            + ".handrive-print-frame{position:fixed;inset:0;width:100%;height:100%;border:0;background:#fff;}"
            + "@page{margin:12mm;}"
            + "@media print{body.handrive-print-document{padding:0}.handrive-print-frame-body{padding:0}@page{margin:12mm}}"
            + extraStyle
            + "</style></head><body class=\"handrive-page handrive-print-document " + escapeHtml(bodyClass) + "\">"
            + bodyHtml
            + "</body></html>"
        );
        printWindow.document.close();
    }

    function openPrintWindow(options) {
        const printWindow = window.open("", "_blank");
        if (!printWindow) {
            window.alert(t("print_popup_blocked", "인쇄 창을 열 수 없습니다. 팝업 차단을 해제해주세요."));
            return null;
        }
        writePrintDocument(printWindow, options);
        return printWindow;
    }

    function runPrintWindow(printWindow, waitForImages) {
        if (!printWindow) {
            return;
        }
        const printDocument = printWindow.document;
        let printed = false;
        const triggerPrint = function () {
            if (printed) {
                return;
            }
            printed = true;
            const readyPromise = waitForImages
                ? waitForPrintImages(printDocument, 3500)
                : Promise.resolve();
            readyPromise.then(function () {
                printWindow.focus();
                printWindow.print();
            });
        };
        printWindow.addEventListener("afterprint", function () {
            window.setTimeout(function () {
                try {
                    printWindow.close();
                } catch (error) {}
            }, 250);
        }, { once: true });
        if (printDocument.readyState === "complete") {
            window.setTimeout(triggerPrint, 120);
        } else {
            printWindow.addEventListener("load", function () {
                window.setTimeout(triggerPrint, 120);
            }, { once: true });
            window.setTimeout(triggerPrint, 1800);
        }
    }

    function printFrameSource(frameSource, title) {
        const sourceUrl = getAbsoluteResourceUrl(frameSource);
        if (!sourceUrl) {
            return false;
        }
        const printWindow = openPrintWindow({
            title: title,
            bodyClass: "handrive-print-frame-body",
            bodyHtml: '<iframe class="handrive-print-frame" src="' + escapeHtml(sourceUrl) + '"></iframe>',
            extraStyle: "@page{margin:0;}@media print{@page{margin:0;}}",
        });
        if (!printWindow) {
            return false;
        }
        const frame = printWindow.document.querySelector(".handrive-print-frame");
        let printed = false;
        const triggerFramePrint = function () {
            if (printed) {
                return;
            }
            printed = true;
            try {
                frame.contentWindow.focus();
                frame.contentWindow.print();
            } catch (error) {
                printWindow.focus();
                printWindow.print();
            }
        };
        printWindow.addEventListener("afterprint", function () {
            window.setTimeout(function () {
                try {
                    printWindow.close();
                } catch (error) {}
            }, 250);
        }, { once: true });
        if (frame) {
            frame.addEventListener("load", function () {
                window.setTimeout(triggerFramePrint, 500);
            }, { once: true });
        }
        window.setTimeout(triggerFramePrint, 2200);
        return true;
    }

    function printSrcdocFrame(frame, title) {
        if (!frame) {
            return false;
        }
        const srcdoc = frame.getAttribute("srcdoc") || "";
        if (!srcdoc) {
            return false;
        }
        const rect = frame.getBoundingClientRect();
        const frameHeight = Math.max(900, Math.ceil(Number(rect.height || 0)));
        const printWindow = openPrintWindow({
            title: title,
            bodyClass: "handrive-print-frame-body",
            bodyHtml: '<iframe class="handrive-print-frame" sandbox="allow-scripts" srcdoc="' + escapeHtml(srcdoc) + '"></iframe>',
            extraStyle:
                ".handrive-print-frame{position:static;display:block;width:100%;height:" + frameHeight + "px;min-height:100vh;}"
                + "@media print{.handrive-print-frame{height:" + frameHeight + "px;min-height:100vh;}}",
        });
        runPrintWindow(printWindow, false);
        return Boolean(printWindow);
    }

    function printOfficeSrcdocFrame(frame, title, options) {
        if (!frame) {
            return false;
        }
        const parsedOfficeDocument = extractSrcdocForOfficePrint(frame.getAttribute("srcdoc") || "");
        if (!parsedOfficeDocument) {
            return false;
        }
        const officeStyle = parsedOfficeDocument.cssText + "\n" + getOfficePrintStyle(options);
        const printWindow = openPrintWindow({
            title: title,
            bodyClass: "handrive-print-office-body",
            bodyHtml: '<section class="handrive-print-office-live">' + parsedOfficeDocument.bodyHtml + "</section>",
            extraStyle: officeStyle,
        });
        runPrintWindow(printWindow, true);
        return Boolean(printWindow);
    }

    function cloneRenderedContentForPrint(contentElement) {
        if (!contentElement) {
            return "";
        }
        const clone = contentElement.cloneNode(true);
        clone.removeAttribute("id");
        clone.querySelectorAll("script,.handrive-list-preview-loading,.handrive-frame-loading,.handrive-office-frame-loading").forEach(function (node) {
            node.remove();
        });
        clone.querySelectorAll("video,audio").forEach(function (mediaElement) {
            mediaElement.setAttribute("controls", "");
            mediaElement.removeAttribute("autoplay");
        });
        clone.classList.add("handrive-print-rendered");
        return clone.outerHTML;
    }

    function printRenderedHtmlContent(contentElement, title) {
        const printWindow = openPrintWindow({
            title: title,
            bodyClass: "handrive-print-content-body",
            bodyHtml: cloneRenderedContentForPrint(contentElement),
        });
        runPrintWindow(printWindow, true);
        return Boolean(printWindow);
    }

    function printImageUrl(imageUrl, title) {
        const safeUrl = getAbsoluteResourceUrl(imageUrl);
        if (!safeUrl) {
            return false;
        }
        const printWindow = openPrintWindow({
            title: title,
            bodyClass: "handrive-print-image-body",
            bodyHtml: '<figure class="handrive-print-image"><img src="' + escapeHtml(safeUrl) + '" alt="' + escapeHtml(title || "") + '"></figure>',
        });
        runPrintWindow(printWindow, true);
        return Boolean(printWindow);
    }

    function printFileCard(title, sourceUrl) {
        const safeTitle = String(title || "HanDrive").trim() || "HanDrive";
        const safeSourceUrl = getAbsoluteResourceUrl(sourceUrl);
        const printWindow = openPrintWindow({
            title: safeTitle,
            bodyClass: "handrive-print-file-card-body",
            bodyHtml:
                '<section class="handrive-print-file-card">'
                + '<h1 class="handrive-print-file-card-title">' + escapeHtml(safeTitle) + '</h1>'
                + (safeSourceUrl ? '<div class="handrive-print-file-card-meta">' + escapeHtml(safeSourceUrl) + '</div>' : "")
                + "</section>",
        });
        runPrintWindow(printWindow, false);
        return Boolean(printWindow);
    }

    function printRenderedHandriveFile(contentElement, options) {
        const settings = options || {};
        const title = String(settings.title || document.title || "HanDrive").trim() || "HanDrive";
        if (!contentElement) {
            return false;
        }

        const isOfficeContent = contentElement.classList.contains("handrive-office");
        const hasSpreadsheetPreview = Boolean(
            contentElement.matches &&
            contentElement.matches("[data-handrive-spreadsheet-preview]")
        ) || Boolean(
            contentElement.querySelector &&
            contentElement.querySelector("[data-handrive-spreadsheet-preview]")
        );
        if (
            hasSpreadsheetPreview &&
            window.HandriveSpreadsheetEditor &&
            typeof window.HandriveSpreadsheetEditor.buildPreviewPrint === "function"
        ) {
            const spreadsheetPrint = window.HandriveSpreadsheetEditor.buildPreviewPrint(contentElement, { title: title });
            if (spreadsheetPrint && spreadsheetPrint.bodyHtml) {
                const printWindow = openPrintWindow({
                    title: spreadsheetPrint.title || title,
                    bodyClass: "handrive-print-spreadsheet-body",
                    bodyHtml: spreadsheetPrint.bodyHtml,
                    extraStyle: spreadsheetPrint.extraStyle || "",
                });
                runPrintWindow(printWindow, true);
                return Boolean(printWindow);
            }
            window.alert(t("spreadsheet_print_not_ready", "스프레드시트를 불러온 뒤 다시 인쇄해주세요."));
            return true;
        }
        if (hasSpreadsheetPreview) {
            window.alert(t("spreadsheet_print_not_ready", "스프레드시트를 불러온 뒤 다시 인쇄해주세요."));
            return true;
        }
        const officePdfUrl = String(settings.officePdfUrl || "").trim();
        if (isOfficeContent && officePdfUrl && printFrameSource(officePdfUrl, title)) {
            return true;
        }

        const pdfFrame = contentElement.querySelector(".handrive-media-pdf-element");
        if (pdfFrame && printFrameSource(pdfFrame.getAttribute("src") || pdfFrame.src, title)) {
            return true;
        }

        const liveFrame = contentElement.querySelector(".handrive-html-live-frame");
        if (
            liveFrame &&
            isOfficeContent &&
            printOfficeSrcdocFrame(liveFrame, title, {
                isSheet: contentElement.classList.contains("handrive-office-sheet"),
                isPresentation: contentElement.classList.contains("handrive-office-presentation"),
                isWord: contentElement.classList.contains("handrive-office-word"),
            })
        ) {
            return true;
        }
        if (liveFrame && printSrcdocFrame(liveFrame, title)) {
            return true;
        }

        const imageElement = contentElement.querySelector(".handrive-media-image-element");
        if (imageElement && printImageUrl(imageElement.currentSrc || imageElement.src, title)) {
            return true;
        }

        const videoElement = contentElement.querySelector("video");
        if (videoElement) {
            return false;
        }

        const audioElement = contentElement.querySelector("audio");
        if (audioElement) {
            return printFileCard(title, audioElement.currentSrc || audioElement.src || settings.sourceUrl || "");
        }

        return printRenderedHtmlContent(contentElement, title);
    }

    // CSRF 토큰을 가져오는 함수
    function getCsrfToken() {
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta && meta.content) {
            return meta.content;
        }
        return "";
    }

    // 경로를 정규화하는 함수
    function normalizePath(raw, allowEmpty = true) {
        const source = String(raw || "").replace(/\\/g, "/").trim();
        const trimmed = source.replace(/^\/+|\/+$/g, "");
        if (!trimmed) {
            if (allowEmpty) {
                return "";
            }
            throw new Error(t("js_error_path_required", "경로를 입력해주세요."));
        }
        const parts = trimmed
            .split("/")
            .map(function (part) {
                return part.trim();
            })
            .filter(function (part) {
                return Boolean(part) && part !== ".";
            });

        if (parts.some(function (part) {
            return part === "..";
        })) {
            throw new Error(t("js_error_parent_path_not_allowed", "상위 경로(..)는 사용할 수 없습니다."));
        }

        return parts.join("/");
    }

    // 경로 세그먼트를 인코딩하는 함수
    function encodePathSegments(pathValue) {
        const normalized = normalizePath(pathValue, true);
        if (!normalized) {
            return "";
        }
        return normalized
            .split("/")
            .map(function (segment) {
                return encodeURIComponent(segment);
            })
            .join("/");
    }

    function decodeBreadcrumbLabel(label) {
        const source = String(label || "");
        if (source.indexOf("%") < 0) {
            return source;
        }
        try {
            return decodeURIComponent(source);
        } catch (error) {
            return source;
        }
    }

    function resolveReadableUrlPath(pathValue) {
        const normalized = normalizePath(pathValue, true);
        const resolver = window.HandriveUrlPathResolver;
        if (!normalized || !resolver || typeof resolver.toUrlPath !== "function") {
            return normalized;
        }
        try {
            return normalizePath(resolver.toUrlPath(normalized) || normalized, true);
        } catch (error) {
            return normalized;
        }
    }

    // 목록 URL을 구축하는 함수
    function buildListUrl(baseUrl, relativePath, rootUrl) {
        const encoded = encodePathSegments(resolveReadableUrlPath(relativePath));
        if (!encoded) {
            return appendSharedQuery(rootUrl || baseUrl);
        }
        return appendSharedQuery(baseUrl + "/" + encoded + "/list");
    }

    // 보기 URL을 구축하는 함수
    function buildViewUrl(baseUrl, slugPath) {
        const encoded = encodePathSegments(resolveReadableUrlPath(slugPath));
        if (!encoded) {
            return appendSharedQuery(baseUrl);
        }
        return appendSharedQuery(baseUrl + "/" + encoded);
    }

    function getGoogleDriveDocsEditorUrl(entry) {
        const googleDriveMeta = entry && entry.google_drive ? entry.google_drive : null;
        const docsEditorUrl = googleDriveMeta && googleDriveMeta.docs_editor_url
            ? String(googleDriveMeta.docs_editor_url).trim()
            : "";
        return docsEditorUrl.startsWith("https://docs.google.com/") ? docsEditorUrl : "";
    }

    function getParentPath(pathValue) {
        const normalized = normalizePath(pathValue, true);
        if (!normalized) {
            return "";
        }
        const parts = normalized.split("/");
        parts.pop();
        return parts.join("/");
    }

    // 쓰기 URL을 구축하는 함수
    function buildWriteUrl(writeBaseUrl, params) {
        const search = new URLSearchParams(params || {});
        const query = search.toString();
        return query ? writeBaseUrl + "?" + query : writeBaseUrl;
    }

    function selectServerMessage(payload, fallbackValue) {
        if (!payload || typeof payload !== "object") {
            return fallbackValue || "";
        }
        const messages = payload.error_messages || payload.messages;
        if (messages && typeof messages === "object") {
            const localized = messages[uiLang] || messages.ko || messages.en;
            if (localized) {
                return String(localized).trim();
            }
        }
        return String(payload.error_message || payload.message || payload.error || fallbackValue || "").trim();
    }

    window.HandriveSelectServerMessage = selectServerMessage;

    function shouldRetryJsonRequest(options) {
        const method = String((options && options.method) || "GET").trim().toUpperCase();
        return method === "GET" || method === "HEAD";
    }

    function waitForRequestRetry(delayMs) {
        return new Promise(function (resolve) {
            window.setTimeout(resolve, delayMs);
        });
    }

    // JSON 요청을 보내는 비동기 함수
    async function requestJson(url, options) {
        // Centralize JSON error normalization so every API caller gets the same
        // user-facing message shape regardless of the backend endpoint.
        let response = null;
        const requestUrl = appendAdminHandriveUserQuery(url);
        try {
            response = await fetch(requestUrl, options || {});
        } catch (error) {
            if (!shouldRetryJsonRequest(options)) {
                throw error;
            }
            await waitForRequestRetry(350);
            response = await fetch(requestUrl, options || {});
        }
        let payload = null;
        try {
            payload = await response.json();
        } catch (error) {
            payload = null;
        }

        if (!response.ok) {
            const error = new Error(selectServerMessage(payload, t("js_error_request_failed", "요청 처리 중 오류가 발생했습니다.")));
            error.payload = payload;
            throw error;
        }

        return payload;
    }

    async function requestFormDataJson(url, formData) {
        // Upload-related endpoints use FormData but still return JSON errors/success payloads.
        const response = await fetch(appendAdminHandriveUserQuery(url), {
            method: "POST",
            headers: {
                "X-CSRFToken": getCsrfToken()
            },
            body: formData
        });
        let payload = null;
        try {
            payload = await response.json();
        } catch (error) {
            payload = null;
        }

        if (!response.ok) {
            const error = new Error(selectServerMessage(payload, t("js_error_request_failed", "요청 처리 중 오류가 발생했습니다.")));
            error.payload = payload;
            throw error;
        }

        return payload;
    }

    function getImageFilesFromTransfer(dataTransfer) {
        if (!dataTransfer) {
            return [];
        }
        const files = [];
        if (dataTransfer.files && dataTransfer.files.length > 0) {
            Array.from(dataTransfer.files).forEach(function (file) {
                if (file && String(file.type || "").toLowerCase().startsWith("image/")) {
                    files.push(file);
                }
            });
            return files;
        }
        if (dataTransfer.items && dataTransfer.items.length > 0) {
            Array.from(dataTransfer.items).forEach(function (item) {
                if (!item || item.kind !== "file" || !String(item.type || "").toLowerCase().startsWith("image/")) {
                    return;
                }
                const file = item.getAsFile();
                if (file) {
                    files.push(file);
                }
            });
        }
        return files;
    }

    function getTextareaCaretOffsetFromPoint(textarea, clientX, clientY) {
        if (!textarea) {
            return null;
        }
        const rect = textarea.getBoundingClientRect();
        const styles = window.getComputedStyle(textarea);
        const paddingLeft = parseFloat(styles.paddingLeft) || 0;
        const paddingTop = parseFloat(styles.paddingTop) || 0;
        const borderLeft = parseFloat(styles.borderLeftWidth) || 0;
        const borderTop = parseFloat(styles.borderTopWidth) || 0;
        const lineHeight = parseFloat(styles.lineHeight) || (parseFloat(styles.fontSize) || 16) * 1.2;
        const source = textarea.value || "";
        const lines = source.split("\n");
        const rawLineIndex = Math.floor(
            (clientY - rect.top - paddingTop - borderTop + textarea.scrollTop) / Math.max(1, lineHeight)
        );
        const lineIndex = Math.max(0, Math.min(lines.length - 1, rawLineIndex));
        let lineStart = 0;
        for (let index = 0; index < lineIndex; index += 1) {
            lineStart += lines[index].length + 1;
        }

        const targetX = clientX - rect.left - paddingLeft - borderLeft + textarea.scrollLeft;
        const line = lines[lineIndex] || "";
        if (targetX <= 0 || !line) {
            return lineStart;
        }

        const canvas = getTextareaCaretOffsetFromPoint.canvas || document.createElement("canvas");
        getTextareaCaretOffsetFromPoint.canvas = canvas;
        const context = canvas.getContext("2d");
        if (!context) {
            return lineStart + line.length;
        }
        context.font = styles.font;

        let low = 0;
        let high = line.length;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            const width = context.measureText(line.slice(0, mid)).width;
            if (width < targetX) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }

        const beforeWidth = context.measureText(line.slice(0, low)).width;
        const afterWidth = low < line.length
            ? context.measureText(line.slice(0, low + 1)).width
            : beforeWidth;
        const offsetInLine = low < line.length && Math.abs(afterWidth - targetX) < Math.abs(targetX - beforeWidth)
            ? low + 1
            : low;
        return lineStart + Math.max(0, Math.min(line.length, offsetInLine));
    }

    function insertTextAtTextareaCursor(textarea, insertText, insertOffset) {
        if (!textarea) {
            return 0;
        }
        const hasInsertOffset = Number.isInteger(insertOffset);
        const start = hasInsertOffset ? Math.max(0, Math.min(textarea.value.length, insertOffset)) : (textarea.selectionStart || 0);
        const end = hasInsertOffset ? start : (textarea.selectionEnd || 0);
        textarea.setRangeText(insertText, start, end, "end");
        const nextCursor = start + String(insertText || "").length;
        textarea.setSelectionRange(nextCursor, nextCursor);
        textarea.focus();
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        return nextCursor;
    }

    function createMarkdownImageInputHandler(options) {
        const settings = options || {};
        const textarea = settings.textarea;
        const uploadApiUrl = settings.uploadApiUrl;
        const isEnabled = typeof settings.isEnabled === "function" ? settings.isEnabled : function () { return true; };
        const getMarkdownPath = typeof settings.getMarkdownPath === "function" ? settings.getMarkdownPath : function () { return ""; };
        const getMarkdownName = typeof settings.getMarkdownName === "function" ? settings.getMarkdownName : function () { return ""; };
        const getTargetDir = typeof settings.getTargetDir === "function" ? settings.getTargetDir : function () { return ""; };
        const onAfterInsert = typeof settings.onAfterInsert === "function" ? settings.onAfterInsert : function () {};

        async function uploadAndInsert(files, insertOffset) {
            if (!textarea || !uploadApiUrl || !isEnabled()) {
                return;
            }
            let nextInsertOffset = Number.isInteger(insertOffset) ? insertOffset : null;
            for (const file of files) {
                const formData = new FormData();
                formData.append("markdown_path", getMarkdownPath() || "");
                formData.append("markdown_name", getMarkdownName() || "");
                formData.append("target_dir", getTargetDir() || "");
                formData.append("image", file, file.name || "image.png");
                const data = await requestFormDataJson(uploadApiUrl, formData);
                const snippet = data && typeof data.markdown === "string" && data.markdown
                    ? data.markdown
                    : ("![" + (file.name ? file.name.replace(/\.[^.]+$/, "") : "image") + "](" + (data && data.url ? data.url : "") + ")");
                nextInsertOffset = insertTextAtTextareaCursor(textarea, snippet, nextInsertOffset);
                onAfterInsert(data || {});
            }
        }

        return {
            handlePaste: function (event) {
                if (!event || !event.clipboardData || !isEnabled()) {
                    return false;
                }
                const files = getImageFilesFromTransfer(event.clipboardData);
                if (!files.length) {
                    return false;
                }
                event.preventDefault();
                uploadAndInsert(files, null).catch(alertError);
                return true;
            },
            handleDrop: function (event) {
                if (!event || !event.dataTransfer || !isEnabled()) {
                    return false;
                }
                const files = getImageFilesFromTransfer(event.dataTransfer);
                if (!files.length) {
                    return false;
                }
                const insertOffset = getTextareaCaretOffsetFromPoint(textarea, event.clientX, event.clientY);
                event.preventDefault();
                uploadAndInsert(files, insertOffset).catch(alertError);
                return true;
            },
            handleDragOver: function (event) {
                if (!event || !event.dataTransfer || !isEnabled()) {
                    return false;
                }
                const files = getImageFilesFromTransfer(event.dataTransfer);
                if (!files.length) {
                    return false;
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                return true;
            }
        };
    }

    // POST 요청 옵션을 구축하는 함수
    function buildPostOptions(body) {
        return {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": getCsrfToken()
            },
            body: JSON.stringify(body || {})
        };
    }

    // JSON 스크립트 데이터를 가져오는 함수
    function getJsonScriptData(id, fallbackValue) {
        // Server-rendered pages pass structured config through <script type="application/json"> tags.
        const element = document.getElementById(id);
        if (!element) {
            return fallbackValue;
        }
        try {
            return JSON.parse(element.textContent || "null") || fallbackValue;
        } catch (error) {
            return fallbackValue;
        }
    }

    const i18n = getJsonScriptData("handrive-i18n", {});

    // 다국어 텍스트를 가져오는 함수
    function t(key, fallbackValue) {
        if (Object.prototype.hasOwnProperty.call(i18n, key) && typeof i18n[key] === "string") {
            return i18n[key];
        }
        return fallbackValue;
    }

    function textByLang(koValue, enValue) {
        return uiLang === "en" ? enValue : koValue;
    }

    function toAbsoluteUrl(url) {
        const rawUrl = String(url || "").trim();
        if (!rawUrl) {
            return "";
        }
        try {
            return new URL(rawUrl, window.location.origin).href;
        } catch (error) {
            return rawUrl;
        }
    }

    function handrivePathUsesInternalVirtualUrl(pathValue) {
        const normalized = normalizePath(pathValue || "", true);
        if (!normalized) {
            return false;
        }
        return normalized.split("/").some(function (part) {
            return part.startsWith(".github-repo-")
                || part.startsWith(".google-drive-")
                || part === ".handrive-archive";
        });
    }

    function isSimpleUrlShareFileEntry(entry) {
        return Boolean(
            entry &&
            entry.type === "file" &&
            !entry.is_archive_member &&
            !entry.google_drive &&
            !entry.is_git_virtual &&
            !entry.git_provider &&
            !entry.git_repo_branch &&
            !entry.requires_commit_message &&
            !handrivePathUsesInternalVirtualUrl(entry.path)
        );
    }

    function isSimpleUrlShareFilePath(pathValue) {
        return Boolean(pathValue && !handrivePathUsesInternalVirtualUrl(pathValue));
    }

    // 분리된 helper 모듈은 모두 window 네임스페이스로 주입된다.
    // page.js 는 상태와 이벤트 wiring 을 담당하고, 순수 UI/flow 로직은 helper 에 위임한다.
    const handrivePageHelpers = window.HandrivePageHelpers || {};
    const getPathFileExtension = handrivePageHelpers.getPathFileExtension || function () { return ""; };
    const HANDRIVE_OFFICE_PDF_PRINT_EXTENSIONS = new Set([".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"]);

    function isHandriveOfficePdfPrintPath(pathValue) {
        return HANDRIVE_OFFICE_PDF_PRINT_EXTENSIONS.has(getPathFileExtension(pathValue || ""));
    }

    function buildHandrivePdfPreviewUrl(pdfPreviewApiUrl, pathValue) {
        const baseUrl = String(pdfPreviewApiUrl || "").trim();
        const normalizedPath = String(pathValue || "").trim();
        if (!baseUrl || (!normalizedPath && !hasSharedContext())) {
            return "";
        }
        const query = new URLSearchParams({ path: normalizedPath }).toString();
        return appendSharedQuery(query ? baseUrl + "?" + query : baseUrl);
    }

    const getFileIconKey = handrivePageHelpers.getFileIconKey || function () { return "file"; };
    const isGenericFileIconKey = handrivePageHelpers.isGenericFileIconKey || function () { return false; };
    const handriveContextMenuHelpers = window.HandriveContextMenuHelpers || {};
    const computeContextMenuVisibility = handriveContextMenuHelpers.computeContextMenuVisibility || function () { return {}; };
    const hasVisibleContextMenuAction = handriveContextMenuHelpers.hasVisibleContextMenuAction || function () { return false; };
    const syncContextMenuDividers = handriveContextMenuHelpers.syncContextMenuDividers || function () {};
    const handriveListRenderHelpers = window.HandriveListRenderHelpers || {};
    const appendCurrentDirRepoName = handriveListRenderHelpers.appendCurrentDirRepoName || function () {};
    const buildTreePrefixElement = handriveListRenderHelpers.buildTreePrefixElement || function () { return document.createElement("span"); };
    const createEntryMetaField = handriveListRenderHelpers.createEntryMetaField || function () { return document.createElement("span"); };
    const createTypeMarker = handriveListRenderHelpers.createTypeMarker || function () { return document.createElement("span"); };
    const handriveNavigationHelpers = window.HandriveNavigationHelpers || {};
    const buildNavigationBreadcrumbItems = handriveNavigationHelpers.buildBreadcrumbItems || function () { return []; };
    const formatNavigationPathLabel = handriveNavigationHelpers.formatPathLabel || function (pathValue) {
        const normalized = normalizePath(pathValue, true);
        if (!normalized) {
            return "";
        }
        return "/" + normalized
            .split("/")
            .filter(Boolean)
            .map(decodeBreadcrumbLabel)
            .join("/");
    };
    const getCachedDirectoryEntries = handriveNavigationHelpers.getCachedEntries || function () { return []; };
    const loadDirectoryEntries = handriveNavigationHelpers.loadDirectory || function () { return Promise.resolve([]); };
    const refreshDirectoryEntries = handriveNavigationHelpers.refreshCurrentDirectory || function () { return Promise.resolve(); };
    const renderNavigationBreadcrumbs = handriveNavigationHelpers.renderPathBreadcrumbs || function () {};
    const handrivePreviewHelpers = window.HandrivePreviewHelpers || {};
    const previewGetImageElement = handrivePreviewHelpers.getPreviewImageElement || function () { return null; };
    const previewGetImageMinZoom = handrivePreviewHelpers.getPreviewImageMinZoom || function () { return 0.5; };
    const previewCancelScrollIntoView = handrivePreviewHelpers.cancelScrollIntoView || function () {};
    const previewScrollIntoViewIfPortrait = handrivePreviewHelpers.scrollPreviewIntoViewIfPortrait || function () {};
    const previewSetActionTargets = handrivePreviewHelpers.setPreviewActionTargets || function () {};
    const previewSetPlaceholder = handrivePreviewHelpers.setPreviewPlaceholder || function () {};
    const previewSetVisibility = handrivePreviewHelpers.setPreviewVisibility || function () {};
    const previewSyncImageZoom = handrivePreviewHelpers.syncPreviewImageZoom || function () {};
    const handriveModalHelpers = window.HandriveModalHelpers || {};
    const modalSetFolderCreateModalOpen = handriveModalHelpers.setFolderCreateModalOpen || function () {};
    const modalSetFolderIconModalOpen = handriveModalHelpers.setFolderIconModalOpen || function () {};
    const modalSetRenameModalOpen = handriveModalHelpers.setRenameModalOpen || function () {};
    const handriveEditorHelpers = window.HandriveEditorHelpers || {};
    const editorResolveFilenameAndExtension = handriveEditorHelpers.resolveEditorFilenameAndExtension || function () { return { filename: "", extension: ".md" }; };
    const editorSwitchToEditorUI = handriveEditorHelpers.switchToEditorUI || function () { return Promise.resolve(); };
    const editorSwitchToPreviewUI = handriveEditorHelpers.switchToPreviewUI || function () {};
    const handriveGitRepoHelpers = window.HandriveGitRepoHelpers || {};
    const gitRepoCloseModalUi = handriveGitRepoHelpers.closeGitRepoModalUi || function () {};
    const gitRepoResetModalUi = handriveGitRepoHelpers.resetGitRepoModalUi || function () {};
    const gitRepoShowStatusUi = handriveGitRepoHelpers.showGitRepoStatus || function () {};
    const handrivePreviewFlowHelpers = window.HandrivePreviewFlowHelpers || {};
    const loadPreviewEntryFlow = handrivePreviewFlowHelpers.loadPreviewForEntry || function () { return Promise.resolve(); };
    const renderPreviewHtmlFlow = handrivePreviewFlowHelpers.renderPreviewHtml || function () {};
    const handriveGitRepoFlowHelpers = window.HandriveGitRepoFlowHelpers || {};
    const gitRepoFlowOpenModal = handriveGitRepoFlowHelpers.openModal || function () { return Promise.resolve(); };
    const gitRepoFlowPollStatus = handriveGitRepoFlowHelpers.pollStatus || function () { return Promise.resolve(); };
    const gitRepoFlowRetryCreate = handriveGitRepoFlowHelpers.retryCreate || function () { return Promise.resolve(); };
    const gitRepoFlowStartPolling = handriveGitRepoFlowHelpers.startPolling || function () {};
    const gitRepoFlowStopPolling = handriveGitRepoFlowHelpers.stopPolling || function () {};
    const gitRepoFlowSubmitCreate = handriveGitRepoFlowHelpers.submitCreate || function () { return Promise.resolve(); };
    const handriveQueueHelpers = window.HandriveQueueHelpers || {};
    const buildQueueItemLabel = handriveQueueHelpers.buildQueueItemLabel || function (_, fallbackLabel) { return fallbackLabel || ""; };
    const configureUploadQueueContextMenu = handriveQueueHelpers.configureUploadQueueContextMenu || function () {};
    const createQueueListItem = handriveQueueHelpers.createQueueListItem || function () { return null; };
    const getQueueItemMetaLabel = handriveQueueHelpers.getQueueItemMetaLabel || function () { return ""; };
    const getQueueItemStatusLabel = handriveQueueHelpers.getQueueItemStatusLabel || function () { return ""; };
    const renderUploadQueuePanel = handriveQueueHelpers.renderUploadQueuePanel || function () {};
    const sortQueueItems = handriveQueueHelpers.sortQueueItems || function (items) { return items; };
    const summarizeUploadQueue = handriveQueueHelpers.summarizeUploadQueue || function () { return ""; };
    const handriveQueueOperationHelpers = window.HandriveQueueOperationHelpers || {};
    const enqueueQueuedUploadFiles = handriveQueueOperationHelpers.enqueueUploadFiles || function () { return Promise.resolve(); };
    const processOperationQueueWorker = handriveQueueOperationHelpers.processOperationQueue || function () { return Promise.resolve(); };
    const processUploadQueueWorker = handriveQueueOperationHelpers.processUploadQueue || function () { return Promise.resolve(); };
    const runDeleteQueueOperation = handriveQueueOperationHelpers.runDeleteOperationQueueItem || function () { return Promise.resolve(); };
    const runCreateArchiveQueueOperation = handriveQueueOperationHelpers.runCreateArchiveOperationQueueItem || function () { return Promise.resolve(); };
    const runExtractQueueOperation = handriveQueueOperationHelpers.runExtractOperationQueueItem || function () { return Promise.resolve(); };
    const runMoveQueueOperation = handriveQueueOperationHelpers.runMoveOperationQueueItem || function () { return Promise.resolve(); };

    const HANDRIVE_MEDIA_VOLUME_COOKIE_NAME = "handrive-media-volume";
    const HANDRIVE_MEDIA_MUTED_COOKIE_NAME = "handrive-media-muted";
    const HANDRIVE_LEGACY_MEDIA_AUDIO_VOLUME_STORAGE_KEY = "handrive-media-audio-volume";
    const HANDRIVE_MEDIA_VOLUME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
    const HANDRIVE_MEDIA_LOOP_STORAGE_KEY = "handrive-media-loop-enabled";

    function parseStoredMediaVolume(value) {
        if (value === null || value === undefined || String(value).trim() === "") {
            return null;
        }
        const parsedValue = Number(value);
        if (!Number.isFinite(parsedValue)) {
            return null;
        }
        return Math.max(0, Math.min(1, parsedValue));
    }

    function getCookieValue(name) {
        const prefix = encodeURIComponent(name) + "=";
        try {
            const parts = String(document.cookie || "").split(";");
            for (let index = 0; index < parts.length; index += 1) {
                const part = parts[index].trim();
                if (part.indexOf(prefix) === 0) {
                    return decodeURIComponent(part.slice(prefix.length));
                }
            }
        } catch (error) {
            return "";
        }
        return "";
    }

    function setCookieValue(name, value) {
        try {
            let cookie = encodeURIComponent(name) + "=" + encodeURIComponent(String(value))
                + "; Max-Age=" + HANDRIVE_MEDIA_VOLUME_COOKIE_MAX_AGE
                + "; Path=/; SameSite=Lax";
            if (window.location && window.location.protocol === "https:") {
                cookie += "; Secure";
            }
            document.cookie = cookie;
        } catch (error) {
            // ignore cookie failures
        }
    }

    function getStoredMediaVolume() {
        // Persist preview media volume across files so repeated media previews feel consistent.
        const cookieVolume = parseStoredMediaVolume(getCookieValue(HANDRIVE_MEDIA_VOLUME_COOKIE_NAME));
        if (cookieVolume !== null) {
            return cookieVolume;
        }
        try {
            const legacyVolume = parseStoredMediaVolume(
                window.localStorage
                    ? window.localStorage.getItem(HANDRIVE_LEGACY_MEDIA_AUDIO_VOLUME_STORAGE_KEY)
                    : ""
            );
            if (legacyVolume !== null) {
                setCookieValue(HANDRIVE_MEDIA_VOLUME_COOKIE_NAME, legacyVolume);
                return legacyVolume;
            }
        } catch (error) {
            // ignore legacy storage failures
        }
        return 1;
    }

    function storeMediaVolume(volume) {
        const normalizedVolume = parseStoredMediaVolume(volume);
        if (normalizedVolume === null) {
            return;
        }
        setCookieValue(HANDRIVE_MEDIA_VOLUME_COOKIE_NAME, normalizedVolume);
    }

    function getStoredMediaMuted() {
        return getCookieValue(HANDRIVE_MEDIA_MUTED_COOKIE_NAME) === "1";
    }

    function storeMediaMuted(muted) {
        setCookieValue(HANDRIVE_MEDIA_MUTED_COOKIE_NAME, muted ? "1" : "0");
    }

    function dispatchMediaVolumeChange(volume, muted, sourceId) {
        window.dispatchEvent(new CustomEvent("handrive:media-volume-change", {
            detail: {
                volume: Math.max(0, Math.min(1, Number(volume) || 0)),
                muted: Boolean(muted),
                sourceId: sourceId || "",
            },
        }));
    }

    function getStoredMediaLoopEnabled() {
        try {
            return Boolean(window.localStorage && window.localStorage.getItem(HANDRIVE_MEDIA_LOOP_STORAGE_KEY) === "1");
        } catch (error) {
            return false;
        }
    }

    function storeMediaLoopEnabled(enabled) {
        try {
            if (window.localStorage) {
                window.localStorage.setItem(HANDRIVE_MEDIA_LOOP_STORAGE_KEY, enabled ? "1" : "0");
            }
        } catch (error) {
            // ignore storage failures
        }
        window.dispatchEvent(new CustomEvent("handrive:media-loop-change", {
            detail: { enabled: Boolean(enabled) },
        }));
    }

    function syncMediaLoopButton(button, enabled) {
        if (!button) {
            return;
        }
        const isEnabled = Boolean(enabled);
        button.classList.toggle("is-loop-enabled", isEnabled);
        button.setAttribute("aria-pressed", isEnabled ? "true" : "false");
        button.setAttribute("aria-label", isEnabled
            ? t("media_loop_on", textByLang("연속재생 켜짐", "Loop playback on"))
            : t("media_loop_off", textByLang("연속재생 꺼짐", "Loop playback off")));
        button.setAttribute("title", isEnabled
            ? t("media_loop_on", textByLang("연속재생 켜짐", "Loop playback on"))
            : t("media_loop_off", textByLang("연속재생 꺼짐", "Loop playback off")));
        const checkPath = button.querySelector(".handrive-loop-check-path");
        if (checkPath) {
            checkPath.hidden = !isEnabled;
        }
    }

    let mediaLoopGlobalListenerBound = false;
    let mediaVolumeGlobalListenerBound = false;
    let mediaVolumeSourceSeq = 0;

    function syncAudioLoopElements(enabled) {
        document.querySelectorAll(".handrive-media-audio-element").forEach(function (audioElement) {
            if (!(audioElement instanceof HTMLMediaElement)) {
                return;
            }
            const button = audioElement
                .closest(".handrive-media-audio-wrap")
                ?.querySelector(".handrive-media-loop-button");
            audioElement.loop = Boolean(enabled);
            syncMediaLoopButton(button, enabled);
        });
    }

    function ensureMediaLoopGlobalListener() {
        if (mediaLoopGlobalListenerBound) {
            return;
        }
        mediaLoopGlobalListenerBound = true;
        window.addEventListener("handrive:media-loop-change", function (event) {
            const enabled = Boolean(event && event.detail && event.detail.enabled);
            syncAudioLoopElements(enabled);
        });
    }

    function applyMediaVolumePreference(mediaElement, volume, muted) {
        if (!(mediaElement instanceof HTMLMediaElement)) {
            return;
        }
        const normalizedVolume = parseStoredMediaVolume(volume);
        mediaElement.dataset.handriveApplyingVolumePreference = "1";
        try {
            if (normalizedVolume !== null) {
                mediaElement.volume = normalizedVolume;
            }
            mediaElement.muted = Boolean(muted);
        } catch (error) {
            // ignore media volume failures
        } finally {
            window.setTimeout(function () {
                if (mediaElement && mediaElement.dataset) {
                    delete mediaElement.dataset.handriveApplyingVolumePreference;
                }
            }, 0);
        }
    }

    function syncAudioVolumeElements(volume, muted) {
        document.querySelectorAll(".handrive-media-audio-element").forEach(function (audioElement) {
            applyMediaVolumePreference(audioElement, volume, muted);
        });
    }

    function ensureMediaVolumeGlobalListener() {
        if (mediaVolumeGlobalListenerBound) {
            return;
        }
        mediaVolumeGlobalListenerBound = true;
        window.addEventListener("handrive:media-volume-change", function (event) {
            const detail = event && event.detail ? event.detail : {};
            syncAudioVolumeElements(detail.volume, detail.muted);
        });
    }

    function bindMediaLoopElement(mediaElement, button) {
        if (!(mediaElement instanceof HTMLMediaElement) || !button) {
            return;
        }
        const applyLoopState = function (enabled) {
            mediaElement.loop = Boolean(enabled);
            syncMediaLoopButton(button, enabled);
        };
        ensureMediaLoopGlobalListener();
        applyLoopState(getStoredMediaLoopEnabled());
        if (button.dataset.handriveLoopBound !== "1") {
            button.dataset.handriveLoopBound = "1";
            button.addEventListener("click", function () {
                storeMediaLoopEnabled(!mediaElement.loop);
            });
        }
    }

    function buildMediaLoopButton() {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "handrive-media-loop-button";
        button.innerHTML = [
            '<span class="handrive-media-loop-icon" aria-hidden="true">',
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ',
            'stroke-linecap="round" stroke-linejoin="round">',
            '<path d="M17 2l4 4-4 4"></path>',
            '<path d="M3 11V9a4 4 0 0 1 4-4h14"></path>',
            '<path d="M7 22l-4-4 4-4"></path>',
            '<path d="M21 13v2a4 4 0 0 1-4 4H3"></path>',
            '<path class="handrive-loop-check-path" d="M8.4 12.8l2.4 2.4 5.2-5.7" hidden></path>',
            "</svg>",
            "</span>",
        ].join("");
        syncMediaLoopButton(button, false);
        return button;
    }

    function resetAudioPlaybackPosition(audioElement) {
        // Reset to the beginning whenever preview audio is hydrated so stale currentTime
        // from browser media state does not leak across file selections.
        if (!audioElement) {
            return;
        }
        const applyReset = function () {
            try {
                audioElement.currentTime = 0;
            } catch (error) {
                return;
            }
        };
        if (audioElement.readyState > 0) {
            applyReset();
            return;
        }
        audioElement.addEventListener("loadedmetadata", applyReset, { once: true });
    }

    function hydrateMediaAudioElements(container) {
        // Audio elements are created inside preview HTML, so bind volume/preload behavior
        // after each preview render rather than at page boot.
        if (!container || !(container instanceof Element)) {
            return;
        }
        const storedVolume = getStoredMediaVolume();
        const storedMuted = getStoredMediaMuted();
        ensureMediaVolumeGlobalListener();
        container.querySelectorAll(".handrive-media-audio-element").forEach(function (audioElement) {
            if (!(audioElement instanceof HTMLMediaElement)) {
                return;
            }
            applyMediaVolumePreference(audioElement, storedVolume, storedMuted);
            audioElement.preload = "metadata";
            audioElement.autoplay = false;
            resetAudioPlaybackPosition(audioElement);
            const wrap = audioElement.closest(".handrive-media-audio-wrap");
            if (wrap) {
                let loopButton = wrap.querySelector(".handrive-media-loop-button");
                if (!loopButton) {
                    loopButton = buildMediaLoopButton();
                    audioElement.insertAdjacentElement("afterend", loopButton);
                }
                bindMediaLoopElement(audioElement, loopButton);
            }
            if (audioElement.dataset.handriveVolumeBound === "1") {
                return;
            }
            audioElement.dataset.handriveVolumeBound = "1";
            audioElement.dataset.handriveVolumeSourceId = audioElement.dataset.handriveVolumeSourceId || "audio-" + (++mediaVolumeSourceSeq);
            audioElement.addEventListener("volumechange", function () {
                if (audioElement.dataset.handriveApplyingVolumePreference === "1") {
                    return;
                }
                const volume = Math.max(0, Math.min(1, Number(audioElement.volume) || 0));
                const muted = Boolean(audioElement.muted);
                storeMediaVolume(volume);
                storeMediaMuted(muted);
                dispatchMediaVolumeChange(volume, muted, audioElement.dataset.handriveVolumeSourceId);
            });
        });
    }

    function releasePreviewMediaElement(mediaElement) {
        if (
            !mediaElement ||
            typeof HTMLMediaElement === "undefined" ||
            !(mediaElement instanceof HTMLMediaElement)
        ) {
            return;
        }
        try {
            mediaElement.pause();
        } catch (error) {
            // ignore media state errors
        }
        try {
            if ("srcObject" in mediaElement && mediaElement.srcObject) {
                mediaElement.srcObject = null;
            }
        } catch (error) {
            // ignore stream cleanup failures
        }
        try {
            mediaElement.querySelectorAll("source, track").forEach(function (source) {
                source.removeAttribute("src");
                source.removeAttribute("srcset");
            });
        } catch (error) {
            // ignore detached node errors
        }
        try {
            mediaElement.removeAttribute("src");
        } catch (error) {
            // ignore detached node errors
        }
        try {
            mediaElement.load();
        } catch (error) {
            // ignore load reset failures
        }
    }

    function stopPreviewMediaElements(container, mediaElements) {
        if (!container || !(container instanceof Element)) {
            return;
        }
        const targetMediaElements = Array.isArray(mediaElements)
            ? mediaElements
            : Array.prototype.slice.call(container.querySelectorAll("audio, video"));
        const activePipElement = document.pictureInPictureElement;
        if (
            activePipElement &&
            activePipElement instanceof HTMLVideoElement &&
            activePipElement.dataset.handriveImagePipHost !== "1" &&
            targetMediaElements.indexOf(activePipElement) !== -1 &&
            typeof document.exitPictureInPicture === "function"
        ) {
            document.exitPictureInPicture().catch(function () {});
        }
        targetMediaElements.forEach(function (mediaElement) {
            if (!(mediaElement instanceof HTMLMediaElement)) {
                return;
            }
            releasePreviewMediaElement(mediaElement);
        });
    }

    function releasePreviewVideoPlayers(container) {
        if (!container || !(container instanceof Element)) {
            return Promise.resolve();
        }
        const mediaElements = Array.prototype.slice.call(container.querySelectorAll("audio, video"));
        if (
            window.HandriveVideoPlayer &&
            typeof window.HandriveVideoPlayer.cleanupPreview === "function"
        ) {
            return window.HandriveVideoPlayer.cleanupPreview(container).catch(function () {}).then(function () {
                stopPreviewMediaElements(container, mediaElements);
            });
        }
        stopPreviewMediaElements(container, mediaElements);
        return Promise.resolve();
    }

    async function initializePreviewVideoPlayers(container) {
        if (!container || !(container instanceof Element)) {
            return;
        }
        if (!container.querySelector("video.video-js")) {
            return;
        }
        await loadVideoPlayerStack();
        if (
            !window.HandriveVideoPlayer ||
            typeof window.HandriveVideoPlayer.init !== "function"
        ) {
            return;
        }
        container.querySelectorAll("video.video-js:not([data-vjs-initialized])").forEach(function (videoElement) {
            window.HandriveVideoPlayer.init(videoElement);
        });
    }

    // 템플릿을 포맷팅하는 함수
    function formatTemplate(template, values) {
        // Small named-token formatter for localized strings such as "{count}개 항목".
        return String(template || "").replace(/\{(\w+)\}/g, function (_, token) {
            if (values && Object.prototype.hasOwnProperty.call(values, token)) {
                return String(values[token]);
            }
            return "";
        });
    }

    // 에러를 알림창으로 표시하는 함수
    function alertError(error) {
        window.alert(
            error && error.message
                ? error.message
                : t("js_error_processing_failed", "처리 중 오류가 발생했습니다.")
        );
    }

    let imagePipSession = null;

    function closeImagePipSession() {
        if (!imagePipSession) {
            return;
        }
        const session = imagePipSession;
        imagePipSession = null;
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
        if (session.video) {
            session.video.remove();
        }
    }

    function isActiveImagePictureInPictureSession() {
        return Boolean(
            imagePipSession &&
            imagePipSession.video &&
            document.pictureInPictureElement === imagePipSession.video
        );
    }

    function closeNonImagePictureInPicture() {
        if (!document.pictureInPictureElement || isActiveImagePictureInPictureSession()) {
            return Promise.resolve();
        }
        return document.exitPictureInPicture().catch(function () {});
    }

    function getImagePipFrameSize(imageElement) {
        const sourceWidth = Number(imageElement.naturalWidth || imageElement.width || imageElement.clientWidth || 0);
        const sourceHeight = Number(imageElement.naturalHeight || imageElement.height || imageElement.clientHeight || 0);
        if (!sourceWidth || !sourceHeight) {
            return null;
        }
        const maxSide = 1280;
        const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
        return {
            width: Math.max(1, Math.round(sourceWidth * scale)),
            height: Math.max(1, Math.round(sourceHeight * scale)),
        };
    }

    function createManualImagePipCanvasStream(canvas, fallbackFrameRate) {
        let stream = canvas.captureStream(0);
        let track = stream.getVideoTracks()[0] || null;
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

    function waitForVideoMetadata(videoElement) {
        if (!videoElement || videoElement.readyState >= HTMLMediaElement.HAVE_METADATA) {
            return Promise.resolve();
        }
        return new Promise(function (resolve, reject) {
            const cleanup = function () {
                videoElement.removeEventListener("loadedmetadata", onLoadedMetadata);
                videoElement.removeEventListener("error", onError);
            };
            const onLoadedMetadata = function () {
                cleanup();
                resolve();
            };
            const onError = function () {
                cleanup();
                reject(new Error(t("image_pip_no_image_error", "PiP로 띄울 이미지를 찾을 수 없습니다.")));
            };
            videoElement.addEventListener("loadedmetadata", onLoadedMetadata);
            videoElement.addEventListener("error", onError);
        });
    }

    function drawImagePipFrame(imageElement, session) {
        if (!imageElement || !imageElement.complete || !session || !session.canvas || !session.context) {
            return false;
        }
        const frameSize = getImagePipFrameSize(imageElement);
        if (!frameSize) {
            return false;
        }
        if (session.canvas.width !== frameSize.width) {
            session.canvas.width = frameSize.width;
        }
        if (session.canvas.height !== frameSize.height) {
            session.canvas.height = frameSize.height;
        }
        session.context.clearRect(0, 0, session.canvas.width, session.canvas.height);
        try {
            session.context.drawImage(imageElement, 0, 0, session.canvas.width, session.canvas.height);
        } catch (error) {
            return false;
        }
        return true;
    }

    function requestImagePipFrame(session) {
        const track = session && session.track
            ? session.track
            : session && session.stream && typeof session.stream.getVideoTracks === "function"
                ? session.stream.getVideoTracks()[0] || null
                : null;
        if (track && typeof track.requestFrame === "function") {
            try {
                track.requestFrame();
            } catch (error) {
                // Some mobile browsers throw while a tab is backgrounding.
            }
        }
    }

    async function openImagePictureInPicture(imageElement) {
        if (!imageElement) {
            throw new Error(t("image_pip_no_image_error", "PiP로 띄울 이미지를 찾을 수 없습니다."));
        }
        if (!document.pictureInPictureEnabled || typeof HTMLVideoElement === "undefined") {
            throw new Error(t("image_pip_unsupported_error", "이 브라우저는 이미지 PiP를 지원하지 않습니다."));
        }
        if (typeof HTMLCanvasElement === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") {
            throw new Error(t("image_pip_unsupported_error", "이 브라우저는 이미지 PiP를 지원하지 않습니다."));
        }
        if (isActiveImagePictureInPictureSession()) {
            if (!imageElement.complete && typeof imageElement.decode === "function") {
                await imageElement.decode().catch(function () {});
            }
            if (!imageElement.complete) {
                throw new Error(t("image_pip_no_image_error", "PiP로 띄울 이미지를 찾을 수 없습니다."));
            }
            if (!drawImagePipFrame(imageElement, imagePipSession)) {
                throw new Error(t("image_pip_no_image_error", "PiP로 띄울 이미지를 찾을 수 없습니다."));
            }
            requestImagePipFrame(imagePipSession);
            return;
        }

        await closeNonImagePictureInPicture();
        closeImagePipSession();

        if (!imageElement.complete && typeof imageElement.decode === "function") {
            await imageElement.decode().catch(function () {});
        }
        if (!imageElement.complete) {
            throw new Error(t("image_pip_no_image_error", "PiP로 띄울 이미지를 찾을 수 없습니다."));
        }

        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error(t("image_pip_unsupported_error", "이 브라우저는 이미지 PiP를 지원하지 않습니다."));
        }
        const session = {
            canvas: canvas,
            context: context,
            mode: "image",
            stream: null,
            track: null,
            video: null,
        };
        if (!drawImagePipFrame(imageElement, session)) {
            throw new Error(t("image_pip_no_image_error", "PiP로 띄울 이미지를 찾을 수 없습니다."));
        }

        const capture = createManualImagePipCanvasStream(canvas, 1);
        const stream = capture.stream;
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        video.dataset.handriveImagePipHost = "1";
        video.style.cssText = "position:fixed;left:-1px;top:-1px;width:1px;height:1px;opacity:0;pointer-events:none;";
        document.body.appendChild(video);

        session.stream = stream;
        session.track = capture.track;
        session.video = video;
        imagePipSession = session;
        video.addEventListener("leavepictureinpicture", closeImagePipSession, { once: true });
        try {
            const playPromise = video.play();
            requestImagePipFrame(session);
            if (playPromise && typeof playPromise.then === "function") {
                await playPromise;
            }
            await waitForVideoMetadata(video);
            requestImagePipFrame(session);
            await video.requestPictureInPicture();
            requestImagePipFrame(session);
        } catch (error) {
            closeImagePipSession();
            throw error;
        }
    }

    function openClickedImagePictureInPicture(event) {
        if (!event || event.button !== 0) {
            return;
        }
        const target = event.target && event.target.closest
            ? event.target.closest(".handrive-media-image-element")
            : null;
        if (!target) {
            return;
        }
        event.preventDefault();
        openImagePictureInPicture(target).catch(alertError);
    }

    // 문서 렌더링 콘텐츠 모드 클래스를 적용하는 함수
    function applyHandriveRenderedContentModeClass(targetElement, renderMode, renderClass) {
        // Preview renderers return both a high-level mode and optional CSS class hints.
        // Normalize those hints here so the preview pane has exactly one coherent style family.
        if (!targetElement || !(targetElement instanceof Element)) {
            return;
        }
        targetElement.classList.remove(
            "ui-markdown",
            "handrive-plain-text",
            "handrive-json",
            "handrive-html",
            "handrive-css",
            "handrive-js",
            "handrive-py",
            "handrive-office",
            "handrive-office-word",
            "handrive-office-sheet",
            "handrive-office-presentation",
            "handrive-media",
            "handrive-media-image",
            "handrive-media-video",
            "handrive-media-audio",
            "handrive-media-pdf",
            "handrive-unsupported"
        );
        const renderClasses = String(renderClass || "")
            .split(/\s+/)
            .filter(Boolean);
        if (
            renderMode === "media_image" ||
            renderMode === "media_video" ||
            renderMode === "media_audio" ||
            renderMode === "pdf" ||
            renderClasses.includes("handrive-media")
        ) {
            targetElement.classList.add("handrive-media");
            if (renderMode === "media_image") {
                targetElement.classList.add("handrive-media-image");
            } else if (renderMode === "media_video") {
                targetElement.classList.add("handrive-media-video");
            } else if (renderMode === "media_audio") {
                targetElement.classList.add("handrive-media-audio");
            } else if (renderMode === "pdf") {
                targetElement.classList.add("handrive-media-pdf");
            }
            renderClasses.forEach(function (className) {
                if (
                    className === "handrive-media-image" ||
                    className === "handrive-media-video" ||
                    className === "handrive-media-audio" ||
                    className === "handrive-media-pdf"
                ) {
                    targetElement.classList.add(className);
                }
            });
            return;
        }
        if (
            renderClasses.includes("handrive-json") ||
            renderClasses.includes("handrive-html") ||
            renderClasses.includes("handrive-css") ||
            renderClasses.includes("handrive-js") ||
            renderClasses.includes("handrive-py")
        ) {
            renderClasses.forEach(function (className) {
                if (
                    className === "handrive-json" ||
                    className === "handrive-html" ||
                    className === "handrive-css" ||
                    className === "handrive-js" ||
                    className === "handrive-py"
                ) {
                    targetElement.classList.add(className);
                }
            });
            return;
        }
        if (renderClasses.includes("handrive-office")) {
            renderClasses.forEach(function (className) {
                if (
                    className === "handrive-office" ||
                    className === "handrive-office-word" ||
                    className === "handrive-office-sheet" ||
                    className === "handrive-office-presentation"
                ) {
                    targetElement.classList.add(className);
                }
            });
            return;
        }
        if (renderClasses.includes("handrive-unsupported")) {
            targetElement.classList.add("handrive-unsupported");
            return;
        }
        if (renderMode === "markdown") {
            targetElement.classList.add("ui-markdown");
            return;
        }
        targetElement.classList.add("handrive-plain-text");
    }

    function bindHandrivePdfFrameLoading(container) {
        if (!container || !(container instanceof Element)) {
            return;
        }
        const frames = Array.prototype.slice.call(container.querySelectorAll(".handrive-media-pdf-element"))
            .filter(function (frame) {
                return frame && frame.dataset.handriveFrameLoadingBound !== "1";
            });
        if (!frames.length) {
            return;
        }

        let overlay = Array.prototype.slice.call(container.children).find(function (child) {
            return child && child.classList && child.classList.contains("handrive-frame-loading");
        });
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.className = "handrive-frame-loading";
            overlay.setAttribute("role", "status");
            overlay.setAttribute("aria-label", t("list_preview_loading", "미리보기를 불러오는 중..."));
            overlay.innerHTML = '<span class="handrive-list-preview-loading-spinner" aria-hidden="true"></span>';
            container.appendChild(overlay);
        }
        overlay.hidden = false;

        let hidden = false;
        const hideOverlay = function () {
            if (hidden) {
                return;
            }
            hidden = true;
            overlay.hidden = true;
        };

        let pendingFrameCount = frames.length;
        const markFrameReady = function () {
            pendingFrameCount -= 1;
            if (pendingFrameCount <= 0) {
                hideOverlay();
            }
        };

        frames.forEach(function (frame) {
            frame.dataset.handriveFrameLoadingBound = "1";
            frame.addEventListener("load", markFrameReady, { once: true });
            frame.addEventListener("error", markFrameReady, { once: true });
            try {
                const frameDocument = frame.contentDocument;
                const frameDocumentUrl = frameDocument ? String(frameDocument.URL || "") : "";
                if (
                    frameDocument &&
                    frameDocument.readyState === "complete" &&
                    frameDocumentUrl &&
                    frameDocumentUrl !== "about:blank"
                ) {
                    window.requestAnimationFrame(markFrameReady);
                }
            } catch (error) {}
        });
        window.setTimeout(hideOverlay, 12000);
    }

    // HTML을 이스케이프하는 함수
    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function calculateCursorPosition(textarea, position) {
        // Completion popups are positioned from measured text width because textarea
        // caret coordinates are not exposed directly by the browser.
        const text = textarea.value;
        const textBeforeCursor = text.substring(0, position);
        const lines = textBeforeCursor.split("\n");
        const currentLine = lines.length - 1;
        const currentColumn = lines[currentLine].length;
        const textareaStyles = window.getComputedStyle(textarea);
        const lineHeight = parseFloat(textareaStyles.lineHeight) || 20;
        const paddingLeft = parseFloat(textareaStyles.paddingLeft) || 0;
        const paddingTop = parseFloat(textareaStyles.paddingTop) || 0;
        const borderLeft = parseFloat(textareaStyles.borderLeftWidth) || 0;
        const borderTop = parseFloat(textareaStyles.borderTopWidth) || 0;
        const scrollLeft = textarea.scrollLeft;
        const scrollTop = textarea.scrollTop;

        const textareaRect = textarea.getBoundingClientRect();

        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        context.font = textareaStyles.font;

        const textLine = lines[currentLine] || "";
        const lineWidth = context.measureText(textLine.substring(0, currentColumn)).width;

        const left = textareaRect.left + paddingLeft + borderLeft + lineWidth - scrollLeft;
        const top = textareaRect.top + paddingTop + borderTop + (currentLine * lineHeight) - scrollTop;

        return {
            left: left,
            top: top,
            lineHeight: lineHeight
        };
    }

    if (!window.__handriveCalculateCursorPosition) {
        window.__handriveCalculateCursorPosition = calculateCursorPosition;
    }


    const handriveEditorCompletionExtensionAliasMap = {
        ".ts": ".js",
        ".tsx": ".js",
        ".jsx": ".js",
        ".mjs": ".js",
        ".cjs": ".js",
        ".htm": ".html",
        ".yml": ".json",
        ".yaml": ".json",
    };

    function resolveEditorCompletionItemsByExtension(extension) {
        // Reuse completion packs across adjacent extensions (ts->js, yaml->json, etc.)
        // so the editor can stay lightweight without duplicating snippet tables.
        const completionMap = window.__handriveEditorCompletionMap || {};
        const normalized = String(extension || "").trim().toLowerCase();
        if (normalized && Array.isArray(completionMap[normalized])) {
            return completionMap[normalized];
        }
        const alias = handriveEditorCompletionExtensionAliasMap[normalized];
        if (alias && Array.isArray(completionMap[alias])) {
            return completionMap[alias];
        }
        if (!normalized && Array.isArray(completionMap[".md"])) {
            return completionMap[".md"];
        }
        return [];
    }

    function extractEditorCompletionToken(sourceText, cursorIndex) {
        // Completion matching only looks at the trailing identifier fragment immediately
        // before the caret; everything else is ignored for predictable snippet insertion.
        const text = String(sourceText || "");
        const cursor = Math.max(0, Number(cursorIndex || 0));
        const prefix = text.slice(0, cursor);
        const match = prefix.match(/([A-Za-z0-9_][A-Za-z0-9_-]*)$/);
        if (!match || !match[1]) {
            return null;
        }
        const token = match[1];
        return {
            token: token,
            start: cursor - token.length,
            end: cursor,
        };
    }

    function findBestEditorCompletionItem(completionItems, tokenText) {
        const matches = findEditorCompletionItems(completionItems, tokenText, 1);
        return matches.length ? matches[0] : null;
    }

    function findEditorCompletionItems(completionItems, tokenText, limit) {
        // Rank candidates by exactness, explicit priority, and shorter trigger length
        // so the most likely snippet stays first in keyboard-only workflows.
        const normalizedToken = String(tokenText || "").toLowerCase();
        if (!normalizedToken || !Array.isArray(completionItems) || completionItems.length === 0) {
            return [];
        }

        const candidates = [];
        for (let i = 0; i < completionItems.length; i += 1) {
            const item = completionItems[i] || {};
            const trigger = String(item.trigger || "").toLowerCase();
            if (!trigger || !trigger.startsWith(normalizedToken)) {
                continue;
            }
            candidates.push({
                item: item,
                trigger: trigger,
            });
        }

        if (candidates.length === 0) {
            return [];
        }

        candidates.sort(function (a, b) {
            const aExact = a.trigger === normalizedToken ? 1 : 0;
            const bExact = b.trigger === normalizedToken ? 1 : 0;
            if (aExact !== bExact) {
                return bExact - aExact;
            }
            const aPriority = Number((a.item && a.item.priority) || 0);
            const bPriority = Number((b.item && b.item.priority) || 0);
            if (aPriority !== bPriority) {
                return bPriority - aPriority;
            }
            if (a.trigger.length !== b.trigger.length) {
                return a.trigger.length - b.trigger.length;
            }
            return a.trigger.localeCompare(b.trigger);
        });

        const maxItems = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : candidates.length;
        return candidates.slice(0, maxItems).map(function (candidate) {
            return candidate.item;
        });
    }

    // JavaScript 코드를 하이라이팅하는 함수
    function highlightJavaScriptCode(source) {
        const placeholders = [];

        const putPlaceholder = function (tokenHtml) {
            const token = "@@DOCS_JS_TOKEN_" + String(placeholders.length) + "@@";
            placeholders.push(tokenHtml);
            return token;
        };

        const restorePlaceholders = function (text) {
            return text.replace(/@@DOCS_JS_TOKEN_(\d+)@@/g, function (_, indexText) {
                const index = Number(indexText);
                if (Number.isNaN(index) || index < 0 || index >= placeholders.length) {
                    return "";
                }
                return placeholders[index];
            });
        };

        let text = escapeHtml(source);

        text = text.replace(/\/\*[\s\S]*?\*\//g, function (match) {
            return putPlaceholder('<span class="handrive-js-token-comment">' + match + "</span>");
        });
        text = text.replace(/(^|[^\S\r\n])\/\/[^\r\n]*/g, function (match) {
            return putPlaceholder('<span class="handrive-js-token-comment">' + match + "</span>");
        });
        text = text.replace(/(["'`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, function (match) {
            return putPlaceholder('<span class="handrive-js-token-string">' + match + "</span>");
        });

        text = text.replace(/\b(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi, '<span class="handrive-js-token-number">$1</span>');
        text = text.replace(
            /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|import|from|export|default|try|catch|finally|throw|async|await|typeof|instanceof|in|of|void|delete)\b/g,
            '<span class="handrive-js-token-keyword">$1</span>'
        );
        text = text.replace(/\b(true|false|null|undefined|this|super)\b/g, '<span class="handrive-js-token-literal">$1</span>');
        text = text.replace(
            /\b(Array|Object|String|Number|Boolean|Date|Math|JSON|Promise|Map|Set|RegExp|Error|console|window|document)\b/g,
            '<span class="handrive-js-token-builtin">$1</span>'
        );
        text = text.replace(/(\b[a-zA-Z_$][\w$]*)(\s*\()/g, '<span class="handrive-js-token-function">$1</span>$2');

        return restorePlaceholders(text);
    }

    // CSS 코드를 하이라이팅하는 함수
    function highlightCssCode(source) {
        const placeholders = [];

        const putPlaceholder = function (tokenHtml) {
            const token = "@@DOCS_CSS_TOKEN_" + String(placeholders.length) + "@@";
            placeholders.push(tokenHtml);
            return token;
        };

        const restorePlaceholders = function (text) {
            return text.replace(/@@DOCS_CSS_TOKEN_(\d+)@@/g, function (_, indexText) {
                const index = Number(indexText);
                if (Number.isNaN(index) || index < 0 || index >= placeholders.length) {
                    return "";
                }
                return placeholders[index];
            });
        };

        let text = escapeHtml(source);

        text = text.replace(/\/\*[\s\S]*?\*\//g, function (match) {
            return putPlaceholder('<span class="handrive-css-token-comment">' + match + "</span>");
        });
        text = text.replace(/(["'])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, function (match) {
            return putPlaceholder('<span class="handrive-css-token-string">' + match + "</span>");
        });

        text = text.replace(/(^|[}\s])([#.:\w\-\[\]=\*>\+\~,]+)(\s*\{)/g, function (_, p1, selectorText, p3) {
            return p1 + '<span class="handrive-css-token-selector">' + selectorText + "</span>" + p3;
        });
        text = text.replace(/(--[\w-]+)(\s*:)/g, '<span class="handrive-css-token-variable">$1</span>$2');
        text = text.replace(/([a-z-]+)(\s*:)/gi, '<span class="handrive-css-token-property">$1</span>$2');
        text = text.replace(/(:\s*)(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\)|\b[a-zA-Z]+\b)/g, '$1<span class="handrive-css-token-value">$2</span>');
        text = text.replace(/(-?\d+(?:\.\d+)?)(px|em|rem|vh|vw|%|deg|s|ms)?\b/g, '<span class="handrive-css-token-number">$1$2</span>');

        return restorePlaceholders(text);
    }

    // JSON 코드를 하이라이팅하는 함수
    function highlightJsonCode(source) {
        const placeholders = [];

        const putPlaceholder = function (tokenHtml) {
            const token = "@@DOCS_JSON_TOKEN_" + String(placeholders.length) + "@@";
            placeholders.push(tokenHtml);
            return token;
        };

        const restorePlaceholders = function (text) {
            return text.replace(/@@DOCS_JSON_TOKEN_(\d+)@@/g, function (_, indexText) {
                const index = Number(indexText);
                if (Number.isNaN(index) || index < 0 || index >= placeholders.length) {
                    return "";
                }
                return placeholders[index];
            });
        };

        let text = escapeHtml(source);

        text = text.replace(/"(?:\\.|[^"\\])*"(?=\s*:)/g, function (match) {
            return putPlaceholder('<span class="handrive-json-token-key">' + match + "</span>");
        });
        text = text.replace(/"(?:\\.|[^"\\])*"/g, function (match) {
            return putPlaceholder('<span class="handrive-json-token-string">' + match + "</span>");
        });
        text = text.replace(/\b(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi, '<span class="handrive-json-token-number">$1</span>');
        text = text.replace(/\b(true|false|null)\b/g, '<span class="handrive-json-token-literal">$1</span>');
        text = text.replace(/([{}\[\],:])/g, '<span class="handrive-json-token-punctuation">$1</span>');

        return restorePlaceholders(text);
    }

    // Python 코드를 하이라이팅하는 함수
    function highlightPythonCode(source) {
        const placeholders = [];

        const putPlaceholder = function (tokenHtml) {
            const token = "@@DOCS_PY_TOKEN_" + String(placeholders.length) + "@@";
            placeholders.push(tokenHtml);
            return token;
        };

        const restorePlaceholders = function (text) {
            return text.replace(/@@DOCS_PY_TOKEN_(\d+)@@/g, function (_, indexText) {
                const index = Number(indexText);
                if (Number.isNaN(index) || index < 0 || index >= placeholders.length) {
                    return "";
                }
                return placeholders[index];
            });
        };

        let text = escapeHtml(source);

        text = text.replace(/("""[\s\S]*?"""|'''[\s\S]*?''')/g, function (match) {
            return putPlaceholder('<span class="handrive-py-token-string">' + match + "</span>");
        });
        text = text.replace(/#[^\r\n]*/g, function (match) {
            return putPlaceholder('<span class="handrive-py-token-comment">' + match + "</span>");
        });
        text = text.replace(/(["'])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, function (match) {
            return putPlaceholder('<span class="handrive-py-token-string">' + match + "</span>");
        });

        text = text.replace(/(^|\s)(@[a-zA-Z_][\w.]*)/g, '$1<span class="handrive-py-token-decorator">$2</span>');
        text = text.replace(/\b(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi, '<span class="handrive-py-token-number">$1</span>');
        text = text.replace(
            /\b(def|class|return|if|elif|else|for|while|break|continue|try|except|finally|raise|import|from|as|with|pass|yield|lambda|global|nonlocal|assert|del|in|is|and|or|not|async|await|match|case)\b/g,
            '<span class="handrive-py-token-keyword">$1</span>'
        );
        text = text.replace(/\b(True|False|None)\b/g, '<span class="handrive-py-token-literal">$1</span>');
        text = text.replace(
            /\b(len|range|str|int|float|dict|list|set|tuple|print|open|type|isinstance|enumerate|zip|map|filter|sum|min|max|abs|sorted|reversed|any|all)\b/g,
            '<span class="handrive-py-token-builtin">$1</span>'
        );
        text = text.replace(/\b(def)\s+([a-zA-Z_][\w]*)/g, '$1 <span class="handrive-py-token-function">$2</span>');
        text = text.replace(/\b(class)\s+([a-zA-Z_][\w]*)/g, '$1 <span class="handrive-py-token-class">$2</span>');

        return restorePlaceholders(text);
    }

    // HTML 코드를 하이라이팅하는 함수
    function highlightHtmlCode(source) {
        const placeholders = [];

        const putPlaceholder = function (tokenHtml) {
            const token = "@@DOCS_HTML_TOKEN_" + String(placeholders.length) + "@@";
            placeholders.push(tokenHtml);
            return token;
        };

        const restorePlaceholders = function (text) {
            return text.replace(/@@DOCS_HTML_TOKEN_(\d+)@@/g, function (_, indexText) {
                const index = Number(indexText);
                if (Number.isNaN(index) || index < 0 || index >= placeholders.length) {
                    return "";
                }
                return placeholders[index];
            });
        };

        let text = escapeHtml(source);

        text = text.replace(/&lt;!--[\s\S]*?--&gt;/g, function (match) {
            return putPlaceholder('<span class="handrive-html-token-comment">' + match + "</span>");
        });
        text = text.replace(/(["'])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, function (match) {
            return putPlaceholder('<span class="handrive-html-token-string">' + match + "</span>");
        });
        text = text.replace(
            /(&lt;\/?)([a-zA-Z][\w:-]*)([\s\S]*?)(&gt;)/g,
            function (_, open, tagName, attributes, close) {
                let highlightedAttributes = attributes;
                highlightedAttributes = highlightedAttributes.replace(
                    /(\s)([a-zA-Z_:][\w:.-]*)(\s*=\s*)/g,
                    '$1<span class="handrive-html-token-attr">$2</span>$3'
                );
                return (
                    '<span class="handrive-html-token-punctuation">' + open + "</span>" +
                    '<span class="handrive-html-token-tag">' + tagName + "</span>" +
                    highlightedAttributes +
                    '<span class="handrive-html-token-punctuation">' + close + "</span>"
                );
            }
        );

        return restorePlaceholders(text);
    }

    // 마크다운 소스 코드를 하이라이팅하는 함수
    function highlightMarkdownSourceCode(source) {
        const placeholders = [];

        const putPlaceholder = function (tokenHtml) {
            const token = "@@DOCS_MD_SRC_TOKEN_" + String(placeholders.length) + "@@";
            placeholders.push(tokenHtml);
            return token;
        };

        const restorePlaceholders = function (text) {
            return text.replace(/@@DOCS_MD_SRC_TOKEN_(\d+)@@/g, function (_, indexText) {
                const index = Number(indexText);
                if (Number.isNaN(index) || index < 0 || index >= placeholders.length) {
                    return "";
                }
                return placeholders[index];
            });
        };

        let text = escapeHtml(source);

        text = text.replace(/```[\s\S]*?```/g, function (match) {
            return putPlaceholder('<span class="handrive-md-src-token-codeblock">' + match + "</span>");
        });
        text = text.replace(/`[^`\r\n]+`/g, function (match) {
            return putPlaceholder('<span class="handrive-md-src-token-code">' + match + "</span>");
        });
        text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, url) {
            return (
                '<span class="handrive-md-src-token-link">[' +
                label +
                "](" +
                url +
                ")</span>"
            );
        });
        text = text.replace(/^(\s{0,3}#{1,6}\s+)/gm, '<span class="handrive-md-src-token-heading">$1</span>');
        text = text.replace(/^(\s{0,3}(?:[-*+]|\d+\.)\s+)/gm, '<span class="handrive-md-src-token-list">$1</span>');
        text = text.replace(/^(\s{0,3}&gt;\s?)/gm, '<span class="handrive-md-src-token-quote">$1</span>');
        text = text.replace(/^(\s{0,3}(?:[-*_])(?:\s*[-*_]){2,}\s*)$/gm, '<span class="handrive-md-src-token-hr">$1</span>');
        text = text.replace(/(\*\*|__)(.+?)\1/g, '<span class="handrive-md-src-token-strong">$1$2$1</span>');
        text = text.replace(/(\*|_)([^*_][^]*?)\1/g, '<span class="handrive-md-src-token-em">$1$2$1</span>');

        return restorePlaceholders(text);
    }

    // 코드 언어 클래스를 감지하는 함수
    function detectCodeLanguageClass(codeNode) {
        if (!codeNode || !(codeNode instanceof Element)) {
            return "";
        }
        const classes = Array.from(codeNode.classList || []);
        const languageClass = classes.find(function (className) {
            return /^language-/i.test(className);
        });
        const languageValue = languageClass ? languageClass.replace(/^language-/i, "") : "";
        const normalized = String(languageValue || "").toLowerCase();
        if (normalized === "js" || normalized === "javascript" || normalized === "mjs" || normalized === "cjs") {
            return "handrive-js";
        }
        if (normalized === "css") {
            return "handrive-css";
        }
        if (normalized === "json" || normalized === "jsonc") {
            return "handrive-json";
        }
        if (normalized === "py" || normalized === "python" || normalized === "py3" || normalized === "pyi") {
            return "handrive-py";
        }
        return "";
    }

    // 문서 코드 하이라이팅을 적용하는 함수
    function applyHandriveCodeHighlighting(targetElement, renderClass) {
        if (!targetElement || !(targetElement instanceof Element)) {
            return;
        }
        if (
            renderClass !== "handrive-js" &&
            renderClass !== "handrive-css" &&
            renderClass !== "handrive-json" &&
            renderClass !== "handrive-py" &&
            renderClass !== "ui-markdown"
        ) {
            return;
        }

        const codeNodes = targetElement.querySelectorAll("pre code");
        codeNodes.forEach(function (codeNode) {
            if (!(codeNode instanceof HTMLElement)) {
                return;
            }
            if (codeNode.dataset.handriveCodeHighlighted === "1") {
                return;
            }
            const effectiveRenderClass = renderClass === "ui-markdown"
                ? detectCodeLanguageClass(codeNode)
                : renderClass;
            if (!effectiveRenderClass) {
                return;
            }
            const source = codeNode.textContent || "";
            if (effectiveRenderClass === "handrive-js") {
                codeNode.innerHTML = highlightJavaScriptCode(source);
            } else if (effectiveRenderClass === "handrive-css") {
                codeNode.innerHTML = highlightCssCode(source);
            } else if (effectiveRenderClass === "handrive-py") {
                codeNode.innerHTML = highlightPythonCode(source);
            } else {
                codeNode.innerHTML = highlightJsonCode(source);
            }
            codeNode.dataset.handriveCodeHighlighted = "1";
        });
    }

    // 열린 문서 모달이 있는지 확인하는 함수
    function hasOpenHandriveModal() {
        return Boolean(
            document.querySelector(
                ".handrive-popup-modal:not([hidden]), .handrive-drive-modal:not([hidden]), .handrive-help-modal:not([hidden]), .handrive-folder-modal:not([hidden]), .handrive-sync-modal:not([hidden])"
            )
        );
    }

    // 문서 모달 바디 상태를 동기화하는 함수
    function syncHandriveModalBodyState() {
        document.body.classList.toggle("handrive-modal-open", hasOpenHandriveModal());
    }

    // 문서 확인 다이얼로그를 생성하는 함수
    function createHandriveConfirmDialog() {
        const confirmModal = document.getElementById("handrive-confirm-modal");
        const confirmBackdrop = document.getElementById("handrive-confirm-modal-backdrop");
        const confirmTitle = document.getElementById("handrive-confirm-title");
        const confirmMessage = document.getElementById("handrive-confirm-message");
        const confirmCancelButton = document.getElementById("handrive-confirm-cancel-btn");
        const confirmConfirmButton = document.getElementById("handrive-confirm-confirm-btn");

        if (
            !confirmModal ||
            !confirmBackdrop ||
            !confirmTitle ||
            !confirmMessage ||
            !confirmCancelButton ||
            !confirmConfirmButton
        ) {
            return async function () {
                return false;
            };
        }

        let resolvePending = null;
        let isOpen = false;
        let lastFocusedElement = null;

        // 다이얼로그를 닫는 함수
        const close = function (confirmed) {
            if (!isOpen) {
                return;
            }

            confirmModal.hidden = true;
            isOpen = false;

            if (resolvePending) {
                resolvePending(Boolean(confirmed));
                resolvePending = null;
            }

            if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
                lastFocusedElement.focus();
            }
            lastFocusedElement = null;
        };

        confirmBackdrop.addEventListener("click", function () {
            close(false);
        });

        confirmCancelButton.addEventListener("click", function () {
            close(false);
        });

        confirmConfirmButton.addEventListener("click", function () {
            close(true);
        });

        document.addEventListener("keydown", function (event) {
            if (event.key !== "Escape" || !isOpen) {
                return;
            }
            event.preventDefault();
            close(false);
        });

        // 확인 다이얼로그를 요청하는 함수
        return function requestConfirmDialog(options) {
            const settings = options || {};
            const titleText = settings.title || t("js_confirm_title", "확인");
            const messageText = settings.message || "";
            const cancelText = settings.cancelText || t("cancel", "취소");
            const confirmText = settings.confirmText || t("js_confirm_ok", "확인");

            if (resolvePending) {
                resolvePending(false);
                resolvePending = null;
            }

            confirmTitle.textContent = titleText;
            confirmMessage.textContent = messageText;
            confirmCancelButton.textContent = cancelText;
            confirmConfirmButton.textContent = confirmText;

            confirmModal.hidden = false;
            isOpen = true;
            lastFocusedElement = document.activeElement;
            confirmConfirmButton.focus();

            return new Promise(function (resolve) {
                resolvePending = resolve;
            });
        };
    }

    const requestConfirmDialog = createHandriveConfirmDialog();

    function createHandriveCommitMessageDialog() {
        const modal = document.getElementById("handrive-commit-message-modal");
        const backdrop = document.getElementById("handrive-commit-message-modal-backdrop");
        const target = document.getElementById("handrive-commit-message-target");
        const input = document.getElementById("handrive-commit-message-input");
        const cancelButton = document.getElementById("handrive-commit-message-cancel-btn");
        const confirmButton = document.getElementById("handrive-commit-message-confirm-btn");

        if (!modal || !backdrop || !target || !input || !cancelButton || !confirmButton) {
            return async function () {
                return null;
            };
        }

        let resolvePending = null;
        let isOpen = false;
        let lastFocusedElement = null;

        const close = function (value) {
            if (!isOpen) {
                return;
            }
            modal.hidden = true;
            isOpen = false;
            if (resolvePending) {
                resolvePending(value);
                resolvePending = null;
            }
            if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
                lastFocusedElement.focus();
            }
            lastFocusedElement = null;
        };

        const submit = function () {
            var message = String(input.value || "").trim();
            if (!message) {
                window.alert("커밋 메시지를 입력해주세요.");
                input.focus();
                return;
            }
            close(message);
        };

        backdrop.addEventListener("click", function () {
            close(null);
        });
        cancelButton.addEventListener("click", function () {
            close(null);
        });
        confirmButton.addEventListener("click", function () {
            submit();
        });
        input.addEventListener("keydown", function (event) {
            if (!isOpen) {
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                close(null);
                return;
            }
            if (event.key === "Enter") {
                event.preventDefault();
                submit();
            }
        });

        return function requestCommitMessageDialog(options) {
            if (resolvePending) {
                resolvePending(null);
                resolvePending = null;
            }

            var settings = options || {};
            target.textContent = settings.targetText || decodeBreadcrumbLabel(settings.targetPath || "");
            input.value = String(settings.initialValue || "");
            modal.hidden = false;
            isOpen = true;
            lastFocusedElement = document.activeElement;
            window.setTimeout(function () {
                input.focus();
                input.select();
            }, 0);

            return new Promise(function (resolve) {
                resolvePending = resolve;
            });
        };
    }

    const requestCommitMessageDialog = createHandriveCommitMessageDialog();

    function createHandriveAdminUserDialog() {
        const modal = document.getElementById("handrive-admin-user-modal");
        const backdrop = document.getElementById("handrive-admin-user-modal-backdrop");
        const target = document.getElementById("handrive-admin-user-target");
        const input = document.getElementById("handrive-admin-user-input");
        const cancelButton = document.getElementById("handrive-admin-user-cancel-btn");
        const confirmButton = document.getElementById("handrive-admin-user-confirm-btn");

        if (!modal || !backdrop || !target || !input || !cancelButton || !confirmButton) {
            return async function () {
                return null;
            };
        }

        let resolvePending = null;
        let isOpen = false;
        let lastFocusedElement = null;
        let currentSettings = {};
        let isSubmitting = false;
        let submitSequence = 0;
        let errorMessage = modal.querySelector(".handrive-admin-user-error");
        const defaultConfirmText = confirmButton.textContent;

        if (!errorMessage) {
            errorMessage = document.createElement("p");
            errorMessage.className = "handrive-admin-user-error";
            errorMessage.id = "handrive-admin-user-error";
            errorMessage.hidden = true;
            const field = input.closest(".handrive-field");
            if (field) {
                field.insertAdjacentElement("afterend", errorMessage);
            } else {
                input.insertAdjacentElement("afterend", errorMessage);
            }
        }
        if (!errorMessage.id) {
            errorMessage.id = "handrive-admin-user-error";
        }
        const describedByTokens = String(input.getAttribute("aria-describedby") || "").trim().split(/\s+/).filter(Boolean);
        if (describedByTokens.indexOf(errorMessage.id) === -1) {
            describedByTokens.push(errorMessage.id);
            input.setAttribute("aria-describedby", describedByTokens.join(" "));
        }

        const setErrorMessage = function (message) {
            const nextMessage = String(message || "").trim();
            errorMessage.textContent = nextMessage;
            errorMessage.hidden = !nextMessage;
        };

        const setSubmitting = function (submitting) {
            isSubmitting = Boolean(submitting);
            confirmButton.disabled = isSubmitting;
            input.readOnly = isSubmitting;
            input.setAttribute("aria-busy", isSubmitting ? "true" : "false");
            confirmButton.textContent = isSubmitting
                ? t("admin_user_switch_loading", "확인 중...")
                : defaultConfirmText;
        };

        const close = function (value) {
            if (!isOpen) {
                return;
            }
            submitSequence += 1;
            setSubmitting(false);
            setErrorMessage("");
            modal.hidden = true;
            isOpen = false;
            currentSettings = {};
            syncHandriveModalBodyState();
            if (resolvePending) {
                resolvePending(value);
                resolvePending = null;
            }
            if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
                lastFocusedElement.focus();
            }
            lastFocusedElement = null;
        };

        const submit = async function () {
            if (isSubmitting) {
                return;
            }
            const username = String(input.value || "").trim();
            if (!username) {
                setErrorMessage(t("admin_user_switch_empty", "사용자 ID를 입력해주세요."));
                input.focus();
                return;
            }
            const submitToken = submitSequence + 1;
            submitSequence = submitToken;
            const validate = currentSettings && typeof currentSettings.validate === "function"
                ? currentSettings.validate
                : null;
            if (validate) {
                let validationError = "";
                setErrorMessage("");
                setSubmitting(true);
                try {
                    const validationResult = await validate(username);
                    if (validationResult !== true) {
                        validationError = typeof validationResult === "string" && validationResult.trim()
                            ? validationResult.trim()
                            : t("admin_user_switch_failed", "사용자 HanDrive를 열 수 없습니다. ID를 확인해주세요.");
                    }
                } catch (error) {
                    validationError = error && error.message
                        ? error.message
                        : t("admin_user_switch_failed", "사용자 HanDrive를 열 수 없습니다. ID를 확인해주세요.");
                } finally {
                    setSubmitting(false);
                }
                if (!isOpen || submitToken !== submitSequence) {
                    return;
                }
                if (validationError) {
                    setErrorMessage(validationError);
                    input.focus();
                    input.select();
                    return;
                }
            }
            close(username);
        };

        backdrop.addEventListener("click", function () {
            close(null);
        });
        cancelButton.addEventListener("click", function () {
            close(null);
        });
        confirmButton.addEventListener("click", function () {
            submit().catch(function (error) {
                setSubmitting(false);
                setErrorMessage(error && error.message
                    ? error.message
                    : t("admin_user_switch_failed", "사용자 HanDrive를 열 수 없습니다. ID를 확인해주세요."));
            });
        });
        input.addEventListener("input", function () {
            if (isOpen) {
                setErrorMessage("");
            }
        });
        input.addEventListener("keydown", function (event) {
            if (!isOpen) {
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                close(null);
                return;
            }
            if (event.key === "Enter") {
                event.preventDefault();
                submit().catch(function (error) {
                    setSubmitting(false);
                    setErrorMessage(error && error.message
                        ? error.message
                        : t("admin_user_switch_failed", "사용자 HanDrive를 열 수 없습니다. ID를 확인해주세요."));
                });
            }
        });

        return function requestAdminUserDialog(options) {
            if (resolvePending) {
                resolvePending(null);
                resolvePending = null;
            }
            const settings = options || {};
            submitSequence += 1;
            currentSettings = settings;
            setSubmitting(false);
            setErrorMessage(settings.errorMessage || "");
            const targetText = String(settings.targetText || "").trim();
            target.textContent = targetText;
            target.hidden = !targetText;
            input.value = String(settings.initialValue || "");
            modal.hidden = false;
            isOpen = true;
            lastFocusedElement = document.activeElement;
            syncHandriveModalBodyState();
            window.setTimeout(function () {
                input.focus();
                input.select();
            }, 0);

            return new Promise(function (resolve) {
                resolvePending = resolve;
            });
        };
    }

    const requestAdminUserDialog = createHandriveAdminUserDialog();

    function createHandriveClipboardFilenameDialog() {
        const modal = document.getElementById("handrive-clipboard-filename-modal");
        const backdrop = document.getElementById("handrive-clipboard-filename-modal-backdrop");
        const target = document.getElementById("handrive-clipboard-filename-target");
        const input = document.getElementById("handrive-clipboard-filename-input");
        const cancelButton = document.getElementById("handrive-clipboard-filename-cancel-btn");
        const confirmButton = document.getElementById("handrive-clipboard-filename-confirm-btn");

        if (!modal || !backdrop || !target || !input || !cancelButton || !confirmButton) {
            return async function () {
                return null;
            };
        }

        let resolvePending = null;
        let isOpen = false;
        let lastFocusedElement = null;

        const close = function (value) {
            if (!isOpen) {
                return;
            }
            modal.hidden = true;
            isOpen = false;
            syncHandriveModalBodyState();
            if (resolvePending) {
                resolvePending(value);
                resolvePending = null;
            }
            if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
                lastFocusedElement.focus();
            }
            lastFocusedElement = null;
        };

        const submit = function () {
            close(String(input.value || "").trim());
        };

        backdrop.addEventListener("click", function () {
            close(null);
        });
        cancelButton.addEventListener("click", function () {
            close(null);
        });
        confirmButton.addEventListener("click", function () {
            submit();
        });
        input.addEventListener("keydown", function (event) {
            if (!isOpen) {
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                close(null);
                return;
            }
            if (event.key === "Enter") {
                event.preventDefault();
                submit();
            }
        });

        return function requestClipboardFilenameDialog(options) {
            if (resolvePending) {
                resolvePending(null);
                resolvePending = null;
            }

            const settings = options || {};
            target.textContent = settings.targetText || "";
            input.value = "";
            if (settings.placeholder) {
                input.placeholder = settings.placeholder;
            }
            modal.hidden = false;
            isOpen = true;
            lastFocusedElement = document.activeElement;
            syncHandriveModalBodyState();
            window.setTimeout(function () {
                input.focus();
                input.select();
            }, 0);

            return new Promise(function (resolve) {
                resolvePending = resolve;
            });
        };
    }

    const requestClipboardFilenameDialog = createHandriveClipboardFilenameDialog();

    function createHandriveUrlShareModal() {
        const shareModal = document.getElementById("handrive-url-share-modal");
        const shareBackdrop = document.getElementById("handrive-url-share-modal-backdrop");
        const shareCheckbox = document.getElementById("handrive-url-share-enabled-checkbox");
        const shareTargets = document.getElementById("handrive-url-share-targets");
        const shareTargetInput = document.getElementById("handrive-url-share-target-input");
        const shareTargetList = document.getElementById("handrive-url-share-target-list");
        const shareTargetEmpty = shareTargets ? shareTargets.querySelector(".handrive-url-share-target-empty") : null;
        const shareUrlRow = document.getElementById("handrive-url-share-url-row");
        const shareReadLabel = document.getElementById("handrive-url-share-read-label");
        const shareInput = document.getElementById("handrive-url-share-input");
        const shareDownloadRow = document.getElementById("handrive-url-share-download-row");
        const shareDownloadInput = document.getElementById("handrive-url-share-download-input");
        const shareCloseButton = document.getElementById("handrive-url-share-close-btn");
        const shareCopyButton = document.getElementById("handrive-url-share-copy-url-icon-btn");
        const shareCopyDownloadButton = document.getElementById("handrive-url-share-copy-download-icon-btn");

        if (
            !shareModal ||
            !shareBackdrop ||
            !shareCheckbox ||
            !shareTargets ||
            !shareTargetInput ||
            !shareTargetList ||
            !shareInput ||
            !shareDownloadRow ||
            !shareDownloadInput ||
            !shareCloseButton ||
            !shareCopyButton ||
            !shareCopyDownloadButton
        ) {
            return {
                open: function () {},
                close: function () {},
            };
        }

        let lastFocusedElement = null;
        let currentOnToggle = null;
        let isToggling = false;
        let currentShareUrl = "";
        let currentShareDownloadUrl = "";
        let currentAllowedUsers = [];
        let currentReadOnly = false;

        function decodeUrlForDisplay(url) {
            const rawUrl = String(url || "");
            if (!rawUrl) {
                return "";
            }
            try {
                return decodeURI(rawUrl);
            } catch (error) {
                return rawUrl;
            }
        }

        function setCopyButtonLabel(button, key, fallbackLabel) {
            const label = t(key, fallbackLabel);
            button.setAttribute("aria-label", label);
            button.setAttribute("title", label);
        }

        function resetCopyButton(button, key, fallbackLabel) {
            button.classList.remove("is-copied");
            setCopyButtonLabel(button, key, fallbackLabel);
        }

        function setUrlRowVisible(visible, url, downloadUrl) {
            currentShareUrl = visible ? String(url || "") : "";
            currentShareDownloadUrl = visible ? String(downloadUrl || "") : "";
            shareTargets.hidden = !visible || currentReadOnly;
            shareUrlRow.hidden = !visible;
            shareDownloadRow.hidden = !(visible && currentShareDownloadUrl);
            shareCopyButton.disabled = !(visible && currentShareUrl);
            shareCopyDownloadButton.disabled = !(visible && currentShareDownloadUrl);
            if (shareReadLabel) {
                shareReadLabel.textContent = currentShareDownloadUrl
                    ? t("url_share_read_label", "읽기 URL")
                    : t("url_share_label", "URL");
            }
            if (visible) {
                shareInput.value = decodeUrlForDisplay(currentShareUrl);
                shareDownloadInput.value = decodeUrlForDisplay(currentShareDownloadUrl);
            } else {
                shareInput.value = "";
                shareDownloadInput.value = "";
            }
            resetCopyButton(shareCopyButton, "url_share_copy_button", "복사");
            resetCopyButton(shareCopyDownloadButton, "url_share_copy_download_button", "다운로드 URL 복사");
        }

        function normalizeAllowedUsers(users) {
            const result = [];
            const seen = new Set();
            if (!Array.isArray(users)) {
                return result;
            }
            users.forEach(function (user) {
                let username = "";
                let label = "";
                let id = "";
                if (user && typeof user === "object") {
                    username = String(user.username || user.label || user.id || "").trim();
                    label = String(user.label || username).trim();
                    id = user.id || "";
                } else {
                    username = String(user || "").trim();
                    label = username;
                }
                if (!username || seen.has(username)) {
                    return;
                }
                seen.add(username);
                result.push({
                    id: id,
                    username: username,
                    label: label || username,
                });
            });
            return result;
        }

        function getAllowedUsernames() {
            return currentAllowedUsers.map(function (user) {
                return String(user.username || "").trim();
            }).filter(Boolean);
        }

        function setTargetControlsDisabled(disabled) {
            const isDisabled = Boolean(disabled || currentReadOnly || !currentOnToggle);
            shareTargetInput.disabled = isDisabled;
            shareTargetList.querySelectorAll(".handrive-url-share-target-remove").forEach(function (button) {
                button.disabled = isDisabled;
            });
        }

        function renderAllowedUsers() {
            shareTargetList.innerHTML = "";
            if (currentReadOnly) {
                if (shareTargetEmpty) {
                    shareTargetEmpty.hidden = true;
                }
                setTargetControlsDisabled(true);
                return;
            }
            const removeLabel = t("url_share_target_remove_label", "공유 대상 제거");
            const controlsDisabled = currentReadOnly || isToggling || !currentOnToggle;
            currentAllowedUsers.forEach(function (user) {
                const card = document.createElement("span");
                card.className = "handrive-url-share-target-card";

                const label = document.createElement("span");
                label.textContent = user.label || user.username;
                label.title = user.label || user.username;
                card.appendChild(label);

                const removeButton = document.createElement("button");
                removeButton.type = "button";
                removeButton.className = "handrive-url-share-target-remove";
                removeButton.textContent = "x";
                removeButton.setAttribute("aria-label", removeLabel);
                removeButton.title = removeLabel;
                removeButton.disabled = controlsDisabled;
                removeButton.addEventListener("click", function () {
                    removeAllowedUser(user.username);
                });
                card.appendChild(removeButton);

                shareTargetList.appendChild(card);
            });
            if (shareTargetEmpty) {
                shareTargetEmpty.hidden = currentAllowedUsers.length > 0;
            }
            setTargetControlsDisabled(controlsDisabled);
        }

        async function persistShareSettings(enabled, previousAllowedUsers, previousChecked) {
            if (!currentOnToggle || isToggling) {
                return;
            }
            isToggling = true;
            shareCheckbox.disabled = true;
            setTargetControlsDisabled(true);
            try {
                const result = await currentOnToggle(enabled, getAllowedUsernames());
                shareCheckbox.checked = Boolean(result && result.isUrlOnly);
                currentAllowedUsers = normalizeAllowedUsers(
                    (result && (result.allowedUsers || result.share_allowed_users)) || currentAllowedUsers
                );
                setUrlRowVisible(
                    shareCheckbox.checked,
                    (result && result.shareUrl) || "",
                    (result && result.downloadUrl) || ""
                );
                renderAllowedUsers();
            } catch (error) {
                currentAllowedUsers = normalizeAllowedUsers(previousAllowedUsers);
                shareCheckbox.checked = Boolean(previousChecked);
                renderAllowedUsers();
                alertError(error);
            } finally {
                shareCheckbox.disabled = currentReadOnly;
                isToggling = false;
                setTargetControlsDisabled(false);
            }
        }

        function addAllowedUser(username) {
            const normalizedUsername = String(username || "").trim();
            if (!normalizedUsername) {
                return;
            }
            if (currentAllowedUsers.some(function (user) { return user.username === normalizedUsername; })) {
                shareTargetInput.value = "";
                return;
            }
            const previousAllowedUsers = currentAllowedUsers.slice();
            currentAllowedUsers = currentAllowedUsers.concat([{
                id: "",
                username: normalizedUsername,
                label: normalizedUsername,
            }]);
            shareTargetInput.value = "";
            renderAllowedUsers();
            if (shareCheckbox.checked && currentOnToggle) {
                persistShareSettings(true, previousAllowedUsers, true);
            }
        }

        function removeAllowedUser(username) {
            if (currentReadOnly || isToggling || !currentOnToggle) {
                return;
            }
            const previousAllowedUsers = currentAllowedUsers.slice();
            currentAllowedUsers = currentAllowedUsers.filter(function (user) {
                return user.username !== username;
            });
            renderAllowedUsers();
            if (shareCheckbox.checked) {
                persistShareSettings(true, previousAllowedUsers, true);
            }
        }

        function close() {
            if (shareModal.hidden) {
                return;
            }
            shareModal.hidden = true;
            currentOnToggle = null;
            isToggling = false;
            currentReadOnly = false;
            currentAllowedUsers = [];
            shareCheckbox.disabled = false;
            shareCheckbox.hidden = false;
            shareTargetInput.value = "";
            shareTargets.hidden = true;
            renderAllowedUsers();
            resetCopyButton(shareCopyButton, "url_share_copy_button", "복사");
            resetCopyButton(shareCopyDownloadButton, "url_share_copy_download_button", "다운로드 URL 복사");
            if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
                lastFocusedElement.focus();
            }
            lastFocusedElement = null;
            syncHandriveModalBodyState();
        }

        async function copyUrlToClipboard(value, input, button, labelKey, fallbackLabel) {
            if (!value) {
                return;
            }
            try {
                if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
                    await navigator.clipboard.writeText(value);
                } else {
                    input.focus();
                    input.select();
                    document.execCommand("copy");
                }
                button.classList.add("is-copied");
                setCopyButtonLabel(button, "url_share_copied", "복사됨");
                window.setTimeout(function () {
                    resetCopyButton(button, labelKey, fallbackLabel);
                }, 1400);
            } catch (error) {
                input.focus();
                input.select();
            }
        }

        async function copyCurrentUrl() {
            await copyUrlToClipboard(
                currentShareUrl || shareInput.value || "",
                shareInput,
                shareCopyButton,
                "url_share_copy_button",
                "복사"
            );
        }

        async function copyCurrentDownloadUrl() {
            await copyUrlToClipboard(
                currentShareDownloadUrl || shareDownloadInput.value || "",
                shareDownloadInput,
                shareCopyDownloadButton,
                "url_share_copy_download_button",
                "다운로드 URL 복사"
            );
        }

        // options: { isUrlOnly: bool, shareUrl: string, downloadUrl: string, allowedUsers: array, readOnly: bool, onToggle: async (enabled, allowedUsernames) => { shareUrl, downloadUrl, isUrlOnly, allowedUsers } }
        function open(options) {
            const isUrlOnly = Boolean(options && options.isUrlOnly);
            const shareUrl = (options && options.shareUrl) || "";
            const downloadUrl = (options && options.downloadUrl) || "";
            const readOnly = Boolean(options && options.readOnly);
            currentReadOnly = readOnly;
            currentOnToggle = (!readOnly && options && typeof options.onToggle === "function") ? options.onToggle : null;
            currentAllowedUsers = readOnly ? [] : normalizeAllowedUsers((options && options.allowedUsers) || []);
            shareTargetInput.value = "";
            renderAllowedUsers();

            shareCheckbox.checked = isUrlOnly;
            shareCheckbox.disabled = readOnly;
            shareCheckbox.hidden = readOnly;
            setTargetControlsDisabled(false);
            setUrlRowVisible(isUrlOnly || readOnly, shareUrl, downloadUrl);
            shareModal.hidden = false;
            lastFocusedElement = document.activeElement;
            syncHandriveModalBodyState();
            window.requestAnimationFrame(function () {
                if (readOnly && shareInput) {
                    shareInput.focus();
                    shareInput.select();
                    return;
                }
                shareCheckbox.focus();
            });
        }

        shareCheckbox.addEventListener("change", function () {
            if (isToggling || !currentOnToggle) {
                return;
            }
            const enabled = shareCheckbox.checked;
            persistShareSettings(enabled, currentAllowedUsers.slice(), !enabled);
        });

        shareTargetInput.addEventListener("keydown", function (event) {
            if (event.key !== "Enter") {
                return;
            }
            event.preventDefault();
            addAllowedUser(shareTargetInput.value);
        });

        shareBackdrop.addEventListener("click", close);
        shareCloseButton.addEventListener("click", close);
        shareCopyButton.addEventListener("click", function () {
            copyCurrentUrl().catch(function () {});
        });
        shareCopyDownloadButton.addEventListener("click", function () {
            copyCurrentDownloadUrl().catch(function () {});
        });
        document.addEventListener("keydown", function (event) {
            if (event.key !== "Escape" || shareModal.hidden) {
                return;
            }
            event.preventDefault();
            close();
        });

        return { open: open, close: close };
    }

    const urlShareModal = createHandriveUrlShareModal();

    // 문서 페이지 도움말 모달을 초기화하는 함수
    function initializeHandrivePageHelpModal() {
        const pageHelpButton = document.getElementById("handrive-page-help-btn");
        const pageHelpModal = document.getElementById("handrive-page-help-modal");
        const pageHelpBackdrop = document.getElementById("handrive-page-help-backdrop");
        if (!pageHelpButton || !pageHelpModal || !pageHelpBackdrop) {
            return;
        }

        let lastFocusedElement = null;

        // 페이지 도움말 모달 열림 상태를 설정하는 함수
        function setPageHelpModalOpen(opened) {
            pageHelpModal.hidden = !opened;
            pageHelpButton.setAttribute("aria-expanded", opened ? "true" : "false");
            syncHandriveModalBodyState();
            if (opened) {
                lastFocusedElement = document.activeElement;
                return;
            }
            if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
                lastFocusedElement.focus();
            }
            lastFocusedElement = null;
        }

        pageHelpButton.addEventListener("click", function (event) {
            event.preventDefault();
            setPageHelpModalOpen(true);
        });

        pageHelpBackdrop.addEventListener("click", function () {
            setPageHelpModalOpen(false);
        });

        document.addEventListener("keydown", function (event) {
            if (event.key !== "Escape" || pageHelpModal.hidden) {
                return;
            }
            event.preventDefault();
            setPageHelpModalOpen(false);
        });
    }

    // 문서 인증 상호작용을 초기화하는 함수
    function initializeHandriveAuthInteraction() {
        const accountTrigger = document.querySelector("[data-auth-account-trigger]");
        const accountMenu = document.querySelector("[data-auth-account-menu]");
        const accountLogoutButton = document.querySelector("[data-auth-account-logout]");
        const profileUploadForm = document.querySelector("[data-root-account-profile-upload-form]");
        const profileImageTrigger = document.querySelector("[data-root-account-profile-image-trigger]");
        const profileImageInput = document.querySelector("[data-root-account-profile-image-input]");
        const logoutForm = document.getElementById("auth-logout-form");
        if (!accountTrigger || !logoutForm) {
            return;
        }

        const logoutModal = document.getElementById("handrive-auth-logout-modal");
        const logoutModalBackdrop = document.getElementById("handrive-auth-logout-modal-backdrop");
        const logoutCancelButton = document.getElementById("handrive-auth-logout-cancel-btn");
        const logoutConfirmButton = document.getElementById("handrive-auth-logout-confirm-btn");
        const logoutMessage = document.getElementById("handrive-auth-logout-message");

        let lastFocusedElement = null;

        function setAccountMenuOpen(opened) {
            if (!accountMenu) {
                return;
            }
            accountMenu.hidden = !opened;
            accountTrigger.setAttribute("aria-expanded", opened ? "true" : "false");
        }

        // 로그아웃 모달 열림 상태를 설정하는 함수
        function setLogoutModalOpen(opened) {
            if (!logoutModal) {
                return;
            }
            logoutModal.hidden = !opened;
            if (opened) {
                if (logoutCancelButton) {
                    logoutCancelButton.focus();
                }
                return;
            }
            if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
                lastFocusedElement.focus();
            }
        }

        async function requestLogout() {
            const message =
                (accountLogoutButton ? accountLogoutButton.getAttribute("data-confirm-message") : "") ||
                t("auth_logout_confirm", "로그아웃 하시겠습니까?");
            if (!logoutModal || !logoutModalBackdrop || !logoutCancelButton || !logoutConfirmButton || !logoutMessage) {
                const confirmed = await requestConfirmDialog({
                    title: t("auth_logout_button", "로그아웃"),
                    message: message,
                    cancelText: t("cancel", "취소"),
                    confirmText: t("auth_logout_button", "로그아웃")
                });
                if (!confirmed) {
                    return;
                }
                logoutForm.submit();
                return;
            }

            lastFocusedElement = document.activeElement;
            logoutMessage.textContent = message;
            setLogoutModalOpen(true);
        }

        accountTrigger.addEventListener("click", function (event) {
            event.preventDefault();
            if (!accountMenu) {
                requestLogout();
                return;
            }
            const isOpen = !accountMenu.hidden;
            setAccountMenuOpen(!isOpen);
        });

        if (accountLogoutButton) {
            accountLogoutButton.addEventListener("click", function (event) {
                event.preventDefault();
                setAccountMenuOpen(false);
                requestLogout();
            });
        }

        if (profileUploadForm && profileImageTrigger && profileImageInput) {
            profileImageTrigger.addEventListener("click", function (event) {
                event.preventDefault();
                profileImageInput.click();
            });

            profileImageInput.addEventListener("change", function () {
                if (!profileImageInput.files || !profileImageInput.files.length) {
                    return;
                }
                profileUploadForm.submit();
            });
        }

        document.addEventListener("click", function (event) {
            if (!accountMenu || accountMenu.hidden) {
                return;
            }
            const target = event.target;
            if (accountMenu.contains(target) || accountTrigger.contains(target)) {
                return;
            }
            setAccountMenuOpen(false);
        });

        if (logoutModalBackdrop) {
            logoutModalBackdrop.addEventListener("click", function () {
                setLogoutModalOpen(false);
            });
        }

        if (logoutCancelButton) {
            logoutCancelButton.addEventListener("click", function () {
                setLogoutModalOpen(false);
            });
        }

        if (logoutConfirmButton) {
            logoutConfirmButton.addEventListener("click", function () {
                logoutForm.submit();
            });
        }

        document.addEventListener("keydown", function (event) {
            if (event.key !== "Escape") {
                return;
            }
            if (accountMenu && !accountMenu.hidden) {
                event.preventDefault();
                setAccountMenuOpen(false);
                return;
            }
            if (!logoutModal || logoutModal.hidden) {
                return;
            }
            event.preventDefault();
            setLogoutModalOpen(false);
        });
    }

    // 문서 툴바는 한 줄을 유지한다.
    function initializeHandriveToolbarAutoCollapse() {
        const toolbar = document.querySelector(".handrive-toolbar-wrap .handrive-toolbar");
        if (!toolbar) {
            return;
        }
        toolbar.classList.remove("handrive-toolbar-auto-collapsed");
    }

    function initializeHandriveBreadcrumbOverflow() {
        const breadcrumbsList = Array.from(document.querySelectorAll(".handrive-subtitle-wrap .ui-path-breadcrumbs, .handrive-toolbar-left > .ui-path-breadcrumbs"));
        if (!breadcrumbsList.length) {
            return;
        }

        let rafId = null;

        function getBreadcrumbTextItems(breadcrumbs) {
            return Array.from(breadcrumbs.children).filter(function (child) {
                return child instanceof HTMLElement && child.matches(".ui-path-link, .ui-path-current");
            });
        }

        function resetBreadcrumbWidths(breadcrumbs) {
            breadcrumbs.classList.remove("is-equal-truncated");
            breadcrumbs.style.removeProperty("--handrive-breadcrumb-segment-width");
            getBreadcrumbTextItems(breadcrumbs).forEach(function (item) {
                item.style.removeProperty("--handrive-breadcrumb-item-width");
            });
        }

        function calculateBreadcrumbItemWidths(textItems, availableWidth) {
            const naturalWidths = textItems.map(function (item) {
                return Math.ceil(item.scrollWidth || item.getBoundingClientRect().width || 0);
            });
            let remainingWidth = Math.max(0, availableWidth);
            let remainingIndexes = naturalWidths.map(function (_width, index) {
                return index;
            });
            const widths = new Array(textItems.length).fill(0);

            while (remainingIndexes.length) {
                const sharedWidth = remainingWidth / remainingIndexes.length;
                const fixedIndexes = remainingIndexes.filter(function (index) {
                    return naturalWidths[index] <= sharedWidth;
                });

                if (!fixedIndexes.length) {
                    remainingIndexes.forEach(function (index) {
                        widths[index] = Math.max(0, sharedWidth);
                    });
                    break;
                }

                fixedIndexes.forEach(function (index) {
                    widths[index] = naturalWidths[index];
                    remainingWidth -= naturalWidths[index];
                });
                remainingIndexes = remainingIndexes.filter(function (index) {
                    return fixedIndexes.indexOf(index) === -1;
                });
            }

            return widths;
        }

        function updateBreadcrumbWidths() {
            rafId = null;
            breadcrumbsList.forEach(function (breadcrumbs) {
                resetBreadcrumbWidths(breadcrumbs);

                const textItems = getBreadcrumbTextItems(breadcrumbs);
                if (!textItems.length || breadcrumbs.clientWidth <= 0) {
                    return;
                }

                if (breadcrumbs.scrollWidth <= breadcrumbs.clientWidth + 1) {
                    return;
                }

                const children = Array.from(breadcrumbs.children).filter(function (child) {
                    return child instanceof HTMLElement;
                });
                const style = window.getComputedStyle(breadcrumbs);
                const gapValue = parseFloat(style.columnGap || style.gap || "0");
                const gap = Number.isFinite(gapValue) ? gapValue : 0;
                const separatorWidth = children.reduce(function (total, child) {
                    if (child.matches(".ui-path-link, .ui-path-current")) {
                        return total;
                    }
                    return total + child.getBoundingClientRect().width;
                }, 0);
                const gapWidth = Math.max(0, children.length - 1) * gap;
                const availableWidth = breadcrumbs.clientWidth - separatorWidth - gapWidth;
                const segmentWidth = Math.max(0, Math.floor(availableWidth / textItems.length));
                const itemWidths = calculateBreadcrumbItemWidths(textItems, availableWidth);

                breadcrumbs.style.setProperty("--handrive-breadcrumb-segment-width", segmentWidth + "px");
                textItems.forEach(function (item, index) {
                    item.style.setProperty("--handrive-breadcrumb-item-width", Math.floor(itemWidths[index]) + "px");
                });
                breadcrumbs.classList.add("is-equal-truncated");
            });
        }

        function scheduleBreadcrumbWidthUpdate() {
            if (rafId !== null) {
                return;
            }
            rafId = window.requestAnimationFrame(updateBreadcrumbWidths);
        }

        window.addEventListener("resize", scheduleBreadcrumbWidthUpdate, { passive: true });
        window.addEventListener("orientationchange", scheduleBreadcrumbWidthUpdate, { passive: true });

        if (window.ResizeObserver) {
            const resizeObserver = new ResizeObserver(scheduleBreadcrumbWidthUpdate);
            breadcrumbsList.forEach(function (breadcrumbs) {
                resizeObserver.observe(breadcrumbs);
                const wrap = breadcrumbs.closest(".handrive-subtitle-wrap");
                if (wrap) {
                    resizeObserver.observe(wrap);
                }
            });
        }

        if (window.MutationObserver) {
            const mutationObserver = new MutationObserver(scheduleBreadcrumbWidthUpdate);
            breadcrumbsList.forEach(function (breadcrumbs) {
                mutationObserver.observe(breadcrumbs, {
                    childList: true,
                    characterData: true,
                    subtree: true,
                });
            });
        }

        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(scheduleBreadcrumbWidthUpdate).catch(function () {});
        }

        scheduleBreadcrumbWidthUpdate();
    }

    function initializeListPage() {
        const handriveBaseUrl = root.dataset.handriveBaseUrl || "/handrive";
        const handriveRootUrl = root.dataset.handriveRootUrl || handriveBaseUrl;
        const listApiUrl = root.dataset.listApiUrl;
        const searchApiUrl = root.dataset.searchApiUrl;
        const saveApiUrl = root.dataset.saveApiUrl;
        const spreadsheetSaveApiUrl = root.dataset.spreadsheetSaveApiUrl || "";
        const renameApiUrl = root.dataset.renameApiUrl;
        const deleteApiUrl = root.dataset.deleteApiUrl;
        const mkdirApiUrl = root.dataset.mkdirApiUrl;
        const moveApiUrl = root.dataset.moveApiUrl;
        const archiveExtractApiUrl = root.dataset.archiveExtractApiUrl || "";
        const archiveCreateApiUrl = root.dataset.archiveCreateApiUrl || "";
        const convertMp3ApiUrl = root.dataset.convertMp3ApiUrl || "";
        const uploadApiUrl = root.dataset.uploadApiUrl;
        const markdownImageUploadApiUrl = root.dataset.markdownImageUploadApiUrl || "";
        const markdownImageCleanupApiUrl = root.dataset.markdownImageCleanupApiUrl || "";
        const uploadCancelApiUrl = root.dataset.uploadCancelApiUrl;
        const downloadApiUrl = root.dataset.downloadApiUrl;
        const previewApiUrl = root.dataset.previewApiUrl;
        const pdfPreviewApiUrl = root.dataset.pdfPreviewApiUrl || "";
        const urlShareApiUrl = root.dataset.urlShareApiUrl;
        const writeUrl = root.dataset.writeUrl || "/handrive/write";
        const mapCreateApiUrl = root.dataset.mapCreateApiUrl || "/handrive/api/map/create";
        const mapEditorBaseUrl = root.dataset.mapEditorBaseUrl || "/handrive/map-editor/";
        const mapViewerBaseUrl = root.dataset.mapViewerBaseUrl || "/handrive/map-viewer/";
        const folderIconUploadApiUrl = root.dataset.folderIconUploadApiUrl || "";
        const folderIconDeleteApiUrl = root.dataset.folderIconDeleteApiUrl || "";
        const pathBreadcrumbs = document.querySelector(".ui-path-breadcrumbs");
        const pathCurrentSizeEl = document.querySelector(".handrive-path-current-size");
        const originalDirSizeText = pathCurrentSizeEl ? (pathCurrentSizeEl.textContent || "") : "";
        const listLayout = document.getElementById("handrive-list-layout");
        const listPane = root.querySelector(".handrive-list-pane");
        const listContainer = document.getElementById("handrive-list");
        const currentDirListContainer = document.getElementById("handrive-current-dir-list");
        const listItemsContainer = document.getElementById("handrive-list-items");
        const HANDRIVE_LIST_ITEM_SCALE_STORAGE_KEY = "hanplanet.handrive.list.itemScale";
        const HANDRIVE_LIST_ITEM_SCALE_MIN = 0.72;
        const HANDRIVE_LIST_ITEM_SCALE_MAX = 1.6;
        const HANDRIVE_LIST_ITEM_SCALE_STEP = 0.05;
        let handriveListItemScale = 1;
        let listSearchForm = document.getElementById("handrive-list-search-form");
        let listSearchInput = document.getElementById("handriveListSearchInput");
        let listSearchSubmitButton = document.getElementById("handrive-list-search-submit");
        let listSearchClearButton = document.getElementById("handrive-list-search-clear");
        let currentDirSearchInput = null;
        const listLoadingOverlay = document.getElementById("handrive-list-loading");
        const previewPanel = document.getElementById("handrive-list-preview");
        const previewHead = previewPanel ? previewPanel.querySelector(".handrive-list-preview-head") : null;
        const previewTitle = document.getElementById("handrive-list-preview-title");
        const previewContent = document.getElementById("handrive-list-preview-content");
        const previewBodyLoadingOverlay = document.getElementById("handrive-list-preview-body-loading");
        const previewZoomWrap = document.getElementById("handrive-list-preview-zoom");
        const previewZoomOutButton = document.getElementById("handrive-list-preview-zoom-out");
        const previewZoomInButton = document.getElementById("handrive-list-preview-zoom-in");
        const previewNavPrevBtn = document.getElementById("handrive-preview-nav-prev");
        const previewNavNextBtn = document.getElementById("handrive-preview-nav-next");
        const previewNavBg = document.getElementById("handrive-preview-nav-bg");
        const previewNavBgPrev = previewNavBg ? previewNavBg.querySelector("span:first-child") : null;
        const previewNavBgNext = previewNavBg ? previewNavBg.querySelector("span:last-child") : null;
        const previewDownloadButton = document.getElementById("handrive-list-preview-download-btn");
        const previewPrintButton = document.getElementById("handrive-list-preview-print-btn");
        const previewEditButton = document.getElementById("handrive-list-preview-edit-btn");
        const previewSpreadsheetSaveButton = document.getElementById("handrive-list-preview-spreadsheet-save-btn");
        const previewDeleteButton = document.getElementById("handrive-list-preview-delete-btn");
        const previewUrlShareButton = document.getElementById("handrive-list-preview-url-share-btn");
        const currentDirToolbarUrlShareButton = document.getElementById("handrive-list-toolbar-current-dir-url-share-btn");
        const currentDirToolbarDeleteButton = document.getElementById("handrive-list-toolbar-current-dir-delete-btn");
        const archiveToolbarUrlShareButton = document.getElementById("handrive-list-toolbar-archive-url-share-btn");
        const archiveToolbarDownloadButton = document.getElementById("handrive-list-toolbar-archive-download-btn");
        const archiveToolbarDeleteButton = document.getElementById("handrive-list-toolbar-archive-delete-btn");
        
        // 편집기 관련 요소들
        const editorPanel = document.getElementById("handrive-list-editor");
        const editorHead = editorPanel ? editorPanel.querySelector(".handrive-list-editor-head") : null;
        const editorBody = editorPanel ? editorPanel.querySelector(".handrive-list-editor-body") : null;
        const editorFilenameInput = document.getElementById("handrive-list-filename-input");
        const editorContentInput = document.getElementById("handrive-list-content-input");
        const editorCancelButton = document.getElementById("handrive-list-cancel-btn");
        const editorSaveButton = document.getElementById("handrive-list-save-btn");
        const editorSavingOverlay = document.getElementById("handrive-list-editor-saving");
        const editorHighlightCode = document.getElementById("handrive-list-editor-highlight-code");
        const editorSurface = document.getElementById("handrive-list-editor-surface");
        const editorHighlight = document.getElementById("handrive-list-editor-highlight");
        const imageEditorSurface = document.getElementById("handrive-image-editor-surface");
        const videoEditorSurface = document.getElementById("handrive-video-editor-surface");
        const audioEditorSurface = document.getElementById("handrive-audio-editor-surface");
        const pdfEditorSurface = document.getElementById("handrive-pdf-editor-surface");
        const spreadsheetEditorSurface = document.getElementById("handrive-spreadsheet-editor-surface");
        const imageEditorSaveUrl = root.dataset.imageEditorSaveUrl || "";
        const imageEditorRemoveBackgroundUrl = root.dataset.imageEditorRemoveBackgroundUrl || "";
        const videoEditorSaveUrl = root.dataset.videoEditorSaveUrl || "";
        const audioEditorSaveUrl = root.dataset.audioEditorSaveUrl || "";
        const pdfEditorMetaUrl = root.dataset.pdfEditorMetaUrl || "";
        const pdfEditorPageUrl = root.dataset.pdfEditorPageUrl || "";
        const pdfEditorSaveUrl = root.dataset.pdfEditorSaveUrl || "";
        const handsontableLicenseKey = root.dataset.handsontableLicenseKey || "non-commercial-and-evaluation";
        const imageEditorScriptUrl = root.dataset.imageEditorScriptUrl || "";
        const videoEditorScriptUrl = root.dataset.videoEditorScriptUrl || "";
        const audioEditorScriptUrl = root.dataset.audioEditorScriptUrl || "";
        const pdfEditorScriptUrl = root.dataset.pdfEditorScriptUrl || "";
        const editorSuggest = document.getElementById("handrive-list-editor-suggest");
        const editorSuggestLabel = document.getElementById("handrive-list-editor-suggest-label");
        const markdownSnippetMenu = document.getElementById("ui-markdown-snippet-menu");
        const markdownSnippetButtons = markdownSnippetMenu
            ? Array.from(markdownSnippetMenu.querySelectorAll("button[data-editor-snippet]"))
            : [];
        
        // API URL들
        const handriveApiPreviewUrl = previewApiUrl;
        const scopedHomeDir = normalizePath(root.dataset.scopedHomeDir || "", true);
        const isSuperuser = root.dataset.isSuperuser === "1";
        const initialBreadcrumbNode = pathBreadcrumbs
            ? pathBreadcrumbs.querySelector(".ui-path-link, .ui-path-current")
            : null;
        const breadcrumbRootLabel = (initialBreadcrumbNode && initialBreadcrumbNode.textContent
            ? initialBreadcrumbNode.textContent
            : "HanDrive").trim() || "HanDrive";
        const contextMenu = document.getElementById("handrive-context-menu");
        const contextOpenButton = contextMenu ? contextMenu.querySelector('button[data-action="open"]') : null;
        const contextDownloadButton = contextMenu ? contextMenu.querySelector('button[data-action="download"]') : null;
        const contextExtractArchiveButton = contextMenu ? contextMenu.querySelector('button[data-action="extract-archive"]') : null;
        const contextShareButton = contextMenu ? contextMenu.querySelector('button[data-action="share"]') : null;
        const contextUploadButton = contextMenu ? contextMenu.querySelector('button[data-action="upload"]') : null;
        const contextCreateArchiveButton = contextMenu ? contextMenu.querySelector('button[data-action="create-archive"]') : null;
        const contextEditButton = contextMenu ? contextMenu.querySelector('button[data-action="edit"]') : null;
        const contextRenameButton = contextMenu ? contextMenu.querySelector('button[data-action="rename"]') : null;
        const contextDeleteButton = contextMenu ? contextMenu.querySelector('button[data-action="delete"]') : null;
        const contextNewFolderButton = contextMenu ? contextMenu.querySelector('button[data-action="new-folder"]') : null;
        const contextNewDocButton = contextMenu ? contextMenu.querySelector('button[data-action="new-doc"]') : null;
        const contextGitCreateRepoButton = contextMenu ? contextMenu.querySelector('button[data-action="git-create-repo"]') : null;
        const contextCreateMapButton = contextMenu ? contextMenu.querySelector('button[data-action="create-map"]') : null;
        const contextConvertMp3Button = contextMenu ? contextMenu.querySelector('button[data-action="convert-mp3"]') : null;
        const contextGitManageRepoButton = contextMenu ? contextMenu.querySelector('button[data-action="git-manage-repo"]') : null;
        const contextGitDeleteRepoButton = contextMenu ? contextMenu.querySelector('button[data-action="git-delete-repo"]') : null;
        const contextGitCreateBranchButton = contextMenu ? contextMenu.querySelector('button[data-action="git-create-branch"]') : null;
        const contextGitDeleteBranchButton = contextMenu ? contextMenu.querySelector('button[data-action="git-delete-branch"]') : null;
        const contextChangeIconButton = contextMenu ? contextMenu.querySelector('button[data-action="change-icon"]') : null;
        const contextGoogleDriveAddItemsButton = contextMenu ? contextMenu.querySelector('button[data-action="google-drive-add-items"]') : null;
        const branchCreateModal = document.getElementById("handrive-branch-create-modal");
        const branchCreateModalBackdrop = document.getElementById("handrive-branch-create-modal-backdrop");
        const branchCreateTarget = document.getElementById("handrive-branch-create-target");
        const branchCreateInput = document.getElementById("handrive-branch-create-input");
        const branchCreateCancelButton = document.getElementById("handrive-branch-create-cancel-btn");
        const branchCreateConfirmButton = document.getElementById("handrive-branch-create-confirm-btn");
        const renameModal = document.getElementById("handrive-rename-modal");
        const renameModalBackdrop = document.getElementById("handrive-rename-modal-backdrop");
        const renameInput = document.getElementById("handrive-rename-input");
        const renameTarget = document.getElementById("handrive-rename-target");
        const renameCancelButton = document.getElementById("handrive-rename-cancel-btn");
        const renameConfirmButton = document.getElementById("handrive-rename-confirm-btn");
        const archiveExtractModal = document.getElementById("handrive-archive-extract-modal");
        const archiveExtractModalBackdrop = document.getElementById("handrive-archive-extract-modal-backdrop");
        const archiveExtractTarget = document.getElementById("handrive-archive-extract-target");
        const archiveExtractCancelButton = document.getElementById("handrive-archive-extract-cancel-btn");
        const archiveExtractCurrentButton = document.getElementById("handrive-archive-extract-current-btn");
        const archiveExtractFolderButton = document.getElementById("handrive-archive-extract-folder-btn");
        const archiveCreateModal = document.getElementById("handrive-archive-create-modal");
        const archiveCreateModalBackdrop = document.getElementById("handrive-archive-create-modal-backdrop");
        const archiveCreateTarget = document.getElementById("handrive-archive-create-target");
        const archiveCreateInput = document.getElementById("handrive-archive-create-input");
        const archiveCreateCancelButton = document.getElementById("handrive-archive-create-cancel-btn");
        const archiveCreateConfirmButton = document.getElementById("handrive-archive-create-confirm-btn");
        const folderCreateModal = document.getElementById("handrive-folder-create-modal");
        const folderCreateModalBackdrop = document.getElementById("handrive-folder-create-modal-backdrop");
        const folderCreateTarget = document.getElementById("handrive-folder-create-target");
        const folderCreateInput = document.getElementById("handrive-folder-create-input");
        const folderCreateCancelButton = document.getElementById("handrive-folder-create-cancel-btn");
        const folderCreateConfirmButton = document.getElementById("handrive-folder-create-confirm-btn");
        const gitRepoModal = document.getElementById("handrive-git-repo-modal");
        const gitRepoModalBackdrop = document.getElementById("handrive-git-repo-modal-backdrop");
        const gitRepoTarget = document.getElementById("handrive-git-repo-target");
        const gitRepoNameInput = document.getElementById("handrive-git-repo-name-input");
        const gitRepoCancelButton = document.getElementById("handrive-git-repo-cancel-btn");
        const gitRepoConfirmButton = document.getElementById("handrive-git-repo-confirm-btn");
        const gitRepoForm = document.getElementById("handrive-git-repo-form");
        const gitRepoStatusDiv = document.getElementById("handrive-git-repo-status");
        const gitRepoStatusMsg = document.getElementById("handrive-git-repo-status-msg");
        const gitRepoCloneInfo = document.getElementById("handrive-git-repo-clone-info");
        const gitRepoCloneUrlInput = document.getElementById("handrive-git-repo-clone-url-input");
        const gitRepoCopyButton = document.getElementById("handrive-git-repo-copy-btn");
        const gitRepoOpenButton = document.getElementById("handrive-git-repo-open-btn");
        const gitRepoCloseButton = document.getElementById("handrive-git-repo-close-btn");
        const gitRepoRetryButton = document.getElementById("handrive-git-repo-retry-btn");
        const gitRepoTitle = document.getElementById("handrive-git-repo-title");
        const mapCreateModal = document.getElementById("handrive-map-create-modal");
        const mapCreateModalBackdrop = document.getElementById("handrive-map-create-modal-backdrop");
        const mapCreateInput = document.getElementById("handrive-map-create-input");
        const mapCreateTarget = document.getElementById("handrive-map-create-target");
        const mapCreateCancelButton = document.getElementById("handrive-map-create-cancel-btn");
        const mapCreateConfirmButton = document.getElementById("handrive-map-create-confirm-btn");
        const folderIconModal = document.getElementById("handrive-folder-icon-modal");
        const folderIconModalBackdrop = document.getElementById("handrive-folder-icon-modal-backdrop");
        const folderIconTarget = document.getElementById("handrive-folder-icon-target");
        const folderIconFileInput = document.getElementById("handrive-folder-icon-file-input");
        const folderIconPreviewWrap = document.getElementById("handrive-folder-icon-preview-wrap");
        const folderIconPreviewImg = document.getElementById("handrive-folder-icon-preview-img");
        const folderIconDeleteButton = document.getElementById("handrive-folder-icon-delete-btn");
        const folderIconCancelButton = document.getElementById("handrive-folder-icon-cancel-btn");
        const folderIconConfirmButton = document.getElementById("handrive-folder-icon-confirm-btn");
        const syncLaunchButton = document.getElementById("account-storage-popup-sync-btn");
        const syncModal = document.getElementById("handrive-sync-modal");
        const syncModalBackdrop = document.getElementById("handrive-sync-modal-backdrop");
        const syncList = document.getElementById("handrive-sync-list");
        const syncCloseButton = document.getElementById("handrive-sync-close-btn");
        const syncCancelButton = document.getElementById("handrive-sync-cancel-btn");
        const syncSaveButton = document.getElementById("handrive-sync-save-btn");
        const uploadQueuePanel = document.getElementById("handrive-job-queue-panel");
        const uploadQueueSummary = document.getElementById("handrive-job-queue-summary");
        const uploadQueueList = document.getElementById("handrive-job-queue-list");
        const uploadQueueToggleButton = document.getElementById("handrive-job-queue-toggle");
        const uploadQueueCloseButton = document.getElementById("handrive-job-queue-close");
        const contextUploadInput = document.getElementById("handrive-context-upload-input");
        const defaultContextButtonLabels = {
            open: contextOpenButton ? contextOpenButton.textContent : "",
            delete: contextDeleteButton ? contextDeleteButton.textContent : "",
        };
        const nonEditableMediaExtensions = new Set([
            ".png",
            ".jpg",
            ".jpeg",
            ".gif",
            ".webp",
            ".svg",
            ".bmp",
            ".avif",
            ".ico",
            ".mp4",
            ".webm",
            ".mov",
            ".mkv",
            ".m4v",
            ".ogv",
            ".mp3",
            ".wav",
            ".ogg",
            ".m4a",
            ".aac",
            ".flac",
            ".weba",
            ".pdf",
        ]);
        const imageEditorExtensions = new Set([
            ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif", ".avif",
        ]);
        const audioEditorExtensions = new Set([
            ".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac", ".weba",
        ]);
        const videoEditorExtensions = new Set([
            ".mp4", ".mov", ".webm", ".mkv", ".avi", ".wmv", ".m4v", ".ogv",
        ]);
        const pdfEditorExtensions = new Set([
            ".pdf",
        ]);
        const spreadsheetEditorExtensions = new Set([
            ".csv", ".xls", ".xlsx",
        ]);
        function isImageEditorEntry(entry) {
            return imageEditorExtensions.has(getEntryFileExtension(entry));
        }
        function isAudioEditorEntry(entry) {
            return audioEditorExtensions.has(getEntryFileExtension(entry));
        }
        function isVideoEditorEntry(entry) {
            return videoEditorExtensions.has(getEntryFileExtension(entry));
        }
        function isPdfEditorEntry(entry) {
            return Boolean(
                entry &&
                entry.can_edit &&
                !entry.google_drive &&
                !entry.is_git_virtual &&
                !entry.is_archive_member &&
                pdfEditorExtensions.has(getEntryFileExtension(entry))
            );
        }
        function isSpreadsheetEditorEntry(entry) {
            return Boolean(entry && entry.can_edit && spreadsheetEditorExtensions.has(getEntryFileExtension(entry)));
        }

        const mediaNavExtensions = new Set([
            ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif", ".tiff", ".tif", ".ico",
            ".mp4", ".webm", ".mov", ".mkv", ".m4v", ".ogv",
        ]);
        function isMediaNavEntry(entry) {
            return Boolean(entry && entry.type === "file" && mediaNavExtensions.has(getEntryFileExtension(entry)));
        }

        function getVisibleSiblingMediaEntries(parentPath) {
            const normalizedParentPath = normalizePath(parentPath, true);
            const visiblePaths = Array.isArray(state.visibleEntryPaths) ? state.visibleEntryPaths : [];
            const visibleEntries = visiblePaths
                .map(function (pathValue) {
                    return state.entryByPath.get(pathValue) || null;
                })
                .filter(function (entry) {
                    return Boolean(entry && isMediaNavEntry(entry) && getParentPath(entry.path) === normalizedParentPath);
                });
            if (visibleEntries.length) {
                return visibleEntries;
            }
            return getCachedEntries(normalizedParentPath).filter(function (entry) {
                return Boolean(entry && isMediaNavEntry(entry) && getParentPath(entry.path) === normalizedParentPath);
            });
        }

        const currentDir = normalizePath(root.dataset.currentDir || "", true);
        const currentDirIsRoot = root.dataset.currentDirIsRoot === "1";
        const currentDirCanEdit = root.dataset.currentDirCanEdit === "1";
        const currentDirCanWriteChildren =
            root.dataset.currentDirCanWriteChildren === "1" || currentDirCanEdit;
        const currentDirHasChildren = root.dataset.currentDirHasChildren === "1";
        const currentDirIsGitRepoRoot = root.dataset.currentDirIsGitRepoRoot === "1";
        const currentDirIsGoogleDrive = root.dataset.currentDirIsGoogleDrive === "1";
        const currentDirIsArchiveVirtual = root.dataset.currentDirIsArchiveVirtual === "1";
        const currentDirArchivePath = String(root.dataset.currentDirArchivePath || "").trim();
        const currentDirArchiveMemberPath = String(root.dataset.currentDirArchiveMemberPath || "").trim();
        const currentDirArchiveCanEdit = root.dataset.currentDirArchiveCanEdit === "1";
        const currentDirArchiveCanDelete = root.dataset.currentDirArchiveCanDelete === "1";
        const currentDirRequiresCommitMessage = root.dataset.currentDirRequiresCommitMessage === "1";
        const currentDirGitBranchRoot = root.dataset.currentDirGitBranchRoot === "1";
        const currentDirGitCommitId = String(root.dataset.currentDirGitCommitId || "").trim();
        const currentDirGitCommitMessage = String(root.dataset.currentDirGitCommitMessage || "").trim();
        const currentDirGitCommitAuthorUsername = String(root.dataset.currentDirGitCommitAuthorUsername || "").trim();
        const currentDirModifiedDisplay = String(root.dataset.currentDirModifiedDisplay || "").trim();
        const currentDirSizeDisplay = String(root.dataset.currentDirSizeDisplay || "").trim();
        const currentDirIsUrlOnly = root.dataset.currentDirIsUrlOnly === "1";
        const currentDirShareUrl = String(root.dataset.currentDirShareUrl || "").trim();
        const currentDirShareDownloadUrl = String(root.dataset.currentDirShareDownloadUrl || "").trim();
        const currentDirShareIsInherited = root.dataset.currentDirShareIsInherited === "1";
        const accountProfileImageUrl = String(root.dataset.accountProfileImageUrl || "").trim();
        const canSwitchAdminHandriveUser = root.dataset.handriveAdminUserSwitchEnabled === "1";
        const handriveRootLabel = (root.dataset.handriveRootLabel || breadcrumbRootLabel || "HanDrive").trim() || "HanDrive";
        const effectiveRootLabel = handriveRootLabel;
        const syncSettingsApiUrl = root.dataset.syncSettingsApiUrl || "";
        const sharedRootPath = normalizePath(root.dataset.handriveSharedRootPath || "", true);
        const initialEntries = getJsonScriptData("handrive-initial-entries", []);
        const currentDirShareAllowedUsers = getJsonScriptData("handrive-current-dir-share-allowed-users", []);
        const currentDirWriteAclLabels = getJsonScriptData("handrive-current-dir-write-acl-labels", []);
        const initialSyncExcludedPaths = getJsonScriptData("handrive-sync-excluded-paths", []);
        let currentDirGitRepo = getJsonScriptData("handrive-current-dir-git-repo", null);
        let currentDirGoogleDrive = getJsonScriptData("handrive-current-dir-google-drive", null);
        const adminUserCheckApiUrl = String(root.dataset.adminUserCheckApiUrl || "").trim();

        async function promptCommitMessage(targetPath) {
            return requestCommitMessageDialog({
                targetPath: targetPath || "",
                targetText: getHandrivePathLabel(targetPath || ""),
            });
        }

        function requiresCommitMessageForDirectory(pathValue) {
            var normalized = normalizePath(pathValue, true);
            if (normalized === state.currentDir) {
                return Boolean(getCurrentDirMeta().requires_commit_message);
            }
            var entry = state.entryByPath.get(normalized);
            return Boolean(entry && entry.requires_commit_message);
        }

        function requiresCommitMessageForEntries(entries) {
            return Array.isArray(entries) && entries.some(function (entry) {
                return Boolean(entry && entry.requires_commit_message);
            });
        }

        function normalizeAdminSwitchUsername(rawUsername) {
            const username = String(rawUsername || "").trim();
            if (!username || username.indexOf("/") !== -1 || username.indexOf("\\") !== -1) {
                return "";
            }
            return username;
        }

        function buildAdminUserHomeUrl(username) {
            const safeUsername = normalizeAdminSwitchUsername(username);
            if (!safeUsername) {
                return "";
            }
            const targetPath = "users/" + safeUsername;
            const encoded = encodePathSegments(targetPath);
            const baseUrl = handriveBaseUrl + "/" + encoded + "/list";
            return appendQueryParam(baseUrl, handriveAdminUserParam, safeUsername);
        }

        async function validateAdminSwitchUsername(username) {
            const targetUrl = buildAdminUserHomeUrl(username);
            if (!targetUrl) {
                return t("admin_user_switch_invalid", "사용자 ID에는 슬래시를 사용할 수 없습니다.");
            }
            if (adminUserCheckApiUrl) {
                let payload = null;
                try {
                    const checkResponse = await fetch(appendQueryParam(adminUserCheckApiUrl, "username", username), {
                        method: "GET",
                        credentials: "same-origin",
                        cache: "no-store",
                        headers: {
                            "Accept": "application/json"
                        }
                    });
                    try {
                        payload = await checkResponse.json();
                    } catch (error) {
                        payload = null;
                    }
                    if (checkResponse.ok && payload && payload.ok) {
                        return true;
                    }
                    if (payload && payload.message) {
                        return String(payload.message);
                    }
                } catch (error) {
                    return t("admin_user_switch_failed", "사용자 HanDrive를 열 수 없습니다. ID를 확인해주세요.");
                }
                return t("admin_user_switch_failed", "사용자 HanDrive를 열 수 없습니다. ID를 확인해주세요.");
            }
            let response = null;
            try {
                response = await fetch(targetUrl, {
                    method: "GET",
                    credentials: "same-origin",
                    cache: "no-store",
                    headers: {
                        "Accept": "text/html"
                    }
                });
            } catch (error) {
                return t("admin_user_switch_failed", "사용자 HanDrive를 열 수 없습니다. ID를 확인해주세요.");
            }
            if (response.ok) {
                return true;
            }
            return t("admin_user_switch_failed", "사용자 HanDrive를 열 수 없습니다. ID를 확인해주세요.");
        }

        async function openAdminUserSwitchDialog() {
            if (!canSwitchAdminHandriveUser) {
                return;
            }
            const initialUsername = handriveAdminUser || getCurrentFolderName(state.currentDir);
            const username = normalizeAdminSwitchUsername(await requestAdminUserDialog({
                initialValue: initialUsername,
                validate: validateAdminSwitchUsername,
            }));
            if (!username) {
                return;
            }
            const targetUrl = buildAdminUserHomeUrl(username);
            if (targetUrl) {
                window.location.assign(targetUrl);
            }
        }

        function bindAdminUserSwitchAvatar(typeMarker, currentDirMeta) {
            if (!canSwitchAdminHandriveUser || !typeMarker || !currentDirMeta || !currentDirMeta.is_root) {
                return;
            }
            const label = t("admin_user_switch_title", "사용자 HanDrive 열기");
            typeMarker.classList.add("is-admin-user-switch-trigger");
            typeMarker.removeAttribute("aria-hidden");
            typeMarker.setAttribute("role", "button");
            typeMarker.tabIndex = 0;
            typeMarker.setAttribute("aria-label", label);
            typeMarker.title = label;
            typeMarker.addEventListener("click", function (event) {
                event.preventDefault();
                event.stopPropagation();
                openAdminUserSwitchDialog().catch(alertError);
            });
            typeMarker.addEventListener("keydown", function (event) {
                if (event.key !== "Enter" && event.key !== " ") {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                openAdminUserSwitchDialog().catch(alertError);
            });
        }

        // list 페이지 단일 상태 저장소.
        // 선택/컨텍스트 메뉴/확장 폴더/preview/upload queue 상태를 한곳에서 추적한다.
        const state = {
            currentDir: currentDir,
            currentDirMeta: {
                path: currentDir,
                is_root: currentDirIsRoot,
                can_edit: currentDirCanEdit,
                can_write_children: currentDirCanWriteChildren,
                has_children: currentDirHasChildren,
                is_git_repo_root: currentDirIsGitRepoRoot,
                requires_commit_message: currentDirRequiresCommitMessage,
                git_branch_root: currentDirGitBranchRoot,
                git_commit_id: currentDirGitCommitId,
                git_commit_message: currentDirGitCommitMessage,
                git_commit_author_username: currentDirGitCommitAuthorUsername,
                modified_display: currentDirModifiedDisplay,
                size_display: currentDirSizeDisplay,
                is_url_only: currentDirIsUrlOnly,
                share_url: currentDirShareUrl,
                share_download_url: currentDirShareDownloadUrl,
                share_is_inherited: currentDirShareIsInherited,
                share_allowed_users: Array.isArray(currentDirShareAllowedUsers) ? currentDirShareAllowedUsers : [],
                write_acl_labels: Array.isArray(currentDirWriteAclLabels) ? currentDirWriteAclLabels : [],
                git_repo: currentDirGitRepo,
                is_google_drive: currentDirIsGoogleDrive,
                google_drive: currentDirGoogleDrive,
                is_archive_virtual: currentDirIsArchiveVirtual,
                archive_path: currentDirArchivePath,
                archive_member_path: currentDirArchiveMemberPath,
                archive_can_edit: currentDirArchiveCanEdit,
                archive_can_delete: currentDirArchiveCanDelete,
            },
            selectedPath: "",
            selectedPaths: new Set(),
            selectionAnchorPath: "",
            contextTarget: null,
            contextEntries: [],
            renameTargetEntry: null,
            archiveExtractTargetEntry: null,
            archiveCreateTargetEntries: [],
            folderIconTargetEntry: null,
            folderCreateParentEntry: null,
            expandedFolders: new Set(),
            openingFolderPath: "",
            openingAnimationOrder: 0,
            suppressOpeningAnimation: false,
            directoryCache: new Map(),
            directoryLoadPromises: new Map(),
            directoryCacheMaxEntries: 120,
            directoryMetaCache: new Map(),
            draggingEntries: [],
            draggingRowPaths: new Set(),
            entryByPath: new Map(),
            entryRowByPath: new Map(),
            visibleEntryPaths: [],
            dragOverElement: null,
            dragHoverElement: null,
            fileDropGroupRows: [],
            fileDropGroupPath: "",
            fileDropGroupHighlightElement: null,
            fileDropSourceKind: "",
            hoverExpandTimerId: null,
            hoverExpandPath: "",
            previewCache: new Map(),
            previewCacheMaxEntries: 30,
            previewRequestToken: 0,
            previewAbortController: null,
            activePreviewPath: "",
            activeRenderedPreviewPath: "",
            previewImageZoom: 1,
            uploadQueueItems: [],
            uploadQueueSequence: 0,
            uploadWorkerActive: false,
            operationWorkerActive: false,
            uploadRefreshPending: false,
            uploadQueueDismissed: false,
            uploadQueueCollapsed: false,
            uploadQueueContextItem: null,
            pendingContextUploadDir: "",
            searchQuery: "",
            searchResults: null,
            listSortKey: "type",
            listSortDirection: "asc",
            searchGeneration: 0,
            navigationGeneration: 0,
            syncSavedUncheckedPaths: new Set(Array.isArray(initialSyncExcludedPaths) ? initialSyncExcludedPaths : []),
            syncDraftUncheckedPaths: new Set(Array.isArray(initialSyncExcludedPaths) ? initialSyncExcludedPaths : []),
            syncExpandedFolders: new Set(),
        };
        state.directoryMetaCache.set(currentDir, state.currentDirMeta);

        const githubRepoLabelByPath = new Map();
        const githubRepoLabelById = new Map();
        const googleDriveLabelByPath = new Map();

        function normalizeGithubRepoId(repoId) {
            const idText = String(repoId || "").trim();
            if (!idText) {
                return "";
            }
            return idText.replace(/^github:/, "");
        }

        function resolveGithubRepoIdFromGitRepo(gitRepo) {
            if (!gitRepo || gitRepo.provider !== "github") {
                return "";
            }
            return normalizeGithubRepoId(gitRepo.id || gitRepo.github_repo_id);
        }

        function resolveGithubRepoLabelFromGitRepo(gitRepo) {
            if (!gitRepo || gitRepo.provider !== "github") {
                return "";
            }
            return String(gitRepo.name || gitRepo.repo_name || gitRepo.full_name || "").trim();
        }

        function resolveGithubRepoLabelFromEntry(entry) {
            if (!entry) {
                return "";
            }
            if (entry.github_repo) {
                return String(entry.github_repo.name || entry.name || entry.github_repo.full_name || "").trim();
            }
            return resolveGithubRepoLabelFromGitRepo(entry.git_repo);
        }

        function resolveGithubRepoIdFromEntry(entry) {
            if (!entry) {
                return "";
            }
            if (entry.github_repo) {
                return normalizeGithubRepoId(entry.github_repo.id);
            }
            return resolveGithubRepoIdFromGitRepo(entry.git_repo);
        }

        function resolveGithubRepoIdFromVirtualPath(pathValue) {
            const normalizedPath = normalizePath(pathValue, true);
            if (!normalizedPath) {
                return "";
            }
            const parts = normalizedPath.split("/").filter(Boolean);
            for (let index = 0; index < parts.length; index += 1) {
                const match = /^\.github-repo-(\d+)(?:-\d+)?$/.exec(parts[index]);
                if (match) {
                    return match[1];
                }
            }
            return "";
        }

        function resolveGithubVirtualRootPath(pathValue) {
            const normalizedPath = normalizePath(pathValue, true);
            if (!normalizedPath) {
                return "";
            }
            const parts = normalizedPath.split("/").filter(Boolean);
            const rootIndex = parts.findIndex(function (part) {
                return /^\.github-repo-\d+(?:-\d+)?$/.test(part);
            });
            if (rootIndex < 0) {
                return "";
            }
            return parts.slice(0, rootIndex + 1).join("/");
        }

        function registerGithubRepoLabel(pathValue, label) {
            const normalizedPath = normalizePath(pathValue, true);
            const normalizedLabel = String(label || "").trim();
            if (!normalizedPath || !normalizedLabel) {
                return;
            }
            githubRepoLabelByPath.set(normalizedPath, normalizedLabel);
            const repoId = resolveGithubRepoIdFromVirtualPath(normalizedPath);
            if (repoId) {
                githubRepoLabelById.set(repoId, normalizedLabel);
            }
        }

        function registerGithubRepoLabelById(repoId, label) {
            const normalizedId = normalizeGithubRepoId(repoId);
            const normalizedLabel = String(label || "").trim();
            if (!normalizedId || !normalizedLabel) {
                return;
            }
            githubRepoLabelById.set(normalizedId, normalizedLabel);
        }

        function registerGithubRepoLabelsFromEntries(entries) {
            if (!Array.isArray(entries)) {
                return;
            }
            entries.forEach(function (entry) {
                const label = resolveGithubRepoLabelFromEntry(entry);
                registerGithubRepoLabelById(resolveGithubRepoIdFromEntry(entry), label);
                if (label && entry && entry.path) {
                    registerGithubRepoLabel(entry.path, label);
                }
            });
        }

        function registerGithubRepoLabelFromMeta(meta) {
            const safeMeta = meta || {};
            const label = resolveGithubRepoLabelFromGitRepo(safeMeta.git_repo);
            if (!label) {
                return;
            }
            registerGithubRepoLabelById(resolveGithubRepoIdFromGitRepo(safeMeta.git_repo), label);
            const metaPath = normalizePath(safeMeta.path || state.currentDir, true);
            const repoRootPath = safeMeta.is_git_repo_root
                ? metaPath
                : resolveGithubVirtualRootPath(metaPath);
            registerGithubRepoLabel(repoRootPath, label);
        }

        function resolveGithubBreadcrumbLabel(pathValue) {
            const normalizedPath = normalizePath(pathValue, true);
            if (!normalizedPath) {
                return "";
            }

            const registeredLabel = githubRepoLabelByPath.get(normalizedPath);
            if (registeredLabel) {
                return registeredLabel;
            }

            const entry = state.entryByPath.get(normalizedPath);
            const entryLabel = resolveGithubRepoLabelFromEntry(entry);
            if (entryLabel) {
                registerGithubRepoLabel(normalizedPath, entryLabel);
                return entryLabel;
            }

            const repoRootPath = resolveGithubVirtualRootPath(normalizedPath);
            if (repoRootPath && normalizedPath === repoRootPath) {
                const idLabel = githubRepoLabelById.get(resolveGithubRepoIdFromVirtualPath(repoRootPath));
                if (idLabel) {
                    registerGithubRepoLabel(repoRootPath, idLabel);
                    return idLabel;
                }
            }

            const cachedMeta = state.directoryMetaCache.get(normalizedPath);
            if (cachedMeta && cachedMeta.is_git_repo_root) {
                const cachedLabel = resolveGithubRepoLabelFromGitRepo(cachedMeta.git_repo);
                if (cachedLabel) {
                    registerGithubRepoLabel(normalizedPath, cachedLabel);
                    return cachedLabel;
                }
            }

            const currentMeta = state.currentDirMeta || {};
            const currentLabel = resolveGithubRepoLabelFromGitRepo(currentMeta.git_repo);
            const currentRepoRootPath = resolveGithubVirtualRootPath(currentMeta.path || state.currentDir);
            if (currentLabel && currentRepoRootPath && normalizedPath === currentRepoRootPath) {
                registerGithubRepoLabel(currentRepoRootPath, currentLabel);
                return currentLabel;
            }

            return "";
        }

        function applyGithubBreadcrumbLabels(crumbs) {
            if (!Array.isArray(crumbs)) {
                return [];
            }
            return crumbs.map(function (crumb) {
                const githubLabel = resolveGithubBreadcrumbLabel(crumb && crumb.path);
                if (!githubLabel) {
                    return crumb;
                }
                return Object.assign({}, crumb, { label: githubLabel });
            });
        }

        function resolveGoogleDriveLabelFromEntry(entry) {
            if (!entry || !entry.google_drive) {
                return "";
            }
            return String(entry.google_drive.name || entry.name || "").trim();
        }

        function isGoogleDriveRootMeta(meta) {
            return Boolean(meta && meta.is_google_drive && meta.google_drive && meta.google_drive.is_root);
        }

        function isGoogleDriveRootEntry(entry) {
            return Boolean(entry && entry.type === "dir" && entry.google_drive && entry.google_drive.is_root);
        }

        function getGoogleDriveSelectedCount(entry) {
            if (!entry || !entry.google_drive) {
                return 0;
            }
            const rawCount = entry.google_drive.selected_count;
            if (rawCount === null || rawCount === undefined || rawCount === "") {
                return 0;
            }
            const parsed = Number(rawCount);
            return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
        }

        function shouldOpenGoogleDrivePickerOnClick(entry, event) {
            if (!isGoogleDriveRootEntry(entry) || getGoogleDriveSelectedCount(entry) > 0) {
                return false;
            }
            if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) {
                return false;
            }
            return !event || event.detail <= 1;
        }

        function openGoogleDriveItemPicker() {
            const pickerApi = window.HandriveGoogleDrivePicker;
            if (!pickerApi || typeof pickerApi.open !== "function") {
                return Promise.reject(new Error(t("google_drive_picker_error", textByLang("Google Picker를 열지 못했습니다.", "Failed to open Google Picker."))));
            }
            previewCancelScrollIntoView({ freezePosition: true });
            return pickerApi.open({
                throwOnError: true,
                onSaved: function () {
                    refreshCurrentDirectory({ skipPreview: true }).catch(alertError);
                },
            });
        }

        function resolveGoogleDriveLabelFromMeta(meta) {
            if (!meta || !meta.google_drive) {
                return "";
            }
            return String(meta.google_drive.name || "").trim();
        }

        function registerGoogleDriveLabel(pathValue, label) {
            const normalizedPath = normalizePath(pathValue, true);
            const normalizedLabel = String(label || "").trim();
            if (!normalizedPath || !normalizedLabel) {
                return;
            }
            googleDriveLabelByPath.set(normalizedPath, normalizedLabel);
        }

        function registerGoogleDriveLabelsFromEntries(entries) {
            if (!Array.isArray(entries)) {
                return;
            }
            entries.forEach(function (entry) {
                const label = resolveGoogleDriveLabelFromEntry(entry);
                if (label && entry && entry.path) {
                    registerGoogleDriveLabel(entry.path, label);
                }
            });
        }

        function registerGoogleDriveLabelFromMeta(meta) {
            const safeMeta = meta || {};
            const label = resolveGoogleDriveLabelFromMeta(safeMeta);
            if (!label) {
                return;
            }
            registerGoogleDriveLabel(safeMeta.path || state.currentDir, label);
        }

        function resolveGoogleDriveBreadcrumbLabel(pathValue) {
            const normalizedPath = normalizePath(pathValue, true);
            if (!normalizedPath) {
                return "";
            }
            const registeredLabel = googleDriveLabelByPath.get(normalizedPath);
            if (registeredLabel) {
                return registeredLabel;
            }
            const entry = state.entryByPath.get(normalizedPath);
            const entryLabel = resolveGoogleDriveLabelFromEntry(entry);
            if (entryLabel) {
                registerGoogleDriveLabel(normalizedPath, entryLabel);
                return entryLabel;
            }
            const cachedMeta = state.directoryMetaCache.get(normalizedPath);
            const cachedLabel = resolveGoogleDriveLabelFromMeta(cachedMeta);
            if (cachedLabel) {
                registerGoogleDriveLabel(normalizedPath, cachedLabel);
                return cachedLabel;
            }
            const currentMeta = state.currentDirMeta || {};
            const currentPath = normalizePath(currentMeta.path || state.currentDir, true);
            const currentLabel = resolveGoogleDriveLabelFromMeta(currentMeta);
            if (currentLabel && currentPath === normalizedPath) {
                registerGoogleDriveLabel(currentPath, currentLabel);
                return currentLabel;
            }
            return "";
        }

        function applyGoogleDriveBreadcrumbLabels(crumbs) {
            if (!Array.isArray(crumbs)) {
                return [];
            }
            return crumbs.map(function (crumb) {
                const googleLabel = resolveGoogleDriveBreadcrumbLabel(crumb && crumb.path);
                if (!googleLabel) {
                    return crumb;
                }
                return Object.assign({}, crumb, { label: googleLabel });
            });
        }

        function applyVirtualBreadcrumbLabels(crumbs) {
            return applyGoogleDriveBreadcrumbLabels(applyGithubBreadcrumbLabels(crumbs));
        }

        function getPathLeafLabel(pathValue, fallbackValue) {
            const normalizedPath = normalizePath(pathValue || "", true);
            if (!normalizedPath) {
                return String(fallbackValue || effectiveRootLabel || "").trim();
            }
            const parts = normalizedPath.split("/").filter(Boolean);
            return decodeBreadcrumbLabel(parts[parts.length - 1] || fallbackValue || normalizedPath);
        }

        function buildSharedBreadcrumbItemsForPath(pathValue) {
            const normalizedPath = normalizePath(pathValue, true);
            const normalizedSharedRootPath = normalizePath(sharedRootPath, true);
            if (!hasSharedContext() || !normalizedSharedRootPath) {
                return null;
            }
            const effectivePath = normalizedPath && (
                normalizedPath === normalizedSharedRootPath ||
                normalizedPath.startsWith(normalizedSharedRootPath + "/")
            )
                ? normalizedPath
                : normalizedSharedRootPath;
            const rootParts = normalizedSharedRootPath.split("/").filter(Boolean);
            const rootLabel = rootParts.length ? rootParts[rootParts.length - 1] : normalizedSharedRootPath;
            const sharedBaseUrl = handriveRootUrl || "";
            const crumbs = [
                {
                    label: sharedOwnerUsername,
                    path: normalizedSharedRootPath,
                    url: sharedBaseUrl,
                    isCurrent: false,
                },
                {
                    label: rootLabel,
                    path: normalizedSharedRootPath,
                    url: sharedBaseUrl,
                    isCurrent: effectivePath === normalizedSharedRootPath,
                },
            ];
            if (effectivePath === normalizedSharedRootPath) {
                return crumbs;
            }
            const childPath = effectivePath.slice(normalizedSharedRootPath.length + 1);
            const childParts = childPath.split("/").filter(Boolean);
            childParts.forEach(function (part, index) {
                const relativeChildPath = childParts.slice(0, index + 1).join("/");
                crumbs.push({
                    label: decodeBreadcrumbLabel(part),
                    path: normalizedSharedRootPath + "/" + relativeChildPath,
                    url: sharedBaseUrl.replace(/\/$/, "") + "/" + encodePathSegments(relativeChildPath),
                    isCurrent: index === childParts.length - 1,
                });
            });
            return crumbs;
        }

        function getArchiveVirtualRootPath(meta) {
            const safeMeta = meta || {};
            const metaPath = normalizePath(safeMeta.path || state.currentDir, true);
            const memberPath = normalizePath(safeMeta.archive_member_path || "", true);
            if (metaPath && memberPath && metaPath.endsWith("/" + memberPath)) {
                return metaPath.slice(0, metaPath.length - memberPath.length - 1);
            }
            return metaPath;
        }

        function resolveArchiveMemberPathForDisplayPath(pathValue, meta) {
            const safeMeta = meta || {};
            const normalizedPath = normalizePath(pathValue, true);
            const metaPath = normalizePath(safeMeta.path || state.currentDir, true);
            const rootPath = getArchiveVirtualRootPath(safeMeta);
            const metaMemberPath = normalizePath(safeMeta.archive_member_path || "", true);
            if (normalizedPath === rootPath) {
                return "";
            }
            if (rootPath && normalizedPath.startsWith(rootPath + "/")) {
                return normalizePath(normalizedPath.slice(rootPath.length + 1), true);
            }
            if (normalizedPath === metaPath) {
                return metaMemberPath;
            }
            if (metaPath && normalizedPath.startsWith(metaPath + "/")) {
                const childPath = normalizedPath.slice(metaPath.length + 1);
                return normalizePath(metaMemberPath ? metaMemberPath + "/" + childPath : childPath, true);
            }
            return metaMemberPath;
        }

        function buildArchiveBreadcrumbItems(pathValue) {
            const currentMeta = getCurrentDirMeta();
            if (!currentMeta || !currentMeta.is_archive_virtual || !currentMeta.archive_path) {
                return null;
            }
            const archivePath = normalizePath(currentMeta.archive_path, true);
            const archiveRootPath = getArchiveVirtualRootPath(currentMeta);
            if (!archivePath || !archiveRootPath) {
                return null;
            }
            const memberPath = resolveArchiveMemberPathForDisplayPath(pathValue, currentMeta);
            const baseCrumbs = buildSharedBreadcrumbItemsForPath(archivePath) || buildNavigationBreadcrumbItems(archivePath, {
                effectiveRootLabel: effectiveRootLabel,
                isSuperuser: isSuperuser,
                normalizePath: normalizePath,
                scopedHomeDir: scopedHomeDir,
            });
            const crumbs = (Array.isArray(baseCrumbs) ? baseCrumbs : []).map(function (crumb) {
                return Object.assign({}, crumb, { isCurrent: false });
            });
            const archiveLabel = getPathLeafLabel(archivePath, "archive.zip");
            if (crumbs.length) {
                crumbs[crumbs.length - 1] = Object.assign({}, crumbs[crumbs.length - 1], {
                    label: archiveLabel,
                    path: archiveRootPath,
                    url: buildListUrl(handriveBaseUrl, archiveRootPath, handriveRootUrl),
                    isCurrent: !memberPath,
                });
            } else {
                crumbs.push({
                    label: archiveLabel,
                    path: archiveRootPath,
                    url: buildListUrl(handriveBaseUrl, archiveRootPath, handriveRootUrl),
                    isCurrent: !memberPath,
                });
            }
            if (!memberPath) {
                return crumbs;
            }
            const memberParts = memberPath.split("/").filter(Boolean);
            memberParts.forEach(function (part, index) {
                const accumulated = memberParts.slice(0, index + 1).join("/");
                const crumbPath = archiveRootPath + "/" + accumulated;
                crumbs.push({
                    label: decodeBreadcrumbLabel(part),
                    path: crumbPath,
                    url: buildListUrl(handriveBaseUrl, crumbPath, handriveRootUrl),
                    isCurrent: index === memberParts.length - 1,
                });
            });
            return crumbs;
        }

        function makeReadableUrlSegment(value, fallback) {
            return String(value || fallback || "item").trim().replace(/[\\/]/g, "-") || String(fallback || "item");
        }

        function makeReadableUrlIdSegment(label, idValue, fallback) {
            const labelText = makeReadableUrlSegment(label, fallback);
            const idText = String(idValue || "").trim();
            return idText ? labelText + "~" + idText : labelText;
        }

        function resolveGithubRepoUrlMetaFromGitRepo(gitRepo) {
            if (!gitRepo || gitRepo.provider !== "github") {
                return null;
            }
            const fullName = String(gitRepo.full_name || "").trim();
            const fullNameParts = fullName.split("/");
            const owner = String(gitRepo.owner_username || gitRepo.owner || fullNameParts[0] || "").trim();
            const name = String(gitRepo.repo_name || gitRepo.name || fullNameParts[1] || fullName || "").trim();
            if (!owner || !name) {
                return null;
            }
            return {
                id: resolveGithubRepoIdFromGitRepo(gitRepo),
                owner: owner,
                name: name,
            };
        }

        function resolveGithubRepoUrlMetaFromEntry(entry) {
            if (!entry) {
                return null;
            }
            if (entry.github_repo) {
                return {
                    id: normalizeGithubRepoId(entry.github_repo.id),
                    owner: String(entry.github_repo.owner || "").trim(),
                    name: String(entry.github_repo.name || entry.name || "").trim(),
                };
            }
            return resolveGithubRepoUrlMetaFromGitRepo(entry.git_repo);
        }

        function resolveGithubRepoUrlMeta(pathValue) {
            const normalizedPath = normalizePath(pathValue, true);
            const repoId = resolveGithubRepoIdFromVirtualPath(normalizedPath);
            const entry = state.entryByPath.get(normalizedPath);
            const entryMeta = resolveGithubRepoUrlMetaFromEntry(entry);
            if (entryMeta && entryMeta.owner && entryMeta.name) {
                return entryMeta;
            }
            const cachedMeta = state.directoryMetaCache.get(normalizedPath);
            const cachedUrlMeta = resolveGithubRepoUrlMetaFromGitRepo(cachedMeta && cachedMeta.git_repo);
            if (cachedUrlMeta) {
                return cachedUrlMeta;
            }
            const currentMeta = state.currentDirMeta || {};
            const currentRepoRootPath = resolveGithubVirtualRootPath(currentMeta.path || state.currentDir);
            const currentUrlMeta = resolveGithubRepoUrlMetaFromGitRepo(currentMeta.git_repo);
            if (currentUrlMeta && currentRepoRootPath && normalizedPath === currentRepoRootPath) {
                return currentUrlMeta;
            }
            if (repoId) {
                const label = githubRepoLabelById.get(repoId);
                if (label) {
                    return { id: repoId, owner: "github", name: label };
                }
            }
            return null;
        }

        function resolveGoogleDriveRootPath(pathValue) {
            const normalizedPath = normalizePath(pathValue, true);
            const parts = normalizedPath.split("/").filter(Boolean);
            const rootIndex = parts.findIndex(function (part) {
                return /^\.google-drive-\d+$/.test(part);
            });
            return rootIndex < 0 ? "" : parts.slice(0, rootIndex + 1).join("/");
        }

        function resolveGoogleDriveMappingIdFromRoot(rootPath) {
            const rootPart = String(rootPath || "").split("/").filter(Boolean).slice(-1)[0] || "";
            const match = /^\.google-drive-(\d+)$/.exec(rootPart);
            return match ? match[1] : "";
        }

        function toReadableVirtualUrlPath(pathValue) {
            const normalizedPath = normalizePath(pathValue, true);
            if (!normalizedPath) {
                return normalizedPath;
            }
            const parts = normalizedPath.split("/").filter(Boolean);
            const githubRootPath = resolveGithubVirtualRootPath(normalizedPath);
            if (githubRootPath) {
                const rootParts = githubRootPath.split("/").filter(Boolean);
                const repoMeta = resolveGithubRepoUrlMeta(githubRootPath);
                if (repoMeta && repoMeta.owner && repoMeta.name) {
                    const tailParts = parts.slice(rootParts.length);
                    if (tailParts.length) {
                        const branchLabel = decodeBreadcrumbLabel(tailParts[0]);
                        if (branchLabel && branchLabel.indexOf("/") < 0) {
                            tailParts[0] = branchLabel;
                        }
                    }
                    return rootParts.slice(0, -1).concat([
                        "github",
                        makeReadableUrlSegment(repoMeta.owner, "owner"),
                        makeReadableUrlSegment(repoMeta.name, "repo"),
                    ], tailParts).join("/");
                }
            }

            const googleRootPath = resolveGoogleDriveRootPath(normalizedPath);
            if (googleRootPath) {
                const rootParts = googleRootPath.split("/").filter(Boolean);
                const mappingId = resolveGoogleDriveMappingIdFromRoot(googleRootPath);
                const rootLabel = resolveGoogleDriveBreadcrumbLabel(googleRootPath) || "Google Drive";
                const publicParts = rootParts.slice(0, -1).concat([
                    "google-drive",
                    makeReadableUrlIdSegment(rootLabel, mappingId, "Google Drive"),
                ]);
                const tailParts = parts.slice(rootParts.length);
                let accumulatedPath = googleRootPath;
                tailParts.forEach(function (part) {
                    const idValue = decodeBreadcrumbLabel(part);
                    accumulatedPath += "/" + part;
                    const label = resolveGoogleDriveBreadcrumbLabel(accumulatedPath) || idValue || "file";
                    publicParts.push(makeReadableUrlIdSegment(label, idValue, "file"));
                });
                return publicParts.join("/");
            }
            return normalizedPath;
        }

        window.HandriveUrlPathResolver = {
            toUrlPath: toReadableVirtualUrlPath,
        };

        registerGithubRepoLabelsFromEntries(initialEntries);
        registerGithubRepoLabelFromMeta(state.currentDirMeta);
        registerGoogleDriveLabelsFromEntries(initialEntries);
        registerGoogleDriveLabelFromMeta(state.currentDirMeta);

        let activeListEditorSuggestions = [];
        let activeListEditorSuggestionIndex = -1;
        let activeListEditorEntry = null;
        let listSuggestEventsBound = false;
        let listMarkdownSnippetEventsBound = false;
        let listMarkdownImageEventsBound = false;
        let listMarkdownUploadedImagePaths = [];
        const listMarkdownImageInput = createMarkdownImageInputHandler({
            textarea: editorContentInput,
            uploadApiUrl: markdownImageUploadApiUrl,
            isEnabled: function () {
                return Boolean(activeListEditorEntry && resolveListEditorExtension() === ".md");
            },
            getMarkdownPath: function () {
                return activeListEditorEntry && activeListEditorEntry.path ? activeListEditorEntry.path : "";
            },
            getMarkdownName: function () {
                return editorFilenameInput ? editorFilenameInput.value : "";
            },
            getTargetDir: function () {
                const pathValue = activeListEditorEntry && activeListEditorEntry.path ? activeListEditorEntry.path : state.currentDir;
                return getParentPath(pathValue) || state.currentDir || "";
            },
            onAfterInsert: function (data) {
                if (data && data.path) {
                    listMarkdownUploadedImagePaths.push(data.path);
                }
                renderListEditorHighlight();
            }
        });

        function resolveListEditorExtension() {
            const entryPath = activeListEditorEntry && activeListEditorEntry.path
                ? String(activeListEditorEntry.path)
                : "";
            const entryMatch = entryPath.match(/\.[A-Za-z0-9]+$/);
            if (entryMatch) {
                return entryMatch[0].toLowerCase();
            }

            const raw = (editorFilenameInput && editorFilenameInput.value ? editorFilenameInput.value : "").trim();
            const match = raw.match(/\.[A-Za-z0-9]+$/);
            return match ? match[0].toLowerCase() : "";
        }

        function clearListEditorSuggestion() {
            activeListEditorSuggestions = [];
            activeListEditorSuggestionIndex = -1;
            if (editorSuggest) {
                editorSuggest.hidden = true;
                editorSuggest.style.left = "";
                editorSuggest.style.top = "";
                editorSuggest.innerHTML = "";
            }
            if (editorSuggestLabel) {
                editorSuggestLabel.textContent = "";
            }
        }

        function closeListMarkdownSnippetMenu() {
            if (!markdownSnippetMenu) {
                return;
            }
            markdownSnippetMenu.hidden = true;
        }

        function openListMarkdownSnippetMenu(clientX, clientY) {
            if (!markdownSnippetMenu) {
                return;
            }
            markdownSnippetMenu.hidden = false;
            markdownSnippetMenu.style.left = "0px";
            markdownSnippetMenu.style.top = "0px";

            const rect = markdownSnippetMenu.getBoundingClientRect();
            const viewportPadding = 8;
            const maxLeft = Math.max(viewportPadding, window.innerWidth - rect.width - viewportPadding);
            const maxTop = Math.max(viewportPadding, window.innerHeight - rect.height - viewportPadding);
            const left = Math.min(Math.max(viewportPadding, clientX), maxLeft);
            const top = Math.min(Math.max(viewportPadding, clientY), maxTop);

            markdownSnippetMenu.style.left = String(left) + "px";
            markdownSnippetMenu.style.top = String(top) + "px";
        }

        function syncListSnippetMenuItemsByExtension(extension) {
            if (!markdownSnippetMenu) {
                return 0;
            }
            const currentExtension = String(extension || "").trim().toLowerCase();
            let visibleCount = 0;
            markdownSnippetButtons.forEach(function (button) {
                const rawExtensions = String(button.getAttribute("data-editor-extensions") || "").trim();
                if (!rawExtensions) {
                    button.hidden = false;
                    visibleCount += 1;
                    return;
                }
                const allowed = rawExtensions
                    .split(",")
                    .map(function (value) { return String(value || "").trim().toLowerCase(); })
                    .filter(Boolean);
                const visible = allowed.includes(currentExtension);
                button.hidden = !visible;
                if (visible) {
                    visibleCount += 1;
                }
            });
            return visibleCount;
        }

        function replaceListEditorSelection(insertText, selectionStartOffset, selectionEndOffset, replaceStartOffset, replaceEndOffset) {
            if (!editorContentInput) {
                return;
            }
            const valueLength = String(editorContentInput.value || "").length;
            const selectedStart = editorContentInput.selectionStart || 0;
            const selectedEnd = editorContentInput.selectionEnd || 0;
            const start = Number.isFinite(Number(replaceStartOffset))
                ? clampMarkdownIndex(editorContentInput.value, replaceStartOffset)
                : clampMarkdownIndex(editorContentInput.value, selectedStart);
            const end = Number.isFinite(Number(replaceEndOffset))
                ? clampMarkdownIndex(editorContentInput.value, replaceEndOffset)
                : clampMarkdownIndex(editorContentInput.value, selectedEnd);
            const replaceStart = Math.min(start, end, valueLength);
            const replaceEnd = Math.max(start, end);
            editorContentInput.setRangeText(insertText, replaceStart, replaceEnd, "end");

            const nextStart = replaceStart + (selectionStartOffset || 0);
            const nextEnd = replaceStart + (selectionEndOffset || insertText.length);
            editorContentInput.setSelectionRange(nextStart, nextEnd);
            editorContentInput.focus();
            editorContentInput.dispatchEvent(new Event("input", { bubbles: true }));
        }

        function buildListWrappedSnippet(prefix, suffix, placeholder) {
            const selection = getMarkdownSnippetSelection(editorContentInput);
            const selected = selection.body;
            const body = selected || placeholder;
            const text = prefix + body + suffix;

            if (selected) {
                return {
                    text: text,
                    selectStart: text.length,
                    selectEnd: text.length,
                    replaceStart: selection.replaceStart,
                    replaceEnd: selection.replaceEnd,
                };
            }
            return {
                text: text,
                selectStart: prefix.length,
                selectEnd: prefix.length + body.length,
                replaceStart: selection.replaceStart,
                replaceEnd: selection.replaceEnd,
            };
        }

        function buildListPrefixedLinesSnippet(prefix, placeholder) {
            const selection = getMarkdownSnippetSelection(editorContentInput);
            const selected = selection.body;
            if (!selected) {
                const body = prefix + placeholder;
                return {
                    text: body,
                    selectStart: prefix.length,
                    selectEnd: body.length,
                    replaceStart: selection.replaceStart,
                    replaceEnd: selection.replaceEnd,
                };
            }
            const lines = selected.split(/\r?\n/);
            const transformed = lines.map(function (line) {
                if (!line.trim()) {
                    return line;
                }
                return prefix + line;
            }).join("\n");
            return {
                text: transformed,
                selectStart: transformed.length,
                selectEnd: transformed.length,
                replaceStart: selection.replaceStart,
                replaceEnd: selection.replaceEnd,
            };
        }

        function buildListNumberedLinesSnippet(placeholder) {
            const selection = getMarkdownSnippetSelection(editorContentInput);
            const selected = selection.body;
            if (!selected) {
                const body = "1. " + placeholder;
                return {
                    text: body,
                    selectStart: 3,
                    selectEnd: body.length,
                    replaceStart: selection.replaceStart,
                    replaceEnd: selection.replaceEnd,
                };
            }
            let order = 1;
            const transformed = selected
                .split(/\r?\n/)
                .map(function (line) {
                    if (!line.trim()) {
                        return line;
                    }
                    const row = String(order) + ". " + line;
                    order += 1;
                    return row;
                })
                .join("\n");
            return {
                text: transformed,
                selectStart: transformed.length,
                selectEnd: transformed.length,
                replaceStart: selection.replaceStart,
                replaceEnd: selection.replaceEnd,
            };
        }

        function buildListCodeBlockSnippet() {
            const selection = getMarkdownSnippetSelection(editorContentInput);
            const lang = t("markdown_placeholder_code_lang", "text");
            const body = selection.body || t("markdown_placeholder_code_body", "type your code");
            const text = "```" + lang + "\n" + body + "\n```";
            const bodyStart = ("```" + lang + "\n").length;
            if (selection.body) {
                return {
                    text: text,
                    selectStart: text.length,
                    selectEnd: text.length,
                    replaceStart: selection.replaceStart,
                    replaceEnd: selection.replaceEnd,
                };
            }
            return {
                text: text,
                selectStart: bodyStart,
                selectEnd: bodyStart + body.length,
                replaceStart: selection.replaceStart,
                replaceEnd: selection.replaceEnd,
            };
        }

        function buildListTableSnippet() {
            const selection = getMarkdownSnippetSelection(editorContentInput);
            const delimitedTable = buildMarkdownTableFromDelimitedText(selection.body);
            if (delimitedTable) {
                return {
                    text: delimitedTable,
                    selectStart: delimitedTable.length,
                    selectEnd: delimitedTable.length,
                    replaceStart: selection.replaceStart,
                    replaceEnd: selection.replaceEnd,
                };
            }

            const col1 = t("markdown_placeholder_table_col1", "Column 1");
            const col2 = t("markdown_placeholder_table_col2", "Column 2");
            const table = [
                "| " + col1 + " | " + col2 + " |",
                "| --- | --- |",
                "| Value 1 | Value 2 |",
            ].join("\n");
            return {
                text: table,
                selectStart: 2,
                selectEnd: 2 + col1.length,
                replaceStart: selection.replaceStart,
                replaceEnd: selection.replaceEnd,
            };
        }

        function insertListMarkdownSnippet(snippetType) {
            if (!editorContentInput) {
                return;
            }
            let snippet = null;
            if (snippetType === "heading2") {
                snippet = buildListWrappedSnippet("## ", "", t("markdown_placeholder_heading", "Heading"));
            } else if (snippetType === "heading3") {
                snippet = buildListWrappedSnippet("### ", "", t("markdown_placeholder_heading", "Heading"));
            } else if (snippetType === "bold") {
                snippet = buildListWrappedSnippet("**", "**", t("markdown_placeholder_bold", "bold text"));
            } else if (snippetType === "italic") {
                snippet = buildListWrappedSnippet("*", "*", t("markdown_placeholder_italic", "italic text"));
            } else if (snippetType === "link") {
                snippet = buildListWrappedSnippet("[", "](https://)", t("markdown_placeholder_link_text", "link text"));
            } else if (snippetType === "image") {
                snippet = buildListWrappedSnippet("![", "](https://)", t("markdown_placeholder_image_alt", "image description"));
            } else if (snippetType === "code_inline") {
                snippet = buildListWrappedSnippet("`", "`", t("markdown_placeholder_inline_code", "code"));
            } else if (snippetType === "code_block") {
                snippet = buildListCodeBlockSnippet();
            } else if (snippetType === "list_bullet") {
                snippet = buildListPrefixedLinesSnippet("- ", t("markdown_placeholder_list_item", "item"));
            } else if (snippetType === "list_numbered") {
                snippet = buildListNumberedLinesSnippet(t("markdown_placeholder_list_item", "item"));
            } else if (snippetType === "list_check") {
                snippet = buildListPrefixedLinesSnippet("- [ ] ", t("markdown_placeholder_list_item", "item"));
            } else if (snippetType === "quote") {
                snippet = buildListPrefixedLinesSnippet("> ", t("markdown_placeholder_quote", "quote"));
            } else if (snippetType === "divider") {
                const selection = getMarkdownSnippetSelection(editorContentInput);
                snippet = {
                    text: "\n---\n",
                    selectStart: 5,
                    selectEnd: 5,
                    replaceStart: selection.replaceStart,
                    replaceEnd: selection.replaceEnd,
                };
            } else if (snippetType === "table") {
                snippet = buildListTableSnippet();
            }
            if (!snippet) {
                return;
            }
            replaceListEditorSelection(snippet.text, snippet.selectStart, snippet.selectEnd, snippet.replaceStart, snippet.replaceEnd);
        }

        function findListEditorSuggestions(extension, tokenText) {
            const items = resolveEditorCompletionItemsByExtension(extension);
            return findEditorCompletionItems(items, tokenText, 8);
        }

        function renderListEditorSuggestDropdown() {
            if (!editorSuggest) {
                return;
            }
            editorSuggest.innerHTML = "";

            const list = document.createElement("div");
            list.className = "handrive-editor-suggest-list";

            for (let i = 0; i < activeListEditorSuggestions.length; i += 1) {
                const item = activeListEditorSuggestions[i] || {};
                const option = document.createElement("button");
                option.type = "button";
                option.className = "handrive-editor-suggest-item" + (i === activeListEditorSuggestionIndex ? " is-active" : "");
                option.setAttribute("data-suggest-index", String(i));

                const labelNode = document.createElement("span");
                labelNode.className = "handrive-editor-suggest-item-label";
                labelNode.textContent = item.label || item.insertText || "";

                const triggerNode = document.createElement("span");
                triggerNode.className = "handrive-editor-suggest-item-trigger";
                triggerNode.textContent = item.trigger || "";

                option.appendChild(labelNode);
                option.appendChild(triggerNode);
                list.appendChild(option);
            }

            const footer = document.createElement("div");
            footer.className = "handrive-editor-suggest-footer";
            footer.textContent = "↑↓ 이동 · Enter/Tab 적용";

            editorSuggest.appendChild(list);
            editorSuggest.appendChild(footer);
        }

        function moveListEditorSuggestion(step) {
            if (!activeListEditorSuggestions.length) {
                return;
            }
            const count = activeListEditorSuggestions.length;
            activeListEditorSuggestionIndex = (activeListEditorSuggestionIndex + step + count) % count;
            renderListEditorSuggestDropdown();
        }

        function syncListEditorHighlightScroll() {
            if (!editorContentInput || !editorHighlight) {
                return;
            }
            syncEditorMirrorScroll(editorContentInput, editorHighlight, editorHighlightCode);
        }

        function resetListEditorHorizontalScroll() {
            try { document.documentElement.scrollLeft = 0; } catch (error) {}
            try { document.body.scrollLeft = 0; } catch (error) {}
            try {
                if (document.scrollingElement) {
                    document.scrollingElement.scrollLeft = 0;
                }
            } catch (error) {}
            try { window.scrollTo(0, window.scrollY || window.pageYOffset || 0); } catch (error) {}
            [
                editorPanel,
                editorBody,
                editorSurface,
                editorContentInput,
                editorHighlight,
                imageEditorSurface,
                videoEditorSurface,
                audioEditorSurface,
                spreadsheetEditorSurface,
            ].forEach(function (element) {
                if (element && typeof element.scrollLeft === "number") {
                    element.scrollLeft = 0;
                }
            });
            if (editorPanel && typeof editorPanel.querySelectorAll === "function") {
                editorPanel
                    .querySelectorAll(".ie-canvas-area, .ve-body, .ae-body")
                    .forEach(function (element) {
                        element.scrollLeft = 0;
                    });
            }
            if (editorContentInput && editorHighlight) {
                syncEditorMirrorScroll(editorContentInput, editorHighlight, editorHighlightCode);
            }
        }

        function scheduleListEditorHorizontalScrollReset() {
            resetListEditorHorizontalScroll();
            window.requestAnimationFrame(function () {
                resetListEditorHorizontalScroll();
                window.requestAnimationFrame(resetListEditorHorizontalScroll);
            });
            window.setTimeout(resetListEditorHorizontalScroll, 80);
            window.setTimeout(resetListEditorHorizontalScroll, 240);
        }

        function renderListEditorHighlight() {
            if (!editorContentInput || !editorHighlight || !editorHighlightCode) {
                return;
            }

            const extension = resolveListEditorExtension();
            const source = editorContentInput.value || "";
            let renderClass = "handrive-plain-text";
            let highlightedHtml = escapeHtml(source);

            if (extension === ".js") {
                renderClass = "handrive-js";
                highlightedHtml = highlightJavaScriptCode(source);
            } else if (extension === ".md") {
                renderClass = "handrive-editor-md";
                highlightedHtml = escapeHtml(source);
            } else if (extension === ".css") {
                renderClass = "handrive-css";
                highlightedHtml = highlightCssCode(source);
            } else if (extension === ".json") {
                renderClass = "handrive-json";
                highlightedHtml = highlightJsonCode(source);
            } else if (extension === ".py") {
                renderClass = "handrive-py";
                highlightedHtml = highlightPythonCode(source);
            } else if (extension === ".html") {
                renderClass = "handrive-editor-html";
                highlightedHtml = highlightHtmlCode(source);
            }

            editorHighlight.classList.remove(
                "handrive-plain-text",
                "handrive-editor-md",
                "handrive-js",
                "handrive-css",
                "handrive-json",
                "handrive-py",
                "handrive-editor-html"
            );
            editorHighlight.classList.add(renderClass);
            editorHighlightCode.innerHTML = highlightedHtml + (source.endsWith("\n") ? "\u200b" : "");
            syncListEditorHighlightScroll();
        }

        function updateListEditorSuggestion() {
            if (!editorContentInput || !editorSuggest) {
                return;
            }

            const start = editorContentInput.selectionStart || 0;
            const end = editorContentInput.selectionEnd || 0;
            if (start !== end) {
                clearListEditorSuggestion();
                return;
            }

            const extension = resolveListEditorExtension();
            const tokenInfo = extractEditorCompletionToken(editorContentInput.value || "", start);
            if (!tokenInfo) {
                clearListEditorSuggestion();
                return;
            }

            const suggestions = findListEditorSuggestions(extension, tokenInfo.token);
            if (!suggestions.length) {
                clearListEditorSuggestion();
                return;
            }

            activeListEditorSuggestions = suggestions.map(function (suggestion) {
                return {
                    start: tokenInfo.start,
                    end: tokenInfo.end,
                    insertText: suggestion.insertText,
                    cursorBack: Number(suggestion.cursorBack || 0),
                    label: suggestion.label || suggestion.insertText,
                    trigger: suggestion.trigger || "",
                };
            });
            activeListEditorSuggestionIndex = 0;
            renderListEditorSuggestDropdown();
            editorSuggest.hidden = false;

            const calc = window.__handriveCalculateCursorPosition;
            const cursorPosition = typeof calc === "function" ? calc(editorContentInput, start) : null;
            if (cursorPosition) {
                const surfaceRect = editorSurface ? editorSurface.getBoundingClientRect() : null;

                let left = cursorPosition.left + 12;
                let top = cursorPosition.top + (cursorPosition.lineHeight || 20) + 6;

                if (surfaceRect) {
                    left = (cursorPosition.left + 12) - surfaceRect.left;
                    top = (cursorPosition.top + (cursorPosition.lineHeight || 20) + 6) - surfaceRect.top;
                }

                const suggestRect = editorSuggest.getBoundingClientRect();
                if (surfaceRect) {
                    const minLeft = 8;
                    const minTop = 8;
                    const maxLeft = Math.max(minLeft, surfaceRect.width - suggestRect.width - 8);
                    const maxTop = Math.max(minTop, surfaceRect.height - suggestRect.height - 8);
                    left = Math.min(Math.max(minLeft, left), maxLeft);
                    top = Math.min(Math.max(minTop, top), maxTop);
                }

                editorSuggest.style.left = String(left) + "px";
                editorSuggest.style.top = String(top) + "px";
            }
        }

        function acceptListEditorSuggestion(index) {
            if (!editorContentInput) {
                return false;
            }
            const resolvedIndex = Number.isInteger(index) ? index : activeListEditorSuggestionIndex;
            const suggestion = activeListEditorSuggestions[resolvedIndex] || null;
            if (!suggestion) {
                return false;
            }
            editorContentInput.setRangeText(suggestion.insertText, suggestion.start, suggestion.end, "end");
            const cursorPos = (suggestion.start + suggestion.insertText.length) - Math.max(0, suggestion.cursorBack);
            editorContentInput.setSelectionRange(cursorPos, cursorPos);
            editorContentInput.focus();
            editorContentInput.dispatchEvent(new Event("input", { bubbles: true }));
            clearListEditorSuggestion();
            return true;
        }

        state.directoryCache.set(state.currentDir, initialEntries);

        function closeContextMenu() {
            if (!contextMenu) {
                return;
            }
            resetUploadQueueContextMenuState();
            contextMenu.hidden = true;
            state.contextTarget = null;
            state.contextEntries = [];
        }

        function resetUploadQueueContextMenuState() {
            state.uploadQueueContextItem = null;
            if (contextOpenButton) {
                contextOpenButton.textContent = defaultContextButtonLabels.open;
            }
            if (contextDeleteButton) {
                contextDeleteButton.textContent = defaultContextButtonLabels.delete;
            }
        }

        function setContextButtonVisible(button, visible) {
            if (!button) {
                return;
            }
            button.style.display = visible ? "" : "none";
        }

        function isEntryDeletable(entry) {
            if (!entry) {
                return false;
            }
            if (entry.type === "dir" && entry.git_repo) {
                return false;
            }
            if (entry.isCurrentFolder && !entry.can_delete) {
                return false;
            }
            if (!entry.can_edit && !entry.can_delete) {
                return false;
            }
            return !(entry.type === "file" && entry.is_public_write);
        }

        function clampHandriveListItemScale(value) {
            const numericValue = Number(value);
            if (!Number.isFinite(numericValue)) {
                return 1;
            }
            return Math.max(
                HANDRIVE_LIST_ITEM_SCALE_MIN,
                Math.min(HANDRIVE_LIST_ITEM_SCALE_MAX, numericValue)
            );
        }

        function readStoredHandriveListItemScale() {
            try {
                if (!window.localStorage) {
                    return 1;
                }
                const rawValue = window.localStorage.getItem(HANDRIVE_LIST_ITEM_SCALE_STORAGE_KEY);
                if (rawValue === null || rawValue === "") {
                    return 1;
                }
                return clampHandriveListItemScale(rawValue);
            } catch (error) {
                return 1;
            }
        }

        function writeStoredHandriveListItemScale(value) {
            try {
                if (!window.localStorage) {
                    return;
                }
                const normalizedValue = clampHandriveListItemScale(value);
                if (Math.abs(normalizedValue - 1) < 0.001) {
                    window.localStorage.removeItem(HANDRIVE_LIST_ITEM_SCALE_STORAGE_KEY);
                    return;
                }
                window.localStorage.setItem(HANDRIVE_LIST_ITEM_SCALE_STORAGE_KEY, normalizedValue.toFixed(3));
            } catch (error) {}
        }

        function applyHandriveListItemScale(value, options) {
            const settings = options || {};
            const normalizedValue = clampHandriveListItemScale(value);
            handriveListItemScale = normalizedValue;
            if (listItemsContainer) {
                listItemsContainer.style.setProperty("--handrive-list-item-scale", normalizedValue.toFixed(3));
                listItemsContainer.setAttribute("data-list-item-scale", normalizedValue.toFixed(2));
            }
            if (!settings.skipPersist) {
                writeStoredHandriveListItemScale(normalizedValue);
            }
            if (!settings.skipLayout) {
                scheduleListColumnVisibilityUpdate({ afterLayout: true, delayMs: 80 });
                scheduleListBodyHeight();
            }
        }

        function handleHandriveListItemsScaleWheel(event) {
            if (!listItemsContainer || !(event.ctrlKey || event.metaKey) || event.altKey) {
                return;
            }
            if (!(event.target instanceof Element) || !listItemsContainer.contains(event.target)) {
                return;
            }
            if (event.deltaY === 0) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const direction = event.deltaY < 0 ? 1 : -1;
            applyHandriveListItemScale(
                handriveListItemScale + (direction * HANDRIVE_LIST_ITEM_SCALE_STEP)
            );
        }

        function getSelectedEntries() {
            return state.visibleEntryPaths
                .filter(function (pathValue) {
                    return state.selectedPaths.has(pathValue);
                })
                .map(function (pathValue) {
                    return state.entryByPath.get(pathValue) || null;
                })
                .filter(function (entry) {
                    return Boolean(entry);
                });
        }

        function isKeyboardEditableTarget(target) {
            if (!(target instanceof Element)) {
                return false;
            }
            const tagName = String(target.tagName || "").toLowerCase();
            if (tagName === "input" || tagName === "textarea" || tagName === "select") {
                return true;
            }
            return Boolean(target.isContentEditable);
        }

        function updateListLayoutMode() {
            if (!listLayout) {
                return;
            }
            // 강제로 리플로우 트리거
            void listLayout.offsetWidth;

            const isLandscape = window.innerWidth > window.innerHeight;
            listLayout.classList.toggle("is-landscape", isLandscape);
            listLayout.classList.toggle("is-portrait", !isLandscape);

            // 레이아웃 변경 후 동기화
            setTimeout(function() {
                scheduleSyncCurrentDirRowHeightWithSideHead();
                scheduleListBodyHeight();
                schedulePreviewBodyHeight();
                scheduleEditorBodyHeight();
                updateListColumnVisibility();
                syncSearchFormVisibility();
            }, 10);
        }

        function updateListColumnVisibility() {
            if (!listPane) {
                scheduleSyncCurrentDirRowHeightWithSideHead();
                scheduleListBodyHeight();
                return;
            }

            const metaColumnMap = [
                { selector: ".handrive-item-modified", cssVarName: "--handrive-list-col-modified", hideClass: "is-hide-modified" },
                { selector: ".handrive-item-type", cssVarName: "--handrive-list-col-type", hideClass: "is-hide-type" },
                { selector: ".handrive-item-size", cssVarName: "--handrive-list-col-size", hideClass: "is-hide-size" },
                { selector: ".handrive-item-commit", cssVarName: "--handrive-list-col-commit", hideClass: "is-hide-commit" },
                { selector: ".handrive-item-id", cssVarName: "--handrive-list-col-id", hideClass: "is-hide-id" },
            ];
            const metaHideClasses = metaColumnMap.map(function (column) { return column.hideClass; });
            const responsiveHideClasses = ["is-hide-id", "is-hide-commit", "is-hide-size", "is-hide-type", "is-hide-modified"];

            const isVisibleMetaRow = function (row) {
                return Boolean(
                    row &&
                    !row.classList.contains("handrive-current-dir-row") &&
                    !row.classList.contains("is-empty") &&
                    !row.closest("[hidden]") &&
                    row.offsetParent !== null &&
                    row.getClientRects().length > 0
                );
            };

            const getRegularItemRows = function () {
                return Array.from(listPane.querySelectorAll(".handrive-item-row")).filter(isVisibleMetaRow);
            };

            const getColumnText = function (element) {
                return String(element && element.textContent || "").trim();
            };

            const hasRegularItemColumnText = function (column) {
                const rows = getRegularItemRows();
                for (let index = 0; index < rows.length; index += 1) {
                    if (getColumnText(rows[index].querySelector(column.selector))) {
                        return true;
                    }
                }
                return false;
            };

            const syncSharedMetaColumnWidths = function () {
                const maxWidthByVarName = {};
                const rowsForWidth = getRegularItemRows();
                const currentDirRow = listPane.querySelector(".handrive-current-dir-row");
                const measureWrap = document.createElement("span");
                measureWrap.setAttribute("aria-hidden", "true");
                measureWrap.style.position = "fixed";
                measureWrap.style.left = "-10000px";
                measureWrap.style.top = "-10000px";
                measureWrap.style.visibility = "hidden";
                measureWrap.style.whiteSpace = "nowrap";
                measureWrap.style.width = "auto";
                measureWrap.style.minWidth = "0";
                measureWrap.style.maxWidth = "none";
                measureWrap.style.overflow = "visible";
                measureWrap.style.textOverflow = "clip";
                measureWrap.style.display = "inline-block";
                document.body.appendChild(measureWrap);

                const measureElementTextWidth = function (element) {
                    const text = getColumnText(element);
                    if (!text) {
                        return 0;
                    }
                    const style = window.getComputedStyle(element);
                    measureWrap.style.fontFamily = style.fontFamily;
                    measureWrap.style.fontSize = style.fontSize;
                    measureWrap.style.fontStyle = style.fontStyle;
                    measureWrap.style.fontWeight = style.fontWeight;
                    measureWrap.style.fontVariant = style.fontVariant;
                    measureWrap.style.letterSpacing = style.letterSpacing;
                    measureWrap.style.textTransform = style.textTransform;
                    measureWrap.textContent = text;
                    return Math.ceil(measureWrap.getBoundingClientRect().width || 0);
                };

                metaColumnMap.forEach(function (column) {
                    maxWidthByVarName[column.cssVarName] = 0;
                    const hasItemText = hasRegularItemColumnText(column);
                    if (!hasItemText) {
                        return;
                    }
                    const elements = rowsForWidth
                        .map(function (row) { return row.querySelector(column.selector); })
                        .filter(Boolean);
                    const headerElement = currentDirRow ? currentDirRow.querySelector(column.selector) : null;
                    if (headerElement) {
                        elements.push(headerElement);
                    }
                    elements.forEach(function (element) {
                        const measuredWidth = measureElementTextWidth(element);
                        if (measuredWidth > maxWidthByVarName[column.cssVarName]) {
                            maxWidthByVarName[column.cssVarName] = measuredWidth;
                        }
                    });
                });

                measureWrap.remove();

                Object.keys(maxWidthByVarName).forEach(function (cssVarName) {
                    const measuredWidth = maxWidthByVarName[cssVarName];
                    listPane.style.setProperty(cssVarName, measuredWidth > 0 ? (String(measuredWidth) + "px") : "0px");
                });
            };

            const hasTruncatedNameRow = function () {
                const rows = listPane.querySelectorAll(".handrive-item-row");
                for (let index = 0; index < rows.length; index += 1) {
                    const row = rows[index];
                    if (!row || row.offsetParent === null) {
                        continue;
                    }
                    const nameWrap = row.querySelector(".handrive-item-name-wrap");
                    const name = row.querySelector(".handrive-item-name");
                    if (nameWrap && (nameWrap.scrollWidth - nameWrap.clientWidth) > 1) {
                        return true;
                    }
                    if (name && (name.scrollWidth - name.clientWidth) > 1) {
                        return true;
                    }
                }
                return false;
            };

            listPane.classList.remove.apply(listPane.classList, metaHideClasses);

            metaColumnMap.forEach(function (column) {
                if (!hasRegularItemColumnText(column)) {
                    listPane.classList.add(column.hideClass);
                }
            });

            syncSharedMetaColumnWidths();

            responsiveHideClasses.forEach(function (className) {
                if (hasTruncatedNameRow()) {
                    listPane.classList.add(className);
                }
            });

            scheduleSyncCurrentDirRowHeightWithSideHead();
            scheduleListBodyHeight();
        }

        let listColumnVisibilityRafId = null;
        let listColumnVisibilityTimeoutId = null;
        function scheduleListColumnVisibilityUpdate(options) {
            const settings = options || {};
            if (listColumnVisibilityRafId === null) {
                listColumnVisibilityRafId = window.requestAnimationFrame(function () {
                    listColumnVisibilityRafId = null;
                    updateListColumnVisibility();
                });
            }
            if (!settings.afterLayout) {
                return;
            }
            if (listColumnVisibilityTimeoutId !== null) {
                window.clearTimeout(listColumnVisibilityTimeoutId);
            }
            listColumnVisibilityTimeoutId = window.setTimeout(function () {
                listColumnVisibilityTimeoutId = null;
                updateListColumnVisibility();
            }, Number.isFinite(settings.delayMs) ? settings.delayMs : 180);
        }

        function scheduleListColumnVisibilityAfterTreeToggle() {
            scheduleListColumnVisibilityUpdate({
                afterLayout: true,
                delayMs: 220,
            });
        }

        // 디바운싱된 레이아웃 업데이트 함수
        let layoutUpdateTimeout = null;
        function debouncedUpdateListLayoutMode() {
            if (layoutUpdateTimeout) {
                clearTimeout(layoutUpdateTimeout);
            }
            layoutUpdateTimeout = setTimeout(updateListLayoutMode, 50);
        }

        function getFooterReservedHeight() {
            const footerLinks = document.querySelector(".site-footer-links");
            if (!footerLinks || footerLinks.offsetParent === null) {
                return 0;
            }
            const footerRect = footerLinks.getBoundingClientRect();
            const footerStyle = window.getComputedStyle(footerLinks);
            const marginTop = parseFloat(footerStyle.marginTop) || 0;
            const marginBottom = parseFloat(footerStyle.marginBottom) || 0;
            return Math.max(0, footerRect.height + marginTop + marginBottom);
        }

        function getListSideBodyHeight(headElement) {
            if (!listLayout) {
                return 0;
            }
            const layoutHeight = listLayout.getBoundingClientRect().height;
            const layoutStyle = window.getComputedStyle(listLayout);
            const layoutBorderH = (parseFloat(layoutStyle.borderTopWidth) || 0) + (parseFloat(layoutStyle.borderBottomWidth) || 0);
            const headHeight = headElement ? headElement.getBoundingClientRect().height : 0;
            const availableForBody = layoutHeight - layoutBorderH - headHeight;
            return Math.max(0, Math.floor(availableForBody));
        }

        // preview/editor body 높이를 실제 화면 배치 기준으로 맞춘다.
        // 가로모드에서는 footer가 viewport 안에 남을 공간을 먼저 예약한 뒤 본문 높이를 정한다.
        let previewBodyHeightRafId = null;
        let previewPortraitLoadingHeightLocked = false;
        let previewPortraitLoadingHeightReleaseRafId = null;

        function getPreviewBodyElement() {
            return previewPanel ? previewPanel.querySelector(".handrive-list-preview-body") : null;
        }

        function clearPreviewBodyHeightStyles(previewBody) {
            if (!previewBody) {
                return;
            }
            previewBody.style.height = "";
            previewBody.style.minHeight = "";
            previewBody.style.maxHeight = "";
        }

        function lockPreviewBodyHeightForPortraitLoading() {
            const previewBody = getPreviewBodyElement();
            if (
                !previewBody ||
                !previewPanel ||
                previewPanel.hidden ||
                !listLayout ||
                !listLayout.classList.contains("is-portrait") ||
                !listLayout.classList.contains("has-preview")
            ) {
                return;
            }
            if (previewPortraitLoadingHeightReleaseRafId !== null) {
                window.cancelAnimationFrame(previewPortraitLoadingHeightReleaseRafId);
                previewPortraitLoadingHeightReleaseRafId = null;
            }
            const currentHeight = Math.ceil(previewBody.getBoundingClientRect().height);
            if (currentHeight <= 0) {
                return;
            }
            previewPortraitLoadingHeightLocked = true;
            const heightValue = String(currentHeight) + "px";
            previewBody.style.height = heightValue;
            previewBody.style.minHeight = heightValue;
            previewBody.style.maxHeight = "none";
        }

        function releasePreviewBodyHeightAfterPortraitLoading() {
            if (!previewPortraitLoadingHeightLocked) {
                return;
            }
            if (previewPortraitLoadingHeightReleaseRafId !== null) {
                window.cancelAnimationFrame(previewPortraitLoadingHeightReleaseRafId);
            }
            previewPortraitLoadingHeightReleaseRafId = window.requestAnimationFrame(function () {
                const previewBody = getPreviewBodyElement();
                previewPortraitLoadingHeightReleaseRafId = null;
                previewPortraitLoadingHeightLocked = false;
                if (!previewBody) {
                    return;
                }
                if (listLayout && listLayout.classList.contains("is-landscape")) {
                    syncPreviewBodyHeight();
                    return;
                }
                clearPreviewBodyHeightStyles(previewBody);
            });
        }

        function syncPreviewBodyHeight() {
            if (!previewPanel || !listLayout) {
                return;
            }
            const previewBody = getPreviewBodyElement();
            if (!previewBody) {
                return;
            }
            const isLandscape = listLayout.classList.contains("is-landscape");
            const hasPreview = listLayout.classList.contains("has-preview");
            if (!isLandscape || !hasPreview) {
                if (
                    previewPortraitLoadingHeightLocked &&
                    hasPreview &&
                    !previewPanel.hidden &&
                    listLayout.classList.contains("is-portrait")
                ) {
                    return;
                }
                previewPortraitLoadingHeightLocked = false;
                clearPreviewBodyHeightStyles(previewBody);
                return;
            }
            const previewHead = previewPanel.querySelector(".handrive-list-preview-head");
            const height = getListSideBodyHeight(previewHead);
            previewBody.style.height = height + "px";
            previewBody.style.minHeight = height + "px";
            previewBody.style.maxHeight = height + "px";
        }

        let editorBodyHeightRafId = null;
        function syncEditorBodyHeight() {
            if (!editorPanel || !editorBody || !listLayout) {
                return;
            }
            const isLandscape = listLayout.classList.contains("is-landscape");
            const hasEditor = listLayout.classList.contains("has-editor");
            if (!isLandscape || !hasEditor || editorPanel.hidden) {
                editorBody.style.height = "";
                editorBody.style.minHeight = "";
                editorBody.style.maxHeight = "";
                return;
            }
            const height = getListSideBodyHeight(editorHead);
            editorBody.style.height = height + "px";
            editorBody.style.minHeight = height + "px";
            editorBody.style.maxHeight = height + "px";
        }

        let listBodyHeightRafId = null;
        function syncListBodyHeight() {
            if (!listContainer || !listLayout) {
                return;
            }
            const isLandscape = listLayout.classList.contains("is-landscape");
            if (!isLandscape) {
                listContainer.style.height = "";
                listContainer.style.minHeight = "";
                listContainer.style.maxHeight = "";
                return;
            }
            const height = getListSideBodyHeight(null);
            listContainer.style.height = height + "px";
            listContainer.style.minHeight = height + "px";
            listContainer.style.maxHeight = height + "px";
        }

        function scheduleListBodyHeight() {
            if (listBodyHeightRafId !== null) {
                return;
            }
            listBodyHeightRafId = window.requestAnimationFrame(function () {
                listBodyHeightRafId = null;
                syncListBodyHeight();
            });
        }

        function schedulePreviewBodyHeight() {
            if (previewBodyHeightRafId !== null) {
                return;
            }
            previewBodyHeightRafId = window.requestAnimationFrame(function () {
                previewBodyHeightRafId = null;
                syncPreviewBodyHeight();
            });
        }
        function scheduleEditorBodyHeight() {
            if (editorBodyHeightRafId !== null) {
                return;
            }
            editorBodyHeightRafId = window.requestAnimationFrame(function () {
                editorBodyHeightRafId = null;
                syncEditorBodyHeight();
            });
        }

        let currentDirRowSyncRafId = null;

        function scheduleSyncCurrentDirRowHeightWithSideHead() {
            if (currentDirRowSyncRafId !== null) {
                return;
            }
            currentDirRowSyncRafId = window.requestAnimationFrame(function () {
                currentDirRowSyncRafId = null;
                syncCurrentDirRowHeightWithSideHead();
                window.requestAnimationFrame(function () {
                    syncCurrentDirRowHeightWithSideHead();
                });
            });
        }

        function syncCurrentDirRowHeightWithSideHead() {
            if (!listContainer) {
                return;
            }
            const currentDirRow = listContainer.querySelector(".handrive-current-dir-row");
            if (!currentDirRow) {
                return;
            }
            const clearSideHeadHeight = function (headElement) {
                if (headElement) {
                    headElement.style.minHeight = "";
                }
            };
            const scheduleSideBodyHeights = function () {
                schedulePreviewBodyHeight();
                scheduleEditorBodyHeight();
            };

            const isLandscape = Boolean(listLayout && listLayout.classList.contains("is-landscape"));
            if (!isLandscape) {
                currentDirRow.style.minHeight = "";
                clearSideHeadHeight(previewHead);
                clearSideHeadHeight(editorHead);
                scheduleSideBodyHeights();
                return;
            }

            const hasVisibleEditor = Boolean(
                listLayout &&
                listLayout.classList.contains("has-editor") &&
                editorPanel &&
                !editorPanel.hidden &&
                editorHead
            );
            const hasVisiblePreview = Boolean(
                listLayout &&
                listLayout.classList.contains("has-preview") &&
                previewPanel &&
                !previewPanel.hidden &&
                previewHead
            );

            const activeHead = hasVisibleEditor ? editorHead : (hasVisiblePreview ? previewHead : null);
            if (!activeHead) {
                currentDirRow.style.minHeight = "";
                clearSideHeadHeight(previewHead);
                clearSideHeadHeight(editorHead);
                scheduleSideBodyHeights();
                return;
            }

            const previousRowMinHeight = currentDirRow.style.minHeight;
            const previousHeadMinHeight = activeHead.style.minHeight;

            currentDirRow.style.minHeight = "";
            activeHead.style.minHeight = "";
            if (activeHead !== previewHead) {
                clearSideHeadHeight(previewHead);
            }
            if (activeHead !== editorHead) {
                clearSideHeadHeight(editorHead);
            }

            const rowHeight = Math.ceil(currentDirRow.getBoundingClientRect().height);
            const headHeight = Math.ceil(activeHead.getBoundingClientRect().height);
            const syncedHeight = Math.max(rowHeight, headHeight);
            if (syncedHeight > 0) {
                const syncedHeightValue = String(syncedHeight) + "px";
                currentDirRow.style.minHeight = syncedHeightValue;
                activeHead.style.minHeight = syncedHeightValue;
                if (previousRowMinHeight !== syncedHeightValue || previousHeadMinHeight !== syncedHeightValue) {
                    scheduleSideBodyHeights();
                }
                return;
            }
            currentDirRow.style.minHeight = "";
            activeHead.style.minHeight = "";
            if (previousRowMinHeight || previousHeadMinHeight) {
                scheduleSideBodyHeights();
            }
        }

        function syncSearchFormVisibility() {
            const searchForm = ensureListSearchForm();
            if (!searchForm) return;
            const currentDirRow = listContainer
                ? listContainer.querySelector(".handrive-current-dir-row")
                : null;
            attachListSearchFormToCurrentDirRow(currentDirRow);
            searchForm.classList.remove("is-search-hidden");
            syncCurrentDirInlineSearchVisibility(false);
            const duration = 220;
            const startTime = performance.now();
            function tick() {
                syncListBodyHeight();
                syncPreviewBodyHeight();
                syncEditorBodyHeight();
                if (performance.now() - startTime < duration) {
                    window.requestAnimationFrame(tick);
                }
            }
            window.requestAnimationFrame(tick);
        }

        function setPreviewVisibility(isVisible) {
            if (!isVisible) {
                void releasePreviewVideoPlayers(previewContent);
                state.activeRenderedPreviewPath = "";
                state.activePreviewRenderMode = "";
            }
            previewSetVisibility(previewPanel, listLayout, isVisible, scheduleSyncCurrentDirRowHeightWithSideHead);
            if (isVisible) {
                schedulePreviewBodyHeight();
            }
            scheduleEditorBodyHeight();
            syncSearchFormVisibility();
        }

        function scrollPreviewIntoViewIfPortrait() {
            previewScrollIntoViewIfPortrait(previewPanel, previewHead);
        }

        function isPreviewableFileEntry(entry) {
            return Boolean(
                entry &&
                entry.type === "file" &&
                !entry.isCurrentFolder &&
                !entry.is_archive &&
                !entry.is_archive_member
            );
        }

        function isArchiveEntry(entry) {
            return Boolean(entry && entry.is_archive && entry.archive_virtual_path);
        }

        function isArchiveMemberEntry(entry) {
            return Boolean(entry && entry.is_archive_member);
        }

        function isArchiveVirtualPath(pathValue) {
            return normalizePath(pathValue || "", true).startsWith(".handrive-archive/");
        }

        function getEntryFileExtension(entry) {
            if (!entry || entry.type !== "file") {
                return "";
            }
            const fileName = String(entry.name || "");
            const dotIndex = fileName.lastIndexOf(".");
            if (dotIndex <= 0) {
                return "";
            }
            return fileName.slice(dotIndex).toLowerCase();
        }

        function isEditableHandriveFileEntry(entry) {
            if (getGoogleDriveDocsEditorUrl(entry)) {
                return true;
            }
            if (entry && entry.google_drive && entry.google_drive.can_edit_content === false) {
                return false;
            }
            return !nonEditableMediaExtensions.has(getEntryFileExtension(entry))
                || isImageEditorEntry(entry)
                || isVideoEditorEntry(entry)
                || isAudioEditorEntry(entry)
                || isPdfEditorEntry(entry);
        }

        function isSortableListMetaKey(sortKey) {
            return ["modified", "type", "size", "commit", "id"].includes(String(sortKey || ""));
        }

        function getEntryNameSortValue(entry) {
            const rawName = entry && entry.name
                ? entry.name
                : String(entry && entry.path ? entry.path : "").split("/").pop();
            return String(rawName || "").trim().toLocaleLowerCase();
        }

        function resolveEntryTypeLabel(entry) {
            const safeEntry = entry || {};
            const explicitLabel = String(safeEntry.type_display || "").trim();
            if (explicitLabel) {
                return explicitLabel;
            }
            if (safeEntry.type === "dir") {
                if (safeEntry.google_drive && safeEntry.google_drive.is_root) {
                    return "Google Drive";
                }
                if (safeEntry.github_repo) {
                    return "GitHub";
                }
                if (safeEntry.git_repo && safeEntry.git_repo.provider === "github") {
                    return "GitHub";
                }
                if (safeEntry.git_repo) {
                    return t("repository_badge", "Repository");
                }
                if (safeEntry.git_branch_root) {
                    return t("branch_badge", "Branch");
                }
                if (safeEntry.is_map_folder) {
                    return t("list_type_map", textByLang("지도", "Map"));
                }
                return t("list_type_folder", textByLang("폴더", "Folder"));
            }
            if (safeEntry.is_archive) {
                return t("list_type_archive", textByLang("압축", "Archive"));
            }
            const extension = getEntryFileExtension(safeEntry) || getPathFileExtension(safeEntry.path || safeEntry.name || "");
            if (extension) {
                return extension.replace(/^\./, "").toUpperCase();
            }
            return t("list_type_file", textByLang("파일", "File"));
        }

        function resolveEntryCommitMeta(entry) {
            const safeEntry = entry || {};
            if (safeEntry.git_branch_root) {
                return "";
            }
            return String(safeEntry.git_commit_id || safeEntry.git_commit_hash || safeEntry.git_commit_message || "").trim();
        }

        function resolveEntryCommitSubject(entry) {
            if (entry && entry.git_branch_root) {
                return "";
            }
            return String(entry && entry.git_commit_message || "").trim();
        }

        function resolveEntryIdMeta(entry) {
            const safeEntry = entry || {};
            if (safeEntry.git_branch_root) {
                return "";
            }
            const commitAuthor = String(safeEntry.git_commit_author_username || "").trim();
            if (commitAuthor) {
                return commitAuthor;
            }
            const repoMeta = safeEntry.git_repo || safeEntry.git_repo_meta || null;
            if (repoMeta && !repoMeta.is_owner) {
                return String(repoMeta.owner_username || "").trim();
            }
            if (safeEntry.google_drive) {
                return "";
            }
            if (safeEntry.github_repo) {
                return String(safeEntry.github_repo.owner || "").trim();
            }
            if (safeEntry.git_repo && safeEntry.git_repo.provider === "github") {
                return String(safeEntry.git_repo.owner_username || "").trim();
            }
            return "";
        }

        function parseHandriveSizeDisplay(sizeDisplay) {
            const normalized = String(sizeDisplay || "").trim().replace(/,/g, "");
            if (!normalized) {
                return null;
            }
            const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)\s*(B|KB|MB|GB)$/i);
            if (!match) {
                return null;
            }
            const value = Number(match[1]);
            if (!Number.isFinite(value)) {
                return null;
            }
            const unit = match[2].toUpperCase();
            const multipliers = {
                B: 1,
                KB: 1024,
                MB: 1024 * 1024,
                GB: 1024 * 1024 * 1024,
            };
            return value * (multipliers[unit] || 1);
        }

        function getEntrySizeSortValue(entry) {
            if (!entry) {
                return null;
            }
            const rawSize = Number(entry.size_bytes);
            if (Number.isFinite(rawSize)) {
                return rawSize;
            }
            return parseHandriveSizeDisplay(entry.size_display);
        }

        function getEntryModifiedSortValue(entry) {
            const value = String(entry && (entry.modified_sort || entry.modified_display) || "").trim();
            return value || null;
        }

        const entryTypeSortRankByIconKey = {
            archive: 100,
            pdf: 110,
            document: 120,
            word: 120,
            sheet: 121,
            excel: 121,
            presentation: 122,
            powerpoint: 122,
            text: 130,
            markdown: 131,
            data: 140,
            json: 141,
            image: 150,
            audio: 160,
            video: 170,
            font: 180,
            html: 200,
            css: 201,
            js: 202,
            jsx: 203,
            ts: 204,
            py: 205,
            java: 206,
            kotlin: 207,
            swift: 208,
            go: 209,
            rust: 210,
            ruby: 211,
            php: 212,
            c: 213,
            cpp: 214,
            csharp: 215,
            scala: 216,
            shell: 217,
            code: 218,
            exe: 300,
            file: 900,
        };

        function getEntryTypeSortValue(entry) {
            if (!entry) {
                return null;
            }
            const safeEntry = entry || {};
            if (safeEntry.type === "dir") {
                if (safeEntry.google_drive) {
                    return "000:google-drive";
                }
                if (safeEntry.github_repo || (safeEntry.git_repo && safeEntry.git_repo.provider === "github")) {
                    return "001:github";
                }
                if (safeEntry.git_repo) {
                    return "002:repo";
                }
                if (safeEntry.git_branch_root) {
                    return "003:branch";
                }
                if (safeEntry.is_map_folder) {
                    return "004:map-folder";
                }
                return "005:folder";
            }
            const extension = getEntryFileExtension(safeEntry) || getPathFileExtension(safeEntry.path || safeEntry.name || "");
            const normalizedExtension = String(extension || "").replace(/^\./, "").toLocaleLowerCase();
            const iconKey = safeEntry.is_archive ? "archive" : getFileIconKey(safeEntry.path || safeEntry.name || "");
            const typeRank = entryTypeSortRankByIconKey[iconKey] || entryTypeSortRankByIconKey.file;
            return String(typeRank).padStart(3, "0") + ":" + String(iconKey || "file") + ":" + (normalizedExtension || "no-extension");
        }

        function getEntrySortValue(entry, sortKey) {
            if (sortKey === "modified") {
                return getEntryModifiedSortValue(entry);
            }
            if (sortKey === "type") {
                return getEntryTypeSortValue(entry);
            }
            if (sortKey === "size") {
                return getEntrySizeSortValue(entry);
            }
            if (sortKey === "commit") {
                return resolveEntryCommitMeta(entry).toLocaleLowerCase();
            }
            if (sortKey === "id") {
                return resolveEntryIdMeta(entry).toLocaleLowerCase();
            }
            return getEntryNameSortValue(entry);
        }

        function isMissingSortValue(value) {
            return value === null || value === undefined || value === "";
        }

        function comparePresentSortValues(leftValue, rightValue) {
            if (typeof leftValue === "number" && typeof rightValue === "number") {
                return leftValue === rightValue ? 0 : (leftValue < rightValue ? -1 : 1);
            }
            return String(leftValue).localeCompare(String(rightValue), undefined, {
                numeric: true,
                sensitivity: "base",
            });
        }

        function compareEntriesByActiveSort(leftEntry, rightEntry) {
            const sortKey = state.listSortKey;
            if (!isSortableListMetaKey(sortKey)) {
                return 0;
            }
            const leftValue = getEntrySortValue(leftEntry, sortKey);
            const rightValue = getEntrySortValue(rightEntry, sortKey);
            const leftMissing = isMissingSortValue(leftValue);
            const rightMissing = isMissingSortValue(rightValue);
            if (leftMissing || rightMissing) {
                if (leftMissing && rightMissing) {
                    return getEntryNameSortValue(leftEntry).localeCompare(getEntryNameSortValue(rightEntry), undefined, {
                        numeric: true,
                        sensitivity: "base",
                    });
                }
                return leftMissing ? 1 : -1;
            }
            let result = comparePresentSortValues(leftValue, rightValue);
            if (result !== 0 && state.listSortDirection === "desc") {
                result = -result;
            }
            if (result !== 0) {
                return result;
            }
            return getEntryNameSortValue(leftEntry).localeCompare(getEntryNameSortValue(rightEntry), undefined, {
                numeric: true,
                sensitivity: "base",
            });
        }

        function getSortedEntriesForRender(entries) {
            const items = (Array.isArray(entries) ? entries : []).slice();
            if (!isSortableListMetaKey(state.listSortKey)) {
                return items;
            }
            items.sort(compareEntriesByActiveSort);
            return items;
        }

        function updateCurrentDirSortActiveState(row) {
            if (!row) {
                return;
            }
            const syncSortDirectionMarker = function (label, isActive) {
                let marker = label.querySelector(".handrive-sort-direction-mark");
                if (!isActive) {
                    label.removeAttribute("data-sort-direction");
                    if (marker) {
                        marker.remove();
                    }
                    return;
                }
                const sortDirection = state.listSortDirection === "desc" ? "desc" : "asc";
                label.setAttribute("data-sort-direction", sortDirection);
                if (!marker) {
                    marker = document.createElement("span");
                    marker.className = "handrive-sort-direction-mark";
                    marker.setAttribute("aria-hidden", "true");
                    label.appendChild(marker);
                }
                marker.textContent = sortDirection === "desc" ? "▾" : "▴";
            };
            const labels = row.querySelectorAll(".handrive-item-meta-label[data-sort-key]");
            labels.forEach(function (label) {
                const isActive = label.getAttribute("data-sort-key") === state.listSortKey;
                label.classList.toggle("is-sort-active", isActive);
                label.setAttribute("aria-sort", isActive && state.listSortDirection === "desc" ? "descending" : (isActive ? "ascending" : "none"));
                syncSortDirectionMarker(label, isActive);
            });
        }

        function applyListSort(sortKey) {
            if (!isSortableListMetaKey(sortKey)) {
                return;
            }
            if (state.listSortKey === sortKey) {
                state.listSortDirection = state.listSortDirection === "desc" ? "asc" : "desc";
            } else {
                state.listSortKey = sortKey;
                state.listSortDirection = "asc";
            }
            renderList({ skipPreview: true });
        }

        function bindCurrentDirSortControls(row) {
            if (!row) {
                return;
            }
            const metaTrail = row.querySelector(".handrive-item-meta-trail");
            if (!metaTrail) {
                return;
            }
            if (metaTrail.dataset.sortControlsBound !== "1") {
                metaTrail.dataset.sortControlsBound = "1";
                metaTrail.addEventListener("mousedown", function (event) {
                    const target = event.target instanceof Element
                        ? event.target.closest(".handrive-item-meta-label[data-sort-key]")
                        : null;
                    if (!target || !metaTrail.contains(target)) {
                        return;
                    }
                    event.preventDefault();
                });
                metaTrail.addEventListener("click", function (event) {
                    const target = event.target instanceof Element
                        ? event.target.closest(".handrive-item-meta-label[data-sort-key]")
                        : null;
                    if (!target || !metaTrail.contains(target)) {
                        return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    applyListSort(target.getAttribute("data-sort-key") || "");
                });
            }
            updateCurrentDirSortActiveState(row);
        }

        function applyRenderedContentModeClass(targetElement, renderMode, renderClass) {
            applyHandriveRenderedContentModeClass(targetElement, renderMode, renderClass);
        }

        function setPreviewActionTargets(entry) {
            const entryPath = entry ? normalizePath(entry.path, true) : "";
            previewSetActionTargets({
                entry: entry,
                previewRenderMode: state.activePreviewRenderMode || "",
                previewDownloadButton: previewDownloadButton,
                previewPrintButton: previewPrintButton,
                previewEditButton: previewEditButton,
                previewSpreadsheetSaveButton: previewSpreadsheetSaveButton,
                previewDeleteButton: previewDeleteButton,
                previewUrlShareButton: previewUrlShareButton,
                previewCanPrint: Boolean(
                    entryPath &&
                    state.activeRenderedPreviewPath === entryPath &&
                    state.activePreviewRenderMode !== "unsupported" &&
                    state.activePreviewRenderMode !== "media_video"
                ),
                urlShareApiUrl: urlShareApiUrl,
                isPreviewableFileEntry: isPreviewableFileEntry,
                isEditableHandriveFileEntry: isEditableHandriveFileEntry,
                isSpreadsheetPreviewEntry: isSpreadsheetEditorEntry,
                buildDownloadUrl: buildDownloadUrl,
                onEdit: editEntry,
            });
        }

        function setPreviewPlaceholder(message) {
            void releasePreviewVideoPlayers(previewContent);
            setPreviewBodyLoading(false);
            previewSetPlaceholder(previewContent, escapeHtml, message);
            releasePreviewBodyHeightAfterPortraitLoading();
        }

        function setPreviewBodyLoading(isLoading) {
            const previewBody = getPreviewBodyElement();
            if (!previewBody) {
                return;
            }
            previewBody.classList.toggle("is-loading", isLoading);
            previewBody.setAttribute("aria-busy", isLoading ? "true" : "false");
            if (isLoading) {
                previewBody.scrollTop = 0;
            }
            if (previewBodyLoadingOverlay) {
                previewBodyLoadingOverlay.hidden = !isLoading;
            }
        }

        function setPreviewLoading() {
            if (!previewContent) {
                return;
            }
            previewCancelScrollIntoView({ freezePosition: true });
            lockPreviewBodyHeightForPortraitLoading();
            setPreviewBodyLoading(true);
        }

        function ensureListMediaEditorScript(kind) {
            const normalizedKind = String(kind || "").trim().toLowerCase();
            const scriptUrl = normalizedKind === "image"
                ? imageEditorScriptUrl
                : normalizedKind === "video"
                    ? videoEditorScriptUrl
                    : normalizedKind === "audio"
                        ? audioEditorScriptUrl
                        : normalizedKind === "pdf"
                            ? pdfEditorScriptUrl
                            : "";
            if (normalizedKind === "video") {
                return loadVideoPlayerStack().then(function () {
                    return loadLazyScriptOnce(scriptUrl, getMediaEditorGlobalName(normalizedKind));
                });
            }
            return loadLazyScriptOnce(scriptUrl, getMediaEditorGlobalName(normalizedKind));
        }

        function updateEditorHighlight() {
            if (!editorContentInput || !editorHighlightCode) {
                return;
            }
            
            const content = editorContentInput.value;
            const escapedContent = escapeHtml(content);
            editorHighlightCode.textContent = content;
        }

        function switchToEditor(entry) {
            if (!editorPanel || !editorFilenameInput) {
                return;
            }
            stopPreviewMediaElements(previewContent);

            if (isPdfEditorEntry(entry)) {
                switchToPdfEditor(entry);
                return;
            }
            if (isImageEditorEntry(entry)) {
                switchToImageEditor(entry);
                return;
            }
            if (isVideoEditorEntry(entry)) {
                switchToVideoEditor(entry);
                return;
            }
            if (isAudioEditorEntry(entry)) {
                switchToAudioEditor(entry);
                return;
            }
            if (isSpreadsheetEditorEntry(entry)) {
                switchToSpreadsheetEditor(entry);
                return;
            }

            if (!editorContentInput) return;

            activeListEditorEntry = entry || null;
            listMarkdownUploadedImagePaths = [];
            clearListEditorSuggestion();
            if (spreadsheetEditorSurface && !spreadsheetEditorSurface.hidden) {
                if (window.HandriveSpreadsheetEditor) window.HandriveSpreadsheetEditor.destroy();
                spreadsheetEditorSurface.hidden = true;
            }
            if (pdfEditorSurface && !pdfEditorSurface.hidden) {
                if (window.HandrivePdfEditor) window.HandrivePdfEditor.destroy();
                pdfEditorSurface.hidden = true;
            }
            if (editorSurface) editorSurface.hidden = false;
            if (imageEditorSurface) imageEditorSurface.hidden = true;
            if (videoEditorSurface) videoEditorSurface.hidden = true;
            if (audioEditorSurface) audioEditorSurface.hidden = true;
            if (pdfEditorSurface) pdfEditorSurface.hidden = true;
            editorSwitchToEditorUI({
                entry: entry,
                editorPanel: editorPanel,
                editorFilenameInput: editorFilenameInput,
                editorContentInput: editorContentInput,
                previewPanel: previewPanel,
                listLayout: listLayout,
                renderHighlight: renderListEditorHighlight,
                resetHorizontalScroll: scheduleListEditorHorizontalScrollReset,
                onAfterChange: function () {
                    setPreviewVisibility(false);
                    scheduleSyncCurrentDirRowHeightWithSideHead();
                    scheduleEditorBodyHeight();
                    syncSearchFormVisibility();
                },
                loadContent: function (targetEntry) {
                    const targetUrl = buildDownloadUrl(targetEntry.path);
                    if (!targetUrl) {
                        console.error('Error loading file content: download API URL is missing');
                        return Promise.resolve('');
                    }
                    return fetch(appendAdminHandriveUserQuery(targetUrl))
                        .then(function (response) {
                            if (!response.ok) {
                                throw new Error('Download API request failed: ' + String(response.status));
                            }
                            return response.text();
                        });
                },
            });
            setupEditorEvents(entry);
        }

        async function switchToPdfEditor(entry) {
            activeListEditorEntry = entry || null;
            stopPreviewMediaElements(previewContent);

            if (editorSurface) editorSurface.hidden = true;
            if (imageEditorSurface) imageEditorSurface.hidden = true;
            if (videoEditorSurface) videoEditorSurface.hidden = true;
            if (audioEditorSurface) audioEditorSurface.hidden = true;
            if (spreadsheetEditorSurface) spreadsheetEditorSurface.hidden = true;
            if (pdfEditorSurface) pdfEditorSurface.hidden = false;
            if (window.HandriveSpreadsheetEditor) window.HandriveSpreadsheetEditor.destroy();

            if (editorFilenameInput) editorFilenameInput.value = entry.name || "";

            if (previewPanel) {
                previewPanel.hidden = true;
                previewPanel.setAttribute("aria-hidden", "true");
            }
            if (editorPanel) {
                editorPanel.hidden = false;
                editorPanel.setAttribute("aria-hidden", "false");
            }
            if (listLayout) {
                listLayout.classList.remove("has-preview");
                listLayout.classList.add("has-editor");
            }
            scheduleSyncCurrentDirRowHeightWithSideHead();
            syncSearchFormVisibility();

            if (editorSaveButton) editorSaveButton.disabled = true;
            setListEditorSaving(true);
            try {
                await ensureListMediaEditorScript("pdf");
            } catch (error) {
                setListEditorSaving(false);
                if (editorSaveButton) editorSaveButton.disabled = false;
                alertError(error);
                return;
            }
            try {
                if (!window.HandrivePdfEditor) {
                    throw new Error(t("pdf_editor_load_error", "PDF 편집기를 불러오지 못했습니다."));
                }
                await window.HandrivePdfEditor.init({
                    entry: entry,
                    metaUrl: buildPdfEditorApiUrl(pdfEditorMetaUrl, entry.path),
                    pageUrlBuilder: function (pageIndex, scale) {
                        return buildPdfEditorApiUrl(pdfEditorPageUrl, entry.path, {
                            page: String(pageIndex),
                            scale: String(scale || 2),
                        });
                    },
                    onDirtyChange: function (dirty) {
                        if (editorSaveButton) {
                            editorSaveButton.classList.toggle("is-dirty", dirty);
                        }
                    },
                });
            } catch (error) {
                setListEditorSaving(false);
                if (editorSaveButton) editorSaveButton.disabled = false;
                alertError(error);
                switchToPreview();
                return;
            }
            setListEditorSaving(false);
            scheduleListEditorHorizontalScrollReset();

            setupEditorEvents(entry);
            if (editorSaveButton) editorSaveButton.disabled = false;
        }

        async function switchToImageEditor(entry) {
            activeListEditorEntry = entry || null;
            stopPreviewMediaElements(previewContent);
            if (pdfEditorSurface && !pdfEditorSurface.hidden && window.HandrivePdfEditor) {
                window.HandrivePdfEditor.destroy();
            }

            // 텍스트 surface 숨김, 이미지 surface 표시
            if (editorSurface) editorSurface.hidden = true;
            if (videoEditorSurface) videoEditorSurface.hidden = true;
            if (audioEditorSurface) audioEditorSurface.hidden = true;
            if (pdfEditorSurface) pdfEditorSurface.hidden = true;
            if (spreadsheetEditorSurface) spreadsheetEditorSurface.hidden = true;
            if (imageEditorSurface) imageEditorSurface.hidden = false;
            if (window.HandriveSpreadsheetEditor) window.HandriveSpreadsheetEditor.destroy();

            // 파일명 입력창 설정
            if (editorFilenameInput) editorFilenameInput.value = entry.name || "";

            // 패널 열기 (has-editor 클래스 추가)
            if (previewPanel) {
                previewPanel.hidden = true;
                previewPanel.setAttribute("aria-hidden", "true");
            }
            if (editorPanel) {
                editorPanel.hidden = false;
                editorPanel.setAttribute("aria-hidden", "false");
            }
            if (listLayout) {
                listLayout.classList.remove("has-preview");
                listLayout.classList.add("has-editor");
            }
            scheduleSyncCurrentDirRowHeightWithSideHead();
            syncSearchFormVisibility();

            // ImageEditor 초기화
            const imageServeUrl = buildDownloadUrl(entry.path);
            if (editorSaveButton) editorSaveButton.disabled = true;
            setListEditorSaving(true);
            try {
                await ensureListMediaEditorScript("image");
            } catch (error) {
                setListEditorSaving(false);
                if (editorSaveButton) editorSaveButton.disabled = false;
                alertError(error);
                return;
            }
            setListEditorSaving(false);
            if (window.HandriveImageEditor) {
                window.HandriveImageEditor.init({
                    entry: entry,
                    imageServeUrl: imageServeUrl,
                    backgroundRemoveUrl: imageEditorRemoveBackgroundUrl,
                    onDirtyChange: function (dirty) {
                        if (editorSaveButton) {
                            editorSaveButton.classList.toggle("is-dirty", dirty);
                        }
                    },
                });
            }
            scheduleListEditorHorizontalScrollReset();

            setupEditorEvents(entry);
            if (editorSaveButton) editorSaveButton.disabled = false;
        }

        async function switchToVideoEditor(entry) {
            activeListEditorEntry = entry || null;
            stopPreviewMediaElements(previewContent);
            if (pdfEditorSurface && !pdfEditorSurface.hidden && window.HandrivePdfEditor) {
                window.HandrivePdfEditor.destroy();
            }

            if (editorSurface) editorSurface.hidden = true;
            if (imageEditorSurface) imageEditorSurface.hidden = true;
            if (audioEditorSurface) audioEditorSurface.hidden = true;
            if (pdfEditorSurface) pdfEditorSurface.hidden = true;
            if (spreadsheetEditorSurface) spreadsheetEditorSurface.hidden = true;
            if (videoEditorSurface) videoEditorSurface.hidden = false;
            if (window.HandriveSpreadsheetEditor) window.HandriveSpreadsheetEditor.destroy();

            if (editorFilenameInput) editorFilenameInput.value = entry.name || "";

            if (previewPanel) {
                previewPanel.hidden = true;
                previewPanel.setAttribute("aria-hidden", "true");
            }
            if (editorPanel) {
                editorPanel.hidden = false;
                editorPanel.setAttribute("aria-hidden", "false");
            }
            if (listLayout) {
                listLayout.classList.remove("has-preview");
                listLayout.classList.add("has-editor");
            }
            scheduleSyncCurrentDirRowHeightWithSideHead();
            syncSearchFormVisibility();

            const videoServeUrl = buildDownloadUrl(entry.path);
            if (editorSaveButton) editorSaveButton.disabled = true;
            setListEditorSaving(true);
            try {
                await ensureListMediaEditorScript("video");
            } catch (error) {
                setListEditorSaving(false);
                if (editorSaveButton) editorSaveButton.disabled = false;
                alertError(error);
                return;
            }
            setListEditorSaving(false);
            if (window.HandriveVideoEditor) {
                window.HandriveVideoEditor.init({
                    entry: entry,
                    videoServeUrl: videoServeUrl,
                    buildDownloadUrl: buildScopedHomeDownloadUrl,
                    listApiUrl: appendQueryParam(appendSharedQuery(listApiUrl), "scope_home", "1"),
                    scopedHomeDir: scopedHomeDir,
                    onDirtyChange: function (dirty) {
                        if (editorSaveButton) {
                            editorSaveButton.classList.toggle("is-dirty", dirty);
                        }
                    },
                });
            }
            scheduleListEditorHorizontalScrollReset();

            setupEditorEvents(entry);
            if (editorSaveButton) editorSaveButton.disabled = false;
        }

        async function switchToAudioEditor(entry) {
            activeListEditorEntry = entry || null;
            stopPreviewMediaElements(previewContent);
            if (pdfEditorSurface && !pdfEditorSurface.hidden && window.HandrivePdfEditor) {
                window.HandrivePdfEditor.destroy();
            }

            if (editorSurface) editorSurface.hidden = true;
            if (imageEditorSurface) imageEditorSurface.hidden = true;
            if (videoEditorSurface) videoEditorSurface.hidden = true;
            if (pdfEditorSurface) pdfEditorSurface.hidden = true;
            if (spreadsheetEditorSurface) spreadsheetEditorSurface.hidden = true;
            if (audioEditorSurface) audioEditorSurface.hidden = false;
            if (window.HandriveSpreadsheetEditor) window.HandriveSpreadsheetEditor.destroy();

            if (editorFilenameInput) editorFilenameInput.value = entry.name || "";

            if (previewPanel) {
                previewPanel.hidden = true;
                previewPanel.setAttribute("aria-hidden", "true");
            }
            if (editorPanel) {
                editorPanel.hidden = false;
                editorPanel.setAttribute("aria-hidden", "false");
            }
            if (listLayout) {
                listLayout.classList.remove("has-preview");
                listLayout.classList.add("has-editor");
            }
            scheduleSyncCurrentDirRowHeightWithSideHead();
            syncSearchFormVisibility();

            const audioServeUrl = buildDownloadUrl(entry.path);
            if (editorSaveButton) editorSaveButton.disabled = true;
            setListEditorSaving(true);
            try {
                await ensureListMediaEditorScript("audio");
            } catch (error) {
                setListEditorSaving(false);
                if (editorSaveButton) editorSaveButton.disabled = false;
                alertError(error);
                return;
            }
            setListEditorSaving(false);
            if (window.HandriveAudioEditor) {
                window.HandriveAudioEditor.init({
                    entry: entry,
                    audioServeUrl: audioServeUrl,
                    listApiUrl: appendQueryParam(appendSharedQuery(listApiUrl), "scope_home", "1"),
                    buildDownloadUrl: buildScopedHomeDownloadUrl,
                    scopedHomeDir: scopedHomeDir,
                    onDirtyChange: function (dirty) {
                        if (editorSaveButton) {
                            editorSaveButton.classList.toggle("is-dirty", dirty);
                        }
                    },
                });
            }
            scheduleListEditorHorizontalScrollReset();

            setupEditorEvents(entry);
            if (editorSaveButton) editorSaveButton.disabled = false;
        }

        async function switchToSpreadsheetEditor(entry) {
            activeListEditorEntry = entry || null;
            stopPreviewMediaElements(previewContent);
            if (pdfEditorSurface && !pdfEditorSurface.hidden && window.HandrivePdfEditor) {
                window.HandrivePdfEditor.destroy();
            }

            if (editorSurface) editorSurface.hidden = true;
            if (imageEditorSurface) imageEditorSurface.hidden = true;
            if (videoEditorSurface) videoEditorSurface.hidden = true;
            if (audioEditorSurface) audioEditorSurface.hidden = true;
            if (pdfEditorSurface) pdfEditorSurface.hidden = true;
            if (spreadsheetEditorSurface) spreadsheetEditorSurface.hidden = false;

            if (editorFilenameInput) editorFilenameInput.value = entry.name || "";

            if (previewPanel) {
                previewPanel.hidden = true;
                previewPanel.setAttribute("aria-hidden", "true");
            }
            if (editorPanel) {
                editorPanel.hidden = false;
                editorPanel.setAttribute("aria-hidden", "false");
            }
            if (listLayout) {
                listLayout.classList.remove("has-preview");
                listLayout.classList.add("has-editor");
            }
            scheduleSyncCurrentDirRowHeightWithSideHead();
            syncSearchFormVisibility();

            if (editorSaveButton) editorSaveButton.disabled = true;
            setListEditorSaving(true);
            try {
                if (!window.HandriveSpreadsheetEditor) {
                    throw new Error(t("spreadsheet_editor_load_error", "스프레드시트 에디터를 불러오지 못했습니다."));
                }
                await window.HandriveSpreadsheetEditor.init({
                    surface: spreadsheetEditorSurface,
                    entry: entry,
                    downloadUrl: buildDownloadUrl(entry.path),
                    licenseKey: handsontableLicenseKey,
                    onDirtyChange: function (dirty) {
                        if (editorSaveButton) {
                            editorSaveButton.classList.toggle("is-dirty", dirty);
                        }
                    },
                });
            } catch (error) {
                alertError(error);
                switchToPreview();
                return;
            } finally {
                setListEditorSaving(false);
                if (editorSaveButton) editorSaveButton.disabled = false;
            }

            scheduleListEditorHorizontalScrollReset();
            setupEditorEvents(entry);
        }

        function switchToPreview() {
            // 이미지 에디터 정리
            if (imageEditorSurface && !imageEditorSurface.hidden) {
                if (window.HandriveImageEditor) window.HandriveImageEditor.destroy();
                imageEditorSurface.hidden = true;
                if (editorSurface) editorSurface.hidden = false;
            }
            if (videoEditorSurface && !videoEditorSurface.hidden) {
                if (window.HandriveVideoEditor) window.HandriveVideoEditor.destroy();
                videoEditorSurface.hidden = true;
                if (editorSurface) editorSurface.hidden = false;
            }
            if (audioEditorSurface && !audioEditorSurface.hidden) {
                if (window.HandriveAudioEditor) window.HandriveAudioEditor.destroy();
                audioEditorSurface.hidden = true;
                if (editorSurface) editorSurface.hidden = false;
            }
            if (pdfEditorSurface && !pdfEditorSurface.hidden) {
                if (window.HandrivePdfEditor) window.HandrivePdfEditor.destroy();
                pdfEditorSurface.hidden = true;
                if (editorSurface) editorSurface.hidden = false;
            }
            if (spreadsheetEditorSurface && !spreadsheetEditorSurface.hidden) {
                if (window.HandriveSpreadsheetEditor) window.HandriveSpreadsheetEditor.destroy();
                spreadsheetEditorSurface.hidden = true;
                if (editorSurface) editorSurface.hidden = false;
            }

            editorSwitchToPreviewUI({
                editorPanel: editorPanel,
                previewPanel: previewPanel,
                listLayout: listLayout,
                onAfterChange: function () {
                    scheduleSyncCurrentDirRowHeightWithSideHead();
                    schedulePreviewBodyHeight();
                    scheduleEditorBodyHeight();
                    syncSearchFormVisibility();
                },
            });
            cleanupEditorEvents();
            activeListEditorEntry = null;
        }

        function setupEditorEvents(entry) {
            if (!editorSaveButton || !editorCancelButton) {
                return;
            }
            
            // 기존 이벤트 정리
            cleanupEditorEvents();
            
            if (editorContentInput) {
                if (!listMarkdownImageEventsBound) {
                    listMarkdownImageEventsBound = true;
                    editorContentInput.addEventListener("paste", function (event) {
                        listMarkdownImageInput.handlePaste(event);
                    });
                    editorContentInput.addEventListener("dragover", function (event) {
                        listMarkdownImageInput.handleDragOver(event);
                    });
                    editorContentInput.addEventListener("drop", function (event) {
                        listMarkdownImageInput.handleDrop(event);
                    });
                }
                editorContentInput.addEventListener("input", function () {
                    renderListEditorHighlight();
                    updateListEditorSuggestion();
                });
                editorContentInput.addEventListener("scroll", syncListEditorHighlightScroll, { passive: true });
                let listEditorFontSize = 16;
                editorContentInput.addEventListener("wheel", function (event) {
                    if (!event.ctrlKey && !event.metaKey) return;
                    event.preventDefault();
                    const delta = event.deltaY < 0 ? 2 : -2;
                    listEditorFontSize = Math.max(8, Math.min(40, listEditorFontSize + delta));
                    editorContentInput.style.fontSize = listEditorFontSize + "px";
                    if (editorHighlight) {
                        editorHighlight.style.fontSize = listEditorFontSize + "px";
                    }
                    syncListEditorHighlightScroll();
                }, { passive: false });
                editorContentInput.addEventListener("click", function () {
                    clearListEditorSuggestion();
                });
                editorContentInput.addEventListener("keydown", function (event) {
                    if ((event.metaKey || event.ctrlKey) && !event.altKey && String(event.key || "").toLowerCase() === "s") {
                        event.preventDefault();
                        if (editorSaveButton && !editorSaveButton.disabled) {
                            editorSaveButton.click();
                        }
                        return;
                    }
                    if (event.key === "Escape") {
                        clearListEditorSuggestion();
                        return;
                    }
                    if (!editorSuggest.hidden && event.key === "ArrowDown") {
                        event.preventDefault();
                        moveListEditorSuggestion(1);
                        return;
                    }
                    if (!editorSuggest.hidden && event.key === "ArrowUp") {
                        event.preventDefault();
                        moveListEditorSuggestion(-1);
                        return;
                    }
                    if (!editorSuggest.hidden && event.key === "Enter") {
                        if (acceptListEditorSuggestion()) {
                            event.preventDefault();
                        }
                        return;
                    }
                    if (event.key === "Tab" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
                        if (acceptListEditorSuggestion()) {
                            event.preventDefault();
                        }
                        return;
                    }
                    if (
                        event.key === "ArrowLeft" ||
                        event.key === "ArrowRight" ||
                        event.key === "Home" ||
                        event.key === "End" ||
                        event.key === "PageUp" ||
                        event.key === "PageDown"
                    ) {
                        clearListEditorSuggestion();
                    }
                });
            }

            if (editorFilenameInput) {
                editorFilenameInput.addEventListener("input", function () {
                    renderListEditorHighlight();
                });
            }
            if (editorSuggest && !listSuggestEventsBound) {
                listSuggestEventsBound = true;
                editorSuggest.addEventListener("mousedown", function (event) {
                    event.preventDefault();
                });
                editorSuggest.addEventListener("click", function (event) {
                    const target = event.target instanceof Element
                        ? event.target.closest("[data-suggest-index]")
                        : null;
                    if (!target) {
                        return;
                    }
                    const index = Number(target.getAttribute("data-suggest-index"));
                    if (Number.isInteger(index) && acceptListEditorSuggestion(index)) {
                        event.preventDefault();
                    }
                });
            }
            
            function handleMediaEditorSaved(result, options) {
                const settings = options || {};
                const sourcePath = normalizePath(entry.path || "", true);
                const savedPath = result && typeof result.path === "string" && result.path.trim()
                    ? normalizePath(result.path, true)
                    : "";
                const targetPath = savedPath || sourcePath;
                const previousActivePreviewPath = state.activePreviewPath || "";
                if (settings.openPreview || previousActivePreviewPath === sourcePath) {
                    state.activePreviewPath = targetPath;
                    state.activeRenderedPreviewPath = "";
                }
                applySelection([targetPath], {
                    primaryPath: targetPath,
                    anchorPath: targetPath,
                    render: false,
                });
                syncEntryRowSelectedStates([sourcePath, previousActivePreviewPath, targetPath]);
                if (state.previewCache) {
                    state.previewCache.delete(sourcePath);
                    if (savedPath) {
                        state.previewCache.delete(savedPath);
                    }
                }
                refreshCurrentDirectory({ skipPreview: true })
                    .then(async function () {
                        const savedEntryFromList = state.entryByPath.get(targetPath) || null;
                        const savedEntry = savedEntryFromList || {
                            type: "file",
                            isCurrentFolder: false,
                            can_edit: Boolean(entry && entry.can_edit),
                            path: targetPath,
                            slug_path: targetPath,
                            name: targetPath.split("/").pop() || (entry && entry.name) || "",
                        };

                        if (settings.openPreview) {
                            switchToPreview();
                            if (savedEntryFromList) {
                                applySelection([targetPath], {
                                    primaryPath: targetPath,
                                    anchorPath: targetPath,
                                    skipPreview: true,
                                });
                            } else {
                                setPreviewVisibility(true);
                            }
                            await loadPreviewForEntry(savedEntry);
                            await updatePreviewNavButtons(savedEntry);
                            return;
                        }

                        if (savedPath && state.entryByPath.has(savedPath)) {
                            applySelection([targetPath], {
                                primaryPath: targetPath,
                                anchorPath: targetPath,
                                render: false,
                            });
                        }
                    })
                    .catch(alertError);
            }

            function buildListEditorTargetPath(targetDir, filenameValue, extensionValue) {
                const filename = String(filenameValue || "").trim();
                if (!filename) {
                    return "";
                }
                const extension = String(extensionValue || "").trim();
                const leafName = filename + extension;
                const normalizedDir = normalizePath(targetDir || "", true);
                return normalizePath(normalizedDir ? normalizedDir + "/" + leafName : leafName, true);
            }

            async function getListEditorSaveTargetEntry(targetPath) {
                const normalizedTarget = normalizePath(targetPath || "", true);
                if (!normalizedTarget) {
                    return null;
                }
                const knownEntry = state.entryByPath.get(normalizedTarget);
                if (knownEntry) {
                    return knownEntry;
                }
                const parentPath = getParentDirectory(normalizedTarget);
                try {
                    await loadDirectory(parentPath);
                } catch (error) {
                    return state.entryByPath.get(normalizedTarget) || null;
                }
                return state.entryByPath.get(normalizedTarget) || null;
            }

            async function confirmListEditorOverwriteIfNeeded(sourcePath, targetPath) {
                const normalizedSource = normalizePath(sourcePath || "", true);
                const normalizedTarget = normalizePath(targetPath || "", true);
                if (!normalizedTarget) {
                    return false;
                }
                const targetEntry = await getListEditorSaveTargetEntry(normalizedTarget);
                if (targetEntry && targetEntry.type === "dir") {
                    throw new Error(t("save_overwrite_folder_error", "같은 이름의 폴더가 이미 있어 파일로 덮어쓸 수 없습니다."));
                }
                const willOverwrite = normalizedTarget === normalizedSource || Boolean(targetEntry && targetEntry.type === "file");
                if (!willOverwrite) {
                    return true;
                }
                return requestConfirmDialog({
                    title: t("save_overwrite_confirm_title", "파일 덮어쓰기"),
                    message: t("save_overwrite_confirm_message", "이미 있는 파일을 덮어씁니다. 계속할까요?") + " " + getHandrivePathLabel(normalizedTarget),
                    cancelText: t("cancel", "취소"),
                    confirmText: t("save_overwrite_confirm_button", "덮어쓰기"),
                });
            }

            function resolveListEditorSaveTarget(rawFilename, sourcePath, extensionOverride) {
                const resolved = resolveListEditorFilenameAndExtension(rawFilename, sourcePath);
                const targetDir = getParentDirectory(sourcePath);
                const targetExtension = extensionOverride || resolved.extension;
                return {
                    filename: resolved.filename,
                    extension: targetExtension,
                    targetDir: targetDir,
                    targetPath: buildListEditorTargetPath(targetDir, resolved.filename, targetExtension),
                };
            }

            function getListImageSaveExtensionOverride() {
                if (
                    window.HandriveImageEditor &&
                    typeof window.HandriveImageEditor.getSaveExtensionOverride === "function"
                ) {
                    return String(window.HandriveImageEditor.getSaveExtensionOverride() || "").trim().toLowerCase();
                }
                return "";
            }

            // 저장/취소 버튼 이벤트를 현재 편집 대상(entry)에 바인딩
            editorSaveButton.onclick = function (event) {
                event.preventDefault();
                if (spreadsheetEditorSurface && !spreadsheetEditorSurface.hidden && window.HandriveSpreadsheetEditor) {
                    const csrfToken = getCsrfToken();
                    const savingText = t("spreadsheet_editor_saving", "저장 중...");
                    const origText = editorSaveButton.textContent;
                    const spreadsheetFilename = String(editorFilenameInput ? editorFilenameInput.value || "" : "").trim();
                    if (!spreadsheetFilename) {
                        alertError(new Error(t("js_filename_required", "파일명을 입력해주세요.")));
                        return;
                    }
                    const sourcePath = normalizePath(entry.path, false);
                    let saveTarget;
                    try {
                        saveTarget = resolveListEditorSaveTarget(spreadsheetFilename, sourcePath);
                    } catch (error) {
                        alertError(error);
                        return;
                    }
                    editorSaveButton.disabled = true;
                    editorSaveButton.textContent = savingText;
                    (async function () {
                        const isDirty = typeof window.HandriveSpreadsheetEditor.getIsDirty === "function"
                            ? window.HandriveSpreadsheetEditor.getIsDirty()
                            : true;
                        if (!isDirty && spreadsheetFilename === String(entry.name || "")) {
                            switchToPreview();
                            return null;
                        }
                        const overwriteConfirmed = await confirmListEditorOverwriteIfNeeded(sourcePath, saveTarget.targetPath);
                        if (!overwriteConfirmed) {
                            return null;
                        }
                        let commitMessage = "";
                        if (entry.requires_commit_message) {
                            commitMessage = await promptCommitMessage(entry.path);
                            if (commitMessage === null) {
                                return null;
                            }
                        }
                        setListEditorSaving(true);
                        return window.HandriveSpreadsheetEditor.saveToServer({
                            saveUrl: spreadsheetSaveApiUrl,
                            csrfToken: csrfToken,
                            originalPath: sourcePath,
                            targetDir: saveTarget.targetDir,
                            filename: saveTarget.filename,
                            extension: saveTarget.extension,
                            commitMessage: commitMessage,
                        });
                    })()
                        .then(function (result) {
                            if (result) {
                                handleMediaEditorSaved(result, { openPreview: true });
                            }
                        })
                        .catch(alertError)
                        .finally(function () {
                            setListEditorSaving(false);
                            editorSaveButton.disabled = false;
                            editorSaveButton.textContent = origText;
                    });
                    return;
                }
                if (pdfEditorSurface && !pdfEditorSurface.hidden && window.HandrivePdfEditor) {
                    const csrfToken = getCsrfToken();
                    const savingText = t("pdf_editor_saving", "저장 중...");
                    const origText = editorSaveButton.textContent;
                    const pdfFilename = String(editorFilenameInput ? editorFilenameInput.value || "" : "").trim();
                    if (!pdfFilename) {
                        alertError(new Error(t("js_filename_required", "파일명을 입력해주세요.")));
                        return;
                    }
                    (async function () {
                        if (
                            typeof window.HandrivePdfEditor.getIsDirty === "function" &&
                            !window.HandrivePdfEditor.getIsDirty() &&
                            pdfFilename === String(entry.name || "")
                        ) {
                            switchToPreview();
                            return;
                        }
                        const sourcePath = normalizePath(entry.path, false);
                        const saveTarget = resolveListEditorSaveTarget(pdfFilename, sourcePath);
                        const overwriteConfirmed = await confirmListEditorOverwriteIfNeeded(sourcePath, saveTarget.targetPath);
                        if (!overwriteConfirmed) {
                            return;
                        }
                        editorSaveButton.disabled = true;
                        editorSaveButton.textContent = savingText;
                        setListEditorSaving(true);
                        window.HandrivePdfEditor.saveToServer(
                            pdfEditorSaveUrl,
                            csrfToken,
                            entry.path,
                            function (result) {
                                setListEditorSaving(false);
                                editorSaveButton.disabled = false;
                                editorSaveButton.textContent = origText;
                                if (result && result.ok) {
                                    handleMediaEditorSaved(result, { openPreview: true });
                                } else {
                                    alertError(new Error(selectServerMessage(result, t("pdf_editor_save_error", "PDF 저장 실패"))));
                                }
                            },
                            { filename: pdfFilename }
                        );
                    })().catch(alertError);
                    return;
                }
                // 이미지 에디터 모드 분기
                if (imageEditorSurface && !imageEditorSurface.hidden && window.HandriveImageEditor) {
                    const csrfToken = getCsrfToken();
                    const savingText = t("image_editor_saving", "저장 중...");
                    const origText = editorSaveButton.textContent;
                    const imageFilename = String(editorFilenameInput ? editorFilenameInput.value || "" : "").trim();
                    if (!imageFilename) {
                        alertError(new Error(t("js_filename_required", "파일명을 입력해주세요.")));
                        return;
                    }
                    (async function () {
                        if (
                            typeof window.HandriveImageEditor.getIsDirty === "function" &&
                            !window.HandriveImageEditor.getIsDirty() &&
                            imageFilename === String(entry.name || "")
                        ) {
                            switchToPreview();
                            return;
                        }
                        const sourcePath = normalizePath(entry.path, false);
                        const saveTarget = resolveListEditorSaveTarget(imageFilename, sourcePath, getListImageSaveExtensionOverride());
                        const overwriteConfirmed = await confirmListEditorOverwriteIfNeeded(sourcePath, saveTarget.targetPath);
                        if (!overwriteConfirmed) {
                            return;
                        }
                        editorSaveButton.disabled = true;
                        editorSaveButton.textContent = savingText;
                        setListEditorSaving(true);
                        window.HandriveImageEditor.saveToServer(
                            imageEditorSaveUrl,
                            csrfToken,
                            entry.path,
                            function (result) {
                                setListEditorSaving(false);
                                editorSaveButton.disabled = false;
                                editorSaveButton.textContent = origText;
                                if (result.ok) {
                                    handleMediaEditorSaved(result, { openPreview: true });
                                } else {
                                    alertError(new Error(selectServerMessage(result, t("image_editor_save_error", "저장 실패"))));
                                }
                            },
                            { filename: imageFilename }
                        );
                    })().catch(alertError);
                    return;
                }
                if (videoEditorSurface && !videoEditorSurface.hidden && window.HandriveVideoEditor) {
                    const csrfToken = getCsrfToken();
                    const savingText = t("video_editor_saving", "저장 중...");
                    const origText = editorSaveButton.textContent;
                    const videoFilename = String(editorFilenameInput ? editorFilenameInput.value || "" : "").trim();
                    if (!videoFilename) {
                        alertError(new Error(t("js_filename_required", "파일명을 입력해주세요.")));
                        return;
                    }
                    (async function () {
                        if (
                            typeof window.HandriveVideoEditor.getIsDirty === "function" &&
                            !window.HandriveVideoEditor.getIsDirty() &&
                            videoFilename === String(entry.name || "")
                        ) {
                            switchToPreview();
                            return;
                        }
                        const sourcePath = normalizePath(entry.path, false);
                        const saveTarget = resolveListEditorSaveTarget(videoFilename, sourcePath);
                        const overwriteConfirmed = await confirmListEditorOverwriteIfNeeded(sourcePath, saveTarget.targetPath);
                        if (!overwriteConfirmed) {
                            return;
                        }
                        editorSaveButton.disabled = true;
                        editorSaveButton.textContent = savingText;
                        setListEditorSaving(true);
                        window.HandriveVideoEditor.saveToServer(
                            videoEditorSaveUrl,
                            csrfToken,
                            entry.path,
                            function (result) {
                                setListEditorSaving(false);
                                editorSaveButton.disabled = false;
                                editorSaveButton.textContent = origText;
                                if (result && result.ok) {
                                    handleMediaEditorSaved(result);
                                } else {
                                    alertError(new Error(selectServerMessage(result, t("video_editor_save_error", "비디오 저장 실패"))));
                                }
                            },
                            { filename: videoFilename }
                        );
                    })().catch(alertError);
                    return;
                }
                if (audioEditorSurface && !audioEditorSurface.hidden && window.HandriveAudioEditor) {
                    const csrfToken = getCsrfToken();
                    const savingText = t("audio_editor_saving", "저장 중...");
                    const origText = editorSaveButton.textContent;
                    const audioFilename = String(editorFilenameInput ? editorFilenameInput.value || "" : "").trim();
                    if (!audioFilename) {
                        alertError(new Error(t("js_filename_required", "파일명을 입력해주세요.")));
                        return;
                    }
                    (async function () {
                        if (
                            typeof window.HandriveAudioEditor.getIsDirty === "function" &&
                            !window.HandriveAudioEditor.getIsDirty() &&
                            audioFilename === String(entry.name || "")
                        ) {
                            switchToPreview();
                            return;
                        }
                        const sourcePath = normalizePath(entry.path, false);
                        const saveTarget = resolveListEditorSaveTarget(audioFilename, sourcePath);
                        const overwriteConfirmed = await confirmListEditorOverwriteIfNeeded(sourcePath, saveTarget.targetPath);
                        if (!overwriteConfirmed) {
                            return;
                        }
                        editorSaveButton.disabled = true;
                        editorSaveButton.textContent = savingText;
                        setListEditorSaving(true);
                        window.HandriveAudioEditor.saveToServer(
                            audioEditorSaveUrl,
                            csrfToken,
                            entry.path,
                            function (result) {
                                setListEditorSaving(false);
                                editorSaveButton.disabled = false;
                                editorSaveButton.textContent = origText;
                                if (result && result.ok) {
                                    handleMediaEditorSaved(result);
                                } else {
                                    alertError(new Error(selectServerMessage(result, t("audio_editor_save_error", "오디오 저장 실패"))));
                                }
                            },
                            { filename: audioFilename }
                        );
                    })().catch(alertError);
                    return;
                }
                saveEditorContent(entry).catch(alertError);
            };
            editorCancelButton.onclick = function (event) {
                event.preventDefault();
                if (imageEditorSurface && !imageEditorSurface.hidden && window.HandriveImageEditor) {
                    if (window.HandriveImageEditor.getIsDirty()) {
                        if (!window.confirm(t("image_editor_unsaved_warning", "저장되지 않은 변경 사항이 있습니다. 계속하시겠습니까?"))) {
                            return;
                        }
                    }
                }
                if (videoEditorSurface && !videoEditorSurface.hidden && window.HandriveVideoEditor) {
                    if (window.HandriveVideoEditor.getIsDirty()) {
                        if (!window.confirm(t("image_editor_unsaved_warning", "저장되지 않은 변경 사항이 있습니다. 계속하시겠습니까?"))) {
                            return;
                        }
                    }
                }
                if (audioEditorSurface && !audioEditorSurface.hidden && window.HandriveAudioEditor) {
                    if (window.HandriveAudioEditor.getIsDirty()) {
                        if (!window.confirm(t("image_editor_unsaved_warning", "저장되지 않은 변경 사항이 있습니다. 계속하시겠습니까?"))) {
                            return;
                        }
                    }
                }
                if (pdfEditorSurface && !pdfEditorSurface.hidden && window.HandrivePdfEditor) {
                    if (window.HandrivePdfEditor.getIsDirty()) {
                        if (!window.confirm(t("image_editor_unsaved_warning", "저장되지 않은 변경 사항이 있습니다. 계속하시겠습니까?"))) {
                            return;
                        }
                    }
                }
                if (spreadsheetEditorSurface && !spreadsheetEditorSurface.hidden && window.HandriveSpreadsheetEditor) {
                    if (window.HandriveSpreadsheetEditor.getIsDirty()) {
                        if (!window.confirm(t("image_editor_unsaved_warning", "저장되지 않은 변경 사항이 있습니다. 계속하시겠습니까?"))) {
                            return;
                        }
                    }
                }
                cleanupListMarkdownUploadedImages(entry)
                    .catch(alertError)
                    .finally(function () {
                        switchToPreview();
                    });
            };
        }

        function cleanupEditorEvents() {
            clearListEditorSuggestion();
            if (editorSaveButton) {
                editorSaveButton.onclick = null;
            }
            if (editorCancelButton) {
                editorCancelButton.onclick = null;
            }
        }

        // 입력된 파일명(확장자 포함 가능)을 API 저장 형식(filename + extension)으로 분리
        function resolveListEditorFilenameAndExtension(rawFilename, sourcePath) {
            return editorResolveFilenameAndExtension(rawFilename, sourcePath, t);
        }

        function setListEditorSaving(isSaving) {
            if (!editorPanel) {
                return;
            }
            editorPanel.classList.toggle("is-saving", isSaving);
            editorPanel.setAttribute("aria-busy", isSaving ? "true" : "false");
            if (editorSavingOverlay) {
                editorSavingOverlay.hidden = !isSaving;
            }
            [editorFilenameInput, editorContentInput, editorCancelButton].forEach(function (control) {
                if (control) {
                    control.disabled = isSaving;
                }
            });
            if (spreadsheetEditorSurface && !spreadsheetEditorSurface.hidden && window.HandriveSpreadsheetEditor) {
                window.HandriveSpreadsheetEditor.setDisabled(isSaving);
            }
            if (pdfEditorSurface && !pdfEditorSurface.hidden && window.HandrivePdfEditor) {
                window.HandrivePdfEditor.setDisabled(isSaving);
            }
        }

        async function saveEditorContent(entry) {
            if (!editorContentInput || !editorFilenameInput) {
                return;
            }

            if (!saveApiUrl) {
                throw new Error(t("js_error_request_failed", "요청 처리 중 오류가 발생했습니다."));
            }

            const content = editorContentInput.value;
            const resolved = resolveListEditorFilenameAndExtension(editorFilenameInput.value, entry.path);
            const sourcePath = normalizePath(entry.path, false);
            const targetDir = getParentDirectory(sourcePath);
            const targetPath = buildListEditorTargetPath(targetDir, resolved.filename, resolved.extension);
            let editorSavingShown = false;

            // 중복 저장 방지를 위해 저장 중 버튼 비활성화
            if (editorSaveButton) {
                editorSaveButton.disabled = true;
            }
            try {
                // 쓰기 화면 저장 버튼과 동일한 handrive_api_save payload로 저장
                const payload = {
                    original_path: sourcePath,
                    target_dir: targetDir,
                    filename: resolved.filename,
                    extension: resolved.extension,
                    content: content,
                };
                const overwriteConfirmed = await confirmListEditorOverwriteIfNeeded(sourcePath, targetPath);
                if (!overwriteConfirmed) {
                    return;
                }
                if (entry && entry.requires_commit_message) {
                    const commitMessage = await promptCommitMessage(sourcePath);
                    if (commitMessage === null) {
                        return;
                    }
                    payload.commit_message = commitMessage;
                }
                setListEditorSaving(true);
                editorSavingShown = true;
                const data = await requestJson(saveApiUrl, buildPostOptions(payload));
                listMarkdownUploadedImagePaths = [];

                // 저장 후에는 취소 버튼 동작처럼 편집기를 닫고, 해당 파일 미리보기를 다시 연다.
                const savedPath = data && typeof data.path === "string" && data.path.trim()
                    ? normalizePath(data.path, true)
                    : sourcePath;
                // 저장 직후에는 캐시를 무효화해 미리보기가 항상 최신 내용을 다시 불러오도록 한다.
                state.previewCache.delete(sourcePath);
                state.previewCache.delete(savedPath);
                await refreshCurrentDirectory({ skipPreview: true });
                switchToPreview();

                const savedEntryFromList = state.entryByPath.get(savedPath) || null;
                const savedEntry = savedEntryFromList || {
                    type: "file",
                    isCurrentFolder: false,
                    can_edit: Boolean(entry && entry.can_edit),
                    path: savedPath,
                    name: savedPath.split("/").pop() || (entry && entry.name) || "",
                };
                const previousActivePreviewPath = state.activePreviewPath || "";
                state.activePreviewPath = savedPath;
                state.activeRenderedPreviewPath = "";
                syncEntryRowSelectedStates([sourcePath, previousActivePreviewPath, savedPath]);

                if (savedEntryFromList) {
                    applySelection([savedPath], {
                        primaryPath: savedPath,
                        anchorPath: savedPath,
                    });
                } else {
                    setPreviewVisibility(true);
                }

                await loadPreviewForEntry(savedEntry);
                await updatePreviewNavButtons(savedEntry);
            } finally {
                if (editorSavingShown) {
                    setListEditorSaving(false);
                }
                if (editorSaveButton) {
                    editorSaveButton.disabled = false;
                }
            }
        }

        async function cleanupListMarkdownUploadedImages(entry) {
            if (!markdownImageCleanupApiUrl || !listMarkdownUploadedImagePaths.length) {
                return;
            }
            const sourcePath = entry && entry.path ? normalizePath(entry.path, true) : "";
            const targetDir = getParentPath(sourcePath) || state.currentDir || "";
            const imagePaths = Array.from(new Set(listMarkdownUploadedImagePaths));
            listMarkdownUploadedImagePaths = [];
            await requestJson(
                markdownImageCleanupApiUrl,
                buildPostOptions({
                    markdown_path: sourcePath,
                    target_dir: targetDir,
                    image_paths: imagePaths,
                })
            );
        }

        async function updatePreviewNavButtons(entry) {
            if (!previewNavPrevBtn || !previewNavNextBtn) return;
            if (!entry || !isMediaNavEntry(entry)) {
                previewNavPrevBtn.hidden = true;
                previewNavNextBtn.hidden = true;
                if (previewNavBgPrev) previewNavBgPrev.hidden = true;
                if (previewNavBgNext) previewNavBgNext.hidden = true;
                setPreviewNavBackgroundVisible(false);
                previewNavPrevBtn._navTarget = null;
                previewNavNextBtn._navTarget = null;
                return;
            }
            const siblingDir = getParentPath(entry.path) || state.currentDir;
            const normalizedSiblingDir = normalizePath(siblingDir, true);
            let siblings = getVisibleSiblingMediaEntries(normalizedSiblingDir);
            if (!siblings.length && normalizedSiblingDir && normalizedSiblingDir !== state.currentDir) {
                try {
                    await loadDirectory(normalizedSiblingDir);
                    siblings = getVisibleSiblingMediaEntries(normalizedSiblingDir);
                } catch (error) {}
            }
            if (!siblings.length) {
                previewNavPrevBtn.hidden = true;
                previewNavNextBtn.hidden = true;
                if (previewNavBgPrev) previewNavBgPrev.hidden = true;
                if (previewNavBgNext) previewNavBgNext.hidden = true;
                setPreviewNavBackgroundVisible(false);
                previewNavPrevBtn._navTarget = null;
                previewNavNextBtn._navTarget = null;
                return;
            }
            const currentPath = normalizePath(entry.path, true);
            const idx = siblings.findIndex(function (e) {
                return normalizePath(e.path, true) === currentPath;
            });
            const prevEntry = idx > 0 ? siblings[idx - 1] : null;
            const nextEntry = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
            previewNavPrevBtn.hidden = !prevEntry;
            previewNavNextBtn.hidden = !nextEntry;
            if (previewNavBgPrev) previewNavBgPrev.hidden = !prevEntry;
            if (previewNavBgNext) previewNavBgNext.hidden = !nextEntry;
            previewNavPrevBtn._navTarget = prevEntry;
            previewNavNextBtn._navTarget = nextEntry;
            setPreviewNavBackgroundVisible(Boolean(prevEntry || nextEntry));
            if (prevEntry) {
                previewNavPrevBtn.classList.remove("is-revealing");
                void previewNavPrevBtn.offsetWidth;
                previewNavPrevBtn.classList.add("is-revealing");
                window.setTimeout(function () {
                    previewNavPrevBtn.classList.remove("is-revealing");
                }, 180);
            }
            if (nextEntry) {
                previewNavNextBtn.classList.remove("is-revealing");
                void previewNavNextBtn.offsetWidth;
                previewNavNextBtn.classList.add("is-revealing");
                window.setTimeout(function () {
                    previewNavNextBtn.classList.remove("is-revealing");
                }, 180);
            }
        }

        function navigateToPreviewEntry(entry) {
            if (!entry) return;
            const previousActivePreviewPath = state.activePreviewPath;
            applySelection([entry.path], {
                primaryPath: entry.path,
                anchorPath: entry.path,
                skipPreview: true,
            });
            state.activePreviewPath = normalizePath(entry.path, true);
            syncEntryRowSelectedStates([previousActivePreviewPath, entry.path]);
            loadPreviewForEntry(entry)
                .then(function () { return updatePreviewNavButtons(entry); })
                .catch(alertError);
        }

        function setPreviewNavBackgroundVisible(visible) {
            if (!previewNavBg) return;
            previewNavBg.hidden = !visible;
            previewNavBg.classList.toggle("is-visible", Boolean(visible));
        }

        if (previewNavPrevBtn) {
            previewNavPrevBtn.addEventListener("click", function () {
                navigateToPreviewEntry(previewNavPrevBtn._navTarget);
            });
        }
        if (previewNavNextBtn) {
            previewNavNextBtn.addEventListener("click", function () {
                navigateToPreviewEntry(previewNavNextBtn._navTarget);
            });
        }

        function clearPreviewPane() {
            const previousActivePreviewPath = state.activePreviewPath;
            setPreviewBodyLoading(false);
            state.activePreviewPath = "";
            state.activeRenderedPreviewPath = "";
            state.activePreviewRenderMode = "";
            state.previewRequestToken += 1;
            if (state.previewAbortController && typeof state.previewAbortController.abort === "function") {
                try {
                    state.previewAbortController.abort();
                } catch (error) {
                    // ignore stale preview request cleanup failures
                }
            }
            state.previewAbortController = null;
            state.previewImageZoom = 1;
            syncEntryRowSelectedStates([previousActivePreviewPath]);
            setPreviewVisibility(false);
            if (previewNavBgPrev) previewNavBgPrev.hidden = true;
            if (previewNavBgNext) previewNavBgNext.hidden = true;
            setPreviewNavBackgroundVisible(false);
            
            // 편집기가 열려있으면 닫기
            if (editorPanel && !editorPanel.hidden) {
                switchToPreview();
            }
            
            if (previewTitle) {
                const previewTitleText = previewTitle.querySelector(".handrive-list-preview-title-text") || previewTitle;
                previewTitleText.textContent = t("list_preview_title", "파일 미리보기");
            }
            setPreviewActionTargets(null);
            applyRenderedContentModeClass(previewContent, "plain_text", "handrive-plain-text");
            setPreviewPlaceholder(
                t("list_preview_empty", "파일을 선택하면 미리보기가 표시됩니다.")
            );
            syncPreviewImageZoom();
            void updatePreviewNavButtons(null);
        }

        function closePreviewPaneIfOpen() {
            if (!previewPanel || previewPanel.hidden) {
                return false;
            }
            clearPreviewPane();
            return true;
        }

        function getPreviewImageMinZoom() {
            return previewGetImageMinZoom(previewContent);
        }

        function syncPreviewImageZoom() {
            previewSyncImageZoom(previewContent, previewZoomWrap, state.previewImageZoom);
        }

        function setPreviewImageZoom(nextZoom) {
            const minZoom = getPreviewImageMinZoom();
            state.previewImageZoom = Math.max(minZoom, Math.min(3, Number(nextZoom) || 1));
            syncPreviewImageZoom();
        }

        function releasePreviewBodyHeightAfterNextPaint() {
            window.requestAnimationFrame(function () {
                window.requestAnimationFrame(function () {
                    releasePreviewBodyHeightAfterPortraitLoading();
                });
            });
        }

        function releasePreviewBodyHeightWhenRendered(renderMode) {
            const normalizedRenderMode = String(renderMode || "");
            if (normalizedRenderMode !== "media_image") {
                releasePreviewBodyHeightAfterNextPaint();
                return;
            }

            const imageElement = previewGetImageElement(previewContent);
            if (!imageElement) {
                releasePreviewBodyHeightAfterNextPaint();
                return;
            }

            let released = false;
            const releaseOnce = function () {
                if (released) {
                    return;
                }
                released = true;
                imageElement.removeEventListener("load", releaseOnce);
                imageElement.removeEventListener("error", releaseOnce);
                releasePreviewBodyHeightAfterNextPaint();
            };

            if (imageElement.complete) {
                if (
                    imageElement.naturalWidth > 0 &&
                    typeof imageElement.decode === "function"
                ) {
                    imageElement.decode().then(releaseOnce, releaseOnce);
                    return;
                }
                releaseOnce();
                return;
            }

            imageElement.addEventListener("load", releaseOnce);
            imageElement.addEventListener("error", releaseOnce);
        }

        function renderPreviewHtml(entry, html, renderMode, renderClass) {
            setPreviewBodyLoading(false);
            renderPreviewHtmlFlow({
                applyHandriveCodeHighlighting: applyHandriveCodeHighlighting,
                applyRenderedContentModeClass: applyRenderedContentModeClass,
                entry: entry,
                html: html,
                hydrateMediaAudioElements: hydrateMediaAudioElements,
                previewContent: previewContent,
                previewGetImageElement: previewGetImageElement,
                previewZoomWrap: previewZoomWrap,
                renderClass: renderClass,
                renderMode: renderMode,
                scheduleSyncCurrentDirRowHeightWithSideHead: scheduleSyncCurrentDirRowHeightWithSideHead,
                setPreviewActionTargets: setPreviewActionTargets,
                setPreviewPlaceholder: setPreviewPlaceholder,
                state: state,
                syncPreviewImageZoom: syncPreviewImageZoom,
                t: t,
            });
            if (window.HandriveSpreadsheetEditor && typeof window.HandriveSpreadsheetEditor.hydratePreviews === "function") {
                window.HandriveSpreadsheetEditor.hydratePreviews(previewContent);
            }
            renderHandriveMermaidDiagrams(previewContent)
                .then(scheduleSyncCurrentDirRowHeightWithSideHead)
                .catch(alertError);
            bindHandrivePdfFrameLoading(previewContent);
            initializePreviewVideoPlayers(previewContent).catch(alertError);
            releasePreviewBodyHeightWhenRendered(renderMode);
        }

        async function loadPreviewForEntry(entry) {
            await loadPreviewEntryFlow({
                buildPostOptions: buildPostOptions,
                beforePreviewContentReplace: function () {
                    return releasePreviewVideoPlayers(previewContent);
                },
                clearPreviewPane: clearPreviewPane,
                editorPanel: editorPanel,
                entry: entry,
                isPreviewableFileEntry: isPreviewableFileEntry,
                normalizePath: normalizePath,
                previewApiUrl: appendSharedQuery(previewApiUrl),
                previewContent: previewContent,
                previewPanel: previewPanel,
                previewTitle: previewTitle,
                renderPreviewHtml: renderPreviewHtml,
                requestJson: requestJson,
                scrollPreviewIntoViewIfPortrait: scrollPreviewIntoViewIfPortrait,
                setPreviewActionTargets: setPreviewActionTargets,
                setPreviewLoading: setPreviewLoading,
                setPreviewPlaceholder: setPreviewPlaceholder,
                setPreviewVisibility: setPreviewVisibility,
                state: state,
                switchToPreview: switchToPreview,
                t: t,
            });
        }

        function syncPreviewFromSelection() {
            if (!previewPanel) {
                return;
            }
            const selectedEntries = getSelectedEntries();
            if (selectedEntries.length !== 1) {
                clearPreviewPane();
                return;
            }
            const entry = selectedEntries[0];
            if (!isPreviewableFileEntry(entry)) {
                // 폴더 등 미리보기 불가 항목 선택 시 현재 미리보기 유지
                return;
            }
            const entryPath = normalizePath(entry.path, true);
            if (entryPath === state.activePreviewPath) {
                // 현재 미리보기 중인 파일을 다시 선택하면 토글(닫기)
                clearPreviewPane();
                return;
            }
            // 새 파일로 전환 시 이전/현재 row 상태만 갱신해서 큰 목록 전체를 다시 그리지 않는다.
            const previousActivePreviewPath = state.activePreviewPath;
            state.activePreviewPath = entryPath;
            syncEntryRowSelectedStates([previousActivePreviewPath, entryPath]);
            loadPreviewForEntry(entry)
                .then(function () { return updatePreviewNavButtons(entry); })
                .catch(alertError);
        }

        function syncContextMenuByEntries(entries) {
            const visibility = computeContextMenuVisibility(entries, {
                canCreateArchiveFromEntries: canCreateArchiveFromEntries,
                isEntryDeletable: isEntryDeletable,
                isEditableHandriveFileEntry: isEditableHandriveFileEntry,
            });
            setContextButtonVisible(contextOpenButton, Boolean(visibility.open));
            setContextButtonVisible(contextDownloadButton, Boolean(visibility.download));
            setContextButtonVisible(contextExtractArchiveButton, Boolean(visibility.extractArchive && archiveExtractApiUrl));
            setContextButtonVisible(contextShareButton, Boolean(visibility.share && urlShareApiUrl));
            setContextButtonVisible(contextUploadButton, Boolean(visibility.upload));
            setContextButtonVisible(contextCreateArchiveButton, Boolean(visibility.createArchive && archiveCreateApiUrl));
            setContextButtonVisible(contextEditButton, Boolean(visibility.edit));
            setContextButtonVisible(contextRenameButton, Boolean(visibility.rename));
            setContextButtonVisible(contextDeleteButton, Boolean(visibility.deleteEntry));
            setContextButtonVisible(contextNewFolderButton, Boolean(visibility.newFolder));
            setContextButtonVisible(contextNewDocButton, Boolean(visibility.newDoc));
            setContextButtonVisible(contextGitCreateRepoButton, Boolean(visibility.gitCreateRepo));
            setContextButtonVisible(contextGitManageRepoButton, Boolean(visibility.gitManageRepo));
            setContextButtonVisible(contextGitDeleteRepoButton, Boolean(visibility.gitDeleteRepo));
            setContextButtonVisible(contextGitCreateBranchButton, Boolean(visibility.gitCreateBranch));
            setContextButtonVisible(contextGitDeleteBranchButton, Boolean(visibility.gitDeleteBranch));
            setContextButtonVisible(contextCreateMapButton, Boolean(visibility.createMap));
            setContextButtonVisible(contextConvertMp3Button, Boolean(visibility.convertMp3 && convertMp3ApiUrl));
            setContextButtonVisible(contextChangeIconButton, Boolean(visibility.changeIcon && folderIconUploadApiUrl));
            setContextButtonVisible(contextGoogleDriveAddItemsButton, Boolean(visibility.googleDriveAddItems));
            syncContextMenuDividers(contextMenu);
        }

        function resolveContextEntries(entry) {
            if (!entry) {
                return [];
            }
            if (state.selectedPaths.size > 1 && state.selectedPaths.has(entry.path)) {
                return getSelectedEntries();
            }
            return [entry];
        }

        function syncEntryRowSelectedStates(pathValues) {
            const pathsToSync = new Set();
            const addPath = function (pathValue) {
                try {
                    pathsToSync.add(normalizePath(pathValue, true));
                } catch (error) {}
            };
            (Array.isArray(pathValues) ? pathValues : []).forEach(addPath);
            state.selectedPaths.forEach(addPath);
            addPath(state.selectedPath);
            addPath(state.activePreviewPath);

            pathsToSync.forEach(function (pathValue) {
                const row = state.entryRowByPath.get(pathValue);
                if (!row) {
                    return;
                }
                row.classList.toggle(
                    "is-selected",
                    state.selectedPaths.has(pathValue) || pathValue === state.activePreviewPath
                );
            });
        }

        function applySelection(pathValues, options) {
            const settings = options || {};
            const previousSelectedPaths = Array.from(state.selectedPaths || []);
            const previousSelectedPath = state.selectedPath || "";
            const nextSelectedPaths = new Set();
            (Array.isArray(pathValues) ? pathValues : []).forEach(function (pathValue) {
                try {
                    nextSelectedPaths.add(normalizePath(pathValue, true));
                } catch (error) {}
            });

            state.selectedPaths = nextSelectedPaths;
            if (nextSelectedPaths.size === 0) {
                state.selectedPath = "";
                if (!settings.keepAnchor) {
                    state.selectionAnchorPath = "";
                }
            } else {
                const normalizedPrimaryPath = normalizePath(
                    settings.primaryPath !== undefined ? settings.primaryPath : Array.from(nextSelectedPaths)[0],
                    true
                );
                state.selectedPath = nextSelectedPaths.has(normalizedPrimaryPath)
                    ? normalizedPrimaryPath
                    : Array.from(nextSelectedPaths)[0];

                const normalizedAnchorPath = normalizePath(
                    settings.anchorPath !== undefined ? settings.anchorPath : state.selectedPath,
                    true
                );
                if (!settings.keepAnchor) {
                    state.selectionAnchorPath = normalizedAnchorPath;
                } else if (
                    !state.selectionAnchorPath ||
                    !nextSelectedPaths.has(state.selectionAnchorPath)
                ) {
                    state.selectionAnchorPath = state.selectedPath;
                }
            }

            if (settings.render === false) {
                syncEntryRowSelectedStates(previousSelectedPaths.concat([previousSelectedPath]));
                updatePathCurrentSize();
                return;
            }
            renderPathBreadcrumbs(state.selectedPath || state.currentDir);
            syncEntryRowSelectedStates(previousSelectedPaths.concat([previousSelectedPath]));
            updatePathCurrentSize();
            if (!settings.skipPreview) {
                syncPreviewFromSelection();
            }
        }

        function updatePathCurrentSize() {
            if (!pathCurrentSizeEl) {
                return;
            }
            if (state.selectedPaths.size === 1) {
                const entry = state.entryByPath.get(state.selectedPath);
                if (entry) {
                    pathCurrentSizeEl.textContent = entry.size_display || "";
                    return;
                }
            }
            pathCurrentSizeEl.textContent = getCurrentDirMeta().size_display || originalDirSizeText;
        }

        function getSelectionRangeTo(entryPath) {
            const anchorPath = state.selectionAnchorPath;
            if (!anchorPath) {
                return [entryPath];
            }
            const startIndex = state.visibleEntryPaths.indexOf(anchorPath);
            const endIndex = state.visibleEntryPaths.indexOf(entryPath);
            if (startIndex < 0 || endIndex < 0) {
                return [entryPath];
            }
            const from = Math.min(startIndex, endIndex);
            const to = Math.max(startIndex, endIndex);
            return state.visibleEntryPaths.slice(from, to + 1);
        }

        function selectEntry(entryPath, options) {
            applySelection([entryPath || ""], options);
        }

        function selectEntriesByRowClick(entry, event) {
            if (!entry) {
                return;
            }
            const entryPath = normalizePath(entry.path, true);
            const hasToggleModifier = Boolean(event && (event.metaKey || event.ctrlKey));
            const hasRangeModifier = Boolean(event && event.shiftKey);

            if (hasRangeModifier) {
                const rangePaths = getSelectionRangeTo(entryPath);
                if (hasToggleModifier) {
                    const merged = new Set(state.selectedPaths);
                    rangePaths.forEach(function (pathValue) {
                        merged.add(pathValue);
                    });
                    applySelection(Array.from(merged), {
                        primaryPath: entryPath,
                        anchorPath: state.selectionAnchorPath || entryPath,
                    });
                    return;
                }
                applySelection(rangePaths, {
                    primaryPath: entryPath,
                    anchorPath: state.selectionAnchorPath || entryPath,
                });
                return;
            }

            if (hasToggleModifier) {
                const nextSelected = new Set(state.selectedPaths);
                if (nextSelected.has(entryPath)) {
                    nextSelected.delete(entryPath);
                } else {
                    nextSelected.add(entryPath);
                }
                applySelection(Array.from(nextSelected), {
                    primaryPath: entryPath,
                    anchorPath: entryPath,
                });
                return;
            }

            applySelection([entryPath], {
                primaryPath: entryPath,
                anchorPath: entryPath,
            });
        }

        function openContextMenuAt(entry, x, y) {
            if (!contextMenu) {
                return;
            }
            const contextEntries = resolveContextEntries(entry);
            if (contextEntries.length === 0) {
                closeContextMenu();
                return;
            }
            state.contextTarget = contextEntries[0];
            state.contextEntries = contextEntries;
            syncContextMenuByEntries(contextEntries);

            const hasVisibleAction = hasVisibleContextMenuAction(contextMenu);
            if (!hasVisibleAction) {
                closeContextMenu();
                return;
            }

            contextMenu.hidden = false;
            contextMenu.style.left = "0px";
            contextMenu.style.top = "0px";

            const rect = contextMenu.getBoundingClientRect();
            const viewportPadding = 8;
            const maxLeft = Math.max(viewportPadding, window.innerWidth - rect.width - viewportPadding);
            const minTop = viewportPadding;
            const maxTop = Math.max(minTop, window.innerHeight - rect.height - viewportPadding);

            let left = Math.min(Math.max(viewportPadding, x), maxLeft);
            let top = Math.max(minTop, y);

            if (y + rect.height + viewportPadding > window.innerHeight) {
                const overflowBottom = y + rect.height + viewportPadding - window.innerHeight;
                top = y - overflowBottom - 10;
            }

            top = Math.min(Math.max(minTop, top), maxTop);

            contextMenu.style.left = String(left) + "px";
            contextMenu.style.top = String(top) + "px";
        }

        function buildBreadcrumbItems(pathValue) {
            const normalizedPath = normalizePath(pathValue, true);
            const archiveCrumbs = buildArchiveBreadcrumbItems(normalizedPath);
            if (archiveCrumbs) {
                return applyVirtualBreadcrumbLabels(archiveCrumbs);
            }
            const sharedCrumbs = buildSharedBreadcrumbItemsForPath(normalizedPath);
            if (sharedCrumbs) {
                return applyVirtualBreadcrumbLabels(sharedCrumbs);
            }
            return applyVirtualBreadcrumbLabels(buildNavigationBreadcrumbItems(pathValue, {
                effectiveRootLabel: effectiveRootLabel,
                isSuperuser: isSuperuser,
                normalizePath: normalizePath,
                scopedHomeDir: scopedHomeDir,
            }));
        }

        function renderPathBreadcrumbs(pathValue) {
            renderNavigationBreadcrumbs(pathValue, {
                bindHandrivePathDropTargets: bindHandrivePathDropTargets,
                buildBreadcrumbItems: buildBreadcrumbItems,
                buildListUrl: buildListUrl,
                documentRef: document,
                effectiveRootLabel: effectiveRootLabel,
                handriveBaseUrl: handriveBaseUrl,
                handriveRootUrl: handriveRootUrl,
                isSuperuser: isSuperuser,
                pathBreadcrumbs: pathBreadcrumbs,
                scopedHomeDir: scopedHomeDir,
            });
        }

        function getCachedEntries(dirPath) {
            return getCachedDirectoryEntries(dirPath, state);
        }

        async function loadDirectory(dirPath) {
            const entries = await loadDirectoryEntries(dirPath, {
                getCachedEntries: getCachedEntries,
                listApiUrl: appendSharedQuery(listApiUrl),
                normalizePath: normalizePath,
                requestJson: requestJson,
                state: state,
            });
            registerGithubRepoLabelsFromEntries(entries);
            registerGithubRepoLabelFromMeta(state.directoryMetaCache.get(normalizePath(dirPath, true)));
            registerGoogleDriveLabelsFromEntries(entries);
            registerGoogleDriveLabelFromMeta(state.directoryMetaCache.get(normalizePath(dirPath, true)));
            return entries;
        }

        const entryRowLoadingCounts = new WeakMap();

        function startEntryRowLoading(entryOrPath, options) {
            const settings = options || {};
            const row = settings.row || state.entryRowByPath.get(
                normalizePath(
                    typeof entryOrPath === "string"
                        ? entryOrPath
                        : (entryOrPath && entryOrPath.path) || "",
                    true
                )
            );
            if (!row) {
                return null;
            }
            const nextCount = (entryRowLoadingCounts.get(row) || 0) + 1;
            entryRowLoadingCounts.set(row, nextCount);
            if (nextCount === 1) {
                row.classList.add("is-row-loading");
                row.setAttribute("aria-busy", "true");
            }

            return function stopEntryRowLoading() {
                const nextCount = Math.max(0, (entryRowLoadingCounts.get(row) || 1) - 1);
                if (nextCount > 0) {
                    entryRowLoadingCounts.set(row, nextCount);
                    return;
                }
                entryRowLoadingCounts.delete(row);
                row.classList.remove("is-row-loading");
                row.removeAttribute("aria-busy");
            };
        }

        async function withEntryRowLoading(entryOrPath, task, options) {
            const stopLoading = startEntryRowLoading(entryOrPath, options);
            try {
                return await task();
            } finally {
                if (typeof stopLoading === "function") {
                    stopLoading();
                }
            }
        }

        function syncCurrentDirectoryMetaFromCache(dirPath) {
            const normalizedDirPath = normalizePath(dirPath, true);
            const cachedMeta = state.directoryMetaCache.get(normalizedDirPath);
            if (cachedMeta) {
                applyCurrentDirectoryMeta(cachedMeta);
                registerGithubRepoLabelFromMeta(cachedMeta);
                registerGoogleDriveLabelFromMeta(cachedMeta);
            }
        }

        async function refreshCurrentDirectory(options) {
            const settings = options || {};
            await refreshDirectoryEntries({
                currentDir: state.currentDir,
                listApiUrl: appendSharedQuery(listApiUrl),
                loadDirectory: loadDirectory,
                normalizePath: normalizePath,
                renderList: settings.skipPreview
                    ? function () { renderList({ skipPreview: true }); }
                    : renderList,
                requestJson: requestJson,
                state: state,
            });
            syncCurrentDirectoryMetaFromCache(state.currentDir);
            renderPathBreadcrumbs(state.currentDir);
            updatePathCurrentSize();
        }

        function resetDirectoryScopedUi() {
            state.selectedPath = "";
            state.selectedPaths = new Set();
            state.selectionAnchorPath = "";
            state.contextTarget = null;
            state.contextEntries = [];
            state.expandedFolders = new Set();
            state.openingFolderPath = "";
            state.activePreviewPath = "";
            state.activeRenderedPreviewPath = "";
            state.searchQuery = "";
            state.searchResults = null;
            state.searchGeneration += 1;
            syncSearchInputValues("", null);
            closeContextMenu();
            clearPreviewPane();
        }

        function updateDirectoryHistory(dirPath, mode) {
            const historyMode = mode || "push";
            const normalizedDirPath = normalizePath(dirPath, true);
            const targetUrl = (hasSharedContext() && sharedRootPath && normalizedDirPath === sharedRootPath)
                ? handriveRootUrl
                : buildListUrl(handriveBaseUrl, normalizedDirPath, handriveRootUrl);
            const historyState = {
                handriveListDir: normalizedDirPath,
            };
            if (historyMode === "replace") {
                window.history.replaceState(historyState, "", targetUrl);
                return;
            }
            window.history.pushState(historyState, "", targetUrl);
        }

        async function navigateToDirectory(dirPath, options) {
            const settings = options || {};
            const normalizedDirPath = normalizePath(dirPath, true);
            const isSameDirectory = normalizedDirPath === state.currentDir;
            if (isSameDirectory && !settings.forceReload) {
                if (settings.historyMode === "replace") {
                    updateDirectoryHistory(normalizedDirPath, "replace");
                }
                return;
            }

            state.navigationGeneration += 1;
            const navigationGeneration = state.navigationGeneration;
            const stopRowLoading = settings.sourceEntry || settings.sourceRow
                ? startEntryRowLoading(settings.sourceEntry || normalizedDirPath, { row: settings.sourceRow || null })
                : null;
            resetDirectoryScopedUi();
            setListLoading(!stopRowLoading);
            try {
                await loadDirectory(normalizedDirPath);
                if (navigationGeneration !== state.navigationGeneration) {
                    return;
                }
                applyCurrentDirectoryMeta(
                    state.directoryMetaCache.get(normalizedDirPath) || { path: normalizedDirPath }
                );
                renderPathBreadcrumbs(state.currentDir);
                renderList();
                updatePathCurrentSize();
                if (settings.historyMode !== "skip") {
                    updateDirectoryHistory(state.currentDir, settings.historyMode === "replace" ? "replace" : "push");
                }
            } catch (error) {
                if (settings.historyMode === "replace") {
                    updateDirectoryHistory(state.currentDir, "replace");
                }
                throw error;
            } finally {
                if (typeof stopRowLoading === "function") {
                    stopRowLoading();
                }
                if (navigationGeneration === state.navigationGeneration) {
                    setListLoading(false);
                }
            }
        }

        async function toggleUrlShare(entry) {
            if (!entry || entry.isCurrentFolder || !entry.can_edit || !urlShareApiUrl) {
                return null;
            }

            const data = await requestJson(
                appendSharedQuery(urlShareApiUrl),
                buildPostOptions({
                    path: entry.path,
                    enabled: !Boolean(entry.is_url_only),
                })
            );

            await refreshCurrentDirectory();
            return {
                entry: state.entryByPath.get(entry.path) || null,
                data: data,
            };
        }

        function remapExpandedFoldersForRename(fromPath, toPath) {
            const normalizedFromPath = normalizePath(fromPath, true);
            const normalizedToPath = normalizePath(toPath, true);
            if (!normalizedFromPath || !normalizedToPath || normalizedFromPath === normalizedToPath) {
                return;
            }
            const remapped = new Set();
            state.expandedFolders.forEach(function (folderPath) {
                const normalizedFolderPath = normalizePath(folderPath, true);
                if (!normalizedFolderPath) {
                    return;
                }
                if (normalizedFolderPath === normalizedFromPath) {
                    remapped.add(normalizedToPath);
                    return;
                }
                if (normalizedFolderPath.startsWith(normalizedFromPath + "/")) {
                    remapped.add(normalizedToPath + normalizedFolderPath.slice(normalizedFromPath.length));
                    return;
                }
                remapped.add(normalizedFolderPath);
            });
            state.expandedFolders = remapped;
        }

        function removeExpandedFoldersByDeletedPaths(pathValues) {
            const targets = (Array.isArray(pathValues) ? pathValues : [])
                .map(function (value) {
                    return normalizePath(value, true);
                })
                .filter(function (value) {
                    return Boolean(value);
                });
            if (targets.length === 0) {
                return;
            }

            const nextExpandedFolders = new Set();
            state.expandedFolders.forEach(function (folderPath) {
                const normalizedFolderPath = normalizePath(folderPath, true);
                if (!normalizedFolderPath) {
                    return;
                }
                const shouldRemove = targets.some(function (targetPath) {
                    return normalizedFolderPath === targetPath || normalizedFolderPath.startsWith(targetPath + "/");
                });
                if (!shouldRemove) {
                    nextExpandedFolders.add(normalizedFolderPath);
                }
            });
            state.expandedFolders = nextExpandedFolders;
        }

        function getEntryEditableName(entry) {
            if (!entry) {
                return "";
            }
            if (entry.type === "file") {
                const fileName = String(entry.name || "");
                const dotIndex = fileName.lastIndexOf(".");
                if (dotIndex > 0) {
                    return fileName.slice(0, dotIndex);
                }
            }
            return entry.name;
        }

        function syncModalBodyState() {
            syncHandriveModalBodyState();
        }

        function getHandrivePathLabel(pathValue) {
            const normalized = normalizePath(pathValue, true);
            if (!normalized) {
                return "/handrive";
            }
            return formatNavigationPathLabel(normalized, {
                buildBreadcrumbItems: function (nextPath) {
                    return buildBreadcrumbItems(nextPath);
                },
                emptyLabel: "/handrive",
                leadingSlash: true,
                normalizePath: normalizePath,
            });
        }

        function getParentDirectory(pathValue) {
            const normalized = normalizePath(pathValue, true);
            if (!normalized) {
                return "";
            }
            const parts = normalized.split("/");
            parts.pop();
            return parts.join("/");
        }

        function clearDragOverTarget() {
            if (state.dragOverElement) {
                state.dragOverElement.classList.remove("is-drop-target");
                state.dragOverElement = null;
            }
            if (state.dragHoverElement) {
                state.dragHoverElement.classList.remove("is-drop-hover");
                state.dragHoverElement = null;
            }
            clearFileDropGroup();
            setFileDropTarget(false);
        }

        function isFileTransfer(event) {
            const dataTransfer = event && event.dataTransfer ? event.dataTransfer : null;
            if (!dataTransfer) {
                return false;
            }
            if (dataTransfer.files && dataTransfer.files.length > 0) {
                return true;
            }
            if (!dataTransfer.types) {
                return false;
            }
            return Array.from(dataTransfer.types).includes("Files");
        }

        function setFileDropTarget(active, sourceKind) {
            if (!listPane) {
                return;
            }
            const isActive = Boolean(active);
            const nextSourceKind = isActive ? String(sourceKind || "") : "";
            if (
                listPane.classList.contains("is-file-drop-target") === isActive &&
                listPane.classList.contains("is-local-file-drop-target") === (isActive && nextSourceKind === "local") &&
                state.fileDropSourceKind === nextSourceKind
            ) {
                return;
            }
            listPane.classList.toggle("is-file-drop-target", isActive);
            listPane.classList.toggle("is-local-file-drop-target", isActive && nextSourceKind === "local");
            state.fileDropSourceKind = nextSourceKind;
        }

        function clearFileDragUiState() {
            clearHoverExpandTimer();
            clearDragOverTarget();
            setFileDropTarget(false);
        }

        function clearFileDropGroup() {
            const rows = Array.isArray(state.fileDropGroupRows) ? state.fileDropGroupRows : [];
            rows.forEach(function (row) {
                if (!row || !row.classList) {
                    return;
                }
                row.classList.remove("is-file-drop-group", "is-file-drop-group-start", "is-file-drop-group-end");
                const item = row.closest(".handrive-item");
                if (item) {
                    item.classList.remove("is-file-drop-group-item", "is-file-drop-group-start", "is-file-drop-group-end");
                    item.style.removeProperty("--handrive-drop-group-left");
                }
            });
            state.fileDropGroupRows = [];
            state.fileDropGroupPath = "";
            state.fileDropGroupHighlightElement = null;
            if (listContainer) {
                listContainer.classList.remove("is-file-drop-root-target");
            }
            if (listPane) {
                listPane.classList.remove("is-file-drop-root-target");
            }
        }

        function addFileDropGroupRow(rows, row) {
            if (!(row instanceof Element) || rows.indexOf(row) !== -1) {
                return;
            }
            rows.push(row);
        }

        function getFileDropGroupRows(targetDirPath, highlightElement) {
            const targetPath = normalizePath(targetDirPath || "", true);
            if (
                !targetPath ||
                !(highlightElement instanceof Element) ||
                !highlightElement.classList.contains("handrive-item-row")
            ) {
                return [];
            }
            const rows = [];
            addFileDropGroupRow(rows, state.entryRowByPath.get(targetPath) || highlightElement);

            const currentDirPath = normalizePath(state.currentDir || "", true);
            const includesVisibleDescendants = state.expandedFolders.has(targetPath) || targetPath === currentDirPath;
            if (!includesVisibleDescendants) {
                return rows;
            }

            const visiblePaths = Array.isArray(state.visibleEntryPaths) ? state.visibleEntryPaths : [];
            visiblePaths.forEach(function (pathValue) {
                const visiblePath = normalizePath(pathValue || "", true);
                if (!visiblePath || visiblePath === targetPath || !visiblePath.startsWith(targetPath + "/")) {
                    return;
                }
                addFileDropGroupRow(rows, state.entryRowByPath.get(visiblePath));
            });
            return rows;
        }

        function getFileDropGroupLeftOffset(highlightElement) {
            if (!(highlightElement instanceof Element)) {
                return 0;
            }
            const item = highlightElement.closest(".handrive-item");
            const prefix = item ? item.querySelector(":scope > .handrive-item-tree-prefix") : null;
            if (!item || !prefix) {
                return 0;
            }
            const segments = prefix.querySelectorAll(".handrive-tree-segment");
            const lastSegment = segments.length > 0 ? segments[segments.length - 1] : null;
            if (!(lastSegment instanceof Element)) {
                return 0;
            }
            const itemRect = item.getBoundingClientRect();
            const segmentRect = lastSegment.getBoundingClientRect();
            return Math.max(0, Math.round(segmentRect.left - itemRect.left));
        }

        function setFileDropGroup(targetDirPath, highlightElement) {
            const targetPath = normalizePath(targetDirPath || "", true);
            if (
                state.fileDropGroupPath === targetPath &&
                state.fileDropGroupHighlightElement === highlightElement &&
                Array.isArray(state.fileDropGroupRows) &&
                state.fileDropGroupRows.length > 0
            ) {
                return;
            }
            const rows = getFileDropGroupRows(targetPath, highlightElement);
            const groupLeftOffset = getFileDropGroupLeftOffset(highlightElement);
            const currentDirPath = normalizePath(state.currentDir || "", true);
            clearFileDropGroup();
            if (rows.length === 0) {
                return;
            }
            const isRootDropTarget = Boolean(targetPath && targetPath === currentDirPath);
            if (listContainer) {
                listContainer.classList.toggle("is-file-drop-root-target", isRootDropTarget);
            }
            if (listPane) {
                listPane.classList.toggle("is-file-drop-root-target", isRootDropTarget);
            }
            rows.forEach(function (row, index) {
                const item = row.closest(".handrive-item");
                row.classList.add("is-file-drop-group");
                if (item) {
                    item.classList.add("is-file-drop-group-item");
                    item.style.setProperty("--handrive-drop-group-left", String(groupLeftOffset) + "px");
                }
                if (index === 0) {
                    row.classList.add("is-file-drop-group-start");
                    if (item) {
                        item.classList.add("is-file-drop-group-start");
                    }
                }
                if (index === rows.length - 1) {
                    row.classList.add("is-file-drop-group-end");
                    if (item) {
                        item.classList.add("is-file-drop-group-end");
                    }
                }
            });
            state.fileDropGroupRows = rows;
            state.fileDropGroupPath = targetPath;
            state.fileDropGroupHighlightElement = highlightElement;
        }

        function isInsideCurrentFileDropGroup(targetNode) {
            if (!(targetNode instanceof Element) || !Array.isArray(state.fileDropGroupRows)) {
                return false;
            }
            const row = targetNode.closest(".handrive-item-row");
            if (row && state.fileDropGroupRows.indexOf(row) !== -1) {
                return true;
            }
            const item = targetNode.closest(".handrive-item");
            if (!item) {
                return false;
            }
            const itemRow = item.querySelector(".handrive-item-row");
            return Boolean(itemRow && state.fileDropGroupRows.indexOf(itemRow) !== -1);
        }

        function isPointerInsideElement(event, element) {
            if (!event || !(element instanceof Element)) {
                return false;
            }
            const clientX = Number(event.clientX);
            const clientY = Number(event.clientY);
            if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
                return false;
            }
            const rect = element.getBoundingClientRect();
            return (
                clientX >= rect.left &&
                clientX <= rect.right &&
                clientY >= rect.top &&
                clientY <= rect.bottom
            );
        }

        function getCurrentDirectoryDropRow() {
            const currentDirPath = normalizePath(state.currentDir || "", true);
            if (!currentDirPath) {
                return null;
            }
            const currentEntry = state.entryByPath.get(currentDirPath);
            if (!currentEntry || !currentEntry.can_write_children) {
                return null;
            }
            return state.entryRowByPath.get(currentDirPath) || null;
        }

        function isCurrentDirectoryDropEvent(event, currentDirRow) {
            if (!(currentDirRow instanceof Element)) {
                return false;
            }
            const targetNode = event && event.target instanceof Element ? event.target : null;
            if (targetNode && (targetNode === currentDirRow || currentDirRow.contains(targetNode))) {
                return true;
            }
            return isPointerInsideElement(event, currentDirRow);
        }

        function shouldDeferToCurrentDirectoryDropTarget(event, highlightElement) {
            return Boolean(getDeferredCurrentDirectoryDropRow(event, highlightElement));
        }

        function getDeferredCurrentDirectoryDropRow(event, highlightElement) {
            const currentDirRow = getCurrentDirectoryDropRow();
            if (!currentDirRow || currentDirRow === highlightElement) {
                return null;
            }
            return isPointerInsideElement(event, currentDirRow) ? currentDirRow : null;
        }

        function isBareListFileDropTarget(targetNode) {
            if (!(targetNode instanceof Element) || !listPane || !listPane.contains(targetNode)) {
                return false;
            }
            return !targetNode.closest(".handrive-item");
        }

        function hasActiveDriveDrag() {
            return Array.isArray(state.draggingEntries) && state.draggingEntries.length > 0;
        }

        function isGoogleDriveEntry(entry) {
            return Boolean(entry && entry.google_drive);
        }

        function isGoogleDrivePath(pathValue) {
            const normalizedPath = normalizePath(pathValue, true);
            if (!normalizedPath) {
                return false;
            }
            const cachedMeta = state.directoryMetaCache.get(normalizedPath);
            if (cachedMeta && cachedMeta.is_google_drive) {
                return true;
            }
            const currentMetaPath = normalizePath((state.currentDirMeta || {}).path || state.currentDir, true);
            if (currentMetaPath === normalizedPath && state.currentDirMeta && state.currentDirMeta.is_google_drive) {
                return true;
            }
            const entry = state.entryByPath.get(normalizedPath);
            if (isGoogleDriveEntry(entry)) {
                return true;
            }
            return normalizedPath.indexOf("/.google-drive-") !== -1 || normalizedPath.indexOf(".google-drive-") === 0;
        }

        function isGoogleDriveUploadDrop(targetDirPath) {
            const targetIsGoogleDrive = isGoogleDrivePath(targetDirPath);
            return !targetIsGoogleDrive && Array.isArray(state.draggingEntries) && state.draggingEntries.length > 0 && state.draggingEntries.every(function (entry) {
                return isGoogleDriveEntry(entry) && entry.type === "file";
            });
        }

        function resolveDriveDropEffect(targetDirPath) {
            return isGoogleDriveUploadDrop(targetDirPath) ? "copy" : "move";
        }

        function resolveFileDropHighlightElement(targetNode) {
            if (!(targetNode instanceof Element)) {
                return null;
            }
            const row = targetNode.closest(".handrive-item-row");
            if (!row) {
                return null;
            }
            const entryPath = normalizePath(row.getAttribute("data-entry-path") || "", true);
            const entry = state.entryByPath.get(entryPath);
            if (!entry) {
                return null;
            }
            if (entry.type === "dir") {
                return row;
            }
            const parentDirPath = getParentDirectory(entry.path);
            return state.entryRowByPath.get(parentDirPath) || null;
        }

        function createOperationQueueItem(operationType, entries, targetDirPath, commitMessage, options) {
            const normalizedEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
            const settings = options || {};
            state.uploadQueueSequence += 1;
            const item = {
                id: state.uploadQueueSequence,
                kind: "operation",
                operationType: operationType,
                entries: normalizedEntries.map(function (entry) {
                    return {
                        path: entry.path,
                        slug_path: entry.slug_path || "",
                        name: getEntryEditableName(entry),
                        type: entry.type,
                        size_display: entry.size_display || "",
                        is_archive_member: Boolean(entry.is_archive_member),
                        is_archive: Boolean(entry.is_archive),
                        archive_path: entry.archive_path || "",
                        archive_member_path: entry.archive_member_path || "",
                    };
                }),
                fileName: settings.archiveName || buildQueueItemLabel(normalizedEntries, operationType, {
                    formatTemplate: formatTemplate,
                    getCurrentFolderName: getCurrentFolderName,
                    getEntryEditableName: getEntryEditableName,
                    t: t,
                }),
                sourcePath: normalizedEntries.length > 0 ? normalizedEntries[0].path : "",
                targetDirPath: normalizePath(targetDirPath || "", true),
                destinationMode: settings.destinationMode || "",
                status: "queued",
                progress: 0,
                errorMessage: "",
                savedPath: "",
                savedSlugPath: "",
                commitMessage: String(commitMessage || ""),
                archiveName: String(settings.archiveName || ""),
                isRepoDelete: Boolean(settings.repoDelete),
                abortRequested: false,
                abortController: null,
                sizeDisplay: normalizedEntries.length === 1 ? (normalizedEntries[0].size_display || "") : "",
            };
            state.uploadQueueItems.push(item);
            state.uploadQueueDismissed = false;
            renderUploadQueue();
            return item;
        }

        function enqueuePendingYoutubeDownloaderSave() {
            const storageKey = "hanplanet.youtubeDownloader.pendingSave";
            let payload = null;
            try {
                const raw = window.sessionStorage ? window.sessionStorage.getItem(storageKey) : "";
                if (!raw) {
                    return;
                }
                payload = JSON.parse(raw);
                window.sessionStorage.removeItem(storageKey);
            } catch (error) {
                try {
                    window.sessionStorage.removeItem(storageKey);
                } catch (removeError) {}
                return;
            }

            if (!payload || !payload.token || !payload.saveUrl) {
                return;
            }
            const createdAt = Number(payload.createdAt || 0);
            if (createdAt && Date.now() - createdAt > 30 * 60 * 1000) {
                return;
            }
            state.uploadQueueSequence += 1;
            state.uploadQueueItems.push({
                id: state.uploadQueueSequence,
                kind: "operation",
                operationType: "youtube-save",
                entries: [],
                fileName: String(payload.filename || "youtube-download"),
                sourcePath: "YouTube Downloader",
                targetDirPath: normalizePath(payload.targetDir || "youtube-downloader", true),
                status: "queued",
                progress: 0,
                errorMessage: "",
                savedPath: "",
                savedSlugPath: "",
                commitMessage: "",
                abortRequested: false,
                abortController: null,
                saveUrl: String(payload.saveUrl || ""),
                sizeDisplay: "",
                token: String(payload.token || ""),
            });
            state.uploadQueueDismissed = false;
            state.uploadQueueCollapsed = false;
            renderUploadQueue();
            processOperationQueue().catch(alertError);
        }

        let _uploadQueuePollTimer = null;
        function renderUploadQueue() {
            const items = state.uploadQueueItems.slice(-20);
            const hasActiveUploads = items.some(function (item) {
                return item.status === "uploading" && item.kind !== "operation";
            });
            if (hasActiveUploads) {
                if (!_uploadQueuePollTimer) {
                    _uploadQueuePollTimer = setTimeout(function () {
                        _uploadQueuePollTimer = null;
                        renderUploadQueue();
                    }, 1000);
                }
            } else {
                if (_uploadQueuePollTimer) {
                    clearTimeout(_uploadQueuePollTimer);
                    _uploadQueuePollTimer = null;
                }
            }
            renderUploadQueuePanel({
                createQueueListItem: function (item) {
                    return createQueueListItem(item, {
                        documentRef: document,
                        getMetaLabel: function (nextItem) {
                            return getQueueItemMetaLabel(nextItem, getHandrivePathLabel);
                        },
                        getStatusLabel: function (nextItem) {
                            return getQueueItemStatusLabel(nextItem, t);
                        },
                        onOpenContextMenu: openUploadQueueContextMenu,
                    });
                },
                collapsed: state.uploadQueueCollapsed,
                dismissed: state.uploadQueueDismissed,
                items: items,
                sortQueueItems: sortQueueItems,
                summarizeUploadQueue: function (nextItems) {
                    return summarizeUploadQueue(nextItems, t);
                },
                t: t,
                uploadQueueList: uploadQueueList,
                uploadQueuePanel: uploadQueuePanel,
                uploadQueueSummary: uploadQueueSummary,
                uploadQueueToggleButton: uploadQueueToggleButton,
            });
        }

        function removeUploadQueueItem(itemId) {
            state.uploadQueueItems = state.uploadQueueItems.filter(function (item) {
                return item.id !== itemId;
            });
            if (state.uploadQueueContextItem && state.uploadQueueContextItem.id === itemId) {
                closeContextMenu();
            }
            renderUploadQueue();
        }

        function cancelUploadQueueItem(item) {
            if (!item) {
                return;
            }
            item.abortRequested = true;
            if (item.xhr) {
                item.xhr.abort();
            }
            if (item.abortController) {
                item.abortController.abort();
            }
            if (uploadCancelApiUrl && item.uploadId) {
                const formData = new FormData();
                formData.append("upload_id", item.uploadId);
                const csrfToken = getCsrfToken();
                fetch(appendAdminHandriveUserQuery(uploadCancelApiUrl), {
                    method: "POST",
                    headers: csrfToken ? { "X-CSRFToken": csrfToken } : {},
                    body: formData,
                    credentials: "same-origin",
                }).catch(function () {
                    return null;
                });
            }
            removeUploadQueueItem(item.id);
        }

        async function deleteUploadedQueueItem(item) {
            if (item && item.kind === "operation") {
                removeUploadQueueItem(item.id);
                return;
            }
            if (!item || !item.savedPath) {
                removeUploadQueueItem(item && item.id);
                return;
            }
            const confirmed = await requestConfirmDialog({
                title: t("delete_button", "삭제"),
                message: formatTemplate(
                    t("js_confirm_delete_entry", "정말 삭제할까요?\n{path}"),
                    { path: getHandrivePathLabel(item.savedPath) }
                ),
                cancelText: t("cancel", "취소"),
                confirmText: t("delete_button", "삭제")
            });
            if (!confirmed) {
                return;
            }
            await requestJson(
                deleteApiUrl,
                buildPostOptions({
                    path: item.savedPath,
                })
            );
            removeUploadQueueItem(item.id);
            await refreshCurrentDirectory();
        }

        function openUploadQueueContextMenu(item, x, y) {
            if (!contextMenu || !item) {
                return;
            }
            closeContextMenu();
            state.uploadQueueContextItem = item;
            state.contextTarget = null;
            state.contextEntries = [];

            configureUploadQueueContextMenu({
                buttons: {
                    deleteButton: contextDeleteButton,
                    download: contextDownloadButton,
                    edit: contextEditButton,
                    createArchive: contextCreateArchiveButton,
                    extractArchive: contextExtractArchiveButton,
                    share: contextShareButton,
                    gitCreateRepo: contextGitCreateRepoButton,
                    gitDeleteRepo: contextGitDeleteRepoButton,
                    gitManageRepo: contextGitManageRepoButton,
                    gitCreateBranch: contextGitCreateBranchButton,
                    gitDeleteBranch: contextGitDeleteBranchButton,
                    createMap: contextCreateMapButton,
                    convertMp3: contextConvertMp3Button,
                    newDoc: contextNewDocButton,
                    newFolder: contextNewFolderButton,
                    open: contextOpenButton,
                    rename: contextRenameButton,
                    upload: contextUploadButton,
                },
                defaultLabels: defaultContextButtonLabels,
                item: item,
                setContextButtonVisible: setContextButtonVisible,
                t: t,
            });
            syncContextMenuDividers(contextMenu);

            contextMenu.hidden = false;
            contextMenu.style.left = "0px";
            contextMenu.style.top = "0px";

            const rect = contextMenu.getBoundingClientRect();
            const viewportPadding = 8;
            const maxLeft = Math.max(viewportPadding, window.innerWidth - rect.width - viewportPadding);
            const minTop = viewportPadding;
            const maxTop = Math.max(minTop, window.innerHeight - rect.height - viewportPadding);

            const left = Math.min(Math.max(viewportPadding, x), maxLeft);
            const top = Math.min(Math.max(minTop, y), maxTop);

            contextMenu.style.left = left + "px";
            contextMenu.style.top = top + "px";
        }

        function queueNeedsRefresh() {
            state.uploadRefreshPending = true;
        }

        const uploadChunkSize = 256 * 1024;
        const uploadRateLimitBytesPerSecond = 10 * 1024 * 1024;

        function delay(ms) {
            return new Promise(function (resolve) {
                window.setTimeout(resolve, ms);
            });
        }

        async function uploadSingleFile(item) {
            if (!uploadApiUrl) {
                throw new Error(t("job_status_failed", "실패"));
            }
            const file = item.file;
            const totalBytes = Math.max(1, file.size || 0);
            item.startTime = Date.now();
            item.uploadSpeed = 0;
            item.uploadedBytes = 0;
            const totalChunks = Math.max(1, Math.ceil(totalBytes / uploadChunkSize));
            const uploadId = (window.crypto && window.crypto.randomUUID)
                ? window.crypto.randomUUID()
                : ("upload-" + String(Date.now()) + "-" + String(Math.random()).slice(2));
            item.uploadId = uploadId;

            function sendChunk(chunkBlob, chunkIndex, chunkStart) {
                return new Promise(function (resolve, reject) {
                    const formData = new FormData();
                    formData.append("dir", item.targetDirPath);
                    formData.append("upload_id", uploadId);
                    formData.append("file_name", file.name);
                    formData.append("chunk_index", String(chunkIndex));
                    formData.append("total_chunks", String(totalChunks));
                    if (item.commitMessage) {
                        formData.append("commit_message", item.commitMessage);
                    }
                    formData.append("chunk", chunkBlob, file.name);

                    const xhr = new XMLHttpRequest();
                    item.xhr = xhr;
                    xhr.open("POST", appendAdminHandriveUserQuery(uploadApiUrl), true);
                    xhr.timeout = 120000;
                    const csrfToken = getCsrfToken();
                    if (csrfToken) {
                        xhr.setRequestHeader("X-CSRFToken", csrfToken);
                    }

                    if (xhr.upload) {
                        xhr.upload.addEventListener("progress", function (event) {
                            if (!event.lengthComputable) {
                                return;
                            }
                            const uploadedWithinChunk = Math.max(0, Math.min(event.loaded, chunkBlob.size));
                            const uploadedSoFar = Math.min(totalBytes, chunkStart + uploadedWithinChunk);
                            item.progress = Math.min(99, (uploadedSoFar / totalBytes) * 100);
                            item.uploadedBytes = uploadedSoFar;
                            const elapsedSec = Math.max(0.001, (Date.now() - (item.startTime || Date.now())) / 1000);
                            item.uploadSpeed = uploadedSoFar / elapsedSec;
                            renderUploadQueue();
                        });
                    }

                    xhr.addEventListener("load", function () {
                        let payload = null;
                        try {
                            payload = JSON.parse(xhr.responseText || "null");
                        } catch (error) {
                            payload = null;
                        }
                        item.xhr = null;
                        if (xhr.status >= 200 && xhr.status < 300) {
                            resolve(payload);
                            return;
                        }
                        let message = selectServerMessage(payload, t("job_status_failed", "실패"));
                        if (!payload || !payload.error) {
                            if (xhr.status === 413) {
                                message = t("upload_error_file_too_large", "단일 용량 초과");
                            } else if (xhr.status === 415) {
                                message = t("upload_error_file_type_not_allowed", "업로드 불가능한 파일 형식");
                            } else if (xhr.status === 408 || xhr.status === 504) {
                                message = t("upload_error_timeout", "대기시간 초과");
                            }
                        }
                        reject(new Error(message));
                    });

                    xhr.addEventListener("error", function () {
                        item.xhr = null;
                        reject(new Error(t("job_status_failed", "실패")));
                    });

                    xhr.addEventListener("timeout", function () {
                        item.xhr = null;
                        reject(new Error(t("upload_error_timeout", "대기시간 초과")));
                    });

                    xhr.addEventListener("abort", function () {
                        item.xhr = null;
                        reject(new Error(t("upload_cancel", "업로드 취소")));
                    });

                    xhr.send(formData);
                });
            }

            let payload = null;
            let uploadedBytes = 0;
            for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
                if (item.abortRequested) {
                    throw new Error(t("upload_cancel", "업로드 취소"));
                }
                const chunkStart = chunkIndex * uploadChunkSize;
                const chunkEnd = Math.min(file.size, chunkStart + uploadChunkSize);
                const chunkBlob = file.slice(chunkStart, chunkEnd);
                const startedAt = window.performance && typeof window.performance.now === "function"
                    ? window.performance.now()
                    : Date.now();
                payload = await sendChunk(chunkBlob, chunkIndex, chunkStart);
                uploadedBytes = chunkEnd;
                item.progress = chunkIndex === totalChunks - 1
                    ? 99
                    : Math.min(99, (uploadedBytes / totalBytes) * 100);
                renderUploadQueue();

                const elapsedMs = (window.performance && typeof window.performance.now === "function"
                    ? window.performance.now()
                    : Date.now()) - startedAt;
                const minDurationMs = (chunkBlob.size / uploadRateLimitBytesPerSecond) * 1000;
                if (elapsedMs < minDurationMs) {
                    await delay(minDurationMs - elapsedMs);
                }
            }

            item.progress = 100;
            item.status = "done";
            const uploadedEntry = payload && Array.isArray(payload.entries) ? payload.entries[0] : null;
            item.savedPath = uploadedEntry && uploadedEntry.path ? uploadedEntry.path : "";
            item.savedSlugPath = uploadedEntry && uploadedEntry.slug_path ? uploadedEntry.slug_path : "";
            item.xhr = null;
            renderUploadQueue();
            queueNeedsRefresh();
        }

        async function processUploadQueue() {
            await processUploadQueueWorker({
                alertError: alertError,
                refreshCurrentDirectory: refreshCurrentDirectory,
                renderUploadQueue: renderUploadQueue,
                state: state,
                t: t,
                uploadSingleFile: uploadSingleFile,
            });
        }

        async function runDeleteOperationQueueItem(item) {
            await runDeleteQueueOperation(item, {
                applySelection: applySelection,
                buildPostOptions: buildPostOptions,
                deleteApiUrl: deleteApiUrl,
                onEntryDeleted: removeSyncExcludedStateForDelete,
                queueNeedsRefresh: queueNeedsRefresh,
                removeExpandedFoldersByDeletedPaths: removeExpandedFoldersByDeletedPaths,
                renderUploadQueue: renderUploadQueue,
                requestJson: requestJson,
                t: t,
            });
        }

        async function runCreateArchiveOperationQueueItem(item) {
            await runCreateArchiveQueueOperation(item, {
                applySelection: applySelection,
                archiveCreateApiUrl: archiveCreateApiUrl,
                buildPostOptions: buildPostOptions,
                queueNeedsRefresh: queueNeedsRefresh,
                renderUploadQueue: renderUploadQueue,
                requestJson: requestJson,
                resolveArchiveExtractTargetDir: resolveArchiveExtractTargetDir,
                t: t,
            });
        }

        async function runMoveOperationQueueItem(item) {
            await runMoveQueueOperation(item, {
                applySelection: applySelection,
                buildPostOptions: buildPostOptions,
                moveApiUrl: moveApiUrl,
                onEntryMoved: remapSyncExcludedStateForMove,
                queueNeedsRefresh: queueNeedsRefresh,
                renderUploadQueue: renderUploadQueue,
                requestJson: requestJson,
                t: t,
            });
        }

        async function runExtractOperationQueueItem(item) {
            await runExtractQueueOperation(item, {
                applySelection: applySelection,
                archiveExtractApiUrl: archiveExtractApiUrl,
                buildPostOptions: buildPostOptions,
                queueNeedsRefresh: queueNeedsRefresh,
                renderUploadQueue: renderUploadQueue,
                requestJson: requestJson,
                t: t,
            });
        }

        async function runYoutubeSaveOperationQueueItem(item) {
            if (!item.saveUrl || !item.token) {
                throw new Error(t("job_status_failed", "실패"));
            }
            item.progress = 10;
            renderUploadQueue();
            const data = await requestJson(item.saveUrl, buildPostOptions({ token: item.token }));
            item.progress = 90;
            item.savedPath = data && data.path
                ? data.path
                : normalizePath((item.targetDirPath || "") + "/" + (item.fileName || ""), true);
            item.savedSlugPath = data && data.slug_path ? data.slug_path : "";
            renderUploadQueue();
            queueNeedsRefresh();
        }

        async function runConvertMp3OperationQueueItem(item) {
            if (!convertMp3ApiUrl) {
                throw new Error(t("job_status_failed", "실패"));
            }
            const entries = Array.isArray(item.entries) ? item.entries.slice() : [];
            const convertedPaths = [];
            for (let index = 0; index < entries.length; index += 1) {
                if (item.abortRequested) {
                    throw new Error(t("queue_cancel", "취소"));
                }
                const controller = new AbortController();
                item.abortController = controller;
                const entry = entries[index];
                const data = await requestJson(appendSharedQuery(convertMp3ApiUrl), Object.assign(
                    buildPostOptions({ path: entry.path }),
                    { signal: controller.signal }
                ));
                const convertedPath = data && data.path ? data.path : "";
                if (convertedPath) {
                    convertedPaths.push(convertedPath);
                }
                item.progress = ((index + 1) / Math.max(1, entries.length)) * 100;
                item.savedPath = convertedPath || item.savedPath || "";
                item.savedSlugPath = data && data.slug_path ? data.slug_path : "";
                item.sizeDisplay = data && data.size_display ? data.size_display : item.sizeDisplay;
                item.abortController = null;
                renderUploadQueue();
            }
            if (convertedPaths.length > 0) {
                applySelection(convertedPaths, {
                    primaryPath: convertedPaths[0] || "",
                    anchorPath: convertedPaths[0] || "",
                    render: false,
                });
            }
            queueNeedsRefresh();
        }

        async function processOperationQueue() {
            await processOperationQueueWorker({
                alertError: alertError,
                refreshCurrentDirectory: refreshCurrentDirectory,
                removeUploadQueueItem: removeUploadQueueItem,
                renderUploadQueue: renderUploadQueue,
                runCreateArchiveOperationQueueItem: runCreateArchiveOperationQueueItem,
                runDeleteOperationQueueItem: runDeleteOperationQueueItem,
                runExtractOperationQueueItem: runExtractOperationQueueItem,
                runMoveOperationQueueItem: runMoveOperationQueueItem,
                runYoutubeSaveOperationQueueItem: runYoutubeSaveOperationQueueItem,
                runConvertMp3OperationQueueItem: runConvertMp3OperationQueueItem,
                state: state,
                t: t,
            });
        }

        async function enqueueUploadFiles(files, targetDirPath) {
            await enqueueQueuedUploadFiles(files, targetDirPath, {
                alertError: alertError,
                normalizePath: normalizePath,
                processUploadQueue: processUploadQueue,
                promptCommitMessage: promptCommitMessage,
                renderUploadQueue: renderUploadQueue,
                requiresCommitMessageForDirectory: requiresCommitMessageForDirectory,
                state: state,
                uploadApiUrl: uploadApiUrl,
            });
        }

        function openContextUploadPicker(entry) {
            if (!contextUploadInput || !entry || entry.type !== "dir" || !entry.can_write_children) {
                return;
            }
            state.pendingContextUploadDir = normalizePath(entry.path, true);
            contextUploadInput.value = "";
            contextUploadInput.click();
        }

        function shouldIgnorePasteUploadTarget() {
            const activeElement = document.activeElement;
            if (!activeElement) {
                return false;
            }
            const tagName = String(activeElement.tagName || "").toLowerCase();
            if (tagName === "input" || tagName === "textarea") {
                return true;
            }
            return Boolean(activeElement.isContentEditable);
        }

        function getClipboardDefaultFileExtension(file) {
            const type = String(file && file.type ? file.type : "").toLowerCase();
            const extensionByType = {
                "image/bmp": ".bmp",
                "image/gif": ".gif",
                "image/jpeg": ".jpg",
                "image/png": ".png",
                "image/svg+xml": ".svg",
                "image/webp": ".webp",
                "text/html": ".html",
                "text/plain": ".txt",
                "video/mp4": ".mp4",
                "video/webm": ".webm",
            };
            return extensionByType[type] || "";
        }

        function getClipboardDefaultFilename(file, index) {
            const suffix = index > 0 ? "-" + String(index + 1) : "";
            return "untitled" + suffix + getClipboardDefaultFileExtension(file);
        }

        function isLikelyGeneratedClipboardFilename(file, filename, index) {
            const rawName = String(filename || "").trim().toLowerCase();
            if (!rawName) {
                return true;
            }

            // Browsers often synthesize a generic name for pasted files instead of exposing
            // the user's original filename. Treat those names like "missing" so the filename
            // dialog still appears and the user can confirm or override them.
            const extensionlessName = rawName.replace(/\.[a-z0-9._-]{1,16}$/i, "");
            const genericNamePatterns = [
                /^(?:blob|clipboard|file|image|photo|picture|screenshot|screen shot|screen_shot|capture|untitled)(?:[-_ ]?\d+)?$/,
                /^(?:pasted[-_ ]?(?:image|clipboard))(?:[-_ ]?\d+)?$/,
                /^(?:image|photo|picture|screenshot|screen shot|screen_shot|capture|untitled)(?:[-_ ]?\d+)?\.(?:bmp|gif|jpe?g|png|svg|webp|heic|avif|tiff?)$/,
            ];

            return genericNamePatterns.some(function (pattern) {
                return pattern.test(rawName) || pattern.test(extensionlessName);
            });
        }

        function renameClipboardFile(file, filename) {
            const safeName = String(filename || "").trim();
            if (!file || !safeName) {
                return file;
            }
            try {
                return new File([file], safeName, {
                    type: file.type || "application/octet-stream",
                    lastModified: file.lastModified || Date.now(),
                });
            } catch (error) {
                const renamedBlob = file.slice(0, file.size || 0, file.type || "application/octet-stream");
                try {
                    Object.defineProperty(renamedBlob, "name", {
                        configurable: true,
                        value: safeName,
                    });
                    Object.defineProperty(renamedBlob, "lastModified", {
                        configurable: true,
                        value: file.lastModified || Date.now(),
                    });
                } catch (defineError) {
                    return file;
                }
                return renamedBlob;
            }
        }

        function resolveClipboardFilenameValue(file, inputValue, defaultFilename) {
            const safeInput = String(inputValue || "").trim();
            const fallbackName = String(defaultFilename || "").trim();
            const baseName = safeInput || fallbackName;
            if (!baseName) {
                return "";
            }

            const normalizedBaseName = baseName.replace(/\.+$/g, "");
            const baseExtMatch = normalizedBaseName.match(/\.([a-z0-9._-]{1,16})$/i);
            if (baseExtMatch) {
                return normalizedBaseName;
            }

            const clipboardExtension = getClipboardDefaultFileExtension(file);
            return clipboardExtension ? normalizedBaseName + clipboardExtension : normalizedBaseName;
        }

        async function resolveClipboardUploadFilenames(files, targetDirPath) {
            const resolvedFiles = [];
            const targetLabel = targetDirPath
                ? t("clipboard_filename_target_prefix", "업로드 위치") + ": " + getHandrivePathLabel(targetDirPath)
                : t("clipboard_filename_target_root", "업로드 위치: HanDrive");
            for (let index = 0; index < files.length; index += 1) {
                const file = files[index];
                const fileName = String(file && file.name ? file.name : "").trim();
                if (fileName && !isLikelyGeneratedClipboardFilename(file, fileName, index)) {
                    resolvedFiles.push(file);
                    continue;
                }

                const defaultFilename = getClipboardDefaultFilename(file, index);
                const inputValue = await requestClipboardFilenameDialog({
                    targetText: targetLabel,
                    placeholder: t("clipboard_filename_blank_default_prefix", "비워두면 ")
                        + defaultFilename
                        + t("clipboard_filename_blank_default_suffix", " 이름으로 업로드됩니다."),
                });
                if (inputValue === null) {
                    return null;
                }
                resolvedFiles.push(
                    renameClipboardFile(
                        file,
                        resolveClipboardFilenameValue(file, inputValue, defaultFilename)
                    )
                );
            }
            return resolvedFiles;
        }

        function setDragOverTarget(element) {
            if (!element || state.dragOverElement === element) {
                return;
            }
            clearDragOverTarget();
            state.dragOverElement = element;
            state.dragOverElement.classList.add("is-drop-target");
        }

        function restoreActiveDropPreviewAfterRender() {
            if (!listPane || !listPane.classList.contains("is-file-drop-target")) {
                return;
            }
            const targetPath = normalizePath(state.fileDropGroupPath || "", true);
            const sourceKind = state.fileDropSourceKind;
            if (!targetPath) {
                clearDragOverTarget();
                return;
            }
            const highlightElement = state.entryRowByPath.get(targetPath);
            if (!highlightElement) {
                clearDragOverTarget();
                return;
            }
            if (state.dragOverElement && state.dragOverElement !== highlightElement) {
                state.dragOverElement.classList.remove("is-drop-target");
            }
            state.dragOverElement = highlightElement;
            state.dragOverElement.classList.add("is-drop-target");
            state.fileDropGroupPath = "";
            state.fileDropGroupHighlightElement = null;
            setFileDropTarget(true, sourceKind);
            setFileDropGroup(targetPath, highlightElement);
        }

        function clearHoverExpandTimer() {
            if (state.hoverExpandTimerId !== null) {
                window.clearTimeout(state.hoverExpandTimerId);
                state.hoverExpandTimerId = null;
            }
            state.hoverExpandPath = "";
        }

        function scheduleHoverExpand(targetDirPath) {
            const normalizedPath = normalizePath(targetDirPath, true);
            if (!normalizedPath || state.expandedFolders.has(normalizedPath)) {
                clearHoverExpandTimer();
                return;
            }
            if (state.hoverExpandPath === normalizedPath && state.hoverExpandTimerId !== null) {
                return;
            }

            clearHoverExpandTimer();
            state.hoverExpandPath = normalizedPath;
            state.hoverExpandTimerId = window.setTimeout(function () {
                state.hoverExpandTimerId = null;
                state.hoverExpandPath = "";
                const targetEntry = state.entryByPath.get(normalizedPath);
                if (!targetEntry || targetEntry.type !== "dir" || state.expandedFolders.has(normalizedPath)) {
                    return;
                }
                toggleFolderExpansion(targetEntry).catch(alertError);
            }, 500);
        }

        function canDropToDirectory(targetDirPath, options) {
            if ((!moveApiUrl && !archiveExtractApiUrl) || !Array.isArray(state.draggingEntries) || state.draggingEntries.length === 0) {
                return false;
            }

            const targetPath = normalizePath(targetDirPath, true);
            const allowSameParent = Boolean(options && options.allowSameParent);
            const hasArchiveSources = state.draggingEntries.some(function (entry) {
                return Boolean(entry && entry.is_archive_member);
            });
            const hasNormalSources = state.draggingEntries.some(function (entry) {
                return Boolean(entry && !entry.is_archive_member);
            });
            if (hasArchiveSources && (hasNormalSources || !archiveExtractApiUrl || isArchiveVirtualPath(targetPath))) {
                return false;
            }
            const targetIsGoogleDrive = isGoogleDrivePath(targetPath);
            const googleDriveSources = state.draggingEntries.filter(isGoogleDriveEntry);
            if (googleDriveSources.length > 0 && googleDriveSources.length !== state.draggingEntries.length) {
                return false;
            }
            if (googleDriveSources.length > 0 && !targetIsGoogleDrive && googleDriveSources.some(function (entry) {
                return entry.type !== "file";
            })) {
                return false;
            }
            if (googleDriveSources.length === 0 && targetIsGoogleDrive && hasNormalSources) {
                return false;
            }
            let hasMovableSource = false;

            for (let index = 0; index < state.draggingEntries.length; index += 1) {
                const dragEntry = state.draggingEntries[index];
                if (!dragEntry) {
                    return false;
                }
                const sourcePath = normalizePath(dragEntry.path, false);
                const sourceType = dragEntry.type;

                if (!sourcePath || sourcePath === targetPath) {
                    return false;
                }
                if (!hasArchiveSources && !allowSameParent && getParentDirectory(sourcePath) === targetPath) {
                    return false;
                }
                if (!hasArchiveSources && sourceType === "dir" && targetPath && targetPath.startsWith(sourcePath + "/")) {
                    return false;
                }
                hasMovableSource = true;
            }
            return hasMovableSource;
        }

        async function extractArchiveEntriesToDirectory(sourceEntries, targetDirPath) {
            if (!Array.isArray(sourceEntries) || sourceEntries.length === 0 || !archiveExtractApiUrl) {
                return;
            }
            createOperationQueueItem("extract", sourceEntries, targetDirPath, "", {
                destinationMode: "current",
            });
            processOperationQueue().catch(alertError);
        }

        function isVirtualArchiveCreateEntry(entry) {
            return Boolean(
                entry &&
                (
                    entry.is_archive_member ||
                    entry.google_drive ||
                    entry.is_google_drive ||
                    entry.git_repo ||
                    entry.github_repo ||
                    entry.git_branch_root ||
                    entry.git_repo_branch ||
                    entry.is_git_virtual
                )
            );
        }

        function resolveArchiveCreateSelection(entries) {
            const normalizedEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
            if (normalizedEntries.length < 2 || !archiveCreateApiUrl) {
                return null;
            }
            let parentPath = null;
            for (let index = 0; index < normalizedEntries.length; index += 1) {
                const entry = normalizedEntries[index];
                if (
                    !entry ||
                    entry.type !== "file" ||
                    entry.isCurrentFolder ||
                    entry.can_read === false ||
                    isVirtualArchiveCreateEntry(entry)
                ) {
                    return null;
                }
                const entryPath = normalizePath(entry.path || "", true);
                if (!entryPath) {
                    return null;
                }
                const nextParentPath = getParentDirectory(entryPath);
                if (parentPath === null) {
                    parentPath = nextParentPath;
                } else if (parentPath !== nextParentPath) {
                    return null;
                }
            }

            const parentMeta = parentPath === state.currentDir
                ? getCurrentDirMeta()
                : (state.entryByPath.get(parentPath) || state.directoryMetaCache.get(parentPath) || null);
            const canWriteParent = parentMeta
                ? Boolean(parentMeta.can_write_children || parentMeta.can_edit)
                : normalizedEntries.every(function (entry) {
                    return entry.can_edit !== false;
                });
            if (!canWriteParent) {
                return null;
            }
            return {
                entries: normalizedEntries,
                parentPath: parentPath || "",
                defaultName: getCurrentFolderName(parentPath || ""),
            };
        }

        function canCreateArchiveFromEntries(entries) {
            return Boolean(resolveArchiveCreateSelection(entries));
        }

        function createArchiveFromFolder(entry) {
            if (!entry || entry.type !== "dir" || !archiveCreateApiUrl) {
                return;
            }
            createOperationQueueItem("create-archive", [entry], getParentDirectory(entry.path), "");
            processOperationQueue().catch(alertError);
        }

        function createArchiveFromSelectedFiles(entries, archiveName) {
            const selection = resolveArchiveCreateSelection(entries);
            const normalizedArchiveName = String(archiveName || "").trim();
            if (!selection || !normalizedArchiveName) {
                return false;
            }
            createOperationQueueItem("create-archive", selection.entries, selection.parentPath, "", {
                archiveName: normalizedArchiveName,
            });
            processOperationQueue().catch(alertError);
            return true;
        }

        async function moveEntriesToDirectory(sourceEntries, targetDirPath) {
            if (!Array.isArray(sourceEntries) || sourceEntries.length === 0) {
                return;
            }
            const normalizedTargetPath = normalizePath(targetDirPath || "", true);
            const normalSourceEntries = sourceEntries.filter(function (entry) {
                return Boolean(entry && !entry.is_archive_member);
            });
            if (
                normalSourceEntries.length > 0 &&
                normalSourceEntries.every(function (entry) {
                    return getParentDirectory(entry.path) === normalizedTargetPath;
                })
            ) {
                return;
            }
            if (sourceEntries.every(function (entry) { return Boolean(entry && entry.is_archive_member); })) {
                await extractArchiveEntriesToDirectory(sourceEntries, targetDirPath);
                return;
            }
            if (!moveApiUrl) {
                return;
            }
            var commitMessage = "";
            if (requiresCommitMessageForEntries(sourceEntries) || requiresCommitMessageForDirectory(targetDirPath)) {
                commitMessage = await promptCommitMessage(targetDirPath);
                if (commitMessage === null) {
                    return;
                }
            }
            createOperationQueueItem("move", sourceEntries, targetDirPath, commitMessage);
            processOperationQueue().catch(alertError);
        }

        function activateDropPreviewTarget(event, targetDirPath, highlightElement, dropEffect, sourceKind) {
            event.preventDefault();
            event.stopPropagation();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = dropEffect || "copy";
            }
            setDragOverTarget(highlightElement);
            setFileDropTarget(true, sourceKind);
            setFileDropGroup(targetDirPath, highlightElement);
            scheduleHoverExpand(targetDirPath);
        }

        function activateFileDropTarget(event, targetDirPath, highlightElement) {
            activateDropPreviewTarget(event, targetDirPath, highlightElement, "copy", "local");
        }

        function activateDriveMoveDropTarget(event, targetDirPath, highlightElement) {
            activateDropPreviewTarget(event, targetDirPath, highlightElement, resolveDriveDropEffect(targetDirPath), "drive");
        }

        function bindDropTarget(targetElement, targetDirPath, options) {
            if (!targetElement) {
                return;
            }
            const bindOptions = options || {};
            const highlightElement = bindOptions.highlightElement || targetElement;
            const fileTransfersOnly = Boolean(bindOptions.fileTransfersOnly);
            const driveMoveOptions = Object.assign({}, bindOptions, { allowSameParent: false });

            targetElement.addEventListener("dragenter", function (event) {
                const deferredCurrentDirRow = getDeferredCurrentDirectoryDropRow(event, highlightElement);
                if (deferredCurrentDirRow && isFileTransfer(event)) {
                    activateFileDropTarget(event, state.currentDir, deferredCurrentDirRow);
                    return;
                }
                if (deferredCurrentDirRow) {
                    return;
                }
                if (isFileTransfer(event)) {
                    activateFileDropTarget(event, targetDirPath, highlightElement);
                    return;
                }
                if (fileTransfersOnly) {
                    return;
                }
                if (!canDropToDirectory(targetDirPath, driveMoveOptions)) {
                    return;
                }
                activateDriveMoveDropTarget(event, targetDirPath, highlightElement);
            });

            targetElement.addEventListener("dragover", function (event) {
                const deferredCurrentDirRow = getDeferredCurrentDirectoryDropRow(event, highlightElement);
                if (deferredCurrentDirRow && isFileTransfer(event)) {
                    activateFileDropTarget(event, state.currentDir, deferredCurrentDirRow);
                    return;
                }
                if (deferredCurrentDirRow) {
                    return;
                }
                if (isFileTransfer(event)) {
                    activateFileDropTarget(event, targetDirPath, highlightElement);
                    return;
                }
                if (fileTransfersOnly) {
                    return;
                }
                if (!canDropToDirectory(targetDirPath, driveMoveOptions)) {
                    return;
                }
                activateDriveMoveDropTarget(event, targetDirPath, highlightElement);
            });

            targetElement.addEventListener("dragleave", function (event) {
                if (!state.dragOverElement || state.dragOverElement !== highlightElement) {
                    return;
                }
                if (isPointerInsideElement(event, highlightElement)) {
                    return;
                }
                if (isInsideCurrentFileDropGroup(event.relatedTarget)) {
                    return;
                }
                const deferredCurrentDirRow = getDeferredCurrentDirectoryDropRow(event, highlightElement);
                if (deferredCurrentDirRow && isPointerInsideElement(event, deferredCurrentDirRow)) {
                    return;
                }
                const nextHighlightElement = resolveFileDropHighlightElement(event.relatedTarget);
                if (nextHighlightElement && nextHighlightElement === highlightElement) {
                    return;
                }
                if (event.relatedTarget && targetElement.contains(event.relatedTarget)) {
                    return;
                }
                clearHoverExpandTimer();
                clearDragOverTarget();
            });

            targetElement.addEventListener("drop", function (event) {
                if (shouldDeferToCurrentDirectoryDropTarget(event, highlightElement)) {
                    return;
                }
                if (isFileTransfer(event)) {
                    event.preventDefault();
                    event.stopPropagation();
                    clearFileDragUiState();
                    enqueueUploadFiles(
                        event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files : [],
                        targetDirPath
                    ).catch(alertError);
                    return;
                }
                if (fileTransfersOnly) {
                    return;
                }
                if (!canDropToDirectory(targetDirPath, driveMoveOptions)) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                clearHoverExpandTimer();
                clearDragOverTarget();
                moveEntriesToDirectory(state.draggingEntries.slice(), targetDirPath).catch(alertError);
            });
        }

        function pruneNestedDragEntries(entries) {
            if (!Array.isArray(entries) || entries.length === 0) {
                return [];
            }
            const uniqueEntries = [];
            const seenPaths = new Set();
            entries.forEach(function (entry) {
                if (!entry || !entry.path || seenPaths.has(entry.path)) {
                    return;
                }
                seenPaths.add(entry.path);
                uniqueEntries.push(entry);
            });

            const directoryPaths = uniqueEntries
                .filter(function (entry) {
                    return entry.type === "dir";
                })
                .map(function (entry) {
                    return entry.path;
                })
                .sort(function (left, right) {
                    if (left.length !== right.length) {
                        return left.length - right.length;
                    }
                    return left.localeCompare(right);
                });

            return uniqueEntries.filter(function (entry) {
                return !directoryPaths.some(function (directoryPath) {
                    return directoryPath !== entry.path && entry.path.startsWith(directoryPath + "/");
                });
            });
        }

        function resolveDraggingEntriesFromRow(entry) {
            if (!entry) {
                return [];
            }
            const baseEntries =
                state.selectedPaths.size > 1 && state.selectedPaths.has(entry.path)
                    ? getSelectedEntries()
                    : [entry];
            const movableEntries = baseEntries.filter(function (candidate) {
                if (!candidate) {
                    return false;
                }
                if (candidate.isCurrentFolder) {
                    return false;
                }
                if (candidate.is_archive_member && candidate.can_extract) {
                    return true;
                }
                if (!(candidate.can_edit || candidate.can_delete)) {
                    return false;
                }
                return !(candidate.type === "file" && candidate.is_public_write);
            });

            const normalized = pruneNestedDragEntries(movableEntries);
            normalized.sort(function (left, right) {
                const leftDepth = left.path.split("/").length;
                const rightDepth = right.path.split("/").length;
                if (leftDepth !== rightDepth) {
                    return leftDepth - rightDepth;
                }
                return left.path.localeCompare(right.path);
            });
            return normalized;
        }

        function getCurrentFolderName(pathValue) {
            const currentMeta = getCurrentDirMeta();
            const normalized = normalizePath(pathValue, true);
            if (currentMeta && currentMeta.is_archive_virtual && currentMeta.archive_path) {
                const archiveRootPath = getArchiveVirtualRootPath(currentMeta);
                const metaPath = normalizePath(currentMeta.path || state.currentDir, true);
                const isArchiveDisplayPath = normalized === archiveRootPath ||
                    normalized === metaPath ||
                    (archiveRootPath && normalized.startsWith(archiveRootPath + "/")) ||
                    (metaPath && normalized.startsWith(metaPath + "/"));
                if (isArchiveDisplayPath) {
                    const memberPath = resolveArchiveMemberPathForDisplayPath(normalized || metaPath, currentMeta);
                    if (memberPath) {
                        return getPathLeafLabel(memberPath, memberPath);
                    }
                    return getPathLeafLabel(currentMeta.archive_path, "archive.zip");
                }
            }
            if (
                currentMeta &&
                currentMeta.is_git_repo_root &&
                currentMeta.git_repo &&
                currentMeta.git_repo.provider === "github" &&
                currentMeta.git_repo.repo_name
            ) {
                return currentMeta.git_repo.repo_name;
            }
            if (currentMeta && currentMeta.is_google_drive && currentMeta.google_drive && currentMeta.google_drive.name) {
                return String(currentMeta.google_drive.name || "").trim();
            }
            if (!normalized) {
                return effectiveRootLabel;
            }
            const parts = normalized.split("/");
            return parts[parts.length - 1] || effectiveRootLabel;
        }

        function normalizeDirectoryMetaForPath(baseMeta, incomingMeta, fallbackPath) {
            const rawMeta = incomingMeta || {};
            const normalizedPath = normalizePath(rawMeta.path !== undefined ? rawMeta.path : fallbackPath, true);
            const nextMeta = Object.assign({}, baseMeta || {}, rawMeta, { path: normalizedPath });
            if (rawMeta.is_archive_virtual === undefined && rawMeta.archive_path === undefined && rawMeta.archive_member_path === undefined) {
                nextMeta.is_archive_virtual = false;
                nextMeta.archive_path = "";
                nextMeta.archive_member_path = "";
                nextMeta.archive_can_edit = false;
                nextMeta.archive_can_delete = false;
            }
            if (!nextMeta.is_archive_virtual) {
                nextMeta.archive_path = "";
                nextMeta.archive_member_path = "";
                nextMeta.archive_can_edit = false;
                nextMeta.archive_can_delete = false;
            }
            if (rawMeta.is_google_drive === undefined && rawMeta.google_drive === undefined) {
                nextMeta.is_google_drive = false;
                nextMeta.google_drive = null;
            }
            if (!Array.isArray(nextMeta.share_allowed_users)) {
                nextMeta.share_allowed_users = [];
            }
            return nextMeta;
        }

        function getCurrentDirMeta() {
            const cachedMeta = state.directoryMetaCache.get(state.currentDir);
            if (cachedMeta && typeof cachedMeta === "object") {
                state.currentDirMeta = normalizeDirectoryMetaForPath(state.currentDirMeta || {}, cachedMeta, state.currentDir);
            }
            return state.currentDirMeta || {};
        }

        function canDeleteCurrentDirectoryMeta(currentDirMeta) {
            const meta = currentDirMeta || {};
            const currentPath = normalizePath(state.currentDir || meta.path || "", true);
            return Boolean(
                currentPath &&
                !meta.is_root &&
                !meta.is_archive_virtual &&
                !meta.is_google_drive &&
                !meta.is_git_repo_root &&
                !meta.requires_commit_message &&
                !meta.git_branch_root &&
                !meta.git_repo &&
                meta.can_edit
            );
        }

        function applyCurrentDirectoryMeta(meta) {
            const nextMeta = normalizeDirectoryMetaForPath(state.currentDirMeta || {}, meta || {}, state.currentDir);
            const normalizedPath = normalizePath(nextMeta.path, true);
            state.currentDir = normalizedPath;
            state.currentDirMeta = nextMeta;
            state.directoryMetaCache.set(normalizedPath, nextMeta);
            registerGithubRepoLabelFromMeta(nextMeta);
            root.dataset.currentDir = normalizedPath;
            root.dataset.currentDirIsRoot = nextMeta.is_root ? "1" : "0";
            root.dataset.currentDirCanEdit = nextMeta.can_edit ? "1" : "0";
            root.dataset.currentDirCanWriteChildren = nextMeta.can_write_children ? "1" : "0";
            root.dataset.currentDirHasChildren = nextMeta.has_children ? "1" : "0";
            root.dataset.currentDirIsGitRepoRoot = nextMeta.is_git_repo_root ? "1" : "0";
            root.dataset.currentDirIsGoogleDrive = nextMeta.is_google_drive ? "1" : "0";
            root.dataset.currentDirRequiresCommitMessage = nextMeta.requires_commit_message ? "1" : "0";
            root.dataset.currentDirGitBranchRoot = nextMeta.git_branch_root ? "1" : "0";
            root.dataset.currentDirGitCommitId = nextMeta.git_commit_id || "";
            root.dataset.currentDirGitCommitMessage = nextMeta.git_commit_message || "";
            root.dataset.currentDirGitCommitAuthorUsername = nextMeta.git_commit_author_username || "";
            root.dataset.currentDirModifiedDisplay = nextMeta.modified_display || "";
            root.dataset.currentDirSizeDisplay = nextMeta.size_display || "";
            root.dataset.currentDirIsUrlOnly = nextMeta.is_url_only ? "1" : "0";
            root.dataset.currentDirShareUrl = nextMeta.share_url || "";
            root.dataset.currentDirShareDownloadUrl = nextMeta.share_download_url || "";
            root.dataset.currentDirShareIsInherited = nextMeta.share_is_inherited ? "1" : "0";
            root.dataset.currentDirIsArchiveVirtual = nextMeta.is_archive_virtual ? "1" : "0";
            root.dataset.currentDirArchivePath = nextMeta.archive_path || "";
            root.dataset.currentDirArchiveMemberPath = nextMeta.archive_member_path || "";
            root.dataset.currentDirArchiveCanEdit = nextMeta.archive_can_edit ? "1" : "0";
            root.dataset.currentDirArchiveCanDelete = nextMeta.archive_can_delete ? "1" : "0";
            currentDirGitRepo = nextMeta.git_repo || null;
            currentDirGoogleDrive = nextMeta.google_drive || null;
            registerGoogleDriveLabelFromMeta(nextMeta);
            syncArchiveToolbarActions();
        }

        function buildCurrentDirectoryEntry() {
            const currentDirMeta = getCurrentDirMeta();
            return {
                path: state.currentDir,
                type: "dir",
                isCurrentFolder: true,
                is_root: Boolean(currentDirMeta.is_root),
                can_edit: Boolean(currentDirMeta.can_edit),
                can_write_children: Boolean(currentDirMeta.can_write_children),
                can_delete: Boolean(
                    canDeleteCurrentDirectoryMeta(currentDirMeta) ||
                    (currentDirMeta.git_repo && currentDirMeta.is_git_repo_root) ||
                    (currentDirMeta.is_google_drive && currentDirMeta.can_delete)
                ),
                requires_commit_message: Boolean(currentDirMeta.requires_commit_message),
                git_repo: currentDirMeta.is_git_repo_root ? (currentDirMeta.git_repo || null) : null,
                git_repo_meta: currentDirMeta.git_repo || null,
                google_drive: currentDirMeta.google_drive || null,
                is_google_drive: Boolean(currentDirMeta.is_google_drive),
                is_archive_virtual: Boolean(currentDirMeta.is_archive_virtual),
                archive_path: currentDirMeta.archive_path || "",
                archive_member_path: currentDirMeta.archive_member_path || "",
                archive_can_edit: Boolean(currentDirMeta.archive_can_edit),
                archive_can_delete: Boolean(currentDirMeta.archive_can_delete),
                git_branch_root: Boolean(currentDirMeta.git_branch_root),
                is_git_virtual: Boolean(currentDirMeta.git_repo || currentDirMeta.git_branch_root || currentDirMeta.requires_commit_message),
                git_commit_id: currentDirMeta.git_commit_id || "",
                git_commit_message: currentDirMeta.git_commit_message || "",
                git_commit_author_username: currentDirMeta.git_commit_author_username || "",
                write_acl_labels: Array.isArray(currentDirMeta.write_acl_labels) ? currentDirMeta.write_acl_labels : [],
                is_public_write: false,
                is_url_only: Boolean(currentDirMeta.is_url_only),
                share_url: currentDirMeta.share_url || "",
                share_download_url: currentDirMeta.share_download_url || "",
                share_is_inherited: Boolean(currentDirMeta.share_is_inherited),
                share_allowed_users: Array.isArray(currentDirMeta.share_allowed_users) ? currentDirMeta.share_allowed_users : [],
                modified_display: currentDirMeta.modified_display || "",
                size_display: currentDirMeta.size_display || "",
            };
        }

        function buildCurrentDirectoryToolbarEntry() {
            const currentDirMeta = getCurrentDirMeta();
            const currentPath = normalizePath(state.currentDir || currentDirMeta.path || "", true);
            if (
                !currentDirMeta ||
                !currentPath ||
                currentDirMeta.is_root ||
                currentDirMeta.is_archive_virtual ||
                currentDirMeta.is_google_drive ||
                currentDirMeta.is_git_repo_root ||
                currentDirMeta.requires_commit_message ||
                currentDirMeta.git_branch_root ||
                currentDirMeta.git_repo
            ) {
                return null;
            }
            const canDeleteCurrentDir = canDeleteCurrentDirectoryMeta(currentDirMeta);
            if (!canDeleteCurrentDir) {
                return null;
            }
            return {
                path: currentPath,
                name: getCurrentFolderName(currentPath),
                type: "dir",
                isCurrentFolder: true,
                can_read: true,
                can_edit: true,
                can_delete: true,
                can_write_children: Boolean(currentDirMeta.can_write_children),
                is_public_write: false,
                is_url_only: Boolean(currentDirMeta.is_url_only),
                share_url: currentDirMeta.share_url || "",
                share_download_url: currentDirMeta.share_download_url || "",
                share_is_inherited: Boolean(currentDirMeta.share_is_inherited),
                share_allowed_users: Array.isArray(currentDirMeta.share_allowed_users) ? currentDirMeta.share_allowed_users : [],
                modified_display: currentDirMeta.modified_display || "",
                size_display: currentDirMeta.size_display || "",
            };
        }

        function buildCurrentArchiveFileEntry() {
            const currentDirMeta = getCurrentDirMeta();
            if (!currentDirMeta || !currentDirMeta.is_archive_virtual || !currentDirMeta.archive_path) {
                return null;
            }
            const archivePath = normalizePath(currentDirMeta.archive_path, true);
            if (!archivePath) {
                return null;
            }
            return {
                path: archivePath,
                name: getPathLeafLabel(archivePath, archivePath),
                type: "file",
                can_read: true,
                can_edit: Boolean(currentDirMeta.archive_can_edit),
                can_delete: Boolean(currentDirMeta.archive_can_delete),
                is_public_write: false,
                is_url_only: Boolean(currentDirMeta.is_url_only),
                share_url: currentDirMeta.share_url || "",
                share_download_url: currentDirMeta.share_download_url || "",
                share_is_inherited: Boolean(currentDirMeta.share_is_inherited),
                share_allowed_users: Array.isArray(currentDirMeta.share_allowed_users) ? currentDirMeta.share_allowed_users : [],
                modified_display: currentDirMeta.modified_display || "",
                size_display: currentDirMeta.size_display || "",
            };
        }

        function syncArchiveToolbarActions() {
            const currentDirEntry = buildCurrentDirectoryToolbarEntry();
            const canShowCurrentDirActions = Boolean(currentDirEntry);
            if (currentDirToolbarUrlShareButton) {
                currentDirToolbarUrlShareButton.hidden = !(canShowCurrentDirActions && urlShareApiUrl);
            }
            if (currentDirToolbarDeleteButton) {
                currentDirToolbarDeleteButton.hidden = !(canShowCurrentDirActions && deleteApiUrl);
            }

            const archiveEntry = buildCurrentArchiveFileEntry();
            const canShowArchiveActions = Boolean(archiveEntry);
            const canEditArchive = Boolean(archiveEntry && archiveEntry.can_edit);
            const canDeleteArchive = Boolean(archiveEntry && archiveEntry.can_delete);

            if (archiveToolbarUrlShareButton) {
                archiveToolbarUrlShareButton.hidden = !(canShowArchiveActions && canEditArchive && urlShareApiUrl);
            }
            if (archiveToolbarDownloadButton) {
                const downloadUrl = archiveEntry ? buildDownloadUrl(archiveEntry.path) : "";
                archiveToolbarDownloadButton.hidden = !downloadUrl;
                if (downloadUrl) {
                    archiveToolbarDownloadButton.href = downloadUrl;
                } else {
                    archiveToolbarDownloadButton.removeAttribute("href");
                }
            }
            if (archiveToolbarDeleteButton) {
                archiveToolbarDeleteButton.hidden = !(canShowArchiveActions && canDeleteArchive);
            }
        }

        async function deleteCurrentDirectory() {
            const currentDirEntry = buildCurrentDirectoryToolbarEntry();
            if (!currentDirEntry || !currentDirEntry.can_delete || !deleteApiUrl) {
                return;
            }
            const confirmed = await requestConfirmDialog({
                title: t("delete_button", "삭제"),
                message: formatTemplate(
                    t("js_confirm_delete_entry", "정말 삭제할까요?\n{path}"),
                    { path: getHandrivePathLabel(currentDirEntry.path) }
                ),
                cancelText: t("cancel", "취소"),
                confirmText: t("delete_button", "삭제")
            });
            if (!confirmed) {
                return;
            }
            await requestJson(deleteApiUrl, buildPostOptions({ path: currentDirEntry.path }));
            state.directoryCache.delete(state.currentDir);
            state.directoryMetaCache.delete(state.currentDir);
            await navigateToDirectory(getParentDirectory(currentDirEntry.path), { historyMode: "replace" });
        }

        async function deleteCurrentArchiveFile() {
            const archiveEntry = buildCurrentArchiveFileEntry();
            if (!archiveEntry || !archiveEntry.can_delete || !deleteApiUrl) {
                return;
            }
            const confirmed = await requestConfirmDialog({
                title: t("delete_button", "삭제"),
                message: formatTemplate(
                    t("js_confirm_delete_entry", "정말 삭제할까요?\n{path}"),
                    { path: getHandrivePathLabel(archiveEntry.path) }
                ),
                cancelText: t("cancel", "취소"),
                confirmText: t("delete_button", "삭제")
            });
            if (!confirmed) {
                return;
            }
            await requestJson(deleteApiUrl, buildPostOptions({ path: archiveEntry.path }));
            state.directoryCache.delete(state.currentDir);
            state.directoryMetaCache.delete(state.currentDir);
            await navigateToDirectory(getParentDirectory(archiveEntry.path), { historyMode: "replace" });
        }

        let commitTooltipEl = null;

        function ensureCommitTooltip() {
            if (commitTooltipEl) {
                return commitTooltipEl;
            }
            commitTooltipEl = document.createElement("div");
            commitTooltipEl.className = "handrive-commit-tooltip";
            commitTooltipEl.hidden = true;
            commitTooltipEl.setAttribute("role", "tooltip");
            document.body.appendChild(commitTooltipEl);
            return commitTooltipEl;
        }

        function positionCommitTooltip(anchorX, anchorY) {
            const tooltip = ensureCommitTooltip();
            const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
            const offset = 14;
            tooltip.hidden = false;
            const rect = tooltip.getBoundingClientRect();
            const placeLeft = anchorX > viewportWidth / 2;
            const placeAbove = anchorY > viewportHeight / 2;
            let left = placeLeft ? anchorX - rect.width - offset : anchorX + offset;
            let top = placeAbove ? anchorY - rect.height - offset : anchorY + offset;
            left = Math.max(8, Math.min(left, Math.max(8, viewportWidth - rect.width - 8)));
            top = Math.max(8, Math.min(top, Math.max(8, viewportHeight - rect.height - 8)));
            tooltip.style.left = String(Math.round(left)) + "px";
            tooltip.style.top = String(Math.round(top)) + "px";
        }

        function showCommitTooltip(message, anchorX, anchorY) {
            const normalizedMessage = String(message || "").trim();
            if (!normalizedMessage) {
                return;
            }
            const tooltip = ensureCommitTooltip();
            tooltip.textContent = normalizedMessage;
            positionCommitTooltip(anchorX, anchorY);
        }

        function hideCommitTooltip() {
            if (!commitTooltipEl) {
                return;
            }
            commitTooltipEl.hidden = true;
        }

        function bindCommitTooltip(commitField, commitSubject) {
            const normalizedSubject = String(commitSubject || "").trim();
            if (!commitField || !normalizedSubject) {
                return;
            }
            commitField.classList.add("has-commit-tooltip");
            commitField.dataset.commitSubject = normalizedSubject;
            commitField.addEventListener("pointerenter", function (event) {
                showCommitTooltip(normalizedSubject, event.clientX, event.clientY);
            });
            commitField.addEventListener("pointermove", function (event) {
                showCommitTooltip(normalizedSubject, event.clientX, event.clientY);
            });
            commitField.addEventListener("pointerleave", hideCommitTooltip);
        }

        function appendEntryMetaColumns(row, entry) {
            if (!row) {
                return;
            }
            const safeEntry = entry || {};
            const metaTrail = ensureEntryMetaTrail(row);
            if (!metaTrail) {
                return;
            }
            const modifiedField = createEntryMetaField("handrive-item-modified", safeEntry.modified_display || "");
            modifiedField.setAttribute("data-sort-key", "modified");
            const typeField = createEntryMetaField("handrive-item-type", resolveEntryTypeLabel(safeEntry));
            typeField.setAttribute("data-sort-key", "type");
            const sizeField = createEntryMetaField("handrive-item-size", safeEntry.size_display || "");
            sizeField.setAttribute("data-sort-key", "size");
            const commitField = createEntryMetaField("handrive-item-commit", resolveEntryCommitMeta(safeEntry));
            commitField.setAttribute("data-sort-key", "commit");
            bindCommitTooltip(commitField, resolveEntryCommitSubject(safeEntry));
            const idField = createEntryMetaField("handrive-item-id", resolveEntryIdMeta(safeEntry));
            idField.setAttribute("data-sort-key", "id");
            metaTrail.appendChild(modifiedField);
            metaTrail.appendChild(typeField);
            metaTrail.appendChild(sizeField);
            metaTrail.appendChild(commitField);
            metaTrail.appendChild(idField);
        }

        function openUrlShareDialogForEntry(entry) {
            if (!entry || !entry.path) {
                return;
            }
            const canToggleShare = Boolean(entry.can_edit && urlShareApiUrl && !entry.share_is_inherited);
            const shouldShowDownloadUrl = isSimpleUrlShareFileEntry(entry);
            urlShareModal.open({
                isUrlOnly: Boolean(entry.is_url_only || entry.share_url || entry.share_is_inherited),
                shareUrl: entry.share_url || "",
                downloadUrl: shouldShowDownloadUrl ? toAbsoluteUrl(entry.share_download_url || "") : "",
                allowedUsers: entry.share_allowed_users || [],
                readOnly: !canToggleShare,
                onToggle: canToggleShare ? async function (enabled, allowedUsernames) {
                    const data = await requestJson(
                        appendSharedQuery(urlShareApiUrl),
                        buildPostOptions({
                            path: entry.path,
                            enabled: enabled,
                            allowed_usernames: allowedUsernames || [],
                        })
                    );
                    await refreshCurrentDirectory();
                    return {
                        isUrlOnly: Boolean(data.is_url_only),
                        shareUrl: data.share_url || "",
                        downloadUrl: shouldShowDownloadUrl ? toAbsoluteUrl(data.share_download_url || "") : "",
                        allowedUsers: data.share_allowed_users || [],
                    };
                } : null,
            });
        }

        function appendUrlShareIndicator(nameWrap, entry) {
            if (!nameWrap || !entry) {
                return;
            }
            const isDirectlyShared = Boolean(!entry.share_is_inherited && (entry.is_url_only || entry.share_url));
            if (!isDirectlyShared) {
                return;
            }
            const label = t("url_share_indicator", "URL 공유됨");
            nameWrap.classList.add("has-url-share-indicator");
            const indicator = document.createElement("span");
            indicator.className = "handrive-icon-btn handrive-item-url-share-indicator handrive-item-meta-label";
            indicator.setAttribute("role", "button");
            indicator.setAttribute("aria-label", label);
            indicator.tabIndex = 0;
            indicator.title = label;
            indicator.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true"><path fill="currentColor" d="M10.59 13.41c.41.39.41 1.03 0 1.42-.39.39-1.03.39-1.42 0a5.003 5.003 0 0 1 0-7.07l3.54-3.54a5.003 5.003 0 0 1 7.07 0 5.003 5.003 0 0 1 0 7.07l-1.49 1.49c.01-.82-.12-1.64-.4-2.42l.47-.48a3.001 3.001 0 0 0 0-4.24 3.001 3.001 0 0 0-4.24 0l-3.53 3.53a3.001 3.001 0 0 0 0 4.24zm2.82-2.82c-.39-.39-.39-1.03 0-1.42.39-.39 1.03-.39 1.42 0a5.003 5.003 0 0 1 0 7.07l-3.54 3.54a5.003 5.003 0 0 1-7.07 0 5.003 5.003 0 0 1 0-7.07l1.49-1.49c-.01.82.12 1.64.4 2.42l-.47.48a3.001 3.001 0 0 0 0 4.24 3.001 3.001 0 0 0 4.24 0l3.53-3.53a3.001 3.001 0 0 0 0-4.24z"/></svg>';
            indicator.addEventListener("pointerdown", function (event) {
                event.stopPropagation();
            });
            indicator.addEventListener("click", function (event) {
                event.preventDefault();
                event.stopPropagation();
                openUrlShareDialogForEntry(entry);
            });
            indicator.addEventListener("dblclick", function (event) {
                event.preventDefault();
                event.stopPropagation();
            });
            indicator.addEventListener("keydown", function (event) {
                if (event.key !== "Enter" && event.key !== " ") {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                openUrlShareDialogForEntry(entry);
            });
            nameWrap.appendChild(indicator);
        }

        function appendCurrentDirMetaColumns(row) {
            if (!row) {
                return;
            }
            const metaTrail = ensureEntryMetaTrail(row);
            if (!metaTrail) {
                return;
            }
            const modifiedField = createEntryMetaField("handrive-item-modified", t("list_sort_modified", textByLang("수정한 날짜", "Modified")));
            modifiedField.setAttribute("data-sort-key", "modified");
            const typeField = createEntryMetaField("handrive-item-type", t("list_sort_type", textByLang("유형", "Type")));
            typeField.setAttribute("data-sort-key", "type");
            const sizeField = createEntryMetaField("handrive-item-size", t("list_sort_size", textByLang("크기", "Size")));
            sizeField.setAttribute("data-sort-key", "size");
            const commitField = createEntryMetaField("handrive-item-commit", t("list_sort_commit", textByLang("커밋", "Commit")));
            commitField.setAttribute("data-sort-key", "commit");
            const idField = createEntryMetaField("handrive-item-id", t("list_sort_id", "ID"));
            idField.setAttribute("data-sort-key", "id");
            metaTrail.appendChild(modifiedField);
            metaTrail.appendChild(typeField);
            metaTrail.appendChild(sizeField);
            metaTrail.appendChild(commitField);
            metaTrail.appendChild(idField);
        }

        function ensureEntryMetaTrail(row) {
            if (!row) {
                return null;
            }
            let metaTrail = row.querySelector(".handrive-item-meta-trail");
            if (metaTrail) {
                return metaTrail;
            }
            metaTrail = document.createElement("span");
            metaTrail.className = "handrive-item-meta-trail";
            row.appendChild(metaTrail);
            return metaTrail;
        }

        function syncSearchInputValues(value, sourceInput) {
            const nextValue = String(value || "");
            if (listSearchInput && listSearchInput !== sourceInput && listSearchInput.value !== nextValue) {
                listSearchInput.value = nextValue;
            }
            if (currentDirSearchInput && currentDirSearchInput !== sourceInput && currentDirSearchInput.value !== nextValue) {
                currentDirSearchInput.value = nextValue;
            }
            updateSearchClearButtonVisibility();
        }

        function updateSearchClearButtonVisibility() {
            const hasValue = Boolean(String(listSearchInput && listSearchInput.value || "").length);
            if (listSearchClearButton) {
                listSearchClearButton.hidden = !hasValue;
            }
            if (currentDirSearchInput) {
                const clearButton = currentDirSearchInput
                    .closest(".handrive-current-dir-search-wrap")
                    ?.querySelector(".handrive-current-dir-search-clear");
                if (clearButton) {
                    clearButton.hidden = !Boolean(String(currentDirSearchInput.value || "").length);
                }
            }
        }

        function isCurrentDirInlineSearchVisible() {
            return Boolean(
                currentDirSearchInput &&
                currentDirSearchInput.closest(".handrive-current-dir-search-wrap:not([hidden])")
            );
        }

        function getSearchInputForCurrentContext(sourceInput) {
            if (sourceInput) {
                return sourceInput;
            }
            if (currentDirSearchInput && document.activeElement === currentDirSearchInput) {
                return currentDirSearchInput;
            }
            if (isCurrentDirInlineSearchVisible()) {
                return currentDirSearchInput;
            }
            return listSearchInput;
        }

        function getDirectChildByClass(element, className) {
            if (!element) {
                return null;
            }
            const children = element.children || [];
            for (let i = 0; i < children.length; i += 1) {
                if (children[i].classList && children[i].classList.contains(className)) {
                    return children[i];
                }
            }
            return null;
        }

        function buildListSearchFormFallback() {
            const form = document.createElement("div");
            form.className = "ui-search-form handrive-list-search-form";
            form.id = "handrive-list-search-form";

            const submitButton = document.createElement("button");
            submitButton.className = "root-search-submit handrive-list-search-submit";
            submitButton.id = "handrive-list-search-submit";
            submitButton.type = "button";
            submitButton.setAttribute("aria-label", t("search_button", textByLang("검색", "Search")));
            submitButton.title = t("search_button", textByLang("검색", "Search"));

            const submitIcon = document.createElement("span");
            submitIcon.className = "root-search-submit-icon";
            submitIcon.setAttribute("aria-hidden", "true");
            submitButton.appendChild(submitIcon);

            const label = document.createElement("label");
            label.className = "root-search-sr-only";
            label.setAttribute("for", "handriveListSearchInput");
            label.textContent = t("search_button", textByLang("검색", "Search"));

            const input = document.createElement("input");
            input.id = "handriveListSearchInput";
            input.className = "root-search-input handrive-list-search-input";
            input.type = "text";
            input.autocomplete = "off";
            input.spellcheck = false;
            input.placeholder = t("search_placeholder", textByLang("파일 검색", "Search files"));

            const clearButton = document.createElement("button");
            clearButton.className = "root-input-clear handrive-list-search-clear";
            clearButton.id = "handrive-list-search-clear";
            clearButton.type = "button";
            clearButton.hidden = true;
            clearButton.setAttribute("aria-label", t("clear_button", textByLang("지우기", "Clear")));
            clearButton.title = t("clear_button", textByLang("지우기", "Clear"));

            form.appendChild(submitButton);
            form.appendChild(label);
            form.appendChild(input);
            form.appendChild(clearButton);
            return form;
        }

        function ensureListSearchForm() {
            if (listSearchForm && listSearchInput) {
                return listSearchForm;
            }
            const template = document.getElementById("handrive-list-search-form-template");
            const clonedForm = template && template.content && template.content.firstElementChild
                ? template.content.firstElementChild.cloneNode(true)
                : buildListSearchFormFallback();
            if (!clonedForm) {
                return null;
            }
            listSearchForm = clonedForm;
            listSearchInput = listSearchForm.querySelector("#handriveListSearchInput");
            listSearchSubmitButton = listSearchForm.querySelector("#handrive-list-search-submit");
            listSearchClearButton = listSearchForm.querySelector("#handrive-list-search-clear");
            return listSearchForm;
        }

        function bindListSearchFormRowEvents() {
            ensureListSearchForm();
            if (!listSearchForm || listSearchForm.dataset.handriveRowSearchBound === "1") {
                return;
            }
            listSearchForm.dataset.handriveRowSearchBound = "1";
            ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "contextmenu"].forEach(function (eventName) {
                listSearchForm.addEventListener(eventName, function (event) {
                    event.stopPropagation();
                });
            });
        }

        function attachListSearchFormToCurrentDirRow(row) {
            const searchForm = ensureListSearchForm();
            if (!row || !searchForm) {
                return;
            }
            const previousRow = searchForm.closest(".handrive-current-dir-row");
            if (previousRow && previousRow !== row) {
                previousRow.classList.remove("has-list-search");
            }
            bindListSearchFormRowEvents();
            row.classList.add("has-list-search");
            row.classList.remove("has-inline-search");
            searchForm.classList.remove("is-search-hidden");
            searchForm.hidden = false;
            const nameWrap = getDirectChildByClass(row, "handrive-item-name-wrap");
            if (!nameWrap) {
                return;
            }
            if (searchForm.parentNode !== nameWrap) {
                nameWrap.appendChild(searchForm);
            }
        }

        function ensureCurrentDirInlineSearch(row) {
            if (!row) {
                return null;
            }
            const bindCurrentDirSearchButton = function (button, input) {
                if (!button || !input || button.dataset.handriveSearchBound === "1") {
                    return;
                }
                button.dataset.handriveSearchBound = "1";
                button.addEventListener("click", function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    syncSearchInputValues(input.value, input);
                    applyListSearch(input).catch(alertError);
                });
            };
            const bindCurrentDirClearButton = function (button, input) {
                if (!button || !input || button.dataset.handriveClearBound === "1") {
                    return;
                }
                button.dataset.handriveClearBound = "1";
                button.addEventListener("click", function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    input.value = "";
                    syncSearchInputValues("", input);
                    applyListSearch(input).catch(alertError);
                    input.focus();
                });
            };
            const createCurrentDirSearchButton = function (input) {
                const button = document.createElement("button");
                button.className = "handrive-current-dir-search-button";
                button.type = "button";
                button.setAttribute("aria-label", t("search_button", textByLang("검색", "Search")));
                button.title = t("search_button", textByLang("검색", "Search"));
                bindCurrentDirSearchButton(button, input);
                return button;
            };
            const createCurrentDirClearButton = function (input) {
                const button = document.createElement("button");
                button.className = "root-input-clear handrive-current-dir-search-clear";
                button.type = "button";
                button.hidden = true;
                button.setAttribute("aria-label", t("clear_button", textByLang("지우기", "Clear")));
                button.title = t("clear_button", textByLang("지우기", "Clear"));
                bindCurrentDirClearButton(button, input);
                return button;
            };
            let wrap = row.querySelector(".handrive-current-dir-search-wrap");
            if (wrap) {
                currentDirSearchInput = wrap.querySelector(".handrive-current-dir-search-input");
                const existingButton = wrap.querySelector(".handrive-current-dir-search-button");
                if (existingButton && currentDirSearchInput) {
                    bindCurrentDirSearchButton(existingButton, currentDirSearchInput);
                } else if (currentDirSearchInput) {
                    wrap.insertBefore(createCurrentDirSearchButton(currentDirSearchInput), currentDirSearchInput);
                }
                const existingClearButton = wrap.querySelector(".handrive-current-dir-search-clear");
                if (existingClearButton && currentDirSearchInput) {
                    bindCurrentDirClearButton(existingClearButton, currentDirSearchInput);
                } else if (currentDirSearchInput) {
                    wrap.appendChild(createCurrentDirClearButton(currentDirSearchInput));
                }
                updateSearchClearButtonVisibility();
                return wrap;
            }

            wrap = document.createElement("span");
            wrap.className = "handrive-current-dir-search-wrap";
            wrap.hidden = true;

            const input = document.createElement("input");
            input.className = "root-search-input handrive-current-dir-search-input";
            input.type = "text";
            input.autocomplete = "off";
            input.spellcheck = false;
            input.placeholder = t("search_placeholder", textByLang("파일 검색", "Search files"));
            input.setAttribute("aria-label", t("search_button", textByLang("검색", "Search")));

            ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "contextmenu"].forEach(function (eventName) {
                wrap.addEventListener(eventName, function (event) {
                    event.stopPropagation();
                });
            });
            input.addEventListener("input", function () {
                syncSearchInputValues(input.value, input);
            });
            input.addEventListener("keydown", function (event) {
                event.stopPropagation();
                if (event.key === "Enter") {
                    event.preventDefault();
                    applyListSearch(input).catch(alertError);
                    return;
                }
                if (event.key === "Escape") {
                    event.preventDefault();
                    input.value = "";
                    syncSearchInputValues("", input);
                    applyListSearch(input).catch(alertError);
                }
            });

            wrap.appendChild(createCurrentDirSearchButton(input));
            wrap.appendChild(input);
            wrap.appendChild(createCurrentDirClearButton(input));
            row.appendChild(wrap);
            currentDirSearchInput = input;
            syncSearchInputValues(listSearchInput ? listSearchInput.value : state.searchQuery, null);
            return wrap;
        }

        function syncCurrentDirInlineSearchVisibility(visible) {
            if (listSearchForm && listSearchForm.closest(".handrive-current-dir-row")) {
                visible = false;
            }
            const currentDirRow = listContainer
                ? listContainer.querySelector(".handrive-current-dir-row")
                : null;
            if (!visible && !currentDirSearchInput) {
                if (currentDirRow) {
                    currentDirRow.classList.remove("has-inline-search");
                }
                updateListColumnVisibility();
                return;
            }
            const wrap = ensureCurrentDirInlineSearch(currentDirRow);
            if (!currentDirRow || !wrap) {
                return;
            }
            const shouldShow = Boolean(visible);
            currentDirRow.classList.toggle("has-inline-search", shouldShow);
            wrap.hidden = !shouldShow;
            if (currentDirSearchInput) {
                currentDirSearchInput.tabIndex = shouldShow ? 0 : -1;
            }
            syncSearchInputValues(listSearchInput ? listSearchInput.value : state.searchQuery, null);
            if (shouldShow && document.activeElement === listSearchInput && currentDirSearchInput) {
                currentDirSearchInput.focus();
                currentDirSearchInput.setSelectionRange(currentDirSearchInput.value.length, currentDirSearchInput.value.length);
            } else if (!shouldShow && document.activeElement === currentDirSearchInput && listSearchInput) {
                listSearchInput.focus();
                listSearchInput.setSelectionRange(listSearchInput.value.length, listSearchInput.value.length);
            }
            updateListColumnVisibility();
        }

        function addCurrentDirectoryNode(fragment) {
            const currentFolderEntry = buildCurrentDirectoryEntry();
            const currentDirMeta = getCurrentDirMeta();

            const item = document.createElement("li");
            item.className = "handrive-item handrive-current-dir-item";

            const row = document.createElement("div");
            row.className = "handrive-item-row handrive-current-dir-row";
            row.setAttribute("role", "button");
            row.tabIndex = 0;
            row.setAttribute("data-entry-path", currentFolderEntry.path);
            state.entryRowByPath.set(currentFolderEntry.path, row);
            row.draggable = false;
            if (state.selectedPaths.has(currentFolderEntry.path) || normalizePath(currentFolderEntry.path, true) === state.activePreviewPath) {
                row.classList.add("is-selected");
            }

            const typeMarker = createTypeMarker({
                isDir: true,
                isRootAvatar: Boolean(currentDirMeta.is_root),
                accountProfileImageUrl: accountProfileImageUrl,
                isGoogleDrive: isGoogleDriveRootMeta(currentDirMeta),
                isGithubRepo: Boolean(currentDirMeta.is_git_repo_root && currentDirMeta.git_repo && currentDirMeta.git_repo.provider === "github"),
                isRepo: Boolean(currentDirMeta.is_git_repo_root),
                isBranch: Boolean(currentDirMeta.git_branch_root),
                isEmpty: !currentDirMeta.has_children,
            });
            bindAdminUserSwitchAvatar(typeMarker, currentDirMeta);

            const name = document.createElement("span");
            name.className = "handrive-item-name";
            name.textContent = getCurrentFolderName(state.currentDir);

            const nameWrap = document.createElement("span");
            nameWrap.className = "handrive-item-name-wrap";

            row.appendChild(typeMarker);
            row.appendChild(nameWrap);
            nameWrap.appendChild(name);
            appendUrlShareIndicator(nameWrap, currentFolderEntry);

            appendCurrentDirRepoName(nameWrap, currentDirMeta.git_repo || null, {
                showForBranchOrRepoInner: Boolean(currentDirMeta.git_branch_root || currentDirMeta.requires_commit_message),
            });
            appendCurrentDirMetaColumns(row);
            attachListSearchFormToCurrentDirRow(row);
            bindCurrentDirSortControls(row);

            row.addEventListener("click", function (event) {
                if (event.button !== 0) { return; }
                event.preventDefault();
                closeContextMenu();
                closePreviewPaneIfOpen();
                selectEntriesByRowClick(currentFolderEntry, event);
                if (shouldOpenGoogleDrivePickerOnClick(currentFolderEntry, event)) {
                    openGoogleDriveItemPicker().catch(alertError);
                }
            });

            row.addEventListener("contextmenu", function (event) {
                event.preventDefault();
                openContextMenuForEntry(currentFolderEntry, event.clientX, event.clientY);
            });

            row.addEventListener("keydown", function (event) {
                if (isKeyboardEditableTarget(event.target)) {
                    return;
                }
                if (event.key !== "Enter" && event.key !== " ") {
                    return;
                }
                event.preventDefault();
                closeContextMenu();
                selectEntriesByRowClick(currentFolderEntry, event);
            });

            if (currentFolderEntry.can_write_children) {
                bindDropTarget(row, currentFolderEntry.path, { allowSameParent: true });
            }

            state.entryByPath.set(currentFolderEntry.path, currentFolderEntry);
            state.visibleEntryPaths.push(currentFolderEntry.path);
            item.appendChild(row);
            fragment.appendChild(item);
        }

        function isSyncPathChecked(pathValue) {
            const normalized = normalizePath(pathValue, true);
            for (const uncheckedPath of state.syncDraftUncheckedPaths) {
                if (uncheckedPath === normalized) {
                    return false;
                }
                if (uncheckedPath && normalized && normalized.startsWith(uncheckedPath + "/")) {
                    return false;
                }
                if (normalized && uncheckedPath.startsWith(normalized + "/")) {
                    return false;
                }
                if (!normalized && uncheckedPath) {
                    return false;
                }
            }
            return true;
        }

        function isSyncHiddenEntry(entry) {
            return Boolean(
                entry
                && entry.type === "dir"
                && (entry.git_repo || entry.github_repo || entry.google_drive || entry.git_branch_root || entry.is_git_virtual)
            );
        }

        function pruneSyncUncheckedPaths(pathValue, options) {
            const normalized = normalizePath(pathValue, true);
            const settings = options || {};
            const removeSelf = settings.removeSelf !== false;
            const nextUncheckedPaths = new Set();

            state.syncDraftUncheckedPaths.forEach(function (uncheckedPath) {
                const isSelf = uncheckedPath === normalized;
                const isDescendant = normalized
                    ? uncheckedPath.startsWith(normalized + "/")
                    : Boolean(uncheckedPath);
                if ((removeSelf && isSelf) || isDescendant) {
                    return;
                }
                nextUncheckedPaths.add(uncheckedPath);
            });

            state.syncDraftUncheckedPaths = nextUncheckedPaths;
        }

        function remapSyncUncheckedPathSetForMove(pathSet, sourcePath, destinationPath) {
            const sourceNormalized = normalizePath(sourcePath, true);
            const destinationNormalized = normalizePath(destinationPath, true);
            if (!sourceNormalized || !destinationNormalized || sourceNormalized === destinationNormalized) {
                return pathSet;
            }

            const nextPaths = new Set();
            pathSet.forEach(function (rawPath) {
                const normalized = normalizePath(rawPath, true);
                if (normalized === sourceNormalized) {
                    nextPaths.add(destinationNormalized);
                    return;
                }
                if (normalized.startsWith(sourceNormalized + "/")) {
                    nextPaths.add(destinationNormalized + normalized.slice(sourceNormalized.length));
                    return;
                }
                nextPaths.add(normalized);
            });
            return nextPaths;
        }

        function pruneSyncUncheckedPathSetForDelete(pathSet, targetPath) {
            const targetNormalized = normalizePath(targetPath, true);
            const nextPaths = new Set();
            pathSet.forEach(function (rawPath) {
                const normalized = normalizePath(rawPath, true);
                if (normalized === targetNormalized) {
                    return;
                }
                if (targetNormalized && normalized.startsWith(targetNormalized + "/")) {
                    return;
                }
                nextPaths.add(normalized);
            });
            return nextPaths;
        }

        function remapSyncExcludedStateForMove(sourcePath, destinationPath) {
            state.syncSavedUncheckedPaths = remapSyncUncheckedPathSetForMove(
                state.syncSavedUncheckedPaths,
                sourcePath,
                destinationPath
            );
            state.syncDraftUncheckedPaths = remapSyncUncheckedPathSetForMove(
                state.syncDraftUncheckedPaths,
                sourcePath,
                destinationPath
            );
        }

        function removeSyncExcludedStateForDelete(pathValue) {
            state.syncSavedUncheckedPaths = pruneSyncUncheckedPathSetForDelete(
                state.syncSavedUncheckedPaths,
                pathValue
            );
            state.syncDraftUncheckedPaths = pruneSyncUncheckedPathSetForDelete(
                state.syncDraftUncheckedPaths,
                pathValue
            );
        }

        async function collectSyncDescendantPaths(dirPath, visitedDirs) {
            const normalizedDir = normalizePath(dirPath, true);
            if (visitedDirs.has(normalizedDir)) {
                return new Set();
            }
            visitedDirs.add(normalizedDir);

            await loadDirectory(normalizedDir);
            const descendantPaths = new Set();
            const entries = getCachedEntries(normalizedDir);
            for (const entry of entries) {
                if (isSyncHiddenEntry(entry)) {
                    continue;
                }
                descendantPaths.add(entry.path);
                if (entry.type === "dir") {
                    const childDescendants = await collectSyncDescendantPaths(entry.path, visitedDirs);
                    childDescendants.forEach(function (pathValue) {
                        descendantPaths.add(pathValue);
                    });
                }
            }
            return descendantPaths;
        }

        async function setSyncPathChecked(pathValue, checked, entryType) {
            const normalized = normalizePath(pathValue, true);
            if (!normalized && normalized !== "") {
                return;
            }
            const isDir = entryType === "dir";
            if (checked) {
                if (isDir) {
                    const descendantPaths = await collectSyncDescendantPaths(normalized, new Set());
                    pruneSyncUncheckedPaths(normalized, { removeSelf: true });
                    descendantPaths.forEach(function (descendantPath) {
                        state.syncDraftUncheckedPaths.delete(descendantPath);
                    });
                } else {
                    state.syncDraftUncheckedPaths.delete(normalized);
                }
                return;
            }
            if (isDir) {
                const descendantPaths = await collectSyncDescendantPaths(normalized, new Set());
                descendantPaths.forEach(function (descendantPath) {
                    state.syncDraftUncheckedPaths.add(descendantPath);
                });
                state.syncDraftUncheckedPaths.delete(normalized);
                return;
            }
            state.syncDraftUncheckedPaths.add(normalized);
        }

        function createSyncCheckbox(pathValue, entryType) {
            const wrap = document.createElement("span");
            wrap.className = "handrive-sync-item-checkbox-wrap";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.className = "handrive-sync-item-checkbox";
            checkbox.checked = isSyncPathChecked(pathValue);
            checkbox.setAttribute("aria-label", getHandrivePathLabel(pathValue));
            checkbox.addEventListener("click", function (event) {
                event.stopPropagation();
            });
            checkbox.addEventListener("change", async function () {
                checkbox.disabled = true;
                try {
                    await setSyncPathChecked(pathValue, checkbox.checked, entryType);
                } finally {
                    checkbox.disabled = false;
                }
                renderSyncModalList();
            });

            wrap.appendChild(checkbox);
            return wrap;
        }

        async function collectSyncExcludedEntriesForDirectory(dirPath, visitedDirs) {
            const normalizedDir = normalizePath(dirPath, true);
            if (visitedDirs.has(normalizedDir)) {
                return {
                    excludedPaths: new Set(),
                    totalFileCount: 0,
                    excludedFileCount: 0,
                };
            }
            visitedDirs.add(normalizedDir);

            const excludedPaths = new Set();
            let totalFileCount = 0;
            let excludedFileCount = 0;
            const entries = getCachedEntries(normalizedDir);
            for (const entry of entries) {
                if (isSyncHiddenEntry(entry)) {
                    continue;
                }
                if (entry.type === "file") {
                    totalFileCount += 1;
                    if (!isSyncPathChecked(entry.path)) {
                        excludedPaths.add(entry.path);
                        excludedFileCount += 1;
                    }
                    continue;
                }
                if (entry.type === "dir") {
                    await loadDirectory(entry.path);
                    const childResult = await collectSyncExcludedEntriesForDirectory(entry.path, visitedDirs);
                    childResult.excludedPaths.forEach(function (pathValue) {
                        excludedPaths.add(pathValue);
                    });
                    totalFileCount += childResult.totalFileCount;
                    excludedFileCount += childResult.excludedFileCount;

                    if (
                        childResult.totalFileCount > 0
                        && childResult.excludedFileCount === childResult.totalFileCount
                        && !isSyncPathChecked(entry.path)
                    ) {
                        childResult.excludedPaths.forEach(function (pathValue) {
                            excludedPaths.delete(pathValue);
                        });
                        excludedPaths.add(entry.path);
                    }
                }
            }

            return {
                excludedPaths: excludedPaths,
                totalFileCount: totalFileCount,
                excludedFileCount: excludedFileCount,
            };
        }

        function addSyncCurrentDirectoryNode(fragment) {
            const currentFolderEntry = buildCurrentDirectoryEntry();
            const currentDirMeta = getCurrentDirMeta();
            const item = document.createElement("li");
            item.className = "handrive-item handrive-current-dir-item";

            const row = document.createElement("button");
            row.type = "button";
            row.className = "handrive-item-row handrive-current-dir-row";
            row.setAttribute("data-entry-path", currentFolderEntry.path);

            const typeMarker = createTypeMarker({
                isDir: true,
                isRootAvatar: Boolean(currentDirMeta.is_root),
                accountProfileImageUrl: accountProfileImageUrl,
                isGoogleDrive: isGoogleDriveRootMeta(currentDirMeta),
                isGithubRepo: Boolean(currentDirMeta.is_git_repo_root && currentDirMeta.git_repo && currentDirMeta.git_repo.provider === "github"),
                isRepo: Boolean(currentDirMeta.is_git_repo_root),
                isBranch: Boolean(currentDirMeta.git_branch_root),
                isEmpty: !currentDirMeta.has_children,
            });

            const nameWrap = document.createElement("span");
            nameWrap.className = "handrive-item-name-wrap";

            const name = document.createElement("span");
            name.className = "handrive-item-name";
            name.textContent = getCurrentFolderName(state.currentDir);

            row.appendChild(typeMarker);
            row.appendChild(nameWrap);
            nameWrap.appendChild(name);
            appendUrlShareIndicator(nameWrap, currentFolderEntry);

            appendCurrentDirRepoName(nameWrap, currentDirMeta.git_repo || null, {
                showForBranchOrRepoInner: Boolean(currentDirMeta.git_branch_root || currentDirMeta.requires_commit_message),
            });
            row.appendChild(createSyncCheckbox(currentFolderEntry.path, currentFolderEntry.type));

            row.addEventListener("click", function (event) {
                if (event.button !== 0) {
                    return;
                }
                event.preventDefault();
            });

            item.appendChild(row);
            fragment.appendChild(item);
        }

        function addSyncEntryNode(entry, fragment, ancestorHasNextSiblings, isLastSibling) {
            if (isSyncHiddenEntry(entry)) {
                return;
            }
            const item = document.createElement("li");
            item.className = "handrive-item";

            const row = document.createElement("button");
            row.type = "button";
            row.className = "handrive-item-row has-tree-prefix";
            row.setAttribute("data-entry-path", entry.path);

            const treePrefix = buildTreePrefixElement(ancestorHasNextSiblings, Boolean(isLastSibling));
            const fileIconKey = entry.type === "file" ? getFileIconKey(entry.path) : "";
            const typeMarker = createTypeMarker({
                isDir: entry.type === "dir",
                isGoogleDrive: isGoogleDriveRootEntry(entry),
                isGithubRepo: entry.type === "dir" && entry.github_repo,
                isRepo: entry.type === "dir" && entry.git_repo,
                isBranch: entry.type === "dir" && entry.git_branch_root,
                isMap: entry.type === "dir" && entry.is_map_folder,
                isEmpty: entry.type === "dir" && entry.has_children === false,
                fileIconKey: fileIconKey,
                isGenericFileIcon: entry.type === "file" && isGenericFileIconKey(fileIconKey),
                customIconUrl: (entry.type === "dir" && entry.folder_icon_url) ? entry.folder_icon_url : "",
            });

            row.appendChild(typeMarker);
            const nameWrap = document.createElement("span");
            nameWrap.className = "handrive-item-name-wrap";
            const name = document.createElement("span");
            name.className = "handrive-item-name";
            name.textContent = entry.name;
            nameWrap.appendChild(name);
            appendUrlShareIndicator(nameWrap, entry);
            row.appendChild(nameWrap);
            row.appendChild(createSyncCheckbox(entry.path, entry.type));

            row.addEventListener("click", function (event) {
                if (event.button !== 0) {
                    return;
                }
                event.preventDefault();
                if (entry.type !== "dir") {
                    return;
                }
                toggleSyncFolderExpansion(entry).catch(alertError);
            });

            item.appendChild(treePrefix);
            item.appendChild(row);
            fragment.appendChild(item);

            if (entry.type === "dir" && state.syncExpandedFolders.has(entry.path)) {
                const childEntries = getCachedEntries(entry.path);
                const nextAncestorHasNextSiblings = (ancestorHasNextSiblings || []).slice();
                nextAncestorHasNextSiblings.push(!isLastSibling);
                childEntries.forEach(function (child, index) {
                    addSyncEntryNode(child, fragment, nextAncestorHasNextSiblings, index === childEntries.length - 1);
                });
            }
        }

        async function toggleSyncFolderExpansion(entry) {
            if (!entry || entry.type !== "dir") {
                return;
            }
            if (state.syncExpandedFolders.has(entry.path)) {
                state.syncExpandedFolders.delete(entry.path);
                renderSyncModalList();
                return;
            }
            await loadDirectory(entry.path);
            state.syncExpandedFolders.add(entry.path);
            renderSyncModalList();
        }

        function renderSyncModalList() {
            if (!syncList) {
                return;
            }
            syncList.innerHTML = "";
            const fragment = document.createDocumentFragment();
            const currentFolderEntry = buildCurrentDirectoryEntry();
            if (!isSyncHiddenEntry(currentFolderEntry)) {
                addSyncCurrentDirectoryNode(fragment);
            }
            const entries = getCachedEntries(state.currentDir).filter(function (entry) {
                return !isSyncHiddenEntry(entry);
            });
            if (!entries.length) {
                const emptyItem = document.createElement("li");
                emptyItem.className = "handrive-item";
                const emptyRow = document.createElement("div");
                emptyRow.className = "handrive-item-row is-empty";
                emptyRow.textContent = t("js_empty_documents", "문서가 없습니다.");
                emptyItem.appendChild(emptyRow);
                fragment.appendChild(emptyItem);
                syncList.appendChild(fragment);
                return;
            }
            entries.forEach(function (entry, index) {
                addSyncEntryNode(entry, fragment, [], index === entries.length - 1);
            });
            syncList.appendChild(fragment);
        }

        function setSyncModalOpen(opened) {
            if (!syncModal) {
                return;
            }
            syncModal.hidden = !opened;
            syncModalBodyState();
            if (!opened) {
                return;
            }
            state.syncDraftUncheckedPaths = new Set(state.syncSavedUncheckedPaths);
            state.syncExpandedFolders = new Set(state.expandedFolders);
            renderSyncModalList();
        }

        async function submitSyncSettings() {
            if (!syncSettingsApiUrl) {
                throw new Error(t("js_error_request_failed", "요청 처리 중 오류가 발생했습니다."));
            }
            await loadDirectory(state.currentDir);
            const collected = await collectSyncExcludedEntriesForDirectory(state.currentDir, new Set());
            const excludedPaths = Array.from(collected.excludedPaths).sort();
            const data = await requestJson(syncSettingsApiUrl, buildPostOptions({
                excluded_paths: excludedPaths,
            }));
            state.syncSavedUncheckedPaths = new Set(Array.isArray(data && data.excluded_paths) ? data.excluded_paths : []);
            setSyncModalOpen(false);
        }

        function setRenameModalOpen(opened, entry) {
            if (!renameModal) {
                return;
            }
            if (!opened) {
                modalSetRenameModalOpen(renameModal, renameTarget, renameInput, syncModalBodyState, false, null, getEntryEditableName);
                state.renameTargetEntry = null;
                return;
            }
            state.renameTargetEntry = entry || null;
            modalSetRenameModalOpen(
                renameModal,
                renameTarget,
                renameInput,
                syncModalBodyState,
                true,
                state.renameTargetEntry,
                getEntryEditableName,
                getHandrivePathLabel(entry && entry.path ? entry.path : "")
            );
        }

        function setArchiveExtractModalOpen(opened, entry) {
            if (!archiveExtractModal) {
                return;
            }
            archiveExtractModal.hidden = !opened;
            syncModalBodyState();
            if (!opened) {
                state.archiveExtractTargetEntry = null;
                return;
            }
            state.archiveExtractTargetEntry = entry || null;
            if (archiveExtractTarget) {
                archiveExtractTarget.textContent = getHandrivePathLabel(entry && entry.path ? entry.path : "");
            }
        }

        function resolveArchiveExtractTargetDir(entry, targetDirValue) {
            const normalizedTargetDir = normalizePath(targetDirValue || "", true);
            if (!isArchiveVirtualPath(normalizedTargetDir)) {
                return normalizedTargetDir;
            }
            const archivePath = entry && entry.archive_path ? normalizePath(entry.archive_path, true) : "";
            if (archivePath) {
                return getParentDirectory(archivePath);
            }
            const sourcePath = entry && entry.path ? normalizePath(entry.path, true) : "";
            if (sourcePath && !isArchiveVirtualPath(sourcePath)) {
                return getParentDirectory(sourcePath);
            }
            return "";
        }

        function setArchiveCreateModalOpen(opened, entries) {
            if (!archiveCreateModal) {
                return;
            }
            archiveCreateModal.hidden = !opened;
            syncModalBodyState();
            if (!opened) {
                state.archiveCreateTargetEntries = [];
                return;
            }
            const selection = resolveArchiveCreateSelection(entries);
            if (!selection) {
                state.archiveCreateTargetEntries = [];
                archiveCreateModal.hidden = true;
                syncModalBodyState();
                return;
            }
            state.archiveCreateTargetEntries = selection.entries.slice();
            if (archiveCreateTarget) {
                archiveCreateTarget.textContent = t("archive_create_target_prefix", "압축 대상") + ": "
                    + getHandrivePathLabel(selection.parentPath) + " · "
                    + String(selection.entries.length) + t("archive_create_target_count_suffix", "개 파일");
            }
            if (archiveCreateInput) {
                archiveCreateInput.value = selection.defaultName || "archive";
                archiveCreateInput.focus();
                archiveCreateInput.select();
            }
        }

        async function submitArchiveExtract(destinationMode, entryOverride, targetDirOverride) {
            const entry = entryOverride || state.archiveExtractTargetEntry;
            if (!entry || !archiveExtractApiUrl) {
                return;
            }
            const sourcePath = entry.path || "";
            const rawTargetDir = targetDirOverride !== undefined
                ? targetDirOverride
                : getParentDirectory(sourcePath);
            const targetDir = resolveArchiveExtractTargetDir(entry, rawTargetDir);
            const data = await requestJson(
                archiveExtractApiUrl,
                buildPostOptions({
                    source_path: sourcePath,
                    target_dir: targetDir,
                    destination_mode: destinationMode || "current",
                })
            );
            setArchiveExtractModalOpen(false);
            await refreshCurrentDirectory({ skipPreview: true });
            const paths = data && Array.isArray(data.paths) ? data.paths : [];
            const selectedPath = paths[0] || (data && data.path) || "";
            if (selectedPath) {
                applySelection(paths.length > 0 ? paths : [selectedPath], {
                    primaryPath: selectedPath,
                    anchorPath: selectedPath,
                });
            }
        }

        function submitArchiveCreate() {
            const archiveName = String(archiveCreateInput ? archiveCreateInput.value : "").trim();
            if (!archiveName) {
                window.alert(t("archive_create_name_required", "압축파일명을 입력해주세요."));
                return;
            }
            if (!createArchiveFromSelectedFiles(state.archiveCreateTargetEntries, archiveName)) {
                window.alert(t("archive_create_invalid_selection", "같은 폴더의 파일을 두 개 이상 선택해주세요."));
                return;
            }
            setArchiveCreateModalOpen(false);
        }

        function setFolderCreateModalOpen(opened, entry) {
            if (!folderCreateModal) {
                return;
            }
            if (!opened) {
                modalSetFolderCreateModalOpen(folderCreateModal, folderCreateTarget, folderCreateInput, syncModalBodyState, false, null, "");
                state.folderCreateParentEntry = null;
                return;
            }
            state.folderCreateParentEntry = entry || null;
            const parentPath = entry && entry.path ? entry.path : "";
            const targetLabel = t("create_folder_in_label", "생성 위치") + ": " + getHandrivePathLabel(parentPath);
            modalSetFolderCreateModalOpen(folderCreateModal, folderCreateTarget, folderCreateInput, syncModalBodyState, true, state.folderCreateParentEntry, targetLabel);
        }

        function setFolderIconModalOpen(opened, entry) {
            if (!folderIconModal) {
                return;
            }
            if (!opened) {
                modalSetFolderIconModalOpen(
                    folderIconModal,
                    folderIconTarget,
                    folderIconFileInput,
                    syncModalBodyState,
                    false,
                    null,
                    ""
                );
                if (folderIconFileInput) { folderIconFileInput.value = ""; }
                if (folderIconPreviewWrap) { folderIconPreviewWrap.hidden = true; }
                if (folderIconPreviewImg) { folderIconPreviewImg.src = ""; }
                state.folderIconTargetEntry = null;
                return;
            }
            state.folderIconTargetEntry = entry || null;
            modalSetFolderIconModalOpen(
                folderIconModal,
                folderIconTarget,
                folderIconFileInput,
                syncModalBodyState,
                true,
                state.folderIconTargetEntry,
                getHandrivePathLabel(entry && entry.path ? entry.path : "")
            );
            const hasExistingIcon = Boolean(entry && entry.folder_icon_url);
            if (folderIconDeleteButton) { folderIconDeleteButton.hidden = !hasExistingIcon; }
            if (folderIconPreviewWrap) { folderIconPreviewWrap.hidden = !hasExistingIcon; }
            if (folderIconPreviewImg && hasExistingIcon) { folderIconPreviewImg.src = entry.folder_icon_url; }
            if (folderIconFileInput) { folderIconFileInput.value = ""; }
        }

        function renameEntry(entry) {
            if (!entry) {
                return;
            }
            setRenameModalOpen(true, entry);
        }

        function newDocumentInFolder(entry) {
            if (!entry || entry.type !== "dir") {
                return;
            }
            window.location.href = buildWriteUrl(writeUrl, { dir: entry.path });
        }

        async function submitRename() {
            const entry = state.renameTargetEntry;
            if (!entry) {
                return;
            }

            const currentName = getEntryEditableName(entry);
            const trimmed = String(renameInput ? renameInput.value : "").trim();
            if (!trimmed || trimmed === currentName) {
                setRenameModalOpen(false);
                return;
            }

            var commitMessage = "";
            if (entry.requires_commit_message) {
                commitMessage = await promptCommitMessage(entry.path);
                if (commitMessage === null) {
                    return;
                }
            }

            const data = await requestJson(renameApiUrl, buildPostOptions({
                path: entry.path,
                new_name: trimmed,
                commit_message: commitMessage
            }));
            const renamedPath = data && data.path ? data.path : "";
            if (entry.type === "dir" && renamedPath) {
                remapExpandedFoldersForRename(entry.path, renamedPath);
            }
            if (renamedPath) {
                remapSyncExcludedStateForMove(entry.path, renamedPath);
            }
            applySelection([data && data.path ? data.path : ""], {
                primaryPath: data && data.path ? data.path : "",
                anchorPath: data && data.path ? data.path : "",
                render: false,
            });
            setRenameModalOpen(false);
            await refreshCurrentDirectory();
        }

        async function submitFolderCreate() {
            const parentEntry = state.folderCreateParentEntry;
            if (!parentEntry || parentEntry.type !== "dir") {
                window.alert(t("js_folder_create_requires_folder", "폴더에서만 새 폴더를 만들 수 있습니다."));
                return;
            }

            const folderName = String(folderCreateInput ? folderCreateInput.value : "").trim();
            if (!folderName) {
                window.alert(t("js_folder_name_required", "폴더 이름을 입력해주세요."));
                return;
            }

            var commitMessage = "";
            if (parentEntry.requires_commit_message) {
                commitMessage = await promptCommitMessage(parentEntry.path);
                if (commitMessage === null) {
                    return;
                }
            }

            await requestJson(
                mkdirApiUrl,
                buildPostOptions({
                    parent_dir: parentEntry.path,
                    folder_name: folderName,
                    commit_message: commitMessage
                })
            );

            setFolderCreateModalOpen(false);
            await refreshCurrentDirectory();
        }

        async function deleteEntries(entriesOrEntry, options) {
            const entries = Array.isArray(entriesOrEntry)
                ? entriesOrEntry.filter(Boolean)
                : (entriesOrEntry ? [entriesOrEntry] : []);
            const settings = options || {};
            if (entries.length === 0) {
                return;
            }

            const isMultiple = entries.length > 1;
            const targetPaths = entries.map(function (entry) {
                return entry.path;
            });
            const targetDisplayPaths = entries.map(function (entry) {
                return getHandrivePathLabel(entry && entry.path ? entry.path : "");
            });
            const includesRepo = entries.some(function (entry) {
                return Boolean(entry && entry.type === "dir" && entry.git_repo);
            });
            const isSingleRepoDelete = entries.length === 1 && includesRepo;
            if (includesRepo && !settings.repoDelete) {
                throw new Error(t("js_repo_delete_requires_button", "Repo는 일반 삭제가 아니라 Repo 삭제를 사용해야 합니다."));
            }
            const confirmed = await requestConfirmDialog({
                title: isSingleRepoDelete ? t("delete_repo_button", "Repo 삭제") : t("delete_button", "삭제"),
                message: includesRepo
                    ? (isMultiple
                        ? formatTemplate(
                            t("js_confirm_delete_repo_entries", "선택한 {count}개 항목 중 Repo 폴더를 삭제하면 Forgejo 저장소도 함께 삭제됩니다.\n정말 삭제할까요?"),
                            { count: entries.length }
                        )
                        : formatTemplate(
                            t("js_confirm_delete_repo_entry", "이 Repo 폴더를 삭제하면 Forgejo 저장소도 함께 삭제됩니다.\n정말 삭제할까요?\n{path}"),
                            { path: targetDisplayPaths[0] || targetPaths[0] }
                        ))
                    : (isMultiple
                        ? formatTemplate(
                            t("js_confirm_delete_entries", "선택한 {count}개 항목을 삭제할까요?"),
                            { count: entries.length }
                        )
                        : formatTemplate(
                            t("js_confirm_delete_entry", "정말 삭제할까요?\n{path}"),
                            { path: targetDisplayPaths[0] || targetPaths[0] }
                        )),
                cancelText: t("cancel", "취소"),
                confirmText: isSingleRepoDelete ? t("delete_repo_button", "Repo 삭제") : t("delete_button", "삭제")
            });
            if (!confirmed) {
                return;
            }

            var commitMessage = "";
            if (requiresCommitMessageForEntries(entries)) {
                commitMessage = await promptCommitMessage(targetPaths[0] || "");
                if (commitMessage === null) {
                    return;
                }
            }
            createOperationQueueItem("delete", entries, "", commitMessage, {
                repoDelete: Boolean(settings.repoDelete),
            });
            processOperationQueue().catch(alertError);
        }

        async function toggleFolderExpansion(entry) {
            if (!entry || entry.type !== "dir") {
                return;
            }
            const folderPath = normalizePath(entry.path, false);

            if (state.expandedFolders.has(folderPath)) {
                state.expandedFolders.delete(folderPath);
                renderList();
                scheduleListColumnVisibilityAfterTreeToggle();
                return;
            }

            await withEntryRowLoading(entry, function () {
                return loadDirectory(folderPath);
            });
            state.expandedFolders.add(folderPath);
            state.openingFolderPath = folderPath;
            renderList();
            scheduleListColumnVisibilityAfterTreeToggle();
        }

        async function toggleArchiveExpansion(entry) {
            if (!isArchiveEntry(entry)) {
                return;
            }
            const archivePath = normalizePath(entry.path, false);
            const virtualPath = normalizePath(entry.archive_virtual_path || "", false);
            if (!archivePath || !virtualPath) {
                return;
            }
            if (state.expandedFolders.has(archivePath)) {
                state.expandedFolders.delete(archivePath);
                renderList();
                scheduleListColumnVisibilityAfterTreeToggle();
                return;
            }
            await withEntryRowLoading(entry, function () {
                return loadDirectory(virtualPath);
            });
            state.expandedFolders.add(archivePath);
            state.openingFolderPath = archivePath;
            renderList();
            scheduleListColumnVisibilityAfterTreeToggle();
        }

        function openEntry(entry) {
            if (!entry) {
                return;
            }
            if (isArchiveEntry(entry)) {
                navigateToDirectory(entry.archive_virtual_path, { sourceEntry: entry }).catch(alertError);
                return;
            }
            if (isArchiveMemberEntry(entry)) {
                if (entry.type === "dir") {
                    navigateToDirectory(entry.path, { sourceEntry: entry }).catch(alertError);
                }
                return;
            }
            if (entry.type === "dir") {
                if (entry.is_map_folder) {
                    const targetUrl = (mapViewerBaseUrl || "/handrive/map-viewer/") + (entry.path || "");
                    window.location.href = appendSharedQuery(targetUrl);
                    return;
                }
                navigateToDirectory(entry.path, { sourceEntry: entry }).catch(alertError);
                return;
            }
            const docsEditorUrl = getGoogleDriveDocsEditorUrl(entry);
            if (docsEditorUrl) {
                window.location.href = docsEditorUrl;
                return;
            }
            window.location.href = buildViewUrl(handriveBaseUrl, entry.slug_path || entry.path);
        }

        function openEntriesInNewTabs(entries) {
            if (!Array.isArray(entries) || entries.length === 0) {
                return;
            }
            entries.forEach(function (entry) {
                const targetUrl = isArchiveEntry(entry)
                    ? buildListUrl(handriveBaseUrl, entry.archive_virtual_path, handriveRootUrl)
                    : (
                        entry.type === "dir"
                            ? buildListUrl(handriveBaseUrl, entry.path, handriveRootUrl)
                            : (getGoogleDriveDocsEditorUrl(entry) || buildViewUrl(handriveBaseUrl, entry.slug_path || entry.path))
                    );
                window.open(targetUrl, "_blank", "noopener");
            });
        }

        function buildDownloadUrl(pathValue) {
            if (!downloadApiUrl) {
                return "";
            }
            const query = new URLSearchParams({ path: pathValue || "" }).toString();
            return appendSharedQuery(query ? downloadApiUrl + "?" + query : downloadApiUrl);
        }

        function buildPdfEditorApiUrl(baseUrl, pathValue, extraParams) {
            if (!baseUrl) {
                return "";
            }
            const params = new URLSearchParams({ path: pathValue || "" });
            Object.keys(extraParams || {}).forEach(function (key) {
                params.set(key, extraParams[key]);
            });
            return appendSharedQuery(baseUrl + "?" + params.toString());
        }

        function buildScopedHomeDownloadUrl(pathValue) {
            return appendQueryParam(buildDownloadUrl(pathValue), "scope_home", "1");
        }

        function triggerDownload(targetUrl) {
            if (!targetUrl) {
                return;
            }
            const anchor = document.createElement("a");
            anchor.href = targetUrl;
            anchor.setAttribute("download", "");
            anchor.style.display = "none";
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
        }

        function downloadEntries(entries) {
            if (!Array.isArray(entries) || entries.length === 0 || !downloadApiUrl) {
                return;
            }
            const downloadableEntries = entries.filter(function (entry) {
                return Boolean(entry) &&
                    (entry.type === "file" || entry.type === "dir") &&
                    !entry.isCurrentFolder;
            });
            downloadableEntries.forEach(function (entry) {
                const targetUrl = buildDownloadUrl(entry.path);
                if (!targetUrl) {
                    return;
                }
                triggerDownload(targetUrl);
            });
        }

        function editEntry(entry) {
            if (!entry) {
                return;
            }
            if (entry.type === "dir") {
                window.location.href = buildWriteUrl(writeUrl, { dir: entry.path });
                return;
            }
            const docsEditorUrl = getGoogleDriveDocsEditorUrl(entry);
            if (docsEditorUrl) {
                window.location.href = docsEditorUrl;
                return;
            }
            if (!isEditableHandriveFileEntry(entry)) {
                return;
            }
            if (isPdfEditorEntry(entry) || isImageEditorEntry(entry) || isVideoEditorEntry(entry) || isAudioEditorEntry(entry)) {
                switchToEditor(entry);
                return;
            }
            window.location.href = buildWriteUrl(writeUrl, { path: entry.path });
        }

        async function convertEntryToMp3(entry) {
            if (!entry || entry.type !== "file" || !entry.can_edit || !convertMp3ApiUrl) {
                return;
            }
            createOperationQueueItem("convert-mp3", [entry], getParentDirectory(entry.path), "");
            processOperationQueue().catch(alertError);
        }

        function syncSearchQueryFromInput(sourceInput) {
            const searchInput = getSearchInputForCurrentContext(sourceInput);
            const rawValue = String(searchInput && searchInput.value || "");
            state.searchQuery = rawValue.trim();
            syncSearchInputValues(rawValue, searchInput);
        }

        function setListLoading(isLoading) {
            if (listPane) {
                listPane.classList.toggle("is-loading", Boolean(isLoading));
            }
            if (listLoadingOverlay) {
                listLoadingOverlay.hidden = !isLoading;
            }
        }

        async function applyListSearch(sourceInput) {
            const preservePreview = Boolean(sourceInput && currentDirSearchInput && sourceInput === currentDirSearchInput);
            state.searchGeneration += 1;
            const generation = state.searchGeneration;
            setListLoading(true);
            try {
                syncSearchQueryFromInput(sourceInput);
                const query = String(state.searchQuery || "").trim();
                if (!query) {
                    if (generation === state.searchGeneration) {
                        state.searchResults = null;
                        renderList({ skipPreview: preservePreview });
                    }
                    return;
                }

                state.searchResults = [];
                renderList({ skipPreview: preservePreview });

                const params = new URLSearchParams({ path: state.currentDir, q: query });
                const data = await requestJson(appendSharedQuery(searchApiUrl + "?" + params.toString()));
                if (generation !== state.searchGeneration) {
                    return;
                }
                state.searchResults = data.entries || [];
                renderList({ skipPreview: preservePreview });
            } finally {
                if (generation === state.searchGeneration) {
                    setListLoading(false);
                }
            }
        }

        function addEntryNode(entry, fragment, ancestorHasNextSiblings, isLastSibling) {
            const item = document.createElement("li");
            item.className = "handrive-item";
            const openingFolderPath = state.openingFolderPath;
            if (
                !state.suppressOpeningAnimation &&
                openingFolderPath &&
                entry.path &&
                entry.path !== openingFolderPath &&
                entry.path.startsWith(openingFolderPath + "/")
            ) {
                item.classList.add("is-entering");
                item.style.animationDelay = String(Math.min(140, state.openingAnimationOrder * 14)) + "ms";
                state.openingAnimationOrder += 1;
            }

            const row = document.createElement("button");
            row.type = "button";
            row.className = "handrive-item-row has-tree-prefix";
            row.setAttribute("data-entry-path", entry.path);
            state.entryRowByPath.set(entry.path, row);
            const isPublicWriteFile = Boolean(entry.type === "file" && entry.is_public_write);
            row.draggable = Boolean((moveApiUrl || archiveExtractApiUrl) && (entry.can_edit || entry.can_delete || (entry.is_archive_member && entry.can_extract)) && !isPublicWriteFile);
            if (state.selectedPaths.has(entry.path) || normalizePath(entry.path, true) === state.activePreviewPath) {
                row.classList.add("is-selected");
            }

            const treePrefix = buildTreePrefixElement(ancestorHasNextSiblings, Boolean(isLastSibling));

            const fileIconKey = entry.type === "file" ? getFileIconKey(entry.path) : "";
            const typeMarker = createTypeMarker({
                isDir: entry.type === "dir",
                isGoogleDrive: isGoogleDriveRootEntry(entry),
                isGithubRepo: entry.type === "dir" && entry.github_repo,
                isRepo: entry.type === "dir" && entry.git_repo,
                isBranch: entry.type === "dir" && entry.git_branch_root,
                isMap: entry.type === "dir" && entry.is_map_folder,
                isEmpty: entry.type === "dir" && entry.has_children === false,
                fileIconKey: fileIconKey,
                isGenericFileIcon: entry.type === "file" && isGenericFileIconKey(fileIconKey),
                customIconUrl: (entry.type === "dir" && entry.folder_icon_url) ? entry.folder_icon_url : "",
            });

            row.appendChild(typeMarker);
            const nameWrap = document.createElement("span");
            nameWrap.className = "handrive-item-name-wrap";
            const name = document.createElement("span");
            name.className = "handrive-item-name";
            name.textContent = entry.name;
            nameWrap.appendChild(name);
            appendUrlShareIndicator(nameWrap, entry);
            row.appendChild(nameWrap);
            appendEntryMetaColumns(row, entry);

            row.addEventListener("click", function (event) {
                if (event.button !== 0) { return; }
                event.preventDefault();
                closeContextMenu();
                selectEntriesByRowClick(entry, event);
                if (event.detail >= 2) {
                    openEntry(entry);
                    return;
                }
                if (isArchiveEntry(entry)) {
                    if (event.detail === 1 && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
                        toggleArchiveExpansion(entry).catch(alertError);
                    }
                    return;
                }
                if (entry.type === "dir") {
                    if (event.detail === 1 && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
                        if (shouldOpenGoogleDrivePickerOnClick(entry, event)) {
                            openGoogleDriveItemPicker().catch(alertError);
                            return;
                        }
                        if (hasSharedContext() && entry.is_map_folder) {
                            openEntry(entry);
                            return;
                        }
                        toggleFolderExpansion(entry).catch(alertError);
                    }
                    return;
                }
            });

            row.addEventListener("dblclick", function (event) {
                if (event.button !== 0) { return; }
                event.preventDefault();
                event.stopPropagation();
                openEntry(entry);
            });

            row.addEventListener("contextmenu", function (event) {
                event.preventDefault();
                if (isArchiveMemberEntry(entry)) {
                    return;
                }
                openContextMenuForEntry(entry, event.clientX, event.clientY);
            });

            if (moveApiUrl) {
                row.addEventListener("dragstart", function (event) {
                    const draggingEntries = resolveDraggingEntriesFromRow(entry);
                    if (draggingEntries.length === 0) {
                        if (event.dataTransfer) {
                            event.dataTransfer.effectAllowed = "none";
                        }
                        event.preventDefault();
                        return;
                    }
                    state.draggingEntries = draggingEntries;
                    state.draggingRowPaths = new Set(
                        draggingEntries.map(function (item) {
                            return item.path;
                        })
                    );
                    row.classList.add("is-dragging");
                    clearDragOverTarget();
                    closeContextMenu();
                    if (event.dataTransfer) {
                        event.dataTransfer.effectAllowed = draggingEntries.some(isGoogleDriveEntry) ? "copyMove" : "move";
                        event.dataTransfer.setData(
                            "text/plain",
                            draggingEntries.map(function (item) {
                                return item.path;
                            }).join("\n")
                        );
                    }
                });

                row.addEventListener("dragend", function () {
                    row.classList.remove("is-dragging");
                    state.draggingEntries = [];
                    state.draggingRowPaths = new Set();
                    clearDragOverTarget();
                });
            }

            if (entry.type === "dir") {
                const canWriteChildren = Boolean(entry.can_write_children);
                if (canWriteChildren) {
                    bindDropTarget(row, entry.path);
                }
            } else {
                const parentDirPath = getParentDirectory(entry.path);
                const parentEntry = state.entryByPath.get(parentDirPath);
                const parentRow = state.entryRowByPath.get(parentDirPath);
                if (parentEntry && parentRow && parentEntry.type === "dir" && parentEntry.can_write_children) {
                    bindDropTarget(row, parentDirPath, {
                        highlightElement: parentRow,
                    });
                }
            }

            item.appendChild(treePrefix);
            item.appendChild(row);
            fragment.appendChild(item);
            state.entryByPath.set(entry.path, entry);
            state.visibleEntryPaths.push(entry.path);

            const expandsAsArchive = isArchiveEntry(entry) && state.expandedFolders.has(entry.path);
            const expandsAsDirectory = entry.type === "dir" && state.expandedFolders.has(entry.path);
            if (expandsAsArchive || expandsAsDirectory) {
                const childEntries = getSortedEntriesForRender(getCachedEntries(expandsAsArchive ? entry.archive_virtual_path : entry.path));
                const nextAncestorHasNextSiblings = (ancestorHasNextSiblings || []).slice();
                nextAncestorHasNextSiblings.push(!isLastSibling);
                childEntries.forEach(function (child, index) {
                    const childIsLast = index === childEntries.length - 1;
                    addEntryNode(child, fragment, nextAncestorHasNextSiblings, childIsLast);
                });
            }
        }

        function renderSearchResultItems(fragment, entries) {
            entries.forEach(function (entry) {
                addEntryNode(entry, fragment, [], true);
            });
        }

        function getCurrentDirRenderContainer() {
            return currentDirListContainer || listContainer;
        }

        function getListItemsRenderContainer() {
            return listItemsContainer || listContainer;
        }

        function clearListRenderContainers() {
            const currentDirContainer = getCurrentDirRenderContainer();
            const itemContainer = getListItemsRenderContainer();
            if (!currentDirContainer || !itemContainer) {
                return;
            }
            if (currentDirContainer === itemContainer) {
                currentDirContainer.innerHTML = "";
                return;
            }
            currentDirContainer.innerHTML = "";
            itemContainer.innerHTML = "";
        }

        function renderList(options) {
            const renderListOptions = options || {};
            if (!listContainer) {
                return;
            }
            hideCommitTooltip();
            const currentDirRenderContainer = getCurrentDirRenderContainer();
            const listItemsRenderContainer = getListItemsRenderContainer();
            const existingCurrentDirItem = currentDirRenderContainer
                ? currentDirRenderContainer.querySelector(".handrive-current-dir-item")
                : listContainer.querySelector(".handrive-current-dir-item");
            const existingCurrentDirRow = existingCurrentDirItem
                ? existingCurrentDirItem.querySelector(".handrive-current-dir-row")
                : null;
            const savedCurrentDirPath = existingCurrentDirRow
                ? (existingCurrentDirRow.dataset.entryPath || null)
                : null;
            if (existingCurrentDirItem) {
                existingCurrentDirItem.remove();
            }
            clearListRenderContainers();
            state.openingAnimationOrder = 0;
            state.entryByPath = new Map();
            state.entryRowByPath = new Map();
            state.visibleEntryPaths = [];
            const currentDirFragment = document.createDocumentFragment();
            const itemFragment = document.createDocumentFragment();
            const entries = state.searchQuery && Array.isArray(state.searchResults)
                ? state.searchResults
                : getCachedEntries(state.currentDir);
            const renderEntries = getSortedEntriesForRender(entries);
            const openedFolderEntries = state.openingFolderPath
                ? getCachedEntries(state.openingFolderPath)
                : [];
            state.suppressOpeningAnimation = Boolean(
                renderEntries.length > 200 ||
                (Array.isArray(openedFolderEntries) && openedFolderEntries.length > 200)
            );
            const currentFolderEntryForReuse = buildCurrentDirectoryEntry();
            if (existingCurrentDirItem && savedCurrentDirPath === currentFolderEntryForReuse.path) {
                if (existingCurrentDirRow) {
                    existingCurrentDirRow.classList.toggle("is-selected",
                        state.selectedPaths.has(currentFolderEntryForReuse.path) ||
                        normalizePath(currentFolderEntryForReuse.path, true) === state.activePreviewPath
                    );
                    state.entryRowByPath.set(currentFolderEntryForReuse.path, existingCurrentDirRow);
                    attachListSearchFormToCurrentDirRow(existingCurrentDirRow);
                    bindCurrentDirSortControls(existingCurrentDirRow);
                }
                state.entryByPath.set(currentFolderEntryForReuse.path, currentFolderEntryForReuse);
                state.visibleEntryPaths.push(currentFolderEntryForReuse.path);
                currentDirFragment.appendChild(existingCurrentDirItem);
            } else {
                addCurrentDirectoryNode(currentDirFragment);
            }
            if (currentDirRenderContainer) {
                currentDirRenderContainer.appendChild(currentDirFragment);
            }

            if (renderEntries.length === 0) {
                const emptyItem = document.createElement("li");
                emptyItem.className = "handrive-item";
                const emptyRow = document.createElement("div");
                emptyRow.className = "handrive-item-row is-empty";
                emptyRow.textContent = state.searchQuery
                    ? t("js_search_no_results", "검색 결과가 없습니다.")
                    : t("js_empty_documents", "문서가 없습니다.");
                emptyItem.appendChild(emptyRow);
                itemFragment.appendChild(emptyItem);
                const filteredSelection = Array.from(state.selectedPaths).filter(function (pathValue) {
                    return state.entryByPath.has(pathValue);
                });
                state.selectedPaths = new Set(filteredSelection);
                state.selectedPath = state.selectedPaths.has(state.selectedPath) ? state.selectedPath : (filteredSelection[0] || "");
                state.selectionAnchorPath = state.selectedPaths.has(state.selectionAnchorPath)
                    ? state.selectionAnchorPath
                    : (state.selectedPath || "");
                if (listItemsRenderContainer) {
                    listItemsRenderContainer.appendChild(itemFragment);
                }
                restoreActiveDropPreviewAfterRender();
                syncSearchFormVisibility();
                updateListColumnVisibility();
                scheduleListBodyHeight();
                if (!renderListOptions.skipPreview) { syncPreviewFromSelection(); }
                state.openingFolderPath = "";
                state.suppressOpeningAnimation = false;
                return;
            }
            if (state.searchQuery) {
                renderSearchResultItems(itemFragment, renderEntries);
            } else {
                renderEntries.forEach(function (entry, index) {
                    const isLastRootEntry = index === renderEntries.length - 1;
                    addEntryNode(entry, itemFragment, [], isLastRootEntry);
                });
            }
            const filteredSelection = Array.from(state.selectedPaths).filter(function (pathValue) {
                return state.entryByPath.has(pathValue);
            });
            state.selectedPaths = new Set(filteredSelection);
            state.selectedPath = state.selectedPaths.has(state.selectedPath) ? state.selectedPath : (filteredSelection[0] || "");
            state.selectionAnchorPath = state.selectedPaths.has(state.selectionAnchorPath)
                ? state.selectionAnchorPath
                : (state.selectedPath || "");
            if (listItemsRenderContainer) {
                listItemsRenderContainer.appendChild(itemFragment);
            }
            restoreActiveDropPreviewAfterRender();
            syncSearchFormVisibility();
            updateListColumnVisibility();
            scheduleListBodyHeight();
            if (!renderListOptions.skipPreview) { syncPreviewFromSelection(); }
            scheduleSyncCurrentDirRowHeightWithSideHead();
            state.openingFolderPath = "";
            state.suppressOpeningAnimation = false;
        }

        function openContextMenuForEntry(entry, x, y) {
            if (!entry) {
                return;
            }
            if (!state.selectedPaths.has(entry.path)) {
                applySelection([entry.path], {
                    primaryPath: entry.path,
                    anchorPath: entry.path,
                    skipPreview: true,
                });
            }
            openContextMenuAt(entry, x, y);
        }

        function bindHandrivePathDropTargets() {
            if (!moveApiUrl) {
                return;
            }
            const pathTargets = document.querySelectorAll(".ui-path-link[data-handrive-dir], .ui-path-current[data-handrive-dir]");
            pathTargets.forEach(function (target) {
                const targetDirPath = normalizePath(target.getAttribute("data-handrive-dir") || "", true);
                bindDropTarget(target, targetDirPath);
            });
        }

        if (contextMenu) {
            contextMenu.addEventListener("click", function (event) {
                const button = event.target.closest("button[data-action]");
                if (!button) {
                    return;
                }

                const action = button.dataset.action;
                const uploadQueueItem = state.uploadQueueContextItem;
                if (uploadQueueItem) {
                    closeContextMenu();
                    if (action === "open") {
                        if (uploadQueueItem.status === "uploading" || uploadQueueItem.status === "queued") {
                            cancelUploadQueueItem(uploadQueueItem);
                            return;
                        }
                        if (uploadQueueItem.kind === "operation") {
                            if (
                                uploadQueueItem.operationType !== "delete" &&
                                (uploadQueueItem.savedPath || uploadQueueItem.targetDirPath)
                            ) {
                                navigateToDirectory(
                                    getParentDirectory(uploadQueueItem.savedPath || "") || uploadQueueItem.targetDirPath
                                ).catch(alertError);
                            }
                            return;
                        }
                        if (uploadQueueItem.savedPath || uploadQueueItem.savedSlugPath) {
                            window.location.href = buildViewUrl(
                                handriveBaseUrl,
                                uploadQueueItem.savedSlugPath || uploadQueueItem.savedPath
                            );
                        }
                        return;
                    }
                    if (action === "delete") {
                        deleteUploadedQueueItem(uploadQueueItem).catch(alertError);
                        return;
                    }
                    return;
                }

                if (!state.contextTarget) {
                    return;
                }

                const entry = state.contextTarget;
                const entries = state.contextEntries.length > 0
                    ? state.contextEntries.slice()
                    : [entry];
                closeContextMenu();

                if (action === "open") {
                    if (entries.length > 1) {
                        openEntriesInNewTabs(entries);
                    } else {
                        openEntry(entry);
                    }
                    return;
                }
                if (action === "download") {
                    downloadEntries(entries);
                    return;
                }
                if (action === "extract-archive") {
                    if (isArchiveEntry(entry)) {
                        setArchiveExtractModalOpen(true, entry);
                    }
                    return;
                }
                if (action === "share") {
                    if (!entry || !entry.can_edit || !entry.path || !urlShareApiUrl) {
                        return;
                    }
                    openUrlShareDialogForEntry(entry);
                    return;
                }
                if (action === "upload") {
                    openContextUploadPicker(entry);
                    return;
                }
                if (action === "google-drive-add-items") {
                    openGoogleDriveItemPicker().catch(alertError);
                    return;
                }
                if (action === "create-archive") {
                    if (entries.length > 1) {
                        setArchiveCreateModalOpen(true, entries);
                        return;
                    }
                    createArchiveFromFolder(entry);
                    return;
                }
                if (action === "rename") {
                    renameEntry(entry);
                    return;
                }
                if (action === "edit") {
                    editEntry(entry);
                    return;
                }
                if (action === "new-folder") {
                    setFolderCreateModalOpen(true, entry);
                    return;
                }
                if (action === "new-doc") {
                    newDocumentInFolder(entry);
                    return;
                }
                if (action === "delete") {
                    if (entries.length === 1 && entry && entry.isCurrentFolder) {
                        deleteCurrentDirectory().catch(alertError);
                        return;
                    }
                    deleteEntries(entries.length > 1 ? entries : entry).catch(alertError);
                }
                if (action === "create-map") {
                    openMapCreateModal(entry);
                }
                if (action === "convert-mp3") {
                    convertEntryToMp3(entry).catch(alertError);
                }
                if (action === "git-create-repo") {
                    openGitRepoModal(entry);
                }
                if (action === "git-manage-repo") {
                    openGitRepoModal(entry);
                }
                if (action === "git-delete-repo") {
                    deleteEntries(entry, { repoDelete: true }).catch(alertError);
                }
                if (action === "git-create-branch") {
                    openBranchCreateModal(entry);
                }
                if (action === "git-delete-branch") {
                    deleteBranch(entry).catch(alertError);
                }
                if (action === "change-icon") {
                    if (entry && entry.type === "dir") {
                        window.requestAnimationFrame(function () {
                            setFolderIconModalOpen(true, entry);
                        });
                    }
                    return;
                }
            });
        }

        if (contextUploadInput) {
            contextUploadInput.addEventListener("change", function () {
                const targetDirPath = normalizePath(state.pendingContextUploadDir || "", true);
                state.pendingContextUploadDir = "";
                if (!contextUploadInput.files || contextUploadInput.files.length === 0) {
                    contextUploadInput.value = "";
                    return;
                }
                enqueueUploadFiles(contextUploadInput.files, targetDirPath).catch(alertError);
                contextUploadInput.value = "";
            });
        }

        if (folderIconFileInput) {
            folderIconFileInput.addEventListener("change", function () {
                if (!folderIconFileInput.files || folderIconFileInput.files.length === 0) {
                    if (folderIconPreviewWrap) { folderIconPreviewWrap.hidden = true; }
                    return;
                }
                if (folderIconPreviewImg) { folderIconPreviewImg.src = URL.createObjectURL(folderIconFileInput.files[0]); }
                if (folderIconPreviewWrap) { folderIconPreviewWrap.hidden = false; }
            });
        }

        if (folderIconModalBackdrop) {
            folderIconModalBackdrop.addEventListener("click", function () { setFolderIconModalOpen(false); });
        }

        if (folderIconCancelButton) {
            folderIconCancelButton.addEventListener("click", function () { setFolderIconModalOpen(false); });
        }

        if (folderIconDeleteButton) {
            folderIconDeleteButton.addEventListener("click", function () {
                const entry = state.folderIconTargetEntry;
                if (!entry || !folderIconDeleteApiUrl) { return; }
                requestJson(folderIconDeleteApiUrl, buildPostOptions({ path: entry.path }))
                    .then(function () { setFolderIconModalOpen(false); return refreshCurrentDirectory(); })
                    .catch(alertError);
            });
        }

        if (folderIconConfirmButton) {
            folderIconConfirmButton.addEventListener("click", function () {
                const entry = state.folderIconTargetEntry;
                if (!entry || !folderIconUploadApiUrl) { return; }
                if (!folderIconFileInput || !folderIconFileInput.files || folderIconFileInput.files.length === 0) {
                    window.alert("이미지 파일을 선택해주세요.");
                    return;
                }
                const formData = new FormData();
                formData.append("path", entry.path);
                formData.append("icon", folderIconFileInput.files[0]);
                requestFormDataJson(folderIconUploadApiUrl, formData)
                    .then(function () { setFolderIconModalOpen(false); return refreshCurrentDirectory(); })
                    .catch(alertError);
            });
        }

        if (renameModalBackdrop) {
            renameModalBackdrop.addEventListener("click", function () {
                setRenameModalOpen(false);
            });
        }

        if (renameCancelButton) {
            renameCancelButton.addEventListener("click", function () {
                setRenameModalOpen(false);
            });
        }

        if (renameConfirmButton) {
            renameConfirmButton.addEventListener("click", function () {
                submitRename().catch(alertError);
            });
        }

        if (renameInput) {
            renameInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    submitRename().catch(alertError);
                }
            });
        }

        if (archiveExtractModalBackdrop) {
            archiveExtractModalBackdrop.addEventListener("click", function () {
                setArchiveExtractModalOpen(false);
            });
        }

        if (archiveExtractCancelButton) {
            archiveExtractCancelButton.addEventListener("click", function () {
                setArchiveExtractModalOpen(false);
            });
        }

        if (archiveExtractCurrentButton) {
            archiveExtractCurrentButton.addEventListener("click", function () {
                submitArchiveExtract("current").catch(alertError);
            });
        }

        if (archiveExtractFolderButton) {
            archiveExtractFolderButton.addEventListener("click", function () {
                submitArchiveExtract("folder").catch(alertError);
            });
        }

        if (archiveCreateModalBackdrop) {
            archiveCreateModalBackdrop.addEventListener("click", function () {
                setArchiveCreateModalOpen(false);
            });
        }

        if (archiveCreateCancelButton) {
            archiveCreateCancelButton.addEventListener("click", function () {
                setArchiveCreateModalOpen(false);
            });
        }

        if (archiveCreateConfirmButton) {
            archiveCreateConfirmButton.addEventListener("click", function () {
                submitArchiveCreate();
            });
        }

        if (archiveCreateInput) {
            archiveCreateInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    submitArchiveCreate();
                }
            });
        }

        if (folderCreateModalBackdrop) {
            folderCreateModalBackdrop.addEventListener("click", function () {
                setFolderCreateModalOpen(false);
            });
        }

        if (folderCreateCancelButton) {
            folderCreateCancelButton.addEventListener("click", function () {
                setFolderCreateModalOpen(false);
            });
        }

        if (folderCreateConfirmButton) {
            folderCreateConfirmButton.addEventListener("click", function () {
                submitFolderCreate().catch(alertError);
            });
        }

        if (folderCreateInput) {
            folderCreateInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    submitFolderCreate().catch(alertError);
                }
            });
        }

        // ── 브랜치 생성 모달 ──────────────────────────────────────────────
        var _branchCreateSourceEntry = null;

        function setBranchCreateModalOpen(isOpen, entry) {
            if (!branchCreateModal) { return; }
            if (isOpen) {
                _branchCreateSourceEntry = entry || null;
                if (branchCreateTarget) {
                    branchCreateTarget.textContent = entry ? entry.name : "";
                }
                if (branchCreateInput) {
                    branchCreateInput.value = "";
                }
                branchCreateModal.hidden = false;
                syncModalBodyState();
                if (branchCreateInput) {
                    branchCreateInput.focus();
                }
            } else {
                _branchCreateSourceEntry = null;
                branchCreateModal.hidden = true;
                syncModalBodyState();
            }
        }

        function openBranchCreateModal(entry) {
            setBranchCreateModalOpen(true, entry);
        }

        async function submitBranchCreate() {
            if (!_branchCreateSourceEntry) { return; }
            const entry = _branchCreateSourceEntry;
            const repoId = entry.git_repo_id;
            const sourceBranch = entry.git_repo_branch;
            const newBranch = (branchCreateInput ? branchCreateInput.value : "").trim();
            if (!newBranch) {
                if (branchCreateInput) { branchCreateInput.focus(); }
                return;
            }
            if (!repoId || !sourceBranch) {
                alertError(new Error("브랜치 정보를 확인할 수 없습니다."));
                return;
            }
            setBranchCreateModalOpen(false);
            const apiUrl = "/api/git/repos/" + repoId + "/branches/";
            try {
                await requestJson(apiUrl, buildPostOptions({ source_branch: sourceBranch, new_branch: newBranch }));
                await loadDirectory(state.currentDir);
            } catch (err) {
                alertError(err);
            }
        }

        if (branchCreateModalBackdrop) {
            branchCreateModalBackdrop.addEventListener("click", function () {
                setBranchCreateModalOpen(false);
            });
        }

        if (branchCreateCancelButton) {
            branchCreateCancelButton.addEventListener("click", function () {
                setBranchCreateModalOpen(false);
            });
        }

        if (branchCreateConfirmButton) {
            branchCreateConfirmButton.addEventListener("click", function () {
                submitBranchCreate().catch(alertError);
            });
        }

        if (branchCreateInput) {
            branchCreateInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    submitBranchCreate().catch(alertError);
                }
            });
        }

        async function deleteBranch(entry) {
            const repoId = entry.git_repo_id;
            const branch = entry.git_repo_branch;
            if (!repoId || !branch) { return; }
            const confirmed = await requestConfirmDialog({
                title: "브랜치 삭제",
                message: "\"" + branch + "\" 브랜치를 삭제할까요?\n삭제된 브랜치는 복구할 수 없습니다.",
                cancelText: t("cancel", "취소"),
                confirmText: "삭제",
            });
            if (!confirmed) { return; }
            const apiUrl = "/api/git/repos/" + repoId + "/branches/delete/";
            await requestJson(apiUrl, Object.assign(buildPostOptions({ branch: branch }), { method: "DELETE" }));
            await loadDirectory(state.currentDir);
        }

        // ── Git 리포지토리 생성 모달 ──────────────────────────────────────
        var _gitRepoPollingTimer = null;
        var _gitRepoCurrentId = null;
        const gitRepoFlowState = {
            get currentId() {
                return _gitRepoCurrentId;
            },
            set currentId(value) {
                _gitRepoCurrentId = value;
            },
            get timer() {
                return _gitRepoPollingTimer;
            },
            set timer(value) {
                _gitRepoPollingTimer = value;
            },
        };

        function _gitRepoStopPolling() {
            gitRepoFlowStopPolling(gitRepoFlowState);
        }

        // manageMode=true: 기존 repo 조회 목적 (생성 폼 표시 안 함)
        function openGitRepoModal(entry, manageMode) {
            gitRepoFlowOpenModal({
                entry: entry,
                gitRepoForm: gitRepoForm,
                gitRepoModal: gitRepoModal,
                gitRepoNameInput: gitRepoNameInput,
                gitRepoTitle: gitRepoTitle,
                manageMode: manageMode,
                requestJson: requestJson,
                resetModalUi: function (nextEntry, isManageMode) {
                    if (!gitRepoModal) {
                        return;
                    }
                    gitRepoResetModalUi({
                        gitRepoForm: gitRepoForm,
                        gitRepoStatusDiv: gitRepoStatusDiv,
                        gitRepoNameInput: gitRepoNameInput,
                        gitRepoTarget: gitRepoTarget,
                        gitRepoTitle: gitRepoTitle,
                        gitRepoModal: gitRepoModal,
                        syncModalBodyState: syncModalBodyState,
                        entry: nextEntry,
                        formatPathLabel: getHandrivePathLabel,
                        isManageMode: isManageMode,
                        t: t,
                    });
                },
                showStatus: _showGitRepoStatus,
                startPolling: function () {
                    gitRepoFlowStartPolling({
                        intervalMs: 2000,
                        pollStatus: function () {
                            return _pollGitRepoStatus(gitRepoFlowState.currentId);
                        },
                        showStatus: _showGitRepoStatus,
                        state: gitRepoFlowState,
                        t: t,
                    });
                },
                state: gitRepoFlowState,
                stopPolling: _gitRepoStopPolling,
                t: t,
            }).catch(function () {});
        }

        function closeGitRepoModal() {
            _gitRepoStopPolling();
            gitRepoCloseModalUi({
                gitRepoModal: gitRepoModal,
                syncModalBodyState: syncModalBodyState,
            });
        }

        function _showGitRepoStatus(msg, showRetry, cloneUrl, webUrl) {
            gitRepoShowStatusUi({
                gitRepoForm: gitRepoForm,
                gitRepoStatusDiv: gitRepoStatusDiv,
                gitRepoStatusMsg: gitRepoStatusMsg,
                gitRepoRetryButton: gitRepoRetryButton,
                gitRepoCloneInfo: gitRepoCloneInfo,
                gitRepoCloneUrlInput: gitRepoCloneUrlInput,
                gitRepoOpenButton: gitRepoOpenButton,
                msg: msg,
                showRetry: showRetry,
                cloneUrl: cloneUrl,
                webUrl: webUrl,
            });
        }

        async function _pollGitRepoStatus(repoId) {
            gitRepoFlowState.currentId = repoId;
            await gitRepoFlowPollStatus({
                buildListUrl: buildListUrl,
                currentDir: state.currentDir,
                getParentDirectory: getParentDirectory,
                gitRepoModal: gitRepoModal,
                gitRepoTitle: gitRepoTitle,
                handriveBaseUrl: handriveBaseUrl,
                handriveRootUrl: handriveRootUrl,
                normalizePath: normalizePath,
                onCurrentDirRepoActivate: function (activeRepoId) {
                    currentDirGitRepo = { id: activeRepoId, status: "active" };
                },
                refreshCurrentDirectory: refreshCurrentDirectory,
                requestJson: requestJson,
                showStatus: _showGitRepoStatus,
                state: gitRepoFlowState,
                t: t,
            });
        }

        async function submitGitRepoCreate() {
            await gitRepoFlowSubmitCreate({
                buildPostOptions: buildPostOptions,
                gitRepoModal: gitRepoModal,
                gitRepoNameInput: gitRepoNameInput,
                requestJson: requestJson,
                showStatus: _showGitRepoStatus,
                startPolling: function () {
                    gitRepoFlowStartPolling({
                        intervalMs: 2000,
                        pollStatus: function () {
                            return _pollGitRepoStatus(gitRepoFlowState.currentId);
                        },
                        showStatus: _showGitRepoStatus,
                        state: gitRepoFlowState,
                        t: t,
                    });
                },
                state: gitRepoFlowState,
                t: t,
            });
        }

        async function retryGitRepo() {
            await gitRepoFlowRetryCreate({
                buildPostOptions: buildPostOptions,
                requestJson: requestJson,
                showStatus: _showGitRepoStatus,
                startPolling: function () {
                    gitRepoFlowStartPolling({
                        intervalMs: 2000,
                        pollStatus: function () {
                            return _pollGitRepoStatus(gitRepoFlowState.currentId);
                        },
                        showStatus: _showGitRepoStatus,
                        state: gitRepoFlowState,
                        t: t,
                    });
                },
                state: gitRepoFlowState,
                t: t,
            });
        }

        if (gitRepoModalBackdrop) {
            gitRepoModalBackdrop.addEventListener("click", closeGitRepoModal);
        }
        if (gitRepoCancelButton) {
            gitRepoCancelButton.addEventListener("click", closeGitRepoModal);
        }
        if (gitRepoCloseButton) {
            gitRepoCloseButton.addEventListener("click", closeGitRepoModal);
        }
        if (gitRepoCopyButton) {
            gitRepoCopyButton.addEventListener("click", function () {
                var url = gitRepoCloneUrlInput ? gitRepoCloneUrlInput.value : "";
                if (!url) return;
                navigator.clipboard.writeText(url).then(function () {
                    gitRepoCopyButton.textContent = t("git_repo_copied_button", "복사됨!");
                    setTimeout(function () {
                        gitRepoCopyButton.textContent = t("git_repo_copy_button", "복사");
                    }, 1500);
                }).catch(function () {
                    if (gitRepoCloneUrlInput) {
                        gitRepoCloneUrlInput.select();
                        document.execCommand("copy");
                    }
                });
            });
        }
        if (gitRepoConfirmButton) {
            gitRepoConfirmButton.addEventListener("click", function () {
                submitGitRepoCreate().catch(alertError);
            });
        }
        if (gitRepoNameInput) {
            gitRepoNameInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    submitGitRepoCreate().catch(alertError);
                }
            });
        }
        if (gitRepoRetryButton) {
            gitRepoRetryButton.addEventListener("click", function () {
                retryGitRepo().catch(alertError);
            });
        }
        // ─────────────────────────────────────────────────────────────────

        // 지도 생성 모달
        let _mapCreateTargetEntry = null;

        function openMapCreateModal(entry) {
            if (!window.HandriveMapFlowHelpers) { return; }
            _mapCreateTargetEntry = entry;
            HandriveMapFlowHelpers.openMapCreateModal({
                modal: mapCreateModal,
                input: mapCreateInput,
                target: mapCreateTarget,
                entry: entry,
                syncModalBodyState: syncModalBodyState,
            });
        }

        function closeMapCreateModal() {
            if (!window.HandriveMapFlowHelpers) { return; }
            HandriveMapFlowHelpers.closeMapCreateModal({
                modal: mapCreateModal,
                syncModalBodyState: syncModalBodyState,
            });
        }

        function submitMapCreate() {
            if (!window.HandriveMapFlowHelpers) { return; }
            HandriveMapFlowHelpers.submitMapCreate({
                entry: _mapCreateTargetEntry,
                input: mapCreateInput,
                mapCreateApiUrl: mapCreateApiUrl,
                mapEditorBaseUrl: mapEditorBaseUrl,
                requestJson: requestJson,
                buildPostOptions: buildPostOptions,
                selectServerMessage: selectServerMessage,
                onClose: closeMapCreateModal,
                onError: alertError,
            });
        }

        if (mapCreateModalBackdrop) {
            mapCreateModalBackdrop.addEventListener("click", closeMapCreateModal);
        }
        if (mapCreateCancelButton) {
            mapCreateCancelButton.addEventListener("click", closeMapCreateModal);
        }
        if (mapCreateConfirmButton) {
            mapCreateConfirmButton.addEventListener("click", submitMapCreate);
        }
        if (mapCreateInput) {
            mapCreateInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    submitMapCreate();
                }
            });
        }
        // ─────────────────────────────────────────────────────────────────

        if (previewDeleteButton) {
            previewDeleteButton.addEventListener("click", function () {
                const selectedEntries = getSelectedEntries();
                if (selectedEntries.length !== 1) {
                    return;
                }
                const selectedEntry = selectedEntries[0];
                if (!isPreviewableFileEntry(selectedEntry) || !selectedEntry.can_edit) {
                    return;
                }
                deleteEntries(selectedEntry).catch(alertError);
            });
        }

        if (previewPrintButton) {
            previewPrintButton.addEventListener("click", function () {
                const entry = state.activePreviewPath
                    ? state.entryByPath.get(state.activePreviewPath) || null
                    : null;
                if (
                    !isPreviewableFileEntry(entry) ||
                    entry.can_read === false ||
                    state.activeRenderedPreviewPath !== normalizePath(entry.path, true) ||
                    state.activePreviewRenderMode === "unsupported" ||
                    state.activePreviewRenderMode === "media_video"
                ) {
                    return;
                }
                const previewTitleText = previewTitle
                    ? previewTitle.querySelector(".handrive-list-preview-title-text") || previewTitle
                    : null;
                printRenderedHandriveFile(previewContent, {
                    title: previewTitleText
                        ? previewTitleText.textContent
                        : entry.name || document.title,
                    officePdfUrl: isHandriveOfficePdfPrintPath(entry.name || entry.path)
                        ? buildHandrivePdfPreviewUrl(pdfPreviewApiUrl, entry.path)
                        : "",
                    sourceUrl: buildDownloadUrl(entry.path),
                    renderMode: state.activePreviewRenderMode || "",
                });
            });
        }

        document.addEventListener("keydown", function (event) {
            const loweredKey = String(event.key || "").toLowerCase();
            if (!(event.metaKey || event.ctrlKey) || event.altKey || loweredKey !== "s") {
                return;
            }
            if (
                !editorPanel ||
                editorPanel.hidden ||
                !spreadsheetEditorSurface ||
                spreadsheetEditorSurface.hidden ||
                !editorSaveButton
            ) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (!editorSaveButton.disabled) {
                editorSaveButton.click();
            }
        }, true);

        if (previewZoomOutButton) {
            previewZoomOutButton.addEventListener("click", function () {
                setPreviewImageZoom(state.previewImageZoom - 0.25);
            });
        }

        if (previewZoomInButton) {
            previewZoomInButton.addEventListener("click", function () {
                setPreviewImageZoom(state.previewImageZoom + 0.25);
            });
        }

        if (previewContent) {
            previewContent.addEventListener("click", openClickedImagePictureInPicture);

            let listPreviewFontSize = 16;
            previewContent.addEventListener("wheel", function (event) {
                if (!event.ctrlKey && !event.metaKey) return;
                if (previewContent.classList.contains("handrive-media")) {
                    event.preventDefault();
                    const delta = event.deltaY < 0 ? 0.15 : -0.15;
                    setPreviewImageZoom(state.previewImageZoom + delta);
                    return;
                }
                event.preventDefault();
                const delta = event.deltaY < 0 ? 2 : -2;
                listPreviewFontSize = Math.max(8, Math.min(40, listPreviewFontSize + delta));
                previewContent.style.setProperty("--handrive-text-font-size", listPreviewFontSize + "px");
            }, { passive: false });
        }

        if (previewUrlShareButton) {
            previewUrlShareButton.addEventListener("click", function () {
                const selectedEntries = getSelectedEntries();
                const selectedEntry = selectedEntries.length === 1
                    ? selectedEntries[0]
                    : (state.activePreviewPath ? state.entryByPath.get(state.activePreviewPath) || null : null);
                if (!isPreviewableFileEntry(selectedEntry) || !selectedEntry.can_edit) {
                    return;
                }
                const shouldShowDownloadUrl = isSimpleUrlShareFileEntry(selectedEntry);
                urlShareModal.open({
                    isUrlOnly: Boolean(selectedEntry.is_url_only),
                    shareUrl: selectedEntry.share_url || "",
                    downloadUrl: shouldShowDownloadUrl ? toAbsoluteUrl(selectedEntry.share_download_url || "") : "",
                    allowedUsers: selectedEntry.share_allowed_users || [],
                    readOnly: Boolean(selectedEntry.share_is_inherited),
                    onToggle: async function (enabled, allowedUsernames) {
                        const data = await requestJson(
                            appendSharedQuery(urlShareApiUrl),
                            buildPostOptions({
                                path: selectedEntry.path,
                                enabled: enabled,
                                allowed_usernames: allowedUsernames || [],
                            })
                        );
                        await refreshCurrentDirectory();
                        const refreshedEntry = state.entryByPath.get(selectedEntry.path);
                        if (refreshedEntry) {
                            await loadPreviewForEntry(refreshedEntry);
                            await updatePreviewNavButtons(refreshedEntry);
                        } else {
                            clearPreviewPane();
                        }
                        return {
                            isUrlOnly: Boolean(data.is_url_only),
                            shareUrl: data.share_url || "",
                            downloadUrl: shouldShowDownloadUrl ? toAbsoluteUrl(data.share_download_url || "") : "",
                            allowedUsers: data.share_allowed_users || [],
                        };
                    },
                });
            });
        }

        if (currentDirToolbarUrlShareButton) {
            currentDirToolbarUrlShareButton.addEventListener("click", function () {
                const currentDirEntry = buildCurrentDirectoryToolbarEntry();
                if (!currentDirEntry || !currentDirEntry.can_edit) {
                    return;
                }
                openUrlShareDialogForEntry(currentDirEntry);
            });
        }

        if (currentDirToolbarDeleteButton) {
            currentDirToolbarDeleteButton.addEventListener("click", function () {
                deleteCurrentDirectory().catch(alertError);
            });
        }

        if (archiveToolbarUrlShareButton) {
            archiveToolbarUrlShareButton.addEventListener("click", function () {
                const archiveEntry = buildCurrentArchiveFileEntry();
                if (!archiveEntry || !archiveEntry.can_edit) {
                    return;
                }
                openUrlShareDialogForEntry(archiveEntry);
            });
        }

        if (archiveToolbarDeleteButton) {
            archiveToolbarDeleteButton.addEventListener("click", function () {
                deleteCurrentArchiveFile().catch(alertError);
            });
        }

        if (listContainer) {
            listContainer.addEventListener("contextmenu", function (event) {
                if (event.defaultPrevented) {
                    return;
                }
                const targetElement = event.target instanceof Element ? event.target : null;
                if (!targetElement) {
                    return;
                }
                const row = targetElement.closest(".handrive-item-row");
                if (!row || !listContainer.contains(row)) {
                    return;
                }
                const entryPath = normalizePath(row.getAttribute("data-entry-path") || "", true);
                const entry = state.entryByPath.get(entryPath) || null;
                if (!entry) {
                    return;
                }
                event.preventDefault();
                openContextMenuForEntry(entry, event.clientX, event.clientY);
            });
        }

        if (!listMarkdownSnippetEventsBound && markdownSnippetMenu) {
            listMarkdownSnippetEventsBound = true;

            markdownSnippetButtons.forEach(function (button) {
                button.addEventListener("click", function () {
                    const snippetType = button.getAttribute("data-editor-snippet") || "";
                    insertListMarkdownSnippet(snippetType);
                    closeListMarkdownSnippetMenu();
                });
            });

            if (editorSurface) {
                editorSurface.addEventListener("contextmenu", function (event) {
                    if (editorPanel && editorPanel.hidden) {
                        return;
                    }
                    const currentExtension = resolveListEditorExtension() || ".md";
                    if (currentExtension !== ".md") {
                        closeListMarkdownSnippetMenu();
                        return;
                    }
                    const visibleCount = syncListSnippetMenuItemsByExtension(currentExtension);
                    if (visibleCount <= 0) {
                        closeListMarkdownSnippetMenu();
                        return;
                    }
                    event.preventDefault();
                    openListMarkdownSnippetMenu(event.clientX, event.clientY);
                });
            }
        }

        document.addEventListener("click", function (event) {
            if (!contextMenu || contextMenu.hidden) {
                return;
            }
            if (!contextMenu.contains(event.target)) {
                closeContextMenu();
            }
        });

        document.addEventListener("keydown", function (event) {
            const key = String(event.key || "");
            if (key === "Delete" || key === "Backspace") {
                if (
                    isKeyboardEditableTarget(event.target) ||
                    (contextMenu && !contextMenu.hidden) ||
                    hasOpenHandriveModal()
                ) {
                    return;
                }

                const selectedEntries = getSelectedEntries().filter(function (entry) {
                    return isEntryDeletable(entry);
                });
                if (selectedEntries.length === 0) {
                    if (key === "Backspace") {
                        event.preventDefault();
                    }
                    return;
                }

                event.preventDefault();
                deleteEntries(selectedEntries.length > 1 ? selectedEntries : selectedEntries[0]).catch(alertError);
                return;
            }

            if (key === "Escape") {
                if (folderCreateModal && !folderCreateModal.hidden) {
                    setFolderCreateModalOpen(false);
                    return;
                }
                if (archiveExtractModal && !archiveExtractModal.hidden) {
                    setArchiveExtractModalOpen(false);
                    return;
                }
                if (archiveCreateModal && !archiveCreateModal.hidden) {
                    setArchiveCreateModalOpen(false);
                    return;
                }
                if (renameModal && !renameModal.hidden) {
                    setRenameModalOpen(false);
                    return;
                }
                if (markdownSnippetMenu && !markdownSnippetMenu.hidden) {
                    closeListMarkdownSnippetMenu();
                    return;
                }
                if (syncModal && !syncModal.hidden) {
                    setSyncModalOpen(false);
                    return;
                }
                if (folderIconModal && !folderIconModal.hidden) {
                    setFolderIconModalOpen(false);
                    return;
                }
                closeContextMenu();
            }
        });

        document.addEventListener("mousedown", function (event) {
            if (!markdownSnippetMenu || markdownSnippetMenu.hidden) {
                return;
            }
            if (event.target instanceof Element && markdownSnippetMenu.contains(event.target)) {
                return;
            }
            closeListMarkdownSnippetMenu();
        });

        if (listPane && uploadApiUrl) {
            listPane.addEventListener("dragenter", function (event) {
                if (!isFileTransfer(event)) {
                    return;
                }
                const currentDirRow = getCurrentDirectoryDropRow();
                if (currentDirRow && isCurrentDirectoryDropEvent(event, currentDirRow)) {
                    activateFileDropTarget(event, state.currentDir, currentDirRow);
                    return;
                }
                if (isInsideCurrentFileDropGroup(event.target)) {
                    event.preventDefault();
                    return;
                }
                if (currentDirRow && isBareListFileDropTarget(event.target)) {
                    activateFileDropTarget(event, state.currentDir, currentDirRow);
                    return;
                }
                clearFileDragUiState();
            });

            listPane.addEventListener("dragover", function (event) {
                if (!isFileTransfer(event)) {
                    return;
                }
                const currentDirRow = getCurrentDirectoryDropRow();
                if (currentDirRow && isCurrentDirectoryDropEvent(event, currentDirRow)) {
                    activateFileDropTarget(event, state.currentDir, currentDirRow);
                    return;
                }
                if (!isInsideCurrentFileDropGroup(event.target)) {
                    if (currentDirRow && isBareListFileDropTarget(event.target)) {
                        activateFileDropTarget(event, state.currentDir, currentDirRow);
                        return;
                    }
                    clearFileDragUiState();
                    return;
                }
                event.preventDefault();
                if (event.dataTransfer) {
                    event.dataTransfer.dropEffect = "copy";
                }
            });

            listPane.addEventListener("dragleave", function (event) {
                if (!isFileTransfer(event)) {
                    return;
                }
                if (event.relatedTarget && listPane.contains(event.relatedTarget)) {
                    return;
                }
                if (isPointerInsideElement(event, listPane)) {
                    return;
                }
                clearFileDragUiState();
            });

            listPane.addEventListener("drop", function (event) {
                if (!isFileTransfer(event)) {
                    return;
                }
                event.preventDefault();
                const currentDirRow = getCurrentDirectoryDropRow();
                const targetDirPath = currentDirRow && isCurrentDirectoryDropEvent(event, currentDirRow)
                    ? state.currentDir
                    : (
                        isInsideCurrentFileDropGroup(event.target) && state.fileDropGroupPath
                            ? state.fileDropGroupPath
                            : state.currentDir
                    );
                clearFileDragUiState();
                enqueueUploadFiles(
                    event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files : [],
                    targetDirPath
                ).catch(alertError);
            });
        }

        if (listPane && moveApiUrl) {
            listPane.addEventListener("dragenter", function (event) {
                if (isFileTransfer(event) || !hasActiveDriveDrag()) {
                    return;
                }
                const currentDirRow = getCurrentDirectoryDropRow();
                if (
                    currentDirRow &&
                    isCurrentDirectoryDropEvent(event, currentDirRow) &&
                    canDropToDirectory(state.currentDir)
                ) {
                    activateDriveMoveDropTarget(event, state.currentDir, currentDirRow);
                    return;
                }
                if (isInsideCurrentFileDropGroup(event.target)) {
                    event.preventDefault();
                    if (event.dataTransfer) {
                        event.dataTransfer.dropEffect = resolveDriveDropEffect(state.fileDropGroupPath || state.currentDir);
                    }
                    return;
                }
                if (
                    currentDirRow &&
                    isBareListFileDropTarget(event.target) &&
                    canDropToDirectory(state.currentDir)
                ) {
                    activateDriveMoveDropTarget(event, state.currentDir, currentDirRow);
                    return;
                }
                clearDragOverTarget();
            });

            listPane.addEventListener("dragover", function (event) {
                if (isFileTransfer(event) || !hasActiveDriveDrag()) {
                    return;
                }
                const currentDirRow = getCurrentDirectoryDropRow();
                if (
                    currentDirRow &&
                    isCurrentDirectoryDropEvent(event, currentDirRow) &&
                    canDropToDirectory(state.currentDir)
                ) {
                    activateDriveMoveDropTarget(event, state.currentDir, currentDirRow);
                    return;
                }
                if (isInsideCurrentFileDropGroup(event.target)) {
                    event.preventDefault();
                    if (event.dataTransfer) {
                        event.dataTransfer.dropEffect = resolveDriveDropEffect(state.fileDropGroupPath || state.currentDir);
                    }
                    return;
                }
                if (
                    currentDirRow &&
                    isBareListFileDropTarget(event.target) &&
                    canDropToDirectory(state.currentDir)
                ) {
                    activateDriveMoveDropTarget(event, state.currentDir, currentDirRow);
                    return;
                }
                clearDragOverTarget();
            });

            listPane.addEventListener("drop", function (event) {
                if (isFileTransfer(event) || !hasActiveDriveDrag()) {
                    return;
                }
                const currentDirRow = getCurrentDirectoryDropRow();
                const targetDirPath = currentDirRow && isCurrentDirectoryDropEvent(event, currentDirRow)
                    ? state.currentDir
                    : (
                        isInsideCurrentFileDropGroup(event.target) && state.fileDropGroupPath
                            ? state.fileDropGroupPath
                            : state.currentDir
                    );
                if (!canDropToDirectory(targetDirPath)) {
                    return;
                }
                event.preventDefault();
                clearHoverExpandTimer();
                clearDragOverTarget();
                moveEntriesToDirectory(state.draggingEntries.slice(), targetDirPath).catch(alertError);
            });
        }

        document.addEventListener("drop", function () {
            clearFileDragUiState();
        });

        document.addEventListener("dragend", function () {
            clearFileDragUiState();
        });

        document.addEventListener("paste", function (event) {
            if (!uploadApiUrl || shouldIgnorePasteUploadTarget()) {
                return;
            }
            const clipboardData = event.clipboardData;
            if (!clipboardData) {
                return;
            }

            const files = [];
            if (clipboardData.files && clipboardData.files.length > 0) {
                Array.from(clipboardData.files).forEach(function (file) {
                    if (file) {
                        files.push(file);
                    }
                });
            } else if (clipboardData.items && clipboardData.items.length > 0) {
                Array.from(clipboardData.items).forEach(function (item) {
                    if (!item || item.kind !== "file") {
                        return;
                    }
                    const file = item.getAsFile();
                    if (file) {
                        files.push(file);
                    }
                });
            }

            if (!files.length) {
                return;
            }

            event.preventDefault();
            var pasteTargetDir = state.currentDir;
            if (state.selectedPaths.size === 1) {
                var selectedEntries = getSelectedEntries();
                if (selectedEntries.length === 1 && selectedEntries[0].type === "dir") {
                    pasteTargetDir = normalizePath(selectedEntries[0].path, true);
                }
            }
            resolveClipboardUploadFilenames(files, pasteTargetDir)
                .then(function (resolvedFiles) {
                    if (!resolvedFiles || !resolvedFiles.length) {
                        return null;
                    }
                    return enqueueUploadFiles(resolvedFiles, pasteTargetDir);
                })
                .catch(alertError);
        });

        if (uploadQueueToggleButton) {
            uploadQueueToggleButton.addEventListener("click", function () {
                state.uploadQueueCollapsed = !state.uploadQueueCollapsed;
                renderUploadQueue();
            });
        }

        if (uploadQueueCloseButton) {
            uploadQueueCloseButton.addEventListener("click", function () {
                state.uploadQueueDismissed = true;
                renderUploadQueue();
            });
        }

        if (syncLaunchButton && syncModal) {
            syncLaunchButton.hidden = false;
            syncLaunchButton.addEventListener("click", function (event) {
                event.preventDefault();
                event.stopPropagation();
                setSyncModalOpen(true);
            });
        }

        if (syncModalBackdrop) {
            syncModalBackdrop.addEventListener("click", function () {
                setSyncModalOpen(false);
            });
        }

        if (syncCloseButton) {
            syncCloseButton.addEventListener("click", function () {
                setSyncModalOpen(false);
            });
        }

        if (syncCancelButton) {
            syncCancelButton.addEventListener("click", function () {
                setSyncModalOpen(false);
            });
        }

        if (syncSaveButton) {
            syncSaveButton.addEventListener("click", async function () {
                syncSaveButton.disabled = true;
                try {
                    await submitSyncSettings();
                } catch (error) {
                    alertError(error);
                } finally {
                    syncSaveButton.disabled = false;
                }
            });
        }

        window.addEventListener("scroll", closeContextMenu, { passive: true });
        window.addEventListener("resize", closeContextMenu, { passive: true });
        window.addEventListener("scroll", closeListMarkdownSnippetMenu, { passive: true });
        window.addEventListener("resize", closeListMarkdownSnippetMenu, { passive: true });
        window.addEventListener("resize", debouncedUpdateListLayoutMode, { passive: true });
        window.addEventListener("orientationchange", debouncedUpdateListLayoutMode, { passive: true });
        window.addEventListener("resize", updateListColumnVisibility, { passive: true });
        window.addEventListener("orientationchange", updateListColumnVisibility, { passive: true });
        window.addEventListener("resize", scheduleListBodyHeight, { passive: true });
        window.addEventListener("orientationchange", scheduleListBodyHeight, { passive: true });
        window.addEventListener("resize", schedulePreviewBodyHeight, { passive: true });
        window.addEventListener("orientationchange", schedulePreviewBodyHeight, { passive: true });
        window.addEventListener("resize", scheduleEditorBodyHeight, { passive: true });
        window.addEventListener("orientationchange", scheduleEditorBodyHeight, { passive: true });
        window.addEventListener("handrive:github-repositories-updated", function () {
            if (root.dataset.currentDirIsRoot !== "1") {
                return;
            }
            refreshCurrentDirectory({ skipPreview: true }).catch(alertError);
        });
        window.addEventListener("handrive:google-drive-updated", function () {
            if (root.dataset.currentDirIsRoot === "1" || root.dataset.currentDirIsGoogleDrive === "1") {
                refreshCurrentDirectory({ skipPreview: true }).catch(alertError);
            }
        });

        if (window.ResizeObserver && previewHead) {
            const previewHeadResizeObserver = new ResizeObserver(function () {
                scheduleSyncCurrentDirRowHeightWithSideHead();
            });
            previewHeadResizeObserver.observe(previewHead);
        }

        if (previewTitle) {
            const previewTitleText = previewTitle.querySelector(".handrive-list-preview-title-text");
            if (previewTitleText) {
                previewTitleText.addEventListener("dblclick", function () {
                    const entry = state.activePreviewPath
                        ? state.entryByPath.get(state.activePreviewPath) || null
                        : null;
                    if (entry) {
                        openEntry(entry);
                    }
                });
            }
        }

        if (window.ResizeObserver) {
            if (listPane) {
                const listPaneResizeObserver = new ResizeObserver(function () {
                    updateListColumnVisibility();
                    scheduleListBodyHeight();
                });
                listPaneResizeObserver.observe(listPane);
            }
            const toolbarWrap = document.querySelector(".handrive-toolbar-wrap");
            if (toolbarWrap) {
                const listToolbarResizeObserver = new ResizeObserver(function () {
                    scheduleListBodyHeight();
                    schedulePreviewBodyHeight();
                    scheduleEditorBodyHeight();
                });
                listToolbarResizeObserver.observe(toolbarWrap);
            }
            const footerLinks = document.querySelector(".site-footer-links");
            if (footerLinks) {
                const listFooterResizeObserver = new ResizeObserver(function () {
                    scheduleListBodyHeight();
                    schedulePreviewBodyHeight();
                    scheduleEditorBodyHeight();
                });
                listFooterResizeObserver.observe(footerLinks);
            }
        }

        if (listPane) {
            listPane.addEventListener("handrive:metacontentchange", function () {
                window.requestAnimationFrame(updateListColumnVisibility);
            });
            if (window.MutationObserver) {
                const metaMutationObserver = new MutationObserver(function (mutations) {
                    const hasMetaMutation = mutations.some(function (mutation) {
                        if (!(mutation.target instanceof Element)) {
                            return false;
                        }
                        if (mutation.target.closest(".handrive-item-commit, .handrive-item-id")) {
                            return true;
                        }
                        for (let index = 0; index < mutation.addedNodes.length; index += 1) {
                            const node = mutation.addedNodes[index];
                            if (node instanceof Element && node.closest(".handrive-item-commit, .handrive-item-id")) {
                                return true;
                            }
                        }
                        for (let index = 0; index < mutation.removedNodes.length; index += 1) {
                            const node = mutation.removedNodes[index];
                            if (node instanceof Element && (node.matches(".handrive-item-commit, .handrive-item-id") || node.querySelector(".handrive-item-commit, .handrive-item-id"))) {
                                return true;
                            }
                        }
                        return false;
                    });
                    if (hasMetaMutation) {
                        window.requestAnimationFrame(updateListColumnVisibility);
                    }
                });
                metaMutationObserver.observe(listPane, {
                    childList: true,
                    characterData: true,
                    subtree: true,
                });
            }
        }

        handriveListItemScale = readStoredHandriveListItemScale();
        applyHandriveListItemScale(handriveListItemScale, {
            skipLayout: true,
            skipPersist: true,
        });
        if (listItemsContainer) {
            listItemsContainer.addEventListener("wheel", handleHandriveListItemsScaleWheel, { passive: false });
        }

        schedulePreviewBodyHeight();
        scheduleEditorBodyHeight();
        scheduleListBodyHeight();

        updateDirectoryHistory(state.currentDir, "replace");

        if (pathBreadcrumbs) {
            pathBreadcrumbs.addEventListener("click", function (event) {
                const link = event.target instanceof Element
                    ? event.target.closest("a.ui-path-link[data-handrive-dir]")
                    : null;
                if (!link) {
                    return;
                }
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                    return;
                }
                event.preventDefault();
                navigateToDirectory(link.getAttribute("data-handrive-dir") || "").catch(alertError);
            });
            renderPathBreadcrumbs(state.currentDir);
        } else {
            bindHandrivePathDropTargets();
        }

        window.addEventListener("popstate", function (event) {
            const historyState = event.state || {};
            if (!Object.prototype.hasOwnProperty.call(historyState, "handriveListDir")) {
                return;
            }
            navigateToDirectory(historyState.handriveListDir || "", {
                historyMode: "skip",
            }).catch(alertError);
        });

        ensureListSearchForm();
        if (listSearchForm && listSearchInput) {
            listSearchForm.addEventListener("submit", function (event) {
                event.preventDefault();
                event.stopPropagation();
                applyListSearch(listSearchInput).catch(alertError);
            });

            listSearchInput.addEventListener("input", function () {
                syncSearchInputValues(listSearchInput.value, listSearchInput);
            });

            listSearchInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    applyListSearch(listSearchInput).catch(alertError);
                }
            });
        }

        if (listSearchSubmitButton) {
            listSearchSubmitButton.addEventListener("click", function (event) {
                event.preventDefault();
                applyListSearch(listSearchInput).catch(alertError);
            });
        }

        if (listSearchClearButton && listSearchInput) {
            listSearchClearButton.addEventListener("click", function (event) {
                event.preventDefault();
                listSearchInput.value = "";
                syncSearchInputValues("", listSearchInput);
                applyListSearch(listSearchInput).catch(alertError);
                listSearchInput.focus();
            });
            updateSearchClearButtonVisibility();
        }

        function openInitialEditTargetFromQuery() {
            var editPath = "";
            try {
                editPath = normalizePath(new URLSearchParams(window.location.search).get("edit") || "", true);
            } catch (error) {
                editPath = "";
            }
            if (!editPath) {
                return;
            }
            var entry = state.entryByPath.get(editPath) || null;
            if (!entry || entry.type !== "file" || !entry.can_edit) {
                return;
            }
            applySelection([entry.path], {
                primaryPath: entry.path,
                anchorPath: entry.path,
                skipPreview: true,
            });
            switchToEditor(entry);
        }
        
        // 초기화 시 약간의 지연 후 레이아웃 업데이트
        setTimeout(function() {
            updateListLayoutMode();
            updateListColumnVisibility();
        }, 100);
        
        clearPreviewPane();
        syncArchiveToolbarActions();
        renderList();
        openInitialEditTargetFromQuery();
        enqueuePendingYoutubeDownloaderSave();
        var initialSearchQuery = listSearchInput
            ? String(new URLSearchParams(window.location.search).get("q") || "").trim()
            : "";
        if (initialSearchQuery && listSearchInput) {
            listSearchInput.value = initialSearchQuery;
            syncSearchInputValues(initialSearchQuery, listSearchInput);
            applyListSearch(listSearchInput).catch(alertError);
        }
    }

    function initializeViewPage() {
        const handriveBaseUrl = root.dataset.handriveBaseUrl || "/handrive";
        const handriveRootUrl = root.dataset.handriveRootUrl || handriveBaseUrl;
        const deleteApiUrl = root.dataset.deleteApiUrl;
        const urlShareApiUrl = root.dataset.urlShareApiUrl;
        const listApiUrl = root.dataset.listApiUrl || "";
        const previewApiUrl = root.dataset.previewApiUrl || "";
        const pdfPreviewApiUrl = root.dataset.pdfPreviewApiUrl || "";
        let currentDocPath = root.dataset.docPath || "";
        let currentDocSlugPath = root.dataset.docSlugPath || currentDocPath;
        const docIsUrlOnly = root.dataset.docIsUrlOnly === "1";
        const initialDocShareAllowedUsers = getJsonScriptData("handrive-doc-share-allowed-users", []);
        const parentDir = root.dataset.parentDir || "";
        const deleteButton = document.getElementById("handrive-delete-btn");
        const printButton = document.getElementById("handrive-print-btn");
        const urlShareButton = document.getElementById("handrive-url-share-btn");
        const contentArticle = document.querySelector(".handrive-content > article");
        const viewZoomWrap = document.getElementById("handrive-view-zoom");
        const viewZoomOutButton = document.getElementById("handrive-view-zoom-out");
        const viewZoomInButton = document.getElementById("handrive-view-zoom-in");
        const viewNavPrevBtn = document.getElementById("handrive-view-nav-prev");
        const viewNavNextBtn = document.getElementById("handrive-view-nav-next");
        const viewNavBg = document.getElementById("handrive-view-nav-bg");
        const viewNavBgPrev = viewNavBg ? viewNavBg.querySelector("span:first-child") : null;
        const viewNavBgNext = viewNavBg ? viewNavBg.querySelector("span:last-child") : null;
        let viewImageZoom = 1;

        const viewMediaNavExtensions = new Set([
            ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif", ".tiff", ".tif", ".ico",
            ".mp4", ".webm", ".mov", ".mkv", ".m4v", ".ogv",
        ]);

        function isViewMediaNavEntry(entry) {
            return Boolean(entry && entry.type === "file" && viewMediaNavExtensions.has(getPathFileExtension(entry.name)));
        }

        function getViewImageElement() {
            return contentArticle
                ? contentArticle.querySelector(".handrive-media-image-element")
                : null;
        }

        function syncViewImageZoom() {
            const imageWrap = contentArticle
                ? contentArticle.querySelector(".handrive-media-image-wrap")
                : null;
            const hasImage = Boolean(imageWrap && contentArticle && contentArticle.classList.contains("handrive-media"));
            if (viewZoomWrap) {
                viewZoomWrap.hidden = !hasImage;
            }
            if (!hasImage || !imageWrap) {
                return;
            }
            imageWrap.style.transform = "scale(" + String(viewImageZoom) + ")";
            if (contentArticle) {
                contentArticle.scrollLeft = 0;
                contentArticle.scrollTop = 0;
            }
        }

        function getViewImageMinZoom() {
            const imageElement = getViewImageElement();
            if (!contentArticle || !imageElement) {
                return 0.5;
            }
            const naturalWidth = Number(imageElement.naturalWidth || imageElement.width || 0);
            const availableWidth = Math.max(1, contentArticle.clientWidth || 0);
            if (!naturalWidth) {
                return 0.5;
            }
            return Math.max(0.05, Math.min(0.1, availableWidth / naturalWidth));
        }

        function setViewImageZoom(nextZoom) {
            const minZoom = getViewImageMinZoom();
            viewImageZoom = Math.max(minZoom, Math.min(3, Number(nextZoom) || 1));
            syncViewImageZoom();
        }

        function setViewNavBackgroundVisible(visible) {
            if (!viewNavBg) return;
            viewNavBg.hidden = !visible;
            viewNavBg.classList.toggle("is-visible", Boolean(visible));
        }

        function bindViewNavButtonEffects(btn) {
            if (!btn || btn._viewNavFxBound) return;
            btn._viewNavFxBound = true;
            const clearPressed = function () {
                btn.classList.remove("is-pressed");
            };
            const clearHovered = function () {
                btn.classList.remove("is-hovered");
            };
            const playReveal = function () {
                if (btn.hidden) return;
                btn.classList.remove("is-revealing");
                void btn.offsetWidth;
                btn.classList.add("is-revealing");
                window.setTimeout(function () {
                    btn.classList.remove("is-revealing");
                }, 200);
            };

            btn.addEventListener("pointerenter", function () {
                btn.classList.add("is-hovered");
            });
            btn.addEventListener("pointerleave", function () {
                clearHovered();
                clearPressed();
            });
            btn.addEventListener("focus", function () {
                btn.classList.add("is-hovered");
            });
            btn.addEventListener("blur", function () {
                clearHovered();
                clearPressed();
            });
            btn.addEventListener("pointerdown", function (event) {
                if (event.button !== 0) return;
                btn.classList.add("is-pressed");
                playReveal();
            });
            btn.addEventListener("pointerup", clearPressed);
            btn.addEventListener("pointercancel", clearPressed);
            btn.addEventListener("click", playReveal);
        }

        function updateViewNavButtons(siblings, currentPath) {
            if (!viewNavPrevBtn || !viewNavNextBtn) return;
            const normalizedCurrent = normalizePath(currentPath, true);
            const idx = siblings.findIndex(function (e) {
                return normalizePath(e.path, true) === normalizedCurrent;
            });
            const prevEntry = idx > 0 ? siblings[idx - 1] : null;
            const nextEntry = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
            const wasPrevHidden = viewNavPrevBtn.hidden;
            const wasNextHidden = viewNavNextBtn.hidden;
            viewNavPrevBtn.hidden = !prevEntry;
            viewNavNextBtn.hidden = !nextEntry;
            viewNavPrevBtn._navTarget = prevEntry || null;
            viewNavNextBtn._navTarget = nextEntry || null;
            if (viewNavBgPrev) viewNavBgPrev.hidden = !prevEntry;
            if (viewNavBgNext) viewNavBgNext.hidden = !nextEntry;
            setViewNavBackgroundVisible(Boolean(prevEntry || nextEntry));
            if (wasPrevHidden && prevEntry) {
                bindViewNavButtonEffects(viewNavPrevBtn);
                viewNavPrevBtn.classList.remove("is-revealing");
                void viewNavPrevBtn.offsetWidth;
                viewNavPrevBtn.classList.add("is-revealing");
                window.setTimeout(function () {
                    viewNavPrevBtn.classList.remove("is-revealing");
                }, 180);
            }
            if (wasNextHidden && nextEntry) {
                bindViewNavButtonEffects(viewNavNextBtn);
                viewNavNextBtn.classList.remove("is-revealing");
                void viewNavNextBtn.offsetWidth;
                viewNavNextBtn.classList.add("is-revealing");
                window.setTimeout(function () {
                    viewNavNextBtn.classList.remove("is-revealing");
                }, 180);
            }
        }

        let viewNavSiblings = [];
        let viewNavRequestToken = 0;

        async function loadViewNavSiblings() {
            if (!listApiUrl || !contentArticle) return;
            try {
                const data = await requestJson(
                    appendSharedQuery(listApiUrl + "?path=" + encodeURIComponent(parentDir))
                );
                const entries = Array.isArray(data.entries) ? data.entries : [];
                viewNavSiblings = entries.filter(isViewMediaNavEntry);
                updateViewNavButtons(viewNavSiblings, currentDocPath);
            } catch (e) {}
        }

        async function navigateViewToEntry(entry) {
            if (!entry || !previewApiUrl || !contentArticle) return;
            const requestToken = viewNavRequestToken + 1;
            viewNavRequestToken = requestToken;
            try {
                await releasePreviewVideoPlayers(contentArticle);
                if (requestToken !== viewNavRequestToken) {
                    return;
                }
                const data = await requestJson(
                    appendSharedQuery(previewApiUrl),
                    buildPostOptions({ path: entry.path })
                );
                if (requestToken !== viewNavRequestToken) {
                    return;
                }
                const newHtml = data.html || "";
                const newClass = data.render_class || "";

                if (requestToken !== viewNavRequestToken) {
                    return;
                }

                contentArticle.className = newClass;
                contentArticle.innerHTML = newHtml;

                renderHandriveMermaidDiagrams(contentArticle).catch(alertError);
                hydrateMediaAudioElements(contentArticle);
                bindHandrivePdfFrameLoading(contentArticle);
                await initializePreviewVideoPlayers(contentArticle);

                viewImageZoom = 1;
                syncViewImageZoom();

                currentDocPath = entry.path;
                currentDocSlugPath = entry.slug_path || entry.path;

                const fileName = entry.name || "";
                const titleEl = document.querySelector(".handrive-toolbar-left .handrive-title");
                if (titleEl) titleEl.textContent = fileName;
                const pathCurrentEl = document.querySelector(".handrive-toolbar-left .ui-path-current");
                if (pathCurrentEl) pathCurrentEl.textContent = fileName;
                document.title = fileName;

                const newUrl = buildViewUrl(handriveBaseUrl, currentDocSlugPath);
                window.history.pushState({ handriveViewPath: currentDocPath }, "", newUrl);

                updateViewNavButtons(viewNavSiblings, currentDocPath);
            } catch (error) {
                alertError(error);
            }
        }

        if (viewNavPrevBtn) {
            bindViewNavButtonEffects(viewNavPrevBtn);
            viewNavPrevBtn.addEventListener("click", function () {
                navigateViewToEntry(viewNavPrevBtn._navTarget);
            });
        }
        if (viewNavNextBtn) {
            bindViewNavButtonEffects(viewNavNextBtn);
            viewNavNextBtn.addEventListener("click", function () {
                navigateViewToEntry(viewNavNextBtn._navTarget);
            });
        }

        if (contentArticle && contentArticle.classList.contains("handrive-js")) {
            applyHandriveCodeHighlighting(contentArticle, "handrive-js");
        } else if (contentArticle && contentArticle.classList.contains("handrive-css")) {
            applyHandriveCodeHighlighting(contentArticle, "handrive-css");
        } else if (contentArticle && contentArticle.classList.contains("handrive-json")) {
            applyHandriveCodeHighlighting(contentArticle, "handrive-json");
        } else if (contentArticle && contentArticle.classList.contains("handrive-py")) {
            applyHandriveCodeHighlighting(contentArticle, "handrive-py");
        } else if (contentArticle && contentArticle.classList.contains("ui-markdown")) {
            applyHandriveCodeHighlighting(contentArticle, "ui-markdown");
        }

        hydrateMediaAudioElements(contentArticle);
        if (window.HandriveSpreadsheetEditor && typeof window.HandriveSpreadsheetEditor.hydratePreviews === "function") {
            window.HandriveSpreadsheetEditor.hydratePreviews(contentArticle);
        }
        renderHandriveMermaidDiagrams(contentArticle).catch(alertError);
        bindHandrivePdfFrameLoading(contentArticle);
        initializePreviewVideoPlayers(contentArticle).catch(alertError);

        viewImageZoom = 1;
        syncViewImageZoom();

        loadViewNavSiblings();

        if (viewZoomOutButton) {
            viewZoomOutButton.addEventListener("click", function () {
                setViewImageZoom(viewImageZoom - 0.25);
            });
        }

        if (viewZoomInButton) {
            viewZoomInButton.addEventListener("click", function () {
                setViewImageZoom(viewImageZoom + 0.25);
            });
        }

        if (contentArticle) {
            contentArticle.addEventListener("click", openClickedImagePictureInPicture);
        }

        const isTextArticle = contentArticle && !contentArticle.classList.contains("handrive-media");
        if (isTextArticle) {
            let viewTextFontSize = 16;
            contentArticle.addEventListener("wheel", function (event) {
                if (!event.ctrlKey && !event.metaKey) return;
                event.preventDefault();
                const delta = event.deltaY < 0 ? 2 : -2;
                viewTextFontSize = Math.max(8, Math.min(40, viewTextFontSize + delta));
                contentArticle.style.setProperty("--handrive-text-font-size", viewTextFontSize + "px");
            }, { passive: false });
        } else if (contentArticle && contentArticle.classList.contains("handrive-media")) {
            contentArticle.addEventListener("wheel", function (event) {
                if (!event.ctrlKey && !event.metaKey) return;
                event.preventDefault();
                const delta = event.deltaY < 0 ? 0.15 : -0.15;
                setViewImageZoom(viewImageZoom + delta);
            }, { passive: false });
        }

        if (urlShareButton && urlShareApiUrl && currentDocPath) {
            urlShareButton.addEventListener("click", function () {
                const initialShareUrl = root.dataset.docShareUrl || "";
                const shouldShowDownloadUrl = isSimpleUrlShareFilePath(currentDocPath);
                urlShareModal.open({
                    isUrlOnly: docIsUrlOnly,
                    shareUrl: initialShareUrl,
                    downloadUrl: shouldShowDownloadUrl ? toAbsoluteUrl(root.dataset.docShareDownloadUrl || "") : "",
                    allowedUsers: initialDocShareAllowedUsers,
                    readOnly: root.dataset.docShareIsInherited === "1",
                    onToggle: async function (enabled, allowedUsernames) {
                        const data = await requestJson(
                            appendSharedQuery(urlShareApiUrl),
                            buildPostOptions({
                                path: currentDocPath,
                                enabled: enabled,
                                allowed_usernames: allowedUsernames || [],
                            })
                        );
                        if (!enabled) {
                            window.location.reload();
                        }
                        return {
                            isUrlOnly: Boolean(data.is_url_only),
                            shareUrl: data.share_url || "",
                            downloadUrl: shouldShowDownloadUrl ? toAbsoluteUrl(data.share_download_url || "") : "",
                            allowedUsers: data.share_allowed_users || [],
                        };
                    },
                });
            });
        }

        if (printButton && contentArticle) {
            printButton.addEventListener("click", function () {
                const titleElement = document.querySelector(".handrive-toolbar-left .handrive-title");
                const downloadLink = document.querySelector(".handrive-toolbar-actions a[href*='/handrive/api/download']");
                const printPath = currentDocPath || sharedRootPath;
                printRenderedHandriveFile(contentArticle, {
                    title: titleElement ? titleElement.textContent : document.title,
                    officePdfUrl: contentArticle.classList.contains("handrive-office") && isHandriveOfficePdfPrintPath(printPath)
                        ? buildHandrivePdfPreviewUrl(pdfPreviewApiUrl, printPath)
                        : "",
                    sourceUrl: downloadLink ? downloadLink.href : "",
                });
            });
        }

        if (!deleteButton) {
            return;
        }

        deleteButton.addEventListener("click", async function () {
            const confirmed = await requestConfirmDialog({
                title: t("delete_button", "삭제"),
                message: t("js_confirm_delete_doc", "이 문서를 삭제할까요?"),
                cancelText: t("cancel", "취소"),
                confirmText: t("delete_button", "삭제")
            });
            if (!confirmed) {
                return;
            }

            try {
                await requestJson(deleteApiUrl, buildPostOptions({ path: currentDocPath }));
                window.location.href = buildListUrl(handriveBaseUrl, parentDir, handriveRootUrl);
            } catch (error) {
                alertError(error);
            }
        });
    }

    function initializeWritePage() {
        const handriveBaseUrl = root.dataset.handriveBaseUrl || "/handrive";
        const handriveRootUrl = root.dataset.handriveRootUrl || handriveBaseUrl;
        const saveApiUrl = root.dataset.saveApiUrl;
        const renameApiUrl = root.dataset.renameApiUrl || "";
        const previewApiUrl = root.dataset.previewApiUrl;
        const listApiUrl = root.dataset.listApiUrl || "";
        const downloadApiUrl = root.dataset.downloadApiUrl || "";
        const imageEditorSaveUrl = root.dataset.imageEditorSaveUrl || "";
        const imageEditorRemoveBackgroundUrl = root.dataset.imageEditorRemoveBackgroundUrl || "";
        const audioEditorSaveUrl = root.dataset.audioEditorSaveUrl || "";
        const videoEditorSaveUrl = root.dataset.videoEditorSaveUrl || "";
        const pdfEditorMetaUrl = root.dataset.pdfEditorMetaUrl || "";
        const pdfEditorPageUrl = root.dataset.pdfEditorPageUrl || "";
        const pdfEditorSaveUrl = root.dataset.pdfEditorSaveUrl || "";
        const imageEditorScriptUrl = root.dataset.imageEditorScriptUrl || "";
        const videoEditorScriptUrl = root.dataset.videoEditorScriptUrl || "";
        const audioEditorScriptUrl = root.dataset.audioEditorScriptUrl || "";
        const pdfEditorScriptUrl = root.dataset.pdfEditorScriptUrl || "";
        const markdownImageUploadApiUrl = root.dataset.markdownImageUploadApiUrl || "";
        const markdownImageCleanupApiUrl = root.dataset.markdownImageCleanupApiUrl || "";
        const mkdirApiUrl = root.dataset.mkdirApiUrl;
        const originalPath = root.dataset.originalPath || "";
        const initialDir = root.dataset.initialDir || "";
        const writeEditorKind = String(root.dataset.writeEditorKind || "text").trim().toLowerCase();
        const isMediaWriteEditor = writeEditorKind === "image" || writeEditorKind === "audio" || writeEditorKind === "video" || writeEditorKind === "pdf";
        const isPublicWriteDirectSave = root.dataset.publicWriteDirectSave === "1";
        const writeRequiresCommitMessage = root.dataset.writeRequiresCommitMessage === "1";

        const filenameInput = document.getElementById("handrive-filename-input");
        const saveFilenameInput = document.getElementById("handrive-save-filename-input");
        const saveExtensionSelect = document.getElementById("handrive-save-extension-select");
        const contentInput = document.getElementById("handrive-content-input");
        const editorSurface = document.getElementById("handrive-editor-surface");
        const imageEditorSurface = document.getElementById("handrive-image-editor-surface");
        const videoEditorSurface = document.getElementById("handrive-video-editor-surface");
        const audioEditorSurface = document.getElementById("handrive-audio-editor-surface");
        const pdfEditorSurface = document.getElementById("handrive-pdf-editor-surface");
        const editorHighlight = document.getElementById("handrive-editor-highlight");
        const editorHighlightCode = document.getElementById("handrive-editor-highlight-code");
        const editorSuggest = document.getElementById("handrive-editor-suggest");
        const editorSuggestLabel = document.getElementById("handrive-editor-suggest-label");
        const markdownHelpButton = document.getElementById("ui-markdown-help-btn");
        const markdownHelpModal = document.getElementById("ui-markdown-help-modal");
        const markdownHelpBackdrop = document.getElementById("ui-markdown-help-backdrop");
        const markdownPreviewButton = document.getElementById("ui-markdown-preview-btn");
        const markdownPreviewModal = document.getElementById("ui-markdown-preview-modal");
        const markdownPreviewBackdrop = document.getElementById("ui-markdown-preview-backdrop");
        const markdownPreviewContent = document.getElementById("ui-markdown-preview-content");
        const cancelButton = document.getElementById("handrive-cancel-btn");
        const saveButton = document.getElementById("handrive-save-btn");
        const createFolderButton = document.getElementById("handrive-create-folder-btn");
        const saveModal = document.getElementById("handrive-save-modal");
        const saveModalDialog = saveModal ? saveModal.querySelector(".handrive-drive-modal-dialog") : null;
        const saveModalBackdrop = document.getElementById("handrive-save-modal-backdrop");
        const saveLoadingOverlay = document.getElementById("handrive-save-loading");
        const saveCloseButton = document.getElementById("handrive-save-close-btn");
        const saveCancelButton = document.getElementById("handrive-save-cancel-btn");
        const saveConfirmButton = document.getElementById("handrive-save-confirm-btn");
        const saveBreadcrumb = document.getElementById("handrive-save-breadcrumb");
        const saveFolderList = document.getElementById("handrive-save-folder-list");
        const folderModal = document.getElementById("handrive-folder-modal");
        const folderModalBackdrop = document.getElementById("handrive-folder-modal-backdrop");
        const folderNameInput = document.getElementById("handrive-folder-name-input");
        const folderTargetPath = document.getElementById("handrive-folder-target-path");
        const folderCancelButton = document.getElementById("handrive-folder-cancel-btn");
        const folderCreateButton = document.getElementById("handrive-folder-create-btn");
        const unsavedModal = document.getElementById("handrive-unsaved-modal");
        const unsavedModalBackdrop = document.getElementById("handrive-unsaved-modal-backdrop");
        const unsavedMessage = document.getElementById("handrive-unsaved-message");
        const unsavedCloseButton = document.getElementById("handrive-unsaved-close-btn");
        const unsavedCancelButton = document.getElementById("handrive-unsaved-cancel-btn");
        const unsavedSaveButton = document.getElementById("handrive-unsaved-save-btn");
        const directoryOptions = document.getElementById("handrive-directory-options");
        const markdownSnippetMenu = document.getElementById("ui-markdown-snippet-menu");
        const markdownSnippetButtons = Array.from(
            document.querySelectorAll("button[data-editor-snippet]")
        );
        const DOCS_CUSTOM_EXTENSION_OPTION_VALUE = "__custom__";

        function getButtonActionLabel(button) {
            if (!button) return "";
            return String(button.getAttribute("aria-label") || button.getAttribute("title") || button.textContent || "").trim();
        }

        function setButtonActionLabel(button, label) {
            if (!button || !label) return;
            button.setAttribute("aria-label", label);
            button.setAttribute("title", label);
            if (!button.classList.contains("handrive-icon-btn")) {
                button.textContent = label;
            }
        }

        async function promptWriteCommitMessage(targetPath) {
            return requestCommitMessageDialog({
                targetPath: targetPath || "",
                targetText: getHandrivePathLabel(targetPath || ""),
            });
        }
        const extensionPresetValues = saveExtensionSelect
            ? Array.from(saveExtensionSelect.options)
                .map(function (option) {
                    return String(option.value || "").trim().toLowerCase();
                })
                .filter(function (value) {
                    return Boolean(value) && value !== DOCS_CUSTOM_EXTENSION_OPTION_VALUE;
                })
            : [".md"];
        const extensionPresetSet = new Set(extensionPresetValues);
        const scopedHomeDir = normalizePath(root.dataset.scopedHomeDir || "", true);
        const isSuperuser = root.dataset.isSuperuser === "1";
        const handriveRootLabel = (root.dataset.handriveRootLabel || "HanDrive").trim() || "HanDrive";
        const effectiveRootLabel = handriveRootLabel;

        const rawDirectories = getJsonScriptData("handrive-directory-data", []);
        const directories = [];
        const directorySet = new Set();
        const DOCS_DEFAULT_EXTENSION = ".md";
        let customExtensionValue = DOCS_DEFAULT_EXTENSION;
        // write 페이지 상태는 파일명/디렉터리 선택과 미저장 변경 추적에 집중한다.
        const state = {
            browserDir: "",
            selectedDir: "",
            selectedOverwritePath: "",
            directoryCache: new Map(),
            directoryMetaCache: new Map(),
            directoryLoadPromises: new Map(),
            entryByPath: new Map(),
            expandedSaveDirs: new Set(),
            browserRenderToken: 0,
            isSaving: false,
        };
        let contentHeightRafId = null;
        let savedFilenameValue = filenameInput ? filenameInput.value : "";
        let savedContentValue = contentInput ? contentInput.value : "";
        let bypassUnsavedBeforeUnload = false;
        let pendingSaveThenLeaveAction = null;
        let resolveUnsavedChoice = null;
        let unsavedModalOpen = false;
        let lastUnsavedFocusedElement = null;
        let activeEditorSuggestions = [];
        let activeEditorSuggestionIndex = -1;
        let writeSuggestEventsBound = false;
        let writeMarkdownUploadedImagePaths = [];
        let writeUndoStack = [];
        let writeRedoStack = [];
        let writeUndoApplying = false;
        const WRITE_UNDO_STACK_LIMIT = 200;
        // 자동완성 단어 리스트는 전역 단일 맵(window.__handriveEditorCompletionMap)만 사용
        const editorCompletionMap = window.__handriveEditorCompletionMap || {};
        const writeMarkdownImageInput = createMarkdownImageInputHandler({
            textarea: contentInput,
            uploadApiUrl: markdownImageUploadApiUrl,
            isEnabled: function () {
                const originalExtension = getPathFileExtension(originalPath);
                if (originalExtension) {
                    return originalExtension === DOCS_DEFAULT_EXTENSION;
                }
                const rawName = filenameInput ? String(filenameInput.value || "").trim() : "";
                const match = rawName.match(/\.[A-Za-z0-9]+$/);
                return !match || match[0].toLowerCase() === DOCS_DEFAULT_EXTENSION;
            },
            getMarkdownPath: function () {
                return originalPath || "";
            },
            getMarkdownName: function () {
                return filenameInput ? filenameInput.value : "";
            },
            getTargetDir: function () {
                return normalizePath(initialDir, true);
            },
            onAfterInsert: function (data) {
                if (data && data.path) {
                    writeMarkdownUploadedImagePaths.push(data.path);
                }
                renderWriteEditorHighlight();
            }
        });

        function getWriteEditorSnapshot() {
            if (!contentInput) {
                return null;
            }
            return {
                value: contentInput.value || "",
                selectionStart: contentInput.selectionStart || 0,
                selectionEnd: contentInput.selectionEnd || 0,
                scrollTop: contentInput.scrollTop || 0,
                scrollLeft: contentInput.scrollLeft || 0,
            };
        }

        function clampSelectionIndex(value, maxLength) {
            return Math.max(0, Math.min(maxLength, Number(value) || 0));
        }

        function applyWriteEditorSnapshot(snapshot) {
            if (!contentInput || !snapshot) {
                return;
            }
            writeUndoApplying = true;
            contentInput.value = snapshot.value || "";
            const maxLength = contentInput.value.length;
            const selectionStart = clampSelectionIndex(snapshot.selectionStart, maxLength);
            const selectionEnd = clampSelectionIndex(snapshot.selectionEnd, maxLength);
            contentInput.focus();
            contentInput.setSelectionRange(selectionStart, selectionEnd);
            contentInput.scrollTop = snapshot.scrollTop || 0;
            contentInput.scrollLeft = snapshot.scrollLeft || 0;
            contentInput.dispatchEvent(new Event("input", { bubbles: true }));
            writeUndoApplying = false;
        }

        function recordWriteEditorSnapshot() {
            if (!contentInput || writeUndoApplying) {
                return;
            }
            const snapshot = getWriteEditorSnapshot();
            if (!snapshot) {
                return;
            }
            const latest = writeUndoStack.length ? writeUndoStack[writeUndoStack.length - 1] : null;
            if (latest && latest.value === snapshot.value) {
                latest.selectionStart = snapshot.selectionStart;
                latest.selectionEnd = snapshot.selectionEnd;
                latest.scrollTop = snapshot.scrollTop;
                latest.scrollLeft = snapshot.scrollLeft;
                return;
            }
            writeUndoStack.push(snapshot);
            if (writeUndoStack.length > WRITE_UNDO_STACK_LIMIT) {
                writeUndoStack.shift();
            }
            writeRedoStack = [];
        }

        function syncLatestWriteEditorSnapshotSelection() {
            if (!contentInput || !writeUndoStack.length) {
                return;
            }
            const snapshot = getWriteEditorSnapshot();
            const latest = writeUndoStack[writeUndoStack.length - 1];
            if (!snapshot || latest.value !== snapshot.value) {
                return;
            }
            latest.selectionStart = snapshot.selectionStart;
            latest.selectionEnd = snapshot.selectionEnd;
            latest.scrollTop = snapshot.scrollTop;
            latest.scrollLeft = snapshot.scrollLeft;
        }

        function undoWriteEditorChange() {
            if (writeUndoStack.length <= 1) {
                return false;
            }
            const current = writeUndoStack.pop();
            writeRedoStack.push(current);
            applyWriteEditorSnapshot(writeUndoStack[writeUndoStack.length - 1]);
            return true;
        }

        function redoWriteEditorChange() {
            if (!writeRedoStack.length) {
                return false;
            }
            const next = writeRedoStack.pop();
            writeUndoStack.push(next);
            applyWriteEditorSnapshot(next);
            return true;
        }

        if (contentInput) {
            const initialSnapshot = getWriteEditorSnapshot();
            writeUndoStack = initialSnapshot ? [initialSnapshot] : [];
        }

        function markCurrentAsSaved() {
            savedFilenameValue = filenameInput ? filenameInput.value : "";
            savedContentValue = contentInput ? contentInput.value : "";
        }

        function getActiveWriteMediaEditor() {
            if (writeEditorKind === "image" && window.HandriveImageEditor) {
                return window.HandriveImageEditor;
            }
            if (writeEditorKind === "video" && window.HandriveVideoEditor) {
                return window.HandriveVideoEditor;
            }
            if (writeEditorKind === "audio" && window.HandriveAudioEditor) {
                return window.HandriveAudioEditor;
            }
            if (writeEditorKind === "pdf" && window.HandrivePdfEditor) {
                return window.HandrivePdfEditor;
            }
            return null;
        }

        function getActiveWriteMediaSaveUrl() {
            if (writeEditorKind === "image") return imageEditorSaveUrl;
            if (writeEditorKind === "video") return videoEditorSaveUrl;
            if (writeEditorKind === "audio") return audioEditorSaveUrl;
            if (writeEditorKind === "pdf") return pdfEditorSaveUrl;
            return "";
        }

        function ensureWriteMediaEditorScript(kind) {
            const normalizedKind = String(kind || "").trim().toLowerCase();
            const scriptUrl = normalizedKind === "image"
                ? imageEditorScriptUrl
                : normalizedKind === "video"
                    ? videoEditorScriptUrl
                    : normalizedKind === "audio"
                        ? audioEditorScriptUrl
                        : normalizedKind === "pdf"
                            ? pdfEditorScriptUrl
                            : "";
            if (normalizedKind === "video") {
                return loadVideoPlayerStack().then(function () {
                    return loadLazyScriptOnce(scriptUrl, getMediaEditorGlobalName(normalizedKind));
                });
            }
            return loadLazyScriptOnce(scriptUrl, getMediaEditorGlobalName(normalizedKind));
        }

        function hasUnsavedMediaWriteChanges() {
            const editor = getActiveWriteMediaEditor();
            return Boolean(editor && typeof editor.getIsDirty === "function" && editor.getIsDirty());
        }

        function hasUnsavedWriteChanges() {
            if (isMediaWriteEditor) {
                const filenameChanged = filenameInput
                    ? filenameInput.value !== savedFilenameValue
                    : false;
                return hasUnsavedMediaWriteChanges() || filenameChanged;
            }
            const currentFilename = filenameInput ? filenameInput.value : "";
            const currentContent = contentInput ? contentInput.value : "";
            return currentFilename !== savedFilenameValue || currentContent !== savedContentValue;
        }

        async function cleanupWriteMarkdownUploadedImages() {
            if (!markdownImageCleanupApiUrl || !writeMarkdownUploadedImagePaths.length) {
                return;
            }
            const imagePaths = Array.from(new Set(writeMarkdownUploadedImagePaths));
            writeMarkdownUploadedImagePaths = [];
            await requestJson(
                markdownImageCleanupApiUrl,
                buildPostOptions({
                    markdown_path: originalPath || "",
                    target_dir: normalizePath(initialDir, true),
                    image_paths: imagePaths,
                })
            );
        }

        function runWithBeforeUnloadBypass(action) {
            if (typeof action !== "function") {
                return;
            }
            bypassUnsavedBeforeUnload = true;
            action();
            window.setTimeout(function () {
                bypassUnsavedBeforeUnload = false;
            }, 1200);
        }

        function buildWriteDownloadUrl(pathValue) {
            if (!downloadApiUrl) {
                return "";
            }
            const query = new URLSearchParams({ path: pathValue || "" }).toString();
            return appendSharedQuery(query ? downloadApiUrl + "?" + query : downloadApiUrl);
        }

        function buildWritePdfEditorApiUrl(baseUrl, pathValue, extraParams) {
            if (!baseUrl) {
                return "";
            }
            const params = new URLSearchParams({ path: pathValue || "" });
            Object.keys(extraParams || {}).forEach(function (key) {
                params.set(key, extraParams[key]);
            });
            return appendSharedQuery(baseUrl + "?" + params.toString());
        }

        function buildWriteScopedHomeDownloadUrl(pathValue) {
            return appendQueryParam(buildWriteDownloadUrl(pathValue), "scope_home", "1");
        }

        function getWriteMediaFilenameValue() {
            return String(filenameInput ? filenameInput.value || "" : "").trim();
        }

        function getWriteMediaOriginalFilename() {
            return String(originalPath || "").split("/").pop() || "";
        }

        function getWriteMediaEntry() {
            if (!originalPath) {
                return null;
            }
            return {
                path: originalPath,
                slug_path: originalPath,
                name: originalPath.split("/").pop() || originalPath,
                type: "file",
            };
        }

        async function showWriteMediaSurface() {
            if (!isMediaWriteEditor) {
                if (imageEditorSurface) imageEditorSurface.hidden = true;
                if (videoEditorSurface) videoEditorSurface.hidden = true;
                if (audioEditorSurface) audioEditorSurface.hidden = true;
                if (pdfEditorSurface) pdfEditorSurface.hidden = true;
                return;
            }
            if (editorSurface) editorSurface.hidden = true;
            if (contentInput) contentInput.disabled = true;
            if (filenameInput) {
                filenameInput.readOnly = false;
                filenameInput.removeAttribute("aria-readonly");
            }
            if (imageEditorSurface) imageEditorSurface.hidden = writeEditorKind !== "image";
            if (videoEditorSurface) videoEditorSurface.hidden = writeEditorKind !== "video";
            if (audioEditorSurface) audioEditorSurface.hidden = writeEditorKind !== "audio";
            if (pdfEditorSurface) pdfEditorSurface.hidden = writeEditorKind !== "pdf";

            const entry = getWriteMediaEntry();
            const mediaUrl = buildWriteDownloadUrl(originalPath);
            const dirtyHandler = function (dirty) {
                if (saveButton) {
                    saveButton.classList.toggle("is-dirty", Boolean(dirty));
                }
            };
            if (saveButton) saveButton.disabled = true;
            try {
                await ensureWriteMediaEditorScript(writeEditorKind);
            } catch (error) {
                if (saveButton) saveButton.disabled = false;
                throw error;
            }
            if (writeEditorKind === "image" && window.HandriveImageEditor && entry) {
                window.HandriveImageEditor.init({
                    entry: entry,
                    imageServeUrl: mediaUrl,
                    backgroundRemoveUrl: imageEditorRemoveBackgroundUrl,
                    onDirtyChange: dirtyHandler,
                });
            } else if (writeEditorKind === "video" && window.HandriveVideoEditor && entry) {
                window.HandriveVideoEditor.init({
                    entry: entry,
                    videoServeUrl: mediaUrl,
                    buildDownloadUrl: buildWriteScopedHomeDownloadUrl,
                    listApiUrl: appendQueryParam(appendSharedQuery(listApiUrl), "scope_home", "1"),
                    scopedHomeDir: scopedHomeDir,
                    onDirtyChange: dirtyHandler,
                });
            } else if (writeEditorKind === "audio" && window.HandriveAudioEditor && entry) {
                window.HandriveAudioEditor.init({
                    entry: entry,
                    audioServeUrl: mediaUrl,
                    listApiUrl: appendQueryParam(appendSharedQuery(listApiUrl), "scope_home", "1"),
                    buildDownloadUrl: buildWriteScopedHomeDownloadUrl,
                    scopedHomeDir: scopedHomeDir,
                    onDirtyChange: dirtyHandler,
                });
            } else if (writeEditorKind === "pdf" && window.HandrivePdfEditor && entry) {
                await window.HandrivePdfEditor.init({
                    entry: entry,
                    metaUrl: buildWritePdfEditorApiUrl(pdfEditorMetaUrl, originalPath),
                    pageUrlBuilder: function (pageIndex, scale) {
                        return buildWritePdfEditorApiUrl(pdfEditorPageUrl, originalPath, {
                            page: String(pageIndex),
                            scale: String(scale || 2),
                        });
                    },
                    onDirtyChange: dirtyHandler,
                });
            } else if (writeEditorKind === "pdf") {
                throw new Error(t("pdf_editor_load_error", "PDF 편집기를 불러오지 못했습니다."));
            }
            if (saveButton) saveButton.disabled = false;
            scheduleWriteEditorHorizontalScrollReset();
        }

        function setUnsavedModalOpen(opened) {
            if (!unsavedModal) {
                return;
            }
            unsavedModal.hidden = !opened;
            unsavedModalOpen = opened;
            syncModalBodyState();
            if (!opened && lastUnsavedFocusedElement && typeof lastUnsavedFocusedElement.focus === "function") {
                lastUnsavedFocusedElement.focus();
            }
            if (!opened) {
                lastUnsavedFocusedElement = null;
            }
        }

        function closeUnsavedModal(choice) {
            if (!unsavedModalOpen) {
                return;
            }
            setUnsavedModalOpen(false);
            if (resolveUnsavedChoice) {
                resolveUnsavedChoice(choice || "cancel");
                resolveUnsavedChoice = null;
            }
        }

        function requestUnsavedLeaveDecision() {
            if (
                !unsavedModal ||
                !unsavedModalBackdrop ||
                !unsavedCloseButton ||
                !unsavedCancelButton ||
                !unsavedSaveButton
            ) {
                return requestConfirmDialog({
                    title: t("unsaved_changes_title", "수정 사항이 있습니다"),
                    message: t("unsaved_changes_message", "저장되지 않은 변경 사항이 있습니다. 이동 전에 저장할까요?"),
                    cancelText: t("cancel", "취소"),
                    confirmText: t("unsaved_changes_leave_button", "확인")
                }).then(function (confirmed) {
                    return confirmed ? "leave" : "cancel";
                });
            }

            if (resolveUnsavedChoice) {
                resolveUnsavedChoice("cancel");
                resolveUnsavedChoice = null;
            }

            if (unsavedMessage) {
                unsavedMessage.textContent = t(
                    "unsaved_changes_message",
                    "저장되지 않은 변경 사항이 있습니다. 이동 전에 저장할까요?"
                );
            }

            lastUnsavedFocusedElement = document.activeElement;
            setUnsavedModalOpen(true);
            unsavedCancelButton.focus();

            return new Promise(function (resolve) {
                resolveUnsavedChoice = resolve;
            });
        }

        function submitSaveThenLeave() {
            if (!pendingSaveThenLeaveAction) {
                return;
            }
            if (isMediaWriteEditor) {
                submitMediaEditorSave({
                    redirectOnSuccess: false,
                    onSuccess: function () {
                        const nextAction = pendingSaveThenLeaveAction;
                        pendingSaveThenLeaveAction = null;
                        if (typeof nextAction === "function") {
                            runWithBeforeUnloadBypass(nextAction);
                        }
                    }
                });
                return;
            }

            submitSave({
                redirectOnSuccess: false,
                onSuccess: function () {
                    const nextAction = pendingSaveThenLeaveAction;
                    pendingSaveThenLeaveAction = null;
                    if (typeof nextAction === "function") {
                        runWithBeforeUnloadBypass(nextAction);
                    }
                }
            });
        }

        function attemptLeaveWithUnsavedGuard(action) {
            if (typeof action !== "function") {
                return;
            }
            if (!hasUnsavedWriteChanges()) {
                runWithBeforeUnloadBypass(action);
                return;
            }

            requestUnsavedLeaveDecision().then(function (choice) {
                if (choice === "leave") {
                    runWithBeforeUnloadBypass(action);
                    return;
                }
                if (choice === "save") {
                    pendingSaveThenLeaveAction = action;
                    if (isMediaWriteEditor) {
                        submitSaveThenLeave();
                        return;
                    }
                    if (isPublicWriteDirectSave || !saveModal) {
                        submitSaveThenLeave();
                        return;
                    }
                    setSaveModalOpen(true);
                }
            });
        }

        function closeMarkdownSnippetMenu() {
            if (!markdownSnippetMenu) {
                return;
            }
            markdownSnippetMenu.hidden = true;
        }

        function openMarkdownSnippetMenu(clientX, clientY) {
            if (!markdownSnippetMenu) {
                return;
            }

            markdownSnippetMenu.hidden = false;
            markdownSnippetMenu.style.left = "0px";
            markdownSnippetMenu.style.top = "0px";

            const rect = markdownSnippetMenu.getBoundingClientRect();
            const viewportPadding = 8;
            const maxLeft = Math.max(viewportPadding, window.innerWidth - rect.width - viewportPadding);
            const maxTop = Math.max(viewportPadding, window.innerHeight - rect.height - viewportPadding);
            const left = Math.min(Math.max(viewportPadding, clientX), maxLeft);
            const top = Math.min(Math.max(viewportPadding, clientY), maxTop);

            markdownSnippetMenu.style.left = left + "px";
            markdownSnippetMenu.style.top = top + "px";
        }

        function getCurrentEditorExtension() {
            const extension = resolveWriteFilenameExtension();
            return extension || DOCS_DEFAULT_EXTENSION;
        }

        function syncSnippetMenuItemsByExtension(extension) {
            if (!markdownSnippetMenu) {
                return 0;
            }
            const currentExtension = String(extension || "").trim().toLowerCase();
            let visibleCount = 0;
            markdownSnippetButtons.forEach(function (button) {
                const rawExtensions = String(button.getAttribute("data-editor-extensions") || "").trim();
                if (!rawExtensions) {
                    button.hidden = false;
                    visibleCount += 1;
                    return;
                }
                const allowed = rawExtensions
                    .split(",")
                    .map(function (value) { return String(value || "").trim().toLowerCase(); })
                    .filter(Boolean);
                const visible = allowed.includes(currentExtension);
                button.hidden = !visible;
                if (visible) {
                    visibleCount += 1;
                }
            });
            return visibleCount;
        }

        function replaceTextareaSelection(insertText, selectionStartOffset, selectionEndOffset, replaceStartOffset, replaceEndOffset) {
            if (!contentInput) {
                return;
            }
            const valueLength = String(contentInput.value || "").length;
            const selectedStart = contentInput.selectionStart || 0;
            const selectedEnd = contentInput.selectionEnd || 0;
            const start = Number.isFinite(Number(replaceStartOffset))
                ? clampMarkdownIndex(contentInput.value, replaceStartOffset)
                : clampMarkdownIndex(contentInput.value, selectedStart);
            const end = Number.isFinite(Number(replaceEndOffset))
                ? clampMarkdownIndex(contentInput.value, replaceEndOffset)
                : clampMarkdownIndex(contentInput.value, selectedEnd);
            const replaceStart = Math.min(start, end, valueLength);
            const replaceEnd = Math.max(start, end);
            contentInput.focus();
            contentInput.setSelectionRange(replaceStart, replaceEnd);
            contentInput.setRangeText(insertText, replaceStart, replaceEnd, "end");

            const nextStart = replaceStart + (selectionStartOffset || 0);
            const nextEnd = replaceStart + (selectionEndOffset || insertText.length);
            contentInput.setSelectionRange(nextStart, nextEnd);
            contentInput.dispatchEvent(new Event("input", { bubbles: true }));
            syncLatestWriteEditorSnapshotSelection();
        }

        function buildWrappedSnippet(prefix, suffix, placeholder) {
            const selection = getMarkdownSnippetSelection(contentInput);
            const selected = selection.body;
            const body = selected || placeholder;
            const text = prefix + body + suffix;

            if (selected) {
                return {
                    text: text,
                    selectStart: text.length,
                    selectEnd: text.length,
                    replaceStart: selection.replaceStart,
                    replaceEnd: selection.replaceEnd,
                };
            }

            return {
                text: text,
                selectStart: prefix.length,
                selectEnd: prefix.length + body.length,
                replaceStart: selection.replaceStart,
                replaceEnd: selection.replaceEnd,
            };
        }

        function buildPrefixedLinesSnippet(prefix, placeholder) {
            const selection = getMarkdownSnippetSelection(contentInput);
            const selected = selection.body;
            if (!selected) {
                const body = prefix + placeholder;
                return {
                    text: body,
                    selectStart: prefix.length,
                    selectEnd: body.length,
                    replaceStart: selection.replaceStart,
                    replaceEnd: selection.replaceEnd,
                };
            }

            const lines = selected.split(/\r?\n/);
            const transformed = lines.map(function (line) {
                if (!line.trim()) {
                    return line;
                }
                return prefix + line;
            }).join("\n");
            return {
                text: transformed,
                selectStart: transformed.length,
                selectEnd: transformed.length,
                replaceStart: selection.replaceStart,
                replaceEnd: selection.replaceEnd,
            };
        }

        function buildTableSnippet() {
            const selection = getMarkdownSnippetSelection(contentInput);
            const delimitedTable = buildMarkdownTableFromDelimitedText(selection.body);
            if (delimitedTable) {
                return {
                    text: delimitedTable,
                    selectStart: delimitedTable.length,
                    selectEnd: delimitedTable.length,
                    replaceStart: selection.replaceStart,
                    replaceEnd: selection.replaceEnd,
                };
            }

            const col1 = t("markdown_placeholder_table_col1", "Column 1");
            const col2 = t("markdown_placeholder_table_col2", "Column 2");
            const table = [
                "| " + col1 + " | " + col2 + " |",
                "| --- | --- |",
                "| Value 1 | Value 2 |",
            ].join("\n");
            return {
                text: table,
                selectStart: 2,
                selectEnd: 2 + col1.length,
                replaceStart: selection.replaceStart,
                replaceEnd: selection.replaceEnd,
            };
        }

        function buildNumberedLinesSnippet(placeholder) {
            const selection = getMarkdownSnippetSelection(contentInput);
            const selected = selection.body;
            if (!selected) {
                const body = "1. " + placeholder;
                return {
                    text: body,
                    selectStart: 3,
                    selectEnd: body.length,
                    replaceStart: selection.replaceStart,
                    replaceEnd: selection.replaceEnd,
                };
            }

            let order = 1;
            const transformed = selected
                .split(/\r?\n/)
                .map(function (line) {
                    if (!line.trim()) {
                        return line;
                    }
                    const row = order + ". " + line;
                    order += 1;
                    return row;
                })
                .join("\n");
            return {
                text: transformed,
                selectStart: transformed.length,
                selectEnd: transformed.length,
                replaceStart: selection.replaceStart,
                replaceEnd: selection.replaceEnd,
            };
        }

        function buildCodeBlockSnippet() {
            const selection = getMarkdownSnippetSelection(contentInput);
            const lang = t("markdown_placeholder_code_lang", "text");
            const body = selection.body || t("markdown_placeholder_code_body", "type your code");
            const text = "```" + lang + "\n" + body + "\n```";
            const bodyStart = ("```" + lang + "\n").length;
            if (selection.body) {
                return {
                    text: text,
                    selectStart: text.length,
                    selectEnd: text.length,
                    replaceStart: selection.replaceStart,
                    replaceEnd: selection.replaceEnd,
                };
            }
            return {
                text: text,
                selectStart: bodyStart,
                selectEnd: bodyStart + body.length,
                replaceStart: selection.replaceStart,
                replaceEnd: selection.replaceEnd,
            };
        }

        function insertMarkdownSnippet(snippetType) {
            if (!contentInput) {
                return;
            }

            let snippet = null;
            if (snippetType === "heading2") {
                snippet = buildWrappedSnippet("## ", "", t("markdown_placeholder_heading", "Heading"));
            } else if (snippetType === "heading3") {
                snippet = buildWrappedSnippet("### ", "", t("markdown_placeholder_heading", "Heading"));
            } else if (snippetType === "bold") {
                snippet = buildWrappedSnippet("**", "**", t("markdown_placeholder_bold", "bold text"));
            } else if (snippetType === "italic") {
                snippet = buildWrappedSnippet("*", "*", t("markdown_placeholder_italic", "italic text"));
            } else if (snippetType === "link") {
                snippet = buildWrappedSnippet("[", "](https://)", t("markdown_placeholder_link_text", "link text"));
            } else if (snippetType === "image") {
                snippet = buildWrappedSnippet("![", "](https://)", t("markdown_placeholder_image_alt", "image description"));
            } else if (snippetType === "code_inline") {
                snippet = buildWrappedSnippet("`", "`", t("markdown_placeholder_inline_code", "code"));
            } else if (snippetType === "code_block") {
                snippet = buildCodeBlockSnippet();
            } else if (snippetType === "list_bullet") {
                snippet = buildPrefixedLinesSnippet("- ", t("markdown_placeholder_list_item", "item"));
            } else if (snippetType === "list_numbered") {
                snippet = buildNumberedLinesSnippet(t("markdown_placeholder_list_item", "item"));
            } else if (snippetType === "list_check") {
                snippet = buildPrefixedLinesSnippet("- [ ] ", t("markdown_placeholder_list_item", "item"));
            } else if (snippetType === "quote") {
                snippet = buildPrefixedLinesSnippet("> ", t("markdown_placeholder_quote", "quote"));
            } else if (snippetType === "divider") {
                const selection = getMarkdownSnippetSelection(contentInput);
                snippet = {
                    text: "\n---\n",
                    selectStart: 5,
                    selectEnd: 5,
                    replaceStart: selection.replaceStart,
                    replaceEnd: selection.replaceEnd,
                };
            } else if (snippetType === "table") {
                snippet = buildTableSnippet();
            }

            if (!snippet) {
                return;
            }
            replaceTextareaSelection(snippet.text, snippet.selectStart, snippet.selectEnd, snippet.replaceStart, snippet.replaceEnd);
        }

        function insertLanguageSnippet(snippetType, extension) {
            if (!contentInput) {
                return false;
            }

            let snippet = null;
            if (extension === ".py") {
                if (snippetType === "py_def") {
                    const body = "def function_name(params):\n    pass";
                    snippet = { text: body, selectStart: 4, selectEnd: 17 };
                } else if (snippetType === "py_class") {
                    const body = "class ClassName:\n    def __init__(self):\n        pass";
                    snippet = { text: body, selectStart: 6, selectEnd: 15 };
                } else if (snippetType === "py_ifmain") {
                    snippet = { text: "if __name__ == \"__main__\":\n    main()", selectStart: 29, selectEnd: 33 };
                } else if (snippetType === "py_comment") {
                    snippet = buildPrefixedLinesSnippet("# ", t("markdown_placeholder_list_item", "item"));
                }
            } else if (extension === ".js") {
                if (snippetType === "js_function") {
                    const body = "function functionName(params) {\n    \n}";
                    snippet = { text: body, selectStart: 9, selectEnd: 21 };
                } else if (snippetType === "js_if") {
                    snippet = { text: "if (condition) {\n    \n}", selectStart: 4, selectEnd: 13 };
                } else if (snippetType === "js_comment") {
                    snippet = buildPrefixedLinesSnippet("// ", t("markdown_placeholder_list_item", "item"));
                }
            } else if (extension === ".css") {
                if (snippetType === "css_rule") {
                    snippet = { text: ".selector {\n    property: value;\n}", selectStart: 1, selectEnd: 9 };
                } else if (snippetType === "css_media") {
                    snippet = { text: "@media (max-width: 768px) {\n    \n}", selectStart: 8, selectEnd: 23 };
                } else if (snippetType === "css_var") {
                    snippet = { text: ":root {\n    --color-name: #000;\n}", selectStart: 14, selectEnd: 24 };
                }
            } else if (extension === ".json") {
                if (snippetType === "json_pair") {
                    snippet = { text: "\"key\": \"value\"", selectStart: 1, selectEnd: 4 };
                } else if (snippetType === "json_object") {
                    snippet = { text: "{\n  \"key\": \"value\"\n}", selectStart: 5, selectEnd: 8 };
                }
            } else if (extension === ".html") {
                if (snippetType === "html_basic") {
                    snippet = {
                        text: "<!doctype html>\n<html lang=\"ko\">\n<head>\n  <meta charset=\"utf-8\">\n  <title>File</title>\n</head>\n<body>\n  \n</body>\n</html>",
                        selectStart: 82,
                        selectEnd: 90
                    };
                } else if (snippetType === "html_div") {
                    snippet = { text: "<div class=\"box\">\n  \n</div>", selectStart: 12, selectEnd: 15 };
                }
            }

            if (!snippet) {
                return false;
            }
            replaceTextareaSelection(snippet.text, snippet.selectStart, snippet.selectEnd);
            return true;
        }

        function updateContentInputAutoHeight() {
            contentHeightRafId = null;
            if (!contentInput) {
                return;
            }

            const rootStyle = window.getComputedStyle(root);
            const rootBottomPadding = parseFloat(rootStyle.paddingBottom || "0");
            const paddingBottom = Number.isFinite(rootBottomPadding) ? rootBottomPadding : 0;
            const viewport = window.visualViewport;
            const viewportHeight = viewport ? viewport.height : window.innerHeight;
            const viewportOffsetTop = viewport ? viewport.offsetTop : 0;
            const inputRect = contentInput.getBoundingClientRect();
            const inputStyle = window.getComputedStyle(contentInput);
            const minHeightValue = parseFloat(inputStyle.minHeight || "0");
            const minHeight = Number.isFinite(minHeightValue) ? minHeightValue : 0;
            const availableHeight = viewportHeight + viewportOffsetTop - inputRect.top - paddingBottom;
            const targetHeight = Math.max(minHeight, Math.floor(availableHeight));

            contentInput.style.height = Math.max(0, targetHeight) + "px";
            if (editorSurface) {
                editorSurface.style.height = contentInput.style.height;
            }
            if (editorHighlight) {
                editorHighlight.style.height = contentInput.style.height;
            }
        }

        function scheduleContentInputAutoHeight() {
            if (contentHeightRafId !== null) {
                return;
            }
            contentHeightRafId = window.requestAnimationFrame(updateContentInputAutoHeight);
        }

        function upsertDirectory(pathValue) {
            const normalized = normalizePath(pathValue, true);
            if (directorySet.has(normalized)) {
                return normalized;
            }
            directorySet.add(normalized);
            directories.push(normalized);
            return normalized;
        }

        function hasDirectory(pathValue) {
            const normalized = normalizePath(pathValue, true);
            return directorySet.has(normalized);
        }

        function registerSaveEntry(entry) {
            if (!entry || !entry.path) {
                return;
            }
            const normalizedPath = normalizePath(entry.path, true);
            if (!normalizedPath) {
                return;
            }
            state.entryByPath.set(normalizedPath, entry);
            if (entry.type === "dir") {
                upsertDirectory(normalizedPath);
            }
        }

        function cacheSaveDirectoryData(pathValue, entries, directoryMeta) {
            const normalized = normalizePath(pathValue, true);
            const safeEntries = Array.isArray(entries) ? entries : [];
            upsertDirectory(normalized);
            state.directoryCache.set(normalized, safeEntries);
            if (directoryMeta && typeof directoryMeta === "object") {
                state.directoryMetaCache.set(normalized, directoryMeta);
            }
            safeEntries.forEach(registerSaveEntry);
        }

        function getCachedSaveEntries(pathValue) {
            const normalized = normalizePath(pathValue, true);
            return state.directoryCache.get(normalized) || null;
        }

        async function ensureSaveDirectoryLoaded(pathValue) {
            const normalized = normalizePath(pathValue, true);
            if (state.directoryCache.has(normalized) || !listApiUrl) {
                return getCachedSaveEntries(normalized) || [];
            }
            if (state.directoryLoadPromises.has(normalized)) {
                return state.directoryLoadPromises.get(normalized);
            }
            const loadPromise = requestJson(appendQueryParam(appendSharedQuery(listApiUrl), "path", normalized))
                .then(function (data) {
                    cacheSaveDirectoryData(
                        data && typeof data.path === "string" ? data.path : normalized,
                        data && Array.isArray(data.entries) ? data.entries : [],
                        data && data.directory_meta ? data.directory_meta : null
                    );
                    return getCachedSaveEntries(normalized) || [];
                })
                .finally(function () {
                    state.directoryLoadPromises.delete(normalized);
                });
            state.directoryLoadPromises.set(normalized, loadPromise);
            return loadPromise;
        }

        function invalidateSaveDirectory(pathValue) {
            const normalized = normalizePath(pathValue, true);
            state.directoryCache.delete(normalized);
            state.directoryMetaCache.delete(normalized);
            state.directoryLoadPromises.delete(normalized);
        }

        async function getWriteSaveTargetEntry(targetPath) {
            const normalizedTarget = normalizePath(targetPath || "", true);
            if (!normalizedTarget) {
                return null;
            }
            const knownEntry = state.entryByPath.get(normalizedTarget);
            if (knownEntry) {
                return knownEntry;
            }
            const parentPath = getParentPath(normalizedTarget);
            try {
                await ensureSaveDirectoryLoaded(parentPath);
            } catch (error) {
                return state.entryByPath.get(normalizedTarget) || null;
            }
            return state.entryByPath.get(normalizedTarget) || null;
        }

        async function confirmWriteOverwriteIfNeeded(targetPath) {
            const normalizedTarget = normalizePath(targetPath || "", true);
            if (!normalizedTarget) {
                return false;
            }
            const normalizedOriginal = normalizePath(originalPath || "", true);
            const targetEntry = await getWriteSaveTargetEntry(normalizedTarget);
            if (targetEntry && targetEntry.type === "dir") {
                throw new Error(t("save_overwrite_folder_error", "같은 이름의 폴더가 이미 있어 파일로 덮어쓸 수 없습니다."));
            }
            const willOverwrite = normalizedTarget === normalizedOriginal || Boolean(targetEntry && targetEntry.type === "file");
            if (!willOverwrite) {
                return true;
            }
            return requestConfirmDialog({
                title: t("save_overwrite_confirm_title", "파일 덮어쓰기"),
                message: t("save_overwrite_confirm_message", "이미 있는 파일을 덮어씁니다. 계속할까요?") + " " + getHandrivePathLabel(normalizedTarget),
                cancelText: t("cancel", "취소"),
                confirmText: t("save_overwrite_confirm_button", "덮어쓰기"),
            });
        }

        function getWriteMediaSaveExtensionOverride(editor) {
            if (editor && typeof editor.getSaveExtensionOverride === "function") {
                return String(editor.getSaveExtensionOverride() || "").trim().toLowerCase();
            }
            return "";
        }

        function resolveWriteMediaSaveTarget(mediaFilename, editor) {
            const sourcePath = normalizePath(originalPath || "", false);
            const resolved = editorResolveFilenameAndExtension(mediaFilename, sourcePath, t);
            const extensionOverride = getWriteMediaSaveExtensionOverride(editor);
            const targetExtension = extensionOverride || resolved.extension;
            const targetDir = getParentPath(sourcePath);
            return {
                filename: resolved.filename,
                extension: targetExtension,
                targetDir: targetDir,
                targetPath: buildSaveTargetPath(targetDir, resolved.filename, targetExtension),
            };
        }

        function normalizeDirectoryInput() {
            return normalizePath(state.selectedDir || state.browserDir || "", true);
        }

        function getParentPath(pathValue) {
            const normalized = normalizePath(pathValue, true);
            if (!normalized) {
                return "";
            }
            const parts = normalized.split("/");
            parts.pop();
            return parts.join("/");
        }

        function getCancelTargetDirectory() {
            if (originalPath) {
                return getParentPath(originalPath);
            }
            return normalizePath(state.selectedDir || state.browserDir || initialDir || "", true);
        }

        function getPathFileStem(pathValue) {
            const normalized = normalizePath(pathValue, true);
            if (!normalized) {
                return "";
            }
            const segments = normalized.split("/");
            const fileName = segments[segments.length - 1] || "";
            const dotIndex = fileName.lastIndexOf(".");
            if (dotIndex > 0) {
                return fileName.slice(0, dotIndex);
            }
            return fileName;
        }

        function normalizeFileExtensionValue(rawValue, allowEmpty) {
            const candidate = String(rawValue || "").trim().toLowerCase();
            if (!candidate) {
                if (allowEmpty) {
                    return "";
                }
                throw new Error(t("js_extension_required", "확장자를 입력해주세요."));
            }

            const normalized = candidate.startsWith(".") ? candidate : "." + candidate;
            if (!/^\.[a-z0-9][a-z0-9._-]{0,15}$/.test(normalized)) {
                throw new Error(t("js_extension_invalid", "확장자 형식이 올바르지 않습니다. 예: .md"));
            }
            return normalized;
        }

        function parseFileNameWithExtension(rawValue) {
            const trimmed = String(rawValue || "").trim();
            if (!trimmed) {
                return { filename: "", extension: "" };
            }

            const dotIndex = trimmed.lastIndexOf(".");
            if (dotIndex > 0 && dotIndex < trimmed.length - 1) {
                return {
                    filename: trimmed.slice(0, dotIndex).trim(),
                    extension: trimmed.slice(dotIndex).toLowerCase()
                };
            }
            return { filename: trimmed, extension: "" };
        }

        function syncExtensionSelectFromValue(extensionValue) {
            if (!saveExtensionSelect) {
                return;
            }
            let normalized = "";
            try {
                normalized = normalizeFileExtensionValue(extensionValue, true);
            } catch (error) {
                normalized = "";
            }
            if (!normalized) {
                normalized = DOCS_DEFAULT_EXTENSION;
            }
            if (extensionPresetSet.has(normalized)) {
                saveExtensionSelect.value = normalized;
                customExtensionValue = DOCS_DEFAULT_EXTENSION;
                return;
            }
            customExtensionValue = normalized;
            if (saveExtensionSelect.querySelector('option[value="' + DOCS_CUSTOM_EXTENSION_OPTION_VALUE + '"]')) {
                saveExtensionSelect.value = DOCS_CUSTOM_EXTENSION_OPTION_VALUE;
                return;
            }
            saveExtensionSelect.value = DOCS_DEFAULT_EXTENSION;
        }

        function getSelectedExtensionOrDefault() {
            if (!saveExtensionSelect) {
                return DOCS_DEFAULT_EXTENSION;
            }
            const selected = String(saveExtensionSelect.value || "").trim();
            if (!selected) {
                return DOCS_DEFAULT_EXTENSION;
            }
            if (selected === DOCS_CUSTOM_EXTENSION_OPTION_VALUE) {
                try {
                    return normalizeFileExtensionValue(customExtensionValue, false);
                } catch (error) {
                    return DOCS_DEFAULT_EXTENSION;
                }
            }
            return normalizeFileExtensionValue(selected, false);
        }

        function getSaveModalFilenameAndExtension() {
            const parsed = parseFileNameWithExtension(saveFilenameInput ? saveFilenameInput.value : "");
            const finalFilename = String(parsed.filename || "").trim();
            if (!finalFilename) {
                throw new Error(t("js_filename_required", "파일명을 입력해주세요."));
            }

            let extensionCandidate = parsed.extension;
            if (!extensionCandidate) {
                extensionCandidate = getSelectedExtensionOrDefault();
            }
            const targetExtension = normalizeFileExtensionValue(extensionCandidate, false);
            return {
                filename: finalFilename,
                extension: targetExtension,
            };
        }

        function buildSaveTargetPath(targetDir, filenameValue, extensionValue) {
            const filename = String(filenameValue || "").trim();
            if (!filename) {
                return "";
            }
            const extension = normalizeFileExtensionValue(extensionValue || DOCS_DEFAULT_EXTENSION, false);
            const fileName = filename + extension;
            const normalizedDir = normalizePath(targetDir || "", true);
            return normalizePath(normalizedDir ? normalizedDir + "/" + fileName : fileName, true);
        }

        function getSaveRequestOriginalPath(targetDir, filenameValue, extensionValue) {
            const overwritePath = normalizePath(state.selectedOverwritePath || "", true);
            if (overwritePath) {
                return overwritePath;
            }
            const normalizedOriginalPath = normalizePath(originalPath || "", true);
            if (!normalizedOriginalPath) {
                return "";
            }
            if (isPublicWriteDirectSave || !saveModal || saveModal.hidden) {
                return normalizedOriginalPath;
            }
            const targetPath = buildSaveTargetPath(targetDir, filenameValue, extensionValue);
            return targetPath === normalizedOriginalPath ? normalizedOriginalPath : "";
        }

        function setSaveModalSaving(isSaving) {
            state.isSaving = Boolean(isSaving);
            if (saveModalDialog) {
                saveModalDialog.classList.toggle("is-saving", state.isSaving);
                saveModalDialog.setAttribute("aria-busy", state.isSaving ? "true" : "false");
            }
            if (saveLoadingOverlay) {
                saveLoadingOverlay.hidden = !state.isSaving;
            }
            [
                saveCloseButton,
                saveCancelButton,
                saveConfirmButton,
                createFolderButton,
                saveFilenameInput,
                saveExtensionSelect,
            ].forEach(function (control) {
                if (control) {
                    control.disabled = state.isSaving;
                }
            });
        }

        function resolveWriteFilenameExtension() {
            const parsed = parseFileNameWithExtension(filenameInput ? filenameInput.value : "");
            if (!parsed.extension) {
                return "";
            }
            try {
                return normalizeFileExtensionValue(parsed.extension, false);
            } catch (error) {
                return "";
            }
        }

        function resolveWriteEditorRenderClass() {
            const extension = resolveWriteFilenameExtension();
            if (extension === ".md") {
                return "handrive-editor-md";
            }
            if (extension === ".js") {
                return "handrive-js";
            }
            if (extension === ".css") {
                return "handrive-css";
            }
            if (extension === ".json") {
                return "handrive-json";
            }
            if (extension === ".py") {
                return "handrive-py";
            }
            if (extension === ".html") {
                return "handrive-editor-html";
            }
            return "handrive-plain-text";
        }

        function syncEditorHighlightScroll() {
            if (!contentInput || !editorHighlight) {
                return;
            }
            syncEditorMirrorScroll(contentInput, editorHighlight, editorHighlightCode);
        }

        function resetWriteEditorHorizontalScroll() {
            try { document.documentElement.scrollLeft = 0; } catch (error) {}
            try { document.body.scrollLeft = 0; } catch (error) {}
            try {
                if (document.scrollingElement) {
                    document.scrollingElement.scrollLeft = 0;
                }
            } catch (error) {}
            try { window.scrollTo(0, window.scrollY || window.pageYOffset || 0); } catch (error) {}
            [
                root,
                editorSurface,
                contentInput,
                editorHighlight,
                imageEditorSurface,
                videoEditorSurface,
                audioEditorSurface,
            ].forEach(function (element) {
                if (element && typeof element.scrollLeft === "number") {
                    element.scrollLeft = 0;
                }
            });
            if (root && typeof root.querySelectorAll === "function") {
                root
                    .querySelectorAll(".ie-canvas-area, .ve-body, .ae-body")
                    .forEach(function (element) {
                        element.scrollLeft = 0;
                    });
            }
            if (contentInput && editorHighlight) {
                syncEditorMirrorScroll(contentInput, editorHighlight, editorHighlightCode);
            }
        }

        function scheduleWriteEditorHorizontalScrollReset() {
            resetWriteEditorHorizontalScroll();
            window.requestAnimationFrame(function () {
                resetWriteEditorHorizontalScroll();
                window.requestAnimationFrame(resetWriteEditorHorizontalScroll);
            });
            window.setTimeout(resetWriteEditorHorizontalScroll, 80);
            window.setTimeout(resetWriteEditorHorizontalScroll, 240);
        }

        function clearEditorSuggestion() {
            activeEditorSuggestions = [];
            activeEditorSuggestionIndex = -1;
            if (editorSuggest) {
                editorSuggest.hidden = true;
                // 위치 스타일 초기화
                editorSuggest.style.left = '';
                editorSuggest.style.top = '';
                editorSuggest.innerHTML = "";
            }
            if (editorSuggestLabel) {
                editorSuggestLabel.textContent = "";
            }
        }

        function findEditorSuggestions(extension, tokenText) {
            const items = resolveEditorCompletionItemsByExtension(extension);
            return findEditorCompletionItems(items, tokenText, 8);
        }

        function renderWriteEditorSuggestDropdown() {
            if (!editorSuggest) {
                return;
            }
            editorSuggest.innerHTML = "";
            const list = document.createElement("div");
            list.className = "handrive-editor-suggest-list";
            for (let i = 0; i < activeEditorSuggestions.length; i += 1) {
                const item = activeEditorSuggestions[i] || {};
                const option = document.createElement("button");
                option.type = "button";
                option.className = "handrive-editor-suggest-item" + (i === activeEditorSuggestionIndex ? " is-active" : "");
                option.setAttribute("data-suggest-index", String(i));

                const labelNode = document.createElement("span");
                labelNode.className = "handrive-editor-suggest-item-label";
                labelNode.textContent = item.label || item.insertText || "";

                const triggerNode = document.createElement("span");
                triggerNode.className = "handrive-editor-suggest-item-trigger";
                triggerNode.textContent = item.trigger || "";

                option.appendChild(labelNode);
                option.appendChild(triggerNode);
                list.appendChild(option);
            }
            const footer = document.createElement("div");
            footer.className = "handrive-editor-suggest-footer";
            footer.textContent = "↑↓ 이동 · Enter/Tab 적용";
            editorSuggest.appendChild(list);
            editorSuggest.appendChild(footer);
        }

        function moveWriteEditorSuggestion(step) {
            if (!activeEditorSuggestions.length) {
                return;
            }
            const count = activeEditorSuggestions.length;
            activeEditorSuggestionIndex = (activeEditorSuggestionIndex + step + count) % count;
            renderWriteEditorSuggestDropdown();
        }

        function updateEditorSuggestion() {
            if (!contentInput || !editorSuggest) {
                return;
            }
            const start = contentInput.selectionStart || 0;
            const end = contentInput.selectionEnd || 0;
            if (start !== end) {
                clearEditorSuggestion();
                return;
            }

            const extension = getCurrentEditorExtension();
            const tokenInfo = extractEditorCompletionToken(contentInput.value || "", start);
            if (!tokenInfo) {
                clearEditorSuggestion();
                return;
            }
            const suggestions = findEditorSuggestions(extension, tokenInfo.token);
            if (!suggestions.length) {
                clearEditorSuggestion();
                return;
            }

            activeEditorSuggestions = suggestions.map(function (suggestion) {
                return {
                    start: tokenInfo.start,
                    end: tokenInfo.end,
                    insertText: suggestion.insertText,
                    cursorBack: Number(suggestion.cursorBack || 0),
                    label: suggestion.label || suggestion.insertText,
                    trigger: suggestion.trigger || "",
                };
            });
            activeEditorSuggestionIndex = 0;
            renderWriteEditorSuggestDropdown();
            
            // 커서 위치 계산
            const cursorPosition = calculateCursorPosition(contentInput, start);
            if (cursorPosition) {
                // 에디터 서페이스 내에서의 상대 위치 계산
                const editorRect = contentInput.getBoundingClientRect();
                const surfaceRect = editorSurface ? editorSurface.getBoundingClientRect() : null;
                
                // 커서 기준으로 오른쪽 12픽셀, 아래 6픽셀
                let left = cursorPosition.left + 12;
                let top = cursorPosition.top + (cursorPosition.lineHeight || 20) + 6;
                
                // 에디터 서페이스가 있으면 상대 위치 조정
                if (surfaceRect) {
                    left = (cursorPosition.left + 12) - surfaceRect.left;
                    top = (cursorPosition.top + (cursorPosition.lineHeight || 20) + 6) - surfaceRect.top;
                }

                const suggestRect = editorSuggest.getBoundingClientRect();
                if (surfaceRect) {
                    const minLeft = 8;
                    const minTop = 8;
                    const maxLeft = Math.max(minLeft, surfaceRect.width - suggestRect.width - 8);
                    const maxTop = Math.max(minTop, surfaceRect.height - suggestRect.height - 8);
                    left = Math.min(Math.max(minLeft, left), maxLeft);
                    top = Math.min(Math.max(minTop, top), maxTop);
                }
                
                editorSuggest.style.left = left + 'px';
                editorSuggest.style.top = top + 'px';
            }
            editorSuggest.hidden = false;
        }

        function calculateCursorPosition(textarea, position) {
            // 텍스트 영역에서 커서의 픽셀 위치 계산
            const text = textarea.value;
            const textBeforeCursor = text.substring(0, position);
            const lines = textBeforeCursor.split('\n');
            const currentLine = lines.length - 1;
            const currentColumn = lines[lines.length - 1].length;
            
            // textarea의 스타일 정보 가져오기
            const styles = window.getComputedStyle(textarea);
            const fontSize = parseFloat(styles.fontSize);
            const lineHeight = parseFloat(styles.lineHeight) || fontSize * 1.2;
            const fontFamily = styles.fontFamily;
            const paddingLeft = parseFloat(styles.paddingLeft) || 0;
            const paddingTop = parseFloat(styles.paddingTop) || 0;
            const borderLeft = parseFloat(styles.borderLeftWidth) || 0;
            const borderTop = parseFloat(styles.borderTopWidth) || 0;
            
            // 캔버스를 사용해서 텍스트 너비 계산
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            context.font = `${fontSize}px ${fontFamily}`;
            
            // 현재 라인의 텍스트 너비 계산
            const lineWidth = context.measureText(lines[lines.length - 1]).width;
            
            // textarea의 실제 위치
            const textareaRect = textarea.getBoundingClientRect();
            
            // 스크롤 위치 고려
            const scrollTop = textarea.scrollTop;
            const scrollLeft = textarea.scrollLeft;
            
            // 커서의 절대 위치 계산
            const left = textareaRect.left + paddingLeft + borderLeft + lineWidth - scrollLeft;
            const top = textareaRect.top + paddingTop + borderTop + (currentLine * lineHeight) - scrollTop;
            
            return {
                left: left,
                top: top,
                lineHeight: lineHeight
            };
        }

        window.__handriveCalculateCursorPosition = calculateCursorPosition;

        function acceptEditorSuggestion() {
            if (!contentInput) {
                return false;
            }
            const suggestion = activeEditorSuggestions[activeEditorSuggestionIndex] || null;
            if (!suggestion) {
                return false;
            }
            contentInput.setRangeText(suggestion.insertText, suggestion.start, suggestion.end, "end");
            const cursorPos = (suggestion.start + suggestion.insertText.length) - Math.max(0, suggestion.cursorBack);
            contentInput.setSelectionRange(cursorPos, cursorPos);
            contentInput.focus();
            contentInput.dispatchEvent(new Event("input", { bubbles: true }));
            clearEditorSuggestion();
            return true;
        }

        function renderWriteEditorHighlight() {
            if (!contentInput || !editorHighlight || !editorHighlightCode) {
                return;
            }

            const renderClass = resolveWriteEditorRenderClass();
            const source = contentInput.value || "";
            let highlightedHtml = escapeHtml(source);
            
            // .md 파일일 때는 마크다운 렌더링을 하지 않음
            if (renderClass === "handrive-js") {
                highlightedHtml = highlightJavaScriptCode(source);
            } else if (renderClass === "handrive-editor-md") {
                // .md 파일은 plain text로 표시
                highlightedHtml = escapeHtml(source);
            } else if (renderClass === "handrive-css") {
                highlightedHtml = highlightCssCode(source);
            } else if (renderClass === "handrive-json") {
                highlightedHtml = highlightJsonCode(source);
            } else if (renderClass === "handrive-py") {
                highlightedHtml = highlightPythonCode(source);
            } else if (renderClass === "handrive-editor-html") {
                highlightedHtml = highlightHtmlCode(source);
            }

            editorHighlight.classList.remove("handrive-plain-text", "handrive-editor-md", "handrive-js", "handrive-css", "handrive-json", "handrive-py", "handrive-editor-html");
            editorHighlight.classList.add(renderClass);
            editorHighlightCode.innerHTML = highlightedHtml + (source.endsWith("\n") ? "\u200b" : "");
            syncEditorHighlightScroll();
        }

        function syncMarkdownHelpButtonVisibility() {
            if (!markdownHelpButton && !markdownPreviewButton) {
                renderWriteEditorHighlight();
                return;
            }
            const resolvedExtension = resolveWriteFilenameExtension();
            const isMarkdownTarget = resolvedExtension === DOCS_DEFAULT_EXTENSION;
            if (markdownHelpButton) {
                markdownHelpButton.hidden = !isMarkdownTarget;
                markdownHelpButton.disabled = !isMarkdownTarget;
            }
            if (markdownPreviewButton) {
                markdownPreviewButton.hidden = !isMarkdownTarget;
                markdownPreviewButton.disabled = !isMarkdownTarget;
            }
            renderWriteEditorHighlight();
        }

        function buildFilenameWithExtension(filenameValue, extensionValue) {
            const baseName = String(filenameValue || "").trim();
            if (!baseName) {
                return "";
            }
            const normalizedExtension = normalizeFileExtensionValue(extensionValue, false);
            return baseName + normalizedExtension;
        }

        function getCurrentSaveTargetExtension() {
            try {
                const parsed = parseFileNameWithExtension(saveFilenameInput ? saveFilenameInput.value : "");
                if (parsed.extension) {
                    return normalizeFileExtensionValue(parsed.extension, false);
                }
                return getSelectedExtensionOrDefault();
            } catch (error) {
                return getPathFileExtension(originalPath) || DOCS_DEFAULT_EXTENSION;
            }
        }

        function getSaveEntrySortName(entryOrPath) {
            if (entryOrPath && typeof entryOrPath === "object") {
                return String(entryOrPath.name || entryOrPath.path || "").toLocaleLowerCase();
            }
            return String(entryOrPath || "").split("/").pop().toLocaleLowerCase();
        }

        function getChildDirectories(pathValue) {
            const normalized = normalizePath(pathValue, true);
            const cachedEntries = getCachedSaveEntries(normalized);
            if (cachedEntries) {
                return cachedEntries
                    .filter(function (entry) {
                        return entry && entry.type === "dir" && entry.path;
                    })
                    .sort(function (a, b) {
                        return getSaveEntrySortName(a).localeCompare(getSaveEntrySortName(b));
                    })
                    .map(function (entry) {
                        return normalizePath(entry.path, true);
                    });
            }
            return directories
                .filter(function (dirPath) {
                    if (!dirPath) {
                        return false;
                    }
                    return getParentPath(dirPath) === normalized;
                })
                .sort(function (a, b) {
                    return getSaveEntrySortName(a).localeCompare(getSaveEntrySortName(b));
                });
        }

        function isSaveOverwriteCandidate(entry) {
            if (!entry || entry.type !== "file" || !entry.path) {
                return false;
            }
            if (entry.can_edit === false) {
                return false;
            }
            if (entry.google_drive && entry.google_drive.can_edit_content === false) {
                return false;
            }
            const targetExtension = getCurrentSaveTargetExtension();
            return Boolean(targetExtension) && getPathFileExtension(entry.name || entry.path) === targetExtension;
        }

        function getSaveBrowserEntries(pathValue) {
            const normalized = normalizePath(pathValue, true);
            const cachedEntries = getCachedSaveEntries(normalized);
            if (cachedEntries) {
                return {
                    dirs: cachedEntries
                        .filter(function (entry) {
                            return entry && entry.type === "dir" && entry.path;
                        })
                        .sort(function (a, b) {
                            return getSaveEntrySortName(a).localeCompare(getSaveEntrySortName(b));
                        }),
                    overwriteFiles: cachedEntries
                        .filter(isSaveOverwriteCandidate)
                        .sort(function (a, b) {
                            return getSaveEntrySortName(a).localeCompare(getSaveEntrySortName(b));
                        }),
                    fromCache: true,
                };
            }
            return {
                dirs: getChildDirectories(normalized).map(function (dirPath) {
                    return state.entryByPath.get(normalizePath(dirPath, true)) || {
                        name: dirPath.split("/").pop() || dirPath,
                        path: dirPath,
                        type: "dir",
                        can_write_children: true,
                    };
                }),
                overwriteFiles: [],
                fromCache: false,
            };
        }

        function createSaveEntryIcon(entry) {
            const safeEntry = entry || {};
            const fileIconKey = safeEntry.type === "file" ? getFileIconKey(safeEntry.path || safeEntry.name || "") : "";
            const typeMarker = createTypeMarker({
                isDir: safeEntry.type === "dir",
                isGoogleDrive: Boolean(safeEntry.type === "dir" && safeEntry.google_drive && safeEntry.google_drive.is_root),
                isGithubRepo: Boolean(safeEntry.type === "dir" && safeEntry.github_repo),
                isRepo: Boolean(safeEntry.type === "dir" && safeEntry.git_repo),
                isBranch: Boolean(safeEntry.type === "dir" && safeEntry.git_branch_root),
                isMap: Boolean(safeEntry.type === "dir" && safeEntry.is_map_folder),
                isEmpty: Boolean(safeEntry.type === "dir" && safeEntry.has_children === false),
                customIconUrl: safeEntry.type === "dir" && safeEntry.folder_icon_url ? safeEntry.folder_icon_url : "",
                fileIconKey: fileIconKey,
                isGenericFileIcon: Boolean(fileIconKey && isGenericFileIconKey(fileIconKey)),
            });
            typeMarker.classList.add("handrive-save-entry-icon");
            return typeMarker;
        }

        function resolveSaveEntryLabel(entry) {
            if (!entry) {
                return "";
            }
            if (entry.google_drive && entry.google_drive.is_root) {
                return String(entry.google_drive.name || entry.name || "").trim();
            }
            if (entry.github_repo) {
                return String(entry.github_repo.name || entry.name || "").trim();
            }
            if (entry.git_repo && entry.git_repo.repo_name) {
                return String(entry.git_repo.repo_name || entry.name || "").trim();
            }
            return String(entry.name || "").trim();
        }

        function selectOverwriteEntry(entry) {
            if (!entry || !entry.path) {
                return;
            }
            const overwritePath = normalizePath(entry.path, true);
            state.selectedOverwritePath = overwritePath;
            updateSelectedDir(getParentPath(overwritePath), { keepOverwrite: true });
            const entryName = String(entry.name || overwritePath.split("/").pop() || "").trim();
            if (entryName && saveFilenameInput) {
                saveFilenameInput.value = entryName;
                syncExtensionSelectFromValue(getPathFileExtension(entryName));
            }
        }

        function renderDirectoryOptions() {
            if (!directoryOptions) {
                return;
            }
            directoryOptions.innerHTML = "";
            directories
                .slice()
                .sort(function (a, b) {
                    return String(a).localeCompare(String(b));
                })
                .forEach(function (pathValue) {
                    const option = document.createElement("option");
                    option.value = pathValue;
                    directoryOptions.appendChild(option);
                });
        }

        function updateSelectedDir(pathValue, options) {
            const normalized = normalizePath(pathValue, true);
            state.selectedDir = normalized;
            if (!options || !options.keepOverwrite) {
                state.selectedOverwritePath = "";
            }
        }

        function getSaveBrowserRootDir() {
            return scopedHomeDir || "";
        }

        function getSaveBrowserRootLabel() {
            if (!scopedHomeDir) {
                return effectiveRootLabel;
            }
            const homeParts = scopedHomeDir.split("/").filter(Boolean);
            const homeLabel = homeParts.length ? homeParts[homeParts.length - 1] : scopedHomeDir;
            return homeLabel;
        }

        function getScopedVisiblePath(pathValue) {
            const normalized = normalizePath(pathValue, true);
            if (!scopedHomeDir) {
                return normalized;
            }
            if (!normalized || normalized === scopedHomeDir) {
                return "";
            }
            if (normalized.startsWith(scopedHomeDir + "/")) {
                return normalized.slice(scopedHomeDir.length + 1);
            }
            return normalized;
        }

        function isPathInsideScopedHome(pathValue) {
            const normalized = normalizePath(pathValue, true);
            if (!scopedHomeDir || !normalized) {
                return false;
            }
            return normalized === scopedHomeDir || normalized.startsWith(scopedHomeDir + "/");
        }

        function getWritableAncestorPaths(pathValue) {
            const normalized = normalizePath(pathValue, true);
            const visibleAncestors = [];

            function appendVisible(pathCandidate) {
                const normalizedCandidate = normalizePath(pathCandidate, true);
                if (!normalizedCandidate) {
                    if (isSuperuser && hasDirectory("")) {
                        visibleAncestors.push("");
                    }
                    return;
                }
                if (!hasDirectory(normalizedCandidate)) {
                    return;
                }
                if (!isSuperuser && normalizedCandidate === "users") {
                    return;
                }
                visibleAncestors.push(normalizedCandidate);
            }

            if (!normalized) {
                appendVisible("");
                return visibleAncestors;
            }

            const parts = normalized.split("/").filter(Boolean);
            const accumulated = [];
            appendVisible("");
            parts.forEach(function (part) {
                accumulated.push(part);
                appendVisible(accumulated.join("/"));
            });
            return visibleAncestors;
        }

        function getWritablePathLabel(pathValue) {
            return getWritableAncestorPaths(pathValue)
                .map(function (ancestorPath) {
                    if (!ancestorPath) {
                        return effectiveRootLabel;
                    }
                    return decodeBreadcrumbLabel(ancestorPath.split("/").slice(-1)[0]);
                })
                .join("/");
        }

        function getNearestWritableDirectory(pathValue) {
            let normalized = normalizePath(pathValue, true);
            while (normalized) {
                if (hasDirectory(normalized)) {
                    return normalized;
                }
                normalized = getParentPath(normalized);
            }
            if (scopedHomeDir && hasDirectory(scopedHomeDir)) {
                return scopedHomeDir;
            }
            return isSuperuser && hasDirectory("") ? "" : "";
        }

        function getOriginalSaveFilename() {
            const normalizedOriginal = normalizePath(originalPath || "", true);
            if (!normalizedOriginal) {
                return "";
            }
            return normalizedOriginal.split("/").pop() || "";
        }

        function getSaveInputFullFilename() {
            return String(saveFilenameInput ? saveFilenameInput.value || "" : "").trim();
        }

        function getSaveTreeRootForPath(pathValue) {
            const rootDir = getSaveBrowserRootDir();
            const normalized = normalizePath(pathValue, true);
            if (rootDir && (!normalized || normalized === rootDir || normalized.startsWith(rootDir + "/"))) {
                return rootDir;
            }
            return isSuperuser ? "" : rootDir;
        }

        function getSaveTreeRootLabel() {
            const rootDir = normalizePath(state.browserDir || getSaveBrowserRootDir(), true);
            if (!rootDir) {
                return effectiveRootLabel;
            }
            if (rootDir === getSaveBrowserRootDir()) {
                return getSaveBrowserRootLabel();
            }
            return getHandrivePathTailLabel(rootDir);
        }

        function getSaveDirectoryPathChain(pathValue) {
            const normalized = normalizePath(pathValue, true);
            const rootDir = normalizePath(state.browserDir || getSaveBrowserRootDir(), true);
            const chain = [];
            const parts = normalized ? normalized.split("/").filter(Boolean) : [];
            const accumulated = [];

            if (!rootDir || normalized === rootDir || (rootDir && normalized.startsWith(rootDir + "/"))) {
                chain.push(rootDir);
            }

            parts.forEach(function (part) {
                accumulated.push(part);
                const candidate = accumulated.join("/");
                if (candidate === rootDir) {
                    return;
                }
                if (rootDir && !(candidate === rootDir || candidate.startsWith(rootDir + "/"))) {
                    return;
                }
                chain.push(candidate);
            });

            return chain.filter(function (pathValue, index, list) {
                return list.indexOf(pathValue) === index;
            });
        }

        function expandSaveTreeToPath(pathValue) {
            getSaveDirectoryPathChain(pathValue).forEach(function (directoryPath) {
                state.expandedSaveDirs.add(normalizePath(directoryPath, true));
            });
        }

        function isSaveDirectoryExpanded(pathValue) {
            const normalized = normalizePath(pathValue, true);
            return normalized === normalizePath(state.browserDir || "", true) || state.expandedSaveDirs.has(normalized);
        }

        async function ensureSaveTreePathLoaded(pathValue) {
            const chain = getSaveDirectoryPathChain(pathValue);
            for (let index = 0; index < chain.length; index += 1) {
                await ensureSaveDirectoryLoaded(chain[index]);
            }
        }

        async function ensureExpandedSaveDirectoriesLoaded() {
            const rootDir = normalizePath(state.browserDir || getSaveBrowserRootDir(), true);
            const paths = new Set([rootDir]);
            state.expandedSaveDirs.forEach(function (pathValue) {
                const normalized = normalizePath(pathValue, true);
                if (!rootDir || normalized === rootDir || normalized.startsWith(rootDir + "/")) {
                    paths.add(normalized);
                }
            });
            await Promise.all(Array.from(paths).map(function (pathValue) {
                return ensureSaveDirectoryLoaded(pathValue);
            }));
        }

        function syncOriginalSaveSelectionFromFilename(options) {
            const settings = options || {};
            const normalizedOriginal = normalizePath(originalPath || "", true);
            if (!normalizedOriginal) {
                return false;
            }
            const originalParent = getParentPath(normalizedOriginal);
            const shouldAdjust = settings.force
                || state.selectedOverwritePath === normalizedOriginal
                || normalizePath(state.selectedDir || "", true) === originalParent
                || !state.selectedDir;
            if (!shouldAdjust) {
                return false;
            }

            const originalFilename = getOriginalSaveFilename();
            const currentFilename = getSaveInputFullFilename();
            const currentExtension = getCurrentSaveTargetExtension();
            const originalExtension = getPathFileExtension(originalFilename);
            updateSelectedDir(originalParent);
            if (originalFilename && currentFilename === originalFilename && currentExtension === originalExtension) {
                state.selectedOverwritePath = normalizedOriginal;
            }
            expandSaveTreeToPath(originalParent);
            return true;
        }

        function getRenderedToolbarBreadcrumbItems() {
            const breadcrumbs = document.querySelector(".handrive-toolbar-left .ui-path-breadcrumbs");
            if (!breadcrumbs) {
                return [];
            }
            return Array.from(breadcrumbs.querySelectorAll(".ui-path-link, .ui-path-current"))
                .map(function (item) {
                    const label = String(item.textContent || "").trim();
                    const rawPath = item.getAttribute("data-handrive-dir");
                    return {
                        label: label,
                        path: rawPath === null ? "" : normalizePath(rawPath, true),
                    };
                })
                .filter(function (item) {
                    return Boolean(item.label);
                });
        }

        function applyRenderedToolbarBreadcrumbLabels(crumbs) {
            const labelsByPath = new Map();
            getRenderedToolbarBreadcrumbItems().forEach(function (item) {
                labelsByPath.set(item.path, item.label);
            });
            return crumbs.map(function (crumb) {
                const normalizedCrumbPath = normalizePath(crumb && crumb.path || "", true);
                const renderedLabel = labelsByPath.get(normalizedCrumbPath);
                return Object.assign({}, crumb, {
                    label: renderedLabel || decodeBreadcrumbLabel(crumb && crumb.label),
                });
            });
        }

        function applySaveEntryBreadcrumbLabels(crumbs) {
            return crumbs.map(function (crumb) {
                const normalizedCrumbPath = normalizePath(crumb && crumb.path || "", true);
                const entry = state.entryByPath.get(normalizedCrumbPath);
                const cachedMeta = state.directoryMetaCache.get(normalizedCrumbPath);
                let label = "";
                if (entry) {
                    label = resolveSaveEntryLabel(entry);
                }
                if (!label && cachedMeta && cachedMeta.google_drive) {
                    label = String(cachedMeta.google_drive.name || "").trim();
                }
                if (!label && cachedMeta && cachedMeta.git_repo && cachedMeta.git_repo.repo_name) {
                    label = String(cachedMeta.git_repo.repo_name || "").trim();
                }
                if (!label) {
                    return crumb;
                }
                return Object.assign({}, crumb, { label: label });
            });
        }

        function scopeWriteBreadcrumbsToSaveRoot(crumbs, pathValue) {
            const rootDir = getSaveBrowserRootDir();
            const normalized = normalizePath(pathValue, true);
            if (!rootDir || !(normalized === rootDir || normalized.startsWith(rootDir + "/"))) {
                return crumbs;
            }
            const rootIndex = crumbs.findIndex(function (crumb) {
                return normalizePath(crumb && crumb.path || "", true) === rootDir;
            });
            if (rootIndex < 0) {
                return crumbs;
            }
            return crumbs.slice(rootIndex).map(function (crumb, index, sliced) {
                const nextCrumb = Object.assign({}, crumb, {
                    isCurrent: index === sliced.length - 1,
                });
                if (index === 0) {
                    nextCrumb.label = getSaveBrowserRootLabel();
                }
                return nextCrumb;
            });
        }

        function buildWriteBreadcrumbItems(pathValue) {
            const normalized = normalizePath(pathValue, true);
            const targetPath = normalized || scopedHomeDir || "";
            const renderedCrumbs = applySaveEntryBreadcrumbLabels(applyRenderedToolbarBreadcrumbLabels(buildNavigationBreadcrumbItems(targetPath, {
                effectiveRootLabel: effectiveRootLabel,
                isSuperuser: isSuperuser,
                normalizePath: normalizePath,
                scopedHomeDir: scopedHomeDir,
            })));
            return scopeWriteBreadcrumbsToSaveRoot(renderedCrumbs, targetPath);
        }

        function getHandrivePathTailLabel(pathValue) {
            const crumbs = buildWriteBreadcrumbItems(pathValue);
            if (crumbs.length) {
                return crumbs[crumbs.length - 1].label;
            }
            const normalized = normalizePath(pathValue, true);
            return normalized ? decodeBreadcrumbLabel(normalized.split("/").slice(-1)[0]) : effectiveRootLabel;
        }

        function renderBreadcrumb() {
            if (!saveBreadcrumb) {
                return;
            }
            saveBreadcrumb.innerHTML = "";
            const fragment = document.createDocumentFragment();

            function addCrumb(label, pathValue, isCurrent) {
                const crumbButton = document.createElement("button");
                crumbButton.type = "button";
                crumbButton.className = "handrive-save-crumb-btn";
                if (isCurrent) {
                    crumbButton.classList.add("is-current");
                }
                crumbButton.textContent = label;
                crumbButton.addEventListener("click", function () {
                    navigateSaveBrowserTo(pathValue);
                });
                fragment.appendChild(crumbButton);
            }

            const currentPath = normalizePath(state.selectedDir || state.browserDir, true);
            if (scopedHomeDir && isPathInsideScopedHome(currentPath || scopedHomeDir)) {
                buildWriteBreadcrumbItems(currentPath || scopedHomeDir).forEach(function (crumb, index) {
                    if (index > 0) {
                        const separator = document.createElement("span");
                        separator.className = "handrive-save-crumb-sep";
                        separator.textContent = "/";
                        fragment.appendChild(separator);
                    }
                    addCrumb(crumb.label, crumb.path, crumb.isCurrent);
                });
                saveBreadcrumb.appendChild(fragment);
                return;
            }
            const writableAncestors = getWritableAncestorPaths(currentPath);
            if (!writableAncestors.length) {
                if (isSuperuser) {
                    addCrumb(effectiveRootLabel, "", true);
                }
            } else {
                writableAncestors.forEach(function (ancestorPath, index) {
                    if (index > 0) {
                        const separator = document.createElement("span");
                        separator.className = "handrive-save-crumb-sep";
                        separator.textContent = "/";
                        fragment.appendChild(separator);
                    }
                    const label = ancestorPath
                        ? getHandrivePathTailLabel(ancestorPath)
                        : effectiveRootLabel;
                    addCrumb(label, ancestorPath, ancestorPath === currentPath);
                });
            }

            saveBreadcrumb.appendChild(fragment);
        }

        function navigateSaveBrowserTo(pathValue) {
            const normalized = normalizePath(pathValue, true);
            state.browserDir = getSaveTreeRootForPath(normalized);
            state.expandedSaveDirs = new Set();
            expandSaveTreeToPath(normalized);
            updateSelectedDir(normalized);
            renderBrowser();
        }

        function buildSaveTreeRootEntry() {
            const rootPath = normalizePath(state.browserDir || getSaveBrowserRootDir(), true);
            const cachedMeta = state.directoryMetaCache.get(rootPath) || null;
            return {
                name: getSaveTreeRootLabel(),
                path: rootPath,
                type: "dir",
                has_children: cachedMeta ? Boolean(cachedMeta.has_children) : true,
                can_write_children: cachedMeta && Object.prototype.hasOwnProperty.call(cachedMeta, "can_write_children")
                    ? Boolean(cachedMeta.can_write_children)
                    : true,
                google_drive: cachedMeta && cachedMeta.google_drive ? cachedMeta.google_drive : null,
                git_repo: cachedMeta && cachedMeta.git_repo ? cachedMeta.git_repo : null,
                git_branch_root: cachedMeta ? Boolean(cachedMeta.git_branch_root) : false,
            };
        }

        function canSelectSaveDirectory(entry) {
            return !entry || entry.can_write_children !== false;
        }

        function appendSaveSelectedClass(row, entryPath, isFile) {
            if (
                (!isFile && entryPath === state.selectedDir && !state.selectedOverwritePath) ||
                (isFile && entryPath === state.selectedOverwritePath)
            ) {
                row.classList.add("is-selected");
            }
        }

        function renderSaveEntryContents(row, entry, isOverwriteFile) {
            const entryPath = normalizePath(entry && entry.path || "", true);
            const icon = createSaveEntryIcon(entry);
            const name = document.createElement("span");
            name.className = "handrive-save-folder-name";
            name.textContent = resolveSaveEntryLabel(entry) || getHandrivePathTailLabel(entryPath);

            row.appendChild(icon);
            row.appendChild(name);
            if (isOverwriteFile) {
                const badge = document.createElement("span");
                badge.className = "handrive-save-overwrite-badge";
                badge.textContent = t("save_overwrite_badge", "덮어쓰기");
                row.appendChild(badge);
            }
        }

        function addSaveCurrentDirectoryNode(fragment) {
            const entry = buildSaveTreeRootEntry();
            const entryPath = normalizePath(entry.path || "", true);
            const item = document.createElement("li");
            item.className = "handrive-item handrive-save-tree-item handrive-save-current-dir-item";

            const row = document.createElement("button");
            row.type = "button";
            row.className = "handrive-save-folder-row handrive-save-current-dir-row";
            row.setAttribute("data-entry-path", entryPath);
            appendSaveSelectedClass(row, entryPath, false);
            renderSaveEntryContents(row, entry, false);

            row.addEventListener("click", function (event) {
                if (event.button !== 0) {
                    return;
                }
                event.preventDefault();
                if (canSelectSaveDirectory(entry)) {
                    updateSelectedDir(entryPath);
                }
                renderBreadcrumb();
                renderFolderList();
            });

            item.appendChild(row);
            fragment.appendChild(item);
        }

        async function toggleSaveFolderExpansion(entry, options) {
            const settings = options || {};
            const entryPath = normalizePath(entry && entry.path || "", true);
            if (!entryPath || entry.type !== "dir" || entry.has_children === false) {
                return;
            }
            if (state.expandedSaveDirs.has(entryPath) && !settings.expandOnly) {
                state.expandedSaveDirs.delete(entryPath);
                renderFolderList();
                return;
            }
            state.expandedSaveDirs.add(entryPath);
            renderFolderList({ loading: true });
            await ensureSaveDirectoryLoaded(entryPath);
            renderFolderList();
        }

        function addSaveEntryNode(entry, fragment, ancestorHasNextSiblings, isLastSibling) {
            if (!entry || !entry.path) {
                return 0;
            }
            const entryPath = normalizePath(entry.path, true);
            const isOverwriteFile = entry.type === "file";
            const item = document.createElement("li");
            item.className = "handrive-item handrive-save-tree-item";

            const treePrefix = buildTreePrefixElement(ancestorHasNextSiblings, Boolean(isLastSibling));
            const row = document.createElement("button");
            row.type = "button";
            row.className = "handrive-save-folder-row has-tree-prefix";
            row.setAttribute("data-entry-path", entryPath);
            if (isOverwriteFile) {
                row.classList.add("is-overwrite-file");
            } else if (entry.type === "dir" && entry.has_children !== false) {
                row.setAttribute("aria-expanded", isSaveDirectoryExpanded(entryPath) ? "true" : "false");
            }
            appendSaveSelectedClass(row, entryPath, isOverwriteFile);
            renderSaveEntryContents(row, entry, isOverwriteFile);

            row.addEventListener("click", function (event) {
                if (event.button !== 0 || event.detail > 1) {
                    return;
                }
                event.preventDefault();
                if (isOverwriteFile) {
                    selectOverwriteEntry(entry);
                    renderBreadcrumb();
                    renderFolderList();
                    return;
                }
                if (entry.type !== "dir") {
                    return;
                }
                if (canSelectSaveDirectory(entry)) {
                    updateSelectedDir(entryPath);
                }
                renderBreadcrumb();
                if (entry.has_children !== false) {
                    toggleSaveFolderExpansion(entry).catch(alertError);
                    return;
                }
                renderFolderList();
            });

            row.addEventListener("dblclick", function (event) {
                if (event.button !== 0) {
                    return;
                }
                event.preventDefault();
                if (isOverwriteFile) {
                    selectOverwriteEntry(entry);
                    renderBreadcrumb();
                    renderFolderList();
                    return;
                }
                if (entry.type === "dir" && entry.has_children !== false) {
                    toggleSaveFolderExpansion(entry, { expandOnly: true }).catch(alertError);
                }
            });

            item.appendChild(treePrefix);
            item.appendChild(row);
            fragment.appendChild(item);
            state.entryByPath.set(entryPath, entry);

            if (entry.type === "dir" && isSaveDirectoryExpanded(entryPath)) {
                const childEntries = getSaveBrowserEntries(entryPath);
                const children = childEntries.dirs.concat(childEntries.overwriteFiles);
                const nextAncestorHasNextSiblings = (ancestorHasNextSiblings || []).slice();
                nextAncestorHasNextSiblings.push(!isLastSibling);
                children.forEach(function (child, index) {
                    addSaveEntryNode(child, fragment, nextAncestorHasNextSiblings, index === children.length - 1);
                });
            }
            return 1;
        }

        function appendSaveTreeChildren(parentPath, fragment, ancestorHasNextSiblings) {
            const browserEntries = getSaveBrowserEntries(parentPath);
            const rows = browserEntries.dirs.concat(browserEntries.overwriteFiles);
            rows.forEach(function (entry, index) {
                addSaveEntryNode(entry, fragment, ancestorHasNextSiblings, index === rows.length - 1);
            });
            return {
                count: rows.length,
                fromCache: browserEntries.fromCache,
            };
        }

        function renderFolderList(options) {
            if (!saveFolderList) {
                return;
            }
            const settings = options || {};
            saveFolderList.innerHTML = "";
            const fragment = document.createDocumentFragment();
            const treeRoot = normalizePath(state.browserDir || getSaveBrowserRootDir(), true);
            const rootHasCache = Boolean(getCachedSaveEntries(treeRoot));

            addSaveCurrentDirectoryNode(fragment);
            const rootResult = appendSaveTreeChildren(treeRoot, fragment, []);
            if (settings.loading && !rootHasCache && rootResult.count === 0) {
                const loadingItem = document.createElement("li");
                loadingItem.className = "handrive-save-folder-empty";
                loadingItem.textContent = t("js_loading_folders", "폴더를 불러오는 중...");
                fragment.appendChild(loadingItem);
                saveFolderList.appendChild(fragment);
                return;
            }
            if (rootResult.count === 0) {
                const emptyItem = document.createElement("li");
                emptyItem.className = "handrive-save-folder-empty";
                emptyItem.textContent = t("js_no_save_targets", "하위 폴더나 덮어쓸 파일이 없습니다.");
                fragment.appendChild(emptyItem);
                saveFolderList.appendChild(fragment);
                return;
            }

            saveFolderList.appendChild(fragment);
        }

        function renderBrowser() {
            if (!saveModal || saveModal.hidden) {
                return;
            }
            renderBreadcrumb();
            const renderToken = state.browserRenderToken + 1;
            state.browserRenderToken = renderToken;
            renderFolderList({ loading: !getCachedSaveEntries(state.browserDir) && Boolean(listApiUrl) });
            ensureExpandedSaveDirectoriesLoaded()
                .then(function () {
                    if (state.browserRenderToken !== renderToken || !saveModal || saveModal.hidden) {
                        return;
                    }
                    renderBreadcrumb();
                    renderFolderList();
                })
                .catch(function (error) {
                    if (state.browserRenderToken !== renderToken || !saveFolderList) {
                        return;
                    }
                    saveFolderList.innerHTML = "";
                    const errorItem = document.createElement("li");
                    errorItem.className = "handrive-save-folder-empty";
                    errorItem.textContent = error && error.message
                        ? error.message
                        : t("js_error_request_failed", "요청 처리 중 오류가 발생했습니다.");
                    saveFolderList.appendChild(errorItem);
                });
        }

        function getHandrivePathLabel(pathValue) {
            const normalized = normalizePath(pathValue || scopedHomeDir || "", true);
            const label = formatNavigationPathLabel(normalized, {
                buildBreadcrumbItems: buildWriteBreadcrumbItems,
                emptyLabel: isSuperuser ? effectiveRootLabel : getSaveBrowserRootLabel(),
                leadingSlash: false,
                normalizePath: normalizePath,
            });
            return label || getWritablePathLabel(normalized) || (isSuperuser ? effectiveRootLabel : "");
        }

        function getFolderCreateBasePath() {
            return normalizeDirectoryInput();
        }

        function setFolderModalOpen(opened) {
            if (!folderModal) {
                return;
            }
            folderModal.hidden = !opened;
            if (opened) {
                const basePath = getFolderCreateBasePath();
                if (folderTargetPath) {
                    folderTargetPath.textContent = getHandrivePathLabel(basePath);
                }
                if (folderNameInput) {
                    folderNameInput.value = "";
                    folderNameInput.focus();
                    folderNameInput.select();
                }
            }
        }

        function syncModalBodyState() {
            syncHandriveModalBodyState();
        }

        function setMarkdownHelpModalOpen(opened) {
            if (!markdownHelpModal) {
                return;
            }
            markdownHelpModal.hidden = !opened;
            syncModalBodyState();
        }

        function setMarkdownPreviewModalOpen(opened) {
            if (!markdownPreviewModal) {
                return;
            }
            markdownPreviewModal.hidden = !opened;
            syncModalBodyState();
        }

        async function openMarkdownPreviewModal() {
            if (!markdownPreviewModal || !markdownPreviewContent) {
                return;
            }

            applyHandriveRenderedContentModeClass(markdownPreviewContent, "plain_text", "handrive-plain-text");
            markdownPreviewContent.innerHTML = "<p>" + t("markdown_preview_loading", "Loading preview...") + "</p>";
            setMarkdownPreviewModalOpen(true);

            if (!previewApiUrl) {
                markdownPreviewContent.innerHTML = "<p>" + t("js_error_request_failed", "요청 처리 중 오류가 발생했습니다.") + "</p>";
                return;
            }

            try {
                let previewExtension = getPathFileExtension(originalPath) || DOCS_DEFAULT_EXTENSION;
                if (!originalPath && saveFilenameInput) {
                    const parsed = parseFileNameWithExtension(saveFilenameInput.value);
                    if (parsed.extension) {
                        previewExtension = parsed.extension;
                    } else if (saveExtensionSelect) {
                        previewExtension = getSelectedExtensionOrDefault();
                    }
                }
                const data = await requestJson(
                    previewApiUrl,
                    buildPostOptions({
                        original_path: originalPath,
                        target_dir: normalizePath(initialDir, true),
                        extension: previewExtension,
                        content: contentInput ? contentInput.value : "",
                    })
                );
                const renderMode = data && (data.render_mode === "markdown" || data.render_mode === "office")
                    ? data.render_mode
                    : "plain_text";
                const renderClass = data && typeof data.render_class === "string" ? data.render_class : "";
                applyHandriveRenderedContentModeClass(markdownPreviewContent, renderMode, renderClass);
                markdownPreviewContent.innerHTML = data && typeof data.html === "string" ? data.html : "";
                applyHandriveCodeHighlighting(markdownPreviewContent, renderClass || "ui-markdown");
                renderHandriveMermaidDiagrams(markdownPreviewContent).catch(alertError);
            } catch (error) {
                applyHandriveRenderedContentModeClass(markdownPreviewContent, "plain_text", "handrive-plain-text");
                markdownPreviewContent.innerHTML =
                    "<p>" +
                    (error && error.message ? error.message : t("js_error_processing_failed", "처리 중 오류가 발생했습니다.")) +
                    "</p>";
            }
        }

        function setSaveModalOpen(opened) {
            if (!saveModal) {
                return;
            }
            saveModal.hidden = !opened;
            syncModalBodyState();

            if (!opened) {
                setSaveModalSaving(false);
                setFolderModalOpen(false);
                return;
            }

            let modalInitialDir = "";
            try {
                modalInitialDir = normalizeDirectoryInput();
            } catch (error) {
                modalInitialDir = "";
            }
            if (!modalInitialDir) {
                modalInitialDir = normalizePath(initialDir, true) || (isSuperuser ? "" : scopedHomeDir);
            }
            if (!hasDirectory(modalInitialDir)) {
                modalInitialDir = getNearestWritableDirectory(modalInitialDir || initialDir);
            }
            const parsedMainFilename = parseFileNameWithExtension(filenameInput ? filenameInput.value : "");
            const extensionCandidate = parsedMainFilename.extension || getPathFileExtension(originalPath) || DOCS_DEFAULT_EXTENSION;
            syncExtensionSelectFromValue(extensionCandidate);
            const filenameCandidate = String(parsedMainFilename.filename || "").trim();

            if (saveFilenameInput) {
                saveFilenameInput.value = buildFilenameWithExtension(filenameCandidate, extensionCandidate);
            }

            state.selectedOverwritePath = "";
            state.browserDir = getSaveTreeRootForPath(modalInitialDir);
            state.expandedSaveDirs = new Set();
            updateSelectedDir(modalInitialDir);
            expandSaveTreeToPath(modalInitialDir);
            syncOriginalSaveSelectionFromFilename({ force: true });
            renderBrowser();
            ensureSaveTreePathLoaded(state.selectedDir || modalInitialDir)
                .then(function () {
                    if (!saveModal || saveModal.hidden) {
                        return;
                    }
                    renderBrowser();
                })
                .catch(alertError);

            if (saveFilenameInput) {
                saveFilenameInput.focus();
                saveFilenameInput.select();
            }
        }

        function submitMediaEditorSave(options) {
            const settings = options || {};
            const redirectOnSuccess = settings.redirectOnSuccess !== false;
            const onSuccess = typeof settings.onSuccess === "function" ? settings.onSuccess : null;
            const editor = getActiveWriteMediaEditor();
            const saveUrl = getActiveWriteMediaSaveUrl();
            if (!isMediaWriteEditor || !editor || typeof editor.saveToServer !== "function") {
                alertError(new Error(t("js_preview_unavailable", "미리보기를 표시할 수 없습니다.")));
                return;
            }
            if (!saveUrl || !originalPath) {
                alertError(new Error(t("js_request_failed", "요청 처리 중 오류가 발생했습니다.")));
                return;
            }

            const csrfToken = getCsrfToken();
            const savingText = writeEditorKind === "image"
                ? t("image_editor_saving", "저장 중...")
                : writeEditorKind === "video"
                    ? t("video_editor_saving", "저장 중...")
                    : writeEditorKind === "pdf"
                        ? t("pdf_editor_saving", "저장 중...")
                        : t("audio_editor_saving", "저장 중...");
            const originalButtonLabel = getButtonActionLabel(saveButton);
            if (saveButton) {
                saveButton.disabled = true;
                setButtonActionLabel(saveButton, savingText);
            }

            const mediaFilename = getWriteMediaFilenameValue();
            const originalMediaFilename = getWriteMediaOriginalFilename();
            const editorIsDirty = typeof editor.getIsDirty === "function" ? editor.getIsDirty() : true;
            if (!mediaFilename) {
                alertError(new Error(t("js_filename_required", "파일명을 입력해주세요.")));
                if (saveButton) {
                    saveButton.disabled = false;
                    setButtonActionLabel(saveButton, originalButtonLabel);
                }
                return;
            }
            if (!editorIsDirty && mediaFilename === originalMediaFilename) {
                if (saveButton) {
                    saveButton.disabled = false;
                    setButtonActionLabel(saveButton, originalButtonLabel);
                }
                markCurrentAsSaved();
                return;
            }

            let mediaSaveTarget;
            try {
                mediaSaveTarget = resolveWriteMediaSaveTarget(mediaFilename, editor);
            } catch (error) {
                alertError(error);
                if (saveButton) {
                    saveButton.disabled = false;
                    setButtonActionLabel(saveButton, originalButtonLabel);
                }
                return;
            }

            (async function () {
                const overwriteConfirmed = await confirmWriteOverwriteIfNeeded(mediaSaveTarget.targetPath);
                if (!overwriteConfirmed) {
                    if (saveButton) {
                        saveButton.disabled = false;
                        setButtonActionLabel(saveButton, originalButtonLabel);
                    }
                    return;
                }

                editor.saveToServer(saveUrl, csrfToken, originalPath, function (result) {
                    if (saveButton) {
                        saveButton.disabled = false;
                        setButtonActionLabel(saveButton, originalButtonLabel);
                        saveButton.classList.toggle("is-dirty", hasUnsavedMediaWriteChanges());
                    }
                    if (!result || !result.ok) {
                        const fallbackMessage = writeEditorKind === "image"
                            ? t("image_editor_save_error", "저장 실패")
                            : writeEditorKind === "video"
                                ? t("video_editor_save_error", "비디오 저장 실패")
                                : writeEditorKind === "pdf"
                                    ? t("pdf_editor_save_error", "PDF 저장 실패")
                                    : t("audio_editor_save_error", "오디오 저장 실패");
                        alertError(new Error(selectServerMessage(result, fallbackMessage)));
                        return;
                    }
                    markCurrentAsSaved();
                    if (onSuccess) {
                        onSuccess(result || {});
                        return;
                    }
                    if (!redirectOnSuccess) {
                        return;
                    }
                    const targetPath = (result && (result.slug_path || result.path)) || originalPath;
                    runWithBeforeUnloadBypass(function () {
                        window.location.href = buildViewUrl(handriveBaseUrl, targetPath);
                    });
                }, { filename: mediaFilename });
            })().catch(function (error) {
                if (saveButton) {
                    saveButton.disabled = false;
                    setButtonActionLabel(saveButton, originalButtonLabel);
                    saveButton.classList.toggle("is-dirty", hasUnsavedMediaWriteChanges());
                }
                alertError(error);
            });
        }

        async function submitSave(options) {
            const settings = options || {};
            const redirectOnSuccess = settings.redirectOnSuccess !== false;
            const onSuccess = typeof settings.onSuccess === "function" ? settings.onSuccess : null;

            let finalFilename = String(filenameInput ? filenameInput.value : "").trim();
            let targetExtension = DOCS_DEFAULT_EXTENSION;
            let targetDir = "";
            if (isPublicWriteDirectSave && originalPath) {
                targetDir = getParentPath(originalPath);
                finalFilename = getPathFileStem(originalPath) || finalFilename;
                targetExtension = getPathFileExtension(originalPath) || DOCS_DEFAULT_EXTENSION;
            } else {
                try {
                    targetDir = normalizeDirectoryInput();
                    if (saveModal && !saveModal.hidden && saveFilenameInput) {
                        const saveTarget = getSaveModalFilenameAndExtension();
                        finalFilename = saveTarget.filename;
                        targetExtension = saveTarget.extension;
                    } else {
                        if (!finalFilename) {
                            throw new Error(t("js_filename_required", "파일명을 입력해주세요."));
                        }
                        targetExtension = getSelectedExtensionOrDefault();
                    }
                } catch (error) {
                    alertError(error);
                    return;
                }
            }

            if (!isPublicWriteDirectSave && !hasDirectory(targetDir)) {
                window.alert(
                    t("js_select_or_create_folder", "저장 위치를 선택하거나 폴더를 먼저 생성해주세요.")
                );
                return;
            }

            upsertDirectory(targetDir);
            if (filenameInput) {
                filenameInput.value = finalFilename;
            }
            if (saveFilenameInput) {
                saveFilenameInput.value = buildFilenameWithExtension(finalFilename, targetExtension);
            }

            let keepSaveLoading = false;
            try {
                const requestOriginalPath = getSaveRequestOriginalPath(targetDir, finalFilename, targetExtension);
                const saveTargetPath = buildSaveTargetPath(targetDir, finalFilename, targetExtension);
                const payload = {
                    original_path: requestOriginalPath,
                    target_dir: targetDir,
                    filename: finalFilename,
                    extension: targetExtension,
                    content: contentInput ? contentInput.value : ""
                };
                const overwriteConfirmed = await confirmWriteOverwriteIfNeeded(saveTargetPath);
                if (!overwriteConfirmed) {
                    return;
                }
                if (writeRequiresCommitMessage) {
                    const commitMessage = await promptWriteCommitMessage(requestOriginalPath || saveTargetPath || targetDir);
                    if (commitMessage === null) {
                        return;
                    }
                    payload.commit_message = commitMessage;
                }
                setSaveModalSaving(true);
                const data = await requestJson(saveApiUrl, buildPostOptions(payload));
                writeMarkdownUploadedImagePaths = [];
                markCurrentAsSaved();

                if ((onSuccess || !redirectOnSuccess) && saveModal && !saveModal.hidden) {
                    setSaveModalOpen(false);
                }

                if (onSuccess) {
                    onSuccess(data || {});
                    return data || {};
                }

                if (!redirectOnSuccess) {
                    return data || {};
                }

                if (data && data.slug_path) {
                    keepSaveLoading = Boolean(saveModal && !saveModal.hidden);
                    runWithBeforeUnloadBypass(function () {
                        window.location.href = buildViewUrl(handriveBaseUrl, data.slug_path);
                    });
                    return data || {};
                }
                keepSaveLoading = Boolean(saveModal && !saveModal.hidden);
                runWithBeforeUnloadBypass(function () {
                    window.location.href = handriveRootUrl;
                });
                return data || {};
            } catch (error) {
                alertError(error);
            } finally {
                if (!keepSaveLoading) {
                    setSaveModalSaving(false);
                }
            }
        }

        rawDirectories.forEach(function (pathValue) {
            const normalized = upsertDirectory(pathValue);
            if (!normalized) {
                return;
            }
            const parts = normalized.split("/").filter(Boolean);
            const accumulated = [];
            parts.forEach(function (part) {
                accumulated.push(part);
                upsertDirectory(accumulated.join("/"));
            });
        });
        if (isSuperuser) {
            upsertDirectory("");
        }
        upsertDirectory(initialDir || "");
        renderDirectoryOptions();
        if (saveExtensionSelect) {
            const initialExtension = getPathFileExtension(originalPath) || DOCS_DEFAULT_EXTENSION;
            syncExtensionSelectFromValue(initialExtension);
        }
        syncMarkdownHelpButtonVisibility();
        showWriteMediaSurface().catch(alertError);
        scheduleWriteEditorHorizontalScrollReset();

        async function createFolderFromModal() {
            const folderName = folderNameInput ? folderNameInput.value : "";
            const trimmed = String(folderName || "").trim();
            if (!trimmed) {
                window.alert(t("js_folder_name_required", "폴더 이름을 입력해주세요."));
                return;
            }

            const parentDir = getFolderCreateBasePath();
            if (!hasDirectory(parentDir)) {
                window.alert(
                    t("js_invalid_selected_path", "선택 경로가 유효하지 않습니다. 목록에서 폴더를 선택해주세요.")
                );
                return;
            }

            try {
                var commitMessage = "";
                if (writeRequiresCommitMessage) {
                    commitMessage = await promptWriteCommitMessage(parentDir);
                    if (commitMessage === null) {
                        return;
                    }
                }
                const data = await requestJson(
                    mkdirApiUrl,
                    buildPostOptions({
                        parent_dir: parentDir,
                        folder_name: trimmed,
                        commit_message: commitMessage
                    })
                );
                const createdPath = upsertDirectory(data.path || "");
                invalidateSaveDirectory(parentDir);
                renderDirectoryOptions();
                updateSelectedDir(createdPath);
                expandSaveTreeToPath(parentDir);
                renderBrowser();
                setFolderModalOpen(false);
            } catch (error) {
                alertError(error);
            }
        }

        if (createFolderButton) {
            createFolderButton.addEventListener("click", function () {
                setFolderModalOpen(true);
            });
        }

        if (saveButton) {
            saveButton.addEventListener("click", function () {
                if (isMediaWriteEditor) {
                    submitMediaEditorSave();
                    return;
                }
                if (isPublicWriteDirectSave) {
                    submitSave();
                    return;
                }
                if (saveModal) {
                    setSaveModalOpen(true);
                    return;
                }
                submitSave();
            });
        }

        if (cancelButton) {
            cancelButton.addEventListener("click", function () {
                const targetDir = getCancelTargetDirectory();
                attemptLeaveWithUnsavedGuard(function () {
                    cleanupWriteMarkdownUploadedImages()
                        .catch(alertError)
                        .finally(function () {
                            bypassUnsavedBeforeUnload = true;
                            window.location.assign(buildListUrl(handriveBaseUrl, targetDir, handriveRootUrl));
                        });
                });
            });
        }

        if (saveExtensionSelect && saveFilenameInput) {
            saveExtensionSelect.addEventListener("change", function () {
                const selectedValue = String(saveExtensionSelect.value || "").trim().toLowerCase();
                let selectedExtension = DOCS_DEFAULT_EXTENSION;
                if (selectedValue === DOCS_CUSTOM_EXTENSION_OPTION_VALUE) {
                    const parsedCurrent = parseFileNameWithExtension(saveFilenameInput.value);
                    if (parsedCurrent.extension) {
                        customExtensionValue = parsedCurrent.extension;
                    }
                    try {
                        selectedExtension = getSelectedExtensionOrDefault();
                    } catch (error) {
                        selectedExtension = DOCS_DEFAULT_EXTENSION;
                    }
                } else {
                    try {
                        selectedExtension = getSelectedExtensionOrDefault();
                    } catch (error) {
                        alertError(error);
                        return;
                    }
                }

                const parsed = parseFileNameWithExtension(saveFilenameInput.value);
                const baseName = parsed.filename || String(filenameInput ? filenameInput.value : "").trim();
                saveFilenameInput.value = buildFilenameWithExtension(baseName, selectedExtension);
                state.selectedOverwritePath = "";
                saveFilenameInput.focus();
                syncMarkdownHelpButtonVisibility();
                if (saveModal && !saveModal.hidden) {
                    syncOriginalSaveSelectionFromFilename();
                    renderBrowser();
                }
            });

            saveFilenameInput.addEventListener("input", function () {
                state.selectedOverwritePath = "";
                try {
                    const parsed = parseFileNameWithExtension(saveFilenameInput.value);
                    if (parsed.extension && extensionPresetSet.has(parsed.extension)) {
                        saveExtensionSelect.value = parsed.extension;
                        if (saveModal && !saveModal.hidden) {
                            syncOriginalSaveSelectionFromFilename();
                            renderBrowser();
                        }
                        return;
                    }
                    if (parsed.extension) {
                        customExtensionValue = parsed.extension;
                        if (saveExtensionSelect.querySelector('option[value="' + DOCS_CUSTOM_EXTENSION_OPTION_VALUE + '"]')) {
                            saveExtensionSelect.value = DOCS_CUSTOM_EXTENSION_OPTION_VALUE;
                        }
                    }
                } catch (error) {
                    // Ignore extension auto-sync errors while typing.
                }
                if (saveModal && !saveModal.hidden) {
                    syncOriginalSaveSelectionFromFilename();
                    renderBrowser();
                }
            });
        }

        if (filenameInput) {
            const refreshMarkdownButtonVisibility = function () {
                syncMarkdownHelpButtonVisibility();
            };
            filenameInput.addEventListener("input", refreshMarkdownButtonVisibility);
            filenameInput.addEventListener("change", refreshMarkdownButtonVisibility);
        }

        if (contentInput) {
            contentInput.addEventListener("paste", function (event) {
                writeMarkdownImageInput.handlePaste(event);
            });
            contentInput.addEventListener("dragover", function (event) {
                writeMarkdownImageInput.handleDragOver(event);
            });
            contentInput.addEventListener("drop", function (event) {
                writeMarkdownImageInput.handleDrop(event);
            });
            contentInput.addEventListener("input", function () {
                renderWriteEditorHighlight();
                updateEditorSuggestion();
                recordWriteEditorSnapshot();
            });
            contentInput.addEventListener("scroll", syncEditorHighlightScroll, { passive: true });
            let editorFontSize = 16;
            contentInput.addEventListener("wheel", function (event) {
                if (!event.ctrlKey && !event.metaKey) return;
                event.preventDefault();
                const delta = event.deltaY < 0 ? 2 : -2;
                editorFontSize = Math.max(8, Math.min(40, editorFontSize + delta));
                contentInput.style.fontSize = editorFontSize + "px";
                if (editorHighlight) {
                    editorHighlight.style.fontSize = editorFontSize + "px";
                }
                syncEditorHighlightScroll();
            }, { passive: false });
            contentInput.addEventListener("click", function () {
                clearEditorSuggestion();
            });
            contentInput.addEventListener("keydown", function (event) {
                const loweredKey = String(event.key || "").toLowerCase();
                if ((event.metaKey || event.ctrlKey) && !event.altKey && loweredKey === "z") {
                    event.preventDefault();
                    if (event.shiftKey) {
                        redoWriteEditorChange();
                    } else {
                        undoWriteEditorChange();
                    }
                    return;
                }
                if ((event.metaKey || event.ctrlKey) && !event.altKey && loweredKey === "y") {
                    event.preventDefault();
                    redoWriteEditorChange();
                    return;
                }
                if ((event.metaKey || event.ctrlKey) && !event.altKey && loweredKey === "s") {
                    event.preventDefault();
                    if (saveButton && !saveButton.disabled) {
                        saveButton.click();
                    }
                    return;
                }
                if (event.key === "Escape") {
                    clearEditorSuggestion();
                    return;
                }
                if (!editorSuggest.hidden && event.key === "ArrowDown") {
                    event.preventDefault();
                    moveWriteEditorSuggestion(1);
                    return;
                }
                if (!editorSuggest.hidden && event.key === "ArrowUp") {
                    event.preventDefault();
                    moveWriteEditorSuggestion(-1);
                    return;
                }
                if (!editorSuggest.hidden && event.key === "Enter") {
                    if (acceptEditorSuggestion()) {
                        event.preventDefault();
                    }
                    return;
                }
                if (event.key !== "Tab" || event.shiftKey) {
                    return;
                }
                if (acceptEditorSuggestion()) {
                    event.preventDefault();
                    return;
                }
                event.preventDefault();
                replaceTextareaSelection("    ", 4, 4);
                return;
            });
            contentInput.addEventListener("keydown", function (event) {
                if (
                    event.key === "ArrowLeft" ||
                    event.key === "ArrowRight" ||
                    event.key === "Home" ||
                    event.key === "End" ||
                    event.key === "PageUp" ||
                    event.key === "PageDown"
                ) {
                    clearEditorSuggestion();
                }
            });
        }

        if (editorSuggest && !writeSuggestEventsBound) {
            writeSuggestEventsBound = true;
            editorSuggest.addEventListener("mousedown", function (event) {
                event.preventDefault();
            });
            editorSuggest.addEventListener("click", function (event) {
                const target = event.target instanceof Element
                    ? event.target.closest("[data-suggest-index]")
                    : null;
                if (!target) {
                    return;
                }
                const index = Number(target.getAttribute("data-suggest-index"));
                if (!Number.isInteger(index)) {
                    return;
                }
                activeEditorSuggestionIndex = index;
                if (acceptEditorSuggestion()) {
                    event.preventDefault();
                }
            });
        }

        if (markdownHelpButton) {
            markdownHelpButton.addEventListener("click", function () {
                setMarkdownHelpModalOpen(true);
            });
            markdownHelpButton.addEventListener("mouseup", function (event) {
                if (event.currentTarget && typeof event.currentTarget.blur === "function") {
                    event.currentTarget.blur();
                }
            });
        }

        if (markdownPreviewButton) {
            markdownPreviewButton.addEventListener("click", function () {
                openMarkdownPreviewModal();
            });
            markdownPreviewButton.addEventListener("mouseup", function (event) {
                if (event.currentTarget && typeof event.currentTarget.blur === "function") {
                    event.currentTarget.blur();
                }
            });
        }

        markdownSnippetButtons.forEach(function (button) {
            button.addEventListener("click", function () {
                const snippetType = button.getAttribute("data-editor-snippet") || "";
                const currentExtension = getCurrentEditorExtension();
                if (currentExtension === DOCS_DEFAULT_EXTENSION) {
                    insertMarkdownSnippet(snippetType);
                } else if (!insertLanguageSnippet(snippetType, currentExtension)) {
                    insertMarkdownSnippet(snippetType);
                }
                closeMarkdownSnippetMenu();
            });
        });

        if (editorSurface) {
            editorSurface.addEventListener("contextmenu", function (event) {
                const currentExtension = getCurrentEditorExtension();
                if (currentExtension !== DOCS_DEFAULT_EXTENSION) {
                    closeMarkdownSnippetMenu();
                    return;
                }
                const visibleCount = syncSnippetMenuItemsByExtension(currentExtension);
                if (visibleCount <= 0) {
                    closeMarkdownSnippetMenu();
                    return;
                }
                event.preventDefault();
                openMarkdownSnippetMenu(event.clientX, event.clientY);
            });
        }

        if (markdownHelpBackdrop) {
            markdownHelpBackdrop.addEventListener("click", function () {
                setMarkdownHelpModalOpen(false);
            });
        }

        if (markdownPreviewBackdrop) {
            markdownPreviewBackdrop.addEventListener("click", function () {
                setMarkdownPreviewModalOpen(false);
            });
        }

        if (unsavedModalBackdrop) {
            unsavedModalBackdrop.addEventListener("click", function () {
                closeUnsavedModal("cancel");
            });
        }

        if (unsavedCancelButton) {
            unsavedCancelButton.addEventListener("click", function () {
                closeUnsavedModal("leave");
            });
        }

        if (unsavedCloseButton) {
            unsavedCloseButton.addEventListener("click", function () {
                closeUnsavedModal("cancel");
            });
        }

        if (unsavedSaveButton) {
            unsavedSaveButton.addEventListener("click", function () {
                closeUnsavedModal("save");
            });
        }

        if (saveModalBackdrop) {
            saveModalBackdrop.addEventListener("click", function () {
                if (state.isSaving) {
                    return;
                }
                pendingSaveThenLeaveAction = null;
                setSaveModalOpen(false);
            });
        }

        if (saveCloseButton) {
            saveCloseButton.addEventListener("click", function () {
                if (state.isSaving) {
                    return;
                }
                pendingSaveThenLeaveAction = null;
                setSaveModalOpen(false);
            });
        }

        if (saveCancelButton) {
            saveCancelButton.addEventListener("click", function () {
                if (state.isSaving) {
                    return;
                }
                pendingSaveThenLeaveAction = null;
                setSaveModalOpen(false);
            });
        }

        if (saveConfirmButton) {
            saveConfirmButton.addEventListener("click", function () {
                if (state.isSaving) {
                    return;
                }
                if (pendingSaveThenLeaveAction) {
                    submitSaveThenLeave();
                    return;
                }
                if (isMediaWriteEditor) {
                    submitMediaEditorSave();
                    return;
                }
                submitSave();
            });
        }

        if (folderModalBackdrop) {
            folderModalBackdrop.addEventListener("click", function () {
                setFolderModalOpen(false);
            });
        }

        if (folderCancelButton) {
            folderCancelButton.addEventListener("click", function () {
                setFolderModalOpen(false);
            });
        }

        if (folderCreateButton) {
            folderCreateButton.addEventListener("click", function () {
                createFolderFromModal();
            });
        }

        if (folderNameInput) {
            folderNameInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    createFolderFromModal();
                }
            });
        }

        document.addEventListener("keydown", function (event) {
            if (event.key !== "Escape") {
                return;
            }
            if (unsavedModal && !unsavedModal.hidden) {
                closeUnsavedModal("cancel");
                return;
            }
            if (markdownSnippetMenu && !markdownSnippetMenu.hidden) {
                closeMarkdownSnippetMenu();
                return;
            }
            if (markdownPreviewModal && !markdownPreviewModal.hidden) {
                setMarkdownPreviewModalOpen(false);
                return;
            }
            if (markdownHelpModal && !markdownHelpModal.hidden) {
                setMarkdownHelpModalOpen(false);
                return;
            }
            if (folderModal && !folderModal.hidden) {
                setFolderModalOpen(false);
                return;
            }
            if (saveModal && !saveModal.hidden) {
                setSaveModalOpen(false);
                return;
            }
        });

        window.addEventListener("beforeunload", function (event) {
            if (bypassUnsavedBeforeUnload || !hasUnsavedWriteChanges()) {
                return;
            }
            event.preventDefault();
            event.returnValue = "";
        });

        document.addEventListener("click", function (event) {
            if (event.defaultPrevented || !hasUnsavedWriteChanges()) {
                return;
            }
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                return;
            }
            if (!(event.target instanceof Element)) {
                return;
            }

            const anchor = event.target.closest("a[href]");
            if (!anchor) {
                return;
            }
            if (anchor.hasAttribute("download")) {
                return;
            }

            const targetAttr = String(anchor.getAttribute("target") || "").toLowerCase();
            if (targetAttr && targetAttr !== "_self") {
                return;
            }

            const hrefAttr = String(anchor.getAttribute("href") || "").trim();
            if (!hrefAttr || hrefAttr === "#" || hrefAttr.startsWith("javascript:")) {
                return;
            }

            if (hrefAttr.startsWith("#")) {
                return;
            }

            event.preventDefault();
            attemptLeaveWithUnsavedGuard(function () {
                window.location.assign(anchor.href);
            });
        }, true);

        document.addEventListener("mousedown", function (event) {
            if (!markdownSnippetMenu || markdownSnippetMenu.hidden) {
                return;
            }
            if (event.target instanceof Element && markdownSnippetMenu.contains(event.target)) {
                return;
            }
            closeMarkdownSnippetMenu();
        });

        document.addEventListener("submit", function (event) {
            if (event.defaultPrevented) {
                return;
            }
            if (!(event.target instanceof HTMLFormElement)) {
                return;
            }
            const form = event.target;
            if (form.hasAttribute("data-bypass-unsaved-guard")) {
                return;
            }
            if (!hasUnsavedWriteChanges()) {
                return;
            }
            event.preventDefault();
            attemptLeaveWithUnsavedGuard(function () {
                form.submit();
            });
        }, true);

        document.addEventListener("keydown", function (event) {
            const key = String(event.key || "");
            const loweredKey = key.toLowerCase();
            const isReloadHotkey = key === "F5" || ((event.metaKey || event.ctrlKey) && loweredKey === "r");
            if (!isReloadHotkey || !hasUnsavedWriteChanges()) {
                return;
            }
            event.preventDefault();
            attemptLeaveWithUnsavedGuard(function () {
                window.location.reload();
            });
        }, true);

        window.addEventListener("resize", scheduleContentInputAutoHeight, { passive: true });
        window.addEventListener("orientationchange", scheduleContentInputAutoHeight, { passive: true });
        window.addEventListener("scroll", closeMarkdownSnippetMenu, { passive: true });
        window.addEventListener("resize", closeMarkdownSnippetMenu, { passive: true });

        if (window.visualViewport) {
            window.visualViewport.addEventListener("resize", scheduleContentInputAutoHeight, { passive: true });
            window.visualViewport.addEventListener("scroll", scheduleContentInputAutoHeight, { passive: true });
        }

        if (window.ResizeObserver) {
            const autoHeightObserver = new ResizeObserver(scheduleContentInputAutoHeight);
            autoHeightObserver.observe(root);
            const toolbarWrap = document.querySelector(".handrive-toolbar-wrap");
            if (toolbarWrap) {
                autoHeightObserver.observe(toolbarWrap);
            }
        }

        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(scheduleContentInputAutoHeight).catch(function () {});
        }

        scheduleContentInputAutoHeight();
        renderWriteEditorHighlight();
    }

    initializeHandriveAuthInteraction();
    initializeHandrivePageHelpModal();
    initializeHandriveToolbarAutoCollapse();
    initializeHandriveBreadcrumbOverflow();

    if (pageType === "list") {
        initializeListPage();
        return;
    }

    if (pageType === "view") {
        initializeViewPage();
        return;
    }

    if (pageType === "write") {
        initializeWritePage();
    }
})();
