/* ui.js — DOM plumbing only. Nothing here knows about gravity.
 * Every control is bound through one of these helpers so that "read the current
 * value of X" is a single call and there is exactly one place a widget can drift
 * out of sync with the state it drives. */
"use strict";

const $ = id => document.getElementById(id);

function bindSlider(id, labelId, fmt, onChange) {
    const el = $(id), lb = $(labelId);
    if (!el) return () => 0;
    const paint = () => { if (lb) lb.textContent = fmt(+el.value); };
    el.addEventListener("input", () => { paint(); if (onChange) onChange(+el.value); });
    paint();
    return () => +el.value;
}

function bindCheck(id, onChange) {
    const el = $(id);
    if (!el) return () => false;
    if (onChange) el.addEventListener("change", () => onChange(el.checked));
    return () => el.checked;
}

function bindButton(id, fn) { const el = $(id); if (el) el.addEventListener("click", fn); }

/* A row of mutually exclusive buttons. Returns a setter so the caller can move
 * the selection programmatically (loading a champion switches rung, for
 * instance) without duplicating the class bookkeeping. */
function buildChoices(hostId, items, onPick) {
    const host = $(hostId);
    if (!host) return () => { };
    host.innerHTML = "";
    const els = items.map((it, i) => {
        const b = document.createElement("button");
        b.innerHTML = `<b>${it.title}</b><small>${it.sub}</small>`;
        b.addEventListener("click", () => { select(i); onPick(i, it); });
        host.appendChild(b);
        return b;
    });
    function select(i) { els.forEach((e, k) => e.classList.toggle("on", k === i)); }
    return select;
}

function buildSpeeds(hostId, speeds, onPick) {
    const host = $(hostId);
    if (!host) return () => { };
    host.innerHTML = "";
    const els = speeds.map((s, i) => {
        const b = document.createElement("button");
        b.textContent = s.label;
        b.addEventListener("click", () => { select(i); onPick(s.value, i); });
        host.appendChild(b);
        return b;
    });
    function select(i) { els.forEach((e, k) => e.classList.toggle("on", k === i)); }
    return select;
}

/* Newest first (the container is column-reverse), capped so a long training
 * session cannot grow the DOM without bound. */
function makeLog(hostId, cap) {
    const host = $(hostId);
    return function (msg, cls) {
        if (!host) return;
        const d = document.createElement("div");
        if (cls) d.className = cls;
        d.textContent = msg;
        host.appendChild(d);
        while (host.children.length > (cap || 140)) host.removeChild(host.firstChild);
    };
}

function setText(id, v) { const el = $(id); if (el) el.textContent = v; }
function setHTML(id, v) { const el = $(id); if (el) el.innerHTML = v; }

/* Download a JSON blob. Used for exporting a champion. */
function downloadJSON(name, obj) {
    const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function readJSONFile(input, cb) {
    const f = input.files && input.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
        try { cb(null, JSON.parse(r.result)); }
        catch (e) { cb(e); }
    };
    r.readAsText(f);
    input.value = "";
}

/* Format a relative error as something a human reads at a glance. Percentages
 * up to a point, then scientific — an error of 3e-5 means nothing written as
 * "0.003%". */
function fmtErr(e) {
    if (!Number.isFinite(e)) return "—";
    if (e >= 0.01) return (100 * e).toFixed(1) + "%";
    if (e >= 1e-4) return (100 * e).toFixed(3) + "%";
    return e.toExponential(1);
}
