#!/bin/bash
cd /home/pi/Documents/HAPi-Dashboard # Change to your actual path
echo git pull git@github.com:JebediahMilkshake/HAPi-Dashboard.git
/usr/bin/python3 app.py &
