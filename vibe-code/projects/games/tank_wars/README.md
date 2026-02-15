# Tank Wars

A lightweight, browser-based artillery game inspired by classic turn-based tank games.

## Features

- **Modes**
  - Player vs Player (local hot-seat)
  - Player vs AI (trajectory simulation-based AI)
- **Core Mechanics**
  - Adjustable angle and power
  - Random wind that is **locked for the whole match** (rerolls only on a new game)
  - Destructible terrain
  - Score-based match (hits award points; first to target score wins)
  - Draw support when both players run out of weapons with equal points
- **Pre-Game Draft**
  - Before battle, players alternate picks from all weapons
  - Left/right modal previews show each player's allocated picks in real time
  - Chosen weapons become clickable icons in the battle weapon bar
  - Each weapon is one-time use; once fired, it is removed
- **Weapons (16)**
  1. Cannon Ball
  2. Baby Missile
  3. Big Shot
  4. 3 Shot
  5. Shotgun
  6. Bouncer
  7. Ground Hog
  8. Drill
  9. Homing Missile
  10. Air Strike
  11. Dirt Slinger
  12. Dirt Mover
  13. Napalm
  14. Laser
  15. Roller
  16. MIRV
- **Audio Resilience**
  - Optional sound files are loaded defensively.
  - Missing sound files never crash or block gameplay.
  - Built-in mute/unmute control in the top bar.

## Controls

- **Aim / Power**
  - Hold `W/S` or `Arrow Up/Down`: smooth angle adjustment
  - Hold `A/D` or `Arrow Left/Right`: smooth power adjustment
  - Hold on-screen angle/power buttons for continuous fine-grained control
- **Weapon Select**
  - Click weapon icons in the weapon bar
- **Fire**
  - `Space` or `FIRE` button

## Run Locally

You can open `index.html` directly from disk for offline testing.

You can also run a local static server:

```bash
# Python
python -m http.server 8080
```

Then open:

`http://localhost:8080/games/tank_wars/`

## Browser Support

- Modern Chromium, Firefox, and Safari browsers are supported.
- The welcome screen and UI avoid bleeding-edge canvas APIs for broader compatibility.
- Touch controls are enabled for mobile play.

## Deploy to GitHub Pages

This project is static HTML/CSS/JS and deploys directly on GitHub Pages without build tooling.

## Optional Sounds

If desired, add these files in `sounds/` under this folder:

- `sounds/fire.wav`
- `sounds/explosion.wav`
- `sounds/win.wav`
- `sounds/click.wav`
- `sounds/zap.wav`

If any are missing, the game still runs smoothly.
