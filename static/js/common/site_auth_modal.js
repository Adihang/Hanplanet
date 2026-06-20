(function () {
    "use strict";

    const modal = document.querySelector("[data-auth-modal-host]");
    if (!modal) return;

    const dialog = modal.querySelector(".auth-modal-dialog");
    const content = modal.querySelector("[data-auth-content]");
    const closeControls = Array.from(modal.querySelectorAll("[data-auth-close]"));
    const titleNode = modal.querySelector("[data-auth-title]");
    let lastFocusedElement = null;
    let activeRequestId = 0;
    let activeDrag = null;
    const dragMargin = 8;

    function isPlainPrimaryClick(event) {
        return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    }

    function getCsrfToken(form) {
        const formToken = form ? form.querySelector("input[name='csrfmiddlewaretoken']") : null;
        if (formToken && formToken.value) return formToken.value;
        const metaToken = document.querySelector("meta[name='csrf-token']");
        return metaToken ? metaToken.getAttribute("content") || "" : "";
    }

    function getCurrentPathWithQuery() {
        return window.location.pathname + window.location.search + window.location.hash;
    }

    function buildPanelUrl(href) {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) return null;
        if (!url.searchParams.get("next")) {
            url.searchParams.set("next", getCurrentPathWithQuery());
        }
        url.searchParams.set("auth_modal", "1");
        return url.toString();
    }

    function setModalOpen(open) {
        modal.hidden = !open;
        document.body.classList.toggle("auth-modal-open", open);
        if (open) {
            applyModalShellFallbackStyles();
            if (window.SiteModalStack && typeof window.SiteModalStack.bringToFront === "function") {
                window.SiteModalStack.bringToFront(modal);
            }
            modal.setAttribute("aria-hidden", "false");
        } else {
            modal.setAttribute("aria-hidden", "true");
            hideDialogLoading();
            content.innerHTML = "";
            content.classList.remove("is-loading", "is-submitting");
            if (window.SiteModalStack && typeof window.SiteModalStack.sync === "function") {
                window.SiteModalStack.sync();
            }
            if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
                lastFocusedElement.focus({ preventScroll: true });
            }
            lastFocusedElement = null;
            resetDialogDrag();
        }
    }

    function applyStyles(element, styles) {
        if (!element) return;
        Object.keys(styles).forEach(function (property) {
            element.style[property] = styles[property];
        });
    }

    function applyModalShellFallbackStyles() {
        const modalStyle = window.getComputedStyle ? window.getComputedStyle(modal) : null;
        if (modalStyle && modalStyle.position === "fixed" && modalStyle.display === "flex") return;

        const isDark = document.body.classList.contains("theme-dark");
        const backdrop = modal.querySelector(".handrive-popup-modal-backdrop");
        const header = dialog ? dialog.querySelector(".handrive-popup-head") : null;
        const closeButton = dialog ? dialog.querySelector(".handrive-popup-close-btn") : null;
        const surfaceBg = isDark ? "var(--site-modal-surface-bg, rgba(46, 46, 46, 0.72))" : "var(--site-modal-surface-bg, rgba(248, 248, 248, 0.72))";
        const headerBg = isDark ? "var(--site-modal-header-bg, rgba(46, 46, 46, 0.64))" : "var(--site-modal-header-bg, rgba(248, 248, 248, 0.62))";
        const backdropFilter = "var(--site-modal-backdrop-filter, none)";
        const surfaceFilter = "var(--site-modal-surface-filter, saturate(120%) blur(4px))";
        const surfaceShadow = isDark ? "0 16px 34px rgba(0, 0, 0, 0.5)" : "0 12px 28px rgba(0, 0, 0, 0.28)";
        const exteriorDimShadow = "var(--site-modal-exterior-dim-shadow, 0 0 0 100vmax rgba(0, 0, 0, 0.24))";

        applyStyles(modal, {
            position: "fixed",
            inset: "0",
            zIndex: "var(--site-modal-stack-z, var(--site-z-modal, 1400))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
            boxSizing: "border-box",
            isolation: "isolate"
        });
        applyStyles(backdrop, {
            position: "absolute",
            inset: "0",
            zIndex: "0",
            background: "var(--site-modal-backdrop-surface-bg, transparent)",
            backdropFilter: backdropFilter
        });
        if (backdrop) backdrop.style.setProperty("-webkit-backdrop-filter", backdropFilter);
        applyStyles(dialog, {
            position: "relative",
            zIndex: "1",
            width: "min(452px, calc(100vw - 32px))",
            maxHeight: "calc(100vh - 32px)",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            overflow: "auto",
            padding: "12px",
            borderRadius: "12px",
            background: surfaceBg,
            backdropFilter: surfaceFilter,
            color: isDark ? "#f2f2f2" : "#1f1f1f",
            boxShadow: surfaceShadow + ", " + exteriorDimShadow
        });
        if (dialog) dialog.style.setProperty("-webkit-backdrop-filter", surfaceFilter);
        applyStyles(header, {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            margin: "-12px -12px 0",
            padding: "10px 14px 8px",
            background: headerBg,
            cursor: "grab",
            userSelect: "none",
            touchAction: "none"
        });
        applyStyles(closeButton, {
            position: "static",
            flex: "0 0 auto"
        });
    }

    function setModalTitle(title) {
        const value = String(title || "").trim();
        modal.setAttribute("data-auth-modal-title", value);
        if (titleNode) titleNode.textContent = value;
    }

    function hideDialogLoading() {
        if (!dialog) return;
        Array.from(dialog.querySelectorAll(":scope > .auth-modal-loading")).forEach(function (loading) {
            loading.hidden = true;
        });
    }

    function ensureDialogLoading(className) {
        const parent = dialog || content;
        let loading = parent.querySelector(":scope > ." + className);
        if (loading) return loading;
        loading = document.createElement("div");
        loading.className = "auth-modal-loading " + className;
        loading.setAttribute("role", "status");
        loading.setAttribute("aria-live", "polite");
        loading.hidden = true;
        const spinner = document.createElement("span");
        spinner.className = "auth-loading-spinner";
        spinner.setAttribute("aria-hidden", "true");
        loading.appendChild(spinner);
        parent.appendChild(loading);
        return loading;
    }

    function showLoading() {
        hideDialogLoading();
        content.classList.add("is-loading");
        content.classList.remove("is-submitting");
        content.innerHTML = "";
        ensureDialogLoading("auth-modal-panel-loading").hidden = false;
    }

    function focusFirstControl() {
        window.setTimeout(function () {
            const target = content.querySelector("[autofocus], input:not([type='hidden']):not([disabled]), button:not([disabled]), a[href]");
            if (target && typeof target.focus === "function") {
                target.focus({ preventScroll: true });
            } else if (dialog && typeof dialog.focus === "function") {
                dialog.focus({ preventScroll: true });
            }
        }, 0);
    }

    function selectServerMessage(data, fallback) {
        const lang = (document.documentElement.getAttribute("lang") || "").toLowerCase().indexOf("en") === 0 ? "en" : "ko";
        const messages = data && (data.error_messages || data.messages);
        if (messages && typeof messages === "object") {
            return messages[lang] || messages.ko || messages.en || fallback || "";
        }
        return (data && (data.error_message || data.message || data.error)) || fallback || "";
    }

    function replacePanel(html) {
        hideDialogLoading();
        content.classList.remove("is-loading", "is-submitting");
        content.innerHTML = html || "";
        preparePanel();
        focusFirstControl();
    }

    function getModalContentForForm(form) {
        if (!form || !form.closest) return null;
        const modalContent = form.closest(".auth-modal-content");
        return modalContent === content ? modalContent : null;
    }

    function ensureModalContentLoading(modalContent) {
        const loading = ensureDialogLoading("auth-modal-submit-loading");
        loading.setAttribute("data-auth-submit-loading", "1");
        return loading;
    }

    function getDragOffset(propertyName) {
        const value = parseFloat(dialog.style.getPropertyValue(propertyName) || "0");
        return Number.isFinite(value) ? value : 0;
    }

    function clamp(value, min, max) {
        if (min > max) return (min + max) / 2;
        return Math.max(min, Math.min(max, value));
    }

    function setDialogDragOffset(x, y) {
        dialog.setAttribute("data-popup-draggable-dialog", "true");
        dialog.style.setProperty("--popup-drag-x", Math.round(x) + "px");
        dialog.style.setProperty("--popup-drag-y", Math.round(y) + "px");
    }

    function resetDialogDrag() {
        if (!dialog) return;
        dialog.removeAttribute("data-popup-draggable-dialog");
        dialog.style.removeProperty("--popup-drag-x");
        dialog.style.removeProperty("--popup-drag-y");
        dialog.classList.remove("is-popup-dragging");
        const head = dialog.querySelector(":scope > .handrive-popup-head");
        if (head) head.classList.remove("is-popup-dragging");
        activeDrag = null;
        document.body.classList.remove("handrive-popup-dragging");
    }

    function hasHandrivePopupDragHelper() {
        return Boolean(
            window.HandriveModalHelpers &&
            typeof window.HandriveModalHelpers.enablePopupDragging === "function"
        );
    }

    function viewportSize() {
        return {
            width: Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0),
            height: Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0)
        };
    }

    function clampDragOffset(context, rawX, rawY) {
        const viewport = viewportSize();
        const minX = dragMargin - context.startRect.left + context.startOffsetX;
        const maxX = viewport.width - dragMargin - context.startRect.right + context.startOffsetX;
        const minY = dragMargin - context.startRect.top + context.startOffsetY;
        const maxY = viewport.height - dragMargin - context.startRect.bottom + context.startOffsetY;
        return {
            x: clamp(rawX, minX, maxX),
            y: clamp(rawY, minY, maxY)
        };
    }

    function isInteractiveDragTarget(target, header) {
        if (!target || target === header || !target.closest) return false;
        const interactive = target.closest("button, a, input, textarea, select, label, summary, [role='button'], [contenteditable='true']");
        return Boolean(interactive && header.contains(interactive));
    }

    function startHeaderDrag(event, header) {
        if (!dialog || dialog.closest("[hidden]")) return;
        const startOffsetX = getDragOffset("--popup-drag-x");
        const startOffsetY = getDragOffset("--popup-drag-y");
        setDialogDragOffset(startOffsetX, startOffsetY);
        dialog.classList.add("is-popup-dragging");
        header.classList.add("is-popup-dragging");
        activeDrag = {
            pointerId: event.pointerId,
            header: header,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startOffsetX: startOffsetX,
            startOffsetY: startOffsetY,
            startRect: dialog.getBoundingClientRect()
        };
        document.body.classList.add("handrive-popup-dragging");
        try {
            header.setPointerCapture(event.pointerId);
        } catch (error) {}
    }

    function endHeaderDrag(event) {
        if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
        dialog.classList.remove("is-popup-dragging");
        if (activeDrag.header) activeDrag.header.classList.remove("is-popup-dragging");
        document.body.classList.remove("handrive-popup-dragging");
        activeDrag = null;
    }

    function clampCurrentDialogToViewport() {
        if (!dialog || !dialog.hasAttribute("data-popup-draggable-dialog")) return;
        const viewport = viewportSize();
        const rect = dialog.getBoundingClientRect();
        let nextX = getDragOffset("--popup-drag-x");
        let nextY = getDragOffset("--popup-drag-y");
        if (rect.left < dragMargin) {
            nextX += dragMargin - rect.left;
        } else if (rect.right > viewport.width - dragMargin) {
            nextX -= rect.right - (viewport.width - dragMargin);
        }
        if (rect.top < dragMargin) {
            nextY += dragMargin - rect.top;
        } else if (rect.bottom > viewport.height - dragMargin) {
            nextY -= rect.bottom - (viewport.height - dragMargin);
        }
        setDialogDragOffset(nextX, nextY);
    }

    function handleJsonPayload(data) {
        if (!data) return;
        if (data.panel_html) {
            replacePanel(data.panel_html);
            return;
        }
        if (data.panel_url) {
            loadPanel(data.panel_url);
            return;
        }
        if (data.reload) {
            window.location.reload();
            return;
        }
        if (data.redirect_url) {
            window.location.assign(data.redirect_url);
        }
    }

    function readResponse(response) {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.indexOf("application/json") !== -1) {
            return response.json().then(function (data) {
                return { kind: "json", data: data };
            });
        }
        return response.text().then(function (html) {
            return { kind: "html", data: html };
        });
    }

    function loadPanel(url, initialTitle) {
        const requestId = ++activeRequestId;
        setModalOpen(true);
        if (initialTitle) setModalTitle(initialTitle);
        showLoading();

        fetch(url, {
            method: "GET",
            credentials: "same-origin",
            headers: {
                "Accept": "text/html, application/json",
                "X-Site-Auth-Modal": "1"
            }
        })
            .then(readResponse)
            .then(function (payload) {
                if (requestId !== activeRequestId) return;
                if (payload.kind === "json") {
                    handleJsonPayload(payload.data);
                    return;
                }
                replacePanel(payload.data);
            })
            .catch(function () {
                if (requestId !== activeRequestId) return;
                window.location.assign(url.replace(/([?&])auth_modal=1(&|$)/, "$1").replace(/[?&]$/, ""));
            });
    }

    function bindSafeInputs(scope) {
        const forbiddenPattern = /[\s'"`\/\\<>;|&\u201c\u201d\u2018\u2019\x00-\x1F\x7F]/;
        const forbiddenReplacePattern = /[\s'"`\/\\<>;|&\u201c\u201d\u2018\u2019\x00-\x1F\x7F]/g;

        function setTemporaryValidity(input) {
            if (!input || typeof input.setCustomValidity !== "function") return;
            input.setCustomValidity(input.getAttribute("title") || "");
            if (typeof input.reportValidity === "function") input.reportValidity();
            window.setTimeout(function () {
                input.setCustomValidity("");
            }, 1200);
        }

        scope.querySelectorAll("[data-handrive-auth-safe-input]").forEach(function (input) {
            if (input.dataset.siteAuthSafeReady === "1") return;
            input.dataset.siteAuthSafeReady = "1";

            input.addEventListener("beforeinput", function (event) {
                if (!event.data || event.inputType.indexOf("delete") === 0) return;
                if (!forbiddenPattern.test(event.data)) return;
                event.preventDefault();
                setTemporaryValidity(input);
            });

            input.addEventListener("input", function () {
                const safeValue = String(input.value || "").replace(forbiddenReplacePattern, "");
                if (safeValue === input.value) {
                    input.setCustomValidity("");
                    return;
                }
                const selectionStart = input.selectionStart;
                input.value = safeValue;
                try {
                    const nextPosition = Math.min(selectionStart === null ? safeValue.length : selectionStart, safeValue.length);
                    input.setSelectionRange(nextPosition, nextPosition);
                } catch (error) {}
                setTemporaryValidity(input);
            });
        });
    }

    function normalizeOtp(value, maxLength) {
        return String(value || "").replace(/\D/g, "").slice(0, maxLength);
    }

    function bindOtpInputs(scope) {
        scope.querySelectorAll("[data-handrive-otp-input]").forEach(function (input) {
            const wrap = input.closest("[data-handrive-otp-wrap]");
            if (!wrap || input.dataset.otpReady === "1") return;
            input.dataset.otpReady = "1";
            const boxes = Array.from(wrap.querySelectorAll(".auth-otp-box"));
            const maxLength = Number(input.getAttribute("maxlength")) || boxes.length || 6;
            let autoSubmitted = false;

            function submitOtpForm() {
                const form = input.form;
                if (!form || autoSubmitted || input.value.length !== maxLength) return;
                autoSubmitted = true;
                window.setTimeout(function () {
                    if (typeof form.requestSubmit === "function") {
                        form.requestSubmit();
                    } else {
                        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
                    }
                }, 80);
            }

            function render() {
                const value = normalizeOtp(input.value, maxLength);
                if (input.value !== value) input.value = value;
                if (value.length < maxLength) autoSubmitted = false;
                boxes.forEach(function (box, index) {
                    const isMasked = Boolean(value[index]) && index < value.length - 1;
                    box.textContent = value[index] && !isMasked ? value[index] : "";
                    box.classList.toggle("is-masked", isMasked);
                    box.classList.toggle("is-filled", index < value.length);
                    box.classList.toggle("is-active", index === Math.min(value.length, maxLength - 1) && document.activeElement === input);
                });
                wrap.classList.toggle("is-focused", document.activeElement === input);
                if (value.length === maxLength) submitOtpForm();
            }

            function focusInput() {
                input.focus({ preventScroll: true });
                const end = input.value.length;
                try { input.setSelectionRange(end, end); } catch (error) {}
            }

            wrap.addEventListener("click", focusInput);
            wrap.addEventListener("paste", function (event) {
                const text = event.clipboardData ? event.clipboardData.getData("text") : "";
                if (!text) return;
                event.preventDefault();
                input.value = normalizeOtp(text, maxLength);
                input.dispatchEvent(new Event("input", { bubbles: true }));
                focusInput();
            });
            input.addEventListener("input", render);
            input.addEventListener("change", render);
            input.addEventListener("focus", render);
            input.addEventListener("blur", render);
            render();
        });
    }

    function bindLoginCaptcha(form) {
        const captchaStatusUrl = form.dataset.captchaStatusUrl || "";
        const turnstileSiteKey = form.dataset.turnstileSiteKey || "";
        const usernameInput = form.querySelector('input[name="username"]');
        const captchaBlock = form.querySelector("#handrive-login-captcha-block");
        const captchaQuestionNode = form.querySelector("#handrive-login-captcha-question");
        const captchaAnswerInput = form.querySelector('input[name="handrive-captcha-answer"]');
        const turnstileContainer = form.querySelector("#handrive-turnstile-widget");
        if (!captchaBlock || !usernameInput || !captchaStatusUrl) return;

        let usernameCheckTimer = null;
        let lastCheckedUsername = "";
        let turnstileWidgetId = null;

        function loadTurnstileScript() {
            if (!turnstileSiteKey || document.getElementById("auth-turnstile-script")) return;
            const script = document.createElement("script");
            script.id = "auth-turnstile-script";
            script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
            script.async = true;
            script.defer = true;
            script.addEventListener("load", renderTurnstile);
            document.head.appendChild(script);
        }

        function renderTurnstile() {
            if (!window.turnstile || !turnstileContainer || !turnstileSiteKey) {
                loadTurnstileScript();
                return;
            }
            if (turnstileWidgetId !== null && turnstileContainer.childElementCount > 0) return;
            try {
                turnstileWidgetId = window.turnstile.render(turnstileContainer, {
                    sitekey: turnstileSiteKey,
                    theme: document.body.classList.contains("theme-dark") ? "dark" : "light"
                });
            } catch (error) {}
        }

        function setCaptchaVisible(visible, questionText) {
            captchaBlock.hidden = !visible;
            if (captchaQuestionNode) captchaQuestionNode.textContent = visible ? (questionText || "") : "";
            if (captchaAnswerInput) {
                captchaAnswerInput.required = Boolean(visible);
                if (!visible) captchaAnswerInput.value = "";
            }
            if (visible) renderTurnstile();
        }

        function fetchCaptchaStatus(force) {
            const usernameValue = usernameInput.value.trim();
            if (!usernameValue) {
                lastCheckedUsername = "";
                setCaptchaVisible(false, "");
                return;
            }
            if (!force && usernameValue === lastCheckedUsername) return;
            lastCheckedUsername = usernameValue;
            fetch(captchaStatusUrl + "?username=" + encodeURIComponent(usernameValue), {
                method: "GET",
                credentials: "same-origin",
                headers: { "Accept": "application/json" }
            })
                .then(function (response) {
                    if (!response.ok) throw new Error("captcha status failed");
                    return response.json();
                })
                .then(function (data) {
                    if (!data || data.ok !== true) return;
                    setCaptchaVisible(Boolean(data.required), data.question || "");
                })
                .catch(function () {});
        }

        usernameInput.addEventListener("blur", function () {
            fetchCaptchaStatus(true);
        });
        usernameInput.addEventListener("input", function () {
            if (usernameCheckTimer) window.clearTimeout(usernameCheckTimer);
            usernameCheckTimer = window.setTimeout(function () {
                fetchCaptchaStatus(false);
            }, 300);
        });
        if (!captchaBlock.hidden) renderTurnstile();
        fetchCaptchaStatus(true);
    }

    function showInlineError(errorEl, message) {
        if (!errorEl) return;
        errorEl.textContent = message || "";
        errorEl.style.display = message ? "block" : "none";
        errorEl.hidden = !message;
    }

    function ensureFormError(form) {
        let errorEl = form.querySelector(".auth-error");
        if (errorEl) return errorEl;
        errorEl = document.createElement("div");
        errorEl.className = "auth-error";
        const loading = form.querySelector(".auth-loading");
        if (loading && loading.nextSibling) {
            form.insertBefore(errorEl, loading.nextSibling);
        } else {
            form.insertBefore(errorEl, form.firstChild);
        }
        return errorEl;
    }

    function bindLoginResend(form) {
        const resendBtn = form.querySelector(".auth-2fa-resend-link[data-resend-url], #handrive-login-2fa-resend-btn");
        if (!resendBtn || resendBtn.dataset.siteAuthResendReady === "1") return;
        resendBtn.dataset.siteAuthResendReady = "1";
        const resendUrl = resendBtn.dataset.resendUrl || "";
        if (!resendUrl) return;
        const resendMsgEl = form.querySelector("[data-auth-2fa-resend-msg], #handrive-login-2fa-resend-msg, #handrive-2fa-resend-msg");
        const errorEl = form.querySelector("#handrive-login-2fa-error, #handrive-2fa-error, .auth-error");
        const codeInput = form.querySelector("#handrive-login-2fa-code-input, #handrive-2fa-code-input, [data-handrive-otp-input]");
        const originalText = resendBtn.textContent.trim();
        const cooldownMs = 30000;
        let cooldownUntil = 0;
        let timer = null;

        function hideResendMessage() {
            if (!resendMsgEl) return;
            resendMsgEl.textContent = "";
            resendMsgEl.hidden = true;
            delete resendMsgEl.dataset.cooldownMessage;
        }

        function showResendMessage(message, isCooldown) {
            showInlineError(errorEl, "");
            if (!resendMsgEl) return;
            resendMsgEl.textContent = message || "";
            resendMsgEl.hidden = !message;
            if (isCooldown) {
                resendMsgEl.dataset.cooldownMessage = "1";
            } else {
                delete resendMsgEl.dataset.cooldownMessage;
            }
        }

        function showResendError(message) {
            hideResendMessage();
            showInlineError(errorEl, message || "");
        }

        function remainingSeconds() {
            return Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
        }

        function updateCooldown() {
            const remaining = remainingSeconds();
            resendBtn.disabled = remaining > 0;
            resendBtn.textContent = originalText;
            if (resendMsgEl) {
                if (remaining > 0) {
                    showResendMessage("재전송 가능까지 " + remaining + "초", true);
                } else if (resendMsgEl.dataset.cooldownMessage === "1") {
                    hideResendMessage();
                }
            }
            if (timer) window.clearTimeout(timer);
            timer = remaining > 0 ? window.setTimeout(updateCooldown, 1000) : null;
        }

        resendBtn.addEventListener("click", function () {
            if (remainingSeconds() > 0) {
                updateCooldown();
                return;
            }
            resendBtn.disabled = true;
            showInlineError(errorEl, "");
            hideResendMessage();
            fetch(resendUrl, {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "X-CSRFToken": getCsrfToken(form),
                    "Accept": "application/json"
                }
            })
                .then(function (response) { return response.json(); })
                .then(function (data) {
                    if (data.ok) {
                        showResendMessage(form.dataset.login2faResendSuccess || "", false);
                        if (codeInput) {
                            codeInput.value = "";
                            codeInput.dispatchEvent(new Event("input", { bubbles: true }));
                            codeInput.focus({ preventScroll: true });
                        }
                        cooldownUntil = Date.now() + cooldownMs;
                        updateCooldown();
                    } else {
                        resendBtn.disabled = false;
                        showResendError(selectServerMessage(data, form.dataset.login2faResendFallback || ""));
                    }
                })
                .catch(function () {
                    resendBtn.disabled = false;
                    showResendError(form.dataset.siteAuthGenericError || "");
                });
        });
    }

    function bindSignupVerification(form) {
        const sendCodeUrl = form.dataset.signupSendCodeUrl || "";
        const verifyCodeUrl = form.dataset.signupVerifyCodeUrl || "";
        if (!sendCodeUrl || !verifyCodeUrl) return;
        const emailInput = form.querySelector("#id_signup_email");
        const tokenInput = form.querySelector('input[name="email_2fa_token"]');
        const sendCodeBtn = form.querySelector("#handrive-signup-send-code-btn");
        const sendCodeError = form.querySelector("#handrive-signup-send-code-error");
        const codeBlock = form.querySelector("#handrive-signup-code-block");
        const codeInput = form.querySelector("#handrive-signup-code-input");
        const verifyCodeBtn = form.querySelector("#handrive-signup-verify-code-btn");
        const verifyCodeError = form.querySelector("#handrive-signup-verify-code-error");
        const verifiedMsg = form.querySelector("#handrive-signup-verified-msg");
        const resendBtn = form.querySelector("#handrive-signup-resend-btn");
        const resendMsg = form.querySelector("#handrive-signup-resend-msg");
        const cooldownMs = 30000;
        let cooldownEmail = "";
        let cooldownUntil = 0;
        let timer = null;

        function currentEmail() {
            return emailInput ? emailInput.value.trim() : "";
        }

        function remainingSeconds(email) {
            if (!email || email !== cooldownEmail) return 0;
            return Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
        }

        function updateCooldown() {
            const email = currentEmail();
            const remaining = remainingSeconds(email);
            const verified = Boolean(emailInput && emailInput.readOnly);
            if (sendCodeBtn) sendCodeBtn.disabled = verified || remaining > 0;
            if (resendBtn) resendBtn.disabled = verified || remaining > 0;
            if (resendMsg && !verified) {
                if (remaining > 0) {
                    resendMsg.textContent = "재전송 가능까지 " + remaining + "초";
                    resendMsg.hidden = false;
                    resendMsg.dataset.cooldownMessage = "1";
                } else if (resendMsg.dataset.cooldownMessage === "1") {
                    resendMsg.textContent = "";
                    resendMsg.hidden = true;
                    delete resendMsg.dataset.cooldownMessage;
                }
            }
            if (timer) window.clearTimeout(timer);
            timer = remaining > 0 ? window.setTimeout(updateCooldown, 1000) : null;
        }

        function startCooldown(email) {
            cooldownEmail = email;
            cooldownUntil = Date.now() + cooldownMs;
            updateCooldown();
        }

        function setEmailVerified() {
            if (emailInput) {
                emailInput.readOnly = true;
                emailInput.setAttribute("aria-disabled", "true");
            }
            if (codeInput) codeInput.disabled = true;
            if (sendCodeBtn) sendCodeBtn.disabled = true;
            if (verifyCodeBtn) verifyCodeBtn.disabled = true;
            if (verifiedMsg) {
                verifiedMsg.hidden = false;
                verifiedMsg.style.display = "block";
            }
            showInlineError(verifyCodeError, "");
        }

        function sendCode(showResendMessage) {
            const email = currentEmail();
            if (!email) {
                showInlineError(sendCodeError, "이메일 주소를 입력해주세요.");
                if (sendCodeBtn) sendCodeBtn.disabled = false;
                if (resendBtn) resendBtn.disabled = false;
                return;
            }
            if (remainingSeconds(email) > 0) {
                updateCooldown();
                return;
            }
            showInlineError(sendCodeError, "");
            showInlineError(verifyCodeError, "");
            const body = new URLSearchParams();
            body.append("email", email);
            fetch(sendCodeUrl, {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "X-CSRFToken": getCsrfToken(form),
                    "Accept": "application/json"
                },
                body: body
            })
                .then(function (response) { return response.json(); })
                .then(function (data) {
                    if (data.ok) {
                        if (codeBlock) codeBlock.hidden = false;
                        if (codeInput) {
                            codeInput.value = "";
                            codeInput.focus({ preventScroll: true });
                        }
                        if (resendMsg && showResendMessage) {
                            resendMsg.textContent = form.dataset.signupResendSuccess || "";
                            resendMsg.hidden = false;
                        }
                        startCooldown(email);
                    } else {
                        showInlineError(sendCodeError, selectServerMessage(data, "오류가 발생했습니다."));
                        if (sendCodeBtn) sendCodeBtn.disabled = false;
                        if (resendBtn) resendBtn.disabled = false;
                    }
                })
                .catch(function () {
                    showInlineError(sendCodeError, form.dataset.siteAuthGenericError || "");
                    if (sendCodeBtn) sendCodeBtn.disabled = false;
                    if (resendBtn) resendBtn.disabled = false;
                });
        }

        if (sendCodeBtn) {
            sendCodeBtn.addEventListener("click", function () {
                sendCodeBtn.disabled = true;
                sendCode(false);
            });
        }
        if (resendBtn) {
            resendBtn.addEventListener("click", function () {
                resendBtn.disabled = true;
                sendCode(true);
            });
        }
        if (verifyCodeBtn) {
            verifyCodeBtn.addEventListener("click", function () {
                const code = codeInput ? codeInput.value.trim() : "";
                if (!code) {
                    showInlineError(verifyCodeError, "인증 코드를 입력해주세요.");
                    return;
                }
                verifyCodeBtn.disabled = true;
                const body = new URLSearchParams();
                body.append("code", code);
                fetch(verifyCodeUrl, {
                    method: "POST",
                    credentials: "same-origin",
                    headers: {
                        "X-CSRFToken": getCsrfToken(form),
                        "Accept": "application/json"
                    },
                    body: body
                })
                    .then(function (response) { return response.json(); })
                    .then(function (data) {
                        verifyCodeBtn.disabled = false;
                        if (data.ok && data.token) {
                            if (tokenInput) tokenInput.value = data.token;
                            setEmailVerified();
                        } else {
                            showInlineError(verifyCodeError, selectServerMessage(data, "인증에 실패했습니다."));
                        }
                    })
                    .catch(function () {
                        verifyCodeBtn.disabled = false;
                        showInlineError(verifyCodeError, form.dataset.siteAuthGenericError || "");
                    });
            });
        }
        if (codeInput) {
            codeInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter" && !event.isComposing) {
                    event.preventDefault();
                    if (verifyCodeBtn && !verifyCodeBtn.disabled) verifyCodeBtn.click();
                }
            });
        }
        if (emailInput) {
            emailInput.addEventListener("input", updateCooldown);
        }
    }

    function setSubmitting(form, submitter, submitting) {
        form.dataset.submitting = submitting ? "1" : "0";
        form.classList.toggle("is-submitting", submitting);
        form.setAttribute("aria-busy", submitting ? "true" : "false");
        const modalContent = getModalContentForForm(form);
        const modalLoading = modalContent ? ensureModalContentLoading(modalContent) : null;
        if (modalContent) modalContent.classList.toggle("is-submitting", submitting);
        if (modalLoading) modalLoading.hidden = !submitting;
        const loading = form.querySelector(".auth-loading");
        if (loading) loading.hidden = modalLoading ? true : !submitting;
        if (submitter) submitter.disabled = submitting;
    }

    function bindAjaxForm(form) {
        if (!form || form.dataset.siteAuthAjaxReady === "1") return;
        form.dataset.siteAuthAjaxReady = "1";
        form.addEventListener("submit", function (event) {
            if (event.defaultPrevented) return;
            event.preventDefault();
            if (form.dataset.submitting === "1") return;
            if (typeof form.reportValidity === "function" && !form.reportValidity()) return;

            const submitter = event.submitter || form.querySelector("button[type='submit'], input[type='submit']");
            setSubmitting(form, submitter, true);
            const body = new FormData(form);
            body.set("auth_modal", "1");
            fetch(form.getAttribute("action") || window.location.href, {
                method: (form.getAttribute("method") || "post").toUpperCase(),
                credentials: "same-origin",
                headers: {
                    "Accept": "application/json, text/html",
                    "X-CSRFToken": getCsrfToken(form),
                    "X-Site-Auth-Modal": "1"
                },
                body: body
            })
                .then(readResponse)
                .then(function (payload) {
                    if (payload.kind === "json") {
                        handleJsonPayload(payload.data);
                        return;
                    }
                    replacePanel(payload.data);
                })
                .catch(function () {
                    setSubmitting(form, submitter, false);
                    showInlineError(
                        ensureFormError(form),
                        form.dataset.siteAuthGenericError || "오류가 발생했습니다. 다시 시도해주세요."
                    );
                });
        });
    }

    function preparePanel() {
        const panel = content.querySelector("[data-auth-panel]");
        if (!panel) return;
        const title = panel.getAttribute("data-auth-panel-title") || "";
        setModalTitle(title);
        bindSafeInputs(panel);
        bindOtpInputs(panel);
        panel.querySelectorAll("form[data-auth-form]").forEach(function (form) {
            bindLoginCaptcha(form);
            bindLoginResend(form);
            bindSignupVerification(form);
            bindAjaxForm(form);
        });
    }

    document.addEventListener("click", function (event) {
        const link = event.target.closest ? event.target.closest("a[data-auth-modal]") : null;
        if (!link || !isPlainPrimaryClick(event)) return;
        const panelUrl = buildPanelUrl(link.href);
        if (!panelUrl) return;
        event.preventDefault();
        lastFocusedElement = link;
        loadPanel(panelUrl, link.getAttribute("aria-label") || link.textContent || "");
    });

    closeControls.forEach(function (control) {
        control.addEventListener("click", function () {
            setModalOpen(false);
        });
    });

    document.addEventListener("keydown", function (event) {
        if (modal.hidden || event.key !== "Escape") return;
        event.preventDefault();
        setModalOpen(false);
    });

    document.addEventListener("pointerdown", function (event) {
        if (event.defaultPrevented) return;
        if (hasHandrivePopupDragHelper()) return;
        if (modal.hidden || event.button !== 0 || event.isPrimary === false) return;
        const target = event.target && event.target.closest ? event.target : null;
        const header = target ? target.closest(".handrive-popup-head") : null;
        if (!header || !modal.contains(header) || isInteractiveDragTarget(target, header)) return;
        event.preventDefault();
        startHeaderDrag(event, header);
    });

    document.addEventListener("pointermove", function (event) {
        if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
        event.preventDefault();
        const rawX = activeDrag.startOffsetX + event.clientX - activeDrag.startClientX;
        const rawY = activeDrag.startOffsetY + event.clientY - activeDrag.startClientY;
        const nextOffset = clampDragOffset(activeDrag, rawX, rawY);
        setDialogDragOffset(nextOffset.x, nextOffset.y);
    }, { passive: false });

    document.addEventListener("pointerup", endHeaderDrag);
    document.addEventListener("pointercancel", endHeaderDrag);
    window.addEventListener("resize", clampCurrentDialogToViewport);
})();
