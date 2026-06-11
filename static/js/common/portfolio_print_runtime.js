// Shared print orchestrator for portfolio pages. It opens a print popup, assembles content, and triggers print.
(function () {
    if (window.__printSummaryWithProjects) {
        return;
    }

    const collectPrintStylesheetTags = function (escapeHtml) {
        // Reuse the live page stylesheets so the popup print document matches the current site styling.
        return Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'))
            .map(function (linkNode) {
                const href = linkNode.getAttribute('href');
                if (!href) {
                    return '';
                }

                try {
                    const absoluteHref = new URL(href, window.location.origin).toString();
                    return '<link rel="stylesheet" href="' + escapeHtml(absoluteHref) + '">';
                } catch (error) {
                    return '';
                }
            })
            .filter(Boolean)
            .join('');
    };

    const openPrintPopupWindow = function () {
        // Prefer a centered popup window; fall back to a normal tab if popup features are blocked.
        const width = Math.max(900, Math.min(1240, window.screen.availWidth - 80));
        const height = Math.max(760, Math.min(980, window.screen.availHeight - 80));
        const left = Math.max(0, Math.round(window.screenX + ((window.outerWidth - width) / 2)));
        const top = Math.max(0, Math.round(window.screenY + ((window.outerHeight - height) / 2)));
        const features = [
            'popup=yes',
            'resizable=yes',
            'scrollbars=yes',
            'toolbar=no',
            'menubar=no',
            'location=no',
            'status=no',
            'width=' + width,
            'height=' + height,
            'left=' + left,
            'top=' + top
        ].join(',');

        let popupWindow = null;
        try {
            popupWindow = window.open('about:blank', 'portfolioPrintPopup', features);
        } catch (error) {}

        if (!popupWindow) {
            try {
                popupWindow = window.open('', '_blank');
            } catch (error) {}
        }

        return popupWindow;
    };

    const buildPrintDocumentHtml = function (options) {
        // Build one self-contained HTML document so print mode does not depend on the parent page state.
        const stylesheetTags = collectPrintStylesheetTags(options.escapeHtml);
        const layout = options.PRINT_IMAGE_LAYOUT || {};
        const imageWidthMm = (layout.portraitMaxWidthMm || 0) * (layout.landscapeWidthByPortraitMultiplier || 0);

        return '<!doctype html>' +
            '<html lang="' + (options.isEnglishPage ? 'en' : 'ko') + '">' +
            '<head>' +
            '<meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width, initial-scale=1">' +
            '<meta name="color-scheme" content="light">' +
            '<title>Portfolio Print</title>' +
            stylesheetTags +
            '<style>' +
            '@page{margin:0;}' +
            'html,body{margin:0;padding:0;background:#fff;color:#111;}' +
            'body{font-family:"KakaoSmallFont","Inter","Helvetica Neue",Arial,sans-serif;line-height:1.45;}' +
            'body::before{content:"www.hanplanet.com/portfolio/";position:fixed;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-45deg);font-weight:900;font-size:clamp(24px,4.8vw,62px);letter-spacing:.06em;color:rgba(0,0,0,.11);pointer-events:none;z-index:0;white-space:nowrap;}' +
            '.print-root{position:relative;z-index:1;padding:3mm;box-sizing:border-box;}' +
            '.print-summary,.print-project{padding-top:8mm;padding-bottom:8mm;padding-left:0;padding-right:0;box-sizing:border-box;border:none;border-radius:0;background:transparent;overflow:visible;}' +
            '.print-summary .main_projects,.print-summary .main_hobbys,.print-summary .foot,.print-summary .portfolio-print-btn,.print-summary .chat-widget,.print-summary .ui-nav{display:none;}' +
            '.print-summary .main_banner,.print-summary .main_contents{width:100%;max-width:none;margin:0 auto;padding-left:0;padding-right:0;box-sizing:border-box;}' +
            '.print-summary .main_banner,.print-summary .main_text{padding-top:0;margin-top:0;}' +
            '.print-summary .main_title{margin-top:0;}' +
            '.print-project{margin-top:12mm;break-before:page;page-break-before:always;}' +
            '.print-project .project_detail_page,.print-project .project_detail{margin-top:0;}' +
            '.print-project .project_detail_title{margin-top:0;}' +
            '.print-summary .tag,.print-project .tag{box-shadow:none;background:#d6d6d6;color:#111;border:1px solid #bdbdbd;}' +
            '.print-summary .tag *,.print-project .tag *{color:inherit;}' +
            '.print-project .project_detail_content{padding-left:4px;padding-right:4px;}' +
            '.print-project .project_detail_content [style*="overflow-x: auto"],.print-project .project_detail_content [style*="overflow-x:auto"]{overflow:visible;white-space:normal;}' +
            '.print-project .project_detail_content img{display:block;margin:6px auto 10px;max-width:min(100%,' + imageWidthMm + 'mm);max-height:136mm;width:auto;height:auto;break-inside:avoid;page-break-inside:avoid;}' +
            '.print-project .responsive-iframe{position:static;width:100%;padding-bottom:0;}' +
            '.print-project iframe{display:none;}' +
            '.print-video-thumb{margin:6px auto 8px;max-width:520px;text-align:center;}' +
            '.print-video-thumb-link{display:block;border:1px solid rgba(0,0,0,.18);border-radius:10px;overflow:hidden;background:#f7f7f7;}' +
            '.print-video-thumb img{display:block;width:100%;height:auto;}' +
            '.print-video-thumb figcaption{margin-top:6px;font-size:12px;color:#444;}' +
            '.print-video-thumb figcaption a{color:inherit;text-decoration:underline;}' +
            '.print-embed-link{margin:8px 0 12px;font-size:12px;}' +
            '.print-embed-link a{color:#333;text-decoration:underline;word-break:break-all;}' +
            '.print-project-error{padding:10px 12px;border:1px solid rgba(0,0,0,.14);border-radius:8px;background:#fafafa;color:#333;}' +
            'hr{display:block;opacity:.25;height:0;border:0;border-top:1px solid #000;background:transparent;}' +
            'img,video,iframe{max-width:100%;height:auto;}' +
            '.bubble-bg-layer,#interactiveBubbleCanvas,.bubble-bg-canvas{display:none;visibility:hidden;}' +
            '</style>' +
            '</head>' +
            '<body class="portfolio-page project-page"><div class="print-root">' +
            options.summaryHtml +
            options.projectSectionsHtml.join('') +
            '</div></body></html>';
    };

    window.__printSummaryWithProjects = async function (options) {
        // Public entry: gather summary + selected project sections, then print once images have settled.
        const printWindow = openPrintPopupWindow();
        if (!printWindow) {
            window.alert(options.printText.popupBlocked);
            return;
        }

        printWindow.document.open();
        printWindow.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Preparing...</title></head><body style="font-family:KakaoSmallFont,Inter,\'Helvetica Neue\',Arial,sans-serif;padding:24px;">' + options.escapeHtml(options.printText.loading) + '</body></html>');
        printWindow.document.close();

        const summaryHtml = options.buildSummaryPrintHtml();
        const projectSectionHtmlList = [];
        for (const project of options.selectedProjects) {
            try {
                const sectionHtml = await options.fetchProjectPrintSectionHtml(project.url, project.title);
                projectSectionHtmlList.push(sectionHtml);
            } catch (error) {
                projectSectionHtmlList.push(
                    '<section class="print-project">' +
                    '<h2>' + options.escapeHtml(project.title) + '</h2>' +
                    '<p class="print-project-error">' + options.escapeHtml(options.printText.loadFailed) + '</p>' +
                    '</section>'
                );
            }
        }

        const printDocumentHtml = buildPrintDocumentHtml({
            summaryHtml: summaryHtml,
            projectSectionsHtml: projectSectionHtmlList,
            escapeHtml: options.escapeHtml,
            isEnglishPage: options.isEnglishPage,
            PRINT_IMAGE_LAYOUT: options.PRINT_IMAGE_LAYOUT
        });

        printWindow.document.open();
        printWindow.document.write(printDocumentHtml);
        printWindow.document.close();

        let printed = false;
        const triggerPrint = function () {
            // Guard against duplicate print attempts because both the popup load event
            // and the fallback timeout can race to trigger the print flow.
            if (printed) {
                return;
            }
            printed = true;
            printWindow.focus();
            printWindow.print();
        };

        const triggerPrintWhenReady = function () {
            // Wait briefly for images to decode so the print preview reflects the final layout.
            options.waitForImagesReady(printWindow.document, 4200)
                .then(function () {
                    triggerPrint();
                })
                .catch(function () {
                    triggerPrint();
                });
        };

        printWindow.addEventListener('load', function () {
            window.setTimeout(triggerPrintWhenReady, 160);
        }, { once: true });

        window.setTimeout(triggerPrintWhenReady, 1300);
        printWindow.addEventListener('afterprint', function () {
            try {
                printWindow.close();
            } catch (error) {}
        });
    };
})();
