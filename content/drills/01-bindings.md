---
unit: 01-bindings
---

## 1

Does this compile?

```rust
let total = 0;
total = total + 5;
```

- A. Yes
- *B. No, `total` is immutable
- C. No, the type of `total` is ambiguous
- D. Yes, but `total` stays 0

@why
`error[E0384]: cannot assign twice to immutable variable`. A `let` binding may
be written exactly once unless it is declared `mut`.

D is the tempting one if you are coming from a language where assignment to a
constant silently fails or is ignored. Rust has no such category: the write is
either legal at compile time or the program does not exist.

## 2

Does this compile?

```rust
let spaces = "   ";
let spaces = spaces.len();
```

- *A. Yes, the second `let` is a new binding
- B. No, you cannot change a binding's type
- C. No, `spaces` needs `mut`
- D. Yes, but only because both are on the stack

@why
This is **shadowing**, and it is not assignment. The second `let` creates a new
binding that reuses the name. The first still exists; it is what `.len()` just
read, and it is dropped at the end of the scope like anything else.

B is true of *assignment* and false of `let`. That is the whole distinction:
assignment must supply the binding's existing type forever, while a new binding
brings its own.

## 3

Which of these is a type?

- A. `mut i32`
- *B. `i32`
- C. `mut &i32`
- *D. `&mut i32`

@why
`mut` on a binding is a permission, not part of the type. There is no `mut i32`
and never has been. `&mut i32` *is* a type: a unique reference, distinct from
`&i32`.

The distinction pays off immediately. A value can be immutable in one scope and
mutable in the next without any conversion, because moving it to a new owner
means the new owner declares its own intent: `fn shout(mut s: String)` takes an
immutable caller's `String` and binds it mutably.

## 4

What does this print?

```rust
struct Guard;
impl Drop for Guard {
    fn drop(&mut self) { println!("released"); }
}

fn main() {
    let _ = Guard;
    println!("working");
}
```

- A. `working` then `released`
- *B. `released` then `working`
- C. `working` only; the guard is never dropped
- D. Nothing; `let _` discards the expression unevaluated

@why
Bare `_` is a pattern that matches and stores nothing. Nothing binds the
`Guard`, so nothing owns it, so it is dropped **immediately** on that line.

A is what everybody expects and what `let _guard = Guard;` would actually do.
The gap between those two is the bug: `let _ = mutex.lock();` takes a lock and
releases it on the same line, and it compiles perfectly cleanly. If a value
matters because of *when* it is destroyed, it needs a name.

## 5

What is the difference between `let _ = f();` and `let _x = f();`?

- A. None; the underscore is cosmetic in both
- *B. `_` binds nothing and drops now; `_x` is a real binding that lives to end of scope
- C. `_x` is a compile error; bindings cannot start with an underscore
- D. `_` suppresses the unused warning; `_x` does not

@why
`_x` is an ordinary binding whose leading underscore only tells rustc you know
it is unused. `_` is not a binding at all.

D has it exactly backwards, and it is a natural mistake because both do suppress
the warning. They just do it for different reasons: `_x` because you asked
politely, `_` because there is nothing there to be unused.

## 6

Does this compile?

```rust
const LIMIT = 4;
```

- A. Yes, inferred as `i32`
- *B. No, a `const` must have its type written out
- C. Yes, but only at module level
- D. No, `const` names must be uppercase

@why
`error: missing type for const item`. Inference is a per-function analysis; a
`const` is an item, visible to the whole crate and possibly to other crates, so
its type is part of an interface no single function body may decide.

D names a real convention, and a lint does enforce uppercase, but that is a
warning rather than an error and it is not what is wrong here. The same rule
applies to `static` and to every `fn` signature: items are annotated, locals are not.

## 7

Which is true of `const` versus `static`?

- A. `const` lives on the heap, `static` on the stack
- *B. `const` is substituted into each use site; `static` is one memory location with an address
- C. They are identical apart from the keyword
- D. `static` is evaluated at runtime, `const` at compile time

@why
A `const` has no storage of its own. The value is inlined at each use, rather
as a macro would expand. A `static` has an identity: one address for the whole
program, which is why `&BANNER` is a real `&'static` reference.

That decides which to reach for. Numbers and small strings want `const`. A large
table you do not want copied into fifty call sites, or anything whose address
matters, wants `static`.

D is wrong on both halves: both are evaluated at compile time.

## 8

Does this compile?

```rust
fn width() -> usize { 4 }
const PAD: usize = width();
```

- A. Yes, the compiler can see the body returns 4
- *B. No, `width` is not a `const fn`
- C. No, a `const` cannot be a `usize`
- D. Yes, but `PAD` is computed at runtime

@why
`error[E0015]: cannot call non-const function width in constants`. A `const`
initialiser is run by an interpreter inside rustc, so everything it touches must
be something that interpreter is allowed to run.

A is the trap: the compiler could obviously evaluate this body, and refuses
anyway. Const-ness is a promise in the signature, not an inference from the
body, exactly as an item's type is written rather than inferred. Marking it
`const fn` fixes it and changes nothing about how the function behaves at
runtime.

## 9

Does this compile?

```rust
fn sign(n: i32) -> &'static str {
    let s;
    if n < 0 { s = "neg"; }
    else if n > 0 { s = "pos"; }
    s
}
```

- A. Yes, `s` is assigned on every branch
- *B. No, `n == 0` reaches the last line with `s` unwritten
- C. No, `let s;` without an initialiser is never legal
- D. Yes, and `s` is the empty string when `n == 0`

@why
`error[E0381]: used binding s is possibly-uninitialized`. An `if` chain with no
`else` has an implicit empty one, and `n == 0` takes it.

C is wrong and worth knowing: deferred initialisation is legal and does not
require `mut`, because the binding is still written exactly once on every path.
The compiler tracks initialisation per control-flow path, not per binding.

D is the assumption a C or Java background gives you. There is no default value
here: not a zero, not a null, not an empty string. A binding not written on a
path simply cannot be read on that path.

## 10

What does `run` return?

```rust
fn run() -> usize {
    let level = "3";
    {
        let level: usize = level.parse().unwrap();
    }
    level.len()
}
```

- *A. 1
- B. 3
- C. It does not compile
- D. 0

@why
The inner `let` shadows `level` only until the block's closing brace. After it,
the name means the outer `&str` again, and `"3".len()` is 1.

B assumes the shadow leaked out. It cannot: a shadow narrows a name inside one
region and can never alter anything outside it. That constraint is what keeps
shadowing readable. If it *could* escape, `let` would be indistinguishable from
assignment.

Note the shape of the real bug this causes: had the last line been `level * 2`,
you would get `error[E0369]: cannot multiply &str` pointing at a line that looks
completely correct.

## 11

Does this compile?

```rust
let mut names = Vec::new();
names.push("ferris");
```

- *A. Yes, `push` fixes the element type
- B. No, `Vec::new()` needs a turbofish or annotation
- C. No, `names` is not annotated
- D. Yes, and the element type is inferred as `String`

@why
Rust's inference looks at the whole function body, not just the initialiser, so
a later `push("ferris")` settles the type as `Vec<&str>`. An annotation is
needed only when nothing in the function pins it down.

B is right about `let names = Vec::new();` on its own, which is what you get
when you delete the `push`. D confuses `&str` with `String`. A string
literal is a `&'static str`; nothing here allocates.

## 12

Does this need `mut`?

```rust
let label;
if ready { label = "go"; } else { label = "wait"; }
```

- A. Yes, `label` is assigned in two places
- *B. No, only one of those assignments ever runs
- C. Yes, any assignment after `let` requires `mut`
- D. No, but only because both values are `&'static str`

@why
`mut` permits a *second* write. Here the binding is written exactly once on
every path through the function, so no second write exists and no `mut` is
needed.

A counts the lines in the source; the compiler counts the writes along each
path. Put both assignments in the same branch and it becomes `E0384`, the same
error as writing to any other immutable binding.

## 13

Does this compile?

```rust
static mut HITS: u32 = 0;

fn hit() {
    HITS += 1;
}
```

- A. Yes, `static mut` exists for exactly this
- *B. No, touching a `static mut` requires `unsafe`
- C. No, `static` items cannot be `mut` at all
- D. Yes, but only in a single-threaded program

@why
`error[E0133]: use of mutable static is unsafe`. A `static` is one location
reachable from every thread, so a mutable one is a shared mutable location with
no synchronisation: two threads incrementing it race, and the increments are
lost. That is undefined behaviour, not merely a wrong count.

D is the reasoning people use to justify writing it. The compiler does not know
your program is single-threaded and will not take your word for it. In the 2024
edition even taking a reference to a `static mut` is rejected outright.

The safe replacement is a `static` of an `AtomicU32`, a `Mutex<T>`, or a
`OnceLock<T>`, none of which need `unsafe`.

## 14

What is `size` here?

```rust
let size = {
    let w = 8;
    let h = 4;
    w * h
};
```

- *A. 32; a block is an expression, and its value is the final line without a semicolon
- B. It does not compile; a block cannot appear on the right of `=`
- C. `()`; blocks always evaluate to unit
- D. 32, and `w` and `h` are still in scope afterwards

@why
Blocks are expressions. The tail expression, the one with no semicolon, is the
block's value, and `w` and `h` go out of scope at the closing brace.

D is the trap and it inverts the point. This shape is used precisely *because*
the intermediates do not escape: several lines of setup, one value out, no
temporary names left cluttering the function.

Add a semicolon after `w * h` and C becomes correct, which is a bug you will
meet more than once.

## 15

Why is immutability the default?

- A. So values can be stored in read-only memory
- *B. The compiler can assume the value never changes, and the reader can see at a glance what does
- C. Because mutation is slow
- D. To make the borrow checker's job optional

@why
Two payoffs at once. The optimiser may keep an immutable binding in a register
across a call, and the borrow checker may hand out any number of shared
references without further analysis. Immutability is information the backend
uses, not a lint.

And in a forty-line function, `let mut` marks the four values that move.
Everything else is settled. That is why rustc also warns about an unnecessary
`mut`: a false signal is worse than no signal.

C is wrong: mutating a local is free. The cost of mutation is in what it does
to reasoning, not to instructions.
