class CentralizedTraining {
    constructor(rlAgents) {
        this.rlAgents = rlAgents;
        this.isActive = false;
        
        // Rewards buffer for normalization
        this.rewardHistory = [];
        this.maxRewardHistorySize = 1000;
        
        // Shared Q-values for multi-agent training
        this.globalCriticUpdateFrequency = 4; // Update shared critic every N steps
        this.updateCounter = 0;
        
        // Parameters for centralized training
        this.centralizedGamma = 0.99; // Discount factor for joint actions
        this.jointExplorationBonus = 0.2; // Bonus for coordinated exploration
        
        console.log(`Centralized training system initialized with ${rlAgents.length} agents`);
    }
    
    // Activate centralized training
    activate() {
        this.isActive = true;
        
        // Sync exploration parameters across agents
        const avgNoiseScale = this.rlAgents.reduce((sum, agent) => sum + agent.noiseScale, 0) / this.rlAgents.length;
        
        for (const agent of this.rlAgents) {
            agent.noiseScale = avgNoiseScale;
        }
        
        console.log("Centralized training activated");
    }
    
    // Deactivate centralized training
    deactivate() {
        this.isActive = false;
        console.log("Centralized training deactivated");
    }
    
    // Update shared critic and coordinate agent training
    step(deltaTime) {
        if (!this.isActive) return;
        
        // Increment update counter
        this.updateCounter++;
        
        // Coordinate exploration (encourage diverse strategies)
        this.coordinateExploration();
        
        // Normalize rewards across agents for balanced learning
        this.normalizeRewards();
        
        // Share experience between agents
        if (this.updateCounter % this.globalCriticUpdateFrequency === 0) {
            this.updateSharedCritic();
        }
    }
    
    // Reset centralized training state
    reset() {
        this.updateCounter = 0;
    }
    
    // Coordinate exploration strategies between agents
    coordinateExploration() {
        // Find agents that are exploring similar regions
        const positions = this.rlAgents.map(agent => agent.drone.position.clone());
        const tooClose = this.checkAgentsProximity(positions);
        
        // If agents are too close, encourage them to explore differently
        if (tooClose) {
            for (let i = 1; i < this.rlAgents.length; i++) {
                // Add some random noise to the second agent to encourage separation
                this.rlAgents[i].noiseState = this.rlAgents[i].noiseState.map(
                    n => n + (Math.random() * 2 - 1) * this.jointExplorationBonus
                );
            }
        }
    }
    
    // Check if agents are too close to each other
    checkAgentsProximity(positions) {
        // For simplicity, just check distances between all pairs of agents
        for (let i = 0; i < positions.length; i++) {
            for (let j = i + 1; j < positions.length; j++) {
                const distance = positions[i].distanceTo(positions[j]);
                
                // Consider "too close" if within 5 units and not in dogfight mode
                if (distance < 5.0 && !window.dogfightMode) {
                    return true;
                }
            }
        }
        return false;
    }
    
    // Normalize rewards across agents to prevent one agent from dominating the learning
    normalizeRewards() {
        // Collect recent rewards from all agents
        for (const agent of this.rlAgents) {
            if (agent.totalRewards.length > 0) {
                const latestReward = agent.totalRewards[agent.totalRewards.length - 1];
                this.rewardHistory.push(latestReward);
                
                // Limit history size
                if (this.rewardHistory.length > this.maxRewardHistorySize) {
                    this.rewardHistory.shift();
                }
            }
        }
        
        // Calculate statistics for normalization
        if (this.rewardHistory.length > 10) {
            const mean = this.rewardHistory.reduce((a, b) => a + b, 0) / this.rewardHistory.length;
            
            // Calculate standard deviation
            const variance = this.rewardHistory.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / this.rewardHistory.length;
            const stdDev = Math.sqrt(variance);
            
            // Apply normalization to critic networks
            // We don't directly modify the rewards, but adjust the critic network's scale
            for (const agent of this.rlAgents) {
                // Store normalization parameters on agent for use during training
                agent.rewardMean = mean;
                agent.rewardStdDev = stdDev;
                
                // Adaptive learning rates based on reward variance
                if (stdDev > 0 && stdDev < 100) {
                    // If rewards are very variable, reduce learning rate for stability
                    const adaptiveFactor = 1.0 / (1.0 + stdDev / 50.0);
                    
                    // Apply to actor and critic with different scales
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
    
    // Update shared critic network with experiences from all agents
    updateSharedCritic() {
        if (this.rlAgents.length < 2) return;
        
        try {
            // Create a joint batch from all agents
            const jointBatch = [];
            const batchSize = Math.min(16, Math.floor(this.rlAgents[0].batchSize / 2));
            
            // Get samples from each agent
            for (const agent of this.rlAgents) {
                if (agent.replayBuffer.length > batchSize) {
                    // Sample experiences from this agent
                    const agentBatch = this.sampleFromAgent(agent, batchSize);
                    jointBatch.push(...agentBatch);
                }
            }
            
            // If we collected enough samples, perform joint update
            if (jointBatch.length >= batchSize) {
                // Perform joint critic update
                // For simplicity, we use the first agent's critic for the update
                const primaryAgent = this.rlAgents[0];
                
                // Tag the joint batch as coming from centralized training
                for (const exp of jointBatch) {
                    exp.isCentralized = true;
                }
                
                // Add to primary agent's replay buffer with high priority
                jointBatch.forEach(exp => {
                    // Skip if already in buffer to avoid duplicates
                    if (!primaryAgent.replayBuffer.some(e => 
                        e.state === exp.state && 
                        e.action === exp.action && 
                        e.nextState === exp.nextState)) {
                        
                        primaryAgent.replayBuffer.push(exp);
                        
                        // Maintain buffer size
                        if (primaryAgent.replayBuffer.length > primaryAgent.maxReplayBuffer) {
                            primaryAgent.replayBuffer.shift();
                        }
                    }
                });
                
                // The actual training happens during the agent's normal training cycle
                // This ensures that the joint experiences are part of the training process
            }
        } catch (err) {
            console.error("Error in centralized critic update:", err);
        }
    }
    
    // Sample experiences from an agent's replay buffer
    sampleFromAgent(agent, count) {
        if (agent.replayBuffer.length < count) {
            return [];
        }
        
        // Sample random experiences
        const samples = [];
        for (let i = 0; i < count; i++) {
            const randomIndex = Math.floor(Math.random() * agent.replayBuffer.length);
            samples.push({...agent.replayBuffer[randomIndex]});
        }
        
        return samples;
    }
}