/* pose_candidates.js — proposed additions to the start-pose pool.
 *
 * Kept apart from body.js on purpose: until a pose has been LOOKED AT it is a
 * guess about a joint chain, not a posture. pose_preview.html draws these with
 * the real body and the real spawn code so the guess can be checked, and only
 * then do the survivors move into body.js / body.hpp.
 *
 * Sign conventions, derived from the poses already in body.js and re-checked
 * against the joint table:
 *
 *   base pitch is about +Z and tips the body's up-axis toward -X, so with yaw 0
 *   a rotation of R_z(p) sends body +X -> (cos p, sin p) and body +Y -> (-sin p,
 *   cos p). Hence pitch +90 lays the walker on its BACK (head toward world -X)
 *   and pitch -90 puts it face DOWN.
 *
 *   every sagittal joint (waist pitch, shoulder pitch, elbow, hip pitch, knee,
 *   ankle pitch) also turns about Z, so with roll and yaw at zero the world
 *   direction of any limb is just the SUM of the base pitch and the joint
 *   angles above it. A segment whose accumulated angle is 0 points straight
 *   down; -pi/2 points backward along -X; +pi/2 points forward along +X.
 *
 *   that sum is the whole design tool here. "Sole flat on the ground" is
 *   pitch + hip + knee + ankle = 0, which is exactly the rule crouchAt() uses
 *   with pitch = 0. "Thigh vertical" is pitch + hip = 0. "Shin flat on the
 *   floor pointing backward" is pitch + hip + knee = -pi/2.
 */
"use strict";

const POSE_CANDIDATES = (() => {
    const nj = HUMANOID.nj;
    const mk = (name, pitch, roll, edits) => {
        const q = new Float64Array(nj);
        for (const [j, v] of edits) q[j] = v;
        return { name, pitch, roll, q, depth: 1 };
    };
    const HALF = Math.PI / 2;

    return [
    /* ---------------------------------------------------------------- 1. bridge
     * Reverse tabletop. Trunk and thighs in one horizontal plane, shins vertical,
     * hands flat on the floor behind the shoulders. The reason to want it: it is
     * the only pose in the pool where the ARMS carry the mass and the hips are
     * already up. Every existing floor pose starts with the pelvis down.
     * trunk horizontal, chest up      -> pitch = +pi/2
     * thigh horizontal, forward       -> pitch + hip = +pi/2 ... i.e. hip ~ 0
     * shin vertical, down             -> pitch + hip + knee = 0
     * sole flat                       -> pitch + hip + knee + ankle = 0
     */
    { plant: ["LHand","RHand","Lsole","Rsole"], flat: ["LHand","RHand"],
      why: "hips already up and the arms loaded — the only pose where a press is the whole job",
      camYaw: 2.1, camPitch: 0.16,
      pose: mk("bridge", 1.57, 0.00, [
        [J.WAIST_PITCH, 0.40],
        [J.L_HIP_PITCH, -0.05], [J.R_HIP_PITCH, -0.05],
        [J.L_KNEE, -1.22], [J.R_KNEE, -1.22],
        [J.L_ANK_PITCH, 0.00], [J.R_ANK_PITCH, 0.00],
        [J.L_SHOULDER, -1.60], [J.R_SHOULDER, -1.60],
        [J.L_SHOULDER_ROLL, 0.07], [J.R_SHOULDER_ROLL, -0.07],
        /* Elbows bent 1.15 rad, and NOT for looks. Shoulder to fingertip on this
         * body is 0.664 m against a 0.50 m drop from hip to sole with the shin
         * vertical, so with the trunk level and the arms straight the hands reach
         * 19 cm below the feet: the walker hangs off its palms with both soles in
         * the air, which is precisely the opposite of what the pose is for.
         * Fitted, with the palms flat at 0.95 of 1. */
        [J.L_ELBOW, 1.15], [J.R_ELBOW, 1.15],
        [J.L_WRIST, -0.26], [J.R_WRIST, -0.26]
    ])},

    /* ---------------------------------------------------------------- 2. horse
     * Wide-legged squat, hands resting on the knees. A STANDING start, not a
     * floor one: the interest is lateral. Every pose in the pool today has the
     * feet close together and the mass in the sagittal plane, so nothing has
     * ever asked the hip ROLL joints to hold weight.
     * Hip roll is the tightest joint on the body (0.55 rad of abduction), so
     * this is as wide as the stance can physically go.
     */
    { plant: ["Lsole","Rsole"],
      why: "the only pose that loads hip roll — every existing start is sagittal",
      camYaw: 2.6, camPitch: 0.12,
      pose: mk("horse", 0, 0, [
        // Only a slight fold. At -0.30 with the arms reaching for the knees the
        // whole mass sits ahead of the ankles and the stance dives forward before
        // the network has had a tick — a wide stance is the point, not a lunge.
        [J.WAIST_PITCH, -0.15],
        [J.L_HIP_ROLL, -0.55], [J.R_HIP_ROLL, 0.55],
        [J.L_HIP_PITCH, 0.80], [J.R_HIP_PITCH, 0.80],
        [J.L_KNEE, -1.35], [J.R_KNEE, -1.35],
        [J.L_ANK_PITCH, 0.55], [J.R_ANK_PITCH, 0.55],
        [J.L_SHOULDER, 0.45], [J.R_SHOULDER, 0.45],
        [J.L_SHOULDER_ROLL, -0.45], [J.R_SHOULDER_ROLL, 0.45],
        [J.L_ELBOW, 0.75], [J.R_ELBOW, 0.75],
        [J.L_WRIST, -0.20], [J.R_WRIST, -0.20]
    ]) },

    /* ---------------------------------------------------------------- 3. kneel
     * Upright kneeling with the trunk arched back (camel). The missing rung
     * between the floor and the feet: the pelvis is already at thigh height and
     * the remaining move is one hip extension onto a foot. Nothing in the pool
     * teaches that half of the rise — seatAt() interpolates the pelvis DOWN to
     * the floor, never up onto the knees.
     * thigh vertical                  -> pitch + hip = 0
     * shin flat, pointing backward    -> pitch + hip + knee = -pi/2
     */
    { plant: ["LKnee","RKnee","Lsole","Rsole"],
      why: "the pelvis already at thigh height — one hip extension short of standing",
      camYaw: 2.35, camPitch: 0.10,
      pose: mk("kneel", 0, 0, [
        [J.WAIST_PITCH, 0.40],
        [J.L_HIP_PITCH, 0.00], [J.R_HIP_PITCH, 0.00],
        [J.L_KNEE, -HALF], [J.R_KNEE, -HALF],
        [J.L_ANK_PITCH, -0.90], [J.R_ANK_PITCH, -0.90],
        [J.L_SHOULDER, -0.90], [J.R_SHOULDER, -0.90],
        [J.L_SHOULDER_ROLL, -0.20], [J.R_SHOULDER_ROLL, 0.20],
        [J.L_ELBOW, 0.30], [J.R_ELBOW, 0.30],
        [J.L_WRIST, -0.40], [J.R_WRIST, -0.40]
    ]) },

    /* --------------------------------------------------------------- 4. warrior3
     * Single-leg balance, trunk horizontal, free leg straight back. Not a rise
     * at all — a pure balance start, at full height, on one foot.
     * trunk horizontal, face down     -> pitch = -pi/2
     * stance thigh vertical           -> pitch + hip = 0
     * free leg in line with the trunk -> hip ~ 0
     */
    { plant: ["Lsole"],
      why: "a balance start, not a rise: full height, one foot, no margin",
      camYaw: 2.5, camPitch: 0.16,
      pose: mk("warrior3", -HALF + 0.12, 0, [
        [J.WAIST_PITCH, 0.10],
        [J.L_HIP_PITCH, HALF - 0.12], [J.L_KNEE, -0.05], [J.L_ANK_PITCH, 0.05],
        [J.R_HIP_PITCH, -0.05], [J.R_KNEE, -0.05], [J.R_ANK_PITCH, 0.00],
        [J.L_SHOULDER, 0.05], [J.R_SHOULDER, 0.05],
        [J.L_SHOULDER_ROLL, -0.35], [J.R_SHOULDER_ROLL, 0.35],
        [J.L_ELBOW, 0.10], [J.R_ELBOW, 0.10]
    ]) },

    /* --------------------------------------------------------------- 5. warrior2
     * Wide split stance, front knee bent, arms out level. The lateral cousin of
     * the horse stance with the stance also split fore-aft, so the support
     * polygon is long in BOTH axes and the capture point has somewhere to go.
     * The front foot cannot turn out the 90 degrees a person uses — hip yaw
     * stops at 0.60 rad — so this is the pose the body can reach, not the one in
     * the photograph.
     */
    { plant: ["Lsole","Rsole"], pin: ["L_SHOULDER_ROLL","R_SHOULDER_ROLL","L_HIP_YAW"],
      why: "support polygon long in both axes — the widest base the body can make",
      camYaw: 2.75, camPitch: 0.14,
      pose: mk("warrior2", -0.30, 0.00, [
        [J.L_HIP_YAW, 0.60],
        [J.L_HIP_ROLL, -0.55], [J.L_HIP_PITCH, 0.95], [J.L_KNEE, -0.76], [J.L_ANK_PITCH, 0.17],
        [J.R_HIP_ROLL, 0.55], [J.R_HIP_PITCH, 0.03], [J.R_KNEE, 0.00], [J.R_ANK_PITCH, 0.42],
        [J.L_SHOULDER, 0.00], [J.R_SHOULDER, 0.00],
        [J.L_SHOULDER_ROLL, -1.55], [J.R_SHOULDER_ROLL, 1.55],
        [J.L_ELBOW, 0.05], [J.R_ELBOW, 0.05]
    ])},

    /* ------------------------------------------------------------------ 6. crow
     * Arm balance: both knees perched on the upper arms, feet off the floor,
     * everything on the palms. Included because it was asked for, and I expect
     * it to fall over — nothing holds the knees on the arms but friction, and
     * the walker has no reason to keep them there. See the note in the report.
     */
    { plant: ["LHand","RHand"],
      why: "asked for; expect it to topple — nothing but friction holds the knees on the arms",
      camYaw: 2.2, camPitch: 0.18,
      pose: mk("crow", -1.10, 0, [
        [J.WAIST_PITCH, -0.60],
        [J.L_HIP_PITCH, 1.75], [J.R_HIP_PITCH, 1.75],
        [J.L_KNEE, -2.30], [J.R_KNEE, -2.30],
        [J.L_ANK_PITCH, -0.50], [J.R_ANK_PITCH, -0.50],
        [J.L_SHOULDER, 1.35], [J.R_SHOULDER, 1.35],
        [J.L_SHOULDER_ROLL, -0.45], [J.R_SHOULDER_ROLL, 0.45],
        [J.L_ELBOW, 0.85], [J.R_ELBOW, 0.85],
        [J.L_WRIST, -0.60], [J.R_WRIST, -0.60]
    ]) },

    /* -------------------------------------------------------------- 7. quadruped
     * Hands and knees. Between "prone" (flat on the floor) and "kneel" (upright
     * on the knees), and the pose a real body actually passes through on the way
     * from one to the other. Cheap to reach and cheap to leave, which is what
     * makes it a good rung rather than a good photograph.
     * trunk horizontal, face down     -> pitch = -pi/2
     * thigh vertical                  -> pitch + hip = 0
     * shin flat, backward             -> pitch + hip + knee = -pi/2
     * upper arm vertical              -> pitch + shoulder = 0
     */
    { plant: ["LHand","RHand","LKnee","RKnee"], flat: ["LHand","RHand"],
      why: "the rung between prone and kneeling — the way a real body gets off the floor",
      camYaw: 2.3, camPitch: 0.14,
      pose: mk("quadruped", -1.57, 0.00, [
        [J.WAIST_PITCH, 0.00],
        [J.L_HIP_PITCH, 1.57], [J.R_HIP_PITCH, 1.57],
        [J.L_KNEE, -1.57], [J.R_KNEE, -1.57],
        [J.L_ANK_PITCH, -0.85], [J.R_ANK_PITCH, -0.85],
        [J.L_SHOULDER, 1.40], [J.R_SHOULDER, 1.40],
        // Arms vertical UNDER the shoulders, not splayed. Abducting them puts the
        // ground reaction outboard of the shoulder and the roll servo loses: the
        // first draft had them at 0.30 rad and both arms slid flat in half a second.
        [J.L_SHOULDER_ROLL, 0.05], [J.R_SHOULDER_ROLL, -0.05],
        // Same reach problem as the bridge, worse: the drop from hip to knee is
        // only the thigh, 0.42 m, against 0.66 m of arm, so straight arms leave
        // both knees 17 cm off the floor. 1.26 plants hands, knees and the
        // trailing feet together, with the palms flat (0.86 of 1) rather than on
        // their edges.
        [J.L_ELBOW, 1.26], [J.R_ELBOW, 1.26],
        [J.L_WRIST, -0.05], [J.R_WRIST, -0.05]
    ])},

    /* -------------------------------------------------------------- 8. sideplank
     * Vasisthasana. One arm down, one arm up, body in a line, weight on the
     * outside edge of one foot. LEFT is +Z on this body (LHand sits at z = +0.28),
     * so rolling negative puts the RIGHT side down and the right arm supports.
     * Shoulder ROLL is what points an arm at the floor here, not shoulder pitch:
     * with the body on its side the arm has to swing out of the sagittal plane.
     */
    /* Both legs are PINNED straight and symmetric. Left to search them, the fitter
     * bends one hip and one knee to buy a centimetre of clearance and hands back a
     * plank with staggered legs — geometrically fine, and not the pose. The only
     * dials it gets are the base attitude, the support arm and the lower ankle. */
    { plant: ["RHand","Rsole"], flat: ["RHand"], vertArm: ["R"], palmAim: ["R"], leash: 1.30,
      pin: ["L_SHOULDER_ROLL", "L_HIP_PITCH", "R_HIP_PITCH", "L_KNEE", "R_KNEE",
            "L_HIP_ROLL", "R_HIP_ROLL", "L_HIP_YAW", "R_HIP_YAW", "WAIST_PITCH", "pitch"],
      free: ["R_SHOULDER", "R_ANK_ROLL"],
      why: "the only pose loaded through ONE arm, and the only one rolled onto its edge",
      camYaw: 2.0, camPitch: 0.18,
      // pitch/waist/wrist/ankle fitted by `pose_check.js sideplank fit` — hand and
      // foot both land within 3 mm. The body ends up tilted head-up rather than
      // level, and that is forced: the support arm holds the shoulder 0.88 m off
      // the floor while the foot edge sits only 0.17 m below the body's own axis,
      // so the line from shoulder to heel HAS to slope.
      pose: mk("sideplank", -0.03, -1.09, [
        [J.WAIST_PITCH, 0.05],
        // legs together and straight — the body is one line from head to heels
        [J.L_HIP_PITCH, -0.08], [J.R_HIP_PITCH, -0.08],
        [J.L_KNEE, -0.06], [J.R_KNEE, -0.06],
        // the lower ankle rolls onto the OUTER edge of the foot, which is what a
        // side plank actually stands on
        [J.L_ANK_PITCH, 0.10], [J.R_ANK_PITCH, 0.90], [J.R_ANK_ROLL, 0.45],
        /* The support arm is fitted to hang PLUMB — 6 degrees off, down from 25.
         * A weight-bearing arm a few degrees off vertical starts the episode with
         * a moment about the hand: the ground pushes straight up while the mass
         * hangs to one side, and the pose is already toppling on tick 1. Getting
         * there needed the support shoulder freed; with its roll pinned at 1.55
         * the arm angle is fully determined by the base attitude, and the base
         * attitude is what has to move to reach the lower foot. */
        [J.R_SHOULDER, 0.12], [J.R_SHOULDER_ROLL, 1.12], [J.R_ELBOW, 0.00],
        // wrist at its limit lays the palm on the floor (0.91 of 1) rather than
        // planting the hand on its edge, where four collinear contacts can push
        // but cannot resist the arm pivoting over them
        [J.R_WRIST, -1.20],
        [J.L_SHOULDER_ROLL, -1.55], [J.L_ELBOW, 0.10]
    ]) },

    /* ----------------------------------------------------------------- 9. twist
     * Seated spinal twist: one knee up and drawn across, the other leg folded
     * toward the floor, and the trunk rotated with one hand braced behind. The
     * reason to want it is WAIST YAW — 22 joints, and not one pose in the pool
     * asks the body to be asymmetric about its own long axis, so the yaw servo
     * has never had to hold anything.
     */
    { plant: ["pelvis","Lsole","RHand"], flat: ["RHand"], pin: ["WAIST_YAW","roll"],
      why: "the first pose that twists — waist yaw and hip yaw have never held load",
      camYaw: 2.15, camPitch: 0.18,
      /* Fitted with the waist yaw PINNED, so the twist survives the fit — left
       * free, the solver bought 8 cm of clearance by flattening it from 0.62 to
       * 0.17 and handed back a well-planted pose that no longer twists.
       * The folded right knee does NOT reach the floor and is not asked to: this
       * hip abducts 0.55 rad and yaws 0.60, where crossing a leg under yourself
       * needs roughly double both, so this is the nearest posture the body can
       * actually hold rather than the photograph. */
      pose: mk("twist", 0.79, 0.45, [
        [J.WAIST_YAW, 0.62], [J.WAIST_PITCH, 0.09],
        // left leg drawn up and across, knee high
        [J.L_HIP_YAW, 0.41], [J.L_HIP_ROLL, 0.00],
        [J.L_HIP_PITCH, 1.66], [J.L_KNEE, -2.25], [J.L_ANK_PITCH, 0.80],
        // right leg folded toward the floor, heel back toward the opposite hip.
        // The first draft crossed it much further and drove the left shin 76 mm
        // THROUGH the right thigh, so the spawn would have opened with the contact
        // solver shoving the legs apart. The fitter now prices limb overlap into
        // the cost, and this is what it settles on: a lesser cross that clears.
        [J.R_HIP_YAW, -0.36], [J.R_HIP_ROLL, 0.55],
        [J.R_HIP_PITCH, 0.91], [J.R_KNEE, -2.40], [J.R_ANK_PITCH, 0.60],
        // right hand braced on the floor behind, left forearm across the knee
        [J.R_SHOULDER, -0.11], [J.R_SHOULDER_ROLL, 0.25],
        [J.R_ELBOW, 0.01], [J.R_WRIST, 0.27],
        [J.L_SHOULDER, 0.45], [J.L_SHOULDER_ROLL, -0.55], [J.L_ELBOW, 1.35]
    ]) },

    /* ------------------------------------------------------------- 10. hugknees
     * Sitting with both knees up and the arms over the shins — the way people
     * actually sit on the floor. Nearly the pool's existing "seated", with one
     * difference that is the whole point: the hands are NOT on the floor behind.
     * "seated" hands the walker a press-up start for free; this asks it to find
     * the ground first, which is a strictly harder rung on the same ladder rather
     * than a different skill.
     */
    { plant: ["pelvis","Lsole","Rsole"],
      why: "\"seated\" with the hands taken away — the same rise, without the free press-up",
      camYaw: 2.25, camPitch: 0.14,
      /* Pitched back 0.95 rad, which looks like a lot and is not optional. Hip
       * flexion stops at 1.80 rad, and to sit on the floor with the knees up the
       * thigh has to come roughly 2.6 rad round from the trunk — the shin is
       * 0.43 m long, so the knee has to be high or the foot cannot reach the floor
       * at all. Leaning the base back is where the missing 0.8 rad comes from.
       * Sweeping the pitch (pose_check.js hugknees pitch) the pelvis is 37 cm up
       * at 0, 16 cm at 0.60, and only touches from about 0.95.
       * THE POOL'S EXISTING "seated" IS PITCHED 0.22 AND SO SPAWNS 34 cm ABOVE THE
       * FLOOR — it is a squat that free-falls into a sit, and every seatAt() rung
       * inherits it. Flagged, not changed here. */
      pose: mk("hugknees", 0.95, 0, [
        [J.WAIST_PITCH, -0.40],
        [J.L_HIP_PITCH, 1.55], [J.R_HIP_PITCH, 1.55],
        [J.L_KNEE, -2.05], [J.R_KNEE, -2.00],
        [J.L_ANK_PITCH, 0.45], [J.R_ANK_PITCH, 0.45],
        [J.L_SHOULDER, 0.70], [J.R_SHOULDER, 0.70],
        [J.L_SHOULDER_ROLL, -0.30], [J.R_SHOULDER_ROLL, 0.30],
        [J.L_ELBOW, 1.55], [J.R_ELBOW, 1.55],
        [J.L_WRIST, 0.20], [J.R_WRIST, 0.20]
    ]) },

    /* -------------------------------------------------------------- 11. sidesit
     * Both legs folded to the same side, one hand on the floor. Asymmetric in the
     * hips rather than in the trunk, which is the other half of what "twist"
     * tests: to stand up from here the walker has to unwind the legs BEFORE it
     * can push, and no symmetric pose ever poses that ordering problem.
     */
    { plant: ["pelvis","RHand","Lsole","Rsole"], flat: ["RHand"],
      why: "legs folded one way — standing up needs the legs unwound before the push",
      camYaw: 2.45, camPitch: 0.14,
      // fitted: pelvis, braced right hand and the outer left foot all land within
      // 3 mm. Rolled 0.77 rad onto one hip, which is what puts the seat down while
      // both hips stay inside their 0.55 rad of abduction.
      pose: mk("sidesit", 0.70, 0.45, [
        [J.L_HIP_YAW, -0.38], [J.L_HIP_ROLL, 0.22],
        [J.L_HIP_PITCH, 1.80], [J.L_KNEE, -2.10], [J.L_ANK_PITCH, 0.50],
        [J.R_HIP_YAW, -0.60], [J.R_HIP_ROLL, 0.55],
        [J.R_HIP_PITCH, 0.95], [J.R_KNEE, -1.93], [J.R_ANK_PITCH, 0.74],
        // right hand flat on the floor on the side the walker leans onto
        // wrist and shoulder roll swept on their own, with every other joint held,
        // to lay the PALM on the floor (0.98 of 1) instead of standing the hand on
        // its edge — the rest of the posture is exactly as it was
        // -0.20 is the right shoulder's adduction limit, and it is written as the
        // limit rather than past it: reset() silently clamps, so an out-of-range
        // literal reads back as a pose the file does not describe
        [J.R_SHOULDER, -1.07], [J.R_SHOULDER_ROLL, -0.20], [J.R_WRIST, -1.10],
        [J.L_SHOULDER, 0.55], [J.L_SHOULDER_ROLL, -0.40], [J.L_ELBOW, 1.00]
    ])}
    ];
})();

if (typeof module !== "undefined" && module.exports) module.exports = { POSE_CANDIDATES };
