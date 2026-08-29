---
unit: 20-testing
---

## 1

What does `#[cfg(test)]` on a module do?

- A. Marks the module as containing tests, for the reader's benefit
- *B. Compiles the module only when building tests; it does not exist in a normal build
- C. Runs the module before every test
- D. Makes the module's items public to the test harness

@why
It is conditional compilation, not a label. Under `cargo build` the item is
removed before name resolution — so test fixtures, sample data and
`dev-dependencies` never reach the release binary.

That is also the trap: `#[cfg(test)]` on a helper that non-test code calls
compiles perfectly under `cargo test` and fails under `cargo build`. Green tests,
broken build, discovered in CI.

## 2

Why does almost every test module start with `use super::*;`?

- *A. `mod tests` is a child module with its own namespace, and a child can see its parent's items but must still name them
- B. It is required by the `#[test]` attribute
- C. It imports the test harness
- D. It makes the tests public

@why
A test module is an ordinary module. Names do not fall into it; you ask for
them. `super` is the parent, and because a child module may see its parent's
private items, the glob pulls in things no outside user could reach.

That access is the whole reason unit tests live in a child module rather than a
separate file. Without it, `cannot find function ...` — `error[E0425]`.

## 3

Does this compile?

```rust
struct Point { x: i32 }

#[test]
fn t() {
    assert_eq!(Point { x: 1 }, Point { x: 1 });
}
```

- A. Yes
- *B. No — `Point` implements neither `PartialEq` nor `Debug`
- C. No — `#[test]` functions cannot construct structs
- D. Yes, but the comparison is by address

@why
`assert_eq!` expands to a comparison followed by a panic that formats both
values with `{:?}`. So it needs `PartialEq` for `==` and `Debug` to print. The
first error is `E0369: binary operation == cannot be applied`, and fixing only
that reveals `E0277: Point doesn't implement Debug`.

D is the Java/Python intuition. Rust has no default equality at all — comparing
two structs is a trait method or it is a compile error.

## 4

A test is marked `#[should_panic]` with no `expected`. When does it pass?

- A. Only when the function panics with the message in the test's name
- *B. Whenever the test body panics for any reason at all
- C. When the test body returns `Err`
- D. When the test body panics or returns `Err`

@why
Any panic satisfies a bare `#[should_panic]` — an index out of bounds, an
`unwrap` on `None`, an overflow in debug, a panic inside something three calls
down.

Which makes it a test that is not really testing. It stays green after the
behaviour it was written for has been removed, as long as *something* still
panics. `expected = "..."` is what turns it back into a test, and it is worth
treating as mandatory rather than optional.

## 5

`#[should_panic(expected = "index out of bounds")]`. How is that string matched?

- A. Exact equality with the panic message
- *B. As a substring of the formatted panic message
- C. As a regular expression
- D. Against the panic's type

@why
Substring, against the message after formatting. So a short distinctive fragment
is more robust than the whole sentence — a reworded message keeps passing if you
matched only the part that carries the meaning.

The corollary is that a paraphrase never matches. `expected = "total must be > 0"`
does not match a panic saying `total must be non-zero`, even though they mean the
same thing. Copy the substring from the real output.

## 6

Which is true of `tests/api.rs` in a package? Choose all that apply.

- *A. It is compiled as its own crate
- *B. It can only use `pub` items of your library
- C. It needs `#[cfg(test)]` at the top
- *D. It is built only by `cargo test`

@why
Every top-level file in `tests/` becomes a separate crate that links against
your library exactly as a user's crate would. That is what makes it valuable:
it fails if you forgot a `pub use`, if a returned type is unnameable from
outside, if a trait a caller needs is not exported.

C is the common mistake. `#[cfg(test)]` is for code *inside* your library that
should not ship. A file in `tests/` is already excluded from normal builds, so
the attribute is redundant there.

## 7

A helper shared by two integration tests goes where?

- A. `tests/common.rs`
- *B. `tests/common/mod.rs`
- C. `src/common.rs`
- D. `tests/helpers.rs` with `#[cfg(test)]`

@why
Every *top-level* file in `tests/` is compiled as a test crate of its own, so
`tests/common.rs` would be built and run as one — producing a pointless test
binary with zero tests and an empty summary line.

A subdirectory is not treated that way, so `tests/common/mod.rs` is a plain
module that other test files reach with `mod common;`. It is the one place the
older `mod.rs` layout is still the normal answer.

## 8

By default, `cargo test` does what with `println!` output from a passing test?

- A. Prints it interleaved with the test names
- *B. Captures and discards it; it is only shown for failing tests
- C. Writes it to `target/test-output.log`
- D. Prints it only with `--verbose`

@why
Output is captured and shown only when the test fails, which keeps a thousand-test
run readable. The first time you add a `println!` for debugging and see nothing,
this is why.

`cargo test -- --nocapture` turns capture off. Note the bare `--`: everything
after it goes to the test binary rather than to Cargo, which is also true of
`--test-threads` and `--include-ignored`.

## 9

Tests run in parallel by default. Which of these is a real consequence? Choose all that apply.

- *A. Two tests writing the same temporary file can corrupt each other
- *B. A test that sets an environment variable affects tests running at the same time
- C. Tests inside one `mod tests` are serialised with each other
- D. Test order is alphabetical

@why
Each test gets its own thread and they overlap, so any shared mutable state
outside the process's control — files, environment variables, a database, a
fixed network port — is a race.

C and D are both false and both tempting because they would be convenient. There
is no grouping guarantee and no ordering guarantee; the order changes between
runs. The fix is to remove the sharing (unique temp paths per test), not to
schedule around it — though `-- --test-threads=1` exists for the cases where you
genuinely cannot.

## 10

What is the difference between `///` and `//!`?

- *A. `///` documents the item that follows it; `//!` documents the item that contains it
- B. `///` is for functions, `//!` is for modules
- C. `//!` is a doc comment that is not compiled
- D. `///` is public documentation, `//!` is internal

@why
Direction. `///` attaches downwards to the next item; `//!` attaches outwards to
whatever it is inside, which is why it appears at the very top of `lib.rs` — that
is the crate's own documentation — or at the top of a module file.

Both are Markdown and both are rendered by rustdoc. Neither is more private than
the other; `#[doc(hidden)]` is the attribute for hiding an item from the rendered
page while leaving it `pub`.

## 11

What happens to a fenced code block inside a `///` comment when you run `cargo test`?

- A. Nothing — it is rendered by `cargo doc` only
- *B. It is extracted, compiled as a separate crate against your library, and run
- C. It is type-checked but not executed
- D. It is run only if annotated with `#[test]`

@why
Every example in your documentation is a test. `cargo test` extracts the block,
wraps it in a `main`, compiles it as its own crate linked against your library,
and executes it.

That is the property worth knowing: rename a function and the docs stop
compiling; change what it returns and the assertion fails. Documentation cannot
silently drift out of date, because drifting is a build failure. Almost no other
ecosystem has this, and stale README examples are the normal state of the world
elsewhere.

## 12

A doctest example calls `parse_port` but your crate is `my_tool`. Why does the example need `use my_tool::parse_port;`?

- *A. The doctest is compiled as a separate crate, so it sees your library only through its public API
- B. Doctests do not support `use super::*;`
- C. rustdoc requires an import in every example
- D. Because `parse_port` is private

@why
A doctest is a small integration test. It lives outside your crate, links
against it, and therefore sees exactly what a user sees — public items only,
reached by their public paths.

Which makes doctests quietly useful beyond documentation: an example that needs
an awkward import, or that cannot be written at all because a type is not
exported, is telling you something real about your API.

## 13

Which fence annotation compiles the example but does not run it?

- A. ```` ```ignore ````
- *B. ```` ```no_run ````
- C. ```` ```should_panic ````
- D. ```` ```compile_fail ````

@why
`no_run` is for examples that are correct but should not execute here — opening
a socket, writing a file, starting a server. They are still compiled, so they
still break when your API changes, which is most of the value.

`ignore` is the one that skips compilation entirely, and it is a last resort: an
ignored example is back to being ordinary prose that can rot. If you use it, say
why in a comment. `compile_fail` is the inverse and is a real test — it asserts
that some misuse does *not* compile.

## 14

What does `#[ignore]` do, and why use it over commenting the test out?

- *A. Skips the test unless `--include-ignored` is passed, while keeping it compiled and visible in the summary
- B. Deletes the test from the binary
- C. Marks the test as expected to fail
- D. Runs the test but discards its result

@why
An ignored test is still compiled, so it keeps up with refactors instead of
quietly rotting the way commented-out code does, and it appears in the summary
as `ignored` so nobody forgets it exists.

It is the honest home for the slow ones — an end-to-end run against staging, a
fuzz loop — with the reason written in: `#[ignore = "hits the staging API"]`.
Run them with `cargo test -- --include-ignored`.

## 15

You need to check that `decode(encode(x)) == x` for every possible `x`. What reaches for that?

- A. A larger `#[test]` with more `assert_eq!` lines
- *B. Property testing, with `proptest` or `quickcheck`
- C. `#[bench]`
- D. `cargo test --doc`

@why
Property testing asserts a law rather than an example: the tool generates
hundreds of inputs looking for a counterexample, and when it finds one it
*shrinks* it to the smallest failing case before showing you.

Round trips, ordering invariants and parser/printer pairs are where it earns its
place — it finds the empty string, the lone newline and the four-byte emoji, the
cases you were never going to write by hand.

C is the other tool worth naming: `#[bench]` is still unstable after a decade, so
the ecosystem uses **criterion**, which runs your code enough times to give a
confidence interval and compares against the previous run.
