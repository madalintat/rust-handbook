---
num: 25
slug: 25-diagnostics
title: Reading the compiler
accent: ferris
concepts: diagnostic, error code, primary span, secondary span, note, help, lint, clippy, minimal reproduction, rustc explain
needs: 05-ownership, 06-borrowing, 12-errors, 14-traits, 15-lifetimes
blurb: Every other unit teaches a topic. This one teaches the skill that makes the next error survivable, including the ones this book never covers.
---

%% Rust's error messages are the best teacher in the language, and almost nobody is taught to read them. People skim for the red line, guess, paste the `help:` suggestion, and move on. That works often enough that the habit never forms. A diagnostic is a structured argument with a claim, evidence, and a proposed remedy, and each part is in a fixed place.

Learn the shape once and every future error becomes a puzzle with a method rather than a wall.

## Anatomy of a diagnostic

### One error, dissected

```rust,bad
let mut names = vec![String::from("ferris")];
let first = &names[0];
names.push(String::from("corro"));
println!("{first}");
```

That produces this, exactly:

```text
error[E0502]: cannot borrow `names` as mutable because it is also borrowed as immutable
 --> src/main.rs:4:5
  |
3 |     let first = &names[0];
  |                  ----- immutable borrow occurs here
4 |     names.push(String::from("corro"));
  |     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ mutable borrow occurs here
5 |     println!("{first}");
  |                ----- immutable borrow later used here

For more information about this error, try `rustc --explain E0502`.
```

Every line has a job:

| line | what it is |
|---|---|
| `error[E0502]` | **severity** and a stable **error code** you can look up |
| `cannot borrow ... as mutable` | the **claim**: one sentence, always true, never the whole story |
| `--> src/main.rs:4:5` | file, line, column of the *primary* span |
| the `\|` gutter | your source, quoted back with real line numbers |
| `^^^^` | the **primary span**: where the compiler stopped |
| `----` | a **secondary span**: another place that participates |
| `For more information` | the code has a page with a worked example |

### Primary versus secondary

This is most of the skill and hardly anyone is told it.

:::note
`^^^^` marks where the compiler **gave up**. `----` marks the other facts that
made giving up necessary. The bug is at the primary span perhaps half the time;
the rest of the time it is at one of the secondaries, and the primary is only
the first place the consequence became visible.
:::

In the E0502 above, `names.push(...)` carries the carets, but `push` is not
wrong. It is wrong *given* line 3 and line 5. Delete line 5 and the same `push`
compiles, because the borrow made on line 3 would then end before it. Three
markers, one story: a borrow starts, a conflicting one begins, and the first is
still needed afterwards.

The label on the last secondary, `immutable borrow later used here`, is the one
to read first in every borrow error. It is the compiler telling you which
use is keeping the borrow alive, and shortening or moving that use is usually the
whole fix.

### note and help are different things

`note:` is a **fact** the compiler wants you to have. It is always true and
requires nothing of you: `move occurs because s has type String, which does not
implement the Copy trait`, or `required by a bound in collect`. Notes are where
the actual explanation lives.

`help:` is a **suggestion**, sometimes with a concrete diff:

```text
help: trait `Write` which provides `write_fmt` is implemented but not in scope
  |
1 + use std::io::Write;
  |
```

:::gotcha
`help:` is a guess, and it optimises for making the error go away rather than
for making your program right. When it suggests `.clone()`, it is proposing an
allocation to end an argument about ownership you have not had yet. When it
suggests `&` on an argument, it may be papering over a function signature that
wants changing.

Following `help:` blindly is exactly how codebases end up with `.clone()` on
every line. Read the `note:` first, decide what you meant, and *then* look at
whether help agrees.
:::

## Read the first error

Later errors are frequently consequences of the first. One wrong type
annotation makes every downstream expression the wrong type, and rustc dutifully
reports all of them.

```text
error[E0308]: mismatched types
 --> src/main.rs:3:18
  |
3 |     let n: i32 = path.to_str().unwrap();
  |            ---   ^^^^^^^^^^^^^^^^^^^^^^ expected `i32`, found `&str`
  |            |
  |            expected due to this

error[E0599]: no method named `push` found for type `i32` in the current scope
```

The E0599 is not a second bug. `n` is only an `i32` because of the annotation on
line 3; fix that and the second error changes or vanishes. Chasing it first
means debugging a phantom.

:::note
**Fix the first error, re-run, and look again.** Five errors regularly collapse to
one. This single habit saves more time than any other in this unit.
:::

Scroll up. Terminals show you the *end* of the output: the summary line and the
last error, which is the least useful one. `cargo check 2>&1 | head -40` is a
reasonable reflex, and `cargo check` is several times faster than `cargo build`
because it stops before code generation.

## The codes you will actually meet

Around five hundred codes exist. These are the ones that will take up your
first year.

| code | what the compiler is really objecting to |
|---|---|
| **E0382** | you used a value after giving it away |
| **E0505** | you moved a value while a reference to it was still live |
| **E0502** | a shared and a unique borrow of one value overlap |
| **E0499** | two unique borrows of one value overlap |
| **E0596** | you asked for `&mut` from something not declared `mut` |
| **E0507** | you tried to move a field out of something you only borrowed |
| **E0509** | same, but the type has a `Drop` impl, so it is doubly forbidden |
| **E0106** | the output borrows from *something* and the signature does not say what |
| **E0515** | you returned a reference to a local, which is about to stop existing |
| **E0597** | a borrow outlives the thing it points at |
| **E0621** | a lifetime is needed on an input to justify the one on the output |
| **E0308** | expected one type, found another; by far the most common of all |
| **E0277** | a required trait is not implemented for this type |
| **E0599** | no such method **in scope**; usually a missing bound or `use` |
| **E0433** | a path does not resolve; the crate or module is not where you said |
| **E0425** | a name is not in scope: typo, wrong module, or declared after use |
| **E0061** | wrong number of arguments |
| **E0004** | a `match` does not cover every case |
| **E0005** | a `let` pattern is refutable: it can fail, and `let` cannot |
| **E0603** | the item exists but is private |
| **E0428** | two definitions with the same name in one scope |
| **E0117** | the **orphan rule**: neither the trait nor the type is yours |
| **E0119** | two impls of one trait for one type, which **coherence** forbids |
| **E0133** | this operation requires an `unsafe` block |

Six groups: ownership and borrows, lifetimes, types and traits, patterns, items
and visibility, unsafe. Knowing which group a code belongs to already tells you
which question to ask.

## Three that mean something other than what they say

### E0599: "no method named X found"

Reads like a typo report. Almost never is one. It has three causes, and the
`help:` line distinguishes them:

| the help says | the real problem |
|---|---|
| `consider restricting type parameter T` | a **trait bound** is missing on a generic |
| `items from traits can only be used if the trait is in scope` | you need a `use` |
| `there is a method with a similar name` | it genuinely is a typo |

```rust,bad
fn summarise<T>(items: &[T]) -> String {
    items.iter().map(|i| i.describe()).collect::<Vec<_>>().join(", ")
}
```

`Retry` implements `Describe`. Irrelevant: inside `summarise` the compiler knows
only what the signature declared about `T`, which is nothing, so `T` might be
`u8` and `u8` has no `describe`. The fix is `<T: Describe>`, which is a promise
rather than a cast.

The second cause catches everyone once: `write!(f, "hi")` on a `File` fails with
E0599 until `use std::io::Write;` is at the top. The method was always
implemented. You had not imported the vocabulary to name it.

### E0277: "the trait bound is not satisfied"

True but unhelpfully abstract. In practice it usually means one of:

- you passed an owned value where a reference was wanted, or the reverse
- you are printing with `{}` a type that only has `Debug`
- you used `?` on an `Option` in a function returning `Result`
- you asked `collect` for a container it cannot build from that iterator

:::gotcha
The line to read is `note: required by a bound in ...`. It names *who* wanted
the trait, usually a standard library function several layers down. Without it
you are guessing at which of your types is the guilty one; with it, the
requirement has an address.
:::

### E0106: "missing lifetime specifier"

Sounds like you forgot to type `'a` somewhere. It is a question: **which input
does the output borrow from?**

```rust,bad
fn longer(a: &str, b: &str) -> &str {
    if a.len() >= b.len() { a } else { b }
}
```

**Lifetime elision** normally answers this silently: one input reference, or a
`&self`, and the output borrows from it. Two candidates and no `self` is exactly
the case the rules refuse to guess, because guessing wrong would let a caller
hold a dangling reference. `<'a>(a: &'a str, b: &'a str) -> &'a str` is not
decoration; it is the claim *the result lives no longer than the shorter input*,
which the compiler then enforces at every call site.

## Warnings are not noise

A warning is the compiler saying "this compiles and I do not believe you meant
it".

| lint | what it usually indicates |
|---|---|
| `unused_variables` | a typo, or a parameter you forgot to use |
| `unused_must_use` | **an ignored `Result`**, a real bug class |
| `dead_code` | an item nothing reaches: a stale branch, or a missing `pub` |
| `unused_mut` | the `mut` is wrong, or the mutation you intended is missing |

`unused_must_use` is the one that earns its place. `writeln!(f, "...")` returns
`Result`. So does `File::flush`. Dropping that `Result` on the floor is how data
silently fails to reach disk, and `#[must_use]` on `Result` turns it into a
visible warning rather than a support ticket.

Every lint has three levels you can set with an attribute:

```rust
#[allow(dead_code)]              // silence it here
#[warn(clippy::needless_range_loop)]
#[deny(unused_must_use)]         // make it an error
```

Prefer the narrowest scope that works, on the item rather than the crate, and
leave a comment saying why. A crate-wide `#![allow(dead_code)]` hides the next real one.

:::gotcha
`#![deny(warnings)]` in a published crate is a trap. New rustc releases add new
lints, so code that built clean in April fails to build in July, for everyone
depending on you, on a compiler you never tested against. Nothing about their
program changed.

Put `-D warnings` in CI instead. Same enforcement, and it fails your build rather
than your users'.
:::

### Clippy

`cargo clippy` is a second reviewer with opinions rustc deliberately does not
have. It ships with the toolchain and knows around seven hundred lints.

| lint | what it catches |
|---|---|
| `needless_range_loop` | `for i in 0..v.len()` where `for x in &v` reads better |
| `redundant_clone` | a `.clone()` whose result is dropped or never aliased |
| `or_fun_call` | `unwrap_or(expensive())` is eagerly evaluated; use `unwrap_or_else` |
| `large_enum_variant` | one huge variant making every value of the enum huge |
| `collapsible_if` | nested `if`s that are one `&&` |

`cargo clippy --fix` applies the mechanical ones. Treat the rest as suggestions
from a colleague who has not read your requirements: usually right, occasionally
missing context, and `#[allow(...)]` with a reason is a legitimate answer.

## An error you have never seen

Most of them, at first. The procedure is the same every time.

:::note
1. **Read the headline as a claim.** "You cannot borrow `names` as mutable."
   That is an assertion about your program, not a category.
2. **Find the primary span.** The `^^^^` and the `-->`. This is where the
   compiler stopped, which is not necessarily where you went wrong.
3. **Ask what would have to be true for the claim to hold.** For E0502: some
   other borrow must still be live. Where is it?
4. **Check the secondary spans and the notes for that belief.** They are the
   evidence. Every `----` is one of the compiler's reasons.
5. **Only now read `help:`**, and judge whether it fixes your problem or only
   its symptom.
:::

Two moves are left when that is not enough.

`rustc --explain E0502` prints a page with a minimal broken example, a fixed one,
and the rule. It is offline, instant, and better written than most blog posts.
The same content is the online **error index**, which is searchable and worth
skimming end to end once.

**A minimal reproduction** is the strongest move you have. Copy the failing
function into an empty file or the playground and delete everything that is not
required to keep the error. Half the time the error disappears while deleting,
and the last thing you removed was the cause. The other half you are left with
ten lines you can actually reason about, plus a question worth asking someone
else, because you have already done the work of removing the noise.

:::compare
**C++.** You have learned to skim template errors for the one line naming your
type, because the rest is instantiation backtrace. That skimming instinct is
counterproductive here: rustc's secondary spans and notes are hand-written for
this specific case, and they are the part with the answer in it.

**Python / Java.** A stack trace tells you where a program *was* when it broke.
A diagnostic tells you what the compiler *could not prove* before it ever ran.
There is no "line that threw"; there is a claim and its evidence.
:::

The reason this unit exists: you will meet errors this book never covers, in
crates that did not exist when it was written. The codes change. The anatomy
does not.
