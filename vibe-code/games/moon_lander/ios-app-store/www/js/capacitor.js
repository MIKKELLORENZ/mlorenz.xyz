// Capacitor Core Runtime - This file will be replaced by Capacitor build
// Placeholder for development/testing without Capacitor

window.Capacitor = window.Capacitor || {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
    Plugins: {}
};

// Mock implementations for web development
const Haptics = {
    impact: async ({ style }) => {
        console.log('Haptic feedback:', style);
        // Web doesn't support haptics, but we can use vibration API as fallback
        if (navigator.vibrate) {
            navigator.vibrate(style === 'heavy' ? 50 : style === 'medium' ? 30 : 10);
        }
    }
};

const ImpactStyle = {
    Heavy: 'heavy',
    Medium: 'medium',
    Light: 'light'
};

const Preferences = {
    get: async ({ key }) => {
        return { value: localStorage.getItem(key) };
    },
    set: async ({ key, value }) => {
        localStorage.setItem(key, value);
    }
};

const App = {
    addListener: (event, callback) => {
        if (event === 'appStateChange') {
            document.addEventListener('visibilitychange', () => {
                callback({ isActive: !document.hidden });
            });
        }
    }
};

const StatusBar = {
    setStyle: async () => {},
    setBackgroundColor: async () => {}
};

const Style = {
    Dark: 'DARK',
    Light: 'LIGHT'
};

const SplashScreen = {
    hide: async () => {}
};

// Export for ES modules (when bundling)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        Haptics,
        ImpactStyle,
        Preferences,
        App,
        StatusBar,
        Style,
        SplashScreen
    };
}

// Make available globally for non-module scripts
window.CapacitorPlugins = {
    Haptics,
    ImpactStyle,
    Preferences,
    App,
    StatusBar,
    Style,
    SplashScreen
};
