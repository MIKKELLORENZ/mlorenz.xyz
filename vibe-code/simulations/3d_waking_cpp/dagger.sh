#!/bin/bash
# dagger.sh — the distillation loop: teacher-driven cloning data, then rounds
# where the student drives (beta decaying to 0), the teacher labels, and the
# student is refitted from scratch on everything so far.
#
#   ./dagger.sh <teacher.json> <rounds> [episodes] [workers]
#
# Every round prints the student's ON-POLICY numbers from the collection pass
# itself (beta<1 mixes them; the final beta-0 rounds are the honest ones), then
# runs the standard held-out exam on the new student.
set -u
cd "$(dirname "$0")" || exit 1
TEACHER="$1"; ROUNDS="${2:-4}"; EPISODES="${3:-240}"; WORKERS="${4:-64}"
REFS="${REFS:-dag/ref_prone.json,dag/ref_quadruped.json,dag/ref_kneel.json}"
D="${DAGDIR:-dag}"; mkdir -p "$D"
LOG=$D/dagger.log
say() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$LOG"; }
BETAS=(1 0.5 0.25 0.1 0 0 0 0 0 0)
FILES=()
# EXTRA: sample files from earlier (e.g. walking-only) rounds, folded into every fit
for f in ${EXTRA:-}; do FILES+=("$f"); done
STUDENT=""
for ((r=0; r<=ROUNDS; r++)); do
    beta=${BETAS[$r]}
    say "round $r: collect (beta $beta, student ${STUDENT:-none})"
    args=(--teacher "$TEACHER" --beta "$beta" --episodes "$EPISODES" --workers "$WORKERS" --seed $((100+r)) --block $((30000+r*1000)) --out $D/d$r.bin --refs "$REFS" ${DAGGER_ARGS:-})
    [ -n "$STUDENT" ] && args+=(--student "$STUDENT")
    ./walk3d_dagger "${args[@]}" 2>&1 | tee -a "$LOG" | grep -E "walking starts|driven|teacher +[0-9]|stranded|samples:"
    FILES+=("$D/d$r.bin")
    next=$D/s$((r+1)).json
    say "round $r: fit $next on ${#FILES[@]} file(s)"
    python3 distil.py --out "$next" --epochs 40 --threads "$WORKERS" --gen $((r+1)) \
        --lineage "DAgger round $((r+1)); teacher $(basename "$TEACHER") + phase-tracked rise scaffold" "${FILES[@]}" 2>&1 | tee -a "$LOG" | grep -E "epoch|parity|wrote|total"
    STUDENT=$next
    say "round $r: exam of $next"
    ./walk3d_exam "$STUDENT" 5 2>&1 | tee -a "$LOG" | grep -E "mean|rose"
done
say "done; last student $STUDENT"
