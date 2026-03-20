/* ============================================
   JUST A MAN - Story System
   Act transitions, event triggers, progression
   ============================================ */

// ============================================
// ACT TRANSITION CHECKS
// ============================================

function checkActTransition() {
    const flags = gameState.flags;

    // Act 1 -> Act 2
    if (flags.currentAct === 1 && !flags.act2Unlocked) {
        if (gameState.cash >= ACT2_CONDITIONS.minCash &&
            gameState.currentDay >= ACT2_CONDITIONS.minDay &&
            flags.metVinnie &&
            flags.mallFlipCount >= ACT2_CONDITIONS.minMallFlips) {
            return 'ACT1_TO_ACT2';
        }
    }

    // Act 2 -> Act 3
    if (flags.currentAct === 2 && !flags.act3Unlocked) {
        if (gameState.cash >= ACT3_CONDITIONS.minCash &&
            gameState.reputation >= ACT3_CONDITIONS.minReputation &&
            gameState.currentDay >= ACT3_CONDITIONS.minDay) {
            const hasOneOf = ACT3_CONDITIONS.requireOneOf.some(f => flags[f]);
            if (hasOneOf) return 'ACT2_TO_ACT3';
        }
    }

    return null;
}

// ============================================
// STORY EVENT CHECKS (per time period)
// ============================================

function checkStoryEvents() {
    const events = [];
    const flags = gameState.flags;
    const day = gameState.currentDay;

    // === VINNIE -> MARCUS INTRO ===
    if (flags.metVinnie && gameState.npcs.vinnie.trust >= 60 &&
        !flags.stockBrokerageUnlocked && !hasSeenDialog('VINNIE_MARCUS_INTRO') &&
        gameState.currentLocation === 'pawnshop') {
        events.push('VINNIE_MARCUS_INTRO');
    }

    // === DIANA PROGRESSION ===
    const diana = gameState.npcs.diana;
    if (diana.met) {
        // Date ask (trust >= 25, acquaintance stage)
        if (diana.trust >= 25 && diana.relationshipStage === 'acquaintance' &&
            !hasSeenDialog('DIANA_DATE_ASK') &&
            gameState.currentLocation === 'cafe' && gameState.timeOfDay === 'noon') {
            events.push('DIANA_DATE_ASK');
        }

        // Love confession (trust >= 60, dating, 3+ dates)
        if (diana.trust >= 60 && diana.relationshipStage === 'dating' &&
            diana.dateCount >= 3 && !hasSeenDialog('DIANA_LOVE_CONFESSION')) {
            events.push('DIANA_LOVE_CONFESSION');
        }

        // Diana caught Ray deal
        if (flags.dianaCaughtRay && !hasSeenDialog('DIANA_BREAKUP') &&
            diana.met && gameState.currentLocation === 'cafe') {
            events.push('DIANA_BREAKUP');
            flags.dianaCaughtRay = false;
        }
    }

    // === RAY FAMILY SUBPLOT ===
    if (gameState.npcs.ray.met && gameState.npcs.ray.trust >= 50 &&
        !flags.rayFamilyOffered && !flags.rayFamilyHelped &&
        gameState.currentLocation === 'park' && day >= 15) {
        events.push('RAY_FAMILY');
    }

    // === RAY BIG DEAL ===
    if (gameState.npcs.ray.met && gameState.npcs.ray.trust >= 40 &&
        !flags.tookRayBigDeal && gameState.cash >= 1000 &&
        day >= 18 && gameState.currentLocation === 'park' &&
        !hasSeenDialog('RAY_BIG_DEAL')) {
        events.push('RAY_BIG_DEAL');
    }

    // === MARCUS BETRAYAL ===
    if (flags.currentAct >= 2 && gameState.npcs.marcus.met &&
        !flags.marcusBetrayalTriggered && !flags.marcusBetrayalRevealed &&
        getPortfolioValue() > 50000 &&
        gameState.currentLocation === 'brokerage' &&
        randomChance(0.30)) {
        events.push('MARCUS_BETRAYAL');
    }

    // === TONY PARTNERSHIP ===
    if (gameState.npcs.tony.met && gameState.npcs.tony.trust >= 70 &&
        !flags.tonyPartnership && gameState.cash >= 10000 &&
        gameState.currentLocation === 'nightclub' &&
        !hasSeenDialog('TONY_PARTNERSHIP')) {
        events.push('TONY_PARTNERSHIP');
    }

    // === TONY MAJOR DEAL ===
    if (flags.currentAct >= 3 && day >= 40 &&
        gameState.cash >= 30000 && gameState.reputation >= 60 &&
        !flags.majorDealOffered &&
        gameState.currentLocation === 'nightclub' &&
        gameState.npcs.tony.met) {
        events.push('TONY_MAJOR_DEAL');
    }

    // === BROKERAGE FIRST VISIT ===
    if (gameState.currentLocation === 'brokerage' &&
        gameState.npcs.marcus.met &&
        !hasSeenDialog('BROKERAGE_FIRST_VISIT')) {
        events.push('BROKERAGE_FIRST_VISIT');
    }

    // === MRS. CHEN CROWN JEWEL ===
    if (gameState.npcs.mrsChen.met && gameState.npcs.mrsChen.trust >= 85 &&
        gameState.currentLocation === 'realestate' &&
        !hasSeenDialog('CHEN_CROWN_JEWEL')) {
        events.push('CHEN_CROWN_JEWEL');
    }

    return events;
}

// ============================================
// PENDING EVENT RESOLUTION (delayed outcomes)
// ============================================

function checkPendingEvents() {
    const resolved = [];
    const remaining = [];

    for (const event of gameState.pendingEvents) {
        if (gameState.currentDay >= event.day) {
            resolved.push(event);
        } else {
            remaining.push(event);
        }
    }

    gameState.pendingEvents = remaining;
    return resolved;
}

function resolvePendingEvent(event) {
    switch (event.type) {
        case 'ray_deal_result': {
            const result = event.result;
            gameState._pendingPayout = result.payout;
            if (result.outcome === 'success' || result.outcome === 'jackpot') {
                return 'RAY_DEAL_SUCCESS';
            } else {
                return 'RAY_DEAL_FAILURE';
            }
        }

        case 'ray_big_deal_result': {
            const result = event.result;
            gameState._pendingPayout = result.payout;
            if (event.halfDeal && result.payout > 0) {
                gameState._pendingPayout = Math.round(result.payout);
            }
            if (result.outcome === 'success') return 'RAY_BIG_DEAL_SUCCESS';
            if (result.outcome === 'partial') return 'RAY_BIG_DEAL_PARTIAL';
            return 'RAY_BIG_DEAL_DISASTER';
        }

        case 'tony_major_deal_result': {
            return 'TONY_MAJOR_SUCCESS';
        }

        default:
            return null;
    }
}

// ============================================
// DIANA STAGE MANAGEMENT
// ============================================

function updateDianaStage() {
    const diana = gameState.npcs.diana;
    if (!diana.met || diana.relationshipStage === 'broken_up') return;

    const trust = diana.trust;

    // Auto-advance from stranger to acquaintance
    if (diana.relationshipStage === 'stranger' && trust >= 16) {
        diana.relationshipStage = 'acquaintance';
    }
}

// ============================================
// STRESS WARNINGS
// ============================================

function getStressWarning() {
    if (gameState.stress > 90) {
        return 'You can barely think straight. One more push and you\'ll break.';
    }
    if (gameState.stress > 80) {
        return 'You feel the pressure building. Your vision blurs. You need rest.';
    }
    return null;
}

function getCashWarning() {
    if (gameState.cash < 10 && gameState.cash > 0) {
        return 'You\'re running dangerously low on cash.';
    }
    return null;
}

// ============================================
// NPC DIALOG SELECTION (what to show on talk)
// ============================================

function getNpcTalkDialog(npcId) {
    switch (npcId) {
        case 'vinnie': {
            if (!gameState.npcs.vinnie.met) return 'VINNIE_INTRO';
            // Check if should introduce Marcus
            if (gameState.npcs.vinnie.trust >= 60 && !gameState.flags.stockBrokerageUnlocked &&
                !hasSeenDialog('VINNIE_MARCUS_INTRO')) {
                return 'VINNIE_MARCUS_INTRO';
            }
            if (gameState.npcs.vinnie.trust >= 40) return 'VINNIE_CHAT_FRIENDLY';
            return null;
        }
        case 'diana': {
            if (!gameState.npcs.diana.met) return 'DIANA_FIRST_MEETING';
            const stage = gameState.npcs.diana.relationshipStage;
            if (stage === 'acquaintance' && !hasSeenDialog('DIANA_CAFE_CHAT_1')) return 'DIANA_CAFE_CHAT_1';
            if (stage === 'acquaintance' && gameState.npcs.diana.trust >= 25 && !hasSeenDialog('DIANA_DATE_ASK')) return 'DIANA_DATE_ASK';
            if (stage === 'dating' && !gameState.flags.dianaDinnerDate) return 'DIANA_FIRST_DATE';
            return null;
        }
        case 'marcus': {
            if (!gameState.npcs.marcus.met) return 'MARCUS_CAFE_INTRO';
            if (!hasSeenDialog('BROKERAGE_FIRST_VISIT') && gameState.currentLocation === 'brokerage') return 'BROKERAGE_FIRST_VISIT';
            return 'MARCUS_TIP';
        }
        case 'ray': {
            if (!gameState.flags.rayIntroduced) return 'RAY_INTRO';
            // Check family subplot
            if (gameState.npcs.ray.trust >= 50 && !gameState.flags.rayFamilyOffered && gameState.currentDay >= 15) return 'RAY_FAMILY';
            // Check big deal
            if (gameState.npcs.ray.trust >= 40 && !gameState.flags.tookRayBigDeal && gameState.cash >= 500 && gameState.currentDay >= 18) return 'RAY_BIG_DEAL';
            // Regular deal if available
            if (!gameState.flags.tookRayDeal) return 'RAY_FIRST_DEAL';
            return 'RAY_CHAT';
        }
        case 'mrsChen': {
            if (!gameState.npcs.mrsChen.met) return 'CHEN_INTRO';
            if (gameState.npcs.mrsChen.trust >= 85 && !hasSeenDialog('CHEN_CROWN_JEWEL')) return 'CHEN_CROWN_JEWEL';
            return 'CHEN_CHAT';
        }
        case 'tony': {
            if (!gameState.npcs.tony.met) return 'TONY_INTRO';
            if (gameState.npcs.tony.trust >= 70 && !gameState.flags.tonyPartnership && gameState.cash >= 10000) return 'TONY_PARTNERSHIP';
            if (gameState.flags.currentAct >= 3 && gameState.currentDay >= 40 && !gameState.flags.majorDealOffered && gameState.cash >= 30000) return 'TONY_MAJOR_DEAL';
            return 'TONY_CHAT';
        }
        default:
            return null;
    }
}

// ============================================
// MORNING CHECK (start of each day)
// ============================================

function morningCheck() {
    const events = [];

    // Check pending Ray/Tony deal results
    const pending = checkPendingEvents();
    for (const pe of pending) {
        const dialogId = resolvePendingEvent(pe);
        if (dialogId) events.push(dialogId);
    }

    // Check act transitions
    const actTransition = checkActTransition();
    if (actTransition) events.push(actTransition);

    // Win/lose checks
    if (checkWinCondition()) events.push('WIN_ENDING');
    const loseType = checkLoseCondition();
    if (loseType === 'bankrupt') events.push('LOSE_BANKRUPT');
    if (loseType === 'burnout') events.push('LOSE_BURNOUT');

    // Stress/cash warnings
    const stressWarn = getStressWarning();
    if (stressWarn) events.push({ type: 'notification', text: stressWarn, kind: 'bad' });

    const cashWarn = getCashWarning();
    if (cashWarn) events.push({ type: 'notification', text: cashWarn, kind: 'bad' });

    // Update diana stage
    updateDianaStage();

    return events;
}
