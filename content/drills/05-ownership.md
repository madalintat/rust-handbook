---
unit: 05-ownership
---

## 1

Does this compile?

```rust
let a = String::from("hi");
let b = a;
println!("{a}");
```

- A. Yes — `a` and `b` both point at the string
- *B. No — `a` was moved into `b`
- C. No — `String` cannot be printed with `{}`
- D. Yes, but it prints an empty string

@why
`String` is not `Copy`, so `let b = a;` **moves** — it copies the three-word handle
and retires `a`. Reading `a` afterwards is `error[E0382]`.

The tempting wrong answer is D. Nothing is blanked at runtime; `a`'s bytes are
still sitting in the stack frame. The restriction is purely in the compiler's
bookkeeping, which is exactly why it costs nothing.

## 2

Does this compile?

```rust
let a = 5;
let b = a;
println!("{a} {b}");
```

- *A. Yes — `i32` is `Copy`
- B. No — `a` was moved into `b`
- C. Yes, but only because both are on the stack
- D. No — you cannot print two values in one `println!`

@why
`i32` implements `Copy`, so the assignment duplicates the four bytes and leaves
both bindings live. Duplicating those bytes produces a genuinely complete second
value, so there is no shared resource to argue about.

C is close but wrong as stated. Living on the stack is not the criterion — a
fixed-size array `[String; 2]` is entirely on the stack and is still not `Copy`,
because the `String` elements own heap buffers.

## 3

Which of these move `s`? Choose all that apply.

```rust
let s = String::from("hi");
```

- *A. `let t = s;`
- *B. `takes(s)` where `fn takes(x: String)`
- C. `takes(&s)` where `fn takes(x: &String)`
- *D. `v.push(s)` where `v: Vec<String>`
- *E. `for c in s.into_bytes() {}`

@why
A, B, D and E all need the value by value, so all four move it.

C does not: `&s` creates a reference, which is permission to look without
transferring ownership. That is the whole subject of the next unit, and it is
the answer to most ownership complaints.

E is worth pausing on. `into_bytes` takes `self`, so it consumes the `String`
to hand back its buffer as a `Vec<u8>` — no copying, which is only sound because
the original is destroyed in the process.

## 4

How many bytes are copied by the move on line 2?

```rust
let a = String::from("a string of some considerable length");
let b = a;
```

- A. 36 — the whole contents
- *B. 24 — the pointer, length and capacity
- C. 0 — moves are purely a compile-time concept
- D. 8 — just the pointer

@why
A `String` is three words on the stack: pointer, length, capacity. On a 64-bit
machine that is 24 bytes, and the move copies exactly those. The heap buffer is
not touched, not copied and not reallocated — `b` now points at the same bytes
`a` pointed at.

C is the appealing wrong answer. The *restriction* is compile-time; the handle
copy is a real `memcpy`, though in practice the optimiser usually elides it.

The takeaway: moves are cheap. People avoid them with `clone()` to dodge a cost
that was never there, and `clone()` is the operation that actually touches the
allocator.

## 5

Why can `String` never implement `Copy`?

- A. Because it is too large to copy efficiently
- *B. Because `Copy` and `Drop` are mutually exclusive, and `String` has a destructor
- C. Because the standard library authors chose not to
- D. Because its size is not known at compile time

@why
`Copy` means the bytes can be duplicated to produce a complete, independent
value. `String` has a destructor that frees its buffer, so two byte-identical
copies would both free the same allocation — a double free. The language
enforces this structurally: a type cannot be both `Copy` and `Drop`.

D is a common confusion. A `String`'s *size* is perfectly well known — 24 bytes,
always. It is its *contents* whose size is not, which is why they live on the heap.

## 6

Does this compile?

```rust
#[derive(Copy, Clone)]
struct Point { x: i32, y: i32 }

let p = Point { x: 1, y: 2 };
let q = p;
println!("{}", p.x);
```

- *A. Yes — every field is `Copy`, so `Point` can be
- B. No — structs can never be `Copy`
- C. No — you must implement `Copy` manually
- D. Yes, but `p.x` reads garbage after the copy

@why
`Copy` is inherited from the fields: a struct may be `Copy` when **every** field
is. Both fields here are `i32`, so the derive is accepted and `let q = p;` copies
sixteen bytes leaving both live.

Add one `String` field and the same derive becomes `error[E0204]`, permanently —
no amount of other integer fields can rescue it.

## 7

What does this print?

```rust
struct Noisy(&'static str);
impl Drop for Noisy {
    fn drop(&mut self) { println!("drop {}", self.0); }
}

fn main() {
    let _a = Noisy("a");
    let _b = Noisy("b");
}
```

- A. `drop a` then `drop b`
- *B. `drop b` then `drop a`
- C. Nothing — `Drop` is only for heap values
- D. The order is unspecified

@why
Bindings drop in **reverse declaration order**. This is not arbitrary: later
bindings are the ones most likely to depend on earlier ones — a guard taken from
a lock declared above it, a writer wrapping a file opened before it — so
unwinding in the opposite order to construction is the only sequence that is
always safe.

## 8

Which of these is dropped at the end of the block? Choose all that apply.

```rust
{
    let a = Noisy("a");
    let b = Noisy("b");
    let c = b;
    let _ = Noisy("d");
}
```

- *A. `a`
- B. `b`
- *C. `c`
- D. `_` — at the end of the block

@why
`a` and `c` are dropped at the end. `b` is not: it was moved into `c`, so it no
longer owns anything, and dropping it too would run one destructor twice — the
double free, exactly.

D is the trap and it is a real one. `let _ = ...` is not a binding at all; the
value is dropped **immediately**, on that very line. So `Noisy("d")` prints its
drop message before `c` and `a` do. This is why `let _ = mutex.lock();` takes a
lock and releases it on the same line, while `let _guard = mutex.lock();` holds
it — a single underscore that has ended real production incidents.

## 9

`s` is a `String`. Which call leaves `s` usable afterwards?

- *A. `s.as_bytes()`
- B. `s.into_bytes()`
- *C. `s.to_uppercase()`
- *D. `s.len()`
- E. `s.into_boxed_str()`

@why
The standard library encodes the receiver in the method name, and it is worth
learning once:

- `as_*` borrows — `&self` in, a cheap view out, no allocation
- `to_*` clones — `&self` in, a new owned value out, usually allocating
- `into_*` consumes — `self` in, the receiver is gone afterwards

So A, C and D borrow and leave `s` intact. B and E take `self` and consume it.

## 10

Does this compile?

```rust
fn total(v: Vec<i32>) -> i32 {
    let mut sum = 0;
    for x in v { sum += x; }
    sum
}

let v = vec![1, 2, 3];
println!("{} {}", total(v), v.len());
```

- A. Yes
- *B. No — `v` was moved into `total`
- C. No — you cannot sum a `Vec` with a `for` loop
- D. Yes, because `total` only reads the vector

@why
D states the intent and misses the mechanism. `total` *does* only read, but its
signature says `Vec<i32>` by value, so calling it moves the vector regardless of
what the body does. The type is the contract; the body does not get a vote.

Two separate moves are actually present: `total(v)` at the call site, and
`for x in v` inside, which calls `into_iter` and consumes the vector. Taking
`&[i32]` fixes both and makes the function accept arrays and sub-slices too.

## 11

What is the difference between `Clone` and `Copy`?

- A. None — `Copy` is just a shorthand for `Clone`
- *B. `Copy` duplicates implicitly on assignment; `Clone` duplicates only when you call `.clone()`
- C. `Clone` is for stack values, `Copy` for heap values
- D. `Copy` is deep, `Clone` is shallow

@why
The difference is who decides and when. `Copy` happens silently at every
assignment and every by-value use. `Clone` happens only where you wrote
`.clone()`.

That visibility is deliberate. `Clone` may allocate and copy an arbitrary amount
of data, and in a language where duplication is implicit, an accidental deep copy
in a hot loop stays invisible until you profile. Here it is a method call you can
see and grep for.

Note the relationship: `Copy` **requires** `Clone`. Every `Copy` type is also
`Clone`; the reverse is not true.

## 12

Does this compile?

```rust
let s = String::from("hi");
let r = &s;
let t = s;
println!("{r}");
```

- A. Yes — `r` is just a reference
- *B. No — `s` cannot be moved while it is borrowed
- C. No — you cannot take a reference to a `String`
- D. Yes, and it prints `hi`

@why
This is the seam where ownership meets borrowing. `r` borrows `s`, and then
`let t = s;` tries to move the value out from under that borrow. If it were
allowed, `r` would point at a stack slot whose value has been retired — a
dangling reference, which is the bug references exist to prevent.

So a value cannot be moved while any reference to it is still live. The error is
`error[E0505]: cannot move out of s because it is borrowed`, and it is the first
rule of the next unit.

## 13

`clone()` is the right answer when…

- A. Whenever the borrow checker complains
- *B. You genuinely need two independent values
- C. Whenever you would otherwise pass by reference
- *D. The cost is provably irrelevant and it keeps the code simpler

@why
B is the honest case, and D is the pragmatic one — a clone of a short string in
setup code that runs once is not worth a design discussion.

A is the trap and the most common way to write slow, noisy Rust. A borrow-checker
complaint is a question — *who should own this, and for how long?* — and `clone()`
answers it by refusing to answer. Sometimes that is fine. Often the intended
answer was a single `&`.

## 14

After `takes(s)` where `fn takes(s: String)`, when is `s`'s buffer freed?

- A. At the end of the caller's scope
- *B. At the end of `takes`, when its parameter goes out of scope
- C. When the garbage collector next runs
- D. It is never freed — this leaks

@why
The parameter *is* the owner now. When `takes` returns, its parameter goes out of
scope and its destructor hands the buffer back to the allocator.

This is the point of the whole design: the free happens at a place the compiler
picked by following ownership, not at a place you had to remember. And it happens
on every exit path from `takes`, including an early `return` and a panic unwinding
through the frame — which is why Rust needs no `finally` block.

## 15

What is the runtime cost of Rust's ownership checking?

- A. A reference count on every value
- B. A small periodic pause, much shorter than a garbage collector's
- *C. Essentially none — the analysis happens entirely at compile time
- D. One pointer indirection per access

@why
Ownership is a static analysis. It runs in the compiler, decides where the drops
go, emits them, and then does not exist any more. The machine code contains the
right number of frees in the right places — which is exactly the code a careful C
programmer would have written by hand.

The word "essentially" covers one small honest exception: where a value is moved
on one branch and not another, the compiler cannot know statically whether to
drop it, so it inserts a hidden boolean **drop flag** and checks it. That is a byte
and a branch, usually optimised away, and it is the entire runtime footprint.
