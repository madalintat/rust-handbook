# Build your own handbook

This file is the reproduction guide. It describes what the Rust Handbook is
made of, precisely enough that you can build the same platform for a different
subject, with a different mascot and a different palette, and have it feel like
the same piece of work.

Source: <https://github.com/madalintat/rust-handbook>

Nothing here is Rust specific except the content and the compiler. The shape
holds for any subject where a reader has to practise something and be told,
concretely, why the thing they just did was wrong.

## What it actually is

A static site. Four files of JavaScript, one stylesheet, one HTML page, and a
directory of JSON. No framework, no npm, no bundler, no CDN, no build step in
the browser sense. `build.py` turns authored markdown into JSON once, and the
browser routes and paints.

```
content/         markdown you write
  units/         the notes, one per unit
  ex/            the exercises, one file per unit
  drills/        the quiz questions, one file per unit
  projects/      multi stage builds
  gloss/         glossary terms
build.py         markdown to JSON, plus the validator
data/            generated JSON, committed on purpose
index.html       the shell: header, main, tab bar, sheet, footer
assets/app.css   every token and every rule
assets/app.js    routing, views, progress, search
assets/workbench.js   the editor, the compiler client, the diagnostics parser
assets/vim.js    the editor's Vim mode
assets/companion.js   the mascot's occasional line
llms.txt         this whole project, described for an assistant
```

`data/` is committed. That is deliberate: the site is servable from any static
host with no build, and CI fails if `data/` disagrees with `content/`.

## The design system

Copy the structure. Change the temperature.

### Colour

Two ramps, light and dark, defined as custom properties on `:root` and
`:root[data-theme="dark"]`. Nothing in the stylesheet uses a literal colour
outside those two blocks.

The light ground is `#efebe4`, a warm tan. The dark ground is `#1c1917`. Both
neutrals are rotated warm on purpose: the palette started from a green grey
tan, and next to an orange accent a green grey ground goes muddy. If your
accent is cool, rotate the neutrals cool instead. That is the one decision that
makes a palette swap look designed rather than recoloured.

| Role | Light | Dark |
| --- | --- | --- |
| `--bg` page ground | `#efebe4` | `#1c1917` |
| `--surface` cards | `#fdfbf6` | `#26211e` |
| `--raised` hover | `#e6e1d8` | `#2e2825` |
| `--border` | `#c3bcaf` | `#403833` |
| `--border-soft` | `#d8d2c6` | `#342d29` |
| `--ink` primary text | `#211d1a` | `#faf9f7` |
| `--ink-2` secondary | `#4d4640` | `#b8afa6` |
| `--ink-3` tertiary | `#746c64` | `#928980` |
| `--ink-4` faint | `#9d958b` | `#6b635c` |
| `--code-bg` | `#f6f1e8` | `#1f1b19` |

Four inks, not two. Most of the interface is `--ink-2` and `--ink-3`; full
`--ink` is reserved for headings and the thing you are reading. That single
restraint does more for the look than any other rule here.

The accent is one variable, `--accent`, and it is set per unit on a container:

```css
[data-accent="moss"] { --accent: var(--moss); }
```

Every descendant reads it. Seven accents exist so consecutive units do not look
identical, and they are all desaturated enough to sit on tan without vibrating.
Pick your own seven the same way: one brand colour, one warm, one earth, one
green, one blue, one purple, plus the semantic three (`--ok`, `--warn`,
`--bad`).

The primary button is a solid fill on a hard offset shadow, and it moves down
onto that shadow when pressed:

```css
.btn:active { transform: translateY(var(--drop)); box-shadow: 0 0 0 0 var(--btn-shadow); }
```

`--drop` is 2px. It is the only piece of skeuomorphism in the whole design and
it is worth keeping.

### Type

One sans for the interface, one mono for code, both from Google Fonts with a
real system fallback stack behind them. Inter and JetBrains Mono here; any
pairing of a neutral grotesque and a readable mono works.

Nine sizes, all fluid, so the same tokens hold from a 320px phone to a wide
display without a single font size inside a media query:

```css
--t-micro: clamp(10.5px, 0.1vw + 10.2px, 11.5px);
--t-tiny:  clamp(12px,   0.12vw + 11.6px, 13px);
--t-sm:    clamp(13.5px, 0.14vw + 13.1px, 14.5px);
--t-body:  clamp(15px,   0.2vw + 14.4px, 16.5px);
--t-read:  clamp(16px,   0.34vw + 15px, 18.5px);
--t-lede:  clamp(17.5px, 0.5vw + 16.3px, 21px);
--t-h3:    clamp(19px,   0.6vw + 17.6px, 24px);
--t-h2:    clamp(24px,   1.4vw + 20.5px, 36px);
--t-h1:    clamp(32px,   3.4vw + 21px, 60px);
```

Headings are 800 weight with negative tracking that grows with size, down to
`-0.035em` on the largest. Prose is `--t-read` at 1.75 line height inside a
`72ch` measure. The measure is a token, `--measure`, because it is a reading
decision and not a layout one.

### Geometry and motion

Four radii (`4px`, `6px`, `8px`, `16px`), one drop distance, one rail width.
Three durations, and every transition names its properties rather than using
`all`. The whole thing is disabled under `prefers-reduced-motion`, in one rule.

Animation is used in exactly three places: entrance staggers on card grids, a
tick when a contents dot fills, and a stamp when an exercise passes. Anything
more and the page starts to feel like a demo.

### Responsive rules that are not obvious

- `html, body { overflow-x: clip }`, never `hidden`. `hidden` makes body a
  scroll container and every `position: sticky` descendant then sticks to body
  instead of the viewport, which means it never sticks at all.
- Anything that genuinely overflows (tables, code blocks, memory diagrams, the
  editor) carries its own `overflow-x: auto`. The page never scrolls sideways.
- A media query adds no specificity. A rule inside `@media (max-width: X)` must
  sit after every rule it overrides, or it silently loses on source order.
- The editor is 16px on a phone and not one pixel less. iOS Safari zooms the
  viewport on focus for anything smaller and does not zoom back.
- Below 1060px the contents rail is gone and the contents live in a bottom
  sheet. Below 900px the top navigation becomes a fixed tab bar, because a
  navigation row at the top of a phone is a row nobody can reach.

## The functional inventory

Routes are hash based, so the whole thing is servable from a bucket:

| Route | What it is |
| --- | --- |
| `#/` | the home page: hero, the track, the projects |
| `#/track` | every unit as a card, in order |
| `#/unit/<slug>` | the note, with a contents rail and per part progress |
| `#/unit/<slug>/<heading>` | the same, scrolled to a heading |
| `#/work/<slug>/<n>` | the workbench: one exercise, editor, real compiler |
| `#/drills/<slug>` | the quiz for a unit |
| `#/projects` | project cards, filterable by domain |
| `#/project/<slug>` | one project, its stages |
| `#/progress` | what you have read, passed and needed a hint for |
| `#/glossary` | every term, by letter |
| `#/errors` | the compiler errors the book explains |
| `#/search?q=` | full text over notes, exercises and terms |

The pieces worth copying:

- **The contents rail.** Sticky, with a spine that fills as you read and a dot
  per section that fills once you pass it. It collapses to the spine alone,
  not to nothing, so you keep the map and lose only the words.
- **The workbench.** A `textarea` with transparent text laid exactly over a
  highlighted `<pre>`. The caret is the textarea's; the colour is the pre's.
  Both must share every metric that affects layout or the two drift apart.
  There is a soft wrap toggle, and a Vim mode.
- **Hints, and no solutions.** A hint is a sentence that makes you see the
  error. Handing over the answer at the same size, in the same row, is not a
  second kind of help; it is a way of skipping. Solutions exist in the content
  and the build compiles every one of them. They are not offered to the reader.
- **The diagnostics reading.** Every exercise carries a `diagnose` map from
  compiler error code to prose. When the compiler rejects your code you get its
  real output and, beside it, a written reading of that specific error. This is
  the single most valuable thing in the platform and it is the part most worth
  reproducing for another subject.
- **Progress in `localStorage`.** No account, no backend, no cookie banner.
- **The mascot.** Appears rarely, says one line, and is never in the way.

## The content pipeline

Three files per unit, all markdown with YAML front matter:

```
content/units/<slug>.md    the note
content/ex/<slug>.md       the exercises
content/drills/<slug>.md   the drills
```

`build.py` reads them, enforces the format, and writes `data/`. It refuses a
note outside 1,400 to 2,200 words. `docs/AUTHORING.md` is the full contract.

The exercise format is the interesting part. Each exercise carries a starter
that is expected to fail, the error code it must fail with, the hidden tests,
the solution, the hints, and the prose for the diagnostic:

```
@expect E0382
@hint One line that makes them look at the right place.
@diagnose E0382 What the compiler saw, in plain language.
```

`build.py --validate` compiles every starter and every solution against the
real compiler and fails the build if a starter stops raising the code its
explanation describes. That is what stops the content rotting when the compiler
changes its diagnostics. Without this the whole idea decays quietly.

## Building one for another subject

The order matters. Each step leaves something you can look at.

1. **Pick the subject and the spine.** You need a sequence where each item
   depends on the ones before it, and a thing the learner can run and get told
   off by. A compiler, a type checker, a linter, a test runner, a solver, a
   query planner, a physics engine: anything that produces a specific, machine
   generated complaint. Without that, build a quiz site instead; this shape is
   wasted on it.
2. **Choose the execution backend before anything else.** Rust gets
   `play.rust-lang.org`, a free public service that compiles and runs a snippet
   and returns stdout, stderr and the compiler's JSON diagnostics. Find the
   equivalent for your subject, or run one. If nothing can execute the
   learner's work and answer specifically, stop and reconsider step one.
3. **Fork the shell.** Take `index.html`, `assets/app.css` and `assets/app.js`.
   Delete the views you do not need. Do not start by restyling.
4. **Swap the palette.** Edit only the two `:root` blocks and the accent list.
   Rotate the neutrals toward your accent's temperature. Keep the four inks and
   keep the button's hard shadow. Check both themes before moving on.
5. **Swap the mascot.** One image, used in the header, the footer and the
   companion. Ferris is the Rust community's crab and is public domain. Yours
   should be a single flat figure that reads at 26px.
6. **Rewrite the manifest.** `build.py` holds a `TRACK` list of slugs, titles,
   accents and blurbs. That list is the table of contents. Write yours before
   writing a single unit.
7. **Write one unit completely.** Note, exercises and drills, all three files,
   until `build.py --check` prints clean. One finished unit teaches you more
   about the format than reading the authoring guide twice.
8. **Wire the execution backend.** `assets/workbench.js` is the whole
   integration: a client, a tokenizer for the highlighter, and a parser that
   turns the tool's diagnostics into the structure the UI renders. The parser
   is the part you will rewrite.
9. **Then the rest of the content.** By now the platform is finished and the
   work is writing, which is where the time actually goes.

## What to keep

The parts that make it work, rather than the parts that make it look a certain
way:

- Four inks, and the discipline about which one you are allowed to use.
- Fluid type tokens, so no font size ever appears inside a media query.
- One accent variable, set per section on a container.
- No framework. It is a static site and it stays under a megabyte.
- Generated data committed to the repository, with CI failing if it is stale.
- Content validated against the real tool, so it cannot rot silently.
- Hints, and no answers.
- Progress in `localStorage`, and therefore no account.

## What to change

Everything else. The subject, the mascot, the palette temperature, the number
of units, the accents, the voice. The design survives all of it.
