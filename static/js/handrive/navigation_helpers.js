(function () {
    "use strict";

    // Navigation helpers own breadcrumb generation plus directory-cache refresh behavior for the
    // tree/list UI. They are shared by path bar rendering and reload-after-mutation flows.

    function decodeBreadcrumbLabel(label) {
        var source = String(label || "");
        if (source.indexOf("%") < 0) {
            return source;
        }
        try {
            return decodeURIComponent(source);
        } catch (error) {
            return source;
        }
    }

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
                    label: decodeBreadcrumbLabel(parts[index]),
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
                label: decodeBreadcrumbLabel(part),
                path: nextPath,
                isCurrent: index === normalizedParts.length - 1,
            });
        });
        return rootCrumbs;
    }

    function formatPathLabel(pathValue, options) {
        var settings = options || {};
        var normalizePath = settings.normalizePath || function (value) { return value || ""; };
        var buildItems = settings.buildBreadcrumbItems || buildBreadcrumbItems;
        var leadingSlash = settings.leadingSlash !== false;
        var emptyLabel = typeof settings.emptyLabel === "string" ? settings.emptyLabel : "";
        var normalized = normalizePath(pathValue, true);
        if (!normalized && emptyLabel) {
            return emptyLabel;
        }

        var crumbs = buildItems(normalized, settings) || [];
        var labels = crumbs
            .map(function (crumb) {
                return decodeBreadcrumbLabel(crumb && crumb.label);
            })
            .map(function (label) {
                return String(label || "").trim();
            })
            .filter(Boolean);
        if (labels.length) {
            return (leadingSlash ? "/" : "") + labels.join("/");
        }
        if (!normalized) {
            return leadingSlash ? "/" : "";
        }
        return (leadingSlash ? "/" : "") + normalized
            .split("/")
            .filter(Boolean)
            .map(decodeBreadcrumbLabel)
            .join("/");
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
                current.className = "ui-path-current";
                current.setAttribute("data-handrive-dir", crumb.path);
                current.textContent = crumb.label;
                fragment.appendChild(current);
                return;
            }

            var link = documentRef.createElement("a");
            link.className = "ui-path-link";
            link.href = crumb.url || buildListUrl(handriveBaseUrl, crumb.path, handriveRootUrl);
            link.setAttribute("data-handrive-dir", crumb.path);
            link.textContent = crumb.label;
            fragment.appendChild(link);
        });

        pathBreadcrumbs.replaceChildren(fragment);
        bindHandrivePathDropTargets();
    }

    function getCachedEntries(dirPath, state) {
        var normalizedPath = String(dirPath || "");
        if (!state || !state.directoryCache || !state.directoryCache.has(normalizedPath)) {
            return [];
        }
        var entries = state.directoryCache.get(normalizedPath) || [];
        state.directoryCache.delete(normalizedPath);
        state.directoryCache.set(normalizedPath, entries);
        return entries;
    }

    function trimDirectoryCache(state, protectedPaths) {
        if (!state || !state.directoryCache) {
            return;
        }
        var maxEntries = Math.max(10, Number(state.directoryCacheMaxEntries) || 120);
        if (state.directoryCache.size <= maxEntries) {
            return;
        }
        var protectedSet = new Set(Array.isArray(protectedPaths) ? protectedPaths.filter(Boolean) : []);
        if (state.currentDir) {
            protectedSet.add(state.currentDir);
        }
        if (state.expandedFolders && typeof state.expandedFolders.forEach === "function") {
            state.expandedFolders.forEach(function (pathValue) {
                if (pathValue) {
                    protectedSet.add(pathValue);
                }
            });
        }
        var keys = Array.from(state.directoryCache.keys());
        for (var index = 0; index < keys.length && state.directoryCache.size > maxEntries; index += 1) {
            var key = keys[index];
            if (protectedSet.has(key)) {
                continue;
            }
            state.directoryCache.delete(key);
            if (state.directoryMetaCache) {
                state.directoryMetaCache.delete(key);
            }
        }
    }

    async function mapWithConcurrency(items, limit, worker) {
        var sourceItems = Array.isArray(items) ? items : [];
        var concurrency = Math.max(1, Number(limit) || 1);
        var results = new Array(sourceItems.length);
        var nextIndex = 0;

        async function runWorker() {
            while (nextIndex < sourceItems.length) {
                var currentIndex = nextIndex;
                nextIndex += 1;
                results[currentIndex] = await worker(sourceItems[currentIndex], currentIndex);
            }
        }

        var workers = [];
        var workerCount = Math.min(concurrency, sourceItems.length);
        for (var index = 0; index < workerCount; index += 1) {
            workers.push(runWorker());
        }
        await Promise.all(workers);
        return results;
    }

    function buildDirectoryListApiUrl(listApiUrl, dirPath) {
        var baseUrl = String(listApiUrl || "");
        var separator = baseUrl.indexOf("?") === -1 ? "?" : "&";
        return baseUrl + separator + "path=" + encodeURIComponent(dirPath || "");
    }

    function getDirectoryCacheGeneration(state) {
        return Number(state && state.directoryCacheGeneration) || 0;
    }

    function bumpDirectoryCacheGeneration(state) {
        if (!state) {
            return 0;
        }
        state.directoryCacheGeneration = getDirectoryCacheGeneration(state) + 1;
        return state.directoryCacheGeneration;
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
        if (!state.directoryLoadPromises) {
            state.directoryLoadPromises = new Map();
        }
        if (state.directoryLoadPromises.has(normalizedDirPath)) {
            return state.directoryLoadPromises.get(normalizedDirPath);
        }

        var cacheGeneration = getDirectoryCacheGeneration(state);
        var loadPromise = requestJson(
            buildDirectoryListApiUrl(listApiUrl, normalizedDirPath)
        ).then(function (data) {
            var entries = Array.isArray(data.entries) ? data.entries : [];
            if (getDirectoryCacheGeneration(state) !== cacheGeneration) {
                return loadDirectory(normalizedDirPath, settings);
            }
            state.directoryCache.set(normalizedDirPath, entries);
            if (state.directoryMetaCache && data && data.directory_meta) {
                state.directoryMetaCache.set(normalizedDirPath, data.directory_meta);
            }
            trimDirectoryCache(state, [normalizedDirPath]);
            return entries;
        }).finally(function () {
            if (state.directoryLoadPromises && state.directoryLoadPromises.get(normalizedDirPath) === loadPromise) {
                state.directoryLoadPromises.delete(normalizedDirPath);
            }
        });
        state.directoryLoadPromises.set(normalizedDirPath, loadPromise);
        return loadPromise;
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
        var previousCurrentEntries = state.directoryCache && state.directoryCache.has(currentDir)
            ? state.directoryCache.get(currentDir)
            : null;
        var previousCurrentMeta = state.directoryMetaCache && state.directoryMetaCache.has(currentDir)
            ? state.directoryMetaCache.get(currentDir)
            : null;
        var refreshGeneration = bumpDirectoryCacheGeneration(state);
        state.directoryLoadPromises = new Map();
        state.directoryCache = new Map();
        if (previousCurrentEntries) {
            state.directoryCache.set(currentDir, previousCurrentEntries);
        }
        if (state.directoryMetaCache) {
            state.directoryMetaCache = new Map();
            if (previousCurrentMeta) {
                state.directoryMetaCache.set(currentDir, previousCurrentMeta);
            }
        }
        var data = await requestJson(
            buildDirectoryListApiUrl(listApiUrl, currentDir)
        );
        if (getDirectoryCacheGeneration(state) !== refreshGeneration) {
            return;
        }
        state.directoryCache.set(currentDir, Array.isArray(data.entries) ? data.entries : []);
        if (state.directoryMetaCache && data && data.directory_meta) {
            state.directoryMetaCache.set(currentDir, data.directory_meta);
        }
        trimDirectoryCache(state, [currentDir]);

        var expandedPathsToRestore = [];
        for (var index = 0; index < expandedBeforeRefresh.length; index += 1) {
            var expandedPath = normalizePath(expandedBeforeRefresh[index], true);
            if (!expandedPath || expandedPath === currentDir) {
                continue;
            }
            expandedPathsToRestore.push(expandedPath);
        }
        var restoredPaths = await mapWithConcurrency(expandedPathsToRestore, 4, async function (expandedPath) {
            try {
                await loadDirectory(expandedPath);
                return expandedPath;
            } catch (error) {
                return "";
            }
        });
        if (getDirectoryCacheGeneration(state) !== refreshGeneration) {
            return;
        }
        var restoredExpandedFolders = new Set(restoredPaths.filter(Boolean));
        if (state.expandedFolders) {
            state.expandedFolders.forEach(function (pathValue) {
                var normalizedPath = normalizePath(pathValue, true);
                if (normalizedPath && normalizedPath !== currentDir && state.directoryCache.has(normalizedPath)) {
                    restoredExpandedFolders.add(normalizedPath);
                }
            });
        }
        state.expandedFolders = restoredExpandedFolders;
        renderList();
    }

    window.HandriveNavigationHelpers = {
        buildBreadcrumbItems: buildBreadcrumbItems,
        formatPathLabel: formatPathLabel,
        getCachedEntries: getCachedEntries,
        loadDirectory: loadDirectory,
        refreshCurrentDirectory: refreshCurrentDirectory,
        renderPathBreadcrumbs: renderPathBreadcrumbs,
    };
})();
