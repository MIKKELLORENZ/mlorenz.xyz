#!/bin/bash
# go_more.sh — unattended follow-up on the node: one on-policy DAgger round
# driven by the shipped student (f22), five fits of the enlarged data with
# different seeds, both-block duels of all of them against f22, then the one
# untried quadruped formulation (residual mode: the champion drives throughout
# and the gene is an offset). Everything it decides on lands in dag3/sweep2.log.
cd ~/walk3d_cpp || exit 1
L=dag3/sweep2.log; : > "$L"
T=dag/polish_g31.json; C=training/champion_gen6951_preRiseTrial.json
A="--poses kneel:1 --floor-flat 0.85 --look 0 --lam 5 --d-max 2 --d-reanchor 2 --assume 0 --walk-stride 4 --cap 1500 --refs dag/rob3_kneel.json --crouch-frac 0.15 --floor-frac 0.45 --crouch-teacher $C"
echo "[$(date -u +%H:%M)] round 14: f22 drives" >> "$L"
./walk3d_dagger --teacher $T --student dag3/f22.json --beta 0 --episodes 300 --workers 60 --seed 114 --block 49000 $A --out dag3/d14.bin 2>&1 | grep -E "driven|teacher +[0-9]" >> "$L"
F="dag3/d[0-9].bin dag3/d1[0-4].bin"
for s in 41 42 43; do python3 distil.py --out dag3/g$s.json --epochs 40 --threads 20 --rise-w 6 --seed $s --gen 16 $F >/dev/null 2>&1 & done; wait
for s in 44 45; do python3 distil.py --out dag3/g$s.json --epochs 40 --threads 30 --rise-w 6 --seed $s --gen 16 $F >/dev/null 2>&1 & done; wait
echo "[$(date -u +%H:%M)] duel block 99000 (f22 first, for reference)" >> "$L"
./duel_final.sh 99000 60 dag3/f22.json dag3/g41.json dag3/g42.json dag3/g43.json dag3/g44.json dag3/g45.json 2>&1 | grep -E "==|student-driven|kneel" >> "$L"
echo "[$(date -u +%H:%M)] duel block 77000" >> "$L"
./duel_final.sh 77000 60 dag3/f22.json dag3/g41.json dag3/g42.json dag3/g43.json dag3/g44.json dag3/g45.json 2>&1 | grep -E "==|student-driven|kneel" >> "$L"
echo "[$(date -u +%H:%M)] sweep done; residual quadruped search next" >> "$L"
./walk3d_risesearch_c --pose quadruped --finisher $C --residual 0.35 --finish 5 --settle 2 --knots 6 --T 3 --gens 300 --pop 192 --workers 60 --seeds 12 --seed 71 --out dag/resid_quadruped.json > dag/resid_quadruped.log 2>&1
tail -1 dag/resid_quadruped.log >> "$L"
echo "[$(date -u +%H:%M)] all done" >> "$L"
