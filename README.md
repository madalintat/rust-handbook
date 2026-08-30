<div align="center">

<img src="assets/ferris.png" alt="" width="120">

# Rust Handbook

**Learn Rust by fighting the compiler.**

Every exercise compiles for real on [play.rust-lang.org](https://play.rust-lang.org).
When rustc rejects your code you get its actual diagnostic and, beside it, a
written reading of that specific error.

[![CI](https://github.com/madalintat/rust-handbook/actions/workflows/ci.yml/badge.svg)](https://github.com/madalintat/rust-handbook/actions/workflows/ci.yml)
![rustc 1.98.0](https://img.shields.io/badge/rustc-1.98.0-CE422B)
![edition 2024](https://img.shields.io/badge/edition-2024-CE422B)
![dependencies none](https://img.shields.io/badge/dependencies-none-3f8f4f)

</div>

---

Rustlings gives you a hint. The Book gives you a rule. Neither tells you what the
borrow checker actually saw.

Each exercise carries a map from error code to prose. Your run fails, the
workbench pulls `error[E0382]` out of stderr, and you get the explanation for
*that* error rather than for the topic you happen to be on.

## What is in it

| | |
|---|---|
| **28 units** | One ordered path through the twelve official books. Each has a note, 8 compiled exercises and 15 drills. |
| **13 projects** | One real program each, built in stages that accumulate. A BPE tokenizer, an autodiff engine, a regex engine, a memory allocator. |
| **316 compiled items** | Every exercise and stage verified against real rustc, with hidden tests. |
| **420 drills** | Does this compile, and if not which error. Each with a worked answer. |
| **218 glossed terms** | Hover any bolded term. |

Three units cover ground no single book does: **reading rustc diagnostics**,
**shipping a real CLI**, and **`no_std`**.

## Run it

```sh
python3 build.py            # content/ -> data/
python3 -m http.server 8901
```

Python 3 and a browser. No npm, no CDN, no framework, no dependencies at all.

## The content has a test suite

```sh
python3 build.py --validate
```

Sends every starter and solution to the playground and asserts the starter
**fails with the error its explanation describes**, and that the solution
compiles and passes its hidden tests.

rustc changes its diagnostics between releases. An exercise promising `E0382`
that quietly starts emitting `E0505` is now a build failure rather than a
confused reader.

```sh
./release.sh --check --net
```

## Vim mode

The `vim` button in the workbench. Motions, operators with counts, text objects
(`ciw`, `di"`, `ca{`), visual mode, registers, undo, `gc`, `gs`, `/` with
smartcase, `jk` to leave insert, relative line numbers, and `:w` to run.
Hand-written, because the no-dependency rule is not negotiable.

## Layout

```
content/     authored markdown, the source of truth
build.py     content -> data, and the validator
assets/      app.js, workbench.js, vim.js, app.css
data/        generated, committed so the site needs no build step
llms.txt     the whole project, for an assistant
```

Writing a unit or a project: **[docs/AUTHORING.md](docs/AUTHORING.md)**.
Which book each unit draws on: **[docs/SOURCES.md](docs/SOURCES.md)**.

## Releasing

```sh
./release.sh 1.2.0
git push origin main --follow-tags
```

Builds, tests, compiles every exercise, writes the changelog, tags. The tag
triggers the release workflow, so nothing ships that has not already passed here.

## Build your own

The design here is not specific to Rust. It is a shape: a note, exercises that
a real tool judges, and a reading of the exact complaint that tool made. It
works for any subject where something can execute the learner's work and answer
specifically.

**[docs/BUILD-YOUR-OWN.md](docs/BUILD-YOUR-OWN.md)** is the reproduction guide:
the two colour ramps, the fluid type scale, the layout rules that are not
obvious, the whole functional inventory, the content pipeline, and the order to
build in. Swap the subject, the mascot and the palette; keep the four inks, the
fluid tokens, the validated content, and the hints without answers.

The fastest way in is the **for LLMs** button in the site header. It copies
[llms.txt](llms.txt), which carries that guide in full plus an opening that
makes an assistant ask which of three things you actually want: build one of
your own, work on this one, or learn Rust with it. Paste it into an assistant
and answer the question it asks.

## Contributing

Fork it, branch, run the checks, open a pull request. Every change lands on
`main` through review, and CI has to be green first.

Corrections to the content are the most useful contributions: if an explanation
of a diagnostic is wrong, open an issue with the code you ran and what rustc
actually said. The compiler settles most arguments.

**[CONTRIBUTING.md](CONTRIBUTING.md)** has the detail.

**[docs/AUTHORING.md](docs/AUTHORING.md)** is the contract for writing a unit or
a project.

## Licence

MIT. Ferris is CC0 from [rustacean.net](https://rustacean.net). The Rust logo is
used to refer to the language under the Rust trademark policy; this project is
not affiliated with the Rust Foundation.
