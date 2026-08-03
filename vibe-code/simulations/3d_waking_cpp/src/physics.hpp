/* physics.hpp — reduced-coordinate rigid-body dynamics for a kinematic tree with
 * a floating base. Everything is SI: metres, seconds, kilograms, newtons.
 *
 * Port of physics.js, with one deliberate addition (see x6TransformInertiaBlock
 * below). Conventions are Featherstone, RBDA 2008:
 *   · spatial motion vector = [wx wy wz  vx vy vz]   (angular first)
 *   · spatial force vector  = [nx ny nz  fx fy fz]
 *   · every quantity for body i lives in body i's own frame
 *   · X_i transforms motion parent(i) -> i ; X_i^T transforms force i -> parent(i)
 * World axes: +Y up. The humanoid's own frame is +X forward, +Y up, +Z left.
 *
 * The pipeline each tick:
 *   fk()        forward kinematics + spatial velocities
 *   (caller fills fext with contact / wind forces)
 *   dynamics()  ABA — articulated inertia inward, 6x6 base solve, accel outward
 *   integrate() semi-implicit Euler, quaternion for the base
 */
#pragma once
#include <cmath>
#include <cstring>
#include <vector>
#include <algorithm>

constexpr double GRAVITY = 9.81;

/* ------------------------------------------------------------ 3x3 utilities */
/* Row-major 3x3 in a 9-array. */
inline void m3RotAxis(int axis, double th, double* o) {
    const double c = std::cos(th), s = std::sin(th);
    if (axis == 0) { o[0]=1; o[1]=0; o[2]=0; o[3]=0; o[4]=c; o[5]=-s; o[6]=0; o[7]=s; o[8]=c; }
    else if (axis == 1) { o[0]=c; o[1]=0; o[2]=s; o[3]=0; o[4]=1; o[5]=0; o[6]=-s; o[7]=0; o[8]=c; }
    else { o[0]=c; o[1]=-s; o[2]=0; o[3]=s; o[4]=c; o[5]=0; o[6]=0; o[7]=0; o[8]=1; }
}
/* o = a·b for row-major 3x3 (o must not alias a or b) */
inline void m3Mul(const double* a, const double* b, double* o) {
    for (int i = 0; i < 3; i++) {
        const double a0 = a[i*3], a1 = a[i*3+1], a2 = a[i*3+2];
        o[i*3]   = a0*b[0] + a1*b[3] + a2*b[6];
        o[i*3+1] = a0*b[1] + a1*b[4] + a2*b[7];
        o[i*3+2] = a0*b[2] + a1*b[5] + a2*b[8];
    }
}
inline void quatToM3(const double* q, double* o) {
    const double w = q[0], x = q[1], y = q[2], z = q[3];
    const double xx = x*x, yy = y*y, zz = z*z;
    o[0] = 1 - 2*(yy+zz); o[1] = 2*(x*y - w*z); o[2] = 2*(x*z + w*y);
    o[3] = 2*(x*y + w*z); o[4] = 1 - 2*(xx+zz); o[5] = 2*(y*z - w*x);
    o[6] = 2*(x*z - w*y); o[7] = 2*(y*z + w*x); o[8] = 1 - 2*(xx+yy);
}

/* --------------------------------------------------------- 6x6 spatial maths */
/* X = [ E, 0 ; -E·S(r), E ] — motion transform parent -> child. */
inline void x6Build(const double* E, double* X, double rx, double ry, double rz) {
    const double e0=E[0], e1=E[1], e2=E[2], e3=E[3], e4=E[4], e5=E[5], e6=E[6], e7=E[7], e8=E[8];
    const double a = -(e1*rz - e2*ry), b = -(e2*rx - e0*rz), c = -(e0*ry - e1*rx);
    const double d = -(e4*rz - e5*ry), e = -(e5*rx - e3*rz), f = -(e3*ry - e4*rx);
    const double g = -(e7*rz - e8*ry), h = -(e8*rx - e6*rz), i = -(e6*ry - e7*rx);
    X[0]=e0;  X[1]=e1;  X[2]=e2;  X[3]=0;   X[4]=0;   X[5]=0;
    X[6]=e3;  X[7]=e4;  X[8]=e5;  X[9]=0;   X[10]=0;  X[11]=0;
    X[12]=e6; X[13]=e7; X[14]=e8; X[15]=0;  X[16]=0;  X[17]=0;
    X[18]=a;  X[19]=b;  X[20]=c;  X[21]=e0; X[22]=e1; X[23]=e2;
    X[24]=d;  X[25]=e;  X[26]=f;  X[27]=e3; X[28]=e4; X[29]=e5;
    X[30]=g;  X[31]=h;  X[32]=i;  X[33]=e6; X[34]=e7; X[35]=e8;
}
/* out = X · v */
inline void x6Vec(const double* X, const double* v, double* out) {
    for (int i = 0; i < 6; i++) {
        const double* b = X + i*6;
        out[i] = b[0]*v[0] + b[1]*v[1] + b[2]*v[2] + b[3]*v[3] + b[4]*v[4] + b[5]*v[5];
    }
}
/* out = X^T · v */
inline void x6TVec(const double* X, const double* v, double* out) {
    for (int j = 0; j < 6; j++) out[j] = 0;
    for (int i = 0; i < 6; i++) {
        const double vi = v[i];
        if (vi == 0) continue;
        const double* b = X + i*6;
        for (int j = 0; j < 6; j++) out[j] += b[j] * vi;
    }
}
inline void m6Vec(const double* A, const double* v, double* out) { x6Vec(A, v, out); }

/* OUT = X^T·I·X, the composite-inertia transform — literal port of the JS, kept
 * as the REFERENCE the block form below is checked against. It already skips
 * zeros, which is why it is not simply a triple loop. */
inline void x6TransformInertiaDense(const double* X, const double* I, double* OUT) {
    double T[36];
    for (int i = 0; i < 36; i++) T[i] = 0;
    for (int i = 0; i < 6; i++) {
        const int ir = i*6, tr = i*6;
        for (int k = 0; k < 6; k++) {
            const double a = I[ir + k];
            if (a == 0) continue;
            const double* xr = X + k*6;
            T[tr]   += a*xr[0]; T[tr+1] += a*xr[1]; T[tr+2] += a*xr[2];
            T[tr+3] += a*xr[3]; T[tr+4] += a*xr[4]; T[tr+5] += a*xr[5];
        }
    }
    for (int i = 0; i < 36; i++) OUT[i] = 0;
    for (int k = 0; k < 6; k++) {
        const double* xr = X + k*6;
        const double* tr = T + k*6;
        for (int i = 0; i < 6; i++) {
            const double a = xr[i];
            if (a == 0) continue;
            double* orow = OUT + i*6;
            orow[0] += a*tr[0]; orow[1] += a*tr[1]; orow[2] += a*tr[2];
            orow[3] += a*tr[3]; orow[4] += a*tr[4]; orow[5] += a*tr[5];
        }
    }
}

/* ---------------------------------------------------- the structured version
 *
 * X^T·I·X was measured at 27.1% of all runtime after ABA landed — the single
 * hottest thing in the simulator by a wide margin. The dense form above already
 * skips zeros, but it still treats the operands as arbitrary 6x6 matrices, and
 * they are nothing of the sort. Written in 3x3 blocks:
 *
 *     X = [ E   0 ]        I = [ A   B ]
 *         [ F   E ]            [ C   D ]        with  F = -E·S(r)
 *
 * and the product falls out in closed form. Writing Ã_M for the congruence
 * E^T·M·E, and using only (E^T M E)^T = E^T M^T E — no symmetry assumed of A, B,
 * C, D anywhere, because the articulated-body inertia accumulates rounding and
 * is only symmetric to within it:
 *
 *     D' = Ã_D
 *     C' = Ã_C - Ã_D·S(r)
 *     B' = Ã_B + S(r)·Ã_D
 *     A' = Ã_A - Ã_B·S(r) + S(r)·Ã_C - S(r)·Ã_D·S(r)
 *
 * Two further facts do the real work. First, multiplying by S(r) is 18 multiplies,
 * not 27, because S(r) is a skew matrix with three zeros on the diagonal. Second
 * and much larger: E is a rotation about ONE COORDINATE AXIS for every joint in
 * the body (only the floating base carries a general rotation), so the congruence
 * touches two rows and two columns and leaves the third alone — 24 multiplies
 * instead of 54.
 *
 * And nine of the twenty-two joints have r = 0 exactly: the torso, both upper
 * arms, both hip-roll carriers, both thighs and both feet all sit at their
 * parent's origin. There F vanishes and the whole transform is three congruences.
 *
 * ~432 multiplies becomes ~144, or ~72 when r = 0. Verified against
 * x6TransformInertiaDense to machine precision over random states — see verify.cpp,
 * which is the only reason to believe any of the above.
 */
/* G = E^T·M·E for a general 3x3 E. */
inline void congruenceGeneral(const double* E, const double* M, double* G) {
    double T[9];
    // T = E^T·M
    for (int i = 0; i < 3; i++)
        for (int j = 0; j < 3; j++)
            T[i*3+j] = E[i]*M[j] + E[3+i]*M[3+j] + E[6+i]*M[6+j];
    // G = T·E
    for (int i = 0; i < 3; i++)
        for (int j = 0; j < 3; j++)
            G[i*3+j] = T[i*3]*E[j] + T[i*3+1]*E[3+j] + T[i*3+2]*E[6+j];
}
/* G = E^T·M·E where E is the transpose of a rotation about coordinate axis `k`,
 * i.e. E[a][a]=c, E[a][b]=s, E[b][a]=-s, E[b][b]=c, E[k][k]=1 with
 * a=(k+1)%3, b=(k+2)%3 — the pattern m3RotAxis + the transpose in fk() produce
 * for all three axes. */
inline void congruenceAxis(int k, double c, double s, const double* M, double* G) {
    const int a = (k + 1) % 3, b = (k + 2) % 3;
    double T[9];
    // T = E^T·M : E^T has [a][a]=c, [a][b]=-s, [b][a]=s, [b][b]=c, [k][k]=1
    for (int j = 0; j < 3; j++) {
        const double ma = M[a*3+j], mb = M[b*3+j];
        T[a*3+j] = c*ma - s*mb;
        T[b*3+j] = s*ma + c*mb;
        T[k*3+j] = M[k*3+j];
    }
    // G = T·E : column a is c·(·,a) - s·(·,b); column b is s·(·,a) + c·(·,b)
    for (int i = 0; i < 3; i++) {
        const double ta = T[i*3+a], tb = T[i*3+b];
        G[i*3+a] = c*ta - s*tb;
        G[i*3+b] = s*ta + c*tb;
        G[i*3+k] = T[i*3+k];
    }
}
/* O = M·S(r) — 18 multiplies. S(r) = [[0,-rz,ry],[rz,0,-rx],[-ry,rx,0]]. */
inline void mulRightSkew(const double* M, double rx, double ry, double rz, double* O) {
    for (int i = 0; i < 3; i++) {
        const double m0 = M[i*3], m1 = M[i*3+1], m2 = M[i*3+2];
        O[i*3]   =  m1*rz - m2*ry;
        O[i*3+1] = -m0*rz + m2*rx;
        O[i*3+2] =  m0*ry - m1*rx;
    }
}
/* O = S(r)·M — 18 multiplies. */
inline void mulLeftSkew(double rx, double ry, double rz, const double* M, double* O) {
    for (int j = 0; j < 3; j++) {
        const double m0 = M[j], m1 = M[3+j], m2 = M[6+j];
        O[j]   = -rz*m1 + ry*m2;
        O[3+j] =  rz*m0 - rx*m2;
        O[6+j] = -ry*m0 + rx*m1;
    }
}

/* Everything the transform needs about a joint's frame, cached once per fk()
 * rather than recovered from the assembled 6x6 each time it is used. */
struct JointFrame {
    int axis = -1;          // -1 = general rotation (the floating base)
    double c = 1, s = 0;
    double E[9];            // the general form, always filled
    double rx = 0, ry = 0, rz = 0;
    bool zeroR = true;
};

inline void x6TransformInertiaBlock(const JointFrame& jf, const double* I, double* OUT) {
    // unpack the four 3x3 blocks
    double A[9], B[9], C[9], D[9];
    for (int i = 0; i < 3; i++)
        for (int j = 0; j < 3; j++) {
            A[i*3+j] = I[i*6 + j];
            B[i*3+j] = I[i*6 + 3 + j];
            C[i*3+j] = I[(i+3)*6 + j];
            D[i*3+j] = I[(i+3)*6 + 3 + j];
        }
    double gA[9], gB[9], gC[9], gD[9];
    if (jf.axis >= 0) {
        congruenceAxis(jf.axis, jf.c, jf.s, A, gA);
        congruenceAxis(jf.axis, jf.c, jf.s, B, gB);
        congruenceAxis(jf.axis, jf.c, jf.s, C, gC);
        congruenceAxis(jf.axis, jf.c, jf.s, D, gD);
    } else {
        congruenceGeneral(jf.E, A, gA);
        congruenceGeneral(jf.E, B, gB);
        congruenceGeneral(jf.E, C, gC);
        congruenceGeneral(jf.E, D, gD);
    }
    double oA[9], oB[9], oC[9];
    if (jf.zeroR) {
        std::memcpy(oA, gA, sizeof oA);
        std::memcpy(oB, gB, sizeof oB);
        std::memcpy(oC, gC, sizeof oC);
    } else {
        const double rx = jf.rx, ry = jf.ry, rz = jf.rz;
        double BS[9], SC[9], SD[9], SDS[9];
        mulRightSkew(gB, rx, ry, rz, BS);     // Ã_B·S(r)
        mulLeftSkew(rx, ry, rz, gC, SC);      // S(r)·Ã_C
        mulLeftSkew(rx, ry, rz, gD, SD);      // S(r)·Ã_D          (reused below)
        mulRightSkew(SD, rx, ry, rz, SDS);    // S(r)·Ã_D·S(r)
        double DS[9];
        mulRightSkew(gD, rx, ry, rz, DS);     // Ã_D·S(r)
        for (int i = 0; i < 9; i++) {
            oA[i] = gA[i] - BS[i] + SC[i] - SDS[i];
            oB[i] = gB[i] + SD[i];
            oC[i] = gC[i] - DS[i];
        }
    }
    for (int i = 0; i < 3; i++)
        for (int j = 0; j < 3; j++) {
            OUT[i*6 + j]         = oA[i*3+j];
            OUT[i*6 + 3 + j]     = oB[i*3+j];
            OUT[(i+3)*6 + j]     = oC[i*3+j];
            OUT[(i+3)*6 + 3 + j] = gD[i*3+j];
        }
}

/* Spatial cross products. crm: motion x motion. crf: motion x* force. */
inline void crm(const double* v, const double* m, double* out) {
    const double wx=v[0], wy=v[1], wz=v[2], lx=v[3], ly=v[4], lz=v[5];
    const double ax=m[0], ay=m[1], az=m[2], bx=m[3], by=m[4], bz=m[5];
    out[0] = wy*az - wz*ay;
    out[1] = wz*ax - wx*az;
    out[2] = wx*ay - wy*ax;
    out[3] = wy*bz - wz*by + ly*az - lz*ay;
    out[4] = wz*bx - wx*bz + lz*ax - lx*az;
    out[5] = wx*by - wy*bx + lx*ay - ly*ax;
}
inline void crf(const double* v, const double* f, double* out) {
    const double wx=v[0], wy=v[1], wz=v[2], lx=v[3], ly=v[4], lz=v[5];
    const double nx=f[0], ny=f[1], nz=f[2], fx=f[3], fy=f[4], fz=f[5];
    out[0] = wy*nz - wz*ny + ly*fz - lz*fy;
    out[1] = wz*nx - wx*nz + lz*fx - lx*fz;
    out[2] = wx*ny - wy*nx + lx*fy - ly*fx;
    out[3] = wy*fz - wz*fy;
    out[4] = wz*fx - wx*fz;
    out[5] = wx*fy - wy*fx;
}

/* -------------------------------------------------------------- LDL^T solver */
inline void ldlFactor(double* H, int n) {
    for (int j = 0; j < n; j++) {
        double d = H[j*n + j];
        for (int k = 0; k < j; k++) d -= H[j*n+k] * H[j*n+k] * H[k*n+k];
        if (d < 1e-12) d = 1e-12;                 // ridge: keeps a degenerate model solvable
        H[j*n + j] = d;
        for (int i = j + 1; i < n; i++) {
            double s = H[i*n + j];
            for (int k = 0; k < j; k++) s -= H[i*n+k] * H[j*n+k] * H[k*n+k];
            H[i*n + j] = s / d;
        }
    }
}
inline void ldlSolve(const double* H, int n, double* b) {
    for (int i = 0; i < n; i++) { double s = b[i]; for (int k = 0; k < i; k++) s -= H[i*n+k]*b[k]; b[i] = s; }
    for (int i = 0; i < n; i++) b[i] /= H[i*n + i];
    for (int i = n-1; i >= 0; i--) { double s = b[i]; for (int k = i+1; k < n; k++) s -= H[k*n+i]*b[k]; b[i] = s; }
}

/* ================================================================ MultiBody */
struct BodyDef {
    std::string name;
    int parent = -1;            // -1 for the floating base
    int axis = 0;               // 0|1|2, ignored for the base
    double r[3] = {0,0,0};      // joint origin in the parent's frame
    double mass = 0;
    double com[3] = {0,0,0};
    double inertia[3] = {0,0,0};
    double armature = 0;
    double qmin = -1e300, qmax = 1e300;
    double kp = 0, kd = 0, tauMax = 0;
    double nominal = 0, crouch = 0;
};

struct Model;   // forward; defined in body.hpp

class MultiBody {
public:
    int nb = 0, nj = 0, nv = 0;
    const std::vector<BodyDef>* bodies = nullptr;

    std::vector<int> parent, axis;
    std::vector<double> tr, I, armature, qmin, qmax;

    // ---- state ----
    std::vector<double> q, qd;
    double bp[3] = {0,0,0};
    double bq[4] = {1,0,0,0};

    // ---- workspace (allocation-free hot loop) ----
    std::vector<double> E, X, R, P, V, A, F, fext, qdd, tau;
    std::vector<JointFrame> jf;
    std::vector<double> IA, pA, cv, U, dv, uv;
    bool blown = false;

    /* Whether the block-structured inertia transform is used. Env-switchable so a
     * bisect or a test can pin the dense reference without editing code, exactly
     * like WALK3D_ABA=0 does in the JS. */
    static bool& useBlock() { static bool v = true; return v; }

    void build(const std::vector<BodyDef>& bs) {
        bodies = &bs;
        nb = (int)bs.size();
        nj = nb - 1;
        nv = 6 + nj;
        parent.resize(nb); axis.resize(nb); tr.assign(nb*3, 0.0);
        I.assign((size_t)nb*36, 0.0); armature.assign(nb, 0.0);
        qmin.resize(nb); qmax.resize(nb);
        for (int i = 0; i < nb; i++) {
            const BodyDef& b = bs[i];
            parent[i] = b.parent;
            axis[i] = b.axis;
            tr[i*3] = b.r[0]; tr[i*3+1] = b.r[1]; tr[i*3+2] = b.r[2];
            armature[i] = b.armature;
            qmin[i] = b.qmin; qmax[i] = b.qmax;
            buildInertia(i, b);
        }
        q.assign(nb, 0.0); qd.assign(nv, 0.0);
        E.assign((size_t)nb*9, 0.0); X.assign((size_t)nb*36, 0.0);
        R.assign((size_t)nb*9, 0.0); P.assign((size_t)nb*3, 0.0);
        V.assign((size_t)nb*6, 0.0); A.assign((size_t)nb*6, 0.0);
        F.assign((size_t)nb*6, 0.0); fext.assign((size_t)nb*6, 0.0);
        qdd.assign(nv, 0.0); tau.assign(nb, 0.0);
        jf.assign(nb, JointFrame());
        IA.assign((size_t)nb*36, 0.0); pA.assign((size_t)nb*6, 0.0);
        cv.assign((size_t)nb*6, 0.0); U.assign((size_t)nb*6, 0.0);
        dv.assign(nb, 0.0); uv.assign(nb, 0.0);
        bp[0]=bp[1]=bp[2]=0; bq[0]=1; bq[1]=bq[2]=bq[3]=0;
        blown = false;
    }

    void buildInertia(int i, const BodyDef& b) {
        const double m = b.mass;
        const double cx = b.com[0], cy = b.com[1], cz = b.com[2];
        const double ix = b.inertia[0], iy = b.inertia[1], iz = b.inertia[2];
        double* o = &I[(size_t)i*36];
        for (int k = 0; k < 36; k++) o[k] = 0;
        // Ibar = Ic + m·S(c)·S(c)^T  (parallel axis)
        const double Ibar[9] = {
            ix + m*(cy*cy + cz*cz), -m*cx*cy, -m*cx*cz,
            -m*cx*cy, iy + m*(cx*cx + cz*cz), -m*cy*cz,
            -m*cx*cz, -m*cy*cz, iz + m*(cx*cx + cy*cy)
        };
        const double mS[9] = { 0, -m*cz, m*cy,  m*cz, 0, -m*cx,  -m*cy, m*cx, 0 };
        for (int r = 0; r < 3; r++) for (int c = 0; c < 3; c++) {
            o[r*6 + c]         = Ibar[r*3 + c];
            o[r*6 + 3 + c]     = mS[r*3 + c];
            o[(r+3)*6 + c]     = mS[c*3 + r];            // the (m·S(c))^T block
            o[(r+3)*6 + 3 + c] = (r == c) ? m : 0;
        }
    }

    /* Forward kinematics + spatial velocity propagation. Must run before contacts
     * are gathered (they need world points) and before dynamics(). */
    void fk() {
        double rot[9];
        quatToM3(bq, R.data());
        double* E0 = E.data();
        E0[0]=R[0]; E0[1]=R[3]; E0[2]=R[6];
        E0[3]=R[1]; E0[4]=R[4]; E0[5]=R[7];
        E0[6]=R[2]; E0[7]=R[5]; E0[8]=R[8];
        P[0]=bp[0]; P[1]=bp[1]; P[2]=bp[2];
        x6Build(E0, X.data(), bp[0], bp[1], bp[2]);
        {   // the base carries a general rotation, so the transform falls back to it
            JointFrame& f0 = jf[0];
            f0.axis = -1;
            std::memcpy(f0.E, E0, sizeof f0.E);
            f0.rx = bp[0]; f0.ry = bp[1]; f0.rz = bp[2];
            f0.zeroR = (bp[0] == 0 && bp[1] == 0 && bp[2] == 0);
        }
        for (int k = 0; k < 6; k++) V[k] = qd[k];

        for (int i = 1; i < nb; i++) {
            const int p = parent[i], ax = axis[i];
            const double th = q[i];
            const double c = std::cos(th), s = std::sin(th);
            m3RotAxis(ax, th, rot);
            double* Ei = &E[(size_t)i*9];
            Ei[0]=rot[0]; Ei[1]=rot[3]; Ei[2]=rot[6];
            Ei[3]=rot[1]; Ei[4]=rot[4]; Ei[5]=rot[7];
            Ei[6]=rot[2]; Ei[7]=rot[5]; Ei[8]=rot[8];
            const double rx = tr[i*3], ry = tr[i*3+1], rz = tr[i*3+2];
            x6Build(Ei, &X[(size_t)i*36], rx, ry, rz);
            JointFrame& f = jf[i];
            f.axis = ax; f.c = c; f.s = s;
            std::memcpy(f.E, Ei, sizeof f.E);
            f.rx = rx; f.ry = ry; f.rz = rz;
            f.zeroR = (rx == 0 && ry == 0 && rz == 0);
            // world pose
            m3Mul(&R[(size_t)p*9], rot, &R[(size_t)i*9]);
            const double* Rp = &R[(size_t)p*9];
            const int po = p*3;
            P[i*3]   = P[po]   + Rp[0]*rx + Rp[1]*ry + Rp[2]*rz;
            P[i*3+1] = P[po+1] + Rp[3]*rx + Rp[4]*ry + Rp[5]*rz;
            P[i*3+2] = P[po+2] + Rp[6]*rx + Rp[7]*ry + Rp[8]*rz;
            // velocity: v_i = X_i·v_parent + S_i·qd_i
            x6Vec(&X[(size_t)i*36], &V[(size_t)p*6], &V[(size_t)i*6]);
            V[(size_t)i*6 + ax] += qd[5 + i];
        }
    }

    inline void worldPoint(int i, double lx, double ly, double lz, double* out) const {
        const double* Ri = &R[(size_t)i*9];
        const double* Pi = &P[(size_t)i*3];
        out[0] = Pi[0] + Ri[0]*lx + Ri[1]*ly + Ri[2]*lz;
        out[1] = Pi[1] + Ri[3]*lx + Ri[4]*ly + Ri[5]*lz;
        out[2] = Pi[2] + Ri[6]*lx + Ri[7]*ly + Ri[8]*lz;
    }

    inline void worldPointVel(int i, double lx, double ly, double lz, double* out) const {
        const double* v = &V[(size_t)i*6];
        const double wx = v[0], wy = v[1], wz = v[2];
        const double bx = v[3] + wy*lz - wz*ly;
        const double by = v[4] + wz*lx - wx*lz;
        const double bz = v[5] + wx*ly - wy*lx;
        const double* Ri = &R[(size_t)i*9];
        out[0] = Ri[0]*bx + Ri[1]*by + Ri[2]*bz;
        out[1] = Ri[3]*bx + Ri[4]*by + Ri[5]*bz;
        out[2] = Ri[6]*bx + Ri[7]*by + Ri[8]*bz;
    }

    /* Apply a world-frame force at a world point on body i (accumulates in fext). */
    inline void addWorldForce(int i, double wx, double wy, double wz, double fx, double fy, double fz) {
        const double* Ri = &R[(size_t)i*9];
        const double* Pi = &P[(size_t)i*3];
        double* fe = &fext[(size_t)i*6];
        const double dx = wx - Pi[0], dy = wy - Pi[1], dz = wz - Pi[2];
        const double lx = Ri[0]*dx + Ri[3]*dy + Ri[6]*dz;
        const double ly = Ri[1]*dx + Ri[4]*dy + Ri[7]*dz;
        const double lz = Ri[2]*dx + Ri[5]*dy + Ri[8]*dz;
        const double bx = Ri[0]*fx + Ri[3]*fy + Ri[6]*fz;
        const double by = Ri[1]*fx + Ri[4]*fy + Ri[7]*fz;
        const double bz = Ri[2]*fx + Ri[5]*fy + Ri[8]*fz;
        fe[0] += ly*bz - lz*by;
        fe[1] += lz*bx - lx*bz;
        fe[2] += lx*by - ly*bx;
        fe[3] += bx; fe[4] += by; fe[5] += bz;
    }

    inline void clearForces() { std::fill(fext.begin(), fext.end(), 0.0); }

    /* ------------------------------------------------------------------- ABA
     * Featherstone's Articulated Body Algorithm: forward dynamics in O(n),
     * without ever forming or factorising the joint-space mass matrix.
     *
     * GRAVITY. The textbook CRBA path fakes gravity by giving the base a
     * fictitious acceleration of -a_g. That trick needs a KNOWN base acceleration,
     * which a floating base does not have. So this works in a' = a - a_g, the
     * acceleration relative to free fall: gravity disappears from the force
     * balance entirely (the I·a_g term cancels the weight), a' propagates exactly
     * as a does because a_g is a uniform field with X_i·a_g,p = a_g,i, and the
     * only place gravity reappears is the last line, where the true base
     * acceleration is recovered. Joint accelerations are identical under either
     * variable. */
    void dynamics(const double* jointTau) {
        double t6[6], u6[6], acc[36], acc2[36];
        const bool blk = useBlock();

        // ---- pass 1: bias forces and velocity-product accelerations
        std::memcpy(IA.data(), I.data(), sizeof(double) * (size_t)nb * 36);
        for (int i = 0; i < nb; i++) {
            const int o = i*6;
            m6Vec(&I[(size_t)i*36], &V[o], t6);              // I·v
            crf(&V[o], t6, u6);                              // v x* (I·v)
            for (int k = 0; k < 6; k++) pA[o+k] = u6[k] - fext[o+k];
            if (i == 0) { for (int k = 0; k < 6; k++) cv[k] = 0; continue; }
            for (int k = 0; k < 6; k++) t6[k] = 0;
            t6[axis[i]] = qd[5 + i];
            crm(&V[o], t6, &cv[o]);                          // c_i = v_i x (S_i·qd_i)
        }

        // ---- pass 2: articulated inertia and bias, inward
        for (int i = nb - 1; i >= 1; i--) {
            const int p = parent[i], ax = axis[i], o = i*6;
            const size_t io = (size_t)i*36;
            for (int k = 0; k < 6; k++) U[o+k] = IA[io + (size_t)k*6 + ax];
            double di = U[o + ax] + armature[i];
            if (!(di > 1e-12)) di = 1e-12;                    // same ridge the LDL path uses
            dv[i] = di;
            uv[i] = jointTau[i] - pA[o + ax];

            const double inv = 1.0 / di;
            for (int r = 0; r < 6; r++) {
                const double ur = U[o + r] * inv;
                for (int c = 0; c < 6; c++) acc[r*6 + c] = IA[io + (size_t)r*6 + c] - ur * U[o + c];
            }
            // pa = pA + Ia·c + U·(u/d)
            m6Vec(acc, &cv[o], t6);
            const double uk = uv[i] * inv;
            for (int k = 0; k < 6; k++) t6[k] += pA[o+k] + U[o+k] * uk;

            // fold into the parent: IA_p += X^T·Ia·X,  pA_p += X^T·pa
            if (blk) x6TransformInertiaBlock(jf[i], acc, acc2);
            else     x6TransformInertiaDense(&X[(size_t)i*36], acc, acc2);
            double* IAp = &IA[(size_t)p*36];
            for (int k = 0; k < 36; k++) IAp[k] += acc2[k];
            x6TVec(&X[(size_t)i*36], t6, u6);
            double* pAp = &pA[(size_t)p*6];
            for (int k = 0; k < 6; k++) pAp[k] += u6[k];
        }

        // ---- base: IA_0·a'_0 = -pA_0, a 6x6 solve instead of a 28x28 one
        double H6[36], r6[6];
        for (int k = 0; k < 36; k++) H6[k] = IA[k];
        for (int k = 0; k < 6; k++) r6[k] = -pA[k];
        ldlFactor(H6, 6);
        ldlSolve(H6, 6, r6);
        for (int k = 0; k < 6; k++) A[k] = r6[k];

        // ---- pass 3: accelerations outward
        for (int i = 1; i < nb; i++) {
            const int p = parent[i], ax = axis[i], o = i*6;
            x6Vec(&X[(size_t)i*36], &A[(size_t)p*6], t6);     // X_i·a'_parent
            for (int k = 0; k < 6; k++) t6[k] += cv[o+k];
            double s = 0;
            for (int k = 0; k < 6; k++) s += U[o+k] * t6[k];
            const double qddi = (uv[i] - s) / dv[i];
            qdd[5 + i] = qddi;
            for (int k = 0; k < 6; k++) A[o+k] = t6[k];
            A[o + ax] += qddi;
        }

        /* Back to true acceleration: a_0 = a'_0 + a_g, with gravity in the base
         * frame. E0·(0,+g,0) is the FICTITIOUS acceleration -a_g, so the field
         * itself is the negative of that. */
        qdd[0] = A[0]; qdd[1] = A[1]; qdd[2] = A[2];
        qdd[3] = A[3] - E[1] * GRAVITY;
        qdd[4] = A[4] - E[4] * GRAVITY;
        qdd[5] = A[5] - E[7] * GRAVITY;

        for (int k = 0; k < nv; k++) {
            double a = qdd[k];
            if (!std::isfinite(a)) { a = 0; blown = true; }
            else if (a > 4000) a = 4000;
            else if (a < -4000) a = -4000;
            qdd[k] = a;
        }
    }

    /* Semi-implicit Euler; the base orientation goes through a quaternion. */
    void integrate(double dt) {
        for (int k = 0; k < nv; k++) qd[k] += qdd[k] * dt;
        const double* R0 = R.data();
        bp[0] += (R0[0]*qd[3] + R0[1]*qd[4] + R0[2]*qd[5]) * dt;
        bp[1] += (R0[3]*qd[3] + R0[4]*qd[4] + R0[5]*qd[5]) * dt;
        bp[2] += (R0[6]*qd[3] + R0[7]*qd[4] + R0[8]*qd[5]) * dt;
        // base orientation: q <- q (x) exp(1/2·w·dt), body-frame w
        const double hx = qd[0]*dt*0.5, hy = qd[1]*dt*0.5, hz = qd[2]*dt*0.5;
        const double th2 = hx*hx + hy*hy + hz*hz;
        const double cw = 1 - th2*0.5, sc = 1 - th2/6;   // 2nd-order exp, cheap and stable
        const double dw = cw, dx = hx*sc, dy = hy*sc, dz = hz*sc;
        const double w = bq[0], x = bq[1], y = bq[2], z = bq[3];
        const double nw = w*dw - x*dx - y*dy - z*dz;
        const double nx = w*dx + x*dw + y*dz - z*dy;
        const double ny = w*dy - x*dz + y*dw + z*dx;
        const double nz = w*dz + x*dy - y*dx + z*dw;
        double len = std::sqrt(nw*nw + nx*nx + ny*ny + nz*nz);
        if (len == 0) len = 1;
        bq[0] = nw/len; bq[1] = nx/len; bq[2] = ny/len; bq[3] = nz/len;
        // joints, with a hard backstop just past the soft limit
        for (int i = 1; i < nb; i++) {
            double a = q[i] + qd[5+i]*dt;
            /* A LAST-RESORT NUMERICAL NET, not the joint limit — the limit
             * itself is now a torque in _servos, which goes through the solve
             * and conserves momentum. At the old 0.02 this fired on 21-34% of
             * ticks; at 0.15 it fires on 0.00% and exists only so a genuinely
             * broken state cannot walk a joint to infinity. */
            const double lo = qmin[i] - 0.15, hi = qmax[i] + 0.15;
            if (a < lo) { a = lo; if (qd[5+i] < 0) qd[5+i] = 0; }
            else if (a > hi) { a = hi; if (qd[5+i] > 0) qd[5+i] = 0; }
            q[i] = a;
        }
        if (!std::isfinite(bp[0] + bp[1] + bp[2])) blown = true;
    }

    /* Mechanical energy — the cheapest honest check that the maths is right. */
    double energy() const {
        double ke = 0, pe = 0, t[6], p3[3];
        for (int i = 1; i < nb; i++) ke += 0.5 * armature[i] * qd[5+i] * qd[5+i];
        for (int i = 0; i < nb; i++) {
            const int o = i*6;
            m6Vec(&I[(size_t)i*36], &V[o], t);
            double s = 0;
            for (int k = 0; k < 6; k++) s += V[o+k] * t[k];
            ke += 0.5 * s;
            const BodyDef& b = (*bodies)[i];
            if (b.mass) {
                worldPoint(i, b.com[0], b.com[1], b.com[2], p3);
                pe += b.mass * GRAVITY * p3[1];
            }
        }
        return ke + pe;
    }
};
