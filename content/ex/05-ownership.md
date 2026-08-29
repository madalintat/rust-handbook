---
unit: 05-ownership
---

## 1. The function ate your string

@kind fix
@concept move
@expect E0382

`describe` only wants to know how long the string is. But look at its signature: it
takes `String` **by value**, which means calling it hands over ownership. When
`describe` returns, its parameter goes out of scope and the buffer is freed. By
the time `run` tries to format `s`, there is nothing there.

Make this compile. There is more than one correct answer, and one of them is
better than the others.

```starter
pub fn describe(s: String) -> usize {
    s.len()
}

pub fn run() -> String {
    let s = String::from("ferris");
    let n = describe(s);
    format!("{s} has {n} bytes")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keeps_the_string() {
        assert_eq!(run(), "ferris has 6 bytes");
    }
}
```

```solution
pub fn describe(s: &str) -> usize {
    s.len()
}

pub fn run() -> String {
    let s = String::from("ferris");
    let n = describe(&s);
    format!("{s} has {n} bytes")
}
```

@hint `describe` never modifies the string and never needs to keep it. It only reads it.
@hint Change the parameter type so the function borrows instead of taking ownership, then pass `&s` at the call site.
@hint `pub fn describe(s: &str) -> usize`, and `&String` coerces to `&str` automatically, so `describe(&s)` just works.

@diagnose E0382
Read the three underlines rustc gave you, because together they are a complete
story:

- `move occurs because s has type String, which does not implement the Copy trait` is the *reason*. A `String` owns a heap buffer, so duplicating its three-word handle would produce two owners of one allocation. Rust will not do that silently.
- `value moved here` under `describe(s)` is *where* ownership left. Passing by value to a function is a move, the same as an assignment.
- `value borrowed here after move` is *what broke*. The `{s}` inside `format!` needs to read `s`, and `s` no longer owns anything to read.

The compiler is not objecting to the `format!`. It is objecting to the
combination: you gave the string away on one line and read it on the next. Fix
either half and it is happy.

@after
The fix you want is `&str`, not `&String`, and the reason is worth internalising
early. A `&String` can only ever point at a heap-allocated `String`. A `&str`
points at *any* run of UTF-8 bytes: one inside a `String`, a literal baked into
the binary, or a slice of either. Taking `&str` makes `describe` callable with
`describe("hi")` as well as `describe(&s)`, at no cost.

The rule of thumb that follows: **take the most general borrowed form your
function can work with.** `&str` over `&String`, `&[T]` over `&Vec<T>`. Return
the owned form; accept the borrowed one.

## 2. Two owners, one buffer

@kind fix
@concept move
@expect E0382

No function call this time. Just an assignment, and an assignment of a
non-`Copy` type is a move.

Both names are supposed to be usable at the end. Make that true.

```starter
pub fn run() -> String {
    let a = String::from("crab");
    let b = a;
    format!("{a} and {b}")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn both_survive() {
        assert_eq!(run(), "crab and crab");
    }
}
```

```solution
pub fn run() -> String {
    let a = String::from("crab");
    let b = a.clone();
    format!("{a} and {b}")
}
```

@hint You genuinely need two usable `String` values here, so borrowing will not do. You need a second buffer.
@hint `clone()` asks the allocator for a fresh buffer and copies the bytes in, leaving the original untouched.

@diagnose E0382
`let b = a;` copied the three-word handle out of `a` and into `b`, and then the
compiler retired `a`. It had to. If both bindings stayed live, both would be
dropped at the end of `run`, and both drops would hand the same heap buffer back
to the allocator. That is a double free, exactly the class of bug this rule
exists to make unwriteable.

Nothing was scrubbed from `a` at runtime; its bytes are still sitting in the
stack frame. What changed is purely the compiler's bookkeeping: `a` is marked
moved-from, and naming it is now an error.

@after
This is the one case where `clone()` is unambiguously right. You asked for two
independent strings, and two independent strings cost one allocation. Nothing
cheaper would be correct.

Be careful not to over-learn it. Cloning to silence the borrow checker when you
only needed to *read* the value is the most common way to write slow Rust. The
question to ask is always: do I need a second value, or do I just need a second
look? Only the first justifies a clone.

## 3. The integer that stayed

@kind fix
@concept Copy
@expect E0382

Two bindings, two copies, two very different outcomes. One of these lines is
fine and the other is not, and the difference is the entire `Copy` trait.

Fix the broken half without changing the working half.

```starter
pub fn run() -> (i32, String) {
    let n = 5;
    let s = String::from("hi");

    let n2 = n;
    let s2 = s;

    (n + n2, format!("{s}{s2}"))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn copies_and_clones() {
        assert_eq!(run(), (10, String::from("hihi")));
    }
}
```

```solution
pub fn run() -> (i32, String) {
    let n = 5;
    let s = String::from("hi");

    let n2 = n;
    let s2 = s.clone();

    (n + n2, format!("{s}{s2}"))
}
```

@hint `let n2 = n;` is fine and `let s2 = s;` is not. Ask what is different about the two types.
@hint An `i32` is four bytes with nothing behind it, so duplicating the bytes duplicates the whole value. A `String` has a heap buffer behind it, so duplicating the bytes would produce two handles to one allocation.

@diagnose E0382
Note which line rustc points at, and which it says nothing about. `let n2 = n;`
draws no complaint at all, because `i32` implements `Copy`: duplicating its four
bytes produces a genuinely complete, independent second value, so both bindings
can stay live.

`String` cannot implement `Copy`, and this is structural rather than a design
preference. `Copy` and `Drop` are mutually exclusive: a type that needs a
destructor cannot be silently duplicated, because then the destructor would run
twice on one resource. `String` has a destructor that frees its buffer.
Therefore `String` can never be `Copy`. The same argument rules out `Vec<T>`,
`Box<T>`, `File`, and every other type that owns something.

@after
The useful shorthand: **a type is `Copy` only if it owns nothing that needs
cleaning up.** Integers, floats, `bool`, `char`, shared references `&T`, and
arrays and tuples built entirely out of those.

Notably `&T` is `Copy`. Copying a reference copies an address, and the reference
does not own the thing it points at, so no destructor is involved.
That is why you can pass a `&str` to five functions in a row without a single
complaint, and it is a large part of why borrowing feels so much lighter than
owning.

## 4. The loop ate the vector

@kind fix
@concept move
@expect E0382

`total` looks harmless. It is not: `for x in v` iterates **by value**, which
consumes the vector. After the call, `v` in `run` has been moved away.

Make both the sum and the length available.

```starter
pub fn total(v: Vec<i32>) -> i32 {
    let mut sum = 0;
    for x in v {
        sum += x;
    }
    sum
}

pub fn run() -> (i32, usize) {
    let v = vec![1, 2, 3, 4];
    let t = total(v);
    (t, v.len())
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sums_without_consuming() {
        assert_eq!(run(), (10, 4));
    }
}
```

```solution
pub fn total(v: &[i32]) -> i32 {
    let mut sum = 0;
    for x in v {
        sum += x;
    }
    sum
}

pub fn run() -> (i32, usize) {
    let v = vec![1, 2, 3, 4];
    let t = total(&v);
    (t, v.len())
}
```

@hint `total` only reads the numbers. It has no reason to take ownership of the vector.
@hint Take `&[i32]` and iterate with `for x in v`. Iterating a reference yields references, and `sum += x` still works because `i32` arithmetic auto-dereferences here.
@hint `pub fn total(v: &[i32]) -> i32`, called as `total(&v)`. A `&Vec<i32>` coerces to `&[i32]` for free.

@diagnose E0382
Two moves are hiding here and it is worth separating them.

The first is `total(v)` in `run`. Passing by value moves the vector into the
function, and that is the move rustc is complaining about.

The second is inside `total` itself: `for x in v` calls `IntoIterator::into_iter`,
which takes `self` by value and consumes the vector. That one is not the error
you are seeing, but it is why `total` could not give the vector back even if it
wanted to.

Iterating comes in three flavours and the difference is exactly this:
`for x in v` consumes and yields `T`, `for x in &v` borrows and yields `&T`, and
`for x in &mut v` borrows uniquely and yields `&mut T`.

@after
`&[i32]` rather than `&Vec<i32>` for the same reason exercise 1 wanted `&str`.
A slice is a pointer plus a length, so `total` now also accepts arrays, other
slices, and sub-ranges like `total(&v[1..3])`, none of which a `&Vec<i32>`
would have allowed. The function got strictly more useful at the same speed.

## 5. into_ means it takes self

@kind fix
@concept move
@expect E0382

This one compiles fine for one iteration and then falls over, which is exactly
the shape of bug ownership is designed to catch before it ships.

The name of the method is the clue.

```starter
pub fn run() -> usize {
    let s = String::from("ferris");
    let mut total = 0;

    for _ in 0..3 {
        total += s.into_bytes().len();
    }

    total
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_three_times() {
        assert_eq!(run(), 18);
    }
}
```

```solution
pub fn run() -> usize {
    let s = String::from("ferris");
    let mut total = 0;

    for _ in 0..3 {
        total += s.as_bytes().len();
    }

    total
}
```

@hint Look up `String::into_bytes` and read its signature. What is the receiver?
@hint `into_bytes(self)` consumes the string to hand you its buffer as a `Vec<u8>`. You only want to look, so consuming is the wrong receiver.
@hint `as_bytes(&self)` borrows and gives you `&[u8]`. Swap the call.

@diagnose E0382
`use of moved value: s` inside a loop is almost always this: a method that takes
`self` rather than `&self`, called on a binding that has to survive the next
iteration. The compiler is right even though the first iteration would have
worked, because it must also be correct on iteration two.

The standard library encodes the receiver in the method name, and learning the
convention saves you an enormous amount of time:

- `as_*` borrows: `&self` in, a cheap view out, no allocation
- `to_*` clones: `&self` in, a new owned value out, usually allocates
- `into_*` consumes: `self` in, the receiver is gone afterwards

`into_bytes` is in the third group. `as_bytes` is in the first. You wanted the
first.

@after
The `into_*` family is not a trap; it is how Rust expresses a conversion that
should not cost an allocation. `String::into_bytes` hands you the *same* heap
buffer reinterpreted as a `Vec<u8>`, with nothing copied, which is only sound
because the `String` is destroyed in the process. Consuming the receiver is the
price of the free conversion, and it is usually a good deal.

## 6. Give it back

@kind write
@concept ownership
@expect E0382

Sometimes a function really does need ownership. Here `shout` has to consume
the string to build the new one. The caller still wants a value afterwards.

Write `shout` so that this works. It takes ownership, uppercases, appends an
exclamation mark, and returns ownership of the result.

```starter
pub fn shout(s: String) -> String {
    todo!("uppercase it, add a '!', and hand it back")
}

pub fn run() -> (String, String) {
    let s = String::from("ferris");
    let loud = shout(s);
    (s, loud)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn returns_both() {
        assert_eq!(run(), (String::from("ferris"), String::from("FERRIS!")));
    }
}
```

```solution
pub fn shout(s: String) -> String {
    let mut out = s.to_uppercase();
    out.push('!');
    out
}

pub fn run() -> (String, String) {
    let s = String::from("ferris");
    let loud = shout(s.clone());
    (s, loud)
}
```

@hint Two problems: `shout` is unwritten, and `run` uses `s` after giving it away.
@hint `to_uppercase` borrows and returns a fresh `String`, so it is a good starting point inside `shout`. Then `push` the exclamation mark onto it.
@hint For `run`, the tests demand you still hold the original, so give `shout` something it is allowed to eat. `s.clone()`.

@diagnose E0382
`run` hands `s` to `shout` and then puts `s` in the returned tuple. Once
`shout(s)` has moved it, there is nothing left to put anywhere.

Two shapes fix this and they say different things. `shout(s.clone())` says *I
need my own copy, take yours*. Rewriting `shout` to take `&str` and return a new
`String` says *you never needed to own it in the first place*, which here is
arguably truer, since `to_uppercase` allocates a fresh string anyway. Either
passes; the second is what you would write in real code.

@diagnose E0308
Your `shout` is returning something that is not a `String`. `to_uppercase()`
gives you a `String`, but `push` returns `()`. So if you wrote
`s.to_uppercase().push('!')` as the final expression, the function's value is
`()`, not `String`. Bind it to a `mut` variable first, push onto it, then name
the variable on its own line as the tail expression.

@after
Returning ownership works and it scales badly. A function needing two strings
returns a two-tuple; the caller destructures it; add a third and the signature
starts documenting plumbing rather than intent. That pressure is what makes
borrowing the default in real code, and it is the whole subject of the next unit.

Worth noticing: `todo!()` type-checks as anything at all. It has type `!`, the
never type, so it slots into any position and lets a half-written program still
compile, and it panics loudly if it is ever reached.

## 7. A struct that cannot be Copy

@kind fix
@concept Copy
@expect E0204

This one fails before you have written any logic at all. The derive itself is
rejected, and the error explains a rule that is easy to state and easy to forget.

Make the struct usable. You should still be able to duplicate a `User`
explicitly.

```starter
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct User {
    pub id: u32,
    pub name: String,
}

pub fn run() -> (User, User) {
    let a = User { id: 1, name: String::from("ferris") };
    let b = a.clone();
    (a, b)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn duplicates_explicitly() {
        let (a, b) = run();
        assert_eq!(a, b);
        assert_eq!(a.name, "ferris");
    }
}
```

```solution
#[derive(Clone, Debug, PartialEq)]
pub struct User {
    pub id: u32,
    pub name: String,
}

pub fn run() -> (User, User) {
    let a = User { id: 1, name: String::from("ferris") };
    let b = a.clone();
    (a, b)
}
```

@hint You cannot make this type `Copy`. Ask why, then remove what cannot be there.
@hint `Copy` requires every field to be `Copy`. `String` is not, and cannot be. Drop `Copy` from the derive and keep `Clone`.

@diagnose E0204
`the trait Copy cannot be implemented for this type; field name does not
implement Copy`.

`Copy` means "duplicating my bytes produces a complete, independent second
value". For `User` that would duplicate `id`, which is fine: four bytes with
nothing behind them. It would also duplicate the three-word handle inside `name`,
leaving two `User` values pointing at one heap buffer. Both would drop it. That
is a double free.

So the rule is inherited: **a struct can be `Copy` only if every one of its
fields is `Copy`.** One `String`, `Vec`, or `Box` anywhere in the type is enough
to rule it out permanently, no matter how many other fields are integers.

@after
Keeping `Clone` is the right call and costs you nothing you wanted. The
difference is only in who decides: `Copy` duplicates implicitly on every
assignment, `Clone` duplicates when you write `.clone()`. For a type holding a
heap allocation you want that decision visible, because it is the difference
between a pointer copy and a trip to the allocator.

If you had wanted `Copy` badly enough, the move is to change the data rather
than the derive: `id: u32` plus `name: &'static str`, or an interned handle
instead of an owned string. That is a real design rather than a workaround, and
it is a decision about your data, which is exactly the point.

## 8. Drop runs in reverse

@kind fill
@concept drop
@expect E0382

`Noisy` prints when it is dropped, which makes the invisible visible. The
function below is supposed to produce a log of what happened, in order.

Work out what the order actually is, and make the test pass. Note the move on
the second-to-last line, because it changes the answer.

```starter
pub struct Noisy(pub &'static str, pub std::rc::Rc<std::cell::RefCell<Vec<String>>>);

impl Drop for Noisy {
    fn drop(&mut self) {
        self.1.borrow_mut().push(format!("drop {}", self.0));
    }
}

pub fn run() -> Vec<String> {
    let log = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));

    {
        let _first = Noisy("first", log.clone());
        let second = Noisy("second", log.clone());
        let _moved = second;
        log.borrow_mut().push(format!("still here: {}", second.0));
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
    fn drops_in_reverse_declaration_order() {
        assert_eq!(
            run(),
            vec![
                "still here: second".to_string(),
                "drop second".to_string(),
                "drop first".to_string(),
            ]
        );
    }
}
```

```solution
pub struct Noisy(pub &'static str, pub std::rc::Rc<std::cell::RefCell<Vec<String>>>);

impl Drop for Noisy {
    fn drop(&mut self) {
        self.1.borrow_mut().push(format!("drop {}", self.0));
    }
}

pub fn run() -> Vec<String> {
    let log = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));

    {
        let _first = Noisy("first", log.clone());
        let second = Noisy("second", log.clone());
        let moved = second;
        log.borrow_mut().push(format!("still here: {}", moved.0));
    }

    let out = log.borrow().clone();
    out
}
```

@hint `let _moved = second;` moves the value. Reading `second.0` on the next line is the error.
@hint The value did not disappear. It is in `_moved` now, so read it through its new owner.
@hint Give the new binding a real name and use it: `let moved = second;` then `moved.0`.

@diagnose E0382
`second` was moved into `_moved`, so `second.0` has nothing to read. The value is
alive and well under a different name.

The interesting part is what the test asserts about *when* things drop. Inside
the block there are two live values at the end: `_first` and `_moved`. They drop
in reverse declaration order, `_moved` first and then `_first`, so the log reads
`drop second` before `drop first`.

The binding `second` is **not** dropped, because it no longer owns anything. Had
it been dropped as well, `Noisy("second")` would have run its destructor twice
and the log would show `drop second` twice. That is the double free, made
visible: the same value released twice.

@after
Reverse order is not an arbitrary choice. Later bindings are the ones most likely
to depend on earlier ones: a guard borrowed from a lock declared above it, a
writer wrapping a file opened before it. Unwinding in the opposite order to
construction is the only sequence that is always safe.

A related trap worth knowing now: a binding named `_` is dropped **immediately**,
not at end of scope, because `_` is not a binding at all. `let _ = lock.lock();`
takes a lock and releases it on the same line. `let _guard = lock.lock();` holds
it to the end of the scope. That single underscore has ended real production
incidents.
