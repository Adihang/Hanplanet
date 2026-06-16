(function () {
    'use strict';

    // Root search page entry. This one file owns:
    // - search engine picker behavior
    // - root search suggestions dropdown
    // - root-page theme toggle
    // - root account/logout widget hooks
    // - profile image upload trigger
    // - personal shortcut CRUD/reorder UI

    const form = document.querySelector('[data-root-search-form]');
    const input = document.querySelector('[data-root-search-input]');
    const suggestionsPopup = document.querySelector('[data-root-search-suggestions]');
    const engineSelect = document.querySelector('[data-root-search-engine]');
    const enginePicker = document.querySelector('[data-root-engine-picker]');
    const engineToggle = document.querySelector('[data-root-engine-toggle]');
    const enginePopup = document.querySelector('[data-root-engine-popup]');
    const engineLabel = document.querySelector('[data-root-engine-label]');
    const engineIcon = document.querySelector('[data-root-engine-icon]');
    const engineOptions = Array.from(document.querySelectorAll('[data-engine-option]'));
    const isAuthenticatedUser = document.body.dataset.authenticated === '1';
    const userPreferenceUrl = String(document.body.dataset.userPreferenceUrl || '').trim();
    const themePreferenceUrl = String(document.body.dataset.themePreferenceUrl || '').trim();
    const themeToggle = document.querySelector('.ui-theme-toggle');
    const themeToggleButtons = themeToggle
        ? Array.from(themeToggle.querySelectorAll('.ui-control-link[data-theme-mode]'))
        : [];
    const THEME_MODE_STORAGE_KEY = 'portfolio_theme_mode';
    const THEME_MODE_COOKIE_KEY = 'portfolio_theme_mode';
    const ROOT_SEARCH_HISTORY_STORAGE_KEY = 'hanplanet_root_search_history';
    const ROOT_SEARCH_HISTORY_LIMIT = 8;
    const ROOT_SEARCH_SUGGESTION_LIMIT = 7;
    const COOKIE_MAX_AGE_SECONDS = 31536000;
    const accountThemeMode = (document.documentElement.getAttribute('data-account-theme-mode') || '').trim().toLowerCase();
    const searchHistoryDeleteLabel = suggestionsPopup
        ? (String(suggestionsPopup.dataset.historyDeleteLabel || '').trim() || 'Delete search history')
        : 'Delete search history';
    let currentShortcutItems = [];
    let renderedSearchSuggestions = [];
    let activeSearchSuggestionIndex = -1;

    if (!form || !input || !engineSelect || !enginePicker || !engineToggle || !enginePopup || !engineLabel || !engineIcon || !engineOptions.length) {
        return;
    }

    const relocateRootNavigationBlocks = function () {
        // The root page visually relocates nav controls into a hero layout while reusing the shared nav DOM.
        if (!document.body.classList.contains('root-page')) {
            return;
        }

        const controlsHost = document.querySelector('[data-root-controls-host]');
        const linksHost = document.querySelector('[data-root-nav-links-host]');
        const nav = document.querySelector('.ui-nav');
        if (!controlsHost || !linksHost || !nav) {
            return;
        }

        const navLinks = nav.querySelector('.ui-nav-links');
        const controlsStack = nav.querySelector('.ui-controls-stack');

        if (controlsStack && controlsStack.parentNode !== controlsHost) {
            controlsHost.appendChild(controlsStack);
        }

        if (navLinks && navLinks.parentNode !== linksHost) {
            linksHost.appendChild(navLinks);
        }
    };

    relocateRootNavigationBlocks();

    const wireRootLogoutAction = function () {
        // Root page account controls use their own DOM container, but mirror the same menu/logout modal pattern.
        const accountTrigger = document.querySelector('#ui-auth-account-root [data-auth-account-trigger]');
        const accountMenu = document.querySelector('#ui-auth-account-root [data-auth-account-menu]');
        const accountLogoutButton = document.querySelector('#ui-auth-account-root [data-auth-account-logout]');
        const logoutForm = document.getElementById('auth-logout-form-root');
        const logoutModal = document.getElementById('root-auth-logout-modal');
        const logoutModalBackdrop = document.getElementById('root-auth-logout-modal-backdrop');
        const logoutCancelButton = document.getElementById('root-auth-logout-cancel-btn');
        const logoutConfirmButton = document.getElementById('root-auth-logout-confirm-btn');
        const logoutMessage = document.getElementById('root-auth-logout-message');
        if (!accountTrigger || !logoutForm) {
            return;
        }

        let lastFocusedElement = null;

        const setAccountMenuOpen = function (opened) {
            // Menu open state is centralized so outside-click and Escape handling stay consistent.
            if (!accountMenu) {
                return;
            }
            accountMenu.hidden = !opened;
            accountTrigger.setAttribute('aria-expanded', opened ? 'true' : 'false');
        };

        const setLogoutModalOpen = function (opened) {
            // Closing restores focus to the element that launched the confirmation dialog.
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
            if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
                lastFocusedElement.focus();
            }
        };

        const requestLogout = function () {
            // Use the custom modal when present, otherwise fall back to a plain confirm dialog.
            const confirmMessage = String((accountLogoutButton && accountLogoutButton.getAttribute('data-confirm-message')) || '').trim();
            if (!logoutModal || !logoutModalBackdrop || !logoutCancelButton || !logoutConfirmButton || !logoutMessage) {
                if (confirmMessage && !window.confirm(confirmMessage)) {
                    return;
                }
                logoutForm.submit();
                return;
            }
            lastFocusedElement = document.activeElement;
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

        document.addEventListener('click', function (event) {
            if (!accountMenu || accountMenu.hidden) {
                return;
            }
            const target = event.target;
            if (accountMenu.contains(target) || accountTrigger.contains(target)) {
                return;
            }
            setAccountMenuOpen(false);
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
                logoutForm.submit();
            });
        }

        document.addEventListener('keydown', function (event) {
            if (event.key !== 'Escape') {
                return;
            }
            if (accountMenu && !accountMenu.hidden) {
                event.preventDefault();
                setAccountMenuOpen(false);
                return;
            }
            if (!logoutModal || logoutModal.hidden) {
                return;
            }
            event.preventDefault();
            setLogoutModalOpen(false);
        });
    };

    wireRootLogoutAction();

    const wireRootProfileImageUpload = function () {
        // Profile image upload is intentionally click-through: visible avatar button opens the hidden file input.
        const uploadForm = document.querySelector('[data-root-account-profile-upload-form]');
        const imageTrigger = document.querySelector('[data-root-account-profile-image-trigger]');
        const imageInput = document.querySelector('[data-root-account-profile-image-input]');
        if (!uploadForm || !imageTrigger || !imageInput) {
            return;
        }

        imageTrigger.addEventListener('click', function (event) {
            event.preventDefault();
            imageInput.click();
        });

        imageInput.addEventListener('change', function () {
            if (!imageInput.files || !imageInput.files.length) {
                return;
            }
            uploadForm.submit();
        });
    };

    wireRootProfileImageUpload();

    const ENGINE_URLS = {
        google: function (query) { return 'https://www.google.com/search?q=' + encodeURIComponent(query); },
        youtube: function (query) { return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query); },
        duckduckgo: function (query) { return 'https://duckduckgo.com/?q=' + encodeURIComponent(query); },
        bing: function (query) { return 'https://www.bing.com/search?q=' + encodeURIComponent(query); },
        naver: function (query) { return 'https://search.naver.com/search.naver?query=' + encodeURIComponent(query); },
        gpt: function (query) { return 'https://chatgpt.com/?q=' + encodeURIComponent(query); },
        claude: function (query) { return 'https://claude.ai/new?q=' + encodeURIComponent(query); },
        gemini: function (query) { return 'https://gemini.google.com/app?prompt=' + encodeURIComponent(query); }
    };

    const getCsrfToken = function () {
        // Root page PATCH helpers reuse the global csrf meta token instead of duplicating cookie parsing.
        const meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.getAttribute('content') : '';
    };

    const escapeHtml = function (value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    const readThemeCookie = function () {
        try {
            const match = document.cookie.match(/(?:^|;\s*)portfolio_theme_mode=([^;]+)/);
            if (match) {
                return decodeURIComponent(match[1]);
            }
        } catch (error) {}
        return '';
    };

    const writeThemeCookie = function (value) {
        try {
            const normalizedValue = encodeURIComponent(String(value || ''));
            const maxAge = value ? COOKIE_MAX_AGE_SECONDS : 0;
            const cookie = THEME_MODE_COOKIE_KEY + '=' + normalizedValue + '; path=/; max-age=' + maxAge + '; SameSite=Lax';
            document.cookie = cookie;

            const hostname = String(window.location.hostname || '').toLowerCase();
            if (hostname === 'hanplanet.com' || hostname.endsWith('.hanplanet.com')) {
                document.cookie = cookie + '; domain=.hanplanet.com';
            }
        } catch (error) {}
    };

    const readStoredThemeMode = function () {
        try {
            const stored = readThemeCookie() || window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
            if (stored === 'dark') {
                return true;
            }
            if (stored === 'light') {
                return false;
            }
        } catch (error) {}
        return null;
    };

    const readAccountThemeMode = function () {
        if (accountThemeMode === 'dark') {
            return true;
        }
        if (accountThemeMode === 'light') {
            return false;
        }
        return null;
    };

    const readSystemThemeMode = function () {
        if (!window.matchMedia) {
            return false;
        }
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    };

    const persistThemeModeLocal = function (isDark) {
        try {
            const mode = isDark ? 'dark' : 'light';
            window.localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
            writeThemeCookie(mode);
        } catch (error) {}
    };

    const persistThemeModeToAccount = function (isDark) {
        if (!isAuthenticatedUser || !themePreferenceUrl || !window.fetch) {
            return;
        }
        const csrfToken = getCsrfToken();
        if (!csrfToken) {
            return;
        }
        window.fetch(themePreferenceUrl, {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify({ mode: isDark ? 'dark' : 'light' })
        }).catch(function () {});
    };

    const syncThemeToggleState = function (isDark) {
        if (!themeToggleButtons.length) {
            return;
        }
        themeToggleButtons.forEach(function (button) {
            const isDarkButton = button.dataset.themeMode === 'dark';
            const isActive = isDarkButton === isDark;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    };

    const applyRootThemeMode = function (isDark) {
        document.body.classList.toggle('theme-dark', isDark);
        syncThemeToggleState(isDark);
    };

    const initRootThemeMode = function () {
        // Theme preference priority is: account setting -> local storage -> system preference.
        let currentThemeMode = readAccountThemeMode();
        let shouldPersistInitialThemeMode = currentThemeMode !== null;
        if (currentThemeMode === null) {
            currentThemeMode = readStoredThemeMode();
            shouldPersistInitialThemeMode = currentThemeMode !== null;
        }
        if (currentThemeMode === null) {
            currentThemeMode = readSystemThemeMode();
        }
        applyRootThemeMode(Boolean(currentThemeMode));
        if (shouldPersistInitialThemeMode) {
            persistThemeModeLocal(Boolean(currentThemeMode));
        }

        themeToggleButtons.forEach(function (button) {
            button.addEventListener('click', function (event) {
                event.preventDefault();
                const useDarkTheme = button.dataset.themeMode === 'dark';
                applyRootThemeMode(useDarkTheme);
                persistThemeModeLocal(useDarkTheme);
                persistThemeModeToAccount(useDarkTheme);
            });
        });
    };

    initRootThemeMode();

    const persistRootSearchEngineToAccount = function (engineValue) {
        // Store the selected engine server-side only for authenticated users; guests stay local-only.
        if (!isAuthenticatedUser || !userPreferenceUrl || !window.fetch) {
            return;
        }

        const normalized = engineValue in ENGINE_URLS ? engineValue : 'google';
        const csrfToken = getCsrfToken();
        if (!csrfToken) {
            return;
        }

        window.fetch(userPreferenceUrl, {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify({ root_search_engine: normalized })
        }).catch(function () {});
    };

    const hasScheme = function (text) {
        return /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(text);
    };

    const fullPlaceholder = input.getAttribute('placeholder') || '';
    const placeholderMeasure = document.createElement('span');
    Object.assign(placeholderMeasure.style, {
        position: 'fixed',
        left: '-99999px',
        top: '-99999px',
        visibility: 'hidden',
        whiteSpace: 'nowrap',
        pointerEvents: 'none'
    });
    document.body.appendChild(placeholderMeasure);

    const buildPlaceholderVariants = function (text) {
        // Generate progressively shorter placeholders so the search field can adapt to narrow viewports.
        const trimmed = String(text || '').trim();
        if (!trimmed) {
            return [''];
        }
        const words = trimmed.split(/\s+/).filter(Boolean);
        if (words.length <= 1) {
            return [trimmed, '...'];
        }

        const variants = [trimmed];
        for (let removeCount = 1; removeCount < words.length; removeCount += 1) {
            const visibleWords = words.slice(0, words.length - removeCount);
            variants.push(visibleWords.join(' ') + ' ...');
        }
        variants.push('...');
        return variants;
    };

    const placeholderVariants = buildPlaceholderVariants(fullPlaceholder);

    const getTextWidth = function (text) {
        const inputStyle = window.getComputedStyle(input);
        placeholderMeasure.style.font = inputStyle.font;
        placeholderMeasure.style.letterSpacing = inputStyle.letterSpacing;
        placeholderMeasure.style.fontSize = inputStyle.fontSize;
        placeholderMeasure.style.fontWeight = inputStyle.fontWeight;
        placeholderMeasure.textContent = text;
        return placeholderMeasure.getBoundingClientRect().width;
    };

    const updateAdaptivePlaceholder = function () {
        // Pick the longest placeholder variant that still fits inside the current input width.
        if (!placeholderVariants.length) {
            return;
        }
        const availableWidth = Math.max(0, input.clientWidth - 4);
        let applied = placeholderVariants[placeholderVariants.length - 1];

        for (let i = 0; i < placeholderVariants.length; i += 1) {
            const candidate = placeholderVariants[i];
            if (getTextWidth(candidate) <= availableWidth) {
                applied = candidate;
                break;
            }
        }

        input.setAttribute('placeholder', applied);
    };

    const looksLikeDomainOrIp = function (text) {
        if (/\s/.test(text)) {
            return false;
        }

        const value = text.toLowerCase();
        const hostPart = value.split('/')[0].split('?')[0].split('#')[0].split(':')[0];

        if (!hostPart) {
            return false;
        }

        if (hostPart === 'localhost') {
            return true;
        }

        if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostPart)) {
            return true;
        }

        if (hostPart.includes('.') && /^[a-z0-9.-]+$/.test(hostPart)) {
            return true;
        }

        return false;
    };

    const toNavigableUrl = function (rawText) {
        // Bare domains should navigate directly, while ordinary text should be sent to the chosen search engine.
        const text = rawText.trim();
        if (!text) {
            return null;
        }

        const candidate = hasScheme(text) ? text : 'https://' + text;
        try {
            const parsed = new URL(candidate);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                return parsed.toString();
            }
        } catch (error) {}
        return null;
    };

    const normalizeSuggestionText = function (value) {
        return String(value || '').trim().toLowerCase();
    };

    const readRootSearchHistory = function () {
        try {
            const parsed = JSON.parse(window.localStorage.getItem(ROOT_SEARCH_HISTORY_STORAGE_KEY) || '[]');
            if (!Array.isArray(parsed)) {
                return [];
            }
            return parsed
                .map(function (item) { return String(item || '').trim(); })
                .filter(Boolean)
                .slice(0, ROOT_SEARCH_HISTORY_LIMIT);
        } catch (error) {
            return [];
        }
    };

    const writeRootSearchHistory = function (items) {
        try {
            window.localStorage.setItem(
                ROOT_SEARCH_HISTORY_STORAGE_KEY,
                JSON.stringify(items.slice(0, ROOT_SEARCH_HISTORY_LIMIT))
            );
        } catch (error) {}
    };

    const rememberRootSearchQuery = function (query) {
        const value = String(query || '').trim();
        if (!value || value.length > 160 || hasScheme(value) || looksLikeDomainOrIp(value)) {
            return;
        }

        const valueKey = normalizeSuggestionText(value);
        const nextHistory = readRootSearchHistory().filter(function (item) {
            return normalizeSuggestionText(item) !== valueKey;
        });
        nextHistory.unshift(value);
        writeRootSearchHistory(nextHistory);
    };

    const removeRootSearchHistorySuggestion = function (index) {
        const item = renderedSearchSuggestions[index];
        if (!item || item.type !== 'history') {
            return;
        }
        const valueKey = normalizeSuggestionText(item.value || item.label);
        if (!valueKey) {
            return;
        }
        writeRootSearchHistory(readRootSearchHistory().filter(function (query) {
            return normalizeSuggestionText(query) !== valueKey;
        }));
        if (document.activeElement !== input && typeof input.focus === 'function') {
            input.focus();
        }
        renderSearchSuggestions(getRootSearchSuggestions());
    };

    const getSuggestionMetaFromUrl = function (rawUrl) {
        try {
            const parsed = new URL(rawUrl, window.location.origin);
            if (parsed.origin === window.location.origin) {
                return parsed.pathname;
            }
            return parsed.hostname;
        } catch (error) {
            return '';
        }
    };

    const collectRootNavSuggestions = function () {
        return Array.from(document.querySelectorAll('[data-root-nav-links-host] a[href]'))
            .map(function (link) {
                const label = String(link.textContent || '').replace(/\s+/g, ' ').trim();
                const href = link.href || link.getAttribute('href') || '';
                if (!label || !href) {
                    return null;
                }
                return {
                    type: 'link',
                    label: label,
                    value: label,
                    url: href,
                    meta: getSuggestionMetaFromUrl(href)
                };
            })
            .filter(Boolean);
    };

    const buildRootSearchSuggestionCandidates = function () {
        const historyItems = readRootSearchHistory().map(function (query) {
            return {
                type: 'history',
                label: query,
                value: query,
                url: '',
                meta: ''
            };
        });

        return historyItems.concat(collectRootNavSuggestions());
    };

    const suggestionMatchesQuery = function (item, query) {
        if (!query) {
            return true;
        }
        const haystack = normalizeSuggestionText([item.label, item.value, item.url, item.meta].join(' '));
        return haystack.indexOf(query) !== -1;
    };

    const getRootSearchSuggestions = function () {
        const query = normalizeSuggestionText(input.value);
        const suggestions = [];
        const seen = new Set();

        buildRootSearchSuggestionCandidates().forEach(function (item) {
            if (!suggestionMatchesQuery(item, query)) {
                return;
            }
            const key = item.url ? 'url:' + item.url : 'query:' + normalizeSuggestionText(item.value || item.label);
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            suggestions.push(item);
        });

        return suggestions.slice(0, ROOT_SEARCH_SUGGESTION_LIMIT);
    };

    const syncSearchSuggestionsGeometry = function () {
        if (!suggestionsPopup || suggestionsPopup.hidden) {
            return;
        }
        const rect = suggestionsPopup.getBoundingClientRect();
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        if (!viewportHeight) {
            return;
        }
        const bottomGap = window.matchMedia && window.matchMedia('(max-width: 720px)').matches ? 8 : 12;
        const maxHeight = Math.max(1, Math.floor(viewportHeight - rect.top - bottomGap));
        suggestionsPopup.style.setProperty('--root-search-suggestions-max-height', maxHeight + 'px');
    };

    const closeSearchSuggestions = function () {
        if (!suggestionsPopup) {
            return;
        }
        renderedSearchSuggestions = [];
        activeSearchSuggestionIndex = -1;
        suggestionsPopup.hidden = true;
        suggestionsPopup.classList.remove('is-open');
        suggestionsPopup.innerHTML = '';
        input.setAttribute('aria-expanded', 'false');
        input.setAttribute('aria-activedescendant', '');
    };

    const setActiveSearchSuggestion = function (index) {
        if (!suggestionsPopup || !renderedSearchSuggestions.length) {
            return;
        }
        const maxIndex = renderedSearchSuggestions.length - 1;
        if (index < 0) {
            activeSearchSuggestionIndex = maxIndex;
        } else if (index > maxIndex) {
            activeSearchSuggestionIndex = 0;
        } else {
            activeSearchSuggestionIndex = index;
        }

        suggestionsPopup.querySelectorAll('[data-root-search-suggestion-index]').forEach(function (option) {
            const optionIndex = Number(option.getAttribute('data-root-search-suggestion-index'));
            const isActive = optionIndex === activeSearchSuggestionIndex;
            option.classList.toggle('is-active', isActive);
            option.setAttribute('aria-selected', isActive ? 'true' : 'false');
            if (isActive) {
                input.setAttribute('aria-activedescendant', option.id || '');
            }
        });
    };

    const renderSearchSuggestions = function (items) {
        if (!suggestionsPopup) {
            return;
        }
        renderedSearchSuggestions = items.slice(0, ROOT_SEARCH_SUGGESTION_LIMIT);
        activeSearchSuggestionIndex = -1;
        if (!renderedSearchSuggestions.length) {
            closeSearchSuggestions();
            return;
        }

        suggestionsPopup.innerHTML = renderedSearchSuggestions.map(function (item, index) {
            const optionId = 'rootSearchSuggestionOption' + String(index);
            const safeLabel = escapeHtml(item.label || item.value || '');
            const safeMeta = escapeHtml(item.meta || '');
            const safeType = escapeHtml(item.type || 'history');
            const iconMarkup = item.iconUrl
                ? '<img class="root-search-suggestion-icon-img" src="' + escapeHtml(item.iconUrl) + '" alt="" loading="lazy">'
                : '';
            const metaMarkup = safeMeta
                ? '<span class="root-search-suggestion-meta">' + safeMeta + '</span>'
                : '';
            const removeMarkup = item.type === 'history'
                ? '<button type="button" class="root-search-suggestion-remove" aria-label="' + escapeHtml(searchHistoryDeleteLabel) + '" title="' + escapeHtml(searchHistoryDeleteLabel) + '" data-root-search-history-remove="' + String(index) + '"></button>'
                : '';
            return '' +
                '<div id="' + optionId + '" class="root-search-suggestion" role="option" aria-selected="false" data-root-search-suggestion-index="' + String(index) + '">' +
                    '<span class="root-search-suggestion-icon" data-suggestion-type="' + safeType + '" aria-hidden="true">' + iconMarkup + '</span>' +
                    '<span class="root-search-suggestion-copy">' +
                        '<span class="root-search-suggestion-label">' + safeLabel + '</span>' +
                        metaMarkup +
                    '</span>' +
                    removeMarkup +
                '</div>';
        }).join('');
        suggestionsPopup.hidden = false;
        suggestionsPopup.classList.add('is-open');
        syncSearchSuggestionsGeometry();
        input.setAttribute('aria-expanded', 'true');
        input.setAttribute('aria-activedescendant', '');
    };

    const updateSearchSuggestions = function () {
        if (!suggestionsPopup || document.activeElement !== input) {
            return;
        }
        renderSearchSuggestions(getRootSearchSuggestions());
    };

    const submitSearchForm = function () {
        if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
            return;
        }
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    };

    const applySearchSuggestion = function (index) {
        const item = renderedSearchSuggestions[index];
        if (!item) {
            return;
        }
        if (item.url) {
            window.location.href = item.url;
            return;
        }
        input.value = item.value || item.label || '';
        closeSearchSuggestions();
        submitSearchForm();
    };

    const refreshSearchSuggestions = function () {
        if (document.activeElement === input) {
            updateSearchSuggestions();
        }
    };

    if (suggestionsPopup) {
        input.addEventListener('input', updateSearchSuggestions);
        input.addEventListener('focus', updateSearchSuggestions);
        input.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                closeSearchSuggestions();
                return;
            }
            if (suggestionsPopup.hidden || !renderedSearchSuggestions.length) {
                return;
            }
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveSearchSuggestion(activeSearchSuggestionIndex + 1);
                return;
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveSearchSuggestion(activeSearchSuggestionIndex - 1);
                return;
            }
            if (event.key === 'Enter' && activeSearchSuggestionIndex >= 0) {
                event.preventDefault();
                applySearchSuggestion(activeSearchSuggestionIndex);
            }
        });

        suggestionsPopup.addEventListener('mousedown', function (event) {
            if (event.target.closest('[data-root-search-suggestion-index]')) {
                event.preventDefault();
            }
        });

        suggestionsPopup.addEventListener('click', function (event) {
            const removeButton = event.target.closest('[data-root-search-history-remove]');
            if (removeButton) {
                event.preventDefault();
                event.stopPropagation();
                removeRootSearchHistorySuggestion(Number(removeButton.getAttribute('data-root-search-history-remove')));
                return;
            }
            const option = event.target.closest('[data-root-search-suggestion-index]');
            if (!option) {
                return;
            }
            event.preventDefault();
            applySearchSuggestion(Number(option.getAttribute('data-root-search-suggestion-index')));
        });
    }

    const closeEngineMenu = function () {
        // Engine popup state is tracked only through DOM classes/aria, so teardown stays stateless.
        enginePicker.classList.remove('is-open');
        enginePicker.removeAttribute('data-open');
        engineToggle.setAttribute('aria-expanded', 'false');
        enginePopup.classList.remove('is-open');
        enginePopup.setAttribute('aria-hidden', 'true');
    };

    const positionPopup = function () {
        // Popup is positioned against the toggle button and clamped to the viewport edges.
        const toggleRect = engineToggle.getBoundingClientRect();
        const popupWidth = Math.max(172, toggleRect.width);
        enginePopup.style.width = popupWidth + 'px';
        let left = Math.round(toggleRect.left);
        const maxLeft = window.innerWidth - popupWidth - 8;
        if (left > maxLeft) {
            left = maxLeft;
        }
        if (left < 8) {
            left = 8;
        }
        enginePopup.style.left = left + 'px';
        enginePopup.style.top = Math.round(toggleRect.bottom + 8) + 'px';
    };

    const openEngineMenu = function () {
        positionPopup();
        enginePicker.classList.add('is-open');
        enginePicker.setAttribute('data-open', '1');
        engineToggle.setAttribute('aria-expanded', 'true');
        enginePopup.classList.add('is-open');
        enginePopup.setAttribute('aria-hidden', 'false');
    };

    const syncEngineUI = function (value) {
        // One helper keeps the hidden select, visible label, icon, and active option states synchronized.
        const targetValue = value in ENGINE_URLS ? value : 'google';
        engineSelect.value = targetValue;
        enginePicker.dataset.engine = targetValue;
        engineIcon.dataset.engine = targetValue;

        engineOptions.forEach(function (option) {
            const isActive = option.dataset.engineValue === targetValue;
            option.classList.toggle('is-active', isActive);
            if (isActive) {
                engineLabel.textContent = option.textContent.trim();
            }
        });
    };

    engineToggle.addEventListener('click', function (event) {
        event.preventDefault();
        closeSearchSuggestions();
        if (enginePopup.classList.contains('is-open')) {
            closeEngineMenu();
            return;
        }
        openEngineMenu();
    });

    engineOptions.forEach(function (option) {
        option.addEventListener('click', function () {
            const nextEngine = option.dataset.engineValue || 'google';
            syncEngineUI(nextEngine);
            persistRootSearchEngineToAccount(nextEngine);
            closeEngineMenu();
        });
    });

    document.addEventListener('click', function (event) {
        if (suggestionsPopup && !form.contains(event.target)) {
            closeSearchSuggestions();
        }
        if (!enginePicker.contains(event.target) && !enginePopup.contains(event.target)) {
            closeEngineMenu();
        }
    });

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            closeEngineMenu();
        }
    });

    window.addEventListener('resize', function () {
        updateAdaptivePlaceholder();
        syncSearchSuggestionsGeometry();
        if (enginePopup.classList.contains('is-open')) {
            positionPopup();
        }
    });

    window.addEventListener('scroll', function () {
        syncSearchSuggestionsGeometry();
        if (enginePopup.classList.contains('is-open')) {
            positionPopup();
        }
    }, { passive: true });

    syncEngineUI(engineSelect.value || 'google');
    updateAdaptivePlaceholder();

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () {
            updateAdaptivePlaceholder();
        }).catch(function () {});
    }

    form.addEventListener('submit', function (event) {
        event.preventDefault();
        const raw = input.value.trim();
        closeSearchSuggestions();
        if (!raw) {
            input.focus();
            return;
        }

        if (hasScheme(raw) || looksLikeDomainOrIp(raw)) {
            const targetUrl = toNavigableUrl(raw);
            if (targetUrl) {
                window.location.href = targetUrl;
                return;
            }
        }

        const engine = engineSelect.value in ENGINE_URLS ? engineSelect.value : 'google';
        rememberRootSearchQuery(raw);
        window.location.href = ENGINE_URLS[engine](raw);
    });

    const shortcutsRoot = document.querySelector('[data-root-shortcuts]');
    if (!shortcutsRoot) {
        return;
    }

    const shortcutsGrid = shortcutsRoot.querySelector('[data-root-shortcuts-grid]');
    const shortcutForm = shortcutsRoot.querySelector('[data-root-shortcut-form]');
    const shortcutNameInput = shortcutsRoot.querySelector('[data-root-shortcut-name]');
    const shortcutUrlInput = shortcutsRoot.querySelector('[data-root-shortcut-url]');
    const shortcutSubmitButton = shortcutForm ? shortcutForm.querySelector('.root-shortcuts-submit') : null;
    const shortcutsHint = shortcutsRoot.querySelector('[data-root-shortcuts-hint]');
    const shortcutMenu = document.querySelector('[data-root-shortcut-menu]');
    const shortcutMenuEdit = shortcutMenu ? shortcutMenu.querySelector('[data-shortcut-menu-edit]') : null;

    if (!shortcutsGrid || !shortcutsHint) {
        return;
    }

    const isAuthenticated = shortcutsRoot.dataset.authenticated === '1';
    const loginHint = shortcutsRoot.dataset.loginHint || '';
    const emptyMessage = shortcutsRoot.dataset.emptyMessage || '';
    const addLabel = shortcutsRoot.dataset.addLabel || 'Add';
    const editLabel = shortcutsRoot.dataset.editLabel || 'Edit';
    const saveLabel = shortcutSubmitButton ? String(shortcutSubmitButton.textContent || '').trim() : 'Save';
    const apiBase = '/api/root-shortcuts/';
    const reorderApiUrl = apiBase + 'reorder/';
    let draggingCard = null;
    let dragChanged = false;
    let editingShortcutId = null;
    let contextTargetShortcutId = null;

    const selectServerMessage = function (payload, fallback) {
        if (!payload || typeof payload !== 'object') {
            return fallback || '';
        }
        const lang = (document.documentElement.getAttribute('lang') || '').toLowerCase().indexOf('en') === 0 ? 'en' : 'ko';
        const messages = payload.error_messages || payload.messages;
        if (messages && typeof messages === 'object') {
            return messages[lang] || messages.ko || messages.en || fallback || '';
        }
        return payload.error_message || payload.message || payload.error || fallback || '';
    };

    const readShortcutJson = async function (response, fallback) {
        const payload = await response.json().catch(function () {
            return {};
        });
        if (!response.ok) {
            throw new Error(selectServerMessage(payload, fallback));
        }
        return payload;
    };

    const buildAddCardMarkup = function () {
        // The add-card is rendered as part of the shortcut grid so drag layout stays consistent.
        if (!isAuthenticated) {
            return '';
        }
        return '' +
            '<button type="button" class="root-shortcuts-item root-shortcuts-item-add" data-shortcut-add-card aria-label="' + escapeHtml(addLabel) + '">' +
                '<span class="root-shortcuts-plus-icon" aria-hidden="true">+</span>' +
            '</button>';
    };

    const hideShortcutMenu = function () {
        // Context menu is pure DOM state; hiding also clears the current shortcut target id.
        if (!shortcutMenu) {
            return;
        }
        shortcutMenu.hidden = true;
        shortcutMenu.style.left = '';
        shortcutMenu.style.top = '';
        contextTargetShortcutId = null;
    };

    const openShortcutMenu = function (x, y, shortcutId) {
        // Open the shortcut context menu at pointer coordinates while keeping it inside the viewport.
        if (!shortcutMenu) {
            return;
        }
        contextTargetShortcutId = shortcutId;
        shortcutMenu.hidden = false;

        const rect = shortcutMenu.getBoundingClientRect();
        let left = x;
        let top = y;
        const maxLeft = window.innerWidth - rect.width - 8;
        const maxTop = window.innerHeight - rect.height - 8;
        if (left > maxLeft) {
            left = maxLeft;
        }
        if (top > maxTop) {
            top = maxTop;
        }
        if (left < 8) {
            left = 8;
        }
        if (top < 8) {
            top = 8;
        }
        shortcutMenu.style.left = left + 'px';
        shortcutMenu.style.top = top + 'px';
    };

    const enterEditMode = function (shortcutId) {
        // Reuse the create form for edits by hydrating the selected shortcut into the same inputs.
        if (!shortcutForm || !shortcutNameInput || !shortcutUrlInput) {
            return;
        }
        const target = currentShortcutItems.find(function (item) {
            return Number(item.id) === Number(shortcutId);
        });
        if (!target) {
            return;
        }
        editingShortcutId = Number(target.id);
        shortcutForm.hidden = false;
        shortcutNameInput.value = target.name || '';
        shortcutUrlInput.value = target.url || '';
        if (shortcutSubmitButton) {
            shortcutSubmitButton.textContent = editLabel;
        }
        shortcutNameInput.focus();
        shortcutNameInput.select();
    };

    const resetEditMode = function () {
        // Reset the form back to "create" semantics after a save/cancel cycle.
        editingShortcutId = null;
        if (shortcutSubmitButton) {
            shortcutSubmitButton.textContent = saveLabel || 'Save';
        }
    };

    const getOrderedIdsFromDom = function () {
        // Drag-and-drop reorder persists the DOM order rather than maintaining a second ordering array.
        return Array.from(shortcutsGrid.querySelectorAll('.root-shortcuts-card[data-shortcut-id]'))
            .map(function (card) {
                return Number(card.getAttribute('data-shortcut-id'));
            })
            .filter(function (value) {
                return Number.isFinite(value) && value > 0;
            });
    };

    const captureCardRects = function () {
        // FLIP animation snapshots each card's pre-move rect before the DOM order changes.
        const rects = new Map();
        shortcutsGrid.querySelectorAll('.root-shortcuts-card[data-shortcut-id]').forEach(function (card) {
            const id = card.getAttribute('data-shortcut-id');
            if (!id) {
                return;
            }
            rects.set(id, card.getBoundingClientRect());
        });
        return rects;
    };

    const animateGridFlip = function (beforeRects) {
        // After DOM reorder, animate cards from their previous rects into their new positions.
        shortcutsGrid.querySelectorAll('.root-shortcuts-card[data-shortcut-id]').forEach(function (card) {
            const id = card.getAttribute('data-shortcut-id');
            const before = beforeRects.get(id);
            if (!before) {
                return;
            }
            const after = card.getBoundingClientRect();
            const dx = before.left - after.left;
            const dy = before.top - after.top;
            if (!dx && !dy) {
                return;
            }
            card.style.transition = 'none';
            card.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
            window.requestAnimationFrame(function () {
                card.style.transition = 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)';
                card.style.transform = '';
            });
            card.addEventListener('transitionend', function clearFlip() {
                card.style.transition = '';
                card.removeEventListener('transitionend', clearFlip);
            });
        });
    };

    const reorderShortcuts = async function (orderedIds) {
        const response = await fetch(reorderApiUrl, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({ ordered_ids: orderedIds })
        });
        await readShortcutJson(response, 'Failed to reorder shortcuts');
    };

    const renderShortcuts = function (items) {
        currentShortcutItems = Array.isArray(items) ? items.slice() : [];
        const cards = items.map(function (item) {
            const safeName = escapeHtml(item.name);
            const safeUrl = escapeHtml(item.url);
            const iconMarkup = item.icon_url
                ? '<img class="root-shortcuts-icon-img" src="' + escapeHtml(item.icon_url) + '" alt="" loading="lazy">'
                : '<span class="root-shortcuts-icon-fallback">' + safeName.slice(0, 1).toUpperCase() + '</span>';

            const removeBtn = isAuthenticated
                ? '<button type="button" class="root-shortcuts-remove" data-shortcut-remove="' + String(item.id) + '" aria-label="Remove">×</button>'
                : '';

            return '' +
                '<a class="root-shortcuts-item" href="' + safeUrl + '">' +
                    '<span class="root-shortcuts-icon">' + iconMarkup + '</span>' +
                    '<span class="root-shortcuts-name">' + safeName + '</span>' +
                '</a>' +
                removeBtn;
        });

        shortcutsGrid.innerHTML = cards.map(function (card) {
            return card;
        }).map(function (card, index) {
            const item = items[index];
            const idValue = Number(item && item.id);
            const dataId = Number.isFinite(idValue) && idValue > 0 ? String(idValue) : '';
            const draggableAttr = isAuthenticated && dataId ? ' draggable="true"' : '';
            return '<div class="root-shortcuts-card" data-shortcut-id="' + dataId + '"' + draggableAttr + '>' + card + '</div>';
        }).join('');

        if (isAuthenticated) {
            shortcutsGrid.insertAdjacentHTML('beforeend', '<div class="root-shortcuts-card root-shortcuts-card-add">' + buildAddCardMarkup() + '</div>');
        } else if (!items.length) {
            shortcutsGrid.innerHTML = '<p class="root-shortcuts-empty">' + escapeHtml(emptyMessage) + '</p>';
        }
        refreshSearchSuggestions();
    };

    const fetchShortcuts = async function () {
        if (!isAuthenticated) {
            shortcutsHint.textContent = loginHint;
            shortcutsGrid.innerHTML = '';
            return;
        }

        shortcutsHint.textContent = '';
        try {
            const response = await fetch(apiBase, {
                method: 'GET',
                credentials: 'same-origin',
                headers: { 'Accept': 'application/json' }
            });
            const payload = await readShortcutJson(response, 'Failed to load shortcuts');
            renderShortcuts(Array.isArray(payload.items) ? payload.items : []);
        } catch (error) {
            shortcutsGrid.innerHTML = '<p class="root-shortcuts-empty">' + escapeHtml(error && error.message ? error.message : 'Failed to load.') + '</p>';
        }
    };

    const createShortcut = async function (name, url) {
        const response = await fetch(apiBase, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({ name: name, url: url })
        });

        await readShortcutJson(response, 'Failed to create shortcut');
    };

    const updateShortcut = async function (shortcutId, name, url) {
        const response = await fetch(apiBase + String(shortcutId) + '/', {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({ name: name, url: url })
        });
        await readShortcutJson(response, 'Failed to update shortcut');
    };

    const removeShortcut = async function (shortcutId) {
        const response = await fetch(apiBase + String(shortcutId) + '/', {
            method: 'DELETE',
            credentials: 'same-origin',
            headers: {
                'Accept': 'application/json',
                'X-CSRFToken': getCsrfToken()
            }
        });

        await readShortcutJson(response, 'Failed to remove shortcut');
    };

    if (shortcutNameInput) {
        shortcutNameInput.placeholder = shortcutsRoot.dataset.namePlaceholder || 'Name (optional)';
    }
    if (shortcutUrlInput) {
        shortcutUrlInput.placeholder = shortcutsRoot.dataset.urlPlaceholder || 'https://example.com';
    }

    if (shortcutForm && shortcutNameInput && shortcutUrlInput) {
        shortcutForm.addEventListener('submit', async function (event) {
            event.preventDefault();
            const name = shortcutNameInput.value.trim();
            const url = shortcutUrlInput.value.trim();
            if (!url) {
                return;
            }

            try {
                if (editingShortcutId) {
                    await updateShortcut(editingShortcutId, name, url);
                } else {
                    await createShortcut(name, url);
                }
                shortcutForm.reset();
                shortcutForm.hidden = true;
                resetEditMode();
                await fetchShortcuts();
            } catch (error) {
                shortcutsHint.textContent = error && error.message ? error.message : '';
            }
        });
    }

    shortcutsGrid.addEventListener('click', async function (event) {
        hideShortcutMenu();
        const addCardTarget = event.target.closest('[data-shortcut-add-card]');
        if (addCardTarget && shortcutForm) {
            event.preventDefault();
            if (editingShortcutId) {
                resetEditMode();
                shortcutForm.reset();
                shortcutForm.hidden = false;
                if (shortcutNameInput) {
                    shortcutNameInput.focus();
                }
                return;
            }

            shortcutForm.hidden = !shortcutForm.hidden;
            if (!shortcutForm.hidden) {
                shortcutForm.reset();
                if (shortcutNameInput) {
                    shortcutNameInput.focus();
                }
            }
            return;
        }

        const removeTarget = event.target.closest('[data-shortcut-remove]');
        if (!removeTarget) {
            return;
        }
        event.preventDefault();
        const shortcutId = removeTarget.getAttribute('data-shortcut-remove');
        if (!shortcutId) {
            return;
        }

        try {
            await removeShortcut(shortcutId);
            if (editingShortcutId && Number(editingShortcutId) === Number(shortcutId)) {
                if (shortcutForm) {
                    shortcutForm.hidden = true;
                    shortcutForm.reset();
                }
                resetEditMode();
            }
            await fetchShortcuts();
        } catch (error) {
            shortcutsHint.textContent = error && error.message ? error.message : '';
        }
    });

    shortcutsGrid.addEventListener('contextmenu', function (event) {
        if (!isAuthenticated) {
            return;
        }
        const card = event.target.closest('.root-shortcuts-card[data-shortcut-id]');
        if (!card) {
            return;
        }
        event.preventDefault();
        const shortcutId = card.getAttribute('data-shortcut-id');
        if (!shortcutId) {
            return;
        }
        openShortcutMenu(event.clientX, event.clientY, shortcutId);
    });

    if (shortcutMenuEdit) {
        shortcutMenuEdit.addEventListener('click', function (event) {
            event.preventDefault();
            if (contextTargetShortcutId) {
                enterEditMode(contextTargetShortcutId);
            }
            hideShortcutMenu();
        });
    }

    document.addEventListener('click', function (event) {
        if (!shortcutMenu || shortcutMenu.hidden) {
            return;
        }
        if (!shortcutMenu.contains(event.target)) {
            hideShortcutMenu();
        }
    });

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            hideShortcutMenu();
        }
    });

    shortcutsGrid.addEventListener('dragstart', function (event) {
        if (!isAuthenticated) {
            return;
        }
        const card = event.target.closest('.root-shortcuts-card[data-shortcut-id]');
        if (!card) {
            return;
        }
        draggingCard = card;
        dragChanged = false;
        card.classList.add('is-dragging');
        shortcutsGrid.classList.add('is-sorting');
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', card.getAttribute('data-shortcut-id') || '');
            const rect = card.getBoundingClientRect();
            const offsetX = Math.max(0, Math.min(rect.width - 1, event.clientX - rect.left));
            const offsetY = Math.max(0, Math.min(rect.height - 1, event.clientY - rect.top));
            event.dataTransfer.setDragImage(card, offsetX, offsetY);
        }
    });

    shortcutsGrid.addEventListener('dragover', function (event) {
        if (!draggingCard || !isAuthenticated) {
            return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }

        const targetCard = event.target.closest('.root-shortcuts-card[data-shortcut-id]');
        if (!targetCard || targetCard === draggingCard) {
            return;
        }

        const beforeRects = captureCardRects();
        const targetRect = targetCard.getBoundingClientRect();
        const afterTarget = event.clientY > (targetRect.top + targetRect.height / 2);
        const referenceNode = afterTarget ? targetCard.nextSibling : targetCard;

        if (referenceNode === draggingCard || draggingCard.nextSibling === referenceNode) {
            return;
        }

        shortcutsGrid.insertBefore(draggingCard, referenceNode);
        animateGridFlip(beforeRects);
        dragChanged = true;
    });

    shortcutsGrid.addEventListener('drop', function (event) {
        if (!draggingCard || !isAuthenticated) {
            return;
        }
        event.preventDefault();
    });

    shortcutsGrid.addEventListener('dragend', async function () {
        if (!draggingCard) {
            return;
        }
        const droppedCard = draggingCard;
        draggingCard.classList.remove('is-dragging');
        draggingCard = null;
        shortcutsGrid.classList.remove('is-sorting');

        if (!dragChanged) {
            return;
        }

        const orderedIds = getOrderedIdsFromDom();
        try {
            await reorderShortcuts(orderedIds);
        } catch (error) {
            await fetchShortcuts();
        } finally {
            droppedCard.classList.remove('is-dragging');
        }
    });

    window.addEventListener('scroll', hideShortcutMenu, { passive: true });
    window.addEventListener('resize', hideShortcutMenu, { passive: true });

    fetchShortcuts();
})();
