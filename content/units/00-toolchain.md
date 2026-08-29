---
num: 0
slug: 00-toolchain
title: The toolchain
accent: slate
concepts: rustc, cargo, crate, edition, profile, semver, cargo check, clippy
blurb: What rustc, cargo and an edition actually are, and what `cargo run` does to your file between you pressing enter and the program starting.
---

%% Rust has a reputation for a slow, opinionated compiler and a strange set of nouns — crates, editions, channels, profiles. All of that is true and all of it is explainable. Half the frustration people report in their first month is not the language at all; it is not knowing which tool is complaining at them.

Twenty minutes here buys you the rest of the book. Every error message you will ever read comes out of one of the three programs below.

## The three programs

### rustc compiles a crate

`rustc` is the compiler. You will almost never run it directly, and it is worth
knowing exactly what it does anyway.

It takes **one crate** — one root `.rs` file plus everything reachable from it
via `mod` — and produces one output: a binary, or a `.rlib` for other crates to
link against. Not one file at a time, the way a C compiler works. The whole
crate goes in at once, which is why Rust needs no header files and no forward
declarations, and also why a one-character change recompiles the crate.

:::memory what rustc does to your source
  main.rs ──▶ ┌──────────┐   parse, expand macros, resolve names
              │ frontend │   type check, borrow check
              └────┬─────┘
                   ▼  MIR   ── optimise, insert drops
              ┌──────────┐
              │  LLVM    │   MIR → LLVM IR → machine code
              └────┬─────┘
                   ▼
              object files ──▶ linker ──▶ ./target/debug/myapp
:::

Two things in that diagram surprise people. **Borrow checking happens in the
frontend, before any code is generated** — which is why an ownership error
costs you nothing at runtime; the compiler stops before it emits anything.
And **rustc does not link**. It hands object files to your system linker, which
is why a missing C library produces a wall of text that looks nothing like a
Rust error: because it is not one.

### cargo drives rustc

`rustc` needs to be told every dependency's location, every flag, every
`--edition`. Nobody does that by hand. **cargo** is the program that works out
the invocation.

It resolves your dependency graph, downloads what is missing, compiles each
crate in order, passes rustc the right flags, and runs the result. It is also
the test runner, the doc generator, the package publisher and the plugin host.
When you read "the Rust build system", this is it.

### rustup manages the other two

`rustup` installs and switches between *toolchains* — a matched set of rustc,
cargo, and the standard library for a given release.

| channel | what it is | when to use it |
|---|---|---|
| `stable` | released every six weeks | everything you ship |
| `beta` | next stable, in soak | CI, to catch breakage early |
| `nightly` | built every night | unstable features, some tooling |

Unstable language features are gated behind `#![feature(...)]` and rustc
**refuses to compile that attribute on stable at all** — `error[E0554]`. That
refusal is the whole stability promise: code that builds on today's stable will
build on every future stable.

## What `cargo run` actually does

```
$ cargo run
   Compiling serde v1.0.219
   Compiling myapp v0.1.0 (/home/you/myapp)
    Finished `dev` profile [unoptimized + debuginfo] in 4.21s
     Running `target/debug/myapp`
```

Six steps hide behind that:

1. **Resolve.** Read `Cargo.toml`, pick concrete versions for every dependency and every dependency *of* a dependency, and write the answer to `Cargo.lock`.
2. **Fetch.** Download any crate not already in `~/.cargo/registry`.
3. **Build dependencies.** One `rustc` invocation per crate, in dependency order, in parallel where the graph allows. Results are cached in `target/`.
4. **Build your crate.** The only step that runs when you have changed nothing but your own code.
5. **Link.** Hand the object files to the system linker.
6. **Exec.** Run the binary, forwarding your arguments after `--`.

:::gotcha
Step 3 is why the *first* build of a project takes two minutes and the next one
takes two seconds. Dependencies are compiled once and cached. If you find
yourself waiting two minutes repeatedly, something is invalidating that cache —
usually a changed feature flag, a changed profile, or a `build.rs` that reruns.
:::

### Cargo.toml versus Cargo.lock

```toml
[package]
name = "myapp"
version = "0.1.0"
edition = "2024"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
```

`Cargo.toml` is **what you asked for**: a name, an edition, and version
*ranges*. `Cargo.lock` is **what you got**: the exact version of every crate in
the graph, transitively, with checksums. You write the first. Cargo writes the
second.

:::note
Commit `Cargo.lock` for a binary — you want the deploy to build the bytes you
tested. Historically libraries omitted it; committing it is now fine there too,
since a downstream consumer ignores your lock file and resolves its own.
:::

A `use` line is not a dependency declaration. Adding `use rand::Rng;` to a file
whose `Cargo.toml` never mentioned `rand` gets you `error[E0432]: unresolved
import`. The import says where a name lives; the manifest says which crates
exist.

### The target directory

Everything derived lives in `target/`: object files, incremental-compilation
state, dependency fingerprints, final binaries. It is disposable and it is
enormous — a gigabyte for a mid-sized project is normal. It belongs in
`.gitignore`, and `cargo clean` deletes it when you want the disk back rather
than because something is broken.

## Debug and release

One flag, two completely different programs.

| | `cargo build` | `cargo build --release` |
|---|---|---|
| optimisation level | 0 | 3 |
| debug symbols | full | none by default |
| integer overflow | panics | wraps |
| `debug_assert!` | runs | compiled out |
| runtime speed | 1× | often 10–100× |
| compile time | fast | slow |
| output | `target/debug/` | `target/release/` |

The speed gap is larger than in C, and the reason is structural. Rust's zero-cost
abstractions — iterators, `Option`, generics, smart pointers — are only free
*after* inlining. At `opt-level = 0` every `map` is a real closure call, every
`Vec` index is a real bounds-check branch, every `Box` deref is a real load.
The optimiser is not making your code faster; it is removing scaffolding that
was never meant to exist in the final binary.

:::gotcha
**Never benchmark a debug build.** A debug-build number tells you nothing about
release, not even the ranking of two implementations. This is the single most
common false alarm from people new to the language.
:::

Overflow behaviour differs too, and deliberately: debug panics so you find the
bug, release wraps so you do not pay for a check in a hot loop. Both are
defined — neither is **undefined behaviour**. That is the subject of unit 2.

## Editions

An edition is a **dialect**, not a version. Rust ships a new one every three
years — 2015, 2018, 2021, 2024 — and an edition is how the language makes
changes that would otherwise break existing code: new keywords, changed
defaults, sharper errors.

| edition | brought |
|---|---|
| 2015 | the original; `extern crate`, bare `Trait` objects |
| 2018 | `async`/`await` keywords, module path overhaul, `dyn Trait` |
| 2021 | disjoint closure captures, `array.into_iter()` yields values |
| 2024 | `gen` reserved, stricter `unsafe`, `impl Trait` capture rules |

:::note
The edition is per crate, set by one line in `Cargo.toml`. **Crates on different
editions link together with no adapter and no cost.** A 2024 crate can depend on
a 2015 crate that has not been touched in a decade, and neither knows.
:::

That property is what makes editions work at all. There is one compiler and one
standard library; the edition only changes how *your* source is interpreted.
Which is why `cargo fix --edition` can usually migrate a crate mechanically —
and why an old tutorial's code can fail on a modern project for reasons that
have nothing to do with your logic:

```rust,bad
fn show(x: &Display) -> String {    // fine in 2015
    x.to_string()
}
```

```rust,good
fn show(x: &dyn Display) -> String {  // required since 2021
    x.to_string()
}
```

:::compare
**C++** has `-std=c++20`, which changes the language for a translation unit but
demands ABI-compatible everything and can break linking. **Python** has no
mechanism at all, which is why the 2-to-3 migration took a decade. Editions are
per crate, opt-in, and permanently supported: no flag day, ever.
:::

## Dependencies and versions

Crates come from **crates.io**, and versions follow **semver**: `MAJOR.MINOR.PATCH`.

- **patch** — bug fix, nothing new
- **minor** — new API, existing code still compiles
- **major** — something was removed or changed shape

`serde = "1.0"` means "at least 1.0, anything below 2.0". Cargo picks the newest
match at resolve time and pins it in `Cargo.lock`, so nothing moves under you
until you run `cargo update`.

:::gotcha
Adding a required parameter to a public function is a **major** change — it is
`error[E0061]` at every call site. So is adding a required field to a public
struct, or a method to a public trait without a default. Semver is a promise
about compilation, not about intent, and beginners break it by accident when
publishing.
:::

Two major versions of the same crate can coexist in one graph — `rand 0.8` and
`rand 0.9` compile as separate crates. Useful, and the reason for the confusing
class of error where a `Foo` is somehow not a `Foo`: they are from different
copies.

## The commands you actually type

| command | does | run it |
|---|---|---|
| `cargo check` | frontend only — no codegen, no linking | **constantly** |
| `cargo build` | full compile to a binary | when you need to run |
| `cargo run` | build, then execute | to try it |
| `cargo test` | build the test harness and run it | before committing |
| `cargo clippy` | ~750 extra lints | before committing |
| `cargo fmt` | rewrite to the standard style | on save |

:::note
`cargo check` is the one that changes how you work. It stops after type and
borrow checking — skipping LLVM and linking, which is where most of the time
goes — so it is often **five times faster** than `cargo build` and reports the
identical set of errors. Keep `cargo check --all-targets` running in a second
terminal and you get the compiler as an editor rather than as a gate.
:::

**clippy** is a second opinion, not a style bot: it catches `x.len() == 0`,
a needless `clone`, a `match` that wanted `if let`, a loop that wanted an
iterator. Reading its suggestions is one of the fastest ways to learn idiom.

**rustfmt** ends formatting arguments by having none. There is one style, it is
not configurable in any way that matters, and every Rust codebase you open will
look like the last one.

:::note
**The loop.** Write a little, `cargo check`, read the error, fix it. Run
`cargo clippy` and `cargo fmt` before you commit. `--release` only when you are
measuring or shipping. The compiler is meant to be talked to constantly, not
consulted at the end.
:::
