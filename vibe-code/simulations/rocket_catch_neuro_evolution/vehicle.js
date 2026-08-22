/* NOTE ON THE IIFE WRAPPER AROUND THIS FILE.
 *
 * Every module here is a Node CommonJS file AND is loaded by the page as a
 * plain <script> tag, because these simulations are expected to run from a
 * file:// URL with no server, no bundler and no network. Under Node each file
 * gets its own scope; under a script tag they all share one, and nine files
 * that each begin `const M = ...` and `const DEG = Math.PI/180` collide on the
 * first one and take the rest of the page down with them. The wrapper gives
 * each file its own scope in both worlds. `module` is still visible inside it
 * under Node, so the export at the bottom is unaffected.
 */
;(function () {
/* vehicle.js — the two flying objects, their hardware, and their actuator lags.
 *
 * BODY FRAME. +Z runs along the vehicle's long axis from the engine deck toward
 * the nose. +X is the "belly": for the Ship that is the tiled face, the side
 * that meets the airflow in the flop, and for the booster it is simply the
 * azimuth of grid fin #1 so that "roll" means something. +Y completes the
 * right-handed set. Body z = 0 is the engine plane; every hardware position in
 * this file is measured from there, so the numbers can be read straight off a
 * diagram of the real vehicle.
 *
 * WHY THE MASS MODEL IS NOT A CONSTANT. Both vehicles land on the last few
 * percent of their propellant, and where that propellant sits decides whether
 * the thing is stable. A Super Heavy falling tail-first is aerodynamically
 * stable ONLY because its residual methalox is in the bottom of the tanks, right
 * next to the engines, which are the leading end — mass forward of the
 * centre of pressure. Burn it off and the centre of mass climbs toward the
 * geometric centre and the vehicle gets progressively twitchier during the exact
 * seconds it can least afford to. The Ship is the mirror image: its landing
 * propellant is in a header tank in the NOSE, so consuming it walks the centre
 * of mass aft and re-trims the belly-flop mid-flop. Neither effect is a detail
 * you can bolt on afterwards — they are why the flip is timed the way it is —
 * so mass, centre of mass and inertia are all recomputed from the propellant
 * state every control tick.
 *
 * ENGINES ARE NOT A THROTTLE NUMBER. A Raptor takes about a second to come up,
 * cannot be throttled below ~40% once lit, and — the constraint that shapes the
 * whole manoeuvre — a Super Heavy landing burn lights thirteen engines and then
 * SHEDS ten of them. It cannot get them back. So "engines lit" is a ratchet with
 * a one-way door in it, and a network that sheds early has thrown away the only
 * deceleration it will ever have. That is modelled literally.
 */
"use strict";

const G0 = 9.80665;
const DEG = Math.PI / 180;

/* Raptor 3, sea level. 280 tf is the published V3 figure. */
const RAPTOR = {
    thrust: 2.75e6,          // N at full throttle, sea level
    isp: 330,                // s
    minThrottle: 0.40,
    spoolTau: 0.16,          // s, first-order lag on commanded throttle
    ignitionDelay: 0.45      // s from command to thrust
};

/* ------------------------------------------------------------------------- */
/* Super Heavy — Block 3. 72.3 m, 9 m, three grid fins, no legs, ever.        */
/* ------------------------------------------------------------------------- */
const BOOSTER = {
    key: "booster",
    name: "Super Heavy",
    length: 72.3,
    radius: 4.5,
    dryMass: 230000,          // kg [estimate; 200-275 t range, includes ~57 t of engines]
    dryComZ: 21.0,            // m from the engine plane — 29% of length, engines dominate
    propComZ: 7.0,            // m — residual methalox sits in the bottom of the tanks
    propMax: 95000,           // kg. Landing burn starts at ~320 t total and ends at ~270 t.

    // The nose is a flat-ish transition ring, not a cone: hot-staging vents.
    noseFrac: 0.03,

    engines: [
        // Landing groups only. The outer twenty never light on the way down.
        { n: 3, z: 3.1, offset: 0.0, gimbal: 15 * DEG, group: "center" },
        { n: 10, z: 3.1, offset: 3.4, gimbal: 5 * DEG, group: "inner" }
    ],
    /* The engine counts a landing burn is allowed to use. THIS LADDER IS THE
     * HARDEST CONSTRAINT IN THE PROJECT and it is worth being explicit about
     * why the bottom rung is 2 and not 3.
     *
     * Three Raptors at their 40% floor under a booster that is down to 270
     * tonnes is a thrust-to-weight of 1.25 — enough to hold altitude but not by
     * much, and with almost nothing left over to translate with.
     * The whole landing is therefore a hoverslam — arrive at zero velocity at
     * exactly the rail height, or do not arrive — which is genuinely what a
     * Super Heavy does and is why the catch is hard. But three engines all the
     * way down leaves a controller no way to trim the last few metres, and the
     * real vehicle does shut engines down asymmetrically at the end.
     *
     * THE TWO-ENGINE RUNG IS NOT A HOVER. This comment used to claim it gives
     * TWR 1.03 — "a hover, barely, for a second or two". Measured: two Raptors
     * at the 40% floor give 2.20 MN against 2.65 MN of weight at 270 t, i.e.
     * TWR 0.83, and 0.90 even at the 250 t catch mass. It has never been a
     * hover and nothing in the population has ever been able to hold altitude
     * on it. What it actually buys is thrust granularity between 0 and 3
     * engines, which is a controller freedom rather than a flight-accurate one
     * — the flown ladder is 13 -> 3 -> 0. Kept deliberately and labelled as
     * what it is. The no-hover property the real vehicle has is preserved
     * either way, which is the thing that mattered. */
    engineLadder: [0, 2, 3, 13],

    /* THREE GRID FINS IN A T, NOT AT 120°. The V3 booster carries three fins at
     * 90° / 180° / 270° — port, starboard, and the face directly away from the
     * tower — with NO fin on the tower-facing side, which is body +X here. That
     * asymmetry is not cosmetic: the 180° fin does most of the pitch authority
     * while the 90°/270° pair does yaw and roll, so the mixing matrix is not the
     * symmetric one a 120° layout would give, and the vehicle's ROLL
     * orientation matters on approach because the catch hardware has to face
     * the rails.
     *
     * 7.5 m × 3.75 m each, 50% larger than the old four-fin set, mounted lower
     * on the forward tank — which is what lets the booster fly at a steeper
     * angle of attack without the fins sitting in the body's wake. They are
     * fixed in the deployed position and never fold. */
    fins: [
        { az: 90 * DEG, z: 63.5, chord: 7.5, span: 3.75, area: 28.125, maxDefl: 45 * DEG },
        { az: 180 * DEG, z: 63.5, chord: 7.5, span: 3.75, area: 28.125, maxDefl: 45 * DEG },
        { az: 270 * DEG, z: 63.5, chord: 7.5, span: 3.75, area: 28.125, maxDefl: 45 * DEG }
    ],
    finRate: 40 * DEG,         // rad/s slew

    flaps: [],

    /* The catch hardpoints: two pins just under the grid fins that come to rest
     * on the rails on top of the chopsticks. This height is the entire geometry
     * of a catch — the vehicle is 72 m long and only these two points are ever
     * allowed to touch anything. */
    catchPinZ: 61.0,
    catchPinR: 4.6,

    hasLegs: false,
    canBeCaught: true,
    /* Structural limits. qAlpha is the classic one: dynamic pressure times angle
     * of attack, the bending-moment proxy that actually breaks airframes.
     *
     * BOTH OF THESE WERE INVENTED, AND BOTH WERE SO HIGH THEY CONSTRAINED
     * NOTHING. Measured over ninety flights of the inert policy, the reference
     * pilot and the evolved champion, the peaks reached were q 63 kPa and
     * q·alpha 27.4 kPa·rad — against limits of 140 and 260. A limit an order of
     * magnitude above anything reachable is not a limit, and its only effect was
     * to let the population fly attitudes no airframe survives: the champion
     * reaches 90 degrees of angle of attack and is never penalised, because it
     * happens to be slow whenever it is sideways. That stops being true as
     * policies get faster, which is precisely when it would start to matter.
     *
     * The anchor is Flight 9 (May 2025): SpaceX deliberately descended at up to
     * ~17 degrees AoA as a limits experiment and the booster broke during the
     * landing burn, attributed to higher-than-predicted loads on the fuel
     * transfer tube. At q ~50-60 kPa that is q·alpha ~15-18 kPa·rad exceeding a
     * Block 2 component. Block 3 was explicitly redesigned to descend at higher
     * angles of attack, so 22.5 kPa·rad is the Block-3 figure with the Block-2
     * evidence as its floor. Still an estimate — but an estimate anchored to a
     * vehicle that actually broke, rather than to nothing.
     *
     * q_max comes down to 65 kPa for consistency with the same telemetry
     * closure (~49 kPa quasi-terminal plateau, 55-65 kPa supersonic overshoot).
     * Measured effect of that change alone: zero episodes in ninety. */
    qAlphaMax: 2.25e4,         // Pa·rad
    rateMax: 60 * DEG,         // rad/s before it is called a tumble
    qMax: 6.5e4                // Pa
};

/* ------------------------------------------------------------------------- */
/* Starship — the upper stage. Belly-flops, flips, lands.                     */
/* ------------------------------------------------------------------------- */
const SHIP = {
    key: "ship",
    name: "Starship",
    length: 52.0,
    radius: 4.5,
    dryMass: 150000,           // kg [estimate; 130-170 t for a V2/V3-class ship]
    dryComZ: 23.0,
    propComZ: 46.0,            // nose header tank — forward, and it empties during the flip
    propMax: 30000,            // combined usable landing propellant in the headers

    noseFrac: 0.16,            // rounded nosecone over the top ~8.3 m

    engines: [
        { n: 3, z: 2.6, offset: 1.6, gimbal: 15 * DEG, group: "center" }
    ],
    engineLadder: [0, 1, 2, 3],

    fins: [],

    /* Four flaps, and they are NOT wings. Each one is a brake on one corner of a
     * falling flat plate; the pair geometry is what turns four drag knobs into
     * pitch, roll and (weakly, through the resulting bank) a ground track.
     * Forward flaps are small, aft flaps are much larger, exactly as built.
     *
     * THIS IS THE ONLY PLACE FLAP GEOMETRY IS WRITTEN DOWN. aero.js and
     * render.js both derive from these fields, which is the point: the previous
     * version had the aerodynamic hinge in one file and the drawn hinge in
     * another, they disagreed, and the flaps rendered as four panels orbiting
     * the centreline — passing through the hull twice per sweep — while the
     * physics was hinging them somewhere else entirely.
     *
     * `hingeAz` is the azimuth of the hinge line measured from the windward
     * (tiled, body +X) centreline; `side` puts it on the +Y or −Y flank. The
     * hinge line itself lies ON the hull at that azimuth and runs parallel to
     * the long axis, so a flap only ever rotates — it never translates, and its
     * inboard edge never leaves the hull. `chord` is along the body, `span` is
     * outward from the hinge, and `area` is just their product. */
    flaps: [
        { name: "fwd-left", z: 42.6, side: +1, hingeAz: 108 * DEG, chord: 4.6, span: 2.4, area: 11.04, minDefl: 5 * DEG, maxDefl: 80 * DEG },
        { name: "fwd-right", z: 42.6, side: -1, hingeAz: 108 * DEG, chord: 4.6, span: 2.4, area: 11.04, minDefl: 5 * DEG, maxDefl: 80 * DEG },
        { name: "aft-left", z: 5.5, side: +1, hingeAz: 108 * DEG, chord: 7.8, span: 3.7, area: 28.86, minDefl: 5 * DEG, maxDefl: 80 * DEG },
        { name: "aft-right", z: 5.5, side: -1, hingeAz: 108 * DEG, chord: 7.8, span: 3.7, area: 28.86, minDefl: 5 * DEG, maxDefl: 80 * DEG }
    ],
    flapRate: 25 * DEG,

    catchPinZ: 41.0,
    catchPinR: 4.6,

    hasLegs: true,
    legDeployTime: 3.0,        // s
    legRadius: 9.0,            // m — the footprint that decides a tip-over
    canBeCaught: true,
    qAlphaMax: 1.9e5,
    rateMax: 75 * DEG,
    qMax: 9.0e4
};

const TYPES = { booster: BOOSTER, ship: SHIP };

/* ------------------------------------------------------------------------- */

/* Live mass properties. Called every control tick; must not allocate. */
function massProps(type, prop, out) {
    const md = type.dryMass, mp = Math.max(0, prop);
    const m = md + mp;
    const com = (md * type.dryComZ + mp * type.propComZ) / m;

    // Treat the vehicle as a uniform cylinder of length L about its own centre,
    // then move the whole thing to the real centre of mass with the parallel
    // axis theorem applied to the dry and propellant lumps separately. This is
    // crude in absolute terms and very good in the term that matters, which is
    // how the transverse inertia changes as the centre of mass walks.
    const L = type.length, R = type.radius;
    const Icyl = (3 * R * R + L * L) / 12;
    const dd = type.dryComZ - com, dp = type.propComZ - com;
    const Ixx = md * (Icyl + dd * dd) + mp * (0.25 * R * R + 0.08 * L * L + dp * dp);
    const Izz = 0.5 * md * R * R + 0.5 * mp * R * R * 0.7;

    out.m = m;
    out.com = com;
    out.Ixx = Ixx;
    out.Iyy = Ixx;
    out.Izz = Izz;
    return out;
}

/* Actuator state: everything that has a lag, a limit or a memory. Kept separate
 * from the rigid-body state because it is what the network actually touches. */
class Actuators {
    constructor(type) {
        this.type = type;
        this.nFin = type.fins.length;
        this.nFlap = type.flaps.length;
        this.fin = new Float64Array(4);       // rad, signed
        this.finCmd = new Float64Array(4);
        this.flap = new Float64Array(4);      // rad, 0 = flush
        this.flapCmd = new Float64Array(4);
        for (let i = 0; i < this.nFlap; i++) { this.flap[i] = type.flaps[i].minDefl; this.flapCmd[i] = this.flap[i]; }

        this.throttle = 0;        // realised
        this.throttleCmd = 0;
        this.stage = 0;           // index into engineLadder
        this.stageCmd = 0;
        this.igniteAt = -1;       // time the current stage's engines finish spooling
        this.lightTime = -1;      // first ignition, ever
        this.gimbalX = 0; this.gimbalY = 0;
        this.gimbalCmdX = 0; this.gimbalCmdY = 0;
        this.legCmd = 0; this.legFrac = 0;
        this.commit = 0;          // >0 = going for the tower
        this.everLit = false;
        /* Raptors are spark-torch ignited and the vehicle carries a finite
         * number of starts. Two is the budget here, and it is what stops a
         * network from treating engine count as a free continuous knob: every
         * time it asks for MORE engines than are currently running it spends a
         * credit and eats a 450 ms hole in its thrust. Stepping DOWN is always
         * allowed and always free, which is the asymmetry the real landing burn
         * has — thirteen engines, then three, and no way back within the burn.
         * Three credits: Raptors are restartable and both stages have relit in
         * flight, but not for free and not instantly. */
        this.ignitions = 3;
        this.pendingCmd = -1;
        this.pendingSince = 0;
    }

    /* One physics step of actuator dynamics. `t` is episode time. */
    step(dt, t) {
        const ty = this.type;

        // Aerodynamic surfaces: rate-limited toward the command. Real fin
        // actuators are the slowest thing in the loop and a network that has
        // learned to command 30 Hz square waves gets nothing for it.
        const dFin = ty.finRate * dt;
        for (let i = 0; i < this.nFin; i++) {
            const e = this.finCmd[i] - this.fin[i];
            this.fin[i] += Math.abs(e) < dFin ? e : Math.sign(e) * dFin;
        }
        const dFlap = ty.flapRate * dt;
        for (let i = 0; i < this.nFlap; i++) {
            const e = this.flapCmd[i] - this.flap[i];
            this.flap[i] += Math.abs(e) < dFlap ? e : Math.sign(e) * dFlap;
        }

        // Gimbal: fast, but not instant, and hard-limited by the engine mount.
        const gmax = ty.engines[0].gimbal, gr = 25 * DEG * dt;
        const clampG = (c) => Math.max(-gmax, Math.min(gmax, c));
        let ex = clampG(this.gimbalCmdX) - this.gimbalX;
        let ey = clampG(this.gimbalCmdY) - this.gimbalY;
        this.gimbalX += Math.abs(ex) < gr ? ex : Math.sign(ex) * gr;
        this.gimbalY += Math.abs(ey) < gr ? ey : Math.sign(ey) * gr;

        /* Engine count. Two gates stand between the command and the hardware.
         *
         * A DWELL: the command has to be held for 350 ms before it takes
         * effect. Without it a single noisy tick out of a fresh network sheds
         * ten engines permanently, and generation 1 is a fleet that all fly the
         * same crippled configuration and cannot be told apart.
         *
         * AN IGNITION CREDIT, spent only on increases. */
        let want = this.stageCmd | 0;
        if (want > this.stage && this.ignitions <= 0) want = this.stage;
        if (want !== this.stage) {
            if (this.pendingCmd !== want) { this.pendingCmd = want; this.pendingSince = t; }
            // Shutting engines down is quick and safe; lighting them is not.
            // The asymmetry matters: a landing burn sheds ten engines in the
            // middle of itself and a 350 ms lag on THAT is 500 m/s² · s of
            // unwanted deceleration.
            const dwell = want > this.stage ? 0.35 : 0.12;
            if (t - this.pendingSince >= dwell) {
                const up = want > this.stage;
                this.stage = want;
                this.pendingCmd = -1;
                if (up) {
                    this.ignitions--;
                    this.igniteAt = t + RAPTOR.ignitionDelay;
                    if (!this.everLit) { this.everLit = true; this.lightTime = t; }
                }
            }
        } else {
            this.pendingCmd = -1;
        }

        // Throttle: min-throttle floor once lit, first-order spool.
        let cmd = this.stage > 0 ? Math.max(RAPTOR.minThrottle, Math.min(1, this.throttleCmd)) : 0;
        if (this.stage > 0 && t < this.igniteAt) cmd = 0;
        const k = 1 - Math.exp(-dt / RAPTOR.spoolTau);
        this.throttle += (cmd - this.throttle) * k;
        if (this.throttle < 1e-4) this.throttle = 0;

        // Legs, one-way.
        if (ty.hasLegs) {
            if (this.legCmd > 0) this.legFrac = Math.min(1, this.legFrac + dt / ty.legDeployTime);
        }
    }

    /* Engines actually producing thrust right now. */
    liveEngines() {
        const n = this.type.engineLadder[this.stage] || 0;
        return this.throttle > 0 ? n : 0;
    }

    thrust() {
        return this.liveEngines() * RAPTOR.thrust * this.throttle;
    }

    massFlow() {
        return this.thrust() / (RAPTOR.isp * G0);
    }

    clone() {
        const a = new Actuators(this.type);
        a.fin.set(this.fin); a.finCmd.set(this.finCmd);
        a.flap.set(this.flap); a.flapCmd.set(this.flapCmd);
        a.throttle = this.throttle; a.throttleCmd = this.throttleCmd;
        a.stage = this.stage; a.stageCmd = this.stageCmd;
        a.igniteAt = this.igniteAt; a.lightTime = this.lightTime;
        a.gimbalX = this.gimbalX; a.gimbalY = this.gimbalY;
        a.gimbalCmdX = this.gimbalCmdX; a.gimbalCmdY = this.gimbalCmdY;
        a.legCmd = this.legCmd; a.legFrac = this.legFrac;
        a.commit = this.commit; a.everLit = this.everLit;
        a.ignitions = this.ignitions;
        a.pendingCmd = this.pendingCmd; a.pendingSince = this.pendingSince;
        return a;
    }
}

/* ------------------------------------------------------------------------- */
/* The tower. One structure, two roles: it is the target and it is the thing   */
/* most likely to destroy the vehicle.                                        */
/* ------------------------------------------------------------------------- */
/* THE SITE. Where the water starts, in simulation coordinates.
 *
 * This was a literal 330 written twice in render.js and known nowhere else,
 * while scenarios.js decided how far offshore to spawn a vehicle with no way to
 * ask where the shore was. One number that three files have to agree on and
 * only one file can see is how a spawn ends up on the wrong side of the beach.
 *
 * Land is +Y and ocean is -Y (scene z = -y_sim), so the shoreline is at
 * y = -330 and anything more negative is over water. Real Starbase puts the
 * orbital pad "a few hundred yards off Boca Chica Beach", which is what this is.
 */
const SITE = {
    shoreY: -330               // seaward of this is water
};

const TOWER = {
    height: 146,
    halfWidth: 5.5,            // the tower body is an 11 m square in plan
    armZ: 120,                 // rail height — puts the engine deck at ~59 m AGL
    /* WHICH WAY THE ARMS FACE. -1 is seaward.
     *
     * Scene z = -y_sim, the land plane runs to z = SHORE-20000 and the sea from
     * z = SHORE+20000 with SHORE = 330, so LAND IS +Y AND OCEAN IS -Y with the
     * shoreline at y = -330. The arms used to reach out in +Y, i.e. inland,
     * with the vehicle approaching across the launch site. Facing them seaward
     * puts the catch on the water side, which is both how the real pad is laid
     * out and the side the vehicle now arrives from. */
    armSide: -1,
    armReach: 32,              // arms extend this far out along armSide
    armInner: 6.0,             // ...starting here, at the tower face
    gateX: 0.0,                // the catch point: on the tower centreline...
    /* How far out along the arms the vehicle sits. The tower is an 11 m square
     * and the hull is 9 m across, so at 19 m the gap between them is nine
     * metres — which sounds like plenty until a vehicle station-keeping over
     * the gate wanders four metres and puts its flank into the tower. 24 m
     * matches the real geometry at least as well and leaves a margin a
     * controller can actually hold. */
    gateY: -24.0,          // = armSide * 24
    /* Where the arm rails sit while the vehicle is coming down. They are OPEN
     * at this point — 15 m apart around a 9 m cylinder — and only close once
     * the pins are over them. Modelling them at their closed spacing leaves
     * about a metre of clearance per side and makes every approach that is not
     * already a perfect catch into a collision, which turns the whole terminal
     * phase into a cliff instead of a slope. */
    gateHalfGap: 12.5,
    // Capture tolerances. These are the real thing being asked for: a 250 tonne
    // cylinder placed into a 3 m box at walking pace.
    /* THE CAPTURE BOX IS NOT ROUND. The rails run along the arms, so a couple of
     * metres of error in that direction is absorbed; across the arms there is
     * only the width of the rail, and half a metre is the published-ish figure.
     * Modelling it as a circle either throws away the along-arm margin the real
     * hardware has, or pretends there is across-arm margin it does not. */
    capture: {
        across: 0.9,           // m, perpendicular to the arms (body/world X)
        along: 2.5,            // m, out along the arms (world Y)
        vz: 2.5,               // m/s descent at engagement
        vh: 1.5,               // m/s lateral
        tilt: 3.5 * DEG,
        rate: 3.5 * DEG
    }
};

/* The concrete pad, south of the tower and well clear of it. Only the Ship has
 * legs, so this is the Ship's alternative. A Super Heavy sent here is making a
 * controlled soft touchdown it will not survive standing up — which is fine,
 * and is exactly what SpaceX does when a catch is waved off. */
const PAD = { kind: "pad", x: 0, y: -170, radius: 38 };

/* The offshore divert area. Soft, upright, slow — nothing else is asked, and
 * nothing else is possible for a vehicle with no legs. Its POSITION is chosen
 * per scenario rather than fixed here, at a range the vehicle can actually
 * reach from where that stage starts: a booster diverting from 12 km can cross
 * two kilometres on its grid fins, and one diverting from 400 m cannot cross
 * two hundred metres. A fixed offshore point looks realistic and quietly makes
 * every low-altitude divert scenario unwinnable. */
const DIVERT = { kind: "safe", radius: 200 };

if (typeof module !== "undefined") {
    module.exports = { BOOSTER, SHIP, TYPES, RAPTOR, TOWER, SITE, PAD, DIVERT, massProps, Actuators, G0, DEG };
}
else {
    window.Vehicle = { BOOSTER, SHIP, TYPES, RAPTOR, TOWER, SITE, PAD, DIVERT, massProps, Actuators, G0, DEG };
}

})();
