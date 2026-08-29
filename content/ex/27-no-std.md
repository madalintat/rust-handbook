---
unit: 27-no-std
---

## 1. There is no std here

@kind fix
@concept core
@expect E0433

The crate is `#![no_std]`, which is the whole point of it. This is going on a
microcontroller with 20 kB of RAM and no operating system underneath. The import
on line two was copied from a hosted crate.

Everything it names is still available. It is in a different crate.

```starter
#![no_std]
use std::cmp::{max, min};

/// Clamp a requested PWM duty cycle into what the timer can accept.
pub fn clamp_duty(requested: u16) -> u16 {
    min(max(requested, 10), 4095)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_both_ends() {
        assert_eq!(clamp_duty(0), 10);
        assert_eq!(clamp_duty(9999), 4095);
        assert_eq!(clamp_duty(2000), 2000);
    }
}
```

```solution
#![no_std]
use core::cmp::{max, min};

/// Clamp a requested PWM duty cycle into what the timer can accept.
pub fn clamp_duty(requested: u16) -> u16 {
    min(max(requested, 10), 4095)
}
```

@hint `#![no_std]` removes one crate from the prelude. It does not remove `max` and `min`.
@hint `std` is a thin re-export layer over `core` and `alloc`. Anything that needs neither an allocator nor an operating system lives in `core`.
@hint `use core::cmp::{max, min};`

@diagnose E0433
`use of unresolved module or unlinked crate std`.

`#![no_std]` tells rustc not to link the standard library, so the name `std` does
not resolve at all. This is not "some of std is unavailable". The crate is not
there.

What you actually lost is smaller than it looks. `std` is a shell: it re-exports
`core` and `alloc` almost unchanged and adds the parts that need an operating
system. `std::cmp::max` *is* `core::cmp::max`, the same function reached by a
different path. So is every integer method, every float constant, `Option`,
`Result`, `Iterator`, slices, `str`, and all of `mem`.

The rule of thumb: if it does not touch the heap, a file, a socket, a thread or
the clock, it is in `core` and the fix is one word.

@after
The three layers are worth keeping in your head as a diagram, because almost
every `no_std` question is answered by asking which layer something is in.

`core`: no allocation, no OS. Types, traits, iterators, arithmetic, `mem`.
`alloc`: needs a global allocator. `Box`, `Vec`, `String`, `Rc`, `BTreeMap`.
`std`: needs an OS. Files, threads, networking, time, `HashMap`, `println!`.

`std` re-exports the first two, which is why you never had to think about it.

## 2. Vec is not in core

@kind fix
@concept alloc
@expect E0433

The sampler wants a growable buffer. This board *does* have an allocator,
declared elsewhere with `#[global_allocator]`, so `Vec` is genuinely available.

The crate has not been told to link the library it lives in.

```starter
#![no_std]
use alloc::vec::Vec;

/// Keep only the samples above the noise floor.
pub fn above_floor(raw: &[u16], floor: u16) -> Vec<u16> {
    raw.iter().copied().filter(|s| *s > floor).collect()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_the_quiet_samples() {
        assert_eq!(above_floor(&[3, 40, 7, 900], 10).as_slice(), &[40u16, 900]);
    }

    #[test]
    fn nothing_above_the_floor_is_empty() {
        assert!(above_floor(&[1, 2], 10).is_empty());
    }
}
```

```solution
#![no_std]
extern crate alloc;

use alloc::vec::Vec;

/// Keep only the samples above the noise floor.
pub fn above_floor(raw: &[u16], floor: u16) -> Vec<u16> {
    raw.iter().copied().filter(|s| *s > floor).collect()
}
```

@hint `alloc` is a separate crate. `std` linked it for you; without `std` you link it yourself.
@hint It is the one place the old `extern crate` syntax is still needed, because there is no `Cargo.toml` entry to write for a crate shipped with the compiler.
@hint Add `extern crate alloc;` on the line after `#![no_std]`.

@diagnose E0433
`use of unresolved module or unlinked crate alloc ... you might be missing a
crate named alloc`.

Rust 2018 removed `extern crate` for ordinary dependencies, since a `Cargo.toml`
entry is enough. `alloc` and `core` are not ordinary dependencies: they ship with the
compiler and there is nothing to put in `Cargo.toml`. `core` is linked
automatically. `alloc` is not, because linking it commits you to providing an
allocator, and most `no_std` crates do not have one.

So `extern crate alloc;` survives as the one place you still write it, and what
it means is precisely: *this crate assumes a heap exists.*

@after
Splitting `alloc` out of `core` is one of the better decisions in the library.
A driver crate that only formats registers can be `core`-only and then works on a
32 kB part with no heap at all. A crate that wants `Vec` declares `alloc` and
works anywhere an allocator has been supplied.

Notice what `alloc` gives you and what it cannot: `Box`, `Vec`, `String`, `Rc`,
`BTreeMap`, yes. `HashMap`, no, because the default hasher seeds itself from the
operating system's randomness, and there is no operating system. On an
embedded target you reach for `BTreeMap`, or for a fixed-capacity map from
`heapless` that never allocates at all.

## 3. Floating point that needs an operating system

@kind fix
@concept core
@expect E0599

Two accelerometer axes, and the reading furthest from rest wins. The maths is
right and one method call is not there.

Think about what `sqrt` actually compiles to on a chip with no FPU, and what
question this function is really asking.

```starter
#![no_std]

/// The reading furthest from the origin.
pub fn furthest(points: &[(f32, f32)]) -> Option<(f32, f32)> {
    let mut best: Option<(f32, f32)> = None;
    let mut best_distance = 0.0;

    for &(x, y) in points {
        let distance = (x * x + y * y).sqrt();
        if best.is_none() || distance > best_distance {
            best = Some((x, y));
            best_distance = distance;
        }
    }

    best
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_furthest() {
        let readings = [(1.0, 1.0), (3.0, 4.0), (0.0, 2.0)];
        assert_eq!(furthest(&readings), Some((3.0, 4.0)));
    }

    #[test]
    fn empty_input_has_no_answer() {
        assert_eq!(furthest(&[]), None);
    }
}
```

```solution
#![no_std]

/// The reading furthest from the origin.
pub fn furthest(points: &[(f32, f32)]) -> Option<(f32, f32)> {
    let mut best: Option<(f32, f32)> = None;
    let mut best_distance = 0.0;

    for &(x, y) in points {
        // Compare squared distances: sqrt is monotonic, so the ordering is the
        // same and the square root never has to be computed.
        let distance = x * x + y * y;
        if best.is_none() || distance > best_distance {
            best = Some((x, y));
            best_distance = distance;
        }
    }

    best
}
```

@hint `sqrt` is not missing by accident. Ask which of the three layers it would have to live in.
@hint You never use `best_distance` for anything except comparing it with another distance.
@hint `sqrt` is monotonic: if `a > b` then `sqrt(a) > sqrt(b)`. Drop the call and compare the squares.

@diagnose E0599
`no method named sqrt found for type f32 in the current scope`.

A surprise the first time, and then obvious. `f32`'s arithmetic (`+`, `*`,
comparison, `abs`, `to_bits`) is in `core`, because it is either a machine
instruction or bit twiddling. `sqrt`, `sin`, `ln`, `powf` and the rest are not:
they are implemented by calling out to the platform's C maths library, which is
part of the operating system's runtime. No OS, no libm, no `sqrt`.

Two real fixes. Add the `libm` crate, which is that library reimplemented in
Rust, and call `libm::sqrtf(x)`. Or notice, as here, that you did not need the
square root, because comparing squared distances gives the identical ordering
and is both exact and faster. On a part with no floating-point unit the second is not a
micro-optimisation; it is the difference between microseconds and milliseconds.

@after
This is the shape of most `no_std` porting work, and it is rarely dramatic. You
do not rewrite the algorithm. You find the handful of calls that quietly assumed
an operating system, and you either bring the implementation with you or
discover you never needed it.

The same trick has a name in graphics and physics code: keep everything in
squared space until the moment a human has to read the number. It is worth
knowing even on a machine with all the `sqrt` it could want.

## 4. A pin that is not an output yet

@kind fix
@concept typestate
@expect E0599

The **typestate** pattern: a peripheral's configuration is part of its *type*, so
using it wrongly is a compile error rather than a silent read of a floating pin.

`Pin::new` hands back a `Pin<Unconfigured>`. Driving a pin high is only meaningful
once it has been configured as an output.

```starter
#![no_std]
use core::marker::PhantomData;

pub struct Unconfigured;
pub struct Output;

pub struct Pin<STATE> {
    number: u8,
    high: bool,
    _state: PhantomData<STATE>,
}

impl Pin<Unconfigured> {
    pub fn new(number: u8) -> Self {
        Pin { number, high: false, _state: PhantomData }
    }

    pub fn into_output(self) -> Pin<Output> {
        Pin { number: self.number, high: false, _state: PhantomData }
    }
}

impl Pin<Output> {
    pub fn set_high(&mut self) {
        self.high = true;
    }
    pub fn number(&self) -> u8 {
        self.number
    }
    pub fn is_high(&self) -> bool {
        self.high
    }
}

pub fn light_the_led() -> (u8, bool) {
    let mut led = Pin::new(13);
    led.set_high();
    (led.number(), led.is_high())
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_thirteen_ends_up_high() {
        assert_eq!(light_the_led(), (13, true));
    }
}
```

```solution
#![no_std]
use core::marker::PhantomData;

pub struct Unconfigured;
pub struct Output;

pub struct Pin<STATE> {
    number: u8,
    high: bool,
    _state: PhantomData<STATE>,
}

impl Pin<Unconfigured> {
    pub fn new(number: u8) -> Self {
        Pin { number, high: false, _state: PhantomData }
    }

    pub fn into_output(self) -> Pin<Output> {
        Pin { number: self.number, high: false, _state: PhantomData }
    }
}

impl Pin<Output> {
    pub fn set_high(&mut self) {
        self.high = true;
    }
    pub fn number(&self) -> u8 {
        self.number
    }
    pub fn is_high(&self) -> bool {
        self.high
    }
}

pub fn light_the_led() -> (u8, bool) {
    let mut led = Pin::new(13).into_output();
    led.set_high();
    (led.number(), led.is_high())
}
```

@hint Look at which `impl` block `set_high` is in, and what type `Pin::new` returns.
@hint There are two `impl` blocks for two different types. `Pin<Unconfigured>` and `Pin<Output>` share a name and are as unrelated as `Vec<u8>` and `Vec<String>`.
@hint `let mut led = Pin::new(13).into_output();`

@diagnose E0599
`no method named set_high found for struct Pin<Unconfigured>`.

Read the type in the message, not the method name. `impl Pin<Output>` is not an
impl for `Pin`; it is an impl for exactly one instantiation of it. A
`Pin<Unconfigured>` gets the methods of `impl Pin<Unconfigured>` and nothing else,
so `set_high` genuinely does not exist on the value you have.

That is the whole trick, and it costs nothing. `PhantomData<STATE>` is a
zero-sized field; `Pin<Unconfigured>` and `Pin<Output>` have identical layout and
identical machine code. The state exists only during compilation, which is why
this is affordable on a chip where every byte of RAM is counted.

@diagnose E0282
`type annotations needed` means `Pin::new` was called in a position where nothing
pins down `STATE`. `new` lives in `impl Pin<Unconfigured>`, so calling it fixes
the parameter. Move it to a generic impl and rustc has no way to choose.
Keep constructors in the impl for the state they produce.

@after
The C version of this bug is a peripheral driven before its direction register was
written. It does not crash. It reads a floating input, gives you plausible
nonsense, and you spend an afternoon with an oscilloscope.

Note that `into_output` takes `self`, not `&self`. The unconfigured handle is
consumed, so after the transition it cannot be named. That is the ownership rule
from unit 5, now enforcing that a peripheral has one configuration at a time. Two
ideas that were designed for heap memory turn out to describe hardware exactly.

## 5. A driver that works on any pin

@kind fix
@concept embedded-hal
@expect E0562

`embedded-hal` is the portability layer: a driver is written against a trait like
`OutputPin`, and works on any chip whose HAL crate implements it. That is what
lets one LED driver run on an STM32, an nRF and a test double.

`Led` is trying to say "some pin, I do not care which". It is saying it in a
place the language does not allow.

```starter
#![no_std]

pub trait OutputPin {
    fn set_state(&mut self, high: bool);
    fn state(&self) -> bool;
}

pub struct Led {
    pin: impl OutputPin,
}

impl Led {
    pub fn new(pin: impl OutputPin) -> Self {
        Led { pin }
    }

    pub fn toggle(&mut self) {
        let now = self.pin.state();
        self.pin.set_state(!now);
    }

    pub fn is_on(&self) -> bool {
        self.pin.state()
    }
}

pub struct FakePin {
    pub high: bool,
}

impl OutputPin for FakePin {
    fn set_state(&mut self, high: bool) {
        self.high = high;
    }
    fn state(&self) -> bool {
        self.high
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toggles_the_underlying_pin() {
        let mut led = Led::new(FakePin { high: false });
        assert!(!led.is_on());
        led.toggle();
        assert!(led.is_on());
        led.toggle();
        assert!(!led.is_on());
    }
}
```

```solution
#![no_std]

pub trait OutputPin {
    fn set_state(&mut self, high: bool);
    fn state(&self) -> bool;
}

pub struct Led<P: OutputPin> {
    pin: P,
}

impl<P: OutputPin> Led<P> {
    pub fn new(pin: P) -> Self {
        Led { pin }
    }

    pub fn toggle(&mut self) {
        let now = self.pin.state();
        self.pin.set_state(!now);
    }

    pub fn is_on(&self) -> bool {
        self.pin.state()
    }
}

pub struct FakePin {
    pub high: bool,
}

impl OutputPin for FakePin {
    fn set_state(&mut self, high: bool) {
        self.high = high;
    }
    fn state(&self) -> bool {
        self.high
    }
}
```

@hint A struct field needs a type with a known size. `impl OutputPin` names a type the caller chooses, which is not the same thing.
@hint Give `Led` a type parameter and let the caller instantiate it. `Led<P>` where `P: OutputPin`.
@hint `pub struct Led<P: OutputPin> { pin: P }`, and the impl block becomes `impl<P: OutputPin> Led<P>`.

@diagnose E0562
`impl Trait is not allowed in field types ... impl Trait is only allowed in
arguments and return types of functions and methods`.

`impl Trait` in an argument position is shorthand for a generic parameter the
*caller* picks. In a return position it is an opaque type the *function* picks.
Neither reading makes sense on a struct field: a field has one concrete type,
fixed when the struct is instantiated, and the only way to leave that choice open
is a type parameter on the struct.

So the fix is to say the same thing longhand. `Led<P: OutputPin>` with `pin: P`
means every `Led` value has one definite pin type, chosen at the call to `new`.

@diagnose E0308
If you tried `Box<dyn OutputPin>` instead, this is the trait object route and it
does work. But it needs `alloc`, adds a heap allocation and a vtable lookup per
call, and on an embedded target you usually have none of those to spare.

@after
The generic version is what `embedded-hal` drivers actually look like, and the
reason is cost. `Led<FakePin>` is monomorphised into code that calls `FakePin`'s
methods directly, so `toggle` inlines down to a single register write. A `dyn`
version could not: the call would go through a vtable, on a chip where a
peripheral write is two instructions.

The testing consequence is the one you just used. Because the driver is generic
over the trait rather than tied to one chip, a `FakePin` is a perfectly good pin,
and the whole driver becomes testable on your laptop, which is most of why
embedded Rust is pleasant to write.

## 6. Formatting without a heap

@kind fix
@concept core
@expect E0046

`write!` needs somewhere to put the bytes, and on this board there is no `String`
to grow. The sink is a fixed 64-byte array on the stack: the write either fits
or returns an error, and no allocation happens either way.

Making it a valid target for `write!` means implementing one method.

```starter
#![no_std]
use core::fmt;

pub struct Buf {
    bytes: [u8; 64],
    len: usize,
}

impl Buf {
    pub fn new() -> Self {
        Buf { bytes: [0; 64], len: 0 }
    }

    pub fn as_str(&self) -> &str {
        core::str::from_utf8(&self.bytes[..self.len]).unwrap_or("")
    }
}

impl fmt::Write for Buf {}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    use core::fmt::Write;

    #[test]
    fn formats_into_the_array() {
        let mut b = Buf::new();
        write!(b, "adc={} mV", 1234).unwrap();
        assert_eq!(b.as_str(), "adc=1234 mV");
    }

    #[test]
    fn refuses_to_overflow() {
        let mut b = Buf::new();
        for _ in 0..6 {
            write!(b, "0123456789").unwrap();
        }
        assert!(write!(b, "0123456789").is_err());
    }
}
```

```solution
#![no_std]
use core::fmt;

pub struct Buf {
    bytes: [u8; 64],
    len: usize,
}

impl Buf {
    pub fn new() -> Self {
        Buf { bytes: [0; 64], len: 0 }
    }

    pub fn as_str(&self) -> &str {
        core::str::from_utf8(&self.bytes[..self.len]).unwrap_or("")
    }
}

impl fmt::Write for Buf {
    fn write_str(&mut self, s: &str) -> fmt::Result {
        let incoming = s.as_bytes();
        if self.len + incoming.len() > self.bytes.len() {
            return Err(fmt::Error);
        }
        self.bytes[self.len..self.len + incoming.len()].copy_from_slice(incoming);
        self.len += incoming.len();
        Ok(())
    }
}
```

@hint The error names the one method the trait requires. Everything else on `fmt::Write` has a default.
@hint `fn write_str(&mut self, s: &str) -> fmt::Result`, copying `s.as_bytes()` into the array at `self.len` and advancing it.
@hint Check for overflow first and return `Err(fmt::Error)`; `fmt::Error` carries no detail, which is deliberate.

@diagnose E0046
`not all trait items implemented, missing: write_str`, followed by a `help:`
line giving you the exact signature to paste.

`core::fmt::Write` has three methods. `write_char` and `write_fmt` both have
default bodies written in terms of `write_str`, so a type only has to say how a
string slice is consumed and it gets the whole formatting machinery for free.
That is the standard shape of a Rust trait: one required method, many provided
ones.

Note what the overflow test has to do: with no allocator there is no way to build
a long string to overflow with, so it writes ten bytes at a time until the array
is full. That constraint is the whole unit in miniature.

@diagnose E0308
`fmt::Result` is `Result<(), fmt::Error>`, not `Result<usize, _>`. Unlike
`io::Write`, a formatter reports no byte count and no partial write: either the
whole slice went in or the call failed. That is why it can work with no allocator
and no buffering.

@after
`fmt::Error` deliberately carries nothing: no message, no errno, and no `String`
to allocate. The whole `core::fmt` stack is built to run with a fixed stack budget,
which is why it is in `core` at all while `io::Write` is not.

There is a catch worth knowing before you rely on it. `core::fmt` is not small:
pulling in the general formatting machinery for one `write!` can add several kB of
flash, which on a 32 kB part is a real fraction of the budget. That is exactly why
`defmt` exists. It sends the format string's *index* and the raw arguments over
the wire and lets the host do the formatting, so the firmware carries no
formatter at all.

## 7. A counter the interrupt also touches

@kind fix
@concept interrupts
@expect E0277

`on_timer_interrupt` is called by the hardware, at a moment nothing in your
program chose. The counter it increments is therefore shared between two contexts
that can interleave, which is the same problem as two threads and the compiler
treats it identically.

`Cell` gives interior mutability with no synchronisation at all.

```starter
#![no_std]
use core::cell::Cell;

pub static TICKS: Cell<u32> = Cell::new(0);

/// Called from the timer interrupt vector.
pub fn on_timer_interrupt() {
    TICKS.set(TICKS.get() + 1);
}

pub fn ticks() -> u32 {
    TICKS.get()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_every_tick() {
        assert_eq!(ticks(), 0);
        on_timer_interrupt();
        on_timer_interrupt();
        on_timer_interrupt();
        assert_eq!(ticks(), 3);
    }
}
```

```solution
#![no_std]
use core::sync::atomic::{AtomicU32, Ordering};

pub static TICKS: AtomicU32 = AtomicU32::new(0);

/// Called from the timer interrupt vector.
pub fn on_timer_interrupt() {
    TICKS.fetch_add(1, Ordering::Relaxed);
}

pub fn ticks() -> u32 {
    TICKS.load(Ordering::Relaxed)
}
```

@hint A `static` is reachable from every context at once, so its type must be safe to share. Which trait says that?
@hint `Cell` is `!Sync` by design, because read-modify-write on it is three separate steps and an interrupt can land between them.
@hint `core::sync::atomic::AtomicU32`. `fetch_add(1, Ordering::Relaxed)` to increment, `load(Ordering::Relaxed)` to read.

@diagnose E0277
`Cell<u32> cannot be shared between threads safely ... shared static variables
must have a type that implements Sync`.

Every `static` is reachable from everywhere in the program simultaneously, so its
type must be `Sync`. `Cell` is deliberately not: its whole purpose is mutation
without synchronisation, which is sound only while exactly one context can reach
it.

The hazard is concrete. `TICKS.set(TICKS.get() + 1)` is load, add, store. If the
timer interrupt fires between the load and the store, its increment is
overwritten and a tick vanishes. On a single-core microcontroller with no threads
at all, this still happens. An interrupt is preemption, and the borrow rules do
not care whether the other context is a thread or a vector table entry.

`fetch_add` is one instruction the hardware cannot split.

@diagnose E0015
`cannot call non-const fn in statics`. A `static` is initialised at compile time,
so its initialiser must be a `const fn`. `AtomicU32::new` is one; most
constructors are not. If you reached for a `Mutex` here, that is the wall you hit,
and it is why the embedded ecosystem uses `critical-section` instead.

@after
Atomics cover a counter. They do not cover a shared struct, and that is where
`critical-section` comes in: it wraps access in a token that on a microcontroller
disables interrupts for the duration and on a hosted target takes a real lock, so
the same driver code works in both places.

```rust
critical_section::with(|cs| {
    STATE.borrow_ref_mut(cs).buffer.push(byte);
});
```

The `cs` token is proof that interrupts are off, and it is required to reach the
data. The pattern is worth studying: a value whose only purpose is to be evidence,
carrying no data, costing nothing, and making the unsound version unwriteable.

Not every chip has atomics, incidentally. Thumbv6 parts have no atomic
read-modify-write instruction, which is what `portable-atomic` exists to paper
over.

## 8. The state machine is enforced by moves

@kind fix
@concept typestate
@expect E0382

A UART, in three states. `enable` consumes the disabled handle and returns an
enabled one; `disable` goes back the other way and keeps the byte count.

The session below wants to send at 115200, then reconfigure to 9600. It reaches
for the wrong handle to do it.

```starter
#![no_std]
use core::marker::PhantomData;

pub struct Disabled;
pub struct Enabled;

pub struct Uart<STATE> {
    baud: u32,
    sent: usize,
    _state: PhantomData<STATE>,
}

impl Uart<Disabled> {
    pub fn new() -> Self {
        Uart { baud: 0, sent: 0, _state: PhantomData }
    }

    pub fn enable(self, baud: u32) -> Uart<Enabled> {
        Uart { baud, sent: 0, _state: PhantomData }
    }
}

impl Uart<Enabled> {
    pub fn write(&mut self, bytes: &[u8]) {
        self.sent += bytes.len();
    }

    pub fn baud(&self) -> u32 {
        self.baud
    }

    pub fn sent(&self) -> usize {
        self.sent
    }

    pub fn disable(self) -> Uart<Disabled> {
        Uart { baud: 0, sent: self.sent, _state: PhantomData }
    }
}

/// Send five bytes at 115200, then reconfigure the port to 9600.
/// Returns the final baud rate and the number of bytes sent at the first one.
pub fn session() -> (u32, usize) {
    let uart = Uart::new();

    let mut fast = uart.enable(115_200);
    fast.write(b"hello");
    let sent = fast.sent();

    let slow = uart.enable(9_600);

    (slow.baud(), sent)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconfigures_after_sending() {
        assert_eq!(session(), (9_600, 5));
    }
}
```

```solution
#![no_std]
use core::marker::PhantomData;

pub struct Disabled;
pub struct Enabled;

pub struct Uart<STATE> {
    baud: u32,
    sent: usize,
    _state: PhantomData<STATE>,
}

impl Uart<Disabled> {
    pub fn new() -> Self {
        Uart { baud: 0, sent: 0, _state: PhantomData }
    }

    pub fn enable(self, baud: u32) -> Uart<Enabled> {
        Uart { baud, sent: 0, _state: PhantomData }
    }
}

impl Uart<Enabled> {
    pub fn write(&mut self, bytes: &[u8]) {
        self.sent += bytes.len();
    }

    pub fn baud(&self) -> u32 {
        self.baud
    }

    pub fn sent(&self) -> usize {
        self.sent
    }

    pub fn disable(self) -> Uart<Disabled> {
        Uart { baud: 0, sent: self.sent, _state: PhantomData }
    }
}

/// Send five bytes at 115200, then reconfigure the port to 9600.
/// Returns the final baud rate and the number of bytes sent at the first one.
pub fn session() -> (u32, usize) {
    let uart = Uart::new();

    let mut fast = uart.enable(115_200);
    fast.write(b"hello");
    let sent = fast.sent();

    let slow = fast.disable().enable(9_600);

    (slow.baud(), sent)
}
```

@hint `uart` was consumed on the line that produced `fast`. There is only ever one UART value alive.
@hint To reconfigure a live port you must first take it out of service. There is a method for that, and it hands the handle back in the state `enable` wants.
@hint `let slow = fast.disable().enable(9_600);`

@diagnose E0382
`use of moved value: uart ... value moved here` under `uart.enable(115_200)`.

`enable` takes `self`, so calling it moved the handle in. The compiler is
enforcing something physical: there is one UART peripheral on the chip, so there
must be one value representing it, and reconfiguring it while another part of the
program still holds an enabled handle would silently change the baud rate
underneath a transmission in flight.

The route back is the one the API gives you. `disable` consumes the enabled
handle and returns a `Uart<Disabled>`, which is the only type `enable` accepts.
The legal sequences through the state machine are exactly the ones the type
signatures spell out, and there is no runtime check anywhere.

@diagnose E0599
`no method named write found for struct Uart<Disabled>` means the transition was
skipped rather than repeated. `write` lives only in `impl Uart<Enabled>`; a
disabled handle does not have it, which is the point.

@after
Compare this to the C driver it replaces, where the state lives in a comment and a
`uart_init` you have to remember to call. Here the sequence is the only thing that
type-checks, the wrong order does not compile, and none of it costs a byte: every
`Uart<S>` has identical layout, and the whole state machine is erased before code
generation.

The pattern generalises past hardware. Anything with an order can carry its
stage in its type: a builder that must be finished, a connection that must be
opened, a transaction that must be committed. The cost is more type names; the
return is a class of bug that stops being possible.
