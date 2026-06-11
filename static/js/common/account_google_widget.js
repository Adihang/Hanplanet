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

    const redirectToGoogleDriveAuthIfRequired = function (payload) {
        if (payload && payload.requires_google_drive_auth && payload.auth_url) {
            window.location.href = payload.auth_url;
            return true;
        }
        return false;
    };

    const getWindowScrollSnapshot = function () {
        return {
            x: window.pageXOffset || document.documentElement.scrollLeft || document.body.scrollLeft || 0,
            y: window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0
        };
    };

    const restoreWindowScroll = function (snapshot) {
        if (!snapshot) {
            return;
        }
        try {
            window.scrollTo(snapshot.x || 0, snapshot.y || 0);
        } catch (error) {}
    };

    const preserveWindowScrollAfterPickerOpen = function (snapshot) {
        restoreWindowScroll(snapshot);
        [0, 50, 150, 350, 700].forEach(function (delay) {
            window.setTimeout(function () {
                restoreWindowScroll(snapshot);
            }, delay);
        });
        window.requestAnimationFrame(function () {
            restoreWindowScroll(snapshot);
            window.requestAnimationFrame(function () {
                restoreWindowScroll(snapshot);
            });
        });
    };

    const setGooglePickerOpeningFlag = function () {
        document.documentElement.dataset.googlePickerOpening = "1";
        window.setTimeout(function () {
            if (document.documentElement.dataset.googlePickerOpening === "1") {
                delete document.documentElement.dataset.googlePickerOpening;
            }
        }, 1200);
    };

    let googlePickerApiPromise = null;

    const loadGooglePickerApi = function () {
        if (window.google && window.google.picker) {
            return Promise.resolve();
        }
        if (googlePickerApiPromise) {
            return googlePickerApiPromise;
        }
        googlePickerApiPromise = new Promise(function (resolve, reject) {
            const loadPicker = function () {
                if (!window.gapi || typeof window.gapi.load !== "function") {
                    reject(new Error("Google API loader is not available."));
                    return;
                }
                window.gapi.load("picker", {
                    callback: resolve,
                    onerror: function () {
                        reject(new Error("Google Picker API failed to load."));
                    },
                    timeout: 10000,
                    ontimeout: function () {
                        reject(new Error("Google Picker API load timed out."));
                    }
                });
            };

            if (window.gapi && typeof window.gapi.load === "function") {
                loadPicker();
                return;
            }

            const existingScript = document.querySelector('script[src="https://apis.google.com/js/api.js"]');
            if (existingScript) {
                existingScript.addEventListener("load", loadPicker, { once: true });
                existingScript.addEventListener("error", function () {
                    reject(new Error("Google API script failed to load."));
                }, { once: true });
                return;
            }

            const script = document.createElement("script");
            script.src = "https://apis.google.com/js/api.js";
            script.async = true;
            script.defer = true;
            script.onload = loadPicker;
            script.onerror = function () {
                reject(new Error("Google API script failed to load."));
            };
            document.head.appendChild(script);
        });
        return googlePickerApiPromise;
    };

    const getPickerDocumentValue = function (documentValue, constantName, fallbackKey) {
        const picker = window.google && window.google.picker;
        const constants = picker && picker.Document;
        const constantKey = constants && constants[constantName];
        return (
            documentValue[constantKey]
            || documentValue[fallbackKey]
            || documentValue[constantName]
            || ""
        );
    };

    const normalizePickerDocument = function (documentValue) {
        if (!documentValue || typeof documentValue !== "object") {
            return null;
        }
        const id = String(getPickerDocumentValue(documentValue, "ID", "id") || "").trim();
        if (!id) {
            return null;
        }
        const name = String(
            getPickerDocumentValue(documentValue, "NAME", "name")
            || getPickerDocumentValue(documentValue, "TITLE", "title")
            || id
        ).trim();
        return {
            id,
            name: name || id,
            mimeType: String(getPickerDocumentValue(documentValue, "MIME_TYPE", "mimeType") || "").trim(),
            url: String(getPickerDocumentValue(documentValue, "URL", "url") || "").trim(),
            iconUrl: String(getPickerDocumentValue(documentValue, "ICON_URL", "iconUrl") || "").trim(),
            lastEditedUtc: String(getPickerDocumentValue(documentValue, "LAST_EDITED_UTC", "lastEditedUtc") || "").trim()
        };
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
                if (payload.requires_google_drive_auth && payload.auth_url) {
                    window.location.href = payload.auth_url;
                    return;
                }
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

        const saveGoogleDriveItems = async function (items) {
            const driveItemsUrl = triggerButton.dataset.googleDriveItemsUrl || "";
            if (!driveItemsUrl) {
                throw new Error(label("pickerError", "Failed to open Google Picker."));
            }
            const payload = await fetch(driveItemsUrl, {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "X-CSRFToken": getCsrfToken()
                },
                body: JSON.stringify({ items })
            }).then(parseJsonResponse);
            triggerButton.dataset.googleDriveSelectedCount = String(payload.selected_count || 0);
            window.dispatchEvent(new CustomEvent("handrive:google-drive-updated", {
                detail: payload
            }));
            return payload;
        };

        const buildPickerView = function (viewId) {
            const picker = window.google && window.google.picker;
            const view = viewId ? new picker.DocsView(viewId) : new picker.DocsView();
            if (typeof view.setIncludeFolders === "function") {
                view.setIncludeFolders(true);
            }
            if (typeof view.setSelectFolderEnabled === "function") {
                view.setSelectFolderEnabled(true);
            }
            if (picker.DocsViewMode && picker.DocsViewMode.LIST && typeof view.setMode === "function") {
                view.setMode(picker.DocsViewMode.LIST);
            }
            return view;
        };

        const openGooglePicker = async function (options) {
            const settings = options || {};
            const statusElement = settings.statusElement === undefined ? status : settings.statusElement;
            const busyElement = settings.busyElement || null;
            const throwOnError = Boolean(settings.throwOnError);
            const configUrl = triggerButton.dataset.googlePickerConfigUrl || "";
            if (!configUrl) {
                const error = new Error(label("pickerError", "Failed to open Google Picker."));
                setStatus(statusElement, error.message, true);
                if (throwOnError) {
                    throw error;
                }
                return null;
            }
            if (busyElement) {
                busyElement.disabled = true;
            }
            setStatus(statusElement, label("pickerLoading", "Opening Google Picker..."), false);
            try {
                const configPayload = await fetch(configUrl, {
                    method: "GET",
                    credentials: "same-origin",
                    headers: {
                        "Accept": "application/json"
                    }
                }).then(parseJsonResponse);
                await loadGooglePickerApi();

                const picker = window.google && window.google.picker;
                if (!picker || !picker.PickerBuilder) {
                    throw new Error(label("pickerError", "Failed to open Google Picker."));
                }

                const builder = new picker.PickerBuilder()
                    .setOAuthToken(configPayload.access_token)
                    .setDeveloperKey(configPayload.api_key)
                    .setCallback(function (data) {
                        const action = data && data[picker.Response.ACTION];
                        if (action !== picker.Action.PICKED) {
                            return;
                        }
                        const documents = data[picker.Response.DOCUMENTS] || [];
                        const items = documents.map(normalizePickerDocument).filter(Boolean);
                        if (!items.length) {
                            return;
                        }
                        saveGoogleDriveItems(items)
                            .then(function (payload) {
                                setStatus(statusElement, label("pickerSaved", "Google Drive items saved."), false);
                                if (typeof settings.onSaved === "function") {
                                    settings.onSaved(payload);
                                }
                            })
                            .catch(function (error) {
                                if (redirectToGoogleDriveAuthIfRequired(error && error.payload)) {
                                    return;
                                }
                                const message = payloadMessage(error && error.payload, label("pickerError", "Failed to open Google Picker."));
                                setStatus(statusElement, message, true);
                                if (!statusElement && window.console && typeof window.console.error === "function") {
                                    window.console.error(error);
                                }
                            });
                    });

                if (configPayload.app_id && typeof builder.setAppId === "function") {
                    builder.setAppId(configPayload.app_id);
                }
                if (typeof builder.setOrigin === "function") {
                    builder.setOrigin(window.location.protocol + "//" + window.location.host);
                }

                builder.addView(buildPickerView(picker.ViewId && picker.ViewId.DOCS));
                if (picker.ViewId && picker.ViewId.FOLDERS) {
                    builder.addView(buildPickerView(picker.ViewId.FOLDERS));
                }
                if (picker.Feature && picker.Feature.MULTISELECT_ENABLED) {
                    builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
                }
                const scrollSnapshot = getWindowScrollSnapshot();
                setGooglePickerOpeningFlag();
                builder.build().setVisible(true);
                preserveWindowScrollAfterPickerOpen(scrollSnapshot);
                setStatus(statusElement, "", false);
                return true;
            } catch (error) {
                if (redirectToGoogleDriveAuthIfRequired(error && error.payload)) {
                    return null;
                }
                setStatus(statusElement, payloadMessage(error && error.payload, error.message || label("pickerError", "Failed to open Google Picker.")), true);
                if (throwOnError) {
                    throw error;
                }
                return null;
            } finally {
                if (busyElement) {
                    busyElement.disabled = false;
                }
            }
        };

        window.HandriveGoogleDrivePicker = {
            open: function (options) {
                const settings = Object.assign({
                    statusElement: null,
                    throwOnError: true
                }, options || {});
                return openGooglePicker(settings);
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
                triggerButton.dataset.googleDriveSelectedCount = "0";
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
