---
num: 12
slug: 12-errors
title: Error handling
accent: clay
concepts: Result, the question mark operator, From, unwrap, expect, panic, Display, Error trait, Box dyn Error, thiserror, anyhow, unwinding
needs: 09-enums, 10-option
blurb: A recoverable error is a value you return; a bug is a panic. Choosing wrong is the actual mistake, and everything else follows from getting it right.
---

%% Rust has two mechanisms and one decision. The mechanisms are `Result`, a value you return, and `panic!`, which tears the thread down. The decision is which of the two a given failure is. Getting that wrong is the real error-handling bug, and it costs more than any amount of plumbing.

The rule is short. A **recoverable** error is a thing that will happen in normal operation to a correct program: the file is missing, the port is taken, the user typed "seven". A **bug** is a thing that cannot happen unless the code is wrong: an index past the end, an invariant broken, a `None` you had already proven was `Some`.

## Which one is it

### The test

Ask: *could a caller do something sensible about this?*

| situation | it is | why |
|---|---|---|
| config file not found | `Result` | fall back to defaults, or tell the user which path |
| port already bound | `Result` | try another, or exit with a clear message |
| malformed input from the network | `Result` | reject the request, keep serving |
| index 10 of a 3-element slice | panic | no caller can fix this; the code is wrong |
| an invariant you enforce yourself broke | panic | continuing means corrupting data |
| out of memory | abort | there is nothing to do with the news |

The asymmetry that matters: **a `Result` you should have panicked on is
annoying; a panic you should have returned is an outage.** A parser that panics
on bad input is a denial-of-service hole. Bad input is not a bug. It is the
job.

:::note
`Result` is not "the polite way to fail". It is a claim that failure is part of
the function's normal behaviour, and that the caller is expected to decide.

`panic!` is a claim that the program has already left the set of states you
designed for.
:::

:::compare
**Java / Python**: exceptions collapse both cases into one mechanism, so the
distinction lives in a convention (`RuntimeException` vs checked) that nothing
enforces. The practical result is that a signature tells you nothing about what
can go wrong.

**Go**: `if err != nil` is the same idea as `Result`, without the type system
forcing you to look. Ignoring a Rust `Result` is a warning; ignoring a Go
`error` is a blank line.
:::

## Result and the question mark

`Result<T, E>` is an ordinary enum. Nothing magic:

```rust
enum Result<T, E> {
    Ok(T),
    Err(E),
}
```

Because it is a value, an unread one is a warning: that is what `#[must_use]`
buys. Because it is an enum, `match` forces you to name both arms.

### What ? actually does

Matching by hand is correct and unreadable at three calls deep.

```rust
let mut f = match File::open(path) {
    Ok(f) => f,
    Err(e) => return Err(e),
};
```

`?` is that, with one addition:

```rust
let mut f = File::open(path)?;
```

**The addition is the conversion.** `?` desugars to roughly:

```rust
match File::open(path) {
    Ok(v) => v,
    Err(e) => return Err(From::from(e)),
}
```

That `From::from` is the part people do not know, and it is the whole reason `?`
composes.

### Why the From conversion is everything

A function that opens a file *and* parses a number has two error types. Without
conversion, `?` could not be used on both, since the return type can only be one
of them.

```rust
#[derive(Debug)]
enum ConfigError {
    Io(std::io::Error),
    NotANumber(std::num::ParseIntError),
}

impl From<std::io::Error> for ConfigError {
    fn from(e: std::io::Error) -> Self { ConfigError::Io(e) }
}
impl From<std::num::ParseIntError> for ConfigError {
    fn from(e: std::num::ParseIntError) -> Self { ConfigError::NotANumber(e) }
}

fn port(path: &str) -> Result<u16, ConfigError> {
    let text = std::fs::read_to_string(path)?;   // io::Error   → ConfigError
    let n = text.trim().parse::<u16>()?;         // ParseIntError → ConfigError
    Ok(n)
}
```

Two error types go in, one comes out, and the conversion never appears in the
code. Write the `From` impls once and every `?` in the crate widens for free.

:::gotcha
When `?` will not compile, the message is `error[E0277]: the trait bound
From<X> is not satisfied`, or in the older phrasing, `? couldn't convert the
error to Y`.

It is not complaining about `?`. It is telling you the conversion from the
inner error type to your function's error type does not exist. Two fixes: write
the `impl From<X> for Y`, or widen the return type to something that already
accepts everything (`Box<dyn Error>`).
:::

`?` also works on `Option`, returning `None` early. Same shape, minus the
conversion.
The two do not mix: `?` on an `Option` inside a `Result` function is an error,
and `.ok_or(...)` is how you cross over.

## unwrap and expect

### Two panics, one useful

Both panic on `Err`. The difference is what the panic says.

```rust
let n: u16 = text.parse().unwrap();
// panicked at 'called `Result::unwrap()` on an `Err` value: ParseIntError { .. }'

let n: u16 = text.parse().expect("PORT must be a number");
// panicked at 'PORT must be a number: ParseIntError { .. }'
```

`unwrap` in production code leaves you a stack trace and no idea what you were
trying to do. `expect` costs one string literal and turns a 3 a.m. page into a
sentence.

:::note
Write the `expect` message as **why you believed it could not fail**, not what
went wrong.

`.expect("hardcoded regex is valid")` tells the next reader the assumption. It
is a comment the compiler puts in the crash log.
:::

### When it is defensible

Tests, prototypes, examples, and the genuine cannot-happen cases: a literal
parsed at startup, or a `Mutex` lock you would rather die than continue past.
Indefensible: anything driven by input, inside anything that has to stay up.

## Your own error type

### The enum, Display, and Error

An error type is a normal enum. What makes it an *error* is two impls.

```rust
use std::fmt;

#[derive(Debug)]
pub enum ConfigError {
    Missing(String),
    Io(std::io::Error),
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            ConfigError::Missing(k) => write!(f, "missing key `{k}`"),
            ConfigError::Io(e) => write!(f, "reading config: {e}"),
        }
    }
}

impl std::error::Error for ConfigError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            ConfigError::Io(e) => Some(e),
            _ => None,
        }
    }
}
```

- `Debug` is for you: `{:?}`, the panic message, the test output.
- `Display` is for the user: one lowercase line, with no trailing full stop and
  no "Error:" prefix, because the caller adds those.
- `Error` is the interface everything else keys off, and `source()` is the
  chain: "reading config" → "permission denied".

### Box<dyn Error> for applications

Writing that by hand for every error is a lot of typing you do not always need.
In a binary, where the destination is a human and a terminal, erase the type:

```rust
fn load() -> Result<Config, Box<dyn std::error::Error>> {
    let text = std::fs::read_to_string("app.toml")?;
    let port: u16 = text.trim().parse()?;
    Ok(Config { port })
}
```

`Box<dyn Error>` implements `From<E>` for every `E: Error`, so every `?` just
works. You have traded the ability to `match` on the error for zero
boilerplate.

## The two-crate split

Two crates dominate, and the split between them is not fashion. It follows
directly from who reads the error.

| | `thiserror` | `anyhow` |
|---|---|---|
| for | libraries | applications |
| gives you | a `derive` for your enum | one type, `anyhow::Error` |
| the caller is | code, matching on variants | a human, reading a line |
| type stays | concrete and exhaustive | erased |

:::note
**A library's caller needs to match on the error. An application's caller is a
human reading a message.**

That single sentence decides it. A library that returns `anyhow::Error` has
taken away its user's ability to handle anything specifically. All that is left
is matching on strings.
:::

```rust
// library
#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("unexpected `{0}` at byte {1}")]
    Unexpected(char, usize),
    #[error("unterminated string")]
    Unterminated,
}
```

`thiserror` generates the `Display` and `Error` impls, and `#[from]` on a field
generates the `From` too. It is pure code generation. The type you ship is a plain
enum, and the dependency never appears in its public API.

### Context is the product

```rust
// application
fn main() -> anyhow::Result<()> {
    let text = std::fs::read_to_string("app.toml")
        .context("reading app.toml")?;
    let cfg: u16 = text.trim().parse()
        .context("app.toml must contain a port number")?;
    println!("{cfg}");
    Ok(())
}
```

`anyhow::Error` holds any error plus a stack of **error context** strings. That
context is the point: `No such file or directory (os error 2)` is useless, and

```
Error: reading app.toml
Caused by: No such file or directory (os error 2)
```

is a bug report. Add context at every layer where you know something the layer
below did not.

### main returning Result

```rust
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cfg = load()?;
    println!("{}", cfg.port);
    Ok(())
}
```

On `Err`, the runtime prints the error with `Debug` and exits with status 1. It
is `Debug`, not `Display`, which is why `anyhow`'s `Debug` impl is written to
print the whole context chain nicely.

## Panic, up close

### Unwind, then abort

A panic **unwinds** the stack by default: it walks back through every frame,
running the destructor of every live value, and stops the thread. Locks
release, files close, buffers flush. RAII holds under panic, which is why Rust
has no need for `finally`.

The alternative is in `Cargo.toml`:

```toml
[profile.release]
panic = "abort"
```

which stops the process immediately, runs no destructors, and lets the compiler
delete all the landing-pad code. You get a smaller and slightly faster binary,
and no cleanup whatsoever. That is the standard choice for embedded targets, and
for anything where a panic means the process is finished anyway.

:::gotcha
`std::panic::catch_unwind` exists and is not exception handling.

It is for thread and FFI boundaries: a panic crossing into C is undefined
behaviour, so a Rust callback catches it at the edge. Using it as
try/catch fails on three counts: it does not work under `panic = "abort"`, it
cannot catch an abort, and the value it gives you is a `Box<dyn Any>` you must
downcast to learn anything.

If you are reaching for it in ordinary code, the failure was recoverable and
should have been a `Result`.
:::

### Panics in destructors

A panic during unwinding, from a `Drop` impl, aborts the process. There is no
second stack to unwind onto. So a destructor must not panic. Keep `unwrap`
and assertions out of `Drop`.

:::note
**The habit.** Every time you write `unwrap`, say out loud why it cannot fail.
If the sentence is convincing, make it an `expect` and ship the sentence. If it
is not, you have found a `Result`.
:::
