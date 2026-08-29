---
num: 13
slug: 13-generics
title: Generics
accent: slate
concepts: generic, type parameter, monomorphisation, trait bound, where clause, turbofish, const generics, static dispatch
needs: 08-structs, 09-enums, 12-errors
blurb: One function, every type, and nothing at runtime — because the duplication still happens, it just happens inside the compiler instead of in your editor.
---

%% You have already written the same function twice: once taking `&[i32]`, once taking `&[String]`, identical apart from a type. Every language has an answer. C uses `void *` and loses the type. Java erases to `Object` and boxes every integer. C++ stamps out copies and tells you about the mistake 200 lines into an instantiation trace.

Rust stamps out copies too — and checks the original once, before stamping. That one difference is most of this unit.

## The duplication

### Two functions, one shape

```rust
fn largest_i32(v: &[i32]) -> &i32 {
    let mut best = &v[0];
    for x in v { if x > best { best = x; } }
    best
}

fn largest_char(v: &[char]) -> &char {
    let mut best = &v[0];
    for x in v { if x > best { best = x; } }
    best
}
```

The bodies are byte-identical. Only the type differs, so lift the type out and give
it a name:

```rust
fn largest<T: PartialOrd>(v: &[T]) -> &T {
    let mut best = &v[0];
    for x in v { if x > best { best = x; } }
    best
}
```

`<T>` declares a **type parameter**: a name that stands for a type the caller
picks. `T` is a convention, not a keyword — `largest<Item>` compiles equally well.

### The name is a placeholder, not a value

`T` exists only during compilation. There is no `T` in the binary, no runtime
object describing it, nothing to look up. Which raises the obvious question: what
*is* in the binary?

## Monomorphisation

### What the compiler actually emits

Call `largest` with two types and the compiler writes back the code you deleted.

```rust
let a = largest(&[3, 9, 2]);          // T = i32
let b = largest(&['x', 'a', 'm']);    // T = char
```

The compiled output contains, near enough:

```rust
fn largest_i32(v: &[i32]) -> &i32 { /* ... */ }
fn largest_char(v: &[char]) -> &char { /* ... */ }
```

and the two call sites jump directly to the right one. This is
**monomorphisation** — one specialised copy per concrete type actually used.

:::note
A generic function is not compiled. Its *instantiations* are. `largest<i32>` and
`largest<char>` are two unrelated functions in the object file that happen to
have come from one piece of source.
:::

### Therefore it costs nothing

Inside `largest_i32` there is no type tag, no vtable, no boxing. `x > best` is
one `cmp` instruction on two registers. The function can be inlined, the loop
unrolled, the comparison constant-folded — every optimisation available to the
hand-written version is available here, because after monomorphisation it *is*
the hand-written version.

| | dispatch | integer element | inlinable |
|---|---|---|---|
| Rust generic | resolved at compile time | in a register | yes |
| Java generic | interface call | boxed `Integer` on the heap | rarely |
| C `void *` | resolved at compile time | behind a pointer | no |
| Rust `dyn Trait` | one vtable indirection | behind a pointer | no |

That last row is the honest alternative, and it is the subject of the next unit.

### And the bill arrives elsewhere

There is no free lunch; there is a lunch billed to a different account.

- **Compile time.** Ten types means ten copies to type-check, optimise and link.
- **Binary size.** The same ten copies land in the executable. A generic used
  with thirty types thirty times is a real megabyte.
- **Instruction cache.** Ten near-identical loops evict each other where one
  shared loop would have stayed hot.

This is the trade the whole design makes: pay at build time, in a place you can
measure, to pay nothing at run time.

:::gotcha
The copies are per *concrete type*, not per call site. A hundred calls to
`largest::<i32>` produce one function. Two calls with two types produce two.

The lever, when a binary really is too big, is to give the generic a thin body
that immediately calls a non-generic one — exactly what `std::fs::read` does,
converting `AsRef<Path>` once and handing a plain `&Path` to the real work.
:::

## Bounds: what a bare `T` can do

### Almost nothing, deliberately

```rust,bad
fn describe<T>(x: T) -> String {
    format!("value: {x}")   // error[E0277]: `T` doesn't implement `std::fmt::Display`
}
```

`T` is *every* type. The body must work for a `File`, a `Vec<u8>`, a raw
pointer, a closure. `File` has no `Display`, so the body is rejected — at the
definition, before anyone has called it.

A **trait bound** narrows the promise:

```rust,good
use std::fmt::Display;

fn describe<T: Display>(x: T) -> String {
    format!("value: {x}")
}
```

The bound is a contract read in two directions. Inside the body it is a
guarantee: `T` can be displayed. At the call site it is an obligation: pass
something that implements `Display`, or `E0277`.

:::note
Everything a generic body does — a method, an operator, a `println!`, a `==` —
must be justified by a bound. Operators count: `a > b` needs `PartialOrd`,
`a + b` needs `Add`, `a == b` needs `PartialEq`.
:::

:::compare
**C++ templates** are checked at instantiation. `template<class T> T largest(...)`
compiles happily until someone calls it with a type lacking `operator>`, and the
error appears inside your template, blaming a line the caller has never seen.
Rust checks the generic body **once**, against its bounds. A generic function
that compiles works for every `T` satisfying its bounds, and a bad call is
reported at the call site — `MyType: PartialOrd is not satisfied`, one line, no
trace. C++20 concepts are this idea, made optional twenty years later.

**Java generics** erase: `List<String>` and `List<Integer>` are one class at
runtime, and the integers are boxed `Integer` objects behind pointers. Rust
duplicates and stays flat. Opposite trades — Java pays at runtime to keep the
binary small; Rust pays in binary size to make the runtime free.
:::

### `where`, for when the angle brackets fill up

These declare the same function:

```rust
fn report<T: Display + Clone, U: Clone + Debug>(a: T, b: U) -> String { /* ... */ }

fn report<T, U>(a: T, b: U) -> String
where
    T: Display + Clone,
    U: Clone + Debug,
{ /* ... */ }
```

A **where clause** is not only cosmetic: it can constrain types you did not
declare, such as `where Vec<T>: Debug` or `where T::Item: Display`. The inline
form cannot say that.

## Generic types

### Structs, enums, impls

```rust
struct Pair<T> { left: T, right: T }

enum Either<L, R> { Left(L), Right(R) }
```

`Option<T>` and `Result<T, E>` are exactly this, with no compiler privileges.

An `impl` block repeats the parameter, once to declare it and once to use it:

```rust
impl<T> Pair<T> {
    fn new(left: T, right: T) -> Self { Pair { left, right } }
}

impl<T: PartialOrd> Pair<T> {
    fn larger(&self) -> &T {
        if self.left > self.right { &self.left } else { &self.right }
    }
}
```

Two blocks, two audiences. `new` exists for every `Pair`; `larger` exists only
where `T` can be compared. `Pair<File>` is a perfectly good type that simply has
no `.larger()`.

:::gotcha
Do not put bounds on the struct itself:

```rust
struct Pair<T: PartialOrd> { left: T, right: T }   // avoid
```

It buys nothing, and it infects every `impl`, every function signature and every
other struct that holds a `Pair`, all of which must now repeat the bound.
Constrain the `impl` block that needs it. The standard library does this
throughout: `HashMap<K, V>` has no bounds on `K` at all — `Eq + Hash` appears on
the `impl` block containing `insert` and `get`.
:::

### Const generics

With **const generics**, a parameter can be a value rather than a type, as long as
it is known at compile time:

```rust
fn sum<const N: usize>(a: [i32; N]) -> i32 {
    a.iter().sum()
}

sum([1, 2, 3]);          // N = 2 + 1
sum([1, 2, 3, 4, 5]);    // a second copy, N = 5
```

Monomorphisation applies unchanged: one copy per distinct `N`, each with the
length baked in as a constant, which is how a fixed-size loop gets fully
unrolled. This is why `[T; N]` finally implements the traits it should — before
const generics, the standard library wrote impls out by hand up to length 32.

## Inference and the turbofish

Usually the compiler works out the parameters from the arguments:

```rust
let best = largest(&[3, 9, 2]);   // T = i32, obviously
```

Sometimes nothing at the call site determines them:

```rust,bad
let n = "42".parse().unwrap();    // error[E0282]: type annotations needed
```

`parse` is generic in its *return* type, and there is no argument to look at.
Two ways to say it:

```rust,good
let n: i32 = "42".parse().unwrap();   // annotate the binding
let n = "42".parse::<i32>().unwrap(); // annotate the call — the turbofish
```

The `::<>` is the **turbofish**. It exists because `parse<i32>(x)` would be
ambiguous with `parse < i32 > (x)` — a genuine parsing problem C++ solved with
lookahead and a `template` keyword, and Rust solved with punctuation.

Reach for it when the value is consumed immediately and there is no binding to
annotate: `.collect::<Vec<_>>()`, `.sum::<u64>()`, `.parse::<u16>()`. The `_`
inside means *infer this part*, and it is usually enough to write
`collect::<Vec<_>>()` rather than spelling the element type.

## When not to

Generics have a real cost in the source, not just in the binary: a signature with
four parameters and six bounds is a signature nobody reads.

| situation | reach for |
|---|---|
| one concrete type, today | the concrete type |
| a heterogeneous collection | `dyn Trait` — you cannot monomorphise a runtime mix |
| a plugin boundary crossing a `dyn` interface anyway | `dyn Trait` |
| a hot inner loop over one of five types | generics |
| "it might be useful for other types later" | the concrete type |

:::note
Write the concrete version first. Write the second one when you need it. Make it
generic when the third arrives and the duplication is proven rather than
predicted — by which point you also know exactly which bounds you need, instead
of guessing.
:::
