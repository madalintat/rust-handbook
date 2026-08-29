---
unit: 16-closures
---

## 1

What does the compiler actually generate for a closure?

- A. A function pointer plus a hidden heap allocation
- *B. An anonymous struct holding the captures, with the body as a method
- C. A `Box<dyn Fn>` behind the scenes
- D. An inline lambda with no type of its own

@why
One field per captured variable, and a `call` method carrying the body. That
single fact explains the rest: the three traits are the three possible receivers
for that method, `move` decides whether the fields are references or owned
values, and each closure expression makes a *different* struct, hence a different
type.

C is the tempting one because `Box<dyn Fn>` is how you often *store* a closure.
Nothing is boxed unless you box it.

## 2

How much memory does `let f = |x: i32| x * 2;` occupy?

- *A. Zero bytes — it captures nothing
- B. Eight bytes — a function pointer
- C. Sixteen bytes — a pointer and a vtable pointer
- D. It is heap-allocated, so the binding is one word

@why
The generated struct has no fields, so it is zero-sized, and calling it is a
direct call the optimiser will inline. That is why `v.iter().map(|x| x * 2)`
compiles to the same instructions as a hand-written loop.

C describes `&dyn Fn` or `Box<dyn Fn>`, which is what you get only when you ask
for dynamic dispatch. The closure itself has no vtable.

## 3

Which traits does `|| count += 1` implement, where `count: i32` is a local?
Choose all that apply.

- A. `Fn`
- *B. `FnMut`
- *C. `FnOnce`
- D. `fn() -> ()`, the function-pointer type

@why
The body mutates a capture, so the generated `call` takes `&mut self`. That is
`FnMut`, and `FnMut` implies `FnOnce` — anything callable repeatedly is callable
once.

It is not `Fn`, which needs `&self`, and not a `fn` pointer, which has nowhere
to hold the captured `count`. The hierarchy runs `Fn` ⊂ `FnMut` ⊂
`FnOnce`, so a closure always implements a *suffix* of that list, never a single
one. When a generic function asks for `FnOnce` it therefore accepts every
closure; asking for `Fn` accepts the fewest.

## 4

Does this compile?

```rust
let mut count = 0;
let bump = || count += 1;
bump();
```

- A. Yes — `count` is already `mut`
- *B. No — `E0596`; `bump` itself must be `mut`
- C. No — a closure cannot mutate a captured variable
- D. Yes, but `count` stays 0

@why
Calling an `FnMut` closure takes `&mut self`, so the binding holding the closure
must be mutable: `let mut bump = ...`. The error names `bump`, not `count`,
which is the part that surprises people.

C is wrong and worth ruling out. Mutating a capture is precisely what `FnMut`
exists for. The generated struct holds a `&mut i32` and the borrow checker
enforces that nothing else touches `count` while the closure may still be called.

## 5

What does `move` change about a closure?

- *A. Every capture is taken by value instead of by reference
- B. Which of the three `Fn` traits it implements
- C. That it is allocated on the heap
- D. That it can be called only once

@why
`move` is about **capture mode**, not about traits. A `move` closure whose body
only reads is still `Fn`; a non-`move` closure that consumes a capture is still
`FnOnce`. The trait is always derived from what the body does.

B is the most common misreading and it matters: `thread::spawn` needs `FnOnce +
Send + 'static`, and `move` helps with `'static` — no borrowed locals — not with
the `FnOnce` part.

## 6

Which of these can be assigned to a `let f: fn(i32) -> i32`? Choose all that
apply.

```rust
fn double(x: i32) -> i32 { x * 2 }
let n = 3;
```

- *A. `double`
- *B. `|x| x * 2`
- C. `|x| x * n`
- D. `move |x| x * n`

@why
A `fn` pointer is a bare code address — one word, with nowhere to store an
environment. A closure coerces to one only if it captures nothing, so A and B
work and C and D do not, `move` or otherwise.

The error for C is `E0308: expected fn pointer, found closure`, with the help
line spelling out the rule. This coercion is what makes `map(str::trim)` and
`unwrap_or_else(Vec::new)` work, and it is why you should take `impl Fn(..)` in
your own APIs: it accepts both kinds.

## 7

Two closures, identical bodies:

```rust
let a = |x: i32| x + 1;
let b = |x: i32| x + 1;
```

What is true of their types?

- A. They have the same type, since the signatures match
- *B. They have different types — each closure expression defines its own
- C. They both have type `fn(i32) -> i32`
- D. They are both `impl Fn(i32) -> i32`, which is one type

@why
Every closure expression generates a fresh anonymous struct, so `a` and `b` are
as unrelated as two distinct structs with identical fields. They cannot go in one
`Vec` without boxing.

D is the subtle wrong answer. `impl Fn(i32) -> i32` is not a type you can have
two of — in return position it means "one specific type I am not naming", chosen
by the compiler. A collection of different closures needs `Box<dyn Fn(i32) ->
i32>`.

## 8

Which return types work for a function that builds and returns a closure
capturing a local? Choose all that apply.

- *A. `impl Fn(i32) -> i32`
- *B. `Box<dyn Fn(i32) -> i32>`
- C. `fn(i32) -> i32`
- D. `dyn Fn(i32) -> i32`

@why
A is the default choice: static dispatch, no allocation, fully inlinable, and it
works for exactly one concrete closure type. B costs one allocation and one
indirect call, and is what you need when the returned closure could be one of
several types.

C fails because the closure captures. D fails because `dyn Fn` is unsized —
there is no way to return a value whose size is unknown, which is why it always
appears behind `Box`, `&`, or `Rc`.

Remember the `move`: the closure must own the local, or it cannot outlive the
function.

## 9

Does this compile in edition 2021?

```rust
struct Config { name: String, retries: u32 }
let mut cfg = Config { name: String::from("api"), retries: 0 };

let mut bump = || cfg.retries += 1;
println!("{}", cfg.name);
bump();
```

- *A. Yes — the closure captures only `cfg.retries`
- B. No — the closure borrows all of `cfg` mutably
- C. No — closures cannot capture struct fields
- D. Yes, but only because `name` is a `String`

@why
Since edition 2021, closures capture the individual **places** their body
mentions rather than the whole variable. `bump` holds a `&mut u32` to
`cfg.retries`, leaving `cfg.name` free to read.

B is the right answer for editions 2015 and 2018, where this was `E0502` and
people worked around it by writing `let r = &mut cfg.retries;` above the closure.
Disjoint capture removed a genuine annoyance, and it also means closures now
capture strictly less than they used to.

## 10

Does this compile?

```rust
let banner = String::from("hi");
let take = move || banner;
let a = take();
let b = take();
```

- A. Yes — `take` was declared with `move`, so it owns the string
- *B. No — `E0382`; the closure is `FnOnce` and was called twice
- C. No — `move` closures cannot return their captures
- D. Yes, and both `a` and `b` are `"hi"`

@why
The body evaluates to the captured field, so calling it must move that field out
of the struct — which requires `self` by value. That is the definition of
`FnOnce`: the first call consumes `take`.

A confuses ownership with callability. The closure does own the `String`; that is
exactly why giving it away destroys the closure. Change the body to
`banner.clone()` and the receiver becomes `&self`, making it `Fn` and callable
as often as you like.

## 11

Why does `thread::spawn(|| println!("{name}"))` fail where `name` is a local
`String`?

- *A. `E0373` — the closure borrows `name`, and the thread may outlive the frame
- B. `String` is not `Send`
- C. `println!` cannot be used off the main thread
- D. The closure is `FnOnce`, and `spawn` requires `Fn`

@why
The body only reads, so the compiler captured a `&String` — normally the best
choice. `thread::spawn` requires `F: 'static`, and a borrow of a local is not
`'static`, because the frame can disappear while the thread runs. `move` fixes it
by giving the closure ownership.

D has the hierarchy backwards: `spawn` asks for `FnOnce`, the *weakest* of the
three, because it calls the closure exactly once.

## 12

Two threads both need the same `Vec<i32>`. What works?

- A. `move` into both closures
- B. Borrow with `&data` in both closures
- *C. `Arc::new(data)`, then `move` a separate `Arc::clone` into each
- D. `Rc::new(data)`, then `move` a separate `Rc::clone` into each

@why
A fails with `E0382` — the first `move` takes the vector and the second has
nothing left. B fails with `E0373`, because a spawned thread cannot borrow a
local. The threads need *shared ownership*.

D is the trap and the compiler catches it: `Rc`'s counter is a plain integer, so
two threads could increment it simultaneously and lose a count. `Rc` is therefore
not `Send`, and you get `E0277`. `Arc` pays for an atomic counter and is safe to
send. Its clone copies a pointer and bumps a count; the vector is never copied.

## 13

What is the difference between `unwrap_or(compute())` and
`unwrap_or_else(|| compute())`?

- A. None — the closure form is just style
- *B. `unwrap_or` evaluates `compute()` always; `unwrap_or_else` only on `None`
- C. `unwrap_or_else` is slower because of the closure call
- D. `unwrap_or` takes `Fn`, `unwrap_or_else` takes `FnOnce`

@why
Arguments are evaluated before the call, so `unwrap_or(compute())` runs
`compute()` whether or not the `Option` is `Some`. Wrapping the work in a closure
defers it: `unwrap_or_else` calls it only on the `None` path.

That is the general point of taking a closure rather than a value — laziness. C
is wrong in practice: the closure is zero-sized and monomorphised, so the call
inlines away entirely.

## 14

`v.iter().map(f)` requires `f: FnMut`. Why not `Fn`?

- A. Because `map` needs to mutate the elements
- *B. Because `map` calls `f` once per element and `FnMut` lets `f` keep state
- C. Because `Fn` closures cannot be passed to generic functions
- D. Because the iterator itself is mutable

@why
`FnMut` is the weaker bound of the two, so asking for it accepts strictly more
closures — including every `Fn` closure, since `Fn` implies `FnMut`. It lets you
write `map` with a running counter or an accumulator without `map` having to care.

A misreads which side mutates: `f` may mutate its own captures, not the elements.
The general rule for your own APIs is to demand the weakest bound that works —
`FnOnce` if you call at most once, `FnMut` if you call repeatedly, `Fn` only if
you need several callers at once.

## 15

What does `Box<dyn Fn(i32) -> i32>` cost compared with `impl Fn(i32) -> i32`?

- A. Nothing — both are static dispatch
- *B. One heap allocation and one indirect call that cannot be inlined
- C. A reference count update on every call
- D. It is faster, because the code is not duplicated per closure type

@why
`Box<dyn Fn>` is a **trait object**: a pointer to the closure's struct on the
heap, plus a vtable pointer to its `call`. Each invocation goes through the
vtable, so the optimiser cannot see the body and cannot inline it.

D is not simply wrong — dynamic dispatch does avoid monomorphisation, so it can
mean less code and better instruction-cache behaviour when there are many
distinct closure types. It is a genuine trade rather than a straight loss. Take
`impl Fn` by default, and reach for `Box<dyn Fn>` when you need several different
closures behind one type.
