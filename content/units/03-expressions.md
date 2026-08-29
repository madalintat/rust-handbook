---
num: 3
slug: 03-expressions
title: Expressions and blocks
accent: amber
concepts: expression, statement, tail expression, block, if expression, match expression, loop, break value, never type, precedence
needs: 01-bindings, 02-types
blurb: Almost everything produces a value, which is why `if` can be assigned from — and why one stray semicolon turns a block into nothing at all.
---

%% In C, `if` is a statement and `x = cond ? a : b` is a separate, weaker construct bolted on beside it. In Rust there is no ternary operator, because there is no need for one: `if` already produces a value. So does `match`, so does `loop`, so does any block in braces.

That single design decision explains a surprising amount, including the error that confuses more new Rust programmers than any other: adding a semicolon changed the type of a function.

## Expressions and statements

### The distinction, and the only two statements

An **expression** produces a value. A **statement** does something and produces
nothing. Rust has only two kinds of statement:

```rust
let n = 5;                      // a let statement
fn helper() {}                  // an item declaration
```

Everything else you write is an expression, sometimes with a semicolon after it
to discard its value. `5`, `a + b`, `f(x)`, `if c { 1 } else { 2 }`,
`match x { .. }`, `loop { .. }`, `{ .. }`, `"hi".to_string()` — all expressions.

```rust
let x = 5;                      // statement; the `5` inside it is an expression
let y = { let a = 2; a * 3 };   // the block is an expression, worth 6
let z = if y > 5 { "big" } else { "small" };
```

:::note
A block `{ ... }` evaluates its contents in order and takes the value of its
**last expression, if that expression has no semicolon**. That final expression
is the block's **tail expression**. With a semicolon, or with nothing at all, the
block is worth `()`.
:::

### `let` is a statement, and that has consequences

```rust,bad
let x = (let y = 5);            // error: `let` expressions are not supported here
let a = let b = 3;              // same
```

C allows `a = b = 3` because assignment there is an expression yielding the
assigned value; that is the same rule that lets `if (x = 0)` compile in C and
lets a typo become a bug. In Rust `let` is a statement and plain assignment
evaluates to `()`, so neither shape exists to be got wrong.

## The semicolon

### One character, two different types

This is the whole thing:

```rust
fn double(n: i32) -> i32 {
    n * 2                       // tail expression → the block is worth n * 2
}
```

```rust,bad
fn double(n: i32) -> i32 {
    n * 2;                      // error[E0308]: mismatched types
}                               // expected `i32`, found `()`
```

The semicolon does not "end the line". It turns an expression into a statement
and **throws its value away**. With the value thrown away the block has no tail
expression, so it is worth `()`, so the function body's type is `()`, so it
does not match the `-> i32` you promised.

```
    n * 2       is an expression      value: i32
    n * 2;      is a statement        value: ()   ← discarded
```

Read the error in that order and it stops being mysterious:

```
error[E0308]: mismatched types
 --> src/lib.rs:1:26
  |
1 | fn double(n: i32) -> i32 {
  |    ------            ^^^ expected `i32`, found `()`
  |    |
  |    implicitly returns `()` as its body has no tail expression
2 |     n * 2;
  |          - help: remove this semicolon to return this value
```

The caret is on the **return type**, not on the semicolon, because the return
type is the claim rustc is checking. The `help` at the bottom is the fix, and
rustc is right about it far more often than not.

:::gotcha
The same error, in the shape that actually catches people: the last arm of an
`if`, or a `match` arm, or a block being assigned from.

```rust,bad
let label = if n > 10 {
    "big";                      // ← this one
} else {
    "small"
};
```

`error[E0308]: if and else have incompatible types` — the `if` branch is `()`
and the `else` branch is `&str`. One semicolon, and the branches stopped
agreeing.
:::

### When you *want* the semicolon

`()` is a real type with a real use. A function that returns nothing genuinely
returns `()`, and every statement inside its body should end in a semicolon.

```rust
fn log(msg: &str) {             // sugar for -> ()
    println!("{msg}");          // println! returns (); the semicolon is correct
}
```

The rule to carry: **a semicolon on the last line means "this function produces
nothing".** If it produces something, the last line has no semicolon.

## if, match and loop are expressions

### if

```rust
let level = if retries == 0 {
    "clean"
} else if retries < 3 {
    "flaky"
} else {
    "broken"
};
```

Both — all — arms must have the same type, because the `if` has one type and the
compiler must know it without running the program.

```rust,bad
let n = if ok { 1 } else { "one" };   // error[E0308]: expected integer, found `&str`
```

An `if` with no `else` is worth `()`, so its `if` branch must be `()` too. Ask
for a value from an `else`-less `if` and you get `error[E0317]`.

```rust,bad
let n = if ok { 1 };   // error[E0317]: `if` may be missing an `else` clause
```

That is not a limitation, it is arithmetic: with no `else`, there is a path
through the code that produces nothing, and "nothing" is not an `i32`.

### match

```rust
let bytes = match unit {
    "kb" => 1024,
    "mb" => 1024 * 1024,
    _    => 1,
};
```

Same rule, same reason: every arm's value is the `match`'s value, so every arm
has the same type. Note the semicolon after the closing brace — the `match` is
the tail of a `let` statement, and the statement ends there.

### loop, and break with a value

`while` and `for` always evaluate to `()`, because a loop that ends by its
condition failing has no value to offer. `loop` is different: it can only end
with `break`, so `break` can carry a value out.

```rust
let mut attempt = 0;
let connection = loop {
    attempt += 1;
    if let Some(c) = try_connect() {
        break c;                     // this is the value of the whole loop
    }
    if attempt == 5 {
        break fallback();
    }
};
```

This is the idiomatic retry shape. The alternative — declaring `let mut
connection = None;` before the loop and unwrapping it after — needs an `Option`
that only exists to carry a value across a scope boundary, plus an `unwrap` that
can never fire.

## Blocks as expressions

### Scoping a temporary

Because a block is an expression, you can use one anywhere a value goes, and
anything declared inside it is gone at the closing brace.

```rust
let checksum = {
    let mut file = File::open(path)?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)?;
    crc32(&buf)                       // tail expression
};
// file and buf no longer exist here
```

:::memory the block's value survives; its locals do not
     ┌─ block ─────────────────────────┐
     │  let mut file = ...             │
     │  let mut buf  = ...             │   dropped at `}`, reverse order
     │  crc32(&buf)   ──── value ──────┼──▶  checksum : u32
     └─────────────────────────────────┘
:::

Two things come free: the reader can see that `buf` is scratch, and a lock or a
file handle is released at a point you chose rather than at the end of the
function.

:::compare
**Python** — a `for` or `if` body is not a scope, so a name bound inside one
leaks out and is still there afterwards. In Rust the braces are the scope,
always, and the value the block produces is the only thing that escapes.
:::

## The never type

`!` is the type of an expression that does not produce a value because control
never comes back. `panic!`, `todo!`, `unreachable!`, `process::exit`, `return`,
`break` and `continue` all have it.

A value of type `!` can never exist, so the compiler is free to let `!` coerce to
*any* type — there is no value that could contradict the claim.

```rust
let port: u16 = match env::var("PORT") {
    Ok(s) => s.parse().unwrap(),
    Err(_) => panic!("PORT is not set"),   // ! coerces to u16
};
```

That coercion is why `todo!()` lets a half-written program compile, and why a
`return` inside one arm of an `if` does not break the other arm's type:

```rust
let name = match user {
    Some(u) => u.name,
    None => return Err(Error::NoUser),     // ! coerces to String
};
```

### Which is why `return` is rare

`return` exists for early exit, and that is all it should be used for. The last
expression of a function *is* its return value, so writing `return x;` on the
last line adds a keyword and a semicolon and says nothing new.

```rust
fn classify(n: i32) -> &'static str {
    if n < 0 { return "negative"; }        // early exit: fine
    if n == 0 { "zero" } else { "positive" }   // tail: no return, no semicolon
}
```

## Two sharp edges

### Precedence

Method calls and `as` bind tighter than anything else, `..` binds very loosely,
and — unlike C — the bitwise operators bind *above* comparison.

| written | grouped as |
|---|---|
| `a as u64 * b` | `(a as u64) * b` |
| `-x.abs()` | `-(x.abs())` — the method wins, so this is −1 for `x = -1` |
| `*p + 1` | `(*p) + 1` |
| `1..n + 1` | `1..(n + 1)` |
| `flags & mask == mask` | `(flags & mask) == mask` |

:::compare
**C** — that last row is the famous C bug. There `&` binds *below* `==`, so
`flags & mask == mask` means `flags & (mask == mask)`, which is `flags & 1`, and
it compiles silently and answers the wrong question. Rust reordered the table so
the line means what it looks like.

Every C precedence habit that survives is still worth re-checking once. The
shift operators are also above `&` here, so `1 << n | 1` groups as
`(1 << n) | 1`.
:::

### `{` after a keyword is a block, not a struct literal

In a place where a block could start — the condition of an `if` or `while`, the
scrutinee of a `match`, the iterable of a `for` — Rust reads `{` as the start of
the body, so a struct literal there is a parse problem.

```rust,bad
if config == Config { retries: 3 } {      // parsed as: if config == Config {
    ...                                   // then `retries: 3` makes no sense
}
```

```rust,good
if config == (Config { retries: 3 }) {
    ...
}
```

Parentheses settle it. The same applies to `match Config { .. } { .. }` and
`for i in Range { start: 0, end: 3 }`. The ambiguity is the price of brace-
delimited bodies with no `then` keyword, and parentheses are the whole fix.
