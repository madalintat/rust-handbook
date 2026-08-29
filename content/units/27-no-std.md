---
num: 27
slug: 27-no-std
title: No_std and embedded
accent: slate
concepts: core, alloc, no_std, panic handler, global allocator, target triple, cross-compilation, embedded-hal, typestate, interrupts, critical section, defmt, wasm
needs: 05-ownership, 13-generics, 14-traits, 21-concurrency
blurb: The standard library is three libraries in a trench coat. Take away the outer one and the same language runs on a chip with 20 kB of RAM and no operating system.
---

%% `std` is not a monolith and never was. It is a thin outer layer over two smaller libraries, and almost everything you think of as Rust (`Option`, `Result`, iterators, slices, arithmetic, traits, generics) lives underneath it, in a crate that assumes nothing about the machine at all. Knowing where the seams are is what makes a microcontroller, a kernel and a WebAssembly module all reachable from the same language.

Nothing in this unit is a dialect. It is the same compiler, the same borrow
checker, fewer libraries linked.

## Three libraries, one name

### What each layer requires

| crate | needs | gives you |
|---|---|---|
| `core` | nothing at all | types, traits, `Option`, `Result`, iterators, slices, `str`, arithmetic, `mem`, atomics |
| `alloc` | a global allocator | `Box`, `Vec`, `String`, `Rc`, `Arc`, `BTreeMap` |
| `std` | an operating system | files, threads, sockets, time, `HashMap`, `println!`, and a re-export of the other two |

`std::cmp::max` **is** `core::cmp::max`, the same function reached by a
different path. `std::vec::Vec` **is** `alloc::vec::Vec`. Most of what you have
written so far was never using `std` for anything but the name.

:::note
The question that answers nearly every `no_std` problem: *which layer is this
in?* If it does not touch the heap, a file, a socket, a thread or the clock, it
is in `core`, and the fix is one word in a `use`.
:::

### The interesting exclusions

`HashMap` is in `std`, not `alloc`, because its default hasher seeds itself from
the operating system's randomness. With no OS there is no seed. Use `BTreeMap`,
or a fixed-capacity map from `heapless`.

`f32::sqrt`, `sin`, `ln` and friends are in `std`, not `core`, because they are
implemented by calling the platform's C maths library. Arithmetic, comparison,
`abs` and `to_bits` are in `core`, because those are instructions. For the rest,
add the `libm` crate, or notice that you were only comparing distances and never
needed the root.

## Turning it off

### `#![no_std]`

```rust
#![no_std]
```

One crate attribute. It stops `std` being linked and swaps the prelude for
`core::prelude`, so `Vec`, `String`, `Box`, `println!` and `format!` disappear
from scope. `Option`, `Result`, `Iterator`, `Some`, `Ok`, `drop` and `Clone`
stay, because they were always `core`.

If you do have a heap, opt back in explicitly:

```rust
#![no_std]
extern crate alloc;
use alloc::vec::Vec;
```

`extern crate` is otherwise extinct. It survives here because `alloc` ships with
the compiler and has no `Cargo.toml` entry to write, and because linking it is a
commitment: this crate now assumes a heap exists.

### The two items a bare-metal binary must provide

```rust
#![no_std]
#![no_main]

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    loop {}          // or reset the chip, or blink an LED
}
```

`std` provided this: print the message, unwind, abort. Without `std`, `panic!`
has nowhere to go, so the language requires exactly one **panic handler** in the
final binary. In practice you pull one in as a crate (`panic-halt`,
`panic-reset`, `panic-probe`) and choose the behaviour by choosing a dependency.

If you want `alloc`, you must also say where memory comes from:

```rust
#[global_allocator]
static HEAP: embedded_alloc::LlffHeap = embedded_alloc::LlffHeap::empty();
```

:::gotcha
Most embedded Rust never declares an allocator. Not because it cannot, but
because a fixed 32 kB of RAM plus a heap that can fragment is a bad trade.
Firmware that allocates can fail at hour 400 in a way that never appeared on the
bench. `heapless` gives you `Vec`, `String` and queues with a capacity in the
type: `heapless::Vec<u8, 64>` lives entirely in the struct.
:::

## Targets

### The triple

```sh
rustup target add thumbv7em-none-eabihf
cargo build --release --target thumbv7em-none-eabihf
```

That string is a **target triple**. `thumbv7em` is the instruction set, `none`
is the operating system, literally none, and `eabihf` is the ABI, with hardware
floats. Compare `x86_64-unknown-linux-gnu` or `wasm32-unknown-unknown`.

:::compare
**C.** Cross-compiling means acquiring a toolchain, a sysroot and a libc for the
target, and every dependency you use must have been taught to build for it.

Rust ships the `core` and `alloc` source with the compiler and builds them for
whatever target you name. `rustup target add`, then `--target`. The difference is
not marketing; it is that Rust's own standard library has no libc underneath it
to go and find.
:::

Put the target and the runner in `.cargo/config.toml` so `cargo run` flashes the
board and opens a debug session:

```toml
[build]
target = "thumbv7em-none-eabihf"

[target.thumbv7em-none-eabihf]
runner = "probe-rs run --chip STM32F411RETx"
```

## Why the language fits the hardware

### No runtime to not have

A Rust binary starts at your entry point. There is no garbage collector to
schedule, no green-thread scheduler, no reflection metadata, no exception tables
unless you asked for unwinding. That is not an embedded feature; it is the same
property that lets Rust be called from C. What it buys you here is a flash
budget of 20 kB that a real program can live inside.

And **zero-cost abstraction** stops being a slogan when the alternative is
counting instructions. An iterator chain over a slice compiles to the same loop
you would have written; a generic driver monomorphises into a direct register
write; a `PhantomData` field occupies nothing.

### Ownership describes hardware exactly

There is one UART on the chip. Not "one per thread", and not "one you should be
careful about". One, physically. Ownership already means exactly that: one
value, one owner, and passing it moves it.

:::note
A peripheral is a resource with exactly one owner, which is the case ownership
was designed for. The HAL hands out each peripheral once, from a `take()` that
returns `Option` and yields `None` the second time, so two drivers cannot both
believe they own the serial port.
:::

`embedded-hal` turns that into portability. A driver is written against traits
(`OutputPin`, `SpiDevice`, `DelayNs`) and every chip's HAL crate implements them:

```rust
pub struct Led<P: OutputPin> { pin: P }
```

The same driver runs on an STM32, an nRF, an RP2040, and on a fake pin in a unit
test on your laptop. Generic rather than `dyn`, so each instantiation inlines to
the register write and there is no vtable.

## Typestate

### Configuration in the type

The neatest thing in embedded Rust, and it is only generics. The name for it is
the **typestate** pattern.

```rust
pub struct Pin<STATE> { number: u8, _state: PhantomData<STATE> }

pub struct Unconfigured;
pub struct Output;

impl Pin<Unconfigured> {
    pub fn into_output(self) -> Pin<Output> { /* write the direction register */ }
}

impl Pin<Output> {
    pub fn set_high(&mut self) { /* ... */ }
}
```

`set_high` exists on `Pin<Output>` and does not exist on `Pin<Unconfigured>`.
Driving an unconfigured pin is not a bug you catch in review; it is
`error[E0599]`, and the C version of it is an afternoon with an oscilloscope
wondering why the input floats.

`into_output` takes `self`, so the old handle is consumed. The pin has one
configuration at a time, enforced by the same move rule as a `String`.

:::memory the state weighs nothing
     Pin<Unconfigured>            Pin<Output>
   ┌──────────────────┐        ┌──────────────────┐
   │ number    u8   1B│        │ number    u8   1B│
   │ _state    ZST  0B│        │ _state    ZST  0B│
   └──────────────────┘        └──────────────────┘
     size_of == 1                size_of == 1

   Different types. Identical layout, identical
   machine code, and no trace of STATE after codegen.
:::

That is why the pattern is affordable on a part where every byte of RAM is
counted: the state machine is erased before code generation. It generalises past
hardware, to a builder that must be finished or a connection that must be
opened, wherever an order exists and the wrong order is expensive.

## Interrupts

### Shared mutable state, without threads

An interrupt handler runs at a moment nothing in your program chose. That is
preemption, and the compiler treats it exactly like another thread.

```rust,bad
static TICKS: Cell<u32> = Cell::new(0);   // Cell<u32> is not Sync
```

Every `static` is reachable from everywhere at once, so its type must be **Sync**.
`Cell` is deliberately not: `TICKS.set(TICKS.get() + 1)` is load, add, store, and
an interrupt landing between the load and the store loses a tick. On a
single-core chip with no threads at all.

```rust,good
static TICKS: AtomicU32 = AtomicU32::new(0);
TICKS.fetch_add(1, Ordering::Relaxed);
```

### When a counter is not enough

Sharing a struct needs a lock, and `std::sync::Mutex` is not available. It
blocks the thread, and on a microcontroller a block inside an interrupt is a
deadlock with no scheduler left to break it.

```rust
critical_section::with(|cs| {
    RX_BUFFER.borrow_ref_mut(cs).push(byte);
});
```

That is a **critical section**. The crate disables interrupts for the duration on
bare metal and takes a real lock on a hosted target, so the same driver compiles
for both. The `cs` token
is the interesting part: it carries no data, costs nothing, and exists only as
proof that interrupts are off. Nothing reaches the data without it.

:::gotcha
Not every chip has atomics. Thumbv6 parts (Cortex-M0, RP2040) have no atomic
read-modify-write instruction at all, so `AtomicU32::fetch_add` does not exist
there. `portable-atomic` fills the gap using critical sections.
:::

## Two more places this goes

### Logging without a formatter

`core::fmt` works in `no_std`, and it is expensive: the general formatting
machinery can add several kB of flash for one `write!`. On a 32 kB part that is a
real fraction of the budget.

`defmt` moves the work off the chip. The firmware transmits an *index* into the
format strings plus the raw arguments; the host tool holds the strings, extracted
from the binary's debug info, and does the formatting. A `defmt::info!` costs a
handful of bytes on the wire and almost nothing in flash.

### WebAssembly

`wasm32-unknown-unknown` is the other target with no operating system. Same
shape: no files, no threads, no clock, nothing but the module and its imports.

The difference is that a browser gives you an allocator, so `alloc` and therefore
`Vec` and `String` work fine, and much of `std` compiles. It panics or returns
errors only at the points that would need a syscall. `wasm32-wasip1` adds a
capability-based system interface and gets you most of `std` back.

The lesson is the general one. Once you know which layer a thing lives in, you
know whether it will follow you off the desktop.
