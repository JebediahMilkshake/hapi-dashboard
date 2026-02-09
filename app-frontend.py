#!/usr/bin/env python3
"""
HAPi Dashboard Frontend - Firefox Display
Connects to a remote Flask backend and displays dashboard on connected TV
Optimized for Pi Zero 2 W with minimal memory footprint (more efficient than PyWebView)
"""

import subprocess
import sys
import time
import argparse
import os
import signal

def main():
    parser = argparse.ArgumentParser(description='HAPi Dashboard Frontend (Firefox)')
    parser.add_argument('--url', default='http://localhost:5000', 
                       help='Backend URL (default: http://localhost:5000)')
    parser.add_argument('--kiosk', action='store_true', default=True,
                       help='Run in kiosk mode (default: True)')
    
    args = parser.parse_args()
    
    print(f"[HAPi-Dashboard Firefox Frontend] Connecting to {args.url}")
    print("[HAPi-Dashboard Firefox Frontend] Launching Firefox...")
    
    # Check if Firefox is installed
    result = subprocess.run(['which', 'firefox'], capture_output=True)
    if result.returncode != 0:
        print("[HAPi-Dashboard Firefox Frontend] ERROR: Firefox not installed")
        print("Install with: sudo apt install -y firefox-esr")
        sys.exit(1)
    
    # Firefox configuration for minimal memory and kiosk mode
    firefox_args = [
        'firefox',
        '--new-instance',
        '--profile', '/tmp/hapi-dashboard-firefox',
    ]
    
    if args.kiosk:
        firefox_args.append('--kiosk')
    
    firefox_args.append(args.url)
    
    try:
        print("[HAPi-Dashboard Firefox Frontend] Starting Firefox...")
        process = subprocess.Popen(firefox_args)
        
        # Keep running until Firefox closes
        process.wait()
        
    except KeyboardInterrupt:
        print("\n[HAPi-Dashboard Firefox Frontend] Shutting down...")
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
    except Exception as e:
        print(f"[HAPi-Dashboard Firefox Frontend] ERROR: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
