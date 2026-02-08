#!/bin/bash
cd /home/pi/Documents/HAPi-Dashboard # Change to your actual path
git pull origin
/usr/bin/python3 app.py > dashboard.log  2>&1 &
