/**
 * Custom Problem Manager for Bayesian Optimization
 * A modular, elegant solution for creating and managing optimization problems
 */

// Core data models and validation
class ProjectModel {
    constructor(data = {}) {
        this.name = data.name || '';
        this.objective = data.objective || '';
        this.direction = data.direction || 'maximize';
        this.parameters = data.parameters || [];
        this.data = data.data || [];
        this.createdAt = data.createdAt || new Date().toISOString();
        this.updatedAt = new Date().toISOString();
    }

    validate() {
        const errors = [];
        
        if (!this.name?.trim()) {
            errors.push('Project name is required');
        }
        
        if (!this.objective?.trim()) {
            errors.push('Objective description is required');
        }
        
        if (!['maximize', 'minimize'].includes(this.direction)) {
            errors.push('Optimization direction must be maximize or minimize');
        }
        
        if (this.parameters.length === 0) {
            errors.push('At least one parameter is required');
        }
        
        // Validate parameters
        this.parameters.forEach((param, index) => {
            if (!param.name?.trim()) {
                errors.push(`Parameter ${index + 1} name is required`);
            }
            
            if (param.type === 'numerical') {
                if (param.min >= param.max) {
                    errors.push(`Parameter "${param.name}" min value must be less than max value`);
                }
            } else if (param.type === 'categorical') {
                if (!param.categories || param.categories.length < 2) {
                    errors.push(`Parameter "${param.name}" must have at least 2 categories`);
                }
            }
        });
        
        return errors;
    }

    clone() {
        return new ProjectModel(JSON.parse(JSON.stringify(this)));
    }
}

class ParameterModel {
    constructor(data = {}) {
        this.id = data.id || this.generateId();
        this.name = data.name || '';
        this.type = data.type || 'numerical';
        this.min = data.min ?? 0;
        this.max = data.max ?? 100;
        this.categories = data.categories || [];
    }

    generateId() {
        return `param_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    validate() {
        const errors = [];
        
        if (!this.name?.trim()) {
            errors.push('Parameter name is required');
        }
        
        if (this.type === 'numerical' && this.min >= this.max) {
            errors.push('Min value must be less than max value');
        }
        
        if (this.type === 'categorical' && this.categories.length < 2) {
            errors.push('Categorical parameters need at least 2 categories');
        }
        
        return errors;
    }
}

// Storage management
class ProjectStorage {
    constructor(storageKey = 'bayesian_optimization_projects') {
        this.storageKey = storageKey;
    }

    loadProjects() {
        try {
            const data = localStorage.getItem(this.storageKey);
            const projects = data ? JSON.parse(data) : {};
            
            // Convert to ProjectModel instances
            return Object.keys(projects).reduce((acc, key) => {
                acc[key] = new ProjectModel(projects[key]);
                return acc;
            }, {});
        } catch (error) {
            console.error('Failed to load projects:', error);
            return {};
        }
    }

    saveProjects(projects) {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(projects));
            return true;
        } catch (error) {
            console.error('Failed to save projects:', error);
            return false;
        }
    }

    deleteProject(projectName, projects) {
        const updated = { ...projects };
        delete updated[projectName];
        return this.saveProjects(updated) ? updated : projects;
    }
}

// UI Components
class UIComponents {
    static createFormGroup(label, input) {
        const group = document.createElement('div');
        group.className = 'form-group';
        
        const labelEl = document.createElement('label');
        labelEl.textContent = label;
        
        group.appendChild(labelEl);
        group.appendChild(input);
        
        return group;
    }

    static createButton(text, onClick, className = '') {
        const button = document.createElement('button');
        button.textContent = text;
        button.className = className;
        button.addEventListener('click', onClick);
        return button;
    }

    static createSelect(options, value = '') {
        const select = document.createElement('select');
        
        options.forEach(option => {
            const optionEl = document.createElement('option');
            optionEl.value = option.value;
            optionEl.textContent = option.text;
            optionEl.selected = option.value === value;
            select.appendChild(optionEl);
        });
        
        return select;
    }

    static createInput(type, attributes = {}) {
        const input = document.createElement('input');
        input.type = type;
        
        Object.keys(attributes).forEach(key => {
            input.setAttribute(key, attributes[key]);
        });
        
        return input;
    }

    static showNotification(message, type = 'info') {
        // Simple notification system
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
}

// Parameter management
class ParameterManager {
    constructor(container, onChange) {
        this.container = container;
        this.onChange = onChange || (() => {});
        this.parameters = [];
    }

    setParameters(parameters) {
        this.parameters = parameters.map(p => new ParameterModel(p));
        this.render();
    }

    addParameter() {
        const param = new ParameterModel();
        this.parameters.push(param);
        this.render();
        this.onChange(this.parameters);
    }

    removeParameter(index) {
        if (index >= 0 && index < this.parameters.length) {
            this.parameters.splice(index, 1);
            this.render();
            this.onChange(this.parameters);
        }
    }

    updateParameter(index, field, value) {
        if (index >= 0 && index < this.parameters.length) {
            this.parameters[index][field] = value;
            this.render();
            this.onChange(this.parameters);
        }
    }

    render() {
        this.container.innerHTML = '';
        
        this.parameters.forEach((param, index) => {
            const paramDiv = this.createParameterElement(param, index);
            this.container.appendChild(paramDiv);
        });
    }

    createParameterElement(param, index) {
        const div = document.createElement('div');
        div.className = 'parameter-item';
        
        const controls = document.createElement('div');
        controls.className = 'parameter-controls';
        
        // Name input
        const nameInput = UIComponents.createInput('text', {
            placeholder: 'Parameter Name',
            value: param.name
        });
        nameInput.addEventListener('change', (e) => {
            this.updateParameter(index, 'name', e.target.value);
        });
        
        // Type select
        const typeSelect = UIComponents.createSelect([
            { value: 'numerical', text: 'Numerical' },
            { value: 'categorical', text: 'Categorical' }
        ], param.type);
        typeSelect.addEventListener('change', (e) => {
            this.updateParameter(index, 'type', e.target.value);
        });
        
        controls.appendChild(nameInput);
        controls.appendChild(typeSelect);
        
        // Type-specific controls
        if (param.type === 'numerical') {
            const minInput = UIComponents.createInput('number', {
                placeholder: 'Min',
                value: param.min,
                step: '0.1'
            });
            const maxInput = UIComponents.createInput('number', {
                placeholder: 'Max',
                value: param.max,
                step: '0.1'
            });
            
            minInput.addEventListener('change', (e) => {
                const value = parseFloat(e.target.value);
                if (!isNaN(value)) {
                    this.updateParameter(index, 'min', value);
                }
            });
            maxInput.addEventListener('change', (e) => {
                const value = parseFloat(e.target.value);
                if (!isNaN(value)) {
                    this.updateParameter(index, 'max', value);
                }
            });
            
            controls.appendChild(minInput);
            controls.appendChild(maxInput);
        } else {
            const categoriesInput = UIComponents.createInput('text', {
                placeholder: 'Categories (comma-separated)',
                value: param.categories.join(', ')
            });
            
            categoriesInput.addEventListener('change', (e) => {
                const categories = e.target.value.split(',')
                    .map(s => s.trim())
                    .filter(s => s.length > 0);
                this.updateParameter(index, 'categories', categories);
            });
            
            controls.appendChild(categoriesInput);
        }
        
        // Remove button
        const removeBtn = UIComponents.createButton('Remove', () => {
            this.removeParameter(index);
        });
        controls.appendChild(removeBtn);
        
        div.appendChild(controls);
        return div;
    }

    getParameters() {
        return this.parameters;
    }
}

// Data visualization
class DataVisualizer {
    constructor(container) {
        this.container = container;
    }

    renderTimeSeries(data, objective) {
        if (!data || data.length === 0) {
            this.container.innerHTML = '<p class="no-data">No data to visualize</p>';
            return;
        }

        const maxValue = Math.max(...data.map(d => Math.abs(d.objective)));
        const minValue = Math.min(...data.map(d => d.objective));
        const range = maxValue - minValue || 1;

        this.container.innerHTML = `
            <div class="visualization-container">
                <h4>Objective Values Over Time</h4>
                <div class="chart-container">
                    <div class="chart-bars">
                        ${data.map((point, index) => {
                            const height = Math.max(10, (Math.abs(point.objective) / maxValue) * 150);
                            const color = point.objective >= 0 ? '#4CAF50' : '#f44336';
                            
                            return `
                                <div class="chart-bar" style="height: ${height}px; background-color: ${color};">
                                    <div class="bar-label">${point.objective.toFixed(2)}</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                    <div class="chart-labels">
                        ${data.map((_, index) => `<span>Trial ${index + 1}</span>`).join('')}
                    </div>
                </div>
                <div class="chart-stats">
                    <div class="stat">
                        <strong>Best:</strong> ${objective === 'maximize' ? Math.max(...data.map(d => d.objective)) : Math.min(...data.map(d => d.objective))}
                    </div>
                    <div class="stat">
                        <strong>Trials:</strong> ${data.length}
                    </div>
                    <div class="stat">
                        <strong>Average:</strong> ${(data.reduce((sum, d) => sum + d.objective, 0) / data.length).toFixed(2)}
                    </div>
                </div>
            </div>
        `;
    }
}

// Main controller
class CustomProblemManager {
    constructor() {
        this.storage = new ProjectStorage();
        this.projects = this.storage.loadProjects();
        this.currentProject = null;
        this.optimizer = new BayesianOptimizer();
        
        this.initializeElements();
        this.setupComponents();
        this.bindEvents();
        this.updateProjectList();
    }

    initializeElements() {
        this.elements = {
            projectList: document.getElementById('project-list'),
            projectName: document.getElementById('project-name'),
            objectiveName: document.getElementById('objective-name'),
            optimizationDirection: document.getElementById('optimization-direction'),
            parametersList: document.getElementById('parameters-list'),
            entryForm: document.getElementById('entry-form'),
            optimizationResults: document.getElementById('optimization-results'),
            dataVisualization: document.getElementById('data-visualization'),
            projectSetup: document.getElementById('project-setup'),
            dataEntry: document.getElementById('data-entry'),
            resultsDisplay: document.getElementById('results-display')
        };
    }

    setupComponents() {
        this.parameterManager = new ParameterManager(
            this.elements.parametersList,
            (parameters) => {
                if (this.currentProject) {
                    this.currentProject.parameters = parameters;
                    this.updateEntryForm();
                }
            }
        );
        
        this.visualizer = new DataVisualizer(this.elements.dataVisualization);
    }

    bindEvents() {
        const events = [
            ['new-project-btn', 'click', () => this.newProject()],
            ['load-project-btn', 'click', () => this.loadProject()],
            ['delete-project-btn', 'click', () => this.deleteProject()],
            ['save-project', 'click', () => this.saveProject()],
            ['add-parameter', 'click', () => this.parameterManager.addParameter()],
            ['add-data-point', 'click', () => this.addDataPoint()],
            ['get-optimization-suggestion', 'click', () => this.getOptimizationSuggestion()]
        ];

        events.forEach(([id, event, handler]) => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener(event, handler);
            }
        });
    }

    updateProjectList() {
        this.elements.projectList.innerHTML = '<option value="">Create New Project</option>';
        
        Object.keys(this.projects)
            .sort()
            .forEach(name => {
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                this.elements.projectList.appendChild(option);
            });
    }

    newProject() {
        this.currentProject = new ProjectModel();
        this.resetForm();
        this.showSection('setup');
    }

    loadProject() {
        const projectName = this.elements.projectList.value;
        if (!projectName || !this.projects[projectName]) {
            UIComponents.showNotification('Please select a valid project', 'warning');
            return;
        }

        this.currentProject = this.projects[projectName].clone();
        this.populateForm();
        this.showSection('all');
        this.loadDataIntoOptimizer();
        this.updateResults();
    }

    deleteProject() {
        const projectName = this.elements.projectList.value;
        if (!projectName) {
            UIComponents.showNotification('Please select a project to delete', 'warning');
            return;
        }

        if (confirm(`Are you sure you want to delete "${projectName}"?`)) {
            this.projects = this.storage.deleteProject(projectName, this.projects);
            this.updateProjectList();
            this.newProject();
            UIComponents.showNotification('Project deleted successfully', 'success');
        }
    }

    saveProject() {
        if (!this.currentProject) return;

        this.currentProject.name = this.elements.projectName.value;
        this.currentProject.objective = this.elements.objectiveName.value;
        this.currentProject.direction = this.elements.optimizationDirection.value;

        const errors = this.currentProject.validate();
        if (errors.length > 0) {
            UIComponents.showNotification(`Validation errors: ${errors.join(', ')}`, 'error');
            return;
        }

        this.projects[this.currentProject.name] = this.currentProject;
        
        if (this.storage.saveProjects(this.projects)) {
            this.updateProjectList();
            this.elements.projectList.value = this.currentProject.name;
            this.showSection('all');
            UIComponents.showNotification('Project saved successfully', 'success');
        } else {
            UIComponents.showNotification('Failed to save project', 'error');
        }
    }

    resetForm() {
        this.elements.projectName.value = '';
        this.elements.objectiveName.value = '';
        this.elements.optimizationDirection.value = 'maximize';
        this.parameterManager.setParameters([]);
        this.elements.entryForm.innerHTML = '';
        this.elements.optimizationResults.innerHTML = '';
        this.elements.dataVisualization.innerHTML = '';
    }

    populateForm() {
        this.elements.projectName.value = this.currentProject.name;
        this.elements.objectiveName.value = this.currentProject.objective;
        this.elements.optimizationDirection.value = this.currentProject.direction;
        this.parameterManager.setParameters(this.currentProject.parameters);
        this.updateEntryForm();
    }

    showSection(section) {
        const sections = {
            setup: () => {
                this.elements.projectSetup.style.display = 'block';
                this.elements.dataEntry.style.display = 'none';
            },
            all: () => {
                this.elements.projectSetup.style.display = 'block';
                this.elements.dataEntry.style.display = 'block';
            }
        };

        if (sections[section]) {
            sections[section]();
        }
    }

    updateEntryForm() {
        if (!this.currentProject) return;

        this.elements.entryForm.innerHTML = '';

        // Create parameter inputs
        this.currentProject.parameters.forEach((param, index) => {
            let input;

            if (param.type === 'numerical') {
                input = UIComponents.createInput('number', {
                    id: `param-${index}`,
                    min: param.min,
                    max: param.max,
                    step: '0.1',
                    placeholder: `Enter ${param.name}`
                });
            } else {
                input = UIComponents.createSelect(
                    param.categories.map(cat => ({ value: cat, text: cat })),
                    ''
                );
                input.id = `param-${index}`;
            }

            const formGroup = UIComponents.createFormGroup(`${param.name}:`, input);
            this.elements.entryForm.appendChild(formGroup);
        });

        // Add objective input
        if (this.currentProject.objective) {
            const objectiveInput = UIComponents.createInput('number', {
                id: 'objective-value',
                step: '0.01',
                placeholder: `Enter ${this.currentProject.objective} value`
            });

            const objectiveGroup = UIComponents.createFormGroup(
                `${this.currentProject.objective}:`,
                objectiveInput
            );
            this.elements.entryForm.appendChild(objectiveGroup);
        }
    }

    addDataPoint() {
        if (!this.currentProject) {
            UIComponents.showNotification('Please create or load a project first', 'warning');
            return;
        }

        if (this.currentProject.parameters.length === 0) {
            UIComponents.showNotification('Please add at least one parameter to your project', 'warning');
            return;
        }

        try {
            const paramValues = this.currentProject.parameters.map((param, index) => {
                const input = document.getElementById(`param-${index}`);
                if (!input) {
                    throw new Error(`Input field for ${param.name} not found`);
                }
                
                const value = input.value?.trim();
                if (!value) {
                    throw new Error(`Please enter a value for ${param.name}`);
                }

                if (param.type === 'numerical') {
                    const numValue = parseFloat(value);
                    if (isNaN(numValue)) {
                        throw new Error(`${param.name} must be a valid number`);
                    }
                    if (numValue < param.min || numValue > param.max) {
                        throw new Error(`${param.name} must be between ${param.min} and ${param.max}`);
                    }
                    return numValue;
                } else {
                    if (!param.categories.includes(value)) {
                        throw new Error(`${param.name} must be one of: ${param.categories.join(', ')}`);
                    }
                    return value;
                }
            });

            const objectiveInput = document.getElementById('objective-value');
            if (!objectiveInput) {
                throw new Error('Objective value input not found');
            }

            const objectiveValueStr = objectiveInput.value?.trim();
            if (!objectiveValueStr) {
                throw new Error('Please enter an objective value');
            }

            const objectiveValue = parseFloat(objectiveValueStr);
            if (isNaN(objectiveValue)) {
                throw new Error('Objective value must be a valid number');
            }

            const dataPoint = {
                params: paramValues,
                objective: objectiveValue,
                timestamp: new Date().toISOString()
            };

            this.currentProject.data.push(dataPoint);
            this.currentProject.updatedAt = new Date().toISOString();
            
            this.projects[this.currentProject.name] = this.currentProject;
            
            if (this.storage.saveProjects(this.projects)) {
                this.clearForm();
                this.loadDataIntoOptimizer();
                this.updateResults();
                UIComponents.showNotification('Data point added successfully', 'success');
            } else {
                // Remove the data point if saving failed
                this.currentProject.data.pop();
                throw new Error('Failed to save data point');
            }

        } catch (error) {
            UIComponents.showNotification(error.message, 'error');
        }
    }

    clearForm() {
        this.currentProject.parameters.forEach((_, index) => {
            const input = document.getElementById(`param-${index}`);
            if (input) input.value = '';
        });

        const objectiveInput = document.getElementById('objective-value');
        if (objectiveInput) objectiveInput.value = '';
    }

    loadDataIntoOptimizer() {
        if (!this.currentProject || this.currentProject.data.length === 0) return;

        this.optimizer = new BayesianOptimizer();
        
        this.currentProject.data.forEach(point => {
            const numericParams = point.params.map((param, index) => {
                if (this.currentProject.parameters[index].type === 'categorical') {
                    return this.currentProject.parameters[index].categories.indexOf(param);
                }
                return param;
            });

            const objective = this.currentProject.direction === 'maximize' 
                ? point.objective 
                : -point.objective;

            this.optimizer.addObservation(numericParams, objective);
        });
    }

    getOptimizationSuggestion() {
        if (!this.currentProject || this.currentProject.data.length === 0) {
            UIComponents.showNotification('Add some data points first', 'warning');
            return;
        }

        try {
            const bounds = this.currentProject.parameters.map(param => {
                if (param.type === 'numerical') {
                    return { min: param.min, max: param.max };
                } else {
                    return { min: 0, max: param.categories.length - 1 };
                }
            });

            const suggestions = this.optimizer.suggest(bounds, 1);
            
            if (suggestions.length > 0) {
                this.displaySuggestion(suggestions[0]);
            }
        } catch (error) {
            UIComponents.showNotification('Failed to generate suggestion', 'error');
            console.error(error);
        }
    }

    displaySuggestion(suggestion) {
        const suggestionHtml = `
            <div class="suggestion-card">
                <h4>🎯 Recommended Next Experiment</h4>
                <div class="suggestion-params">
                    ${suggestion.map((value, index) => {
                        const param = this.currentProject.parameters[index];
                        let displayValue;
                        
                        if (param.type === 'numerical') {
                            displayValue = value.toFixed(2);
                        } else {
                            const categoryIndex = Math.round(Math.max(0, Math.min(param.categories.length - 1, value)));
                            displayValue = param.categories[categoryIndex];
                        }
                        
                        return `
                            <div class="suggestion-param">
                                <span class="param-name">${param.name}:</span>
                                <span class="param-value">${displayValue}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
                <p class="suggestion-note">
                    This recommendation balances exploration of uncertain regions with exploitation of promising areas.
                </p>
            </div>
        `;

        this.elements.optimizationResults.innerHTML = suggestionHtml;
    }

    updateResults() {
        if (!this.currentProject || this.currentProject.data.length === 0) {
            this.elements.optimizationResults.innerHTML = '<p class="no-data">No results yet. Add some data points to see optimization results.</p>';
            this.visualizer.renderTimeSeries([], '');
            return;
        }

        const bestPoint = this.findBestPoint();
        this.displayBestResult(bestPoint);
        this.visualizer.renderTimeSeries(this.currentProject.data, this.currentProject.direction);
    }

    findBestPoint() {
        return this.currentProject.data.reduce((best, current) => {
            const bestValue = this.currentProject.direction === 'maximize' 
                ? best.objective 
                : -best.objective;
            const currentValue = this.currentProject.direction === 'maximize' 
                ? current.objective 
                : -current.objective;
            
            return currentValue > bestValue ? current : best;
        });
    }

    displayBestResult(bestPoint) {
        const resultsHtml = `
            <div class="results-card">
                <h4>🏆 Best Result So Far</h4>
                <div class="best-objective">
                    <strong>${this.currentProject.objective}:</strong> 
                    <span class="objective-value">${bestPoint.objective}</span>
                </div>
                
                <div class="best-parameters">
                    <strong>Parameters:</strong>
                    <ul class="param-list">
                        ${bestPoint.params.map((param, index) => `
                            <li>
                                <span class="param-name">${this.currentProject.parameters[index].name}:</span>
                                <span class="param-value">${param}</span>
                            </li>
                        `).join('')}
                    </ul>
                </div>
                
                <div class="result-stats">
                    <div class="stat">
                        <span class="stat-label">Total Experiments:</span>
                        <span class="stat-value">${this.currentProject.data.length}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Date Achieved:</span>
                        <span class="stat-value">${new Date(bestPoint.timestamp).toLocaleDateString()}</span>
                    </div>
                </div>
            </div>
        `;

        this.elements.optimizationResults.innerHTML = resultsHtml;
    }
}

// Initialize the application when DOM is loaded
let customProblemManager;
document.addEventListener('DOMContentLoaded', () => {
    customProblemManager = new CustomProblemManager();
});