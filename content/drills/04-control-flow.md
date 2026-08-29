---
unit: 04-control-flow
---

## 1

Does this compile?

```rust
let retries = 3;
if retries {
    println!("retrying");
}
```

- A. Yes — a non-zero integer is true
- *B. No — the condition must have type `bool`
- C. Yes, but it warns about an implicit conversion
- D. No — `if` requires an `else`

@why
`error[E0308]: expected bool, found integer`. Rust gives no value a truth value:
not `0`, not `""`, not an empty `Vec`, not `None`. The condition of an `if` is a
`bool` or it is a type error.

A is the C and Python intuition, and it is the reason `if (fd)` is a bug for file
descriptor zero and `if items:` silently conflates "empty" with "missing". You
write `retries > 0`, `!items.is_empty()` or `opt.is_some()` — three different
questions that no longer share one spelling.

## 2

What is `n` at the end?

```rust
let mut i = 1;
let n = loop {
    i *= 2;
    if i > 20 {
        break i;
    }
};
```

- A. `()` — loops do not produce values
- B. 20
- *C. 32
- D. 16

@why
`loop` is an expression, and `break i` is its `return`. The doubling goes
2, 4, 8, 16, 32; the test fires at 32, which is the first value over 20 and the
value the loop produces.

D is the trap: the check happens *after* the multiplication, so 16 never reaches
the comparison as a candidate — the loop tests 16, finds it is not over 20, and
goes round once more.

## 3

Does this compile?

```rust
let mut n = 0;
let found = while n < 10 {
    n += 1;
    if n == 4 {
        break n;
    }
};
```

- A. Yes — `found` is 4
- *B. No — a `while` loop cannot `break` with a value
- C. No — `n` was moved into the loop
- D. Yes, but `found` is always `()`

@why
`error[E0571]: can only break with a value inside loop`. A `while` has two ways
to finish: your `break`, or the condition testing false. If `break n` produced a
value, the compiler would need a second value for the other path and there is
nowhere to get one.

`loop` has exactly one exit — a `break` you wrote — so every exit can carry a
value and they must all agree on its type. That is what makes `loop` an
expression and `while` and `for` statements.

## 4

What does this print?

```rust
for i in (1..=3).rev() {
    print!("{i} ");
}
```

- A. `1 2 3`
- *B. `3 2 1`
- C. `2 1 0`
- D. It does not compile — a range cannot be reversed

@why
`1..=3` yields 1, 2, 3, and `.rev()` reverses that.

C is the tempting one: it is what `(0..3).rev()` prints, and the difference is
`..=` including its end where `..` excludes it. That is also why `..` is the
default — `a..b` always has length `b - a`, and `0..v.len()` is exactly the valid
indices.

D misses that a range is an ordinary struct implementing `Iterator`, so every
adapter — `.rev()`, `.step_by()`, `.map()` — is available on it.

## 5

Which of these are legal after `in` in a `for` loop? Choose all that apply.

- *A. `0..5`
- *B. `0..=5`
- C. `..5`
- *D. `&v` where `v: Vec<String>`
- E. `"hello"`

@why
`for` accepts exactly one thing: a value implementing `IntoIterator`.

`..5` is a `RangeTo`, and it has no start to count from, so it cannot be an
iterator — it exists for slicing, `&v[..5]`. `&str` deliberately does not
implement `IntoIterator` either, because a string could reasonably yield bytes,
`char`s or grapheme clusters and Rust refuses to guess: you write `.chars()`,
`.bytes()` or `.lines()`.

`0..=5` is an iterator but carries an extra `bool` compared to `0..5`, because
it has to remember whether it already yielded its end value — otherwise
`0..=u8::MAX` could never terminate.

## 6

What is the type of `x`?

```rust
let v = vec![String::from("a"), String::from("b")];
for x in &v {
    // ...
}
```

- A. `String`
- *B. `&String`
- C. `&mut String`
- D. `&Vec<String>`

@why
`for x in &v` calls `IntoIterator::into_iter(&v)`, and the impl for `&Vec<T>`
yields `&T`.

There are three impls and one character between them: `for x in v` consumes the
vector and yields `String`, `for x in &v` borrows and yields `&String`, and
`for x in &mut v` borrows uniquely and yields `&mut String`. This is the single
most common place a newcomer moves a collection by accident.

## 7

Which of these leave `v` usable afterwards? Choose all that apply.

```rust
let mut v = vec![1, 2, 3];
```

- *A. `for x in &v {}`
- B. `for x in v {}`
- *C. `for x in &mut v {}`
- *D. `for x in v.iter() {}`
- E. `for x in v.into_iter() {}`

@why
B and E consume the vector: both call `into_iter` on it by value, which takes
`self`.

A, C and D borrow. `v.iter()` is the explicit spelling of what `&v` does in a
`for` header, and `.iter_mut()` the spelling of `&mut v`. Writing them out is
sometimes clearer, and it is required as soon as you want to chain an adapter —
`v.iter().filter(..)`.

## 8

What does this print?

```rust
'outer: for i in 0..3 {
    for j in 0..3 {
        if i + j == 2 {
            break 'outer;
        }
        print!("{i}{j} ");
    }
}
```

- A. `00 01 10 `
- *B. `00 01 `
- C. `00 01 10 11 `
- D. `00 `

@why
The pairs run 00 (sum 0, printed), 01 (sum 1, printed), 02 (sum 2 — breaks out
of *both* loops). Nothing after that runs.

A is what a plain `break` would give: it would leave only the inner loop, so
`i` would advance to 1 and `10` would print before `11` broke out again. The
label is the whole difference, and it is why Rust needs no `goto` — a label may
only name a loop that lexically encloses the `break`, so control always moves
outward and never sideways.

## 9

Does this compile?

```rust
fn sign(n: i32) -> &'static str {
    match n {
        x if x < 0 => "negative",
        x if x == 0 => "zero",
        x if x > 0 => "positive",
    }
}
```

- A. Yes — the three guards cover every `i32`
- *B. No — guarded arms do not count towards exhaustiveness
- C. No — you cannot put a guard on a binding pattern
- D. Yes, but only because `x` is a catch-all binding

@why
`error[E0004]: i32::MIN..=i32::MAX not covered`. Between them the guards do cover
every integer, and the compiler will not try to prove that: a guard is arbitrary
Rust that could call a function, read an atomic, or return `false` on Tuesdays.

So the rule is flat: **a guarded arm never contributes to exhaustiveness.** A
`match` whose arms all carry guards always needs one more that does not. That
restriction is what keeps exhaustiveness decidable — and decidable
exhaustiveness is what turns "I added an enum variant" into a list of every
place that must change.

## 10

What does this return for `describe(300)`?

```rust
fn describe(len: usize) -> String {
    match len {
        n @ 0..=99 => format!("short {n}"),
        n @ 100..=999 => format!("medium {n}"),
        n => format!("long {n}"),
    }
}
```

- A. `"medium"` — `n` is not bound in that arm
- *B. `"medium 300"`
- C. `"long 300"`
- D. It does not compile — `@` needs a type annotation

@why
`n @ pattern` matches the pattern *and* binds the matched value to `n`. So the
second arm matches, `n` is 300, and the arm produces `"medium 300"`.

Without `@` the range arms would match without naming anything, and `{n}` in
those two `format!` calls would be `error[E0425]: cannot find value n`. The third
arm needs no `@` because `n` alone is already a binding pattern — it matches
anything and names it.

## 11

Does this compile?

```rust
fn port(raw: Option<&str>) -> u16 {
    let Some(text) = raw else { 8080 };
    text.parse().unwrap_or(8080)
}
```

- A. Yes — the `else` block produces the fallback
- *B. No — the `else` block of a `let ... else` must diverge
- C. No — `let else` only works on `Result`
- D. Yes, but `text` is only in scope inside the `else`

@why
`error[E0308]: else clause of let...else does not diverge`, expected type `!`.

Think about what happens after that block finishes. The next line names `text`,
and `text` was never bound — the pattern did not match. So the block is not
allowed to fall through: it must `return`, `break`, `continue` or panic.
`else { return 8080; }` compiles.

D inverts the actual feature. The point of `let else` over `if let` is precisely
that the binding escapes into the rest of the function, which is what lets the
happy path run straight down the left margin.

## 12

Which are true of Rust's `match` but not C's `switch`? Choose all that apply.

- *A. Arms never fall through into the next one
- *B. The compiler rejects it if some case is unhandled
- *C. It is an expression, so it produces a value
- D. Only integers and characters can be matched
- E. Arms are tried in order, first match wins

@why
A, B and C are the differences. No fallthrough means the C bug of a missing
`break` silently running the next case is not expressible. Exhaustiveness turns
a new enum variant into a compile error listing every place that must change.
And being an expression is why `let x = match .. { }` reads naturally.

D is backwards: `match` works on any type and on structure — tuples, structs,
enums, slices, ranges, or-patterns.

E is true of both, and worth knowing: a broad arm above a narrow one swallows
it, and rustc warns `unreachable pattern` when it can prove that happened.

## 13

What does this print?

```rust
let mut stack = vec![1, 2, 3];
while let Some(top) = stack.pop() {
    print!("{top} ");
}
```

- A. `1 2 3 `
- *B. `3 2 1 `
- C. Nothing — the pattern never matches
- D. It loops forever

@why
`pop` removes from the end, so the values come off 3, 2, 1. When the vector
empties, `pop` returns `None`, the pattern stops matching, and the loop ends.

D is the right instinct applied to the wrong code. `while let` re-evaluates its
scrutinee every pass and nothing forces progress — `while let Some(x) = v.first()`
with no removal really does run forever. The reason this version terminates is
that `pop` mutates the stack, not anything about `while let` itself.

## 14

Does this compile?

```rust
let bytes = 2000;
let size = if bytes > 1024 { "large" };
```

- A. Yes — `size` is `"large"` or unset
- *B. No — `if` used as a value needs an `else`
- C. No — `bytes` must be annotated
- D. Yes, and `size` has type `Option<&str>`

@why
`error[E0317]: if may be missing an else clause` — expected `&str`, found `()`.
On the false path there is no block at all, so the expression produces `()`, and
a `let` needs a single type.

An `if` with no `else` is perfectly legal as a *statement*, where both paths are
`()` and the value is discarded. Binding it is what forces both arms to produce
a value of the same type.

D is a reasonable guess from other languages and Rust does not do it: no
implicit wrapping into `Option`, no implicit `null`. If you want an `Option`,
write `if .. { Some("large") } else { None }`.

## 15

Which of these compile?

```rust
fn a() -> i32 { loop { } }
fn b() -> i32 { while true { } }
```

- *A. Only `a`
- B. Only `b`
- C. Both
- D. Neither

@why
`loop` with no `break` never finishes, so its type is `!`, the never type, which
coerces to anything — including `i32`. `a` type-checks.

`while true` has type `()` no matter what is inside it, because the compiler does
not evaluate the condition to decide whether the loop can end. `b` is
`error[E0308]: expected i32, found ()`.

This is why clippy nudges `while true` towards `loop`, and it is not a style
rule: the two constructs genuinely have different types. `loop` is also the only
one of the three loops that can `break` with a value, for the same underlying
reason — it has exactly one exit.
