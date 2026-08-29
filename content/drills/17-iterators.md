---
unit: 17-iterators
---

## 1

How many times is `expensive` called?

```rust
let v = vec![1, 2, 3];
v.iter().map(|x| expensive(*x));
```

- A. Three
- *B. Zero
- C. Once
- D. Three, but the results are discarded

@why
Zero. `map` returns a `Map` struct holding the source iterator and the closure,
and returns immediately. No element is pulled, so the closure never runs.

D is the tempting answer because it is what an eager language would do, and it is
what the code *looks* like it does. The compiler agrees the line is suspicious:
every adapter is `#[must_use]`, so this draws `warning: unused Map that must be
used`. Add a `.collect()`, a `.count()`, or any other consumer and the three
calls happen.

## 2

How many methods must you write to implement `Iterator`?

- *A. One: `next`
- B. Two: `next` and `size_hint`
- C. Three: `next`, `size_hint` and `count`
- D. It depends on which adapters you want to use

@why
One. `fn next(&mut self) -> Option<Self::Item>`, plus the associated type `Item`,
which is not a method.

D is the interesting wrong answer, because it is what you would expect from an
interface. Every other method on `Iterator` is a **default method** with a body
already written in terms of `next`, so implementing `next` gets you all seventy
at once. `size_hint` has a default too, and overriding it lets `collect`
pre-allocate, which is free performance and never required.

## 3

What does this print?

```rust
let n = (1..=2)
    .map(|x| { print!("m{x} "); x })
    .filter(|x| { print!("f{x} "); true })
    .count();
```

- A. `m1 m2 f1 f2`
- *B. `m1 f1 m2 f2`
- C. `f1 m1 f2 m2`
- D. Nothing, `count` does not run the chain

@why
Each element travels the entire chain before the next one is pulled, so the
stages interleave.

A is the answer for an eager pipeline, where `map` builds a complete list and
hands it to `filter`. That list does not exist here, and there is nowhere to put
it.
`count` calls `next` on the `Filter`, which calls `next` on the `Map`, which
calls `next` on the range. One element, all the way down and back, then the next.

## 4

Which of these leave `v` usable afterwards? Choose all that apply.

```rust
let v = vec![String::from("a")];
```

- *A. `v.iter().count()`
- B. `v.into_iter().count()`
- *C. `for s in &v {}`
- D. `for s in v {}`
- *E. `v.len()`

@why
`iter()` takes `&self` and `into_iter()` takes `self`. That is the whole
distinction, and it is ownership from unit 05 with no new rules attached.

D is the one that catches people in real code, because there is no visible method
call. `for s in v` calls `IntoIterator::into_iter(v)`, which consumes. `for s in
&v` selects the impl on `&Vec<T>` and yields `&String`. One ampersand is the
difference between keeping the vector and losing it.

## 5

What is the type of `x` inside the closure?

```rust
let v = vec![1, 2, 3];
v.iter().filter(|x| ...);
```

- A. `i32`
- B. `&i32`
- *C. `&&i32`
- D. `Option<&i32>`

@why
Two references, from two different places. `v.iter()` yields `&i32`. Then
`filter`'s closure is `FnMut(&Self::Item) -> bool`. It takes the item by
reference so a rejected element costs nothing and an accepted one passes straight
through untouched. `&` applied to `&i32` is `&&i32`.

B is the natural guess and gives `error[E0308]: expected &&i32`. Fix it with
`**x` in the body, or `|&&x|` in the pattern, which strips both layers and gives
you a plain `i32`.

## 6

What does this evaluate to?

```rust
[1, 5, 2, 1].iter().take_while(|n| **n < 3).count()
```

- *A. 1
- B. 2
- C. 3
- D. 4

@why
`take_while` **stops** at the first element that fails the predicate. `1` passes,
`5` fails, iteration ends. The `2` and the second `1` are never looked at.

B and C are the `filter` answers: `filter` skips failures and keeps going, so it
would yield `1`, `2`, `1` for three. The two adapters read almost identically and
mean entirely different things, and `take_while` additionally *consumes* the
element that failed: the `5` has been pulled out of the source and is gone.

## 7

Why does this not compile?

```rust
let parts = "a,b".split(',').collect();
parts.len();
```

- A. `split` does not return an iterator
- *B. `collect` cannot tell what type to build
- C. `parts` needs to be `mut`
- D. `&str` cannot be collected

@why
`error[E0282]: type annotations needed`. `collect` is
`fn collect<B: FromIterator<Self::Item>>(self) -> B`, and `B` appears only in the
return position, so nothing about the call fixes it.

C is the plausible distractor and would be right for a different error entirely.
`parts.len()` is not enough of a hint, because `Vec`, `String`, `HashSet` and
`BTreeMap` all have `len`. Annotate the binding, or turbofish:
`collect::<Vec<&str>>()`.

## 8

What is the value of `r`?

```rust
let r: Result<Vec<i32>, _> =
    ["1", "x", "3"].iter().map(|s| s.parse::<i32>()).collect();
```

- A. `Ok(vec![1, 3])`: the failure is skipped
- *B. `Err(ParseIntError)`, and `"3"` was never parsed
- C. `Ok(vec![1])`: it stops and keeps what it had
- D. It does not compile

@why
There is a `FromIterator<Result<A, E>> for Result<V, E>` impl. All `Ok` gives
`Ok` of the collection; the first `Err` is returned immediately and the iterator
is not advanced again.

C is the appealing wrong answer: it sounds like `take_while`. But a `Result` has
room for either a collection or an error, not both, so there is nowhere for the
partial vector to go. The short-circuit is the point. You get the same behaviour
as a hand-written loop with an early `return`, without the loop.

## 9

Which of these compile? Choose all that apply.

```rust
let it = "abc".chars();
```

- A. `it.next()`
- *B. `let mut it = "abc".chars(); it.next()`
- *C. `for c in "abc".chars() {}`
- *D. `"abc".chars().count()`

@why
`next` takes `&mut self`, because advancing an iterator mutates it: the position
is state. Calling it needs a binding you are allowed to borrow mutably, so A is
`error[E0596]` and B is the fix.

C works because the `for` desugaring writes the `mut` for you. D works because
`count` takes `self` by value, so it can consume the temporary directly. You only
meet this error when you drive an iterator by hand, which is exactly when it is
most surprising.

## 10

After this runs, what does `rest` contain?

```rust
let mut it = "key=value".chars();
let found = it.any(|c| c == '=');
let rest: String = it.collect();
```

- A. `"key=value"`
- B. `"=value"`
- *C. `"value"`
- D. `""`: `any` consumed the whole iterator

@why
`any` takes `&mut self`, not `self`. It short-circuits at the first `true` and
leaves the iterator sitting immediately after the element that matched, so the
`'='` has been consumed and `"value"` remains.

D is the intuitive answer if you assume consumers always exhaust their input.
`any`, `all`, `find` and `position` all stop early and all borrow rather than
consume, which makes `find`-then-`collect` a genuinely useful pattern and makes
accidental partial consumption a genuinely confusing bug.

## 11

What is the run-time cost of the adapter chain compared with the hand-written
loop?

```rust
(0..n).filter(|x| x % 3 == 0).map(|x| x * x).sum::<u64>()
```

- A. One allocation per adapter
- B. One virtual call per element per adapter
- *C. None, it compiles to the same loop
- D. A closure allocation, then none

@why
`Sum<Map<Filter<Range>>>` is one struct built from three, entirely on the stack.
Every closure is a unique unnameable type, so each `next` call is statically
known and gets inlined into the one above it. What survives optimisation is a
counter, a modulo, a multiply and an add.

B describes what this would cost in a language where the callback is a function
pointer or an object. Rust monomorphises instead, so there is no vtable and
nothing to guess at. Often the iterator version is *faster* than the index loop,
because `v[i]` bounds-checks on every access and `for x in &v` cannot walk off
the end by construction.

## 12

Which produces overlapping pairs `[3,7]`, `[7,4]`, `[4,9]`?

```rust
let temps = [3, 7, 4, 9];
```

- *A. `temps.windows(2)`
- B. `temps.chunks(2)`
- C. `temps.iter().zip(temps.iter())`
- D. `temps.iter().take(2)`

@why
`windows(2)` slides by one and overlaps; `chunks(2)` steps by the width and gives
`[3,7]`, `[4,9]`. Both are slice methods rather than `Iterator` adapters, because
they need contiguous memory that a general iterator does not have.

C is the near miss and worth understanding: `zip` of an iterator with itself
pairs each element with itself, giving `(3,3)`, `(7,7)`. The offset version,
`temps.iter().zip(temps.iter().skip(1))`, does produce the overlapping pairs,
which is exactly what `windows` is for.

## 13

An iterator returned `None`. What may it return on the next call?

- A. Only `None`: that is the contract
- *B. Anything; `None` is not final unless the iterator is fused
- C. It panics
- D. Undefined behaviour

@why
The `Iterator` trait makes no promise that `None` is permanent, and some
iterators deliberately resume: a channel receiver, or a file being appended to.

A is what almost everyone assumes and it is why `.fuse()` exists: it wraps an
iterator so that the first `None` latches and every later call returns `None`.
Adapters that need the guarantee call it internally. Write your own `next` so
that it stays `None`; do not rely on anyone else's doing so.

## 14

Which is the cheaper way to get a `Vec<i32>` from `v: &[i32]`?

- A. `v.iter().map(|x| x.clone()).collect()`
- *B. `v.iter().copied().collect()`
- C. `v.into_iter().collect()`
- D. They are all identical

@why
`copied` requires `T: Copy`, so it is a byte copy that can never allocate and can
never be a mistake. `cloned` and `.map(Clone::clone)` accept anything `Clone`,
which for `i32` compiles to the same thing but for `String` would be an
allocation per element.

D is defensible for `i32` specifically, because the optimiser flattens all
three. It is wrong as a habit: `copied` documents in the type that nothing was paid for, and
fails to compile the day someone changes the element type to something expensive.
C is a different thing again: `into_iter` on a `&[i32]` yields `&i32`, not `i32`,
because the impl selected is the one on the reference.

## 15

Which of these allocate? Choose all that apply.

```rust
let words = vec!["ada", "grace"];
```

- A. `words.iter().map(|w| w.len())`
- *B. `words.iter().map(|w| w.len()).collect::<Vec<usize>>()`
- C. `words.iter().filter(|w| w.len() > 3)`
- *D. `words.iter().map(|w| w.to_uppercase()).collect::<Vec<String>>()`

@why
Adapters allocate nothing. They build a struct on the stack holding the source
iterator and the closure, and that is the entire cost until a consumer runs.

B allocates once, for the `Vec`. D allocates once per element for the
`to_uppercase` and once for the `Vec`, so three allocations. A and C allocate
nothing at all and, with no consumer, also *compute* nothing at all.

The general shape: intermediate stages are free, and the number of allocations in
a chain is the number of owned collections and owned strings you asked for, not
the number of adapters you wrote.
