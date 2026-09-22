#!/bin/bash
# go_continuous.sh — carry the run onto the no-deadline binary without losing it.
#
# The trainer already treats deadline 0 as "no deadline", so continuous running is
# just omitting the flag. What it did NOT have until now is a way to be stopped on
# purpose, which is why this relaunch is needed at all: the running process is the
# old binary and has no STOP check compiled into it.
set -u
cd ~/walk3d_cpp || exit 1

GEN=$(python3 -c "import json;print(json.load(open('training/champion.json'))['gen'])")
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
echo "champion at gen $GEN"

# 1. snapshot before anything is stopped
cp training/champion.json "training/champion_gen${GEN}_preRiseLadder.json"
cp training/runlog.json   "training/runlog_gen${GEN}_preRiseLadder.json"

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

# 3. clear any stale stop flag. The trainer deliberately leaves it behind so a
#    halted run is distinguishable from one that simply ended; clearing it is the
#    launcher's job, or the next run would stop after one generation.
rm -f training/STOP

# 4. keep the chart origin. This run started at gen 1 and is continuing, not
#    restarting — repinning it would redraw the whole history as a new run.
echo "chart_from stays: $(cat training/chart_from.json)"

echo "" >> training/new.log
echo "=== RISE LADDER: contact-space ramp + sustained-height ratchet, from gen $GEN ($STAMP) — no deadline, stops only on the dashboard button ===" >> training/new.log

# 5. relaunch with NO --deadline. Everything else identical to the run it
#    replaces, so the only thing that changed is how it ends.
setsid nohup ./walk3d_train \
    --gens 2000000 --pop 192 --episodes 30 --workers 120 \
    --terrain varied --acts relu --surface-norm 1 --heading-w 0.5 \
    --rehearse-every 7 \
    --save-every 5 --grace 3 --plateau-gens 450 --seed 20260803 \
    --resume training/champion.json --out training \
    >> training/new.log 2>&1 < /dev/null &
echo "trainer relaunched with no deadline"

sleep 3
setsid nohup ./autoselect.sh auto 300 >/dev/null 2>&1 < /dev/null &
echo "autoselect relaunched"

sleep 20
echo "--- alive: trainer $(pgrep -xc walk3d_train), autoselect $(pgrep -f 'autoselect\.sh' | wc -l)"
grep -c "deadline" training/new.log >/dev/null && echo "deadline line in log: $(tail -40 training/new.log | grep -c 'deadline .* min from now') (0 = continuous)"
tail -3 training/new.log | cut -c1-120
