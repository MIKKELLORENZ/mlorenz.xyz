/* ========================================
   TIME IT! - Levels System
   Progressively harder missions
   ======================================== */

const LEVELS = [
    // ============ LEVEL 1 - Tutorial Hoop ============
    {
        id: 1,
        name: "First Flight",
        description: "Your first mission: Launch through the hoop! Just add an engine and go.",
        objectiveType: "hoop",
        target: {
            x: 0,           // Centered
            y: 300,         // Low target - easy to reach
            radius: 100     // Large hoop for beginners
        },
        difficulty: 1,
        budget: 200,        // Starting budget
        bonusCredits: 80,
        perfectBonus: 40,
        maxTime: 25,
        hints: [
            "Add a Basic Thruster or Solid Booster",
            "Timing 0 means instant ignition",
            "Fly straight up through the hoop!"
        ]
    },
    
    // ============ LEVEL 2 - Higher Hoop ============
    {
        id: 2,
        name: "Reaching Higher",
        description: "The hoop is higher now. Use your engine efficiently!",
        objectiveType: "hoop",
        target: {
            x: 0,
            y: 500,
            radius: 90
        },
        difficulty: 2,
        budget: 250,
        bonusCredits: 100,
        perfectBonus: 50,
        maxTime: 30,
        hints: [
            "A fuel tank extends engine burn time",
            "Or stack two engines for more power"
        ]
    },
    
    // ============ LEVEL 3 - Angled Shot ============
    {
        id: 3,
        name: "Angle Shot",
        description: "This hoop is off to the side. Time to learn rotation!",
        objectiveType: "hoop",
        target: {
            x: 200,
            y: 400,
            radius: 80
        },
        difficulty: 3,
        budget: 300,
        bonusCredits: 120,
        perfectBonus: 60,
        maxTime: 35,
        hints: [
            "Add RCS thrusters to tilt your rocket",
            "Rotate BEFORE the main engine fires",
            "The rocket turns then returns to vertical"
        ]
    },
    
    // ============ LEVEL 4 - First Landing ============
    {
        id: 4,
        name: "Soft Touch",
        description: "Land on the platform! You'll need to slow down.",
        objectiveType: "landing",
        target: {
            x: 0,
            y: 0,           // Ground level landing
            width: 180,
            height: 30,
            maxLandingSpeed: 30
        },
        difficulty: 4,
        budget: 350,
        bonusCredits: 150,
        perfectBonus: 75,
        maxTime: 40,
        hints: [
            "Add landing legs first!",
            "Use brakes to slow your descent",
            "Time your brakes before you hit the ground"
        ]
    },
    
    // ============ LEVEL 5 - Opposite Angle ============
    {
        id: 5,
        name: "Left Turn",
        description: "The target is on the other side. Practice rotating left!",
        objectiveType: "hoop",
        target: {
            x: -250,
            y: 450,
            radius: 75
        },
        difficulty: 5,
        budget: 350,
        bonusCredits: 140,
        perfectBonus: 70,
        maxTime: 35,
        hints: [
            "Use RCS Left to turn counter-clockwise",
            "Timing is everything!"
        ]
    },
    
    // ============ LEVEL 6 - Elevated Landing ============
    {
        id: 6,
        name: "Sky Platform",
        description: "Land on the floating platform. Approach carefully!",
        objectiveType: "landing",
        target: {
            x: 100,
            y: 350,
            width: 150,
            height: 30,
            maxLandingSpeed: 25
        },
        difficulty: 6,
        budget: 400,
        bonusCredits: 180,
        perfectBonus: 90,
        maxTime: 45,
        hints: [
            "Go up, then come down on the platform",
            "Retro rockets provide strong braking",
            "Time your descent carefully"
        ]
    },
    
    // ============ LEVEL 7 - Distant Hoop ============
    {
        id: 7,
        name: "Long Shot",
        description: "A distant target requires sustained flight.",
        objectiveType: "hoop",
        target: {
            x: -350,
            y: 600,
            radius: 70
        },
        difficulty: 7,
        budget: 450,
        bonusCredits: 200,
        perfectBonus: 100,
        maxTime: 45,
        hints: [
            "Ion engines burn much longer",
            "Plan multiple stages for efficiency"
        ]
    },
    
    // ============ LEVEL 8 - Precision Hoop ============
    {
        id: 8,
        name: "Threading the Needle",
        description: "A small hoop demands precision. Every degree matters!",
        objectiveType: "hoop",
        target: {
            x: 180,
            y: 700,
            radius: 50
        },
        difficulty: 8,
        budget: 500,
        bonusCredits: 220,
        perfectBonus: 110,
        maxTime: 50,
        hints: [
            "Gyro modules provide precise control",
            "Fine-tune your rotation timing"
        ]
    },
    
    // ============ LEVEL 9 - First Orbit ============
    {
        id: 9,
        name: "Orbital Insertion",
        description: "Reach the orbital zone with minimal vertical velocity and hold position!",
        objectiveType: "orbit",
        target: {
            y: 900,
            tolerance: 120,
            minTime: 3,
            maxVerticalSpeed: 20
        },
        difficulty: 9,
        budget: 550,
        bonusCredits: 250,
        perfectBonus: 125,
        maxTime: 60,
        hints: [
            "You need to nearly stop at the target altitude",
            "Use brakes or opposing thrust",
            "Nuclear engines have great efficiency"
        ]
    },
    
    // ============ LEVEL 10 - Tiny Island Landing ============
    {
        id: 10,
        name: "Pinpoint",
        description: "A tiny platform at altitude. Precision landing required!",
        objectiveType: "landing",
        target: {
            x: -200,
            y: 500,
            width: 100,
            height: 25,
            maxLandingSpeed: 20
        },
        difficulty: 10,
        budget: 600,
        bonusCredits: 280,
        perfectBonus: 140,
        maxTime: 55,
        hints: [
            "Hover Jets allow fine control",
            "Airbags tolerate harder landings",
            "Multiple braking stages help"
        ]
    },
    
    // ============ LEVEL 11 - The Gauntlet ============
    {
        id: 11,
        name: "The Gauntlet",
        description: "Navigate a complex trajectory to reach a distant, high target!",
        objectiveType: "hoop",
        target: {
            x: 400,
            y: 850,
            radius: 55
        },
        difficulty: 11,
        budget: 650,
        bonusCredits: 300,
        perfectBonus: 150,
        maxTime: 60,
        hints: [
            "Multiple rotation stages may help",
            "Plan your entire flight sequence first"
        ]
    },
    
    // ============ LEVEL 12 - Master Challenge ============
    {
        id: 12,
        name: "Master Rocketeer",
        description: "The ultimate test: Reach high altitude, then return and land safely!",
        objectiveType: "landing",
        target: {
            x: 0,
            y: 0,
            width: 120,
            height: 25,
            maxLandingSpeed: 15,
            requireMinAltitude: 1000  // Must reach this altitude first!
        },
        difficulty: 12,
        budget: 800,
        bonusCredits: 500,
        perfectBonus: 250,
        maxTime: 90,
        hints: [
            "This is a round trip mission!",
            "You need ascent AND descent stages",
            "Use parachutes for safe descent",
            "Careful staging timing is essential"
        ]
    }
];

// Get level by ID
function getLevel(id) {
    return LEVELS.find(l => l.id === id) || LEVELS[0];
}

// Get number of levels
function getTotalLevels() {
    return LEVELS.length;
}

// Calculate score based on distance to target
function calculateScore(level, distance, landingSpeed = null) {
    let baseScore = 0;
    let maxDistance;
    
    switch (level.objectiveType) {
        case 'hoop':
            maxDistance = level.target.radius * 3;
            if (distance <= level.target.radius) {
                // Perfect - through the hoop!
                baseScore = 1000;
            } else if (distance <= maxDistance) {
                // Partial score based on proximity
                baseScore = Math.floor(800 * (1 - (distance - level.target.radius) / (maxDistance - level.target.radius)));
            }
            break;
            
        case 'landing':
            maxDistance = level.target.width;
            if (distance <= level.target.width / 2 && landingSpeed <= level.target.maxLandingSpeed) {
                // Perfect landing
                baseScore = 1000;
            } else if (distance <= maxDistance && landingSpeed <= level.target.maxLandingSpeed * 1.5) {
                // Rough landing
                baseScore = Math.floor(600 * (1 - distance / maxDistance));
            }
            break;
            
        case 'orbit':
            // Score based on time maintained in orbit
            maxDistance = level.target.tolerance;
            if (distance <= maxDistance) {
                baseScore = 1000;
            } else if (distance <= maxDistance * 2) {
                baseScore = Math.floor(700 * (1 - (distance - maxDistance) / maxDistance));
            }
            break;
    }
    
    return Math.max(0, baseScore);
}

// Calculate credits earned based on score
function calculateCreditsEarned(level, score) {
    if (score >= 900) {
        return level.bonusCredits + level.perfectBonus;
    } else if (score >= 700) {
        return level.bonusCredits;
    } else if (score >= 400) {
        return Math.floor(level.bonusCredits * 0.5);
    } else if (score >= 100) {
        return Math.floor(level.bonusCredits * 0.25);
    }
    return 0;
}

// Check if level is passed
function isLevelPassed(score) {
    return score >= 400;
}

// Get objective icon
function getObjectiveIcon(type) {
    switch (type) {
        case 'hoop': return '⭕';
        case 'landing': return '🏝️';
        case 'orbit': return '🌍';
        default: return '🎯';
    }
}

// Get objective description
function getObjectiveDescription(type) {
    switch (type) {
        case 'hoop': return 'Fly through the hoop';
        case 'landing': return 'Land on the island';
        case 'orbit': return 'Reach stable orbit';
        default: return 'Complete the mission';
    }
}
