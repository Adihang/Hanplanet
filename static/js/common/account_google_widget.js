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

    const bindHost = function (host) {
        const triggerButton = host.querySelector("[data-auth-google-trigger]");
        const modal = host.querySelector("[data-auth-google-modal]");
        if (!triggerButton || !modal || triggerButton.dataset.googleWidgetBound === "1") {
            return;
        }
        triggerButton.dataset.googleWidgetBound = "1";

        const backdrop = modal.querySelector("[data-auth-google-modal-backdrop]");
        const title = modal.querySelector("[data-auth-google-modal-title]");
        const message = modal.querySelector("[data-auth-google-modal-message]");
        const status = modal.querySelector("[data-auth-google-status]");
        const driveToggleWrap = modal.querySelector("[data-auth-google-drive-toggle-wrap]");
        const driveToggle = modal.querySelector("[data-auth-google-drive-toggle]");
        const driveHint = modal.querySelector("[data-auth-google-drive-hint]");
        const cancelButton = modal.querySelector("[data-auth-google-cancel]");
        const confirmButton = modal.querySelector("[data-auth-google-confirm]");
        const unlinkButton = modal.querySelector("[data-auth-google-unlink]");
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

        const setConnectMode = function (statusMessage, statusIsError) {
            modal.dataset.mode = "connect";
            setElementText(title, label("connectTitle", "Connect Google"));
            setElementText(message, label("connectMessage", "No Google account is connected. Connect Google now?"));
            if (driveToggleWrap) {
                driveToggleWrap.hidden = true;
            }
            if (driveHint) {
                driveHint.hidden = true;
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

        const setConnectedMode = function () {
            const email = String(triggerButton.dataset.googleEmail || "").trim();
            const baseMessage = label("connectedMessage", "Connected Google account:");
            modal.dataset.mode = "connected";
            setElementText(title, label("connectedTitle", "Google Connected"));
            setElementText(message, email ? baseMessage + " " + email : baseMessage);
            if (driveToggle) {
                driveToggle.checked = triggerButton.dataset.googleDriveEnabled === "1";
            }
            if (driveToggleWrap) {
                driveToggleWrap.hidden = false;
            }
            if (driveHint) {
                driveHint.hidden = false;
            }
            if (unlinkButton) {
                unlinkButton.hidden = false;
                unlinkButton.textContent = label("unlinkLabel", "Disconnect");
            }
            setStatus(status, "", false);
            if (confirmButton) {
                confirmButton.hidden = false;
                confirmButton.textContent = label("saveLabel", "Save");
            }
        };

        const openFromButton = function () {
            closeMenu(host);
            setModalOpen(true);
            if (triggerButton.dataset.googleConnected === "1") {
                setConnectedMode();
                return;
            }
            setConnectMode();
        };

        const saveGoogleDriveSetting = async function () {
            const settingsUrl = triggerButton.dataset.googleDriveSettingsUrl || "";
            if (!settingsUrl) {
                setStatus(status, label("saveError", "Failed to save Google Drive setting."), true);
                return;
            }
            if (confirmButton) {
                confirmButton.disabled = true;
            }
            try {
                const payload = await fetch(settingsUrl, {
                    method: "POST",
                    credentials: "same-origin",
                    headers: {
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                        "X-CSRFToken": getCsrfToken()
                    },
                    body: JSON.stringify({ enabled: Boolean(driveToggle && driveToggle.checked) })
                }).then(parseJsonResponse);
                const enabled = payload.google_drive_enabled === true;
                triggerButton.dataset.googleDriveEnabled = enabled ? "1" : "0";
                if (driveToggle) {
                    driveToggle.checked = enabled;
                }
                setStatus(status, label("savedLabel", "Saved"), false);
                window.dispatchEvent(new CustomEvent("handrive:google-drive-updated", {
                    detail: payload
                }));
                setModalOpen(false);
            } catch (error) {
                setStatus(status, payloadMessage(error && error.payload, label("saveError", "Failed to save Google Drive setting.")), true);
            } finally {
                if (confirmButton) {
                    confirmButton.disabled = false;
                }
            }
        };

        const unlinkGoogle = async function () {
            const unlinkUrl = triggerButton.dataset.googleUnlinkUrl || "";
            if (!unlinkUrl) {
                setStatus(status, label("unlinkError", "Failed to disconnect Google."), true);
                return;
            }
            const confirmMessage = label("unlinkConfirm", "Disconnect Google?");
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
                triggerButton.dataset.googleConnected = "0";
                triggerButton.dataset.googleEmail = "";
                triggerButton.dataset.googleDriveEnabled = "0";
                triggerButton.classList.remove("is-connected");
                if (driveToggle) {
                    driveToggle.checked = false;
                }
                setConnectMode(label("unlinkedLabel", "Disconnected"), false);
                window.dispatchEvent(new CustomEvent("handrive:google-drive-updated", {
                    detail: payload
                }));
            } catch (error) {
                setStatus(status, payloadMessage(error && error.payload, label("unlinkError", "Failed to disconnect Google.")), true);
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

        if (cancelButton) {
            cancelButton.addEventListener("click", function () {
                setModalOpen(false);
            });
        }

        if (unlinkButton) {
            unlinkButton.addEventListener("click", function () {
                unlinkGoogle();
            });
        }

        if (confirmButton) {
            confirmButton.addEventListener("click", function () {
                if (modal.dataset.mode === "connected") {
                    saveGoogleDriveSetting();
                    return;
                }
                if (modal.dataset.mode !== "connect") {
                    return;
                }
                if (triggerButton.dataset.googleEnabled !== "1") {
                    setStatus(status, label("unconfigured", "Google connection is not configured yet."), true);
                    return;
                }
                const connectUrl = triggerButton.dataset.googleConnectUrl || "";
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
