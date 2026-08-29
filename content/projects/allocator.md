---
project: allocator
tier: deep
domain: systems
title: A memory allocator
accent: rust
blurb: Two allocators over one fixed byte array, from a pointer that only moves forward to a thread safe free list implementing GlobalAlloc, with the soundness argument written out for every unsafe block.
needs: 18-smart-ptr, 23-unsafe, 21-concurrency
mins: 110
---

Every `Box::new` you have written ended in a call to `malloc`. Every `Vec` that
grew, every `String` that gained a byte, every `Rc::new` that put a count
somewhere: all of it went through one function that takes a size and an
alignment and comes back with an address, or with null. This project is that
function.

You will write two allocators over one fixed byte array. The first is a **bump
allocator**: a pointer that moves forward and cannot free anything. It is about
forty lines and it is the fastest allocator there is, which is why game engines
and request handlers keep one per frame or per request and throw the whole thing
away at the end. The second is a real heap. A **free list** threaded through the
free blocks themselves, splitting blocks that are too big, merging blocks that
end up adjacent, with **size classes** on top so the common request is answered
by a pop rather than a search. It implements `GlobalAlloc`, which is the trait
`#[global_allocator]` accepts.

The other half of this project is **soundness**. An allocator hands out memory
that has never been written, keeps its bookkeeping inside memory it is about to
give away, and does all of it through `&self` from several threads at once.
Each of those is a place where a program that works and a program that is
correct come apart. `MaybeUninit` is here because a `&mut [u8]` over
uninitialised bytes is undefined behaviour the moment it exists, not when
something reads it. **Provenance** is here because a pointer is not only an
address. The `// SAFETY:` comment above each `unsafe` block is the argument that
the block is right, and a block whose comment you cannot write is a block that
is wrong.

The honest limits: 64 KiB fixed at compile time, one global **spin lock**, and
16 bytes of granularity, so a one byte request costs sixteen. Stage twelve
measures what all of that costs against the system allocator, and says where
this design wins and where it does not.

## 1. What the caller is actually asking for

@kind fix
@concept layout

@expect E0599

An allocator is asked two questions at once: how many bytes, and which addresses
will do. `describe` answers both, or refuses. It does not compile, because
`Layout::from_size_align` will not hand over a `Layout` directly. Not every pair
of numbers is one.

```starter
use std::alloc::Layout;
/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align);
    Some((layout.size(), layout.align()))
}
pub fn run() -> Vec<(&'static str, usize, usize)> {
    let rows = [
        ("u8", Layout::new::<u8>()),
        ("u64", Layout::new::<u64>()),
        ("[u64; 3]", Layout::new::<[u64; 3]>()),
        ("(u8, u64)", Layout::new::<(u8, u64)>()),
        ("String", Layout::new::<String>()),
    ];
    let mut out = Vec::new();
    for (name, l) in rows {
        println!("{name:<10} size {:>3}  align {:>2}", l.size(), l.align());
        out.push((name, l.size(), l.align()));
    }
    println!("12 bytes at align 4:  {:?}", describe(12, 4));
    println!("12 bytes at align 3:  {:?}", describe(12, 3));
    println!("usize::MAX at align 8: {:?}", describe(usize::MAX, 8));
    out
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_type_is_a_size_and_an_alignment() {
        let rows = run();
        assert_eq!(rows[0], ("u8", 1, 1));
        assert_eq!(rows[1], ("u64", 8, 8));
        assert_eq!(rows[2], ("[u64; 3]", 24, 8));
        assert_eq!(rows[3], ("(u8, u64)", 16, 8));
        assert_eq!(rows[4].1 % rows[4].2, 0);
    }

    #[test]
    fn some_requests_are_not_layouts_at_all() {
        assert_eq!(describe(12, 4), Some((12, 4)));
        assert_eq!(describe(0, 1), Some((0, 1)));
        assert_eq!(describe(12, 3), None);
        assert_eq!(describe(usize::MAX, 8), None);
    }

    #[test]
    fn size_is_never_less_than_alignment_demands() {
        for (_, size, align) in run() {
            assert!(align.is_power_of_two());
            assert_eq!(size % align, 0);
        }
    }
}
```

```solution
use std::alloc::Layout;
/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align).ok()?;
    Some((layout.size(), layout.align()))
}
pub fn run() -> Vec<(&'static str, usize, usize)> {
    let rows = [
        ("u8", Layout::new::<u8>()),
        ("u64", Layout::new::<u64>()),
        ("[u64; 3]", Layout::new::<[u64; 3]>()),
        ("(u8, u64)", Layout::new::<(u8, u64)>()),
        ("String", Layout::new::<String>()),
    ];
    let mut out = Vec::new();
    for (name, l) in rows {
        println!("{name:<10} size {:>3}  align {:>2}", l.size(), l.align());
        out.push((name, l.size(), l.align()));
    }
    println!("12 bytes at align 4:  {:?}", describe(12, 4));
    println!("12 bytes at align 3:  {:?}", describe(12, 3));
    println!("usize::MAX at align 8: {:?}", describe(usize::MAX, 8));
    out
}
```

@hint Look at what `from_size_align` returns. The method you called is not on that type.
@hint Two kinds of request are refused: an alignment that is not a power of two, and a size that overflows when rounded up to that alignment. That is why the return type carries a failure case.
@hint `.ok()?` turns the `Result` into the `Option` this function already returns.

@diagnose E0599
`no method named size found for enum Result<Layout, LayoutError>`.

`from_size_align` returns a `Result`, and you called `size()` on the `Result`
rather than on the `Layout` inside it. The compiler is not being pedantic about
one dot. It is pointing out that this call can fail, and you have not said what
happens when it does.

It fails for two reasons. An alignment must be a power of two, because every
alignment check in every allocator is a bit mask. And `size` rounded up to
`align` must not exceed `isize::MAX`, because Rust requires every allocated
object to be small enough that the byte offset between any two of its addresses
fits in an `isize`. `describe(usize::MAX, 8)` trips the second one.

@diagnose E0277
`the ? operator can only be used on Options, not Results`, or the same sentence
the other way round.

You reached for `?` on the `Result` inside a function that returns
`Option<(usize, usize)>`, and `?` needs the two error types to agree. There is no
sensible conversion from `LayoutError` to "nothing", so the compiler will not
invent one.

`.ok()` is the conversion, written by hand: it throws the error value away and
gives you `Option<Layout>`, which `?` then accepts. Reaching for `.ok()` is
worth a second's thought each time, because it is the moment you decide the
reason for the failure does not matter. Here it genuinely does not.

@after
Alignment is a requirement, not a preference. A `u64` at an odd address is
undefined behaviour in Rust whatever the hardware does about it, and the hardware
varies: x86 reads it slowly, older ARM faults, and some atomic instructions fault
everywhere. Because the compiler is allowed to assume every reference is aligned,
it will happily emit an instruction that only works if the assumption holds.

A `Layout` is exactly that pair of numbers with those two invariants attached, so
that an allocator receiving one can stop checking. Notice that size is always a
multiple of alignment: `(u8, u64)` is 16 bytes, not 9, so that an array of them
keeps every element aligned.

## 2. A pointer that only moves forward

@kind fix
@concept bump

@expect E0594

The whole allocator is one integer. Round the offset up to the alignment the
caller asked for, check there is room, move the integer, return the address.
`alloc` takes `&self`, because an allocator is shared, and that is precisely why
the assignment does not compile.

```starter
use std::alloc::Layout;
use std::cell::{Cell, UnsafeCell};
use std::ptr::null_mut;
/// Bytes in the arena. Fixed at compile time: an allocator has nobody to ask.
pub const ARENA: usize = 1 << 16;

/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;

/// Round `n` up to the next multiple of `align`, which must be a power of two.
pub const fn align_up(n: usize, align: usize) -> usize {
    (n + align - 1) & !(align - 1)
}
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align).ok()?;
    Some((layout.size(), layout.align()))
}
#[repr(align(16))]
struct Store {
    bytes: [u8; ARENA],
}

impl Store {
    const fn new() -> Self {
        Store { bytes: [0; ARENA] }
    }
}
/// One pointer, moving forward. Nothing else.
pub struct Bump {
    buf: UnsafeCell<Store>,
    next: usize,
}
impl Bump {
    pub fn new() -> Self {
        Bump { buf: UnsafeCell::new(Store::new()), next: 0 }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a reference,
        // so it cannot invalidate a pointer already handed out.
        unsafe { &raw mut (*self.buf.get()).bytes as *mut u8 }
    }

    pub fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN {
            return null_mut();
        }
        let start = align_up(self.next, layout.align());
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        if end > ARENA {
            return null_mut();
        }
        self.next = end;
        // SAFETY: end <= ARENA, so `start` is an offset inside the single
        // object `base` points at and the whole block is in bounds. The base is
        // 16-aligned and `start` is a multiple of layout.align(), so the result
        // has the alignment the caller asked for.
        unsafe { self.base().add(start) }
    }

    pub fn used(&self) -> usize {
        self.next
    }

    pub fn remaining(&self) -> usize {
        ARENA - self.next
    }
}
pub fn run() -> (usize, usize, u64) {
    let bump = Bump::new();

    let a = bump.alloc(Layout::new::<u8>());
    let after_first = bump.used();
    let b = bump.alloc(Layout::new::<u64>());

    // SAFETY: `a` owns one byte and `b` owns eight aligned bytes, both inside
    // the arena, both handed out exactly once, so nothing else points at them.
    let back = unsafe {
        a.write(0x41);
        let n = b as *mut u64;
        n.write(0xDEAD_BEEF);
        n.read()
    };

    println!("u8 at +0, used {after_first}");
    println!("u64 needs align 8, so it starts at +8 and used is now {}", bump.used());
    println!("read back {back:#x}, {} bytes left", bump.remaining());
    (after_first, bump.used(), back)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn padding_is_the_price_of_alignment() {
        let (after_first, used, back) = run();
        assert_eq!(after_first, 1);
        assert_eq!(used, 16);
        assert_eq!(back, 0xDEAD_BEEF);
    }

    #[test]
    fn every_block_has_the_alignment_it_asked_for() {
        let bump = Bump::new();
        for &(size, align) in &[(1usize, 1usize), (8, 8), (3, 4), (16, 16), (1, 1), (32, 8)] {
            let p = bump.alloc(Layout::from_size_align(size, align).unwrap());
            assert!(!p.is_null());
            assert_eq!(p.addr() % align, 0, "a block of align {align} was not aligned");
        }
    }

    #[test]
    fn the_arena_runs_out_and_says_so() {
        let bump = Bump::new();
        assert!(!bump.alloc(Layout::from_size_align(ARENA, 1).unwrap()).is_null());
        assert_eq!(bump.remaining(), 0);
        assert!(bump.alloc(Layout::new::<u8>()).is_null());
    }

    #[test]
    fn an_alignment_we_cannot_serve_is_refused() {
        let bump = Bump::new();
        assert!(bump.alloc(Layout::from_size_align(8, 32).unwrap()).is_null());
        assert_eq!(bump.used(), 0);
    }

    #[test]
    fn align_up_rounds_up_and_leaves_multiples_alone() {
        assert_eq!(align_up(0, 8), 0);
        assert_eq!(align_up(1, 8), 8);
        assert_eq!(align_up(8, 8), 8);
        assert_eq!(align_up(9, 16), 16);
        assert_eq!(align_up(17, 1), 17);
    }
}
```

```solution
use std::alloc::Layout;
use std::cell::{Cell, UnsafeCell};
use std::ptr::null_mut;
/// Bytes in the arena. Fixed at compile time: an allocator has nobody to ask.
pub const ARENA: usize = 1 << 16;

/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;

/// Round `n` up to the next multiple of `align`, which must be a power of two.
pub const fn align_up(n: usize, align: usize) -> usize {
    (n + align - 1) & !(align - 1)
}
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align).ok()?;
    Some((layout.size(), layout.align()))
}
#[repr(align(16))]
struct Store {
    bytes: [u8; ARENA],
}

impl Store {
    const fn new() -> Self {
        Store { bytes: [0; ARENA] }
    }
}
/// One pointer, moving forward. Nothing else.
pub struct Bump {
    buf: UnsafeCell<Store>,
    next: Cell<usize>,
}
impl Bump {
    pub fn new() -> Self {
        Bump { buf: UnsafeCell::new(Store::new()), next: Cell::new(0) }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a reference,
        // so it cannot invalidate a pointer already handed out.
        unsafe { &raw mut (*self.buf.get()).bytes as *mut u8 }
    }

    pub fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN {
            return null_mut();
        }
        let start = align_up(self.next.get(), layout.align());
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        if end > ARENA {
            return null_mut();
        }
        self.next.set(end);
        // SAFETY: end <= ARENA, so `start` is an offset inside the single
        // object `base` points at and the whole block is in bounds. The base is
        // 16-aligned and `start` is a multiple of layout.align(), so the result
        // has the alignment the caller asked for.
        unsafe { self.base().add(start) }
    }

    pub fn used(&self) -> usize {
        self.next.get()
    }

    pub fn remaining(&self) -> usize {
        ARENA - self.next.get()
    }
}
pub fn run() -> (usize, usize, u64) {
    let bump = Bump::new();

    let a = bump.alloc(Layout::new::<u8>());
    let after_first = bump.used();
    let b = bump.alloc(Layout::new::<u64>());

    // SAFETY: `a` owns one byte and `b` owns eight aligned bytes, both inside
    // the arena, both handed out exactly once, so nothing else points at them.
    let back = unsafe {
        a.write(0x41);
        let n = b as *mut u64;
        n.write(0xDEAD_BEEF);
        n.read()
    };

    println!("u8 at +0, used {after_first}");
    println!("u64 needs align 8, so it starts at +8 and used is now {}", bump.used());
    println!("read back {back:#x}, {} bytes left", bump.remaining());
    (after_first, bump.used(), back)
}
```

@hint `alloc` has a shared reference and needs to change a field. Ordinary field assignment is never going to work through `&self`.
@hint Interior mutability. `Cell<usize>` gives you `get` and `set` through a shared reference, compiles to the same load and store, and takes no lock.
@hint `next: Cell<usize>`, built with `Cell::new(0)`, read with `self.next.get()`, written with `self.next.set(end)`.

@diagnose E0594
`cannot assign to self.next, which is behind a & reference`, with a note that
`self` is a `&Bump`.

This is the borrow checker doing its ordinary job, and it is right: two callers
could hold `&Bump` at once, and if plain assignment worked through a shared
reference, both could write the field. Making `alloc` take `&mut self` would fix
the error and ruin the type, because then only one caller could ever hold the
allocator, and a global allocator is shared by definition.

The answer is `Cell`, which moves the rule from compile time to a promise that
nobody can hold a reference *into* the value, only get and set it whole. That is
enough to make shared mutation safe with no runtime cost at all.

@diagnose E0308
`mismatched types: expected Cell<usize>, found usize`, or the reverse.

You changed the field to a `Cell` and left one of its four uses reading or
writing a bare `usize`. `Cell` is a wrapper, not a transparent one: `self.next`
now *is* the cell, and the integer only appears when you call `get`. Search for
every mention of the field. There are four: the struct, the constructor, the two
reads in `alloc` and `used`, and the read in `remaining`.

`Cell::get` requires `Copy`, which is why it works for `usize` and not for
`String`. For anything not `Copy`, `take` and `replace` do the same job.

@after
Two details in code you were handed. `align_up` is `(n + align - 1) & !(align - 1)`,
which works only because an alignment is a power of two: `align - 1` is then a
mask of the low bits, and `!` of it clears them. Add `align - 1` first and the
clearing rounds up rather than down. One add and one and, for something a
division would also do a hundred times slower.

And `#[repr(align(16))]` on the byte array. A `[u8; N]` is one byte aligned, so
without that attribute every offset in this function would be correct and every
address it returned would be wrong.

## 3. What a bump allocator is good for

@kind fix
@concept arena

@expect E0596

Nothing here records where a block began or how long it was, so freeing one block
is impossible. Freeing all of them is one store. `reset` is empty and the caller
that uses it is missing something. Three frames run in one arena, each larger
than the last.

```starter
use std::alloc::Layout;
use std::cell::{Cell, UnsafeCell};
use std::ptr::null_mut;
/// Bytes in the arena. Fixed at compile time: an allocator has nobody to ask.
pub const ARENA: usize = 1 << 16;

/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;

/// Round `n` up to the next multiple of `align`, which must be a power of two.
pub const fn align_up(n: usize, align: usize) -> usize {
    (n + align - 1) & !(align - 1)
}
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align).ok()?;
    Some((layout.size(), layout.align()))
}
#[repr(align(16))]
struct Store {
    bytes: [u8; ARENA],
}

impl Store {
    const fn new() -> Self {
        Store { bytes: [0; ARENA] }
    }
}
/// One pointer, moving forward. Nothing else.
pub struct Bump {
    buf: UnsafeCell<Store>,
    next: Cell<usize>,
}
impl Bump {
    pub fn new() -> Self {
        Bump { buf: UnsafeCell::new(Store::new()), next: Cell::new(0) }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a reference,
        // so it cannot invalidate a pointer already handed out.
        unsafe { &raw mut (*self.buf.get()).bytes as *mut u8 }
    }

    pub fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN {
            return null_mut();
        }
        let start = align_up(self.next.get(), layout.align());
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        if end > ARENA {
            return null_mut();
        }
        self.next.set(end);
        // SAFETY: end <= ARENA, so `start` is an offset inside the single
        // object `base` points at and the whole block is in bounds. The base is
        // 16-aligned and `start` is a multiple of layout.align(), so the result
        // has the alignment the caller asked for.
        unsafe { self.base().add(start) }
    }

    pub fn used(&self) -> usize {
        self.next.get()
    }

    pub fn remaining(&self) -> usize {
        ARENA - self.next.get()
    }

    /// Hand the whole arena back at once.
    ///
    /// Taking `&mut self` is what makes this safe: any slice handed out by
    /// `alloc_slice` borrows `&self`, so none can be alive here.
    pub fn reset(&mut self) {
        // TODO: hand the whole arena back.
    }
}
pub fn run() -> (usize, usize, bool) {
    let bump = Bump::new();
    let mut high = 0;
    let mut firsts = Vec::new();

    for frame in 0..3 {
        let mut first = null_mut();
        for i in 0..(4 + frame) {
            let l = Layout::from_size_align(24 * (i + 1), 8).unwrap();
            let p = bump.alloc(l);
            if i == 0 {
                first = p;
            }
        }
        high = high.max(bump.used());
        println!("frame {frame}: {} bytes, first block at {first:p}", bump.used());
        firsts.push(first);
        bump.reset();
    }

    let same = firsts.iter().all(|&p| p == firsts[0]);
    println!("high water mark {high}, now {} used, same first block: {same}", bump.used());
    (high, bump.used(), same)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn three_frames_reuse_one_arena() {
        let (high, after, same) = run();
        assert_eq!(high, 504);
        assert_eq!(after, 0);
        assert!(same, "each frame should start at the same address");
    }

    #[test]
    fn reset_costs_one_store() {
        let mut bump = Bump::new();
        for _ in 0..1000 {
            assert!(!bump.alloc(Layout::from_size_align(32, 8).unwrap()).is_null());
        }
        assert_eq!(bump.used(), 32_000);
        bump.reset();
        assert_eq!(bump.used(), 0);
        assert_eq!(bump.remaining(), ARENA);
    }

    #[test]
    fn the_next_frame_lands_on_the_old_one() {
        let mut bump = Bump::new();
        let l = Layout::from_size_align(64, 8).unwrap();
        let first = bump.alloc(l);
        bump.reset();
        let again = bump.alloc(l);
        assert_eq!(first, again);
    }
}
```

```solution
use std::alloc::Layout;
use std::cell::{Cell, UnsafeCell};
use std::ptr::null_mut;
/// Bytes in the arena. Fixed at compile time: an allocator has nobody to ask.
pub const ARENA: usize = 1 << 16;

/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;

/// Round `n` up to the next multiple of `align`, which must be a power of two.
pub const fn align_up(n: usize, align: usize) -> usize {
    (n + align - 1) & !(align - 1)
}
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align).ok()?;
    Some((layout.size(), layout.align()))
}
#[repr(align(16))]
struct Store {
    bytes: [u8; ARENA],
}

impl Store {
    const fn new() -> Self {
        Store { bytes: [0; ARENA] }
    }
}
/// One pointer, moving forward. Nothing else.
pub struct Bump {
    buf: UnsafeCell<Store>,
    next: Cell<usize>,
}
impl Bump {
    pub fn new() -> Self {
        Bump { buf: UnsafeCell::new(Store::new()), next: Cell::new(0) }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a reference,
        // so it cannot invalidate a pointer already handed out.
        unsafe { &raw mut (*self.buf.get()).bytes as *mut u8 }
    }

    pub fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN {
            return null_mut();
        }
        let start = align_up(self.next.get(), layout.align());
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        if end > ARENA {
            return null_mut();
        }
        self.next.set(end);
        // SAFETY: end <= ARENA, so `start` is an offset inside the single
        // object `base` points at and the whole block is in bounds. The base is
        // 16-aligned and `start` is a multiple of layout.align(), so the result
        // has the alignment the caller asked for.
        unsafe { self.base().add(start) }
    }

    pub fn used(&self) -> usize {
        self.next.get()
    }

    pub fn remaining(&self) -> usize {
        ARENA - self.next.get()
    }

    /// Hand the whole arena back at once.
    ///
    /// Taking `&mut self` is what makes this safe: any slice handed out by
    /// `alloc_slice` borrows `&self`, so none can be alive here.
    pub fn reset(&mut self) {
        self.next.set(0);
    }
}
pub fn run() -> (usize, usize, bool) {
    let mut bump = Bump::new();
    let mut high = 0;
    let mut firsts = Vec::new();

    for frame in 0..3 {
        let mut first = null_mut();
        for i in 0..(4 + frame) {
            let l = Layout::from_size_align(24 * (i + 1), 8).unwrap();
            let p = bump.alloc(l);
            if i == 0 {
                first = p;
            }
        }
        high = high.max(bump.used());
        println!("frame {frame}: {} bytes, first block at {first:p}", bump.used());
        firsts.push(first);
        bump.reset();
    }

    let same = firsts.iter().all(|&p| p == firsts[0]);
    println!("high water mark {high}, now {} used, same first block: {same}", bump.used());
    (high, bump.used(), same)
}
```

@hint `reset` has a body to write, and it is shorter than its signature.
@hint The signature already says `&mut self`. Look at how `bump` is declared in `run`.
@hint `let mut bump = Bump::new();`, and `self.next.set(0)` in the body.

@diagnose E0596
`cannot borrow bump as mutable, as it is not declared as mutable`.

`reset` asks for `&mut self` and the binding is not `mut`, so the call cannot
happen. Adding `mut` is the fix, but the interesting question is why `reset`
asks for exclusive access at all when everything else here takes `&self`.

It is the only guarantee available. In stage four `alloc_slice` will hand out a
`&mut [u8]` borrowed from `&self`, and a reset while one of those is alive would
hand the same bytes to somebody else. Requiring `&mut self` makes that
combination fail to compile rather than fail at three in the morning. The
borrow checker is being used as the interlock.

@diagnose E0594
`cannot assign to self.next, which is behind a & reference`.

You decided `reset` should take `&self` and wrote `self.next = 0`. Two separate
things went wrong. The assignment needs `self.next.set(0)`, because the field is
a `Cell` now.

The signature is the real question. `reset(&self)` compiles once you use `set`,
and it is a worse API: it can then be called while a slice handed out by
`alloc_slice` is still alive, which is undefined behaviour that the compiler
would no longer be able to see. `&mut self` costs nothing here, because a reset
is something the owner of the arena does between frames anyway.

@after
This is not a lesser allocator, it is a different bargain. Deallocation is where
a general allocator spends its time: coalescing, list surgery, cache misses on
headers scattered through memory. A bump allocator has none of that, so a frame
holding fifty thousand objects is freed by one store to one integer.

Where they are actually used: per frame in a game engine, per request in a
server, per parse in a compiler (rustc's arenas hold the AST and the type
interner), and per scratch buffer in an audio callback that must not touch the
global heap. `bumpalo` is the crate. The rule is that every object in an arena
dies at the same moment, and if that is true of your objects, this is the right
allocator.

## 4. Uninitialised is a type, not a mood

@kind fix
@concept maybeuninit

@expect E0133

The arena has stopped pretending. Its bytes are `MaybeUninit<u8>` now, because
memory from an operating system arrives holding whatever was there before.
`alloc_slice` should hand back a `&mut [u8]` that is genuinely readable. Adding
the `unsafe` block the compiler asks for makes it compile and leaves it wrong.

```starter
use std::alloc::Layout;
use std::cell::{Cell, UnsafeCell};
use std::mem::MaybeUninit;
use std::ptr::null_mut;
/// Bytes in the arena. Fixed at compile time: an allocator has nobody to ask.
pub const ARENA: usize = 1 << 16;

/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;

/// Round `n` up to the next multiple of `align`, which must be a power of two.
pub const fn align_up(n: usize, align: usize) -> usize {
    (n + align - 1) & !(align - 1)
}
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align).ok()?;
    Some((layout.size(), layout.align()))
}
#[repr(align(16))]
struct Store {
    bytes: [MaybeUninit<u8>; ARENA],
}

impl Store {
    const fn new() -> Self {
        Store { bytes: [MaybeUninit::uninit(); ARENA] }
    }
}
/// One pointer, moving forward. Nothing else.
pub struct Bump {
    buf: UnsafeCell<Store>,
    next: Cell<usize>,
}
impl Bump {
    pub fn new() -> Self {
        Bump { buf: UnsafeCell::new(Store::new()), next: Cell::new(0) }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a reference,
        // so it cannot invalidate a pointer already handed out.
        unsafe { &raw mut (*self.buf.get()).bytes as *mut u8 }
    }

    pub fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN {
            return null_mut();
        }
        let start = align_up(self.next.get(), layout.align());
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        if end > ARENA {
            return null_mut();
        }
        self.next.set(end);
        // SAFETY: end <= ARENA, so `start` is an offset inside the single
        // object `base` points at and the whole block is in bounds. The base is
        // 16-aligned and `start` is a multiple of layout.align(), so the result
        // has the alignment the caller asked for.
        unsafe { self.base().add(start) }
    }

    pub fn used(&self) -> usize {
        self.next.get()
    }

    pub fn remaining(&self) -> usize {
        ARENA - self.next.get()
    }

    /// Hand the whole arena back at once.
    ///
    /// Taking `&mut self` is what makes this safe: any slice handed out by
    /// `alloc_slice` borrows `&self`, so none can be alive here.
    pub fn reset(&mut self) {
        self.next.set(0);
    }

    /// Allocate `n` bytes and write `fill` into every one of them, so the
    /// result is a real `&mut [u8]` rather than a claim about garbage.
    pub fn alloc_slice(&self, n: usize, fill: u8) -> Option<&mut [u8]> {
        let p = self.alloc(Layout::from_size_align(n, 1).ok()?);
        if p.is_null() {
            return None;
        }
        Some(std::slice::from_raw_parts_mut(p, n))
    }

    /// # Safety
    /// `off` must be less than `ARENA` and that byte must have been written.
    pub unsafe fn read_byte(&self, off: usize) -> u8 {
        // SAFETY: the caller guarantees the byte is in range and initialised.
        unsafe {
            (self.base() as *const MaybeUninit<u8>)
                .add(off)
                .read()
                .assume_init()
        }
    }
}
pub fn run() -> (Vec<u8>, u8) {
    let bump = Bump::new();

    let copy = {
        let s = bump.alloc_slice(8, 0xCD).unwrap();
        s[0] = 0x01;
        s.to_vec()
    };

    // SAFETY: byte 0 was written by alloc_slice and again by the line above.
    let first = unsafe { bump.read_byte(0) };

    println!("{copy:02x?}");
    println!("byte 0 read back through the arena: {first:#04x}");
    (copy, first)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_slice_you_are_given_is_a_slice_you_can_read() {
        let (copy, first) = run();
        assert_eq!(copy.len(), 8);
        assert_eq!(copy[0], 0x01);
        assert!(copy[1..].iter().all(|&b| b == 0xCD));
        assert_eq!(first, 0x01);
    }

    #[test]
    fn every_byte_is_written_before_anyone_sees_it() {
        let bump = Bump::new();
        let s = bump.alloc_slice(64, 0xCD).unwrap();
        assert_eq!(s.len(), 64);
        assert!(s.iter().all(|&b| b == 0xCD), "uninitialised bytes escaped");
    }

    #[test]
    fn two_slices_never_share_a_byte() {
        let bump = Bump::new();
        let a = bump.alloc_slice(16, 1).unwrap().as_ptr().addr();
        let b = bump.alloc_slice(16, 2).unwrap().as_ptr().addr();
        assert!(b >= a + 16 || a >= b + 16);
    }

    #[test]
    fn out_of_room_is_none_not_a_short_slice() {
        let bump = Bump::new();
        assert!(bump.alloc_slice(ARENA + 1, 0).is_none());
        assert_eq!(bump.alloc_slice(ARENA, 7).unwrap().len(), ARENA);
        assert!(bump.alloc_slice(1, 0).is_none());
    }
}
```

```solution
use std::alloc::Layout;
use std::cell::{Cell, UnsafeCell};
use std::mem::MaybeUninit;
use std::ptr::null_mut;
/// Bytes in the arena. Fixed at compile time: an allocator has nobody to ask.
pub const ARENA: usize = 1 << 16;

/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;

/// Round `n` up to the next multiple of `align`, which must be a power of two.
pub const fn align_up(n: usize, align: usize) -> usize {
    (n + align - 1) & !(align - 1)
}
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align).ok()?;
    Some((layout.size(), layout.align()))
}
#[repr(align(16))]
struct Store {
    bytes: [MaybeUninit<u8>; ARENA],
}

impl Store {
    const fn new() -> Self {
        Store { bytes: [MaybeUninit::uninit(); ARENA] }
    }
}
/// One pointer, moving forward. Nothing else.
pub struct Bump {
    buf: UnsafeCell<Store>,
    next: Cell<usize>,
}
impl Bump {
    pub fn new() -> Self {
        Bump { buf: UnsafeCell::new(Store::new()), next: Cell::new(0) }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a reference,
        // so it cannot invalidate a pointer already handed out.
        unsafe { &raw mut (*self.buf.get()).bytes as *mut u8 }
    }

    pub fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN {
            return null_mut();
        }
        let start = align_up(self.next.get(), layout.align());
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        if end > ARENA {
            return null_mut();
        }
        self.next.set(end);
        // SAFETY: end <= ARENA, so `start` is an offset inside the single
        // object `base` points at and the whole block is in bounds. The base is
        // 16-aligned and `start` is a multiple of layout.align(), so the result
        // has the alignment the caller asked for.
        unsafe { self.base().add(start) }
    }

    pub fn used(&self) -> usize {
        self.next.get()
    }

    pub fn remaining(&self) -> usize {
        ARENA - self.next.get()
    }

    /// Hand the whole arena back at once.
    ///
    /// Taking `&mut self` is what makes this safe: any slice handed out by
    /// `alloc_slice` borrows `&self`, so none can be alive here.
    pub fn reset(&mut self) {
        self.next.set(0);
    }

    /// Allocate `n` bytes and write `fill` into every one of them, so the
    /// result is a real `&mut [u8]` rather than a claim about garbage.
    pub fn alloc_slice(&self, n: usize, fill: u8) -> Option<&mut [u8]> {
        let p = self.alloc(Layout::from_size_align(n, 1).ok()?);
        if p.is_null() {
            return None;
        }
        // SAFETY: `p` starts `n` bytes that nothing else points at, because the
        // bump pointer only ever moves forward. `write_bytes` initialises all
        // of them, so afterwards the range really is a `[u8]`. The returned
        // lifetime is that of `&self`, so `reset`, which needs `&mut self`,
        // cannot run while this slice is alive.
        unsafe {
            std::ptr::write_bytes(p, fill, n);
            Some(std::slice::from_raw_parts_mut(p, n))
        }
    }

    /// # Safety
    /// `off` must be less than `ARENA` and that byte must have been written.
    pub unsafe fn read_byte(&self, off: usize) -> u8 {
        // SAFETY: the caller guarantees the byte is in range and initialised.
        unsafe {
            (self.base() as *const MaybeUninit<u8>)
                .add(off)
                .read()
                .assume_init()
        }
    }
}
pub fn run() -> (Vec<u8>, u8) {
    let bump = Bump::new();

    let copy = {
        let s = bump.alloc_slice(8, 0xCD).unwrap();
        s[0] = 0x01;
        s.to_vec()
    };

    // SAFETY: byte 0 was written by alloc_slice and again by the line above.
    let first = unsafe { bump.read_byte(0) };

    println!("{copy:02x?}");
    println!("byte 0 read back through the arena: {first:#04x}");
    (copy, first)
}
```

@hint `from_raw_parts_mut` is unsafe because the compiler cannot check its preconditions. Read the list of them and find the one this code does not meet.
@hint A `&mut [u8]` is a promise that every byte in range is a valid, initialised `u8`. What is in those bytes right now?
@hint `std::ptr::write_bytes(p, fill, n)` first, then build the slice, both inside one `unsafe` block with a `// SAFETY:` comment above it.

@diagnose E0133
`call to unsafe function std::slice::from_raw_parts_mut is unsafe and requires
unsafe block`.

The compiler is asking you to take responsibility, and the temptation is to wrap
the line and move on. Do not. The preconditions of `from_raw_parts_mut` are that
the pointer is non-null and aligned, that `len` bytes are inside one allocated
object, that nothing else touches them for the lifetime, and that every one of
those bytes is initialised. The first three hold here. The last one does not.

So the fix is two lines, not one. Write the bytes, then make the slice, then
write the `// SAFETY:` comment that says all four preconditions hold. If the
comment would be a lie, the block is a bug.

@diagnose E0308
`mismatched types: expected *mut u8, found *mut MaybeUninit<u8>`, or the other
way about.

`MaybeUninit<T>` has the same size and alignment as `T` and is `#[repr(transparent)]`
over it, so the cast between the two pointer types is a no-op at runtime and
still has to be written. That is the point of the type: it costs nothing and it
makes the compiler stop you at exactly the places where the difference matters.

`base()` already casts to `*mut u8` for you. If you are fighting this error you
have probably reached into the arena a second way; go back through `base` and
`alloc` instead.

@after
Uninitialised memory is not "random bytes you happen not to know". At the level
the optimiser works, an uninitialised byte has no value at all. Read it twice and
the two reads may disagree, because the compiler is entitled to answer each one
with whatever register was convenient. A `bool` read from such a byte can be
neither true nor false, and the branch on it can go both ways.

`MaybeUninit<u8>` is a union with one field, which is exactly the type that says
"there may be nothing here". `assume_init` is where you promise there is.

The test in this stage checks all sixty four bytes equal `0xCD`. Delete the
`write_bytes` and it will very likely still pass, because the stack under it
happens to hold something. That is the whole problem with testing unsafe code, and
it is what Miri exists for: it would reject the read of an uninitialised byte the
first time the test touched it, whatever value came back.

## 5. A list that lives in the holes

@kind fix
@concept free list

@expect E0609

Freed blocks have to be findable again, and an allocator cannot keep a `Vec` of
them, because a `Vec` would allocate. So the list lives inside the free blocks:
`deallocate` writes a `FreeNode` into the bytes it has just been handed. The
search loop does not compile.

```starter
use std::alloc::Layout;
use std::cell::{Cell, UnsafeCell};
use std::mem::MaybeUninit;
use std::ptr::null_mut;
/// Bytes in the arena. Fixed at compile time: an allocator has nobody to ask.
pub const ARENA: usize = 1 << 16;

/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;

/// Round `n` up to the next multiple of `align`, which must be a power of two.
pub const fn align_up(n: usize, align: usize) -> usize {
    (n + align - 1) & !(align - 1)
}
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align).ok()?;
    Some((layout.size(), layout.align()))
}
#[repr(align(16))]
struct Store {
    bytes: [MaybeUninit<u8>; ARENA],
}

impl Store {
    const fn new() -> Self {
        Store { bytes: [MaybeUninit::uninit(); ARENA] }
    }
}
/// One pointer, moving forward. Nothing else.
pub struct Bump {
    buf: UnsafeCell<Store>,
    next: Cell<usize>,
}
impl Bump {
    pub fn new() -> Self {
        Bump { buf: UnsafeCell::new(Store::new()), next: Cell::new(0) }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a reference,
        // so it cannot invalidate a pointer already handed out.
        unsafe { &raw mut (*self.buf.get()).bytes as *mut u8 }
    }

    pub fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN {
            return null_mut();
        }
        let start = align_up(self.next.get(), layout.align());
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        if end > ARENA {
            return null_mut();
        }
        self.next.set(end);
        // SAFETY: end <= ARENA, so `start` is an offset inside the single
        // object `base` points at and the whole block is in bounds. The base is
        // 16-aligned and `start` is a multiple of layout.align(), so the result
        // has the alignment the caller asked for.
        unsafe { self.base().add(start) }
    }

    pub fn used(&self) -> usize {
        self.next.get()
    }

    pub fn remaining(&self) -> usize {
        ARENA - self.next.get()
    }

    /// Hand the whole arena back at once.
    ///
    /// Taking `&mut self` is what makes this safe: any slice handed out by
    /// `alloc_slice` borrows `&self`, so none can be alive here.
    pub fn reset(&mut self) {
        self.next.set(0);
    }

    /// Allocate `n` bytes and write `fill` into every one of them, so the
    /// result is a real `&mut [u8]` rather than a claim about garbage.
    pub fn alloc_slice(&self, n: usize, fill: u8) -> Option<&mut [u8]> {
        let p = self.alloc(Layout::from_size_align(n, 1).ok()?);
        if p.is_null() {
            return None;
        }
        // SAFETY: `p` starts `n` bytes that nothing else points at, because the
        // bump pointer only ever moves forward. `write_bytes` initialises all
        // of them, so afterwards the range really is a `[u8]`. The returned
        // lifetime is that of `&self`, so `reset`, which needs `&mut self`,
        // cannot run while this slice is alive.
        unsafe {
            std::ptr::write_bytes(p, fill, n);
            Some(std::slice::from_raw_parts_mut(p, n))
        }
    }

    /// # Safety
    /// `off` must be less than `ARENA` and that byte must have been written.
    pub unsafe fn read_byte(&self, off: usize) -> u8 {
        // SAFETY: the caller guarantees the byte is in range and initialised.
        unsafe {
            (self.base() as *const MaybeUninit<u8>)
                .add(off)
                .read()
                .assume_init()
        }
    }
}
/// The header of a free block, written into the block's own bytes.
#[repr(C)]
pub struct FreeNode {
    pub size: usize,
    pub next: *mut FreeNode,
}

pub const NODE: usize = std::mem::size_of::<FreeNode>();

/// No block is smaller than a node, or the list could not live inside it.
pub const MIN_BLOCK: usize = align_up(NODE, MAX_ALIGN);

/// What a request actually costs: rounded up so every block is 16-aligned and
/// big enough to hold a `FreeNode` once it is given back.
pub fn block_size(layout: &Layout) -> usize {
    align_up(layout.size().max(MIN_BLOCK), MAX_ALIGN)
}
/// A free list threaded through the arena's own free bytes.
pub struct Heap {
    arena: UnsafeCell<Store>,
    bump: Cell<usize>,
    head: Cell<*mut FreeNode>,
}
impl Heap {
    pub fn new() -> Self {
        Heap {
            arena: UnsafeCell::new(Store::new()),
            bump: Cell::new(0),
            head: Cell::new(null_mut()),
        }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a
        // reference, so it invalidates no pointer already handed out.
        unsafe { &raw mut (*self.arena.get()).bytes as *mut u8 }
    }

    pub fn allocate(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN || layout.size() > ARENA {
            return null_mut();
        }
        let need = block_size(&layout);

        let mut p = self.pop_exact(need);
        if p.is_null() {
            p = self.carve(need);
        }
        p
    }

    /// # Safety
    /// `ptr` must be a block this heap returned from `allocate` with
    /// exactly this `layout`, and must not have been deallocated since.
    pub unsafe fn deallocate(&self, ptr: *mut u8, layout: Layout) {
        let size = block_size(&layout);
        let node = ptr as *mut FreeNode;
        // SAFETY: the caller has handed the block back, so nothing else
        // points into it. It is `size` >= MIN_BLOCK bytes and 16-aligned,
        // room and alignment enough for a FreeNode.
        unsafe { node.write(FreeNode { size, next: self.head.get() }) };
        self.head.set(node);
    }

    /// Take fresh bytes off the end of the arena. This is stage two, still.
    fn carve(&self, need: usize) -> *mut u8 {
        let start = self.bump.get();
        if need > ARENA - start {
            return null_mut();
        }
        self.bump.set(start + need);
        // SAFETY: start + need <= ARENA, so the block lies inside the arena and
        // `base` carries provenance over all of it.
        unsafe { self.base().add(start) }
    }

    /// First block of exactly the right size, unlinked from the list.
    fn pop_exact(&self, need: usize) -> *mut u8 {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block in the arena, 16-aligned and at least
            // MIN_BLOCK bytes, so it holds the node deallocate wrote there.
            let (size, next) = unsafe { (cur.size, cur.next) };
            if size == need {
                if prev.is_null() {
                    self.head.set(next);
                } else {
                    // SAFETY: prev is a free block on the list.
                    unsafe { (*prev).next = next };
                }
                return cur as *mut u8;
            }
            prev = cur;
            cur = next;
        }
        null_mut()
    }

    /// (blocks, total free bytes, largest free block)
    pub fn free_stats(&self) -> (usize, usize, usize) {
        let (mut n, mut total, mut largest) = (0, 0, 0);
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block on the list.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            n += 1;
            total += size;
            if size > largest {
                largest = size;
            }
            cur = next;
        }
        (n, total, largest)
    }

    /// Bytes ever carved off the end of the arena.
    pub fn used(&self) -> usize {
        self.bump.get()
    }
}
pub fn run() -> (usize, usize, bool) {
    let heap = Heap::new();
    let l = Layout::from_size_align(64, 8).unwrap();

    let a = heap.allocate(l);
    let b = heap.allocate(l);
    // SAFETY: `a` came from this heap with this layout and is freed once.
    unsafe { heap.deallocate(a, l) };
    let c = heap.allocate(l);
    let reused = c == a;

    println!("first {a:p}");
    println!("second {b:p}");
    println!("after free, the next request got {c:p} (same block: {reused})");

    // SAFETY: both blocks came from this heap with this layout, freed once.
    unsafe {
        heap.deallocate(b, l);
        heap.deallocate(c, l);
    }
    let (blocks, free_bytes, _) = heap.free_stats();
    println!("carved {} bytes; {blocks} free blocks holding {free_bytes}", heap.used());
    (heap.used(), free_bytes, reused)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_freed_block_comes_back() {
        let (used, free_bytes, reused) = run();
        assert!(reused, "the free list did not hand the block back");
        assert_eq!(used, 128);
        assert_eq!(free_bytes, 128);
    }

    #[test]
    fn the_list_costs_no_extra_memory() {
        let heap = Heap::new();
        let l = Layout::from_size_align(100, 8).unwrap();
        let p = heap.allocate(l);
        assert_eq!(heap.used(), 112);
        // SAFETY: p came from this heap with l and is freed once.
        unsafe { heap.deallocate(p, l) };
        assert_eq!(heap.used(), 112, "the node was written inside the block");
        assert_eq!(heap.free_stats(), (1, 112, 112));
    }

    #[test]
    fn a_block_never_shrinks_below_a_node() {
        assert_eq!(MIN_BLOCK, align_up(NODE, MAX_ALIGN));
        assert!(MIN_BLOCK >= NODE);
        let l = Layout::from_size_align(1, 1).unwrap();
        assert_eq!(block_size(&l), MIN_BLOCK);
    }

    #[test]
    fn an_exact_fit_is_the_only_fit_so_far() {
        let heap = Heap::new();
        let big = Layout::from_size_align(256, 8).unwrap();
        let small = Layout::from_size_align(64, 8).unwrap();
        let p = heap.allocate(big);
        // SAFETY: p came from this heap with big and is freed once.
        unsafe { heap.deallocate(p, big) };
        let q = heap.allocate(small);
        assert_ne!(p, q);
        assert_eq!(heap.used(), 320);
    }
}
```

```solution
use std::alloc::Layout;
use std::cell::{Cell, UnsafeCell};
use std::mem::MaybeUninit;
use std::ptr::null_mut;
/// Bytes in the arena. Fixed at compile time: an allocator has nobody to ask.
pub const ARENA: usize = 1 << 16;

/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;

/// Round `n` up to the next multiple of `align`, which must be a power of two.
pub const fn align_up(n: usize, align: usize) -> usize {
    (n + align - 1) & !(align - 1)
}
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align).ok()?;
    Some((layout.size(), layout.align()))
}
#[repr(align(16))]
struct Store {
    bytes: [MaybeUninit<u8>; ARENA],
}

impl Store {
    const fn new() -> Self {
        Store { bytes: [MaybeUninit::uninit(); ARENA] }
    }
}
/// One pointer, moving forward. Nothing else.
pub struct Bump {
    buf: UnsafeCell<Store>,
    next: Cell<usize>,
}
impl Bump {
    pub fn new() -> Self {
        Bump { buf: UnsafeCell::new(Store::new()), next: Cell::new(0) }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a reference,
        // so it cannot invalidate a pointer already handed out.
        unsafe { &raw mut (*self.buf.get()).bytes as *mut u8 }
    }

    pub fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN {
            return null_mut();
        }
        let start = align_up(self.next.get(), layout.align());
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        if end > ARENA {
            return null_mut();
        }
        self.next.set(end);
        // SAFETY: end <= ARENA, so `start` is an offset inside the single
        // object `base` points at and the whole block is in bounds. The base is
        // 16-aligned and `start` is a multiple of layout.align(), so the result
        // has the alignment the caller asked for.
        unsafe { self.base().add(start) }
    }

    pub fn used(&self) -> usize {
        self.next.get()
    }

    pub fn remaining(&self) -> usize {
        ARENA - self.next.get()
    }

    /// Hand the whole arena back at once.
    ///
    /// Taking `&mut self` is what makes this safe: any slice handed out by
    /// `alloc_slice` borrows `&self`, so none can be alive here.
    pub fn reset(&mut self) {
        self.next.set(0);
    }

    /// Allocate `n` bytes and write `fill` into every one of them, so the
    /// result is a real `&mut [u8]` rather than a claim about garbage.
    pub fn alloc_slice(&self, n: usize, fill: u8) -> Option<&mut [u8]> {
        let p = self.alloc(Layout::from_size_align(n, 1).ok()?);
        if p.is_null() {
            return None;
        }
        // SAFETY: `p` starts `n` bytes that nothing else points at, because the
        // bump pointer only ever moves forward. `write_bytes` initialises all
        // of them, so afterwards the range really is a `[u8]`. The returned
        // lifetime is that of `&self`, so `reset`, which needs `&mut self`,
        // cannot run while this slice is alive.
        unsafe {
            std::ptr::write_bytes(p, fill, n);
            Some(std::slice::from_raw_parts_mut(p, n))
        }
    }

    /// # Safety
    /// `off` must be less than `ARENA` and that byte must have been written.
    pub unsafe fn read_byte(&self, off: usize) -> u8 {
        // SAFETY: the caller guarantees the byte is in range and initialised.
        unsafe {
            (self.base() as *const MaybeUninit<u8>)
                .add(off)
                .read()
                .assume_init()
        }
    }
}
/// The header of a free block, written into the block's own bytes.
#[repr(C)]
pub struct FreeNode {
    pub size: usize,
    pub next: *mut FreeNode,
}

pub const NODE: usize = std::mem::size_of::<FreeNode>();

/// No block is smaller than a node, or the list could not live inside it.
pub const MIN_BLOCK: usize = align_up(NODE, MAX_ALIGN);

/// What a request actually costs: rounded up so every block is 16-aligned and
/// big enough to hold a `FreeNode` once it is given back.
pub fn block_size(layout: &Layout) -> usize {
    align_up(layout.size().max(MIN_BLOCK), MAX_ALIGN)
}
/// A free list threaded through the arena's own free bytes.
pub struct Heap {
    arena: UnsafeCell<Store>,
    bump: Cell<usize>,
    head: Cell<*mut FreeNode>,
}
impl Heap {
    pub fn new() -> Self {
        Heap {
            arena: UnsafeCell::new(Store::new()),
            bump: Cell::new(0),
            head: Cell::new(null_mut()),
        }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a
        // reference, so it invalidates no pointer already handed out.
        unsafe { &raw mut (*self.arena.get()).bytes as *mut u8 }
    }

    pub fn allocate(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN || layout.size() > ARENA {
            return null_mut();
        }
        let need = block_size(&layout);

        let mut p = self.pop_exact(need);
        if p.is_null() {
            p = self.carve(need);
        }
        p
    }

    /// # Safety
    /// `ptr` must be a block this heap returned from `allocate` with
    /// exactly this `layout`, and must not have been deallocated since.
    pub unsafe fn deallocate(&self, ptr: *mut u8, layout: Layout) {
        let size = block_size(&layout);
        let node = ptr as *mut FreeNode;
        // SAFETY: the caller has handed the block back, so nothing else
        // points into it. It is `size` >= MIN_BLOCK bytes and 16-aligned,
        // room and alignment enough for a FreeNode.
        unsafe { node.write(FreeNode { size, next: self.head.get() }) };
        self.head.set(node);
    }

    /// Take fresh bytes off the end of the arena. This is stage two, still.
    fn carve(&self, need: usize) -> *mut u8 {
        let start = self.bump.get();
        if need > ARENA - start {
            return null_mut();
        }
        self.bump.set(start + need);
        // SAFETY: start + need <= ARENA, so the block lies inside the arena and
        // `base` carries provenance over all of it.
        unsafe { self.base().add(start) }
    }

    /// First block of exactly the right size, unlinked from the list.
    fn pop_exact(&self, need: usize) -> *mut u8 {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block in the arena, 16-aligned and at least
            // MIN_BLOCK bytes, so it holds the node deallocate wrote there.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            if size == need {
                if prev.is_null() {
                    self.head.set(next);
                } else {
                    // SAFETY: prev is a free block on the list.
                    unsafe { (*prev).next = next };
                }
                return cur as *mut u8;
            }
            prev = cur;
            cur = next;
        }
        null_mut()
    }

    /// (blocks, total free bytes, largest free block)
    pub fn free_stats(&self) -> (usize, usize, usize) {
        let (mut n, mut total, mut largest) = (0, 0, 0);
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block on the list.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            n += 1;
            total += size;
            if size > largest {
                largest = size;
            }
            cur = next;
        }
        (n, total, largest)
    }

    /// Bytes ever carved off the end of the arena.
    pub fn used(&self) -> usize {
        self.bump.get()
    }
}
pub fn run() -> (usize, usize, bool) {
    let heap = Heap::new();
    let l = Layout::from_size_align(64, 8).unwrap();

    let a = heap.allocate(l);
    let b = heap.allocate(l);
    // SAFETY: `a` came from this heap with this layout and is freed once.
    unsafe { heap.deallocate(a, l) };
    let c = heap.allocate(l);
    let reused = c == a;

    println!("first {a:p}");
    println!("second {b:p}");
    println!("after free, the next request got {c:p} (same block: {reused})");

    // SAFETY: both blocks came from this heap with this layout, freed once.
    unsafe {
        heap.deallocate(b, l);
        heap.deallocate(c, l);
    }
    let (blocks, free_bytes, _) = heap.free_stats();
    println!("carved {} bytes; {blocks} free blocks holding {free_bytes}", heap.used());
    (heap.used(), free_bytes, reused)
}
```

@hint `cur` is an address, not a struct. Addresses have no fields.
@hint Getting at the fields means dereferencing, which is the first of the five things `unsafe` unlocks. The block is already there.
@hint `(*cur).size` and `(*cur).next`, with the parentheses, because `.` binds tighter than `*`.

@diagnose E0609
`no field size on type *mut FreeNode`.

A raw pointer has no fields of its own, and Rust will not auto-dereference one
the way it does for `&T`. That is deliberate: auto-deref on a reference is always
safe, because a reference is always valid, while dereferencing a raw pointer is
the operation that can be wrong. Making it invisible would hide the only line
worth auditing.

`(*cur).size` reads the field. The parentheses are load bearing: `*cur.size`
parses as `*(cur.size)`, which is why the error names the field rather than the
dereference. Both reads belong inside the existing `unsafe` block, whose safety
comment says why `cur` points at a real node.

@diagnose E0133
`dereference of raw pointer is unsafe and requires unsafe block`.

You wrote `(*cur).size` outside the block, or moved the loop around and left the
dereference behind. The compiler does not care that the pointer came from a
place you trust; it cannot see that, and neither can a reviewer without the
comment.

The invariant this loop relies on is worth stating exactly, because everything
in the next four stages leans on it: every pointer reachable from `head` is a
block inside the arena, sixteen byte aligned, at least `MIN_BLOCK` bytes long,
not currently handed out, and holding the `FreeNode` that `deallocate` wrote
there. Nothing else in the file can put a pointer on that list.

@after
An allocated block in this heap carries no header at all. Zero bytes of
bookkeeping, because the size comes back with the pointer when the caller
deallocates. That is not a trick, it is why `GlobalAlloc::dealloc` takes a
`Layout` at all: C's `free` does not, so `malloc` has to store a size word
before every block, which is eight or sixteen bytes of overhead on every single
allocation and a cache line touched on every free.

The obvious Rust version of this list is `Option<Box<FreeNode>>`, and it cannot
work: `Box::new` calls the allocator, and this is the allocator. Every structure
inside an allocator has to live in memory the allocator already owns.

## 6. Splitting a block that is too big

@kind fix
@concept split

@expect E0308

Exact fit throws the arena away: a freed 256 byte block cannot serve a 64 byte
request, so the heap carves fresh bytes it did not need. First fit takes the
first block big enough, hands back the front of it, and leaves the remainder on
the list. The line that finds the remainder has the wrong type.

```starter
use std::alloc::Layout;
use std::cell::{Cell, UnsafeCell};
use std::mem::MaybeUninit;
use std::ptr::null_mut;
/// Bytes in the arena. Fixed at compile time: an allocator has nobody to ask.
pub const ARENA: usize = 1 << 16;

/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;

/// Round `n` up to the next multiple of `align`, which must be a power of two.
pub const fn align_up(n: usize, align: usize) -> usize {
    (n + align - 1) & !(align - 1)
}
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align).ok()?;
    Some((layout.size(), layout.align()))
}
#[repr(align(16))]
struct Store {
    bytes: [MaybeUninit<u8>; ARENA],
}

impl Store {
    const fn new() -> Self {
        Store { bytes: [MaybeUninit::uninit(); ARENA] }
    }
}
/// One pointer, moving forward. Nothing else.
pub struct Bump {
    buf: UnsafeCell<Store>,
    next: Cell<usize>,
}
impl Bump {
    pub fn new() -> Self {
        Bump { buf: UnsafeCell::new(Store::new()), next: Cell::new(0) }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a reference,
        // so it cannot invalidate a pointer already handed out.
        unsafe { &raw mut (*self.buf.get()).bytes as *mut u8 }
    }

    pub fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN {
            return null_mut();
        }
        let start = align_up(self.next.get(), layout.align());
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        if end > ARENA {
            return null_mut();
        }
        self.next.set(end);
        // SAFETY: end <= ARENA, so `start` is an offset inside the single
        // object `base` points at and the whole block is in bounds. The base is
        // 16-aligned and `start` is a multiple of layout.align(), so the result
        // has the alignment the caller asked for.
        unsafe { self.base().add(start) }
    }

    pub fn used(&self) -> usize {
        self.next.get()
    }

    pub fn remaining(&self) -> usize {
        ARENA - self.next.get()
    }

    /// Hand the whole arena back at once.
    ///
    /// Taking `&mut self` is what makes this safe: any slice handed out by
    /// `alloc_slice` borrows `&self`, so none can be alive here.
    pub fn reset(&mut self) {
        self.next.set(0);
    }

    /// Allocate `n` bytes and write `fill` into every one of them, so the
    /// result is a real `&mut [u8]` rather than a claim about garbage.
    pub fn alloc_slice(&self, n: usize, fill: u8) -> Option<&mut [u8]> {
        let p = self.alloc(Layout::from_size_align(n, 1).ok()?);
        if p.is_null() {
            return None;
        }
        // SAFETY: `p` starts `n` bytes that nothing else points at, because the
        // bump pointer only ever moves forward. `write_bytes` initialises all
        // of them, so afterwards the range really is a `[u8]`. The returned
        // lifetime is that of `&self`, so `reset`, which needs `&mut self`,
        // cannot run while this slice is alive.
        unsafe {
            std::ptr::write_bytes(p, fill, n);
            Some(std::slice::from_raw_parts_mut(p, n))
        }
    }

    /// # Safety
    /// `off` must be less than `ARENA` and that byte must have been written.
    pub unsafe fn read_byte(&self, off: usize) -> u8 {
        // SAFETY: the caller guarantees the byte is in range and initialised.
        unsafe {
            (self.base() as *const MaybeUninit<u8>)
                .add(off)
                .read()
                .assume_init()
        }
    }
}
/// The header of a free block, written into the block's own bytes.
#[repr(C)]
pub struct FreeNode {
    pub size: usize,
    pub next: *mut FreeNode,
}

pub const NODE: usize = std::mem::size_of::<FreeNode>();

/// No block is smaller than a node, or the list could not live inside it.
pub const MIN_BLOCK: usize = align_up(NODE, MAX_ALIGN);

/// What a request actually costs: rounded up so every block is 16-aligned and
/// big enough to hold a `FreeNode` once it is given back.
pub fn block_size(layout: &Layout) -> usize {
    align_up(layout.size().max(MIN_BLOCK), MAX_ALIGN)
}
/// A free list threaded through the arena's own free bytes.
pub struct Heap {
    arena: UnsafeCell<Store>,
    bump: Cell<usize>,
    head: Cell<*mut FreeNode>,
}
impl Heap {
    pub fn new() -> Self {
        Heap {
            arena: UnsafeCell::new(Store::new()),
            bump: Cell::new(0),
            head: Cell::new(null_mut()),
        }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a
        // reference, so it invalidates no pointer already handed out.
        unsafe { &raw mut (*self.arena.get()).bytes as *mut u8 }
    }

    pub fn allocate(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN || layout.size() > ARENA {
            return null_mut();
        }
        let need = block_size(&layout);

        let mut p = self.pop_free(need);
        if p.is_null() {
            p = self.carve(need);
        }
        p
    }

    /// # Safety
    /// `ptr` must be a block this heap returned from `allocate` with
    /// exactly this `layout`, and must not have been deallocated since.
    pub unsafe fn deallocate(&self, ptr: *mut u8, layout: Layout) {
        let size = block_size(&layout);
        let node = ptr as *mut FreeNode;
        // SAFETY: the caller has handed the block back, so nothing else
        // points into it. It is `size` >= MIN_BLOCK bytes and 16-aligned,
        // room and alignment enough for a FreeNode.
        unsafe { node.write(FreeNode { size, next: self.head.get() }) };
        self.head.set(node);
    }

    /// Take fresh bytes off the end of the arena. This is stage two, still.
    fn carve(&self, need: usize) -> *mut u8 {
        let start = self.bump.get();
        if need > ARENA - start {
            return null_mut();
        }
        self.bump.set(start + need);
        // SAFETY: start + need <= ARENA, so the block lies inside the arena and
        // `base` carries provenance over all of it.
        unsafe { self.base().add(start) }
    }

    /// First block big enough, split if the remainder can hold a node.
    fn pop_free(&self, need: usize) -> *mut u8 {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block in the arena, 16-aligned and at least
            // MIN_BLOCK bytes, so it holds the node deallocate wrote there.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            if size >= need {
                let replacement = if size - need >= MIN_BLOCK {
                    // SAFETY: need <= size, so this offset is still inside the
                    // block, and every block lies inside the arena.
                    let rem: *mut FreeNode = unsafe { (cur as *mut u8).add(need) };
                    // SAFETY: the remainder is at least MIN_BLOCK bytes,
                    // 16-aligned, and is not handed out to anyone.
                    unsafe { rem.write(FreeNode { size: size - need, next }) };
                    rem
                } else {
                    next
                };
                if prev.is_null() {
                    self.head.set(replacement);
                } else {
                    // SAFETY: prev is a free block on the list.
                    unsafe { (*prev).next = replacement };
                }
                return cur as *mut u8;
            }
            prev = cur;
            cur = next;
        }
        null_mut()
    }

    /// (blocks, total free bytes, largest free block)
    pub fn free_stats(&self) -> (usize, usize, usize) {
        let (mut n, mut total, mut largest) = (0, 0, 0);
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block on the list.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            n += 1;
            total += size;
            if size > largest {
                largest = size;
            }
            cur = next;
        }
        (n, total, largest)
    }

    /// Bytes ever carved off the end of the arena.
    pub fn used(&self) -> usize {
        self.bump.get()
    }
}
pub fn run() -> (usize, usize, bool) {
    let heap = Heap::new();
    let big = Layout::from_size_align(256, 8).unwrap();
    let small = Layout::from_size_align(64, 8).unwrap();

    let p = heap.allocate(big);
    // SAFETY: p came from this heap with `big` and is freed once.
    unsafe { heap.deallocate(p, big) };

    let q = heap.allocate(small);
    let split = p == q;
    let (blocks, free_bytes, largest) = heap.free_stats();

    println!("a 256 byte block was freed, then 64 bytes were asked for");
    println!("the request got {q:p}, the head of the old block: {split}");
    println!("{blocks} free block of {free_bytes} bytes left over (largest {largest})");
    println!("the arena has still only carved {} bytes", heap.used());
    (heap.used(), free_bytes, split)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_big_block_serves_a_small_request() {
        let (used, free_bytes, split) = run();
        assert!(split, "the 64 byte request should start where the 256 did");
        assert_eq!(used, 256);
        assert_eq!(free_bytes, 192);
    }

    #[test]
    fn the_remainder_is_a_real_block() {
        let heap = Heap::new();
        let big = Layout::from_size_align(256, 8).unwrap();
        let small = Layout::from_size_align(64, 8).unwrap();
        let p = heap.allocate(big);
        // SAFETY: p came from this heap with big and is freed once.
        unsafe { heap.deallocate(p, big) };
        let got: Vec<*mut u8> = (0..4).map(|_| heap.allocate(small)).collect();
        assert_eq!(heap.used(), 256, "all four came out of the one block");
        assert_eq!(heap.free_stats(), (0, 0, 0));
        for i in 1..4 {
            assert_eq!(got[i].addr(), got[0].addr() + 64 * i);
        }
    }

    #[test]
    fn an_exact_fit_leaves_no_remainder() {
        let heap = Heap::new();
        let l = Layout::from_size_align(64, 8).unwrap();
        let p = heap.allocate(l);
        // SAFETY: p came from this heap with l and is freed once.
        unsafe { heap.deallocate(p, l) };
        let q = heap.allocate(l);
        assert_eq!(p, q);
        assert_eq!(heap.free_stats(), (0, 0, 0));
    }

    #[test]
    fn every_remainder_can_hold_a_node() {
        let heap = Heap::new();
        let big = Layout::from_size_align(700, 8).unwrap();
        let p = heap.allocate(big);
        // SAFETY: p came from this heap with big and is freed once.
        unsafe { heap.deallocate(p, big) };
        for size in [1usize, 3, 17, 33] {
            let l = Layout::from_size_align(size, 1).unwrap();
            assert!(!heap.allocate(l).is_null());
            let (_, bytes, largest) = heap.free_stats();
            assert!(largest >= MIN_BLOCK || bytes == 0);
        }
        assert_eq!(heap.used(), 704);
    }
}
```

```solution
use std::alloc::Layout;
use std::cell::{Cell, UnsafeCell};
use std::mem::MaybeUninit;
use std::ptr::null_mut;
/// Bytes in the arena. Fixed at compile time: an allocator has nobody to ask.
pub const ARENA: usize = 1 << 16;

/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;

/// Round `n` up to the next multiple of `align`, which must be a power of two.
pub const fn align_up(n: usize, align: usize) -> usize {
    (n + align - 1) & !(align - 1)
}
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align).ok()?;
    Some((layout.size(), layout.align()))
}
#[repr(align(16))]
struct Store {
    bytes: [MaybeUninit<u8>; ARENA],
}

impl Store {
    const fn new() -> Self {
        Store { bytes: [MaybeUninit::uninit(); ARENA] }
    }
}
/// One pointer, moving forward. Nothing else.
pub struct Bump {
    buf: UnsafeCell<Store>,
    next: Cell<usize>,
}
impl Bump {
    pub fn new() -> Self {
        Bump { buf: UnsafeCell::new(Store::new()), next: Cell::new(0) }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a reference,
        // so it cannot invalidate a pointer already handed out.
        unsafe { &raw mut (*self.buf.get()).bytes as *mut u8 }
    }

    pub fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN {
            return null_mut();
        }
        let start = align_up(self.next.get(), layout.align());
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        if end > ARENA {
            return null_mut();
        }
        self.next.set(end);
        // SAFETY: end <= ARENA, so `start` is an offset inside the single
        // object `base` points at and the whole block is in bounds. The base is
        // 16-aligned and `start` is a multiple of layout.align(), so the result
        // has the alignment the caller asked for.
        unsafe { self.base().add(start) }
    }

    pub fn used(&self) -> usize {
        self.next.get()
    }

    pub fn remaining(&self) -> usize {
        ARENA - self.next.get()
    }

    /// Hand the whole arena back at once.
    ///
    /// Taking `&mut self` is what makes this safe: any slice handed out by
    /// `alloc_slice` borrows `&self`, so none can be alive here.
    pub fn reset(&mut self) {
        self.next.set(0);
    }

    /// Allocate `n` bytes and write `fill` into every one of them, so the
    /// result is a real `&mut [u8]` rather than a claim about garbage.
    pub fn alloc_slice(&self, n: usize, fill: u8) -> Option<&mut [u8]> {
        let p = self.alloc(Layout::from_size_align(n, 1).ok()?);
        if p.is_null() {
            return None;
        }
        // SAFETY: `p` starts `n` bytes that nothing else points at, because the
        // bump pointer only ever moves forward. `write_bytes` initialises all
        // of them, so afterwards the range really is a `[u8]`. The returned
        // lifetime is that of `&self`, so `reset`, which needs `&mut self`,
        // cannot run while this slice is alive.
        unsafe {
            std::ptr::write_bytes(p, fill, n);
            Some(std::slice::from_raw_parts_mut(p, n))
        }
    }

    /// # Safety
    /// `off` must be less than `ARENA` and that byte must have been written.
    pub unsafe fn read_byte(&self, off: usize) -> u8 {
        // SAFETY: the caller guarantees the byte is in range and initialised.
        unsafe {
            (self.base() as *const MaybeUninit<u8>)
                .add(off)
                .read()
                .assume_init()
        }
    }
}
/// The header of a free block, written into the block's own bytes.
#[repr(C)]
pub struct FreeNode {
    pub size: usize,
    pub next: *mut FreeNode,
}

pub const NODE: usize = std::mem::size_of::<FreeNode>();

/// No block is smaller than a node, or the list could not live inside it.
pub const MIN_BLOCK: usize = align_up(NODE, MAX_ALIGN);

/// What a request actually costs: rounded up so every block is 16-aligned and
/// big enough to hold a `FreeNode` once it is given back.
pub fn block_size(layout: &Layout) -> usize {
    align_up(layout.size().max(MIN_BLOCK), MAX_ALIGN)
}
/// A free list threaded through the arena's own free bytes.
pub struct Heap {
    arena: UnsafeCell<Store>,
    bump: Cell<usize>,
    head: Cell<*mut FreeNode>,
}
impl Heap {
    pub fn new() -> Self {
        Heap {
            arena: UnsafeCell::new(Store::new()),
            bump: Cell::new(0),
            head: Cell::new(null_mut()),
        }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a
        // reference, so it invalidates no pointer already handed out.
        unsafe { &raw mut (*self.arena.get()).bytes as *mut u8 }
    }

    pub fn allocate(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN || layout.size() > ARENA {
            return null_mut();
        }
        let need = block_size(&layout);

        let mut p = self.pop_free(need);
        if p.is_null() {
            p = self.carve(need);
        }
        p
    }

    /// # Safety
    /// `ptr` must be a block this heap returned from `allocate` with
    /// exactly this `layout`, and must not have been deallocated since.
    pub unsafe fn deallocate(&self, ptr: *mut u8, layout: Layout) {
        let size = block_size(&layout);
        let node = ptr as *mut FreeNode;
        // SAFETY: the caller has handed the block back, so nothing else
        // points into it. It is `size` >= MIN_BLOCK bytes and 16-aligned,
        // room and alignment enough for a FreeNode.
        unsafe { node.write(FreeNode { size, next: self.head.get() }) };
        self.head.set(node);
    }

    /// Take fresh bytes off the end of the arena. This is stage two, still.
    fn carve(&self, need: usize) -> *mut u8 {
        let start = self.bump.get();
        if need > ARENA - start {
            return null_mut();
        }
        self.bump.set(start + need);
        // SAFETY: start + need <= ARENA, so the block lies inside the arena and
        // `base` carries provenance over all of it.
        unsafe { self.base().add(start) }
    }

    /// First block big enough, split if the remainder can hold a node.
    fn pop_free(&self, need: usize) -> *mut u8 {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block in the arena, 16-aligned and at least
            // MIN_BLOCK bytes, so it holds the node deallocate wrote there.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            if size >= need {
                let replacement = if size - need >= MIN_BLOCK {
                    // SAFETY: need <= size, so this offset is still inside the
                    // block, and every block lies inside the arena.
                    let rem = unsafe { (cur as *mut u8).add(need) } as *mut FreeNode;
                    // SAFETY: the remainder is at least MIN_BLOCK bytes,
                    // 16-aligned, and is not handed out to anyone.
                    unsafe { rem.write(FreeNode { size: size - need, next }) };
                    rem
                } else {
                    next
                };
                if prev.is_null() {
                    self.head.set(replacement);
                } else {
                    // SAFETY: prev is a free block on the list.
                    unsafe { (*prev).next = replacement };
                }
                return cur as *mut u8;
            }
            prev = cur;
            cur = next;
        }
        null_mut()
    }

    /// (blocks, total free bytes, largest free block)
    pub fn free_stats(&self) -> (usize, usize, usize) {
        let (mut n, mut total, mut largest) = (0, 0, 0);
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block on the list.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            n += 1;
            total += size;
            if size > largest {
                largest = size;
            }
            cur = next;
        }
        (n, total, largest)
    }

    /// Bytes ever carved off the end of the arena.
    pub fn used(&self) -> usize {
        self.bump.get()
    }
}
pub fn run() -> (usize, usize, bool) {
    let heap = Heap::new();
    let big = Layout::from_size_align(256, 8).unwrap();
    let small = Layout::from_size_align(64, 8).unwrap();

    let p = heap.allocate(big);
    // SAFETY: p came from this heap with `big` and is freed once.
    unsafe { heap.deallocate(p, big) };

    let q = heap.allocate(small);
    let split = p == q;
    let (blocks, free_bytes, largest) = heap.free_stats();

    println!("a 256 byte block was freed, then 64 bytes were asked for");
    println!("the request got {q:p}, the head of the old block: {split}");
    println!("{blocks} free block of {free_bytes} bytes left over (largest {largest})");
    println!("the arena has still only carved {} bytes", heap.used());
    (heap.used(), free_bytes, split)
}
```

@hint Pointer arithmetic scales by the pointee. `add(need)` on a `*mut FreeNode` would move sixteen times too far.
@hint That is why the expression casts to `*mut u8` before adding. Ask what type the whole expression has after that.
@hint `let rem = unsafe { (cur as *mut u8).add(need) } as *mut FreeNode;`

@diagnose E0308
`mismatched types: expected *mut FreeNode, found *mut u8`.

The annotation on the binding says one thing and the expression produces
another. The cast to `*mut u8` was there to make `add` count in bytes, and once
it has, the result has to be cast back.

Casts between raw pointer types are free at runtime and they do carry meaning:
this one says the bytes at that address are about to be read and written as a
`FreeNode`. That claim is what the next line depends on, and it holds because
every block in this heap starts at a sixteen byte boundary and is at least
`MIN_BLOCK` bytes long, which is enough alignment and enough room for the
struct. Provenance survives a cast, so `rem` still points into the arena.

@diagnose E0133
`call to unsafe function pointer::add is unsafe and requires unsafe block`, or
the same about `write`.

`add` is unsafe even though it computes rather than reads, because the result
must stay inside the same allocated object. Compute an address one byte past the
end of the arena and the pointer is already invalid, whether or not anything ever
dereferences it. That rule is what lets the optimiser reason about pointer
comparisons at all.

Here `need <= size` and the block is inside the arena, so the offset is in
bounds. That sentence is the safety comment, and it is why the block above the
line says exactly that.

@after
There is a minimum split size, and here it is invisible because the arithmetic
already guarantees it. Every request is rounded to a multiple of sixteen and
`MIN_BLOCK` is sixteen, so a remainder is either exactly nothing or at least one
whole node. Drop the rounding and allow eight byte blocks and the split can
leave a remainder too small to hold its own header, so writing one runs eight
bytes into the block you just handed the caller, and the corruption surfaces
later somewhere else entirely.

Allocators that do allow that either refuse to split below a threshold and hand
the extra bytes to the caller as internal fragmentation, or keep a per block
header so the true size is recoverable. Both cost memory. Rounding costs memory
too, up to fifteen bytes a block here, and it buys an invariant instead of a
branch.

## 7. Putting adjacent blocks back together

@kind fix
@concept coalescing

@expect E0369

Split often enough and the arena turns to dust: plenty of free bytes, none of
them next to each other. `deallocate` now inserts in address order and merges
with either neighbour it touches. The test for touching does not compile, and
the reason is that Rust has no pointer arithmetic operator.

```starter
use std::alloc::Layout;
use std::cell::{Cell, UnsafeCell};
use std::mem::MaybeUninit;
use std::ptr::null_mut;
/// Bytes in the arena. Fixed at compile time: an allocator has nobody to ask.
pub const ARENA: usize = 1 << 16;

/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;

/// Round `n` up to the next multiple of `align`, which must be a power of two.
pub const fn align_up(n: usize, align: usize) -> usize {
    (n + align - 1) & !(align - 1)
}
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align).ok()?;
    Some((layout.size(), layout.align()))
}
#[repr(align(16))]
struct Store {
    bytes: [MaybeUninit<u8>; ARENA],
}

impl Store {
    const fn new() -> Self {
        Store { bytes: [MaybeUninit::uninit(); ARENA] }
    }
}
/// One pointer, moving forward. Nothing else.
pub struct Bump {
    buf: UnsafeCell<Store>,
    next: Cell<usize>,
}
impl Bump {
    pub fn new() -> Self {
        Bump { buf: UnsafeCell::new(Store::new()), next: Cell::new(0) }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a reference,
        // so it cannot invalidate a pointer already handed out.
        unsafe { &raw mut (*self.buf.get()).bytes as *mut u8 }
    }

    pub fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN {
            return null_mut();
        }
        let start = align_up(self.next.get(), layout.align());
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        if end > ARENA {
            return null_mut();
        }
        self.next.set(end);
        // SAFETY: end <= ARENA, so `start` is an offset inside the single
        // object `base` points at and the whole block is in bounds. The base is
        // 16-aligned and `start` is a multiple of layout.align(), so the result
        // has the alignment the caller asked for.
        unsafe { self.base().add(start) }
    }

    pub fn used(&self) -> usize {
        self.next.get()
    }

    pub fn remaining(&self) -> usize {
        ARENA - self.next.get()
    }

    /// Hand the whole arena back at once.
    ///
    /// Taking `&mut self` is what makes this safe: any slice handed out by
    /// `alloc_slice` borrows `&self`, so none can be alive here.
    pub fn reset(&mut self) {
        self.next.set(0);
    }

    /// Allocate `n` bytes and write `fill` into every one of them, so the
    /// result is a real `&mut [u8]` rather than a claim about garbage.
    pub fn alloc_slice(&self, n: usize, fill: u8) -> Option<&mut [u8]> {
        let p = self.alloc(Layout::from_size_align(n, 1).ok()?);
        if p.is_null() {
            return None;
        }
        // SAFETY: `p` starts `n` bytes that nothing else points at, because the
        // bump pointer only ever moves forward. `write_bytes` initialises all
        // of them, so afterwards the range really is a `[u8]`. The returned
        // lifetime is that of `&self`, so `reset`, which needs `&mut self`,
        // cannot run while this slice is alive.
        unsafe {
            std::ptr::write_bytes(p, fill, n);
            Some(std::slice::from_raw_parts_mut(p, n))
        }
    }

    /// # Safety
    /// `off` must be less than `ARENA` and that byte must have been written.
    pub unsafe fn read_byte(&self, off: usize) -> u8 {
        // SAFETY: the caller guarantees the byte is in range and initialised.
        unsafe {
            (self.base() as *const MaybeUninit<u8>)
                .add(off)
                .read()
                .assume_init()
        }
    }
}
/// The header of a free block, written into the block's own bytes.
#[repr(C)]
pub struct FreeNode {
    pub size: usize,
    pub next: *mut FreeNode,
}

pub const NODE: usize = std::mem::size_of::<FreeNode>();

/// No block is smaller than a node, or the list could not live inside it.
pub const MIN_BLOCK: usize = align_up(NODE, MAX_ALIGN);

/// What a request actually costs: rounded up so every block is 16-aligned and
/// big enough to hold a `FreeNode` once it is given back.
pub fn block_size(layout: &Layout) -> usize {
    align_up(layout.size().max(MIN_BLOCK), MAX_ALIGN)
}
/// A free list threaded through the arena's own free bytes.
pub struct Heap {
    arena: UnsafeCell<Store>,
    bump: Cell<usize>,
    head: Cell<*mut FreeNode>,
}
impl Heap {
    pub fn new() -> Self {
        Heap {
            arena: UnsafeCell::new(Store::new()),
            bump: Cell::new(0),
            head: Cell::new(null_mut()),
        }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a
        // reference, so it invalidates no pointer already handed out.
        unsafe { &raw mut (*self.arena.get()).bytes as *mut u8 }
    }

    pub fn allocate(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN || layout.size() > ARENA {
            return null_mut();
        }
        let need = block_size(&layout);

        let mut p = self.pop_free(need);
        if p.is_null() {
            p = self.carve(need);
        }
        p
    }

    /// # Safety
    /// `ptr` must be a block this heap returned from `allocate` with
    /// exactly this `layout`, and must not have been deallocated since.
    pub unsafe fn deallocate(&self, ptr: *mut u8, layout: Layout) {
        let size = block_size(&layout);
        let node = ptr as *mut FreeNode;
        // SAFETY: the caller has handed the block back, so nothing else
        // points into it. It is `size` >= MIN_BLOCK bytes and 16-aligned,
        // room and alignment enough for a FreeNode.
        unsafe { self.insert_free(node, size) };
    }

    /// Take fresh bytes off the end of the arena. This is stage two, still.
    fn carve(&self, need: usize) -> *mut u8 {
        let start = self.bump.get();
        if need > ARENA - start {
            return null_mut();
        }
        self.bump.set(start + need);
        // SAFETY: start + need <= ARENA, so the block lies inside the arena and
        // `base` carries provenance over all of it.
        unsafe { self.base().add(start) }
    }

    /// First block big enough, split if the remainder can hold a node.
    fn pop_free(&self, need: usize) -> *mut u8 {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block in the arena, 16-aligned and at least
            // MIN_BLOCK bytes, so it holds the node deallocate wrote there.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            if size >= need {
                let replacement = if size - need >= MIN_BLOCK {
                    // SAFETY: need <= size, so this offset is still inside the
                    // block, and every block lies inside the arena.
                    let rem = unsafe { (cur as *mut u8).add(need) } as *mut FreeNode;
                    // SAFETY: the remainder is at least MIN_BLOCK bytes,
                    // 16-aligned, and is not handed out to anyone.
                    unsafe { rem.write(FreeNode { size: size - need, next }) };
                    rem
                } else {
                    next
                };
                if prev.is_null() {
                    self.head.set(replacement);
                } else {
                    // SAFETY: prev is a free block on the list.
                    unsafe { (*prev).next = replacement };
                }
                return cur as *mut u8;
            }
            prev = cur;
            cur = next;
        }
        null_mut()
    }

    /// # Safety
    /// `node` must point at `size` bytes of this arena that are not handed out
    /// and are on no list.
    unsafe fn insert_free(&self, node: *mut FreeNode, size: usize) {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() && cur.addr() < node.addr() {
            prev = cur;
            // SAFETY: cur is a free block on the list.
            cur = unsafe { (*cur).next };
        }
        // SAFETY: the caller guarantees these bytes are the allocator's again.
        unsafe { node.write(FreeNode { size, next: cur }) };
        if prev.is_null() {
            self.head.set(node);
        } else {
            // SAFETY: prev is a free block on the list.
            unsafe { (*prev).next = node };
        }

        if !cur.is_null() && node + size == cur {
            // SAFETY: node and cur are both free blocks on the list, and the
            // one ends exactly where the other starts.
            unsafe {
                (*node).size = size + (*cur).size;
                (*node).next = (*cur).next;
            }
        }
        if !prev.is_null() {
            // SAFETY: prev and node are both free blocks on the list.
            unsafe {
                if prev.addr() + (*prev).size == node.addr() {
                    (*prev).size += (*node).size;
                    (*prev).next = (*node).next;
                }
            }
        }
    }

    /// (blocks, total free bytes, largest free block)
    pub fn free_stats(&self) -> (usize, usize, usize) {
        let (mut n, mut total, mut largest) = (0, 0, 0);
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block on the list.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            n += 1;
            total += size;
            if size > largest {
                largest = size;
            }
            cur = next;
        }
        (n, total, largest)
    }

    /// Bytes ever carved off the end of the arena.
    pub fn used(&self) -> usize {
        self.bump.get()
    }
}
pub fn run() -> (usize, usize, usize) {
    let heap = Heap::new();
    let l = Layout::from_size_align(64, 8).unwrap();
    let a = heap.allocate(l);
    let b = heap.allocate(l);
    let c = heap.allocate(l);

    // SAFETY: each block came from this heap with `l` and is freed once.
    unsafe { heap.deallocate(a, l) };
    let (after_a, _, _) = heap.free_stats();
    // SAFETY: as above.
    unsafe { heap.deallocate(c, l) };
    let (after_c, _, _) = heap.free_stats();
    // SAFETY: as above.
    unsafe { heap.deallocate(b, l) };
    let (after_b, bytes, largest) = heap.free_stats();

    println!("freed the first block:  {after_a} free block");
    println!("freed the third block:  {after_c} free blocks, not neighbours");
    println!("freed the middle block: {after_b} free block of {bytes} bytes");
    println!("largest hole {largest}, arena carved {}", heap.used());
    (after_a, after_c, after_b)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neighbours_merge_and_strangers_do_not() {
        let (after_a, after_c, after_b) = run();
        assert_eq!((after_a, after_c, after_b), (1, 2, 1));
    }

    #[test]
    fn the_arena_comes_back_whole() {
        let heap = Heap::new();
        let mut held = Vec::new();
        for i in 0..32 {
            let l = Layout::from_size_align(16 * (i % 7 + 1), 8).unwrap();
            held.push((heap.allocate(l), l));
        }
        let carved = heap.used();
        for (p, l) in held.into_iter().rev() {
            // SAFETY: each came from this heap with l and is freed once.
            unsafe { heap.deallocate(p, l) };
        }
        assert_eq!(heap.free_stats(), (1, carved, carved));
    }

    #[test]
    fn coalescing_does_not_cure_fragmentation() {
        let heap = Heap::new();
        let l = Layout::from_size_align(64, 8).unwrap();
        let a = heap.allocate(l);
        let _b = heap.allocate(l);
        let c = heap.allocate(l);
        // SAFETY: both came from this heap with l and are freed once.
        unsafe {
            heap.deallocate(a, l);
            heap.deallocate(c, l);
        }
        assert_eq!(heap.free_stats(), (2, 128, 64));
        let wide = Layout::from_size_align(128, 8).unwrap();
        assert!(!heap.allocate(wide).is_null());
        assert_eq!(heap.used(), 320, "128 free bytes could not serve 128 bytes");
    }

    #[test]
    fn the_list_stays_sorted_by_address() {
        let heap = Heap::new();
        let l = Layout::from_size_align(64, 8).unwrap();
        let ps: Vec<*mut u8> = (0..6).map(|_| heap.allocate(l)).collect();
        for i in [4usize, 0, 2] {
            // SAFETY: each came from this heap with l and is freed once.
            unsafe { heap.deallocate(ps[i], l) };
        }
        assert_eq!(heap.free_stats(), (3, 192, 64));
    }
}
```

```solution
use std::alloc::Layout;
use std::cell::{Cell, UnsafeCell};
use std::mem::MaybeUninit;
use std::ptr::null_mut;
/// Bytes in the arena. Fixed at compile time: an allocator has nobody to ask.
pub const ARENA: usize = 1 << 16;

/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;

/// Round `n` up to the next multiple of `align`, which must be a power of two.
pub const fn align_up(n: usize, align: usize) -> usize {
    (n + align - 1) & !(align - 1)
}
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align).ok()?;
    Some((layout.size(), layout.align()))
}
#[repr(align(16))]
struct Store {
    bytes: [MaybeUninit<u8>; ARENA],
}

impl Store {
    const fn new() -> Self {
        Store { bytes: [MaybeUninit::uninit(); ARENA] }
    }
}
/// One pointer, moving forward. Nothing else.
pub struct Bump {
    buf: UnsafeCell<Store>,
    next: Cell<usize>,
}
impl Bump {
    pub fn new() -> Self {
        Bump { buf: UnsafeCell::new(Store::new()), next: Cell::new(0) }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a reference,
        // so it cannot invalidate a pointer already handed out.
        unsafe { &raw mut (*self.buf.get()).bytes as *mut u8 }
    }

    pub fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN {
            return null_mut();
        }
        let start = align_up(self.next.get(), layout.align());
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        if end > ARENA {
            return null_mut();
        }
        self.next.set(end);
        // SAFETY: end <= ARENA, so `start` is an offset inside the single
        // object `base` points at and the whole block is in bounds. The base is
        // 16-aligned and `start` is a multiple of layout.align(), so the result
        // has the alignment the caller asked for.
        unsafe { self.base().add(start) }
    }

    pub fn used(&self) -> usize {
        self.next.get()
    }

    pub fn remaining(&self) -> usize {
        ARENA - self.next.get()
    }

    /// Hand the whole arena back at once.
    ///
    /// Taking `&mut self` is what makes this safe: any slice handed out by
    /// `alloc_slice` borrows `&self`, so none can be alive here.
    pub fn reset(&mut self) {
        self.next.set(0);
    }

    /// Allocate `n` bytes and write `fill` into every one of them, so the
    /// result is a real `&mut [u8]` rather than a claim about garbage.
    pub fn alloc_slice(&self, n: usize, fill: u8) -> Option<&mut [u8]> {
        let p = self.alloc(Layout::from_size_align(n, 1).ok()?);
        if p.is_null() {
            return None;
        }
        // SAFETY: `p` starts `n` bytes that nothing else points at, because the
        // bump pointer only ever moves forward. `write_bytes` initialises all
        // of them, so afterwards the range really is a `[u8]`. The returned
        // lifetime is that of `&self`, so `reset`, which needs `&mut self`,
        // cannot run while this slice is alive.
        unsafe {
            std::ptr::write_bytes(p, fill, n);
            Some(std::slice::from_raw_parts_mut(p, n))
        }
    }

    /// # Safety
    /// `off` must be less than `ARENA` and that byte must have been written.
    pub unsafe fn read_byte(&self, off: usize) -> u8 {
        // SAFETY: the caller guarantees the byte is in range and initialised.
        unsafe {
            (self.base() as *const MaybeUninit<u8>)
                .add(off)
                .read()
                .assume_init()
        }
    }
}
/// The header of a free block, written into the block's own bytes.
#[repr(C)]
pub struct FreeNode {
    pub size: usize,
    pub next: *mut FreeNode,
}

pub const NODE: usize = std::mem::size_of::<FreeNode>();

/// No block is smaller than a node, or the list could not live inside it.
pub const MIN_BLOCK: usize = align_up(NODE, MAX_ALIGN);

/// What a request actually costs: rounded up so every block is 16-aligned and
/// big enough to hold a `FreeNode` once it is given back.
pub fn block_size(layout: &Layout) -> usize {
    align_up(layout.size().max(MIN_BLOCK), MAX_ALIGN)
}
/// A free list threaded through the arena's own free bytes.
pub struct Heap {
    arena: UnsafeCell<Store>,
    bump: Cell<usize>,
    head: Cell<*mut FreeNode>,
}
impl Heap {
    pub fn new() -> Self {
        Heap {
            arena: UnsafeCell::new(Store::new()),
            bump: Cell::new(0),
            head: Cell::new(null_mut()),
        }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a
        // reference, so it invalidates no pointer already handed out.
        unsafe { &raw mut (*self.arena.get()).bytes as *mut u8 }
    }

    pub fn allocate(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN || layout.size() > ARENA {
            return null_mut();
        }
        let need = block_size(&layout);

        let mut p = self.pop_free(need);
        if p.is_null() {
            p = self.carve(need);
        }
        p
    }

    /// # Safety
    /// `ptr` must be a block this heap returned from `allocate` with
    /// exactly this `layout`, and must not have been deallocated since.
    pub unsafe fn deallocate(&self, ptr: *mut u8, layout: Layout) {
        let size = block_size(&layout);
        let node = ptr as *mut FreeNode;
        // SAFETY: the caller has handed the block back, so nothing else
        // points into it. It is `size` >= MIN_BLOCK bytes and 16-aligned,
        // room and alignment enough for a FreeNode.
        unsafe { self.insert_free(node, size) };
    }

    /// Take fresh bytes off the end of the arena. This is stage two, still.
    fn carve(&self, need: usize) -> *mut u8 {
        let start = self.bump.get();
        if need > ARENA - start {
            return null_mut();
        }
        self.bump.set(start + need);
        // SAFETY: start + need <= ARENA, so the block lies inside the arena and
        // `base` carries provenance over all of it.
        unsafe { self.base().add(start) }
    }

    /// First block big enough, split if the remainder can hold a node.
    fn pop_free(&self, need: usize) -> *mut u8 {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block in the arena, 16-aligned and at least
            // MIN_BLOCK bytes, so it holds the node deallocate wrote there.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            if size >= need {
                let replacement = if size - need >= MIN_BLOCK {
                    // SAFETY: need <= size, so this offset is still inside the
                    // block, and every block lies inside the arena.
                    let rem = unsafe { (cur as *mut u8).add(need) } as *mut FreeNode;
                    // SAFETY: the remainder is at least MIN_BLOCK bytes,
                    // 16-aligned, and is not handed out to anyone.
                    unsafe { rem.write(FreeNode { size: size - need, next }) };
                    rem
                } else {
                    next
                };
                if prev.is_null() {
                    self.head.set(replacement);
                } else {
                    // SAFETY: prev is a free block on the list.
                    unsafe { (*prev).next = replacement };
                }
                return cur as *mut u8;
            }
            prev = cur;
            cur = next;
        }
        null_mut()
    }

    /// # Safety
    /// `node` must point at `size` bytes of this arena that are not handed out
    /// and are on no list.
    unsafe fn insert_free(&self, node: *mut FreeNode, size: usize) {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() && cur.addr() < node.addr() {
            prev = cur;
            // SAFETY: cur is a free block on the list.
            cur = unsafe { (*cur).next };
        }
        // SAFETY: the caller guarantees these bytes are the allocator's again.
        unsafe { node.write(FreeNode { size, next: cur }) };
        if prev.is_null() {
            self.head.set(node);
        } else {
            // SAFETY: prev is a free block on the list.
            unsafe { (*prev).next = node };
        }

        if !cur.is_null() && node.addr() + size == cur.addr() {
            // SAFETY: node and cur are both free blocks on the list, and the
            // one ends exactly where the other starts.
            unsafe {
                (*node).size = size + (*cur).size;
                (*node).next = (*cur).next;
            }
        }
        if !prev.is_null() {
            // SAFETY: prev and node are both free blocks on the list.
            unsafe {
                if prev.addr() + (*prev).size == node.addr() {
                    (*prev).size += (*node).size;
                    (*prev).next = (*node).next;
                }
            }
        }
    }

    /// (blocks, total free bytes, largest free block)
    pub fn free_stats(&self) -> (usize, usize, usize) {
        let (mut n, mut total, mut largest) = (0, 0, 0);
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block on the list.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            n += 1;
            total += size;
            if size > largest {
                largest = size;
            }
            cur = next;
        }
        (n, total, largest)
    }

    /// Bytes ever carved off the end of the arena.
    pub fn used(&self) -> usize {
        self.bump.get()
    }
}
pub fn run() -> (usize, usize, usize) {
    let heap = Heap::new();
    let l = Layout::from_size_align(64, 8).unwrap();
    let a = heap.allocate(l);
    let b = heap.allocate(l);
    let c = heap.allocate(l);

    // SAFETY: each block came from this heap with `l` and is freed once.
    unsafe { heap.deallocate(a, l) };
    let (after_a, _, _) = heap.free_stats();
    // SAFETY: as above.
    unsafe { heap.deallocate(c, l) };
    let (after_c, _, _) = heap.free_stats();
    // SAFETY: as above.
    unsafe { heap.deallocate(b, l) };
    let (after_b, bytes, largest) = heap.free_stats();

    println!("freed the first block:  {after_a} free block");
    println!("freed the third block:  {after_c} free blocks, not neighbours");
    println!("freed the middle block: {after_b} free block of {bytes} bytes");
    println!("largest hole {largest}, arena carved {}", heap.used());
    (after_a, after_c, after_b)
}
```

@hint `+` is not defined between a pointer and an integer in Rust, on purpose. The methods that do it are named.
@hint What this line compares is two addresses, and there is a method that gives you the address of a pointer.
@hint `node.addr() + size == cur.addr()`.

@diagnose E0369
`cannot add usize to *mut FreeNode`.

C spells pointer arithmetic `p + n` and Rust does not, because the two
operations people write with that syntax are different. `add` moves a pointer by
whole elements and keeps its **provenance**, the compiler's record of which
object the pointer is allowed to reach. `addr` throws the provenance away and
returns a plain integer.

For a comparison you want the integer. Compare `node.addr() + size` with
`cur.addr()` and you are asking a question about numbers, which is always
allowed. Going the other way, from an integer back to a pointer, is where
provenance is lost for good, and it is why `usize as *mut T` is a smell in a
codebase that could have kept the pointer.

@diagnose E0308
`mismatched types: expected usize, found *mut FreeNode`.

Half the comparison is a number and the other half is still a pointer. Both
sides need `addr()`. It is worth being clear about what the merge is checking:
`node` starts at some address and is `size` bytes long, so the byte just past
its end is `node.addr() + size`. If that is exactly where `cur` begins, the two
blocks are neighbours with nothing between them, and one block of
`size + cur.size` bytes describes the same memory.

Address order is what makes the check possible at all. In an unsorted list you
would have to scan every node to find out whether anything ends where this
begins.

@after
The list now holds an invariant: no two blocks on it are adjacent. Every
insertion merges with both neighbours when it can, so a pair that could have
merged never survives to the next insertion. That is what makes the leak check in
stage eleven meaningful. Free every block and the list collapses to exactly one.

What coalescing does not fix. Allocate three 64 byte blocks, free the first and
the third, and 128 free bytes sit there unable to serve a 128 byte request,
because the middle block is in the way. That is external fragmentation, and no
allocator that promises an object keeps its address can eliminate it. Compacting
collectors can, by moving objects and rewriting every pointer to them, which is
exactly the bookkeeping Rust declines to do.

## 8. Size classes and a constant time pop

@kind fix
@concept size class

@expect E0507

Every allocation so far walks a list. Real programs ask for the same handful of
sizes over and over, so give each of the sixteen small sizes its own list and the
common case becomes a pop with no search and no split. The pop does not compile,
because a `Cell` cannot be moved out of an array.

```starter
use std::alloc::Layout;
use std::cell::{Cell, UnsafeCell};
use std::mem::MaybeUninit;
use std::ptr::null_mut;
/// Bytes in the arena. Fixed at compile time: an allocator has nobody to ask.
pub const ARENA: usize = 1 << 16;

/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;

/// Round `n` up to the next multiple of `align`, which must be a power of two.
pub const fn align_up(n: usize, align: usize) -> usize {
    (n + align - 1) & !(align - 1)
}
/// Blocks up to this size get their own free list.
pub const MAX_SMALL: usize = 256;

/// One class per 16 bytes: 16, 32, 48 ... 256.
pub const NCLASS: usize = MAX_SMALL / MAX_ALIGN;
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align).ok()?;
    Some((layout.size(), layout.align()))
}
#[repr(align(16))]
struct Store {
    bytes: [MaybeUninit<u8>; ARENA],
}

impl Store {
    const fn new() -> Self {
        Store { bytes: [MaybeUninit::uninit(); ARENA] }
    }
}
/// One pointer, moving forward. Nothing else.
pub struct Bump {
    buf: UnsafeCell<Store>,
    next: Cell<usize>,
}
impl Bump {
    pub fn new() -> Self {
        Bump { buf: UnsafeCell::new(Store::new()), next: Cell::new(0) }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a reference,
        // so it cannot invalidate a pointer already handed out.
        unsafe { &raw mut (*self.buf.get()).bytes as *mut u8 }
    }

    pub fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN {
            return null_mut();
        }
        let start = align_up(self.next.get(), layout.align());
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        if end > ARENA {
            return null_mut();
        }
        self.next.set(end);
        // SAFETY: end <= ARENA, so `start` is an offset inside the single
        // object `base` points at and the whole block is in bounds. The base is
        // 16-aligned and `start` is a multiple of layout.align(), so the result
        // has the alignment the caller asked for.
        unsafe { self.base().add(start) }
    }

    pub fn used(&self) -> usize {
        self.next.get()
    }

    pub fn remaining(&self) -> usize {
        ARENA - self.next.get()
    }

    /// Hand the whole arena back at once.
    ///
    /// Taking `&mut self` is what makes this safe: any slice handed out by
    /// `alloc_slice` borrows `&self`, so none can be alive here.
    pub fn reset(&mut self) {
        self.next.set(0);
    }

    /// Allocate `n` bytes and write `fill` into every one of them, so the
    /// result is a real `&mut [u8]` rather than a claim about garbage.
    pub fn alloc_slice(&self, n: usize, fill: u8) -> Option<&mut [u8]> {
        let p = self.alloc(Layout::from_size_align(n, 1).ok()?);
        if p.is_null() {
            return None;
        }
        // SAFETY: `p` starts `n` bytes that nothing else points at, because the
        // bump pointer only ever moves forward. `write_bytes` initialises all
        // of them, so afterwards the range really is a `[u8]`. The returned
        // lifetime is that of `&self`, so `reset`, which needs `&mut self`,
        // cannot run while this slice is alive.
        unsafe {
            std::ptr::write_bytes(p, fill, n);
            Some(std::slice::from_raw_parts_mut(p, n))
        }
    }

    /// # Safety
    /// `off` must be less than `ARENA` and that byte must have been written.
    pub unsafe fn read_byte(&self, off: usize) -> u8 {
        // SAFETY: the caller guarantees the byte is in range and initialised.
        unsafe {
            (self.base() as *const MaybeUninit<u8>)
                .add(off)
                .read()
                .assume_init()
        }
    }
}
/// The header of a free block, written into the block's own bytes.
#[repr(C)]
pub struct FreeNode {
    pub size: usize,
    pub next: *mut FreeNode,
}

pub const NODE: usize = std::mem::size_of::<FreeNode>();

/// No block is smaller than a node, or the list could not live inside it.
pub const MIN_BLOCK: usize = align_up(NODE, MAX_ALIGN);

/// What a request actually costs: rounded up so every block is 16-aligned and
/// big enough to hold a `FreeNode` once it is given back.
pub fn block_size(layout: &Layout) -> usize {
    align_up(layout.size().max(MIN_BLOCK), MAX_ALIGN)
}
/// Which quick list a block of this size belongs on, if any.
pub fn class_of(size: usize) -> Option<usize> {
    if size == 0 || size > MAX_SMALL {
        None
    } else {
        Some(size / MAX_ALIGN - 1)
    }
}
/// A free list threaded through the arena's own free bytes.
pub struct Heap {
    arena: UnsafeCell<Store>,
    bump: Cell<usize>,
    head: Cell<*mut FreeNode>,
    quick: [Cell<*mut FreeNode>; NCLASS],
}
impl Heap {
    pub fn new() -> Self {
        Heap {
            arena: UnsafeCell::new(Store::new()),
            bump: Cell::new(0),
            head: Cell::new(null_mut()),
            quick: [const { Cell::new(null_mut::<FreeNode>()) }; NCLASS],
        }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a
        // reference, so it invalidates no pointer already handed out.
        unsafe { &raw mut (*self.arena.get()).bytes as *mut u8 }
    }

    pub fn allocate(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN || layout.size() > ARENA {
            return null_mut();
        }
        let need = block_size(&layout);

        let mut p = self.pop_quick(need);
        if p.is_null() {
            p = self.pop_free(need);
        }
        if p.is_null() {
            p = self.carve(need);
        }
        p
    }

    /// # Safety
    /// `ptr` must be a block this heap returned from `allocate` with
    /// exactly this `layout`, and must not have been deallocated since.
    pub unsafe fn deallocate(&self, ptr: *mut u8, layout: Layout) {
        let size = block_size(&layout);
        let node = ptr as *mut FreeNode;
        if let Some(c) = class_of(size) {
            // SAFETY: the caller has handed the block back, so nothing
            // else points into it. It is `size` >= MIN_BLOCK bytes and
            // 16-aligned, room and alignment enough for a FreeNode.
            unsafe { node.write(FreeNode { size, next: self.quick[c].get() }) };
            self.quick[c].set(node);
        } else {
            // SAFETY: as above.
            unsafe { self.insert_free(node, size) };
        }
    }

    /// Take fresh bytes off the end of the arena. This is stage two, still.
    fn carve(&self, need: usize) -> *mut u8 {
        let start = self.bump.get();
        if need > ARENA - start {
            return null_mut();
        }
        self.bump.set(start + need);
        // SAFETY: start + need <= ARENA, so the block lies inside the arena and
        // `base` carries provenance over all of it.
        unsafe { self.base().add(start) }
    }

    /// First block big enough, split if the remainder can hold a node.
    fn pop_free(&self, need: usize) -> *mut u8 {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block in the arena, 16-aligned and at least
            // MIN_BLOCK bytes, so it holds the node deallocate wrote there.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            if size >= need {
                let replacement = if size - need >= MIN_BLOCK {
                    // SAFETY: need <= size, so this offset is still inside the
                    // block, and every block lies inside the arena.
                    let rem = unsafe { (cur as *mut u8).add(need) } as *mut FreeNode;
                    // SAFETY: the remainder is at least MIN_BLOCK bytes,
                    // 16-aligned, and is not handed out to anyone.
                    unsafe { rem.write(FreeNode { size: size - need, next }) };
                    rem
                } else {
                    next
                };
                if prev.is_null() {
                    self.head.set(replacement);
                } else {
                    // SAFETY: prev is a free block on the list.
                    unsafe { (*prev).next = replacement };
                }
                return cur as *mut u8;
            }
            prev = cur;
            cur = next;
        }
        null_mut()
    }

    /// A pop from the head of one size class. No search, no split.
    fn pop_quick(&self, need: usize) -> *mut u8 {
        let Some(c) = class_of(need) else {
            return null_mut();
        };
        let list = self.quick[c];
        let head = list.get();
        if head.is_null() {
            return null_mut();
        }
        // SAFETY: every node on quick[c] is a block of exactly `need` bytes in
        // the arena, 16-aligned and not handed out, holding the node that
        // deallocate wrote there.
        let next = unsafe { (*head).next };
        self.quick[c].set(next);
        head as *mut u8
    }

    /// # Safety
    /// `node` must point at `size` bytes of this arena that are not handed out
    /// and are on no list.
    unsafe fn insert_free(&self, node: *mut FreeNode, size: usize) {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() && cur.addr() < node.addr() {
            prev = cur;
            // SAFETY: cur is a free block on the list.
            cur = unsafe { (*cur).next };
        }
        // SAFETY: the caller guarantees these bytes are the allocator's again.
        unsafe { node.write(FreeNode { size, next: cur }) };
        if prev.is_null() {
            self.head.set(node);
        } else {
            // SAFETY: prev is a free block on the list.
            unsafe { (*prev).next = node };
        }

        if !cur.is_null() && node.addr() + size == cur.addr() {
            // SAFETY: node and cur are both free blocks on the list, and the
            // one ends exactly where the other starts.
            unsafe {
                (*node).size = size + (*cur).size;
                (*node).next = (*cur).next;
            }
        }
        if !prev.is_null() {
            // SAFETY: prev and node are both free blocks on the list.
            unsafe {
                if prev.addr() + (*prev).size == node.addr() {
                    (*prev).size += (*node).size;
                    (*prev).next = (*node).next;
                }
            }
        }
    }

    /// Return every quick list block to the main list, where it can merge.
    pub fn flush(&self) {
        for c in 0..NCLASS {
            let mut cur = self.quick[c].get();
            self.quick[c].set(null_mut());
            while !cur.is_null() {
                // SAFETY: cur is a free block on quick[c].
                let (size, next) = unsafe { ((*cur).size, (*cur).next) };
                // SAFETY: cur has just been taken off every list.
                unsafe { self.insert_free(cur, size) };
                cur = next;
            }
        }
    }

    /// (blocks, total free bytes, largest free block)
    pub fn free_stats(&self) -> (usize, usize, usize) {
        let (mut n, mut total, mut largest) = (0, 0, 0);
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block on the list.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            n += 1;
            total += size;
            if size > largest {
                largest = size;
            }
            cur = next;
        }
        (n, total, largest)
    }

    /// Bytes ever carved off the end of the arena.
    pub fn used(&self) -> usize {
        self.bump.get()
    }
}
pub fn run() -> (bool, usize, usize) {
    let heap = Heap::new();
    let l = Layout::from_size_align(48, 8).unwrap();

    let a = heap.allocate(l);
    // SAFETY: a came from this heap with l and is freed once.
    unsafe { heap.deallocate(a, l) };
    let b = heap.allocate(l);
    let straight_back = a == b;

    let mut held = Vec::new();
    for _ in 0..8 {
        held.push(heap.allocate(l));
    }
    for p in held {
        // SAFETY: each came from this heap with l and is freed once.
        unsafe { heap.deallocate(p, l) };
    }
    // SAFETY: as above.
    unsafe { heap.deallocate(b, l) };

    let (before, _, _) = heap.free_stats();
    heap.flush();
    let (after, bytes, _) = heap.free_stats();

    println!("freed and reallocated 48 bytes: same block again, {straight_back}");
    println!("nine blocks sitting on a size class: main list has {before} blocks");
    println!("after a flush: {after} block of {bytes} bytes");
    (straight_back, before, after)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_size_class_answers_without_searching() {
        let (straight_back, before, after) = run();
        assert!(straight_back);
        assert_eq!(before, 0, "small blocks never reached the main list");
        assert_eq!(after, 1);
    }

    #[test]
    fn a_class_is_last_in_first_out() {
        let heap = Heap::new();
        let l = Layout::from_size_align(48, 8).unwrap();
        let a = heap.allocate(l);
        let b = heap.allocate(l);
        // SAFETY: both came from this heap with l and are freed once.
        unsafe {
            heap.deallocate(a, l);
            heap.deallocate(b, l);
        }
        assert_eq!(heap.allocate(l), b);
        assert_eq!(heap.allocate(l), a);
    }

    #[test]
    fn flush_hands_the_classes_back() {
        let heap = Heap::new();
        let l = Layout::from_size_align(48, 8).unwrap();
        let ps: Vec<*mut u8> = (0..8).map(|_| heap.allocate(l)).collect();
        for p in ps {
            // SAFETY: each came from this heap with l and is freed once.
            unsafe { heap.deallocate(p, l) };
        }
        assert_eq!(heap.free_stats(), (0, 0, 0));
        heap.flush();
        assert_eq!(heap.free_stats(), (1, 384, 384));
        assert_eq!(heap.used(), 384);
    }

    #[test]
    fn a_block_too_big_for_a_class_still_coalesces() {
        let heap = Heap::new();
        let l = Layout::from_size_align(700, 8).unwrap();
        assert_eq!(class_of(block_size(&l)), None);
        let a = heap.allocate(l);
        let b = heap.allocate(l);
        // SAFETY: both came from this heap with l and are freed once.
        unsafe {
            heap.deallocate(a, l);
            heap.deallocate(b, l);
        }
        assert_eq!(heap.free_stats(), (1, 1408, 1408));
    }

    #[test]
    fn the_classes_cover_every_small_size() {
        assert_eq!(class_of(0), None);
        assert_eq!(class_of(16), Some(0));
        assert_eq!(class_of(MAX_SMALL), Some(NCLASS - 1));
        assert_eq!(class_of(MAX_SMALL + 16), None);
    }
}
```

```solution
use std::alloc::Layout;
use std::cell::{Cell, UnsafeCell};
use std::mem::MaybeUninit;
use std::ptr::null_mut;
/// Bytes in the arena. Fixed at compile time: an allocator has nobody to ask.
pub const ARENA: usize = 1 << 16;

/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;

/// Round `n` up to the next multiple of `align`, which must be a power of two.
pub const fn align_up(n: usize, align: usize) -> usize {
    (n + align - 1) & !(align - 1)
}
/// Blocks up to this size get their own free list.
pub const MAX_SMALL: usize = 256;

/// One class per 16 bytes: 16, 32, 48 ... 256.
pub const NCLASS: usize = MAX_SMALL / MAX_ALIGN;
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align).ok()?;
    Some((layout.size(), layout.align()))
}
#[repr(align(16))]
struct Store {
    bytes: [MaybeUninit<u8>; ARENA],
}

impl Store {
    const fn new() -> Self {
        Store { bytes: [MaybeUninit::uninit(); ARENA] }
    }
}
/// One pointer, moving forward. Nothing else.
pub struct Bump {
    buf: UnsafeCell<Store>,
    next: Cell<usize>,
}
impl Bump {
    pub fn new() -> Self {
        Bump { buf: UnsafeCell::new(Store::new()), next: Cell::new(0) }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a reference,
        // so it cannot invalidate a pointer already handed out.
        unsafe { &raw mut (*self.buf.get()).bytes as *mut u8 }
    }

    pub fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN {
            return null_mut();
        }
        let start = align_up(self.next.get(), layout.align());
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        if end > ARENA {
            return null_mut();
        }
        self.next.set(end);
        // SAFETY: end <= ARENA, so `start` is an offset inside the single
        // object `base` points at and the whole block is in bounds. The base is
        // 16-aligned and `start` is a multiple of layout.align(), so the result
        // has the alignment the caller asked for.
        unsafe { self.base().add(start) }
    }

    pub fn used(&self) -> usize {
        self.next.get()
    }

    pub fn remaining(&self) -> usize {
        ARENA - self.next.get()
    }

    /// Hand the whole arena back at once.
    ///
    /// Taking `&mut self` is what makes this safe: any slice handed out by
    /// `alloc_slice` borrows `&self`, so none can be alive here.
    pub fn reset(&mut self) {
        self.next.set(0);
    }

    /// Allocate `n` bytes and write `fill` into every one of them, so the
    /// result is a real `&mut [u8]` rather than a claim about garbage.
    pub fn alloc_slice(&self, n: usize, fill: u8) -> Option<&mut [u8]> {
        let p = self.alloc(Layout::from_size_align(n, 1).ok()?);
        if p.is_null() {
            return None;
        }
        // SAFETY: `p` starts `n` bytes that nothing else points at, because the
        // bump pointer only ever moves forward. `write_bytes` initialises all
        // of them, so afterwards the range really is a `[u8]`. The returned
        // lifetime is that of `&self`, so `reset`, which needs `&mut self`,
        // cannot run while this slice is alive.
        unsafe {
            std::ptr::write_bytes(p, fill, n);
            Some(std::slice::from_raw_parts_mut(p, n))
        }
    }

    /// # Safety
    /// `off` must be less than `ARENA` and that byte must have been written.
    pub unsafe fn read_byte(&self, off: usize) -> u8 {
        // SAFETY: the caller guarantees the byte is in range and initialised.
        unsafe {
            (self.base() as *const MaybeUninit<u8>)
                .add(off)
                .read()
                .assume_init()
        }
    }
}
/// The header of a free block, written into the block's own bytes.
#[repr(C)]
pub struct FreeNode {
    pub size: usize,
    pub next: *mut FreeNode,
}

pub const NODE: usize = std::mem::size_of::<FreeNode>();

/// No block is smaller than a node, or the list could not live inside it.
pub const MIN_BLOCK: usize = align_up(NODE, MAX_ALIGN);

/// What a request actually costs: rounded up so every block is 16-aligned and
/// big enough to hold a `FreeNode` once it is given back.
pub fn block_size(layout: &Layout) -> usize {
    align_up(layout.size().max(MIN_BLOCK), MAX_ALIGN)
}
/// Which quick list a block of this size belongs on, if any.
pub fn class_of(size: usize) -> Option<usize> {
    if size == 0 || size > MAX_SMALL {
        None
    } else {
        Some(size / MAX_ALIGN - 1)
    }
}
/// A free list threaded through the arena's own free bytes.
pub struct Heap {
    arena: UnsafeCell<Store>,
    bump: Cell<usize>,
    head: Cell<*mut FreeNode>,
    quick: [Cell<*mut FreeNode>; NCLASS],
}
impl Heap {
    pub fn new() -> Self {
        Heap {
            arena: UnsafeCell::new(Store::new()),
            bump: Cell::new(0),
            head: Cell::new(null_mut()),
            quick: [const { Cell::new(null_mut::<FreeNode>()) }; NCLASS],
        }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a
        // reference, so it invalidates no pointer already handed out.
        unsafe { &raw mut (*self.arena.get()).bytes as *mut u8 }
    }

    pub fn allocate(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN || layout.size() > ARENA {
            return null_mut();
        }
        let need = block_size(&layout);

        let mut p = self.pop_quick(need);
        if p.is_null() {
            p = self.pop_free(need);
        }
        if p.is_null() {
            p = self.carve(need);
        }
        p
    }

    /// # Safety
    /// `ptr` must be a block this heap returned from `allocate` with
    /// exactly this `layout`, and must not have been deallocated since.
    pub unsafe fn deallocate(&self, ptr: *mut u8, layout: Layout) {
        let size = block_size(&layout);
        let node = ptr as *mut FreeNode;
        if let Some(c) = class_of(size) {
            // SAFETY: the caller has handed the block back, so nothing
            // else points into it. It is `size` >= MIN_BLOCK bytes and
            // 16-aligned, room and alignment enough for a FreeNode.
            unsafe { node.write(FreeNode { size, next: self.quick[c].get() }) };
            self.quick[c].set(node);
        } else {
            // SAFETY: as above.
            unsafe { self.insert_free(node, size) };
        }
    }

    /// Take fresh bytes off the end of the arena. This is stage two, still.
    fn carve(&self, need: usize) -> *mut u8 {
        let start = self.bump.get();
        if need > ARENA - start {
            return null_mut();
        }
        self.bump.set(start + need);
        // SAFETY: start + need <= ARENA, so the block lies inside the arena and
        // `base` carries provenance over all of it.
        unsafe { self.base().add(start) }
    }

    /// First block big enough, split if the remainder can hold a node.
    fn pop_free(&self, need: usize) -> *mut u8 {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block in the arena, 16-aligned and at least
            // MIN_BLOCK bytes, so it holds the node deallocate wrote there.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            if size >= need {
                let replacement = if size - need >= MIN_BLOCK {
                    // SAFETY: need <= size, so this offset is still inside the
                    // block, and every block lies inside the arena.
                    let rem = unsafe { (cur as *mut u8).add(need) } as *mut FreeNode;
                    // SAFETY: the remainder is at least MIN_BLOCK bytes,
                    // 16-aligned, and is not handed out to anyone.
                    unsafe { rem.write(FreeNode { size: size - need, next }) };
                    rem
                } else {
                    next
                };
                if prev.is_null() {
                    self.head.set(replacement);
                } else {
                    // SAFETY: prev is a free block on the list.
                    unsafe { (*prev).next = replacement };
                }
                return cur as *mut u8;
            }
            prev = cur;
            cur = next;
        }
        null_mut()
    }

    /// A pop from the head of one size class. No search, no split.
    fn pop_quick(&self, need: usize) -> *mut u8 {
        let Some(c) = class_of(need) else {
            return null_mut();
        };
        let head = self.quick[c].get();
        if head.is_null() {
            return null_mut();
        }
        // SAFETY: every node on quick[c] is a block of exactly `need` bytes in
        // the arena, 16-aligned and not handed out, holding the node that
        // deallocate wrote there.
        let next = unsafe { (*head).next };
        self.quick[c].set(next);
        head as *mut u8
    }

    /// # Safety
    /// `node` must point at `size` bytes of this arena that are not handed out
    /// and are on no list.
    unsafe fn insert_free(&self, node: *mut FreeNode, size: usize) {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() && cur.addr() < node.addr() {
            prev = cur;
            // SAFETY: cur is a free block on the list.
            cur = unsafe { (*cur).next };
        }
        // SAFETY: the caller guarantees these bytes are the allocator's again.
        unsafe { node.write(FreeNode { size, next: cur }) };
        if prev.is_null() {
            self.head.set(node);
        } else {
            // SAFETY: prev is a free block on the list.
            unsafe { (*prev).next = node };
        }

        if !cur.is_null() && node.addr() + size == cur.addr() {
            // SAFETY: node and cur are both free blocks on the list, and the
            // one ends exactly where the other starts.
            unsafe {
                (*node).size = size + (*cur).size;
                (*node).next = (*cur).next;
            }
        }
        if !prev.is_null() {
            // SAFETY: prev and node are both free blocks on the list.
            unsafe {
                if prev.addr() + (*prev).size == node.addr() {
                    (*prev).size += (*node).size;
                    (*prev).next = (*node).next;
                }
            }
        }
    }

    /// Return every quick list block to the main list, where it can merge.
    pub fn flush(&self) {
        for c in 0..NCLASS {
            let mut cur = self.quick[c].get();
            self.quick[c].set(null_mut());
            while !cur.is_null() {
                // SAFETY: cur is a free block on quick[c].
                let (size, next) = unsafe { ((*cur).size, (*cur).next) };
                // SAFETY: cur has just been taken off every list.
                unsafe { self.insert_free(cur, size) };
                cur = next;
            }
        }
    }

    /// (blocks, total free bytes, largest free block)
    pub fn free_stats(&self) -> (usize, usize, usize) {
        let (mut n, mut total, mut largest) = (0, 0, 0);
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block on the list.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            n += 1;
            total += size;
            if size > largest {
                largest = size;
            }
            cur = next;
        }
        (n, total, largest)
    }

    /// Bytes ever carved off the end of the arena.
    pub fn used(&self) -> usize {
        self.bump.get()
    }
}
pub fn run() -> (bool, usize, usize) {
    let heap = Heap::new();
    let l = Layout::from_size_align(48, 8).unwrap();

    let a = heap.allocate(l);
    // SAFETY: a came from this heap with l and is freed once.
    unsafe { heap.deallocate(a, l) };
    let b = heap.allocate(l);
    let straight_back = a == b;

    let mut held = Vec::new();
    for _ in 0..8 {
        held.push(heap.allocate(l));
    }
    for p in held {
        // SAFETY: each came from this heap with l and is freed once.
        unsafe { heap.deallocate(p, l) };
    }
    // SAFETY: as above.
    unsafe { heap.deallocate(b, l) };

    let (before, _, _) = heap.free_stats();
    heap.flush();
    let (after, bytes, _) = heap.free_stats();

    println!("freed and reallocated 48 bytes: same block again, {straight_back}");
    println!("nine blocks sitting on a size class: main list has {before} blocks");
    println!("after a flush: {after} block of {bytes} bytes");
    (straight_back, before, after)
}
```

@hint `self.quick[c]` indexes an array reached through `&self`. Ask what that expression produces and whether you are allowed to take it.
@hint You do not need to own the `Cell`. You only need to call one method on it.
@hint Index and call in one expression: `self.quick[c].get()`.

@diagnose E0507
`cannot move out of self.quick[_] which is behind a shared reference`.

Indexing produces a place, and binding that place to a variable moves the value
out of it unless the type is `Copy`. `Cell<*mut FreeNode>` is not `Copy`, and it
would be a strange thing to copy anyway: the point of a `Cell` is that it is a
box in a fixed location that other code can see.

`self.quick[c].get()` never binds the cell at all. It calls a method on the
place, and `get` takes `&self`, which is available here. If you wanted the
binding for readability, `let list = &self.quick[c];` gives you a reference and
compiles for the same reason.

@diagnose E0277
`the trait Copy is not implemented for Cell<*mut FreeNode>`, in a repeat
expression like `[Cell::new(null_mut()); NCLASS]`.

That syntax builds an array by copying one value, so the element type has to be
`Copy`. `Cell` never is. The form that works is an inline const block,
`[const { Cell::new(null_mut::<FreeNode>()) }; NCLASS]`, which evaluates the
expression once per element at compile time rather than copying it.

`std::array::from_fn(|_| Cell::new(null_mut()))` is the runtime equivalent and
reads more clearly for anything non trivial. The turbofish on `null_mut` is
there because nothing else in a const block tells the compiler which pointee
type you meant.

@after
Allocation for a small block is now three loads and two stores, with no loop.
That is the shape every production allocator has: tcmalloc and jemalloc both keep
per thread caches of fixed size classes and only fall through to the general
allocator when a cache is empty. The class boundaries here are every sixteen
bytes to 256, which is crude. jemalloc spaces its classes so the worst case
internal waste stays near twenty percent.

`flush` exists because a block sitting on a quick list is invisible to
coalescing. Free ten thousand 48 byte blocks and the arena is full of holes that
cannot merge, so a later request for a large block fails while plenty of memory
is free. Delayed coalescing is the price of the constant time pop, and every
allocator that takes the deal also ships a way to pay it back.

## 9. Implementing GlobalAlloc

@kind fix
@concept globalalloc

@expect E0200

Two methods and Rust will route every `Box`, `Vec` and `String` through this
heap. Both are stubbed, and the impl block itself is missing a keyword. The
trait is unsafe to implement, which is a statement about what the rest of the
language is entitled to assume about your code.

```starter
use std::alloc::{GlobalAlloc, Layout};
use std::cell::{Cell, UnsafeCell};
use std::mem::MaybeUninit;
use std::ptr::null_mut;
/// Bytes in the arena. Fixed at compile time: an allocator has nobody to ask.
pub const ARENA: usize = 1 << 16;

/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;

/// Round `n` up to the next multiple of `align`, which must be a power of two.
pub const fn align_up(n: usize, align: usize) -> usize {
    (n + align - 1) & !(align - 1)
}
/// Blocks up to this size get their own free list.
pub const MAX_SMALL: usize = 256;

/// One class per 16 bytes: 16, 32, 48 ... 256.
pub const NCLASS: usize = MAX_SMALL / MAX_ALIGN;
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align).ok()?;
    Some((layout.size(), layout.align()))
}
#[repr(align(16))]
struct Store {
    bytes: [MaybeUninit<u8>; ARENA],
}

impl Store {
    const fn new() -> Self {
        Store { bytes: [MaybeUninit::uninit(); ARENA] }
    }
}
/// One pointer, moving forward. Nothing else.
pub struct Bump {
    buf: UnsafeCell<Store>,
    next: Cell<usize>,
}
impl Bump {
    pub fn new() -> Self {
        Bump { buf: UnsafeCell::new(Store::new()), next: Cell::new(0) }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a reference,
        // so it cannot invalidate a pointer already handed out.
        unsafe { &raw mut (*self.buf.get()).bytes as *mut u8 }
    }

    pub fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN {
            return null_mut();
        }
        let start = align_up(self.next.get(), layout.align());
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        if end > ARENA {
            return null_mut();
        }
        self.next.set(end);
        // SAFETY: end <= ARENA, so `start` is an offset inside the single
        // object `base` points at and the whole block is in bounds. The base is
        // 16-aligned and `start` is a multiple of layout.align(), so the result
        // has the alignment the caller asked for.
        unsafe { self.base().add(start) }
    }

    pub fn used(&self) -> usize {
        self.next.get()
    }

    pub fn remaining(&self) -> usize {
        ARENA - self.next.get()
    }

    /// Hand the whole arena back at once.
    ///
    /// Taking `&mut self` is what makes this safe: any slice handed out by
    /// `alloc_slice` borrows `&self`, so none can be alive here.
    pub fn reset(&mut self) {
        self.next.set(0);
    }

    /// Allocate `n` bytes and write `fill` into every one of them, so the
    /// result is a real `&mut [u8]` rather than a claim about garbage.
    pub fn alloc_slice(&self, n: usize, fill: u8) -> Option<&mut [u8]> {
        let p = self.alloc(Layout::from_size_align(n, 1).ok()?);
        if p.is_null() {
            return None;
        }
        // SAFETY: `p` starts `n` bytes that nothing else points at, because the
        // bump pointer only ever moves forward. `write_bytes` initialises all
        // of them, so afterwards the range really is a `[u8]`. The returned
        // lifetime is that of `&self`, so `reset`, which needs `&mut self`,
        // cannot run while this slice is alive.
        unsafe {
            std::ptr::write_bytes(p, fill, n);
            Some(std::slice::from_raw_parts_mut(p, n))
        }
    }

    /// # Safety
    /// `off` must be less than `ARENA` and that byte must have been written.
    pub unsafe fn read_byte(&self, off: usize) -> u8 {
        // SAFETY: the caller guarantees the byte is in range and initialised.
        unsafe {
            (self.base() as *const MaybeUninit<u8>)
                .add(off)
                .read()
                .assume_init()
        }
    }
}
/// The header of a free block, written into the block's own bytes.
#[repr(C)]
pub struct FreeNode {
    pub size: usize,
    pub next: *mut FreeNode,
}

pub const NODE: usize = std::mem::size_of::<FreeNode>();

/// No block is smaller than a node, or the list could not live inside it.
pub const MIN_BLOCK: usize = align_up(NODE, MAX_ALIGN);

/// What a request actually costs: rounded up so every block is 16-aligned and
/// big enough to hold a `FreeNode` once it is given back.
pub fn block_size(layout: &Layout) -> usize {
    align_up(layout.size().max(MIN_BLOCK), MAX_ALIGN)
}
/// Which quick list a block of this size belongs on, if any.
pub fn class_of(size: usize) -> Option<usize> {
    if size == 0 || size > MAX_SMALL {
        None
    } else {
        Some(size / MAX_ALIGN - 1)
    }
}
/// A free list threaded through the arena's own free bytes.
pub struct Heap {
    arena: UnsafeCell<Store>,
    bump: Cell<usize>,
    head: Cell<*mut FreeNode>,
    quick: [Cell<*mut FreeNode>; NCLASS],
}
impl Heap {
    pub fn new() -> Self {
        Heap {
            arena: UnsafeCell::new(Store::new()),
            bump: Cell::new(0),
            head: Cell::new(null_mut()),
            quick: [const { Cell::new(null_mut::<FreeNode>()) }; NCLASS],
        }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a
        // reference, so it invalidates no pointer already handed out.
        unsafe { &raw mut (*self.arena.get()).bytes as *mut u8 }
    }

    pub fn allocate(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN || layout.size() > ARENA {
            return null_mut();
        }
        let need = block_size(&layout);

        let mut p = self.pop_quick(need);
        if p.is_null() {
            p = self.pop_free(need);
        }
        if p.is_null() {
            p = self.carve(need);
        }
        p
    }

    /// # Safety
    /// `ptr` must be a block this heap returned from `allocate` with
    /// exactly this `layout`, and must not have been deallocated since.
    pub unsafe fn deallocate(&self, ptr: *mut u8, layout: Layout) {
        let size = block_size(&layout);
        let node = ptr as *mut FreeNode;
        if let Some(c) = class_of(size) {
            // SAFETY: the caller has handed the block back, so nothing
            // else points into it. It is `size` >= MIN_BLOCK bytes and
            // 16-aligned, room and alignment enough for a FreeNode.
            unsafe { node.write(FreeNode { size, next: self.quick[c].get() }) };
            self.quick[c].set(node);
        } else {
            // SAFETY: as above.
            unsafe { self.insert_free(node, size) };
        }
    }

    /// Take fresh bytes off the end of the arena. This is stage two, still.
    fn carve(&self, need: usize) -> *mut u8 {
        let start = self.bump.get();
        if need > ARENA - start {
            return null_mut();
        }
        self.bump.set(start + need);
        // SAFETY: start + need <= ARENA, so the block lies inside the arena and
        // `base` carries provenance over all of it.
        unsafe { self.base().add(start) }
    }

    /// First block big enough, split if the remainder can hold a node.
    fn pop_free(&self, need: usize) -> *mut u8 {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block in the arena, 16-aligned and at least
            // MIN_BLOCK bytes, so it holds the node deallocate wrote there.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            if size >= need {
                let replacement = if size - need >= MIN_BLOCK {
                    // SAFETY: need <= size, so this offset is still inside the
                    // block, and every block lies inside the arena.
                    let rem = unsafe { (cur as *mut u8).add(need) } as *mut FreeNode;
                    // SAFETY: the remainder is at least MIN_BLOCK bytes,
                    // 16-aligned, and is not handed out to anyone.
                    unsafe { rem.write(FreeNode { size: size - need, next }) };
                    rem
                } else {
                    next
                };
                if prev.is_null() {
                    self.head.set(replacement);
                } else {
                    // SAFETY: prev is a free block on the list.
                    unsafe { (*prev).next = replacement };
                }
                return cur as *mut u8;
            }
            prev = cur;
            cur = next;
        }
        null_mut()
    }

    /// A pop from the head of one size class. No search, no split.
    fn pop_quick(&self, need: usize) -> *mut u8 {
        let Some(c) = class_of(need) else {
            return null_mut();
        };
        let head = self.quick[c].get();
        if head.is_null() {
            return null_mut();
        }
        // SAFETY: every node on quick[c] is a block of exactly `need` bytes in
        // the arena, 16-aligned and not handed out, holding the node that
        // deallocate wrote there.
        let next = unsafe { (*head).next };
        self.quick[c].set(next);
        head as *mut u8
    }

    /// # Safety
    /// `node` must point at `size` bytes of this arena that are not handed out
    /// and are on no list.
    unsafe fn insert_free(&self, node: *mut FreeNode, size: usize) {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() && cur.addr() < node.addr() {
            prev = cur;
            // SAFETY: cur is a free block on the list.
            cur = unsafe { (*cur).next };
        }
        // SAFETY: the caller guarantees these bytes are the allocator's again.
        unsafe { node.write(FreeNode { size, next: cur }) };
        if prev.is_null() {
            self.head.set(node);
        } else {
            // SAFETY: prev is a free block on the list.
            unsafe { (*prev).next = node };
        }

        if !cur.is_null() && node.addr() + size == cur.addr() {
            // SAFETY: node and cur are both free blocks on the list, and the
            // one ends exactly where the other starts.
            unsafe {
                (*node).size = size + (*cur).size;
                (*node).next = (*cur).next;
            }
        }
        if !prev.is_null() {
            // SAFETY: prev and node are both free blocks on the list.
            unsafe {
                if prev.addr() + (*prev).size == node.addr() {
                    (*prev).size += (*node).size;
                    (*prev).next = (*node).next;
                }
            }
        }
    }

    /// Return every quick list block to the main list, where it can merge.
    pub fn flush(&self) {
        for c in 0..NCLASS {
            let mut cur = self.quick[c].get();
            self.quick[c].set(null_mut());
            while !cur.is_null() {
                // SAFETY: cur is a free block on quick[c].
                let (size, next) = unsafe { ((*cur).size, (*cur).next) };
                // SAFETY: cur has just been taken off every list.
                unsafe { self.insert_free(cur, size) };
                cur = next;
            }
        }
    }

    /// (blocks, total free bytes, largest free block)
    pub fn free_stats(&self) -> (usize, usize, usize) {
        let (mut n, mut total, mut largest) = (0, 0, 0);
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block on the list.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            n += 1;
            total += size;
            if size > largest {
                largest = size;
            }
            cur = next;
        }
        (n, total, largest)
    }

    /// Bytes ever carved off the end of the arena.
    pub fn used(&self) -> usize {
        self.bump.get()
    }
}
impl GlobalAlloc for Heap {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        todo!("what does this allocator already do?")
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        todo!("and what does the caller of dealloc already owe you?")
    }
}
pub fn run() -> ([u32; 4], bool) {
    let heap = Heap::new();
    let layout = Layout::new::<[u32; 4]>();

    // SAFETY: the layout has non-zero size, which is what alloc requires.
    let p = unsafe { heap.alloc(layout) } as *mut [u32; 4];
    assert!(!p.is_null());

    // SAFETY: p owns 16 bytes at align 4 and nothing else points at them.
    let got = unsafe {
        p.write([9, 8, 7, 6]);
        p.read()
    };

    // SAFETY: p came from this allocator with exactly this layout.
    unsafe { heap.dealloc(p as *mut u8, layout) };

    let odd = Layout::from_size_align(32, 64).unwrap();
    // SAFETY: the layout has non-zero size.
    let refused = unsafe { heap.alloc(odd) }.is_null();

    println!("[u32; 4] wants {} bytes at align {}", layout.size(), layout.align());
    println!("read back {got:?}");
    println!("align 64 is more than this allocator serves, so it returned null: {refused}");
    (got, refused)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_trait_hands_out_memory_you_can_use() {
        let (got, refused) = run();
        assert_eq!(got, [9, 8, 7, 6]);
        assert!(refused);
    }

    #[test]
    fn what_alloc_returns_meets_the_layout() {
        let heap = Heap::new();
        for &(size, align) in &[(1usize, 1usize), (7, 8), (32, 16), (700, 8)] {
            let l = Layout::from_size_align(size, align).unwrap();
            // SAFETY: every layout here has non-zero size.
            let p = unsafe { heap.alloc(l) };
            assert!(!p.is_null());
            assert_eq!(p.addr() % align, 0);
            // SAFETY: p owns `size` bytes.
            unsafe { std::ptr::write_bytes(p, 0x5A, size) };
            // SAFETY: p came from this allocator with exactly l.
            unsafe { heap.dealloc(p, l) };
        }
    }

    #[test]
    fn alloc_zeroed_is_zeroed_even_over_dirty_bytes() {
        let heap = Heap::new();
        let l = Layout::from_size_align(64, 8).unwrap();
        // SAFETY: the layout has non-zero size.
        let dirty = unsafe { heap.alloc(l) };
        // SAFETY: dirty owns 64 bytes.
        unsafe { std::ptr::write_bytes(dirty, 0xFF, 64) };
        // SAFETY: dirty came from this allocator with l.
        unsafe { heap.dealloc(dirty, l) };

        // SAFETY: the layout has non-zero size.
        let p = unsafe { heap.alloc_zeroed(l) };
        assert_eq!(p, dirty, "it should be the same block back");
        // SAFETY: alloc_zeroed initialised all 64 bytes.
        let bytes = unsafe { std::slice::from_raw_parts(p, 64) };
        assert!(bytes.iter().all(|&b| b == 0));
        // SAFETY: p came from this allocator with l.
        unsafe { heap.dealloc(p, l) };
    }

    #[test]
    fn a_full_arena_returns_null_rather_than_panicking() {
        let heap = Heap::new();
        let l = Layout::from_size_align(ARENA, 8).unwrap();
        // SAFETY: the layout has non-zero size.
        assert!(!unsafe { heap.alloc(l) }.is_null());
        // SAFETY: the layout has non-zero size.
        assert!(unsafe { heap.alloc(Layout::new::<u8>()) }.is_null());
    }
}
```

```solution
use std::alloc::{GlobalAlloc, Layout};
use std::cell::{Cell, UnsafeCell};
use std::mem::MaybeUninit;
use std::ptr::null_mut;
/// Bytes in the arena. Fixed at compile time: an allocator has nobody to ask.
pub const ARENA: usize = 1 << 16;

/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;

/// Round `n` up to the next multiple of `align`, which must be a power of two.
pub const fn align_up(n: usize, align: usize) -> usize {
    (n + align - 1) & !(align - 1)
}
/// Blocks up to this size get their own free list.
pub const MAX_SMALL: usize = 256;

/// One class per 16 bytes: 16, 32, 48 ... 256.
pub const NCLASS: usize = MAX_SMALL / MAX_ALIGN;
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align).ok()?;
    Some((layout.size(), layout.align()))
}
#[repr(align(16))]
struct Store {
    bytes: [MaybeUninit<u8>; ARENA],
}

impl Store {
    const fn new() -> Self {
        Store { bytes: [MaybeUninit::uninit(); ARENA] }
    }
}
/// One pointer, moving forward. Nothing else.
pub struct Bump {
    buf: UnsafeCell<Store>,
    next: Cell<usize>,
}
impl Bump {
    pub fn new() -> Self {
        Bump { buf: UnsafeCell::new(Store::new()), next: Cell::new(0) }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a reference,
        // so it cannot invalidate a pointer already handed out.
        unsafe { &raw mut (*self.buf.get()).bytes as *mut u8 }
    }

    pub fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN {
            return null_mut();
        }
        let start = align_up(self.next.get(), layout.align());
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        if end > ARENA {
            return null_mut();
        }
        self.next.set(end);
        // SAFETY: end <= ARENA, so `start` is an offset inside the single
        // object `base` points at and the whole block is in bounds. The base is
        // 16-aligned and `start` is a multiple of layout.align(), so the result
        // has the alignment the caller asked for.
        unsafe { self.base().add(start) }
    }

    pub fn used(&self) -> usize {
        self.next.get()
    }

    pub fn remaining(&self) -> usize {
        ARENA - self.next.get()
    }

    /// Hand the whole arena back at once.
    ///
    /// Taking `&mut self` is what makes this safe: any slice handed out by
    /// `alloc_slice` borrows `&self`, so none can be alive here.
    pub fn reset(&mut self) {
        self.next.set(0);
    }

    /// Allocate `n` bytes and write `fill` into every one of them, so the
    /// result is a real `&mut [u8]` rather than a claim about garbage.
    pub fn alloc_slice(&self, n: usize, fill: u8) -> Option<&mut [u8]> {
        let p = self.alloc(Layout::from_size_align(n, 1).ok()?);
        if p.is_null() {
            return None;
        }
        // SAFETY: `p` starts `n` bytes that nothing else points at, because the
        // bump pointer only ever moves forward. `write_bytes` initialises all
        // of them, so afterwards the range really is a `[u8]`. The returned
        // lifetime is that of `&self`, so `reset`, which needs `&mut self`,
        // cannot run while this slice is alive.
        unsafe {
            std::ptr::write_bytes(p, fill, n);
            Some(std::slice::from_raw_parts_mut(p, n))
        }
    }

    /// # Safety
    /// `off` must be less than `ARENA` and that byte must have been written.
    pub unsafe fn read_byte(&self, off: usize) -> u8 {
        // SAFETY: the caller guarantees the byte is in range and initialised.
        unsafe {
            (self.base() as *const MaybeUninit<u8>)
                .add(off)
                .read()
                .assume_init()
        }
    }
}
/// The header of a free block, written into the block's own bytes.
#[repr(C)]
pub struct FreeNode {
    pub size: usize,
    pub next: *mut FreeNode,
}

pub const NODE: usize = std::mem::size_of::<FreeNode>();

/// No block is smaller than a node, or the list could not live inside it.
pub const MIN_BLOCK: usize = align_up(NODE, MAX_ALIGN);

/// What a request actually costs: rounded up so every block is 16-aligned and
/// big enough to hold a `FreeNode` once it is given back.
pub fn block_size(layout: &Layout) -> usize {
    align_up(layout.size().max(MIN_BLOCK), MAX_ALIGN)
}
/// Which quick list a block of this size belongs on, if any.
pub fn class_of(size: usize) -> Option<usize> {
    if size == 0 || size > MAX_SMALL {
        None
    } else {
        Some(size / MAX_ALIGN - 1)
    }
}
/// A free list threaded through the arena's own free bytes.
pub struct Heap {
    arena: UnsafeCell<Store>,
    bump: Cell<usize>,
    head: Cell<*mut FreeNode>,
    quick: [Cell<*mut FreeNode>; NCLASS],
}
impl Heap {
    pub fn new() -> Self {
        Heap {
            arena: UnsafeCell::new(Store::new()),
            bump: Cell::new(0),
            head: Cell::new(null_mut()),
            quick: [const { Cell::new(null_mut::<FreeNode>()) }; NCLASS],
        }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a
        // reference, so it invalidates no pointer already handed out.
        unsafe { &raw mut (*self.arena.get()).bytes as *mut u8 }
    }

    pub fn allocate(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN || layout.size() > ARENA {
            return null_mut();
        }
        let need = block_size(&layout);

        let mut p = self.pop_quick(need);
        if p.is_null() {
            p = self.pop_free(need);
        }
        if p.is_null() {
            p = self.carve(need);
        }
        p
    }

    /// # Safety
    /// `ptr` must be a block this heap returned from `allocate` with
    /// exactly this `layout`, and must not have been deallocated since.
    pub unsafe fn deallocate(&self, ptr: *mut u8, layout: Layout) {
        let size = block_size(&layout);
        let node = ptr as *mut FreeNode;
        if let Some(c) = class_of(size) {
            // SAFETY: the caller has handed the block back, so nothing
            // else points into it. It is `size` >= MIN_BLOCK bytes and
            // 16-aligned, room and alignment enough for a FreeNode.
            unsafe { node.write(FreeNode { size, next: self.quick[c].get() }) };
            self.quick[c].set(node);
        } else {
            // SAFETY: as above.
            unsafe { self.insert_free(node, size) };
        }
    }

    /// Take fresh bytes off the end of the arena. This is stage two, still.
    fn carve(&self, need: usize) -> *mut u8 {
        let start = self.bump.get();
        if need > ARENA - start {
            return null_mut();
        }
        self.bump.set(start + need);
        // SAFETY: start + need <= ARENA, so the block lies inside the arena and
        // `base` carries provenance over all of it.
        unsafe { self.base().add(start) }
    }

    /// First block big enough, split if the remainder can hold a node.
    fn pop_free(&self, need: usize) -> *mut u8 {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block in the arena, 16-aligned and at least
            // MIN_BLOCK bytes, so it holds the node deallocate wrote there.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            if size >= need {
                let replacement = if size - need >= MIN_BLOCK {
                    // SAFETY: need <= size, so this offset is still inside the
                    // block, and every block lies inside the arena.
                    let rem = unsafe { (cur as *mut u8).add(need) } as *mut FreeNode;
                    // SAFETY: the remainder is at least MIN_BLOCK bytes,
                    // 16-aligned, and is not handed out to anyone.
                    unsafe { rem.write(FreeNode { size: size - need, next }) };
                    rem
                } else {
                    next
                };
                if prev.is_null() {
                    self.head.set(replacement);
                } else {
                    // SAFETY: prev is a free block on the list.
                    unsafe { (*prev).next = replacement };
                }
                return cur as *mut u8;
            }
            prev = cur;
            cur = next;
        }
        null_mut()
    }

    /// A pop from the head of one size class. No search, no split.
    fn pop_quick(&self, need: usize) -> *mut u8 {
        let Some(c) = class_of(need) else {
            return null_mut();
        };
        let head = self.quick[c].get();
        if head.is_null() {
            return null_mut();
        }
        // SAFETY: every node on quick[c] is a block of exactly `need` bytes in
        // the arena, 16-aligned and not handed out, holding the node that
        // deallocate wrote there.
        let next = unsafe { (*head).next };
        self.quick[c].set(next);
        head as *mut u8
    }

    /// # Safety
    /// `node` must point at `size` bytes of this arena that are not handed out
    /// and are on no list.
    unsafe fn insert_free(&self, node: *mut FreeNode, size: usize) {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() && cur.addr() < node.addr() {
            prev = cur;
            // SAFETY: cur is a free block on the list.
            cur = unsafe { (*cur).next };
        }
        // SAFETY: the caller guarantees these bytes are the allocator's again.
        unsafe { node.write(FreeNode { size, next: cur }) };
        if prev.is_null() {
            self.head.set(node);
        } else {
            // SAFETY: prev is a free block on the list.
            unsafe { (*prev).next = node };
        }

        if !cur.is_null() && node.addr() + size == cur.addr() {
            // SAFETY: node and cur are both free blocks on the list, and the
            // one ends exactly where the other starts.
            unsafe {
                (*node).size = size + (*cur).size;
                (*node).next = (*cur).next;
            }
        }
        if !prev.is_null() {
            // SAFETY: prev and node are both free blocks on the list.
            unsafe {
                if prev.addr() + (*prev).size == node.addr() {
                    (*prev).size += (*node).size;
                    (*prev).next = (*node).next;
                }
            }
        }
    }

    /// Return every quick list block to the main list, where it can merge.
    pub fn flush(&self) {
        for c in 0..NCLASS {
            let mut cur = self.quick[c].get();
            self.quick[c].set(null_mut());
            while !cur.is_null() {
                // SAFETY: cur is a free block on quick[c].
                let (size, next) = unsafe { ((*cur).size, (*cur).next) };
                // SAFETY: cur has just been taken off every list.
                unsafe { self.insert_free(cur, size) };
                cur = next;
            }
        }
    }

    /// (blocks, total free bytes, largest free block)
    pub fn free_stats(&self) -> (usize, usize, usize) {
        let (mut n, mut total, mut largest) = (0, 0, 0);
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block on the list.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            n += 1;
            total += size;
            if size > largest {
                largest = size;
            }
            cur = next;
        }
        (n, total, largest)
    }

    /// Bytes ever carved off the end of the arena.
    pub fn used(&self) -> usize {
        self.bump.get()
    }
}
unsafe impl GlobalAlloc for Heap {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        self.allocate(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // SAFETY: `dealloc`'s contract on the caller is word for word
        // `deallocate`'s contract, so there is nothing left to check here.
        unsafe { self.deallocate(ptr, layout) }
    }
}
pub fn run() -> ([u32; 4], bool) {
    let heap = Heap::new();
    let layout = Layout::new::<[u32; 4]>();

    // SAFETY: the layout has non-zero size, which is what alloc requires.
    let p = unsafe { heap.alloc(layout) } as *mut [u32; 4];
    assert!(!p.is_null());

    // SAFETY: p owns 16 bytes at align 4 and nothing else points at them.
    let got = unsafe {
        p.write([9, 8, 7, 6]);
        p.read()
    };

    // SAFETY: p came from this allocator with exactly this layout.
    unsafe { heap.dealloc(p as *mut u8, layout) };

    let odd = Layout::from_size_align(32, 64).unwrap();
    // SAFETY: the layout has non-zero size.
    let refused = unsafe { heap.alloc(odd) }.is_null();

    println!("[u32; 4] wants {} bytes at align {}", layout.size(), layout.align());
    println!("read back {got:?}");
    println!("align 64 is more than this allocator serves, so it returned null: {refused}");
    (got, refused)
}
```

@hint `GlobalAlloc` is declared `unsafe trait`. Implementing one is the third of the five things the keyword unlocks.
@hint Both methods already exist on `Heap` under other names, with the same contracts word for word.
@hint `unsafe impl GlobalAlloc for Heap`, then forward `alloc` to `allocate` and `dealloc` to `deallocate`.

@diagnose E0200
`the trait GlobalAlloc requires an unsafe impl declaration`.

A trait is `unsafe` when other code's correctness depends on the implementation
keeping promises the compiler cannot check. Here the promises are that `alloc`
returns either null or a block of at least `layout.size()` bytes aligned to
`layout.align()`, that the block does not overlap any other live block, and that
neither method unwinds. `Vec` relies on all of that with no check of its own.

Writing `unsafe impl` is you signing for those. It is the mirror image of
`unsafe fn`: there the caller owes you preconditions, here you owe every caller
postconditions, forever, including callers you will never see.

@diagnose E0133
`call to unsafe function Heap::deallocate is unsafe and requires unsafe block`.

Since edition 2024 the body of an `unsafe fn` is no longer an implicit `unsafe`
block, and this is the case that shows why the change was right. `dealloc` is
`unsafe fn` because its *caller* owes it a valid pointer. That says nothing
about whether the line you wrote inside it is justified, and it happens to be
justified for exactly one reason: `dealloc`'s contract on the caller is word for
word `deallocate`'s contract.

Write the block, and write that sentence above it. A forwarding function whose
safety comment is "the obligation is identical" is the good case; if you cannot
say that, you are discarding a precondition somewhere.

@after
The contract, from the standard library's own documentation. For `alloc`:
"layout must have a non-zero size", and the caller "must not rely on the returned
memory being initialised". For `dealloc`: `ptr` "must denote a block of memory
currently allocated via this allocator", and `layout` "must be the same layout
that was used to allocate that block". `realloc` adds that the new size must not
overflow when rounded up to the alignment.

The two default methods are worth knowing. `alloc_zeroed` calls `alloc` and then
zeroes, which is right here and wasteful for a real allocator that could ask the
kernel for pages already zeroed. `realloc` allocates, copies, deallocates, so an
allocator that can grow a block in place overrides it and a `Vec` push gets much
cheaper.

One rule with no room in it: an implementation must not panic. The panic
machinery allocates, so a panic inside `alloc` re-enters the allocator that is
already in the middle of a mutation. Return null and let the caller's
`handle_alloc_error` deal with it.

## 10. Making it thread safe without deadlocking

@kind fix
@concept spin lock

@expect E0277

`Heap` holds `Cell`s, so it is not `Sync`, so four threads cannot share one.
A `Mutex` is the usual answer and the wrong one here. Take the lock in `guard`,
then make the claim the compiler cannot: that this type is safe to share, and
say in a comment why that is true.

```starter
use std::alloc::{GlobalAlloc, Layout};
use std::cell::{Cell, UnsafeCell};
use std::mem::MaybeUninit;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, Ordering};
/// Bytes in the arena. Fixed at compile time: an allocator has nobody to ask.
pub const ARENA: usize = 1 << 16;

/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;

/// Round `n` up to the next multiple of `align`, which must be a power of two.
pub const fn align_up(n: usize, align: usize) -> usize {
    (n + align - 1) & !(align - 1)
}
/// Blocks up to this size get their own free list.
pub const MAX_SMALL: usize = 256;

/// One class per 16 bytes: 16, 32, 48 ... 256.
pub const NCLASS: usize = MAX_SMALL / MAX_ALIGN;
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align).ok()?;
    Some((layout.size(), layout.align()))
}
#[repr(align(16))]
struct Store {
    bytes: [MaybeUninit<u8>; ARENA],
}

impl Store {
    const fn new() -> Self {
        Store { bytes: [MaybeUninit::uninit(); ARENA] }
    }
}
/// One pointer, moving forward. Nothing else.
pub struct Bump {
    buf: UnsafeCell<Store>,
    next: Cell<usize>,
}
impl Bump {
    pub fn new() -> Self {
        Bump { buf: UnsafeCell::new(Store::new()), next: Cell::new(0) }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a reference,
        // so it cannot invalidate a pointer already handed out.
        unsafe { &raw mut (*self.buf.get()).bytes as *mut u8 }
    }

    pub fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN {
            return null_mut();
        }
        let start = align_up(self.next.get(), layout.align());
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        if end > ARENA {
            return null_mut();
        }
        self.next.set(end);
        // SAFETY: end <= ARENA, so `start` is an offset inside the single
        // object `base` points at and the whole block is in bounds. The base is
        // 16-aligned and `start` is a multiple of layout.align(), so the result
        // has the alignment the caller asked for.
        unsafe { self.base().add(start) }
    }

    pub fn used(&self) -> usize {
        self.next.get()
    }

    pub fn remaining(&self) -> usize {
        ARENA - self.next.get()
    }

    /// Hand the whole arena back at once.
    ///
    /// Taking `&mut self` is what makes this safe: any slice handed out by
    /// `alloc_slice` borrows `&self`, so none can be alive here.
    pub fn reset(&mut self) {
        self.next.set(0);
    }

    /// Allocate `n` bytes and write `fill` into every one of them, so the
    /// result is a real `&mut [u8]` rather than a claim about garbage.
    pub fn alloc_slice(&self, n: usize, fill: u8) -> Option<&mut [u8]> {
        let p = self.alloc(Layout::from_size_align(n, 1).ok()?);
        if p.is_null() {
            return None;
        }
        // SAFETY: `p` starts `n` bytes that nothing else points at, because the
        // bump pointer only ever moves forward. `write_bytes` initialises all
        // of them, so afterwards the range really is a `[u8]`. The returned
        // lifetime is that of `&self`, so `reset`, which needs `&mut self`,
        // cannot run while this slice is alive.
        unsafe {
            std::ptr::write_bytes(p, fill, n);
            Some(std::slice::from_raw_parts_mut(p, n))
        }
    }

    /// # Safety
    /// `off` must be less than `ARENA` and that byte must have been written.
    pub unsafe fn read_byte(&self, off: usize) -> u8 {
        // SAFETY: the caller guarantees the byte is in range and initialised.
        unsafe {
            (self.base() as *const MaybeUninit<u8>)
                .add(off)
                .read()
                .assume_init()
        }
    }
}
/// The header of a free block, written into the block's own bytes.
#[repr(C)]
pub struct FreeNode {
    pub size: usize,
    pub next: *mut FreeNode,
}

pub const NODE: usize = std::mem::size_of::<FreeNode>();

/// No block is smaller than a node, or the list could not live inside it.
pub const MIN_BLOCK: usize = align_up(NODE, MAX_ALIGN);

/// What a request actually costs: rounded up so every block is 16-aligned and
/// big enough to hold a `FreeNode` once it is given back.
pub fn block_size(layout: &Layout) -> usize {
    align_up(layout.size().max(MIN_BLOCK), MAX_ALIGN)
}
/// Which quick list a block of this size belongs on, if any.
pub fn class_of(size: usize) -> Option<usize> {
    if size == 0 || size > MAX_SMALL {
        None
    } else {
        Some(size / MAX_ALIGN - 1)
    }
}
/// Held for as long as the allocator's own state is being touched.
pub struct Guard<'a>(&'a AtomicBool);

impl Drop for Guard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
/// A free list threaded through the arena's own free bytes.
pub struct Heap {
    arena: UnsafeCell<Store>,
    bump: Cell<usize>,
    head: Cell<*mut FreeNode>,
    quick: [Cell<*mut FreeNode>; NCLASS],
    lock: AtomicBool,
}
impl Heap {
    pub fn new() -> Self {
        Heap {
            arena: UnsafeCell::new(Store::new()),
            bump: Cell::new(0),
            head: Cell::new(null_mut()),
            quick: [const { Cell::new(null_mut::<FreeNode>()) }; NCLASS],
            lock: AtomicBool::new(false),
        }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a
        // reference, so it invalidates no pointer already handed out.
        unsafe { &raw mut (*self.arena.get()).bytes as *mut u8 }
    }

    /// A lock an allocator may hold: taking it allocates nothing.
    fn guard(&self) -> Guard<'_> {
        // TODO: nothing here takes the lock yet.
        Guard(&self.lock)
    }

    pub fn allocate(&self, layout: Layout) -> *mut u8 {
        let _g = self.guard();
        if layout.align() > MAX_ALIGN || layout.size() > ARENA {
            return null_mut();
        }
        let need = block_size(&layout);

        let mut p = self.pop_quick(need);
        if p.is_null() {
            p = self.pop_free(need);
        }
        if p.is_null() {
            p = self.carve(need);
        }
        p
    }

    /// # Safety
    /// `ptr` must be a block this heap returned from `allocate` with
    /// exactly this `layout`, and must not have been deallocated since.
    pub unsafe fn deallocate(&self, ptr: *mut u8, layout: Layout) {
        let _g = self.guard();
        let size = block_size(&layout);
        let node = ptr as *mut FreeNode;
        if let Some(c) = class_of(size) {
            // SAFETY: the caller has handed the block back, so nothing
            // else points into it. It is `size` >= MIN_BLOCK bytes and
            // 16-aligned, room and alignment enough for a FreeNode.
            unsafe { node.write(FreeNode { size, next: self.quick[c].get() }) };
            self.quick[c].set(node);
        } else {
            // SAFETY: as above.
            unsafe { self.insert_free(node, size) };
        }
    }

    /// Take fresh bytes off the end of the arena. This is stage two, still.
    fn carve(&self, need: usize) -> *mut u8 {
        let start = self.bump.get();
        if need > ARENA - start {
            return null_mut();
        }
        self.bump.set(start + need);
        // SAFETY: start + need <= ARENA, so the block lies inside the arena and
        // `base` carries provenance over all of it.
        unsafe { self.base().add(start) }
    }

    /// First block big enough, split if the remainder can hold a node.
    fn pop_free(&self, need: usize) -> *mut u8 {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block in the arena, 16-aligned and at least
            // MIN_BLOCK bytes, so it holds the node deallocate wrote there.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            if size >= need {
                let replacement = if size - need >= MIN_BLOCK {
                    // SAFETY: need <= size, so this offset is still inside the
                    // block, and every block lies inside the arena.
                    let rem = unsafe { (cur as *mut u8).add(need) } as *mut FreeNode;
                    // SAFETY: the remainder is at least MIN_BLOCK bytes,
                    // 16-aligned, and is not handed out to anyone.
                    unsafe { rem.write(FreeNode { size: size - need, next }) };
                    rem
                } else {
                    next
                };
                if prev.is_null() {
                    self.head.set(replacement);
                } else {
                    // SAFETY: prev is a free block on the list.
                    unsafe { (*prev).next = replacement };
                }
                return cur as *mut u8;
            }
            prev = cur;
            cur = next;
        }
        null_mut()
    }

    /// A pop from the head of one size class. No search, no split.
    fn pop_quick(&self, need: usize) -> *mut u8 {
        let Some(c) = class_of(need) else {
            return null_mut();
        };
        let head = self.quick[c].get();
        if head.is_null() {
            return null_mut();
        }
        // SAFETY: every node on quick[c] is a block of exactly `need` bytes in
        // the arena, 16-aligned and not handed out, holding the node that
        // deallocate wrote there.
        let next = unsafe { (*head).next };
        self.quick[c].set(next);
        head as *mut u8
    }

    /// # Safety
    /// `node` must point at `size` bytes of this arena that are not handed out
    /// and are on no list.
    unsafe fn insert_free(&self, node: *mut FreeNode, size: usize) {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() && cur.addr() < node.addr() {
            prev = cur;
            // SAFETY: cur is a free block on the list.
            cur = unsafe { (*cur).next };
        }
        // SAFETY: the caller guarantees these bytes are the allocator's again.
        unsafe { node.write(FreeNode { size, next: cur }) };
        if prev.is_null() {
            self.head.set(node);
        } else {
            // SAFETY: prev is a free block on the list.
            unsafe { (*prev).next = node };
        }

        if !cur.is_null() && node.addr() + size == cur.addr() {
            // SAFETY: node and cur are both free blocks on the list, and the
            // one ends exactly where the other starts.
            unsafe {
                (*node).size = size + (*cur).size;
                (*node).next = (*cur).next;
            }
        }
        if !prev.is_null() {
            // SAFETY: prev and node are both free blocks on the list.
            unsafe {
                if prev.addr() + (*prev).size == node.addr() {
                    (*prev).size += (*node).size;
                    (*prev).next = (*node).next;
                }
            }
        }
    }

    /// Return every quick list block to the main list, where it can merge.
    pub fn flush(&self) {
        let _g = self.guard();
        for c in 0..NCLASS {
            let mut cur = self.quick[c].get();
            self.quick[c].set(null_mut());
            while !cur.is_null() {
                // SAFETY: cur is a free block on quick[c].
                let (size, next) = unsafe { ((*cur).size, (*cur).next) };
                // SAFETY: cur has just been taken off every list.
                unsafe { self.insert_free(cur, size) };
                cur = next;
            }
        }
    }

    /// (blocks, total free bytes, largest free block)
    pub fn free_stats(&self) -> (usize, usize, usize) {
        let _g = self.guard();
        let (mut n, mut total, mut largest) = (0, 0, 0);
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block on the list.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            n += 1;
            total += size;
            if size > largest {
                largest = size;
            }
            cur = next;
        }
        (n, total, largest)
    }

    /// Bytes ever carved off the end of the arena.
    pub fn used(&self) -> usize {
        let _g = self.guard();
        self.bump.get()
    }
}
unsafe impl GlobalAlloc for Heap {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        self.allocate(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // SAFETY: `dealloc`'s contract on the caller is word for word
        // `deallocate`'s contract, so there is nothing left to check here.
        unsafe { self.deallocate(ptr, layout) }
    }
}
/// Every thread allocates its own blocks, stamps them, waits until all of them
/// are live, then checks nobody else wrote into its bytes.
pub fn hammer(heap: &Heap, threads: usize, per_thread: usize) -> Vec<(usize, usize)> {
    let barrier = std::sync::Barrier::new(threads);
    std::thread::scope(|s| {
        let hs: Vec<_> = (0..threads)
            .map(|t| {
                let barrier = &barrier;
                s.spawn(move || {
                    let stamp = t as u8 + 1;
                    let mut mine: Vec<(*mut u8, Layout)> = Vec::new();
                    for i in 0..per_thread {
                        let size = [32usize, 64, 96, 128][(t + i) % 4];
                        let layout = Layout::from_size_align(size, 8).unwrap();
                        let p = heap.allocate(layout);
                        assert!(!p.is_null(), "arena exhausted");
                        // SAFETY: p is ours alone and owns `size` bytes.
                        unsafe { std::ptr::write_bytes(p, stamp, size) };
                        mine.push((p, layout));
                    }
                    let spans: Vec<(usize, usize)> = mine
                        .iter()
                        .map(|&(p, l)| (p.addr(), p.addr() + block_size(&l)))
                        .collect();
                    barrier.wait();
                    for &(p, l) in &mine {
                        // SAFETY: we own these bytes and wrote every one.
                        let bytes = unsafe { std::slice::from_raw_parts(p, l.size()) };
                        assert!(
                            bytes.iter().all(|&b| b == stamp),
                            "another thread was handed our block"
                        );
                    }
                    for (p, l) in mine {
                        // SAFETY: allocated here with l, freed exactly once.
                        unsafe { heap.deallocate(p, l) };
                    }
                    spans
                })
            })
            .collect();
        hs.into_iter().flat_map(|h| h.join().unwrap()).collect()
    })
}
pub fn run() -> (usize, usize, usize) {
    let heap = Heap::new();
    let spans = hammer(&heap, 4, 8);

    let mut sorted = spans.clone();
    sorted.sort_unstable();
    let mut overlaps = 0;
    for w in sorted.windows(2) {
        if w[0].1 > w[1].0 {
            overlaps += 1;
        }
    }

    heap.flush();
    let (blocks, bytes, _) = heap.free_stats();
    println!("four threads, {} blocks live at once, {overlaps} overlaps", spans.len());
    println!("after the join and a flush: {blocks} free block of {bytes} bytes");
    println!("the arena carved {} bytes in total", heap.used());
    (spans.len(), overlaps, blocks)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn four_threads_never_share_a_block() {
        let (blocks, overlaps, free_blocks) = run();
        assert_eq!(blocks, 32);
        assert_eq!(overlaps, 0);
        assert_eq!(free_blocks, 1);
    }

    #[test]
    fn the_arena_survives_being_hammered() {
        let heap = Heap::new();
        for _ in 0..8 {
            let spans = hammer(&heap, 4, 6);
            assert_eq!(spans.len(), 24);
        }
        heap.flush();
        let (blocks, total, _) = heap.free_stats();
        assert_eq!(blocks, 1);
        assert_eq!(total, heap.used());
    }

    #[test]
    fn the_lock_is_dropped_on_the_refusal_path() {
        let heap = Heap::new();
        assert!(heap.allocate(Layout::from_size_align(8, 64).unwrap()).is_null());
        assert!(!heap.allocate(Layout::from_size_align(8, 8).unwrap()).is_null());
        assert_eq!(heap.used(), 16);
    }

    #[test]
    fn a_shared_heap_is_sync() {
        fn assert_sync<T: Sync>() {}
        assert_sync::<Heap>();
    }
}
```

```solution
use std::alloc::{GlobalAlloc, Layout};
use std::cell::{Cell, UnsafeCell};
use std::mem::MaybeUninit;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, Ordering};
/// Bytes in the arena. Fixed at compile time: an allocator has nobody to ask.
pub const ARENA: usize = 1 << 16;

/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;

/// Round `n` up to the next multiple of `align`, which must be a power of two.
pub const fn align_up(n: usize, align: usize) -> usize {
    (n + align - 1) & !(align - 1)
}
/// Blocks up to this size get their own free list.
pub const MAX_SMALL: usize = 256;

/// One class per 16 bytes: 16, 32, 48 ... 256.
pub const NCLASS: usize = MAX_SMALL / MAX_ALIGN;
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align).ok()?;
    Some((layout.size(), layout.align()))
}
#[repr(align(16))]
struct Store {
    bytes: [MaybeUninit<u8>; ARENA],
}

impl Store {
    const fn new() -> Self {
        Store { bytes: [MaybeUninit::uninit(); ARENA] }
    }
}
/// One pointer, moving forward. Nothing else.
pub struct Bump {
    buf: UnsafeCell<Store>,
    next: Cell<usize>,
}
impl Bump {
    pub fn new() -> Self {
        Bump { buf: UnsafeCell::new(Store::new()), next: Cell::new(0) }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a reference,
        // so it cannot invalidate a pointer already handed out.
        unsafe { &raw mut (*self.buf.get()).bytes as *mut u8 }
    }

    pub fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN {
            return null_mut();
        }
        let start = align_up(self.next.get(), layout.align());
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        if end > ARENA {
            return null_mut();
        }
        self.next.set(end);
        // SAFETY: end <= ARENA, so `start` is an offset inside the single
        // object `base` points at and the whole block is in bounds. The base is
        // 16-aligned and `start` is a multiple of layout.align(), so the result
        // has the alignment the caller asked for.
        unsafe { self.base().add(start) }
    }

    pub fn used(&self) -> usize {
        self.next.get()
    }

    pub fn remaining(&self) -> usize {
        ARENA - self.next.get()
    }

    /// Hand the whole arena back at once.
    ///
    /// Taking `&mut self` is what makes this safe: any slice handed out by
    /// `alloc_slice` borrows `&self`, so none can be alive here.
    pub fn reset(&mut self) {
        self.next.set(0);
    }

    /// Allocate `n` bytes and write `fill` into every one of them, so the
    /// result is a real `&mut [u8]` rather than a claim about garbage.
    pub fn alloc_slice(&self, n: usize, fill: u8) -> Option<&mut [u8]> {
        let p = self.alloc(Layout::from_size_align(n, 1).ok()?);
        if p.is_null() {
            return None;
        }
        // SAFETY: `p` starts `n` bytes that nothing else points at, because the
        // bump pointer only ever moves forward. `write_bytes` initialises all
        // of them, so afterwards the range really is a `[u8]`. The returned
        // lifetime is that of `&self`, so `reset`, which needs `&mut self`,
        // cannot run while this slice is alive.
        unsafe {
            std::ptr::write_bytes(p, fill, n);
            Some(std::slice::from_raw_parts_mut(p, n))
        }
    }

    /// # Safety
    /// `off` must be less than `ARENA` and that byte must have been written.
    pub unsafe fn read_byte(&self, off: usize) -> u8 {
        // SAFETY: the caller guarantees the byte is in range and initialised.
        unsafe {
            (self.base() as *const MaybeUninit<u8>)
                .add(off)
                .read()
                .assume_init()
        }
    }
}
/// The header of a free block, written into the block's own bytes.
#[repr(C)]
pub struct FreeNode {
    pub size: usize,
    pub next: *mut FreeNode,
}

pub const NODE: usize = std::mem::size_of::<FreeNode>();

/// No block is smaller than a node, or the list could not live inside it.
pub const MIN_BLOCK: usize = align_up(NODE, MAX_ALIGN);

/// What a request actually costs: rounded up so every block is 16-aligned and
/// big enough to hold a `FreeNode` once it is given back.
pub fn block_size(layout: &Layout) -> usize {
    align_up(layout.size().max(MIN_BLOCK), MAX_ALIGN)
}
/// Which quick list a block of this size belongs on, if any.
pub fn class_of(size: usize) -> Option<usize> {
    if size == 0 || size > MAX_SMALL {
        None
    } else {
        Some(size / MAX_ALIGN - 1)
    }
}
/// Held for as long as the allocator's own state is being touched.
pub struct Guard<'a>(&'a AtomicBool);

impl Drop for Guard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
/// A free list threaded through the arena's own free bytes.
pub struct Heap {
    arena: UnsafeCell<Store>,
    bump: Cell<usize>,
    head: Cell<*mut FreeNode>,
    quick: [Cell<*mut FreeNode>; NCLASS],
    lock: AtomicBool,
}
// SAFETY: every field except `arena` is read and written only between taking
// and dropping a `Guard`, and the lock serialises those sections, so no two
// threads touch a `Cell` at once. Arena bytes belong to at most one caller at a
// time, and the allocator itself only touches bytes of blocks that are not
// currently handed out, so no byte is accessed by two threads at once either.
unsafe impl Sync for Heap {}
impl Heap {
    pub fn new() -> Self {
        Heap {
            arena: UnsafeCell::new(Store::new()),
            bump: Cell::new(0),
            head: Cell::new(null_mut()),
            quick: [const { Cell::new(null_mut::<FreeNode>()) }; NCLASS],
            lock: AtomicBool::new(false),
        }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a
        // reference, so it invalidates no pointer already handed out.
        unsafe { &raw mut (*self.arena.get()).bytes as *mut u8 }
    }

    /// A lock an allocator may hold: taking it allocates nothing.
    fn guard(&self) -> Guard<'_> {
        while self
            .lock
            .compare_exchange_weak(false, true, Ordering::Acquire, Ordering::Relaxed)
            .is_err()
        {
            std::hint::spin_loop();
        }
        Guard(&self.lock)
    }

    pub fn allocate(&self, layout: Layout) -> *mut u8 {
        let _g = self.guard();
        if layout.align() > MAX_ALIGN || layout.size() > ARENA {
            return null_mut();
        }
        let need = block_size(&layout);

        let mut p = self.pop_quick(need);
        if p.is_null() {
            p = self.pop_free(need);
        }
        if p.is_null() {
            p = self.carve(need);
        }
        p
    }

    /// # Safety
    /// `ptr` must be a block this heap returned from `allocate` with
    /// exactly this `layout`, and must not have been deallocated since.
    pub unsafe fn deallocate(&self, ptr: *mut u8, layout: Layout) {
        let _g = self.guard();
        let size = block_size(&layout);
        let node = ptr as *mut FreeNode;
        if let Some(c) = class_of(size) {
            // SAFETY: the caller has handed the block back, so nothing
            // else points into it. It is `size` >= MIN_BLOCK bytes and
            // 16-aligned, room and alignment enough for a FreeNode.
            unsafe { node.write(FreeNode { size, next: self.quick[c].get() }) };
            self.quick[c].set(node);
        } else {
            // SAFETY: as above.
            unsafe { self.insert_free(node, size) };
        }
    }

    /// Take fresh bytes off the end of the arena. This is stage two, still.
    fn carve(&self, need: usize) -> *mut u8 {
        let start = self.bump.get();
        if need > ARENA - start {
            return null_mut();
        }
        self.bump.set(start + need);
        // SAFETY: start + need <= ARENA, so the block lies inside the arena and
        // `base` carries provenance over all of it.
        unsafe { self.base().add(start) }
    }

    /// First block big enough, split if the remainder can hold a node.
    fn pop_free(&self, need: usize) -> *mut u8 {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block in the arena, 16-aligned and at least
            // MIN_BLOCK bytes, so it holds the node deallocate wrote there.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            if size >= need {
                let replacement = if size - need >= MIN_BLOCK {
                    // SAFETY: need <= size, so this offset is still inside the
                    // block, and every block lies inside the arena.
                    let rem = unsafe { (cur as *mut u8).add(need) } as *mut FreeNode;
                    // SAFETY: the remainder is at least MIN_BLOCK bytes,
                    // 16-aligned, and is not handed out to anyone.
                    unsafe { rem.write(FreeNode { size: size - need, next }) };
                    rem
                } else {
                    next
                };
                if prev.is_null() {
                    self.head.set(replacement);
                } else {
                    // SAFETY: prev is a free block on the list.
                    unsafe { (*prev).next = replacement };
                }
                return cur as *mut u8;
            }
            prev = cur;
            cur = next;
        }
        null_mut()
    }

    /// A pop from the head of one size class. No search, no split.
    fn pop_quick(&self, need: usize) -> *mut u8 {
        let Some(c) = class_of(need) else {
            return null_mut();
        };
        let head = self.quick[c].get();
        if head.is_null() {
            return null_mut();
        }
        // SAFETY: every node on quick[c] is a block of exactly `need` bytes in
        // the arena, 16-aligned and not handed out, holding the node that
        // deallocate wrote there.
        let next = unsafe { (*head).next };
        self.quick[c].set(next);
        head as *mut u8
    }

    /// # Safety
    /// `node` must point at `size` bytes of this arena that are not handed out
    /// and are on no list.
    unsafe fn insert_free(&self, node: *mut FreeNode, size: usize) {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() && cur.addr() < node.addr() {
            prev = cur;
            // SAFETY: cur is a free block on the list.
            cur = unsafe { (*cur).next };
        }
        // SAFETY: the caller guarantees these bytes are the allocator's again.
        unsafe { node.write(FreeNode { size, next: cur }) };
        if prev.is_null() {
            self.head.set(node);
        } else {
            // SAFETY: prev is a free block on the list.
            unsafe { (*prev).next = node };
        }

        if !cur.is_null() && node.addr() + size == cur.addr() {
            // SAFETY: node and cur are both free blocks on the list, and the
            // one ends exactly where the other starts.
            unsafe {
                (*node).size = size + (*cur).size;
                (*node).next = (*cur).next;
            }
        }
        if !prev.is_null() {
            // SAFETY: prev and node are both free blocks on the list.
            unsafe {
                if prev.addr() + (*prev).size == node.addr() {
                    (*prev).size += (*node).size;
                    (*prev).next = (*node).next;
                }
            }
        }
    }

    /// Return every quick list block to the main list, where it can merge.
    pub fn flush(&self) {
        let _g = self.guard();
        for c in 0..NCLASS {
            let mut cur = self.quick[c].get();
            self.quick[c].set(null_mut());
            while !cur.is_null() {
                // SAFETY: cur is a free block on quick[c].
                let (size, next) = unsafe { ((*cur).size, (*cur).next) };
                // SAFETY: cur has just been taken off every list.
                unsafe { self.insert_free(cur, size) };
                cur = next;
            }
        }
    }

    /// (blocks, total free bytes, largest free block)
    pub fn free_stats(&self) -> (usize, usize, usize) {
        let _g = self.guard();
        let (mut n, mut total, mut largest) = (0, 0, 0);
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block on the list.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            n += 1;
            total += size;
            if size > largest {
                largest = size;
            }
            cur = next;
        }
        (n, total, largest)
    }

    /// Bytes ever carved off the end of the arena.
    pub fn used(&self) -> usize {
        let _g = self.guard();
        self.bump.get()
    }
}
unsafe impl GlobalAlloc for Heap {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        self.allocate(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // SAFETY: `dealloc`'s contract on the caller is word for word
        // `deallocate`'s contract, so there is nothing left to check here.
        unsafe { self.deallocate(ptr, layout) }
    }
}
/// Every thread allocates its own blocks, stamps them, waits until all of them
/// are live, then checks nobody else wrote into its bytes.
pub fn hammer(heap: &Heap, threads: usize, per_thread: usize) -> Vec<(usize, usize)> {
    let barrier = std::sync::Barrier::new(threads);
    std::thread::scope(|s| {
        let hs: Vec<_> = (0..threads)
            .map(|t| {
                let barrier = &barrier;
                s.spawn(move || {
                    let stamp = t as u8 + 1;
                    let mut mine: Vec<(*mut u8, Layout)> = Vec::new();
                    for i in 0..per_thread {
                        let size = [32usize, 64, 96, 128][(t + i) % 4];
                        let layout = Layout::from_size_align(size, 8).unwrap();
                        let p = heap.allocate(layout);
                        assert!(!p.is_null(), "arena exhausted");
                        // SAFETY: p is ours alone and owns `size` bytes.
                        unsafe { std::ptr::write_bytes(p, stamp, size) };
                        mine.push((p, layout));
                    }
                    let spans: Vec<(usize, usize)> = mine
                        .iter()
                        .map(|&(p, l)| (p.addr(), p.addr() + block_size(&l)))
                        .collect();
                    barrier.wait();
                    for &(p, l) in &mine {
                        // SAFETY: we own these bytes and wrote every one.
                        let bytes = unsafe { std::slice::from_raw_parts(p, l.size()) };
                        assert!(
                            bytes.iter().all(|&b| b == stamp),
                            "another thread was handed our block"
                        );
                    }
                    for (p, l) in mine {
                        // SAFETY: allocated here with l, freed exactly once.
                        unsafe { heap.deallocate(p, l) };
                    }
                    spans
                })
            })
            .collect();
        hs.into_iter().flat_map(|h| h.join().unwrap()).collect()
    })
}
pub fn run() -> (usize, usize, usize) {
    let heap = Heap::new();
    let spans = hammer(&heap, 4, 8);

    let mut sorted = spans.clone();
    sorted.sort_unstable();
    let mut overlaps = 0;
    for w in sorted.windows(2) {
        if w[0].1 > w[1].0 {
            overlaps += 1;
        }
    }

    heap.flush();
    let (blocks, bytes, _) = heap.free_stats();
    println!("four threads, {} blocks live at once, {overlaps} overlaps", spans.len());
    println!("after the join and a flush: {blocks} free block of {bytes} bytes");
    println!("the arena carved {} bytes in total", heap.used());
    (spans.len(), overlaps, blocks)
}
```

@hint `Cell` is not `Sync` because two threads writing one is a data race. If every access happens with a lock held, that stops being true, and only you can say so.
@hint `compare_exchange_weak(false, true, Acquire, Relaxed)` in a loop, with `std::hint::spin_loop()` in the body. `Guard`'s `Drop` already does the `Release` store.
@hint `unsafe impl Sync for Heap {}`, with a `// SAFETY:` comment naming which lock covers which field.

@diagnose E0277
`UnsafeCell<Store> cannot be shared between threads safely`, and under it
`required because it appears within the type Heap`.

`Sync` is an auto trait: the compiler derives it for a struct when every field
has it, and stops when one does not. `Cell` and `UnsafeCell` opt out, because
shared mutation without synchronisation is a data race and a data race is
immediate undefined behaviour, not a stale read.

The compiler cannot see the lock. It has no idea that every one of those fields
is only touched between taking and dropping a `Guard`. So the fix is not to
change the fields, it is to state the invariant yourself with `unsafe impl Sync`
and write the sentence that makes it true. If your spin loop is still a `TODO`,
the sentence is false.

@diagnose E0200
`the trait Sync requires an unsafe impl declaration`.

You wrote `impl Sync for Heap {}`. `Sync` is an unsafe trait for the same reason
`GlobalAlloc` is: the rest of the language, and every `thread::scope` and `Arc`
in the program, will now assume concurrent access to a `&Heap` is fine. Nothing
checks it.

Adding `unsafe` is right here. Worth noticing what it costs: the claim covers
every field, present and future. Add a `Cell` next month and forget to lock it,
and this line still says the type is safe to share. That is why the safety
comment names the mechanism rather than the fields, and why an allocator this
small is about the largest thing that should carry one.

@after
A `Mutex` inside a global allocator can deadlock, and the reason is a loop.
`std::sync::Mutex` may allocate when it is first contended on some platforms, and
allocating calls the allocator, which is already inside the lock it is trying to
take. Even where it does not allocate, blocking parks the thread through the
operating system, and the parking path itself can allocate. A spin lock has no
such path: it is one atomic word, a compare and exchange, and a pause
instruction.

That is defensible here and nowhere else. A spin lock burns a core while it
waits, so it is only right when the critical section is a handful of
instructions and cannot be preempted for long. Ours is a list walk. A real
allocator avoids the question by giving each thread its own cache and only
locking when a cache runs dry, which is why jemalloc scales and this does not.

`Acquire` on the way in and `Release` on the way out is the minimum that makes
the writes inside the section visible to the next thread that gets the lock.
`Relaxed` on the failure path is safe because a failed exchange changes
nothing.

## 11. Testing an allocator honestly

@kind fix
@concept invariant

@expect E0502

Fixed cases test the paths you thought of. Five thousand seeded random steps test
the ones you did not. Every block is stamped with a pattern, checked before it is
freed, and the run ends by asserting the arena comes back whole. The free branch
borrows the list and then modifies it.

```starter
use std::alloc::{GlobalAlloc, Layout};
use std::cell::{Cell, UnsafeCell};
use std::mem::MaybeUninit;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, Ordering};
/// Bytes in the arena. Fixed at compile time: an allocator has nobody to ask.
pub const ARENA: usize = 1 << 16;

/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;

/// Round `n` up to the next multiple of `align`, which must be a power of two.
pub const fn align_up(n: usize, align: usize) -> usize {
    (n + align - 1) & !(align - 1)
}
/// Blocks up to this size get their own free list.
pub const MAX_SMALL: usize = 256;

/// One class per 16 bytes: 16, 32, 48 ... 256.
pub const NCLASS: usize = MAX_SMALL / MAX_ALIGN;
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align).ok()?;
    Some((layout.size(), layout.align()))
}
#[repr(align(16))]
struct Store {
    bytes: [MaybeUninit<u8>; ARENA],
}

impl Store {
    const fn new() -> Self {
        Store { bytes: [MaybeUninit::uninit(); ARENA] }
    }
}
/// One pointer, moving forward. Nothing else.
pub struct Bump {
    buf: UnsafeCell<Store>,
    next: Cell<usize>,
}
impl Bump {
    pub fn new() -> Self {
        Bump { buf: UnsafeCell::new(Store::new()), next: Cell::new(0) }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a reference,
        // so it cannot invalidate a pointer already handed out.
        unsafe { &raw mut (*self.buf.get()).bytes as *mut u8 }
    }

    pub fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN {
            return null_mut();
        }
        let start = align_up(self.next.get(), layout.align());
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        if end > ARENA {
            return null_mut();
        }
        self.next.set(end);
        // SAFETY: end <= ARENA, so `start` is an offset inside the single
        // object `base` points at and the whole block is in bounds. The base is
        // 16-aligned and `start` is a multiple of layout.align(), so the result
        // has the alignment the caller asked for.
        unsafe { self.base().add(start) }
    }

    pub fn used(&self) -> usize {
        self.next.get()
    }

    pub fn remaining(&self) -> usize {
        ARENA - self.next.get()
    }

    /// Hand the whole arena back at once.
    ///
    /// Taking `&mut self` is what makes this safe: any slice handed out by
    /// `alloc_slice` borrows `&self`, so none can be alive here.
    pub fn reset(&mut self) {
        self.next.set(0);
    }

    /// Allocate `n` bytes and write `fill` into every one of them, so the
    /// result is a real `&mut [u8]` rather than a claim about garbage.
    pub fn alloc_slice(&self, n: usize, fill: u8) -> Option<&mut [u8]> {
        let p = self.alloc(Layout::from_size_align(n, 1).ok()?);
        if p.is_null() {
            return None;
        }
        // SAFETY: `p` starts `n` bytes that nothing else points at, because the
        // bump pointer only ever moves forward. `write_bytes` initialises all
        // of them, so afterwards the range really is a `[u8]`. The returned
        // lifetime is that of `&self`, so `reset`, which needs `&mut self`,
        // cannot run while this slice is alive.
        unsafe {
            std::ptr::write_bytes(p, fill, n);
            Some(std::slice::from_raw_parts_mut(p, n))
        }
    }

    /// # Safety
    /// `off` must be less than `ARENA` and that byte must have been written.
    pub unsafe fn read_byte(&self, off: usize) -> u8 {
        // SAFETY: the caller guarantees the byte is in range and initialised.
        unsafe {
            (self.base() as *const MaybeUninit<u8>)
                .add(off)
                .read()
                .assume_init()
        }
    }
}
/// The header of a free block, written into the block's own bytes.
#[repr(C)]
pub struct FreeNode {
    pub size: usize,
    pub next: *mut FreeNode,
}

pub const NODE: usize = std::mem::size_of::<FreeNode>();

/// No block is smaller than a node, or the list could not live inside it.
pub const MIN_BLOCK: usize = align_up(NODE, MAX_ALIGN);

/// What a request actually costs: rounded up so every block is 16-aligned and
/// big enough to hold a `FreeNode` once it is given back.
pub fn block_size(layout: &Layout) -> usize {
    align_up(layout.size().max(MIN_BLOCK), MAX_ALIGN)
}
/// Which quick list a block of this size belongs on, if any.
pub fn class_of(size: usize) -> Option<usize> {
    if size == 0 || size > MAX_SMALL {
        None
    } else {
        Some(size / MAX_ALIGN - 1)
    }
}
/// Held for as long as the allocator's own state is being touched.
pub struct Guard<'a>(&'a AtomicBool);

impl Drop for Guard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
/// A free list threaded through the arena's own free bytes.
pub struct Heap {
    arena: UnsafeCell<Store>,
    bump: Cell<usize>,
    head: Cell<*mut FreeNode>,
    quick: [Cell<*mut FreeNode>; NCLASS],
    lock: AtomicBool,
}
// SAFETY: every field except `arena` is read and written only between taking
// and dropping a `Guard`, and the lock serialises those sections, so no two
// threads touch a `Cell` at once. Arena bytes belong to at most one caller at a
// time, and the allocator itself only touches bytes of blocks that are not
// currently handed out, so no byte is accessed by two threads at once either.
unsafe impl Sync for Heap {}
impl Heap {
    pub fn new() -> Self {
        Heap {
            arena: UnsafeCell::new(Store::new()),
            bump: Cell::new(0),
            head: Cell::new(null_mut()),
            quick: [const { Cell::new(null_mut::<FreeNode>()) }; NCLASS],
            lock: AtomicBool::new(false),
        }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a
        // reference, so it invalidates no pointer already handed out.
        unsafe { &raw mut (*self.arena.get()).bytes as *mut u8 }
    }

    /// A lock an allocator may hold: taking it allocates nothing.
    fn guard(&self) -> Guard<'_> {
        while self
            .lock
            .compare_exchange_weak(false, true, Ordering::Acquire, Ordering::Relaxed)
            .is_err()
        {
            std::hint::spin_loop();
        }
        Guard(&self.lock)
    }

    pub fn allocate(&self, layout: Layout) -> *mut u8 {
        let _g = self.guard();
        if layout.align() > MAX_ALIGN || layout.size() > ARENA {
            return null_mut();
        }
        let need = block_size(&layout);

        let mut p = self.pop_quick(need);
        if p.is_null() {
            p = self.pop_free(need);
        }
        if p.is_null() {
            p = self.carve(need);
        }
        p
    }

    /// # Safety
    /// `ptr` must be a block this heap returned from `allocate` with
    /// exactly this `layout`, and must not have been deallocated since.
    pub unsafe fn deallocate(&self, ptr: *mut u8, layout: Layout) {
        let _g = self.guard();
        let size = block_size(&layout);
        let node = ptr as *mut FreeNode;
        if let Some(c) = class_of(size) {
            // SAFETY: the caller has handed the block back, so nothing
            // else points into it. It is `size` >= MIN_BLOCK bytes and
            // 16-aligned, room and alignment enough for a FreeNode.
            unsafe { node.write(FreeNode { size, next: self.quick[c].get() }) };
            self.quick[c].set(node);
        } else {
            // SAFETY: as above.
            unsafe { self.insert_free(node, size) };
        }
    }

    /// Take fresh bytes off the end of the arena. This is stage two, still.
    fn carve(&self, need: usize) -> *mut u8 {
        let start = self.bump.get();
        if need > ARENA - start {
            return null_mut();
        }
        self.bump.set(start + need);
        // SAFETY: start + need <= ARENA, so the block lies inside the arena and
        // `base` carries provenance over all of it.
        unsafe { self.base().add(start) }
    }

    /// First block big enough, split if the remainder can hold a node.
    fn pop_free(&self, need: usize) -> *mut u8 {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block in the arena, 16-aligned and at least
            // MIN_BLOCK bytes, so it holds the node deallocate wrote there.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            if size >= need {
                let replacement = if size - need >= MIN_BLOCK {
                    // SAFETY: need <= size, so this offset is still inside the
                    // block, and every block lies inside the arena.
                    let rem = unsafe { (cur as *mut u8).add(need) } as *mut FreeNode;
                    // SAFETY: the remainder is at least MIN_BLOCK bytes,
                    // 16-aligned, and is not handed out to anyone.
                    unsafe { rem.write(FreeNode { size: size - need, next }) };
                    rem
                } else {
                    next
                };
                if prev.is_null() {
                    self.head.set(replacement);
                } else {
                    // SAFETY: prev is a free block on the list.
                    unsafe { (*prev).next = replacement };
                }
                return cur as *mut u8;
            }
            prev = cur;
            cur = next;
        }
        null_mut()
    }

    /// A pop from the head of one size class. No search, no split.
    fn pop_quick(&self, need: usize) -> *mut u8 {
        let Some(c) = class_of(need) else {
            return null_mut();
        };
        let head = self.quick[c].get();
        if head.is_null() {
            return null_mut();
        }
        // SAFETY: every node on quick[c] is a block of exactly `need` bytes in
        // the arena, 16-aligned and not handed out, holding the node that
        // deallocate wrote there.
        let next = unsafe { (*head).next };
        self.quick[c].set(next);
        head as *mut u8
    }

    /// # Safety
    /// `node` must point at `size` bytes of this arena that are not handed out
    /// and are on no list.
    unsafe fn insert_free(&self, node: *mut FreeNode, size: usize) {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() && cur.addr() < node.addr() {
            prev = cur;
            // SAFETY: cur is a free block on the list.
            cur = unsafe { (*cur).next };
        }
        // SAFETY: the caller guarantees these bytes are the allocator's again.
        unsafe { node.write(FreeNode { size, next: cur }) };
        if prev.is_null() {
            self.head.set(node);
        } else {
            // SAFETY: prev is a free block on the list.
            unsafe { (*prev).next = node };
        }

        if !cur.is_null() && node.addr() + size == cur.addr() {
            // SAFETY: node and cur are both free blocks on the list, and the
            // one ends exactly where the other starts.
            unsafe {
                (*node).size = size + (*cur).size;
                (*node).next = (*cur).next;
            }
        }
        if !prev.is_null() {
            // SAFETY: prev and node are both free blocks on the list.
            unsafe {
                if prev.addr() + (*prev).size == node.addr() {
                    (*prev).size += (*node).size;
                    (*prev).next = (*node).next;
                }
            }
        }
    }

    /// Return every quick list block to the main list, where it can merge.
    pub fn flush(&self) {
        let _g = self.guard();
        for c in 0..NCLASS {
            let mut cur = self.quick[c].get();
            self.quick[c].set(null_mut());
            while !cur.is_null() {
                // SAFETY: cur is a free block on quick[c].
                let (size, next) = unsafe { ((*cur).size, (*cur).next) };
                // SAFETY: cur has just been taken off every list.
                unsafe { self.insert_free(cur, size) };
                cur = next;
            }
        }
    }

    /// (blocks, total free bytes, largest free block)
    pub fn free_stats(&self) -> (usize, usize, usize) {
        let _g = self.guard();
        let (mut n, mut total, mut largest) = (0, 0, 0);
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block on the list.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            n += 1;
            total += size;
            if size > largest {
                largest = size;
            }
            cur = next;
        }
        (n, total, largest)
    }

    /// Bytes ever carved off the end of the arena.
    pub fn used(&self) -> usize {
        let _g = self.guard();
        self.bump.get()
    }
}
unsafe impl GlobalAlloc for Heap {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        self.allocate(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // SAFETY: `dealloc`'s contract on the caller is word for word
        // `deallocate`'s contract, so there is nothing left to check here.
        unsafe { self.deallocate(ptr, layout) }
    }
}
/// Every thread allocates its own blocks, stamps them, waits until all of them
/// are live, then checks nobody else wrote into its bytes.
pub fn hammer(heap: &Heap, threads: usize, per_thread: usize) -> Vec<(usize, usize)> {
    let barrier = std::sync::Barrier::new(threads);
    std::thread::scope(|s| {
        let hs: Vec<_> = (0..threads)
            .map(|t| {
                let barrier = &barrier;
                s.spawn(move || {
                    let stamp = t as u8 + 1;
                    let mut mine: Vec<(*mut u8, Layout)> = Vec::new();
                    for i in 0..per_thread {
                        let size = [32usize, 64, 96, 128][(t + i) % 4];
                        let layout = Layout::from_size_align(size, 8).unwrap();
                        let p = heap.allocate(layout);
                        assert!(!p.is_null(), "arena exhausted");
                        // SAFETY: p is ours alone and owns `size` bytes.
                        unsafe { std::ptr::write_bytes(p, stamp, size) };
                        mine.push((p, layout));
                    }
                    let spans: Vec<(usize, usize)> = mine
                        .iter()
                        .map(|&(p, l)| (p.addr(), p.addr() + block_size(&l)))
                        .collect();
                    barrier.wait();
                    for &(p, l) in &mine {
                        // SAFETY: we own these bytes and wrote every one.
                        let bytes = unsafe { std::slice::from_raw_parts(p, l.size()) };
                        assert!(
                            bytes.iter().all(|&b| b == stamp),
                            "another thread was handed our block"
                        );
                    }
                    for (p, l) in mine {
                        // SAFETY: allocated here with l, freed exactly once.
                        unsafe { heap.deallocate(p, l) };
                    }
                    spans
                })
            })
            .collect();
        hs.into_iter().flat_map(|h| h.join().unwrap()).collect()
    })
}
/// xorshift64. Deterministic, seeded, and about ten instructions.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed | 1)
    }

    pub fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    pub fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

pub type Block = (*mut u8, Layout, u8);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Trace {
    pub allocs: usize,
    pub frees: usize,
    pub failures: usize,
    pub peak_blocks: usize,
}

pub const SIZES: [usize; 8] = [1, 8, 17, 32, 64, 100, 256, 700];
pub const LIVE_CAP: usize = 24;

/// The invariant that matters: two live blocks never share a byte.
pub fn check_disjoint(live: &[Block]) {
    let mut spans: Vec<(usize, usize)> = live
        .iter()
        .map(|&(p, l, _)| (p.addr(), p.addr() + l.size()))
        .collect();
    spans.sort_unstable();
    for w in spans.windows(2) {
        assert!(w[0].1 <= w[1].0, "live blocks overlap: {:?} and {:?}", w[0], w[1]);
    }
}

pub fn workload<A: GlobalAlloc>(a: &A, seed: u64, steps: usize) -> (Trace, Vec<Block>) {
    let mut rng = Rng::new(seed);
    let mut live: Vec<Block> = Vec::new();
    let mut tr = Trace { allocs: 0, frees: 0, failures: 0, peak_blocks: 0 };

    for step in 0..steps {
        let free_now = !live.is_empty() && (live.len() >= LIVE_CAP || rng.below(100) < 45);
        if free_now {
            let i = rng.below(live.len());
            let block = &live[i];
            live.swap_remove(i);
            // SAFETY: p came from a.alloc with exactly l, and is freed once.
            unsafe { a.dealloc(block.0, block.1) };
            tr.frees += 1;
        } else {
            let size = SIZES[rng.below(SIZES.len())];
            let layout = Layout::from_size_align(size, 8).unwrap();
            // SAFETY: the layout has non-zero size.
            let p = unsafe { a.alloc(layout) };
            if p.is_null() {
                tr.failures += 1;
                continue;
            }
            let pat = (step % 251) as u8;
            // SAFETY: p owns `size` bytes and nothing else points at them.
            unsafe { std::ptr::write_bytes(p, pat, size) };
            live.push((p, layout, pat));
            tr.allocs += 1;
            tr.peak_blocks = tr.peak_blocks.max(live.len());
        }
    }
    check_disjoint(&live);
    (tr, live)
}

/// # Safety
/// Every block must have come from `a` with the layout recorded beside it.
pub unsafe fn drain_live<A: GlobalAlloc>(a: &A, live: Vec<Block>) -> usize {
    let n = live.len();
    for (p, l, pat) in live {
        // SAFETY: we wrote pat over all l.size() bytes and still own them.
        let bytes = unsafe { std::slice::from_raw_parts(p, l.size()) };
        assert!(bytes.iter().all(|&b| b == pat), "a live block was written over");
        // SAFETY: the caller's contract.
        unsafe { a.dealloc(p, l) };
    }
    n
}
pub fn run() -> Trace {
    let heap = Heap::new();
    let (tr, live) = workload(&heap, 0x5EED, 5000);

    println!("{} allocations, {} frees, {} refused", tr.allocs, tr.frees, tr.failures);
    println!("{} blocks still live, {} at the busiest moment", live.len(), tr.peak_blocks);

    let carved = heap.used();
    // SAFETY: every block came from this heap with the layout beside it.
    let drained = unsafe { drain_live(&heap, live) };
    heap.flush();
    let (blocks, total, _) = heap.free_stats();

    println!("freed the last {drained}; the arena is {blocks} block of {total} bytes");
    assert_eq!((blocks, total), (1, carved), "the arena did not come back whole");
    tr
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_run_is_clean_and_repeatable() {
        let tr = run();
        assert_eq!(tr.failures, 0);
        assert_eq!(tr.allocs, 2511);
        assert_eq!(tr.frees, 2489);
        assert_eq!(tr.peak_blocks, LIVE_CAP);
        assert_eq!(tr, run(), "the same seed must give the same run");
    }

    #[test]
    fn every_seed_gives_the_arena_back_whole() {
        for seed in [1u64, 7, 99, 12345] {
            let heap = Heap::new();
            let (tr, live) = workload(&heap, seed, 1500);
            assert_eq!(tr.failures, 0);
            let carved = heap.used();
            // SAFETY: every block came from this heap with the layout beside it.
            unsafe { drain_live(&heap, live) };
            heap.flush();
            assert_eq!(heap.free_stats(), (1, carved, carved), "seed {seed} leaked");
        }
    }

    #[test]
    fn the_overlap_check_can_actually_fail() {
        let l = Layout::from_size_align(64, 8).unwrap();
        let mut buf = [0u8; 128];
        let p = buf.as_mut_ptr();
        // SAFETY: both offsets are inside buf, and the pointers are only
        // compared, never read through, by check_disjoint.
        let (a, b) = unsafe { (p, p.add(32)) };
        let overlapping = vec![(a, l, 0u8), (b, l, 0u8)];
        assert!(std::panic::catch_unwind(move || check_disjoint(&overlapping)).is_err());
    }

    #[test]
    fn the_generator_is_a_pure_function_of_its_seed() {
        let mut x = Rng::new(0x5EED);
        let mut y = Rng::new(0x5EED);
        for _ in 0..64 {
            assert_eq!(x.next(), y.next());
        }
        assert_ne!(Rng::new(1).next(), Rng::new(2).next());
    }
}
```

```solution
use std::alloc::{GlobalAlloc, Layout};
use std::cell::{Cell, UnsafeCell};
use std::mem::MaybeUninit;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, Ordering};
/// Bytes in the arena. Fixed at compile time: an allocator has nobody to ask.
pub const ARENA: usize = 1 << 16;

/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;

/// Round `n` up to the next multiple of `align`, which must be a power of two.
pub const fn align_up(n: usize, align: usize) -> usize {
    (n + align - 1) & !(align - 1)
}
/// Blocks up to this size get their own free list.
pub const MAX_SMALL: usize = 256;

/// One class per 16 bytes: 16, 32, 48 ... 256.
pub const NCLASS: usize = MAX_SMALL / MAX_ALIGN;
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align).ok()?;
    Some((layout.size(), layout.align()))
}
#[repr(align(16))]
struct Store {
    bytes: [MaybeUninit<u8>; ARENA],
}

impl Store {
    const fn new() -> Self {
        Store { bytes: [MaybeUninit::uninit(); ARENA] }
    }
}
/// One pointer, moving forward. Nothing else.
pub struct Bump {
    buf: UnsafeCell<Store>,
    next: Cell<usize>,
}
impl Bump {
    pub fn new() -> Self {
        Bump { buf: UnsafeCell::new(Store::new()), next: Cell::new(0) }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a reference,
        // so it cannot invalidate a pointer already handed out.
        unsafe { &raw mut (*self.buf.get()).bytes as *mut u8 }
    }

    pub fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN {
            return null_mut();
        }
        let start = align_up(self.next.get(), layout.align());
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        if end > ARENA {
            return null_mut();
        }
        self.next.set(end);
        // SAFETY: end <= ARENA, so `start` is an offset inside the single
        // object `base` points at and the whole block is in bounds. The base is
        // 16-aligned and `start` is a multiple of layout.align(), so the result
        // has the alignment the caller asked for.
        unsafe { self.base().add(start) }
    }

    pub fn used(&self) -> usize {
        self.next.get()
    }

    pub fn remaining(&self) -> usize {
        ARENA - self.next.get()
    }

    /// Hand the whole arena back at once.
    ///
    /// Taking `&mut self` is what makes this safe: any slice handed out by
    /// `alloc_slice` borrows `&self`, so none can be alive here.
    pub fn reset(&mut self) {
        self.next.set(0);
    }

    /// Allocate `n` bytes and write `fill` into every one of them, so the
    /// result is a real `&mut [u8]` rather than a claim about garbage.
    pub fn alloc_slice(&self, n: usize, fill: u8) -> Option<&mut [u8]> {
        let p = self.alloc(Layout::from_size_align(n, 1).ok()?);
        if p.is_null() {
            return None;
        }
        // SAFETY: `p` starts `n` bytes that nothing else points at, because the
        // bump pointer only ever moves forward. `write_bytes` initialises all
        // of them, so afterwards the range really is a `[u8]`. The returned
        // lifetime is that of `&self`, so `reset`, which needs `&mut self`,
        // cannot run while this slice is alive.
        unsafe {
            std::ptr::write_bytes(p, fill, n);
            Some(std::slice::from_raw_parts_mut(p, n))
        }
    }

    /// # Safety
    /// `off` must be less than `ARENA` and that byte must have been written.
    pub unsafe fn read_byte(&self, off: usize) -> u8 {
        // SAFETY: the caller guarantees the byte is in range and initialised.
        unsafe {
            (self.base() as *const MaybeUninit<u8>)
                .add(off)
                .read()
                .assume_init()
        }
    }
}
/// The header of a free block, written into the block's own bytes.
#[repr(C)]
pub struct FreeNode {
    pub size: usize,
    pub next: *mut FreeNode,
}

pub const NODE: usize = std::mem::size_of::<FreeNode>();

/// No block is smaller than a node, or the list could not live inside it.
pub const MIN_BLOCK: usize = align_up(NODE, MAX_ALIGN);

/// What a request actually costs: rounded up so every block is 16-aligned and
/// big enough to hold a `FreeNode` once it is given back.
pub fn block_size(layout: &Layout) -> usize {
    align_up(layout.size().max(MIN_BLOCK), MAX_ALIGN)
}
/// Which quick list a block of this size belongs on, if any.
pub fn class_of(size: usize) -> Option<usize> {
    if size == 0 || size > MAX_SMALL {
        None
    } else {
        Some(size / MAX_ALIGN - 1)
    }
}
/// Held for as long as the allocator's own state is being touched.
pub struct Guard<'a>(&'a AtomicBool);

impl Drop for Guard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
/// A free list threaded through the arena's own free bytes.
pub struct Heap {
    arena: UnsafeCell<Store>,
    bump: Cell<usize>,
    head: Cell<*mut FreeNode>,
    quick: [Cell<*mut FreeNode>; NCLASS],
    lock: AtomicBool,
}
// SAFETY: every field except `arena` is read and written only between taking
// and dropping a `Guard`, and the lock serialises those sections, so no two
// threads touch a `Cell` at once. Arena bytes belong to at most one caller at a
// time, and the allocator itself only touches bytes of blocks that are not
// currently handed out, so no byte is accessed by two threads at once either.
unsafe impl Sync for Heap {}
impl Heap {
    pub fn new() -> Self {
        Heap {
            arena: UnsafeCell::new(Store::new()),
            bump: Cell::new(0),
            head: Cell::new(null_mut()),
            quick: [const { Cell::new(null_mut::<FreeNode>()) }; NCLASS],
            lock: AtomicBool::new(false),
        }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a
        // reference, so it invalidates no pointer already handed out.
        unsafe { &raw mut (*self.arena.get()).bytes as *mut u8 }
    }

    /// A lock an allocator may hold: taking it allocates nothing.
    fn guard(&self) -> Guard<'_> {
        while self
            .lock
            .compare_exchange_weak(false, true, Ordering::Acquire, Ordering::Relaxed)
            .is_err()
        {
            std::hint::spin_loop();
        }
        Guard(&self.lock)
    }

    pub fn allocate(&self, layout: Layout) -> *mut u8 {
        let _g = self.guard();
        if layout.align() > MAX_ALIGN || layout.size() > ARENA {
            return null_mut();
        }
        let need = block_size(&layout);

        let mut p = self.pop_quick(need);
        if p.is_null() {
            p = self.pop_free(need);
        }
        if p.is_null() {
            p = self.carve(need);
        }
        p
    }

    /// # Safety
    /// `ptr` must be a block this heap returned from `allocate` with
    /// exactly this `layout`, and must not have been deallocated since.
    pub unsafe fn deallocate(&self, ptr: *mut u8, layout: Layout) {
        let _g = self.guard();
        let size = block_size(&layout);
        let node = ptr as *mut FreeNode;
        if let Some(c) = class_of(size) {
            // SAFETY: the caller has handed the block back, so nothing
            // else points into it. It is `size` >= MIN_BLOCK bytes and
            // 16-aligned, room and alignment enough for a FreeNode.
            unsafe { node.write(FreeNode { size, next: self.quick[c].get() }) };
            self.quick[c].set(node);
        } else {
            // SAFETY: as above.
            unsafe { self.insert_free(node, size) };
        }
    }

    /// Take fresh bytes off the end of the arena. This is stage two, still.
    fn carve(&self, need: usize) -> *mut u8 {
        let start = self.bump.get();
        if need > ARENA - start {
            return null_mut();
        }
        self.bump.set(start + need);
        // SAFETY: start + need <= ARENA, so the block lies inside the arena and
        // `base` carries provenance over all of it.
        unsafe { self.base().add(start) }
    }

    /// First block big enough, split if the remainder can hold a node.
    fn pop_free(&self, need: usize) -> *mut u8 {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block in the arena, 16-aligned and at least
            // MIN_BLOCK bytes, so it holds the node deallocate wrote there.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            if size >= need {
                let replacement = if size - need >= MIN_BLOCK {
                    // SAFETY: need <= size, so this offset is still inside the
                    // block, and every block lies inside the arena.
                    let rem = unsafe { (cur as *mut u8).add(need) } as *mut FreeNode;
                    // SAFETY: the remainder is at least MIN_BLOCK bytes,
                    // 16-aligned, and is not handed out to anyone.
                    unsafe { rem.write(FreeNode { size: size - need, next }) };
                    rem
                } else {
                    next
                };
                if prev.is_null() {
                    self.head.set(replacement);
                } else {
                    // SAFETY: prev is a free block on the list.
                    unsafe { (*prev).next = replacement };
                }
                return cur as *mut u8;
            }
            prev = cur;
            cur = next;
        }
        null_mut()
    }

    /// A pop from the head of one size class. No search, no split.
    fn pop_quick(&self, need: usize) -> *mut u8 {
        let Some(c) = class_of(need) else {
            return null_mut();
        };
        let head = self.quick[c].get();
        if head.is_null() {
            return null_mut();
        }
        // SAFETY: every node on quick[c] is a block of exactly `need` bytes in
        // the arena, 16-aligned and not handed out, holding the node that
        // deallocate wrote there.
        let next = unsafe { (*head).next };
        self.quick[c].set(next);
        head as *mut u8
    }

    /// # Safety
    /// `node` must point at `size` bytes of this arena that are not handed out
    /// and are on no list.
    unsafe fn insert_free(&self, node: *mut FreeNode, size: usize) {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() && cur.addr() < node.addr() {
            prev = cur;
            // SAFETY: cur is a free block on the list.
            cur = unsafe { (*cur).next };
        }
        // SAFETY: the caller guarantees these bytes are the allocator's again.
        unsafe { node.write(FreeNode { size, next: cur }) };
        if prev.is_null() {
            self.head.set(node);
        } else {
            // SAFETY: prev is a free block on the list.
            unsafe { (*prev).next = node };
        }

        if !cur.is_null() && node.addr() + size == cur.addr() {
            // SAFETY: node and cur are both free blocks on the list, and the
            // one ends exactly where the other starts.
            unsafe {
                (*node).size = size + (*cur).size;
                (*node).next = (*cur).next;
            }
        }
        if !prev.is_null() {
            // SAFETY: prev and node are both free blocks on the list.
            unsafe {
                if prev.addr() + (*prev).size == node.addr() {
                    (*prev).size += (*node).size;
                    (*prev).next = (*node).next;
                }
            }
        }
    }

    /// Return every quick list block to the main list, where it can merge.
    pub fn flush(&self) {
        let _g = self.guard();
        for c in 0..NCLASS {
            let mut cur = self.quick[c].get();
            self.quick[c].set(null_mut());
            while !cur.is_null() {
                // SAFETY: cur is a free block on quick[c].
                let (size, next) = unsafe { ((*cur).size, (*cur).next) };
                // SAFETY: cur has just been taken off every list.
                unsafe { self.insert_free(cur, size) };
                cur = next;
            }
        }
    }

    /// (blocks, total free bytes, largest free block)
    pub fn free_stats(&self) -> (usize, usize, usize) {
        let _g = self.guard();
        let (mut n, mut total, mut largest) = (0, 0, 0);
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block on the list.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            n += 1;
            total += size;
            if size > largest {
                largest = size;
            }
            cur = next;
        }
        (n, total, largest)
    }

    /// Bytes ever carved off the end of the arena.
    pub fn used(&self) -> usize {
        let _g = self.guard();
        self.bump.get()
    }
}
unsafe impl GlobalAlloc for Heap {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        self.allocate(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // SAFETY: `dealloc`'s contract on the caller is word for word
        // `deallocate`'s contract, so there is nothing left to check here.
        unsafe { self.deallocate(ptr, layout) }
    }
}
/// Every thread allocates its own blocks, stamps them, waits until all of them
/// are live, then checks nobody else wrote into its bytes.
pub fn hammer(heap: &Heap, threads: usize, per_thread: usize) -> Vec<(usize, usize)> {
    let barrier = std::sync::Barrier::new(threads);
    std::thread::scope(|s| {
        let hs: Vec<_> = (0..threads)
            .map(|t| {
                let barrier = &barrier;
                s.spawn(move || {
                    let stamp = t as u8 + 1;
                    let mut mine: Vec<(*mut u8, Layout)> = Vec::new();
                    for i in 0..per_thread {
                        let size = [32usize, 64, 96, 128][(t + i) % 4];
                        let layout = Layout::from_size_align(size, 8).unwrap();
                        let p = heap.allocate(layout);
                        assert!(!p.is_null(), "arena exhausted");
                        // SAFETY: p is ours alone and owns `size` bytes.
                        unsafe { std::ptr::write_bytes(p, stamp, size) };
                        mine.push((p, layout));
                    }
                    let spans: Vec<(usize, usize)> = mine
                        .iter()
                        .map(|&(p, l)| (p.addr(), p.addr() + block_size(&l)))
                        .collect();
                    barrier.wait();
                    for &(p, l) in &mine {
                        // SAFETY: we own these bytes and wrote every one.
                        let bytes = unsafe { std::slice::from_raw_parts(p, l.size()) };
                        assert!(
                            bytes.iter().all(|&b| b == stamp),
                            "another thread was handed our block"
                        );
                    }
                    for (p, l) in mine {
                        // SAFETY: allocated here with l, freed exactly once.
                        unsafe { heap.deallocate(p, l) };
                    }
                    spans
                })
            })
            .collect();
        hs.into_iter().flat_map(|h| h.join().unwrap()).collect()
    })
}
/// xorshift64. Deterministic, seeded, and about ten instructions.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed | 1)
    }

    pub fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    pub fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

pub type Block = (*mut u8, Layout, u8);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Trace {
    pub allocs: usize,
    pub frees: usize,
    pub failures: usize,
    pub peak_blocks: usize,
}

pub const SIZES: [usize; 8] = [1, 8, 17, 32, 64, 100, 256, 700];
pub const LIVE_CAP: usize = 24;

/// The invariant that matters: two live blocks never share a byte.
pub fn check_disjoint(live: &[Block]) {
    let mut spans: Vec<(usize, usize)> = live
        .iter()
        .map(|&(p, l, _)| (p.addr(), p.addr() + l.size()))
        .collect();
    spans.sort_unstable();
    for w in spans.windows(2) {
        assert!(w[0].1 <= w[1].0, "live blocks overlap: {:?} and {:?}", w[0], w[1]);
    }
}

pub fn workload<A: GlobalAlloc>(a: &A, seed: u64, steps: usize) -> (Trace, Vec<Block>) {
    let mut rng = Rng::new(seed);
    let mut live: Vec<Block> = Vec::new();
    let mut tr = Trace { allocs: 0, frees: 0, failures: 0, peak_blocks: 0 };

    for step in 0..steps {
        let free_now = !live.is_empty() && (live.len() >= LIVE_CAP || rng.below(100) < 45);
        if free_now {
            let i = rng.below(live.len());
            let (p, l, pat) = live[i];
            // SAFETY: we wrote pat over all l.size() bytes and still own them.
            let bytes = unsafe { std::slice::from_raw_parts(p, l.size()) };
            assert!(bytes.iter().all(|&b| b == pat), "a live block was written over");
            live.swap_remove(i);
            // SAFETY: p came from a.alloc with exactly l, and is freed once.
            unsafe { a.dealloc(p, l) };
            tr.frees += 1;
        } else {
            let size = SIZES[rng.below(SIZES.len())];
            let layout = Layout::from_size_align(size, 8).unwrap();
            // SAFETY: the layout has non-zero size.
            let p = unsafe { a.alloc(layout) };
            if p.is_null() {
                tr.failures += 1;
                continue;
            }
            let pat = (step % 251) as u8;
            // SAFETY: p owns `size` bytes and nothing else points at them.
            unsafe { std::ptr::write_bytes(p, pat, size) };
            live.push((p, layout, pat));
            tr.allocs += 1;
            tr.peak_blocks = tr.peak_blocks.max(live.len());
        }
    }
    check_disjoint(&live);
    (tr, live)
}

/// # Safety
/// Every block must have come from `a` with the layout recorded beside it.
pub unsafe fn drain_live<A: GlobalAlloc>(a: &A, live: Vec<Block>) -> usize {
    let n = live.len();
    for (p, l, pat) in live {
        // SAFETY: we wrote pat over all l.size() bytes and still own them.
        let bytes = unsafe { std::slice::from_raw_parts(p, l.size()) };
        assert!(bytes.iter().all(|&b| b == pat), "a live block was written over");
        // SAFETY: the caller's contract.
        unsafe { a.dealloc(p, l) };
    }
    n
}
pub fn run() -> Trace {
    let heap = Heap::new();
    let (tr, live) = workload(&heap, 0x5EED, 5000);

    println!("{} allocations, {} frees, {} refused", tr.allocs, tr.frees, tr.failures);
    println!("{} blocks still live, {} at the busiest moment", live.len(), tr.peak_blocks);

    let carved = heap.used();
    // SAFETY: every block came from this heap with the layout beside it.
    let drained = unsafe { drain_live(&heap, live) };
    heap.flush();
    let (blocks, total, _) = heap.free_stats();

    println!("freed the last {drained}; the arena is {blocks} block of {total} bytes");
    assert_eq!((blocks, total), (1, carved), "the arena did not come back whole");
    tr
}
```

@hint `&live[i]` borrows the vector for as long as the binding lives, and `swap_remove` needs it exclusively.
@hint A `Block` is a tuple of three `Copy` types. You can take a copy instead of a reference and the borrow ends on that line.
@hint `let (p, l, pat) = live[i];`

@diagnose E0502
`cannot borrow live as mutable because it is also borrowed as immutable`, with
the shared borrow at `&live[i]` and the mutable one at `swap_remove`.

The borrow is alive because `block` is used after the removal. This is the
borrow checker catching a real bug, not a formality: `swap_remove` moves the last
element into slot `i`, so a reference into that slot would afterwards point at a
different block, and you would hand the wrong pointer and the wrong layout to
`dealloc`. In this file that is a double free of one block and a leak of
another.

Destructure by value instead. `p`, `l` and `pat` are copies, the vector is
untouched, and `swap_remove` is free to do its swap.

@diagnose E0507
`cannot move out of index of Vec<Block>`.

You wrote `let block = live[i];` while `Block` still contained something not
`Copy`, or changed the tuple. Indexing a `Vec` gives a place, and taking the
value out of a place moves it, which a `Vec` will not allow because it would
leave a hole.

`Block` is `(*mut u8, Layout, u8)` and all three are `Copy`, so the plain
indexing form works and copies. Raw pointers are always `Copy`, which is worth
noticing: there is no ownership tracking on a `*mut u8` at all, so nothing in the
type system says which of the two copies is responsible for freeing it. The
tests are the only thing that knows.

@after
What these tests actually prove: with this seed, no two live blocks overlapped,
every block still held the pattern written into it, and after the last free the
arena coalesced back to a single block of exactly the bytes ever carved. That
last assertion is the leak check, and it is stronger than counting allocations,
because it also fails if a block comes back with the wrong size.

What they do not prove. A test observes values; undefined behaviour is not a
value. Miri would check things no assertion here can reach, and the playground
cannot run it, so take this as a claim about Miri rather than something these
tests demonstrate: it tracks the provenance of every pointer, so it would reject
an `add` that leaves the arena even if nothing dereferences the result. It tracks
initialisation per byte, so it would reject a slice built over bytes nobody
wrote. It tracks the borrow stack, so it would reject a read through a pointer
that a later `&mut` had invalidated. Under `-Zmiri-many-seeds` it also drives
threads through orderings a real machine may take years to produce.

The fixed seed matters. A random test that fails once and cannot be reproduced is
worse than no test, because it teaches the team to rerun the suite.

## 12. Measure it, and be honest

@kind fix
@concept fragmentation

@expect E0061

Numbers, or it did not happen. Allocation counts, a high water mark,
fragmentation at the busiest moment, and the same workload through the system
allocator. Three bodies are stubbed and one call to `System` is written as though
`alloc` were an associated function.

```starter
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::{Cell, UnsafeCell};
use std::mem::MaybeUninit;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
/// Bytes in the arena. Fixed at compile time: an allocator has nobody to ask.
pub const ARENA: usize = 1 << 16;

/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;

/// Round `n` up to the next multiple of `align`, which must be a power of two.
pub const fn align_up(n: usize, align: usize) -> usize {
    (n + align - 1) & !(align - 1)
}
/// Blocks up to this size get their own free list.
pub const MAX_SMALL: usize = 256;

/// One class per 16 bytes: 16, 32, 48 ... 256.
pub const NCLASS: usize = MAX_SMALL / MAX_ALIGN;
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align).ok()?;
    Some((layout.size(), layout.align()))
}
#[repr(align(16))]
struct Store {
    bytes: [MaybeUninit<u8>; ARENA],
}

impl Store {
    const fn new() -> Self {
        Store { bytes: [MaybeUninit::uninit(); ARENA] }
    }
}
/// One pointer, moving forward. Nothing else.
pub struct Bump {
    buf: UnsafeCell<Store>,
    next: Cell<usize>,
}
impl Bump {
    pub fn new() -> Self {
        Bump { buf: UnsafeCell::new(Store::new()), next: Cell::new(0) }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a reference,
        // so it cannot invalidate a pointer already handed out.
        unsafe { &raw mut (*self.buf.get()).bytes as *mut u8 }
    }

    pub fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN {
            return null_mut();
        }
        let start = align_up(self.next.get(), layout.align());
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        if end > ARENA {
            return null_mut();
        }
        self.next.set(end);
        // SAFETY: end <= ARENA, so `start` is an offset inside the single
        // object `base` points at and the whole block is in bounds. The base is
        // 16-aligned and `start` is a multiple of layout.align(), so the result
        // has the alignment the caller asked for.
        unsafe { self.base().add(start) }
    }

    pub fn used(&self) -> usize {
        self.next.get()
    }

    pub fn remaining(&self) -> usize {
        ARENA - self.next.get()
    }

    /// Hand the whole arena back at once.
    ///
    /// Taking `&mut self` is what makes this safe: any slice handed out by
    /// `alloc_slice` borrows `&self`, so none can be alive here.
    pub fn reset(&mut self) {
        self.next.set(0);
    }

    /// Allocate `n` bytes and write `fill` into every one of them, so the
    /// result is a real `&mut [u8]` rather than a claim about garbage.
    pub fn alloc_slice(&self, n: usize, fill: u8) -> Option<&mut [u8]> {
        let p = self.alloc(Layout::from_size_align(n, 1).ok()?);
        if p.is_null() {
            return None;
        }
        // SAFETY: `p` starts `n` bytes that nothing else points at, because the
        // bump pointer only ever moves forward. `write_bytes` initialises all
        // of them, so afterwards the range really is a `[u8]`. The returned
        // lifetime is that of `&self`, so `reset`, which needs `&mut self`,
        // cannot run while this slice is alive.
        unsafe {
            std::ptr::write_bytes(p, fill, n);
            Some(std::slice::from_raw_parts_mut(p, n))
        }
    }

    /// # Safety
    /// `off` must be less than `ARENA` and that byte must have been written.
    pub unsafe fn read_byte(&self, off: usize) -> u8 {
        // SAFETY: the caller guarantees the byte is in range and initialised.
        unsafe {
            (self.base() as *const MaybeUninit<u8>)
                .add(off)
                .read()
                .assume_init()
        }
    }
}
/// The header of a free block, written into the block's own bytes.
#[repr(C)]
pub struct FreeNode {
    pub size: usize,
    pub next: *mut FreeNode,
}

pub const NODE: usize = std::mem::size_of::<FreeNode>();

/// No block is smaller than a node, or the list could not live inside it.
pub const MIN_BLOCK: usize = align_up(NODE, MAX_ALIGN);

/// What a request actually costs: rounded up so every block is 16-aligned and
/// big enough to hold a `FreeNode` once it is given back.
pub fn block_size(layout: &Layout) -> usize {
    align_up(layout.size().max(MIN_BLOCK), MAX_ALIGN)
}
/// Which quick list a block of this size belongs on, if any.
pub fn class_of(size: usize) -> Option<usize> {
    if size == 0 || size > MAX_SMALL {
        None
    } else {
        Some(size / MAX_ALIGN - 1)
    }
}
/// Held for as long as the allocator's own state is being touched.
pub struct Guard<'a>(&'a AtomicBool);

impl Drop for Guard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
/// A free list threaded through the arena's own free bytes.
pub struct Heap {
    arena: UnsafeCell<Store>,
    bump: Cell<usize>,
    head: Cell<*mut FreeNode>,
    quick: [Cell<*mut FreeNode>; NCLASS],
    live: Cell<usize>,
    peak: Cell<usize>,
    allocs: Cell<usize>,
    frees: Cell<usize>,
    lock: AtomicBool,
}
// SAFETY: every field except `arena` is read and written only between taking
// and dropping a `Guard`, and the lock serialises those sections, so no two
// threads touch a `Cell` at once. Arena bytes belong to at most one caller at a
// time, and the allocator itself only touches bytes of blocks that are not
// currently handed out, so no byte is accessed by two threads at once either.
unsafe impl Sync for Heap {}
impl Heap {
    pub fn new() -> Self {
        Heap {
            arena: UnsafeCell::new(Store::new()),
            bump: Cell::new(0),
            head: Cell::new(null_mut()),
            quick: [const { Cell::new(null_mut::<FreeNode>()) }; NCLASS],
            live: Cell::new(0),
            peak: Cell::new(0),
            allocs: Cell::new(0),
            frees: Cell::new(0),
            lock: AtomicBool::new(false),
        }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a
        // reference, so it invalidates no pointer already handed out.
        unsafe { &raw mut (*self.arena.get()).bytes as *mut u8 }
    }

    /// A lock an allocator may hold: taking it allocates nothing.
    fn guard(&self) -> Guard<'_> {
        while self
            .lock
            .compare_exchange_weak(false, true, Ordering::Acquire, Ordering::Relaxed)
            .is_err()
        {
            std::hint::spin_loop();
        }
        Guard(&self.lock)
    }

    pub fn allocate(&self, layout: Layout) -> *mut u8 {
        let _g = self.guard();
        if layout.align() > MAX_ALIGN || layout.size() > ARENA {
            return null_mut();
        }
        let need = block_size(&layout);

        let mut p = self.pop_quick(need);
        if p.is_null() {
            p = self.pop_free(need);
        }
        if p.is_null() {
            p = self.carve(need);
        }
        // TODO: count the allocation, and move the high water mark.
        p
    }

    /// # Safety
    /// `ptr` must be a block this heap returned from `allocate` with
    /// exactly this `layout`, and must not have been deallocated since.
    pub unsafe fn deallocate(&self, ptr: *mut u8, layout: Layout) {
        let _g = self.guard();
        let size = block_size(&layout);
        // TODO: count the free.
        let node = ptr as *mut FreeNode;
        if let Some(c) = class_of(size) {
            // SAFETY: the caller has handed the block back, so nothing
            // else points into it. It is `size` >= MIN_BLOCK bytes and
            // 16-aligned, room and alignment enough for a FreeNode.
            unsafe { node.write(FreeNode { size, next: self.quick[c].get() }) };
            self.quick[c].set(node);
        } else {
            // SAFETY: as above.
            unsafe { self.insert_free(node, size) };
        }
    }

    /// Take fresh bytes off the end of the arena. This is stage two, still.
    fn carve(&self, need: usize) -> *mut u8 {
        let start = self.bump.get();
        if need > ARENA - start {
            return null_mut();
        }
        self.bump.set(start + need);
        // SAFETY: start + need <= ARENA, so the block lies inside the arena and
        // `base` carries provenance over all of it.
        unsafe { self.base().add(start) }
    }

    /// First block big enough, split if the remainder can hold a node.
    fn pop_free(&self, need: usize) -> *mut u8 {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block in the arena, 16-aligned and at least
            // MIN_BLOCK bytes, so it holds the node deallocate wrote there.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            if size >= need {
                let replacement = if size - need >= MIN_BLOCK {
                    // SAFETY: need <= size, so this offset is still inside the
                    // block, and every block lies inside the arena.
                    let rem = unsafe { (cur as *mut u8).add(need) } as *mut FreeNode;
                    // SAFETY: the remainder is at least MIN_BLOCK bytes,
                    // 16-aligned, and is not handed out to anyone.
                    unsafe { rem.write(FreeNode { size: size - need, next }) };
                    rem
                } else {
                    next
                };
                if prev.is_null() {
                    self.head.set(replacement);
                } else {
                    // SAFETY: prev is a free block on the list.
                    unsafe { (*prev).next = replacement };
                }
                return cur as *mut u8;
            }
            prev = cur;
            cur = next;
        }
        null_mut()
    }

    /// A pop from the head of one size class. No search, no split.
    fn pop_quick(&self, need: usize) -> *mut u8 {
        let Some(c) = class_of(need) else {
            return null_mut();
        };
        let head = self.quick[c].get();
        if head.is_null() {
            return null_mut();
        }
        // SAFETY: every node on quick[c] is a block of exactly `need` bytes in
        // the arena, 16-aligned and not handed out, holding the node that
        // deallocate wrote there.
        let next = unsafe { (*head).next };
        self.quick[c].set(next);
        head as *mut u8
    }

    /// # Safety
    /// `node` must point at `size` bytes of this arena that are not handed out
    /// and are on no list.
    unsafe fn insert_free(&self, node: *mut FreeNode, size: usize) {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() && cur.addr() < node.addr() {
            prev = cur;
            // SAFETY: cur is a free block on the list.
            cur = unsafe { (*cur).next };
        }
        // SAFETY: the caller guarantees these bytes are the allocator's again.
        unsafe { node.write(FreeNode { size, next: cur }) };
        if prev.is_null() {
            self.head.set(node);
        } else {
            // SAFETY: prev is a free block on the list.
            unsafe { (*prev).next = node };
        }

        if !cur.is_null() && node.addr() + size == cur.addr() {
            // SAFETY: node and cur are both free blocks on the list, and the
            // one ends exactly where the other starts.
            unsafe {
                (*node).size = size + (*cur).size;
                (*node).next = (*cur).next;
            }
        }
        if !prev.is_null() {
            // SAFETY: prev and node are both free blocks on the list.
            unsafe {
                if prev.addr() + (*prev).size == node.addr() {
                    (*prev).size += (*node).size;
                    (*prev).next = (*node).next;
                }
            }
        }
    }

    /// Return every quick list block to the main list, where it can merge.
    pub fn flush(&self) {
        let _g = self.guard();
        for c in 0..NCLASS {
            let mut cur = self.quick[c].get();
            self.quick[c].set(null_mut());
            while !cur.is_null() {
                // SAFETY: cur is a free block on quick[c].
                let (size, next) = unsafe { ((*cur).size, (*cur).next) };
                // SAFETY: cur has just been taken off every list.
                unsafe { self.insert_free(cur, size) };
                cur = next;
            }
        }
    }

    /// (blocks, total free bytes, largest free block)
    pub fn free_stats(&self) -> (usize, usize, usize) {
        let _g = self.guard();
        let (mut n, mut total, mut largest) = (0, 0, 0);
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block on the list.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            n += 1;
            total += size;
            if size > largest {
                largest = size;
            }
            cur = next;
        }
        (n, total, largest)
    }

    /// Bytes ever carved off the end of the arena.
    pub fn used(&self) -> usize {
        let _g = self.guard();
        self.bump.get()
    }

    /// How much of the free space is stranded outside the largest hole.
    pub fn fragmentation(&self) -> f64 {
        todo!("what share of the free bytes is stranded outside the biggest hole?")
    }

    pub fn live_bytes(&self) -> usize {
        let _g = self.guard();
        self.live.get()
    }

    pub fn peak_bytes(&self) -> usize {
        let _g = self.guard();
        self.peak.get()
    }

    pub fn counts(&self) -> (usize, usize) {
        let _g = self.guard();
        (self.allocs.get(), self.frees.get())
    }
}
unsafe impl GlobalAlloc for Heap {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        self.allocate(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // SAFETY: `dealloc`'s contract on the caller is word for word
        // `deallocate`'s contract, so there is nothing left to check here.
        unsafe { self.deallocate(ptr, layout) }
    }
}
/// Every thread allocates its own blocks, stamps them, waits until all of them
/// are live, then checks nobody else wrote into its bytes.
pub fn hammer(heap: &Heap, threads: usize, per_thread: usize) -> Vec<(usize, usize)> {
    let barrier = std::sync::Barrier::new(threads);
    std::thread::scope(|s| {
        let hs: Vec<_> = (0..threads)
            .map(|t| {
                let barrier = &barrier;
                s.spawn(move || {
                    let stamp = t as u8 + 1;
                    let mut mine: Vec<(*mut u8, Layout)> = Vec::new();
                    for i in 0..per_thread {
                        let size = [32usize, 64, 96, 128][(t + i) % 4];
                        let layout = Layout::from_size_align(size, 8).unwrap();
                        let p = heap.allocate(layout);
                        assert!(!p.is_null(), "arena exhausted");
                        // SAFETY: p is ours alone and owns `size` bytes.
                        unsafe { std::ptr::write_bytes(p, stamp, size) };
                        mine.push((p, layout));
                    }
                    let spans: Vec<(usize, usize)> = mine
                        .iter()
                        .map(|&(p, l)| (p.addr(), p.addr() + block_size(&l)))
                        .collect();
                    barrier.wait();
                    for &(p, l) in &mine {
                        // SAFETY: we own these bytes and wrote every one.
                        let bytes = unsafe { std::slice::from_raw_parts(p, l.size()) };
                        assert!(
                            bytes.iter().all(|&b| b == stamp),
                            "another thread was handed our block"
                        );
                    }
                    for (p, l) in mine {
                        // SAFETY: allocated here with l, freed exactly once.
                        unsafe { heap.deallocate(p, l) };
                    }
                    spans
                })
            })
            .collect();
        hs.into_iter().flat_map(|h| h.join().unwrap()).collect()
    })
}
/// xorshift64. Deterministic, seeded, and about ten instructions.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed | 1)
    }

    pub fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    pub fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

pub type Block = (*mut u8, Layout, u8);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Trace {
    pub allocs: usize,
    pub frees: usize,
    pub failures: usize,
    pub peak_blocks: usize,
}

pub const SIZES: [usize; 8] = [1, 8, 17, 32, 64, 100, 256, 700];
pub const LIVE_CAP: usize = 24;

/// The invariant that matters: two live blocks never share a byte.
pub fn check_disjoint(live: &[Block]) {
    let mut spans: Vec<(usize, usize)> = live
        .iter()
        .map(|&(p, l, _)| (p.addr(), p.addr() + l.size()))
        .collect();
    spans.sort_unstable();
    for w in spans.windows(2) {
        assert!(w[0].1 <= w[1].0, "live blocks overlap: {:?} and {:?}", w[0], w[1]);
    }
}

pub fn workload<A: GlobalAlloc>(a: &A, seed: u64, steps: usize) -> (Trace, Vec<Block>) {
    let mut rng = Rng::new(seed);
    let mut live: Vec<Block> = Vec::new();
    let mut tr = Trace { allocs: 0, frees: 0, failures: 0, peak_blocks: 0 };

    for step in 0..steps {
        let free_now = !live.is_empty() && (live.len() >= LIVE_CAP || rng.below(100) < 45);
        if free_now {
            let i = rng.below(live.len());
            let (p, l, pat) = live[i];
            // SAFETY: we wrote pat over all l.size() bytes and still own them.
            let bytes = unsafe { std::slice::from_raw_parts(p, l.size()) };
            assert!(bytes.iter().all(|&b| b == pat), "a live block was written over");
            live.swap_remove(i);
            // SAFETY: p came from a.alloc with exactly l, and is freed once.
            unsafe { a.dealloc(p, l) };
            tr.frees += 1;
        } else {
            let size = SIZES[rng.below(SIZES.len())];
            let layout = Layout::from_size_align(size, 8).unwrap();
            // SAFETY: the layout has non-zero size.
            let p = unsafe { a.alloc(layout) };
            if p.is_null() {
                tr.failures += 1;
                continue;
            }
            let pat = (step % 251) as u8;
            // SAFETY: p owns `size` bytes and nothing else points at them.
            unsafe { std::ptr::write_bytes(p, pat, size) };
            live.push((p, layout, pat));
            tr.allocs += 1;
            tr.peak_blocks = tr.peak_blocks.max(live.len());
        }
    }
    check_disjoint(&live);
    (tr, live)
}

/// # Safety
/// Every block must have come from `a` with the layout recorded beside it.
pub unsafe fn drain_live<A: GlobalAlloc>(a: &A, live: Vec<Block>) -> usize {
    let n = live.len();
    for (p, l, pat) in live {
        // SAFETY: we wrote pat over all l.size() bytes and still own them.
        let bytes = unsafe { std::slice::from_raw_parts(p, l.size()) };
        assert!(bytes.iter().all(|&b| b == pat), "a live block was written over");
        // SAFETY: the caller's contract.
        unsafe { a.dealloc(p, l) };
    }
    n
}
/// A tight mixed workload, timed. Sizes small enough that both allocators are
/// on their fast path.
pub fn bench<A: GlobalAlloc>(a: &A, seed: u64, steps: usize) -> f64 {
    let sizes = [16usize, 48, 96, 160];
    let mut live: Vec<(*mut u8, Layout)> = Vec::with_capacity(LIVE_CAP + 1);
    let mut rng = Rng::new(seed);
    let t = Instant::now();
    for _ in 0..steps {
        if !live.is_empty() && (live.len() >= LIVE_CAP || rng.below(2) == 0) {
            let i = rng.below(live.len());
            let (p, l) = live.swap_remove(i);
            // SAFETY: p came from a.alloc with l, and is freed once.
            unsafe { a.dealloc(p, l) };
        } else {
            let l = Layout::from_size_align(sizes[rng.below(4)], 8).unwrap();
            // SAFETY: the layout has non-zero size.
            let p = unsafe { a.alloc(l) };
            if !p.is_null() {
                live.push((p, l));
            }
        }
    }
    let ns = t.elapsed().as_secs_f64() * 1e9 / steps as f64;
    for (p, l) in live.drain(..) {
        // SAFETY: as above.
        unsafe { a.dealloc(p, l) };
    }
    ns
}

/// The workload a bump allocator is built for: allocate a frame, drop it whole.
pub fn bench_frames_bump(rounds: usize) -> f64 {
    const PER_ROUND: usize = 64;
    let mut bump = Bump::new();
    let layout = Layout::from_size_align(48, 8).unwrap();
    let t = Instant::now();
    for _ in 0..rounds {
        for _ in 0..PER_ROUND {
            let p = bump.alloc(layout);
            assert!(!p.is_null());
        }
        bump.reset();
    }
    t.elapsed().as_secs_f64() * 1e9 / (rounds * PER_ROUND) as f64
}

pub fn bench_frames_system(rounds: usize) -> f64 {
    const PER_ROUND: usize = 64;
    let layout = Layout::from_size_align(48, 8).unwrap();
    let mut held = [null_mut::<u8>(); PER_ROUND];
    let t = Instant::now();
    for _ in 0..rounds {
        for slot in held.iter_mut() {
            // SAFETY: the layout has non-zero size.
            *slot = unsafe { System::alloc(layout) };
            assert!(!slot.is_null());
        }
        for slot in held.iter_mut() {
            // SAFETY: each pointer came from System.alloc with this layout.
            unsafe { System.dealloc(*slot, layout) };
        }
    }
    t.elapsed().as_secs_f64() * 1e9 / (rounds * PER_ROUND) as f64
}

#[derive(Debug, Clone, Copy)]
pub struct Report {
    pub allocs: usize,
    pub frees: usize,
    pub failures: usize,
    pub peak_bytes: usize,
    pub arena_used: usize,
    pub free_blocks: usize,
    pub fragmentation: f64,
    pub ours_ns: f64,
    pub system_ns: f64,
    pub frame_ns: f64,
    pub frame_system_ns: f64,
}
pub fn run() -> Report {
    let heap = Heap::new();
    let (tr, live) = workload(&heap, 0x5EED, 5000);

    let peak_bytes = heap.peak_bytes();
    let arena_used = heap.used();
    let (free_blocks, free_bytes, largest) = heap.free_stats();
    let fragmentation = heap.fragmentation();

    println!("after 5000 steps against a {ARENA} byte arena");
    println!("  allocations     {}", tr.allocs);
    println!("  frees           {}", tr.frees);
    println!("  refused         {}", tr.failures);
    println!("  peak live bytes {peak_bytes}");
    println!("  arena carved    {arena_used}");
    println!("  free list       {free_blocks} blocks, {free_bytes} bytes, largest {largest}");
    println!("  fragmentation   {fragmentation:.3}");

    // SAFETY: every block came from this heap with the layout beside it.
    let drained = unsafe { drain_live(&heap, live) };
    heap.flush();
    let (blocks, total, _) = heap.free_stats();
    println!("  after {drained} more frees and a flush: {blocks} block of {total} bytes");
    assert_eq!(blocks, 1, "the arena did not coalesce back to one block");
    assert_eq!(total, arena_used, "bytes went missing");
    assert_eq!(heap.live_bytes(), 0);

    let fresh = Heap::new();
    let ours_ns = bench(&fresh, 0xA11C, 20000);
    let system_ns = bench(&System, 0xA11C, 20000);
    let frame_ns = bench_frames_bump(500);
    let frame_system_ns = bench_frames_system(500);
    println!("mixed alloc and free: ours {ours_ns:.0} ns/op, System {system_ns:.0} ns/op");
    println!("frame workload:       bump {frame_ns:.0} ns/op, System {frame_system_ns:.0} ns/op");

    Report {
        allocs: tr.allocs,
        frees: tr.frees,
        failures: tr.failures,
        peak_bytes,
        arena_used,
        free_blocks,
        fragmentation,
        ours_ns,
        system_ns,
        frame_ns,
        frame_system_ns,
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_report_is_deterministic() {
        let r = run();
        assert_eq!(r.failures, 0);
        assert_eq!((r.allocs, r.frees), (2511, 2489));
        assert_eq!(r.peak_bytes, 8112);
        assert_eq!(r.arena_used, 12384);
        assert_eq!(r.free_blocks, 4);
        assert!((r.fragmentation - 0.0996).abs() < 0.001, "{}", r.fragmentation);
        assert!(r.ours_ns > 0.0 && r.system_ns > 0.0);
        assert!(r.frame_ns > 0.0 && r.frame_system_ns > 0.0);
    }

    #[test]
    fn peak_is_a_high_water_mark_not_a_current_reading() {
        let heap = Heap::new();
        let l = Layout::from_size_align(1000, 8).unwrap();
        let ps: Vec<*mut u8> = (0..4).map(|_| heap.allocate(l)).collect();
        assert_eq!(heap.peak_bytes(), 4 * 1008);
        assert_eq!(heap.live_bytes(), 4 * 1008);
        for p in ps {
            // SAFETY: each came from this heap with l and is freed once.
            unsafe { heap.deallocate(p, l) };
        }
        assert_eq!(heap.live_bytes(), 0);
        assert_eq!(heap.peak_bytes(), 4 * 1008);
        assert_eq!(heap.counts(), (4, 4));
    }

    #[test]
    fn fragmentation_is_the_share_outside_the_biggest_hole() {
        let heap = Heap::new();
        assert_eq!(heap.fragmentation(), 0.0);
        let l = Layout::from_size_align(64, 8).unwrap();
        let a = heap.allocate(l);
        let b = heap.allocate(l);
        let c = heap.allocate(l);
        // SAFETY: both came from this heap with l and are freed once.
        unsafe {
            heap.deallocate(a, l);
            heap.deallocate(c, l);
        }
        heap.flush();
        assert!((heap.fragmentation() - 0.5).abs() < 1e-9);
        // SAFETY: b came from this heap with l and is freed once.
        unsafe { heap.deallocate(b, l) };
        heap.flush();
        assert_eq!(heap.fragmentation(), 0.0);
        assert_eq!(heap.live_bytes(), 0);
    }

    #[test]
    fn the_arena_is_smaller_than_the_traffic_through_it() {
        let r = run();
        assert!(r.arena_used < ARENA);
        assert!(r.allocs * 100 > r.arena_used, "reuse, not growth");
    }
}
```

```solution
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::{Cell, UnsafeCell};
use std::mem::MaybeUninit;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
/// Bytes in the arena. Fixed at compile time: an allocator has nobody to ask.
pub const ARENA: usize = 1 << 16;

/// The biggest alignment this allocator promises to honour.
pub const MAX_ALIGN: usize = 16;

/// Round `n` up to the next multiple of `align`, which must be a power of two.
pub const fn align_up(n: usize, align: usize) -> usize {
    (n + align - 1) & !(align - 1)
}
/// Blocks up to this size get their own free list.
pub const MAX_SMALL: usize = 256;

/// One class per 16 bytes: 16, 32, 48 ... 256.
pub const NCLASS: usize = MAX_SMALL / MAX_ALIGN;
/// Size and alignment, or nothing if the pair is not a layout Rust will admit.
pub fn describe(size: usize, align: usize) -> Option<(usize, usize)> {
    let layout = Layout::from_size_align(size, align).ok()?;
    Some((layout.size(), layout.align()))
}
#[repr(align(16))]
struct Store {
    bytes: [MaybeUninit<u8>; ARENA],
}

impl Store {
    const fn new() -> Self {
        Store { bytes: [MaybeUninit::uninit(); ARENA] }
    }
}
/// One pointer, moving forward. Nothing else.
pub struct Bump {
    buf: UnsafeCell<Store>,
    next: Cell<usize>,
}
impl Bump {
    pub fn new() -> Self {
        Bump { buf: UnsafeCell::new(Store::new()), next: Cell::new(0) }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a reference,
        // so it cannot invalidate a pointer already handed out.
        unsafe { &raw mut (*self.buf.get()).bytes as *mut u8 }
    }

    pub fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.align() > MAX_ALIGN {
            return null_mut();
        }
        let start = align_up(self.next.get(), layout.align());
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        if end > ARENA {
            return null_mut();
        }
        self.next.set(end);
        // SAFETY: end <= ARENA, so `start` is an offset inside the single
        // object `base` points at and the whole block is in bounds. The base is
        // 16-aligned and `start` is a multiple of layout.align(), so the result
        // has the alignment the caller asked for.
        unsafe { self.base().add(start) }
    }

    pub fn used(&self) -> usize {
        self.next.get()
    }

    pub fn remaining(&self) -> usize {
        ARENA - self.next.get()
    }

    /// Hand the whole arena back at once.
    ///
    /// Taking `&mut self` is what makes this safe: any slice handed out by
    /// `alloc_slice` borrows `&self`, so none can be alive here.
    pub fn reset(&mut self) {
        self.next.set(0);
    }

    /// Allocate `n` bytes and write `fill` into every one of them, so the
    /// result is a real `&mut [u8]` rather than a claim about garbage.
    pub fn alloc_slice(&self, n: usize, fill: u8) -> Option<&mut [u8]> {
        let p = self.alloc(Layout::from_size_align(n, 1).ok()?);
        if p.is_null() {
            return None;
        }
        // SAFETY: `p` starts `n` bytes that nothing else points at, because the
        // bump pointer only ever moves forward. `write_bytes` initialises all
        // of them, so afterwards the range really is a `[u8]`. The returned
        // lifetime is that of `&self`, so `reset`, which needs `&mut self`,
        // cannot run while this slice is alive.
        unsafe {
            std::ptr::write_bytes(p, fill, n);
            Some(std::slice::from_raw_parts_mut(p, n))
        }
    }

    /// # Safety
    /// `off` must be less than `ARENA` and that byte must have been written.
    pub unsafe fn read_byte(&self, off: usize) -> u8 {
        // SAFETY: the caller guarantees the byte is in range and initialised.
        unsafe {
            (self.base() as *const MaybeUninit<u8>)
                .add(off)
                .read()
                .assume_init()
        }
    }
}
/// The header of a free block, written into the block's own bytes.
#[repr(C)]
pub struct FreeNode {
    pub size: usize,
    pub next: *mut FreeNode,
}

pub const NODE: usize = std::mem::size_of::<FreeNode>();

/// No block is smaller than a node, or the list could not live inside it.
pub const MIN_BLOCK: usize = align_up(NODE, MAX_ALIGN);

/// What a request actually costs: rounded up so every block is 16-aligned and
/// big enough to hold a `FreeNode` once it is given back.
pub fn block_size(layout: &Layout) -> usize {
    align_up(layout.size().max(MIN_BLOCK), MAX_ALIGN)
}
/// Which quick list a block of this size belongs on, if any.
pub fn class_of(size: usize) -> Option<usize> {
    if size == 0 || size > MAX_SMALL {
        None
    } else {
        Some(size / MAX_ALIGN - 1)
    }
}
/// Held for as long as the allocator's own state is being touched.
pub struct Guard<'a>(&'a AtomicBool);

impl Drop for Guard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
/// A free list threaded through the arena's own free bytes.
pub struct Heap {
    arena: UnsafeCell<Store>,
    bump: Cell<usize>,
    head: Cell<*mut FreeNode>,
    quick: [Cell<*mut FreeNode>; NCLASS],
    live: Cell<usize>,
    peak: Cell<usize>,
    allocs: Cell<usize>,
    frees: Cell<usize>,
    lock: AtomicBool,
}
// SAFETY: every field except `arena` is read and written only between taking
// and dropping a `Guard`, and the lock serialises those sections, so no two
// threads touch a `Cell` at once. Arena bytes belong to at most one caller at a
// time, and the allocator itself only touches bytes of blocks that are not
// currently handed out, so no byte is accessed by two threads at once either.
unsafe impl Sync for Heap {}
impl Heap {
    pub fn new() -> Self {
        Heap {
            arena: UnsafeCell::new(Store::new()),
            bump: Cell::new(0),
            head: Cell::new(null_mut()),
            quick: [const { Cell::new(null_mut::<FreeNode>()) }; NCLASS],
            live: Cell::new(0),
            peak: Cell::new(0),
            allocs: Cell::new(0),
            frees: Cell::new(0),
            lock: AtomicBool::new(false),
        }
    }

    fn base(&self) -> *mut u8 {
        // SAFETY: `&raw mut` computes an address without creating a
        // reference, so it invalidates no pointer already handed out.
        unsafe { &raw mut (*self.arena.get()).bytes as *mut u8 }
    }

    /// A lock an allocator may hold: taking it allocates nothing.
    fn guard(&self) -> Guard<'_> {
        while self
            .lock
            .compare_exchange_weak(false, true, Ordering::Acquire, Ordering::Relaxed)
            .is_err()
        {
            std::hint::spin_loop();
        }
        Guard(&self.lock)
    }

    pub fn allocate(&self, layout: Layout) -> *mut u8 {
        let _g = self.guard();
        if layout.align() > MAX_ALIGN || layout.size() > ARENA {
            return null_mut();
        }
        let need = block_size(&layout);

        let mut p = self.pop_quick(need);
        if p.is_null() {
            p = self.pop_free(need);
        }
        if p.is_null() {
            p = self.carve(need);
        }
        if !p.is_null() {
            self.allocs.set(self.allocs.get() + 1);
            let live = self.live.get() + need;
            self.live.set(live);
            if live > self.peak.get() {
                self.peak.set(live);
            }
        }
        p
    }

    /// # Safety
    /// `ptr` must be a block this heap returned from `allocate` with
    /// exactly this `layout`, and must not have been deallocated since.
    pub unsafe fn deallocate(&self, ptr: *mut u8, layout: Layout) {
        let _g = self.guard();
        let size = block_size(&layout);
        self.frees.set(self.frees.get() + 1);
        self.live.set(self.live.get() - size);
        let node = ptr as *mut FreeNode;
        if let Some(c) = class_of(size) {
            // SAFETY: the caller has handed the block back, so nothing
            // else points into it. It is `size` >= MIN_BLOCK bytes and
            // 16-aligned, room and alignment enough for a FreeNode.
            unsafe { node.write(FreeNode { size, next: self.quick[c].get() }) };
            self.quick[c].set(node);
        } else {
            // SAFETY: as above.
            unsafe { self.insert_free(node, size) };
        }
    }

    /// Take fresh bytes off the end of the arena. This is stage two, still.
    fn carve(&self, need: usize) -> *mut u8 {
        let start = self.bump.get();
        if need > ARENA - start {
            return null_mut();
        }
        self.bump.set(start + need);
        // SAFETY: start + need <= ARENA, so the block lies inside the arena and
        // `base` carries provenance over all of it.
        unsafe { self.base().add(start) }
    }

    /// First block big enough, split if the remainder can hold a node.
    fn pop_free(&self, need: usize) -> *mut u8 {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block in the arena, 16-aligned and at least
            // MIN_BLOCK bytes, so it holds the node deallocate wrote there.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            if size >= need {
                let replacement = if size - need >= MIN_BLOCK {
                    // SAFETY: need <= size, so this offset is still inside the
                    // block, and every block lies inside the arena.
                    let rem = unsafe { (cur as *mut u8).add(need) } as *mut FreeNode;
                    // SAFETY: the remainder is at least MIN_BLOCK bytes,
                    // 16-aligned, and is not handed out to anyone.
                    unsafe { rem.write(FreeNode { size: size - need, next }) };
                    rem
                } else {
                    next
                };
                if prev.is_null() {
                    self.head.set(replacement);
                } else {
                    // SAFETY: prev is a free block on the list.
                    unsafe { (*prev).next = replacement };
                }
                return cur as *mut u8;
            }
            prev = cur;
            cur = next;
        }
        null_mut()
    }

    /// A pop from the head of one size class. No search, no split.
    fn pop_quick(&self, need: usize) -> *mut u8 {
        let Some(c) = class_of(need) else {
            return null_mut();
        };
        let head = self.quick[c].get();
        if head.is_null() {
            return null_mut();
        }
        // SAFETY: every node on quick[c] is a block of exactly `need` bytes in
        // the arena, 16-aligned and not handed out, holding the node that
        // deallocate wrote there.
        let next = unsafe { (*head).next };
        self.quick[c].set(next);
        head as *mut u8
    }

    /// # Safety
    /// `node` must point at `size` bytes of this arena that are not handed out
    /// and are on no list.
    unsafe fn insert_free(&self, node: *mut FreeNode, size: usize) {
        let mut prev: *mut FreeNode = null_mut();
        let mut cur = self.head.get();
        while !cur.is_null() && cur.addr() < node.addr() {
            prev = cur;
            // SAFETY: cur is a free block on the list.
            cur = unsafe { (*cur).next };
        }
        // SAFETY: the caller guarantees these bytes are the allocator's again.
        unsafe { node.write(FreeNode { size, next: cur }) };
        if prev.is_null() {
            self.head.set(node);
        } else {
            // SAFETY: prev is a free block on the list.
            unsafe { (*prev).next = node };
        }

        if !cur.is_null() && node.addr() + size == cur.addr() {
            // SAFETY: node and cur are both free blocks on the list, and the
            // one ends exactly where the other starts.
            unsafe {
                (*node).size = size + (*cur).size;
                (*node).next = (*cur).next;
            }
        }
        if !prev.is_null() {
            // SAFETY: prev and node are both free blocks on the list.
            unsafe {
                if prev.addr() + (*prev).size == node.addr() {
                    (*prev).size += (*node).size;
                    (*prev).next = (*node).next;
                }
            }
        }
    }

    /// Return every quick list block to the main list, where it can merge.
    pub fn flush(&self) {
        let _g = self.guard();
        for c in 0..NCLASS {
            let mut cur = self.quick[c].get();
            self.quick[c].set(null_mut());
            while !cur.is_null() {
                // SAFETY: cur is a free block on quick[c].
                let (size, next) = unsafe { ((*cur).size, (*cur).next) };
                // SAFETY: cur has just been taken off every list.
                unsafe { self.insert_free(cur, size) };
                cur = next;
            }
        }
    }

    /// (blocks, total free bytes, largest free block)
    pub fn free_stats(&self) -> (usize, usize, usize) {
        let _g = self.guard();
        let (mut n, mut total, mut largest) = (0, 0, 0);
        let mut cur = self.head.get();
        while !cur.is_null() {
            // SAFETY: cur is a free block on the list.
            let (size, next) = unsafe { ((*cur).size, (*cur).next) };
            n += 1;
            total += size;
            if size > largest {
                largest = size;
            }
            cur = next;
        }
        (n, total, largest)
    }

    /// Bytes ever carved off the end of the arena.
    pub fn used(&self) -> usize {
        let _g = self.guard();
        self.bump.get()
    }

    /// How much of the free space is stranded outside the largest hole.
    pub fn fragmentation(&self) -> f64 {
        let (_, total, largest) = self.free_stats();
        if total == 0 {
            0.0
        } else {
            1.0 - largest as f64 / total as f64
        }
    }

    pub fn live_bytes(&self) -> usize {
        let _g = self.guard();
        self.live.get()
    }

    pub fn peak_bytes(&self) -> usize {
        let _g = self.guard();
        self.peak.get()
    }

    pub fn counts(&self) -> (usize, usize) {
        let _g = self.guard();
        (self.allocs.get(), self.frees.get())
    }
}
unsafe impl GlobalAlloc for Heap {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        self.allocate(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // SAFETY: `dealloc`'s contract on the caller is word for word
        // `deallocate`'s contract, so there is nothing left to check here.
        unsafe { self.deallocate(ptr, layout) }
    }
}
/// Every thread allocates its own blocks, stamps them, waits until all of them
/// are live, then checks nobody else wrote into its bytes.
pub fn hammer(heap: &Heap, threads: usize, per_thread: usize) -> Vec<(usize, usize)> {
    let barrier = std::sync::Barrier::new(threads);
    std::thread::scope(|s| {
        let hs: Vec<_> = (0..threads)
            .map(|t| {
                let barrier = &barrier;
                s.spawn(move || {
                    let stamp = t as u8 + 1;
                    let mut mine: Vec<(*mut u8, Layout)> = Vec::new();
                    for i in 0..per_thread {
                        let size = [32usize, 64, 96, 128][(t + i) % 4];
                        let layout = Layout::from_size_align(size, 8).unwrap();
                        let p = heap.allocate(layout);
                        assert!(!p.is_null(), "arena exhausted");
                        // SAFETY: p is ours alone and owns `size` bytes.
                        unsafe { std::ptr::write_bytes(p, stamp, size) };
                        mine.push((p, layout));
                    }
                    let spans: Vec<(usize, usize)> = mine
                        .iter()
                        .map(|&(p, l)| (p.addr(), p.addr() + block_size(&l)))
                        .collect();
                    barrier.wait();
                    for &(p, l) in &mine {
                        // SAFETY: we own these bytes and wrote every one.
                        let bytes = unsafe { std::slice::from_raw_parts(p, l.size()) };
                        assert!(
                            bytes.iter().all(|&b| b == stamp),
                            "another thread was handed our block"
                        );
                    }
                    for (p, l) in mine {
                        // SAFETY: allocated here with l, freed exactly once.
                        unsafe { heap.deallocate(p, l) };
                    }
                    spans
                })
            })
            .collect();
        hs.into_iter().flat_map(|h| h.join().unwrap()).collect()
    })
}
/// xorshift64. Deterministic, seeded, and about ten instructions.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed | 1)
    }

    pub fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    pub fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

pub type Block = (*mut u8, Layout, u8);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Trace {
    pub allocs: usize,
    pub frees: usize,
    pub failures: usize,
    pub peak_blocks: usize,
}

pub const SIZES: [usize; 8] = [1, 8, 17, 32, 64, 100, 256, 700];
pub const LIVE_CAP: usize = 24;

/// The invariant that matters: two live blocks never share a byte.
pub fn check_disjoint(live: &[Block]) {
    let mut spans: Vec<(usize, usize)> = live
        .iter()
        .map(|&(p, l, _)| (p.addr(), p.addr() + l.size()))
        .collect();
    spans.sort_unstable();
    for w in spans.windows(2) {
        assert!(w[0].1 <= w[1].0, "live blocks overlap: {:?} and {:?}", w[0], w[1]);
    }
}

pub fn workload<A: GlobalAlloc>(a: &A, seed: u64, steps: usize) -> (Trace, Vec<Block>) {
    let mut rng = Rng::new(seed);
    let mut live: Vec<Block> = Vec::new();
    let mut tr = Trace { allocs: 0, frees: 0, failures: 0, peak_blocks: 0 };

    for step in 0..steps {
        let free_now = !live.is_empty() && (live.len() >= LIVE_CAP || rng.below(100) < 45);
        if free_now {
            let i = rng.below(live.len());
            let (p, l, pat) = live[i];
            // SAFETY: we wrote pat over all l.size() bytes and still own them.
            let bytes = unsafe { std::slice::from_raw_parts(p, l.size()) };
            assert!(bytes.iter().all(|&b| b == pat), "a live block was written over");
            live.swap_remove(i);
            // SAFETY: p came from a.alloc with exactly l, and is freed once.
            unsafe { a.dealloc(p, l) };
            tr.frees += 1;
        } else {
            let size = SIZES[rng.below(SIZES.len())];
            let layout = Layout::from_size_align(size, 8).unwrap();
            // SAFETY: the layout has non-zero size.
            let p = unsafe { a.alloc(layout) };
            if p.is_null() {
                tr.failures += 1;
                continue;
            }
            let pat = (step % 251) as u8;
            // SAFETY: p owns `size` bytes and nothing else points at them.
            unsafe { std::ptr::write_bytes(p, pat, size) };
            live.push((p, layout, pat));
            tr.allocs += 1;
            tr.peak_blocks = tr.peak_blocks.max(live.len());
        }
    }
    check_disjoint(&live);
    (tr, live)
}

/// # Safety
/// Every block must have come from `a` with the layout recorded beside it.
pub unsafe fn drain_live<A: GlobalAlloc>(a: &A, live: Vec<Block>) -> usize {
    let n = live.len();
    for (p, l, pat) in live {
        // SAFETY: we wrote pat over all l.size() bytes and still own them.
        let bytes = unsafe { std::slice::from_raw_parts(p, l.size()) };
        assert!(bytes.iter().all(|&b| b == pat), "a live block was written over");
        // SAFETY: the caller's contract.
        unsafe { a.dealloc(p, l) };
    }
    n
}
/// A tight mixed workload, timed. Sizes small enough that both allocators are
/// on their fast path.
pub fn bench<A: GlobalAlloc>(a: &A, seed: u64, steps: usize) -> f64 {
    let sizes = [16usize, 48, 96, 160];
    let mut live: Vec<(*mut u8, Layout)> = Vec::with_capacity(LIVE_CAP + 1);
    let mut rng = Rng::new(seed);
    let t = Instant::now();
    for _ in 0..steps {
        if !live.is_empty() && (live.len() >= LIVE_CAP || rng.below(2) == 0) {
            let i = rng.below(live.len());
            let (p, l) = live.swap_remove(i);
            // SAFETY: p came from a.alloc with l, and is freed once.
            unsafe { a.dealloc(p, l) };
        } else {
            let l = Layout::from_size_align(sizes[rng.below(4)], 8).unwrap();
            // SAFETY: the layout has non-zero size.
            let p = unsafe { a.alloc(l) };
            if !p.is_null() {
                live.push((p, l));
            }
        }
    }
    let ns = t.elapsed().as_secs_f64() * 1e9 / steps as f64;
    for (p, l) in live.drain(..) {
        // SAFETY: as above.
        unsafe { a.dealloc(p, l) };
    }
    ns
}

/// The workload a bump allocator is built for: allocate a frame, drop it whole.
pub fn bench_frames_bump(rounds: usize) -> f64 {
    const PER_ROUND: usize = 64;
    let mut bump = Bump::new();
    let layout = Layout::from_size_align(48, 8).unwrap();
    let t = Instant::now();
    for _ in 0..rounds {
        for _ in 0..PER_ROUND {
            let p = bump.alloc(layout);
            assert!(!p.is_null());
        }
        bump.reset();
    }
    t.elapsed().as_secs_f64() * 1e9 / (rounds * PER_ROUND) as f64
}

pub fn bench_frames_system(rounds: usize) -> f64 {
    const PER_ROUND: usize = 64;
    let layout = Layout::from_size_align(48, 8).unwrap();
    let mut held = [null_mut::<u8>(); PER_ROUND];
    let t = Instant::now();
    for _ in 0..rounds {
        for slot in held.iter_mut() {
            // SAFETY: the layout has non-zero size.
            *slot = unsafe { System.alloc(layout) };
            assert!(!slot.is_null());
        }
        for slot in held.iter_mut() {
            // SAFETY: each pointer came from System.alloc with this layout.
            unsafe { System.dealloc(*slot, layout) };
        }
    }
    t.elapsed().as_secs_f64() * 1e9 / (rounds * PER_ROUND) as f64
}

#[derive(Debug, Clone, Copy)]
pub struct Report {
    pub allocs: usize,
    pub frees: usize,
    pub failures: usize,
    pub peak_bytes: usize,
    pub arena_used: usize,
    pub free_blocks: usize,
    pub fragmentation: f64,
    pub ours_ns: f64,
    pub system_ns: f64,
    pub frame_ns: f64,
    pub frame_system_ns: f64,
}
pub fn run() -> Report {
    let heap = Heap::new();
    let (tr, live) = workload(&heap, 0x5EED, 5000);

    let peak_bytes = heap.peak_bytes();
    let arena_used = heap.used();
    let (free_blocks, free_bytes, largest) = heap.free_stats();
    let fragmentation = heap.fragmentation();

    println!("after 5000 steps against a {ARENA} byte arena");
    println!("  allocations     {}", tr.allocs);
    println!("  frees           {}", tr.frees);
    println!("  refused         {}", tr.failures);
    println!("  peak live bytes {peak_bytes}");
    println!("  arena carved    {arena_used}");
    println!("  free list       {free_blocks} blocks, {free_bytes} bytes, largest {largest}");
    println!("  fragmentation   {fragmentation:.3}");

    // SAFETY: every block came from this heap with the layout beside it.
    let drained = unsafe { drain_live(&heap, live) };
    heap.flush();
    let (blocks, total, _) = heap.free_stats();
    println!("  after {drained} more frees and a flush: {blocks} block of {total} bytes");
    assert_eq!(blocks, 1, "the arena did not coalesce back to one block");
    assert_eq!(total, arena_used, "bytes went missing");
    assert_eq!(heap.live_bytes(), 0);

    let fresh = Heap::new();
    let ours_ns = bench(&fresh, 0xA11C, 20000);
    let system_ns = bench(&System, 0xA11C, 20000);
    let frame_ns = bench_frames_bump(500);
    let frame_system_ns = bench_frames_system(500);
    println!("mixed alloc and free: ours {ours_ns:.0} ns/op, System {system_ns:.0} ns/op");
    println!("frame workload:       bump {frame_ns:.0} ns/op, System {frame_system_ns:.0} ns/op");

    Report {
        allocs: tr.allocs,
        frees: tr.frees,
        failures: tr.failures,
        peak_bytes,
        arena_used,
        free_blocks,
        fragmentation,
        ours_ns,
        system_ns,
        frame_ns,
        frame_system_ns,
    }
}
```

@hint `GlobalAlloc::alloc` takes `&self`. The call as written passes a layout and no receiver.
@hint `System` is a unit struct, so there is a value with that name as well as a type. Method call syntax gives the method its receiver.
@hint `System.alloc(layout)`, and fragmentation is one minus the largest hole over the total free bytes.

@diagnose E0061
`this function takes 2 arguments but 1 argument was supplied`, pointing at
`System::alloc`.

`Type::method(args)` is the fully qualified form, and it does not fill in the
receiver: `GlobalAlloc::alloc(&self, layout)` takes two, so the compiler is
telling you the `&self` is missing. `System::alloc(&System, layout)` would
compile. `System.alloc(layout)` is the same call, spelled the way anyone would
read it, and works because `System` is a unit struct whose value has the same
name as its type.

The fully qualified form earns its keep when two traits in scope both define
`alloc`, which is exactly the situation in this file once `Heap` has an
inherent `allocate` and a trait `alloc`.

@diagnose E0277
`cannot subtract usize from {float}`, or `cannot divide f64 by usize`.

In the fragmentation formula, `largest / total` between two `usize` values is
integer division, so it is zero whenever `largest < total`, and then `1.0 - 0`
does not typecheck either because there is no `Sub<usize>` for a float. Rust has
no mixed numeric operators at all, and the reason is that the result type would
have to be argued about while integer to float conversion is lossy above 2^53.

Cast both operands: `1.0 - largest as f64 / total as f64`. `as` binds tighter
than `/`, so no parentheses are needed, and casting only one side leaves the
same error pointing at the other.

@after
The run, on the playground in a debug build.

```text
5000 steps against a 65536 byte arena
  allocations     2511
  frees           2489
  refused         0
  peak live bytes 8112
  arena carved    12384
  free list       4 blocks, 4496 bytes, largest 4048
  fragmentation   0.100
  after 22 more frees and a flush: 1 block of 12384 bytes
mixed alloc and free: ours 140 ns/op, System  68 ns/op
frame workload:       bump  25 ns/op, System  29 ns/op
```

Read the middle two lines first. Two and a half thousand allocations totalling
far more than 64 KiB ran inside an arena that never carved more than 12,384
bytes, because everything freed came back. Peak demand was 8,112 bytes, so the
carved 12,384 is the fragmentation tax: bytes held because a block of the wrong
size was sitting in the wrong place at the wrong moment. Fragmentation at the
busiest point is 0.100, meaning a tenth of the free bytes were stranded outside
the largest hole. And the arena coalesces back to exactly one block, which is the
leak check.

Now the losing line. On a mixed workload this allocator is about twice as slow as
the system one, and that is with glibc's `malloc` doing far more: arbitrary
sizes, growth by `mmap`, per thread arenas, and a fast path tuned for twenty
years. Ours takes one global lock for every operation, walks a linked list
whenever a size class misses, and cannot grow at all. Debug build, no inlining,
so both numbers are inflated; the ratio is the honest part.

Where it wins is the last line, and it wins by more than it looks. The frame
workload allocates sixty four objects and drops them all at once, which for the
bump allocator is sixty four pointer bumps and a single store, and for `malloc`
is sixty four allocations and sixty four frees. Even unoptimised that is already
ahead, and the gap is mostly hidden here because the harness costs more than the
allocator does. The other wins do not show up in a timing at all: a fixed arena
cannot fragment the whole address space, cannot call the kernel at an awkward
moment, and has a worst case you can state. That is why this design turns up in
embedded firmware, in audio callbacks, and inside the per request path of servers
that care about tail latency, and not as anybody's general purpose `malloc`.

