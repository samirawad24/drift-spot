@echo off
cd /d "%~dp0"
start "" http://localhost:8125
python -m http.server 8125 --bind 0.0.0.0
