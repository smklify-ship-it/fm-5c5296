@echo off
rem Open the map on this PC (http://localhost:4173). Close this window to stop.
setlocal
cd /d "%~dp0web"
where pnpm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] pnpm is not installed. Install Node.js, then: npm install -g pnpm
  pause
  exit /b 1
)
if not exist node_modules call pnpm install --frozen-lockfile
call pnpm build
if errorlevel 1 (
  echo [ERROR] Build failed. Read the message above.
  pause
  exit /b 1
)
call pnpm preview --port 4173 --open
pause
