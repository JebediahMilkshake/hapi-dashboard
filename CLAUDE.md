# HAPi-Dashboard

## Overview
Web-based Home Assistant dashboard for dedicated displays (Raspberry Pi Zero 2 W). Flask backend proxies HA API data; browser frontend renders a kiosk-mode dashboard with weather, calendar, and clock.

## Architecture
- `app-backend.py` — Flask server on `0.0.0.0:5000`. Serves `index.html` and REST endpoints (`/api/data`, `/api/version`). Uses connection pooling, retry strategy, and caching.
- `app-frontend.py` — Launches Firefox in kiosk mode pointing at the backend URL.
- `config.py` — All configuration: `HA_URL`, `HA_TOKEN`, entity IDs, calendar definitions with colors/priorities, theme/screen-blank entities.
- `templates/index.html` — Dashboard UI with inline JavaScript for dynamic updates (clock, weather, calendar grid).
- `static/style.css` — Dark and light theme styles.
- `firefox-frontend.service` / `pywebview-frontend.service` — systemd units for auto-start on boot.

## Tech Stack
- **Backend:** Python 3, Flask, Flask-CORS, requests (with urllib3 retry)
- **Frontend:** Vanilla HTML/CSS/JS, Lucide icons (CDN)
- **Target:** Raspberry Pi Zero 2 W — optimize for minimal RAM/CPU

## Key Conventions
- Configuration lives in `config.py`, not hardcoded in app files
- Dark/light theme controlled via HA `input_boolean` entity
- Backend caching: weather 60s, theme/forecast 300s, calendar events always fresh
- Commit messages use conventional format (e.g., `feat:`, `fix:`)
- Performance is critical — this runs on a Pi Zero 2 W with limited resources

## Setup
```bash
pip install Flask Flask-Cors requests urllib3
python3 app-backend.py
python3 app-frontend.py --url http://localhost:5000 --kiosk
```
