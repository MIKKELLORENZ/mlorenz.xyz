// Educational Content Manager for Bayesian Optimization
class BayesianEducationManager {
    constructor() {
        this.currentTopic = null;
        this.currentStep = 0;
        this.interactiveMode = false;
        this.animationSpeed = 1000;
        this.demoData = {
            observations: [],
            candidatePoints: [],
            selectedPoint: null
        };
        this.charts = {};
        this.initializeContent();
    }

    initializeContent() {
        this.setupInteractiveElements();
        this.setupEventListeners();
        console.log('Bayesian Education Manager initialized');
    }

    setupInteractiveElements() {
        // Initialize interactive components
        this.interactiveDemo = null;
        this.mathRenderer = null;
        this.visualizations = new Map();
    }

    setupEventListeners() {
        // Global keyboard shortcuts for navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight' && this.interactiveMode) {
                this.nextStep();
            } else if (e.key === 'ArrowLeft' && this.interactiveMode) {
                this.previousStep();
            } else if (e.key === 'r' && e.ctrlKey) {
                e.preventDefault();
                this.resetDemo();
            }
        });
    }

    nextStep() {
        this.currentStep++;
        this.updateInteractiveDemo();
    }

    previousStep() {
        if (this.currentStep > 0) {
            this.currentStep--;
            this.updateInteractiveDemo();
        }
    }

    resetDemo() {
        this.currentStep = 0;
        this.demoData = {
            observations: [],
            candidatePoints: [],
            selectedPoint: null
        };
        this.updateInteractiveDemo();
    }

    startInteractiveDemo() {
        this.interactiveMode = true;
        this.resetDemo();
    }

    updateInteractiveDemo() {
        // Update the interactive demo based on current step
        console.log(`Demo step: ${this.currentStep}`);
    }

    // Method to populate the learn section with educational content
    populateLearnSection() {
        const learnContent = document.querySelector('#learn .learn-content');
        if (learnContent) {
            learnContent.innerHTML = `
                <div class="education-container">
                    <!-- Introduction Section -->
                    <div class="intro-section">
                        <h2>🎯 What is Bayesian Optimization?</h2>
                        <div class="intro-content">
                            <p class="intro-paragraph">
                                Imagine you're trying to find the perfect recipe for chocolate chip cookies, but each attempt costs time, ingredients, and energy. 
                                You want to find the optimal combination of temperature, baking time, and ingredient ratios with as few attempts as possible.
                            </p>
                            <p class="intro-paragraph">
                                <strong>Bayesian Optimization</strong> is a powerful mathematical technique that solves exactly this problem. 
                                It intelligently guides the search for optimal solutions when evaluations are expensive, time-consuming, or limited.
                            </p>
                        </div>
                    </div>

                    <!-- What Problems Does It Solve -->
                    <div class="problems-section">
                        <h3>💊 What Problems Does Bayesian Optimization Solve?</h3>
                        <div class="problems-grid">
                            <div class="problem-card">
                                <div class="problem-icon">💊</div>
                                <h4>Drug Discovery</h4>
                                <p>Finding optimal molecular structures when each lab experiment costs $10,000+ and takes weeks</p>
                            </div>
                            <div class="problem-card">
                                <div class="problem-icon">🤖</div>
                                <h4>Machine Learning</h4>
                                <p>Tuning neural network hyperparameters when training takes hours or days</p>
                            </div>
                            <div class="problem-card">
                                <div class="problem-icon">🏭</div>
                                <h4>Manufacturing</h4>
                                <p>Optimizing production parameters when testing disrupts expensive manufacturing processes</p>
                            </div>
                            <div class="problem-card">
                                <div class="problem-icon">🚗</div>
                                <h4>Engineering Design</h4>
                                <p>Finding optimal designs when simulations are computationally expensive</p>
                            </div>
                        </div>
                    </div>

                    <!-- Key Concepts -->
                    <div class="concepts-theory">
                        <h3>🔑 The Three Key Concepts</h3>
                        
                        <div class="concept-detailed">
                            <div class="concept-header">
                                <div class="concept-number">1</div>
                                <h4>Surrogate Model (Gaussian Process)</h4>
                                <button class="try-interactive" onclick="educationManager.openGPDemo()">🔬 Try Interactive Demo</button>
                            </div>
                            <div class="concept-explanation">
                                <p>
                                    Since we can't afford to test every possible combination, we build a <strong>statistical model</strong> 
                                    that learns from our limited observations. This "surrogate model" makes predictions about how good 
                                    any untested combination might be.
                                </p>
                                <p>
                                    <strong>Gaussian Processes</strong> are perfect for this because they don't just predict the expected 
                                    outcome - they also tell us how <em>uncertain</em> they are about that prediction.
                                </p>
                                <div class="concept-analogy">
                                    <strong>💡 Think of it like:</strong> Having a smart friend who remembers every recipe you've tried 
                                    and can guess how good a new recipe might be, while also admitting when they're not sure.
                                </div>
                            </div>
                        </div>

                        <div class="concept-detailed">
                            <div class="concept-header">
                                <div class="concept-number">2</div>
                                <h4>Acquisition Function (Decision Strategy)</h4>
                                <button class="try-interactive" onclick="educationManager.openAcquisitionDemo()">📊 Try Interactive Demo</button>
                            </div>
                            <div class="concept-explanation">
                                <p>
                                    Should we test something we think will be really good (<strong>exploitation</strong>) 
                                    or try something completely unknown that might surprise us (<strong>exploration</strong>)?
                                </p>
                                <p>
                                    The <strong>acquisition function</strong> mathematically balances this tradeoff:
                                </p>
                                <ul>
                                    <li><strong>Expected Improvement:</strong> The balanced optimizer</li>
                                    <li><strong>Upper Confidence Bound:</strong> The optimistic explorer</li>
                                    <li><strong>Probability of Improvement:</strong> The conservative improver</li>
                                </ul>
                            </div>
                        </div>

                        <div class="concept-detailed">
                            <div class="concept-header">
                                <div class="concept-number">3</div>
                                <h4>Sequential Decision Loop</h4>
                                <button class="try-interactive" onclick="educationManager.openSequentialDemo()">🔄 Try Interactive Demo</button>
                            </div>
                            <div class="concept-explanation">
                                <p>
                                    Bayesian Optimization is <strong>sequential</strong> - each new result makes us smarter:
                                </p>
                                <ol>
                                    <li><strong>Predict:</strong> Use our surrogate model to estimate outcomes everywhere</li>
                                    <li><strong>Decide:</strong> Use acquisition function to pick the most promising next test</li>
                                    <li><strong>Evaluate:</strong> Actually run the expensive experiment</li>
                                    <li><strong>Learn:</strong> Update our model with the new data</li>
                                    <li><strong>Repeat:</strong> Get smarter with each iteration</li>
                                </ol>
                            </div>
                        </div>
                    </div>

                    <!-- Why It Works -->
                    <div class="why-section">
                        <h3>⭐ Why Does This Work So Well?</h3>
                        <div class="benefits-grid">
                            <div class="benefit-card">
                                <h4>🎯 Intelligent Sampling</h4>
                                <p>Instead of random guessing, it makes educated decisions about where to look next</p>
                            </div>
                            <div class="benefit-card">
                                <h4>📈 Learning from Every Trial</h4>
                                <p>Each expensive evaluation provides information about the entire space</p>
                            </div>
                            <div class="benefit-card">
                                <h4>⚖️ Balancing Risk vs Reward</h4>
                                <p>Mathematically balances exploitation of known good areas with exploration</p>
                            </div>
                            <div class="benefit-card">
                                <h4>🔢 Quantified Uncertainty</h4>
                                <p>Provides confidence intervals and uncertainty estimates</p>
                            </div>
                        </div>
                    </div>

                    <!-- Real Examples -->
                    <div class="examples-section">
                        <h3>🌟 Real-World Success Stories</h3>
                        <div class="examples-content">
                            <div class="example-story">
                                <h4>🤖 Neural Architecture Search</h4>
                                <p>Automatically design neural network architectures that outperform hand-crafted designs, 
                                requiring 10x fewer computational resources while achieving superior performance.</p>
                            </div>
                            <div class="example-story">
                                <h4>💊 Pharmaceutical Research</h4>
                                <p>Optimize molecular properties with minimal expensive lab experiments, 
                                reducing required synthesis cycles by 90% and saving millions per drug candidate.</p>
                            </div>
                            <div class="example-story">
                                <h4>🏭 Manufacturing at Boeing</h4>
                                <p>Boeing optimizes manufacturing parameters for aircraft components, 
                                finding optimal settings with minimal trials while improving quality and reducing waste.</p>
                            </div>
                        </div>
                    </div>

                    <!-- Get Started -->
                    <div class="get-started-section">
                        <h3>🚀 Ready to Try It?</h3>
                        <p>Head back to the <strong>Coffee Demo</strong> to see Bayesian Optimization in action! 
                        Use the intelligent suggestions to find the perfect espresso in just 30 attempts.</p>
                        <button class="demo-button" onclick="app.showSection('coffee-demo')">
                            ☕ Try the Coffee Demo
                        </button>
                    </div>
                </div>
            `;
        }
    }

    // Interactive demo openers called from concept buttons
    openGPDemo() {
        this.createSimpleModal('gaussian-process', {
            title: '🔬 Gaussian Process Explorer',
            content: `
                <div class="gp-demo">
                    <h4>Understanding Gaussian Processes</h4>
                    <p>A Gaussian Process is like a smart interpolator that not only predicts values between 
                    known points, but also tells us how confident it is in those predictions.</p>
                    
                    <div class="demo-visualization">
                        <div class="demo-placeholder">
                            <p>🎯 <strong>Key Insight:</strong> The wider the uncertainty band, the more we should explore that area!</p>
                            <p>📊 <strong>Mean:</strong> Our best guess of the function value</p>
                            <p>📏 <strong>Uncertainty:</strong> How confident we are in our prediction</p>
                        </div>
                    </div>
                    
                    <p><strong>In the Coffee Demo:</strong> The GP learns from each brew to predict how good 
                    any combination of settings might taste, while also showing where it's most uncertain.</p>
                </div>
            `
        });
    }

    openAcquisitionDemo() {
        this.createSimpleModal('acquisition', {
            title: '📊 Acquisition Functions Lab',
            content: `
                <div class="acquisition-demo">
                    <h4>Balancing Exploration vs Exploitation</h4>
                    <p>Acquisition functions decide where to explore next by combining our predictions with uncertainty.</p>
                    
                    <div class="acquisition-comparison">
                        <div class="acquisition-type">
                            <h5>🎯 Expected Improvement (EI)</h5>
                            <p>Balances promise and uncertainty. Good all-around choice.</p>
                        </div>
                        <div class="acquisition-type">
                            <h5>🔍 Upper Confidence Bound (UCB)</h5>
                            <p>Optimistic strategy. Great for early exploration.</p>
                        </div>
                        <div class="acquisition-type">
                            <h5>🎲 Probability of Improvement (PI)</h5>
                            <p>Conservative approach. Good for final refinement.</p>
                        </div>
                    </div>
                    
                    <p><strong>In the Coffee Demo:</strong> Try different acquisition functions to see how they 
                    affect the suggestions. Notice how UCB is more exploratory while PI is more conservative!</p>
                </div>
            `
        });
    }

    openSequentialDemo() {
        this.createSimpleModal('sequential', {
            title: '🔄 Sequential Learning Demo',
            content: `
                <div class="sequential-demo">
                    <h4>Learning Step by Step</h4>
                    <p>Bayesian Optimization gets smarter with each evaluation, updating its beliefs and strategies.</p>
                    
                    <div class="sequential-steps">
                        <div class="step">
                            <div class="step-number">1</div>
                            <h5>Initial Uncertainty</h5>
                            <p>Start with high uncertainty everywhere</p>
                        </div>
                        <div class="step">
                            <div class="step-number">2</div>
                            <h5>First Evaluations</h5>
                            <p>Gather initial data points</p>
                        </div>
                        <div class="step">
                            <div class="step-number">3</div>
                            <h5>Model Update</h5>
                            <p>Learn patterns and reduce uncertainty</p>
                        </div>
                        <div class="step">
                            <div class="step-number">4</div>
                            <h5>Smart Suggestions</h5>
                            <p>Guide next evaluation intelligently</p>
                        </div>
                        <div class="step">
                            <div class="step-number">5</div>
                            <h5>Converge</h5>
                            <p>Find the optimum efficiently</p>
                        </div>
                    </div>
                    
                    <p><strong>In the Coffee Demo:</strong> Watch how the uncertainty visualization changes 
                    as you brew more coffee. The system becomes more confident in some areas while staying 
                    curious about others!</p>
                </div>
            `
        });
    }

    createSimpleModal(type, config) {
        const modal = document.createElement('div');
        modal.className = 'concept-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>${config.title}</h3>
                    <button class="modal-close" onclick="this.closest('.concept-modal').remove()">×</button>
                </div>
                <div class="modal-body">
                    ${config.content}
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Close on background click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }
}