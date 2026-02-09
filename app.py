import os
os.environ['QT_QPA_PLATFORM'] = 'eglfs'
os.environ['QT_QPA_EGLFS_ALWAYS_SET_DPI'] = '1'

import webview
from flask import Flask, render_template, jsonify
from flask_cors import CORS
import threading
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import subprocess
import sys
import time
import logging
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
    "forecast": {"data": None, "timestamp": None}
}

CACHE_DURATION = {
    "weather": 60,      # Weather: cache for 60 seconds
    "theme": 300,       # Theme: cache for 5 minutes (rarely changes)
    "forecast": 300     # Forecast: cache for 5 minutes
}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/version')
def get_version():
    try:
        # Get the date of the last commit in YYYY.MM.DD format
        # and the short hash (e.g., a1b2c3d)
        cmd = ["git", "log", "-1", "--format=%cd (%h)", "--date=format:%Y.%m.%d"]
        git_info = subprocess.check_output(cmd).decode().strip()
        
        response = jsonify({"version": git_info})
        # Prevent the browser from caching the version number
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return response
    except:
        # Fallback if git is not initialized or fails
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
    start_iso = (now_dt - timedelta(days=14)).isoformat()
    end_iso = (now_dt + timedelta(days=45)).isoformat()
    
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

def run_flask():
    """Run Flask development server"""
    app.run(host='127.0.0.1', port=5000, debug=False, threaded=True)

if __name__ == '__main__':
    # Start Flask in background thread
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()
    
    # Give Flask time to start before launching webview
    time.sleep(2)
    
    # Launch pywebview window (fullscreen kiosk mode)
    try:
        print("[HAPi-Dashboard] Launching pywebview in fullscreen kiosk mode...")
        webview.create_window('HAPi Dashboard', 'http://127.0.0.1:5000', fullscreen=True)
        webview.start()
    except Exception as e:
        print(f"[HAPi-Dashboard] Error starting webview: {e}")
        app.logger.error(f"Error starting webview: {e}")
        sys.exit(1)