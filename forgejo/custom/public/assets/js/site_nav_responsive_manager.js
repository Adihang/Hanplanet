(function () {
    if (window.__initSiteNavResponsiveManager) {
        return;
    }

    window.__initSiteNavResponsiveManager = function (options) {
        const nav = document.querySelector('.ui-nav');
        if (!nav) {
            return;
        }

        const getCollapsedNavLinksScroller = function (target) {
            if (!target || !target.closest || !nav.classList.contains('nav-auto-collapsed')) {
                return null;
            }
            const scroller = target.closest('.ui-nav-links');
            if (!scroller || !nav.contains(scroller)) {
                return null;
            }
            return scroller;
        };

        const shouldAllowNavLinksHorizontalScroll = function (event) {
            const scroller = getCollapsedNavLinksScroller(event.target);
            if (!scroller || scroller.scrollWidth <= scroller.clientWidth) {
                return false;
            }
            if (event.type === 'touchmove') {
                return true;
            }
            if (event.type === 'wheel') {
                return Math.abs(event.deltaX || 0) > Math.abs(event.deltaY || 0);
            }
            return false;
        };

        const blockNavInternalScroll = function (event) {
            if (shouldAllowNavLinksHorizontalScroll(event)) {
                return;
            }
            if (event.cancelable) {
                event.preventDefault();
            }
        };

        const resetNavInternalScroll = function (event) {
            const target = event.target;
            if (!(target instanceof HTMLElement) || target === nav) {
                return;
            }

            if (getCollapsedNavLinksScroller(target)) {
                target.scrollTop = 0;
                return;
            }

            target.scrollTop = 0;
            target.scrollLeft = 0;
        };

        nav.addEventListener('wheel', blockNavInternalScroll, { passive: false });
        nav.addEventListener('touchmove', blockNavInternalScroll, { passive: false });
        nav.addEventListener('scroll', resetNavInternalScroll, true);

        const navContainer = nav.querySelector('.container-fluid');
        const navBrandGroup = nav.querySelector('.ui-brand-group');
        const navLinks = nav.querySelector('.ui-nav-links');
        const navCollapse = nav.querySelector('.ui-nav-collapse');
        const navControls = navCollapse ? navCollapse.querySelector('.ui-controls-stack') : null;
        const navToggler = nav.querySelector('.ui-nav-toggler');
        const installButton = nav.querySelector('[data-pwa-install]');

        if (!navContainer || !navBrandGroup || !navLinks || !navCollapse || !navToggler) {
            return;
        }

        const throttledHandleNavbarScroll = options && typeof options.throttledHandleNavbarScroll === 'function'
            ? options.throttledHandleNavbarScroll
            : null;
        const installButtonHomeParent = installButton ? installButton.parentNode : null;
        const installButtonHomeNextSibling = installButton ? installButton.nextSibling : null;

        const placeInstallButtonInline = function () {
            if (!installButton || !installButtonHomeParent) {
                return;
            }
            const referenceNode = installButtonHomeNextSibling && installButtonHomeNextSibling.parentNode === installButtonHomeParent
                ? installButtonHomeNextSibling
                : navControls;
            if (installButton.parentNode === installButtonHomeParent && installButton.nextSibling === referenceNode) {
                return;
            }
            installButtonHomeParent.insertBefore(installButton, referenceNode || null);
        };

        const placeInstallButtonBesideToggler = function () {
            if (!installButton) {
                return;
            }
            if (installButton.parentNode === navContainer && installButton.nextSibling === navToggler) {
                return;
            }
            navContainer.insertBefore(installButton, navToggler);
        };

        const forceClearNavContainerDecorations = function () {
            const resetTargets = [
                navContainer,
                navCollapse,
                navLinks,
                navCollapse.querySelector('.ui-nav-links')
            ];
            const navItems = nav.querySelectorAll('.nav-item');

            navItems.forEach(function (item) {
                resetTargets.push(item);
            });

            resetTargets.forEach(function (target) {
                if (!target || !target.style || !target.style.setProperty) {
                    return;
                }

                if (target === navLinks) {
                    target.style.removeProperty('border');
                    target.style.removeProperty('border-color');
                } else {
                    target.style.border = 'none';
                    target.style.borderColor = 'transparent';
                }
                target.style.outline = 'none';
                target.style.outlineColor = 'transparent';
                target.style.outlineStyle = 'none';
                target.style.outlineWidth = '0';
                target.style.removeProperty('box-shadow');
                target.style.listStyle = 'none';
            });
        };

        let rafId = null;

        const measureInlineWidth = function (sourceNode, styleOverrides) {
            if (!sourceNode) {
                return 0;
            }

            const measureNode = sourceNode.cloneNode(true);
            Object.assign(measureNode.style, {
                position: 'fixed',
                left: '-99999px',
                top: '-99999px',
                visibility: 'hidden',
                pointerEvents: 'none',
                width: 'auto',
                maxWidth: 'none',
                margin: '0',
                padding: '0',
                ...styleOverrides
            });

            const liveInstallBtn = sourceNode.querySelector('[data-pwa-install]');
            const cloneInstallBtn = measureNode.querySelector('[data-pwa-install]');
            if (liveInstallBtn && cloneInstallBtn) {
                const installDisplay = window.getComputedStyle(liveInstallBtn).display;
                cloneInstallBtn.style.display = installDisplay === 'none' ? 'none' : 'inline-flex';
            }

            document.body.appendChild(measureNode);
            const width = Math.ceil(measureNode.getBoundingClientRect().width);
            measureNode.remove();
            return width;
        };

        const measureOuterWidth = function (element) {
            if (!element) {
                return 0;
            }
            const style = window.getComputedStyle(element);
            if (!style || style.display === 'none' || style.visibility === 'hidden') {
                return 0;
            }
            const rect = element.getBoundingClientRect();
            const marginLeft = parseFloat(style.marginLeft || '0') || 0;
            const marginRight = parseFloat(style.marginRight || '0') || 0;
            return Math.ceil(rect.width + marginLeft + marginRight);
        };

        const getMeasuredNavItemsWidth = function () {
            const linksWidth = measureInlineWidth(navLinks, {
                display: 'inline-flex',
                flexDirection: 'row',
                flexWrap: 'nowrap',
                alignItems: 'center',
                listStyle: 'none',
                gap: '0'
            });
            const controlsWidth = navControls ? measureInlineWidth(navControls, {
                display: 'inline-flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: '0'
            }) : 0;
            const installButtonWidth = measureOuterWidth(installButton);

            return linksWidth + controlsWidth + installButtonWidth;
        };

        const forceCloseNavMenu = function () {
            if (window.bootstrap && window.bootstrap.Collapse) {
                const collapseInstance = window.bootstrap.Collapse.getInstance(navCollapse);

                if (collapseInstance) {
                    collapseInstance.hide();
                }
            }

            navCollapse.classList.remove('show', 'collapsing');
            navCollapse.style.height = '';
            navToggler.classList.add('collapsed');
            navToggler.setAttribute('aria-expanded', 'false');
            forceClearNavContainerDecorations();
        };

        const updateNavMode = function () {
            rafId = null;

            placeInstallButtonInline();
            nav.classList.remove('nav-auto-collapsed');
            forceCloseNavMenu();

            const availableWidth = navContainer.getBoundingClientRect().width;
            const brandWidth = navBrandGroup.getBoundingClientRect().width;
            const navItemsBlockWidth = getMeasuredNavItemsWidth();
            const requiredWidth = brandWidth + navItemsBlockWidth + 22;
            const shouldCollapseByOverlap = requiredWidth > availableWidth;

            if (shouldCollapseByOverlap) {
                nav.classList.add('nav-auto-collapsed');
                placeInstallButtonBesideToggler();
                forceCloseNavMenu();
            } else {
                placeInstallButtonInline();
            }

            forceClearNavContainerDecorations();
        };

        const scheduleNavModeUpdate = function () {
            if (rafId !== null) {
                return;
            }

            rafId = window.requestAnimationFrame(updateNavMode);
        };

        window.addEventListener('resize', scheduleNavModeUpdate, { passive: true });
        window.addEventListener('orientationchange', scheduleNavModeUpdate, { passive: true });
        window.addEventListener('beforeinstallprompt', scheduleNavModeUpdate);
        window.addEventListener('appinstalled', scheduleNavModeUpdate);
        navToggler.addEventListener('click', function () {
            window.requestAnimationFrame(forceClearNavContainerDecorations);
        });
        navCollapse.addEventListener('transitionend', forceClearNavContainerDecorations);

        let scrollCleanupTimerId = null;
        window.addEventListener('scroll', function () {
            if (scrollCleanupTimerId !== null) {
                window.clearTimeout(scrollCleanupTimerId);
            }

            scrollCleanupTimerId = window.setTimeout(function () {
                window.requestAnimationFrame(forceClearNavContainerDecorations);
                scrollCleanupTimerId = null;
            }, 180);
        }, { passive: true });
        forceClearNavContainerDecorations();
        scheduleNavModeUpdate();

        if (throttledHandleNavbarScroll) {
            window.addEventListener('scroll', throttledHandleNavbarScroll, { passive: true });
        }

        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(scheduleNavModeUpdate).catch(function () {});
        }

        if (installButton && window.MutationObserver) {
            const installButtonObserver = new MutationObserver(scheduleNavModeUpdate);
            installButtonObserver.observe(installButton, {
                attributes: true,
                attributeFilter: ['style', 'class', 'hidden', 'aria-disabled']
            });
        }
    };
})();
