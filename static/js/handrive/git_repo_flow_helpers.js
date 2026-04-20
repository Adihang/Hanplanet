(function () {
    "use strict";

    function stopPolling(state) {
        // Git repo creation/import is asynchronous on the backend, so the UI owns
        // a single poll timer that must be explicitly stopped on success/failure.
        if (state.timer !== null) {
            clearInterval(state.timer);
            state.timer = null;
        }
    }

    async function pollStatus(options) {
        // Poll the repository status endpoint and translate status transitions into
        // modal updates, list refreshes, and route remaps when the handrive path changes.
        var settings = options || {};
        var state = settings.state || {};
        var requestJson = settings.requestJson || function () { return Promise.resolve({}); };
        var normalizePath = settings.normalizePath || function (value) { return value || ""; };
        var showStatus = settings.showStatus || function () {};
        var refreshCurrentDirectory = settings.refreshCurrentDirectory || function () { return Promise.resolve(); };
        var buildListUrl = settings.buildListUrl || function () { return ""; };
        var getParentDirectory = settings.getParentDirectory || function () { return ""; };
        var handriveBaseUrl = settings.handriveBaseUrl || "";
        var handriveRootUrl = settings.handriveRootUrl || "";
        var gitRepoTitle = settings.gitRepoTitle || null;
	        var gitRepoModal = settings.gitRepoModal || null;
	        var currentDir = settings.currentDir || "";
	        var onCurrentDirRepoActivate = settings.onCurrentDirRepoActivate || function () {};
	        var t = settings.t || function (key, fallbackValue) { return fallbackValue; };

        try {
            var data = await requestJson(
                "/api/git/repos/" + state.currentId + "/status/",
                { method: "GET" }
            );
            if (data.status === "active") {
                stopPolling(state);
                var remappedPath = data.handrive_path ? normalizePath(data.handrive_path, true) : "";
	                if (gitRepoTitle) {
	                    gitRepoTitle.textContent = t("git_repo_manage_title", "Git 리포지토리 관리");
	                }
	                showStatus(
	                    t("git_repo_linked", "연결된 리포지토리"),
	                    false,
                    data.clone_http_url_authed || data.clone_http_url || "",
                    data.gitea_web_url || ""
                );
                if (gitRepoModal && gitRepoModal._targetEntry) {
                    gitRepoModal._targetEntry.git_repo = { id: state.currentId, status: "active" };
                    if (remappedPath) {
                        gitRepoModal._targetEntry.path = remappedPath;
                    }
                    if (gitRepoModal._targetEntry.path === currentDir) {
                        onCurrentDirRepoActivate(state.currentId);
                    }
                }
                if (remappedPath && remappedPath !== currentDir && !remappedPath.startsWith(currentDir + "/")) {
                    window.location.href = buildListUrl(handriveBaseUrl, getParentDirectory(remappedPath), handriveRootUrl);
                    return;
                }
                refreshCurrentDirectory().catch(function () {});
            } else if (data.status === "failed") {
                stopPolling(state);
	                showStatus(
	                    t("git_repo_create_failed", "생성 실패") + ": " + (data.error_message || t("git_repo_unknown_error", "알 수 없는 오류")),
	                    true,
                    null,
                    null
                );
            }
        } catch (error) {
            stopPolling(state);
	            showStatus(t("git_repo_status_error", "상태 조회 중 오류가 발생했습니다."), true, null, null);
        }
    }

    function startPolling(options) {
        // Start one interval and immediately perform the first status check so the
        // modal does not sit idle for the first polling window.
        var settings = options || {};
        var state = settings.state || {};
        var intervalMs = Number(settings.intervalMs || 2000);
	        var pollStatus = settings.pollStatus || function () { return Promise.resolve(); };
	        var showStatus = settings.showStatus || function () {};
	        var t = settings.t || function (key, fallbackValue) { return fallbackValue; };

        stopPolling(state);
        state.timer = setInterval(function () {
            pollStatus().catch(function () {
                stopPolling(state);
	                showStatus(t("git_repo_status_error", "상태 조회 중 오류가 발생했습니다."), true, null, null);
            });
        }, intervalMs);
    }

    async function openModal(options) {
        // Opening the modal first probes whether the target path already maps to a repo,
        // then chooses create/manage mode without making the caller duplicate that logic.
        var settings = options || {};
        var entry = settings.entry || null;
        var manageMode = Boolean(settings.manageMode);
        var state = settings.state || {};
        var resetModalUi = settings.resetModalUi || function () {};
        var stopPollingFn = settings.stopPolling || function () {};
        var requestJson = settings.requestJson || function () { return Promise.resolve({}); };
        var showStatus = settings.showStatus || function () {};
        var startPolling = settings.startPolling || function () {};
	        var gitRepoTitle = settings.gitRepoTitle || null;
	        var gitRepoForm = settings.gitRepoForm || null;
	        var gitRepoNameInput = settings.gitRepoNameInput || null;
	        var t = settings.t || function (key, fallbackValue) { return fallbackValue; };

        stopPollingFn();
        state.currentId = null;
        var hasExistingRepo = !!(entry && entry.git_repo);
        var isManageMode = manageMode || hasExistingRepo;
        resetModalUi(entry, isManageMode);

        if (!(entry && entry.path)) {
            if (!isManageMode && gitRepoNameInput) {
                gitRepoNameInput.focus();
            }
            return;
        }

        try {
            var data = await requestJson(
                "/api/git/repos/by-path/?path=" + encodeURIComponent(entry.path),
                { method: "GET" }
            );
            if (!data || !data.repo) {
	                if (gitRepoTitle) {
	                    gitRepoTitle.textContent = t("git_repo_create_title", "Git 리포지토리 생성");
	                }
                if (gitRepoForm) {
                    gitRepoForm.hidden = false;
                }
                if (gitRepoNameInput) {
                    gitRepoNameInput.focus();
                }
                return;
            }
            var repo = data.repo;
            state.currentId = repo.id;
            if (repo.status === "active") {
	                showStatus(
	                    t("git_repo_linked", "연결된 리포지토리"),
                    false,
                    repo.forgejo_clone_http_authed || repo.forgejo_clone_http || "",
                    repo.gitea_web_url || ""
                );
            } else if (repo.status === "failed") {
	                showStatus(
	                    t("git_repo_create_failed", "생성 실패") + ": " + (repo.error_message || t("git_repo_unknown_error", "알 수 없는 오류")),
                    true,
                    null,
                    null
                );
            } else {
	                showStatus(t("git_repo_creating", "생성 중..."), false, null, null);
                startPolling();
            }
        } catch (error) {
            if (isManageMode) {
	                showStatus(t("git_repo_load_failed", "저장소 정보를 불러올 수 없습니다. 페이지를 새로고침해주세요."), true, null, null);
            } else {
                if (gitRepoForm) {
                    gitRepoForm.hidden = false;
                }
                if (gitRepoNameInput) {
                    gitRepoNameInput.focus();
                }
            }
        }
    }

    async function submitCreate(options) {
        // Submit repository creation and immediately switch the modal into polling mode;
        // user feedback after that comes only from the async status endpoint.
        var settings = options || {};
        var state = settings.state || {};
        var gitRepoModal = settings.gitRepoModal || null;
        var gitRepoNameInput = settings.gitRepoNameInput || null;
        var requestJson = settings.requestJson || function () { return Promise.resolve({}); };
	        var buildPostOptions = settings.buildPostOptions || function () { return {}; };
	        var showStatus = settings.showStatus || function () {};
	        var startPolling = settings.startPolling || function () {};
	        var t = settings.t || function (key, fallbackValue) { return fallbackValue; };

        var entry = gitRepoModal ? gitRepoModal._targetEntry : null;
        if (!entry) {
            return;
        }
        var repoName = String(gitRepoNameInput ? gitRepoNameInput.value : "").trim();
	        if (!repoName) {
	            window.alert(t("git_repo_name_required", "리포지토리 이름을 입력해주세요."));
	            return;
	        }

	        showStatus(t("git_repo_creating", "생성 중..."), false, null, null);
        try {
            var data = await requestJson(
                "/api/git/repos/",
                buildPostOptions({ path: entry.path, repo_name: repoName })
            );
            state.currentId = data.repo ? data.repo.id : data.id;
            startPolling();
        } catch (error) {
	            showStatus(
	                t("git_repo_request_failed", "요청 실패") + ": " + (error && error.message ? error.message : t("git_repo_unknown_error", "알 수 없는 오류")),
	                false,
                null,
                null
            );
        }
    }

    async function retryCreate(options) {
        // Failed create/import flows reuse the same status surface and polling behavior,
        // so retry only needs to kick the backend and restart polling.
        var settings = options || {};
        var state = settings.state || {};
        var requestJson = settings.requestJson || function () { return Promise.resolve(); };
	        var buildPostOptions = settings.buildPostOptions || function () { return {}; };
	        var showStatus = settings.showStatus || function () {};
	        var startPolling = settings.startPolling || function () {};
	        var t = settings.t || function (key, fallbackValue) { return fallbackValue; };

        if (!state.currentId) {
            return;
        }
	        showStatus(t("git_repo_retrying", "재시도 중..."), false, null, null);
        try {
            await requestJson(
                "/api/git/repos/" + state.currentId + "/retry/",
                buildPostOptions({})
            );
            startPolling();
        } catch (error) {
	            showStatus(
	                t("git_repo_retry_failed", "재시도 실패") + ": " + (error && error.message ? error.message : t("git_repo_unknown_error", "알 수 없는 오류")),
	                true,
                null,
                null
            );
        }
    }

    window.HandriveGitRepoFlowHelpers = {
        openModal: openModal,
        pollStatus: pollStatus,
        retryCreate: retryCreate,
        startPolling: startPolling,
        stopPolling: stopPolling,
        submitCreate: submitCreate,
    };
})();
