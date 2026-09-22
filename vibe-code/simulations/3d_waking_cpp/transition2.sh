#!/bin/bash
# transition.sh — carry the run across the contact-law fix without losing state.
#
# Keeps: the champion brain exactly as it stands, the generation counter, the
# whole history (so the dashboard graph appends rather than restarting), the
# training configuration byte-for-byte. Changes: the binary underneath it.
set -u
cd ~/walk3d_cpp || exit 1

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
GEN=$(python3 -c "import json;print(json.load(open('training/champion.json'))['gen'])")
echo "champion at gen $GEN"

# 1. snapshot the brain state BEFORE anything is stopped
cp training/champion.json "training/champion_gen${GEN}_preSpawnMixFix.json"
cp training/runlog.json   "training/runlog_gen${GEN}_preSpawnMixFix.json"
echo "snapshot saved: training/champion_gen${GEN}_preSpawnMixFix.json"

# 2. stop the trainer. -x matches the exact binary name and CANNOT match the
#    shell that is running this script, which is the trap that has cost this
#    project two runs.
PID=$(pgrep -x walk3d_train || true)
if [ -n "$PID" ]; then
    kill "$PID"; sleep 6
    if pgrep -x walk3d_train >/dev/null; then kill -9 "$PID"; sleep 3; fi
fi
echo "trainer stopped (was $PID); still running: $(pgrep -xc walk3d_train || echo 0)"

# 3. stop THIS run's autoselect only. A filename is not an identity on a shared
#    box — the planetary run uses the same helper name — so qualify by cwd.
for p in $(pgrep -f 'autoselect\.sh' || true); do
    if [ "$(readlink -f /proc/$p/cwd 2>/dev/null)" = "$HOME/walk3d_cpp" ]; then kill "$p"; echo "autoselect $p stopped"; fi
done
sleep 2

# 4. chart_from.json is deliberately NOT touched. It pins the dashboard's x-axis
#    origin at gen 1431; leaving it alone is what makes the graph continue
#    instead of starting a new one.
echo "chart_from left as: $(cat training/chart_from.json)"

# 5. relaunch. Identical arguments to the process that was just stopped, except
#    a fresh deadline. --resume training/champion.json restores the champion AND
#    the generation history, so gen numbering continues from $GEN.
DEADLINE=$(date -u -d '+12 hours' +%s)
echo "" >> training/new.log
echo "=== spawn mix corrected to 58% standing + curriculum rehearsal every 7th gen; resuming from gen $GEN with the same brain ===" >> training/new.log

setsid nohup ./walk3d_train \
    --gens 40000 --pop 192 --episodes 30 --workers 120 \
    --terrain varied --acts relu --surface-norm 1 --heading-w 0.5 \
    --save-every 5 --grace 3 --plateau-gens 450 --seed 20260802 \
    --rehearse-every 7 --deadline "$DEADLINE" --resume training/champion.json --out training \
    >> training/new.log 2>&1 < /dev/null &
echo "trainer relaunched, deadline $(date -u -d "@$DEADLINE" +'%Y-%m-%dT%H:%M:%SZ')"

sleep 3
setsid nohup ./autoselect.sh auto 300 >/dev/null 2>&1 < /dev/null &
echo "autoselect relaunched"
sleep 12
echo "--- alive: trainer $(pgrep -xc walk3d_train), autoselect $(pgrep -f 'autoselect\.sh' | wc -l)"
