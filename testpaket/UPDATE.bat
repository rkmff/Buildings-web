@echo off
rem Holt die neueste Testversion von GitHub und ersetzt nur das Programm.
rem Die Ordner data, config und runtime bleiben unveraendert.
setlocal
cd /d "%~dp0"
set "ZIEL=%~dp0"
set "URL=https://github.com/rkmff/Buildings-web/releases/download/testpaket/Buildings-neu-Test.zip"
set "TMPZIP=%TEMP%\Buildings-neu-Test.zip"
set "TMPDIR=%TEMP%\Buildings-neu-Update"
set "NEU=%TMPDIR%\Buildings-neu"

echo Lade die neueste Testversion ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '%URL%' -OutFile '%TMPZIP%'"
if errorlevel 1 (
  echo Download fehlgeschlagen. Bitte Internetzugang des Servers pruefen.
  pause
  exit /b 1
)
if exist "%TMPDIR%" rmdir /s /q "%TMPDIR%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Force -LiteralPath '%TMPZIP%' -DestinationPath '%TMPDIR%'"
if not exist "%NEU%\backend\serve.py" (
  echo Das heruntergeladene Paket ist unvollstaendig. Es wurde nichts geaendert.
  pause
  exit /b 1
)

rem Python-Pakete nur nachinstallieren, wenn sich die Liste geaendert hat
set "PAKETE="
fc /b "%ZIEL%backend\requirements.txt" "%NEU%\backend\requirements.txt" >nul 2>&1 || set "PAKETE=1"

echo Beende den laufenden Testserver auf Port 2913 ...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":2913 .*LISTENING"') do taskkill /pid %%p /f >nul 2>&1
timeout /t 2 /nobreak >nul

echo Ersetze die Programmdateien ...
robocopy "%NEU%\backend" "%ZIEL%backend" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto fehler
robocopy "%NEU%\frontend" "%ZIEL%frontend" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto fehler
for %%f in (TEST_STARTEN.bat LIESMICH.txt VERSION.txt) do copy /y "%NEU%\%%f" "%ZIEL%%%f" >nul

if defined PAKETE if exist runtime\python\python.exe (
  echo Installiere neue Python-Pakete ...
  runtime\python\python.exe -m pip install -q -r backend\requirements.txt || echo Hinweis: Pakete konnten nicht installiert werden, siehe LIESMICH.txt.
)

echo.
type VERSION.txt
echo.
echo Starte die Testversion ...
start "Buildings Test (Port 2913)" "%ZIEL%TEST_STARTEN.bat"

rem Zum Schluss sich selbst aktualisieren (der Block wird vor dem Kopieren komplett gelesen)
(
  copy /y "%NEU%\UPDATE.bat" "%~f0" >nul
  echo Fertig. Dieses Fenster schliesst sich in 5 Sekunden.
  timeout /t 5 >nul
  exit /b 0
)

:fehler
echo Beim Kopieren ist ein Fehler aufgetreten. Ist noch ein Fenster der Testversion offen?
pause
exit /b 1
