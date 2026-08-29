---
unit: 27-no-std
---

## 1

Which crate does `Vec` actually live in?

- A. `core`
- *B. `alloc`
- C. `std`, and nowhere else
- D. `collections`

@why
`Vec` is defined in `alloc` and re-exported by `std`. That is why a `#![no_std]`
crate with `extern crate alloc;` gets `Vec`, `String`, `Box`, `Rc` and `BTreeMap`
back the moment a global allocator exists.

C is the intuition almost everyone starts with, and it is why `no_std` sounds more
drastic than it is. `std` is largely a re-export shell: `std::vec::Vec` *is*
`alloc::vec::Vec`, the same type reached by a different path.

## 2

Does this compile?

```rust
#![no_std]
use std::cmp::max;

pub fn floor(n: u16) -> u16 { max(n, 10) }
```

- A. Yes, because `cmp` does not need an allocator
- *B. No, because the name `std` does not resolve at all
- C. No, because `max` is not generic over `u16`
- D. Yes, with a warning

@why
`error[E0433]: use of unresolved module or unlinked crate std`. `#![no_std]`
stops the crate being linked, so the *path* is dead even though the function is
perfectly available.

A has the right reasoning and the wrong conclusion, which is what makes it
tempting. `std::cmp::max` needs no allocator, and that is exactly why it is
`core::cmp::max` underneath. Change the first path segment and the line compiles
unchanged.

## 3

Which of these are still in scope under `#![no_std]`? Choose all that apply.

- *A. `Option`, `Some`, `None`
- *B. `Iterator` and its adapters
- *C. `Result`, `Ok`, `Err`
- D. `println!`
- E. `String`

@why
The prelude changes from `std::prelude` to `core::prelude`, and the difference is
smaller than the name suggests: `Option`, `Result`, `Iterator`, `Clone`, `Drop`,
`Into` and the operator traits were all `core` from the start.

What leaves is what needs a heap or an OS: `String`, `Vec` and `Box` (available
again via `alloc`), and `println!` and `format!` (`println!` needs stdout, and
never comes back, while `format!` returns with `alloc`).

## 4

Why is `HashMap` in `std` rather than `alloc`?

- A. It is too large to compile without an OS
- *B. Its default hasher seeds itself from the operating system's randomness
- C. It needs threads for its internal locking
- D. It has no `no_std` implementation anywhere

@why
`RandomState` asks the OS for entropy so that hash keys differ per process, which
is a defence against algorithmic complexity attacks. No OS, no entropy, no
default hasher, so the type cannot live below `std`.

D is wrong in a useful way: `hashbrown` is the same implementation and works in
`no_std` once you supply a hasher yourself. On a microcontroller the usual answer
is `BTreeMap` from `alloc`, or a fixed-capacity map from `heapless` that never
allocates.

## 5

Does `f32::sqrt` exist in `core`?

- A. Yes, because floating point arithmetic is all in `core`
- *B. No, because it is implemented by calling the platform's C maths library
- C. No, because floats do not exist at all in `no_std`
- D. Only on targets with a hardware FPU

@why
`+`, `*`, comparison, `abs` and `to_bits` are in `core`, because each is an
instruction or bit manipulation. `sqrt`, `sin`, `ln` and `powf` are not: they
come from libm, which is part of a hosted platform's runtime, so
`(x * x + y * y).sqrt()` in a `no_std` crate is `error[E0599]`.

Two fixes. Add the `libm` crate, which is that library rewritten in Rust. Or
notice you were only *comparing* distances. `sqrt` is monotonic, so comparing
the squares gives the identical ordering, exactly, and for free.

## 6

Why does `extern crate alloc;` still exist when Rust 2018 removed `extern crate`?

- A. Backwards compatibility with old crates
- *B. `alloc` ships with the compiler, so there is no `Cargo.toml` entry to write
- C. It is required by the `#[global_allocator]` attribute
- D. It only applies inside macros

@why
`extern crate` disappeared because a `Cargo.toml` dependency is enough to bring a
crate into scope. `core` and `alloc` have no `Cargo.toml` entry, because they
come with the toolchain, so something has to say "link this one". `core` is
linked automatically; `alloc` is not.

The reason `alloc` is opt-in is the interesting part: linking it is a claim that a
heap exists. Most `no_std` crates deliberately do not make that claim, so that
they still work on a part with no allocator at all.

## 7

How many `#[panic_handler]` functions must a `#![no_std]` binary have?

- A. Zero, because panics abort by default
- *B. Exactly one, anywhere in the dependency graph
- C. One per crate
- D. One per `panic!` call site

@why
`panic!` has to end up somewhere, and without `std` there is no default
somewhere, so the language requires exactly one and rejects both zero and two.

In practice you never write it: you add `panic-halt`, `panic-reset` or
`panic-probe` as a dependency and choose the behaviour by choosing the crate. Two
of them in the graph is a link error, which is a common and confusing first
failure when pulling in an unfamiliar dependency.

## 8

In the target triple `thumbv7em-none-eabihf`, what does `none` mean?

- A. No vendor is specified
- *B. There is no operating system on the target
- C. No optimisation level has been chosen
- D. The target has no floating-point support

@why
The middle field is the OS, and `none` means bare metal: no syscalls, no
scheduler, no filesystem, which is precisely why `std` cannot be built for it.
Compare `x86_64-unknown-linux-gnu`, where the field says `linux`.

D is a good trap because it is contradicted by the same string: `eabihf` is the
ABI, and the `hf` is *hard float*, meaning the part does have an FPU and floats
are passed in FPU registers.

## 9

Does this compile?

```rust
let mut led = Pin::new(13);   // -> Pin<Unconfigured>
led.set_high();               // set_high is in impl Pin<Output>
```

- A. Yes, because `set_high` is a method on `Pin`
- *B. No: `E0599`, because `Pin<Unconfigured>` does not have that method
- C. No: `E0308`, because the types of the two lines disagree
- D. Yes, but the pin stays low at runtime

@why
`impl Pin<Output>` is not an impl for `Pin`. It is an impl for one instantiation,
and `Pin<Unconfigured>` and `Pin<Output>` are as unrelated as `Vec<u8>` and
`Vec<String>`. So the method genuinely does not exist on the value you have, which
is `error[E0599]: no method named set_high found for struct Pin<Unconfigured>`.

D is what the C version does. It drives a pin whose direction register was never
written, reads a floating input, and hands you plausible nonsense.

## 10

What is `size_of::<Pin<Output>>()` compared to `size_of::<Pin<Unconfigured>>()`,
where the only difference is a `PhantomData<STATE>` field?

- A. Larger, by one discriminant byte
- B. Larger, by the size of the state type
- *C. Identical, because `PhantomData` is zero-sized
- D. Unspecified; it depends on the optimiser

@why
`PhantomData<T>` occupies no bytes and has no runtime representation. The two
types have identical layout and generate identical machine code; the only
difference is which `impl` blocks apply, and that is resolved and then discarded
during compilation.

That is what makes typestate affordable on a chip with 20 kB of RAM. An entire
state machine, checked exhaustively, costing zero bytes of flash and zero
cycles. And it is the same mechanism as any other generic parameter.

## 11

Does this compile?

```rust
use core::cell::Cell;
pub static TICKS: Cell<u32> = Cell::new(0);
```

- A. Yes, because `Cell` is exactly what a global counter wants
- *B. No, because a `static` must be `Sync` and `Cell` is deliberately not
- C. No, because `Cell::new` is not a `const fn`
- D. Yes, but only inside an `unsafe` block

@why
Every `static` is reachable from everywhere at once, so its type must be `Sync`.
`Cell`'s whole purpose is mutation without synchronisation, which is sound only
while exactly one context can reach it. So it is `!Sync` on purpose, and the
error is `Cell<u32> cannot be shared between threads safely`.

"Threads" is a misleading word on a microcontroller with none. An interrupt is
preemption too: `TICKS.set(TICKS.get() + 1)` is load, add, store, and a timer
interrupt landing between the load and the store silently loses a tick.
`AtomicU32::fetch_add` is one indivisible instruction.

## 12

An interrupt handler and `main` both need to push into a shared byte buffer.
What is the standard answer?

- A. `std::sync::Mutex`
- *B. `critical_section::with`, which disables interrupts for the duration
- C. A `static mut`, accessed in `unsafe`
- D. `Rc<RefCell<_>>`

@why
`std::sync::Mutex` is unavailable and would be wrong anyway: it blocks, and
blocking inside an interrupt on a chip with no scheduler is a deadlock nothing can
break. `critical-section` disables interrupts on bare metal and takes a real lock
on a hosted target, so the same driver compiles for both.

The `cs` token it hands your closure is the clever bit: it carries no data and
costs nothing, exists only as proof that interrupts are off, and is *required* to
reach the data. The unsound version cannot be written.

C is what the C code does, and it is where the data races live.

## 13

Your driver uses `AtomicU32::fetch_add` and will not build for a Cortex-M0. Why?

- A. `core::sync::atomic` is not available in `no_std`
- *B. Thumbv6 has no atomic read-modify-write instruction, so that method does not exist there
- C. `u32` is not the native word size on that part
- D. Atomics require an allocator

@why
Atomic *support* is per-target, and the standard library only exposes the
operations the instruction set can actually perform. Cortex-M0 and M0+ have loads
and stores but no LDREX/STREX pair, so `AtomicU32` exists with `load` and `store`
while `fetch_add` does not.

`portable-atomic` fills the gap by implementing the missing operations with a
critical section. This is one of the few places where "it compiles for my chip"
is genuinely not evidence that it compiles for yours.

## 14

With `defmt`, where does the formatting of `defmt::info!("adc={}", v)` happen?

- A. On the device, then the string is transmitted
- *B. On the host, because the device sends an index and the raw argument bytes
- C. Nowhere; `defmt` only supports literal strings
- D. On the device, but only in release builds

@why
The format strings are extracted from the binary's debug information and held by
the host tool. The firmware transmits an index into that table plus the arguments
as raw bytes, so a log line costs a handful of bytes on the wire and almost
nothing in flash.

That matters because `core::fmt` is not small: pulling in the general formatting
machinery for a single `write!` can add several kB, which on a 32 kB part is a
real fraction of the budget you were given.

## 15

On `wasm32-unknown-unknown`, which of these work? Choose all that apply.

- *A. `Vec` and `String`
- *B. Iterators, `Option`, `Result`
- C. `std::fs::File`
- D. `std::thread::spawn`
- *E. `Box<dyn Trait>`

@why
The `unknown` OS field means the same thing as `none`: no syscalls. But the
runtime does provide an allocator, so everything in `alloc` (`Vec`, `String`,
`Box`, `Rc`) works normally, and much of `std` compiles and merely fails at the
points that would need the OS.

Files and threads are those points. `wasm32-wasip1` adds a capability-based system
interface and gets most of `std` genuinely working, which is the difference
between a module embedded in a page and one run as a program.
