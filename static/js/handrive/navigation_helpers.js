(function () {
    "use strict";

    // Navigation helpers own breadcrumb generation plus directory-cache refresh behavior for the
    // tree/list UI. They are shared by path bar rendering and reload-after-mutation flows.

    function buildBreadcrumbItems(pathValue, options) {
        // Breadcrumb generation understands scoped homes,
        // so page rendering can stay agnostic about user/root path differences.
        var settings = options || {};
        var normalizePath = settings.normalizePath || function (value) { return value || ""; };
        var scopedHomeDir = settings.scopedHomeDir || "";
        var effectiveRootLabel = settings.effectiveRootLabel || "";

        var normalized = normalizePath(pathValue, true);
        var useScopedBreadcrumb = scopedHomeDir && (
            !normalized || normalized === scopedHomeDir || normalized.startsWith(scopedHomeDir + "/")
        );
        if (useScopedBreadcrumb) {
            var homeParts = scopedHomeDir.split("/").filter(Boolean);
            var homeLabel = homeParts.length ? homeParts[homeParts.length - 1] : scopedHomeDir;
            var effectivePath = normalized && (
                normalized === scopedHomeDir || normalized.startsWith(scopedHomeDir + "/")
            )
                ? normalized
                : scopedHomeDir;

            var crumbs = [];
            crumbs.push({
                label: homeLabel,
                path: scopedHomeDir,
                isCurrent: effectivePath === scopedHomeDir,
            });
            if (effectivePath === scopedHomeDir) {
                return crumbs;
            }

            var parts = effectivePath.split("/").filter(Boolean);
            for (var index = homeParts.length; index < parts.length; index += 1) {
                var composedPath = parts.slice(0, index + 1).join("/");
                crumbs.push({
                    label: parts[index],
                    path: composedPath,
                    isCurrent: index === parts.length - 1,
                });
            }
            return crumbs;
        }

        var rootCrumbs = [{
            label: effectiveRootLabel,
            path: "",
            isCurrent: normalized === "",
        }];
        if (!normalized) {
            return rootCrumbs;
        }

        var normalizedParts = normalized.split("/").filter(Boolean);
        var nextPath = "";
        normalizedParts.forEach(function (part, index) {
            nextPath = nextPath ? nextPath + "/" + part : part;
            rootCrumbs.push({
                label: part,
                path: nextPath,
                isCurrent: index === normalizedParts.length - 1,
            });
        });
        return rootCrumbs;
    }

    function renderPathBreadcrumbs(pathValue, options) {
        // Render breadcrumbs from normalized path data rather than trusting existing DOM,
        // which keeps navigation correct after client-side directory changes.
        var settings = options || {};
        var pathBreadcrumbs = settings.pathBreadcrumbs || null;
        var documentRef = settings.documentRef || document;
        var buildBreadcrumbItems = settings.buildBreadcrumbItems || function () { return []; };
        var buildListUrl = settings.buildListUrl || function () { return ""; };
        var handriveBaseUrl = settings.handriveBaseUrl || "";
        var handriveRootUrl = settings.handriveRootUrl || "";
        var bindHandrivePathDropTargets = settings.bindHandrivePathDropTargets || function () {};

        if (!pathBreadcrumbs) {
            return;
        }

        var fragment = documentRef.createDocumentFragment();
        var crumbs = buildBreadcrumbItems(pathValue);

        crumbs.forEach(function (crumb, index) {
            if (index > 0) {
                var separator = documentRef.createElement("span");
                separator.className = "handrive-path-sep";
                separator.textContent = "/";
                fragment.appendChild(separator);
            }

            if (crumb.isCurrent) {
                var current = documentRef.createElement("span");
                current.className = "handrive-path-current";
                current.setAttribute("data-handrive-dir", crumb.path);
                current.textContent = crumb.label;
                fragment.appendChild(current);
                return;
            }

            var link = documentRef.createElement("a");
            link.className = "handrive-path-link";
            link.href = buildListUrl(handriveBaseUrl, crumb.path, handriveRootUrl);
            link.setAttribute("data-handrive-dir", crumb.path);
            link.textContent = crumb.label;
            fragment.appendChild(link);
        });

        pathBreadcrumbs.replaceChildren(fragment);
        bindHandrivePathDropTargets();
    }

    function getCachedEntries(dirPath, state) {
        return state.directoryCache.get(dirPath) || [];
    }

    async function loadDirectory(dirPath, options) {
        var settings = options || {};
        var state = settings.state || {};
        var normalizePath = settings.normalizePath || function (value) { return value || ""; };
        var requestJson = settings.requestJson || function () { return Promise.resolve({ entries: [] }); };
        var listApiUrl = settings.listApiUrl || "";
        var getCachedEntries = settings.getCachedEntries || function () { return []; };

        var normalizedDirPath = normalizePath(dirPath, true);
        if (state.directoryCache.has(normalizedDirPath)) {
            return getCachedEntries(normalizedDirPath);
        }

        var data = await requestJson(
            listApiUrl + "?path=" + encodeURIComponent(normalizedDirPath)
        );
        var entries = Array.isArray(data.entries) ? data.entries : [];
        state.directoryCache.set(normalizedDirPath, entries);
        if (state.directoryMetaCache && data && data.directory_meta) {
            state.directoryMetaCache.set(normalizedDirPath, data.directory_meta);
        }
        return entries;
    }

    async function refreshCurrentDirectory(options) {
        var settings = options || {};
        var state = settings.state || {};
        var currentDir = settings.currentDir || "";
        var normalizePath = settings.normalizePath || function (value) { return value || ""; };
        var requestJson = settings.requestJson || function () { return Promise.resolve({ entries: [] }); };
        var listApiUrl = settings.listApiUrl || "";
        var loadDirectory = settings.loadDirectory || function () { return Promise.resolve([]); };
        var renderList = settings.renderList || function () {};

        var expandedBeforeRefresh = Array.from(state.expandedFolders || []);
        var data = await requestJson(
            listApiUrl + "?path=" + encodeURIComponent(currentDir)
        );
        state.directoryCache.set(currentDir, Array.isArray(data.entries) ? data.entries : []);
        if (state.directoryMetaCache && data && data.directory_meta) {
            state.directoryMetaCache.set(currentDir, data.directory_meta);
        }

        var preserved = new Map();
        preserved.set(currentDir, state.directoryCache.get(currentDir));
        state.directoryCache = preserved;

        var restoredExpandedFolders = new Set();
        for (var index = 0; index < expandedBeforeRefresh.length; index += 1) {
            var expandedPath = normalizePath(expandedBeforeRefresh[index], true);
            if (!expandedPath || expandedPath === currentDir) {
                continue;
            }
            try {
                await loadDirectory(expandedPath);
                restoredExpandedFolders.add(expandedPath);
            } catch (error) {}
        }
        state.expandedFolders = restoredExpandedFolders;
        renderList();
    }

    window.HandriveNavigationHelpers = {
        buildBreadcrumbItems: buildBreadcrumbItems,
        getCachedEntries: getCachedEntries,
        loadDirectory: loadDirectory,
        refreshCurrentDirectory: refreshCurrentDirectory,
        renderPathBreadcrumbs: renderPathBreadcrumbs,
    };
})();
