#!/bin/bash
# go_search2.sh — dense-target chain searches for the poses the 3 s finisher
# search could not solve. Each gene is asked to END NEAR THE START POSE of the
# next link (--target), the chain of already-solved genes plays after it, and
# the ORIGINAL champion finishes (finisher quality bounds the search — the f22
# finisher got 1/6 where the champion got 5/6 on the same kneel search).
#
# A validated chain is baked by chain_ref.py and appended to dag5/REFS.txt and
# dag5/POSES.txt, which the self-label DAgger loop re-reads every round.
#
#   setsid nohup ./go_search2.sh > /dev/null 2>&1 < /dev/null &
set -u
cd /data/walk3d_cpp || exit 1
mkdir -p dag5
L=dag5/search.log
say() { echo "[$(date -u +%H:%M)] $*" >> "$L"; }
CH=training/champion_gen6951_preRiseTrial.json
KNEEL=dag/rob3_kneel.json
W=${W:-40}
REFS=$KNEEL; POSES="kneel:2"
[ -f dag5/REFS.txt ] && REFS=$(cat dag5/REFS.txt) && POSES=$(cat dag5/POSES.txt)
publish() { echo "$REFS" > dag5/REFS.txt; echo "$POSES" > dag5/POSES.txt; say "refs now: $REFS | poses: $POSES"; }

search() {   # name pose target chain(-|a,b) init(none|file) seed [extra...]
    local name=$1 pose=$2 target=$3 chain=$4 init=$5 seed=$6; shift 6
    [ -f "dag5/$name.json" ] && { say "search $name exists, skipped"; standing_of "$name"; return; }
    local chainArg=(); [ "$chain" != "-" ] && chainArg=(--chain "$chain")
    ./walk3d_risesearch_d --pose "$pose" --target "$target" --target-w 0.5 "${chainArg[@]}" --finisher $CH \
        --finish 5 --settle 2 --knots 6 --T 3 --init "$init" --gens 300 --pop 160 --elite 20 --workers $W --seeds 12 --sigma 0.05 --seed "$seed" \
        --out "dag5/$name.json" "$@" > "dag5/$name.log" 2>&1
    say "search $name ($pose -> $target, chain $chain, init $init): $(grep winner "dag5/$name.log" | cut -c9-140)"
    standing_of "$name"
}
standing_of() { local v; v=$(grep -o "standing [0-9]/6" "dag5/$1.log" 2>/dev/null | tail -1 | grep -o "^standing [0-9]" | grep -o "[0-9]"); echo "${v:-0}"; }
best_of() {   # name-a name-b -> "name standing"
    local va vb; va=$(standing_of "$1"); vb=$(standing_of "$2")
    if [ "$vb" -gt "$va" ]; then echo "$2 $vb"; else echo "$1 $va"; fi
}

say "phase A: quadruped -> kneel (chain kneel gene, champion finisher)"
search q2k_a quadruped kneel "$KNEEL" none 71 >/dev/null
search q2k_b quadruped kneel "$KNEEL" dag/rob3_quadruped.json 72 >/dev/null
r=$(best_of q2k_a q2k_b); set -- $r; QNAME=$1; QV=$2
if [ "$QV" -lt 3 ]; then
    search q2k_c quadruped kneel "$KNEEL" none 76 --knots 8 --T 4.2 --sigma 0.08 >/dev/null
    r=$(best_of "$QNAME" q2k_c); set -- $r; QNAME=$1; QV=$2
fi
QCHAIN=""
if [ "$QV" -ge 3 ]; then
    python3 chain_ref.py dag5/quad_ref.json "dag5/$QNAME.json" $KNEEL >> "$L"
    QCHAIN="dag5/$QNAME.json,$KNEEL"; REFS="$REFS,dag5/quad_ref.json"; POSES="$POSES,quadruped:2"; publish
    say "quadruped SOLVED via $QNAME ($QV/6)"
else say "quadruped not solved (best $QNAME $QV/6)"; fi

say "phase B: seated -> kneel"
search s2k seated kneel "$KNEEL" none 75 >/dev/null
v=$(standing_of s2k)
if [ "$v" -ge 3 ]; then python3 chain_ref.py dag5/seated_ref.json dag5/s2k.json $KNEEL >> "$L"; REFS="$REFS,dag5/seated_ref.json"; POSES="$POSES,seated:1"; publish; say "seated SOLVED ($v/6)"; fi

if [ -n "$QCHAIN" ]; then
    say "phase C: prone -> quadruped (chain $QCHAIN)"
    search p2q_a prone quadruped "$QCHAIN" none 73 >/dev/null
    search p2q_b prone quadruped "$QCHAIN" dag/rob_prone.json 74 >/dev/null
    r=$(best_of p2q_a p2q_b); set -- $r; PNAME=$1; PV=$2
    if [ "$PV" -lt 3 ]; then
        search p2q_c prone quadruped "$QCHAIN" none 77 --knots 8 --T 4.2 --sigma 0.08 >/dev/null
        r=$(best_of "$PNAME" p2q_c); set -- $r; PNAME=$1; PV=$2
    fi
    if [ "$PV" -ge 3 ]; then
        python3 chain_ref.py dag5/prone_ref.json "dag5/$PNAME.json" "dag5/$QNAME.json" $KNEEL >> "$L"
        PCHAIN="dag5/$PNAME.json,$QCHAIN"; REFS="$REFS,dag5/prone_ref.json"; POSES="$POSES,prone:2"; publish
        say "prone SOLVED via $PNAME ($PV/6)"
        say "phase D: supine / side / curled -> prone (chain $PCHAIN)"
        for spec in "sup2p supine 78" "side2p side 79" "curl2p curled 80"; do
            set -- $spec
            search "$1" "$2" prone "$PCHAIN" none "$3" >/dev/null
            v=$(standing_of "$1")
            if [ "$v" -ge 3 ]; then python3 chain_ref.py "dag5/${2}_ref.json" "dag5/$1.json" "dag5/$PNAME.json" "dag5/$QNAME.json" $KNEEL >> "$L"; REFS="$REFS,dag5/${2}_ref.json"; POSES="$POSES,$2:1"; publish; say "$2 SOLVED ($v/6)"; fi
        done
    else say "prone not solved (best $PNAME $PV/6)"; fi
fi
say "search programme done"
