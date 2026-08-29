---
num: 24
slug: 24-macros
title: Macros
accent: plum
concepts: macro, macro_rules, fragment specifier, metavariable, repetition, hygiene, recursion, macro_export, procedural macro, token stream, cargo expand
needs: 09-enums, 13-generics, 14-traits
blurb: Code that runs on syntax before the types exist. That is why it can do four things no function can, and why it is almost never the right answer.
---

%% A function takes values. A generic takes types. A **macro** takes *syntax*: a sequence of tokens, matched and rewritten before the compiler has decided what any of it means. That is the whole difference, and every capability and every hazard follows from it.

`println!` takes any number of arguments of any types and checks its format string at compile time. No function signature in Rust can express that. This is what macros are for, and the list of things they are for is short.

## Where a macro happens

### Before the types exist

:::memory the order of operations
     source text
        │
        ▼  lex
     token stream
        │
        ▼  EXPAND  ◀── macro_rules! and proc macros run here
     token stream (larger)
        │
        ▼  parse
     syntax tree
        │
        ▼  resolve names, check types, borrow check
     MIR ──▶ machine code
:::

A macro sees tokens and produces tokens. It has no idea what a `String` is,
cannot ask whether a type implements `Display`, and cannot see the value of
anything. It matches shapes.

Everything downstream then runs on the *output*, which is why a macro that
generates nonsense gives you an error pointing at code you never wrote.

### The four things a function cannot do

| | function | macro |
|---|---|---|
| variable number of arguments | no | `println!("{} {}", a, b)` |
| take a type as an argument | only as a generic parameter | `vec![0u8; 64]`, `matches!(x, Some(_))` |
| generate items (fns, structs, impls) | no | `#[derive(Debug)]`, `bitflags! { ... }` |
| see the source text of its arguments | no | `stringify!(a + b)` → `"a + b"` |

Those four rows are the entire justification. If your problem is not one of
them, you want a function or a generic.

## macro_rules!

### A matcher and a transcriber

```rust
macro_rules! square {
    ($x:expr) => {
        $x * $x
    };
}

let n = square!(3 + 1);   // 16
```

The left of `=>` is the **matcher**, a pattern over tokens. `$x:expr` is a
**metavariable**: bind whatever parses as an expression here and call it `x`.
The right is the **transcriber**, the tokens to emit with `$x` substituted.

:::compare
**C.** `#define SQUARE(x) x * x` expands `SQUARE(3 + 1)` to `3 + 1 * 3 + 1`,
which is 7. C macros paste text, so everyone learns to write
`((x) * (x))` and to fear the day they forget.

Rust has no such bug and needs no parentheses. Once `3 + 1` has matched `expr`
it is a *parsed expression node*, one opaque unit, and substituting it cannot
change how anything around it groups.
:::

### Fragment specifiers

| specifier | matches | example input |
|---|---|---|
| `expr` | one expression | `1 + 2`, `f(x)?` |
| `ident` | one identifier or keyword | `count`, `Vec` |
| `ty` | one type | `Vec<u8>`, `&'a str` |
| `pat` | one pattern | `Some(n)`, `1..=9` |
| `literal` | a literal, optionally negated | `-3`, `"hi"` |
| `block` | a braced block | `{ n += 1; }` |
| `stmt` | one statement, no trailing `;` | `let x = 1` |
| `path` | one path | `std::io::Result` |
| `tt` | one **token tree**: any token, or a whole bracketed group | anything at all |

The opacity that fixes the C bug is also the trap. An `expr` fragment can be
used where an expression goes and nowhere else. You cannot match inside it
afterwards, and you cannot put it in type position.

:::gotcha
Choosing the wrong specifier gives an error that looks like it is about your
call site, not your macro.

```rust,bad
macro_rules! zeroed {
    ($t:expr) => { <$t>::default() };   // wrong: a type is not an expression
}
zeroed!(u32);
```

The message is `expected type, found expression`, pointing inside the macro body
at a line the reader did not write. `$t:ty` is the fix.

The rule: pick the specifier for the **role the fragment plays in the output**,
not for what the caller happens to type. `u32` is spellable as several
fragments; only `ty` may be used as a type.
:::

`tt` is the escape hatch. It matches one token tree and stays inspectable, which
is what recursive munching macros consume. It also matches almost anything, so
it gives you the worst error messages. Reach for a precise specifier first.

## Repetition

```rust
macro_rules! strings {
    ($($x:expr),* $(,)?) => {{
        let mut v: Vec<String> = Vec::new();
        $( v.push($x.to_string()); )*
        v
    }};
}

let v = strings!["ada", "grace", "alan"];
```

`$( ... ),*` in the matcher means "this group, separated by commas, zero or more
times". In the transcriber, `$( ... )*` repeats the body once per match, and
`$x` inside it means "this iteration's `x`".

| form | means |
|---|---|
| `$(...),*` | zero or more, comma separated |
| `$(...),+` | **one** or more, comma separated |
| `$(...);*` | zero or more, semicolon separated |
| `$(...)*` | zero or more, no separator |
| `$(,)?` | optional trailing comma; add this to every list macro |

The double braces in `{{ ... }}` are worth a look. The outer pair delimits the
transcriber; the inner pair is a real block, which is what lets the expansion be
a single expression with statements inside it.

:::gotcha
A repetition in the transcriber must be over a metavariable bound at the same
depth. `$( v.push($x); )*` works; writing `v.push($x);` without the `$( )*`
gives `variable 'x' is still repeating at this depth`, and wrapping something
that mentions no metavariable gives `attempted to repeat an expression
containing no syntax variables`. Both messages are about depth, not about types.
:::

## Hygiene

This is the property C macros lack, and the reason C macros are dangerous.

```c
#define SWAP(a, b) { int tmp = a; a = b; b = tmp; }

int tmp = 1, x = 2;
SWAP(tmp, x);        // silently wrong: the macro's tmp shadows yours
```

The macro introduced a name, the call site already had that name, and nobody was
told. In Rust it cannot happen:

```rust,bad
macro_rules! bump {
    () => { count += 1; };
}

let mut count = 0;
bump!();              // error[E0425]: cannot find value `count` in this scope
```

:::note
**Identifiers written inside a macro body are resolved where the macro was
defined, not where it was called.** A local introduced by the macro is invisible
to the caller, and a local at the call site is invisible to the macro.
:::

So the macro's `count` and yours are genuinely different identifiers, even though
they are spelled the same. The compiler is not confused; it is telling you the
macro's `count` does not exist anywhere.

### The seam

Hygiene applies to identifiers the macro *wrote*. An identifier **passed in** as
a fragment keeps the call site's context, and refers to the caller's variable:

```rust
macro_rules! bump {
    ($c:ident) => { $c += 1; };
}

let mut count = 0;
bump!(count);         // fine: `count` came from here
count += 0;           // and it is still the same `count`
```

That is the design: the caller decides which of its names the macro may touch,
by naming them. Anything it does not hand over stays its own.

:::gotcha
Hygiene in `macro_rules!` covers local variables and lifetimes. It does **not**
cover types, functions, modules or statics. A macro body naming `Vec` gets
whatever `Vec` means at the call site, which is why generated code writes
`::std::vec::Vec` and `$crate::my_helper` rather than bare paths.
:::

## Recursion

A macro may invoke itself, which is how you process a list one element at a
time when a plain repetition is not enough.

```rust
macro_rules! max_of {
    ($a:expr) => { $a };
    ($a:expr, $($rest:expr),+) => {{
        let r = max_of!($($rest),+);
        if $a > r { $a } else { r }
    }};
}

let m = max_of!(3, 17, 8, 2);   // 17
```

Rules are tried top to bottom, first match wins, so the base case goes first
here only because it cannot match a longer list. Each expansion peels one
element and re-invokes with the rest. The shape is a recursive function's,
except that it runs inside the compiler and leaves a fully unrolled expression
behind.

The cost is real: expansion is not free, and deep recursion is slow to compile.
The limit is 128 nested expansions by default, and hitting it produces
`recursion limit reached while expanding`. You can raise it with
`#![recursion_limit = "256"]` at the crate root. But hitting it usually means
the recursion should have been a repetition, or a loop in a function.

## Scope and export

`macro_rules!` is scoped *textually*: a macro is usable after its definition in
the same file, and inside modules declared after it. Calling one defined lower
down is an error, which surprises everybody once.

`#[macro_export]` changes that completely. It lifts the macro to the **crate
root**, regardless of which module it was written in:

```rust
mod internal {
    #[macro_export]
    macro_rules! retry { /* ... */ }
}

use my_crate::retry;   // imported from the root, not from my_crate::internal
```

That path is the weirdness people trip on: the module it lives in is not part of
its path. And because the macro body is expanded at the *call* site, any path it
mentions must resolve there. Hence `$crate`, a metavariable that expands to the
defining crate's root:

```rust
#[macro_export]
macro_rules! log_it {
    ($msg:expr) => { $crate::internal::write($msg) };
}
```

Without `$crate`, the macro works in its own crate and breaks in every other one.

## When not to write one

Almost always. A macro is opaque to the reader, invisible to rust-analyzer's
better features, awkward in a debugger, and produces errors that point at
generated code.

| you want | reach for |
|---|---|
| the same logic over several types | a **generic** function |
| the same behaviour over several types | a **trait** with a default method |
| a variable number of arguments | a slice or an iterator parameter |
| optional arguments | a builder, or `Option` parameters |
| the same `impl` block for twenty types | a **macro**; this is the real case |

The test: **if a function or a generic can do it, the macro is a worse function
or a worse generic.** Write one when you would otherwise copy an `impl` block
twenty times, when you genuinely need a variable number of arguments, or when
you need a type or an item as an argument.

## Procedural macros

The other kind, described honestly rather than demonstrated, because it cannot
live in the same crate as its users and so cannot be shown in a playground.

A **procedural macro** is an ordinary Rust function that runs at compile time,
takes a `TokenStream`, and returns a `TokenStream`. It is arbitrary code, free
to read files, do arithmetic or call a parser. There are three kinds:

| kind | written as | receives |
|---|---|---|
| derive | `#[derive(Serialize)]` | the tokens of the item it is attached to |
| attribute | `#[tokio::main]` | the attribute's own tokens, and the item's |
| function-like | `sqlx::query!("...")` | whatever is inside the delimiters |

Three constraints matter. It must live in its own crate with
`proc-macro = true` in `Cargo.toml`, because it is compiled for the *host* and
linked into the compiler, not into your program. It cannot be used in the crate
that defines it. And it sees only tokens, so a derive macro cannot look up the
definition of a type you named. That is why `serde` derives generate code which
calls trait methods rather than code that inspects anything.

In practice nobody manipulates a `TokenStream` by hand: `syn` parses it into a
syntax tree and `quote!` builds a new one from a template.

## Debugging expansions

```sh
cargo install cargo-expand
cargo expand              # the whole crate, macros expanded
cargo expand path::to::it # one item
```

This is the tool that makes all of the above tractable. An error inside a
generated `impl` is unreadable until you can see the `impl`, and `cargo expand`
prints exactly what the compiler parsed, `#[derive]` output included.

:::note
**The habit.** When a macro misbehaves, do not read the macro. Expand it, read
the generated code as ordinary Rust, and fix the bug there; then work backwards
to the line of the transcriber that produced it. Nearly every confusing macro
error is an ordinary type error in code you have not looked at yet.
:::
