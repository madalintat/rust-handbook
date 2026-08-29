---
unit: 13-generics
---

## 1

Does this compile?

```rust
fn largest<T>(v: &[T]) -> &T {
    let mut best = &v[0];
    for x in v { if x > best { best = x; } }
    best
}
```

- A. Yes, `>` works on any type
- *B. No, `T` has promised nothing, so `>` is unavailable
- C. No, you cannot return a reference into a slice parameter
- D. Yes, but only for numeric types

@why
`>` is not a primitive operation; it is `PartialOrd::gt` with punctuation for a
name. A bare `T` stands for every type in the language, including closures and
`File`, so the body is rejected at the definition. `T: PartialOrd` fixes it.

D is the tempting one, and it misreads how the check works. There is no "numeric
types" case, and rustc does not look at your call sites at all when checking the
body. It checks once, against the bounds, and here there are none.

## 2

A program calls `fn id<T>(x: T) -> T` with `i32` twice, `String` once and `char`
once. How many copies of `id` are in the binary?

- A. 1
- *B. 3
- C. 4
- D. 0, it is resolved at runtime

@why
Monomorphisation emits one copy per **concrete type**, not per call site. Three
distinct types were used, so three functions appear in the object file, each with
the type baked in and independently optimisable.

C counts call sites, which is the natural guess and the wrong unit. A hundred
calls with `i32` still produce one `id_i32`.

## 3

What does Rust pay for generics being free at runtime?

- A. Nothing, it is free in every dimension
- *B. Compile time and binary size
- C. A pointer indirection on every generic call
- D. A hidden type tag on every generic value

@why
The duplication does not disappear; it moves into the compiler. Ten types means
ten copies to type-check, optimise, link and ship, plus ten near-identical loops
competing for instruction cache. That is the bill.

C and D describe the *other* mechanism, `dyn Trait`, which is one copy with a
vtable pointer alongside the data and no inlining. Both designs exist in Rust
because both trades are sometimes right.

## 4

Which of these need a trait bound on `T` to compile inside a generic function?
Choose all that apply.

```rust
fn f<T>(a: T, b: T) { /* body varies */ }
```

- *A. `println!("{a}")`
- *B. `a == b`
- *C. `let c = a.clone();`
- D. `let v = vec![a, b];`
- *E. `a + b`

@why
A needs `Display`, B needs `PartialEq`, C needs `Clone`, E needs `Add`. Operators
in Rust are trait methods, so `==`, `+`, `<` and `[i]` are all bound-requiring
calls in disguise.

D is the odd one out and worth noticing. Putting values into a `Vec<T>`, moving
them, returning them, storing them in a struct: none of that requires anything
of `T`. Ownership operations are available on every type; it is *behaviour* that
must be promised.

## 5

Why does `let n = "42".parse().unwrap();` need an annotation?

- A. Because `parse` can fail
- *B. Because `parse` is generic in its return type, and nothing on that line picks it
- C. Because string literals have no type until bound
- D. Because `unwrap` erases the type

@why
`parse` is `fn parse<F: FromStr>(&self) -> Result<F, F::Err>`. `F` appears only
in the return position, so there is no argument for inference to run backwards
from, and `u8`, `f64`, `bool` and `IpAddr` are all valid answers.

The tempting reasoning is that integer literals default to `i32`, so surely this
does too. That fallback applies to unconstrained *literals*, not to an unresolved
generic parameter. Say it with `parse::<i64>()` or `let n: i64`.

## 6

A Java `ArrayList<Integer>` and a Rust `Vec<i32>` both hold a million integers.
What is the structural difference?

- A. None, both erase to a list of pointers
- *B. Java boxes each integer as a heap object behind a pointer; Rust stores the four bytes inline
- C. Rust boxes each integer; Java stores them inline
- D. Both store them inline, but Rust adds a type tag

@why
Java generics erase to `Object`, and `Object` cannot be a primitive, so each
element becomes an `Integer` on the heap and the list holds pointers to them.
Rust monomorphises `Vec<i32>` into a type that genuinely holds `i32`s in one flat
allocation.

The trade is exactly opposite: Java keeps one class in the binary and pays at
runtime in indirection and allocation; Rust emits a copy per element type and
pays in binary size.

## 7

When does a C++ compiler report that a template's body cannot compare its
elements, and when does rustc?

- A. Both at the definition
- B. Both at the first instantiation
- *C. C++ at instantiation, Rust at the definition
- D. C++ at the definition, Rust at instantiation

@why
A C++ template is a pattern, type-checked only once a concrete type is
substituted, so the error surfaces inside your template, on a line the caller
never wrote, with an instantiation stack attached.

Rust checks the generic body **once**, against its declared bounds. The
consequence is worth stating precisely: if a generic function compiles, it works
for every `T` satisfying its bounds, and a bad call is one line at the call site
saying which bound is missing.

## 8

What can a `where` clause express that `<T: Bound>` cannot?

- A. Multiple bounds on one parameter
- *B. Bounds on types other than the declared parameters, such as `where Vec<T>: Debug`
- C. Bounds involving lifetimes
- D. Nothing, it is purely cosmetic

@why
`<T: A + B>` handles multiple bounds fine, so A is not it. The real gain is that
`where` may constrain arbitrary types: `where Vec<T>: Debug`,
`where T::Item: Display`, `where for<'a> &'a T: IntoIterator`. The inline form can
only attach bounds to the parameters as they are declared.

D is the common belief and it is right about the *usual* case: most `where`
clauses in real code are there for readability. It is wrong as a rule.

## 9

Which is better, and why?

```rust
struct Cache<T: Clone> { value: T }     // A
struct Cache<T> { value: T }            // B, with impl<T: Clone> Cache<T>
```

- A. A, since the bound is stated once, where the type is defined
- *B. B, since the bound belongs on the impl block that needs it
- C. They are identical after monomorphisation, so it makes no difference
- D. A, because otherwise `Cache<File>` would be constructible

@why
A bound on a struct propagates: every `impl`, every function signature mentioning
`Cache`, and every other struct holding one must repeat it. It also cannot be
relaxed later without a breaking change, and it buys no safety, since the impl block
would reject a bad `T` anyway.

D is the trap, because it names a real consequence and gets its sign wrong.
`Cache<File>` being constructible is *good*: storing a file is sensible, and only
the cloning methods should be unavailable. `HashMap<K, V>` declares `K` with no
bounds at all for exactly this reason.

## 10

How many copies of `checksum` does this produce?

```rust
fn checksum<const N: usize>(a: [u8; N]) -> u32 { a.iter().map(|b| *b as u32).sum() }

checksum([1, 2]);
checksum([3, 4]);
checksum([5, 6, 7]);
```

- A. 1
- *B. 2
- C. 3
- D. 0, `N` is erased

@why
Const generics monomorphise like type parameters: one copy per distinct value of
`N`. Two calls use `N = 2` and share a copy; the third uses `N = 3` and gets its
own.

The payoff for the extra copy is that `N` is a compile-time constant inside each
one, so the loop can be fully unrolled and the bounds checks removed. Taking
`&[u8]` instead would give one function for all lengths, carrying the length at
runtime and losing the unrolling.

## 11

`Option<T>` is…

- A. A compiler built-in with special generic support
- *B. An ordinary generic enum, defined in the standard library with no privileges
- C. A trait object under the hood
- D. A nullable pointer, special-cased by rustc

@why
`enum Option<T> { None, Some(T) }` is source you could have written. `Result<T, E>`
likewise. Neither gets compiler privileges; `?` and `if let` work on them through
ordinary traits and pattern matching.

D is half a truth worth separating out. rustc *does* apply a niche optimisation
so that `Option<&T>` and `Option<Box<T>>` are one word, using the impossible null
value as the `None` tag. That is a layout optimisation available to any enum
with a niche, not a special case for `Option`.

## 12

Does this compile?

```rust
fn main() {
    let mut v = Vec::new();
    v.push(1u8);
    println!("{}", v.len());
}
```

- *A. Yes, the `push` on the next line determines the element type
- B. No, `Vec::new()` needs a turbofish
- C. No, `v` must be annotated at the `let`
- D. Yes, and `T` defaults to `i32`

@why
Inference is not line-by-line. rustc collects constraints across the whole
function body, so `push(1u8)` fixes `T = u8` even though it appears after the
declaration. Remove that `push` and you get `E0282`.

D is wrong twice: there is no fallback for a generic parameter, and even if there
were, `1u8` is explicit.

## 13

What is the machine-level cost of calling `fn show<T: Display>(x: T)` versus
`fn show(x: &dyn Display)`?

- A. Identical, both are direct calls
- *B. The generic is a direct call and can inline; the `dyn` version loads an address from a vtable and calls through it
- C. The generic allocates; the `dyn` version does not
- D. The `dyn` version is faster because there is only one copy in cache

@why
After monomorphisation the generic call has a known target, so it is a direct
call and everything downstream of inlining becomes available. The `dyn` version
compiles once; the target is unknown until runtime, so it costs one load plus one
indirect call and cannot be inlined.

D is not absurd, and one shared copy really can be kinder to the instruction
cache than thirty specialised ones. It is not the usual outcome, though, and the
lost inlining dominates.

## 14

You are storing a mixed collection of shapes: circles, rectangles and text
boxes, decided at runtime. What do you reach for?

- A. Generics, as `Vec<T: Shape>`
- *B. `Vec<Box<dyn Shape>>`
- C. An enum with one variant per shape
- *D. Either B or an enum, depending on whether the set of shapes is open
- E. `Vec<impl Shape>`

@why
`Vec<T>` holds one `T`. A mixed collection has no single `T`, so generics cannot
express it, and `Vec<impl Shape>` is not valid syntax anyway. That leaves two
real designs.

`Box<dyn Shape>` is right when the set is **open**: plugins, user-supplied types,
anything a downstream crate can extend. An enum is right when the set is
**closed**: nothing is allocated, no vtable is consulted, and `match` becomes
exhaustive, so adding a variant makes the compiler list every site to update. Both answers are correct
for different questions.

## 15

Does this compile?

```rust
fn first<T>(v: &[T]) -> T {
    v[0]
}
```

- A. Yes
- *B. No, it moves a value out of a slice it only borrowed
- C. No, `T` needs a `Sized` bound
- D. Yes, but only for `Copy` types, decided at each call

@why
Returning `T` by value means producing an owned value, and `v` is only borrowed.
Taking element zero out would leave a hole in data belonging to someone else. The
error is `E0507`, *cannot move out of index of `&[T]`*.

D is the C++ intuition and it is exactly what Rust refuses to do: the body is
checked once, against the bounds, not re-checked per call. Either bound `T: Copy`
and copy the bytes, bound `T: Clone` and write `v[0].clone()`, or return `&T` and
let the caller decide.

C is wrong but nearly interesting: `T: Sized` is already implied on every type
parameter unless you write `T: ?Sized`.
