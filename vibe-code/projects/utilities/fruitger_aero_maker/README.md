# Frutiger Aero Beat Maker

Lightweight browser beat & pattern arranger inspired by playful Nintendo-era UI aesthetics.

## Features
- 5 tracks: Drums, Bass, Chords, Lead 1, Lead 2
- Progressive pattern library (1/2/3 evolution tiers) + legacy set
- 32-step internal resolution with automatic pattern expansion
- Per-track: volume, reverb send, delay send, mute & solo
- Global: tempo, swing, bars (4–16), scale root selector, metronome
- Randomize generator (weighted early simple / late advanced)
- Save songs to localStorage, load & delete
- Export / Import JSON for sharing
- Click timeline area to jump during playback
- Spacebar shortcut for Play / Pause
- Inline quick pattern picker + full modal with descriptions
- Help modal summarizing shortcuts

## Usage
1. Select tempo, swing and number of bars.
2. Click cells in any track to assign a pattern (right-click to clear).
3. Use Randomize to auto-populate an arrangement.
4. Adjust per‑track effect sends & volume; Mute / Solo as needed.
5. Press Play (or Spacebar). Click within the track area ruler to reposition.
6. Save songs locally or Export as JSON. Import later to restore.

## File Structure
- index.html: UI layout
- styles.css: Frutiger Aero themed styling
- app.js: Core logic (audio synthesis via Web Audio API, sequencing, pattern management)

## Export Format
```json
{
  "tempo": 120,
  "volume": 0.7,
  "swing": 0.12,
  "bars": 8,
  "scale": "major",
  "metronome": true,
  "patterns": { "drums_0": "Mii Beat - 1", "bass_0": "eShop - 1" }
}
```

## Notes
- Audio uses simple synthesized osc / noise sources for minimal footprint.
- Swing offsets every 2nd 32nd step (audio only; visuals stay grid-aligned).
- Pattern expansion doubles rhythmic density while preserving musical intent.

## Roadmap Ideas (Post Release)
- Pattern editing (custom user patterns)
- Multiple pattern lanes per track
- Export to WAV / stem rendering
- Additional scale modes & chord generation

Enjoy creating! 🛸🎵
