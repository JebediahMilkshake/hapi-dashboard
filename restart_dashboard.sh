#!/bin/bash
sudo pkill -f app.py
sudo fuser -k 5000/tcp
cd /home/pi/Documents/HAPi-Dashboard
git pull origin
python3 app.py &
test
