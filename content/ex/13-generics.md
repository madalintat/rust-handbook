---
unit: 13-generics
---

## 1. One function, two element types

@kind fix
@concept generic
@expect E0308

`first` does nothing that depends on `i32`. It reads slot zero and hands it back.
But its signature nails it to one element type, so the second call site is
rejected.

Lift the element type out into a type parameter. The body should not change at
all.

```starter
pub fn first(v: &[i32]) -> i32 {
    v[0]
}

pub fn run() -> (i32, char) {
    (first(&[3, 9, 2]), first(&['r', 'u', 's', 't']))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn works_for_both() {
        assert_eq!(run(), (3, 'r'));
    }
}
```

```solution
pub fn first<T: Copy>(v: &[T]) -> T {
    v[0]
}

pub fn run() -> (i32, char) {
    (first(&[3, 9, 2]), first(&['r', 'u', 's', 't']))
}
```

@hint The function body works for any element type. Only the signature disagrees.
@hint Declare a type parameter after the name — `fn first<T>(...)` — and use `T` where `i32` appears.
@hint Returning `T` by value out of a `&[T]` needs a way to duplicate it: `pub fn first<T: Copy>(v: &[T]) -> T`.

@diagnose E0308
`expected &[i32], found &[char; 4]`. rustc checked the second call against the
signature it was given, and the signature says `i32`. Nothing about the body
matters here — a signature is a contract, and the body does not get a vote.

Note the shape of the fix. You are not making the function accept two types at
once; you are making the *type itself* a parameter, so that `first::<i32>` and
`first::<char>` become two separate functions the compiler writes for you. After
monomorphisation there really are two, each with `i32` and `char` baked in.

@diagnose E0507
`cannot move out of index of &[T]`. You made the function generic but left the
return type as an owned `T`, and moving a value out of a slice you only borrowed
would leave a hole in someone else's data.

Two ways out: bound `T: Copy` so duplicating the bytes is legal, or return `&T`
and let the caller borrow. The tests want owned values back, so `T: Copy` is the
shorter road here.

@after
`T: Copy` is the smallest bound that makes this work, and picking the smallest
bound is the habit worth forming. `T: Clone` would also compile with
`v[0].clone()`, but it promises less to the caller and costs a possible
allocation. `T: Ord` would compile and be a lie, since nothing here compares
anything.

Every bound you add is a requirement on every future caller. Add the ones the
body actually needs and no others.

## 2. A bare T can do almost nothing

@kind fix
@concept trait bound
@expect E0277

The type parameter is there, the body is one line, and it still will not compile.
The reason is the single most important fact about Rust generics: `T` means
*every type*, including ones that cannot do what you are asking.

```starter
pub fn label<T>(x: T) -> String {
    format!("[{x}]")
}

pub fn run() -> (String, String) {
    (label(7), label("ferris"))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn labels_anything_printable() {
        assert_eq!(run(), (String::from("[7]"), String::from("[ferris]")));
    }
}
```

```solution
use std::fmt::Display;

pub fn label<T: Display>(x: T) -> String {
    format!("[{x}]")
}

pub fn run() -> (String, String) {
    (label(7), label("ferris"))
}
```

@hint `{x}` in a format string is not free. It calls a trait method, and `T` has not promised to have it.
@hint The trait behind `{}` is `std::fmt::Display`. Require it.
@hint `pub fn label<T: std::fmt::Display>(x: T) -> String`.

@diagnose E0277
`` `T` doesn't implement `std::fmt::Display` ``, with the note *`T` cannot be
formatted with the default formatter*.

Read where the error points: at the **definition**, not at either call site. Both
your calls pass perfectly printable types. rustc has not looked at them. It is
checking the generic body once, on its own terms, and on its own terms `T` could
be a `File`, a raw pointer or a closure — none of which can be displayed.

That is the deal generics make. The body may use only what the bounds promise;
in exchange, once the body compiles it compiles for every `T` a caller can
supply, and a bad call is reported at the call site rather than inside your
function. C++ templates make the opposite deal, which is why their errors arrive
as instantiation traces.

@after
The help text rustc prints is the fix, verbatim: *consider restricting type
parameter `T`: `T: std::fmt::Display`*. It is right nearly every time, and
reading it as a suggestion rather than a scolding will save you hours.

Worth knowing which trait sits behind which syntax, because each one is a bound
you may end up writing: `{}` is `Display`, `{:?}` is `Debug`, `+` is `Add`, `==`
is `PartialEq`, `<` is `PartialOrd`, `[i]` is `Index`, `*x` is `Deref`. Operators
in Rust are traits with punctuation for a name.

## 3. The struct is generic; the impl block is where the bound goes

@kind fix
@concept trait bound
@expect E0599

`Cache` hands out a copy of the value it holds and counts how many times it was
asked. Holding a `T` is fine. Duplicating one is not — not yet.

Fix the impl block, and leave the struct declaration alone.

```starter
pub struct Cache<T> {
    value: T,
    hits: usize,
}

impl<T> Cache<T> {
    pub fn new(value: T) -> Self {
        Cache { value, hits: 0 }
    }

    pub fn get(&mut self) -> T {
        self.hits += 1;
        self.value.clone()
    }

    pub fn hits(&self) -> usize {
        self.hits
    }
}

pub fn run() -> (String, String, usize) {
    let mut c = Cache::new(String::from("config"));
    let a = c.get();
    let b = c.get();
    (a, b, c.hits())
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hands_out_copies_and_counts() {
        assert_eq!(run(), (String::from("config"), String::from("config"), 2));
    }
}
```

```solution
pub struct Cache<T> {
    value: T,
    hits: usize,
}

impl<T: Clone> Cache<T> {
    pub fn new(value: T) -> Self {
        Cache { value, hits: 0 }
    }

    pub fn get(&mut self) -> T {
        self.hits += 1;
        self.value.clone()
    }

    pub fn hits(&self) -> usize {
        self.hits
    }
}

pub fn run() -> (String, String, usize) {
    let mut c = Cache::new(String::from("config"));
    let a = c.get();
    let b = c.get();
    (a, b, c.hits())
}
```

@hint `get` needs to produce an owned `T` while keeping the one it stores. That is a specific capability with a specific trait.
@hint The bound belongs on the `impl` block, not on `struct Cache<T>`.
@hint `impl<T: Clone> Cache<T> { ... }`.

@diagnose E0599
`` no method named `clone` found for type parameter `T` in the current scope ``.

The method genuinely does not exist. `T` is unconstrained, so the only methods
available on it are the ones every type in the language has — which is none.
rustc adds the note *the method is available for `T` if `T: Clone`*, which is the
whole diagnosis.

This is the confusing member of the error family, because the message sounds like
a typo or a missing import. It is neither. A missing method on a *concrete* type
usually means a bad name or a trait not in scope. A missing method on a **type
parameter** almost always means a missing bound.

@after
Notice where the bound went. Putting it on the struct —
`struct Cache<T: Clone>` — would compile too, and it is the wrong move. A bound
on a struct propagates: every `impl`, every function taking a `Cache`, every
other struct holding one must now repeat it, and `Cache<File>` becomes
unconstructible even though storing a file is perfectly sensible.

Bound the `impl` block that needs the capability. `HashMap<K, V>` is declared
with no bounds on `K` at all; `Eq + Hash` appears only on the impl block holding
`insert` and `get`. The standard library is consistent about this and so should
you be.

## 4. Comparison is a trait too

@kind fix
@concept trait bound
@expect E0277

`largest` asks an iterator for its maximum. That sounds like a property of
iterators, but ordering is not something every type has — how would you order two
closures? — so it is spelled as a bound.

```starter
pub fn largest<T>(v: &[T]) -> &T {
    v.iter().max().unwrap()
}

pub fn run() -> (i32, char) {
    (*largest(&[3, 9, 2]), *largest(&['r', 'u', 's', 't']))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finds_the_max() {
        assert_eq!(run(), (9, 'u'));
    }
}
```

```solution
pub fn largest<T: Ord>(v: &[T]) -> &T {
    v.iter().max().unwrap()
}

pub fn run() -> (i32, char) {
    (*largest(&[3, 9, 2]), *largest(&['r', 'u', 's', 't']))
}
```

@hint Read `Iterator::max` in the docs and note the bound on its `where` clause.
@hint `max` requires the item type to be totally ordered. The item here is `&T`, and `&T` is ordered exactly when `T` is.
@hint `pub fn largest<T: Ord>(v: &[T]) -> &T`.

@diagnose E0277
`` the trait bound `&T: Ord` is not satisfied ``, with a note pointing at
`Iterator::max`, whose signature is `fn max(self) -> Option<Self::Item> where Self::Item: Ord`.

The item type here is `&T`, because `v.iter()` yields references. The standard
library provides `impl<T: Ord> Ord for &T` — a reference is ordered whenever what
it points at is — so the requirement `&T: Ord` reduces to `T: Ord`, and that is
the bound to write. rustc says as much in its help line.

Do not be thrown by the error naming a type you never wrote. `&T` came from
`.iter()`. Following the chain from the reported bound back to the call that
demanded it is most of the skill in reading `E0277`.

@diagnose E0369
`` binary operation `>` cannot be applied to type `&T` ``. You rewrote the body
as an explicit loop with `if x > best`, and comparison operators are trait
methods like everything else — `>` is `PartialOrd::gt`.

The bound that fixes the loop is `T: PartialOrd`, which is weaker than the `Ord`
that `max` wants. Both are correct for this exercise. The difference is that
`PartialOrd` allows values that compare to *nothing*, which is why `f64` has
`PartialOrd` but not `Ord`: `NaN` is neither less than, equal to, nor greater
than anything, including itself.

@after
`Ord` versus `PartialOrd` is a real distinction, not a historical accident.
`Ord` promises a total order — any two values compare, and the result is
consistent — which is what `sort`, `max` and `BTreeMap` need to be correct.
`PartialOrd` promises only that comparison is *possible*, and floats are the
reason it exists.

The practical consequence is that `vec![1.0, 2.0].sort()` does not compile.
You need `sort_by(|a, b| a.partial_cmp(b).unwrap())` or, better,
`sort_by(f64::total_cmp)`, because you have to say what should happen to `NaN`.

## 5. A length can be a parameter

@kind fix
@concept const generics
@expect E0308

`checksum` takes an array, not a slice, so its length is part of its type. Two
call sites, two lengths, one signature — and arrays of different lengths are
different types.

The parameter you need here is a value, not a type.

```starter
pub fn checksum(a: [u8; 4]) -> u32 {
    a.iter().map(|b| *b as u32).sum()
}

pub fn run() -> (u32, u32) {
    (checksum([1, 2, 3, 4]), checksum([10, 20, 30, 40, 50, 60]))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sums_any_length() {
        assert_eq!(run(), (10, 210));
    }
}
```

```solution
pub fn checksum<const N: usize>(a: [u8; N]) -> u32 {
    a.iter().map(|b| *b as u32).sum()
}

pub fn run() -> (u32, u32) {
    (checksum([1, 2, 3, 4]), checksum([10, 20, 30, 40, 50, 60]))
}
```

@hint `[u8; 4]` and `[u8; 6]` are as different as `u8` and `String`. The length is in the type.
@hint A generic parameter does not have to be a type. It can be a compile-time constant.
@hint `pub fn checksum<const N: usize>(a: [u8; N]) -> u32`.

@diagnose E0308
`expected an array with a fixed size of 4 elements, found one with 6 elements`.

An array's length is part of its type, which is exactly why arrays live on the
stack: the compiler needs the size to lay out the frame. `[u8; 4]` and `[u8; 6]`
are unrelated types that happen to look similar.

Two fixes, and they are genuinely different designs. `<const N: usize>` keeps the
array — one monomorphised copy per distinct length, each with the bound baked in
as a constant, which is how the loop gets fully unrolled. Taking `&[u8]` instead
gives one function for all lengths, at the cost of carrying a length at runtime
and losing the unrolling.

@after
Const generics are the reason `[T; N]` behaves like a real type at all. Before
they landed, the standard library wrote out `impl Debug for [T; 0]`,
`impl Debug for [T; 1]` and so on by hand up to 32, and arrays of 33 elements
simply did not implement the traits.

The rule for choosing: take `[u8; N]` when the size is genuinely known at each
call and you want it constant-folded — a fixed-size hash block, a matrix
dimension, an embedded buffer. Take `&[u8]` the rest of the time, which is most
of the time.

## 6. When inference runs out

@kind fix
@concept turbofish
@expect E0284

Nothing here is generic that you wrote. The problem is a standard library
function that is generic in its *return* type, with no argument to infer it from.

```starter
pub fn run() -> String {
    let n = "42".parse().unwrap();
    format!("{n} doubled is {}", n * 2)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_and_doubles() {
        assert_eq!(run(), "42 doubled is 84");
    }
}
```

```solution
pub fn run() -> String {
    let n = "42".parse::<i64>().unwrap();
    format!("{n} doubled is {}", n * 2)
}
```

@hint `str::parse` returns `Result<F, F::Err>` where `F` is chosen by the caller. Nothing on this line chooses it.
@hint Two places can say it: an annotation on the binding, or an annotation on the call.
@hint `"42".parse::<i64>()` — the `::<>` is the turbofish. `let n: i64 = "42".parse().unwrap();` works equally well.

@diagnose E0284
`type annotations needed`, with the note *cannot satisfy
`<_ as FromStr>::Err == _`* and a suggestion to write `parse::<F>`.

`parse` is declared `fn parse<F: FromStr>(&self) -> Result<F, F::Err>`. `F`
appears only in the return type, so there is no argument for inference to work
backwards from. `u8`, `i64`, `f32`, `bool` and `IpAddr` are all valid answers.

The specific complaint is about the *error* half. Before rustc can decide what
`.unwrap()` returns it must know `F::Err`, an associated type it cannot look up
until `F` is pinned down. That is why the message names a type you never wrote:
it is the consequence, and `F` is the cause.

Integer literals do fall back to `i32` when nothing else constrains them — that
is why `let x = 5;` needs no annotation. The fallback applies to *literals*, not
to an unresolved generic parameter, so `n * 2` does not rescue this.

@diagnose E0282
`type annotations needed`, plainly, pointing at `let n`. The same cause reported
without the associated-type detail — you will see this form when the unresolved
parameter is not behind a `Result`. Name the type at the call with a turbofish,
or on the binding with `let n: i64`.

@after
The name is a joke about the shape — `::<>` looks like a fish — but the syntax is
load-bearing. `parse<i64>(x)` would be ambiguous with the expression
`parse < i64 > (x)`, two comparisons. C++ resolves this with lookahead and an
occasional `template` keyword; Rust resolves it with punctuation you can grep
for.

Reach for the turbofish when the value is consumed immediately and there is no
binding to annotate: `.collect::<Vec<_>>()`, `.sum::<u64>()`,
`.parse::<u16>()?`. The `_` means *infer this part*, and it usually carries most
of the weight.

## 7. Two parameters, two different bounds

@kind fix
@concept where clause
@expect E0277

`report` formats a name with `{}` and a value with `{:?}`. Those are two
different traits, on two different type parameters, and neither has been
promised.

Once a signature needs more than one bound, the inline form gets crowded. Use the
other form.

```starter
pub fn report<A, B>(name: A, value: B) -> String {
    format!("{name} = {value:?}")
}

pub fn run() -> (String, String) {
    (
        report("retries", 3),
        report("hosts", vec!["alpha", "beta"]),
    )
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn formats_both_ways() {
        assert_eq!(
            run(),
            (
                String::from("retries = 3"),
                String::from(r#"hosts = ["alpha", "beta"]"#),
            )
        );
    }
}
```

```solution
use std::fmt::{Debug, Display};

pub fn report<A, B>(name: A, value: B) -> String
where
    A: Display,
    B: Debug,
{
    format!("{name} = {value:?}")
}

pub fn run() -> (String, String) {
    (
        report("retries", 3),
        report("hosts", vec!["alpha", "beta"]),
    )
}
```

@hint `{}` and `{:?}` are two different traits. Work out which parameter needs which.
@hint `{}` is `std::fmt::Display`; `{:?}` is `std::fmt::Debug`.
@hint Put them in a `where` clause after the return type: `where A: Display, B: Debug`.

@diagnose E0277
Two errors, one per parameter, and they are worth reading separately.

`` `A` doesn't implement `std::fmt::Display` `` comes from `{name}`. `` `B`
doesn't implement `Debug` `` comes from `{value:?}`. The two format specifiers
are two distinct traits, and a type may have one without the other — most types
derive `Debug` and never implement `Display`, because `Debug` is for programmers
and `Display` is for users.

Both errors point at the definition, not the calls. rustc checks the body once
against the bounds it has, which here are none.

@after
`where` earns its keep on two counts. The obvious one is readability: bounds move
out of the angle brackets and stop the signature wrapping.

The one that matters more is expressiveness. A `where` clause can constrain types
you did not declare — `where Vec<A>: Debug`, or `where T::Item: Display` on an
associated type — and the inline `<T: Bound>` form simply cannot say those. Once
you are constraining anything other than a bare parameter, `where` is not a style
choice.

## 8. A generic container over hashable keys

@kind fix
@concept trait bound
@expect E0599

`Tally` counts occurrences of anything. Its storage is a `HashMap`, and a hash
map cannot store a key it cannot hash or compare — so the capability has to be
promised somewhere.

Find the smallest place to put the promise. The struct declaration should stay
bound-free.

```starter
use std::collections::HashMap;

pub struct Tally<T> {
    counts: HashMap<T, usize>,
}

impl<T> Tally<T> {
    pub fn new() -> Self {
        Tally { counts: HashMap::new() }
    }

    pub fn add(&mut self, item: T) {
        *self.counts.entry(item).or_insert(0) += 1;
    }

    pub fn count(&self, item: &T) -> usize {
        self.counts.get(item).copied().unwrap_or(0)
    }

    pub fn distinct(&self) -> usize {
        self.counts.len()
    }
}

pub fn run() -> (usize, usize, usize) {
    let mut t = Tally::new();
    for word in ["ping", "pong", "ping"] {
        t.add(word);
    }
    (t.count(&"ping"), t.count(&"pong"), t.distinct())
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_repeats() {
        assert_eq!(run(), (2, 1, 2));
    }

    #[test]
    fn works_for_a_second_type() {
        let mut t = Tally::new();
        t.add(1u8);
        t.add(1u8);
        t.add(2u8);
        assert_eq!((t.count(&1u8), t.distinct()), (2, 2));
    }
}
```

```solution
use std::collections::HashMap;
use std::hash::Hash;

pub struct Tally<T> {
    counts: HashMap<T, usize>,
}

impl<T: Eq + Hash> Tally<T> {
    pub fn new() -> Self {
        Tally { counts: HashMap::new() }
    }

    pub fn add(&mut self, item: T) {
        *self.counts.entry(item).or_insert(0) += 1;
    }

    pub fn count(&self, item: &T) -> usize {
        self.counts.get(item).copied().unwrap_or(0)
    }

    pub fn distinct(&self) -> usize {
        self.counts.len()
    }
}

pub fn run() -> (usize, usize, usize) {
    let mut t = Tally::new();
    for word in ["ping", "pong", "ping"] {
        t.add(word);
    }
    (t.count(&"ping"), t.count(&"pong"), t.distinct())
}
```

@hint Look up what `HashMap::entry` and `HashMap::get` require of the key type. It is two traits, not one.
@hint A hash map needs to hash a key to find its bucket, and to compare keys inside that bucket. `Hash` and `Eq`.
@hint `impl<T: Eq + std::hash::Hash> Tally<T>` — and leave `struct Tally<T>` exactly as it is.

@diagnose E0599
`` no method named `entry` found for struct `HashMap<T, usize>` in the current
scope ``, followed by *the following trait bounds were not satisfied:
`T: Eq`, `T: Hash`*.

This wording catches people out, because the method obviously exists — you have
used `entry` a hundred times. The subtlety is that it does not exist *on this
type*. `HashMap<K, V>` is declared with no bounds on `K` at all, and `insert`,
`get` and `entry` live inside `impl<K: Eq + Hash, V> HashMap<K, V>`. For a `K`
that has promised nothing, that impl block does not apply, so its methods are
genuinely not there to be found.

So the rule for reading `E0599`: on a concrete type it usually means a typo or a
trait you forgot to `use`. On anything involving a **type parameter** it almost
always means a missing bound, and the "trait bounds were not satisfied" list is
the fix, spelled out.

@diagnose E0277
`` the trait bound `T: Eq` is not satisfied ``, or the same for `Hash`. The other
face of the same problem, raised when the requirement is checked directly rather
than through method lookup — you will see this form once `entry` resolves but
`get` still does not, or after a partial fix.

Both traits are needed, for reasons worth keeping straight: `Hash` picks the
bucket, `Eq` distinguishes the keys that collided inside it. Hashing alone would
let two different keys silently overwrite one another.

@after
The important habit is where the bound went, and it is exactly what the standard
library does. `struct Tally<T>` stays unbounded, so the type is nameable and
constructible in contexts that never touch a hash — and the bound sits on the one
`impl` block whose methods actually hash something.

Bounds on a struct declaration look tidier and are almost always a mistake. They
propagate into every signature that mentions the type, they cannot be relaxed
later without a breaking change, and they buy no safety at all: the impl block
would have rejected the bad `T` anyway. `HashMap`, `BTreeMap` and `Vec` all
declare their parameters bare for this reason.
