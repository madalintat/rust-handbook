---
unit: 10-option
---

## 1

What is `std::mem::size_of::<Option<&u8>>()` on a 64-bit machine?

- *A. 8 — the same as `&u8`
- B. 9 — a pointer plus a one-byte tag
- C. 16 — a pointer plus a tag padded to alignment
- D. 1 — it only has to store which variant it is

@why
A reference is never null, so `0` is a bit pattern the payload can never hold —
a **niche**. The compiler uses it to represent `None` and stores no tag at all,
so `Option<&u8>` is exactly the size of `&u8`.

C is the answer for a type with no niche. `Option<u8>` really is 2 bytes,
because every one of the 256 `u8` patterns is a legal value and there is nothing
spare to steal.

The consequence: wrapping a pointer in `Option` to make nullability explicit is
free. You get the compiler forcing you to handle absence and pay nothing.

## 2

Does this compile?

```rust
fn len_of(name: Option<String>) -> usize {
    name.len()
}
```

- A. Yes — it uses the string's length when present, 0 otherwise
- *B. No — `error[E0599]`, no method `len` on `Option<String>`
- C. Yes, but it panics on `None`
- D. No — `String` has no `len` method

@why
`Option<String>` is a different type from `String` and has its own, much smaller
set of methods. There is no implicit unwrapping anywhere in the language,
because implicit unwrapping is exactly what makes null dangerous — it lets code
that never thought about absence compile.

A is the tempting answer because it is what several other languages' optional
chaining does. Rust makes you say it:
`name.map(|s| s.len()).unwrap_or(0)`, or `name.map_or(0, |s| s.len())`.

## 3

What does this evaluate to?

```rust
let v = ["42", "x"];
v.first().map(|s| s.parse::<i32>().ok())
```

- A. `Some(42)`
- *B. `Some(Some(42))`
- C. `42`
- D. It does not compile

@why
`map` always wraps the closure's return value in one `Option`. The closure here
already returns an `Option<i32>`, so you end up with two layers: the outer one
means "the slice was not empty", the inner means "it parsed".

The combinator that does not add a layer is `and_then`, whose closure is
*allowed* to return an `Option`. `x.map(f).flatten()` is the same thing spelled
out.

The rule worth memorising: **if the closure can fail, use `and_then`.**

## 4

Which of these evaluate the fallback even when the `Option` is `Some`? Choose
all that apply.

- *A. `opt.unwrap_or(expensive())`
- B. `opt.unwrap_or_else(|| expensive())`
- *C. `opt.ok_or(build_error())`
- D. `opt.unwrap_or_default()`

@why
A and C pass an ordinary expression as an argument, and arguments are evaluated
before the call — always, regardless of what the function does with them. So
`expensive()` runs on the happy path too.

B and D do not: `unwrap_or_else` takes a closure and only calls it on `None`, and
`unwrap_or_default` builds `T::default()` only when needed.

The rule: `unwrap_or` for values already sitting there — an integer, a `&'static
str`. `unwrap_or_else` for anything with a body. Same distinction for `ok_or`
versus `ok_or_else`.

## 5

Does this compile?

```rust
fn first_char(s: &str) -> Result<char, String> {
    let c = s.chars().next()?;
    Ok(c)
}
```

- A. Yes — `?` works on any fallible type
- *B. No — `?` on an `Option` needs the function to return an `Option`
- C. Yes, and it returns `Err(String::new())` for an empty string
- D. No — `chars().next()` returns a `char`, not an `Option`

@why
`?` converts the *residual* of one `Try` type into the return type. An `Option`'s
residual is `None`, and there is no conversion from `None` to a `Result`, so the
function's return type has to be an `Option` too.

The fix is to say what the absence means before propagating:
`s.chars().next().ok_or("empty string".to_string())?`. `ok_or` turns
`Option<T>` into `Result<T, E>` with an error you chose, and then `?` has
something it can convert.

## 6

What is the type of `cfg.name.as_ref()` where `cfg: &Config` and
`name: Option<String>`?

- A. `&Option<String>`
- *B. `Option<&String>`
- C. `Option<&str>`
- D. `&String`

@why
`as_ref` maps `&Option<T>` to `Option<&T>` — the tag is copied and the payload
becomes a borrow. That is the bridge between the two shapes, and the reason it
exists is that `match cfg.name` would try to *move* the `String` out of a struct
you only borrowed, which is `error[E0507]`.

C is `as_deref`, which does the same and then derefs the payload —
`Option<String>` to `Option<&str>`. That is the one you want for comparing
against a literal: `cfg.name.as_deref() == Some("ferris")`.

## 7

Why is `Option<&T>` usually a better parameter type than `&Option<T>`?

- *A. It is 8 bytes and `Copy`, so it passes freely
- *B. The caller does not need to own an `Option` for you to point at
- C. `&Option<T>` does not compile
- D. `Option<&T>` can be `None` while `&Option<T>` cannot

@why
`&Option<T>` requires the caller to have an actual `Option` sitting in memory.
If they have a plain `&T` and want to pass it, they must construct one first.
`Option<&T>` accepts `Some(&x)` or `None` from anywhere.

It is also cheaper: one machine word thanks to the niche, and `Copy`, so it
does not borrow the container for the duration of the call.

D is false — both can be `None`; the second just spells it "the referenced
Option is None".

## 8

Which of these are legitimate uses of `unwrap` or `expect`? Choose all that
apply.

- *A. `Regex::new(r"^\d+$").unwrap()` on a literal pattern
- B. `env::var("PORT").unwrap()` at start-up
- *C. `v.first().unwrap()` immediately after checking `!v.is_empty()`
- D. `line.parse::<i32>().unwrap()` inside a loop over a file

@why
`unwrap` is a claim that the value is there. A and C are claims you can verify
by reading the surrounding code: the regex is a compile-time literal, and the
emptiness check is two lines up.

B and D depend on the outside world. A missing environment variable or a
malformed line is normal input, not a bug, and panicking on it takes the process
down for something that should have been a message.

D is the specific trap: inside a loop, one bad record kills everything.
Propagate with `?`, skip with `filter_map`, or substitute with `unwrap_or`.

## 9

Why is `expect` always preferable to `unwrap`?

- A. It does not panic
- *B. It panics with a message you wrote, at the same cost
- C. It returns a `Result` instead
- D. It is faster in release builds

@why
Identical behaviour, one extra argument, and the argument is what the person on
call reads at 3am. `unwrap` gives them
`called Option::unwrap() on a None value` and a line number; `expect` gives them
the reason someone believed it could not be `None`.

Write the invariant, not the symptom.
`expect("config was validated at start-up")` names whose assumption broke.
`expect("name is None")` restates what the panic already says.

## 10

What does this print?

```rust
let mut head = Some(String::from("a"));
let taken = head.take();
println!("{:?} {:?}", taken, head);
```

- *A. `Some("a") None`
- B. `Some("a") Some("a")`
- C. `None Some("a")`
- D. It does not compile — `take` needs ownership

@why
`take` is `mem::replace(&mut self, None)`: it swaps `None` into the place and
hands you what was there. Two words moved, no allocation, no clone.

This matters because it is the only way to move a value out of a field you have
only `&mut` access to while leaving that field valid. `self.head` on its own is
`error[E0507]`, and `self.head.clone()` is a needless allocation. Every linked
structure in Rust is written with `take`.

Its sibling `replace(v)` does the same but puts `v` in rather than `None`.

## 11

Which of these are true of `Option<T>`? Choose all that apply.

- *A. It is an ordinary enum defined in the standard library
- *B. `Some` and `None` are in the prelude, which is why they need no path
- C. It is a compiler built-in with special layout rules
- D. It requires a heap allocation

@why
`enum Option<T> { None, Some(T) }` — two lines you could have written yourself.
Its variants are re-exported in the prelude, which is the only reason you write
`Some(3)` rather than `Option::Some(3)`.

C is half-tempting because of the niche optimisation, but that is not special
treatment: any enum with a niche in its payload gets it, including ones you
define. `?` is genuine language support, but it works through the `Try` trait,
which your own types can implement.

## 12

Match each situation to the right combinator. Which pairings are correct? Choose
all that apply.

- *A. Turn `Option<T>` into `Result<T, E>` → `ok_or`
- *B. Keep the value only if it satisfies a predicate → `filter`
- *C. Need two `Option`s to both be present → `zip`
- D. Apply a closure that itself returns an `Option` → `map`

@why
D is the one that is wrong, and it is the mistake people actually make. `map`
wraps whatever the closure returns, so a fallible closure gives you
`Option<Option<T>>`. `and_then` is the one that does not add a layer.

`zip` is worth noticing: it produces `Option<(T, U)>`, a single value that
happens to be a tuple, so the following `map` closure takes one argument and
destructures it — `|(a, b)| a * b`. Writing `|a, b|` is `error[E0593]`.

## 13

What does this evaluate to?

```rust
let name: Option<String> = Some(String::from(""));
name.as_deref()
    .filter(|s| !s.is_empty())
    .map(str::to_uppercase)
    .unwrap_or_else(|| "ANONYMOUS".to_string())
```

- A. `""`
- *B. `"ANONYMOUS"`
- C. `"SOME"`
- D. It does not compile — `filter` consumes the `Option`

@why
`as_deref` gives `Option<&str>` holding `Some("")`. `filter` applies the
predicate: the string *is* empty, so the predicate is false and the whole thing
becomes `None`. `map` on `None` does nothing. `unwrap_or_else` then supplies the
fallback.

`filter` is the combinator for "present, but only if it also satisfies this",
and turning an unwanted `Some` into `None` is exactly its job. Empty-string
handling is its most common real use.

## 14

`Option<Option<u8>>` is how many bytes?

- A. 3
- *B. 2
- C. 4
- D. 1

@why
`Option<u8>` is 2 bytes: one for the payload, one for the tag, because a `u8`
has no spare bit pattern. But that tag only uses two of its 256 values, so the
*tag itself* has a niche — 254 spare patterns. The outer `Option` takes one of
them, and the whole thing stays 2 bytes.

The general rule: the compiler looks for any unused bit pattern anywhere in the
layout, including in another enum's discriminant. It is why deeply wrapped types
so often cost nothing extra, and why you should not add a sentinel value by hand
to "save space".

## 15

You have `fn find(&self, k: &str) -> Option<&Row>` and need a `Row` you can keep.
Which is right?

- A. `self.find(k).unwrap()` — you know it is there
- *B. `self.find(k).cloned().ok_or("row not found")?`
- C. `self.find(k).map(|r| r).unwrap_or_default()`
- D. `*self.find(k).unwrap()`

@why
B says all three things that need saying: `cloned` turns `Option<&Row>` into
`Option<Row>` by cloning the payload, `ok_or` names what absence means here, and
`?` propagates it. The caller gets an error rather than a dead process.

A is the claim from drill 8 that you cannot check by reading nearby code — a
lookup by key depends on data.

D is `error[E0507]`: you cannot move a `Row` out from behind a shared reference.
That is what `cloned` is for, and its sibling `copied` does the same for `Copy`
payloads without the allocation.

C compiles only if `Row: Default`, and silently substitutes an empty row for a
missing one, which is the null-shaped bug in a new costume.
