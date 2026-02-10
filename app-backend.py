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
    """
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
    
    try:
        response = session.request(method, f"http://homeassistant:8123/api/{endpoint}", 
                                   json=data, timeout=timeout)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        app.logger.error(f"Error fetching data from Home Assistant: {e}")
        return {}