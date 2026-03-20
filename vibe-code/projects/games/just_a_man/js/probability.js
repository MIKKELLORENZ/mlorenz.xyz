/* ============================================
   JUST A MAN - Probability & RNG Systems
   ============================================ */

// Seeded-ish random for reproducibility within a day
function randomFloat() {
    return Math.random();
}

function randomInt(min, max) {
    return Math.floor(randomFloat() * (max - min + 1)) + min;
}

function randomChance(probability) {
    return randomFloat() < probability;
}

// Pick random items from array
function randomPick(arr, count) {
    const shuffled = [...arr].sort(() => randomFloat() - 0.5);
    return shuffled.slice(0, count);
}

function randomElement(arr) {
    return arr[Math.floor(randomFloat() * arr.length)];
}

// ============================================
// MALL PRICE GENERATION
// ============================================

function getMallPrice(item) {
    // Mall sells secondhand at 60-80% of base value
    const mult = 0.6 + randomFloat() * 0.2;
    return Math.round(item.baseValue * mult);
}

function getMallSellPrice(item) {
    // When player sells at mall (fallback), 90-130% of base
    const mult = 0.9 + randomFloat() * 0.4;
    return Math.round(item.baseValue * mult);
}

// ============================================
// PAWN SHOP PRICE GENERATION
// ============================================

function getVinnieMargins() {
    const trust = gameState.npcs.vinnie.trust;
    for (const tier of VINNIE_MARGINS) {
        if (trust <= tier.maxTrust) return tier;
    }
    return VINNIE_MARGINS[VINNIE_MARGINS.length - 1];
}

function getVinnieBuyPrice(item) {
    const margins = getVinnieMargins();
    return Math.round(item.baseValue * margins.buyMult);
}

function getVinnieSellPrice(item) {
    const margins = getVinnieMargins();
    return Math.round(item.baseValue * margins.sellMult);
}

// ============================================
// DAILY SHOP INVENTORY GENERATION
// ============================================

function generateDailyPawnStock() {
    const count = randomInt(3, 5);
    let pool = [...PAWN_ITEMS];
    if (gameState.npcs.vinnie.trust >= 80) {
        pool = pool.concat(PAWN_RARE_ITEMS);
    }
    return randomPick(pool, count).map(item => ({
        ...item,
        sellPrice: getVinnieSellPrice(item),
    }));
}

function generateDailyMallStock() {
    const count = randomInt(3, 5);
    return randomPick(MALL_SECONDHAND, count).map(item => ({
        ...item,
        buyPrice: getMallPrice(item),
    }));
}

// ============================================
// STOCK MARKET
// ============================================

function initializeStockPrices() {
    const prices = {};
    const history = {};
    STOCKS.forEach(stock => {
        prices[stock.ticker] = stock.basePrice;
        history[stock.ticker] = [stock.basePrice];
    });
    gameState.stockPrices = prices;
    gameState.stockHistory = history;
}

function updateStockPrices() {
    // Random walk for each stock
    STOCKS.forEach(stock => {
        const currentPrice = gameState.stockPrices[stock.ticker];
        // Base drift: -5% to +5%
        const drift = (randomFloat() - 0.5) * 0.10;
        let newPrice = currentPrice * (1 + drift);

        // Apply news event if applicable
        if (gameState.currentNews && gameState.currentNews.ticker === stock.ticker) {
            newPrice = currentPrice * (1 + gameState.currentNews.impact);
            gameState.currentNews = null; // consumed
        }

        // Floor at $1
        newPrice = Math.max(1, Math.round(newPrice * 100) / 100);
        gameState.stockPrices[stock.ticker] = newPrice;

        // Track history (keep last 10)
        if (!gameState.stockHistory[stock.ticker]) {
            gameState.stockHistory[stock.ticker] = [];
        }
        gameState.stockHistory[stock.ticker].push(newPrice);
        if (gameState.stockHistory[stock.ticker].length > 10) {
            gameState.stockHistory[stock.ticker].shift();
        }
    });

    // Possibly generate a news event (every 2-3 days)
    if (gameState.currentDay - gameState.lastNewsDay >= randomInt(2, 3)) {
        gameState.currentNews = randomElement(NEWS_EVENTS);
        gameState.lastNewsDay = gameState.currentDay;
    }
}

function getMarcusTip() {
    const trust = gameState.npcs.marcus.trust;
    let accuracy = 0.5;
    for (const tier of MARCUS_TIP_ACCURACY) {
        if (trust <= tier.maxTrust) {
            accuracy = tier.accuracy;
            break;
        }
    }

    // If there's a pending news event, Marcus might know about it
    if (gameState.currentNews) {
        const isGood = gameState.currentNews.impact > 0;
        if (randomChance(accuracy)) {
            // Accurate tip
            return {
                ticker: gameState.currentNews.ticker,
                direction: isGood ? 'up' : 'down',
                accurate: true,
            };
        } else {
            // Bad tip (wrong direction)
            return {
                ticker: gameState.currentNews.ticker,
                direction: isGood ? 'down' : 'up',
                accurate: false,
            };
        }
    }

    // No pending news, give generic tip
    const stock = randomElement(STOCKS);
    return {
        ticker: stock.ticker,
        direction: randomChance(0.5) ? 'up' : 'down',
        accurate: randomChance(accuracy),
    };
}

function getPortfolioValue() {
    return gameState.stockPortfolio.reduce((sum, holding) => {
        const price = gameState.stockPrices[holding.ticker] || 0;
        return sum + (price * holding.shares);
    }, 0);
}

// ============================================
// RAY DEAL RESOLUTION
// ============================================

function resolveRayDeal(investAmount) {
    const trust = gameState.npcs.ray.trust;
    let odds = RAY_DEAL_ODDS[0];
    for (const tier of RAY_DEAL_ODDS) {
        if (trust <= tier.maxTrust) {
            odds = tier;
            break;
        }
    }

    // If Ray family was helped, boost to 80% success
    if (gameState.flags.rayFamilyHelped) {
        odds = { success: 0.80, fail: 0.15, jackpot: 0.05, multiplier: 3 };
    }

    const roll = randomFloat();
    if (roll < odds.success) {
        return { outcome: 'success', payout: investAmount * odds.multiplier };
    } else if (roll < odds.success + odds.jackpot) {
        return { outcome: 'jackpot', payout: investAmount * (odds.multiplier * 2) };
    } else {
        return { outcome: 'failure', payout: 0 };
    }
}

function resolveRayBigDeal(investAmount) {
    const roll = randomFloat();
    if (roll < 0.55) {
        return { outcome: 'success', payout: investAmount * 3 };
    } else if (roll < 0.90) {
        return { outcome: 'partial', payout: investAmount * 1.5 };
    } else {
        return { outcome: 'disaster', payout: 0 };
    }
}

// ============================================
// RANDOM EVENT CHECKING
// ============================================

function checkRandomEvents(location, time) {
    const eligible = RANDOM_EVENTS.filter(event => {
        if (event.location !== location) return false;
        if (event.time !== 'any' && event.time !== time) return false;

        // Check required flags
        if (event.requireFlags) {
            for (const [key, val] of Object.entries(event.requireFlags)) {
                if (gameState.flags[key] !== val) return false;
            }
        }

        return true;
    });

    for (const event of eligible) {
        if (randomChance(event.chance)) {
            return event;
        }
    }
    return null;
}

// ============================================
// CHARM/SKILL CHECKS
// ============================================

function charmCheck(threshold) {
    return gameState.charm >= threshold;
}

function negotiateCheck(threshold) {
    // Charm + small random factor
    const roll = gameState.charm + randomInt(-5, 10);
    return roll >= threshold;
}

// ============================================
// CASINO
// ============================================

function checkCasinoLucky() {
    const day = gameState.currentDay;
    const time = gameState.timeOfDay;
    // Check each found note
    if (gameState.flags.foundLuckyNote && day === gameState.flags.luckyDay && time === gameState.flags.luckyTime) return true;
    if (gameState.flags.foundLuckyNote2 && day === gameState.flags.luckyDay2 && time === gameState.flags.luckyTime2) return true;
    // Every 7th day at noon has a small bonus (recurring pattern — "Lucky 7s")
    if (day % 7 === 0 && time === 'noon') return true;
    return false;
}

function playCasinoGame(gameId, betAmount) {
    const game = CASINO_GAMES[gameId];
    if (!game) return { outcome: 'lose', payout: 0 };

    const isLucky = checkCasinoLucky();
    const odds = isLucky ? game.luckyOdds : game.normalOdds;

    const roll = randomFloat();
    if (roll < odds.jackpot) {
        return { outcome: 'jackpot', payout: Math.round(betAmount * odds.jackpotMult), isLucky };
    } else if (roll < odds.jackpot + odds.win) {
        return { outcome: 'win', payout: Math.round(betAmount * odds.winMult), isLucky };
    } else {
        return { outcome: 'lose', payout: 0, isLucky };
    }
}
