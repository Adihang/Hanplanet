Original prompt: 두 게임 모두 로딩 아이콘 이미지 로드가 안도ㅔ

- Investigating shared multiplayer loading overlay asset paths for both `bumpercar-spiky` and `raise-speaki`.
- Found shared include `templates/popup/fun/multiplayer_loading_spinner.html` referencing missing asset `Spikip/speaki_default/icon/acceleration.png`.
- Plan: switch spinner icon to an existing static asset, run `collectstatic`, and validate in browser.
- Updated shared loading spinner to use existing asset `Spikip/speaki_default/icon/main.png`.
- Restarted gunicorn so the updated template is served.
- Verified both game pages no longer emit `404` console errors during the loading/start flow via Playwright captures.
- Added `raise-speaki` double-unit special on `C`: when only one unit remains and that unit has level/health >= 2, it revives the dead partner by splitting current level and health with floor-to-revived, ceil-to-survivor.
- Added `special` input through client -> websocket -> world input pipeline.
- Server-side simulation verified revive split example `Lv5 HP5 -> Lv3 HP3 + Lv2 HP2`.
- Playwright client run completed against `https://hanplanet.com/ko/fun/raise-speaki/`, but external page was still under long loading overlay for interactive click testing; screenshot captured only the blank canvas background, so special-skill end-to-end browser verification remains pending.
