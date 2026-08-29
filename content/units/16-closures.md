---
num: 16
slug: 16-closures
title: Closures
accent: plum
concepts: closure, capture, Fn, FnMut, FnOnce, move, disjoint capture, function pointer
needs: 05-ownership, 06-borrowing, 13-generics, 14-traits
blurb: An anonymous function plus a struct holding what it captured. That one fact explains the three traits, the move keyword and why every closure has a different type.
---

%% A closure looks like a function literal, and that framing explains none of its behaviour. Why can this one be called twice and that one only once? Why does `move` change the type? Why can two closures with identical bodies not go in the same `Vec`?

One fact answers all of it. **A closure is an anonymous function plus a compiler-generated struct holding what it captured.** The body becomes a method on that struct. Everything else in this unit is a consequence.

## A closure is a struct

### The desugaring

```rust
let factor = 3;
let scale = |x: i32| x * factor;
scale(5);
```

There is no such thing as a closure type in the language's surface syntax. What
the compiler emits is closer to this:

```rust
struct Scale<'a> { factor: &'a i32 }

impl<'a> Scale<'a> {
    fn call(&self, x: i32) -> i32 { x * *self.factor }
}

let scale = Scale { factor: &factor };
scale.call(5);
```

A struct with one field per captured variable, and a method carrying the body.
The `Fn` traits are the real version of that `call`, with the receiver chosen by
what the body does, which is the next section.

:::memory a closure is its captures
       STACK
     ┌─────────────────────────┐
scale│ factor   ●──────────────┼──▶ 3     (the i32 it captured)
     └─────────────────────────┘
     8 bytes: one captured reference

     A closure capturing nothing is a ZERO-sized value.
     `|x: i32| x * 2` occupies no memory at all.
:::

That is why closures cost nothing over a hand-written loop: the struct is
usually zero or one word, the call is a direct call, and the optimiser inlines
it away.

:::compare
**Python / JavaScript**: a closure holds a live link to the enclosing scope, so
mutating the variable afterwards changes what the closure sees. Rust captures
*specific variables* into fields, and the borrow checker then decides whether
that field may be a `&`, a `&mut`, or an owned value.

**Java**: captured locals must be effectively final, because there is no way to
express a shared mutable capture safely. Rust expresses it: that is `FnMut`.
:::

## Three traits, one hierarchy

### What the receiver tells you

| trait | method receiver | body may | callable |
|---|---|---|---|
| `FnOnce` | `self` | consume a capture | exactly once |
| `FnMut` | `&mut self` | mutate a capture | repeatedly, via a `mut` binding |
| `Fn` | `&self` | only read captures | repeatedly, from several places at once |

Read the receiver column and the rules stop needing memorising. Consuming a
field needs `self` by value, so the call destroys the closure, which is why it
runs once.
Mutating a field needs `&mut self`, so the binding must be `mut` and no one else
may hold it at the same time. Reading needs only `&self`.

:::note
They are a **hierarchy**, not three alternatives: `Fn` implies `FnMut` implies
`FnOnce`. Anything callable many times is callable once.

So take the *loosest* bound your function needs. `FnOnce` accepts every closure;
`Fn` accepts the fewest.
:::

### The compiler infers it; you do not choose

```rust
let text = String::from("ferris");
let mut hits = 0;

let read  = || text.len();          // Fn:     reads only
let count = || hits += 1;           // FnMut:  mutates a capture
let eat   = || text;                // FnOnce: moves a capture out
```

Identical syntax, three different traits. There is no keyword and no place to
declare it. The compiler looks at what the body does to each capture and derives
the strongest trait the closure can implement.

:::gotcha
This is why `error[E0525]: expected a closure that implements the Fn trait`
appears when you never wrote `Fn` anywhere. The *function you passed it to* asked
for `Fn`; your body mutated something, so the closure only implements `FnMut`.

The fix is one of two things, and they are not equivalent: loosen the bound on
the receiving function to `FnMut`, or stop mutating in the body.
:::

## Capture, and `move`

### By reference unless the body forces otherwise

The compiler captures with the least power that works: `&T` if reading is
enough, `&mut T` if the body mutates, by value only if the body consumes.

`move` overrides that: **capture everything by value.** It is not about the
closure's traits (a `move` closure that only reads is still `Fn`) but about who
owns the captured data.

```rust,bad
use std::thread;

fn run() {
    let name = String::from("ferris");
    thread::spawn(|| println!("{name}"));   // error[E0373]
}                                           // name dropped; thread may still run
```

```rust,good
fn run() {
    let name = String::from("ferris");
    thread::spawn(move || println!("{name}"));
}
```

`E0373: closure may outlive the current function, but it borrows name` is the
borrow checker doing exactly its usual job. The spawned thread is not bounded by
this stack frame, so a captured `&name` could outlive `name`. `move` makes the
closure own the `String`, and there is nothing left to dangle.

:::gotcha
`move` moves *each* capture, and a moved binding is dead in the enclosing scope
too. Two threads that both want the same `Vec` cannot both `move` it:

```rust,bad
let data = vec![1, 2, 3];
let a = thread::spawn(move || data.len());
let b = thread::spawn(move || data.len());   // error[E0382]: use of moved value
```

A `&data` will not fix it either; that is `E0373` again. What both threads need
is *shared ownership*:

```rust,good
let data = Arc::new(vec![1, 2, 3]);

let first = Arc::clone(&data);
let a = thread::spawn(move || first.len());

let second = Arc::clone(&data);
let b = thread::spawn(move || second.iter().sum::<i32>());
```

Each closure moves its own handle. `Arc::clone` copies a pointer and bumps an
atomic counter; the vector is never duplicated, and it is freed when the last
handle drops. Reach for `Rc` instead and the compiler stops you, because its
counter is a plain integer and `Rc` is therefore not `Send`.
:::

### Disjoint capture, since edition 2021

```rust
struct Config { name: String, retries: u32 }

let mut cfg = Config { name: String::from("api"), retries: 0 };

let mut bump = || cfg.retries += 1;   // captures cfg.retries, not cfg
println!("{}", cfg.name);             // fine in 2021, E0502 before it
bump();
```

Editions 2015 and 2018 captured the whole `cfg`, so touching any other field was
a borrow conflict and people wrote `let retries = &mut cfg.retries;` above the
closure to work around it. Since 2021 the compiler captures the individual
**places** the body mentions, which is **disjoint capture**. The workaround is
gone, and closures now capture strictly less than they used to.

## Every closure has its own type

### Unnameable, and all different

```rust
let a = |x: i32| x + 1;
let b = |x: i32| x + 1;
```

Same body, same signature, two distinct types. Each closure expression defines a
fresh anonymous struct. You cannot write either type down, and they cannot go in
one `Vec` even though they behave identically.

So there are exactly two ways to name a closure in a signature.

| form | dispatch | cost | use when |
|---|---|---|---|
| `impl Fn(i32) -> i32` | static | none; monomorphised and inlinable | one closure per call site, returning or accepting |
| `Box<dyn Fn(i32) -> i32>` | dynamic | one allocation, one indirect call | several different closures in one collection |

```rust
fn adder(n: i32) -> impl Fn(i32) -> i32 {
    move |x| x + n
}

fn handlers() -> Vec<Box<dyn Fn(i32) -> i32>> {
    vec![Box::new(|x| x + 1), Box::new(|x| x * 2)]
}
```

`impl Fn` in return position means "one specific type I am not telling you". It
cannot express a `Vec` of *different* closures. That needs the **trait object**.
Note the `move` in `adder`: `n` is a local, so a borrowing closure could not
outlive the function.

### Function pointers are a different thing

```rust
fn double(x: i32) -> i32 { x * 2 }

let f: fn(i32) -> i32 = double;        // ok
let g: fn(i32) -> i32 = |x| x * 2;     // ok: captures nothing
let n = 2;
let h: fn(i32) -> i32 = |x| x * n;     // error[E0308]: expected fn pointer
```

A **function pointer**, `fn` in lowercase, is a plain code address: one word, no environment. A closure
coerces to one **only if it captures nothing**, because there is nowhere in a code
address to put the captures. That coercion is what makes `map(str::trim)` work.

:::note
Take `impl Fn(..)` in your own APIs, not `fn(..)`. Every `fn` item and every
non-capturing closure already implements `Fn`, so the generic form accepts
strictly more callers at no runtime cost.
:::

## Where they show up

Closures exist because generic code needs to accept behaviour, not just data.
Every one of these is the same mechanism:

| call | bound | why that one |
|---|---|---|
| `v.iter().map(f)` | `FnMut` | called once per element, may keep a counter |
| `v.sort_by_key(f)` | `FnMut` | same |
| `opt.unwrap_or_else(f)` | `FnOnce` | called at most once, so it may consume |
| `thread::spawn(f)` | `FnOnce + Send + 'static` | run once, on another thread, after this frame may be gone |

:::gotcha
`unwrap_or_else` takes `FnOnce` and `unwrap_or` takes a value. The difference is
laziness, and it matters: `cache.get(k).unwrap_or(expensive())` evaluates
`expensive()` every time, hit or miss. `unwrap_or_else(|| expensive())` only
runs it on a miss.

Taking a closure rather than a value is how an API buys laziness. It costs
nothing: the closure is zero-sized and the call inlines away.
:::
