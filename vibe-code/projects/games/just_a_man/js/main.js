/* ============================================
   JUST A MAN - Main Bootstrap
   Initialization and event binding
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
    // Initialize UI and Audio
    UI.init();
    AudioManager.init();

    // Show title screen
    UI.showTitleScreen();
    AudioManager.playMusic('music_title');

    // === TITLE SCREEN BUTTONS ===
    UI.els.btnNewGame.addEventListener('click', () => {
        Engine.newGame();
    });

    UI.els.btnContinue.addEventListener('click', () => {
        Engine.continueGame();
    });

    // === GAME OVER / WIN BUTTONS ===
    UI.els.btnRestart.addEventListener('click', () => {
        Engine.restart();
    });

    UI.els.btnPlayAgain.addEventListener('click', () => {
        Engine.restart();
    });

    // === HUD BUTTONS ===
    UI.els.btnInventory.addEventListener('click', () => {
        if (!gameState) return;
        if (!UI.els.inventoryOverlay.classList.contains('hidden')) {
            UI.hideInventory();
        } else {
            UI.showInventory();
        }
    });

    UI.els.btnSave.addEventListener('click', () => {
        if (!gameState) return;
        if (saveGame()) {
            UI.notify('Game saved!', 'good');
        } else {
            UI.notify('Save failed!', 'bad');
        }
    });

    UI.els.btnMenu.addEventListener('click', () => {
        if (!gameState) return;
        // Toggle location map as quick menu
        if (!UI.els.locationOverlay.classList.contains('hidden')) {
            UI.hideLocationMap();
        } else {
            UI.showLocationMap();
        }
    });

    // === OVERLAY CLOSE BUTTONS ===
    UI.els.locationCancel.addEventListener('click', () => {
        UI.hideLocationMap();
        if (gameState) UI.showActions(gameState.currentLocation);
    });

    UI.els.shopClose.addEventListener('click', () => {
        UI.hideShop();
        if (gameState) Engine.afterAction();
    });

    UI.els.stockClose.addEventListener('click', () => {
        UI.hideStockTrading();
        if (gameState) Engine.afterAction();
    });

    UI.els.inventoryClose.addEventListener('click', () => {
        UI.hideInventory();
    });

    // === KEYBOARD SHORTCUTS ===
    document.addEventListener('keydown', (e) => {
        if (!gameState) return;

        switch (e.key) {
            case 'i':
            case 'I':
                if (!UI.els.inventoryOverlay.classList.contains('hidden')) {
                    UI.hideInventory();
                } else {
                    UI.showInventory();
                }
                break;
            case 'm':
            case 'M':
                if (!UI.els.locationOverlay.classList.contains('hidden')) {
                    UI.hideLocationMap();
                } else {
                    UI.showLocationMap();
                }
                break;
            case 'Escape':
                // Close any open overlay
                UI.hideShop();
                UI.hideStockTrading();
                UI.hideInventory();
                UI.hideLocationMap();
                break;
        }
    });

    console.log('Just a Man v' + GAME_VERSION + ' loaded.');
});
