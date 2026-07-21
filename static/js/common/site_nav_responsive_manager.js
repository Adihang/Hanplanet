// Shared responsive navbar manager. It measures brand/links/controls and collapses when overlap would occur.
(function () {
    if (window.__initSiteNavResponsiveManager) {
        return;
    }

    window.__initSiteNavResponsiveManager = function (options) {
        // This module is initialized by site.js so navbar scroll behavior can be passed in without globals.
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
        const collapsedBodyClass = 'site-nav-auto-collapsed';
        const navOpenClass = 'show';
        const navModeStorageKey = 'hanplanet_site_nav_mode_v1';

        if (!navContainer || !navBrandGroup || !navLinks || !navCollapse || !navToggler) {
            return;
        }

        const throttledHandleNavbarScroll = options && typeof options.throttledHandleNavbarScroll === 'function'
            ? options.throttledHandleNavbarScroll
            : null;
        const forceClearNavContainerDecorations = function () {
            // Bootstrap collapse transitions can leave inline borders/outlines behind, so scrub them aggressively.
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
            // Measure a cloned node off-screen so responsive decisions are based on natural inline width.
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

            document.body.appendChild(measureNode);
            const width = Math.ceil(measureNode.getBoundingClientRect().width);
            measureNode.remove();
            return width;
        };

        const getMeasuredNavItemsWidth = function () {
            // Links and controls are measured separately because they stack differently in collapsed mode.
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
            return linksWidth + controlsWidth;
        };

        const forceCloseNavMenu = function () {
            // Reset both Bootstrap's collapse instance and our fallback classes so
            // responsive recalculation always starts from the fully closed baseline.
            if (window.bootstrap && window.bootstrap.Collapse) {
                const collapseInstance = window.bootstrap.Collapse.getInstance(navCollapse);

                if (collapseInstance) {
                    collapseInstance.hide();
                }
            }

            navCollapse.classList.remove(navOpenClass, 'collapsing');
            navCollapse.style.height = '';
            navToggler.classList.add('collapsed');
            navToggler.setAttribute('aria-expanded', 'false');
            forceClearNavContainerDecorations();
        };

        const setFallbackNavMenuOpen = function (open) {
            navCollapse.classList.toggle(navOpenClass, open);
            navCollapse.classList.remove('collapsing');
            navCollapse.style.height = '';
            navToggler.classList.toggle('collapsed', !open);
            navToggler.setAttribute('aria-expanded', open ? 'true' : 'false');
            forceClearNavContainerDecorations();
        };

        const toggleFallbackNavMenu = function () {
            setFallbackNavMenuOpen(!navCollapse.classList.contains(navOpenClass));
        };

        const syncDocumentNavMode = function () {
            if (!document.body) {
                return;
            }
            document.body.classList.toggle(collapsedBodyClass, nav.classList.contains('nav-auto-collapsed'));
        };

        const persistNavMode = function () {
            try {
                window.sessionStorage.setItem(navModeStorageKey, JSON.stringify({
                    collapsed: nav.classList.contains('nav-auto-collapsed'),
                    viewportWidth: Math.round(window.innerWidth || document.documentElement.clientWidth || 0)
                }));
            } catch (error) {
                // Responsive behavior must still work when storage is unavailable.
            }
        };

        const updateNavMode = function () {
            // Collapse automatically only when the live inline layout would overlap the brand block.
            rafId = null;

            nav.classList.remove('nav-auto-collapsed');
            forceCloseNavMenu();

            const availableWidth = navContainer.getBoundingClientRect().width;
            const brandWidth = navBrandGroup.getBoundingClientRect().width;
            const navItemsBlockWidth = getMeasuredNavItemsWidth();
            const requiredWidth = brandWidth + navItemsBlockWidth + 22;
            const shouldCollapseByOverlap = requiredWidth > availableWidth;

            if (shouldCollapseByOverlap) {
                nav.classList.add('nav-auto-collapsed');
                forceCloseNavMenu();
            }

            syncDocumentNavMode();
            persistNavMode();
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
        navToggler.addEventListener('click', function (event) {
            if (!window.bootstrap || !window.bootstrap.Collapse) {
                event.preventDefault();
                toggleFallbackNavMenu();
                return;
            }
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

    };
})();
