(function () {
    "use strict";

    // Editor helpers own filename parsing and panel-mode transitions. Networking and persistence
    // stay in page.js so list/write pages can share the same editor surface behavior.

    function switchToEditorUI(options) {
        // This helper owns only the UI transition into editor mode. Fetching/saving content
        // stays outside so page.js can decide when the editor is opened from list or write flows.
        var settings = options || {};
        var entry = settings.entry || null;
        var editorPanel = settings.editorPanel || null;
        var editorFilenameInput = settings.editorFilenameInput || null;
        var editorContentInput = settings.editorContentInput || null;
        var previewPanel = settings.previewPanel || null;
        var listLayout = settings.listLayout || null;
        var renderHighlight = settings.renderHighlight || function () {};
        var onAfterChange = settings.onAfterChange || function () {};
        var loadContent = settings.loadContent || function () { return Promise.resolve(""); };

        if (!editorPanel || !editorFilenameInput || !editorContentInput || !entry) {
            return Promise.resolve();
        }

        editorFilenameInput.value = entry.name || "";

        var applyContent = function (text) {
            entry.content = typeof text === "string" ? text : "";
            editorContentInput.value = entry.content;
            renderHighlight();
        };

        var loadPromise;
        if (!entry.content) {
            loadPromise = Promise.resolve(loadContent(entry)).then(applyContent).catch(function () {
                applyContent("");
            });
        } else {
            applyContent(entry.content);
            loadPromise = Promise.resolve();
        }

        if (previewPanel) {
            previewPanel.hidden = true;
            previewPanel.setAttribute("aria-hidden", "true");
        }
        editorPanel.hidden = false;
        editorPanel.setAttribute("aria-hidden", "false");
        if (listLayout) {
            listLayout.classList.remove("has-preview");
            listLayout.classList.add("has-editor");
        }
        onAfterChange();
        editorContentInput.focus();
        return loadPromise;
    }

    function switchToPreviewUI(options) {
        // Mirror the editor->preview surface toggle so layout classes stay in one place.
        var settings = options || {};
        var editorPanel = settings.editorPanel || null;
        var previewPanel = settings.previewPanel || null;
        var listLayout = settings.listLayout || null;
        var onAfterChange = settings.onAfterChange || function () {};

        if (editorPanel) {
            var focused = document.activeElement;
            if (focused && editorPanel.contains(focused)) {
                focused.blur();
            }
            editorPanel.hidden = true;
            editorPanel.setAttribute("aria-hidden", "true");
        }
        if (previewPanel) {
            previewPanel.hidden = false;
            previewPanel.setAttribute("aria-hidden", "false");
        }
        if (listLayout) {
            listLayout.classList.remove("has-editor");
            listLayout.classList.add("has-preview");
        }
        onAfterChange();
    }

    function resolveEditorFilenameAndExtension(rawFilename, sourcePath, getErrorText) {
        // Normalize the editable filename field into a base filename + extension pair while
        // preserving the original extension as fallback when the user edits only the stem.
        var errorText = typeof getErrorText === "function" ? getErrorText : function (_, fallback) { return fallback; };
        var fallbackMatch = String(sourcePath || "").match(/\.([A-Za-z0-9]+)$/);
        var fallbackExtension = fallbackMatch ? ("." + fallbackMatch[1].toLowerCase()) : ".md";
        var trimmed = String(rawFilename || "").trim();
        if (!trimmed) {
            throw new Error(errorText("js_filename_required", "파일명을 입력해주세요."));
        }
        if (trimmed.includes("/") || trimmed.includes("\\")) {
            throw new Error(errorText("js_error_path_required", "경로를 입력해주세요."));
        }

        var extMatch = trimmed.match(/^(.*?)(\.[A-Za-z0-9]+)$/);
        if (extMatch && extMatch[1] && !extMatch[1].endsWith(".")) {
            return {
                filename: extMatch[1].trim(),
                extension: extMatch[2].toLowerCase(),
            };
        }

        if (trimmed.endsWith(".")) {
            throw new Error(errorText("js_extension_invalid", "확장자 형식이 올바르지 않습니다. 예: .md"));
        }

        return {
            filename: trimmed,
            extension: fallbackExtension,
        };
    }

    window.HandriveEditorHelpers = {
        resolveEditorFilenameAndExtension: resolveEditorFilenameAndExtension,
        switchToEditorUI: switchToEditorUI,
        switchToPreviewUI: switchToPreviewUI,
    };
})();
