(function () {
    "use strict";

    var trigger = document.getElementById("onscripter_game_list");
    var modal = document.getElementById("onscripter-list-confirm-modal");
    var backdrop = document.getElementById("onscripter-list-confirm-modal-backdrop");
    var cancelButton = document.getElementById("onscripter-list-confirm-cancel-btn");
    var confirmButton = document.getElementById("onscripter-list-confirm-confirm-btn");

    if (!trigger || !modal || !backdrop || !cancelButton || !confirmButton) {
        return;
    }

    var lastFocusedElement = null;

    function bringModalToFront() {
        if (window.SiteModalStack && typeof window.SiteModalStack.bringToFront === "function") {
            window.SiteModalStack.bringToFront(modal);
        }
    }

    function closeModal() {
        modal.hidden = true;
        modal.setAttribute("aria-hidden", "true");
        if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
            lastFocusedElement.focus({preventScroll: true});
        }
        lastFocusedElement = null;
    }

    function openModal() {
        lastFocusedElement = document.activeElement;
        modal.hidden = false;
        modal.setAttribute("aria-hidden", "false");
        bringModalToFront();
        confirmButton.focus({preventScroll: true});
    }

    trigger.addEventListener("click", function (event) {
        event.preventDefault();
        openModal();
    });

    backdrop.addEventListener("click", closeModal);
    cancelButton.addEventListener("click", closeModal);
    confirmButton.addEventListener("click", function () {
        var targetUrl = trigger.getAttribute("href");
        if (!targetUrl) {
            closeModal();
            return;
        }
        window.location.assign(targetUrl);
    });

    document.addEventListener("keydown", function (event) {
        if (event.key !== "Escape" || modal.hidden) {
            return;
        }
        event.preventDefault();
        closeModal();
    });
})();
