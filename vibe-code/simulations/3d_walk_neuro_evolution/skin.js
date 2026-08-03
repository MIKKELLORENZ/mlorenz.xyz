/* skin.js — what the humanoid LOOKS like, and nothing else.
 *
 * `body.js` is the truth: it owns every segment length, every mass, every joint
 * axis, and the collision boxes those masses were integrated from. Nothing in
 * this file may change any of that. What it does is describe a nicer set of
 * SHAPES to hang on the same skeleton — tapered limbs instead of prisms, a
 * chest that narrows into a waist, a neck where there used to be a 50 mm gap of
 * air under a floating head, and a rotary actuator drawn at every joint the
 * model actually carries.
 *
 * Two reasons this is a separate file rather than prettier boxes in body.js:
 *
 *   1. The render mesh used to BE the collision mesh, which is an honest thing
 *      to show and the reason the doll was deliberately blocky. That property is
 *      preserved differently now: every shape here is derived from `model.seg`
 *      and sized to sit at or just INSIDE the box it replaces, so the visible
 *      body can never poke out of the body the physics is solving. Where the two
 *      disagree the visible one is the smaller, which is why the clipping goes
 *      away rather than moving somewhere else.
 *   2. The actuators are the honest part. There are 22 one-DoF joints in this
 *      machine and the old view drew none of them, so a three-DoF hip looked
 *      like a thigh growing out of a pelvis. Each drum below sits exactly on its
 *      joint's origin, points along exactly that joint's axis, and is sized from
 *      that joint's `tauMax` — a 260 N·m knee is visibly a bigger machine than a
 *      25 N·m wrist, because it is.
 *
 * ---------------------------------------------------------------- part shapes
 * Everything is expressed in its own link's frame, the same frame the physics
 * reports, so a part needs no transform of its own beyond the one the multibody
 * already computed.
 *
 *   {k:"tube", a, b, r0, r1, sx, sy, sz}
 *      A tapered cylinder from point `a` (radius r0) to point `b` (radius r1).
 *      `a`→`b` is always axis-aligned; sx/sy/sz squash the cross-section along
 *      the LINK's axes, and the renderer picks whichever two are transverse to
 *      the tube. Axis-alignment is what makes that unambiguous — a tube pointing
 *      somewhere diagonal would have no defined "up" to squash against.
 *   {k:"ball", c, r, sx, sy, sz}       ellipsoid
 *   {k:"box",  c, d}                   the old primitive, kept for the sole
 *   {k:"drum", c, axis, r, len}        a rotary actuator on joint `axis`
 *
 * Flags: `core` marks the ~18 parts a ghost walker draws. The swarm can be 40
 * dolls deep and at 16–26% opacity nobody is reading a wrist fillet off it, so
 * ghosts get the silhouette and the leader gets the machine.
 */
"use strict";

function buildSkin(model) {
    const S = model.seg;
    const n = model.bodies.length;
    const idx = name => model.bodies.findIndex(b => b.name === name);
    const parts = [];
    for (let i = 0; i < n; i++) parts.push([]);

    /* The cross-section radius each link presents AT ITS OWN JOINT. The drums
     * are sized against this so an actuator is never thinner than the limb it
     * drives — a wrist drum lost inside the forearm reads as a mistake. */
    const jointR = new Float64Array(n);
    // …and how that joint ball is squashed. Only the thigh needs it: a round
    // ball of thigh radius is 6 mm wider than `thighZ` allows, and the 90 mm
    // between the legs is a budget, not a suggestion.
    const jointS = [];
    for (let i = 0; i < n; i++) jointS.push([1, 1, 1]);

    /* A hard ceiling on a drum's radius, where the joint sits close to a
     * surface that touches the world. Only the ankle needs one: it is 66 mm
     * above the sole, and a drum sized purely from its 190 N·m of torque came
     * out at 64 mm with a 69 mm collar — which put a dark cylinder and a white
     * ring straight through the bottom of the foot, visible as a patch on the
     * sole. The cap is expressed against the COLLAR radius (`r * 1.07` in
     * render.js), because that is the outermost thing a drum draws. */
    const COLLAR = 1.07;
    const drumCap = new Float64Array(n).fill(Infinity);

    const tube = (a, b, r0, r1, o) => Object.assign({ k: "tube", a, b, r0, r1, sx: 1, sy: 1, sz: 1 }, o || {});
    const ball = (c, r, o) => Object.assign({ k: "ball", c, r, sx: 1, sy: 1, sz: 1 }, o || {});
    const box = (c, d, o) => Object.assign({ k: "box", c, d }, o || {});
    const put = (i, ...ps) => { for (const p of ps) parts[i].push(p); };

    /* ------------------------------------------------------------- pelvis (0)
     * Collision box: 0.240 x 0.220 x 0.300 centred 30 mm above the hip line.
     * Drawn as a wide seat narrowing into a waist, which is both the human
     * shape and the thing that stops the torso and the pelvis interpenetrating
     * every time the waist pitches: two cylinders sliding past each other have
     * no corners to poke through, where two boxes have eight each. */
    put(0,
        tube([0, -0.080, 0], [0, 0.020, 0], 0.113, 0.113, { sx: 0.95, sz: 1.31, core: 1 }),
        /* Narrows hard, to 55 x 138 mm at the top. The waist carries the biggest
         * actuator on the machine — 260 N·m, an 80 mm drum — and the first two
         * cuts of this file left both the pelvis and the abdomen fatter than it,
         * so the largest joint the walker has was completely invisible. A body
         * that pinches at the waist is also just what a body does. */
        tube([0, 0.020, 0], [0, S.waistY, 0], 0.113, 0.058, { sx: 0.95, sz: 1.22, core: 1 })
    );

    /* -------------------------------------------------------------- torso
     * Origin sits at the waist joint; the shoulder line is at S.torso.
     *
     * The head used to float: `headGap` is a real 50 mm of nothing between the
     * shoulder line and the base of the skull, and the old view drew the head
     * box and skipped the gap. It gets a neck.
     *
     * The shoulders used to float too, for the same reason in the other
     * direction — `shoulderZ` is 0.215 against a chest half-width of 0.150, so
     * 65 mm of air separated each arm from the body it hangs off. The yoke is
     * that clavicle. */
    const iTorso = idx("torso");
    jointR[iTorso] = 0.058;
    const headY = S.torso + S.headGap + S.head * 0.5;
    put(iTorso,
        /* Meets the pelvis exactly at the waist joint, at exactly the pelvis's
         * top radius. The first cut had it start 10 mm inside the pelvis to
         * guarantee no gap, and that overlap is precisely what grinds through
         * itself as the waist pitches — two cylinders sharing a volume show
         * their intersection curve, and it moves. Butted at the pivot, with the
         * 80 mm waist drum wrapping the seam, they hinge cleanly instead. */
        tube([0, 0, 0], [0, 0.150, 0], 0.058, 0.108, { sz: 1.24, core: 1 }),
        tube([0, 0.150, 0], [0, 0.300, 0], 0.108, 0.113, { sz: 1.32, core: 1 }),
        tube([0, 0.300, 0], [0, S.torso, 0], 0.113, 0.097, { sz: 1.37 }),
        /* Clavicle: chest edge out to each shoulder joint. Reaches 215 mm off
         * the midline against a 150 mm collision half-width, which is the
         * second `beyond` — and it is not new width, because the upper arm has
         * always hung at that offset and drawn out to 260 mm. It only fills in
         * the 65 mm of nothing that made the arms look bolted onto air. */
        tube([0, S.torso - 0.014, -S.shoulderZ], [0, S.torso - 0.014, S.shoulderZ], 0.050, 0.050, { beyond: 1 }),
        tube([0, S.torso, 0], [0, S.torso + S.headGap, 0], 0.047, 0.043, { core: 1 }),
        ball([0, headY, 0], 0.100, { sy: 1.14, sz: 0.99, core: 1 }),
        /* A face, so heading is readable at a glance. The doll walks toward +X
         * and until now nothing on it said so from behind.
         *
         * A flattened ball does not work here and the first two tries proved
         * it: small enough to sit on the face it is swallowed by the skull,
         * wide enough to read as a visor and its ends float off the curve,
         * because a sphere gets narrower as it goes forward and an ellipsoid
         * does not. A cone does — wide end buried at x = 70 mm where the skull
         * is still 71 mm across, narrow end poking through the nose. */
        tube([0.050, headY - 0.006, 0], [0.098, headY - 0.006, 0], 0.078, 0.042, { sy: 0.38, sz: 1.08, dark: 1 })
    );

    /* --------------------------------------------------------------- arms */
    for (const tag of ["L", "R"]) {
        const ua = idx(tag + "UpperArm"), fa = idx(tag + "Forearm"), hd = idx(tag + "Hand");
        jointR[ua] = 0.045; jointR[fa] = 0.040; jointR[hd] = 0.026;
        put(ua, tube([0, -0.004, 0], [0, -S.upperArm, 0], 0.045, 0.037, { core: 1 }));
        put(fa, tube([0, 0, 0], [0, -S.forearm, 0], 0.040, 0.032, { core: 1 }));
        /* The hand is a flat paddle in the physics (28 x 100 x 90 mm) and four
         * palm corners are what let an arm press against the floor, so it stays
         * a paddle here — squashed on the link's x, wide on its z. */
        put(hd,
            tube([0, -0.006, 0], [0, -0.092, 0], 0.029, 0.029, { sx: 0.48, sz: 1.53, core: 1 }),
            ball([0, -0.092, 0], 0.029, { sx: 0.48, sy: 0.30, sz: 1.53 })
        );
    }

    /* --------------------------------------------------------------- legs
     * Thigh and shank are kept inside their clearance budget on purpose: the
     * 90 mm of air between the thighs is a limit the hip roll ranges were sized
     * against (see body.js), so a visual thigh wider than `thighZ` would draw
     * the legs touching in poses the solver considers clear. */
    for (const tag of ["L", "R"]) {
        const th = idx(tag + "Thigh"), sh = idx(tag + "Shank"), ft = idx(tag + "Foot");
        jointR[th] = 0.065; jointR[sh] = 0.050; jointR[ft] = 0.046;
        jointS[th] = [1, 1, 0.92];
        // 4 mm of daylight between the collar and the sole
        drumCap[ft] = drumCap[idx(tag + "AnklePitchLink")] = (S.ankleH - 0.004) / COLLAR;
        put(th, tube([0, -0.008, 0], [0, -S.thigh, 0], 0.065, 0.052, { sz: 0.91, core: 1 }));
        put(sh,
            tube([0, -0.004, 0], [0, -S.shank, 0], 0.051, 0.034, { core: 1 }),
            // calf, laid over the shin so a ghost can skip it without a hole
            tube([0, -0.030, 0], [0, -0.185, 0], 0.049, 0.055, { sz: 1.02 })
        );
        /* The sole stays a box at full extent. Its four corners ARE the contact
         * points the physics tests, and rounding them off would put the visible
         * foot somewhere other than where the ground is being felt.
         *
         * It is only 16 mm thick, though, and the boot above it runs almost the
         * whole length: a thin plate under a short pad read as a walker standing
         * on a skateboard. */
        const footCx = (S.footToe - S.footHeel) * 0.5;
        put(ft,
            box([footCx, -S.ankleH + 0.008, 0], [S.footToe + S.footHeel, 0.016, S.footW * 0.92], { core: 1 }),
            tube([-S.footHeel + 0.004, -0.033, 0], [S.footToe - 0.002, -0.033, 0], 0.044, 0.032,
                { sy: 0.72, sz: 1.12 })
        );
    }

    /* ------------------------------------------------------------ actuators
     * Joint j drives body j+1, and body j+1's frame origin IS that joint. So a
     * drum at the local origin, pointing along the link's own axis, lands on
     * the real joint by construction — there is no place to write a wrong
     * number down.
     *
     * Multi-DoF joints are short chains of 1-DoF revolutes through weightless
     * carriers, all at the same point, so a hip is three coincident drums. Real
     * machines look exactly like this (see any humanoid's shoulder), but three
     * equal cylinders at one origin would z-fight into mush, so a cluster is
     * ordered by torque and each successive drum steps down 13% — the strongest
     * actuator is the outermost one, which is also how they are built. */
    const kids = [];
    for (let i = 0; i < n; i++) kids.push([]);
    for (let i = 1; i < n; i++) kids[model.bodies[i].parent].push(i);
    // A carrier has no shape of its own; borrow the radius of whatever it carries.
    const radiusOf = i => {
        if (jointR[i] > 0) return jointR[i];
        for (const c of kids[i]) { const r = radiusOf(c); if (r > 0) return r; }
        return 0.040;
    };
    // Coincident joints share a cluster root: zero offset from a parent that is
    // itself a joint link means "same point in space".
    const root = new Int32Array(n).fill(-1);
    for (let i = 1; i < n; i++) {
        const p = model.bodies[i].parent, r = model.bodies[i].r;
        root[i] = (p >= 1 && r[0] === 0 && r[1] === 0 && r[2] === 0) ? root[p] : i;
    }
    const clusters = new Map();
    for (let i = 1; i < n; i++) {
        if (!clusters.has(root[i])) clusters.set(root[i], []);
        clusters.get(root[i]).push(i);
    }
    for (const members of clusters.values()) {
        // Torque sets the size, so the biggest actuator in a cluster is the one
        // doing the most work — a hip reads as pitch-over-roll-over-yaw, which
        // is the load order.
        members.sort((a, b) => model.bodies[b].tauMax - model.bodies[a].tauMax);
        /* Radius from torque, floored by the limb it drives. The torque term
         * has to be the one that usually wins or the drums vanish: the waist
         * carries the largest actuator on the machine (260 N·m) and at a gentler
         * coefficient it sat entirely inside the abdomen, which is the opposite
         * of the point. 260 N·m -> 80 mm, 25 N·m -> 28 mm. */
        let base = 0;
        for (const i of members) {
            const tauR = 0.022 + 0.058 * (model.bodies[i].tauMax / 260);
            base = Math.max(base, tauR, 1.06 * radiusOf(i));
        }
        members.forEach((i, k) => {
            const r = Math.min(base * Math.pow(0.87, k), drumCap[i]);
            const len = Math.max(0.045, Math.min(0.115, r * 1.40));
            put(i, { k: "drum", c: [0, 0, 0], axis: model.bodies[i].axis, r, len });
        });
    }

    /* A ball on each limb's own joint, tucked under that joint's drum. This is
     * the fix for the bent-knee corner: two tubes meeting at a sphere of the
     * same radius stay closed at any angle, where two prisms show the corner of
     * one poking through the face of the other. Every one of these is smaller
     * than the drum that covers it — worth re-checking if a torque ever moves.
     *
     * Not `core`: a ghost is a 16–26% translucent silhouette in a swarm forty
     * deep, and 13 more spheres each is real cost for a fillet nobody can see. */
    for (let i = 1; i < n; i++) {
        if (jointR[i] > 0) {
            const s = jointS[i];
            parts[i].push(ball([0, 0, 0], jointR[i], { sx: s[0], sy: s[1], sz: s[2] }));
        }
    }

    return { parts, jointR };
}

if (typeof module !== "undefined") module.exports = { buildSkin };
