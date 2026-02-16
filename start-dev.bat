@echo off
echo ========================================
echo   CardVoice v0.2 - Starting...
echo ========================================
echo.

:: Start Node.js backend
echo Starting backend on port 8000...
cd /d "%~dp0server"
start "CardVoice Backend" cmd /k "node index.js --port 8000"

:: Wait for backend
timeout /t 2 /nobreak > nul

:: Start frontend
echo Starting frontend on port 3000...
cd /d "%~dp0frontend"
start "CardVoice Frontend" cmd /k "npm run dev"

echo.
echo CardVoice is starting!
echo   Backend: http://localhost:8000
echo   Frontend: http://localhost:3000
echo.
echo Close both terminal windows to stop.
pause
