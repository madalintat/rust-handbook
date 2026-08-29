---
num: 6
slug: 06-borrowing
title: Borrowing and references
accent: ferris
concepts: borrow, reference, shared reference, mutable reference, aliasing, data race, non-lexical lifetimes, reborrow, split borrow, iterator invalidation, dangling reference
needs: 05-ownership
blurb: Shared or unique, never both. The rule that makes data races a compile error rather than a Tuesday.
---

%% Ownership answered *who frees this*. It left a question behind: how does a function read a value without taking it? Handing ownership back and forth works and reads terribly, and cloning pays the allocator to avoid a conversation. The answer is to lend, and the rules for lending are the smallest, strangest and most valuable idea in the language.

One rule does all the work here, and it is worth stating before anything else.

## A reference is permission

### Lending instead of giving

```rust
fn line_count(text: &str) -> usize {
    text.lines().count()
}

let doc = std::fs::read_to_string("notes.md")?;
let n = line_count(&doc);      // lent, not given
println!("{doc}");             // still ours
```

`&doc` creates a **reference**. `line_count` reads through it, and cannot drop
it, free it, or keep it past the call. It never owned anything.

:::note
There are exactly two kinds.

`&T` is a **shared reference**. Any number may exist at once, and every one of
them is read-only.

`&mut T` is a **mutable reference**. Better read as *unique*: while one exists,
it is the only way to reach the value at all.
:::

### What it is on the machine

```rust
let doc = String::from("hi");
let r = &doc;
```

:::memory a reference is an address
       STACK  (frame of main)                  HEAP
     ┌────────────────────────────┐          ┌───┬───┐
 doc │ ptr      ●─────────────────┼─────────▶│ h │ i │
     │ len      2                 │          └───┴───┘
     │ capacity 2                 │
     ├────────────────────────────┤
 r   │ ●──────────▲               │      r points at doc,
     └────────────┘               │      not at the buffer
:::

Eight bytes, and the machine code is exactly the pointer you would have written
in C. There is no allocation behind it, no reference count, no header and no
check at run time. All of the work happens in the compiler.

Because a reference owns nothing, duplicating one duplicates only an address, so
**`&T` is `Copy`**. That is why a `&str` can be passed to five functions in a row
without a single complaint: each call copies the address and the original stays
where it was.

`&mut T` is *not* `Copy`, and it could not be. Copying one would produce two
unique references, which is a contradiction in terms.

## The rule

### Shared XOR unique

:::note
At any point in a program, for any value, you may have **either** any number of
`&T` **or** exactly one `&mut T`. Never both.
:::

That is the whole borrow checker. Everything else in this unit is a consequence
of it or a way of living with it.

### Why it is exactly the data-race condition

A data race needs three things at once: two accesses to the same memory, one of
them at least a write, with no synchronisation between them. Drop any one and
the race is gone.

| access A | access B | is it a problem? | can the rule express it? |
|---|---|---|---|
| read | read | no | many `&T`: allowed |
| read | write | yes | `&T` plus `&mut T`: rejected |
| write | write | yes | two `&mut T`: rejected |

The rule permits precisely the first row. It is not an approximation of
thread-safety that happens to work; **aliasing** plus mutation is the same
condition in one thread as in two. A single-threaded iterator invalidation and a
two-threaded data race are the same bug, and one rule catches both.

That is why Rust's concurrency story is short: nothing extra was added for
threads. The rule that stops you invalidating your own iterator is the rule that
stops two threads writing one `Vec`.

:::compare
**C++.** `const T&` looks like `&T` and is a different promise entirely. It says
*I will not write through this handle*; it says nothing about anyone else. A
`const std::string&` parameter can be modified during the call by any other
reference to the same string, and the language considers this fine.

**Go, Java, Python.** Every reference is shared and mutable, so both bad rows
are ordinary and permitted. Safety is bought back at run time: a collector, a
`ConcurrentModificationException`, a global interpreter lock.
:::

## Where the rule bites

### E0502: a shared borrow, then a write

```rust,bad
let mut log = vec![String::from("boot")];
let first = &log[0];              // shared borrow of log starts
log.push(String::from("ready"));  // needs &mut log
println!("{first}");              // shared borrow still in use
```

`error[E0502]: cannot borrow log as mutable because it is also borrowed as
immutable`. This is not pedantry about who wrote what. `push` may find the
vector full, ask the allocator for a bigger buffer, copy the elements across and
free the old one. `first` points into the old one.

:::memory what push can do to a live reference
     BEFORE                         AFTER a reallocating push
     ┌───┬───┬───┐                  ┌───┬───┬───┬───┬───┬───┐
     │ b │   │   │ ◀── first        │ b │ r │   │   │   │   │ ◀── log.ptr
     └───┴───┴───┘                  └───┴───┴───┴───┴───┴───┘
       ▲ log.ptr                      old buffer freed
                                      first ──▶ ✗ dangling
:::

### The C++ version of the same program

```cpp
std::vector<std::string> log{"boot"};
const std::string &first = log[0];
log.push_back("ready");            // may reallocate
std::cout << first;                // undefined behaviour
```

:::compare
That C++ compiles without a warning, and on a small vector it usually *works*.
Then comes the day the capacity happens to be exhausted at exactly that push, in
production, under load. The bug is real, silent, load-dependent and famous
enough to have a name: **iterator invalidation**. Every C++ container documents
which operations invalidate which iterators, and remembering that table is the
programmer's job.

Rust deletes the table. `push` takes `&mut self`, `first` is a live `&`, and the
two cannot coexist. Same program, compile error, zero run-time cost.
:::

### E0499: two unique borrows

```rust,bad
let a = &mut config;
let b = &mut config;   // error[E0499]: cannot borrow `config` as mutable more than once
a.retries = 3;
b.retries = 5;
```

Two writers, no ordering. Even single-threaded this makes optimisation unsound:
a `&mut` is guaranteed to be the only route to that memory, which is what lets
the compiler keep a value in a register across a call.

### E0505: you cannot move out from under a borrow

```rust,bad
let s = String::from("ferris");
let r = &s;
let owned = s;          // error[E0505]: cannot move out of `s` because it is borrowed
println!("{r}");
```

Moving `s` transfers the buffer to `owned` and retires `s`. `r` would be left
pointing at a dead binding. This is the seam where unit 05 meets this one: a
value cannot move while anything is watching it.

## Non-lexical lifetimes

### A borrow ends at its last use

This is the single most important thing to know about the borrow checker, and it
is why old tutorials show errors you will not get.

```rust
let mut names = vec![String::from("ada")];

let first = &names[0];
println!("{first}");              // last use of `first`: the borrow ends HERE

names.push(String::from("grace")); // fine
```

This is **non-lexical lifetimes**: a borrow's region runs from where it is
created to its **last use**, not to the end of the enclosing block. `first` is
still in scope on the `push` line. It is simply not borrowed any more.

:::memory the region of a borrow
     let mut names = ...;
     let first = &names[0];   ┐
     println!("{first}");     ┘  borrow region: 2 lines
     names.push(...);            names is free again here
     println!("{names:?}");
:::

Before Rust 2018 the region ran to the end of the scope, and the fix for this
program was to wrap the borrow in `{ }`, a block that existed only to appease
the compiler. That change removed a large fraction of everyday borrow-checker
friction, so it is worth checking the date on any advice that tells you to add
braces.

:::gotcha
"Last use" is computed on the control-flow graph, not by reading down the page.
A borrow used inside a loop is live across the whole loop, including the jump
back to the top. That is why a loop can complain about code that reads perfectly
well once it is straightened out.
:::

## Reborrowing

```rust
fn bump(counter: &mut u32) {
    *counter += 1;
}

fn bump_twice(counter: &mut u32) {
    bump(counter);      // not a move, a reborrow
    bump(counter);      // so this still works
}
```

`&mut u32` is not `Copy`, so passing `counter` to `bump` ought to move it and
break the second line. It does not, because the compiler inserts an implicit
`&mut *counter`. That is a **reborrow**: a fresh, shorter unique borrow *through*
the existing one. The original is frozen for its duration and usable again after.

Uniqueness survives, because at any moment exactly one of the two is usable.

:::gotcha
The reborrow is only inserted when the target type is known to be a reference.
Push a `&mut` into a struct field or a `Vec` and it moves for real:

```rust,bad
fn stash(slot: &mut Vec<&mut u32>, c: &mut u32) {
    slot.push(c);
    *c += 1;            // error[E0499]: `c` was moved into the vector
}
```

`reborrow` is the word to search for when a `&mut` mysteriously disappears.
:::

## The field-level borrow split

This is the frustration people actually hit, and the resolution is worth the
detour.

### Two fields at once is fine

```rust
struct Editor {
    buffer: String,
    log: Vec<String>,
}

let mut ed = Editor { buffer: String::new(), log: Vec::new() };

let b = &mut ed.buffer;
let l = &mut ed.log;      // fine: different fields, disjoint memory
b.push_str("hello");
l.push("typed".into());
```

This is a **split borrow**, and it works because the borrow checker tracks
**paths** rather than whole variables. `ed.buffer` and `ed.log` are disjoint, so
a unique borrow of each is two unique borrows of two different things. No rule
is broken.

### Through a method, it is not

```rust,bad
impl Editor {
    fn buffer_mut(&mut self) -> &mut String { &mut self.buffer }
    fn log_mut(&mut self) -> &mut Vec<String> { &mut self.log }
}

let b = ed.buffer_mut();
let l = ed.log_mut();     // error[E0499]: cannot borrow `ed` as mutable more than once
b.push_str("hello");
```

Nothing about the data changed. What changed is what the compiler is allowed to
know. A method signature says `&mut self`, meaning the *whole* struct, and the
checker works from signatures alone, never from bodies. As far as the second call is
concerned, `buffer_mut` might have borrowed anything at all.

:::memory what the checker sees
     direct fields                    through methods
     ┌──────────────┐                 ┌──────────────┐
     │ buffer  ◀─ b │  two disjoint   │              │
     ├──────────────┤  paths          │  all of ed   │ ◀─ b   one path,
     │ log     ◀─ l │                 │              │ ◀─ l   claimed twice
     └──────────────┘                 └──────────────┘
:::

This is deliberate: it is what makes a signature a real contract. Change a
method's body and no caller can break, because none ever depended on it.

### The four ways out

1. **Borrow the fields directly.** `&mut ed.buffer`, not `ed.buffer_mut()`. Free, and usually the honest answer inside the type's own `impl`.
2. **Destructure once.** `let Editor { buffer, log } = &mut ed;` gives you a `&mut` to each field, all disjoint, all at once.
3. **Take what you need as arguments.** A free function `fn append(buf: &mut String, log: &mut Vec<String>)` states its disjointness in its signature, so callers can satisfy it.
4. **Split the struct.** Two fields that are never used together are two structs. Fighting this for an hour usually means the type is doing two jobs.

Slices ship a fifth: `split_at_mut` returns two `&mut` halves of one slice,
`unsafe` inside, asserting a disjointness the checker cannot infer from
indices.

## Dangling references cannot happen

```rust,bad
fn greeting() -> &String {
    let s = String::from("hello");
    &s
}                   // s dropped here; the returned reference would point at nothing
```

`error[E0106]: missing lifetime specifier`. The compiler is asking a question
with no answer: *this reference borrows from what?* The only candidate dies at
the closing brace.

The fix is to return the `String`; a caller wanting a reference can take one of
its own value, which by construction outlives it.

Put the rules together and the guarantee is total:

- a reference cannot outlive what it points at (checked)
- a value cannot move while borrowed (E0505)
- a value cannot be freed while borrowed (drop is a move)
- a value cannot be mutated through one path while read through another (E0502, E0499)

In safe Rust no combination is left that produces a dangling pointer, a
use-after-free, or a data race. A garbage collector never enters into it, and
none of the checking survives into the running program.

:::note
**The habit.** A borrow error is a question about *time*, not about syntax. Ask
when each borrow starts and where it is last used. Nine times in ten the fix is
to move a line, shorten a borrow, or reach for the field instead of the method.
`clone()` is the last resort, and `unsafe` is not a resort at all.
:::
