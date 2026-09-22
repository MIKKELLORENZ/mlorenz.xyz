#!/bin/bash
# duel.sh — measure brains ON-POLICY on one shared mission block: walking
# waypoints over ~130 varied missions and the kneel rise rate over ~110 starts.
#   ./duel.sh <block> <workers> brain1.json brain2.json ...
set -u
cd "$(dirname "$0")" || exit 1
BLOCK="$1"; WORKERS="$2"; shift 2
T=training/champion_gen6951_preRiseTrial.json
for B in "$@"; do
    echo "== $B"
    ./walk3d_dagger --teacher $T --student "$B" --beta 0 --episodes 240 --workers "$WORKERS" --seed 7 --block "$BLOCK" \
        --refs dag/rob3_kneel.json --poses kneel:1 --floor-frac 0.45 --floor-flat 0.85 --look 0 --lam 5 --d-max 2 --d-reanchor 2 --assume 0 \
        2>&1 | grep -E "student-driven|kneel +teacher"
done
