@echo off
rem Testbetrieb der neuen Oberflaeche auf Port 2913, die alte App auf 2912 laeuft weiter.
rem Erwartet runtime\python und data\ (Kopie!) in diesem Ordner.
cd /d "%~dp0"
set BUILDINGS_ROOT=%~dp0
set BUILDINGS_PORT=2913
if exist runtime\python\python.exe (
  runtime\python\python.exe backend\serve.py
) else (
  python backend\serve.py
)
pause
