---
unit: 00-toolchain
---

## 1

Which program downloads a dependency from crates.io?

- A. `rustc`, when it meets a `use` it cannot resolve
- *B. `cargo`, while resolving the dependency graph
- C. `rustup`, at install time
- D. The linker, at the end of the build

@why
`cargo` reads `Cargo.toml`, resolves versions, and fetches anything missing into
`~/.cargo/registry` before it invokes the compiler at all.

A is the tempting answer because the error you see is a *compiler* error:
`error[E0432]: unresolved import`. But rustc has no network access and no idea
crates.io exists. It compiles the crates it was pointed at, and cargo decides
which those are.

## 2

`cargo check` is faster than `cargo build` because it skips…

- A. Borrow checking
- B. Macro expansion
- *C. Code generation and linking
- D. Compiling dependencies

@why
`check` runs the whole frontend (parsing, macro expansion, name resolution, type
checking, borrow checking) and stops before handing anything to LLVM.
Codegen and linking are where most of the wall-clock time goes, so `check` is
often five times faster and reports the identical set of errors.

A is the appealing wrong answer, and getting it wrong the other way costs you:
because `check` *does* borrow-check, it catches essentially every error you will
meet while writing code. That is why it is the command to keep running in a
loop.

## 3

What is `Cargo.lock`?

- A. A file cargo creates to stop two builds running at once
- *B. The exact version of every crate in the graph, chosen once and reused
- C. A list of crates you have forbidden
- D. A cache of compiled dependencies

@why
`Cargo.toml` is what you asked for: version *ranges* like `"1.0"`.
`Cargo.lock` is what you got: one concrete version per crate, transitively, with
checksums. It is why a build is reproducible and why nothing moves under you
until someone runs `cargo update`.

D describes `target/`, which is the other half of the story: the lock file says
*which* code, the target directory holds the compiled result.

## 4

Does this compile on a stable toolchain?

```rust
#![feature(portable_simd)]

fn main() {}
```

- A. Yes, the feature is simply ignored
- *B. No, `#![feature]` is rejected on stable entirely
- C. Yes, with a warning
- D. Only if the feature has been stabilised

@why
`error[E0554]: #![feature] may not be used on the stable release channel`. The
attribute is refused before the compiler looks at what it names.

D is the trap. A stabilised feature does not need the gate and does not accept
it either. The gate itself is the thing stable rejects, whatever is inside the
parentheses. The refusal is what makes the promise "code that builds on stable
today builds on stable forever" true.

## 5

Which of these differ between the `dev` and `release` profiles? Choose all that
apply.

- *A. Whether integer overflow panics or wraps
- *B. Whether `debug_assert!` runs
- C. Which edition the crate is compiled under
- *D. The optimisation level
- E. Which dependencies are resolved

@why
Debug panics on overflow so you find the bug; release wraps so you do not pay
for the check in a hot loop. `debug_assert!` compiles to nothing in release.
`opt-level` goes from 0 to 3.

C and E are profile-independent. The edition is one line in `Cargo.toml` and
applies to every build of that crate; dependency resolution happens before the
profile is even consulted, which is why both profiles share one `Cargo.lock`.

## 6

A crate on the 2024 edition depends on a crate last published in 2016 on the
2015 edition. What happens?

- *A. It builds and links normally, at no cost
- B. It fails, because editions must match across a dependency graph
- C. It builds, but the old crate is recompiled under 2024 rules
- D. Cargo inserts a compatibility shim

@why
The edition is per crate, and this is the property that makes editions work at
all. There is one compiler and one standard library; the edition only changes
how *that crate's source* is interpreted. Once compiled, the output is ordinary
Rust and links like anything else.

C is the reasonable-sounding wrong answer, and if it were true, editions would
be flag days. Every crate in the ecosystem would have to migrate together, and
nobody could ever ship a breaking change to syntax.

## 7

Which of these did an edition change?

- A. The behaviour of `Vec::push`
- *B. Whether a bare `Trait` is accepted where `dyn Trait` is meant
- C. The size of `usize`
- D. Which version of the standard library you get

@why
Bare trait objects were legal in 2015 and 2018 and are `error[E0782]` from 2021
onward, which is a change in how source is *read*.

An edition never changes the standard library or the semantics of a library
function. If it did, one crate's edition could alter another crate's behaviour,
and the whole per-crate model would collapse. `usize` is a property of the
target architecture, not of the language dialect.

## 8

Which of these are **major** semver changes to a published library? Choose all
that apply.

- *A. Adding a required parameter to a public function
- B. Adding a new public function
- *C. Removing a public struct field
- *D. Adding a method to a public trait with no default body
- E. Fixing a bug in a private helper

@why
Major means "existing code may stop compiling". A is `error[E0061]` at every
call site; C breaks every construction and pattern match; D breaks every
downstream implementor of the trait.

B is minor: new API, nothing existing breaks. E is a patch.

D is the one people publish by accident. A trait method *with* a default body is
minor; the same method without one is a breaking change to every implementor you
have never met.

## 9

`rustc` compiles…

- A. One `.rs` file at a time, like a C compiler
- *B. One crate at a time: the root file plus everything reachable via `mod`
- C. One function at a time, on demand
- D. The whole dependency graph in a single invocation

@why
The crate is the compilation unit. That is why Rust needs no header files and no
forward declarations, since the compiler already sees the whole crate. It is also
why a one-character change recompiles the crate rather than one file.

D describes cargo's job, and it does it with one `rustc` invocation *per crate*,
in dependency order. This is why dependencies are cached in `target/` and only
your own crate is rebuilt on a normal edit.

## 10

Why is a debug build often 10 to 100× slower than a release build, more than the
same ratio in C?

- A. Debug builds insert a runtime type checker
- *B. Rust's abstractions are only free after inlining, and `opt-level = 0` does not inline
- C. Debug builds use a different, slower standard library
- D. The borrow checker runs at runtime in debug

@why
Iterators, `Option`, generics and smart pointers compile to nothing extra
*after* the optimiser has inlined them away. At `opt-level = 0` every `map` is a
real closure call and every `Box` deref a real load, so the scaffolding you were
promised would vanish is all still there.

D is worth naming as wrong: the borrow checker never runs at runtime, in any
profile. It runs in the frontend and then ceases to exist.

The practical consequence: a debug-build benchmark tells you nothing, not even
the ranking of two implementations.

## 11

What does `cargo run -- --verbose` do?

- A. Runs cargo in verbose mode
- *B. Builds and runs your program, passing `--verbose` to it
- C. Fails, because `--` is not valid syntax
- D. Runs the program twice

@why
Everything after `--` is handed to your binary rather than consumed by cargo.
`cargo run --verbose` (no dashes) is the other one: that flag belongs to cargo
and makes it print the full `rustc` invocations.

Reading those invocations once is genuinely instructive. It is the only place
you see how many flags cargo is filling in on your behalf.

## 12

Your project has been building for two minutes on every single edit. What is the
most likely cause?

- A. The project is simply large
- *B. Something is invalidating the dependency cache on each build
- C. `cargo check` is not being used
- D. The lock file is missing

@why
Dependencies compile once and are cached in `target/`; a normal edit rebuilds
only your crate. Repeated full rebuilds mean the cache is being thrown away.
Usually the culprit is a changed feature flag, an alternating profile or target,
a `build.rs` that reruns unconditionally, or `RUSTFLAGS` differing between
invocations.

A is what people conclude, and then they wait. The first build being slow is
expected; every build being slow is a fingerprint problem worth ten minutes of
investigation.

## 13

What lives in `target/`, and should it be committed?

- A. Your source, compiled; commit it so deploys are fast
- *B. Object files, incremental state and binaries; never commit it
- C. Downloaded dependency sources; never commit it
- D. The resolved dependency versions; commit it

@why
`target/` is everything derived: object files, fingerprints, incremental
compilation state, and the final binaries. It is disposable, it is regenerable
from the source plus the lock file, and it is routinely a gigabyte.

C describes `~/.cargo/registry`, which is outside the project entirely. D
describes `Cargo.lock`, which *should* be committed for a binary. That is the
file that makes the deploy build the bytes you tested.

## 14

What is `cargo clippy` for?

- A. Enforcing the standard formatting
- *B. Around 750 extra lints: needless clones, `len() == 0`, loops that wanted an iterator
- C. Checking that documentation examples compile
- D. Auditing dependencies for security advisories

@why
Clippy is a second opinion on your code, not a style bot. It is also one of the
fastest ways to learn idiom: every lint comes with the shorter version you meant
to write.

A is `cargo fmt`. C happens automatically under `cargo test`, which compiles and
runs doc examples. D is `cargo audit`, a separate tool.

## 15

`rustfmt` has almost no configuration. Why is that a design choice rather than
an omission?

- A. Formatting is too hard to make configurable
- *B. One style means every Rust codebase reads like the last one, and no project spends time deciding
- C. Configuration would slow down formatting
- D. It matches what `rustc` requires

@why
The value of a formatter is proportional to how many projects use the same one.
Options fragment that, and every option is a discussion in some team's pull
request forever.

D is wrong in a way worth being clear about: `rustc` does not care about
whitespace at all. Formatting is entirely for humans, which is precisely why
settling it once and never revisiting it is the right trade.
