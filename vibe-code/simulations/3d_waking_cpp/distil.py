#!/usr/bin/env python3
"""distil.py — fit the walker's network to teacher labels collected by walk3d_dagger.

    python3 distil.py --out dag/s1.json dag/d0.bin [dag/d1.bin ...]

Trains 365-48-32-33 (leaky ReLU 0.1 per hidden unit, sigmoid out) from scratch on
the union of the sample files, and writes a champion-format JSON the C++ trainer,
the exam and the browser all load unchanged.

Two things are deliberate:

  * Inputs are standardised for training and the standardisation is FOLDED into
    the first layer at export, so the shipped net reads raw sensors. The contract
    has no normalisation layer and must not grow one.
  * Rise samples are up-weighted. A walking episode contributes hundreds of
    near-identical upright states; the rise is a few hundred samples per
    episode and the whole point. Without the weight the MSE optimum is "walk
    well, ignore the floor" — the class-imbalance placebo from the bioreactor
    notes.

The export is checked against a NumPy re-implementation of nn.hpp's forward
pass (float32 weights, double accumulation) before it is written.
"""
import argparse, json, struct, sys, time, hashlib
import numpy as np
import torch, torch.nn as nn

ap = argparse.ArgumentParser()
ap.add_argument("files", nargs="+")
ap.add_argument("--out", required=True)
ap.add_argument("--epochs", type=int, default=40)
ap.add_argument("--batch", type=int, default=2048)
ap.add_argument("--lr", type=float, default=2e-3)
ap.add_argument("--rise-w", type=float, default=4.0)
ap.add_argument("--self-w", type=float, default=0.0, help="weight of self-labelled rise samples (0 = same as --rise-w)")
ap.add_argument("--rise-share", type=float, default=0.0, help="if >0, set rise-w so rise samples carry this share of the loss weight")
ap.add_argument("--hidden", default="48,32")
ap.add_argument("--seed", type=int, default=1)
ap.add_argument("--val-frac", type=float, default=0.1)
ap.add_argument("--threads", type=int, default=32)
ap.add_argument("--lineage", default="")
ap.add_argument("--gen", type=int, default=0)
ap.add_argument("--init", default="", help="warm start from this champion JSON (raw-input space, low lr)")
args = ap.parse_args()

torch.manual_seed(args.seed); np.random.seed(args.seed)
torch.set_num_threads(args.threads)

def load(path):
    with open(path, "rb") as f:
        magic = f.read(8)
        assert magic[:5] == b"WDAG1", path
        nin, nout = struct.unpack("<ii", f.read(8))
        rec = np.dtype([("ep", "<i4"), ("src", "u1"), ("driver", "u1"), ("pad", "<u2"),
                        ("x", "<f4", (nin,)), ("y", "<f4", (nout,))])
        data = np.fromfile(f, dtype=rec)
    return nin, nout, data

parts = []; nin = nout = None
for i, p in enumerate(args.files):
    a, b, d = load(p)
    if nin is None: nin, nout = a, b
    assert (a, b) == (nin, nout)
    d = d.copy(); d["ep"] += i * 100000        # episodes unique across files
    parts.append(d)
    print(f"  {p}: {len(d)} samples ({int((d['src']==1).sum())} rise)")
D = np.concatenate(parts)
X = D["x"].astype(np.float32); Y = D["y"].astype(np.float32)
src = D["src"].astype(np.int64); ep = D["ep"]
N = len(D)
print(f"total {N} samples, {int((src==1).sum())} rise, {nin} in, {nout} out")

# validation split BY EPISODE, so a held-out state is not a neighbour of a training one
eps = np.unique(ep); rng = np.random.default_rng(args.seed); rng.shuffle(eps)
val_eps = set(eps[: max(1, int(len(eps) * args.val_frac))].tolist())
isval = np.array([e in val_eps for e in ep])
mean = X[~isval].mean(0); std = X[~isval].std(0)
std = np.maximum(std, 0.05).astype(np.float32)   # near-constant channels: do not blow them up
Xn = (X - mean) / std
if args.rise_share > 0:
    # weight the rise samples so they carry a fixed SHARE of the total loss
    # weight, whatever fraction of the data they are. rise-w 6 was tuned at 6%
    # rise data and collapsed walking at 19%; the share is what was meant.
    n_rise = int((src != 0).sum()); n_walk = N - n_rise
    args.rise_w = float(np.clip(args.rise_share / (1 - args.rise_share) * n_walk / max(1, n_rise), 1.0, 8.0))
    print(f"rise share {args.rise_share:.2f} of the loss weight -> rise-w {args.rise_w:.2f} ({n_rise} rise of {N})")
w = np.where(src == 1, args.rise_w, 1.0).astype(np.float32)
# src 3 = the student's own actions on a rise it completed (--self-label); the
# most trustworthy rise label there is, weighted like the others unless told
w[src == 3] = args.self_w if args.self_w > 0 else args.rise_w
print(f"self-labelled rise samples: {int((src == 3).sum())}")

hid = [int(h) for h in args.hidden.split(",")]
sizes = [nin] + hid + [nout]

class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.l = nn.ModuleList([nn.Linear(sizes[i], sizes[i+1]) for i in range(len(sizes)-1)])
    def forward(self, x):
        for i, l in enumerate(self.l):
            x = l(x)
            if i < len(self.l) - 1: x = torch.nn.functional.leaky_relu(x, 0.1)
        return torch.sigmoid(x)

net = Net()
# --init: WARM START from an exported champion (folded weights, raw inputs).
# Five from-scratch refits of identical data spanned 0.1-6.1 wp — the random
# init decides more than the data. Starting from the incumbent and training
# briefly at a low rate keeps what it already does and moves only what the new
# samples disagree with. Training then runs in RAW input space (mean 0, std 1)
# so the loaded layer-1 weights mean what they meant.
if args.init:
    mean = np.zeros_like(mean); std = np.ones_like(std)
    Xn = X
    saved = json.load(open(args.init)); raw = saved.get("net", saved)
    assert raw["sizes"] == sizes, f"--init has shape {raw['sizes']}, fitting {sizes}"
    with torch.no_grad():
        for li, l in enumerate(net.l):
            rows = np.asarray(raw["weights"][li], dtype=np.float32).reshape(sizes[li+1], sizes[li] + 1)
            l.weight.copy_(torch.from_numpy(rows[:, :-1])); l.bias.copy_(torch.from_numpy(rows[:, -1]))
    print(f"warm start from {args.init} (lr {args.lr}, {args.epochs} epochs)")
Xt = torch.from_numpy(Xn); Yt = torch.from_numpy(Y); Wt = torch.from_numpy(w)
tr = torch.from_numpy(np.where(~isval)[0]); va = torch.from_numpy(np.where(isval)[0])
opt = torch.optim.Adam(net.parameters(), lr=args.lr)
steps = args.epochs * ((len(tr) + args.batch - 1) // args.batch)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=steps, pct_start=0.1)

def evaluate(idx):
    net.eval()
    with torch.no_grad():
        out = {"walk": [0.0, 0], "rise": [0.0, 0]}
        for s in range(0, len(idx), 65536):
            b = idx[s:s+65536]
            p = net(Xt[b]); e = ((p - Yt[b]) ** 2).mean(1)
            sb = torch.from_numpy(src[b.numpy()])
            for name, code in (("walk", 0), ("rise", 1)):
                m = sb == code
                if m.any(): out[name][0] += e[m].sum().item(); out[name][1] += int(m.sum())
    net.train()
    return {k: (v[0] / v[1] if v[1] else float("nan")) for k, v in out.items()}

t0 = time.time()
for epoch in range(args.epochs):
    perm = tr[torch.randperm(len(tr))]
    tot = 0.0; n = 0
    for s in range(0, len(perm), args.batch):
        b = perm[s:s+args.batch]
        p = net(Xt[b])
        loss = (((p - Yt[b]) ** 2).mean(1) * Wt[b]).mean()
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
        tot += loss.item() * len(b); n += len(b)
    if epoch % 5 == 4 or epoch == args.epochs - 1:
        ev = evaluate(va); et = evaluate(tr[:200000])
        print(f"epoch {epoch+1:3d}  loss {tot/n:.5f}  train walk {et['walk']:.5f} rise {et['rise']:.5f}"
              f"  val walk {ev['walk']:.5f} rise {ev['rise']:.5f}  {time.time()-t0:.0f}s", flush=True)

# ---- export: fold the standardisation into layer 1 ----
Ws = [l.weight.detach().numpy().astype(np.float64) for l in net.l]
Bs = [l.bias.detach().numpy().astype(np.float64) for l in net.l]
W1 = Ws[0] / std[None, :]
B1 = Bs[0] - W1 @ mean.astype(np.float64)
Ws[0] = W1; Bs[0] = B1
layers = []
for W, B in zip(Ws, Bs):
    rows = np.concatenate([W, B[:, None]], axis=1).astype(np.float32)   # out x (in+1), bias last
    layers.append(rows)

def cpp_forward(x):
    """nn.hpp: float32 weights, double accumulation, per-unit leaky slope, sigmoid out."""
    cur = x.astype(np.float32).astype(np.float64)
    for li, rows in enumerate(layers):
        Wf = rows[:, :-1].astype(np.float64); bf = rows[:, -1].astype(np.float64)
        s = Wf @ cur + bf
        if li < len(layers) - 1: cur = np.where(s > 0, s, 0.1 * s).astype(np.float32).astype(np.float64)
        else: cur = (1.0 / (1.0 + np.exp(-s))).astype(np.float32).astype(np.float64)
    return cur

net.eval()
with torch.no_grad():
    chk = torch.from_numpy(np.where(isval)[0][:256] if isval.any() else np.arange(256))
    pt = net(Xt[chk]).numpy()
worst = 0.0
for i, j in enumerate(chk.numpy()):
    worst = max(worst, float(np.abs(cpp_forward(X[j]) - pt[i]).max()))
print(f"export parity vs nn.hpp forward on {len(chk)} raw-input samples: max |diff| {worst:.2e}")
if worst > 2e-3:
    print("REFUSING to write: folded export disagrees with the trained net"); sys.exit(1)

net_json = {
    "sizes": sizes, "act": "lrelu",
    "slopes": [[0.1] * h for h in hid],
    "weights": [rows.reshape(-1).tolist() for rows in layers],
}
h = hashlib.sha1(json.dumps(net_json["weights"]).encode()).hexdigest()[:8]
doc = {
    "net": net_json, "fitness": 0, "gen": args.gen, "netSizes": sizes, "stage": 5,
    "savedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "lineage": args.lineage or f"distilled by gradient (DAgger) from {len(args.files)} sample file(s), {N} samples; NOT evolved",
    "distil": {"files": args.files, "samples": int(N), "rise": int((src == 1).sum()), "epochs": args.epochs,
               "riseW": args.rise_w, "init": args.init, "lr": args.lr, "batch": args.batch, "hidden": hid, "seed": args.seed,
               "valWalk": evaluate(va)["walk"], "valRise": evaluate(va)["rise"], "hash": h},
    "history": [],
}
with open(args.out, "w") as f: json.dump(doc, f)
print(f"wrote {args.out}  ({h})")
