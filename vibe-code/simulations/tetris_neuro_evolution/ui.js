/* ui.js — sliders, buttons, the log and the keyboard readout.
 * Owns CFG; main.js reads it every generation. */
"use strict";

const CFG = {
    pop: 48, trials: 2, pieceCap: 200,
    islands: 1, migrateEvery: 10, selfAdapt: true, share: 0, shareRadius: 0.55,
    grace: 3, mutRate: 0.12, mutSigma: 0.25,
    annealFit: 2000, annealFloor: 0.22, shakeAfter: 8,
    immZeroFit: 3600, childZeroFit: 48000,
    reinject: true,
    fleet: true, ghost: true, keys: true, headless: false,
    speed: 1,
};

const $ = id => document.getElementById(id);

/* ------------------------------------------------------------------- log */
const logEl = $("log");
function log(msg, cls) {
    const d = document.createElement("div");
    if (cls) d.className = cls;
    d.textContent = msg;
    logEl.insertBefore(d, logEl.firstChild);
    while (logEl.childNodes.length > 90) logEl.removeChild(logEl.lastChild);
}

/* --------------------------------------------------------------- sliders */
function slider(id, labelId, key, format, onChange) {
    const el = $(id), lb = $(labelId);
    const apply = () => {
        const raw = +el.value;
        CFG[key] = format.value ? format.value(raw) : raw;
        lb.textContent = format.text(raw);
        if (onChange) onChange();
    };
    el.addEventListener("input", apply);
    apply();
}

slider("sl-pop", "lb-pop", "pop", { text: v => v });
slider("sl-trials", "lb-trials", "trials", { text: v => v });
slider("sl-cap", "lb-cap", "pieceCap", { text: v => v });
slider("sl-grace", "lb-grace", "grace", { text: v => v === 0 ? "off" : v + " gens" });
slider("sl-islands", "lb-islands", "islands", { text: v => v === 1 ? "1 (one pool)" : v });
slider("sl-share", "lb-share", "share",
    { text: v => v === 0 ? "off" : (v / 10).toFixed(1) + "×", value: v => v / 10 });
slider("sl-migrate", "lb-migrate", "migrateEvery",
    { text: v => v === 0 ? "never" : v + " gens" });
slider("sl-mutrate", "lb-mutrate", "mutRate",
    { text: v => v + "%", value: v => v / 100 });
slider("sl-mutsig", "lb-mutsig", "mutSigma",
    { text: v => (v / 100).toFixed(2), value: v => v / 100 });
slider("sl-anneal", "lb-anneal", "annealFit",
    { text: v => v === 0 ? "off" : (v / 1000).toFixed(1) + "k" });
slider("sl-floor", "lb-floor", "annealFloor",
    { text: v => v + "%", value: v => v / 100 });
slider("sl-shake", "lb-shake", "shakeAfter",
    { text: v => v === 0 ? "off" : v + " flat gens" });
slider("sl-imm", "lb-imm", "immZeroFit",
    { text: v => v === 0 ? "never" : (v / 1000).toFixed(1) + "k" });
slider("sl-child", "lb-child", "childZeroFit",
    { text: v => v === 0 ? "never" : (v / 1000) + "k" });

function checkbox(id, key, onChange) {
    const el = $(id);
    const apply = () => { CFG[key] = el.checked; if (onChange) onChange(); };
    el.addEventListener("change", apply);
    apply();
}
// main.js defines layoutStage; these run once at load, before it exists
const relayout = () => { if (typeof layoutStage === "function") layoutStage(); };
checkbox("chk-fleet", "fleet", relayout);
checkbox("chk-selfadapt", "selfAdapt");
checkbox("chk-ghost", "ghost");
checkbox("chk-keys", "keys", () => {
    $("keyboard").parentElement.style.display = CFG.keys ? "" : "none";
});
checkbox("chk-headless", "headless", () => {
    $("boards").classList.toggle("hidden", CFG.headless);
    $("headless-card").classList.toggle("hidden", !CFG.headless);
    if (!CFG.headless) relayout();
});

/* ----------------------------------------------------------------- speed */
const SPEEDS = [
    { label: "½×", ticks: 0.5 },
    { label: "1×", ticks: 1 },
    { label: "3×", ticks: 3 },
    { label: "10×", ticks: 10 },
    { label: "40×", ticks: 40 },
];
const speedGroup = $("speed-group");
SPEEDS.forEach((s, i) => {
    const b = document.createElement("button");
    b.textContent = s.label;
    if (i === 1) b.classList.add("on");
    b.addEventListener("click", () => {
        CFG.speed = s.ticks;
        [...speedGroup.children].forEach(c => c.classList.remove("on"));
        b.classList.add("on");
    });
    speedGroup.appendChild(b);
});

/* -------------------------------------------------------- keyboard panel */
const keyEls = [];
{
    const kb = $("keyboard");
    for (let i = 0; i < KEY_ORDER.length; i++) {
        const d = document.createElement("div");
        d.className = "key";
        d.innerHTML = `<div class="glyph">${KEY_LABELS[i]}</div>` +
            `<div class="name">${KEY_NAMES[i]}</div><div class="bar"><i></i></div>`;
        d.title = KEY_ORDER[i];
        kb.appendChild(d);
        keyEls.push({ root: d, bar: d.querySelector(".bar i") });
    }
}
/* held: array of 0/1 actually down. act: raw sigmoid outputs (or null for a human). */
function drawKeyboard(held, act) {
    for (let i = 0; i < keyEls.length; i++) {
        const on = !!(held && held[i]);
        keyEls[i].root.classList.toggle("on", on);
        const a = act ? act[i] : (on ? 1 : 0);
        keyEls[i].bar.style.width = Math.round(a * 100) + "%";
        keyEls[i].bar.style.background = a > 0.5 ? "var(--accent)" : "#2f4665";
    }
}
