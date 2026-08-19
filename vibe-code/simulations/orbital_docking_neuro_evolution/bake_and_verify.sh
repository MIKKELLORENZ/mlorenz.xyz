#!/bin/bash
# Pull the best distilled/evolved brain off compnode1, bake it into the page,
# and re-score it against the autopilot on the held-out bank.
set -e
SRC=${1:-training/imit_best.json}
scp -q Remote-compnode1:/data/orbital_dock/$SRC training/candidate.json
node train.js --bake training/candidate.json
scp -q default_brain.js Remote-compnode1:/data/orbital_dock/
ssh Remote-compnode1 "cd /data/orbital_dock && ~/opt/node/bin/node exam.js --brains default_brain.js --pilot --per 8 --workers 48"
