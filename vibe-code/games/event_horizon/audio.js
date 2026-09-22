/* audio.js — two clocks you can hear.
 *
 * The one sound that matters is a pair of ticks. "Tik" is the ship's clock and
 * never changes: one a second, because the game runs on the pilot's time.
 * "Tok" is the clock left behind, played at whatever rate it is running
 * relative to the pilot's. In Earth orbit the two land on top of each other.
 * Hovering near a horizon the tok runs away into a rattle — which is exactly
 * what the pilot would hear on the radio.
 *
 * Everything is synthesised; there are no audio files. Off by default, and
 * the choice is remembered.
 */
"use strict";

const Sound = {
    ctx: null, on: false, master: null, engine: null, engineFilter: null,
    phaseShip: 0, phaseBase: 0,

    setOn: function (on) {
        this.on = on;
        if (on && !this.ctx) this.init();
        if (this.ctx) {
            if (on && this.ctx.state === "suspended") this.ctx.resume();
            this.master.gain.value = on ? 0.5 : 0;
        }
    },

    init: function () {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try { this.ctx = new AC(); } catch (e) { return; }
        const ctx = this.ctx;
        this.master = ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(ctx.destination);
        // engine: looped noise through a low-pass that opens with the throttle
        const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), data = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < len; i++) { last = 0.97 * last + 0.03 * (Math.random() * 2 - 1); data[i] = last * 9; }
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        this.engineFilter = ctx.createBiquadFilter(); this.engineFilter.type = "lowpass"; this.engineFilter.frequency.value = 300;
        this.engine = ctx.createGain(); this.engine.gain.value = 0;
        src.connect(this.engineFilter); this.engineFilter.connect(this.engine); this.engine.connect(this.master);
        src.start();
    },

    tone: function (freq, dur, gain, type, slideTo) {
        if (!this.on || !this.ctx) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type || "sine"; o.frequency.setValueAtTime(freq, t);
        if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
        g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
    },

    /* baseRate: seconds of the far clock per second of the ship's. NaN or
     * Infinity (inside the horizon) silences it: that clock can no longer be
     * heard from here. */
    update: function (dtReal, throttle, baseRate, playing) {
        if (!this.on || !this.ctx) return;
        const t = this.ctx.currentTime;
        this.engine.gain.setTargetAtTime(playing ? 0.22 * Math.min(1, throttle) : 0, t, 0.05);
        this.engineFilter.frequency.setTargetAtTime(220 + 900 * Math.min(1, throttle), t, 0.08);
        if (!playing) return;
        this.phaseShip += dtReal;
        if (this.phaseShip >= 1) { this.phaseShip %= 1; this.tone(1900, 0.035, 0.10, "square"); }
        if (isFinite(baseRate) && baseRate > 0) {
            this.phaseBase += dtReal * Math.min(16, baseRate);
            if (this.phaseBase >= 1) { this.phaseBase %= 1; this.tone(620, 0.06, 0.16, "triangle"); }
        }
    },

    ping: function (stretch) { this.tone(880 / Math.max(0.25, Math.min(8, stretch)), 0.35, 0.12, "sine"); },
    fire: function () { this.tone(1500, 0.18, 0.12, "sawtooth", 300); },
    hit: function () { this.tone(660, 0.12, 0.16, "sine"); setTimeout(() => this.tone(990, 0.25, 0.16, "sine"), 110); },
    win: function () { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.4, 0.15, "sine"), 130 * i)); },
    lose: function () { this.tone(180, 0.9, 0.3, "sawtooth", 40); },
    horizon: function () { this.tone(110, 2.2, 0.25, "sine", 55); }
};
