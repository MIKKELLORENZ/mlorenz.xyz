# 🛍️ Mall Walk '92 - A Multiplayer Vaporwave Experience

A nostalgic 3D mall simulator inspired by 90s shopping malls and vaporwave aesthetics. Walk through a beautifully rendered two-story mall complete with neon lights, palm trees, water fountains, and iconic 90s stores. **Now with multiplayer support!**

## ✨ Features

- **Multiplayer Chat**: See other visitors walking around and talk to them with push-to-talk voice chat
- **Immersive 3D Environment**: Full first-person exploration of a detailed mall
- **Vaporwave Aesthetic**: Neon colors, chrome accents, and dreamy pink/blue lighting
- **Iconic 90s Stores**: Sam Goody, Blockbuster, The Gap, Spencer's, Orange Julius, and more
- **Ambient Details**: 
  - Indoor palm trees with swaying fronds
  - Central water fountain with animated water jets
  - Geometric floor patterns
  - Abstract 80s/90s sculptures
  - Glass skylights with gradient sky
  - Animated neon signs
- **Spatial Audio System**: 4 distinct music zones that get louder as you approach
- **Dynamic HUD**: Mall name, simulated time, player count, and "Now Playing" display
- **Retro Voice Chat**: Low bitrate audio for that authentic 90s internet feel

## 🎮 Controls

### Desktop Controls

| Key | Action |
|-----|--------|
| **W / ↑** | Move forward |
| **S / ↓** | Move backward |
| **A / ←** | Strafe left |
| **D / →** | Strafe right |
| **Mouse** | Look around |
| **Click** | Lock mouse for immersion |
| **Hold E** | Push-to-talk (voice chat) |
| **N** | Toggle day/night mode |
| **ESC** | Pause / Release mouse |
| **M** | Toggle mute |

### Mobile Controls

| Control | Action |
|---------|--------|
| **Left Joystick** | Move around |
| **Swipe Right Side** | Look around / rotate camera |
| **Mic Button (tap)** | Hold to talk |
| **Mic Button (slide up)** | Lock microphone on |
| **🌙 Button** | Toggle day/night mode |

## 🚀 Running the Simulation

### Quick Start (Multiplayer)

The game now includes a combined HTTP + WebSocket server. Just run:

```bash
cd mall_walk
npm install    # First time only
npm start
```

Then open **http://localhost:3000** in your browser. That's it!

Open multiple browser tabs to test multiplayer.

### Single Player Mode (Alternative)

If you just want to explore without multiplayer, you can use any static file server:

**Python:**
```bash
python -m http.server 8080
```

**Node.js:**
```bash
npx http-server . -p 8080
```

**VS Code:** Install "Live Server" extension and right-click `index.html` → "Open with Live Server"

Note: Without the multiplayer server, you'll still be able to walk around, but won't see other players.

## 🎙️ Voice Chat Testing

Click the **🎧 MIC TEST** button in the top-right corner to hear your own voice. This confirms:
- Your microphone is working
- Audio is being captured with the retro low-bitrate effect
- The voice system is functional

When the test is active, speak into your microphone and you'll hear yourself with a slight delay and the lo-fi audio effect.

### Custom Server URL
You can specify a custom server by adding `?server=ws://your-server:3000` to the URL.

## 🔊 Adding Audio (Optional)

The simulation works without audio files. To add ambient sounds and music:

1. Create the following audio files in `assets/sounds/`:

| Filename | Description | Plays At |
|----------|-------------|----------|
| `smooth_jazz.mp3` | Soft jazz/muzak | Sam Goody |
| `arcade_sounds.mp3` | Chiptune/game sounds | Arcade |
| `80s_pop.mp3` | Upbeat 80s pop music | Orange Julius |
| `rock_music.mp3` | Rock classics | Musicland |
| `water_fountain.mp3` | Water ambience | Central fountain |
| `mall_ambience.mp3` | General mall sounds | Everywhere (quiet) |

2. Audio is spatial - it gets louder as you approach the source!

**Note**: The game won't crash if audio files are missing. Sources without audio will simply be silent.

## 📁 Project Structure

```
mall_walk/
├── index.html          # Main entry point
├── css/
│   └── styles.css      # UI styling, loading screen, HUD
├── js/
│   ├── main.js         # Game initialization & loop
│   ├── scene.js        # Three.js scene, lighting, skylight
│   ├── mall.js         # Mall structure (floors, walls, escalators)
│   ├── decorations.js  # Palm trees, fountain, planters, sculptures
│   ├── stores.js       # Storefronts with neon signs
│   ├── player.js       # First-person controls
│   └── audio.js        # Spatial audio system
└── assets/
    └── sounds/         # Audio files (optional)
```

## 🎨 Customization

### Adding New Stores
Edit `js/stores.js` and add entries to the stores array:
```javascript
{ name: 'YOUR STORE', x: -34, z: 10, side: 'left', floor: 0, color: COLORS.neonPink }
```

### Changing Colors
Edit the color palette in `js/scene.js`:
```javascript
export const COLORS = {
    neonPink: 0xff71ce,
    neonBlue: 0x01cdfe,
    // ... add or modify colors
};
```

### Adding Decorations
Add new decoration methods in `js/decorations.js` and call them from `build()`.

## 🛠️ Technical Details

- **3D Engine**: Three.js r160
- **Post-Processing**: Unreal Bloom for neon glow effects
- **Audio**: Web Audio API with spatial positioning
- **Controls**: PointerLockControls for FPS-style movement

## 📝 License

MIT License - Feel free to modify and use for your own projects!

## 🌴 Enjoy the nostalgia!

*"It's always a beautiful day at the mall..."*
