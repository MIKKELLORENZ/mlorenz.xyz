/* ============================================
   JUST A MAN - Constants & Game Data
   ============================================ */

const GAME_VERSION = '1.0.0';
const ACTIONS_PER_PERIOD = 2;
const TIME_PERIODS = ['morning', 'noon', 'night'];
const STARTING_CASH = 50;
const MAX_STAT = 100;
const WIN_CASH = 100000;
const WIN_PROPERTIES = 3;

// ============================================
// PAWN SHOP ITEMS (Vinnie's inventory pool)
// ============================================
const PAWN_ITEMS = [
    { id: 'watch_casio', name: 'Casio Watch', baseValue: 20, category: 'accessory' },
    { id: 'walkman_busted', name: 'Busted Walkman', baseValue: 10, category: 'electronics' },
    { id: 'leather_jacket', name: 'Leather Jacket', baseValue: 40, category: 'clothing' },
    { id: 'vhs_collection', name: 'VHS Collection (20)', baseValue: 30, category: 'media' },
    { id: 'boombox_small', name: 'Portable Boombox', baseValue: 50, category: 'electronics' },
    { id: 'gold_chain', name: 'Gold Chain (fake)', baseValue: 15, category: 'accessory' },
    { id: 'baseball_cards', name: 'Baseball Card Set', baseValue: 25, category: 'collectible' },
    { id: 'typewriter', name: 'Electric Typewriter', baseValue: 35, category: 'electronics' },
    { id: 'guitar_acoustic', name: 'Acoustic Guitar', baseValue: 60, category: 'instrument' },
    { id: 'polaroid_camera', name: 'Polaroid Camera', baseValue: 45, category: 'electronics' },
    { id: 'sneakers_jordan', name: 'Air Jordans (used)', baseValue: 80, category: 'clothing' },
    { id: 'record_player', name: 'Record Player', baseValue: 70, category: 'electronics' },
    { id: 'comic_books', name: 'Comic Book Collection', baseValue: 35, category: 'collectible' },
    { id: 'denim_jacket', name: 'Denim Jacket', baseValue: 30, category: 'clothing' },
    { id: 'radio_portable', name: 'Portable Radio', baseValue: 15, category: 'electronics' },
];

// Vinnie's rare items (trust 80+)
const PAWN_RARE_ITEMS = [
    { id: 'gold_watch', name: 'Gold Watch', baseValue: 800, category: 'accessory' },
    { id: 'vintage_guitar', name: 'Vintage Guitar', baseValue: 1200, category: 'instrument' },
    { id: 'rare_coins', name: 'Rare Coin Collection', baseValue: 2000, category: 'collectible' },
];

// ============================================
// MALL SECONDHAND ITEMS (buy here, sell at pawn)
// ============================================
const MALL_SECONDHAND = [
    { id: 'old_radio', name: 'Old AM/FM Radio', baseValue: 12 },
    { id: 'cassette_tapes', name: 'Box of Cassettes', baseValue: 8 },
    { id: 'roller_blades', name: 'Roller Blades', baseValue: 25 },
    { id: 'flannel_shirt', name: 'Flannel Shirt', baseValue: 10 },
    { id: 'vhs_player', name: 'VHS Player', baseValue: 40 },
    { id: 'board_game', name: 'Board Game (sealed)', baseValue: 15 },
    { id: 'sunglasses', name: 'Designer Sunglasses', baseValue: 20 },
    { id: 'mixtape_rare', name: 'Rare Mixtape', baseValue: 30 },
];

// ============================================
// MALL CLOTHING (charm boost)
// ============================================
const MALL_CLOTHING = [
    { id: 'nice_shirt', name: 'Nice Button-Down Shirt', price: 25, charmBoost: 3 },
    { id: 'cool_jacket', name: 'Cool Leather Jacket', price: 60, charmBoost: 5 },
    { id: 'fresh_sneakers', name: 'Fresh Sneakers', price: 45, charmBoost: 4 },
    { id: 'sharp_suit', name: 'Sharp Suit', price: 150, charmBoost: 10 },
];

// ============================================
// GIFT ITEMS (buy at various locations)
// ============================================
const GIFTS = {
    whiskey: { id: 'whiskey', name: 'Bottle of Whiskey', price: 25, buyAt: 'mall', forNpc: 'vinnie', trustBoost: 8 },
    cherry_coke: { id: 'cherry_coke_gift', name: 'Cherry Coke', price: 2, buyAt: 'cafe', forNpc: 'diana', trustBoost: 5 },
    jazz_cd: { id: 'jazz_cd', name: 'Jazz CD', price: 15, buyAt: 'mall', forNpc: 'diana', trustBoost: 8 },
    flowers: { id: 'flowers', name: 'Flowers', price: 10, buyAt: 'mall', forNpc: 'diana', trustBoost: 6 },
    cigar: { id: 'cigar', name: 'Expensive Cigar', price: 50, buyAt: 'nightclub', forNpc: 'marcus', trustBoost: 8 },
    leather_gloves: { id: 'leather_gloves', name: 'Leather Gloves', price: 30, buyAt: 'mall', forNpc: 'ray', trustBoost: 8 },
    tea_set: { id: 'tea_set', name: 'Tea Set from Chinatown', price: 40, buyAt: 'mall', forNpc: 'mrsChen', trustBoost: 8 },
    champagne: { id: 'champagne', name: 'Imported Champagne', price: 100, buyAt: 'restaurant', forNpc: 'tony', trustBoost: 8 },
};

// ============================================
// STOCKS
// ============================================
const STOCKS = [
    { ticker: 'NOVA', name: 'TechNova Inc', sector: 'Tech', basePrice: 24 },
    { ticker: 'MEDI', name: 'MediLife Corp', sector: 'Pharma', basePrice: 18 },
    { ticker: 'FUEL', name: 'EcoFuel Energy', sector: 'Energy', basePrice: 31 },
    { ticker: 'DRIV', name: 'FusionDrive Motors', sector: 'Automotive', basePrice: 45 },
    { ticker: 'STAR', name: 'StarMedia', sector: 'Media', basePrice: 15 },
    { ticker: 'SHIP', name: 'QuickShip Logistics', sector: 'Logistics', basePrice: 22 },
    { ticker: 'GOLD', name: 'GoldWorks Mining', sector: 'Mining', basePrice: 38 },
    { ticker: 'BYTE', name: 'Arcadia Games', sector: 'Gaming', basePrice: 12 },
];

// ============================================
// CARS
// ============================================
const CARS = [
    { id: 'beater', name: '1984 Chevy Cavalier', price: 500, repBonus: 2, description: 'Runs. Mostly.' },
    { id: 'sedan', name: '1989 Honda Accord', price: 2000, repBonus: 5, description: 'Reliable. Boring. Perfect.' },
    { id: 'muscle', name: '1987 Pontiac Firebird', price: 5000, repBonus: 10, description: 'Now you\'re talking.' },
    { id: 'luxury', name: '1991 Cadillac DeVille', price: 15000, repBonus: 20, description: 'You\'ve made it. Or you look like you have.' },
];

// ============================================
// PROPERTIES
// ============================================
const PROPERTIES = [
    {
        id: 'studio_downtown', name: 'Downtown Studio Apartment',
        price: 5000, passiveIncome: 50, repBonus: 5, requiredTrust: 0,
        description: 'Tiny but it\'s yours. One room, kitchenette, shared bathroom.'
    },
    {
        id: 'duplex_midtown', name: 'Midtown Duplex',
        price: 15000, passiveIncome: 150, repBonus: 10, requiredTrust: 30,
        description: 'Two units. Live in one, rent the other. Smart money.'
    },
    {
        id: 'brownstone_uptown', name: 'Uptown Brownstone',
        price: 40000, passiveIncome: 350, repBonus: 15, requiredTrust: 50,
        description: 'Three floors of pre-war charm. The neighbors are impressed.'
    },
    {
        id: 'commercial_building', name: 'Downtown Commercial Building',
        price: 80000, passiveIncome: 700, repBonus: 25, requiredTrust: 70,
        description: 'Office space, retail ground floor. You\'re a landlord now.'
    },
    {
        id: 'crown_jewel', name: 'The Lexington Tower Penthouse',
        price: 90000, passiveIncome: 500, repBonus: 30, requiredTrust: 85,
        description: 'Top of the world. Mrs. Chen\'s crown jewel listing.'
    },
];

// ============================================
// VINNIE TRUST -> PRICE MULTIPLIERS
// ============================================
const VINNIE_MARGINS = [
    { maxTrust: 19, buyMult: 0.30, sellMult: 2.00 },
    { maxTrust: 39, buyMult: 0.40, sellMult: 1.70 },
    { maxTrust: 59, buyMult: 0.55, sellMult: 1.40 },
    { maxTrust: 79, buyMult: 0.65, sellMult: 1.20 },
    { maxTrust: 100, buyMult: 0.75, sellMult: 1.10 },
];

// ============================================
// MARCUS TIP ACCURACY BY TRUST
// ============================================
const MARCUS_TIP_ACCURACY = [
    { maxTrust: 30, accuracy: 0.50 },
    { maxTrust: 50, accuracy: 0.65 },
    { maxTrust: 70, accuracy: 0.80 },
    { maxTrust: 100, accuracy: 0.90 },
];

// ============================================
// RAY DEAL ODDS BY TRUST
// ============================================
const RAY_DEAL_ODDS = [
    { maxTrust: 30, success: 0.40, fail: 0.60, jackpot: 0, multiplier: 3 },
    { maxTrust: 50, success: 0.50, fail: 0.50, jackpot: 0, multiplier: 3 },
    { maxTrust: 70, success: 0.60, fail: 0.30, jackpot: 0.10, multiplier: 3 },
    { maxTrust: 100, success: 0.70, fail: 0.20, jackpot: 0.10, multiplier: 3 },
];

// ============================================
// RANDOM EVENTS
// ============================================
const RANDOM_EVENTS = [
    {
        id: 'found_wallet',
        location: 'park',
        time: 'any',
        chance: 0.08,
        scene: 'event_found_wallet',
        dialog: 'You find a wallet on a bench. $30 inside. No ID.',
        choices: [
            { text: 'Keep the money.', effects: { cash: 30, reputation: -2 } },
            { text: 'Turn it in to the park office.', effects: { reputation: 5, charm: 2 } },
        ]
    },
    {
        id: 'street_musician',
        location: 'subway',
        time: 'any',
        chance: 0.15,
        scene: 'event_street_musician',
        dialog: 'A talented saxophone player performs in the station. A crowd gathers.',
        choices: [
            { text: 'Tip $5.', effects: { cash: -5, stress: -3, charm: 1 }, requireCash: 5 },
            { text: 'Listen for free.', effects: { stress: -1 } },
            { text: 'Walk past.', effects: {} },
        ]
    },
    {
        id: 'overheard_tip',
        location: 'cafe',
        time: 'noon',
        chance: 0.10,
        scene: null,
        requireFlags: { stockBrokerageUnlocked: true },
        dialog: 'You overhear two suits talking about a stock that\'s about to pop...',
        choices: [
            { text: 'Remember the ticker: FUEL.', effects: {}, setFlags: { overheardTip: 'FUEL' } },
            { text: 'Mind your own business.', effects: {} },
        ]
    },
    {
        id: 'mugging_attempt',
        location: 'downtown',
        time: 'night',
        chance: 0.06,
        scene: 'event_mugging_attempt',
        dialog: 'A shady figure approaches you. "Empty your pockets."',
        choices: [
            { text: 'Hand over $20 and walk away.', effects: { cash: -20, stress: 5 }, requireCash: 20 },
            { text: 'Bluff: "I got nothing, man."', effects: {}, charmCheck: { threshold: 30, failEffects: { cash: -50, stress: 8 } } },
            { text: 'Run for it.', effects: { stress: 3 }, probabilityCheck: { chance: 0.8, failEffects: { cash: -30, stress: 5 } } },
        ]
    },
    {
        id: 'cherry_coke_sale',
        location: 'mall',
        time: 'morning',
        chance: 0.12,
        scene: 'event_cherry_coke_sale',
        dialog: 'There\'s a Cherry Coke promotion! Buy one, get two free!',
        choices: [
            { text: 'Stock up! ($2 for 3)', effects: { cash: -2, stress: -2 }, requireCash: 2, setFlags: { cherryCokeStash: 3 } },
            { text: 'No thanks.', effects: {} },
        ]
    },
    {
        id: 'pager_deal',
        location: 'mall',
        time: 'noon',
        chance: 0.10,
        requireFlags: { pagerBought: false },
        scene: null,
        dialog: 'A kiosk has pagers on sale -- $30 instead of the usual $50.',
        choices: [
            { text: 'Buy the pager.', effects: { cash: -30 }, requireCash: 30, setFlags: { pagerBought: true } },
            { text: 'Pass.', effects: {} },
        ]
    },
    {
        id: 'boombox_street',
        location: 'downtown',
        time: 'noon',
        chance: 0.08,
        requireFlags: { boomboxBought: false },
        scene: null,
        dialog: 'A kid is selling a massive boombox for $40. "It works, I swear!"',
        choices: [
            { text: 'Buy it. ($40)', effects: { cash: -40, stress: -2 }, requireCash: 40, setFlags: { boomboxBought: true } },
            { text: 'Nah.', effects: {} },
        ]
    },
    {
        id: 'lucky_note',
        location: 'downtown',
        time: 'morning',
        chance: 0.07,
        requireFlags: { foundLuckyNote: undefined },
        scene: null,
        dialog: 'A crumpled note on the sidewalk catches your eye. Scrawled in pencil: "Lucky 7s -- Day 21, noon at the Golden Ace. The house sleeps."',
        choices: [
            { text: 'Pocket the note. Interesting...', effects: {}, setFlags: { foundLuckyNote: true, luckyDay: 21, luckyTime: 'noon' } },
            { text: 'Trash. Ignore it.', effects: {} },
        ]
    },
    {
        id: 'lucky_note_2',
        location: 'park',
        time: 'night',
        chance: 0.06,
        requireFlags: { foundLuckyNote2: undefined },
        scene: null,
        dialog: 'Someone left a napkin on the bench. It reads: "When the clock strikes 42, the roulette favors the bold." 42... Day 42?',
        choices: [
            { text: 'Keep the napkin.', effects: {}, setFlags: { foundLuckyNote2: true, luckyDay2: 42, luckyTime2: 'night' } },
            { text: 'Weird. Leave it.', effects: {} },
        ]
    },
];

// ============================================
// CASINO GAMES
// ============================================
const CASINO_GAMES = {
    slots: {
        name: 'Slot Machine',
        minBet: 10,
        maxBet: 500,
        // Normal: 20% win (2x), 5% jackpot (5x), 75% lose
        // Lucky: 40% win (2x), 15% jackpot (5x), 45% lose
        normalOdds: { win: 0.20, jackpot: 0.05, winMult: 2, jackpotMult: 5 },
        luckyOdds: { win: 0.40, jackpot: 0.15, winMult: 2, jackpotMult: 5 },
    },
    blackjack: {
        name: 'Blackjack Table',
        minBet: 25,
        maxBet: 2000,
        // Normal: 42% win (2x), 8% blackjack (2.5x), 50% lose
        // Lucky: 55% win (2x), 12% blackjack (2.5x), 33% lose
        normalOdds: { win: 0.42, jackpot: 0.08, winMult: 2, jackpotMult: 2.5 },
        luckyOdds: { win: 0.55, jackpot: 0.12, winMult: 2, jackpotMult: 2.5 },
    },
    roulette: {
        name: 'Roulette Wheel',
        minBet: 20,
        maxBet: 5000,
        // Normal: 15% win (3x), 3% jackpot (10x), 82% lose
        // Lucky: 30% win (3x), 8% jackpot (10x), 62% lose
        normalOdds: { win: 0.15, jackpot: 0.03, winMult: 3, jackpotMult: 10 },
        luckyOdds: { win: 0.30, jackpot: 0.08, winMult: 3, jackpotMult: 10 },
    },
};

// ============================================
// NEWS EVENTS (affect stock prices)
// ============================================
const NEWS_EVENTS = [
    { headline: 'TechNova unveils new processor!', ticker: 'NOVA', impact: 0.25 },
    { headline: 'TechNova hit with patent lawsuit.', ticker: 'NOVA', impact: -0.20 },
    { headline: 'MediLife FDA approval for new drug!', ticker: 'MEDI', impact: 0.30 },
    { headline: 'MediLife clinical trial fails.', ticker: 'MEDI', impact: -0.25 },
    { headline: 'Oil prices surge! Energy stocks boom.', ticker: 'FUEL', impact: 0.20 },
    { headline: 'EcoFuel refinery accident reported.', ticker: 'FUEL', impact: -0.18 },
    { headline: 'FusionDrive Motors unveils electric concept!', ticker: 'DRIV', impact: 0.22 },
    { headline: 'Auto industry downturn hits hard.', ticker: 'DRIV', impact: -0.15 },
    { headline: 'StarMedia lands huge TV deal!', ticker: 'STAR', impact: 0.28 },
    { headline: 'StarMedia ratings plummet.', ticker: 'STAR', impact: -0.20 },
    { headline: 'QuickShip wins government contract!', ticker: 'SHIP', impact: 0.18 },
    { headline: 'Shipping delays plague QuickShip.', ticker: 'SHIP', impact: -0.15 },
    { headline: 'Gold prices hit record high!', ticker: 'GOLD', impact: 0.20 },
    { headline: 'Gold market crashes overnight.', ticker: 'GOLD', impact: -0.22 },
    { headline: 'Arcadia Games releases smash hit!', ticker: 'BYTE', impact: 0.35 },
    { headline: 'Arcadia Games console flops.', ticker: 'BYTE', impact: -0.30 },
];

// ============================================
// ACT TRANSITION CONDITIONS
// ============================================
const ACT2_CONDITIONS = {
    minCash: 300,
    minDay: 8,
    requiredFlags: ['metVinnie'],
    minMallFlips: 3,
};

const ACT3_CONDITIONS = {
    minCash: 10000,
    minReputation: 40,
    minDay: 22,
    requireOneOf: ['metMarcus', 'firstStockTrade', 'boughtFirstCar'],
};

// ============================================
// FOOD / CONSUMABLE COSTS
// ============================================
const FOOD_ITEMS = {
    cafe_coffee: { name: 'Coffee', price: 3, stressRelief: 2 },
    cafe_meal: { name: 'Sandwich & Coffee', price: 8, stressRelief: 4 },
    cafe_cherry_coke: { name: 'Cherry Coke', price: 2, stressRelief: 2, charmBoost: 1 },
    mall_food_court: { name: 'Food Court Meal', price: 8, stressRelief: 3 },
    restaurant_dinner: { name: 'Italian Dinner', price: 75, stressRelief: 8 },
    restaurant_fancy: { name: 'The Full Experience', price: 150, stressRelief: 12 },
};

// ============================================
// NPC TRUST THRESHOLDS
// ============================================
const TRUST_LEVELS = {
    hostile: { max: 19, label: 'Hostile' },
    neutral: { max: 39, label: 'Neutral' },
    friendly: { max: 59, label: 'Friendly' },
    close: { max: 79, label: 'Close' },
    loyal: { max: 100, label: 'Loyal' },
};

// Diana relationship stages
const DIANA_STAGES = ['stranger', 'acquaintance', 'dating', 'committed', 'broken_up'];

// NPC trust decay: days without visiting before decay kicks in
const TRUST_DECAY_THRESHOLD = 10;
const TRUST_DECAY_RATE = 1; // per day after threshold
const TRUST_DECAY_MAX = 10;

// Diana-specific
const DIANA_IGNORE_THRESHOLD = 5;
const DIANA_IGNORE_DECAY = 5; // per day

// ============================================
// TIME OF DAY DISPLAY
// ============================================
const TIME_DISPLAY = {
    morning: { label: 'Morning', icon: '☀' },
    noon: { label: 'Afternoon', icon: '🌤' },
    night: { label: 'Night', icon: '🌙' },
};
