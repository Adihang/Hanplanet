// Shared account widget used by Sub section pages for menu, profile upload, and logout confirmation UI.
(function () {
    'use strict';

    const hosts = Array.from(document.querySelectorAll('[data-auth-account]'));
    if (!hosts.length) {
        return;
    }

    const logoutModal = document.getElementById('root-auth-logout-modal');
    const logoutModalBackdrop = document.getElementById('root-auth-logout-modal-backdrop');
    const logoutCancelButton = document.getElementById('root-auth-logout-cancel-btn');
    const logoutConfirmButton = document.getElementById('root-auth-logout-confirm-btn');
    const logoutMessage = document.getElementById('root-auth-logout-message');

    // Track focus and target form so the confirm modal can behave like a normal accessible dialog.
    let lastFocusedElement = null;
    let activeLogoutForm = null;

    const submitClonedForm = function (sourceForm) {
        // Clone the original form into a temporary POST so hidden widget markup never has to move in the DOM.
        if (!sourceForm) {
            return;
        }
        const tempForm = document.createElement('form');
        tempForm.method = (sourceForm.getAttribute('method') || 'post').toLowerCase();
        tempForm.action = sourceForm.getAttribute('action') || window.location.href;
        tempForm.style.display = 'none';

        Array.from(sourceForm.elements || []).forEach(function (field) {
            if (!field.name || field.disabled) {
                return;
            }
            const tagName = String(field.tagName || '').toLowerCase();
            const type = String(field.type || '').toLowerCase();

            if ((type === 'checkbox' || type === 'radio') && !field.checked) {
                return;
            }
            if (tagName === 'select' && field.multiple) {
                Array.from(field.options || []).forEach(function (option) {
                    if (!option.selected) {
                        return;
                    }
                    const hidden = document.createElement('input');
                    hidden.type = 'hidden';
                    hidden.name = field.name;
                    hidden.value = option.value;
                    tempForm.appendChild(hidden);
                });
                return;
            }

            const hidden = document.createElement('input');
            hidden.type = 'hidden';
            hidden.name = field.name;
            hidden.value = field.value;
            tempForm.appendChild(hidden);
        });

        document.body.appendChild(tempForm);
        tempForm.submit();
    };

    const closeAllMenus = function () {
        // Sub section pages can render more than one account host, so close all menus before opening another.
        hosts.forEach(function (host) {
            const trigger = host.querySelector('[data-auth-account-trigger]');
            const menu = host.querySelector('[data-auth-account-menu]');
            const statsToggle = host.querySelector('[data-auth-account-stats-toggle]');
            const statsPanel = host.querySelector('[data-auth-account-stats-panel]');
            if (!menu || !trigger) {
                return;
            }
            menu.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
            if (statsToggle && statsPanel) {
                statsToggle.setAttribute('aria-expanded', 'false');
                statsPanel.hidden = true;
            }
        });
    };

    const bindHost = function (host) {
        // Each host gets an isolated account menu instance so multiple widgets can coexist on one page.
        const accountTrigger = host.querySelector('[data-auth-account-trigger]');
        const accountMenu = host.querySelector('[data-auth-account-menu]');
        const accountLogoutButton = host.querySelector('[data-auth-account-logout]');
        const accountStatsToggle = host.querySelector('[data-auth-account-stats-toggle]');
        const accountStatsPanel = host.querySelector('[data-auth-account-stats-panel]');
        const profileUploadForm = host.querySelector('[data-root-account-profile-upload-form]');
        const profileImageTrigger = host.querySelector('[data-root-account-profile-image-trigger]');
        const profileImageInput = host.querySelector('[data-root-account-profile-image-input]');
        const logoutForm =
            host.querySelector('form.ui-auth-form.ui-auth-form-hidden') ||
            host.querySelector('form[action][method="post"]:not([data-root-account-profile-upload-form])') ||
            document.getElementById('auth-logout-form-sub');

        if (!accountTrigger || !logoutForm) {
            return;
        }

        if (accountTrigger.dataset.authWidgetBound === '1') {
            return;
        }
        accountTrigger.dataset.authWidgetBound = '1';

        const setAccountMenuOpen = function (opened) {
            // Treat the menu and stats drawer as one compound popover so state
            // cannot drift when multiple widgets are present on the same page.
            if (!accountMenu) {
                return;
            }
            if (opened) {
                closeAllMenus();
            }
            accountMenu.hidden = !opened;
            accountTrigger.setAttribute('aria-expanded', opened ? 'true' : 'false');
            if (!opened && accountStatsToggle && accountStatsPanel) {
                accountStatsToggle.setAttribute('aria-expanded', 'false');
                accountStatsPanel.hidden = true;
            }
        };

        const requestLogout = function () {
            // Prefer the shared custom modal, but fall back to window.confirm when the dialog markup is absent.
            const confirmMessage = String((accountLogoutButton && accountLogoutButton.getAttribute('data-confirm-message')) || '').trim();
            const submitLogoutForm = function () {
                submitClonedForm(logoutForm);
            };
            if (!logoutModal || !logoutModalBackdrop || !logoutCancelButton || !logoutConfirmButton || !logoutMessage) {
                if (confirmMessage && !window.confirm(confirmMessage)) {
                    return;
                }
                submitLogoutForm();
                return;
            }
            lastFocusedElement = document.activeElement;
            activeLogoutForm = logoutForm;
            logoutMessage.textContent = confirmMessage;
            setLogoutModalOpen(true);
        };

        accountTrigger.addEventListener('click', function (event) {
            event.preventDefault();
            if (!accountMenu) {
                requestLogout();
                return;
            }
            const isOpen = !accountMenu.hidden;
            setAccountMenuOpen(!isOpen);
        });

        if (accountLogoutButton) {
            accountLogoutButton.addEventListener('click', function (event) {
                event.preventDefault();
                setAccountMenuOpen(false);
                requestLogout();
            });
        }

        if (accountStatsToggle && accountStatsPanel) {
            accountStatsToggle.addEventListener('click', function (event) {
                event.preventDefault();
                const expanded = accountStatsToggle.getAttribute('aria-expanded') === 'true';
                accountStatsToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
                accountStatsPanel.hidden = expanded;
            });
        }

        if (profileUploadForm && profileImageTrigger && profileImageInput) {
            profileImageTrigger.addEventListener('click', function (event) {
                event.preventDefault();
                profileImageInput.click();
            });

            profileImageInput.addEventListener('change', function () {
                if (!profileImageInput.files || !profileImageInput.files.length) {
                    return;
                }
                profileUploadForm.submit();
            });
        }
    };

    const setLogoutModalOpen = function (opened) {
        // Restore focus on close so keyboard users return to the trigger that launched the dialog.
        if (!logoutModal) {
            return;
        }
        logoutModal.hidden = !opened;
        if (opened) {
            if (logoutCancelButton) {
                logoutCancelButton.focus();
            }
            return;
        }
        activeLogoutForm = null;
        if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
            lastFocusedElement.focus();
        }
    };

    hosts.forEach(bindHost);

    document.addEventListener('click', function (event) {
        const target = event.target;
        const clickedInsideAnyHost = hosts.some(function (host) {
            return host.contains(target);
        });
        if (!clickedInsideAnyHost) {
            closeAllMenus();
        }
    });

    if (logoutModalBackdrop) {
        logoutModalBackdrop.addEventListener('click', function () {
            setLogoutModalOpen(false);
        });
    }

    if (logoutCancelButton) {
        logoutCancelButton.addEventListener('click', function () {
            setLogoutModalOpen(false);
        });
    }

    if (logoutConfirmButton) {
        logoutConfirmButton.addEventListener('click', function () {
            if (!activeLogoutForm) {
                setLogoutModalOpen(false);
                return;
            }
            const targetLogoutForm = activeLogoutForm;
            setLogoutModalOpen(false);
            submitClonedForm(targetLogoutForm);
        });
    }

    document.addEventListener('keydown', function (event) {
        // Escape first closes any open account menu, then dismisses the logout modal if it is active.
        if (event.key !== 'Escape') {
            return;
        }
        const openedMenu = hosts.find(function (host) {
            const menu = host.querySelector('[data-auth-account-menu]');
            return menu && !menu.hidden;
        });
        if (openedMenu) {
            event.preventDefault();
            closeAllMenus();
            return;
        }
        if (!logoutModal || logoutModal.hidden) {
            return;
        }
        event.preventDefault();
        setLogoutModalOpen(false);
    });
})();
