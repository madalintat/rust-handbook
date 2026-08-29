---
num: 23
slug: 23-unsafe
title: Unsafe
accent: rust
concepts: unsafe, raw pointer, undefined behaviour, soundness, safe abstraction, safety comment, static mut, union, repr, FFI, Miri
needs: 05-ownership, 06-borrowing, 18-smart-ptr
blurb: Five extra operations and a transfer of responsibility. Not an escape hatch, and not a way to switch the borrow checker off.
---

%% `unsafe` is the most misread keyword in the language. It does not switch the borrow checker off. It is not what you reach for when the compiler is being difficult. Code inside an `unsafe` block is type-checked, borrow-checked and move-checked exactly as hard as code outside one.

What it does is unlock five operations the compiler cannot verify, and move responsibility for a specific list of invariants from the compiler onto you. That trade is the whole unit. You are not buying permission. You are signing something.

## What the keyword does

### The five operations

Inside an `unsafe` block, or an `unsafe fn`, you may do five things you cannot do anywhere else:

1. dereference a **raw pointer**
2. call an `unsafe` function or method
3. implement an `unsafe` trait
4. read or write a `static mut`
5. read a field of a `union`

That is the complete list. Every other rule in Rust still applies, unchanged.

### It does not disable the borrow checker

```rust,bad
let mut config = Config { retries: 0, timeout: 0 };
unsafe {
    let a = &mut config;
    let b = &mut config;   // error[E0499], exactly as it would be outside
    a.retries = 3;
}
```

E0382, E0499, E0502, E0106, E0308: all of them fire normally inside `unsafe`.
**A borrow error is never fixed by adding `unsafe`.** If you found yourself
typing it in response to one, you have misread the error. Go back and ask who
should own the value and for how long.

### What actually moves

The compiler normally proves a list of things about every program. In an
`unsafe` block it stops proving them and starts assuming them. The list:

| the compiler assumed | you now guarantee |
|---|---|
| references are non-null and aligned | every pointer you dereference is too |
| references are never dangling | the pointee outlives every use |
| `&mut` is unique | no other live pointer aliases it while you write |
| values match their type | a `bool` is `0` or `1`, a `char` is a scalar value, an enum has a real discriminant |
| memory is initialised before it is read | you never read uninitialised bytes |
| no data races | your shared mutation is synchronised |

:::note
`unsafe` does not mean "trust me, this is fine". It means "**the compiler cannot
check this; I have checked it**". The obligations do not disappear. They change
auditor.
:::

## Raw pointers

### Four guarantees a reference has and a pointer does not

```rust
let mut count: u32 = 7;
let r: &u32        = &count;        // a reference
let p: *const u32  = &count;        // a raw pointer to the same place
```

Both are one machine word holding the same address. The difference is entirely
in what the compiler is allowed to believe.

| | `&T` / `&mut T` | `*const T` / `*mut T` |
|---|---|---|
| may be null | no | yes |
| may dangle | no | yes |
| aliasing tracked | yes: shared XOR unique | not at all |
| lifetime | checked | none; it carries no lifetime |
| dereference | `*r` anywhere | only inside `unsafe` |
| `Copy` | `&T` yes, `&mut T` no | always yes |

:::memory the same address, two different promises
       STACK                                  what the compiler knows
     ┌──────────────────────┐
count│ 7                    │◀──┐
     ├──────────────────────┤   │  r : &u32       alive, aligned, non-null,
 r   │ ●────────────────────┼───┤                 no &mut exists, all checked
     ├──────────────────────┤   │
 p   │ ●────────────────────┼───┘  p : *const u32  a number. Nothing else.
     └──────────────────────┘
:::

### Creating one is safe; using one is not

```rust
let p = 0x1234 as *const u32;   // safe
println!("{p:?}");              // safe: printing an address proves nothing
let v = unsafe { *p };          // this is the line that can be wrong
```

Building a raw pointer, casting one, comparing two, printing one: all safe,
because none of them can cause harm. Only the dereference can, so only the
dereference is gated. That is not a technicality. It tells you exactly where to
look when you audit someone's code.

:::gotcha
The `mut`ness has to be right at the moment you create the pointer, not later.

```rust,bad
let mut count: u32 = 7;
let p: *mut u32 = &count;   // error[E0308]: expected *mut u32, found *const u32
```

`&count` is a shared borrow, so it coerces to `*const u32` and no further.
Casting the const pointer to `*mut` afterwards compiles and is **undefined
behaviour to write through**, because the compiler recorded that this pointer
came from a shared borrow. Write `&mut count`.
:::

## Undefined behaviour

### It does not mean "it crashes"

A crash would be a gift. **Undefined behaviour** means the language makes no
promise at all about the program. Then comes the part that hurts: the optimiser
is *entitled to assume UB cannot happen* and to rewrite your code on that
assumption.

```rust,bad
let flag: bool = unsafe { std::mem::transmute(2u8) };
if flag { a() } else { b() }
```

There is no `bool` that holds `2`. The compiler lowers `if flag` to a test it
believes is exhaustive; with `2` in the byte, the program may call `a`, call `b`,
call both, or jump into whatever code follows the jump table.

### Why the crash lands somewhere else

```rust,bad
let r: &i32 = unsafe { &*p };   // p happens to be null
if p.is_null() { return 0; }    // deleted
*r
```

Creating `&*p` asserts that `p` is non-null, because that is part of what a
reference *is*. Having been told, the optimiser propagates the fact forwards and
backwards, then deletes the null check as dead code. The segfault now appears on
a line with no `unsafe` on it, in a function that looks obviously correct.

:::gotcha
This is why "it works, I tested it" is not evidence about unsafe code. UB is not
a behaviour, it is the absence of a specification. The same source can be correct
in a debug build, wrong in release, and wrong in some new way next compiler
version. Nothing was ever promised.
:::

## The safe abstraction

This is the actual point of the feature, and the reason it exists at all.

### Everything you already use is built on it

`Vec` indexes and grows a raw allocation. `String` promises UTF-8 over a
`Vec<u8>`. `RefCell` mutates through a shared reference. `Rc` writes a count
through an aliased pointer. `slice::split_at_mut` hands out two `&mut` into one
allocation. Every one of them contains `unsafe`, and none of them can be misused
from safe code.

```rust
pub fn get(v: &[i32], i: usize) -> Option<i32> {
    if i < v.len() {
        // SAFETY: i < len was just checked, so the offset is in bounds.
        Some(unsafe { *v.get_unchecked(i) })
    } else {
        None
    }
}
```

The `unsafe` is one expression wide. The precondition of `get_unchecked` is
discharged by the `if` immediately above it. A caller cannot break this with any
argument.

### The bargain

:::note
**A safe abstraction is a promise that no combination of safe calls to this API
can cause undefined behaviour, no matter how wrong the caller is.**

If any ordinary value passed by an ordinary caller can trigger UB, the API is
**unsound**, and the bug belongs to whoever wrote the `unsafe`, not to the
caller who found it.
:::

```rust,bad
// compiles, no unsafe at the call site, and completely unsound
pub fn get(v: &[i32], i: usize) -> i32 {
    unsafe { *v.get_unchecked(i) }
}
```

Nothing here fails to compile. `get(&v, 900)` reads whatever is 3,600 bytes past
the allocation. The signature says safe and lies, which is worse than an
`unsafe fn` would have been, because now the compiler will not warn anyone.

### SAFETY comments

The convention across the ecosystem, and in the standard library's own source:

```rust
/// # Safety
/// `ptr` must be non-null, aligned, and point at `len` initialised `u8`s
/// that stay valid and unaliased for `'a`.
pub unsafe fn view<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    // SAFETY: the caller guarantees the contract above.
    unsafe { std::slice::from_raw_parts(ptr, len) }
}
```

`/// # Safety` on the item states the preconditions a caller must meet.
`// SAFETY:` above a block states why they hold *here*. Clippy will enforce the
habit with `undocumented_unsafe_blocks`. A block without one is a review finding.

## unsafe fn versus unsafe block

Two different claims, and people confuse them constantly.

| | says |
|---|---|
| `unsafe fn f()` | **calling me has preconditions.** The caller must check them |
| `unsafe { ... }` | **I have checked the preconditions** for what is inside |

```rust
pub fn parse_len(bytes: &[u8]) -> Option<u32> {      // safe signature
    if bytes.len() < 4 { return None; }
    // SAFETY: length checked, and u32 has no invalid bit patterns.
    Some(unsafe { std::ptr::read_unaligned(bytes.as_ptr() as *const u32) })
}
```

A safe function with a small `unsafe` block inside is what you almost always
want. It keeps the obligation local and lets callers get on with their lives.
Marking the whole function `unsafe` pushes the obligation outward to everybody
who calls it, forever, and should only happen when the precondition genuinely
cannot be checked here.

:::gotcha
Since edition 2024 the body of an `unsafe fn` is **not** an implicit unsafe
block. This is right, because the two claims are unrelated: that your callers
owe you a precondition says nothing about which of your own lines are sound.
Old code will hit `error[E0133]` on upgrade; the fix is to add the inner block
and a `// SAFETY:` line explaining it.
:::

## Talking to C

```rust
#[repr(C)]
pub struct Header {
    pub magic: u32,
    pub len: u16,
    pub kind: u8,
}       // repr(C): fields in source order, C padding rules, 8 bytes

unsafe extern "C" {
    fn strlen(s: *const std::ffi::c_char) -> usize;
}
```

Default Rust layout, `repr(Rust)`, guarantees nothing. The compiler reorders
fields to shrink padding, packs `Option<&T>` into one word, and is free to change
all of it between releases. `#[repr(C)]` pins the layout to C's rules so the two
languages agree on where `len` starts.

Every `extern "C"` call is `unsafe` for one reason: the compiler cannot see the
other side. It cannot know that `strlen` reads until a NUL, that it does not free
your pointer, that it does not keep it. The declaration is a claim you are making
about someone else's code.

:::compare
**C++.** Its `extern "C"` is about name mangling and nothing else; safety was
never on the table because it was never claimed. In Rust the block is the exact
boundary where the guarantee stops, which is why edition 2024 makes you write
`unsafe extern` and say so.
:::

## transmute, and why almost nothing needs it

`std::mem::transmute` reinterprets the bits of one type as another. It checks
that the two types are the same size and nothing else, which makes it the
sharpest tool in the language and almost always the wrong one.

```rust,bad
let flag: bool = unsafe { std::mem::transmute(2u8) };
```

Both types are one byte, so this compiles. It is still undefined behaviour,
because `bool` has exactly two valid bit patterns and `2` is not one of them.
Nothing crashes. The optimiser is now entitled to assume `flag` is `true` in one
branch and `false` in another, and both of those assumptions can be compiled into
the same function.

The rule worth carrying: **`transmute` is unchecked, so its safety condition is
that the source bits are a valid value of the target type, and only you can know
that.** Size matching is what the compiler verifies; validity is what it cannot.

Nearly every use has a safe replacement that says the same thing more narrowly:

| instead of transmute | use |
|---|---|
| bytes to a number | `u32::from_ne_bytes` and friends |
| a number to bytes | `to_ne_bytes` |
| a float's bit pattern | `f32::to_bits` and `from_bits` |
| a raw pointer to a reference | `&*ptr`, still unsafe but with one obligation rather than two |
| changing a pointer's type | `as` casts, which do not lie about validity |
| an enum from an integer | a `match`, or `TryFrom` |

The remaining honest uses are things like extending a lifetime inside a
self-referential structure, and those are the cases where you should be reading
the Nomicon rather than a unit summary.

## static mut, unions, and the ones to avoid

`static mut` is a global with no synchronisation. Two threads touching it is a
data race, which is instant UB, and since edition 2024 taking a reference to one
is a hard error. There is almost never a reason to use it:

```rust
use std::sync::atomic::{AtomicU64, Ordering};
pub static HITS: AtomicU64 = AtomicU64::new(0);   // no unsafe anywhere
```

Atomics, `Mutex`, `OnceLock` and `thread_local!` cover every real case, safely.

A `union` overlaps its fields in one piece of storage, so reading a field asserts
that it is the field last written. Nothing tracks that for you, which is why the
read is `unsafe`. In Rust code an `enum` does the same job with a discriminant
the compiler checks; unions exist for C layouts and for `MaybeUninit`.

## Checking your work

**Miri** interprets your program at the MIR level and detects UB that testing
never will: out-of-bounds pointer arithmetic, use-after-free, misaligned reads,
aliasing violations, uninitialised reads, data races.

```sh
cargo +nightly miri test
```

It is roughly a hundred times slower and it only reports what your tests
actually execute, so it is not a proof. It is still the single most effective
thing you can do to unsafe code, and it routinely finds bugs in code that has
been in production for years.

:::note
**The habit.** Before writing `unsafe`, answer three questions in order:

1. What invariant am I claiming, in one sentence?
2. Who could break it, and can any safe caller?
3. Can this be a safe API instead?

If the third answer is yes, do that. Most Rust never needs the keyword; the code
that does should be small, wrapped in a checked interface, commented with
`// SAFETY:`, and run under Miri.
:::
