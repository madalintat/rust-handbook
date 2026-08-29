---
unit: 03-expressions
---

## 1

What is the value of `x`?

```rust
let x = {
    let a = 2;
    a * 3
};
```

- A. `()` — a block does not produce a value
- *B. `6`
- C. `2`
- D. It does not compile; a block cannot appear after `=`

@why
A block is an expression. It runs its contents in order and takes the value of
its last expression, provided that expression has no semicolon. `a * 3` is that
tail expression, so the block is worth 6.

`a` is dropped at the closing brace and is not in scope afterwards, which is the
useful half of this pattern: the value escapes, the scratch bindings do not.

## 2

Does this compile?

```rust
fn ratio(a: f64, b: f64) -> f64 {
    a / b;
}
```

- A. Yes
- *B. No — the body produces `()`, not `f64`
- C. No — you cannot divide floats without checking for zero
- D. Yes, but it returns `0.0`

@why
The semicolon turns `a / b` from an expression into a statement and throws its
value away. With nothing left as a tail expression, the block is worth `()`, and
`()` is not an `f64` — `error[E0308]`.

D is the tempting one, because plenty of languages return a zero value from a
function that falls off the end. Rust has no such rule: the body's type must be
the declared type, and a discarded value is discarded.

Note what C gets wrong. `a / 0.0` is legal and gives `inf`; float division does
not panic.

## 3

What is the type of this expression when `ok` is a `bool`?

```rust
if ok { 1 }
```

- A. `i32`
- *B. `()`
- C. `Option<i32>`
- D. It has no type

@why
An `if` with no `else` has an implicit empty `else` branch, and an empty block is
worth `()`. Both branches must agree, so the `if` branch is forced to `()` as
well — which is why `if ok { 1 }` is actually a type error on the `1`, not a
usable `i32`.

C is a reasonable guess from a language with `Maybe`, and it is what
`if ok { Some(1) } else { None }` would give you. Rust does not insert that
wrapping for you; if you want the optionality you write it.

## 4

What is `x`?

```rust
let mut n = 0;
let x = loop {
    n += 1;
    if n == 4 {
        break n * 10;
    }
};
```

- A. `()`
- B. `4`
- *C. `40`
- D. It does not compile — `break` cannot take a value

@why
`loop` is the only loop that can produce a value, and `break n * 10` is what
gives it one. The value of the `break` becomes the value of the whole `loop`
expression.

The reason `while` and `for` cannot do this is structural rather than arbitrary:
they have two ways to end — the body broke out, or the condition ran out — and
only one of those has a value to offer. `loop` has exactly one exit, so every
exit can carry something.

## 5

Does this compile?

```rust
let x = while count > 0 {
    break 7;
};
```

- A. Yes — `x` is `7`
- *B. No — `break` may only carry a value out of a `loop`
- C. Yes — `x` is `()`
- D. No — `while` cannot contain `break` at all

@why
`error[E0571]: break with value from a while loop`. The compiler even suggests
using `loop` instead, which is the right fix.

C is the tempting answer because a `while` *does* evaluate to `()`, so `let x =
while ... {}` is otherwise fine. It is the value on the `break` that is rejected:
if the condition had failed on the first check, the loop would have ended without
ever reaching a `break`, and there would be no 7 to hand back.

## 6

Which of these are statements rather than expressions? Choose all that apply.

- *A. `let n = 5;`
- B. `match x { _ => 1 }`
- *C. `fn helper() {}`
- D. `if a { 1 } else { 2 }`
- E. `{ 3 + 4 }`

@why
Rust has exactly two kinds of statement: a `let` binding and an item declaration
(a `fn`, `struct`, `use`, `mod` and so on). Everything else in the language is an
expression, including `match`, `if` and a bare block.

That is why `let x = if c { 1 } else { 2 };` needs no ternary operator, and why
`let a = (let b = 3);` is rejected — `let` produces no value to bind. C's
`a = b = 3` works because assignment is an expression there; the same rule is
what lets `if (x = 0)` compile in C, and Rust closed it by making assignment
evaluate to `()`.

## 7

Which of these type-check in the position marked `??`? Choose all that apply.

```rust
fn port() -> u16 {
    match std::env::var("PORT") {
        Ok(s) => s.parse().unwrap(),
        Err(_) => ??,
    }
}
```

- *A. `panic!("PORT not set")`
- *B. `return 8080`
- *C. `todo!()`
- D. `println!("PORT not set")`
- *E. `std::process::exit(1)`

@why
A, B, C and E all have type `!`, the **never type**: they do not hand control
back, so there is no value that could contradict a claim about their type. A
value of `!` can never exist, so the compiler lets `!` coerce to anything —
including `u16`.

D is the one that fails. `println!` returns normally and evaluates to `()`, which
is a real type with a real value, and `()` is not a `u16`. This is exactly the
difference between logging a problem and dealing with it, made visible by the
type checker.

## 8

How does Rust group this?

```rust
flags & mask == mask
```

- *A. `(flags & mask) == mask`
- B. `flags & (mask == mask)`
- C. It is a syntax error; parentheses are required
- D. It depends on the types involved

@why
Rust puts the bitwise operators **above** comparison in the precedence table, so
the line means what it looks like.

B is the answer in C, and it is one of C's most famous traps: there `&` binds
below `==`, so the expression is `flags & 1` and answers a completely different
question, silently. Rust reordered the table specifically to remove that. Every
precedence habit carried over from C is worth checking once — the shifts also
bind above `&` here, so `1 << n | 1` is `(1 << n) | 1`.

## 9

What does this print?

```rust
let x: i32 = -5;
println!("{}", -x.abs());
```

- A. `5`
- *B. `-5`
- C. `0`
- D. It does not compile

@why
Method calls bind tighter than unary minus, so this is `-(x.abs())`: take the
absolute value, 5, then negate it. The unary minus applies to the result of the
method, not to `x` before the call.

A is what you get from `(-x).abs()`, and the gap between the two is the sort of
thing that survives a code review and fails a test. When a unary operator and a
method call meet, parenthesise the one you meant.

## 10

Does this compile?

```rust
let mut x = 0;
if x = 5 {
    println!("set");
}
```

- A. Yes — it assigns 5 and the condition is true
- *B. No — `x = 5` evaluates to `()`, and a condition must be a `bool`
- C. No — `x` is not mutable enough
- D. Yes, but it warns

@why
Assignment in Rust is an expression that evaluates to `()`, not to the assigned
value. An `if` condition must be a `bool`, so this is `error[E0308]: expected
bool, found ()`, and rustc suggests you meant `==`.

A is the C behaviour, where assignment yields the assigned value and `if (x = 5)`
is a legal, always-true condition — the classic typo that has cost real money.
Rust removed the possibility by giving assignment the one type that can never be
a condition.

## 11

How does Rust parse this?

```rust
for i in 1..n + 1 { }
```

- *A. `1..(n + 1)`
- B. `(1..n) + 1`
- C. It is a syntax error
- D. `1..n`, and the `+ 1` is ignored

@why
The range operator binds very loosely — below arithmetic, below comparison, above
only assignment. So the arithmetic on either side is evaluated first and the
range is built from the results.

That is almost always what you want, and it is worth knowing the direction
because the opposite reading, B, would be a type error rather than a silent
mistake. The one place the looseness surprises people is `..` next to a method
call: `1..v.len() - 1` is `1..((v.len()) - 1)`, which is fine until `v` is empty
and the subtraction overflows.

## 12

Where does `buf` stop existing?

```rust
let checksum = {
    let mut buf = Vec::new();
    fill(&mut buf);
    crc32(&buf)
};
println!("{checksum}");
```

- A. At the end of the enclosing function
- *B. At the closing brace of the block
- C. At the `println!`
- D. It never does; it is moved into `checksum`

@why
The braces are the scope. `buf` is dropped at the closing brace, and the only
thing that leaves the block is the value of its tail expression, `crc32(&buf)`.

This is the everyday use of a block expression: several intermediate values, one
result, and a reader who can see at a glance which is which. It also gives you
control over when a resource is released — a `MutexGuard` created inside a block
unlocks at the brace rather than at the end of the function.

Python readers should note the difference: there an `if` or `for` body is not a
scope, and a name bound inside one is still live afterwards.

## 13

Which of these functions are correct, given `fn f(n: i32) -> i32`? Choose all
that apply.

- *A. `{ n * 2 }`
- B. `{ n * 2; }`
- *C. `{ return n * 2; }`
- *D. `{ if n > 0 { n } else { -n } }`
- E. `{ if n > 0 { return n } }`

@why
A is the idiomatic form. C works and says nothing extra — `return` on the last
line of a function adds a keyword and a semicolon to something the tail
expression already did. D is a tail expression that happens to be an `if`, which
is fine because both branches produce an `i32`.

B is the missing-value error: the semicolon discards the value and the body
becomes `()`.

E fails for a related reason. The `if` has no `else`, so there is a path that
reaches the end of the function without returning, and that path produces `()`.
`return` is for early exit; the last thing in the function still has to produce
a value on every path.

## 14

What does this evaluate to?

```rust
let counts = vec![3, 1, 4];
let x = for c in &counts { };
```

- A. The last element
- B. The number of iterations
- *C. `()`
- D. It does not compile

@why
`for` and `while` always evaluate to `()`. A loop that ends by running out of
items has nothing to hand back, and Rust would rather give you `()` every time
than a value that exists only on some paths.

D is a fair guess — it looks like nonsense and rustc will warn about the
pointless binding — but it is legal code with type `()`. If you want a value out
of an iteration, either use `loop` with `break value`, or use an iterator adapter:
`counts.iter().max()` is the shape that actually answers questions.

## 15

What does an `if` expression cost compared with the equivalent `if` statement
plus a mutable variable?

- A. One extra branch
- B. A temporary on the stack
- *C. Nothing — both compile to the same machine code
- D. It depends on the optimisation level

@why
Expression-oriented code is a source-level shape, not a runtime mechanism. Both
forms become the same conditional move or branch, in debug as well as release,
because there was never a value being constructed and copied — the branches write
into the same slot either way.

What differs is what the compiler can check. `let x = if c { a } else { b };`
requires an `else`, so the uncovered case is a compile error. `let mut x;` with
conditional assignment defers that to a whole-path analysis, and gives you a
mutable binding that the rest of the function can now change. Same code, fewer
states to reason about.
