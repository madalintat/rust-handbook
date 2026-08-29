# Authoring a unit

Read this completely, then read `content/units/05-ownership.md`,
`content/ex/05-ownership.md` and `content/drills/05-ownership.md` as the
reference. Match them. They are the standard, not a suggestion.

## The three files

```
content/units/<slug>.md    the note
content/ex/<slug>.md       the exercises
content/drills/<slug>.md   the drills
```

`<slug>` is exactly the slug in `build.py`'s `TRACK` list. Do not invent one.

## Voice — the part that matters most

**Every rule is attached to the reason it exists.** Never state a rule and move
on. Say what the compiler is protecting, what the memory looks like, which bug
the rule prevents, what a C++ or Python intuition gets wrong here.

**Short. Fewer words is better.** The reader complained the first draft was too
wordy and they were right. Target **1,400–2,000 words** for the note. Prefer:

- a code block over a paragraph describing code
- a table over three parallel sentences
- an ASCII memory diagram over a description of memory
- one sharp sentence over a careful three-sentence build-up

**Real examples, not `foo`/`bar`.** Use things a person would actually write: a
config struct, a line count, a user record, a retry loop.

**No cheerleading.** Never "Great!", "Let's dive in!", "As we can see". No
exclamation marks. Do not address the reader as "we". State things.

**British spelling** (behaviour, initialise, optimise), because the rest of the
book uses it.

## The note format

```markdown
---
num: 9
slug: 09-enums
title: Enums and pattern matching
accent: moss
concepts: enum, variant, match, exhaustiveness, Option
needs: 05-ownership, 08-structs
blurb: One sentence for the card. Concrete, not a category label.
---

%% The opening paragraph. Prefixed with %% to render as the lede. Two or three
sentences that say why this unit exists — the problem it solves, not the topic
it covers.

One more short paragraph, then straight into the first part.

## A part title

Optional intro prose.

### A sub-topic

Body.
```

- `##` starts a part. Aim for **5–7 parts**.
- `###` starts a sub-topic inside it. Aim for **2–4 per part**, each 1–4 minutes.
- The first part opens by default in the reader, so it must carry the argument.
- `accent` is one of: `rust ferris amber clay moss slate plum`. Use the one
  already assigned to your slug in `TRACK`.
- `concepts` become chips and feed search. Lowercase, comma-separated.

### Blocks available

````markdown
```rust
// a normal code block
```

```rust,bad
// code that does NOT compile. Renders with a red border and "will not compile".
```

```rust,good
// the fixed version. Green border.
```

:::note
The rule, stated once, cleanly. Use sparingly — one or two per unit.
:::

:::gotcha
The thing that will bite them. Use freely; these are the most valuable blocks.
:::

:::compare
What a C++ / Python / Java / Go reader's intuition gets wrong here.
:::

:::memory a short title
       STACK                       HEAP
     ┌──────────────┐            ┌───┬───┐
 s   │ ptr    ●─────┼───────────▶│ h │ i │
     └──────────────┘            └───┴───┘
:::
````

Use box-drawing characters `┌─┐│└┘├┤▶●✗` and keep columns aligned. These
diagrams are the single most effective thing in the book; include at least one
per unit where memory layout is relevant.

### Glossary terms

`**term**` renders as a hover-glossed term **if** the term exists in the
glossary, and as plain bold otherwise. Check `content/glossary.json` first.

If your unit needs a term that is missing, put it in **your own file** at
`content/gloss/<slug>.json` — never edit the shared `content/glossary.json`,
because other authors are working at the same time and a shared JSON file is the
one thing that cannot survive two writers. Same shape:

```json
{"terms": [
{"t": "monomorphisation", "x": "generic expansion", "p": "The compiler emitting one specialised copy of a generic function per concrete type used, which is why generic Rust costs nothing at runtime."}
]}
```

One plain sentence per term. No jargon inside the definition.

Other inline: `` `code` ``, *italic*, `[text](url)`, tables, `>` blockquotes,
`-` and `1.` lists.

## The exercise format

**8 exercises per unit.** This is the core of the product. Each must compile for
real, so every claim you make is checked.

````markdown
---
unit: 09-enums
---

## 1. A short, concrete title

@kind fix
@concept enum
@expect E0004

The brief. 30–60 words. Say what is broken and what "done" looks like. Do not
give away the fix.

```starter
pub fn run() -> &'static str {
    // code that does NOT compile
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn does_the_thing() {
        assert_eq!(run(), "expected");
    }
}
```

```solution
pub fn run() -> &'static str {
    "expected"
}
```

@hint A nudge that reframes the problem without naming the fix.
@hint Stronger — point at the mechanism.
@hint Nearly the answer, including the signature they need.

@diagnose E0004
What rustc is *actually* saying. Walk its underlines. 80–140 words. This is the
most valuable text in the whole platform — it is what the reader sees at the
moment they are stuck. Write every code the exercise can plausibly raise, not
just the expected one.

@diagnose E0308
Another likely error for this exercise.

@after
Shown once it passes. 60–110 words. The deeper point, or the idiom they should
carry forward, or what the standard library does here.
````

Fenced code is allowed inside `@diagnose` and `@after` blocks and stays where
you put it. Info strings may be anything — ```` ```rust ````, ```` ```text ````,
```` ```sh ```` — and only `rust,bad` / `rust,good` change the border. Nest with
four backticks when you need to show a fence.

### Rules for exercises

- `@kind` is `fix`, `fill`, `write` or `predict`.
- `@expect` is what the **starter** must fail with. Two forms:
  - `@expect E0382` — an error code. Preferred; use it whenever one exists.
  - `@expect "missing type for `const` item"` — a quoted fragment of the error
    message, for the real errors rustc emits with **no code at all** (a `const`
    with no type, a literal out of range, `struct literals are not allowed
    here`). Matched case-insensitively against stderr.

  Required except for `predict`, and for the rare exercise that fails as a
  *test failure* rather than a compile error (a mismatched
  `#[should_panic(expected = ...)]`, a stale doctest) — there the starter is
  still compiled and still required to fail, only the message check is skipped.
- `@concept` is one lowercase concept from the unit.
- The starter **must fail to compile** with exactly `@expect`'s code.
- The solution **must compile and pass every test**.
- There **must** be an `@diagnose` block for the expected code. Add blocks for
  other codes the reader will plausibly hit on the way.
- Tests go in a `#[cfg(test)] mod tests` block and are appended to the reader's
  buffer, so they must only call `pub` items. Never reference a private name.
- Prefer `pub fn run() -> ...` as the entry point the tests call, so the reader
  is free to change every other signature.
- Difficulty ramps across the eight. Number 1 is nearly free; number 8 should
  make a competent reader think.

### Validate — this is not optional

```sh
python3 build.py --check content/ex/09-enums.md
```

It compiles every starter and solution against `play.rust-lang.org` and tells
you exactly what is wrong. **Iterate until it prints `N clean`.** Do not hand
back a unit that has not been through this. It writes nothing shared, so it is
safe to run while other people are working.

Common failures and what they mean:

| message | fix |
|---|---|
| `starter compiles and passes; nothing to fix` | the starter is not actually broken |
| `starter raises E0507, exercise explains E0382` | change `@expect`, and write the `@diagnose` for the real code |
| `no @diagnose written for E0499` | add that block |
| `solution does not build: ...` | fix the solution |
| `solution builds but fails its own tests: t::x` | the tests and the solution disagree |

## The drills format

**15 per unit.** Fast, and each one teaches something the note did not quite say.

````markdown
---
unit: 09-enums
---

## 1

Does this compile?

```rust
let x = 5;
```

- A. Yes
- *B. No — and here is the specific reason
- C. A wrong answer that is genuinely tempting
- D. Another plausible one

@why
Why the right answer is right, **and why the tempting wrong one is tempting**.
50–110 words. Naming the trap is most of the value.
````

- `*` before the letter marks a correct option. Several `*` makes it
  multi-answer; phrase the stem as "Choose all that apply."
- 4–5 options. Every distractor must be plausible — no filler.
- Vary the shape: "does this compile", "what does it print", "which of these
  moves", "why can X not be Y", "what is the cost of".

## Definition of done

1. All three files exist and are valid.
2. `python3 build.py --check content/ex/<slug>.md` prints `8 clean`.
3. `python3 build.py` runs without error and reports your unit.
4. The note is 1,400–2,000 words with at least one `:::memory` or table where
   memory or cost is discussed.
5. Any new glossary terms are in `content/gloss/<slug>.json` and it parses.

Do not edit files outside `content/`. Do not edit another unit's files. Do not
run `build.py --validate` (it writes shared state); use `--check`.
