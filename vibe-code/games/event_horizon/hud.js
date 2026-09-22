/* hud.js — the instruments: everything the panels say, and the one chart.
 *
 * Text is refreshed a few times a second rather than every frame; nobody can
 * read a number that changes sixty times a second, and the layout work is not
 * free. The clocks in the top bar are the exception.
 */
"use strict";

const $ = function (id) { return document.getElementById(id); };

const Hud = {
    sim: null, tick: 0, goalsHtml: "", pingHtml: "",

    begin: function (sim) {
        this.sim = sim; this.goalsHtml = ""; this.pingHtml = "";
        const cfg = sim.cfg, m = sim.mission, u = cfg.units;
        $("ts-mission").textContent = m.title;
        $("ts-base-label").textContent = sim.base.label.replace(" clock", "").toLowerCase();
        $("ck-base-label").textContent = sim.base.label;
        $("ms-chapter").textContent = "· " + m.chapter;
        $("ms-title").textContent = m.title;
        $("ms-tag").textContent = m.tag;
        $("learn").innerHTML = m.learn.map(function (s) { return "<h3>" + s.h + "</h3><p>" + s.p + "</p>"; }).join("");
        $("hints").innerHTML = m.hints.map(function (h) { return "<li>" + h + "</li>"; }).join("");
        $("fact").innerHTML = m.fact;
        $("btn-demo").hidden = !m.pilot;
        $("fl-r-label").textContent = u === "earth" ? "altitude" : u === "ly" ? "distance to go" : "radius";
        $("fl-v-label").textContent = u === "ly" ? "speed" : u === "earth" ? "speed" : "speed past a hoverer";
        $("fl-tide-row").style.display = u === "rs" ? "" : "none";
        $("ts-rate-label").textContent = u === "earth" ? "your clock, against the ground's" : "your clock runs at";
        $("sg-in-label").textContent = u === "ly" ? "starlight dead ahead looks" : "starlight overhead looks";
        $("card-energy").style.display = (sim.world.rs > 0 && !sim.laser) ? "" : "none";
        $("card-signals").style.display = (sim.pingEvery || u === "rs") ? "" : "none";
        $("card-view").querySelectorAll("[data-ov]").forEach(function (el) {
            const k = el.getAttribute("data-ov");
            el.checked = !!sim.overlays[k];
            const holeOnly = k === "rings" || k === "contours" || k === "river" || k === "cone" || k === "disc";
            el.closest("label").style.display = (holeOnly && u !== "rs") || (k === "pulses" && !sim.pingEvery) || (k === "predict" && (u === "ly" || sim.laser)) ? "none" : "";
        });
        $("dl-note").innerHTML = u === "earth"
            ? "Microseconds gained or lost per day, compared with a clock on the ground."
            : u === "ly" ? "No gravity out here. Only your speed counts: 1/γ = √(1 − v²/c²)."
            : "A clock at rest far away ticks at 100%. Yours ticks at <b>gravity × speed</b>.";
        this.update(sim, true);
    },

    update: function (sim, force) {
        const cfg = sim.cfg, d = sim.d, u = cfg.units, S = sim.unitS;
        // clocks: every frame, they are the point
        const ship = fmtClock(sim.tau * S, cfg.clock);
        const base = sim.ship.farLost ? "∞" : fmtClock(sim.baseClock * S, cfg.clock);
        $("ts-ship").textContent = ship; $("ts-base").textContent = base;
        $("ck-ship").textContent = ship; $("ck-base").textContent = base;
        if (!force && ++this.tick % 8) return;

        /* ---- clocks */
        if (sim.ship.farLost) {
            $("ck-lead").textContent = "—";
            $("ck-note").textContent = "The far clock has run off the end of its scale. In a distant observer's bookkeeping you never finish crossing the horizon; no reading of their clock goes with what is happening to you now.";
        } else {
            const lead = sim.lead * S;
            $("ck-lead-label").textContent = lead >= 0 ? "ahead of you by" : "behind you by";
            $("ck-lead").textContent = fmtDuration(Math.abs(lead));
            $("ck-note").textContent = "";
        }

        /* ---- why */
        const pct = function (q) { return (100 * q).toFixed(q > 0.9995 ? 3 : 1) + "%"; };
        if (u === "earth") {
            const day = 86400e6, ground = -sim.base.rate1;
            const g = (ground - d.gravLoss) * day, v = -d.speedLoss * day, t = g + v;
            const sg = function (x) { return (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(1) + " µs/day"; };
            this.bar("grav", Math.abs(g) / 60, g >= 0); this.bar("speed", Math.abs(v) / 60, v >= 0); this.bar("total", Math.abs(t) / 60, t >= 0);
            $("dl-grav").textContent = sg(g); $("dl-speed").textContent = sg(v); $("dl-total").textContent = sg(t);
            $("ts-rate").textContent = sg(t);
        } else if (d.inside) {
            this.bar("grav", 0, true); this.bar("speed", 0, true); this.bar("total", 0, true);
            $("dl-grav").textContent = "—"; $("dl-speed").textContent = "—"; $("dl-total").textContent = "—";
            $("ts-rate").textContent = "—";
            $("dl-note").innerHTML = "Inside the horizon nothing can stay at rest, so “a clock at rest here” does not exist to compare yours with. Your own clock carries on exactly as normal.";
        } else {
            this.bar("grav", d.grav, true); this.bar("speed", d.speed, true); this.bar("total", d.rate, true);
            $("dl-grav").textContent = "× " + d.grav.toFixed(3); $("dl-speed").textContent = "× " + d.speed.toFixed(3); $("dl-total").textContent = "× " + d.rate.toFixed(3);
            $("ts-rate").textContent = pct(d.rate);
        }

        /* ---- flight */
        if (u === "earth") {
            $("fl-r").textContent = fmtNum((d.r - 1) * 6371, 0) + " km";
            $("fl-v").textContent = (d.vLoc * C_SI / 1000).toFixed(2) + " km/s";
        } else if (u === "ly") {
            const m = sim.marks;
            $("fl-r").textContent = m.dist !== undefined ? m.dist.toFixed(2) + " ly" : "–";
            $("fl-v").textContent = d.vRiver.toFixed(4) + " c   (γ " + d.gamma.toFixed(2) + ")";
        } else {
            $("fl-r").textContent = d.r.toFixed(3) + " rs";
            $("fl-v").textContent = d.inside ? "—" : d.vLoc.toFixed(3) + " c";
        }
        let orbit = "–";
        if (sim.laser) orbit = "parked · aim " + (sim.laser.aim * 180 / Math.PI).toFixed(3) + "°";
        else if (sim.world.rs > 0) {
            const ap = apsides(sim.world, d);
            const f = function (r) { return u === "earth" ? fmtNum((r - 1) * 6371, 0) + " km" : r.toFixed(2); };
            if (d.inside) orbit = "no way out";
            else if (sim.hover) orbit = "hovering (engine)";
            else if (ap.peri <= (sim.world.R || 0)) orbit = sim.world.R ? "hits the atmosphere" : "falls into the hole";
            else if (!isFinite(ap.apo)) orbit = "escaping · low " + f(ap.peri);
            else orbit = f(ap.peri) + " – " + f(ap.apo) + (u === "rs" ? " rs" : "");
        } else orbit = "deep space";
        $("fl-orbit").textContent = orbit;
        const g = sim.feltG();
        $("fl-g").textContent = g < 0.005 ? "0 g — free fall" : (g < 100 ? g.toFixed(2) : fmtNum(g, 0)) + " g";
        $("fl-g").className = g > 12 ? "warn" : "";
        if (u === "rs") {
            const t = sim.tideG();
            $("fl-tide").textContent = t < 0.01 ? t.toExponential(1) + " g" : fmtNum(t, 2) + " g";
            $("fl-tide").className = sim.tideLimit && t > 0.3 * sim.tideLimit ? "warn" : "";
        }
        if (sim.fuelMax === Infinity) { $("bar-fuel").style.width = "100%"; $("fl-fuel").textContent = "fuel ∞"; }
        else {
            const left = sim.fuelLeft();
            $("bar-fuel").style.width = (100 * left / sim.fuelMax).toFixed(1) + "%";
            $("bar-fuel").className = left / sim.fuelMax < 0.2 ? "low" : "";
            $("fl-fuel").textContent = u === "earth" ? (left * C_SI / 1000).toFixed(2) + " km/s" : left.toFixed(left < 1 ? 3 : 1) + " c";
        }

        /* ---- signals */
        if (u === "rs" || sim.pingEvery) {
            const out = u === "ly" ? this.dopplerHome(sim) : d.beaconOut;
            $("sg-out").textContent = out > 0 ? "× " + out.toFixed(3) + (out < 0.995 ? "  redder" : out > 1.005 ? "  bluer" : "") : "never arrives";
            const nm = out > 0 ? 530 / out : Infinity;
            $("sg-marker").style.left = Math.max(0, Math.min(100, (nm - 380) / (750 - 380) * 100)) + "%";
            $("sg-marker").style.opacity = out > 0 ? 1 : 0.25;
            $("sg-colour").textContent = bandName(nm);
            /* In open space "overhead" means nothing; the interesting direction is the one you are flying in. */
            const seen = u === "ly" ? d.gamma * (1 + d.vRiver) : d.starIn;
            $("sg-in").textContent = "× " + seen.toFixed(3) + (seen > 1.005 ? "  bluer" : seen < 0.995 ? "  redder" : "");
        }
        const heard = sim.pings.filter(function (p) { return p.stretch !== undefined; }).slice(-4);
        let html = "";
        if (sim.pingEvery) {
            const each = fmtDuration(sim.pingEvery * S);
            html = "<div class='ping-head'>You flash every <b>" + each + "</b> of your time. Mission control hears them:</div>";
            if (!heard.length) html += "<div class='ping none'>…waiting for the light to get there</div>";
            heard.forEach(function (p) {
                html += "<div class='ping'><span>#" + (p.n !== undefined ? p.n : "") + " every " + fmtDuration(p.gap * S) + "</span><b>× " + p.stretch.toFixed(2) + "</b></div>";
            });
            const lost = sim.tauCross !== null ? sim.pings.filter(function (p) { return p.tauSent > sim.tauCross; }).length : 0;
            if (lost) html += "<div class='ping lost'>" + lost + " sent from inside — these never arrive</div>";
        }
        if (html !== this.pingHtml) { $("pinglog").innerHTML = html; this.pingHtml = html; }

        /* ---- mission */
        const goals = sim.mission.goals(sim);
        const gh = goals.map(function (q) {
            return "<li class='" + (q.done ? "done" : "") + (q.plain ? " plain" : "") + (q.flag ? " flag" : "") + "'><span>" + q.text + "</span>" +
                   (q.note ? "<small>" + q.note + "</small>" : "") + "</li>";
        }).join("");
        if (gh !== this.goalsHtml) { $("goals").innerHTML = gh; this.goalsHtml = gh; }
        $("btn-finish").hidden = !(sim.mission.canFinish && sim.mission.canFinish(sim) && sim.status === "flying");

        /* ---- the strip on the canvas itself (all a phone has room for) */
        let line;
        if (u === "earth") line = "<b>" + fmtNum((d.r - 1) * 6371, 0) + "</b> km up · <b>" + (d.vLoc * C_SI / 1000).toFixed(2) + "</b> km/s";
        else if (u === "ly") line = "<b>" + d.vRiver.toFixed(3) + "</b> c · γ <b>" + d.gamma.toFixed(2) + "</b>";
        else line = "r <b>" + d.r.toFixed(2) + "</b> rs · " + (d.inside ? "<b class='in'>inside the horizon</b>" : "clock <b>" + pct(d.rate) + "</b>");
        $("hud").innerHTML = line;
        this.drawEnergy(sim);
    },

    bar: function (name, q, good) {
        const el = $("bar-" + name);
        el.style.width = (100 * Math.max(0, Math.min(1, q))).toFixed(1) + "%";
        el.className = good ? "" : "loss";
    },

    /* Flat space: how the beacon's frequency arrives at home, from the radial
     * part of the ship's velocity — ordinary relativistic Doppler. */
    dopplerHome: function (sim) {
        const s = sim.ship, at = sim.cfg.listenAt, d = sim.d;
        const dx = at.x - s.x, dy = at.y - s.y, q = Math.hypot(dx, dy) || 1;
        const towards = (s.wx * dx + s.wy * dy) / q;               // γ v·n̂
        return 1 / (d.gamma - towards);
    },

    /* ---------------------------------------------------------- the chart */

    drawEnergy: function (sim) {
        const c = $("chart-energy");
        if (c.offsetParent === null || !(sim.world.rs > 0)) return;
        const ctx = c.getContext("2d"), W = c.width, H = c.height, d = sim.d;
        const rs = sim.world.rs, L = d.L, earth = sim.cfg.units === "earth";
        const rLo = sim.world.R || rs, rHi = earth ? 6 : Math.max(24, sim.cfg.viewR);
        const pad = { l: 6, r: 6, t: 8, b: 18 };
        ctx.clearRect(0, 0, W, H);
        /* U(r) = (V² − 1)/2 = −rs/2r + L²/2r² − rs L²/2r³, written out so that
         * nothing cancels around the Earth, where every term is ~1e-10. The
         * last term is the whole of general relativity's contribution. */
        const U = function (r) { return 0.5 * (-rs / r + L * L / (r * r) - rs * L * L / (r * r * r)); };
        const UN = function (r) { return 0.5 * (-rs / r + L * L / (r * r)); };
        const eps = 0.5 * d.E1 * (1 + d.E);
        /* Frame the valley: from just under the lowest point of the curve to a
         * little above the ship's own energy (or the escape level, if higher). */
        let uMin = Infinity;
        for (let i = 0; i <= 40; i++) uMin = Math.min(uMin, U(rLo * Math.pow(rHi / rLo, i / 40)));
        const depth = Math.abs(uMin) || 1e-30;
        const y0 = uMin - 0.1 * depth, y1 = Math.max(eps, 0) + 0.35 * depth;
        const X = function (r) { return pad.l + (W - pad.l - pad.r) * Math.log(r / rLo) / Math.log(rHi / rLo); };
        const Y = function (u) { return pad.t + (H - pad.t - pad.b) * (1 - (Math.max(y0, Math.min(y1, u)) - y0) / (y1 - y0)); };
        const N = 160;
        // Newton, for comparison
        ctx.beginPath();
        for (let i = 0; i <= N; i++) { const r = rLo * Math.pow(rHi / rLo, i / N); if (i) ctx.lineTo(X(r), Y(UN(r))); else ctx.moveTo(X(r), Y(UN(r))); }
        ctx.strokeStyle = "rgba(199,146,234,0.75)"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
        // Einstein
        ctx.beginPath(); ctx.moveTo(X(rLo), H - pad.b);
        for (let i = 0; i <= N; i++) { const r = rLo * Math.pow(rHi / rLo, i / N); ctx.lineTo(X(r), Y(U(r))); }
        ctx.lineTo(X(rHi), H - pad.b); ctx.closePath();
        ctx.fillStyle = "rgba(255,178,87,0.13)"; ctx.fill();
        ctx.beginPath();
        for (let i = 0; i <= N; i++) { const r = rLo * Math.pow(rHi / rLo, i / N); if (i) ctx.lineTo(X(r), Y(U(r))); else ctx.moveTo(X(r), Y(U(r))); }
        ctx.strokeStyle = "#ffb257"; ctx.lineWidth = 1.6; ctx.stroke();
        // zero line: above it you are free to leave
        ctx.strokeStyle = "rgba(125,147,171,0.35)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad.l, Y(0)); ctx.lineTo(W - pad.r, Y(0)); ctx.stroke();
        // the ship: a level, and a dot on it
        const rr = Math.max(rLo, Math.min(rHi, d.r));
        ctx.strokeStyle = "rgba(143,212,255,0.9)"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(pad.l, Y(eps)); ctx.lineTo(W - pad.r, Y(eps)); ctx.stroke();
        ctx.fillStyle = "#e9f3ff"; ctx.beginPath(); ctx.arc(X(rr), Y(eps), 3.4, 0, 2 * Math.PI); ctx.fill();
        // axis
        ctx.fillStyle = "rgba(125,147,171,0.9)"; ctx.font = "10px 'Segoe UI', system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
        const ticks = earth ? [1, 2, 4] : [1, 1.5, 3, 6, 12, 24];
        for (let i = 0; i < ticks.length; i++) {
            const r = ticks[i] * (earth ? 1 : rs);
            if (r < rLo || r > rHi) continue;
            ctx.fillText(earth ? (ticks[i] === 1 ? "ground" : fmtNum((ticks[i] - 1) * 6371, 0) + " km") : String(ticks[i]), Math.max(16, Math.min(W - 16, X(r))), H - pad.b + 4);
            ctx.strokeStyle = "rgba(125,147,171,0.18)"; ctx.beginPath(); ctx.moveTo(X(r), pad.t); ctx.lineTo(X(r), H - pad.b); ctx.stroke();
        }
    }
};

function bandName(nm) {
    if (!isFinite(nm)) return "—";
    if (nm < 10) return "X-rays";
    if (nm < 380) return "ultraviolet";
    if (nm < 450) return "violet, " + nm.toFixed(0) + " nm";
    if (nm < 495) return "blue, " + nm.toFixed(0) + " nm";
    if (nm < 570) return "green, " + nm.toFixed(0) + " nm";
    if (nm < 590) return "yellow, " + nm.toFixed(0) + " nm";
    if (nm < 620) return "orange, " + nm.toFixed(0) + " nm";
    if (nm < 750) return "red, " + nm.toFixed(0) + " nm";
    if (nm < 1e6) return "infrared";
    if (nm < 1e9) return "microwaves";
    return "radio";
}
