# Audio Files

Copy all audio files from the parent directory to this folder:

## Required Files

- background.mp3
- breathing.mp3
- crash_2.mp3
- fuel_up.mp3
- game_over.mp3
- main_engine.mp3
- pump_reset.mp3
- riser.mp3
- rotation_engine.mp3
- vessel_startup.mp3

## How to Copy

### Windows (Command Prompt):
```cmd
copy ..\..\*.mp3 .
```

### macOS/Linux (Terminal):
```bash
cp ../../*.mp3 .
```

### Or run the setup script:
- Windows: Run `setup.bat` in the ios-app-store folder
- macOS: Run `./setup.sh` in the ios-app-store folder

## Audio Format Notes

- MP3 format is supported on iOS
- Files should be reasonable size for mobile (current files are fine)
- All audio paths in the game are relative (audio/filename.mp3)
