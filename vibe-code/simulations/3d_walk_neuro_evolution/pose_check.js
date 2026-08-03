/* pose_check.js — what is actually TOUCHING the ground in each candidate pose.
 *
 *   node pose_check.js                 report every candidate
 *   node pose_check.js bridge          just one
 *   node pose_check.js bridge elbow    sweep both elbows and print the clearances
 *
 * The spawn code drops a pose until its LOWEST contact point reaches the ground
 * and then stops, so a pose only has to get the RELATIVE heights right — and
 * when it does not, the error is silent. A reverse tabletop whose arms outreach
 * its legs does not look broken: it looks like a reverse tabletop, hanging from
 * its hands with both feet 19 cm in the air, and it will spend the first tenth
 * of a second falling onto feet the pose claimed were planted.
 *
 * That is a real property of THIS body rather than a typo. Shoulder to fingertip
 * is 0.664 m against a 0.42 m thigh, so with the trunk level the hands reach
 * well below the knees. Every four-point pose has to pay for it somewhere:
 * bent elbows, a tilted trunk, or floating knees.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "pose_candidates.js"])
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });

const M = HUMANOID;
const p = new Float64Array(3);
const p1 = new Float64Array(3), p2 = new Float64Array(3);
// hand length, for the palm end of the arm vector
const Seg_hand = 0.100;

function groupOf(c) {
    if (c.foot >= 0) return c.foot === 0 ? "Lsole" : "Rsole";
    const n = M.bodies[c.body].name;
    return n.replace("Shank", "Knee");
}

/* Deepest limb-vs-limb overlap in a pose. A pose that spawns with two collision
 * spheres already interpenetrating is not merely ugly: the contact solver's whole
 * job is to push them apart, so the episode opens with a shove nobody asked for.
 * The crossed-leg twist did this by 76 mm on the first draft. */
function selfOverlap(w) {
    let worst = 0;
    for (const [a, b] of M.selfPairs) {
        w.mb.worldPoint(a.body, a.p[0], a.p[1], a.p[2], p1, 0);
        w.mb.worldPoint(b.body, b.p[0], b.p[1], b.p[2], p2, 0);
        const pen = (a.r + b.r) - Math.hypot(p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]);
        if (pen > worst) worst = pen;
    }
    return worst;
}

/* How flat a palm is lying. The hand is a paddle 28 mm thick, 100 long and 90
 * wide, so its broad face — the palm — has the hand link's own X axis for a
 * normal. Lying flat therefore means that axis points at the sky, and the world
 * X axis of link i is COLUMN 0 of its rotation, whose Y component is R[9i+3].
 * Worth scoring rather than eyeballing: a hand planted on its edge has four palm
 * corners in a line, and four collinear points generate no moment about that
 * line, so the arm can push on it but cannot stop itself pivoting over it. */
function palmFlat(w, name) {
    const i = M.bodies.findIndex(b => b.name === name);
    return Math.abs(w.mb.R[i * 9 + 3]);          // 1 = flat, 0 = on edge
}

/* Which way the fingers point, against which way the head points, both flattened
 * onto the ground. A palm can be perfectly flat and still be turned 90 degrees
 * across the body, which is a wrist nobody would put weight through. The hand
 * extends along its own -Y (it hangs from the wrist), and the head is the
 * pelvis's +Y; column k of a link's row-major rotation is (R[9i+k], R[9i+3+k],
 * R[9i+6+k]). 1 = fingers pointing the way the head is. */
function palmAim(w, tag) {
    const i = M.bodies.findIndex(b => b.name === tag + "Hand");
    const fx = -w.mb.R[i * 9 + 1], fz = -w.mb.R[i * 9 + 7];
    const hx = w.mb.R[1], hz = w.mb.R[7];
    const fn = Math.hypot(fx, fz) || 1, hn = Math.hypot(hx, hz) || 1;
    return (fx * hx + fz * hz) / (fn * hn);
}

/* How close a support arm is to vertical, measured shoulder to palm. A weight-
 * bearing arm that starts a few degrees off plumb starts with a moment about the
 * hand — the ground pushes straight up, the mass hangs to one side, and the pose
 * begins toppling before the network has had a tick. 1 = plumb. */
function armVertical(w, tag) {
    const sh = M.bodies.findIndex(b => b.name === tag + "UpperArm");
    const hd = M.bodies.findIndex(b => b.name === tag + "Hand");
    w.mb.worldPoint(sh, 0, 0, 0, p1, 0);
    w.mb.worldPoint(hd, 0, -Seg_hand, 0, p2, 0);
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1], dz = p2[2] - p1[2];
    const n = Math.hypot(dx, dy, dz) || 1;
    return -dy / n;                       // 1 = straight down from the shoulder
}

/* Height of the lowest point of every contact group, once the pose has been
 * dropped onto the ground. Zero means planted. */
function clearances(pose) {
    const net = new Net(NET_SIZES, mulberry32(1));
    const world = new World(M, [net], { stage: 1, missionSeed: 1, noise: false, noiseSeed: 1, terrainDifficulty: 0 });
    const w = world.walkers[0];
    w.reset(world, 0, 0, 0, pose);
    const best = Object.create(null);
    for (const c of M.contacts) {
        w.mb.worldPoint(c.body, c.p[0], c.p[1], c.p[2], p, 0);
        const h = p[1] - world.terrain.height(p[0], p[2]);
        const g = groupOf(c);
        if (best[g] === undefined || h < best[g]) best[g] = h;
    }
    best.__overlap = selfOverlap(w);
    best.__palm = { LHand: palmFlat(w, "LHand"), RHand: palmFlat(w, "RHand") };
    best.__arm = { L: armVertical(w, "L"), R: armVertical(w, "R") };
    best.__aim = { L: palmAim(w, "L"), R: palmAim(w, "R") };
    return best;
}

/* ---------------------------------------------------------------- the solver
 * Hand-tuning a pose against its own contact heights is a five-variable search
 * done by eye, and it does not converge — every joint that lowers the pelvis
 * also lifts a foot. So: declare which contact groups are SUPPOSED to be on the
 * ground (`plant`), and let coordinate descent move the dials.
 *
 * Two things keep this from turning a pose into something else. Every dial is
 * clamped to its joint limits, and to within `LEASH` of the angle that was
 * drawn by hand — the search is allowed to correct a posture, not to invent one.
 * What comes out is pasted back into pose_candidates.js as literals, because a
 * start pose that is recomputed at load time is a pose nobody can read.
 */
const LEASH = 0.45;   // per-candidate `leash` overrides it

function fit(c) {
    const plant = c.plant;
    if (!plant || !plant.length) return null;
    // dials: base pitch/roll, plus every joint the pose actually sets
    /* `pin` holds a joint out of the search. Without it the solver will happily
     * buy 8 cm of clearance by undoing the one angle the pose exists for — asked
     * to seat the twist, it flattened the waist yaw from 0.62 to 0.17 and handed
     * back a very well-planted pose that no longer twists. */
    const pinned = new Set((c.pin || []).map(k => J[k]));
    const dials = [];
    if (!(c.pin || []).includes("pitch")) dials.push({ k: "pitch" });
    if (!(c.pin || []).includes("roll")) dials.push({ k: "roll" });
    const forced = new Set((c.free || []).map(k => J[k]));
    for (let j = 0; j < M.nj; j++)
        if ((c.pose.q[j] !== 0 || forced.has(j)) && !pinned.has(j))
            dials.push({ k: "q", j, lo: M.bodies[j + 1].qmin, hi: M.bodies[j + 1].qmax });
    const x0 = dials.map(d => d.k === "q" ? c.pose.q[d.j] : c.pose[d.k]);

    const build = x => {
        const q = Float64Array.from(c.pose.q);
        let pitch = c.pose.pitch, roll = c.pose.roll;
        dials.forEach((d, i) => {
            if (d.k === "q") q[d.j] = x[i]; else if (d.k === "pitch") pitch = x[i]; else roll = x[i];
        });
        return Object.assign({}, c.pose, { q, pitch, roll });
    };
    const cost = x => {
        const cl = clearances(build(x));
        let s = 0;
        for (const g of plant) s += Math.pow(cl[g] === undefined ? 1 : cl[g], 2);
        // limbs through limbs cost far more than a floating contact, so the search
        // will trade several centimetres of clearance to get out of an overlap
        s += 200 * Math.pow(Math.max(0, cl.__overlap - 0.002), 2);
        // palms that are supposed to be flat on the floor, weighted to trade
        // against roughly a centimetre of clearance each
        for (const h of (c.flat || [])) s += 0.02 * Math.pow(1 - cl.__palm[h], 2);
        // a support arm off plumb costs heavily — this is the difference between a
        // pose that stands and one that starts falling on tick 1
        for (const a of (c.vertArm || [])) s += 1.20 * Math.pow(1 - cl.__arm[a], 2);
        for (const a of (c.palmAim || [])) s += 0.10 * Math.pow(1 - cl.__aim[a], 2);
        return s;
    };

    let x = x0.slice(), best = cost(x);
    for (let step = 0.30; step > 0.004; step *= 0.6) {
        let improved = true;
        while (improved) {
            improved = false;
            for (let i = 0; i < dials.length; i++) {
                for (const s of [step, -step]) {
                    const t = x.slice();
                    let v = t[i] + s;
                    const d = dials[i];
                    if (d.k === "q") v = Math.max(d.lo, Math.min(d.hi, v));
                    const lea = c.leash || LEASH;
                    v = Math.max(x0[i] - lea, Math.min(x0[i] + lea, v));
                    if (v === t[i]) continue;
                    t[i] = v;
                    const cc = cost(t);
                    if (cc < best - 1e-9) { best = cc; x = t; improved = true; }
                }
            }
        }
    }
    return { pose: build(x), rms: Math.sqrt(best / plant.length), dials, x, x0 };
}

const only = process.argv[2];
const mode = process.argv[3];
const list = POSE_CANDIDATES.filter(c => !only || c.pose.name === only);

if (mode === "fit") {
    for (const c of list) {
        const r = fit(c);
        if (!r) { console.log(c.pose.name + ": no `plant` list — nothing to fit against"); continue; }
        console.log(`\n${c.pose.name}  (planting ${c.plant.join(", ")})  residual ${(r.rms * 100).toFixed(1)} cm`);
        r.dials.forEach((d, i) => {
            if (Math.abs(r.x[i] - r.x0[i]) < 0.005) return;
            const nm = d.k === "q" ? "J." + Object.keys(J).find(k => J[k] === d.j) : d.k;
            console.log(`    ${nm.padEnd(18)} ${r.x0[i].toFixed(2)} -> ${r.x[i].toFixed(2)}`);
        });
        const cl = clearances(r.pose);
        console.log("    " + c.plant.map(g => `${g} ${((cl[g] || 0) * 100).toFixed(1)}cm`).join("  ") +
            (cl.__overlap > 0.002 ? `   overlap ${(cl.__overlap * 1000).toFixed(0)}mm` : "") +
            ((c.flat || []).length
                ? "   palm-flat " + c.flat.map(h => `${h} ${cl.__palm[h].toFixed(2)}`).join(" ") : "") +
            ((c.vertArm || []).length
                ? "   arm " + c.vertArm.map(a =>
                    `${(Math.acos(Math.min(1, cl.__arm[a])) * 180 / Math.PI).toFixed(0)}° off plumb`).join(" ") : "") +
            ((c.palmAim || []).length
                ? "   fingers " + c.palmAim.map(a =>
                    `${(Math.acos(Math.max(-1, Math.min(1, cl.__aim[a]))) * 180 / Math.PI).toFixed(0)}° off head`).join(" ") : ""));
        // ready to paste back into pose_candidates.js — the fitted pose becomes a
        // literal, because a start pose recomputed at load time is unreadable
        const names = {}; for (const k of Object.keys(J)) names[J[k]] = k;
        const edits = [];
        for (let j = 0; j < M.nj; j++)
            if (r.pose.q[j] !== 0) edits.push(`[J.${names[j]}, ${r.pose.q[j].toFixed(2)}]`);
        console.log(`\n  pose: mk("${c.pose.name}", ${r.pose.pitch.toFixed(2)}, ${r.pose.roll.toFixed(2)}, [\n` +
            "        " + edits.join(", ").replace(/(.{86,}?), /g, "$1,\n        ") + "\n    ])");
    }
    process.exit(0);
}

/* Sweep one dial and print what it plants. `pitch` moves the whole base; any
 * other name is a joint key from J and moves both sides of it. */
const SWEEPS = { elbow: ["L_ELBOW", "R_ELBOW"], hip: ["L_HIP_PITCH", "R_HIP_PITCH"],
                 knee: ["L_KNEE", "R_KNEE"], ankle: ["L_ANK_PITCH", "R_ANK_PITCH"],
                 waist: ["WAIST_PITCH"] };

if (mode === "pitch" || SWEEPS[mode]) {
    const c = list[0];
    const [lo, hi, st] = mode === "pitch" ? [-0.4, 1.6, 0.1] : [0, 2.0, 0.1];
    console.log(`sweeping ${mode} for "${c.pose.name}" — cm above the ground, 0 = planted\n`);
    for (let e = lo; e <= hi + 1e-9; e += st) {
        let po;
        if (mode === "pitch") po = Object.assign({}, c.pose, { pitch: e });
        else {
            const q = Float64Array.from(c.pose.q);
            for (const k of SWEEPS[mode]) q[J[k]] = e;
            po = Object.assign({}, c.pose, { q });
        }
        const cl = clearances(po);
        console.log(mode.padEnd(6) + e.toFixed(2) + "  " +
            Object.keys(cl).sort().map(k => `${k} ${(cl[k] * 100).toFixed(0)}`).join("  "));
    }
} else if (mode === "full") {
    for (const c of list) {
        const cl = clearances(c.pose);
        console.log(c.pose.name + "\n  " + Object.entries(cl).sort((a, b) => a[1] - b[1])
            .map(([g, h]) => `${g} ${(h * 100).toFixed(0)}`).join("  "));
    }
} else {
    for (const c of list) {
        const cl = clearances(c.pose);
        const ov = cl.__overlap, pm = cl.__palm, ar = cl.__arm, am = cl.__aim;
        delete cl.__overlap; delete cl.__palm; delete cl.__arm; delete cl.__aim;
        const planted = Object.entries(cl).filter(([, h]) => h < 0.02).map(([g]) => g);
        const near = Object.entries(cl).filter(([, h]) => h >= 0.02 && h < 0.30)
            .sort((a, b) => a[1] - b[1]).map(([g, h]) => `${g} ${(h * 100).toFixed(0)}cm`);
        console.log(c.pose.name.padEnd(11) + "planted: " + planted.join(" ").padEnd(30) +
            "  floating: " + near.join(" ") +
            (ov > 0.002 ? `   *** ${(ov * 1000).toFixed(0)} mm LIMB OVERLAP ***` : "") +
            ((c.flat || []).length
                ? "   palms " + c.flat.map(h => `${h} ${pm[h].toFixed(2)}`).join(" ") : "") +
            ((c.vertArm || []).length
                ? "   arm-plumb " + c.vertArm.map(a => `${a} ${ar[a].toFixed(3)}` +
                    ` (${(Math.acos(Math.min(1, ar[a])) * 180 / Math.PI).toFixed(0)}° off)`).join(" ") : "") +
            ((c.palmAim || []).length
                ? "   fingers " + c.palmAim.map(a =>
                    `${(Math.acos(Math.max(-1, Math.min(1, am[a]))) * 180 / Math.PI).toFixed(0)}° off head`).join(" ") : ""));
    }
}
