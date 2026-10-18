document.addEventListener('DOMContentLoaded', function() {
    // Sample projects data (this would typically come from a JSON file or API)
    const projects = [
        {
            id: "cosmo_lab",
            title: "Cosmo Lab",
            description: "An interactive simulation of particle interactions and physics.",
            thumbnail: "../vibe-code/simulations/cosmo_lab/thumbnail.jpg",
            category: "simulations",
            tags: ["photons","physics","javascript","planets"],
            date: "2025-04-26",
            path: "simulations/cosmo_lab/index.html",
            type: "iframe"
        },

        {
            id: "moon_lander",
            title: "Moon Lander",
            description: "A game where you control a lunar module and try to land safely on the moon.",
            thumbnail: "../vibe-code/games/moon_lander/thumbnail.jpg",
            category: "games",
            tags: ["space", "physics", "javascript"],
            date: "2024-05-20",
            path: "games/moon_lander/moon_lander.html",
            type: "iframe" // Explicitly set to load in iframe
        },

        {
            id: "stockman",
            title: "Stockman",
            description: "A stock trading simulation game.",
            thumbnail: "https://github.com/MIKKELLORENZ/stockman/blob/main/menu_wallpaper.png?raw=true",
            category: "games",
            tags: ["stocks", "trading", "simulation", "javascript"],
            date: "2026-04-20",
            path: "games/stockman/index.html",
            type: "iframe"
        },

        {
            id: "craft_note",
            title: "Craft Note",
            description: "A sticky-note board for quick notes and to-dos, right in your browser.",
            thumbnail: "../vibe-code/utilities/craft_note/thumbnail.jpg",
            category: "utilities",
            tags: ["sticky notes", "productivity", "javascript", "utilities","note-taking","to-do", "to do"],
            date: "2025-07-17",
            path: "utilities/craft_note/index.html",
            type: "iframe" // Explicitly set to load in iframe
        },

        {
            id: "hdr_enhance",
            title: "HDR Enhance",
            description: "Enhance your images with simulated High Dynamic Range (HDR) processing.",
            thumbnail: "../vibe-code/utilities/hdr_enhance/thumbnail.jpg",
            category: "utilities",
            tags: ["image processing", "hdr", "javascript"],
            date: "2025-06-29",
            path: "utilities/hdr_enhance/index.html",
            type: "iframe" // Explicitly set to load in iframe
        },

        {
            id: "smart_writer",
            title: "Smart Writer",
            description: "A composer for messages worth getting right: answer a few questions to get a first draft, keep up to four variations of every paragraph, lock the ones you have settled, reroll the rest, and compare whole versions side by side. An optional writing model runs entirely in the browser.",
            thumbnail: "../vibe-code/utilities/smart_writer/thumbnail.jpg",
            category: "utilities",
            tags: ["writing", "drafting", "variations", "comparison", "webllm", "local ai", "javascript"],
            date: "2026-07-29",
            path: "utilities/smart_writer/index.html",
            type: "iframe"
        },

        {
            id: "everdiff",
            title: "EverDiff",
            description: "A browser-based document diff tool with multi-pane comparison, exports, and granular word, character, line, or sentence diffs.",
            thumbnail: "../vibe-code/utilities/everdiff/thumbnail.jpg",
            category: "utilities",
            tags: ["diff", "documents", "text comparison", "javascript", "export"],
            date: "2026-04-20",
            path: "utilities/everdiff/index.html",
            type: "iframe"
        },

        {
            id: "live_wallpaper",
            title: "Matrix Live Wallpaper",
            description: "A customizable Matrix-style live wallpaper with visual presets, color modes, performance controls, and screenshots.",
            thumbnail: "../vibe-code/utilities/live_wallpaper/thumbnail.jpg",
            category: "utilities",
            tags: ["wallpaper", "matrix", "animation", "canvas", "customization"],
            date: "2026-04-20",
            path: "utilities/live_wallpaper/index.html",
            type: "iframe"
        },

        {
            id: "random_password_generator",
            title: "Random Password Generator",
            description: "Generate secure random passwords with customizable options.",
            thumbnail: "../vibe-code/utilities/random_password_generator/thumbnail.jpg",
            category: "utilities",
            tags: ["security", "passwords", "javascript"],
            date: "2025-05-03",
            path: "utilities/random_password_generator/index.html",
            type: "iframe" // Explicitly set to load in iframe
        },


        {
            id: "neural_racers",
            title: "Neural Racers",
            description: "Watch cars with ray sensors and recurrent neural-network brains learn to race — and fire at rivals — via evolutionary reinforcement learning. Switch tracks to test how well they generalize.",
            thumbnail: "../vibe-code/simulations/2d_driving_reinforcement_learning/thumbnail.png",
            category: "simulations",
            tags: ["reinforcement learning", "neural network", "cars", "racing", "evolution", "machine learning", "javascript"],
            date: "2026-06-11",
            path: "simulations/2d_driving_reinforcement_learning/index.html",
            type: "iframe"
        },

        {
            id: "neural_arena",
            title: "Neural Arena",
            description: "Battle-only sibling of Neural Racers: cars with line-of-sight sensors evolve to fight, dodge and hide behind cover while a danger zone closes in. Free-for-all, or red vs blue with two co-evolving gene pools.",
            thumbnail: "../vibe-code/simulations/neural_arena/thumbnail.png",
            category: "simulations",
            tags: ["reinforcement learning", "neural network", "battle", "evolution", "machine learning", "javascript"],
            date: "2026-06-11",
            path: "simulations/neural_arena/index.html",
            type: "iframe"
        },

        {
            id: "stick_balance",
            title: "Stick Balance",
            description: "Physics simulation of balancing a stick with reinforcement learning.",
            thumbnail: "../vibe-code/simulations/stick_balance/thumbnail.jpg",
            category: "simulations",
            tags: ["physics", "balance", "reinforcement learning"],
            date: "2025-01-10",
            path: "simulations/stick_balance/index.html",
            type: "iframe"
        },

        {
            id: "bayesian_optimization",
            title: "Bayesian Optimization (Interactive)",
            description: "Don't know Bayesian Optimization? Learn it by brewing coffee!",
            thumbnail: "../vibe-code/simulations/bayesian_optimization/thumbnail.jpg",
            category: "simulations",
            tags: ["bayesian optimization", "machine learning", "interactive","coffee","optimization"],
            date: "2025-07-23",
            path: "simulations/bayesian_optimization/index.html",
            type: "iframe"
        },

        {
            id: "laser_cut_puzzle_maker",
            title: "Laser Cut Puzzle Maker",
            description: "Create custom laser-cut ready puzzles from your images.",
            thumbnail: "../vibe-code/utilities/laser_cut_puzzle_maker/thumbnail.jpg",
            category: "utilities",
            tags: ["laser cut", "puzzle", "image processing"],
            date: "2025-12-27",
            path: "utilities/laser_cut_puzzle_maker/index.html",
            type: "iframe"
        },

        {
            id: "laser_cutter_studio",
            title: "Laser Cutter Studio",
            description: "Browser-based laser cutter / engraver with layers, dithering, GCode export and preview.",
            thumbnail: "../vibe-code/utilities/laser_cutter_studio/thumbnail.png",
            category: "utilities",
            tags: ["laser cut", "engraver", "gcode", "grbl", "lightburn", "dithering", "svg", "pdf"],
            date: "2026-04-17",
            path: "utilities/laser_cutter_studio/index.html",
            type: "iframe"
        },

        {
            id: "audio_studio",
            title: "Audio Studio",
            description: "A browser-based digital audio workstation with multi-track recording, EQ, compression, effects, and more.",
            thumbnail: "../vibe-code/utilities/audio_studio/thumbnail.png",
            category: "utilities",
            tags: ["audio", "music", "DAW", "recording", "mixing", "EQ", "compressor", "effects"],
            date: "2026-04-04",
            path: "utilities/audio_studio/index.html",
            type: "iframe"
        },

        {
            id: "robot_arm_language_neuro_evolution",
            title: "Told What To Do",
            description: "A five-joint robot arm learns to sort coloured balls into buckets by being told what to do in English. The instruction is embedded by Qwen3-Embedding-8B and fed to the network alongside what its cameras see — then the whole thing is evolved by mutation and selection, with no gradient descent anywhere. 49 goals in 539 phrasings, three of every eleven held back so you can check it obeys wording it has never seen. Type your own instruction and watch it try.",
            thumbnail: "../vibe-code/simulations/robot_arm_language_neuro_evolution/thumbnail.png",
            category: "simulations",
            tags: ["robot arm", "robotics", "language", "embeddings", "qwen", "llm", "neuroevolution", "neural network", "evolution", "genetic algorithm", "machine learning", "3d", "javascript"],
            date: "2026-07-31",
            path: "simulations/robot_arm_language_neuro_evolution/index.html",
            type: "iframe"
        },

        {
            id: "traffic_light_neuro_evolution",
            title: "Traffic Light Neuroevolution",
            description: "A genetic algorithm learns to run the traffic signals of a whole city. One evolved brain drives every junction at once — reading its own detectors, the road map, and what its neighbours were showing at twelve points over the last thirty seconds — and is scored on how many drivers and pedestrians actually reached their destination. Drivers obey the law, so every collision is the signal plan's fault: cut the amber and cars are stranded in the dilemma zone, cut the all‑red and the cross street is released on top of them. Eight cities, from a single crossroads to a winding downtown with roundabouts, one‑ways and a ring road, and a fixed‑time and a vehicle‑actuated controller re‑measured every generation on the identical traffic so you can see whether it is really any good.",
            thumbnail: "../vibe-code/simulations/traffic_light_neuro_evolution/thumbnail.png",
            category: "simulations",
            tags: ["traffic", "traffic lights", "city", "neuroevolution", "neural network", "genetic algorithm", "evolution", "simulation", "roundabout", "pedestrians", "machine learning", "javascript"],
            date: "2026-08-01",
            path: "simulations/traffic_light_neuro_evolution/index.html",
            type: "iframe"
        },

        {
            id: "chess_neuro_evolution",
            title: "Chess Neuroevolution",
            description: "A population of neural-network chess players evolves through elitism, crossover and mutation — no backpropagation anywhere. Each brain remembers the last five whole board positions and splits its decision in two: one head picks which piece to move, another picks the square to move it to. Watch both heads light up the board live while the champion climbs a fixed ladder of opponents.",
            thumbnail: "../vibe-code/simulations/chess_neuro_evolution/thumbnail.png",
            category: "simulations",
            tags: ["chess", "neuroevolution", "neural network", "evolution", "genetic algorithm", "machine learning", "javascript"],
            date: "2026-07-18",
            path: "simulations/chess_neuro_evolution/index.html",
            type: "iframe"
        },

        {
            id: "neural_moon_landers",
            title: "Neural Moon Landers",
            description: "A population of recurrent neural-network pilots evolves to touch down softly on the moon. Five terrains — from open plains to a needle rift — test how well the champion generalizes beyond what it trained on.",
            thumbnail: "../vibe-code/simulations/moon_lander_reinforcement_learning/thumbnail.png",
            category: "simulations",
            tags: ["moon lander", "neural network", "evolution", "reinforcement learning", "machine learning", "physics", "javascript"],
            date: "2026-07-18",
            path: "simulations/moon_lander_reinforcement_learning/index.html",
            type: "iframe"
        },

        {
            id: "food_delivery_neuro_evolution",
            title: "Food Delivery Neuroevolution",
            description: "Neural-network couriers evolve to follow a GPS route through procedurally generated towns, picking up food and delivering it to customers — dodging trees, pedestrians and each other while learning to keep right and stop for red lights. Copy-paste crossover and slider-driven mutation, no backpropagation.",
            thumbnail: "../vibe-code/simulations/food_delivery_neuro_evolution/thumbnail.png",
            category: "simulations",
            tags: ["food delivery", "self-driving", "neural network", "neuroevolution", "genetic algorithm", "a-star", "machine learning", "javascript"],
            date: "2026-07-19",
            path: "simulations/food_delivery_neuro_evolution/index.html",
            type: "iframe"
        },

        {
            id: "smart_ocean_boats",
            title: "Smart Ocean Boats",
            description: "Real-scale hydrofoil boats evolve to chase an endless chain of GPS waypoints across three hand-crafted seas — countering wind, gyres and tidal currents, then learning to dodge (and in the combat stage, hunt) each other. Elites, crossover and champion grace, no backpropagation.",
            thumbnail: "../vibe-code/simulations/smart_ocean_boats/thumbnail.png",
            category: "simulations",
            tags: ["boats", "hydrofoil", "neuroevolution", "neural network", "genetic algorithm", "gps navigation", "ocean currents", "machine learning", "javascript"],
            date: "2026-07-21",
            path: "simulations/smart_ocean_boats/index.html",
            type: "iframe"
        },

        {
            id: "tetris_neuro_evolution",
            title: "Tetris Neuroevolution",
            description: "Neural networks evolve to play Tetris by pressing the arrow keys — not by picking placements. The population's only actuator is a keyboard, with DAS auto-repeat and press-edge rotation, so a brain has to learn to let go of a key before it can use it again. Elitism, row-wise crossover, champion grace and mutation that anneals as it improves, no backpropagation. Play the same engine yourself.",
            thumbnail: "../vibe-code/simulations/tetris_neuro_evolution/thumbnail.png",
            category: "simulations",
            tags: ["tetris", "neuroevolution", "neural network", "genetic algorithm", "evolution", "keyboard", "machine learning", "javascript"],
            date: "2026-07-29",
            path: "simulations/tetris_neuro_evolution/index.html",
            type: "iframe"
        },

        {
            id: "bioreactor_neuro_evolution",
            title: "Tending the Culture",
            description: "One evolved controller runs five different stem-cell differentiations in the same 100 mL stirred bottle: cardiomyocytes by the GiWi protocol with lactate selection, midbrain dopamine neurons by the floor-plate route, pancreatic beta cells through six stages, kidney organoids, and hepatocytes. The plant is mechanisms rather than tables and it knows about none of them — cells sit in a chain of stages, they leave a stage on a clock, and the signals present at that hour decide only the FRACTION that arrive where the protocol intended, so a cue dosed two days late still fills the vessel, just with the wrong cells. Around that: bicarbonate pH chemistry that lactate titrates until the phenol red goes yellow, a Thiele-modulus hypoxic core, aggregate fusion and shear, reagents whose effective dose falls with cell density and with how far a 25 kDa protein has to diffuse into a 300 µm ball, decisions made on how LONG a signal was on rather than how strong, and a hidden cell line whose sensitivity to every reagent is only observable through flow cytometry two days late. The controller has a fixed action space whatever the product — six process knobs, six generic dosing pumps, three media — is told which of the five was ordered through five inputs and a countdown, and otherwise sees exactly what a lab sees: probes every hour, assays hours late, nothing at weekends. Calibrating it meant breaking each published protocol one way at a time until every failure mode matched the papers (half the CHIR dose makes forebrain and twice makes hindbrain; inducing the endocrine programme five days early makes polyhormonal cells; a two-day CHIR pulse and a seven-day pulse ruin a kidney organoid in opposite directions; withholding oxygen costs a hepatocyte its drug-metabolising activity without costing a single cell), and finding eleven faults a scoreboard would never have shown — including an absolute score that put four of the five protocols BELOW a reactor nobody touched, and a distillation whose loss fell to 0.06 while producing a network that made zero neurons and zero beta cells, and a held-out gate whose scenario bank never rotated, which froze one run's champion for 380 generations while its log read exactly like a plateau. Each protocol is now scored against the median of its own published recipe, and the controller is measured against them one product at a time rather than on an average: it beats beta cells, hepatocytes and midbrain dopamine neurons, takes kidney organoids narrowly, and is behind on cardiomyocytes alone, where it buys purity with yield for a trade the corrected references price as a loss. Four of the five beaten, on a hundred and twenty paired batches against the published recipes. The page is a lab notebook rather than a control room — pick which of the five to make, or let every batch draw a different one, and watch the network and the published recipe work the same bottle side by side.",
            thumbnail: "../vibe-code/simulations/bioreactor_neuro_evolution/thumbnail.png",
            category: "simulations",
            tags: ["bioreactor", "stem cells", "cardiomyocytes", "dopaminergic neurons", "beta cells", "kidney organoids", "hepatocytes", "differentiation", "cell culture", "process control", "bioprocess", "neuroevolution", "neural network", "genetic algorithm", "machine learning", "javascript"],
            date: "2026-09-13",
            path: "simulations/bioreactor_neuro_evolution/index.html",
            type: "iframe"
        },

        {
            id: "tokamak_plasma_neuro_evolution",
            title: "Holding the Plasma",
            description: "Magnetic control of a tokamak plasma, learned by evolution. A 150 kA current ring is held in mid-air by nineteen coils and is violently unstable — elongate it and it falls out of the machine in six milliseconds, slowed to a catchable ten only by eddy currents in the conducting wall. The controller sees what a real machine sees: 34 flux loops, 38 field probes and coil currents, noisy and one step stale, and it commands voltages, not currents. Coupled L/R circuits, elliptic-integral Green's functions, a magnetic observer, and a hand-tuned PID cascade running the same shot beside it for comparison. The published observation vector turned out to be memoryless — it cannot tell a plasma sitting high from one falling fast — so seventy temporal neurons were added, including the whole probe array differenced against 0.8 ms ago, which is where the invisible vessel eddy currents live. The controller is cloned from the PID by imitation learning and then evolved past it, on a difficulty ladder that makes the machine nastier whenever the champion gets comfortable and never lets it forget the machine it started on. It now completes two thirds of the 1.2 s discharge the baseline disrupts every single time, and where the baseline's error grows fourfold as the wall thins, its own grows by a third.",
            thumbnail: "../vibe-code/simulations/tokamak_plasma_neuro_evolution/thumbnail.png",
            category: "simulations",
            tags: ["tokamak", "fusion", "plasma", "physics", "control", "neuroevolution", "neural network", "genetic algorithm", "magnetics", "pid", "machine learning", "javascript"],
            date: "2026-07-31",
            path: "simulations/tokamak_plasma_neuro_evolution/index.html",
            type: "iframe"
        },

        {
            id: "rocket_catch_neuro_evolution",
            title: "Learning to be Caught",
            description: "A 250 tonne stainless steel cylinder with no landing legs falls out of the sky, and its only acceptable ending is to be plucked out of the air by two steel arms on a tower, 120 metres up, at walking pace, inside a box 1.8 metres wide. The same genome also flies the Ship, which falls flat on its back at 78 m/s and has to rotate ninety degrees in the last kilometre. Nothing about flying either vehicle is written by hand and there is no gradient descent anywhere: when to light the engines, how many, when to shed them through a door that only opens one way, how to work three grid fins or four drag flaps, and every flight whether to commit to the tower or give up and go to the water — all ten outputs, at 20 Hz, come out of an evolved network. The aerodynamics are strip theory rather than a coefficient table, so a Super Heavy is passively stable tail-first because its engines and residual methalox are at the leading end, pitch damping appears without a damping derivative and correctly vanishes at altitude, and the belly-flop settles at 78 m/s purely because that is 468 m² of flank against 165 tonnes. The number that defines the problem: three Raptors at their 40% floor under a 270 tonne booster is a thrust-to-weight of 1.25 and thirteen at full throttle is 13.1, so there is no setting that descends gently and none that hovers — the landing burn is a hoverslam that has to arrive at zero velocity at exactly the rail height. Four separate bugs in this project each produced the same flat fitness curve, and only the last was about the search: Gaussian scoring kernels that returned identical zeros for a 250 m/s and a 40 m/s arrival, an uprightness term that paid a passively-stable rock 0.61 for doing nothing, a flat tower-strike penalty that made approaching the tower negative-expectation so the population learned to divert forever, and finally a population that discovered losing control at altitude scored better than flying all the way down, and went from 17% to 76% tumbles in twenty-five generations.",
            thumbnail: "../vibe-code/simulations/rocket_catch_neuro_evolution/thumbnail.png",
            category: "simulations",
            tags: ["starship", "super heavy", "spacex", "rocket landing", "chopsticks", "tower catch", "belly flop", "grid fins", "aerodynamics", "strip theory", "flight control", "neuroevolution", "neural network", "genetic algorithm", "three.js", "machine learning", "javascript"],
            date: "2026-08-15",
            path: "simulations/rocket_catch_neuro_evolution/index.html",
            type: "iframe"
        },

        {
            id: "orbital_docking_neuro_evolution",
            title: "Learning to Dock",
            description: "A 6.3 tonne capsule teaches itself to rendezvous with a space station and dock, from up to 150 km away, by evolution alone. Both vessels are in a real 413 km orbit with J2 oblateness, and the chaser is propagated as a relative state in Battin's form so that a metre-scale docking inside a 6,791 km orbit stays numerically honest. Sixteen 400 N thrusters pulsed on a 20 ms minimum impulse bit, no attitude controller underneath, and a laser that returns five raw retroreflector points inside 250 metres — recovering the port's position and attitude from those five points is the network's problem. The brain is two-rate and two-headed: a guidance head every four seconds that can request a COAST, and a thruster head at 4 Hz that is fed its held command, bred as one genome with no supervision between them. Coasting as an action is what makes the far stages trainable at all — episode cost becomes the number of manoeuvres rather than the mission duration — and it is the skill the task actually requires, because from 100 km out you are already closing at 18 m/s for free and the correct move for most of an hour is to do nothing. Fitness is an advantage between a do-nothing policy and a scripted Clohessy-Wiltshire autopilot on the identical scenario, so a 40 m final approach and a 130 km out-of-plane rendezvous contribute equally to one number; brains are raced against each other with successive halving and the worse half eliminated between scenarios, which costs a third of the episodes. Five bugs in this project produced the same flat fitness curve, and four of them were in the environment rather than the search — including a sign error that had every long-range plan flying the wrong way round the orbit, and an output scale that left 241 of 300 random brains physically unable to fire a thruster.",
            thumbnail: "../vibe-code/simulations/orbital_docking_neuro_evolution/thumbnail.png",
            category: "simulations",
            tags: ["orbital mechanics", "rendezvous", "docking", "spacecraft", "iss", "physics", "control", "neuroevolution", "neural network", "genetic algorithm", "clohessy-wiltshire", "three.js", "machine learning", "javascript"],
            date: "2026-08-01",
            path: "simulations/orbital_docking_neuro_evolution/index.html",
            type: "iframe"
        },

        {
            id: "2d_planetary_neuronal_prediction",
            title: "Predicting Planets",
            description: "Networks that taught themselves gravity. A genetic algorithm searches for a force law that can predict where every body in a star system will be hundreds of ticks ahead — and its opponent is not just Newton but Adams–Bashforth, the classical multistep scheme, given exactly the same single force evaluation per tick. The ground truth is a 4th-order Yoshida symplectic integrator that conserves energy to one part in 10¹¹, so the errors being scored are the model's own. Because the architecture is an interaction network — one shared edge network per pair of bodies, one shared node network per body — a genome evolved on four planets runs unmodified on eleven. Rotation equivariance and permutation invariance are exact by construction. Each body also remembers its own last few force calculations, which is how an integrator buys accuracy without computing the forces again; the network evolves the coefficients that weigh them.",
            thumbnail: "../vibe-code/simulations/2d_planetary_neuronal_prediction/thumbnail.png",
            category: "simulations",
            tags: ["planets", "orbits", "gravity", "n-body", "physics", "neuroevolution", "neural network", "genetic algorithm", "graph network", "interaction network", "symplectic", "forward model", "machine learning", "javascript"],
            date: "2026-07-31",
            path: "simulations/2d_planetary_neuronal_prediction/index.html",
            type: "iframe"
        },

        {
            id: "power_grid_neuro_evolution",
            title: "Keeping the Lights On",
            description: "A genetic algorithm evolves the operator of a transmission network. Every five simulated minutes it solves a full AC power flow — Newton-Raphson with a cached fast-decoupled fast path, enforced reactive limits, per-island balancing — screens every single branch outage with line-outage distribution factors, and decides: which generators to redispatch, which wind farms to curtail, and which one line or busbar to switch. The brain is a graph network with shared weights, so a genome evolved on the IEEE 14-bus case runs unchanged on a thirty-bus network it has never seen; permutation and size invariance are exact by construction and verified to 1e-12. Nothing is recorded data: solar comes from orbital geometry times a beta-distributed clearness index, wind from an autocorrelated Weibull pushed through a manufacturer power curve with cut-out hysteresis, demand from diurnal shapes plus an Ornstein-Uhlenbeck deviation. Thermal ratings are not guessed either — every network is sized from an eleven-case planning sweep with a full N-1 screen in each. Fitness is the control room’s operating margin in euros, and it is graded against three classical controllers running the identical day, including one that verifies its switching with a real power flow. N-1 security is measured every interval and deliberately never paid for, so the chart can answer whether an operator paid only to deliver energy cheaply ends up running the system securely. The evolved operator that ships is an insurance policy, and the numbers say both halves of that: on forty-eight held-out days it pays about five thousand euros a day and beats doing nothing outright on only three of them, but it is worth 686 thousand a day on the days that actually cost money, serves two and a half points more demand through them, and is the only controller in the set with a positive mean margin. On one held-out day it was nine million ahead. What it never learned is N-1 security — it was never paid for it and it never bought any — and the README is blunt about that, and about the two earlier champions that looked excellent from inside the run and were a lucky gambler and a topology thrasher.",
            thumbnail: "../vibe-code/simulations/power_grid_neuro_evolution/thumbnail.png",
            category: "simulations",
            tags: ["power grid", "power flow", "transmission", "ieee 14-bus", "redispatch", "topology", "n-1 security", "neuroevolution", "neural network", "genetic algorithm", "graph network", "renewables", "machine learning", "javascript"],
            date: "2026-08-01",
            path: "simulations/power_grid_neuro_evolution/index.html",
            type: "iframe"
        },

        {
            id: "3d_walk_neuro_evolution",
            title: "Learning to Walk",
            description: "A genetic algorithm teaches a 22-joint humanoid to walk in three dimensions. No gradient descent anywhere: brains are mutated, scored and bred. The physics is not a toy — Featherstone articulated-body dynamics, Hunt–Crossley penalty contact, torque-limited PD servos with a finite slew rate and a 55 ms lag, and per-episode randomisation of friction, torque and gains, so a gait that only works in ideal conditions is bred out. Every walker in a generation meets the same terrain, the same waypoints, the same gusts and the same shoves at the same instants; the only difference between two of them is the weights in their heads. The brain reads 365 inputs — joint angles and loads, a swept LiDAR cone, a 36-point ground ring, foot patches — and, because a feedforward network has no memory, it also reads differenced trailing windows of every channel reaching 1.2 seconds into the past. It writes 22 joint setpoints plus a small rhythm layer: one cadence, and an amplitude and phase for each of five limb groups. A five-stage curriculum ramps from standing still to gusting crosswind over rolling ground and stairs, and the only score trusted is a held-out exam of twelve missions no generation ever trains on. The champion that ships reaches about ten waypoints and thirty-five metres on unseen ground, confirmed across three disjoint mission banks. What it never learned is to get up off the floor. That is not for want of trying: a dedicated search found an open-loop trajectory that does stand up from face-down, and training against it got the fleet reliably onto its hands and knees and no further. The reason appears to be the reward rather than the search — commanding the standing posture from the floor drives the centre of mass downward first, so the correct move is punished for its entire first half-second.",
            thumbnail: "../vibe-code/simulations/3d_walk_neuro_evolution/thumbnail.jpg",
            category: "simulations",
            tags: ["walking", "humanoid", "biped", "locomotion", "robotics", "physics", "featherstone", "terrain", "lidar", "neuroevolution", "neural network", "genetic algorithm", "evolution", "machine learning", "3d", "javascript"],
            date: "2026-08-03",
            path: "simulations/3d_walk_neuro_evolution/index.html",
            type: "iframe"
        },

        {
            id: "rubiks_cube_neuro_evolution",
            title: "Solving a Cube by Looking",
            description: "A neural network that turns a Rubik's cube by looking at it. Its entire input is a 32×16 pixel rendering of the cube from two opposite corners — no facelet list, no colour counts, no search over move sequences. It reads pixels, picks one of eight quarter turns, gets a fresh picture, and picks again. The brain on the page solves 100% of one- to four-turn scrambles it has never seen, 98% of five-turn, 85% of six-turn and 74% of seven-turn, against 0.4% for a network that was never trained at all. The page also shows you inside it: beside the cube, every one of its 1,569 inputs and 256 hidden units is drawn as a live cell, with the strongest weight-times-activation terms wired to the move it is about to play. It does not solve a fully scrambled cube; a real scramble is fifteen to eighteen turns deep, the distance table the reward reads only reaches seven, and every reward in the project is flat beyond it. Five things mattered more than the search, and each presents itself as \"evolution is too slow\". Turning only four faces reaches a proper subgroup of the cube group, so a cube scrambled with the other two has no solution at all and scrambles must be built from the same generators the solver gets. An observation showing only the current cube makes the task provably impossible — a deterministic policy is then a deterministic map on a finite state space, so it turns U, then U', then U forever — fixed by a move-history window, not by training longer. Counting correctly-placed stickers, the obvious dense reward, cannot tell U from U2 from U': all three score 42 of 54. The shading meant to help turned out to hurt, because a pixel carries colour times face brightness and strong shading brings yellow on a dim face within 0.20 of orange on a bright one. And the fifth cost two rounds of work: how much history the network gets. The observation had been reasoned about carefully and never measured, and when it finally was, remembering four past moves instead of two beat every reward, architecture and breeding change ever tried — while removing half the picture, the second image frame, beat that. The brain was memory-limited, not perception-limited, and from a score those are indistinguishable, because a policy that cycles and a policy that is merely bad both simply fail to solve. The network now sees 1,569 numbers where its predecessor saw 3,089, and beats it at every depth after a run 4.7 times shorter. A later round found the same thing about the network itself: the hidden layer had been 32 units since the first week and was never once varied, and widening it to 64 while swapping the activation from tanh to ReLU was worth more than every architecture result before it — with the activation change alone worth more than the extra width. The largest networks tried, at twenty-five thousand weights, finished near the bottom. Ten rewards and nine architectures go through a two-stage grid search that reports mean ± standard error and says plainly when it has not separated two candidates — which for the rewards it had not, the leader falling from 0.395 to 0.284 on a fresh seed. Where a grid could not afford the answer, a separate instrument measures each reward's rank correlation against ground truth per depth, and finds the deliberately exploitable variant collapsing from 0.99 to 0.27 as the cube deepens and the exploit becomes available. The architecture grid's own winner is the ablation control that gets the 54 facelets instead of pixels, by 4.8 standard errors: reading the cube from an image is the point of the project, and it costs a large part of the achievable score — though that control had the same short move history, so how much of the gap was really memory is now an open question. Three further hours of training on top of the champion made it worse, not better, because the held-out gate rotates and a challenger that wins one rotation keeps the title forever: the last brain a long run produces is a hypothesis, not a champion. That brain is not the one the project set out to build, and the round that produced it answered the question all of the above had been circling. Ten rewards, eleven activations, nine architectures, two projections, recurrence, sharing and racing had all converged on the same 40-45% per-move accuracy, and when a number refuses to move under every intervention it is usually answering a different question than the one being asked. A one-minute probe settled it: plain gradient descent fits the same pixels-to-move mapping to 96.7% accuracy, against the evolved champion's 53.5%. The project had been search-limited, not representation-limited, for five rounds — the brain could always have done this and evolution could not find the weights. Distilling that into a network with the same observation and the same eight actions, then letting it roll out its own games and relabelling the states it actually reached, took seven-turn cubes from 13% to 74% — and the evolved champion, which reads exactly the same pixels, is kept in the repository beside it as the control. The intermediate lesson was that a model trained only on optimal paths has never been asked what to do after its own first mistake. The arithmetic worth keeping is that every move changes the true distance by exactly one, so self-play is a biased random walk and 90% at depth seven needs 85% per-move accuracy, not 98% — the budget pays for mistakes and recovery. The page plays it at a speed you can follow, charts the true distance to solved after every move, and shows the raw pixel input blown up beside the cube.",
            thumbnail: "../vibe-code/simulations/rubiks_cube_neuro_evolution/thumbnail.png",
            category: "simulations",
            tags: ["rubiks cube", "rubik", "puzzle", "computer vision", "pixels", "convolutional", "neuroevolution", "neural network", "genetic algorithm", "evolution", "curriculum learning", "reward shaping", "distillation", "gradient descent", "imitation learning", "machine learning", "javascript"],
            date: "2026-08-17",
            path: "simulations/rubiks_cube_neuro_evolution/index.html",
            type: "iframe"
        },

        {
            id: "todo",
            title: "Todo",
            description: "A quiet, minimal to-do list. Add, check off, rename by double-click and drag to reorder, with soft sounds and three color modes — light, dark and navy. Everything lives in your browser's local storage, so clearing your browsing data clears the list.",
            thumbnail: "../vibe-code/utilities/todo/thumbnail.jpg",
            category: "utilities",
            tags: ["to-do", "to do", "todo list", "tasks", "productivity", "local storage", "minimal", "javascript"],
            date: "2026-07-27",
            path: "utilities/todo/index.html",
            type: "iframe",
            featured: false // thumbnail doesn't carry a full-bleed hero slide
        },

        {
            id: "neural_architect",
            title: "Neural Architect",
            description: "A visual designer for neural network architectures. Build the big picture out of blocks — inputs, linear and conv layers, attention, norms, residual adds — then zoom in and the same blocks resolve into their individual neurons. Split an input into named regions (\"neurons 0–10 physical constraints, 11–110 objective embedding, 111–200 sensors\"), label single neurons, and drag a line from one neuron to another to add sparse graph-style connections on top of the dense wiring. Marquee-select blocks or neuron ranges and apply batch-norm, dropout, residual skips or annotations from a floating toolbar; group blocks into reusable modules; start from a clean slate or a template. Shapes are inferred live, and the export is a complete, runnable PyTorch nn.Module (with a smoke test and the design embedded in its docstring so the .py re-opens losslessly), plus Keras JSON out and ONNX in.",
            thumbnail: "../vibe-code/utilities/neural_architect/thumbnail.png",
            category: "utilities",
            tags: ["neural network", "architecture", "pytorch", "keras", "onnx", "deep learning", "designer", "graph neural network", "node editor", "canvas", "javascript"],
            date: "2026-09-12",
            path: "utilities/neural_architect/index.html",
            type: "iframe"
        },

        {
            id: "compression_evolution",
            title: "Compression Evolution",
            description: "A genetic algorithm that invents lossless compression algorithms, starting from nothing but “count which bytes are common”. Every candidate is a real compressor — optional Burrows–Wheeler sort, evolved numeric predictors, a bank of evolved context experts, a learned mixer and an arithmetic coder — that is actually run; the champion is decompressed again and compared bit for bit, and can be downloaded and restored. By default ONE design is evolved for five very different files at once (a 1 MB cat photo, Alice in Wonderland, a guitar recording, a cat’s meow and the page’s own source): its rules are structure-relative (“one row up”, “one unit left”), so the same algorithm means something on pixels, samples and text. Three architectural families evolve side by side on a chart whose reference lines are gzip, bzip2, xz, zstd, brotli, PPMd, PNG, WebP, JPEG XL, FLAC and friends, all measured with the real tools on the very same bytes; the recorded run reaches a mean of 33 % and passes PPMd on both texts, FLAC on both recordings and PNG and JPEG-LS on the photo. See what every expert looks at, where the bits go (flat background nearly free, fur and whiskers expensive) and which part of the design saves them. Runs are saved as you go, switching files never stops evolution, and one click downloads the evolved algorithm. Bring your own file, up to 8 MB; nothing leaves the browser.",
            thumbnail: "../vibe-code/utilities/compression_evolution/thumbnail.png",
            category: "utilities",
            tags: ["compression", "genetic algorithm", "evolution", "lossless", "context mixing", "arithmetic coding", "burrows-wheeler", "gzip", "png", "flac", "information theory", "entropy", "web workers", "data visualization", "javascript"],
            date: "2026-09-21",
            path: "utilities/compression_evolution/index.html",
            type: "iframe"
        },

        {
            id: "image_to_stl",
            title: "Image to STL",
            description: "Turn an image into a 3D-printable STL. Dark areas become a flat cutout or a variable-height relief; draw rectangle and polygon regions that each get their own settings, rename and reorder them as layers, add a base plate so separate pieces print as one, and check the mesh in a 3D preview before exporting binary STL. Projects save to a single file, and everything runs in the browser, so nothing is uploaded.",
            thumbnail: "../vibe-code/utilities/image_to_stl/thumbnail.png",
            category: "utilities",
            tags: ["stl", "3d printing", "image to stl", "relief", "lithophane", "extrude", "mesh", "height map", "webgl", "web workers", "javascript"],
            date: "2026-10-18",
            path: "utilities/image_to_stl/index.html",
            type: "iframe"
        },


    ];

    /* ═══════════════════════════════════════════════════════════
       Config & derived data
       ═══════════════════════════════════════════════════════════ */

    const NEW_WINDOW_DAYS = 21;    // "New" label window, measured from the latest project

    const CATEGORY_LABELS = {
        all: 'All',
        simulations: 'Simulations',
        games: 'Games',
        utilities: 'Utilities'
    };

    const CATEGORY_SINGULAR = {
        simulations: 'Simulation',
        games: 'Game',
        utilities: 'Utility'
    };

    // Quick filters under the search bar. A topic matches a project when one
    // of its terms is in the title or the tags, never only the description,
    // where words like "physics" or "space" turn up in passing.
    const TOPICS = [
        { id: 'evolution',    label: 'Evolution',    terms: ['evolution', 'genetic algorithm'] },
        { id: 'control',      label: 'Control',      terms: ['control', 'pid', 'traffic', 'power grid', 'docking', 'balance'] },
        { id: 'physics',      label: 'Physics',      terms: ['physics', 'fusion', 'gravity', 'orbit', 'aerodynamics'] },
        { id: 'space',        label: 'Space',        terms: ['space', 'moon', 'planet', 'orbit', 'rocket', 'starship'] },
        { id: 'robotics',     label: 'Robotics',     terms: ['robot', 'humanoid', 'locomotion'] },
        { id: 'images',       label: 'Images',       terms: ['image', 'hdr', 'computer vision', 'pixels', 'dithering'] },
        { id: 'productivity', label: 'Productivity', terms: ['productivity', 'writing', 'documents', 'notes', 'to-do'] }
    ];

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const phoneQuery = window.matchMedia('(max-width: 560px)');

    // Parse "YYYY-MM-DD" as a local date — new Date(str) treats it as UTC,
    // which can render as the previous day in western time zones.
    function parseDate(str) {
        const [y, m, d] = String(str).split('-').map(Number);
        return new Date(y, (m || 1) - 1, d || 1);
    }

    function formatDate(str) {
        return parseDate(str).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
        });
    }

    function esc(str) {
        return String(str).replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    const SORTS = {
        newest: (a, b) => parseDate(b.date) - parseDate(a.date),
        oldest: (a, b) => parseDate(a.date) - parseDate(b.date),
        az: (a, b) => a.title.localeCompare(b.title),
        za: (a, b) => b.title.localeCompare(a.title)
    };

    const latestTime = projects.reduce((max, p) => Math.max(max, parseDate(p.date).getTime()), 0);
    const newCutoff = latestTime - NEW_WINDOW_DAYS * 86400000;

    const isNew = project => parseDate(project.date).getTime() >= newCutoff;

    // Lower-cased fields, computed once, for search and topics
    const fields = new Map(projects.map(p => [p.id, {
        title: p.title.toLowerCase(),
        tags: p.tags.map(tag => tag.toLowerCase()),
        category: `${p.category} ${(CATEGORY_SINGULAR[p.category] || '').toLowerCase()}`,
        desc: p.description.toLowerCase()
    }]));

    /* ═══════════════════════════════════════════════════════════
       Search
       ═══════════════════════════════════════════════════════════ */

    const tokenize = query => query.toLowerCase().split(/\s+/).filter(Boolean);

    // Every word has to turn up somewhere. The tier is the weakest place any
    // word was found (3 title, 2 tags or category, 1 description), so
    // "chess" puts Chess Neuroevolution above a project that merely says it.
    function matchTier(project, toks) {
        const f = fields.get(project.id);
        let tier = 3;
        for (const t of toks) {
            if (f.title.includes(t)) continue;
            if (f.category.includes(t) || f.tags.some(tag => tag.includes(t))) tier = Math.min(tier, 2);
            else if (f.desc.includes(t)) tier = 1;
            else return 0;
        }
        return tier;
    }

    function matchesTopic(project, topic) {
        const f = fields.get(project.id);
        return topic.terms.some(term => f.title.includes(term) || f.tags.some(tag => tag.includes(term)));
    }

    // Escaped HTML with every occurrence of every word wrapped in <mark>
    function highlight(text, toks) {
        if (!toks.length) return esc(text);
        const lower = text.toLowerCase();
        const ranges = [];
        toks.forEach(t => {
            for (let i = lower.indexOf(t); i !== -1; i = lower.indexOf(t, i + t.length)) {
                ranges.push([i, i + t.length]);
            }
        });
        ranges.sort((a, b) => a[0] - b[0]);
        let html = '';
        let pos = 0;
        ranges.forEach(([start, end]) => {
            if (end <= pos) return;
            const from = Math.max(start, pos);
            html += `${esc(text.slice(pos, from))}<mark>${esc(text.slice(from, end))}</mark>`;
            pos = end;
        });
        return html + esc(text.slice(pos));
    }

    // Cards show two lines of description. When the first hit is further in
    // than that, start the visible text a few words before it.
    function snippet(text, toks) {
        const lower = text.toLowerCase();
        const hits = toks.map(t => lower.indexOf(t)).filter(i => i >= 0);
        if (!hits.length) return text;
        const first = Math.min(...hits);
        if (first < 90) return text;
        return `…${text.slice(text.lastIndexOf(' ', first - 40) + 1)}`;
    }

    /* ═══════════════════════════════════════════════════════════
       DOM references & view state
       ═══════════════════════════════════════════════════════════ */

    const projectsContainer = document.getElementById('projects-container');
    const searchInput = document.getElementById('search-input');
    const searchClear = document.getElementById('search-clear');
    const searchField = searchInput ? searchInput.closest('.vc-search') : null;
    const pillsEl = document.getElementById('category-pills');
    const topicsEl = document.getElementById('topic-chips');
    const countEl = document.getElementById('result-count');
    const sortOptions = document.getElementById('sort-options');
    const viewButtons = Array.from(document.querySelectorAll('.vc-view button'));
    const searchContainer = document.querySelector('.search-container');
    const sentinel = document.querySelector('.vc-sentinel');

    // Store the original navbar content to restore it later
    const navbar = document.querySelector('.navbar');
    let originalNavbarHTML = null;

    // Flag to track if a game/simulation is active
    let isInteractiveContentActive = false;

    const state = { query: '', category: 'all', topic: null, sort: 'newest', view: 'grid' };

    // The search, category, topic and sort live in the URL, so a search can
    // be shared and survives a round trip into a project and back.
    function readUrl() {
        const params = new URLSearchParams(window.location.search);
        const category = params.get('c');
        const topic = params.get('t');
        const sort = params.get('sort');
        state.query = params.get('q') || '';
        state.category = projects.some(p => p.category === category) ? category : 'all';
        state.topic = TOPICS.some(t => t.id === topic) ? topic : null;
        state.sort = SORTS[sort] ? sort : 'newest';
    }

    function writeUrl() {
        const params = new URLSearchParams();
        if (state.query.trim()) params.set('q', state.query.trim());
        if (state.category !== 'all') params.set('c', state.category);
        if (state.topic) params.set('t', state.topic);
        if (state.sort !== 'newest') params.set('sort', state.sort);
        try {
            const url = new URL(window.location.href);
            url.search = params.toString();
            history.replaceState(null, '', url);
        } catch (e) { /* some file:// setups refuse; the page still works */ }
    }

    // Grid or list is a per-browser preference, not part of a shared link
    function loadView() {
        try { return localStorage.getItem('vc-view') === 'list' ? 'list' : 'grid'; }
        catch (e) { return 'grid'; }
    }

    function saveView(view) {
        try { localStorage.setItem('vc-view', view); } catch (e) { /* private mode */ }
    }

    /* ═══════════════════════════════════════════════════════════
       Cards — built once, reordered and re-highlighted on every search
       ═══════════════════════════════════════════════════════════ */

    function createProjectCard(project) {
        // A real anchor gives keyboard access, middle-click, and link previews for free
        const card = document.createElement('a');
        card.className = 'card';
        card.href = `?project=${encodeURIComponent(project.id)}`;
        const meta = `${esc(CATEGORY_SINGULAR[project.category] || project.category)} · ${formatDate(project.date)}`;
        card.innerHTML = `
            <div class="card-image">
                <img src="${esc(project.thumbnail)}" alt="" loading="lazy" decoding="async" onerror="this.hidden = true; this.nextElementSibling.hidden = false;">
                <div class="card-image-fallback" hidden>
                    <span>${esc(project.title)}</span>
                </div>
            </div>
            <div class="card-content">
                <h3 class="card-title">${esc(project.title)}</h3>
                <p class="card-description">${esc(project.description)}</p>
                <p class="card-match" hidden></p>
                <p class="card-meta">${isNew(project) ? '<span class="card-new">New</span> · ' : ''}${meta}</p>
            </div>
        `;
        card.vcText = {
            title: card.querySelector('.card-title'),
            desc: card.querySelector('.card-description'),
            match: card.querySelector('.card-match'),
            query: ''
        };
        return card;
    }

    // Marks the words in the title and description; a word found only in
    // the tags gets a "Tagged …" line, so every result shows why it matched.
    function paintCard(card, project, toks) {
        const text = card.vcText;
        const key = toks.join(' ');
        if (text.query === key) return;
        text.query = key;

        const f = fields.get(project.id);
        const allInTitle = toks.every(t => f.title.includes(t));
        text.title.innerHTML = highlight(project.title, toks);
        text.desc.innerHTML = highlight(allInTitle ? project.description : snippet(project.description, toks), toks);

        const tagged = [...new Set(toks
            .filter(t => !f.title.includes(t) && !f.desc.includes(t))
            .map(t => project.tags.find(tag => tag.toLowerCase().includes(t)))
            .filter(Boolean))];
        text.match.hidden = !tagged.length;
        text.match.innerHTML = tagged.length
            ? `Tagged ${tagged.map(tag => highlight(tag, toks)).join(', ')}`
            : '';
    }

    const cardEls = new Map(projects.map(p => [p.id, createProjectCard(p)]));

    // .container here rather than on the projects container, which an open
    // project needs at the full width of the window
    const gridEl = document.createElement('div');
    gridEl.className = 'vc-grid container';

    // Remember the gallery as it is (its URL carries the search) so the
    // project's Back button can return to it
    gridEl.addEventListener('click', e => {
        if (!e.target.closest('.card')) return;
        try { sessionStorage.setItem('vc-return', window.location.href); } catch (err) { /* storage blocked */ }
    });

    const emptyEl = document.createElement('div');
    emptyEl.className = 'vc-empty container';
    emptyEl.hidden = true;
    emptyEl.innerHTML = `
        <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
        <strong>No matches</strong>
        <span>Try another word, or clear the filters.</span>
        <div><button type="button">Clear filters</button></div>
    `;
    emptyEl.querySelector('button').addEventListener('click', () => resetFilters());

    /* ═══════════════════════════════════════════════════════════
       Rendering
       ═══════════════════════════════════════════════════════════ */

    function hasFilters() {
        return !!(state.query.trim() || state.category !== 'all' || state.topic);
    }

    function render() {
        const toks = tokenize(state.query);
        const topic = TOPICS.find(t => t.id === state.topic) || null;
        const compare = SORTS[state.sort] || SORTS.newest;

        let list = projects
            .filter(p => state.category === 'all' || p.category === state.category)
            .filter(p => !topic || matchesTopic(p, topic))
            .map(p => ({ p, tier: toks.length ? matchTier(p, toks) : 1 }))
            .filter(r => r.tier > 0)
            .sort((a, b) => (b.tier - a.tier) || compare(a.p, b.p))
            .map(r => r.p);

        // The newest project gets the big tile, but only on the untouched
        // grid: once someone is looking for something it would be in the way.
        // Phones always list, and keep the tile at the top of the list.
        const isPhone = phoneQuery.matches;
        let featuredId = null;
        if (!hasFilters() && state.sort === 'newest' && (state.view === 'grid' || isPhone)) {
            const pick = list.find(p => p.featured !== false);
            if (pick) {
                featuredId = pick.id;
                list = [pick, ...list.filter(p => p !== pick)];
            }
        }

        if (!projectsContainer.contains(gridEl)) projectsContainer.replaceChildren(gridEl, emptyEl);

        gridEl.classList.toggle('is-list', state.view === 'list' || isPhone);
        list.forEach(p => {
            const card = cardEls.get(p.id);
            card.classList.toggle('is-featured', p.id === featuredId);
            paintCard(card, p, toks);
        });
        gridEl.replaceChildren(...list.map(p => cardEls.get(p.id)));
        gridEl.hidden = !list.length;
        emptyEl.hidden = !!list.length;

        if (countEl) {
            const total = projects.length;
            countEl.innerHTML = hasFilters()
                ? `${list.length} of ${total} projects<button type="button">Clear</button>`
                : `${total} projects`;
            const clear = countEl.querySelector('button');
            if (clear) clear.addEventListener('click', () => resetFilters());
        }

        if (searchField) searchField.classList.toggle('has-value', !!state.query);
    }

    // Each change of filter: re-render, remember it in the URL, and if the
    // bar is stuck to the top, bring the first result up under it rather
    // than leaving the reader somewhere in the middle of a shorter page.
    function update() {
        endReveal();
        render();
        writeUrl();
        if (searchContainer && searchContainer.classList.contains('is-stuck') && sentinel) {
            const top = sentinel.getBoundingClientRect().top + window.scrollY - navHeight();
            if (window.scrollY > top) window.scrollTo(0, top);
        }
    }

    function navHeight() {
        return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 52;
    }

    /* ═══════════════════════════════════════════════════════════
       Entrance — first render only, so typing never replays it
       ═══════════════════════════════════════════════════════════ */

    let revealObserver = null;

    function startReveal() {
        if (prefersReducedMotion || !('IntersectionObserver' in window)) return;
        revealObserver = new IntersectionObserver((entries, obs) => {
            let k = 0;
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const card = entry.target;
                card.style.transitionDelay = `${Math.min(k++, 8) * 50}ms`;
                card.classList.remove('is-pending');
                obs.unobserve(card);
                // Drop the stagger once played, or it would delay hover too
                setTimeout(() => { card.style.transitionDelay = ''; }, 1000);
            });
        }, { threshold: 0.05, rootMargin: '0px 0px -40px 0px' });
        gridEl.querySelectorAll('.card').forEach(card => {
            card.classList.add('is-pending');
            revealObserver.observe(card);
        });
    }

    function endReveal() {
        if (!revealObserver) return;
        revealObserver.disconnect();
        revealObserver = null;
        cardEls.forEach(card => {
            card.classList.remove('is-pending');
            card.style.transitionDelay = '';
        });
    }

    /* ═══════════════════════════════════════════════════════════
       Toolbar — categories, topics, sort, layout
       ═══════════════════════════════════════════════════════════ */

    function newestIn(category) {
        return projects
            .filter(p => p.category === category)
            .reduce((max, p) => Math.max(max, parseDate(p.date).getTime()), 0);
    }

    function buildPills() {
        if (!pillsEl) return;

        const counts = projects.reduce((acc, p) => {
            acc[p.category] = (acc[p.category] || 0) + 1;
            return acc;
        }, {});

        // Order categories by how recently each was added to, newest first
        const order = Object.keys(counts).sort((a, b) => newestIn(b) - newestIn(a));

        const buttons = ['all', ...order].map(key => `
            <button type="button" class="vc-pill" data-category="${key}" role="tab" aria-selected="false">
                ${esc(CATEGORY_LABELS[key] || key)}<span class="vc-pill-count">${key === 'all' ? projects.length : counts[key]}</span>
            </button>
        `).join('');

        pillsEl.innerHTML = `<span class="vc-pill-thumb" aria-hidden="true"></span>${buttons}`;

        pillsEl.querySelectorAll('.vc-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                state.category = pill.dataset.category;
                syncControls();
                update();
            });
        });

        window.addEventListener('resize', moveThumb);
        // Pill widths change once the web font swaps in
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(moveThumb);
        }
    }

    function buildTopics() {
        if (!topicsEl) return;
        topicsEl.innerHTML = TOPICS.map(t => `
            <button type="button" class="vc-topic" data-topic="${t.id}" aria-pressed="false">${esc(t.label)}</button>
        `).join('');
        topicsEl.querySelectorAll('.vc-topic').forEach(chip => {
            chip.addEventListener('click', () => {
                state.topic = state.topic === chip.dataset.topic ? null : chip.dataset.topic;
                syncControls();
                update();
            });
        });
    }

    function moveThumb(instant) {
        if (!pillsEl) return;
        const thumb = pillsEl.querySelector('.vc-pill-thumb');
        const active = pillsEl.querySelector('.vc-pill.is-active');
        if (!thumb || !active || !active.offsetWidth) return;
        if (instant === true) thumb.style.transition = 'none';
        thumb.style.width = `${active.offsetWidth}px`;
        thumb.style.height = `${active.offsetHeight}px`;
        thumb.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
        if (instant === true) {
            void thumb.offsetWidth; // commit the jump before transitions return
            thumb.style.transition = '';
        }
    }

    // Puts every control in line with `state`
    function syncControls() {
        if (searchInput && searchInput.value !== state.query) searchInput.value = state.query;
        if (pillsEl) {
            pillsEl.querySelectorAll('.vc-pill').forEach(p => {
                const on = p.dataset.category === state.category;
                p.classList.toggle('is-active', on);
                p.setAttribute('aria-selected', String(on));
            });
            moveThumb();
        }
        if (topicsEl) {
            topicsEl.querySelectorAll('.vc-topic').forEach(chip => {
                chip.setAttribute('aria-pressed', String(chip.dataset.topic === state.topic));
            });
        }
        if (sortOptions) sortOptions.value = state.sort;
        viewButtons.forEach(btn => {
            btn.setAttribute('aria-pressed', String(btn.dataset.view === state.view));
        });
    }

    function resetFilters() {
        state.query = '';
        state.category = 'all';
        state.topic = null;
        syncControls();
        update();
    }

    /* ═══════════════════════════════════════════════════════════
       Interactive mode — a project open full-screen
       ═══════════════════════════════════════════════════════════ */

    function setInteractiveMode(enabled, projectTitle = null) {
        const mainContent = document.getElementById('main-content');

        if (enabled) {
            // Save original navbar HTML if we haven't already
            if (originalNavbarHTML === null) {
                originalNavbarHTML = navbar.innerHTML;
            }

            // Replace navbar content with title and back button
            const navbarContainer = navbar.querySelector('.container');
            navbarContainer.innerHTML = `
                <button id="nav-back-button" class="nav-back-button">
                    <i class="fas fa-arrow-left"></i> Back
                </button>
                <div class="project-title-container">
                    <span class="project-title">${esc(projectTitle || 'Interactive Project')}</span>
                </div>
            `;

            // Back to the gallery as it was left (search and filters) when the
            // project was opened from it; otherwise to the gallery itself.
            // A tab-scoped note rather than document.referrer, which is empty
            // when the site is opened from disk.
            document.getElementById('nav-back-button').addEventListener('click', () => {
                let target = 'index.html';
                try {
                    const saved = sessionStorage.getItem('vc-return');
                    sessionStorage.removeItem('vc-return');
                    if (saved && new URL(saved).pathname === window.location.pathname) target = saved;
                } catch (e) { /* storage blocked */ }
                window.location.href = target;
            });

            // Re-initialize dark mode toggle
            if (typeof initDarkModeToggle === 'function') {
                initDarkModeToggle();
            }

            mainContent.classList.add('interactive-mode');
            document.body.classList.add('interactive-mode');
        } else {
            // Restore original navbar
            if (originalNavbarHTML !== null) {
                navbar.innerHTML = originalNavbarHTML;

                // Re-initialize dark mode toggle
                if (typeof initDarkModeToggle === 'function') {
                    initDarkModeToggle();
                }
            }

            mainContent.classList.remove('interactive-mode');
            document.body.classList.remove('interactive-mode');
        }

        isInteractiveContentActive = enabled;
    }

    // Function to load a specific project
    function loadProject(projectId) {
        const project = projects.find(p => p.id === projectId);

        if (project) {
            // Hide the gallery chrome while a project is open
            if (searchContainer) searchContainer.style.display = 'none';

            // Clear the main content
            projectsContainer.innerHTML = '';

            // Create project container with maximum height
            const projectFrame = document.createElement('div');
            projectFrame.style.width = '100%';
            projectFrame.style.height = 'calc(100vh - 35px)'; // Reduced to 35px for ultra-thin navbar in interactive mode
            projectFrame.style.border = 'none';
            projectFrame.style.display = 'flex';
            projectFrame.style.flexDirection = 'column';
            projectFrame.style.position = 'relative'; // For absolute positioning of overlay elements
            projectFrame.style.marginTop = '0'; // Remove margin to push it up

            // Determine project type if not explicitly set
            const projectType = project.type || getProjectTypeFromPath(project.path);

            // Set interactive mode based on project type with project title
            setInteractiveMode(projectType === 'iframe' || projectType === 'canvas', project.title);

            // Load project based on type
            switch(projectType) {
                case 'iframe':
                    loadIframeProject(project, projectFrame);
                    break;
                case 'canvas':
                    loadCanvasProject(project, projectFrame);
                    break;
                default:
                    // Default fallback
                    setInteractiveMode(false);
                    projectFrame.innerHTML += `
                        <div style="padding: 20px; background-color: var(--bg-secondary); border-radius: 8px; min-height: calc(100vh - 250px);">
                            <p>Project content would load here. This is a placeholder for ${esc(project.title)}.</p>
                            <p>In a real implementation, this would load the project's content from: ${esc(project.path)}</p>
                        </div>
                    `;
            }

            projectsContainer.appendChild(projectFrame);

            // Update title and history state. replaceState (not pushState): this runs
            // on initial load of ?project=… pages, and pushing would duplicate the
            // entry so the back button needs two presses to leave.
            document.title = `${project.title} - Vibe Code`;
            history.replaceState({projectId: project.id}, '', `?project=${project.id}`);
        } else {
            // Project not found, redirect to projects list
            window.location.href = 'index.html';
        }
    }

    // Function to determine project type from file path
    function getProjectTypeFromPath(path) {
        const extension = path.split('.').pop().toLowerCase();

        switch(extension) {
            case 'html':
                return 'iframe';
            case 'js':
                return 'canvas'; // Assume JS files are for canvas-based projects
            default:
                return 'unknown';
        }
    }

    // Function to load iframe-based projects
    function loadIframeProject(project, container) {
        const iframeContainer = document.createElement('div');
        iframeContainer.style.width = '100%';
        iframeContainer.style.height = '100%'; // Take full height of parent
        iframeContainer.style.position = 'relative';
        iframeContainer.style.margin = '0';
        iframeContainer.style.overflow = 'hidden';
        iframeContainer.style.borderRadius = '0'; // Remove border radius to maximize space
        iframeContainer.style.flex = '1'; // Take remaining space
        iframeContainer.classList.add('interactive-container');

        // Create iframe
        const iframe = document.createElement('iframe');
        iframe.src = `../vibe-code/${project.path}`;
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.style.overflow = 'hidden';
        iframe.id = 'interactive-iframe';

        iframeContainer.appendChild(iframe);
        container.appendChild(iframeContainer);

        // Focus handling for keyboard events
        iframe.addEventListener('load', () => {
            setupKeyboardControl(iframe, iframeContainer);
        });
    }

    // Function to load canvas-based projects
    function loadCanvasProject(project, container) {
        // Create game container
        const gameContainer = document.createElement('div');
        gameContainer.id = 'game-container';
        gameContainer.style.width = '100%';
        gameContainer.style.height = '100%'; // Take full height of parent
        gameContainer.style.position = 'relative';
        gameContainer.style.margin = '0';
        gameContainer.style.backgroundColor = 'var(--bg-secondary)';
        gameContainer.style.overflow = 'hidden';
        gameContainer.style.borderRadius = '0'; // Remove border radius to maximize space
        gameContainer.style.flex = '1'; // Take remaining space
        gameContainer.classList.add('interactive-container');

        // Create canvas for the game
        const canvas = document.createElement('canvas');
        canvas.id = project.canvasId || 'game-canvas'; // Use project's canvas ID or default
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight - 35; // Reduced to 35px for ultra-thin navbar
        canvas.style.backgroundColor = '#000';
        canvas.style.display = 'block';
        canvas.style.width = '100%';
        canvas.style.height = '100%';

        gameContainer.appendChild(canvas);
        container.appendChild(gameContainer);

        // Add instructions if available
        if (project.instructions) {
            const instructions = document.createElement('div');
            instructions.style.padding = '20px';
            instructions.style.textAlign = 'center';
            instructions.style.marginTop = '10px';
            instructions.innerHTML = project.instructions;
            container.appendChild(instructions);
        }

        // Load the project's JavaScript
        const script = document.createElement('script');
        script.src = `../vibe-code/${project.path}`;
        document.body.appendChild(script);

        // Set a small timeout to ensure the DOM is fully ready
        setTimeout(() => {
            // Force resize canvas to fill container
            const gameCanvas = document.getElementById(canvas.id);
            if (gameCanvas) {
                const containerWidth = gameContainer.clientWidth;
                const containerHeight = gameContainer.clientHeight;
                gameCanvas.width = containerWidth;
                gameCanvas.height = containerHeight;
            }

            // Setup keyboard control for canvas games
            setupKeyboardControl(canvas, gameContainer);
        }, 100);

        // Add event listener for window resize to keep canvas sized correctly
        window.addEventListener('resize', () => {
            const gameCanvas = document.getElementById(canvas.id);
            if (gameCanvas) {
                const containerWidth = gameContainer.clientWidth;
                const containerHeight = gameContainer.clientHeight;
                gameCanvas.width = containerWidth;
                gameCanvas.height = containerHeight;
            }
        });
    }

    // Function to setup keyboard control and prevent default scrolling
    function setupKeyboardControl(element, container) {
        // Track focus state
        let hasFocus = false;

        // Add focus indicator
        container.style.position = 'relative';

        // When user clicks on the interactive element
        container.addEventListener('click', function() {
            hasFocus = true;
            container.style.boxShadow = '0 0 0 2px rgba(66, 153, 225, 0.5)';

            // Try to focus the element
            if (element.contentWindow) {
                // For iframes
                element.contentWindow.focus();
            } else {
                // For canvas and other elements
                element.focus();
            }
        });

        // When user clicks elsewhere
        document.addEventListener('click', function(e) {
            if (!container.contains(e.target)) {
                hasFocus = false;
                container.style.boxShadow = 'none';
            }
        });

        // Prevent default scrolling behavior when arrows are used and container has focus
        document.addEventListener('keydown', function(e) {
            // Check if the interactive content has focus
            if (hasFocus || isInteractiveContentActive) {
                // Prevent default for arrow keys, space and other gaming-related keys
                if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Space', 'w', 'a', 's', 'd'].includes(e.key)) {
                    e.preventDefault();
                }
            }
        }, { passive: false });

        // Add touch support for mobile
        container.addEventListener('touchstart', function() {
            hasFocus = true;
            container.style.boxShadow = '0 0 0 2px rgba(66, 153, 225, 0.5)';
        });
    }

    /* ═══════════════════════════════════════════════════════════
       Boot
       ═══════════════════════════════════════════════════════════ */

    if (searchInput) {
        searchInput.placeholder = `Search ${projects.length} projects`;
        searchInput.addEventListener('input', () => {
            state.query = searchInput.value;
            update();
        });
        searchInput.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                if (searchInput.value) {
                    state.query = '';
                    syncControls();
                    update();
                } else {
                    searchInput.blur();
                }
            } else if (e.key === 'Enter' && window.matchMedia('(hover: none)').matches) {
                searchInput.blur(); // put the phone keyboard away
            }
        });
    }

    if (searchClear) {
        searchClear.addEventListener('click', () => {
            state.query = '';
            syncControls();
            update();
            if (searchInput) searchInput.focus();
        });
    }

    if (sortOptions) {
        sortOptions.addEventListener('change', () => {
            state.sort = sortOptions.value;
            update();
        });
    }

    viewButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            state.view = btn.dataset.view;
            saveView(state.view);
            syncControls();
            update();
        });
    });

    // "/" focuses search from anywhere on the gallery
    document.addEventListener('keydown', e => {
        if (isInteractiveContentActive || !searchInput) return;
        const typing = e.target.closest && e.target.closest('input, select, textarea, [contenteditable]');
        if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            searchInput.focus();
            searchInput.select();
        }
    });

    // The bar gets its fill and hairline only once it is stuck under the nav
    if (sentinel && searchContainer && 'IntersectionObserver' in window) {
        new IntersectionObserver(([entry]) => {
            searchContainer.classList.toggle('is-stuck',
                !entry.isIntersecting && entry.boundingClientRect.top < navHeight() + 1);
        }, { rootMargin: `-${navHeight() + 1}px 0px 0px 0px` }).observe(sentinel);
    }

    function showGallery() {
        if (searchContainer) searchContainer.style.display = '';
        setInteractiveMode(false);
        readUrl();
        syncControls();
        moveThumb(true);
        render();
    }

    buildPills();
    buildTopics();
    state.view = loadView();

    // Check if we need to load a specific project
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('project');

    if (projectId) {
        loadProject(projectId);
    } else {
        showGallery();
        startReveal();
    }

    // Phones always list; crossing the breakpoint changes the layout
    phoneQuery.addEventListener('change', () => {
        if (!isInteractiveContentActive) render();
    });

    // Handle browser back/forward navigation
    window.addEventListener('popstate', (event) => {
        if (event.state && event.state.projectId) {
            loadProject(event.state.projectId);
        } else {
            isInteractiveContentActive = false; // Reset flag when returning to project list
            showGallery();
            document.title = 'Vibe Code - Projects Gallery';
        }
    });
});
