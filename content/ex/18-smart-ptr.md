---
unit: 18-smart-ptr
---

## 1. A type that contains itself

@kind fix
@concept Box
@expect E0072

`Expr` is an expression tree: a number, or the sum of two other expressions. The
shape is right and the `eval` function is already correct.

The compiler cannot lay it out. Work out what it needs and give it that, without
changing what the type means.

```starter
pub enum Expr {
    Num(i64),
    Add(Expr, Expr),
}

pub fn eval(e: &Expr) -> i64 {
    match e {
        Expr::Num(n) => *n,
        Expr::Add(a, b) => eval(a) + eval(b),
    }
}

pub fn run() -> i64 {
    let e = Expr::Add(Expr::Num(1), Expr::Add(Expr::Num(2), Expr::Num(3)));
    eval(&e)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn evaluates_a_nested_tree() {
        assert_eq!(run(), 6);
    }
}
```

```solution
pub enum Expr {
    Num(i64),
    Add(Box<Expr>, Box<Expr>),
}

pub fn eval(e: &Expr) -> i64 {
    match e {
        Expr::Num(n) => *n,
        Expr::Add(a, b) => eval(a) + eval(b),
    }
}

pub fn run() -> i64 {
    let e = Expr::Add(
        Box::new(Expr::Num(1)),
        Box::new(Expr::Add(Box::new(Expr::Num(2)), Box::new(Expr::Num(3)))),
    );
    eval(&e)
}
```

@hint Try to compute the size of an `Expr` on paper. Where does the calculation stop?
@hint A pointer is one word whatever it points at. Put one between the variant and its children.
@hint `Add(Box<Expr>, Box<Expr>)`, and wrap each child in `Box::new(..)` when you build the tree.

@diagnose E0072
`recursive type Expr has infinite size`, with the help note
`insert some indirection (e.g., a Box, Rc, or &) to break the cycle`.

An enum is laid out as its largest variant plus a discriminant, so the compiler
needs a number for `size_of::<Expr>()`. `Add` contains two `Expr`s, so that
number is `2 × size_of::<Expr>() + tag`. There is no value of `size` that
satisfies it — the calculation does not terminate.

`Box<Expr>` is eight bytes whatever is at the far end, so the recursion is cut at
the pointer. `Add` becomes sixteen bytes, `Num` eight, and `Expr` is a tag plus
sixteen regardless of how deep the tree gets. The depth lives on the heap, where
its size does not have to be known until run time.

@diagnose E0308
You boxed the fields but built the tree with bare values, or the reverse.
`Box::new(Expr::Num(1))` produces a `Box<Expr>`; `Expr::Num(1)` produces an
`Expr`. Every child in `run` needs the `Box::new` wrapper now that the variant
asks for one.

`eval` needs no change at all, which is worth noticing: matching on
`Expr::Add(a, b)` against a `&Expr` gives `a: &Box<Expr>`, and deref coercion
turns that into the `&Expr` the recursive call wants with no syntax from you.

@after
Every linked list, tree and syntax node in Rust has a `Box` in it somewhere, for
exactly this reason. `Option<Box<T>>` is the idiomatic "maybe another node", and
it costs nothing extra: the compiler knows a `Box` is never null, so it uses the
null value as the `None` discriminant. `Option<Box<T>>` is eight bytes, the same
as `Box<T>`.

`Rc<Expr>` would also have compiled, and would be the right choice if subtrees
were shared between several parents. `Box` is the cheaper one when they are not:
a single owner, no count, no bookkeeping.

## 2. A vector of different shapes

@kind fix
@concept trait object
@expect E0277

Two types implement `Draw`, and the goal is one vector holding a mixture and
calling `draw` on each. The annotation says `Vec<dyn Draw>`, which the compiler
will not accept.

Ask what a `Vec` needs to know about its elements.

```starter
pub trait Draw {
    fn draw(&self) -> String;
}

pub struct Circle;
pub struct Square;

impl Draw for Circle {
    fn draw(&self) -> String {
        String::from("circle")
    }
}

impl Draw for Square {
    fn draw(&self) -> String {
        String::from("square")
    }
}

pub fn run() -> Vec<String> {
    let shapes: Vec<dyn Draw> = vec![Circle, Square];
    shapes.iter().map(|s| s.draw()).collect()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn draws_a_mixture() {
        assert_eq!(run(), vec!["circle", "square"]);
    }
}
```

```solution
pub trait Draw {
    fn draw(&self) -> String;
}

pub struct Circle;
pub struct Square;

impl Draw for Circle {
    fn draw(&self) -> String {
        String::from("circle")
    }
}

impl Draw for Square {
    fn draw(&self) -> String {
        String::from("square")
    }
}

pub fn run() -> Vec<String> {
    let shapes: Vec<Box<dyn Draw>> = vec![Box::new(Circle), Box::new(Square)];
    shapes.iter().map(|s| s.draw()).collect()
}
```

@hint A `Vec` stores its elements contiguously, so it must know how many bytes apart they are.
@hint A `Circle` and a `Square` are different sizes and both are `dyn Draw`, so `dyn Draw` has no single size.
@hint `Vec<Box<dyn Draw>>`, built with `Box::new(Circle)` and `Box::new(Square)`.

@diagnose E0277
`the size for values of type dyn Draw cannot be known at compilation time`, and
underneath, `the trait Sized is not implemented for dyn Draw`.

Almost every generic in the standard library has an implicit `Sized` bound,
because almost every generic needs to know how big the thing is — where to put
it, how far to step to the next one. `Vec<T>` is one of them: its elements sit
end to end in one allocation, so a fixed stride is not optional.

`dyn Draw` is deliberately unsized. It stands for *any* type implementing `Draw`,
and those types have different sizes. Putting it behind a pointer fixes the size
of the thing in the vector: `Box<dyn Draw>` is two words — one to the value on
the heap, one to the **vtable** that says which `draw` to call.

@diagnose E0308
`mismatched types: expected dyn Draw, found Circle`. The same problem from the
other end — you told the vector its elements are `dyn Draw` and then handed it a
concrete `Circle`. Both halves need the `Box`: the annotation
(`Vec<Box<dyn Draw>>`) and each element (`Box::new(Circle)`).

@after
This is where the cost of dynamic dispatch actually is, and it is worth being
precise: one pointer of extra width on each element, one indirection to reach the
value, and one indirection through the vtable to reach the method — which the CPU
cannot inline through.

The alternative, when the set of shapes is closed and known, is an enum:
`enum Shape { Circle(Circle), Square(Square) }` stores inline, dispatches with a
jump table, and inlines fine. The trade is that adding a variant means editing
every `match`, while adding a `Box<dyn Draw>` implementor means editing nothing.
Closed set, use an enum; open set, use a trait object.

## 3. You cannot call the destructor

@kind fix
@concept drop
@expect E0040

`Conn` writes a line to the log when it is dropped. The intent here is to close
the connection early, before the end of the block, and then carry on.

The intent is right. The spelling is not.

```starter
use std::cell::RefCell;
use std::rc::Rc;

pub struct Conn {
    pub host: String,
    pub log: Rc<RefCell<Vec<String>>>,
}

impl Drop for Conn {
    fn drop(&mut self) {
        self.log.borrow_mut().push(format!("closing {}", self.host));
    }
}

pub fn run() -> Vec<String> {
    let log = Rc::new(RefCell::new(Vec::new()));
    {
        let c = Conn { host: String::from("db"), log: Rc::clone(&log) };
        log.borrow_mut().push(String::from("working"));
        c.drop();
        log.borrow_mut().push(String::from("after"));
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
    fn closes_early_then_continues() {
        assert_eq!(run(), vec!["working", "closing db", "after"]);
    }
}
```

```solution
use std::cell::RefCell;
use std::rc::Rc;

pub struct Conn {
    pub host: String,
    pub log: Rc<RefCell<Vec<String>>>,
}

impl Drop for Conn {
    fn drop(&mut self) {
        self.log.borrow_mut().push(format!("closing {}", self.host));
    }
}

pub fn run() -> Vec<String> {
    let log = Rc::new(RefCell::new(Vec::new()));
    {
        let c = Conn { host: String::from("db"), log: Rc::clone(&log) };
        log.borrow_mut().push(String::from("working"));
        drop(c);
        log.borrow_mut().push(String::from("after"));
    }
    let out = log.borrow().clone();
    out
}
```

@hint If calling the destructor by hand were allowed, what would happen at the end of the block?
@hint There is a free function for this, and it is already in the prelude.
@hint `drop(c);` — one word rearranged, and the meaning changes completely.

@diagnose E0040
`explicit use of destructor method`, with the suggestion
`consider using drop function: drop(c)`.

If `c.drop()` were allowed, your destructor would run there — and then run again
at the closing brace, because `c` still owns the value. That is a double free in
the one place the language guarantees there is not one. So the method is
reachable only by the compiler.

`drop(c)` is not a compiler intrinsic. It is this, in full:

```rust
pub fn drop<T>(_x: T) {}
```

An empty body. Its whole effect comes from the signature taking `T` **by value**:
calling it moves `c` in, `_x` goes out of scope on the closing brace, and the
destructor runs there. Ownership already had the machinery.

@after
The log order is the check. `working`, then `closing db` at the `drop(c)` line,
then `after` — so the connection really did close in the middle of the block
rather than at the end.

This is the standard way to release a resource early, and it is most useful for
locks: `drop(guard)` unlocks a mutex without needing an artificial `{ }` around
the critical section. The other spellings people reach for are worse.
`let _ = mutex.lock();` looks similar and is a trap — `_` is not a binding, so
the guard is dropped on that very line and the lock was never held.

Also note `drop(&mut self)`, not `drop(self)`, in the impl. The value is
mid-destruction and its fields are dropped after your code returns, so you get a
borrow of it. Taking `self` would mean moving out of the thing being dropped,
which would need to drop it again.

## 4. Rc::clone is not a clone

@kind fix
@concept Rc
@expect E0382

`Rc<T>` exists so that a value can have several owners. Three names are supposed
to reach one `Config` here, and the count at the end should say so.

`Rc` is a normal type with normal ownership. Assigning one moves it.

```starter
use std::rc::Rc;

pub struct Config {
    pub retries: u32,
}

pub fn run() -> (u32, u32, usize) {
    let cfg = Rc::new(Config { retries: 3 });
    let a = cfg;
    let b = cfg;
    (a.retries, b.retries, Rc::strong_count(&a))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn three_owners_one_config() {
        assert_eq!(run(), (3, 3, 3));
    }
}
```

```solution
use std::rc::Rc;

pub struct Config {
    pub retries: u32,
}

pub fn run() -> (u32, u32, usize) {
    let cfg = Rc::new(Config { retries: 3 });
    let a = Rc::clone(&cfg);
    let b = Rc::clone(&cfg);
    (a.retries, b.retries, Rc::strong_count(&a))
}
```

@hint `let a = cfg;` moves the handle. It does not make a second one.
@hint Making a second handle is an explicit call, and it increments the count.
@hint `Rc::clone(&cfg)` — note the shape: an associated function taking a reference, not a method.

@diagnose E0382
`use of moved value: cfg` — `the type Rc<Config> does not implement Copy`.

This is unit 05 with no exceptions carved out. An `Rc` is a struct holding one
pointer, and it has a destructor that decrements the count, so it cannot be
`Copy`. `let a = cfg;` moves the handle into `a` and retires `cfg`, exactly as it
would for a `String`.

To get a *second* handle you have to ask, and asking is what bumps the count from
1 to 2. That is the whole mechanism: `Rc::clone` copies a pointer and adds one to
an integer.

@diagnose E0507
`cannot move out of an Rc`. You reached through the handle instead of duplicating
it — something like `let c: Config = *cfg;`. `Rc` deliberately gives you only
`&T`, because moving the value out would leave the other owners pointing at
nothing. Clone the handle, or clone the inner value with `(*cfg).clone()` if you
genuinely want a separate `Config`.

@after
`Rc::clone(&cfg)` and `cfg.clone()` compile to the same thing. The convention is
to write the first, and it exists purely so a reader scanning the code can tell a
pointer bump from a deep copy without looking up a type. In a file full of
`.clone()` calls, the ones that allocate should not look the same as the ones
that do not.

`strong_count` is 3 at the end because all three handles are still alive. Each
`drop` takes it down by one, and the `Config` is freed when it reaches zero. No
collector, no scanning — a decrement and a branch.

The limit worth remembering: that counter is a plain `usize`, not atomic. `Rc` is
neither `Send` nor `Sync`, and the compiler will not let one cross a thread
boundary. `Arc` is the same type with atomic increments.

## 5. Shared, and now it needs to change

@kind fix
@concept interior mutability
@expect E0596

Two handles to one inbox, and a message needs to go in through one of them.
`Rc<T>` hands out `&T` and nothing else, which is a deliberate refusal: several
owners plus mutation is precisely the aliasing the borrow checker rejects.

There is a wrapper whose job is to allow it anyway, under a check.

```starter
use std::rc::Rc;

pub fn run() -> (usize, usize) {
    let inbox = Rc::new(Vec::<String>::new());
    let handle = Rc::clone(&inbox);

    handle.push(String::from("hello"));

    (inbox.len(), Rc::strong_count(&inbox))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn writes_through_one_handle() {
        assert_eq!(run(), (1, 2));
    }
}
```

```solution
use std::cell::RefCell;
use std::rc::Rc;

pub fn run() -> (usize, usize) {
    let inbox = Rc::new(RefCell::new(Vec::<String>::new()));
    let handle = Rc::clone(&inbox);

    handle.borrow_mut().push(String::from("hello"));

    (inbox.borrow().len(), Rc::strong_count(&inbox))
}
```

@hint There is no `Rc::get_mut` route here — two handles exist, so it would return `None`.
@hint The wrapper you want moves the borrow check from compile time to run time. It goes *inside* the `Rc`.
@hint `Rc<RefCell<Vec<String>>>`, then `handle.borrow_mut().push(..)` and `inbox.borrow().len()`.

@diagnose E0596
`cannot borrow data in an Rc as mutable`, and the note
`trait DerefMut is required to modify through a dereference, but it is not
implemented for Rc<Vec<String>>`.

That note is the precise reason. `Rc<T>` implements `Deref<Target = T>` and
deliberately does **not** implement `DerefMut`. If it did, two handles could hand
out two `&mut` to the same value at once, which is `E0499` written with extra
steps — the exact aliasing the whole borrow system exists to prevent.

`RefCell<T>` is the escape hatch, and it is honest about what it costs. It keeps
its own borrow counter and checks it while the program runs, so `borrow_mut` can
take `&self` and still hand back a `&mut T`.

@diagnose E0308
The nesting is the wrong way round. `RefCell<Rc<Vec<String>>>` gives you a
mutable slot holding a shared handle — you can swap which vector you point at,
but still cannot push into it. Read the type outside in: `Rc` first (several
owners), `RefCell` inside it (any of them may mutate).

@after
`Rc<RefCell<T>>` is the standard single-threaded shape for shared mutable state,
and `Arc<Mutex<T>>` is the same sentence across threads — the same nesting, with
the check made atomic and the failure made blocking rather than panicking.

The price is that breaking the rule is a **panic** rather than a compile error,
and the panic only fires on the path that takes both borrows. `RefCell` is the
right answer when the aliasing pattern is genuinely dynamic — an observer list, a
graph with edges both ways, an interpreter environment. It is the wrong answer
when it appears because a function needed to reach a value two frames up; that is
usually a `&mut` parameter nobody wanted to thread through, and threading it
through is cheaper than a bug your tests do not reach.

## 6. The borrow that was still alive

@kind predict
@concept RefCell

A memoising lookup: return the cached value, or compute it, store it and return
it. It compiles cleanly. It also panics the first time it is called, before any
value has been cached.

Work out exactly which line panics and why, then restructure `lookup` so that it
does not.

```starter
use std::cell::RefCell;
use std::collections::HashMap;

pub fn lookup(cache: &RefCell<HashMap<String, u32>>, key: &str) -> u32 {
    match cache.borrow().get(key) {
        Some(v) => *v,
        None => {
            let v = key.len() as u32;
            cache.borrow_mut().insert(String::from(key), v);
            v
        }
    }
}

pub fn run() -> (u32, u32) {
    let cache = RefCell::new(HashMap::new());
    let a = lookup(&cache, "ferris");
    let b = lookup(&cache, "ferris");
    (a, b)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn computes_then_hits_the_cache() {
        assert_eq!(run(), (6, 6));
    }
}
```

```solution
use std::cell::RefCell;
use std::collections::HashMap;

pub fn lookup(cache: &RefCell<HashMap<String, u32>>, key: &str) -> u32 {
    let hit = cache.borrow().get(key).copied();
    if let Some(v) = hit {
        return v;
    }
    let v = key.len() as u32;
    cache.borrow_mut().insert(String::from(key), v);
    v
}

pub fn run() -> (u32, u32) {
    let cache = RefCell::new(HashMap::new());
    let a = lookup(&cache, "ferris");
    let b = lookup(&cache, "ferris");
    (a, b)
}
```

@hint The `Ref` guard returned by `borrow()` is a temporary. Ask how long a temporary in a `match` scrutinee lives.
@hint It lives until the end of the whole `match`, arms included — so the shared borrow is still held when the `None` arm asks for a unique one.
@hint Pull the lookup out into its own statement, ending the borrow before the insert: `let hit = cache.borrow().get(key).copied();`

@diagnose BorrowMutError
`already borrowed: BorrowMutError`, from the `borrow_mut` inside the `None` arm.

`cache.borrow()` returns a `Ref<HashMap<..>>` — a guard that decrements the
cell's borrow counter in its `Drop`. The guard here is a temporary with no name,
and a temporary in a `match` scrutinee is kept alive for the entire `match`
expression, because an arm might be matching on a reference into it.

So on the miss, the shared borrow is still counted when `borrow_mut` asks for the
unique one. Shared plus unique, rejected — at run time, with a panic, on the exact
path that a first-run test would exercise and a cache-hit test would not.

`if` behaves differently: temporaries in an `if` condition are dropped before the
block runs, so the same code written as an `if` would not panic. Depending on
that distinction is not a plan.

@after
This is the whole trade `RefCell` makes, made visible. The rule enforced is
identical to the compiler's — any number of shared, or exactly one unique — but
the enforcement happens while the program runs, so a violation is a crash in
production rather than a red squiggle.

Two habits that avoid nearly all of it. Keep guards short and named: bind the
result of a `borrow()` to a `let`, use it, and let it drop before you take
another. And never hold a borrow across a call that might re-enter the same cell,
which is how this fails in real code — a callback, an observer, a recursive walk.

`try_borrow_mut()` returns `Result<RefMut<T>, BorrowMutError>` if you would
rather decide than crash. It is the right tool for a re-entrant callback and the
wrong tool for hiding a design you have not thought through.

## 7. Rc stops at the thread boundary

@kind fix
@concept Rc
@expect E0277

One vector, read from two threads. `Rc` is the type for several owners, so this
looks correct — and the compiler rejects it on a ground that has nothing to do
with ownership.

Read what it says about `Send`.

```starter
use std::rc::Rc;
use std::thread;

pub fn run() -> usize {
    let data = Rc::new(vec![1, 2, 3]);
    let d = Rc::clone(&data);

    let h = thread::spawn(move || d.len());

    h.join().unwrap() + data.len()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn both_threads_see_it() {
        assert_eq!(run(), 6);
    }
}
```

```solution
use std::sync::Arc;
use std::thread;

pub fn run() -> usize {
    let data = Arc::new(vec![1, 2, 3]);
    let d = Arc::clone(&data);

    let h = thread::spawn(move || d.len());

    h.join().unwrap() + data.len()
}
```

@hint The problem is the counter, not the data. Ask what happens if two threads increment it at once.
@hint `Rc` uses a plain integer for its count. There is a sibling type that uses an atomic one.
@hint `std::sync::Arc`, `Arc::new`, `Arc::clone`. Nothing else changes.

@diagnose E0277
`Rc<Vec<i32>> cannot be sent between threads safely`, with
`the trait Send is not implemented for Rc<Vec<i32>>`, and a note that the
requirement comes from the bound on `thread::spawn`.

`Rc`'s strong count is an ordinary `usize` incremented with an ordinary `add`.
Two threads cloning at once can read the same value, both add one, and both write
back — one increment lost. The count then reaches zero while a handle is still
live, the value is freed, and the survivor is holding a dangling pointer.

So `Rc` is deliberately marked `!Send`, and `thread::spawn` requires `Send` on
everything the closure captures. The bug is caught at the type level, at compile
time, rather than showing up as a use-after-free once a month under load.

@diagnose E0373
`closure may outlive the current function`. You removed the `move`, so the
closure borrowed `data` rather than taking the handle — and the compiler cannot
prove the thread ends before `run` does. `move` is what transfers the cloned
handle in, which is why the clone is made before the `spawn`.

@after
`Arc` is byte-for-byte `Rc` with `fetch_add`/`fetch_sub` in place of `+= 1`. Both
are one pointer, both free the value at zero. The atomic version costs a few
nanoseconds per clone and considerably more when several cores are contending for
the same cache line, which is why the two types both exist rather than one type
always being safe.

The general shape is worth naming: **`Send` means safe to move to another thread,
`Sync` means safe to share by reference between threads.** Neither is implemented
by hand — they are derived structurally, so a struct is `Send` when its fields
are. Putting one `Rc` inside a type is enough to make the whole thing `!Send`
forever, which is a good thing the day someone tries to spawn a thread with it.

Note that `Arc<T>` alone still only hands out `&T`. Mutation across threads needs
`Arc<Mutex<T>>`, which is the same nesting as `Rc<RefCell<T>>` from exercise 5.

## 8. A tree that points both ways

@kind fix
@concept Weak
@expect E0609

A parent holds its children, and each child needs to reach its parent. The
`parent` field is a `Weak<Node>` — a handle that does not own — and the code
tries to read a field straight through it.

A `Weak` might be pointing at something already freed, so it does not let you.

```starter
use std::cell::RefCell;
use std::rc::{Rc, Weak};

pub struct Node {
    pub name: String,
    pub parent: RefCell<Weak<Node>>,
    pub children: RefCell<Vec<Rc<Node>>>,
}

pub fn node(name: &str) -> Rc<Node> {
    Rc::new(Node {
        name: String::from(name),
        parent: RefCell::new(Weak::new()),
        children: RefCell::new(Vec::new()),
    })
}

pub fn run() -> (String, bool) {
    let root = node("root");
    let leaf = node("leaf");

    root.children.borrow_mut().push(Rc::clone(&leaf));
    *leaf.parent.borrow_mut() = Rc::downgrade(&root);

    let parent_name = leaf.parent.borrow().name.clone();

    let gone = node("gone");
    let w = Rc::downgrade(&gone);
    drop(gone);

    (parent_name, w.upgrade().is_none())
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn walks_up_and_notices_a_dead_parent() {
        assert_eq!(run(), (String::from("root"), true));
    }
}
```

```solution
use std::cell::RefCell;
use std::rc::{Rc, Weak};

pub struct Node {
    pub name: String,
    pub parent: RefCell<Weak<Node>>,
    pub children: RefCell<Vec<Rc<Node>>>,
}

pub fn node(name: &str) -> Rc<Node> {
    Rc::new(Node {
        name: String::from(name),
        parent: RefCell::new(Weak::new()),
        children: RefCell::new(Vec::new()),
    })
}

pub fn run() -> (String, bool) {
    let root = node("root");
    let leaf = node("leaf");

    root.children.borrow_mut().push(Rc::clone(&leaf));
    *leaf.parent.borrow_mut() = Rc::downgrade(&root);

    let parent_name = leaf.parent.borrow().upgrade().unwrap().name.clone();

    let gone = node("gone");
    let w = Rc::downgrade(&gone);
    drop(gone);

    (parent_name, w.upgrade().is_none())
}
```

@hint A `Weak` does not keep the value alive, so it cannot promise there is a value to read.
@hint There is one method that asks "is it still there?", and its answer is an `Option`.
@hint `leaf.parent.borrow().upgrade().unwrap().name.clone()`.

@diagnose E0609
`no field name on type Ref<'_, Weak<Node>>`.

Three layers, and the error names all of them. `borrow()` gave you a `Ref`, which
derefs to the `Weak<Node>` inside — and a `Weak` is not a `Node`. It has no
fields to read, because it does not own anything and the value it refers to may
already have been dropped.

`upgrade()` is the question you have to ask: it returns `Option<Rc<Node>>`,
`Some` while at least one strong handle still exists and `None` once the last one
has gone. Nothing else can reach through a `Weak`, and that is the entire safety
argument for it.

@diagnose E0308
`expected Weak<Node>, found Rc<Node>`. `Rc::downgrade(&root)` is the conversion —
it takes a strong handle and gives back a weak one, bumping the weak count rather
than the strong one. Assigning `Rc::clone(&root)` into the `parent` field instead
would type-check only if the field were `RefCell<Rc<Node>>`, which is the bug
this whole structure is arranged to avoid.

@after
The second half of the test is the point. `gone` had one strong handle; `drop`
took it to zero, the `Node` was destroyed, and `w.upgrade()` now returns `None`
rather than a pointer into freed memory.

Had `parent` been an `Rc<Node>`, root and leaf would each hold a strong handle to
the other. Both counts sit at 1 after the locals drop, neither ever reaches zero,
and both allocations leak. That is the one way to leak memory in safe Rust, and
it is allowed because leaking is not *unsound* — nothing dangles, nothing is
freed twice. `mem::forget` is a safe function for the same reason.

The rule that avoids it in any parent-child structure: **strong down, weak up.**
Ownership points one way, the back-references do not own. Dropping the root then
drops the whole tree, and no child can keep its parent alive.
