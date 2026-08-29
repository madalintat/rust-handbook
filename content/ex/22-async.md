---
unit: 22-async
---

## 1. await needs somewhere to suspend to

@kind fix
@concept await

@expect E0728

`fetch` is async. `summary` calls it and awaits the result, and the compiler
refuses at the `.await`. The problem is not the call — it is where you are
standing when you make it.

```starter
pub async fn fetch(id: u32) -> String {
    format!("user {id}")
}

pub fn summary(id: u32) -> String {
    let name = fetch(id).await;
    format!("got {name}")
}

pub fn run() -> String {
    futures::executor::block_on(summary(7))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn awaits_the_fetch() {
        assert_eq!(run(), "got user 7");
    }
}
```

```solution
pub async fn fetch(id: u32) -> String {
    format!("user {id}")
}

pub async fn summary(id: u32) -> String {
    let name = fetch(id).await;
    format!("got {name}")
}

pub fn run() -> String {
    futures::executor::block_on(summary(7))
}
```

@hint `.await` means "give control back to whoever is driving me". Ask who that is inside an ordinary `fn`.
@hint A plain function has no way to pause and be resumed. Only an `async fn` or an `async` block compiles into something that can.
@hint Add `async` to `summary`. `run` already knows what to do with the future that results.

@diagnose E0728
`await is only allowed inside async functions and blocks`.

`.await` is not a call that blocks. It compiles into "poll this; if it is not
ready, save my local state and return `Pending` to my caller". An ordinary `fn`
has no saved state to return to and no way to be resumed at that point — it has
one entry and one exit. An `async fn` is different because the compiler rewrites
it into a state machine with one variant per await, so there is somewhere to
suspend *to*.

Marking `summary` async also changes its type: it now returns
`impl Future<Output = String>` rather than a `String`. That is why `run` works
unchanged — `block_on` wanted a future all along.

@after
`block_on` is the seam between the two worlds, and every async program has one
somewhere. `#[tokio::main]` is exactly this: a macro that turns your
`async fn main` into a normal `fn main` which builds a runtime and calls
`block_on` on the body.

Async is not turtles all the way down. There is always a synchronous entry point
at the bottom, and the interesting consequence is the direction of the
constraint: async code can call sync code freely, sync code needs an executor to
call async code. That asymmetry is why `async` tends to spread upwards through a
codebase.

## 2. Nothing happened

@kind fix
@concept future

@expect E0308

`load` calls `fetch`, binds the result, and returns it. The types disagree, and
the mismatch is the single most important sentence about async Rust.

```starter
pub async fn fetch(id: u32) -> String {
    format!("user {id}")
}

pub async fn load(id: u32) -> String {
    let name: String = fetch(id);
    name
}

pub fn run() -> String {
    futures::executor::block_on(load(7))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn actually_runs_the_future() {
        assert_eq!(run(), "user 7");
    }
}
```

```solution
pub async fn fetch(id: u32) -> String {
    format!("user {id}")
}

pub async fn load(id: u32) -> String {
    let name: String = fetch(id).await;
    name
}

pub fn run() -> String {
    futures::executor::block_on(load(7))
}
```

@hint Read the type rustc says it found. It is not a `String`, and it is not an error type either.
@hint Calling an `async fn` builds a value and returns it. The body has not run. Something has to drive it.
@hint `.await` on the call.

@diagnose E0308
`expected String, found future` — or in full, `expected struct String, found
opaque type ... note: calling an async function returns a future`.

This is the sentence to keep. **`async fn f() -> T` is sugar for
`fn f() -> impl Future<Output = T>`.** Calling it allocates nothing, contacts
nothing, and executes not one instruction of the body. It constructs a state
machine, in its initial state, and hands it to you.

If you come from JavaScript this is the inversion to internalise. `const p =
fetch(url)` has already sent the request; a promise is a handle to work already
in flight, and `await` merely subscribes to a result that is coming regardless.
In Rust, `let f = fetch(url)` has sent nothing at all. Drop `f` and the request
never happens — which is also why dropping a future is how you cancel it.

@after
The inertness is not an inconvenience the language works around; it is what makes
the rest of async Rust composable. Because a future is a plain value that has not
started, you can wrap it in a timeout, race it against another with `select!`,
put it in a `Vec`, or hand it to a different executor — all decisions taken
before anything runs. A JavaScript promise cannot be given a timeout in this
sense, because it is already going.

The one cost is the failure mode you just hit: forget the `.await` and nothing
happens. `Future` is `#[must_use]`, so if you had dropped the value instead of
returning it you would have got a warning rather than an error.

## 3. Only futures can be awaited

@kind fix
@concept async

@expect E0277

`lookup` reads from a database in the real version of this program, so `profile`
awaits it. Right now `lookup` is a plain function and the compiler says the
`.await` makes no sense. Make the `.await` correct rather than deleting it.

```starter
pub fn lookup(id: u32) -> String {
    format!("user {id}")
}

pub async fn profile(id: u32) -> String {
    let name = lookup(id).await;
    format!("profile: {name}")
}

pub fn run() -> String {
    futures::executor::block_on(profile(7))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn awaits_a_real_future() {
        assert_eq!(run(), "profile: user 7");
    }
}
```

```solution
pub async fn lookup(id: u32) -> String {
    format!("user {id}")
}

pub async fn profile(id: u32) -> String {
    let name = lookup(id).await;
    format!("profile: {name}")
}

pub fn run() -> String {
    futures::executor::block_on(profile(7))
}
```

@hint `.await` is not a general "unwrap this" operator. It is a method on exactly one trait.
@hint The brief says to keep the `.await`, so `lookup` has to start returning something awaitable.
@hint One keyword in front of `fn lookup`.

@diagnose E0277
`String is not a future`, and beneath it `the trait Future is not implemented for
String`, `required by the bound in await`.

`.await` desugars to a loop that calls `Future::poll`, so it works on futures and
nothing else. A `String` has no `poll`. Note this is a plain trait-bound failure
— the same `E0277` you get from any missing impl — because `.await` has no magic
in the type system; it is sugar over one ordinary trait.

Two fixes exist and they say different things. Deleting the `.await` says *this
work is synchronous*. Adding `async` to `lookup` says *this work will suspend*,
and it is what you want for anything that will eventually touch a socket, because
changing it later forces every caller to change with it.

@diagnose E0308
If you removed the `.await` but left `let name = lookup(id);` with a `String`
annotation somewhere, check the types line up again. Removing an `.await` from a
call that does return a future gives you the future itself, not its output.

@after
Awaiting the *result* of an async function that returns `Result` is the shape
worth practising, because the two operators stack in one order only:

```rust
let body = fetch(url).await?;
```

`.await` first — drive the future to completion — then `?` on the `Result` it
produced. Writing `fetch(url)?.await` asks for `?` on a future, which is
`E0277` again with a different missing trait.

## 4. A future is a value, and awaiting consumes it

@kind fix
@concept future

@expect E0382

The intent is to fetch the same record twice and compare. The second `.await`
is rejected, and the error code is one you met in unit 05.

```starter
pub async fn fetch(id: u32) -> String {
    format!("user {id}")
}

pub async fn twice(id: u32) -> String {
    let f = fetch(id);
    let a = f.await;
    let b = f.await;
    format!("{a} / {b}")
}

pub fn run() -> String {
    futures::executor::block_on(twice(7))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fetches_twice() {
        assert_eq!(run(), "user 7 / user 7");
    }
}
```

```solution
pub async fn fetch(id: u32) -> String {
    format!("user {id}")
}

pub async fn twice(id: u32) -> String {
    let a = fetch(id).await;
    let b = fetch(id).await;
    format!("{a} / {b}")
}

pub fn run() -> String {
    futures::executor::block_on(twice(7))
}
```

@hint The error is `E0382`, so treat `f` as what it is: an ordinary non-`Copy` value.
@hint `.await` takes the future by value. After it, there is no future left — it has been driven to completion and consumed.
@hint You need two futures. Call `fetch` twice.

@diagnose E0382
`use of moved value: f`, with `value moved here` under the first `f.await`.

`.await` is `IntoFuture::into_future` followed by polling to completion, and
`into_future` takes `self`. A future is a state machine that advances; once it
has reached its `Done` state there is nothing to poll again, so the language
takes ownership rather than leaving you holding a finished object whose behaviour
would be undefined.

This is worth sitting with, because it is the clearest sign that a future is a
plain Rust value with plain Rust ownership. It is not a channel, not a
subscription, not a promise you can await from several places. It is a struct,
you own it, and awaiting it eats it.

@after
The corollary is that "await the same work twice" is not a thing you do in Rust —
you either do the work twice, or you do it once and clone the result. Where
JavaScript lets several places `await` one promise and all receive the same
value, Rust makes you name which of those two you meant.

If you genuinely need many consumers of one result, the tools are
`futures::future::Shared` (which clones the output) or an `Arc` around the value
once you have it. Both are explicit about the copy, and both cost something you
can see.

## 5. Sequential is not concurrent

@kind predict
@concept join

Two tasks each write their name, yield once, then write it again. `run` drives
them with `futures::join!`.

Predict the exact order the four entries land in, and write it into `expected`.
This is the single most valuable thing to be right about in async Rust, and the
wrong answer is the one most people give.

```starter
use std::sync::{Arc, Mutex};

pub type Log = Arc<Mutex<Vec<&'static str>>>;

pub async fn step(log: Log, first: &'static str, second: &'static str) {
    log.lock().unwrap().push(first);
    tokio::task::yield_now().await;
    log.lock().unwrap().push(second);
}

pub fn run() -> Vec<&'static str> {
    let log: Log = Arc::new(Mutex::new(Vec::new()));
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        futures::join!(
            step(log.clone(), "a start", "a end"),
            step(log.clone(), "b start", "b end"),
        );
    });
    let out = log.lock().unwrap().clone();
    out
}

pub fn expected() -> Vec<&'static str> {
    vec!["a start", "a end", "b start", "b end"]
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn predicted_the_interleaving() {
        assert_eq!(run(), expected());
    }
}
```

```solution
use std::sync::{Arc, Mutex};

pub type Log = Arc<Mutex<Vec<&'static str>>>;

pub async fn step(log: Log, first: &'static str, second: &'static str) {
    log.lock().unwrap().push(first);
    tokio::task::yield_now().await;
    log.lock().unwrap().push(second);
}

pub fn run() -> Vec<&'static str> {
    let log: Log = Arc::new(Mutex::new(Vec::new()));
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        futures::join!(
            step(log.clone(), "a start", "a end"),
            step(log.clone(), "b start", "b end"),
        );
    });
    let out = log.lock().unwrap().clone();
    out
}

pub fn expected() -> Vec<&'static str> {
    vec!["a start", "b start", "a end", "b end"]
}
```

@hint `join!` does not spawn anything. It polls the futures it was given, in the order it was given them, from one task on one thread.
@hint `yield_now().await` returns `Pending` once, so the first poll of `a` gets as far as the yield and stops. What does `join!` do next?
@hint Both start before either ends.

@diagnose E0308
`expected` must return `Vec<&'static str>` and each entry is a string literal, so
`vec!["a start", ...]` is the shape. If you wrote `String` values, either change
the annotation or drop the `to_string()` calls.

@after
Now the thing that actually matters. Replace `join!` with two plain awaits:

```rust
step(log.clone(), "a start", "a end").await;
step(log.clone(), "b start", "b end").await;
```

and the order becomes `a start, a end, b start, b end` — fully sequential, taking
as long as both operations added together. `a.await; b.await;` does **not** start
`a` and carry on. It drives `a` to completion before the second line is reached;
`b` has not even been constructed yet.

This is the most common real mistake in async Rust and it produces no warning.
The symptom is a program that is correct and exactly as slow as the blocking
version it replaced. `join!` polls both in one task (concurrency, one thread);
`tokio::spawn` on each puts them on the pool (parallelism, `Send + 'static`
required).

One detail worth knowing before you rely on an order: `futures::join!` polls its
arguments left to right every time, which is what makes this exercise
predictable. `tokio::join!` rotates the starting index between passes so that a
future listed first cannot starve the others, and gives
`a start, b start, b end, a end` here. Both are concurrent; neither guarantees an
interleaving you should write a test against.

## 6. The task that borrowed a local

@kind fix
@concept async block

@expect E0373

`tokio::spawn` takes a future and runs it on the runtime, independently of the
task that spawned it. The async block here reads a local `Vec`, and the compiler
objects for exactly the reason `thread::spawn` would.

```starter
pub fn run() -> i32 {
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let data = vec![1, 2, 3, 4];
        let handle = tokio::spawn(async { data.iter().sum::<i32>() });
        handle.await.unwrap()
    })
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_task_owns_its_data() {
        assert_eq!(run(), 10);
    }
}
```

```solution
pub fn run() -> i32 {
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let data = vec![1, 2, 3, 4];
        let handle = tokio::spawn(async move { data.iter().sum::<i32>() });
        handle.await.unwrap()
    })
}
```

@hint An async block captures like a closure: by reference unless told otherwise.
@hint `tokio::spawn` requires `F: Future + Send + 'static`. `'static` means the future may borrow nothing from the frame that created it.
@hint `async move { ... }`.

@diagnose E0373
`async block may outlive the current function, but it borrows data, which is
owned by the current function`.

Read "may" as the compiler does. You await the handle on the next line, but the
check is on the *type*: `tokio::spawn` demands `'static`, because a spawned task
is handed to the runtime and may still be running long after the spawning task
has returned — that is the entire point of spawning rather than awaiting. A
borrow of `data` would then be a reference into a dead frame.

`async move` makes the block take ownership of every capture, so `data` moves
into the future, the future moves into the runtime, and the data lives exactly as
long as the task that owns it.

@diagnose E0521
`borrowed data escapes outside of async block`. Same cause, reported from the
other end: the reference would have to outlive the block that created it.

@after
The parallel with unit 21 is exact, and worth stating as one rule:
`thread::spawn` and `tokio::spawn` both require `Send + 'static`, and both are
satisfied by moving ownership in. Threads have `thread::scope` as the escape
hatch for borrowed locals; tokio's equivalents are the structured-concurrency
crates (`tokio::task::JoinSet`, `async_scoped`), and awaiting a future directly
instead of spawning it, which needs no bound at all.

There is a second `Send` trap that has no error code and catches everyone once: a
`std::sync::MutexGuard` held across an `.await` makes the whole future non-`Send`,
because the guard becomes a field of the generated state machine. `tokio::spawn`
then rejects it with `future cannot be sent between threads safely`. Take the
lock, touch the data, drop the guard — before the await.

## 7. An async function that calls itself

@kind fix
@concept state machine

@expect E0733

A recursive `async fn`. The compiler rejects it with a suggestion, and the
reason behind the suggestion is the whole story of how an `async fn` is
compiled.

```starter
pub async fn countdown(n: u32) -> u32 {
    if n == 0 {
        return 0;
    }
    countdown(n - 1).await + 1
}

pub fn run() -> u32 {
    futures::executor::block_on(countdown(3))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_down_three_levels() {
        assert_eq!(run(), 3);
    }
}
```

```solution
pub async fn countdown(n: u32) -> u32 {
    if n == 0 {
        return 0;
    }
    Box::pin(countdown(n - 1)).await + 1
}

pub fn run() -> u32 {
    futures::executor::block_on(countdown(3))
}
```

@hint An `async fn` compiles into a struct holding everything live across each `.await`. What is live across this one?
@hint The inner future is a field of the outer future, which makes the type infinitely large. Work out how a recursive `enum` is normally fixed.
@hint Put the recursive call behind a pointer: `Box::pin(countdown(n - 1)).await`.

@diagnose E0733
`recursion in an async fn requires boxing`, with `recursive call here` and a note
about a `Pin<Box<dyn Future>>`.

The message is really about size. An `async fn` compiles into a state machine
whose fields are the variables live across each suspension point — and here the
value live across the `.await` is the future returned by `countdown` itself. So
`Countdown` contains a `Countdown`, which contains a `Countdown`, and the
compiler cannot compute a size for it. It is the same infinite type as a
recursive `struct` or a linked-list `enum` without a `Box`, arrived at by a
different route.

`Box::pin` moves the inner future to the heap, so the outer state machine holds a
pointer of known size. `Pin` rather than plain `Box` because `Future::poll`
requires a pinned receiver.

@diagnose E0308
`Box::pin(...)` is a `Pin<Box<impl Future>>`, and awaiting it gives the `u32`.
If the arithmetic no longer type-checks, check you awaited before adding: the
`+ 1` applies to the awaited value, not to the future.

@after
That one error tells you almost everything about the representation. A future's
size is the largest of its states, not a stack — which is why a future can be
tens of bytes where a thread is tens of kilobytes, and why the `Vec` you declared
before an `.await` costs you its 24 bytes for the whole suspension while one
declared after costs nothing until it is reached.

It is also why holding a lock guard across an await is a real bug rather than a
style question: the guard is a *field* of the state machine, so the lock stays
held for as long as the task is parked.

## 8. Write the Future by hand

@kind fix
@concept poll

@expect E0053

`Countdown` returns `Pending` a few times and then `Ready` with the number of
polls it took. The logic is written. The signature is not, and the shape rustc
insists on is the reason `Pin` exists.

```starter
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};

pub struct Countdown {
    pub left: u32,
    pub polls: u32,
}

impl Future for Countdown {
    type Output = u32;

    fn poll(&mut self, cx: &mut Context<'_>) -> Poll<u32> {
        if self.left == 0 {
            Poll::Ready(self.polls)
        } else {
            self.left -= 1;
            self.polls += 1;
            cx.waker().wake_by_ref();
            Poll::Pending
        }
    }
}

pub fn run() -> u32 {
    futures::executor::block_on(Countdown { left: 3, polls: 0 })
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reports_how_many_polls_it_took() {
        assert_eq!(run(), 3);
    }
}
```

```solution
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};

pub struct Countdown {
    pub left: u32,
    pub polls: u32,
}

impl Future for Countdown {
    type Output = u32;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<u32> {
        if self.left == 0 {
            Poll::Ready(self.polls)
        } else {
            self.left -= 1;
            self.polls += 1;
            cx.waker().wake_by_ref();
            Poll::Pending
        }
    }
}

pub fn run() -> u32 {
    futures::executor::block_on(Countdown { left: 3, polls: 0 })
}
```

@hint Look up `Future::poll` in the standard library and copy its receiver exactly.
@hint The receiver is not `&mut self`. It is `self: Pin<&mut Self>` — a `&mut Self` carrying a promise that the value will not move.
@hint `fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<u32>`. The body needs no other change, because `Countdown` is `Unpin` and the field writes go through `DerefMut`.

@diagnose E0053
`method poll has an incompatible type for trait`, `expected signature
fn(Pin<&mut Countdown>, &mut Context<'_>) -> ...`, `found signature
fn(&mut Countdown, ...)`.

The trait declares `fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>)`, and an
impl has to match it exactly. The interesting question is why the standard
library chose that receiver.

An `async fn` compiles into a struct whose fields are the locals live across each
await — and one of those locals may be a *reference to another of those fields*.
`let row = load().await; render(&row).await;` produces a state holding both `row`
and a future built from `&row`. That is a self-referential value: move it and the
internal pointer still points at the old address, in safe code. `Pin<&mut T>` is
the type-level promise that the value will never move again, and `poll` demands
it so that no future can be polled before that promise exists.

@diagnose E0599
`no method named poll found`. `Future::poll` is not an inherent method — bring
the trait into scope with `use std::future::Future;` before calling it, or let
`block_on` and `.await` call it for you, which is what you normally want.

@after
`Countdown` implements `Unpin` automatically, because all its fields do, and for
`Unpin` types `Pin` is transparent — `self.left -= 1` works through `DerefMut`
without a thought. Almost every hand-written future is in this position. `Pin`
only starts to cost you attention when the future genuinely is self-referential,
which in practice means a compiler-generated one.

The other half of a real `poll` is the waker. `wake_by_ref()` here re-queues the
task immediately, which is a busy loop dressed up — a real future registers
`cx.waker()` with an epoll set or a timer wheel and returns `Pending` *without*
waking, so the task costs nothing at all until the OS says something happened.
Return `Pending` without arranging a wake and the task simply never runs again.
