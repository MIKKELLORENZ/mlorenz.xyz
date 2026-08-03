/* tasks.js — the task LANGUAGE and the business logic that judges it.
 *
 * Two things live here and they must never disagree:
 *
 *   1. TASK BANK — 49 distinct goal specifications, each rendered into 8
 *      training phrasings and 3 held-out phrasings that no training episode
 *      ever shows. ~392 training sentences, ~147 unseen ones. The held-out
 *      split is the whole point of the project: anyone can memorise 392
 *      vectors, the question is whether a brain that has only ever been paid
 *      for behaviour under one wording does the right thing when a human
 *      phrases it differently.
 *
 *   2. GoalEvaluator — the referee. Given a spec and the balls actually on the
 *      table it answers, at every instant, "which balls would be a correct
 *      delivery RIGHT NOW, and into which bucket". That set is what the reward
 *      ledger shapes towards, and it is computed from the spec alone — never
 *      from what the network happened to pick. Shaping the net's own choice is
 *      how you get a brain that reaches for the nearest ball and calls it
 *      obedience.
 *
 * The text is generated from templates rather than hand-written 539 times, but
 * the templates are genuinely different SENTENCES (different word order, voice,
 * politeness, ellipsis), not one sentence with a swapped noun. Synonym choice
 * is drawn from a per-(spec, template) seeded RNG so the bank is byte-stable:
 * the baked embeddings are indexed by task id and a corpus hash, and a mismatch
 * is a loud error rather than a silently wrong vector.
 */
"use strict";

/* ------------------------------------------------------------------- colors */
const COLORS = ["red", "green", "blue", "yellow"];
const COLOR_HEX = [0xe3474f, 0x3fbf6f, 0x3d7fe0, 0xe8c341];
const NCOLORS = 4;

/* --------------------------------------------------------------------- rng */
function taskRng(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/* ------------------------------------------------------------------- lexicon
 * Nouns the sim's objects can be called. A brain that only works when you say
 * "ball" has learned a token, not a task. */
const LEX = {
    ball: ["ball", "sphere", "orb", "marble"],
    balls: ["balls", "spheres", "orbs", "marbles"],
    bucket: ["bucket", "bin", "container", "box"],
    buckets: ["buckets", "bins", "containers", "boxes"],
    put: ["put", "place", "drop", "deposit"],
    grab: ["pick up", "grab", "collect", "fetch"],
    table: ["table", "workspace", "bench", "surface"]
};
const NUMWORD = ["zero", "one", "two", "three", "four", "five", "six"];

function pick(rng, arr) { return arr[(rng() * arr.length) | 0]; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* Join a color list: ["red","blue"] -> "red and blue" */
function joinColors(cs, conj) {
    conj = conj || "and";
    if (cs.length === 1) return cs[0];
    if (cs.length === 2) return cs[0] + " " + conj + " " + cs[1];
    return cs.slice(0, -1).join(", ") + " " + conj + " " + cs[cs.length - 1];
}

/* ---------------------------------------------------------------- goal kinds
 *
 * kind          params                      meaning
 * SORT          {colors:[..]}               every ball of those colors -> its own color bucket
 * ALTERNATE     {colors:[a,b]}              a,b,a,b… (either may start), matching buckets
 * LEAVE_ONE     {colors:[..], spare:c}      sort colors, but exactly one `spare` stays on the table
 * COUNT         {color:c, n:k}              exactly k balls of color c, then stop
 * ORDER         {colors:[a,b]}              ALL of a first, then all of b
 * EXCLUDE       {skip:c}                    sort every color except c; c must not be touched at all
 * ALL_TO_ONE    {bucket:c}                  every ball on the table, regardless of color, into bucket c
 */

function buildSpecs() {
    const specs = [];
    const add = (kind, params) => specs.push({ kind, params });

    for (let c = 0; c < NCOLORS; c++) add("SORT", { colors: [c] });                 // 4
    for (let a = 0; a < NCOLORS; a++)
        for (let b = a + 1; b < NCOLORS; b++) add("SORT", { colors: [a, b] });      // 6
    add("SORT", { colors: [0, 1, 2, 3] });                                          // 1
    for (let a = 0; a < NCOLORS; a++)
        for (let b = a + 1; b < NCOLORS; b++) add("ALTERNATE", { colors: [a, b] }); // 6
    for (let c = 0; c < NCOLORS; c++) add("LEAVE_ONE", { colors: [0, 1, 2, 3], spare: c }); // 4
    for (let c = 0; c < NCOLORS; c++) { add("COUNT", { color: c, n: 1 }); add("COUNT", { color: c, n: 2 }); } // 8
    for (let a = 0; a < NCOLORS; a++)
        for (let b = 0; b < NCOLORS; b++) if (a !== b) add("ORDER", { colors: [a, b] });    // 12
    for (let c = 0; c < NCOLORS; c++) add("EXCLUDE", { skip: c });                   // 4
    for (let c = 0; c < NCOLORS; c++) add("ALL_TO_ONE", { bucket: c });              // 4
    return specs;                                                                   // 49
}

/* ------------------------------------------------------------------ phrasings
 * Each entry is a function (p, r) -> sentence, where p is the spec params
 * (already resolved to color NAMES) and r is a seeded rng for synonyms.
 * The first TRAIN_PHRASINGS of each list are used for training; the tail is
 * held out and never shown during evolution. Order inside a list is therefore
 * load-bearing — appending is safe, reordering re-splits the bank. */
const TRAIN_PHRASINGS = 8;

const PHRASINGS = {
    SORT: [
        (p, r) => `${cap(pick(r, LEX.grab))} the ${p.list} ${pick(r, LEX.balls)} and ${pick(r, LEX.put)} them in their respective ${pick(r, LEX.bucket)}.`,
        (p, r) => `${cap(pick(r, LEX.put))} every ${p.list} ${pick(r, LEX.ball)} into the ${pick(r, LEX.bucket)} of the same colour.`,
        (p, r) => `Sort the ${p.list} ${pick(r, LEX.balls)} into their matching ${pick(r, LEX.buckets)}.`,
        (p, r) => `Each ${p.list} ${pick(r, LEX.ball)} belongs in the ${pick(r, LEX.bucket)} that matches it — please move them.`,
        (p, r) => `I need the ${p.list} ones off the ${pick(r, LEX.table)} and in the right ${pick(r, LEX.buckets)}.`,
        (p, r) => `Clear the ${p.list} ${pick(r, LEX.balls)} away, colour-matched ${pick(r, LEX.bucket)} for each.`,
        (p, r) => `Can you ${pick(r, LEX.put)} the ${p.list} ${pick(r, LEX.balls)} where they belong?`,
        (p, r) => `Ensure the ${p.list} ${pick(r, LEX.balls)} end up in their respective ${pick(r, LEX.buckets)}.`,
        /* --- held out --- */
        (p, r) => `Tidy up: anything ${p.list} goes in the ${pick(r, LEX.bucket)} of its own colour.`,
        (p, r) => `The ${p.list} ${pick(r, LEX.balls)} are misplaced. Return each to its colour ${pick(r, LEX.bucket)}.`,
        (p, r) => `Would you mind sorting out the ${p.list} ${pick(r, LEX.balls)} by colour?`
    ],
    ALTERNATE: [
        (p, r) => `${cap(pick(r, LEX.grab))} the ${p.a} and ${p.b} ${pick(r, LEX.balls)} interchangeably.`,
        (p, r) => `Alternate between ${p.a} and ${p.b} ${pick(r, LEX.balls)}, each into its own ${pick(r, LEX.bucket)}.`,
        (p, r) => `One ${p.a}, then one ${p.b}, then ${p.a} again — keep taking turns.`,
        (p, r) => `Never ${pick(r, LEX.put)} two ${p.a} ${pick(r, LEX.balls)} in a row; swap to ${p.b} between each.`,
        (p, r) => `Sort ${p.a} and ${p.b} ${pick(r, LEX.balls)}, but strictly alternating colours.`,
        (p, r) => `Take turns: a ${p.a} ${pick(r, LEX.ball)}, a ${p.b} ${pick(r, LEX.ball)}, and so on into matching ${pick(r, LEX.buckets)}.`,
        (p, r) => `Interleave the ${p.a} and ${p.b} ${pick(r, LEX.balls)} as you fill the ${pick(r, LEX.buckets)}.`,
        (p, r) => `${cap(pick(r, LEX.put))} them away ${p.a}, ${p.b}, ${p.a}, ${p.b} — matching ${pick(r, LEX.bucket)} every time.`,
        /* --- held out --- */
        (p, r) => `Work through the ${p.a} and ${p.b} ${pick(r, LEX.balls)} in rotation, one colour after the other.`,
        (p, r) => `Do not repeat a colour back to back — ${p.a} then ${p.b}, over and over.`,
        (p, r) => `Please handle ${p.a} and ${p.b} ${pick(r, LEX.balls)} alternately, correct ${pick(r, LEX.bucket)} each time.`
    ],
    LEAVE_ONE: [
        (p, r) => `Ensure the ${pick(r, LEX.balls)} end up in their respective ${pick(r, LEX.buckets)}, but leave one ${p.spare} left on the ${pick(r, LEX.table)}.`,
        (p, r) => `Sort everything by colour except keep a single ${p.spare} ${pick(r, LEX.ball)} out.`,
        (p, r) => `${cap(pick(r, LEX.put))} all the ${pick(r, LEX.balls)} away, apart from one ${p.spare} which stays on the ${pick(r, LEX.table)}.`,
        (p, r) => `Colour-match every ${pick(r, LEX.ball)} into its ${pick(r, LEX.bucket)}, holding back exactly one ${p.spare}.`,
        (p, r) => `Clear the ${pick(r, LEX.table)} into the matching ${pick(r, LEX.buckets)} — one ${p.spare} ${pick(r, LEX.ball)} must remain.`,
        (p, r) => `Everything goes in its own colour ${pick(r, LEX.bucket)}, except a lone ${p.spare} ${pick(r, LEX.ball)}.`,
        (p, r) => `Sort them all, but I want one ${p.spare} ${pick(r, LEX.ball)} still sitting out when you finish.`,
        (p, r) => `All ${pick(r, LEX.balls)} to their colour ${pick(r, LEX.buckets)}; save one ${p.spare} for me.`,
        /* --- held out --- */
        (p, r) => `Tidy the lot into matching ${pick(r, LEX.buckets)}, but don't take the last ${p.spare} ${pick(r, LEX.ball)}.`,
        (p, r) => `Finish with a single ${p.spare} ${pick(r, LEX.ball)} on the ${pick(r, LEX.table)} and everything else colour-sorted.`,
        (p, r) => `Sort by colour. Exception: one ${p.spare} ${pick(r, LEX.ball)} stays where it is.`
    ],
    COUNT: [
        (p, r) => `${cap(pick(r, LEX.put))} exactly ${p.nw} ${p.color} ${p.noun} in the ${p.color} ${pick(r, LEX.bucket)}.`,
        (p, r) => `I only want ${p.nw} ${p.color} ${p.noun} moved — leave the rest alone.`,
        (p, r) => `${cap(pick(r, LEX.grab))} ${p.nw} ${p.color} ${p.noun} and nothing else.`,
        (p, r) => `Just ${p.nw} ${p.color} ${p.noun} into the matching ${pick(r, LEX.bucket)}, then stop.`,
        (p, r) => `Move ${p.nw} of the ${p.color} ${pick(r, LEX.balls)} to its ${pick(r, LEX.bucket)}; don't touch anything else.`,
        (p, r) => `${p.nw === "one" ? "A single" : cap(p.nw)} ${p.color} ${p.noun} in the ${p.color} ${pick(r, LEX.bucket)}, please.`,
        (p, r) => `Deliver ${p.nw} ${p.color} ${p.noun}. That is the whole job.`,
        (p, r) => `Limit yourself to ${p.nw} ${p.color} ${p.noun} in the ${p.color} ${pick(r, LEX.bucket)}.`,
        /* --- held out --- */
        (p, r) => `No more than ${p.nw} ${p.color} ${p.noun} should leave the ${pick(r, LEX.table)}.`,
        (p, r) => `Stop after ${p.nw} ${p.color} ${p.noun} have gone in.`,
        (p, r) => `Only ${p.nw} of the ${p.color} ${pick(r, LEX.balls)} needs sorting.`
    ],
    ORDER: [
        (p, r) => `First the ${p.a} ${pick(r, LEX.balls)}, then the ${p.b} ones, each into its matching ${pick(r, LEX.bucket)}.`,
        (p, r) => `Do all the ${p.a} ${pick(r, LEX.balls)} before you start on the ${p.b}.`,
        (p, r) => `${cap(pick(r, LEX.put))} the ${p.a} ${pick(r, LEX.balls)} away first; the ${p.b} come after.`,
        (p, r) => `Finish the ${p.a} ${pick(r, LEX.balls)} completely, then move to ${p.b}.`,
        (p, r) => `Order matters: ${p.a} first, ${p.b} second, matching ${pick(r, LEX.buckets)}.`,
        (p, r) => `Start with ${p.a}. Once none are left, handle the ${p.b} ${pick(r, LEX.balls)}.`,
        (p, r) => `The ${p.a} ${pick(r, LEX.balls)} have priority over the ${p.b} ones.`,
        (p, r) => `Clear all ${p.a} ${pick(r, LEX.balls)} into their ${pick(r, LEX.bucket)}, and only then the ${p.b}.`,
        /* --- held out --- */
        (p, r) => `Don't touch a ${p.b} ${pick(r, LEX.ball)} until every ${p.a} one is sorted.`,
        (p, r) => `Sequence: all ${p.a}, afterwards all ${p.b}, colour-matched ${pick(r, LEX.buckets)}.`,
        (p, r) => `Deal with ${p.a} to completion before ${p.b} gets any attention.`
    ],
    EXCLUDE: [
        (p, r) => `Sort every ${pick(r, LEX.ball)} into its colour ${pick(r, LEX.bucket)}, but don't touch the ${p.skip} ones.`,
        (p, r) => `${cap(pick(r, LEX.put))} them all away except the ${p.skip} ${pick(r, LEX.balls)}.`,
        (p, r) => `Leave the ${p.skip} ${pick(r, LEX.balls)} exactly where they are; sort the rest by colour.`,
        (p, r) => `Everything but ${p.skip} goes in its matching ${pick(r, LEX.bucket)}.`,
        (p, r) => `Colour-sort the ${pick(r, LEX.table)}, ignoring the ${p.skip} ${pick(r, LEX.balls)} entirely.`,
        (p, r) => `The ${p.skip} ${pick(r, LEX.balls)} are off limits. Sort all the others.`,
        (p, r) => `Clear the ${pick(r, LEX.table)} of every colour except ${p.skip}.`,
        (p, r) => `Sort by colour, skipping ${p.skip} altogether.`,
        /* --- held out --- */
        (p, r) => `No ${p.skip} ${pick(r, LEX.ball)} should move. Everything else into its own ${pick(r, LEX.bucket)}.`,
        (p, r) => `Handle all colours apart from ${p.skip}, matching ${pick(r, LEX.buckets)}.`,
        (p, r) => `Keep your gripper off the ${p.skip} ${pick(r, LEX.balls)}; the rest need sorting.`
    ],
    ALL_TO_ONE: [
        (p, r) => `${cap(pick(r, LEX.put))} every ${pick(r, LEX.ball)}, whatever colour, into the ${p.bucket} ${pick(r, LEX.bucket)}.`,
        (p, r) => `All of them go in the ${p.bucket} ${pick(r, LEX.bucket)} — colour doesn't matter.`,
        (p, r) => `Ignore the colours and fill the ${p.bucket} ${pick(r, LEX.bucket)} with everything.`,
        (p, r) => `Sweep the whole ${pick(r, LEX.table)} into the ${p.bucket} ${pick(r, LEX.bucket)}.`,
        (p, r) => `Every single ${pick(r, LEX.ball)} belongs in the ${p.bucket} ${pick(r, LEX.bucket)} today.`,
        (p, r) => `${cap(pick(r, LEX.grab))} them all and ${pick(r, LEX.put)} them in the ${p.bucket} ${pick(r, LEX.bucket)}.`,
        (p, r) => `Use only the ${p.bucket} ${pick(r, LEX.bucket)}; put everything there.`,
        (p, r) => `Clear the ${pick(r, LEX.table)} — the ${p.bucket} ${pick(r, LEX.bucket)} takes the lot.`,
        /* --- held out --- */
        (p, r) => `Never mind matching colours: the ${p.bucket} ${pick(r, LEX.bucket)} gets every ${pick(r, LEX.ball)}.`,
        (p, r) => `Collect all the ${pick(r, LEX.balls)} in one place, the ${p.bucket} ${pick(r, LEX.bucket)}.`,
        (p, r) => `Empty the ${pick(r, LEX.table)} into the ${p.bucket} ${pick(r, LEX.bucket)}, regardless of colour.`
    ]
};

/* Resolve a spec's params into the string slots the templates expect. */
function phraseParams(spec, rng) {
    const p = spec.params;
    switch (spec.kind) {
        case "SORT": return { list: joinColors(p.colors.map(c => COLORS[c])) };
        case "ALTERNATE": return { a: COLORS[p.colors[0]], b: COLORS[p.colors[1]] };
        case "LEAVE_ONE": return { spare: COLORS[p.spare] };
        case "COUNT": return {
            color: COLORS[p.color], nw: NUMWORD[p.n],
            noun: p.n === 1 ? pick(rng, LEX.ball) : pick(rng, LEX.balls)
        };
        case "ORDER": return { a: COLORS[p.colors[0]], b: COLORS[p.colors[1]] };
        case "EXCLUDE": return { skip: COLORS[p.skip] };
        case "ALL_TO_ONE": return { bucket: COLORS[p.bucket] };
    }
    throw new Error("unknown kind " + spec.kind);
}

/* ------------------------------------------------------------- the task bank */
function buildTaskBank() {
    const specs = buildSpecs();
    const tasks = [];
    specs.forEach((spec, si) => {
        const list = PHRASINGS[spec.kind];
        for (let ti = 0; ti < list.length; ti++) {
            // One rng per (spec, template) so a sentence's synonyms never shift
            // when a neighbouring template is edited.
            const rng = taskRng(0x9E37 + si * 1013 + ti * 7919);
            const pp = phraseParams(spec, rng);
            tasks.push({
                id: `${spec.kind}#${si}#${ti}`,
                specIdx: si,
                kind: spec.kind,
                params: spec.params,
                text: list[ti](pp, rng),
                split: ti < TRAIN_PHRASINGS ? "train" : "holdout"
            });
        }
    });
    return tasks;
}

const TASKS = buildTaskBank();
const TASKS_TRAIN = TASKS.filter(t => t.split === "train");
const TASKS_HOLDOUT = TASKS.filter(t => t.split === "holdout");

/* A cheap stable hash over the corpus. The baked embedding file carries the
 * hash it was generated from; if a template is edited without re-baking, the
 * sim must refuse to run on stale vectors rather than quietly mislabel them. */
function corpusHash() {
    let h = 0x811c9dc5;
    for (const t of TASKS) {
        const s = t.id + "|" + t.text;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
    }
    return ("00000000" + h.toString(16)).slice(-8);
}

/* ==========================================================================
 *                              THE REFEREE
 * ========================================================================== */

/* Which bucket a ball of colour `c` must go into, under this spec. */
function bucketFor(spec, ballColor) {
    return spec.kind === "ALL_TO_ONE" ? spec.params.bucket : ballColor;
}

/* GoalEvaluator — stateful per episode.
 *
 * balls: [{id, color}] as spawned. Deliveries are reported in the order they
 * physically land in a bucket. The evaluator is authoritative about:
 *   allowedColors()  colours that would be a legal NEXT delivery
 *   isLegal(ball)    is this specific ball a legal next delivery
 *   deliver(...)     record one, return {correct, terminal}
 *   finish(state)    end-of-episode audit (leave-one / exclude compliance)
 */
class GoalEvaluator {
    constructor(spec, balls) {
        this.spec = spec;
        this.balls = balls.map(b => ({ id: b.id, color: b.color }));
        this.counts = new Array(NCOLORS).fill(0);
        for (const b of this.balls) this.counts[b.color]++;
        this.delivered = [];        // [{color, bucket, correct}]
        this.perColor = new Array(NCOLORS).fill(0);   // correct deliveries by colour
        this.wrong = 0;
        this.touchedForbidden = 0;  // grasps of a ball the spec says never to touch
        this.target = this.plannedTotal();
    }

    /* How many correct deliveries a perfect run makes. Fitness normalises by
     * this so a 2-ball task and an 8-ball task are comparable. */
    plannedTotal() {
        const p = this.spec.params, c = this.counts;
        switch (this.spec.kind) {
            case "SORT": return p.colors.reduce((s, k) => s + c[k], 0);
            case "ALTERNATE": return 2 * Math.min(c[p.colors[0]], c[p.colors[1]]);
            case "LEAVE_ONE": {
                const all = c.reduce((s, k) => s + k, 0);
                return c[p.spare] > 0 ? all - 1 : all;
            }
            case "COUNT": return Math.min(p.n, c[p.color]);
            case "ORDER": return c[p.colors[0]] + c[p.colors[1]];
            case "EXCLUDE": return c.reduce((s, k, i) => s + (i === p.skip ? 0 : k), 0);
            case "ALL_TO_ONE": return c.reduce((s, k) => s + k, 0);
        }
        return 0;
    }

    /* Colours the spec permits at all, ever (used for "don't touch" penalties). */
    permittedColors() {
        const p = this.spec.params, out = new Set();
        switch (this.spec.kind) {
            case "SORT": p.colors.forEach(c => out.add(c)); break;
            case "ALTERNATE": p.colors.forEach(c => out.add(c)); break;
            case "LEAVE_ONE": for (let c = 0; c < NCOLORS; c++) out.add(c); break;
            case "COUNT": out.add(p.color); break;
            case "ORDER": p.colors.forEach(c => out.add(c)); break;
            case "EXCLUDE": for (let c = 0; c < NCOLORS; c++) if (c !== p.skip) out.add(c); break;
            case "ALL_TO_ONE": for (let c = 0; c < NCOLORS; c++) out.add(c); break;
        }
        return out;
    }

    /* Colours that would be a legal delivery right now, given history.
     * `remaining` is a count-by-colour of balls still available on the table;
     * pass it so LEAVE_ONE can tell "one spare left" from "spare exhausted". */
    allowedColors(remaining) {
        const p = this.spec.params, k = this.spec.kind, out = new Set();
        const rem = remaining || this.counts;
        switch (k) {
            case "SORT":
                p.colors.forEach(c => { if (rem[c] > 0) out.add(c); });
                break;
            case "ALTERNATE": {
                const [a, b] = p.colors;
                const last = this.lastCorrectColor();
                const wantA = last === null || last === b;
                const wantB = last === null || last === a;
                // Only allow a colour if the OTHER colour can still follow it,
                // otherwise the alternation is dead and the episode is complete.
                if (wantA && rem[a] > 0) out.add(a);
                if (wantB && rem[b] > 0) out.add(b);
                break;
            }
            case "LEAVE_ONE":
                for (let c = 0; c < NCOLORS; c++) {
                    if (rem[c] <= 0) continue;
                    if (c === p.spare && rem[c] <= 1) continue;   // that one stays
                    out.add(c);
                }
                break;
            case "COUNT":
                if (this.perColor[p.color] < p.n && rem[p.color] > 0) out.add(p.color);
                break;
            case "ORDER": {
                const [a, b] = p.colors;
                if (rem[a] > 0) out.add(a);
                else if (rem[b] > 0) out.add(b);
                break;
            }
            case "EXCLUDE":
                for (let c = 0; c < NCOLORS; c++) if (c !== p.skip && rem[c] > 0) out.add(c);
                break;
            case "ALL_TO_ONE":
                for (let c = 0; c < NCOLORS; c++) if (rem[c] > 0) out.add(c);
                break;
        }
        return out;
    }

    lastCorrectColor() {
        for (let i = this.delivered.length - 1; i >= 0; i--)
            if (this.delivered[i].correct) return this.delivered[i].color;
        return null;
    }

    /* Record a ball landing in a bucket. */
    deliver(ballColor, bucketColor, remaining) {
        const allowed = this.allowedColors(remaining);
        const rightBucket = bucketColor === bucketFor(this.spec, ballColor);
        const correct = allowed.has(ballColor) && rightBucket;
        this.delivered.push({ color: ballColor, bucket: bucketColor, correct });
        if (correct) this.perColor[ballColor]++;
        else this.wrong++;
        return { correct, rightBucket, allowedColor: allowed.has(ballColor) };
    }

    /* Called when a ball is grasped, to catch "don't touch" violations early. */
    noteGrasp(ballColor) {
        if (!this.permittedColors().has(ballColor)) { this.touchedForbidden++; return false; }
        return true;
    }

    /* End-of-episode audit. `onTable` is a count-by-colour of balls still
     * resting on the table. Returns {complete, violations:[...]}. */
    finish(onTable) {
        const p = this.spec.params, k = this.spec.kind;
        const good = this.delivered.filter(d => d.correct).length;
        const violations = [];
        if (k === "LEAVE_ONE") {
            const left = onTable[p.spare] || 0;
            if (left !== 1) violations.push(left === 0 ? "took the spare" : "left too many spares");
        }
        if (k === "EXCLUDE") {
            const moved = this.delivered.filter(d => d.color === p.skip).length;
            if (moved > 0 || this.touchedForbidden > 0) violations.push("touched the excluded colour");
        }
        if (k === "COUNT") {
            // Count EVERY delivery of that colour, not just the ones the
            // referee scored as correct. The (N+1)th ball is marked incorrect
            // when it lands, so perColor never reaches N+1 and an overshoot
            // would slip past an audit that only looked at correct deliveries.
            const moved = this.delivered.filter(d => d.color === p.color).length;
            if (moved > p.n) violations.push("overshot the count");
            const strays = this.delivered.filter(d => d.color !== p.color).length;
            if (strays > 0) violations.push("moved the wrong colour");
        }
        const complete = good >= this.target && violations.length === 0 && this.wrong === 0;
        return { complete, violations, good, target: this.target };
    }
}

/* ------------------------------------------------- scene requirements per spec
 * How many balls of each colour a fair episode for this spec needs. Kept here
 * (not in world.js) because it is a property of the GOAL: a COUNT-2 task with
 * one ball of that colour is unsatisfiable, and an EXCLUDE task with no balls
 * of the excluded colour tests nothing. */
function sceneRecipe(spec, rng) {
    const p = spec.params;
    const n = new Array(NCOLORS).fill(0);
    const some = () => 1 + ((rng() * 2) | 0);           // 1..2
    switch (spec.kind) {
        case "SORT":
            p.colors.forEach(c => { n[c] = some(); });
            // distractors of colours NOT named — the whole test of "the green ones"
            for (let c = 0; c < NCOLORS; c++)
                if (!p.colors.includes(c) && rng() < 0.7) n[c] = 1;
            break;
        case "ALTERNATE":
            n[p.colors[0]] = 2; n[p.colors[1]] = 2;
            for (let c = 0; c < NCOLORS; c++) if (!p.colors.includes(c) && rng() < 0.4) n[c] = 1;
            break;
        case "LEAVE_ONE":
            for (let c = 0; c < NCOLORS; c++) n[c] = rng() < 0.6 ? 1 : 0;
            n[p.spare] = Math.max(1, n[p.spare]);         // there must BE a spare
            if (n.reduce((s, k) => s + k, 0) < 3) n[(p.spare + 1) % NCOLORS] += 1;
            break;
        case "COUNT":
            n[p.color] = p.n + 1;                         // strictly more than asked
            for (let c = 0; c < NCOLORS; c++) if (c !== p.color && rng() < 0.6) n[c] = 1;
            break;
        case "ORDER":
            n[p.colors[0]] = some(); n[p.colors[1]] = some();
            for (let c = 0; c < NCOLORS; c++) if (!p.colors.includes(c) && rng() < 0.35) n[c] = 1;
            break;
        case "EXCLUDE":
            n[p.skip] = 1 + ((rng() * 2) | 0);
            for (let c = 0; c < NCOLORS; c++) if (c !== p.skip) n[c] = rng() < 0.75 ? 1 : 0;
            if (n.reduce((s, k, i) => s + (i === p.skip ? 0 : k), 0) === 0) n[(p.skip + 1) % NCOLORS] = 1;
            break;
        case "ALL_TO_ONE":
            for (let c = 0; c < NCOLORS; c++) n[c] = rng() < 0.65 ? 1 : 0;
            if (n.reduce((s, k) => s + k, 0) < 2) { n[0] += 1; n[2] += 1; }
            break;
    }
    return n;
}

if (typeof module !== "undefined") module.exports = {
    COLORS, COLOR_HEX, NCOLORS, TASKS, TASKS_TRAIN, TASKS_HOLDOUT,
    GoalEvaluator, bucketFor, sceneRecipe, corpusHash, taskRng, buildSpecs, TRAIN_PHRASINGS
};
