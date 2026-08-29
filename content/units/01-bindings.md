---
num: 1
slug: 01-bindings
title: Bindings and mutability
accent: amber
concepts: let, binding, mut, shadowing, const, static, scope, constant evaluation, underscore
needs: 00-toolchain
blurb: Why `let` is not assignment, what shadowing is actually for, and why mutability is a property of the binding rather than of the type.
---

%% `let x = 5;` looks like the first line of every tutorial in every language, and in Rust it means something slightly different. It does not create a variable you can write to. It creates a **binding**: a name attached to a value, immutable unless you say otherwise, live until the end of its scope.

Every rule in this unit exists so the compiler can answer one question cheaply: *can this value change under someone's feet?* Ownership, borrowing and thread safety are all built on the answer.

## let binds a value to a name

### Immutable by default

```rust,bad
let attempts = 0;
attempts = 1;        // error[E0384]: cannot assign twice to immutable variable
```

```rust,good
let mut attempts = 0;
attempts = 1;
```

Most languages make mutability the default and offer `const` or `final` for the
exception. Rust inverts it, for two reasons that are worth separating.

**The compiler gets a guarantee.** An immutable binding cannot change, so the
optimiser may keep it in a register across a function call, and the borrow
checker may hand out any number of shared references to it without further
thought. Immutability is not a lint here; it is information the backend uses.

**You get a signal.** In a forty-line function, `let mut` marks the four values
that move. Everything else is settled. That is a genuine reading aid, and it is
why `mut` appearing on a binding you thought was fixed is worth a second look.

:::gotcha
rustc warns about the reverse too. Declare `let mut n = 5;` and never mutate it
and you get `variable does not need to be mutable`. Unused `mut` is noise, and
the compiler treats it as such.
:::

### Types are inferred, not omitted

```rust
let count = 0;              // i32, the default integer
let count: u8 = 0;          // u8, because you said so
let ratio = 0.5;            // f64
let names = Vec::new();     // error: type annotations needed
let names: Vec<String> = Vec::new();
```

Rust infers a binding's type from its initialiser *and* from how it is used
later in the function — a Hindley-Milner style inference, not C++'s `auto`,
which only looks rightwards. `let mut v = Vec::new();` followed by
`v.push("hi")` compiles fine: the `push` fixed the element type. The annotation
is only needed when nothing in the function pins it down.

:::compare
**Python** — `x = 5` creates or rebinds a name in a mutable namespace, and
`x = "five"` on the next line is ordinary. In Rust the second line is either an
error or a new binding; see shadowing below.

**C++** — `auto x = 5;` is mutable; you write `const auto` for the common case.
Rust's `let` is closer to `const auto`, and `let mut` is `auto`.
:::

## mut is a property of the binding

This is the single most useful sentence in the unit: **`mut` is not part of the
type.** `i32` and `mut i32` are not two types. There is one type, and two kinds
of binding to it.

```rust
let a = 5;
let mut b = a;    // same type, different permission
b += 1;
```

Which is why a value can pass in and out of mutability as it moves:

```rust
fn shout(mut s: String) -> String {   // takes ownership, and takes it mutably
    s.push('!');
    s
}

let greeting = String::from("hi");    // immutable here
let loud = shout(greeting);           // mutable in there
```

Nothing about the `String` changed. The new owner declared a different intent.

:::note
Mutation needs a `mut` binding *and* unique access. `let mut` gets you the
first. `&mut` gets you the second, and the rule that there may only ever be one
of those at a time is the subject of unit 6.
:::

```rust,bad
let config = Vec::new();
config.push("verbose");   // error[E0596]: cannot borrow as mutable
```

Read that error carefully, because it is not saying `push` is forbidden.
`push` takes `&mut self`, so calling it requires a mutable borrow of `config`,
and you cannot take a mutable borrow of a binding that never asked for one. The
fix is one word at the declaration, not at the call.

## Shadowing

### A second binding, not an assignment

```rust
let spaces = "   ";
let spaces = spaces.len();     // now a usize. Legal.
```

This is not mutation. It is a **new binding** that happens to reuse the name.
The old one still exists — it is what the right-hand side just read — it is
merely no longer reachable by that name.

:::memory two bindings, one name
        STACK  (frame)
      ┌────────────────────────┐
      │ "   "  &str, 16 bytes  │  ◀── first `spaces`, still here,
      ├────────────────────────┤       still dropped at end of scope
      │ 3      usize, 8 bytes  │  ◀── second `spaces`, what the name means now
      └────────────────────────┘
:::

Three consequences follow from "new binding":

| | mutation (`x = ...`) | shadowing (`let x = ...`) |
|---|---|---|
| can change the type | no | yes |
| needs `mut` | yes | no |
| old value | overwritten | still alive, just unnamed |

The type change is the point. The canonical use is parse-and-rename, where the
intermediate form has no business surviving:

```rust
let port = std::env::var("PORT").unwrap();   // String
let port: u16 = port.trim().parse().unwrap(); // u16, same name
```

Without shadowing you would invent `port_str`, and then spend the rest of the
function making sure you never used the wrong one. Shadowing removes the wrong
one from the namespace entirely.

:::gotcha
Shadowing is scoped, and a shadow inside a block dies with the block:

```rust,bad
let level = "3";
{
    let level: u32 = level.parse().unwrap();
}
let doubled = level * 2;   // error[E0369]: cannot multiply `&str`
```

Outside the block the name means the `&str` again. This is the one way
shadowing genuinely misleads people, and it is also exactly why it is safe:
a shadow cannot leak out of the scope that introduced it.
:::

## const and static

Both are compile-time items with a written type. They differ in what exists at
runtime.

```rust
const MAX_RETRIES: u32 = 5;              // a value, inlined at each use
static BANNER: &str = "myapp v0.1";      // a place, one address, whole program
```

:::memory const is copied, static is pointed at
    const MAX_RETRIES               static BANNER
    ┌───────────────┐               ┌──────────────────┐
    │ no storage    │               │ 0x5555_0100      │ ◀── one address
    └───────────────┘               │ "myapp v0.1"     │     for the program
      5 substituted                 └──────────────────┘
      into every use site,            &BANNER is the same
      like a macro would              pointer everywhere
:::

That difference decides which to use. A `const` may be duplicated freely, so it
is right for numbers, limits, and small strings. A `static` has an identity —
`&BANNER` is a real `&'static` reference to one location — so it is right when
you need an address, or a large table you do not want copied into fifty call
sites.

:::gotcha
`static mut` is a global mutable — the one thing Rust's whole model exists to
prevent. Touching one is `error[E0133]`, unsafe, because nothing stops two
threads writing it at once. The stable answer is a `static` of an atomic or a
`Mutex`, both of which are `Sync` and need no `unsafe`:

```rust
use std::sync::atomic::{AtomicU32, Ordering};
static HITS: AtomicU32 = AtomicU32::new(0);
HITS.fetch_add(1, Ordering::Relaxed);
```
:::

### Why both need an explicit type

```rust,bad
const LIMIT = 4;      // error: missing type for `const` item
```

Inference is a per-function analysis. A `const` is an item, visible to the whole
crate and to other crates, so its type is part of a public interface that no
single function's body may decide. The same applies to `static` and to `fn`
signatures: **items are always annotated, locals almost never are.**

### Constant evaluation

The initialiser must be computable by the compiler, which runs a small
interpreter over it at compile time.

```rust,bad
fn width() -> usize { 4 }
const PAD: usize = width();   // error[E0015]: cannot call non-const function
```

```rust,good
const fn width() -> usize { 4 }
const PAD: usize = width();   // fine — and `width()` still works at runtime
```

`const fn` marks a function the interpreter is allowed to run. It is not a
promise that it *will* be — the same `const fn` called in ordinary code is an
ordinary call.

A const that cannot be evaluated is a hard error, not a runtime panic:

```rust,bad
const SLICE: i32 = 10 / 0;   // error[E0080]: attempt to divide by zero
```

That failure happens during `cargo check`. Arithmetic that would panic at
runtime becomes a build failure when it is in a const — the compiler is
running the code, and refusing to bake in a result it could not compute.

## Scopes, blocks and deferred initialisation

A block is a scope. Bindings die at its closing brace, in reverse order of
declaration, and the block itself is an expression whose value is its final
line without a semicolon:

```rust
let size = {
    let w = 8;
    let h = 4;
    w * h            // no semicolon: this is the block's value
};                   // w and h are gone here
```

You may also declare a binding and initialise it later. The compiler tracks
initialisation **per control-flow path**:

```rust,good
let label;
if n < 0 {
    label = "negative";
} else {
    label = "zero or more";
}
println!("{label}");
```

Drop the `else` and it becomes `error[E0381]: used binding is
possibly-uninitialized`, naming the path where nothing was assigned. Note what
this is not: there is no default value, no null, no zeroing. A binding that has
not been written on some path simply cannot be read on that path.

:::gotcha
Deferred initialisation still assigns exactly once. `label = "x"` on two
branches is fine — only one runs. `label = "x"` twice on the *same* path is
`E0384` again, because the binding was not declared `mut`.
:::

## The two underscores

They look related. They are not.

```rust
let _count = expensive();   // a real binding. Named `_count`. Warning suppressed.
let _ = expensive();        // not a binding at all. Value dropped immediately.
```

`_name` binds normally and lives to the end of scope; the leading underscore
only tells rustc you know it is unused. Bare `_` is a pattern that matches
anything and stores nothing, so the value it matched has no owner and is
**dropped on that line**.

:::gotcha
```rust,bad
let _ = mutex.lock();        // locked and unlocked. On this line. Useless.
```

```rust,good
let _guard = mutex.lock();   // held to the end of the scope. What you meant.
```

One underscore, one character apart, and the difference between a critical
section and no critical section. It has ended real production incidents. The
same shape catches people with file handles, spans, and profiling timers —
anything whose value is its `Drop`.
:::

`let _ = ...` is genuinely useful for the opposite purpose: deliberately
discarding a `#[must_use]` result you have decided to ignore, where a bare
`expensive();` would warn. Used on purpose it says *I read this and I mean it*.
