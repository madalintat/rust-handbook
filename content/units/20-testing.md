---
num: 20
slug: 20-testing
title: Testing and docs
accent: moss
concepts: test, assertion, should_panic, unit test, integration test, doctest, doc comment, cargo test, benchmark, property testing
needs: 12-errors, 19-modules
blurb: Tests are ordinary functions with an attribute, and the examples in your documentation are compiled and run, so your docs cannot quietly rot.
---

%% Every language has a test framework. Rust's is unusual in two ways: there is nothing to install, because `cargo test` and `#[test]` are part of the toolchain; and the code examples in your documentation are *compiled and executed* by that same command. The second one matters more than it sounds. A README example that stopped working two releases ago is the normal state of the world, and here it is a failing build.

The mechanics are small. The design decisions behind them are the interesting part.

## A test is a function with an attribute

### `#[test]`

```rust
pub fn parse_port(s: &str) -> Option<u16> {
    s.parse().ok().filter(|&n| n != 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_zero() {
        assert_eq!(parse_port("0"), None);
    }

    #[test]
    fn accepts_eight_thousand() {
        assert_eq!(parse_port("8000"), Some(8000));
    }
}
```

No framework, no registration, no base class, no naming convention. `#[test]`
tells the compiler to build a **test harness**: a hidden `main` that collects
every annotated function and runs them. A test passes if it returns without
panicking.

`use super::*;` is why the tests can call `parse_port` at all. `mod tests` is a
child module, and a child sees its parent's items, private ones included.

### Why `#[cfg(test)]`

```rust
#[cfg(test)]
mod tests { /* ... */ }
```

`#[cfg(test)]` compiles the item **only when building tests**. Under
`cargo build` or `cargo build --release` the module does not exist: it is not
compiled, not optimised, not in the binary, and its dependencies are not linked.

That is the practical reason. There is a stronger one. Because test code is
excluded from the real build, a test helper can be as slow, as ugly and as
allocation-happy as it likes without anyone paying for it at run time.
`dev-dependencies` in `Cargo.toml` work the same way, which is why pulling in a
heavyweight assertion crate costs your users nothing.

:::gotcha
`#[cfg(test)]` on the *module* is right. `#[cfg(test)]` on a helper that
non-test code calls is a mistake that compiles perfectly under `cargo test` and
fails under `cargo build`, which is exactly the wrong way round to find out.
:::

## Asserting

| macro | fails when | prints |
|---|---|---|
| `assert!(cond)` | `cond` is false | the expression source |
| `assert_eq!(a, b)` | `a != b` | both values, with `Debug` |
| `assert_ne!(a, b)` | `a == b` | both values |

`assert_eq!` needs `PartialEq` on the type and `Debug` to print it, which is why
`#[derive(Debug, PartialEq)]` appears on so many types that are only ever
compared in a test.

### The message is worth writing

Every assertion macro takes a trailing format string.

```rust
assert!(
    port > 1024,
    "port {port} is privileged; the config file said {raw:?}"
);
```

Left off, a failure tells you `assertion failed: port > 1024` and you go and
find out what `port` was. Written, the failure tells you. In CI, where you
cannot attach a debugger and the run happened forty minutes ago, this is most of
the difference between a two-minute fix and an afternoon.

### `#[should_panic]`

```rust
pub fn ratio(hits: u32, total: u32) -> f64 {
    assert!(total > 0, "total must be non-zero");
    hits as f64 / total as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[should_panic(expected = "must be non-zero")]
    fn zero_total_panics() {
        ratio(1, 0);
    }
}
```

The test passes only if the function panics. `expected` is a **substring** match
against the panic message, and leaving it out is a real bug in the test: a bare
`#[should_panic]` passes when the function panics for a completely unrelated
reason, such as an index out of bounds or an `unwrap` on a `None`, so the test
goes on passing after the behaviour it was checking has gone.

:::gotcha
`expected` is matched as a substring, not a regex and not an equality. It also
runs against the *formatted* message, so `expected = "total must be > 0"` will
not match a panic that says `total must be non-zero` even though a human would
call them the same thing. Copy the substring from the real message.
:::

### Returning `Result` so `?` works

A test may return `Result`, and then `?` is available:

```rust
#[test]
fn reads_the_header() -> Result<(), Box<dyn std::error::Error>> {
    let raw = std::fs::read_to_string("fixtures/head.toml")?;
    let cfg: Config = raw.parse()?;
    assert_eq!(cfg.retries, 3);
    Ok(())
}
```

The test fails if it returns `Err`. Without this you write `.unwrap()` on every
fallible line, and an `unwrap` failure reports a panic at a line number rather
than the error itself.

:::note
A `Result`-returning test cannot also be `#[should_panic]`. They ask different
questions, "did it return `Err`" and "did it abort", so the compiler rejects the
combination rather than guessing.
:::

## Where tests live

Two locations, and the distinction is not stylistic.

```
src/lib.rs          #[cfg(test)] mod tests   → sees private items
tests/api.rs        an integration test      → sees only pub items
```

:::memory two vantage points on one crate
     UNIT TEST                        INTEGRATION TEST
     inside the crate                 a separate crate
     ┌───────────────────────┐        ┌───────────────────────┐
     │ pub fn parse()        │◀───────│ use my_tool::parse;   │
     │ fn normalise()   ◀────┼──┐     │                       │
     │                       │  │     │  normalise ──▶ ✗      │
     │ #[cfg(test)] mod tests┼──┘     │  not in the API       │
     └───────────────────────┘        └───────────────────────┘
:::

### Unit tests, beside the code

A **unit test** in a `#[cfg(test)] mod tests` is a child module, so it can reach
private functions, private fields and `pub(crate)` items. That is the right tool
for a tricky internal, a parser state machine or a hash mixing function, where
testing through the public API would take twenty lines of setup to reach one
branch.

### Integration tests, in `tests/`

Every file in `tests/` is an **integration test**, compiled as its own crate and
linked against your library the way any user's crate would be. It needs no
`#[cfg(test)]`, because the whole file is only built by `cargo test`.

```rust
// tests/api.rs
use my_tool::{parse, Error};

#[test]
fn rejects_an_empty_document() {
    assert!(matches!(parse(""), Err(Error::Empty)));
}
```

This is the more valuable of the two, and it is worth being blunt about why: it
is the only kind of test that checks what your users actually get. It fails if
you forget a `pub use`, if a type you return is not nameable from outside, if a
trait a caller needs is not exported. A unit test cannot notice any of that,
because it is standing on the wrong side of the wall.

:::gotcha
A helper module shared between integration tests goes in
`tests/common/mod.rs`, not `tests/common.rs`. Every top-level file in `tests/` is
compiled as a test crate of its own, so a bare `common.rs` would be built as one
and reported as an empty test binary.
:::

## Running them

`cargo test` builds the library, its unit tests, every integration test, and
every documentation example, then runs the lot.

| you want | you write |
|---|---|
| everything | `cargo test` |
| only tests whose name contains `port` | `cargo test port` |
| that exact test | `cargo test parse::tests::rejects_zero` |
| see `println!` from passing tests | `cargo test -- --nocapture` |
| one at a time, in order | `cargo test -- --test-threads=1` |
| the ignored ones too | `cargo test -- --include-ignored` |
| only the integration test `api.rs` | `cargo test --test api` |
| only the doc examples | `cargo test --doc` |

Two defaults deserve a note.

**Tests run in parallel, on one thread each.** So two tests that write to
`/tmp/out.txt` will interleave, and a test that sets an environment variable is
visible to the others. Shared mutable state has to be avoided rather than
scheduled around, because the ordering is not stable between runs.

**Output is captured unless the test fails.** `println!` inside a passing test
goes nowhere, which is confusing the first time. `--nocapture` turns it off.

```rust
#[test]
#[ignore = "hits the staging API; run with --include-ignored"]
fn end_to_end() { /* ... */ }
```

`#[ignore]` skips a test by default and is the honest home for the slow ones. It
beats commenting one out, because an ignored test is still compiled and still
shows in the summary.

## Documentation that is compiled

### `///` and `//!`

```rust
//! Parsing for the config file format.
//!
//! This is an inner doc comment: it documents the *containing* item, so at the
//! top of `lib.rs` it documents the crate.

/// Parses a port number, rejecting zero.
///
/// Returns `None` if `s` is not a number or is `0`.
///
/// # Examples
///
/// ```
/// use my_tool::parse_port;
/// assert_eq!(parse_port("8000"), Some(8000));
/// assert_eq!(parse_port("0"), None);
/// ```
pub fn parse_port(s: &str) -> Option<u16> {
    s.parse().ok().filter(|&n| n != 0)
}
```

`///` documents the item below it. `//!` documents the thing it is inside. Both
are Markdown, and the conventional headings (`# Examples`, `# Panics`,
`# Errors`, `# Safety`) are what the whole ecosystem uses, so readers scan for
them.

### Doctests

That fenced block is a **doctest**, not an illustration. `cargo test` extracts it, wraps it in
a `main`, compiles it as a separate crate against your library, and runs it.

:::note
**Every example in your documentation is a test.** Rename the function and the
docs stop compiling. Change what it returns and the assertion fails. Documentation
in Rust cannot silently drift out of date, because drifting is a build failure.
:::

This is genuinely unusual and it changes what documentation is for. An example
that is checked is a specification you can trust, so writing the example first
is a reasonable way to design the API. You find out immediately if the calling
code is awkward.

Doctests run from *outside* your crate, so they see only the public API. That
makes them a third kind of integration test, and it is why a doctest needs the
`use my_tool::...` line that a unit test does not.

Annotations on the fence control what happens:

````markdown
```           compile and run
```no_run     compile, do not run, for an example that opens a socket
```ignore     do not even compile; a last resort, so say why
```should_panic  the example is expected to panic
```compile_fail  the example must not compile, and that is the point
````

A leading `#` hides a line from the rendered page but still compiles it, which
is how an example keeps its setup without showing it:

```rust
/// ```
/// # let cfg = my_tool::Config::default();
/// assert_eq!(cfg.retries, 3);
/// ```
```

### The rest of rustdoc

`cargo doc --open` builds documentation for your crate *and every dependency*
you have, at the exact versions you are using, and opens it. That is usually
better than the copy on docs.rs, because it is the version you actually compiled
against.

**Intra-doc links** turn a path into a link: `` [`Config::retries`] `` resolves
like a Rust path and is checked. A link to something that no longer exists is a
warning, which makes prose refactor-safe in the same way examples are.

`#[doc(hidden)]` keeps an item out of the rendered docs while leaving it `pub`,
which suits something a macro needs to name but no human should call. It is a
documentation decision, not a visibility one: the item is still part of your
public API and still bound by semver.

## Two things that exist

**Benchmarks.** `#[bench]` is unstable and has been for a decade, so the
ecosystem standardised on **criterion**, a dev-dependency that runs your code
enough times to produce a confidence interval and compares against the previous
run. Reach for it the moment a performance claim needs to be defended, because
timing a debug build by hand is worse than not measuring.

**Property testing.** Instead of asserting one example, assert a law and let the
tool look for a counterexample. `proptest` and `quickcheck` generate hundreds of
inputs, and when one fails they *shrink* it to the smallest failing case.

```rust
// with proptest
proptest! {
    #[test]
    fn round_trips(s in ".*") {
        assert_eq!(decode(&encode(&s)), s);
    }
}
```

Round trips, ordering invariants and parser/printer pairs are where this pays
for itself. It finds the empty string, the lone newline and the four-byte emoji:
the cases you were never going to think of.

:::note
**The habit.** Unit-test the internals that are hard to reach. Integration-test
the API, because that is what people get. Put an example in the doc comment of
every public function, because it is free documentation that cannot rot and a
test at the same time.
:::
