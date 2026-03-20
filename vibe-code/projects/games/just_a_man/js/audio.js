/* ============================================
   JUST A MAN - Audio System
   Background music, ambient, SFX
   All sounds are optional — nothing crashes if missing
   ============================================ */

const AudioManager = {
    sounds: {},
    currentAmbient: null,
    currentMusic: null,
    ambientVolume: 0.3,
    musicVolume: 0.25,
    sfxVolume: 0.5,
    muted: false,
    initialized: false,

    // ============================================
    // SOUND DEFINITIONS
    // All paths are relative. Missing files just silently fail.
    // ============================================

    SOUND_MAP: {
        // === MUSIC (loop) ===
        music_title:        { src: '../../shared_assets/audio/music_title.mp3', type: 'music', loop: true },
        music_act1:         { src: '../../shared_assets/audio/music_act1.mp3', type: 'music', loop: true },
        music_act2:         { src: '../../shared_assets/audio/music_act2.mp3', type: 'music', loop: true },
        music_act3:         { src: '../../shared_assets/audio/music_act3.mp3', type: 'music', loop: true },
        music_gameover:     { src: '../../shared_assets/audio/music_gameover.mp3', type: 'music', loop: false },
        music_win:          { src: '../../shared_assets/audio/music_win.mp3', type: 'music', loop: false },
        music_casino:       { src: '../../shared_assets/audio/music_casino.mp3', type: 'music', loop: true },

        // === AMBIENT (loop, crossfade between locations) ===
        amb_morning:        { src: '../../shared_assets/audio/amb_morning.mp3', type: 'ambient', loop: true },
        amb_noon:           { src: '../../shared_assets/audio/amb_noon.mp3', type: 'ambient', loop: true },
        amb_night:          { src: '../../shared_assets/audio/amb_night.mp3', type: 'ambient', loop: true },
        amb_cafe:           { src: '../../shared_assets/audio/amb_cafe.mp3', type: 'ambient', loop: true },
        amb_mall:           { src: '../../shared_assets/audio/amb_mall.mp3', type: 'ambient', loop: true },
        amb_subway:         { src: '../../shared_assets/audio/amb_subway.mp3', type: 'ambient', loop: true },
        amb_downtown:       { src: '../../shared_assets/audio/amb_downtown.mp3', type: 'ambient', loop: true },
        amb_park:           { src: '../../shared_assets/audio/amb_park.mp3', type: 'ambient', loop: true },
        amb_pawnshop:       { src: '../../shared_assets/audio/amb_pawnshop.mp3', type: 'ambient', loop: true },
        amb_nightclub:      { src: '../../shared_assets/audio/amb_nightclub.mp3', type: 'ambient', loop: true },
        amb_brokerage:      { src: '../../shared_assets/audio/amb_brokerage.mp3', type: 'ambient', loop: true },
        amb_restaurant:     { src: '../../shared_assets/audio/amb_restaurant.mp3', type: 'ambient', loop: true },
        amb_casino:         { src: '../../shared_assets/audio/amb_casino.mp3', type: 'ambient', loop: true },
        amb_rain:           { src: '../../shared_assets/audio/amb_rain.mp3', type: 'ambient', loop: true },
        amb_home_night:     { src: '../../shared_assets/audio/amb_home_night.mp3', type: 'ambient', loop: true },

        // === SFX (one-shot) ===
        sfx_click:          { src: '../../shared_assets/audio/sfx_click.mp3', type: 'sfx' },
        sfx_cash_register:  { src: '../../shared_assets/audio/sfx_cash_register.mp3', type: 'sfx' },
        sfx_coin:           { src: '../../shared_assets/audio/sfx_coin.mp3', type: 'sfx' },
        sfx_cash_gain:      { src: '../../shared_assets/audio/sfx_cash_gain.mp3', type: 'sfx' },
        sfx_cash_lose:      { src: '../../shared_assets/audio/sfx_cash_lose.mp3', type: 'sfx' },
        sfx_dialog_open:    { src: '../../shared_assets/audio/sfx_dialog_open.mp3', type: 'sfx' },
        sfx_dialog_choice:  { src: '../../shared_assets/audio/sfx_dialog_choice.mp3', type: 'sfx' },
        sfx_dialog_advance: { src: '../../shared_assets/audio/sfx_dialog_advance.mp3', type: 'sfx' },
        sfx_notify_good:    { src: '../../shared_assets/audio/sfx_notify_good.mp3', type: 'sfx' },
        sfx_notify_bad:     { src: '../../shared_assets/audio/sfx_notify_bad.mp3', type: 'sfx' },
        sfx_deal_success:   { src: '../../shared_assets/audio/sfx_deal_success.mp3', type: 'sfx' },
        sfx_deal_fail:      { src: '../../shared_assets/audio/sfx_deal_fail.mp3', type: 'sfx' },
        sfx_stock_buy:      { src: '../../shared_assets/audio/sfx_stock_buy.mp3', type: 'sfx' },
        sfx_stock_sell:     { src: '../../shared_assets/audio/sfx_stock_sell.mp3', type: 'sfx' },
        sfx_car_engine:     { src: '../../shared_assets/audio/sfx_car_engine.mp3', type: 'sfx' },
        sfx_door_open:      { src: '../../shared_assets/audio/sfx_door_open.mp3', type: 'sfx' },
        sfx_door_close:     { src: '../../shared_assets/audio/sfx_door_close.mp3', type: 'sfx' },
        sfx_paper_sign:     { src: '../../shared_assets/audio/sfx_paper_sign.mp3', type: 'sfx' },
        sfx_cherry_coke:    { src: '../../shared_assets/audio/sfx_cherry_coke.mp3', type: 'sfx' },
        sfx_boombox_start:  { src: '../../shared_assets/audio/sfx_boombox_start.mp3', type: 'sfx' },
        sfx_footsteps:      { src: '../../shared_assets/audio/sfx_footsteps.mp3', type: 'sfx' },
        sfx_subway_arrive:  { src: '../../shared_assets/audio/sfx_subway_arrive.mp3', type: 'sfx' },
        sfx_champagne_pop:  { src: '../../shared_assets/audio/sfx_champagne_pop.mp3', type: 'sfx' },
        sfx_heartbeat:      { src: '../../shared_assets/audio/sfx_heartbeat.mp3', type: 'sfx' },
        sfx_phone_ring:     { src: '../../shared_assets/audio/sfx_phone_ring.mp3', type: 'sfx' },
        sfx_typing:         { src: '../../shared_assets/audio/sfx_typing.mp3', type: 'sfx' },
        sfx_sax_riff:       { src: '../../shared_assets/audio/sfx_sax_riff.mp3', type: 'sfx' },
        sfx_crowd_cheer:    { src: '../../shared_assets/audio/sfx_crowd_cheer.mp3', type: 'sfx' },
        sfx_slot_spin:      { src: '../../shared_assets/audio/sfx_slot_spin.mp3', type: 'sfx' },
        sfx_slot_win:       { src: '../../shared_assets/audio/sfx_slot_win.mp3', type: 'sfx' },
        sfx_slot_lose:      { src: '../../shared_assets/audio/sfx_slot_lose.mp3', type: 'sfx' },
        sfx_card_flip:      { src: '../../shared_assets/audio/sfx_card_flip.mp3', type: 'sfx' },
        sfx_dice_roll:      { src: '../../shared_assets/audio/sfx_dice_roll.mp3', type: 'sfx' },
        sfx_roulette_spin:  { src: '../../shared_assets/audio/sfx_roulette_spin.mp3', type: 'sfx' },
        sfx_win_fanfare:    { src: '../../shared_assets/audio/sfx_win_fanfare.mp3', type: 'sfx' },
        sfx_lose_sting:     { src: '../../shared_assets/audio/sfx_lose_sting.mp3', type: 'sfx' },
    },

    // Scene -> ambient mapping
    SCENE_AMBIENT_MAP: {
        // Home
        home_starter_morning: 'amb_morning',
        home_starter_noon: 'amb_noon',
        home_starter_night: 'amb_home_night',
        home_upgraded_morning: 'amb_morning',
        home_upgraded_noon: 'amb_noon',
        home_upgraded_night: 'amb_home_night',
        // Park
        park_morning: 'amb_park',
        park_noon: 'amb_park',
        park_night: 'amb_park',
        // Mall
        mall_noon: 'amb_mall',
        mall_evening: 'amb_mall',
        // Cafe
        cafe_morning: 'amb_cafe',
        cafe_noon: 'amb_cafe',
        cafe_night: 'amb_cafe',
        // Subway
        subway_morning: 'amb_subway',
        subway_night: 'amb_subway',
        // Downtown
        downtown_morning: 'amb_downtown',
        downtown_noon: 'amb_downtown',
        downtown_night: 'amb_downtown',
        // Pawn shop
        pawnshop_interior: 'amb_pawnshop',
        // Brokerage
        brokerage_floor: 'amb_brokerage',
        // Nightclub
        nightclub_interior: 'amb_nightclub',
        // Restaurant
        restaurant_interior: 'amb_restaurant',
        // Casino
        casino_interior: 'amb_casino',
        // Car lot - use downtown
        carlot_daytime: 'amb_downtown',
        // Real estate - quiet office
        realestate_office: 'amb_morning',
    },

    // Act -> music mapping
    ACT_MUSIC_MAP: {
        0: 'music_title',
        1: 'music_act1',
        2: 'music_act2',
        3: 'music_act3',
    },

    // ============================================
    // INITIALIZATION
    // ============================================

    init() {
        this.initialized = true;
        // Don't preload — load on demand to avoid blocking
    },

    // ============================================
    // CORE PLAY METHODS (safe — never crash)
    // ============================================

    _loadSound(id) {
        if (this.sounds[id]) return this.sounds[id];
        const def = this.SOUND_MAP[id];
        if (!def) return null;

        try {
            const audio = new Audio(def.src);
            audio.loop = !!def.loop;
            audio.preload = 'auto';
            // Silence errors from missing files
            audio.addEventListener('error', () => {});
            this.sounds[id] = audio;
            return audio;
        } catch (e) {
            return null;
        }
    },

    playSfx(id) {
        if (this.muted) return;
        const audio = this._loadSound(id);
        if (!audio) return;
        try {
            audio.volume = this.sfxVolume;
            audio.currentTime = 0;
            audio.play().catch(() => {});
        } catch (e) {}
    },

    playMusic(id) {
        if (this.currentMusic === id) return;

        // Fade out current music
        this._fadeOut(this.currentMusic, 800);
        this.currentMusic = id;

        if (this.muted) return;
        const audio = this._loadSound(id);
        if (!audio) return;
        try {
            audio.volume = 0;
            audio.currentTime = 0;
            audio.play().catch(() => {});
            this._fadeIn(id, this.musicVolume, 1200);
        } catch (e) {}
    },

    playAmbient(id) {
        if (this.currentAmbient === id) return;

        // Crossfade
        this._fadeOut(this.currentAmbient, 600);
        this.currentAmbient = id;

        if (this.muted) return;
        const audio = this._loadSound(id);
        if (!audio) return;
        try {
            audio.volume = 0;
            audio.currentTime = 0;
            audio.play().catch(() => {});
            this._fadeIn(id, this.ambientVolume, 800);
        } catch (e) {}
    },

    stopAll() {
        this._fadeOut(this.currentAmbient, 300);
        this._fadeOut(this.currentMusic, 300);
        this.currentAmbient = null;
        this.currentMusic = null;
    },

    // ============================================
    // FADE HELPERS
    // ============================================

    _fadeIn(id, targetVolume, duration) {
        const audio = this.sounds[id];
        if (!audio) return;
        const steps = 20;
        const interval = duration / steps;
        const increment = targetVolume / steps;
        let step = 0;
        const timer = setInterval(() => {
            step++;
            try { audio.volume = Math.min(targetVolume, increment * step); } catch (e) {}
            if (step >= steps) clearInterval(timer);
        }, interval);
    },

    _fadeOut(id, duration) {
        if (!id) return;
        const audio = this.sounds[id];
        if (!audio) return;
        const steps = 15;
        const interval = duration / steps;
        const startVol = audio.volume || 0;
        const decrement = startVol / steps;
        let step = 0;
        const timer = setInterval(() => {
            step++;
            try {
                audio.volume = Math.max(0, startVol - decrement * step);
                if (step >= steps) {
                    audio.pause();
                    audio.currentTime = 0;
                    clearInterval(timer);
                }
            } catch (e) { clearInterval(timer); }
        }, interval);
    },

    // ============================================
    // SCENE-BASED SOUND SELECTION
    // ============================================

    playAmbientForScene(sceneId) {
        const ambientId = this.SCENE_AMBIENT_MAP[sceneId];
        if (ambientId) {
            this.playAmbient(ambientId);
        }
        // Also handle night rain for cafe_night
        if (sceneId === 'cafe_night' || sceneId === 'downtown_night') {
            // Layer rain on top (if available)
        }
    },

    playMusicForAct(act) {
        const musicId = this.ACT_MUSIC_MAP[act];
        if (musicId) this.playMusic(musicId);
    },

    toggleMute() {
        this.muted = !this.muted;
        if (this.muted) {
            Object.values(this.sounds).forEach(a => {
                try { a.pause(); } catch (e) {}
            });
        } else {
            // Resume ambient and music
            if (this.currentAmbient) {
                const a = this.sounds[this.currentAmbient];
                if (a) { try { a.volume = this.ambientVolume; a.play().catch(() => {}); } catch (e) {} }
            }
            if (this.currentMusic) {
                const m = this.sounds[this.currentMusic];
                if (m) { try { m.volume = this.musicVolume; m.play().catch(() => {}); } catch (e) {} }
            }
        }
        return this.muted;
    },
};
