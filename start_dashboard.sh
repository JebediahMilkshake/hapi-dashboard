#!/bin/bash
cd ~
unclutter -idle 5 -root &
cd /home/pi/Documents/HAPi-Dashboard # Change to your actual path
git pull origin
python3 app.py &
