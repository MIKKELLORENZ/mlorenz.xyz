/**
 * Environment for the stick balance simulation (CartPole-like)
 */
class Environment {
    constructor(params) {
        this.physics = new Physics();

        // Wind (kept off initially for curriculum)
        this.maxWindStrength = params.windStrength || 0;
        this.currentWind = 0;
        this.targetWind = 0;
        this.windChangeSpeed = 0.05;
        this.windUpdateInterval = 80;
        this.stepCount = 0;

        // Episodes
        this.initialAngleVariation = params.initialAngleVariation || 2; // degrees
        this.maxSteps = 2000;

        // Reward shaping weights
        this.failPenalty = -100;

        // Curriculum: no wind first 200 episodes
        this.episodeCount = 0;

        // Track durations to unlock wind later (optional)
        this.recentDurations = [];

        this.reset();
    }

    reset() {
        this.episodeCount++;
        this.state = this.physics.createInitialState(this.initialAngleVariation);

        // Simple curriculum: gradually increase initial angle variation
        if (this.episodeCount % 50 === 0 && this.initialAngleVariation < 10) {
            this.initialAngleVariation += 1;
        }

        // After agent shows some stability, allow longer episodes
        if (this.episodeCount === 300) this.maxSteps = 3000;
        if (this.episodeCount === 600) this.maxSteps = 5000;

        // Enable wind sooner if user set it and some stability achieved
        this.windEnabled = (this.maxWindStrength > 0) && (this.episodeCount >= 120);

        this.currentWind = 0;
        this.targetWind = 0;
        this.stepCount = 0;
        this.episodeOver = false;
        this.totalReward = 0;

        return { ...this.state, wind: this.currentWind, windMax: this.maxWindStrength || 0 };
    }

    updateWind() {
        this.stepCount++;

        if (!this.windEnabled) {
            this.currentWind = 0;
            return 0;
        }

        if (this.stepCount % this.windUpdateInterval === 0) {
            this.targetWind = (Math.random() * 2 - 1) * this.maxWindStrength;
        }
        this.currentWind += (this.targetWind - this.currentWind) * this.windChangeSpeed;
        return this.currentWind;
    }

    calculateReward(prevState, action, nextState, done) {
        if (done) return this.failPenalty;

        // Core survival bonus - more generous
        let reward = 2.0;

        // Upright bonus (sharp near zero angle) - increased weight
        const angle = nextState.stickAngle;
        const uprightBonus = Math.exp(-40 * angle * angle); // ~1 near 0, drops fast
        reward += 3.5 * uprightBonus;

        // Centering bonus - reward being near the middle of the map
        const x = nextState.platformPos;
        const centeringBonus = Math.exp(-0.5 * x * x); // ~1 at center, drops with distance
        reward += 0.05 * centeringBonus;

        // Position penalty (keep near center) - reduced to allow more movement
        reward -= 0.005 * x * x;

        // Velocity penalties (small) - very gentle
        reward -= 0.001 * nextState.platformVel * nextState.platformVel;
        reward -= 0.0005 * nextState.stickAngularVel * nextState.stickAngularVel;

        // Small control cost to discourage unnecessary large actions
        const actMag = Math.abs(action);
        reward -= 0.005 * actMag;

        return reward;
    }

    step(action) {
        const wind = this.updateWind();
        const next = this.physics.update(this.state, action, wind);

        const done = this.physics.hasStickFallen(next) || this.stepCount >= this.maxSteps;
        const reward = this.calculateReward(this.state, action, next, done);

        this.totalReward += reward;
        this.state = next;

        return {
            state: { ...this.state, wind: this.currentWind, windMax: this.maxWindStrength || 0 },
            reward,
            done,
            wind: this.currentWind,
            totalReward: this.totalReward,
            steps: this.stepCount
        };
    }

    isDone() { return this.episodeOver; }

    getWorldInfo() {
        return {
            width: this.physics.worldWidth,
            stickLength: this.physics.stickLength,
            platformWidth: this.physics.platformWidth,
            wheelRadius: this.physics.wheelRadius
        };
    }

    getNormalizedWind() {
        return this.currentWind / (this.maxWindStrength || 1);
    }

    setDebugMode(enabled) {
        this.debug = !!enabled;
    }
}
