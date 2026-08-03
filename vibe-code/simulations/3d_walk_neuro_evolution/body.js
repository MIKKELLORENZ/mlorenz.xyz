/* body.js — the humanoid. Deliberately blocky: every segment is a box, so the
 * thing you see on screen is exactly the thing the physics integrates. What is
 * *not* simplified is the articulation — this is the joint set a real humanoid
 * robot carries, with realistic segment masses (Winter's anthropometry for a
 * 1.70 m / 65 kg adult), realistic peak joint torques, and geared-servo rotor
 * inertia (`armature`) reflected into each joint.
 *
 * 19 links, 18 actuated 1-DoF joints, plus the 6-DoF floating pelvis = 24 DoF.
 * Multi-axis joints (hip, ankle, waist) are built as short chains of 1-DoF
 * revolutes through weightless carrier links — the standard trick, and it keeps
 * every joint a scalar the network can command and a servo can drive.
 *
 * Frame convention: +X forward, +Y up, +Z to the doll's LEFT.
 *   · rotation about +Z ("pitch") swings a downward-hanging limb FORWARD
 *   · rotation about +X ("roll") swings it to the doll's RIGHT
 *   · rotation about +Y ("yaw") turns the doll LEFT
 */
"use strict";

/* Segment geometry (m). Everything downstream — inertia, contact points, the
 * rendered mesh — is derived from these numbers, never hand-copied. */
const SEG = {
    ankleH: 0.066,      // sole to ankle joint
    footHeel: 0.075,    // ankle back to heel
    footToe: 0.183,     // ankle forward to toe
    footW: 0.100,
    shank: 0.418,       // ankle to knee
    thigh: 0.417,       // knee to hip
    /* Hip separation and thigh width are a CLEARANCE BUDGET, not two free
     * numbers. At the original 0.085 / 0.140 the thighs sat 30 mm apart, while
     * a hip-roll limit of 0.50 rad swings a 0.835 m leg 400 mm sideways — so
     * the limits permitted a thigh to pass clean through the other one, and a
     * sweep of the reachable joint space found exactly that in 45.8% of poses,
     * 176 mm deep. Widening the hips and slimming the thighs buys 90 mm of gap,
     * which the mirrored roll limits below are then sized against. */
    hipZ: 0.105,        // half the hip separation
    thighZ: 0.120,      // thigh width — 90 mm of air between the legs
    waistY: 0.100,      // hip centre up to the waist joint
    torso: 0.390,       // waist up to the shoulder line
    torsoZ: 0.300,      // chest width
    /* shoulderZ must clear the chest: torsoZ/2 + forearm half-width + margin.
     * At 0.190 against a 0.340-wide torso the arms were 20 mm INSIDE the chest
     * in the rest pose — the body was built self-intersecting. */
    shoulderZ: 0.215,   // half the shoulder separation
    upperArm: 0.316,
    forearm: 0.248,
    /* A flat paddle hand, no fingers — the same thing a poseable mannequin has,
     * and the same thing this needs. The arm used to end at the wrist with a
     * SINGLE ground contact point, and a single point generates no moment: it
     * can push, but it cannot stop the forearm pivoting around it. Nothing gets
     * up off the floor on two pinpoints, which made the prone and supine starts
     * not merely hard but unreachable. Four palm corners can plant and press. */
    hand: 0.100,        // wrist to fingertip-equivalent
    handW: 0.090,
    handT: 0.028,
    headGap: 0.050,     // shoulder line to the base of the head
    head: 0.230
};
const TOTAL_MASS = 65.0;
const TOTAL_HEIGHT = SEG.ankleH + SEG.shank + SEG.thigh + SEG.waistY + SEG.torso + SEG.headGap + SEG.head;

/* Inertia of a solid box about its own centre. */
function boxInertia(m, a, b, c) {
    return [m * (b * b + c * c) / 12, m * (a * a + c * c) / 12, m * (a * a + b * b) / 12];
}
/* Merge a list of boxes ({c:[x,y,z], d:[a,b,c], m}) into one rigid body. */
function composite(boxes) {
    let m = 0, cx = 0, cy = 0, cz = 0;
    for (const b of boxes) { m += b.m; cx += b.m * b.c[0]; cy += b.m * b.c[1]; cz += b.m * b.c[2]; }
    if (m <= 0) return { mass: 0, com: [0, 0, 0], inertia: [0, 0, 0], boxes };
    cx /= m; cy /= m; cz /= m;
    let ix = 0, iy = 0, iz = 0;
    for (const b of boxes) {
        const bi = boxInertia(b.m, b.d[0], b.d[1], b.d[2]);
        const dx = b.c[0] - cx, dy = b.c[1] - cy, dz = b.c[2] - cz;
        ix += bi[0] + b.m * (dy * dy + dz * dz);
        iy += bi[1] + b.m * (dx * dx + dz * dz);
        iz += bi[2] + b.m * (dx * dx + dy * dy);
    }
    return { mass: m, com: [cx, cy, cz], inertia: [ix, iy, iz], boxes };
}

const AX_X = 0, AX_Y = 1, AX_Z = 2;
const CARRIER = { mass: 0, com: [0, 0, 0], inertia: [0, 0, 0], boxes: [] };

/* Joint indices — the order buildHumanoid() adds them in. Joint j drives body j+1. */
const J = {
    WAIST_YAW: 0, WAIST_PITCH: 1,
    L_SHOULDER: 2, L_SHOULDER_ROLL: 3, L_ELBOW: 4, L_WRIST: 5,
    R_SHOULDER: 6, R_SHOULDER_ROLL: 7, R_ELBOW: 8, R_WRIST: 9,
    L_HIP_YAW: 10, L_HIP_ROLL: 11, L_HIP_PITCH: 12, L_KNEE: 13, L_ANK_PITCH: 14, L_ANK_ROLL: 15,
    R_HIP_YAW: 16, R_HIP_ROLL: 17, R_HIP_PITCH: 18, R_KNEE: 19, R_ANK_PITCH: 20, R_ANK_ROLL: 21
};
/* Winter's segment mass fractions, scaled to TOTAL_MASS. */
const MF = f => f * TOTAL_MASS;

function buildHumanoid() {
    const S = SEG;
    const bodies = [];
    const add = (name, parent, axis, r, geom, joint) => {
        const b = Object.assign({ name, parent, axis, r }, geom, joint || {});
        bodies.push(b);
        return bodies.length - 1;
    };

    /* The two keyframe poses every joint carries:
     *   `nominal` — relaxed standing, and also the centre of the range the
     *      network commands. A newborn's sigmoids all read 0.5, which lands
     *      exactly here, so an unevolved brain says "stand normally" rather than
     *      "fire every actuator". This is the walker's hover trim.
     *   `crouch` — the half-squat every episode starts from. Its depth is tuned
     *      so the *default* controller very nearly survives the rise: measured,
     *      it stands, holds for ~3 s and then topples. A crouch it survives
     *      makes stage 1 free; one it cannot survive leaves nothing to select
     *      on. Nearly-succeeding is the useful place to start.
     *
     * The leg angles satisfy anklePitch = -(hipPitch + knee), which is exactly
     * the condition for the soles to stay flat on the ground in both poses. */

    /* --- 0: pelvis (floating base). Its frame origin sits at the hip centre. --- */
    const pelvis = composite([{ c: [0, 0.030, 0], d: [0.240, 0.220, 0.300], m: MF(0.142) }]);
    add("pelvis", -1, AX_Y, [0, 0, 0], pelvis);

    /* --- waist: yaw then pitch, carrying the torso+head --- */
    add("waistYawLink", 0, AX_Y, [0, S.waistY, 0], CARRIER,
        { qmin: -0.70, qmax: 0.70, kp: 320, kd: 20, tauMax: 140, armature: 0.10, nominal: 0, crouch: 0 });
    const torsoTop = S.torso;
    const torso = composite([
        { c: [0, torsoTop * 0.5, 0], d: [0.260, torsoTop, S.torsoZ], m: MF(0.355) },
        { c: [0, torsoTop + S.headGap + S.head * 0.5, 0], d: [0.200, S.head, 0.200], m: MF(0.081) }
    ]);
    /* Waist pitch reaches much further forward than it used to. At -0.60 the
     * trunk could flex 34°, which is fine for walking and useless for getting
     * off the floor — a sit-up starts with the trunk, and 34° does not clear
     * the hips. Negative is forward flexion here (rotation about +Z tips the
     * torso's up-axis toward -X). The extra torque is because it now has to
     * lift the trunk against gravity rather than merely trim it. */
    const iTorso = add("torso", 1, AX_Z, [0, 0, 0], torso,
        { qmin: -1.20, qmax: 0.45, kp: 600, kd: 36, tauMax: 260, armature: 0.10, nominal: 0, crouch: -0.15 });

    /* --- arms: shoulder pitch + elbow, one side then the other --- */
    const upperArm = composite([{ c: [0, -S.upperArm * 0.5, 0], d: [0.090, S.upperArm, 0.090], m: MF(0.028) }]);
    const forearm = composite([{ c: [0, -S.forearm * 0.5, 0], d: [0.080, S.forearm, 0.080], m: MF(0.016) }]);
    const hand = composite([{ c: [0, -S.hand * 0.5, 0], d: [S.handT, S.hand, S.handW], m: MF(0.006) }]);
    const hands = {};
    /* Three DoF per arm: pitch, roll, elbow. A one-axis shoulder is not a
     * humanoid shoulder — every real machine carries at least three — and the
     * missing roll had a second cost here: with the arm locked in the sagittal
     * plane it had nowhere to go but through the hip, which a sweep of the
     * reachable joint space duly found. A small nominal ABDUCTION hangs the
     * arms clear of the pelvis, and roll is deeply asymmetric because the arm
     * runs into the ribs long before it reaches the midline. */
    const ARM_ABDUCT = 1.90, ARM_ADDUCT = 0.20, ARM_REST = 0.12;
    for (const [tag, sz] of [["L", 1], ["R", -1]]) {
        // rotation about +X swings a hanging limb to the doll's RIGHT, so
        // abduction is negative on the left arm and positive on the right
        const sp = add(tag + "ShoulderPitchLink", iTorso, AX_Z, [0, S.torso, sz * S.shoulderZ], CARRIER,
            { qmin: -1.60, qmax: 1.60, kp: 110, kd: 7, tauMax: 60, armature: 0.04, nominal: 0, crouch: -0.20 });
        const ua = add(tag + "UpperArm", sp, AX_X, [0, 0, 0], upperArm, {
            qmin: sz > 0 ? -ARM_ABDUCT : -ARM_ADDUCT,
            qmax: sz > 0 ? ARM_ADDUCT : ARM_ABDUCT,
            kp: 100, kd: 6, tauMax: 55, armature: 0.04,
            nominal: -sz * ARM_REST, crouch: -sz * ARM_REST
        });
        const fa = add(tag + "Forearm", ua, AX_Z, [0, -S.upperArm, 0], forearm,
            { qmin: 0.00, qmax: 2.40, kp: 70, kd: 4, tauMax: 40, armature: 0.02, nominal: 0.25, crouch: 0.30 });
        // Wrist pitch, so the palm can lie FLAT on the floor instead of meeting
        // it at whatever angle the forearm happens to hold. Without it the hand
        // is a rigid extension of the forearm and planting it is luck.
        hands[tag] = add(tag + "Hand", fa, AX_Z, [0, -S.forearm, 0], hand,
            { qmin: -1.20, qmax: 1.20, kp: 45, kd: 3, tauMax: 25, armature: 0.012, nominal: 0, crouch: 0 });
    }

    /* --- legs: hip yaw / roll / pitch, knee, ankle pitch / roll --- */
    const thigh = composite([{ c: [0, -S.thigh * 0.5, 0], d: [0.130, S.thigh, S.thighZ], m: MF(0.100) }]);
    const shank = composite([{ c: [0, -S.shank * 0.5, 0], d: [0.110, S.shank, 0.120], m: MF(0.0465) }]);
    const footCx = (S.footToe - S.footHeel) * 0.5;
    const foot = composite([{ c: [footCx, -S.ankleH * 0.5, 0], d: [S.footToe + S.footHeel, S.ankleH, S.footW], m: MF(0.0145) }]);
    const feet = {};
    for (const [tag, sz] of [["L", 1], ["R", -1]]) {
        const hy = add(tag + "HipYawLink", 0, AX_Y, [0, 0, sz * S.hipZ], CARRIER,
            { qmin: -0.60, qmax: 0.60, kp: 300, kd: 18, tauMax: 110, armature: 0.10, nominal: 0, crouch: 0 });
        /* Hip roll is MIRRORED, which the original symmetric ±0.50 was not.
         * Rotation about +X swings a hanging limb to the doll's right, so for
         * the left leg positive roll is adduction (toward the midline) and for
         * the right leg it is abduction. A real humanoid hip is deeply
         * asymmetric here — large abduction, small adduction — and a symmetric
         * limit is what let both legs swing toward the centreline at once and
         * pass through each other. Adduction alone cannot close the gap: even
         * at 0.22 rad an ankle travels 180 mm inward against 90 mm of air, so
         * the limits get the range right and _selfCollide() catches the rest,
         * which is exactly how a real robot handles it. */
        const ADDUCT = 0.22, ABDUCT = 0.55;
        const hr = add(tag + "HipRollLink", hy, AX_X, [0, 0, 0], CARRIER, {
            qmin: sz > 0 ? -ABDUCT : -ADDUCT,
            qmax: sz > 0 ? ADDUCT : ABDUCT,
            kp: 700, kd: 40, tauMax: 220, armature: 0.12, nominal: 0, crouch: 0
        });
        const th = add(tag + "Thigh", hr, AX_Z, [0, 0, 0], thigh,
            { qmin: -0.90, qmax: 1.80, kp: 800, kd: 45, tauMax: 240, armature: 0.12, nominal: 0.05, crouch: 0.55 });
        const sh = add(tag + "Shank", th, AX_Z, [0, -S.thigh, 0], shank,
            { qmin: -2.40, qmax: 0.00, kp: 800, kd: 45, tauMax: 260, armature: 0.12, nominal: -0.10, crouch: -1.16 });
        const ap = add(tag + "AnklePitchLink", sh, AX_Z, [0, -S.shank, 0], CARRIER,
            { qmin: -0.90, qmax: 0.90, kp: 700, kd: 40, tauMax: 190, armature: 0.10, nominal: 0.05, crouch: 0.61 });
        feet[tag] = add(tag + "Foot", ap, AX_X, [0, 0, 0], foot,
            { qmin: -0.45, qmax: 0.45, kp: 420, kd: 24, tauMax: 140, armature: 0.08, nominal: 0, crouch: 0 });
    }

    const model = { bodies, seg: S, footBody: [feet.L, feet.R] };

    /* ---------------------------------------------------------- ground poses
     * Where a walker starts when it is not starting on its feet. Each is a
     * joint pose plus a pelvis attitude; reset() drops the assembled body onto
     * the terrain, so these only have to be roughly right and the contact
     * solver does the rest.
     *
     * `pitch` is about +Z, which tips the body's up-axis toward -X, so +90°
     * lands it on its back with the head trailing and +90° of roll puts it on
     * its side. They are ordered by how hard they are to get out of, because
     * the curriculum introduces them in that order — a fleet that cannot stand
     * from a crouch has no business being dropped face-down.
     */
    const nj0 = bodies.length - 1;
    const gp = (name, pitch, roll, edits) => {
        const q = new Float64Array(nj0);
        for (const [j, v] of edits) q[j] = v;
        return { name, pitch, roll, q };
    };
    /* ------------------------------------------------------- crouch depth
     * The floor poses below turned out to be unreachable: four hand-scripted
     * rise attempts from every one of them left the centre of mass at exactly
     * its starting height, and the knee was already at its 260 N·m limit merely
     * HOLDING a deep tuck. That is a capability wall, not a search problem, and
     * no reward or mutation step gets over it.
     *
     * Depth is the way round it. It is a continuous parameter between the
     * ordinary crouch the run already starts from (0) and a deep folded squat
     * near the floor (1), so "get up" stops being a cliff and becomes a ramp
     * the curriculum can walk down one notch at a time — which is how every
     * other skill in this simulation was actually learned.
     */
    model.crouchAt = depth => {
        const q = new Float64Array(nj0);
        const d = Math.max(0, Math.min(1, depth));
        for (let j = 0; j < nj0; j++) q[j] = model.crouch[j];
        // deepen the squat while keeping anklePitch = -(hipPitch + knee), the
        // condition that holds the soles flat
        const hip = model.crouch[J.L_HIP_PITCH] + d * 1.05;
        const knee = model.crouch[J.L_KNEE] - d * 0.95;
        for (const [h, k, a] of [[J.L_HIP_PITCH, J.L_KNEE, J.L_ANK_PITCH], [J.R_HIP_PITCH, J.R_KNEE, J.R_ANK_PITCH]]) {
            q[h] = hip; q[k] = knee; q[a] = -(hip + knee);
        }
        q[J.WAIST_PITCH] = model.crouch[J.WAIST_PITCH] - d * 0.45;   // fold forward over the knees
        q[J.L_SHOULDER] = model.crouch[J.L_SHOULDER] + d * 0.85;
        q[J.R_SHOULDER] = model.crouch[J.R_SHOULDER] + d * 0.85;
        return { name: `crouch${d.toFixed(2)}`, pitch: 0, roll: 0, q, depth: d };
    };

    model.groundPoses = [
        /* Sitting with the knees UP and the feet close to the body — how someone
         * actually sits on the ground, and the only sitting posture a rise can
         * start from. The previous version had the knees bent just 34 degrees
         * with the hips at 89, i.e. legs straight out in front: to stand from
         * that the walker must first haul both feet back underneath itself, a
         * long blind sequence with no reward gradient along it. Six champions
         * all scored 0/6 from it, and a scripted attempt could not do it either,
         * so the pose — not the search — was the wall. Feet under the mass makes
         * the rise a push rather than a puzzle. */
        gp("seated", 0.22, 0, [
            [J.WAIST_PITCH, -0.28],
            [J.L_HIP_PITCH, 1.50], [J.R_HIP_PITCH, 1.50],
            [J.L_KNEE, -1.95], [J.R_KNEE, -1.90],
            [J.L_ANK_PITCH, 0.50], [J.R_ANK_PITCH, 0.50],
            // Hands back beside the hips, ready to press — the arms now have
            // ground contact and cannot pass through the chest, so this is a
            // usable push-off rather than decoration.
            [J.L_SHOULDER, -0.70], [J.R_SHOULDER, -0.70],
            [J.L_ELBOW, 0.35], [J.R_ELBOW, 0.35],
            [J.L_WRIST, -0.70], [J.R_WRIST, -0.70]
        ]),
        gp("side", 0.35, 1.45, [
            [J.L_HIP_PITCH, 1.20], [J.R_HIP_PITCH, 0.85],
            [J.L_KNEE, -1.30], [J.R_KNEE, -0.95],
            [J.L_SHOULDER, 0.7], [J.R_SHOULDER, 1.1],
            [J.L_SHOULDER_ROLL, -0.5], [J.R_SHOULDER_ROLL, 0.3],
            [J.L_ELBOW, 1.1], [J.R_ELBOW, 0.8],
            [J.L_WRIST, -0.5], [J.R_WRIST, -0.4]
        ]),
        gp("curled", 0.6, 1.35, [
            [J.WAIST_PITCH, -0.5],
            [J.L_HIP_PITCH, 1.70], [J.R_HIP_PITCH, 1.65],
            [J.L_KNEE, -2.00], [J.R_KNEE, -1.90],
            [J.L_SHOULDER, 1.2], [J.R_SHOULDER, 1.2],
            [J.L_ELBOW, 1.6], [J.R_ELBOW, 1.6]
        ]),
        gp("supine", 1.50, 0, [
            [J.L_HIP_PITCH, 0.35], [J.R_HIP_PITCH, 0.30],
            [J.L_KNEE, -0.45], [J.R_KNEE, -0.40],
            [J.L_SHOULDER, -0.6], [J.R_SHOULDER, -0.6],
            [J.L_SHOULDER_ROLL, -0.7], [J.R_SHOULDER_ROLL, 0.7],
            [J.L_ELBOW, 0.4], [J.R_ELBOW, 0.4],
            [J.L_WRIST, -0.6], [J.R_WRIST, -0.6]
        ]),
        gp("prone", -1.50, 0, [
            [J.L_HIP_PITCH, -0.20], [J.R_HIP_PITCH, -0.15],
            [J.L_KNEE, -0.30], [J.R_KNEE, -0.25],
            [J.L_SHOULDER, 1.4], [J.R_SHOULDER, 1.4],
            [J.L_SHOULDER_ROLL, -0.6], [J.R_SHOULDER_ROLL, 0.6],
            [J.L_ELBOW, 1.5], [J.R_ELBOW, 1.5],
            // palms flat under the shoulders, which is where a press-up starts
            [J.L_WRIST, -0.9], [J.R_WRIST, -0.9]
        ])
    ];

    /* ------------------------------------------------ the rung that was missing
     * Between crouchAt(1) and "seated" there is a cliff, and the exam has been
     * measuring it for weeks without either side of it moving: from a folded
     * squat champions rise 3/6, from the seat 0/6, and nothing in between was
     * ever presented to them.
     *
     * The two poses are not different in kind. In the folded squat the pelvis
     * is above the feet with the soles flat; in the seat the pelvis is on the
     * floor behind the feet. Everything between — the pelvis sinking back and
     * down while the shins rotate forward — is a continuum, and it is exactly
     * the continuum a rise has to traverse in reverse. Interpolating it turns
     * the last cliff in the curriculum into the same kind of ramp that made
     * crouch depth learnable.
     *
     * t = 0 is the deepest crouch, t = 1 the full seated pose. `depth` keeps
     * counting upward past 1 so riseGrace keeps growing with the difficulty,
     * and the name records the rung so a log or an exam can be read back. */
    const seatedPose = model.groundPoses.find(p => p.name === "seated");
    model.seatAt = t => {
        const u = Math.max(0, Math.min(1, t));
        const a = model.crouchAt(1);
        const q = new Float64Array(nj0);
        for (let j = 0; j < nj0; j++) q[j] = a.q[j] + (seatedPose.q[j] - a.q[j]) * u;
        return {
            name: `seat${u.toFixed(2)}`,
            pitch: a.pitch + (seatedPose.pitch - a.pitch) * u,
            roll: a.roll + (seatedPose.roll - a.roll) * u,
            q, depth: 1 + u, seatT: u
        };
    };

    /* ------------------------------------------ the ramp that was still missing
     *
     * seatAt above interpolates crouch -> "seated", and measurement says that is
     * not the ramp it was believed to be: seatAt(1.00) spawns at hip 86 deg /
     * knee -112 against the deep crouch's 92 / -121, and the only thing touching
     * the ground is FOOT. It is a slightly shallower squat. Every rung of the
     * entire rise curriculum — crouchAt 0..1 and seatAt 0..1 — stands on its feet:
     *
     *     crouchAt 0.00  COM 0.842  Foot
     *     crouchAt 1.00  COM 0.551  Foot
     *     seatAt   1.00  COM 0.607  Foot
     *     ---- nothing here ----
     *     prone          COM 0.386  Hand
     *
     * So the fleet has never once practised bearing weight on a hand or a knee
     * and transitioning off it, which is the whole content of getting up. The gap
     * is not HEIGHT, it is the CONTACT SET, and a ramp that only varies depth
     * cannot cross it however finely it is sliced.
     *
     * This ramp varies contacts instead, one element at a time, through poses the
     * pool has already validated:
     *
     *     Foot                 crouch          COM 0.551
     *     Foot + Shank         kneel           COM 0.574   <- knee down
     *     Foot + Shank + Hand  quadruped       COM 0.376   <- hands down
     *     Hand                 prone           COM 0.386
     *
     * Note kneel sits HIGHER than the deep crouch. That is the point, and it is
     * why a height-ordered ramp could never have found these rungs: the missing
     * steps are changes of support, not changes of altitude.
     *
     * Both intermediate rungs are statically stable — frozen at the spawn posture
     * the walker holds quadruped at 0.348 m and kneel at 0.562 m indefinitely —
     * so they are places a controller can actually live, not 0.3 s transients.
     *
     * SNAPPED, NOT INTERPOLATED, and that was measured rather than assumed. The
     * first version blended joint angles between neighbouring rungs the way
     * crouchAt and seatAt do. It does not work here: a linear blend of two
     * statically stable postures is not itself stable, because the intermediate
     * has the hands and knees part-lifted and nothing under the mass. Frozen at
     * the spawn posture for two seconds, the blends fell —
     *
     *     riseAt 0.42 (crouch->kneel)      COM 0.797 -> 0.162, ends on its torso
     *     riseAt 0.68 (kneel->quadruped)   COM 0.538 -> 0.143, ends on its torso
     *
     * — while the anchors held: kneel 0.574 -> 0.562, quadruped 0.376 -> 0.348.
     * A rung that face-plants under a do-nothing controller is not a rung; it is
     * the cliff again, wearing a fractional name. So the contact rungs are the
     * validated poses themselves and nothing in between.
     *
     * The crouch sub-ramp below 0.35 stays continuous: it varies depth alone,
     * every rung of it keeps the soles flat, and the fleet already climbs it. */
    const proneP = model.groundPoses.find(p => p.name === "prone");
    const CONTACT_RUNGS = [
        { at: 0.35, name: "kneel" },        // Foot + Shank
        { at: 0.65, name: "quadruped" },    // Foot + Shank + Hand
        { at: 0.90, name: null }            // prone: Hand
    ];
    model.riseAt = t => {
        const u = Math.max(0, Math.min(1, t));
        let pose;
        if (u < CONTACT_RUNGS[0].at) {
            // continuous depth ramp, soles flat throughout — the part that works
            pose = model.crouchAt(u / CONTACT_RUNGS[0].at);
        } else {
            let pick = CONTACT_RUNGS[0];
            for (const r of CONTACT_RUNGS) if (u >= r.at) pick = r;
            pose = pick.name ? model.startPoses.find(p => p.name === pick.name) : proneP;
        }
        const q = new Float64Array(nj0);
        for (let j = 0; j < nj0; j++) q[j] = pose.q[j];
        return {
            name: `rise${u.toFixed(2)}`,
            pitch: pose.pitch || 0, roll: pose.roll || 0,
            /* depth drives riseGrace, so a deeper rung buys proportionally more
             * clock — a rise from all-fours genuinely takes longer than standing
             * out of a squat, and charging both the same is charging the harder
             * one twice. */
            q, depth: 1 + u, riseT: u
        };
    };

    /* ------------------------------------------------------------ the pose pool
     * Fourteen postures a walker can wake up in, on top of the crouch/seat ramp.
     * The ramp is one axis — how far down the walker starts — and every rung on
     * it is the same SHAPE: square to the world, symmetric, weight through the
     * feet. That is a narrow diet for a body with 22 joints. Nothing in the pool
     * has ever loaded hip roll, nothing has ever twisted the waist, nothing has
     * put weight through one arm, and nothing has started with the pelvis on the
     * floor and the legs folded to one side.
     *
     * Each was fitted against the body rather than typed out: pose_check.js
     * declares which contacts are meant to be on the ground and moves the joints
     * until they are, inside the joint limits, without driving one limb through
     * another, and with any weight-bearing palm flat rather than on its edge.
     * See pose_candidates.js and pose_preview.html for the working.
     */

    /* Mirror a pose through the sagittal plane. The rule is read off the joint
     * axes rather than hard-coded: a joint about Z is sagittal and keeps its
     * sign, a joint about X or Y is lateral and flips, and the left and right
     * chains swap. Base roll flips with them; base pitch does not.
     *
     * Worth having as a function rather than a second hand-written table. These
     * poses took a fitter and several rounds of looking at renders to get right,
     * and a mirror typed out by hand is a second chance to get one sign wrong —
     * in a pose that would then look almost right and start falling sideways. */
    // Read off model.bodies, not model.jointNames — the name table is not built
    // until further down the file, and this runs here.
    const jName = j => model.bodies[j + 1].name.replace(/Link$/, "");
    const mirrorMap = [], mirrorSign = [];
    for (let j = 0; j < nj0; j++) {
        const n = jName(j);
        const other = n[0] === "L" ? "R" + n.slice(1) : n[0] === "R" ? "L" + n.slice(1) : n;
        let k = j;
        for (let i = 0; i < nj0; i++) if (jName(i) === other) { k = i; break; }
        mirrorMap[j] = k;
        mirrorSign[j] = model.bodies[j + 1].axis === 2 ? 1 : -1;
    }
    model.mirrorPose = p => {
        const q = new Float64Array(nj0);
        for (let j = 0; j < nj0; j++) q[j] = mirrorSign[j] * p.q[mirrorMap[j]];
        return Object.assign({}, p, { name: p.name + "'", q, roll: -p.roll });
    };

    const sp = (name, pitch, roll, edits) => gp(name, pitch, roll, edits);

    model.startPoses = [
        /* bridge — reverse tabletop, chest up, hips already off the floor. The
         * only pose in the pool where the arms carry the mass. The elbows are
         * bent 1.15 rad because they have to be: shoulder to fingertip is 0.664 m
         * against a 0.50 m drop from hip to sole, so with straight arms the hands
         * reach 19 cm BELOW the feet and the walker hangs off its palms. */
        sp("bridge", 1.57, 0, [
            [J.WAIST_PITCH, 0.40],
            [J.L_HIP_PITCH, -0.05], [J.R_HIP_PITCH, -0.05],
            [J.L_KNEE, -1.22], [J.R_KNEE, -1.22],
            [J.L_SHOULDER, -1.60], [J.R_SHOULDER, -1.60],
            [J.L_SHOULDER_ROLL, 0.07], [J.R_SHOULDER_ROLL, -0.07],
            [J.L_ELBOW, 1.15], [J.R_ELBOW, 1.15],
            [J.L_WRIST, -0.26], [J.R_WRIST, -0.26]
        ]),
        /* horse — wide squat. The only pose that puts weight through hip ROLL,
         * which is the tightest joint on the body at 0.55 rad of abduction. */
        sp("horse", 0, 0, [
            [J.WAIST_PITCH, -0.15],
            [J.L_HIP_ROLL, -0.55], [J.R_HIP_ROLL, 0.55],
            [J.L_HIP_PITCH, 0.80], [J.R_HIP_PITCH, 0.80],
            [J.L_KNEE, -1.35], [J.R_KNEE, -1.35],
            [J.L_ANK_PITCH, 0.55], [J.R_ANK_PITCH, 0.55],
            [J.L_SHOULDER, 0.45], [J.R_SHOULDER, 0.45],
            [J.L_SHOULDER_ROLL, -0.45], [J.R_SHOULDER_ROLL, 0.45],
            [J.L_ELBOW, 0.75], [J.R_ELBOW, 0.75],
            [J.L_WRIST, -0.20], [J.R_WRIST, -0.20]
        ]),
        /* kneel — upright on the knees, trunk arched back. The rung the ramp
         * never had: seatAt() interpolates the pelvis DOWN to the floor, and
         * nothing ever presented it halfway UP, at thigh height, one hip
         * extension short of standing. Statically stable on its own. */
        sp("kneel", 0, 0, [
            [J.WAIST_PITCH, 0.40],
            [J.L_KNEE, -1.5708], [J.R_KNEE, -1.5708],
            [J.L_ANK_PITCH, -0.90], [J.R_ANK_PITCH, -0.90],
            [J.L_SHOULDER, -0.90], [J.R_SHOULDER, -0.90],
            [J.L_SHOULDER_ROLL, -0.20], [J.R_SHOULDER_ROLL, 0.20],
            [J.L_ELBOW, 0.30], [J.R_ELBOW, 0.30],
            [J.L_WRIST, -0.40], [J.R_WRIST, -0.40]
        ]),
        /* quadruped — hands and knees, the way a body actually leaves the floor,
         * and the rung between prone and kneeling. Also statically stable. Same
         * reach problem as the bridge but worse, since the drop from hip to knee
         * is only the 0.42 m thigh: hence the 1.26 rad elbows. */
        sp("quadruped", -1.5708, 0, [
            [J.L_HIP_PITCH, 1.57], [J.R_HIP_PITCH, 1.57],
            [J.L_KNEE, -1.57], [J.R_KNEE, -1.57],
            [J.L_ANK_PITCH, -0.85], [J.R_ANK_PITCH, -0.85],
            [J.L_SHOULDER, 1.40], [J.R_SHOULDER, 1.40],
            [J.L_SHOULDER_ROLL, 0.05], [J.R_SHOULDER_ROLL, -0.05],
            [J.L_ELBOW, 1.26], [J.R_ELBOW, 1.26],
            [J.L_WRIST, -0.05], [J.R_WRIST, -0.05]
        ]),
        /* hugknees — sitting with the knees up and the arms over the shins. This
         * is the pool's own "seated" with the hands taken away: the same rise
         * without the free press-up, so a strictly harder rung on the same
         * ladder rather than a different skill.
         *
         * Pitched back 0.95 rad, which is not a stylistic choice. Hip flexion
         * stops at 1.80 rad and sitting on the floor with the knees up needs
         * about 2.6 rad from the trunk, so the rest has to come from the base.
         * (The pool's "seated" is pitched 0.22 and therefore spawns 34 cm ABOVE
         * the floor — a squat that free-falls into a sit. Left alone here.) */
        sp("hugknees", 0.95, 0, [
            [J.WAIST_PITCH, -0.40],
            [J.L_HIP_PITCH, 1.55], [J.R_HIP_PITCH, 1.55],
            [J.L_KNEE, -2.05], [J.R_KNEE, -2.00],
            [J.L_ANK_PITCH, 0.45], [J.R_ANK_PITCH, 0.45],
            [J.L_SHOULDER, 0.70], [J.R_SHOULDER, 0.70],
            [J.L_SHOULDER_ROLL, -0.30], [J.R_SHOULDER_ROLL, 0.30],
            [J.L_ELBOW, 1.55], [J.R_ELBOW, 1.55],
            [J.L_WRIST, 0.20], [J.R_WRIST, 0.20]
        ]),
        /* crow — knees perched on the upper arms, feet off the floor, everything
         * through the palms. Included at the owner's call; nothing but friction
         * holds the knees on the arms, so expect it to collapse forward. */
        sp("crow", -1.10, 0, [
            [J.WAIST_PITCH, -0.60],
            [J.L_HIP_PITCH, 1.75], [J.R_HIP_PITCH, 1.75],
            [J.L_KNEE, -2.30], [J.R_KNEE, -2.30],
            [J.L_ANK_PITCH, -0.50], [J.R_ANK_PITCH, -0.50],
            [J.L_SHOULDER, 1.35], [J.R_SHOULDER, 1.35],
            [J.L_SHOULDER_ROLL, -0.45], [J.R_SHOULDER_ROLL, 0.45],
            [J.L_ELBOW, 0.85], [J.R_ELBOW, 0.85],
            [J.L_WRIST, -0.60], [J.R_WRIST, -0.60]
        ]),

        /* ---- the four asymmetric ones. Each is mirrored below. ---- */

        /* warrior2 — the widest base the body can make, long in BOTH axes, so
         * the capture point has somewhere to go. The front foot cannot turn out
         * the 90 degrees a person uses: hip yaw stops at 0.60 rad. */
        sp("warrior2", -0.30, 0, [
            [J.L_HIP_YAW, 0.60],
            [J.L_HIP_ROLL, -0.55], [J.L_HIP_PITCH, 0.95], [J.L_KNEE, -0.76], [J.L_ANK_PITCH, 0.17],
            [J.R_HIP_ROLL, 0.55], [J.R_HIP_PITCH, 0.03], [J.R_ANK_PITCH, 0.42],
            [J.L_SHOULDER_ROLL, -1.55], [J.R_SHOULDER_ROLL, 1.55],
            [J.L_ELBOW, 0.05], [J.R_ELBOW, 0.05]
        ]),
        /* warrior3 — one foot, full height, no margin. A balance start rather
         * than a rise: it will fall every episode until the walker can stand. */
        sp("warrior3", -1.4508, 0, [
            [J.WAIST_PITCH, 0.10],
            [J.L_HIP_PITCH, 1.4508], [J.L_KNEE, -0.05], [J.L_ANK_PITCH, 0.05],
            [J.R_HIP_PITCH, -0.05], [J.R_KNEE, -0.05],
            [J.L_SHOULDER, 0.05], [J.R_SHOULDER, 0.05],
            [J.L_SHOULDER_ROLL, -0.35], [J.R_SHOULDER_ROLL, 0.35],
            [J.L_ELBOW, 0.10], [J.R_ELBOW, 0.10]
        ]),
        /* sideplank — the only pose loaded through ONE arm and the only one
         * rolled onto its edge, standing on the outer edge of the lower foot.
         * The support arm is fitted to hang close to plumb: a weight-bearing arm
         * a few degrees off vertical starts the episode with a moment about the
         * hand and is already toppling on tick 1. The palm is laid flat rather
         * than planted on its edge, because four collinear contacts can push but
         * cannot stop the arm pivoting over them. */
        sp("sideplank", -0.03, -1.09, [
            [J.WAIST_PITCH, 0.05],
            [J.L_HIP_PITCH, -0.08], [J.R_HIP_PITCH, -0.08],
            [J.L_KNEE, -0.06], [J.R_KNEE, -0.06],
            [J.L_ANK_PITCH, 0.10], [J.R_ANK_PITCH, 0.90], [J.R_ANK_ROLL, 0.45],
            [J.R_SHOULDER, 0.12], [J.R_SHOULDER_ROLL, 1.08], [J.R_WRIST, -1.20],
            [J.L_SHOULDER_ROLL, -1.55], [J.L_ELBOW, 0.10]
        ]),
        /* sidesit — pelvis on the floor with both legs folded the same way and
         * one palm braced. To stand from here the legs have to be unwound BEFORE
         * the push, and no symmetric pose poses that ordering problem. */
        sp("sidesit", 0.70, 0.45, [
            [J.L_HIP_YAW, -0.38], [J.L_HIP_ROLL, 0.22],
            [J.L_HIP_PITCH, 1.80], [J.L_KNEE, -2.10], [J.L_ANK_PITCH, 0.50],
            [J.R_HIP_YAW, -0.60], [J.R_HIP_ROLL, 0.55],
            [J.R_HIP_PITCH, 0.95], [J.R_KNEE, -1.93], [J.R_ANK_PITCH, 0.74],
            [J.R_SHOULDER, -1.07], [J.R_SHOULDER_ROLL, -0.20], [J.R_WRIST, -1.10],
            [J.L_SHOULDER, 0.55], [J.L_SHOULDER_ROLL, -0.40], [J.L_ELBOW, 1.00]
        ])
    ];

    /* The mirrors. Only the four asymmetric poses get one — the other six are
     * their own reflections, and a duplicate in the pool would quietly double
     * their share of the draw. Appended rather than interleaved so the index of
     * every pose above stays put. */
    for (const name of ["warrior2", "warrior3", "sideplank", "sidesit"])
        model.startPoses.push(model.mirrorPose(model.startPoses.find(p => p.name === name)));

    /* Sole corners, in each foot's own frame. */
    model.contactPts = [
        [-S.footHeel, -S.ankleH, S.footW * 0.5], [-S.footHeel, -S.ankleH, -S.footW * 0.5],
        [S.footToe, -S.ankleH, S.footW * 0.5], [S.footToe, -S.ankleH, -S.footW * 0.5]
    ];

    /* Every point that can touch the ground: {body, p, foot}. `foot` is 0/1 for
     * the sole corners (the load sensor sums them per foot) and -1 elsewhere.
     * Knees, hands, hips, torso and head are here so a walker that loses it
     * actually collapses onto the ground and lies there, instead of sinking
     * through a floor that only its soles can feel. */
    const contacts = [];
    for (let s = 0; s < 2; s++) for (const p of model.contactPts) contacts.push({ body: model.footBody[s], p, foot: s });
    const idxOf = name => bodies.findIndex(b => b.name === name);
    for (const tag of ["L", "R"]) {
        contacts.push({ body: idxOf(tag + "Shank"), p: [0.075, -0.035, 0], foot: -1 });        // knee
        // Four palm corners, not one wrist point. This is what lets an arm plant
        // and press instead of pivoting around a pinpoint.
        for (const hx of [-S.handT * 0.5, S.handT * 0.5])
            for (const hz of [-S.handW * 0.5, S.handW * 0.5])
                contacts.push({ body: idxOf(tag + "Hand"), p: [hx, -S.hand, hz], foot: -1 });
    }
    for (const sx of [-0.11, 0.11]) for (const sz of [-0.14, 0.14]) contacts.push({ body: 0, p: [sx, -0.08, sz], foot: -1 });
    // Front and back of the chest. sx is the fore-aft axis here, so these catch
    // a face-down or flat-on-the-back landing.
    for (const sx of [-0.13, 0.13]) for (const sy of [0.10, 0.34]) contacts.push({ body: iTorso, p: [sx, sy, 0], foot: -1 });
    /* …and the LATERAL extremes, which were missing. Every torso point above
     * sits at z = 0, but z is the chest-width axis (torsoZ 0.300), so a walker
     * that toppled sideways had nothing between the mid-plane of its ribcage
     * and the floor: it sank up to 150 mm before any point resisted. That is a
     * physics gap, not a rendering artefact — the visible clipping was the
     * simulation telling the truth about a body with no shoulder on it. */
    for (const sz of [-S.torsoZ * 0.5, S.torsoZ * 0.5])
        for (const sy of [0.10, 0.34]) contacts.push({ body: iTorso, p: [0, sy, sz], foot: -1 });
    // The head is a 0.230 box on a single point, so it too could sink to its
    // centre. Four corners of the skull cost four distance tests.
    const headY = S.torso + S.headGap + S.head * 0.5, hr = S.head * 0.5;
    contacts.push({ body: iTorso, p: [0, headY, 0], foot: -1 });
    for (const hx of [-hr, hr]) contacts.push({ body: iTorso, p: [hx, headY, 0], foot: -1 });
    for (const hz of [-hr, hr]) contacts.push({ body: iTorso, p: [0, headY, hz], foot: -1 });
    // Upper arm and forearm had no ground contact at all — only the palms — so
    // an arm flung out during a fall passed straight through the floor.
    for (const tag of ["L", "R"]) {
        contacts.push({ body: idxOf(tag + "UpperArm"), p: [0, -S.upperArm * 0.6, 0], foot: -1 });
        contacts.push({ body: idxOf(tag + "Forearm"), p: [0, -S.forearm * 0.6, 0], foot: -1 });
    }
    model.contacts = contacts;

    /* Self-collision primitives. Joint limits alone cannot stop the legs
     * crossing without being tighter than any real hip — a sweep of the
     * reachable joint space found a thigh passing 176 mm through the other one
     * in 45.8% of poses — so the limbs carry collision spheres and the solver
     * pushes them apart, which is how a real humanoid handles it too. Spheres
     * rather than boxes on purpose: the check runs every physics tick, and a
     * sphere pair is one distance where an OBB pair is fifteen projections. */
    const legSpheres = [];
    for (const tag of ["L", "R"]) {
        const th = idxOf(tag + "Thigh"), sh = idxOf(tag + "Shank");
        legSpheres.push({ body: th, p: [0, -S.thigh * 0.35, 0], r: S.thighZ * 0.5, side: tag });
        legSpheres.push({ body: th, p: [0, -S.thigh * 0.75, 0], r: S.thighZ * 0.5, side: tag });
        legSpheres.push({ body: sh, p: [0, -S.shank * 0.30, 0], r: 0.058, side: tag });
        legSpheres.push({ body: sh, p: [0, -S.shank * 0.70, 0], r: 0.055, side: tag });
        legSpheres.push({ body: model.footBody[tag === "L" ? 0 : 1], p: [0.05, -S.ankleH * 0.5, 0], r: 0.055, side: tag });
    }
    // only across the midline: a limb never collides with its own chain
    model.selfPairs = [];
    for (const a of legSpheres) for (const b of legSpheres) {
        if (a.side === "L" && b.side === "R") model.selfPairs.push([a, b]);
    }

    /* Arms against the chest. The shoulder offset (0.215) clears a 0.300-wide
     * torso in the REST pose, but the shoulder roll joint can swing an arm
     * inward across the body, and nothing was checking it — so the arms visibly
     * passed through the ribcage. The torso carries its own spheres for this;
     * they are tagged "T" so the midline rule above leaves them alone, and each
     * arm is paired against the chest rather than against the other arm, which
     * is the collision that actually happens. */
    const torsoSpheres = [];
    for (const ty of [0.10, 0.24, 0.36]) {
        torsoSpheres.push({ body: iTorso, p: [0, ty, 0], r: S.torsoZ * 0.42, side: "T" });
    }
    const armSpheres = [];
    for (const tag of ["L", "R"]) {
        const ua = idxOf(tag + "UpperArm"), fa = idxOf(tag + "Forearm");
        armSpheres.push({ body: ua, p: [0, -S.upperArm * 0.45, 0], r: 0.052, side: tag });
        armSpheres.push({ body: ua, p: [0, -S.upperArm * 0.85, 0], r: 0.050, side: tag });
        armSpheres.push({ body: fa, p: [0, -S.forearm * 0.50, 0], r: 0.046, side: tag });
        armSpheres.push({ body: fa, p: [0, -S.forearm * 0.90, 0], r: 0.044, side: tag });
    }
    for (const a of armSpheres) for (const t of torsoSpheres) model.selfPairs.push([a, t]);
    // …and the arms against each other across the midline, so they cannot fold
    // through one another in front of the chest.
    for (const a of armSpheres) for (const b of armSpheres) {
        if (a.side === "L" && b.side === "R") model.selfPairs.push([a, b]);
    }

    /* Joint bookkeeping. Joint j maps to body j+1 (body 0 is the base). */
    const nj = bodies.length - 1;
    model.nj = nj;
    model.jointNames = [];
    model.nominal = new Float64Array(nj);
    model.crouch = new Float64Array(nj);
    model.kp = new Float64Array(nj);
    model.kd = new Float64Array(nj);
    model.tauMax = new Float64Array(nj);
    model.range = new Float64Array(nj);      // half-span of the network's command around `nominal`
    model.span = new Float64Array(nj);       // qmax - qmin, for normalising the angle sensor
    for (let j = 0; j < nj; j++) {
        const b = bodies[j + 1];
        model.jointNames.push(b.name.replace(/Link$/, ""));
        model.nominal[j] = b.nominal;
        model.crouch[j] = b.crouch;
        model.kp[j] = b.kp;
        model.kd[j] = b.kd;
        model.tauMax[j] = b.tauMax;
        model.range[j] = Math.max(b.qmax - b.nominal, b.nominal - b.qmin);
        model.span[j] = b.qmax - b.qmin;
    }
    model.totalMass = bodies.reduce((s, b) => s + b.mass, 0);
    model.weight = model.totalMass * 9.81;
    model.height = TOTAL_HEIGHT;
    // Hip height in each keyframe pose, straight from the leg kinematics.
    const hipY = pose => S.ankleH + S.shank * Math.cos(pose[J.L_HIP_PITCH] + pose[J.L_KNEE])
        + S.thigh * Math.cos(pose[J.L_HIP_PITCH]);
    model.standHipY = hipY(model.nominal);
    model.crouchHipY = hipY(model.crouch);
    return model;
}

const HUMANOID = buildHumanoid();

if (typeof module !== "undefined") {
    module.exports = { HUMANOID, buildHumanoid, SEG, J, composite, boxInertia, TOTAL_HEIGHT };
}
