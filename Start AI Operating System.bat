@echo off
setlocal EnableExtensions
title AI Operating System Launcher
cd /d "%~dp0"

echo.
echo  AI Operating System
echo  ===================
echo.

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js and npm are not available in PATH.
  pause
  exit /b 1
)

where tailscale.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: Tailscale is not installed or is not available in PATH.
  pause
  exit /b 1
)

tailscale status >nul 2>&1
if errorlevel 1 (
  echo ERROR: Tailscale is not connected. Open Tailscale and sign in first.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [1/4] Installing dependencies...
  call npm install
  if errorlevel 1 goto :failed
) else (
  echo [1/4] Dependencies are installed.
)

echo [2/4] Building the production application...
call npm run build
if errorlevel 1 goto :failed

echo [3/4] Starting the private local server...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; $logDir=Join-Path $env:LOCALAPPDATA 'AI-Operating-System\logs'; New-Item -ItemType Directory -Force -Path $logDir | Out-Null; $listener=Get-NetTCPConnection -State Listen -LocalPort 4317 -ErrorAction SilentlyContinue; if(-not $listener) { $env:AIOS_HTTPS='1'; $env:AIOS_TRUST_PROXY='loopback'; $process=Start-Process -FilePath 'npm.cmd' -ArgumentList 'start' -WorkingDirectory '%CD%' -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'server.out.log') -RedirectStandardError (Join-Path $logDir 'server.err.log') -PassThru; Set-Content -Path (Join-Path $logDir 'server.pid') -Value $process.Id }"
if errorlevel 1 goto :failed

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$deadline=(Get-Date).AddSeconds(30); do { try { $response=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4317/' -TimeoutSec 2; if($response.StatusCode -eq 200 -and $response.Content -match 'AI Operating System') { exit 0 } } catch {}; Start-Sleep -Milliseconds 500 } while((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
  echo ERROR: The application did not become ready on 127.0.0.1:4317.
  echo Review %%LOCALAPPDATA%%\AI-Operating-System\logs\server.err.log
  pause
  exit /b 1
)

echo [4/4] Connecting Tailscale Serve to the application...
tailscale serve --bg http://127.0.0.1:4317
if errorlevel 1 goto :failed

set "TAILSCALE_URL="
for /f "tokens=1" %%U in ('tailscale serve status ^| findstr /b "https://"') do set "TAILSCALE_URL=%%U"
if not defined TAILSCALE_URL (
  echo ERROR: Tailscale Serve started, but its HTTPS URL could not be read.
  tailscale serve status
  pause
  exit /b 1
)

echo.
echo READY: %TAILSCALE_URL%
echo Owner access: %TAILSCALE_URL%/admin
echo.
start "" "%TAILSCALE_URL%"
exit /b 0

:failed
echo.
echo ERROR: Startup failed. Review the message above and try again.
pause
exit /b 1
