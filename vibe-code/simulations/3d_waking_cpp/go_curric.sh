#!/bin/bash
# go_curric.sh — REVERSE CURRICULUM for the rise net, WITHOUT FORGETTING.
# Start the rise GA a little way back from a pose it already solves
# (lerp:FROM:TO:t) and move t on only when the harness says the champion gets
# up AND HOLDS from the new rung and still from every pose passed before.
# Every rung trains on the MIX of all passed poses plus the new one (the
# trainer deals --rise-pose a,b,c per episode slot); a rung-at-a-time GA
# measured 0/82 from the plain kneel it had been seeded from.
#   ./go_curric.sh <seed.json> <from> <to> "<t list>" <workers> [held-threshold/82] [max-min-per-rung] [extra base poses]
set -u; cd /data/walk3d_cpp || exit 1
SEED=$1; FROM=$2; TO=$3; RUNGS=$4; W=$5; TH=${6:-49}; MAXMIN=${7:-45}; BASE=${8:-$FROM}
# CHECKS: poses (comma list) that must ALSO hold >= TH after every rung — a deep
# crouch counts as "down" in the two-net brain, so the rise net owns crouch starts too
CHECKS=${CHECKS:-kneel,crouch:1.0}
L=dag5/curric_${FROM}_${TO}.log; say() { echo "[$(date -u +%H:%M)] $*" >> "$L"; }
R=training/champion_gen6951_preRiseTrial.json
TRAIN=${TRAIN:-./walk3d_train_rs9}
TMPL=${TMPL:-}   # optional pose template with %t, e.g. "jit:kneel:%t"; default lerp:FROM:TO:t
measure() {   # brain pose -> "rose a/b held c"
    ./walk3d_dagger_new --teacher dag/polish_g31.json --post-teacher $R --student "$1" --beta 0 --episodes 120 --workers 24 --seed 9 --block 92000 \
        --refs dag/rob3_kneel.json --poses "$2:1" --floor-frac 0.7 --floor-flat 1.0 --floor-diff 0 --look 0 --lam 5 --d-max 2 --d-reanchor 2 --assume 0 2>&1 \
        | grep -E "teacher +[0-9]" | sed -E "s/.*student +([0-9]+)\/([0-9]+) +held +[0-9]+\/([0-9]+).*/rose \1\/\2 held \3/"
}
held() { echo "$1" | sed "s/.*held //"; }
POSES="$BASE"   # comma list of everything passed so far
say "curriculum $FROM -> $TO, rungs [$RUNGS], seed $SEED, pass at held >= $TH/82 on the rung AND on $BASE"
for t in $RUNGS; do
    POSE=${TMPL:+${TMPL//%t/$t}}; POSE=${POSE:-lerp:$FROM:$TO:$t}; OUT="training_cur_${FROM}_${TO}_$t"; MIX="$POSES,$POSE"
    m=$(measure "$SEED" "$POSE"); say "rung $t: seed measures $m"
    if [ "$(held "$m")" -ge "$TH" ]; then say "rung $t already passed by the seed"; POSES="$MIX"; continue; fi
    rm -rf "$OUT"; TRAIN=$TRAIN EPI=96 ./go_riseonly.sh "$SEED" "$MIX" "$W" "$OUT" 10 >> "$L"
    PID=$(ps -eo pid,args | grep "walk3d_train" | grep -- "--out $OUT " | grep -v grep | awk "{print \$1}" | head -1)
    say "rung $t: GA pid $PID from $SEED on mix [$MIX]"
    t0=$(date +%s); passed=0; best=-1; bestFile=""
    while :; do
        sleep 240
        [ -f "$OUT/champion.json" ] || continue
        cp "$OUT/champion.json" "$OUT/cand.json"
        m=$(measure "$OUT/cand.json" "$POSE"); h=$(held "$m")
        hb=999; mb=""; for cp in ${CHECKS//,/ }; do mc=$(measure "$OUT/cand.json" "$cp"); hc=$(held "$mc"); mb="$mb $cp: $mc;"; [ "$hc" -lt "$hb" ] && hb=$hc; done
        say "rung $t: champion (gen $(python3 -c "import json;print(json.load(open(\"$OUT/cand.json\")).get(\"gen\"))" 2>/dev/null)) rung $m |$mb"
        score=$(( h < hb ? h : hb ))
        if [ "$score" -gt "$best" ]; then best=$score; cp "$OUT/cand.json" "$OUT/best_measured.json"; bestFile="$OUT/best_measured.json"; fi
        if [ "$h" -ge "$TH" ] && [ "$hb" -ge "$TH" ]; then passed=1; break; fi
        if [ $(( $(date +%s) - t0 )) -gt $((MAXMIN*60)) ]; then break; fi
    done
    kill "$PID" 2>/dev/null; sleep 3
    if [ "$passed" = 1 ]; then
        SEED="dag/curric_${FROM}_${TO}_$t.json"; cp "$OUT/best_measured.json" "$SEED"; POSES="$MIX"
        say "rung $t PASSED (min held $best/82) -> $SEED"
    else
        say "rung $t FAILED after $MAXMIN min (best min-held $best/82); stopping the chain"
        [ -n "$bestFile" ] && cp "$bestFile" "dag/curric_${FROM}_${TO}_${t}_partial.json"; break
    fi
done
say "curriculum done; last seed $SEED; poses [$POSES]"
