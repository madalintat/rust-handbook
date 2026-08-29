---
num: 4
slug: 04-control-flow
title: Control flow
accent: amber
concepts: if, loop, break, labelled break, while, while let, for, IntoIterator, range, match guard, if let, let else
needs: 01-bindings, 03-expressions
blurb: `loop` as an expression, `while let`, labelled breaks, and the shape of a `for`.
---

%% Rust's control flow looks borrowed from C and then quietly refuses four things C allows: a condition that is not a `bool`, a `switch` case that falls into the next one, a `goto`, and a loop that cannot hand back a value. Each refusal removes a specific class of bug, and each one changes how the code is written.

The syntax takes ten minutes. The consequences are what this unit is about.

## Conditions are `bool`, and nothing else

### There is no truthiness

```rust,bad
let retries = 3;
if retries {                  // error[E0308]: expected `bool`, found integer
    println!("retrying");
}
```

Other languages give every value a truth value, and every one of them draws the
line somewhere different.

| | falsy there | in Rust |
|---|---|---|
| C | `0`, `NULL` | not a condition at all |
| Python | `0`, `""`, `[]`, `{}`, `None` | not a condition at all |
| JavaScript | `0`, `""`, `NaN`, `null`, `undefined` | not a condition at all |

The cost of that convenience is that `if items:` and `if items is not None:` are
different questions with the same answer most of the time, and the day they
differ is the day an empty list is treated as a missing one. Rust makes you say
which question you are asking: `if retries > 0`, `if !items.is_empty()`,
`if opt.is_some()`.

:::gotcha
The classic C typo cannot be written here either:

```rust,bad
let mut ready = false;
if ready = true { }        // error[E0308]: expected `bool`, found `()`
```

Assignment in Rust is an expression of type `()`, not of the assigned value. So
`=` where `==` was meant is a type error rather than a condition that is always
true.
:::

### `if` produces a value

Unit 03 established it; the consequence for control flow is that Rust needs no
ternary operator, because `if` already is one.

```rust
let size = if bytes > 1024 { "large" } else { "small" };
```

Both arms must have the same type, and an `else` is required — without one the
`else` path would have no value to produce.

:::gotcha
A stray semicolon changes the type of a branch to `()`:

```rust,bad
let size = if bytes > 1024 { "large"; } else { "small" };
//                                  ^ now this arm is `()`
```

The error lands on the *other* arm, which is confusing until you know to look
for the semicolon.
:::

## The three loops

### `loop`, and `break` with a value

`loop` is the only loop that can produce a value, because it is the only one the
compiler knows cannot end by itself.

```rust
let mut attempt = 0;
let port = loop {
    attempt += 1;
    if let Some(p) = try_bind(8080 + attempt) {
        break p;
    }
    if attempt == 5 {
        break 0;
    }
};
```

`break p` is `return`, for a loop. Every exit is visible, and the type of the
whole `loop` expression is the type all its `break`s agree on.

:::note
`break value` works in `loop` only. A `while` or `for` can also end by its
condition going false, and there is no value the compiler could produce on that
path — so `break` there takes no argument. Trying anyway is `error[E0571]`.
:::

`loop` also beats `while true`, and not on style. A `loop` with no `break`
diverges, so its type is `!` and it satisfies any return type:

```rust
fn serve() -> ! {
    loop {
        handle(accept());
    }
}
```

`while true { }` has type `()` no matter what is in it, because the compiler does
not evaluate the condition. The same function written with `while true` fails to
type-check.

### `while`

Nothing surprising. A condition, checked before each pass, that must be a `bool`.

```rust
let mut remaining = budget;
while remaining >= cost {
    remaining -= cost;
}
```

### `for` and IntoIterator

There is no C-style `for (i = 0; i < n; i++)`. `for` takes one thing: something
that implements **IntoIterator**.

```rust
for line in &lines {
    println!("{line}");
}
```

That desugars to exactly this, and the desugaring explains everything else:

```rust
let mut it = IntoIterator::into_iter(&lines);
while let Some(line) = it.next() {
    println!("{line}");
}
```

So `for x in thing` is decided by which `IntoIterator` impl `thing` matches, and
collections have three:

| written | `into_iter` receives | yields | the collection afterwards |
|---|---|---|---|
| `for x in v` | `Vec<T>` by value | `T` | consumed |
| `for x in &v` | `&Vec<T>` | `&T` | untouched |
| `for x in &mut v` | `&mut Vec<T>` | `&mut T` | mutable during the loop |

One character of difference, three different meanings. This is the most common
place a newcomer moves something by accident.

## Ranges

### `..` excludes, `..=` includes

```rust
for i in 0..3  { }   // 0 1 2
for i in 0..=3 { }   // 0 1 2 3
```

The **half-open range** is the default for a reason worth stating once: `a..b` always has
length `b - a`, adjacent ranges join without an overlap or a gap, and
`0..v.len()` is exactly the set of valid indices. Off-by-one errors have nowhere
to hide.

`..=` earns its place at the top of the integer range, where `0..=u8::MAX` is
writable and `0..u8::MAX + 1` overflows.

### Ranges are ordinary values

A range is a struct, not syntax. That is why it can be stored, passed and
iterated.

| written | type | iterator | slicing |
|---|---|---|---|
| `a..b` | `Range` | yes | yes |
| `a..=b` | `RangeInclusive` | yes | yes |
| `a..` | `RangeFrom` | yes | yes |
| `..b` | `RangeTo` | no — no start to count from | yes |
| `..` | `RangeFull` | no | yes |

```rust
let evens: Vec<u32> = (0..10).step_by(2).collect();
for i in (1..=5).rev() { }
```

:::gotcha
`RangeInclusive` is not just `Range` with a different comparison. It carries an
extra `bool` to remember whether it has already yielded `end`, because otherwise
`0..=u8::MAX` could never terminate — the counter would wrap. That flag is a
real branch in the loop. Prefer `..` unless you mean `..=`.
:::

:::gotcha
`for i in 0..v.len()` followed by `v[i]` works and is almost always the wrong
shape. `for x in &v` cannot go out of range, does not repeat the bounds check
the indexing does, and reads better. Reach for the index only when you actually
need the number.
:::

## Escaping nesting

### Labelled break

A plain `break` leaves the innermost loop. A label says which one.

```rust
let mut found = None;
'search: for (r, row) in grid.iter().enumerate() {
    for (c, cell) in row.iter().enumerate() {
        if *cell == needle {
            found = Some((r, c));
            break 'search;
        }
    }
}
```

:::memory where each break lands
      'rows: for row in &grid {
                 for cell in row {
                     break;         ──┐    leaves the inner loop
                     break 'rows;   ──┼──┐ leaves both
                 }                  ◀─┘  │
             }                           │
             report(found);          ◀───┘
:::

Without labels the alternatives are a `found` flag re-tested in the outer
condition, or extracting the whole nest into a function so `return` can do the
job. Both are what C programmers reach for `goto` to avoid.

Rust has no `goto`. A label may only name a loop or block that lexically encloses
the `break`, so control can move outward and never sideways or backwards. That
single restriction is why `break 'label` stays readable where `goto` does not:
the destination is always the end of something you are already inside.

### Labelled blocks, and `break` with a value

Labels also carry values, and since Rust 1.65 a plain block can be labelled —
which gives you an early exit from a stretch of code that is not a loop at all.

```rust
let index = 'search: {
    for (i, line) in lines.iter().enumerate() {
        if line.starts_with("[server]") {
            break 'search Some(i);
        }
    }
    None
};
```

`continue 'label` works the same way, jumping to the next iteration of the named
loop rather than the innermost one.

## Loops driven by a pattern

### `while let`

```rust
let mut stack = vec![1, 2, 3];
while let Some(top) = stack.pop() {
    println!("{top}");
}
```

The condition here is not a `bool` — it is whether the pattern matched. The
desugaring says it plainly:

```rust
loop {
    match stack.pop() {
        Some(top) => { println!("{top}"); }
        _ => break,
    }
}
```

So `while let` means *keep going while this pattern keeps matching*. `pop`
returns `None` when the stack empties, the pattern stops matching, the loop
ends.

:::gotcha
The scrutinee is re-evaluated every pass, and nothing forces it to make progress:

```rust,bad
while let Some(first) = queue.first() {
    handle(first);            // never removes anything — this runs forever
}
```

`while let Some(x) = it.next()` has the opposite problem: it is correct, and it
is a `for` loop written the long way. Use `for`.
:::

## `match`: guards and bindings

### No fallthrough, and order matters

A `match` arm ends at its comma. There is no fallthrough, so there is no `break`
to forget — the C bug where one missing `break` silently runs the next case is
not expressible.

Arms are tried top to bottom, so a broad pattern above a narrow one swallows it.
`rustc` warns with `unreachable pattern` when it can prove that has happened.

### Guards

An arm can carry an `if` that runs after the pattern matches — a **match guard**.

```rust
let action = match retries {
    0 => "give up",
    n if n < 3 => "retry now",
    n if n < 10 => "retry with backoff",
    _ => "page someone",
};
```

:::gotcha
A **match guard** is invisible to the exhaustiveness checker. It is arbitrary
code, so rustc will not reason about it:

```rust,bad
match n {
    x if x < 0 => "negative",
    x if x >= 0 => "not negative",
}                             // error[E0004]: `i32` not covered
```

Between them those two arms cover every `i32`, and the compiler does not know
it. Guarded arms never count towards coverage; you still need an unguarded final
arm.
:::

### Binding with `@`

`@` tests a pattern *and* keeps the value that matched it.

```rust,bad
let label = match body.len() {
    0..=63    => format!("small ({n} bytes)"),   // there is no `n`
    64..=1023 => format!("medium ({n} bytes)"),
    n         => format!("large ({n} bytes)"),
};
```

```rust,good
let label = match body.len() {
    n @ 0..=63    => format!("small ({n} bytes)"),
    n @ 64..=1023 => format!("medium ({n} bytes)"),
    n             => format!("large ({n} bytes)"),
};
```

Without it the choice is to lose the value or to repeat the test inside the arm.
It nests, too — `Message { code: c @ 400..=499, .. }` matches a client error and
hands you the code.

## `if let` and `let else`

### `if let` is a one-armed match

```rust
if let Some(name) = config.get("name") {
    println!("{name}");
}
```

That is `match config.get("name") { Some(name) => { .. } _ => {} }`, and it is
the right tool when both branches have real work to do. It is the wrong tool
when the failing branch is an exit, because then it drags the whole function
rightwards.

### `let else`

```rust,bad
fn port(cfg: &Config) -> u16 {
    if let Some(raw) = cfg.get("port") {
        if let Ok(n) = raw.parse::<u16>() {
            if n != 0 {
                return n;
            }
        }
    }
    8080
}
```

Three tests, three levels of indentation, and the success case buried deepest.
The `8080` at the bottom is the fallback for all three failures, a long way from
any of them.

```rust,good
fn port(cfg: &Config) -> u16 {
    let Some(raw) = cfg.get("port") else { return 8080 };
    let Ok(n) = raw.parse::<u16>() else { return 8080 };
    if n == 0 {
        return 8080;
    }
    n
}
```

The difference is one thing only: **the binding from a `let else` escapes into
the rest of the function**, where an `if let`'s binding is trapped in its block.
Failure handling moves to the left margin and the happy path runs straight down.

:::note
The `else` block of a `let ... else` must **diverge** — `return`, `break`,
`continue`, or a `panic!`. Its type is `!`. It cannot fall through, because
there would be no value to bind, and that is checked: an `else` block that
returns normally is `error[E0308]`.
:::

Which to reach for:

| situation | use |
|---|---|
| both branches do work | `if let` / `match` |
| the failing branch leaves | `let else` |
| more than two cases | `match` |
| the value is needed for the rest of the function | `let else` |
