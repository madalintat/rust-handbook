---
unit: 16-closures
---

## 1. The closure that mutates

@kind fix
@concept FnMut
@expect E0596

`bump` adds one to a variable it captured. The compiler generated a struct
holding a `&mut` to `count`, and calling it needs `&mut self` — so the binding
that holds the closure has to allow that.

One keyword.

```starter
pub fn run() -> i32 {
    let mut count = 0;

    let bump = || count += 1;
    bump();
    bump();
    bump();

    count
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_three() {
        assert_eq!(run(), 3);
    }
}
```

```solution
pub fn run() -> i32 {
    let mut count = 0;

    let mut bump = || count += 1;
    bump();
    bump();
    bump();

    count
}
```

@hint `count` is already `mut`. The error is not about `count`.
@hint Calling an `FnMut` closure takes `&mut self`, so the closure value itself must be held in a mutable binding.
@hint `let mut bump = || count += 1;`

@diagnose E0596
`cannot borrow bump as mutable, as it is not declared as mutable`.

Note carefully what it is complaining about: `bump`, the closure value — not
`count`, which you already made `mut`. Desugar and it is ordinary:

The compiler generated a struct with one field, a `&mut i32` pointing at `count`,
and a `call` method taking `&mut self` because the body mutates through it. That
makes the closure `FnMut`. Calling it is a `&mut` borrow of `bump`, and you
cannot take a `&mut` to an immutable binding.

So `mut` here is not decoration. It is the same rule as `let mut v = Vec::new();`
before `v.push(1)`, applied to a value that happens to be a closure.

@diagnose E0499
You are calling `bump` while another borrow of `count` is still live — reading
`count` between the calls, for instance. The closure holds a `&mut` to `count`
for as long as it is still going to be used, and no other borrow may overlap it.

@after
The trait a closure gets is derived from its body, never declared. Change
`count += 1` to `count` and the same syntax produces an `Fn` closure, callable
through an immutable binding and from several places at once.

That is worth internalising, because it means the `mut` you just added is
carrying real information: this closure has state, and only one caller may hold
it at a time. A counter, an accumulator, and a `sort_by_key` that memoises are
all `FnMut` for exactly this reason.

## 2. The thread that outlives the frame

@kind fix
@concept move
@expect E0373

`thread::spawn` takes a closure and runs it on another thread, which may still be
going long after `run` has returned. So the closure is not allowed to borrow
anything that lives in `run`'s frame.

```starter
use std::thread;

pub fn run() -> String {
    let name = String::from("ferris");
    let h = thread::spawn(|| format!("hello {name}"));
    h.join().unwrap()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn greets_from_a_thread() {
        assert_eq!(run(), "hello ferris");
    }
}
```

```solution
use std::thread;

pub fn run() -> String {
    let name = String::from("ferris");
    let h = thread::spawn(move || format!("hello {name}"));
    h.join().unwrap()
}
```

@hint The closure captured `name` by reference, because reading it is all the body does. That is the problem.
@hint The new thread has no idea when `run`'s frame goes away. The closure needs to *own* what it uses.
@hint Put `move` in front of the closure: `thread::spawn(move || ...)`.

@diagnose E0373
`closure may outlive the current function, but it borrows name, which is owned by
the current function`, with a help line suggesting `move`.

The compiler captures with the least power that works, and the body only reads
`name`, so it captured a `&String`. That is normally ideal. It is wrong here for
one reason: `thread::spawn` requires `F: 'static`, meaning the closure may hold
no borrow that could expire — and a `&name` expires when `run` returns.

`move` changes the capture, not the trait. The closure still only reads, so it is
still `Fn`. What changes is that the generated struct now holds a `String` by
value instead of a `&String`, the `name` binding in `run` is moved-from, and
there is nothing left that could dangle.

@diagnose E0382
You added `move` and then used `name` afterwards in `run`. A `move` closure takes
ownership of every capture, so the original binding is dead. Either clone before
the closure, or read the value back out of what the thread returns.

@after
`F: 'static` on `thread::spawn` causes more confusion than any other bound in the
standard library, because "static" reads as "forever". It does not mean the
closure lives forever. It means the closure's type contains no reference with a
lifetime shorter than the program — so it *could* live that long if it had to.

A `String` moved in satisfies that completely. If you genuinely need the thread
to see something the parent still owns, the answer is `Arc` for shared reads or
`std::thread::scope` for a thread guaranteed to finish before the frame does.

## 3. A function pointer has nowhere to put it

@kind fix
@concept function pointer
@expect E0308

`adder` returns a callable that adds `n`. The return type says `fn(i32) -> i32`,
which is a bare code address — one word, no room for anything else.

The closure needs `n`. Change the return type to one that can carry it.

```starter
pub fn adder(n: i32) -> fn(i32) -> i32 {
    move |x| x + n
}

pub fn run() -> i32 {
    let add_ten = adder(10);
    add_ten(5) + adder(1)(1)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn builds_adders() {
        assert_eq!(run(), 17);
    }
}
```

```solution
pub fn adder(n: i32) -> impl Fn(i32) -> i32 {
    move |x| x + n
}

pub fn run() -> i32 {
    let add_ten = adder(10);
    add_ten(5) + adder(1)(1)
}
```

@hint Read the help line under the error. It tells you precisely which closures can become `fn` pointers.
@hint This closure captured `n`, so it is a struct with a field — not an address. You need a return type that describes a trait, not a pointer.
@hint `pub fn adder(n: i32) -> impl Fn(i32) -> i32`. Keep the `move`: `n` is a local.

@diagnose E0308
`mismatched types — expected fn pointer fn(i32) -> i32, found closure`, followed
by the sentence that is the whole lesson: *closures can only be coerced to fn
types if they do not capture any variables*.

`fn` in lowercase is a code address and nothing else: eight bytes, no
environment. `|x| x + n` is a struct holding an `i32`, with a `call` method. The
struct cannot be squeezed into a pointer, so there is no coercion.

`impl Fn(i32) -> i32` in return position means "one specific type that implements
`Fn`, which I am not naming". The concrete type is the anonymous struct, chosen
at compile time, so the call is direct and inlinable — no allocation and no
indirection.

@diagnose E0373
You dropped the `move`. `n` is a parameter of `adder` and dies when `adder`
returns, so a closure that borrows it cannot be returned. `move` makes the
closure own its copy of `n`.

@after
The coercion does exist, and it is useful: a closure capturing nothing becomes a
`fn` pointer, which is how `map(str::trim)` and `unwrap_or_else(Vec::new)` work.

Prefer `impl Fn(..)` over `fn(..)` in your own signatures anyway. Every `fn` item
and every non-capturing closure already implements `Fn`, so the generic form
accepts strictly more callers and compiles to the same code. Reach for a real
`fn` pointer only where you need the type to be nameable and `Copy` — a lookup
table of handlers, or an `extern "C"` callback.

## 4. Called once means once

@kind fix
@concept FnOnce
@expect E0382

The closure's body is `banner` — it hands out the captured `String` itself. That
means calling it moves the field out of the closure, which destroys the closure.
It is `FnOnce`, and the code calls it twice.

```starter
pub fn run() -> String {
    let banner = String::from("ferris");

    let take = move || banner;

    let a = take();
    let b = take();
    format!("{a}-{b}")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn calls_twice() {
        assert_eq!(run(), "ferris-ferris");
    }
}
```

```solution
pub fn run() -> String {
    let banner = String::from("ferris");

    let take = move || banner.clone();

    let a = take();
    let b = take();
    format!("{a}-{b}")
}
```

@hint Which trait is this closure? Look at what the body does to `banner`, not at how many times it is called.
@hint A body that gives away a capture needs `self` by value, so the call consumes the closure. To be callable twice, the body must leave the capture where it is.
@hint `move || banner.clone()` — the closure keeps owning the `String` and produces a fresh one per call.

@diagnose E0382
`use of moved value: take — value used here after move`, with a note that the
closure `cannot be moved out of` because it implements `FnOnce` and not `Fn`.

The closure is a struct with one field, an owned `String`. The body evaluates to
that field, so calling it has to move the field out — and you cannot move a field
out of a struct you only borrowed. The `call` method therefore takes `self` by
value, which is exactly the definition of `FnOnce`. The first call consumes
`take`; the second has nothing left.

Changing the body to `banner.clone()` changes the trait. Cloning only needs
`&self`, so the closure becomes `Fn`, keeps its field, and can be called as often
as you like.

@diagnose E0507
Same story from the other side: you tried to move the captured value out through
a reference. A closure that gives away a capture must be consumed to do it.

@after
Nothing declares `FnOnce` and nothing here says it. The body did.

That is worth stating plainly because the traits are a hierarchy — `Fn` implies
`FnMut` implies `FnOnce` — and the compiler always derives the strongest one the
body permits. Your job is the mirror image: in your own generic functions, take
the *weakest* bound you can live with. `FnOnce` accepts every closure. `Fn`
accepts the fewest. `Option::unwrap_or_else` takes `FnOnce` for precisely this
reason: it calls at most once, so it has no business rejecting a closure that
consumes something.

## 5. The closure is still holding it

@kind fix
@concept capture
@expect E0502

`record` captured `log` by mutable reference, and it keeps that borrow for as
long as it might still be called. Reading `log` in the middle of that is a second
borrow overlapping the first.

Reorder the function so the borrow is finished before the read.

```starter
pub fn run() -> (usize, i32) {
    let mut log = Vec::new();

    let mut record = |x: i32| log.push(x);

    record(1);
    record(2);
    let seen = log.len();
    record(3);

    (seen, log.iter().sum())
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn records_then_reads() {
        assert_eq!(run(), (3, 6));
    }
}
```

```solution
pub fn run() -> (usize, i32) {
    let mut log = Vec::new();

    let mut record = |x: i32| log.push(x);

    record(1);
    record(2);
    record(3);

    let seen = log.len();

    (seen, log.iter().sum())
}
```

@hint A closure's captures are fields. `record` holds a `&mut Vec<i32>` from the moment it is created until its last call.
@hint `log.len()` needs a shared borrow. It cannot overlap the closure's unique one.
@hint Move every `record(..)` call above the first read of `log`, so the closure's borrow has ended by then.

@diagnose E0502
`cannot borrow log as immutable because it is also borrowed as mutable`, with
`mutable borrow occurs here` on the closure, `immutable borrow occurs here` on
`log.len()`, and `mutable borrow later used here` on `record(3)`.

The third underline is the one that explains it. A borrow lasts until its last
*use*, not to the end of the block, so if `record(3)` had not been there the
closure's borrow would have ended at `record(2)` and `log.len()` would have been
fine.

There is nothing closure-specific about the rule. The generated struct holds a
`&mut Vec<i32>` field, so `record` *is* a live mutable borrow of `log`, sitting
in a variable. The usual "shared or unique, never both" applies to it exactly as
it would to `let r = &mut log;`.

@diagnose E0499
Two closures both capturing `log` mutably, with both still to be called. Same
rule, both borrows unique this time. Only one may be live.

@after
This pattern is common enough to have a standard shape: finish with the closure,
then read. Calling `drop(record)` explicitly also works, and reads clearly when
the ordering is not obvious.

The deeper point is that a closure is a value holding borrows, so it participates
in borrow checking like any other value. The 2021 edition softened this
considerably — before **disjoint capture**, a closure touching `cfg.retries`
borrowed the whole `cfg` and blocked reads of `cfg.name`. Now it captures the
individual field, and a great deal of code that once needed a manual workaround
simply compiles.

## 6. Fn was too strong an ask

@kind fix
@concept Fn
@expect E0525

`apply_thrice` demands `Fn`, the strictest of the three traits: a closure that
only reads its captures. The closure passed to it keeps a counter, so it mutates
one.

Loosen the function, do not weaken the closure — the counter is the point.

```starter
pub fn apply_thrice<F: Fn(i32) -> i32>(f: F, start: i32) -> i32 {
    f(f(f(start)))
}

pub fn run() -> i32 {
    let mut calls = 0;
    let step = |x: i32| {
        calls += 1;
        x + calls
    };
    apply_thrice(step, 0)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accumulates_across_calls() {
        assert_eq!(run(), 6);
    }
}
```

```solution
pub fn apply_thrice<F: FnMut(i32) -> i32>(mut f: F, start: i32) -> i32 {
    let a = f(start);
    let b = f(a);
    f(b)
}

pub fn run() -> i32 {
    let mut calls = 0;
    let step = |x: i32| {
        calls += 1;
        x + calls
    };
    apply_thrice(step, 0)
}
```

@hint The closure is `FnMut`. Change what `apply_thrice` asks for.
@hint An `FnMut` is called through `&mut self`, so the parameter holding it must be `mut f: F`.
@hint `f(f(f(start)))` needs three overlapping mutable borrows of `f`. Split it into three statements with a `let` between them.

@diagnose E0525
`expected a closure that implements the Fn trait, but this closure only
implements FnMut`, with `this closure implements FnMut, not Fn` under the
closure and `the requirement to implement Fn derives from here` under the call.

You never wrote `Fn` on the closure — you could not have. The trait comes from
`calls += 1` in the body, which needs `&mut self`, which is `FnMut`. The demand
for `Fn` came from `apply_thrice`'s bound.

The three traits are a hierarchy: `Fn` implies `FnMut` implies `FnOnce`. So
asking for `Fn` accepts the fewest closures of the three. In a generic function,
ask for the weakest bound the body actually needs — here `FnMut`, because
`apply_thrice` calls `f` repeatedly but never needs two callers at once.

@diagnose E0596
You changed the bound to `FnMut` but left the parameter as `f: F`. Calling an
`FnMut` borrows it mutably, so the parameter has to be `mut f: F`.

@diagnose E0499
`cannot borrow f as mutable more than once at a time` — `f(f(f(start)))`
evaluates the inner calls while the outer one already holds `&mut f`. Three
separate statements, each finishing its borrow before the next begins.

@after
The nesting had to go, and that is informative rather than annoying. `f(f(f(x)))`
is only meaningful for a pure function; with a closure carrying state, the order
of the three calls is observable, and the borrow checker is refusing to let you
write something whose evaluation order you have not made explicit.

Rule of thumb for your own APIs: take `FnOnce` if you call it at most once,
`FnMut` if you call it repeatedly, and `Fn` only when you genuinely need to call
it from several places at once — through an `Rc`, or from more than one thread.
The standard library follows exactly this: `map` and `sort_by_key` take `FnMut`,
`unwrap_or_else` takes `FnOnce`.

## 7. Two threads, one vector

@kind fix
@concept move
@expect E0382

Both closures need the data, and `move` gives it to whichever one is written
first. Dropping the `move` is not the answer either — that is the borrow the
previous thread exercise was about.

What the two threads need is shared ownership.

```starter
use std::thread;

pub fn run() -> (i32, usize) {
    let data = vec![1, 2, 3, 4];

    let a = thread::spawn(move || data.iter().sum::<i32>());
    let b = thread::spawn(move || data.len());

    (a.join().unwrap(), b.join().unwrap())
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn both_threads_see_it() {
        assert_eq!(run(), (10, 4));
    }
}
```

```solution
use std::sync::Arc;
use std::thread;

pub fn run() -> (i32, usize) {
    let data = Arc::new(vec![1, 2, 3, 4]);

    let first = Arc::clone(&data);
    let a = thread::spawn(move || first.iter().sum::<i32>());

    let second = Arc::clone(&data);
    let b = thread::spawn(move || second.len());

    (a.join().unwrap(), b.join().unwrap())
}
```

@hint Only one value can be moved into one closure. There is one `Vec` and two closures.
@hint `&data` will not work — a thread may outlive this frame, so it cannot hold a borrow of a local. You need a type that owns the data and can be duplicated.
@hint Wrap it: `let data = Arc::new(vec![..])`, then make an `Arc::clone(&data)` for each thread and `move` the clone in.

@diagnose E0382
`use of moved value: data`, with `value moved into closure here` on the first
`spawn` and `value used here after move` on the second.

Nothing about this is closure-specific. `move` builds a struct that owns `data`,
which is an ordinary move, so the `data` binding is dead afterwards — exactly as
it would be after `takes(data)`.

The escape people reach for is dropping `move` on the second closure, which
trades this for `E0373`: a spawned thread has no bound on how long it runs, so it
may not borrow a local. Neither one closure owning it nor both borrowing it
works. The data needs an owner that outlives both threads and can be shared,
which is `Arc` — an atomically reference-counted handle. `Arc::clone` copies a
pointer and increments a counter; the vector itself is never duplicated, and it
is freed when the last handle drops.

@diagnose E0373
You removed `move` to avoid the first error. `thread::spawn` requires `F:
'static`, so the closure may not capture a reference to anything in this frame.
Put `move` back and give each thread its own `Arc` handle.

@diagnose E0277
`Rc<Vec<i32>> cannot be sent between threads safely` — you reached for `Rc`
rather than `Arc`. `Rc`'s counter is a plain integer, so two threads could
increment it at once and lose a count. `Arc` pays for an atomic counter and is
`Send`; `Rc` is not, and the trait system stops you at compile time.

@after
`Arc<T>` gives shared *reads*. Both closures here only read, so nothing more is
needed. The moment one of them wants to write, `Arc<T>` alone will not compile —
`Arc` hands out `&T`, never `&mut T`, because it cannot know how many other
handles exist. That is where `Arc<Mutex<T>>` comes from.

Also worth knowing before reaching for `Arc` at all: `std::thread::scope` lets
spawned threads borrow locals, because the scope guarantees every one of them has
finished before it returns. When the threads really are bounded by the current
frame, that is cheaper and simpler than reference counting.

## 8. A collection of different closures

@kind fix
@concept closure
@expect E0562

`Pipeline` holds a list of transformations to apply in order. Each stage is a
closure, and each closure has its own distinct anonymous type — so `Vec<impl
Fn(i32) -> i32>` cannot mean what it looks like it means.

Give the field a type that can hold closures of different types.

```starter
pub struct Pipeline {
    stages: Vec<impl Fn(i32) -> i32>,
}

impl Pipeline {
    pub fn new() -> Self {
        Pipeline { stages: Vec::new() }
    }

    pub fn add(&mut self, f: impl Fn(i32) -> i32) {
        self.stages.push(f);
    }

    pub fn run_on(&self, start: i32) -> i32 {
        self.stages.iter().fold(start, |acc, f| f(acc))
    }
}

pub fn run() -> i32 {
    let mut p = Pipeline::new();
    p.add(|x| x + 1);
    p.add(|x| x * 3);
    p.run_on(2)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn applies_stages_in_order() {
        assert_eq!(run(), 9);
    }

    #[test]
    fn empty_pipeline_is_identity() {
        let p = Pipeline::new();
        assert_eq!(p.run_on(7), 7);
    }
}
```

```solution
pub struct Pipeline {
    stages: Vec<Box<dyn Fn(i32) -> i32>>,
}

impl Pipeline {
    pub fn new() -> Self {
        Pipeline { stages: Vec::new() }
    }

    pub fn add(&mut self, f: impl Fn(i32) -> i32 + 'static) {
        self.stages.push(Box::new(f));
    }

    pub fn run_on(&self, start: i32) -> i32 {
        self.stages.iter().fold(start, |acc, f| f(acc))
    }
}

pub fn run() -> i32 {
    let mut p = Pipeline::new();
    p.add(|x| x + 1);
    p.add(|x| x * 3);
    p.run_on(2)
}
```

@hint `impl Trait` in a field means "one specific type", and a `Vec` of one specific type cannot hold two different closures.
@hint You need dynamic dispatch: a trait object. Trait objects are unsized, so they have to live behind a pointer.
@hint `Vec<Box<dyn Fn(i32) -> i32>>`, with `add` taking `impl Fn(i32) -> i32 + 'static` and pushing `Box::new(f)`.

@diagnose E0562
`impl Trait is not allowed in field types` — or in recent compilers, that
`impl Trait` is only permitted in argument and return position.

The reason is that `impl Trait` names *one concrete type*, decided once by the
compiler. In `-> impl Fn(i32) -> i32` that is fine: exactly one closure can be
returned. As a field type it is meaningless — the type would have to be fixed
when `Pipeline` is defined, and you want a different closure per stage.

Different closures with identical bodies still have different types, so no
generic parameter helps either. The tool for "several types behind one interface"
is the **trait object**, `dyn Fn(i32) -> i32`. It is unsized, so it needs a
pointer: `Box<dyn Fn(i32) -> i32>`.

@diagnose E0310
`the parameter type impl Fn(i32) -> i32 may not live long enough`.
`Box<dyn Fn(i32) -> i32>` is shorthand for `Box<dyn Fn(i32) -> i32 + 'static>`,
so anything boxed into it must hold no short-lived borrow. Add `+ 'static` to
`add`'s parameter.

@diagnose E0277
`the size for values of type dyn Fn(i32) -> i32 cannot be known at compilation
time`. You wrote `Vec<dyn Fn(i32) -> i32>` without the `Box`. A `Vec` needs
elements of a known size; a trait object has none until it is behind a pointer.

@after
The cost is real and small: one heap allocation per stage, and one indirect call
per stage through the vtable, which the optimiser cannot inline. In exchange the
pipeline is built at runtime from whatever stages you like.

Compare with the alternative shape, `Pipeline<F: Fn(i32) -> i32>` holding a
single `F`: no allocation, fully inlinable, and capable of exactly one stage
type. That is the standard trade and it shows up everywhere — `Iterator`
adapters are the static version, `Box<dyn Error>` and event-handler registries
are the dynamic one.

Note that `fold` works unchanged on `Box<dyn Fn>`: `Box<T>` derefs to `T`, so
`f(acc)` calls straight through.
