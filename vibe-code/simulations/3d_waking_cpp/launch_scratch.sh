#!/bin/bash
# launch_scratch.sh — a run from a clean slate: random brains, no seed, and the
# curriculum left free to ramp.
#
#   ./launch_scratch.sh                     deadline 19:30 UTC today
#   ./launch_scratch.sh 120 '2026-08-02 08:00:00'
#
# NO --stage-lock, and that is the whole point of "from scratch". A random newborn
# cannot walk, so locking it to stage 3 would drop it straight into turning
# courses and shoves it has no chance at. stageFor() promotes on what the FLEET
# can actually do — 80% of the population standing and holding it before shoves
# arrive, real metres walked before the course starts twisting — with generation
# fallbacks as an anti-stall backstop.
#
# NO --resume. Every earlier attempt today started from a highly-evolved champion
# and went backwards: the seed holds 2 seats of 192, has to win a 192-way argmax
# on one mission bank to keep its own crown, and loses it in generation 1. From
# scratch there is no incumbent to lose, so selection is climbing rather than
# defending.
#
# --heading-w 0.5 from the FIRST generation. Applied to an established
# crab-walker it fights an incumbent gait; applied to a fresh population it shapes
# the gait as it forms, which is exactly what island B demonstrated — it reached
# closure-weighted alignment 0.89 against the seeded lineage's 0.54.
set -u
cd "$(dirname "$0")" || exit 1

WORKERS="${1:-120}"
DEADLINE_STR="${2:-$(date -u +'%Y-%m-%d') 19:30:00}"
DEADLINE=$(date -u -d "$DEADLINE_STR" +%s)
PORT="${3:-8913}"

# Archive anything from a previous lineage. Nothing is deleted: the dashboard
# clips to the current run, and the old numbers stay on disk beside it.
if [ -d training ] && [ -f training/run.log ]; then
    STAMP=$(date -u +%Y%m%dT%H%M%SZ)
    mv training "training_archived_$STAMP"
    echo "archived the previous run to training_archived_$STAMP"
fi
mkdir -p training

echo "from scratch — random brains, curriculum free to ramp from stage 1"
echo "deadline $(date -u -d "@$DEADLINE" +'%Y-%m-%dT%H:%M:%SZ'), $WORKERS threads, dashboard :$PORT"

setsid nohup ./walk3d_train \
    --gens 40000 \
    --pop 192 \
    --episodes 30 \
    --workers "$WORKERS" \
    --terrain varied \
    --acts relu \
    --surface-norm 1 \
    --heading-w 0.5 \
    --save-every 5 \
    --grace 3 \
    --seed 20260801 \
    --deadline "$DEADLINE" \
    --out training \
    >> training/run.log 2>&1 &
echo "trainer pid $!"

sleep 3
# --stage auto: the exam takes the stage the run is actually on, read from its own
# runlog. With a ramping curriculum a fixed stage would compare every generation
# against a bar banked under different conditions.
setsid nohup ./autoselect.sh auto 300 >/dev/null 2>&1 &
echo "autoselect pid $! (stage auto)"

if ! pgrep -f "dashboard.js --port $PORT" >/dev/null; then
    setsid nohup node dashboard.js --port "$PORT" --dir "$PWD" --label "C++ — from scratch" \
        >/dev/null 2>&1 &
    echo "dashboard pid $! on port $PORT"
else
    echo "dashboard already up on $PORT"
fi
