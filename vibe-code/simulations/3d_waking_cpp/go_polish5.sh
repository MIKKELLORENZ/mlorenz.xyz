#!/bin/bash
# go_polish.sh — hand a DISTILLED brain to the GA.
#
#   ./go_polish.sh dag/s5.json [workers] [outdir]
#
# A gradient-trained net has never faced the mutation operator, and the one
# thing it cannot take is the 3% full-reset branch (measured on another sim:
# twenty redrawn weights took a distilled brain from 774 to 318 while the same
# sigma with resets off left it at 754). So: --mut-reset 0, and the small step
# this project measured as the only one with an uphill move (0.02 / 0.015).
# Stage is LOCKED at 5 — the file carries no curriculum history and the exam
# the brain has to pass is a stage-5 exam. --fresh-history because the ledger
# history in the file is empty anyway.
set -u
cd "$(dirname "$0")" || exit 1
SEED="$1"; WORKERS="${2:-64}"; OUT="${3:-training_polish}"
mkdir -p "$OUT"
cp "$SEED" "$OUT/seed.json"
echo "{\"gen\":1,\"since\":\"$(date -u +%Y-%m-%dT%H:%M:%S).000Z\"}" > "$OUT/chart_from.json"
setsid nohup ./walk3d_train \
    --gens 2000000 --pop 192 --episodes 30 --workers "$WORKERS" \
    --terrain varied --acts lrelu --surface-norm 1 --heading-w 0.5 \
    --stage-lock 5 --rehearse-every 7 --mut-reset 0 --mut-rate 0.02 --mut-sigma 0.015 \
    --child-zero-fit 0 --plateau-gens 450 --save-every 5 --grace 3 --seed 20260913 \
    --rise-every 5 --rise-pose kneel --export-dir "$OUT/snapshots" --export-every 5 --export-count 1 \
    --resume "$OUT/seed.json" --fresh-history --out "$OUT" --tag walk3d_polish \
    >> "$OUT/run.log" 2>&1 < /dev/null &
echo "polish trainer pid $! -> $OUT"
