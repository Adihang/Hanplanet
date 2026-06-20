(function () {
    "use strict";

    // Git repo modal UI helpers intentionally do not fetch data. They only normalize the
    // visible modal state so polling/create flows can reuse one presentation layer.

    function resetGitRepoModalUi(options) {
        // Reset the create/manage modal into a neutral state before each open so
        // status text and clone URLs from the previous repository cannot leak through.
        var settings = options || {};
        var gitRepoForm = settings.gitRepoForm || null;
        var gitRepoStatusDiv = settings.gitRepoStatusDiv || null;
        var gitRepoNameInput = settings.gitRepoNameInput || null;
        var gitRepoTarget = settings.gitRepoTarget || null;
        var gitRepoTitle = settings.gitRepoTitle || null;
        var gitRepoModal = settings.gitRepoModal || null;
        var syncModalBodyState = settings.syncModalBodyState || function () {};
        var entry = settings.entry || null;
        var isManageMode = Boolean(settings.isManageMode);
        var t = settings.t || function (key, fallbackValue) { return fallbackValue; };
        var formatPathLabel = typeof settings.formatPathLabel === "function"
            ? settings.formatPathLabel
            : function (pathValue) { return pathValue || ""; };
        var renderPopupTargetPath = window.HandriveModalHelpers && window.HandriveModalHelpers.renderPopupTargetPath
            ? window.HandriveModalHelpers.renderPopupTargetPath
            : function (target, value) { if (target) { target.textContent = value || ""; } };

        if (gitRepoForm) {
            gitRepoForm.hidden = isManageMode;
        }
        if (gitRepoStatusDiv) {
            gitRepoStatusDiv.hidden = true;
        }
        if (gitRepoNameInput) {
            gitRepoNameInput.value = "";
        }
        if (gitRepoTarget) {
            renderPopupTargetPath(gitRepoTarget, entry ? formatPathLabel(entry.path) : "");
        }
        if (gitRepoTitle) {
            gitRepoTitle.textContent = isManageMode
                ? t("git_repo_manage_title", "Git 리포지토리 관리")
                : t("git_repo_create_title", "Git 리포지토리 생성");
        }
        if (gitRepoModal) {
            gitRepoModal._targetEntry = entry || null;
            gitRepoModal.hidden = false;
        }
        syncModalBodyState();
    }

    function closeGitRepoModalUi(options) {
        // Closing also clears the target entry because later opens may point at a different folder.
        var settings = options || {};
        var gitRepoModal = settings.gitRepoModal || null;
        var syncModalBodyState = settings.syncModalBodyState || function () {};
        if (gitRepoModal) {
            gitRepoModal.hidden = true;
            gitRepoModal._targetEntry = null;
        }
        syncModalBodyState();
    }

    function showGitRepoStatus(options) {
        // The modal reuses one status surface for create, retry, and manage flows,
        // so this helper updates every dependent control together.
        var settings = options || {};
        var gitRepoForm = settings.gitRepoForm || null;
        var gitRepoStatusDiv = settings.gitRepoStatusDiv || null;
        var gitRepoStatusMsg = settings.gitRepoStatusMsg || null;
        var gitRepoRetryButton = settings.gitRepoRetryButton || null;
        var gitRepoCloneInfo = settings.gitRepoCloneInfo || null;
        var gitRepoCloneUrlInput = settings.gitRepoCloneUrlInput || null;
        var gitRepoOpenButton = settings.gitRepoOpenButton || null;
        var msg = settings.msg || "";
        var showRetry = Boolean(settings.showRetry);
        var cloneUrl = settings.cloneUrl || "";
        var webUrl = settings.webUrl || "";

        if (gitRepoForm) {
            gitRepoForm.hidden = true;
        }
        if (gitRepoStatusDiv) {
            gitRepoStatusDiv.hidden = false;
        }
        if (gitRepoStatusMsg) {
            gitRepoStatusMsg.textContent = msg;
        }
        if (gitRepoRetryButton) {
            gitRepoRetryButton.hidden = !showRetry;
        }
        if (gitRepoCloneInfo) {
            if (cloneUrl) {
                if (gitRepoCloneUrlInput) {
                    gitRepoCloneUrlInput.value = cloneUrl;
                }
                gitRepoCloneInfo.hidden = false;
            } else {
                gitRepoCloneInfo.hidden = true;
            }
        }
        if (gitRepoOpenButton) {
            if (webUrl) {
                gitRepoOpenButton.hidden = false;
                gitRepoOpenButton.onclick = function () {
                    window.location.href = webUrl;
                };
            } else {
                gitRepoOpenButton.hidden = true;
                gitRepoOpenButton.onclick = null;
            }
        }
    }

    window.HandriveGitRepoHelpers = {
        closeGitRepoModalUi: closeGitRepoModalUi,
        resetGitRepoModalUi: resetGitRepoModalUi,
        showGitRepoStatus: showGitRepoStatus,
    };
})();
