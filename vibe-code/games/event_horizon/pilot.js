/* pilot.js — a scripted flight for every mission.
 *
 * Two jobs. test_headless.js flies each of these to the end, which is the only
 * real proof that a mission's numbers (fuel, engine, time limit, target sizes)
 * add up to something a player can finish. And the game offers the same flight
 * as "show me", for anybody who would rather watch the manoeuvre once before
 * trying it.
 *
 * A pilot is a function (sim, mem) → input, called once per frame, holding the
 * same controls a player has: turn/aim, thrust, the align keys, hover, and the
 * time-warp. None of them reach into the physics to cheat — they read the same
 * instruments the panel shows (apsides, radius, clock lead) and press keys.
 */
"use strict";

const PILOTS = {};

function headingError(sim, want) {
    const d = want - sim.heading;
    return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
}

/* Burn along (or against) the direction of travel, but only once the nose has
 * actually come round; throttle back near the target so as not to overshoot. */
function burn(sim, dir, fine) {
    const p = [0, 0];
    if (!sim.prograde(p)) return { align: dir };
    const want = Math.atan2(p[1], p[0]) + (dir === "retro" ? Math.PI : 0);
    return { align: dir, thrust: headingError(sim, want) < 0.06 ? 1 : 0, fine: !!fine };
}

/* ---------------------------------------------------------- 1. orbit */
PILOTS.orbit = function (sim) {
    const ap = apsides(sim.world, sim.d);
    if (ap.peri < 1.1) return burn(sim, "pro", ap.peri > 1.06);
    return { warp: 4 };
};

/* ---------------------------------------------------------- 2. gps */
PILOTS.gps = function (sim, mem) {
    const ap = apsides(sim.world, sim.d), target = 4.17;
    if (mem.phase === undefined) mem.phase = 0;
    if (mem.phase === 0) {                                   // raise the high point
        if (ap.apo >= target) { mem.phase = 1; return {}; }
        return burn(sim, "pro", ap.apo > target - 0.25);
    }
    if (mem.phase === 1) {                                   // coast up to it
        if (sim.d.r > 0.9 * ap.apo && sim.d.rdot <= 0) mem.phase = 2;
        return { warp: sim.d.r < 0.8 * ap.apo ? 8 : 2 };
    }
    if (mem.phase === 2) {                                   // round it off
        if (ap.peri >= 4.02 || ap.apo > 4.38) { mem.phase = 3; return {}; }
        return burn(sim, "pro", ap.peri > 3.7);
    }
    return { warp: 8 };
};

/* ---------------------------------------------------------- 3. proxima */
PILOTS.proxima = function (sim, mem) {
    const m = sim.marks, s = sim.ship;
    const t = sim.cfg.places[m.leg === 0 ? 1 : 0];
    const dx = t.x - s.x, dy = t.y - s.y, dist = Math.hypot(dx, dy);
    /* The fastest speed from which full braking still stops in time, with a
     * margin for the second or so it takes to swing the ship round. */
    const gWant = 1 + sim.aMax * Math.max(0, dist - 0.12) * 0.93;
    const wWant = Math.sqrt(gWant * gWant - 1);
    const ex = wWant * dx / dist - s.wx, ey = wWant * dy / dist - s.wy;
    const err = Math.hypot(ex, ey);
    if (err < 0.02) return {};
    const want = Math.atan2(ey, ex);
    return { aim: want, thrust: headingError(sim, want) < 0.12 ? 1 : 0, fine: err < 0.06 };
};

/* ---------------------------------------------------------- 4. deepwell */
PILOTS.deepwell = function (sim, mem) {
    if (mem.phase === undefined) mem.phase = 0;
    const r = sim.d.r;
    if (mem.phase === 0) {                                   // sink
        if (r <= 1.75) mem.phase = 1;
        return { hover: true, climb: -1 };
    }
    if (mem.phase === 1) {                                   // wait where time is slow
        if (sim.lead >= DEEP_GAIN + 1) mem.phase = 2;
        return { hover: true, warp: 4 };
    }
    return { hover: true, climb: 1 };                        // and straight back up to the station
};

/* ---------------------------------------------------------- 5. isco */
PILOTS.isco = function (sim, mem) {
    if (mem.phase === undefined) mem.phase = 0;
    const ap = apsides(sim.world, sim.d), d = sim.d;
    if (mem.phase === 0) {                                   // drop the low point to ~3.9
        if (ap.peri <= 3.9) { mem.phase = 1; return {}; }
        return burn(sim, "retro", ap.peri < 4.4);
    }
    if (mem.phase === 1) {                                   // coast down to it
        if (d.r < 1.04 * ap.peri && d.rdot >= 0) mem.phase = 2;
        return { warp: d.r > 1.3 * ap.peri ? 4 : 1 };
    }
    if (mem.phase === 2) {                                   // pull the high point down too
        if (ap.apo <= 4.3 || ap.peri < 3.25) { mem.phase = 3; return {}; }
        return burn(sim, "retro", ap.apo < 5);
    }
    if (mem.phase === 3) {                                   // hands off for a lap
        if (sim.marks.lapDone) mem.phase = 4;
        return { warp: 2 };
    }
    if (mem.phase === 4) {                                   // and out
        if (ap.apo >= 8.6) { mem.phase = 5; return {}; }
        return burn(sim, "pro", false);
    }
    return { warp: 4 };
};

/* ---------------------------------------------------------- 6. lightbend */

/* Closest a photon fired at `angle` comes to the target (after `minLen` of
 * travel, for the shot that has to come back to the ship). */
function beamMiss(sim, angle, tx, ty, minLen) {
    const rs = sim.world.rs, s = sim.ship;
    const p = photonFromHoverer(rs, s.x, s.y, angle);
    let best = Infinity, len = 0;
    const far = (sim.cfg.viewR || 20) * 1.5;
    while (len < 160) {
        if (!advancePhoton(rs, p, BEAM_SUBSTEP)) break;
        len += BEAM_SUBSTEP;
        if (len >= minLen) best = Math.min(best, Math.hypot(p.x - tx, p.y - ty));
        if (Math.hypot(p.x, p.y) > far) break;
    }
    return best;
}

function solveAim(sim, t) {
    const tx = t.self ? sim.ship.x : t.x, ty = t.self ? sim.ship.y : t.y, minLen = t.self ? 6 : 0;
    /* The hole is at angle 0 from the ship. Everything interesting is within
     * half a radian of that; the boomerang is in a sliver of it, so the scan
     * is fine and the refinement is a golden-section on the miss distance. */
    let bestA = 0, best = Infinity;
    const N = t.self ? 40000 : 3000, lo0 = t.self ? 0.15 : -0.9, hi0 = t.self ? 0.35 : 0.9;
    for (let i = 0; i <= N; i++) {
        const a = lo0 + (hi0 - lo0) * i / N;
        const m = beamMiss(sim, a, tx, ty, minLen);
        if (m < best) { best = m; bestA = a; }
    }
    let lo = bestA - (hi0 - lo0) / N, hi = bestA + (hi0 - lo0) / N;
    const g = 0.381966;
    for (let i = 0; i < 40; i++) {
        const a = lo + g * (hi - lo), b = hi - g * (hi - lo);
        if (beamMiss(sim, a, tx, ty, minLen) < beamMiss(sim, b, tx, ty, minLen)) hi = b; else lo = a;
    }
    return { angle: 0.5 * (lo + hi), miss: beamMiss(sim, 0.5 * (lo + hi), tx, ty, minLen) };
}

PILOTS.lightbend = function (sim, mem) {
    const L = sim.laser;
    if (!mem.plan) {
        mem.plan = L.targets.map(function (t) { return { id: t.id, sol: solveAim(sim, t) }; });
        mem.i = 0; mem.wait = 0;
    }
    if (L.beams.some(function (b) { return b.live; })) return { warp: 4 };
    if (mem.i >= mem.plan.length) return {};
    const shot = mem.plan[mem.i++];
    return { aimTo: shot.sol.angle, fire: true };
};

/* ---------------------------------------------------------- 7. tides */
PILOTS.tides = function (sim, mem) {
    if (sim.cfg.variant === "small") return {};              // just fall, and find out
    if (!sim.marks.dropped) return { hover: true, climb: -1 };
    return { hover: true, climb: 1 };
};

/* ---------------------------------------------------------- 8. plunge */
PILOTS.plunge = function () { return { hover: false }; };

/* ------------------------------------------------------------ the harness */

function flyMission(mission, options) {
    const sim = new Sim(mission, options);
    const pilot = PILOTS[mission.pilot];
    const mem = {}, dtReal = 1 / 60;
    let frames = 0;
    const limit = (options && options.maxFrames) || 60 * 60 * 30;
    while (sim.status === "flying" && frames++ < limit) {
        const input = pilot(sim, mem) || {};
        if (input.hover === undefined) input.hover = false;
        let scale = sim.timeScale;
        if (sim.d.inside && sim.cfg.insideTimeScale) scale = sim.cfg.insideTimeScale;
        sim.step(dtReal, dtReal * scale * (input.warp || 1), input);
        sim.events.length = 0;
    }
    const deb = sim.status !== "flying" ? mission.debrief(sim) : null;
    return {
        sim: sim, won: sim.status === "won", frames: frames, stars: deb ? deb.stars : 0,
        note: sim.status + (sim.reason ? " (" + sim.reason + ")" : "") + " after " + (frames / 60).toFixed(0) + " s of play" +
              (deb ? ", " + deb.stars + "★" : "") + ", Δv " + sim.fuelUsed.toPrecision(3) + " c, ship clock " + fmtDuration(sim.tau * sim.unitS)
    };
}

if (typeof module !== "undefined") {
    module.exports = { PILOTS, flyMission, solveAim, beamMiss, burn, headingError };
}
