/* analyze.js — looks at the raw bytes before evolution starts.

   The GA is never TOLD that a file is a 736-pixel-wide RGB image or 16-bit stereo
   audio. What it gets is what any curious engineer would compute first: at which
   distances do bytes resemble each other? Two of them describe the file's SHAPE —
   p, one unit (3 = a pixel, 4 = a stereo frame) and S, one row (2208) — and designs
   are written relative to those ("one row up, one unit left"), so one design can run
   on every file. The shape is stored in each compressed file's header. Evolution
   still has to discover what to DO with a row or a unit.

   Also builds the fitness sample: a few aligned slices from across the file, so a
   candidate is judged on fur AND on background, not just on the top of the image. */

(function (root) {
'use strict';

// in-place radix-2 FFT
function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let cr = 1, ci = 0;
            for (let k = 0; k < len / 2; k++) {
                const a = i + k, b = a + len / 2;
                const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
                re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
                const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
            }
        }
    }
}

// normalised autocorrelation of the byte signal, lags 0..N/2, via Wiener–Khinchin
function autocorrelation(data) {
    let N = 1 << 17;
    while (N > 1024 && N > data.length) N >>= 1;
    const start = Math.max(0, Math.floor((data.length - N) / 2)), len = Math.min(N, data.length);
    const re = new Float64Array(N), im = new Float64Array(N);
    let mean = 0;
    for (let i = 0; i < len; i++) mean += data[start + i];
    mean /= Math.max(1, len);
    for (let i = 0; i < len; i++) re[i] = data[start + i] - mean;
    fft(re, im);
    for (let i = 0; i < N; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
    fft(re, im);                                   // forward again = inverse up to scale/reversal, fine for an even spectrum
    const out = new Float64Array(N >> 1), r0 = re[0] || 1;
    for (let i = 0; i < out.length; i++) out[i] = re[i] / r0;
    return out;
}

function analyze(data) {
    const n = data.length, acf = n >= 64 ? autocorrelation(data) : new Float64Array(1);
    // ---- small period: the lag (≤ 16) at which bytes resemble each other most
    // (judged on 1 - acf, the part NOT explained: 0.98 vs 0.95 looks like nothing as a
    // ratio, but it is 0.02 vs 0.05 of unexplained signal — a pixel, not a byte)
    let period = 1, bestMiss = acf.length > 1 ? 1 - acf[1] : 1;
    for (let L = 2; L <= 16 && L < acf.length; L++) if (1 - acf[L] < bestMiss * 0.7) { bestMiss = 1 - acf[L]; period = L; }
    // ---- long strides: sharp local maxima of the autocorrelation beyond lag 32
    const peaks = [];
    for (let L = 33; L < acf.length - 3; L++) {
        const v = acf[L];
        if (v < 0.25) continue;
        let isMax = true, around = 0, cnt = 0;
        for (let d = -24; d <= 24; d++) {
            if (d === 0 || L + d < 1 || L + d >= acf.length) continue;
            if (Math.abs(d) <= 3 && acf[L + d] > v) isMax = false;
            if (Math.abs(d) > period + 1) { around += acf[L + d]; cnt++; }
        }
        if (isMax && cnt && v - around / cnt > 0.08) peaks.push({ lag: L, v, sharp: v - around / cnt });
    }
    peaks.sort((a, b) => b.v * b.sharp - a.v * a.sharp);
    const strides = [];
    for (const p of peaks) {
        if (strides.length >= 2) break;
        // a multiple of a stride we already have is the same structure, not a new one
        if (strides.some(s => Math.abs(p.lag / s - Math.round(p.lag / s)) * s <= 2 || Math.abs(s / p.lag - Math.round(s / p.lag)) * p.lag <= 2)) continue;
        strides.push(p.lag);
    }
    // keep the fundamental: if S/2 or S/3 is ALSO a clear peak it was filtered above; good enough
    strides.sort((a, b) => a - b);

    // ---- does it look like 16-bit numbers? In little-endian PCM the high bytes carry
    // far less information than the low bytes (in a quiet passage they are just 00 / FF),
    // so compare the byte entropy at even and odd positions. Smoothness tests fail here:
    // a high byte flipping between 00 and FF around zero looks like the roughest signal there is.
    let looks16 = false, off16 = 0;
    if (n > 4096 && period % 2 === 0) {
        const hist = [new Float64Array(256), new Float64Array(256)], cnt = [0, 0], stride = Math.max(1, Math.floor(n / 120000)) * 2;
        for (let i = 0; i + 1 < n; i += stride) { hist[0][data[i]]++; hist[1][data[i + 1]]++; cnt[0]++; cnt[1]++; }
        const H = hist.map((h, k) => { let e = 0; for (let v = 0; v < 256; v++) if (h[v]) { const q = h[v] / cnt[k]; e -= q * Math.log2(q); } return e; });
        if (H[1] < H[0] * 0.8 - 0.2) looks16 = true;                          // high bytes at odd positions: aligned little-endian
        else if (H[0] < H[1] * 0.8 - 0.2) { looks16 = true; off16 = 1; }      // shifted by a byte (odd-length header) or big-endian
        // LOUD audio defeats the entropy test (its high bytes are busy too). There the low
        // bytes are as good as noise — neighbours differ by ~85 on average, the value for
        // uniform random bytes — while the SIGNED high bytes glide.
        if (!looks16) {
            const d = [0, 0], i8 = v => v < 128 ? v : v - 256;
            let cnt2 = 0;
            for (let i = 4; i + 1 < n; i += stride) { d[0] += Math.abs(data[i] - data[i - 2]); d[1] += Math.abs(i8(data[i + 1]) - i8(data[i - 1])); cnt2++; }
            d[0] /= cnt2; d[1] /= cnt2;
            if (d[0] > 50 && d[1] < d[0] * 0.4) looks16 = true;
            else { const e = [0, 0]; for (let i = 5; i + 1 < n; i += stride) { e[0] += Math.abs(data[i] - data[i - 2]); e[1] += Math.abs(i8(data[i + 1]) - i8(data[i - 1])); } if (e[0] / cnt2 > 50 && e[1] < e[0] * 0.4) { looks16 = true; off16 = 1; } }
        }
    }
    // One channel or two? Bytes cannot tell (their autocorrelation is dominated by the
    // noisy low bytes and called a mono recording "4-byte frames"); the 16-bit numbers
    // can: in interleaved stereo the same channel two samples back is closer than the
    // other channel one sample back, in mono it is the other way round.
    if (looks16) {
        const s16 = i => ((data[i + 1] << 8 | data[i]) << 16) >> 16, step = Math.max(2, Math.floor(n / 60000) * 2);
        let d1 = 0, d2 = 0;
        for (let i = off16 + 4; i + 1 < n; i += step) { const v = s16(i); d1 += Math.abs(v - s16(i - 2)); d2 += Math.abs(v - s16(i - 4)); }
        period = d2 < d1 * 0.9 ? 4 : 2;
    }
    // ---- text-like?
    let printable = 0;
    const step = Math.max(1, Math.floor(n / 50000));
    let seen = 0;
    for (let i = 0; i < n; i += step) { const c = data[i]; if ((c >= 32 && c < 127) || c === 10 || c === 13 || c === 9) printable++; seen++; }
    const texty = seen > 0 && printable / seen > 0.9;

    // ---- the offset alphabet mutations draw from
    const set = new Set([1, 2, 3, 4, 5, 6, 7, 8]);
    if (period > 1) for (let k = 1; k <= 4; k++) set.add(period * k);
    for (const S of strides) {
        for (let k = -2; k <= 2; k++) { set.add(S + k * period); set.add(S + k); }
        set.add(2 * S); set.add(2 * S + period); set.add(2 * S - period);
    }
    const offsets = [...set].filter(o => o >= 1 && o <= 65535 && o < n).sort((a, b) => a - b);
    // ---- a picture? only if rows × pixels give a shape somebody would call one
    let shape = null;
    if (!texty && !looks16 && strides.length && (period === 3 || period === 4) && strides[0] % period === 0) {
        const w = strides[0] / period, h = Math.floor(n / strides[0]);
        if (w >= 16 && h >= 16 && w / h < 8 && h / w < 8) shape = { w, h, ch: period };
    }
    const kind = texty ? 'text' : looks16 ? 'audio' : shape ? 'image' : 'binary';
    return { n, period, strides, looks16, off16, texty, shape, kind, offsets, acfSmall: Array.from(acf.subarray(0, Math.min(17, acf.length))) };
}

function gcd(a, b) { while (b) { const t = a % b; a = b; b = t; } return a; }

// Fitness sample: `chunks` aligned slices spread over the file, concatenated.
function buildSample(data, targetBytes, info) {
    const n = data.length;
    if (!targetBytes || targetBytes >= n) return { sample: data, whole: true, chunks: [[0, n]] };
    const S = info && info.strides.length ? info.strides[0] : 0, p = info ? info.period : 1;
    let align = S > 0 ? S : Math.max(4, p * 4);
    if (S > 0 && p > 1 && S % p !== 0) align = S * p / gcd(S, p);
    let chunks = 6;
    // with a row stride, the first row of every slice has a stranger above it — keep
    // slices at least 8 rows tall so that seam stays a small part of the verdict
    while (chunks > 1 && Math.floor(targetBytes / chunks / align) < (S > 0 ? 8 : 3)) chunks--;
    let len = Math.floor(targetBytes / chunks / align) * align;
    if (len <= 0) { align = 1; len = Math.floor(targetBytes / chunks); }
    const out = new Uint8Array(len * chunks), list = [];
    for (let k = 0; k < chunks; k++) {
        const centre = (k + 0.5) / chunks * n;
        let start = Math.floor((centre - len / 2) / align) * align;
        start = Math.max(0, Math.min(start, Math.floor((n - len) / align) * align));
        out.set(data.subarray(start, start + len), k * len);
        list.push([start, start + len]);
    }
    return { sample: out, whole: false, chunks: list };
}

root.CE = root.CE || {};
// what the codec needs to know about one file (goes into the header)
function shapeOf(info) { return { p: info.period, S: info.strides.length ? info.strides[0] : 0, s16: info.looks16 ? 1 : 0, off16: info.off16 ? 1 : 0, texty: info.texty ? 1 : 0 }; }
// what mutation needs to know about the file(s) it is designing for
function context(infos) {
    const sh = infos.map(shapeOf), n8 = sh.some(s => !s.s16 && !s.texty && (s.p > 1 || s.S > 0)), n16 = sh.some(s => s.s16);
    return { n8, n16, hasRows: sh.some(s => s.S > 0), hasUnits: sh.some(s => s.p > 1), texty: sh.some(s => s.texty), kind: infos.length === 1 ? infos[0].kind : 'mixed', engages: { front8: n8, front16: n16 }, files: infos.length };
}

root.CE.analyze = { analyze, buildSample, autocorrelation, shapeOf, context };
if (typeof module !== 'undefined' && module.exports) module.exports = root.CE;
})(typeof self !== 'undefined' ? self : globalThis);
