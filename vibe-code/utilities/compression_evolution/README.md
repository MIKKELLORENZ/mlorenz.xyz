# Compression Evolution

A genetic algorithm that **invents lossless compression algorithms**, starting from
nothing but "count which byte values are common". Every candidate is a real compressor:
it is run, its output is counted in bytes, and the champion is decompressed again and
compared with the original bit for bit. You can download the compressed file and
restore it on the same page.

By default it evolves **one design for every bundled file at once** — a photo, a novel,
two recordings and source code — scored by its average ratio. Pick a single file and a
specialist is evolved instead, starting from the shared design rather than from nothing.

The chart's grey lines are gzip, bzip2, xz, zstd, brotli, PPMd, PNG, WebP, JPEG-LS,
JPEG 2000, JPEG XL, FLAC, WavPack … **measured with the real tools on the very same
bytes**. The point is not to beat them. It is to watch what a compressor *is* take
shape: what it looks at, what it guesses, and where the bits go.

Open `index.html` — no build step, no server needed (it also runs from `file://`).

| URL | |
|---|---|
| `index.html` | the all-files dataset; continues the run saved in this browser, if any |
| `?data=cat` (`alice`, `guitar`, `meow`, `code`, `all`) | pick the dataset |
| `?run=1` | start evolving straight away |
| `?replay=1` | load the run recorded offline for that dataset (`champions.js`) |
| `?theme=light` / `dark` | override the system appearance · `?quiet=1` skips the first-visit sheet |

## Saving, resuming, carrying designs over

* **Autosave.** Every run is saved per dataset in `localStorage` (every 20 s, on pause,
  on switching dataset, on leaving the page). Coming back to a dataset, or reopening the
  page, continues it: its lines stay on the chart as fixed history, every family's best
  design and the last survivors seed the population, the generation count carries on.
* **Save run to a file / Load a saved run** (Settings) write and read the same record
  as JSON — a few tens of kilobytes holding the champion, each family's best design, the
  surviving population, the chart lines and the discovery log. Loading a run made for a
  bundled dataset switches to it and continues. Loading one made for data that is not
  here carries its *designs* over to the current data instead.
* **Switching dataset never stops evolution.** If it was running it keeps running, and
  the best design of every family in the run being left is carried into the next one,
  on top of whatever that dataset had saved.
* **Download algorithm** (top bar, one click) saves the design on screen as a small JSON
  file. "Load a saved run" accepts it too: the design joins the population.
* **Start over** forgets the saved run for the current dataset.
* **Copy as JSON** puts the champion's genome on the clipboard; `codec.compress(data,
  genome, { shape })` runs it anywhere (Node included).
* A single-file run that has no history of its own **starts from the generalist's
  designs** (the saved all-files run, else the recorded one). Designs transfer because
  they are structure-relative — see below.

## What you are looking at

**The number** — the champion's compressed size as a share of the original (for several
files: the mean of the per-file ratios), and how many reference tools it is ahead of.

**Compressed size by generation** — one line per architectural *family*, on a log axis
(ratios are what compression is about). Dots are whole-data measurements; the line
between dots is an estimate from the fitness sample (see "two numbers"). The selected
family is the only coloured mark; hover for a crosshair; the standings list is the same
data as a table.

**One design, every file** (all-files dataset) — what the single design achieves on each
file, next to gzip and to the best existing tool *for that file*. Select a row to look
at that file.

**Where the bits go** — the file next to what the champion paid for every byte of it.
For the photo this is the most instructive picture on the page: the blurred background
is nearly free, every hair of fur costs. For text each character is tinted: the first
letter of a word is expensive, the rest of the word is almost free, because by then the
model knows which word it is. For audio there is a cost strip under the waveform (the
pluck of the string is where the bits go).

**Where the bits are saved** — every byte starts at 8 bits; the design is scored five
times on the fitness sample with more and more of it switched on (byte counting only →
plus the numeric predictor or the sort → plus the context experts → plus the
repeat-finder → everything), and each step's gain is a bar. The map above it has a
Bits spent / Bits saved toggle for the same question asked per byte.

**The algorithm** — the evolved design as a sequence of steps in plain language. Every
context expert gets a *stencil*: a small map of the bytes before (and, for data with
rows, above) the byte being coded — solid square: a byte it reads; hollow square: a
prediction error it reads; dot: part of a formula; outlined: the byte being coded — plus
its share of the mixer's attention on the file on screen. Select another family in the
standings or the legend to read its best design instead.

**Discoveries** — every improvement of the champion with the mutation that caused it,
and a milestone whenever a reference tool is passed.

## The idea in one paragraph

Compression is prediction. An arithmetic coder turns a probability *p* for the next
bit into −log₂ *p* bits, within 0.01 % of that limit — so the coder is fixed and not
evolved, and *every byte saved comes from predicting better*. What evolves is the
predictor: which earlier bytes to look at, which numeric guess to subtract first,
whether to sort the file beforehand, how to weigh several opinions against each other.
That is also, give or take, the design space real compressors live in: PNG and JPEG-LS
are "guess the pixel, code the error", FLAC is the same for 16-bit waves, bzip2 is "sort
first", PPMd and the PAQ family are "mix many context models", gzip's dictionary
matching shows up here as a *repeat-finder* expert.

## A genome is a complete compressor

`codec.js` runs any genome as a working codec. `normalize()` turns any object into a
valid one, so mutation can be sloppy and the codec never sees an illegal program.

| part | what it is | genes |
|---|---|---|
| `pre` | block transforms | Burrows–Wheeler sort, move-to-front |
| `front8` | numeric predictor for 8-bit grids (pixels, tables); the model then codes the *error* | 1–8 formulas cycled over the file's channels: up to 6 taps `coef · value[offset]`, a shift, optional clamp between the first two taps (so "W + N − NW, clamped" = the MED predictor of JPEG-LS is reachable) |
| `front16` | the same for 16-bit numbers; high byte coded first | as above |
| `experts` | context models, each with its own adaptive bit-probability tables | up to 4 *clues* each (below) + how fast it forgets; or a *repeat-finder* (minimum match length) |
| `mixers` | logistic mixing of the experts' bets, weights re-learned every bit | 1–2 mixers, learning rate, which weight set to use (none / bit position / partial byte / any clue) |
| `apms` | final probability refinement (SSE) | 0–2 stages, context, rate, strength |

The ten kinds of clue an expert can watch: a byte at some offset (top *q* bits), a
prediction error at some offset (exact / sign-and-size / size), the predicted value
itself, a linear formula over earlier bytes (optionally minus the prediction — "does
the pixel above disagree with my guess?"), the last *n* bytes, the current word (and
the one before), position modulo the unit / the row / a literal, the current run length,
the text column, the character directly above in the previous line.

### Offsets are structure-relative — that is what makes ONE design possible

An offset is a triple **[rows, units, bytes]** and means `rows·S + units·p + bytes`,
where *p* (one pixel, one sample frame, one record) and *S* (one row) are properties of
the **file**. `analyze.js` finds them the way a curious engineer would — an FFT
autocorrelation for the distances at which bytes resemble each other (3 and 2208 for the
cat: RGB, 736 px wide), byte entropy and smoothness at even vs odd positions for 16-bit
data, the sample-level autocorrelation for mono vs stereo — and the codec stores them in
every compressed file's header (3–4 bytes), so the decoder resolves offsets identically.

So `[1,0,0]` is "directly above" in an image of *any* width, `[0,1,0]` is "the same
channel one unit earlier" in RGB and in stereo PCM alike, and on a file with no rows a
clue about rows compiles to a constant and is ignored by the mixer. The two predictors
wake up only where they apply (16-bit data / other gridded non-text data), so one
genome can carry both. Earlier the genome held absolute distances such as 2208: a
design was then a description of one particular cat, could not be judged on a second
file, and every dataset started from scratch.

A genome is 20–120 bytes as a header. The file format is `CEv2 · length · table-size
limit · shape (p, S, flags) · genome · BWT row numbers · arithmetic-coded bits` —
self-describing, so a `.cev` file restores with no other information, and the header is
counted in every size on the page.

## Three families

Designs are grouped by skeleton and kept as separate niches, so the page can show what
each idea looks like at its best instead of only the winner:

| family | skeleton | relatives |
|---|---|---|
| Direct modelling | predict raw bytes from context | PPM, PAQ |
| Predict, then model the error | a numeric predictor (8-bit, 16-bit or both) in front | PNG, JPEG-LS, FLAC |
| Sort, then model | Burrows–Wheeler first | bzip2 |

Which one wins depends on the data — that is the experiment. Photo and audio:
*predict*. Text: *direct*. All files together: *predict*, because its predictors stay
silent on text and cost nothing there. A family that has had 30 generations, has stopped
improving and is still 1.5× behind the leader goes extinct and loses its breeding slots.

## The genetic algorithm (`evolution.js`)

* **Generation 0 is one design** — order-0, "count the bytes" (plus whatever a saved run
  or the generalist carries in). Everything on the chart after that was found. Simple
  founders of families nobody has tried yet are injected during the first generations,
  so the comparison of families does not depend on luck.
* **Fitness is deterministic**: the same design compresses the same sample to the same
  number of bytes. So results are cached, elites are never re-tested, and there is no
  winner's curse. The price of determinism + elitism is premature convergence, hence:
* **Niches.** Every living family keeps two seats and ~12 % of the children; the
  leader's family takes the rest. Children are mutated copies (15 % crossover first —
  which also lets a design that is good on pictures inherit the 16-bit predictor of one
  that is good on sound); a child lands in whatever family its genome now belongs to.
* **Racing.** A candidate is compared with the weakest survivor *of its own family* at
  checkpoints (25/50/75 % of a single file; after each file of several) and abandoned if
  clearly behind (12 % at the first checkpoint, 3.5 % at the last).
* **Compound mutations.** `W + N` is awful until it is halved, and needs `− NW` to
  become a gradient: good predictor formulas are two edits apart with a valley between.
  So the predictor operator can also propose whole shapes (gradient, average, line
  through two values, curve through three). With single edits only, "W + N − NW" had a
  ~0.004 % chance per mutation and never appeared in hundreds of generations.
* A small parsimony pressure (0.04 % per expert) and a cap on experts (12; a design
  carried in from a saved run lifts the cap to its own size, or none of its children
  could be more than a truncated copy of it).

## Two numbers, never to be confused (`run.js`)

| | what | used for |
|---|---|---|
| **sample score** | the fitness sample: a few aligned slices from all over each file (whole rows for images) | selection; fast and exact |
| **full score** | the whole file(s), from an *exam* in a dedicated worker | everything that is reported: headline, standings, champion, dots |

With several files the score is the **mean ratio**, scaled to a nominal 1,000,000, so a
100 KB text counts as much as a 1 MB photo (total bytes would simply be "the cat").

The reference tools were measured on whole files, so only whole-file numbers may be
compared with them. But an exam takes seconds and generations are fast, so exams cannot
keep up while evolution is moving quickly. The line between two dots is therefore an
estimate: the family's sample score times the full/sample ratio of its last measured
design. Each exam becomes a dot, recalibrates what follows, and the estimates before it
are blended from the previous ratio to the new one so no step appears. Exam slots are
served round-robin (the leading family counts three times) so a fast-improving leader
cannot starve the others — before that, the other families showed "…" for fifty
generations. Decode-and-compare costs as much as the exam itself, so it runs when the
exam worker is idle, and at least every ten seconds.

## The reference lines (`tools/make_corpus.py`)

Measured, not quoted. `gzip -9` is the GNU binary; bzip2 / xz / brotli / zstd / PPMd
are the reference libraries at their strongest ordinary setting (the bzip2, xz and
brotli numbers are byte-identical to the command-line tools; checked). Image codecs:
Pillow (PNG optimised, WebP lossless method 6, JPEG 2000 reversible) and ffmpeg
(JPEG-LS, JPEG XL effort 9, QOI). Audio: ffmpeg (FLAC level 12, WavPack, TTA, ALAC).
"Huffman-style" is the zeroth-order entropy of the byte histogram. For the all-files
dataset a line is the mean ratio of a tool that can handle *all* the files (an image
codec cannot compress a novel), plus **"Best tool per file"**: a toolbox of specialists
with the right one picked by hand each time — JPEG XL for the photo, PPMd for the texts,
WavPack for the recordings. For a file you drop in, only the entropy bound and your
browser's own gzip (`CompressionStream`) are available.

## What it found (the run recorded in `champions.js`)

One design, 35 minutes on five laptop workers, 401 generations, 10,264 designs tried,
re-verified on every whole file while baking. `?replay=1` shows the run.

| file | the ONE design | gzip -9 | best existing tool for that file |
|---|---|---|---|
| Cat photo | **41.00 %** | 80.33 % | 38.24 % JPEG XL (PNG 54.44, JPEG-LS 50.62, WebP 40.88) |
| Alice | **25.21 %** | 35.62 % | 25.55 % PPMd |
| Guitar | **28.51 %** | 71.03 % | 26.81 % WavPack (FLAC 28.60) |
| Meow | **47.99 %** | 78.12 % | 42.00 % WavPack (FLAC 48.94) |
| Source code | **23.72 %** | 31.37 % | 25.12 % PPMd |
| **mean** | **33.28 %** | 59.29 % | 31.54 % with the right tool picked by hand each time |

Every general-purpose tool's mean is far behind (xz 49.10 %, brotli 49.21 %, PPMd
51.44 %, bzip2 51.98 %, zstd 55.51 %); only the hand-picked toolbox stays ahead. What
evolution assembled: an 8-bit predictor `(left + up) / 2, kept between left and up`, a
16-bit predictor `2·s[−1] − s[−2]` (the line through the last two samples — FLAC's
order-2 predictor), seven context experts (order-0, the last 3 and the last 5 bytes, the
letters of the current word together with the byte before, and three that watch the
prediction errors of neighbouring units and channels), a repeat-finder, two mixers (one
set of weights per previous byte, one per byte of the unit) and two correction stages.

Where the 8 bits of an average byte go, measured on the whole files (the page shows the
same breakdown on its fitness sample): 2.42 saved by counting byte values, 1.05 by
numeric prediction, 1.76 by the context experts, 0.02 by the repeat-finder, 0.09 by
mixing and correction — 2.66 still paid. Numeric prediction is worth nothing on the
texts and 26 points on the guitar; the experts are worth 30 points on Alice and 11 on
the photo. That is the trade a generalist makes.

Earlier single-file runs of 2–3 minutes (before designs became structure-relative)
reached about 39.7 % on the cat, 24.3 % on Alice and 27–28 % on the guitar: a specialist
still beats the generalist on its own file, which is what picking a single file is for.

## Design

The page follows one brief: content first, one primary action (Evolve), hierarchy from
type and space rather than boxes, near-monochrome with exactly one accent, light and
dark from the same tokens, progressive disclosure instead of a dashboard. Concretely:

* `style.css` starts with the tokens — colours, an 8-step type scale, a 4 px spacing
  scale, radii, one shadow — and uses nothing else. Canvases read the same tokens
  through `getComputedStyle`, so the chart, the stencils and the cost map follow the
  appearance, including a live switch.
* The accent means *primary action, link, or current selection* and nothing else. That
  is why the selected family is the only coloured line on the chart; the others are
  neutral ink told apart by direct labels, the reference tools are hairlines, magnitude
  (the cost map, the tinted text) is one neutral ramp with a scale, and stencils encode
  by shape (solid, hollow, dot, outline).
* Settings, saving and loading live in a sheet; how bets are mixed and coded is one
  disclosure away; the log shows six rows until asked for more.
* No emoji, sentence case, no cards inside cards. It was checked at 375 px and in dark
  mode (the sheets needed a raised surface there; the segmented control widened its grid
  cell on a phone and clipped the text beside it).

## Engineering notes

* **One loop for both directions.** `runModel()` encodes and decodes with the same
  statements; `enc` only decides whether a bit comes from the data or from the decoder.
  The decoder cannot drift from the encoder because there is no second implementation.
  16-bit samples need care: while the low byte is being coded the true high byte is not
  known yet (the carry), so both sides work with the same *placeholder* until the
  sample is complete.
* **Bit-exact across engines.** Integer arithmetic only on the coding path: logistic
  tables from 65 integer knots (no `Math.exp`), table sizes from an integer `ceilLog2`
  (no `Math.log2`), mixers in int32 with clamped weights, a carry-less 32-bit range
  coder done entirely in `Math.imul` / `|0`. The table-size limit travels in the header:
  it changes which contexts collide, hence every prediction, hence it is part of the format.
* **Workers from a function's source text.** The whole engine lives inside
  `CE_CODEC_FACTORY()`; its `.toString()` is shipped into a Blob worker. That works
  from `file://`, where `new Worker("x.js")` is refused, and the same string runs under
  Node's `worker_threads` — page and trainer exercise one implementation. The corpus is
  loaded by script injection for the same reason (`fetch` of a sibling file is blocked
  on `file://`), with two retries.
* **Speed.** A bare order-0 binary coder does 0.06 µs/byte on this laptop; the generic
  model is ~0.27 µs/byte plus ~0.1 µs/byte per expert, i.e. 0.5–1 MB/s for a typical
  champion. Counter tables are one flat `Int32Array` (22-bit probability + 10-bit count,
  16-slot blocks with a verification tag, 3-way associative, least-used evicted), so a
  never-seen context answers "p = ½" and costs the mixer nothing. Converting the hot
  loop from uint32-in-doubles to pure int32 and from an array of tables to one table was
  worth ~25 %; mixer updates are skipped when the prediction was already within 0.6 % of
  the truth (< 0.01 % size, part of the format).
* **Suffix sorting by prefix doubling with radix passes** — O(n log n) on *any* input.
  A comparison sort is quadratic on exactly what a compressor meets most (long runs).
* Things that bit: Node's bundled zlib is Chromium's fork and its level 9 differs from
  GNU gzip by up to 5 % in either direction, so "gzip -9" has to come from the gzip
  binary; a 16-bit detector based on smoothness fails on *quiet* audio (the high byte
  flips between 00 and FF around zero) and one based on byte entropy fails on *loud*
  audio (busy high bytes) — it takes both, and bytes cannot tell mono from stereo at all
  (the 16-bit numbers can); redrawing a list while `S.run` still pointed at the previous
  dataset's run crashed on its champion's file count; a CSS `display` beats the `hidden`
  attribute; Python's `http.server` on Windows drops connections under parallel loads.

## Tests

`node test_headless.js` (100+ checks, ~1.5 min; `--fast` skips the 4 MB BWT and the
whole-corpus pass). The property everything rests on is fuzzed: **450 random designs** —
founders of every family, up to ten stacked mutations, crossovers, both predictors at
once — on an image, odd-length 16-bit audio, text, byte-shifted audio and an arbitrary
5 × 77 grid must all decode to exactly the input. Also: suffix array against a naive
sort (unary and binary alphabets included), BWT across a block boundary,
junk-in/valid-genome-out, structure-relative offsets resolving correctly per shape (and
saying nothing where they mean nothing), which predictor engages where, header round
trips including the shape, corrupt and foreign files refused, cost map sums to the
payload, racing aborts what it should, corpus CRCs, hand-built bzip2-like and PPM-like
genomes landing in bzip2's and PPMd's league on Alice (a sanity check of the engine, not
of the GA), the analyser naming every bundled file and its shape with nothing told
(quiet, loud, mono, stereo, byte-shifted), the same seed reproducing the same champion,
the worker pool (exam sizes equal to the main thread's, verification, `.cev` restore,
foreign file → error not crash, `flush()`), **save and resume** (recorded lines survive,
are only extended downwards, milestones are not announced twice), and the
**generalist**: three files of three kinds, score = mean of the per-file ratios, three
`.cev` files with three shapes and one algorithm, reference lines averaged only over
tools that handle every file, and a single-file run seeded with the generalist starting
where the generalist stood.

## Files

| | |
|---|---|
| `codec.js` | the engine: transforms, numeric fronts, context-mixing model, arithmetic coder, header |
| `analyze.js` | autocorrelation, 16-bit / channels / text / picture detection, `shapeOf`, `context`, fitness-sample slicing |
| `genome.js` | random designs, ~25 mutation operators (each returns a plain-English note), crossover, families, the describer |
| `evolution.js` | the GA: niches, racing, extinction, cache |
| `pool.js` | Blob / `worker_threads` pool, multi-file scoring, the exam worker |
| `run.js` | one run without DOM: exams, calibration, champion, milestones, log, `record()` / resume, reference lines |
| `render.js`, `views.js`, `main.js`, `style.css` | chart / standings / log, algorithm / bit-cost views, wiring and persistence, the design tokens |
| `corpus/*.js`, `corpus_meta.js` | test files as base64 + measured references (generated) |
| `champions.js` | runs recorded offline, for replay and as the generalist seed (generated, re-verified while baking) |
| `train_headless.js`, `bake_champions.js`, `tools/` | terminal trainer (`--resume`, `--from`), baker, corpus builder, `train_all.ps1` |

```
python tools/make_corpus.py --src <folder with the source material>    # see its docstring
powershell -File tools\train_all.ps1 -Workers 5                         # generalist, then specialists from it
node bake_champions.js                                                  # verifies and writes champions.js
```

## Corpus and credits (2.6 MB on disk, budget was 8 MB)

| file | bytes | source |
|---|---|---|
| Cat photo, 736 × 456 raw RGB | 1,006,848 | "Cat portrait" by Anton Petrov (Unsplash), CC0, via Wikimedia Commons; downscaled from 4000 × 2478 so no JPEG artefacts survive |
| Alice in Wonderland | 152,089 | `alice29.txt` of the Canterbury corpus; Lewis Carroll, public domain |
| Guitar chord, 16-bit stereo 44.1 kHz | 569,656 | "Audio files of spanish guitar chords 22" by Wilfredor, CC0, via Wikimedia Commons; resampled from 24-bit / 96 kHz |
| Cat meow, 16-bit mono | 133,770 | "Meow of a Siamese cat" by freemaster2, CC0, via Wikimedia Commons |
| This page's own source | 109,664 | a snapshot of `codec.js`, `genome.js`, `evolution.js`, `analyze.js`, `pool.js`, taken while they were being written (frozen: it is part of the all-files dataset, so changing it would invalidate recorded runs) |

## Limits, honestly

* Five files are a small world. "One design for all data" here means one design for a
  photo, English text, JavaScript and two recordings; the structure-relative genome
  makes it *run* on anything, but how well it does on a spreadsheet or a DNA sequence
  was not measured.
* It is slow: 0.5–1 MB/s, against hundreds for the reference tools. Everything here
  buys ratio with time, which is the opposite of what gzip or zstd are for.
* JPEG XL and WebP stay ahead on the photo, WavPack and TTA on both recordings (FLAC and
  Apple Lossless are passed). Closing that would take adaptive (LMS) predictors and bias
  cancellation — a bigger vocabulary, not more generations.
