/* craft.js — the chaser vehicle. A Dragon-class capsule: 6.3 tonnes wet, a
 * nose docking port, and sixteen hypergolic thrusters that do everything.
 *
 * THERE IS NO ATTITUDE CONTROLLER UNDERNEATH. The network commands thruster
 * groups, not rates and not quaternions. If it wants to hold an attitude it
 * has to fire one way and then fire back, and if it forgets the second half it
 * keeps rotating for the rest of the mission — which is the single most common
 * way a young brain here loses its LIDAR lock.
 *
 * THRUSTER LAYOUT. Sixteen Draco-class engines, 400 N each, Isp 300 s, exactly
 * as on the real vehicle, grouped into the six translation directions plus
 * twelve small 110 N attitude engines arranged as pure couples:
 *
 *      +X  (accelerate)  4 × 400 N = 1600 N      aft-firing, unobstructed
 *      −X  (brake)       4 × 400 N × cos25° = 1450 N
 *                        forward-firing engines must be canted outboard so the
 *                        plume misses the docking ring and does not impinge on
 *                        the target — a real constraint, and it means braking
 *                        is 9% weaker than accelerating and costs the same
 *                        propellant. Learning that asymmetry is part of the job.
 *      ±Y, ±Z            2 × 400 N = 800 N each
 *      attitude          couples of 2 × 110 N at a 1.8 m arm = 396 N·m
 *
 * At 6,300 kg that is 0.254 m/s² forward, 0.230 m/s² braking, 0.127 m/s²
 * sideways, and 0.066 / 0.033 rad/s² in roll / pitch-yaw. A 90° slew is a
 * 14-second bang-bang manoeuvre. Nothing here is instantaneous.
 *
 * MINIMUM IMPULSE BIT. Real RCS cannot throttle; it pulses. Every command is
 * quantised to a 20 ms on-time inside the 250 ms control tick, so there are
 * thirteen achievable thrust levels per direction and a command below 8% of
 * full simply does not fire. This is what stops a network from station-keeping
 * with an imaginary infinitely-fine trim, and it is why the terminal approach
 * has a velocity floor: you cannot ask for 3 mm/s of correction.
 */
"use strict";

const CRAFT = {
    dryMass: 5800,          // kg
    propMass: 500,          // kg  → 243 m/s of Δv, generous but not unlimited
    inertia: [6000, 12000, 12000],   // kg·m², principal, +X is the docking axis

    isp: 300,               // s
    thrustMain: 1600,       // N   +X group
    thrustBrake: 1450,      // N   −X group, canted
    thrustLateral: 800,     // N   ±Y and ±Z groups
    torqueRcs: 396,         // N·m each axis

    // Propellant flow is per-newton, so the mass budget is the same whichever
    // group fires. Attitude control is not free.
    minImpulse: 0.020,      // s, thruster minimum on-time
    /* There is no separate deadband constant, and that is deliberate. The
     * minimum impulse bit already IS the deadband: a command that rounds to
     * less than one 20 ms pulse inside the control tick cannot be delivered,
     * which works out at about 4% of full authority. An extra hand-picked
     * threshold on top of it was in here at 8%, and it put a hard floor under
     * the achievable pointing error at exactly deadband/kp = 6.5° — half a
     * capture envelope's worth of misalignment, produced by a constant with no
     * physical meaning. Let the hardware be the only limit. */
    deadband: 0,

    radius: 1.8,            // m, collision sphere about the centre of mass
    dockOffset: 2.2,        // m, the docking interface sits this far up +X
    maxRate: 15 * Math.PI / 180   // rad/s, above which the vehicle is declared tumbling
};

class Craft {
    constructor(opts) {
        opts = opts || {};
        this.dryMass = CRAFT.dryMass;
        this.prop0 = opts.prop != null ? opts.prop : CRAFT.propMass;
        this.prop = this.prop0;
        this.mass = this.dryMass + this.prop;
        this.I = CRAFT.inertia.slice();
        this.q = opts.q ? opts.q.slice() : [1, 0, 0, 0];
        this.w = opts.w ? opts.w.slice() : [0, 0, 0];
        this.dvUsed = 0;                 // m/s, integrated |a| dt — the fuel ledger
        this.burnTime = 0;               // s of any thruster on
        this.firing = [0, 0, 0, 0, 0, 0];  // duties for the renderer: +X −X +Y −Y +Z −Z
        this.firingRcs = [0, 0, 0];
    }

    /* Quantise a signed command to what the hardware can actually deliver over
     * one control tick. Returns a signed duty in [−1, 1] whose magnitude is an
     * integer number of minimum-impulse bits. */
    static quantise(cmd, dtTick) {
        const s = Math.sign(cmd), m = Math.abs(cmd);
        if (m < CRAFT.deadband) return 0;
        if (!(m > 0)) return 0;
        const bits = Math.round(Math.min(1, m) * dtTick / CRAFT.minImpulse);
        if (bits <= 0) return 0;
        return s * Math.min(1, bits * CRAFT.minImpulse / dtTick);
    }

    /* Translate a 6-vector of network commands into a body-frame wrench, and
     * bill the propellant.
     *
     *   cmd[0..2]  signed translation along body X, Y, Z
     *   cmd[3..5]  signed torque about body X, Y, Z
     *
     * The force returned is the TICK-AVERAGE. A thruster pulsing at 40% duty
     * over 250 ms delivers the same impulse as 40% of its thrust held for the
     * whole tick, and the physics step here (≤ 50 ms) is far longer than the
     * 20 ms pulses, so averaging is not an approximation of the trajectory — it
     * is only an approximation of the vibration, which nothing in this sim
     * measures. */
    commandWrench(cmd, dtTick) {
        const f = [0, 0, 0], t = [0, 0, 0];
        let newtonSeconds = 0, anyOn = 0;

        const dx = Craft.quantise(cmd[0], dtTick);
        const dy = Craft.quantise(cmd[1], dtTick);
        const dz = Craft.quantise(cmd[2], dtTick);

        const fx = dx >= 0 ? CRAFT.thrustMain : CRAFT.thrustBrake;
        f[0] = dx * fx;
        f[1] = dy * CRAFT.thrustLateral;
        f[2] = dz * CRAFT.thrustLateral;
        newtonSeconds += (Math.abs(dx) * fx +
            Math.abs(dy) * CRAFT.thrustLateral +
            Math.abs(dz) * CRAFT.thrustLateral) * dtTick;
        anyOn = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));

        this.firing[0] = dx > 0 ? dx : 0; this.firing[1] = dx < 0 ? -dx : 0;
        this.firing[2] = dy > 0 ? dy : 0; this.firing[3] = dy < 0 ? -dy : 0;
        this.firing[4] = dz > 0 ? dz : 0; this.firing[5] = dz < 0 ? -dz : 0;

        for (let k = 0; k < 3; k++) {
            const d = Craft.quantise(cmd[3 + k], dtTick);
            t[k] = d * CRAFT.torqueRcs;
            this.firingRcs[k] = d;
            // A couple is two engines; the propellant bill is both of them, and
            // they cancel in force but not in mass flow.
            newtonSeconds += Math.abs(d) * 2 * 110 * dtTick;
            anyOn = Math.max(anyOn, Math.abs(d));
        }

        // Tsiolkovsky's other side: ṁ = F / (Isp g₀).
        let used = newtonSeconds / (CRAFT.isp * G0);
        if (used > this.prop) {
            // Ran the tank dry mid-tick. Scale the whole wrench by what was
            // actually available rather than letting the vehicle produce thrust
            // it did not have propellant for.
            const scale = this.prop / Math.max(used, 1e-12);
            for (let k = 0; k < 3; k++) { f[k] *= scale; t[k] *= scale; }
            used = this.prop;
        }
        this.prop -= used;
        this.mass = this.dryMass + this.prop;
        if (anyOn > 0) this.burnTime += anyOn * dtTick;
        return { f, t, used, on: anyOn > 0 };
    }

    get fuelFrac() { return this.prop / Math.max(this.prop0, 1e-9); }
    get tumbling() { return V.len(this.w) > CRAFT.maxRate; }

    /* The docking interface point, in ECI, offset from the vessel's centre of
     * mass. Everything about capture is measured here and not at the CoM — a
     * capsule 2.2 m long that is 3° off axis has its probe 11 cm off centre,
     * which is most of the capture envelope. */
    interfaceOffset() { return Q.rot(this.q, [CRAFT.dockOffset, 0, 0]); }
    noseAxis() { return Q.rot(this.q, [1, 0, 0]); }
    rollAxis() { return Q.rot(this.q, [0, 0, 1]); }
}

if (typeof module !== "undefined") module.exports = { CRAFT, Craft };
