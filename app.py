import os
import subprocess
import requests
from flask import Flask, render_template, jsonify
import webview

app = Flask(__name__)

# --- CONFIGURATION ---
HA_URL = "http://YOUR_HOME_ASSISTANT_IP:8123/api"
HA_TOKEN = "YOUR_LONG_LIVED_ACCESS_TOKEN"

headers = {
    "Authorization": f"Bearer {HA_TOKEN}",
    "Content-Type": "application/json",
}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/version')
def get_version():
    try:
        # Pulls last commit date and short hash from Git
        cmd = ["git", "log", "-1", "--format=%cd (%h)", "--date=format:%Y.%m.%d"]
        git_info = subprocess.check_output(cmd).decode().strip()
        response = jsonify({"version": git_info})
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return response
    except:
        return jsonify({"version": "v1.0-local"})

@app.route('/api/data')
def get_data():
    try:
        # Added 10s timeout to prevent app freezing on network lag
        weather_res = requests.get(f"{HA_URL}/states/weather.home", headers=headers, timeout=10)
        calendar_res = requests.get(f"{HA_URL}/calendars/calendar.family?start=2026-01-01T00:00:00Z&end=2026-04-01T00:00:00Z", headers=headers, timeout=10)
        
        return jsonify({
            "weather": weather_res.json(),
            "events": calendar_res.json(),
            "dark_mode": True,
            "legend": [
                {"name": "School", "color": "#FF5722"},
                {"name": "Work", "color": "#2196F3"},
                {"name": "Family", "color": "#4CAF50"}
            ]
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # Start webview with optimization for Raspberry Pi
    window = webview.create_window('Family Dashboard', app, fullscreen=True)
    webview.start()