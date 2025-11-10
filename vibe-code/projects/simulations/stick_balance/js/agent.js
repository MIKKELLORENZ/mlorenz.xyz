/**
 * DQN agent (Double DQN + Huber loss + soft target updates)
 */
class Agent {
    constructor(params) {
        // Learning params (clamped for safety)
        const lr = Math.min(Math.max(params.learningRate || 0.001, 1e-5), 1e-2);
        this.learningRate = lr;
        this.discountFactor = params.discountFactor || 0.99;

        this.explorationRate = params.explorationRate || 1.0;
        this.minExplorationRate = params.minExplorationRate || 0.05;
        this.explorationDecay = params.explorationDecay || 0.995;

        // Net sizes
        this.inputSize = 7;        // x, xdot, theta, thetadot, wind, sin(theta), cos(theta)
        this.hiddenSize = 128;
        this.outputSize = 9;       // fewer, stronger discrete actions

        // Replay
        this.replayBuffer = [];
        this.replayBufferSize = 50000;
        this.batchSize = 128;
        this.minReplaySize = 500; // Reduced from 1000 for faster initial learning

        // Prioritized Experience Replay
        this.priorities = [];
        this.priorityAlpha = 0.6; // How much to use priorities (0=uniform, 1=full priority)
        this.priorityBeta = 0.4;  // Importance sampling weight (increases to 1)
        this.priorityBetaIncrement = 0.001;
        this.priorityEpsilon = 0.01; // Small constant to ensure non-zero probabilities

        // Double DQN / target update
        this.stepCount = 0;
        this.tau = 0.005;          // soft update every step
        this.targetUpdateFreq = 4; // Only update target every N steps for more stability

        // Networks
        this.mainNetwork = this.createNetwork();
        this.targetNetwork = this.createNetwork();
        this.hardCopyToTarget();

        // Adam optimizer storage
        this.adamBeta1 = 0.9;
        this.adamBeta2 = 0.999;
        this.adamEps = 1e-8;
        this.adamStep = 0;
        this.opt = this._createAdamState(this.createNetwork());

        // Stats
        this.episodeCount = 0;
        this.episodeDurations = [];
        this.episodeRewards = [];
        this.weightChanges = [];
        this.lastWeightChange = 0;
        this.bestDuration = 0;
        this.lastReward = 0;

        this.initialWeights = this.copyWeights(this.mainNetwork);

        this.avgRewardLast100 = 0;
        
        // Gradient clipping for stability
        this.maxGradNorm = 10.0; // Clip gradients to this L2 norm
    }

    _createAdamState(templateNet) {
        const zeroLike = arr => new Array(arr.length).fill(0);
        return {
            w1m: zeroLike(templateNet.w1), w1v: zeroLike(templateNet.w1),
            b1m: zeroLike(templateNet.b1), b1v: zeroLike(templateNet.b1),
            w2m: zeroLike(templateNet.w2), w2v: zeroLike(templateNet.w2),
            b2m: zeroLike(templateNet.b2), b2v: zeroLike(templateNet.b2)
        };
    }

    createNetwork() {
        return {
            w1: this.initializeWeights(this.inputSize, this.hiddenSize),
            b1: new Array(this.hiddenSize).fill(0),
            w2: this.initializeWeights(this.hiddenSize, this.outputSize),
            b2: new Array(this.outputSize).fill(0)
        };
    }

    initializeWeights(input, output) {
        const scale = Math.sqrt(2.0 / input);
        const w = new Array(input * output);
        for (let i = 0; i < w.length; i++) w[i] = (Math.random() * 2 - 1) * scale;
        return w;
    }

    copyWeights(net) {
        return {
            w1: [...net.w1], b1: [...net.b1],
            w2: [...net.w2], b2: [...net.b2]
        };
    }

    hardCopyToTarget() {
        this.targetNetwork = this.copyWeights(this.mainNetwork);
    }

    softUpdateTarget() {
        const t = this.targetNetwork, s = this.mainNetwork, a = this.tau, b = 1 - a;
        for (let i = 0; i < t.w1.length; i++) t.w1[i] = b * t.w1[i] + a * s.w1[i];
        for (let i = 0; i < t.w2.length; i++) t.w2[i] = b * t.w2[i] + a * s.w2[i];
        for (let i = 0; i < t.b1.length; i++) t.b1[i] = b * t.b1[i] + a * s.b1[i];
        for (let i = 0; i < t.b2.length; i++) t.b2[i] = b * t.b2[i] + a * s.b2[i];
    }

    // Scaling helpers
    _tanhClip(v, s) { return Math.tanh(v / s); }

    // Forward pass with consistent scaling
    forwardPass(network, state) {
        // Robust normalization
        const windMax = (state.windMax && state.windMax > 0) ? state.windMax : 10;
        const theta = state.stickAngle || 0;
        const input = [
            this._tanhClip(state.platformPos || 0, 5.0),
            this._tanhClip(state.platformVel || 0, 5.0),
            theta / Math.PI,
            this._tanhClip(state.stickAngularVel || 0, 5.0),
            this._tanhClip(state.wind || 0, windMax),
            Math.sin(theta),
            Math.cos(theta)
        ];

        // Hidden
        const hidden = new Array(this.hiddenSize);
        for (let i = 0; i < this.hiddenSize; i++) {
            let sum = network.b1[i];
            for (let j = 0; j < this.inputSize; j++) sum += input[j] * network.w1[j * this.hiddenSize + i];
            hidden[i] = sum > 0 ? sum : 0; // ReLU
        }
        // Output (Q-values)
        const output = new Array(this.outputSize);
        for (let i = 0; i < this.outputSize; i++) {
            let sum = network.b2[i];
            for (let j = 0; j < this.hiddenSize; j++) sum += hidden[j] * network.w2[j * this.outputSize + i];
            output[i] = sum;
        }
        return { input, hidden, output };
    }

    // Discrete actions
    indexToAction(index) {
        // evenly space in [-1,1]
        if (index < 0) index = 0;
        if (index > this.outputSize - 1) index = this.outputSize - 1;
        return -1 + (2 * index) / (this.outputSize - 1);
    }
    actionToIndex(action) {
        const clamped = Math.max(-1, Math.min(1, action));
        const idx = Math.round((clamped + 1) * (this.outputSize - 1) / 2);
        return Math.max(0, Math.min(this.outputSize - 1, idx));
    }

    selectAction(state) {
        if (Math.random() < this.explorationRate) {
            return this.indexToAction(Math.floor(Math.random() * this.outputSize));
        }
        const { output } = this.forwardPass(this.mainNetwork, state);
        let best = 0;
        for (let i = 1; i < output.length; i++) if (output[i] > output[best]) best = i;
        
        // After exploration is low, be fully deterministic for long-term stability
        // Only add noise during high exploration phase
        if (this.explorationRate > 0.15 && Math.random() < 0.05) {
            const alternatives = [Math.max(0, best - 1), best, Math.min(this.outputSize - 1, best + 1)];
            return this.indexToAction(alternatives[Math.floor(Math.random() * alternatives.length)]);
        }
        return this.indexToAction(best);
    }

    addExperience(state, action, reward, nextState, done) {
        if (this.replayBuffer.length >= this.replayBufferSize) {
            this.replayBuffer.shift();
            this.priorities.shift();
        }
        this.replayBuffer.push({
            state: { ...state },
            action, reward,
            nextState: { ...nextState },
            done
        });
        
        // New experiences get max priority to ensure they're sampled
        const maxPriority = this.priorities.length > 0 ? Math.max(...this.priorities) : 1.0;
        this.priorities.push(maxPriority);
    }

    sampleBatch() {
        if (this.replayBuffer.length < this.minReplaySize) return null;
        
        // Prioritized sampling
        const batch = new Array(this.batchSize);
        const indices = new Array(this.batchSize);
        const weights = new Array(this.batchSize);
        
        // Calculate sampling probabilities
        const alpha = this.priorityAlpha;
        let prioritySum = 0;
        const probs = new Array(this.priorities.length);
        for (let i = 0; i < this.priorities.length; i++) {
            probs[i] = Math.pow(this.priorities[i] + this.priorityEpsilon, alpha);
            prioritySum += probs[i];
        }
        
        // Sample with replacement based on priorities
        for (let i = 0; i < this.batchSize; i++) {
            let rand = Math.random() * prioritySum;
            let idx = 0;
            let cumSum = 0;
            for (idx = 0; idx < probs.length; idx++) {
                cumSum += probs[idx];
                if (rand <= cumSum) break;
            }
            indices[i] = Math.min(idx, this.replayBuffer.length - 1);
            batch[i] = this.replayBuffer[indices[i]];
            
            // Importance sampling weight
            const prob = probs[indices[i]] / prioritySum;
            weights[i] = Math.pow(this.replayBuffer.length * prob, -this.priorityBeta);
        }
        
        // Normalize weights
        const maxWeight = Math.max(...weights);
        for (let i = 0; i < weights.length; i++) {
            weights[i] /= maxWeight;
        }
        
        // Increase beta over time (anneal to 1.0)
        this.priorityBeta = Math.min(1.0, this.priorityBeta + this.priorityBetaIncrement);
        
        return { batch, indices, weights };
    }

    // Huber loss gradient
    _huberGrad(error, delta = 1.0) {
        const a = Math.abs(error);
        return a <= delta ? error : Math.sign(error) * delta;
    }

    trainOnBatch(batchData) {
        if (!batchData) return 0;
        
        const { batch, indices, weights } = batchData;

        // Accumulate grads
        const gW1 = new Array(this.mainNetwork.w1.length).fill(0);
        const gB1 = new Array(this.mainNetwork.b1.length).fill(0);
        const gW2 = new Array(this.mainNetwork.w2.length).fill(0);
        const gB2 = new Array(this.mainNetwork.b2.length).fill(0);

        let totalLoss = 0;
        const newPriorities = new Array(batch.length);

        for (let batchIdx = 0; batchIdx < batch.length; batchIdx++) {
            const exp = batch[batchIdx];
            const weight = weights[batchIdx];
            
            const { state, action, reward, nextState, done } = exp;

            // Q(s,·)
            const fMain = this.forwardPass(this.mainNetwork, state);
            const qCurrent = fMain.output;

            // Double DQN: action from main, value from target
            const qNextMain = this.forwardPass(this.mainNetwork, nextState).output;
            let bestNext = 0;
            for (let i = 1; i < qNextMain.length; i++) if (qNextMain[i] > qNextMain[bestNext]) bestNext = i;

            const qNextTarget = this.forwardPass(this.targetNetwork, nextState).output;
            const bootstrap = done ? 0 : this.discountFactor * qNextTarget[bestNext];

            const aIdx = this.actionToIndex(action);
            const target = reward + bootstrap;

            // TD error for priority update
            const tdError = Math.abs(qCurrent[aIdx] - target);
            newPriorities[batchIdx] = tdError;

            // Huber loss on the chosen action output only; others target themselves
            const targetVec = qCurrent.slice();
            targetVec[aIdx] = target;

            // Backprop (one pass) - scale by importance sampling weight
            const hidden = fMain.hidden;
            const input = fMain.input;

            // Output layer grads
            const outputError = new Array(this.outputSize).fill(0);
            for (let i = 0; i < this.outputSize; i++) {
                const err = (qCurrent[i] - targetVec[i]);
                const grad = this._huberGrad(err) * weight; // Apply IS weight
                outputError[i] = grad;
                gB2[i] += grad;
                for (let j = 0; j < this.hiddenSize; j++) {
                    gW2[j * this.outputSize + i] += grad * hidden[j];
                }
                // loss for logging (approx)
                totalLoss += 0.5 * Math.min(err * err, Math.abs(err));
            }

            // Hidden
            const hiddenError = new Array(this.hiddenSize).fill(0);
            for (let i = 0; i < this.hiddenSize; i++) {
                let e = 0;
                for (let j = 0; j < this.outputSize; j++) {
                    e += outputError[j] * this.mainNetwork.w2[i * this.outputSize + j];
                }
                // ReLU derivative
                hiddenError[i] = (hidden[i] > 0 ? e : 0);
                gB1[i] += hiddenError[i];
                for (let j = 0; j < this.inputSize; j++) {
                    gW1[j * this.hiddenSize + i] += hiddenError[i] * input[j];
                }
            }
        }
        
        // Update priorities in buffer
        for (let i = 0; i < indices.length; i++) {
            this.priorities[indices[i]] = newPriorities[i];
        }

        // Calculate gradient norm for clipping
        let gradNorm = 0;
        for (let i = 0; i < gW1.length; i++) gradNorm += gW1[i] * gW1[i];
        for (let i = 0; i < gB1.length; i++) gradNorm += gB1[i] * gB1[i];
        for (let i = 0; i < gW2.length; i++) gradNorm += gW2[i] * gW2[i];
        for (let i = 0; i < gB2.length; i++) gradNorm += gB2[i] * gB2[i];
        gradNorm = Math.sqrt(gradNorm);
        
        // Global gradient clipping
        const clipScale = gradNorm > this.maxGradNorm ? this.maxGradNorm / gradNorm : 1.0;

        // Apply grads with Adam
        this.adamStep++;
        const t = this.adamStep;
        const lr = this.learningRate;
        const b1 = this.adamBeta1, b2 = this.adamBeta2, eps = this.adamEps;

        // w1
        for (let i = 0; i < this.mainNetwork.w1.length; i++) {
            const grad = (gW1[i] / batch.length) * clipScale;
            this.opt.w1m[i] = b1 * this.opt.w1m[i] + (1 - b1) * grad;
            this.opt.w1v[i] = b2 * this.opt.w1v[i] + (1 - b2) * grad * grad;
            const mHat = this.opt.w1m[i] / (1 - Math.pow(b1, t));
            const vHat = this.opt.w1v[i] / (1 - Math.pow(b2, t));
            this.mainNetwork.w1[i] -= lr * mHat / (Math.sqrt(vHat) + eps);
        }
        // b1
        for (let i = 0; i < this.mainNetwork.b1.length; i++) {
            const grad = (gB1[i] / batch.length) * clipScale;
            this.opt.b1m[i] = b1 * this.opt.b1m[i] + (1 - b1) * grad;
            this.opt.b1v[i] = b2 * this.opt.b1v[i] + (1 - b2) * grad * grad;
            const mHat = this.opt.b1m[i] / (1 - Math.pow(b1, t));
            const vHat = this.opt.b1v[i] / (1 - Math.pow(b2, t));
            this.mainNetwork.b1[i] -= lr * mHat / (Math.sqrt(vHat) + eps);
        }
        // w2
        for (let i = 0; i < this.mainNetwork.w2.length; i++) {
            const grad = (gW2[i] / batch.length) * clipScale;
            this.opt.w2m[i] = b1 * this.opt.w2m[i] + (1 - b1) * grad;
            this.opt.w2v[i] = b2 * this.opt.w2v[i] + (1 - b2) * grad * grad;
            const mHat = this.opt.w2m[i] / (1 - Math.pow(b1, t));
            const vHat = this.opt.w2v[i] / (1 - Math.pow(b2, t));
            this.mainNetwork.w2[i] -= lr * mHat / (Math.sqrt(vHat) + eps);
        }
        // b2
        for (let i = 0; i < this.mainNetwork.b2.length; i++) {
            const grad = (gB2[i] / batch.length) * clipScale;
            this.opt.b2m[i] = b1 * this.opt.b2m[i] + (1 - b1) * grad;
            this.opt.b2v[i] = b2 * this.opt.b2v[i] + (1 - b2) * grad * grad;
            const mHat = this.opt.b2m[i] / (1 - Math.pow(b1, t));
            const vHat = this.opt.b2v[i] / (1 - Math.pow(b2, t));
            this.mainNetwork.b2[i] -= lr * mHat / (Math.sqrt(vHat) + eps);
        }

        return totalLoss / batch.length;
    }

    learn(state, action, reward, nextState, done) {
        this.addExperience(state, action, reward, nextState, done);

        if (this.replayBuffer.length >= this.minReplaySize) {
            // Adaptive number of updates per step - more aggressive early on
            const updates = this.episodeCount < 50 ? 8 : (this.episodeCount < 150 ? 6 : (this.episodeCount < 300 ? 4 : 2));
            for (let k = 0; k < updates; k++) {
                const batchData = this.sampleBatch();
                this.trainOnBatch(batchData);
                
                // Only update target network every N steps for more stability
                if (this.stepCount % this.targetUpdateFreq === 0) {
                    this.softUpdateTarget();
                }
            }
        }
        this.stepCount++;
    }

    // Diagnostics
    calculateWeightChange() {
        let total = 0, count = 0;
        for (let i = 0; i < this.mainNetwork.w1.length; i++) {
            const d = this.mainNetwork.w1[i] - this.initialWeights.w1[i];
            total += d * d; count++;
        }
        for (let i = 0; i < this.mainNetwork.w2.length; i++) {
            const d = this.mainNetwork.w2[i] - this.initialWeights.w2[i];
            total += d * d; count++;
        }
        return Math.sqrt(total / Math.max(1, count));
    }

    endEpisode(duration, reward) {
        this.episodeCount++;
        this.episodeDurations.push(duration);
        this.episodeRewards.push(reward);
        this.lastReward = reward;

        if (duration > this.bestDuration) {
            this.bestDuration = duration;
            console.log(`🎉 New best duration: ${duration} steps`);
        }

        this.lastWeightChange = this.calculateWeightChange();
        this.weightChanges.push(this.lastWeightChange);

        this.avgRewardLast100 = this.episodeRewards.slice(-100)
            .reduce((a, b) => a + b, 0) / Math.min(100, this.episodeRewards.length);
    }

    decayExploration() {
        this.explorationRate = Math.max(
            this.minExplorationRate,
            this.explorationRate * this.explorationDecay
        );
    }

    getStats() {
        return {
            episodeCount: this.episodeCount,
            bestDuration: this.bestDuration,
            lastReward: this.lastReward,
            lastWeightChange: this.lastWeightChange,
            episodeDurations: this.episodeDurations,
            episodeRewards: this.episodeRewards,
            weightChanges: this.weightChanges,
            avgRewardLast100: this.avgRewardLast100
        };
    }

    manageMemoryUsage() {
        // Trim episode history more aggressively
        const maxHistory = 500; // Reduced from 1000
        if (this.episodeDurations.length > maxHistory) {
            this.episodeDurations = this.episodeDurations.slice(-maxHistory);
            this.episodeRewards = this.episodeRewards.slice(-maxHistory);
            this.weightChanges = this.weightChanges.slice(-maxHistory);
        }
        
        // Trim replay buffer if it's too large - more aggressive
        const bufferTarget = this.replayBufferSize;
        if (this.replayBuffer.length > bufferTarget) {
            // Keep only the most recent experiences
            this.replayBuffer = this.replayBuffer.slice(-bufferTarget);
        }
    }
    
    verifyLearning() {
    const sumW1 = this.mainNetwork.w1.reduce((a, b) => a + Math.abs(b), 0);
    const sumW2 = this.mainNetwork.w2.reduce((a, b) => a + Math.abs(b), 0);
    // compute or reuse lastWeightChange
    const weightChange = this.lastWeightChange || this.calculateWeightChange();
    return {
        sumW1,
        sumW2,
        totalSteps: this.stepCount,
        bufferSize: this.replayBuffer.length,
        weightChange
    };
    }



}




