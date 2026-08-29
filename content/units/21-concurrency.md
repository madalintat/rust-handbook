---
num: 21
slug: 21-concurrency
title: Concurrency
accent: rust
concepts: thread, spawn, JoinHandle, move closure, Send, Sync, channel, mpsc, Mutex, MutexGuard, Arc, deadlock, RwLock, atomic, scoped thread, data race
needs: 06-borrowing, 16-closures, 18-smart-ptr
blurb: The borrow rules already forbid the exact condition a data race needs. Threads add no new rule. They add the types that carry the old one across a thread boundary.
---

%% "Fearless concurrency" reads like marketing until you notice what it is actually claiming: that nothing in this unit is new. A data race needs two threads touching one location, at least one writing, with no synchronisation. That is aliasing plus mutation, which unit 06 already made a compile error. The borrow checker was preventing data races before anyone said the word "thread".

What threads do need is a way to carry that guarantee across a stack boundary, and that is two marker traits and a handful of types.

## The old rule, unchanged

### A data race is a borrow error

Line them up.

| a data race requires | the borrow rule says |
|---|---|
| two references to one location | many `&T`, or one `&mut T` |
| at least one is a write | writing needs `&mut T` |
| no synchronisation between them | `&mut T` excludes every other reference |

Two `&mut` to one place is `E0499`; a `&mut` alongside a `&` is `E0502`. Those
are not thread errors. You meet them on day two, single-threaded, and the
condition is identical.

```rust,bad
let mut counter = 0;
let a = &mut counter;
let b = &mut counter;   // E0499
*a += 1;
*b += 1;
```

Now put `a` and `b` on two cores. The rule does not change; only the
consequence does. `counter += 1` is a load, an add and a store, and two
interleavings of six instructions lose an increment.

:::note
Rust added **no** concurrency rule. It added `Send` and `Sync`, which describe
which types may cross a thread boundary, and then applied the borrow rules it
already had. That is the entire safety story.
:::

:::compare
**Java, Go, C#, Python** all let two threads share a mutable object by default
and hope you locked it. Go's own race detector is a *runtime* tool you must
remember to run, on an input that happens to hit the race.

**C++** gives you `std::mutex` and `int counter` as two unrelated variables. The
compiler never checks that you touched the first before the second.
:::

## Threads

### spawn and join

```rust
use std::thread;

let handle = thread::spawn(|| {
    (1..=100).sum::<u32>()
});

let total = handle.join().unwrap();   // waits, gives back the return value
assert_eq!(total, 5050);
```

`thread::spawn` starts a real OS thread and returns a **JoinHandle**. `join`
blocks until it finishes and yields `Result<T, Box<dyn Any>>`, where `Err`
means that thread panicked. A panic in a worker therefore leaves the process
standing.

Drop the handle without joining and the thread runs on. But `main` returning
kills the process and every thread in it, so detached work silently does not
happen.

### Why `move` is nearly always required

```rust,bad
let name = String::from("worker-1");
thread::spawn(|| {
    println!("{name}");     // E0373: closure may outlive the current function
});
```

The closure borrows `name`. Nothing says the thread ends before the current
function's frame does, and the compiler will not assume it, so the borrow could
outlive its owner. That is a dangling reference, caught at compile time.

```rust,good
let name = String::from("worker-1");
thread::spawn(move || {
    println!("{name}");     // the String moved in; the thread owns it
});
```

`move` changes what the closure captures, not what it does: every capture goes
by value. The `String` is owned by the closure, the closure by the thread, so it
lives exactly as long as the thread.

:::gotcha
`move` moves **`Copy`** types too, by copying them. So this compiles and prints
`0`, because the closure got its own `i32`:

```rust
let mut n = 0;
let h = thread::spawn(move || { n += 1; });
h.join().unwrap();
println!("{n}");    // 0
```

The mutation happened to the copy. If you need the caller to see the change, you
need shared state, which is the second half of this unit.
:::

## Send and Sync

The compiler needs one fact about every type: is it safe to hand to another
thread? Two traits answer it.

:::note
**`Send`**: safe to *move* to another thread.
**`Sync`**: safe to *share by reference* between threads. Exactly equivalent to
`&T: Send`.
:::

Both are **auto traits**: nobody writes the impls. The compiler derives them
structurally: a struct is `Send` if every field is, `Sync` if every field is.
Almost everything qualifies, so you never think about it until a type does not,
and the error names the field that broke it.

`thread::spawn` requires `F: Send + 'static`. `F` is your closure, so the check
lands on whatever you captured.

### The two famous non-implementors

| type | missing | because |
|---|---|---|
| `Rc<T>` | `Send`, `Sync` | its reference count is a plain integer |
| `RefCell<T>` | `Sync` | its borrow flag is a plain integer |
| `MutexGuard<T>` | `Send` | most platforms require the locking thread to unlock |
| raw pointers | both | the compiler knows nothing about what they point at |

`Rc` is the canonical case. Cloning one does `count += 1`: a load, an add and a store.
Two threads cloning at once both read 1 and both write 2, so a count of 3 becomes
2, and the value is freed while someone still holds it. Use-after-free, so the
compiler refuses:

```rust,bad
use std::rc::Rc;
let data = Rc::new(vec![1, 2, 3]);
let d = Rc::clone(&data);
thread::spawn(move || {
    println!("{}", d.len());
});   // E0277: `Rc<Vec<i32>>` cannot be sent between threads safely
```

`Arc` is the identical type with `fetch_add` instead of `+= 1`. That one atomic
instruction is the whole difference, and it is why `Arc` is `Send + Sync`. You
pay for it only when you need it.

`RefCell` is the same story one level up: two threads can both read its flag as
"unborrowed" and both take a `&mut`. `Mutex` is `RefCell` with a real lock.

## Channels

Ownership makes message passing unusually clean: sending a value *moves* it.

```rust
use std::sync::mpsc;

let (tx, rx) = mpsc::channel();

for id in 0..3 {
    let tx = tx.clone();                 // one sender per thread
    thread::spawn(move || {
        tx.send(format!("done {id}")).unwrap();
    });
}
drop(tx);                                // drop the original, or rx never ends

let mut msgs: Vec<String> = rx.iter().collect();
msgs.sort();
```

`mpsc` is multi-producer, single-consumer: `tx` clones, `rx` does not. `send`
takes the value **by value**, so afterwards you cannot touch it. The receiver
ends up holding the only path to it, and ownership has done the work a lock
would.

:::gotcha
`rx.iter()` (and `for m in rx`) ends when **every** sender has been dropped. Keep
the original `tx` alive after cloning it into the threads and the loop blocks
forever. `drop(tx)`, or shadowing it inside a scope, is the fix. The symptom is
a hung program burning no CPU at all.
:::

`recv()` blocks and returns `Err` once all senders are gone. `try_recv()` never
blocks. For a bounded channel that applies back-pressure, use
`mpsc::sync_channel(n)`.

## Mutex: the data is inside the lock

This is the design decision that matters most, and it is one line of type.

```c
pthread_mutex_t lock;      // the lock
int counter;               // the data
// the relationship between them exists only in your head
```

```rust
Mutex<i32>                 // one thing. There is no unlocked counter.
```

You cannot forget to lock: there is no path to the `i32` that does not go
through `lock()`. The lock is not a convention documented next to the data. It
is the data's container.

```rust
use std::sync::Mutex;

let counter = Mutex::new(0);
{
    let mut n = counter.lock().unwrap();   // MutexGuard<i32>
    *n += 1;
}                                          // guard drops here, unlocked
assert_eq!(*counter.lock().unwrap(), 1);
```

`lock()` returns a **MutexGuard**, which derefs to the data and unlocks in its
`Drop`. There is no `unlock()` to forget, and unwinding through a panic still
unlocks. (`unwrap` is there because a thread panicking while holding the lock causes
**lock poisoning**: every later `lock()` returns `Err`, warning that the data may
have been left half-updated.)

:::gotcha
The guard is a value, so scope rules apply:

```rust,bad
let _ = counter.lock().unwrap();   // locked and unlocked on this line
```

`let _ =` is not a binding, so the guard drops immediately. Every subsequent line
runs unlocked. Same underscore, same bug as unit 05, with a worse blast radius.
:::

### Arc<Mutex<T>>: the standard shape

`Mutex` gives safe mutation. It does not give shared *ownership*: several
threads still need to keep the mutex alive. That is `Arc`'s job.

```rust
use std::sync::{Arc, Mutex};

let counter = Arc::new(Mutex::new(0));
let mut handles = vec![];

for _ in 0..8 {
    let c = Arc::clone(&counter);
    handles.push(thread::spawn(move || {
        *c.lock().unwrap() += 1;
    }));
}
for h in handles { h.join().unwrap(); }
assert_eq!(*counter.lock().unwrap(), 8);
```

:::memory Arc<Mutex<i32>> shared by two threads
     THREAD A stack            HEAP (one allocation)         THREAD B stack
   ┌──────────────┐        ┌───────────────────────┐       ┌──────────────┐
   │ c   ●────────┼───────▶│ strong count  2  ◀────┼───────┼──●   c        │
   └──────────────┘        │ weak count    1       │       └──────────────┘
                           ├───────────────────────┤
                           │ Mutex: state  0/1     │   ◀── lock() flips this
                           │        data   42      │   ◀── reachable only
                           └───────────────────────┘       through the guard
:::

Two layers, two jobs, and they are not interchangeable:

| | answers |
|---|---|
| `Arc` | who keeps this alive? (many owners, atomic count) |
| `Mutex` | who may touch it right now? (one at a time) |

Swap `Rc` for `Arc` and `spawn` gives you `E0277`, because `Rc` is not `Send`.
Drop the `Mutex` and keep the `Arc` and you lose all mutation, because `Arc<T>`
only hands out `&T`.

:::gotcha
`*c.lock().unwrap() += 1;` unlocks at the end of the statement. This does not:

```rust,bad
let mut n = c.lock().unwrap();
expensive_io();                 // still holding the lock
*n += 1;
```

The guard lives to the end of the block. Hold it across an I/O call and you have
serialised every thread through your slowest operation. Take the lock, touch the
data, drop the guard.
:::

## What is still your problem

Rust prevents data races. It does not prevent every concurrency bug, and the
line is worth knowing exactly.

### Deadlock still compiles

```rust,bad
// thread 1                    // thread 2
let a = m1.lock().unwrap();    let b = m2.lock().unwrap();
let b = m2.lock().unwrap();    let a = m1.lock().unwrap();
```

Both block forever. That is **deadlock**, and no borrow rule is broken: each thread has exclusive
access to what it holds. **Lock order is not a type-system property.** It is a
fact about the sequence of statements you happened to write.

The discipline is unchanged from C: one global lock order, or one lock at a time.
Livelock, `Rc` cycles and unbounded queues are still yours too. The claim is
narrow and absolute: no data races, no use-after-free. It was never "no bugs".

### RwLock

Many readers or one writer, which is `&T`/`&mut T` enforced at runtime:

```rust
use std::sync::RwLock;
let cfg = RwLock::new(String::from("v1"));
let r1 = cfg.read().unwrap();
let r2 = cfg.read().unwrap();       // fine, both readers
```

Worth it only when reads massively outnumber writes: the bookkeeping costs more
than a `Mutex`'s, so a contended `RwLock` can lose to the simpler lock.

### Atomics

For a single integer or flag, skip the lock:

```rust
use std::sync::atomic::{AtomicUsize, Ordering};
static HITS: AtomicUsize = AtomicUsize::new(0);
HITS.fetch_add(1, Ordering::Relaxed);
```

One instruction that never blocks, and no guard to drop. `Ordering` says how much the compiler
and CPU may reorder around it: `SeqCst` is the safe default, `Relaxed` is fine
for a counter nobody branches on.

### Scoped threads

`thread::spawn` needs `'static` because it cannot know when the thread ends.
A **scoped thread** is one the compiler *can* bound: `thread::scope` (stable
since 1.63) joins everything before returning, so borrows of locals are allowed:

```rust
let mut data = vec![1, 2, 3];
let total: i32 = thread::scope(|s| {
    let h = s.spawn(|| data.iter().sum::<i32>());   // borrowed, not moved
    h.join().unwrap()
});
```

Nothing is moved, cloned or wrapped in an `Arc`. Most "share a slice across
four threads" problems are really a scoped thread; before 1.63 people reached
for `Arc` because the language offered nothing better.

### rayon

For data parallelism, `rayon` turns `iter()` into `par_iter()` and does the
rest. Its bounds are `Send + Sync`, so the checks are the ones you already met.

:::note
**The habit.** Reach in this order: no sharing (channels, or move owned data
in), then `thread::scope` for borrowed locals, then `Arc<Mutex<T>>`, then atomics
when profiling says the lock is the problem. Lock-free anything is last, and
almost never the answer.
:::
