#!/bin/bash
# go_sparse.sh — carry the run onto the elite-mutant fleet without losing the lineage.
#
# Two changes ride together, and they are separable if one has to be backed out:
#
#   1. The elite-mutant fleet. 33 of 192 seats (17%) instead of 8, dealt across
#      four stratified density bands from 25 to 1100 weights, each with a
#      lognormal strength draw. The population can now refine; before this the
#      smallest move anywhere in it was 354 weights.
#
#   2. --child-zero-fit 0, which pins crossover ON. It was an ABSOLUTE fitness
#      threshold at 15,000, so the rise-ladder change silently flipped the whole
#      run from hill-climbing (79% of gens above the line) to recombination (1%)
#      merely by lowering the reward scale. Fitness is already climbing back
#      through 11.7k and would have flipped it a third time. Pass 15000 to
#      restore the old behaviour.
set -u
cd ~/walk3d_cpp || exit 1

GEN=$(python3 -c "import json;print(json.load(open('training/champion.json'))['gen'])")
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
echo "champion at gen $GEN"

# 1. snapshot before anything is stopped
cp training/champion.json "training/champion_gen${GEN}_preSparseFleet.json"
cp training/runlog.json   "training/runlog_gen${GEN}_preSparseFleet.json"

# 2. stop the old trainer. -x matches the exact binary name and CANNOT match this
#    script — pkill -f has matched its own shell here before and cost two runs.
PID=$(pgrep -x walk3d_train || true)
if [ -n "$PID" ]; then
    kill "$PID"; sleep 6
    if pgrep -x walk3d_train >/dev/null; then kill -9 "$PID"; sleep 3; fi
fi
for p in $(pgrep -f 'autoselect\.sh' || true); do
    [ "$(readlink -f /proc/$p/cwd 2>/dev/null)" = "$HOME/walk3d_cpp" ] && kill "$p"
done
sleep 2
echo "old trainer stopped; still running: $(pgrep -xc walk3d_train || echo 0)"

# 3. clear any stale stop flag, or the next run halts after one generation.
rm -f training/STOP

# 4. keep the chart origin — this run is continuing, not restarting.
echo "chart_from stays: $(cat training/chart_from.json)"

echo "" >> training/new.log
echo "=== ELITE-MUTANT FLEET: 17% of seats, 4 density bands 25-1100 weights, lognormal strength; crossover pinned on (--child-zero-fit 0), from gen $GEN ($STAMP) ===" >> training/new.log

setsid nohup ./walk3d_train \
    --gens 2000000 --pop 192 --episodes 30 --workers 120 \
    --terrain varied --acts relu --surface-norm 1 --heading-w 0.5 \
    --rehearse-every 7 --child-zero-fit 0 \
    --save-every 5 --grace 3 --plateau-gens 450 --seed 20260803 \
    --resume training/champion.json --out training \
    >> training/new.log 2>&1 < /dev/null &
echo "trainer relaunched: elite fleet + crossover pinned"

sleep 3
setsid nohup ./autoselect.sh auto 300 >/dev/null 2>&1 < /dev/null &
echo "autoselect relaunched"

sleep 25
echo "--- alive: trainer $(pgrep -xc walk3d_train), autoselect $(pgrep -f 'autoselect\.sh' | wc -l)"
tail -4 training/new.log | cut -c1-150
