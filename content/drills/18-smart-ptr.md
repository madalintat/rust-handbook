---
unit: 18-smart-ptr
---

## 1

Does this compile?

```rust
struct Node {
    value: i32,
    next: Option<Node>,
}
```

- A. Yes — `Option` makes the recursion finite
- *B. No — `Node` would have infinite size
- C. No — a struct cannot name itself at all
- D. Yes, but only with `#[repr(C)]`

@why
`error[E0072]: recursive type Node has infinite size`. Computing
`size_of::<Node>()` needs `size_of::<Option<Node>>()`, which needs
`size_of::<Node>()`. No fixed point.

A is the tempting one, because `Option` genuinely does terminate the *recursion
at run time* — a chain ends with `None`. But size is a compile-time question
about the type, not a run-time question about a particular value, and the type
can nest arbitrarily deep. `Option<Box<Node>>` fixes it: eight bytes, whatever is
at the far end.

## 2

How large is `Option<Box<i32>>` on a 64-bit machine?

- A. 16 bytes — the pointer plus a discriminant
- *B. 8 bytes
- C. 12 bytes
- D. 4 bytes — just the `i32`

@why
Eight. A `Box` is guaranteed never to be null, so the compiler uses the
all-zeroes bit pattern as the `None` discriminant instead of adding a separate
tag byte and padding. This is the **niche optimisation**.

A is the reasonable expectation and is what you would get for
`Option<i32>` (8 bytes: 4 for the value, 4 for tag and padding). The niche trick
is why `Option<Box<T>>`, `Option<&T>` and `Option<Rc<T>>` are all free, and why
"a nullable pointer" costs the same in Rust as in C while being impossible to
misuse.

## 3

Why does `greet(&b)` compile, where `fn greet(n: &str)` and `b: Box<String>`?

- A. `Box` implements `AsRef<str>`
- *B. Deref coercion applies repeatedly: `&Box<String>` → `&String` → `&str`
- C. The compiler special-cases `Box`
- D. It does not compile

@why
`Box<String>: Deref<Target = String>` and `String: Deref<Target = str>`, and the
compiler applies the conversion at the call site as many times as needed to reach
the expected type.

C is a common belief and is wrong in a load-bearing way. `Box` is an ordinary
library type with one privilege that is not `Deref` (you may move out of it), and
coercion is a general rule any `Deref` implementor participates in. That is why
`&Vec<T>` becomes `&[T]`, and why taking `&str` rather than `&String` costs the
caller nothing.

## 4

What does `x.drop()` do?

- A. Runs the destructor immediately
- B. Runs the destructor and marks `x` moved
- *C. It does not compile
- D. Nothing — `Drop::drop` takes `&mut self`, so it is a no-op

@why
`error[E0040]: explicit use of destructor method`. If it were allowed, the
destructor would run at that line *and* again when `x` went out of scope, because
`x` still owns the value. A double free, in the one place the language guarantees
there is not one.

D is a sharp guess and gets the signature right for the wrong conclusion. Use
`drop(x)`, which is a free function whose entire body is empty — it works because
it takes `x` **by value**, so the move does all the work and the destructor runs
when the parameter falls out of scope.

## 5

Which of these does `Rc::clone(&a)` do? Choose all that apply.

- *A. Copies a pointer
- *B. Increments a counter
- C. Copies the pointed-to value
- D. Allocates

@why
A pointer copy and an increment. Nothing is duplicated on the heap and no
allocator is involved.

C is the reading the word "clone" invites, and it is why the convention is to
write `Rc::clone(&a)` rather than `a.clone()` even though the two compile to the
same thing. In a file full of `.clone()` calls, the ones that cost an allocation
should not look identical to the ones that cost an increment.

## 6

Does this compile?

```rust
let shared = Rc::new(vec![1, 2, 3]);
shared.push(4);
```

- A. Yes
- *B. No — `Rc` does not implement `DerefMut`
- C. No — `Vec` cannot go inside an `Rc`
- D. Yes, but only if `shared` is `mut`

@why
`error[E0596]: cannot borrow data in an Rc as mutable`. `Rc<T>` implements
`Deref` and deliberately not `DerefMut`.

D is the natural guess and misses the point entirely. `mut` on the binding would
let you replace the handle; it says nothing about the shared value. The refusal
is structural: several owners plus mutation is exactly the aliasing the borrow
checker exists to reject, so `Rc` hands out `&T` only. `Rc<RefCell<Vec<i32>>>`
moves the check to run time and allows it.

## 7

What happens here?

```rust
let c = RefCell::new(5);
let a = c.borrow_mut();
let b = c.borrow_mut();
```

- A. It does not compile
- *B. It compiles and panics at run time
- C. It compiles and works — `RefCell` allows this
- D. Undefined behaviour

@why
`panicked at 'already mutably borrowed: BorrowMutError'`. `RefCell` enforces the
same rule as the borrow checker — many shared or one unique — using a counter it
checks while the program runs.

A is the answer for `&mut` (`E0499`), and the difference is the whole trade
`RefCell` makes. D is the C++ answer, and it is what `RefCell` is designed to
avoid: the check is real, so the failure is a loud panic on the spot rather than
silent corruption. `try_borrow_mut` returns a `Result` if you would rather decide
than crash.

## 8

Which of these panics?

```rust
let cache: RefCell<HashMap<&str, u32>> = RefCell::new(HashMap::new());
```

- *A. `match cache.borrow().get("k") { None => { cache.borrow_mut().insert("k", 1); } _ => {} }`
- B. `let hit = cache.borrow().get("k").copied(); if hit.is_none() { cache.borrow_mut().insert("k", 1); }`
- C. `cache.borrow_mut().insert("k", 1); cache.borrow().len();`
- D. `let n = cache.borrow().len(); cache.borrow_mut().insert("k", 1);`

@why
A. The `Ref` guard from `cache.borrow()` is an unnamed temporary, and a temporary
in a `match` scrutinee lives for the **whole match**, arms included — because an
arm might be matching on a reference into it. So the shared borrow is still
counted when the `None` arm asks for the unique one.

B, C and D all end the guard on their own statement before taking the next
borrow. This is the single most common `RefCell` panic in real code, and the fix
is always the same: bind the result, let the guard drop, then borrow again.

## 9

Why is `Rc<T>` rejected by `thread::spawn`?

- A. Its data might be mutated from two threads
- *B. Its reference count is not atomic, so two threads could lose an increment
- C. `Rc` allocates, and allocation is not thread-safe
- D. It is not, `Rc` works across threads

@why
`Rc<T>` is not `Send`. The strong count is a plain `usize` incremented with an
ordinary add, so two threads can read the same value, both add one, and both
write back — one increment lost. The count then hits zero with a live handle
still out, and the survivor holds a dangling pointer.

A is close but names the wrong hazard: `Rc` hands out `&T` only, so the *data* is
never mutated. It is the bookkeeping that races. `Arc` is the identical type with
`fetch_add`, and you pay for the atomics — which is why both exist.

## 10

What is the difference between `Cell<T>` and `RefCell<T>`?

- A. `Cell` is for the stack, `RefCell` for the heap
- *B. `Cell` never hands out a reference to its interior, so it needs no check
- C. `Cell` is thread-safe, `RefCell` is not
- D. `RefCell` is faster because it has no `Option`

@why
`Cell` only supports get (copy out) and set (whole value in). Nothing can alias
what is never lent, so there is no counter, no guard, no panic, and no cost. The
price is that it works only for `Copy` types, plus whole-value `replace` and
`take`.

C is wrong in a way worth internalising: neither is `Sync`. Both are
single-threaded interior mutability. For a counter or a flag behind `&self`,
`Cell` beats `RefCell` on every axis — reach for `RefCell` only when you need a
reference to the inside.

## 11

Two `Rc` nodes hold handles to each other. What happens when both local bindings
go out of scope?

- A. Both are freed — the compiler notices the cycle
- B. The program panics
- *C. Both counts fall to 1 and neither is ever freed
- D. It is undefined behaviour

@why
Each node's count drops by one as its local handle goes, from 2 to 1. The handle
held by the *other* node keeps each above zero, and neither is reachable to drop
it. Both allocations leak.

A is what a tracing garbage collector would do — it starts from the roots and
would find both unreachable. Reference counting cannot: it only ever sees local
increments and decrements. This is the one way to leak memory in safe Rust, and
it is permitted because a leak is not *unsound*: nothing dangles, nothing is
freed twice. `mem::forget` is a safe function for the same reason.

## 12

In a tree where parents own children and children point back at parents, which
arrangement is correct?

- A. `Rc` both ways
- *B. `Rc` down to children, `Weak` up to the parent
- C. `Weak` down to children, `Rc` up to the parent
- D. `Box` both ways

@why
Strong down, weak up. The parent owns its children, so dropping the root drops
the whole tree; the child's back-reference does not own, so it cannot keep a dead
parent alive.

C is the exact inversion and fails badly: nothing would own the children, so each
would be freed the moment its constructor's local handle went out of scope, and
the parent's `Weak` handles would all upgrade to `None`. A is the cycle from the
previous drill. D cannot express it at all — `Box` is single-ownership, and a
child cannot own a pointer back to something that owns it.

## 13

What does `Weak::upgrade` return?

- A. `Rc<T>`
- *B. `Option<Rc<T>>`
- C. `&T`
- D. `Result<Rc<T>, WeakError>`

@why
`Option<Rc<T>>` — `Some` while at least one strong handle still exists, `None`
once the last has gone and the value has been dropped.

A is what you want it to be and would be unsound: a `Weak` does not keep the
value alive, so there may be nothing at the far end. Making the answer an
`Option` forces the caller to handle the dead case at the one point where it
matters. It is the same design as `Option` for null: the possibility is in the
type, so it cannot be ignored.

## 14

Which of these can be shared safely between threads? Choose all that apply.

- *A. `Arc<Vec<i32>>`
- B. `Rc<Vec<i32>>`
- *C. `Arc<Mutex<Vec<i32>>>`
- D. `Arc<RefCell<Vec<i32>>>`

@why
A and C. `Arc` is `Send + Sync` when its contents are, and `Mutex` makes an
otherwise-unshareable inner type `Sync` by serialising access.

D is the trap and it is a good one, because it looks like the right shape. But
`RefCell` is `!Sync` — its borrow counter is a plain integer with the same race
`Rc`'s count has — so `Arc<RefCell<T>>` is `!Send` and the compiler rejects it.
The pairing is fixed: `Rc` with `RefCell` in one thread, `Arc` with `Mutex`
across several.

## 15

Which of these costs nothing at run time compared with using the value directly?
Choose all that apply.

- *A. `&T`
- *B. `Cell<T>` for a `Copy` type
- C. `Rc<T>`
- D. `RefCell<T>`
- *E. `Box<T>`, once it exists

@why
`&T` is an address. `Cell` is the value itself with no extra state — the
restriction to whole-value get/set is what pays for the check. And a `Box` that
already exists is a plain pointer dereference; the allocation was paid for when
it was made.

C and D both carry state. `Rc` stores two counters beside the value and does an
increment on every clone and a decrement plus a branch on every drop. `RefCell`
stores a borrow counter and checks it on every `borrow` and `borrow_mut`. Neither
is expensive; both are more than nothing, and the summary table exists so you can
pick the cheapest one that expresses what you actually need.
