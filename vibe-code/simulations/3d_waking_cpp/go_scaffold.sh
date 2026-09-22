#!/bin/bash
# go_scaffold.sh — carry the run onto rise scaffolding without losing the lineage.
#
# What changes: 60% of RISE-RUNG episodes now have a searched open-loop reference
# drive the joints for the first 35-90% of the rise, handing over to the brain
# mid-motion. Fitness is re-baselined at handover so none of the height the
# scaffold produced is paid for, and the remaining 40% of rise episodes are
# unscaffolded, so a brain that can only rise with help still scores nothing.
#
# Why: the rise never had a reward gradient leading into it — commanding the
# standing posture from a floor pose drives the COM DOWN first, so the correct
# behaviour was punished for its whole prefix. An open-loop search then proved
# the rise IS reachable inside the real torque, lag and slew limits:
#
#     kneel      0.574 m -> 0.718 m settled
#     quadruped  0.376 m -> 0.803 m settled  (peak 0.966, above the 0.955 stand)
#     prone      0.386 m -> 0.812 m settled
#
# so the missing thing was the gradient, not the capability.
#
# EXPECT FITNESS TO MOVE, AND DO NOT READ IT AS PROGRESS OR REGRESSION EITHER WAY.
# Scaffolded episodes start the brain part-way up, which is easier; the ratchet
# re-baseline removes the free credit but the walker still begins those episodes
# upright and closer to the waypoints. The number to watch is roseFrac, and the
# honest one is the held-out candidate MEAN, which no scaffold touches.
set -u
cd ~/walk3d_cpp || exit 1

GEN=$(python3 -c "import json;print(json.load(open('training/champion.json'))['gen'])")
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
echo "champion at gen $GEN"

cp training/champion.json "training/champion_gen${GEN}_preScaffold.json"
cp training/runlog.json   "training/runlog_gen${GEN}_preScaffold.json"

# -x matches the exact binary name and CANNOT match this script; pkill -f has
# matched its own shell here before and cost two runs.
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

rm -f training/STOP
echo "chart_from stays: $(cat training/chart_from.json)"

echo "" >> training/new.log
echo "=== RISE SCAFFOLDING: searched reference drives 35-90% of the rise on 60% of rise-rung episodes, handover mid-motion, ratchet re-baselined; from gen $GEN ($STAMP) ===" >> training/new.log

setsid nohup ./walk3d_train \
    --gens 2000000 --pop 192 --episodes 30 --workers 120 \
    --terrain varied --acts relu --surface-norm 1 --heading-w 0.5 \
    --rehearse-every 7 --child-zero-fit 0 \
    --save-every 5 --grace 3 --plateau-gens 450 --seed 20260803 \
    --resume training/champion.json --out training \
    >> training/new.log 2>&1 < /dev/null &
echo "trainer relaunched with rise scaffolding"

sleep 3
setsid nohup ./autoselect.sh auto 300 >/dev/null 2>&1 < /dev/null &
echo "autoselect relaunched"

sleep 25
echo "--- alive: trainer $(pgrep -xc walk3d_train), autoselect $(pgrep -f 'autoselect\.sh' | wc -l)"
tail -3 training/new.log | cut -c1-150
