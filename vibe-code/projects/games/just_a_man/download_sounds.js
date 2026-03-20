#!/usr/bin/env node
/**
 * CC0 Sound Downloader for "Just a Man"
 * Downloads free CC0-licensed sounds from GitHub repos,
 * converts OGG/WAV to MP3, and organizes as multiple options per sound slot.
 *
 * Sources: CC0 1.0 Universal licensed packs via
 * https://github.com/lavenderdotpet/CC0-Public-Domain-Sounds
 *
 * Usage: node download_sounds.js
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const AUDIO_DIR = path.resolve(__dirname, '../../shared_assets/audio');
const CANDIDATES_DIR = path.join(AUDIO_DIR, 'candidates');

const REPO_RAW = 'https://raw.githubusercontent.com/lavenderdotpet/CC0-Public-Domain-Sounds/main';

// Helper to build source entries
function src(path, label) {
    const ext = path.split('.').pop().toLowerCase();
    return { src: path, label, ext };
}

// ============================================
// SOUND SLOT -> SOURCE FILE MAPPINGS
// Prioritizing REALISTIC foley and field recordings
// ============================================
const SLOT_SOURCES = {

    // ========== SFX ==========

    sfx_click: [
        src('kenney_uiaudio/Audio/click1.ogg', 'UI Click 1'),
        src('kenney_uiaudio/Audio/click2.ogg', 'UI Click 2'),
        src('kenney_uiaudio/Audio/click3.ogg', 'UI Click 3'),
        src('kenney_uiaudio/Audio/click4.ogg', 'UI Click 4'),
        src('kenney_uiaudio/Audio/click5.ogg', 'UI Click 5'),
        src('kenney_uiaudio/Audio/mouseclick1.ogg', 'Mouse Click'),
        src('bb%20-%20Smol%20Mechanisms%20(May%202021)/Click%20Button%201.wav', 'Real Click Button 1'),
        src('bb%20-%20Smol%20Mechanisms%20(May%202021)/Click%20Button%202.wav', 'Real Click Button 2'),
        src('bb%20-%20Smol%20Mechanisms%20(May%202021)/Click%20Button%203.wav', 'Real Click Button 3'),
    ],

    sfx_cash_register: [
        src('100-CC0-SFX/bell_01.ogg', 'Bell 1 (register ding)'),
        src('100-CC0-SFX/bell_02.ogg', 'Bell 2 (register ding)'),
        src('100-CC0-SFX/bell_03.ogg', 'Bell 3 (register ding)'),
        src('100-CC0-SFX/metal_01.ogg', 'Metal Clank 1'),
        src('100-CC0-SFX/metal_02.ogg', 'Metal Clank 2'),
        src('bb%20-%20Toolbox%20Rummaging%20(Sept%202021)/Metal%20Hinge%201.wav', 'Metal Hinge (drawer)'),
        src('bb%20-%20Toolbox%20Rummaging%20(Sept%202021)/Close%20Drawer%201.wav', 'Close Drawer 1'),
        src('bb%20-%20Toolbox%20Rummaging%20(Sept%202021)/Close%20Drawer%202.wav', 'Close Drawer 2'),
    ],

    sfx_coin: [
        src('kenney_rpgaudio/Audio/handleCoins.ogg', 'Handle Coins 1 (realistic)'),
        src('kenney_rpgaudio/Audio/handleCoins2.ogg', 'Handle Coins 2 (realistic)'),
        src('kenney_casinoaudio/Audio/chipLay1.ogg', 'Chip Lay 1'),
        src('kenney_casinoaudio/Audio/chipLay2.ogg', 'Chip Lay 2'),
        src('kenney_casinoaudio/Audio/chipLay3.ogg', 'Chip Lay 3'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Shaking%20Box%20of%20Screws%201.wav', 'Shaking coins/screws'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Metal%20Rattling%201.wav', 'Metal Rattling (coins)'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Metal%20Rattling%202.wav', 'Metal Rattling 2'),
    ],

    sfx_cash_gain: [
        src('100-CC0-SFX/bell_01.ogg', 'Bell ding (ka-ching)'),
        src('100-CC0-SFX/bell_02.ogg', 'Bell 2'),
        src('kenney_interfacesounds/Audio/confirmation_001.ogg', 'Confirmation chime 1'),
        src('kenney_interfacesounds/Audio/confirmation_002.ogg', 'Confirmation chime 2'),
        src('kenney_interfacesounds/Audio/confirmation_003.ogg', 'Confirmation chime 3'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Silverware%20Ting%201.wav', 'Silverware ting (coin clink)'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Silverware%20Ting%202.wav', 'Silverware ting 2'),
    ],

    sfx_cash_lose: [
        src('kenney_interfacesounds/Audio/error_001.ogg', 'Error tone 1'),
        src('kenney_interfacesounds/Audio/error_002.ogg', 'Error tone 2'),
        src('kenney_interfacesounds/Audio/minimize_001.ogg', 'Deflate 1'),
        src('kenney_interfacesounds/Audio/minimize_002.ogg', 'Deflate 2'),
        src('100-CC0-SFX/slam_01.ogg', 'Slam (thud)'),
        src('kenney_digitalaudio/Audio/lowDown.ogg', 'Descending tone'),
    ],

    sfx_dialog_open: [
        src('kenney_interfacesounds/Audio/open_001.ogg', 'Open 1'),
        src('kenney_interfacesounds/Audio/open_002.ogg', 'Open 2'),
        src('kenney_interfacesounds/Audio/open_003.ogg', 'Open 3'),
        src('kenney_interfacesounds/Audio/open_004.ogg', 'Open 4'),
        src('bb%20-%20Books%2C%20Paper%2C%20Writing%20(Jan%202021)/Page%20Turn%201.wav', 'Page Turn 1 (letter unfold)'),
        src('bb%20-%20Books%2C%20Paper%2C%20Writing%20(Jan%202021)/Page%20Turn%202.wav', 'Page Turn 2'),
    ],

    sfx_dialog_choice: [
        src('kenney_interfacesounds/Audio/select_001.ogg', 'Select 1'),
        src('kenney_interfacesounds/Audio/select_002.ogg', 'Select 2'),
        src('kenney_interfacesounds/Audio/select_003.ogg', 'Select 3'),
        src('kenney_interfacesounds/Audio/pluck_001.ogg', 'Pluck 1'),
        src('kenney_interfacesounds/Audio/pluck_002.ogg', 'Pluck 2'),
        src('bb%20-%20Smol%20Mechanisms%20(May%202021)/Click%20Button%204.wav', 'Real Click 4'),
    ],

    sfx_dialog_advance: [
        src('bb%20-%20Books%2C%20Paper%2C%20Writing%20(Jan%202021)/Page%20Turn%201.wav', 'Page Turn 1'),
        src('bb%20-%20Books%2C%20Paper%2C%20Writing%20(Jan%202021)/Page%20Turn%202.wav', 'Page Turn 2'),
        src('bb%20-%20Books%2C%20Paper%2C%20Writing%20(Jan%202021)/Page%20Turn%203.wav', 'Page Turn 3'),
        src('bb%20-%20Books%2C%20Paper%2C%20Writing%20(Jan%202021)/Page%20Turn%20Fast.wav', 'Page Turn Fast'),
        src('kenney_interfacesounds/Audio/scroll_001.ogg', 'Scroll click 1'),
        src('kenney_interfacesounds/Audio/scroll_002.ogg', 'Scroll click 2'),
    ],

    sfx_notify_good: [
        src('100-CC0-SFX/bell_01.ogg', 'Bell ding'),
        src('100-CC0-SFX/bell_02.ogg', 'Bell 2'),
        src('100-CC0-SFX/bell_03.ogg', 'Bell 3'),
        src('kenney_interfacesounds/Audio/confirmation_001.ogg', 'Confirmation 1'),
        src('kenney_interfacesounds/Audio/confirmation_002.ogg', 'Confirmation 2'),
        src('kenney_interfacesounds/Audio/confirmation_004.ogg', 'Confirmation 4'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Silverware%20Ting%203.wav', 'Silverware ting 3'),
    ],

    sfx_notify_bad: [
        src('kenney_interfacesounds/Audio/error_003.ogg', 'Error 3'),
        src('kenney_interfacesounds/Audio/error_004.ogg', 'Error 4'),
        src('kenney_interfacesounds/Audio/error_005.ogg', 'Error 5'),
        src('kenney_interfacesounds/Audio/error_006.ogg', 'Error 6'),
        src('100-CC0-SFX/slam_02.ogg', 'Slam (bad thud)'),
        src('100-CC0-SFX/gong_01.ogg', 'Gong (ominous)'),
    ],

    sfx_deal_success: [
        src('BB_Retail%20Therapy%20Sample%20Pack/Fanfare.wav', 'Fanfare (celebration!)'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Fanfare%20(Reprisal).wav', 'Fanfare Reprisal'),
        src('100-CC0-SFX/bell_01.ogg', 'Bell ding'),
        src('kenney_interfacesounds/Audio/confirmation_003.ogg', 'Confirmation chime'),
        src('kenney_digitalaudio/Audio/threeTone1.ogg', 'Three tone success'),
    ],

    sfx_deal_fail: [
        src('100-CC0-SFX/slam_03.ogg', 'Slam 3 (door slam)'),
        src('100-CC0-SFX/slam_04.ogg', 'Slam 4'),
        src('100-CC0-SFX/slam_05.ogg', 'Slam 5'),
        src('kenney_interfacesounds/Audio/error_007.ogg', 'Error 7'),
        src('kenney_interfacesounds/Audio/error_008.ogg', 'Error 8'),
        src('100-CC0-SFX/gong_02.ogg', 'Gong 2 (ominous)'),
    ],

    sfx_stock_buy: [
        src('100-CC0-SFX/switch_01.ogg', 'Switch click 1'),
        src('100-CC0-SFX/switch_02.ogg', 'Switch click 2'),
        src('100-CC0-SFX/bell_01.ogg', 'Bell (transaction)'),
        src('kenney_digitalaudio/Audio/highUp.ogg', 'Rising tone'),
        src('kenney_digitalaudio/Audio/twoTone1.ogg', 'Two-tone confirm'),
        src('bb%20-%20Smol%20Mechanisms%20(May%202021)/Spring%20Loaded%20Plastic%201.wav', 'Spring click (button)'),
    ],

    sfx_stock_sell: [
        src('100-CC0-SFX/switch_01.ogg', 'Switch click'),
        src('100-CC0-SFX/switch_02.ogg', 'Switch 2'),
        src('kenney_digitalaudio/Audio/lowDown.ogg', 'Descending tone'),
        src('kenney_digitalaudio/Audio/lowRandom.ogg', 'Low random'),
        src('bb%20-%20Smol%20Mechanisms%20(May%202021)/Spring%20Loaded%20Plastic%202.wav', 'Spring click 2'),
    ],

    sfx_car_engine: [
        src('100-cc0-sfx-2/sfx100v2_loop_machine_01.ogg', 'Machine rumble 1 (engine)'),
        src('100-cc0-sfx-2/sfx100v2_loop_machine_02.ogg', 'Machine rumble 2'),
        src('100-cc0-sfx-2/sfx100v2_loop_machine_03.ogg', 'Machine rumble 3'),
        src('100-cc0-sfx-2/sfx100v2_metal_hit_01.ogg', 'Metal hit (ignition)'),
        src('100-cc0-sfx-2/sfx100v2_misc_01.ogg', 'Misc mechanical 1'),
    ],

    sfx_door_open: [
        src('100-CC0-SFX/door_open.ogg', 'Real Door Open'),
        src('100-CC0-SFX/door_01.ogg', 'Door Sound 1'),
        src('100-CC0-SFX/door_02.ogg', 'Door Sound 2'),
        src('100-cc0-sfx-2/sfx100v2_door_01.ogg', 'Door v2-1'),
        src('100-cc0-sfx-2/sfx100v2_door_02.ogg', 'Door v2-2'),
        src('100-cc0-sfx-2/sfx100v2_door_03.ogg', 'Door v2-3'),
        src('kenney_rpgaudio/Audio/doorOpen_1.ogg', 'RPG Door Open 1'),
        src('kenney_rpgaudio/Audio/doorOpen_2.ogg', 'RPG Door Open 2'),
    ],

    sfx_door_close: [
        src('100-CC0-SFX/door_close_01.ogg', 'Real Door Close 1'),
        src('100-CC0-SFX/door_close_02.ogg', 'Real Door Close 2'),
        src('100-CC0-SFX/door_close_03.ogg', 'Real Door Close 3'),
        src('100-CC0-SFX/door_close_04.ogg', 'Real Door Close 4'),
        src('100-CC0-SFX/slam_01.ogg', 'Door Slam 1'),
        src('100-CC0-SFX/slam_02.ogg', 'Door Slam 2'),
        src('100-cc0-sfx-2/sfx100v2_door_04.ogg', 'Door v2-4'),
        src('100-cc0-sfx-2/sfx100v2_door_05.ogg', 'Door v2-5'),
    ],

    sfx_paper_sign: [
        src('bb%20-%20Books%2C%20Paper%2C%20Writing%20(Jan%202021)/Pen%20Writing%201.wav', 'Pen Writing 1 (signing)'),
        src('bb%20-%20Books%2C%20Paper%2C%20Writing%20(Jan%202021)/Pen%20Writing%202.wav', 'Pen Writing 2'),
        src('bb%20-%20Books%2C%20Paper%2C%20Writing%20(Jan%202021)/Pen%20Writing%203.wav', 'Pen Writing 3'),
        src('100-CC0-SFX/paper_01.ogg', 'Paper rustle 1'),
        src('100-CC0-SFX/paper_02.ogg', 'Paper rustle 2'),
        src('100-CC0-SFX/paper_03.ogg', 'Paper rustle 3'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Flipping%20Pages%201.wav', 'Flipping Pages'),
    ],

    sfx_cherry_coke: [
        src('bb%20-%20Bottle%20Plops%20(Apr%202021)/Plop%20-%20Airy%201.wav', 'Bottle pop 1 (airy)'),
        src('bb%20-%20Bottle%20Plops%20(Apr%202021)/Plop%20-%20Airy%202.wav', 'Bottle pop 2 (airy)'),
        src('bb%20-%20Bottle%20Plops%20(Apr%202021)/Plop%20-%20Airy%203.wav', 'Bottle pop 3'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Cork%20Lid%201.wav', 'Cork Lid 1 (bottle open)'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Cork%20Lid%202.wav', 'Cork Lid 2'),
        src('100-CC0-SFX/glass_01.ogg', 'Glass clink 1'),
        src('100-CC0-SFX/glass_02.ogg', 'Glass clink 2'),
        src('100-CC0-SFX/plop_01.ogg', 'Liquid plop 1'),
    ],

    sfx_boombox_start: [
        src('100-CC0-SFX/switch_01.ogg', 'Switch on'),
        src('100-CC0-SFX/switch_02.ogg', 'Switch on 2'),
        src('100-CC0-SFX/spring_01.ogg', 'Spring click 1 (button)'),
        src('100-CC0-SFX/spring_02.ogg', 'Spring click 2'),
        src('bb%20-%20Smol%20Mechanisms%20(May%202021)/Spring%20Loaded%20Plastic%203.wav', 'Spring loaded (power on)'),
        src('bb%20-%20Smol%20Mechanisms%20(May%202021)/Spring%20Loaded%20Plastic%204.wav', 'Spring loaded 2'),
        src('100-cc0-sfx-2/sfx100v2_switch_01.ogg', 'Electric switch 1'),
        src('100-cc0-sfx-2/sfx100v2_switch_02.ogg', 'Electric switch 2'),
    ],

    sfx_footsteps: [
        src('100-cc0-sfx-2/sfx100v2_footstep_01.ogg', 'Footstep 1 (real)'),
        src('100-cc0-sfx-2/sfx100v2_footstep_02.ogg', 'Footstep 2 (real)'),
        src('100-cc0-sfx-2/sfx100v2_footstep_wood_01.ogg', 'Wood floor footstep 1'),
        src('100-cc0-sfx-2/sfx100v2_footstep_wood_02.ogg', 'Wood floor footstep 2'),
        src('100-cc0-sfx-2/sfx100v2_footstep_wet_01.ogg', 'Wet footstep 1 (rain)'),
        src('kenney_impactsounds/Audio/footstep_concrete_000.ogg', 'Concrete step 1'),
        src('kenney_impactsounds/Audio/footstep_concrete_001.ogg', 'Concrete step 2'),
        src('kenney_impactsounds/Audio/footstep_concrete_002.ogg', 'Concrete step 3'),
    ],

    sfx_subway_arrive: [
        src('100-cc0-sfx-2/sfx100v2_air_01.ogg', 'Air brake 1 (pneumatic)'),
        src('100-cc0-sfx-2/sfx100v2_air_02.ogg', 'Air brake 2'),
        src('100-cc0-sfx-2/sfx100v2_air_03.ogg', 'Air brake 3'),
        src('100-cc0-sfx-2/sfx100v2_metal_01.ogg', 'Metal screech 1 (brakes)'),
        src('100-cc0-sfx-2/sfx100v2_metal_02.ogg', 'Metal screech 2'),
        src('100-cc0-sfx-2/sfx100v2_metal_03.ogg', 'Metal 3'),
    ],

    sfx_champagne_pop: [
        src('bb%20-%20Bottle%20Plops%20(Apr%202021)/Plop%20-%20Airy%201.wav', 'Cork pop 1 (airy)'),
        src('bb%20-%20Bottle%20Plops%20(Apr%202021)/Plop%20-%20Airy%202.wav', 'Cork pop 2'),
        src('bb%20-%20Bottle%20Plops%20(Apr%202021)/Plop%20-%20Airy%203.wav', 'Cork pop 3'),
        src('bb%20-%20Bottle%20Plops%20(Apr%202021)/Plop%20-%20Airy%204.wav', 'Cork pop 4'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Cork%20Lid%201.wav', 'Cork Lid pop 1'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Cork%20Lid%202.wav', 'Cork Lid pop 2'),
        src('bb%20-%20Bottle%20Plops%20(Apr%202021)/Bottle%20-%20Shake%201.wav', 'Bottle shake 1'),
    ],

    sfx_heartbeat: [
        src('BB_Retail%20Therapy%20Sample%20Pack/Beefy%20Thud%201.wav', 'Beefy Thud 1 (heartbeat)'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Beefy%20Thud%202.wav', 'Beefy Thud 2'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Good%20Thunk%201.wav', 'Deep Thunk 1'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Good%20Thunk%202.wav', 'Deep Thunk 2'),
        src('kenney_impactsounds/Audio/impactSoft_heavy_000.ogg', 'Soft heavy thump'),
        src('kenney_impactsounds/Audio/impactSoft_heavy_001.ogg', 'Soft heavy thump 2'),
    ],

    sfx_phone_ring: [
        src('100-CC0-SFX/bell_01.ogg', 'Bell ring 1 (phone)'),
        src('100-CC0-SFX/bell_02.ogg', 'Bell ring 2'),
        src('100-CC0-SFX/bell_03.ogg', 'Bell ring 3'),
        src('100-CC0-SFX/gong_01.ogg', 'Gong (old phone)'),
        src('kenney_interfacesounds/Audio/bong_001.ogg', 'Bong (ring tone)'),
        src('50-CC0-retro-synth-SFX/synth_beep_01.ogg', 'Synth beep (pager)'),
        src('50-CC0-retro-synth-SFX/synth_beep_02.ogg', 'Synth beep 2'),
    ],

    sfx_typing: [
        src('bb%20-%20Keyboard%20Sounds%20(Mar%202021)/Keyboard%20-%20Typing%201.wav', 'Real Keyboard Typing 1'),
        src('bb%20-%20Keyboard%20Sounds%20(Mar%202021)/Keyboard%20-%20Typing%202.wav', 'Real Keyboard Typing 2'),
        src('bb%20-%20Keyboard%20Sounds%20(Mar%202021)/Keyboard%20-%20Typing%20Slower.wav', 'Keyboard Typing Slower'),
        src('bb%20-%20Keyboard%20Sounds%20(Mar%202021)/Keyboard%20-%20Key%201.wav', 'Single Key Press 1'),
        src('bb%20-%20Keyboard%20Sounds%20(Mar%202021)/Keyboard%20-%20Key%202.wav', 'Single Key Press 2'),
        src('bb%20-%20Keyboard%20Sounds%20(Mar%202021)/Keyboard%20-%20Key%20Combo%201.wav', 'Key Combo 1'),
        src('bb%20-%20Keyboard%20Sounds%20(Mar%202021)/Keyboard%20-%20Key%20Combo%202.wav', 'Key Combo 2'),
    ],

    sfx_sax_riff: [
        src('kenney_musicjingles/Audio/Sax%20jingles/jingles_SAX00.ogg', 'Sax Riff 1'),
        src('kenney_musicjingles/Audio/Sax%20jingles/jingles_SAX01.ogg', 'Sax Riff 2'),
        src('kenney_musicjingles/Audio/Sax%20jingles/jingles_SAX02.ogg', 'Sax Riff 3'),
        src('kenney_musicjingles/Audio/Sax%20jingles/jingles_SAX03.ogg', 'Sax Riff 4'),
        src('kenney_musicjingles/Audio/Sax%20jingles/jingles_SAX04.ogg', 'Sax Riff 5'),
        src('kenney_musicjingles/Audio/Sax%20jingles/jingles_SAX05.ogg', 'Sax Riff 6'),
    ],

    sfx_crowd_cheer: [
        src('BB_Retail%20Therapy%20Sample%20Pack/Hey%20Ooooh.wav', 'Hey Ooooh! (crowd)'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Fanfare.wav', 'Fanfare (celebration)'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Fanfare%20(Reprisal).wav', 'Fanfare Reprisal'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Laughing%20on%20Company%20Time.wav', 'Group Laughter'),
        src('100-CC0-SFX/glass_04.ogg', 'Glasses clinking (cheers)'),
        src('100-CC0-SFX/glass_05.ogg', 'Glasses clink 2'),
    ],

    sfx_slot_spin: [
        src('kenney_casinoaudio/Audio/cardShuffle.ogg', 'Card/Reel Shuffle'),
        src('kenney_casinoaudio/Audio/dieShuffle1.ogg', 'Die Shuffle 1 (rattle)'),
        src('kenney_casinoaudio/Audio/dieShuffle2.ogg', 'Die Shuffle 2'),
        src('kenney_casinoaudio/Audio/chipsHandle1.ogg', 'Chips Handle 1 (spin)'),
        src('kenney_casinoaudio/Audio/chipsHandle2.ogg', 'Chips Handle 2'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Muted%20Rolling%201.wav', 'Muted Rolling (reel spin)'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Muted%20Rolling%202.wav', 'Muted Rolling 2'),
    ],

    sfx_slot_win: [
        src('BB_Retail%20Therapy%20Sample%20Pack/Fanfare.wav', 'Fanfare (jackpot!)'),
        src('100-CC0-SFX/bell_01.ogg', 'Bell ding (winner)'),
        src('100-CC0-SFX/bell_02.ogg', 'Bell 2'),
        src('kenney_casinoaudio/Audio/chipsCollide3.ogg', 'Chips cascade (payout)'),
        src('kenney_casinoaudio/Audio/chipsCollide4.ogg', 'Chips cascade 2'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Silverware%20Ting%204.wav', 'Ting! (winning ding)'),
    ],

    sfx_slot_lose: [
        src('100-CC0-SFX/slam_03.ogg', 'Thud (nothing)'),
        src('100-CC0-SFX/slam_04.ogg', 'Thud 2'),
        src('kenney_interfacesounds/Audio/minimize_001.ogg', 'Deflating'),
        src('kenney_interfacesounds/Audio/minimize_002.ogg', 'Deflating 2'),
        src('kenney_digitalaudio/Audio/lowDown.ogg', 'Descending tone'),
    ],

    sfx_card_flip: [
        src('kenney_casinoaudio/Audio/cardSlide1.ogg', 'Card Slide 1'),
        src('kenney_casinoaudio/Audio/cardSlide2.ogg', 'Card Slide 2'),
        src('kenney_casinoaudio/Audio/cardSlide3.ogg', 'Card Slide 3'),
        src('kenney_casinoaudio/Audio/cardPlace1.ogg', 'Card Place 1'),
        src('kenney_casinoaudio/Audio/cardPlace2.ogg', 'Card Place 2'),
        src('kenney_casinoaudio/Audio/cardFan1.ogg', 'Card Fan 1'),
    ],

    sfx_dice_roll: [
        src('kenney_casinoaudio/Audio/diceThrow1.ogg', 'Dice Throw 1'),
        src('kenney_casinoaudio/Audio/diceThrow2.ogg', 'Dice Throw 2'),
        src('kenney_casinoaudio/Audio/diceThrow3.ogg', 'Dice Throw 3'),
        src('kenney_casinoaudio/Audio/dieThrow1.ogg', 'Die Throw 1'),
        src('kenney_casinoaudio/Audio/dieThrow2.ogg', 'Die Throw 2'),
    ],

    sfx_roulette_spin: [
        src('kenney_casinoaudio/Audio/chipsHandle3.ogg', 'Chips rattle 1 (spin)'),
        src('kenney_casinoaudio/Audio/chipsHandle4.ogg', 'Chips rattle 2'),
        src('kenney_casinoaudio/Audio/chipsHandle5.ogg', 'Chips rattle 3'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Muted%20Rolling%201.wav', 'Rolling (wheel spin)'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Bouncy%20Ball%201.wav', 'Bouncy Ball (ball in wheel)'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Bouncy%20Ball%202.wav', 'Bouncy Ball 2'),
    ],

    sfx_win_fanfare: [
        src('BB_Retail%20Therapy%20Sample%20Pack/Fanfare.wav', 'Real Fanfare!'),
        src('BB_Retail%20Therapy%20Sample%20Pack/Fanfare%20(Reprisal).wav', 'Fanfare Reprisal'),
        src('kenney_musicjingles/Audio/8-Bit%20jingles/jingles_NES00.ogg', 'NES Victory 1'),
        src('kenney_musicjingles/Audio/8-Bit%20jingles/jingles_NES01.ogg', 'NES Victory 2'),
        src('kenney_musicjingles/Audio/Hit%20jingles/jingles_HIT00.ogg', 'Hit Fanfare 1'),
        src('kenney_musicjingles/Audio/Hit%20jingles/jingles_HIT01.ogg', 'Hit Fanfare 2'),
    ],

    sfx_lose_sting: [
        src('100-CC0-SFX/gong_01.ogg', 'Gong (defeat)'),
        src('100-CC0-SFX/gong_02.ogg', 'Gong 2'),
        src('kenney_musicjingles/Audio/Steel%20jingles/jingles_STEEL00.ogg', 'Steel Sting 1'),
        src('kenney_musicjingles/Audio/Steel%20jingles/jingles_STEEL01.ogg', 'Steel Sting 2'),
        src('kenney_musicjingles/Audio/Steel%20jingles/jingles_STEEL02.ogg', 'Steel Sting 3'),
        src('kenney_musicjingles/Audio/8-Bit%20jingles/jingles_NES04.ogg', 'NES Defeat'),
    ],

    // ========== AMBIENT ==========

    amb_morning: [
        src('100-cc0-sfx-2/sfx100v2_loop_ambient_01.ogg', 'Ambient loop 1 (gentle)'),
        src('100-cc0-sfx-2/sfx100v2_loop_ambient_02.ogg', 'Ambient loop 2'),
        src('100-cc0-sfx-2/sfx100v2_loop_ambient_03.ogg', 'Ambient loop 3'),
        src('bb%20-%20Fans%20and%20Drones%20(Jul%202021)/Outside.wav', 'Outside ambience'),
    ],

    amb_noon: [
        src('100-cc0-sfx-2/sfx100v2_loop_highway.ogg', 'Highway traffic (city noon)'),
        src('100-cc0-sfx-2/sfx100v2_loop_construction_site.ogg', 'Construction site (busy city)'),
        src('100-cc0-sfx-2/sfx100v2_loop_ambient_04.ogg', 'Ambient loop 4'),
        src('bb%20-%20Fans%20and%20Drones%20(Jul%202021)/Outdoor%20AC%20Unit.wav', 'Outdoor AC (city hum)'),
    ],

    amb_night: [
        src('Maximiliano-Stradex-Ambient/Ambient_1.mp3', 'Night ambient 1'),
        src('Maximiliano-Stradex-Ambient/Ambient_2.mp3', 'Night ambient 2'),
        src('100-cc0-sfx-2/sfx100v2_loop_ambient_01.ogg', 'Quiet ambient loop'),
    ],

    amb_cafe: [
        src('100-CC0-SFX/dishes_01.ogg', 'Dishes clatter 1 (cafe)'),
        src('100-CC0-SFX/dishes_02.ogg', 'Dishes clatter 2'),
        src('100-CC0-SFX/dishes_03.ogg', 'Dishes clatter 3'),
        src('bb%20-%20Fans%20and%20Drones%20(Jul%202021)/Small%20Fan.wav', 'Small Fan (AC hum)'),
        src('100-cc0-sfx-2/sfx100v2_loop_water_01.ogg', 'Water running (espresso)'),
    ],

    amb_subway: [
        src('100-cc0-sfx-2/sfx100v2_loop_machine_01.ogg', 'Machine drone 1 (train)'),
        src('100-cc0-sfx-2/sfx100v2_loop_machine_02.ogg', 'Machine drone 2'),
        src('100-cc0-sfx-2/sfx100v2_loop_machine_03.ogg', 'Machine drone 3'),
        src('100-cc0-sfx-2/sfx100v2_loop_machine_04.ogg', 'Machine drone 4'),
        src('bb%20-%20Fans%20and%20Drones%20(Jul%202021)/Furnace%20Fan.wav', 'Furnace fan (tunnel wind)'),
    ],

    amb_downtown: [
        src('100-cc0-sfx-2/sfx100v2_loop_highway.ogg', 'Highway/traffic loop'),
        src('100-cc0-sfx-2/sfx100v2_loop_construction_site.ogg', 'Construction site'),
        src('bb%20-%20Fans%20and%20Drones%20(Jul%202021)/Outdoor%20AC%20Unit.wav', 'AC unit (urban hum)'),
        src('bb%20-%20Fans%20and%20Drones%20(Jul%202021)/Outside.wav', 'Outside ambience'),
    ],

    amb_park: [
        src('100-cc0-sfx-2/sfx100v2_loop_water_01.ogg', 'Water 1 (fountain)'),
        src('100-cc0-sfx-2/sfx100v2_loop_water_02.ogg', 'Water 2 (stream)'),
        src('100-cc0-sfx-2/sfx100v2_loop_water_03.ogg', 'Water 3'),
        src('100-cc0-sfx-2/sfx100v2_loop_ambient_02.ogg', 'Soft ambient (outdoors)'),
        src('bb%20-%20Fans%20and%20Drones%20(Jul%202021)/Outside.wav', 'Outside ambience'),
    ],

    amb_pawnshop: [
        src('bb%20-%20Fans%20and%20Drones%20(Jul%202021)/Computer%20Fan.wav', 'Computer fan (quiet room)'),
        src('bb%20-%20Fans%20and%20Drones%20(Jul%202021)/Refridgerator.wav', 'Fridge hum (store)'),
        src('bb%20-%20Fans%20and%20Drones%20(Jul%202021)/Small%20Fan.wav', 'Small fan'),
        src('100-cc0-sfx-2/sfx100v2_loop_ambient_01.ogg', 'Quiet ambient'),
    ],

    amb_nightclub: [
        src('100-cc0-sfx-2/sfx100v2_loop_machine_01.ogg', 'Bass drone 1'),
        src('100-cc0-sfx-2/sfx100v2_loop_machine_02.ogg', 'Bass drone 2'),
        src('100-cc0-sfx-2/sfx100v2_loop_machine_03.ogg', 'Machine beat 3'),
        src('bb%20-%20Fans%20and%20Drones%20(Jul%202021)/Large%20Fan.wav', 'Large fan (club ventilation)'),
        src('bb%20-%20Fans%20and%20Drones%20(Jul%202021)/Dehumidifier.wav', 'Dehumidifier (deep drone)'),
    ],

    amb_brokerage: [
        src('bb%20-%20Fans%20and%20Drones%20(Jul%202021)/Computer%20Fan.wav', 'Computer fan (office)'),
        src('bb%20-%20Fans%20and%20Drones%20(Jul%202021)/Air%20Vent.wav', 'Air vent (HVAC)'),
        src('100-cc0-sfx-2/sfx100v2_loop_ambient_03.ogg', 'Ambient loop (busy)'),
        src('bb%20-%20Fans%20and%20Drones%20(Jul%202021)/Bathroom%20Fan.wav', 'Ventilation fan'),
    ],

    amb_restaurant: [
        src('100-CC0-SFX/dishes_01.ogg', 'Dishes 1 (kitchen)'),
        src('100-CC0-SFX/dishes_04.ogg', 'Dishes 4'),
        src('100-cc0-sfx-2/sfx100v2_loop_ambient_02.ogg', 'Ambient murmur'),
        src('bb%20-%20Fans%20and%20Drones%20(Jul%202021)/Sink%20and%20Faucet.wav', 'Sink and faucet (kitchen)'),
    ],

    amb_casino: [
        src('100-cc0-sfx-2/sfx100v2_loop_ambient_04.ogg', 'Ambient loop (crowd buzz)'),
        src('100-cc0-sfx-2/sfx100v2_loop_ambient_03.ogg', 'Ambient loop 3'),
        src('bb%20-%20Fans%20and%20Drones%20(Jul%202021)/Large%20Fan.wav', 'Large fan (casino floor)'),
    ],

    amb_rain: [
        src('30-cc0-sfx-loops/rain.ogg', 'Rain Loop'),
        src('100-cc0-sfx-2/sfx100v2_loop_water_01.ogg', 'Water ambient 1'),
        src('100-cc0-sfx-2/sfx100v2_loop_water_02.ogg', 'Water ambient 2'),
    ],

    amb_home_night: [
        src('bb%20-%20Fans%20and%20Drones%20(Jul%202021)/Refridgerator.wav', 'Fridge hum (quiet home)'),
        src('bb%20-%20Fans%20and%20Drones%20(Jul%202021)/Computer%20Fan.wav', 'Computer fan'),
        src('bb%20-%20Fans%20and%20Drones%20(Jul%202021)/Bathroom%20Fan.wav', 'Bathroom fan (distant)'),
        src('100-cc0-sfx-2/sfx100v2_loop_ambient_01.ogg', 'Quiet night ambient'),
    ],

    // ========== MUSIC (jingles as placeholders) ==========

    music_title: [
        src('Maximiliano-Stradex-Ambient/Theme_1.mp3', 'Stradex Theme'),
        src('kenney_musicjingles/Audio/Sax%20jingles/jingles_SAX06.ogg', 'Sax Theme 1'),
        src('kenney_musicjingles/Audio/Sax%20jingles/jingles_SAX07.ogg', 'Sax Theme 2'),
        src('kenney_musicjingles/Audio/Sax%20jingles/jingles_SAX08.ogg', 'Sax Theme 3'),
    ],

    music_act1: [
        src('kenney_musicjingles/Audio/Sax%20jingles/jingles_SAX09.ogg', 'Sax 9'),
        src('kenney_musicjingles/Audio/Sax%20jingles/jingles_SAX10.ogg', 'Sax 10'),
        src('kenney_musicjingles/Audio/Sax%20jingles/jingles_SAX11.ogg', 'Sax 11'),
        src('kenney_musicjingles/Audio/8-Bit%20jingles/jingles_NES08.ogg', 'NES 8'),
    ],

    music_act2: [
        src('kenney_musicjingles/Audio/Hit%20jingles/jingles_HIT06.ogg', 'Hit 6'),
        src('kenney_musicjingles/Audio/Hit%20jingles/jingles_HIT07.ogg', 'Hit 7'),
        src('kenney_musicjingles/Audio/Sax%20jingles/jingles_SAX12.ogg', 'Sax 12'),
        src('kenney_musicjingles/Audio/Sax%20jingles/jingles_SAX13.ogg', 'Sax 13'),
    ],

    music_act3: [
        src('kenney_musicjingles/Audio/Hit%20jingles/jingles_HIT08.ogg', 'Hit 8'),
        src('kenney_musicjingles/Audio/Hit%20jingles/jingles_HIT09.ogg', 'Hit 9'),
        src('kenney_musicjingles/Audio/Steel%20jingles/jingles_STEEL07.ogg', 'Steel 7'),
        src('kenney_musicjingles/Audio/Steel%20jingles/jingles_STEEL08.ogg', 'Steel 8'),
    ],

    music_gameover: [
        src('kenney_musicjingles/Audio/Steel%20jingles/jingles_STEEL03.ogg', 'Steel 3 (somber)'),
        src('kenney_musicjingles/Audio/Steel%20jingles/jingles_STEEL04.ogg', 'Steel 4'),
        src('kenney_musicjingles/Audio/Steel%20jingles/jingles_STEEL05.ogg', 'Steel 5'),
        src('kenney_musicjingles/Audio/Steel%20jingles/jingles_STEEL06.ogg', 'Steel 6'),
    ],

    music_win: [
        src('kenney_musicjingles/Audio/Hit%20jingles/jingles_HIT03.ogg', 'Hit Triumph 1'),
        src('kenney_musicjingles/Audio/Hit%20jingles/jingles_HIT04.ogg', 'Hit Triumph 2'),
        src('kenney_musicjingles/Audio/Hit%20jingles/jingles_HIT05.ogg', 'Hit Triumph 3'),
        src('kenney_musicjingles/Audio/8-Bit%20jingles/jingles_NES07.ogg', 'NES Victory'),
    ],

    music_casino: [
        src('kenney_musicjingles/Audio/Sax%20jingles/jingles_SAX14.ogg', 'Sax 14 (jazzy)'),
        src('kenney_musicjingles/Audio/Sax%20jingles/jingles_SAX15.ogg', 'Sax 15'),
        src('kenney_musicjingles/Audio/Sax%20jingles/jingles_SAX16.ogg', 'Sax 16'),
        src('kenney_musicjingles/Audio/Pizzicato%20jingles/jingles_PIZZI00.ogg', 'Pizzicato 1 (playful)'),
    ],
};

// ============================================
// DOWNLOAD + CONVERT
// ============================================

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(dest);
        proto.get(url, { rejectUnauthorized: false }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                file.close();
                try { fs.unlinkSync(dest); } catch(e) {}
                return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                file.close();
                try { fs.unlinkSync(dest); } catch(e) {}
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
        }).on('error', (err) => {
            file.close();
            try { fs.unlinkSync(dest); } catch(e) {}
            reject(err);
        });
    });
}

function convertToMp3(inputPath, outputPath) {
    try {
        execSync(`ffmpeg -y -i "${inputPath}" -codec:a libmp3lame -qscale:a 4 "${outputPath}"`, {
            stdio: 'pipe',
            timeout: 30000
        });
        return true;
    } catch(e) {
        return false;
    }
}

// Check if Pizzicato jingles dir exists
async function checkPizzicatoDir() {
    return new Promise((resolve) => {
        const url = `https://api.github.com/repos/lavenderdotpet/CC0-Public-Domain-Sounds/contents/kenney_musicjingles/Audio/Pizzicato%20jingles`;
        https.get(url, { rejectUnauthorized: false, headers: { 'User-Agent': 'node' } }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const items = JSON.parse(data);
                    resolve(Array.isArray(items));
                } catch(e) { resolve(false); }
            });
        }).on('error', () => resolve(false));
    });
}

async function main() {
    fs.mkdirSync(CANDIDATES_DIR, { recursive: true });

    // Check if Pizzicato exists
    const hasPizzicato = await checkPizzicatoDir();
    if (!hasPizzicato) {
        // Remove pizzicato entry if dir doesn't exist
        const casino = SLOT_SOURCES.music_casino;
        const idx = casino.findIndex(s => s.src.includes('PIZZI'));
        if (idx >= 0) casino.splice(idx, 1);
    }

    const slots = Object.keys(SLOT_SOURCES);
    const totalFiles = slots.reduce((sum, s) => sum + SLOT_SOURCES[s].length, 0);
    let downloaded = 0;
    let converted = 0;
    let failed = 0;

    console.log(`\n  Downloading ${totalFiles} sound files for ${slots.length} slots...\n`);

    const manifest = {};

    for (const slot of slots) {
        const sources = SLOT_SOURCES[slot];
        const slotDir = path.join(CANDIDATES_DIR, slot);
        fs.mkdirSync(slotDir, { recursive: true });

        manifest[slot] = [];
        console.log(`  [${slot}] — ${sources.length} options`);

        for (let i = 0; i < sources.length; i++) {
            const { src: srcPath, label, ext: fileExt } = sources[i];
            const optNum = i + 1;
            const ext = fileExt || srcPath.split('.').pop().toLowerCase();
            const tempFile = path.join(slotDir, `opt${optNum}.${ext}`);
            const mp3File = path.join(slotDir, `opt${optNum}.mp3`);

            // Skip if MP3 already exists
            if (fs.existsSync(mp3File)) {
                manifest[slot].push({ file: `opt${optNum}.mp3`, label });
                downloaded++;
                converted++;
                process.stdout.write(`    = opt${optNum} (cached)\n`);
                continue;
            }

            const url = `${REPO_RAW}/${srcPath}`;
            try {
                await downloadFile(url, tempFile);
                downloaded++;

                if (ext === 'mp3') {
                    if (tempFile !== mp3File) fs.renameSync(tempFile, mp3File);
                    converted++;
                } else {
                    if (convertToMp3(tempFile, mp3File)) {
                        try { fs.unlinkSync(tempFile); } catch(e) {}
                        converted++;
                    } else {
                        console.error(`    ✗ Failed to convert opt${optNum}`);
                        failed++;
                        try { fs.unlinkSync(tempFile); } catch(e) {}
                        continue;
                    }
                }
                manifest[slot].push({ file: `opt${optNum}.mp3`, label });
                process.stdout.write(`    ✓ opt${optNum}: ${label}\n`);
            } catch(err) {
                failed++;
                process.stdout.write(`    ✗ opt${optNum}: ${err.message}\n`);
            }
        }
    }

    const manifestPath = path.join(CANDIDATES_DIR, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    console.log(`\n  Done!`);
    console.log(`    Downloaded: ${downloaded}`);
    console.log(`    Converted:  ${converted}`);
    console.log(`    Failed:     ${failed}`);
    console.log(`    Manifest:   ${manifestPath}\n`);
    console.log(`  Open sound_picker.html to preview and pick sounds!\n`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
