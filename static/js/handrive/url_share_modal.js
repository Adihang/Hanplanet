(function () {
    "use strict";

    function readI18n(documentRef) {
        var node = documentRef.getElementById("handrive-i18n");
        if (!node) {
            return {};
        }
        try {
            return JSON.parse(node.textContent || "{}") || {};
        } catch (error) {
            return {};
        }
    }

    function createDefaultTranslator(documentRef) {
        var messages = readI18n(documentRef);
        return function translate(key, fallbackValue) {
            if (Object.prototype.hasOwnProperty.call(messages, key)) {
                return messages[key];
            }
            return fallbackValue || key;
        };
    }

    function defaultAlertError(error) {
        var message = error && error.message ? error.message : String(error || "");
        if (message) {
            window.alert(message);
        }
    }

    function defaultSyncModalBodyState(documentRef) {
        var isOpen = Boolean(
            documentRef.querySelector(
                ".handrive-popup-modal:not([hidden]), .handrive-drive-modal:not([hidden]), .handrive-help-modal:not([hidden]), .handrive-folder-modal:not([hidden]), .handrive-sync-modal:not([hidden])"
            )
        );
        documentRef.body.classList.toggle("handrive-modal-open", isOpen);
    }

    function createHandriveUrlShareModal(options) {
        var settings = options || {};
        var documentRef = settings.documentRef || document;
        var translate = typeof settings.t === "function" ? settings.t : createDefaultTranslator(documentRef);
        var syncModalBodyState = typeof settings.syncModalBodyState === "function"
            ? settings.syncModalBodyState
            : function () { defaultSyncModalBodyState(documentRef); };
        var alertError = typeof settings.alertError === "function" ? settings.alertError : defaultAlertError;
        var shareModal = documentRef.getElementById("handrive-url-share-modal");
        var shareBackdrop = documentRef.getElementById("handrive-url-share-modal-backdrop");
        var shareCheckbox = documentRef.getElementById("handrive-url-share-enabled-checkbox");
        var shareEnabledToggle = documentRef.getElementById("handrive-url-share-enabled-toggle");
        var shareLinkGroup = shareModal ? shareModal.querySelector(".handrive-url-share-link-group") : null;
        var shareTargets = documentRef.getElementById("handrive-url-share-targets");
        var shareTargetInput = documentRef.getElementById("handrive-url-share-target-input");
        var shareTargetList = documentRef.getElementById("handrive-url-share-target-list");
        var shareTargetEmpty = shareTargets ? shareTargets.querySelector(".handrive-url-share-target-empty") : null;
        var shareUrlRow = documentRef.getElementById("handrive-url-share-url-row");
        var shareReadLabel = documentRef.getElementById("handrive-url-share-read-label");
        var shareEditToggle = documentRef.getElementById("handrive-url-share-edit-toggle");
        var shareEditCheckbox = documentRef.getElementById("handrive-url-share-edit-checkbox");
        var shareInput = documentRef.getElementById("handrive-url-share-input");
        var shareDownloadRow = documentRef.getElementById("handrive-url-share-download-row");
        var shareDownloadInput = documentRef.getElementById("handrive-url-share-download-input");
        var shareCloseButton = documentRef.getElementById("handrive-url-share-close-btn");
        var shareCopyButton = documentRef.getElementById("handrive-url-share-copy-url-icon-btn");
        var shareCopyDownloadButton = documentRef.getElementById("handrive-url-share-copy-download-icon-btn");

        if (
            !shareModal ||
            !shareBackdrop ||
            !shareCheckbox ||
            !shareEnabledToggle ||
            !shareLinkGroup ||
            !shareTargets ||
            !shareTargetInput ||
            !shareTargetList ||
            !shareEditToggle ||
            !shareEditCheckbox ||
            !shareInput ||
            !shareDownloadRow ||
            !shareDownloadInput ||
            !shareCloseButton ||
            !shareCopyButton ||
            !shareCopyDownloadButton
        ) {
            return {
                open: function () {},
                close: function () {},
            };
        }

        var lastFocusedElement = null;
        var currentOnToggle = null;
        var isToggling = false;
        var currentShareUrl = "";
        var currentShareDownloadUrl = "";
        var currentClipboardLabel = "";
        var currentAllowedUsers = [];
        var currentReadOnly = false;
        var currentShareCanEdit = false;
        var shareDisclosureCollapseTimer = null;

        function cancelShareDisclosureCollapse() {
            if (shareDisclosureCollapseTimer !== null) {
                window.clearTimeout(shareDisclosureCollapseTimer);
                shareDisclosureCollapseTimer = null;
            }
        }

        function setShareLinkGroupExpanded(expanded, onCollapsed) {
            cancelShareDisclosureCollapse();
            if (expanded) {
                shareLinkGroup.hidden = false;
                shareLinkGroup.classList.remove("is-collapsing");
                window.requestAnimationFrame(function () {
                    if (!shareLinkGroup.hidden) {
                        shareLinkGroup.classList.add("is-expanded");
                    }
                });
                return;
            }

            if (shareLinkGroup.hidden) {
                if (typeof onCollapsed === "function") {
                    onCollapsed();
                }
                return;
            }

            shareLinkGroup.classList.remove("is-expanded");
            shareLinkGroup.classList.add("is-collapsing");
            shareDisclosureCollapseTimer = window.setTimeout(function () {
                shareDisclosureCollapseTimer = null;
                shareLinkGroup.hidden = true;
                shareLinkGroup.classList.remove("is-collapsing");
                if (typeof onCollapsed === "function") {
                    onCollapsed();
                }
            }, 200);
        }

        function removeLanguagePrefixFromShareUrl(url) {
            var rawUrl = String(url || "").trim();
            if (!rawUrl) {
                return "";
            }
            var languagePrefixPattern = /^([a-z][a-z0-9+.-]*:\/\/[^/]+)?\/(?:ko|en)(?=\/handrive(?:\/|$))/i;
            if (!languagePrefixPattern.test(rawUrl)) {
                return rawUrl;
            }
            try {
                var parsedUrl = new URL(rawUrl, window.location.href);
                parsedUrl.pathname = parsedUrl.pathname.replace(/^\/(?:ko|en)(?=\/handrive(?:\/|$))/i, "");
                if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl)) {
                    return parsedUrl.href;
                }
                return parsedUrl.pathname + parsedUrl.search + parsedUrl.hash;
            } catch (error) {
                return rawUrl.replace(languagePrefixPattern, "$1");
            }
        }

        function decodeUrlForDisplay(url) {
            var rawUrl = String(url || "");
            if (!rawUrl) {
                return "";
            }
            try {
                return decodeURI(rawUrl);
            } catch (error) {
                return rawUrl;
            }
        }

        function getUrlPageName(url) {
            var rawUrl = String(url || "").trim();
            if (!rawUrl) {
                return "";
            }
            try {
                var parsedUrl = new URL(rawUrl, window.location.href);
                var pathParts = parsedUrl.pathname.split("/").filter(Boolean);
                var pageName = pathParts.length ? pathParts[pathParts.length - 1] : parsedUrl.hostname;
                return decodeURIComponent(pageName || "").trim();
            } catch (error) {
                return rawUrl;
            }
        }

        function getClipboardLinkLabel(value) {
            return currentClipboardLabel || getUrlPageName(value) || value;
        }

        function createClipboardLinkHtml(value, label) {
            var anchor = documentRef.createElement("a");
            anchor.href = value;
            anchor.textContent = label;
            return anchor.outerHTML;
        }

        async function writeMultiFormatUrlToClipboard(value) {
            var clipboard = navigator.clipboard;
            var ClipboardItemConstructor = window.ClipboardItem;
            if (clipboard && typeof clipboard.write === "function" && typeof ClipboardItemConstructor === "function") {
                try {
                    var label = getClipboardLinkLabel(value);
                    var html = createClipboardLinkHtml(value, label);
                    var item = new ClipboardItemConstructor({
                        "text/plain": new Blob([value], { type: "text/plain" }),
                        "text/html": new Blob([html], { type: "text/html" }),
                    });
                    await clipboard.write([item]);
                    return;
                } catch (error) {
                    // Some browsers expose ClipboardItem but reject HTML clipboard writes.
                }
            }
            if (clipboard && typeof clipboard.writeText === "function") {
                await clipboard.writeText(value);
                return;
            }
            throw new Error("Clipboard API is unavailable");
        }

        function setCopyButtonLabel(button, key, fallbackLabel) {
            var label = translate(key, fallbackLabel);
            button.setAttribute("aria-label", label);
            button.setAttribute("title", label);
        }

        function resetCopyButton(button, key, fallbackLabel) {
            button.classList.remove("is-copied");
            setCopyButtonLabel(button, key, fallbackLabel);
        }

        function setUrlRowVisible(visible, url, downloadUrl) {
            currentShareUrl = visible ? removeLanguagePrefixFromShareUrl(url) : "";
            currentShareDownloadUrl = visible ? removeLanguagePrefixFromShareUrl(downloadUrl) : "";

            function updateShareLinkRows(rowsVisible) {
                shareTargets.hidden = !rowsVisible || currentReadOnly;
                shareUrlRow.hidden = !rowsVisible;
                shareEditToggle.hidden = !rowsVisible || currentReadOnly;
                shareEditCheckbox.disabled = !rowsVisible || currentReadOnly || isToggling || !currentOnToggle;
                shareDownloadRow.hidden = currentReadOnly || !(rowsVisible && currentShareDownloadUrl);
                shareCopyButton.disabled = !(rowsVisible && currentShareUrl);
                shareCopyDownloadButton.disabled = !(rowsVisible && currentShareDownloadUrl);
                if (shareReadLabel) {
                    shareReadLabel.textContent = currentShareDownloadUrl
                        ? translate("url_share_read_label", "읽기 URL")
                        : translate("url_share_label", "URL");
                }
                if (rowsVisible) {
                    shareInput.value = decodeUrlForDisplay(currentShareUrl);
                    shareDownloadInput.value = decodeUrlForDisplay(currentShareDownloadUrl);
                } else {
                    shareInput.value = "";
                    shareDownloadInput.value = "";
                }
                resetCopyButton(shareCopyButton, "url_share_copy_button", "복사");
                resetCopyButton(shareCopyDownloadButton, "url_share_copy_download_button", "다운로드 URL 복사");
            }

            if (visible) {
                updateShareLinkRows(true);
                setShareLinkGroupExpanded(true);
                return;
            }

            shareCopyButton.disabled = true;
            shareCopyDownloadButton.disabled = true;
            setShareLinkGroupExpanded(false, function () {
                updateShareLinkRows(false);
            });
        }

        function normalizeAllowedUsers(users) {
            var result = [];
            var seen = new Set();
            if (!Array.isArray(users)) {
                return result;
            }
            users.forEach(function (user) {
                var username = "";
                var label = "";
                var id = "";
                if (user && typeof user === "object") {
                    username = String(user.username || user.label || user.id || "").trim();
                    label = String(user.label || username).trim();
                    id = user.id || "";
                } else {
                    username = String(user || "").trim();
                    label = username;
                }
                if (!username || seen.has(username)) {
                    return;
                }
                seen.add(username);
                result.push({
                    id: id,
                    username: username,
                    label: label || username,
                });
            });
            return result;
        }

        function getAllowedUsernames() {
            return currentAllowedUsers.map(function (user) {
                return String(user.username || "").trim();
            }).filter(Boolean);
        }

        function getResultCanEdit(result, fallbackValue) {
            if (!result || typeof result !== "object") {
                return Boolean(fallbackValue);
            }
            if (Object.prototype.hasOwnProperty.call(result, "canEdit")) {
                return Boolean(result.canEdit);
            }
            if (Object.prototype.hasOwnProperty.call(result, "share_can_edit")) {
                return Boolean(result.share_can_edit);
            }
            if (Object.prototype.hasOwnProperty.call(result, "editEnabled")) {
                return Boolean(result.editEnabled);
            }
            return Boolean(fallbackValue);
        }

        function setTargetControlsDisabled(disabled) {
            var isDisabled = Boolean(disabled || currentReadOnly || !currentOnToggle);
            shareTargetInput.disabled = isDisabled;
            shareTargetList.querySelectorAll(".handrive-url-share-target-remove").forEach(function (button) {
                button.disabled = isDisabled;
            });
            shareEditCheckbox.disabled = Boolean(isDisabled || !shareCheckbox.checked);
        }

        function dispatchShareUpdated(result) {
            var detail = {
                enabled: Boolean(shareCheckbox.checked),
                canEdit: Boolean(currentShareCanEdit),
                shareUrl: currentShareUrl,
                downloadUrl: currentShareDownloadUrl,
                allowedUsers: currentAllowedUsers.slice(),
                result: result || null,
            };
            var eventObject = null;
            if (typeof window.CustomEvent === "function") {
                eventObject = new window.CustomEvent("handrive:url-share-updated", {
                    bubbles: true,
                    detail: detail,
                });
            } else {
                eventObject = documentRef.createEvent("CustomEvent");
                eventObject.initCustomEvent("handrive:url-share-updated", true, false, detail);
            }
            shareModal.dispatchEvent(eventObject);
        }

        function renderAllowedUsers() {
            shareTargetList.innerHTML = "";
            shareTargetList.hidden = true;
            if (currentReadOnly) {
                if (shareTargetEmpty) {
                    shareTargetEmpty.hidden = true;
                }
                setTargetControlsDisabled(true);
                return;
            }
            var removeLabel = translate("url_share_target_remove_label", "공유 대상 제거");
            var controlsDisabled = currentReadOnly || isToggling || !currentOnToggle;
            currentAllowedUsers.forEach(function (user) {
                var card = documentRef.createElement("span");
                card.className = "handrive-url-share-target-card";

                var label = documentRef.createElement("span");
                label.textContent = user.label || user.username;
                label.title = user.label || user.username;
                card.appendChild(label);

                var removeButton = documentRef.createElement("button");
                removeButton.type = "button";
                removeButton.className = "handrive-url-share-target-remove";
                removeButton.textContent = "x";
                removeButton.setAttribute("aria-label", removeLabel);
                removeButton.title = removeLabel;
                removeButton.disabled = controlsDisabled;
                removeButton.addEventListener("click", function () {
                    removeAllowedUser(user.username);
                });
                card.appendChild(removeButton);

                shareTargetList.appendChild(card);
            });
            shareTargetList.hidden = currentAllowedUsers.length === 0;
            if (shareTargetEmpty) {
                shareTargetEmpty.hidden = currentAllowedUsers.length > 0;
            }
            setTargetControlsDisabled(controlsDisabled);
        }

        async function persistShareSettings(enabled, previousAllowedUsers, previousChecked) {
            if (!currentOnToggle || isToggling) {
                return;
            }
            var previousCanEdit = currentShareCanEdit;
            isToggling = true;
            shareModal.classList.add("is-share-updating");
            shareCheckbox.disabled = true;
            setTargetControlsDisabled(true);
            try {
                var nextCanEdit = Boolean(enabled && shareEditCheckbox.checked);
                var result = await currentOnToggle(enabled, getAllowedUsernames(), nextCanEdit);
                shareCheckbox.checked = Boolean(result && result.isUrlOnly);
                currentShareCanEdit = getResultCanEdit(result, nextCanEdit && shareCheckbox.checked);
                shareEditCheckbox.checked = currentShareCanEdit;
                currentAllowedUsers = normalizeAllowedUsers(
                    (result && (result.allowedUsers || result.share_allowed_users)) || currentAllowedUsers
                );
                setUrlRowVisible(
                    shareCheckbox.checked,
                    (result && result.shareUrl) || "",
                    (result && result.downloadUrl) || ""
                );
                renderAllowedUsers();
                dispatchShareUpdated(result);
            } catch (error) {
                currentAllowedUsers = normalizeAllowedUsers(previousAllowedUsers);
                currentShareCanEdit = previousCanEdit;
                shareEditCheckbox.checked = previousCanEdit;
                shareCheckbox.checked = Boolean(previousChecked);
                renderAllowedUsers();
                alertError(error);
            } finally {
                shareCheckbox.disabled = currentReadOnly;
                isToggling = false;
                setTargetControlsDisabled(false);
                shareModal.classList.remove("is-share-updating");
            }
        }

        function addAllowedUser(username) {
            var normalizedUsername = String(username || "").trim();
            if (!normalizedUsername) {
                return;
            }
            if (currentAllowedUsers.some(function (user) { return user.username === normalizedUsername; })) {
                shareTargetInput.value = "";
                return;
            }
            var previousAllowedUsers = currentAllowedUsers.slice();
            currentAllowedUsers = currentAllowedUsers.concat([{
                id: "",
                username: normalizedUsername,
                label: normalizedUsername,
            }]);
            shareTargetInput.value = "";
            renderAllowedUsers();
            if (shareCheckbox.checked && currentOnToggle) {
                persistShareSettings(true, previousAllowedUsers, true);
            }
        }

        function removeAllowedUser(username) {
            if (currentReadOnly || isToggling || !currentOnToggle) {
                return;
            }
            var previousAllowedUsers = currentAllowedUsers.slice();
            currentAllowedUsers = currentAllowedUsers.filter(function (user) {
                return user.username !== username;
            });
            renderAllowedUsers();
            if (shareCheckbox.checked) {
                persistShareSettings(true, previousAllowedUsers, true);
            }
        }

        function close() {
            if (shareModal.hidden) {
                return;
            }
            shareModal.hidden = true;
            cancelShareDisclosureCollapse();
            shareLinkGroup.hidden = true;
            shareLinkGroup.classList.remove("is-expanded", "is-collapsing");
            shareModal.classList.remove("is-share-updating");
            currentOnToggle = null;
            isToggling = false;
            currentReadOnly = false;
            currentShareCanEdit = false;
            currentClipboardLabel = "";
            currentAllowedUsers = [];
            shareCheckbox.disabled = false;
            shareEnabledToggle.hidden = false;
            shareEditCheckbox.checked = false;
            shareEditCheckbox.disabled = false;
            shareEditToggle.hidden = true;
            shareTargetInput.value = "";
            shareTargets.hidden = true;
            renderAllowedUsers();
            resetCopyButton(shareCopyButton, "url_share_copy_button", "복사");
            resetCopyButton(shareCopyDownloadButton, "url_share_copy_download_button", "다운로드 URL 복사");
            if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
                lastFocusedElement.focus();
            }
            lastFocusedElement = null;
            syncModalBodyState();
        }

        async function copyUrlToClipboard(value, input, button, labelKey, fallbackLabel) {
            if (!value) {
                return;
            }
            try {
                try {
                    await writeMultiFormatUrlToClipboard(value);
                } catch (error) {
                    input.focus();
                    input.select();
                    documentRef.execCommand("copy");
                }
                setCopyButtonLabel(button, "url_share_copied", "복사됨");
                if (typeof window.showHandriveInlineCopyFeedback === "function") {
                    window.showHandriveInlineCopyFeedback(button, translate("url_share_copy_feedback", "복사됨!"));
                }
                window.setTimeout(function () {
                    resetCopyButton(button, labelKey, fallbackLabel);
                }, 1400);
            } catch (error) {
                input.focus();
                input.select();
            }
        }

        async function copyCurrentUrl() {
            await copyUrlToClipboard(
                currentShareUrl || shareInput.value || "",
                shareInput,
                shareCopyButton,
                "url_share_copy_button",
                "복사"
            );
        }

        async function copyCurrentDownloadUrl() {
            await copyUrlToClipboard(
                currentShareDownloadUrl || shareDownloadInput.value || "",
                shareDownloadInput,
                shareCopyDownloadButton,
                "url_share_copy_download_button",
                "다운로드 URL 복사"
            );
        }

        function open(options) {
            var isUrlOnly = Boolean(options && options.isUrlOnly);
            var shareUrl = (options && options.shareUrl) || "";
            var downloadUrl = (options && options.downloadUrl) || "";
            var readOnly = Boolean(options && options.readOnly);
            currentClipboardLabel = String((options && options.clipboardLabel) || "").trim();
            currentReadOnly = readOnly;
            currentOnToggle = (!readOnly && options && typeof options.onToggle === "function") ? options.onToggle : null;
            currentAllowedUsers = readOnly ? [] : normalizeAllowedUsers((options && options.allowedUsers) || []);
            currentShareCanEdit = Boolean(options && (options.canEdit || options.shareCanEdit || options.editEnabled));
            shareEditCheckbox.checked = currentShareCanEdit;
            shareTargetInput.value = "";
            renderAllowedUsers();

            shareCheckbox.checked = isUrlOnly;
            shareCheckbox.disabled = readOnly;
            shareEnabledToggle.hidden = readOnly;
            setTargetControlsDisabled(false);
            setUrlRowVisible(isUrlOnly || readOnly, shareUrl, downloadUrl);
            shareModal.hidden = false;
            lastFocusedElement = documentRef.activeElement;
            syncModalBodyState();
            window.requestAnimationFrame(function () {
                if (readOnly && shareInput) {
                    shareInput.focus();
                    shareInput.select();
                    return;
                }
                shareCheckbox.focus();
            });
        }

        shareCheckbox.addEventListener("change", function () {
            if (isToggling || !currentOnToggle) {
                return;
            }
            var enabled = shareCheckbox.checked;
            persistShareSettings(enabled, currentAllowedUsers.slice(), !enabled);
        });

        shareEditCheckbox.addEventListener("change", function () {
            if (isToggling || !currentOnToggle || currentReadOnly || !shareCheckbox.checked) {
                shareEditCheckbox.checked = currentShareCanEdit;
                return;
            }
            persistShareSettings(true, currentAllowedUsers.slice(), true);
        });

        shareTargetInput.addEventListener("keydown", function (event) {
            if (event.key !== "Enter") {
                return;
            }
            event.preventDefault();
            addAllowedUser(shareTargetInput.value);
        });

        shareBackdrop.addEventListener("click", close);
        shareCloseButton.addEventListener("click", close);
        shareCopyButton.addEventListener("click", function () {
            copyCurrentUrl().catch(function () {});
        });
        shareCopyDownloadButton.addEventListener("click", function () {
            copyCurrentDownloadUrl().catch(function () {});
        });
        documentRef.addEventListener("keydown", function (event) {
            if (event.key !== "Escape" || shareModal.hidden) {
                return;
            }
            event.preventDefault();
            close();
        });

        return { open: open, close: close };
    }

    window.HandriveUrlShareModal = Object.assign({}, window.HandriveUrlShareModal, {
        create: createHandriveUrlShareModal,
    });
    window.createHandriveUrlShareModal = createHandriveUrlShareModal;
})();
