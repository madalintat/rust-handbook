---
num: 26
slug: 26-ship-it
title: Ship it
accent: rust
concepts: cargo new, lib split, clap, anyhow, stdout, stderr, exit code, integration test, doc comment, release profile, lto, clippy
needs: 12-errors, 17-iterators, 19-modules, 20-testing
blurb: A file-searching tool from `cargo new` to a stripped release binary: the library split, clap, anyhow, two output streams, and what actually makes it small.
---

%% Everything so far has been a piece. This is the assembly: one command-line tool, a small `grep`, built in the order you would actually build it. Nothing here is new syntax. What is new is the arrangement: which code goes in which file, which error type each half wants, and which of the twenty things `cargo` can do are worth doing.

The tool is called `minigrep`. It takes a pattern and a path, prints matching
lines with line numbers, and exits 0 if it found something.

## Two files, and the line between them

### cargo new, then split it immediately

```sh
cargo new minigrep
cd minigrep
```

That gives you `src/main.rs` and nothing else. The first real decision is to add
`src/lib.rs` and move almost everything into it.

```
minigrep/
├── Cargo.toml
├── src/
│   ├── main.rs      the binary: arguments, streams, exit code
│   └── lib.rs       the library: everything worth testing
└── tests/
    └── cli.rs       drives the built binary from outside
```

Both files are compiled. `src/lib.rs` becomes a library crate named after the
package; `src/main.rs` becomes a binary that depends on it, by name:

```rust
// src/main.rs
use minigrep::{search, Config};
```

### Why the split is the important decision

:::note
`main` cannot be tested. A `#[test]` cannot call it, cannot pass it arguments,
and cannot read what it printed. Every line you leave in `main` is a line no test
will ever cover.
:::

So `main` gets only the three things that genuinely require a process: reading
`argv`, holding the real stdout, and returning an exit status.

```rust
fn main() -> ExitCode {
    let args = Args::parse();
    match minigrep::run(&args, &mut io::stdout().lock()) {
        Ok(hits) if hits > 0 => ExitCode::SUCCESS,
        Ok(_) => ExitCode::from(1),
        Err(e) => {
            eprintln!("minigrep: {e:#}");
            ExitCode::from(2)
        }
    }
}
```

Four lines of logic. Everything below `run` is library code, takes `&str` and
`impl Write`, and can be tested on a machine with no filesystem at all.

:::compare
**Python / Go.** The habit of putting the work in `main()` and reaching for a
subprocess-based test costs you nothing until the tool grows. In Rust the
convention is enforced by the crate layout: `lib.rs` is importable, `main.rs`
is not, and integration tests can only see the library.
:::

## Arguments

### The derive API

```toml
[dependencies]
clap = { version = "4", features = ["derive"] }
```

```rust
use clap::Parser;

#[derive(Parser, Debug)]
#[command(version, about = "Search a file for lines matching a pattern")]
pub struct Args {
    /// The pattern to search for
    pub pattern: String,

    /// The file to search
    pub path: PathBuf,

    /// Match without regard to case
    #[arg(short, long)]
    pub ignore_case: bool,

    /// Lines of context either side
    #[arg(short = 'C', long, default_value_t = 0)]
    pub context: usize,
}
```

The struct *is* the interface. Field order gives positional order, `bool` becomes
a flag, `usize` gets parsed and range-checked, and the doc comments become
`--help`. There is no second place to update when the interface changes.

:::gotcha
`Args::parse()` calls `std::process::exit` when the arguments are wrong. That is
correct in `main` and wrong anywhere else. Inside a test it kills the test
runner rather than failing a test. Use `try_parse_from(argv)` when you want the
error back, and `parse_from(argv)` when you want to supply the arguments.
:::

### Validation belongs in the type

`#[arg(value_parser = clap::value_parser!(u16).range(1..=65535))]` moves a check
out of your code and into `--help` output and the error message. The general rule
is the same one from the types unit: if the parser can reject it, your logic
never has to consider it.

## Errors, twice

### An application wants a sentence

`main` never matches on an error. It prints it and exits. That is exactly what
`anyhow` is for.

```rust
use anyhow::{Context, Result};

pub fn read_input(path: &Path) -> Result<String> {
    fs::read_to_string(path)
        .with_context(|| format!("could not read {}", path.display()))
}
```

Without the context: `No such file or directory (os error 2)`. With it:
`could not read notes.md: No such file or directory (os error 2)`. The second one
tells the user which of their three arguments was wrong.

`anyhow::Error` holds any error satisfying `Error + Send + Sync + 'static`, so
every `?` in the application half just works, and `{:#}` prints the whole chain
on one line.

### A library wants a type

The moment someone else calls your code, a sentence is not enough. They need to
branch on what went wrong.

```rust
#[derive(Debug, thiserror::Error)]
pub enum SearchError {
    #[error("search pattern must not be empty")]
    EmptyPattern,
    #[error("context of {0} lines is above the limit of 100")]
    ContextTooLarge(usize),
}
```

:::note
`thiserror` in `lib.rs`, `anyhow` in `main.rs`. One defines errors a caller can
`match` on; the other accumulates human context and prints it once. They are not
competitors; they sit on opposite sides of the file boundary.
:::

## The search

### Written against `&str`, so it costs nothing

```rust
pub fn search<'a>(pattern: &str, contents: &'a str) -> Vec<&'a str> {
    contents
        .lines()
        .filter(|line| line.contains(pattern))
        .collect()
}
```

The lifetime is the design. Every result is a pointer and a length into the
buffer already read, so a match allocates nothing.

:::memory one read, many borrowed hits
       STACK                              HEAP
     ┌─────────────────────┐   ┌──────────────────────────────┐
 buf │ ptr ●───────────────┼──▶│ Rust:\nsafe, fast\nPick three│
     │ len 30              │   └───▲──────────▲───────────────┘
     └─────────────────────┘       │          │
 hits┌─────────────────────┐       │          │
     │ [0] ptr ●───────────┼───────┘          │
     │     len 10          │  a hit is 16 bytes
     │ [1] ptr ●───────────┼──────────────────┘
     │     len 10          │  the text is never copied
     └─────────────────────┘
:::

`.lines()` is lazy, `.filter()` is lazy, and only `.collect()` does any work, so
the whole pipeline compiles into a single pass over the buffer with no
intermediate vectors.

### Because it takes `&str`, it is testable

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_line() {
        let contents = "Rust:\nsafe, fast\nPick three";
        assert_eq!(search("fast", contents), vec!["safe, fast"]);
    }
}
```

There is no temporary directory to build and nothing to clean up afterwards.
This is the payoff for the split: the interesting code never learned what a file
is.

## Two streams and a number

### stdout is data, stderr is everything else

```rust
writeln!(out, "{}:{}", hit.line_no, hit.text)?;      // a result
eprintln!("minigrep: {path}: permission denied");    // a diagnostic
```

`minigrep foo *.txt | wc -l` must count matches. If warnings went to stdout the
count would be wrong, and a user would have no way to separate them. That is the
entire rule, and it is why `--verbose` output, progress bars and errors all go to
stderr.

:::gotcha
`println!` locks stdout, writes, and unlocks again, once for every call. In a
loop over a million lines that is a million lock acquisitions. Take the lock once:

```rust
let mut out = io::stdout().lock();
for hit in &hits { writeln!(out, "{hit}")?; }
```

And use `?`, not `.unwrap()`. `minigrep foo big.txt | head -3` closes the pipe
early; unwrapping turns that into a panic with a backtrace.
:::

### Exit codes

`main` may return `ExitCode`, and the convention is older than the language:

| code | meaning |
|---|---|
| 0 | found at least one match |
| 1 | ran fine, found nothing |
| 2 | something went wrong |

```rust
fn main() -> ExitCode { /* ... */ }
```

Returning `Result` from `main` instead gives you 1 on error and a `{:?}` dump of
the anyhow chain, which is a reasonable default. But it cannot express "worked,
found nothing", and shell scripts depend on that distinction.

## Tests and docs

### Three layers, three costs

| where | sees | speed |
|---|---|---|
| `#[cfg(test)] mod tests` in `lib.rs` | private items too | fastest |
| `tests/cli.rs` | the public API only | one binary per file |
| doc examples | the public API, as a reader sees it | compiled and run by `cargo test` |

The **integration test** catches the one thing unit tests cannot: whether the
binary itself behaves.

```rust
// tests/cli.rs
#[test]
fn exits_one_when_nothing_matches() {
    let out = Command::new(env!("CARGO_BIN_EXE_minigrep"))
        .args(["zzz", "Cargo.toml"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(1));
    assert!(out.stdout.is_empty());
}
```

`CARGO_BIN_EXE_<name>` is set by cargo, so you never have to guess the path.

### Doc comments are tests

```rust
/// Returns every line of `contents` containing `pattern`.
///
/// ```
/// let hits = minigrep::search("fast", "slow\nfast\n");
/// assert_eq!(hits, vec!["fast"]);
/// ```
pub fn search<'a>(pattern: &str, contents: &'a str) -> Vec<&'a str> {
```

`cargo test` compiles and runs that example. An out-of-date doc example is a
failing build rather than a lie on a web page, which is the single best feature
in the toolchain. `cargo doc --open` renders it.

## Shipping

### What actually makes the binary small and fast

```toml
[profile.release]
lto = true
codegen-units = 1
panic = "abort"
strip = true
```

| setting | effect | cost |
|---|---|---|
| `--release` alone | ~10 to 100× faster than debug | slow builds |
| `lto = true` | **LTO**: inlining across crate boundaries | much slower link |
| `codegen-units = 1` | no parallel-codegen optimisation loss | slower builds |
| `strip = true` | drops symbols, often halving the file | no backtraces |
| `panic = "abort"` | removes unwinding tables | no `catch_unwind` |
| `opt-level = "z"` | size over speed | measurably slower |

Measure before believing any of it. `strip` and `lto` are close to free;
`opt-level = "z"` frequently makes things worse.

:::gotcha
Debug builds check integer overflow and release builds wrap. A tool that is
correct under `cargo run` and quietly wrong under `cargo run --release` is
almost always this. Test the release profile before you ship it.
:::

### Saying what happened

A tool that prints only its results is a tool nobody can debug from a bug
report. The convention is `log` for the facade and `env_logger` or `tracing`
for the implementation, with the level chosen by an environment variable rather
than a flag, so a user can turn detail on without you shipping a new release.

```rust
log::debug!("scanning {} with {} threads", path.display(), n);
log::warn!("skipping {}: {}", path.display(), err);
```

Three things make this different from scattering `println!`:

The macros compile to nothing when the level is off, because the level check
happens before the arguments are formatted. A `debug!` in a hot loop costs one
comparison in production rather than a string allocation.

Everything goes to stderr, so it never contaminates the results you piped
somewhere.

`RUST_LOG=mytool=debug` turns on one crate at a time, which is what you want at
2am when the bug is in your code and not in the six dependencies also logging.

`tracing` is the same idea for concurrent programs. Its unit is a span rather
than a line, so a message carries the request or task it happened inside, which
is the difference between a readable log and an interleaved one once more than
one thing is in flight.

### The last pass

```sh
cargo fmt          # no more formatting opinions, ever
cargo clippy -- -D warnings
```

Clippy is not a style checker. It knows the standard library, so it finds the
`unwrap` that should be `?`, the `clone` that should be a borrow, and the manual
loop that is a `filter_map`. Run it in CI with `-D warnings` from the first day,
because retrofitting it to a year-old codebase is a bad afternoon.

### Publishing, honestly

```sh
cargo publish --dry-run
cargo publish
```

Two things nobody tells you. **Versions on crates.io are permanent**: you can
**yank** one so no new project resolves to it, but you cannot delete or replace it,
and anything with it in a lockfile keeps building. And **the name is taken
forever** the moment you publish, so publishing a placeholder to reserve a name is
a thing people do and then regret.

Before you publish, fill in `description`, `license` and `repository` in
`Cargo.toml`. Cargo refuses without the first two, and readers ignore a crate
missing the third.
