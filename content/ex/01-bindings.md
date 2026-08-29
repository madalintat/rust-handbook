---
unit: 01-bindings
---

## 1. The counter that will not count

@kind fix
@concept mut

@expect E0384

A retry counter that never gets past its declaration. The arithmetic is right,
the types are right, and the compiler refuses anyway — because of what was left
off one line.

```starter
pub fn run() -> u32 {
    let attempts = 0;
    attempts = attempts + 1;
    attempts = attempts + 1;
    attempts
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_two_attempts() {
        assert_eq!(run(), 2);
    }
}
```

```solution
pub fn run() -> u32 {
    let mut attempts = 0;
    attempts += 1;
    attempts += 1;
    attempts
}
```

@hint A `let` binding is immutable unless it says otherwise. This one does not say otherwise.
@hint `let mut attempts = 0;` — one keyword, at the declaration rather than at the assignment.

@diagnose E0384
`cannot assign twice to immutable variable attempts`. Two underlines tell the
story: the first is on `let attempts = 0`, labelled *first assignment*, and the
second is on the line that tried to write again.

The wording matters. Rust does not say "this variable is read-only"; it says you
already assigned it once. A `let` binding may be written exactly once, which is
why deferred initialisation — `let x;` then `x = ...` on each branch — is legal
without `mut`. What `mut` buys is the second write and every one after it.

The suggestion rustc prints is the fix: `consider making this binding mutable`.
Note where it points — at the declaration, not at the assignment. Mutability is
a property of the binding.

@after
`attempts += 1` and `attempts = attempts + 1` compile to the same thing here;
the first is idiomatic. Neither is possible without `mut`.

Worth trying: make the solution `let mut` and then delete one of the `+= 1`
lines so the binding is only ever written once. You get
`variable does not need to be mutable`, a warning, not an error. The compiler
polices `mut` in both directions, because an unnecessary `mut` is a false
signal to whoever reads the function next.

## 2. Lending something you do not own mutably

@kind fix
@concept mut

@expect E0596

`bump` is correct and unchanged. The problem is entirely at the call site, and
the error names a *borrow* rather than an assignment — worth reading closely,
because it is the shape you will meet most often.

```starter
pub fn bump(counter: &mut u32) {
    *counter += 1;
}

pub fn run() -> u32 {
    let hits = 0;
    bump(&mut hits);
    bump(&mut hits);
    hits
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bumps_twice() {
        assert_eq!(run(), 2);
        let mut n = 41;
        bump(&mut n);
        assert_eq!(n, 42);
    }
}
```

```solution
pub fn bump(counter: &mut u32) {
    *counter += 1;
}

pub fn run() -> u32 {
    let mut hits = 0;
    bump(&mut hits);
    bump(&mut hits);
    hits
}
```

@hint `&mut hits` is a request for permission that `hits` was never granted.
@hint Do not touch `bump`. The word missing is on the `let` line in `run`.

@diagnose E0596
`cannot borrow hits as mutable, as it is not declared as mutable`.

Separate the two things that must both be true before anything can be written.
The binding must permit mutation — that is `let mut`. And the access must be
unique — that is `&mut`. Here the second was requested and the first was never
granted, so the borrow is refused.

This is why the error appears at `bump(&mut hits)` and the fix appears four
characters into a different line. rustc's suggestion points at the declaration,
because that is where the permission lives. The type `u32` is not involved at
all: there is no such thing as a `mut u32`.

@after
The general rule, which you will use constantly: **`mut` is a property of the
binding, not of the type.** A value can be immutable in one scope and mutable in
the next without changing type:

```rust
fn shout(mut s: String) -> String { s.push('!'); s }

let greeting = String::from("hi");   // immutable here
let loud = shout(greeting);          // mutable in there
```

Ownership moved and the new owner declared a different intent. Nothing about the
`String` itself is mutable or immutable.

## 3. A string that has to become a number

@kind fix
@concept shadowing

@expect E0277

A port arrives as text with whitespace around it, and the rest of the function
needs it as a number. Somebody tried to reuse the binding by assigning to it.

Assignment cannot do this. Something else can — and it does not need `mut`.

```starter
pub fn run() -> u32 {
    let mut port = "  8080  ";
    port = port.trim().parse().unwrap();
    port + 1
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn returns_the_next_port() {
        assert_eq!(run(), 8081);
    }
}
```

```solution
pub fn run() -> u32 {
    let port = "  8080  ";
    let port: u32 = port.trim().parse().unwrap();
    port + 1
}
```

@hint Assignment can change a binding's value. It can never change its type — the type was fixed when the binding was created.
@hint Introduce a *second* binding with the same name: `let port: u32 = port.trim().parse().unwrap();`. The annotation is what tells `parse` which type to produce.

@diagnose E0277
`the trait bound &str: FromStr is not satisfied`. This looks like a complaint
about `parse` and is really a complaint about the assignment.

`parse::<T>()` produces whatever `T` you ask for, and here the target was chosen
by the left-hand side: `port` is a `&str`, so the compiler asked for
`parse::<&str>()` and then discovered that `&str` does not implement `FromStr`.
The type on the left drove the inference on the right.

That is the mechanism worth taking away. A binding's type is fixed at its `let`.
Assignment must supply that exact type forever after, so no assignment can ever
turn a `&str` binding into a `u32` one. Shadowing can, because it is not an
assignment at all.

@diagnose E0369
`cannot add {integer} to &str`. The same root cause seen from the last line:
`port` is still a `&str`, so `port + 1` has no meaning. `+` is the `Add` trait,
and `&str` implements it only for another string. Fix the binding and this line
stops complaining on its own.

@diagnose E0308
`expected u32, found &str`. Reported against the function's return type: the
tail expression is still a string because the assignment never changed the
binding's type. Again, one cause, several symptoms.

@after
Shadowing is not mutation and it is worth being precise about the difference.
`let port: u32 = ...` creates a **new binding** that happens to reuse the name.
The old `&str` still exists — it is what the right-hand side just read — and it
is dropped at the end of the scope like any other value. It is simply no longer
reachable by that name.

This is exactly what shadowing is for. The alternative is inventing `port_str`
and then keeping the two apart by hand for the rest of the function. Shadowing
removes the intermediate form from the namespace, which is the whole point.

## 4. The branch that assigned nothing

@kind fix
@concept scope

@expect E0381

`label` is declared without a value and filled in by whichever branch runs.
That is legal Rust and it is not what is wrong here.

The compiler has checked every path through the function and found one that
reaches the last line having written nothing.

```starter
pub fn classify(n: i32) -> &'static str {
    let label;

    if n < 0 {
        label = "negative";
    } else if n > 0 {
        label = "positive";
    }

    label
}

pub fn run() -> [&'static str; 3] {
    [classify(-2), classify(0), classify(7)]
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn covers_every_sign() {
        assert_eq!(run(), ["negative", "zero", "positive"]);
    }
}
```

```solution
pub fn classify(n: i32) -> &'static str {
    let label;

    if n < 0 {
        label = "negative";
    } else if n > 0 {
        label = "positive";
    } else {
        label = "zero";
    }

    label
}

pub fn run() -> [&'static str; 3] {
    [classify(-2), classify(0), classify(7)]
}
```

@hint Two branches are written. How many are there?
@hint `n` can be negative, positive, or exactly zero — and the third case falls off the end of the `if` chain with `label` still unwritten.

@diagnose E0381
`used binding label isn't initialized` — or, on a partial path,
*possibly-uninitialized*. The word *possibly* is the interesting one: the
compiler is not saying every run is broken, it is saying it found at least one
route through the function where nothing was assigned.

An `if` chain with no `else` has an implicit empty `else`. Take it: `n == 0`
enters neither branch, falls through, and reads `label`.

There is no default value to fall back on. No zero, no null, no empty string —
a binding that has not been written on a path cannot be read on that path, full
stop. That is why Rust needs no null: the situation null exists to represent is
a compile error instead.

@after
Deferred initialisation is genuinely useful, and it is tracked per path rather
than per binding, so assigning in each arm is fine without `mut`. The binding is
still written exactly once on every route.

That said, the shape below is usually better, because it makes exhaustiveness
the compiler's problem rather than yours:

```rust
let label = if n < 0 { "negative" } else if n > 0 { "positive" } else { "zero" };
```

An `if` used as an expression must produce a value on every branch, so a missing
`else` becomes a type error at the `let` rather than a use-before-init further
down. Same guarantee, caught earlier and read more easily.

## 5. A constant the compiler cannot work out

@kind fix
@concept constant evaluation

@expect E0015

The padding width is computed by a function, and `PAD` wants that number at
compile time so it can be baked into every use site.

The function is trivially computable. That is not enough — something has to say
so.

```starter
pub fn slot_width() -> usize {
    4
}

pub const PAD: usize = slot_width();

pub fn cell(s: &str) -> String {
    format!("{:>width$}", s, width = PAD)
}

pub fn run() -> String {
    cell("hi")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pads_to_four() {
        assert_eq!(run(), "  hi");
        assert_eq!(slot_width(), 4);
    }
}
```

```solution
pub const fn slot_width() -> usize {
    4
}

pub const PAD: usize = slot_width();

pub fn cell(s: &str) -> String {
    format!("{:>width$}", s, width = PAD)
}

pub fn run() -> String {
    cell("hi")
}
```

@hint The test still calls `slot_width()` at runtime, so you cannot delete it or inline the 4.
@hint There is a keyword that marks a function as runnable by the compiler as well as at runtime. It goes before `fn`.

@diagnose E0015
`cannot call non-const function slot_width in constants`.

A `const` initialiser is executed by an interpreter inside rustc while the crate
is being compiled, so everything it touches has to be something that interpreter
is permitted to run. An ordinary `fn` is not — not because this one does
anything difficult, but because nothing in its signature promises it never will.
The compiler will not infer const-ness from a body, exactly as it will not infer
an item's type from one.

`const fn` is that promise. Marking it changes nothing about how the function
behaves at runtime; it adds a restriction on what the body may contain, and in
exchange the function becomes callable from a `const`, a `static`, and an array
length.

@after
`const fn` is a normal function with a narrower body. It may do arithmetic,
call other `const fn`s, branch and loop. It may not allocate, take a trait
object, or call anything that is not itself `const`.

The payoff is that computation moves from every run of the program to one run of
the compiler. Array sizes, lookup tables, bit masks and protocol constants can
all be derived rather than written out by hand, and the derivation costs nothing
at runtime — the binary contains only the answer.

If you export a `const fn` from a library, be aware you have promised more than
usual: making a public `const fn` non-const later is a breaking change.

## 6. The shadow that did not escape

@kind fix
@concept shadowing

@expect E0369

The parse is correct. The type annotation is correct. The value is even computed
successfully — and then the last line still sees a string.

Look at where the shadowing binding was introduced, and what happens at the
closing brace.

```starter
pub fn run() -> u32 {
    let level = "3";

    {
        let level: u32 = level.parse().unwrap();
    }

    level * 2
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn doubles_the_parsed_level() {
        assert_eq!(run(), 6);
    }
}
```

```solution
pub fn run() -> u32 {
    let level = "3";
    let level: u32 = level.parse().unwrap();

    level * 2
}
```

@hint A block is a scope. Ask what is still alive after its closing brace.
@hint The `u32` binding needs to exist in the same scope as the line that uses it. Drop the braces.

@diagnose E0369
`cannot multiply &str by {integer}`. The compiler is looking at `level` on the
last line and seeing a `&str`, which means the `u32` binding is not the one in
scope there.

Shadowing follows scope like any other binding. The `let level: u32` inside the
block introduced a name that lived from that line to the closing brace and then
went out of scope, restoring the outer `level` — the `&str` — as the meaning of
the name. Nothing was mutated and nothing leaked out.

That constraint is what makes shadowing safe rather than confusing. A shadow can
only ever narrow: it hides an outer name inside one region and cannot alter
anything outside it. If it *could* escape, `let` would be indistinguishable from
assignment, and reading a function would mean tracking every block.

@diagnose E0308
`expected u32, found &str`, reported against the return type. Same cause: the
tail expression's type is decided by whichever `level` is in scope, and after
the block that is the string.

@after
Blocks are also expressions, which gives you the deliberate version of what was
attempted here:

```rust
let level: u32 = {
    let raw = "3";
    raw.parse().unwrap()
};
```

The block's final expression without a semicolon is its value, so the temporary
`raw` is scoped to the computation and the result lands in the outer binding.
Use this when a value needs several lines to build but the intermediates have no
business surviving.

## 7. One character of guard

@kind fix
@concept underscore

@expect E0425

`Guard` writes to the log when it is dropped, which makes the invisible
visible — you can see exactly when it was released.

The test says the guard must still be held while the middle line runs. Right now
it is not, and the reason is a single character.

```starter
use std::cell::RefCell;
use std::rc::Rc;

pub struct Guard(pub &'static str, pub Rc<RefCell<Vec<String>>>);

impl Drop for Guard {
    fn drop(&mut self) {
        self.1.borrow_mut().push(format!("release {}", self.0));
    }
}

pub fn run() -> Vec<String> {
    let log = Rc::new(RefCell::new(Vec::new()));

    {
        let _ = Guard("lock", log.clone());
        log.borrow_mut().push(format!("holding {}", _guard.0));
    }

    let out = log.borrow().clone();
    out
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn holds_until_the_block_ends() {
        assert_eq!(run(), vec![
            "holding lock".to_string(),
            "release lock".to_string(),
        ]);
    }
}
```

```solution
use std::cell::RefCell;
use std::rc::Rc;

pub struct Guard(pub &'static str, pub Rc<RefCell<Vec<String>>>);

impl Drop for Guard {
    fn drop(&mut self) {
        self.1.borrow_mut().push(format!("release {}", self.0));
    }
}

pub fn run() -> Vec<String> {
    let log = Rc::new(RefCell::new(Vec::new()));

    {
        let _guard = Guard("lock", log.clone());
        log.borrow_mut().push(format!("holding {}", _guard.0));
    }

    let out = log.borrow().clone();
    out
}
```

@hint The next line names `_guard`. Nothing in the function ever created it.
@hint `_` is not a name. Give the guard a real one — `_guard` — and both problems disappear at once.

@diagnose E0425
`cannot find value _guard in this scope`, and the value is right there on the
line above. Except it is not: `let _ = ...` does not create a binding of any
kind.

Bare `_` is a pattern that matches anything and stores nothing. Nothing is
bound, so nothing owns the `Guard`, so it is dropped **immediately** — on that
line, before the next one runs. Had the reference to `_guard` not been an error,
the log would have read `release lock` first and `holding lock` second, and the
test would have failed for a reason far harder to see.

`_guard`, with a name, is an ordinary binding. The leading underscore only tells
rustc you know it is unused and do not want the warning.

@after
This is one of the very few one-character bugs in Rust that compiles cleanly and
is silently wrong:

```rust
let _ = mutex.lock();        // locked and unlocked. On this line.
let _guard = mutex.lock();   // held to the end of the scope.
```

Both compile. Only one of them takes a lock in any useful sense. The same trap
catches file handles, tracing spans, profiling timers and transaction guards —
anything whose entire purpose is its `Drop`.

The rule to carry: if a value matters because of *when it is destroyed*, it
needs a name. `let _ = ...` is for the opposite job — deliberately discarding a
`#[must_use]` result you have chosen to ignore.

## 8. A global that two threads could race

@kind fix
@concept static

@expect E0133

A hit counter as a `static mut`. It is the obvious translation of a C global,
the compiler refuses to let you touch it, and the refusal is the entire point of
the language.

Keep one counter shared by the whole program. Make the compiler agree it is
safe. Do not use `unsafe`.

```starter
pub static mut HITS: u32 = 0;

pub fn hit() -> u32 {
    HITS += 1;
    HITS
}

pub fn hits() -> u32 {
    HITS
}

pub fn run() -> u32 {
    hit();
    hit();
    hit()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_three_hits() {
        assert_eq!(run(), 3);
        assert_eq!(hits(), 3);
    }
}
```

```solution
use std::sync::atomic::{AtomicU32, Ordering};

pub static HITS: AtomicU32 = AtomicU32::new(0);

pub fn hit() -> u32 {
    HITS.fetch_add(1, Ordering::Relaxed) + 1
}

pub fn hits() -> u32 {
    HITS.load(Ordering::Relaxed)
}

pub fn run() -> u32 {
    hit();
    hit();
    hit()
}
```

@hint A `static` is fine. `static mut` is the problem — you need a type that can be modified through a shared reference safely.
@hint `std::sync::atomic::AtomicU32` does exactly that. `AtomicU32::new(0)` is a `const` constructor, so it is legal as a static's initialiser.
@hint `HITS.fetch_add(1, Ordering::Relaxed)` returns the value *before* the add; `HITS.load(Ordering::Relaxed)` reads it.

@diagnose E0133
`use of mutable static is unsafe and requires unsafe function or block`.

A `static` is one memory location for the whole program, reachable from every
thread. A `static mut` is therefore a shared mutable location with no
synchronisation at all: two threads incrementing it race, the read-modify-write
interleaves, and counts are lost. That is undefined behaviour, not merely a
wrong number.

So every access is `unsafe` — reads included, because a read racing a write is
just as broken. The compiler is not asking you to prove the code is correct; it
is asking you to take responsibility for a guarantee it cannot check. In the
2024 edition it is stricter still: even taking a reference to a `static mut` is
rejected outright.

@after
The fix is not a workaround. `AtomicU32` provides exactly what `static mut`
lacked — a read-modify-write the hardware performs indivisibly — and once the
type is safe to share, the `unsafe` requirement disappears. The pattern
generalises: `Mutex<T>` or `RwLock<T>` for anything bigger, `OnceLock<T>` for a
value initialised once and then only read.

The mechanism underneath is a trait called `Sync`, meaning "safe to reference
from several threads at once". Every `static`'s type must be `Sync`; `u32` is,
but a `u32` behind a mutable global is not being used in a `Sync` way, which is
why the language routes that case through `unsafe`. Unit 21 picks this up
properly.

Note the last detail worth keeping: `fetch_add` returns the *previous* value,
which is why the solution adds one to it. Atomics hand back what was there
before, so that two threads incrementing at once each get a distinct answer.
