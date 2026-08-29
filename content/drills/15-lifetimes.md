---
unit: 15-lifetimes
---

## 1

What does the `'a` in `fn pick<'a>(a: &'a str, b: &'a str) -> &'a str` do?

- A. Makes `a` and `b` live until the end of `main`
- B. Tells the compiler to keep the returned string alive
- *C. Names a region of code, and claims all three references are valid across it
- D. Allocates the return value with a longer lifetime

@why
`'a` is a name, not a duration and not an instruction. The signature claims that
both inputs and the output are valid across one common region, and the compiler
checks that claim at every call site.

B is the misconception the whole unit exists to remove. Nothing in a signature
extends anything's life; the values live exactly as long as the caller's scopes
say, whether this function exists or not. An annotation that is false gets you an
error, never a longer-lived value.

## 2

Does this compile?

```rust
fn longest(a: &str, b: &str) -> &str {
    if a.len() >= b.len() { a } else { b }
}
```

- A. Yes — elision assigns the first parameter's lifetime to the output
- *B. No — `E0106`, the compiler cannot tell which input the output borrows from
- C. No — you cannot return a reference from a function
- D. Yes, but only if both arguments are string literals

@why
Elision rule 2 only fires when there is **exactly one** input lifetime. There are
two here, so no output lifetime is assigned and you get `error[E0106]: missing
lifetime specifier`.

A is the tempting answer and it is what several other languages would do.
Rust deliberately refuses to guess: "the first one" would be silently wrong half
the time, and the caller would only find out through a lifetime error somewhere
far away.

## 3

`fn first_word(s: &str) -> &str` compiles with no annotations. Why?

- A. Because `&str` is always `'static`
- *B. Elision rule 2: one input lifetime, so it is assigned to the output
- C. Because the function does not allocate
- D. Because `str` is a primitive type

@why
Rule 1 gives the single input reference its own parameter `'a`. Rule 2 then sees
exactly one input lifetime and assigns it to every elided output lifetime. The
signature the compiler actually works with is
`fn first_word<'a>(s: &'a str) -> &'a str`.

A is a common and dangerous confusion. `&str` is not `'static` — string
*literals* are, because they are baked into the binary, but a slice of a
`String` lives exactly as long as that `String`.

## 4

Which of these signatures need an explicit lifetime annotation? Choose all that
apply.

```rust
fn a(s: &str) -> usize
fn b(s: &str) -> &str
fn c(x: &str, y: &str) -> &str
fn d(&self, other: &str) -> &str          // returns a slice of `other`
```

- A. `a`
- B. `b`
- *C. `c`
- *D. `d`

@why
`a` returns no reference, so nothing needs assigning. `b` has one input lifetime,
so rule 2 handles it.

`c` has two, and neither rule 2 nor rule 3 applies — that is `E0106`.

`d` is the sneaky one. It *compiles*, because rule 3 assigns `self`'s lifetime to
the output. It is simply wrong: the body returns a slice of `other`, so you get
`E0621` instead. Elision succeeded and produced a signature you did not mean.

## 5

Does this compile?

```rust
struct Excerpt {
    part: &str,
}
```

- A. Yes — the field borrows from whatever built the struct
- *B. No — `E0106`; a struct field gets no elision
- C. Yes, but the struct can only hold literals
- D. No — structs cannot contain references at all

@why
All three elision rules are about `fn` signatures. A struct has no arguments, so
there is nothing for the compiler to infer a lifetime *from*. You must declare
one: `struct Excerpt<'a> { part: &'a str }`.

D is wrong and worth ruling out firmly. Structs holding references are the
foundation of every zero-copy parser in Rust — the point of `<'a>` is to make
them safe, not to forbid them.

## 6

What does `struct Parser<'a>` mean?

- A. The parser is allocated for the duration `'a`
- *B. A `Parser<'a>` value may not outlive whatever it borrowed
- C. The parser keeps its source string alive
- D. The parser can only be used inside a block labelled `'a`

@why
The parameter is a constraint carried in the type, not a field and not storage.
It says: this value contains a borrow, so it must die before the thing it
borrowed from does.

C inverts the relationship, and that inversion is the heart of the confusion.
Rust references never keep anything alive — that is reference counting, which is
`Rc` and `Arc`. A borrow only constrains the borrower.

## 7

Does this compile?

```rust
fn greeting() -> &'static str {
    let s = String::from("hello");
    &s
}
```

- A. Yes — `'static` makes the string live for the whole program
- *B. No — `E0515`, you cannot return a reference to a local
- C. Yes, because string literals are `'static`
- D. No — `String` cannot be borrowed as `&str`

@why
`s` is dropped at the closing brace, so the returned reference would point at a
dead frame. `'static` is a well-formed claim that happens to be false, and the
compiler checks claims.

A is exactly the misconception to shed: writing a lifetime does not create one.
No annotation makes a local outlive its own function. The fix is always to return
an owned value — here, `-> String` and `String::from("hello")`.

## 8

`T: 'static` means…

- A. Values of `T` live for the whole program
- *B. `T` contains no reference with a lifetime shorter than the program
- C. `T` must be a constant or a literal
- D. `T` is stored in static memory

@why
It is a bound on the *type*, not a promise about any value. `String`, `i32`,
`Vec<u8>` and `&'static str` all satisfy `T: 'static`, because none of them holds
a short-lived borrow. A freshly allocated `String` dropped a line later satisfies
it perfectly.

A is how nearly everyone reads it, and it is why `thread::spawn`'s `F: 'static`
sends people looking for `Box::leak`. The bound only means the value *could* be
kept indefinitely, not that it will be.

## 9

Which of these types satisfy `T: 'static`? Choose all that apply.

- *A. `String`
- *B. `&'static str`
- C. `&'a str` for some local `'a`
- *D. `Vec<u8>`
- E. `Parser<'a>` where `'a` is a function-local region

@why
A, B and D own their data or borrow only from the program's own binary, so
nothing inside them can expire. C and E carry a short-lived borrow, which is
exactly what the bound rules out.

The pattern: owning types are always `'static`; borrowing types are `'static`
only when what they borrow is. This is why the fix for a stubborn `'static` bound
is so often "own the data" — `String` instead of `&'a str`.

## 10

Does this compile?

```rust
struct Parser<'a> { src: &'a str }

impl Parser {
    fn src(&self) -> &str { self.src }
}
```

- A. Yes — the `impl` can elide the lifetime
- *B. No — `E0726`; the `impl` must name the type's lifetime parameter
- C. No — methods cannot return references to fields
- D. Yes, but only for `&'static str`

@why
`Parser` is not a type; `Parser<'a>` is, for each `'a`. An `impl` block has to say
which one, exactly as it would for a generic type parameter:
`impl<'a> Parser<'a>`.

The compiler suggests `Parser<'_>`, which silences this error and is often not
what you want. `'_` introduces a fresh anonymous lifetime, so you lose the ability
to say "this method returns something valid for as long as the *source*", which is
usually the whole reason the struct has a lifetime.

## 11

Does this compile?

```rust
let best;
{
    let joined = vec!["a", "bbb"].join("-");
    best = joined.split('-').max_by_key(|w| w.len()).unwrap();
}
println!("{best}");
```

- A. Yes — `best` holds a copy of the word
- *B. No — `E0597`, `joined` does not live long enough
- C. No — `max_by_key` returns an owned `String`
- D. Yes, because `&str` is `Copy`

@why
Every slice from `split` points into `joined`'s heap buffer, which is freed at
the closing brace. `best` is read after that.

D is the trap, and it is true but irrelevant. `&str` *is* `Copy` — copying it
duplicates a pointer and a length, and both copies still point at the same dead
buffer. Copying a reference never copies what it refers to. The fix is to move
`joined` out to the outer scope, or to call `.to_string()`.

## 12

What is the runtime cost of a lifetime annotation?

- *A. None — lifetimes are erased before code generation
- B. One word per reference, to store the region
- C. A check on every dereference
- D. It depends on how many lifetime parameters the function has

@why
Lifetimes exist only in the type checker. By the time the compiler emits machine
code they are gone, and a `&'a str` is what it always was: a pointer and a
length. Two functions differing only in their annotations compile to identical
instructions.

That is why lifetimes can be strict without being expensive — the entire analysis
is a compile-time proof, and a proof does not need to be carried around at
runtime.

## 13

Why is `&'long T` accepted where `&'short T` is expected?

- *A. Covariance — a reference valid for longer is valid for shorter
- B. The compiler shortens the referenced value's life to match
- C. It is not accepted; the lifetimes must match exactly
- D. Because `&T` is `Copy`

@why
Lifetimes have a subtyping relation and `&T` is covariant in it: something valid
across a big region is certainly valid across a smaller one contained in it. This
is why most code never notices lifetimes have a subtyping relation at all.

B has the causation backwards. Nothing is shortened; the *claim* is weakened,
which is always sound. Note that `&mut T` is invariant in `T` for the opposite
reason: you can write through it, so substituting a shorter lifetime inside would
let you store a dangling reference.

## 14

`thread::spawn` requires `F: Send + 'static`. What does that stop you doing?

- A. Spawning more than one thread from a function
- *B. Capturing a reference to a local variable in the closure
- C. Returning a value from the thread
- D. Using `String` inside the thread

@why
The spawned thread has no bound on when it finishes, so it may still be running
after the spawning frame is gone. `'static` forbids the closure's type from
holding any borrow that could expire by then.

D is the answer people fear and it is wrong: `String` owns its buffer, so it
satisfies `'static` and `move`-ing one in is completely fine. If you genuinely
need to borrow a local, `std::thread::scope` guarantees the threads finish first
and lifts the bound.

## 15

A function signature needs three lifetime parameters and you cannot get it to
compile. What is the most likely correct move?

- A. Add `'static` to every reference
- B. Box the return value
- *C. Make the struct or function own its data instead of borrowing it
- D. Add `unsafe` and transmute the lifetimes

@why
Three lifetimes in one signature almost always means the data is shaped wrong.
A struct of borrows that wanted to be a struct of values, or a returned view that
wanted to be a returned `String`, produces exactly this kind of pile-up.

A does not work: `'static` is a claim, and adding it to something that is not
`'static` moves the error rather than removing it. D compiles and is how you get
use-after-free back. The annotation was faithfully describing a constraint — the
real decision is whether you wanted the constraint.
