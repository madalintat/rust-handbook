---
unit: 25-diagnostics
---

## 1

In a rustc diagnostic, what does a `----` underline mark?

```
3 |     let first = &names[0];
  |                  ----- immutable borrow occurs here
4 |     names.push(String::from("corro"));
  |     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ mutable borrow occurs here
```

- A. A less serious version of the same problem
- *B. A secondary span: another place that participates in the error
- C. A suggested replacement for that line
- D. A warning attached to the error

@why
`^^^^` is the **primary span**: where the compiler gave up. `----` marks
**secondary spans**: the other facts that made giving up necessary. Here `push`
carries the carets, but `push` is not wrong. It is wrong *given* the borrow on
line 3.

C is the tempting one because rustc does sometimes print suggested lines with
`+` and `-` markers under a `help:`. Those live in a separate block with their
own gutter. Inside the quoted source, `----` is always a secondary span.

## 2

```
error[E0596]: cannot borrow `v` as mutable, as it is not declared as mutable
 --> src/main.rs:3:5
  |
3 |     v.push(4);
  |     ^ cannot borrow as mutable
  |
help: consider changing this to be mutable
  |
2 |     let mut v = vec![1, 2, 3];
  |         +++
```

What is actually wrong?

- A. `Vec` does not have a `push` method
- *B. The binding was declared `let v`, and `push` needs `&mut self`
- C. `v` was moved earlier in the function
- D. `push` requires the vector to be behind a reference

@why
`push` takes `&mut self`, so calling it requires a unique borrow of `v`, and you
can only take `&mut` from a binding declared `mut`. The primary span is on
`v`, not on `push`, because the binding is the thing lacking permission.

Note that mutability is a property of the **binding**, not the type. Nothing
about `Vec<i32>` changes; `let mut v` simply grants the ability to hand out
`&mut` to it. This is also the one error where the `help:` diff is essentially
always right.

## 3

```
error[E0507]: cannot move out of `u.name` which is behind a shared reference
 --> src/main.rs:2:31
  |
2 | fn take(u: &User) -> String { u.name }
  |                               ^^^^^^ move occurs because `u.name` has type
  |                                      `String`, which does not implement `Copy`
  |
help: consider cloning the value if the performance cost is acceptable
```

Which reading is correct?

- *A. You only borrowed the `User`, so you may look at `name` but not take it out
- B. `String` fields cannot be returned from functions
- C. `User` is missing a `#[derive(Clone)]`
- D. The reference `u` needs a lifetime annotation

@why
A borrow is permission to look, not to dismantle. Moving `name` out would leave
the caller's `User` with a hole in it, a partially destroyed value the caller
still owns, so it is forbidden through any `&T`.

The `help:` offers `.clone()`, which compiles and is sometimes right. But three
other answers exist and are often better: return `&str` instead of `String`,
take `self` by value if the caller is finished with the `User`, or use
`std::mem::take` if you own a `&mut` and are happy to leave `Default` behind.

## 4

```
error[E0597]: `s` does not live long enough
  |
4 |         let s = String::from("hi");
  |             - binding `s` declared here
5 |         r = &s;
  |             ^^ borrowed value does not live long enough
6 |     }
  |     - `s` dropped here while still borrowed
7 |     println!("{r}");
  |                - borrow later used here
```

Which marker tells you *why* the borrow was still required?

- A. `binding s declared here`
- B. `borrowed value does not live long enough`
- C. `s dropped here while still borrowed`
- *D. `borrow later used here`

@why
The `later used here` label is the one that closes the argument. Without a use
after the block, the borrow would already be dead when `s` dropped and there
would be no error at all. Borrows end at their last use, not at a closing brace.

C is the tempting answer because it names the moment of conflict. It is real
evidence, but it only matters *because* of line 7. In every borrow diagnostic,
find the `later used here` marker first and ask whether that use can move
earlier or disappear.

## 5

```
error[E0308]: `if` and `else` have incompatible types
  |
3 |     let x = if n > 2 { "big" } else { 0 };
  |                        -----          ^ expected `&str`, found integer
  |                        |
  |                        expected because of this
```

Why does the arrow point at `0` rather than at `"big"`?

- A. Integers are never valid in an `if` expression
- *B. The first arm sets the expectation; the second is the first one to violate it
- C. `0` is the last thing on the line
- D. `&str` outranks integers in type inference

@why
An `if` is an expression, so both arms must have one type. rustc types the first
arm and records `&str` as the expectation, which is what the `expected because
of this` secondary marks, then reports the first arm that does not match.

Which means the arrow location is about *order*, not about blame. Swap the arms
and the error moves to `"big"`. This is the general shape of E0308: the
secondary marker says where the expectation came from, and it is usually the
half worth reconsidering.

## 6

```
error[E0599]: no method named `describe` found for reference `&T` in the
              current scope
help: consider restricting type parameter `T`
```

`Retry` implements `Describe`, and `describe` is spelled correctly. What is wrong?

- A. The trait needs to be `pub`
- B. `describe` should take `self` rather than `&self`
- *C. The generic function's signature does not require `T: Describe`
- D. The `impl Describe for Retry` block is in the wrong module

@why
A generic function is type-checked **once**, knowing only what its signature
declares about `T`. Here that is nothing, so `T` might be `u8`, and `u8` has no
`describe`. The `impl Describe for Retry` is never consulted, because the
compiler is not looking at `Retry` yet.

`consider restricting type parameter T` is the tell. Whenever E0599 offers that
help, the method exists and a **trait bound** is missing. Adding `<T: Describe>`
is a promise about every future caller, which is why the compiler can then trust
the call.

## 7

E0599 "no method named X found" can mean which of these? Choose all that apply.

- *A. A trait bound is missing on a generic parameter
- *B. The trait is implemented but not imported into scope
- *C. You misspelled the method name
- *D. The receiver is a different type than you think it is
- E. The method exists but is private, so it needs `pub`

@why
A, B and C are the three headline causes and the `help:` line distinguishes
them. D is the quiet fourth: `.iter()` gives you `&T`, not `T`, and a method
taking `self` will not be found on a reference.

B is the one that catches everyone once. `write!(f, "hi")` on a `File` fails
with E0599 until `use std::io::Write;` is at the top. The trait was always
implemented; you had simply not imported the vocabulary to name it.

E describes E0624, a different code. Privacy errors say "private", not "not
found".

## 8

Two errors are reported. Which do you investigate first?

```
error[E0308]: mismatched types
 --> src/main.rs:3:18
  |
3 |     let n: i32 = path.to_str().unwrap();
  |                  ^^^^^^^^^^^^^^^^^^^^^^ expected `i32`, found `&str`

error[E0599]: no method named `push` found for type `i32`
 --> src/main.rs:5:26
```

- *A. The E0308, because the E0599 is probably a consequence of it
- B. The E0599, because it is nearer the code you last edited
- C. Either; they are independent
- D. The last one, since the compiler reports the deepest problem last

@why
`n` is only an `i32` because of the annotation on line 3. Fix that annotation and
the type of `n` changes, so the second error changes or vanishes entirely.
Chasing it first means debugging a phantom.

D is a real habit worth unlearning, and it comes from terminals: you see the
*end* of the output, so the last error and the summary line are what is on
screen. Scroll up, or pipe through `head`. Five errors regularly collapse to one.

## 9

```
error[E0106]: missing lifetime specifier
  |
1 | fn longer(a: &str, b: &str) -> &str {
  |                                ^ expected named lifetime parameter
  |
  = help: this function's return type contains a borrowed value, but the
          signature does not say whether it is borrowed from `a` or `b`
```

What is the compiler actually asking for?

- A. Syntax; it just needs a `'a` written somewhere
- *B. A decision about which input the returned reference borrows from
- C. Proof that both arguments outlive the function call
- D. `String` instead of `&str`, since references cannot be returned

@why
`'a` is a **claim**, not decoration: it records that the result stays valid only
as long as the input tagged `'a`. Callers rely on it and the compiler checks it
from both sides.

**Lifetime elision** would have written this for you given one input reference,
or a `&self`. Two candidates and no `self` is exactly the case the rules refuse
to guess, because guessing wrong hands a caller a dangling reference.

D is wrong here but right in the neighbouring case: if the reference pointed at
something *created inside* the function, no annotation could save it and E0515
would be the error.

## 10

```
warning: unused `Result` that must be used
 --> src/main.rs:3:5
  |
3 |     File::create("x");
  |     ^^^^^^^^^^^^^^^^^
  |
  = note: this `Result` may be an `Err` variant, which should be handled
```

Why is this worth more than a warning's usual attention?

- A. It always means the program will panic later
- *B. An ignored `Result` is a silently swallowed failure
- C. It indicates a memory leak
- D. It means `File::create` was called with the wrong arguments

@why
Nothing crashes. The file simply is not created, the program continues as if it
were, and the failure surfaces somewhere unrelated much later. `unused_must_use`
is a genuine bug class, not style, which is why `Result` carries `#[must_use]`.

The same trap hides in `writeln!` and `flush`, both of which return `Result`.
Dropping those is how data fails to reach disk.

Note that the `help:` here suggests `let _ = File::create("x");`. That silences
the warning by *asserting* you meant to ignore it, which is a legitimate answer
only when you genuinely did.

## 11

What is the difference between `note:` and `help:` in a diagnostic?

- A. `note:` is more severe than `help:`
- *B. `note:` states a fact; `help:` proposes a change that may or may not be right
- C. `help:` only appears when rustc is confident of the fix
- D. They are interchangeable labels for the same thing

@why
`note:` is always true and asks nothing of you: `move occurs because s has type
String, which does not implement Copy`, or `required by a bound in collect`. The
real explanation lives there.

`help:` is a suggestion optimised for making the error disappear, not for making
your program right. When it proposes `.clone()`, it is proposing an allocation to
end an ownership argument you have not had yet. Reading `help:` before `note:` is
how codebases end up with `.clone()` on every line.

## 12

```
error[E0603]: unit struct `Conn` is private
 --> src/main.rs:2:27
  |
2 | fn main() { let _c = net::Conn; }
  |                           ^^^^ private unit struct
  |
note: the unit struct `Conn` is defined here
```

What does this tell you that E0433 would not?

- *A. The item exists and the path is correct, so only visibility is blocking you
- B. The module `net` does not exist
- C. `Conn` needs to be constructed with `Conn {}`
- D. You are missing a `use` statement

@why
E0603 is good news disguised as an error: the name resolved. The compiler found
exactly the item you meant, and the `note:` even points at its definition. One
`pub` fixes it.

E0433 is the different failure. The path did not resolve at all, which means a
wrong module, a missing crate, or a typo. Distinguishing the two saves real time:
E0603 says "add `pub`", E0433 says "you are looking in the wrong place".

## 13

E0277 fires from deep inside a standard library call. Which line of the
diagnostic is most likely to explain it?

- A. The headline `the trait bound ... is not satisfied`
- B. The `-->` file and line
- *C. `note: required by a bound in ...`
- D. The `For more information` footer

@why
`required by a bound in ...` names *who* wanted the trait, usually a library
function several layers below your code. Without it you know a bound failed but
not which call imposed it; with it, the requirement has an address you can go
and read.

The headline is true and abstract. In practice E0277 usually means one of: an
owned value passed where a reference was wanted (or the reverse), `{}` used on a
type that only has `Debug`, `?` on an `Option` in a function returning `Result`,
or `collect` asked for a container it cannot build from that iterator.

## 14

You hit an error code you have never seen. What is the highest-value first move?

- A. Search the web for the error code
- B. Apply the `help:` suggestion and see whether it compiles
- *C. Read the headline as a claim, then find the primary span and ask what would have to be true for the claim to hold
- *D. Run `rustc --explain` on the code

@why
C is the method and D is the reference. `rustc --explain E0507` prints a minimal
broken example, a fixed one, and the rule, offline and instant and better
written than most of what a search returns.

B is the habit this unit exists to break. It works often enough to feel like a
technique and teaches you nothing, and when the suggestion is `.clone()` it
converts a design question into a permanent allocation.

A is fine later. It tends to surface someone else's differently-shaped problem
with the same code, which is a slower path than the two the compiler ships with.

## 15

Why is `#![deny(warnings)]` a bad idea in a published crate?

- A. It makes compilation significantly slower
- *B. New rustc releases add lints, so code that built in April fails in July, for everyone depending on you
- C. It disables Clippy
- D. It is ignored by cargo anyway

@why
Lints are added and tightened with every release. A crate-wide `deny(warnings)`
means a compiler you never tested against can break your users' builds, with
nothing about their program having changed and no fix available to them.

Put `-D warnings` in CI instead: identical enforcement on your own machines,
failing your build rather than theirs. The same instinct applies to
`#[allow(...)]`: prefer the narrowest scope that works, on the item rather than
the crate, with a comment saying why. A crate-wide `allow` hides the next real
one.
