// Geometry checks for the Image to STL mesh engine: node test_headless.js
// Loads the two engine scripts straight out of index.html, builds meshes from
// synthetic images and checks that every result is a closed, consistently
// oriented solid when its vertices are welded by float32 position, the way a
// slicer reads an STL.
'use strict';
const fs = require('fs'), path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const script = id => {
  const m = html.match(new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)</script>`));
  if (!m) throw new Error('missing script #' + id);
  return m[1];
};
// Evaluated in the plain realm, as in the browser worker. (Inside node:vm every
// Math.* lookup goes through an interceptor and the blur runs ~100x slower.)
new Function(script('region-geometry') + '\n' + script('mesh-engine'))();
const {buildMesh, encodeSTL} = globalThis.StlEngine;
const regions = globalThis.StlRegions;

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

// RGBA sample grid of (cols+1) x (rows+1) from a brightness function f(u, v) -> [0..255, alpha].
function image(cols, rows, f) {
  const sw = cols + 1, sh = rows + 1, rgba = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const [v, a = 255] = [].concat(f(x / cols, y / rows)), p = 4 * (y * sw + x);
    rgba[p] = rgba[p + 1] = rgba[p + 2] = v; rgba[p + 3] = a;
  }
  return rgba;
}
const settings = (extra = {}) => ({mode: 'cutout', cutoff: 128, thickness: 3, minHeight: .6, maxHeight: 5, smoothing: 0, gamma: 1, invert: false, ...extra});
const options = (cols, rows, extra = {}) => ({...settings(), width: 100, imageHeight: 100 * rows / cols, invert: false, mirror: false, ...extra});

function solidReport(mesh) {
  const pos = mesh.positions, idx = mesh.indices, f32 = new Float32Array(1);
  const key = i => { const out = []; for (let k = 0; k < 3; k++) { f32[0] = pos[3 * i + k]; out.push(f32[0]); } return out.join(','); };
  const keys = new Map(), id = i => { const k = key(i); if (!keys.has(k)) keys.set(k, keys.size); return keys.get(k); };
  const directed = new Map();
  let volume = 0;
  for (let f = 0; f < idx.length; f += 3) {
    const v = [idx[f], idx[f + 1], idx[f + 2]], w = v.map(id);
    for (let e = 0; e < 3; e++) { const k = w[e] + '>' + w[(e + 1) % 3]; directed.set(k, (directed.get(k) || 0) + 1); }
    const [a, b, c] = v.map(i => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]]);
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  let open = 0, doubled = 0;
  for (const [k, n] of directed) {
    if (n > 1) doubled++;
    const [a, b] = k.split('>');
    if (directed.get(b + '>' + a) !== 1) open++;
  }
  return {open, doubled, volume};
}

function expectSolid(name, mesh, {pieces} = {}) {
  const r = solidReport(mesh);
  check(name + ': has faces', mesh.indices.length > 0);
  check(name + ': every edge closed', r.open === 0, r.open + ' unmatched directed edges');
  check(name + ': no doubled edges', r.doubled === 0, r.doubled + ' doubled');
  const rel = Math.abs(r.volume - mesh.stats.volume) / Math.max(1e-9, mesh.stats.volume);
  check(name + ': outward volume matches', r.volume > 0 && rel < 1e-4, `mesh ${r.volume.toFixed(3)} vs stats ${mesh.stats.volume.toFixed(3)}`);
  if (pieces !== undefined) check(name + ': ' + pieces + ' piece(s)', mesh.stats.pieces === pieces, 'got ' + mesh.stats.pieces);
  let stl = null; try { stl = encodeSTL(mesh.positions, mesh.indices); } catch (e) { check(name + ': encodes', false, e.message); }
  if (stl) check(name + ': STL size', stl.byteLength === 84 + 50 * mesh.indices.length / 3);
  return r;
}

// Two separate discs on white.
const discs = (u, v) => (Math.hypot(u - .3, v - .5) < .18 || Math.hypot(u - .72, v - .5) < .15) ? 20 : 255;
for (const [cols, rows] of [[64, 48], [37, 23]]) {
  const rgba = image(cols, rows, discs);
  const plain = buildMesh(rgba, cols, rows, options(cols, rows));
  expectSolid(`discs ${cols}x${rows}`, plain, {pieces: 2});
  const plated = buildMesh(rgba, cols, rows, options(cols, rows, {base: 1.2}));
  expectSolid(`discs ${cols}x${rows} + plate`, plated, {pieces: 1});
  const footprint = 100 * (100 * rows / cols);
  check(`discs ${cols}x${rows} + plate: volume = plate + model`, Math.abs(plated.stats.volume - (footprint * 1.2 + plain.stats.volume)) < 1e-6 * plated.stats.volume,
    `${plated.stats.volume} vs ${footprint * 1.2 + plain.stats.volume}`);
  check(`discs ${cols}x${rows} + plate: height`, Math.abs(plated.stats.height - 4.2) < 1e-9, String(plated.stats.height));
  check(`discs ${cols}x${rows} + plate: full footprint`, Math.abs(plated.stats.width - 100) < 1e-9 && Math.abs(plated.stats.depth - 100 * rows / cols) < 1e-9);
}

// Material touching every border, with a hole: border walls on both sides.
{
  const cols = 40, rows = 30, rgba = image(cols, rows, (u, v) => Math.hypot(u - .5, v - .5) < .2 ? 255 : 0);
  expectSolid('frame', buildMesh(rgba, cols, rows, options(cols, rows)), {pieces: 1});
  expectSolid('frame + plate', buildMesh(rgba, cols, rows, options(cols, rows, {base: .8})), {pieces: 1});
  // Contours that cross the image border, so contour vertices sit on it.
  const edge = image(cols, rows, (u, v) => (u < .35 || (v > .6 && u < .8)) ? 10 : 250);
  expectSolid('border contour', buildMesh(edge, cols, rows, options(cols, rows)), {pieces: 1});
  expectSolid('border contour + plate', buildMesh(edge, cols, rows, options(cols, rows, {base: 2})), {pieces: 1});
}

// Relief with a gradient, a hole, smoothing, transparency, mirror.
{
  const cols = 50, rows = 50;
  const rgba = image(cols, rows, (u, v) => Math.hypot(u - .3, v - .3) < .1 ? [0, 0] : [Math.round(40 + 180 * u), 255]);
  const o = options(cols, rows, {mode: 'relief', cutoff: 250, smoothing: .5, mirror: true});
  expectSolid('relief', buildMesh(rgba, cols, rows, o));
  expectSolid('relief + plate', buildMesh(rgba, cols, rows, {...o, base: 1}), {pieces: 1});
}

// Layers: a polygon relief region and a rectangle cutout region over a cutout base.
{
  const cols = 60, rows = 40, rgba = image(cols, rows, (u, v) => Math.round(255 * (1 - u) * .8));
  const layers = [
    {id: 'base', name: 'Whole image', enabled: true, rect: null, settings: settings({cutoff: 120})},
    {id: 'r1', name: 'Poly', enabled: true, rect: null, points: [{x: .1, y: .1}, {x: .5, y: .2}, {x: .4, y: .8}, {x: .15, y: .6}], settings: settings({mode: 'relief', cutoff: 250, minHeight: 1, maxHeight: 6})},
    {id: 'r2', name: 'Rect', enabled: true, rect: {x0: .6, y0: .3, x1: .95, y1: .9}, points: null, settings: settings({thickness: 5, invert: true})},
  ];
  for (const base of [0, 1.5]) {
    const m = buildMesh(rgba, cols, rows, options(cols, rows, {layers, base}));
    expectSolid('layers' + (base ? ' + plate' : ''), m);
    check('layers' + (base ? ' + plate' : '') + ': 3 layers', m.stats.layerCount === 3);
  }
  const only = buildMesh(rgba, cols, rows, options(cols, rows, {layers, onlyLayer: 'r1'}));
  expectSolid('single layer export', only);
}

// Degenerate sizes.
{
  const rgba = image(1, 1, () => 0);
  expectSolid('1x1 full', buildMesh(rgba, 1, 1, options(1, 1)), {pieces: 1});
  expectSolid('1x1 full + plate', buildMesh(rgba, 1, 1, options(1, 1, {base: 1})), {pieces: 1});
  const blank = buildMesh(image(8, 8, () => 255), 8, 8, options(8, 8));
  check('blank image is empty', blank.indices.length === 0 && blank.stats.triangles === 0);
  expectSolid('blank image + plate is just the plate', buildMesh(image(8, 8, () => 255), 8, 8, options(8, 8, {base: 2})), {pieces: 1});
}

// The Maximum detail setting: 2048 subdivisions along the long side.
{
  const cols = 2048, rows = 6, rgba = image(cols, rows, (u, v) => (Math.sin(u * 90) > 0 || v > .7) ? 15 : 250);
  expectSolid('2048 wide strip', buildMesh(rgba, cols, rows, options(cols, rows)), {pieces: 1});
  expectSolid('2048 wide strip + plate', buildMesh(rgba, cols, rows, options(cols, rows, {base: 1})), {pieces: 1});
  let message = '';
  try { buildMesh(image(2049, 1, () => 0), 2049, 1, options(2049, 1)); } catch (e) { message = e.message; }
  check('rejects more than 2048', /resolution/.test(message), message);
}

// Validation.
{
  const rgba = image(4, 4, () => 0);
  let message = '';
  try { buildMesh(rgba, 4, 4, options(4, 4, {base: -1})); } catch (e) { message = e.message; }
  check('rejects a negative plate', /Base plate/.test(message), message);
  check('polygonError catches a bow tie', regions.polygonError([{x: 0, y: 0}, {x: 1, y: 1}, {x: 1, y: 0}, {x: 0, y: 1}]) !== '');
  check('polygonError accepts a square on the border', regions.polygonError([{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}, {x: 0, y: 1}]) === '');
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
