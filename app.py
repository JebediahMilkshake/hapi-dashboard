import webview
from flask import Flask, render_template, jsonify
from flask_cors import CORS
import threading
import requests
import subprocess
import os
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

@app.route('/api/data')
def get_dashboard_data():
    weather = get_ha_data(f"states/{WEATHER_ENTITY}")
    theme_state = get_ha_data(f"states/{THEME_ENTITY}")
    is_dark = theme_state['state'] == 'on' if theme_state else True

    legend_data = [{"name": c['name'], "color": c['color_dark'] if is_dark else c['color_light']} for c in CALENDARS]

    forecast_data = []
    f_resp = get_ha_data("services/weather/get_forecasts?return_response", method="POST", 
                        data={"entity_id": WEATHER_ENTITY, "type": "daily"})
    if f_resp:
        forecast_data = f_resp.get('service_response', {}).get(WEATHER_ENTITY, {}).get('forecast', [])[:5]

    all_events = []
    now_dt = datetime.now()
    start_iso = (now_dt - timedelta(days=14)).isoformat()
    end_iso = (now_dt + timedelta(days=45)).isoformat()
    
    for cal in CALENDARS:
        events = get_ha_data(f"calendars/{cal['entity']}", data={"start": start_iso, "end": end_iso})
        if events:
            for e in events:
                e['color'] = cal['color_dark'] if is_dark else cal['color_light']
                e['priority'] = cal.get('priority', 99)
                all_events.append(e)
    
    return jsonify({
        "weather": weather,
        "forecast": forecast_data,
        "events": all_events,
        "dark_mode": is_dark,
        "legend": legend_data
    })

def get_ha_data(endpoint, method="GET", data=None):
    headers = {"Authorization": f"Bearer {HA_TOKEN}", "Content-Type": "application/json"}
    url = f"{HA_URL}/api/{endpoint}"
    try:
        if method == "POST":
            response = requests.post(url, headers=headers, json=data, timeout=10)
        else:
            response = requests.get(url, headers=headers, params=data, timeout=10)
        return response.json() if response.status_code == 200 else None
    except:
        return None

def run_flask():
    app.run(host='127.0.0.1', port=5000)

if __name__ == '__main__':
    threading.Thread(target=run_flask, daemon=True).start()
    webview.create_window('Family Dashboard', 'http://127.0.0.1:5000', fullscreen=True)
    webview.start()