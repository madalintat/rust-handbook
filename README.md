# Rust Handbook

Learn Rust by fighting the compiler. Every exercise here compiles for real on
`play.rust-lang.org` — not a simulation, not a quiz — and when rustc rejects your
code you get its actual diagnostic with a plain-English reading of what the
borrow checker saw and why it cared.

Static site, no framework, no build step at deploy time. `build.py` turns
authored markdown into JSON once, and the browser fetches one unit at a time.

## What is in it

| | |
|---|---|
| **28 units** | A single ordered path through the official books, each unit needing only what came before it |
| **49,835 words** | 1,400–2,000 per unit, dense rather than long. Every rule attached to the reason it exists — what the compiler is protecting, what the memory looks like, which bug the rule prevents |
| **224 compiled exercises** | Broken code you fix, verified by hidden tests against real `rustc`. Every likely error is pre-written with an explanation of that specific diagnostic |
| **420 drills** | Fast multiple choice — does this compile, and if not, which error — each with a worked answer |
| **211 glossed terms** | Every bolded term carries one plain sentence saying what it means, on hover and on its own page |

Units 00–24 walk the language. Three more exist in no single book and are the
reason this is not just a re-skin of the docs:

- **25 · Reading the compiler** — the thirty error codes you will actually meet,
  what each is really saying, and how to read a diagnostic you have never seen
- **26 · Ship it** — a real command-line tool end to end: cargo, clap, anyhow,
  tests, docs, release. Everything so far, used at once
- **27 · No_std and embedded** — what the standard library actually is, what
  survives without it, and how the same language runs on a microcontroller

The track page is honest about which units are written; the rest say "soon".

## The point of the thing

Rustlings gives you a hint. The Book gives you a rule. Neither tells you what the
borrow checker actually saw.

Each exercise carries a `diagnose` map from error code to prose. When your run
fails, the workbench parses `error[E0382]` out of `stderr` and renders our
reading of it next to rustc's own output, with the offending line echoed from
your buffer and a caret under the column. Codes we have not written for fall back
to rustc's text plus a link into the error index.

That is the whole differentiator, and it is why the exercises are per-error
rather than per-topic.

## Validation — the content has a test suite

```sh
python3 build.py --validate
```

sends every exercise's starter and solution to the playground and asserts:

- the starter **fails**, with the error code the exercise claims it will raise
- there is a written explanation for the code it actually raised
- the solution **compiles** and passes every hidden test

A hand-written Rust exercise rots silently: rustc changes its diagnostics between
releases, and an exercise promising E0382 quietly starts emitting E0505 instead.
Because the source of truth is the actual compiler, that is now a build failure
rather than a confused reader. Results are cached by content hash, so a rebuild
after editing one paragraph sends zero requests.

## Running it

```sh
python3 build.py                 # regenerate data/ from content/
python3 -m http.server 8901      # any static server will do
```

Then open <http://localhost:8901>. `build.py` needs nothing but Python 3 — no
pip, no npm — and the site itself ships zero JavaScript libraries.

Tests:

```sh
node test_workbench.mjs   # tokenizer, playground client, diagnostics parser (hits the network)
node test_views.mjs       # every view renders, balanced HTML, no missing fields, output rendering
python3 build.py --validate                        # every exercise, cached by content hash
python3 build.py --check content/ex/<slug>.md      # one unit, writes nothing, safe in parallel
```

## Design

The structure is lifted from the Medical Student Handbook, which lifted its
palette from PostHog. What changes is temperature: PostHog's tan `#EEEFE9` is
faintly green, and next to rust orange a green-grey ground goes muddy, so every
neutral is rotated warm — light ground `#EFEBE4`, dark `#1C1917` rather than a
cool `#1e1f23`. The button keeps PostHog's shape, a solid fill sitting on a hard
shadow that it moves down onto when pressed, with Ferris's orange in it
(`#F7681F` fill, `#A8380F` border, `#C04A12` shadow).

Light and dark are both first-class. Light is the default and the system
preference is deliberately not consulted.

Ferris is CC0 from [rustacean.net](https://rustacean.net). The Rust logo in the
footer is used to refer to the language, per the Rust trademark policy; this
project is not affiliated with or endorsed by the Rust Foundation.

## Layout

```
build.py              content/ -> data/, and --validate compiles every exercise
content/
  units/NN-slug.md    the deep notes
  ex/NN-slug.md       exercises: @kind @expect, starter/tests/solution, hints, diagnose
  drills/NN-slug.md   multiple choice, `*` marks the correct option
  glossary.json       plain-English definitions, input to build.py
  gloss/<slug>.json   per-unit terms, so parallel authors never share a file
index.html            the shell
assets/app.css        design tokens and components
assets/app.js         hash router, views, search, glossary, progress
assets/workbench.js   Rust tokenizer, editor, playground client, diagnostics parser
assets/gate.js        the lock screen (off by default)
assets/companion.js   Ferris's two voices
data/                 generated
  manifest.json       the index; loads on every page view, so it stays small
  search.json         section titles and concepts — only search reads these
  unit/ ex/ drills/   one file per unit, fetched on demand
  glossary.json  audit.json
```

## Writing a unit

`docs/AUTHORING.md` is the contract — voice, structure, block syntax, the
exercise format and the definition of done. Read it before writing anything, and
read the three `05-ownership` files as the reference standard.

## The format, in brief

Three files, all markdown, all optional except the first:

`content/units/09-enums.md` — front matter (`num`, `slug`, `title`, `accent`,
`concepts`, `blurb`), then prose. `##` starts a part, `###` a sub-topic. Fences
`:::note`, `:::gotcha`, `:::compare` and `:::memory <title>` give you the
callouts; ` ```rust,bad ` marks code that is not supposed to compile.

`content/ex/09-enums.md` — `## N. Title`, then `@kind` / `@concept` / `@expect`,
prose, then fenced ` ```starter `, ` ```tests `, ` ```solution `, then `@hint`
lines, `@diagnose EXXXX` blocks and an `@after` block.

`content/drills/09-enums.md` — `## N`, the stem, `- A.` options with `*` marking
correct ones, then `@why`.

Then `python3 build.py --check content/ex/<slug>.md` and iterate until it says
`8 clean`. That writes nothing shared, so several authors can run it at once;
`--validate` does the whole book and is the one that writes `data/`.

## Not yet

The reference library — the Reference, the Nomicon, the Cargo, rustdoc and rustc
books, the ~500-code error index, the CLI book, the Embedded book and the
Unstable book — is phase two. The workbench already links out to the error index
for every code it shows, so that is the seam it will slot into.

Study notes. The official books remain the authority.
