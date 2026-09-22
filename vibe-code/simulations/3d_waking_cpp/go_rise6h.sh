#!/bin/bash
# go_rise6h.sh — the unattended six-hour programme: getting up from every
# non-standing pose. Runs on the node, logs to dag4/run.log, and finishes by
# writing dag4/BEST.json (the pick) and dag4/SUMMARY.txt.
#
#   setsid nohup ./go_rise6h.sh > /dev/null 2>&1 < /dev/null &
#
# Phase 1  searches, finisher = f22 (which can complete a kneel), one gene per
#          pose, two seedings each where it matters; keep genes that stand on
#          >= 3 of 6 fresh jitter seeds.
# Phase 2  chain searches for poses that failed, played into the genes that
#          succeeded (prone -> quadruped gene -> f22, supine/side/curled ->
#          prone chain ...).
# Phase 3  DAgger from f22 over every pose with a reference, walking data of
#          the second loop kept, post-rise labels from f22; five seed fits.
# Phase 4  duel_all on two blocks, pick_best.
set -u
cd ~/walk3d_cpp || exit 1
mkdir -p dag4
L=dag4/run.log; : > "$L"
say() { echo "[$(date -u +%H:%M)] $*" >> "$L"; }
CH=training/champion_gen6951_preRiseTrial.json
F22=dag/f22.json
G31=dag/polish_g31.json
W=60

search() {   # name pose init seed extra...
    local name=$1 pose=$2 init=$3 seed=$4; shift 4
    local initArg=(); [ "$init" != "-" ] && initArg=(--init "$init")
    ./walk3d_risesearch_c --pose "$pose" --finisher $F22 --finish 5 --settle 2 --knots 6 --T 3 \
        "${initArg[@]}" --gens 300 --pop 192 --elite 24 --workers $W --seeds 12 --sigma 0.05 --seed "$seed" \
        --out "dag4/$name.json" "$@" > "dag4/$name.log" 2>&1
    local v; v=$(grep -o "standing [0-9]/6" "dag4/$name.log" | tail -1 | grep -o "[0-9]" | head -1)
    say "search $name ($pose init=$init seed=$seed): $(grep winner "dag4/$name.log" | cut -c1-120)"
    echo "${v:-0}"
}
best_of() {   # prints the file of the better of two names by standing count
    local a=$1 b=$2 va vb
    va=$(grep -o "standing [0-9]/6" "dag4/$a.log" | tail -1 | grep -o "[0-9]" | head -1)
    vb=$(grep -o "standing [0-9]/6" "dag4/$b.log" | tail -1 | grep -o "[0-9]" | head -1)
    if [ "${vb:-0}" -gt "${va:-0}" ]; then echo "$b ${vb:-0}"; else echo "$a ${va:-0}"; fi
}

say "phase 1: searches with finisher f22"
REFS="dag/rob3_kneel.json"; POSES="kneel:2"
declare -A GENE
for spec in "quadruped quadruped - 71" "quadruped_n quadruped none 72" "prone prone - 73" "prone_n prone none 74" \
            "seated seated none 75" "supine supine none 76" "side side none 77" "curled curled none 78" \
            "crouch1 crouch:1.0 none 79" "seat05 seat:0.5 none 80" "kneel2 kneel dag/rob3_kneel.json 81"; do
    set -- $spec; search "$1" "$2" "$3" "$4" >/dev/null
done
for pose in quadruped prone; do
    r=$(best_of "$pose" "${pose}_n"); set -- $r
    if [ "$2" -ge 3 ]; then GENE[$pose]="dag4/$1.json"; REFS="$REFS,dag4/$1.json"; POSES="$POSES,$pose:2"; say "keep $pose <- $1 ($2/6)"; fi
done
for spec in "seated seated" "supine supine" "side side" "curled curled" "crouch1 crouch:1.0" "seat05 seat:0.5"; do
    set -- $spec
    v=$(grep -o "standing [0-9]/6" "dag4/$1.log" | tail -1 | grep -o "[0-9]" | head -1)
    if [ "${v:-0}" -ge 3 ]; then GENE[$2]="dag4/$1.json"; REFS="$REFS,dag4/$1.json"; POSES="$POSES,$2:1"; say "keep $2 <- $1 ($v/6)"; fi
done
v=$(grep -o "standing [0-9]/6" dag4/kneel2.log | tail -1 | grep -o "[0-9]" | head -1)
if [ "${v:-0}" -ge 5 ]; then REFS=${REFS/dag\/rob3_kneel.json/dag4\/kneel2.json}; say "kneel reference refreshed ($v/6)"; fi

say "phase 2: chain searches for what failed"
chain_try() {   # name pose chainfiles seed
    local name=$1 pose=$2 chain=$3 seed=$4
    ./walk3d_risesearch_c --pose "$pose" --finisher $F22 --chain "$chain" --finish 5 --settle 2 --knots 6 --T 3 \
        --init none --gens 300 --pop 192 --elite 24 --workers $W --seeds 12 --sigma 0.05 --seed "$seed" \
        --out "dag4/$name.json" > "dag4/$name.log" 2>&1
    local v; v=$(grep -o "standing [0-9]/6" "dag4/$name.log" | tail -1 | grep -o "[0-9]" | head -1)
    say "chain $name ($pose -> $chain): $(grep winner "dag4/$name.log" | cut -c1-120)"
    echo "${v:-0}"
}
# a chained reference is the searched gene followed by the chained genes; the
# tracker needs ONE gene, so a successful chain is baked as a concatenated gene
concat() {   # out first second...  (knots-major layout: gene[j*K + k])
    python3 - "$@" <<'EOF'
import json, sys
out = sys.argv[1]; parts = [json.load(open(f)) for f in sys.argv[2:]]
nj = parts[0]["nj"]; K = sum(p["knots"] for p in parts); T = sum(p["T"] for p in parts)
gene = []
for j in range(nj):
    for p in parts: gene += p["gene"][j*p["knots"]:(j+1)*p["knots"]]
json.dump({"pose": parts[0]["pose"], "knots": K, "T": T, "nj": nj, "gene": gene, "chained": sys.argv[2:]}, open(out, "w"))
EOF
}
if [ -n "${GENE[quadruped]:-}" ] && [ -z "${GENE[prone]:-}" ]; then
    v=$(chain_try prone_c prone "${GENE[quadruped]}" 82)
    if [ "$v" -ge 3 ]; then concat dag4/prone_cc.json dag4/prone_c.json "${GENE[quadruped]}"; GENE[prone]=dag4/prone_cc.json; REFS="$REFS,dag4/prone_cc.json"; POSES="$POSES,prone:2"; say "keep prone <- chain ($v/6)"; fi
fi
if [ -n "${GENE[prone]:-}" ]; then
    for pose in supine side curled; do
        [ -n "${GENE[$pose]:-}" ] && continue
        v=$(chain_try ${pose}_c $pose "${GENE[prone]}" 83)
        if [ "$v" -ge 3 ]; then concat dag4/${pose}_cc.json dag4/${pose}_c.json "${GENE[prone]}"; GENE[$pose]=dag4/${pose}_cc.json; REFS="$REFS,dag4/${pose}_cc.json"; POSES="$POSES,$pose:1"; say "keep $pose <- chain ($v/6)"; fi
    done
fi
if [ -n "${GENE[quadruped]:-}" ] && [ -z "${GENE[seated]:-}" ]; then
    v=$(chain_try seated_c seated "${GENE[quadruped]}" 84)
    if [ "$v" -ge 3 ]; then concat dag4/seated_cc.json dag4/seated_c.json "${GENE[quadruped]}"; GENE[seated]=dag4/seated_cc.json; REFS="$REFS,dag4/seated_cc.json"; POSES="$POSES,seated:1"; say "keep seated <- chain ($v/6)"; fi
fi
say "references: $REFS"
say "poses: $POSES"
echo "$REFS" > dag4/REFS.txt; echo "$POSES" > dag4/POSES.txt

say "phase 3: DAgger from f22 over all poses"
A="--poses $POSES --floor-frac 0.5 --floor-flat 0.85 --look 0 --lam 5 --d-max 2 --d-reanchor 2 --assume 0 --walk-stride 4 --cap 1500 --refs $REFS --crouch-frac 0.1 --crouch-teacher $CH --post-teacher $F22"
./walk3d_dagger --teacher $G31 --beta 1 --episodes 400 --workers $W --seed 201 --block 60000 $A --out dag4/d0.bin 2>&1 | grep -E "driven|teacher +[0-9]|recorded" >> "$L"
STUDENT=$F22
for r in 1 2 3 4 5; do
    ./walk3d_dagger --teacher $G31 --student $STUDENT --beta 0 --episodes 400 --workers $W --seed $((201+r)) --block $((60000+r*1000)) $A --out dag4/d$r.bin 2>&1 | grep -E "driven|teacher +[0-9]" >> "$L"
    python3 distil.py --out dag4/s$r.json --epochs 40 --threads $W --rise-w 6 --seed $r --gen $((20+r)) dag3/d[0-9].bin dag3/d1[0-4].bin dag4/d[0-9].bin 2>&1 | grep -E "wrote|total" >> "$L"
    STUDENT=dag4/s$r.json
    say "round $r done -> $STUDENT"
done
say "phase 3b: five seed fits of everything"
for s in 51 52 53; do python3 distil.py --out dag4/g$s.json --epochs 40 --threads 20 --rise-w 6 --seed $s --gen 30 dag3/d[0-9].bin dag3/d1[0-4].bin dag4/d[0-9].bin >/dev/null 2>&1 & done; wait
for s in 54 55; do python3 distil.py --out dag4/g$s.json --epochs 40 --threads 30 --rise-w 6 --seed $s --gen 30 dag3/d[0-9].bin dag3/d1[0-4].bin dag4/d[0-9].bin >/dev/null 2>&1 & done; wait

say "phase 4: duels"
CANDS="$F22 dag4/s3.json dag4/s4.json dag4/s5.json dag4/g51.json dag4/g52.json dag4/g53.json dag4/g54.json dag4/g55.json"
REFS=$REFS POST=$F22 POSES=$POSES ./duel_all.sh 99000 $W $CANDS > dag4/duelA.log 2>&1
REFS=$REFS POST=$F22 POSES=$POSES ./duel_all.sh 77000 $W $CANDS > dag4/duelB.log 2>&1
python3 pick_best.py dag4/duelA.log dag4/duelB.log --incumbent $F22 --out dag4/BEST.json > dag4/SUMMARY.txt 2>&1
say "done: $(tail -2 dag4/SUMMARY.txt | head -1)"
