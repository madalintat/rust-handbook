# Rust Handbook Implementation Plan

**Goal:** A zero-dependency static Rust learning platform where every exercise
compiles for real on play.rust-lang.org and every diagnostic comes with a
plain-language reading of what the compiler actually saw.

**Architecture:** `content/*.md` (authored) → `build.py` → `data/*.json` →
a hash-routed static site. Nothing computed in the browser that could be
computed once in Python.

**Tech Stack:** Python 3 stdlib only, vanilla JS, no npm, no CDN, no framework.
The compiler is `https://play.rust-lang.org/execute`.

**Spec:** `docs/superpowers/specs/2026-08-29-rust-handbook-design.md`

## Global Constraints

- Zero JavaScript libraries. No CodeMirror, no Monaco, no CDN scripts.
- Python 3 stdlib only in `build.py` (`urllib`, `json`, `re`, `hashlib`, `pathlib`).
- `data/` is generated. Never hand-edited.
- Edition `2024`, channel `stable`, `mode: debug` for all playground calls.
- Light theme is the default; the system preference is not consulted.
- Ground `#EFEBE4` / `#1C1917`. Button trio `#F7681F` / `#A8380F` / `#C04A12`.
- Every exercise must pass `build.py --validate` before it ships.

---

### Task 1 — Shell and design tokens

**Files:** Create `index.html`, `assets/app.css`

**Produces:** the token layer every later task reads — `--bg --surface --raised
--border --ink --ink-2 --ink-3 --ink-4 --accent --btn-bg --btn-border
--btn-shadow`, the type scale `--t-micro … --t-h1`, and the component classes
`.btn .chip .card .prose .sect .topbar .tabbar .sheet`.

- [ ] Shell with topbar, `<main id="app">`, mobile tabbar, contents sheet, footer
- [ ] Pre-paint theme resolution inline in `<head>` (no wrong-ground flash)
- [ ] Tokens, both themes, plus the seven unit accents
- [ ] Workbench components: `.wb`, `.editor`, `.gutter`, `.diag`, `.testrow`
- [ ] Check: open in a browser, toggle theme, no flash, no horizontal scroll

### Task 2 — `assets/workbench.js`

**Files:** Create `assets/workbench.js`

**Interfaces produced:**
- `hlRust(src) -> html` — the tokenizer, also used by `app.js` for prose blocks
- `runPlayground(code, {tests}) -> {success, stdout, stderr}`
- `parseDiagnostics(stderr, offset) -> {errors:[{code,msg,line,col}], warnings, tests:[{name,ok,panic}]}`
- `mountEditor(el, starter) -> {value(), set(v), reset()}`

- [ ] Tokenizer: keywords, lifetimes, macros, strings + escapes, chars, numbers
      with suffixes/separators, attributes, line and block comments, types
- [ ] Editor: textarea over a synced `<pre>` overlay, gutter, Tab/Shift-Tab,
      Cmd-Enter to run
- [ ] Playground client: debounced, disables Run while in flight, names the
      network as the failure when offline
- [ ] Diagnostics parser: `error[EXXXX]`, `--> src/main.rs:L:C`, warnings,
      `test x ... ok|FAILED` with panic bodies. Line numbers adjusted by the
      offset of appended hidden tests.
- [ ] Check: paste the E0382 sample from the spec, confirm code+line+col parse

### Task 3 — `build.py`

**Files:** Create `build.py`

**Produces:** `data/manifest.json`, `data/unit/*.json`, `data/ex/*.json`,
`data/drills/*.json`, `data/glossary.json`, `data/audit.json`

- [ ] Markdown renderer: headings with stable slug ids, paragraphs, lists,
      tables, blockquotes, fenced code with a language tag, inline code, bold
      (glossary-linked), italic, links
- [ ] Custom fences the notes need: `:::note`, `:::gotcha`, `:::memory` (an
      ASCII stack/heap diagram), `:::compare` (Rust vs C++/Python intuition)
- [ ] Part/sub splitting at `##` / `###`, per-section words and minutes
- [ ] Exercise parser: `## N. Title` + `@kind @concept @expect` + fenced
      `starter` / `tests` / `solution` / `hints` / `diagnose EXXXX` / `after`
- [ ] Drill parser: stem, options with `*` marking correct, `why`
- [ ] `--validate`: compile starter (must fail with `expect.code`) and solution
      (must pass), hash-cached in `data/.validate-cache.json`
- [ ] Check: `python3 build.py && python3 -c "import json;json.load(open('data/manifest.json'))"`

### Task 4 — `assets/app.js`

**Files:** Create `assets/app.js`

**Consumes:** `hlRust`, `runPlayground`, `parseDiagnostics`, `mountEditor`

- [ ] Hash router, view functions returning HTML strings, `Map`-cached fetch
- [ ] Views: home, track, unit reader (ported from the medicine `viewRead`),
      workbench, drills, glossary, progress, search, 404
- [ ] Workbench view: brief, editor, Run/Hint/Reset/Solution, diagnostics panel
      with our `diagnose` entry beside rustc's raw output in a `<details>`
- [ ] Progress in `localStorage` under `rl-progress`, plus the day streak
- [ ] Glossary hover popovers, reading toggles, mobile sheet
- [ ] Check: every route renders; a failed run shows our explanation

### Task 5 — `assets/gate.js`, `assets/companion.js`

- [ ] Port the gate, re-themed, new salt
- [ ] Ferris's two voices: fires on a pass, a long session, a return

### Task 6 — Content: `05` Ownership

**Files:** `content/units/05-ownership.md`, `content/ex/05-ownership.md`,
`content/drills/05-ownership.md`

- [ ] Note, 3,000–5,000 words, mechanism not rules, with memory diagrams
- [ ] 8 exercises across `fix` / `fill` / `write` / `predict`
- [ ] 15 drills
- [ ] `python3 build.py --validate` green

### Task 7 — Content: `06` Borrowing
### Task 8 — Content: `15` Lifetimes

Same shape as Task 6.

### Task 9 — Deploy

- [ ] `vercel.json` with `cleanUrls` and asset cache headers
- [ ] `README.md`
- [ ] Remaining 22 units present in the manifest as stubs, labelled as such

---

## Phase 1b / Phase 2

The other 22 units, then the reference library (Reference, Nomicon, Cargo,
rustdoc, rustc, error index, CLI, Embedded, Unstable). Both are out of scope for
this plan and get their own.
