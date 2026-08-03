/* net_surgery.js — move a trained brain into a different body without losing it.
 *
 * The architecture search so far could only ever start each candidate shape from
 * random weights, which makes "is a third hidden layer better" a question about
 * how fast a shape learns from nothing — not about whether the *brain we already
 * have* would be better with one. Those are different questions, and only the
 * second one matters once a champion exists that took 14,000 generations to
 * produce.
 *
 * So: transplant. Build the new body, then fill it with the old weights, adding
 * new ones only where the new body has parts the old one did not.
 *
 *   grow a hidden layer   new units get random incoming weights and *zero*
 *                         outgoing ones, so the network computes exactly what it
 *                         computed before. The new units are inert at birth and
 *                         mutation wakes them; nothing is lost while they wake.
 *   shrink a hidden layer units are ranked by the L2 norm of their outgoing
 *                         weights and the weakest are dropped. Not lossless —
 *                         nothing could be — but it drops what the next layer
 *                         was listening to least.
 *   add a layer           inserted as an identity map. With a ReLU-family hidden
 *                         activation this is *exactly* function-preserving,
 *                         because the layer it copies is already non-negative
 *                         and relu(x) = x there. (With tanh it is an
 *                         approximation, and transplant() says so.)
 *   drop a layer          the two weight matrices around it are multiplied
 *                         together. Exact only if the activation between them
 *                         were the identity, so again an approximation — but one
 *                         built from the trained weights rather than from noise.
 *   swap activation       no surgery at all: same weights, different nonlinearity.
 *
 * Everything here is arithmetic on saved weights. There is no gradient, no
 * fine-tuning step and no optimiser: the transplanted brain is handed straight to
 * the GA, which is the only thing in this project that ever changes a weight.
 *
 * Conv stacks are refused on purpose. Growing a filter bank is easy, but every
 * dense-head weight is indexed by a position in a feature map whose *shape*
 * changes with the conv spec, so there is no honest correspondence to preserve.
 */
"use strict";

/* Rank hidden units by how loudly the next layer listens to them. */
function _outgoingNorms(weights, layout, n) {
    const w = weights, lay = layout, out = new Float64Array(n);
    for (let j = 0; j < n; j++) {
        let s = 0;
        for (let o = 0; o < lay.rows; o++) { const v = w[o * lay.rowLen + j]; s += v * v; }
        out[j] = s;
    }
    return out;
}

/* Same number of layers, different widths. */
function _resize(old, newSizes, acts, rng) {
    const L = old.sizes.length;
    /* keep[k] — for each layer, which old units survive into the new one, or
     * null for "all of them, in order" (unchanged or widened). */
    const keep = [];
    for (let k = 0; k < L; k++) {
        const on = old.sizes[k], nn = newSizes[k];
        if (k === 0 || k === L - 1) {
            if (on !== nn) {
                throw new Error(`cannot resize layer ${k}: ${on} → ${nn} ` +
                    `(the input and output widths are fixed by the sensors and the keyboard)`);
            }
            keep.push(null);
        } else if (nn >= on) {
            keep.push(null);
        } else {
            const score = _outgoingNorms(old.weights[k], old.layout[k], on);
            const idx = Array.from({ length: on }, (_, j) => j)
                .sort((a, b) => score[b] - score[a]).slice(0, nn).sort((a, b) => a - b);
            keep.push(idx);
        }
    }

    const net = new Net(newSizes, null, acts);
    for (let l = 0; l < newSizes.length - 1; l++) {
        const nw = net.weights[l], nlay = net.layout[l];
        const ow = old.weights[l], olay = old.layout[l];
        const inMap = keep[l], outMap = keep[l + 1];
        const oldIn = old.sizes[l], newIn = newSizes[l];
        const oldOut = old.sizes[l + 1], newOut = newSizes[l + 1];
        const nIn = inMap ? inMap.length : Math.min(oldIn, newIn);
        const nOut = outMap ? outMap.length : Math.min(oldOut, newOut);
        const scale = Math.sqrt(2 / Math.max(1, newIn));
        for (let o = 0; o < newOut; o++) {
            const nb = o * nlay.rowLen;
            if (o < nOut) {
                const ob = (outMap ? outMap[o] : o) * olay.rowLen;
                for (let i = 0; i < nIn; i++) nw[nb + i] = ow[ob + (inMap ? inMap[i] : i)];
                // columns for units that did not exist upstream: zero, so the
                // transplant changes nothing until mutation says otherwise
                for (let i = nIn; i < newIn; i++) nw[nb + i] = 0;
                nw[nb + newIn] = ow[ob + oldIn];                     // bias
            } else {
                // a brand-new unit: something to say, nobody listening yet
                for (let i = 0; i < newIn; i++) nw[nb + i] = gaussRand(rng) * scale;
                nw[nb + newIn] = 0;
            }
        }
    }
    net.sigma = old.sigma;
    return net;
}

/* One more hidden layer, inserted just before the output as an identity map. */
function _deepen(old, size, acts, rng) {
    const s = old.sizes, nb = old.weights.length;
    const h = s[s.length - 2];                       // width being copied
    const outN = s[s.length - 1];
    const newSizes = s.slice(0, -1).concat([size, outN]);
    const net = new Net(newSizes, null, acts);

    for (let l = 0; l < nb - 1; l++) net.weights[l].set(old.weights[l]);

    const idw = net.weights[nb - 1], idl = net.layout[nb - 1];
    const sc = Math.sqrt(2 / Math.max(1, h));
    for (let o = 0; o < size; o++) {
        const base = o * idl.rowLen;
        if (o < h) idw[base + o] = 1;                                  // pass through
        else for (let i = 0; i < h; i++) idw[base + i] = gaussRand(rng) * sc;
        idw[base + h] = 0;
    }

    const ow = old.weights[nb - 1], olay = old.layout[nb - 1];
    const nw = net.weights[nb], nlay = net.layout[nb];
    for (let o = 0; o < outN; o++) {
        const b0 = o * nlay.rowLen, b1 = o * olay.rowLen;
        for (let i = 0; i < h; i++) nw[b0 + i] = ow[b1 + i];
        for (let i = h; i < size; i++) nw[b0 + i] = 0;                 // the extra units
        nw[b0 + size] = ow[b1 + h];
    }
    net.sigma = old.sigma;
    return net;
}

/* One fewer hidden layer: fold the last two weight matrices into one. */
function _shallow(old, acts) {
    const s = old.sizes, nb = old.weights.length;
    if (s.length < 4) throw new Error("nothing to drop: only one hidden layer");
    const P = s[s.length - 3], H = s[s.length - 2], O = s[s.length - 1];
    const newSizes = s.slice(0, -2).concat([O]);
    const net = new Net(newSizes, null, acts);
    for (let l = 0; l < nb - 2; l++) net.weights[l].set(old.weights[l]);

    const A = old.weights[nb - 2], la = old.layout[nb - 2];   // P → H
    const B = old.weights[nb - 1], lb = old.layout[nb - 1];   // H → O
    const C = net.weights[nb - 2], lc = net.layout[nb - 2];   // P → O
    for (let o = 0; o < O; o++) {
        for (let i = 0; i < P; i++) {
            let sum = 0;
            for (let j = 0; j < H; j++) sum += B[o * lb.rowLen + j] * A[j * la.rowLen + i];
            C[o * lc.rowLen + i] = sum;
        }
        let bias = B[o * lb.rowLen + H];
        for (let j = 0; j < H; j++) bias += B[o * lb.rowLen + j] * A[j * la.rowLen + P];
        C[o * lc.rowLen + P] = bias;
    }
    net.sigma = old.sigma;
    return net;
}

function _sameArr(a, b) { return a.length === b.length && a.every((x, i) => x === b[i]); }

/* transplant(net, {hidden, acts}, rng) → {net, exact, note}
 *
 * `exact` says whether the new brain computes exactly what the old one did. When
 * it is true the receiving cell starts from the champion's real score rather than
 * from a regression it has to climb back out of, which matters a lot when a
 * champion is only dethroned a few times an hour.
 */
function transplant(oldNet, target, rng) {
    if (oldNet.spec) throw new Error("no weight-preserving path out of a conv stack");
    const s = oldNet.sizes;
    const oldHidden = s.slice(1, -1);
    const newHidden = target.hidden.slice();
    // a config may name only the hidden activation; Net's own default fills the
    // rest, and the note below should say what the net will actually do
    const t = target.acts || oldNet.acts;
    const acts = { hidden: t.hidden || oldNet.acts.hidden, out: t.out || oldNet.acts.out || "sigmoid" };
    const actChanged = acts.hidden !== oldNet.acts.hidden || acts.out !== oldNet.acts.out;
    // relu(x) = x and lrelu(x) = x for x ≥ 0, which is exactly the range a
    // ReLU-family layer outputs — so an identity insert after one is exact
    const reluLike = acts.hidden === "relu" || acts.hidden === "lrelu";

    let net, exact = !actChanged, note;
    if (_sameArr(oldHidden, newHidden)) {
        net = _resize(oldNet, s.slice(), acts, rng);       // same shape: acts only
        note = actChanged ? `activation ${oldNet.acts.hidden}/${oldNet.acts.out} → ${acts.hidden}/${acts.out}, weights kept` : "identical";
    } else if (oldHidden.length === newHidden.length) {
        const grew = newHidden.every((v, i) => v >= oldHidden[i]);
        net = _resize(oldNet, [s[0]].concat(newHidden, [s[s.length - 1]]), acts, rng);
        exact = exact && grew;
        note = `${oldHidden.join("-")} → ${newHidden.join("-")}` +
            (grew ? ", new units wired silent" : ", weakest units dropped");
    } else if (newHidden.length === oldHidden.length + 1 && _sameArr(newHidden.slice(0, -1), oldHidden)) {
        const size = newHidden[newHidden.length - 1];
        net = _deepen(oldNet, size, acts, rng);
        exact = exact && reluLike && size >= oldHidden[oldHidden.length - 1];
        note = `layer inserted (${size} units, identity)` + (exact ? "" : " — approximate");
    } else if (newHidden.length === oldHidden.length - 1 && _sameArr(newHidden, oldHidden.slice(0, -1))) {
        net = _shallow(oldNet, acts);
        exact = false;
        note = `last layer (${oldHidden[oldHidden.length - 1]} units) folded into the output — approximate`;
    } else {
        throw new Error(`no single-step surgery from ${oldHidden.join("-")} to ${newHidden.join("-")}`);
    }
    return { net, exact, note };
}

if (typeof module !== "undefined") module.exports = { transplant };
