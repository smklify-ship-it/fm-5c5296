@echo off
rem Build vegetation tiles for one prefecture. Usage: build-pref.bat gunma
rem Output: web\public\data\<key>.pmtiles, <key>_kokuyu.pmtiles, prefs.json
rem Prefectures are listed in pipeline\prefs_config.json
setlocal
set PYTHONUTF8=1
cd /d "%~dp0pipeline"
where uv >nul 2>nul
if errorlevel 1 (
  echo [ERROR] uv is not installed. See https://docs.astral.sh/uv/
  pause
  exit /b 1
)
set "PREF=%~1"
if "%PREF%"=="" set /p "PREF=Prefecture key (gunma / nagano): "
uv run python -m vegmap.build %PREF%
if errorlevel 1 (
  echo.
  echo [ERROR] Build failed. Read the message above.
  pause
  exit /b 1
)
echo.
echo Done. Files are in web\public\data
pause
