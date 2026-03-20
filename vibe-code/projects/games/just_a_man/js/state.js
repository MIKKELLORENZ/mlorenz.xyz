/* ============================================
   JUST A MAN - Game State Management
   ============================================ */

function createDefaultState() {
    return {
        // Meta
        playerName: 'You',
        currentDay: 1,
        timeOfDay: 'morning',
        currentLocation: 'home',
        currentScene: 'home_starter_morning',
        actionsThisPeriod: 0,

        // Resources
        cash: STARTING_CASH,
        reputation: 0,
        charm: 10,
        stress: 0,

        // Ownership
        propertiesOwned: [],
        carOwned: null,
        inventory: [],

        // NPC Relationships
        npcs: {
            vinnie: { trust: 30, met: false, interactions: 0, lastVisitDay: 0, flags: {} },
            diana: { trust: 0, met: false, interactions: 0, lastVisitDay: 0, relationshipStage: 'stranger', dateCount: 0, flags: {} },
            marcus: { trust: 0, met: false, interactions: 0, lastVisitDay: 0, flags: {} },
            ray: { trust: 0, met: false, interactions: 0, lastVisitDay: 0, flags: {} },
            mrsChen: { trust: 0, met: false, interactions: 0, lastVisitDay: 0, flags: {} },
            tony: { trust: 0, met: false, interactions: 0, lastVisitDay: 0, flags: {} },
        },

        // Story Flags
        flags: {
            currentAct: 1,
            act2Unlocked: false,
            act3Unlocked: false,

            // Act 1
            firstPawnTransaction: false,
            learnedHustle: false,
            metVinnie: false,
            mallFlipCount: 0,
            firstBigScore: false,

            // Act 2
            metDiana: false,
            noticedDiana: false,
            firstDate: false,
            metMarcus: false,
            stockBrokerageUnlocked: false,
            usedCarLotUnlocked: false,
            nightclubUnlocked: false,
            metTony: false,
            firstStockTrade: false,
            boughtFirstCar: false,
            rayIntroduced: false,
            tookRayDeal: false,
            rayDealOutcome: null,
            tookRayBigDeal: false,
            rayBigDealOutcome: null,
            rayFamilyHelped: false,
            rayFamilyOffered: false,
            rayPaybackRemaining: 0,
            dianaDinnerDate: false,

            // Act 3
            realEstateOfficeUnlocked: false,
            metMrsChen: false,
            firstPropertyBought: false,
            proposedToDiana: false,
            dianaResponse: null,
            majorDealOffered: false,
            majorDealAccepted: false,
            majorDealTimer: 0,
            majorDealOutcome: null,
            tonyPartnership: false,
            tonyPartnershipDay: 0,
            marcusBetrayalTriggered: false,
            marcusBetrayalRevealed: false,

            // Misc
            cherryCokesDrunk: 0,
            boomboxBought: false,
            vhsRented: 0,
            pagerBought: false,
            overheardTip: null,
            dianaCaughtRay: false,
            dianaRudeCount: 0,
        },

        // Stock Portfolio
        stockPortfolio: [],
        stockPrices: {},
        stockHistory: {},
        lastNewsDay: 0,
        currentNews: null,

        // Passive income tracking
        passiveIncome: 0,

        // Dialog History
        seenDialogs: [],
        pendingEvents: [],

        // Timestamps
        lastSaved: null,
        totalMoneyEarned: 0,
        dealsCompleted: 0,
    };
}

let gameState = null;

// ============================================
// STATE MUTATIONS
// ============================================

function modifyCash(amount) {
    gameState.cash += amount;
    if (amount > 0) gameState.totalMoneyEarned += amount;
    gameState.cash = Math.max(0, Math.round(gameState.cash));
    if (amount >= 500 && !gameState.flags.firstBigScore) {
        gameState.flags.firstBigScore = true;
    }
}

function modifyReputation(amount) {
    gameState.reputation = Math.max(0, Math.min(MAX_STAT, gameState.reputation + amount));
}

function modifyCharm(amount) {
    gameState.charm = Math.max(0, Math.min(MAX_STAT, gameState.charm + amount));
}

function modifyStress(amount) {
    gameState.stress = Math.max(0, Math.min(MAX_STAT, gameState.stress + amount));
}

function modifyNpcTrust(npcId, amount) {
    const npc = gameState.npcs[npcId];
    if (!npc) return;
    npc.trust = Math.max(0, Math.min(MAX_STAT, npc.trust + amount));
    npc.lastVisitDay = gameState.currentDay;
}

function setNpcMet(npcId) {
    const npc = gameState.npcs[npcId];
    if (!npc) return;
    npc.met = true;
    npc.lastVisitDay = gameState.currentDay;
}

function incrementNpcInteractions(npcId) {
    const npc = gameState.npcs[npcId];
    if (!npc) return;
    npc.interactions++;
    npc.lastVisitDay = gameState.currentDay;
}

function setFlag(key, value) {
    gameState.flags[key] = value;
}

function getFlag(key) {
    return gameState.flags[key];
}

function addToInventory(item) {
    gameState.inventory.push({ ...item, acquiredDay: gameState.currentDay });
}

function removeFromInventory(itemId) {
    const idx = gameState.inventory.findIndex(i => i.id === itemId);
    if (idx !== -1) gameState.inventory.splice(idx, 1);
}

function hasItem(itemId) {
    return gameState.inventory.some(i => i.id === itemId);
}

function markDialogSeen(dialogId) {
    if (!gameState.seenDialogs.includes(dialogId)) {
        gameState.seenDialogs.push(dialogId);
    }
}

function hasSeenDialog(dialogId) {
    return gameState.seenDialogs.includes(dialogId);
}

function addProperty(propertyId) {
    if (!gameState.propertiesOwned.includes(propertyId)) {
        gameState.propertiesOwned.push(propertyId);
        // Recalculate passive income
        gameState.passiveIncome = gameState.propertiesOwned.reduce((sum, pid) => {
            const prop = PROPERTIES.find(p => p.id === pid);
            return sum + (prop ? prop.passiveIncome : 0);
        }, 0);
        // Add tony partnership income
        if (gameState.flags.tonyPartnership) {
            gameState.passiveIncome += 300;
        }
    }
}

function recalcPassiveIncome() {
    gameState.passiveIncome = gameState.propertiesOwned.reduce((sum, pid) => {
        const prop = PROPERTIES.find(p => p.id === pid);
        return sum + (prop ? prop.passiveIncome : 0);
    }, 0);
    if (gameState.flags.tonyPartnership) {
        gameState.passiveIncome += 300;
    }
}

// ============================================
// TIME MANAGEMENT
// ============================================

function advanceTime() {
    const currentIdx = TIME_PERIODS.indexOf(gameState.timeOfDay);
    if (currentIdx < TIME_PERIODS.length - 1) {
        gameState.timeOfDay = TIME_PERIODS[currentIdx + 1];
    } else {
        advanceDay();
    }
    gameState.actionsThisPeriod = 0;
}

function useAction() {
    gameState.actionsThisPeriod++;
    if (gameState.actionsThisPeriod >= ACTIONS_PER_PERIOD) {
        advanceTime();
        return true; // time advanced
    }
    return false;
}

function advanceDay() {
    gameState.currentDay++;
    gameState.timeOfDay = 'morning';
    gameState.actionsThisPeriod = 0;

    // Apply daily effects
    applyDailyEffects();
}

function applyDailyEffects() {
    // Passive income from properties
    if (gameState.passiveIncome > 0) {
        modifyCash(gameState.passiveIncome);
    }

    // Ray payback
    if (gameState.flags.rayPaybackRemaining > 0) {
        const payment = Math.min(250, gameState.flags.rayPaybackRemaining);
        modifyCash(payment);
        gameState.flags.rayPaybackRemaining -= payment;
    }

    // Stress from being broke
    if (gameState.cash < 20) {
        modifyStress(3);
    }

    // Diana stress relief if committed
    if (gameState.npcs.diana.relationshipStage === 'committed') {
        modifyStress(-2);
    }

    // NPC trust decay
    Object.entries(gameState.npcs).forEach(([npcId, npc]) => {
        if (!npc.met) return;
        const daysSince = gameState.currentDay - npc.lastVisitDay;

        // Diana has special ignore rules
        if (npcId === 'diana' && npc.relationshipStage !== 'stranger' && npc.relationshipStage !== 'broken_up') {
            if (daysSince >= DIANA_IGNORE_THRESHOLD) {
                modifyNpcTrust('diana', -DIANA_IGNORE_DECAY);
            }
        } else if (daysSince >= TRUST_DECAY_THRESHOLD) {
            const decay = Math.min(TRUST_DECAY_RATE, TRUST_DECAY_MAX);
            npc.trust = Math.max(0, npc.trust - decay);
        }
    });

    // Major deal timer
    if (gameState.flags.majorDealAccepted && gameState.flags.majorDealTimer > 0) {
        gameState.flags.majorDealTimer--;
    }

    // Stock price updates
    if (gameState.flags.stockBrokerageUnlocked) {
        updateStockPrices();
    }
}

// ============================================
// SAVE / LOAD
// ============================================

function saveGame() {
    gameState.lastSaved = new Date().toISOString();
    try {
        localStorage.setItem('justaman_save', JSON.stringify(gameState));
        return true;
    } catch (e) {
        console.error('Save failed:', e);
        return false;
    }
}

function loadGame() {
    try {
        const data = localStorage.getItem('justaman_save');
        if (!data) return null;
        return JSON.parse(data);
    } catch (e) {
        console.error('Load failed:', e);
        return null;
    }
}

function hasSavedGame() {
    return localStorage.getItem('justaman_save') !== null;
}

function deleteSave() {
    localStorage.removeItem('justaman_save');
}

// ============================================
// WIN/LOSE CHECKS
// ============================================

function checkWinCondition() {
    return (
        gameState.propertiesOwned.length >= WIN_PROPERTIES &&
        gameState.cash >= WIN_CASH &&
        (gameState.npcs.diana.relationshipStage === 'committed' && gameState.npcs.diana.trust >= 60) ||
        (gameState.flags.dianaResponse === 'accepted')
    );
}

function checkLoseCondition() {
    // Bankrupt
    if (gameState.cash <= 0 &&
        gameState.inventory.length === 0 &&
        gameState.stockPortfolio.length === 0 &&
        gameState.propertiesOwned.length === 0) {
        return 'bankrupt';
    }
    // Burnout
    if (gameState.stress >= MAX_STAT) {
        return 'burnout';
    }
    return null;
}

function getGameStats() {
    return {
        daysPlayed: gameState.currentDay,
        totalEarned: gameState.totalMoneyEarned,
        finalCash: gameState.cash,
        propertiesOwned: gameState.propertiesOwned.length,
        dealsCompleted: gameState.dealsCompleted,
        dianaTrust: gameState.npcs.diana.trust,
        dianaStage: gameState.npcs.diana.relationshipStage,
        npcsMet: Object.values(gameState.npcs).filter(n => n.met).length,
        cherryCokesDrunk: gameState.flags.cherryCokesDrunk,
    };
}
