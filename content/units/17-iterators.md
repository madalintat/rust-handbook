---
num: 17
slug: 17-iterators
title: Iterators
accent: plum
concepts: iterator, next, laziness, adapter, consumer, into_iter, collect, turbofish, fuse, zero-cost abstraction
needs: 05-ownership, 14-traits, 16-closures
blurb: One required method buys about seventy free ones, none of which run until something asks for an element.
---

%% `Iterator` is the best argument for traits in the whole standard library, and the argument is arithmetic. The trait requires **one** method. It gives back about seventy. Write `next` for your type and `map`, `filter`, `zip`, `sum`, `rev` and `collect` arrive with it, already written, already fast.

The second fact is the one people trip over: calling an adapter does nothing at all.

## One required method

### The whole trait

```rust
pub trait Iterator {
    type Item;

    fn next(&mut self) -> Option<Self::Item>;

    // ~70 more, every one with a default body written in terms of next
}
```

`next` advances the iterator and yields `Some(item)`, or `None` when it is
finished. That is the entire contract. `map`, `filter`, `sum`, `fold`, `collect`
are **default methods**, code that already exists in the trait and calls `next`
through `Self`. Implement `next` and you inherit all of it without writing a
line.

:::note
This is what a trait with default methods is for. One required method, seventy
free ones, monomorphised per type so none of them cost anything at run time.
:::

### `for` is `next` in a loop

```rust
for line in text.lines() {
    println!("{line}");
}
```

is sugar for approximately

```rust
let mut it = IntoIterator::into_iter(text.lines());
while let Some(line) = it.next() {
    println!("{line}");
}
```

There is no separate iteration protocol in the language and no special case in
the compiler. `for` calls one trait method until it returns `None`, which is why
anything implementing `Iterator` works in a `for` loop with no registration
anywhere.

## Nothing runs until something asks

### The adapter that did not adapt

```rust
let names = vec!["ada", "grace"];
names.iter().map(|n| expensive(n));   // warning: unused `Map` that must be used
```

`expensive` is never called. Not once. `map` does not map. It *returns a struct*
called `Map` holding the source iterator and the closure, and that struct sits
there doing nothing until somebody calls `next` on it. Every adapter is like
this, which is why they all carry `#[must_use]`: dropping one on the floor is
always a bug, and it is a common enough bug to be worth a warning.

:::memory an adapter chain is a nested struct
     v.iter().filter(p).map(f)

     ┌──────────────────────────────────┐
     │ Map { f }                        │  ◀── .next() asked here
     │   ┌──────────────────────────┐   │
     │   │ Filter { p }             │   │      each layer calls
     │   │   ┌──────────────────┐   │   │      next() on the one inside
     │   │   │ Iter { ptr, end }│   │   │
     │   │   └──────────────────┘   │   │
     │   └──────────────────────────┘   │
     └──────────────────────────────────┘
     three words on the stack. No Vec, no allocation, no intermediate list.
:::

### One element at a time, not one stage at a time

```rust
let n = (1..=3)
    .map(|x| { println!("map {x}"); x * 2 })
    .filter(|x| { println!("filter {x}"); *x > 2 })
    .count();
```

prints `map 1`, `filter 2`, `map 2`, `filter 4`, `map 3`, `filter 6`. Each
element travels the entire chain before the next one is pulled. The stages
interleave because no intermediate collection exists to hold one.

:::compare
**Python**: a list comprehension `[f(x) for x in xs]` builds the whole list;
`map`/`filter`/generators are lazy like Rust's. **Java** streams and **C++20**
ranges match Rust closely. **Go** has neither, so the loop is written out.

The consequence is practical, not aesthetic: `v.iter().map(parse).find(ok)` on a
million-element vector calls `parse` until the first hit and then stops. The
eager version parses a million things and throws away 999,999 of them.
:::

## The three ways in

| call | yields | what happens to the collection |
|---|---|---|
| `v.iter()` | `&T` | borrowed; `v` is usable afterwards |
| `v.iter_mut()` | `&mut T` | borrowed uniquely, so you may write through it |
| `v.into_iter()` | `T` | consumed; `v` is moved and gone |

That is ownership from unit 05 with nothing added. An iterator is just another
value that holds either a borrow or the thing itself.

```rust
for s in &v      { }   // iter()      → s: &String,     v survives
for s in &mut v  { }   // iter_mut()  → s: &mut String, v survives
for s in v       { }   // into_iter() → s: String,      v is moved
```

`for` reaches its decision by calling `IntoIterator::into_iter` on whatever it
was given, and `&Vec<T>`, `&mut Vec<T>` and `Vec<T>` are three different types
with three different impls.

:::gotcha
`into_iter` on a *reference* does not give you owned items. `(&v).into_iter()`
yields `&T`, because the impl it selects is the one on `&Vec<T>`.

This bites in generic code: a function taking `impl IntoIterator<Item = String>`
will not accept `&v`, and the error talks about `&String` where `String` was
expected. The name `into_` describes only one of the three impls.
:::

## Adapters and consumers

### Adapters worth knowing

| adapter | yields | the thing to remember |
|---|---|---|
| `map(f)` | `f(x)` | |
| `filter(p)` | items where `p` holds | `p` receives `&Item`, so on `.iter()` that is `&&T` |
| `filter_map(f)` | the `Some`s of `f(x)` | one pass instead of `filter().map()` |
| `enumerate()` | `(usize, x)` | counts the *iterator*, so after `skip(3)` it starts at 0 |
| `zip(other)` | `(a, b)` | stops when the shorter one does |
| `take(n)` / `skip(n)` | prefix / suffix | |
| `take_while(p)` / `skip_while(p)` | up to / from the first failure | not `filter` |
| `chain(other)` | all of one, then all of the other | |
| `flatten()` | the items of the items | flattens `Option` and `Result` too |
| `flat_map(f)` | `map(f).flatten()` | |
| `rev()` | back to front | needs `DoubleEndedIterator` |
| `peekable()` | the same items, plus `peek()` | how hand-written parsers are shaped |

:::gotcha
`take_while` is not `filter`.

```rust
let v = [1, 5, 2];
v.iter().take_while(|n| **n < 3).count();   // 1: the 5 ends it, 2 is never seen
v.iter().filter(|n| **n < 3).count();       // 2
```

`take_while` also *consumes* the element that failed. It has already been pulled
out of the source iterator and is not there for anyone else.
:::

`windows` and `chunks` are slice methods, not adapters, because they need to look
at contiguous memory that a general iterator does not have:

```rust
let temps = [3, 7, 4, 9];
let rises = temps.windows(2).filter(|w| w[1] > w[0]).count();   // 2 (overlapping)
let pairs = temps.chunks(2);                                     // [3,7] [4,9] (no overlap)
```

### Consumers

Something has to call `next`, and that something is a consumer.

| consumer | gives back |
|---|---|
| `collect()` | anything implementing `FromIterator` |
| `sum()` / `product()` | one number |
| `fold(init, f)` | one value: the operation the rest are built from |
| `count()` / `last()` / `nth(n)` | |
| `any(p)` / `all(p)` / `find(p)` / `position(p)` | short-circuiting |
| `min_by_key(f)` / `max_by_key(f)` | an `Option` |
| `partition(p)` | two collections |
| `for_each(f)` | `()` |

```rust
let total = v.iter().fold(0, |acc, x| acc + x);   // sum(), written out longhand
```

:::gotcha
`any`, `all`, `find` and `position` take `&mut self`, not `self`. They stop at
the answer and leave the iterator sitting exactly where they stopped:

```rust
let mut it = "key=value".chars();
let ok = it.any(|c| c == '=');       // true, and '=' has been consumed
let rest: String = it.collect();     // "value"
```

That is a feature when you meant it and a very confusing bug when you did not.
:::

## collect, and the one that surprises people

### It is generic over its return type

```rust
let v: Vec<i32>      = (1..4).collect();
let s: String        = vec!['h', 'i'].into_iter().collect();
let m: HashMap<_, _> = vec![("a", 1)].into_iter().collect();
let n                = (1..4).collect::<Vec<i32>>();   // turbofish instead
```

Inference normally flows inwards from arguments. `collect` has no arguments, so
the target type has to come from the annotation on the binding or from a
**turbofish**. `error[E0282]: type annotations needed` on a `collect` line always
means this and never means anything else.

### `collect::<Result<Vec<_>, _>>()`

```rust
let nums: Result<Vec<i32>, _> =
    ["1", "2", "x", "4"].iter().map(|s| s.parse::<i32>()).collect();
// Err(ParseIntError { .. });  "4" was never parsed
```

An iterator of `Result<T, E>` collects into `Result<Vec<T>, E>`. All `Ok` gives
the vector; the first `Err` is returned immediately and the rest of the iterator
is never advanced. One method replaces a loop, a `mut` vector, a `match` and an
early `return`, and it short-circuits, which the hand-written loop usually forgets
to do.

The same impl exists for `Option`, and for every target collection, so
`Result<HashMap<_, _>, E>` works identically.

## Writing your own

```rust
struct Fib { a: u64, b: u64 }

impl Iterator for Fib {
    type Item = u64;

    fn next(&mut self) -> Option<u64> {
        let out = self.a;
        self.a = self.b;
        self.b = out + self.b;
        Some(out)
    }
}

let first_ten: Vec<u64> = Fib { a: 0, b: 1 }.take(10).collect();
```

Nine lines, and `Fib` now has `take`, `zip`, `sum`, `skip_while`, `collect` and
the rest of the seventy. It never returns `None`, which is fine: an infinite
iterator is only a problem if something consumes all of it, and laziness means
nothing does until you say so.

:::gotcha
Returning `None` is not a promise. The trait permits an iterator to yield `Some`
again afterwards, and some deliberately do. Adapters that need the guarantee call
`.fuse()`, which latches `None` permanently.

Make your own `next` stay `None`. Do not assume anyone else's does.
:::

## What the optimiser does next

### One instruction, four numbers

Once an adapter chain has become a plain loop, it becomes eligible for something
better. A modern CPU can add four or eight `f32` values in a single instruction,
and LLVM will rewrite a loop to use those instructions when it can prove the
iterations are independent and the count is known.

```rust
pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}
```

That compiles to a loop over four-wide SIMD multiplies and adds, not to four
separate scalar operations. The iterator version is often easier for LLVM to
vectorise than the index version, because `zip` establishes that both slices are
walked in step and no bounds check survives inside the body.

:::gotcha
Floating point addition is not associative, so summing in a different order can
give a different answer. LLVM will not reorder your `f32` sum without permission,
which means `sum()` over floats stays scalar. That is a correctness decision, not
a missed optimisation, and it is why numerical libraries expose an explicit
"fast math" opt-in rather than silently taking it.

Integer sums have no such problem and do vectorise.
:::

`std::simd` exists on nightly for the cases where you want to say it explicitly
rather than hope the optimiser noticed. Reach for it after you have looked at the
generated assembly, not before.

## The zero-cost claim

```rust
(0..n).filter(|x| x % 3 == 0).map(|x| x * x).sum::<u64>()
```

compiles to the same machine code as the `for` loop with an `if` in it. That is
worth justifying rather than asserting, and the justification is three steps:

1. **The chain is a value, not a pipeline.** `Sum<Map<Filter<Range>>>` is one
   struct built from three, entirely on the stack. Nothing is allocated and no
   intermediate `Vec` is ever built.
2. **Every call is statically known.** The closures are unique unnameable types,
   so `Filter::next` calls *this* predicate directly, rather than through a
   function pointer or a vtable.
3. **So it all inlines.** `Range::next` into `Filter::next` into `Map::next` into
   the loop inside `sum`. What is left after inlining is a counter, a modulo, a
   multiply and an add.

The loop you would have written, arrived at by inlining rather than by trust.

Often it is faster than the index loop, for a reason worth knowing: `for i in
0..v.len() { v[i] }` performs a bounds check on every access, because the
compiler must prove `i` is in range at each one. `for x in &v` performs none,
because the iterator holds the end pointer and cannot walk off it by
construction.

:::note
The costs are real but they are not run time. A chain of eight adapters is a type
eight layers deep, so a mistake in the middle prints all eight in the error, and
the compiler has more to inline. You pay in compile time and in the width of your
diagnostics.
:::
