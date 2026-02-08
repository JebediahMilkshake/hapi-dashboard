#!/bin/bash
cd /home/pi/Documents/dashboard # Change to your actual path
git pull git@github.com:JebediahMilkshake/HAPi-Dashboard.git
/usr/bin/python3 app.py &
