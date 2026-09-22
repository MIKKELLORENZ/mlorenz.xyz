"""Tone-map a linear float32 render from render.mjs into a display image.

    python post.py in.f32 out.png exposure=1.2 bloom=0.06

Bloom is two Gaussians (tight + wide) added back at low strength, ACES
filmic tone curve, sRGB encode, then +-0.5 LSB of noise so the soft halo on
black does not band once it is 8-bit (or JPEG).
"""
import json
import sys

import numpy as np
from PIL import Image


def load(path):
    meta = json.load(open(path[:-4] + ".json"))
    a = np.fromfile(path, dtype="<f4")
    ch = a.size // (meta["height"] * meta["width"])
    a = a.reshape(meta["height"], meta["width"], ch).astype(np.float64)
    if ch == 6:
        return a[..., :3], a[..., 3:], meta
    return a, np.zeros_like(a), meta


def blur(img, sigma):
    h, w, _ = img.shape
    pad = int(3 * sigma) + 1
    p = np.pad(img, ((pad, pad), (pad, pad), (0, 0)))
    H, W = p.shape[:2]
    fy = np.fft.fftfreq(H)[:, None]
    fx = np.fft.rfftfreq(W)[None, :]
    k = np.exp(-2 * (np.pi * sigma) ** 2 * (fx ** 2 + fy ** 2))
    out = np.empty_like(p)
    for c in range(3):
        out[..., c] = np.fft.irfft2(np.fft.rfft2(p[..., c]) * k, s=(H, W))
    return out[pad:pad + h, pad:pad + w]


def aces(x):
    return np.clip(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0, 1)


def srgb(x):
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def main():
    src, dst = sys.argv[1], sys.argv[2]
    opt = {"exposure": 1.0, "bloom": 0.06, "tight": 0.0025, "wide": 0.018, "seed": 3, "contrast": 1.0, "pivot": 0.5,
           "stars": 1.0, "sat": 1.0, "edge": 0.0}
    for a in sys.argv[3:]:
        k, v = a.split("=")
        opt[k] = float(v)
    img, sky, meta = load(src)
    img *= opt["exposure"]
    if opt["contrast"] != 1.0:
        # power curve on luminance around a pivot, hue preserved
        lum = np.maximum(img @ np.array([0.2126, 0.7152, 0.0722]), 1e-9)[..., None]
        img = img * (np.power(lum / opt["pivot"], opt["contrast"] - 1))
    w = img.shape[1]
    if opt["bloom"] > 0:
        glow = 0.6 * blur(img, w * opt["tight"]) + 0.4 * blur(img, w * opt["wide"])
        img = img + opt["bloom"] * np.maximum(glow, 0)
    img = img + opt["stars"] * opt["exposure"] * sky      # stars skip the contrast curve
    if opt["sat"] != 1.0:
        lum = (img @ np.array([0.2126, 0.7152, 0.0722]))[..., None]
        img = lum + (img - lum) * opt["sat"]
    if opt["edge"] > 0:
        # fade every edge to pure black so the frame never shows on a black page
        h, w_ = img.shape[:2]
        def ramp(n):
            t = np.clip(np.minimum(np.arange(n) + 0.5, n - np.arange(n) - 0.5) / (opt["edge"] * n), 0, 1)
            return t * t * (3 - 2 * t)
        img = img * (ramp(h)[:, None] * ramp(w_)[None, :])[..., None]
    out = srgb(aces(np.maximum(img, 0)))
    rng = np.random.default_rng(int(opt["seed"]))
    out = out * 255 + rng.uniform(-0.5, 0.5, out.shape)
    Image.fromarray(np.clip(np.round(out), 0, 255).astype(np.uint8)).save(dst)
    print(dst, out.shape[1], "x", out.shape[0], "peak", round(float(img.max()), 3))


if __name__ == "__main__":
    main()
