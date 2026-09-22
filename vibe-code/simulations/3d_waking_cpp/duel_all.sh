#!/bin/bash
# duel_all.sh — every finalist on one fresh block, same binary, on-policy:
# walking missions plus a start from EVERY non-standing pose. Per-pose rise
# counts are what the pick is made on.
#   REFS=... POST=... ./duel_all.sh <block> <workers> brain.json ...
set -u
cd "$(dirname "$0")" || exit 1
BLOCK="$1"; WORKERS="$2"; shift 2
T=${T:-dag/polish_g31.json}
REFS=${REFS:-dag/rob3_kneel.json}
POST=${POST:-dag/f22.json}
POSES=${POSES:-kneel:2,quadruped:2,prone:2,seated:1,supine:1,side:1,curled:1,crouch:1.0:1,seat:0.5:1}
for B in "$@"; do
    echo "== $B"
    ${DAGBIN:-./walk3d_dagger} --teacher $T --post-teacher $POST --student "$B" --beta 0 --episodes 480 --workers "$WORKERS" --seed 13 --block "$BLOCK" \
        --refs "$REFS" --poses "$POSES" --floor-frac 0.5 --floor-flat 0.85 \
        --look 0 --lam 5 --d-max 2 --d-reanchor 2 --assume 0 \
        2>&1 | grep -E "student-driven|^  [a-z:.0-9]+ +teacher"
done
