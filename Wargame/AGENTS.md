# Wargame Guidelines

`wargame.hanplanet.com` is a separate Apache + PHP + SQLite service. It may use Django site APIs only for non-challenge integration such as account identity, solve storage, and navbar rendering.

## Hard Isolation Rules

- Do not access Django internals directly from PHP. No direct Django DB reads/writes, model imports, session decoding, or shared filesystem state.
- Django site APIs are allowed only when they are not part of wargame challenge mechanics. Current intended integration points are `/api/wargame/session/`, `/api/wargame/solves/`, `/api/wargame/preferences/`, and `/api/wargame/navbar/`.
- Use short-lived Bearer tokens issued by Django for identity and solve reads/writes.
- Do not use Django APIs for vulnerable problem files, challenge flags, hints, challenge state, exploit targets, or any data that a wargame problem is supposed to expose or protect.
- Do not use the root `db.sqlite3`, `media/`, `config/`, `main/`, Celery, Redis, Forgejo/Gitea, Node game servers, or Django internals from PHP.
- Keep Wargame cookies host-only for `wargame.hanplanet.com`; the browser may send Django cookies only to `www.hanplanet.com` when calling the Django Wargame API.
- Do not proxy through the main Django/Gunicorn service or the existing Nginx app routing.
- Django route changes are allowed only for the explicit Wargame API listed above.
- Do not store runtime data outside `Wargame/data/`.
- Keep public web files under `Wargame/public/`; keep SQLite and app internals outside the public root.

## Runtime

- Stack: Apache + PHP + SQLite only.
- Public hostname: `wargame.hanplanet.com`.
- Local service target: `http://localhost:8090`.
- Database: `Wargame/data/wargame.sqlite3` for challenge-local vulnerable data only. Account identity and solve state may live behind Django APIs because they are site integration data, not challenge mechanics.
- App code: `Wargame/app/`, `Wargame/public/`, `Wargame/database/`, `Wargame/scripts/`.
- Deployment examples: `Wargame/deploy/`.

## Change Discipline

- Changes for this site should stay inside `Wargame/` unless the user explicitly asks to update global tunnel/service configuration.
- If deployment config needs an absolute path, make it obvious and keep the app code itself relative to `Wargame/`.
- When adding challenge features, use only the Wargame SQLite database and PHP code in this directory. Django APIs are acceptable for surrounding site features, but not for the implementation or data path of the problems themselves.
