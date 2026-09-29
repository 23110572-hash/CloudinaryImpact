@echo off
title Cloudinary Impact Platform Launcher

echo ======================================================================
echo           Cloudinary Impact ^& Sustainability Platform
echo ======================================================================
echo.

cd /d "%~dp0"

REM --- 1. Detect Python Executable ---
set "PYTHON_CMD="

if exist "%~dp0backend\.venv\Scripts\python.exe" (
    set "PYTHON_CMD=%~dp0backend\.venv\Scripts\python.exe"
    echo [*] Using backend virtual environment: backend\.venv
)

if not defined PYTHON_CMD (
    if exist "%~dp0.venv\Scripts\python.exe" (
        set "PYTHON_CMD=%~dp0.venv\Scripts\python.exe"
        echo [*] Using workspace virtual environment: .venv
    )
)

if not defined PYTHON_CMD (
    if exist "%~dp0backend\venv\Scripts\python.exe" (
        set "PYTHON_CMD=%~dp0backend\venv\Scripts\python.exe"
        echo [*] Using backend virtual environment: backend\venv
    )
)

if not defined PYTHON_CMD (
    python3 --version >nul 2>&1
    if not errorlevel 1 (
        set "PYTHON_CMD=python3"
        echo [*] Using Python 3: python3
    )
)

if not defined PYTHON_CMD (
    python --version >nul 2>&1
    if not errorlevel 1 (
        set "PYTHON_CMD=python"
        echo [*] Using system Python
    )
)

if not defined PYTHON_CMD (
    if exist "%LOCALAPPDATA%\Python\bin\python.exe" (
        set "PYTHON_CMD=%LOCALAPPDATA%\Python\bin\python.exe"
        echo [*] Using Python at %LOCALAPPDATA%\Python\bin\python.exe
    )
)

if not defined PYTHON_CMD (
    if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
        set "PYTHON_CMD=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
        echo [*] Using Python at %LOCALAPPDATA%\Programs\Python\Python312\python.exe
    )
)

if not defined PYTHON_CMD (
    py --version >nul 2>&1
    if not errorlevel 1 (
        set "PYTHON_CMD=py"
        echo [*] Using py launcher
    )
)

if not defined PYTHON_CMD (
    echo [ERROR] Python was not found on your system!
    echo Please ensure Python is installed and added to PATH.
    pause
    exit /b 1
)

echo [*] Python verified:
"%PYTHON_CMD%" --version
echo.

REM --- 2. Verify Node.js & npm ---
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js was not found in PATH!
    echo Please install Node.js from https://nodejs.org/ to run the frontend.
    pause
    exit /b 1
)

echo [*] Node.js verified:
node --version
echo.

REM Check if frontend node_modules exists
if not exist "%~dp0frontend\node_modules" (
    echo [*] Installing frontend dependencies in frontend\node_modules ...
    cd /d "%~dp0frontend"
    call npm install
    cd /d "%~dp0"
    echo.
)

REM --- 3. Launch Backend Server in its own window ---
echo [*] Starting FastAPI Backend on http://localhost:8000 ...
start "Cloudinary Impact - Backend Server (:8000)" cmd /k "cd /d "%~dp0backend" && echo Starting Backend Server on http://localhost:8000 ... && "%PYTHON_CMD%" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"

REM --- 4. Launch Frontend Vite Server in its own window ---
echo [*] Starting Vite Frontend on http://localhost:3000 ...
start "Cloudinary Impact - Frontend Server (:3000)" cmd /k "cd /d "%~dp0frontend" && echo Starting Frontend Server on http://localhost:3000 ... && npm run dev"

REM --- 5. Wait for servers to initialize ---
echo [*] Waiting for services to initialize...
ping -n 5 127.0.0.1 >nul 2>&1

REM --- 6. Locate Chrome and open frontend and backend ---
echo [*] Opening Google Chrome...
set "CHROME_CMD="

if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "CHROME_CMD=C:\Program Files\Google\Chrome\Application\chrome.exe"
)

if not defined CHROME_CMD (
    if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
        set "CHROME_CMD=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    )
)

if not defined CHROME_CMD (
    if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
        set "CHROME_CMD=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
    )
)

if defined CHROME_CMD (
    start "" "%CHROME_CMD%" "http://localhost:3000" "http://localhost:8000/docs"
) else (
    start chrome "http://localhost:3000" "http://localhost:8000/docs" 2>nul || (
        start http://localhost:3000
        start http://localhost:8000/docs
    )
)

echo.
echo ======================================================================
echo  Cloudinary Impact Platform is now running!
echo  - Frontend Web UI:    http://localhost:3000
echo  - Backend API Docs:   http://localhost:8000/docs
echo  - Backend Health:     http://localhost:8000/api/health
echo ======================================================================
echo.
echo Backend and Frontend have been launched in separate console windows.
echo Keep those windows open while you are developing or using the app.
echo You may close this launcher window now.
echo.
pause
