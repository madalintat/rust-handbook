---
unit: 21-concurrency
---

## 1

Does this compile?

```rust
use std::thread;

fn main() {
    let name = String::from("ada");
    thread::spawn(|| println!("{name}")).join().unwrap();
}
```

- A. Yes — `join` on the next line proves the thread ends first
- *B. No — the closure borrows `name` and `spawn` requires `'static`
- C. No — `println!` cannot be used off the main thread
- D. Yes, but the output order is unspecified

@why
`error[E0373]`. The fix is `move ||`.

A is the tempting one and it is a correct observation about the *program*. It is
not a fact about the *types*, and the borrow checker works from signatures alone.
`thread::spawn` is declared `F: Send + 'static`, so it accepts nothing that
borrows a caller's frame — regardless of what the caller happens to do next. If
you want the compiler to use that knowledge, you have to give it a type that
carries it, which is `thread::scope`.

## 2

What does this print?

```rust
let mut count = 0;
let h = std::thread::spawn(move || { count += 1; count });
let inner = h.join().unwrap();
println!("{count} {inner}");
```

- A. `1 1`
- *B. `0 1`
- C. It does not compile — `count` was moved
- D. `1 0`

@why
`move` applies to every capture, including `Copy` ones — and for a `Copy` type
"moving" is copying. The closure got its own `i32`, incremented that, and
returned 1. The original is untouched, so `0 1`.

C is the trap. Because `i32` is `Copy`, `move` does not retire the original
binding the way it would for a `String`; both stay usable. If you need a thread's
mutation to be visible to the spawner, `move` is never enough — you need
`Arc<Mutex<T>>`, an atomic, or the thread's return value.

## 3

Why is `Rc<T>` not `Send`?

- A. Because it points at the heap, and heaps are not shared between threads
- *B. Because its reference count is incremented non-atomically, so concurrent clones can lose a count
- C. Because `T` might not be `Send`
- D. Because `Rc` has no lock inside it

@why
`Rc::clone` is a load, an add and a store on a plain `usize`. Two threads doing
it simultaneously can both read 1 and both write 2, so a count that should be 3
is 2 — and the second drop frees a value the third holder is still using.

C is a real condition but not the reason: `Rc<T>` is not `Send` even when `T` is
`Send`, because the failure is in `Rc`'s own bookkeeping. `Arc` is the identical
type with `fetch_add`, which is exactly one instruction different.

## 4

`T: Sync` is equivalent to which statement?

- A. `T: Send`
- *B. `&T: Send`
- C. `T` contains a lock
- D. `&mut T: Send`

@why
That is the definition, not a consequence: a type is `Sync` when a shared
reference to it can be sent to another thread. The compiler prints it in the
error — `required for &RefCell<i32> to implement Send`.

D is a good distractor because `&mut T: Send` sounds stronger, but it follows
from `T: Send`, not from `Sync` — a unique reference is exclusive access, which
is the same situation as moving the value.

## 5

Which of these are `Send`? Choose all that apply.

- *A. `Arc<Mutex<Vec<u8>>>`
- B. `Rc<String>`
- *C. `RefCell<i32>`
- *D. `Vec<RefCell<u8>>`
- E. `MutexGuard<'_, i32>`

@why
C and D surprise people. `RefCell<i32>` is `Send` — moving it to another thread
is fine, because only one thread has it afterwards. What it is not is `Sync`: two
threads sharing a `&RefCell` can both pass its non-atomic borrow check. Auto
traits propagate structurally, so a `Vec` of them is `Send` too.

B is out because `Rc`'s count is not atomic. E is the one nobody guesses: on most
platforms a mutex must be released by the thread that took it, so `MutexGuard` is
`Sync` but deliberately not `Send`.

## 6

Does this compile?

```rust
use std::sync::Arc;
let v = Arc::new(vec![1, 2, 3]);
let c = Arc::clone(&v);
c.push(4);
```

- A. Yes — `Arc` is for sharing, and sharing includes writing
- *B. No — `Arc<T>` implements `Deref` but not `DerefMut`
- C. No — `Vec::push` requires the vector to be declared `mut`
- D. Yes, but only because `v` and `c` point at the same allocation

@why
`error[E0596]`. `Arc` cannot implement `DerefMut`: its whole purpose is that
several owners exist at once, so handing out a `&mut` would be handing out two
unique references to one value — `E0499` laundered through a smart pointer.

C is close enough to be tempting, and adding `mut` to the bindings changes
nothing: the problem is not the binding's mutability but the type's. Mutation
comes back by putting a `Mutex` (or `RwLock`, or an atomic) inside the `Arc`.

## 7

Why is the data stored *inside* `Mutex<T>` rather than beside it?

- A. To save a pointer indirection
- *B. Because there is then no way to reach the data without going through `lock()`
- C. Because `Mutex` needs to know the size of `T` to allocate
- D. So that `T` can implement `Drop`

@why
In C, `pthread_mutex_t lock;` and `int counter;` are two unrelated variables and
the connection between them lives in a comment. Nothing stops you touching the
counter without the lock, and nothing warns you when someone does.

`Mutex<i32>` has no field you can reach except through `lock()`, which returns
the guard. "Forgot to take the lock" stops being a class of bug and becomes a
type error — the same trick as putting ownership in the type system rather than
in a convention.

## 8

When is the lock released here?

```rust
let mut n = counter.lock().unwrap();
do_slow_io();
*n += 1;
println!("done");
```

- A. Immediately after `lock()` returns
- B. After `*n += 1;`
- *C. At the end of the enclosing block, when `n` is dropped
- D. When `unwrap()` is called

@why
The guard is an ordinary value bound to `n`, so it lives until end of scope and
unlocks in its `Drop`. That means `do_slow_io()` runs with the lock held, and
every other thread is serialised behind your slowest operation.

The idiom that avoids it is to make the guard a temporary:
`*counter.lock().unwrap() += 1;` — the guard is dropped at the end of that
statement. Or bind it inside a `{ }` around only the lines that need it.

## 9

What happens with `let _ = counter.lock().unwrap();`?

- A. The lock is held to the end of the scope
- *B. The lock is taken and released on that line
- C. It does not compile — the guard must be bound
- D. The lock is never taken because the value is unused

@why
`_` is not a binding; it is a pattern that matches and discards. The guard is
therefore a temporary with no owner and is dropped at the end of the statement,
so the mutex is locked and unlocked immediately and every following line runs
unprotected.

`let _guard = ...` — a real name, even one starting with an underscore — holds it
to end of scope. One character apart, and the wrong one silently removes the
protection rather than failing.

## 10

Two threads take `m1` then `m2`; a third takes `m2` then `m1`. What does Rust do?

- A. Rejects it at compile time — this is a data race
- B. Panics at runtime with "deadlock detected"
- *C. Compiles and runs, and may deadlock
- D. Reorders the locks automatically

@why
Deadlock is not a data race and no borrow rule is broken: each thread has genuine
exclusive access to everything it holds. What is wrong is the *order* of two
statements, and lock order is not a property of any type, so nothing in the type
system can see it.

This is the honest boundary of the guarantee. Rust promises no data races and no
use-after-free, not "no concurrency bugs". Deadlock, livelock, `Rc` cycles and
unbounded queues are all still yours, and the discipline is the same as in C: one
global lock order, or one lock at a time.

## 11

Does this compile?

```rust
use std::sync::mpsc;
let (tx, rx) = mpsc::channel();
let msg = String::from("hi");
tx.send(msg).unwrap();
println!("{msg}");
```

- A. Yes — `send` copies the message into the channel
- *B. No — `send` takes the value by value, so `msg` was moved
- C. No — a channel needs at least two threads
- D. Yes, but the receiver would get an empty string

@why
`error[E0382]`. `send` is `fn send(&self, t: T)`, so the message moves into the
channel.

That is the entire safety argument for channels, not an implementation detail:
after the send, the producer holds no reference to the message, so there is
nothing for the consumer to race with and no lock is required. In a C queue of
pointers the same rule exists as a comment; here it is a compile error.

## 12

Why does this program hang?

```rust
let (tx, rx) = mpsc::channel();
for i in 0..3 {
    let tx = tx.clone();
    thread::spawn(move || tx.send(i).unwrap());
}
for got in rx { println!("{got}"); }
```

- A. The threads are never joined
- B. `rx` needs to be wrapped in a `Mutex`
- *C. The original `tx` is still alive, so the receiver never sees the channel close
- D. Three sends cannot fit in an unbounded channel

@why
Iterating a `Receiver` ends when **every** `Sender` has been dropped. Three
clones go into threads and are dropped there, but the original `tx` is still in
scope in `main`, so the receiver keeps waiting for a fourth message that nobody
will send.

`drop(tx)` after the spawn loop fixes it. The symptom is distinctive and worth
recognising: a hung program using no CPU at all, because every thread is parked
rather than spinning.

## 13

What is the cost difference between `Rc::clone` and `Arc::clone`?

- A. `Arc::clone` allocates; `Rc::clone` does not
- B. `Arc::clone` deep-copies the value
- *C. `Arc::clone` uses an atomic increment instead of a plain one
- D. None — they compile to the same instructions

@why
Both copy a pointer and bump a count. The only difference is that `Arc` uses
`fetch_add` with an atomic ordering, which prevents the two cores from losing an
update. It costs a few nanoseconds and, on a contended cache line, a little more.

Neither allocates and neither touches the pointee. This is why Rust ships both
rather than making everything atomic: most reference counting in most programs is
single-threaded, and there is no reason to charge it for a guarantee it does not
use.

## 14

Which of these need `Arc`? Choose all that apply.

- *A. Sharing a `Vec` with a thread spawned by `thread::spawn`
- B. Sharing a `Vec` with threads inside `thread::scope`
- *C. Keeping a `Mutex` alive across several `thread::spawn` calls
- D. Passing a `String` to one thread that is the only user of it

@why
B is the one worth remembering. `thread::scope` joins every thread before it
returns, so the compiler knows the borrows cannot outlive the local — plain `&`
and `&mut` are allowed, no `Arc`, no clone. Before this stabilised in 1.63 people
reached for `Arc` because there was nothing else, and a lot of code still carries
that habit.

D needs nothing at all: one user means ownership, so `move` the `String` in.

## 15

A counter incremented from many threads and never read until the end. What is the
cheapest correct choice?

- A. `Arc<Mutex<u64>>`
- *B. `Arc<AtomicU64>` with `Ordering::Relaxed`
- C. `Arc<RwLock<u64>>`
- D. `Rc<Cell<u64>>`

@why
An atomic add is one instruction with no blocking and no guard. A `Mutex` is
correct but adds a lock, a guard, an unlock and potential contention for an
operation the hardware already does atomically.

`Relaxed` is sufficient precisely because of the "never read until the end"
condition: nothing branches on the intermediate value, so no ordering with
respect to other memory is needed. The moment another thread uses the counter to
decide something, you need `Acquire`/`Release` — and if you have to think about
which, a `Mutex` is usually the better trade.
