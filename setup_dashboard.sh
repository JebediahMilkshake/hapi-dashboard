#!/bin/bash
# DietPi Family Dashboard Setup Script
# Run this after first DietPi boot to automate setup
# Usage: sudo bash setup_dashboard.sh

set -e  # Exit on error

echo "========================================="
echo "Family Dashboard - DietPi Setup"
echo "========================================="

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root (use sudo)"
   exit 1
fi

# Step 1: Update system
echo ""
echo "[1/8] Updating system packages..."
apt update
apt upgrade -y

# Step 2: Install Python dependencies
echo ""
echo "[2/8] Installing Python 3 and dependencies..."
apt install -y python3 python3-pip python3-dev python3-tk python3-pil build-essential git

# Step 3: Install Python packages
echo ""
echo "[3/8] Installing Python packages (pywebview, Flask, etc)..."
pip3 install --break-system-packages pywebview==5.1.1 flask==3.0.0 flask-cors==4.0.0 requests==2.31.0

# Step 4: Create app directory
echo ""
echo "[4/8] Creating application directory..."
mkdir -p /root/familydash/{templates,static}
chown -R root:root /root/familydash

# Step 5: Create systemd service
echo ""
echo "[5/8] Creating systemd service file..."
cat > /etc/systemd/system/familydash.service << 'EOF'
[Unit]
Description=Family Dashboard pywebview Application
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/familydash
Environment="DISPLAY=:0"
Environment="XAUTHORITY=/root/.Xauthority"
Environment="QT_QPA_PLATFORM=eglfs"
Environment="PYTHONUNBUFFERED=1"
ExecStart=/usr/bin/python3 -u /root/familydash/app.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=familydash
KillMode=mixed

[Install]
WantedBy=multi-user.target
EOF

# Step 6: Set permissions on service file
echo ""
echo "[6/8] Setting permissions..."
chmod 644 /etc/systemd/system/familydash.service

# Step 7: Reload systemd
echo ""
echo "[7/8] Reloading systemd daemon..."
systemctl daemon-reload

# Step 8: Enable service (but don't start yet)
echo ""
echo "[8/8] Enabling service on boot..."
systemctl enable familydash.service

# Summary
echo ""
echo "========================================="
echo "✓ DietPi setup complete!"
echo "========================================="
echo ""
echo "NEXT STEPS:"
echo ""
echo "1. Copy your application files to /root/familydash/"
echo "   - Place index.html in: /root/familydash/templates/"
echo "   - Place style.css in: /root/familydash/static/"
echo "   - Place app.py and config.py in: /root/familydash/"
echo ""
echo "2. Update config.py with your Home Assistant settings:"
echo "   - HA_URL: Your Home Assistant IP/hostname"
echo "   - HA_TOKEN: Your long-lived access token"
echo "   - WEATHER_ENTITY: Your weather entity"
echo "   - CALENDARS: Your calendar entities"
echo ""
echo "3. Start the service (first time):"
echo "   sudo systemctl start familydash.service"
echo ""
echo "4. Check status:"
echo "   systemctl status familydash.service"
echo ""
echo "5. View logs:"
echo "   journalctl -u familydash.service -f"
echo ""
echo "6. Reboot to test autostart:"
echo "   sudo reboot"
echo ""
echo "========================================="
