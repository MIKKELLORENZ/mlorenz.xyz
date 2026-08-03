# Chess Neuroevolution

A chess player that is never taught anything. It is a neural network whose every
weight is found by mutation, crossover and selection — no gradient descent, no
backpropagation, no value targets, no replay buffer. The only feedback any
genome ever receives is whether it won its games.

Open `index.html`. Nothing to build, nothing to install.

It opens on a choice:

- **Play against Mikkel's AI** — the strongest brain trained so far, bundled with
  the page in `default_brain.js`. Evolved offline to generation 439.
- **Train from scratch** — a fresh population of random brains, starting from
  nothing.

Training stays paused behind that screen. Nobody who came here for a game needs
generations grinding away behind the board, and nobody who came to train wants
generation 1 to start while they are still reading. Opening the Train tab later
starts it.

## The three tabs

| tab | what it does |
|---|---|
| **Train** | runs the evolution, showing whichever genome currently leads its generation |
| **Watch Champion** | the best brain plays on its own against an opponent you pick, at a pace you set |
| **Play vs Champion** | you take the other side of that same brain |

Watch and Play both let you choose *which* brain: **Mikkel's AI** (the bundled
one, and the strongest that exists here, so it is the default), your own
champion once training has produced one, the current generation's leader, or any
champion still in your archive. In Watch you also choose the opposition — any
rung of the opponent ladder, a mirror match against itself, or another evolved
brain — plus pace, whether openings vary, and whether it keeps starting new
games. Both decision heads are painted live on the board throughout.

Watched games run through the same `Match` class training uses, so what you see
is played under exactly the rules that decided selection.

Handy deep links, all of which skip the opening choice: `?start=play` goes
straight into a game against Mikkel's AI, `?mode=watch` / `?mode=play` open a
tab, and `?bench=N` trains N plies synchronously before the first frame (used
for screenshots and headless assertion runs).

The board, its caption, the legend and the control dock are one flow column, so
the controls can never end up on top of the board — on a short window the board
gives up height instead.

---

## The brain

One genome is **6 636 numbers**: the complete weights and biases of a dual-head
pointer network.

### Two heads, one decision

The network is split the way a player thinks about a move:

| head | output | meaning |
|---|---|---|
| **FROM** | one scalar per square | how much I want to move the piece standing here |
| **TO** | one scalar per (from, to) pair | …and how much I want it to end up there |
| **PROMO** | 4 scalars | queen / rook / bishop / knight |

A move is worth `FROM[origin] + TO[origin][destination]`, and the brain plays the
best-scoring legal move.

The two heads are not independent. The TO head's ranking of destinations is
conditioned on the origin through a learned query/key product, so a rook and a
knight standing on the same square get genuinely different destination maps —
which is the whole point of splitting the decision in two.

Tick **show the two heads** on the page to watch both distributions live on the
board: blue is the piece it wants to move, orange is where it wants it to go.

### It remembers the last five positions

Every square is described by 30 channels, and five of them hold **the entire
board, one to five plies into the past** — one complete previous position per
channel, not a summary of one. So the brain can see what just moved, whether it
is shuffling into a repetition, and which way material has been trending.

```
per square (30)                          whole position (36)
 0.. 5  own piece type                    material balance, piece counts
 6..11  opponent piece type               castling rights, checks
12..13  enemy attackers / own defenders   game progress, 50-move clock
   14   empty                             repetition count, mobility
15..19  the board 1..5 plies ago  <---    material balance 1..5 plies ago  <---
20..23  the last two moves played         pawn advancement, king pressure
24..25  rank, file centrality             hanging material on both sides
26..28  mobility from / to this square
   29   own piece here is hanging
```

The board is always presented from the mover's own side, so a single genome
plays white and black equally well.

### Why the network is shaped like this

A dense first layer over a chess board is roughly a hundred thousand weights —
far too many for a genetic algorithm to search. Instead **one small encoder is
shared by all 64 squares** and applied to each in turn, beside a learned 64×22
piece-square table that lets a shared encoder still say "this particular square
is special". Every one of the 6 636 genes therefore gets feedback from all 64
squares on every single ply.

```
30 channels ─┬─> [22] ─> [16] embedding      (shared by all 64 squares)
             │            + 64x22 piece-square table
             │
     mean/max pool + 36 globals ─> [40] trunk
                                     │
                    ┌────────────────┼────────────────┐
                  FROM             TO (bilinear)     PROMO
```

### No search, and what that costs

There is no tree, no lookahead, no evaluation of hypothetical positions. The one
exception is a move that delivers **checkmate immediately**, which is always
played — a player with no search has no way to tell a mate from a merely
aggressive check.

Because it cannot look ahead, everything tactical has to be *visible in the
input*. That is what the attack-count channels are for: a square attacked twice
and defended once is visibly poisoned, so "don't hang pieces" is something
evolution can actually discover rather than something it would have to simulate.

---

## How selection works

Each generation, every genome plays **eight games**.

**Four are self-play** against other members of the population — a random
pairing and a rank-adjacent pairing, colours swapped within each.

**Four are against a fixed ladder** whose strength never changes:

| rung | opponent | behaviour |
|---|---|---|
| 1 | random mover | uniform legal moves |
| 2 | capture grabber | takes the biggest capture 80% of the time |
| 3 | careless bot | half material bot, half capture grabber |
| 4 | material bot | 1-ply static eval, never leaves a piece hanging |

plus champions drawn from an archive of past winners.

The ladder matters more than it looks. Pure self-play has no absolute yardstick
— a population will happily go round in circles beating itself while getting
worse at chess. A fixed opponent means fitness in generation 900 measures the
same thing it measured in generation 9. Rungs unlock as the population outgrows
the one below, and beating a hard opponent is worth more than beating an easy
one.

**Every game starts from a different position** — a book line or a short random
prefix — and each colour-swapped rematch replays the same opening, so a pair of
games is a fair comparison rather than two samples of the same game. Without
this, two similar genomes play the identical game every time and a whole
generation produces almost no signal.

The next generation is elites, the reigning champion, champion variants,
row-wise crossover children, mutants, whole-row rewrites, and fresh random
immigrants. Mutation pressure rises automatically when progress stalls, and
genomes that collapse onto an elite are shaken hard so the population never
becomes a room full of clones.

A new best-of-generation only takes the crown after **beating the sitting
champion head to head** by a margin. Without that rule the title just tracks
luck in an eight-game sample, and the archive fills up with genomes that were
never better than the ones they replaced.

---

## Files

| file | what it is |
|---|---|
| `chess.js` | 0x88 rules engine: full legal moves, attack maps, five-position history, Zobrist repetition |
| `features.js` | position → 64×30 square tensor + 36 globals, from the mover's point of view |
| `nn.js` | the dual-head network, and every genetic operator |
| `evolution.js` | move selection, openings, the ladder, fitness, the GA |
| `main.js` | UI, rendering, training and play loops |
| `default_brain.js` | the built-in champion, written by `bake_brain.js` |

### Tools

```bash
node test_headless.js     # rules (perft to depth 4), features, network, genetics, GA
node test_ui.js           # boots the page against a stub DOM; catches broken element ids
node train_headless.js    # island-model trainer across every core
node probe_champion.js    # what did it actually learn — blunders, captures, draw reasons
node bake_brain.js        # re-measure a champion and write default_brain.js
```

`train_headless.js` runs one independent population per worker and, every few
generations, has the island champions fight a round robin; the winner must then
beat the reigning global champion over a longer match before it is crowned and
seeded back into every island. Islands beat one big population here because a
single population converges onto one style of play and then has nothing left to
learn from itself — and because each worker runs the same `evolution.js` the
browser runs, so the offline trainer and the page cannot drift apart.

```bash
node train_headless.js --pop 40 --workers 5 --epoch 6
node train_headless.js --resume training/champion.json
```

Writes `training/champion.json` and `training/log.csv` every epoch, so a run can
be killed and picked up later.

---

## What the shipped brain actually does

`default_brain.js` was evolved to generation 439 by `train_headless.js` (five
islands, population 40, about an hour on a desktop). Re-measured afterwards over
30 games per opponent on seeds it never trained on, beside an untrained genome
of the identical architecture:

| opponent | evolved | untrained |
|---|---|---|
| random mover | **100%** | 23% |
| capture grabber | **95%** | 13% |
| careless bot | **50%** | 2% |
| material bot | **20%** | 2% |
| an untrained net, head to head | **93%** | — |

The percentages are the least interesting row of the table. This is the
interesting one:

| | evolved | untrained |
|---|---|---|
| moves that hang a piece for nothing | **1.9 – 3.9%** | 5.8 – 7.4% |
| moves that are captures | **14 – 31%** | 7 – 10% |
| games decided by checkmate | **58%** | 55% |
| draws by repetition | **4%** | — |

It stopped donating material, which is the one thing a player with no search has
to learn from the position alone, and it did it with no gradient anywhere — only
mutation, crossover, and whether it won.

### What it never learned

**It does not castle. Ever.** Not a bug — the move is generated, scored, and
legal; it is simply ranked around 18th of 33 in a position where it is clearly
right. What happened is that the FROM/TO factorisation learned "moving the king
is bad", which is true in general and fatal here: castling has to overcome that
prior through the TO head alone, and it never did. It is a real cost of
splitting the decision in two, and a good example of the kind of thing that is
obvious in the behaviour and invisible in the score.

It also converts won endgames badly, and roughly a third of its games are still
decided by material adjudication rather than mate.

## Honest expectations

This does not become a strong engine, and it is not trying to. A searchless
policy found by a genetic algorithm lands somewhere around *a beginner who has
stopped hanging pieces*.

`probe_champion.js` is the honest scoreboard, and the tables above are its
output. A ladder percentage tells you whether a brain wins; it does not tell you
why, and the two commonest failure modes both hide behind a mediocre percentage:
a brain that shuffles to repetition draws, and a brain that blunders every few
moves but wins anyway because its opponent is worse.

### If you want to push it further

Training had clearly plateaued around 65–74% across the ladder when this brain
was baked, so there is headroom left in the obvious places:

```bash
node train_headless.js --resume training/champion.json --pop 64 --workers 8
```

More games per genome per generation (`GA.gauntletOpponents`) buys a cleaner
fitness signal at linear cost, and is probably the highest-value knob. A fifth
ladder rung above the material bot would give the top of the ladder somewhere to
climb. And the run above never once dropped below the tier-4 gate, so the
population spent its whole life against opponents it had already half-beaten.
