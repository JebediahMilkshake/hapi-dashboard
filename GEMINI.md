# HAPi-Dashboard Project Overview

This project, "HAPi-Dashboard," is a web-based dashboard designed to display information from Home Assistant (HA) on a dedicated screen, such as a Raspberry Pi. It consists of a Python Flask backend that communicates with the Home Assistant API and a browser-based frontend that renders the dashboard.

**Key Technologies:**

*   **Backend:** Python 3, Flask, `requests` library for Home Assistant API communication, `subprocess` for `git` version info.
*   **Frontend:** HTML, CSS, JavaScript (dynamic updates), `lucide` for icons.
*   **Integration:** Home Assistant API.

**Architecture:**

The system operates with a clear separation of concerns:
*   `app-backend.py`: A Flask application serving the `index.html` and providing REST API endpoints (`/api/data`, `/api/version`) to fetch and process data from Home Assistant, including weather, forecast, calendar events, and theme state. It includes caching mechanisms for performance.
*   `app-frontend.py`: A Python script responsible for launching a web browser (specifically Firefox) in kiosk mode, pointing it to the Flask backend's URL. This facilitates running the dashboard on a dedicated display device.
*   `config.py`: Centralized configuration for Home Assistant URL, API token, entity IDs for weather and theme, and calendar definitions.
*   `static/` and `templates/`: Contain the static assets (CSS) and HTML templates for the dashboard's user interface.

## Building and Running

### Prerequisites

*   Python 3 and `pip`
*   Firefox browser (for `app-frontend.py`)
*   Home Assistant instance with an API token

### Setup

1.  **Install Python dependencies:**
    ```bash
    pip install Flask Flask-Cors requests urllib3
    ```
    (Note: `urllib3` is a dependency of `requests` but explicitly mentioned due to retry strategy import.)

2.  **Configure `config.py`:**
    Edit `config.py` to set your `HA_URL`, `HA_TOKEN`, `WEATHER_ENTITY`, and `CALENDARS` to match your Home Assistant setup.

### Running the Backend

To start the Flask backend server:

```bash
python3 app-backend.py
```
The backend will run on `http://0.0.0.0:5000`.

### Running the Frontend

To launch the Firefox browser in kiosk mode displaying the dashboard:

```bash
python3 app-frontend.py --url http://localhost:5000 --kiosk
```
Adjust the `--url` argument if your backend is running on a different host or port.

### System Services

The presence of `firefox-frontend.service` and `pywebview-frontend.service` indicates that the application is designed to be run as systemd services for automatic startup and management, particularly on Linux-based devices like Raspberry Pis. These files would need to be installed and enabled according to systemd conventions (e.g., moved to `/etc/systemd/system/`) to run the frontend automatically on boot.

## Development Conventions

*   **Backend Logic:** Primarily Python, structured using Flask routes and functions for API interactions and data processing.
*   **Frontend Design:** Standard web technologies (HTML, CSS, JavaScript). The JavaScript within `index.html` handles data fetching and dynamic UI updates.
*   **Styling:** Defined in `static/style.css`, supporting dark and light themes.
*   **Configuration:** Externalized into `config.py` for easy customization without modifying application logic.
*   **Icons:** Utilizes the `lucide` icon library.
*   **Version Reporting:** The backend exposes a `/api/version` endpoint that retrieves the git commit information, indicating a practice of version tracking.
*   **Optimization:** The backend implements connection pooling and caching for Home Assistant API requests to improve performance and reduce load.
