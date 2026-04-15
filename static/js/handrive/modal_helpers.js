(function () {
    "use strict";

    // Modal helpers keep open/close state and checkbox list rendering outside page.js so the
    // page controller only manages target entries and follow-up API calls.

    function setRenameModalOpen(modal, renameTarget, renameInput, syncModalBodyState, opened, entry, getEntryEditableName) {
        if (!modal) {
            return;
        }
        modal.hidden = !opened;
        if (typeof syncModalBodyState === "function") {
            syncModalBodyState();
        }
        if (!opened) {
            return;
        }
        if (renameTarget) {
            renameTarget.textContent = entry ? entry.path : "";
        }
        if (renameInput) {
            renameInput.value = typeof getEntryEditableName === "function" ? getEntryEditableName(entry) : "";
            renameInput.focus();
            renameInput.select();
        }
    }

    function setFolderCreateModalOpen(modal, folderCreateTarget, folderCreateInput, syncModalBodyState, opened, entry, targetLabel) {
        if (!modal) {
            return;
        }
        modal.hidden = !opened;
        if (typeof syncModalBodyState === "function") {
            syncModalBodyState();
        }
        if (!opened) {
            return;
        }
        if (folderCreateTarget) {
            folderCreateTarget.textContent = targetLabel || "";
        }
        if (folderCreateInput) {
            folderCreateInput.value = "";
            folderCreateInput.focus();
            folderCreateInput.select();
        }
    }

    function setFolderIconModalOpen(modal, folderIconTarget, folderIconFileInput, syncModalBodyState, opened, entry, targetLabel) {
        if (!modal) {
            return;
        }
        modal.hidden = !opened;
        if (typeof syncModalBodyState === "function") {
            syncModalBodyState();
        }
        if (!opened) {
            if (folderIconFileInput) {
                folderIconFileInput.value = "";
            }
            return;
        }
        if (folderIconTarget) {
            folderIconTarget.textContent = targetLabel || "";
        }
        if (folderIconFileInput) {
            folderIconFileInput.focus();
        }
    }

    function renderPermissionItems(container, items, selectedIdSet, emptyMessage, options) {
        if (!container) {
            return;
        }
        container.innerHTML = "";
        var settings = options || {};
        var isItemDisabled = typeof settings.isItemDisabled === "function"
            ? settings.isItemDisabled
            : function () { return false; };

        if (!Array.isArray(items) || items.length === 0) {
            var emptyNode = document.createElement("div");
            emptyNode.className = "handrive-permission-empty";
            emptyNode.textContent = emptyMessage;
            container.appendChild(emptyNode);
            return;
        }

        items.forEach(function (item) {
            var row = document.createElement("label");
            row.className = "handrive-permission-item";
            var disabled = Boolean(isItemDisabled(item));

            var checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = String(item.id);
            checkbox.disabled = disabled;
            checkbox.checked = !disabled && selectedIdSet.has(Number(item.id));

            var text = document.createElement("span");
            text.textContent = item.label;

            row.appendChild(checkbox);
            row.appendChild(text);
            container.appendChild(row);
        });
    }

    function readCheckedIds(container) {
        if (!container) {
            return [];
        }
        return Array.from(container.querySelectorAll('input[type="checkbox"]:checked:not(:disabled)'))
            .map(function (input) {
                return Number(input.value);
            })
            .filter(function (value) {
                return Number.isInteger(value) && value > 0;
            });
    }

    function setPermissionModalOpen(modal, permissionTarget, syncModalBodyState, opened, entries, multipleLabel) {
        if (!modal) {
            return [];
        }
        modal.hidden = !opened;
        if (typeof syncModalBodyState === "function") {
            syncModalBodyState();
        }
        var normalizedEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
        if (!opened) {
            return [];
        }
        if (permissionTarget) {
            if (normalizedEntries.length > 1) {
                permissionTarget.textContent = multipleLabel || "";
            } else {
                permissionTarget.textContent = normalizedEntries[0] ? normalizedEntries[0].path : "";
            }
        }
        return normalizedEntries;
    }

    window.HandriveModalHelpers = {
        readCheckedIds: readCheckedIds,
        renderPermissionItems: renderPermissionItems,
        setFolderCreateModalOpen: setFolderCreateModalOpen,
        setFolderIconModalOpen: setFolderIconModalOpen,
        setPermissionModalOpen: setPermissionModalOpen,
        setRenameModalOpen: setRenameModalOpen,
    };
})();
