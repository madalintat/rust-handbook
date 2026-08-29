---
num: 9
slug: 09-enums
title: Enums and pattern matching
accent: moss
concepts: enum, variant, sum type, match, exhaustiveness, pattern matching, match guard, binding mode, state machine
needs: 05-ownership, 08-structs
blurb: A value that is exactly one of these, and a compiler that will not let you forget one — the best refactoring property in the language.
---

%% A struct says *and*: a user has an id and a name and an email. An enum says *or*: a payment is a card or a transfer or a voucher, and never two at once. Most languages can only say *and* properly, so *or* gets encoded as a tag field plus three optional fields plus a comment, and every reader has to remember which combinations are legal.

Rust makes *or* a type. The compiler then knows the list of possibilities is complete — and that turns out to be worth more than the type itself.

## One of these, and only one

### A C enum is a named integer

```c
enum Kind { CARD, TRANSFER, VOUCHER };

struct Payment {
    enum Kind kind;
    char *card_number;   /* only when CARD */
    char *iban;          /* only when TRANSFER */
    int   voucher_id;    /* only when VOUCHER */
};
```

Three payload fields, one of them meaningful. Nothing stops `kind = CARD` with a
null `card_number` and a populated `iban`. The invariant lives in a comment, and
a `switch` that forgets `VOUCHER` compiles without a word.

### A Rust variant carries its own data

```rust
pub enum Payment {
    Card { number: String, cvv: u16 },
    Transfer(String),
    Voucher(u32),
}
```

Each variant has its own shape: struct-like, tuple-like, or nothing at all.
There is no syntax for a `Payment` holding both a card number and an IBAN, so
the illegal states are not checked — they are unrepresentable.

:::note
An enum is a **sum type**: the set of values it can hold is the *sum* of its
variants, not the *product* of its fields. A struct of three `bool`s has eight
possible values. An enum of three `bool`-carrying variants has six, and every
one of them means something.
:::

An enum is an ordinary type. It takes `impl` blocks, derives, and generics like
anything else:

```rust
impl Payment {
    pub fn fee_cents(&self) -> u32 {
        match self {
            Payment::Card { .. } => 30,
            Payment::Transfer(_) => 0,
            Payment::Voucher(_) => 0,
        }
    }
}
```

`Option<T>` and `Result<T, E>` are not compiler magic. They are two enums in the
standard library, written with exactly this syntax.

## What an enum costs

A value must be able to hold any variant, so the layout is a **discriminant**
(the tag saying which one) plus enough room for the largest payload.

:::memory enum Shape { Circle(f64), Rect(f64, f64), Nothing }
            ┌────────┬─────────────────┬─────────────────┐
            │  tag   │ payload word 0  │ payload word 1  │
            ├────────┼─────────────────┼─────────────────┤
 Circle(r)  │   0    │ 3.0             │ ──── unused ─── │
 Rect(w,h)  │   1    │ 2.0             │ 4.0             │
 Nothing    │   2    │ ──── unused ─── │ ──── unused ─── │
            └────────┴─────────────────┴─────────────────┘
              8 B      8 B               8 B     = 24 bytes

 The tag needs one byte. It occupies eight, because f64 wants
 8-byte alignment and the payload has to start on a boundary.
:::

:::gotcha
Every value of the enum is as big as its **fattest** variant. One variant
holding a `[u8; 1024]` makes the empty variants 1032 bytes too, and every move
of that enum copies all of it.

The fix is a pointer: `Card(Box<CardDetails>)` puts the fat payload on the heap
and shrinks the variant back to one word. Clippy's `large_enum_variant` lint
watches for exactly this.
:::

### The tag that is not there

The compiler does not need a tag when the payload already has a spare bit
pattern. A `&T` is never null, so `Option<&T>` uses `0` to mean `None`:

:::memory Option<&T> is the same size as &T
  &T           ┌──────────────────────┐
               │ 0x7ffd_e4a0          │   never 0 — references are non-null
               └──────────────────────┘   8 bytes

  Option<&T>   ┌──────────────────────┐
   Some(r)     │ 0x7ffd_e4a0          │   the address itself
   None        │ 0x0000_0000          │   the one pattern &T cannot hold
               └──────────────────────┘   8 bytes, no tag
:::

This is **niche optimisation**, and it applies to `Box<T>`, `&mut T`, `NonZeroU32`,
`char`, and any enum with an unused pattern in its own tag. It is why wrapping a
pointer in `Option` to make nullability explicit is genuinely free — you get the
compiler's insistence that you handle the empty case, and pay nothing for it.

| type | size on 64-bit |
|---|---|
| `&T`, `Box<T>` | 8 |
| `Option<&T>`, `Option<Box<T>>` | 8 |
| `u8` | 1 |
| `Option<u8>` | 2 — every bit pattern of `u8` is a real value, so a tag is needed |

## `match`, and exhaustiveness as a tool

`match` is an expression. Every arm must produce the same type, and it must
cover every possible value, because a value has to come out.

### The compile error that finds every site

```rust,bad
fn fee(p: &Payment) -> u32 {
    match p {
        Payment::Card { .. } => 30,
        Payment::Transfer(_) => 0,
    }
}   // error[E0004]: non-exhaustive patterns: `Payment::Voucher(_)` not covered
```

Now the payoff. Six months later someone adds `Payment::Crypto`. Every `match`
in the codebase that has to change becomes a compile error, with a file and a
line number. Nothing to grep for, nothing missed in review.

:::compare
**Java / C++** — adding a subclass is a silent success everywhere. Existing code
keeps compiling and quietly takes the base-class path, and you find out in
production. Adding an enum variant is a loud failure everywhere it matters.

Open sets want inheritance: anyone may add a shape. Closed sets want enums: the
author knows all the cases, and wants to be told when that list changes.
:::

:::gotcha
`_ => ...` switches exhaustiveness off, permanently, for that match. Adding a
variant then compiles and silently falls into the catch-all.

Use `_` for genuinely open sets — a `u8`, an `io::ErrorKind`, an enum from
another crate marked `#[non_exhaustive]`. Spell out the variants of your own
types, however tedious it feels the first time. That tedium is the feature you
are paying for.
:::

## Patterns

A pattern is not a value. It is a shape that a value is tested against, and any
identifier in it is a *binding*, not a comparison.

| pattern | matches |
|---|---|
| `404`, `"hi"`, `true` | that literal |
| `1..=9` | an inclusive range |
| `n` | anything, binding it to `n` |
| `_` | anything, binding nothing |
| `Point { x, y }` | the struct, binding both fields |
| `Point { x, .. }` | the struct, ignoring the other fields |
| `Some(Ok(n))` | nested, to any depth |
| `'a' \| 'e' \| 'i'` | any of the alternatives |
| `n @ 100..=199` | the range, *and* binds the matched value to `n` |
| `[first, .., last]` | a slice, by shape |

```rust
pub fn classify(c: char) -> &'static str {
    match c {
        '0'..='9' => "digit",
        'a' | 'e' | 'i' | 'o' | 'u' => "vowel",
        c if c.is_alphabetic() => "consonant",
        _ => "other",
    }
}
```

The `@` form exists because a range test throws the value away. `n @ 1..=9`
keeps it:

```rust
match code {
    n @ 200..=299 => format!("ok ({n})"),
    n @ 400..=499 => format!("client error ({n})"),
    n => format!("other ({n})"),
}
```

:::gotcha
A bare lowercase name in a pattern always binds — it never compares against a
variable of that name.

```rust,bad
let expected = 404;
match code {
    expected => "matched!",   // binds every value to a new `expected`
    _ => "no",                // unreachable
}
```

To compare against a constant, the name must be a `const` (uppercase, by
convention) or you need a guard: `n if n == expected`.
:::

### Guards do not count toward exhaustiveness

```rust,bad
match n {
    x if x < 0 => "negative",
    x if x >= 0 => "non-negative",
}   // error[E0004]: `_` not covered
```

Together those two guards obviously cover every `i32`. The compiler does not
agree, and it is not being lazy: a guard is an arbitrary expression that can
call functions and read the world, so deciding whether a set of guards is
complete is undecidable in general. Rather than special-case simple arithmetic,
the rule is uniform — **a guarded arm covers nothing**.

Guards are still the right tool when the condition is not a shape. Write the
last arm unguarded.

## The short forms

`match` with one interesting arm is noise. Three sugars remove it.

```rust
// only care about one variant
if let Some(port) = config.port {
    listen(port);
}

// the else must diverge, and the binding escapes to the outer scope
let Some(port) = config.port else {
    return Err("port is required");
};
listen(port);          // port is a u16 here, not an Option

// a boolean test on shape
if matches!(state, State::Running | State::Paused) {
    tick();
}
```

| | use it when |
|---|---|
| `match` | two or more arms do real work, or you want exhaustiveness enforced |
| `if let` | one variant matters and the other does nothing much |
| `let else` | the other case is an early exit, and you want the happy path unindented |
| `matches!` | you need a `bool`, not a value |

`let else` is the one that changes how code reads. Guard clauses stack at the
top of the function, each removing a case, and the body below is written as if
nothing could be missing — because nothing can.

## Matching through a reference

This is where people get stuck, and it is worth thirty seconds.

```rust
let msg: Option<String> = Some(String::from("hi"));

match &msg {
    Some(s) => println!("{s}"),   // s is &String
    None => {}
}
println!("{msg:?}");              // msg is still ours
```

The scrutinee is `&Option<String>` and the pattern `Some(s)` is not a reference
pattern. Rather than reject that, the compiler shifts the **binding mode** from
by-value to by-reference: it dereferences the scrutinee, and every binding
underneath comes out as a reference. This is **match ergonomics**, and it is why
matching a borrowed value usually just works.

:::gotcha
Match on the value instead of a reference and the bindings move:

```rust,bad
match msg {
    Some(s) => println!("{s}"),   // s: String, moved out of msg
    None => {}
}
println!("{msg:?}");   // error[E0382]: borrow of moved value: `msg`
```

Worse, if the value is behind a reference already you get `error[E0507]: cannot
move out of ... which is behind a shared reference`.

Three fixes, in order of preference: match on `&msg`, call `msg.as_ref()` to get
an `Option<&String>`, or — if you really do want it out — `msg.take()`.
:::

The `ref` keyword you will see in older code (`Some(ref s)`) forced by-reference
binding manually. Match ergonomics made it unnecessary in almost every position.

## Modelling state

The practical payoff. A connection has states, and only some fields make sense
in each:

```rust,bad
struct Connection {
    connected: bool,
    socket: Option<TcpStream>,
    error: Option<io::Error>,
    retries: u8,
}
```

Two booleans' worth of `Option` plus a flag is eight combinations, of which
about three are legal. The other five are what bug reports are made of:
connected with no socket, an error and a socket at once.

```rust,good
enum Connection {
    Idle,
    Connecting { started: Instant, attempt: u8 },
    Live { socket: TcpStream, since: Instant },
    Failed(io::Error),
}
```

Four states, each carrying exactly the data it needs and nothing it does not.
The transition function takes the old state **by value**:

```rust
fn step(state: Connection, ev: Event) -> Connection {
    match (state, ev) {
        (Connection::Idle, Event::Open) =>
            Connection::Connecting { started: Instant::now(), attempt: 1 },
        (Connection::Live { socket, .. }, Event::Close) => {
            drop(socket);
            Connection::Idle
        }
        (s, _) => s,   // every other pair: no change
    }
}
```

Because `step` consumes the old state, using a stale `Connection` after a
transition is a move error. The state machine cannot be observed mid-flight.

:::note
**The habit.** When you find a `bool` next to two `Option`s, and only some
combinations are legal, there is an enum trying to get out. Write the states
down, give each one its own fields, and the invalid combinations stop being
something you have to test for.
:::
