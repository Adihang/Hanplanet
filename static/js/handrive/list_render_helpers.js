(function () {
    "use strict";

    // List rendering helpers build small DOM fragments for tree rows. Keeping them here avoids
    // duplicating badge/icon markup rules between current-dir rows and regular directory entries.

    function buildTreePrefixElement(ancestorHasNextSiblings, isLastSibling) {
        // Tree prefixes are built as DOM nodes instead of CSS-only pseudo-elements so
        // nested list rows can render stable connector segments after live updates.
        var prefix = document.createElement("span");
        prefix.className = "handrive-item-tree-prefix";
        prefix.setAttribute("aria-hidden", "true");

        var ancestorFlags = ancestorHasNextSiblings || [];
        ancestorFlags.forEach(function (hasNextSibling) {
            var segment = document.createElement("span");
            segment.className = "handrive-tree-segment" + (hasNextSibling ? " has-next" : "");
            prefix.appendChild(segment);
        });

        var branch = document.createElement("span");
        branch.className = "handrive-tree-segment handrive-tree-branch " + (isLastSibling ? "is-last" : "is-middle");
        prefix.appendChild(branch);

        if (ancestorFlags.length === 0) {
            prefix.classList.add("is-root-depth");
        }

        return prefix;
    }

    function createTypeMarker(options) {
        // One helper owns all item icon selection so root avatars, repo/branch badges,
        // folders, and file-type icons stay consistent across list rows and current-dir rows.
        var settings = options || {};
        var typeMarker = document.createElement("span");
        typeMarker.className = "handrive-item-type-icon " + (settings.isDir ? "is-dir" : "is-file");
        typeMarker.setAttribute("aria-hidden", "true");

        if (settings.isRootAvatar) {
            typeMarker.classList.add("is-root-avatar");
            if (settings.accountProfileImageUrl) {
                var avatarImage = document.createElement("img");
                avatarImage.className = "handrive-current-dir-avatar";
                avatarImage.src = settings.accountProfileImageUrl;
                avatarImage.alt = "";
                avatarImage.loading = "lazy";
                typeMarker.appendChild(avatarImage);
            }
            return typeMarker;
        }

        if (settings.isRepo) {
            typeMarker.classList.add("is-repo");
        } else if (settings.isBranch) {
            typeMarker.classList.add("is-branch");
        } else if (settings.isMap) {
            typeMarker.classList.add("is-map");
        } else if (settings.isEmpty) {
            typeMarker.classList.add("is-empty");
        }

        if (!settings.isDir && settings.fileIconKey) {
            typeMarker.setAttribute("data-file-icon", settings.fileIconKey);
            if (settings.isGenericFileIcon) {
                typeMarker.classList.add("is-generic");
            }
        }

        if (settings.isDir && settings.customIconUrl) {
            typeMarker.classList.add("has-custom-icon");
            var customIconImg = document.createElement("img");
            customIconImg.className = "handrive-folder-custom-icon";
            customIconImg.src = settings.customIconUrl;
            customIconImg.alt = "";
            customIconImg.loading = "lazy";
            typeMarker.appendChild(customIconImg);
        }

        return typeMarker;
    }

    function appendCurrentDirRepoName(nameWrap, repoMeta, options) {
        if (!nameWrap || !repoMeta || !repoMeta.repo_name) {
            return;
        }
        var settings = options || {};
        if (!settings.showForBranchOrRepoInner) {
            return;
        }
        var repoLabel = document.createElement("span");
        repoLabel.className = "handrive-item-meta-label";
        repoLabel.textContent = String(repoMeta.repo_name || "").trim();
        nameWrap.appendChild(repoLabel);
    }

    function createEntryMetaField(className, textValue) {
        var metaLabel = document.createElement("span");
        metaLabel.className = "handrive-item-meta-label " + String(className || "").trim();
        metaLabel.textContent = String(textValue || "").trim();
        return metaLabel;
    }

    window.HandriveListRenderHelpers = {
        appendCurrentDirRepoName: appendCurrentDirRepoName,
        buildTreePrefixElement: buildTreePrefixElement,
        createEntryMetaField: createEntryMetaField,
        createTypeMarker: createTypeMarker,
    };
})();
