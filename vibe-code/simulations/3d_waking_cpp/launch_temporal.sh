#!/bin/bash
# launch_temporal.sh — first run on the 365-input differenced-window layout.
#
# FROM SCRATCH, and it has to be: every saved brain in this project is a
# 364-input genome laid out as raw lagged samples, and the new taps are
# differences against window means. There is no (channel, lag) identity to graft
# them onto, so a resumed brain would be wired to inputs that no longer exist.
#
# The 2,950-generation run this replaces is ARCHIVED rather than deleted. Its
# champion cannot load against this build, but its runlog is the only record of
# how the old encoding behaved and it is the baseline the new one gets judged
# against.
set -u
cd ~/walk3d_cpp || exit 1

WORKERS="${1:-120}"
HOURS="${2:-12}"
DEADLINE=$(date -u -d "+${HOURS} hours" +%s)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

# 1. stop the old run. -x matches the exact binary and CANNOT match this script,
#    which is the trap that has cost this project two runs.
PID=$(pgrep -x walk3d_train || true)
if [ -n "$PID" ]; then
    kill "$PID"; sleep 6
    if pgrep -x walk3d_train >/dev/null; then kill -9 "$PID"; sleep 3; fi
fi
# This run's autoselect only — a filename is not an identity on a shared box.
for p in $(pgrep -f 'autoselect\.sh' || true); do
    [ "$(readlink -f /proc/$p/cwd 2>/dev/null)" = "$HOME/walk3d_cpp" ] && kill "$p"
done
sleep 2
echo "old trainer stopped; still running: $(pgrep -xc walk3d_train || echo 0)"

# 2. archive, do not delete
ARCH="training_364raw_${STAMP}"
mv training "$ARCH"
mkdir -p training
echo "archived the 364-input run to $ARCH ($(ls "$ARCH" | wc -l) files)"

# 3. the dashboard's x-axis origin. A from-scratch run starts at 1; leaving the
#    old pin at 1431 would draw the new run's generation 1 on top of the old
#    run's 1431 and the graph would read as a catastrophic collapse.
echo '{"gen":1,"since":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}' > training/chart_from.json

echo "" >> training/new.log
echo "=== FROM SCRATCH on the 365-input differenced-window layout ($STAMP) ===" >> training/new.log
echo "=== windows 20-60 / 80-300 / 320-1200 ms, gains measured by probe_delta_gains.js ===" >> training/new.log

# 4. launch. No --resume: the population is new random brains of the new shape.
#    No --stage-lock: the curriculum ratchets from stage 1 the way it is meant
#    to, and this run has no inherited competence to protect.
setsid nohup ./walk3d_train \
    --gens 40000 --pop 192 --episodes 30 --workers "$WORKERS" \
    --terrain varied --acts relu --surface-norm 1 --heading-w 0.5 \
    --rehearse-every 7 \
    --save-every 5 --grace 3 --plateau-gens 450 --seed 20260803 \
    --deadline "$DEADLINE" --out training \
    >> training/new.log 2>&1 < /dev/null &
echo "trainer launched, deadline $(date -u -d "@$DEADLINE" +'%Y-%m-%dT%H:%M:%SZ')"

sleep 3
setsid nohup ./autoselect.sh auto 300 >/dev/null 2>&1 < /dev/null &
echo "autoselect launched"

sleep 25
echo "--- alive: trainer $(pgrep -xc walk3d_train), autoselect $(pgrep -f 'autoselect\.sh' | wc -l)"
tail -4 training/new.log | cut -c1-140
