// Shared modal dialog for choosing which portfolio projects should be included in a print/export run.
(function () {
    if (window.__openProjectPrintSelectorDialog) {
        return;
    }

    window.__openProjectPrintSelectorDialog = function (projectOptions, printText) {
        return new Promise(function (resolve) {
            // Read runtime theme tokens so the dialog visually matches the current light/dark site theme.
            const isDarkDialog = document.body && document.body.classList
                ? document.body.classList.contains('theme-dark')
                : false;
            const readThemeToken = function (tokenName, fallbackValue) {
                try {
                    const styleTarget = document.body || document.documentElement;
                    const tokenValue = window.getComputedStyle(styleTarget).getPropertyValue(tokenName);
                    if (tokenValue && tokenValue.trim()) {
                        return tokenValue.trim();
                    }
                } catch (error) {}
                return fallbackValue;
            };

            const buttonTemplate = {
                base: {
                    background: readThemeToken('--btn-template-base-bg', 'transparent'),
                    border: readThemeToken('--btn-template-base-border', isDarkDialog ? 'rgba(255, 255, 255, 0.26)' : 'rgba(0, 0, 0, 0.18)'),
                    color: readThemeToken('--btn-template-base-color', isDarkDialog ? '#e8ebf1' : '#2f2f2f'),
                    hoverBackground: readThemeToken('--btn-template-base-hover-bg', isDarkDialog ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.06)'),
                    hoverBorder: readThemeToken('--btn-template-base-hover-border', isDarkDialog ? 'rgba(255, 255, 255, 0.32)' : 'rgba(0, 0, 0, 0.24)'),
                    hoverColor: readThemeToken('--btn-template-base-hover-color', isDarkDialog ? '#ffffff' : '#000000')
                },
                primary: {
                    background: readThemeToken('--btn-template-primary-bg', isDarkDialog ? 'rgb(95, 95, 104)' : 'rgb(65, 141, 65)'),
                    border: readThemeToken('--btn-template-primary-border', 'transparent'),
                    color: readThemeToken('--btn-template-primary-color', '#ffffff'),
                    hoverBackground: readThemeToken('--btn-template-primary-hover-bg', isDarkDialog ? 'rgb(84, 84, 92)' : 'rgb(57, 124, 57)'),
                    hoverBorder: readThemeToken('--btn-template-primary-hover-border', 'transparent'),
                    hoverColor: readThemeToken('--btn-template-primary-hover-color', '#ffffff')
                },
                transition: readThemeToken('--btn-template-transition', 'background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease, transform 0.2s ease'),
                hoverLift: readThemeToken('--btn-template-hover-lift', '-1px'),
                borderRadius: readThemeToken('--btn-template-radius', '8px')
            };

            const dialogTheme = isDarkDialog ? {
                overlayOpenColor: readThemeToken('--site-modal-backdrop-surface-bg', 'rgba(0, 0, 0, 0)'),
                overlayBackdropFilter: readThemeToken('--site-modal-backdrop-filter', 'none'),
                panelBackground: readThemeToken('--site-modal-surface-bg', 'rgba(46, 46, 46, 0.72)'),
                panelBackdropFilter: readThemeToken('--site-modal-surface-filter', 'saturate(120%) blur(4px)'),
                panelBorderColor: 'transparent',
                panelShadow: 'var(--site-popup-shadow-common, var(--site-shadow-md, 0 12px 28px rgba(0, 0, 0, 0.28))), var(--site-modal-exterior-dim-shadow, 0 0 0 100vmax rgba(0, 0, 0, 0.24))',
                titleColor: '#f1f3f7',
                descriptionColor: '#c1c7d0',
                listBorderColor: 'transparent',
                listInsetShadow: 'inset 0 12px 12px -12px rgba(255, 255, 255, 0.08), inset 0 -12px 12px -12px rgba(255, 255, 255, 0.08)',
                emptyColor: '#b5bbc5',
                labelHoverBackground: 'rgba(255, 255, 255, 0.08)',
                optionTextColor: '#e6e9ef',
                checkboxAccentColor: '#8d96a8',
                buttonBaseBackground: buttonTemplate.base.background,
                buttonBaseBorder: buttonTemplate.base.border,
                buttonBaseColor: buttonTemplate.base.color,
                buttonHoverBackground: buttonTemplate.base.hoverBackground,
                buttonHoverBorder: buttonTemplate.base.hoverBorder,
                buttonHoverColor: buttonTemplate.base.hoverColor,
                buttonPrimaryBackground: buttonTemplate.primary.background,
                buttonPrimaryBorder: buttonTemplate.primary.border,
                buttonPrimaryColor: buttonTemplate.primary.color,
                buttonPrimaryHoverBackground: buttonTemplate.primary.hoverBackground,
                buttonPrimaryHoverBorder: buttonTemplate.primary.hoverBorder,
                buttonPrimaryHoverColor: buttonTemplate.primary.hoverColor,
                buttonTransition: buttonTemplate.transition,
                buttonHoverLift: buttonTemplate.hoverLift,
                buttonRadius: buttonTemplate.borderRadius
            } : {
                overlayOpenColor: readThemeToken('--site-modal-backdrop-surface-bg', 'rgba(0, 0, 0, 0)'),
                overlayBackdropFilter: readThemeToken('--site-modal-backdrop-filter', 'none'),
                panelBackground: readThemeToken('--site-modal-surface-bg', 'rgba(248, 248, 248, 0.72)'),
                panelBackdropFilter: readThemeToken('--site-modal-surface-filter', 'saturate(120%) blur(4px)'),
                panelBorderColor: 'transparent',
                panelShadow: 'var(--site-popup-shadow-common, var(--site-shadow-md, 0 12px 28px rgba(0, 0, 0, 0.28))), var(--site-modal-exterior-dim-shadow, 0 0 0 100vmax rgba(0, 0, 0, 0.24))',
                titleColor: '#161616',
                descriptionColor: '#535353',
                listBorderColor: 'transparent',
                listInsetShadow: 'inset 0 12px 12px -12px rgba(0, 0, 0, 0.24), inset 0 -12px 12px -12px rgba(0, 0, 0, 0.24)',
                emptyColor: '#555555',
                labelHoverBackground: 'rgba(0, 0, 0, 0.04)',
                optionTextColor: '#202020',
                checkboxAccentColor: '#5a5a5a',
                buttonBaseBackground: buttonTemplate.base.background,
                buttonBaseBorder: buttonTemplate.base.border,
                buttonBaseColor: buttonTemplate.base.color,
                buttonHoverBackground: buttonTemplate.base.hoverBackground,
                buttonHoverBorder: buttonTemplate.base.hoverBorder,
                buttonHoverColor: buttonTemplate.base.hoverColor,
                buttonPrimaryBackground: buttonTemplate.primary.background,
                buttonPrimaryBorder: buttonTemplate.primary.border,
                buttonPrimaryColor: buttonTemplate.primary.color,
                buttonPrimaryHoverBackground: buttonTemplate.primary.hoverBackground,
                buttonPrimaryHoverBorder: buttonTemplate.primary.hoverBorder,
                buttonPrimaryHoverColor: buttonTemplate.primary.hoverColor,
                buttonTransition: buttonTemplate.transition,
                buttonHoverLift: buttonTemplate.hoverLift,
                buttonRadius: buttonTemplate.borderRadius
            };

            const bindDialogButtonInteraction = function (button, styleSet) {
                // Buttons are styled in JS because the dialog is generated dynamically from a template fragment.
                if (!button) {
                    return;
                }

                const baseBackground = typeof styleSet.baseBackground !== 'undefined'
                    ? styleSet.baseBackground
                    : dialogTheme.buttonBaseBackground;
                const baseBorder = typeof styleSet.baseBorder !== 'undefined'
                    ? styleSet.baseBorder
                    : dialogTheme.buttonBaseBorder;
                const baseColor = typeof styleSet.baseColor !== 'undefined'
                    ? styleSet.baseColor
                    : dialogTheme.buttonBaseColor;
                const hoverBackground = typeof styleSet.hoverBackground !== 'undefined'
                    ? styleSet.hoverBackground
                    : dialogTheme.buttonHoverBackground;
                const hoverBorder = typeof styleSet.hoverBorder !== 'undefined'
                    ? styleSet.hoverBorder
                    : dialogTheme.buttonHoverBorder;
                const hoverColor = typeof styleSet.hoverColor !== 'undefined'
                    ? styleSet.hoverColor
                    : baseColor;

                button.style.transition = dialogTheme.buttonTransition;

                const setBaseStyle = function () {
                    button.style.background = baseBackground;
                    button.style.borderColor = baseBorder;
                    button.style.color = baseColor;
                    button.style.boxShadow = 'none';
                    button.style.transform = 'translateY(0)';
                };

                const setHoverStyle = function () {
                    button.style.background = hoverBackground;
                    button.style.borderColor = hoverBorder;
                    button.style.color = hoverColor;
                    button.style.boxShadow = 'none';
                    button.style.transform = 'translateY(' + dialogTheme.buttonHoverLift + ')';
                };

                setBaseStyle();

                button.addEventListener('mouseenter', setHoverStyle);
                button.addEventListener('mouseleave', setBaseStyle);
                button.addEventListener('focus', setHoverStyle);
                button.addEventListener('blur', setBaseStyle);
            };

            const applyDialogNavLinkButtonStyle = function (button, options) {
                if (!button) {
                    return;
                }

                const resolved = options || {};
                Object.assign(button.style, {
                    padding: resolved.padding || '6.4px 14px',
                    borderRadius: dialogTheme.buttonRadius,
                    border: '1px solid ' + (resolved.borderColor || dialogTheme.buttonBaseBorder),
                    background: resolved.background || dialogTheme.buttonBaseBackground,
                    color: resolved.color || dialogTheme.buttonBaseColor,
                    fontWeight: resolved.fontWeight || '600',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer'
                });

                if (resolved.fontSize) {
                    button.style.fontSize = resolved.fontSize;
                }

                bindDialogButtonInteraction(
                    button,
                    resolved.interactionStyle || {
                        baseBackground: dialogTheme.buttonBaseBackground,
                        baseBorder: dialogTheme.buttonBaseBorder,
                        baseColor: dialogTheme.buttonBaseColor,
                        hoverBackground: dialogTheme.buttonHoverBackground,
                        hoverBorder: dialogTheme.buttonHoverBorder,
                        hoverColor: dialogTheme.buttonHoverColor
                    }
                );
            };

            const overlayFadeMs = 210;
            const selectorTemplate = document.getElementById('portfolio-print-selector-template');
            const templateElementSupported = typeof HTMLTemplateElement !== 'undefined';
            if (!templateElementSupported || !(selectorTemplate instanceof HTMLTemplateElement)) {
                resolve(null);
                return;
            }

            const templateFragment = selectorTemplate.content.cloneNode(true);
            const overlay = templateFragment.querySelector('[data-popup-role="overlay"]');
            const panel = templateFragment.querySelector('[data-popup-role="panel"]');
            const title = templateFragment.querySelector('[data-popup-role="title"]');
            const description = templateFragment.querySelector('[data-popup-role="description"]');
            const listArea = templateFragment.querySelector('[data-popup-role="list"]');
            const footer = templateFragment.querySelector('[data-popup-role="footer"]');
            const leftButtons = templateFragment.querySelector('[data-popup-role="left-buttons"]');
            const rightButtons = templateFragment.querySelector('[data-popup-role="right-buttons"]');
            const selectAllButton = templateFragment.querySelector('button[data-popup-action="select-all"]');
            const clearButton = templateFragment.querySelector('button[data-popup-action="clear-all"]');
            const cancelButton = templateFragment.querySelector('button[data-popup-action="cancel"]');
            const closeButton = templateFragment.querySelector('button[data-popup-action="close"]');
            const printButtonInDialog = templateFragment.querySelector('button[data-popup-action="print"]');

            if (
                !overlay ||
                !panel ||
                !title ||
                !description ||
                !listArea ||
                !footer ||
                !leftButtons ||
                !rightButtons ||
                !selectAllButton ||
                !clearButton ||
                !cancelButton ||
                !closeButton ||
                !printButtonInDialog
            ) {
                resolve(null);
                return;
            }

            Object.assign(overlay.style, {
                position: 'fixed',
                inset: '0',
                zIndex: 'var(--site-modal-stack-z, var(--site-z-modal, 1400))',
                background: 'rgba(0, 0, 0, 0)',
                backdropFilter: dialogTheme.overlayBackdropFilter,
                opacity: '0',
                transition: 'background-color ' + overlayFadeMs + 'ms ease, opacity ' + overlayFadeMs + 'ms ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '20px',
                isolation: 'isolate'
            });

            Object.assign(panel.style, {
                width: 'fit-content',
                minWidth: '360px',
                maxWidth: 'calc(100vw - 28px)',
                maxHeight: '82vh',
                overflow: 'hidden',
                position: 'relative',
                zIndex: '1',
                background: dialogTheme.panelBackground,
                backdropFilter: dialogTheme.panelBackdropFilter,
                border: '0',
                borderRadius: '14px',
                boxShadow: dialogTheme.panelShadow,
                display: 'flex',
                flexDirection: 'column'
            });
            overlay.style.setProperty('-webkit-backdrop-filter', dialogTheme.overlayBackdropFilter);
            panel.style.setProperty('-webkit-backdrop-filter', dialogTheme.panelBackdropFilter);

            title.textContent = printText.dialogTitle;
            Object.assign(title.style, {
                margin: '0',
                padding: '0',
                flex: '1 1 auto',
                fontSize: '1.12rem',
                fontWeight: '700',
                color: dialogTheme.titleColor,
                textAlign: 'left'
            });

            description.textContent = printText.dialogDescription;
            Object.assign(description.style, {
                margin: '0',
                padding: '0 18px 10px 18px',
                fontSize: '0.9rem',
                lineHeight: '1.5',
                whiteSpace: 'pre-line',
                color: dialogTheme.descriptionColor
            });

            Object.assign(listArea.style, {
                overflowY: 'auto',
                maxHeight: '48vh',
                borderTop: '0',
                borderBottom: '0',
                padding: '8px 12px',
                boxShadow: dialogTheme.listInsetShadow
            });

            const checkboxes = [];
            if (projectOptions.length === 0) {
                const emptyMessage = document.createElement('div');
                emptyMessage.textContent = printText.noProjects;
                Object.assign(emptyMessage.style, {
                    padding: '10px 8px',
                    color: dialogTheme.emptyColor,
                    fontSize: '0.9rem'
                });
                listArea.appendChild(emptyMessage);
            } else {
                projectOptions.forEach(function (project) {
                    const label = document.createElement('label');
                    Object.assign(label.style, {
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '10px',
                        padding: '9px 8px',
                        borderRadius: '8px',
                        cursor: 'pointer'
                    });
                    label.addEventListener('mouseover', function () {
                        label.style.background = dialogTheme.labelHoverBackground;
                    });
                    label.addEventListener('mouseout', function () {
                        label.style.background = 'transparent';
                    });

                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.value = project.url;
                    checkbox.style.marginTop = '2px';
                    checkbox.style.accentColor = dialogTheme.checkboxAccentColor;

                    const text = document.createElement('span');
                    text.textContent = project.title;
                    Object.assign(text.style, {
                        color: dialogTheme.optionTextColor,
                        fontSize: '0.92rem',
                        lineHeight: '1.4'
                    });

                    label.appendChild(checkbox);
                    label.appendChild(text);
                    listArea.appendChild(label);
                    checkboxes.push(checkbox);
                });
            }

            Object.assign(footer.style, {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                padding: '12px 14px'
            });

            Object.assign(leftButtons.style, {
                display: 'flex',
                gap: '8px'
            });

            selectAllButton.textContent = printText.selectAll;
            applyDialogNavLinkButtonStyle(selectAllButton, {
                fontSize: '0.9rem',
                padding: '6px 10px'
            });

            clearButton.textContent = printText.clearAll;
            applyDialogNavLinkButtonStyle(clearButton, {
                fontSize: '0.9rem',
                padding: '6px 10px'
            });

            Object.assign(rightButtons.style, {
                display: 'flex',
                gap: '8px'
            });

            cancelButton.textContent = printText.cancel;
            applyDialogNavLinkButtonStyle(cancelButton, {
                fontSize: '0.95rem',
                padding: '7px 14px'
            });

            printButtonInDialog.textContent = printText.print;
            applyDialogNavLinkButtonStyle(printButtonInDialog, {
                fontSize: '0.95rem',
                padding: '7px 14px',
                fontWeight: '600',
                interactionStyle: {
                    baseBackground: dialogTheme.buttonPrimaryBackground,
                    baseBorder: dialogTheme.buttonPrimaryBorder,
                    baseColor: dialogTheme.buttonPrimaryColor,
                    hoverBackground: dialogTheme.buttonPrimaryHoverBackground,
                    hoverBorder: dialogTheme.buttonPrimaryHoverBorder,
                    hoverColor: dialogTheme.buttonPrimaryHoverColor
                }
            });

            document.body.appendChild(overlay);

            window.requestAnimationFrame(function () {
                overlay.style.background = dialogTheme.overlayOpenColor;
                overlay.style.opacity = '1';
            });

            let isClosing = false;
            const close = function (result) {
                // Resolve exactly once and then remove the generated overlay so
                // repeated print flows do not leak modal DOM or listeners.
                if (isClosing) {
                    return;
                }
                isClosing = true;
                document.removeEventListener('keydown', onKeydown);
                overlay.style.pointerEvents = 'none';
                overlay.style.background = 'rgba(0, 0, 0, 0)';
                overlay.style.opacity = '0';
                window.setTimeout(function () {
                    overlay.remove();
                    resolve(result);
                }, overlayFadeMs + 20);
            };

            const onKeydown = function (event) {
                // Keyboard cancel mirrors clicking the dimmed overlay and keeps the dialog one-exit-path.
                if (event.key === 'Escape') {
                    close(null);
                }
            };

            document.addEventListener('keydown', onKeydown);

            overlay.addEventListener('click', function (event) {
                if (event.target === overlay) {
                    close(null);
                }
            });

            selectAllButton.addEventListener('click', function () {
                checkboxes.forEach(function (checkbox) {
                    checkbox.checked = true;
                });
            });

            clearButton.addEventListener('click', function () {
                checkboxes.forEach(function (checkbox) {
                    checkbox.checked = false;
                });
            });

            cancelButton.addEventListener('click', function () {
                close(null);
            });

            closeButton.addEventListener('click', function () {
                close(null);
            });

            printButtonInDialog.addEventListener('click', function () {
                const selectedUrls = checkboxes
                    .filter(function (checkbox) {
                        return checkbox.checked;
                    })
                    .map(function (checkbox) {
                        return checkbox.value;
                    });
                close(selectedUrls);
            });
        });
    };
})();
