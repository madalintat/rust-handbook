---
num: 18
slug: 18-smart-ptr
title: Smart pointers
accent: plum
concepts: Box, Deref, deref coercion, Drop, Rc, Arc, RefCell, interior mutability, Weak, reference cycle, Cell
needs: 05-ownership, 06-borrowing, 14-traits
blurb: Box, Rc, RefCell and Weak — each buys one exemption from the ownership rules, and each states its price on the label.
---

%% A smart pointer is a struct that owns something, points at it, and does something extra when it is dropped. `String` and `Vec<T>` already are ones. This unit is about the handful you reach for deliberately, and every one of them exists because a default from unit 05 is occasionally wrong: the value must live on the heap, or it genuinely has two owners, or it must be mutated through a shared reference.

None of them weaken the rules. Each buys one exemption and charges for it, and the charge is always visible in the type.

## Box: the plain owning pointer

### A value on the heap, a handle on the stack

```rust
let n = Box::new(5i32);
println!("{}", *n + 1);
```

:::memory Box<i32>
       STACK                          HEAP
     ┌──────────────┐               ┌───────────┐
 n   │ ptr    ●─────┼──────────────▶│     5     │
     └──────────────┘               └───────────┘
     8 bytes                        freed when n drops. That is all.
:::

One pointer, one owner, dropped like any other value. `Box<T>` adds nothing to
`T` but an indirection — no count, no flag, no header. It is the cheapest
possible way to say *this lives on the heap*.

Boxing an `i32` is pointless. Two situations make it necessary.

### A recursive type has no size otherwise

```rust,bad
enum Expr {
    Num(i64),
    Add(Expr, Expr),      // error[E0072]: recursive type has infinite size
}
```

An enum is laid out as its largest variant plus a tag, so computing
`size_of::<Expr>()` requires already knowing `size_of::<Expr>()`. There is no
fixed point, and the compiler says so.

```rust,good
enum Expr {
    Num(i64),
    Add(Box<Expr>, Box<Expr>),
}
```

A `Box` is one pointer whatever is at the far end, so the recursion is cut:
`Add` is sixteen bytes, `Num` is eight, `Expr` is a tag plus sixteen. Every
linked list, tree and syntax node in Rust has this shape somewhere.

### A trait object has no size either

```rust
let shapes: Vec<Box<dyn Draw>> = vec![Box::new(Circle::new()), Box::new(Square::new())];
```

`dyn Draw` is unsized — a `Circle` and a `Square` are different sizes and both
are `dyn Draw`, so no single number describes it. `Box<dyn Draw>` is a **fat
pointer**: data pointer plus **vtable** pointer, two words, known at compile
time. `Vec<dyn Draw>` is rejected with `E0277`, because `Vec` needs to know how
far apart its elements are.

:::gotcha
`Box::new(huge)` does not avoid building `huge` on the stack. The value is
constructed in the caller's frame and then copied into the fresh allocation. The
optimiser usually removes the copy; in a debug build with a megabyte-sized array
it will overflow the stack instead.

There is no stable way to construct directly into a box. The fix is to build
incrementally — `Vec::with_capacity` and push, or a builder that writes in place.
:::

## Deref and coercion

### One trait, and why `*` works

```rust
impl<T> Deref for Box<T> {
    type Target = T;
    fn deref(&self) -> &T { /* the pointer */ }
}
```

`*b` compiles to `*(b.deref())`. Implementing `Deref` is exactly what makes a
struct behave like a pointer to its target — the `*` operator, method lookup,
and the coercion below.

### `&String` becomes `&str` for free

:::note
Where a `&U` is expected and you have a `&T` with `T: Deref<Target = U>`, the
compiler inserts the `deref` calls silently, repeating until the types line up.
:::

```rust
fn greet(name: &str) { println!("hi {name}"); }

let s = String::from("ferris");
greet(&s);                      // &String → &str
let b = Box::new(s);
greet(&b);                      // &Box<String> → &String → &str
```

`String: Deref<Target = str>` and `Vec<T>: Deref<Target = [T]>` are the entire
reason "take `&str`, not `&String`" costs the caller nothing. They are also why
`v.first()` works on a `Vec` when `first` is defined on `[T]`: method lookup
tries `Vec<T>`, fails, derefs to `[T]`, and finds it.

:::compare
**C++** — `operator*` and `operator->` are two separate overloads you write by
hand, and there is no automatic chaining at a call site. Rust has one trait and
applies it transitively, which is why `&Rc<RefCell<Vec<u8>>>` can be handed to
something wanting `&[u8]` with no ceremony.
:::

:::gotcha
Deref coercion is for **pointer-like** types. Using it to fake inheritance goes
wrong fast: give `struct Config(Settings)` a `Deref` impl and every `Settings`
method silently appears on `Config`, with no way to hide one, no way to override
one, and baffling errors when a name collides later. A newtype should delegate
the methods it means to expose, by hand.
:::

## Drop, and why you cannot call it

```rust
struct Conn { host: String }

impl Drop for Conn {
    fn drop(&mut self) {
        println!("closing {}", self.host);
    }
}
```

The signature is `&mut self`, not `self` — the value is mid-destruction and its
fields are dropped after your code returns, so you get a borrow of it rather than
ownership.

:::gotcha
`c.drop()` is `error[E0040]: explicit use of destructor method`. If it were
allowed, your destructor would run there *and* again at end of scope. A double
free, in the one place the language is guaranteeing there is not one.

`drop(x)` is the correct spelling, and it is not a compiler intrinsic:

```rust
pub fn drop<T>(_x: T) {}
```

An empty body. It takes `x` **by value**, so calling it *moves* `x` in, and `_x`
falls out of scope on the closing brace. Ownership was already sufficient.
:::

## Rc: shared ownership by count

Sometimes a value really does have several owners and no static answer to which
one outlives the others — a node reachable by two paths in a graph, a parsed
config held by ten subsystems.

```rust
use std::rc::Rc;

let cfg = Rc::new(Config::load());
let a = Rc::clone(&cfg);       // strong count 2
let b = Rc::clone(&cfg);       // 3
drop(a);
drop(b);                       // 1
                               // cfg drops → 0 → Config finally freed
```

:::memory Rc<Config>: three handles, one allocation
       STACK                           HEAP
     ┌──────────┐              ┌──────────────────────┐
 cfg │ ptr ●────┼─────────────▶│ strong   3           │
     ├──────────┤        ┌────▶│ weak     0           │
 a   │ ptr ●────┼────────┤     ├──────────────────────┤
     ├──────────┤        │     │ Config { .. }        │
 b   │ ptr ●────┼────────┘     └──────────────────────┘
     └──────────┘               the counts live with the value
:::

`Rc::clone(&cfg)` copies a pointer and adds one to an integer. It does not clone
the `Config`. It is spelled as an associated function rather than `cfg.clone()`
purely so a reader can tell the cheap duplication from the expensive one without
looking up a type.

:::note
`Rc<T>` gives you many owners and **only `&T`**. There is no way to mutate
through it, and that is not an oversight: several owners plus mutation is
precisely the aliasing the borrow checker exists to reject.

Its counter is a plain `usize`, not atomic, so `Rc` is neither `Send` nor `Sync`
and the compiler refuses to let one cross a thread boundary. `Arc<T>` is the same
type with atomic increments, and you pay for them.
:::

## Interior mutability

### RefCell: the borrow check, moved to run time

`Rc` hands out `&T`, and eventually you need to write through one — a cache
behind a read-only API, a node whose children change. A `&self` method that
mutates needs **interior mutability**.

```rust
use std::cell::RefCell;

let log = RefCell::new(Vec::new());
log.borrow_mut().push("boot");          // &self, and it mutates
println!("{}", log.borrow().len());
```

`borrow()` returns a `Ref<T>` and `borrow_mut()` a `RefMut<T>`; the cell keeps a
counter, and the guards decrement it in their `Drop`. The rule enforced is the
same rule as always — any number of shared, or exactly one unique — but it is
checked while the program runs.

:::gotcha
Breaking it is a **panic**, not a compile error.

```rust
let a = log.borrow_mut();
let b = log.borrow_mut();   // panicked at 'already mutably borrowed: BorrowMutError'
```

The realistic version is subtler, because a guard lives as long as the temporary
holding it. A `match` keeps its scrutinee alive for the whole `match`:

```rust,bad
match cache.borrow().get(key) {              // Ref held across both arms
    Some(v) => v.clone(),
    None    => cache.borrow_mut().insert(key, compute()),   // panic
}
```

Bind the lookup result first, let the `Ref` drop, then take the `borrow_mut`.
`try_borrow_mut` returns a `Result` if you would rather decide than crash.
:::

The honest trade: `RefCell` converts a question the compiler could not answer
into one your test suite has to. That is the right deal when the aliasing pattern
is genuinely dynamic and a bad deal when it is a way to avoid restructuring —
because the failure mode is a panic on a path nobody exercised.

### `Rc<RefCell<T>>`

```rust
let inbox: Rc<RefCell<Vec<String>>> = Rc::new(RefCell::new(Vec::new()));
let handle = Rc::clone(&inbox);

handle.borrow_mut().push("hello".into());
assert_eq!(inbox.borrow().len(), 1);
```

Read it outside in. **`Rc`**: several owners. **`RefCell`**: any of them may
mutate. The threaded equivalent is `Arc<Mutex<T>>` and it is the same sentence
with the checks made atomic and the failure made blocking rather than panicking.

It is the right answer for an observer list, a graph with edges in both
directions, a widget tree, an interpreter's environment. It is a smell when it
appears because a function needed to reach a value two frames up the stack —
that is usually a `&mut` parameter nobody wanted to thread through, and threading
it through is the cheaper fix.

## Cycles: the one leak in safe Rust

```rust
struct Node { next: RefCell<Option<Rc<Node>>> }

let a = Rc::new(Node { next: RefCell::new(None) });
let b = Rc::new(Node { next: RefCell::new(Some(Rc::clone(&a))) });
*a.next.borrow_mut() = Some(Rc::clone(&b));      // a → b → a
```

:::memory a cycle nothing can free
     ┌────────────────┐         ┌────────────────┐
     │ Node a         │────────▶│ Node b         │
     │ strong 2       │◀────────│ strong 2       │
     └────────────────┘         └────────────────┘
              ▲                         ▲
              └── the locals drop; each count falls to 1, never to 0
:::

Both allocations become unreachable and neither is freed. This is a real memory
leak in entirely safe code, and it is permitted, because leaking is not
*unsound*: nothing dangles, nothing is freed twice, nothing reads memory it
should not. `mem::forget` is a safe function for the same reason.

:::note
`Weak<T>` is a handle that does not own. It bumps the weak count, which keeps the
allocation's header alive but not the value inside it, and `upgrade()` returns
`Option<Rc<T>>` — `None` once the last strong handle has gone.
:::

The rule for any parent-child structure: **strong down, weak up.** A parent holds
`Rc<Node>` children; a child holds a `Weak<Node>` parent. Dropping the root then
drops the whole tree, and no child can keep its parent alive.

### Cell, for Copy types

```rust
use std::cell::Cell;

struct Counter { hits: Cell<u32> }

impl Counter {
    fn record(&self) {                       // note: &self
        self.hits.set(self.hits.get() + 1);
    }
}
```

`Cell<T>` has no borrow flags and never hands out a reference to its interior —
only `get` (a copy out) and `set` (a whole value in). Nothing can alias what is
never lent, so there is nothing to check. Zero overhead, cannot panic, limited to
`Copy` types plus whole-value `replace` and `take`. For a counter or a flag
behind `&self` it beats `RefCell` on every axis.

## The summary

| | owners | mutate through it | threads | run-time cost |
|---|---|---|---|---|
| `&T` / `&mut T` | none, borrows | `&mut` only | either | nothing |
| `Box<T>` | one | yes, if you own it | either | one indirection |
| `Rc<T>` | many | no | single-threaded only | non-atomic inc/dec |
| `Arc<T>` | many | no | any | atomic inc/dec |
| `Cell<T>` | wrapper | get/set whole values | `!Sync` | nothing |
| `RefCell<T>` | wrapper | yes, checked at run time | `!Sync` | a counter, and a panic when wrong |
| `Mutex<T>` | wrapper | yes, one at a time | any | a lock, and blocking |

The combinations come from composition, not from more types:
`Rc<RefCell<T>>` for shared mutable state in one thread, `Arc<Mutex<T>>` for
shared mutable state across several.

:::note
**The habit.** Start with a plain value, then `&` or `&mut`. Reach for `Box` only
when the size is unknown or the type recursive; for `Rc` only when ownership is
genuinely shared; for `RefCell` only when the aliasing is genuinely dynamic.

Every step down that list moves a check out of the compiler and into production.
:::
