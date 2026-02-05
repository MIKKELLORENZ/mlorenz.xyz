#!/bin/bash
# Moon Lander iOS App Store - Setup Script for macOS
# Run this script after transferring to macOS

echo "=========================================="
echo "Moon Lander iOS App Store Setup"
echo "=========================================="
echo ""

# Create necessary directories
echo "Creating directories..."
mkdir -p www/audio
mkdir -p www/icons
echo "Done."
echo ""

# Copy audio files from parent directory
echo "Copying audio files..."
cp ../*.mp3 www/audio/ 2>/dev/null
if [ $? -eq 0 ]; then
    echo "Audio files copied successfully."
else
    echo "Warning: Could not copy audio files. Please copy them manually."
fi
echo ""

# Check if npm is installed
echo "Checking for npm..."
if command -v npm &> /dev/null; then
    echo "npm found."
    echo ""
    echo "Installing dependencies..."
    npm install
    echo ""
    
    echo "Adding iOS platform..."
    npx cap add ios
    
    echo ""
    echo "Syncing web assets to iOS..."
    npx cap copy ios
    npx cap sync ios
    
    echo ""
    echo "=========================================="
    echo "Setup Complete!"
    echo "=========================================="
    echo ""
    echo "Opening Xcode..."
    npx cap open ios
else
    echo "Warning: npm not found. Please install Node.js first."
    echo ""
    echo "Install Node.js from: https://nodejs.org/"
    echo "Then run this script again."
fi

echo ""
echo "Next steps:"
echo "1. Generate app icons and place them in www/icons/"
echo "   (Use https://appicon.co/ to generate all sizes)"
echo ""
echo "2. In Xcode:"
echo "   - Set your development team"
echo "   - Configure app icons in Assets.xcassets"
echo "   - Build and run on simulator or device"
echo ""
echo "See README.md for full instructions."
