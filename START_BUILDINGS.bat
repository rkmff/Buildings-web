@echo off
rem Startet Buildings im Netzwerk auf Port 2912.
rem Erwartet die portable Python-Laufzeit unter runtime\python (wie bisher)
rem und die gebaute Oberflaeche unter frontend\dist.
cd /d "%~dp0"
set BUILDINGS_ROOT=%~dp0
if exist runtime\python\python.exe (
  runtime\python\python.exe backend\serve.py
) else (
  python backend\serve.py
)
