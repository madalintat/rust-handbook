---
unit: 00-toolchain
---

## 1. A use line is not a dependency

@kind fix
@concept cargo

@expect E0432

Somebody added a `use` for a crate that this project has never depended on. A
`use` line only says where a name lives; the `[dependencies]` table in
`Cargo.toml` is what decides which crates exist at all.

You have no manifest here, so take the other road: delete the import and build
the banner with what the standard library already gives you.

```starter
use ansi_paint::bracket;

pub fn banner(name: &str) -> String {
    bracket(name)
}

pub fn run() -> String {
    banner("build")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn brackets_the_name() {
        assert_eq!(run(), "== build ==");
    }
}
```

```solution
pub fn banner(name: &str) -> String {
    format!("== {name} ==")
}

pub fn run() -> String {
    banner("build")
}
```

@hint Nothing in this file can make `ansi_paint` exist. Only a manifest entry could, and there is no manifest.
@hint `format!` builds a `String` from a template. The test says exactly what the output should look like.

@diagnose E0432
`unresolved import ansi_paint` means name resolution walked the crate graph
looking for a crate called `ansi_paint` and found nothing. Read the note rustc
attaches: *maybe a missing crate?* That is the compiler guessing correctly.

Worth being precise about who is at fault here. `rustc` was told which crates
to link when `cargo` invoked it, and cargo builds that list from the
`[dependencies]` table. So this error is almost always a manifest problem
wearing a source-code costume. Adding the `use` line does not download
anything; `cargo add ansi_paint` would, by editing `Cargo.toml` and re-resolving
the graph.

@after
The habit worth forming: when a name will not resolve, decide first whether the
crate is *missing* or *misspelled*. Missing means `cargo add`. Misspelled means
check `Cargo.toml`, because crate names use hyphens on crates.io and underscores
in code: `serde-json` in the manifest is `serde_json` in a `use`.

And before either, ask whether you need the crate at all. A dependency is
permanent: it is compile time on every clean build, a line in your lock file,
and someone else's release schedule.

## 2. Two constants that will not multiply

@kind fix
@concept const

@expect E0308

A retry budget: how long we are prepared to spend in total. The arithmetic is
right and the file still will not build, because the two constants were declared
with different integer types and Rust never widens one for you.

Fix the types so the budget computes. Do not change either value.

```starter
pub const RETRIES: u8 = 3;
pub const TIMEOUT_MS: u16 = 1500;

pub fn budget_ms() -> u16 {
    TIMEOUT_MS * RETRIES
}

pub fn run() -> u16 {
    budget_ms()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn budget_is_total_time() {
        assert_eq!(run(), 4500);
    }
}
```

```solution
pub const RETRIES: u16 = 3;
pub const TIMEOUT_MS: u16 = 1500;

pub fn budget_ms() -> u16 {
    TIMEOUT_MS * RETRIES
}

pub fn run() -> u16 {
    budget_ms()
}
```

@hint `u8` and `u16` are different types, and `*` is only defined between two values of the same type.
@hint A `const` carries the type you wrote and nothing changes it later. Give `RETRIES` the type the multiplication needs.

@diagnose E0308
`expected u16, found u8`. The underline is under `RETRIES`, on the right-hand
side of the `*`, and that placement is the whole message: multiplication is
`Mul<u16> for u16`, so having settled the left operand as `u16` the compiler
now requires the right one to match. It found a `u8` and stopped.

There is no implicit widening in Rust, not even the obviously-lossless
`u8` → `u16`. C would promote silently; Rust makes you write the conversion,
because "obviously lossless" stops being obvious the moment someone changes one
of the types and the promotion quietly starts truncating in the other
direction.

@diagnose E0277
`cannot multiply u16 by u8`, the same disagreement said in trait terms. The `*`
operator is sugar for the `Mul` trait, and `u16` implements `Mul<u16>`, not
`Mul<u8>`. When an operator fails, rustc reports the missing trait
implementation, which is why arithmetic errors sometimes arrive as trait-bound
errors.

@after
Both fixes are legitimate and they say different things. Changing the type of
`RETRIES` says *a retry count is a `u16` in this program*. Writing
`TIMEOUT_MS * RETRIES as u16` says *a retry count is a `u8`, converted here*.
Prefer the first: a cast at every use site is a sign the type was wrong at the
declaration.

Note also what a `const` will not do for you. It never infers. A local can be
`let n = 3;` and let the compiler work out the type from context. Items cannot,
because their type is part of an interface other crates may depend on.

## 3. The build failed before the program ran

@kind fix
@concept constant evaluation

@expect E0080

A sampling window divided into intervals. Nothing here reads a file or takes
input, and yet `cargo check` fails before a test runs or a binary exists.

Make it build, and make the interval come out at 1500 ms.

```starter
pub const WINDOW_MS: u32 = 6_000;
pub const SAMPLES: u32 = 0;
pub const INTERVAL_MS: u32 = WINDOW_MS / SAMPLES;

pub fn run() -> u32 {
    INTERVAL_MS
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn interval_divides_the_window() {
        assert_eq!(run(), 1500);
        assert_eq!(WINDOW_MS / SAMPLES, INTERVAL_MS);
    }
}
```

```solution
pub const WINDOW_MS: u32 = 6_000;
pub const SAMPLES: u32 = 4;
pub const INTERVAL_MS: u32 = WINDOW_MS / SAMPLES;

pub fn run() -> u32 {
    INTERVAL_MS
}
```

@hint The error names the operation, not the line that uses it. Look at what the divisor actually is.
@hint Six seconds of window at 1500 ms per interval is four samples.

@diagnose E0080
`evaluation of constant value failed: attempt to divide by zero`.

The important word is *evaluation*. A `const` initialiser is run by an
interpreter inside rustc at compile time, so `WINDOW_MS / SAMPLES` was actually
executed, with `SAMPLES` at zero, while the compiler was type-checking. What
would have been a runtime panic became a build failure.

That is a genuinely useful trade. The same expression inside a function body
would compile happily and take down the process in production. In a `const` the
compiler is forced to compute the value in order to bake it into the binary, so
it discovers the problem on your machine instead of on the customer's.

@after
This is the mechanism behind a family of pleasant tricks. Because the compiler
runs const initialisers, you can make it check invariants for you:

```rust
const _: () = assert!(WINDOW_MS % SAMPLES == 0);
```

If the assertion fails, the crate does not build. That is a compile-time test
that costs nothing at runtime and runs without a test harness. The anonymous
`const _` is there precisely because you want the evaluation and not the value.

## 4. A tutorial from 2016

@kind fix
@concept edition

@expect E0782

This code was correct Rust once. It has been rejected since the 2021 edition,
and the project you pasted it into is on 2024.

The compiler tells you exactly which word is missing. The interesting part is
why the language decided that word was worth requiring.

```starter
use std::fmt::Display;

pub fn label(value: &Display) -> String {
    format!("[{value}]")
}

pub fn run() -> String {
    label(&7)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn labels_anything_printable() {
        assert_eq!(run(), "[7]");
        assert_eq!(label(&"ok"), "[ok]");
    }
}
```

```solution
use std::fmt::Display;

pub fn label(value: &dyn Display) -> String {
    format!("[{value}]")
}

pub fn run() -> String {
    label(&7)
}
```

@hint A trait is not a type. `&Display` is asking for a reference to a trait, which is not a thing that exists.
@hint The type you want is "some value, unknown at compile time, that implements `Display`", and since 2021 that has to be spelled out loud.

@diagnose E0782
`expected a type, found a trait`. `Display` names a set of behaviours, not a
layout, so `&Display` on its own does not say how big the thing is or where its
methods live. The type you meant is `&dyn Display`: a **trait object**, which is
two pointers wide: one to the value and one to a table of its method
addresses.

Bare `Trait` was accepted in the 2015 and 2018 editions and quietly meant
`dyn Trait`. It was made an error in 2021 because the two readings cost wildly
different amounts. `&dyn Display` is a runtime lookup and `impl Display` is a
compile-time specialisation, and a bare name gave you no clue which one you had
written.

@after
This is what an **edition** is for. The old spelling could not simply be
deleted: millions of lines of published crates use it. So the meaning changed
only for crates that opt in via one line in `Cargo.toml`, and a 2024 crate links
against a 2015 crate with no adapter and no cost, because the edition affects
how source is *read*, not what the compiler emits.

When old sample code fails on a new project and the error mentions a keyword you
did not write, suspect the edition first. `cargo fix --edition` mechanically
applies most of these.

## 5. A feature that is not yours yet

@kind fix
@concept rustup

@expect E0554

Someone found this snippet on an issue thread and pasted it in. The crate has
not compiled since, on a stable toolchain, and the error is not about the code
at all.

Get it building without switching toolchain. The function itself is fine.

```starter
#![feature(int_roundings)]

pub fn pages(items: u32, per_page: u32) -> u32 {
    items.div_ceil(per_page)
}

pub fn run() -> u32 {
    pages(10, 3)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rounds_up() {
        assert_eq!(run(), 4);
        assert_eq!(pages(9, 3), 3);
    }
}
```

```solution
pub fn pages(items: u32, per_page: u32) -> u32 {
    items.div_ceil(per_page)
}

pub fn run() -> u32 {
    pages(10, 3)
}
```

@hint The error is attached to the very first line, not to `div_ceil`.
@hint `div_ceil` was unstable when that snippet was written. It has since been stabilised, so the gate that unlocked it is redundant, and on stable it is forbidden outright.

@diagnose E0554
`#![feature] may not be used on the stable release channel`. This is not a
complaint about your program; it is the stability promise being enforced.

`#![feature(...)]` unlocks a language or library feature that is still being
designed and may change or vanish. If stable accepted it, then "code that
compiles on stable today compiles on stable forever" would be false, and the
whole six-week release train would stop being safe to ride. So rustc refuses
the attribute outright, before it looks at anything else.

Two ways forward. Switch toolchain, with `rustup toolchain install nightly` and
then `cargo +nightly build`. Or find out whether the feature was stabilised,
which is what happened here.

@after
Channels are a schedule, not a quality ladder. A feature lands on nightly,
soaks, rides beta for six weeks, and appears on stable. Nightly is not
"unstable Rust"; it is next year's stable with the gates still on.

The practical rule: build on stable. Reach for nightly deliberately and
temporarily, for a specific tool or a specific unstable API, and pin it with a
`rust-toolchain.toml` so everyone on the project gets the same compiler rather
than whatever they happened to install.

## 6. The loop that changed meaning in 2021

@kind fix
@concept edition

@expect E0614

Another edition seam, and a subtler one, because this code has no obviously
outdated syntax in it. It compiled and ran correctly for years. On the 2021
edition and later it does not compile at all.

Make it total the array.

```starter
pub fn total(counts: [u32; 4]) -> u32 {
    let mut sum = 0;
    for n in counts.into_iter() {
        sum += *n;
    }
    sum
}

pub fn run() -> u32 {
    total([2, 4, 6, 8])
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sums_the_array() {
        assert_eq!(run(), 20);
        assert_eq!(total([0, 0, 0, 1]), 1);
    }
}
```

```solution
pub fn total(counts: [u32; 4]) -> u32 {
    let mut sum = 0;
    for n in counts.into_iter() {
        sum += n;
    }
    sum
}

pub fn run() -> u32 {
    total([2, 4, 6, 8])
}
```

@hint Ask what type `n` has. The `*` is only legal if `n` is a reference.
@hint Before 2021, `array.into_iter()` yielded `&u32`. Since 2021 it yields `u32`: the values themselves, moved out of the array.

@diagnose E0614
`type {integer} cannot be dereferenced`. `n` is already a `u32`; there is
nothing to follow.

The history explains it. Arrays gained `IntoIterator` for by-value iteration
long after `.into_iter()` was in wide use, and for years an array's
`.into_iter()` resolved by auto-reference to the *slice* method, yielding
`&u32`. Fixing that would have broken existing code, so the new behaviour was
tied to an edition: on 2015 and 2018 `array.into_iter()` still yields
references; on 2021 and later it yields values.

So the same expression means two different things depending on one line in
`Cargo.toml`. That is the price of editions, and this is the most-hit example of
it.

@after
Note that `for n in counts`, with no method call at all, has always yielded
values on every edition, and is what you would write today. The `.into_iter()`
here is redundant: `for` calls `IntoIterator::into_iter` for you.

The general lesson is worth more than the specific one. An edition can change
*method resolution*, not just syntax, so a build failure after an edition bump
may point at a line that has not changed and is not wrong. The migration path is
the same either way: `cargo fix --edition` first, then read what it could not
fix.

## 7. It builds in release and not in debug

@kind fix
@concept profile

@expect E0425

`cargo build --release` is clean. `cargo test` fails to compile. Nobody has
edited the file in between, and both commands are running the same compiler on
the same source.

The `#[cfg]` attribute is not a comment. Work out what it did, and make the
function exist in both profiles.

```starter
#[cfg(not(debug_assertions))]
pub fn mode() -> &'static str {
    "release"
}

pub fn run() -> &'static str {
    mode()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_the_profile_it_was_built_in() {
        if cfg!(debug_assertions) {
            assert_eq!(run(), "debug");
        } else {
            assert_eq!(run(), "release");
        }
    }
}
```

```solution
#[cfg(debug_assertions)]
pub fn mode() -> &'static str {
    "debug"
}

#[cfg(not(debug_assertions))]
pub fn mode() -> &'static str {
    "release"
}

pub fn run() -> &'static str {
    mode()
}
```

@hint `#[cfg(...)]` deletes the item it is attached to when the condition is false. In a debug build, `not(debug_assertions)` is false.
@hint You need a second `mode`, gated on the opposite condition, returning `"debug"`. Two functions, two `cfg`s, only one of them ever compiled.

@diagnose E0425
`cannot find function mode in this scope`. And there it is, six lines up, in
plain sight. That is what makes this error confusing the first time.

`#[cfg]` is evaluated before name resolution and physically removes the item
when its predicate is false. `debug_assertions` is set by cargo for the `dev`
profile and unset for `release`, so in a debug build `#[cfg(not(debug_assertions))]`
strips the function out and the call is left pointing at nothing.

The lesson generalises past profiles. Every `#[cfg(target_os = "linux")]`,
`#[cfg(feature = "tls")]` and `#[cfg(test)]` has the same shape: code that is
present in one build configuration and simply absent in another. A function
defined under exactly one arm of a condition is a compile error in the other.

@after
The two profiles differ in more than one symbol. `dev` builds at `opt-level = 0`
with debug symbols, overflow checks that panic, and `debug_assert!` live;
`release` builds at `opt-level = 3`, wrapping overflow, and `debug_assert!`
compiled away. That combination routinely makes release builds 10 to 100 times
faster, which is why a debug-build benchmark is worth nothing.

Since the profile can change which code exists, `cargo check` alone is not proof
that the release build compiles. If you gate anything on `debug_assertions`,
check both.

## 8. The dependency changed its mind

@kind fix
@concept semver

@expect E0061

`cargo update` pulled `netlib` from 1.4 to 2.0 and `connect` grew a required
parameter. That is exactly what a major version bump is allowed to mean, and
your call site is now wrong.

Repair the call. Put the timeout in a named constant rather than a literal
(2000 ms) so the next bump has one place to edit.

```starter
pub mod netlib {
    // netlib 2.0: `connect` now requires an explicit timeout.
    pub fn connect(url: &str, timeout_ms: u32) -> String {
        format!("{url} (timeout {timeout_ms}ms)")
    }
}

pub fn run() -> String {
    netlib::connect("db.internal:5432")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn passes_the_default_timeout() {
        assert_eq!(DEFAULT_TIMEOUT_MS, 2000);
        assert_eq!(run(), "db.internal:5432 (timeout 2000ms)");
    }
}
```

```solution
pub mod netlib {
    // netlib 2.0: `connect` now requires an explicit timeout.
    pub fn connect(url: &str, timeout_ms: u32) -> String {
        format!("{url} (timeout {timeout_ms}ms)")
    }
}

pub const DEFAULT_TIMEOUT_MS: u32 = 2000;

pub fn run() -> String {
    netlib::connect("db.internal:5432", DEFAULT_TIMEOUT_MS)
}
```

@hint Two things are missing: an argument at the call, and a constant to hold it.
@hint The test names the constant it expects. It must be `pub`, it must be at the top level, and a `const` needs its type written out.
@hint `pub const DEFAULT_TIMEOUT_MS: u32 = 2000;`, then pass it as the second argument.

@diagnose E0061
`this function takes 2 arguments but 1 argument was supplied`. rustc underlines
the call, then points at the definition and names the parameter you left out:
`timeout_ms`. Arity is part of a function's type, so there is no defaulting and
no overloading to fall back on.

Read this as a semver event rather than a typo. Adding a required parameter to a
public function breaks every caller, which makes it a **major** change: 1.4 to
2.0, never 1.4 to 1.5. The same applies to adding a public struct field, or a
trait method without a default body.

Nothing moved on its own, either. Cargo pinned 1.4 in `Cargo.lock` and kept
building it until somebody ran `cargo update`.

@after
Rust has no default arguments, and that is deliberate. They interact badly with
type inference and with traits, and they hide arity changes at the call site. The
idiomatic replacements are a builder (`Client::new().timeout(2000).connect(url)`)
or a config struct with a `Default` impl.

Which is why the constant was worth asking for. `DEFAULT_TIMEOUT_MS` gives the
number a name, one definition, and a type; the literal `2000` sprinkled through
six call sites gives you a search-and-replace waiting to go wrong. A `const` is
inlined at every use, so this costs nothing at runtime. The name exists entirely
for the reader.
