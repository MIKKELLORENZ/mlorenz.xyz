/* walker_impl.hpp — the Walker methods that need a World.
 *
 * Split out only because World and Walker are mutually recursive: a walker asks
 * the world for its waypoint, and the world steps the walker. Everything here is
 * a straight port of the corresponding block in walker.js.
 *
 * ONE DELIBERATE NUMERICAL DIFFERENCE, stated once here rather than repeated at
 * every site: JS Math.hypot uses a scaling algorithm that avoids overflow at the
 * cost of extra arithmetic, and this uses plain sqrt(x*x + …). Every quantity it
 * is applied to is a metre-scale distance or a newton-scale force, nowhere near
 * the range where the scaling matters, so the two agree to within one ulp — but
 * they are not bit-identical, and over a 130-second episode a one-ulp difference
 * compounds chaotically like any other. That is why the port is validated
 * per-step against the JS oracle and statistically over episodes, never by
 * expecting two whole runs to match.
 */
#pragma once
#include "world.hpp"

/* ------------------------------------------------------------------ reset */
inline void Walker::reset(const World* world, double x, double z, double yaw, const Pose* pose) {
    const Model& M = *model;
    const Fit& F = FIT();
    std::fill(mb.q.begin(), mb.q.end(), 0.0);
    std::fill(mb.qd.begin(), mb.qd.end(), 0.0);
    mb.blown = false;

    const std::vector<double>* jit = world ? &world->jitterPose : nullptr;
    // A walker that starts on the floor starts DOWN, so the rise rung is live
    // from the first tick rather than only after a fall.
    startedDown = (pose != nullptr);
    startPoseName = pose ? pose->name : "crouch";
    const std::vector<double>& q0 = pose ? pose->q : M.crouch;
    for (int j = 0; j < nj; j++) {
        double a = q0[j];
        if (jit) a += (*jit)[j];
        mb.q[j + 1] = clampd(a, M.bodies[j + 1].qmin, M.bodies[j + 1].qmax);
        // The servo setpoint powers on at the MEASURED joint angle, as a real one
        // does. Starting it at the standing pose instead makes the very first tick
        // a full-scale step command, and the walker leaves the ground at 27x its
        // own weight before the network gets a say.
        target[j] = mb.q[j + 1];
        cmd[j] = base[j] = M.nominal[j];
    }
    // Pelvis attitude: yaw about +Y, then pitch about +Z, then roll about +X.
    // Standing poses only ever set yaw; a ground pose tips the body over.
    const double pitch = pose ? pose->pitch : 0.0, roll = pose ? pose->roll : 0.0;
    const double qy[4] = { std::cos(yaw*0.5), 0, std::sin(yaw*0.5), 0 };
    const double qp[4] = { std::cos(pitch*0.5), 0, 0, std::sin(pitch*0.5) };
    const double qr[4] = { std::cos(roll*0.5), std::sin(roll*0.5), 0, 0 };
    auto qmul = [](const double* a, const double* b, double* o) {
        o[0] = a[0]*b[0] - a[1]*b[1] - a[2]*b[2] - a[3]*b[3];
        o[1] = a[0]*b[1] + a[1]*b[0] + a[2]*b[3] - a[3]*b[2];
        o[2] = a[0]*b[2] - a[1]*b[3] + a[2]*b[0] + a[3]*b[1];
        o[3] = a[0]*b[3] + a[1]*b[2] - a[2]*b[1] + a[3]*b[0];
    };
    double t4[4], q4[4];
    qmul(qy, qp, t4);
    qmul(t4, qr, q4);
    for (int k = 0; k < 4; k++) mb.bq[k] = q4[k];
    mb.bp[0] = x; mb.bp[1] = 0; mb.bp[2] = z;
    mb.fk();
    // Drop the assembled pose onto the ground: find the lowest contact point and
    // lift by exactly that much.
    double lowest = 1e9;
    for (const auto& c : M.contacts) {
        mb.worldPoint(c.body, c.p[0], c.p[1], c.p[2], p3);
        const double g = world ? world->terrain.height(p3[0], p3[2]) : 0.0;
        lowest = std::min(lowest, p3[1] - g);
    }
    mb.bp[1] = -lowest + 0.003;
    mb.fk();

    // COM-velocity differencing state: no history on the first control tick, so
    // the channel reads zero rather than a spike off a stale pose.
    comHave = false;
    comHaveW = false;
    patchDatum = 0;

    std::fill(anchored.begin(), anchored.end(), (uint8_t)0);
    std::fill(ptForce.begin(), ptForce.end(), 0.0);
    peakPtForce = 0;
    std::fill(histBuf.begin(), histBuf.end(), 0.0f);
    histWrite = 0;
    std::fill(out.begin(), out.end(), 0.5f);
    std::fill(amp.begin(), amp.end(), 0.0);
    std::fill(ph.begin(), ph.end(), 0.0);
    phase = 0; cadence = 1; gaitGain = 0;

    done = false; timeLeft = 0; fallTimer = 0; fallSeverity = 0; comPeak = 0;
    diverged = false;      // flung off the map, as distinct from fallen over
    downed = false;        // on the ground, and has to get itself up
    downTimer = 0; riseTimer = 0; falls = 0; recoveries = 0; riseIncome = 0;
    riseRefSet = false;    // the settled reference height is taken after 0.5 s
    bestComY = 0; standTimer = 0; stoodAt = 0; stood = false; balanced = false;
    footLoad[0] = footLoad[1] = 0;
    footContact[0] = footContact[1] = 0;
    steps = 0; strideSum = 0;
    footAir[0] = footAir[1] = 0;
    footAirborne[0] = footAirborne[1] = false;
    for (int k = 0; k < 4; k++) footOff[k] = 0;

    if (startedDown) {
        downed = true;
        bestComY = comHeight(world ? &world->terrain : nullptr);
    }

    fitScore = 0;          // banked: milestones + completed legs
    penalty = 0; energy = 0; arrivals = 0;
    progressM = 0;         // metres of honest closure — the learning signal
    alignSum = 0;          // closure-weighted heading alignment, /progressM
    legIdx = 0; legStartTime = 0; legInitDist = 1; bestDist = 1e9;
    pathLen = 0; usefulLen = 0; pendingPush = 0; pushesSurvived = 0;
    legWalkScore = 0; legShapeScore = 0;
    // beginLeg() resizes this per leg; the reset value covers the window before
    // the first leg starts so payWalk never reads a stale budget.
    legBudget = F.PROGRESS_PER_M * legInitDist + F.WALK_SHAPE_CAP;
    pushLeft = 0; pushX = 0; pushZ = 0;
    uprightTime = 0; walkTime = 0;
    lastPx = mb.bp[0]; lastPz = mb.bp[2];
}

/* --------------------------------------------------- sensing + control (50 Hz) */
inline void Walker::control(World& world) {
    const Model& M = *model;
    const Layout& L = LAY();
    const Terrain& T = world.terrain;
    float* cur = &histBuf[(size_t)histWrite * (size_t)L.NC];
    const double want = (world.phase == Phase::WALK) ? 1.0 : 0.0;
    gaitGain += (want - gaitGain) * (want ? 0.10 : 0.30);
    const double* R = mb.R.data();

    // 0-2  gravity in pelvis coordinates: R^T·(0,-1,0)
    cur[0] = (float)(-R[3]); cur[1] = (float)(-R[4]); cur[2] = (float)(-R[5]);
    // 3-5 gyro, 6-8 velocity — both already body-frame in the spatial state
    cur[3] = (float)clampd(mb.qd[0]/5, -1.5, 1.5);
    cur[4] = (float)clampd(mb.qd[1]/5, -1.5, 1.5);
    cur[5] = (float)clampd(mb.qd[2]/5, -1.5, 1.5);
    cur[6] = (float)clampd(mb.qd[3]/3, -1.5, 1.5);
    cur[7] = (float)clampd(mb.qd[4]/3, -1.5, 1.5);
    cur[8] = (float)clampd(mb.qd[5]/3, -1.5, 1.5);
    // posture
    const double clr = groundClearance(T);
    cur[L.C_HEIGHT] = (float)clampd(clr / M.standHipY, 0, 1.5);
    cur[L.C_UPRIGHT] = (float)uprightness();
    // joint state
    for (int j = 0; j < nj; j++) {
        const BodyDef& b = M.bodies[j + 1];
        cur[L.C_QA + j] = (float)clampd(2*(mb.q[j+1] - b.qmin)/M.span[j] - 1, -1.2, 1.2);
        cur[L.C_QD + j] = (float)clampd(mb.qd[6 + j]/12, -1.5, 1.5);
    }
    // feet
    const double invW = 1.0 / M.weight;
    cur[L.C_LOAD]     = (float)clampd(footLoad[0]*invW, 0, 2);
    cur[L.C_LOAD + 1] = (float)clampd(footLoad[1]*invW, 0, 2);
    cur[L.C_CONTACT]     = (float)footContact[0];
    cur[L.C_CONTACT + 1] = (float)footContact[1];
    for (int s = 0; s < 2; s++) {
        const int fb = M.footBody[s];
        // Stashed, not just used: every terrain sensor below is referenced to
        // these two points, and recomputing them there would be a second
        // definition of "where the foot is" that could drift from this one.
        mb.worldPoint(fb, 0, -Seg::ankleH, 0, &sole[s*3]);
        const double dx = sole[s*3] - mb.bp[0], dy = sole[s*3+1] - mb.bp[1], dz = sole[s*3+2] - mb.bp[2];
        cur[L.C_FOOTPOS + s*3]     = (float)clampd((R[0]*dx + R[3]*dy + R[6]*dz)/0.6, -1.5, 1.5);
        cur[L.C_FOOTPOS + 1 + s*3] = (float)clampd((R[1]*dx + R[4]*dy + R[7]*dz)/0.6, -1.5, 1.5);
        cur[L.C_FOOTPOS + 2 + s*3] = (float)clampd((R[2]*dx + R[5]*dy + R[8]*dz)/0.6, -1.5, 1.5);
    }
    // waypoint
    const Point& wp = world.waypointFor(*this);
    const double hd = heading();
    {
        const double dx = wp.x - mb.bp[0], dz = wp.z - mb.bp[2];
        const double dist = std::sqrt(dx*dx + dz*dz);
        const double rel = wrapPi(std::atan2(-dz, dx) - hd);
        cur[L.C_WPDIST] = (float)clampd(dist/6, 0, 1.5);
        cur[L.C_WPBEAR] = (float)std::sin(rel);
        cur[L.C_WPBEAR + 1] = (float)std::cos(rel);
    }
    // gait clock
    cur[L.C_GAIT]     = (float)std::sin(phase);
    cur[L.C_GAIT + 1] = (float)std::cos(phase);

    /* Terrain ahead, relative to the ground under the PELVIS: 4 distances x 5
     * lateral offsets, ordered lateral-major with the 0.0 column third. That
     * centre column is bit-identical to the four legacy probes it replaces — same
     * pelvis datum, same 0.3 m scale — which is what makes the fan a strict
     * superset and lets a graft carry those weights across meaning exactly what
     * they meant before. (The foveal patches below, where a shared FOOT datum is
     * the whole point, do use that instead.)
     *
     * Its job is route shape — "the ground rises ahead and to the left" — not
     * stairs. Stairs are the patches' job. */
    const double fx = std::cos(hd), fz = -std::sin(hd);
    // the doll's left, in the gravity-levelled heading frame: up x forward
    const double sideX = -fz, sideZ = fx;
    const double baseH = T.height(mb.bp[0], mb.bp[2]);
    for (int r = 0; r < 3; r++) {
        const double d = L.RING_R[r];
        const int b = L.C_TERRAIN + r*RING_DIRS;
        for (int k = 0; k < RING_DIRS; k++) {
            // Heading-relative, so the ring means the same thing whichever way the
            // walker faces: index 0 is always straight ahead.
            const double ux = fx*L.RING_C[k] + sideX*L.RING_S[k];
            const double uz = fz*L.RING_C[k] + sideZ*L.RING_S[k];
            const double hgt = T.height(mb.bp[0] + ux*d, mb.bp[2] + uz*d);
            cur[b + k] = (float)clampd((hgt - baseH)/0.3, -1.5, 1.5);
        }
    }
    // wind, relative to facing
    {
        const double wmag = std::sqrt(world.wind[0]*world.wind[0] + world.wind[2]*world.wind[2]);
        if (wmag > 0.1) {
            const double rel = wrapPi(std::atan2(-world.wind[2], world.wind[0]) - hd);
            const double k = std::min(1.0, wmag/12);
            cur[L.C_WIND] = (float)(std::sin(rel)*k);
            cur[L.C_WIND + 1] = (float)(std::cos(rel)*k);
        } else { cur[L.C_WIND] = 0; cur[L.C_WIND + 1] = 0; }
    }
    // efference copy of the action issued last tick
    for (int j = 0; j < nj; j++) cur[L.C_EFFERENCE + j] = (float)(out[j]*2 - 1);

    /* Centre-of-mass velocity in the pelvis frame. Built exactly the way a real
     * robot would: sum the link masses through forward kinematics to get the COM,
     * express it relative to the pelvis, and difference it over the control
     * interval. No world-frame odometry, so nothing here depends on knowing where
     * the robot is. */
    {
        double m = 0, cx = 0, cy = 0, cz = 0;
        for (size_t i = 0; i < M.bodies.size(); i++) {
            const BodyDef& b = M.bodies[i];
            if (b.mass <= 0) continue;
            mb.worldPoint((int)i, b.com[0], b.com[1], b.com[2], p3);
            cx += b.mass*p3[0]; cy += b.mass*p3[1]; cz += b.mass*p3[2];
            m += b.mass;
        }
        if (m > 0) { cx /= m; cy /= m; cz /= m; }
        const double dx = cx - mb.bp[0], dy = cy - mb.bp[1], dz = cz - mb.bp[2];
        const double lx = R[0]*dx + R[3]*dy + R[6]*dz;
        const double ly = R[1]*dx + R[4]*dy + R[7]*dz;
        const double lz = R[2]*dx + R[5]*dy + R[8]*dz;
        if (comHave) {
            const double idt = 1.0 / (DT * CONTROL_EVERY);
            // Scaled to roughly +/-1 over the speeds a walker actually reaches; the
            // network sees a bounded signal like every other channel rather than
            // one that saturates its first layer.
            cur[L.C_COMVEL]     = (float)clampd((lx - comPrev[0])*idt/2.5, -1.5, 1.5);
            cur[L.C_COMVEL + 1] = (float)clampd((ly - comPrev[1])*idt/2.5, -1.5, 1.5);
            cur[L.C_COMVEL + 2] = (float)clampd((lz - comPrev[2])*idt/2.5, -1.5, 1.5);
        } else {
            cur[L.C_COMVEL] = 0; cur[L.C_COMVEL + 1] = 0; cur[L.C_COMVEL + 2] = 0;
            comHave = true;
        }
        comPrev[0] = lx; comPrev[1] = ly; comPrev[2] = lz;

        /* ---- the inverted pendulum, which the ledger already pays for ----
         * See the layout block in walker.hpp for why these exist. All derived
         * from the world-frame COM just computed: one terrain sample and a sqrt. */
        const double hcom = cy - T.height(cx, cz);
        cur[L.C_COMH] = (float)clampd(hcom / M.standHipY, 0, 1.5);

        // World-frame COM velocity. The pelvis-frame one above cannot be reused:
        // the capture point is a point ON THE GROUND, and a velocity expressed in
        // a frame that is itself rotating does not locate it.
        double vwx = 0, vwz = 0;
        if (comHaveW) {
            const double idtw = 1.0 / (DT * CONTROL_EVERY);
            vwx = (cx - comPrevW[0]) * idtw;
            vwz = (cz - comPrevW[2]) * idtw;
        } else comHaveW = true;
        comPrevW[0] = cx; comPrevW[1] = cy; comPrevW[2] = cz;

        // xi = com + v*sqrt(h/g). Floored at 5 cm so a walker flat on the floor
        // does not divide the pendulum by nothing.
        const double omega = std::sqrt(std::max(0.05, hcom) / 9.81);
        const double capX = cx + vwx*omega, capZ = cz + vwz*omega;

        /* Both relative to the midpoint of the two soles, in the heading frame, so
         * "my mass is outside my feet" is a sign change rather than a subtraction
         * the network has to learn. */
        const double supX = 0.5 * (sole[0] + sole[3]);
        const double supZ = 0.5 * (sole[2] + sole[5]);
        const double cdx = cx - supX, cdz = cz - supZ;
        cur[L.C_COMPOS]     = (float)clampd((cdx*fx + cdz*fz) / 0.30, -1.5, 1.5);
        cur[L.C_COMPOS + 1] = (float)clampd((cdx*sideX + cdz*sideZ) / 0.30, -1.5, 1.5);
        const double kdx = capX - supX, kdz = capZ - supZ;
        cur[L.C_CAPTURE]     = (float)clampd((kdx*fx + kdz*fz) / 0.50, -1.5, 1.5);
        cur[L.C_CAPTURE + 1] = (float)clampd((kdx*sideX + kdz*sideZ) / 0.50, -1.5, 1.5);
    }

    /* ---------------------------------- foot-referenced terrain sensing */
    {
        const double hL = T.height(sole[0], sole[2]);
        const double hR = T.height(sole[3], sole[5]);
        const double datum = hL < hR ? hL : hR;
        for (int s = 0; s < 2; s++) {
            const double ax = sole[s*3], ay = sole[s*3+1], az = sole[s*3+2];
            const double gh = s == 0 ? hL : hR;

            /* Height of the sole above the terrain DIRECTLY BENEATH IT. On flat
             * ground this is redundant — reconstructible from C_FOOTPOS and
             * C_HEIGHT. On stairs that reconstruction is wrong, because the ground
             * under the foot is not the ground under the pelvis. So it carries new
             * information exactly where we are failing, and nowhere else. */
            cur[L.C_FOOTCLR + s] = (float)clampd((ay - gh)/CLEAR_SCALE, -0.5, 1.5);

            /* Sole attitude relative to the LOCAL SURFACE, not to gravity. On a 20
             * degree slope the sole should be flat to the slope, and a
             * gravity-referenced angle would tell the brain it is doing the wrong
             * thing. Recoverable in principle from ankle+knee+hip through the chain
             * plus the pelvis gravity vector — five joints and a lot of
             * trigonometry, which a GA will not discover. */
            const double dhx = (T.height(ax + NORMAL_STEP, az) - T.height(ax - NORMAL_STEP, az)) / (2*NORMAL_STEP);
            const double dhz = (T.height(ax, az + NORMAL_STEP) - T.height(ax, az - NORMAL_STEP)) / (2*NORMAL_STEP);
            const double nl = std::sqrt(dhx*dhx + 1 + dhz*dhz);
            const double Nx = -dhx/nl, Ny = 1/nl, Nz = -dhz/nl;
            /* The foot's local +Y, NOT the sole's outward normal (local -Y). -Y is
             * genuinely the normal of the sole surface, but it points DOWN while a
             * terrain normal points UP, so a foot lying perfectly flat on flat
             * ground came out at 180 degrees and pinned all twelve of these inputs
             * to the clamp. What the channel has to mean is DEVIATION FROM FLAT,
             * which is zero when the foot's up-axis agrees with the surface's. */
            const double* Rf = &mb.R[(size_t)M.footBody[s] * 9];
            const double Sx = Rf[1], Sy = Rf[4], Sz = Rf[7];
            cur[L.C_FOOTATT + s*2]     = (float)clampd(
                signedAngleAbout(Nx, Ny, Nz, Sx, Sy, Sz, sideX, 0, sideZ) / ATT_SCALE, -1.5, 1.5);
            cur[L.C_FOOTATT + s*2 + 1] = (float)clampd(
                signedAngleAbout(Nx, Ny, Nz, Sx, Sy, Sz, fx, 0, fz) / ATT_SCALE, -1.5, 1.5);

            /* The foveal patch. POINT-SAMPLED, never blurred: bilinear
             * downsampling turns a 0.17 m riser into a ramp and destroys the one
             * discontinuity this whole exercise exists to capture. If pooling is
             * ever added it must be MIN-pool — worst case underfoot. */
            const double cx = ax + fx*PATCH_FWD, cz = az + fz*PATCH_FWD;
            const int b = L.C_PATCH + s*PATCH_CELLS;
            for (int r = 0; r < PATCH_N; r++) {
                const double df = L.PATCH_OFF[r];
                for (int c = 0; c < PATCH_N; c++) {
                    const double dl = L.PATCH_OFF[c];
                    const double qx = cx + fx*df + sideX*dl, qz = cz + fz*df + sideZ*dl;
                    cur[b + r*PATCH_N + c] = (float)clampd((T.height(qx, qz) - datum)/DATUM_SCALE, -1, 1);
                }
            }
        }
        patchDatum = datum;
    }

    // assemble the lag window
    {
        const int n = (int)L.planLag.size();
        for (int i = 0; i < n; i++) {
            const int lag = L.planLag[i], ch = L.planCh[i];
            inputs[i] = lag == 0 ? cur[ch]
                : histBuf[(size_t)((histWrite - lag + L.MAXHIST) % L.MAXHIST) * (size_t)L.NC + ch];
        }
    }
    histWrite = (histWrite + 1) % L.MAXHIST;

    if (world.noise) {
        const double s = SIM2REAL::sensorNoise;
        for (size_t i = 0; i < inputs.size(); i++) inputs[i] = (float)((double)inputs[i] + nrand(rng)*s);
    }

    const float* o = brain->forward(inputs.data(), nnBuf.data());
    for (int i = 0; i < L.NOUT; i++) {
        double v = o[i];
        if (world.noise) v += nrand(rng) * SIM2REAL::actionNoise;
        out[i] = (float)clampd(v, 0, 1);
    }
    // joint setpoints: nominal +/- range. A newborn's 0.5s land exactly on the
    // nominal standing pose, so evolution starts from "try to stand", not from
    // "flail". Held between control ticks, like a real servo bus.
    for (int j = 0; j < nj; j++) base[j] = M.nominal[j] + (out[j]*2 - 1) * M.range[j];
    cadence = 0.55 + out[L.O_CADENCE] * 1.15;
    const auto& G = CPG_GROUPS();
    for (size_t g = 0; g < G.size(); g++) {
        amp[g] = (out[L.O_AMP + (int)g]*2 - 1) * G[g].amax * TUNE().cpgScale;
        ph[g]  = (out[L.O_PHASE + (int)g]*2 - 1) * 3.141592653589793;
    }
    /* base posture + rhythm -> the setpoint the servos chase. `gaitGain` ramps the
     * rhythm in over half a second once walking is the job and holds it at zero
     * before that. Letting the legs swing during the stand-up was measured to
     * topple the entire population before the walk phase even began — a walker
     * cannot rise out of a squat and pedal at the same time. */
    for (int j = 0; j < nj; j++) cmd[j] = base[j];
    for (size_t g = 0; g < G.size(); g++) {
        const double a = amp[g] * gaitGain;
        if (a == 0) continue;
        cmd[G[g].j0] += a * std::sin(phase + ph[g] + G[g].off0);
        cmd[G[g].j1] += a * std::sin(phase + ph[g] + G[g].off1);
    }
    for (int j = 0; j < nj; j++) cmd[j] = clampd(cmd[j], M.bodies[j+1].qmin, M.bodies[j+1].qmax);
}

/* ------------------------------------------------------------ physics tick */
inline void Walker::stepPhysics(World& world, double dt) {
    mb.fk();
    mb.clearForces();
    contactsStep(world, dt);
    selfCollide();
    windStep(world);
    pushStep(dt);
    servos(world, dt);
    mb.dynamics(tau.data());
    mb.integrate(dt);
    if (mb.blown) done = true;   // NaN somewhere — retire it rather than poison the pool
    /* A clamped acceleration prevents NaN; it does not prevent RUNAWAY. qdd is
     * limited to +/-4000 rad/s^2, which is finite the whole way while a walker is
     * flung kilometres in a few seconds — and such a walker never trips the fall
     * detector, because it is high and upright rather than low and collapsed.
     * Measured in a real run: centre of mass at 688 m, then 1,783 m, then 7,114 m,
     * credited with closing on its waypoint the entire way and reported as
     * "walked 16.35 m". Finite is not the same as physical. */
    /* The 25 m/s ceiling was set against walkers flung KILOMETRES. It passes the
     * ordinary version of the same fault: a captured browser incident had the
     * walker leave at 7.3 m/s, sail straight through, and be scored as a real
     * episode. Three tighter tests, each a thing a 65 kg humanoid cannot do
     * rather than a tuned threshold — identical to walker.js, and the JS file
     * carries the long-form reasoning.
     *
     * Measured on 24 held-out episodes per condition, same seeds: crouch starts
     * keep all 13 waypoints and lose 0.15% of fitness, so the guard is not
     * eating legitimate walkers. It flags 6/24 ordinary episodes and 10/24 pose
     * episodes — those were being scored before, which is the point. */
    if (!done) {
        const double hgt = mb.bp[1] - world.terrain.height(mb.bp[0], mb.bp[2]);
        const double spd = std::sqrt(mb.qd[3]*mb.qd[3] + mb.qd[4]*mb.qd[4] + mb.qd[5]*mb.qd[5]);
        const double vh  = std::sqrt(mb.qd[3]*mb.qd[3] + mb.qd[5]*mb.qd[5]);
        const double spin = std::sqrt(mb.qd[0]*mb.qd[0] + mb.qd[1]*mb.qd[1] + mb.qd[2]*mb.qd[2]);
        if (!(hgt < 4 && hgt > -2 && spd < 25 && vh < DIVERGE_VH && spin < DIVERGE_SPIN &&
              peakPtForce < DIVERGE_FORCE_BW * model->weight)) { done = true; diverged = true; }
    }
}

/* Ground reaction at every contact point. */
inline void Walker::contactsStep(World& world, double dt) {
    const Model& M = *model;
    const Terrain& T = world.terrain;
    const double mu = T.mu * world.frictionScale;
    peakPtForce = 0;   // this tick's largest single-point normal force
    footLoad[0] = footLoad[1] = 0;
    footContact[0] = footContact[1] = 0;
    const int n = (int)M.contacts.size();
    for (int i = 0; i < n; i++) {
        const ContactPt& c = M.contacts[i];
        mb.worldPoint(c.body, c.p[0], c.p[1], c.p[2], p3);
        T.sample(p3[0], p3[2], s4);
        // perpendicular depth: the vertical gap projected onto the normal
        const double depth = (s4[0] - p3[1]) * s4[2];
        if (depth <= 0) { anchored[i] = 0; ptForce[i] = 0; continue; }
        mb.worldPointVel(c.body, c.p[0], c.p[1], c.p[2], v3);
        const double nx = s4[1], ny = s4[2], nz = s4[3];
        const double vn = v3[0]*nx + v3[1]*ny + v3[2]*nz;
        /* Two bounds, because the shipped law had neither. A hand landing at
         * 3 m/s was answered with 7.5 kN — eleven times what its penetration
         * justified — which spun the body about the contact and drove the same
         * point deeper, raising the force again. See walker.js for the full
         * note; the vn clamp is the same -2 m/s _selfCollide already applies to
         * `closing`, and the cap is per POINT of ~20, so it does not constrain
         * real support. Measured on 24 episodes/condition, identical seeds:
         * crouch 5/24 diverged -> 0/24, 29.0 -> 7.0 m/s, 13 waypoints kept,
         * fitness 2718 -> 2742; pool poses 6/24 -> 0/24, 37.2 -> 16.2 m/s. */
        double fn = CONTACT::KN * depth * (1 - CONTACT::HC * std::max(vn, -CONTACT::VN_MAX));
        if (fn > CONTACT::F_MAX_BW * M.weight) fn = CONTACT::F_MAX_BW * M.weight;
        if (fn <= 0) { anchored[i] = 0; ptForce[i] = 0; continue; }
        ptForce[i] = fn;
        if (fn > peakPtForce) peakPtForce = fn;
        if (c.foot >= 0) { footLoad[c.foot] += fn; footContact[c.foot] = 1; }

        // tangential: a stick spring anchored where the point first landed
        const int a = i*3;
        if (!anchored[i]) { anchored[i] = 1; anchor[a] = p3[0]; anchor[a+1] = p3[1]; anchor[a+2] = p3[2]; }
        double dx = p3[0] - anchor[a], dy = p3[1] - anchor[a+1], dz = p3[2] - anchor[a+2];
        const double dn = dx*nx + dy*ny + dz*nz;
        dx -= dn*nx; dy -= dn*ny; dz -= dn*nz;
        const double tvx = v3[0] - vn*nx, tvy = v3[1] - vn*ny, tvz = v3[2] - vn*nz;
        double ftx = -CONTACT::KT*dx - CONTACT::CT*tvx;
        double fty = -CONTACT::KT*dy - CONTACT::CT*tvy;
        double ftz = -CONTACT::KT*dz - CONTACT::CT*tvz;
        const double mag = std::sqrt(ftx*ftx + fty*fty + ftz*ftz), lim = mu*fn;
        if (mag > lim) {
            const double k = lim / (mag != 0 ? mag : 1.0);
            ftx *= k; fty *= k; ftz *= k;
            // slide the anchor so the spring sits exactly at the Coulomb limit
            anchor[a]   = p3[0] + ftx/CONTACT::KT;
            anchor[a+1] = p3[1] + fty/CONTACT::KT;
            anchor[a+2] = p3[2] + ftz/CONTACT::KT;
        }
        mb.addWorldForce(c.body, p3[0], p3[1], p3[2], ftx + fn*nx, fty + fn*ny, ftz + fn*nz);
    }
}

/* Limb against limb. Same Hunt-Crossley normal law as the ground, so the force
 * vanishes smoothly on separation instead of pulling the limbs back together as
 * they part. Softer than the ground because this is a limit stop, not a floor: it
 * has to make crossing impossible, not make contact feel rigid. No friction term —
 * limbs sliding past each other is fine, passing through each other is not. */
inline void Walker::selfCollide() {
    const auto& pairs = model->selfPairs;
    for (const auto& pr : pairs) {
        const Sphere& a = pr.first;
        const Sphere& b = pr.second;
        mb.worldPoint(a.body, a.p[0], a.p[1], a.p[2], p3);
        mb.worldPoint(b.body, b.p[0], b.p[1], b.p[2], sp3);
        double dx = sp3[0]-p3[0], dy = sp3[1]-p3[1], dz = sp3[2]-p3[2];
        const double d2 = dx*dx + dy*dy + dz*dz;
        const double rr = a.r + b.r;
        /* Squared-distance reject before the sqrt. The pair list is 65 long and
         * runs every physics tick — 11.4% of runtime in the JS profile — and the
         * overwhelming majority of pairs are nowhere near touching. */
        if (d2 >= rr*rr) continue;
        const double d = std::sqrt(d2);
        const double pen = rr - d;
        if (pen <= 0 || d < 1e-9) continue;
        dx /= d; dy /= d; dz /= d;                       // a -> b
        mb.worldPointVel(a.body, a.p[0], a.p[1], a.p[2], v3);
        mb.worldPointVel(b.body, b.p[0], b.p[1], b.p[2], sv3);
        // closing speed along the axis, positive when they are converging
        const double closing = -((sv3[0]-v3[0])*dx + (sv3[1]-v3[1])*dy + (sv3[2]-v3[2])*dz);
        double fn = CONTACT::KN_SELF * pen * (1 + CONTACT::HC * std::max(-2.0, closing));
        if (fn < 0) fn = 0;
        mb.addWorldForce(a.body, p3[0], p3[1], p3[2], -fn*dx, -fn*dy, -fn*dz);
        mb.addWorldForce(b.body, sp3[0], sp3[1], sp3[2], fn*dx, fn*dy, fn*dz);
    }
}

/* Aerodynamic drag on the torso from the ambient wind. */
inline void Walker::windStep(World& world) {
    if (!world.windOn) return;
    const BodyDef& b = model->bodies[2];
    mb.worldPoint(2, b.com[0], b.com[1], b.com[2], p3);
    mb.worldPointVel(2, b.com[0], b.com[1], b.com[2], v3);
    const double rx = world.wind[0] - v3[0], rz = world.wind[2] - v3[2];
    const double m = std::sqrt(rx*rx + rz*rz);
    if (m < 0.05) return;
    const double k = 0.5 * 1.225 * 1.1 * 0.35;      // 1/2·rho·Cd·A for a human torso
    mb.addWorldForce(2, p3[0], p3[1], p3[2], k*rx*m, 0, k*rz*m);
}

/* A scripted shove at the pelvis — the stage-2 balance exam. */
inline void Walker::pushStep(double dt) {
    if (pushLeft > 0) {
        mb.addWorldForce(0, mb.bp[0], mb.bp[1], mb.bp[2], pushX, 0, pushZ);
        pushLeft -= dt;
    }
}

/* PD servo per joint: first-order lag on the setpoint, then torque clamped to the
 * joint's real peak. */
inline void Walker::servos(World& world, double dt) {
    const Model& M = *model;
    if (dt != servoLagMemoDt) { servoLagMemoDt = dt; servoLagMemo = 1 - std::exp(-dt / SIM2REAL::servoLag); }
    double lag = servoLagMemo;
    const double kScale = world.gainScale, tScale = world.torqueScale;

    /* Bound how fast the setpoint may travel — but bound the WHOLE move, not each
     * joint separately.
     *
     * A neutral network output maps to the standing trim, so the default command
     * from any pose is "stand up". From a deep crouch that is a full-scale step,
     * and the lag alone let the body reach 1.24 m of centre-of-mass height against
     * a standing 0.84 m — it left the floor. That also meant rising from a crouch
     * cost the network nothing: the servos did it, so "rose 6/6" measured the
     * transient, not a skill.
     *
     * A per-joint rate cap is the wrong tool: equal speeds make small-error joints
     * arrive first and the soles come off the ground. Scaling the single
     * proportional step keeps every joint on the same straight line in joint space
     * — soles stay down — while capping how quickly it is walked. */
    double maxErr = 0;
    for (int j = 0; j < nj; j++) {
        const double e = std::fabs(cmd[j] - target[j]);
        if (e > maxErr) maxErr = e;
    }
    const double step = maxErr * lag;
    const double cap = SIM2REAL::setpointSlewMax * dt;
    if (step > cap && maxErr > 1e-9) lag *= cap / step;

    const double sScale = TUNE().servoScale;
    for (int j = 0; j < nj; j++) {
        target[j] += (cmd[j] - target[j]) * lag;
        const double e = target[j] - mb.q[j+1];
        double t = M.kp[j]*kScale*sScale*e - M.kd[j]*mb.qd[6+j];
        if (world.noise) t *= 1 + nrand(rng) * SIM2REAL::torqueJitter;
        const double lim = M.tauMax[j] * tScale;
        if (t > lim) t = lim; else if (t < -lim) t = -lim;
        // The actuator's own work, metered BEFORE the mechanical stop below: a
        // limb resting against its end stop is not spending battery.
        energy += std::fabs(t * mb.qd[6+j]) * dt * (downed ? FIT().ENERGY_DOWN_W : 1.0);

        /* THE MECHANICAL HARD STOP, as a torque. It used to live in integrate()
         * as a position edit that teleported a joint back inside its limit and
         * zeroed its velocity — which conserves neither momentum nor energy, and
         * fired on 21% of ticks in ordinary walking and 34% in the floor poses,
         * with 97% of sudden spin-ups landing on a tick where it fired. That is
         * where the spins came from, and why a smaller timestep never helped.
         * Written as a torque it goes through the articulated-body solve and the
         * reaction reaches the rest of the body. Deliberately NOT limited by
         * tauMax: an actuator has a torque ceiling, a lump of metal does not.
         * Measured, crouch starts, 24 episodes: backstop 21.0% -> 0.00% of ticks,
         * peak spin 24.5 -> 8.2 rad/s, waypoints 9 -> 19, fitness 2113 -> 4649. */
        {
            const double qj = mb.q[j+1], vj = mb.qd[6+j];
            const BodyDef& bd = M.bodies[j+1];
            double over = 0;
            if (qj > bd.qmax) over = qj - bd.qmax; else if (qj < bd.qmin) over = qj - bd.qmin;
            if (over != 0) {
                t -= JOINT_STOP_K * over;
                if (over * vj > 0) t -= JOINT_STOP_C * vj;
            }
        }
        tau[j+1] = t;
    }
}

/* How hard did it go down? Torso speed at the moment of collapse, in multiples of
 * the base penalty. Floored at 1 so even a gentle sit-down costs something, capped
 * so a freak number cannot swamp the ledger. */
inline double Walker::fallSeverityNow() {
    const Fit& F = FIT();
    const BodyDef& b = model->bodies[2];
    mb.worldPointVel(2, b.com[0], b.com[1], b.com[2], v3);
    const double s = std::sqrt(v3[0]*v3[0] + v3[1]*v3[1] + v3[2]*v3[2]);
    return std::min(F.FALL_MAX_MULT, 1 + F.FALL_SPEED_W * std::max(0.0, s - F.FALL_FREE_SPEED));
}

inline void Walker::arrive(World& world, double d) {
    const Fit& F = FIT();
    const double legTime = world.time - legStartTime;
    double gain = F.ARRIVE;
    // Closure speed over the leg, so a long leg walked briskly beats a short one
    // dawdled. Guarded against a zero-length interval.
    const double closureSpeed = legInitDist / std::max(0.25, legTime);
    gain += F.ARRIVE_SPEED * std::min(1.0, closureSpeed / F.ARRIVE_SPEED_REF);
    gain += F.TERRAIN_BONUS * world.terrain.difficulty * (world.terrain.id == TerrainId::FLAT ? 0 : 1);
    gain += F.WIND_BONUS * world.windFrac;
    // wander: distance walked beyond what this leg actually needed
    const double excess = std::max(0.0, pathLen - usefulLen - legInitDist * F.WANDER_SLACK);
    gain -= std::min(F.WANDER_CAP, F.WANDER_W * excess);
    fitScore += gain;
    usefulLen = pathLen;
    arrivals++;
    timeLeft += world.arrivalTime;
    legIdx++;
    world.onArrival(*this);
}

/* ------------------------------------------------------------ bookkeeping */
/* Called once per control tick, after control() and the physics that follows. */
inline void Walker::tickBook(World& world) {
    const Model& M = *model;
    const Fit& F = FIT();
    const Terrain& T = world.terrain;
    const double dtc = CTRL_DT;
    phase += 2 * 3.141592653589793 * GAIT_HZ * cadence * dtc;
    if (phase > 1e6) phase -= 1e6;
    const double up = uprightness();
    const double clr = groundClearance(T);
    const double heightFrac = clampd((clr - 0.45*M.standHipY) / (0.95*M.standHipY - 0.45*M.standHipY), 0, 1);

    // ---- stage 1: posture. Income, but only while standing up is the job.
    if (world.phase == Phase::STAND) fitScore += F.POSTURE * up * heightFrac * dtc;
    if (up > 0.6) uprightTime += dtc;

    // ---- milestone: actually stood up. Held, not brushed past: a walker toppling
    // forwards clips full height for one tick on the way over, and paying it the
    // stand bonus for that made the milestone meaningless.
    if (!stood) {
        if (up > 0.80 && clr > 0.93*M.standHipY) standTimer += dtc; else standTimer = 0;
        if (standTimer >= STAND_HOLD) {
            stood = true;
            stoodAt = world.time;
            fitScore += F.STAND_BONUS;
        }
    }

    // ---- stage 2: holding it. Only counts once it has stood, and only while
    // holding still is the job.
    if (stood) {
        if (world.phase == Phase::BALANCE) fitScore += F.UPRIGHT * up * dtc;
        if (!balanced && up > 0.6 && world.time - stoodAt >= BALANCE_HOLD) {
            balanced = true;
            fitScore += F.BALANCE_BONUS;
        }
        if (pendingPush > 0) {
            pendingPush -= dtc;
            if (pendingPush <= 0 && up > 0.6 && pushesSurvived < F.PUSH_CAP) {
                pushesSurvived++;
                fitScore += F.PUSH_BONUS;
            }
        }
    }

    // ---- odometer, for the wander penalty
    {
        const double dx = mb.bp[0] - lastPx, dz = mb.bp[2] - lastPz;
        lastPx = mb.bp[0]; lastPz = mb.bp[2];
        if (stood) pathLen += std::sqrt(dx*dx + dz*dz);
    }

    // ---- stage 3: walking. Only counts once it has proved it can stand still.
    if (world.phase == Phase::WALK && up > 0.4) fitScore += F.ALIVE_WALK * dtc;

    /* Stepping: the rung between standing and walking. A step is a foot that
     * leaves the ground COMPLETELY for at least 80 ms and comes back down
     * somewhere else. "Load went light" is not enough — a walker can unload a foot
     * by leaning, and when that counted, the population learned to rock on the
     * spot and evolution deleted the gait. The pay is mostly for how far forward
     * the foot actually landed. */
    if (world.phase == Phase::WALK && up > 0.6) {
        const Point& wp = world.waypointFor(*this);
        double ux = 1, uz = 0;
        {
            const double dx = wp.x - mb.bp[0], dz = wp.z - mb.bp[2];
            double Ld = std::sqrt(dx*dx + dz*dz);
            if (Ld == 0) Ld = 1;
            ux = dx/Ld; uz = dz/Ld;
        }
        for (int s = 0; s < 2; s++) {
            const bool airborne = (footContact[s] == 0);
            if (airborne) {
                if (!footAirborne[s]) {
                    footAirborne[s] = true;
                    footAir[s] = 0;
                    mb.worldPoint(M.footBody[s], 0, -Seg::ankleH, 0, p3);
                    footOff[s*2] = p3[0];
                    footOff[s*2+1] = p3[2];
                }
                footAir[s] += dtc;
            } else if (footAirborne[s]) {
                footAirborne[s] = false;
                if (footAir[s] >= 0.08) {
                    mb.worldPoint(M.footBody[s], 0, -Seg::ankleH, 0, p3);
                    const double fwd = (p3[0] - footOff[s*2])*ux + (p3[2] - footOff[s*2+1])*uz;
                    steps++;
                    strideSum += std::max(0.0, fwd);
                    if (steps <= F.STEP_CAP) payShape(F.STEP);
                    payShape(F.STRIDE_PER_M * clampd(fwd, 0, F.STRIDE_MAX));
                }
            }
        }
    } else {
        // Outside the gate, forget any swing in progress. Otherwise a walker that
        // stumbles mid-swing, drops below the uprightness threshold and recovers
        // gets its landing credited against a stale take-off point.
        footAirborne[0] = footAirborne[1] = false;
    }

    // Gated on `stood`, not on `balanced`. Gating it on the harder milestone
    // looked tidier but starved 85% of the fleet of any walking signal at all, and
    // a gradient nobody can feel is not a gradient.
    if (stood && world.phase == Phase::WALK) {
        walkTime += dtc;
        const Point& wp = world.waypointFor(*this);
        const double dxw = wp.x - mb.bp[0], dzw = wp.z - mb.bp[2];
        const double d = std::sqrt(dxw*dxw + dzw*dzw);
        if (up > 0.5 && d < bestDist) {
            const double closed = bestDist - d;
            const double align = headingAlign(wp.x, wp.z);
            progressM += closed;
            payProgress(closed, align);
            // Closure-weighted, so it reports how the metres that COUNTED were
            // walked rather than how the walker was facing while stationary.
            // Reported whether or not HEADING_W is on: the control run has to
            // measure the same thing or there is nothing to compare against.
            alignSum += align * closed;
            bestDist = d;
        }
        if (d < world.arriveRadius && up > 0.6) arrive(world, d);
    }

    // ---- fall detection: a sustained collapse
    const bool down = up < 0.35 || clr < 0.40*M.standHipY;
    /* A decaying running maximum of COM height, used to price the fall below. It
     * must decay, or a walker that stood once is charged full rate for every
     * later collapse. 0.6 m/s empties it in ~1.5 s. */
    comPeak = std::max(comHeight(&T), comPeak - 0.6 * dtc);
    fallTimer = down ? fallTimer + dtc : 0;
    if (!downed && fallTimer > 0.15) {
        downed = true;
        falls++;
        downTimer = 0;
        bestComY = comHeight(&T);      // rising is measured from where it landed
        fallSeverity = fallSeverityNow();
        /* Scaled by how high it fell FROM. A dive out of a full stand still costs
         * full price. Toppling back out of a 30 cm partial rise is not a dive,
         * and charging it as one made attempting to stand strictly worse than
         * lying still: one walker lifted its mass 90 cm, earned 713 of ledger,
         * and finished at -643 because the topple cost -982. */
        penalty += F.FALL * fallSeverity * clampd(comPeak / model->standHipY, 0.0, 1.0);
    }
    if (downed) {
        downTimer += dtc;
        /* The reference height has to be taken AFTER the body settles, not at the
         * instant it went down. Measured: every ground pose loses 15-25 cm of
         * centre-of-mass height in the first half second just collapsing onto the
         * floor, so a reference taken at t=0 sits above anything the walker can
         * reach and the rise rung pays exactly zero to everybody. */
        if (!riseRefSet && downTimer > 0.5) {
            bestComY = comHeight(&T);
            riseRefSet = true;
        }
        if (!riseRefSet) { timeLeft -= dtc; return; }
        const double com = comHeight(&T);
        const double room = F.COM_RISE_CAP - riseIncome;
        if (room > 0) {
            /* Two terms, and both are needed. The first is DENSE — paid every tick
             * for how high the mass is right now — so a walker propped on one
             * elbow already outscores one lying flat, and selection has a gradient
             * from the very first generation that meets a floor start. The second
             * is DIRECTIONAL, paid only on beating the best height so far, so the
             * way to earn more is to keep going up rather than to hover. */
            double pay = F.COM_HOLD * clampd(com / M.standHipY, 0, 1) * dtc;
            if (com > bestComY) {
                pay += (com - bestComY) * F.COM_RISE_PER_M;
                bestComY = com;
            }
            pay = std::min(pay, room);
            riseIncome += pay;
            fitScore += pay;
        } else if (com > bestComY) bestComY = com;
        if (up > 0.75 && clr > 0.78*M.standHipY) {
            riseTimer += dtc;
            if (riseTimer > RISE_HOLD) {
                downed = false;
                riseTimer = 0; fallTimer = 0; downTimer = 0;
                if (recoveries < F.RECOVER_CAP) {
                    recoveries++;
                    fitScore += F.RECOVER;
                }
            }
        } else {
            riseTimer = 0;
            // A walker that has been down this long is not getting up, and
            // simulating it lying there is the single largest waste of wall-clock
            // in a generation.
            /* …but a walker that STARTED on the floor has not "been down this
             * long" in the sense meant above: it has been down since tick one,
             * through no failure of its own, with the clock already running before
             * it could act.
             *
             * The world already knows this and slides both phase boundaries by
             * riseGrace for a floor start. This deadline was never told, so a pose
             * start got six seconds to solve the hardest task in the project and
             * was retired with 16 of its 17 seconds unspent. Measured on the
             * gen-1276 champion, EVERY pool pose ended at exactly 6.00 s with the
             * centre of mass near 0.20 m, against a crouch start that ran the full
             * clock and scored 5588 — so about one episode in ten was structurally
             * unwinnable and the rise reward had almost nothing left to pay on. */
            if (downTimer > DOWN_TIMEOUT + world.riseGrace) done = true;
        }
    }
    timeLeft -= dtc;
    if (timeLeft <= 0) { timeLeft = 0; done = true; }
}
