(function () {
    "use strict";

    const hosts = Array.from(document.querySelectorAll("[data-auth-account]"));
    if (!hosts.length) {
        return;
    }

    const getCsrfToken = function () {
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta && meta.content) {
            return meta.content;
        }
        const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
        return match ? decodeURIComponent(match[1]) : "";
    };

    const setElementText = function (element, text) {
        if (element) {
            element.textContent = text || "";
        }
    };

    const setStatus = function (statusElement, message, isError) {
        if (!statusElement) {
            return;
        }
        const normalizedMessage = String(message || "").trim();
        statusElement.hidden = !normalizedMessage;
        statusElement.classList.toggle("is-error", Boolean(isError));
        statusElement.textContent = normalizedMessage;
    };

    const closeMenu = function (host) {
        const menu = host.querySelector("[data-auth-account-menu]");
        const trigger = host.querySelector("[data-auth-account-trigger]");
        if (menu) {
            menu.hidden = true;
        }
        if (trigger) {
            trigger.setAttribute("aria-expanded", "false");
        }
    };

    const parseJsonResponse = async function (response) {
        const payload = await response.json().catch(function () {
            return {};
        });
        if (!response.ok || payload.ok === false) {
            const error = new Error(payload.error || "request_failed");
            error.payload = payload;
            throw error;
        }
        return payload;
    };

    const renderRepositories = function (repoList, repositories) {
        if (!repoList) {
            return;
        }
        repoList.textContent = "";
        repositories.forEach(function (repository) {
            const row = document.createElement("label");
            row.className = "ui-auth-github-repo-row";

            const checkbox = document.createElement("input");
            checkbox.className = "ui-auth-github-repo-checkbox";
            checkbox.type = "checkbox";
            checkbox.value = String(repository.id);
            checkbox.checked = Boolean(repository.selected);

            const main = document.createElement("span");
            main.className = "ui-auth-github-repo-main";

            const name = document.createElement("span");
            name.className = "ui-auth-github-repo-name";
            name.textContent = repository.full_name || repository.name || "";

            const meta = document.createElement("span");
            meta.className = "ui-auth-github-repo-meta";
            const visibility = repository.private ? "Private" : "Public";
            const branch = repository.default_branch ? " · " + repository.default_branch : "";
            meta.textContent = visibility + branch;

            main.appendChild(name);
            main.appendChild(meta);
            row.appendChild(checkbox);
            row.appendChild(main);
            repoList.appendChild(row);
        });
    };

    const bindHost = function (host) {
        const triggerButton = host.querySelector("[data-auth-github-trigger]");
        const modal = host.querySelector("[data-auth-github-modal]");
        if (!triggerButton || !modal || triggerButton.dataset.githubWidgetBound === "1") {
            return;
        }
        triggerButton.dataset.githubWidgetBound = "1";

        const backdrop = modal.querySelector("[data-auth-github-modal-backdrop]");
        const title = modal.querySelector("[data-auth-github-modal-title]");
        const message = modal.querySelector("[data-auth-github-modal-message]");
        const status = modal.querySelector("[data-auth-github-status]");
        const repoList = modal.querySelector("[data-auth-github-repo-list]");
        const cancelButton = modal.querySelector("[data-auth-github-cancel]");
        const confirmButton = modal.querySelector("[data-auth-github-confirm]");
        let lastFocusedElement = null;

        const label = function (key, fallback) {
            return modal.dataset[key] || fallback || "";
        };

        const setModalOpen = function (opened) {
            modal.hidden = !opened;
            if (opened) {
                lastFocusedElement = document.activeElement;
                if (cancelButton) {
                    cancelButton.focus();
                }
                return;
            }
            if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
                lastFocusedElement.focus();
            }
            lastFocusedElement = null;
        };

        const setConnectMode = function () {
            modal.dataset.mode = "connect";
            setElementText(title, label("connectTitle", "Connect GitHub"));
            setElementText(message, label("connectMessage", "No GitHub account is connected. Connect GitHub now?"));
            if (repoList) {
                repoList.hidden = true;
                repoList.textContent = "";
            }
            setStatus(status, "", false);
            if (confirmButton) {
                confirmButton.hidden = false;
                confirmButton.textContent = label("connectConfirm", "Connect");
            }
        };

        const setRepositoryMode = async function () {
            modal.dataset.mode = "repositories";
            setElementText(title, label("repoTitle", "GitHub Repositories"));
            setElementText(message, label("repoMessage", "Select repositories to show in HanDrive."));
            if (repoList) {
                repoList.hidden = true;
                repoList.textContent = "";
            }
            setStatus(status, label("repoLoading", "Loading repositories..."), false);
            if (confirmButton) {
                confirmButton.hidden = false;
                confirmButton.textContent = label("saveLabel", "Save");
            }

            const reposUrl = triggerButton.dataset.githubReposUrl || "";
            const payload = await fetch(reposUrl, {
                method: "GET",
                credentials: "same-origin",
                headers: { "Accept": "application/json" }
            }).then(parseJsonResponse);

            if (!payload.connected) {
                triggerButton.dataset.githubConnected = "0";
                triggerButton.classList.remove("is-connected");
                setConnectMode();
                return;
            }

            triggerButton.dataset.githubConnected = "1";
            triggerButton.classList.add("is-connected");
            const repositories = Array.isArray(payload.repositories) ? payload.repositories : [];
            if (!repositories.length) {
                setStatus(status, label("repoEmpty", "No repositories available."), false);
                if (repoList) {
                    repoList.hidden = true;
                }
                return;
            }
            renderRepositories(repoList, repositories);
            setStatus(status, "", false);
            if (repoList) {
                repoList.hidden = false;
            }
        };

        const openFromButton = async function () {
            closeMenu(host);
            setModalOpen(true);
            if (triggerButton.dataset.githubConnected !== "1") {
                setConnectMode();
                return;
            }
            try {
                await setRepositoryMode();
            } catch (error) {
                if (error && error.payload && error.payload.connected === false) {
                    triggerButton.dataset.githubConnected = "0";
                    triggerButton.classList.remove("is-connected");
                    setConnectMode();
                    return;
                }
                setElementText(title, label("repoTitle", "GitHub Repositories"));
                setElementText(message, label("repoMessage", "Select repositories to show in HanDrive."));
                setStatus(status, label("repoError", "Failed to load GitHub repositories."), true);
                if (repoList) {
                    repoList.hidden = true;
                    repoList.textContent = "";
                }
            }
        };

        const saveSelectedRepositories = async function () {
            const reposUrl = triggerButton.dataset.githubReposUrl || "";
            const selectedIds = repoList
                ? Array.from(repoList.querySelectorAll(".ui-auth-github-repo-checkbox:checked")).map(function (checkbox) {
                    return Number(checkbox.value);
                }).filter(Number.isFinite)
                : [];
            setStatus(status, label("repoLoading", "Loading repositories..."), false);
            try {
                const payload = await fetch(reposUrl, {
                    method: "POST",
                    credentials: "same-origin",
                    headers: {
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                        "X-CSRFToken": getCsrfToken()
                    },
                    body: JSON.stringify({ repository_ids: selectedIds })
                }).then(parseJsonResponse);
                setStatus(status, label("savedLabel", "Saved"), false);
                window.dispatchEvent(new CustomEvent("handrive:github-repositories-updated", {
                    detail: payload
                }));
            } catch (error) {
                setStatus(status, label("repoError", "Failed to load GitHub repositories."), true);
            }
        };

        triggerButton.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            openFromButton();
        });

        if (backdrop) {
            backdrop.addEventListener("click", function () {
                setModalOpen(false);
            });
        }

        if (cancelButton) {
            cancelButton.addEventListener("click", function () {
                setModalOpen(false);
            });
        }

        if (confirmButton) {
            confirmButton.addEventListener("click", function () {
                if (modal.dataset.mode === "repositories") {
                    saveSelectedRepositories();
                    return;
                }
                if (triggerButton.dataset.githubEnabled !== "1") {
                    setStatus(status, label("unconfigured", "GitHub connection is not configured yet."), true);
                    return;
                }
                const connectUrl = triggerButton.dataset.githubConnectUrl || "";
                if (connectUrl) {
                    window.location.href = connectUrl;
                }
            });
        }

        document.addEventListener("keydown", function (event) {
            if (event.key !== "Escape" || modal.hidden) {
                return;
            }
            event.preventDefault();
            setModalOpen(false);
        });
    };

    hosts.forEach(bindHost);
})();
