//go:build windows

package main

import (
	"html/template"
	"io"
)

type siteShellData struct {
	Title        string
	Username     string
	AvatarLetter string
	ContentHTML  template.HTML
}

var siteShellTmpl = template.Must(template.New("site-shell").Parse(`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{.Title}}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&family=Noto+Sans+KR:wght@100..900&display=swap" rel="stylesheet">
<link rel="icon" type="image/png" sizes="180x180" href="https://www.hanplanet.com/static/icons/pwa-180.png">
<link rel="apple-touch-icon" sizes="180x180" href="https://www.hanplanet.com/static/icons/pwa-180.png">
<link rel="stylesheet" type="text/css" href="https://www.hanplanet.com/static/css/vendor/bootstrap.min.css">
<link rel="stylesheet" type="text/css" href="https://www.hanplanet.com/static/css/common/layout.css">
<link rel="stylesheet" type="text/css" href="https://www.hanplanet.com/static/css/common/account_widget.css">
<link rel="stylesheet" type="text/css" href="https://www.hanplanet.com/static/css/common/style.css">
<link rel="stylesheet" type="text/css" href="https://www.hanplanet.com/static/css/common/popup_common.css">
<script src="https://www.hanplanet.com/static/js/common/popup_common.js" defer></script>
<script src="https://www.hanplanet.com/static/js/common/site_nav_responsive_manager.js" defer></script>
<script src="https://www.hanplanet.com/static/js/common/site.js" defer></script>
<script src="https://www.hanplanet.com/static/js/vendor/bootstrap.min.js" defer></script>
<style>
body.client-shell-page{min-height:100vh;background:#eef2f7}
.client-shell-main{max-width:1120px;margin:0 auto;padding:110px 16px 48px}
.client-shell-content{display:flex;justify-content:center}
.client-shell-card-wrap{width:100%;display:flex;justify-content:center}
.client-shell-footer-wrap{padding:8px 0 28px}
@media (max-width: 768px){
  .client-shell-main{padding-top:96px}
}
</style>
</head>
<body class="page client-shell-page" data-authenticated="1">
  <nav class="navbar ui-nav">
    <div class="container-fluid">
      <div class="ui-brand-group">
        <a class="navbar-brand ui-brand" href="https://www.hanplanet.com/">
          <span class="ui-brand-text">Hanplanet</span>
        </a>
      </div>
      <button class="navbar-toggler ui-nav-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarSupportedContent" aria-controls="navbarSupportedContent" aria-expanded="false" aria-label="Toggle navigation">
        <span class="navbar-toggler-icon"></span>
      </button>
      <div class="collapse ui-nav-collapse" id="navbarSupportedContent">
        <ul class="ui-nav-links">
          <li class="nav-item"><a class="nav-link ui-nav-link" href="https://www.hanplanet.com/portfolio/">Portfolio</a></li>
          <li class="nav-item"><a class="nav-link ui-nav-link" href="https://www.hanplanet.com/handrive">HanDrive</a></li>
          <li class="nav-item"><a class="nav-link ui-nav-link" href="https://www.hanplanet.com/fun/bumpercar-spiky/">Fun</a></li>
        </ul>
        <button type="button" class="ui-pwa-install-btn" data-pwa-install aria-label="Install app" title="Install app">
          <span class="ui-pwa-install-icon" aria-hidden="true"></span>
        </button>
        <div class="ui-controls-stack">
          <div class="ui-lang-toggle ui-control-toggle ui-lang-toggle-inline" aria-label="Language Toggle">
            <a class="ui-lang-link ui-control-link is-active" href="#">KO</a>
            <span class="ui-lang-divider">|</span>
            <a class="ui-lang-link ui-control-link" href="#">EN</a>
          </div>
          <div class="ui-lang-toggle ui-control-toggle ui-theme-toggle" aria-label="Theme Toggle">
            <a href="#" role="button" class="ui-lang-link ui-control-link is-active" data-theme-mode="light">LT</a>
            <span class="ui-lang-divider">|</span>
            <a href="#" role="button" class="ui-lang-link ui-control-link" data-theme-mode="dark">DK</a>
          </div>
        </div>
      </div>
    </div>
  </nav>

  <main class="client-shell-main">
    <div class="client-shell-content">
      <div class="client-shell-card-wrap">{{.ContentHTML}}</div>
    </div>
  </main>

  <div class="client-shell-footer-wrap">
    <footer class="site-footer-links" aria-label="Legal links">
      <a class="site-footer-link" href="https://www.hanplanet.com/privacy">Privacy Policy</a>
      <span class="site-footer-sep">/</span>
      <a class="site-footer-link" href="https://www.hanplanet.com/terms">Terms of Service</a>
    </footer>
  </div>

  <script>
  (function () {
    document.querySelectorAll(".site-footer-links .site-footer-link").forEach(function (link) {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        window.open(link.href, "_blank", "popup,width=900,height=700,scrollbars=yes,resizable=yes,toolbar=no,menubar=no,location=no,status=no");
      });
    });
  })();
  </script>
</body>
</html>`))

func renderSiteShell(w io.Writer, title, username string, contentHTML template.HTML) error {
	avatarLetter := "H"
	if username != "" {
		avatarLetter = template.HTMLEscapeString(string([]rune(username)[0]))
	}
	return siteShellTmpl.Execute(w, siteShellData{
		Title:        title,
		Username:     username,
		AvatarLetter: avatarLetter,
		ContentHTML:  contentHTML,
	})
}
