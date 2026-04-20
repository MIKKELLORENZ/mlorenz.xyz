// --- DOM Elements ---
const gameContainer = document.getElementById('game-container');
const reelElements = [
    document.getElementById('reel1'),
    document.getElementById('reel2'),
    document.getElementById('reel3')
];
const reelStripElements = reelElements.map(r => r.querySelector('.reel-strip'));
const coinElement = document.getElementById('coin');
const coinSlotElement = document.getElementById('coin-slot');
const turnsLeftElement = document.getElementById('turns-left');
const creditsElement = document.getElementById('credits');
const paytableElement = document.getElementById('paytable');
const paytableContentElement = document.getElementById('paytable-content');
const paytableToggleBtn = document.getElementById('paytable-toggle');
const paytableCloseBtn = document.getElementById('paytable-close');
const messageOverlay = document.getElementById('message-overlay');
const messageText = document.getElementById('message-text');
const slotArmElement = document.getElementById('slot-arm'); // Add arm element
const armHandleElement = document.getElementById('arm-handle'); // Add reference to the handle

// --- Game Configuration (Embedded) ---
const config = {
  "symbols": [
    {"id": "A", "display": "猫", "weight": 1, "pay": 2000}, // Cat (Neko) - Jackpot
    {"id": "B", "display": "竜", "weight": 2, "pay": 600},  // Dragon (Ryu)
    {"id": "C", "display": "侍", "weight": 3, "pay": 220},  // Samurai
    {"id": "D", "display": "忍", "weight": 4, "pay": 90},   // Ninja (Shinobi)
    {"id": "E", "display": "桜", "weight": 5, "pay": 40},   // Cherry Blossom (Sakura)
    {"id": "F", "display": "¥", "weight": 5, "pay": 20},    // Yen Symbol
    {"id": "G", "display": "7", "weight": 6, "pay": 10},    // Lucky 7
    {"id": "H", "display": "BAR", "weight": 6, "pay": 5}    // BAR
  ],
  "reelsCount": 3,
  "virtualReelSize": 32,
  "slotHeight": 60, // <<< ADD THIS: Define the height of a single symbol slot in pixels
  "spinDuration": 2200, // ms (2.2 seconds)
  "stopDelay": 150, // ms delay between reel stops
  "nearMissWindow": 1, // How many symbols away counts as near miss (1 = adjacent)
  "nearMissRateTarget": 0.30, // Target near-miss rate on non-winning spins
  "initialTurns": 3,
  "sounds": {
      "coin": "sounds/coin_insert.wav", // Placeholder paths
      "spin": "sounds/reel_spin.wav",
      "stop": "sounds/reel_stop.wav",
      "win": "sounds/win_jingle.wav",
      "bigWin": "sounds/big_win.wav",
      "lose": "sounds/lose_thud.wav"
  }
};

// --- Game State ---
let turns = 0;
let credits = 0;
let virtualReels = [];
let isSpinning = false;
let stopRequests = [false, false, false]; // Track stop requests for each reel
let spinResult = []; // Stores the final symbols for each reel
let spinTimeoutIds = []; // Stores timeouts for stopping reels
let animationIntervalIds = []; // Stores intervals for reel animation
let animationFrameIds = []; // Replace animationIntervalIds
let lastFrameTime = []; // Track time for smooth animation speed

// --- Audio ---
// Basic audio handling (replace with more robust library if needed)
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const sounds = {}; // Stores loaded AudioBuffers

function loadSound(name, url) {
    // Check if AudioContext is available and in a usable state
    if (!audioContext || audioContext.state === 'closed') {
        console.warn(`AudioContext not available or closed, cannot load sound: ${name}`);
        return;
    }
    fetch(url)
        .then(response => {
            if (!response.ok) {
                // Don't throw an error, just warn if fetch fails (e.g., 404)
                console.warn(`Failed to fetch sound ${name}: ${response.statusText}`);
                return null; // Indicate failure
            }
            return response.arrayBuffer();
        })
        .then(arrayBuffer => {
            if (!arrayBuffer) return; // Don't proceed if fetch failed
            // Decode audio data safely
            return audioContext.decodeAudioData(arrayBuffer).catch(decodeError => {
                 console.warn(`Error decoding sound ${name}:`, decodeError.message);
                 return null; // Indicate failure
            });
        })
        .then(audioBuffer => {
            if (audioBuffer) {
                sounds[name] = audioBuffer;
                console.log(`Sound loaded: ${name}`);
            }
        })
        .catch(error => {
            // Catch any other unexpected errors during fetch/decode process
            console.warn(`Could not load sound ${name}:`, error.message);
        });
}

function playSound(name) {
    // Check if sound exists in our loaded sounds object and context is running
    if (sounds[name] && audioContext.state === 'running') {
        try {
            const source = audioContext.createBufferSource();
            source.buffer = sounds[name];
            source.connect(audioContext.destination);
            source.start(0);
        } catch (e) {
             console.warn(`Error playing sound ${name}:`, e.message);
        }
    } else if (audioContext.state === 'suspended') {
         console.log('AudioContext suspended. User interaction needed to play sound.');
         // Silently fail if suspended, user needs to interact first
    } else if (!sounds[name]) {
        // console.log(`Sound not loaded, skipping playback: ${name}`); // Optional: Log skipped playback
        // Silently fail if sound wasn't loaded
    }
}

// --- Initialization ---
function initializeGame() {
    try {
        console.log("Game config loaded (embedded):", config);

        // Load sounds
        Object.entries(config.sounds).forEach(([name, url]) => loadSound(name, url));

        buildVirtualReels();
        populateReelStrips(); // Initial display
        setupEventListeners();
        updateStatusDisplay();
        populatePaytable();
        showMessage("DRAG ¥ COIN TO SLOT", false); // Initial instruction

    } catch (error) {
        console.error("Error initializing game:", error);
        showMessage("ERROR INITIALIZING GAME", true);
    }
     // Resume AudioContext on first user interaction (like coin drag)
    const resumeAudio = () => {
        if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => console.log('AudioContext resumed.'));
        }
        document.body.removeEventListener('click', resumeAudio);
        document.body.removeEventListener('touchend', resumeAudio);
        document.body.removeEventListener('keydown', resumeAudio);
    };
    document.body.addEventListener('click', resumeAudio);
    document.body.addEventListener('touchend', resumeAudio);
    document.body.addEventListener('keydown', resumeAudio);
}

// --- Reel Logic ---
function buildVirtualReels() {
    virtualReels = [];
    
    // Create more realistic virtual reels - each reel is uniquely shuffled
    for (let i = 0; i < config.reelsCount; i++) {
        const reel = [];
        // Fill reel according to symbol weights
        config.symbols.forEach(symbol => {
            for (let j = 0; j < symbol.weight; j++) {
                reel.push(symbol.id);
            }
        });
        
        // Ensure length matches virtualReelSize
        while (reel.length < config.virtualReelSize) {
            reel.push(config.symbols[config.symbols.length - 1].id);
        }
        if (reel.length > config.virtualReelSize) {
            reel.length = config.virtualReelSize;
        }
        
        // Shuffle this reel specifically - creates a unique strip for each reel
        const shuffledReel = reel.sort(() => Math.random() - 0.5);
        virtualReels.push(shuffledReel);
    }
    
    console.log("Virtual reels built with unique strips:", virtualReels);
}

function getSymbolById(id) {
    return config.symbols.find(s => s.id === id);
}

function populateReelStrips() {
    reelStripElements.forEach((strip, reelIndex) => {
        strip.innerHTML = ''; // Clear existing
        // Populate with symbols for visual effect (more than visible needed for scroll)
        const symbolsToDisplay = 10; // Number of symbols in the strip for animation
        const reel = virtualReels[reelIndex];
        let symbolIndex = 0;
        for (let i = 0; i < symbolsToDisplay; i++) {
            const symbolId = reel[symbolIndex % reel.length];
            const symbolData = getSymbolById(symbolId);
            const div = document.createElement('div');
            div.classList.add('symbol');
            div.textContent = symbolData.display;
            div.dataset.symbolId = symbolId; // Store id for later checks
            strip.appendChild(div);
            symbolIndex++;
        }
        // Position strip to show the 'middle' symbol initially (adjust as needed)
        // Ensure config.slotHeight is available here
        const initialTop = -(Math.floor(symbolsToDisplay / 3) * config.slotHeight) + (config.slotHeight / 2 - 30); // Adjusted for proper centering
        console.log(`Reel ${reelIndex} initial top: ${initialTop}`);
        strip.style.top = `${initialTop}px`;
    });
}

function spinReels() {
    if (isSpinning || turns <= 0) {
        console.log(`Spin prevented: isSpinning=${isSpinning}, turns=${turns}`);
        return; // Exit if already spinning or no turns
    }

    console.log("Spinning...");
    isSpinning = true;
    turns--;
    stopRequests = [false, false, false];
    spinResult = [];
    let resultIndices = [];

    spinTimeoutIds = [];
    animationIntervalIds = [];
    clearMessages();
    resetReelStyles();
    updateStatusDisplay();
    playSound('spin'); // Play spin start sound

    // --- Realistic Slot Machine Mechanics ---
    // Each reel is a separate virtual strip, so pick a random stop for each reel independently
    for (let i = 0; i < config.reelsCount; i++) {
        const randomIndex = Math.floor(Math.random() * virtualReels[i].length);
        resultIndices.push(randomIndex);
        spinResult.push(virtualReels[i][randomIndex]);
    }
    console.log("Initial Random Result:", spinResult.join('-'), "Indices:", resultIndices.join(','));

    // --- Check for Win & Apply Near-Miss Logic ---
    const isNaturalWin = spinResult.every(s => s === spinResult[0]);
    let finalOutcomeType = isNaturalWin ? 'win' : 'loss';

    // Only force a near-miss if not a win, and only on a true loss (not already a near-miss)
    if (
        !isNaturalWin &&
        Math.random() < config.nearMissRateTarget &&
        !((spinResult[0] === spinResult[1] && spinResult[1] !== spinResult[2]) ||
          (spinResult[1] === spinResult[2] && spinResult[0] !== spinResult[1]))
    ) {
        console.log("Attempting to force near-miss...");
        finalOutcomeType = 'near-miss';

        // Decide pattern: 50% X-X-O, 50% O-X-X
        if (Math.random() < 0.5) { // X-X-O
            // Pick a symbol for reels 0 and 1
            const symbolToMatch = spinResult[0];
            resultIndices[1] = virtualReels[1].findIndex(s => s === symbolToMatch);
            spinResult[1] = symbolToMatch;

            // For reel 2, pick a symbol that is NOT symbolToMatch
            let possibleIndices = virtualReels[2]
                .map((s, idx) => ({s, idx}))
                .filter(obj => obj.s !== symbolToMatch);
            if (possibleIndices.length === 0) possibleIndices = virtualReels[2].map((s, idx) => ({s, idx}));
            const pick = possibleIndices[Math.floor(Math.random() * possibleIndices.length)];
            resultIndices[2] = pick.idx;
            spinResult[2] = pick.s;
            console.log(`Forced Near-Miss (X-X-O): ${spinResult.join('-')}`);
        } else { // O-X-X
            // Pick a symbol for reels 1 and 2
            const symbolToMatch = spinResult[1];
            resultIndices[2] = virtualReels[2].findIndex(s => s === symbolToMatch);
            spinResult[2] = symbolToMatch;

            // For reel 0, pick a symbol that is NOT symbolToMatch
            let possibleIndices = virtualReels[0]
                .map((s, idx) => ({s, idx}))
                .filter(obj => obj.s !== symbolToMatch);
            if (possibleIndices.length === 0) possibleIndices = virtualReels[0].map((s, idx) => ({s, idx}));
            const pick = possibleIndices[Math.floor(Math.random() * possibleIndices.length)];
            resultIndices[0] = pick.idx;
            spinResult[0] = pick.s;
            console.log(`Forced Near-Miss (O-X-X): ${spinResult.join('-')}`);
        }
    } else {
        console.log(`Outcome is natural: ${isNaturalWin ? 'Win' : 'Loss'}`);
    }
    // --- End Near-Miss Logic ---


    console.log("Final Predetermined Result:", spinResult.join('-'), "Indices:", resultIndices.join(','));
    console.log("Using slotHeight:", config.slotHeight); // Log slotHeight

    // --- Animation Setup ---
    lastFrameTime = [0, 0, 0]; // Reset frame times
    animationFrameIds = []; // Reset frame IDs

    // Show message about using spacebar
    showMessage("HIT SPACE TO STOP REELS", true);

    // 2. Start visual spinning animation for each reel using requestAnimationFrame
    reelElements.forEach((reel, i) => {
        reel.classList.add('spinning');
        const strip = reelStripElements[i];
        const symbolHeight = config.slotHeight; // Use the defined height
        // Add check for valid symbolHeight
        if (!symbolHeight || symbolHeight <= 0) {
            console.error("Invalid symbolHeight defined in config:", symbolHeight);
            return; // Stop animation if height is invalid
        }
        const virtualReel = virtualReels[i];
        let currentTop = parseFloat(strip.style.top) || 0;
        const symbolsInStrip = strip.children.length;
        const totalStripHeight = symbolsInStrip * symbolHeight;

        // --- Animation Loop Function ---
        const animateReel = (timestamp) => {
            if (!isSpinning || stopRequests[i]) { // Stop animation if requested or game stopped
                 cancelAnimationFrame(animationFrameIds[i]);
                 animationFrameIds[i] = null;
                 return;
            }

            if (!lastFrameTime[i]) {
                lastFrameTime[i] = timestamp;
            }
            const deltaTime = timestamp - lastFrameTime[i];
            lastFrameTime[i] = timestamp;

            // Avoid huge jumps on first frame or after lag
            if (deltaTime > 100) { // If more than 100ms passed, skip frame logic
                console.warn(`Large deltaTime detected on reel ${i}: ${deltaTime}ms. Skipping frame.`);
                animationFrameIds[i] = requestAnimationFrame(animateReel);
                return;
            }


            // Calculate scroll distance based on time and desired speed
            const speedFactor = 1.5;
            const scrollAmount = (symbolHeight * speedFactor * deltaTime) / 50;

            // Log values for debugging
            // console.log(`Reel ${i} - Timestamp: ${timestamp.toFixed(0)}, Delta: ${deltaTime.toFixed(1)}, Scroll: ${scrollAmount.toFixed(2)}, Old Top: ${currentTop.toFixed(2)}`);

            currentTop -= scrollAmount;

            // --- Wrap Around Logic ---
            if (currentTop <= -symbolHeight) {
                const wrappedSymbols = Math.floor(Math.abs(currentTop / symbolHeight));
                currentTop += wrappedSymbols * symbolHeight; // Adjust top by multiples of symbolHeight

                // Move the top symbols to the bottom
                for (let w = 0; w < wrappedSymbols; w++) {
                    const firstChild = strip.firstChild;
                    if (!firstChild) break; // Safety check
                    strip.appendChild(firstChild);

                    // Update the content of the moved symbol
                    const secondLastSymbolId = strip.children[symbolsInStrip - 2]?.dataset.symbolId; // Use optional chaining
                    let lastVirtualIndex = secondLastSymbolId ? virtualReel.indexOf(secondLastSymbolId) : -1;
                    if (lastVirtualIndex === -1) {
                         // Fallback: try finding index of the last symbol if second-last failed
                         const lastSymbolId = strip.children[symbolsInStrip - 1]?.dataset.symbolId;
                         lastVirtualIndex = lastSymbolId ? virtualReel.indexOf(lastSymbolId) : 0; // Default to 0 if all else fails
                         console.warn(`Could not find second-last symbol, using last symbol index: ${lastVirtualIndex}`);
                    }

                    const nextVirtualIndex = (lastVirtualIndex + 1) % virtualReel.length;
                    const nextSymbolData = getSymbolById(virtualReel[nextVirtualIndex]);

                    if (nextSymbolData) {
                        firstChild.textContent = nextSymbolData.display;
                        firstChild.dataset.symbolId = nextSymbolData.id;
                    } else {
                        console.error(`Could not find symbol data for virtual index ${nextVirtualIndex}`);
                        firstChild.textContent = '?'; // Placeholder for error
                        firstChild.dataset.symbolId = '';
                    }
                }

                // Adjust the strip's top instantly
                strip.style.transition = 'none';
                strip.style.top = `${currentTop}px`;
            } else {
                 // Apply smooth scrolling
                 strip.style.transition = 'none';
                 strip.style.top = `${currentTop}px`;
            }
            // console.log(`Reel ${i} - New Top: ${currentTop.toFixed(2)}`);


            // Request the next frame
            animationFrameIds[i] = requestAnimationFrame(animateReel);
        };
        // --- End Animation Loop Function ---

        // --- Start Animation with Delay ---
        const startDelay = Math.random() * 150; // Random delay up to 150ms
        setTimeout(() => {
            // Ensure the game hasn't been stopped before starting animation
            if (!isSpinning) return;
            // Start the animation loop
            animationFrameIds[i] = requestAnimationFrame(animateReel);
        }, startDelay);

        // REMOVE automatic stop timing - we'll only stop with spacebar
        // spinTimeoutIds[i] = setTimeout(() => {
        //     stopRequests[i] = true;
        //     stopReel(i, resultIndices[i]);
        // }, stopTime);
    });
    
    // Store resultIndices globally for use in spacebar handler
    window.currentResultIndices = resultIndices;
}

function stopReel(reelIndex, finalIndex) {
    // Signal animation loop to stop (redundant if already set by timeout, but safe)
    stopRequests[reelIndex] = true;
    // Cancel scheduled automatic stop if manually stopped via spacebar
    clearTimeout(spinTimeoutIds[reelIndex]);
    spinTimeoutIds[reelIndex] = null;
    // Cancel the animation frame loop if it's still running
    if (animationFrameIds[reelIndex]) {
        cancelAnimationFrame(animationFrameIds[reelIndex]);
        animationFrameIds[reelIndex] = null;
    }
    lastFrameTime[reelIndex] = 0; // Reset last frame time

    reelElements[reelIndex].classList.remove('spinning');
    playSound('stop'); // Play stop sound for this reel

    const strip = reelStripElements[reelIndex];
    const symbolHeight = config.slotHeight;
    const symbolsInStrip = strip.children.length;
    const virtualReel = virtualReels[reelIndex];

    // --- Final Symbol Placement ---
    // Update the symbols in the visible area directly to ensure correctness
    const centerIndexInStrip = Math.floor(symbolsInStrip / 3); // e.g., index 1 if 3 visible
    for (let i = -1; i <= 1; i++) { // Update center, one above, one below
        const stripElementIndex = centerIndexInStrip + i;
        if (stripElementIndex >= 0 && stripElementIndex < symbolsInStrip) {
            const virtualIndex = (finalIndex + i + virtualReel.length) % virtualReel.length;
            const symbolData = getSymbolById(virtualReel[virtualIndex]);
            const symbolElement = strip.children[stripElementIndex];
            symbolElement.textContent = symbolData.display;
            symbolElement.dataset.symbolId = symbolData.id;
        }
    }

    // Calculate the exact final 'top' position to center the target symbol.
    // The symbol at `finalIndex` should be displayed by the DOM element at `centerIndexInStrip`.
    // We need to calculate the 'top' value that aligns this correctly.
    // This depends on how the strip is initially populated and positioned.
    // Let's assume initial position centers the symbol at index `Math.floor(symbolsToDisplay / 3)`.
    // The final position should also center the symbol at `centerIndexInStrip`.
    const finalTop = -((centerIndexInStrip -1) * symbolHeight) + (symbolHeight / 2 - 30); // Adjust calculation for centering
    console.log(`Reel ${reelIndex} finalTop calculated: ${finalTop} (centerIndex: ${centerIndexInStrip})`);

    // Apply smooth transition to the final position
    strip.style.transition = 'top 0.4s cubic-bezier(0.25, 1, 0.5, 1)'; // Smoother ease-out
    strip.style.top = `${finalTop}px`;

    // Add subtle bounce effect (optional) - Apply after the main stop animation
    setTimeout(() => {
        strip.style.transition = 'top 0.15s ease-in';
        strip.style.top = `${finalTop + 8}px`; // Small bounce down
        setTimeout(() => {
             strip.style.transition = 'top 0.1s ease-out';
             strip.style.top = `${finalTop}px`; // Back to final position
             // Check if all reels have stopped AFTER the bounce animation finishes
             if (reelElements.every(r => !r.classList.contains('spinning')) && animationFrameIds.every(id => id === null)) {
                 finishSpin();
             }
        }, 150);
    }, 400); // Start bounce after the 400ms stop animation

    console.log(`Reel ${reelIndex + 1} stopped at: ${spinResult[reelIndex]}`);

    // After stopping a reel, update message about next reel
    let nextReelToStop = stopRequests.findIndex((stopped, idx) => !stopped && idx > reelIndex);
    if (nextReelToStop !== -1) {
        showMessage(`HIT SPACE TO STOP REEL ${nextReelToStop + 1}`, true);
    } else {
        // If no more reels to stop, clear the message
        if (reelElements.every(r => !r.classList.contains('spinning'))) {
            clearMessages();
        }
    }
}

function finishSpin() {
    isSpinning = false;
    console.log("All reels stopped. Final result:", spinResult);
    evaluateResult(spinResult);
}

function evaluateResult(result) {
    let payout = 0;
    let win = false;
    let nearMiss = false; // We'll re-evaluate here based on the final result passed in
    const firstSymbol = result[0];
    const symbolData = getSymbolById(firstSymbol);

    // Check for actual 3-of-a-kind win
    if (result.every(s => s === firstSymbol)) {
        payout = symbolData.pay;
        win = true;
        console.log(`WIN! ${result.join('-')}, Payout: ${payout}`);
        highlightWin(result);
        playSound(payout >= config.bigWinThreshold || 50 ? 'bigWin' : 'win'); // Use threshold if defined
        showMessage(`${symbolData.display} x 3! WIN ${payout}`, false);
    } else {
        // Check if it ended up as a near miss pattern (even if forced)
        if ((result[0] === result[1] && result[1] !== result[2]) ||
            (result[1] === result[2] && result[0] !== result[1])) {
            nearMiss = true;
            console.log(`Near Miss: ${result.join('-')}`);
            highlightNearMiss(result);
            playSound('lose'); // Or a specific near-miss sound
            showMessage("SO CLOSE!", false);
        } else {
            // Standard loss
            console.log(`Loss: ${result.join('-')}`);
            playSound('lose');
             // No message for standard loss
        }
    }

    credits += payout;
    updateStatusDisplay();

    // Log the outcome (win/nearMiss flags determined above)
    logOutcome(result, payout, win, nearMiss);

    // Check if out of turns
    if (turns <= 0) {
        console.log("Out of turns.");
        showMessage("OUT OF TURNS. INSERT COIN.", true);
        // Optionally disable spin button or require coin again
    }
}

function highlightWin(result) {
    reelElements.forEach((reel, i) => {
        if (result[i] === result[0]) { // Assuming win is always 3 of the same
            reel.classList.add('winning');
            // Highlight the center symbol element
             const centerIndexInStrip = Math.floor(reelStripElements[i].children.length / 3);
             reelStripElements[i].children[centerIndexInStrip].classList.add('winning');
        }
    });
}

function highlightNearMiss(result) {
     reelElements.forEach((reel, i) => {
        // Highlight reels involved in the near miss pattern
        if ((result[0] === result[1] && (i === 0 || i === 1)) ||
            (result[1] === result[2] && (i === 1 || i === 2))) {
             reel.classList.add('near-miss');
        }
    });
}


function resetReelStyles() {
    reelElements.forEach(reel => {
        reel.classList.remove('winning', 'near-miss');
    });
     reelStripElements.forEach(strip => {
        Array.from(strip.children).forEach(symbol => symbol.classList.remove('winning'));
    });
}


function logOutcome(result, payout, isWin, isNearMiss) {
    const timestamp = new Date().toISOString();
    let outcomeType = 'loss';
    if (isWin) outcomeType = 'win';
    else if (isNearMiss) outcomeType = 'near-miss';
    // LDW (Loss Disguised as Win) would require multi-line bets and comparing payout vs bet

    console.log(`[LOG] ${timestamp} | Result: ${result.join('-')} | Payout: ${payout} | Outcome: ${outcomeType} | Turns Left: ${turns}`);
    // In a real study, send this data to a server or store locally.
}

// --- UI and Interactions ---
function updateStatusDisplay() {
    turnsLeftElement.textContent = turns;
    creditsElement.textContent = credits;
}

function showMessage(text, persistent = false) {
    console.log(`Showing message: "${text}", Persistent: ${persistent}`);
    messageText.textContent = text;
    messageOverlay.classList.remove('hidden');
    console.log('messageOverlay classes after remove hidden:', messageOverlay.classList);
    if (!persistent) {
        // Clear any existing timeout to prevent overlaps
        if (showMessage.timeoutId) {
            clearTimeout(showMessage.timeoutId);
        }
        showMessage.timeoutId = setTimeout(clearMessages, 2000); // Auto-hide non-persistent messages
    } else {
         // Clear timeout if switching to a persistent message
         if (showMessage.timeoutId) {
            clearTimeout(showMessage.timeoutId);
            showMessage.timeoutId = null;
        }
    }
}
showMessage.timeoutId = null; // Initialize timeout tracker

function clearMessages() {
    console.log('Clearing messages...');
    // Ensure the timeout reference is cleared if cleared manually (e.g., by click)
    if (showMessage.timeoutId) {
        clearTimeout(showMessage.timeoutId);
        showMessage.timeoutId = null;
    }
    messageOverlay.classList.add('hidden');
    messageText.textContent = '';
    console.log('messageOverlay classes after add hidden:', messageOverlay.classList);
}

function populatePaytable() {
    let tableHtml = `Symbol | 3-in-a-row Pays\n`;
    tableHtml += `-------|----------------\n`;
    config.symbols.forEach(s => {
        tableHtml += `   ${s.display}   | ${s.pay} credits\n`;
    });
    paytableContentElement.textContent = tableHtml;
}

function togglePaytable() {
    console.log('Toggling paytable visibility.'); // Add log here too
    paytableElement.classList.toggle('hidden');
    console.log('Paytable classes after toggle:', paytableElement.classList);
}

function handleSpacebar(event) {
    if (event.code === 'Space') {
        event.preventDefault(); // Prevent default space bar action (scrolling)
        if (isSpinning) {
            // Find the first reel that is still spinning and hasn't received a stop request
            const reelToStop = stopRequests.findIndex((requested, index) =>
                !requested && animationFrameIds[index] !== null); // Check animationFrameIds

            if (reelToStop !== -1) {
                console.log(`Manual stop requested for reel ${reelToStop + 1}`);
                // Signal the animation loop to stop and trigger the stopReel function
                stopRequests[reelToStop] = true;

                // Use stored resultIndices for correct stopping
                if (window.currentResultIndices && window.currentResultIndices[reelToStop] !== undefined) {
                    stopReel(reelToStop, window.currentResultIndices[reelToStop]);
                } else {
                    // Fallback if resultIndices isn't accessible
                    const finalSymbolId = spinResult[reelToStop];
                    const finalIndex = virtualReels[reelToStop].indexOf(finalSymbolId);
                    stopReel(reelToStop, finalIndex !== -1 ? finalIndex : 0);
                }
            }
        } else if (turns > 0) {
             spinReels();
        }
    }
}

// --- Drag and Drop ---
function handleDragStart(e) {
    e.dataTransfer.setData('text/plain', 'coin'); // Indicate what's being dragged
    e.target.style.opacity = '0.5'; // Make coin semi-transparent while dragging
     if (audioContext.state === 'suspended') { // Try resuming audio on drag start
        audioContext.resume();
    }
}

function handleDragEnd(e) {
    e.target.style.opacity = '1'; // Restore coin opacity
    coinSlotElement.classList.remove('over'); // Ensure highlight is removed
}

function handleDragOver(e) {
    e.preventDefault(); // Necessary to allow dropping
    e.dataTransfer.dropEffect = 'move';
    coinSlotElement.classList.add('over'); // Highlight drop zone
}

function handleDragLeave(e) {
    coinSlotElement.classList.remove('over'); // Remove highlight
}

function handleDrop(e) {
    e.preventDefault();
    coinSlotElement.classList.remove('over');
    if (e.dataTransfer.getData('text/plain') === 'coin') {
        console.log("Coin inserted!");
        turns += config.initialTurns;
        credits = 0; // Reset credits on new coin insertion? Or add to existing? Resetting for now.
        updateStatusDisplay();
        playSound('coin');
        clearMessages(); // Clear any previous messages like "OUT OF TURNS"
        // Maybe add a visual confirmation/animation
    }
}

// --- Arm Drag Functions ---
function handleArmDragStart(e) {
    // Change this to add drag class to the handle instead of the arm
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = "move";
    
    // Make the drag image transparent (improves drag visual)
    const img = new Image();
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; // Transparent image
    e.dataTransfer.setDragImage(img, 0, 0);
    
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
}

function handleArmDragEnd(e) {
    e.target.classList.remove('dragging');
    
    // Add animation of handle returning to original position
    e.target.style.transition = 'transform 0.3s ease-out';
    e.target.style.transform = 'translateY(0)';
    
    // Trigger spin on drag end
    console.log("Arm handle released.");
    spinReels();
}

// New function to update handle position during drag
function handleArmDrag(e) {
    if (e.clientY) {
        // Allow dragging up to 100px for more range of motion
        const startY = e.target.getBoundingClientRect().top;
        const dragY = Math.min(100, Math.max(0, e.clientY - startY));
        e.target.style.transform = `translateY(${dragY}px)`;
    }
}

// --- Event Listeners ---
function setupEventListeners() {
    // Coin Drag/Drop
    coinElement.addEventListener('dragstart', handleDragStart);
    coinElement.addEventListener('dragend', handleDragEnd);
    coinSlotElement.addEventListener('dragover', handleDragOver);
    coinSlotElement.addEventListener('dragleave', handleDragLeave);
    coinSlotElement.addEventListener('drop', handleDrop);

    // Paytable Toggle
    paytableToggleBtn.addEventListener('click', togglePaytable);
    paytableCloseBtn.addEventListener('click', () => {
        console.log('Paytable close button clicked.'); // Add log here
        togglePaytable(); // Call the existing toggle function
    });

    // Keyboard Controls (Spacebar)
    document.addEventListener('keydown', handleSpacebar);

    // Message Overlay Click to Dismiss
    messageOverlay.addEventListener('click', () => {
        console.log('Message overlay clicked.');
        clearMessages();
    });

    // Update arm drag to only apply to the handle
    armHandleElement.addEventListener('dragstart', handleArmDragStart);
    armHandleElement.addEventListener('drag', handleArmDrag);
    armHandleElement.addEventListener('dragend', handleArmDragEnd);
    
    // Prevent default dragover behavior
    armHandleElement.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    // Spin Trigger (Optional button, or rely solely on coin insertion + spacebar)
    // Example: document.getElementById('spin-button').addEventListener('click', spinReels);
}

// --- Start the Game ---
initializeGame();
