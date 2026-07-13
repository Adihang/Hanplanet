(() => {
    'use strict';

    try {
        const theme = window.localStorage.getItem('wargame-theme');
        if (theme === 'light' || theme === 'dark') {
            document.documentElement.dataset.theme = theme;
        }
    } catch (_) {
        // Keep the server-rendered dark theme when storage is unavailable.
    }
})();
