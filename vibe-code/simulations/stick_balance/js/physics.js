/**
 * Physics engine using standard CartPole dynamics (like OpenAI Gym).
 * Angle θ = 0 is perfectly upright.
 */
class Physics {
    constructor() {
        // Core params
        this.gravity = 9.8;
        this.timestep = 0.016;            // 60 Hz
        this.worldWidth = 10.0;

        // Cart-pole params
        this.massCart = 1.0;
        this.massPole = 0.1;              // light pole helps early learning
        this.totalMass = this.massCart + this.massPole;

        this.stickLength = 2.0;           // meters (visual)
        this.halfLength = this.stickLength / 2; // Gym's "length" parameter

        this.platformWidth = 1.0;
        this.wheelRadius = 0.2;
        this.maxForce = 20.0;

        // Failure angle (radians) - increased from 15° to 20° for more forgiving training
        this.failAngleRad = 20 * Math.PI / 180; // 20°
    }

    /**
     * Standard CartPole update
     * F = action * maxForce (+ wind treated as extra cart force)
     */
    update(state, action, windForce) {
        // sanitize
        const s = {
            platformPos: isFinite(state.platformPos) ? state.platformPos : 0,
            platformVel: isFinite(state.platformVel) ? state.platformVel : 0,
            stickAngle:  isFinite(state.stickAngle)  ? state.stickAngle  : 0,
            stickAngularVel: isFinite(state.stickAngularVel) ? state.stickAngularVel : 0,
            wheelRotation: isFinite(state.wheelRotation) ? state.wheelRotation : 0
        };

        const dt = this.timestep;

        // Force
        let force = (isFinite(action) ? action : 0) * this.maxForce;
        if (isFinite(windForce)) {
            // treat wind as extra horizontal force on cart (simple but effective)
            force += windForce;
        }

        const x = s.platformPos;
        const xdot = s.platformVel;
        const theta = s.stickAngle;
        const thetadot = s.stickAngularVel;

        const costheta = Math.cos(theta);
        const sintheta = Math.sin(theta);

        // From Gym's cartpole:
        const temp = (force + this.massPole * this.halfLength * thetadot * thetadot * sintheta) / this.totalMass;
        const thetaAcc = (this.gravity * sintheta - costheta * temp) /
            (this.halfLength * (4.0 / 3.0 - (this.massPole * costheta * costheta) / this.totalMass));
        const xAcc = temp - (this.massPole * this.halfLength * thetaAcc * costheta) / this.totalMass;

        // Lightweight damping (helps training stability)
        const cartFriction = 0.01;
        const poleDamping = 0.002;
        const xAccDamped = xAcc - cartFriction * xdot;
        const thetaAccDamped = thetaAcc - poleDamping * thetadot;

        // Integrate (Euler)
        const x_new = x + dt * xdot;
        const xdot_new = xdot + dt * xAccDamped;
        const theta_new = theta + dt * thetadot;
        const thetadot_new = thetadot + dt * thetaAccDamped;

        // Wheel rotation (for visuals)
        let wheelRot = s.wheelRotation + (xdot_new / this.wheelRadius) * dt;
        wheelRot %= (2 * Math.PI);

        // Bounds on cart position
        let x_bounded = x_new;
        let xdot_bounded = xdot_new;
        if (x_bounded < -this.worldWidth / 2) {
            x_bounded = -this.worldWidth / 2;
            xdot_bounded = 0;
        } else if (x_bounded > this.worldWidth / 2) {
            x_bounded = this.worldWidth / 2;
            xdot_bounded = 0;
        }

        const out = {
            platformPos: x_bounded,
            platformVel: xdot_bounded,
            stickAngle: this._wrapPi(theta_new),
            stickAngularVel: thetadot_new,
            wheelRotation: wheelRot
        };

        if (!Object.values(out).every(isFinite)) {
            // Safety reset to tiny angle
            return this.createInitialState(2);
        }
        return out;
    }

    hasStickFallen(state) {
        return Math.abs(state.stickAngle) > this.failAngleRad ||
               Math.abs(state.platformPos) >= this.worldWidth / 2;
    }

    createInitialState(initialAngleVariationDeg = 2) {
        const maxRad = (initialAngleVariationDeg * Math.PI) / 180;
        const theta0 = (Math.random() * 2 - 1) * maxRad;
        return {
            platformPos: 0,
            platformVel: 0,
            stickAngle: theta0,
            stickAngularVel: 0,
            wheelRotation: 0
        };
    }

    _wrapPi(a) {
        while (a > Math.PI) a -= 2 * Math.PI;
        while (a < -Math.PI) a += 2 * Math.PI;
        return a;
    }
}
