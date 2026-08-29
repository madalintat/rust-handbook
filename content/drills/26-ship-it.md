---
unit: 26-ship-it
---

## 1

A test in `tests/cli.rs` can call which of these? Choose all that apply.

- *A. A `pub fn` in `src/lib.rs`
- B. A private `fn` in `src/lib.rs`
- C. A `fn` in `src/main.rs`
- *D. The compiled binary, via `std::process::Command`

@why
A file in `tests/` is compiled as its own crate that depends on your library, so
it sees exactly what any external user sees: the public API of `lib.rs`.

C is the answer that catches people. `main.rs` is a separate crate with no
library interface at all, so nothing can `use` anything from it. That is the
mechanical reason for the bin/lib split: code left in `main.rs` is code no test
can reach, except by running the whole binary as in D.

## 2

Does this compile?

```rust
pub fn search(pattern: &str, contents: &str) -> Vec<&str> {
    contents.lines().filter(|l| l.contains(pattern)).collect()
}
```

- A. Yes, because elision ties the output to the first argument
- *B. No, because with two input references elision cannot choose
- C. No, because `lines()` cannot be collected into a `Vec`
- D. Yes, but the results borrow from `pattern`

@why
`error[E0106]: missing lifetime specifier`. Elision has a rule for exactly one
input reference; with two, rustc will not guess, because the choice is
load-bearing. If the output borrowed from `pattern`, the caller could drop
`contents` while still holding the results.

A describes a rule that does not exist for free functions. That one is for
methods, where `&self` wins. The fix here is
`search<'a>(pattern: &str, contents: &'a str) -> Vec<&'a str>`: tie only the
argument the slices are actually cut from.

## 3

Which of these belong on **stderr**? Choose all that apply.

- A. The matching lines the user asked for
- *B. `could not read locked.txt: permission denied`
- *C. A progress bar
- *D. `--verbose` diagnostic output
- E. The output of `--help` when the user asked for it

@why
Stdout is the tool's data; stderr is everything the user might want to see but a
pipe must not receive. `minigrep foo *.txt | wc -l` has to count matches, so a
warning on stdout corrupts the answer.

E is the deliberate exception and it is worth knowing: help *requested* with
`--help` is what the user asked for, so it goes to stdout and can be piped into a
pager. Help printed *because* the arguments were wrong is a diagnostic, and goes
to stderr. `clap` already does both correctly.

## 4

With `#[derive(Parser)]` and this field, what does the command line look like?

```rust
#[arg(short, long)]
pub ignore_case: bool,
```

- A. A positional argument that must be `true` or `false`
- *B. `-i` and `--ignore-case`, both optional flags defaulting to false
- C. `--ignore_case` only, with the underscore preserved
- D. `-I` and `--ignore-case`

@why
`short` takes the first letter of the field name and `long` takes the whole name
with underscores turned into hyphens. A `bool` field becomes a flag: present is
true, absent is false.

A is what you get if you *omit* the attribute. A bare `bool` field is a
positional argument, and the tool then demands `minigrep pattern path true`,
which is a confusing bug because it still compiles and still runs.

## 5

`thiserror` and `anyhow`: which goes where?

- A. `anyhow` in the library, `thiserror` in the binary
- *B. `thiserror` in the library, `anyhow` in the binary
- C. Either, they do the same job
- D. `anyhow` in both, since `thiserror` is only for async code

@why
They sit on opposite sides of the file boundary because the two halves want
different things. A library's caller needs to `match` on what went wrong, so the
library returns a concrete enum, and `thiserror` derives the `Display` and `Error`
impls for it. `main` never matches; it prints and exits. So it wants one type
that absorbs every error and carries human context, which is `anyhow::Error`.

C is tempting because both crates are "error handling". The distinction is not
style: `anyhow::Error` is opaque, so a caller who gets one back cannot branch on
it without downcasting.

## 6

`run` returns `anyhow::Result<usize>` and `?` on a `Result<_, SearchError>` is
rejected. What is missing?

- A. `impl From<SearchError> for anyhow::Error`
- *B. `impl std::error::Error for SearchError`, which requires `Display` first
- C. `#[derive(Clone)]` on `SearchError`
- D. `SearchError` must be an enum, not a struct

@why
`anyhow::Error` will hold any `E: std::error::Error + Send + Sync + 'static`.
A plain enum of integers already satisfies the last three; `Error` is the one you
have to write, and `Error` has `Debug + Display` as supertraits, so `Display` comes
with it.

A is the intuition from ordinary `?` conversions, and it is worse than
unnecessary. `anyhow` already provides that blanket impl, and yours would
collide with it.

## 7

`e` is an `anyhow::Error` from a failed `.context("could not read notes.md")`.
What does `format!("{e}")` print?

- A. `could not read notes.md: No such file or directory (os error 2)`
- *B. `could not read notes.md`
- C. `No such file or directory (os error 2)`
- D. The whole chain plus a backtrace

@why
`{}` prints only the outermost message. `{:#}` prints the chain joined with
colons, which is answer A. `{:?}` prints it multi-line with a backtrace if one was
captured, which is the form `main` uses when it returns `anyhow::Result`.

The trap is shipping a tool that prints `{e}` and wondering why the error
messages are useless: the *cause* is the half you dropped.

## 8

What is the cost of `println!` inside a loop over a million lines?

- A. Nothing; the macro is compiled away
- *B. A million lock acquisitions on stdout, plus a flush policy you did not choose
- C. A heap allocation per call
- D. One system call per character

@why
`println!` calls `io::stdout()`, which locks, writes and unlocks on every call.
Taking the lock once with `let mut out = io::stdout().lock();` and using
`writeln!` removes a million lock/unlock pairs, and is often several times faster
in a tool whose whole job is printing lines.

The other half of that change is using `?` rather than `.unwrap()`. When the
reader pipes your tool into `head -3`, the pipe closes early; unwrapping turns an
ordinary broken pipe into a panic and a backtrace.

## 9

Which of these does `cargo test` run? Choose all that apply.

- *A. `#[test]` functions in `#[cfg(test)] mod tests` inside `src/lib.rs`
- *B. Every file in `tests/`, each as its own binary
- *C. Code examples inside `///` doc comments
- D. Code examples inside `//` ordinary comments

@why
All three of A, B and C, and C is the one people forget. A fenced code block in a
doc comment is compiled and executed as a test, so an out-of-date example is a
failing build rather than a lie on a documentation page.

That is worth exploiting deliberately: write the example you wish existed, and
the compiler keeps it honest for the life of the crate. Ordinary `//` comments are
invisible to everything, which is precisely why they rot.

## 10

Inside `tests/cli.rs`, what is `env!("CARGO_BIN_EXE_minigrep")`?

- A. The name of the package, as a string
- *B. The absolute path to the built binary, filled in by cargo at compile time
- C. A runtime lookup that fails unless `cargo build` ran first
- D. The directory containing `Cargo.toml`

@why
Cargo sets that environment variable when compiling an integration test, so
`env!` bakes the absolute path in at compile time and cargo guarantees the binary
was built first. No path guessing, no `target/debug/` hard-coded, and it is
correct under `--release` too.

C is the natural worry and it is unfounded. The dependency is part of the build
graph, which is exactly why this is the right way to test a CLI.

## 11

Which of these measurably shrink a release binary? Choose all that apply.

- *A. `strip = true`
- *B. `lto = true`
- *C. `panic = "abort"`
- D. `codegen-units = 1`
- E. `debug = true`

@why
`strip` removes the symbol table and often roughly halves the file. That is the
biggest single win, and free apart from losing symbol names in backtraces. `lto` lets the
linker discard code across crate boundaries. `panic = "abort"` deletes the
unwinding tables and landing pads, at the price of `catch_unwind` and of tests
that expect a panic.

D is about *speed*: it stops the parallel-codegen optimisation loss, and usually
makes the binary very slightly larger. E adds debug info, which is the opposite of
shrinking.

## 12

A tool computes the right answer under `cargo run` and a wrong one under
`cargo run --release`. What is the most likely cause?

- A. LTO reordered the code
- *B. An integer overflow, which panics in debug and wraps in release
- C. `--release` uses a different edition
- D. Undefined behaviour in safe code

@why
The default profiles disagree on exactly one runtime check: `overflow-checks` is
on in debug and off in release. A subtraction that goes below zero panics loudly
during development and silently wraps to a huge number in the binary you ship.

D would be a compiler bug, since safe Rust does not have undefined behaviour. The fix
for B is to say what you meant: `checked_sub`, `saturating_sub` or `wrapping_sub`
mean three different things and all three are explicit.

## 13

`Args::parse()` is called inside a `#[test]`. What happens?

- A. It returns the test binary's own arguments, which is usually harmless
- *B. It reads the test runner's arguments, fails to match them, and exits the process
- C. It returns `Err`, which the test can assert on
- D. It will not compile inside a test

@why
`parse()` reads `std::env::args_os()`, which under `cargo test` means the test
harness's own arguments, and on a mismatch it calls `std::process::exit`. That
kills the test binary rather than failing a test, so you get a confusing abort
with no useful output.

Use `parse_from(argv)` to supply the arguments yourself, or `try_parse_from` when
you want the parse error back as a value. The general shape is the same as the
bin/lib split: push the process boundary as far out as you can.

## 14

You published `minigrep 0.1.0` and it has a serious bug. What can you do?

- A. Delete the version and republish `0.1.0` fixed
- *B. `cargo yank` it so nothing new resolves to it, and publish `0.1.1`
- C. Overwrite it with `cargo publish --force`
- D. Ask crates.io to rename the crate so you can start again

@why
Published versions are permanent. `yank` marks a version so that no *new*
dependency resolution picks it, but it does not delete anything: existing
lockfiles keep building, and they have to, or yanking one crate would break
thousands of builds.

The other permanence worth knowing before your first `cargo publish`: the name is
taken forever the moment you publish, which is why `--dry-run` exists and why
reserving a name with a placeholder is a decision you cannot walk back.

## 15

Why return `ExitCode` from `main` rather than `anyhow::Result<()>`?

- A. `Result` from `main` does not compile
- *B. `Result` gives you 0 or 1 only, and cannot express "worked, found nothing"
- C. `ExitCode` prints the error more nicely
- D. `Result` is slower, because it allocates

@why
Returning `Result` is a perfectly good default: on `Err` it prints the error with
`{:?}` and exits 1. What it cannot express is a *successful* run with a non-zero
status, and a search tool needs exactly that. `grep` has used 0 for found, 1 for
not found and 2 for an error for forty years, and scripts branch on it.

So `main` returns `ExitCode`, matches on the library's `Result`, prints the error
to stderr itself, and picks the number deliberately.
