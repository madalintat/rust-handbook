---
num: 10
slug: 10-option
title: Option
accent: moss
concepts: Option, null, niche optimisation, combinator, unwrap, expect, the question mark operator, as_ref
needs: 05-ownership, 09-enums
blurb: Absence as a value the compiler can see, the combinators that keep it from becoming a pyramid, and the two places unwrap is still the right call.
---

%% Tony Hoare called the null reference his billion dollar mistake: he added it to ALGOL W in 1965 because it was easy to implement, and it has been dereferenced by accident ever since. The problem was never the concept of absence. It was that absence and presence had the *same type*, so nothing forced anyone to check.

`Option<T>` splits them apart. `T` is a value that is there. `Option<T>` is a value that might not be, and it is a different type — so the check is not a discipline, it is a compile error you have to answer.

## An ordinary enum

There is no magic here. `Option` is two lines of the standard library, written in
the syntax of the previous unit:

```rust
pub enum Option<T> {
    None,
    Some(T),
}
```

Both variants are in the prelude, which is why you write `Some(3)` and not
`Option::Some(3)`. Everything else — `map`, `unwrap_or`, `?` — is ordinary
methods on an ordinary enum. You could have written it yourself, and before
1.0 people did.

### What that buys

```rust,bad
let name: String = config.name;   // if config.name is Option<String>
                                  // error[E0308]: expected String, found Option<String>
```

The type system will not let an absent value be used as a present one. In a
language with null, `config.name` has type `String` whether or not it holds one,
and the difference shows up as an exception in production. Here it shows up as a
mismatched type, at the moment you write the line.

:::compare
**Java's `Optional`** is a library type layered on a language that still has
null, so an `Optional<T>` may itself be null and nothing stops you returning a
bare `T`. **Python's `None`** is a value of every type, and type checkers reason
about it optionally and after the fact. **Go's zero values** conflate "absent"
with "empty string" and "zero".

`Option` works because there is nothing underneath it. There is no null for a
`String` to secretly be.
:::

## What it costs

Usually nothing at all.

An enum needs a tag to say which variant it is — unless the payload has a bit
pattern it can never take. A reference is never null, so `None` can just be zero:

:::memory Option<&str> and &str have identical layout
  &str          ┌──────────────┬──────────────┐
                │ ptr  0x7ffd… │ len  6       │   16 bytes
                └──────────────┴──────────────┘
                  never 0

  Option<&str>  ┌──────────────┬──────────────┐
   Some(s)      │ ptr  0x7ffd… │ len  6       │   16 bytes
   None         │ ptr  0x0000… │ len  ——      │   no tag anywhere
                └──────────────┴──────────────┘
:::

This is **niche optimisation**. It applies to `&T`, `&mut T`, `Box<T>`, `Vec<T>`,
`String`, `NonZeroU32`, `char`, and to any enum with a spare tag value.

| type | size | why |
|---|---|---|
| `Option<&T>` | 8 | null pointer is the niche |
| `Option<Box<T>>` | 8 | same |
| `Option<String>` | 24 | the pointer inside is the niche |
| `Option<u8>` | 2 | every `u8` pattern is a real value — a tag is needed |
| `Option<Option<u8>>` | 2 | the outer one reuses the inner tag's spare values |

:::note
Wrapping a pointer in `Option` to make nullability explicit is free. You get the
compiler's insistence that you handle the empty case and pay nothing for it —
which is why every `Box`-based linked structure in Rust uses `Option<Box<Node>>`
rather than a nullable pointer.
:::

## Getting the value out

### match, if let, let else

```rust
match config.port {
    Some(p) => listen(p),
    None => listen(8080),
}

if let Some(p) = config.port {
    listen(p);
}

let Some(p) = config.port else {
    return Err("port is required");
};
listen(p);
```

### unwrap and expect

`unwrap` returns the value or panics. It is not automatically a smell — it is a
claim, and the question is whether the claim is true.

```rust
// legitimate: a literal you can read
let re = Regex::new(r"^\d+$").unwrap();

// legitimate: you just checked
if !v.is_empty() {
    let first = v.first().unwrap();
}

// not legitimate: this depends on a file you did not write
let port: u16 = env::var("PORT").unwrap().parse().unwrap();
```

:::gotcha
`expect` is strictly better than `unwrap`, always. Same behaviour, one argument,
and the argument is the message the person on call reads at 3am.

```rust
let re = Regex::new(PATTERN).expect("PATTERN is a compile-time literal");
```

Write the *reason the invariant holds*, not the thing that failed. "cannot be
empty, checked on line 40" tells the reader whose assumption broke. "unwrap
failed on None" tells them what they can already see.
:::

:::gotcha
The one to actually avoid:

```rust,bad
for line in lines {
    let n: i32 = line.parse().ok().unwrap();   // one bad line kills the process
}
```

Inside a loop, `unwrap` turns one malformed input into a total failure. Use `?`
to propagate, `filter_map` to skip, or `unwrap_or` to substitute — all three are
shorter than the panic.
:::

## The combinators

The methods exist so you can describe the transformation without unpacking and
repacking. Each is one line of `match` that you have written a hundred times.

| method | on `Some(x)` | on `None` | use it for |
|---|---|---|---|
| `map(f)` | `Some(f(x))` | `None` | transforming the value, staying optional |
| `and_then(f)` | `f(x)` | `None` | when `f` is *itself* fallible |
| `filter(p)` | `Some(x)` if `p(&x)` | `None` | adding a condition |
| `or(other)` | `Some(x)` | `other` | a fallback that is also optional |
| `unwrap_or(d)` | `x` | `d` | a default that is already built |
| `unwrap_or_else(f)` | `x` | `f()` | a default that costs something |
| `unwrap_or_default()` | `x` | `T::default()` | `0`, `""`, `vec![]` |
| `ok_or(e)` | `Ok(x)` | `Err(e)` | turning absence into an error |
| `zip(other)` | `Some((x, y))` | `None` | needing two values at once |
| `take()` | `Some(x)`, leaves `None` | `None` | moving out of a `&mut` |
| `replace(v)` | old value, stores `v` | `None`, stores `v` | swapping in place |

### map versus and_then

The distinction people trip on. If your closure returns an `Option`, `map` gives
you an `Option<Option<T>>`:

```rust,bad
fn first_number(v: &[&str]) -> Option<i32> {
    v.first().map(|s| s.parse().ok())   // Option<Option<i32>>
}
```

```rust,good
fn first_number(v: &[&str]) -> Option<i32> {
    v.first().and_then(|s| s.parse().ok())
}
```

`and_then` is flatten-then-map — the same operation `flat_map` is for iterators
and `then` is for promises. **If the closure can fail, you want `and_then`.**

### unwrap_or versus unwrap_or_else

```rust
cache.get(k).unwrap_or(expensive_default())      // always runs
cache.get(k).unwrap_or_else(|| expensive_default())  // runs only on None
```

The argument to `unwrap_or` is an ordinary expression, evaluated before the call
like any other argument. If building the default allocates, queries, or panics,
that happens on the happy path too. `unwrap_or_else` takes a closure and only
calls it when needed.

Rule: `unwrap_or` for literals and cheap values, `unwrap_or_else` for anything
with a body, `unwrap_or_default()` when the default is the type's own.

## `?` on Option

`?` on an `Option` returns `None` from the enclosing function early, and
otherwise unwraps:

```rust
fn initials(first: &str, last: &str) -> Option<String> {
    let a = first.chars().next()?;
    let b = last.chars().next()?;
    Some(format!("{a}{b}"))
}
```

Three lines, two early exits, no nesting. The same code with `match` is four
levels deep.

:::gotcha
`?` on `Option` only works in a function returning `Option` (or another type
implementing `Try` with a compatible residual). It does **not** work in a
function returning `Result`, and it does not work in `main` unless `main`
returns something compatible.

To cross between them, convert first: `opt.ok_or("missing name")?` turns an
`Option` into a `Result` and then propagates.
:::

Note the `Some(...)` on the last line. A function returning `Option<String>`
must wrap its success value; forgetting it is the most common `E0308` in
`?`-using code.

## Options and references

`&Option<T>` and `Option<&T>` are different types, and the difference matters
more than it looks.

:::memory the two shapes
  &Option<String>          Option<&String>
  ┌──────────┐             ┌──────────────┐
  │ ptr  ●───┼──▶ Option   │ ptr  ●───────┼──▶ String   (Some)
  └──────────┘   (24 B)    │ ptr  0x0000  │             (None)
                           └──────────────┘
  a borrow of the whole    an Option whose payload
  enum, tag included       is a borrow. 8 bytes, Copy.
:::

`as_ref` is the bridge: `&Option<T>` → `Option<&T>`. Use it whenever you have a
borrowed struct and want to work with the field.

```rust
impl Config {
    fn name_len(&self) -> usize {
        self.name.as_ref().map(|s| s.len()).unwrap_or(0)
    }
}
```

Without `as_ref`, `self.name.map(...)` would try to move the `String` out of
`&self` — `error[E0507]`.

`as_deref` goes one further, `Option<String>` → `Option<&str>`, and is the usual
way to compare against a literal:

```rust
if config.name.as_deref() == Some("ferris") { … }
```

:::gotcha
`take()` is how you move out of an `Option` you only have `&mut` access to. It
replaces the field with `None` and hands you what was there:

```rust
fn pop(&mut self) -> Option<Node> {
    self.head.take()          // self.head is now None
}
```

`self.head` alone is `E0507`; `self.head.clone()` is a needless allocation.
`take` is a two-word swap and is how every linked list in Rust is written.
:::

## Choosing a style

There is an actual answer here, not just taste.

| shape | reach for |
|---|---|
| both cases do real work | `match` |
| one case does work, the other nothing | `if let` |
| the empty case is an early exit | `let else` |
| you are transforming, then handling absence once | combinators |
| you need a `bool` | `matches!` or `is_some()` |

The combinators win when the chain reads as one sentence:

```rust
config.name
    .as_deref()
    .filter(|s| !s.is_empty())
    .map(str::to_uppercase)
    .unwrap_or_else(|| "ANONYMOUS".to_string())
```

They lose when the closures grow bodies. Three nested `and_then`s with
multi-line closures is worse than three `let else` lines, and the compiler
errors inside a long chain point at the whole chain rather than the line you
got wrong.

:::note
Write it with `match` first if you are unsure. Collapsing a `match` into a
combinator afterwards is a safe, local edit; unpicking a chain that grew a body
is not.
:::
