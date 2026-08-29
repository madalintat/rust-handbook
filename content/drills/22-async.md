---
unit: 22-async
---

## 1

What has happened after this line runs?

```rust
let fut = fetch("https://example.com");   // fetch is an `async fn`
```

- A. The request has been sent and is in flight
- *B. Nothing — a state machine value was built and no body code ran
- C. The request has been sent and completed
- D. It does not compile without `.await`

@why
`async fn f() -> T` is sugar for `fn f() -> impl Future<Output = T>`. Calling it
constructs the state machine in its initial state and returns it. Not one
instruction of the body has run.

A is the JavaScript answer and it is right there — `const p = fetch(url)` really
has sent the request, because a promise is a handle to work already in flight.
The Rust version has sent nothing, which is why dropping the future is a
perfectly good way to cancel the request.

## 2

Which of these are true of a Rust `Future` but not a JavaScript `Promise`?
Choose all that apply.

- *A. It does nothing until something polls it
- *B. Dropping it cancels the work
- C. It can produce an error
- *D. Awaiting it consumes it, so it cannot be awaited twice
- E. Awaiting it lets other tasks run in the meantime

@why
A, B and D are all consequences of one design decision: a future is an ordinary
owned value rather than a running job.

D catches people hardest. `.await` takes the future by `self`, so a second
`f.await` is `E0382` — use of moved value. In JavaScript several places can await
one promise and all get the same result; in Rust you either do the work twice or
clone the result, and the language makes you say which.

E is true of both and is the thing people usually think `await` *is*. It is not
what distinguishes them: a JS `await` also yields to the event loop.

## 3

Does this compile?

```rust
fn summary(id: u32) -> String {
    let name = fetch(id).await;
    format!("got {name}")
}
```

- A. Yes — `fetch` is async, so the await is fine
- *B. No — `E0728`, await is only allowed inside an async function or block
- C. No — `summary` must return a `Future`
- D. Yes, but it blocks the thread

@why
`.await` compiles into "poll; if not ready, save my locals and return `Pending`
to my caller". A plain `fn` has one entry and one exit and no saved state, so
there is nowhere to suspend to.

C describes the *consequence* of the fix rather than the error. Adding `async` to
`summary` does change its return type to `impl Future<Output = String>` — but you
write `async fn summary(id: u32) -> String`, not the future type by hand.

## 4

`a.await; b.await;` — what does this do?

- A. Starts both and waits for both
- *B. Drives `a` to completion, then constructs and drives `b`
- C. Starts both in parallel on the thread pool
- D. Deadlocks unless a runtime is present

@why
The first `.await` does not "kick off" `a` and continue; it runs `a` to
completion. The expression `b` has not even been evaluated at that point.

This is the most common real mistake in async Rust and it produces no warning of
any kind. The symptom is a program that is correct and exactly as slow as the
blocking version it replaced. `join!(a, b)` polls both from one task; a `spawn`
each puts them on the pool.

## 5

`tokio::join!(a, b)` gives you concurrency. Does it give you parallelism?

- A. Yes — that is what a runtime is for
- *B. No — it polls both futures from one task on one thread
- C. Only if the runtime is multi-threaded
- D. Only if `a` and `b` are `Send`

@why
`join!` expands to a single future that polls each of its arguments in turn. One
task, one thread, no `Send` bound needed — which is exactly why it can hold
non-`Send` data across awaits when a spawned task could not.

For actual parallelism you need `tokio::spawn` per future, and then `Send +
'static` applies exactly as it does to `thread::spawn`. C is close: a
multi-threaded runtime lets *different tasks* run on different cores, but it
cannot split one `join!` across two.

## 6

A future returns `Poll::Pending` and does not register the waker anywhere. What
happens?

- A. The executor polls it again immediately
- B. The executor polls it on a timer
- *C. The task is parked and never polled again
- D. The program panics

@why
An executor parks a task on `Pending` and only re-queues it when `wake()` is
called. No waker registered means no wake, so the task stops for good — silently.

A is the tempting one because it describes what a naive loop would do, and
`cx.waker().wake_by_ref()` before returning `Pending` really does produce that
behaviour. That is a busy loop dressed up. A real future hands the waker to an
epoll registration or a timer, then costs nothing at all until the OS speaks.

## 7

Why does `Future::poll` take `self: Pin<&mut Self>` rather than `&mut self`?

- A. To stop two threads polling the same future
- *B. Because a generated future can hold a reference into its own fields, so it must not move
- C. Because futures are always heap-allocated
- D. To make the trait object-safe

@why
`let row = load().await; render(&row).await;` produces a state machine holding
both `row` and a future built from `&row` — a self-referential value. Move it and
the internal pointer still points at the old address, in safe code, which is not
allowed to be possible.

`Pin<&mut T>` is a type-level promise that the value will not move again, and
`poll` demands it so no future can be polled before that promise exists. Types
that genuinely do not care implement `Unpin`, and for them `Pin` is transparent.

## 8

Which of these make a future non-`Send`? Choose all that apply.

- *A. Holding a `std::sync::MutexGuard` across an `.await`
- *B. Holding an `Rc<T>` across an `.await`
- C. Holding an `Rc<T>` and dropping it before the `.await`
- D. Awaiting a future whose output is non-`Send`, and returning it straight away

@why
An `async fn` compiles into a struct whose fields are the values live *across*
each suspension point. Anything live across an await becomes a field, and the
future is `Send` only if every field is.

C is the fix, not a failure: a value dropped before the await is never a field of
any state, so it does not constrain the future at all. That is why "take the
lock, touch the data, drop the guard, then await" works. D is a distractor — the
output is returned by value, not held across anything.

## 9

Does this compile?

```rust
async fn countdown(n: u32) -> u32 {
    if n == 0 { return 0; }
    countdown(n - 1).await + 1
}
```

- A. Yes — recursion is ordinary in Rust
- *B. No — `E0733`, recursion in an async fn requires boxing
- C. No — `async fn` cannot return a value from an early `return`
- D. Yes, but it overflows the stack at runtime

@why
The value live across the `.await` is the future returned by `countdown` — so the
state machine contains itself, and has no computable size. It is the same
infinite type as a recursive `struct` without a `Box`, arrived at from a
different direction.

`Box::pin(countdown(n - 1)).await` fixes it by putting the inner future on the
heap so the outer holds a pointer of known size. `Pin` rather than plain `Box`
because `poll` needs a pinned receiver.

## 10

What determines the size of a future?

- A. The size of the stack frame of the `async fn`
- *B. The largest of its states — the variables live across each suspension point
- C. A fixed 4 KB, like a green thread
- D. It is always boxed, so one pointer

@why
The compiler lays the states out as an enum and the future is as big as the
largest variant. Variables that never cross an `.await` are not fields at all;
they live in `poll`'s own stack frame while it runs.

That is the whole memory argument for async. A thread must commit a stack that
might reach any depth, so it costs kilobytes to megabytes; a future holds exactly
the state it needs at its widest point, which is often tens of bytes.

## 11

Why does Rust ship no executor in the standard library?

- A. Nobody has written a good enough one
- B. Because `async` was stabilised before executors existed
- *C. Because an executor needs a thread pool, an I/O reactor and a timer, none of which exist on every target
- D. To avoid competing with tokio commercially

@why
`std` has `Future`, `Poll`, `Context`, `Waker` and the syntax, and stops there.
An executor is inherently platform-specific — epoll on Linux, kqueue on BSD, IOCP
on Windows, and none of the above on a microcontroller or inside a WASM sandbox,
all of which run async Rust today.

The cost is real and you pay it in dependency choice and libraries written
against a specific runtime. The benefit is that the same `async fn` compiles for
a server and a Cortex-M0.

## 12

`tokio::spawn(async { data.iter().sum::<i32>() })` where `data` is a local `Vec`.

- A. Compiles — the async block ends before `data` is dropped
- *B. Fails — `spawn` requires `'static`, and the block borrows `data`
- C. Fails — `Vec` is not `Send`
- D. Compiles, but the sum may be wrong

@why
`error[E0373]: async block may outlive the current function`. An async block
captures like a closure: by reference unless you write `async move`.

A is the appealing wrong answer, and it is a true statement about this particular
program. It is not a fact the *type* carries, and `tokio::spawn` demands
`Send + 'static` because a spawned task is handed to the runtime and may outlive
whatever spawned it. `async move` moves `data` in and the problem is gone.

## 13

Which of these compiles?

```rust
// 1
let body = fetch(url)?.await;
// 2
let body = fetch(url).await?;
```

- A. Only 1
- *B. Only 2
- C. Both
- D. Neither

@why
The order is fixed: `.await` drives the future to completion and yields the
`Result`, then `?` unwraps it. Version 1 applies `?` to the future itself, which
asks for `Try` on a type that does not implement it — `E0277` with a different
missing trait.

Reading it aloud settles it: "await the request, then propagate its error". You
cannot propagate an error from something that has not run yet.

## 14

Ten thousand mostly-idle connections. Why is one future each cheaper than one
thread each?

- A. Futures run on the GPU
- B. Threads are slower to execute the same code
- *C. A thread commits a whole stack and a kernel scheduler slot; a parked future holds only its live state
- D. Futures avoid system calls entirely

@why
The executing code is the same speed either way — this is entirely about what an
*idle* one costs. A parked thread holds 8 KB to 2 MB of stack it may never use,
plus a kernel object, and switching to it is a context switch. A parked future is
a struct the size of its widest state, and resuming it is a function call.

D is nearly right in spirit and wrong in fact: async does far *fewer* syscalls,
via one epoll for thousands of sockets, but it certainly makes them.

## 15

You have a CPU-bound function that takes 200 ms. Where should it go in a tokio
program?

- A. Straight into an `async fn` — the runtime will schedule around it
- B. Inside a `join!` with the other work
- *C. On a blocking thread pool, via `spawn_blocking` or a channel to a worker thread
- D. Inside a loop with `yield_now().await` every iteration

@why
A future only gives up control at an `.await`. A 200 ms computation with no await
inside it holds its executor thread for 200 ms, and every other task assigned to
that thread waits — including timers and I/O wakeups. B makes it worse, since
`join!` runs everything on that one task.

D genuinely works and is what you do when you cannot move the work, but it is
fiddly and still competes for the I/O threads. `spawn_blocking` exists precisely
so the CPU work runs somewhere that blocking is expected.
