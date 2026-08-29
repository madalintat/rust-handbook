---
project: ring-buffer
tier: mini
domain: systems
title: A lock-free ring buffer
accent: rust
blurb: A single-producer single-consumer queue with two atomics and no mutex, with the soundness argument for its unsafe written out and the SPSC rule enforced by the type system.
needs: 18-smart-ptr, 21-concurrency, 23-unsafe
mins: 40
---

Two threads, a queue between them, and no lock anywhere. That is the shape of an
audio callback pulling samples from a mixer, a network thread handing packets to
a parser, a profiler writing events for a background thread to flush. In each
case one thread produces, one consumes, and one of them cannot afford to wait: a
mutex that the audio thread blocks on for two milliseconds is an audible click,
and the click happens whenever the operating system happens to have descheduled
whoever holds the lock.

A single-producer single-consumer ring buffer answers that. A fixed array, an
index where the producer writes next, an index where the consumer reads next, and
two atomic stores to publish the movement. Neither side ever waits for the other.
A push that finds the ring full fails and hands the value back, and a pop that
finds it empty returns `None`.

Four stages. The layout and the reason one slot is always left empty. The two
indices as atomics, and what `Acquire` and `Release` actually buy, which is the
stage worth reading twice. Then `push` and `pop` over raw uninitialised memory,
where the SAFETY comment on each unsafe block has to be an argument and not a
hope. Then splitting the thing into a `Producer` and a `Consumer` so that the
single-producer single-consumer rule is enforced by the compiler rather than by a
comment asking nicely, and running it across two real threads.

The version you end with is sound and slower than the good ones. `rtrb` and
`crossbeam` pad the two indices onto separate cache lines, so that the producer
storing to `head` does not evict the line the consumer is reading `tail` from,
and they cache the other side's index locally to skip most of the atomic loads.
Same algorithm, roughly twice the throughput.

## 1. One slot left empty

@kind fix
@concept index

@expect E0507

The layout: a boxed slice of slots, `head` where the next value goes, `tail`
where the next value comes from. `with_capacity(3)` allocates four slots, and the
fourth is the price of being able to tell full from empty. Everything is safe
Rust and single-threaded for now. `pop` does not compile, because it tries to
take a value out of a slot it only borrowed.

```starter
pub struct RingBuffer<T> {
    slots: Box<[Option<T>]>,
    head: usize,
    tail: usize,
}

impl<T> RingBuffer<T> {
    pub fn with_capacity(capacity: usize) -> RingBuffer<T> {
        assert!(capacity >= 1, "a ring has to hold at least one value");
        let slots = (0..capacity + 1).map(|_| None).collect::<Vec<_>>().into_boxed_slice();
        RingBuffer { slots, head: 0, tail: 0 }
    }

    pub fn capacity(&self) -> usize {
        self.slots.len() - 1
    }

    fn wrap(&self, i: usize) -> usize {
        i % self.slots.len()
    }

    pub fn is_empty(&self) -> bool {
        self.head == self.tail
    }

    pub fn is_full(&self) -> bool {
        self.wrap(self.head + 1) == self.tail
    }

    pub fn len(&self) -> usize {
        self.wrap(self.head + self.slots.len() - self.tail)
    }

    pub fn push(&mut self, value: T) -> Result<(), T> {
        if self.is_full() {
            return Err(value);
        }
        self.slots[self.head] = Some(value);
        self.head = self.wrap(self.head + 1);
        Ok(())
    }

    pub fn pop(&mut self) -> Option<T> {
        if self.is_empty() {
            return None;
        }
        let value = self.slots[self.tail];
        self.tail = self.wrap(self.tail + 1);
        value
    }
}

pub fn run() -> Vec<u32> {
    let mut ring: RingBuffer<u32> = RingBuffer::with_capacity(3);
    println!("{} slots, capacity {}", ring.slots.len(), ring.capacity());

    for v in [10, 20, 30, 40] {
        println!("push {v:3} -> {:?}, len {}", ring.push(v).is_ok(), ring.len());
    }

    let mut drained = Vec::new();
    while let Some(v) = ring.pop() {
        drained.push(v);
    }
    println!("drained {drained:?}, empty {}", ring.is_empty());
    drained
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn three_fit_and_the_fourth_bounces() {
        assert_eq!(run(), vec![10, 20, 30]);
    }

    #[test]
    fn a_ring_of_capacity_n_owns_n_plus_one_slots() {
        let ring: RingBuffer<u8> = RingBuffer::with_capacity(4);
        assert_eq!(ring.capacity(), 4);
        assert_eq!(ring.slots.len(), 5);
    }

    #[test]
    fn empty_and_full_are_different_states() {
        let mut ring: RingBuffer<u8> = RingBuffer::with_capacity(2);
        assert!(ring.is_empty() && !ring.is_full());

        ring.push(1).unwrap();
        ring.push(2).unwrap();
        assert!(ring.is_full() && !ring.is_empty());
        assert_eq!(ring.push(3), Err(3));
        assert_eq!(ring.len(), 2);
    }

    #[test]
    fn the_indices_run_round_and_round() {
        let mut ring: RingBuffer<usize> = RingBuffer::with_capacity(2);
        for round in 0..10 {
            ring.push(round).unwrap();
            assert_eq!(ring.pop(), Some(round));
            assert!(ring.is_empty());
        }
        assert_eq!(ring.pop(), None);
    }
}
```

```solution
pub struct RingBuffer<T> {
    slots: Box<[Option<T>]>,
    head: usize,
    tail: usize,
}

impl<T> RingBuffer<T> {
    pub fn with_capacity(capacity: usize) -> RingBuffer<T> {
        assert!(capacity >= 1, "a ring has to hold at least one value");
        let slots = (0..capacity + 1).map(|_| None).collect::<Vec<_>>().into_boxed_slice();
        RingBuffer { slots, head: 0, tail: 0 }
    }

    pub fn capacity(&self) -> usize {
        self.slots.len() - 1
    }

    fn wrap(&self, i: usize) -> usize {
        i % self.slots.len()
    }

    pub fn is_empty(&self) -> bool {
        self.head == self.tail
    }

    pub fn is_full(&self) -> bool {
        self.wrap(self.head + 1) == self.tail
    }

    pub fn len(&self) -> usize {
        self.wrap(self.head + self.slots.len() - self.tail)
    }

    pub fn push(&mut self, value: T) -> Result<(), T> {
        if self.is_full() {
            return Err(value);
        }
        self.slots[self.head] = Some(value);
        self.head = self.wrap(self.head + 1);
        Ok(())
    }

    pub fn pop(&mut self) -> Option<T> {
        if self.is_empty() {
            return None;
        }
        let value = self.slots[self.tail].take();
        self.tail = self.wrap(self.tail + 1);
        value
    }
}

pub fn run() -> Vec<u32> {
    let mut ring: RingBuffer<u32> = RingBuffer::with_capacity(3);
    println!("{} slots, capacity {}", ring.slots.len(), ring.capacity());

    for v in [10, 20, 30, 40] {
        println!("push {v:3} -> {:?}, len {}", ring.push(v).is_ok(), ring.len());
    }

    let mut drained = Vec::new();
    while let Some(v) = ring.pop() {
        drained.push(v);
    }
    println!("drained {drained:?}, empty {}", ring.is_empty());
    drained
}
```

@hint Indexing a slice gives you a place, not a value. Moving a value out of that place would leave a hole in the slice.
@hint `self.slots[i]` is `Option<T>`, and `T` is not `Copy`, so the compiler will not silently duplicate it. Something has to be left behind in the slot.
@hint `Option::take` is exactly that: it swaps `None` into the slot and hands you what was there. `self.slots[self.tail].take()`.

@diagnose E0507
`cannot move out of self.slots[_] which is behind a mutable reference`, with a
note that the type does not implement `Copy`.

Indexing produces a place expression, not a value, and reading a value out of a
place means either copying it or moving it. `Option<T>` for an arbitrary `T` is
not `Copy`, so a move is the only option, and a move would leave that slot
holding a value that has been given away while the slice still believes it owns
one. The compiler cannot allow a hole in the middle of a slice, because dropping
the slice would then drop something twice.

`take()` fixes it by putting something valid back. It swaps `None` in and returns
the old contents, so the slot stays initialised and ownership moves cleanly to
the caller.

@diagnose E0599
`the method clone exists for enum Option<T>, but its trait bounds were not
satisfied`, from reaching for `.clone()` to dodge the move. `Option<T>: Clone`
requires `T: Clone`, and this is a queue of arbitrary values, most of which are
not cloneable and none of which should be duplicated by a pop anyway. A queue
that clones on the way out leaves the original in the buffer, which is a leak at
best. Take the value; do not copy it.

@after
The empty slot is the point of this stage. Both `head == tail` and a completely
full ring want to be represented, and with `capacity` slots they collide: after
`capacity` pushes the head has wrapped all the way round to the tail, and the
two states are the same pair of numbers.

```text
      capacity 3, four slots

      head                     tail = head, and the ring is EMPTY
        v                       v
      ┌───┬───┬───┬───┐       ┌───┬───┬───┬───┐
      │   │   │   │   │       │ a │ b │ c │   │
      └───┴───┴───┴───┘       └───┴───┴───┴───┘
        ^                                   ^
      tail                                 head, one short of tail: FULL
```

Leaving one slot unused makes `head == tail` mean empty and
`head + 1 == tail` mean full, and both tests are one comparison with no extra
state. The alternatives are a separate count, which is a third thing two threads
would have to agree on, or a flag saying which way the last operation went, which
is worse. Every serious implementation pays the slot.

## 2. Two indices, published atomically

@kind fix
@concept atomic

@expect E0369

`head` and `tail` become `AtomicUsize`. Nothing about the algorithm changes,
but reading one is now a `load` with an ordering and writing one is a `store`
with an ordering, and which ordering you pick is the whole meaning of the
structure. `push` still reads the fields as though they were plain integers.

```starter
use std::sync::atomic::{AtomicUsize, Ordering};

pub struct RingBuffer<T> {
    slots: Box<[Option<T>]>,
    head: AtomicUsize,
    tail: AtomicUsize,
}

impl<T> RingBuffer<T> {
    pub fn with_capacity(capacity: usize) -> RingBuffer<T> {
        assert!(capacity >= 1, "a ring has to hold at least one value");
        let slots = (0..capacity + 1).map(|_| None).collect::<Vec<_>>().into_boxed_slice();
        RingBuffer { slots, head: AtomicUsize::new(0), tail: AtomicUsize::new(0) }
    }

    pub fn capacity(&self) -> usize {
        self.slots.len() - 1
    }

    fn wrap(&self, i: usize) -> usize {
        i % self.slots.len()
    }

    pub fn indices(&self) -> (usize, usize) {
        (self.head.load(Ordering::Acquire), self.tail.load(Ordering::Acquire))
    }

    pub fn is_empty(&self) -> bool {
        let (head, tail) = self.indices();
        head == tail
    }

    pub fn is_full(&self) -> bool {
        let (head, tail) = self.indices();
        self.wrap(head + 1) == tail
    }

    pub fn len(&self) -> usize {
        let (head, tail) = self.indices();
        self.wrap(head + self.slots.len() - tail)
    }

    pub fn push(&mut self, value: T) -> Result<(), T> {
        let head = self.head;
        let next = self.wrap(head + 1);
        if next == self.tail {
            return Err(value);
        }
        self.slots[head] = Some(value);
        self.head.store(next, Ordering::Release);
        Ok(())
    }

    pub fn pop(&mut self) -> Option<T> {
        let tail = self.tail.load(Ordering::Relaxed);
        if tail == self.head.load(Ordering::Acquire) {
            return None;
        }
        let value = self.slots[tail].take();
        self.tail.store(self.wrap(tail + 1), Ordering::Release);
        value
    }
}

pub fn run() -> Vec<(usize, usize)> {
    let mut ring: RingBuffer<u32> = RingBuffer::with_capacity(3);
    let mut seen = vec![ring.indices()];

    for round in 0..5u32 {
        ring.push(round * 10).unwrap();
        ring.push(round * 10 + 1).unwrap();
        assert_eq!(ring.pop(), Some(round * 10));
        assert_eq!(ring.pop(), Some(round * 10 + 1));
        let (head, tail) = ring.indices();
        println!("round {round}: head {head}, tail {tail}, len {}", ring.len());
        seen.push((head, tail));
    }
    seen
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_indices_chase_each_other_round_four_slots() {
        assert_eq!(run(), vec![(0, 0), (2, 2), (0, 0), (2, 2), (0, 0), (2, 2)]);
    }

    #[test]
    fn a_ring_of_capacity_n_owns_n_plus_one_slots() {
        let ring: RingBuffer<u8> = RingBuffer::with_capacity(4);
        assert_eq!(ring.capacity(), 4);
        assert_eq!(ring.slots.len(), 5);
    }

    #[test]
    fn empty_and_full_are_different_states() {
        let mut ring: RingBuffer<u8> = RingBuffer::with_capacity(2);
        assert!(ring.is_empty() && !ring.is_full());

        ring.push(1).unwrap();
        ring.push(2).unwrap();
        assert!(ring.is_full() && !ring.is_empty());
        assert_eq!(ring.push(3), Err(3));
        assert_eq!(ring.indices(), (2, 0));
    }

    #[test]
    fn head_moves_on_push_and_tail_on_pop() {
        let mut ring: RingBuffer<u8> = RingBuffer::with_capacity(3);
        ring.push(7).unwrap();
        assert_eq!(ring.indices(), (1, 0));
        assert_eq!(ring.pop(), Some(7));
        assert_eq!(ring.indices(), (1, 1));
        assert_eq!(ring.pop(), None);
        assert_eq!(ring.indices(), (1, 1));
    }
}
```

```solution
use std::sync::atomic::{AtomicUsize, Ordering};

pub struct RingBuffer<T> {
    slots: Box<[Option<T>]>,
    head: AtomicUsize,
    tail: AtomicUsize,
}

impl<T> RingBuffer<T> {
    pub fn with_capacity(capacity: usize) -> RingBuffer<T> {
        assert!(capacity >= 1, "a ring has to hold at least one value");
        let slots = (0..capacity + 1).map(|_| None).collect::<Vec<_>>().into_boxed_slice();
        RingBuffer { slots, head: AtomicUsize::new(0), tail: AtomicUsize::new(0) }
    }

    pub fn capacity(&self) -> usize {
        self.slots.len() - 1
    }

    fn wrap(&self, i: usize) -> usize {
        i % self.slots.len()
    }

    pub fn indices(&self) -> (usize, usize) {
        (self.head.load(Ordering::Acquire), self.tail.load(Ordering::Acquire))
    }

    pub fn is_empty(&self) -> bool {
        let (head, tail) = self.indices();
        head == tail
    }

    pub fn is_full(&self) -> bool {
        let (head, tail) = self.indices();
        self.wrap(head + 1) == tail
    }

    pub fn len(&self) -> usize {
        let (head, tail) = self.indices();
        self.wrap(head + self.slots.len() - tail)
    }

    pub fn push(&mut self, value: T) -> Result<(), T> {
        let head = self.head.load(Ordering::Relaxed);
        let next = self.wrap(head + 1);
        if next == self.tail.load(Ordering::Acquire) {
            return Err(value);
        }
        self.slots[head] = Some(value);
        self.head.store(next, Ordering::Release);
        Ok(())
    }

    pub fn pop(&mut self) -> Option<T> {
        let tail = self.tail.load(Ordering::Relaxed);
        if tail == self.head.load(Ordering::Acquire) {
            return None;
        }
        let value = self.slots[tail].take();
        self.tail.store(self.wrap(tail + 1), Ordering::Release);
        value
    }
}

pub fn run() -> Vec<(usize, usize)> {
    let mut ring: RingBuffer<u32> = RingBuffer::with_capacity(3);
    let mut seen = vec![ring.indices()];

    for round in 0..5u32 {
        ring.push(round * 10).unwrap();
        ring.push(round * 10 + 1).unwrap();
        assert_eq!(ring.pop(), Some(round * 10));
        assert_eq!(ring.pop(), Some(round * 10 + 1));
        let (head, tail) = ring.indices();
        println!("round {round}: head {head}, tail {tail}, len {}", ring.len());
        seen.push((head, tail));
    }
    seen
}
```

@hint An `AtomicUsize` is not a `usize` and does not pretend to be. Adding one to it is not defined.
@hint Every read is `self.head.load(ordering)` and every write is `self.head.store(value, ordering)`. The ordering argument is not optional.
@hint The producer owns `head`, so it can read its own with `Relaxed`. It has to read the consumer's `tail` with `Acquire`, and publish its own with `Release`.

@diagnose E0369
`cannot add {integer} to AtomicUsize`, with a note that `AtomicUsize` does not
implement `Add<{integer}>`.

The omission is deliberate. `head + 1` would have to read the atomic, and an
atomic read is a choice: `Relaxed` compiles to a plain load on x86 and ARM,
`Acquire` costs a barrier on ARM, `SeqCst` costs one everywhere. An operator
would hide that choice inside a `+`, so the standard library does not provide
one, and `load(ordering)` makes you name it every time.

The same reasoning explains the missing `Copy` and the fact that `AtomicUsize` is
`Sync` but reads and writes go through `&self` methods. Everything about the type
is arranged so that shared mutation is visible in the source.

@diagnose E0308
`expected usize, found AtomicUsize`, from `if next == self.tail`. Comparing an
index against the atomic itself, rather than against a value loaded out of it,
is asking whether a number equals a synchronisation primitive. Load first, into a
local: `let tail = self.tail.load(Ordering::Acquire);`. Keeping the loaded value
in a local also matters for correctness once two threads are running, because two
loads of the same atomic can return different values.

@diagnose E0277
`the type [Option<T>] cannot be indexed by AtomicUsize`. Slice indices are
`usize`, and the same fix applies: index with the value you loaded, not with the
atomic. Note that this makes the loaded index a snapshot. `self.slots[head]`
where `head` was loaded above uses one consistent value, whereas loading again
inside the index expression could use a different one, and in a concurrent queue
that difference is the bug.

@after
The orderings, precisely, because this is where hand-waving turns into a data
race. An atomic operation on its own only promises that the value itself is not
torn. `Release` and `Acquire` add the promise that matters, which is about all
the *other* memory around it.

| operation | ordering | what it buys |
|---|---|---|
| producer reads its own `head` | `Relaxed` | nothing, and nothing is needed: no other thread writes it |
| producer reads `tail` | `Acquire` | everything the consumer did before its `Release` store of `tail` is visible here |
| producer writes `head` | `Release` | the slot write above cannot be reordered after it, and is visible to anyone who `Acquire`-loads `head` |
| consumer reads `head` | `Acquire` | pairs with the producer's release: the value in the slot is really there |
| consumer writes `tail` | `Release` | the read out of the slot cannot be reordered after it |

A `Release` store and the `Acquire` load that reads it form a pair, and the pair
creates a happens-before edge between the two threads. Everything the storing
thread did before the store is visible to the loading thread after the load.
Without the pair there is no edge, and then the compiler and the processor are
both entitled to move the slot write after the index publication, which means the
consumer can see the index move and read a slot that has not been written yet.

`SeqCst` would also be correct and adds a total order across all atomics that
nothing here needs, at the cost of a full barrier on every operation. `Relaxed`
everywhere compiles and is wrong, in a way that no single-threaded test will ever
show you.

## 3. The unsafe part, and the argument for it

@kind fix
@concept unsafe

@expect E0133

Two threads cannot both hold `&mut`, so `push` and `pop` have to work through
`&self`, which means the slots move into `UnsafeCell`. `Option<T>` goes too:
there is no reason to store a discriminant when the indices already say which
slots are live, so the storage becomes `MaybeUninit<T>`. `pop` is written for
you, comment and all. `push` is not.

```starter
use std::cell::UnsafeCell;
use std::mem::MaybeUninit;
use std::sync::atomic::{AtomicUsize, Ordering};

pub struct RingBuffer<T> {
    slots: Box<[UnsafeCell<MaybeUninit<T>>]>,
    head: AtomicUsize,
    tail: AtomicUsize,
}

impl<T> RingBuffer<T> {
    pub fn with_capacity(capacity: usize) -> RingBuffer<T> {
        assert!(capacity >= 1, "a ring has to hold at least one value");
        let slots = (0..capacity + 1)
            .map(|_| UnsafeCell::new(MaybeUninit::uninit()))
            .collect::<Vec<_>>()
            .into_boxed_slice();
        RingBuffer { slots, head: AtomicUsize::new(0), tail: AtomicUsize::new(0) }
    }

    pub fn capacity(&self) -> usize {
        self.slots.len() - 1
    }

    fn wrap(&self, i: usize) -> usize {
        i % self.slots.len()
    }

    pub fn indices(&self) -> (usize, usize) {
        (self.head.load(Ordering::Acquire), self.tail.load(Ordering::Acquire))
    }

    pub fn is_empty(&self) -> bool {
        let (head, tail) = self.indices();
        head == tail
    }

    pub fn is_full(&self) -> bool {
        let (head, tail) = self.indices();
        self.wrap(head + 1) == tail
    }

    pub fn len(&self) -> usize {
        let (head, tail) = self.indices();
        self.wrap(head + self.slots.len() - tail)
    }

    pub fn push(&self, value: T) -> Result<(), T> {
        let head = self.head.load(Ordering::Relaxed);
        let next = self.wrap(head + 1);
        if next == self.tail.load(Ordering::Acquire) {
            return Err(value);
        }
        // SAFETY: write the sentence that earns this, then wrap the line
        // below in the unsafe block it needs.
        (*self.slots[head].get()).write(value);
        self.head.store(next, Ordering::Release);
        Ok(())
    }

    pub fn pop(&self) -> Option<T> {
        let tail = self.tail.load(Ordering::Relaxed);
        if tail == self.head.load(Ordering::Acquire) {
            return None;
        }
        // SAFETY: tail != head means slot tail was filled by a push whose
        // Release store of head this Acquire load observed, so the value is
        // initialised and the write happened before this read. Only the
        // consumer writes tail, so this slot is read exactly once and the
        // move out is not a double read.
        let value = unsafe { (*self.slots[tail].get()).assume_init_read() };
        self.tail.store(self.wrap(tail + 1), Ordering::Release);
        Some(value)
    }
}

impl<T> Drop for RingBuffer<T> {
    fn drop(&mut self) {
        // Every slot outside [tail, head) is uninitialised, so dropping the
        // Box alone would leak the values still queued. pop knows which ones
        // those are.
        while self.pop().is_some() {}
    }
}

pub fn run() -> Vec<String> {
    let ring: RingBuffer<String> = RingBuffer::with_capacity(3);
    let mut drained = Vec::new();

    for round in 0..3 {
        for i in 0..3 {
            ring.push(format!("job {round}.{i}")).unwrap();
        }
        assert_eq!(ring.push("one too many".to_string()), Err("one too many".to_string()));
        while let Some(job) = ring.pop() {
            println!("ran {job}");
            drained.push(job);
        }
    }
    println!("{} jobs through a 4 slot ring, {} left", drained.len(), ring.len());
    drained
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nine_jobs_pass_through_a_ring_that_holds_three() {
        let drained = run();
        assert_eq!(drained.len(), 9);
        assert_eq!(drained[0], "job 0.0");
        assert_eq!(drained[8], "job 2.2");
    }

    #[test]
    fn push_and_pop_need_only_a_shared_reference() {
        let ring: RingBuffer<u32> = RingBuffer::with_capacity(2);
        ring.push(1).unwrap();
        ring.push(2).unwrap();
        assert_eq!(ring.push(3), Err(3));
        assert_eq!(ring.pop(), Some(1));
        assert_eq!(ring.pop(), Some(2));
        assert_eq!(ring.pop(), None);
    }

    #[test]
    fn values_come_out_in_order_across_a_wrap() {
        let ring: RingBuffer<usize> = RingBuffer::with_capacity(4);
        let mut out = Vec::new();
        for i in 0..1000 {
            ring.push(i).unwrap();
            if i % 3 == 2 {
                while let Some(v) = ring.pop() {
                    out.push(v);
                }
            }
        }
        while let Some(v) = ring.pop() {
            out.push(v);
        }
        assert_eq!(out, (0..1000).collect::<Vec<_>>());
    }

    #[test]
    fn queued_values_are_dropped_exactly_once() {
        static DROPS: AtomicUsize = AtomicUsize::new(0);
        struct Counted;
        impl Drop for Counted {
            fn drop(&mut self) {
                DROPS.fetch_add(1, Ordering::Relaxed);
            }
        }

        {
            let ring: RingBuffer<Counted> = RingBuffer::with_capacity(8);
            for _ in 0..5 {
                assert!(ring.push(Counted).is_ok());
            }
            drop(ring.pop());
            assert_eq!(DROPS.load(Ordering::Relaxed), 1);
        }
        assert_eq!(DROPS.load(Ordering::Relaxed), 5);
    }
}
```

```solution
use std::cell::UnsafeCell;
use std::mem::MaybeUninit;
use std::sync::atomic::{AtomicUsize, Ordering};

pub struct RingBuffer<T> {
    slots: Box<[UnsafeCell<MaybeUninit<T>>]>,
    head: AtomicUsize,
    tail: AtomicUsize,
}

impl<T> RingBuffer<T> {
    pub fn with_capacity(capacity: usize) -> RingBuffer<T> {
        assert!(capacity >= 1, "a ring has to hold at least one value");
        let slots = (0..capacity + 1)
            .map(|_| UnsafeCell::new(MaybeUninit::uninit()))
            .collect::<Vec<_>>()
            .into_boxed_slice();
        RingBuffer { slots, head: AtomicUsize::new(0), tail: AtomicUsize::new(0) }
    }

    pub fn capacity(&self) -> usize {
        self.slots.len() - 1
    }

    fn wrap(&self, i: usize) -> usize {
        i % self.slots.len()
    }

    pub fn indices(&self) -> (usize, usize) {
        (self.head.load(Ordering::Acquire), self.tail.load(Ordering::Acquire))
    }

    pub fn is_empty(&self) -> bool {
        let (head, tail) = self.indices();
        head == tail
    }

    pub fn is_full(&self) -> bool {
        let (head, tail) = self.indices();
        self.wrap(head + 1) == tail
    }

    pub fn len(&self) -> usize {
        let (head, tail) = self.indices();
        self.wrap(head + self.slots.len() - tail)
    }

    pub fn push(&self, value: T) -> Result<(), T> {
        let head = self.head.load(Ordering::Relaxed);
        let next = self.wrap(head + 1);
        if next == self.tail.load(Ordering::Acquire) {
            return Err(value);
        }
        // SAFETY: only the producer writes head, so nobody else is looking at
        // this index. The slot is outside [tail, head), the range the consumer
        // may read, because next != tail says the ring is not full. The Acquire
        // load above pairs with the consumer's Release store of tail, so if a
        // value used to live here, its read has already happened.
        unsafe { (*self.slots[head].get()).write(value) };
        self.head.store(next, Ordering::Release);
        Ok(())
    }

    pub fn pop(&self) -> Option<T> {
        let tail = self.tail.load(Ordering::Relaxed);
        if tail == self.head.load(Ordering::Acquire) {
            return None;
        }
        // SAFETY: tail != head means slot tail was filled by a push whose
        // Release store of head this Acquire load observed, so the value is
        // initialised and the write happened before this read. Only the
        // consumer writes tail, so this slot is read exactly once and the
        // move out is not a double read.
        let value = unsafe { (*self.slots[tail].get()).assume_init_read() };
        self.tail.store(self.wrap(tail + 1), Ordering::Release);
        Some(value)
    }
}

impl<T> Drop for RingBuffer<T> {
    fn drop(&mut self) {
        // Every slot outside [tail, head) is uninitialised, so dropping the
        // Box alone would leak the values still queued. pop knows which ones
        // those are.
        while self.pop().is_some() {}
    }
}

pub fn run() -> Vec<String> {
    let ring: RingBuffer<String> = RingBuffer::with_capacity(3);
    let mut drained = Vec::new();

    for round in 0..3 {
        for i in 0..3 {
            ring.push(format!("job {round}.{i}")).unwrap();
        }
        assert_eq!(ring.push("one too many".to_string()), Err("one too many".to_string()));
        while let Some(job) = ring.pop() {
            println!("ran {job}");
            drained.push(job);
        }
    }
    println!("{} jobs through a 4 slot ring, {} left", drained.len(), ring.len());
    drained
}
```

@hint `UnsafeCell::get` hands back a `*mut`, and dereferencing a raw pointer is the one thing safe Rust will not do.
@hint The block is the easy half. The SAFETY comment above it is the part that has to be true: say why no other thread can be looking at this slot, and why the value that used to be there has already been taken.
@hint `unsafe { (*self.slots[head].get()).write(value) };` with a comment naming the invariant: only the producer writes `head`, and the `Acquire` load of `tail` proves the slot is free.

@diagnose E0133
`dereference of raw pointer is unsafe and requires unsafe function or block`.

`UnsafeCell::get` returns `*mut T` and hands you the compiler's entire aliasing
guarantee to hold yourself. Following that pointer could read uninitialised
memory, could alias a `&mut` that another part of the program is holding, could
outlive the allocation. None of that is checkable, so the language asks for the
keyword.

What `unsafe` does is narrow: it permits five extra operations and turns off
nothing else. Borrow checking, types and lifetimes all still apply inside the
block. It is a marker saying you have made an argument the compiler cannot make,
which is why a bare `unsafe { }` with no comment is a bug report waiting to be
filed.

@diagnose E0594
`cannot assign to data in an index of self.slots, which is behind a & reference`.
This is the error you get if the slots are a plain `Box<[T]>` rather than
`UnsafeCell`. It is the correct refusal: `&self` means shared, shared means any
number of readers, and writing through it would be a data race by definition.
`UnsafeCell` is the only way in the language to get a `*mut` out of a `&`, and
every interior-mutability type, `Cell`, `RefCell`, `Mutex` and the atomics, is
built on it.

@diagnose E0381
`used binding is possibly-uninitialised`, or a complaint about reading a
`MaybeUninit<T>` as a `T`. `MaybeUninit<T>` is not `T`; it is a `T`-shaped hole
with no promise about its contents, and the compiler will not let you treat one
as the other implicitly. `write` puts a value in, `assume_init_read` takes one
out and is where you promise a value was written first. That promise is what the
indices exist to keep.

@after
Read the two comments back, because they are the deliverable of this stage.

`push` writes slot `head`. The consumer only ever reads slots in the range
`[tail, head)`, and `head` is not in that range, so the write cannot race a read
no matter when the two threads are scheduled. The `Acquire` load of `tail` adds
the other half: if a value once lived in this slot, seeing `next != tail` means
seeing the consumer's `Release` store, which means the consumer's read of that
slot happened before this write.

`pop` reads slot `tail`, having seen `tail != head` through an `Acquire` load.
That load observed the producer's `Release` store, so the slot has been written
and the write is visible. Only the consumer moves `tail`, so no second reader can
take the same value, and `assume_init_read` moving out of the slot is safe
precisely because nothing will read it again before the producer overwrites it.

`Drop` matters too. The slots outside `[tail, head)` are uninitialised, so
dropping the `Box` cannot drop them. Draining with `pop` drops exactly the live
ones, exactly once, which the `Counted` test checks.

## 4. Two halves, one rule, enforced

@kind fix
@concept send

@expect E0277

Everything so far rests on one sentence: only the producer writes `head`, only
the consumer writes `tail`. A comment cannot enforce that. Split the ring into a
`Producer` that can only push and a `Consumer` that can only pop, hand one to
each thread, and the rule becomes a fact about the types. Two lines are missing,
and they are the two that carry a promise.

```starter
use std::sync::Arc;
use std::thread;

use std::cell::UnsafeCell;
use std::mem::MaybeUninit;
use std::sync::atomic::{AtomicUsize, Ordering};

pub struct RingBuffer<T> {
    slots: Box<[UnsafeCell<MaybeUninit<T>>]>,
    head: AtomicUsize,
    tail: AtomicUsize,
}

impl<T> RingBuffer<T> {
    pub fn with_capacity(capacity: usize) -> RingBuffer<T> {
        assert!(capacity >= 1, "a ring has to hold at least one value");
        let slots = (0..capacity + 1)
            .map(|_| UnsafeCell::new(MaybeUninit::uninit()))
            .collect::<Vec<_>>()
            .into_boxed_slice();
        RingBuffer { slots, head: AtomicUsize::new(0), tail: AtomicUsize::new(0) }
    }

    pub fn capacity(&self) -> usize {
        self.slots.len() - 1
    }

    fn wrap(&self, i: usize) -> usize {
        i % self.slots.len()
    }

    pub fn indices(&self) -> (usize, usize) {
        (self.head.load(Ordering::Acquire), self.tail.load(Ordering::Acquire))
    }

    pub fn is_empty(&self) -> bool {
        let (head, tail) = self.indices();
        head == tail
    }

    pub fn is_full(&self) -> bool {
        let (head, tail) = self.indices();
        self.wrap(head + 1) == tail
    }

    pub fn len(&self) -> usize {
        let (head, tail) = self.indices();
        self.wrap(head + self.slots.len() - tail)
    }

    pub fn push(&self, value: T) -> Result<(), T> {
        let head = self.head.load(Ordering::Relaxed);
        let next = self.wrap(head + 1);
        if next == self.tail.load(Ordering::Acquire) {
            return Err(value);
        }
        // SAFETY: only the producer writes head, so nobody else is looking at
        // this index. The slot is outside [tail, head), the range the consumer
        // may read, because next != tail says the ring is not full. The Acquire
        // load above pairs with the consumer's Release store of tail, so if a
        // value used to live here, its read has already happened.
        unsafe { (*self.slots[head].get()).write(value) };
        self.head.store(next, Ordering::Release);
        Ok(())
    }

    pub fn pop(&self) -> Option<T> {
        let tail = self.tail.load(Ordering::Relaxed);
        if tail == self.head.load(Ordering::Acquire) {
            return None;
        }
        // SAFETY: tail != head means slot tail was filled by a push whose
        // Release store of head this Acquire load observed, so the value is
        // initialised and the write happened before this read. Only the
        // consumer writes tail, so this slot is read exactly once and the
        // move out is not a double read.
        let value = unsafe { (*self.slots[tail].get()).assume_init_read() };
        self.tail.store(self.wrap(tail + 1), Ordering::Release);
        Some(value)
    }
}

impl<T> Drop for RingBuffer<T> {
    fn drop(&mut self) {
        // Every slot outside [tail, head) is uninitialised, so dropping the
        // Box alone would leak the values still queued. pop knows which ones
        // those are.
        while self.pop().is_some() {}
    }
}

pub struct Producer<T> {
    ring: Arc<RingBuffer<T>>,
}

pub struct Consumer<T> {
    ring: Arc<RingBuffer<T>>,
}

// SAFETY: RingBuffer is not Sync, so Arc<RingBuffer<T>> is not Send on its own.
// The claim being made here is narrower than Sync: a Producer is the only
// handle that can ever call push, a Consumer the only one that can call pop,
// neither can be cloned, and neither is Sync, so at most one thread at a time
// holds each half. That is exactly the single-producer single-consumer rule the
// SAFETY comments in push and pop rely on. T: Send because sending a half sends
// the values in it, and the last half to be dropped drops whatever is queued.

pub fn channel<T>(capacity: usize) -> (Producer<T>, Consumer<T>) {
    let ring = Arc::new(RingBuffer::with_capacity(capacity));
    (Producer { ring: Arc::clone(&ring) }, Consumer { ring })
}

impl<T> Producer<T> {
    pub fn push(&mut self, value: T) -> Result<(), T> {
        self.ring.push(value)
    }

    pub fn is_full(&self) -> bool {
        self.ring.is_full()
    }
}

impl<T> Consumer<T> {
    pub fn pop(&mut self) -> Option<T> {
        self.ring.pop()
    }

    pub fn is_empty(&self) -> bool {
        self.ring.is_empty()
    }
}

pub const COUNT: usize = 2_000;

pub fn run() -> Vec<usize> {
    let (mut tx, mut rx) = channel::<usize>(64);

    let producer = thread::spawn(move || {
        for i in 0..COUNT {
            while tx.push(i).is_err() {
                thread::yield_now();
            }
        }
    });

    let mut got = Vec::with_capacity(COUNT);
    while got.len() < COUNT {
        match rx.pop() {
            Some(v) => got.push(v),
            None => thread::yield_now(),
        }
    }
    producer.join().expect("the producer thread finished");

    println!("{} values across two threads, first {:?}, last {:?}",
             got.len(), got.first(), got.last());
    got
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_value_arrives_exactly_once_and_in_order() {
        let got = run();
        assert_eq!(got.len(), COUNT);
        assert_eq!(got, (0..COUNT).collect::<Vec<_>>());
    }

    #[test]
    fn each_half_can_cross_a_thread_boundary_on_its_own() {
        fn assert_send<T: Send>() {}
        assert_send::<Producer<String>>();
        assert_send::<Consumer<String>>();

        let (mut tx, mut rx) = channel::<String>(4);
        let filler = thread::spawn(move || {
            tx.push("from another thread".to_string()).unwrap();
            tx
        });
        drop(filler.join().expect("the filler thread finished"));
        assert_eq!(rx.pop().as_deref(), Some("from another thread"));
    }

    #[test]
    fn a_full_ring_makes_the_producer_wait_rather_than_lose_a_value() {
        let (mut tx, mut rx) = channel::<usize>(2);
        assert!(tx.push(1).is_ok());
        assert!(tx.push(2).is_ok());
        assert!(tx.is_full());
        assert_eq!(tx.push(3), Err(3));

        assert_eq!(rx.pop(), Some(1));
        assert!(tx.push(3).is_ok());
        assert_eq!(rx.pop(), Some(2));
        assert_eq!(rx.pop(), Some(3));
        assert!(rx.is_empty());
        assert_eq!(rx.pop(), None);
    }

    #[test]
    fn a_dropped_consumer_leaves_the_queued_values_to_the_producer() {
        let (mut tx, rx) = channel::<String>(4);
        tx.push("kept".to_string()).unwrap();
        drop(rx);
        tx.push("also kept".to_string()).unwrap();
        drop(tx);
    }
}
```

```solution
use std::sync::Arc;
use std::thread;

use std::cell::UnsafeCell;
use std::mem::MaybeUninit;
use std::sync::atomic::{AtomicUsize, Ordering};

pub struct RingBuffer<T> {
    slots: Box<[UnsafeCell<MaybeUninit<T>>]>,
    head: AtomicUsize,
    tail: AtomicUsize,
}

impl<T> RingBuffer<T> {
    pub fn with_capacity(capacity: usize) -> RingBuffer<T> {
        assert!(capacity >= 1, "a ring has to hold at least one value");
        let slots = (0..capacity + 1)
            .map(|_| UnsafeCell::new(MaybeUninit::uninit()))
            .collect::<Vec<_>>()
            .into_boxed_slice();
        RingBuffer { slots, head: AtomicUsize::new(0), tail: AtomicUsize::new(0) }
    }

    pub fn capacity(&self) -> usize {
        self.slots.len() - 1
    }

    fn wrap(&self, i: usize) -> usize {
        i % self.slots.len()
    }

    pub fn indices(&self) -> (usize, usize) {
        (self.head.load(Ordering::Acquire), self.tail.load(Ordering::Acquire))
    }

    pub fn is_empty(&self) -> bool {
        let (head, tail) = self.indices();
        head == tail
    }

    pub fn is_full(&self) -> bool {
        let (head, tail) = self.indices();
        self.wrap(head + 1) == tail
    }

    pub fn len(&self) -> usize {
        let (head, tail) = self.indices();
        self.wrap(head + self.slots.len() - tail)
    }

    pub fn push(&self, value: T) -> Result<(), T> {
        let head = self.head.load(Ordering::Relaxed);
        let next = self.wrap(head + 1);
        if next == self.tail.load(Ordering::Acquire) {
            return Err(value);
        }
        // SAFETY: only the producer writes head, so nobody else is looking at
        // this index. The slot is outside [tail, head), the range the consumer
        // may read, because next != tail says the ring is not full. The Acquire
        // load above pairs with the consumer's Release store of tail, so if a
        // value used to live here, its read has already happened.
        unsafe { (*self.slots[head].get()).write(value) };
        self.head.store(next, Ordering::Release);
        Ok(())
    }

    pub fn pop(&self) -> Option<T> {
        let tail = self.tail.load(Ordering::Relaxed);
        if tail == self.head.load(Ordering::Acquire) {
            return None;
        }
        // SAFETY: tail != head means slot tail was filled by a push whose
        // Release store of head this Acquire load observed, so the value is
        // initialised and the write happened before this read. Only the
        // consumer writes tail, so this slot is read exactly once and the
        // move out is not a double read.
        let value = unsafe { (*self.slots[tail].get()).assume_init_read() };
        self.tail.store(self.wrap(tail + 1), Ordering::Release);
        Some(value)
    }
}

impl<T> Drop for RingBuffer<T> {
    fn drop(&mut self) {
        // Every slot outside [tail, head) is uninitialised, so dropping the
        // Box alone would leak the values still queued. pop knows which ones
        // those are.
        while self.pop().is_some() {}
    }
}

pub struct Producer<T> {
    ring: Arc<RingBuffer<T>>,
}

pub struct Consumer<T> {
    ring: Arc<RingBuffer<T>>,
}

// SAFETY: RingBuffer is not Sync, so Arc<RingBuffer<T>> is not Send on its own.
// The claim being made here is narrower than Sync: a Producer is the only
// handle that can ever call push, a Consumer the only one that can call pop,
// neither can be cloned, and neither is Sync, so at most one thread at a time
// holds each half. That is exactly the single-producer single-consumer rule the
// SAFETY comments in push and pop rely on. T: Send because sending a half sends
// the values in it, and the last half to be dropped drops whatever is queued.
unsafe impl<T: Send> Send for Producer<T> {}
unsafe impl<T: Send> Send for Consumer<T> {}

pub fn channel<T>(capacity: usize) -> (Producer<T>, Consumer<T>) {
    let ring = Arc::new(RingBuffer::with_capacity(capacity));
    (Producer { ring: Arc::clone(&ring) }, Consumer { ring })
}

impl<T> Producer<T> {
    pub fn push(&mut self, value: T) -> Result<(), T> {
        self.ring.push(value)
    }

    pub fn is_full(&self) -> bool {
        self.ring.is_full()
    }
}

impl<T> Consumer<T> {
    pub fn pop(&mut self) -> Option<T> {
        self.ring.pop()
    }

    pub fn is_empty(&self) -> bool {
        self.ring.is_empty()
    }
}

pub const COUNT: usize = 2_000;

pub fn run() -> Vec<usize> {
    let (mut tx, mut rx) = channel::<usize>(64);

    let producer = thread::spawn(move || {
        for i in 0..COUNT {
            while tx.push(i).is_err() {
                thread::yield_now();
            }
        }
    });

    let mut got = Vec::with_capacity(COUNT);
    while got.len() < COUNT {
        match rx.pop() {
            Some(v) => got.push(v),
            None => thread::yield_now(),
        }
    }
    producer.join().expect("the producer thread finished");

    println!("{} values across two threads, first {:?}, last {:?}",
             got.len(), got.first(), got.last());
    got
}
```

@hint `RingBuffer` contains an `UnsafeCell`, so it is not `Sync`, so `Arc<RingBuffer<T>>` is not `Send`, so neither half can be moved to another thread. That is the compiler being right by default.
@hint Sending a `Producer` is safe even though sharing a `RingBuffer` is not, because the `Producer` is the only handle that can push and there is exactly one of it. That is a claim only you can make.
@hint `unsafe impl<T: Send> Send for Producer<T> {}` and the same for `Consumer<T>`, with a comment saying what makes them true.

@diagnose E0277
`UnsafeCell<MaybeUninit<usize>> cannot be shared between threads safely`, then
`required because it appears within RingBuffer<usize>`, then `required for
Arc<RingBuffer<usize>> to implement Send`.

Follow the chain backwards. `thread::spawn` needs its closure to be `Send`. The
closure captures a `Producer`, whose only field is an `Arc`. `Arc<T>` is `Send`
only when `T` is both `Send` and `Sync`, because handing an `Arc` to another
thread gives two threads shared access to the same `T`. And `RingBuffer` is not
`Sync`, because `UnsafeCell` is not, which is the whole mechanism by which a type
containing one is kept out of concurrent code unless somebody vouches for it.

Vouching is `unsafe impl Send`. What makes it true here is that the two halves
are not two references to one shared thing in the way `Arc` normally implies:
each half has exclusive rights to its own index and its own set of slots.

@diagnose E0200
`the trait Send requires an unsafe impl declaration`. You wrote `impl<T: Send>
Send for Producer<T> {}` with no `unsafe`, and rustc is pointing out that this
trait has invariants it cannot check. `Send` and `Sync` are auto traits: the
compiler derives them structurally for almost every type, and writing one by hand
means overruling that analysis. The `unsafe` keyword is where you accept
responsibility for the overrule, and the comment above it is where you say why
the compiler's conservative answer was too strict.

@diagnose E0382
`use of moved value: tx`, from trying to keep using the producer after the
closure took it. `thread::spawn` requires a `'static` closure, so a `move`
closure takes the `Producer` outright. That is the intended shape: the producing
thread owns the producing half for its whole life. If you need it back
afterwards, return it from the closure and take it out of the `JoinHandle`, which
is what one of the tests does.

@after
The type system is now carrying the invariant. `Producer` and `Consumer` are
`Send` and not `Sync`, and neither derives `Clone`, so a half can be moved to one
thread and cannot be shared with a second, cannot be duplicated, and cannot pop
if it is a producer. Two producers are unconstructible rather than discouraged.

That is the difference between this and a comment saying "call push from one
thread only". A comment is checked by whoever reads the file next. This is
checked at every call site, including the ones written a year later by someone
who never read the file.

The test runs 2,000 values across two real threads and asserts on the vector
after `join`, never on the interleaving, because the interleaving is genuinely
non-deterministic and asserting on it would be a test that fails on somebody
else's machine. What is deterministic is the outcome: every value arrives, once,
in order.

Where this queue is still worse than the ones in `rtrb` or `crossbeam`. `head`
and `tail` sit in the same cache line here, so every publication by the producer
invalidates the consumer's copy of the line it is reading `tail` from; padding
them apart is the single biggest win available. Each side could also cache the
other's index and re-load only when it appears to be full or empty, which removes
most of the atomic loads. And the caller busy-waits when the ring is full, where
a real queue would park the thread and be woken.
