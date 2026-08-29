---
unit: 14-traits
---

## 1

Your crate defines `trait Loud` and `struct Bot`. Which impls are legal?
Choose all that apply.

- *A. `impl Loud for Bot`
- *B. `impl Loud for String`
- *C. `impl std::fmt::Display for Bot`
- D. `impl std::fmt::Display for Vec<String>`
- *E. `impl Loud for Vec<String>`

@why
The orphan rule: you may write `impl Trait for Type` only if you own the trait or
you own the type. A, B and E are legal because `Loud` is yours; C is legal because
`Bot` is yours. Only D is both-foreign.

The point of the restriction is **coherence**. If two crates could each implement
`Display for Vec<String>`, a program depending on both would have two candidate
impls, no principled way to choose, and no author able to see the conflict. The
rule guarantees at most one impl per (trait, type) pair in any linked program.

## 2

What does wrapping `Vec<String>` in `struct Csv(Vec<String>)` cost at runtime?

- *A. Nothing, same size, same layout, no indirection
- B. One pointer indirection per access
- C. A heap allocation for the wrapper
- D. A vtable pointer alongside the data

@why
A single-field tuple struct has the layout of its field. `Csv` *is* a
`Vec<String>` in memory; the wrapper exists in the type checker and is gone by
codegen.

That is what makes newtype the right answer to the orphan rule rather than a
grudging workaround. It also earns its place independently: `struct UserId(u64)`
and `struct OrderId(u64)` are both a `u64` and cannot be passed to the wrong
function by accident.

## 3

Does this compile?

```rust
trait Named { fn name(&self) -> String; }
trait Greet: Named {
    fn greet(&self) -> String { format!("hi, {}", self.name()) }
}
struct Bot;
impl Greet for Bot {}
```

- A. Yes, `greet` has a default body, so nothing is missing
- *B. No, `Bot` must implement `Named` as well
- C. No, a trait cannot have a default method that calls another trait's method
- D. Yes, and `name` falls back to the type name

@why
`trait Greet: Named` is not inheritance. It is a bound on `Self`: anything
implementing `Greet` must also implement `Named`. `Bot` does not, so
`error[E0277]: the trait bound Bot: Named is not satisfied`.

A is tempting because the impl block really is complete. There are no missing
*items*. The failure is the supertrait obligation, which is checked separately.
Nothing is inherited: `Bot` needs two impl blocks, one per trait.

## 4

On a 64-bit machine, what is `size_of::<&dyn Display>()`?

- A. 8
- *B. 16
- C. 24
- D. It depends on the concrete type

@why
A trait object is a **fat pointer**: one word to the data, one word to the vtable
for that (type, trait) pair. Sixteen bytes, regardless of what it points at,
which is exactly why D is wrong and why the whole mechanism works.

`&str` and `&[T]` are fat for a different reason: their second word is a length
rather than a vtable pointer. Same size, different payload.

## 5

What does a vtable contain?

- A. A copy of the value's fields
- *B. The type's size and alignment, a destructor pointer, and one function pointer per dyn-visible trait method
- C. The type's name, for reflection
- D. A reference count

@why
The vtable is a small static table in read-only data, one per (type, trait) pair,
shared by every trait object of that type. It carries `size`, `align`,
`drop_in_place` and the method addresses: enough to call, and enough to drop and
deallocate correctly without knowing the concrete type.

C is what a language with runtime reflection would store. Rust has none; the type
name is not there, which is why you cannot downcast a `dyn Trait` without opting
into `Any`.

## 6

Which method prevents this trait from being used as `dyn Store`?

```rust
trait Store {
    fn len(&self) -> usize;
    fn save<T: Display>(&self, item: T);
    fn clear(&mut self);
}
```

- A. `len`: it returns a value
- *B. `save`: it is generic
- C. `clear`: it takes `&mut self`
- D. None; the trait is already object safe

@why
A vtable is a fixed table of function pointers, built when the crate is compiled.
`save<T>` is monomorphised, so it is not one function. It is one per `T` anyone
ever passes, across crates that may not exist yet. There is no single address to
put in the slot. The error is `E0038`.

`&self` and `&mut self` are both fine; a receiver is exactly what dispatch needs.
The other disqualifiers are methods with no `self` at all, and methods returning
`Self` by value, whose size the caller cannot know.

The escape hatch is `where Self: Sized` on `save`, which drops it from the vtable
and leaves the rest usable as `dyn`. `Iterator` does this for all seventy of its
adapters.

## 7

Why is `Iterator`'s `Item` an associated type rather than `Iterator<T>`?

- A. Associated types compile faster
- *B. An iterator yields exactly one type, so the implementor should choose it, not the caller
- C. Type parameters cannot be used in return position
- D. Because `Item` can then be inferred at runtime

@why
A `Vec<u8>`'s iterator yields `u8` and nothing else: one right answer, and it
belongs to the implementor. Were it `Iterator<T>`, a type could implement it
several times, `for x in it` would be ambiguous, and annotations would be
required everywhere.

Compare `From<T>`, which *is* a parameter, precisely because `String` genuinely
converts from `&str`, from `char`, from `Box<str>`. Several answers, chosen by
the caller.

The rule: one answer per implementing type → associated type; several, caller
picks → type parameter.

## 8

You implement `Display` for your type. Which of these do you now also get,
without writing anything else? Choose all that apply.

- *A. `.to_string()`
- *B. `format!("{}", x)`
- C. `format!("{:?}", x)`
- *D. Passing it to `fn f<T: Display>(x: T)`
- E. `.clone()`

@why
`.to_string()` arrives through a **blanket impl** in the standard library:
`impl<T: Display> ToString for T`. One block, applying to every current and
future `Display` type. You never implement `ToString` by hand.

C is the trap. `Debug` and `Display` are separate traits with separate impls, and
`{:?}` needs `#[derive(Debug)]`. They are deliberately distinct: `Debug` is for
programmers and may be ugly, `Display` is for users and cannot be guessed.

## 9

What does this print?

```rust
trait Greet {
    fn name(&self) -> String;
    fn hello(&self) -> String { format!("hello, {}", self.name()) }
}
struct Bot;
impl Greet for Bot {
    fn name(&self) -> String { "bot".into() }
    fn hello(&self) -> String { "oi".into() }
}
fn main() { println!("{}", Bot.hello()); }
```

- A. `hello, bot`
- *B. `oi`
- C. It does not compile: `hello` already has a body
- D. `hello, oi`

@why
A default method is a fallback, not a final method. An impl that supplies its own
`hello` overrides it, and nothing dispatches back to the default.

C is the reasonable-sounding wrong answer, and the distinction matters: a method
*without* a body is a requirement (skip it and you get `E0046`), a method *with*
one is a default (override it or don't). Overriding is how a type that already
knows its length gives `Iterator::count` an O(1) implementation instead of
walking the whole sequence.

## 10

Does this compile?

```rust
fn pick(flag: bool) -> impl Iterator<Item = u32> {
    if flag { (1..4).map(|n| n * 2) } else { (1..4).filter(|n| n % 2 == 0) }
}
```

- A. Yes, both are iterators of `u32`
- *B. No, `impl Trait` in return position means one concrete type, and these are two
- C. No, you cannot return an iterator from a function
- D. Yes, but only with a `Box`

@why
`-> impl Iterator` does not mean "some iterator, decided at runtime". It means
*one specific type, which I decline to name*, usually because the type is an
unnameable compiler-generated closure or adapter. `Map<...>` and `Filter<...>`
are different types, so the two branches disagree and rustc reports `E0308`.

When the branches genuinely differ you need dynamic dispatch:
`Box<dyn Iterator<Item = u32>>`, at the cost of an allocation and a vtable. The
difference between A and B is precisely the difference between static and dynamic
dispatch.

## 11

You want `let f: Fahrenheit = c.into();` to work for your `Celsius`. What do you
implement?

- A. `impl Into<Fahrenheit> for Celsius`
- *B. `impl From<Celsius> for Fahrenheit`
- C. Both
- D. `impl AsRef<Fahrenheit> for Celsius`

@why
A blanket `impl<T, U: From<T>> Into<U> for T` in the standard library means one
`From` impl gives you both directions of syntax. Implementing `Into` by hand
gives you only `Into`, and duplicates work the library already did.

A is worse than merely redundant when a foreign type is involved: `Into` is std's,
so `impl Into<Fahrenheit> for ParseIntError` would be std's trait on std's type
and rejected by the orphan rule. `impl From<ParseIntError> for MyError` is legal
because the target type is yours. **Implement `From`, never `Into`.**

## 12

What does `?` do to an error before returning it?

- A. Nothing, it returns it unchanged
- *B. Calls `From::from` on it, converting into the function's error type
- C. Boxes it as `Box<dyn Error>`
- D. Panics if the types do not match

@why
`?` desugars to a `match` whose error arm is `return Err(From::from(e))`. That one
call is why a custom error enum with a handful of `From` impls makes `?` compose
across `io::Error`, `ParseIntError` and your own variants with no conversion code
at any call site.

It also explains the error you get when the impl is missing:
`` `?` couldn't convert the error to `MyError` ``, with *the trait bound
`MyError: From<ParseIntError>` is not satisfied*. The message names the impl you
need to write.

## 13

`file` is a `std::fs::File`. `file.write_all(b"hi")` fails with `E0599`, *no
method named `write_all`*. Why?

- A. `File` does not implement `Write`
- *B. The `Write` trait is not in scope
- C. `write_all` needs `&mut File` and yours is not mutable
- D. `File` must be wrapped in a `BufWriter` first

@why
A trait's methods are callable only where the trait is **in scope**. `File`
implements `Write`, but without `use std::io::Write;` the method is invisible.
This is why real files open with imports for traits whose names never appear
again.

C describes a genuine second error you may hit next (`write_all` takes
`&mut self`), but it reports as `E0596`, not `E0599`. The rule for reading
`E0599`: on a concrete type, suspect a missing `use` or a typo; on a **type
parameter**, suspect a missing bound.

## 14

Which are true of `dyn Trait` compared with a generic bound? Choose all that
apply.

- *A. One copy of the function is emitted instead of one per type
- *B. The call cannot be inlined
- C. Every method call allocates
- *D. It can hold a mix of concrete types in one collection
- E. It is always slower than a generic, in every workload

@why
A, B and D are the trade. One shared copy, one indirect call through the vtable,
and the ability to express `Vec<Box<dyn Draw>>`, a mixed collection, which
generics simply cannot represent, since `Vec<T>` needs one `T`.

C confuses the pointer with the dispatch. `&dyn Trait` allocates nothing; only
`Box<dyn Trait>` does, and that is the box, not the call. E overstates it: the
indirect call is roughly what a Java method call costs, and thirty monomorphised
copies thrashing the instruction cache can lose to one shared copy. What you
reliably lose is inlining, and everything the optimiser would have done after it.

## 15

Which of these traits cannot be `#[derive]`d?

- A. `Debug`
- *B. `Display`
- C. `Clone`
- D. `PartialEq`
- E. `Hash`

@why
`Display` is the only one, and the omission is deliberate. `Debug` can be derived
because there is an obvious mechanical answer: print the type name and its
fields. `Display` is the user-facing form, and nothing in the struct definition
says whether `Version { major: 1, minor: 4 }` should read `1.4`, `1-4`, `v1.4` or
`version 1 point 4`.

The rule generalises: a trait is derivable when the field-by-field answer is the
only sensible one. That is why `Clone`, `PartialEq`, `Hash`, `Default` and `Ord`
all derive, and why `Iterator`, `Drop` and `From` never can.
