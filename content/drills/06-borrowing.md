---
unit: 06-borrowing
---

## 1

Does this compile?

```rust
let mut log = vec![String::from("boot")];
let first = &log[0];
log.push(String::from("ready"));
println!("{first}");
```

- A. Yes — `first` and `log` are separate variables
- *B. No — `log` is borrowed immutably and then borrowed mutably
- C. No — you cannot index a `Vec` with `0`
- D. Yes, but `first` prints garbage

@why
`error[E0502]: cannot borrow log as mutable because it is also borrowed as
immutable`. The shared borrow starts at `&log[0]` and is still in use at the
`println!`, and `push` needs a unique borrow in between.

D describes exactly what the C++ version of these four lines does. `push` may
find the vector at capacity, allocate a bigger buffer, copy the elements across
and free the old one — leaving `first` pointing into freed memory. That version
compiles silently and usually works, until the length of your data changes.

## 2

Does this compile?

```rust
let mut log = vec![String::from("boot")];
let first = &log[0];
println!("{first}");
log.push(String::from("ready"));
```

- *A. Yes — the borrow ends at its last use
- B. No — `first` is still in scope at the `push`
- C. No — for the same reason as the previous question
- D. Only with an explicit `drop(first)` first

@why
Yes, and the only change is the order of two lines. A borrow's region runs from
where it is created to its **last use**, not to the end of the block. `first` is
still in scope at the `push`; it is simply no longer borrowed.

B and D are the pre-2018 answers, and they are why old tutorials tell you to wrap
borrows in `{ }` blocks that exist only to appease the compiler. Non-lexical
lifetimes removed a large fraction of everyday borrow-checker friction — check
the date on any advice that reaches for braces.

## 3

Does this compile?

```rust
let mut config = vec![1];
let a = &mut config;
let b = &mut config;
a.push(2);
```

- A. Yes — both are just pointers
- *B. No — only one `&mut` to a value may be live at a time
- C. No — `config` must be `static`
- D. Yes, because `b` is never used

@why
`error[E0499]: cannot borrow config as mutable more than once at a time`. Read
`&mut T` as *unique reference* rather than "mutable reference" and the error
stops being surprising: a second one is a second claim to something defined as
exclusive.

D is close to something true and lands wrong. If `a` were never used *after* `b`
was created, the first borrow would have ended and the code would compile — the
conflict is about overlap in time, not about existence. Here `a.push(2)` comes
after `let b`, so both are live at once.

## 4

Which of these are allowed at the same time, for the same value? Choose all that apply.

- *A. Three `&T`
- *B. One `&mut T`
- C. One `&T` and one `&mut T`
- D. Two `&mut T`
- *E. No references at all

@why
The whole rule: any number of shared references, **or** exactly one unique
reference, never both.

C and D are the two rejected rows, and they are exactly the two access pairs
that make a data race: read-with-write, and write-with-write. Read-with-read is
harmless and is the row that stays legal. That is why nothing extra had to be
added to the language for threads — the rule that stops you invalidating your own
iterator is the rule that stops two threads writing one `Vec`.

## 5

On a 64-bit machine, what is `size_of::<&String>()`?

- *A. 8 — a reference is one address
- B. 24 — the same as a `String`
- C. 16 — a pointer and a length
- D. 32 — the `String` plus a header

@why
A reference is an address and nothing else. No reference count, no header, no
run-time check: the machine code is the pointer you would have written in C, and
everything in this unit happens in the compiler and leaves nothing behind.

C is the right answer to a different question. `&str` and `&[T]` are 16 bytes
because they are **fat pointers** — an address plus a length — which is the
subject of the next unit.

Because a reference owns nothing, copying one copies only an address, so `&T` is
`Copy`. `&mut T` is not, and could not be: copying it would produce two unique
references.

## 6

Does this compile?

```rust
fn bump(n: &mut i32) { *n += 1; }

let count = 0;
bump(&mut count);
```

- A. Yes — `&mut` makes it mutable
- *B. No — `count` is not declared `mut`
- C. No — `bump` should take `&i32`
- D. Yes, but `count` is still 0 afterwards

@why
`error[E0596]: cannot borrow count as mutable, as it is not declared as
mutable`. Two different things carry mutability: `let mut x` says this binding
may be written through, and `&mut x` lends that permission out exclusively. You
cannot lend an authority you do not hold.

A is the trap, and the giveaway is that `mut` on a binding is not part of the
type — `i32` is `i32` either way. It is a statement about the binding, which is
why moving a value into a `mut` binding makes it mutable and why nothing else
breaks when you add the keyword.

## 7

Does this compile?

```rust
let name = String::from("ferris");
let r = &name;
let owned = name;
println!("{r}");
```

- A. Yes — `r` and `owned` both see the string
- *B. No — `name` cannot move while it is borrowed
- C. No — `String` cannot be printed with `{}`
- D. Yes, and it prints `ferris`

@why
`error[E0505]: cannot move out of name because it is borrowed`. The move hands
the heap buffer to `owned` and retires `name`; `r` was pointing at `name`, so
after the move it would name a binding that owns nothing. That is a dangling
reference.

The same reasoning covers dropping, because a drop is a move into the
destructor. One rule closes both the use-after-move and the use-after-free hole.

It is also why `Vec::remove` takes `&mut self` although it only hands a value
back: removing moves the element out of the collection, and moving out requires
that nothing is borrowing it.

## 8

Does this compile?

```rust
struct User { id: u32, name: String }

fn take_name(u: &User) -> String {
    u.name
}
```

- A. Yes — `name` is a field, so reading it is free
- *B. No — that would move a `String` out of a shared reference
- C. No — the function needs a lifetime parameter
- D. Yes, and the caller's `User` keeps its name

@why
`error[E0507]: cannot move out of u.name which is behind a shared reference`.
`String` is not `Copy`, so producing one by value transfers the buffer and
retires the source — and the source is a field of a struct the *caller* owns.
The caller would be left holding a `User` whose `name` owns nothing, and two
values would free one buffer.

A shared reference is permission to read, not permission to remove. Three ways
out, best first: return `&str` and let the caller decide; `clone()` when the
caller genuinely needs an owned copy; take `User` by value if you are really
consuming it.

## 9

Does this compile?

```rust
struct Editor { buffer: String, log: Vec<String> }

let mut ed = Editor { buffer: String::new(), log: Vec::new() };
let b = &mut ed.buffer;
let l = &mut ed.log;
b.push_str("hi");
l.push(String::from("typed"));
```

- *A. Yes — the two fields are disjoint places
- B. No — `ed` is borrowed mutably twice
- C. No — you cannot borrow a field, only a whole struct
- D. Only if `Editor` derives `Clone`

@why
Yes. The borrow checker tracks **paths**, not variables. `ed.buffer` and
`ed.log` are different places at different addresses, so a unique borrow of each
is two unique borrows of two different things — no rule broken.

B is the answer to the *next* question, and the difference between the two is
worth carrying around: this works, and the same thing routed through two
`&mut self` methods does not.

## 10

Does this compile?

```rust
impl Editor {
    fn buffer_mut(&mut self) -> &mut String { &mut self.buffer }
    fn log_mut(&mut self) -> &mut Vec<String> { &mut self.log }
}

let b = ed.buffer_mut();
let l = ed.log_mut();
b.push_str("hi");
```

- A. Yes — the methods touch different fields
- *B. No — each method borrows all of `ed`, so the two borrows overlap
- C. No — a method cannot return a `&mut` to a field
- D. Yes, because the borrows are inside method calls

@why
`error[E0499]: cannot borrow ed as mutable more than once at a time`. The
signature says `&mut self` — the whole struct — and the returned `&mut String`
keeps that borrow alive as long as `b` is used.

A is true of the bodies and irrelevant. The borrow checker never looks inside a
function body when checking a call, and that is deliberate: it is what makes a
signature a real contract, so editing a private method cannot break a caller in
another crate.

This is the most common real borrow frustration. The escapes: borrow the fields
directly, destructure with `let Editor { buffer, log } = &mut ed;`, take the two
fields as separate arguments, or split the struct in two.

## 11

Which pair of accesses to one location is a data race?

- A. Two reads
- *B. A read and a write
- *C. Two writes
- D. Neither, so long as both are on the same thread

@why
A data race needs two accesses to the same memory with at least one write and no
synchronisation between them. Two reads cannot disturb each other; the other two
pairs can.

Rust's rule maps onto this exactly: many `&T` allows the harmless row, and
forbidding `&T` alongside `&mut T`, and two `&mut T`, forbids precisely the other
two.

D is the interesting mistake. **Aliasing plus mutation** is one condition, and
being on one thread does not make it safe — it makes it iterator invalidation
instead of a race. Same rule, same bug, two costumes.

## 12

Does this compile?

```rust
fn greeting() -> &String {
    let s = String::from("hello");
    &s
}
```

- A. Yes — `s` is moved into the return value
- *B. No — the compiler cannot tell what the returned reference borrows from
- C. Yes, but the reference dangles at run time
- D. No — you cannot return a reference from a function

@why
`error[E0106]: missing lifetime specifier`. The compiler is asking a question
with no possible answer: this reference borrows from *what*? The only candidate,
`s`, is dropped at the closing brace.

C is what C does. There the equivalent compiles, often prints something
plausible because nothing has reused the stack yet, and is the canonical
use-after-free. Here it is an error, always.

D is too strong — returning a reference is ordinary, and unit 15 covers how the
compiler works out which input it came from. The fix here is to return the
`String` itself.

## 13

Does this compile?

```rust
fn bump(n: &mut u32) { *n += 1; }

fn bump_twice(n: &mut u32) {
    bump(n);
    bump(n);
}
```

- *A. Yes — the compiler inserts an implicit reborrow
- B. No — `&mut u32` is not `Copy`, so the first call moves it
- C. Yes — `&mut T` is `Copy`, like `&T`
- D. No — `bump_twice` needs to take `n` by value

@why
B correctly identifies the problem and misses the mechanism that solves it.
`&mut u32` really is not `Copy`, so a naive reading says the first call moves
`n`. What actually happens is a **reborrow**: the compiler passes `&mut *n`, a
fresh and shorter unique borrow taken *through* the existing one. The original
is frozen for the duration of the call and usable again after.

Uniqueness survives, because at any moment exactly one of the two is usable.

C is the tempting shortcut and would be unsound: copying a unique reference
would produce two of them, which is a contradiction. The reborrow is only
inserted where the target type is known to be a reference — push a `&mut` into a
`Vec` and it moves for real.

## 14

Does this compile?

```rust
let mut lines = vec![String::from("a")];
for line in &lines {
    if line.starts_with('a') {
        lines.push(String::from("b"));
    }
}
```

- A. Yes — the loop only reads, and `push` only writes
- *B. No — the loop holds a shared borrow for its whole duration
- C. No — `starts_with` needs a `&str`, not a `char`
- D. Yes, but the new element is never visited

@why
`error[E0502]`. `for line in &lines` desugars to
`IntoIterator::into_iter(&lines)`, and that iterator holds the shared borrow for
the entire loop, including the jump back to the top. The `push` needs a unique
borrow, inside that region.

D is what the C++ version *sometimes* does, and it is the reason this bug is so
dangerous. `push_back` inside a range-for compiles silently in C++; on a
short vector nothing reallocates and it appears to work, and it breaks when the
data grows in production. Every C++ container documents which operations
invalidate which iterators, and remembering that table is the programmer's job.
Rust deletes the table.

The fix is to collect the additions into a second `Vec` inside the loop and
`extend` afterwards.

## 15

What does borrow checking cost at run time?

- A. One reference count per borrow
- B. A bounds check on every dereference
- *C. Nothing — it is entirely a compile-time analysis
- D. A small periodic pause, much shorter than a collector's

@why
The borrow checker runs in the compiler, decides the program is sound, and
emits code that contains no trace of it. A `&T` is one address; dereferencing it
is one load, the same instruction C would emit.

A describes `Rc<T>`, which is a *runtime* sharing mechanism you reach for when
the static analysis genuinely cannot express what you need — and it costs a
counter and a branch. That is unit 18, and the point is that you opt into it
rather than paying it everywhere.

The guarantee is the striking part: no dangling pointer, no use-after-free, no
data race, no garbage collector, and nothing at all left over at run time.
