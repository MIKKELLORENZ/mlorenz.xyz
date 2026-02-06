class ReinforcementLearning {
    constructor(drone, otherDrones = []) {
        this.drone = drone;
        this.otherDrones = otherDrones;
        
        // Learning parameters - adjusted for TD3 (Twin Delayed DDPG)
        this.actorLearningRate = 0.0003;  // Slightly lower for stability
        this.criticLearningRate = 0.001;  // Lower for TD3
        this.discountFactor = 0.99;
        this.tau = 0.005; // Soft update factor
        this.batchSize = 64;
        
        // TD3 specific parameters
        this.policyNoiseStd = 0.2;        // Target policy smoothing noise
        this.policyNoiseClip = 0.5;       // Noise clipping range
        this.policyUpdateFrequency = 2;   // Update actor every N critic updates
        this.criticUpdateCounter = 0;     // To track when to update actor

        // Additional action dimension for firing
        this.actionDimensions = 5;  // roll, pitch, yaw, thrust, fire
        
        // Noise parameters for exploration (Ornstein-Uhlenbeck process)
        this.noiseTheta = 0.15;
        this.noiseSigma = 0.2;
        this.noiseDecay = 0.9995;
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
        this.successWindow = [];       // Track recent successes for curriculum advancement
        this.successWindowSize = 10;   // Number of episodes to consider
        
        // Training targets 
        this.targetHeight = 5.0;
        this.stageProgress = 0;
        
        // Combat specific rewards and penalty settings
        this.hitReward = 50;           // Reward for hitting an enemy
        this.destroyReward = 200;      // Reward for destroying an enemy
        this.destroyedPenalty = -200;  // Penalty for being destroyed
        this.dangerProximityThreshold = 5.0; // Distance for evasion
        this.firePenaltyMisaligned = -2.0;   // Penalty for shooting when misaligned
        this.fireRewardAligned = 1.0;        // Reward for shooting when aligned 
        this.ammoConservationPenalty = -0.1; // Penalty per shot to discourage spray
        this.successfulShotsCount = 0;
        
        // Experience replay buffer
        this.replayBuffer = [];
        this.maxReplayBuffer = 10000;
        
        // Previous state storage for frame stacking
        this.prevStates = [];
        this.frameStackSize = 2;  // Stack 2 frames for temporal information
        this.prevAction = null;
        
        // Training flag
        this.isTraining = false;
        
        // Tracking stability metrics
        this.stabilityScores = [];
        
        // Wind/turbulence effects
        this.windEnabled = true;
        this.windStrength = 0.5;
        this.windDirection = new THREE.Vector3(1, 0, 0);
        this.turbulenceIntensity = 0.3;
        this.windChangeTimer = 0;
        
        // Curriculum learning - training stages
        this.trainingStage = 0; // Start with basic flight
        this.stagesConfig = [
            { name: "Basic Flight", threshold: 0.6, maxEpisodeSteps: 300, minEpisodes: 50 },
            { name: "Stability Control", threshold: 0.6, maxEpisodeSteps: 500, minEpisodes: 100 },
            { name: "Target Tracking", threshold: 0.6, maxEpisodeSteps: 800, minEpisodes: 150 },
            { name: "Combat Training", threshold: 0.6, maxEpisodeSteps: 1000, minEpisodes: 200 }
        ];
        
        // Add episode timeout for more efficient training
        this.maxEpisodeSteps = this.stagesConfig[0].maxEpisodeSteps;
        this.minEpisodesPerStage = this.stagesConfig[0].minEpisodes;
        this.episodesInCurrentStage = 0;
        
        // Prioritized experience replay parameters
        this.usePrioritizedReplay = true;
        this.priorityAlpha = 0.6;   // Priority exponent
        this.priorityBeta = 0.4;    // Importance sampling weight
        this.priorityBetaIncrement = 0.001; // Increment for beta over time
        this.priorityEpsilon = 0.01; // Small constant to avoid zero priority
        
        // Ray casting for vision checks
        this.raycaster = new THREE.Raycaster();
        
        // Initialize neural networks with proper error handling
        try {
            this.initNetworks();
        } catch (error) {
            console.error("Error initializing TensorFlow.js backend:", error);
            throw new Error("TensorFlow.js backend initialization failed.");
        }
    }
    
    initNetworks() {
        // Dynamically determine state size from a state vector
        let stateSize;
        try {
            const droneState = this.drone.getState();
            if (droneState && droneState.position) {
                const exampleState = this.getStateVector(droneState);
                stateSize = exampleState.length * this.frameStackSize; // Multiply by frame stack size
            } else {
                console.log("Creating dummy state for initialization");
                stateSize = this.createDummyStateVector().length * this.frameStackSize;
            }
        } catch (error) {
            console.warn("Error getting state during initialization:", error);
            stateSize = this.createDummyStateVector().length * this.frameStackSize;
        }
        
        const actionSize = this.actionDimensions; // 5 controls: roll, pitch, yaw, thrust, fire

        // Actor network (Policy network)
        this.actor = tf.sequential();
        this.actor.add(tf.layers.dense({
            units: 256,
            activation: 'relu',
            inputShape: [stateSize]
        }));
        this.actor.add(tf.layers.batchNormalization());
        this.actor.add(tf.layers.dense({
            units: 128,
            activation: 'relu'
        }));
        this.actor.add(tf.layers.batchNormalization());
        this.actor.add(tf.layers.dense({
            units: actionSize,
            activation: 'tanh' // Output between -1 and 1
        }));
        this.actor.compile({
            optimizer: tf.train.adam(this.actorLearningRate),
            loss: 'meanSquaredError'
        });

        // TD3 uses twin critics - create two identical critics
        // First critic network (Q1)
        this.criticState1 = tf.input({shape: [stateSize]});
        this.criticAction1 = tf.input({shape: [actionSize]});

        const c1h1 = tf.layers.dense({units: 256, activation: 'relu'}).apply(this.criticState1);
        const c1bn1 = tf.layers.batchNormalization().apply(c1h1);
        const c1h2 = tf.layers.concatenate().apply([c1bn1, this.criticAction1]);
        const c1h3 = tf.layers.dense({units: 128, activation: 'relu'}).apply(c1h2);
        const c1bn2 = tf.layers.batchNormalization().apply(c1h3);
        const critic1Output = tf.layers.dense({units: 1}).apply(c1bn2);

        this.critic1 = tf.model({
            inputs: [this.criticState1, this.criticAction1],
            outputs: critic1Output
        });
        this.critic1.compile({
            optimizer: tf.train.adam(this.criticLearningRate),
            loss: 'meanSquaredError'
        });

        // Second critic network (Q2) - identical architecture but different initialization
        this.criticState2 = tf.input({shape: [stateSize]});
        this.criticAction2 = tf.input({shape: [actionSize]});

        const c2h1 = tf.layers.dense({units: 256, activation: 'relu'}).apply(this.criticState2);
        const c2bn1 = tf.layers.batchNormalization().apply(c2h1);
        const c2h2 = tf.layers.concatenate().apply([c2bn1, this.criticAction2]);
        const c2h3 = tf.layers.dense({units: 128, activation: 'relu'}).apply(c2h2);
        const c2bn2 = tf.layers.batchNormalization().apply(c2h3);
        const critic2Output = tf.layers.dense({units: 1}).apply(c2bn2);

        this.critic2 = tf.model({
            inputs: [this.criticState2, this.criticAction2],
            outputs: critic2Output
        });
        this.critic2.compile({
            optimizer: tf.train.adam(this.criticLearningRate),
            loss: 'meanSquaredError'
        });

        // Target networks for TD3
        // Create target actor with identical structure
        this.targetActor = tf.sequential();
        this.targetActor.add(tf.layers.dense({
            units: 256,
            activation: 'relu',
            inputShape: [stateSize]
        }));
        this.targetActor.add(tf.layers.batchNormalization());
        this.targetActor.add(tf.layers.dense({
            units: 128,
            activation: 'relu'
        }));
        this.targetActor.add(tf.layers.batchNormalization());
        this.targetActor.add(tf.layers.dense({
            units: actionSize,
            activation: 'tanh'
        }));

        // Target critic 1 with identical structure
        const targetCriticState1 = tf.input({shape: [stateSize]});
        const targetCriticAction1 = tf.input({shape: [actionSize]});

        const tc1h1 = tf.layers.dense({units: 256, activation: 'relu'}).apply(targetCriticState1);
        const tc1bn1 = tf.layers.batchNormalization().apply(tc1h1);
        const tc1h2 = tf.layers.concatenate().apply([tc1bn1, targetCriticAction1]);
        const tc1h3 = tf.layers.dense({units: 128, activation: 'relu'}).apply(tc1h2);
        const tc1bn2 = tf.layers.batchNormalization().apply(tc1h3);
        const targetCritic1Output = tf.layers.dense({units: 1}).apply(tc1bn2);

        this.targetCritic1 = tf.model({
            inputs: [targetCriticState1, targetCriticAction1],
            outputs: targetCritic1Output
        });

        // Target critic 2 with identical structure
        const targetCriticState2 = tf.input({shape: [stateSize]});
        const targetCriticAction2 = tf.input({shape: [actionSize]});

        const tc2h1 = tf.layers.dense({units: 256, activation: 'relu'}).apply(targetCriticState2);
        const tc2bn1 = tf.layers.batchNormalization().apply(tc2h1);
        const tc2h2 = tf.layers.concatenate().apply([tc2bn1, targetCriticAction2]);
        const tc2h3 = tf.layers.dense({units: 128, activation: 'relu'}).apply(tc2h2);
        const tc2bn2 = tf.layers.batchNormalization().apply(tc2h3);
        const targetCritic2Output = tf.layers.dense({units: 1}).apply(tc2bn2);

        this.targetCritic2 = tf.model({
            inputs: [targetCriticState2, targetCriticAction2],
            outputs: targetCritic2Output
        });

        // Initialize target networks with same weights
        this.updateTargetNetworks(1.0); // Full copy for initial weights
    }
    
    createDummyStateVector() {
        // Create a dummy state vector with the same structure as the real one
        // For body-frame representation, we need 16 values
        // We don't include world position, only relative measurements
        const dummyState = new Array(16).fill(0);
        return dummyState;
    }
    
    updateTargetNetworks(tau = this.tau) {
        // Soft update target networks using tf.tidy for memory management
        tf.tidy(() => {
            // Update actor weights
            const actorWeights = this.actor.getWeights();
            const targetActorWeights = this.targetActor.getWeights();
            
            const updatedActorWeights = actorWeights.map((weight, i) => {
                return tf.add(
                    tf.mul(targetActorWeights[i], 1 - tau),
                    tf.mul(weight, tau)
                );
            });
            this.targetActor.setWeights(updatedActorWeights);
            
            // Update critic 1 weights
            const critic1Weights = this.critic1.getWeights();
            const targetCritic1Weights = this.targetCritic1.getWeights();
            
            const updatedCritic1Weights = critic1Weights.map((weight, i) => {
                return tf.add(
                    tf.mul(targetCritic1Weights[i], 1 - tau),
                    tf.mul(weight, tau)
                );
            });
            this.targetCritic1.setWeights(updatedCritic1Weights);
            
            // Update critic 2 weights
            const critic2Weights = this.critic2.getWeights();
            const targetCritic2Weights = this.targetCritic2.getWeights();
            
            const updatedCritic2Weights = critic2Weights.map((weight, i) => {
                return tf.add(
                    tf.mul(targetCritic2Weights[i], 1 - tau),
                    tf.mul(weight, tau)
                );
            });
            this.targetCritic2.setWeights(updatedCritic2Weights);
        });
    }
    
    getStateVector(droneState) {
        // Body-frame representation instead of world-frame
        // This makes the state more invariant to position in the arena
        
        // Extract basic drone state
        const bodyState = [];
        
        // 1. Normalized height and height error
        const targetHeightError = (this.targetHeight - droneState.position.y) / 15;
        bodyState.push(droneState.position.y / 15);  // Current height normalized
        bodyState.push(targetHeightError);          // Error to target height
        
        // 2. Rotation (tilt) - already in body frame
        bodyState.push(droneState.rotation.x / Math.PI);  // Roll
        bodyState.push(droneState.rotation.z / Math.PI);  // Pitch
        
        // 3. Velocity in body frame (convert from world frame)
        // Create rotation matrix from quaternion
        const worldVelocity = droneState.velocity.clone();
        const inverseQuaternion = this.drone.quaternion.clone().invert();
        const bodyVelocity = worldVelocity.applyQuaternion(inverseQuaternion);
        
        // Normalize by reasonable max speeds
        bodyState.push(bodyVelocity.x / 10);  // X velocity in body frame
        bodyState.push(bodyVelocity.y / 10);  // Y velocity in body frame
        bodyState.push(bodyVelocity.z / 10);  // Z velocity in body frame
        
        // 4. Angular velocity
        bodyState.push(droneState.angularVelocity.x / 5);
        bodyState.push(droneState.angularVelocity.y / 5);
        bodyState.push(droneState.angularVelocity.z / 5);
        
        // 5. Information about nearest drone (in body frame)
        if (droneState.nearestDroneDistance !== null) {
            // Convert world-space direction to body-space direction
            const worldDirection = droneState.nearestDroneDirection.clone();
            const bodyDirection = worldDirection.applyQuaternion(inverseQuaternion);
            
            // Add relative position information (normalized)
            bodyState.push(droneState.nearestDroneDistance / this.drone.maxDetectionRange);
            bodyState.push(bodyDirection.x);  // X direction in body frame
            bodyState.push(bodyDirection.y);  // Y direction in body frame 
            bodyState.push(bodyDirection.z);  // Z direction in body frame
            
            // Check if target is visible using raycasting (handles occlusion)
            const isVisible = this.checkTargetVisibility(droneState.nearestDrone);
            bodyState.push(isVisible ? 1.0 : 0.0);
        } else {
            // No drone detected - add zeros
            bodyState.push(1.0);  // Max distance
            bodyState.push(0.0);  // No direction
            bodyState.push(0.0);
            bodyState.push(0.0);
            bodyState.push(0.0);  // Not visible
        }
        
        // 6. Weapon cooldown status (normalized)
        bodyState.push(droneState.weaponCooldown / this.drone.weaponCooldownTime);
        
        return bodyState;
    }
    
    checkTargetVisibility(targetDrone) {
        if (!targetDrone) return false;
        
        // Get positions
        const origin = this.drone.position.clone();
        const target = targetDrone.position.clone();
        
        // Direction to target
        const direction = new THREE.Vector3().subVectors(target, origin).normalize();
        
        // Set up raycaster
        this.raycaster.set(origin, direction);
        
        // Find all objects in the ray's path
        const wallObjects = [];
        this.drone.scene.traverseVisible(obj => {
            if (obj.isMesh && obj !== this.drone.mesh && obj !== targetDrone.mesh &&
                !this.drone.projectiles.some(p => p.mesh === obj) &&
                !targetDrone.projectiles.some(p => p.mesh === obj)) {
                wallObjects.push(obj);
            }
        });
        
        const intersects = this.raycaster.intersectObjects(wallObjects);
        
        // Calculate distance to target
        const distanceToTarget = origin.distanceTo(target);
        
        // Check if ray hits any object before reaching target
        if (intersects.length > 0 && intersects[0].distance < distanceToTarget) {
            return false; // Target is occluded
        }
        
        return true; // Target is visible
    }
    
    getOUNoise() {
        // Ornstein-Uhlenbeck process for better exploration in continuous action space
        for (let i = 0; i < this.noiseState.length; i++) {
            const dx = this.noiseTheta * (0 - this.noiseState[i]) + 
                      this.noiseSigma * (Math.random() * 2 - 1);
            this.noiseState[i] += dx;
        }
        return this.noiseState.map(n => n * this.noiseScale);
    }
    
    getAction(state, explore = true) {
        // Convert to tensor
        const stateTensor = tf.tensor2d([state], [1, state.length]);
        let action;
        
        // Get action from actor network
        action = tf.tidy(() => {
            const actionTensor = this.actor.predict(stateTensor);
            const data = actionTensor.dataSync();
            return Array.from(data);
        });
        
        // Add exploration noise if in training mode
        if (explore && this.isTraining) {
            const noise = this.getOUNoise();
            // Apply noise with decay to all actions except fire
            for (let i = 0; i < action.length - 1; i++) {
                action[i] = Math.max(-1, Math.min(1, action[i] + noise[i]));
            }
            
            // For fire action (last dimension), use a different approach
            // During early exploration, we want more random firing to collect diverse experiences
            if (this.noiseScale > 0.3) {
                // More random firing during high exploration phases
                action[action.length - 1] = Math.random() * 2 - 1;
            } else {
                // As exploration decreases, apply noise to fire action too
                action[action.length - 1] = Math.max(-1, Math.min(1, action[action.length - 1] + noise[action.length - 1]));
            }
            
            // Decay noise scale
            this.noiseScale = Math.max(this.noiseMin, this.noiseScale * this.noiseDecay);
        }
        
        // Release tensor
        stateTensor.dispose();
        return action;
    }
    
    calculateReward(droneState, action) {
        // Get the firing action (last element of action array)
        const fireAction = action ? action[action.length - 1] : 0;
        const isFiring = fireAction > 0;
        
        // Basic reward setup that gets shaped based on training stage
        let reward = 0;
        
        // Base reward depends on training stage
        if (this.trainingStage === 0) {
            // Stage 1: Basic Flight - focus on stable hovering
            
            // Survival reward (small bonus for each step survived)
            reward += 0.1;
            
            // Height control reward (exponential decay based on distance from target height)
            const heightError = Math.abs(droneState.position.y - this.targetHeight);
            const heightReward = 2.0 * Math.exp(-heightError * 0.5);
            reward += heightReward;
            
            // Penalize extreme tilting (encourages stable flight)
            const tiltPenalty = Math.abs(droneState.rotation.x) + Math.abs(droneState.rotation.z);
            reward -= tiltPenalty * 0.5;
            
            // Small penalty for excessive velocity (encourages smooth flight)
            const speedPenalty = droneState.velocity.length() * 0.05;
            reward -= speedPenalty;
            
            // Energy penalty to encourage efficiency
            if (action) {
                const thrustAction = (action[3] + 1) / 2; // Convert from [-1,1] to [0,1]
                const thrustPenalty = 0.02 * thrustAction;
                reward -= thrustPenalty;
            }
            
        } else if (this.trainingStage === 1) {
            // Stage 2: Stability Control - focus on controlled movement
            
            // Base survival reward
            reward += 0.1;
            
            // Height control (less strict than stage 1)
            const heightError = Math.abs(droneState.position.y - this.targetHeight);
            reward += Math.exp(-heightError * 0.3);
            
            // Encourage slow, deliberate movement
            const horizontalSpeed = Math.sqrt(
                droneState.velocity.x * droneState.velocity.x + 
                droneState.velocity.z * droneState.velocity.z
            );
            
            // Small reward for moving horizontally (but not too fast)
            if (horizontalSpeed > 0.2 && horizontalSpeed < 3.0) {
                reward += 0.2;
            }
            
            // Still penalize extreme tilts, but less severely
            const tiltPenalty = Math.abs(droneState.rotation.x) + Math.abs(droneState.rotation.z);
            reward -= tiltPenalty * 0.3;
            
            // Energy penalty
            if (action) {
                const thrustAction = (action[3] + 1) / 2; // Convert from [-1,1] to [0,1]
                const thrustPenalty = 0.02 * thrustAction;
                reward -= thrustPenalty;
            }
            
        } else if (this.trainingStage === 2) {
            // Stage 3: Target Tracking - focus on finding and facing other drones
            
            // Base survival reward
            reward += 0.05;
            
            // Basic flight still rewarded but less important
            const heightError = Math.abs(droneState.position.y - this.targetHeight);
            reward += Math.exp(-heightError * 0.2) * 0.5;
            
            // Primary reward is for detecting and tracking other drones
            if (droneState.nearestDroneDistance !== null) {
                // Reward for maintaining a good distance to target (not too close, not too far)
                const optimalDistance = 10.0;
                const distanceError = Math.abs(droneState.nearestDroneDistance - optimalDistance);
                reward += Math.exp(-distanceError * 0.2) * 2.0;
                
                // Extra reward for keeping target in front
                const droneForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.drone.quaternion);
                const targetAlignment = droneForward.dot(droneState.nearestDroneDirection);
                
                // Use cos^2 error instead of cos - gives gradient both sides of 0°
                const alignmentScore = Math.pow(targetAlignment, 2);
                reward += alignmentScore * 3.0;
                
                // Penalty for firing when misaligned or reward for firing when aligned
                if (isFiring) {
                    // Check if target is aligned enough for firing
                    if (targetAlignment > 0.9) {
                        reward += this.fireRewardAligned;
                    } else {
                        // Misaligned shot
                        reward += this.firePenaltyMisaligned;
                    }
                    // Ammo conservation penalty
                    reward += this.ammoConservationPenalty;
                }
            } else {
                // Small penalty for not finding any targets
                reward -= 0.1;
                
                // Penalty for firing when no target
                if (isFiring) {
                    reward += this.firePenaltyMisaligned;
                    reward += this.ammoConservationPenalty;
                }
            }
            
        } else if (this.trainingStage >= 3) {
            // Stage 4: Combat Training - full dogfighting scenario
            
            // Minimal base reward
            reward += 0.01;
            
            if (droneState.nearestDroneDistance !== null) {
                // Target tracking reward
                const droneForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.drone.quaternion);
                const targetAlignment = droneForward.dot(droneState.nearestDroneDirection);
                
                // Use cos^2 for alignment reward
                const alignmentScore = Math.pow(targetAlignment, 2);
                reward += alignmentScore * 2.0;
                
                // Very high reward for good alignment (aiming)
                if (targetAlignment > 0.9) {
                    reward += 1.0;
                    
                    // Extra reward for shooting while well-aligned
                    if (isFiring) {
                        reward += this.fireRewardAligned;
                    }
                } else if (targetAlignment > 0.7) {
                    // Moderate reward for decent alignment
                    reward += 0.5;
                    
                    // Small reward for shooting at moderate alignment
                    if (isFiring) {
                        reward += this.fireRewardAligned * 0.5;
                    }
                } else if (isFiring) {
                    // Penalty for shooting when badly aligned
                    reward += this.firePenaltyMisaligned;
                }
                
                // Ammo conservation penalty whenever firing
                if (isFiring) {
                    reward += this.ammoConservationPenalty;
                }
                
                // Evasive maneuvers reward - when enemy is behind us, reward for turning quickly
                const enemyBehind = targetAlignment < -0.7;
                if (enemyBehind) {
                    // Reward for angular velocity (turning to face enemy)
                    const turnRate = Math.abs(droneState.angularVelocity.y);
                    reward += turnRate * 0.2;
                }
                
                // Strategic positioning reward - maintain optimal distance
                const optimalDistance = 8.0;
                const distanceError = Math.abs(droneState.nearestDroneDistance - optimalDistance);
                reward += Math.exp(-distanceError * 0.1);
                
                // Health-based reward
                reward += (droneState.health / 100) * 0.1;
            } else {
                // Penalty for not finding any targets
                reward -= 0.5;
                
                // Penalty for firing when no target
                if (isFiring) {
                    reward += this.firePenaltyMisaligned;
                    reward += this.ammoConservationPenalty;
                }
            }
        }
        
        // Universal penalties regardless of stage
        
        // Major penalty for crashing
        if (droneState.crashed) {
            reward -= 20.0;
        }
        
        // Severe penalty for being destroyed
        if (droneState.isDestroyed) {
            reward += this.destroyedPenalty;
        }
        
        // Boundary avoidance - penalize getting too close to gym boundaries
        const marginX = 5.0; // Stay this far from x walls
        const marginZ = 5.0; // Stay this far from z walls
        const distToWallX = 30 - Math.abs(droneState.position.x);
        const distToWallZ = 20 - Math.abs(droneState.position.z);
        
        if (distToWallX < marginX) {
            reward -= (marginX - distToWallX) * 0.3;
        }
        
        if (distToWallZ < marginZ) {
            reward -= (marginZ - distToWallZ) * 0.3;
        }
        
        // Use tanh to clip reward instead of hard clipping
        // This maintains gradient information for larger rewards/penalties
        reward = 10 * Math.tanh(reward / 10);
        
        return reward;
    }
    
    applyWindForces(deltaTime) {
        if (!this.windEnabled) return;
        
        // Update wind direction occasionally
        this.windChangeTimer -= deltaTime;
        if (this.windChangeTimer <= 0) {
            this.windChangeTimer = 5 + Math.random() * 10; // Change every 5-15 seconds
            
            // Create a new direction within reasonable bounds
            const angle = Math.random() * Math.PI * 2;
            const tilt = Math.random() * 0.3; // Slight up/down component
            this.windDirection.set(
                Math.cos(angle),
                tilt - 0.15, // Mostly horizontal with slight up/down
                Math.sin(angle)
            );
            this.windDirection.normalize();
            
            // Adjust strength within bounds
            this.windStrength = 0.5 + Math.random() * 1.5; // 0.5 to 2.0
        }
        
        // Create base wind vector
        const windVector = this.windDirection.clone().multiplyScalar(this.windStrength);
        
        // Add turbulence - random variation
        if (this.turbulenceIntensity > 0) {
            const turbulence = new THREE.Vector3(
                (Math.random() * 2 - 1) * this.turbulenceIntensity,
                (Math.random() * 2 - 1) * this.turbulenceIntensity,
                (Math.random() * 2 - 1) * this.turbulenceIntensity
            );
            windVector.add(turbulence);
        }
        
        // Apply wind force to drone
        this.drone.applyExternalForce(windVector);
    }
    
    step(deltaTime) {
        // Cap delta time to avoid instability with large time steps
        const cappedDelta = Math.min(deltaTime, 0.03);
        
        if (!this.isTraining) return;
        
        // Apply wind/turbulence if enabled
        if (this.windEnabled) {
            // Only apply wind after stage 1 (basic flight)
            if (this.trainingStage > 0) {
                this.turbulenceIntensity = 0.1 + (this.trainingStage * 0.1);
                this.applyWindForces(cappedDelta);
            }
        }
        
        try {
            // Get current state
            const currentState = this.drone.getState();
            let currentStateVector = this.getStateVector(currentState);
            
            // Frame stacking - combine current state with previous states
            if (this.prevStates.length > 0) {
                currentStateVector = [...currentStateVector, ...this.prevStates[0]];
                
                // If we don't have enough previous states, duplicate the oldest one
                while (currentStateVector.length < currentStateVector.length * this.frameStackSize) {
                    const oldestState = this.prevStates[this.prevStates.length - 1] || this.prevStates[0];
                    currentStateVector = [...currentStateVector, ...oldestState];
                }
            } else {
                // If no previous states, duplicate current state
                for (let i = 1; i < this.frameStackSize; i++) {
                    currentStateVector = [...currentStateVector, ...currentStateVector.slice(0, currentStateVector.length)];
                }
            }
            
            // If we have a previous state and action, learn from it
            if (this.prevAction !== null) {
                // Calculate reward
                const reward = this.calculateReward(currentState, this.prevAction);
                this.episodeReward += reward;
                
                // Calculate stability score for visualization (based on tilt and velocity)
                const tiltMagnitude = Math.sqrt(
                    currentState.rotation.x * currentState.rotation.x + 
                    currentState.rotation.z * currentState.rotation.z
                );
                const velocityMagnitude = currentState.velocity.length();
                const stabilityScore = 1.0 - Math.min(1.0, (tiltMagnitude + velocityMagnitude * 0.1) / 2.0);
                this.stabilityScores.push(stabilityScore);
                
                // Store experience in replay buffer
                const done = currentState.crashed || 
                             currentState.isDestroyed || 
                             this.episodeStep >= this.maxEpisodeSteps;
                
                if (this.prevStates.length > 0) {
                    // Create full stacked state for experience replay
                    let prevStackedState = [...this.prevStates[0]];
                    for (let i = 1; i < this.frameStackSize - 1; i++) {
                        if (i < this.prevStates.length) {
                            prevStackedState = [...prevStackedState, ...this.prevStates[i]];
                        } else {
                            // If not enough previous states, duplicate the last one
                            prevStackedState = [...prevStackedState, ...prevStackedState.slice(-this.prevStates[0].length)];
                        }
                    }
                    
                    this.replayBuffer.push({
                        state: prevStackedState,
                        action: this.prevAction,
                        reward: reward,
                        nextState: currentStateVector,
                        done: done
                    });
                    
                    // Limit buffer size
                    if (this.replayBuffer.length > this.maxReplayBuffer) {
                        this.replayBuffer.shift(); // Remove oldest entry
                    }
                }
                
                // Train on batch periodically - only when we have enough samples
                const trainingFrequency = Math.max(1, 5 - this.trainingStage);
                if (this.replayBuffer.length >= this.batchSize && this.episodeStep % trainingFrequency === 0) {
                    this.trainOnBatch();
                }
            }
            
            // Get action for current state
            const action = this.getAction(currentStateVector);
            
            // Pass higher-level control commands to drone
            this.drone.setControlInputs(
                action[0],  // Roll
                action[1],  // Pitch
                action[2],  // Yaw
                (action[3] + 1) / 2  // Thrust (convert from [-1,1] to [0,1])
            );
            
            // Handle fire action (5th dimension)
            if (action[4] > 0 && currentState.weaponCooldown <= 0) {
                this.drone.shoot();
            }
            
            // Update previous state array (for frame stacking)
            this.prevStates.unshift(this.getStateVector(currentState));
            while (this.prevStates.length > this.frameStackSize) {
                this.prevStates.pop();
            }
            
            // Store action for next learning step
            this.prevAction = action;
            
            // Check for episode end conditions
            if (currentState.crashed || currentState.isDestroyed) {
                this.endEpisode(false);  // End with failure
                return;
            } else if (this.episodeStep >= this.maxEpisodeSteps) {
                // Episode timeout - moderate success in surviving
                this.endEpisode(true);
                return;
            }
            
            // Increment step counter if episode continues
            this.episodeStep++;
            
            // Handle combat outcomes
            for (const otherDrone of this.otherDrones) {
                // If other drone was hit by this drone since last step
                if (otherDrone.shotBy === this.drone.id && otherDrone.health < 100) {
                    // Additional immediate reward for hitting enemy
                    this.episodeReward += this.hitReward;
                    this.successfulShotsCount++;
                    
                    // Reset the shotBy to avoid counting twice
                    otherDrone.shotBy = null;
                    
                    console.log(`Drone ${this.drone.id} hit an enemy! Reward: ${this.hitReward}`);
                }
                
                // If other drone was destroyed by this drone
                if (otherDrone.isDestroyed && otherDrone.shotBy === this.drone.id) {
                    // Major reward for destroying enemy
                    this.episodeReward += this.destroyReward;
                    
                    // Reset the shotBy to avoid counting twice
                    otherDrone.shotBy = null;
                    
                    console.log(`Drone ${this.drone.id} destroyed an enemy! Reward: ${this.destroyReward}`);
                    
                    // End episode with success
                    this.endEpisode(true);
                    return;
                }
            }
        } catch (error) {
            console.error("Error in RL step:", error);
        }
    }
    
    async trainOnBatch() {
        try {
            // Sample random batch from replay buffer
            if (this.replayBuffer.length < this.batchSize) {
                console.warn(`Not enough samples in replay buffer: ${this.replayBuffer.length}/${this.batchSize}`);
                return;
            }

            const batch = this.sampleBatch();
            
            // Use async/await for TFJS operations
            await tf.tidy(async () => {
                // Prepare input tensors
                const states = tf.tensor2d(batch.map(exp => exp.state));
                const actions = tf.tensor2d(batch.map(exp => exp.action));
                const rewards = tf.tensor1d(batch.map(exp => exp.reward));
                const nextStates = tf.tensor2d(batch.map(exp => exp.nextState));
                const dones = tf.tensor1d(batch.map(exp => exp.done ? 1 : 0));
                const weights = tf.tensor1d(batch.map(exp => exp.weight || 1.0)); // For PER
                
                // TD3: Add noise to next actions (target policy smoothing)
                const noise = tf.randomNormal(
                    [this.batchSize, this.actionDimensions], 
                    0, 
                    this.policyNoiseStd
                );
                
                // Clip noise
                const clippedNoise = tf.clipByValue(noise, -this.policyNoiseClip, this.policyNoiseClip);
                
                // Get next actions from target actor with smoothing noise
                const nextActions = this.targetActor.predict(nextStates);
                const smoothedNextActions = tf.clipByValue(
                    tf.add(nextActions, clippedNoise), 
                    -1, 
                    1
                );
                
                // Get Q values from both target critics
                const targetQ1 = this.targetCritic1.predict([nextStates, smoothedNextActions]);
                const targetQ2 = this.targetCritic2.predict([nextStates, smoothedNextActions]);
                
                // TD3: Take the minimum Q value between the two critics
                const targetQ = tf.minimum(targetQ1, targetQ2);
                
                // Calculate TD targets: r + γ(1-d)min(Q1',Q2')
                const discountFactorTensor = tf.scalar(this.discountFactor);
                const oneMinusDone = tf.sub(tf.ones(dones.shape), dones);
                
                const qTargets = tf.add(
                    rewards,
                    tf.mul(
                        tf.mul(discountFactorTensor, oneMinusDone),
                        targetQ.squeeze()
                    )
                );
                
                // Expand targets back to 2D for critic training
                const qTargets2D = qTargets.expandDims(1);
                
                // Train both critics
                await this.critic1.trainOnBatch([states, actions], qTargets2D, weights);
                await this.critic2.trainOnBatch([states, actions], qTargets2D, weights);
                
                // Delayed policy updates (TD3 specific)
                this.criticUpdateCounter++;
                if (this.criticUpdateCounter % this.policyUpdateFrequency === 0) {
                    // Train the actor by maximizing estimated Q value
                    const actorGradient = tf.variableGrads(() => {
                        const actorActions = this.actor.predict(states);
                        const criticValue = this.critic1.predict([states, actorActions]);
                        // Negative because we want to maximize Q
                        return tf.mul(tf.scalar(-1), tf.sum(criticValue));
                    });
                    
                    // Apply gradients
                    this.actor.optimizer.applyGradients(actorGradient.grads);
                    
                    // Update target networks
                    this.updateTargetNetworks();
                }
            });
        } catch (error) {
            console.error("Error in trainOnBatch:", error);
        }
    }
    
    sampleBatch() {
        // If prioritized replay is enabled, use it
        if (this.usePrioritizedReplay && this.replayBuffer.length > 0) {
            return this.samplePrioritizedBatch();
        }
        
        // Otherwise use uniform sampling
        const batch = [];
        const bufferSize = this.replayBuffer.length;

        for (let i = 0; i < this.batchSize; i++) {
            const index = Math.floor(Math.random() * bufferSize);
            batch.push(this.replayBuffer[index]);
        }

        return batch;
    }
    
    // Improved binary search for prioritized experience replay
    samplePrioritizedBatch() {
        const batch = [];
        const priorities = [];
        
        // Calculate priorities based on reward magnitude
        for (let i = 0; i < this.replayBuffer.length; i++) {
            const experiencePriority = Math.abs(this.replayBuffer[i].reward) + this.priorityEpsilon;
            priorities.push(Math.pow(experiencePriority, this.priorityAlpha));
        }
        
        // Calculate sum of all priorities
        const prioritySum = priorities.reduce((sum, priority) => sum + priority, 0);
        
        // Create prefix sum array for binary search
        const prefixSums = [0];
        for (let i = 0; i < priorities.length; i++) {
            prefixSums.push(prefixSums[i] + priorities[i] / prioritySum);
        }
        
        // Binary search function for more efficient sampling
        function binarySearch(array, value) {
            let low = 0;
            let high = array.length - 1;
            
            while (low < high) {
                const mid = Math.floor((low + high) / 2);
                if (array[mid] < value) {
                    low = mid + 1;
                } else {
                    high = mid;
                }
            }
            
            return low;
        }
        
        // Sample batch using priorities
        const weights = [];
        
        for (let i = 0; i < this.batchSize; i++) {
            const r = Math.random();
            
            // Use binary search to find index
            const index = binarySearch(prefixSums, r) - 1;
            
            // Calculate importance sampling weight
            const weight = Math.pow(1.0 / (this.replayBuffer.length * (priorities[index] / prioritySum)), this.priorityBeta);
            weights.push(weight);
            
            // Add experience with weight
            const experience = {...this.replayBuffer[index]};
            experience.weight = weight;
            batch.push(experience);
        }
        
        // Normalize weights
        const maxWeight = Math.max(...weights);
        for (let i = 0; i < batch.length; i++) {
            batch[i].weight /= maxWeight;
        }
        
        // Gradually increase beta toward 1 - makes corrections less impactful over time
        this.priorityBeta = Math.min(1.0, this.priorityBeta + this.priorityBetaIncrement);
        
        return batch;
    }
    
    endEpisode(success = false) {
        // Reset OU noise state at the start of each episode
        this.noiseState = new Array(this.actionDimensions).fill(0);
        
        // Record episode statistics
        this.totalRewards.push(this.episodeReward);
        this.episodeLengths.push(this.episodeStep);
        
        // Update running average
        if (this.totalRewards.length === 1) {
            this.runningAvgReward = this.episodeReward;
        } else {
            this.runningAvgReward = 0.9 * this.runningAvgReward + 0.1 * this.episodeReward;
        }
        
        // Track success for curriculum advancement
        this.successWindow.push(success);
        if (this.successWindow.length > this.successWindowSize) {
            this.successWindow.shift();
        }
        
        console.log(`Episode ${this.episode} ended with reward: ${this.episodeReward.toFixed(2)}, steps: ${this.episodeStep}, success: ${success}`);
        
        // Reset for next episode
        this.episode++;
        this.episodeStep = 0;
        this.episodeReward = 0;
        this.prevAction = null;
        this.prevStates = [];
        
        // Clear stability scores for this episode
        this.stabilityScores = [];
        
        // Reset combat tracking
        this.successfulShotsCount = 0;
        
        // Increment episodes counter in current stage
        this.episodesInCurrentStage++;
        
        // Check if we need to advance to the next training stage - use success rate
        const successRate = this.successWindow.filter(s => s).length / this.successWindow.length;
        
        if (successRate >= this.stagesConfig[this.trainingStage].threshold && 
            this.episodesInCurrentStage >= this.stagesConfig[this.trainingStage].minEpisodes &&
            this.trainingStage < this.stagesConfig.length - 1) {
            
            this.trainingStage++;
            
            // Update max episode steps for new stage
            this.maxEpisodeSteps = this.stagesConfig[this.trainingStage].maxEpisodeSteps;
            this.minEpisodesPerStage = this.stagesConfig[this.trainingStage].minEpisodes;
            this.episodesInCurrentStage = 0;
            
            console.log(`Advancing to training stage ${this.trainingStage + 1}: ${this.stagesConfig[this.trainingStage].name}`);
            
            // Increase exploration when entering a new stage (to learn new skills)
            this.noiseScale = Math.min(1.0, this.noiseScale * 2);
            
            // Reset replay buffer when moving to a new stage to avoid conflicting policies
            if (this.trainingStage > 1) { // Keep some experience for stages 0->1
                console.log("Clearing replay buffer for new stage");
                this.replayBuffer = [];
            }
        }
    }
    
    startTraining() {
        this.isTraining = true;
        console.log("Training started in unified mode");
    }
    
    stopTraining() {
        this.isTraining = false;
        console.log("Training stopped");
    }
    
    getStats() {
        return {
            episode: this.episode,
            totalRewards: this.totalRewards,
            episodeLengths: this.episodeLengths,
            runningAvgReward: this.runningAvgReward,
            explorationRate: this.noiseScale, // For compatibility with existing charts
            stabilityScores: this.stabilityScores,
            stageProgress: this.stageProgress,
            trainingStage: this.trainingStage, // Added for new stage chart
            successRate: this.successWindow.filter(s => s).length / Math.max(1, this.successWindow.length)
        };
    }
    
    saveModel() {
        // Would save the model to file
        console.log("Model saving is not implemented in this browser demo");
    }
    
    loadModel() {
        // Would load the model from file
        console.log("Model loading is not implemented in this browser demo");
    }
}
