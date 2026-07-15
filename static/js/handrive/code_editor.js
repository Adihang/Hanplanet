(function () {
    "use strict";

    const adapters = new WeakMap();
    const MODE_BY_EXTENSION = {
        ".cjs": "javascript",
        ".css": "css",
        ".htm": "html",
        ".html": "html",
        ".js": "javascript",
        ".json": "json",
        ".jsonc": "json",
        ".jsx": "javascript",
        ".md": "markdown",
        ".mjs": "javascript",
        ".py": "python",
        ".pyi": "python",
        ".sql": "sql",
        ".svg": "html",
        ".xml": "html",
    };
    const RENDER_CLASS_BY_MODE = {
        css: "handrive-css",
        html: "handrive-html",
        javascript: "handrive-js",
        json: "handrive-json",
        markdown: "ui-markdown",
        python: "handrive-py",
        sql: "handrive-sql",
    };
    let acePathsConfigured = false;

    function normalizeExtension(extension) {
        const value = String(extension || "").trim().toLowerCase();
        if (!value) {
            return "";
        }
        return value.charAt(0) === "." ? value : "." + value;
    }

    function resolveMode(extension) {
        return MODE_BY_EXTENSION[normalizeExtension(extension)] || "text";
    }

    function configureAcePaths() {
        if (acePathsConfigured || !window.ace || !window.ace.config) {
            return;
        }
        const script = document.querySelector("script[data-handrive-ace]");
        if (script && script.src) {
            const basePath = new URL(".", script.src).href.replace(/\/$/, "");
            window.ace.config.set("basePath", basePath);
            window.ace.config.set("modePath", basePath);
            window.ace.config.set("themePath", basePath);
            window.ace.config.set("workerPath", basePath);
        }
        acePathsConfigured = true;
    }

    function isDarkTheme() {
        return document.body.classList.contains("theme-dark")
            || document.documentElement.classList.contains("theme-dark");
    }

    function create(options) {
        const settings = options || {};
        const surface = settings.surface;
        const textarea = settings.textarea;
        if (
            !surface
            || !textarea
            || !window.ace
            || typeof window.ace.edit !== "function"
            || !window.HandriveCodeStructure
        ) {
            return null;
        }
        if (adapters.has(textarea)) {
            return adapters.get(textarea);
        }

        configureAcePaths();
        const host = document.createElement("div");
        host.className = "handrive-code-editor";
        host.setAttribute(
            "aria-label",
            document.documentElement.lang === "en" ? "File content editor" : "파일 내용 편집기",
        );
        surface.insertBefore(host, surface.firstChild);
        surface.classList.add("is-ace-active");
        textarea.classList.add("handrive-code-editor-source");
        const mirror = surface.querySelector(":scope > .handrive-editor-highlight");
        if (mirror) {
            mirror.classList.add("handrive-code-editor-mirror");
        }

        const editor = window.ace.edit(host);
        const indentGuides = document.createElement("div");
        indentGuides.className = "handrive-ace-indent-guides";
        indentGuides.hidden = true;
        host.appendChild(indentGuides);
        const foldControls = document.createElement("div");
        foldControls.className = "handrive-ace-fold-controls";
        foldControls.hidden = true;
        host.appendChild(foldControls);
        const Range = window.ace.require("ace/range").Range;
        const session = editor.getSession();
        let syncingFromEditor = false;
        let applyingTextareaValue = false;
        let editorInputSyncScheduled = false;
        let currentMode = "";
        let currentTheme = "";
        let codeStructureFrame = 0;
        let codeFoldSyncFrame = 0;
        let applyingCodeFolds = false;
        const collapsedFoldStarts = new Set();
        const codeStructure = window.HandriveCodeStructure;

        session.setUseWorker(false);
        session.setTabSize(4);
        session.setUseSoftTabs(true);
        session.setFoldStyle("markbeginend");
        editor.setOptions({
            animatedScroll: false,
            behavioursEnabled: true,
            displayIndentGuides: false,
            enableKeyboardAccessibility: true,
            fadeFoldWidgets: false,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
            fontSize: "16px",
            highlightActiveLine: true,
            highlightGutterLine: true,
            placeholder: textarea.getAttribute("placeholder") || "",
            scrollPastEnd: 0.15,
            showFoldWidgets: false,
            showGutter: true,
            showLineNumbers: true,
            showPrintMargin: false,
            wrap: false,
        });
        syncEditorHorizontalPadding();
        editor.setValue(String(textarea.value || ""), -1);

        function getEditorFontSize() {
            return Math.max(1, parseFloat(editor.getOption("fontSize")) || 16);
        }

        function syncEditorHorizontalPadding() {
            editor.renderer.setPadding(getEditorFontSize() * 1.5);
        }

        function getCodeStructureState() {
            const lines = session.getDocument().getAllLines();
            const renderClass = RENDER_CLASS_BY_MODE[currentMode] || "";
            const indentSize = codeStructure.detectIndentSize(lines, renderClass);
            const allFoldRanges = codeStructure.buildFoldRanges(
                lines,
                indentSize,
                renderClass,
            );
            return {
                foldRanges: codeStructure.filterOutermostFoldRanges(allFoldRanges),
                guideColumns: codeStructure.getGuideColumns(
                    lines,
                    indentSize,
                    allFoldRanges,
                ),
                guideDepths: codeStructure.getGuideDepths(lines, indentSize),
                indentSize: indentSize,
                lines: lines,
            };
        }

        function applyCollapsedCodeFolds(foldRanges) {
            applyingCodeFolds = true;
            try {
                session.unfold();
                Array.from(collapsedFoldStarts)
                    .sort(function (left, right) { return right - left; })
                    .forEach(function (startRow) {
                        const foldRange = foldRanges.get(startRow);
                        if (!foldRange || foldRange.end >= session.getLength()) {
                            collapsedFoldStarts.delete(startRow);
                            return;
                        }
                        session.addFold(
                            "...",
                            new Range(
                                startRow,
                                session.getLine(startRow).length,
                                foldRange.end,
                                session.getLine(foldRange.end).length,
                            ),
                        );
                    });
            } finally {
                applyingCodeFolds = false;
            }
            editor.renderer.updateFull();
        }

        function clearCollapsedCodeFolds() {
            collapsedFoldStarts.clear();
            applyingCodeFolds = true;
            try {
                session.unfold();
            } finally {
                applyingCodeFolds = false;
            }
        }

        function collectSessionFoldStarts(folds, target) {
            (folds || []).forEach(function (fold) {
                if (fold && fold.start) {
                    target.add(fold.start.row);
                }
                collectSessionFoldStarts(fold && fold.subFolds, target);
            });
        }

        function scheduleCodeFoldStateSync() {
            if (applyingCodeFolds || codeFoldSyncFrame) {
                return;
            }
            codeFoldSyncFrame = window.requestAnimationFrame(function () {
                codeFoldSyncFrame = 0;
                const structureState = getCodeStructureState();
                const sessionFoldStarts = new Set();
                collectSessionFoldStarts(session.getAllFolds(), sessionFoldStarts);
                collapsedFoldStarts.clear();
                sessionFoldStarts.forEach(function (startRow) {
                    if (structureState.foldRanges.has(startRow)) {
                        collapsedFoldStarts.add(startRow);
                    }
                });
                applyCollapsedCodeFolds(structureState.foldRanges);
                scheduleCodeStructureOverlaysRender();
            });
        }

        function renderCodeStructureOverlays() {
            codeStructureFrame = 0;
            const isCodeMode = currentMode && currentMode !== "text";
            indentGuides.hidden = !isCodeMode;
            foldControls.hidden = !isCodeMode;
            indentGuides.replaceChildren();
            foldControls.replaceChildren();
            if (!isCodeMode) {
                return;
            }

            const hostRect = host.getBoundingClientRect();
            const pageLeft = hostRect.left + (window.scrollX || window.pageXOffset || 0);
            const pageTop = hostRect.top + (window.scrollY || window.pageYOffset || 0);
            const layerConfig = editor.renderer.layerConfig || {};
            const firstRow = Math.max(0, Number(layerConfig.firstRow) || 0);
            const lastRow = Math.min(session.getLength() - 1, Number(layerConfig.lastRow) || firstRow);
            const lineHeight = Number(editor.renderer.lineHeight) || 20;
            const characterWidth = Number(editor.renderer.characterWidth) || 8;
            const fontSize = getEditorFontSize();
            foldControls.style.fontSize = fontSize + "px";
            const structureState = getCodeStructureState();
            const indentStep = characterWidth * structureState.indentSize;

            for (let row = firstRow; row <= lastRow; row += 1) {
                const foldLine = session.getFoldLine(row);
                if (foldLine && foldLine.start.row < row) {
                    continue;
                }
                const line = session.getLine(row);
                const rowPosition = editor.renderer.textToScreenCoordinates(row, 0);
                const guideColumns = structureState.guideColumns[row] || [];
                if (guideColumns.length) {
                    const guide = document.createElement("span");
                    guide.className = "handrive-ace-indent-guide-row";
                    guide.dataset.row = String(row);
                    guide.dataset.columns = guideColumns.join(",");
                    guide.style.left = (Number(rowPosition.pageX) - pageLeft) + "px";
                    guide.style.top = (Number(rowPosition.pageY) - pageTop) + "px";
                    guide.style.width = ((guideColumns[guideColumns.length - 1] + 1) * indentStep) + "px";
                    guide.style.height = (lineHeight + 1) + "px";
                    guideColumns.forEach(function (guideColumn) {
                        const lineGuide = document.createElement("span");
                        lineGuide.className = "handrive-ace-indent-guide";
                        lineGuide.style.left = (guideColumn * indentStep) + "px";
                        guide.appendChild(lineGuide);
                    });
                    indentGuides.appendChild(guide);
                }
                if (!structureState.foldRanges.has(row)) {
                    continue;
                }
                const leadingCharacters = (line.match(/^[\t ]*/) || [""])[0].length;
                const position = editor.renderer.textToScreenCoordinates(row, leadingCharacters);
                const isExpanded = !collapsedFoldStarts.has(row);
                const toggle = document.createElement("button");
                toggle.type = "button";
                toggle.className = "handrive-ace-fold-toggle";
                toggle.dataset.row = String(row);
                toggle.style.left = (
                    Number(position.pageX) - pageLeft - (fontSize * 0.875)
                ) + "px";
                toggle.style.top = (Number(position.pageY) - pageTop) + "px";
                toggle.style.height = lineHeight + "px";
                toggle.setAttribute("aria-expanded", isExpanded ? "true" : "false");
                toggle.setAttribute(
                    "aria-label",
                    document.documentElement.lang === "en"
                        ? (isExpanded ? "Fold code" : "Expand code")
                        : (isExpanded ? "코드 접기" : "코드 펼치기"),
                );
                toggle.title = toggle.getAttribute("aria-label");
                const toggleFold = function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (collapsedFoldStarts.has(row)) {
                        collapsedFoldStarts.delete(row);
                    } else {
                        collapsedFoldStarts.add(row);
                    }
                    applyCollapsedCodeFolds(structureState.foldRanges);
                    scheduleCodeStructureOverlaysRender();
                    window.requestAnimationFrame(function () {
                        const replacement = foldControls.querySelector(
                            '.handrive-ace-fold-toggle[data-row="' + row + '"]',
                        );
                        if (replacement) {
                            replacement.focus({ preventScroll: true });
                        }
                    });
                };
                if (!isExpanded) {
                    const visibleLineLength = line.replace(/\s+$/, "").length;
                    const lineEndPosition = editor.renderer.textToScreenCoordinates(
                        row,
                        visibleLineLength,
                    );
                    const ellipsis = document.createElement("button");
                    ellipsis.type = "button";
                    ellipsis.className = "handrive-ace-fold-ellipsis";
                    ellipsis.textContent = "...";
                    ellipsis.style.left = (Number(lineEndPosition.pageX) - pageLeft) + "px";
                    ellipsis.style.top = (
                        Number(rowPosition.pageY) - pageTop + ((lineHeight - (fontSize * 1.1)) / 2)
                    ) + "px";
                    ellipsis.setAttribute(
                        "aria-label",
                        document.documentElement.lang === "en" ? "Expand code" : "코드 펼치기",
                    );
                    ellipsis.title = ellipsis.getAttribute("aria-label");
                    ellipsis.addEventListener("mousedown", function (event) {
                        event.preventDefault();
                        event.stopPropagation();
                    });
                    ellipsis.addEventListener("click", toggleFold);
                    foldControls.appendChild(ellipsis);
                }
                toggle.addEventListener("mousedown", function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                });
                toggle.addEventListener("click", toggleFold);
                foldControls.appendChild(toggle);
            }
        }

        function scheduleCodeStructureOverlaysRender() {
            if (codeStructureFrame) {
                return;
            }
            codeStructureFrame = window.requestAnimationFrame(renderCodeStructureOverlays);
        }

        function syncTextareaSelection() {
            if (applyingTextareaValue) {
                return;
            }
            const range = editor.getSelectionRange();
            const documentModel = session.getDocument();
            textarea.selectionStart = documentModel.positionToIndex(range.start, 0);
            textarea.selectionEnd = documentModel.positionToIndex(range.end, 0);
            textarea.selectionDirection = editor.selection.isBackwards() ? "backward" : "forward";
        }

        function syncTextareaScroll() {
            textarea.scrollTop = Number(session.getScrollTop()) || 0;
            textarea.scrollLeft = Number(session.getScrollLeft()) || 0;
        }

        function syncEditorSelection() {
            const sourceLength = String(textarea.value || "").length;
            const selectionStart = Math.max(0, Math.min(sourceLength, Number(textarea.selectionStart) || 0));
            const selectionEnd = Math.max(0, Math.min(sourceLength, Number(textarea.selectionEnd) || 0));
            const documentModel = session.getDocument();
            const start = documentModel.indexToPosition(Math.min(selectionStart, selectionEnd), 0);
            const end = documentModel.indexToPosition(Math.max(selectionStart, selectionEnd), 0);
            editor.selection.setSelectionRange(
                new Range(start.row, start.column, end.row, end.column),
                textarea.selectionDirection === "backward",
            );
        }

        function syncFromTextarea(options) {
            const syncOptions = options || {};
            const nextValue = String(textarea.value || "");
            if (editor.getValue() !== nextValue) {
                applyingTextareaValue = true;
                session.setValue(nextValue);
                applyingTextareaValue = false;
            }
            syncEditorSelection();
            if (syncOptions.syncScroll !== false) {
                session.setScrollTop(Number(textarea.scrollTop) || 0);
                session.setScrollLeft(Number(textarea.scrollLeft) || 0);
            }
            if (syncOptions.focus) {
                editor.focus();
            }
            editor.resize(false);
        }

        function setTheme() {
            const nextTheme = isDarkTheme() ? "ace/theme/tomorrow_night" : "ace/theme/textmate";
            if (nextTheme === currentTheme) {
                return;
            }
            currentTheme = nextTheme;
            editor.setTheme(nextTheme);
        }

        function setExtension(extension) {
            const nextMode = resolveMode(extension);
            host.dataset.handriveSyntaxMode = nextMode;
            if (nextMode !== currentMode) {
                clearCollapsedCodeFolds();
                currentMode = nextMode;
                session.setMode("ace/mode/" + nextMode);
            }
            const isCodeMode = nextMode !== "text";
            editor.setOption("displayIndentGuides", false);
            editor.setOption("showFoldWidgets", false);
            scheduleCodeStructureOverlaysRender();
        }

        function scheduleTextareaInputSync() {
            if (applyingTextareaValue || editorInputSyncScheduled) {
                return;
            }
            editorInputSyncScheduled = true;
            Promise.resolve().then(function () {
                editorInputSyncScheduled = false;
                if (applyingTextareaValue) {
                    return;
                }
                syncingFromEditor = true;
                textarea.value = editor.getValue();
                syncTextareaSelection();
                syncTextareaScroll();
                textarea.dispatchEvent(new Event("input", { bubbles: true }));
                syncingFromEditor = false;
            });
        }

        session.on("change", function () {
            if (!applyingCodeFolds) {
                clearCollapsedCodeFolds();
            }
            scheduleTextareaInputSync();
            scheduleCodeStructureOverlaysRender();
        });
        editor.selection.on("changeCursor", syncTextareaSelection);
        editor.selection.on("changeSelection", syncTextareaSelection);
        session.on("changeScrollTop", syncTextareaScroll);
        session.on("changeScrollLeft", syncTextareaScroll);
        session.on("changeFold", function () {
            scheduleCodeStructureOverlaysRender();
            scheduleCodeFoldStateSync();
        });
        editor.renderer.on("afterRender", scheduleCodeStructureOverlaysRender);

        textarea.addEventListener("input", function () {
            if (syncingFromEditor) {
                return;
            }
            syncFromTextarea({
                focus: document.activeElement === textarea,
                syncScroll: true,
            });
        });

        host.addEventListener("keydown", function (event) {
            if (
                event.defaultPrevented
                || event.isComposing
                || (event.target instanceof Element && event.target.closest(".ace_search"))
            ) {
                return;
            }
            syncTextareaSelection();
            const forwardedEvent = new KeyboardEvent("keydown", {
                altKey: event.altKey,
                bubbles: false,
                cancelable: true,
                code: event.code,
                ctrlKey: event.ctrlKey,
                key: event.key,
                location: event.location,
                metaKey: event.metaKey,
                repeat: event.repeat,
                shiftKey: event.shiftKey,
            });
            if (!textarea.dispatchEvent(forwardedEvent)) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        }, true);

        host.addEventListener("click", function () {
            syncTextareaSelection();
            textarea.dispatchEvent(new MouseEvent("click", { bubbles: false }));
        });

        const themeObserver = new MutationObserver(setTheme);
        themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        const resizeObserver = window.ResizeObserver
            ? new ResizeObserver(function () {
                editor.resize(false);
                scheduleCodeStructureOverlaysRender();
            })
            : null;
        if (resizeObserver) {
            resizeObserver.observe(surface);
        }

        const adapter = {
            editor: editor,
            getCursorScreenPosition: function () {
                const cursor = editor.getCursorPosition();
                const position = editor.renderer.textToScreenCoordinates(cursor.row, cursor.column);
                return {
                    left: Number(position.pageX) - (window.scrollX || window.pageXOffset || 0),
                    top: Number(position.pageY) - (window.scrollY || window.pageYOffset || 0),
                    lineHeight: Number(editor.renderer.lineHeight) || 20,
                };
            },
            getElement: function () {
                return host;
            },
            focus: function () {
                editor.focus();
            },
            resize: function () {
                editor.resize(false);
                scheduleCodeStructureOverlaysRender();
            },
            setExtension: setExtension,
            setFontSize: function (fontSize) {
                const value = Math.max(8, Math.min(40, Number(fontSize) || 16));
                editor.setFontSize(value + "px");
                syncEditorHorizontalPadding();
                editor.resize(false);
                scheduleCodeStructureOverlaysRender();
            },
            setScroll: function (scrollTop, scrollLeft) {
                session.setScrollTop(Number(scrollTop) || 0);
                session.setScrollLeft(Number(scrollLeft) || 0);
                syncTextareaScroll();
            },
            syncFromTextarea: syncFromTextarea,
        };

        adapters.set(textarea, adapter);
        setTheme();
        setExtension(settings.extension || "");
        syncEditorSelection();
        syncTextareaScroll();
        editor.resize(false);
        scheduleCodeStructureOverlaysRender();
        return adapter;
    }

    window.HandriveCodeEditor = {
        create: create,
        get: function (textarea) {
            return textarea ? adapters.get(textarea) || null : null;
        },
        resolveMode: resolveMode,
    };
}());
