/* ============================================
   JUST A MAN - NPC System
   ============================================ */

const NPC_DATA = {
    vinnie: {
        name: 'Vinnie',
        fullName: 'Vinnie Marcone',
        description: 'Pawn shop owner. Gruff but fair.',
        location: 'pawnshop',
        startTrust: 30,
        likedGifts: ['whiskey'],
    },
    diana: {
        name: 'Diana',
        fullName: 'Diana Torres',
        description: 'Freelance graphic designer. Cherry Coke lover.',
        location: 'cafe',
        startTrust: 0,
        likedGifts: ['cherry_coke_gift', 'jazz_cd', 'flowers'],
    },
    marcus: {
        name: 'Marcus',
        fullName: 'Marcus Webb',
        description: 'Stock broker. Suspenders and ambition.',
        location: 'brokerage',
        startTrust: 0,
        likedGifts: ['cigar'],
    },
    ray: {
        name: 'Ray',
        fullName: 'Ray Delgado',
        description: 'Shady dealer with a heart. Leather jacket.',
        location: 'park',
        startTrust: 0,
        likedGifts: ['leather_gloves'],
    },
    mrsChen: {
        name: 'Mrs. Chen',
        fullName: 'Sharon Chen',
        description: 'Sharp real estate agent. No-nonsense.',
        location: 'realestate',
        startTrust: 0,
        likedGifts: ['tea_set'],
    },
    tony: {
        name: 'Tony',
        fullName: 'Tony Russo',
        description: 'Nightclub owner. Gold chains. Connections.',
        location: 'nightclub',
        startTrust: 0,
        likedGifts: ['champagne'],
    },
};

// ============================================
// NPC AVAILABILITY CHECKS
// ============================================

function isNpcAvailable(npcId, location, timeOfDay) {
    switch (npcId) {
        case 'vinnie':
            return location === 'pawnshop' && timeOfDay !== 'night';
        case 'diana':
            if (location === 'cafe' && timeOfDay === 'noon' && gameState.currentDay >= 3) return true;
            if (location === 'restaurant' && gameState.npcs.diana.relationshipStage === 'dating') return true;
            if (location === 'nightclub' && timeOfDay === 'night' && gameState.npcs.diana.relationshipStage === 'dating') return true;
            return false;
        case 'marcus':
            if (!gameState.npcs.marcus.met) return false;
            return location === 'brokerage' && timeOfDay !== 'night';
        case 'ray':
            if (gameState.currentDay < 5) return false;
            return location === 'park' && (timeOfDay === 'noon' || timeOfDay === 'night');
        case 'mrsChen':
            if (!gameState.flags.realEstateOfficeUnlocked) return false;
            return location === 'realestate' && timeOfDay !== 'night';
        case 'tony':
            return location === 'nightclub' && timeOfDay === 'night';
        default:
            return false;
    }
}

function getAvailableNpcs(location, timeOfDay) {
    return Object.keys(NPC_DATA).filter(id => isNpcAvailable(id, location, timeOfDay));
}

// ============================================
// TRUST LEVEL HELPERS
// ============================================

function getTrustLevel(npcId) {
    const trust = gameState.npcs[npcId].trust;
    for (const [level, data] of Object.entries(TRUST_LEVELS)) {
        if (trust <= data.max) return level;
    }
    return 'loyal';
}

function getTrustLabel(npcId) {
    const level = getTrustLevel(npcId);
    return TRUST_LEVELS[level].label;
}

// ============================================
// GIFT GIVING
// ============================================

function canGiveGift(npcId) {
    const npcData = NPC_DATA[npcId];
    if (!npcData) return [];

    return gameState.inventory.filter(item =>
        npcData.likedGifts.includes(item.id)
    );
}

function giveGift(npcId, itemId) {
    const gift = Object.values(GIFTS).find(g => g.id === itemId);
    if (!gift) return false;

    removeFromInventory(itemId);
    modifyNpcTrust(npcId, gift.trustBoost);
    incrementNpcInteractions(npcId);

    return {
        npcName: NPC_DATA[npcId].name,
        giftName: gift.name,
        trustGain: gift.trustBoost,
    };
}

// ============================================
// DIANA RELATIONSHIP
// ============================================

function getDianaStage() {
    return gameState.npcs.diana.relationshipStage;
}

function advanceDianaStage(newStage) {
    gameState.npcs.diana.relationshipStage = newStage;
}

function checkDianaBreakup() {
    const diana = gameState.npcs.diana;
    if (diana.relationshipStage === 'stranger' || diana.relationshipStage === 'broken_up') return false;

    // Rude count threshold
    if (gameState.flags.dianaRudeCount >= 3) {
        diana.trust = 10;
        diana.relationshipStage = 'broken_up';
        return true;
    }

    return false;
}

function canRecoverDiana() {
    const diana = gameState.npcs.diana;
    if (diana.relationshipStage !== 'broken_up') return false;
    // Need 10+ days since breakup (tracked via lastVisitDay as proxy)
    return true; // simplified - trust caps at 70 though
}

// ============================================
// NPC SCENE SELECTION
// ============================================

function getNpcScene(npcId, context) {
    switch (npcId) {
        case 'vinnie':
            if (!gameState.npcs.vinnie.met) return 'vinnie_first_meeting';
            if (context === 'negotiate') return 'vinnie_negotiating';
            if (context === 'shop') return 'vinnie_showing_goods';
            if (context === 'secret') return 'vinnie_conspiratorial';
            if (gameState.npcs.vinnie.trust >= 40) return 'vinnie_friendly';
            return 'pawnshop_interior';

        case 'diana':
            if (!gameState.npcs.diana.met) return 'diana_first_sighting';
            if (context === 'first_talk') return 'diana_first_conversation';
            if (context === 'coffee') return 'diana_coffee_date';
            if (context === 'park_walk') return 'diana_park_walk';
            if (context === 'dinner') return 'diana_dinner_date';
            if (context === 'confession') return 'diana_love_confession';
            if (context === 'proposal') return 'diana_proposal';
            if (context === 'breakup') return 'diana_breakup';
            return 'cafe_noon';

        case 'marcus':
            if (!gameState.npcs.marcus.met) return 'marcus_first_meeting';
            if (context === 'brokerage_intro') return 'marcus_brokerage_intro';
            if (context === 'tip') return 'marcus_stock_tip';
            if (context === 'betrayal') return 'marcus_betrayal_reveal';
            if (context === 'confession') return 'marcus_confession';
            return 'brokerage_floor';

        case 'ray':
            if (!gameState.flags.rayIntroduced) return 'ray_first_meeting';
            if (context === 'pitch') return 'ray_pitching_deal';
            if (context === 'success') return 'ray_deal_success';
            if (context === 'failure') return 'ray_deal_failure';
            if (context === 'family') return 'ray_family_crisis';
            if (context === 'grateful') return 'ray_grateful';
            return 'park_noon';

        case 'mrsChen':
            if (!gameState.npcs.mrsChen.met) return 'chen_office_intro';
            if (context === 'listings') return 'chen_showing_listings';
            if (context === 'deal') return 'chen_closing_deal';
            if (context === 'crown_jewel') return 'chen_crown_jewel';
            return 'realestate_office';

        case 'tony':
            if (!gameState.npcs.tony.met) return 'tony_nightclub_intro';
            if (context === 'vip') return 'tony_vip_chat';
            if (context === 'partnership') return 'tony_partnership_offer';
            if (context === 'major_deal') return 'tony_major_deal';
            if (context === 'celebration') return 'tony_celebration';
            return 'nightclub_interior';

        default:
            return null;
    }
}
