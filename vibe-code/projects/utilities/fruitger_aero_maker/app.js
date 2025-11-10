class FrutigerAeroBeatMaker {
    constructor() {
        this.audioContext = null;
        this.isPlaying = false;
        this.currentBar = 0;
        this.currentStep = 0;
        this.intervalId = null;
        this.tempo = 120;
        this.volume = 0.7;
        this.swing = 0.12;
        this.bars = 8;
        this.scale = 'major';
        this.rootNote = 'C';
        this.patterns = {};
        this.activePatterns = {}; // key: instrument_bar -> patternName
        this.instrumentNodes = {}; // effect routing per instrument
        this.lastStepPlayed = -1;
        this.stepsPerBar = 32; // doubled internal resolution
        this.metronomeEnabled = false;
        this.mutedInstruments = new Set();
        this.soloInstruments = new Set();
        this.copyBuffer = null;
        this.flavors = {}; // instrument -> flavor selection
        this.lastSelectedCell = null;
        this.initAudioContext();
        this.initEffects();
        this.initPatternLibrary();
        this.initDOM();
        this.setupEffectListeners();
        this.setupRandomize();
        this.loadSavedSongs();
        document.addEventListener('click', e => { if (!e.target.closest('.pattern-menu') && !e.target.closest('.pattern-cell')) this.closePatternMenus(); });
    }

    initAudioContext() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = this.volume;
        this.masterGain.connect(this.audioContext.destination);
    }

    initEffects() {
        // Master Reverb
        this.reverb = this.audioContext.createConvolver();
        this.reverb.buffer = this.generateImpulseResponse(2.8, 2.5);
        this.reverbGain = this.audioContext.createGain();
        this.reverbGain.gain.value = 0.4;
        this.reverb.connect(this.reverbGain).connect(this.masterGain);
        // Master Delay
        this.delay = this.audioContext.createDelay(2.0);
        this.delay.delayTime.value = 0.32; // ~ dotted 8th @ 120BPM
        this.delayFeedback = this.audioContext.createGain();
        this.delayFeedback.gain.value = 0.35;
        this.delayFilter = this.audioContext.createBiquadFilter();
        this.delayFilter.type = 'lowpass';
        this.delayFilter.frequency.value = 4000;
        this.delayGain = this.audioContext.createGain();
        this.delayGain.gain.value = 0.35;
        this.delay.connect(this.delayFilter).connect(this.delayFeedback).connect(this.delay);
        this.delay.connect(this.delayGain).connect(this.masterGain);
        // Per-instrument routing containers lazy created
    }

    generateImpulseResponse(seconds = 2, decay = 2) {
        const rate = this.audioContext.sampleRate;
        const length = rate * seconds;
        const impulse = this.audioContext.createBuffer(2, length, rate);
        for (let c = 0; c < 2; c++) {
            const channel = impulse.getChannelData(c);
            for (let i = 0; i < length; i++) {
                channel[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
            }
        }
        return impulse;
    }

    ensureInstrumentNodes(instrument) {
        if (this.instrumentNodes[instrument]) return this.instrumentNodes[instrument];
        const dry = this.audioContext.createGain(); dry.gain.value = 1; dry.connect(this.masterGain);
        const revSend = this.audioContext.createGain(); revSend.gain.value = 0; revSend.connect(this.reverb);
        const delSend = this.audioContext.createGain(); delSend.gain.value = 0; delSend.connect(this.delay);
        return this.instrumentNodes[instrument] = { dry, revSend, delSend };
    }

    setupEffectListeners() {
        document.querySelectorAll('.track').forEach(track => {
            const instrument = track.dataset.instrument;
            const rev = track.querySelector('.reverb-knob');
            const del = track.querySelector('.delay-knob');
            if (rev) rev.addEventListener('input', e => {
                const nodes = this.ensureInstrumentNodes(instrument);
                nodes.revSend.gain.value = e.target.value / 100; });
            if (del) del.addEventListener('input', e => {
                const nodes = this.ensureInstrumentNodes(instrument);
                nodes.delSend.gain.value = (e.target.value / 100) * 0.9; });
        });
    }

    initPatternLibrary() {
        // Nintendo‑style inspired (original) progressive pattern groups
        // Each group (e.g. "Mii - 1/2/3") forms a coherent evolution
        this.patterns = {
            drums: {
                // Progressive Mii style
                'Mii Beat - 1': {
                    name: 'Mii Beat - 1',
                    description: 'Light syncopated base groove',
                    rhythm: [1,0,0.55,0,0.8,0,0.45,0,0.9,0,0.5,0,0.85,0,0.4,0]
                },
                'Mii Beat - 2': {
                    name: 'Mii Beat - 2',
                    description: 'Adds offbeat ghost taps',
                    rhythm: [1,0.25,0.55,0,0.85,0.2,0.5,0,0.9,0.2,0.55,0,0.9,0.15,0.45,0]
                },
                'Mii Beat - 3': {
                    name: 'Mii Beat - 3',
                    description: 'Busier syncopation & fills',
                    rhythm: [1,0.25,0.6,0.2,0.9,0,0.55,0.3,0.95,0.25,0.6,0.2,1,0.3,0.5,0.35]
                },
                // Weather style
                'Weather - 1': {
                    name: 'Weather - 1',
                    description: 'Sparse calm pulses',
                    rhythm: [0.9,0,0.35,0,0.7,0,0.3,0,0.8,0,0.45,0,0.85,0,0.25,0]
                },
                'Weather - 2': {
                    name: 'Weather - 2',
                    description: 'Adds gentle internal syncopation',
                    rhythm: [0.9,0.18,0.4,0,0.75,0.15,0.32,0,0.82,0.14,0.48,0,0.88,0.12,0.28,0]
                },
                'Weather - 3': {
                    name: 'Weather - 3',
                    description: 'Subtle rolling embellishments',
                    rhythm: [0.95,0.18,0.45,0.15,0.8,0.2,0.35,0.12,0.85,0.18,0.5,0.14,0.9,0.2,0.3,0.15]
                },
                // Shopping style
                'Shopping - 1': {
                    name: 'Shopping - 1',
                    description: 'Bouncy storefront pulse',
                    rhythm: [0.9,0,0.6,0,0.8,0,0.65,0,0.9,0,0.55,0,1,0,0.5,0]
                },
                'Shopping - 2': {
                    name: 'Shopping - 2',
                    description: 'Adds light taps and lifts',
                    rhythm: [0.9,0.22,0.6,0,0.85,0.2,0.7,0,0.95,0.18,0.55,0,1,0.2,0.5,0]
                },
                'Shopping - 3': {
                    name: 'Shopping - 3',
                    description: 'Playful syncopated bustle',
                    rhythm: [0.95,0.25,0.65,0.2,0.9,0.18,0.7,0.25,1,0.2,0.6,0.18,1,0.3,0.55,0.35]
                },
                // Legacy originals kept
                'Bouncy Beat': {
                    name: 'Bouncy Beat',
                    description: 'Light, playful drum pattern like Wii Menu',
                    rhythm: [1, 0, 0.7, 0, 0.8, 0, 0.5, 0, 1, 0, 0.6, 0, 0.9, 0, 0.4, 0]
                },
                'Mii Maker': {
                    name: 'Mii Maker',
                    description: 'Creative workshop rhythm',
                    rhythm: [0.9, 0.3, 0, 0.5, 1, 0, 0.7, 0.2, 0.8, 0.4, 0, 0.6, 1, 0, 0.5, 0.3]
                },
                'Weather Forecast': {
                    name: 'Weather Forecast',
                    description: 'Calm meteorological beats',
                    rhythm: [0.8, 0, 0.4, 0, 0.7, 0, 0.3, 0, 0.8, 0, 0.5, 0, 0.9, 0, 0.2, 0]
                },
                'Photo Channel': {
                    name: 'Photo Channel',
                    description: 'Memory slideshow rhythm',
                    rhythm: [1, 0.2, 0.6, 0.1, 0.8, 0.3, 0.4, 0, 1, 0.1, 0.7, 0.2, 0.9, 0, 0.5, 0.1]
                },
                'System Menu': {
                    name: 'System Menu',
                    description: 'Main interface percussion',
                    rhythm: [1, 0, 0.8, 0, 1, 0, 0.8, 0, 1, 0, 0.8, 0, 1, 0, 0.8, 0]
                },
                'News Channel': {
                    name: 'News Channel',
                    description: 'Information ticker beats',
                    rhythm: [0.7, 0.3, 0.5, 0.2, 0.8, 0.4, 0.6, 0.1, 0.7, 0.3, 0.5, 0.2, 0.9, 0.4, 0.3, 0.1]
                },
                'Shopping': {
                    name: 'Shopping',
                    description: 'Retail browsing rhythm',
                    rhythm: [0.9, 0, 0.6, 0.3, 0.8, 0, 0.7, 0.2, 0.9, 0.1, 0.5, 0.4, 1, 0, 0.4, 0.3]
                },
                'Internet': {
                    name: 'Internet',
                    description: 'Web browsing percussion',
                    rhythm: [0.8, 0.2, 0.4, 0.1, 0.7, 0.3, 0.6, 0.1, 0.8, 0.2, 0.5, 0.1, 0.9, 0.3, 0.3, 0.2]
                },
                'StreetPass': {
                    name: 'StreetPass',
                    description: 'Social connection beats',
                    rhythm: [1, 0.1, 0, 0.4, 0.8, 0.2, 0.6, 0, 1, 0.3, 0, 0.5, 0.9, 0.1, 0.7, 0]
                }
            },
            bass: {
                'eShop - 1': {
                    name: 'eShop - 1',
                    description: 'Warm tonic / dominant bounce',
                    notes: ['C2','','G2','','E2','','A2','','F2','','C3','','G2','','E2',''],
                    rhythm: [0.75,0,0.55,0,0.6,0,0.5,0,0.7,0,0.55,0,0.8,0,0.5,0]
                },
                'eShop - 2': {
                    name: 'eShop - 2',
                    description: 'Adds passing approach tones',
                    notes: ['C2','D2','G2','A2','E2','F2','A2','B2','F2','G2','C3','B2','G2','A2','E2','D2'],
                    rhythm: [0.7,0.35,0.55,0.4,0.6,0.35,0.5,0.4,0.7,0.35,0.55,0.4,0.8,0.35,0.5,0.4]
                },
                'eShop - 3': {
                    name: 'eShop - 3',
                    description: 'Flowing arpeggiated motion',
                    notes: ['C2','E2','G2','B2','A1','C2','E2','G2','F2','A2','C3','E3','G1','B1','D2','F2'],
                    rhythm: [0.8,0.45,0.55,0.5,0.75,0.45,0.6,0.5,0.8,0.45,0.6,0.5,0.85,0.45,0.6,0.55]
                },
                'Weather Bass - 1': {
                    name: 'Weather Bass - 1',
                    description: 'Sparse root & fifth',
                    notes: ['C2','','G2','','F2','','C3','','A1','','E2','','G1','','D2',''],
                    rhythm: [0.8,0,0.55,0,0.7,0,0.5,0,0.7,0,0.55,0,0.75,0,0.55,0]
                },
                'Weather Bass - 2': {
                    name: 'Weather Bass - 2',
                    description: 'Adds light approach notes',
                    notes: ['C2','D2','G2','','F2','G2','C3','','A1','B1','E2','','G1','A1','D2',''],
                    rhythm: [0.75,0.35,0.5,0,0.65,0.35,0.45,0,0.65,0.35,0.5,0,0.7,0.35,0.5,0]
                },
                'Weather Bass - 3': {
                    name: 'Weather Bass - 3',
                    description: 'Flow with gentle scalar movement',
                    notes: ['C2','D2','E2','G2','F2','G2','A2','C3','A1','B1','C2','E2','G1','A1','B1','D2'],
                    rhythm: [0.8,0.45,0.5,0.45,0.75,0.45,0.55,0.5,0.7,0.45,0.5,0.45,0.75,0.45,0.55,0.5]
                },
                // Legacy
                'Bubble Bass': {
                    name: 'Bubble Bass',
                    description: 'Gentle bubbling bassline',
                    notes: ['C2', '', 'G2', '', 'C2', '', 'F2', '', 'C2', '', 'G2', '', 'C2', '', 'F2', ''],
                    rhythm: [0.8, 0, 0.6, 0, 0.8, 0, 0.7, 0, 0.8, 0, 0.6, 0, 0.8, 0, 0.7, 0]
                },
                'Mii Plaza': {
                    name: 'Mii Plaza',
                    description: 'Social gathering bass',
                    notes: ['E2', 'G2', 'B2', 'G2', 'A2', 'C3', 'E3', 'C3', 'D2', 'F2', 'A2', 'F2', 'G2', 'B2', 'D3', 'B2'],
                    rhythm: [0.7, 0.4, 0.5, 0.3, 0.8, 0.4, 0.6, 0.3, 0.7, 0.4, 0.5, 0.3, 0.8, 0.4, 0.6, 0.3]
                },
                'System Settings': {
                    name: 'System Settings',
                    description: 'Configuration menu bass',
                    notes: ['F2', '', '', 'F2', 'G2', '', '', 'G2', 'A2', '', '', 'A2', 'C3', '', '', 'C3'],
                    rhythm: [0.9, 0, 0, 0.3, 0.8, 0, 0, 0.3, 0.9, 0, 0, 0.3, 1, 0, 0, 0.4]
                },
                'Activity Log': {
                    name: 'Activity Log',
                    description: 'Data tracking bass',
                    notes: ['D2', 'F2', 'A2', 'D3', 'C2', 'E2', 'G2', 'C3', 'B1', 'D2', 'F2', 'B2', 'G2', 'B2', 'D3', 'G3'],
                    rhythm: [0.6, 0.3, 0.4, 0.5, 0.6, 0.3, 0.4, 0.5, 0.6, 0.3, 0.4, 0.5, 0.6, 0.3, 0.4, 0.5]
                },
                'Game Notes': {
                    name: 'Game Notes',
                    description: 'Achievement bass line',
                    notes: ['C2', '', 'E2', '', 'G2', '', 'E2', '', 'F2', '', 'A2', '', 'C3', '', 'A2', ''],
                    rhythm: [0.8, 0, 0.6, 0, 0.7, 0, 0.5, 0, 0.8, 0, 0.6, 0, 0.9, 0, 0.5, 0]
                },
                'Health Safety': {
                    name: 'Health Safety',
                    description: 'Wellness reminder bass',
                    notes: ['G1', '', '', '', 'C2', '', '', '', 'F2', '', '', '', 'G2', '', '', ''],
                    rhythm: [1, 0, 0, 0, 0.9, 0, 0, 0, 0.8, 0, 0, 0, 1, 0, 0, 0]
                },
                'eShop': {
                    name: 'eShop',
                    description: 'Digital storefront bass',
                    notes: ['A1', 'C2', 'E2', 'A2', 'G1', 'B1', 'D2', 'G2', 'F1', 'A1', 'C2', 'F2', 'E2', 'G2', 'B2', 'E3'],
                    rhythm: [0.7, 0.4, 0.5, 0.6, 0.7, 0.4, 0.5, 0.6, 0.7, 0.4, 0.5, 0.6, 0.8, 0.4, 0.5, 0.6]
                },
                'Friend List': {
                    name: 'Friend List',
                    description: 'Social connection bass',
                    notes: ['D2', 'G2', '', 'D2', 'E2', 'A2', '', 'E2', 'F2', 'B2', '', 'F2', 'G2', 'C3', '', 'G2'],
                    rhythm: [0.8, 0.5, 0, 0.3, 0.8, 0.5, 0, 0.3, 0.8, 0.5, 0, 0.3, 0.9, 0.5, 0, 0.4]
                },
                'Download Play': {
                    name: 'Download Play',
                    description: 'Wireless sharing bass',
                    notes: ['B1', '', 'D2', 'F2', 'G2', '', 'B2', 'D3', 'A1', '', 'C2', 'E2', 'F2', '', 'A2', 'C3'],
                    rhythm: [0.9, 0, 0.5, 0.4, 0.7, 0, 0.6, 0.5, 0.8, 0, 0.5, 0.4, 0.7, 0, 0.6, 0.5]
                }
            },
            chords: {
                'Weather Chords - 1': {
                    name: 'Weather Chords - 1',
                    description: 'Soft open voicings',
                    chords: [['C4','E4','G4'],[],['F4','A4','C5'],[],['G4','B4','D5'],[],['E4','G4','C5'],[]],
                    rhythm: [0.55,0,0.45,0,0.55,0,0.45,0,0.55,0,0.45,0,0.55,0,0.45,0]
                },
                'Weather Chords - 2': {
                    name: 'Weather Chords - 2',
                    description: 'Adds gentle mid movement',
                    chords: [['C4','G4','E5'],[],['F4','C5','A5'],[],['G4','D5','B5'],[],['E4','C5','G5'],[]],
                    rhythm: [0.6,0,0.5,0,0.6,0,0.5,0,0.6,0,0.5,0,0.6,0,0.5,0]
                },
                'Weather Chords - 3': {
                    name: 'Weather Chords - 3',
                    description: 'Brighter extensions',
                    chords: [['C4','E4','G4','B4'],[],['F4','A4','C5','E5'],[],['G4','B4','D5','F5'],[],['E4','G4','C5','D5'],[]],
                    rhythm: [0.65,0,0.5,0,0.65,0,0.5,0,0.65,0,0.5,0,0.7,0,0.5,0]
                },
                'Mii Harmony - 1': {
                    name: 'Mii Harmony - 1',
                    description: 'Playful alternating triads',
                    chords: [['D4','F4','A4'],['G4','B4','D5'],['C4','E4','G4'],['F4','A4','C5'],['E4','G4','B4'],['A3','C4','E4'],['D4','F4','A4'],['G3','B3','D4']],
                    rhythm: [0.5,0.25,0.4,0.25,0.5,0.25,0.4,0.25,0.5,0.25,0.4,0.25,0.5,0.25,0.4,0.25]
                },
                'Mii Harmony - 2': {
                    name: 'Mii Harmony - 2',
                    description: 'Adds secondary motion',
                    chords: [['D4','A4','F5'],['G4','D5','B5'],['C4','G4','E5'],['F4','C5','A5'],['E4','B4','G5'],['A3','E4','C5'],['D4','A4','F5'],['G3','D4','B4']],
                    rhythm: [0.55,0.3,0.45,0.3,0.55,0.3,0.45,0.3,0.55,0.3,0.45,0.3,0.55,0.3,0.45,0.3]
                },
                'Mii Harmony - 3': {
                    name: 'Mii Harmony - 3',
                    description: 'Broader sustaining texture',
                    chords: [['D4','F4','A4','C5'],[],['G4','B4','D5','F5'],[],['C4','E4','G4','B4'],[],['F4','A4','C5','E5'],[]],
                    rhythm: [0.6,0,0.5,0,0.6,0,0.5,0,0.6,0,0.5,0,0.65,0,0.5,0]
                },
                // Legacy
                'Sky Pads': {
                    name: 'Sky Pads',
                    description: 'Dreamy atmospheric chords',
                    chords: [['C4', 'E4', 'G4'], [], ['F4', 'A4', 'C5'], [], ['G4', 'B4', 'D5'], [], ['C4', 'E4', 'G4'], []],
                    rhythm: [0.6, 0, 0.5, 0, 0.6, 0, 0.5, 0, 0.6, 0, 0.5, 0, 0.6, 0, 0.5, 0]
                },
                'Mii Channel': {
                    name: 'Mii Channel',
                    description: 'Avatar creation harmony',
                    chords: [['D4', 'F4', 'A4'], ['G4', 'B4', 'D5'], ['C4', 'E4', 'G4'], ['F4', 'A4', 'C5'], ['B3', 'D4', 'F4'], ['E4', 'G4', 'B4'], ['A3', 'C4', 'E4'], ['D4', 'F4', 'A4']],
                    rhythm: [0.5, 0.3, 0.4, 0.3, 0.5, 0.3, 0.4, 0.3, 0.5, 0.3, 0.4, 0.3, 0.5, 0.3, 0.4, 0.3]
                },
                'Wii Sports': {
                    name: 'Wii Sports',
                    description: 'Athletic competition chords',
                    chords: [['E4', 'G4', 'B4'], [], [], ['A4', 'C5', 'E5'], ['D4', 'F4', 'A4'], [], [], ['G4', 'B4', 'D5']],
                    rhythm: [0.7, 0, 0, 0.5, 0.6, 0, 0, 0.5, 0.7, 0, 0, 0.5, 0.8, 0, 0, 0.6]
                },
                'Wii Music': {
                    name: 'Wii Music',
                    description: 'Creative music making',
                    chords: [['F4', 'A4', 'C5'], ['G4', 'B4', 'D5'], ['A4', 'C5', 'E5'], ['G4', 'B4', 'D5'], ['F4', 'A4', 'C5'], ['E4', 'G4', 'B4'], ['D4', 'F4', 'A4'], ['C4', 'E4', 'G4']],
                    rhythm: [0.4, 0.2, 0.3, 0.2, 0.4, 0.2, 0.3, 0.2, 0.4, 0.2, 0.3, 0.2, 0.4, 0.2, 0.3, 0.2]
                },
                'Nintendo Zone': {
                    name: 'Nintendo Zone',
                    description: 'Hotspot connection chords',
                    chords: [['B3', 'E4', 'G4'], [], ['C4', 'F4', 'A4'], [], ['D4', 'G4', 'B4'], [], ['E4', 'A4', 'C5'], []],
                    rhythm: [0.6, 0, 0.4, 0, 0.6, 0, 0.4, 0, 0.6, 0, 0.4, 0, 0.7, 0, 0.4, 0]
                },
                'AR Games': {
                    name: 'AR Games',
                    description: 'Augmented reality chords',
                    chords: [['G4', 'B4', 'D5'], ['F4', 'A4', 'C5'], ['E4', 'G4', 'B4'], ['D4', 'F4', 'A4'], ['C4', 'E4', 'G4'], ['B3', 'D4', 'F4'], ['A3', 'C4', 'E4'], ['G3', 'B3', 'D4']],
                    rhythm: [0.3, 0.2, 0.4, 0.2, 0.3, 0.2, 0.4, 0.2, 0.3, 0.2, 0.4, 0.2, 0.3, 0.2, 0.4, 0.2]
                },
                'Face Raiders': {
                    name: 'Face Raiders',
                    description: 'Action game harmony',
                    chords: [['A4', 'C5', 'E5'], [], [], [], ['F4', 'A4', 'C5'], [], [], [], ['G4', 'B4', 'D5'], [], [], [], ['C5', 'E5', 'G5'], [], [], []],
                    rhythm: [0.8, 0, 0, 0, 0.7, 0, 0, 0, 0.8, 0, 0, 0, 0.9, 0, 0, 0]
                },
                'SpotPass': {
                    name: 'SpotPass',
                    description: 'Wireless notification harmony',
                    chords: [['C4', 'E4', 'G4'], ['D4', 'F4', 'A4'], ['E4', 'G4', 'B4'], ['F4', 'A4', 'C5']],
                    rhythm: [0.5, 0.3, 0.4, 0.2, 0.5, 0.3, 0.4, 0.2, 0.5, 0.3, 0.4, 0.2, 0.5, 0.3, 0.4, 0.2]
                },
                'System Transfer': {
                    name: 'System Transfer',
                    description: 'Data migration chords',
                    chords: [['E4', 'G4', 'B4'], [], ['A4', 'C5', 'E5'], [], ['D4', 'F4', 'A4'], [], ['G4', 'B4', 'D5'], []],
                    rhythm: [0.7, 0, 0.5, 0, 0.7, 0, 0.5, 0, 0.7, 0, 0.5, 0, 0.8, 0, 0.5, 0]
                }
            },
            lead1: {
                'Mii - 1': {
                    name: 'Mii - 1',
                    description: 'Playful ascending motif',
                    notes: ['C5','E5','G5','E5','F5','A5','G5','F5','E5','G5','B5','G5','C6','G5','E5','C5'],
                    rhythm: [0.45,0.3,0.5,0.3,0.45,0.55,0.4,0.3,0.45,0.3,0.5,0.3,0.55,0.45,0.3,0.3]
                },
                'Mii - 2': {
                    name: 'Mii - 2',
                    description: 'Adds neighbor tones & lift',
                    notes: ['C5','D5','E5','G5','F5','E5','A5','G5','E5','F5','G5','B5','C6','B5','G5','E5'],
                    rhythm: [0.5,0.35,0.45,0.4,0.45,0.35,0.55,0.4,0.45,0.35,0.45,0.4,0.6,0.45,0.35,0.35]
                },
                'Mii - 3': {
                    name: 'Mii - 3',
                    description: 'Expanded range resolution',
                    notes: ['E5','G5','B5','C6','A5','G5','F5','E5','D5','F5','G5','A5','G5','E5','C5',''],
                    rhythm: [0.5,0.4,0.55,0.6,0.5,0.4,0.45,0.35,0.45,0.35,0.45,0.55,0.45,0.35,0.5,0]
                },
                'Shopping Lead - 1': {
                    name: 'Shopping Lead - 1',
                    description: 'Cheerful storefront lick',
                    notes: ['E5','G5','A5','G5','F5','A5','C6','A5','B5','G5','E5','G5','A5','F5','E5',''],
                    rhythm: [0.5,0.35,0.45,0.35,0.45,0.5,0.55,0.4,0.5,0.35,0.45,0.35,0.5,0.35,0.45,0]
                },
                'Shopping Lead - 2': {
                    name: 'Shopping Lead - 2',
                    description: 'Adds turn figures',
                    notes: ['E5','F5','G5','A5','G5','F5','A5','C6','B5','A5','G5','E5','F5','E5','D5',''],
                    rhythm: [0.5,0.3,0.45,0.5,0.45,0.3,0.5,0.55,0.5,0.3,0.45,0.35,0.45,0.3,0.45,0]
                },
                'Shopping Lead - 3': {
                    name: 'Shopping Lead - 3',
                    description: 'Brighter closure phrase',
                    notes: ['G5','A5','C6','E6','D6','C6','A5','G5','F5','A5','C6','A5','G5','E5','C5',''],
                    rhythm: [0.55,0.35,0.5,0.6,0.5,0.4,0.45,0.35,0.45,0.35,0.5,0.45,0.45,0.35,0.5,0]
                },
                'Weather Lead - 1': {
                    name: 'Weather Lead - 1',
                    description: 'Airy spaced notes',
                    notes: ['C5','','E5','','G5','','A5','','G5','','E5','','D5','','C5',''],
                    rhythm: [0.5,0,0.45,0,0.5,0,0.55,0,0.5,0,0.45,0,0.5,0,0.45,0]
                },
                'Weather Lead - 2': {
                    name: 'Weather Lead - 2',
                    description: 'Adds soft approach tones',
                    notes: ['C5','D5','E5','','G5','A5','A5','','G5','F5','E5','','D5','E5','C5',''],
                    rhythm: [0.5,0.3,0.45,0,0.5,0.35,0.5,0,0.5,0.3,0.45,0,0.5,0.3,0.45,0]
                },
                'Weather Lead - 3': {
                    name: 'Weather Lead - 3',
                    description: 'Gentle rising arc',
                    notes: ['C5','E5','G5','A5','B5','A5','G5','E5','F5','A5','G5','E5','D5','E5','C5',''],
                    rhythm: [0.55,0.35,0.5,0.45,0.55,0.4,0.5,0.35,0.5,0.45,0.5,0.35,0.45,0.35,0.5,0]
                },
                // Legacy
                'Sparkle': {
                    name: 'Sparkle',
                    description: 'Twinkling lead melody',
                    notes: ['C5', 'E5', 'G5', 'E5', 'F5', 'A5', 'G5', 'F5', 'E5', 'G5', 'B5', 'G5', 'C6', 'G5', 'E5', 'C5'],
                    rhythm: [0.4, 0.3, 0.5, 0.3, 0.4, 0.6, 0.4, 0.3, 0.4, 0.3, 0.5, 0.3, 0.6, 0.4, 0.3, 0.3]
                },
                'Mii Parade': {
                    name: 'Mii Parade',
                    description: 'Celebratory melody march',
                    notes: ['G5', 'A5', 'B5', 'C6', 'B5', 'A5', 'G5', 'F5', 'E5', 'F5', 'G5', 'A5', 'G5', 'F5', 'E5', 'D5'],
                    rhythm: [0.5, 0.4, 0.5, 0.6, 0.5, 0.4, 0.4, 0.3, 0.4, 0.3, 0.4, 0.5, 0.4, 0.3, 0.4, 0.3]
                },
                'Photo Booth': {
                    name: 'Photo Booth',
                    description: 'Camera snapshot melody',
                    notes: ['E5', '', 'G5', '', 'B5', '', 'G5', '', 'A5', '', 'C6', '', 'E6', '', 'C6', ''],
                    rhythm: [0.6, 0, 0.5, 0, 0.7, 0, 0.4, 0, 0.6, 0, 0.5, 0, 0.8, 0, 0.4, 0]
                },
                'Nintendo Video': {
                    name: 'Nintendo Video',
                    description: 'Entertainment showcase melody',
                    notes: ['D5', 'F5', 'A5', 'D6', 'C5', 'E5', 'G5', 'C6', 'B4', 'D5', 'F5', 'B5', 'A4', 'C5', 'E5', 'A5'],
                    rhythm: [0.4, 0.3, 0.4, 0.5, 0.4, 0.3, 0.4, 0.5, 0.4, 0.3, 0.4, 0.5, 0.4, 0.3, 0.4, 0.5]
                },
                'Sleep Mode': {
                    name: 'Sleep Mode',
                    description: 'Gentle rest melody',
                    notes: ['C5', '', '', 'E5', '', '', 'G5', '', '', 'E5', '', '', 'C5', '', '', ''],
                    rhythm: [0.5, 0, 0, 0.4, 0, 0, 0.6, 0, 0, 0.4, 0, 0, 0.5, 0, 0, 0]
                },
                'Street Fighter': {
                    name: 'Street Fighter',
                    description: '3D fighting game melody',
                    notes: ['F5', 'G5', 'A5', 'C6', 'A5', 'G5', 'F5', 'E5', 'D5', 'E5', 'F5', 'G5', 'F5', 'E5', 'D5', 'C5'],
                    rhythm: [0.5, 0.3, 0.4, 0.6, 0.4, 0.3, 0.4, 0.3, 0.4, 0.3, 0.4, 0.5, 0.4, 0.3, 0.4, 0.3]
                },
                'Ambassador': {
                    name: 'Ambassador',
                    description: 'Early adopter melody',
                    notes: ['A5', '', 'F5', '', 'D5', '', 'A4', '', 'F5', '', 'D5', '', 'A5', '', 'D6', ''],
                    rhythm: [0.6, 0, 0.4, 0, 0.5, 0, 0.3, 0, 0.4, 0, 0.5, 0, 0.7, 0, 0.8, 0]
                },
                'Quick Notes': {
                    name: 'Quick Notes',
                    description: 'Swift memo melody',
                    notes: ['G5', 'A5', '', 'B5', 'C6', '', 'D6', 'E6', 'D6', 'C6', '', 'B5', 'A5', '', 'G5', ''],
                    rhythm: [0.4, 0.3, 0, 0.3, 0.4, 0, 0.3, 0.4, 0.3, 0.4, 0, 0.3, 0.4, 0, 0.3, 0]
                },
                'Home Menu': {
                    name: 'Home Menu',
                    description: 'Main interface melody',
                    notes: ['C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6', 'B5', 'A5', 'G5', 'F5', 'E5', 'D5', 'C5', ''],
                    rhythm: [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.5, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.4, 0]
                }
            },
            lead2: {
                'Mii Echo - 1': {
                    name: 'Mii Echo - 1',
                    description: 'Echo fragments of main motif',
                    notes: ['','C5','','E5','','G5','','E5','','F5','','A5','','G5','','F5'],
                    rhythm: [0,0.4,0,0.3,0,0.5,0,0.3,0,0.35,0,0.55,0,0.4,0,0.3]
                },
                'Mii Echo - 2': {
                    name: 'Mii Echo - 2',
                    description: 'Adds passing echoes',
                    notes: ['','D5','','F5','','A5','','F5','','G5','','B5','','A5','','G5'],
                    rhythm: [0,0.45,0,0.35,0,0.55,0,0.35,0,0.4,0,0.6,0,0.45,0,0.35]
                },
                'Mii Echo - 3': {
                    name: 'Mii Echo - 3',
                    description: 'Higher echo closure',
                    notes: ['','E5','','G5','','B5','','G5','','A5','','C6','','B5','','A5'],
                    rhythm: [0,0.45,0,0.35,0,0.55,0,0.4,0,0.45,0,0.6,0,0.5,0,0.4]
                },
                'Shopping Echo - 1': {
                    name: 'Shopping Echo - 1',
                    description: 'Light tag responses',
                    notes: ['E5','','','G5','A5','','','C6','G5','','','A5','F5','','','E5'],
                    rhythm: [0.35,0,0,0.25,0.35,0,0,0.4,0.35,0,0,0.3,0.35,0,0,0.3]
                },
                'Shopping Echo - 2': {
                    name: 'Shopping Echo - 2',
                    description: 'Adds anticipations',
                    notes: ['E5','','G5','A5','G5','','B5','C6','A5','','C6','A5','G5','','E5',''],
                    rhythm: [0.35,0,0.3,0.35,0.3,0,0.4,0.45,0.35,0,0.4,0.35,0.3,0,0.35,0]
                },
                'Shopping Echo - 3': {
                    name: 'Shopping Echo - 3',
                    description: 'Higher sparkle',
                    notes: ['G5','','A5','C6','E6','','C6','A5','B5','','C6','E6','A5','','G5',''],
                    rhythm: [0.4,0,0.35,0.4,0.5,0,0.35,0.4,0.45,0,0.35,0.5,0.45,0,0.4,0]
                },
                // Legacy
                'Echo Dream': {
                    name: 'Echo Dream',
                    description: 'Dreamy echoing melody',
                    notes: ['', 'C5', '', 'E5', '', 'G5', '', 'E5', '', 'F5', '', 'A5', '', 'G5', '', 'F5'],
                    rhythm: [0, 0.4, 0, 0.3, 0, 0.5, 0, 0.3, 0, 0.4, 0, 0.6, 0, 0.4, 0, 0.3]
                },
                'Streetpass Plaza': {
                    name: 'Streetpass Plaza',
                    description: 'Social meeting harmony',
                    notes: ['', 'G5', '', '', 'B5', '', '', 'D6', '', 'F5', '', '', 'A5', '', '', 'C6'],
                    rhythm: [0, 0.4, 0, 0, 0.5, 0, 0, 0.6, 0, 0.4, 0, 0, 0.5, 0, 0, 0.6]
                },
                'Find Mii': {
                    name: 'Find Mii',
                    description: 'RPG adventure echo',
                    notes: ['', '', 'D5', '', '', 'G5', '', '', '', 'B5', '', '', 'D6', '', '', 'G6'],
                    rhythm: [0, 0, 0.5, 0, 0, 0.4, 0, 0, 0, 0.6, 0, 0, 0.7, 0, 0, 0.8]
                },
                'Puzzle Swap': {
                    name: 'Puzzle Swap',
                    description: 'Collectible trading melody',
                    notes: ['F5', '', '', 'A5', 'C6', '', '', 'F6', 'E5', '', '', 'G5', 'B5', '', '', 'E6'],
                    rhythm: [0.4, 0, 0, 0.3, 0.4, 0, 0, 0.5, 0.4, 0, 0, 0.3, 0.4, 0, 0, 0.5]
                },
                'Notifications': {
                    name: 'Notifications',
                    description: 'System alert melody',
                    notes: ['', 'E5', '', 'G5', '', 'B5', '', 'G5', '', 'F5', '', 'A5', '', 'C6', '', 'A5'],
                    rhythm: [0, 0.3, 0, 0.2, 0, 0.4, 0, 0.2, 0, 0.3, 0, 0.2, 0, 0.4, 0, 0.2]
                },
                'Data Management': {
                    name: 'Data Management',
                    description: 'System utility harmony',
                    notes: ['', '', 'A4', '', '', 'D5', '', '', '', 'F5', '', '', 'A5', '', '', 'D6'],
                    rhythm: [0, 0, 0.4, 0, 0, 0.3, 0, 0, 0, 0.4, 0, 0, 0.5, 0, 0, 0.6]
                },
                'Parental Controls': {
                    name: 'Parental Controls',
                    description: 'Safety settings melody',
                    notes: ['C5', '', '', 'F5', 'G5', '', '', 'C6', 'B4', '', '', 'E5', 'F5', '', '', 'B5'],
                    rhythm: [0.3, 0, 0, 0.2, 0.3, 0, 0, 0.4, 0.3, 0, 0, 0.2, 0.3, 0, 0, 0.4]
                },
                'System Update': {
                    name: 'System Update',
                    description: 'Firmware upgrade melody',
                    notes: ['', 'D5', '', '', 'F5', '', '', 'A5', '', 'C6', '', '', 'F6', '', '', 'A6'],
                    rhythm: [0, 0.3, 0, 0, 0.3, 0, 0, 0.4, 0, 0.3, 0, 0, 0.5, 0, 0, 0.6]
                },
                'Wireless Connection': {
                    name: 'Wireless Connection',
                    description: 'Network harmony',
                    notes: ['', '', 'B4', '', '', 'E5', '', '', '', 'G5', '', '', 'B5', '', '', 'E6'],
                    rhythm: [0, 0, 0.4, 0, 0, 0.3, 0, 0, 0, 0.4, 0, 0, 0.5, 0, 0, 0.6]
                }
            }
        };
        // After defining patterns, expand them to 32 steps where needed
        this.expandPatterns();
    }

    expandPatterns() {
        const isNotePattern = p => p.notes && Array.isArray(p.notes);
        const isChordPattern = p => p.chords && Array.isArray(p.chords);
        Object.keys(this.patterns).forEach(inst => {
            Object.values(this.patterns[inst]).forEach(p => {
                // Drums: rhythm length 16 -> 32 by duplicating with lighter echo
                if (p.rhythm && p.rhythm.length === 16 && !isNotePattern(p) && !isChordPattern(p)) {
                    const out = [];
                    p.rhythm.forEach(v => { out.push(v); out.push(v * 0.6); });
                    p.rhythm = out; // 32 length
                }
                // Bass / Lead note patterns
                if (isNotePattern(p) && p.rhythm && p.rhythm.length === 16 && p.notes.length === 16) {
                    const newNotes = []; const newRhythm = [];
                    for (let i=0;i<16;i++) {
                        const n = p.notes[i]; const r = p.rhythm[i];
                        newNotes.push(n); newRhythm.push(r); // original beat
                        // second subdivision: usually rest for space unless strong accent
                        if (r > 0.55 && n) { // sustain accent
                            newNotes.push(n); newRhythm.push(r*0.4);
                        } else {
                            newNotes.push(''); newRhythm.push(0);
                        }
                    }
                    p.notes = newNotes; p.rhythm = newRhythm; // 32
                }
                // Chord patterns: keep 8 chords but stretch rhythm to 32 steps (each original 16th -> 2)
                if (isChordPattern(p) && p.rhythm && p.rhythm.length === 16) {
                    const stretched = []; p.rhythm.forEach(v => { stretched.push(v); stretched.push(0); }); p.rhythm = stretched; // 32 rhythm entries
                    // keep chords array same (8 entries). Playback will adjust index.
                }
            });
        });
    }

    noteToFrequency(note) {
        const baseFrequencies = {
            'C': 261.63, 'C#': 277.18, 'D': 293.66, 'D#': 311.13, 'E': 329.63, 'F': 349.23,
            'F#': 369.99, 'G': 392.00, 'G#': 415.30, 'A': 440.00, 'A#': 466.16, 'B': 493.88
        };
        
        if (!note) return 0;
        
        const noteRegex = /([A-G]#?)(\d)/;
        const match = note.match(noteRegex);
        if (!match) return 440;
        
        const [, noteName, octave] = match;
        const baseFreq = baseFrequencies[noteName];
        const octaveNum = parseInt(octave);
        
        return baseFreq * Math.pow(2, octaveNum - 4);
    }

    getScaleNotes(rootNote, scale) {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const rootIndex = noteNames.indexOf(rootNote);
        
        const scalePatterns = {
            'major': [0, 2, 4, 5, 7, 9, 11],
            'minor': [0, 2, 3, 5, 7, 8, 10],
            'pentatonic': [0, 2, 4, 7, 9],
            'lydian': [0, 2, 4, 6, 7, 9, 11],
            'mixolydian': [0, 2, 4, 5, 7, 9, 10]
        };
        
        const pattern = scalePatterns[scale] || scalePatterns['major'];
        return pattern.map(interval => noteNames[(rootIndex + interval) % 12]);
    }

    createSynth(instrument, type, frequency, duration, volume = 0.5) {
        const nodes = this.ensureInstrumentNodes(instrument);
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        const filter = this.audioContext.createBiquadFilter();
        // Apply flavor overrides
        const flavor = this.flavors[instrument];
        const flavorConfig = this.getFlavorConfig(instrument, flavor, { type, duration });
        osc.type = flavorConfig.type;
        const now = this.audioContext.currentTime;
        osc.frequency.setValueAtTime(frequency * flavorConfig.freqMult, now);
        const attack = flavorConfig.env.attack;
        const decay = flavorConfig.env.decay;
        const sustain = flavorConfig.env.sustain;
        const release = duration;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(volume, now + attack);
        gain.gain.linearRampToValueAtTime(volume * sustain, now + attack + decay);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * 0.001), now + release);
        filter.type = flavorConfig.filter.type;
        filter.frequency.setValueAtTime(frequency * flavorConfig.filter.mult, now);
        filter.Q.value = flavorConfig.filter.Q;
        osc.connect(filter).connect(gain);
        gain.connect(nodes.dry); gain.connect(nodes.revSend); gain.connect(nodes.delSend);
        osc.start(now); osc.stop(now + release + 0.01);
    }

    getFlavorConfig(instrument, flavor, base) {
        const defaults = { type: base.type, freqMult:1, env:{attack:0.01, decay:base.duration*0.3, sustain:0.3}, filter:{ type:'lowpass', mult:3.5, Q:0.7 } };
        const map = {
            bass: {
                warm: { type:'sawtooth', freqMult:0.5, env:{attack:0.01, decay:0.25, sustain:0.4}, filter:{type:'lowpass', mult:2, Q:1}},
                punchy:{ type:'square', freqMult:1, env:{attack:0.005, decay:0.15, sustain:0.25}, filter:{type:'bandpass', mult:3, Q:6}},
                sub:{ type:'sine', freqMult:0.5, env:{attack:0.01, decay:0.4, sustain:0.6}, filter:{type:'lowpass', mult:1.5, Q:0.5}}
            },
            chords: {
                soft:{ type:'triangle', freqMult:1, env:{attack:0.02, decay:0.4, sustain:0.5}, filter:{type:'lowpass', mult:2.5, Q:0.8}},
                bright:{ type:'sawtooth', freqMult:1, env:{attack:0.01, decay:0.3, sustain:0.4}, filter:{type:'highpass', mult:6, Q:0.7}},
                warm:{ type:'sine', freqMult:1, env:{attack:0.03, decay:0.5, sustain:0.6}, filter:{type:'lowpass', mult:2, Q:1}}
            },
            lead1: {
                bell:{ type:'sine', freqMult:2, env:{attack:0.005, decay:0.35, sustain:0.2}, filter:{type:'bandpass', mult:5, Q:8}},
                pluck:{ type:'square', freqMult:1, env:{attack:0.003, decay:0.18, sustain:0.1}, filter:{type:'lowpass', mult:4, Q:2}},
                soft:{ type:'triangle', freqMult:1, env:{attack:0.01, decay:0.28, sustain:0.25}, filter:{type:'lowpass', mult:3, Q:1}}
            },
            lead2: {
                echo:{ type:'square', freqMult:1, env:{attack:0.005, decay:0.3, sustain:0.15}, filter:{type:'bandpass', mult:4, Q:4}},
                dreamy:{ type:'sine', freqMult:1, env:{attack:0.02, decay:0.45, sustain:0.4}, filter:{type:'lowpass', mult:2.5, Q:0.9}},
                crystal:{ type:'sawtooth', freqMult:1, env:{attack:0.005, decay:0.25, sustain:0.2}, filter:{type:'highpass', mult:6, Q:1.5}}
            }
        };
        return (map[instrument] && map[instrument][flavor]) ? map[instrument][flavor] : defaults;
    }

    setupDOM() {
        this.setupControlListeners();
        this.setupTransportControls();
        this.setupSongManagement();
        this.setupSequencer();
        this.setupModal();
        this.setupTimelineClick();
        this.updateGrids();
    }

    setupControlListeners() {
        const tempoSlider = document.getElementById('tempo'); const tempoValue = document.getElementById('tempo-value');
        const volumeSlider = document.getElementById('volume'); const volumeValue = document.getElementById('volume-value');
        const swingSlider = document.getElementById('swing'); const swingValue = document.getElementById('swing-value');
        const met = document.getElementById('metronome');
        tempoSlider.addEventListener('input', e => { this.tempo = +e.target.value; tempoValue.textContent = this.tempo; });
        volumeSlider.addEventListener('input', e => { this.volume = e.target.value / 100; volumeValue.textContent = `${e.target.value}%`; this.masterGain.gain.value = this.volume; });
        swingSlider.addEventListener('input', e => { this.swing = e.target.value / 100; swingValue.textContent = `${e.target.value}%`; });
        document.getElementById('scale').addEventListener('change', e => { this.scale = e.target.value; });
        document.getElementById('root-note').addEventListener('change', e => { this.rootNote = e.target.value; });
        document.getElementById('bars').addEventListener('input', e => { this.bars = Math.min(16, Math.max(4, parseInt(e.target.value)||8)); this.updateGrids(); });
        if (met) met.addEventListener('change', e => { this.metronomeEnabled = e.target.checked; });
        window.addEventListener('keydown', e => {
            if (e.code === 'Space') { e.preventDefault(); this.isPlaying ? this.stop() : this.play(); }
            if (e.ctrlKey || e.metaKey) {
                if (e.key.toLowerCase()==='c') { this.copySelectedPattern(); }
                if (e.key.toLowerCase()==='v') { this.pastePattern(); }
            }
        });
    }

    setupFlavorListeners() {
        document.querySelectorAll('.flavor-select').forEach(sel => {
            const inst = sel.dataset.instrument;
            this.flavors[inst] = sel.value;
            sel.addEventListener('change', e => { this.flavors[inst] = e.target.value; });
        });
    }

    setupTransportControls() {
        document.getElementById('play-btn').addEventListener('click', () => {
            if (this.audioContext.state === 'suspended') this.audioContext.resume();
            this.isPlaying ? this.stop() : this.play();
        });
        document.getElementById('stop-btn').addEventListener('click', () => this.stop());
        document.getElementById('clear-btn').addEventListener('click', () => this.clearAll());
        const exportBtn = document.getElementById('export-btn');
        if (exportBtn) exportBtn.addEventListener('click', () => this.exportSong());
        const importInput = document.getElementById('import-file');
        const importBtn = document.getElementById('import-btn');
        if (importBtn && importInput) importBtn.addEventListener('click', ()=> importInput.click());
        if (importInput) importInput.addEventListener('change', e => this.handleImportFile(e));
        const helpBtn = document.getElementById('help-btn'); if (helpBtn) helpBtn.addEventListener('click', ()=> this.showHelp());
        document.addEventListener('click', e => {
            const mute = e.target.closest('.mute-btn');
            const solo = e.target.closest('.solo-btn');
            if (mute) { this.toggleMute(mute.dataset.instrument); mute.classList.toggle('active'); }
            if (solo) { this.toggleSolo(solo.dataset.instrument); solo.classList.toggle('active'); }
        });
    }

    setupRandomize() { const btn = document.getElementById('randomize-btn'); if (btn) btn.addEventListener('click', () => this.randomizeSong()); }

    randomizeSong() {
        this.activePatterns = {};
        const instruments = ['drums','bass','chords','lead1','lead2'];
        instruments.forEach(inst => {
            const names = Object.keys(this.patterns[inst]);
            let last = null;
            for (let bar=0; bar<this.bars; bar++) {
                // Bias: earlier bars pick simpler patterns ending with ' - 1' if present
                let pool = names;
                if (bar < this.bars/3) {
                    const simple = names.filter(n=>/ - 1$/.test(n)); if (simple.length) pool = simple;
                } else if (bar > (2*this.bars)/3) {
                    const advanced = names.filter(n=>/ - 3$/.test(n)); if (advanced.length) pool = advanced;
                }
                let pick;
                let safety=0;
                do { pick = pool[Math.floor(Math.random()*pool.length)]; safety++; } while(pick===last && safety<5);
                last = pick;
                this.activePatterns[`${inst}_${bar}`] = pick;
            }
        });
        this.refreshPatternCells();
    }

    setupSongManagement() {
        document.getElementById('save-btn').addEventListener('click', () => this.saveSong());
        document.getElementById('load-song').addEventListener('change', e => { if (e.target.value) this.loadSong(e.target.value); });
        document.getElementById('delete-btn').addEventListener('click', () => { const sel = document.getElementById('load-song'); if (sel.value) this.deleteSong(sel.value); });
    }

    setupSequencer() { /* grid built in updateGrids */ }

    setupModal() {
        const modal = document.getElementById('pattern-modal');
        const closeBtn = document.getElementsByClassName('close')[0];
        closeBtn.addEventListener('click', ()=> modal.style.display='none');
        window.addEventListener('click', e => { if (e.target === modal) modal.style.display='none'; });
    }

    updateGrids() {
        const instruments = ['drums','bass','chords','lead1','lead2'];
        instruments.forEach(inst => {
            const grid = document.getElementById(`${inst}-grid`); if (!grid) return; grid.innerHTML='';
            for (let bar=0; bar<this.bars; bar++) {
                const cell = document.createElement('div');
                cell.className = 'pattern-cell';
                cell.dataset.instrument = inst; cell.dataset.bar = bar;
                const label = document.createElement('span'); label.className='pattern-label'; cell.appendChild(label);
                const del = document.createElement('div'); del.className='pattern-delete'; del.textContent='×'; cell.appendChild(del);
                del.addEventListener('click', e => { e.stopPropagation(); this.deleteCell(inst, bar); });
                cell.addEventListener('click', e => { this.lastSelectedCell = cell; this.openPatternSelect(inst, bar, cell); });
                cell.addEventListener('dblclick', e => { e.preventDefault(); this.cyclePattern(inst, bar); });
                cell.addEventListener('contextmenu', e => { e.preventDefault(); this.deleteCell(inst, bar); });
                grid.appendChild(cell);
            }
        });
        this.updateTimelineRuler();
        this.refreshPatternCells();
    }

    refreshPatternCells() {
        Object.keys(this.activePatterns).forEach(key => {
            const [inst, bar] = key.split('_');
            const cell = document.querySelector(`.pattern-cell[data-instrument="${inst}"][data-bar="${bar}"]`);
            if (cell) {
                cell.classList.add('active');
                const label = cell.querySelector('.pattern-label');
                if (label) label.textContent = this.activePatterns[key].replace(/^(.*?)( - \d)?$/,'$1');
            }
        });
    }

    updateTimelineRuler() {
        const ruler = document.getElementById('timeline-ruler'); if (!ruler) return; ruler.innerHTML='';
        for (let bar=0; bar<this.bars; bar++) { const tick = document.createElement('div'); tick.className='timeline-tick'; tick.textContent=bar+1; ruler.appendChild(tick); }
    }

    deleteCell(instrument, bar) {
        const key = `${instrument}_${bar}`;
        delete this.activePatterns[key];
        const cell = document.querySelector(`.pattern-cell[data-instrument="${instrument}"][data-bar="${bar}"]`);
        if (cell) { cell.classList.remove('active'); const label = cell.querySelector('.pattern-label'); if (label) label.textContent=''; }
    }

    closePatternMenus() {
        document.querySelectorAll('.pattern-menu').forEach(m => m.parentElement && (m.parentElement.style.zIndex='', m.remove()));
    }

    openPatternSelect(instrument, bar, cell) {
        // store selection
        this.lastSelectedCell = cell;
        this.closePatternMenus(); // ensure only one open
        const existingMenu = cell.querySelector('.pattern-menu'); if (existingMenu) { existingMenu.remove(); return; }
        const menu = document.createElement('div'); menu.className='pattern-menu';
        Object.keys(this.patterns[instrument]).slice(0,12).forEach(name => {
            const opt = document.createElement('div');
            opt.textContent = name;
            opt.className = 'pattern-menu-item';
            opt.addEventListener('click', e=>{ e.stopPropagation(); this.activePatterns[`${instrument}_${bar}`]=name; cell.classList.add('active'); const label=cell.querySelector('.pattern-label'); if (label) label.textContent=name.replace(/^(.*?)( - \d)?$/,'$1'); this.closePatternMenus(); });
            menu.appendChild(opt);
        });
        const more = document.createElement('div'); more.textContent='More…'; more.className='pattern-menu-more'; more.addEventListener('click', e=>{ e.stopPropagation(); this.closePatternMenus(); this.showPatternModal(instrument, bar); }); menu.appendChild(more);
        cell.style.position='relative'; cell.style.zIndex='2000';
        cell.appendChild(menu);
    }

    showPatternModal(instrument, bar) {
        const modal = document.getElementById('pattern-modal');
        const title = document.getElementById('modal-title');
        const options = document.getElementById('pattern-options');
        title.textContent = `Select Pattern for ${instrument} - Bar ${bar+1}`;
        options.innerHTML='';
        Object.keys(this.patterns[instrument]).forEach(name => {
            const data = this.patterns[instrument][name];
            const div = document.createElement('div'); div.className='pattern-option';
            div.innerHTML = `<h4>${name}</h4><p>${data.description||''}</p>`;
            div.addEventListener('click', ()=>{ this.activePatterns[`${instrument}_${bar}`]=name; modal.style.display='none'; this.refreshPatternCells(); });
            options.appendChild(div);
        });
        modal.style.display='block';
    }

    play() {
        if (this.isPlaying) return;
        this.isPlaying = true; this.startTime = this.audioContext.currentTime; this.visualStart = performance.now(); this.lastStepPlayed=-1;
        document.getElementById('play-btn').textContent='⏸ Pause';
        this.animate();
    }

    stop() {
        if (!this.isPlaying) return; this.isPlaying=false; document.getElementById('play-btn').textContent='▶ Play';
        const indicator = document.getElementById('playback-indicator'); if (indicator) indicator.style.display='none';
        document.querySelectorAll('.pattern-cell.playing').forEach(c=>c.classList.remove('playing'));
    }

    animate() {
        if (!this.isPlaying) return;
        const nowAudio = this.audioContext.currentTime;
        const secondsPerBeat = 60 / this.tempo;
        const baseStepDur = secondsPerBeat / 4; // 16th
        const totalSteps = this.bars * this.stepsPerBar;
        const stepFloat = (nowAudio - this.startTime) / baseStepDur;
        const step = Math.floor(stepFloat) % totalSteps;
        if (step !== this.lastStepPlayed) {
            this.currentStep = step; this.currentBar = Math.floor(step / this.stepsPerBar); const stepInBar = step % this.stepsPerBar;
            document.querySelectorAll('.pattern-cell.playing').forEach(c=>c.classList.remove('playing'));
            const swingDelay = (stepInBar % 2 === 1) ? this.swing * baseStepDur * 0.5 : 0; // apply to off 32nd pair (visual remains straight)
            Object.keys(this.activePatterns).forEach(key => {
                const [inst, bar] = key.split('_'); const barNum = parseInt(bar);
                if (barNum === this.currentBar) {
                    const patternName = this.activePatterns[key];
                    if (swingDelay) {
                        setTimeout(()=> this.playPattern(inst, patternName, stepInBar), swingDelay*1000);
                    } else {
                        this.playPattern(inst, patternName, stepInBar);
                    }
                    const cell = document.querySelector(`.pattern-cell[data-instrument="${inst}"][data-bar="${bar}"]`);
                    if (cell) cell.classList.add('playing');
                }
            });
            if (this.metronomeEnabled) {
                const stepsPerBeat = this.stepsPerBar / 4; // 4 beats
                if (stepInBar % stepsPerBeat === 0) this.createMetronomeTick(stepInBar===0);
            }
            this.lastStepPlayed = step;
        }
        this.updatePlaybackIndicator(step / totalSteps);
        requestAnimationFrame(()=>this.animate());
    }

    updatePlaybackIndicator(ratio) {
        let ind = document.getElementById('playback-indicator');
        if (!ind) { ind = document.createElement('div'); ind.id='playback-indicator'; ind.className='playback-indicator'; document.querySelector('.tracks-container').appendChild(ind); }
        ind.style.display='block';
        const firstGrid = document.querySelector('.pattern-grid'); if (!firstGrid) return;
        const cellWidth = 68; // width + gap
        const left = 310 + ratio * (this.bars * cellWidth); // account for label width
        ind.style.left = left + 'px';
    }

    clearAll() { if (Object.keys(this.activePatterns).length && !confirm('Clear all patterns?')) return; this.stop(); this.activePatterns={}; document.querySelectorAll('.pattern-cell').forEach(c=>{ c.classList.remove('active','playing'); const l=c.querySelector('.pattern-label'); if (l) l.textContent=''; }); }

    saveSong() {
        const songName = document.getElementById('song-name').value.trim(); if (!songName) { alert('Enter song name'); return; }
        const songData = { version:1, name:songName, tempo:this.tempo, volume:this.volume, swing:this.swing, bars:this.bars, scale:this.scale, metronome:this.metronomeEnabled, patterns:{...this.activePatterns} };
        const saved = JSON.parse(localStorage.getItem('frutigerAeroSongs')||'{}'); saved[songName]=songData; localStorage.setItem('frutigerAeroSongs', JSON.stringify(saved)); this.loadSavedSongs(); document.getElementById('song-name').value=''; alert(`Song "${songName}" saved!`);
    }

    loadSong(songName) {
        const saved = JSON.parse(localStorage.getItem('frutigerAeroSongs')||'{}'); const data = saved[songName]; if (!data) return;
        this.stop(); Object.assign(this, { tempo:data.tempo, volume:data.volume, swing:data.swing, bars:data.bars, scale:data.scale }); this.activePatterns = {...data.patterns};
        this.metronomeEnabled = !!data.metronome; const met = document.getElementById('metronome'); if (met) met.checked = this.metronomeEnabled;
        document.getElementById('tempo').value=this.tempo; document.getElementById('tempo-value').textContent=this.tempo;
        document.getElementById('volume').value = Math.round(this.volume*100); document.getElementById('volume-value').textContent=`${Math.round(this.volume*100)}%`;
        document.getElementById('swing').value = Math.round(this.swing*100); document.getElementById('swing-value').textContent=`${Math.round(this.swing*100)}%`;
        document.getElementById('bars').value=this.bars; document.getElementById('scale').value=this.scale; this.masterGain.gain.value=this.volume; this.updateGrids();
    }

    deleteSong(name) { if (confirm(`Delete song "${name}"?`)) { const saved=JSON.parse(localStorage.getItem('frutigerAeroSongs')||'{}'); delete saved[name]; localStorage.setItem('frutigerAeroSongs', JSON.stringify(saved)); this.loadSavedSongs(); } }

    loadSavedSongs() { const saved=JSON.parse(localStorage.getItem('frutigerAeroSongs')||'{}'); const sel=document.getElementById('load-song'); sel.innerHTML='<option value="">Load saved song...</option>'; Object.keys(saved).forEach(n=>{ const o=document.createElement('option'); o.value=o.textContent=n; sel.appendChild(o); }); }

    setupTimelineClick() { const tc=document.querySelector('.tracks-container'); if (!tc) return; tc.addEventListener('click', e=> this.jumpToPosition(e)); }

    jumpToPosition(e) {
        if (!this.isPlaying) return; const rect = document.querySelector('.tracks-container').getBoundingClientRect(); const clickX = e.clientX - rect.left - 310; if (clickX<0) return; const cellWidth=68; const totalWidth=this.bars*cellWidth; if (clickX>totalWidth) return; const ratio = clickX / totalWidth; const totalSteps=this.bars*this.stepsPerBar; const targetStep=Math.floor(ratio*totalSteps); this.startTime = this.audioContext.currentTime - (targetStep * (60/this.tempo)/4); this.lastStepPlayed=-1; }
}

document.addEventListener('DOMContentLoaded', () => { window.beatMaker = new FrutigerAeroBeatMaker(); });