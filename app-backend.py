from flask import Flask, render_template, jsonify, Response
from flask_cors import CORS
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import subprocess
import sys
import logging
import json
import time
from datetime import datetime, timedelta
from config import *

app = Flask(__name__)
CORS(app)

# Silence the "GET /api/data" terminal spam
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

# OPTIMIZATION: Connection pooling for Home Assistant API
session = requests.Session()
retry_strategy = Retry(
    total=3,
    connect=3,
    backoff_factor=0.5,
    status_forcelist=[429, 500, 502, 503, 504],
    allowed_methods=["HEAD", "GET", "OPTIONS", "POST"]
)
adapter = HTTPAdapter(max_retries=retry_strategy, pool_connections=5, pool_maxsize=5)
session.mount("http://", adapter)
session.mount("https://", adapter)

# OPTIMIZATION: Cache for frequently accessed data
cache = {
    "weather": {"data": None, "timestamp": None},
    "theme": {"data": None, "timestamp": None},
    "forecast": {"data": None, "timestamp": None},
    # Shopping list: short TTL so SSE stream stays near-real-time.
    # Set data=None / timestamp=None to force an immediate refresh (webhook pattern).
    "shopping": {"data": None, "timestamp": None},
}

CACHE_DURATION = {
    "weather": 60,      # Weather: cache for 60 seconds
    "theme": 300,       # Theme: cache for 5 minutes (rarely changes)
    "forecast": 300,    # Forecast: cache for 5 minutes
    "shopping": 5,      # Shopping list: cache for 5 seconds (SSE polls this)
}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/version')
def get_version():
    try:
        cmd = ["git", "log", "-1", "--format=%cd (%h)", "--date=format:%Y.%m.%d"]
        git_info = subprocess.check_output(cmd).decode().strip()
        
        response = jsonify({"version": git_info})
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return response
    except:
        return jsonify({"version": "v1.0-local"})

def is_cache_valid(cache_key):
    """Check if cached data is still valid"""
    if cache[cache_key]["data"] is None:
        return False
    
    age = datetime.now() - cache[cache_key]["timestamp"]
    return age.total_seconds() < CACHE_DURATION[cache_key]

@app.route('/api/data')
def get_dashboard_data():
    """
    Main API endpoint for dashboard data.
    Combines weather, forecast, theme, and calendar events.
    """
    
    # Get weather (use cache if available)
    if is_cache_valid("weather"):
        weather = cache["weather"]["data"]
    else:
        weather = get_ha_data(f"states/{WEATHER_ENTITY}")
        cache["weather"]["data"] = weather
        cache["weather"]["timestamp"] = datetime.now()
    
    # Get theme state (use cache if available)
    if is_cache_valid("theme"):
        theme_state = cache["theme"]["data"]
    else:
        theme_state = get_ha_data(f"states/{THEME_ENTITY}")
        cache["theme"]["data"] = theme_state
        cache["theme"]["timestamp"] = datetime.now()
    
    is_dark = theme_state['state'] == 'on' if theme_state else True

    legend_data = [{"name": c['name'], "color": c['color_dark'] if is_dark else c['color_light']} for c in CALENDARS]

    # Get forecast (use cache if available)
    if is_cache_valid("forecast"):
        forecast_data = cache["forecast"]["data"]
    else:
        forecast_data = []
        try:
            f_resp = get_ha_data("services/weather/get_forecasts?return_response", method="POST", 
                                data={"entity_id": WEATHER_ENTITY, "type": "daily"})
            if f_resp:
                forecast_data = f_resp.get('service_response', {}).get(WEATHER_ENTITY, {}).get('forecast', [])[:5]
        except Exception as e:
            app.logger.error(f"Error fetching forecast: {e}")
        
        cache["forecast"]["data"] = forecast_data
        cache["forecast"]["timestamp"] = datetime.now()

    # Get calendar events (always fresh, as these change frequently)
    all_events = []
    now_dt = datetime.now()
    start_iso = (now_dt - timedelta(days=3)).isoformat()
    end_iso = (now_dt + timedelta(days=14)).isoformat()
    
    for cal in CALENDARS:
        try:
            events = get_ha_data(f"calendars/{cal['entity']}", data={"start": start_iso, "end": end_iso})
            if events:
                for e in events:
                    e['color'] = cal['color_dark'] if is_dark else cal['color_light']
                    e['priority'] = cal.get('priority', 99)
                    all_events.append(e)
        except Exception as e:
            app.logger.error(f"Error fetching calendar {cal['entity']}: {e}")
    
    return jsonify({
        "weather": weather,
        "forecast": forecast_data,
        "events": all_events,
        "dark_mode": is_dark,
        "legend": legend_data
    })

def get_ha_data(endpoint, method="GET", data=None, timeout=5):
    """
    Fetch data from Home Assistant API using optimized session.
    
    Args:
        endpoint: API endpoint (without base URL)
        method: GET or POST
        data: Request payload for POST
        timeout: Request timeout in seconds
    
    Returns:
        JSON response or None if failed
    """
    headers = {"Authorization": f"Bearer {HA_TOKEN}", "Content-Type": "application/json"}
    url = f"{HA_URL}/api/{endpoint}"
    
    try:
        if method == "POST":
            response = session.post(url, headers=headers, json=data, timeout=timeout)
        else:
            response = session.get(url, headers=headers, params=data, timeout=timeout)
        
        if response.status_code == 200:
            return response.json()
        else:
            app.logger.warning(f"HA API returned {response.status_code}: {endpoint}")
            return None
    except requests.Timeout:
        app.logger.error(f"HA API timeout: {endpoint}")
        return None
    except requests.ConnectionError:
        app.logger.error(f"HA API connection error: {endpoint}")
        return None
    except Exception as e:
        app.logger.error(f"HA API error: {endpoint} - {str(e)}")
        return None

def fetch_shopping_items():
    """
    Fetch the shopping list from HA and return a normalised list of
    {name, status} dicts, pending items first.  Returns [] on failure.
    """
    resp = get_ha_data(
        "services/todo/get_items?return_response",
        method="POST",
        data={"entity_id": SHOPPING_LIST_ENTITY},
    )
    if not resp:
        return []
    items = (
        resp.get("service_response", {})
            .get(SHOPPING_LIST_ENTITY, {})
            .get("items", [])
    )
    normalised = [
        {"name": item["summary"], "status": item.get("status", "needs_action")}
        for item in items
        if "summary" in item
    ]
    # Pending items first, completed items last — done server-side to avoid
    # per-render sort in JS on the Pi.
    normalised.sort(key=lambda x: 0 if x["status"] == "needs_action" else 1)
    return normalised


def group_shopping_items(items):
    """
    Group a flat list of {name, status} items into categorised buckets using
    the GROCERY_CATEGORIES rules from config.py.  Returns a list of
    {category, items} dicts in GROCERY_CATEGORY_ORDER order, with any unknown
    categories appended alphabetically and "Other" always last.
    """
    buckets = {}  # category -> list of {name, status}
    for item in items:
        name_lower = item["name"].lower()
        matched = False
        for rule in GROCERY_CATEGORIES:
            if any(kw in name_lower for kw in rule["keywords"]):
                cat = rule["category"]
                matched = True
                break
        if not matched:
            cat = "Other"
        buckets.setdefault(cat, []).append(item)

    # Build ordered output: GROCERY_CATEGORY_ORDER first, then any extras
    # alphabetically, "Other" always last.
    ordered_cats = []
    seen = set()
    for cat in GROCERY_CATEGORY_ORDER:
        if cat in buckets:
            ordered_cats.append(cat)
            seen.add(cat)
    extras = sorted(c for c in buckets if c not in seen and c != "Other")
    ordered_cats.extend(extras)
    if "Other" in buckets:
        ordered_cats.append("Other")

    return [{"category": cat, "items": buckets[cat]} for cat in ordered_cats]


def get_shopping_grouped():
    """
    Return grouped shopping data, using the short-lived cache.
    Thread-safe enough for single-threaded Flask; the Pi runs one worker.
    """
    if is_cache_valid("shopping"):
        return cache["shopping"]["data"]

    items = fetch_shopping_items()
    grouped = group_shopping_items(items)
    cache["shopping"]["data"] = grouped
    cache["shopping"]["timestamp"] = datetime.now()
    return grouped


@app.route('/api/shopping/stream')
def shopping_stream():
    """
    SSE endpoint — streams shopping list changes to the browser.
    The client holds one persistent connection; we push a new event only
    when the data differs from the last push.  Polls the cache every 5 s
    (matching the shopping cache TTL) so the Pi CPU load stays minimal.

    Performance note: SSE over Flask's dev server is fine for a single kiosk
    client.  For multiple clients, a proper async server would be needed, but
    that is not a Pi Zero 2 W use-case.
    """
    def event_stream():
        last_payload = None
        while True:
            try:
                grouped = get_shopping_grouped()
                payload = json.dumps(grouped)
                if payload != last_payload:
                    # SSE format: "data: <json>\n\n"
                    yield f"data: {payload}\n\n"
                    last_payload = payload
            except Exception as e:
                app.logger.error(f"Shopping SSE error: {e}")
                yield "data: []\n\n"
            time.sleep(5)

    return Response(
        event_stream(),
        mimetype="text/event-stream",
        headers={
            # Disable proxy/nginx buffering so events reach the client
            # immediately without waiting for a full chunk.
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
        },
    )


@app.route('/api/shopping/webhook', methods=['POST'])
def shopping_webhook():
    """
    Cache-bust endpoint called by a Home Assistant automation whenever
    todo.shopping_list changes.  Invalidates the shopping cache so the
    next SSE poll immediately fetches fresh data.

    Example HA automation (add to automations.yaml):
      alias: "Dashboard - Shopping list changed"
      trigger:
        - platform: state
          entity_id: todo.shopping_list
      action:
        - service: rest_command.dashboard_shopping_webhook
    And in configuration.yaml:
      rest_command:
        dashboard_shopping_webhook:
          url: "http://<PI_IP>:5000/api/shopping/webhook"
          method: POST
    """
    cache["shopping"]["data"] = None
    cache["shopping"]["timestamp"] = None
    return jsonify({"ok": True})


if __name__ == '__main__':
    # Run Flask server on all interfaces (so Pi can access it)
    print("[HAPi-Dashboard Backend] Starting Flask server on 0.0.0.0:5000")
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
