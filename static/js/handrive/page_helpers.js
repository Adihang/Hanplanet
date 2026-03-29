(function () {
    "use strict";

    function normalizePathForHelper(raw) {
        // Keep helper-side path normalization tiny and dependency-free so renderer/helper
        // modules can reason about paths without importing the full page controller.
        return String(raw || "")
            .replace(/\\/g, "/")
            .trim()
            .replace(/^\/+|\/+$/g, "");
    }

    function appendBadgeWithPrefix(row, badgeText, prefixText) {
        // Repo owner names and commit authors share the same badge shell, with an optional
        // prefix rendered to the left in a visually lighter style.
        var normalizedBadgeText = String(badgeText || "").trim();
        if (!normalizedBadgeText || !row) {
            return;
        }
        var badgeContainer = row.querySelector(".handrive-item-badge-slot") || row;
        var wrap = document.createElement("span");
        wrap.className = "handrive-item-public-badge-wrap";
        var normalizedPrefixText = String(prefixText || "").trim();
        if (normalizedPrefixText) {
            var prefix = document.createElement("span");
            prefix.className = "handrive-item-public-badge-prefix";
            prefix.textContent = normalizedPrefixText;
            wrap.appendChild(prefix);
        }
        var badge = document.createElement("span");
        badge.className = "handrive-item-public-badge";
        badge.textContent = normalizedBadgeText;
        wrap.appendChild(badge);
        badgeContainer.appendChild(wrap);
    }

    function getPathFileExtension(pathValue) {
        var normalized = normalizePathForHelper(pathValue);
        if (!normalized) {
            return "";
        }
        var segments = normalized.split("/");
        var fileName = segments[segments.length - 1] || "";
        var dotIndex = fileName.lastIndexOf(".");
        if (dotIndex <= 0) {
            return "";
        }
        return fileName.slice(dotIndex).toLowerCase();
    }

    function getFileIconKey(pathValue) {
        // Map file extensions to the visual icon family used by HanDrive rows and previews.
        var extension = getPathFileExtension(pathValue);
        if (!extension) {
            return "file";
        }
        if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".avif", ".heic"].includes(extension)) {
            return "image";
        }
        if ([".mp4", ".mov", ".webm", ".mkv", ".avi", ".wmv", ".m4v"].includes(extension)) {
            return "video";
        }
        if ([".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"].includes(extension)) {
            return "audio";
        }
        if ([".zip", ".7z", ".rar", ".tar", ".gz", ".bz2", ".xz"].includes(extension)) {
            return "archive";
        }
        if (extension === ".pdf") {
            return "pdf";
        }
        if ([".md", ".txt", ".rtf"].includes(extension)) {
            return "text";
        }
        if ([".doc", ".docx"].includes(extension)) {
            return "word";
        }
        if ([".odt", ".pages", ".hwp", ".hwpx"].includes(extension)) {
            return "file";
        }
        if ([".xls", ".xlsx"].includes(extension)) {
            return "excel";
        }
        if ([".csv", ".tsv", ".ods", ".numbers"].includes(extension)) {
            return "file";
        }
        if ([".ppt", ".pptx"].includes(extension)) {
            return "powerpoint";
        }
        if ([".odp", ".key"].includes(extension)) {
            return "file";
        }
        if (extension === ".json") {
            return "data";
        }
        if ([".yaml", ".yml", ".toml", ".ini", ".conf", ".env", ".xml"].includes(extension)) {
            return "file";
        }
        if ([".js", ".mjs", ".cjs"].includes(extension)) {
            return "js";
        }
        if ([".ts", ".tsx"].includes(extension)) {
            return "ts";
        }
        if (extension === ".jsx") {
            return "jsx";
        }
        if (extension === ".py") {
            return "py";
        }
        if (extension === ".java") {
            return "java";
        }
        if (extension === ".kt") {
            return "kotlin";
        }
        if (extension === ".swift") {
            return "swift";
        }
        if (extension === ".go") {
            return "go";
        }
        if (extension === ".rs") {
            return "rust";
        }
        if (extension === ".rb") {
            return "ruby";
        }
        if (extension === ".php") {
            return "php";
        }
        if (extension === ".c") {
            return "c";
        }
        if ([".cpp", ".hpp", ".h"].includes(extension)) {
            return "cpp";
        }
        if (extension === ".cs") {
            return "csharp";
        }
        if (extension === ".scala") {
            return "scala";
        }
        if (extension === ".sql") {
            return "data";
        }
        if ([".sh", ".zsh", ".bash"].includes(extension)) {
            return "shell";
        }
        if ([".html", ".htm"].includes(extension)) {
            return "html";
        }
        if ([".css", ".scss", ".sass", ".less"].includes(extension)) {
            return "css";
        }
        if (extension === ".json") {
            return "json";
        }
        if (extension === ".md") {
            return "markdown";
        }
        if ([".lua", ".dart", ".elm", ".ex", ".exs", ".erl", ".fs", ".fsx", ".groovy", ".jl", ".nim", ".pl", ".r", ".vb"].includes(extension)) {
            return "code";
        }
        if ([".ttf", ".otf", ".woff", ".woff2"].includes(extension)) {
            return "font";
        }
        if (extension === ".exe") {
            return "exe";
        }
        return "file";
    }

    function isGenericFileIconKey(iconKey) {
        return [
            "file",
            "image",
            "video",
            "audio",
            "archive",
            "pdf",
            "text",
            "document",
            "sheet",
            "presentation",
            "word",
            "excel",
            "powerpoint",
            "data",
            "code",
            "json",
            "markdown",
            "font",
        ].includes(iconKey);
    }

    window.HandrivePageHelpers = {
        appendBadgeWithPrefix: appendBadgeWithPrefix,
        getPathFileExtension: getPathFileExtension,
        getFileIconKey: getFileIconKey,
        isGenericFileIconKey: isGenericFileIconKey,
    };
})();
