/* ============================================
   JUST A MAN - Game Engine
   Core loop, action handling, game flow
   ============================================ */

const Engine = {
    dailyPawnStock: [],
    dailyMallStock: [],

    // ============================================
    // GAME START
    // ============================================

    newGame() {
        gameState = createDefaultState();
        UI.hideTitleScreen();
        UI.updateHUD();

        // Generate daily stock
        this.regenerateDailyStock();

        // Start Act 1 music
        AudioManager.playMusicForAct(1);

        // Opening sequence
        UI.showDialog('OPENING_1', () => {
            this.enterLocation('home');
        });
    },

    continueGame() {
        const saved = loadGame();
        if (!saved) return;
        gameState = saved;
        UI.hideTitleScreen();
        UI.updateHUD();
        this.regenerateDailyStock();
        this.enterLocation(gameState.currentLocation);
    },

    restart() {
        deleteSave();
        UI.hideEndScreens();
        this.newGame();
    },

    // ============================================
    // LOCATION MANAGEMENT
    // ============================================

    enterLocation(locationId) {
        gameState.currentLocation = locationId;
        const sceneId = getSceneForLocation(locationId, gameState.timeOfDay);
        UI.setScene(sceneId);
        UI.updateHUD();

        // Check for story events at this location
        const storyEvents = checkStoryEvents();
        if (storyEvents.length > 0) {
            this.processEventQueue([...storyEvents], () => {
                UI.showActions(locationId);
            });
            return;
        }

        // Check random events
        const randomEvent = checkRandomEvents(locationId, gameState.timeOfDay);
        if (randomEvent) {
            this.handleRandomEvent(randomEvent, () => {
                UI.showActions(locationId);
            });
            return;
        }

        UI.showActions(locationId);
    },

    travelTo(locationId) {
        if (!isLocationAvailable(locationId, gameState.timeOfDay)) {
            UI.notify('That location isn\'t available right now.', 'bad');
            return;
        }

        // Show brief loading bar when changing locations
        const loc = LOCATIONS[locationId];
        const travelText = loc ? `Heading to ${loc.name}...` : 'Traveling...';
        AudioManager.playSfx('sfx_footsteps');
        UI.showLoadingBar(travelText, randomInt(400, 700), () => {
            this.enterLocation(locationId);
        });
    },

    // ============================================
    // ACTION HANDLING
    // ============================================

    handleAction(action) {
        switch (action.action) {
            case 'travel':
                UI.showLocationMap();
                break;

            case 'save_game':
                if (saveGame()) {
                    UI.notify('Game saved!', 'good');
                } else {
                    UI.notify('Save failed!', 'bad');
                }
                UI.showActions(gameState.currentLocation);
                break;

            // === HOME ACTIONS ===
            case 'rest':
                this.doAction(() => {
                    modifyStress(-5);
                    UI.setScene(gameState.flags.boomboxBought ? 'activity_cherry_coke' : getSceneForLocation('home', gameState.timeOfDay));
                    UI.notify('You rest for a while. (-5 Stress)', 'good');
                });
                break;

            case 'cherry_coke':
                if (gameState.cash < 2) { UI.notify('Not enough cash.', 'bad'); UI.showActions('home'); return; }
                this.doAction(() => {
                    modifyCash(-2);
                    modifyStress(-2);
                    modifyCharm(1);
                    gameState.flags.cherryCokesDrunk++;
                    UI.setScene('activity_cherry_coke');
                    UI.notify('Cherry Coke. The taste of optimism. (-2 Stress, +1 Charm)', 'good');
                });
                break;

            case 'boombox':
                this.doAction(() => {
                    modifyStress(-4);
                    UI.setScene('activity_boombox');
                    UI.notify('Music fills the room. (-4 Stress)', 'good');
                });
                break;

            // === PARK ACTIONS ===
            case 'park_walk':
                this.doAction(() => {
                    modifyStress(-3);
                    UI.setScene('activity_park_walk');
                    UI.notify('Fresh air and quiet. (-3 Stress)', 'good');
                });
                break;

            case 'park_search':
                this.doAction(() => {
                    if (randomChance(0.15)) {
                        const found = randomInt(5, 20);
                        modifyCash(found);
                        UI.notify(`You found $${found} on the ground!`, 'good');
                    } else {
                        UI.notify('Nothing tonight.', 'info');
                    }
                });
                break;

            case 'ray_intro':
                this.doAction(() => {
                    UI.showDialog('RAY_INTRO', () => this.afterAction());
                }, true);
                break;

            case 'talk_ray':
                this.doAction(() => {
                    const dialogId = getNpcTalkDialog('ray');
                    if (dialogId) {
                        UI.showDialog(dialogId, () => this.afterAction());
                    } else {
                        UI.notify('Ray nods at you.', 'info');
                        this.afterAction();
                    }
                }, true);
                break;

            // === MALL ACTIONS ===
            case 'mall_secondhand':
                this.doAction(() => {
                    UI.setScene('activity_mall_buying');
                    UI.showShop('Secondhand Corner', this.dailyMallStock, 'buy', (item, price) => {
                        modifyCash(-price);
                        addToInventory({ ...item, buyPrice: price });
                        gameState.flags.mallFlipCount++;
                        UI.notify(`Bought ${item.name} for $${price}`, 'good');
                        UI.updateHUD();
                        this.afterAction();
                    });
                }, true);
                break;

            case 'mall_clothing':
                this.doAction(() => {
                    UI.showShop('Clothing Store', MALL_CLOTHING, 'buy', (item, price) => {
                        modifyCash(-price);
                        modifyCharm(item.charmBoost);
                        UI.notify(`Looking sharp! (+${item.charmBoost} Charm)`, 'good');
                        UI.updateHUD();
                        this.afterAction();
                    });
                }, true);
                break;

            case 'mall_gifts':
                this.doAction(() => {
                    const giftList = Object.values(GIFTS).filter(g => g.buyAt === 'mall').map(g => ({
                        ...g, sellPrice: g.price,
                    }));
                    UI.showShop('Gift Shop', giftList, 'buy', (item, price) => {
                        modifyCash(-price);
                        addToInventory(item);
                        UI.notify(`Bought ${item.name}`, 'good');
                        UI.updateHUD();
                        this.afterAction();
                    });
                }, true);
                break;

            case 'mall_food':
                if (gameState.cash < 8) { UI.notify('Not enough cash.', 'bad'); UI.showActions('mall'); return; }
                this.doAction(() => {
                    modifyCash(-8);
                    modifyStress(-3);
                    UI.setScene('activity_food_court');
                    UI.notify('Burger and fries. Simple pleasures. (-3 Stress)', 'good');
                });
                break;

            // === CAFE ACTIONS ===
            case 'cafe_coffee':
                if (gameState.cash < 3) { UI.notify('Not enough cash.', 'bad'); UI.showActions('cafe'); return; }
                this.doAction(() => {
                    modifyCash(-3);
                    modifyStress(-2);
                    UI.notify('Hot coffee. The world slows down. (-2 Stress)', 'good');
                });
                break;

            case 'cafe_cherry_coke':
                if (gameState.cash < 2) { UI.notify('Not enough cash.', 'bad'); UI.showActions('cafe'); return; }
                this.doAction(() => {
                    modifyCash(-2);
                    modifyStress(-2);
                    modifyCharm(1);
                    gameState.flags.cherryCokesDrunk++;
                    UI.notify('Cherry Coke at Joe\'s. (-2 Stress, +1 Charm)', 'good');
                });
                break;

            case 'diana_first_meeting':
                this.doAction(() => {
                    UI.showDialog('DIANA_FIRST_MEETING', () => this.afterAction());
                }, true);
                break;

            case 'talk_diana':
                this.doAction(() => {
                    const dialogId = getNpcTalkDialog('diana');
                    if (dialogId) {
                        incrementNpcInteractions('diana');
                        UI.showDialog(dialogId, () => this.afterAction());
                    } else {
                        UI.notify('Diana smiles and waves.', 'info');
                        incrementNpcInteractions('diana');
                        this.afterAction();
                    }
                }, true);
                break;

            case 'marcus_cafe_intro':
                this.doAction(() => {
                    UI.showDialog('MARCUS_CAFE_INTRO', () => this.afterAction());
                }, true);
                break;

            // === SUBWAY ACTIONS ===
            case 'subway_wait':
                this.doAction(() => {
                    modifyStress(-1);
                    UI.notify('You watch the trains come and go. (-1 Stress)', 'info');
                });
                break;

            // === DOWNTOWN ACTIONS ===
            case 'downtown_network':
                this.doAction(() => {
                    modifyReputation(1);
                    UI.notify('You introduce yourself around. (+1 Rep)', 'good');
                });
                break;

            case 'downtown_hustle':
                this.doAction(() => {
                    if (randomChance(0.3)) {
                        const earn = randomInt(10, 40);
                        modifyCash(earn);
                        UI.notify(`Quick flip on the street! +$${earn}`, 'good');
                    } else {
                        modifyStress(2);
                        UI.notify('No luck today. (+2 Stress)', 'bad');
                    }
                });
                break;

            // === PAWN SHOP ACTIONS ===
            case 'vinnie_intro':
                this.doAction(() => {
                    UI.showDialog('VINNIE_INTRO', () => this.afterAction());
                }, true);
                break;

            case 'pawn_buy':
                this.doAction(() => {
                    UI.setScene('vinnie_showing_goods');
                    UI.showShop("Vinnie's Stock", this.dailyPawnStock, 'buy', (item, price) => {
                        modifyCash(-price);
                        addToInventory({ ...item, buyPrice: price });
                        modifyNpcTrust('vinnie', 2);
                        if (!gameState.flags.firstPawnTransaction) setFlag('firstPawnTransaction', true);
                        UI.notify(`Bought ${item.name} for $${price}`, 'good');
                        UI.updateHUD();
                        this.afterAction();
                    });
                }, true);
                break;

            case 'pawn_sell':
                this.doAction(() => {
                    UI.setScene('activity_pawnshop_selling');
                    const sellable = gameState.inventory.map(item => ({
                        ...item,
                        buyPrice: getVinnieBuyPrice(item),
                    }));
                    UI.showShop('Sell to Vinnie', sellable, 'sell', (item, price) => {
                        removeFromInventory(item.id);
                        modifyCash(price);
                        modifyNpcTrust('vinnie', 2);
                        gameState.dealsCompleted++;
                        if (!gameState.flags.firstPawnTransaction) setFlag('firstPawnTransaction', true);
                        UI.notify(`Sold ${item.name} for $${price}`, 'good');
                        UI.updateHUD();
                        this.afterAction();
                    });
                }, true);
                break;

            case 'talk_vinnie':
                this.doAction(() => {
                    const dialogId = getNpcTalkDialog('vinnie');
                    if (dialogId) {
                        incrementNpcInteractions('vinnie');
                        UI.showDialog(dialogId, () => this.afterAction());
                    } else {
                        incrementNpcInteractions('vinnie');
                        UI.notify('Vinnie grunts acknowledgment.', 'info');
                        this.afterAction();
                    }
                }, true);
                break;

            // === BROKERAGE ACTIONS ===
            case 'stock_trade':
                this.doAction(() => {
                    UI.setScene('activity_stock_trading');
                    if (!gameState.flags.firstStockTrade) setFlag('firstStockTrade', true);
                    UI.showStockTrading();
                }, true);
                break;

            case 'talk_marcus':
                this.doAction(() => {
                    const dialogId = getNpcTalkDialog('marcus');
                    if (dialogId) {
                        incrementNpcInteractions('marcus');
                        UI.showDialog(dialogId, () => this.afterAction());
                    } else {
                        UI.notify('Marcus is busy on a call.', 'info');
                        this.afterAction();
                    }
                }, true);
                break;

            // === CAR LOT ACTIONS ===
            case 'carlot_browse':
                this.doAction(() => {
                    UI.setScene('activity_buying_car');
                    const carItems = CARS.filter(c => c.id !== gameState.carOwned).map(c => ({
                        ...c, sellPrice: c.price,
                    }));
                    UI.showShop("Crazy Eddie's Cars", carItems, 'buy', (car, price) => {
                        modifyCash(-price);
                        gameState.carOwned = car.id;
                        modifyReputation(car.repBonus);
                        setFlag('boughtFirstCar', true);
                        setFlag('usedCarLotUnlocked', true);
                        UI.notify(`You bought a ${car.name}! (+${car.repBonus} Rep)`, 'good');
                        UI.updateHUD();
                        this.afterAction();
                    });
                }, true);
                break;

            // === NIGHTCLUB ACTIONS ===
            case 'nightclub_dance':
                this.doAction(() => {
                    modifyCharm(2);
                    UI.setScene('activity_nightclub_dancing');
                    UI.notify('You own the dance floor. (+2 Charm)', 'good');
                });
                break;

            case 'nightclub_drink':
                if (gameState.cash < 15) { UI.notify('Not enough cash.', 'bad'); UI.showActions('nightclub'); return; }
                this.doAction(() => {
                    modifyCash(-15);
                    modifyStress(-3);
                    UI.notify('Drink in hand, worries fading. (-3 Stress)', 'good');
                });
                break;

            case 'nightclub_network':
                this.doAction(() => {
                    const repGain = randomInt(1, 3);
                    modifyReputation(repGain);
                    UI.notify(`Shook some hands. (+${repGain} Rep)`, 'good');
                });
                break;

            case 'tony_intro':
                this.doAction(() => {
                    UI.showDialog('TONY_INTRO', () => this.afterAction());
                }, true);
                break;

            case 'talk_tony':
                this.doAction(() => {
                    const dialogId = getNpcTalkDialog('tony');
                    if (dialogId) {
                        incrementNpcInteractions('tony');
                        UI.showDialog(dialogId, () => this.afterAction());
                    } else {
                        UI.notify('Tony gives you a nod from VIP.', 'info');
                        this.afterAction();
                    }
                }, true);
                break;

            // === RESTAURANT ACTIONS ===
            case 'restaurant_date':
                this.doAction(() => {
                    modifyCash(-75);
                    modifyStress(-8);
                    gameState.npcs.diana.dateCount++;
                    incrementNpcInteractions('diana');
                    const dialogId = getNpcTalkDialog('diana');
                    if (dialogId) {
                        UI.showDialog(dialogId, () => this.afterAction());
                    } else {
                        modifyNpcTrust('diana', 5);
                        UI.notify('A lovely evening with Diana. (+Trust)', 'good');
                        this.afterAction();
                    }
                }, true);
                break;

            case 'restaurant_solo':
                if (gameState.cash < 75) { UI.notify('Not enough cash.', 'bad'); UI.showActions('restaurant'); return; }
                this.doAction(() => {
                    modifyCash(-75);
                    modifyStress(-8);
                    UI.notify('Fine dining, table for one. (-8 Stress)', 'good');
                });
                break;

            case 'diana_proposal':
                this.doAction(() => {
                    UI.showDialog('DIANA_PROPOSAL', () => this.afterAction());
                }, true);
                break;

            // === REAL ESTATE ACTIONS ===
            case 'chen_intro':
                this.doAction(() => {
                    UI.showDialog('CHEN_INTRO', () => this.afterAction());
                }, true);
                break;

            case 'realestate_browse':
                this.doAction(() => {
                    UI.setScene('chen_showing_listings');
                    const chenTrust = gameState.npcs.mrsChen.trust;
                    const available = PROPERTIES.filter(p =>
                        !gameState.propertiesOwned.includes(p.id) &&
                        chenTrust >= p.requiredTrust
                    ).map(p => ({ ...p, sellPrice: p.price }));
                    UI.showShop('Available Properties', available, 'buy', (prop, price) => {
                        // Apply discount for high trust
                        let finalPrice = price;
                        if (chenTrust >= 80) finalPrice = Math.round(price * 0.85);
                        else if (chenTrust >= 60) finalPrice = Math.round(price * 0.90);
                        else if (chenTrust >= 40) finalPrice = Math.round(price * 0.95);

                        if (gameState.cash < finalPrice) {
                            UI.notify('Not enough cash for this property.', 'bad');
                            this.afterAction();
                            return;
                        }

                        modifyCash(-finalPrice);
                        addProperty(prop.id);
                        modifyReputation(prop.repBonus);
                        UI.showDialog('CHEN_DEAL_CLOSE', () => this.afterAction());
                    });
                }, true);
                break;

            case 'talk_chen':
                this.doAction(() => {
                    const dialogId = getNpcTalkDialog('mrsChen');
                    if (dialogId) {
                        incrementNpcInteractions('mrsChen');
                        UI.showDialog(dialogId, () => this.afterAction());
                    } else {
                        UI.notify('Mrs. Chen nods professionally.', 'info');
                        this.afterAction();
                    }
                }, true);
                break;

            // === CASINO ACTIONS ===
            case 'casino_slots':
                this.doCasinoGame('slots');
                break;

            case 'casino_blackjack':
                this.doCasinoGame('blackjack');
                break;

            case 'casino_roulette':
                this.doCasinoGame('roulette');
                break;

            case 'casino_drink':
                this.doAction(() => {
                    modifyStress(-2);
                    AudioManager.playSfx('sfx_cherry_coke');
                    UI.notify('Free drinks at the casino. (-2 Stress)', 'good');
                });
                break;

            default:
                UI.notify('Not implemented yet.', 'info');
                UI.showActions(gameState.currentLocation);
                break;
        }
    },

    // ============================================
    // ACTION WRAPPER (handles time advancement)
    // ============================================

    doAction(fn, skipAfter) {
        fn();
        if (!skipAfter) {
            this.afterAction();
        }
    },

    afterAction() {
        const timeAdvanced = useAction();
        UI.updateHUD();

        if (timeAdvanced) {
            // Check morning events on new day
            if (gameState.timeOfDay === 'morning') {
                this.regenerateDailyStock();
                const morningEvents = morningCheck();
                if (morningEvents.length > 0) {
                    this.processEventQueue(morningEvents, () => {
                        this.enterLocation(gameState.currentLocation);
                    });
                    return;
                }
            }
            // Update scene for new time
            const sceneId = getSceneForLocation(gameState.currentLocation, gameState.timeOfDay);
            UI.setScene(sceneId);
            UI.notify(`Time passes... ${TIME_DISPLAY[gameState.timeOfDay].label}`, 'info');
        }

        // Check win/lose after each action
        const loseType = checkLoseCondition();
        if (loseType) {
            const dialogId = loseType === 'bankrupt' ? 'LOSE_BANKRUPT' : 'LOSE_BURNOUT';
            UI.showDialog(dialogId, () => UI.showGameOver(loseType));
            return;
        }
        if (checkWinCondition()) {
            UI.showDialog('WIN_ENDING', () => UI.showWinScreen());
            return;
        }

        // Show action menu again
        if (!UI.els.dialogOverlay.classList.contains('hidden')) return;
        if (!UI.els.shopOverlay.classList.contains('hidden')) return;
        if (!UI.els.stockOverlay.classList.contains('hidden')) return;
        UI.showActions(gameState.currentLocation);
    },

    // ============================================
    // EVENT QUEUE PROCESSING
    // ============================================

    processEventQueue(events, onComplete) {
        if (events.length === 0) {
            if (onComplete) onComplete();
            return;
        }

        const event = events.shift();

        if (typeof event === 'string') {
            // It's a dialog ID
            UI.showDialog(event, () => {
                this.processEventQueue(events, onComplete);
            });
        } else if (event.type === 'notification') {
            UI.notify(event.text, event.kind);
            this.processEventQueue(events, onComplete);
        }
    },

    // ============================================
    // RANDOM EVENT HANDLING
    // ============================================

    handleRandomEvent(event, onComplete) {
        if (event.scene) UI.setScene(event.scene);

        // Build a mini dialog
        const dialogId = '_random_' + event.id;
        DIALOGS[dialogId] = {
            id: dialogId,
            scene: event.scene,
            speaker: 'NARRATOR',
            text: event.dialog,
            choices: event.choices.map(choice => {
                const c = {
                    text: choice.text,
                    effects: { ...choice.effects },
                    next: null,
                };
                if (choice.requireCash && gameState.cash < choice.requireCash) {
                    c.condition = () => false;
                }
                if (choice.setFlags) {
                    c.setFlags = choice.setFlags;
                }
                if (choice.charmCheck) {
                    c.onSelect = () => {
                        if (!charmCheck(choice.charmCheck.threshold)) {
                            this.applyEffects(choice.charmCheck.failEffects);
                            UI.notify('Your bluff failed!', 'bad');
                        }
                    };
                }
                if (choice.probabilityCheck) {
                    c.onSelect = () => {
                        if (!randomChance(choice.probabilityCheck.chance)) {
                            if (choice.probabilityCheck.failEffects) {
                                Object.entries(choice.probabilityCheck.failEffects).forEach(([k, v]) => {
                                    if (k === 'cash') modifyCash(v);
                                    if (k === 'stress') modifyStress(v);
                                });
                            }
                            UI.notify('That didn\'t go well...', 'bad');
                        } else {
                            UI.notify('You got away!', 'good');
                        }
                    };
                }
                return c;
            }),
        };

        UI.showDialog(dialogId, onComplete);
    },

    // ============================================
    // STOCK TRADING
    // ============================================

    buyStock(ticker) {
        const price = gameState.stockPrices[ticker];
        if (!price) return;

        const shares = Math.min(10, Math.floor(gameState.cash / price));
        if (shares <= 0) {
            UI.notify('Not enough cash to buy.', 'bad');
            return;
        }

        const cost = Math.round(shares * price * 100) / 100;
        modifyCash(-cost);

        const existing = gameState.stockPortfolio.find(h => h.ticker === ticker);
        if (existing) {
            existing.shares += shares;
            existing.buyPrice = ((existing.buyPrice * (existing.shares - shares)) + cost) / existing.shares;
        } else {
            gameState.stockPortfolio.push({ ticker, shares, buyPrice: price });
        }

        if (!gameState.flags.firstStockTrade) setFlag('firstStockTrade', true);
        UI.notify(`Bought ${shares} shares of ${ticker} for $${cost.toFixed(2)}`, 'good');
        UI.updateHUD();
        UI.showStockTrading(); // refresh
    },

    sellStock(ticker) {
        const holding = gameState.stockPortfolio.find(h => h.ticker === ticker);
        if (!holding || holding.shares <= 0) {
            UI.notify('No shares to sell.', 'bad');
            return;
        }

        const price = gameState.stockPrices[ticker];
        const revenue = Math.round(holding.shares * price * 100) / 100;
        modifyCash(revenue);

        // Remove holding
        gameState.stockPortfolio = gameState.stockPortfolio.filter(h => h.ticker !== ticker);

        UI.notify(`Sold all ${ticker} for $${revenue.toFixed(2)}`, 'good');
        UI.updateHUD();
        UI.showStockTrading(); // refresh
    },

    // ============================================
    // DAILY STOCK REGENERATION
    // ============================================

    regenerateDailyStock() {
        this.dailyPawnStock = generateDailyPawnStock();
        this.dailyMallStock = generateDailyMallStock();
    },

    // ============================================
    // CASINO GAME
    // ============================================

    doCasinoGame(gameId) {
        const game = CASINO_GAMES[gameId];
        if (!game) return;

        const sceneLookup = { slots: 'casino_slots', blackjack: 'casino_blackjack', roulette: 'casino_roulette' };
        UI.setScene(sceneLookup[gameId] || 'casino_interior');

        // Build bet selection dialog
        const bets = [game.minBet];
        if (game.minBet * 5 <= game.maxBet) bets.push(game.minBet * 5);
        if (game.minBet * 20 <= game.maxBet) bets.push(game.minBet * 20);
        if (game.maxBet > game.minBet * 20) bets.push(game.maxBet);

        const isLucky = checkCasinoLucky();
        const luckyHint = isLucky ? '\n\nSomething feels different tonight...' : '';

        const dialogId = '_casino_bet_' + gameId;
        DIALOGS[dialogId] = {
            id: dialogId,
            speaker: 'DEALER',
            text: `Welcome to ${game.name}. Place your bet.${luckyHint}`,
            choices: bets.map(bet => ({
                text: `Bet $${bet}`,
                condition: () => gameState.cash >= bet,
                next: null,
                onSelect: () => {
                    modifyCash(-bet);
                    modifyStress(2);

                    // Play SFX
                    const sfxMap = { slots: 'sfx_slot_spin', blackjack: 'sfx_card_flip', roulette: 'sfx_roulette_spin' };
                    AudioManager.playSfx(sfxMap[gameId]);

                    // Show loading bar as "tension"
                    const tensionText = { slots: 'Spinning...', blackjack: 'Dealing...', roulette: 'The wheel spins...' };
                    UI.showLoadingBar(tensionText[gameId] || 'Playing...', 1200, () => {
                        const result = playCasinoGame(gameId, bet);

                        if (result.outcome === 'jackpot') {
                            modifyCash(result.payout);
                            UI.setScene('casino_win');
                            AudioManager.playSfx('sfx_slot_win');
                            AudioManager.playSfx('sfx_crowd_cheer');
                            UI.notify(`JACKPOT! You won $${result.payout}!`, 'good');
                        } else if (result.outcome === 'win') {
                            modifyCash(result.payout);
                            UI.setScene('casino_win');
                            AudioManager.playSfx('sfx_slot_win');
                            UI.notify(`Winner! +$${result.payout}`, 'good');
                        } else {
                            UI.setScene('casino_lose');
                            AudioManager.playSfx('sfx_slot_lose');
                            UI.notify(`You lost $${bet}. The house wins.`, 'bad');
                        }

                        gameState.dealsCompleted++;
                        UI.updateHUD();
                        this.afterAction();
                    });
                },
            })).concat([{
                text: 'Walk away',
                next: null,
            }]),
        };

        this.doAction(() => {
            UI.showDialog(dialogId, () => this.afterAction());
        }, true);
    },
};
