---
unit: 23-unsafe
---

## 1. The dereference is the gate

@kind fix
@concept raw pointer

@expect E0133

Building a raw pointer from a borrow is perfectly safe. It is just an address,
and an address on its own cannot hurt anybody. Reading through it is the
operation the compiler cannot check, so that is the one it refuses.

Make this compile, and write a `// SAFETY:` line saying why the read is fine.

```starter
pub fn run() -> i32 {
    let value = 41;
    let p: *const i32 = &value;
    *p + 1
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_through_the_pointer() {
        assert_eq!(run(), 42);
    }
}
```

```solution
pub fn run() -> i32 {
    let value = 41;
    let p: *const i32 = &value;
    // SAFETY: `p` was created from a borrow of `value`, which is still in
    // scope, so it is non-null, aligned and points at an initialised `i32`.
    unsafe { *p + 1 }
}
```

@hint Two of these three lines are already legal. Only one operation in the whole function is on the list of five.
@hint Wrap the dereference in an `unsafe` block, rather than the whole function.
@hint `unsafe { *p + 1 }` as the tail expression, with a `// SAFETY:` comment above it naming why `p` is valid.

@diagnose E0133
`dereference of raw pointer is unsafe and requires unsafe function or block`,
with the note `raw pointers may be null, dangling or unaligned`.

That note is the entire argument. The compiler tracked nothing about `p` after
the cast: not what it points at, not whether that thing is still alive, not
whether anything else is writing to it. `&value` had all of those guarantees;
`*const i32` has none of them. So the compiler cannot prove `*p` reads a live,
aligned, initialised `i32`, and it will not guess.

Note what it did *not* complain about: creating `p`, or printing it. Only the
dereference is gated, because only the dereference can be wrong.

@after
Keep the block as small as the operation. `unsafe { *p + 1 }` is better than
wrapping the function body, because the block is a claim you are making, and a
claim about one expression is one you can actually check.

The `// SAFETY:` comment is not decoration. Every unsafe block in the standard
library has one, Clippy has a lint that requires them
(`undocumented_unsafe_blocks`), and in review a block without one is a finding.
Writing the sentence is also the cheapest way to discover you cannot: if you
cannot say why it is sound, it is not.

## 2. Unsafe is not a borrow-checker override

@kind fix
@concept unsafe

@expect E0499

Somebody hit a borrow error, wrapped the offending lines in `unsafe`, and was
surprised when the error stayed exactly where it was.

Fix it properly. The `unsafe` block has no business being here at all.

```starter
pub struct Config {
    pub retries: u32,
    pub timeout: u32,
}

pub fn run() -> Config {
    let mut config = Config { retries: 0, timeout: 0 };
    unsafe {
        let a = &mut config;
        let b = &mut config;
        a.retries = 3;
        b.timeout = 30;
    }
    config
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sets_both_fields() {
        let c = run();
        assert_eq!((c.retries, c.timeout), (3, 30));
    }
}
```

```solution
pub struct Config {
    pub retries: u32,
    pub timeout: u32,
}

pub fn run() -> Config {
    let mut config = Config { retries: 0, timeout: 0 };
    let a = &mut config.retries;
    let b = &mut config.timeout;
    *a = 3;
    *b = 30;
    config
}
```

@hint The `unsafe` block changes nothing about this error. Delete it and solve the real problem.
@hint The two borrows want two different fields, but they both ask for the whole struct.
@hint Borrow the fields directly. `&mut config.retries` and `&mut config.timeout` are disjoint paths, so both may be unique at once.

@diagnose E0499
`cannot borrow config as mutable more than once at a time`, raised inside an
`unsafe` block, which is the point of this exercise.

`unsafe` unlocks exactly five operations: dereferencing a raw pointer, calling
an unsafe function, implementing an unsafe trait, touching a `static mut`, and
reading a union field. Taking two `&mut` to one value is on none of those lists,
so nothing about the block applies to it. Type checking, move checking and
borrow checking run identically on both sides of the brace.

The fix is a split borrow: the checker tracks *paths*, and `config.retries` and
`config.timeout` are disjoint pieces of memory, so a unique borrow of each is
two unique borrows of two different things.

@after
The rule to carry: **an error whose code starts E04 or E05 is never fixed by
`unsafe`.** Those are borrow and move errors, and the keyword does not speak to
them. If you have typed `unsafe` in response to one, the message was a question
about ownership that you have not answered yet.

There is a genuine version of this. `split_at_mut` really does use raw pointers
to hand out two disjoint `&mut` into one slice, because the checker cannot reason
about indices. That is exercise 8, and it looks nothing like this.

## 3. A const pointer cannot become a mut pointer

@kind fix
@concept raw pointer

@expect E0308

The intent is to bump a counter through a raw pointer. The `unsafe` block is
already there and the arithmetic is fine. The pointer itself is built wrong, and
the mistake happens one line earlier than people expect.

```starter
pub fn run() -> u32 {
    let mut count: u32 = 7;
    let p: *mut u32 = &count;
    unsafe {
        *p += 1;
        *p
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bumps_through_the_pointer() {
        assert_eq!(run(), 8);
    }
}
```

```solution
pub fn run() -> u32 {
    let mut count: u32 = 7;
    let p: *mut u32 = &mut count;
    unsafe {
        // SAFETY: `p` came from a unique borrow of `count`, which is live for
        // the whole block, and no other pointer to `count` exists.
        *p += 1;
        *p
    }
}
```

@hint Read the two types in the error. What kind of borrow is `&count`?
@hint A shared borrow coerces to `*const u32` and stops there. Writing needs a pointer that started life as a unique borrow.
@hint `let p: *mut u32 = &mut count;`

@diagnose E0308
`expected raw pointer *mut u32, found reference &u32`. A `&T` coerces to
`*const T` and no further; there is no path from a shared borrow to a mutable
raw pointer, and the compiler will not invent one.

That refusal is doing real work. Provenance, meaning where a pointer came from,
is part of what a pointer is. A pointer derived from `&count` carries a permission
to read and nothing more, and writing through it is undefined behaviour even
after an `as *mut u32` cast that silences the type error. The write would look
fine, run fine in a debug build, and be miscompiled the day the optimiser decides
`count` cannot have changed.

Start from `&mut count` and the permission is there from the beginning.

@diagnose E0133
You have a write or a read of `*p` outside the `unsafe` block. Every
dereference of a raw pointer needs to be inside one, including the compound
assignment `*p += 1`, which is a read and a write.

@after
`as` casts between pointer types compile very freely: `*const T` to `*mut T` to
`*const U` to `usize` and back, and almost none of that is checked. This is the
part of unsafe Rust where the type system stops helping, and the only thing
keeping you honest is knowing where the pointer came from.

The rule of thumb: **derive the pointer from a borrow with the permission you
need, at the moment you create it.** `&mut x as *mut T` is sound. `&x as *const T
as *mut T` compiles and is a bug.

## 4. Calling an unsafe function is a promise

@kind fix
@concept safe abstraction

@expect E0133

`at` is `unsafe` and says why in its doc comment: the caller must guarantee the
index is in bounds. `get` is meant to be the safe wrapper around it, and it
currently does not check anything.

Making it compile is easy. Making it *sound* is the exercise, so read the tests
before you decide where the `unsafe` goes.

```starter
/// # Safety
/// `i` must be less than `v.len()`.
pub unsafe fn at(v: &[i32], i: usize) -> i32 {
    // SAFETY: guaranteed by the caller.
    unsafe { *v.get_unchecked(i) }
}

pub fn get(v: &[i32], i: usize) -> Option<i32> {
    Some(at(v, i))
}

pub fn run() -> (Option<i32>, Option<i32>) {
    let v = vec![10, 20, 30];
    (get(&v, 1), get(&v, 7))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn in_bounds_and_out_of_bounds() {
        assert_eq!(run(), (Some(20), None));
    }
    #[test]
    fn rejects_every_index_past_the_end() {
        let v = vec![1, 2, 3];
        assert_eq!(get(&v, 3), None);
        assert_eq!(get(&v, usize::MAX), None);
    }
}
```

```solution
/// # Safety
/// `i` must be less than `v.len()`.
pub unsafe fn at(v: &[i32], i: usize) -> i32 {
    // SAFETY: guaranteed by the caller.
    unsafe { *v.get_unchecked(i) }
}

pub fn get(v: &[i32], i: usize) -> Option<i32> {
    if i < v.len() {
        // SAFETY: `i < v.len()` was just checked, so the offset is in bounds.
        Some(unsafe { at(v, i) })
    } else {
        None
    }
}

pub fn run() -> (Option<i32>, Option<i32>) {
    let v = vec![10, 20, 30];
    (get(&v, 1), get(&v, 7))
}
```

@hint Wrapping the call in `unsafe` will compile. Run the tests and see what happens to `get(&v, 7)`.
@hint The `# Safety` section is a contract. `get` has to discharge it, not repeat it.
@hint Check `i < v.len()` first; call `at` only in that branch and return `None` in the other.

@diagnose E0133
`call to unsafe function at is unsafe and requires unsafe function or block`.

The compiler is not saying `at` is broken. It is saying `at` has a precondition
written in its `# Safety` section that the compiler cannot verify, so somebody
has to. Typing `unsafe` is how you say "I did".

Which is why the lazy fix is the dangerous one. `Some(unsafe { at(v, i) })`
silences this error and leaves `get` accepting any `usize` at all, reading
whatever lies past the end of the allocation for large ones. It has a safe
signature, so nothing will ever warn a caller again. That is the definition of
an **unsound** API, and the bug belongs to whoever wrote the `unsafe`.

@after
This is the shape of essentially all real unsafe code: an `unsafe fn` with a
stated contract, and a safe function that discharges the contract with a check
and then calls it. `slice::get` and `slice::get_unchecked` are exactly this pair
in the standard library.

Notice who pays. The bounds check is one comparison and a predictable branch, in
the wrapper, once. `get_unchecked` exists for the loops where the compiler
already proved the index and the check would be pure waste. It is not a general
speed-up. Reach for it when a profile says so, never before.

## 5. An unsafe trait needs an unsafe impl

@kind fix
@concept unsafe

@expect E0200

`Zeroed` is declared `unsafe` because implementing it wrongly would let other
code build values that are not valid for their type. The two impls below are
correct, but they are not written the way the compiler requires.

```starter
/// # Safety
/// The value returned by `zeroed` must be a valid value of `Self`, and `Self`
/// must have no invalid bit patterns for the all-zero byte pattern.
pub unsafe trait Zeroed {
    fn zeroed() -> Self;
}

impl Zeroed for u32 {
    fn zeroed() -> u32 {
        0
    }
}

impl Zeroed for bool {
    fn zeroed() -> bool {
        false
    }
}

pub fn run() -> (u32, bool) {
    (<u32 as Zeroed>::zeroed(), <bool as Zeroed>::zeroed())
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn both_zeroes() {
        assert_eq!(run(), (0, false));
    }
}
```

```solution
/// # Safety
/// The value returned by `zeroed` must be a valid value of `Self`, and `Self`
/// must have no invalid bit patterns for the all-zero byte pattern.
pub unsafe trait Zeroed {
    fn zeroed() -> Self;
}

// SAFETY: 0 is a valid u32; every bit pattern is a valid u32.
unsafe impl Zeroed for u32 {
    fn zeroed() -> u32 {
        0
    }
}

// SAFETY: `false` is the all-zero bit pattern for bool, and is valid.
unsafe impl Zeroed for bool {
    fn zeroed() -> bool {
        false
    }
}

pub fn run() -> (u32, bool) {
    (<u32 as Zeroed>::zeroed(), <bool as Zeroed>::zeroed())
}
```

@hint The trait declaration already tells you what is missing. Read the first word of it.
@hint Implementing an unsafe trait is one of the five operations, so the `impl` has to be marked.
@hint `unsafe impl Zeroed for u32 { ... }`, with a `// SAFETY:` comment above each one.

@diagnose E0200
`the trait Zeroed requires an unsafe impl declaration`.

An unsafe trait is one where the *implementor*, not the caller, owes a
guarantee. `Send` and `Sync` are the famous examples: implementing `Send`
wrongly does not make `Send`'s own code misbehave, it makes every generic
function that trusted the bound misbehave, somewhere else entirely.

So the keyword goes on the `impl`, because that is where the claim is made.
Writing `unsafe impl` is you saying you have read the `# Safety` section and
your type satisfies it. That is also why `unsafe impl` is the only place where
`unsafe` appears without a block: there is no code to gate, only a promise.

@diagnose E0199
You have put `unsafe impl` on a trait that is not declared `unsafe`. The two
must agree: `unsafe trait` requires `unsafe impl`, and a safe trait forbids it.

@after
The direction of the obligation is the thing to remember, because it is the
reverse of an `unsafe fn`.

| | who owes the guarantee |
|---|---|
| `unsafe fn` | the **caller**, at every call site |
| `unsafe trait` | the **implementor**, once per impl |

`Send` and `Sync` are auto-implemented for you by the compiler whenever it can
prove them structurally. You only write `unsafe impl Send for T {}` by hand when
you have a raw pointer inside and you know something the compiler does not,
which is exactly the situation where you should write down what that is.

## 6. The wrong repr

@kind fix
@concept repr

@expect E0690

This header is going to be handed to a C library, so its layout matters down to
the byte. Someone reached for a `repr` that does not mean what they thought it
meant, and the compiler is refusing the whole struct.

Fix the attribute so the struct has C's layout. The tests pin the size and the
field offsets.

```starter
#[repr(transparent)]
pub struct Header {
    pub magic: u32,
    pub len: u16,
    pub kind: u8,
}

pub fn run() -> usize {
    std::mem::size_of::<Header>()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn c_layout_is_eight_bytes() {
        assert_eq!(run(), 8);
    }
    #[test]
    fn fields_are_in_source_order() {
        let h = Header { magic: 1, len: 2, kind: 3 };
        let base = &h as *const Header as usize;
        let m = &h.magic as *const u32 as usize;
        let k = &h.kind as *const u8 as usize;
        assert_eq!(m - base, 0);
        assert_eq!(k - base, 6);
    }
}
```

```solution
#[repr(C)]
pub struct Header {
    pub magic: u32,
    pub len: u16,
    pub kind: u8,
}

pub fn run() -> usize {
    std::mem::size_of::<Header>()
}
```

@hint `transparent` means "this type is a disguise for exactly one other type". Count the fields.
@hint There is exactly one `repr` that means "lay this out the way a C compiler would".
@hint `#[repr(C)]`.

@diagnose E0690
`transparent struct needs at most one non-trivial field, but has 3`, with each
field underlined as evidence.

`#[repr(transparent)]` is a promise that the struct is layout-identical to its
single field: same size, same alignment, same ABI. That is what makes a newtype
free to pass across an FFI boundary. Three fields cannot all be the one
the struct is a disguise for, so the promise is unmeetable and the compiler says
so.

What was wanted is `#[repr(C)]`: fields in source order, C's alignment and
padding rules, no reordering. Without any `repr` the struct is `repr(Rust)`,
which guarantees nothing at all. The compiler may sort fields by alignment to
shrink padding, and may change that decision between releases. Handing a
`repr(Rust)` struct to C is undefined behaviour that will appear to work until
it does not.

@after
Read the arithmetic the second test pins. `magic: u32` sits at offset 0 and
takes 4 bytes; `len: u16` needs 2-byte alignment and lands at 4; `kind: u8` at
6; the struct's alignment is 4 because its widest field is, so the size rounds
up to 8 with one padding byte at the end. A C compiler produces exactly the same
layout, which is the entire point of the attribute.

The `repr` family, briefly: `C` for interop, `transparent` for a newtype that
must be indistinguishable from its single field, `packed` for wire formats with
no padding (and misaligned fields, which is its own hazard), and `u8`/`u16`/`i32`
to fix an enum's discriminant type. Applying that last group to a struct is a
different error, and a common one: a struct has no discriminant to size.

## 7. static mut is almost never the answer

@kind fix
@concept static mut

@expect E0133

A global counter, written the way it would be in C. Touching a `static mut` is
one of the five operations, so this does not compile. But adding `unsafe` is the
wrong repair. The underlying problem is that two threads calling `record` would
be a data race, and therefore instant undefined behaviour.

Rewrite it so no `unsafe` appears anywhere.

```starter
pub static mut HITS: u64 = 0;

pub fn record() {
    HITS += 1;
}

pub fn run() -> u64 {
    record();
    record();
    record();
    HITS
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_three() {
        assert_eq!(run(), 3);
    }
}
```

```solution
use std::sync::atomic::{AtomicU64, Ordering};

pub static HITS: AtomicU64 = AtomicU64::new(0);

pub fn record() {
    HITS.fetch_add(1, Ordering::Relaxed);
}

pub fn run() -> u64 {
    record();
    record();
    record();
    HITS.load(Ordering::Relaxed)
}
```

@hint The type is the problem, not the missing keyword. What can be mutated from several threads without a data race?
@hint `std::sync::atomic::AtomicU64` is a plain `static`, no `mut`, and its methods take `&self`.
@hint `HITS.fetch_add(1, Ordering::Relaxed)` to increment, `HITS.load(Ordering::Relaxed)` to read.

@diagnose E0133
`use of mutable static is unsafe and requires unsafe function or block`, with
the note `mutable statics can be mutated by multiple threads`.

The note is the whole reason. A `static mut` is a global with no synchronisation
of any kind, so two threads incrementing it race, and a data race in Rust is
immediate undefined behaviour. Not a lost count: a program the optimiser is
entitled to compile into anything.

Adding `unsafe` would compile. It would also be you certifying that no two
threads can ever reach `record` at once, in a library where you do not control
the callers. That is not a promise you are in a position to make.

@diagnose E0796
Since edition 2024 it is a hard error to create a reference to a `static mut`,
whether `&HITS` or `&mut HITS`, because that reference would claim aliasing
guarantees nothing can enforce for a global. This is another sign that the type is wrong
rather than the syntax.

@after
`AtomicU64` costs one instruction with `Relaxed` ordering on x86, a `lock xadd`,
and it is correct under threads, which `static mut` never is. The interior
mutability lives inside `UnsafeCell`, the compiler knows about it, and the
`unsafe` is somebody else's, already written and already audited.

The full menu for shared mutable global state, in the order you should try it:
`OnceLock` for write-once, an atomic for a counter or flag, `Mutex`/`RwLock` for
anything larger, `thread_local!` when it need not be shared at all. `static mut`
is on none of these lists.

## 8. A safe abstraction over two disjoint pointers

@kind fix
@concept safe abstraction

@expect E0133

This is the real thing: `split_at_mut`, which hands out two `&mut` into one
slice. The borrow checker cannot prove two index ranges are disjoint, so the
standard library builds this with raw pointers and wraps it in a safe signature.

The body is written. Add the `unsafe`, and add whatever else is needed to make
the safe signature honest. The second test is the specification.

```starter
pub fn split_mut(v: &mut [i32], mid: usize) -> (&mut [i32], &mut [i32]) {
    let len = v.len();
    let p = v.as_mut_ptr();
    (
        std::slice::from_raw_parts_mut(p, mid),
        std::slice::from_raw_parts_mut(p.add(mid), len - mid),
    )
}

pub fn run() -> Vec<i32> {
    let mut v = vec![1, 2, 3, 4, 5, 6];
    let (a, b) = split_mut(&mut v, 2);
    for x in a.iter_mut() {
        *x *= 10;
    }
    for x in b.iter_mut() {
        *x += 100;
    }
    v
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn both_halves_are_writable() {
        assert_eq!(run(), vec![10, 20, 103, 104, 105, 106]);
    }
    #[test]
    #[should_panic]
    fn refuses_a_mid_past_the_end() {
        let mut v = vec![1, 2, 3];
        let _ = split_mut(&mut v, 9);
    }
    #[test]
    fn empty_halves_are_fine() {
        let mut v = vec![7, 8];
        let (a, b) = split_mut(&mut v, 0);
        assert!(a.is_empty());
        assert_eq!(b, &mut [7, 8][..]);
    }
}
```

```solution
pub fn split_mut(v: &mut [i32], mid: usize) -> (&mut [i32], &mut [i32]) {
    let len = v.len();
    assert!(mid <= len, "mid {mid} is past the end of a slice of {len}");
    let p = v.as_mut_ptr();
    // SAFETY: `mid <= len`, so both ranges lie inside the one allocation `p`
    // points at, and they do not overlap, so the two `&mut` never alias. `p`
    // came from a live `&mut [i32]`, so it is non-null, aligned, and all
    // `len` elements are initialised. The returned lifetimes are elided from
    // `v`, so neither slice can outlive the borrow they were carved from.
    unsafe {
        (
            std::slice::from_raw_parts_mut(p, mid),
            std::slice::from_raw_parts_mut(p.add(mid), len - mid),
        )
    }
}

pub fn run() -> Vec<i32> {
    let mut v = vec![1, 2, 3, 4, 5, 6];
    let (a, b) = split_mut(&mut v, 2);
    for x in a.iter_mut() {
        *x *= 10;
    }
    for x in b.iter_mut() {
        *x += 100;
    }
    v
}
```

@hint Three unsafe operations are in there: two calls to `from_raw_parts_mut` and the pointer arithmetic in `p.add(mid)`.
@hint Wrapping them compiles. Now read the second test: what does `split_mut(&mut v, 9)` do to `len - mid` and to `p.add(mid)`?
@hint `assert!(mid <= len)` before the pointer work. Without it the subtraction underflows to a colossal length and `add` walks off the allocation, which is undefined behaviour with a safe signature in front of it.

@diagnose E0133
`call to unsafe function slice::from_raw_parts_mut is unsafe`, and separately
`call to unsafe function ptr::add is unsafe`.

Both have preconditions the compiler cannot check. `from_raw_parts_mut` requires
that the pointer is non-null and aligned, that `len` elements starting there are
initialised and inside one allocation, and, the hard one, that nothing else
accesses them for the lifetime it invents for the result. `add` requires that
the resulting pointer stays within, or exactly one past the end of, the same
allocation.

Wrapping the whole thing in one block is fine here, because the three operations
share one argument and one `// SAFETY:` paragraph discharges all of them.

@diagnose E0499
You are trying to build the two halves from `v` directly rather than from a raw
pointer. That is the error `split_at_mut` exists to work around: two `&mut` into
one slice cannot be produced by safe code, because the checker reasons about
whole paths and has no idea that `..mid` and `mid..` do not overlap.

@after
Notice what makes this sound rather than merely compiling, because it is three
separate things.

**The assert** turns every possible argument into a defined outcome: a panic is
not undefined behaviour. Without it, `mid = 9` on a slice of 3 makes `len - mid`
underflow to about 18 quintillion, and a safe caller has triggered UB.

**The disjointness** is the claim the borrow checker could not make. `..mid` and
`mid..` genuinely do not overlap, and that sentence in the `// SAFETY:` comment
is the actual proof.

**The elided lifetimes** do the rest. With one input reference and two output
references, elision gives both outputs the lifetime of `v`, so `v` stays
borrowed until both halves are dead, and neither can dangle. Had you written
`&'static mut [i32]`, everything would still compile and the function would be
catastrophically unsound.

This is what "safe abstraction" means: no argument, from any caller, reaches
undefined behaviour.
