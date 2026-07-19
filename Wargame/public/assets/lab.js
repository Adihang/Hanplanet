(() => {
    'use strict';

    document.querySelectorAll('form[data-loading-form]').forEach((form) => {
        form.addEventListener('submit', () => {
            const button = form.querySelector('button[type="submit"]');
            if (!(button instanceof HTMLButtonElement)) return;
            button.disabled = true;
            button.classList.add('is-loading');
            button.textContent = button.dataset.loadingLabel || '처리 중…';
        });
    });

    document.querySelectorAll('input[type="file"][data-file-input]').forEach((input) => {
        input.addEventListener('change', () => {
            const label = document.querySelector(input.dataset.fileLabel || '');
            if (label) label.textContent = input.files?.[0]?.name || '선택된 파일 없음';
        });
    });

    window.render_game_to_text = () => JSON.stringify({
        path: window.location.pathname,
        title: document.title,
        text: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 4000),
    });
    window.advanceTime = () => {};
})();
