# Moon Lander - iOS App Store Submission Guide

## Overview
This folder contains a fully configured iOS-ready version of the Moon Lander game using Capacitor for native iOS app deployment.

## Project Structure
```
ios-app-store/
├── package.json              # NPM dependencies and scripts
├── capacitor.config.ts       # Capacitor configuration
├── www/                      # Web assets (your game)
│   ├── index.html           # Main HTML entry point
│   ├── css/
│   │   ├── app.css          # iOS-specific styles
│   │   └── moon_lander.css  # Game styles
│   ├── js/
│   │   ├── capacitor.js     # Capacitor runtime
│   │   └── game.js          # Game logic with Capacitor integration
│   ├── audio/               # Sound files (copy from parent)
│   └── icons/               # App icons (generate these)
├── ios/                     # Generated iOS project (after cap add ios)
└── README.md                # This file
```

## Prerequisites

1. **macOS** - Required for iOS development
2. **Xcode 15+** - Latest version from App Store
3. **Node.js 18+** - For npm/npx commands
4. **Apple Developer Account** - $99/year for App Store publishing
5. **CocoaPods** - Install via `sudo gem install cocoapods`

## Setup Instructions

### Step 1: Install Dependencies
```bash
cd ios-app-store
npm install
```

### Step 2: Copy Audio Files
Copy all audio files from the parent directory:
```bash
mkdir -p www/audio
cp ../*.mp3 www/audio/
```

### Step 3: Generate App Icons
You need app icons in these sizes for iOS:
- 20x20 (1x, 2x, 3x)
- 29x29 (1x, 2x, 3x)
- 40x40 (1x, 2x, 3x)
- 60x60 (2x, 3x)
- 76x76 (1x, 2x)
- 83.5x83.5 (2x)
- 1024x1024 (App Store)

Create icons and place them in `www/icons/`:
- icon-40.png (40x40)
- icon-60.png (60x60)
- icon-76.png (76x76)
- icon-120.png (120x120)
- icon-152.png (152x152)
- icon-167.png (167x167)
- icon-180.png (180x180)
- icon-1024.png (1024x1024)

**Tip:** Use a tool like [App Icon Generator](https://appicon.co/) to create all sizes from one source image.

### Step 4: Initialize Capacitor
```bash
npx cap init "Moon Lander" "xyz.mlorenz.moonlander" --web-dir www
```

### Step 5: Add iOS Platform
```bash
npx cap add ios
```

### Step 6: Copy Web Assets to iOS
```bash
npx cap copy ios
npx cap sync ios
```

### Step 7: Open in Xcode
```bash
npx cap open ios
```

## Xcode Configuration

### Required Settings in Xcode:

1. **Bundle Identifier**: `xyz.mlorenz.moonlander`
2. **Display Name**: `Moon Lander`
3. **Version**: `1.0.0`
4. **Build**: `1`

### Signing & Capabilities:
1. Select your Team (Apple Developer Account)
2. Enable "Automatically manage signing"
3. Add capabilities:
   - Game Center (optional, for leaderboards)
   - Push Notifications (optional)

### Info.plist Required Keys:
Add these to your Info.plist:
```xml
<key>UIRequiresFullScreen</key>
<true/>
<key>UISupportedInterfaceOrientations</key>
<array>
    <string>UIInterfaceOrientationLandscapeLeft</string>
    <string>UIInterfaceOrientationLandscapeRight</string>
    <string>UIInterfaceOrientationPortrait</string>
    <string>UIInterfaceOrientationPortraitUpsideDown</string>
</array>
<key>UIStatusBarHidden</key>
<true/>
<key>UIViewControllerBasedStatusBarAppearance</key>
<false/>
```

### Launch Screen:
1. Open `ios/App/App/Base.lproj/LaunchScreen.storyboard`
2. Set background color to black (#000000)
3. Add your app logo centered

### App Icons in Xcode:
1. Open `ios/App/App/Assets.xcassets`
2. Click on `AppIcon`
3. Drag your icon files to the appropriate slots

## App Store Connect Setup

### Create App Record:
1. Go to [App Store Connect](https://appstoreconnect.apple.com/)
2. Click "My Apps" → "+" → "New App"
3. Fill in:
   - Platform: iOS
   - Name: Moon Lander
   - Primary Language: English
   - Bundle ID: xyz.mlorenz.moonlander
   - SKU: moonlander-2025

### App Information:
- **Category**: Games → Arcade
- **Age Rating**: 4+ (no objectionable content)
- **Price**: Free (or set pricing)

### App Privacy:
Declare data collection:
- **Data Not Collected** (if you don't use analytics)
- Or specify data types if using Game Center, analytics, etc.

### Screenshots Required:
Capture screenshots on these device sizes:
- 6.7" iPhone (iPhone 15 Pro Max) - Required
- 6.5" iPhone (iPhone 14 Plus) - Required
- 5.5" iPhone (iPhone 8 Plus) - Optional
- 12.9" iPad Pro (3rd gen) - Required for iPad

**Tip:** Use Xcode Simulator to capture screenshots in landscape mode.

### App Description:
```
Navigate your lunar lander through treacherous terrain and land safely on designated platforms. Manage your fuel and oxygen while battling gravity and meteorites.

FEATURES:
• Realistic physics-based gameplay
• Beautiful space visuals with parallax stars
• Multiple landing zones with varying difficulty
• Challenging resource management
• Touch-optimized controls
• Atmospheric sound design

CONTROLS:
▲ Main Thruster - Fight gravity
↺↻ Rotation - Adjust angle
◀▶ Side Thrusters - Lateral movement

Land safely, collect points, and survive as long as you can in this retro-inspired lunar adventure!
```

### Keywords:
`lunar lander, moon landing, space game, arcade, retro, physics, simulation, apollo`

## Building for App Store

### Archive Build:
1. In Xcode, select "Any iOS Device" as destination
2. Product → Archive
3. Wait for build to complete
4. Organizer window opens automatically

### Submit to App Store:
1. Click "Distribute App"
2. Select "App Store Connect"
3. Click "Upload"
4. Wait for processing
5. Go to App Store Connect to submit for review

## Testing

### TestFlight (Beta Testing):
1. Archive and upload build
2. In App Store Connect, go to TestFlight
3. Add internal testers (up to 100)
4. Add external testers (up to 10,000)
5. Submit for TestFlight review

### Simulator Testing:
```bash
# Build and run in simulator
npx cap run ios --target="iPhone 15 Pro"
```

### Device Testing:
1. Connect iPhone/iPad via USB
2. Select device in Xcode
3. Click Run (▶)

## Common Issues

### Audio Not Playing:
iOS requires user interaction before playing audio. The START MISSION button handles this.

### Safe Area Issues:
The CSS uses `env(safe-area-inset-*)` for proper notch handling.

### Performance Issues:
- Enable Metal rendering in Capacitor config
- Reduce particle count if needed
- Use `requestAnimationFrame` throttling

### Build Errors:
```bash
# Clean and rebuild
cd ios/App
pod deintegrate
pod install
cd ../..
npx cap sync ios
```

## Privacy Policy & Terms

For App Store submission, you need:

1. **Privacy Policy URL** - Host on your website
2. **Terms of Service URL** - Optional but recommended

Sample privacy policy points:
- No personal data collected
- High scores stored locally on device
- No third-party analytics
- No ads

## Support

For issues:
- Capacitor Docs: https://capacitorjs.com/docs
- iOS Dev Docs: https://developer.apple.com/documentation/
- App Store Guidelines: https://developer.apple.com/app-store/review/guidelines/

## Version History

- v1.0.0 - Initial App Store release

---

**Author:** Mikkel Vind Lorenz, 2025
**Bundle ID:** xyz.mlorenz.moonlander
