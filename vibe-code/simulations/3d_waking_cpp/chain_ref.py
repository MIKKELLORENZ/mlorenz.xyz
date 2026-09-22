#!/usr/bin/env python3
"""chain_ref.py — bake a chained reference for walk3d_dagger.

    python3 chain_ref.py out.json first.json second.json ...

The output is {pose, segments:[{knots, T, gene}, ...]}: the first gene played
from its own pose, then the next from where that left the body, exactly as
walk3d_risesearch --chain played them during the search (a jump at each
boundary). Do NOT resample onto one knot grid — that blends the boundary and
changes the knot spacing, and a chaotic open-loop rise does not survive either.
"""
import json, sys
out, parts = sys.argv[1], [json.load(open(f)) for f in sys.argv[2:]]
segs = []
for p in parts:
    if "segments" in p: segs += p["segments"]
    else: segs.append({"knots": p["knots"], "T": p["T"], "gene": p["gene"]})
json.dump({"pose": parts[0]["pose"], "nj": parts[0]["nj"], "T": sum(s["T"] for s in segs),
           "segments": segs, "chained": sys.argv[2:]}, open(out, "w"))
print(f"wrote {out}: {parts[0]['pose']}, {len(segs)} segments, {sum(s['T'] for s in segs):.1f} s")
