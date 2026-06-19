(function () {
    "use strict";

    const popupFeatures = "popup,width=900,height=700,scrollbars=yes,resizable=yes,toolbar=no,menubar=no,location=no,status=no";

    document.addEventListener("click", function (event) {
        const target = event.target && event.target.closest
            ? event.target.closest("[data-legal-popup-url], .footer-links .footer-link")
            : null;
        if (!target) return;

        const popupUrl = target.getAttribute("data-legal-popup-url") || target.href;
        if (!popupUrl) return;

        event.preventDefault();
        window.open(popupUrl, "_blank", popupFeatures);
    });
})();
