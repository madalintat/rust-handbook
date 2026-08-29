---
unit: 08-structs
---

## 1

Does this compile?

```rust
struct Config { host: String, port: u16 }

let c = Config { host: String::from("localhost") };
```

- A. Yes, `port` defaults to 0
- *B. No, every field must be given a value
- C. Yes, but `c.port` panics when read
- D. No, `host` must be a `&str`

@why
`error[E0063]: missing field `port` in initializer of `Config``. There is no
partial construction and no implicit default: a `Config` either has both fields
or does not exist.

A is the intuition from C, Go or Java, where an uninitialised field is zero or
null and every method downstream has to defend against it. Rust's position is
that a type should not be able to hold a value that makes no sense.

The two ways to write fewer field names, `..other` and `..Default::default()`,
are not exceptions. Both still produce a complete struct; they source the missing
values from somewhere else.

## 2

What is the difference between an associated function and a method?

- *A. A method takes a form of `self` as its first parameter; an associated function does not
- B. Methods are public, associated functions are private
- C. Associated functions must be called `new`
- D. Methods live in `impl` blocks, associated functions do not

@why
That is the entire distinction, and it decides the call syntax: `Config::new(x)`
with `::` for the one with no receiver, `c.url()` with `.` for the one with a
receiver. Both live in the same `impl` block.

C is worth killing explicitly. `new` is a **convention**, and nothing in the
language knows the name. A type may have several constructors (`Vec::new`,
`Vec::with_capacity`, `Vec::from`) or none at all, and calling one `create` or
`open` is perfectly legal.

## 3

`fn area(self) -> u32` on a non-`Copy` struct. What does calling `r.area()`
commit the caller to?

- A. Nothing, `self` is passed by reference internally
- *B. Giving up ownership of `r`; it cannot be named afterwards
- C. Declaring `r` as `mut`
- D. Cloning `r` at the call site

@why
`r.area()` is `Rect::area(r)` with the receiver moved to the left of the dot. A
by-value receiver is a by-value argument, so the value moves in and the binding
is dead afterwards, giving `error[E0382]` on the next use.

A is the Python intuition, where `self` is always a reference. Rust splits that
one word into three (`&self`, `&mut self`, `self`) and the split is in the
signature, so a caller knows before calling whether a method reads, writes or
consumes.

Taking `self` for a getter is the most common self-inflicted wound in a new API:
it compiles fine while you write the type and forces `.clone()` on everyone who
uses it.

## 4

Which receiver should a method that only reads two fields and returns a number
have?

- *A. `&self`
- B. `&mut self`
- C. `self`
- D. No receiver, make it an associated function taking the struct

@why
`&self` asks for the least and therefore permits the most: the caller keeps the
value, can call the method twice, can hold other shared borrows at the same time,
and can call it through a `&Config` it does not own.

`&mut self` would compile and would then require a `mut` binding at every call
site and exclude every other live borrow, for no benefit. `self` would destroy
the value.

The rule of thumb: **`&self` unless you must mutate, `&mut self` unless you must
consume.** Take `self` for exactly two reasons: moving a field out without
copying it, or deliberately ending the value's life (`build`, `close`, `finish`).

## 5

Does this compile?

```rust
struct Settings { host: String, port: u16 }

let base = Settings { host: String::from("x"), port: 80 };
let dev = Settings { port: 3000, ..base };
println!("{}", base.port);
```

- A. Yes, `..base` copies the remaining fields
- *B. No, `..base` moved `host` out, so `base` is partially moved
- C. No, you cannot use `..` with only two fields
- D. Yes, because `port` was listed explicitly and never touched

@why
`error[E0382]: borrow of partially moved value: base`. `..base` does not copy the
struct; it moves each field it needs, one at a time. `host` is a `String`, so its
heap handle moved into `dev`, and a struct with a moved-out field cannot be used
as a value any more.

D is the sharpest distractor because its reasoning is half right: `port` really
was untouched. But `base` as a whole is no longer a complete `Settings`, and the
`{}` in the `println!` borrows the struct to reach the field.

The trap is that this depends entirely on the field types. Drop the `String` and
the identical code compiles, because `u16` is `Copy`.

## 6

What does `#[derive(Clone)]` actually generate?

- A. A memcpy of the struct's bytes
- *B. A `clone` method that calls `clone` on every field
- C. A deep copy of everything reachable, including behind references
- D. Nothing, it is a marker trait

@why
The derive is mechanical: field by field, calling each field's own `clone`. That
is why it requires every field to be `Clone`, and why the depth of the copy is
whatever the fields say it is.

C is the interesting near-miss. Cloning a struct holding a `&T` clones the
*reference*, which copies an address rather than the thing behind it. Cloning one holding
an `Rc<T>` increments a count and shares the same allocation. "Deep" and
"shallow" are not properties of `Clone`; they are properties of the fields.

A describes `Copy`, which is a different trait, generates no code at all, and is
forbidden for any type with a `Drop` impl.

## 7

Does this compile?

```rust
#[derive(Copy, Clone)]
struct User { id: u32, name: String }
```

- A. Yes
- *B. No, `String` is not `Copy`, so `User` cannot be
- C. No, you cannot derive two traits at once
- D. Yes, but `name` is shared between copies

@why
`error[E0204]: the trait Copy cannot be implemented for this type; field name
does not implement Copy`. `Copy` is inherited from the fields, and one owned
field rules it out permanently, no matter how many `u32`s sit beside it.

D describes what would happen if it were allowed, and is exactly why it is not:
two `User` values pointing at one heap buffer, both dropping it. `Copy` and
`Drop` are mutually exclusive for this reason.

Removing `Copy` and keeping `Clone` is the fix, and it costs nothing you wanted:
the difference is only whether duplication is implicit or written down.

## 8

What does `{:#?}` do that `{:?}` does not?

- A. It prints private fields as well
- *B. It prints one field per line, indented
- C. It uses `Display` instead of `Debug`
- D. It escapes non-ASCII characters

@why
`{:#?}` is the *alternate* form of the same `Debug` impl: the `#` flag is passed
to the formatter, and the derived implementation responds by spreading the output
over multiple lines.

Both forms print every field regardless of visibility; `Debug` is generated
inside the type's own module, so privacy does not apply to it.

`{}` is `Display` and is never derived: how a value should be shown to a user has
no mechanical answer, so Rust makes you write it or do without.

Worth adopting: `dbg!(&x)` prints the file, the line, the expression source *and*
the `{:#?}` form, then hands the value back.

## 9

`#[derive(Default)]` on `struct Client { timeout_ms: u32, retries: u8 }` produces
`Client { timeout_ms: 0, retries: 0 }`. When is that the wrong thing to want?

- *A. Whenever zero is a meaningful but wrong value for the field
- B. Whenever the struct has more than three fields
- C. Never, the derive is always the right default
- D. Whenever the struct derives `Debug`

@why
A timeout of zero and zero retries is not a neutral starting point, it is a
broken client, and the derive produces it silently, so nothing points at the
problem until something times out immediately in production.

Derive `Default` when the zero really is the sensible start: a counter, an empty
collection, an accumulator. Write the impl by hand the moment a field has a
meaningful default that is not the zero.

`Default` earns its keep either way through `..Default::default()`, which is the
closest Rust has to named optional arguments: list the fields that differ, let
the impl supply the rest, and adding a field later breaks no call site.

## 10

Why does the newtype `struct Cents(u64);` cost nothing at runtime?

- *A. A single-field struct has exactly the layout of its field
- B. The compiler caches the wrapper
- C. It is optimised away only in release builds
- D. It does cost: one extra pointer indirection

@why
A struct is its fields laid out contiguously. One field, with no tag, no header
and no vtable, so `Cents` is eight bytes with the same alignment as `u64`, and
the arithmetic compiles to the same instruction it would have without the
wrapper.

C is a real misconception about Rust generally. Layout is not an optimisation;
`size_of::<Cents>() == size_of::<u64>()` is true in a debug build too. What debug
builds keep is the bounds checks and the overflow checks, not extra struct
headers.

What you bought for that zero cost is a compile error when a `Dollars` is passed
where `Cents` was expected. A unit that used to live in a variable name now sits
in the type system, where it is checked.

## 11

You want `impl Display for Vec<String>`. It is rejected. What is the fix?

- A. Implement it in the same file as `Vec`
- *B. Wrap it: `struct Csv(Vec<String>);` and implement `Display` for that
- C. Add `#[derive(Display)]` to your module
- D. Use `impl Display for &Vec<String>` instead

@why
The coherence rules require that either the trait or the type be local to your
crate, so that two crates cannot each define a different `Display for Vec<String>`
and break whichever one links second. Neither half is yours here.

A newtype makes the type local, and the impl is then allowed. This is why
newtypes appear all over real crates: it is the standard answer to "the type I
need to extend belongs to somebody else".

C is not a thing: `Display` has no derive, on purpose. D changes nothing:
`&Vec<String>` is still built entirely from foreign types.

## 12

`struct Record { id: u8, count: u32, flag: bool }`. What is `size_of::<Record>()`?

- A. 6, one plus four plus one
- B. 12, with C's padding rules
- *C. 8, because the compiler reorders the fields
- D. Unspecified, so the question has no answer

@why
Rust's default layout is unspecified, and the compiler uses that freedom to
reorder: `count` first at four bytes, then `id` and `flag` sharing the tail, then
two bytes of padding to keep the whole thing four-aligned. Eight.

B is what `#[repr(C)]` gives you: declaration order preserved, three bytes of
padding after `id` to align `count`, three more after `flag`. Twelve bytes for the
same six bytes of data.

A ignores alignment entirely. A `u32` must sit at an address divisible by four; a
misaligned load is slower on x86 and a fault on some architectures, so the padding
is not waste, it is the cost of the alignment.

D is technically the pedantic answer and practically unhelpful: the layout is
unspecified so that the compiler *may* do this, and it does.

## 13

When do you need `#[repr(C)]`?

- A. Whenever a struct has more than four fields
- *B. When the bytes are shared with something outside Rust
- C. To make a struct `Copy`
- D. To make a struct smaller

@why
`#[repr(C)]` pins the layout to C's rules: declaration order, C's padding. You
need it exactly when something other than rustc is going to read those bytes: an
FFI call, a memory-mapped hardware register, a file or wire format read with a
straight cast.

D has it backwards. C's rules usually make the struct *larger*, because they
forbid the reordering that lets narrow fields share a gap. `#[repr(C)]` on the
`Record` above takes it from eight bytes to twelve.

Everywhere else, leave it off. Field order in your source stays a readability
decision rather than a performance one, which is a small freedom you get to keep.

## 14

Does this compile?

```rust
struct B { n: u32 }
impl B {
    fn set(&mut self, n: u32) -> &mut Self { self.n = n; self }
    fn build(self) -> u32 { self.n }
}

let x = B { n: 0 }.set(5).build();
```

- A. Yes
- *B. No, `build` needs the value and `set` returned a borrow
- C. No, `B { n: 0 }` is a temporary and cannot have methods called on it
- D. Yes, but `x` is a reference

@why
`error[E0507]: cannot move out of a mutable reference`. `set` hands back
`&mut B`, and `build(self)` needs the `B` itself, by value. Moving out of a
borrow is never allowed: the borrow is a promise to give the value back intact,
and a moved-from value is not.

The fix that makes chained builders work is `fn set(mut self, n: u32) -> Self`.
Ownership then walks down the chain one call at a time and arrives at `build`
still owned.

C is wrong and worth being sure about: methods can be called on temporaries, and
the temporary lives to the end of the statement.

## 15

What is `mut self` in a parameter list?

- A. A fourth kind of receiver, between `&mut self` and `self`
- *B. `self`, moved in, with the local binding marked mutable
- C. A way to mutate the caller's value in place
- D. Invalid syntax

@why
The value is moved in exactly as with `self`; `mut` only says the body may
reassign or mutate its own binding. There are three receivers, not four.

C is the trap. The caller's value has been moved away, so there is nothing left
to mutate in place. If you want the caller to keep the value and see the change,
that is `&mut self`.

Mutability of a parameter is never part of a signature's contract, which is why
you can add or remove the `mut` on any parameter without it being a breaking
change. It is a statement about the body, not about the interface.
