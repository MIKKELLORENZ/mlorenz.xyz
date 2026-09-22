#!/bin/bash
# go_selfloop.sh — the self-labelled DAgger loop. Every round: the current
# best brain drives 400 episodes (walking + every floor pose that has a
# reference); rises it completes are labelled with ITS OWN actions, rises it
# fails keep the phase-tracked teacher labels; four seed fits on all the data
# with the rise weight set by SHARE (not a fixed multiplier); both-block duel
# against the incumbent; pick_best decides. References are re-read from
# dag5/REFS.txt each round so the search programme can add poses while this runs.
#
#   setsid nohup ./go_selfloop.sh > /dev/null 2>&1 < /dev/null &
set -u
cd /data/walk3d_cpp || exit 1
shopt -s nullglob
mkdir -p dag5
L=dag5/loop.log
say() { echo "[$(date -u +%H:%M)] $*" >> "$L"; }
CH=training/champion_gen6951_preRiseTrial.json
F22=dag/f22.json
G31=dag/polish_g31.json
KNEEL=dag/rob3_kneel.json
W=${W:-28}
FIT_T=${FIT_T:-7}
WARM=${WARM:-0}; LR=${LR:-3e-4}; EPOCHS=${EPOCHS:-10}
SHARE=${SHARE:-0.35}
ROUNDS=${ROUNDS:-40}
BEST=${BEST:-$F22}; [ -f dag5/BEST.json ] && BEST=$(cat dag5/BEST.txt 2>/dev/null || echo $F22)
STUDENT=$BEST
export DAGBIN=${DAGBIN:-./walk3d_dagger_new}
RISE_NET=${RISE_NET:-}   # closed-loop rise teacher (walk3d_dagger_rn): labels every downed state instead of the references
# post-rise handover teacher: the ORIGINAL champion by default — it is the
# finisher the kneel gene was searched with (5/6 held for 7 s); f22 as the
# post-teacher gave rises that collapsed within a second
POST=${POST:-$CH}
say "start: incumbent $BEST, workers $W, rise share $SHARE, warm $WARM lr $LR epochs $EPOCHS, bin $DAGBIN, rise-net ${RISE_NET:-none}"
# rounds continue from the highest existing dag5/d<N>.bin, so a restart never
# overwrites an earlier round's files — or the incumbent, which is one of them
R0=${R0:-$(ls dag5/d*.bin 2>/dev/null | sed -E 's|.*/d([0-9]+)\.bin|\1|' | sort -n | tail -1)}; R0=${R0:-0}
say "rounds start at $((R0+1))"
for ((r=R0+1; r<=R0+ROUNDS; r++)); do
    [ -f dag5/STOP ] && { say "STOP file seen"; break; }
    REFS=$KNEEL; POSES="kneel:2"
    [ -f dag5/REFS.txt ] && REFS=$(cat dag5/REFS.txt) && POSES=$(cat dag5/POSES.txt)
    A="--poses $POSES --floor-frac 0.5 --floor-flat 0.85 --look 0 --lam 5 --d-max 2 --d-reanchor 2 --assume 0 --walk-stride 4 --cap 1500 --refs $REFS --crouch-frac 0.1 --crouch-teacher $CH --post-teacher $POST --self-label 1 ${RISE_NET:+--rise-net $RISE_NET}"
    say "round $r: $STUDENT drives (refs $REFS)"
    $DAGBIN --teacher $G31 --student "$STUDENT" --beta 0 --episodes 400 --workers $W --seed $((300+r)) --block $((100000+r*1000)) $A --out dag5/d$r.bin 2>&1 | grep -E "driven|teacher +[0-9]|samples:" >> "$L"
    DATA="dag3/d[0-9].bin dag3/d1[0-4].bin dag5/d[0-9].bin dag5/d[1-9][0-9].bin"
    CANDS=""
    for k in 1 2 3 4; do
        INIT=""; [ "$WARM" = 1 ] && INIT="--init $BEST --lr $LR --epochs $EPOCHS"
        python3 distil.py --out dag5/s${r}_$k.json --epochs 40 --threads $FIT_T --rise-share $SHARE $INIT --seed $((r*10+k)) --gen $((40+r)) \
            --lineage "self-label DAgger round $r seed $k; teacher polish_g31 + phase-tracked refs + own successful rises" $DATA > dag5/s${r}_$k.fit 2>&1 &
        CANDS="$CANDS dag5/s${r}_$k.json"
    done
    wait
    say "round $r: fits done ($(grep -h "rise share" dag5/s${r}_1.fit | cut -c1-80))"
    REFS=$REFS POST=$POST POSES=$POSES ./duel_all.sh $((200000+r*1000)) $W $BEST $CANDS > dag5/duelA_$r.log 2>&1
    REFS=$REFS POST=$POST POSES=$POSES ./duel_all.sh $((300000+r*1000)) $W $BEST $CANDS > dag5/duelB_$r.log 2>&1
    python3 pick_best.py dag5/duelA_$r.log dag5/duelB_$r.log --incumbent $BEST --out dag5/BEST.json > dag5/pick_$r.txt 2>&1
    cat dag5/pick_$r.txt >> "$L"
    WIN=$(grep "^wrote" dag5/pick_$r.txt | sed 's/.*= //')
    if [ -n "$WIN" ] && [ "$WIN" != "$BEST" ]; then BEST=$WIN; echo "$BEST" > dag5/BEST.txt; say "round $r: NEW BEST $BEST"; fi
    # the next round is driven by the best fit of this round even when it did
    # not beat the incumbent: DAgger needs the current student's states
    NXT=$(grep "^NEXT:" dag5/pick_$r.txt | sed "s/NEXT: //"); STUDENT=${NXT:-$BEST}
done
say "loop done: best $BEST"
