#!/bin/bash
# launch.sh — start the C++ run, its held-out selector and its dashboard.
#
#   ./launch.sh                     deadline 19:30 UTC today, 120 threads
#   ./launch.sh 120 '2026-08-02 08:00:00'
#
# The training configuration is DELIBERATELY IDENTICAL to the JS run this
# replaces — same population, same episode bank, same stage lock, same heading
# weight, same activation, same surface normalisation. That is what makes the
# port a controlled substitution: if the outcome changes, it changed because the
# machine got faster, not because the experiment was quietly re-tuned at the same
# time. Anything worth changing about the search is a separate decision with its
# own before-and-after.
#
# Launched with setsid + nohup rather than a bare `&`. On this box a run started
# from an SSH session dies with the session, and this project has lost two
# overnight runs that way.
set -u
cd "$(dirname "$0")" || exit 1

WORKERS="${1:-120}"
DEADLINE_STR="${2:-$(date -u +'%Y-%m-%d') 19:30:00}"
DEADLINE=$(date -u -d "$DEADLINE_STR" +%s)
PORT="${3:-8913}"

# Seeds, best first — the first file listed takes the champion slot.
#   1. island A's held-out winner: 2.42 wp / 7.26 m, the best brain this project
#      has produced, but it crab-walks (closure-weighted alignment 0.54)
#   2. island B's held-out winner: 1.67 wp / 5.20 m, weaker but it walks STRAIGHT
#      (alignment 0.89) because it was bred under the heading multiplier
# Two ancestors rather than one is not a hedge, it is the documented purpose of a
# multi-seed resume: crossover can only recombine what the pool contains, and a
# population grown from a single brain starts inside whatever basin that brain is
# in. These two differ in exactly the trait the run is trying to fix.
SEEDS="seeds/islandA_2p42.json,seeds/islandB_straight.json"

mkdir -p training
if [ -f training/run.log ]; then
    mv -f training/run.log "training/run.$(date -u +%Y%m%dT%H%M%SZ).log"
fi

echo "deadline $(date -u -d "@$DEADLINE" +'%Y-%m-%dT%H:%M:%SZ'), $WORKERS threads, dashboard :$PORT"

setsid nohup ./walk3d_train \
    --gens 40000 \
    --pop 192 \
    --episodes 30 \
    --workers "$WORKERS" \
    --stage-lock 3 \
    --terrain varied \
    --acts relu \
    --surface-norm 1 \
    --heading-w 0.5 \
    --resume "$SEEDS" \
    --fresh-history 1 \
    --save-every 5 \
    --grace 3 \
    --seed 20260801 \
    --deadline "$DEADLINE" \
    --out training \
    >> training/run.log 2>&1 &
TRAIN_PID=$!
echo "trainer pid $TRAIN_PID"

sleep 2
setsid nohup ./autoselect.sh 3 300 >/dev/null 2>&1 &
echo "autoselect pid $!"

# The dashboard reads what the run writes to disk and never talks to the trainer,
# so it can be restarted at any time without touching the run.
setsid nohup node dashboard.js --port "$PORT" --dir "$PWD" --label "C++ port" \
    --peer "http://localhost:8912" --peer-label "the JS island B it replaced" \
    >/dev/null 2>&1 &
echo "dashboard pid $! on port $PORT"
