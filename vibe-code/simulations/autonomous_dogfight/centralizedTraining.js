class CentralizedTraining {
    constructor(rlAgents) {
        this.rlAgents = rlAgents || [];
        this.isActive = false;
        
        this.rewardHistory = [];
        this.maxRewardHistorySize = 1000;
        
        this.globalCriticUpdateFrequency = 4;
        this.updateCounter = 0;
        
        this.centralizedGamma = 0.99;
        this.jointExplorationBonus = 0.2;
        
        // Soft weight sharing between agents
        this.weightShareFrequency = 100;
        this.weightShareBlend = 0.01;
        
        console.log(`Centralized training system initialized with ${this.rlAgents.length} agents`);
    }
    
    activate() {
        if (!this.rlAgents || this.rlAgents.length === 0) return;
        this.isActive = true;
        
        const avgNoiseScale = this.rlAgents.reduce((sum, a) => sum + (a.noiseScale || 0), 0) / this.rlAgents.length;
        for (const agent of this.rlAgents) agent.noiseScale = avgNoiseScale;
        
        console.log("Centralized training activated");
    }
    
    deactivate() {
        this.isActive = false;
        console.log("Centralized training deactivated");
    }
    
    step(deltaTime) {
        if (!this.isActive || !this.rlAgents || this.rlAgents.length === 0) return;
        
        this.updateCounter++;
        this.coordinateExploration();
        this.normalizeRewards();
        
        if (this.updateCounter % this.globalCriticUpdateFrequency === 0) {
            this.updateSharedCritic();
        }
        
        // Periodic soft weight sharing between agents
        if (this.updateCounter % this.weightShareFrequency === 0) {
            this.shareWeights(this.weightShareBlend);
        }
    }
    
    reset() {
        this.updateCounter = 0;
    }
    
    coordinateExploration() {
        if (!this.rlAgents || this.rlAgents.length < 2) return;
        
        const positions = this.rlAgents.map(a => a.drone && a.drone.position ? a.drone.position.clone() : new THREE.Vector3());
        
        if (this.checkAgentsProximity(positions)) {
            for (let i = 1; i < this.rlAgents.length; i++) {
                if (this.rlAgents[i].noiseState) {
                    this.rlAgents[i].noiseState = this.rlAgents[i].noiseState.map(
                        n => n + (Math.random() * 2 - 1) * this.jointExplorationBonus
                    );
                }
            }
        }
    }
    
    checkAgentsProximity(positions) {
        for (let i = 0; i < positions.length; i++) {
            for (let j = i + 1; j < positions.length; j++) {
                if (positions[i].distanceTo(positions[j]) < 5.0) return true;
            }
        }
        return false;
    }
    
    normalizeRewards() {
        for (const agent of this.rlAgents) {
            if (!agent || !agent.totalRewards || agent.totalRewards.length === 0) continue;
            const latestReward = agent.totalRewards[agent.totalRewards.length - 1];
            this.rewardHistory.push(latestReward);
            if (this.rewardHistory.length > this.maxRewardHistorySize) this.rewardHistory.shift();
        }
        
        if (this.rewardHistory.length > 10) {
            const mean = this.rewardHistory.reduce((a, b) => a + b, 0) / this.rewardHistory.length;
            const variance = this.rewardHistory.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / this.rewardHistory.length;
            const stdDev = Math.sqrt(variance);
            
            for (const agent of this.rlAgents) {
                if (!agent) continue;
                agent.rewardMean = mean;
                agent.rewardStdDev = stdDev;
                
                if (stdDev > 0 && stdDev < 100) {
                    const adaptiveFactor = 1.0 / (1.0 + stdDev / 50.0);
                    if (agent.actor && agent.actor.optimizer) {
                        agent.actor.optimizer.learningRate = agent.actorLearningRate * adaptiveFactor;
                    }
                    if (agent.critic1 && agent.critic1.optimizer) {
                        agent.critic1.optimizer.learningRate = agent.criticLearningRate * adaptiveFactor;
                    }
                    if (agent.critic2 && agent.critic2.optimizer) {
                        agent.critic2.optimizer.learningRate = agent.criticLearningRate * adaptiveFactor;
                    }
                }
            }
        }
    }
    
    updateSharedCritic() {
        if (!this.rlAgents || this.rlAgents.length < 2) return;
        
        try {
            const jointBatch = [];
            const batchSize = Math.min(16, Math.floor((this.rlAgents[0].batchSize || 64) / 2));
            
            for (const agent of this.rlAgents) {
                if (!agent || !agent.replayBuffer || agent.replayBuffer.length <= batchSize) continue;
                jointBatch.push(...this.sampleFromAgent(agent, batchSize));
            }
            
            if (jointBatch.length >= batchSize) {
                for (const exp of jointBatch) exp.isCentralized = true;
                
                // Push shared experiences to ALL agents (bidirectional)
                for (const agent of this.rlAgents) {
                    if (!agent || !agent.replayBuffer) continue;
                    for (const exp of jointBatch) {
                        agent.replayBuffer.push({ ...exp });
                        if (agent.replayBuffer.length > agent.maxReplayBuffer) {
                            agent.replayBuffer.shift();
                        }
                    }
                }
            }
        } catch (err) {
            console.error("Error in centralized critic update:", err);
        }
    }
    
    sampleFromAgent(agent, count) {
        if (!agent || !agent.replayBuffer || agent.replayBuffer.length < count) return [];
        
        const samples = [];
        for (let i = 0; i < count; i++) {
            const idx = Math.floor(Math.random() * agent.replayBuffer.length);
            samples.push({ ...agent.replayBuffer[idx] });
        }
        return samples;
    }
    
    /**
     * Soft weight averaging: each agent's networks blend toward the other's.
     * This lets both drones benefit from each other's discoveries (e.g. if one
     * learns to hover first, the other inherits that knowledge).
     */
    shareWeights(blendRatio = 0.01) {
        if (!this.rlAgents || this.rlAgents.length < 2) return;
        try {
            const blendPair = (netA, netB) => {
                const wA = netA.getWeights();
                const wB = netB.getWeights();
                if (wA.length !== wB.length) return;
                const newA = [], newB = [];
                for (let i = 0; i < wA.length; i++) {
                    newA.push(tf.tidy(() => tf.add(tf.mul(wA[i], 1 - blendRatio), tf.mul(wB[i], blendRatio))));
                    newB.push(tf.tidy(() => tf.add(tf.mul(wB[i], 1 - blendRatio), tf.mul(wA[i], blendRatio))));
                }
                netA.setWeights(newA);
                netB.setWeights(newB);
                newA.forEach(t => t.dispose());
                newB.forEach(t => t.dispose());
            };
            // Share actor weights (policy transfer) and critic weights (value alignment)
            for (let i = 0; i < this.rlAgents.length; i++) {
                for (let j = i + 1; j < this.rlAgents.length; j++) {
                    blendPair(this.rlAgents[i].actor, this.rlAgents[j].actor);
                    blendPair(this.rlAgents[i].critic1, this.rlAgents[j].critic1);
                    blendPair(this.rlAgents[i].critic2, this.rlAgents[j].critic2);
                }
            }
        } catch (e) {
            console.error("Weight sharing error:", e);
        }
    }
}
