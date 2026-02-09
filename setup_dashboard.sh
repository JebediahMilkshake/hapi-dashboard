#!/bin/bash
# HAPi Dashboard Setup Script for DietPi 64-bit
# Configures Flask + cog browser kiosk dashboard
# Usage: sudo bash setup_dashboard.sh [GITHUB_REPO_URL]
# Example: sudo bash setup_dashboard.sh https://github.com/yourusername/HAPi-Dashboard.git

set -e  # Exit on error

echo "========================================="
echo "HAPi Dashboard - DietPi 64-bit Setup"
echo "========================================="

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root (use sudo)"
   exit 1
fi

# Get GitHub repo URL from argument or use default
GITHUB_REPO="${1:-https://github.com/yourusername/HAPi-Dashboard.git}"
APP_DIR="/home/dietpi/HAPi-Dashboard"

# Step 1: Update system
echo ""
echo "[1/10] Updating system packages..."
apt update
apt upgrade -y

# Step 2: Install Python dependencies
echo ""
echo "[2/10] Installing Python 3 and dependencies..."
apt install -y python3 python3-pip python3-dev build-essential git

# Step 3: Install cog browser (WPE WebKit - lightweight embedded browser)
echo ""
echo "[3/10] Installing cog browser for kiosk display..."
apt install -y cog

# Step 4: Install git config helper (fixes "dubious ownership" errors)
echo ""
echo "[4/10] Configuring git for safe directory access..."
git config --global --add safe.directory "$APP_DIR"

# Step 5: Install Python packages for Flask app
echo ""
echo "[5/10] Installing Python packages (Flask, requests, etc)..."
pip3 install --break-system-packages flask==3.0.0 flask-cors==4.0.0 requests==2.31.0

# Step 6: Clone or pull repository
echo ""
echo "[6/10] Setting up git repository..."

if [ -d "$APP_DIR/.git" ]; then
    # Repository exists - pull latest
    echo "Git repository found. Pulling latest changes..."
    cd "$APP_DIR"
    git pull origin main || git pull origin master
    echo "✓ Repository updated successfully"
elif [ -d "$APP_DIR" ]; then
    # Directory exists but not a git repo - convert it
    echo "Directory exists but not a git repository. Initializing..."
    cd "$APP_DIR"
    git init
    git remote add origin "$GITHUB_REPO"
    git fetch origin
    git reset --hard origin/main || git reset --hard origin/master
    echo "✓ Repository initialized from remote"
else
    # Directory doesn't exist - clone it
    echo "Cloning repository from: $GITHUB_REPO"
    git clone "$GITHUB_REPO" "$APP_DIR"
    echo "✓ Repository cloned successfully"
fi

# Set proper permissions
chown -R dietpi:dietpi "$APP_DIR"
chmod -R 755 "$APP_DIR"

# Step 7: Verify directory structure
echo ""
echo "[7/10] Verifying directory structure..."
mkdir -p "$APP_DIR/templates"
mkdir -p "$APP_DIR/static"
chown -R dietpi:dietpi "$APP_DIR"

if [ -f "$APP_DIR/app.py" ] && [ -f "$APP_DIR/config.py" ]; then
    echo "✓ Application files found"
else
    echo "⚠ Warning: Some application files are missing"
    echo "  Expected: app.py, config.py, templates/index.html, static/style.css"
fi

# Step 8: Create systemd service
echo ""
echo "[8/10] Creating systemd service file..."
cat > /etc/systemd/system/HAPi-Dashboard.service << 'EOF'
[Unit]
Description=HAPi Dashboard - Home Assistant Family Dashboard
After=network-online.target
Wants=network-online.target
Documentation=https://github.com/yourusername/HAPi-Dashboard

[Service]
Type=simple
User=root
WorkingDirectory=/home/dietpi/HAPi-Dashboard
Environment="DISPLAY=:0"
Environment="XAUTHORITY=/root/.Xauthority"
Environment="XDG_RUNTIME_DIR=/run/user/0"
Environment="PYTHONUNBUFFERED=1"
ExecStartPre=/bin/sleep 5
ExecStart=/usr/bin/python3 -u /home/dietpi/HAPi-Dashboard/app.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=HAPi-Dashboard
KillMode=mixed
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF

# Step 9: Disable desktop environment (LXDE/LXDM)
echo ""
echo "[9/10] Disabling desktop environment for fullscreen kiosk mode..."
systemctl disable display-manager.service 2>/dev/null || true
systemctl stop display-manager.service 2>/dev/null || true

# Step 10: Finalize systemd setup
echo ""
echo "[10/10] Finalizing systemd configuration..."
chmod 644 /etc/systemd/system/HAPi-Dashboard.service
systemctl daemon-reload
systemctl enable HAPi-Dashboard.service

# Summary
echo ""
echo "========================================="
echo "✓ DietPi setup complete!"
echo "========================================="
echo ""
echo "NEXT STEPS:"
echo ""
echo "1. Verify your application files:"
echo "   ls -la $APP_DIR/"
echo "   # Should have: app.py, config.py, templates/, static/"
echo ""
echo "2. SSH in and update config.py with your Home Assistant settings:"
echo "   ssh dietpi@<your-ip>"
echo "   nano $APP_DIR/config.py"
echo ""
echo "3. Update these in config.py:"
echo "   - HA_URL: Your Home Assistant IP (e.g., http://192.168.1.xxx:8123)"
echo "   - HA_TOKEN: Your long-lived access token from Home Assistant"
echo "   - WEATHER_ENTITY: Your weather entity ID (e.g., weather.forecast_home)"
echo "   - CALENDARS: Your calendar entities with colors and priorities"
echo ""
echo "4. Start the service (first time):"
echo "   sudo systemctl start HAPi-Dashboard.service"
echo ""
echo "5. Check status:"
echo "   systemctl status HAPi-Dashboard.service"
echo ""
echo "6. View logs:"
echo "   journalctl -u HAPi-Dashboard.service -f"
echo ""
echo "7. Reboot to test fullscreen kiosk autostart:"
echo "   sudo reboot"
echo ""
echo "========================================="
echo ""
echo "File Structure:"
echo "  $APP_DIR"
echo "  ├── app.py (Flask + cog browser launcher)"
echo "  ├── config.py (Home Assistant settings - EDIT THIS)"
echo "  ├── templates/"
echo "  │   └── index.html (dashboard UI)"
echo "  └── static/"
echo "      └── style.css (dashboard styling)"
echo ""
echo "Service:"
echo "  /etc/systemd/system/HAPi-Dashboard.service"
echo ""
echo "========================================="
echo ""
echo "Troubleshooting:"
echo "  • Check service logs: journalctl -u HAPi-Dashboard.service -n 50"
echo "  • Test Flask manually: cd $APP_DIR && python3 app.py"
echo "  • Test HA connection: curl -H 'Authorization: Bearer TOKEN' http://HA_IP:8123/api/states/weather.xxx"
echo "  • Monitor temp: vcgencmd measure_temp"
echo "  • Check RAM: free -h"
echo ""