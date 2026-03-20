/* ============================================
   JUST A MAN - Location Definitions & Actions
   ============================================ */

const LOCATIONS = {
    home: {
        id: 'home',
        name: 'Home',
        description: 'Your apartment',
        alwaysAvailable: true,
        times: ['morning', 'noon', 'night'],
        getActions(time) {
            const actions = [
                { id: 'rest', label: 'Rest', desc: 'Take it easy. (-5 Stress)', cost: null, action: 'rest' },
                { id: 'travel', label: 'Go Somewhere', desc: 'Open the city map.', cost: null, action: 'travel' },
            ];
            if (gameState.flags.boomboxBought) {
                actions.splice(1, 0, { id: 'boombox', label: 'Listen to Boombox', desc: 'Tunes. (-4 Stress)', cost: null, action: 'boombox' });
            }
            actions.splice(1, 0, { id: 'cherry_coke', label: 'Drink Cherry Coke', desc: '(-2 Stress, +1 Charm) $2', cost: 2, action: 'cherry_coke' });
            actions.push({ id: 'save', label: 'Save Game', desc: 'Save your progress.', cost: null, action: 'save_game' });
            return actions;
        }
    },

    park: {
        id: 'park',
        name: 'Central Park',
        description: 'Trees, benches, fresh air',
        alwaysAvailable: true,
        times: ['morning', 'noon', 'night'],
        getActions(time) {
            const actions = [
                { id: 'walk', label: 'Take a Walk', desc: 'Clear your head. (-3 Stress)', cost: null, action: 'park_walk' },
                { id: 'travel', label: 'Go Somewhere', desc: 'Open the city map.', cost: null, action: 'travel' },
            ];
            // Ray appears noon/night after day 5
            if ((time === 'noon' || time === 'night') && gameState.currentDay >= 5) {
                if (!gameState.flags.rayIntroduced) {
                    actions.splice(1, 0, { id: 'approach_ray', label: 'Approach the Man in the Leather Jacket', desc: 'He\'s watching you.', cost: null, action: 'ray_intro' });
                } else if (gameState.npcs.ray.met) {
                    actions.splice(1, 0, { id: 'talk_ray', label: 'Talk to Ray', desc: 'See what he\'s got.', cost: null, action: 'talk_ray' });
                }
            }
            // Night: chance to find money
            if (time === 'night') {
                actions.splice(1, 0, { id: 'search', label: 'Search Around', desc: 'Look for anything useful.', cost: null, action: 'park_search' });
            }
            return actions;
        }
    },

    mall: {
        id: 'mall',
        name: 'Riverside Mall',
        description: 'Shopping, food, deals',
        alwaysAvailable: true,
        times: ['morning', 'noon'],
        getActions(time) {
            return [
                { id: 'secondhand', label: 'Browse Secondhand Corner', desc: 'Find items to flip.', cost: null, action: 'mall_secondhand' },
                { id: 'clothing', label: 'Browse Clothing', desc: 'Look sharp. (+Charm)', cost: null, action: 'mall_clothing' },
                { id: 'gifts', label: 'Browse Gift Shop', desc: 'Buy something special for someone.', cost: null, action: 'mall_gifts' },
                { id: 'food', label: 'Food Court', desc: 'Eat. (-3 Stress) $8', cost: 8, action: 'mall_food' },
                { id: 'travel', label: 'Go Somewhere', desc: 'Open the city map.', cost: null, action: 'travel' },
            ];
        }
    },

    cafe: {
        id: 'cafe',
        name: "Joe's Cafe",
        description: 'Coffee, Cherry Coke, conversation',
        alwaysAvailable: true,
        times: ['morning', 'noon', 'night'],
        getActions(time) {
            const actions = [
                { id: 'coffee', label: 'Order Coffee', desc: '(-2 Stress) $3', cost: 3, action: 'cafe_coffee' },
                { id: 'cherry_coke', label: 'Order Cherry Coke', desc: '(-2 Stress, +1 Charm) $2', cost: 2, action: 'cafe_cherry_coke' },
                { id: 'travel', label: 'Go Somewhere', desc: 'Open the city map.', cost: null, action: 'travel' },
            ];
            // Diana at noon from day 3
            if (time === 'noon' && gameState.currentDay >= 3) {
                if (!gameState.flags.metDiana && !gameState.flags.noticedDiana) {
                    actions.splice(0, 0, { id: 'diana_notice', label: 'A Woman Sketching by the Window...', desc: 'She hasn\'t noticed you.', cost: null, action: 'diana_first_meeting' });
                } else if (gameState.npcs.diana.met) {
                    actions.splice(0, 0, { id: 'talk_diana', label: 'Talk to Diana', desc: 'She\'s at her usual spot.', cost: null, action: 'talk_diana' });
                }
            }
            // Marcus random encounter day 15+
            if (time === 'noon' && gameState.currentDay >= 15 && !gameState.npcs.marcus.met && !hasSeenDialog('MARCUS_CAFE_INTRO')) {
                actions.splice(1, 0, { id: 'marcus_notice', label: 'Man in Suspenders at the Counter', desc: 'Sharp-looking. Checking a pager.', cost: null, action: 'marcus_cafe_intro' });
            }
            return actions;
        }
    },

    subway: {
        id: 'subway',
        name: 'Metro Subway',
        description: 'Travel hub, random encounters',
        alwaysAvailable: true,
        times: ['morning', 'noon', 'night'],
        getActions(time) {
            return [
                { id: 'travel', label: 'Check the Map', desc: 'Where to next?', cost: null, action: 'travel' },
                { id: 'wait', label: 'Wait and Watch', desc: 'People-watching. (-1 Stress)', cost: null, action: 'subway_wait' },
            ];
        }
    },

    downtown: {
        id: 'downtown',
        name: 'Downtown',
        description: 'The heart of the city',
        alwaysAvailable: true,
        times: ['morning', 'noon', 'night'],
        getActions(time) {
            const actions = [
                { id: 'network', label: 'Network', desc: 'Talk to people. (+1 Rep)', cost: null, action: 'downtown_network' },
                { id: 'hustle', label: 'Street Hustle', desc: 'Look for opportunities.', cost: null, action: 'downtown_hustle' },
                { id: 'travel', label: 'Go Somewhere', desc: 'Open the city map.', cost: null, action: 'travel' },
            ];
            return actions;
        }
    },

    pawnshop: {
        id: 'pawnshop',
        name: "Vinnie's Pawn",
        description: 'Buy low, sell high',
        alwaysAvailable: true,
        times: ['morning', 'noon'],
        getActions(time) {
            const actions = [];
            if (!gameState.npcs.vinnie.met) {
                actions.push({ id: 'enter', label: 'Enter the Shop', desc: 'A gruff man watches from behind the counter.', cost: null, action: 'vinnie_intro' });
            } else {
                actions.push({ id: 'buy', label: 'Buy from Vinnie', desc: 'See what\'s in stock.', cost: null, action: 'pawn_buy' });
                if (gameState.inventory.length > 0) {
                    actions.push({ id: 'sell', label: 'Sell to Vinnie', desc: 'Show him what you\'ve got.', cost: null, action: 'pawn_sell' });
                }
                actions.push({ id: 'talk', label: 'Talk to Vinnie', desc: 'Shoot the breeze.', cost: null, action: 'talk_vinnie' });
            }
            actions.push({ id: 'travel', label: 'Go Somewhere', desc: 'Open the city map.', cost: null, action: 'travel' });
            return actions;
        }
    },

    brokerage: {
        id: 'brokerage',
        name: 'Bull & Bear Brokerage',
        description: 'Where fortunes are made and lost',
        alwaysAvailable: false,
        times: ['morning', 'noon'],
        isUnlocked() {
            return gameState.flags.stockBrokerageUnlocked && gameState.npcs.marcus.met;
        },
        getActions(time) {
            const actions = [
                { id: 'trade', label: 'Trade Stocks', desc: 'Buy and sell on the floor.', cost: null, action: 'stock_trade' },
                { id: 'talk_marcus', label: 'Talk to Marcus', desc: 'Get a tip or catch up.', cost: null, action: 'talk_marcus' },
                { id: 'travel', label: 'Go Somewhere', desc: 'Open the city map.', cost: null, action: 'travel' },
            ];
            return actions;
        }
    },

    carlot: {
        id: 'carlot',
        name: "Crazy Eddie's Used Cars",
        description: 'Four wheels and a dream',
        alwaysAvailable: false,
        times: ['morning', 'noon'],
        isUnlocked() {
            return gameState.cash >= 500 || gameState.flags.act2Unlocked;
        },
        getActions(time) {
            return [
                { id: 'browse', label: 'Browse Cars', desc: 'See what\'s on the lot.', cost: null, action: 'carlot_browse' },
                { id: 'travel', label: 'Go Somewhere', desc: 'Open the city map.', cost: null, action: 'travel' },
            ];
        }
    },

    nightclub: {
        id: 'nightclub',
        name: 'Club Neon',
        description: 'Dance, network, deal',
        alwaysAvailable: false,
        times: ['night'],
        isUnlocked() {
            return gameState.reputation >= 25 || gameState.npcs.tony.met || gameState.flags.nightclubUnlocked;
        },
        getActions(time) {
            const actions = [
                { id: 'dance', label: 'Dance', desc: 'Hit the floor. (+2 Charm)', cost: null, action: 'nightclub_dance' },
                { id: 'drink', label: 'Buy a Drink', desc: '(-3 Stress) $15', cost: 15, action: 'nightclub_drink' },
                { id: 'network', label: 'Network', desc: 'Meet people. (+Rep)', cost: null, action: 'nightclub_network' },
            ];
            if (gameState.npcs.tony.met) {
                actions.splice(2, 0, { id: 'talk_tony', label: 'Talk to Tony', desc: 'VIP area.', cost: null, action: 'talk_tony' });
            } else {
                actions.splice(0, 0, { id: 'meet_tony', label: 'The Big Man Approaches...', desc: 'Gold chains. Wide smile.', cost: null, action: 'tony_intro' });
            }
            actions.push({ id: 'travel', label: 'Leave', desc: 'Back to the city.', cost: null, action: 'travel' });
            return actions;
        }
    },

    restaurant: {
        id: 'restaurant',
        name: 'La Bella Vita',
        description: 'Fine dining. Date night.',
        alwaysAvailable: false,
        times: ['noon', 'night'],
        isUnlocked() {
            return (gameState.npcs.diana.relationshipStage === 'dating' ||
                    gameState.npcs.diana.relationshipStage === 'committed') &&
                   gameState.cash >= 200;
        },
        getActions(time) {
            const actions = [
                { id: 'dinner_diana', label: 'Dinner with Diana', desc: 'A special evening. ~$75-150', cost: null, action: 'restaurant_date' },
                { id: 'eat_alone', label: 'Eat Alone', desc: 'Treat yourself. $75', cost: 75, action: 'restaurant_solo' },
                { id: 'travel', label: 'Leave', desc: 'Back to the city.', cost: null, action: 'travel' },
            ];
            // Proposal option
            if (gameState.npcs.diana.relationshipStage === 'committed' &&
                gameState.npcs.diana.trust >= 75 &&
                gameState.propertiesOwned.length >= 1 &&
                !gameState.flags.proposedToDiana &&
                time === 'night') {
                actions.splice(1, 0, { id: 'propose', label: 'Tonight\'s the Night...', desc: 'You have the ring.', cost: null, action: 'diana_proposal' });
            }
            return actions;
        }
    },

    casino: {
        id: 'casino',
        name: 'The Golden Ace',
        description: 'Cards, slots, roulette. Risky.',
        alwaysAvailable: false,
        times: ['noon', 'night'],
        isUnlocked() {
            return gameState.flags.act2Unlocked || gameState.cash >= 200;
        },
        getActions(time) {
            const isLucky = checkCasinoLucky();
            const actions = [
                { id: 'slots', label: 'Slot Machines', desc: isLucky ? 'The machines feel warm today...' : 'Pull the lever. $10-500', cost: null, action: 'casino_slots' },
                { id: 'blackjack', label: 'Blackjack Table', desc: isLucky ? 'The cards are calling...' : 'Beat the dealer. $25-2000', cost: null, action: 'casino_blackjack' },
                { id: 'roulette', label: 'Roulette Wheel', desc: isLucky ? 'The wheel hums differently...' : 'Pick your number. $20-5000', cost: null, action: 'casino_roulette' },
                { id: 'drink', label: 'Free Drinks', desc: 'On the house. (-2 Stress)', cost: null, action: 'casino_drink' },
                { id: 'travel', label: 'Leave', desc: 'Walk away. Smart move.', cost: null, action: 'travel' },
            ];
            return actions;
        }
    },

    realestate: {
        id: 'realestate',
        name: 'Chen & Associates Realty',
        description: 'Property is power',
        alwaysAvailable: false,
        times: ['morning', 'noon'],
        isUnlocked() {
            return gameState.flags.realEstateOfficeUnlocked ||
                   (gameState.reputation >= 40 && gameState.cash >= 5000 && gameState.flags.act3Unlocked);
        },
        getActions(time) {
            const actions = [];
            if (!gameState.npcs.mrsChen.met) {
                actions.push({ id: 'enter', label: 'Enter the Office', desc: 'A sharp woman looks up from her desk.', cost: null, action: 'chen_intro' });
            } else {
                actions.push({ id: 'browse', label: 'Browse Properties', desc: 'See what\'s available.', cost: null, action: 'realestate_browse' });
                actions.push({ id: 'talk', label: 'Talk to Mrs. Chen', desc: 'Build the relationship.', cost: null, action: 'talk_chen' });
            }
            actions.push({ id: 'travel', label: 'Leave', desc: 'Back to the city.', cost: null, action: 'travel' });
            return actions;
        }
    },
};

// ============================================
// LOCATION AVAILABILITY
// ============================================

function isLocationAvailable(locationId, timeOfDay) {
    const loc = LOCATIONS[locationId];
    if (!loc) return false;

    // Check time
    if (!loc.times.includes(timeOfDay)) return false;

    // Check unlock
    if (!loc.alwaysAvailable && loc.isUnlocked && !loc.isUnlocked()) return false;

    return true;
}

function getAvailableLocations(timeOfDay) {
    return Object.keys(LOCATIONS).filter(id => isLocationAvailable(id, timeOfDay));
}

function getAllLocationsForMap(timeOfDay) {
    return Object.entries(LOCATIONS).map(([id, loc]) => ({
        id,
        name: loc.name,
        description: loc.description,
        available: isLocationAvailable(id, timeOfDay),
        locked: !loc.alwaysAvailable && loc.isUnlocked && !loc.isUnlocked(),
        current: gameState.currentLocation === id,
    }));
}
