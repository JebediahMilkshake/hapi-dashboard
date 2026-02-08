import os
import subprocess
import requests
from flask import Flask, render_template, jsonify
import webview
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

app = Flask(__name__)

# --- CONFIGURATION ---
HA_URL = "http://YOUR_HOME_ASSISTANT_IP:8123/api"
HA_TOKEN = "YOUR_LONG_LIVED_ACCESS_TOKEN"

headers = {
    "Authorization": f"Bearer {HA_TOKEN}",
    "Content-Type": "application/json",
}

# Setup resilient session to prevent "hanging" connections
session = requests.Session()
retries = Retry(total=3, backoff_factor=0.2, status_forcelist=[500, 502, 503, 504])
session.mount('http://', HTTPAdapter(max_retries=retries))

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/version')
def get_version():
    try:
        cmd = ["git", "log", "-1", "--format=%cd (%h)", "--date=format:%Y.%m.%d"]
        git_info = subprocess.check_output(cmd).decode().strip()
        return jsonify({"version": git_info})
    except:
        return jsonify({"version": "v1.0-local"})

@app.route('/api/data')
def get_data():
    try:
        # Fetch weather and calendar with strict timeouts
        w_res = session.get(f"{HA_URL}/states/weather.home", headers=headers, timeout=5)
        # Fetching a wider range for the rolling calendar
        c_res = session.get(f"{HA_URL}/calendars/calendar.family?start=2026-01-01T00:00:00Z&end=2026-04-01T00:00:00Z", headers=headers, timeout=5)
        
        weather_data = w_res.json() if w_res.status_code == 200 else {}
        event_data = c_res.json() if c_res.status_code == 200 else []

        # HA Forecast handling: Check attributes first, then fallback
        forecast = weather_data.get('attributes', {}).get('forecast', [])

        return jsonify({
            "weather": weather_data,
            "events": event_data,
            "forecast": forecast,
            "dark_mode": True,
            "legend": [
                {"name": "School", "color": "#FF5722"},
                {"name": "Work", "color": "#2196F3"},
                {"name": "Family", "color": "#4CAF50"}
            ]
        })
    except Exception as e:
        print(f"Server Error: {e}")
        return jsonify({"error": str(e), "events": [], "forecast": []}), 500

if __name__ == '__main__':
    window = webview.create_window('Family Dashboard', app, fullscreen=True)
    webview.start()