#!/bin/bash
# dagger_more.sh — extra beta-0 rounds from an existing student, refitting on
# EVERY sample file in dag/ each time (walk-only rounds included).
#   ./dagger_more.sh <teacher.json> <first-round> <last-round> [episodes] [workers]
set -u
shopt -s nullglob
cd "$(dirname "$0")" || exit 1
TEACHER="$1"; R0="$2"; R1="$3"; EPISODES="${4:-240}"; WORKERS="${5:-30}"
REFS="${REFS:-dag/rob3_kneel.json}"; RISEW="${RISEW:-8}"
D="${DAGDIR:-dag}"; LOG=$D/dagger.log
say() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$LOG"; }
for ((r=R0; r<=R1; r++)); do
    STUDENT=$D/s$r.json
    say "round $r: collect (beta 0, student $STUDENT)"
    ./walk3d_dagger --teacher "$TEACHER" --student "$STUDENT" --beta 0 --episodes "$EPISODES" --workers "$WORKERS" \
        --seed $((100+r)) --block $((30000+r*1000)) --out $D/d$r.bin --refs "$REFS" ${DAGGER_ARGS:-} 2>&1 | tee -a "$LOG" | grep -E "driven|teacher +[0-9]|stranded|samples:"
    next=$D/s$((r+1)).json
    say "round $r: fit $next on all sample files (rise-w $RISEW)"
    python3 distil.py --out "$next" --epochs 40 --threads "$WORKERS" --gen $((r+1)) --rise-w "$RISEW" \
        --lineage "DAgger round $((r+1)); teacher $(basename "$TEACHER") + phase-tracked kneel rise" $D/dwalk*.bin $D/d[0-9]*.bin 2>&1 | tee -a "$LOG" | grep -E "epoch  40|parity|wrote|total"
done
say "done; last student $D/s$((R1+1)).json"
