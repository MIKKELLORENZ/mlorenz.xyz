class ReinforcementLearning {
    constructor(drone, otherDrones = []) {
        this.drone = drone;
        this.otherDrones = otherDrones;
        
        // TD3 learning parameters
        this.actorLearningRate = 0.0003;  // faster policy updates
        this.criticLearningRate = 0.0003; // critics learn at same rate
        this.discountFactor = 0.99;
        this.tau = 0.005;
        this.batchSize = 128;
        
        // TD3 specific
        this.policyNoiseStd = 0.2;
        this.policyNoiseClip = 0.5;
        this.policyUpdateFrequency = 2;
        this.criticUpdateCounter = 0;

        this.actionDimensions = 5; // roll, pitch, yaw, thrust, fire
        
        // OU Noise for exploration
        this.noiseTheta = 0.15;
        this.noiseSigma = 0.3;
        this.noiseDecay = 0.995; // per-EPISODE decay (not per-step)
        this.noiseMin = 0.05;
        this.noiseState = new Array(this.actionDimensions).fill(0);
        this.noiseScale = 1.0;
        
        // Training stats
        this.episode = 0;
        this.episodeStep = 0;
        this.episodeReward = 0;
        this.totalRewards = [];
        this.episodeLengths = [];
        this.runningAvgReward = 0;
        this.successWindow = [];
        this.successWindowSize = 25;
        this.targetHeight = 5.0;
        
        // Combat rewards
        this.hitReward = 50;
        this.destroyReward = 200;
        this.destroyedPenalty = -200;
        this.dangerProximityThreshold = 5.0;
        this.successfulShotsCount = 0;
        
        // Scoreboard tracking
        this.kills = 0;
        this.deaths = 0;
        
        // Replay buffer
        this.replayBuffer = [];
        this.maxReplayBuffer = 50000;
        this.warmupSteps = 256;
        
        // Frame stacking
        this.prevStates = [];
        this.frameStackSize = 2;
        this.prevAction = null;
        this.baseStateSize = null;
        
        this.isTraining = false;
        this.stabilityScores = [];
        
        // Wind (always on — learn to fly in real conditions)
        this.windEnabled = true;
        this.windStrength = 0.5;
        this.windDirection = new THREE.Vector3(1, 0, 0);
        this.turbulenceIntensity = 0.25;
        this.windChangeTimer = 0;
        
        // Single unified mode — no curriculum stages
        this.maxEpisodeSteps = 400;
        
        // PER parameters
        this.usePrioritizedReplay = true;
        this.priorityAlpha = 0.6;
        this.priorityBeta = 0.4;
        this.priorityBetaIncrement = 0.001;
        this.priorityEpsilon = 0.01;
        
        this.raycaster = new THREE.Raycaster();
        
        try {
            this.initNetworks();
        } catch (error) {
            console.error("Error initializing networks:", error);
            throw error;
        }
    }
    
    initNetworks() {
        let singleStateSize;
        try {
            const droneState = this.drone.getState();
            if (droneState && droneState.position) {
                singleStateSize = this.getStateVector(droneState).length;
            } else {
                singleStateSize = this.createDummyStateVector().length;
            }
        } catch (e) {
            singleStateSize = this.createDummyStateVector().length;
        }
        
        this.baseStateSize = singleStateSize;
        const stateSize = singleStateSize * this.frameStackSize;
        const actionSize = this.actionDimensions;

        // Actor (3 hidden layers — compact for browser performance)
        this.actor = tf.sequential();
        this.actor.add(tf.layers.dense({ units: 128, activation: 'relu', inputShape: [stateSize], kernelInitializer: 'heNormal' }));
        this.actor.add(tf.layers.dense({ units: 128, activation: 'relu', kernelInitializer: 'heNormal' }));
        this.actor.add(tf.layers.dense({ units: 64, activation: 'relu', kernelInitializer: 'heNormal' }));
        this.actor.add(tf.layers.dense({ units: actionSize, activation: 'tanh', kernelInitializer: tf.initializers.randomUniform({ minval: -0.003, maxval: 0.003 }) }));
        this.actor.compile({ optimizer: tf.train.adam(this.actorLearningRate), loss: 'meanSquaredError' });

        // Twin critics (functional API)
        this.critic1 = this._buildCritic(stateSize, actionSize);
        this.critic2 = this._buildCritic(stateSize, actionSize);

        // Target networks (matching architecture)
        this.targetActor = tf.sequential();
        this.targetActor.add(tf.layers.dense({ units: 128, activation: 'relu', inputShape: [stateSize], kernelInitializer: 'heNormal' }));
        this.targetActor.add(tf.layers.dense({ units: 128, activation: 'relu', kernelInitializer: 'heNormal' }));
        this.targetActor.add(tf.layers.dense({ units: 64, activation: 'relu', kernelInitializer: 'heNormal' }));
        this.targetActor.add(tf.layers.dense({ units: actionSize, activation: 'tanh', kernelInitializer: tf.initializers.randomUniform({ minval: -0.003, maxval: 0.003 }) }));
        
        this.targetCritic1 = this._buildCritic(stateSize, actionSize);
        this.targetCritic2 = this._buildCritic(stateSize, actionSize);

        // Hard copy initial weights
        this.updateTargetNetworks(1.0);

        // Snapshot initial actor weights for drift tracking
        this.initialWeights = this.actor.getWeights().map(w => w.clone());
        this.weightDriftHistory = [];

        console.log(`RL networks: state=${stateSize}, action=${actionSize}`);
    }
    
    _buildCritic(stateSize, actionSize) {
        const sIn = tf.input({ shape: [stateSize] });
        const aIn = tf.input({ shape: [actionSize] });
        // Concat state+action early for better credit assignment
        const cat = tf.layers.concatenate().apply([sIn, aIn]);
        const h1 = tf.layers.dense({ units: 128, activation: 'relu', kernelInitializer: 'heNormal' }).apply(cat);
        const h2 = tf.layers.dense({ units: 128, activation: 'relu', kernelInitializer: 'heNormal' }).apply(h1);
        const h3 = tf.layers.dense({ units: 64, activation: 'relu', kernelInitializer: 'heNormal' }).apply(h2);
        const out = tf.layers.dense({ units: 1, kernelInitializer: tf.initializers.randomUniform({ minval: -0.003, maxval: 0.003 }) }).apply(h3);
        const model = tf.model({ inputs: [sIn, aIn], outputs: out });
        model.compile({ optimizer: tf.train.adam(this.criticLearningRate), loss: 'meanSquaredError' });
        return model;
    }
    
    createDummyStateVector() {
        return new Array(23).fill(0);
    }
    
    updateTargetNetworks(tau = this.tau) {
        tf.tidy(() => {
            const softUpdate = (src, tgt) => {
                const sw = src.getWeights();
                const tw = tgt.getWeights();
                tgt.setWeights(sw.map((w, i) => tf.add(tf.mul(tw[i], 1 - tau), tf.mul(w, tau))));
            };
            softUpdate(this.actor, this.targetActor);
            softUpdate(this.critic1, this.targetCritic1);
            softUpdate(this.critic2, this.targetCritic2);
        });
    }
    
    getStateVector(droneState) {
        const s = [];
        // Position (normalized to gym bounds)
        s.push(droneState.position.x / 30);
        s.push(droneState.position.y / 15);
        s.push(droneState.position.z / 20);
        // Height error
        s.push(Math.tanh((this.targetHeight - droneState.position.y) / 5));
        // Orientation (roll, pitch, yaw)
        s.push(droneState.rotation.x / Math.PI);
        s.push(droneState.rotation.z / Math.PI);
        const yaw = Math.atan2(
            2 * (this.drone.quaternion.w * this.drone.quaternion.y + this.drone.quaternion.x * this.drone.quaternion.z),
            1 - 2 * (this.drone.quaternion.y * this.drone.quaternion.y + this.drone.quaternion.z * this.drone.quaternion.z)
        );
        s.push(Math.sin(yaw), Math.cos(yaw));
        // Body-frame velocity
        const invQ = this.drone.quaternion.clone().invert();
        const bv = droneState.velocity.clone().applyQuaternion(invQ);
        s.push(Math.tanh(bv.x / 8), Math.tanh(bv.y / 8), Math.tanh(bv.z / 8));
        // Angular velocity (normalized)
        s.push(Math.tanh(droneState.angularVelocity.x / 4), Math.tanh(droneState.angularVelocity.y / 4), Math.tanh(droneState.angularVelocity.z / 4));
        // Own health
        s.push(droneState.health / 100);
        // Enemy info
        if (droneState.nearestDroneDistance !== null && droneState.nearestDroneDirection) {
            const bd = droneState.nearestDroneDirection.clone().applyQuaternion(invQ);
            s.push(Math.tanh(droneState.nearestDroneDistance / this.drone.maxDetectionRange));
            s.push(bd.x, bd.y, bd.z);
            s.push(this.checkTargetVisibility(droneState.nearestDrone) ? 1 : 0);
        } else {
            s.push(1, 0, 0, 0, 0);
        }
        // Weapon cooldown
        s.push(droneState.weaponCooldown / this.drone.weaponCooldownTime);
        // Wall proximity warnings (0 = far from wall, 1 = at wall)
        const distToWallX = 30 - Math.abs(droneState.position.x);
        const distToWallZ = 20 - Math.abs(droneState.position.z);
        s.push(Math.max(0, 1 - distToWallX / 10)); // ramps up within 10 units of wall
        s.push(Math.max(0, 1 - distToWallZ / 10));
        return s;
    }
    
    checkTargetVisibility(targetDrone) {
        if (!targetDrone) return false;
        const origin = this.drone.position.clone();
        const target = targetDrone.position.clone();
        const dir = new THREE.Vector3().subVectors(target, origin).normalize();
        this.raycaster.set(origin, dir);
        // Skip expensive scene traversal — use bounding checks only
        return true;
    }
    
    getOUNoise() {
        for (let i = 0; i < this.noiseState.length; i++) {
            this.noiseState[i] += this.noiseTheta * (0 - this.noiseState[i]) + this.noiseSigma * (Math.random() * 2 - 1);
        }
        return this.noiseState.map(n => n * this.noiseScale);
    }
    
    getAction(state, explore = true) {
        // During warmup: random actions biased toward hover
        if (explore && this.isTraining && this.replayBuffer.length < this.warmupSteps) {
            return [
                (Math.random() * 2 - 1) * 0.3,
                (Math.random() * 2 - 1) * 0.3,
                (Math.random() * 2 - 1) * 0.3,
                (Math.random() * 2 - 1) * 0.25,
                Math.random() * 2 - 1             // random fire during warmup too
            ];
        }
        
        const st = tf.tensor2d([state], [1, state.length]);
        const action = tf.tidy(() => Array.from(this.actor.predict(st).dataSync()));
        st.dispose();
        
        if (explore && this.isTraining) {
            const noise = this.getOUNoise();
            // Roll, pitch, yaw: full noise
            for (let i = 0; i < 3; i++) {
                action[i] = Math.max(-1, Math.min(1, action[i] + noise[i]));
            }
            // Thrust: slightly reduced noise
            action[3] = Math.max(-1, Math.min(1, action[3] + noise[3] * 0.4));
            // Fire: explore shooting early
            if (this.noiseScale > 0.5) {
                action[4] = Math.random() * 2 - 1;
            } else {
                action[4] = Math.max(-1, Math.min(1, action[4] + noise[4] * 0.5));
            }
        }
        return action;
    }
    
    calculateReward(droneState, action) {
        const isFiring = action ? action[action.length - 1] > 0 : false;
        let r = 0;
        
        // ── Flight fundamentals (always active) ──────────────
        const heightError = Math.abs(droneState.position.y - this.targetHeight);
        const tilt = Math.abs(droneState.rotation.x) + Math.abs(droneState.rotation.z);
        const speed = droneState.velocity.length();
        
        // Height: Gaussian reward peaked at target height
        r += Math.exp(-heightError * heightError / 3.0) * 1.5;
        if (heightError < 1.0) r += 0.3;
        
        // Upright bonus (peak 0.8 when perfectly level)
        r += Math.max(0, 1.0 - tilt / 0.6) * 0.8;
        
        // Penalize spinning
        r -= Math.min(0.8, droneState.angularVelocity.length() / 3.0) * 0.5;
        
        // Wall proximity penalty (smooth gradient)
        const dwx = 30 - Math.abs(droneState.position.x);
        const dwz = 20 - Math.abs(droneState.position.z);
        if (dwx < 10) r -= Math.pow((10 - dwx) / 10, 2) * 1.5;
        if (dwz < 10) r -= Math.pow((10 - dwz) / 10, 2) * 1.5;
        // Floor/ceiling
        if (droneState.position.y < 1.5) r -= Math.pow((1.5 - droneState.position.y) / 1.5, 2) * 2.0;
        if (droneState.position.y > 13) r -= Math.pow((droneState.position.y - 13) / 2, 2) * 1.5;
        
        // ── Combat (always active) ───────────────────────────
        if (droneState.nearestDroneDistance !== null && droneState.nearestDroneDirection) {
            const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.drone.quaternion);
            const align = fwd.dot(droneState.nearestDroneDirection); // [-1, 1]
            
            // Facing enemy = good
            r += Math.max(0, align) * 1.5;
            if (align > 0.85) r += 0.8;
            
            // Distance management: prefer 8-15 range
            const distReward = Math.exp(-Math.pow(droneState.nearestDroneDistance - 10, 2) / 60);
            r += distReward * 0.8;
            
            // Fire rewards
            if (isFiring) {
                if (align > 0.85 && droneState.nearestDroneDistance < 20) r += 3.0;
                else if (align > 0.6 && droneState.nearestDroneDistance < 25) r += 0.5;
                else r -= 1.5;
                r -= 0.05; // ammo conservation
            }
            
            // Survival bonus scaled by health
            r += (droneState.health / 100) * 0.1;
            
            // Evasion: reward speed when enemy is behind you
            if (speed > 2 && align < -0.3) r += 0.2;
        } else {
            // No enemy visible — encourage searching
            r -= 0.2;
            r += Math.abs(droneState.angularVelocity.y) * 0.1;
        }
        
        // Alive bonus
        r += 0.08;
        
        // Terminal penalties
        if (droneState.crashed) r -= 15;
        if (droneState.isDestroyed) r -= 20;
        if (!droneState.crashed && !droneState.isDestroyed && droneState.position.y > 1.0) r += 0.05;
        
        return Math.max(-25, Math.min(25, r));
    }
    
    applyWindForces(dt) {
        if (!this.windEnabled) return;
        this.windChangeTimer -= dt;
        if (this.windChangeTimer <= 0) {
            this.windChangeTimer = 5 + Math.random() * 10;
            const a = Math.random() * Math.PI * 2;
            this.windDirection.set(Math.cos(a), Math.random() * 0.3 - 0.15, Math.sin(a)).normalize();
            this.windStrength = 0.5 + Math.random() * 1.5;
        }
        const w = this.windDirection.clone().multiplyScalar(this.windStrength);
        if (this.turbulenceIntensity > 0) {
            w.add(new THREE.Vector3(
                (Math.random() * 2 - 1) * this.turbulenceIntensity,
                (Math.random() * 2 - 1) * this.turbulenceIntensity,
                (Math.random() * 2 - 1) * this.turbulenceIntensity
            ));
        }
        this.drone.applyExternalForce(w);
    }
    
    // FIXED: Consistent frame stacking
    _buildStackedState(rawState) {
        const target = this.baseStateSize * this.frameStackSize;
        let stacked = [...rawState];
        for (let i = 0; i < this.frameStackSize - 1; i++) {
            stacked = stacked.concat(i < this.prevStates.length ? this.prevStates[i] : rawState);
        }
        if (stacked.length > target) stacked = stacked.slice(0, target);
        while (stacked.length < target) stacked.push(0);
        return stacked;
    }
    
    step(deltaTime) {
        if (!this.isTraining) return;
        const dt = Math.min(deltaTime, 0.03);
        
        if (this.windEnabled) {
            this.applyWindForces(dt);
        }
        
        try {
            const state = this.drone.getState();
            const raw = this.getStateVector(state);
            const stacked = this._buildStackedState(raw);
            
            if (this.prevAction !== null && this.prevStates.length > 0) {
                const reward = this.calculateReward(state, this.prevAction);
                this.episodeReward += reward;
                
                const tilt = Math.sqrt(state.rotation.x ** 2 + state.rotation.z ** 2);
                this.stabilityScores.push(1 - Math.min(1, (tilt + state.velocity.length() * 0.1) / 2));
                
                const done = state.crashed || state.isDestroyed || this.episodeStep >= this.maxEpisodeSteps;
                const prevStacked = this._buildStackedState(this.prevStates[0]);
                
                this.replayBuffer.push({ state: prevStacked, action: this.prevAction, reward, nextState: stacked, done, tdError: Math.abs(reward), fresh: true });
                if (this.replayBuffer.length > this.maxReplayBuffer) this.replayBuffer.shift();
                
                const freq = 2;
                if (this.replayBuffer.length >= this.warmupSteps && this.episodeStep % freq === 0) {
                    this.trainOnBatch();
                }
            }
            
            const action = this.getAction(stacked);
            this.drone.setControlInputs(action[0], action[1], action[2], (action[3] + 1) / 2);
            if (action[4] > 0 && state.weaponCooldown <= 0) this.drone.shoot();
            
            this.prevStates.unshift(raw);
            while (this.prevStates.length > this.frameStackSize) this.prevStates.pop();
            this.prevAction = action;
            
            if (state.crashed || state.isDestroyed) {
                if (state.isDestroyed) this.deaths++;
                // Guard: only end episode if we actually had steps (prevent double-count)
                if (this.episodeStep > 0 || this.prevAction !== null) {
                    this.endEpisode(false);
                }
                return;
            }
            if (this.episodeStep >= this.maxEpisodeSteps) { this.endEpisode(true); return; }
            this.episodeStep++;
            
            for (const od of this.otherDrones) {
                if (od.shotBy === this.drone.id && od.health < 100) {
                    this.episodeReward += this.hitReward;
                    this.successfulShotsCount++;
                    od.shotBy = null;
                }
                if (od.isDestroyed && od.shotBy === this.drone.id) {
                    this.episodeReward += this.destroyReward;
                    this.kills++;
                    od.shotBy = null;
                    this.endEpisode(true);
                    return;
                }
            }
        } catch (e) {
            console.error("RL step error:", e);
        }
    }
    
    // FIXED: Synchronous training with gradient clipping, no async overlap
    trainOnBatch() {
        if (this._trainingInProgress) return; // prevent overlapping updates
        try {
            if (this.replayBuffer.length < this.warmupSteps) return; // need enough diverse samples
            this._trainingInProgress = true;
            const batch = this.sampleBatch();
            
            // Compute targets synchronously in tf.tidy
            const tensors = tf.tidy(() => {
                const states = tf.tensor2d(batch.map(e => e.state));
                const actions = tf.tensor2d(batch.map(e => e.action));
                const rewards = tf.tensor1d(batch.map(e => e.reward));
                const nextStates = tf.tensor2d(batch.map(e => e.nextState));
                const dones = tf.tensor1d(batch.map(e => e.done ? 1 : 0));
                
                const noise = tf.clipByValue(
                    tf.randomNormal([this.batchSize, this.actionDimensions], 0, this.policyNoiseStd),
                    -this.policyNoiseClip, this.policyNoiseClip
                );
                const nextActions = tf.clipByValue(tf.add(this.targetActor.predict(nextStates), noise), -1, 1);
                const tq1 = this.targetCritic1.predict([nextStates, nextActions]);
                const tq2 = this.targetCritic2.predict([nextStates, nextActions]);
                const tq = tf.minimum(tq1, tq2);
                const targets = tf.add(rewards, tf.mul(tf.mul(tf.scalar(this.discountFactor), tf.sub(tf.ones(dones.shape), dones)), tq.squeeze()));
                
                return {
                    targets2D: targets.expandDims(1).clone(),
                    st: states.clone(),
                    act: actions.clone()
                };
            });
            
            // Train critics then optionally actor
            const run = async () => {
                try {
                    await this.critic1.trainOnBatch([tensors.st, tensors.act], tensors.targets2D);
                    await this.critic2.trainOnBatch([tensors.st, tensors.act], tensors.targets2D);
                    
                    this.criticUpdateCounter++;
                    if (this.criticUpdateCounter % this.policyUpdateFrequency === 0) {
                        // Actor gradient with gradient clipping
                        const actorVarNames = new Set(this.actor.trainableWeights.map(w => w.val.name));
                        const { grads } = tf.variableGrads(() => {
                            const a = this.actor.predict(tensors.st);
                            const q = this.critic1.predict([tensors.st, a]);
                            return tf.neg(tf.mean(q));
                        });
                        const actorGrads = {};
                        const maxGradNorm = 1.0;
                        for (const [name, grad] of Object.entries(grads)) {
                            if (actorVarNames.has(name)) {
                                // Clip individual gradients
                                actorGrads[name] = tf.clipByValue(grad, -maxGradNorm, maxGradNorm);
                                grad.dispose();
                            } else {
                                grad.dispose();
                            }
                        }
                        this.actor.optimizer.applyGradients(actorGrads);
                        Object.values(actorGrads).forEach(g => g.dispose());
                        this.updateTargetNetworks();
                    }
                } finally {
                    tensors.targets2D.dispose();
                    tensors.st.dispose();
                    tensors.act.dispose();
                    this._trainingInProgress = false;
                }
            };
            run().catch(e => { console.error("Train error:", e); this._trainingInProgress = false; });
        } catch (e) {
            console.error("trainOnBatch error:", e);
            this._trainingInProgress = false;
        }
    }
    
    sampleBatch() {
        return this.usePrioritizedReplay ? this.samplePrioritizedBatch() : this._uniformSample();
    }
    
    _uniformSample() {
        const b = [];
        for (let i = 0; i < this.batchSize; i++) b.push(this.replayBuffer[Math.floor(Math.random() * this.replayBuffer.length)]);
        return b;
    }
    
    samplePrioritizedBatch() {
        const priorities = this.replayBuffer.map(e => {
            // Use stored TD-error if available, otherwise fall back to |reward| + recency bonus
            const tdErr = e.tdError !== undefined ? Math.abs(e.tdError) : Math.abs(e.reward);
            const recencyBonus = e.fresh ? 0.5 : 0; // boost recently added experiences
            return Math.pow(tdErr + recencyBonus + this.priorityEpsilon, this.priorityAlpha);
        });
        const sum = priorities.reduce((a, b) => a + b, 0);
        const prefix = [0];
        for (let i = 0; i < priorities.length; i++) prefix.push(prefix[i] + priorities[i] / sum);
        
        const bsearch = (arr, v) => {
            let lo = 0, hi = arr.length - 1;
            while (lo < hi) { const m = (lo + hi) >> 1; arr[m] < v ? lo = m + 1 : hi = m; }
            return lo;
        };
        
        const batch = [], weights = [];
        for (let i = 0; i < this.batchSize; i++) {
            const idx = Math.max(0, bsearch(prefix, Math.random()) - 1);
            const w = Math.pow(1 / (this.replayBuffer.length * (priorities[idx] / sum)), this.priorityBeta);
            weights.push(w);
            batch.push({ ...this.replayBuffer[idx], weight: w });
        }
        const maxW = Math.max(...weights);
        batch.forEach(e => e.weight /= maxW);
        // Clear fresh flag so recency bonus doesn't persist
        batch.forEach(e => { if (e.fresh) e.fresh = false; });
        this.priorityBeta = Math.min(1, this.priorityBeta + this.priorityBetaIncrement);
        return batch;
    }
    
    endEpisode(success = false) {
        this.noiseState.fill(0);
        this.noiseScale = Math.max(this.noiseMin, this.noiseScale * this.noiseDecay);
        this.totalRewards.push(this.episodeReward);
        this.episodeLengths.push(this.episodeStep);
        this.runningAvgReward = this.totalRewards.length === 1
            ? this.episodeReward
            : 0.95 * this.runningAvgReward + 0.05 * this.episodeReward;
        
        // Success = survived a decent portion of episode
        if (!success && this.stabilityScores.length > 0) {
            const avgStab = this.stabilityScores.reduce((a, b) => a + b, 0) / this.stabilityScores.length;
            const survivalRatio = this.episodeStep / Math.max(1, this.maxEpisodeSteps);
            success = survivalRatio > 0.5 && avgStab > 0.35;
        }
        
        this.successWindow.push(success);
        if (this.successWindow.length > this.successWindowSize) this.successWindow.shift();
        
        if (this.stabilityScores.length > 0) {
            const avgStab = this.stabilityScores.reduce((a, b) => a + b, 0) / this.stabilityScores.length;
            this.episodeStabilityHistory = this.episodeStabilityHistory || [];
            this.episodeStabilityHistory.push(avgStab);
            if (this.episodeStabilityHistory.length > 200) this.episodeStabilityHistory.shift();
        }

        // Compute average L2 weight drift from initial weights
        if (this.initialWeights) {
            const drift = tf.tidy(() => {
                const currentWeights = this.actor.getWeights();
                let totalDist = 0;
                let totalParams = 0;
                for (let i = 0; i < currentWeights.length; i++) {
                    const diff = tf.sub(currentWeights[i], this.initialWeights[i]);
                    totalDist += tf.sum(tf.square(diff)).dataSync()[0];
                    totalParams += currentWeights[i].size;
                }
                return Math.sqrt(totalDist / totalParams);
            });
            this.weightDriftHistory.push(drift);
            if (this.weightDriftHistory.length > 500) this.weightDriftHistory.shift();
        }
        
        this.episode++;
        this.episodeStep = 0;
        this.episodeReward = 0;
        this.prevAction = null;
        this.prevStates = [];
        this.stabilityScores = [];
        this.successfulShotsCount = 0;
    }
    
    startTraining() { this.isTraining = true; }
    stopTraining() { this.isTraining = false; }
    
    getStats() {
        return {
            episode: this.episode,
            totalRewards: this.totalRewards,
            episodeLengths: this.episodeLengths,
            runningAvgReward: this.runningAvgReward,
            explorationRate: this.noiseScale,
            stabilityScores: this.episodeStabilityHistory || this.stabilityScores,
            successRate: this.successWindow.filter(s => s).length / Math.max(1, this.successWindow.length),
            kills: this.kills,
            deaths: this.deaths,
            replayBufferSize: this.replayBuffer.length,
            criticUpdates: this.criticUpdateCounter,
            weightDrift: this.weightDriftHistory || []
        };
    }
    
    async saveModel() {
        try {
            await this.actor.save('localstorage://dogfight-actor-' + this.drone.id);
            console.log(`Model saved for drone ${this.drone.id}`);
        } catch (e) { console.warn('Save failed:', e); }
    }
    
    async loadModel() {
        try {
            this.actor = await tf.loadLayersModel('localstorage://dogfight-actor-' + this.drone.id);
            console.log(`Model loaded for drone ${this.drone.id}`);
        } catch (e) { console.warn('No saved model:', e); }
    }
}
