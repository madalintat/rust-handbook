---
num: 5
slug: 05-ownership
title: Ownership
accent: ferris
concepts: move, drop, Copy, Clone, ownership, RAII, double free, use after free
needs: 01-bindings, 03-expressions
blurb: One owner, one drop. What a move actually copies, what it does not, and which bug the whole rule exists to prevent.
---

%% Every language answers one question: when is it safe to free this memory? C makes you answer by hand and punishes mistakes. Java and Python refuse to answer and pay a collector to keep asking. Rust answers at compile time, for free — and the price is that you say who owns what.

Three bullet points on a slide will not get you there. The machine underneath them will.

## The bug this exists to prevent

### One buffer, two owners

```c
void takes(char *s) {
    printf("%s\n", s);
    free(s);              // this function frees what it got
}

int main(void) {
    char *s = malloc(3);
    strcpy(s, "hi");
    takes(s);
    printf("%s\n", s);    // use after free
    free(s);              // double free
}
```

Compiles clean. Might even print `hi` twice — the worst outcome, because then it
ships.

The root cause is neither bad line. It is that after `takes(s)` there were **two
pointers to one buffer and no agreement about which was responsible**. Both
believed they were. Both acted on it.

| | what it is | why it is bad |
|---|---|---|
| **use after free** | reading memory already returned to the allocator | the allocator may have handed it to something else |
| **double free** | returning the same block twice | corrupts the allocator's bookkeeping; a classic exploit foothold |

### The two usual fixes

**Write it in a comment.** "`takes` takes ownership, don't touch `s` after." This
is what large C codebases actually do, and it works exactly as well as any rule
enforced by people remembering it on a Friday evening.

**Stop freeing until a collector proves nobody is looking.** Java, Python, Go,
C#. It genuinely works, and you pay a runtime, unscheduled pauses, and a memory
ceiling well above what the program holds. Fine for most programs. Not available
in a kernel, a game engine, or on a microcontroller.

### Rust's answer

Rust takes the comment and moves it into the type system, where it is checked
rather than remembered.

:::note
Every value has one **owner**. When the owner goes out of scope, the value is
dropped. Ownership can be given away — a **move** — and afterwards the old
binding is statically dead: naming it is a compile error.
:::

```rust,bad
fn takes(s: String) {
    println!("{s}");
}                       // s dropped here, buffer freed

fn main() {
    let s = String::from("hi");
    takes(s);           // ownership moves in
    println!("{s}");    // error[E0382]: borrow of moved value: `s`
}
```

Notice what got caught: not the `free` — there is no `free` to get wrong. The
**read**, at compile time, before the program ran.

:::compare
**C++** — this is `unique_ptr` promoted to the whole language, with the hole
closed. A moved-from `unique_ptr` is left null and using it is legal, so your bug
becomes a runtime null deref. A moved-from binding in Rust is *unnameable*.

**Python / Java** — the shock is that `b = a` does not always mean both names see
the object. Sometimes it means the second has it and the first is gone.
:::

## What a value actually is

### Three words and a buffer

The stack holds fixed-size things and is freed by a register subtract. A
user-typed string is not fixed-size, so its contents go on the heap and the stack
holds a handle.

:::memory let s = String::from("hi")
       STACK  (frame of main)                HEAP
     ┌───────────────────────────┐         ┌───┬───┐
 s   │ ptr      ●────────────────┼────────▶│ h │ i │
     │ len      2                │         └───┴───┘
     │ capacity 2                │
     └───────────────────────────┘
     24 bytes, whether the string
     holds 2 chars or 2 million
:::

That split is why ownership needs rules. **The three words are trivially
copyable — they are just numbers. The buffer is not.** Copy the words without
copying the buffer and you have two handles to one allocation: the C bug,
rebuilt.

| | lives | duplicating it costs |
|---|---|---|
| `i32` `bool` `char` `f64` | stack | nothing — it *is* the value |
| `[u8; 16]` | stack | 16 bytes |
| `&T` | stack | nothing — an address |
| `String` `Vec<T>` `Box<T>` | handle on stack, contents on heap | a heap allocation and a copy |

That last row is where moves happen.

## Moving

### A move copies 24 bytes, not the string

:::note
A move copies the **handle**, bit for bit. No allocation, no user code, no heap
traffic. Moving a `String` is a 24-byte `memcpy` — and the optimiser usually
removes even that.
:::

```rust
let a = String::from("hi");
let b = a;               // 24 bytes. That is all.
```

:::memory after let b = a
       STACK                                  HEAP
     ┌───────────────────────────┐          ┌───┬───┐
 a   │ ptr      ●  ✗ dead        │     ┌───▶│ h │ i │
     │ len      2                │     │    └───┴───┘
     │ capacity 2                │     │
     ├───────────────────────────┤     │    ONE buffer. Still one.
 b   │ ptr      ●────────────────┼─────┘
     │ len      2                │
     │ capacity 2                │
     └───────────────────────────┘
:::

`a`'s bytes are physically still there. Nothing scrubbed them. The compiler
simply marked `a` moved-from and will not let you name it — bookkeeping that
costs nothing at runtime because it does not exist at runtime.

Moves are cheap. People write `clone()` everywhere to dodge a cost that was never
there; `clone` is the one that actually calls the allocator.

### Why the old binding has to die

If both `a` and `b` stayed live, both would drop at end of scope, and both drops
would free the same buffer. So the compiler picks one. New binding wins.

One owner, one drop, no runtime check.

### Moves in disguise

No `move` keyword appears in any of these:

```rust
let b = a;                    // assignment
takes(a);                     // by-value argument
let a = returns();            // by-value return
let pair = (a, b);            // building a tuple
let w = Wrapper { inner: a }; // building a struct
v.push(a);                    // pushing into a collection
for x in v { }                // iterating by value consumes v
match a { s => s }            // binding by value in a pattern
```

**If a non-`Copy` value is used somewhere that needs it by value, it moves.**

:::gotcha
Iterating has three forms and only one of them consumes:

```rust
for x in v      { }   // moves v,  yields T
for x in &v     { }   // borrows,  yields &T
for x in &mut v { }   // borrows uniquely, yields &mut T
```
:::

:::gotcha
The most common beginner error in the language:

```rust,bad
let s = String::from("hi");
for _ in 0..3 {
    let n = s.into_bytes();   // into_* takes self — s is gone
}                             // iteration 2: nothing left
```

The receiver is in the name. `as_*` borrows, `to_*` clones, `into_*` consumes.
Reading that convention saves you weeks.
:::

## Copy: the types that do not move

```rust
let a = 5;
let b = a;
println!("{a} and {b}");   // fine
```

`i32` is **Copy**: duplicating its four bytes produces a genuinely complete second
value, so both bindings stay live. There is no shared buffer to argue over.

### Why String can never be Copy

Run it yourself: if `String` were `Copy`, `let b = a;` leaves both live → two
owners → two drops → double free.

So it cannot be, and this is structural rather than a preference — **`Copy`
requires `Clone` and forbids `Drop`**. A type with a destructor cannot be
silently duplicated. That rules out `Vec<T>`, `Box<T>`, `HashMap`, `File`, and
everything else holding a resource.

:::note
**A type is `Copy` only if it owns nothing needing cleanup.** Integers, floats,
`bool`, `char`, `&T`, and arrays and tuples built entirely from those.

`&T` being `Copy` is why you can pass a `&str` to five functions without a single
complaint — copying a reference copies an address, and it owns nothing.
:::

### Clone is the visible one

```rust
let a = String::from("hi");
let b = a.clone();       // new allocation, bytes copied in
println!("{a} {b}");     // both live, two buffers
```

| | when | cost |
|---|---|---|
| `Copy` | implicitly, on every assignment | a byte copy, always cheap |
| `Clone` | only where you wrote `.clone()` | whatever the type says — often an allocation |

That visibility is the point. In a language where duplication is implicit, an
accidental deep copy in a hot loop is invisible until you profile.

## Drop

### Reverse order, automatically

```rust
fn main() {
    let a = String::from("first");
    let b = String::from("second");
}   // b dropped, then a
```

No `free`, no `close`, no `finally`, no `with`, no `defer`. The compiler emits
the drops where the value is provably last owned — including on an early
`return` and on a panic unwinding through the frame.

Reverse order is not arbitrary: later bindings are the ones that depend on
earlier ones (a guard from a lock above it, a writer around a file opened
before it), so unwinding backwards is the only always-safe sequence.

### RAII, and why the double free is now impossible

A `String`'s destructor returns its buffer. A `File` closes its descriptor. A
`MutexGuard` unlocks. This is **RAII** — the resource is tied to the value's
lifetime.

Put the halves together:

- exactly one binding owns a value (moves guarantee it)
- drop runs when *the owner* leaves scope
- therefore drop runs exactly once

No collector, no reference count. The machine code has the right number of frees
in the right places — the code a careful C programmer would have written by hand.

:::gotcha
A moved-from binding is **not** dropped. That would be the double free.

Where the compiler cannot tell statically — a move inside one arm of an `if` —
it inserts a hidden boolean **drop flag** and checks it. One byte and a branch,
usually optimised away, and the entire runtime cost of ownership.
:::

:::gotcha
`let _ = x;` is **not** a binding. The value drops *immediately*, on that line.

```rust
let _ = mutex.lock();        // locked and unlocked on this line. Useless.
let _guard = mutex.lock();   // held to end of scope. What you meant.
```

One underscore. It has ended real production incidents.
:::

## Getting unstuck

Four moves, listed worst to best.

### 1. Give it back

```rust
fn takes_and_returns(s: String) -> String {
    println!("{s}");
    s
}
let s = takes_and_returns(s);
```

Works, reads badly. Two strings means returning a tuple; three and the signature
documents plumbing instead of intent.

### 2. Clone it

```rust
takes(s.clone());
```

One allocation, honest about it. Right when you genuinely need two independent
values.

### 3. Borrow it — the usual answer

```rust
fn takes(s: &str) {
    println!("{s}");
}
takes(&s);              // lend it, don't give it
println!("{s}");        // still ours
```

`takes` cannot drop what it does not own. This is the shape most Rust has, and
why most functions take `&str` and `&[T]` rather than `String` and `Vec<T>`.

### 4. Change the design

A struct whose fields are constantly moved out and put back wants different
fields. A value threaded through six layers wants to be built where it is used.
Fighting the checker for an afternoon usually means the data is shaped wrong, and
the checker is the only reviewer who noticed.

:::note
**The habit.** On an ownership error, do not start editing. Ask: *who should own
this, and for how long?*

Nine times in ten the message is a correct answer to a question you had not
asked, and the fix is one character: `&`.
:::
