---
unit: 23-unsafe
---

## 1

Which of these does `unsafe` permit that safe Rust does not? Choose all that apply.

- *A. Dereferencing a raw pointer
- B. Having two `&mut` to the same value
- *C. Calling a function declared `unsafe fn`
- *D. Reading a field of a `union`
- E. Moving out of a value that is borrowed

@why
The list is exactly five: dereference a raw pointer, call an unsafe function,
implement an unsafe trait, access a `static mut`, read a union field. A, C and D
are on it.

B and E are the tempting ones and they are the whole misconception. Aliasing
rules and move rules are checked identically inside and outside an `unsafe`
block, so E0499 and E0505 fire either way. `unsafe` is not a borrow-checker
override, and typing it in response to one of those errors means the message has
not been read yet.

## 2

Does this compile?

```rust
let x = 42;
let p = &x as *const i32;
println!("{p:?}");
```

- *A. Yes, because creating and printing a raw pointer is safe
- B. No, because any use of a raw pointer needs `unsafe`
- C. No, because `*const i32` does not implement `Debug`
- D. Yes, but only because `x` is `Copy`

@why
Creating a raw pointer, casting one, comparing two and printing one are all
safe, because none of them can cause harm. Only the **dereference** is gated,
because only the dereference can read memory that is not there.

B is the intuition most people arrive with, and getting rid of it tells you
where to look when auditing unsafe code: at the `*p`, never at the cast.

## 3

What is the runtime cost of an `unsafe` block?

- A. A bounds check is skipped, so it is faster
- *B. None; it is a compile-time permission and emits no code
- C. A small check that the block did not violate any invariants
- D. It disables optimisations inside the block

@why
`unsafe` generates nothing. It changes which operations the compiler will accept
in that region and nothing else.

A is the seductive wrong answer. Unsafe code can be faster, and `get_unchecked`
really does skip a comparison, but that is the *function you chose to call*
rather than the keyword. Wrapping ordinary code in `unsafe` makes it exactly as fast as
it was.

## 4

Which of these are true of `*const T` but not of `&T`? Choose all that apply.

- *A. It may be null
- *B. It may point at freed memory
- *C. Nothing tracks what else points at the same place
- D. It is `Copy`
- E. It is one machine word wide

@why
A, B and C are the three guarantees a reference carries and a raw pointer does
not, and together they are why dereferencing one needs a promise from you.

D and E are true of both, which is what makes them good distractors. `&T` is
`Copy` and a thin reference is one word, exactly like a `*const T`. On the
machine they are the same bits; the difference is entirely in what the compiler
is allowed to assume about them.

## 5

Why is undefined behaviour worse than a crash?

- A. It is not; a crash is worse because the program stops
- *B. The optimiser may assume UB cannot happen and rewrite unrelated code on that assumption
- C. It always corrupts the heap
- D. It can only be found with a debugger

@why
UB is not a behaviour, it is the absence of a specification. The compiler
optimises on the assumption that your program has none, so a null dereference
does not merely fault. It licenses the optimiser to delete the null check three
lines later as unreachable, and the crash then surfaces somewhere with no
`unsafe` anywhere near it.

C is too specific: UB may corrupt nothing, may work perfectly in debug, and may
change behaviour on the next compiler release. That instability is the point.

## 6

Does this compile, and is it sound?

```rust
pub fn get(v: &[i32], i: usize) -> i32 {
    unsafe { *v.get_unchecked(i) }
}
```

- A. It does not compile, because `get_unchecked` needs a bounds check
- B. Compiles, and is sound because the `unsafe` block is explicit
- *C. Compiles, and is unsound, because a safe caller can pass any index
- D. Compiles, and is sound because `i32` has no invalid bit patterns

@why
It compiles perfectly, which is exactly the problem. The signature is safe, so
`get(&v, 900)` is an ordinary call with no warning attached, and it reads 3,600
bytes past the allocation.

An API is **unsound** when some safe caller can trigger undefined behaviour, and
the bug belongs to whoever wrote the `unsafe`, not to the caller who found it.
D is a real fact used as a red herring: the value read would indeed be a valid
`i32`, but the *read itself* was out of bounds, and that is the UB.

## 7

What does `unsafe` on a function signature mean?

- A. The body of the function contains unsafe operations
- *B. Callers must uphold preconditions the compiler cannot check
- C. The function is exempt from borrow checking
- D. The function may panic

@why
`unsafe fn` pushes an obligation outward: every call site must promise something,
which is why the promise belongs in a `/// # Safety` section.

A is the near-miss, and the distinction matters. A function full of unsafe
operations that checks all its own preconditions should have a **safe**
signature, which is what a safe abstraction is. `Vec::push` is stuffed with
unsafe code and is not an `unsafe fn`.

## 8

Since edition 2024, what is true of the body of an `unsafe fn`?

- A. It is an implicit `unsafe` block, as before
- *B. Unsafe operations inside it still need their own `unsafe` block
- C. Unsafe functions can no longer be declared
- D. The body is checked by Miri automatically

@why
The two claims are unrelated, so the language stopped conflating them. That your
*callers* owe you a precondition says nothing about which of your own lines are
sound, and treating the whole body as pre-approved hid real bugs in large unsafe
functions.

Upgrading old code to edition 2024 therefore produces a wave of `error[E0133]`
inside `unsafe fn` bodies. The fix is not to delete the error but to add the
inner block and the `// SAFETY:` line that says why it holds.

## 9

Which types in the standard library are implemented with `unsafe` inside? Choose all that apply.

- *A. `Vec<T>`
- *B. `String`
- *C. `RefCell<T>`
- *D. `Rc<T>`
- E. None; the standard library is entirely safe Rust

@why
All four, and many more. `Vec` manages a raw allocation, `String` maintains a
UTF-8 invariant over `Vec<u8>`, `RefCell` mutates through a shared reference via
`UnsafeCell`, and `Rc` writes a refcount through an aliased pointer.

That is the point of the feature rather than an embarrassment. Each of them
exposes an API where no safe call can cause undefined behaviour, so the unsafe
code was written once, audited once, and every user gets the guarantee for free.
Writing your own unsafe means making the same bargain.

## 10

Does this compile?

```rust
let x = 5u32;
let p: *mut u32 = &x;
unsafe { *p = 6; }
```

- A. Yes, because `as` casts make any pointer conversion legal
- *B. No, because `&x` is a shared borrow and coerces only to `*const u32`
- C. No, because `x` is not declared `mut`
- D. Yes, and it is sound

@why
`error[E0308]: expected raw pointer *mut u32, found reference &u32`. A `&T`
coerces to `*const T` and stops there.

C is a genuinely tempting reading, because `x` not being `mut` *is* also wrong.
But the error you get is the type mismatch, and it would still be a type
mismatch with `let mut x`. The deeper point is **provenance**: a pointer derived
from a shared borrow carries permission to read only, so writing through it is
undefined behaviour even after an `as *mut u32` cast has silenced the compiler.

## 11

What is `#[repr(C)]` for?

- A. Making a type compile faster
- *B. Pinning field order, alignment and padding to C's rules so another language can agree about the layout
- C. Marking a type as unsafe
- D. Removing padding from a struct

@why
Default `repr(Rust)` layout guarantees nothing: the compiler may reorder fields
to shrink padding and may change that decision between releases. `#[repr(C)]`
fixes the layout so a C header and a Rust struct describe the same bytes.

D is `#[repr(packed)]`, a different attribute with a different hazard. It
produces misaligned fields, and taking a reference to one is a hard error
because a reference promises alignment.

## 12

Why is `static mut` almost always the wrong tool?

- *A. Two threads touching it is a data race, which is immediate undefined behaviour
- B. It is slower than an atomic
- C. It cannot hold a heap-allocated value
- D. It is deprecated and will be removed

@why
There is no synchronisation of any kind, so any concurrent access is a data
race, and a data race is UB rather than a merely wrong number. Writing `unsafe`
around it is you certifying that no two threads can ever reach that line, a
promise you usually cannot make about your own library's callers.

B is backwards: `static mut` is nominally faster, which is exactly what makes it
tempting. The menu that is actually correct: `OnceLock` for write-once, an
atomic for a counter, `Mutex`/`RwLock` for anything larger, `thread_local!` when
it need not be shared.

## 13

Reading a field of a `union` is unsafe because…

- A. Unions are only allowed in FFI code
- *B. Nothing tracks which field was last written, so the read may reinterpret the wrong type's bytes
- C. Unions have no defined layout
- D. It requires a heap allocation

@why
A union's fields overlap in one piece of storage. Reading `u.f` asserts that `f`
is the field last written; if an `f32` was written and a `u32` is read, the bytes
are reinterpreted, and for some types that produces a value the language says
cannot exist.

The Rust answer to the same problem is an `enum`, which stores a discriminant so
the compiler can check. Unions exist for C layouts and for `MaybeUninit`, cases
where the discriminant lives somewhere else or is not wanted at all.

## 14

Which of these is a genuine reason to write `unsafe`? Choose all that apply.

- A. The borrow checker will not accept a correct-looking function
- *B. Calling into a C library
- *C. Implementing a data structure whose aliasing the checker cannot express, behind a safe API
- *D. A profile shows a bounds check in the hottest loop and the index is already proven
- E. A lifetime error you cannot work out

@why
B, C and D are the real cases, and the last two come with obligations: a safe
wrapper, a `// SAFETY:` comment, and Miri.

A and E are the same mistake twice. Borrow and lifetime errors are questions
about ownership and about time, and `unsafe` answers neither. It does not even
apply to them. The exception proves the rule: `split_at_mut` uses raw
pointers precisely because the checker cannot reason about index ranges, but the
result is a *safe* function that asserts `mid <= len` first.

## 15

What does Miri do?

- A. Proves an unsafe block is sound
- *B. Interprets the program and reports undefined behaviour along the paths your tests actually execute
- C. Rewrites unsafe code into safe code
- D. Checks unsafe code at compile time, like the borrow checker

@why
Miri runs the program at the MIR level and detects out-of-bounds pointer
arithmetic, use-after-free, misaligned reads, aliasing violations, uninitialised
reads and data races, all of which a normal test run will happily let past.

A overstates it, and the overstatement is worth naming: Miri only sees the code
paths your tests take, so a clean run is evidence, not proof. It is still the
single most effective thing you can do to unsafe code, and it routinely finds
bugs in crates that have been in production for years.
