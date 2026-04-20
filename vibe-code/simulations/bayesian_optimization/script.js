// Bayesian Optimization Playground - Main JavaScript

class BayesianOptimizer {
    constructor() {
        this.observations = [];
        this.parameters = [];
        this.acquisitionFunction = 'ei'; // expected improvement
    }

    addObservation(params, value) {
        this.observations.push({ params: [...params], value });
    }

    // Simple Gaussian Process approximation
    predict(testParams) {
        if (this.observations.length === 0) {
            return { mean: 0, std: 1 };
        }

        // Simple distance-based prediction
        let weightedSum = 0;
        let totalWeight = 0;
        let variance = 0;

        for (const obs of this.observations) {
            const distance = this.euclideanDistance(testParams, obs.params);
            const weight = Math.exp(-distance * 2); // RBF kernel approximation
            weightedSum += weight * obs.value;
            totalWeight += weight;
        }

        const mean = totalWeight > 0 ? weightedSum / totalWeight : 0;
        
        // Calculate variance based on distance to nearest points
        const minDistance = Math.min(...this.observations.map(obs => 
            this.euclideanDistance(testParams, obs.params)
        ));
        const std = Math.exp(-minDistance) * 2;

        return { mean, std };
    }

    euclideanDistance(a, b) {
        return Math.sqrt(a.reduce((sum, val, i) => sum + Math.pow(val - b[i], 2), 0));
    }

    // Expected Improvement acquisition function
    expectedImprovement(params) {
        const prediction = this.predict(params);
        const bestValue = Math.max(...this.observations.map(obs => obs.value), 0);
        const improvement = prediction.mean - bestValue;
        
        if (prediction.std === 0) return 0;
        
        const z = improvement / prediction.std;
        const phi = this.normalCDF(z);
        const pdf = this.normalPDF(z);
        
        return improvement * phi + prediction.std * pdf;
    }

    normalCDF(x) {
        return 0.5 * (1 + this.erf(x / Math.sqrt(2)));
    }

    normalPDF(x) {
        return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
    }

    erf(x) {
        // Approximation of error function
        const a1 = 0.254829592;
        const a2 = -0.284496736;
        const a3 = 1.421413741;
        const a4 = -1.453152027;
        const a5 = 1.061405429;
        const p = 0.3275911;

        const sign = x < 0 ? -1 : 1;
        x = Math.abs(x);

        const t = 1.0 / (1.0 + p * x);
        const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

        return sign * y;
    }

    suggest(bounds, numSuggestions = 1) {
        if (bounds.length === 0) return [];

        const suggestions = [];
        const numCandidates = 100;

        for (let i = 0; i < numSuggestions; i++) {
            let bestCandidate = null;
            let bestScore = -Infinity;

            for (let j = 0; j < numCandidates; j++) {
                const candidate = bounds.map(bound => 
                    Math.random() * (bound.max - bound.min) + bound.min
                );
                
                const score = this.expectedImprovement(candidate);
                
                if (score > bestScore) {
                    bestScore = score;
                    bestCandidate = candidate;
                }
            }

            suggestions.push(bestCandidate);
        }

        return suggestions;
    }
}

// Classes are now loaded from separate files

// Main Application
class BayesianOptimizationApp {
    constructor() {
        this.coffeeDemo = null;
        this.educationManager = null;
        this.initializeNavigation();
        this.showSection('main-menu');
    }

    initializeNavigation() {
        // No nav buttons to initialize since we're using cards
    }

    showSection(sectionId) {
        // Hide all sections
        document.querySelectorAll('.section').forEach(section => {
            section.classList.remove('active');
        });
        
        // Show back button for non-main sections
        const backBtn = document.getElementById('back-btn');
        if (sectionId === 'main-menu') {
            backBtn.style.display = 'none';
        } else {
            backBtn.style.display = 'block';
        }
        
        // Show selected section
        document.getElementById(sectionId).classList.add('active');
        
        // Initialize section-specific functionality
        if (sectionId === 'coffee-demo' && !this.coffeeDemo) {
            this.coffeeDemo = new CoffeeDemo();
        } else if (sectionId === 'learn' && !this.educationManager) {
            this.educationManager = new BayesianEducationManager();
            window.educationManager = this.educationManager;
            this.educationManager.populateLearnSection();
        }
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Add a subtle fade-in effect for smooth loading
    document.body.style.opacity = '0';
    document.body.style.transition = 'opacity 0.3s ease-in-out';
    
    // Initialize app
    window.app = new BayesianOptimizationApp();
    window.coffeeDemo = window.app.coffeeDemo;
    window.educationManager = window.app.educationManager;
    
    // Smooth fade-in
    requestAnimationFrame(() => {
        document.body.style.opacity = '1';
    });
});