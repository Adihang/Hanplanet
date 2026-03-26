(function () {
  function isKorean() {
    var lang = (document.documentElement && document.documentElement.lang) || '';
    return /^ko(?:-|$)/i.test(lang);
  }

  function t(key, fallbackEn, fallbackKo) {
    if (window.config && window.config.i18n && window.config.i18n[key]) {
      return window.config.i18n[key];
    }
    return isKorean() ? fallbackKo : fallbackEn;
  }

  function getCsrfToken() {
    if (window.config && window.config.csrfToken) return window.config.csrfToken;
    var meta = document.querySelector('meta[name="_csrf"], meta[name=csrf-token]');
    return meta ? meta.getAttribute('content') : '';
  }

  function getHanplanetBaseUrl() {
    var host = window.location.hostname || '';
    if (host === 'git.hanplanet.com') {
      return 'https://www.hanplanet.com';
    }
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://127.0.0.1:8000';
    }
    return 'https://www.hanplanet.com';
  }

  function buildLogoutBridgeUrl() {
    var htmlLang = (document.documentElement && document.documentElement.lang) || '';
    var lang = /^en(?:-|$)/i.test(htmlLang) ? 'en' : 'ko';
    var bridge = getHanplanetBaseUrl() + '/' + lang + '/logout/bridge/';
    return bridge + '?next=' + encodeURIComponent(window.location.href);
  }

  function interceptForgejoLogoutNavigation(event) {
    event.preventDefault();
    window.location.assign(buildLogoutBridgeUrl());
  }

  async function submitLinkAction(button) {
    var url = button.getAttribute('data-url');
    if (!url) return;

    button.disabled = true;
    try {
      var csrf = getCsrfToken();
      var body = new URLSearchParams();
      if (csrf) body.set('_csrf', csrf);

      var response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-CSRF-Token': csrf,
        },
        body: body.toString(),
      });

      var payload = null;
      try {
        payload = await response.json();
      } catch (e) {
        payload = null;
      }

      if (!response.ok) {
        throw new Error((payload && (payload.error || payload.message)) || ('HTTP ' + response.status));
      }

      if (payload && payload.redirect) {
        window.location.assign(payload.redirect);
        return;
      }

      window.location.reload();
    } catch (err) {
      button.disabled = false;
      window.alert(t('error_occurred', 'An error occurred', '오류가 발생했습니다.'));
      console.error('link-action failed:', err);
    }
  }

  function showModalConfirm(button, modalSelector) {
    var modal = document.querySelector(modalSelector);
    if (!modal) return submitLinkAction(button);

    var content = modal.querySelector('.content');
    var text = content ? content.textContent.trim() : '';
    if (!text) {
      text = t(
        'remove_label_str',
        'Are you sure you want to continue?',
        '정말 계속하시겠습니까?'
      );
    }
    if (!text || window.confirm(text)) {
      submitLinkAction(button);
    }
  }

  document.addEventListener('click', function (event) {
    var logoutLink = event.target.closest('a[href], button[data-url]');
    if (logoutLink) {
      var href = logoutLink.getAttribute('href') || logoutLink.getAttribute('data-url') || '';
      if (/\/user\/logout\/?$/.test(href)) {
        interceptForgejoLogoutNavigation(event);
        return;
      }
    }

    var button = event.target.closest('.link-action[data-url]');
    if (!button) return;

    var modalSelector = button.getAttribute('data-modal-confirm');
    if (!modalSelector) return;

    event.preventDefault();
    showModalConfirm(button, modalSelector);
  });

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || !form.getAttribute) return;
    var action = form.getAttribute('action') || '';
    if (!/\/user\/logout\/?$/.test(action)) return;
    interceptForgejoLogoutNavigation(event);
  }, true);
})();
