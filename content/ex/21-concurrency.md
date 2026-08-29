---
unit: 21-concurrency
---

## 1. The handle is not the answer

@kind fix
@concept JoinHandle

@expect E0308

`thread::spawn` does not give you the thread's result. It gives you a receipt for
it, a `JoinHandle<u32>`, and the thread may not even have started yet. Turn the
receipt into the number.

```starter
use std::thread;

pub fn run() -> u32 {
    let handle = thread::spawn(|| (1..=100).sum::<u32>());
    handle
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sums_on_another_thread() {
        assert_eq!(run(), 5050);
    }
}
```

```solution
use std::thread;

pub fn run() -> u32 {
    let handle = thread::spawn(|| (1..=100).sum::<u32>());
    handle.join().unwrap()
}
```

@hint The function promises a `u32`. Read the type rustc says it actually found.
@hint A `JoinHandle` has one method that waits for the thread and hands back what its closure returned.
@hint `handle.join()` gives a `Result`, whose `Err` case is a panic in that thread. `handle.join().unwrap()`.

@diagnose E0308
`expected u32, found JoinHandle<u32>`. The signature promised a number and the
last expression is the handle itself.

That mismatch is telling you something about the model, not just about a missing
method call. `spawn` returns *immediately*, before the closure has necessarily
run a single instruction, so it cannot possibly return a `u32`, because the
value does not exist yet. What it can return is a way to wait: `join()` blocks the calling
thread until the spawned one finishes, then yields
`Result<u32, Box<dyn Any + Send>>`. The `Err` arm exists because a panic in a
worker thread does not kill the process; it is delivered here.

@after
Nothing forces you to call `join`. Drop the handle and the thread keeps running.
But when `main` returns, the process exits and every remaining thread is killed
mid-instruction. Work you spawned and never joined may simply not happen, and
you get neither an error nor any output to say so.

That is why the shape you will write most often is: collect the handles into a
`Vec`, then loop over them joining each one. `join` is also the only
synchronisation point you get for free: after it returns, everything that thread
wrote is visible to you.

## 2. The closure that borrows a local

@kind fix
@concept move closure

@expect E0373

The closure reads `name`, which lives in `run`'s stack frame. `thread::spawn`
will not accept that, and the error message tells you exactly which word to add.
Work out *why* it is required before you add it.

```starter
use std::thread;

pub fn run() -> String {
    let name = String::from("worker-1");
    let handle = thread::spawn(|| format!("{name} reporting"));
    handle.join().unwrap()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_thread_owns_the_name() {
        assert_eq!(run(), "worker-1 reporting");
    }
}
```

```solution
use std::thread;

pub fn run() -> String {
    let name = String::from("worker-1");
    let handle = thread::spawn(move || format!("{name} reporting"));
    handle.join().unwrap()
}
```

@hint The closure captures `name` by reference. Ask how long that reference is allowed to live, and how long the thread might.
@hint `thread::spawn` requires `F: Send + 'static`. `'static` means the closure may not borrow anything from the calling frame.
@hint One keyword in front of the `||` changes every capture to by-value: `move || ...`.

@diagnose E0373
`closure may outlive the current function, but it borrows name, which is owned by
the current function`.

Read "may" literally. Nothing in the program says the thread finishes before
`run` returns. You happen to call `join` on the next line, but the compiler
checks the *type*, and `spawn`'s signature says the closure must be `'static`,
meaning it borrows nothing from any frame. If the borrow were allowed and `run`
returned first, `name`'s buffer would be freed while the thread was printing it.

`move` fixes it by changing what is captured, not what the body does: the
`String` is moved into the closure, the closure is moved into the thread, and the
value now lives exactly as long as the thread that owns it.

@diagnose E0308
Check what your closure returns. `format!` produces a `String`; a bare
`println!` produces `()`. `join()` then hands you back whatever the closure's
type was, so a mismatch here usually means the closure's last expression grew a
semicolon.

@after
`move` is not a fix you apply to make an error go away. It is a statement about
ownership, and it applies to every capture, `Copy` ones included. This prints
`0`:

```rust
let mut n = 0;
let h = std::thread::spawn(move || { n += 1; });
h.join().unwrap();
println!("{n}");   // 0: the closure incremented its own copy
```

If the caller needs to see a change, `move` is not enough; you need shared state
(`Arc<Mutex<T>>`) or a channel. And if you only want to *borrow* a local,
`thread::scope` exists precisely so you can.

## 3. Rc across a thread boundary

@kind fix
@concept Send

@expect E0277

`Rc` is the cheap shared pointer. Two threads want to read the same vector, so
`Rc` looks right. It is not, and the reason is one instruction wide.

```starter
use std::rc::Rc;
use std::thread;

pub fn run() -> usize {
    let data = Rc::new(vec![1, 2, 3, 4]);
    let mut handles = Vec::new();

    for _ in 0..2 {
        let d = Rc::clone(&data);
        handles.push(thread::spawn(move || d.len()));
    }

    handles.into_iter().map(|h| h.join().unwrap()).sum()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn both_threads_see_four_elements() {
        assert_eq!(run(), 8);
    }
}
```

```solution
use std::sync::Arc;
use std::thread;

pub fn run() -> usize {
    let data = Arc::new(vec![1, 2, 3, 4]);
    let mut handles = Vec::new();

    for _ in 0..2 {
        let d = Arc::clone(&data);
        handles.push(thread::spawn(move || d.len()));
    }

    handles.into_iter().map(|h| h.join().unwrap()).sum()
}
```

@hint The error names a trait the type does not implement. Look up what that trait means.
@hint `Rc`'s reference count is a plain `usize`, incremented with an ordinary add. Picture two threads cloning at the same moment.
@hint There is a drop-in replacement in `std::sync` with an atomic count. Change the import, `Rc::new` to `Arc::new`, and `Rc::clone` to `Arc::clone`.

@diagnose E0277
`Rc<Vec<i32>> cannot be sent between threads safely`, and underneath,
`the trait Send is not implemented for Rc<Vec<i32>>`, `required because it
appears within the type {closure@...}`.

Follow that chain, because it is the whole mechanism. `thread::spawn` requires
`F: Send`. Your closure captured `d`, so the closure is `Send` only if `d` is.
`Rc` is not, and `Send` is an **auto trait**: nobody wrote `impl !Send for Rc`
as an opinion, and the compiler propagates it structurally through every field.

The reason `Rc` opts out: `Rc::clone` compiles to load the count, add one, store
it. Two threads doing that at the same instant both read 1 and both write 2. The
count is now one too low, so the last drop frees a value someone still holds.
That is a use-after-free, with no unsafe block in sight.

`Arc` is the same type with `fetch_add` in place of `+ 1`. One atomic
instruction, a few nanoseconds, and the whole problem is gone. Rust makes you ask
for it rather than paying for it in every single-threaded `Rc` in the program.

@after
The pattern generalises. `Send` means "safe to move to another thread"; `Sync`
means "safe to share by reference", which is exactly `&T: Send`. Both are derived
structurally, so a struct of `Send` fields is `Send` and one non-`Send` field
anywhere inside poisons the whole type.

That is why the error above pointed at a closure you never named. The closure is
a compiler-generated struct whose fields are its captures, and the bound landed
on the field that failed. When a `Send` error names a type you did not write,
read it as "something you captured".

## 4. An Arc is not a licence to mutate

@kind fix
@concept Mutex

@expect E0596

Four threads each want to record their id. `Arc` gets the vector shared, and then
the push is rejected. The fix is not a different pointer. It is a different
thing inside it.

```starter
use std::sync::Arc;
use std::thread;

pub fn run() -> Vec<u32> {
    let log = Arc::new(Vec::new());
    let mut handles = Vec::new();

    for id in 0..4u32 {
        let l = Arc::clone(&log);
        handles.push(thread::spawn(move || {
            l.push(id);
        }));
    }
    for h in handles {
        h.join().unwrap();
    }

    let mut out = log.to_vec();
    out.sort();
    out
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_thread_recorded_itself() {
        assert_eq!(run(), vec![0, 1, 2, 3]);
    }
}
```

```solution
use std::sync::{Arc, Mutex};
use std::thread;

pub fn run() -> Vec<u32> {
    let log = Arc::new(Mutex::new(Vec::new()));
    let mut handles = Vec::new();

    for id in 0..4u32 {
        let l = Arc::clone(&log);
        handles.push(thread::spawn(move || {
            l.lock().unwrap().push(id);
        }));
    }
    for h in handles {
        h.join().unwrap();
    }

    let mut out = log.lock().unwrap().clone();
    out.sort();
    out
}
```

@hint `Arc<T>` only ever hands out `&T`. Ask why it could not safely hand out `&mut T`.
@hint You need a type that turns a shared reference into safe exclusive access at runtime. That is what a lock is for.
@hint `Arc<Mutex<Vec<u32>>>`. Push with `l.lock().unwrap().push(id)`, and read at the end with `log.lock().unwrap().clone()`.

@diagnose E0596
`cannot borrow data in an Arc as mutable`, and then the real line:
`trait DerefMut is required to modify through a dereference, but it is not
implemented for Arc<Vec<u32>>`.

`Arc` deliberately implements `Deref` and not `DerefMut`. It cannot implement
`DerefMut`: the entire point of an `Arc` is that several owners exist at once, so
handing out a `&mut` would hand out two unique references to one value. That is
the `E0499` you already know, laundered through a smart pointer. The compiler closes
that door at the type level.

So `Arc` gives sharing and no mutation. To get mutation back you put something
inside it that can turn `&self` into safe exclusive access, and for threads that
is `Mutex`.

@diagnose E0308
Check the end of the function. With a `Mutex` in the middle,
`log.lock().unwrap()` is a `MutexGuard<Vec<u32>>`, not a `Vec<u32>`. `.clone()`
on the guard clones the `Vec` inside it, which is what the return type wants.

@after
Note how the responsibilities split, because people routinely reach for one when
they need both:

| | answers | if you omit it |
|---|---|---|
| `Arc` | who keeps this alive? | the value dies when the first owner does |
| `Mutex` | who may touch it right now? | no mutation at all, since `Arc` only lends `&T` |

`Arc<Mutex<T>>` is the standard shape for shared mutable state and it is two
layers because it is two questions. In single-threaded code the same pair is
`Rc<RefCell<T>>`, with exactly the same division of labour and no atomics.

## 5. Send takes it, permanently

@kind fix
@concept channel

@expect E0382

The worker sends its message down the channel and then logs what it sent. One of
those two lines has to move.

```starter
use std::sync::mpsc;
use std::thread;

pub fn run() -> String {
    let (tx, rx) = mpsc::channel();

    thread::spawn(move || {
        let msg = String::from("ready");
        tx.send(msg).unwrap();
        println!("worker sent {msg}");
    });

    rx.recv().unwrap()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_message_arrives() {
        assert_eq!(run(), "ready");
    }
}
```

```solution
use std::sync::mpsc;
use std::thread;

pub fn run() -> String {
    let (tx, rx) = mpsc::channel();

    thread::spawn(move || {
        let msg = String::from("ready");
        println!("worker sending {msg}");
        tx.send(msg).unwrap();
    });

    rx.recv().unwrap()
}
```

@hint Look up the signature of `Sender::send`. Does it take the value as `&T`, or as `T`?
@hint Sending is a move, exactly like passing to a function by value. After it, the sender has nothing left to read.
@hint Swap the two lines: log first, then send. Cloning also works and costs an allocation you do not need.

@diagnose E0382
`borrow of moved value: msg`, with `value moved here` under `tx.send(msg)`.

`send` is declared `fn send(&self, t: T) -> Result<(), SendError<T>>`, so the
value goes in **by value**. That is not an implementation detail, it is the
entire safety argument for channels: after the send, the producing thread holds
no reference to the message, so the consuming thread has nothing to race
against. Aliasing never happens, which is why no lock appears anywhere.

Compare that with a queue of pointers in C, where "I sent it, so I must not touch
it any more" is a comment. Here it is `E0382`.

The cheapest fix is to reorder: read the value before you give it away.
`tx.send(msg.clone())` also compiles and buys you an allocation you had no use
for.

@after
Two things about `mpsc` that will cost you an afternoon otherwise.

`mpsc` is multi-producer, single-consumer: `tx` is `Clone`, `rx` is not. Give
each worker its own clone.

And `for m in rx` (or `rx.iter()`) ends only when **every** sender has been
dropped. Clone `tx` into four threads while keeping the original alive in `main`
and the loop waits forever for a fifth message that is never coming. The symptom
is a hung program using no CPU; the fix is `drop(tx)` after the loop that spawns.

## 6. Getting the value back out of the lock

@kind fix
@concept MutexGuard

@expect E0507

Three threads have each appended a character. The data is correct; the last line
is not. The lock is doing its job and refusing to let go of what it owns.

```starter
use std::sync::{Arc, Mutex};
use std::thread;

pub fn run() -> String {
    let log = Arc::new(Mutex::new(String::new()));
    let mut handles = Vec::new();

    for _ in 0..3 {
        let l = Arc::clone(&log);
        handles.push(thread::spawn(move || {
            l.lock().unwrap().push('x');
        }));
    }
    for h in handles {
        h.join().unwrap();
    }

    let out = *log.lock().unwrap();
    out
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn three_threads_three_marks() {
        assert_eq!(run(), "xxx");
    }
}
```

```solution
use std::sync::{Arc, Mutex};
use std::thread;

pub fn run() -> String {
    let log = Arc::new(Mutex::new(String::new()));
    let mut handles = Vec::new();

    for _ in 0..3 {
        let l = Arc::clone(&log);
        handles.push(thread::spawn(move || {
            l.lock().unwrap().push('x');
        }));
    }
    for h in handles {
        h.join().unwrap();
    }

    let out = log.lock().unwrap().clone();
    out
}
```

@hint `*guard` tries to take the `String` out of the mutex and leave a hole behind. Ask what the mutex would contain afterwards.
@hint You want a copy of the contents, not the contents themselves.
@hint `log.lock().unwrap().clone()`. The guard derefs to `String`, so `clone` clones the string inside.

@diagnose E0507
`cannot move out of dereference of MutexGuard<'_, String>`.

The guard is a borrow of what lives inside the mutex, and `*guard` in a `let`
asks to move that value out. If it were allowed, the `Mutex` would be left
holding nothing while every other thread still has an `Arc` to it, so the next
`lock()` would hand out a `String` that had already been moved away. The guard
implements `Deref` and `DerefMut`, never `Into`, so you may read through it and
write through it but never empty it.

`clone()` is the answer here: it goes through the deref, copies the bytes, and
leaves the original in place. Note the borrow of the mutex ends at the end of
that statement, so the lock is released immediately, which is what you want.

@after
Two related exits worth knowing.

`Mutex::into_inner(self)` *does* give you the value by value, and it is safe
precisely because it consumes the `Mutex`. If you own the mutex outright, no
other thread can hold a reference to it, so there is nothing left to break. It
does not work through an `Arc`, for exactly the reason above.

`std::mem::take(&mut *guard)` swaps the contents for `Default::default()` and
hands you what was there. That leaves an empty `String` behind rather than a
hole, so it is sound, and it is the idiom for draining a shared buffer.

## 7. RefCell is not Sync

@kind fix
@concept Sync

@expect E0277

`thread::scope` lets these threads borrow a local, so no `Arc` is needed. The
counter still has to be shared, and `RefCell` is the usual way to get mutation
through a shared reference. Not here.

```starter
use std::cell::RefCell;
use std::thread;

pub fn run() -> i32 {
    let counter = RefCell::new(0);

    thread::scope(|s| {
        for _ in 0..4 {
            s.spawn(|| {
                *counter.borrow_mut() += 1;
            });
        }
    });

    counter.into_inner()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn four_threads_four_increments() {
        assert_eq!(run(), 4);
    }
}
```

```solution
use std::sync::Mutex;
use std::thread;

pub fn run() -> i32 {
    let counter = Mutex::new(0);

    thread::scope(|s| {
        for _ in 0..4 {
            s.spawn(|| {
                *counter.lock().unwrap() += 1;
            });
        }
    });

    counter.into_inner().unwrap()
}
```

@hint Exercise 3 was about `Send`. This message names the other trait. What is the difference between moving a value to a thread and sharing it with one?
@hint `RefCell` tracks its live borrows in an ordinary integer flag, with an ordinary read and write. Two threads can both read "not borrowed" before either writes.
@hint Swap `RefCell` for `Mutex`: `lock().unwrap()` instead of `borrow_mut()`, and `into_inner()` now returns a `Result`.

@diagnose E0277
`RefCell<i32> cannot be shared between threads safely`, with
`the trait Sync is not implemented for RefCell<i32>` and
`required for &RefCell<i32> to implement Send`.

That last line is the definition, spelled out by the compiler: **`T: Sync` means
exactly `&T: Send`**. The closures here capture `counter` by reference, so what
must be sendable is `&RefCell<i32>`, which requires `RefCell<i32>: Sync`.

`RefCell` opts out for the same reason `Rc` opts out of `Send`. Its borrow flag
is a plain `Cell<isize>`, read and written non-atomically. Two threads calling
`borrow_mut()` at the same instant both see "unborrowed", both succeed, and you
have two `&mut` to one `i32`, the exact thing `RefCell` exists to prevent,
defeated because its check is not atomic.

`Mutex<T>` is `RefCell<T>` with a real lock: the same interior mutability, the
same "get `&mut` from `&self`", made thread-safe. `Mutex` is `Sync` whenever `T`
is `Send`.

@diagnose E0599
`into_inner` exists on both types but returns different things.
`RefCell::into_inner` gives you the `T`; `Mutex::into_inner` gives you a
`LockResult<T>`, because the mutex may have been poisoned by a thread that
panicked while holding it. Add `.unwrap()`.

@after
Line up the four and the design is a single table, not four facts to memorise:

| | shared ownership | mutation through `&self` |
|---|---|---|
| single-threaded | `Rc` | `RefCell` |
| threaded | `Arc` | `Mutex` / `RwLock` |

The threaded column is the non-threaded column with atomic instructions where the
plain ones were. That is the whole difference, it costs a few nanoseconds, and
Rust makes you name which one you want rather than charging every program for the
atomic version.

## 8. Two threads, one vector

@kind fix
@concept scoped thread

@expect E0499

One half of the vector is scaled, the other half is offset, and the two jobs
never touch the same element. The compiler cannot see that from `&mut data`
twice, and it is right not to guess.

Say it in a way the compiler can check.

```starter
use std::thread;

pub fn run() -> Vec<i32> {
    let mut data = vec![1, 2, 3, 4];

    let left = &mut data;
    let right = &mut data;

    thread::scope(|s| {
        s.spawn(move || {
            for x in left.iter_mut().take(2) {
                *x *= 10;
            }
        });
        s.spawn(move || {
            for x in right.iter_mut().skip(2) {
                *x += 100;
            }
        });
    });

    data
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn halves_are_processed_independently() {
        assert_eq!(run(), vec![10, 20, 103, 104]);
    }
}
```

```solution
use std::thread;

pub fn run() -> Vec<i32> {
    let mut data = vec![1, 2, 3, 4];

    {
        let (left, right) = data.split_at_mut(2);

        thread::scope(|s| {
            s.spawn(move || {
                for x in left.iter_mut() {
                    *x *= 10;
                }
            });
            s.spawn(move || {
                for x in right.iter_mut() {
                    *x += 100;
                }
            });
        });
    }

    data
}
```

@hint `take(2)` and `skip(2)` are facts about the loop bodies. The borrow checker only reads signatures and types, and both bindings claim the whole vector.
@hint You need two `&mut [i32]` that the *type system* knows are disjoint, produced in one operation rather than two independent borrows.
@hint Slices have `split_at_mut(mid)`, which returns `(&mut [T], &mut [T])` from a single borrow. Use it before the scope and move each half into a closure.

@diagnose E0499
`cannot borrow data as mutable more than once at a time`.

Nothing about threads is involved yet. This is the same error you would get from
those two lines in a single-threaded function, which is the point of the unit. A data race needs aliasing plus mutation, and `&mut` already forbids
aliasing, so the thread version and the single-threaded version are one rule.

The compiler is not failing to notice `take(2)` and `skip(2)`. It never looks
inside the closures at all: borrow checking works from the borrow expressions and
the signatures, and `&mut data` claims the whole vector regardless of which
elements the body eventually touches. Disjointness that lives only in your head
is not disjointness it can rely on.

`split_at_mut` is how you say it in the type system. It takes one `&mut [T]` and
returns two, each covering a different range, from a single borrow that the
compiler can account for.

@diagnose E0505
`cannot move out of data because it is borrowed`. You produced the two halves but
the borrow is still live when `data` is returned. A `&mut` borrow lasts until its
last use, so put the split and the scope inside a block. The borrows end at the
closing brace and `data` is free to move afterwards.

@diagnose E0521
`borrowed data escapes outside of closure`. This is what you get from
`thread::spawn` rather than `thread::scope`: `spawn` requires `'static`, so
nothing borrowed from `run`'s frame may go in. `scope` guarantees every thread is
joined before it returns, which is exactly the proof that makes borrowing locals
sound.

@after
`split_at_mut` is `unsafe` inside, and that is the honest and interesting part.
It exists because the compiler genuinely cannot verify disjointness derived from
runtime indices, so somebody had to assert it once, carefully, in the standard
library, behind a safe signature. That is the whole purpose of `unsafe`: not
escaping the rules, but extending the set of things that can be proved safe to
callers.

Before 1.63 this exercise needed `Arc<Mutex<Vec<i32>>>` and would have serialised
the two threads through a lock they did not need. `thread::scope` removed a large
class of pointless `Arc`s from real code. Reach for it first whenever the shared
data is a local that outlives the threads.
