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

    const getUiLang = function () {
        const lang = String(document.documentElement.getAttribute("lang") || "").toLowerCase();
        return lang.indexOf("en") === 0 ? "en" : "ko";
    };

    const selectLocalizedMessage = function (messages) {
        if (!messages || typeof messages !== "object") {
            return "";
        }
        const lang = getUiLang();
        return String(messages[lang] || messages.ko || messages.en || "").trim();
    };

    const payloadMessage = function (payload, fallback) {
        if (!payload || typeof payload !== "object") {
            return fallback || "";
        }
        return (
            selectLocalizedMessage(payload.error_messages)
            || selectLocalizedMessage(payload.messages)
            || String(payload.error_message || payload.message || "").trim()
            || fallback
            || ""
        );
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
            const error = new Error(payloadMessage(payload, payload.error || "request_failed"));
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
        const account = modal.querySelector("[data-auth-github-account]");
        const status = modal.querySelector("[data-auth-github-status]");
        const repoList = modal.querySelector("[data-auth-github-repo-list]");
        const cancelButtons = Array.from(modal.querySelectorAll("[data-auth-github-cancel]"));
        const cancelButton = cancelButtons.find(function (button) {
            return !button.classList.contains("site-modal-close");
        }) || cancelButtons[0] || null;
        const confirmButton = modal.querySelector("[data-auth-github-confirm]");
        const unlinkButton = modal.querySelector("[data-auth-github-unlink]");
        let lastFocusedElement = null;

        const label = function (key, fallback) {
            return modal.dataset[key] || fallback || "";
        };

        const setAccountMessage = function (login) {
            if (!account) {
                return;
            }
            const normalizedLogin = String(login || "").trim();
            account.hidden = !normalizedLogin;
            account.textContent = normalizedLogin
                ? label("connectedMessage", "Connected GitHub account:") + " " + normalizedLogin
                : "";
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

        const setConnectMode = function (statusMessage, statusIsError) {
            modal.dataset.mode = "connect";
            setElementText(title, label("connectTitle", "Connect GitHub"));
            setElementText(message, label("connectMessage", "No GitHub account is connected. Connect GitHub now?"));
            setAccountMessage("");
            if (repoList) {
                repoList.hidden = true;
                repoList.textContent = "";
            }
            if (unlinkButton) {
                unlinkButton.hidden = true;
                unlinkButton.textContent = label("unlinkLabel", "Disconnect");
            }
            setStatus(status, statusMessage || "", Boolean(statusIsError));
            if (confirmButton) {
                confirmButton.hidden = false;
                confirmButton.textContent = label("connectConfirm", "Connect");
            }
        };

        const setRepositoryMode = async function () {
            modal.dataset.mode = "repositories";
            setElementText(title, label("repoTitle", "GitHub Repositories"));
            setElementText(message, label("repoMessage", "Select repositories to show in HanDrive."));
            setAccountMessage(triggerButton.dataset.githubLogin || "");
            if (repoList) {
                repoList.hidden = true;
                repoList.textContent = "";
            }
            if (unlinkButton) {
                unlinkButton.hidden = false;
                unlinkButton.textContent = label("unlinkLabel", "Disconnect");
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
                setConnectMode(payloadMessage(payload, ""), Boolean(payload.error));
                return;
            }

            triggerButton.dataset.githubConnected = "1";
            triggerButton.dataset.githubLogin = String(payload.login || triggerButton.dataset.githubLogin || "").trim();
            triggerButton.classList.add("is-connected");
            setAccountMessage(triggerButton.dataset.githubLogin || "");
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
                if (
                    error &&
                    error.payload &&
                    (error.payload.connected === false || error.payload.error === "github_reconnect_required")
                ) {
                    triggerButton.dataset.githubConnected = "0";
                    triggerButton.classList.remove("is-connected");
                    setConnectMode(payloadMessage(error.payload, ""), Boolean(error.payload.error));
                    return;
                }
                setElementText(title, label("repoTitle", "GitHub Repositories"));
                setElementText(message, label("repoMessage", "Select repositories to show in HanDrive."));
                setStatus(status, payloadMessage(error && error.payload, label("repoError", "Failed to load GitHub repositories.")), true);
                if (unlinkButton) {
                    unlinkButton.hidden = false;
                    unlinkButton.textContent = label("unlinkLabel", "Disconnect");
                }
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
                setModalOpen(false);
            } catch (error) {
                setStatus(status, payloadMessage(error && error.payload, label("repoError", "Failed to load GitHub repositories.")), true);
            }
        };

        const unlinkGitHub = async function () {
            const unlinkUrl = triggerButton.dataset.githubUnlinkUrl || "";
            if (!unlinkUrl) {
                setStatus(status, label("unlinkError", "Failed to disconnect GitHub."), true);
                return;
            }
            const confirmMessage = label("unlinkConfirm", "Disconnect GitHub?");
            if (confirmMessage && !window.confirm(confirmMessage)) {
                return;
            }
            if (unlinkButton) {
                unlinkButton.disabled = true;
            }
            if (confirmButton) {
                confirmButton.disabled = true;
            }
            try {
                const payload = await fetch(unlinkUrl, {
                    method: "DELETE",
                    credentials: "same-origin",
                    headers: {
                        "Accept": "application/json",
                        "X-CSRFToken": getCsrfToken()
                    }
                }).then(parseJsonResponse);
                triggerButton.dataset.githubConnected = "0";
                triggerButton.dataset.githubLogin = "";
                triggerButton.classList.remove("is-connected");
                setConnectMode(label("unlinkedLabel", "Disconnected"), false);
                window.dispatchEvent(new CustomEvent("handrive:github-repositories-updated", {
                    detail: payload
                }));
            } catch (error) {
                setStatus(status, payloadMessage(error && error.payload, label("unlinkError", "Failed to disconnect GitHub.")), true);
            } finally {
                if (unlinkButton) {
                    unlinkButton.disabled = false;
                }
                if (confirmButton) {
                    confirmButton.disabled = false;
                }
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

        cancelButtons.forEach(function (button) {
            button.addEventListener("click", function () {
                setModalOpen(false);
            });
        });

        if (unlinkButton) {
            unlinkButton.addEventListener("click", function () {
                unlinkGitHub();
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
