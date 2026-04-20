@echo off
REM Moon Lander iOS App Store - Setup Script for Windows
REM Run this script to prepare the project before transferring to macOS

echo ==========================================
echo Moon Lander iOS App Store Setup
echo ==========================================
echo.

REM Create necessary directories
echo Creating directories...
if not exist "www\audio" mkdir "www\audio"
if not exist "www\icons" mkdir "www\icons"
echo Done.
echo.

REM Copy audio files from parent directory
echo Copying audio files...
copy "..\*.mp3" "www\audio\" > nul 2>&1
if %errorlevel% equ 0 (
    echo Audio files copied successfully.
) else (
    echo Warning: Could not copy audio files. Please copy them manually.
)
echo.

REM Check if npm is installed
echo Checking for npm...
where npm > nul 2>&1
if %errorlevel% equ 0 (
    echo npm found.
    echo.
    echo Installing dependencies...
    call npm install
    echo.
) else (
    echo Warning: npm not found. Please install Node.js and run 'npm install' manually.
)

echo ==========================================
echo Setup Complete!
echo ==========================================
echo.
echo Next steps:
echo 1. Generate app icons and place them in www\icons\
echo    (Use https://appicon.co/ to generate all sizes)
echo.
echo 2. Transfer this folder to a Mac for Xcode setup
echo.
echo 3. On macOS, run these commands:
echo    npm install
echo    npx cap add ios
echo    npx cap copy ios
echo    npx cap sync ios
echo    npx cap open ios
echo.
echo See README.md for full instructions.
echo.
pause
