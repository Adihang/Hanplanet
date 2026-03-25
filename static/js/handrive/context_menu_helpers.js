(function () {
    "use strict";

    // Context-menu visibility is intentionally isolated here so selection -> action derivation
    // can be unitized mentally without reading the much larger page state machine.

    function syncContextMenuDividers(contextMenu) {
        // Divider visibility is derived from visible groups, not individual hr elements,
        // so repeated open/close cycles cannot leave duplicate or stale separators behind.
        if (!contextMenu) {
            return;
        }
        var groups = Array.from(contextMenu.querySelectorAll("[data-menu-group]"));
        var visibleGroups = [];
        groups.forEach(function (group) {
            var hasVisibleButton = Array.from(group.querySelectorAll("button[data-action]")).some(function (button) {
                if (!button || button.hidden) {
                    return false;
                }
                return !button.style || button.style.display !== "none";
            });
            group.classList.toggle("is-hidden", !hasVisibleButton);
            group.classList.remove("has-divider");
            if (hasVisibleButton) {
                visibleGroups.push(group);
            }
        });
        visibleGroups.forEach(function (group, index) {
            if (index > 0) {
                group.classList.add("has-divider");
            }
        });
    }

    function hasVisibleContextMenuAction(contextMenu) {
        // The menu should not open at all when every action is hidden for the current selection.
        if (!contextMenu) {
            return false;
        }
        return Array.from(contextMenu.querySelectorAll("button[data-action]")).some(function (button) {
            return button.style.display !== "none";
        });
    }

    function computeContextMenuVisibility(entries, options) {
        // Convert entry metadata into one flat action-visibility object so page.js only has
        // to apply button state instead of re-deriving permission logic in multiple places.
        var targets = Array.isArray(entries) ? entries.filter(Boolean) : [];
        var targetEntry = targets.length > 0 ? targets[0] : null;
        var isMultiSelection = targets.length > 1;
        var isEntryDeletable = options && typeof options.isEntryDeletable === "function"
            ? options.isEntryDeletable
            : function () { return false; };
        var isEditableHandriveFileEntry = options && typeof options.isEditableHandriveFileEntry === "function"
            ? options.isEditableHandriveFileEntry
            : function () { return false; };

        var IMAGE_EXTENSIONS_FOR_MAP = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".tiff", ".tif", ".avif"];
        var flags = {
            open: false,
            download: false,
            upload: false,
            edit: false,
            rename: false,
            deleteEntry: false,
            newFolder: false,
            newDoc: false,
            permissions: false,
            gitCreateRepo: false,
            gitManageRepo: false,
            gitDeleteRepo: false,
            gitCreateBranch: false,
            gitDeleteBranch: false,
            createMap: false,
        };

        if (!targetEntry) {
            return flags;
        }

        var isDirectory = Boolean(targetEntry.type === "dir");
        var isCurrentFolder = Boolean(targetEntry.isCurrentFolder);
        var canEditEntry = Boolean(targetEntry.can_edit);
        var canShowEditEntry = Boolean(canEditEntry && isEditableHandriveFileEntry(targetEntry));
        var canWriteChildren = Boolean(targetEntry.type === "dir" && targetEntry.can_write_children);
        var isGitVirtualEntry = Boolean(
            targetEntry.git_repo ||
            targetEntry.git_branch_root ||
            targetEntry.git_repo_branch ||
            targetEntry.is_git_virtual
        );
        var canDownloadAllFiles = targets.length > 0 && targets.every(function (entry) {
            return Boolean(entry) && !entry.isCurrentFolder && entry.type === "file";
        });
        var isPublicWriteFile = Boolean(targetEntry.type === "file" && targetEntry.is_public_write);
        var isSingleRepoDirectory = Boolean(!isMultiSelection && targetEntry.type === "dir" && targetEntry.git_repo);
        var repoMeta = targetEntry.git_repo ? targetEntry.git_repo : null;
        var canManageRepo = Boolean(repoMeta && repoMeta.can_manage);
        var canDeleteRepo = Boolean(repoMeta && repoMeta.can_delete);
        var hasGitRepo = Boolean(targetEntry.git_repo);

        if (isMultiSelection) {
            var canDeleteAll = targets.every(function (entry) {
                return isEntryDeletable(entry);
            });
            var includesRepoDirectory = targets.some(function (entry) {
                return Boolean(entry && entry.type === "dir" && entry.git_repo);
            });
            flags.open = true;
            flags.download = canDownloadAllFiles;
            flags.deleteEntry = canDeleteAll && !includesRepoDirectory;
            return flags;
        }

        flags.open = !isCurrentFolder;
        flags.download = !isCurrentFolder && !isDirectory;
        flags.upload = isDirectory && canWriteChildren && !hasGitRepo;
        flags.edit = !isDirectory && canShowEditEntry;
        flags.rename = !isCurrentFolder && canEditEntry && !isPublicWriteFile && !hasGitRepo;
        flags.deleteEntry = isEntryDeletable(targetEntry);
        flags.newFolder = isDirectory && canWriteChildren && !hasGitRepo;
        flags.newDoc = isDirectory && canWriteChildren && !hasGitRepo;
        flags.permissions = !isGitVirtualEntry;
        flags.gitCreateRepo = isDirectory && canWriteChildren && isEntryDeletable(targetEntry) && !hasGitRepo && !isGitVirtualEntry;
        flags.gitManageRepo = isDirectory && hasGitRepo && canManageRepo;
        flags.gitDeleteRepo = isSingleRepoDirectory && canDeleteRepo;
        flags.gitCreateBranch = Boolean(!isMultiSelection && targetEntry.git_branch_root && canWriteChildren);
        flags.gitDeleteBranch = Boolean(!isMultiSelection && targetEntry.git_branch_root && canWriteChildren && targetEntry.git_repo_branch !== "main");
        var entryExtension = !isDirectory && targetEntry.name
            ? ("." + targetEntry.name.split(".").pop()).toLowerCase()
            : "";
        flags.createMap = !isDirectory && canEditEntry && IMAGE_EXTENSIONS_FOR_MAP.indexOf(entryExtension) !== -1 && !isGitVirtualEntry;
        return flags;
    }

    window.HandriveContextMenuHelpers = {
        computeContextMenuVisibility: computeContextMenuVisibility,
        hasVisibleContextMenuAction: hasVisibleContextMenuAction,
        syncContextMenuDividers: syncContextMenuDividers,
    };
})();
