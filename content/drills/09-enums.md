---
unit: 09-enums
---

## 1

What is `std::mem::size_of::<Shape>()` on a 64-bit machine?

```rust
enum Shape {
    Circle(f64),
    Rect(f64, f64),
    Nothing,
}
```

- A. 8, the size of the largest field
- B. 17, both fields plus a one-byte tag
- *C. 24, a tag padded to 8 plus the two-word payload
- D. 40, every variant laid out end to end

@why
An enum value must be able to hold any variant, so its size is the largest
payload plus room for the discriminant, rounded up to the alignment. Here the
biggest payload is `Rect`'s two `f64`s (16 bytes), the tag needs one byte, and
`f64` alignment forces the payload to start at offset 8. Total 24.

D is the tempting one and describes a *union of structs*, which is what you
would hand-build in C. The variants overlap; they are not concatenated.

## 2

Which of these is true of `Option<&T>`? Choose all that apply.

- *A. It is the same size as `&T`
- *B. `None` is represented by the all-zero bit pattern
- C. It stores a separate one-byte tag next to the pointer
- D. It requires a heap allocation for the `Some` case

@why
A reference is never null, so the bit pattern `0` is a **niche**: a value the
payload can never take. The compiler uses it for `None` and stores no tag at
all. `Option<&T>` is 8 bytes, same as `&T`.

This is why making nullability explicit in Rust is free. The same trick applies
to `Box<T>`, `&mut T`, `NonZeroU32` and `char`. It does *not* apply to
`Option<u8>`, which is 2 bytes, because every bit pattern of a `u8` is already a
legal value.

## 3

Does this compile?

```rust
enum Signal { Red, Amber, Green }

fn go(s: Signal) -> bool {
    match s {
        Signal::Red => false,
        Signal::Green => true,
    }
}
```

- A. Yes, the two cases it lists are the important ones
- *B. No, `error[E0004]`, `Signal::Amber` is not covered
- C. Yes, and `Amber` falls through to `false`
- D. No, match arms cannot return `bool`

@why
`match` is an expression and must produce a value on every possible input.
There is no arm for `Amber`, so there is no value, and the program is rejected.

C is the C intuition and the reason this matters. A C `switch` with no `default`
silently does nothing for the unlisted case; Rust makes it a build failure with
a line number. Adding a fourth signal later turns every incomplete match in the
codebase into an error naming its file. That is the single most useful
refactoring property in the language.

## 4

What does this print?

```rust
let expected = 404;
let code = 200;
let s = match code {
    expected => "matched",
    _ => "no",
};
println!("{s}");
```

- *A. `matched`, with a warning that the second arm is unreachable
- B. `no`
- C. It does not compile, since `expected` is not a constant
- D. `matched`, with no warning at all

@why
A bare lowercase identifier in a pattern is always a **binding**, never a
comparison. `expected` here shadows the outer `expected`, matches any `i32`, and
binds `200` to it. The second arm can never be reached, which is what the
`unreachable_pattern` warning says.

B is what everyone expects the first time and it is the whole trap. To compare
against a value you need a `const` (uppercase by convention, which is why the
convention exists) or a guard: `n if n == expected`.

## 5

Why do match guards not count toward exhaustiveness?

```rust
match n {
    x if x < 0 => "neg",
    x if x >= 0 => "non-neg",
}   // error[E0004]
```

- A. Because guards run at runtime and patterns at compile time
- *B. Because a guard is an arbitrary expression, so deciding whether a set of them is total is undecidable
- C. Because `i32` has too many values to enumerate
- D. Because the two guards overlap at zero

@why
A guard may call a function, read a global, or ask the clock. Proving that two
such expressions between them cover every input is equivalent to solving the
halting problem, so rather than special-case simple arithmetic the rule is
uniform: an arm with a guard contributes nothing to the exhaustiveness check.

C is wrong on its own terms: rustc reasons about `i32` as ranges rather than by
enumeration, which is why the error text names `i32::MIN..=-1_i32` rather than
listing four billion values.

The practical consequence: the arm that closes a match must be unguarded.

## 6

What is `s`'s type here?

```rust
let msg: Option<String> = Some(String::from("hi"));
match &msg {
    Some(s) => { /* here */ }
    None => {}
}
```

- A. `String`
- *B. `&String`
- C. `&Option<String>`
- D. It does not compile, since the pattern is not a reference pattern

@why
This is **match ergonomics**. The scrutinee is `&Option<String>` and the pattern
`Some(s)` is not a reference pattern, so instead of rejecting it the compiler
dereferences the scrutinee and shifts the **binding mode** to by-reference.
Every binding underneath comes out borrowed: `s: &String`.

D was the actual behaviour before Rust 2018, when you had to write `Some(ref s)`
to get the same thing. `ref` still exists and is almost never needed now.

## 7

Which of these move the `String` out of `msg`? Choose all that apply.

```rust
let msg: Option<String> = Some(String::from("hi"));
```

- *A. `match msg { Some(s) => s, None => String::new() }`
- B. `match &msg { Some(s) => s.clone(), None => String::new() }`
- C. `if let Some(s) = &msg { s.len() } else { 0 }`
- *D. `msg.unwrap_or_default()`

@why
A and D take the value by value: matching on `msg` itself binds `s` as an owned
`String`, and `unwrap_or_default` takes `self`. Both leave `msg` moved-from.

B and C match on `&msg`, so the binding mode is by-reference and nothing moves:
`s` is a `&String` in both.

The pattern to internalise: what moves is decided by the *scrutinee*, not by the
pattern. One `&` in front of it changes every binding underneath.

## 8

Does this compile?

```rust
enum Event { Click { x: i32, y: i32 }, Key(char) }

fn describe(e: &Event) -> String {
    match e {
        Event::Click { x } => format!("click {x}"),
        Event::Key(c) => format!("key {c}"),
    }
}
```

- A. Yes, extra fields are ignored
- *B. No, `error[E0027]`, the pattern does not mention field `y`
- C. No, `error[E0004]`, non-exhaustive
- D. Yes, and `y` is bound to its default value

@why
A struct-variant pattern must account for every field, either by naming it or by
writing `..`. `Event::Click { x }` mentions one of two, so it is rejected with
`pattern does not mention field y`.

A is the tempting answer because destructuring in JavaScript and Python does
work that way. Rust makes you write `Event::Click { x, .. }` instead: two extra
characters meaning "and I know there are others". Adding a field later then
breaks only the patterns that did *not* opt out, which is usually exactly the
set you want to revisit.

## 9

Which of these `let else` blocks compile? Choose all that apply.

```rust
fn f(x: Option<u16>) -> u16 {
    let Some(n) = x else { /* HERE */ };
    n
}
```

- *A. `return 0;`
- B. `0`
- *C. `panic!("no value")`
- *D. `std::process::exit(1)`
- E. `n = 0;`

@why
The `else` block must have type `!`, meaning it must not finish. After the statement
`n` has to be in scope and bound, and the only way that can be guaranteed is if
the failing path never reaches the next line. `return`, `panic!`, `exit`,
`break` and `continue` all qualify.

B produces a `u16`, which is a perfectly good value and precisely what is not
allowed: `else clause of let...else does not diverge`.

E is a nice distractor: you cannot assign to `n`, because `n` does not exist
yet. That is the whole reason for the rule.

## 10

What does this evaluate to?

```rust
let code = 418;
let s = match code {
    n @ 200..=299 => format!("ok {n}"),
    n @ 400..=499 => format!("client {n}"),
    _ => "other".to_string(),
};
```

- A. `"other"`
- B. `"client 400"`
- *C. `"client 418"`
- D. It does not compile, since `@` cannot be used with a range

@why
`n @ 400..=499` tests the value against the range **and** binds the matched value
to `n`. Without the `@`, a range pattern throws the value away and you have
nothing to interpolate.

B is the trap: `n` is the value that matched, not the start of the range. The
binding sees `418`.

`@` composes with any pattern, not only ranges: `msg @ Message::Quit` binds the
whole enum value while still testing its variant.

## 11

Which of these can share one match arm via `|`?

```rust
enum Shape { Circle(f64), Square(f64), Rect(f64, f64) }
```

- *A. `Shape::Circle(r) | Shape::Square(r)`
- B. `Shape::Circle(r) | Shape::Rect(w, h)`
- C. `Shape::Circle(r) | Shape::Rect(r, _)` where the arm uses `r` as an `f64`
- D. `Shape::Circle(_) | Shape::Rect(w, _)`

@why
Every alternative in an or-pattern must bind **the same set of names at the same
types**, because the arm body is one piece of code compiled once. A binds `r: &f64`
on both sides, so it is fine.

B fails with `error[E0408]: variable r is not bound in all patterns`, and `w`
and `h` are not bound in the first. D fails the same way for `w`.

C is the interesting one: it is legal. Nothing requires the field to be in the
same position or to have the same name, only that the binding's name and type
agree. That flexibility is also why a typo like `Rect(w, _)` when you meant
`Rect(r, _)` is caught rather than silently doing something else.

## 12

Adding a variant to a public enum breaks downstream `match`es. Which of these is
the *intended* way for a library to opt out of that?

- A. Always include `_ => {}` in the library's own matches
- *B. Mark the enum `#[non_exhaustive]`, which forces downstream matches to have a wildcard
- C. Use a struct with a tag field instead
- D. There is no way, since enums in public APIs can never gain variants

@why
`#[non_exhaustive]` tells other crates "this list will grow", and the compiler
then *requires* a `_` arm in any match on it outside the defining crate. Adding a
variant later is then a non-breaking change. `io::ErrorKind` is the canonical
example.

A does nothing for downstream users, because the library's own matches are not
the problem. And note the asymmetry: inside the defining crate, matches on a
`#[non_exhaustive]` enum are still checked exhaustively, so the author still gets
the compile errors. You only give up the guarantee at the crate boundary, which
is exactly where you wanted to.

## 13

`Option<T>` and `Result<T, E>` are…

- A. Compiler built-ins with special syntax support
- *B. Ordinary enums defined in the standard library, in ordinary Rust
- C. Structs with a hidden boolean flag
- D. Traits implemented by every fallible type

@why
Both are two-variant enums you could have written yourself:

```rust
enum Option<T> { Some(T), None }
enum Result<T, E> { Ok(T), Err(E) }
```

There is no magic in the type. What the language adds around them is convenience
(`?`, the `Try` trait, the prelude importing their variants unqualified) plus
the layout optimisations any enum gets. Understanding that they are just enums
is what makes `match`, `if let` and the combinator methods on them stop feeling
like special cases.

## 14

Why does this state machine take `state` by value rather than `&mut self`?

```rust
fn step(state: Connection, ev: Event) -> Connection { /* ... */ }
```

- A. It is faster, with no pointer indirection
- *B. Consuming the old state makes using a stale state a compile error
- *C. It lets an arm move a field out of the old state into the new one
- D. `&mut self` cannot be used in a `match`

@why
B is the design argument. Once `step` has consumed the old `Connection`, naming
it afterwards is `error[E0382]`. The bug "we read the state we just replaced"
becomes unwriteable.

C is the practical one: `(Connection::Live { socket, .. }, Event::Idle) =>`
can move the `TcpStream` straight into the next state, with no clone and no
`Option` dance. Through a `&mut self` you would need `std::mem::replace` or
`Option::take` to get the same effect.

A is wrong in general: if the enum has a fat variant, moving it by value copies
the whole thing on every transition.

## 15

A `Job` is either queued, running with a worker id, or finished with an exit
code. Which representation makes the invalid states unrepresentable?

- A. `struct Job { queued: bool, running: bool, worker: u32, exit_code: i32 }`
- B. `struct Job { state: u8, worker: Option<u32>, exit_code: Option<i32> }`
- *C. `enum Job { Queued, Running { worker: u32 }, Finished { exit_code: i32 } }`
- D. `struct Job { state: String, data: Vec<u8> }`

@why
C has exactly three values' worth of shape, and each carries precisely the data
that state needs. There is no way to build a `Queued` job with a worker id,
because there is no syntax for it.

A allows `queued && running`, plus a `worker` that means nothing when queued:
eight combinations, of which three are legal. B is better but still lets `state = 1` pair with
`worker: None`, and the mapping from `1` to "running" lives in your head.

The heuristic: a `bool` next to two `Option`s where only some combinations are
legal is an enum trying to get out. Once it is an enum, the invalid combinations
stop being something you have to write tests for.
