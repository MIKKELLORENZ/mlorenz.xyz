#!/bin/bash
# autoselect.sh — keep the best held-out brain ON THE NODE.
#
# The laptop sleeps, which killed the local autobaker twice and left the repo
# pinned to whatever brain happened to be current when it died. Selection has to
# live where nothing sleeps: this loop exams each champion on the twelve held-out
# missions and keeps the winner in training/best_holdout.json with its score
# beside it. The laptop then only has to FETCH a winner, which is a one-shot
# action that does not care about uptime.
#
# The ranking, the comparison and the log line all live inside walk3d_exam
# --select now. The JS version parsed the exam's own printed summary back out with
# sed and grep, so the ratchet that decides which brain the project keeps depended
# on the spacing of a human-readable line. The log format it writes is unchanged,
# because the dashboard parses it.
#
# STAGE MUST MATCH THE RUN, so pass `auto` and let the exam read it out of the
# run's own runlog. A champion trained at stage 3 and examined at stage 4 meets
# harder shoves and sharper courses, so a low score says "harder exam", not "worse
# walker" — this project lost an afternoon to exactly that once. With a ramping
# curriculum a fixed number is worse still: the bar would be banked at one stage
# and defended at another, and the ratchet would freeze after the first promotion.
set -u
cd "$(dirname "$0")" || exit 1
STAGE="${1:-auto}"
EVERY="${2:-300}"
LOG=training/autoselect.log
mkdir -p training

say() { echo "[$(date -u +'%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }
say "autoselect started; ranking on the held-out exam at stage $STAGE every $((EVERY/60)) min"

while true; do
    if [ -f training/champion.json ]; then
        ./walk3d_exam --select --stage "$STAGE" >/dev/null 2>>training/autoselect.err
    fi
    sleep "$EVERY"
done
