# App Icons for Moon Lander iOS App

This folder should contain app icons in the following sizes:

## Required Sizes

| Filename | Size | Usage |
|----------|------|-------|
| icon-20.png | 20x20 | iPad Notifications (1x) |
| icon-20@2x.png | 40x40 | iPhone/iPad Notifications (2x) |
| icon-20@3x.png | 60x60 | iPhone Notifications (3x) |
| icon-29.png | 29x29 | iPad Settings (1x) |
| icon-29@2x.png | 58x58 | iPhone/iPad Settings (2x) |
| icon-29@3x.png | 87x87 | iPhone Settings (3x) |
| icon-40.png | 40x40 | iPad Spotlight (1x) |
| icon-40@2x.png | 80x80 | iPhone/iPad Spotlight (2x) |
| icon-40@3x.png | 120x120 | iPhone Spotlight (3x) |
| icon-60@2x.png | 120x120 | iPhone App Icon (2x) |
| icon-60@3x.png | 180x180 | iPhone App Icon (3x) |
| icon-76.png | 76x76 | iPad App Icon (1x) |
| icon-76@2x.png | 152x152 | iPad App Icon (2x) |
| icon-83.5@2x.png | 167x167 | iPad Pro App Icon (2x) |
| icon-1024.png | 1024x1024 | App Store |

## Simplified Set (Minimum Required)

For quick setup, you can use these simplified filenames:

- icon-40.png (40x40)
- icon-60.png (60x60)
- icon-76.png (76x76)
- icon-120.png (120x120)
- icon-152.png (152x152)
- icon-167.png (167x167)
- icon-180.png (180x180)
- icon-1024.png (1024x1024)

## Design Guidelines

### Requirements:
- PNG format
- No transparency (use solid background)
- No rounded corners (iOS adds them automatically)
- Square aspect ratio

### Recommended Design:
- Use a deep blue/black space background (#000022 or similar)
- Feature the lander spacecraft prominently
- Include a moon or lunar surface element
- Keep design simple and recognizable at small sizes

### Colors from the Game:
- Space Black: #000000 to #0a0a2e
- Lander Silver: #F0F0F8 to #D0D0D8
- Flame Orange: #FF8800 to #FFCC44
- Platform Gold: #FFD700
- Earth Blue: #3366BB

## Tools for Generating Icons

1. **App Icon Generator** (Recommended)
   https://appicon.co/
   - Upload one 1024x1024 image
   - Downloads all required sizes

2. **MakeAppIcon**
   https://makeappicon.com/

3. **Figma/Sketch**
   - Create at 1024x1024
   - Export at required sizes

4. **Command Line (ImageMagick)**
   ```bash
   # Install ImageMagick first, then:
   convert icon-1024.png -resize 180x180 icon-180.png
   convert icon-1024.png -resize 167x167 icon-167.png
   # ... etc for each size
   ```

## After Creating Icons

1. Place all icon files in this folder
2. Run `npx cap sync ios`
3. In Xcode, drag icons to `Assets.xcassets > AppIcon`

Or let Xcode generate them:
1. Open Xcode
2. Go to Assets.xcassets > AppIcon
3. Click the source file slot
4. Drag your 1024x1024 icon
5. Xcode generates all sizes automatically
