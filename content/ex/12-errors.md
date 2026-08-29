---
unit: 12-errors
---

## 1. Say Ok out loud

@kind fix
@concept Result

@expect E0308

`half` promises a `Result` in its signature and then hands back a bare number on
the success path. The failure path is already right, which makes the asymmetry
easy to see.

```starter
pub fn half(n: i32) -> Result<i32, String> {
    if n % 2 == 0 {
        n / 2
    } else {
        Err(format!("{n} is odd"))
    }
}

pub fn run() -> (Result<i32, String>, Result<i32, String>) {
    (half(10), half(7))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn even_and_odd() {
        assert_eq!(run(), (Ok(5), Err(String::from("7 is odd"))));
    }
}
```

```solution
pub fn half(n: i32) -> Result<i32, String> {
    if n % 2 == 0 {
        Ok(n / 2)
    } else {
        Err(format!("{n} is odd"))
    }
}

pub fn run() -> (Result<i32, String>, Result<i32, String>) {
    (half(10), half(7))
}
```

@hint `Result` is an ordinary enum with two variants. The `Err` arm names its variant. The other arm does not.
@hint Wrap the success value: `Ok(n / 2)`.

@diagnose E0308
`mismatched types: expected Result<i32, String>, found i32`, pointing at
`n / 2`, with the function's return type underlined as the reason.

Nothing here is special about errors. `Result<T, E>` is a plain enum:

```rust
enum Result<T, E> { Ok(T), Err(E) }
```

so a function returning one must produce a *variant*, not a bare `T`. The `Err`
branch already does, which is why rustc says nothing about it.

Both arms of an `if` must also have the same type, so once one arm is a
`Result`, the other has to be too. That is the second reason this cannot stand
as it is.

@after
Because `Result` is a value rather than a control-flow mechanism, a few things
fall out for free. It can be stored in a `Vec`, returned from a closure, sent
down a channel, or matched on later. It is marked `#[must_use]`, so ignoring one
is a warning rather than silence. And the function's signature tells the caller
exactly what can go wrong, which an exception-based signature never does.

The cost is that you write `Ok(...)` on the happy path. That is the entire tax.

## 2. Question marks need somewhere to go

@kind fix
@concept the question mark operator
@expect E0277

The `?` in `port_number` is exactly the right operator to reach for. The
function it is sitting in cannot support it.

Fix the function rather than the operator.

```starter
pub fn port_number(text: &str) -> u16 {
    let n: u16 = text.trim().parse()?;
    n
}

pub fn run() -> Result<u16, std::num::ParseIntError> {
    Ok(port_number(" 8080 "))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_a_padded_port() {
        assert_eq!(run(), Ok(8080));
    }
}
```

```solution
pub fn port_number(text: &str) -> Result<u16, std::num::ParseIntError> {
    let n: u16 = text.trim().parse()?;
    Ok(n)
}

pub fn run() -> Result<u16, std::num::ParseIntError> {
    port_number(" 8080 ")
}
```

@hint `?` returns early with an `Err`. A function that returns a plain `u16` has no way to express "returned early with an error".
@hint Change `port_number`'s return type to `Result<u16, std::num::ParseIntError>`, and wrap the tail expression in `Ok`.
@hint Then `run` no longer needs its own `Ok`, because `port_number` already returns a `Result`.

@diagnose E0277
`the ? operator can only be used in a function that returns Result or Option`,
with a note about `FromResidual`.

`?` is not an unwrap. It expands to roughly:

```rust
match text.trim().parse() {
    Ok(v) => v,
    Err(e) => return Err(From::from(e)),
}
```

That `return Err(...)` is the problem. A function declared `-> u16` can only
return a `u16`; there is no value of that type meaning "this failed". So the
operator is rejected at the function boundary rather than at the call.

Two honest fixes: change the return type, which is what the caller almost
always wants, or handle the error here with `unwrap_or`, `unwrap_or_default` or
a `match`.

@diagnose E0308
Once `port_number` returns a `Result`, `run`'s `Ok(port_number(...))` is wrapping
a `Result` in another `Result`, giving `expected u16, found Result<u16, ParseIntError>`.
Drop the `Ok` and return the call directly.

@after
`?` also works on `Option`, returning `None` early, and the desugaring is the
same shape with no conversion step. What it will not do is cross between the two
on its own: a `?` on an `Option` inside a function returning `Result` is an
error, and `.ok_or(something)?` is how you cross over deliberately.

That refusal is the right default. "This was absent" and "this failed" are
different claims, and the compiler making you write the bridge means you have to
say what the absence *means* in error terms.

## 3. Every way it can fail

@kind fix
@concept Result
@expect E0004

A new failure mode was added to `LoadError` and `explain` was not updated. In a
language with exceptions this would have shipped and produced a stack trace in
production. Here it does not build.

```starter
#[derive(Debug)]
pub enum LoadError {
    Missing(String),
    Denied,
    Corrupt { line: usize },
}

pub fn explain(e: &LoadError) -> String {
    match e {
        LoadError::Missing(path) => format!("no such file: {path}"),
        LoadError::Denied => String::from("permission denied"),
    }
}

pub fn run() -> Vec<String> {
    vec![
        explain(&LoadError::Missing(String::from("app.toml"))),
        explain(&LoadError::Denied),
        explain(&LoadError::Corrupt { line: 12 }),
    ]
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explains_all_three() {
        assert_eq!(
            run(),
            vec![
                String::from("no such file: app.toml"),
                String::from("permission denied"),
                String::from("corrupt at line 12"),
            ]
        );
    }
}
```

```solution
#[derive(Debug)]
pub enum LoadError {
    Missing(String),
    Denied,
    Corrupt { line: usize },
}

pub fn explain(e: &LoadError) -> String {
    match e {
        LoadError::Missing(path) => format!("no such file: {path}"),
        LoadError::Denied => String::from("permission denied"),
        LoadError::Corrupt { line } => format!("corrupt at line {line}"),
    }
}

pub fn run() -> Vec<String> {
    vec![
        explain(&LoadError::Missing(String::from("app.toml"))),
        explain(&LoadError::Denied),
        explain(&LoadError::Corrupt { line: 12 }),
    ]
}
```

@hint One variant has no arm. The test says what its message should be.
@hint A struct-like variant is matched with braces: `LoadError::Corrupt { line } => ...`, which binds `line` for use in the arm.

@diagnose E0004
`non-exhaustive patterns: &Corrupt { .. } not covered`. rustc names the exact
variant you left out and offers to write the arm for you.

`match` is exhaustive by construction. The compiler knows every variant the enum
has, checks that every one is reachable by some arm, and refuses the match
otherwise. That is not pedantry. It is the mechanism that turns "somebody added
an error variant" from a runtime surprise into a build failure, in every place
that handles the type.

Note it works through the reference: `e` is a `&LoadError`, and match ergonomics
let you write the patterns as if it were owned, binding `path` and `line` as
references automatically.

@after
The tempting fix is `_ => String::from("unknown error")`, and on an error enum
it is usually the wrong one. It compiles today and silently absorbs every
variant added tomorrow, swallowing precisely the notification you wanted.

Keep the wildcard for enums you do not own and that are marked
`#[non_exhaustive]`, where new variants are promised and a catch-all is
required. For your own error types, list the variants and let the next addition
break the build in every place that has to care.

## 4. The conversion the question mark performs

@kind fix
@concept From
@expect E0277

`port` reads a number and range-checks it. The range check already produces a
`ConfigError`. The parse produces something else entirely, and `?` is being
asked to bridge the two.

Teach it how.

```starter
#[derive(Debug, PartialEq)]
pub enum ConfigError {
    NotANumber,
    OutOfRange(u32),
}

pub fn port(text: &str) -> Result<u16, ConfigError> {
    let n = text.trim().parse::<u32>()?;
    if n > 65_535 {
        return Err(ConfigError::OutOfRange(n));
    }
    Ok(n as u16)
}

pub fn run() -> (
    Result<u16, ConfigError>,
    Result<u16, ConfigError>,
    Result<u16, ConfigError>,
) {
    (port(" 8080 "), port("http"), port("70000"))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_rejects_and_range_checks() {
        assert_eq!(
            run(),
            (
                Ok(8080),
                Err(ConfigError::NotANumber),
                Err(ConfigError::OutOfRange(70_000)),
            )
        );
    }
}
```

```solution
#[derive(Debug, PartialEq)]
pub enum ConfigError {
    NotANumber,
    OutOfRange(u32),
}

impl From<std::num::ParseIntError> for ConfigError {
    fn from(_: std::num::ParseIntError) -> Self {
        ConfigError::NotANumber
    }
}

pub fn port(text: &str) -> Result<u16, ConfigError> {
    let n = text.trim().parse::<u32>()?;
    if n > 65_535 {
        return Err(ConfigError::OutOfRange(n));
    }
    Ok(n as u16)
}

pub fn run() -> (
    Result<u16, ConfigError>,
    Result<u16, ConfigError>,
    Result<u16, ConfigError>,
) {
    (port(" 8080 "), port("http"), port("70000"))
}
```

@hint Read the note rustc prints at the bottom: `?` performs a conversion on the error value using the `From` trait.
@hint You need `impl From<std::num::ParseIntError> for ConfigError`. The single method is `fn from(e: std::num::ParseIntError) -> Self`.
@hint The test expects the parse failure to become `ConfigError::NotANumber`, so the body can ignore its argument entirely.

@diagnose E0277
`? couldn't convert the error to ConfigError`, then
`the trait From<ParseIntError> is not implemented for ConfigError`, and at the
bottom the sentence that explains the whole operator: *the question mark
operation implicitly performs a conversion on the error value using the `From`
trait*.

That conversion is the difference between `?` and a plain early return, and it
is why `?` composes. The full desugaring is:

```rust
Err(e) => return Err(From::from(e)),
```

so `?` will accept **any** error type that your function's error type knows how
to be built from. Write the `From` impl once and every `?` in the crate that
produces a `ParseIntError` starts working, with no annotation at the call site.

@diagnose E0271
`type mismatch resolving <u32 as FromStr>::Err == ConfigError`. This is the same
problem wearing a different hat, and it appears when you drop the turbofish:
`let n: u32 = text.trim().parse()?;`. With nothing pinning the error type,
inference works backwards from `?` and concludes the parse must fail with
`ConfigError`, which `u32`'s `FromStr` impl does not do. The fix is the same
`From` impl.

@after
This is the mechanism that lets one function call five libraries and return one
error type. Each `?` converts on the way out; the conversions are declared once,
next to the type, rather than repeated at every call.

It also explains `Box<dyn Error>`. That type has a blanket
`impl<E: Error + 'static> From<E> for Box<dyn Error>`, so *every* error already
converts into it and every `?` works with no impls of your own. You have traded
the ability to match on the error for zero boilerplate: a good trade in a
binary, a bad one in a library.

## 5. An error has to be printable

@kind fix
@concept Error trait
@expect E0277

`RetryLimit` is declared to be an error. The `impl` block is empty, which is
allowed, since `std::error::Error` has no required methods. It still will not compile,
because the trait requires something else.

```starter
use std::fmt;

#[derive(Debug)]
pub struct RetryLimit {
    pub attempts: u32,
}

impl std::error::Error for RetryLimit {}

pub fn run() -> String {
    let e = RetryLimit { attempts: 5 };
    format!("{e}")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prints_for_a_human() {
        assert_eq!(run(), "gave up after 5 attempts");
    }
    #[test]
    fn works_as_a_boxed_error() {
        let b: Box<dyn std::error::Error> = Box::new(RetryLimit { attempts: 2 });
        assert_eq!(b.to_string(), "gave up after 2 attempts");
    }
}
```

```solution
use std::fmt;

#[derive(Debug)]
pub struct RetryLimit {
    pub attempts: u32,
}

impl fmt::Display for RetryLimit {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "gave up after {} attempts", self.attempts)
    }
}

impl std::error::Error for RetryLimit {}

pub fn run() -> String {
    let e = RetryLimit { attempts: 5 };
    format!("{e}")
}
```

@hint `trait Error: Debug + Display`. The `Debug` half is derived. The other half is not.
@hint Write `impl fmt::Display for RetryLimit` with the one method `fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result`.
@hint The body is `write!(f, "gave up after {} attempts", self.attempts)`.

@diagnose E0277
`the trait bound RetryLimit: std::fmt::Display is not satisfied`, reported twice:
once at the `impl ... Error` line and once at `format!("{e}")`.

The first is the interesting one. `std::error::Error` is declared
`pub trait Error: Debug + Display`, so `Debug` and `Display` are
**supertraits**: you cannot implement `Error` for a type until both hold. An
empty `impl` block is fine, but the bounds are not optional.

That requirement is the trait's whole contract. `Debug` is what a panic message
and `{:?}` print, aimed at you. `Display` is what a user sees, aimed at them.
Anything generic over `E: Error` (`Box<dyn Error>`, `anyhow`, a logger) relies
on both being there.

@diagnose E0599
`no method named to_string found`. `to_string` comes from `ToString`, which has
a blanket impl for every `T: Display`. With no `Display` there is no `to_string`: the same
missing impl, surfacing somewhere else.

@after
Conventions for a `Display` message, all of which exist because the caller is
going to wrap it:

lowercase, no trailing full stop, and no `Error:` prefix. Say what failed, not
what the program did about it: `gave up after 5 attempts`, not
`Error: Retry limit exceeded!`.

Then implement `source()` when your error wraps another. That builds the chain
`writing the index → opening data.db → permission denied`, and it is what
`anyhow` prints under `Caused by:`.

## 6. Context is the message

@kind fix
@concept anyhow
@expect E0599

An application binary using `anyhow` wants to attach a human-readable
explanation to a low-level error. The call is written correctly; something is
missing above it.

```starter
pub fn parse_port(text: &str) -> anyhow::Result<u16> {
    let n = text.trim().parse::<u16>().context("port must be a number")?;
    Ok(n)
}

pub fn run() -> (u16, String) {
    let ok = parse_port(" 8080 ").unwrap();
    let err = parse_port("http").unwrap_err();
    (ok, format!("{err}"))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn context_replaces_the_raw_message() {
        assert_eq!(run(), (8080, String::from("port must be a number")));
    }
}
```

```solution
use anyhow::Context;

pub fn parse_port(text: &str) -> anyhow::Result<u16> {
    let n = text.trim().parse::<u16>().context("port must be a number")?;
    Ok(n)
}

pub fn run() -> (u16, String) {
    let ok = parse_port(" 8080 ").unwrap();
    let err = parse_port("http").unwrap_err();
    (ok, format!("{err}"))
}
```

@hint `context` is not an inherent method on `Result`. It comes from a trait.
@hint A trait's methods are only callable when the trait is in scope, even though the impl exists.
@hint `use anyhow::Context;` at the top.

@diagnose E0599
`no method named context found for enum Result in the current scope`, and then
the help that gives it away: *items from traits can only be used if the trait is
in scope*, with `use anyhow::Context;` suggested directly.

This is the single most common "missing import" in Rust, and it is worth
understanding rather than pattern-matching. `anyhow` writes
`impl<T, E> Context<T, E> for Result<T, E>`, so the method genuinely exists for
your value. Method resolution only searches traits that are named in the current
module, so an unimported trait's methods are invisible.

The rule exists so that adding a dependency cannot change what an existing
method call in your crate resolves to.

@diagnose E0277
`anyhow::Result<u16>` is an alias for `Result<u16, anyhow::Error>`. If you
changed the signature to a concrete error type, the `?` now has to convert into
that type instead, and no `From` impl exists. Put the signature back.

@after
Look at what the test asserts: the `Display` of the resulting error is
`port must be a number`, and the underlying `invalid digit found in string` has
not vanished; it moved down the chain. Printing with `{:?}`, which is what
`main` does when it returns an `Err`, gives:

```
port must be a number

Caused by:
    invalid digit found in string
```

That is the entire argument for `anyhow` in a binary. `invalid digit found in
string` on its own is a bug report nobody can act on. Add context at every layer
that knows something the layer below did not: which file, which key, which
request.

## 7. From, generated

@kind fix
@concept thiserror
@expect E0271

`thiserror` is already deriving `Display` and `Error` from the attributes. The
`?` on the parse still fails, because one more thing has to be generated and the
attribute that asks for it is missing.

```starter
#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    #[error("bad number: {0}")]
    Number(std::num::ParseIntError),
    #[error("empty input")]
    Empty,
}

pub fn load(text: &str) -> Result<u32, LoadError> {
    if text.trim().is_empty() {
        return Err(LoadError::Empty);
    }
    let n: u32 = text.trim().parse()?;
    Ok(n)
}

pub fn run() -> (u32, String, String) {
    (
        load("42").unwrap(),
        load("").unwrap_err().to_string(),
        load("x").unwrap_err().to_string(),
    )
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn three_outcomes() {
        assert_eq!(
            run(),
            (
                42,
                String::from("empty input"),
                String::from("bad number: invalid digit found in string"),
            )
        );
    }
}
```

```solution
#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    #[error("bad number: {0}")]
    Number(#[from] std::num::ParseIntError),
    #[error("empty input")]
    Empty,
}

pub fn load(text: &str) -> Result<u32, LoadError> {
    if text.trim().is_empty() {
        return Err(LoadError::Empty);
    }
    let n: u32 = text.trim().parse()?;
    Ok(n)
}

pub fn run() -> (u32, String, String) {
    (
        load("42").unwrap(),
        load("").unwrap_err().to_string(),
        load("x").unwrap_err().to_string(),
    )
}
```

@hint `?` needs `From<ParseIntError> for LoadError`. `thiserror` will write it, if you tell it which field wraps the source error.
@hint The attribute goes on the *field*, not the variant: `Number(#[from] std::num::ParseIntError)`.

@diagnose E0271
`type mismatch resolving <u32 as FromStr>::Err == LoadError`, pointing at
`parse`, with `expected LoadError, found ParseIntError`.

The wording is confusing until you see where inference went. `parse` is generic,
`fn parse<F: FromStr>(&self) -> Result<F, F::Err>`, so its error type is
decided by whatever `F` turns out to be. Here `let n: u32` pins `F = u32`, and
then `?` demands that the error be convertible to `LoadError`. With no `From`
impl in sight, the solver tries the only other route: assuming `u32::Err` *is*
`LoadError`. It is not, so you get an equality mismatch rather than a missing
trait bound.

Write the turbofish, `parse::<u32>()`, and the same problem reports as
`error[E0277]: ? couldn't convert the error`, which is the clearer message.
Either way the fix is a `From` impl, and `#[from]` generates one.

@diagnose E0277
`the trait bound LoadError: From<ParseIntError> is not satisfied`. The same
missing conversion, reported directly. `#[from]` on the field generates both the
`From` impl and the `source()` method, so the wrapped error also shows up under
`Caused by:`.

@after
The split between the two crates is the point, and it follows from who reads the
error.

`thiserror` generates impls and disappears. What you ship is a plain enum with
`Display`, `Error` and some `From` impls. Nothing in your public API mentions
the crate, and a caller can still `match` on `LoadError::Empty` and do something
specific. That is what a **library** owes its users.

`anyhow` erases the type into one value with a context chain. A caller cannot
match on it, and does not want to, because the caller is a human reading a
terminal. That is an **application**.

A library returning `anyhow::Error` has taken away its users' ability to handle
anything, and left them matching on strings.

## 8. Absent is not the same as failed

@kind fix
@concept Box dyn Error
@expect E0277

`setting` looks up a key in a config blob. Three things can go wrong and they
arrive as two different shapes: two `Option`s and one `Result`. The function
returns a `Result`, and `?` will not silently bridge the gap.

Make every failure a `Result` failure, and say what each absence means.

```starter
use std::error::Error;

pub fn setting(config: &str, key: &str) -> Result<u16, Box<dyn Error>> {
    let line = config.lines().find(|l| l.trim_start().starts_with(key))?;
    let value = line.split('=').nth(1)?;
    let n = value.trim().parse::<u16>()?;
    Ok(n)
}

pub fn run() -> (u16, String, bool) {
    let cfg = "host = localhost\nport = 8080\nretries = many\n";
    let ok = setting(cfg, "port").unwrap();
    let bad = setting(cfg, "retries").unwrap_err().to_string();
    let missing = setting(cfg, "timeout").is_err();
    (ok, bad, missing)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_reports_and_misses() {
        assert_eq!(
            run(),
            (8080, String::from("invalid digit found in string"), true)
        );
    }
}
```

```solution
use std::error::Error;

pub fn setting(config: &str, key: &str) -> Result<u16, Box<dyn Error>> {
    let line = config
        .lines()
        .find(|l| l.trim_start().starts_with(key))
        .ok_or("no such key")?;
    let value = line.split('=').nth(1).ok_or("line has no value")?;
    let n = value.trim().parse::<u16>()?;
    Ok(n)
}

pub fn run() -> (u16, String, bool) {
    let cfg = "host = localhost\nport = 8080\nretries = many\n";
    let ok = setting(cfg, "port").unwrap();
    let bad = setting(cfg, "retries").unwrap_err().to_string();
    let missing = setting(cfg, "timeout").is_err();
    (ok, bad, missing)
}
```

@hint Two of the three `?` are on `Option`s. Only the `parse` produces a `Result`.
@hint `ok_or(e)` turns `Option<T>` into `Result<T, E>`, supplying the error for the `None` case.
@hint A `&'static str` converts into `Box<dyn Error>` for free, so `.ok_or("no such key")?` compiles as-is.

@diagnose E0277
`the ? operator can only be used on Results, not Options, in a function that
returns Result`, reported once per offending `?`, with the fix in the span:
*use `.ok_or(...)?` to provide an error compatible with
`Result<u16, Box<dyn Error>>`*.

The refusal is deliberate. `None` says a thing is absent; `Err(e)` says an
operation failed and carries a reason. Converting the first into the second
requires inventing that reason, and only you know what it should be. If `?`
picked one for you, every missing key in the program would fail with the same
blank error.

Going the other way is `.ok()`, which throws the error away, and that is also
something you should have to write down.

@diagnose E0599
`no method named ok_or found` usually means it is on the wrong side: `ok_or` is a
method on `Option`, not on `Result`. `config.lines().find(...)` gives an
`Option<&str>`; `parse::<u16>()` already gives a `Result` and needs nothing.

@after
`Box<dyn Error>` earns its place here. It has a blanket
`impl<E: Error + 'static> From<E> for Box<dyn Error>`, plus an impl from `&str`
and `String`, so all three of these error sources convert with no work from you.

The price is that the caller has lost the ability to tell them apart. Every
failure is one opaque box, and distinguishing "no such key" from "not a number"
would mean downcasting or matching on the message. That is fine in a binary,
where the next step is printing a line and exiting. It is not fine in a library,
where the caller may reasonably want to fall back on a missing key and give up
on a malformed one.

The signature you choose is a statement about who is going to read the failure.
