/* ========================================
   TIME IT! - Components Catalog
   Defines all rocket parts and their stats
   ======================================== */

const COMPONENTS = {
    // ============ ENGINES ============
    // Thrust formula: Need ~1800-2000 thrust to overcome gravity (mass 30-50, gravity 30)
    // Higher thrust = faster acceleration, longer burn = more total impulse
    engines: [
        {
            id: 'engine-basic',
            name: 'Basic Thruster',
            description: 'A simple solid fuel engine. Reliable and affordable for beginners.',
            category: 'engines',
            price: 80,
            unlockLevel: 1,
            stats: {
                thrust: 1800,        // ~60 m/s² acceleration for 30kg rocket
                burnTime: 5,         // 5 seconds of burn
                fuelConsumption: 1,  // Visual indicator
                mass: 8              // Component mass in kg
            },
            shape: 'engine-basic',
            size: { width: 48, height: 42 }
        },
        {
            id: 'engine-booster',
            name: 'Solid Booster',
            description: 'High thrust, short burn. Great for initial kick.',
            category: 'engines',
            price: 60,
            unlockLevel: 1,
            stats: {
                thrust: 2400,        // High thrust
                burnTime: 2.5,       // Short duration
                fuelConsumption: 3,
                mass: 6
            },
            shape: 'engine-booster',
            size: { width: 44, height: 36 }
        },
        {
            id: 'engine-turbo',
            name: 'Turbo Engine',
            description: 'Powerful liquid fuel engine with excellent thrust-to-weight.',
            category: 'engines',
            price: 150,
            unlockLevel: 3,
            stats: {
                thrust: 2800,        // Strong thrust
                burnTime: 6,         // Good duration
                fuelConsumption: 2,
                mass: 12
            },
            shape: 'engine-turbo',
            size: { width: 52, height: 48 }
        },
        {
            id: 'engine-ion',
            name: 'Ion Drive',
            description: 'Low thrust but extremely efficient. Perfect for sustained flight.',
            category: 'engines',
            price: 200,
            unlockLevel: 5,
            stats: {
                thrust: 1200,        // Low thrust - won't overcome gravity alone
                burnTime: 20,        // Very long burn
                fuelConsumption: 0.5,
                mass: 5
            },
            shape: 'engine-ion',
            size: { width: 46, height: 44 }
        },
        {
            id: 'engine-nuclear',
            name: 'Nuclear Thermal',
            description: 'Massive thrust with incredible efficiency. The ultimate engine.',
            category: 'engines',
            price: 350,
            unlockLevel: 7,
            stats: {
                thrust: 4000,        // Very high thrust
                burnTime: 10,        // Long burn
                fuelConsumption: 1.5,
                mass: 20
            },
            shape: 'engine-nuclear',
            size: { width: 56, height: 54 }
        }
    ],
    
    // ============ ROTATION ============
    // Rotation holds angle then returns - good for trajectory changes
    rotation: [
        {
            id: 'rotation-left',
            name: 'RCS Left',
            description: 'Rotates rocket counter-clockwise. First half turns, second half returns.',
            category: 'rotation',
            price: 50,
            unlockLevel: 2,
            stats: {
                rotationSpeed: 45,    // Degrees per second (more reasonable)
                duration: 4,          // Total duration
                direction: 'left',
                directionLabel: '↺ LEFT',
                maxAngle: 90,         // Maximum rotation before returning
                mass: 3
            },
            shape: 'rotation-basic',
            size: { width: 60, height: 20 }
        },
        {
            id: 'rotation-right',
            name: 'RCS Right',
            description: 'Rotates rocket clockwise. First half turns, second half returns.',
            category: 'rotation',
            price: 50,
            unlockLevel: 2,
            stats: {
                rotationSpeed: 45,
                duration: 4,
                direction: 'right',
                directionLabel: '↻ RIGHT',
                maxAngle: 90,
                mass: 3
            },
            shape: 'rotation-basic',
            size: { width: 60, height: 20 }
        },
        {
            id: 'rotation-gyro-left',
            name: 'Gyro Left',
            description: 'Precise left rotation with stabilization. Holds angle at peak.',
            category: 'rotation',
            price: 120,
            unlockLevel: 4,
            stats: {
                rotationSpeed: 60,
                duration: 5,
                direction: 'left',
                directionLabel: '↺ STABLE',
                maxAngle: 120,
                stabilization: true,
                holdTime: 1,          // Seconds to hold at max angle
                mass: 4
            },
            shape: 'rotation-gyro',
            size: { width: 50, height: 28 }
        },
        {
            id: 'rotation-gyro-right',
            name: 'Gyro Right',
            description: 'Precise right rotation with stabilization. Holds angle at peak.',
            category: 'rotation',
            price: 120,
            unlockLevel: 4,
            stats: {
                rotationSpeed: 60,
                duration: 5,
                direction: 'right',
                directionLabel: '↻ STABLE',
                maxAngle: 120,
                stabilization: true,
                holdTime: 1,
                mass: 4
            },
            shape: 'rotation-gyro',
            size: { width: 50, height: 28 }
        },
        {
            id: 'rotation-vector',
            name: 'Thrust Vector',
            description: 'Rapid precision rotation. Fast turn and return.',
            category: 'rotation',
            price: 180,
            unlockLevel: 6,
            stats: {
                rotationSpeed: 90,
                duration: 3,
                direction: 'both',    // Can be configured
                directionLabel: '↔ VECTOR',
                maxAngle: 135,
                stabilization: true,
                mass: 5
            },
            shape: 'rotation-gyro',
            size: { width: 52, height: 30 }
        }
    ],
    
    // ============ BRAKES ============
    // Braking force should meaningfully slow the rocket
    brakes: [
        {
            id: 'brake-basic',
            name: 'Air Brakes',
            description: 'Deploys fins to slow descent. Best at lower altitudes.',
            category: 'brakes',
            price: 40,
            unlockLevel: 1,
            stats: {
                brakingForce: 800,    // Meaningful deceleration
                duration: 6,
                minAltitude: 0,
                mass: 4
            },
            shape: 'brake-basic',
            size: { width: 52, height: 22 }
        },
        {
            id: 'brake-retro',
            name: 'Retro Rockets',
            description: 'Small rockets that fire opposite to movement. Strong braking.',
            category: 'brakes',
            price: 100,
            unlockLevel: 3,
            stats: {
                brakingForce: 1500,
                duration: 4,
                minAltitude: 0,
                mass: 6
            },
            shape: 'brake-retro',
            size: { width: 54, height: 26 }
        },
        {
            id: 'brake-aero',
            name: 'Aerospike Brake',
            description: 'High-efficiency braking system. Works at any altitude.',
            category: 'brakes',
            price: 180,
            unlockLevel: 5,
            stats: {
                brakingForce: 2200,
                duration: 5,
                minAltitude: 0,
                mass: 8
            },
            shape: 'brake-aero',
            size: { width: 56, height: 28 }
        }
    ],
    
    // ============ LANDING ============
    // Landing speed tolerance based on real rocket landing requirements
    landing: [
        {
            id: 'landing-basic',
            name: 'Landing Legs',
            description: 'Simple struts for landing. Must land gently.',
            category: 'landing',
            price: 60,
            unlockLevel: 2,
            stats: {
                maxLandingSpeed: 25,   // ~25 m/s is survivable
                dampening: 1,
                mass: 5
            },
            shape: 'landing-basic',
            size: { width: 58, height: 24 }
        },
        {
            id: 'landing-airbag',
            name: 'Airbag System',
            description: 'Inflatable cushions absorb harder impacts.',
            category: 'landing',
            price: 120,
            unlockLevel: 4,
            stats: {
                maxLandingSpeed: 45,
                dampening: 2,
                mass: 6
            },
            shape: 'landing-airbag',
            size: { width: 62, height: 22 }
        },
        {
            id: 'landing-hover',
            name: 'Hover Jets',
            description: 'Active landing system with hover capability for precision landings.',
            category: 'landing',
            price: 200,
            unlockLevel: 6,
            stats: {
                maxLandingSpeed: 70,
                dampening: 3,
                hoverCapable: true,
                hoverThrust: 600,     // Can provide some lift
                mass: 8
            },
            shape: 'landing-hover',
            size: { width: 64, height: 26 }
        }
    ],
    
    // ============ SPECIAL ============
    special: [
        {
            id: 'nose-cone',
            name: 'Nose Cone',
            description: 'Aerodynamic tip reduces drag significantly.',
            category: 'special',
            price: 30,
            unlockLevel: 1,
            stats: {
                dragReduction: 0.3,
                mass: 2
            },
            shape: 'nose-cone',
            size: { width: 38, height: 48 },
            mustBeTop: true
        },
        {
            id: 'crew-capsule',
            name: 'Crew Capsule',
            description: 'Houses your brave astronauts. Also reduces drag.',
            category: 'special',
            price: 100,
            unlockLevel: 1,
            stats: {
                crew: 3,
                dragReduction: 0.2,
                mass: 10
            },
            shape: 'crew-capsule',
            size: { width: 44, height: 52 },
            mustBeTop: true,
            isCrewCapsule: true
        },
        {
            id: 'fuel-tank',
            name: 'Fuel Tank',
            description: 'Extra fuel extends engine burn time by 3 seconds.',
            category: 'special',
            price: 80,
            unlockLevel: 2,
            stats: {
                fuelBonus: 3,
                mass: 8
            },
            shape: 'fuel-tank',
            size: { width: 46, height: 55 }
        },
        {
            id: 'fuel-tank-large',
            name: 'Large Fuel Tank',
            description: 'Massive fuel storage. Extends burn time by 6 seconds.',
            category: 'special',
            price: 150,
            unlockLevel: 4,
            stats: {
                fuelBonus: 6,
                mass: 14
            },
            shape: 'fuel-tank-large',
            size: { width: 50, height: 72 }
        },
        {
            id: 'parachute',
            name: 'Parachute',
            description: 'Auto-deploys below 150m. Greatly reduces descent speed.',
            category: 'special',
            price: 80,
            unlockLevel: 3,
            stats: {
                deployAltitude: 150,
                descentSpeed: 15,     // Target descent speed when deployed
                brakingForce: 1200,
                mass: 4
            },
            shape: 'parachute',
            size: { width: 48, height: 20 }
        },
        {
            id: 'decoupler',
            name: 'Stage Decoupler',
            description: 'Separates stages cleanly. Place between rocket sections.',
            category: 'special',
            price: 40,
            unlockLevel: 3,
            stats: {
                separationForce: 50,
                mass: 2
            },
            shape: 'decoupler',
            size: { width: 50, height: 12 }
        },
        {
            id: 'guidance',
            name: 'Guidance Computer',
            description: 'Shows trajectory prediction and stabilizes flight.',
            category: 'special',
            price: 120,
            unlockLevel: 5,
            stats: {
                trajectoryPreview: true,
                stabilization: 0.1,   // Reduces angular drift
                mass: 3
            },
            shape: 'guidance',
            size: { width: 42, height: 24 }
        }
    ]
};

// Helper function to get component by ID
function getComponentById(id) {
    for (const category of Object.values(COMPONENTS)) {
        const component = category.find(c => c.id === id);
        if (component) return component;
    }
    return null;
}

// Helper function to get all components as flat array
function getAllComponents() {
    return Object.values(COMPONENTS).flat();
}

// Helper function to check if component is unlocked
function isComponentUnlocked(componentId, currentLevel) {
    const component = getComponentById(componentId);
    return component && component.unlockLevel <= currentLevel;
}

// Helper function to check if player can afford component
function canAfford(componentId, credits) {
    const component = getComponentById(componentId);
    return component && component.price <= credits;
}
