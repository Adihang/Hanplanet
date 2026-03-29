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

        return typeMarker;
    }

    function appendAclBadges(row, aclLabels, limit) {
        if (!row) {
            return;
        }
        var labels = Array.isArray(aclLabels) ? aclLabels : [];
        if (labels.length === 0) {
            return;
        }
        var aclLabelLimit = Number(limit) || 3;
        var aclWrap = document.createElement("span");
        aclWrap.className = "handrive-item-acl-list";
        labels.slice(0, aclLabelLimit).forEach(function (labelText) {
            var aclBadge = document.createElement("span");
            aclBadge.className = "handrive-item-acl-badge";
            aclBadge.textContent = String(labelText || "");
            aclWrap.appendChild(aclBadge);
        });
        if (labels.length > aclLabelLimit) {
            var overflowBadge = document.createElement("span");
            overflowBadge.className = "handrive-item-acl-badge handrive-item-acl-badge-overflow";
            overflowBadge.textContent = "+" + String(labels.length - aclLabelLimit);
            aclWrap.appendChild(overflowBadge);
        }
        row.appendChild(aclWrap);
    }

    function appendEntryBadge(row, entry, translator, appendBadgeWithPrefix) {
        if (!row || !entry || typeof appendBadgeWithPrefix !== "function") {
            return;
        }
        var t = typeof translator === "function" ? translator : function (_, fallback) { return fallback; };
        var badgeText = "";
        var badgePrefixText = "";
        if (entry.type === "dir" && entry.git_repo) {
            badgeText = t("repository_badge", "Repository");
            if (!entry.git_repo.is_owner) {
                badgePrefixText = String(entry.git_repo.owner_username || "").trim();
            }
        } else if (entry.type === "dir" && entry.git_branch_root) {
            badgeText = t("branch_badge", "Branch");
        } else if (entry.git_commit_message) {
            badgeText = String(entry.git_commit_message || "").trim();
            badgePrefixText = String(entry.git_commit_author_username || "").trim();
        } else if (entry.type === "file" && entry.is_public_write) {
            badgeText = t("public_write_badge", "전체 허용");
        }
        if (badgeText) {
            appendBadgeWithPrefix(row, badgeText, badgePrefixText);
        }
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
        appendAclBadges: appendAclBadges,
        appendCurrentDirRepoName: appendCurrentDirRepoName,
        appendEntryBadge: appendEntryBadge,
        buildTreePrefixElement: buildTreePrefixElement,
        createEntryMetaField: createEntryMetaField,
        createTypeMarker: createTypeMarker,
    };
})();
