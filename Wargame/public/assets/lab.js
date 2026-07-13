(() => {
    'use strict';

    document.querySelectorAll('form[data-loading-form]').forEach((form) => {
        form.addEventListener('submit', () => {
            const button = form.querySelector('button[type="submit"]');
            if (!button) return;
            button.classList.add('is-loading');
            button.setAttribute('aria-busy', 'true');
            button.textContent = button.dataset.loadingLabel || '처리 중…';
        });
    });

    const eventOutput = document.querySelector('[data-xss-event]');
    if (eventOutput) {
        window.addEventListener('message', (event) => {
            if (!event.data || event.data.source !== 'field-ops-xss') return;
            eventOutput.classList.add('success');
            eventOutput.textContent = `sandbox postMessage: lab.report(${JSON.stringify(event.data.value)})`;
        });
    }

    const editor = document.getElementById('request_json');
    if (editor) {
        editor.addEventListener('keydown', (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                editor.form?.requestSubmit();
            }
        });
    }
})();
