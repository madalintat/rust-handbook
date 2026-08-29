---
unit: 02-types
---

## 1

What type does `n` have?

```rust
let n = 42;
```

- *A. `i32`
- B. `u32`
- C. `usize`
- D. `i64`, because the machine is 64-bit

@why
An unsuffixed integer literal with nothing else to constrain it falls back to
`i32`. The choice is deliberate: `i32` is fast on every target rustc supports and
wide enough for almost every counter, so the default is rarely the wrong answer.

D is the tempting one, because "64-bit machine" suggests 64-bit integers. The
fallback does not vary by target — that would make the same source produce
different overflow behaviour on different machines. Only `usize` and `isize`
change width with the target, and they do it because they are pointer-sized.

## 2

Does this compile?

```rust
let v = vec![10, 20, 30];
let i: u32 = 1;
let x = v[i];
```

- A. Yes — `u32` is an unsigned integer, so it is a valid index
- *B. No — a slice can only be indexed by `usize`
- C. No — you cannot index a `Vec` at all, only a slice
- D. Yes, but only in a release build

@why
`Index` is implemented for slices with `usize` and with ranges of `usize`, and
with nothing else. `u32` is unsigned and non-negative and still not the right
type, because an index is an offset from an address and must be able to express
the largest address the target has.

A is the tempting answer and it is tempting for a good reason: on x86-64 a `u32`
would work fine. On a 16-bit target it would not, and Rust would rather you cast
deliberately than discover that during a port.

## 3

`a` and `b` are runtime `u8` values holding 250 and 10. What does `a + b` do?

- A. Produces 260
- B. Panics in every build
- *C. Panics in a debug build, wraps to 4 in a release build
- D. Wraps to 4 in every build

@why
Overflow checking costs a branch per operation. In a debug build that cost is
irrelevant and catching the bug is worth everything, so the check is on. In a
release build it is off, and the operation is *defined* to wrap two's-complement
style.

B and D are each half right, which is what makes them plausible — most people
have only ever seen one of the two builds. The important consequence is that a
program can pass its tests in debug and compute silently wrong numbers in
release, which is exactly why `wrapping_add`, `checked_add` and `saturating_add`
exist: they behave the same in both.

## 4

What is the value of `small`?

```rust
let big: i32 = 300;
let small = big as u8;
```

- A. 255 — it saturates at the maximum
- *B. 44 — the low eight bits, and the rest are discarded
- C. It does not compile; `i32` to `u8` needs `try_into`
- D. It panics in a debug build

@why
300 is `0b1_0010_1100`. Keeping the low eight bits leaves `0b0010_1100`, which is
44. `as` between integers is a bit-level operation: it keeps what fits and
discards the rest, with no check, no warning and no panic in any build.

A is the trap, because float-to-integer casts *do* saturate — `300.0f64 as u8` is
255. Integer-to-integer casts do not. Two different rules living behind one
keyword is a good argument for reaching for `try_into` when the value came from
outside your program.

## 5

What does this print?

```rust
let n: i32 = -1;
println!("{}", n as u32);
```

- A. `-1`
- B. `0`
- *C. `4294967295`
- D. It does not compile

@why
The bits do not change; the interpretation does. `-1i32` is all thirty-two bits
set, and read as an unsigned number that is 4294967295.

This is the cast that turns a validation bug into a vulnerability. A signed
length that has gone negative through an earlier subtraction becomes an enormous
unsigned number, sails past a `len < capacity` check, and indexes far outside the
buffer. `i32::try_into::<u32>()` returns `Err` for a negative value, which is why
it belongs anywhere the number came from a file or a socket.

## 6

Which of these evaluate to `true`? Choose all that apply.

```rust
let nan = f64::NAN;
```

- A. `0.1 + 0.2 == 0.3`
- *B. `nan != nan`
- *C. `(0.1f64 + 0.2 - 0.3).abs() < 1e-12`
- D. `nan < 1.0`
- E. `nan > 1.0`

@why
A is false: neither 0.1 nor 0.2 is exactly representable in binary, and the
rounding errors do not cancel. C is the same question asked with a tolerance,
which is the form that gets a useful answer.

B is true and it is the rule that shapes the type system. IEEE-754 says NaN
compares unequal to everything including itself, so `f64` implements `PartialEq`
but not `Eq`. D and E are both **false**, which is the part people miss: NaN is
not less than, not greater than and not equal to 1.0. All three comparisons fail,
which is why `f64` is not `Ord` and `sort()` will not take it.

## 7

Why does `values.sort()` not compile when `values` is a `Vec<f64>`?

- A. `sort` is only defined for integers
- *B. `sort` requires `Ord`, and `f64` only implements `PartialOrd`
- C. Floats have to be sorted with `sort_unstable`
- D. `Vec<f64>` needs to be converted to a slice first

@why
A correct sort needs a total order: every pair comparable, and the comparison
transitive. A slice containing a NaN has neither, because NaN is incomparable to
everything. So `f64` gets `PartialOrd` and stops there, and `sort` — which
requires `Ord` — is unavailable.

The fix is `sort_by(|a, b| a.partial_cmp(b).unwrap())`, which will panic on a NaN
rather than silently producing garbage. The same sort in C++ is undefined
behaviour and can walk off the end of the array; here the missing trait makes you
decide what to do about it up front.

## 8

What do these two expressions produce?

```rust
let s = "héllo";
(s.len(), s.chars().count())
```

- A. `(5, 5)`
- *B. `(6, 5)`
- C. `(5, 6)`
- D. `(6, 6)`

@why
`len()` is a count of **bytes**, not characters. `é` is two bytes in UTF-8
(`c3 a9`), so the five characters occupy six bytes.

That is also why `s[0]` does not compile: byte 1 of this string is half of a
letter, and Rust will not hand you an object that is half a character. Slicing by
byte range works — `&s[0..1]` is `"h"` — and panics if the range would split a
character, which is the loudest possible way to be told your index arithmetic
assumed ASCII.

## 9

What is `std::mem::size_of::<char>()`?

- A. 1
- B. 2
- *C. 4
- D. It varies with the character

@why
A `char` is a Unicode scalar value stored as a 32-bit integer, so every `char` is
four bytes whatever it holds. Fixed size is what lets `char` be a normal value
you can put in an array or a register.

D confuses `char` with UTF-8. In a `String` the *encoding* is variable-width, one
to four bytes per character. A `char` sitting on the stack is the decoded form,
and decoded means fixed-width. Converting between the two is what `.chars()` and
`.encode_utf8()` do.

## 10

Does this compile?

```rust
fn takes(a: [i32; 4]) -> i32 { a[0] }

let xs: [i32; 3] = [1, 2, 3];
takes(xs);
```

- A. Yes — both are arrays of `i32`
- *B. No — `[i32; 3]` and `[i32; 4]` are different types
- C. Yes, and the missing element is zero-filled
- D. No — arrays cannot be passed to functions

@why
The length is part of the type. `[i32; 3]` and `[i32; 4]` are as unrelated as
`i32` and `String`, which is precisely what lets an array live on the stack with
no length field and no bounds check on a constant index.

The fix in real code is to take a **slice**: `fn takes(a: &[i32]) -> i32` accepts
any length, because a slice carries its length alongside the pointer at run time.
That is the trade — the array knows its length at compile time and cannot be
flexible, the slice is flexible and costs an extra word.

## 11

Which method should you use to add two `u32` hash values, where wrapping is the
intended behaviour?

- A. `a + b`
- B. `a.checked_add(b)`
- C. `a.saturating_add(b)`
- *D. `a.wrapping_add(b)`

@why
`wrapping_add` states the intent and behaves identically in debug and release,
which is the whole point. A hash that saturates at `u32::MAX` would bunch every
large value onto one bucket; a hash that returns `None` on overflow is not a
hash.

A is the trap. Plain `+` happens to wrap in a release build, so a hash written
with `+` looks correct until someone runs the test suite in debug and it panics.
Behaviour that depends on the build profile is behaviour you have not chosen.

## 12

What happens here?

```rust
let names: Vec<&str> = Vec::new();
let last = names[names.len() - 1];
```

- A. `last` is an empty string
- B. It does not compile
- *C. It panics — `0usize - 1` overflows before the index is even used
- D. It panics with an index-out-of-bounds error

@why
`len()` returns `usize`, which has no negative half, so `0 - 1` overflows
immediately. In a debug build that panics with `attempt to subtract with
overflow` — before any indexing happens.

D is the tempting answer and it is the wrong panic. In a release build the
subtraction wraps to `usize::MAX` and *then* the index panics, so the same line
produces two different messages depending on the build. This is the most common
arithmetic panic in real Rust, and it always looks like a length minus something.
`names.last()` returns an `Option` and never has the problem.

## 13

Which of these fix `error[E0284]: type annotations needed` here? Choose all that
apply.

```rust
let n = "42".parse().unwrap();
println!("{n}");
```

- *A. `let n: u32 = "42".parse().unwrap();`
- *B. `let n = "42".parse::<u32>().unwrap();`
- C. `let n = "42".parse<u32>().unwrap();`
- D. `let n = "42" as u32;`
- *E. `let n = u32::from_str("42").unwrap();` with `use std::str::FromStr;`

@why
`parse` is generic over its output type, and `println!` accepts anything that can
be displayed, so nothing in the original tells rustc which type to produce. A, B
and E each name it, in a different place.

C is the one worth naming: `parse<u32>()` without the `::` does not parse as a
generic call, because `<` there is ambiguous with a comparison. The `::<>` form
is the **turbofish**, and the extra colons exist purely to resolve that.

D does not compile at all — `as` works between primitives, and `&str` is not one.

## 14

Which conversion is the honest one for a length that arrived from a network
packet as a `u64` and must become a `usize`?

- A. `len as usize`
- *B. `usize::try_from(len)` and handle the error
- C. `usize::from(len)`
- D. `len.wrapping_into()`

@why
The value came from outside the program, so it can be anything, including a
number too large for a `usize` on a 32-bit target. `try_from` returns a `Result`
and makes you decide what a bad packet does.

C does not exist: there is no infallible `From<u64> for usize`, precisely because
`usize` is not guaranteed to be 64 bits. The standard library refuses to write
the impl rather than write one that could lose data — which is the useful
signal. If `From` is missing between two integer types, the conversion can fail,
and `as` will hide that.

A compiles and is the classic setup for a heap overflow: a truncated length
passes a size check that the real length would have failed.

## 15

What is the type and size of `()`?

- *A. The unit type, zero bytes
- B. An empty tuple, one byte
- C. The same as `None`
- D. A null pointer, eight bytes

@why
`()` is a type with exactly one value, also written `()`. Since there is only one
possible value, no bits are needed to distinguish it, so it occupies zero bytes
and a `Vec<()>` of a million elements allocates nothing.

C is the interesting confusion. `None` is a *value* of `Option<T>`, which is a
type with several possible values and does need storage. `()` means "there is
nothing to say here"; `None` means "there could have been something and there is
not". A function returning `()` did something; a function returning `Option<T>`
answered a question, possibly with no.
