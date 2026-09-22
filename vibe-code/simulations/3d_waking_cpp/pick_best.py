#!/usr/bin/env python3
"""pick_best.py — read duel_all.sh output for two blocks and pick a brain.

    python3 pick_best.py duelA.log duelB.log --incumbent dag/f22.json --out dag4/BEST.json

Rule: a candidate must walk at least (incumbent - 0.3) wp on BOTH blocks; among
those, the highest total rise count over both blocks wins. Ties go to the
incumbent. Prints a table and writes the winner's path to --out (copying the
file), plus a one-line verdict.
"""
import argparse, re, shutil, sys
ap = argparse.ArgumentParser()
ap.add_argument("logs", nargs=2)
ap.add_argument("--incumbent", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--slack", type=float, default=0.3)
a = ap.parse_args()

def parse(path):
    res = {}; cur = None
    for line in open(path):
        m = re.match(r"== (\S+)", line)
        if m: cur = m.group(1); res[cur] = {"wp": None, "rise": {}}; continue
        if cur is None: continue
        m = re.search(r"student-driven\s+\d+:\s+([\d.]+) wp", line)
        if m: res[cur]["wp"] = float(m.group(1)); continue
        # "held a/b" (teacher/student rises that were not followed by a fall
        # within 3 s) is the count that matters when the harness prints it;
        # the plain "rose" count is the fallback for older logs
        m = re.match(r"\s+(\S+)\s+teacher\s+\d+/\d+\s+student\s+(\d+)/(\d+)(?:\s+held\s+\d+/(\d+))?", line)
        if m: res[cur]["rise"][m.group(1)] = (int(m.group(4)) if m.group(4) is not None else int(m.group(2)), int(m.group(3)))
    return res

A, B = parse(a.logs[0]), parse(a.logs[1])
names = [n for n in A if n in B and A[n]["wp"] is not None and B[n]["wp"] is not None]
inc = a.incumbent
if inc not in names: print("incumbent missing from a log"); sys.exit(2)
def tot(r): return sum(v[0] for v in r["rise"].values()), sum(v[1] for v in r["rise"].values())
print(f"{'brain':40s} {'wpA':>6s} {'wpB':>6s} {'riseA':>9s} {'riseB':>9s}  per-pose (A)")
rows = []
for n in names:
    ra, rb = tot(A[n]), tot(B[n])
    per = " ".join(f"{k}={v[0]}/{v[1]}" for k, v in sorted(A[n]["rise"].items()))
    print(f"{n:40s} {A[n]['wp']:6.2f} {B[n]['wp']:6.2f} {ra[0]:4d}/{ra[1]:<4d} {rb[0]:4d}/{rb[1]:<4d}  {per}")
    rows.append((n, A[n]["wp"], B[n]["wp"], ra[0] + rb[0]))
floorA, floorB = A[inc]["wp"] - a.slack, B[inc]["wp"] - a.slack
ok = [r for r in rows if r[1] >= floorA and r[2] >= floorB]
incRise = next(r[3] for r in rows if r[0] == inc)
best = max(ok, key=lambda r: (r[3], r[1] + r[2])) if ok else None
if best is None or (best[0] != inc and best[3] <= incRise):
    winner = inc; print(f"VERDICT: keep incumbent {inc} (no candidate walks within {a.slack} wp on both blocks with more rises)")
else:
    winner = best[0]; print(f"VERDICT: {winner} — rises {best[3]} vs incumbent {incRise}, walking {best[1]:.2f}/{best[2]:.2f}")
shutil.copyfile(winner, a.out)
print(f"wrote {a.out} = {winner}")
# NEXT: who should drive the next DAgger round — the best admissible candidate
# by the same rule, the incumbent only if no candidate is admissible
nxt = max(ok, key=lambda r: (r[3], r[1] + r[2]))[0] if ok else inc
print(f"NEXT: {nxt}")
