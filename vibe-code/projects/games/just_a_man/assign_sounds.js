#!/usr/bin/env node
/**
 * Batch-assign picked sounds to their final filenames.
 *
 * Usage:
 *   node assign_sounds.js                  — auto-pick first option for each slot
 *   node assign_sounds.js --picks picks.json — use a picks file (slot -> optFile)
 *   node assign_sounds.js --slot sfx_click opt3.mp3 — assign one slot
 *
 * This copies the selected candidate MP3 to shared_assets/audio/{slot}.mp3
 */

const fs = require('fs');
const path = require('path');

const AUDIO_DIR = path.resolve(__dirname, '../../shared_assets/audio');
const CANDIDATES_DIR = path.join(AUDIO_DIR, 'candidates');
const MANIFEST_PATH = path.join(CANDIDATES_DIR, 'manifest.json');

function main() {
    if (!fs.existsSync(MANIFEST_PATH)) {
        console.error('No manifest.json found. Run download_sounds.js first.');
        process.exit(1);
    }

    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const args = process.argv.slice(2);

    let picks = {};

    if (args[0] === '--slot' && args[1] && args[2]) {
        // Assign single slot
        picks[args[1]] = args[2];
    } else if (args[0] === '--picks' && args[1]) {
        // Load picks from JSON
        picks = JSON.parse(fs.readFileSync(args[1], 'utf8'));
    } else {
        // Auto-pick: first option for each slot
        console.log('  Auto-picking first option for each slot...\n');
        for (const [slot, options] of Object.entries(manifest)) {
            if (options.length > 0) {
                picks[slot] = options[0].file;
            }
        }
    }

    let assigned = 0;
    let skipped = 0;

    for (const [slot, optFile] of Object.entries(picks)) {
        if (!manifest[slot]) {
            console.log(`  ? ${slot} — not in manifest, skipping`);
            skipped++;
            continue;
        }

        const srcPath = path.join(CANDIDATES_DIR, slot, optFile);
        const destPath = path.join(AUDIO_DIR, slot + '.mp3');

        if (!fs.existsSync(srcPath)) {
            console.log(`  ✗ ${slot} — ${optFile} not found`);
            skipped++;
            continue;
        }

        // Skip if destination already exists and is the same file
        if (fs.existsSync(destPath)) {
            const srcStat = fs.statSync(srcPath);
            const destStat = fs.statSync(destPath);
            if (srcStat.size === destStat.size) {
                console.log(`  = ${slot} — already assigned (same file)`);
                skipped++;
                continue;
            }
        }

        fs.copyFileSync(srcPath, destPath);
        const opt = manifest[slot].find(o => o.file === optFile);
        console.log(`  ✓ ${slot}.mp3 ← ${optFile} (${opt ? opt.label : ''})`);
        assigned++;
    }

    console.log(`\n  Done! Assigned: ${assigned}, Skipped: ${skipped}`);
    console.log(`  Files are in: ${AUDIO_DIR}\n`);
}

main();
