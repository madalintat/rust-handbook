---
unit: 06-borrowing
---

## 1. Lending something you cannot change

@kind fix
@concept mutable reference

@expect E0596

`sort_in_place` asks for a `&mut Vec<i32>` and gets handed one. The compiler
still refuses, and the complaint is not about the function. It is about where
the vector is kept.

```starter
pub fn sort_in_place(v: &mut Vec<i32>) {
    v.sort();
}

pub fn run() -> Vec<i32> {
    let readings = vec![3, 1, 2];
    sort_in_place(&mut readings);
    readings
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sorts() {
        assert_eq!(run(), vec![1, 2, 3]);
    }
}
```

```solution
pub fn sort_in_place(v: &mut Vec<i32>) {
    v.sort();
}

pub fn run() -> Vec<i32> {
    let mut readings = vec![3, 1, 2];
    sort_in_place(&mut readings);
    readings
}
```

@hint Read the error's second line. It is telling you about `readings`, not about `sort_in_place`.
@hint You cannot lend out a permission you were never given. The binding has to be mutable before a `&mut` to it can exist.
@hint `let mut readings = vec![3, 1, 2];`.

@diagnose E0596
`cannot borrow readings as mutable, as it is not declared as mutable`.

Two separate things carry mutability and it is worth keeping them apart.
`let mut x` says *this binding may be written through*. `&mut x` says *lend
someone else that permission, exclusively, for a while*. The second cannot exceed
the first: you cannot lend out an authority you do not hold.

Note that `mut` on a binding is not part of the type. `Vec<i32>` is `Vec<i32>`
whether the binding is `mut` or not. That is why moving a value into a `mut`
binding makes it mutable, and why the compiler will happily suggest adding `mut`
and nothing else breaks.

@after
`mut` being opt-in on every binding is a small nuisance and a large signal. In a
review, a `let` without `mut` is a fact about the whole scope: nothing below it
writes to that value, and you did not have to read the rest of the function to
learn that.

The compiler also warns the other way. A `let mut` that is never mutated raises
`unused_mut`, so the marker cannot rot into noise. That is what makes it worth
reading in the first place.

## 2. Read it before you change it

@kind fix
@concept borrow

@expect E0502

`first` is a shared reference into the vector. `push` needs a unique one. They
overlap, and the fix is not to fight the rule but to notice how little you
actually needed the reference for.

```starter
pub fn run() -> (usize, usize) {
    let mut log = vec![String::from("boot")];

    let first = &log[0];
    log.push(String::from("ready"));

    (first.len(), log.len())
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lengths() {
        assert_eq!(run(), (4, 2));
    }
}
```

```solution
pub fn run() -> (usize, usize) {
    let mut log = vec![String::from("boot")];

    let first_len = log[0].len();
    log.push(String::from("ready"));

    (first_len, log.len())
}
```

@hint You never needed the string itself after the push. You needed one number from it.
@hint A borrow lasts until its last use. Take the length while the borrow is still legal, and the borrow ends on that line.
@hint `let first_len = log[0].len();` before the `push`, then use `first_len` at the end.

@diagnose E0502
`cannot borrow log as mutable because it is also borrowed as immutable`. The
three underlines tell the whole story: where the shared borrow starts
(`&log[0]`), where the unique borrow is needed (`push`), and where the shared
one is still in use (`first.len()`).

The rule is not bureaucracy. `push` may find the vector at capacity, ask the
allocator for a larger buffer, copy the elements across and free the old one.
`first` points into the old buffer. In C++ this is the same three lines, it
compiles, and it works right up until the capacity happens to run out. That is
the worst possible failure mode, because the bug depends on the length of your
data.

@after
The general move is the one you just made: **end the borrow before the
mutation**. Since the 2018 edition a borrow's region stops at its last *use*, not
at the end of the block. Extracting what you need (a length, a copy of a small
field, an owned `clone` if you truly need the value) releases the collection
immediately.

Beginners reach for `.clone()` on the whole element here. It works, and it
allocates a string to obtain an integer. Ask what you actually need out of the
borrow first; it is usually much smaller than the thing you borrowed.

## 3. One writer at a time

@kind fix
@concept mutable reference

@expect E0499

Two names, both claiming exclusive access to the same vector, both alive at the
same moment. One of those words is doing all the work.

```starter
pub fn run() -> Vec<i32> {
    let mut queue = vec![1];

    let a = &mut queue;
    let b = &mut queue;

    a.push(2);
    b.push(3);

    queue
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn appends_in_order() {
        assert_eq!(run(), vec![1, 2, 3]);
    }
}
```

```solution
pub fn run() -> Vec<i32> {
    let mut queue = vec![1];

    let a = &mut queue;
    a.push(2);

    let b = &mut queue;
    b.push(3);

    queue
}
```

@hint `&mut` does not mean "mutable". It means "unique": while one exists, it is the only way to reach the value.
@hint The two borrows only conflict because they overlap in time. Finish with the first before creating the second.
@hint Move `a.push(2)` up so that `a` is last used before `let b = &mut queue;`.

@diagnose E0499
`cannot borrow queue as mutable more than once at a time`.

Read `&mut T` as *unique reference* and the error stops being surprising: a
second one is a second claim to something that was defined as exclusive.

The payoff is not only safety. Because a `&mut` is guaranteed to be the only
route to that memory, the compiler may keep a value in a register across a
function call, reorder writes, and skip re-reads that C has to perform because
any pointer might alias any other. This is the same guarantee C tries to
retrofit with `restrict`, which almost nobody writes and the compiler cannot
check.

@after
The fix here was to sequence the borrows, and that is the fix nine times out of
ten. Non-lexical lifetimes make it cheap: a borrow ends at its last use, so
simply moving a line up can release the value.

Notice also that both borrows were unnecessary. `queue.push(2); queue.push(3);`
borrows uniquely for the duration of each call and no longer. Naming a `&mut` in
a `let` is what stretched the borrow out; most code never needs to.

## 4. Moving out from under a watcher

@kind fix
@concept borrow

@expect E0505

Nothing is mutated here. There is one shared reference and one move, and that
combination is enough.

```starter
pub fn run() -> (String, usize) {
    let name = String::from("ferris");

    let r = &name;
    let owned = name;

    (owned, r.len())
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keeps_both() {
        assert_eq!(run(), (String::from("ferris"), 6));
    }
}
```

```solution
pub fn run() -> (String, usize) {
    let name = String::from("ferris");

    let r = &name;
    let n = r.len();

    let owned = name;

    (owned, n)
}
```

@hint The move is legal in itself. What makes it an error is that something is still pointing at `name`.
@hint Use the reference for everything it is needed for *before* the move, and its borrow ends there.
@hint Take `let n = r.len();` before `let owned = name;`, then return `(owned, n)`.

@diagnose E0505
`cannot move out of name because it is borrowed`.

This is the seam between the last unit and this one. A move retires the source
binding. `name` is statically dead afterwards, and its three-word handle now
belongs to `owned`. But `r` was pointing at `name`, so after the move `r` would
name a binding that no longer owns anything. That is a dangling reference, which
is precisely what references exist to make impossible.

So the rule is: **a value cannot move while any reference to it is live.** Note
what "live" means. It is not "in scope" but "still going to be used". Finish with
`r` first and the borrow is over before the move happens.

@diagnose E0382
You moved `name` and then tried to read it directly rather than through `r`.
Once `let owned = name;` has run, `name` is moved-from and unnameable; the value
is alive under its new name.

@after
The same reasoning explains something that looks unrelated: a value cannot be
*dropped* while borrowed either, because a drop is a move into the destructor.
That single rule closes both the use-after-move and the use-after-free holes at
once.

It is also why `Vec::remove` and `HashMap::remove` take `&mut self` even though
they only hand a value back. Removing an element moves it out of the collection,
and moving out requires that nothing is currently borrowing the collection.

## 5. You cannot take what you were only shown

@kind fix
@concept reference

@expect E0507

`display_name` gets a `&User`, which is permission to look. It tries to walk away
with the name field.

```starter
pub struct User {
    pub id: u32,
    pub name: String,
}

pub fn display_name(u: &User) -> String {
    u.name
}

pub fn run() -> (String, String) {
    let u = User { id: 1, name: String::from("ada") };
    (display_name(&u), u.name)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_without_stealing() {
        assert_eq!(run(), (String::from("ada"), String::from("ada")));
    }
    #[test]
    fn caller_still_owns_it() {
        let u = User { id: 7, name: String::from("grace") };
        assert_eq!(display_name(&u), "grace");
        assert_eq!(u.id, 7);
    }
}
```

```solution
pub struct User {
    pub id: u32,
    pub name: String,
}

pub fn display_name(u: &User) -> String {
    u.name.clone()
}

pub fn run() -> (String, String) {
    let u = User { id: 1, name: String::from("ada") };
    (display_name(&u), u.name)
}
```

@hint `u.name` in a position that needs a `String` by value is a move, and `u` is only borrowed.
@hint The caller still owns that `User` and will still use its `name` afterwards. Taking the field would leave a hole in a struct someone else owns.
@hint The signature promises an owned `String`, so make one: `u.name.clone()`.

@diagnose E0507
`cannot move out of u.name which is behind a shared reference`.

Follow what a move would mean. `String` is not `Copy`, so producing one by value
transfers the heap buffer and retires the source. The source here is a field of
a struct the *caller* owns. After the call, the caller's `User` would have a
`name` field that owns nothing, and dropping it would free a buffer that
`display_name`'s return value also owns. Double free.

A shared reference is permission to read, not permission to remove. The three
ways out, in order of preference: return a borrow (`&str`) and let the caller
decide; `clone()` when the caller genuinely needs an owned copy; or take `User`
by value if you really are consuming it.

@diagnose E0308
Your `display_name` is returning the wrong type. `&u.name` is a `&String` and
the signature says `String`. Either change the return type to `&str`, which is
the better design, or produce an owned value with `.clone()` or `.to_string()`.

@after
The best version of this function does not return `String` at all:

```rust
pub fn display_name(u: &User) -> &str {
    &u.name
}
```

No allocation, and the caller clones only if it needs to keep the result. The
lifetime is inferred: the returned `&str` borrows from `u`, so it cannot outlive
the `User`. That is exactly the guarantee you want, and exactly what unit 15 is
about.

The rule of thumb: return borrowed data when the caller already owns the source,
and make cloning the caller's decision rather than yours.

## 6. The bug that made C++ document invalidation tables

@kind fix
@concept iterator invalidation

@expect E0502

Walk the config lines, and after every section header insert a marker. The logic
is right. The shape is the single most famous memory bug in C++.

```starter
pub fn run() -> Vec<String> {
    let mut lines = vec![
        String::from("alpha"),
        String::from("[section]"),
        String::from("beta"),
    ];

    for line in &lines {
        if line.starts_with('[') {
            lines.push(String::from("-- marker --"));
        }
    }

    lines
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn appends_one_marker() {
        assert_eq!(
            run(),
            vec![
                String::from("alpha"),
                String::from("[section]"),
                String::from("beta"),
                String::from("-- marker --"),
            ]
        );
    }
}
```

```solution
pub fn run() -> Vec<String> {
    let mut lines = vec![
        String::from("alpha"),
        String::from("[section]"),
        String::from("beta"),
    ];

    let mut extra = Vec::new();
    for line in &lines {
        if line.starts_with('[') {
            extra.push(String::from("-- marker --"));
        }
    }
    lines.extend(extra);

    lines
}
```

@hint `for line in &lines` holds a shared borrow of the whole vector for the whole loop. `push` wants a unique one.
@hint You cannot grow a collection you are walking. But you can decide what to add while walking, and add it afterwards.
@hint Collect the new lines into a second `Vec` inside the loop, then `lines.extend(extra)` once the loop has ended.

@diagnose E0502
`cannot borrow lines as mutable because it is also borrowed as immutable`.

The immutable borrow is `&lines` in the `for` header. It is not a borrow for one
line. `for x in &lines` desugars to `IntoIterator::into_iter(&lines)`, and that
iterator holds the shared borrow for the entire loop, including the jump back to
the top. So the `push` sits squarely inside a live shared borrow.

The reason this rule exists: `push` may reallocate. If the vector is at
capacity, it asks for a bigger buffer, copies the elements across and frees the
old one, and the iterator is a pointer into that old one. Every subsequent
iteration reads freed memory.

@diagnose E0499
You are iterating with `&mut lines` and pushing inside the loop. The iterator
holds the unique borrow for the whole loop, so `push` cannot take a second one.
Iterating mutably lets you change existing elements, never add or remove them.

@after
The C++ version of this program compiles silently:

```cpp
for (const auto &line : lines) {
    if (line[0] == '[') lines.push_back("-- marker --");
}
```

It usually works on three elements, because the vector was over-allocated and
`push_back` did not reallocate. It breaks when the input grows, in production,
under load. This is why every C++ container's documentation carries a table of
which operations invalidate which iterators, and why remembering that table is
the programmer's job.

Rust deletes the table. `push` takes `&mut self`, the loop holds a `&`, and the
two cannot coexist. Same bug, caught at compile time, at no run-time cost. And
notice it is the *same rule* that stops two threads writing one vector.
Aliasing plus mutation is one condition, whether the second access comes from a
loop or from another core.

## 7. A reference that outlives what it points at

@kind fix
@concept dangling reference

@expect E0597

The block was meant to keep the temporary tidy. It also kills the string that
`label` is pointing at.

```starter
pub fn run() -> usize {
    let label;

    {
        let owned = String::from("temporary");
        label = &owned;
    }

    label.len()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn measures_the_label() {
        assert_eq!(run(), 9);
    }
}
```

```solution
pub fn run() -> usize {
    let owned = String::from("temporary");
    let label = &owned;

    label.len()
}
```

@hint When does `owned` get dropped? When is `label` used?
@hint A reference may never outlive the value it points at. Either shorten the reference's life or lengthen the value's.
@hint Declare `owned` in the outer scope so it lives at least as long as `label` is used.

@diagnose E0597
`owned does not live long enough`, with a note that the borrow is used at
`label.len()`, and another marking the closing brace as where `owned` is
dropped.

Follow the memory. `owned` is a local of the inner block, so its destructor runs
at that closing brace and its heap buffer goes back to the allocator. `label`
holds the address of `owned`'s stack slot. One line later, `label.len()` reads
through a pointer to a dead local and a freed buffer.

In C this compiles and often prints something plausible, because nothing has
reused the memory yet. It is the canonical use-after-free, and it is the reason
`-Wreturn-local-addr` exists and catches only the simplest version. Here it is
just an error, always, and the analysis is complete rather than heuristic.

@diagnose E0381
You removed the assignment along with the block. `let label;` declares a binding
without initialising it, and Rust will not let you read one that has not been
assigned on every path leading to the use. Give it a value.

@after
This is one of the two halves of the dangling-reference guarantee. This half is
"a reference cannot outlive its referent". The other, met in exercise 4, is "the
referent cannot move or be dropped while a reference to it is live". Together
there is no sequence of safe Rust that produces a pointer to freed memory.

The version of this error you will meet more often is at a function boundary:

```rust,bad
fn greeting() -> &String {
    let s = String::from("hello");
    &s
}
```

There the message is `error[E0106]: missing lifetime specifier`, because the
compiler is asking what the returned reference borrows *from*, and there is no
possible answer. Return the `String`.

## 8. Two fields, one struct, one angry compiler

@kind fix
@concept split borrow

@expect E0499

`buffer` and `log` are different fields at different addresses. Writing to one
cannot possibly disturb the other. The compiler rejects this anyway, and the
reason is the most useful thing in this unit.

```starter
pub struct Editor {
    pub buffer: String,
    pub log: Vec<String>,
}

impl Editor {
    pub fn buffer_mut(&mut self) -> &mut String {
        &mut self.buffer
    }

    pub fn log_mut(&mut self) -> &mut Vec<String> {
        &mut self.log
    }
}

pub fn run() -> Editor {
    let mut ed = Editor { buffer: String::new(), log: Vec::new() };

    let buf = ed.buffer_mut();
    let log = ed.log_mut();

    buf.push_str("hello");
    log.push(String::from("typed 5 chars"));

    ed
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn writes_both_fields() {
        let ed = run();
        assert_eq!(ed.buffer, "hello");
        assert_eq!(ed.log, vec![String::from("typed 5 chars")]);
    }
}
```

```solution
pub struct Editor {
    pub buffer: String,
    pub log: Vec<String>,
}

impl Editor {
    pub fn buffer_mut(&mut self) -> &mut String {
        &mut self.buffer
    }

    pub fn log_mut(&mut self) -> &mut Vec<String> {
        &mut self.log
    }
}

pub fn run() -> Editor {
    let mut ed = Editor { buffer: String::new(), log: Vec::new() };

    let buf = &mut ed.buffer;
    let log = &mut ed.log;

    buf.push_str("hello");
    log.push(String::from("typed 5 chars"));

    ed
}
```

@hint Read the signature of `buffer_mut`, not its body. What exactly does it borrow?
@hint The borrow checker never looks inside a function body when checking a call. `&mut self` claims the whole struct, so two such calls claim it twice.
@hint Borrow the fields directly instead: `let buf = &mut ed.buffer;` and `let log = &mut ed.log;`. Two disjoint paths, two independent borrows.

@diagnose E0499
`cannot borrow ed as mutable more than once at a time`.

The compiler is right about what it was told. `buffer_mut(&mut self)` borrows
*all of* `ed`, and the returned `&mut String` keeps that borrow alive for as long
as `buf` is used. `log_mut` then asks for a second unique borrow of the same
`ed`.

Nothing in the bodies matters. The borrow checker works from signatures alone,
and that is deliberate: it is what makes a signature a real contract. If calls
were checked against bodies, editing a private method could break a caller in
another crate.

Borrowing the fields directly works because the checker tracks **paths**, not
variables. `ed.buffer` and `ed.log` are disjoint places, so a unique borrow of
each is two unique borrows of two different things. No rule is broken.

@diagnose E0502
You have mixed a shared and a unique borrow of `ed`. The same reasoning applies:
a method taking `&self` claims the whole struct for reading and a method taking
`&mut self` claims the whole struct for writing, so the two cannot overlap even
when they touch different fields.

@after
This is the most common real-world borrow frustration, and it is worth carrying
all four escape routes:

1. **Borrow fields directly.** Free, and the usual answer inside the type's own `impl`.
2. **Destructure once.** `let Editor { buffer, log } = &mut ed;` yields a `&mut` to every field at the same time, all disjoint.
3. **Take what you need as arguments.** A free function `fn append(buf: &mut String, log: &mut Vec<String>)` states the disjointness in its signature, so callers can satisfy it.
4. **Split the struct.** Two fields never used together are two types. An hour lost to this usually means one struct is doing two jobs.

Slices ship a fifth: `split_at_mut` hands back two `&mut` halves of one slice.
It is `unsafe` inside, and exists purely to assert a disjointness the checker
cannot infer from index arithmetic. That is the shape of every legitimate
`unsafe` block: a fact the human knows and the compiler cannot yet be told.
