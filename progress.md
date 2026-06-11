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
