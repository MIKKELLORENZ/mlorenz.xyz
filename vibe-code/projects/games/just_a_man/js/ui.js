/* ============================================
   JUST A MAN - UI System
   Rendering HUD, dialogs, overlays, menus
   ============================================ */

const UI = {
    // Cached DOM elements
    els: {},

    init() {
        this.els = {
            sceneLayer: document.getElementById('scene-layer'),
            sceneBg: document.getElementById('scene-bg'),
            scenePlaceholder: document.getElementById('scene-placeholder'),
            hudTop: document.getElementById('hud-top'),
            hudDay: document.getElementById('hud-day'),
            hudTime: document.getElementById('hud-time'),
            hudCash: document.getElementById('hud-cash'),
            hudBottom: document.getElementById('hud-bottom'),
            statRep: document.querySelector('.stat-rep'),
            statCharm: document.querySelector('.stat-charm'),
            statStress: document.querySelector('.stat-stress'),
            statRepVal: document.getElementById('stat-rep-val'),
            statCharmVal: document.getElementById('stat-charm-val'),
            statStressVal: document.getElementById('stat-stress-val'),
            dialogOverlay: document.getElementById('dialog-overlay'),
            dialogBox: document.getElementById('dialog-box'),
            dialogSpeaker: document.getElementById('dialog-speaker'),
            dialogText: document.getElementById('dialog-text'),
            dialogChoices: document.getElementById('dialog-choices'),
            dialogContinue: document.getElementById('dialog-continue'),
            locationOverlay: document.getElementById('location-overlay'),
            locationGrid: document.getElementById('location-grid'),
            locationCancel: document.getElementById('location-cancel'),
            actionOverlay: document.getElementById('action-overlay'),
            actionTitle: document.getElementById('action-title'),
            actionButtons: document.getElementById('action-buttons'),
            shopOverlay: document.getElementById('shop-overlay'),
            shopTitle: document.getElementById('shop-title'),
            shopItems: document.getElementById('shop-items'),
            shopClose: document.getElementById('shop-close'),
            stockOverlay: document.getElementById('stock-overlay'),
            stockTip: document.getElementById('stock-tip'),
            stockList: document.getElementById('stock-list'),
            stockPortfolio: document.getElementById('stock-portfolio'),
            stockClose: document.getElementById('stock-close'),
            inventoryOverlay: document.getElementById('inventory-overlay'),
            inventoryItems: document.getElementById('inventory-items'),
            inventoryClose: document.getElementById('inventory-close'),
            notification: document.getElementById('notification'),
            titleScreen: document.getElementById('title-screen'),
            btnNewGame: document.getElementById('btn-new-game'),
            btnContinue: document.getElementById('btn-continue'),
            gameoverScreen: document.getElementById('gameover-screen'),
            gameoverTitle: document.getElementById('gameover-title'),
            gameoverText: document.getElementById('gameover-text'),
            gameoverStats: document.getElementById('gameover-stats'),
            btnRestart: document.getElementById('btn-restart'),
            winScreen: document.getElementById('win-screen'),
            winText: document.getElementById('win-text'),
            winStats: document.getElementById('win-stats'),
            btnPlayAgain: document.getElementById('btn-play-again'),
            btnInventory: document.getElementById('btn-inventory'),
            btnSave: document.getElementById('btn-save'),
            btnMenu: document.getElementById('btn-menu'),
            loadingOverlay: document.getElementById('loading-overlay'),
            loadingBarFill: document.getElementById('loading-bar-fill'),
            loadingText: document.getElementById('loading-text'),
        };
    },

    // ============================================
    // LOADING BAR (fake, for scene transitions)
    // ============================================

    showLoadingBar(text, duration, onComplete) {
        text = text || 'Loading...';
        duration = duration || 600;
        this.els.loadingOverlay.classList.remove('hidden');
        this.els.loadingText.textContent = text;
        this.els.loadingBarFill.style.transition = 'none';
        this.els.loadingBarFill.style.width = '0%';

        // Animate in steps for a more "real" feel
        const steps = [
            { pct: 15, delay: duration * 0.05 },
            { pct: 35, delay: duration * 0.15 },
            { pct: 50, delay: duration * 0.25 },
            { pct: 72, delay: duration * 0.45 },
            { pct: 88, delay: duration * 0.65 },
            { pct: 95, delay: duration * 0.80 },
            { pct: 100, delay: duration * 0.92 },
        ];

        steps.forEach(step => {
            setTimeout(() => {
                this.els.loadingBarFill.style.transition = 'width 0.12s linear';
                this.els.loadingBarFill.style.width = step.pct + '%';
            }, step.delay);
        });

        setTimeout(() => {
            this.els.loadingOverlay.classList.add('hidden');
            if (onComplete) onComplete();
        }, duration);
    },

    // ============================================
    // HUD UPDATES
    // ============================================

    updateHUD() {
        if (!gameState) return;
        this.els.hudDay.textContent = `Day ${gameState.currentDay}`;
        this.els.hudTime.textContent = TIME_DISPLAY[gameState.timeOfDay].label;
        this.els.hudCash.textContent = `$${gameState.cash.toLocaleString()}`;

        this.els.statRep.style.width = `${gameState.reputation}%`;
        this.els.statCharm.style.width = `${gameState.charm}%`;
        this.els.statStress.style.width = `${gameState.stress}%`;
        this.els.statRepVal.textContent = gameState.reputation;
        this.els.statCharmVal.textContent = gameState.charm;
        this.els.statStressVal.textContent = gameState.stress;

        // Stress warning
        if (gameState.stress > 80) {
            this.els.statStress.classList.add('warning');
        } else {
            this.els.statStress.classList.remove('warning');
        }
    },

    // ============================================
    // SCENE RENDERING
    // ============================================

    setScene(sceneId) {
        const data = getSceneData(sceneId);
        const img = this.els.sceneBg;
        const placeholder = this.els.scenePlaceholder;

        // Try loading image
        const testImg = new Image();
        testImg.onload = () => {
            img.src = data.image;
            img.classList.add('loaded');
            placeholder.style.display = 'none';
        };
        testImg.onerror = () => {
            // Show placeholder with color and label
            img.classList.remove('loaded');
            placeholder.style.display = 'flex';
            placeholder.style.background = data.color;
            placeholder.innerHTML = `<div>${data.label}<br><br><span style="font-size:8px;opacity:0.5">${data.description}</span><br><br><span style="font-size:7px;opacity:0.3">[${sceneId}]</span></div>`;
        };
        testImg.src = data.image;

        // Add transition
        this.els.sceneLayer.classList.remove('scene-fade');
        void this.els.sceneLayer.offsetWidth; // force reflow
        this.els.sceneLayer.classList.add('scene-fade');

        gameState.currentScene = sceneId;

        // Trigger ambient sound for scene
        if (typeof Audio !== 'undefined' && typeof AudioManager !== 'undefined') {
            AudioManager.playAmbientForScene(sceneId);
        }
    },

    // ============================================
    // DIALOG SYSTEM
    // ============================================

    showDialog(dialogId, onComplete) {
        const dialog = getDialog(dialogId);
        if (!dialog) { if (onComplete) onComplete(); return; }

        markDialogSeen(dialogId);
        if (dialog.onEnter) dialog.onEnter();

        // Set scene if specified
        if (dialog.scene) this.setScene(dialog.scene);

        this.els.dialogOverlay.classList.remove('hidden');
        AudioManager.playSfx('sfx_dialog_open');
        this.els.dialogSpeaker.textContent = dialog.speaker || '';
        this.els.dialogText.textContent = dialog.text || '';
        this.els.dialogChoices.innerHTML = '';
        this.els.dialogContinue.classList.add('hidden');

        if (dialog.choices && dialog.choices.length > 0) {
            // Show choices
            dialog.choices.forEach((choice, idx) => {
                // Check condition
                if (choice.condition && !choice.condition()) return;

                const btn = document.createElement('button');
                btn.className = 'dialog-choice';
                btn.textContent = choice.text;

                // Check cash requirement
                if (choice.effects && choice.effects.cash && choice.effects.cash < 0) {
                    if (gameState.cash < Math.abs(choice.effects.cash)) {
                        btn.classList.add('disabled');
                        btn.title = 'Not enough cash';
                    }
                }
                if (choice.requireCash && gameState.cash < choice.requireCash) {
                    btn.classList.add('disabled');
                    btn.title = 'Not enough cash';
                }

                btn.addEventListener('click', () => {
                    if (btn.classList.contains('disabled')) return;

                    // Apply effects
                    if (choice.effects) this.applyEffects(choice.effects);
                    if (choice.setFlags) {
                        Object.entries(choice.setFlags).forEach(([k, v]) => setFlag(k, v));
                    }
                    if (choice.onSelect) choice.onSelect();

                    this.els.dialogOverlay.classList.add('hidden');

                    if (choice.next) {
                        this.showDialog(choice.next, onComplete);
                    } else {
                        if (onComplete) onComplete();
                    }
                });

                this.els.dialogChoices.appendChild(btn);
            });
        } else if (dialog.next) {
            // Click to continue
            this.els.dialogContinue.classList.remove('hidden');
            const handler = () => {
                this.els.dialogContinue.removeEventListener('click', handler);
                this.els.dialogBox.removeEventListener('click', handler);
                this.els.dialogOverlay.classList.add('hidden');
                this.showDialog(dialog.next, onComplete);
            };
            this.els.dialogContinue.addEventListener('click', handler);
            this.els.dialogBox.addEventListener('click', handler);
        } else {
            // End of dialog chain, click to close
            this.els.dialogContinue.textContent = 'Click to close...';
            this.els.dialogContinue.classList.remove('hidden');
            const handler = () => {
                this.els.dialogContinue.removeEventListener('click', handler);
                this.els.dialogBox.removeEventListener('click', handler);
                this.els.dialogContinue.textContent = 'Click to continue...';
                this.els.dialogOverlay.classList.add('hidden');
                if (onComplete) onComplete();
            };
            this.els.dialogContinue.addEventListener('click', handler);
            this.els.dialogBox.addEventListener('click', handler);
        }
    },

    applyEffects(effects) {
        if (effects.cash) modifyCash(effects.cash);
        if (effects.reputation) modifyReputation(effects.reputation);
        if (effects.charm) modifyCharm(effects.charm);
        if (effects.stress) modifyStress(effects.stress);
        if (effects.trust) {
            Object.entries(effects.trust).forEach(([npcId, amount]) => {
                modifyNpcTrust(npcId, amount);
            });
        }
        this.updateHUD();
    },

    // ============================================
    // ACTION MENU
    // ============================================

    showActions(locationId) {
        const loc = LOCATIONS[locationId];
        if (!loc) return;

        const actions = loc.getActions(gameState.timeOfDay);
        this.els.actionTitle.textContent = loc.name;
        this.els.actionButtons.innerHTML = '';

        // Show actions remaining
        const remaining = ACTIONS_PER_PERIOD - gameState.actionsThisPeriod;
        const timeInfo = document.createElement('div');
        timeInfo.className = 'action-info';
        timeInfo.textContent = `${remaining} action${remaining !== 1 ? 's' : ''} remaining`;
        this.els.actionButtons.appendChild(timeInfo);

        actions.forEach((action, idx) => {
            const btn = document.createElement('button');
            btn.className = 'action-btn';
            btn.style.animationDelay = `${0.05 + idx * 0.05}s`;

            let label = action.label;
            if (action.cost) {
                label += ` <span class="action-cost">$${action.cost}</span>`;
            }
            btn.innerHTML = `<strong>${label}</strong><br><span style="font-size:7px;color:#8888aa">${action.desc}</span>`;

            // Disable if can't afford
            if (action.cost && gameState.cash < action.cost) {
                btn.style.opacity = '0.4';
                btn.style.cursor = 'not-allowed';
                btn.addEventListener('click', () => this.notify('Not enough cash.', 'bad'));
            } else {
                btn.addEventListener('click', () => {
                    this.hideActions();
                    Engine.handleAction(action);
                });
            }

            this.els.actionButtons.appendChild(btn);
        });

        this.els.actionOverlay.classList.remove('hidden');
    },

    hideActions() {
        this.els.actionOverlay.classList.add('hidden');
    },

    // ============================================
    // LOCATION MAP
    // ============================================

    showLocationMap() {
        const locations = getAllLocationsForMap(gameState.timeOfDay);
        this.els.locationGrid.innerHTML = '';

        locations.forEach(loc => {
            const btn = document.createElement('button');
            btn.className = 'location-btn';
            if (loc.locked) btn.classList.add('locked');
            if (loc.current) btn.classList.add('current');
            if (!loc.available && !loc.locked) btn.classList.add('locked');

            btn.innerHTML = `<span class="loc-name">${loc.name}</span><span class="loc-desc">${loc.description}</span>`;

            if (loc.available && !loc.current) {
                btn.addEventListener('click', () => {
                    this.hideLocationMap();
                    Engine.travelTo(loc.id);
                });
            } else if (loc.current) {
                btn.addEventListener('click', () => {
                    this.hideLocationMap();
                    this.showActions(loc.id);
                });
            }

            this.els.locationGrid.appendChild(btn);
        });

        this.els.locationOverlay.classList.remove('hidden');
    },

    hideLocationMap() {
        this.els.locationOverlay.classList.add('hidden');
    },

    // ============================================
    // SHOP (Pawn/Mall)
    // ============================================

    showShop(title, items, mode, onPurchase) {
        this.els.shopTitle.textContent = title;
        this.els.shopItems.innerHTML = '';

        if (items.length === 0) {
            this.els.shopItems.innerHTML = '<div style="text-align:center;color:#8888aa;font-size:9px;padding:20px;">Nothing available right now.</div>';
        }

        items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'shop-item';

            const price = mode === 'buy' ? (item.sellPrice || item.buyPrice || item.price) : (item.buyPrice || getVinnieBuyPrice(item));
            const btnLabel = mode === 'buy' ? 'BUY' : 'SELL';

            div.innerHTML = `
                <span class="shop-item-name">${item.name}</span>
                <span class="shop-item-price">$${price}</span>
            `;

            const btn = document.createElement('button');
            btn.className = 'shop-item-btn';
            btn.textContent = btnLabel;

            if (mode === 'buy' && gameState.cash < price) {
                btn.classList.add('disabled');
            }

            btn.addEventListener('click', () => {
                if (btn.classList.contains('disabled')) return;
                onPurchase(item, price);
                // Refresh shop
                this.hideShop();
            });

            div.appendChild(btn);
            this.els.shopItems.appendChild(div);
        });

        this.els.shopOverlay.classList.remove('hidden');
    },

    hideShop() {
        this.els.shopOverlay.classList.add('hidden');
    },

    // ============================================
    // STOCK TRADING
    // ============================================

    showStockTrading() {
        this.els.stockList.innerHTML = '';

        // Header
        const header = document.createElement('div');
        header.className = 'stock-row header';
        header.innerHTML = `
            <span class="stock-ticker">TICK</span>
            <span class="stock-name">COMPANY</span>
            <span class="stock-price">PRICE</span>
            <span class="stock-change">CHG</span>
            <span class="stock-held">HELD</span>
            <span class="stock-actions"></span>
        `;
        this.els.stockList.appendChild(header);

        STOCKS.forEach(stock => {
            const price = gameState.stockPrices[stock.ticker] || stock.basePrice;
            const history = gameState.stockHistory[stock.ticker] || [price];
            const prevPrice = history.length > 1 ? history[history.length - 2] : price;
            const change = ((price - prevPrice) / prevPrice * 100).toFixed(1);
            const held = gameState.stockPortfolio.filter(h => h.ticker === stock.ticker)
                .reduce((sum, h) => sum + h.shares, 0);

            const row = document.createElement('div');
            row.className = 'stock-row';
            row.innerHTML = `
                <span class="stock-ticker">${stock.ticker}</span>
                <span class="stock-name">${stock.name}</span>
                <span class="stock-price">$${price.toFixed(2)}</span>
                <span class="stock-change ${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '+' : ''}${change}%</span>
                <span class="stock-held">${held}</span>
                <span class="stock-actions">
                    <button class="stock-btn buy" data-ticker="${stock.ticker}">BUY</button>
                    ${held > 0 ? `<button class="stock-btn sell" data-ticker="${stock.ticker}">SELL</button>` : ''}
                </span>
            `;
            this.els.stockList.appendChild(row);
        });

        // Portfolio value
        const portfolioVal = getPortfolioValue();
        this.els.stockPortfolio.textContent = `Portfolio Value: $${portfolioVal.toFixed(2)} | Cash: $${gameState.cash.toLocaleString()}`;

        // Marcus tip
        if (gameState.npcs.marcus.met && gameState.npcs.marcus.trust >= 20) {
            const tip = getMarcusTip();
            const dirWord = tip.direction === 'up' ? 'going UP' : 'going DOWN';
            this.els.stockTip.textContent = `Marcus whispers: "${tip.ticker} is ${dirWord}..."`;
            this.els.stockTip.classList.remove('hidden');
        } else {
            this.els.stockTip.classList.add('hidden');
        }

        // Event listeners
        this.els.stockList.querySelectorAll('.stock-btn.buy').forEach(btn => {
            btn.addEventListener('click', () => Engine.buyStock(btn.dataset.ticker));
        });
        this.els.stockList.querySelectorAll('.stock-btn.sell').forEach(btn => {
            btn.addEventListener('click', () => Engine.sellStock(btn.dataset.ticker));
        });

        this.els.stockOverlay.classList.remove('hidden');
    },

    hideStockTrading() {
        this.els.stockOverlay.classList.add('hidden');
    },

    // ============================================
    // INVENTORY
    // ============================================

    showInventory() {
        this.els.inventoryItems.innerHTML = '';

        if (gameState.inventory.length === 0) {
            this.els.inventoryItems.innerHTML = '<div style="text-align:center;color:#8888aa;font-size:9px;padding:20px;">Your pockets are empty.</div>';
        }

        gameState.inventory.forEach(item => {
            const div = document.createElement('div');
            div.className = 'inv-item';
            div.innerHTML = `
                <span class="inv-item-name">${item.name}</span>
                <span class="inv-item-value">~$${item.baseValue || '?'}</span>
            `;
            this.els.inventoryItems.appendChild(div);
        });

        // Show car
        if (gameState.carOwned) {
            const car = CARS.find(c => c.id === gameState.carOwned);
            if (car) {
                const div = document.createElement('div');
                div.className = 'inv-item';
                div.style.borderColor = 'var(--text-gold)';
                div.innerHTML = `<span class="inv-item-name">${car.name}</span><span class="inv-item-value">YOUR CAR</span>`;
                this.els.inventoryItems.appendChild(div);
            }
        }

        // Show properties
        gameState.propertiesOwned.forEach(pid => {
            const prop = PROPERTIES.find(p => p.id === pid);
            if (prop) {
                const div = document.createElement('div');
                div.className = 'inv-item';
                div.style.borderColor = 'var(--success)';
                div.innerHTML = `<span class="inv-item-name">${prop.name}</span><span class="inv-item-value">$${prop.passiveIncome}/day</span>`;
                this.els.inventoryItems.appendChild(div);
            }
        });

        this.els.inventoryOverlay.classList.remove('hidden');
    },

    hideInventory() {
        this.els.inventoryOverlay.classList.add('hidden');
    },

    // ============================================
    // NOTIFICATIONS
    // ============================================

    notify(text, kind) {
        kind = kind || 'info';
        if (kind === 'good') AudioManager.playSfx('sfx_notify_good');
        else if (kind === 'bad') AudioManager.playSfx('sfx_notify_bad');
        const el = this.els.notification;
        el.textContent = text;
        el.className = kind;
        // Reset animation
        el.classList.remove('hidden');
        el.style.animation = 'none';
        void el.offsetWidth;
        el.style.animation = '';
        setTimeout(() => el.classList.add('hidden'), 3000);
    },

    // ============================================
    // TITLE SCREEN
    // ============================================

    showTitleScreen() {
        this.els.titleScreen.classList.remove('hidden');
        this.els.hudTop.classList.add('hidden');
        this.els.hudBottom.classList.add('hidden');

        if (hasSavedGame()) {
            this.els.btnContinue.classList.remove('hidden');
        }
    },

    hideTitleScreen() {
        this.els.titleScreen.classList.add('hidden');
        this.els.hudTop.classList.remove('hidden');
        this.els.hudBottom.classList.remove('hidden');
    },

    // ============================================
    // GAME OVER
    // ============================================

    showGameOver(type) {
        const stats = getGameStats();
        this.els.hudTop.classList.add('hidden');
        this.els.hudBottom.classList.add('hidden');

        if (type === 'bankrupt') {
            this.els.gameoverTitle.textContent = 'GAME OVER';
            this.els.gameoverText.textContent = 'You went bankrupt. The city chews people up and spits them out.';
        } else {
            this.els.gameoverTitle.textContent = 'BURNOUT';
            this.els.gameoverText.textContent = 'The stress was too much. Sometimes the hustle wins.';
        }

        this.els.gameoverStats.innerHTML = `
            Days survived: ${stats.daysPlayed}<br>
            Total earned: $${stats.totalEarned.toLocaleString()}<br>
            Properties owned: ${stats.propertiesOwned}<br>
            Deals completed: ${stats.dealsCompleted}<br>
            Cherry Cokes drunk: ${stats.cherryCokesDrunk}
        `;
        this.els.gameoverScreen.classList.remove('hidden');
    },

    showWinScreen() {
        const stats = getGameStats();
        this.els.hudTop.classList.add('hidden');
        this.els.hudBottom.classList.add('hidden');

        this.els.winText.textContent = 'You\'re just a man. But what a man you turned out to be.';
        this.els.winStats.innerHTML = `
            Days played: ${stats.daysPlayed}<br>
            Final cash: $${stats.finalCash.toLocaleString()}<br>
            Properties owned: ${stats.propertiesOwned}<br>
            Diana\'s trust: ${stats.dianaTrust}<br>
            Deals completed: ${stats.dealsCompleted}<br>
            NPCs befriended: ${stats.npcsMet}<br>
            Cherry Cokes drunk: ${stats.cherryCokesDrunk}
        `;
        this.els.winScreen.classList.remove('hidden');
    },

    hideEndScreens() {
        this.els.gameoverScreen.classList.add('hidden');
        this.els.winScreen.classList.add('hidden');
        this.els.hudTop.classList.remove('hidden');
        this.els.hudBottom.classList.remove('hidden');
    },
};
