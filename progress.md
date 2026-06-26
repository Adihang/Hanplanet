Original prompt: 스핔이 게임들 캐릭터마다 새로 소리낼때 이전에 재생되던 소리는 끊기게 해줘
그리고 그건 캐릭터마다 따로 적용되도록
소리는 방향에 따라 2 채널 지원하도록

## Progress

- Started investigation for Speaki game audio behavior across Bumpercar Spiky and Raise Speaki clients.
- Updated both multiplayer clients to stop the current per-character sound before playing the next one, and to route remote character sounds through Web Audio stereo panning by listener/emitter direction.
- Verified both updated clients with `node --check`, `manage.py check`, `collectstatic`, and the web game Playwright smoke test for `/ko/sub/bumpercar-spiky/` and `/ko/sub/raise-speaki/`.
- Added per-sound-list random selection memory so folder-backed SFX avoid repeating the same URL consecutively when two or more files are available.
- Re-ran `node --check`, `manage.py check`, `collectstatic`, gunicorn restart, URL health checks, and Playwright smoke tests for both Speaki game pages after the non-repeating random SFX change.
- Current prompt: bumpercar-spiky, raise-speaki에서 본인 캐릭터와 보스 효과음만 들리고 다른 캐릭터 효과음이 안 들리는 버그.
- Updated both clients so remote non-NPC character SFX keep a low spatial-volume floor while NPC/boss SFX still use the existing full distance cutoff.
- Current prompt: /Volumes/HANPLANET_HDD/Hanplanet/media/HanDrive/ONScripter/하루우루 를 웹에서 실행 가능하게 만들기.
- Added Django ONScripter player route backed by OnscripterYuri WASM, generated a loose-file `_web` asset folder to avoid downloading the full `.nsa` archives, patched lazy-load case handling, added default cursor BMPs, and patched one web-incompatible string sprite in `0.txt` so the WASM runtime does not divide by zero.
- Verified `/ko/sub/onscripter/haruuru/` loads the title screen and enters the game after selecting the first menu item. Remaining note: `cannot open system.lua` is logged by the engine but non-fatal for this title.
- Current prompt: ONScripter web-ported files must live under `/Volumes/HANPLANET_HDD/Hanplanet/media/HanDrive/ONScripter`, and saves must be stored per user.
- Moved the web runtime dependency files into `/Volumes/HANPLANET_HDD/Hanplanet/media/HanDrive/ONScripter/_web_runtime`, served JS/WASM/JSZip from media URLs, and added server-backed save sync at `/ko/sub/onscripter/<game>/save.zip`.
- Save archives now write to `/Volumes/HANPLANET_HDD/Hanplanet/media/HanDrive/ONScripter/_web_saves/<game>/<user-or-session>/save.zip`; logged-in users use a stable user key, anonymous visitors use their Django session key.
- Current prompt: in-game text is not visible.
- Fixed the text rendering issue by converting all loose script text files in `하루우루_web` from CP949 to UTF-8 and switching OnscripterYuri to `--enc:utf8`; original scripts are preserved as `*.web-encoding-backup` and excluded from the manifest.
- Verified with `manage.py check`, manifest checks, and a headless Chrome CDP smoke test that the first in-game dialogue text is visible.
- Current prompt: make `/sub/onscripter` a Sub-style page where users can choose an ONScripter game.
- Added an ONScripter game selection view that reuses the existing Sub card UI, links to `/ko/sub/onscripter/haruuru`, and exposes `hanplanet:sub-category=game` so the parent `/sub` page groups it under games.
- Verified with `manage.py check`, Django test client checks, and local server `curl` checks that `/ko/sub/onscripter` renders the selection page, redirects from `/sub/onscripter/`, and keeps the existing game player route working.
- Current prompt: ESC in-game menu text is garbled, and top-left hover should show mute and volume controls.
- Replaced the garbled custom ESC menu sprite labels in `하루우루_web/0.txt` with font-safe ASCII labels (`TEXT`, `LOAD`, `SAVE`, `LOG`, `FAST`, `RESET`, `END`).
- Added a top-left hover audio overlay to `templates/fun/onscripter_player.html`; it persists mute/volume in localStorage, applies the setting to video playback, and routes SDL2 WebAudio output through a GainNode for volume control.
- Verified with `manage.py check`, inline JS syntax parsing, the develop-web-game Playwright smoke client, and targeted Playwright screenshots/state checks for the audio hover panel, mute/slider state, and the in-game ESC menu.
- Current prompt: treat the ONScripter game screen as normal page content with a top navbar, fix overly wide in-game text spacing, and make the player background follow the active theme.
- Converted the ONScripter player to extend `base.html`, placed the canvas/video inside a body-stage layout below the shared navbar, and made the stage resize against its content area instead of the full browser viewport.
- Normalized fullwidth spaces and punctuation in the web `하루우루_web` script files so in-game text spacing renders tighter; original versions are preserved as `*.web-spacing-backup` and excluded from the manifest.
- Added theme-aware page and stage background variables for the player and verified the light/dark layout with `manage.py check`, inline JS syntax parsing, manifest checks, and targeted Playwright layout/theme screenshots.
- Current prompt: main menu item hit areas only work at the left edge, and `ui-nav-links` are not visible in the navbar.
- Restored the main menu hidden button hitbox strings in `하루우루_web/0.txt` and `하루우루_web/시노루트0.txt` to their original fullwidth-space width while leaving narrative text spacing normalized.
- Updated the ONScripter player so auto-collapsed nav links remain visible on the player page, nav height changes trigger canvas rescaling, and engine init no longer forces an inline black body background over the active theme.
- Verified with `manage.py check`, inline JS syntax check, mobile/desktop Playwright layout checks, and a targeted Playwright click test that the main menu center click enters the game again.
- Production follow-up: checked `https://www.hanplanet.com/ko/sub/onscripter/haruuru`, confirmed the latest player HTML and updated `0.txt?v=1782440164749700349-90063` are served, ran `collectstatic --noinput`, restarted gunicorn, and verified HTTPS desktop center-click plus mobile `ui-nav-links` visibility with Playwright.
- Current prompt: port `/Volumes/HANPLANET_HDD/Hanplanet/media/HanDrive/ONScripter/kanoina` and use each ONScripter child game's representative image for metadata/cards.
- Extracted `kanoina` NSA archives into `/Volumes/HANPLANET_HDD/Hanplanet/media/HanDrive/ONScripter/kanoina_web`, copied required scripts/font/config, converted scripts to UTF-8 with original backups as `*.web-encoding-backup`, and registered the game with `image/title.png` as its representative thumbnail.
- Added the default cursor BMPs to `kanoina_web` and commented the web-only `nsa` directive in `kanoina_web/0.txt` so the loose-file port runs without browser console errors.
- Verified `kanoina` with `manage.py check`, `main.tests.PwaMetadataTests`, Django test-client manifest/meta checks, the develop-web-game Playwright client, and full-page Playwright screenshots for the title screen plus START into the first in-game scene. Note: the skill client's canvas-only capture is black for this WebGL canvas, but full-page screenshots show the rendered game correctly.
- Deployed the `kanoina` registration to production with `collectstatic --noinput` and `./scripts/restart_gunicorn_and_wait.py`; verified `https://www.hanplanet.com/ko/sub/onscripter/`, `https://www.hanplanet.com/ko/sub/onscripter/kanoina/`, production `index.json`, and production Playwright screenshots for title plus START.
