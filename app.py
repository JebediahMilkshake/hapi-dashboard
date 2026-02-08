import webview
from flask import Flask, render_template, jsonify
from flask_cors import CORS
import threading
import requests
import subprocess
import os
import sys
import time
from datetime import datetime, timedelta
from config import *

app = Flask(__name__)
CORS(app)

# ==================== AUTO-UPDATER ====================
def check_for_updates():
    """Silent background update: checks GitHub and restarts immediately on change."""
    while True:
        try:
            subprocess.run(["git", "fetch"], check=True)
            local = subprocess.check_output(["git", "rev-parse", "HEAD"]).decode().strip()
            remote = subprocess.check_output(["git", "rev-parse", "@{u}"]).decode().strip()

            if local != remote:
                subprocess.run(["git", "pull"], check=True)
                # Replacing current process with the new version
                os.execv(sys.executable, ['python'] + sys.argv)
        except Exception as e:
            print(f"Update check failed: {e}")
        
        time.sleep(86400) # Wait 24 hours

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/version')
def get_version():
    # Returns the last modification time of app.py as the version string
    mtime = os.path.getmtime(__file__)
    return jsonify({"version": datetime.fromtimestamp(mtime).strftime('%Y.%m.%d %H:%M')})

@app.route('/api/data')
def get_dashboard_data():
    weather = get_ha_data(f"states/{WEATHER_ENTITY}")
    theme_state = get_ha_data(f"states/{THEME_ENTITY}")
    is_dark = theme_state['state'] == 'on' if theme_state else True

    legend_data = [{"name": c['name'], "color": c['color_dark' if is_dark else 'color_light']} for c in CALENDARS]

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
                e['color'] = cal['color_dark' if is_dark else 'color_light']
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
    except Exception as e:
        return None

def run_flask():
    app.run(host='127.0.0.1', port=5000)

if __name__ == '__main__':
    threading.Thread(target=check_for_updates, daemon=True).start()
    threading.Thread(target=run_flask, daemon=True).start()
    webview.create_window('Dashboard', 'http://127.0.0.1:5000', fullscreen=True)
    webview.start()