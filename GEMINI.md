# Hanplanet Project Overview for Gemini

This document provides an overview of the Hanplanet project, detailing its purpose, architecture, development practices, and operational guidelines, serving as instructional context for AI agents.

## Project Overview

Hanplanet is an integrated service built on a Django 5.0.1 framework, combining multiple functionalities within a single project.

**Purpose:** To provide a comprehensive platform encompassing portfolio management, content creation (HanDrive), Git repository hosting (Forgejo), real-time multiplayer gaming, Sub, and AI chatbot capabilities.

**Main Technologies:**
*   **Backend:** Python (Django 5.0.1), SQLite, Celery, Redis
*   **Frontend:** Django Templates, Vanilla JavaScript, Bootstrap
*   **Git Server:** Forgejo (Gitea)
*   **Game Server:** Node.js, `ws`, `jsonwebtoken`, `@msgpack/msgpack`
*   **AI Chatbot:** Ollama
*   **Infrastructure:** Nginx, Cloudflare Tunnel, macOS launchd

**Key Features:**
*   **Root Explorer & Search:** Centralized navigation and content discovery.
*   **Portfolio & Project Details:** Showcase projects and detailed case studies.
*   **HanDrive:** Document and file workspace with Git repository integration (virtual folders, branches, file operations).
*   **Git Service:** Forgejo-based Git web UI with OAuth/session-based authentication.
*   **Real-time Multiplayer Game:** "Bumper Car Spiky" with WebSocket communication.
*   **Sub:** "Stratagem Hero," "Salvation's Edge 4."
*   **Ollama AI Chatbot:** AI-powered conversational agent.
*   **Access Log Analysis:** Collection and summary of access logs for operational insights.

**Architecture:**
Public traffic is routed via Cloudflare Tunnel to local services.
-   `www.hanplanet.com`, `hanplanet.com` -> `http://localhost:8000` (Django/Gunicorn)
-   `git.hanplanet.com` -> `http://localhost:3000` (Gitea)
-   `game.hanplanet.com` -> `http://localhost:8081` (Node game server)
-   `ssh.hanplanet.com` -> `ssh://localhost:22`

Internal services include Django/Gunicorn, Nginx (local reverse proxy), Forgejo, Redis, Celery, Ollama, Node Game Server, and SQLite for databases.

## Building and Running

### 1. Essential Tools

Recommended Environment: macOS.

Required tools (install via Homebrew): `nginx`, `redis`, `gitea`, `libreoffice`.
Optional: `ollama`, `cloudflared`.

### 2. Python Environment Setup

```bash
cd /Users/imhanbyeol/Development/Hanplanet
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Django Initialization

```bash
cd /Users/imhanbyeol/Development/Hanplanet
.venv/bin/python manage.py migrate
.venv/bin/python manage.py collectstatic --noinput
.venv/bin/python manage.py createsuperuser
```

### 4. Secret File Configuration

Create `config/secrets.json` (it's git-ignored) with sensitive keys. Refer to `README.md` for example structure.
Set permissions: `chmod 600 config/secrets.json`.

### 5. Bumpercar Game Server Initialization

```bash
cd /Users/imhanbyeol/Development/Hanplanet/bumpercar-spiky-server
cp .env.example .env
npm install
```
Ensure `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE` in `.env` match Django's game JWT values.

### 6. Gitea / Git Initialization

```bash
brew services start redis
cd /Users/imhanbyeol/Development/Hanplanet/forgejo
bash setup.sh
```
The token output by `setup.sh` must be added to `config/secrets.json` as `FORGEJO_ADMIN_TOKEN`.

### 7. Local Execution

```bash
# Django
cd /Users/imhanbyeol/Development/Hanplanet
.venv/bin/python manage.py runserver

# Game server
cd /Users/imhanbyeol/Development/Hanplanet/bumpercar-spiky-server
PORT=8081 node server.js

# Ollama (if needed)
ollama pull gemma4:12b
ollama serve
```

### 8. Production Deployment (macOS launchd)

The project runs as native macOS launchd daemons (Docker is not used in production).
Key services and their restart commands:

| Service       | launchd label                      | Restart command                                   |
|---------------|------------------------------------|---------------------------------------------------|
| Django        | `com.hanplanet.gunicorn`           | `launchctl kickstart -k gui/$(id -u)/com.hanplanet.gunicorn` |
| Game server   | `com.hanplanet.bumpercar-spiky-server` | `launchctl kickstart -k gui/$(id -u)/com.hanplanet.bumpercar-spiky-server` |
| Git server    | `com.hanplanet.gitea`              | `launchctl kickstart -k gui/$(id -u)/com.hanplanet.gitea` |
| Celery worker | `com.hanplanet.celery`             | `launchctl kickstart -k gui/$(id -u)/com.hanplanet.celery` |
| Nginx         | `com.hanplanet.nginx`              | `launchctl kickstart -k gui/$(id -u)/com.hanplanet.nginx` |

## Development Conventions

### Coding Style & Naming Conventions
*   **Python:** 4-space indentation, PEP 8 naming (`snake_case` for functions/variables, `CamelCase` for models/classes).
*   **Django:** App modules in `main/`, URL routes in `config/urls.py` and `main/urls.py`.
*   **Consistency:** No strict formatter or linter is enforced; maintain consistency with existing code style.
*   **Commit Messages:** Short, descriptive (Korean is acceptable).

### Static Asset Management
*   **`staticfiles/`:** Do not modify directly; it's the output of `collectstatic`.
*   **Rollout Rule:** After any changes to `static/css/*`, `static/js/*`, or templates referencing them, always run `.venv/bin/python manage.py collectstatic` followed by a gunicorn restart. Never restart without collecting static files first.
*   **Cache Busting:** Use the `static_v` template tag (`main/templatetags/static_versioned.py`) which appends `?v=<mtime>` to static asset URLs.

### UI Rules
*   **CSS:** Never use `!important`. Prioritize correct selector specificity or CSS load order.
*   **Design:** Do not alter visual design, responsive breakpoints, or animations unless explicitly requested.
*   **Internationalization (i18n):** Korean/English UI strings must reside in `templates/partials/ui_i18n.html`. Avoid per-view duplicates.
*   **Popups/Modals:** Markup for popups and modals must be in `templates/popup/` or `templates/partials/`, never inline in page templates. Merge similar popup structures into shared partials.
*   **Asset Splitting:** Static assets (CSS/JS) should be split by responsibility; avoid monolithic files.

### Testing Guidelines
*   **Location:** Tests are located in `main/tests.py` and use Django's test framework.
*   **Execution:** Run all tests with `.venv/bin/python manage.py test`.
*   **Coverage:** No specific coverage threshold. Add tests when modifying model logic or views.

### Git Server (Gitea + Celery)
*   **Configuration:** Gitea (Homebrew, port 3000, SQLite DB), Redis (Celery broker), Celery Worker (Django-celery-results backend).
*   **Forgejo Custom Theme:** Custom templates are in `forgejo/custom/templates/`. Assets are in `forgejo/custom/public/assets/`, shared with `www.hanplanet.com`.
*   **Forgejo Asset Priority Rule:** Do not create separate CSS override files for Forgejo. Address stale cache issues by reloading Gitea's default CSS with cache-buster queries in `forgejo/custom/templates/custom/header.tmpl`.

### Access Logs
*   **Location:** Nginx access logs are JSON format at `/opt/homebrew/var/log/nginx/access_json.log`.
*   **Rotation:** Handled by `scripts/rotate-nginx-access-json.sh`.
*   **Daily Summary:** Generated by `summarize_access_logs` command (Django `manage.py`) to `/opt/homebrew/var/log/nginx/summaries/`.
*   **Admin View:** Admin interfaces at `/admin/main/accesslog/` and `/admin/main/accesslog-summary/`.

### Docker
*   **Status:** Not used in current production environment; related files are for reference only.

---
**Note to AI Agents:** When making changes, prioritize adherence to these guidelines, especially regarding UI consistency, static asset deployment, and the use of the `static_v` tag for cache busting. Consult `README.md` and `PROJECT_GUIDELINES.md` for further specifics.
