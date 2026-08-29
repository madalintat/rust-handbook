---
unit: 20-testing
---

## 1. The test cannot see the code

@kind fix
@concept test

@expect E0425

A test module is an ordinary child module, which means it starts with an empty
namespace. The function it wants to test is one level up, and nothing has
brought it into scope.

One line fixes this. It is the line every test module in Rust begins with.

```starter
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

#[cfg(test)]
mod spec {
    #[test]
    fn adds() {
        assert_eq!(add(2, 2), 4);
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn adds_correctly() {
        assert_eq!(add(2, 2), 4);
        assert_eq!(add(-1, 1), 0);
    }
}
```

```solution
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

#[cfg(test)]
mod spec {
    use super::*;
    #[test]
    fn adds() {
        assert_eq!(add(2, 2), 4);
    }
}
```

@hint `mod spec` is a module. Modules do not inherit their parent's names.
@hint A child module *can* see its parent's items, including private ones, but it still has to name them.
@hint `use super::*;` as the first line inside `mod spec`.

@diagnose E0425
`cannot find function add in this scope`, pointing at the call inside the test.

Nothing is wrong with `add` and nothing is wrong with the test. `mod spec` is a
separate namespace, and names do not leak downwards into it automatically. You
have to ask. `use super::*;` says *bring in everything the parent module
has*, and because a child module is allowed to see its parent's private items,
that includes the ones no user could reach.

This is precisely why unit tests are written as a child module rather than as a
sibling file: the relationship gives them access to internals for free.

@after
The whole idiom, and it is worth typing from memory:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn name() { /* ... */ }
}
```

`#[cfg(test)]` is doing real work. It means the module is compiled *only* when
building tests. Under `cargo build --release` it does not exist at all, so test
helpers, fixtures and `dev-dependencies` cost your users nothing. Leave it off
and your test data ships in the binary.

## 2. assert_eq! needs two traits

@kind fix
@concept assertion

@expect E0369

`assert_eq!` looks like syntax. It is a macro, and it expands into ordinary code
that compares two values and then prints them if they differ, so the type has to
support both operations.

Give `Point` what the macro needs.

```starter
pub struct Point {
    pub x: i32,
    pub y: i32,
}

pub fn origin() -> Point {
    Point { x: 0, y: 0 }
}

#[cfg(test)]
mod spec {
    use super::*;
    #[test]
    fn at_origin() {
        assert_eq!(origin(), Point { x: 0, y: 0 });
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compares_and_prints() {
        assert_eq!(origin(), Point { x: 0, y: 0 });
        assert!(format!("{:?}", origin()).contains("Point"));
    }
}
```

```solution
#[derive(Debug, PartialEq)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

pub fn origin() -> Point {
    Point { x: 0, y: 0 }
}

#[cfg(test)]
mod spec {
    use super::*;
    #[test]
    fn at_origin() {
        assert_eq!(origin(), Point { x: 0, y: 0 });
    }
}
```

@hint The macro has to do two things with your values, and `Point` supports neither.
@hint Compare them, then print them on failure. Two traits, one derive line.
@hint `#[derive(Debug, PartialEq)]` above the struct.

@diagnose E0369
`binary operation == cannot be applied to type Point`, with a note underneath
saying an implementation of `PartialEq` might be missing.

`assert_eq!` expands to roughly `if !(*left == *right) { panic!(...) }`, so the
first thing it needs is `==`. Rust does not compare structs field by field
unless you say so. Equality is a trait, not a built-in, because for many types
the obvious field-by-field comparison is wrong.

@diagnose E0277
`Point doesn't implement Debug`. This is the second half of the same problem:
having compared the values and found them different, the macro wants to print
them, and the panic message uses `{:?}`. Add `Debug` to the same derive. Fix
only `PartialEq` and this error appears next.

@after
`#[derive(Debug, PartialEq)]` on types that exist to be compared in tests is so
common it is almost reflex. Two things worth knowing about it.

`Debug` is not just for tests: it is what `{:?}`, `unwrap`'s panic message and
`dbg!` all use. There is a lint, `missing_debug_implementations`, that many
libraries turn on for exactly this reason.

`PartialEq` rather than `Eq` because `f64` has `NaN`, which is not equal to
itself. Any type containing a float can only be `PartialEq`, and the split in
the standard library exists to make that honest.

## 3. The question mark needs somewhere to go

@kind fix
@concept test

@expect E0277

The test wants to use `?` so a parse failure ends the test instead of unwrapping
through it. `?` returns early with an error, and this function has nothing to
return it as.

Change the test's signature. The body needs one more line after that.

```starter
pub fn parse_port(s: &str) -> Result<u16, std::num::ParseIntError> {
    s.trim().parse()
}

#[cfg(test)]
mod spec {
    use super::*;
    #[test]
    fn parses() {
        let n = parse_port(" 8000 ")?;
        assert_eq!(n, 8000);
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_and_rejects() {
        assert_eq!(parse_port(" 8000 ").unwrap(), 8000);
        assert!(parse_port("http").is_err());
    }
}
```

```solution
pub fn parse_port(s: &str) -> Result<u16, std::num::ParseIntError> {
    s.trim().parse()
}

#[cfg(test)]
mod spec {
    use super::*;
    #[test]
    fn parses() -> Result<(), std::num::ParseIntError> {
        let n = parse_port(" 8000 ")?;
        assert_eq!(n, 8000);
        Ok(())
    }
}
```

@hint A `#[test]` function is allowed to return a value, and the harness knows what to do with it.
@hint `?` only works in a function returning `Result` or `Option`. Give the test a return type, and then it needs a tail expression.
@hint `fn parses() -> Result<(), std::num::ParseIntError>`, ending with `Ok(())`.

@diagnose E0277
`the ? operator can only be used in a function that returns Result or Option`,
and underneath, `this function should return Result or Option to accept ?`.

`?` is not error handling syntax; it is an early return. On `Err(e)` it converts
`e` and returns it from the enclosing function, so the enclosing function has to
have somewhere to put it. A `#[test]` function returning `()` does not.

The test harness accepts any return type implementing `Termination`, which in
practice means `()` or a `Result` whose error is `Debug`. An `Err` return is
reported as a failure with the error printed.

@diagnose E0308
You added the return type but not the tail expression. A function returning
`Result<(), E>` has to end with a value of that type, and `assert_eq!` produces
`()`. Add `Ok(())` as the last line.

@after
`Box<dyn std::error::Error>` is the usual return type here rather than a named
error, because a test typically calls several fallible things with different
error types and does not care which one failed:

```rust
fn reads_config() -> Result<(), Box<dyn std::error::Error>> {
    let raw = std::fs::read_to_string("fixtures/head.toml")?;
    let n: u16 = raw.trim().parse()?;
    assert_eq!(n, 8000);
    Ok(())
}
```

Two different error types, one signature, because `?` converts through `From`
and everything convertible to `Box<dyn Error>`. The alternative, `.unwrap()` on
every line, reports a panic location instead of the error, which is strictly
less information.

One restriction: a `Result`-returning test cannot also be `#[should_panic]`. The
two ask different questions and the compiler will not guess.

## 4. The panic it was not expecting

@kind fix
@concept should_panic
@expect test-failure

The function panics, the test expects a panic, and the test fails anyway. The
`expected` string is a **substring** match against the real panic message, and
these two do not overlap.

Fix the test so it checks the panic it actually gets.

```starter
pub fn ratio(hits: u32, total: u32) -> f64 {
    assert!(total > 0, "total must be non-zero");
    hits as f64 / total as f64
}

#[cfg(test)]
mod spec {
    use super::*;

    #[test]
    #[should_panic(expected = "total must be > 0")]
    fn zero_total_panics() {
        ratio(1, 0);
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn halves() {
        assert_eq!(ratio(1, 2), 0.5);
    }
}
```

```solution
pub fn ratio(hits: u32, total: u32) -> f64 {
    assert!(total > 0, "total must be non-zero");
    hits as f64 / total as f64
}

#[cfg(test)]
mod spec {
    use super::*;

    #[test]
    #[should_panic(expected = "must be non-zero")]
    fn zero_total_panics() {
        ratio(1, 0);
    }
}
```

@hint Nothing here fails to compile. Read the panic message the function actually produces and compare it with the string the test is looking for.
@hint `expected` is matched as a plain substring of the formatted panic message. `> 0` and `non-zero` share no characters.
@hint `#[should_panic(expected = "must be non-zero")]`, or any substring of the real message.

@diagnose E0425
`cannot find function ratio in this scope`. The test module is missing
`use super::*;`. That is a different problem from the one this exercise is
about; put the import back and the panic mismatch is what remains.

@after
The failure output is the thing to recognise: `panic did not contain expected
string`, with the actual message printed next to the one you asked for. It looks
like the code is wrong and it is almost always the test.

The real lesson is the opposite of what it looks like. A bare `#[should_panic]`
with no `expected` would have passed here, and would go on passing if `ratio`
started panicking because of an array index, an `unwrap` on `None`, or a stack
overflow in something it called. The test would be green and checking nothing.

So `expected` is not optional detail; it is what makes the test a test. Copy the
substring from the real message rather than paraphrasing it, and keep it short
enough to survive a reword.

## 5. Test it the way a user gets it

@kind fix
@concept integration test

@expect E0603

The module below `config` stands in for `tests/api.rs`: a separate crate,
compiled against your library, able to see only what is `pub`. It is reaching
for a private helper.

There are two ways out and only one of them is right. Do not make `digits`
public.

```starter
pub mod config {
    pub struct Config {
        pub retries: u32,
    }

    pub fn parse(s: &str) -> Config {
        Config { retries: digits(s) }
    }

    fn digits(s: &str) -> u32 {
        s.chars().filter(|c| c.is_ascii_digit()).count() as u32
    }
}

#[cfg(test)]
mod integration {
    use super::config;

    #[test]
    fn counts_digits() {
        assert_eq!(config::digits("a1b2"), 2);
    }
}

pub fn run() -> u32 {
    config::parse("a1b2").retries
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_through_the_api() {
        assert_eq!(run(), 2);
        assert_eq!(config::parse("").retries, 0);
    }
}
```

```solution
pub mod config {
    pub struct Config {
        pub retries: u32,
    }

    pub fn parse(s: &str) -> Config {
        Config { retries: digits(s) }
    }

    fn digits(s: &str) -> u32 {
        s.chars().filter(|c| c.is_ascii_digit()).count() as u32
    }
}

#[cfg(test)]
mod integration {
    use super::config;

    #[test]
    fn counts_digits() {
        assert_eq!(config::parse("a1b2").retries, 2);
    }
}

pub fn run() -> u32 {
    config::parse("a1b2").retries
}
```

@hint An integration test is a different crate. Adding `pub` to reach it would publish an implementation detail to every user, forever.
@hint `digits` is not the behaviour you want to guarantee. It is how `parse` happens to be built. What does the crate actually promise?
@hint Call `config::parse("a1b2")` and assert on the `retries` field.

@diagnose E0603
`function digits is private`.

The test is standing outside `config`, and private means visible in the defining
module and its descendants only. `mod integration` is a sibling of `config`, not
a child, so it is on the outside, exactly like `tests/api.rs`, which is not even
in the same crate.

The reflex is to add `pub`. Resist it. `pub` on `digits` makes an internal
helper part of your published API: you can no longer rename it, change its
signature, or delete it without a major version, and you have done that in order
to test something no user will ever call.

@after
This is the argument for integration tests, and it is worth stating plainly.

A unit test in a child module can reach anything, which makes it easy and makes
it test the implementation. An integration test in `tests/` can reach only the
public API, which makes it test *the thing your users get*. It fails if you
forget a `pub use`, if a returned type is not nameable from outside, if a trait
a caller needs is not exported. A unit test can notice none of that, because it
is on the wrong side of the wall.

Keep both. Unit-test the genuinely awkward internals, where reaching a branch
through the API would take twenty lines of setup. Test everything else from
outside.

## 6. The documentation is a test

@kind fix
@concept doctest
@expect test-failure

`kib` used to round down. It rounds up now, and the example in its documentation
was not updated, so `cargo test` fails on the docs rather than on the code.

Fix the example. (The playground compiles your file as a crate called
`playground`, which is why the example says `playground::kib`.)

```starter
/// Converts a byte count to whole kibibytes, rounding up.
///
/// # Examples
///
/// ```
/// assert_eq!(playground::kib(0), 0);
/// assert_eq!(playground::kib(1024), 1);
/// assert_eq!(playground::kib(1025), 1);
/// ```
pub fn kib(bytes: u64) -> u64 {
    bytes.div_ceil(1024)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rounds_up() {
        assert_eq!(kib(0), 0);
        assert_eq!(kib(1), 1);
        assert_eq!(kib(1024), 1);
        assert_eq!(kib(1025), 2);
    }
}
```

```solution
/// Converts a byte count to whole kibibytes, rounding up.
///
/// # Examples
///
/// ```
/// assert_eq!(playground::kib(0), 0);
/// assert_eq!(playground::kib(1024), 1);
/// assert_eq!(playground::kib(1025), 2);
/// ```
pub fn kib(bytes: u64) -> u64 {
    bytes.div_ceil(1024)
}
```

@hint Nothing in this file fails to compile. Read the failure output: which test is it, and where does it live?
@hint The failing test is `src/lib.rs - kib (line 5)`. That is the fenced block in the doc comment, extracted and run.
@hint 1025 bytes rounded up is 2 kibibytes, not 1.

@after
This is the property worth selling. A fenced code block in a doc comment is
extracted by `cargo test`, wrapped in a `main`, compiled as its own crate
against your library, and run. Rename a function and the docs stop compiling.
Change what it returns and the assertion fails.

Documentation in Rust cannot quietly rot, because rotting is a red build. Almost
every other ecosystem's README examples decay silently over a few releases and
nobody finds out until a user does.

Two consequences follow. First, doctests run from *outside* your crate, so they
see only the public API. That makes every example a small integration test, and
is why they need a `use my_crate::...` line. Second, because the example is
checked, writing it before the implementation is a reasonable way to design an
API: you find out immediately whether the calling code reads well.

The fence takes annotations when plain execution is wrong:

| fence | meaning |
|---|---|
| ```` ``` ```` | compile and run |
| ```` ```no_run ```` | compile, do not run: opens a socket, writes a file |
| ```` ```should_panic ```` | the example is meant to panic |
| ```` ```compile_fail ```` | the example must not compile, and that is the point |
| ```` ```ignore ```` | do not even compile; a last resort, and say why |

A line beginning `#` is compiled but hidden from the rendered page, which is how
an example keeps its setup without showing it.

## 7. cfg(test) is not a comment

@kind fix
@concept cfg(test)

@expect E0425

`normalise` is a helper the tests use, and `slug` uses it too, which is part of
the library. The `#[cfg(test)]` on it means it exists only in test builds, so the
library build has nothing to call.

This is the one to recognise on sight, because of *when* it goes wrong.

```starter
#[cfg(test)]
fn normalise(s: &str) -> String {
    s.trim().to_lowercase()
}

pub fn slug(s: &str) -> String {
    normalise(s).replace(' ', "-")
}

#[cfg(test)]
mod spec {
    use super::*;
    #[test]
    fn normalises() {
        assert_eq!(normalise("  Hi There "), "hi there");
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn slugs() {
        assert_eq!(slug("  Hi There "), "hi-there");
        assert_eq!(slug(""), "");
    }
}
```

```solution
fn normalise(s: &str) -> String {
    s.trim().to_lowercase()
}

pub fn slug(s: &str) -> String {
    normalise(s).replace(' ', "-")
}

#[cfg(test)]
mod spec {
    use super::*;
    #[test]
    fn normalises() {
        assert_eq!(normalise("  Hi There "), "hi there");
    }
}
```

@hint Ask which builds contain `normalise` and which builds contain `slug`.
@hint `#[cfg(test)]` deletes the item from every build that is not a test build. `slug` is in all of them.
@hint Remove `#[cfg(test)]` from `normalise`. It stays private, so it is still invisible outside the crate; the attribute was never what was hiding it.

@diagnose E0425
`cannot find function normalise in this scope`, at the call inside `slug`.

`#[cfg(test)]` is not a hint or a label. It is conditional compilation: when the
`test` configuration is off, the item is removed before name resolution runs, so
by the time `slug` is checked there is genuinely no such function.

Note what the timing does to you. Under `cargo test` the `test` cfg is on and
this compiles fine, so the error surfaces on `cargo build`: often in CI, often
on the release build, and always after the tests went green. It is the wrong way
round for a mistake to be found.

@after
Put `#[cfg(test)]` on the test module and nowhere else. That is the entire rule,
and it covers ninety-nine cases out of a hundred:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Vec<u32> { vec![3, 1, 2] }   // helper lives in here
    #[test] fn t() { /* ... */ }
}
```

Helpers that only tests use go *inside* the gated module. Helpers that the
library also uses are ordinary private functions. Private is already enough to
keep them out of your public API, and privacy costs nothing at run time because
the function is inlined or dead-code-eliminated exactly as before.

The same reasoning covers `[dev-dependencies]`: they are linked only into test
and example builds, so a heavyweight assertion crate is free for your users.

## 8. One test, two error types

@kind fix
@concept test

@expect E0277

The test calls two fallible functions with `?`, and they fail in different ways.
One returns a `Utf8Error` and the other a `ParseIntError`, so the signature
cannot name both.

Give the test a return type that accepts both.

```starter
pub fn decode(bytes: &[u8]) -> Result<&str, std::str::Utf8Error> {
    std::str::from_utf8(bytes)
}

pub fn retries(s: &str) -> Result<u32, std::num::ParseIntError> {
    s.trim().parse()
}

#[cfg(test)]
mod spec {
    use super::*;

    #[test]
    fn reads_a_config_line() -> Result<(), std::num::ParseIntError> {
        let text = decode(b"  4 ")?;
        let n = retries(text)?;
        assert_eq!(n, 4);
        Ok(())
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decodes_then_parses() {
        let text = decode(b"  4 ").unwrap();
        assert_eq!(retries(text).unwrap(), 4);
        assert!(decode(&[0xff]).is_err());
        assert!(retries("four").is_err());
    }
}
```

```solution
pub fn decode(bytes: &[u8]) -> Result<&str, std::str::Utf8Error> {
    std::str::from_utf8(bytes)
}

pub fn retries(s: &str) -> Result<u32, std::num::ParseIntError> {
    s.trim().parse()
}

#[cfg(test)]
mod spec {
    use super::*;

    #[test]
    fn reads_a_config_line() -> Result<(), Box<dyn std::error::Error>> {
        let text = decode(b"  4 ")?;
        let n = retries(text)?;
        assert_eq!(n, 4);
        assert!(decode(&[0xff]).is_err());
        Ok(())
    }
}
```

@hint `?` converts the error it is given into the function's error type using `From`. Ask whether that conversion exists here.
@hint There is no `From<Utf8Error> for ParseIntError`, and writing one would be absurd. The test needs an error type that everything converts into.
@hint `-> Result<(), Box<dyn std::error::Error>>`. Every type implementing `Error` converts into it, so both `?` lines work.

@diagnose E0277
`? couldn't convert the error to std::num::ParseIntError`, with a note that
`the trait From<Utf8Error> is not implemented for ParseIntError`.

This is the half of `?` people forget. It is an early return *plus* a
conversion: on `Err(e)` it evaluates `From::from(e)` and returns that. So the
error type in the signature has to be reachable by `From` from every error the
body can produce.

Two errors that have nothing to do with each other cannot be unified by naming
one of them. What you need is a type that both convert into, and
`Box<dyn Error>` is exactly that, via a blanket impl for anything implementing
`Error`.

@diagnose E0308
The return type and the tail expression disagree. A function returning
`Result<(), E>` must end in `Ok(())`; an `assert_eq!` on the last line evaluates
to `()` and is not enough.

@after
`Box<dyn std::error::Error>` is the right default in a test and the wrong default
in a library.

In a test you are the only caller, the failure just needs to be printed, and the
cost of boxing on a path that runs once is nothing. In a library, a boxed error
tells callers nothing they can act on, because they cannot `match` on it to
decide whether to retry. That is why libraries define an error enum and implement
`From` for the errors they wrap.

Same operator, opposite conclusion, and the difference is who reads the error. A
person reads a test failure; a program reads a library's.

The other detail worth keeping: the test harness prints the `Err` with `Debug`
and reports the test as failed. That is more useful than `.unwrap()`, which
reports a panic at a line number and makes you go and look up what the error was.
