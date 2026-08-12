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
        const aceTextInput = host.querySelector(".ace_text-input");
        const indentGuides = document.createElement("div");
        indentGuides.className = "handrive-ace-indent-guides";
        indentGuides.hidden = true;
        host.appendChild(indentGuides);
        const indentGuideCanvas = document.createElement("div");
        indentGuideCanvas.className = "handrive-ace-indent-guide-canvas";
        indentGuides.appendChild(indentGuideCanvas);
        const foldControls = document.createElement("div");
        foldControls.className = "handrive-ace-fold-controls";
        foldControls.hidden = true;
        host.appendChild(foldControls);
        const foldControlCanvas = document.createElement("div");
        foldControlCanvas.className = "handrive-ace-fold-control-canvas";
        foldControls.appendChild(foldControlCanvas);
        const Range = window.ace.require("ace/range").Range;
        const session = editor.getSession();
        const editorGutter = host.querySelector(".ace_gutter");
        let syncingFromEditor = false;
        let applyingTextareaValue = false;
        let editorInputSyncFrame = 0;
        let textareaScrollSyncFrame = 0;
        let currentMode = "";
        let currentTheme = "";
        let codeStructureFrame = 0;
        let codeFoldSyncFrame = 0;
        let codeStructureAnalysisTimer = 0;
        let applyingCodeFolds = false;
        let cachedCodeStructureState = null;
        let codeStructureStateDirty = false;
        let codeStructureOverlayGeometryRevision = 0;
        let codeStructureOverlayRenderKey = "";
        let renderedOverlayScrollLeft = 0;
        let renderedOverlayScrollTop = 0;
        let overlayScrollFrame = 0;
        let renderedEditorGutterWidth = -1;
        let renderedEditorGutterOffset = -1;
        let renderedEditorHorizontalScrollState = null;
        let renderedEditorCompositionLineHeight = -1;
        let compositionInputMetricsFrame = 0;
        let editorCursorSyncFrame = 0;
        let editorLineScrollSelectionActive = false;
        let editorLineScrollSelectionSyncFrame = 0;
        let editorLineScrollSelectionKey = "";
        let editorLineScrollSelectionRanges = [];
        let editorLineScrollSelectionMarkerIds = [];
        const collapsedFoldStarts = new Set();
        const codeStructure = window.HandriveCodeStructure;

        session.setUseWorker(false);
        session.setTabSize(4);
        session.setUseSoftTabs(true);
        session.setFoldStyle("markbeginend");
        const editorFontFamily = '"HanDrive Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
        editor.setOptions({
            animatedScroll: false,
            behavioursEnabled: true,
            displayIndentGuides: false,
            enableKeyboardAccessibility: true,
            fadeFoldWidgets: false,
            fontFamily: editorFontFamily,
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
            if (cachedCodeStructureState) {
                return cachedCodeStructureState;
            }
            const lines = session.getDocument().getAllLines();
            const renderClass = RENDER_CLASS_BY_MODE[currentMode] || "";
            const indentSize = codeStructure.detectIndentSize(lines, renderClass);
            const allFoldRanges = codeStructure.buildFoldRanges(
                lines,
                indentSize,
                renderClass,
            );
            cachedCodeStructureState = {
                foldRanges: codeStructure.filterFoldRangesByParentDepth(allFoldRanges, 1),
                guideColumns: codeStructure.getGuideColumns(
                    lines,
                    indentSize,
                    allFoldRanges,
                ),
                guideDepths: codeStructure.getGuideDepths(lines, indentSize),
                indentSize: indentSize,
                lines: lines,
            };
            return cachedCodeStructureState;
        }

        function invalidateCodeStructureOverlays() {
            codeStructureOverlayGeometryRevision += 1;
            codeStructureOverlayRenderKey = "";
        }

        function invalidateCodeStructureState() {
            if (codeStructureAnalysisTimer) {
                window.clearTimeout(codeStructureAnalysisTimer);
                codeStructureAnalysisTimer = 0;
            }
            codeStructureStateDirty = false;
            cachedCodeStructureState = null;
            invalidateCodeStructureOverlays();
        }

        function scheduleCodeStructureStateRefresh() {
            codeStructureStateDirty = true;
            if (codeStructureAnalysisTimer) {
                window.clearTimeout(codeStructureAnalysisTimer);
            }
            codeStructureAnalysisTimer = window.setTimeout(function () {
                codeStructureAnalysisTimer = 0;
                if (!codeStructureStateDirty) {
                    return;
                }
                codeStructureStateDirty = false;
                cachedCodeStructureState = null;
                invalidateCodeStructureOverlays();
                scheduleCodeStructureOverlaysRender();
            }, 120);
        }

        function syncCodeStructureOverlayScroll() {
            if (!codeStructureOverlayRenderKey || indentGuides.hidden) {
                return;
            }
            const translateX = renderedOverlayScrollLeft - (Number(session.getScrollLeft()) || 0);
            const translateY = renderedOverlayScrollTop - (Number(session.getScrollTop()) || 0);
            const transform = translateX || translateY
                ? "translate3d(" + translateX + "px, " + translateY + "px, 0)"
                : "";
            if (indentGuideCanvas.style.transform !== transform) {
                indentGuideCanvas.style.transform = transform;
                foldControlCanvas.style.transform = transform;
            }
        }

        function scheduleCodeStructureOverlayScroll() {
            if (overlayScrollFrame) {
                return;
            }
            overlayScrollFrame = window.requestAnimationFrame(function () {
                overlayScrollFrame = 0;
                syncCodeStructureOverlayScroll();
            });
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
            if (!isCodeMode) {
                if (codeStructureOverlayRenderKey !== "hidden") {
                    indentGuideCanvas.replaceChildren();
                    foldControlCanvas.replaceChildren();
                    indentGuideCanvas.style.transform = "";
                    foldControlCanvas.style.transform = "";
                    codeStructureOverlayRenderKey = "hidden";
                }
                return;
            }

            const layerConfig = editor.renderer.layerConfig || {};
            const firstRow = Math.max(0, Number(layerConfig.firstRow) || 0);
            const lastRow = Math.min(session.getLength() - 1, Number(layerConfig.lastRow) || firstRow);
            const lineHeight = Number(editor.renderer.lineHeight) || 20;
            const characterWidth = Number(editor.renderer.characterWidth) || 8;
            const fontSize = getEditorFontSize();
            const renderKey = [
                codeStructureOverlayGeometryRevision,
                currentMode,
                firstRow,
                lastRow,
                lineHeight,
                characterWidth,
                fontSize,
                editorLineScrollSelectionKey,
            ].join(":");
            if (renderKey === codeStructureOverlayRenderKey) {
                syncCodeStructureOverlayScroll();
                return;
            }

            const hostRect = host.getBoundingClientRect();
            const scrollerRect = editor.renderer.scroller.getBoundingClientRect();
            const scrollLeft = Number(session.getScrollLeft()) || 0;
            const scrollTop = Number(session.getScrollTop()) || 0;
            const textOriginLeft = (
                scrollerRect.left
                - hostRect.left
                + (Number(layerConfig.padding) || Number(editor.renderer.$padding) || 0)
                - scrollLeft
            );
            const textOriginTop = scrollerRect.top - hostRect.top - scrollTop;
            const foldColumnLeft = textOriginLeft - (fontSize * 0.875);
            foldControls.style.fontSize = fontSize + "px";
            const structureState = getCodeStructureState();
            const indentStep = characterWidth * structureState.indentSize;
            const indentGuideFragment = document.createDocumentFragment();
            const foldControlFragment = document.createDocumentFragment();

            function getRowPosition(row, column) {
                const screenPosition = session.documentToScreenPosition(row, column || 0);
                return {
                    left: textOriginLeft + (screenPosition.column * characterWidth),
                    top: textOriginTop + (screenPosition.row * lineHeight),
                };
            }

            for (let row = firstRow; row <= lastRow; row += 1) {
                const foldLine = session.getFoldLine(row);
                if (foldLine && foldLine.start.row < row) {
                    continue;
                }
                const line = session.getLine(row);
                const rowPosition = getRowPosition(row, 0);
                const guideColumns = structureState.guideColumns[row] || [];
                if (guideColumns.length) {
                    const guide = document.createElement("span");
                    guide.className = "handrive-ace-indent-guide-row";
                    guide.dataset.row = String(row);
                    guide.dataset.columns = guideColumns.join(",");
                    guide.style.left = rowPosition.left + "px";
                    guide.style.top = rowPosition.top + "px";
                    guide.style.width = ((guideColumns[guideColumns.length - 1] + 1) * indentStep) + "px";
                    guide.style.height = (lineHeight + 1) + "px";
                    guideColumns.forEach(function (guideColumn) {
                        const lineGuide = document.createElement("span");
                        lineGuide.className = "handrive-ace-indent-guide";
                        lineGuide.style.left = (guideColumn * indentStep) + "px";
                        guide.appendChild(lineGuide);
                    });
                    indentGuideFragment.appendChild(guide);
                }
                if (!structureState.foldRanges.has(row)) {
                    if (isEditorLineScrollRowSelected(row)) {
                        const selection = document.createElement("span");
                        selection.className = "handrive-ace-fold-line-scroll-selection";
                        selection.style.left = foldColumnLeft + "px";
                        selection.style.top = rowPosition.top + "px";
                        selection.style.width = (fontSize * 0.875) + "px";
                        selection.style.height = lineHeight + "px";
                        foldControlFragment.appendChild(selection);
                    }
                    continue;
                }
                const isExpanded = !collapsedFoldStarts.has(row);
                if (isEditorLineScrollRowSelected(row)) {
                    const selection = document.createElement("span");
                    selection.className = "handrive-ace-fold-line-scroll-selection";
                    selection.style.left = foldColumnLeft + "px";
                    selection.style.top = rowPosition.top + "px";
                    selection.style.width = (fontSize * 0.875) + "px";
                    selection.style.height = lineHeight + "px";
                    foldControlFragment.appendChild(selection);
                }
                const toggle = document.createElement("button");
                toggle.type = "button";
                toggle.className = "handrive-ace-fold-toggle";
                toggle.dataset.row = String(row);
                toggle.style.left = foldColumnLeft + "px";
                toggle.style.top = rowPosition.top + "px";
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
                        const replacement = foldControlCanvas.querySelector(
                            '.handrive-ace-fold-toggle[data-row="' + row + '"]',
                        );
                        if (replacement) {
                            replacement.focus({ preventScroll: true });
                        }
                    });
                };
                if (!isExpanded) {
                    const visibleLineLength = line.replace(/\s+$/, "").length;
                    const lineEndPosition = getRowPosition(row, visibleLineLength);
                    const ellipsis = document.createElement("button");
                    ellipsis.type = "button";
                    ellipsis.className = "handrive-ace-fold-ellipsis";
                    ellipsis.textContent = "...";
                    ellipsis.style.left = lineEndPosition.left + "px";
                    ellipsis.style.top = (
                        rowPosition.top + ((lineHeight - (fontSize * 1.1)) / 2)
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
                    foldControlFragment.appendChild(ellipsis);
                }
                toggle.addEventListener("mousedown", function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                });
                toggle.addEventListener("click", toggleFold);
                foldControlFragment.appendChild(toggle);
            }
            indentGuideCanvas.replaceChildren(indentGuideFragment);
            foldControlCanvas.replaceChildren(foldControlFragment);
            renderedOverlayScrollLeft = Number(session.getScrollLeft()) || 0;
            renderedOverlayScrollTop = Number(session.getScrollTop()) || 0;
            codeStructureOverlayRenderKey = renderKey;
            syncCodeStructureOverlayScroll();
        }

        function scheduleCodeStructureOverlaysRender() {
            if (codeStructureFrame) {
                return;
            }
            codeStructureFrame = window.requestAnimationFrame(renderCodeStructureOverlays);
        }

        function getEditorLineScrollSelectionRanges() {
            const sourceRanges = editor.multiSelect && editor.multiSelect.inMultiSelectMode
                ? editor.multiSelect.getAllRanges()
                : [editor.getSelectionRange()];
            const lastRow = Math.max(0, session.getLength() - 1);
            return sourceRanges.map(function (range) {
                const startRow = Math.max(0, Math.min(lastRow, range.start.row));
                let endRow = Math.max(0, Math.min(lastRow, range.end.row));
                if (range.end.column === 0 && endRow > startRow) {
                    endRow -= 1;
                }
                return {
                    start: Math.min(startRow, endRow),
                    end: Math.max(startRow, endRow),
                    isEmpty: range.isEmpty(),
                };
            }).filter(function (range) {
                return !range.isEmpty;
            });
        }

        function isEditorLineScrollRowSelected(row) {
            return editorLineScrollSelectionRanges.some(function (range) {
                return row >= range.start && row <= range.end;
            });
        }

        function syncVisibleEditorLineScrollSelection() {
            const gutterLayer = editor.renderer.$gutterLayer;
            const cells = gutterLayer && gutterLayer.$lines
                ? gutterLayer.$lines.cells
                : [];
            (cells || []).forEach(function (cell) {
                if (!cell || !cell.element) {
                    return;
                }
                cell.element.classList.toggle(
                    "handrive-ace-line-scroll-selected",
                    isEditorLineScrollRowSelected(cell.row),
                );
            });
        }

        function clearEditorLineScrollSelection() {
            if (!editorLineScrollSelectionActive && !editorLineScrollSelectionMarkerIds.length) {
                return;
            }
            editorLineScrollSelectionActive = false;
            editorLineScrollSelectionMarkerIds.forEach(function (markerId) {
                session.removeMarker(markerId);
            });
            editorLineScrollSelectionMarkerIds = [];
            editorLineScrollSelectionRanges = [];
            editorLineScrollSelectionKey = "";
            syncVisibleEditorLineScrollSelection();
            invalidateCodeStructureOverlays();
            scheduleCodeStructureOverlaysRender();
        }

        function syncEditorLineScrollSelection() {
            editorLineScrollSelectionSyncFrame = 0;
            if (!editorLineScrollSelectionActive) {
                return;
            }
            const nextRanges = getEditorLineScrollSelectionRanges();
            const nextKey = nextRanges.map(function (range) {
                return range.start + ":" + range.end;
            }).join(",");
            if (nextKey === editorLineScrollSelectionKey) {
                syncVisibleEditorLineScrollSelection();
                return;
            }
            editorLineScrollSelectionMarkerIds.forEach(function (markerId) {
                session.removeMarker(markerId);
            });
            editorLineScrollSelectionMarkerIds = nextRanges.map(function (range) {
                return session.addMarker(
                    new Range(range.start, 0, range.end + 1, 0),
                    "handrive-ace-line-scroll-selected",
                    "fullLine",
                    false,
                );
            });
            editorLineScrollSelectionRanges = nextRanges;
            editorLineScrollSelectionKey = nextKey;
            syncVisibleEditorLineScrollSelection();
            invalidateCodeStructureOverlays();
            scheduleCodeStructureOverlaysRender();
        }

        function scheduleEditorLineScrollSelectionSync() {
            if (!editorLineScrollSelectionActive || editorLineScrollSelectionSyncFrame) {
                return;
            }
            editorLineScrollSelectionSyncFrame = window.requestAnimationFrame(
                syncEditorLineScrollSelection,
            );
        }

        function toggleEditorLineScrollComment() {
            if (
                !editorLineScrollSelectionActive
                || currentMode === "text"
                || !getEditorLineScrollSelectionRanges().length
            ) {
                return false;
            }
            editor.execCommand("togglecomment");
            return true;
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

        function scheduleTextareaScrollSync() {
            if (textareaScrollSyncFrame) {
                return;
            }
            textareaScrollSyncFrame = window.requestAnimationFrame(function () {
                textareaScrollSyncFrame = 0;
                syncTextareaScroll();
            });
        }

        function syncEditorLineNumberGutterOffset() {
            const gutterMarginLeft = editorGutter
                ? Math.max(
                    0,
                    parseFloat(window.getComputedStyle(editorGutter).marginLeft) || 0,
                )
                : 0;
            host.style.setProperty(
                "--handrive-code-editor-composition-offset-x",
                gutterMarginLeft + "px",
            );
            const gutterWidth = Math.max(0, Number(editor.renderer.gutterWidth) || 0);
            if (gutterWidth === renderedEditorGutterWidth && renderedEditorGutterOffset >= 0) {
                return;
            }
            renderedEditorGutterWidth = gutterWidth;
            const gutterOffset = editorGutter
                ? Math.max(0, editorGutter.offsetLeft + editorGutter.offsetWidth)
                : gutterWidth;
            if (gutterOffset !== renderedEditorGutterOffset) {
                renderedEditorGutterOffset = gutterOffset;
                host.style.setProperty(
                    "--handrive-code-editor-gutter-offset",
                    gutterOffset + "px",
                );
            }
        }

        function syncEditorCompositionLineHeight() {
            const lineHeight = Math.max(
                1,
                Number(editor.renderer.lineHeight) || getEditorFontSize(),
            );
            if (lineHeight === renderedEditorCompositionLineHeight) {
                return;
            }
            renderedEditorCompositionLineHeight = lineHeight;
            host.style.setProperty(
                "--handrive-code-editor-composition-line-height",
                lineHeight + "px",
            );
        }

        function getRenderedEditorLine(row) {
            const expectedTop = editor.renderer.textToScreenCoordinates(row, 0).pageY;
            let closestLine = null;
            let closestDistance = Infinity;
            host.querySelectorAll(".ace_text-layer .ace_line").forEach(function (line) {
                const distance = Math.abs(line.getBoundingClientRect().top - expectedTop);
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestLine = line;
                }
            });
            return closestLine;
        }

        function getRenderedEditorColumnLeft(line, column) {
            if (!line) {
                return null;
            }
            const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
            let remaining = Math.max(0, Number(column) || 0);
            let lastNode = null;
            let node;
            while ((node = walker.nextNode())) {
                lastNode = node;
                const nodeLength = node.nodeValue ? node.nodeValue.length : 0;
                if (remaining <= nodeLength) {
                    const range = document.createRange();
                    range.setStart(node, remaining);
                    range.collapse(true);
                    return range.getBoundingClientRect().left;
                }
                remaining -= nodeLength;
            }
            if (!lastNode) {
                return line.getBoundingClientRect().left;
            }
            const range = document.createRange();
            range.selectNodeContents(lastNode);
            range.collapse(false);
            return range.getBoundingClientRect().right;
        }

        function syncRenderedEditorCursor() {
            editorCursorSyncFrame = 0;
            const cursor = host.querySelector(".ace_cursor");
            const cursorLayer = host.querySelector(".ace_cursor-layer");
            if (!cursor || !cursorLayer || cursor.hidden || cursor.style.display === "none") {
                return;
            }
            const position = editor.getCursorPosition();
            const line = getRenderedEditorLine(position.row);
            const pageLeft = getRenderedEditorColumnLeft(line, position.column);
            if (pageLeft == null) {
                return;
            }
            const layerRect = cursorLayer.getBoundingClientRect();
            const left = pageLeft - layerRect.left;
            // Ace's cursor layer already computes the row's pixel position.
            // Reuse that vertical value and only replace the horizontal value
            // (which is the part affected by Ace's two-column CJK metrics).
            // Deriving both coordinates from DOM line boxes can accumulate a
            // line-height offset after each newline while the editor scrolls.
            const pixelPosition = editor.renderer.$cursorLayer
                ? editor.renderer.$cursorLayer.$pixelPos
                : null;
            const lineRect = line ? line.getBoundingClientRect() : null;
            const top = pixelPosition && Number.isFinite(pixelPosition.top)
                ? pixelPosition.top
                : lineRect
                    ? lineRect.top - layerRect.top
                    : 0;
            cursor.style.transform = "translate(" + left + "px, " + top + "px)";
        }

        function scheduleRenderedEditorCursorSync() {
            if (editorCursorSyncFrame) {
                return;
            }
            editorCursorSyncFrame = window.requestAnimationFrame(syncRenderedEditorCursor);
        }

        function syncCompositionInputMetrics() {
            compositionInputMetricsFrame = 0;
            if (!aceTextInput || !aceTextInput.classList.contains("ace_composition")) {
                return;
            }
            const editorStyle = window.getComputedStyle(host);
            const committedCjk = host.querySelector(".ace_cjk");
            const committedStyle = committedCjk
                ? window.getComputedStyle(committedCjk)
                : editorStyle;
            aceTextInput.style.fontFamily = (
                committedStyle.fontFamily
                || editorStyle.fontFamily
                || editorFontFamily
            );
            aceTextInput.style.fontSize = (
                committedStyle.fontSize
                || getEditorFontSize() + "px"
            );
            aceTextInput.style.fontWeight = committedStyle.fontWeight || "inherit";
            aceTextInput.style.fontStyle = committedStyle.fontStyle || "normal";
            aceTextInput.style.fontStretch = committedStyle.fontStretch || "normal";
            aceTextInput.style.fontVariantLigatures = "none";
            aceTextInput.style.letterSpacing = committedStyle.letterSpacing
                || editorStyle.letterSpacing
                || "normal";
            aceTextInput.style.wordSpacing = committedStyle.wordSpacing
                || editorStyle.wordSpacing
                || "normal";
            aceTextInput.style.lineHeight = (
                Math.max(1, Number(editor.renderer.lineHeight) || getEditorFontSize())
                + "px"
            );
            const gutterMarginLeft = editorGutter
                ? Math.max(
                    0,
                    parseFloat(window.getComputedStyle(editorGutter).marginLeft) || 0,
                )
                : 0;
            host.style.setProperty(
                "--handrive-code-editor-composition-offset-x",
                gutterMarginLeft + "px",
            );
            aceTextInput.style.margin = "0 0 0 " + gutterMarginLeft + "px";
            aceTextInput.style.padding = "0";
        }

        function scheduleCompositionInputMetrics() {
            if (compositionInputMetricsFrame) {
                return;
            }
            compositionInputMetricsFrame = window.requestAnimationFrame(
                syncCompositionInputMetrics,
            );
        }

        if (aceTextInput) {
            aceTextInput.addEventListener(
                "compositionstart",
                scheduleCompositionInputMetrics,
            );
            aceTextInput.addEventListener(
                "compositionupdate",
                scheduleCompositionInputMetrics,
            );
            aceTextInput.addEventListener("input", function (event) {
                if (event.isComposing || aceTextInput.classList.contains("ace_composition")) {
                    scheduleCompositionInputMetrics();
                }
            });
            aceTextInput.addEventListener("compositionend", function () {
                window.requestAnimationFrame(function () {
                    [
                        "font-family",
                        "font-size",
                        "font-weight",
                        "font-style",
                        "font-stretch",
                        "font-variant-ligatures",
                        "letter-spacing",
                        "line-height",
                        "margin",
                        "padding",
                        "word-spacing",
                    ].forEach(function (property) {
                        aceTextInput.style.removeProperty(property);
                    });
                });
            });
        }

        function syncEditorLineNumberScrollPadding() {
            const isHorizontallyScrolled = (Number(session.getScrollLeft()) || 0) > 0;
            const scrollPadding = isHorizontallyScrolled ? 2 : 0;
            if (isHorizontallyScrolled !== renderedEditorHorizontalScrollState) {
                renderedEditorHorizontalScrollState = isHorizontallyScrolled;
                host.classList.toggle("is-horizontally-scrolled", isHorizontallyScrolled);
            }
            if (!editorGutter || !editor.renderer.scroller) {
                return;
            }
            const gutterWidth = Math.max(
                0,
                Number(editor.renderer.gutterWidth) || editorGutter.offsetWidth,
            );
            const nextGutterWidth = gutterWidth + scrollPadding;
            const nextGutterWidthValue = nextGutterWidth + "px";
            if (editorGutter.style.width !== nextGutterWidthValue) {
                editorGutter.style.width = nextGutterWidthValue;
            }
            const gutterOffset = Math.max(
                0,
                editorGutter.offsetLeft + editorGutter.offsetWidth,
            );
            const nextScrollerLeft = gutterOffset + "px";
            if (editor.renderer.scroller.style.left !== nextScrollerLeft) {
                editor.renderer.scroller.style.left = nextScrollerLeft;
            }
            if (gutterOffset !== renderedEditorGutterOffset) {
                renderedEditorGutterOffset = gutterOffset;
                host.style.setProperty(
                    "--handrive-code-editor-gutter-offset",
                    gutterOffset + "px",
                );
            }
        }

        function syncVerticalScroll() {
            scheduleTextareaScrollSync();
            scheduleCodeStructureOverlayScroll();
            scheduleCodeStructureOverlaysRender();
        }

        function syncHorizontalScroll() {
            scheduleTextareaScrollSync();
            syncEditorLineNumberScrollPadding();
            scheduleCodeStructureOverlayScroll();
        }

        function handleEditorAfterRender() {
            syncEditorLineNumberScrollPadding();
            syncEditorLineNumberGutterOffset();
            syncEditorCompositionLineHeight();
            syncVisibleEditorLineScrollSelection();
            scheduleRenderedEditorCursorSync();
            scheduleCodeStructureOverlaysRender();
        }

        function syncEditorSelection() {
            const sourceLength = String(textarea.value || "").length;
            const selectionStart = Math.max(0, Math.min(sourceLength, Number(textarea.selectionStart) || 0));
            const selectionEnd = Math.max(0, Math.min(sourceLength, Number(textarea.selectionEnd) || 0));
            const documentModel = session.getDocument();
            const start = documentModel.indexToPosition(Math.min(selectionStart, selectionEnd), 0);
            const end = documentModel.indexToPosition(Math.max(selectionStart, selectionEnd), 0);
            const currentRange = editor.getSelectionRange();
            const isBackwards = textarea.selectionDirection === "backward";
            if (
                currentRange.start.row === start.row
                && currentRange.start.column === start.column
                && currentRange.end.row === end.row
                && currentRange.end.column === end.column
                && editor.selection.isBackwards() === isBackwards
            ) {
                return;
            }
            editor.selection.setSelectionRange(
                new Range(start.row, start.column, end.row, end.column),
                isBackwards,
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
                const nextScrollTop = Number(textarea.scrollTop) || 0;
                const nextScrollLeft = Number(textarea.scrollLeft) || 0;
                if (nextScrollTop !== (Number(session.getScrollTop()) || 0)) {
                    session.setScrollTop(nextScrollTop);
                }
                if (nextScrollLeft !== (Number(session.getScrollLeft()) || 0)) {
                    session.setScrollLeft(nextScrollLeft);
                }
            }
            if (syncOptions.focus) {
                editor.focus();
            }
            if (syncOptions.resize) {
                editor.resize(false);
            }
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
            if (nextMode === currentMode) {
                return;
            }
            clearCollapsedCodeFolds();
            currentMode = nextMode;
            invalidateCodeStructureState();
            session.setMode("ace/mode/" + nextMode);
            editor.setOption("displayIndentGuides", false);
            editor.setOption("showFoldWidgets", false);
            scheduleCodeStructureOverlaysRender();
        }

        function scheduleTextareaInputSync() {
            if (applyingTextareaValue || editorInputSyncFrame) {
                return;
            }
            editorInputSyncFrame = window.requestAnimationFrame(function () {
                editorInputSyncFrame = 0;
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
            scheduleCodeStructureStateRefresh();
            clearEditorLineScrollSelection();
            if (!applyingCodeFolds) {
                clearCollapsedCodeFolds();
            }
            scheduleTextareaInputSync();
            scheduleCodeStructureOverlaysRender();
        });
        editor.selection.on("changeCursor", function () {
            syncTextareaSelection();
            scheduleRenderedEditorCursorSync();
            scheduleEditorLineScrollSelectionSync();
        });
        editor.selection.on("changeSelection", function () {
            syncTextareaSelection();
            scheduleRenderedEditorCursorSync();
            scheduleEditorLineScrollSelectionSync();
        });
        session.on("changeScrollTop", syncVerticalScroll);
        session.on("changeScrollLeft", syncHorizontalScroll);
        session.on("changeFold", function () {
            invalidateCodeStructureOverlays();
            scheduleCodeStructureOverlaysRender();
            scheduleCodeFoldStateSync();
        });
        editor.renderer.on("afterRender", handleEditorAfterRender);

        editor.on("guttermousedown", function (event) {
            if (
                !event
                || event.getButton() !== 0
                || editor.renderer.$gutterLayer.getRegion(event) === "foldWidgets"
            ) {
                return;
            }
            editorLineScrollSelectionActive = true;
            scheduleEditorLineScrollSelectionSync();
        });

        host.addEventListener("mousedown", function (event) {
            if (!(event.target instanceof Element)) {
                return;
            }
            if (event.target.closest(".ace_gutter, .handrive-ace-fold-controls")) {
                return;
            }
            clearEditorLineScrollSelection();
        });

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
            if (
                event.key === "/"
                && !event.altKey
                && !event.shiftKey
                && (event.ctrlKey || event.metaKey)
                && toggleEditorLineScrollComment()
            ) {
                event.preventDefault();
                event.stopImmediatePropagation();
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
                invalidateCodeStructureOverlays();
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
                invalidateCodeStructureOverlays();
                scheduleCodeStructureOverlaysRender();
            },
            setExtension: setExtension,
            setFontSize: function (fontSize) {
                const value = Math.max(8, Math.min(40, Number(fontSize) || 16));
                editor.setFontSize(value + "px");
                syncEditorHorizontalPadding();
                editor.resize(false);
                invalidateCodeStructureOverlays();
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
        syncEditorLineNumberGutterOffset();
        syncEditorCompositionLineHeight();
        syncEditorLineNumberScrollPadding();
        editor.resize(false);
        scheduleCodeStructureOverlaysRender();
        if (document.fonts && typeof document.fonts.load === "function") {
            document.fonts.load(getEditorFontSize() + 'px "HanDrive Code"').then(function () {
                if (!host.isConnected) {
                    return;
                }
                editor.renderer.updateFontSize();
                editor.resize(false);
                syncEditorLineNumberGutterOffset();
                syncEditorCompositionLineHeight();
                invalidateCodeStructureOverlays();
                scheduleCodeStructureOverlaysRender();
            }).catch(function () {});
        }
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
