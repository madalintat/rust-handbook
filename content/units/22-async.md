---
num: 22
slug: 22-async
title: Async
accent: rust
concepts: async, await, future, poll, Poll, waker, executor, tokio, join, async block, state machine, Pin, suspension point, colour of functions
needs: 21-concurrency, 16-closures, 12-errors
blurb: A future is inert. Nothing runs until something polls it — which is the one sentence that explains async Rust, and the one thing a JavaScript promise does not do.
---

%% Unit 21 was about doing several things at once on several cores. This is about doing ten thousand things at once when nearly all of them are *waiting*. A thread parked on a socket is a stack, a kernel object and a scheduler slot, all held to make no progress at all. Async replaces that with a value the size of the state it actually needs.

One sentence decides whether the rest of this makes sense: **a Rust future does nothing until it is polled.** Not "starts eagerly and resolves later" — nothing.

## What async is for

### The arithmetic of a parked thread

A chat server holding 10,000 open connections, each idle most of the time:

| | one thread per connection | one future per connection |
|---|---|---|
| memory each | 8 KB–2 MB of stack, committed | tens to hundreds of bytes |
| 10,000 of them | gigabytes of address space | a few megabytes |
| switching between | kernel context switch, ~1–2 µs | a function call |
| who schedules | the OS, preemptively | your executor, at `.await` points |

Nothing here is about speed of computation. A future is smaller than a thread
because it stores only the variables live across a **suspension point**, rather
than a whole stack that might need any depth. That is the whole trade.

:::note
Async is for **I/O-bound** work — waiting on sockets, disks, timers, other
services. For CPU-bound work you want threads or rayon, and running a tight loop
inside an async task blocks the executor for everyone.
:::

## A future is inert

### `async fn` returns a value, it does not start work

```rust
async fn fetch(id: u32) -> String {
    format!("user {id}")
}

let fut = fetch(7);     // nothing has happened. Not one instruction of the body.
let s = fut.await;      // now it runs
```

`async fn f() -> T` is sugar for `fn f() -> impl Future<Output = T>`. Calling it
builds a state machine object and returns it. The body has not begun.

:::compare
**JavaScript.** `const p = fetch(url);` has *already sent the request*. A promise
is a handle to work in flight, and `await` only subscribes to a result that is
coming either way. Never awaiting it does not cancel it.

**Rust.** `let f = fetch(url);` has sent nothing. Drop `f` and the request never
happens — no work, no side effects, no warning beyond `#[must_use]`.

This inverts three habits at once. `Promise.all` is a *collection* of running
work; `join!` is what *makes* work run concurrently. Fire-and-forget in JS is
calling a function; in Rust it is `tokio::spawn`. And a JS promise cannot be
cancelled, while a Rust future is cancelled by dropping it.
:::

The payoff for inertness is that a future is a plain value with no runtime
attached. It can be composed, wrapped in a timeout, raced against another,
stored in a struct, or thrown away — all before anything has run.

### `.await` is a suspension point

`.await` means: poll this; if it is not ready, **return control to the caller**,
remembering where to resume. It is not "block here".

```rust
async fn handle(id: u32) -> usize {
    let row = db_lookup(id).await;    // may suspend; another task runs
    let body = render(&row).await;    // may suspend again
    body.len()
}
```

`.await` is legal only inside an `async fn` or `async` block. Outside one there
is nothing to suspend and nowhere to return to, which is `E0728`.

## Under the sugar

### The Future trait

```rust
pub trait Future {
    type Output;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output>;
}

pub enum Poll<T> { Ready(T), Pending }
```

That is the whole interface. `poll` asks "are you done?" and gets `Ready(value)`
or `Pending`.

The obvious follow-up — how does anyone know when to poll again? — is what
`Context` is for. It carries a **waker**. Before returning `Pending`, a future
must hand the waker to whatever it is waiting on (the epoll registration, the
timer wheel). When the socket becomes readable, that thing calls `wake()`, which
puts the task back on the executor's run queue.

:::memory one poll of one task
   EXECUTOR                              TASK                    OS
   ┌────────────────┐   poll(cx)   ┌──────────────┐
   │  ready queue   │─────────────▶│  state: Db   │  register waker
   │  [task 3]      │              │              │──────────────▶ epoll
   │                │◀─────────────│              │
   │  (task parked) │   Pending    └──────────────┘
   │                │                                   socket readable
   │  [task 3] ◀────┼───────────────  wake()  ◀──────────────┘
   └────────────────┘   re-queued, polled again
:::

No polling loop, no busy-waiting. A parked task costs exactly its own memory and
nothing else.

### Rust ships no executor

`std` has `Future`, `Poll`, `Context`, `Waker`, `async` and `.await` — and
nothing that runs them. You choose an **executor**: tokio (dominant, batteries included), or
smol or async-std, or write your own.

This is deliberate and it is the same reasoning as the rest of the language. An
executor needs a thread pool, an I/O reactor and a timer — none of which exist on
a microcontroller, in a kernel, or inside a browser's WASM sandbox, all of which
run async Rust today. Baking one into `std` would have made the language's
smallest targets pay for its largest.

The cost is real: the runtime is a dependency you pick, libraries are sometimes
written against a specific one, and `tokio::time::sleep` is not
`async_std::task::sleep`.

```rust
#[tokio::main]
async fn main() {
    println!("{}", fetch(7).await);
}
```

`#[tokio::main]` is a macro that rewrites `main` into a normal `fn` which builds a
runtime and calls `block_on`. There is always a synchronous entry point
somewhere; async is not turtles all the way down.

## Sequential is not concurrent

This is the most common real mistake in async Rust, and it produces no error.

```rust
// 200 ms — one after the other
let a = fetch("/a").await;
let b = fetch("/b").await;
```

```rust
// 100 ms — both in flight
let (a, b) = tokio::join!(fetch("/a"), fetch("/b"));
```

:::gotcha
`a.await; b.await;` is **sequential**. The first `.await` does not "start" `a` and
carry on — it drives `a` to completion before the second line is even reached.
`b` has not been created yet, let alone polled.

The clue that you have made this mistake is a program that is correct and exactly
as slow as the blocking version.
:::

`join!` polls every future in one task, in turn, on one thread — concurrency
without parallelism. For actual parallelism across cores, `tokio::spawn` each
future onto the runtime and await the handles; then the bounds tighten to
`Send + 'static`, exactly as with `thread::spawn`.

| | runs on | needs | use when |
|---|---|---|---|
| `a.await; b.await` | one task | nothing | `b` genuinely depends on `a` |
| `join!(a, b)` | one task, interleaved | nothing | independent I/O |
| `spawn(a); spawn(b)` | the whole pool | `Send + 'static` | independent, and CPU work between awaits |

`select!` is the other combinator worth knowing: it drives several futures and
returns on the first to finish, dropping the rest — which is how timeouts and
cancellation are built.

## What the compiler actually emits

### An enum of the suspension points

An `async fn` compiles to a **state machine**. Each `.await` is a state; the
variables live across it become that state's fields.

```rust
async fn handle(id: u32) -> usize {
    let row = db_lookup(id).await;
    let body = render(&row).await;
    body.len()
}
```

Roughly:

```rust
enum Handle {
    Start { id: u32 },
    AtDb { fut: DbLookup },
    AtRender { row: Row, fut: Render },   // `row` had to survive the await
    Done,
}
```

`poll` is a `match` on that enum which advances one step and returns. This
explains several things at once:

- **why a future's size is what it is** — the largest state, not a stack
- **why holding a `MutexGuard` across an `.await` is a bug** — the guard becomes a
  field and the lock is held while the task is parked, possibly for milliseconds
- **why the bounds are what they are** — `Send` for the future means every value
  live across an await is `Send`

### Why `Pin` exists

Look at `AtRender` again: `fut: Render` was built from `&row`, and `row` is a
field of the same enum. **A future can hold a reference into itself.**

That is fine while it sits still. Move it — by value, into a `Vec`, into a
`Box` — and the internal pointer still points at the old address. Dangling, in
safe code, which is not allowed to be possible.

:::memory a self-referential state
     BEFORE the move                    AFTER a naive move
   ┌──────────────────┐               ┌──────────────────┐
   │ row     "ada"    │◀──┐           │ row     "ada"    │
   │ fut.ptr  ●───────┼───┘           │ fut.ptr  ●───────┼──▶ ✗ old address
   └──────────────────┘               └──────────────────┘
:::

**Pin** is the answer: a wrapper asserting that what it points at will never
move again. `poll` takes `Pin<&mut Self>`, so a future is pinned before it is
ever polled, and after that it is guaranteed to stay put. Types that genuinely do
not care implement `Unpin`, and for them `Pin` is transparent.

:::note
`Pin` exists to support one thing: futures that borrow their own locals. It is
not a general-purpose tool, and outside writing a runtime or a hand-rolled future
you meet it as `Box::pin` and then stop thinking about it.
:::

## The honest part

### Async in traits

`async fn` in a trait was stabilised in 1.75, and works well for applications:

```rust
trait Store {
    async fn get(&self, k: &str) -> Option<String>;
}
```

The caveat is that the returned future has an anonymous type, so `Store` is not
object-safe — no `Box<dyn Store>` without help, and the trait cannot express
`Send` bounds on the returned future. Public libraries still reach for the
`async-trait` macro (which boxes every future) or a manual
`fn get(&self) -> impl Future<Output = ...> + Send`.

### Function colour

**Function colour** is the name for what happens next: `async` splits your
codebase in two. Async code calls sync code freely; sync code
cannot call async code without an executor and a `block_on`. Make one deep
function async and every caller up the chain must follow.

This is a real cost, and it is the standard criticism of async in every language
that has it. Rust's version is worse in one way — the bounds propagate too, so
one non-`Send` value deep inside can break `tokio::spawn` at the top — and better
in another: because a future is inert and cancellable, the composition
(`timeout`, `select!`, structured shutdown) is genuinely stronger than a promise.

:::note
**The habit.** Reach for async only when the work is I/O-bound and there is a lot
of it. A CLI that makes three HTTP calls wants `join!` at most; a program that
computes wants threads. Async is not "the fast way to write Rust", it is the way
to hold ten thousand sockets on four cores.
:::
