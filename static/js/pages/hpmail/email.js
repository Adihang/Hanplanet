(function () {
    const app = document.querySelector(".hpmail-app");
    if (!app) return;

    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") || "";
    const endpoints = {
        mailboxes: app.dataset.apiMailboxesUrl,
        mailboxCreate: app.dataset.apiMailboxCreateUrl,
        mailboxRename: app.dataset.apiMailboxRenameUrl,
        mailboxDelete: app.dataset.apiMailboxDeleteUrl,
        messages: app.dataset.apiMessagesUrl,
        detail: app.dataset.apiMessageDetailUrl,
        send: app.dataset.apiSendUrl,
        flags: app.dataset.apiFlagsUrl,
        move: app.dataset.apiMoveUrl,
        delete: app.dataset.apiDeleteUrl,
        quota: app.dataset.apiQuotaUrl,
    };
    const mailboxNav = app.querySelector(".hpmail-mailboxes");
    const listEl = app.querySelector("[data-hpmail-message-list]");
    const readerEl = app.querySelector("[data-hpmail-reader]");
    const statusEl = app.querySelector("[data-hpmail-status]");
    const currentMailboxEl = app.querySelector("[data-hpmail-current-mailbox]");
    const composePanel = app.querySelector("[data-hpmail-compose-panel]");
    const composeForm = app.querySelector("[data-hpmail-compose-form]");
    const mailboxAddButton = app.querySelector("[data-hpmail-mailbox-add]");
    const mailboxModal = document.querySelector("[data-hpmail-mailbox-modal]");
    const mailboxForm = document.querySelector("[data-hpmail-mailbox-form]");
    const mailboxNameInput = document.querySelector("[data-hpmail-mailbox-name]");
    const mailboxModalTitle = document.querySelector("[data-hpmail-mailbox-modal-title]");
    const mailboxModalStatus = document.querySelector("[data-hpmail-mailbox-modal-status]");
    const mailboxSubmitButton = document.querySelector("[data-hpmail-mailbox-submit]");
    const mailboxContextMenu = document.querySelector("[data-hpmail-mailbox-menu]");
    const accountError = (app.dataset.accountError || "").trim();
    const imapConfigured = app.dataset.imapConfigured === "1";
    const accountAddress = (document.querySelector(".hpmail-address")?.textContent || "default").trim() || "default";
    const mailboxOrderStorageKey = `hpmail:mailbox-order:${accountAddress}`;
    const defaultMailboxOrder = ["INBOX", "SENT", "DRAFTS", "TRASH", "SPAM"];
    let currentMailbox = app.dataset.currentMailbox || "INBOX";
    let activeUid = "";
    let draggedMailboxButton = null;
    let draggedMessageData = null;
    let mailboxOrderChanged = false;
    let suppressMailboxClick = false;
    let suppressMessageClick = false;
    let mailboxesCache = [];
    let mailboxModalMode = "create";
    let mailboxModalTarget = "";
    let mailboxContextTarget = "";

    function setStatus(message, isError) {
        if (!statusEl) return;
        statusEl.textContent = message || "";
        statusEl.classList.toggle("is-error", Boolean(isError));
    }

    async function apiJson(url, options) {
        const response = await fetch(url, {
            credentials: "same-origin",
            headers: {
                "Accept": "application/json",
                ...(options && options.body instanceof FormData ? {} : {"Content-Type": "application/json"}),
                ...(csrfToken ? {"X-CSRFToken": csrfToken} : {}),
                ...(options && options.headers ? options.headers : {}),
            },
            ...options,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) {
            const message = payload.error && payload.error.message ? payload.error.message : "요청에 실패했습니다.";
            const error = new Error(message);
            error.payload = payload;
            throw error;
        }
        return payload;
    }

    function canonicalMailboxName(name) {
        const rawName = String(name || "").trim();
        const pathLeaf = rawName.split(/[\\/]/).filter(Boolean).pop() || rawName;
        const folderName = pathLeaf.replace(/^\.+/, "");
        const dottedParts = folderName.split(".").filter(Boolean);
        const leafName = dottedParts.length > 1 && dottedParts[0].toUpperCase() === "INBOX"
            ? dottedParts[dottedParts.length - 1]
            : folderName;
        const normalized = leafName
            .replace(/[_-]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .toUpperCase();

        if (["INBOX", "받은 메일함", "받은메일함", "받은편지함"].includes(normalized)) return "INBOX";
        if (["SENT", "SENT MAIL", "SENT MESSAGES", "SENT ITEMS", "보낸 메일함", "보낸메일함"].includes(normalized)) return "SENT";
        if (["DRAFT", "DRAFTS", "임시 보관함", "임시보관함"].includes(normalized)) return "DRAFTS";
        if (["TRASH", "BIN", "DELETED", "DELETED ITEMS", "DELETED MESSAGES", "휴지통"].includes(normalized)) return "TRASH";
        if (["JUNK", "JUNK EMAIL", "JUNK E MAIL", "SPAM", "스팸"].includes(normalized)) return "SPAM";
        return normalized;
    }

    function mailboxLabel(name) {
        const canonicalName = canonicalMailboxName(name);
        if (canonicalName === "INBOX") return "받은 메일함";
        if (canonicalName === "SENT") return "보낸 메일함";
        if (canonicalName === "DRAFTS") return "임시 보관함";
        if (canonicalName === "TRASH") return "휴지통";
        if (canonicalName === "SPAM") return "스팸";
        return name;
    }

    function isSameMailbox(leftName, rightName) {
        if (leftName === rightName) return true;
        const leftCanonicalName = canonicalMailboxName(leftName);
        return defaultMailboxOrder.includes(leftCanonicalName) && leftCanonicalName === canonicalMailboxName(rightName);
    }

    function isSystemMailboxName(name) {
        return defaultMailboxOrder.includes(canonicalMailboxName(name));
    }

    function canModifyMailbox(mailbox) {
        return Boolean(mailbox) && mailbox.can_modify !== false && !isSystemMailboxName(mailbox.name);
    }

    function normalizeMailboxInput(value) {
        return String(value || "").trim();
    }

    function validateMailboxInput(value) {
        const name = normalizeMailboxInput(value);
        if (!name) return "메일함 이름을 입력해주세요.";
        if (name.length > 80) return "메일함 이름은 80자 이내로 입력해주세요.";
        if (/[\x00-\x1f\x7f"\\/]/.test(name)) return "메일함 이름에는 따옴표, 역슬래시, 슬래시를 사용할 수 없습니다.";
        if (name === "." || name === ".." || name.startsWith(".")) return "점으로 시작하는 메일함 이름은 사용할 수 없습니다.";
        if (isSystemMailboxName(name)) return "기본 메일함 이름은 사용할 수 없습니다.";
        return "";
    }

    function getMailboxByName(name) {
        return mailboxesCache.find((mailbox) => isSameMailbox(mailbox.name, name) || mailbox.name === name) || null;
    }

    function getDraftMailboxName() {
        const draftMailbox = mailboxesCache.find((mailbox) => canonicalMailboxName(mailbox.name) === "DRAFTS");
        return draftMailbox ? draftMailbox.name : "Drafts";
    }

    function getMessageMoveRestriction(sourceMailbox, destinationMailbox) {
        const sourceKind = canonicalMailboxName(sourceMailbox);
        const destinationKind = canonicalMailboxName(destinationMailbox);
        if (isSameMailbox(sourceMailbox, destinationMailbox)) {
            return "이미 해당 메일함에 있습니다.";
        }
        if (sourceKind === "SENT" && destinationKind === "INBOX") {
            return "보낸 메일은 받은 메일함으로 이동할 수 없습니다.";
        }
        if (sourceKind === "INBOX" && destinationKind === "SENT") {
            return "받은 메일은 보낸 메일함으로 이동할 수 없습니다.";
        }
        return "";
    }

    function readMailboxOrder() {
        try {
            const storedValue = window.localStorage.getItem(mailboxOrderStorageKey);
            const parsedValue = storedValue ? JSON.parse(storedValue) : [];
            return Array.isArray(parsedValue) ? parsedValue.map(String).filter(Boolean) : [];
        } catch (error) {
            return [];
        }
    }

    function writeMailboxOrder(mailboxNames) {
        try {
            window.localStorage.setItem(mailboxOrderStorageKey, JSON.stringify(mailboxNames));
        } catch (error) {
            // Private browsing or blocked storage should not break mailbox use.
        }
    }

    function getMailboxButtons() {
        return Array.from(mailboxNav.querySelectorAll(".hpmail-mailbox"));
    }

    function saveCurrentMailboxOrder() {
        const mailboxNames = getMailboxButtons()
            .map((button) => button.dataset.mailbox)
            .filter(Boolean);
        if (mailboxNames.length) {
            writeMailboxOrder(mailboxNames);
        }
    }

    function appendMailboxToSavedOrder(mailboxName) {
        const existingOrder = getMailboxButtons()
            .map((button) => button.dataset.mailbox)
            .filter(Boolean);
        if (!existingOrder.includes(mailboxName)) {
            existingOrder.push(mailboxName);
        }
        writeMailboxOrder(existingOrder);
    }

    function replaceMailboxInSavedOrder(oldName, newName) {
        const savedOrder = readMailboxOrder();
        const nextOrder = (savedOrder.length ? savedOrder : getMailboxButtons().map((button) => button.dataset.mailbox))
            .filter(Boolean)
            .map((mailboxName) => mailboxName === oldName ? newName : mailboxName);
        writeMailboxOrder(nextOrder);
    }

    function removeMailboxFromSavedOrder(mailboxName) {
        const savedOrder = readMailboxOrder();
        const nextOrder = (savedOrder.length ? savedOrder : getMailboxButtons().map((button) => button.dataset.mailbox))
            .filter(Boolean)
            .filter((name) => name !== mailboxName);
        writeMailboxOrder(nextOrder);
    }

    function mailboxSortRank(mailbox, originalIndex, savedExactOrder, savedCanonicalOrder, hasSavedOrder) {
        const mailboxName = String(mailbox.name || "");
        const canonicalName = canonicalMailboxName(mailboxName);
        if (savedExactOrder.has(mailboxName)) {
            return [0, savedExactOrder.get(mailboxName), originalIndex];
        }
        if (savedCanonicalOrder.has(canonicalName)) {
            return [0, savedCanonicalOrder.get(canonicalName), originalIndex];
        }

        const defaultIndex = defaultMailboxOrder.indexOf(canonicalName);
        if (defaultIndex !== -1) {
            return [hasSavedOrder ? 1 : 0, defaultIndex, originalIndex];
        }
        return [hasSavedOrder ? 2 : 1, originalIndex, originalIndex];
    }

    function orderMailboxes(mailboxes) {
        const savedOrder = readMailboxOrder();
        const savedExactOrder = new Map();
        const savedCanonicalOrder = new Map();
        savedOrder.forEach((mailboxName, index) => {
            if (!savedExactOrder.has(mailboxName)) {
                savedExactOrder.set(mailboxName, index);
            }
            const canonicalName = canonicalMailboxName(mailboxName);
            if (!savedCanonicalOrder.has(canonicalName)) {
                savedCanonicalOrder.set(canonicalName, index);
            }
        });

        return mailboxes
            .map((mailbox, originalIndex) => ({mailbox, originalIndex}))
            .sort((left, right) => {
                const leftRank = mailboxSortRank(left.mailbox, left.originalIndex, savedExactOrder, savedCanonicalOrder, savedOrder.length > 0);
                const rightRank = mailboxSortRank(right.mailbox, right.originalIndex, savedExactOrder, savedCanonicalOrder, savedOrder.length > 0);
                for (let index = 0; index < leftRank.length; index += 1) {
                    if (leftRank[index] !== rightRank[index]) {
                        return leftRank[index] - rightRank[index];
                    }
                }
                return 0;
            })
            .map((item) => item.mailbox);
    }

    function clearMailboxDragState() {
        getMailboxButtons().forEach((button) => {
            button.classList.remove("is-dragging");
            button.setAttribute("aria-grabbed", "false");
        });
        draggedMailboxButton = null;
    }

    function clearMessageDropState() {
        getMailboxButtons().forEach((button) => {
            button.classList.remove("is-message-drop-target", "is-message-drop-denied");
        });
    }

    function clearMessageDragState() {
        listEl.querySelectorAll(".hpmail-message-item").forEach((item) => {
            item.classList.remove("is-dragging");
        });
        clearMessageDropState();
        draggedMessageData = null;
    }

    function updateMessageDropState(button, sourceMailbox, destinationMailbox) {
        clearMessageDropState();
        const restrictionMessage = getMessageMoveRestriction(sourceMailbox, destinationMailbox);
        button.classList.toggle("is-message-drop-target", !restrictionMessage);
        button.classList.toggle("is-message-drop-denied", Boolean(restrictionMessage));
        if (restrictionMessage) {
            setStatus(restrictionMessage, true);
        }
        return restrictionMessage;
    }

    function isMailboxRowLayout() {
        return window.getComputedStyle(mailboxNav).flexDirection.startsWith("row");
    }

    function moveDraggedMailbox(event, targetButton) {
        if (!draggedMailboxButton || draggedMailboxButton === targetButton) return;
        const rect = targetButton.getBoundingClientRect();
        const insertAfter = isMailboxRowLayout()
            ? event.clientX > rect.left + rect.width / 2
            : event.clientY > rect.top + rect.height / 2;
        const referenceNode = insertAfter ? targetButton.nextSibling : targetButton;
        if (referenceNode !== draggedMailboxButton) {
            mailboxNav.insertBefore(draggedMailboxButton, referenceNode);
            mailboxOrderChanged = true;
        }
    }

    function finishMailboxDrag() {
        if (mailboxOrderChanged) {
            saveCurrentMailboxOrder();
            suppressMailboxClick = true;
            window.setTimeout(() => {
                suppressMailboxClick = false;
            }, 0);
        }
        clearMailboxDragState();
        mailboxOrderChanged = false;
    }

    function setMailboxModalStatus(message, isError) {
        if (!mailboxModalStatus) return;
        mailboxModalStatus.textContent = message || "";
        mailboxModalStatus.classList.toggle("is-error", Boolean(isError));
    }

    function openMailboxModal(mode, mailboxName) {
        if (!mailboxModal || !mailboxNameInput) return;
        mailboxModalMode = mode === "rename" ? "rename" : "create";
        mailboxModalTarget = mailboxModalMode === "rename" ? String(mailboxName || "") : "";
        if (mailboxModalTitle) {
            mailboxModalTitle.textContent = mailboxModalMode === "rename" ? "메일함 이름 변경" : "메일함 추가";
        }
        mailboxNameInput.value = mailboxModalMode === "rename" ? mailboxModalTarget : "";
        setMailboxModalStatus("", false);
        mailboxModal.hidden = false;
        window.setTimeout(() => {
            mailboxNameInput.focus();
            if (mailboxModalMode === "rename") {
                mailboxNameInput.select();
            }
        }, 0);
    }

    function closeMailboxModal() {
        if (!mailboxModal) return;
        mailboxModal.hidden = true;
        mailboxModalMode = "create";
        mailboxModalTarget = "";
        setMailboxModalStatus("", false);
        if (mailboxForm) {
            mailboxForm.reset();
        }
    }

    function setMailboxFormBusy(isBusy) {
        if (mailboxSubmitButton) {
            mailboxSubmitButton.disabled = Boolean(isBusy);
        }
        if (mailboxNameInput) {
            mailboxNameInput.disabled = Boolean(isBusy);
        }
    }

    function closeMailboxContextMenu() {
        if (!mailboxContextMenu) return;
        mailboxContextMenu.hidden = true;
        mailboxContextTarget = "";
    }

    function positionMailboxContextMenu(left, top) {
        if (!mailboxContextMenu) return;
        mailboxContextMenu.style.left = `${left}px`;
        mailboxContextMenu.style.top = `${top}px`;
        mailboxContextMenu.hidden = false;
        const rect = mailboxContextMenu.getBoundingClientRect();
        const padding = 8;
        const nextLeft = Math.min(left, window.innerWidth - rect.width - padding);
        const nextTop = Math.min(top, window.innerHeight - rect.height - padding);
        mailboxContextMenu.style.left = `${Math.max(padding, nextLeft)}px`;
        mailboxContextMenu.style.top = `${Math.max(padding, nextTop)}px`;
    }

    function openMailboxContextMenu(event, mailbox) {
        if (!canModifyMailbox(mailbox)) return;
        event.preventDefault();
        closeMailboxContextMenu();
        mailboxContextTarget = mailbox.name;
        positionMailboxContextMenu(event.clientX, event.clientY);
    }

    async function submitMailboxForm(event) {
        event.preventDefault();
        const name = normalizeMailboxInput(mailboxNameInput?.value);
        const validationMessage = validateMailboxInput(name);
        if (validationMessage) {
            setMailboxModalStatus(validationMessage, true);
            return;
        }
        if (mailboxModalMode === "rename" && name === mailboxModalTarget) {
            closeMailboxModal();
            return;
        }

        const isRename = mailboxModalMode === "rename";
        const url = isRename ? endpoints.mailboxRename : endpoints.mailboxCreate;
        if (!url) {
            setMailboxModalStatus("메일함 API가 설정되지 않았습니다.", true);
            return;
        }

        setMailboxFormBusy(true);
        setMailboxModalStatus(isRename ? "이름 변경 중..." : "메일함 생성 중...", false);
        try {
            const payload = await apiJson(url, {
                method: "POST",
                body: JSON.stringify(isRename ? {mailbox: mailboxModalTarget, name} : {name}),
            });
            const mailboxName = payload.mailbox && payload.mailbox.name ? payload.mailbox.name : name;
            if (isRename) {
                replaceMailboxInSavedOrder(mailboxModalTarget, mailboxName);
                if (isSameMailbox(currentMailbox, mailboxModalTarget) || currentMailbox === mailboxModalTarget) {
                    currentMailbox = mailboxName;
                    app.dataset.currentMailbox = currentMailbox;
                }
            } else {
                appendMailboxToSavedOrder(mailboxName);
                currentMailbox = mailboxName;
                app.dataset.currentMailbox = currentMailbox;
                activeUid = "";
            }
            closeMailboxModal();
            await loadMailboxes();
            await loadMessages();
        } catch (error) {
            setMailboxModalStatus(error.message, true);
        } finally {
            setMailboxFormBusy(false);
        }
    }

    async function deleteMailbox(mailboxName) {
        const mailbox = getMailboxByName(mailboxName);
        if (!canModifyMailbox(mailbox)) return;
        const confirmed = window.confirm(`'${mailboxName}' 메일함을 삭제할까요?\n내부 메일은 임시 보관함으로 이동됩니다.`);
        if (!confirmed) return;
        if (!endpoints.mailboxDelete) {
            setStatus("메일함 API가 설정되지 않았습니다.", true);
            return;
        }
        closeMailboxContextMenu();
        setStatus("메일함 삭제 중...", false);
        try {
            const payload = await apiJson(endpoints.mailboxDelete, {
                method: "POST",
                body: JSON.stringify({mailbox: mailboxName}),
            });
            removeMailboxFromSavedOrder(mailboxName);
            if (isSameMailbox(currentMailbox, mailboxName) || currentMailbox === mailboxName) {
                currentMailbox = payload.destination || getDraftMailboxName();
                app.dataset.currentMailbox = currentMailbox;
                activeUid = "";
                readerEl.innerHTML = '<div class="hpmail-empty-state">메일을 선택하세요.</div>';
            }
            await loadMailboxes();
            await loadMessages();
        } catch (error) {
            setStatus(error.message, true);
        }
    }

    async function moveMessageToMailbox(messageData, destinationMailbox) {
        if (!messageData || !messageData.uid || !destinationMailbox) return;
        const restrictionMessage = getMessageMoveRestriction(messageData.mailbox, destinationMailbox);
        if (restrictionMessage) {
            setStatus(restrictionMessage, true);
            return;
        }
        if (!endpoints.move) {
            setStatus("메일 이동 API가 설정되지 않았습니다.", true);
            return;
        }

        setStatus("메일 이동 중...", false);
        try {
            await apiJson(endpoints.move, {
                method: "POST",
                body: JSON.stringify({
                    mailbox: messageData.mailbox,
                    uid: messageData.uid,
                    destination: destinationMailbox,
                }),
            });
            if (activeUid === messageData.uid) {
                activeUid = "";
                readerEl.innerHTML = '<div class="hpmail-empty-state">메일을 선택하세요.</div>';
            }
            await loadMessages();
            setStatus(`${mailboxLabel(destinationMailbox)}으로 이동했습니다.`, false);
        } catch (error) {
            setStatus(error.message, true);
        }
    }

    function renderMailboxes(mailboxes) {
        mailboxNav.innerHTML = "";
        orderMailboxes(mailboxes).forEach((mailbox) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "hpmail-mailbox";
            button.dataset.mailbox = mailbox.name;
            button.dataset.mailboxCanonical = canonicalMailboxName(mailbox.name);
            button.dataset.mailboxCanModify = canModifyMailbox(mailbox) ? "1" : "0";
            button.draggable = true;
            button.setAttribute("aria-grabbed", "false");
            button.textContent = mailboxLabel(mailbox.name);
            button.classList.toggle("is-active", isSameMailbox(mailbox.name, currentMailbox));
            button.addEventListener("click", () => {
                if (suppressMailboxClick) return;
                currentMailbox = mailbox.name;
                activeUid = "";
                app.dataset.currentMailbox = currentMailbox;
                mailboxNav.querySelectorAll(".hpmail-mailbox").forEach((el) => {
                    el.classList.toggle("is-active", isSameMailbox(el.dataset.mailbox, currentMailbox));
                });
                loadMessages();
            });
            button.addEventListener("contextmenu", (event) => openMailboxContextMenu(event, mailbox));
            button.addEventListener("dragstart", (event) => {
                closeMailboxContextMenu();
                draggedMailboxButton = button;
                mailboxOrderChanged = false;
                button.classList.add("is-dragging");
                button.setAttribute("aria-grabbed", "true");
                if (event.dataTransfer) {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", mailbox.name);
                }
            });
            button.addEventListener("dragover", (event) => {
                if (draggedMessageData) {
                    event.preventDefault();
                    const restrictionMessage = updateMessageDropState(button, draggedMessageData.mailbox, mailbox.name);
                    if (event.dataTransfer) {
                        event.dataTransfer.dropEffect = restrictionMessage ? "none" : "move";
                    }
                    return;
                }
                if (!draggedMailboxButton) return;
                event.preventDefault();
                if (event.dataTransfer) {
                    event.dataTransfer.dropEffect = "move";
                }
                moveDraggedMailbox(event, button);
            });
            button.addEventListener("dragleave", (event) => {
                if (!draggedMessageData || button.contains(event.relatedTarget)) return;
                button.classList.remove("is-message-drop-target", "is-message-drop-denied");
            });
            button.addEventListener("drop", (event) => {
                if (draggedMessageData) {
                    const messageData = draggedMessageData;
                    event.preventDefault();
                    suppressMessageClick = true;
                    window.setTimeout(() => {
                        suppressMessageClick = false;
                    }, 0);
                    clearMessageDragState();
                    moveMessageToMailbox(messageData, mailbox.name);
                    return;
                }
                if (!draggedMailboxButton) return;
                event.preventDefault();
                finishMailboxDrag();
            });
            button.addEventListener("dragend", finishMailboxDrag);
            mailboxNav.appendChild(button);
        });
    }

    function renderMessages(messages) {
        listEl.innerHTML = "";
        if (!messages.length) {
            const empty = document.createElement("li");
            empty.className = "hpmail-empty-state";
            empty.textContent = "메일이 없습니다.";
            listEl.appendChild(empty);
            return;
        }
        messages.forEach((message) => {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "hpmail-message-item";
            item.dataset.uid = message.uid;
            item.dataset.mailbox = currentMailbox;
            item.draggable = true;
            item.innerHTML = `
                <div class="hpmail-message-from"></div>
                <div class="hpmail-message-subject"></div>
                <div class="hpmail-message-meta"></div>
            `;
            item.querySelector(".hpmail-message-from").textContent = message.from || "(unknown)";
            item.querySelector(".hpmail-message-subject").textContent = message.subject || "(no subject)";
            item.querySelector(".hpmail-message-meta").textContent = message.date || "";
            item.addEventListener("click", () => {
                if (suppressMessageClick) return;
                openMessage(message.uid);
            });
            item.addEventListener("dragstart", (event) => {
                closeMailboxContextMenu();
                draggedMessageData = {
                    uid: String(message.uid || ""),
                    mailbox: currentMailbox,
                };
                item.classList.add("is-dragging");
                if (event.dataTransfer) {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("application/x-hpmail-message", JSON.stringify(draggedMessageData));
                    event.dataTransfer.setData("text/plain", message.subject || message.uid || "");
                }
            });
            item.addEventListener("dragend", () => {
                if (draggedMessageData) {
                    suppressMessageClick = true;
                    window.setTimeout(() => {
                        suppressMessageClick = false;
                    }, 0);
                }
                clearMessageDragState();
            });
            listEl.appendChild(item);
        });
    }

    function renderMessage(message) {
        const attachments = Array.isArray(message.attachments) ? message.attachments : [];
        readerEl.innerHTML = "";
        const title = document.createElement("h2");
        title.className = "hpmail-reader-subject";
        title.textContent = message.subject || "(no subject)";
        const meta = document.createElement("div");
        meta.className = "hpmail-reader-meta";
        meta.innerHTML = "";
        ["from", "to", "cc", "date"].forEach((key) => {
            if (!message[key]) return;
            const row = document.createElement("div");
            row.textContent = `${key.toUpperCase()}: ${message[key]}`;
            meta.appendChild(row);
        });
        readerEl.appendChild(title);
        readerEl.appendChild(meta);

        if (attachments.length) {
            const attachWrap = document.createElement("div");
            attachWrap.className = "hpmail-attachments";
            attachments.forEach((attachment) => {
                const chip = document.createElement("span");
                chip.className = "hpmail-attachment";
                chip.textContent = attachment.filename || "attachment";
                attachWrap.appendChild(chip);
            });
            readerEl.appendChild(attachWrap);
        }

        if (message.body_html) {
            const frame = document.createElement("iframe");
            frame.className = "hpmail-reader-frame";
            frame.setAttribute("sandbox", "");
            readerEl.appendChild(frame);
            frame.srcdoc = message.body_html;
        } else {
            const body = document.createElement("div");
            body.className = "hpmail-reader-body";
            body.textContent = message.body_text || "";
            readerEl.appendChild(body);
        }
    }

    async function loadMailboxes() {
        try {
            const payload = await apiJson(endpoints.mailboxes);
            mailboxesCache = payload.mailboxes || [];
            renderMailboxes(mailboxesCache);
            return true;
        } catch (error) {
            setStatus(error.message, true);
            readerEl.innerHTML = '<div class="hpmail-empty-state">메일 서버 연결을 확인하세요.</div>';
            return false;
        }
    }

    async function loadMessages() {
        setStatus("불러오는 중...", false);
        currentMailboxEl.textContent = mailboxLabel(currentMailbox);
        try {
            const url = `${endpoints.messages}?mailbox=${encodeURIComponent(currentMailbox)}&limit=50`;
            const payload = await apiJson(url);
            renderMessages(payload.messages || []);
            setStatus(`${payload.total || 0}개`, false);
        } catch (error) {
            listEl.innerHTML = "";
            readerEl.innerHTML = '<div class="hpmail-empty-state">메일 서버 연결을 확인하세요.</div>';
            setStatus(error.message, true);
        }
    }

    async function openMessage(uid) {
        activeUid = uid;
        listEl.querySelectorAll(".hpmail-message-item").forEach((item) => {
            item.classList.toggle("is-active", item.dataset.uid === uid);
        });
        setStatus("메일 여는 중...", false);
        try {
            const url = `${endpoints.detail}?mailbox=${encodeURIComponent(currentMailbox)}&uid=${encodeURIComponent(uid)}`;
            const payload = await apiJson(url);
            renderMessage(payload.message);
            setStatus("", false);
        } catch (error) {
            setStatus(error.message, true);
        }
    }

    function openCompose() {
        composePanel.hidden = false;
        composePanel.querySelector('input[name="to"]')?.focus();
    }

    function closeCompose() {
        composePanel.hidden = true;
    }

    async function sendMessage(event) {
        event.preventDefault();
        const formData = new FormData(composeForm);
        setStatus("발송 중...", false);
        try {
            const payload = await apiJson(endpoints.send, {
                method: "POST",
                body: formData,
            });
            composeForm.reset();
            closeCompose();
            setStatus(`발송 완료 (${payload.today_send_count || 0}건)`, false);
            if (canonicalMailboxName(currentMailbox) === "SENT") {
                loadMessages();
            }
        } catch (error) {
            setStatus(error.message, true);
        }
    }

    app.querySelector("[data-hpmail-compose]")?.addEventListener("click", openCompose);
    app.querySelectorAll("[data-hpmail-compose-close]").forEach((button) => {
        button.addEventListener("click", closeCompose);
    });
    app.querySelector("[data-hpmail-refresh]")?.addEventListener("click", loadMessages);
    composeForm?.addEventListener("submit", sendMessage);
    mailboxAddButton?.addEventListener("click", () => openMailboxModal("create"));
    mailboxForm?.addEventListener("submit", submitMailboxForm);
    document.querySelectorAll("[data-hpmail-mailbox-modal-close]").forEach((button) => {
        button.addEventListener("click", closeMailboxModal);
    });
    mailboxContextMenu?.querySelector("[data-hpmail-mailbox-rename]")?.addEventListener("click", () => {
        const target = mailboxContextTarget;
        closeMailboxContextMenu();
        if (target) {
            openMailboxModal("rename", target);
        }
    });
    mailboxContextMenu?.querySelector("[data-hpmail-mailbox-delete]")?.addEventListener("click", () => {
        const target = mailboxContextTarget;
        if (target) {
            deleteMailbox(target);
        }
    });
    document.addEventListener("click", (event) => {
        if (!mailboxContextMenu || mailboxContextMenu.hidden) return;
        if (!mailboxContextMenu.contains(event.target)) {
            closeMailboxContextMenu();
        }
    });
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        if (mailboxContextMenu && !mailboxContextMenu.hidden) {
            closeMailboxContextMenu();
            return;
        }
        if (mailboxModal && !mailboxModal.hidden) {
            closeMailboxModal();
        }
    });
    window.addEventListener("resize", closeMailboxContextMenu);
    window.addEventListener("scroll", closeMailboxContextMenu, true);

    if (accountError) {
        setStatus(accountError, true);
        readerEl.innerHTML = '<div class="hpmail-empty-state">HPmail 계정을 확인하세요.</div>';
        return;
    }

    if (!imapConfigured) {
        setStatus("HPmail IMAP master user 설정이 필요합니다.", true);
        readerEl.innerHTML = '<div class="hpmail-empty-state">메일 서버 설정을 완료한 뒤 받은 메일함을 불러올 수 있습니다.</div>';
        return;
    }

    loadMailboxes().then((loaded) => {
        if (loaded) {
            loadMessages();
        }
    });
})();
