/**
 * Frutiger Aero Beat Maker
 * A Wii/DS-inspired browser-based beat maker with Web Audio API
 * Features: Pattern sequencer, audio synthesis, WAV export, undo/redo
 */

class FrutigerAeroBeatMaker {
  constructor() {
    // Audio Context
    this.audioContext = null;
    this.masterGain = null;
    this.reverb = null;
    this.reverbGain = null;
    this.delay = null;
    this.delayGain = null;
    
    // Playback State
    this.isPlaying = false;
    this.currentStep = 0;
    this.startTime = 0;
    this.lastStepPlayed = -1;
    this.animationId = null;
    
    // Settings
    this.tempo = 85;
    this.volume = 0.75;
    this.swing = 0.15;
    this.bars = 8;
    this.stepsPerBar = 32;
    this.scale = 'lydian';
    this.rootNote = 'C';
    this.metronomeEnabled = false;
    
    // Pattern State
    this.activePatterns = {};
    
    // DOM Cache for performance
    this.cellCache = new Map();
    this.playheadEl = null;
    this.trackContainerEl = null;
    this.lastHighlightedBar = -1;
    this.instrumentNodes = {};
    this.mutedTracks = new Set();
    this.soloTracks = new Set();
    
    // Undo/Redo
    this.undoStack = [];
    this.redoStack = [];
    this.maxUndoSteps = 50;
    
    // UI State
    this.selectedCell = null;
    this.previewEnabled = true;
    this.previewTimeout = null;
    
    // Track Definitions
    this.tracks = [
      { id: 'drums', name: 'Drums', icon: '🥁', color: '#48e6b0' },
      { id: 'bass', name: 'Bass', icon: '🎸', color: '#93d9ff' },
      { id: 'chords', name: 'Chords', icon: '🎹', color: '#b6ffa1' },
      { id: 'lead1', name: 'Lead 1', icon: '🎵', color: '#ffa9c6' },
      { id: 'lead2', name: 'Lead 2', icon: '🎶', color: '#fff082' }
    ];
    
    // Initialize
    this.initPatternLibrary();
    this.initAudio();
    this.initDOM();
    this.loadSavedSongs();
    this.bindKeyboardShortcuts();
  }

  // ========================================
  // PATTERN LIBRARY
  // ========================================
  
  initPatternLibrary() {
    // Pattern Design Philosophy:
    // - All patterns share rhythmic DNA: strong on beats 1 & 3 (steps 0, 8)
    // - Drums: kick on 1 & 3, snare/clap on 2 & 4, hats fill gaps
    // - Bass: locks with kick, approaches target on weak beats
    // - Chords: offbeat stabs or sustained pads, avoid clashing with bass
    // - Leads: melodic contour, fills space around chord hits
    // - Lead2/Echo: call-response, delayed echoes of lead1
    
    this.patterns = {
      drums: {
        // ===== CHILL FAMILY (Weather/Ambient) =====
        'Chill - 1': {
          description: 'Soft kick & rim, minimal',
          tier: 1,
          // Steps:  1 . . . 2 . . . 3 . . . 4 . . .
          rhythm: [0.7,0,0,0, 0.5,0,0,0, 0.65,0,0,0, 0.5,0,0,0]
        },
        'Chill - 2': {
          description: 'Adds gentle hat pulse',
          tier: 2,
          rhythm: [0.7,0,0.25,0, 0.55,0,0.2,0, 0.65,0,0.25,0, 0.55,0,0.2,0]
        },
        'Chill - 3': {
          description: 'Flowing ghost notes',
          tier: 3,
          rhythm: [0.75,0.15,0.3,0.15, 0.6,0.12,0.25,0.15, 0.7,0.15,0.3,0.12, 0.6,0.18,0.25,0.15]
        },
        // ===== BOUNCY FAMILY (Mii/Playful) =====
        'Bounce - 1': {
          description: 'Classic Mii-style bounce',
          tier: 1,
          rhythm: [0.85,0,0.4,0, 0.7,0,0.35,0, 0.8,0,0.4,0, 0.75,0,0.35,0]
        },
        'Bounce - 2': {
          description: 'Syncopated swing feel',
          tier: 2,
          rhythm: [0.85,0.2,0.45,0, 0.75,0.18,0.4,0, 0.8,0.2,0.45,0, 0.75,0.22,0.4,0]
        },
        'Bounce - 3': {
          description: 'Full groove with fills',
          tier: 3,
          rhythm: [0.9,0.25,0.5,0.2, 0.8,0.2,0.45,0.25, 0.85,0.25,0.5,0.2, 0.8,0.28,0.45,0.3]
        },
        // ===== BRIGHT FAMILY (Shopping/Upbeat) =====
        'Bright - 1': {
          description: 'Crisp four-on-floor feel',
          tier: 1,
          rhythm: [0.9,0,0.35,0, 0.8,0,0.35,0, 0.85,0,0.35,0, 0.85,0,0.35,0]
        },
        'Bright - 2': {
          description: 'Offbeat hat accents',
          tier: 2,
          rhythm: [0.9,0,0.4,0.2, 0.8,0,0.4,0.18, 0.85,0,0.4,0.2, 0.85,0,0.4,0.22]
        },
        'Bright - 3': {
          description: 'Energetic drive',
          tier: 3,
          rhythm: [0.95,0.2,0.5,0.25, 0.85,0.18,0.45,0.25, 0.9,0.2,0.5,0.25, 0.9,0.22,0.48,0.3]
        },
        // ===== CLASSIC PATTERNS =====
        'Four on Floor': {
          description: 'Steady quarter kick',
          tier: 1,
          rhythm: [0.85,0,0,0, 0.85,0,0,0, 0.85,0,0,0, 0.85,0,0,0]
        },
        'Backbeat': {
          description: 'Emphasis on 2 and 4',
          tier: 1,
          rhythm: [0.6,0,0,0, 0.9,0,0,0, 0.6,0,0,0, 0.9,0,0,0]
        },
        'Shuffle': {
          description: 'Triplet swing feel',
          tier: 2,
          rhythm: [0.8,0,0.4,0, 0.7,0,0.35,0, 0.8,0,0.4,0, 0.7,0,0.38,0]
        }
      },
      bass: {
        // ===== CHILL FAMILY =====
        'Chill Bass - 1': {
          description: 'Root notes, sparse',
          tier: 1,
          notes: ['C2','','','', 'G2','','','', 'F2','','','', 'G2','','',''],
          rhythm: [0.7,0,0,0, 0.5,0,0,0, 0.6,0,0,0, 0.5,0,0,0]
        },
        'Chill Bass - 2': {
          description: 'Fifth approaches',
          tier: 2,
          notes: ['C2','','G2','', 'E2','','','', 'F2','','C3','', 'G2','','',''],
          rhythm: [0.7,0,0.4,0, 0.5,0,0,0, 0.6,0,0.4,0, 0.55,0,0,0]
        },
        'Chill Bass - 3': {
          description: 'Gentle walking motion',
          tier: 3,
          notes: ['C2','D2','E2','', 'G2','','F2','', 'F2','G2','A2','', 'G2','','E2',''],
          rhythm: [0.7,0.3,0.4,0, 0.55,0,0.35,0, 0.65,0.3,0.4,0, 0.55,0,0.35,0]
        },
        // ===== BOUNCY FAMILY =====
        'Bounce Bass - 1': {
          description: 'Octave bounce',
          tier: 1,
          notes: ['C2','','C3','', 'G2','','','', 'F2','','F3','', 'G2','','',''],
          rhythm: [0.8,0,0.5,0, 0.6,0,0,0, 0.75,0,0.5,0, 0.6,0,0,0]
        },
        'Bounce Bass - 2': {
          description: 'Melodic fills',
          tier: 2,
          notes: ['C2','E2','G2','', 'A2','','G2','', 'F2','A2','C3','', 'G2','','F2',''],
          rhythm: [0.8,0.35,0.5,0, 0.6,0,0.4,0, 0.75,0.35,0.55,0, 0.6,0,0.4,0]
        },
        'Bounce Bass - 3': {
          description: 'Syncopated groove',
          tier: 3,
          notes: ['C2','E2','G2','C3', 'A2','G2','F2','E2', 'F2','A2','C3','A2', 'G2','F2','E2','D2'],
          rhythm: [0.8,0.35,0.55,0.4, 0.65,0.3,0.45,0.35, 0.75,0.35,0.55,0.4, 0.65,0.3,0.45,0.35]
        },
        // ===== BRIGHT FAMILY =====
        'Bright Bass - 1': {
          description: 'Punchy roots',
          tier: 1,
          notes: ['C2','','','', 'E2','','','', 'F2','','','', 'G2','','',''],
          rhythm: [0.85,0,0,0, 0.7,0,0,0, 0.8,0,0,0, 0.75,0,0,0]
        },
        'Bright Bass - 2': {
          description: 'Driving eighths',
          tier: 2,
          notes: ['C2','','G2','', 'E2','','B2','', 'F2','','C3','', 'G2','','D2',''],
          rhythm: [0.85,0,0.55,0, 0.7,0,0.5,0, 0.8,0,0.55,0, 0.75,0,0.5,0]
        },
        'Bright Bass - 3': {
          description: 'Active line',
          tier: 3,
          notes: ['C2','D2','E2','G2', 'E2','D2','C2','B1', 'F2','G2','A2','C3', 'G2','F2','E2','D2'],
          rhythm: [0.85,0.35,0.55,0.4, 0.7,0.3,0.5,0.35, 0.8,0.35,0.55,0.4, 0.75,0.3,0.5,0.35]
        },
        // ===== CLASSIC =====
        'Bubble': {
          description: 'Simple bubble pop',
          tier: 1,
          notes: ['C2','','G2','', 'C2','','F2','', 'C2','','G2','', 'C2','','E2',''],
          rhythm: [0.75,0,0.5,0, 0.7,0,0.45,0, 0.75,0,0.5,0, 0.7,0,0.45,0]
        },
        'Plaza': {
          description: 'Social gathering vibe',
          tier: 2,
          notes: ['E2','','B2','', 'A2','','E2','', 'D2','','A2','', 'G2','','D2',''],
          rhythm: [0.7,0,0.45,0, 0.65,0,0.4,0, 0.7,0,0.45,0, 0.65,0,0.4,0]
        }
      },
      chords: {
        // ===== CHILL FAMILY (sustained pads) =====
        'Chill Pad - 1': {
          description: 'Soft sustained pads',
          tier: 1,
          chords: [['C4','E4','G4'],[],[],[], ['F4','A4','C5'],[],[],[]],
          rhythm: [0.5,0,0,0, 0,0,0,0, 0.45,0,0,0, 0,0,0,0]
        },
        'Chill Pad - 2': {
          description: 'Two-chord swell',
          tier: 2,
          chords: [['C4','E4','G4','B4'],[],[],[], ['F4','A4','C5'],[],['G4','B4','D5'],[]],
          rhythm: [0.55,0,0,0, 0,0,0,0, 0.5,0,0.4,0, 0,0,0,0]
        },
        'Chill Pad - 3': {
          description: 'Extended voicings',
          tier: 3,
          chords: [['C4','E4','G4','B4'],[],['Am','C5','E5'],[], ['F4','A4','C5','E5'],[],['G4','B4','D5','F5'],[]],
          rhythm: [0.55,0,0.35,0, 0,0,0,0, 0.5,0,0.4,0, 0,0,0,0]
        },
        // ===== BOUNCY FAMILY (rhythmic stabs) =====
        'Bounce Stab - 1': {
          description: 'Offbeat chord stabs',
          tier: 1,
          chords: [[],['C4','E4','G4'],[],[],  [],['F4','A4','C5'],[],[]],
          rhythm: [0,0.55,0,0, 0,0,0,0, 0,0.5,0,0, 0,0,0,0]
        },
        'Bounce Stab - 2': {
          description: 'Syncopated hits',
          tier: 2,
          chords: [[],['C4','E4','G4'],[],['E4','G4','B4'],  [],['F4','A4','C5'],[],['G4','B4','D5']],
          rhythm: [0,0.55,0,0.4, 0,0,0,0, 0,0.5,0,0.45, 0,0,0,0]
        },
        'Bounce Stab - 3': {
          description: 'Full rhythm section',
          tier: 3,
          chords: [['C4','G4'],['E4','B4'],['G4','D5'],['C4','E4'],  ['F4','C5'],['A4','E5'],['C5','G5'],['F4','A4']],
          rhythm: [0.45,0.55,0.4,0.35, 0,0,0,0, 0.4,0.5,0.45,0.35, 0,0,0,0]
        },
        // ===== BRIGHT FAMILY =====
        'Bright Chord - 1': {
          description: 'Uplifting progression',
          tier: 1,
          chords: [['C4','E4','G4'],[],[],[],  ['G4','B4','D5'],[],[],[]],
          rhythm: [0.6,0,0,0, 0,0,0,0, 0.55,0,0,0, 0,0,0,0]
        },
        'Bright Chord - 2': {
          description: 'Added movement',
          tier: 2,
          chords: [['C4','E4','G4'],[],['E4','G4','B4'],[],  ['F4','A4','C5'],[],['G4','B4','D5'],[]],
          rhythm: [0.6,0,0.45,0, 0,0,0,0, 0.55,0,0.5,0, 0,0,0,0]
        },
        'Bright Chord - 3': {
          description: 'Rich voicings',
          tier: 3,
          chords: [['C4','E4','G4','B4'],['D4','F4','A4'],['E4','G4','B4'],['F4','A4','C5'],  ['G4','B4','D5'],['A4','C5','E5'],['B4','D5','F5'],['C5','E5','G5']],
          rhythm: [0.6,0.35,0.45,0.4, 0,0,0,0, 0.55,0.35,0.5,0.4, 0,0,0,0]
        },
        // ===== CLASSIC =====
        'Sky Pad': {
          description: 'Floating atmosphere',
          tier: 1,
          chords: [['C4','G4','E5'],[],[],[],  ['F4','C5','A5'],[],[],[]],
          rhythm: [0.5,0,0,0, 0,0,0,0, 0.45,0,0,0, 0,0,0,0]
        },
        'Sports': {
          description: 'Competition energy',
          tier: 2,
          chords: [['E4','G4','B4'],[],[],['A4','C5','E5'],  ['D4','F4','A4'],[],[],['G4','B4','D5']],
          rhythm: [0.6,0,0,0.45, 0,0,0,0, 0.55,0,0,0.5, 0,0,0,0]
        }
      },
      lead1: {
        // ===== CHILL FAMILY =====
        'Chill Lead - 1': {
          description: 'Sparse melodic notes',
          tier: 1,
          notes: ['E5','','','', 'G5','','','', 'A5','','','', 'G5','','',''],
          rhythm: [0.5,0,0,0, 0.45,0,0,0, 0.5,0,0,0, 0.4,0,0,0]
        },
        'Chill Lead - 2': {
          description: 'Gentle phrases',
          tier: 2,
          notes: ['E5','','G5','', 'A5','','G5','', 'C6','','A5','', 'G5','','E5',''],
          rhythm: [0.5,0,0.4,0, 0.5,0,0.35,0, 0.55,0,0.4,0, 0.45,0,0.35,0]
        },
        'Chill Lead - 3': {
          description: 'Flowing melody',
          tier: 3,
          notes: ['E5','G5','A5','G5', 'C6','B5','A5','G5', 'A5','C6','B5','A5', 'G5','E5','D5','E5'],
          rhythm: [0.5,0.3,0.45,0.3, 0.55,0.35,0.4,0.3, 0.5,0.4,0.35,0.3, 0.45,0.3,0.25,0.35]
        },
        // ===== BOUNCY FAMILY =====
        'Bounce Lead - 1': {
          description: 'Playful motif',
          tier: 1,
          notes: ['C5','','E5','', 'G5','','E5','', 'F5','','A5','', 'G5','','',''],
          rhythm: [0.55,0,0.45,0, 0.5,0,0.4,0, 0.5,0,0.5,0, 0.45,0,0,0]
        },
        'Bounce Lead - 2': {
          description: 'Ornamented melody',
          tier: 2,
          notes: ['C5','D5','E5','', 'G5','F5','E5','', 'F5','G5','A5','', 'G5','E5','D5',''],
          rhythm: [0.55,0.3,0.45,0, 0.55,0.3,0.4,0, 0.5,0.35,0.5,0, 0.5,0.35,0.3,0]
        },
        'Bounce Lead - 3': {
          description: 'Full melodic line',
          tier: 3,
          notes: ['C5','D5','E5','G5', 'A5','G5','F5','E5', 'F5','G5','A5','C6', 'B5','A5','G5','E5'],
          rhythm: [0.55,0.3,0.45,0.4, 0.55,0.35,0.4,0.3, 0.5,0.35,0.5,0.45, 0.5,0.35,0.4,0.3]
        },
        // ===== BRIGHT FAMILY =====
        'Bright Lead - 1': {
          description: 'Sparkling notes',
          tier: 1,
          notes: ['G5','','','', 'E5','','','', 'F5','','','', 'G5','','',''],
          rhythm: [0.6,0,0,0, 0.5,0,0,0, 0.55,0,0,0, 0.55,0,0,0]
        },
        'Bright Lead - 2': {
          description: 'Ascending phrases',
          tier: 2,
          notes: ['G5','','A5','', 'B5','','G5','', 'A5','','B5','', 'C6','','',''],
          rhythm: [0.6,0,0.5,0, 0.55,0,0.45,0, 0.55,0,0.5,0, 0.6,0,0,0]
        },
        'Bright Lead - 3': {
          description: 'Soaring melody',
          tier: 3,
          notes: ['G5','A5','B5','C6', 'B5','A5','G5','F5', 'A5','B5','C6','D6', 'C6','B5','A5','G5'],
          rhythm: [0.6,0.4,0.5,0.45, 0.55,0.35,0.45,0.35, 0.55,0.4,0.5,0.5, 0.55,0.4,0.45,0.35]
        },
        // ===== CLASSIC =====
        'Sparkle': {
          description: 'Twinkling melody',
          tier: 1,
          notes: ['C5','','G5','', 'E5','','','', 'F5','','C6','', 'G5','','',''],
          rhythm: [0.45,0,0.4,0, 0.4,0,0,0, 0.45,0,0.5,0, 0.4,0,0,0]
        },
        'Parade': {
          description: 'Celebratory march',
          tier: 2,
          notes: ['G5','','A5','', 'B5','','C6','', 'B5','','A5','', 'G5','','',''],
          rhythm: [0.55,0,0.45,0, 0.5,0,0.55,0, 0.5,0,0.45,0, 0.5,0,0,0]
        }
      },
      lead2: {
        // ===== CHILL FAMILY (delayed echoes) =====
        'Chill Echo - 1': {
          description: 'Soft delayed response',
          tier: 1,
          notes: ['','','E5','', '','','G5','', '','','A5','', '','','G5',''],
          rhythm: [0,0,0.35,0, 0,0,0.3,0, 0,0,0.35,0, 0,0,0.3,0]
        },
        'Chill Echo - 2': {
          description: 'Harmonic answers',
          tier: 2,
          notes: ['','','G5','E5', '','','B5','G5', '','','C6','A5', '','','B5','G5'],
          rhythm: [0,0,0.35,0.25, 0,0,0.35,0.25, 0,0,0.4,0.3, 0,0,0.35,0.25]
        },
        'Chill Echo - 3': {
          description: 'Woven counterpoint',
          tier: 3,
          notes: ['','G5','','A5', 'B5','','G5','', '','A5','','B5', 'C6','','A5',''],
          rhythm: [0,0.3,0,0.35, 0.4,0,0.3,0, 0,0.35,0,0.4, 0.45,0,0.35,0]
        },
        // ===== BOUNCY FAMILY =====
        'Bounce Echo - 1': {
          description: 'Playful responses',
          tier: 1,
          notes: ['','E5','','', '','G5','','', '','A5','','', '','G5','',''],
          rhythm: [0,0.4,0,0, 0,0.35,0,0, 0,0.4,0,0, 0,0.35,0,0]
        },
        'Bounce Echo - 2': {
          description: 'Call and response',
          tier: 2,
          notes: ['','E5','','G5', '','G5','','A5', '','A5','','C6', '','G5','','E5'],
          rhythm: [0,0.4,0,0.35, 0,0.4,0,0.35, 0,0.45,0,0.4, 0,0.4,0,0.3]
        },
        'Bounce Echo - 3': {
          description: 'Active countermelody',
          tier: 3,
          notes: ['E5','','G5','', 'A5','','G5','E5', 'F5','','A5','', 'G5','','E5','D5'],
          rhythm: [0.4,0,0.35,0, 0.45,0,0.35,0.3, 0.4,0,0.4,0, 0.45,0,0.35,0.3]
        },
        // ===== BRIGHT FAMILY =====
        'Bright Echo - 1': {
          description: 'Shimmering answer',
          tier: 1,
          notes: ['','','','G5', '','','','E5', '','','','F5', '','','','G5'],
          rhythm: [0,0,0,0.45, 0,0,0,0.4, 0,0,0,0.45, 0,0,0,0.45]
        },
        'Bright Echo - 2': {
          description: 'Ascending echoes',
          tier: 2,
          notes: ['','','G5','', '','','A5','', '','','B5','', '','','C6',''],
          rhythm: [0,0,0.45,0, 0,0,0.4,0, 0,0,0.45,0, 0,0,0.5,0]
        },
        'Bright Echo - 3': {
          description: 'Interlocking melody',
          tier: 3,
          notes: ['','B5','','D6', 'C6','','A5','', '','C6','','E6', 'D6','','B5',''],
          rhythm: [0,0.4,0,0.45, 0.5,0,0.4,0, 0,0.45,0,0.5, 0.55,0,0.45,0]
        },
        // ===== CLASSIC =====
        'Dream Echo': {
          description: 'Dreamy response',
          tier: 1,
          notes: ['','C5','','', '','E5','','', '','G5','','', '','E5','',''],
          rhythm: [0,0.35,0,0, 0,0.3,0,0, 0,0.4,0,0, 0,0.3,0,0]
        },
        'Adventure': {
          description: 'Epic call-back',
          tier: 2,
          notes: ['','','D5','', '','','G5','', '','','B5','', '','','D6',''],
          rhythm: [0,0,0.45,0, 0,0,0.4,0, 0,0,0.5,0, 0,0,0.55,0]
        }
      }
    };
    
    // Expand patterns to 32 steps
    this.expandPatterns();
    this.computePatternStats();
  }

  expandPatterns() {
    Object.keys(this.patterns).forEach(inst => {
      Object.values(this.patterns[inst]).forEach(p => {
        // Drums: expand 16 -> 32 with echo
        if (p.rhythm && p.rhythm.length === 16 && !p.notes && !p.chords) {
          const out = [];
          p.rhythm.forEach(v => {
            out.push(v);
            out.push(v > 0.5 ? v * 0.3 : 0);
          });
          p.rhythm = out;
        }
        // Bass/Lead note patterns
        if (p.notes && p.rhythm && p.notes.length === 16 && p.rhythm.length === 16) {
          const newNotes = [], newRhythm = [];
          for (let i = 0; i < 16; i++) {
            const n = p.notes[i], r = p.rhythm[i];
            newNotes.push(n);
            newRhythm.push(r);
            if (r > 0.65 && n) {
              newNotes.push(n);
              newRhythm.push(r * 0.25);
            } else {
              newNotes.push('');
              newRhythm.push(0);
            }
          }
          p.notes = newNotes;
          p.rhythm = newRhythm;
        }
        // Chord patterns: keep 8 chords, stretch rhythm
        if (p.chords && p.rhythm && p.rhythm.length === 16) {
          const stretched = [];
          p.rhythm.forEach(v => { stretched.push(v); stretched.push(0); });
          p.rhythm = stretched;
        }
      });
    });
  }

  computePatternStats() {
    this.patternStats = {};
    Object.keys(this.patterns).forEach(inst => {
      this.patternStats[inst] = {};
      Object.entries(this.patterns[inst]).forEach(([name, pattern]) => {
        const rhythm = pattern.rhythm || [];
        const hitCount = rhythm.reduce((acc, v) => acc + (v > 0 ? 1 : 0), 0);
        const density = rhythm.length ? rhythm.reduce((acc, v) => acc + v, 0) / rhythm.length : 0;
        this.patternStats[inst][name] = {
          hitCount,
          density,
          tier: pattern.tier || 1
        };
      });
    });
  }

  getPatternStats(instrument, patternName) {
    return this.patternStats?.[instrument]?.[patternName] || { hitCount: 0, density: 0, tier: 1 };
  }

  getSwingDelay(instrument, patternName, stepInBar, stepDuration) {
    if (stepInBar % 2 !== 1) return 0;
    const swingMultiplier = {
      drums: 1,
      bass: 0.4,
      chords: 0,
      lead1: 0.6,
      lead2: 0.6
    };
    let multiplier = swingMultiplier[instrument] ?? 0.5;
    if (/shuffle|swing/i.test(patternName)) {
      multiplier *= 0.35;
    }
    return this.swing * stepDuration * multiplier;
  }

  // ========================================
  // AUDIO ENGINE
  // ========================================

  initAudio() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Master Gain
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = this.volume;
    this.masterGain.connect(this.audioContext.destination);
    
    // Reverb
    this.reverb = this.audioContext.createConvolver();
    this.reverb.buffer = this.generateImpulseResponse(2.5, 2.2);
    this.reverbGain = this.audioContext.createGain();
    this.reverbGain.gain.value = 0.25;
    this.reverb.connect(this.reverbGain).connect(this.masterGain);
    
    // Delay
    this.delay = this.audioContext.createDelay(2.0);
    this.delay.delayTime.value = 0.3;
    this.delayFeedback = this.audioContext.createGain();
    this.delayFeedback.gain.value = 0.3;
    this.delayFilter = this.audioContext.createBiquadFilter();
    this.delayFilter.type = 'lowpass';
    this.delayFilter.frequency.value = 3500;
    this.delayGain = this.audioContext.createGain();
    this.delayGain.gain.value = 0.25;
    this.delay.connect(this.delayFilter).connect(this.delayFeedback).connect(this.delay);
    this.delay.connect(this.delayGain).connect(this.masterGain);
    
    // Noise buffer for percussion
    this.noiseBuffer = this.generateNoiseBuffer();
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

  generateNoiseBuffer() {
    const length = this.audioContext.sampleRate * 1.5;
    const buffer = this.audioContext.createBuffer(1, length, this.audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  getInstrumentNodes(instrument) {
    if (!this.instrumentNodes[instrument]) {
      const dry = this.audioContext.createGain();
      dry.gain.value = 1;
      dry.connect(this.masterGain);
      
      const revSend = this.audioContext.createGain();
      revSend.gain.value = 0.2;
      revSend.connect(this.reverb);
      
      const delSend = this.audioContext.createGain();
      delSend.gain.value = 0.15;
      delSend.connect(this.delay);
      
      this.instrumentNodes[instrument] = { dry, revSend, delSend };
    }
    return this.instrumentNodes[instrument];
  }

  noteToFrequency(note) {
    if (!note) return 0;
    const frequencies = {
      'C': 261.63, 'C#': 277.18, 'D': 293.66, 'D#': 311.13,
      'E': 329.63, 'F': 349.23, 'F#': 369.99, 'G': 392.00,
      'G#': 415.30, 'A': 440.00, 'A#': 466.16, 'B': 493.88
    };
    const match = note.match(/([A-G]#?)(\d)/);
    if (!match) return 440;
    const [, noteName, octave] = match;
    return frequencies[noteName] * Math.pow(2, parseInt(octave) - 4);
  }

  // Synthesis methods
  playDrumHit(time, velocity = 1) {
    const ctx = this.audioContext;
    const nodes = this.getInstrumentNodes('drums');
    
    // Kick
    const kickOsc = ctx.createOscillator();
    const kickGain = ctx.createGain();
    kickOsc.type = 'sine';
    kickOsc.frequency.setValueAtTime(150, time);
    kickOsc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    kickGain.gain.setValueAtTime(0.0001, time);
    kickGain.gain.exponentialRampToValueAtTime(velocity * 0.8, time + 0.005);
    kickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);
    kickOsc.connect(kickGain).connect(nodes.dry);
    kickGain.connect(nodes.revSend);
    kickOsc.start(time);
    kickOsc.stop(time + 0.3);
    
    // Snare (on accents)
    if (velocity > 0.6) {
      const snareNoise = ctx.createBufferSource();
      snareNoise.buffer = this.noiseBuffer;
      const snareFilter = ctx.createBiquadFilter();
      snareFilter.type = 'bandpass';
      snareFilter.frequency.value = 1800;
      snareFilter.Q.value = 0.7;
      const snareGain = ctx.createGain();
      snareGain.gain.setValueAtTime(0.0001, time);
      snareGain.gain.exponentialRampToValueAtTime(velocity * 0.5, time + 0.003);
      snareGain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
      snareNoise.connect(snareFilter).connect(snareGain).connect(nodes.dry);
      snareGain.connect(nodes.revSend);
      snareNoise.start(time);
      snareNoise.stop(time + 0.2);
    }
    
    // Hi-hat (on lighter hits)
    if (velocity > 0.2 && velocity <= 0.6) {
      const hhNoise = ctx.createBufferSource();
      hhNoise.buffer = this.noiseBuffer;
      const hhFilter = ctx.createBiquadFilter();
      hhFilter.type = 'highpass';
      hhFilter.frequency.value = 7000;
      const hhGain = ctx.createGain();
      hhGain.gain.setValueAtTime(0.0001, time);
      hhGain.gain.exponentialRampToValueAtTime(velocity * 0.35, time + 0.002);
      hhGain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
      hhNoise.connect(hhFilter).connect(hhGain).connect(nodes.dry);
      hhNoise.start(time);
      hhNoise.stop(time + 0.1);
    }
  }

  playBassNote(time, note, velocity = 0.8) {
    if (!note) return;
    const ctx = this.audioContext;
    const nodes = this.getInstrumentNodes('bass');
    const freq = this.noteToFrequency(note);
    
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);
    
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(velocity * 0.5, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);
    
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 4, time);
    
    osc.connect(filter).connect(gain);
    gain.connect(nodes.dry);
    gain.connect(nodes.revSend);
    
    osc.start(time);
    osc.stop(time + 0.3);
  }

  playChord(time, notes, velocity = 0.6) {
    if (!notes || notes.length === 0) return;
    const ctx = this.audioContext;
    const nodes = this.getInstrumentNodes('chords');
    
    notes.forEach((note, i) => {
      if (!note) return;
      const freq = this.noteToFrequency(note);
      
      // Main oscillator
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);
      
      // Detuned second voice
      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(freq * 1.003, time);
      
      const gain = ctx.createGain();
      const noteVel = velocity * 0.28 * (1 - i * 0.04);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(noteVel, time + 0.03);       // Attack: 30ms
      gain.gain.linearRampToValueAtTime(noteVel * 0.75, time + 0.15); // Decay to 75%
      gain.gain.linearRampToValueAtTime(noteVel * 0.65, time + 1.4);  // Sustain plateau
      gain.gain.exponentialRampToValueAtTime(0.001, time + 2.2);      // Release
      
      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(nodes.dry);
      gain.connect(nodes.revSend);
      gain.connect(nodes.delSend);
      
      osc.start(time);
      osc.stop(time + 2.3);
      osc2.start(time);
      osc2.stop(time + 2.3);
    });
  }

  playLead(time, note, velocity = 0.7, instrument = 'lead1') {
    if (!note) return;
    const ctx = this.audioContext;
    const nodes = this.getInstrumentNodes(instrument);
    const freq = this.noteToFrequency(note);
    
    const osc = ctx.createOscillator();
    osc.type = instrument === 'lead1' ? 'triangle' : 'square';
    osc.frequency.setValueAtTime(freq, time);
    
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(velocity * 0.4, time + 0.005);
    gain.gain.linearRampToValueAtTime(velocity * 0.2, time + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
    
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 5, time);
    
    osc.connect(filter).connect(gain);
    gain.connect(nodes.dry);
    gain.connect(nodes.revSend);
    gain.connect(nodes.delSend);
    
    osc.start(time);
    osc.stop(time + 0.35);
  }

  playMetronomeTick(time, downbeat = false) {
    const ctx = this.audioContext;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = downbeat ? 1000 : 800;
    
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(downbeat ? 0.3 : 0.15, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    
    osc.connect(gain).connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  // ========================================
  // PLAYBACK
  // ========================================

  play() {
    if (this.isPlaying) return;
    
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    
    this.isPlaying = true;
    this.startTime = this.audioContext.currentTime;
    this.lastStepPlayed = -1;
    
    document.getElementById('play-btn').classList.add('playing');
    document.getElementById('play-btn').querySelector('.label').textContent = 'Pause';
    document.getElementById('playhead').classList.add('visible');
    
    this.animate();
  }

  stop() {
    if (!this.isPlaying) return;
    
    this.isPlaying = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    
    document.getElementById('play-btn').classList.remove('playing');
    document.getElementById('play-btn').querySelector('.label').textContent = 'Play';
    document.getElementById('playhead').classList.remove('visible');
    
    // Clear playing states and reset tracking
    this.lastHighlightedBar = -1;
    this.tracks.forEach(track => {
      for (let bar = 0; bar < this.bars; bar++) {
        const cell = this.cellCache.get(`${track.id}_${bar}`);
        if (cell) cell.classList.remove('playing');
      }
    });
  }

  toggle() {
    this.isPlaying ? this.stop() : this.play();
  }

  animate() {
    if (!this.isPlaying) return;
    
    const now = this.audioContext.currentTime;
    const secondsPerBeat = 60 / this.tempo;
    const stepDuration = secondsPerBeat / 8; // 32nd note
    const totalSteps = this.bars * this.stepsPerBar;
    
    const elapsed = now - this.startTime;
    const stepFloat = elapsed / stepDuration;
    const step = Math.floor(stepFloat) % totalSteps;
    
    // Schedule audio
    if (step !== this.lastStepPlayed) {
      this.currentStep = step;
      const currentBar = Math.floor(step / this.stepsPerBar);
      const stepInBar = step % this.stepsPerBar;
      
      const baseTime = now;

      // Play patterns
      Object.keys(this.activePatterns).forEach(key => {
        const [inst, bar] = key.split('_');
        if (parseInt(bar) !== currentBar) return;
        if (this.isTrackMuted(inst)) return;
        
        const patternName = this.activePatterns[key];
        const swingDelay = this.getSwingDelay(inst, patternName, stepInBar, stepDuration);
        this.playPatternStep(inst, patternName, stepInBar, baseTime + swingDelay);
      });
      
      // Metronome
      if (this.metronomeEnabled) {
        const beatsPerBar = 4;
        const stepsPerBeat = this.stepsPerBar / beatsPerBar;
        if (stepInBar % stepsPerBeat === 0) {
          this.playMetronomeTick(baseTime, stepInBar === 0);
        }
      }
      
      // Update playhead position (every step)
      this.updatePlayhead(step / totalSteps);
      
      // Only update cell highlighting when bar changes (performance optimization)
      if (currentBar !== this.lastHighlightedBar) {
        this.highlightPlayingCells(currentBar);
        this.lastHighlightedBar = currentBar;
      }
      
      this.lastStepPlayed = step;
    }
    
    this.animationId = requestAnimationFrame(() => this.animate());
  }

  playPatternStep(instrument, patternName, stepInBar, time) {
    const pattern = this.patterns[instrument]?.[patternName];
    if (!pattern) return;
    
    const rhythm = pattern.rhythm?.[stepInBar] || 0;
    if (rhythm <= 0) return;
    
    switch (instrument) {
      case 'drums':
        this.playDrumHit(time, rhythm);
        break;
      case 'bass':
        const bassNote = pattern.notes?.[stepInBar];
        if (bassNote) this.playBassNote(time, bassNote, rhythm);
        break;
      case 'chords':
        const chordIndex = Math.floor(stepInBar / 4) % (pattern.chords?.length || 1);
        const chord = pattern.chords?.[chordIndex];
        if (chord && chord.length > 0) this.playChord(time, chord, rhythm);
        break;
      case 'lead1':
        const lead1Note = pattern.notes?.[stepInBar];
        if (lead1Note) this.playLead(time, lead1Note, rhythm, 'lead1');
        break;
      case 'lead2':
        const lead2Note = pattern.notes?.[stepInBar];
        if (lead2Note) this.playLead(time, lead2Note, rhythm, 'lead2');
        break;
    }
  }

  isTrackMuted(trackId) {
    if (this.soloTracks.size > 0) {
      return !this.soloTracks.has(trackId);
    }
    return this.mutedTracks.has(trackId);
  }

  updatePlayhead(progress) {
    // Use cached elements for performance
    if (!this.playheadEl) {
      this.playheadEl = document.getElementById('playhead');
      this.trackContainerEl = document.getElementById('tracks-container');
    }
    if (!this.playheadEl || !this.trackContainerEl) return;
    
    // Cache layout measurements (they don't change during playback)
    if (!this.playheadLayoutCache) {
      const cells = this.trackContainerEl.querySelector('.pattern-cells');
      const trackLabel = this.trackContainerEl.querySelector('.track-label');
      if (!cells) return;
      this.playheadLayoutCache = {
        labelWidth: trackLabel ? trackLabel.offsetWidth + 8 : 160,
        cellsWidth: cells.scrollWidth
      };
    }
    
    const { labelWidth, cellsWidth } = this.playheadLayoutCache;
    // Use transform for GPU acceleration (avoids layout thrashing)
    this.playheadEl.style.transform = `translateX(${labelWidth + progress * cellsWidth}px)`;
  }

  highlightPlayingCells(currentBar) {
    // Use cached cell references for O(1) access
    // Clear previous highlights
    if (this.lastHighlightedBar >= 0) {
      this.tracks.forEach(track => {
        const key = `${track.id}_${this.lastHighlightedBar}`;
        const cell = this.cellCache.get(key);
        if (cell) cell.classList.remove('playing');
      });
    }
    
    // Add new highlights only for cells with active patterns
    Object.keys(this.activePatterns).forEach(key => {
      const [inst, bar] = key.split('_');
      if (parseInt(bar) === currentBar) {
        const cell = this.cellCache.get(key);
        if (cell) cell.classList.add('playing');
      }
    });
  }

  // ========================================
  // PATTERN PREVIEW
  // ========================================

  previewPattern(instrument, patternName) {
    if (!this.previewEnabled) return;
    
    const pattern = this.patterns[instrument]?.[patternName];
    if (!pattern) return;
    
    // Play a quick 4-step preview
    const now = this.audioContext.currentTime;
    const stepDur = 0.15;
    
    for (let i = 0; i < 8; i += 2) {
      this.playPatternStep(instrument, patternName, i, now + (i / 2) * stepDur);
    }
  }

  // ========================================
  // WAV EXPORT
  // ========================================

  async exportWAV() {
    const modal = document.getElementById('export-modal');
    modal.classList.add('open');
    
    const progressEl = document.getElementById('export-progress');
    const statusEl = document.getElementById('export-status');
    
    try {
      statusEl.textContent = 'Preparing audio context...';
      progressEl.style.width = '5%';
      
      const sampleRate = 44100;
      const totalSteps = this.bars * this.stepsPerBar;
      const secondsPerBeat = 60 / this.tempo;
      const stepDuration = secondsPerBeat / 8;
      const duration = totalSteps * stepDuration + 2; // Extra tail for reverb
      
      const offlineCtx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);
      
      // Create offline audio graph
      const masterGain = offlineCtx.createGain();
      masterGain.gain.value = this.volume;
      masterGain.connect(offlineCtx.destination);
      
      // Simple reverb for offline
      const reverbGain = offlineCtx.createGain();
      reverbGain.gain.value = 0.15;
      reverbGain.connect(masterGain);
      
      statusEl.textContent = 'Rendering patterns...';
      progressEl.style.width = '20%';
      
      // Schedule all notes
      for (let step = 0; step < totalSteps; step++) {
        const currentBar = Math.floor(step / this.stepsPerBar);
        const stepInBar = step % this.stepsPerBar;
        const baseTime = step * stepDuration;
        
        Object.keys(this.activePatterns).forEach(key => {
          const [inst, bar] = key.split('_');
          if (parseInt(bar) !== currentBar) return;
          if (this.isTrackMuted(inst)) return;
          
          const patternName = this.activePatterns[key];
          const pattern = this.patterns[inst]?.[patternName];
          if (!pattern) return;
          
          const rhythm = pattern.rhythm?.[stepInBar] || 0;
          if (rhythm <= 0) return;
          
          // Create notes for offline context
          const swingDelay = this.getSwingDelay(inst, patternName, stepInBar, stepDuration);
          this.scheduleOfflineNote(offlineCtx, masterGain, inst, pattern, stepInBar, baseTime + swingDelay, rhythm);
        });
        
        // Update progress
        if (step % 32 === 0) {
          progressEl.style.width = `${20 + (step / totalSteps) * 50}%`;
        }
      }
      
      statusEl.textContent = 'Rendering audio buffer...';
      progressEl.style.width = '75%';
      
      const renderedBuffer = await offlineCtx.startRendering();
      
      statusEl.textContent = 'Encoding WAV file...';
      progressEl.style.width = '90%';
      
      const wavBlob = this.bufferToWav(renderedBuffer);
      
      statusEl.textContent = 'Downloading...';
      progressEl.style.width = '100%';
      
      // Download
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `frutiger-aero-${Date.now()}.wav`;
      a.click();
      URL.revokeObjectURL(url);
      
      setTimeout(() => {
        modal.classList.remove('open');
        this.showToast('WAV exported successfully!', 'success');
      }, 500);
      
    } catch (error) {
      console.error('Export error:', error);
      statusEl.textContent = 'Export failed: ' + error.message;
      setTimeout(() => modal.classList.remove('open'), 2000);
      this.showToast('Export failed', 'error');
    }
  }

  scheduleOfflineNote(ctx, output, instrument, pattern, stepInBar, time, velocity) {
    switch (instrument) {
      case 'drums': {
        // Kick
        const kickOsc = ctx.createOscillator();
        const kickGain = ctx.createGain();
        kickOsc.type = 'sine';
        kickOsc.frequency.setValueAtTime(150, time);
        kickOsc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
        kickGain.gain.setValueAtTime(0.0001, time);
        kickGain.gain.exponentialRampToValueAtTime(velocity * 0.6, time + 0.005);
        kickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);
        kickOsc.connect(kickGain).connect(output);
        kickOsc.start(time);
        kickOsc.stop(time + 0.3);
        break;
      }
      case 'bass': {
        const note = pattern.notes?.[stepInBar];
        if (!note) return;
        const freq = this.noteToFrequency(note);
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, time);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(velocity * 0.4, time + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);
        osc.connect(gain).connect(output);
        osc.start(time);
        osc.stop(time + 0.3);
        break;
      }
      case 'chords': {
        const chordIndex = Math.floor(stepInBar / 4) % (pattern.chords?.length || 1);
        const chord = pattern.chords?.[chordIndex];
        if (!chord || chord.length === 0) return;
        chord.forEach(note => {
          if (!note) return;
          const freq = this.noteToFrequency(note);
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, time);
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(velocity * 0.15, time + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
          osc.connect(gain).connect(output);
          osc.start(time);
          osc.stop(time + 0.6);
        });
        break;
      }
      case 'lead1':
      case 'lead2': {
        const note = pattern.notes?.[stepInBar];
        if (!note) return;
        const freq = this.noteToFrequency(note);
        const osc = ctx.createOscillator();
        osc.type = instrument === 'lead1' ? 'triangle' : 'square';
        osc.frequency.setValueAtTime(freq, time);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(velocity * 0.3, time + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);
        osc.connect(gain).connect(output);
        osc.start(time);
        osc.stop(time + 0.3);
        break;
      }
    }
  }

  bufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    
    const dataLength = buffer.length * blockAlign;
    const bufferLength = 44 + dataLength;
    
    const arrayBuffer = new ArrayBuffer(bufferLength);
    const view = new DataView(arrayBuffer);
    
    // WAV header
    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, bufferLength - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);
    
    // Interleave samples
    const channels = [];
    for (let i = 0; i < numChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }
    
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, int16, true);
        offset += 2;
      }
    }
    
    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  // ========================================
  // UNDO/REDO
  // ========================================

  saveState() {
    const state = {
      activePatterns: { ...this.activePatterns },
      tempo: this.tempo,
      volume: this.volume,
      swing: this.swing,
      bars: this.bars,
      scale: this.scale,
      rootNote: this.rootNote
    };
    
    this.undoStack.push(JSON.stringify(state));
    if (this.undoStack.length > this.maxUndoSteps) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.updateUndoButtons();
  }

  undo() {
    if (this.undoStack.length === 0) return;
    
    // Save current state to redo stack
    const current = {
      activePatterns: { ...this.activePatterns },
      tempo: this.tempo,
      volume: this.volume,
      swing: this.swing,
      bars: this.bars,
      scale: this.scale,
      rootNote: this.rootNote
    };
    this.redoStack.push(JSON.stringify(current));
    
    // Restore previous state
    const prev = JSON.parse(this.undoStack.pop());
    this.restoreState(prev);
    this.updateUndoButtons();
    this.showToast('Undo', 'info');
  }

  redo() {
    if (this.redoStack.length === 0) return;
    
    // Save current to undo
    const current = {
      activePatterns: { ...this.activePatterns },
      tempo: this.tempo,
      volume: this.volume,
      swing: this.swing,
      bars: this.bars,
      scale: this.scale,
      rootNote: this.rootNote
    };
    this.undoStack.push(JSON.stringify(current));
    
    // Restore redo state
    const next = JSON.parse(this.redoStack.pop());
    this.restoreState(next);
    this.updateUndoButtons();
    this.showToast('Redo', 'info');
  }

  restoreState(state) {
    this.activePatterns = state.activePatterns;
    this.tempo = state.tempo;
    this.volume = state.volume;
    this.swing = state.swing;
    this.bars = state.bars;
    this.scale = state.scale;
    this.rootNote = state.rootNote;
    
    // Update UI
    document.getElementById('tempo').value = this.tempo;
    document.getElementById('tempo-display').textContent = this.tempo;
    document.getElementById('volume').value = Math.round(this.volume * 100);
    document.getElementById('volume-value').textContent = `${Math.round(this.volume * 100)}%`;
    document.getElementById('swing').value = Math.round(this.swing * 100);
    document.getElementById('swing-value').textContent = `${Math.round(this.swing * 100)}%`;
    document.getElementById('bars').value = this.bars;
    document.getElementById('scale').value = this.scale;
    document.getElementById('key-root').value = this.rootNote;
    
    this.masterGain.gain.value = this.volume;
    this.buildGrid();
  }

  updateUndoButtons() {
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    if (undoBtn) undoBtn.disabled = this.undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = this.redoStack.length === 0;
  }

  // ========================================
  // DOM & UI
  // ========================================

  initDOM() {
    this.buildGrid();
    this.buildEffectsPanel();
    this.bindEvents();
    this.updateUndoButtons();
  }

  buildGrid() {
    const container = document.getElementById('tracks-container');
    const header = document.getElementById('grid-header');
    if (!container || !header) return;
    
    container.innerHTML = '';
    
    // Clear caches when rebuilding grid
    this.cellCache.clear();
    this.playheadLayoutCache = null;
    this.lastHighlightedBar = -1;
    
    // Build header with bar numbers
    header.innerHTML = '<div class="track-label-spacer"></div>';
    for (let i = 0; i < this.bars; i++) {
      const barNum = document.createElement('div');
      barNum.className = 'bar-number';
      barNum.textContent = i + 1;
      header.appendChild(barNum);
    }
    
    // Build track rows
    this.tracks.forEach(track => {
      const row = document.createElement('div');
      row.className = 'track-row';
      row.dataset.track = track.id;
      
      // Track label
      const label = document.createElement('div');
      label.className = 'track-label';
      label.innerHTML = `
        <div class="track-color" style="background: ${track.color}"></div>
        <div class="track-info">
          <div class="track-name">${track.icon} ${track.name}</div>
          <div class="track-controls">
            <button class="track-btn mute" data-track="${track.id}" title="Mute">M</button>
            <button class="track-btn solo" data-track="${track.id}" title="Solo">S</button>
          </div>
        </div>
      `;
      row.appendChild(label);
      
      // Pattern cells
      const cells = document.createElement('div');
      cells.className = 'pattern-cells';
      
      for (let bar = 0; bar < this.bars; bar++) {
        const cell = document.createElement('div');
        cell.className = 'pattern-cell';
        cell.dataset.instrument = track.id;
        cell.dataset.bar = bar;
        cell.tabIndex = 0;
        cell.setAttribute('role', 'gridcell');
        cell.setAttribute('aria-label', `${track.name} bar ${bar + 1}`);
        
        const patternKey = `${track.id}_${bar}`;
        const activePattern = this.activePatterns[patternKey];
        
        if (activePattern) {
          cell.classList.add('active');
          const labelSpan = document.createElement('span');
          labelSpan.className = 'pattern-label';
          labelSpan.textContent = this.formatPatternName(activePattern);
          cell.appendChild(labelSpan);
          
          const deleteBtn = document.createElement('div');
          deleteBtn.className = 'pattern-delete';
          deleteBtn.textContent = '×';
          cell.appendChild(deleteBtn);
        }
        
        // Cache cell reference for O(1) lookup during playback
        this.cellCache.set(patternKey, cell);
        
        cells.appendChild(cell);
      }
      
      row.appendChild(cells);
      container.appendChild(row);
    });
  }

  formatPatternName(name) {
    // Shorten pattern names for display
    return name.replace(/ - \d$/, '').substring(0, 12);
  }

  buildEffectsPanel() {
    const grid = document.getElementById('effects-grid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    this.tracks.forEach(track => {
      const div = document.createElement('div');
      div.className = 'effect-track';
      div.style.borderLeftColor = track.color;
      div.innerHTML = `
        <div class="effect-track-name">${track.icon} ${track.name}</div>
        <div class="effect-controls">
          <div class="effect-row">
            <label>Vol</label>
            <input type="range" class="slider" min="0" max="100" value="80" data-track="${track.id}" data-param="volume">
          </div>
          <div class="effect-row">
            <label>Reverb</label>
            <input type="range" class="slider" min="0" max="100" value="20" data-track="${track.id}" data-param="reverb">
          </div>
          <div class="effect-row">
            <label>Delay</label>
            <input type="range" class="slider" min="0" max="100" value="15" data-track="${track.id}" data-param="delay">
          </div>
        </div>
      `;
      grid.appendChild(div);
    });
  }

  bindEvents() {
    // Transport
    document.getElementById('play-btn')?.addEventListener('click', () => this.toggle());
    document.getElementById('stop-btn')?.addEventListener('click', () => this.stop());
    
    // Controls
    document.getElementById('tempo')?.addEventListener('input', e => {
      this.tempo = parseInt(e.target.value);
      document.getElementById('tempo-display').textContent = this.tempo;
    });
    
    document.getElementById('volume')?.addEventListener('input', e => {
      this.volume = parseInt(e.target.value) / 100;
      document.getElementById('volume-value').textContent = `${e.target.value}%`;
      this.masterGain.gain.value = this.volume;
    });
    
    document.getElementById('swing')?.addEventListener('input', e => {
      this.swing = parseInt(e.target.value) / 100;
      document.getElementById('swing-value').textContent = `${e.target.value}%`;
    });
    
    document.getElementById('bars')?.addEventListener('change', e => {
      this.saveState();
      this.bars = parseInt(e.target.value);
      this.buildGrid();
    });
    
    document.getElementById('scale')?.addEventListener('change', e => {
      this.scale = e.target.value;
    });
    
    document.getElementById('key-root')?.addEventListener('change', e => {
      this.rootNote = e.target.value;
    });
    
    document.getElementById('metronome')?.addEventListener('change', e => {
      this.metronomeEnabled = e.target.checked;
    });
    
    // Actions
    document.getElementById('randomize-btn')?.addEventListener('click', () => this.randomize());
    document.getElementById('clear-btn')?.addEventListener('click', () => this.clearAll());
    document.getElementById('undo-btn')?.addEventListener('click', () => this.undo());
    document.getElementById('redo-btn')?.addEventListener('click', () => this.redo());
    document.getElementById('help-btn')?.addEventListener('click', () => this.showHelp());
    
    // Save/Load
    document.getElementById('save-btn')?.addEventListener('click', () => this.saveSong());
    document.getElementById('delete-btn')?.addEventListener('click', () => this.deleteSelectedSong());
    document.getElementById('load-song')?.addEventListener('change', e => {
      if (e.target.value) this.loadSong(e.target.value);
    });
    
    // Export/Import
    document.getElementById('export-json-btn')?.addEventListener('click', () => this.exportJSON());
    document.getElementById('import-json-btn')?.addEventListener('click', () => {
      document.getElementById('import-file').click();
    });
    document.getElementById('import-file')?.addEventListener('change', e => this.importJSON(e));
    document.getElementById('export-wav-btn')?.addEventListener('click', () => this.exportWAV());
    
    // Pattern cells
    document.getElementById('tracks-container')?.addEventListener('click', e => {
      const cell = e.target.closest('.pattern-cell');
      const deleteBtn = e.target.closest('.pattern-delete');
      const muteBtn = e.target.closest('.track-btn.mute');
      const soloBtn = e.target.closest('.track-btn.solo');
      
      if (deleteBtn && cell) {
        e.stopPropagation();
        this.deletePattern(cell.dataset.instrument, cell.dataset.bar);
      } else if (cell) {
        this.openPatternModal(cell.dataset.instrument, parseInt(cell.dataset.bar));
      } else if (muteBtn) {
        this.toggleMute(muteBtn.dataset.track);
        muteBtn.classList.toggle('active');
      } else if (soloBtn) {
        this.toggleSolo(soloBtn.dataset.track);
        soloBtn.classList.toggle('active');
      }
    });
    
    // Context menu for cells
    document.getElementById('tracks-container')?.addEventListener('contextmenu', e => {
      const cell = e.target.closest('.pattern-cell');
      if (cell) {
        e.preventDefault();
        this.deletePattern(cell.dataset.instrument, cell.dataset.bar);
      }
    });
    
    // Modal close
    document.querySelectorAll('.modal-close, .modal-backdrop').forEach(el => {
      el.addEventListener('click', () => this.closeModals());
    });
    
    // Collapsible panels
    document.querySelectorAll('[data-toggle="collapse"]').forEach(header => {
      header.addEventListener('click', () => {
        const panel = header.closest('.collapsible');
        const content = panel.querySelector('.panel-content');
        const icon = header.querySelector('.collapse-icon');
        const isCollapsed = panel.dataset.collapsed === 'true';
        
        panel.dataset.collapsed = !isCollapsed;
        content.style.display = isCollapsed ? 'block' : 'none';
        icon.textContent = isCollapsed ? '▼' : '▶';
      });
    });
    
    // Effects sliders
    document.getElementById('effects-grid')?.addEventListener('input', e => {
      if (e.target.matches('.slider')) {
        const track = e.target.dataset.track;
        const param = e.target.dataset.param;
        const value = parseInt(e.target.value) / 100;
        
        const nodes = this.getInstrumentNodes(track);
        switch (param) {
          case 'volume':
            nodes.dry.gain.value = value;
            break;
          case 'reverb':
            nodes.revSend.gain.value = value * 0.5;
            break;
          case 'delay':
            nodes.delSend.gain.value = value * 0.4;
            break;
        }
      }
    });
    
    // Pattern search
    document.getElementById('pattern-search')?.addEventListener('input', e => {
      this.filterPatterns(e.target.value);
    });
    
    // Preview toggle
    document.getElementById('preview-enabled')?.addEventListener('change', e => {
      this.previewEnabled = e.target.checked;
    });
  }

  bindKeyboardShortcuts() {
    document.addEventListener('keydown', e => {
      // Ignore if in input
      if (e.target.matches('input, textarea, select')) return;
      
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          this.toggle();
          break;
        case 'KeyZ':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            this.undo();
          }
          break;
        case 'KeyY':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            this.redo();
          }
          break;
        case 'KeyS':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            this.saveSong();
          }
          break;
        case 'Slash':
          if (e.shiftKey) {
            e.preventDefault();
            this.showHelp();
          }
          break;
      }
    });
  }

  // ========================================
  // MODALS
  // ========================================

  openPatternModal(instrument, bar) {
    this.selectedCell = { instrument, bar };
    
    const modal = document.getElementById('pattern-modal');
    const title = document.getElementById('modal-title');
    const grid = document.getElementById('pattern-grid');
    
    const track = this.tracks.find(t => t.id === instrument);
    title.textContent = `Select Pattern - ${track?.name || instrument} (Bar ${bar + 1})`;
    
    grid.innerHTML = '';
    const patterns = this.patterns[instrument] || {};
    
    Object.entries(patterns).forEach(([name, pattern]) => {
      const option = document.createElement('div');
      option.className = 'pattern-option';
      option.dataset.pattern = name;
      
      const currentKey = `${instrument}_${bar}`;
      if (this.activePatterns[currentKey] === name) {
        option.classList.add('selected');
      }
      
      option.innerHTML = `
        <div class="pattern-option-name">${name}</div>
        <div class="pattern-option-desc">${pattern.description || ''}</div>
        <span class="pattern-option-tier tier-${pattern.tier || 1}">Tier ${pattern.tier || 1}</span>
      `;
      
      option.addEventListener('click', () => {
        this.selectPattern(name);
      });
      
      option.addEventListener('mouseenter', () => {
        if (this.previewEnabled) {
          clearTimeout(this.previewTimeout);
          this.previewTimeout = setTimeout(() => {
            this.previewPattern(instrument, name);
          }, 300);
        }
      });
      
      option.addEventListener('mouseleave', () => {
        clearTimeout(this.previewTimeout);
      });
      
      grid.appendChild(option);
    });
    
    modal.classList.add('open');
    document.getElementById('pattern-search').value = '';
    document.getElementById('pattern-search').focus();
  }

  selectPattern(patternName) {
    if (!this.selectedCell) return;
    
    this.saveState();
    
    const key = `${this.selectedCell.instrument}_${this.selectedCell.bar}`;
    this.activePatterns[key] = patternName;
    
    this.buildGrid();
    this.closeModals();
    this.showToast(`Pattern "${patternName}" added`, 'success');
  }

  deletePattern(instrument, bar) {
    const key = `${instrument}_${bar}`;
    if (!this.activePatterns[key]) return;
    
    this.saveState();
    delete this.activePatterns[key];
    this.buildGrid();
  }

  filterPatterns(query) {
    const grid = document.getElementById('pattern-grid');
    const options = grid.querySelectorAll('.pattern-option');
    const lower = query.toLowerCase();
    
    options.forEach(opt => {
      const name = opt.dataset.pattern.toLowerCase();
      const desc = opt.querySelector('.pattern-option-desc')?.textContent.toLowerCase() || '';
      opt.style.display = (name.includes(lower) || desc.includes(lower)) ? '' : 'none';
    });
  }

  showHelp() {
    document.getElementById('help-modal').classList.add('open');
  }

  closeModals() {
    document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
  }

  // ========================================
  // ACTIONS
  // ========================================

  randomize() {
    this.saveState();
    this.activePatterns = {};
    
    const trackOrder = ['drums', 'bass', 'chords', 'lead1', 'lead2'];
    const orderedTracks = trackOrder
      .map(id => this.tracks.find(t => t.id === id))
      .filter(Boolean);
    
    const perTrackHitCap = {
      drums: 20,
      bass: 14,
      chords: 8,
      lead1: 16,
      lead2: 12
    };
    
    const getBarBudget = barIndex => {
      if (barIndex < this.bars / 3) return { maxHits: 34, maxTier3: 0 };
      if (barIndex < (2 * this.bars) / 3) return { maxHits: 42, maxTier3: 1 };
      return { maxHits: 52, maxTier3: 2 };
    };
    
    const weightedPick = candidates => {
      const total = candidates.reduce((acc, c) => acc + c.weight, 0);
      let r = Math.random() * total;
      for (const c of candidates) {
        r -= c.weight;
        if (r <= 0) return c.name;
      }
      return candidates[candidates.length - 1]?.name;
    };
    
    const pickPattern = (trackId, bar, lastPattern, totalHits, tier3Count) => {
      const patterns = Object.keys(this.patterns[trackId] || {});
      if (patterns.length === 0) return null;
      
      const stage = this.bars > 1 ? bar / (this.bars - 1) : 0;
      const tierWeights = tier => {
        if (stage < 0.33) return tier === 1 ? 3 : tier === 2 ? 1.5 : 0.3;
        if (stage < 0.66) return tier === 1 ? 1.5 : tier === 2 ? 2 : 1;
        return tier === 3 ? 2.5 : tier === 2 ? 1.6 : 0.8;
      };
      
      const basePool = patterns.filter(p => p !== lastPattern);
      const pool = basePool.length ? basePool : patterns;
      
      const attempts = [
        { enforceBudget: true, enforceTier3: true },
        { enforceBudget: false, enforceTier3: true },
        { enforceBudget: false, enforceTier3: false }
      ];
      
      for (const rule of attempts) {
        const candidates = pool
          .map(name => {
            const stats = this.getPatternStats(trackId, name);
            return { name, stats, weight: tierWeights(stats.tier) };
          })
          .filter(c => {
            if (c.stats.hitCount > (perTrackHitCap[trackId] ?? 999)) return false;
            if (rule.enforceTier3 && c.stats.tier === 3 && tier3Count >= getBarBudget(bar).maxTier3) return false;
            if (rule.enforceBudget && (totalHits + c.stats.hitCount) > getBarBudget(bar).maxHits) return false;
            return true;
          });
        
        if (candidates.length) {
          return weightedPick(candidates);
        }
      }
      
      return pool[Math.floor(Math.random() * pool.length)];
    };
    
    const lastByTrack = {};
    for (let bar = 0; bar < this.bars; bar++) {
      let totalHits = 0;
      let tier3Count = 0;
      
      orderedTracks.forEach(track => {
        const pick = pickPattern(track.id, bar, lastByTrack[track.id], totalHits, tier3Count);
        if (!pick) return;
        
        const stats = this.getPatternStats(track.id, pick);
        totalHits += stats.hitCount;
        if (stats.tier === 3) tier3Count += 1;
        
        lastByTrack[track.id] = pick;
        this.activePatterns[`${track.id}_${bar}`] = pick;
      });
    }
    
    this.buildGrid();
    this.showToast('Randomized arrangement!', 'success');
  }

  clearAll() {
    if (Object.keys(this.activePatterns).length === 0) return;
    
    if (!confirm('Clear all patterns?')) return;
    
    this.saveState();
    this.activePatterns = {};
    this.buildGrid();
    this.showToast('Cleared all patterns', 'info');
  }

  toggleMute(trackId) {
    if (this.mutedTracks.has(trackId)) {
      this.mutedTracks.delete(trackId);
    } else {
      this.mutedTracks.add(trackId);
    }
  }

  toggleSolo(trackId) {
    if (this.soloTracks.has(trackId)) {
      this.soloTracks.delete(trackId);
    } else {
      this.soloTracks.add(trackId);
    }
  }

  // ========================================
  // SAVE/LOAD
  // ========================================

  saveSong() {
    const nameInput = document.getElementById('song-name');
    const name = nameInput?.value.trim();
    
    if (!name) {
      this.showToast('Please enter a song name', 'error');
      nameInput?.focus();
      return;
    }
    
    const songData = {
      version: 2,
      name,
      tempo: this.tempo,
      volume: this.volume,
      swing: this.swing,
      bars: this.bars,
      scale: this.scale,
      rootNote: this.rootNote,
      metronome: this.metronomeEnabled,
      patterns: { ...this.activePatterns }
    };
    
    const saved = JSON.parse(localStorage.getItem('frutigerAeroSongs') || '{}');
    saved[name] = songData;
    localStorage.setItem('frutigerAeroSongs', JSON.stringify(saved));
    
    this.loadSavedSongs();
    nameInput.value = '';
    this.showToast(`Saved "${name}"`, 'success');
  }

  loadSong(name) {
    const saved = JSON.parse(localStorage.getItem('frutigerAeroSongs') || '{}');
    const data = saved[name];
    
    if (!data) return;
    
    this.stop();
    this.saveState();
    
    this.tempo = data.tempo || 120;
    this.volume = data.volume || 0.75;
    this.swing = data.swing || 0.12;
    this.bars = data.bars || 8;
    this.scale = data.scale || 'lydian';
    this.rootNote = data.rootNote || 'C';
    this.metronomeEnabled = !!data.metronome;
    this.activePatterns = { ...data.patterns };
    
    // Update UI
    document.getElementById('tempo').value = this.tempo;
    document.getElementById('tempo-display').textContent = this.tempo;
    document.getElementById('volume').value = Math.round(this.volume * 100);
    document.getElementById('volume-value').textContent = `${Math.round(this.volume * 100)}%`;
    document.getElementById('swing').value = Math.round(this.swing * 100);
    document.getElementById('swing-value').textContent = `${Math.round(this.swing * 100)}%`;
    document.getElementById('bars').value = this.bars;
    document.getElementById('scale').value = this.scale;
    document.getElementById('key-root').value = this.rootNote;
    document.getElementById('metronome').checked = this.metronomeEnabled;
    
    this.masterGain.gain.value = this.volume;
    this.buildGrid();
    
    document.getElementById('load-song').value = '';
    this.showToast(`Loaded "${name}"`, 'success');
  }

  deleteSelectedSong() {
    const select = document.getElementById('load-song');
    const name = select?.value;
    
    if (!name) {
      this.showToast('Select a song to delete', 'error');
      return;
    }
    
    if (!confirm(`Delete "${name}"?`)) return;
    
    const saved = JSON.parse(localStorage.getItem('frutigerAeroSongs') || '{}');
    delete saved[name];
    localStorage.setItem('frutigerAeroSongs', JSON.stringify(saved));
    
    this.loadSavedSongs();
    this.showToast(`Deleted "${name}"`, 'info');
  }

  loadSavedSongs() {
    const select = document.getElementById('load-song');
    if (!select) return;
    
    const saved = JSON.parse(localStorage.getItem('frutigerAeroSongs') || '{}');
    
    select.innerHTML = '<option value="">Load saved...</option>';
    Object.keys(saved).sort().forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    });
  }

  exportJSON() {
    const songData = {
      version: 2,
      name: document.getElementById('song-name')?.value || 'Untitled',
      tempo: this.tempo,
      volume: this.volume,
      swing: this.swing,
      bars: this.bars,
      scale: this.scale,
      rootNote: this.rootNote,
      metronome: this.metronomeEnabled,
      patterns: { ...this.activePatterns }
    };
    
    const json = JSON.stringify(songData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${songData.name.replace(/[^a-z0-9]/gi, '_')}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
    this.showToast('Exported JSON', 'success');
  }

  importJSON(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = event => {
      try {
        const data = JSON.parse(event.target.result);
        
        this.saveState();
        
        this.tempo = data.tempo || 120;
        this.volume = data.volume || 0.75;
        this.swing = data.swing || 0.12;
        this.bars = data.bars || 8;
        this.scale = data.scale || 'lydian';
        this.rootNote = data.rootNote || 'C';
        this.metronomeEnabled = !!data.metronome;
        this.activePatterns = { ...data.patterns };
        
        // Update UI
        document.getElementById('tempo').value = this.tempo;
        document.getElementById('tempo-display').textContent = this.tempo;
        document.getElementById('volume').value = Math.round(this.volume * 100);
        document.getElementById('volume-value').textContent = `${Math.round(this.volume * 100)}%`;
        document.getElementById('swing').value = Math.round(this.swing * 100);
        document.getElementById('swing-value').textContent = `${Math.round(this.swing * 100)}%`;
        document.getElementById('bars').value = this.bars;
        document.getElementById('scale').value = this.scale;
        document.getElementById('key-root').value = this.rootNote;
        document.getElementById('metronome').checked = this.metronomeEnabled;
        document.getElementById('song-name').value = data.name || '';
        
        this.masterGain.gain.value = this.volume;
        this.buildGrid();
        
        this.showToast(`Imported "${data.name || 'song'}"`, 'success');
      } catch (err) {
        console.error('Import error:', err);
        this.showToast('Invalid JSON file', 'error');
      }
    };
    reader.readAsText(file);
    
    // Reset input
    e.target.value = '';
  }

  // ========================================
  // TOAST NOTIFICATIONS
  // ========================================

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'toast-out 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.beatMaker = new FrutigerAeroBeatMaker();
});
