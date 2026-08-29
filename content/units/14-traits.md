---
num: 14
slug: 14-traits
title: Traits
accent: slate
concepts: trait, trait bound, coherence, orphan rule, newtype, default method, supertrait, associated type, blanket impl, trait object, vtable, static dispatch, dynamic dispatch, object safety
needs: 08-structs, 13-generics
blurb: A named set of behaviour a type can implement, plus the two ways to call it: one free, one costing a pointer chase.
---

%% The last unit ended with a bound and never said what one is. `T: Display` is a claim that `T` implements a **trait**, and traits are how every abstraction in Rust is spelled: operators, iteration, printing, conversion, cleanup, thread safety. Learn the mechanism once and the standard library stops being a list of names to memorise.

A trait is a named set of behaviour. Types opt in. Nothing is inherited.

## Declaring and implementing

### The shape

```rust
pub trait Summary {
    fn author(&self) -> String;

    fn summarise(&self) -> String {          // a default method
        format!("(read more from {})", self.author())
    }
}

pub struct Tweet { pub handle: String, pub body: String }

impl Summary for Tweet {
    fn author(&self) -> String { format!("@{}", self.handle) }
}
```

`Tweet` gets `summarise` for free. A **default method** is written in terms of the
required ones, so an implementor supplies the minimum and overrides only where
the general version is wrong or slow. `Iterator` is the extreme case: implement
`next`, receive seventy adapters.

:::note
There is no inheritance here. `impl Summary for Tweet` adds behaviour to a type
that already exists, from anywhere in the program. A type can implement fifty
traits and still be one flat struct with no header word.
:::

### Implementing on someone else's type

This is the part that surprises people arriving from Java or C#:

```rust
trait Loudly { fn shout(&self) -> String; }

impl Loudly for String {
    fn shout(&self) -> String { self.to_uppercase() }
}
```

`String` is not yours. You extended it anyway, and `"hi".to_string().shout()`
now works throughout your crate. The call costs exactly what an inherent method
costs, and no wrapper type appears anywhere.

A trait's methods are only callable where the trait is **in scope**, which is why
files open with `use std::io::Write;` for a type they never name. Method missing?
Check the import before checking the impl.

## Coherence and the orphan rule

### The rule

:::note
You may write `impl Trait for Type` only if **you own the trait or you own the
type**. Both foreign is refused: `error[E0117]`.
:::

```rust,bad
impl std::fmt::Display for Vec<String> {   // error[E0117]
    // Display is std's. Vec is std's. Neither is yours.
}
```

### Why it has to exist

Suppose it were allowed. Crate `alpha` writes `impl Display for Vec<String>`
printing comma-separated. Crate `beta` writes one printing newline-separated.
Your program depends on both.

Now `format!("{v}")` has two implementations and no principled way to pick. The
linker cannot choose; neither crate is wrong; and neither author can see the
other's existence. Worse, adding an unrelated dependency could silently change
what your program prints.

The **orphan rule** buys **coherence**: for any (trait, type) pair, at most one impl
exists in any program that links. Compiled separately, linked together, still
unambiguous. That guarantee is worth the inconvenience, and the inconvenience has
a standard answer.

### The newtype pattern

Wrap the foreign type in a one-field tuple struct you own:

```rust,good
use std::fmt;

struct Lines(Vec<String>);

impl fmt::Display for Lines {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", self.0.join("\n"))
    }
}
```

`Lines` is yours, so the impl is legal. The wrapper is erased entirely at
compile time. At runtime a `Lines` is a `Vec<String>`: same size, same layout,
and reaching the field costs nothing. Add `Deref` if you want the `Vec` methods
back through it.

**newtype** does double duty in real code: `struct UserId(u64)` and
`struct OrderId(u64)` are both a `u64` and cannot be swapped by accident, which
is a whole category of bug deleted for free.

## Bounds, supertraits, associated types

### Supertraits

A trait may require another:

```rust
use std::fmt::Display;

trait Named: Display {
    fn label(&self) -> String { format!("<{self}>") }   // may use Display
}
```

A **supertrait** is written with a colon; `Named: Display` reads "anything `Named`
is also `Display`". Implement `Named`
for a type without `Display` and you get `E0277` naming the missing supertrait.
The gain is that default methods may use the supertrait's behaviour.

### Associated types versus type parameters

An **associated type** and a type parameter both let a trait talk about another
type. They answer different questions.

```rust
trait Container {
    type Item;                                 // associated: one per implementor
    fn get(&self, i: usize) -> Option<&Self::Item>;
}

trait Convert<T> {                             // parameter: many per implementor
    fn convert(&self) -> T;
}
```

| | associated type | type parameter |
|---|---|---|
| impls per type | exactly one | many |
| chosen by | the implementor | the caller |
| written at use | `T: Iterator<Item = u8>` | `T: Convert<u8>` |

`Iterator` uses an associated type, and the reason is decisive: a `Vec<u8>`'s
iterator yields `u8` and nothing else. Were `Item` a parameter, every
`for x in it` would have to say which `Iterator<T>` impl it meant, and you would
annotate constantly. Meanwhile `From` uses a parameter, because `String` genuinely
converts from `&str`, `char`, `Box<str>` and more.

:::note
One answer per implementing type → associated type. Several answers, caller
picks → type parameter.
:::

### Blanket impls

An impl over every type satisfying a bound:

```rust
impl<T: Display> ToString for T {
    fn to_string(&self) -> String { /* ... */ }
}
```

That single block in the standard library is why every `Display` type has
`.to_string()`. You never implement `ToString`; you implement `Display` and it
arrives. Coherence still holds, because the blanket impl is `std`'s, over `std`'s
own trait, so nobody can collide with it.

## Static and dynamic dispatch

### Two ways to say "something printable"

```rust
fn show_static(x: &impl Display) { println!("{x}"); }   // monomorphised
fn show_dyn(x: &dyn Display)     { println!("{x}"); }   // one function, vtable
```

`show_static` is generics from the last unit wearing shorter syntax: one copy per
concrete type, direct call, inlinable. `show_dyn` is compiled once. The type is
gone at compile time, so the address of `fmt` has to travel with the value.

### A trait object is a fat pointer

:::memory &dyn Display pointing at a String
       STACK                                  HEAP
     ┌──────────────────────────┐           ┌───┬───┐
 x   │ data ptr   ●─────────────┼──────────▶│ h │ i │   the String's buffer
     │ vtable ptr ●──────┐      │           └───┴───┘
     └───────────────────┼──────┘
                         │       VTABLE for <String as Display>
                         │     ┌────────────────────────────┐
                         └────▶│ drop_in_place  ●───▶ ...    │
                               │ size      24               │
                               │ align      8               │
                               │ fmt            ●───▶ ...    │
                               └────────────────────────────┘
                               one per (type, trait) pair,
                               in read-only data, shared by
                               every trait object of that type
:::

Sixteen bytes instead of eight. Calling `fmt` loads the vtable slot, then calls
through it. The optimiser cannot inline the target, because nothing knows what it
is until the program runs.

| | `impl Trait` / generic | `dyn Trait` |
|---|---|---|
| dispatch | direct call | one load, one indirect call |
| inlining | yes | no |
| pointer size | one word | two words |
| code emitted | one copy per type | one copy total |
| heterogeneous collection | impossible | the reason it exists |

`Vec<Box<dyn Draw>>` holding a circle, a button and a text box is the case
generics cannot express: `Vec<T>` needs one `T`, and there is no one `T`.

:::gotcha
`dyn` is not "slow". It is one predictable indirect call, roughly what every
Java method call costs. The loss that matters is not the jump. It is the
inlining, and everything the optimiser would have done afterwards.

Use `dyn` at boundaries where the set of types is genuinely open or the mix is
decided at runtime. Use generics in the hot loop underneath.
:::

### Object safety

Not every trait can become a `dyn`:

```rust,bad
trait Store {
    fn save<T: Display>(&self, item: T);   // generic method
    fn make() -> Self;                     // no self
}

let s: Box<dyn Store> = /* ... */;         // error[E0038]
```

The vtable is a fixed table of function pointers built when the crate is
compiled. A generic method has no single address; it has one per instantiation,
and the set of instantiations is unknown. A method without `self` has no receiver
to dispatch on, and `-> Self` has no known size. So a trait is **object safe** only if every
method takes some form of `self`, is non-generic, and does not mention `Self` in
a position whose size must be known.

The escape hatch is `where Self: Sized` on the offending method, which excludes
it from the vtable and keeps the rest of the trait usable as `dyn`. `Iterator`
does this for `map`, `filter` and the other adapters, which is why
`Box<dyn Iterator<Item = u8>>` works despite fifty generic methods.

### `impl Trait` in the two positions

**impl Trait** appears in two places and means something different in each.

```rust
fn longest(items: &[String]) -> impl Iterator<Item = &String> {   // return
    items.iter().filter(|s| s.len() > 3)
}

fn print_all(items: impl IntoIterator<Item = String>) { /* ... */ }  // argument
```

In **argument** position it is shorthand for a type parameter. In **return**
position it means something you cannot write otherwise: *one specific type,
which I decline to name*. The compiler generated the closure type inside that
`filter`, and it has no name you could write down, so `impl Iterator` is the only
way to return it without boxing.

The cost of `Box<dyn Iterator<...>>` instead would be an allocation and a vtable
per call. The cost of `impl Iterator` is that all return paths must yield the
same type: two `return`s with different iterators is `E0308`, and that is when
you box.

## The traits worth knowing

| trait | implementing it buys you |
|---|---|
| `Debug` | `{:?}`, `assert_eq!` failure output, `dbg!`. Derive it on everything. |
| `Display` | `{}`, and `.to_string()` free via a blanket impl |
| `Clone` | explicit `.clone()` |
| `Copy` | implicit duplication on assignment; requires `Clone`, forbids `Drop` |
| `Default` | `T::default()`, `..Default::default()` in struct literals |
| `PartialEq` / `Eq` | `==`. `Eq` additionally promises reflexivity, which is why `f64` has only `PartialEq`: `NaN != NaN` |
| `PartialOrd` / `Ord` | `<`, `.sort()`, `.max()`, use as a `BTreeMap` key |
| `Hash` | use as a `HashMap` or `HashSet` key, with `Eq` |
| `From<T>` | `.into()` in the other direction, and `?` converting error types |
| `TryFrom<T>` | fallible conversion returning `Result` |
| `AsRef<T>` | a function accepting `String`, `&str` and `Path` alike |
| `Deref` | method calls falling through, which is how `String` gets `&str`'s methods |
| `Iterator` | `for`, and every adapter in the library |
| `Drop` | code that runs when the value dies |

### Implement `From`, never `Into`

```rust
struct Celsius(f64);
struct Fahrenheit(f64);

impl From<Celsius> for Fahrenheit {
    fn from(c: Celsius) -> Self { Fahrenheit(c.0 * 9.0 / 5.0 + 32.0) }
}

let f: Fahrenheit = Celsius(100.0).into();   // works, and you wrote no Into
```

A blanket impl in the standard library gives `Into` to everything with `From`, so
one impl yields both directions of syntax. Writing `Into` by hand gives you only
`Into`, and often trips the orphan rule as well.

:::gotcha
The `?` operator calls `From::from` on the error before returning it. That single
line is why a custom error enum with a few `From` impls makes `?` work across
`io::Error`, `ParseIntError` and your own variants without a `match` anywhere.
:::
