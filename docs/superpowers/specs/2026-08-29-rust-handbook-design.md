# Rust Handbook — design

A learning platform for Rust: the depth of the official books, the practice loop
of rustlings, and a real compiler in the page. Static site, no framework, no
build step at deploy time — `build.py` turns authored markdown into JSON once,
and the browser fetches one unit at a time.

Modelled on `/Users/madalintat/study_medicine`, which already proves the shape.

## Why it exists

Rustlings tells you a hint. The Book tells you a rule. Neither tells you what the
borrow checker actually saw. This does: every exercise ships with a plain-language
reading of the specific diagnostic you are about to hit, shown next to rustc's own
output when you hit it.

The other half is coverage. Eleven official books hold the material, and nobody
reads eleven books. The track is one path through them, ordered so that each unit
only needs what came before it.

## Architecture

```
content/            authored markdown (the source of truth)
  units/NN-slug.md    deep notes
  ex/NN-slug.md       exercises
  drills/NN-slug.md   multiple-choice drills
  glossary.json       plain-English definitions
build.py            content/ -> data/, and --validate compiles every exercise
data/               generated; never edited by hand
  manifest.json       the index: track -> units, with metadata
  unit/<slug>.json    one unit's note, pre-rendered HTML
  ex/<slug>.json      one unit's exercises
  drills/<slug>.json  one unit's drills
  glossary.json
  audit.json          validation results, surfaced in the UI
index.html          the shell
assets/
  app.css           design tokens and components
  app.js            hash router, views, search, glossary, progress
  workbench.js      Rust tokenizer, editor, playground client, diagnostics
  gate.js           the lock screen
  companion.js      Ferris's two voices
  ferris.png        mascot (CC0, rustacean.net)
  rust-logo.svg     brand mark (rust-lang.org)
vercel.json
```

Everything computable at build time is computed at build time: word counts,
reading minutes, section ids, the table of contents, glossary back-references,
exercise validation. The browser routes and paints.

## Design tokens

The medicine app's ground is PostHog's tan `#EEEFE9`, which is faintly green and
fights orange. The ground here shifts warm and the button trio becomes rust.

| | light | dark |
|---|---|---|
| `--bg` | `#EFEBE4` | `#1C1917` |
| `--surface` | `#FDFBF6` | `#26211E` |
| `--raised` | `#E6E1D8` | `#2E2825` |
| `--border` | `#C3BCAF` | `#403833` |
| `--ink` | `#211D1A` | `#FAF9F7` |

Button, both themes: fill `#F7681F`, border `#A8380F`, shadow `#C04A12`. It sits
on its hard shadow and moves down onto it when pressed, as in the medicine app.

Brand: `--rust: #CE422B`, `--ferris: #F74C00`.

Per-unit accents so ownership and concurrency do not look alike: rust, ferris,
amber `#E0921A`, clay `#B4552D`, moss `#5C7A47`, slate `#43607A`, plum `#7B4B72`.

Light and dark are both first-class. Light is the default; the system preference
is not consulted, matching the medicine app.

## The unit

A unit is the medicine app's chapter shape — `parts[] -> subs[]` of pre-rendered
HTML, per-section reading minutes, collapsible sections, a sticky rail — with two
more surfaces hanging off it.

```
#/unit/05-ownership     the note      3,000-5,000 words
#/work/05-ownership     the workbench 6-10 exercises, real rustc
#/drills/05-ownership   the drills    12-20 multiple-choice
```

The note is written to the medicine app's standard: every rule attached to the
reason it is true. Not "a value has one owner" but what the stack frame holds,
what `drop` does at scope end, which bug the rule prevents, what the move copies
(the three-word `String` header, not the heap bytes), and where a C++ or Python
intuition misfires.

### unit JSON

```json
{
  "slug": "05-ownership", "num": 5, "title": "Ownership",
  "mins": 24, "words": 4820,
  "concepts": ["move", "drop", "Copy", "ownership"],
  "needs": ["01-bindings", "03-expressions"],
  "toc": [{ "id": "...", "text": "...", "level": 2 }],
  "lead": "<h1>…</h1><p>…</p>",
  "parts": [{ "id": "...", "title": "...", "html": "...", "intro": "...",
              "subs": [{ "id": "...", "text": "...", "html": "...",
                         "words": 0, "mins": 0 }],
              "words": 0, "mins": 0 }]
}
```

Identical to the medicine chapter shape apart from `concepts` and `needs`, so
`viewRead` ports across with the names changed.

## The exercise

The core object. One per exercise, in `data/ex/<slug>.json`.

```json
{
  "n": 4,
  "slug": "move-into-function",
  "title": "The function ate your string",
  "kind": "fix",
  "concept": "move",
  "mins": 4,
  "brief": "<p>What you are being asked, and why it matters.</p>",
  "starter": "fn main() { … }",
  "tests": "#[test] fn moved_value_is_gone() { … }",
  "solution": "fn main() { … }",
  "hints": ["a nudge", "stronger", "nearly the answer"],
  "expect": { "code": "E0382" },
  "diagnose": {
    "E0382": "<p>rustc is not complaining about the print…</p>",
    "E0502": "<p>…</p>"
  },
  "after": "<p>The deeper why, unlocked once it passes.</p>"
}
```

`kind` is one of:

- `fix` — code that does not compile; make it compile and pass the tests
- `fill` — a `todo!()` or `unimplemented!()` to replace
- `write` — a signature and its tests, empty body
- `predict` — read code, choose what it prints or which error it raises, then run
  it and find out (no editing)

`diagnose` is the differentiator. When a run fails, `workbench.js` parses
`error[EXXXX]` out of stderr and renders our entry for that code next to rustc's
own output. Codes not in the map fall back to rustc's text alone plus a link to
the error index. The map is per-exercise, not global, because "what E0382 means"
is not useful — "what E0382 means *here*" is.

`hints` reveal one at a time, and revealing one is recorded, so the progress page
can show which exercises needed help.

## The compiler

`https://play.rust-lang.org/execute`, the same endpoint the official Book's Run
buttons use. Verified 2026-08-29: `access-control-allow-origin: *`, POST allowed,
full annotated diagnostics with error codes in `stderr`, and `tests: true` gives
per-test pass/fail.

```
POST https://play.rust-lang.org/execute
{ "channel": "stable", "mode": "debug", "edition": "2024",
  "crateType": "bin", "tests": false, "backtrace": false, "code": "…" }
-> { "success": bool, "stdout": string, "stderr": string }
```

488 crates are whitelisted, so error-handling and CLI units can use `anyhow`,
`thiserror`, `serde` and `clap` rather than toys.

Run assembles `starter-buffer + "\n\n" + tests` when the exercise has tests, sets
`crateType: "lib"` and `tests: true`, and otherwise runs as a `bin`. Requests are
debounced, Run is disabled while one is in flight, and a network failure says the
compiler needs the network rather than failing silently.

### Diagnostics rendering

Parse from `stderr`:

- `error[E0382]: borrow of moved value: \`s\`` -> code, message
- `--> src/main.rs:5:16` -> line, column, adjusted for the tests we appended
- `warning: …` -> collected separately, shown folded
- test output -> `test t::name ... ok|FAILED`, and the panic message per failure

Render: the error message as a card in the accent, the offending line echoed from
the editor with a caret under the column, our `diagnose` entry beneath it, and a
chip linking to `#/errors/E0382`. rustc's raw output stays available in a
`<details>`, because learning to read it is part of the point.

Until the error index ships in phase 2, the chip links out to
`https://doc.rust-lang.org/error_codes/E0382.html`; in phase 2 it retargets to
`#/errors/E0382` with no other change.

## The editor

A `<textarea>` over a `<pre>` overlay, scrolled in sync, with a line-number
gutter. Tab inserts four spaces, Shift-Tab dedents, Cmd/Ctrl-Enter runs.

Highlighting is a hand-written Rust tokenizer of roughly sixty lines: keywords,
lifetimes, macros, strings with escapes, char literals, numeric literals with
suffixes and separators, attributes, line and block comments, type-position
identifiers. The same function highlights the code blocks in the prose, so there
is one tokenizer and two callers. No CodeMirror, no Monaco, no CDN — the medicine
app ships zero JavaScript libraries and that stays true.

## Vim mode

`assets/vim.js`. A hand-written Vim layer over the same textarea, because the
zero-dependency rule rules out `@codemirror/vim` and that package would require
replacing the editor wholesale.

The motion and operator logic is pure — `(text, index) -> index` — so it is
tested without a DOM. Only `attach` touches the textarea. Normal mode keeps its
own cursor index and renders it as a one-character selection, which is what
gives it a block cursor; the accent colour distinguishes it from a visual
selection, and the two mean very different things about what the next key does.

Scope is the subset used while fixing a twenty-line exercise: motions,
operators with counts, visual mode, registers, undo, and `:w` to run. Named
registers, macros, marks and `.` repeat are out, and `Vim.UNSUPPORTED` names
them so the UI never pretends otherwise.

The preference is `localStorage['rh-vim']`, read when the editor mounts, so it
persists across exercises and sessions. Every access is wrapped: a browser that
refuses storage means the preference does not stick, not that the editor breaks.

## Validation

`python3 build.py --validate` sends every exercise's `starter` and `solution` to
the playground and asserts:

- the starter **fails**, and its first error code equals `expect.code`
- the solution **succeeds**, and every hidden test passes

Failures are written to `data/audit.json` and surfaced in the UI the way the
medicine app surfaces its coverage check: a unit whose exercises do not all
validate says so on its own card.

This is the test suite. It is a real one — it catches an exercise whose claimed
error code drifted when the compiler changed its diagnostics, and it catches a
solution that stopped compiling. Results are cached by content hash in
`data/.validate-cache.json` so a rebuild only re-sends what changed, and the
playground is not hammered.

## Progress

`localStorage`, key `rl-progress`:

```json
{ "05-ownership/04": { "passed": true, "tries": 3, "hints": 1, "at": 1756…},
  "_streak": { "last": "2026-08-29", "days": 7, "best": 12 } }
```

Shown on the home page, on each unit card as a ring, and on `#/progress` as a
grid of every exercise in the track. Nothing leaves the browser.

## Routes

```
#/                      home: where you are, what is next, the streak
#/track                 all units, with progress
#/unit/<slug>           the note
#/work/<slug>           the workbench, all exercises for a unit
#/work/<slug>/<n>       one exercise, deep-linkable
#/drills/<slug>         the drills
#/glossary              terms, indexed by letter
#/progress              every exercise, passed or not
#/search?q=             titles, ledes, headings, concepts, exercise titles
#/errors/<code>         one error code                        (phase 2)
#/library               the reference books                   (phase 2)
```

## Carried over from the medicine app

- **Password gate** (`gate.js`) — salted SHA-256 in the browser, a styled front
  door in front of Vercel Deployment Protection. Same caveat: a front door, not a
  vault.
- **Companion voices** (`companion.js`) — retuned for Ferris. Fires on a passed
  exercise, a long session, a return after a break.
- **Glossary with hover popovers** — around 400 Rust terms. Bolded terms in the
  prose carry their gloss in a data attribute; hover shows it, and each term has
  its own entry listing the units that use it.
- **Progress and streaks** — new; the medicine app has none.

## Scope

**Phase 1** — the shell, the compiler, the workbench, and three units finished to
final quality: `05` Ownership, `06` Borrowing, `15` Lifetimes. The three hardest,
chosen so the shape is stress-tested where it is most likely to break. The
remaining 22 units exist in the manifest as stubs and say so.

**Phase 1b** — the other 22 units, generated against the locked template:

`00` toolchain · `01` bindings and mutability · `02` types and overflow ·
`03` expressions · `04` control flow · `07` slices · `08` structs ·
`09` enums and matching · `10` Option · `11` collections · `12` error handling ·
`13` generics and monomorphization · `14` traits · `16` closures ·
`17` iterators · `18` smart pointers · `19` modules and workspaces ·
`20` testing and rustdoc · `21` concurrency · `22` async · `23` unsafe ·
`24` macros

**Phase 2** — the reference library: the Reference, the Nomicon, the Cargo,
rustdoc and rustc books, the error index (around 500 codes, deep-linked from
every diagnostic the workbench shows), the CLI book, the Embedded book, and the
Unstable book. Read-only chapters in the existing reader, plus the error index as
its own indexed surface.

## Non-goals

- No account system. Progress is local, and that is the whole feature.
- No server of our own. The playground is the compiler.
- No JavaScript dependencies, no CDN, no npm.
- Not a replacement for the official books. It is a path through them that ends
  in you having typed the code.
