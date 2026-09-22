/* protocol.js — the two baselines every brain is measured against.
 *
 * SOPController runs the published protocol for whichever product was
 * ordered: PI loops on DO and pH, the lineage's agitation and medium
 * calendar, its cue schedule to the day and the dose, and one rule for
 * glucose. The schedule tables live with the biology in lineages.js, so this
 * file is the *engine* of a standard operating procedure rather than any one
 * recipe: walk the phases, hold the setpoints, dose what the day says.
 *
 * It reads the same probes and the same delayed offline numbers as the
 * network, and no more. It is a good protocol — the yardstick the whole
 * simulator is calibrated against. What it is not is adaptive: it does not
 * know the CHIR lot was weak, it cannot tell that the pH probe is lying, and
 * it sticks to its calendar when the pump has been dead for a day.
 *
 * NeutralController is the ZERO of the fitness scale: air with 5 % CO₂,
 * 70 rpm, 0.7 volumes a day of basal medium, no cues, no feeds — what a
 * fresh network commands. The cells stay alive and nothing differentiates.
 * The zero has to be "alive and useless", not "dead": with a dying reactor
 * as the zero, merely keeping cells alive earns most of the scale and the
 * search feels no pressure towards making anything.
 *
 * DoNothingController holds air with 5 % CO₂ at 60 rpm and never exchanges
 * the medium. Cells grow, turn the glucose into lactate, the medium goes
 * yellow, and they die. It is on the page as the cautionary tale.
 */
"use strict";

class SOPController {
    constructor(lin) { this.lin = lin || null; this.reset(); }
    reset() {
        this.o2 = 0.21; this.co2 = 0.05; this.base = 0;
        this.prev = null;
    }

    /* lab: the Lab for this reactor; r: the reactor (only its actuator echo
     * and clock are read — the SOP does not peek at the true state). */
    step(lab, r, t) {
        const L = this.lin || r.lin;
        const sop = L.sop;
        const on = lab.online;
        const day = t / 24;

        // ---- DO: integral action on the oxygen fraction ----
        const eDO = sop.doSet - on.DO;
        this.o2 = clamp(this.o2 + 0.003 * eDO, 0, 0.5);
        // ---- pH: CO₂ first, base when the CO₂ is already off ----
        const epH = sop.pHSet - on.pH;                 // > 0: too acidic
        this.co2 = clamp(this.co2 - 0.15 * epH, 0, 0.10);
        this.base = (this.co2 <= 0.002 && epH > 0.04) ? clamp(5 * epH, 0, 2) : 0;

        // ---- the phase this day falls in ----
        let ph = sop.phases[sop.phases.length - 1];
        for (const p of sop.phases) { if (day < p.to) { ph = p; break; } }

        const cue = new Float64Array(N_CUE);
        for (const k of Object.keys(ph.cues)) cue[k | 0] = ph.cues[k];

        // ---- glucose: bolus when the last reading was low ----
        // ...unless this phase is deliberately starving the culture, which is
        // the whole point of a lactate selection or a low-glucose maturation.
        const glc = lab.latest("glc");
        /* Starving the culture of glucose is a DELIBERATE, lineage-specific
         * act - it is the whole point of the cardiac lactate selection - so a
         * lineage has to name the medium it means. Defaulting to "medium 2"
         * applied cardiac's glucose-free selection to every other lineage's
         * MATURATION medium, which is fed and not glucose-free: the beta-cell
         * CMRL is 5.6 mM and ran down to 1.2, the kidney and hepatic media are
         * 9.0. All three were quietly starving their own product for the last
         * third of the run. */
        const starving = sop.glcCap != null && ph.medium === sop.glcCap;
        const glcFeed = (!starving && glc != null && glc < sop.glcMin && lab.age("glc", t) < 30) ? sop.glcFeed : 0;

        const act = {
            o2: this.o2, co2: this.co2, base: this.base,
            rpm: ph.rpm, perf: ph.perf, glcFeed, cue, medium: ph.medium
        };
        this.prev = act;
        return act;
    }
}

class NeutralController {
    reset() {}
    step() { return neutralAction(); }
}

class DoNothingController {
    reset() {}
    step() {
        const a = neutralAction();
        a.rpm = 60; a.perf = 0; a.medium = 1;
        return a;
    }
}

if (typeof module !== "undefined") module.exports = { SOPController, NeutralController, DoNothingController };
