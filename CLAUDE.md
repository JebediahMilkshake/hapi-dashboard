# HAPi-Dashboard (ha-static branch)

## Overview
Static web dashboard for Home Assistant, served directly from HA's `www` folder. No backend server — the browser calls the HA REST API directly using a long-lived access token. Designed for dedicated kiosk displays (Raspberry Pi 3 Model B (1GB RAM)).

## Architecture
- `index.html` — Dashboard UI shell, loads config.js, Lucide icons (CDN), and dashboard.js.
- `config.js` — All configuration: `HA_URL`, `HA_TOKEN`, entity IDs, calendar definitions, grocery categories, cache durations.
- `dashboard.js` — All application logic: HA API calls, client-side caching, DOM rendering (clock, weather, calendar, planner, shopping list).
- `style.css` — Dark and light theme styles using CSS custom properties.

## Tech Stack
- **Frontend only:** Vanilla HTML/CSS/JS, Lucide icons (CDN)
- **API:** Home Assistant REST API (direct browser fetch with Bearer token)
- **Target:** Raspberry Pi 3 Model B (1GB RAM) — optimize for minimal RAM/CPU

## Key Conventions
- Configuration lives in `config.js`, not hardcoded in other files
- Dark/light theme controlled via HA `input_boolean` entity
- Client-side caching: weather 60s, theme/forecast 300s, shopping 30s
- Calendar events fetched fresh each update cycle
- Shopping list uses polling with change detection (only re-renders when data differs)
- Commit messages use conventional format (e.g., `feat:`, `fix:`)
- Performance is critical — this runs on a Pi Zero 2 W with limited resources

## Deployment
Copy files to Home Assistant's www folder:
```bash
cp index.html config.js dashboard.js style.css /config/www/hapi-dashboard/
```
Access at: `http://your-ha:8123/local/hapi-dashboard/index.html`

## Git Branches
- `flask-backend` — Original Python/Flask version with backend proxy
- `ha-static` — This branch: static JS served from HA's www folder
- `main` — Common ancestor
