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

        // Double DQN / target update
        this.stepCount = 0;
        this.tau = 0.005;          // soft update every step

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
        
        // Add small epsilon-greedy even when exploiting to prevent getting stuck
        if (Math.random() < 0.05) {
            const alternatives = [Math.max(0, best - 1), best, Math.min(this.outputSize - 1, best + 1)];
            return this.indexToAction(alternatives[Math.floor(Math.random() * alternatives.length)]);
        }
        return this.indexToAction(best);
    }

    addExperience(state, action, reward, nextState, done) {
        if (this.replayBuffer.length >= this.replayBufferSize) this.replayBuffer.shift();
        this.replayBuffer.push({
            state: { ...state },
            action, reward,
            nextState: { ...nextState },
            done
        });
    }

    sampleBatch() {
        if (this.replayBuffer.length < this.minReplaySize) return null;
        const batch = new Array(this.batchSize);
        for (let i = 0; i < this.batchSize; i++) {
            batch[i] = this.replayBuffer[Math.floor(Math.random() * this.replayBuffer.length)];
        }
        return batch;
    }

    // Huber loss gradient
    _huberGrad(error, delta = 1.0) {
        const a = Math.abs(error);
        return a <= delta ? error : Math.sign(error) * delta;
    }

    trainOnBatch(batch) {
        if (!batch) return 0;

        // Accumulate grads
        const gW1 = new Array(this.mainNetwork.w1.length).fill(0);
        const gB1 = new Array(this.mainNetwork.b1.length).fill(0);
        const gW2 = new Array(this.mainNetwork.w2.length).fill(0);
        const gB2 = new Array(this.mainNetwork.b2.length).fill(0);

        let totalLoss = 0;

        for (const exp of batch) {
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

            // Huber loss on the chosen action output only; others target themselves
            const targetVec = qCurrent.slice();
            targetVec[aIdx] = target;

            // Backprop (one pass)
            const hidden = fMain.hidden;
            const input = fMain.input;

            // Output layer grads
            const outputError = new Array(this.outputSize).fill(0);
            for (let i = 0; i < this.outputSize; i++) {
                const err = (qCurrent[i] - targetVec[i]);
                const grad = this._huberGrad(err); // dL/dQ
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

        // Apply grads with Adam
        this.adamStep++;
        const t = this.adamStep;
        const lr = this.learningRate;
        const b1 = this.adamBeta1, b2 = this.adamBeta2, eps = this.adamEps;
        const clip = g => Math.max(-5, Math.min(5, g));

        // w1
        for (let i = 0; i < this.mainNetwork.w1.length; i++) {
            const grad = clip(gW1[i] / batch.length);
            this.opt.w1m[i] = b1 * this.opt.w1m[i] + (1 - b1) * grad;
            this.opt.w1v[i] = b2 * this.opt.w1v[i] + (1 - b2) * grad * grad;
            const mHat = this.opt.w1m[i] / (1 - Math.pow(b1, t));
            const vHat = this.opt.w1v[i] / (1 - Math.pow(b2, t));
            this.mainNetwork.w1[i] -= lr * mHat / (Math.sqrt(vHat) + eps);
        }
        // b1
        for (let i = 0; i < this.mainNetwork.b1.length; i++) {
            const grad = clip(gB1[i] / batch.length);
            this.opt.b1m[i] = b1 * this.opt.b1m[i] + (1 - b1) * grad;
            this.opt.b1v[i] = b2 * this.opt.b1v[i] + (1 - b2) * grad * grad;
            const mHat = this.opt.b1m[i] / (1 - Math.pow(b1, t));
            const vHat = this.opt.b1v[i] / (1 - Math.pow(b2, t));
            this.mainNetwork.b1[i] -= lr * mHat / (Math.sqrt(vHat) + eps);
        }
        // w2
        for (let i = 0; i < this.mainNetwork.w2.length; i++) {
            const grad = clip(gW2[i] / batch.length);
            this.opt.w2m[i] = b1 * this.opt.w2m[i] + (1 - b1) * grad;
            this.opt.w2v[i] = b2 * this.opt.w2v[i] + (1 - b2) * grad * grad;
            const mHat = this.opt.w2m[i] / (1 - Math.pow(b1, t));
            const vHat = this.opt.w2v[i] / (1 - Math.pow(b2, t));
            this.mainNetwork.w2[i] -= lr * mHat / (Math.sqrt(vHat) + eps);
        }
        // b2
        for (let i = 0; i < this.mainNetwork.b2.length; i++) {
            const grad = clip(gB2[i] / batch.length);
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
                const batch = this.sampleBatch();
                this.trainOnBatch(batch);
                this.softUpdateTarget();
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
        if (this.episodeDurations.length > 2000) {
            this.episodeDurations = this.episodeDurations.slice(-1000);
            this.episodeRewards = this.episodeRewards.slice(-1000);
            this.weightChanges = this.weightChanges.slice(-1000);
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




