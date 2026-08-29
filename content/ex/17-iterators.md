---
unit: 17-iterators
---

## 1. The map that never ran

@kind fix
@concept laziness
@expect E0308

`doubled` looks like it doubles every number and hands back a vector. It does
not do either. `map` is an adapter: it wraps the iterator it was called on and
returns immediately, having called the closure zero times.

Nothing has asked for an element yet. Ask.

```starter
pub fn doubled(v: &[i32]) -> Vec<i32> {
    v.iter().map(|x| x * 2)
}

pub fn run() -> Vec<i32> {
    doubled(&[1, 2, 3])
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn doubles_every_element() {
        assert_eq!(run(), vec![2, 4, 6]);
    }
}
```

```solution
pub fn doubled(v: &[i32]) -> Vec<i32> {
    v.iter().map(|x| x * 2).collect()
}

pub fn run() -> Vec<i32> {
    doubled(&[1, 2, 3])
}
```

@hint Read the type rustc says it found. It is not a `Vec` and it is not a list — it is a struct.
@hint Adapters are lazy. Something has to consume the chain before any work happens.
@hint `.collect()` on the end, and the `-> Vec<i32>` return type tells it what to build.

@diagnose E0308
`expected Vec<i32>, found Map<std::slice::Iter<'_, i32>, {closure@...}>`.

That found-type is the whole lesson. `map` did not produce a list of doubled
numbers; it produced a **value of type `Map`** holding two things: the iterator
it was called on, and your closure. Nothing has been doubled, because nothing
has called `next` yet.

The `Map` struct is three words on the stack. It becomes a `Vec` only when a
consumer walks it, and `collect` is that consumer — it reads the type you asked
for and builds it.

Left as it is, this would also draw `warning: unused Map that must be used`,
which exists because dropping an adapter chain on the floor is always a mistake.

@after
Laziness is not a micro-optimisation, it changes what the code costs. A chain
like `v.iter().map(parse).find(is_valid)` on a million-element vector calls
`parse` until the first match and then stops. The eager version parses a million
things and discards 999,999 of them.

It is also why no intermediate collection is ever built:
`.map().filter().map()` on ten thousand items allocates once, at the `collect`,
not three times.

## 2. into_iter takes the whole thing

@kind fix
@concept into_iter
@expect E0382

The sum is correct. The length is not available, because summing ate the vector.

Three methods start an iterator and they differ only in what they do to the
collection. Pick the right one.

```starter
pub fn run() -> (usize, i32) {
    let v = vec![1, 2, 3, 4];
    let sum: i32 = v.into_iter().sum();
    (v.len(), sum)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sums_and_measures() {
        assert_eq!(run(), (4, 10));
    }
}
```

```solution
pub fn run() -> (usize, i32) {
    let v = vec![1, 2, 3, 4];
    let sum: i32 = v.iter().sum();
    (v.len(), sum)
}
```

@hint Nothing here needs to own the numbers. It only needs to add them up.
@hint `into_iter` consumes; `iter` borrows and yields `&i32`.
@hint `v.iter().sum()` — `Sum` is implemented for `&i32` as well as `i32`, so the annotation still works.

@diagnose E0382
`borrow of moved value: v`, with `value moved here` under `v.into_iter()`.

`into_iter` is in the `into_*` family from unit 05: it takes `self`, so calling
it hands the vector over. The iterator now owns the buffer and yields the `i32`s
out of it by value. When the iterator is dropped, so is the buffer.

`v.len()` on the next line has nothing to measure.

The three entry points map exactly onto ownership, with no new rules:

- `v.iter()` — `&Vec<T>` in, `&T` out, `v` survives
- `v.iter_mut()` — `&mut Vec<T>` in, `&mut T` out, `v` survives
- `v.into_iter()` — `Vec<T>` in, `T` out, `v` is gone

@after
`for x in v` is `v.into_iter()` and consumes; `for x in &v` is `v.iter()` and
does not. That is the same choice written with different syntax, and it is the
most common accidental move in real Rust.

Worth noting that `sum()` worked unchanged on `&i32`. The standard library
implements `Sum<&'a i32> for i32` precisely so that borrowing costs you no
`.copied()` here. When it does complain, `.copied()` (for `Copy` types) or
`.cloned()` is the adapter that turns `&T` back into `T`.

## 3. The iterator that has to move

@kind fix
@concept next
@expect E0596

Pulling one element off the front by hand, then collecting the rest. The
signature of `next` is `fn next(&mut self) -> Option<Self::Item>`, and the
binding does not currently allow that.

```starter
pub fn run() -> (Option<char>, String) {
    let it = "a=1".chars();
    let first = it.next();
    let rest: String = it.collect();
    (first, rest)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn takes_one_then_the_rest() {
        assert_eq!(run(), (Some('a'), String::from("=1")));
    }
}
```

```solution
pub fn run() -> (Option<char>, String) {
    let mut it = "a=1".chars();
    let first = it.next();
    let rest: String = it.collect();
    (first, rest)
}
```

@hint Read the signature of `next` again. What does it need from `self`?
@hint Calling a `&mut self` method requires a binding you are allowed to borrow mutably.
@hint `let mut it = "a=1".chars();`

@diagnose E0596
`cannot borrow it as mutable, as it is not declared as mutable`.

`next` is the one required method of `Iterator` and its receiver is `&mut self`,
because advancing is *mutation* — the iterator holds a position and moves it.
Calling `it.next()` therefore needs a `&mut it`, which a plain `let` binding will
not give you.

You never see this in a `for` loop because the desugaring writes the `mut` for
you. It surfaces the moment you drive an iterator by hand, and the fix is one
word.

@after
The interesting part is what survives. After `it.next()` returned `'a'`, the
iterator is still there, positioned after the first character, and `collect`
picks up from exactly that point.

The same is true of every short-circuiting consumer — `any`, `all`, `find`,
`position` all take `&mut self` rather than `self` and stop where they stopped.
`it.any(|c| c == '=')` leaves you an iterator over `"1"`, the `'='` having been
consumed by the test. That is a feature when you meant it and a genuinely
confusing bug when you did not.

## 4. collect into what?

@kind fix
@concept collect
@expect E0282

`collect` is generic over what it produces, and there is nothing here for the
compiler to work it out from. `parts.len()` narrows it down to "something with a
`len`", which is not narrow enough.

```starter
pub fn run() -> usize {
    let words = "one two three";
    let parts = words.split(' ').collect();
    parts.len()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_the_words() {
        assert_eq!(run(), 3);
    }
}
```

```solution
pub fn run() -> usize {
    let words = "one two three";
    let parts: Vec<&str> = words.split(' ').collect();
    parts.len()
}
```

@hint The error is not about the split or the count. It is about a type nobody stated.
@hint `collect` can build a `Vec`, a `String`, a `HashSet`, a `HashMap`, a `Result`… you have to say which.
@hint Annotate the binding: `let parts: Vec<&str> = ...`. Or write `collect::<Vec<&str>>()`.

@diagnose E0282
`type annotations needed` — and rustc points at `collect`, suggesting
`consider giving parts an explicit type`.

Inference normally flows inwards: the arguments to a call fix its result. But
`collect` has no arguments at all. Its signature is
`fn collect<B: FromIterator<Self::Item>>(self) -> B`, and `B` appears only in the
return position, so the only place the answer can come from is the surrounding
code.

`parts.len()` is not enough, because a `Vec`, a `String`, a `HashSet` and a
`BTreeMap` all have `len`.

`E0282` on a `collect` line always means this and never means anything else.

@diagnose E0308
You annotated the binding, but with a type that does not match what the iterator
yields. `split(' ')` on a `&str` yields `&str`, not `String` — it hands back
sub-slices of the original text, which is why splitting a string allocates
nothing. `Vec<&str>` is the annotation you want; `Vec<String>` needs a
`.map(String::from)` before the `collect` to pay for the allocations.

@after
The turbofish is the other spelling: `words.split(' ').collect::<Vec<&str>>()`.
Reach for it when there is no binding to annotate — in the middle of a chain, or
as the final expression of a function whose return type is already something
else.

The habit worth forming: when `collect` fails to compile, the fix is almost
always an annotation rather than a different chain. The chain was fine. It just
never said what it was building.

## 5. filter hands you a reference to a reference

@kind fix
@concept adapter
@expect E0308

`filter` does not take the item. It takes a **reference** to the item, so it can
give it back unchanged to whoever is next in the chain. On an iterator that was
already yielding `&i32`, that makes the closure's argument `&&i32`.

```starter
pub fn big(v: &[i32]) -> Vec<i32> {
    v.iter().filter(|x| x > 2).cloned().collect()
}

pub fn run() -> Vec<i32> {
    big(&[1, 5, 2, 9])
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keeps_the_big_ones() {
        assert_eq!(run(), vec![5, 9]);
    }
}
```

```solution
pub fn big(v: &[i32]) -> Vec<i32> {
    v.iter().filter(|x| **x > 2).copied().collect()
}

pub fn run() -> Vec<i32> {
    big(&[1, 5, 2, 9])
}
```

@hint Count the layers. `v.iter()` yields `&i32`, and `filter` wraps its argument in one more `&`.
@hint Two stars, or a pattern that strips them for you.
@hint `.filter(|x| **x > 2)`, or `.filter(|&&x| x > 2)` which destructures both layers in the pattern.

@diagnose E0308
`mismatched types: expected &&i32, found integer`.

Read the two `&`s separately, because they come from different places. The first
is yours: `v.iter()` borrows the slice and yields `&i32`. The second is
`filter`'s: its closure is `FnMut(&Self::Item) -> bool`, taking the item by
reference so that a rejected element costs nothing and an accepted one can be
passed straight through.

`&i32` wrapped in `filter`'s `&` is `&&i32`, and `&&i32 > 2` has no meaning.

Two fixes, both idiomatic: dereference in the body with `**x`, or destructure in
the pattern with `|&&x|` so `x` is a plain `i32`. The second reads better once
you are used to it.

@diagnose E0277
`cannot multiply/compare ... ` — the same problem stated through the trait
system. `PartialOrd<i32>` is not implemented for `&&i32`, because comparison
against a literal integer is defined on the integer, not on a reference to a
reference to one. Strip the references and the impl is found.

@after
`filter_map` avoids the whole question when you are testing and transforming at
once: `v.iter().filter_map(|x| (*x > 2).then_some(*x))` does one pass instead of
two, and only unwraps once.

Note the swap from `.cloned()` to `.copied()`. Both turn `&T` into `T`; `copied`
requires `T: Copy` and is therefore free and impossible to misuse, while
`cloned` accepts anything `Clone` and may allocate. For `i32`, prefer `copied` —
it documents that nothing was paid for.

## 6. Collect the successes, or the first failure

@kind fix
@concept collect
@expect E0277

Parsing a list of strings where any one of them may fail. The current code
assumes they all succeed, and there is nowhere to put the error.

There is a `collect` that does exactly this, and the type in the signature is
already the hint.

```starter
pub fn parse_all(input: &[&str]) -> Result<Vec<i32>, std::num::ParseIntError> {
    let nums: Vec<i32> = input.iter().map(|s| s.parse::<i32>()).collect();
    Ok(nums)
}

pub fn run() -> (Vec<i32>, bool) {
    (
        parse_all(&["1", "2", "3"]).unwrap(),
        parse_all(&["1", "x", "3"]).is_err(),
    )
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_or_the_first_error() {
        assert_eq!(run(), (vec![1, 2, 3], true));
    }
}
```

```solution
pub fn parse_all(input: &[&str]) -> Result<Vec<i32>, std::num::ParseIntError> {
    input.iter().map(|s| s.parse::<i32>()).collect()
}

pub fn run() -> (Vec<i32>, bool) {
    (
        parse_all(&["1", "2", "3"]).unwrap(),
        parse_all(&["1", "x", "3"]).is_err(),
    )
}
```

@hint The iterator yields `Result<i32, ParseIntError>`, not `i32`. Look at what you asked `collect` to build.
@hint There is a `FromIterator` impl that turns an iterator of `Result`s into a `Result` of a collection.
@hint Delete the intermediate binding and the `Ok(..)`. `collect()` straight into the return type.

@diagnose E0277
`a value of type Vec<i32> cannot be built from an iterator over elements of type
Result<i32, ParseIntError>`.

`collect` builds anything implementing `FromIterator<Item>`. `Vec<i32>`
implements `FromIterator<i32>` — not `FromIterator<Result<i32, E>>` — so the
bound cannot be satisfied and rustc says so in exactly those words.

The impl you want does exist, and it is one of the most useful things in the
library:

```rust
impl<A, E, V: FromIterator<A>> FromIterator<Result<A, E>> for Result<V, E>
```

Read it as: an iterator of `Result`s collects into a `Result` of a collection.
Change the target type and the same `collect` call finds it.

@diagnose E0308
The annotation and the return type disagree. If the binding says `Vec<i32>` and
the function returns `Result<Vec<i32>, _>`, one of them has to give. Removing the
annotation and letting the return type drive `collect` is the shorter fix.

@after
The short-circuit is the part people miss. On `["1", "x", "3"]`, the `"3"` is
never parsed — `collect` sees the first `Err`, stops advancing the iterator and
returns. You get the same behaviour as a hand-written loop with an early
`return`, and you did not write the loop, the `mut` vector, or the `match`.

`Option` has the identical impl, so `collect::<Option<Vec<_>>>()` gives you "all
of them, or nothing". And the target collection is free: `Result<HashMap<_, _>, E>`
works the same way.

## 7. Growing what you are walking

@kind fix
@concept adapter
@expect E0502

Every three-letter name should get an excited duplicate appended. The loop is
reading the vector and writing to it at the same time, which is the one thing
references exist to prevent.

The order matters: the new names go on the end, after all the originals.

```starter
pub fn run() -> Vec<String> {
    let mut names = vec![String::from("ada"), String::from("grace")];

    for n in names.iter() {
        if n.len() == 3 {
            names.push(format!("{n}!"));
        }
    }

    names
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn appends_the_short_ones() {
        assert_eq!(run(), vec!["ada", "grace", "ada!"]);
    }
}
```

```solution
pub fn run() -> Vec<String> {
    let mut names = vec![String::from("ada"), String::from("grace")];

    let extra: Vec<String> = names
        .iter()
        .filter(|n| n.len() == 3)
        .map(|n| format!("{n}!"))
        .collect();

    names.extend(extra);
    names
}
```

@hint You cannot read and grow the same vector at once. Separate the two phases.
@hint Work out the whole list of additions first, into its own `Vec`. The borrow ends when the `collect` finishes.
@hint `filter` then `map` then `collect` into a `Vec<String>`, then `names.extend(extra)`.

@diagnose E0502
`cannot borrow names as mutable because it is also borrowed as immutable`.

`names.iter()` takes a shared borrow, and the iterator holds it for the whole
loop — it has to, since it is pointing into the buffer. `push` needs `&mut
names`. Shared and unique cannot coexist, so it is rejected.

This is not bureaucracy. `push` may find the vector full, ask the allocator for a
larger buffer, copy the elements across and free the old one — leaving the
iterator pointing into freed memory, mid-loop. In C++ this compiles, usually
works, and fails the day the capacity happens to run out at that push. It has a
name there: iterator invalidation.

@diagnose E0499
You reached for `iter_mut()` to get around it. That does not help: `iter_mut`
takes a *unique* borrow for the duration of the loop, and `push` wants a second
one. Two `&mut` to the same vector is `E0499`, and the underlying hazard is the
same reallocation.

@after
Collect-then-apply is the general shape, and it appears constantly: build the
list of changes while borrowing, drop the borrow, then apply them. `retain`,
`drain` and `extend` exist so that the common cases do not need it.

The laziness point is easy to miss here. The borrow does not end when `collect`
is *written*, it ends when `collect` has *finished running* — which is also the
only moment the closures ran at all. Split the chain across a `let` with no
consumer and the borrow simply stays live in the adapter struct, waiting.

## 8. An iterator over somebody else's data

@kind write
@concept iterator
@expect E0106

`Evens` walks a slice and yields only the even numbers. The `next` method is
already written and is correct. What is missing is the part that says how long
the borrowed slice must live.

Implementing `Iterator` gets you `collect`, `map` and `sum` on this type for
free, which is what the tests use.

```starter
pub struct Evens {
    src: &[i32],
    i: usize,
}

impl Iterator for Evens {
    type Item = i32;

    fn next(&mut self) -> Option<i32> {
        while self.i < self.src.len() {
            let x = self.src[self.i];
            self.i += 1;
            if x % 2 == 0 {
                return Some(x);
            }
        }
        None
    }
}

pub fn evens(src: &[i32]) -> Evens {
    Evens { src, i: 0 }
}

pub fn run() -> (Vec<i32>, i32) {
    let data = [1, 2, 3, 4, 6, 7];
    let v: Vec<i32> = evens(&data).collect();
    let s: i32 = evens(&data).map(|x| x * 10).sum();
    (v, s)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn yields_evens_and_adapts() {
        assert_eq!(run(), (vec![2, 4, 6], 120));
    }
}
```

```solution
pub struct Evens<'a> {
    src: &'a [i32],
    i: usize,
}

impl<'a> Iterator for Evens<'a> {
    type Item = i32;

    fn next(&mut self) -> Option<i32> {
        while self.i < self.src.len() {
            let x = self.src[self.i];
            self.i += 1;
            if x % 2 == 0 {
                return Some(x);
            }
        }
        None
    }
}

pub fn evens(src: &[i32]) -> Evens<'_> {
    Evens { src, i: 0 }
}

pub fn run() -> (Vec<i32>, i32) {
    let data = [1, 2, 3, 4, 6, 7];
    let v: Vec<i32> = evens(&data).collect();
    let s: i32 = evens(&data).map(|x| x * 10).sum();
    (v, s)
}
```

@hint A struct holding a reference must name how long that reference is good for. Elision does not apply to struct fields.
@hint Add a lifetime parameter to the struct, use it on the field, and carry it through the `impl` header.
@hint `pub struct Evens<'a> { src: &'a [i32], i: usize }`, then `impl<'a> Iterator for Evens<'a>`, then `fn evens(src: &[i32]) -> Evens<'_>`.

@diagnose E0106
`missing lifetime specifier` on the `src: &[i32]` field, with
`expected named lifetime parameter`.

Lifetime elision works inside function signatures, where there are rules for
guessing. A struct field has no such rules: `Evens` holds a borrow, and the
compiler needs a name to relate the struct's own validity to the slice's. Without
one there is nothing stopping an `Evens` from outliving the data it walks, which
is a dangling pointer.

Three places need the name and missing any one of them keeps the error alive:
the struct definition, the `impl` header (`impl<'a> Iterator for Evens<'a>`), and
the constructor's return type, where `Evens<'_>` says *borrowed from the
argument*.

@diagnose E0261
`use of undeclared lifetime name 'a`. You wrote `&'a [i32]` on the field but did
not declare `'a` on the struct, or you wrote `Evens<'a>` in the `impl` without
the `impl<'a>` that introduces it. A lifetime, like a type parameter, has to be
declared before it is used, and it is declared in the angle brackets on the item.

@diagnose E0207
`the lifetime parameter 'a is not constrained by the impl trait, self type, or
predicates`. This is what you get from `impl<'a> Iterator for Evens` — the `'a`
is declared and then never mentioned in the type being implemented for, so the
compiler cannot tell which `'a` a given impl is about. Put it in the self type:
`for Evens<'a>`.

@after
Fifteen lines of `next` bought `collect`, `map` and `sum` in the tests, and
`zip`, `take`, `filter`, `rev` if you wanted them. That is the whole argument for
the trait: one required method, about seventy default ones written in terms of
it.

Two things worth carrying forward. `Item = i32` here rather than `&'a i32`,
because `i32` is `Copy` and copying four bytes beats an indirection. When the
element is not `Copy`, `Item = &'a T` is the usual answer, and it must borrow
from `'a` rather than from `&mut self` — an iterator cannot hand out references
into itself, which is why there is no `LendingIterator` in the standard library.

And `next` never says how many elements are left. Implementing `size_hint` too
lets `collect` pre-allocate exactly once instead of growing; it is optional, and
free performance when the count is known.
