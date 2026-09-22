#!/bin/bash
# duel_final.sh — the ship/no-ship measurement: every finalist on ONE fresh
# block, same binary, 400 episodes (~200 walking missions, ~140 kneel starts,
# ~60 crouch starts), all on-policy.
#   ./duel_final.sh <block> <workers> brain.json ...
set -u
cd "$(dirname "$0")" || exit 1
BLOCK="$1"; WORKERS="$2"; shift 2
T=training/champion_gen6951_preRiseTrial.json
for B in "$@"; do
    echo "== $B"
    ./walk3d_dagger --teacher $T --student "$B" --beta 0 --episodes 400 --workers "$WORKERS" --seed 11 --block "$BLOCK" \
        --refs dag/rob3_kneel.json --poses kneel:1 --floor-frac 0.35 --crouch-frac 0.15 --floor-flat 0.85 \
        --look 0 --lam 5 --d-max 2 --d-reanchor 2 --assume 0 --rise-teacher 1 \
        2>&1 | grep -E "student-driven|kneel +teacher|crouch +teacher"
done
