# Frutiger Aero Beat Maker

A whimsical browser-based beat maker inspired by Nintendo Wii/DS-era aesthetics. Features floating bubbles, drifting clouds, and that signature Frutiger Aero glass morphism look.

## Features

### Audio Engine
- **5 tracks**: Drums, Bass, Chords, Lead 1, Lead 2
- **Web Audio API** synthesis with proper envelopes
- **Effects**: Global reverb (convolver) and delay with feedback
- **Per-track controls**: Volume, reverb send, delay send, mute & solo

### Pattern System
- **Progressive pattern library**: Tier 1/2/3 patterns that evolve in complexity
- **Pattern preview**: Hover over patterns to preview before selecting
- **32-step resolution** with automatic pattern expansion
- **Pattern descriptions**: Each pattern includes a description and tier indicator

### Arrangement
- **4-16 bars** configurable arrangement
- **Tempo, swing, key, and scale** controls
- **Smart randomizer**: Weighted to use simpler patterns early, complex later
- **Visual playhead** with playing cell highlighting

### Save/Export
- **LocalStorage** song save/load/delete
- **JSON export/import** for sharing
- **WAV export** for rendered audio files

### UI/UX
- **Frutiger Aero aesthetic**: Glass panels, floating bubbles, drifting clouds
- **Collapsible panels** for a cleaner workspace
- **Undo/redo** with history (Ctrl+Z / Ctrl+Y)
- **Keyboard shortcuts** (Space: play/pause, Ctrl+S: save, ?: help)
- **Toast notifications** for user feedback
- **Responsive design** for different screen sizes

## Keyboard Shortcuts
| Key | Action |
|-----|--------|
| Space | Play / Pause |
| Ctrl+Z | Undo |
| Ctrl+Y | Redo |
| Ctrl+S | Save song |
| ? | Show help |

## Usage
1. Set tempo, swing, and number of bars in the transport panel
2. Click cells in the arrangement grid to assign patterns
3. Use "Randomize" for instant arrangements
4. Adjust per-track effects in the collapsible Effects panel
5. Save songs locally or export as JSON/WAV

## File Structure
```
fruitger_aero_maker/
├── index.html   # Main app structure
├── styles.css   # Frutiger Aero styling
├── app.js       # Audio engine & UI logic
└── README.md    # Documentation
```

## Technical Notes
- Audio uses synthesized oscillators and noise for a small footprint
- WAV export uses OfflineAudioContext for offline rendering
- Patterns auto-expand from 16→32 steps preserving musical intent
- Swing offsets every other 32nd step (audio only, visuals stay grid-aligned)
- Pattern editing (custom user patterns)
- Multiple pattern lanes per track
- Export to WAV / stem rendering
- Additional scale modes & chord generation

Enjoy creating! 🛸🎵
