---
num: 2
slug: 02-types
title: Types, overflow and casts
accent: amber
concepts: integer, usize, overflow, wrapping, float, NaN, char, tuple, array, cast, TryFrom, turbofish
needs: 01-bindings
blurb: Fixed-width integers that panic in debug and wrap in release, why indexing demands usize, and why `as` is the one conversion that lies to you.
---

%% A `u32` and a `u64` hold the same number and are different types, and Rust will not add one to the other. That is not pedantry. The width of an integer is the difference between a checksum that is right and one that is quietly wrong, and between an index that is in bounds and a read past the end of a buffer.

Three things bite here, in this order: overflow, casts, and floats. All three are places where C says nothing and Rust says something.

## The integer family

### Width and signedness are in the name

| | 8 | 16 | 32 | 64 | 128 | pointer-sized |
|---|---|---|---|---|---|---|
| signed | `i8` | `i16` | `i32` | `i64` | `i128` | `isize` |
| unsigned | `u8` | `u16` | `u32` | `u64` | `u128` | `usize` |

The type is the range, exactly. `u8` covers 0 to 255 and `i8` covers −128 to 127,
and there is no promotion: an `i8` that reaches 128 does not become an `i16`, it
overflows.

```rust
let port: u16 = 8080;            // ports are 16 bits; say so
let bytes_sent: u64 = 5_000_000_000;
let temperature: i8 = -12;
```

An unsuffixed integer literal with no other clue defaults to **`i32`**, chosen
because it is fast on every target and big enough for most counters.

### usize is the pointer-sized one

`usize` is exactly as wide as a memory address on the target: 8 bytes on x86-64,
4 on a 32-bit microcontroller. That is not trivia. It is the reason indexing has
the type it does.

```rust,bad
let v = vec![10, 20, 30];
let i: i32 = 1;
let x = v[i];        // error[E0277]: the type `[i32]` cannot be indexed by `i32`
```

An index is an offset from a base address. The largest possible offset is the
largest possible address, so the index type must be the address type. `usize` is
that type, and it cannot be negative because an offset below the base is not a
thing you can want.

:::note
Anything that counts elements or bytes in memory is `usize`: `len()`, `capacity()`,
`v[i]`, slice ranges, `size_of::<T>()`. Anything that counts a quantity in your
problem domain (a retry count, a user id, a price in pence) should be the width
that domain needs, not `usize`.
:::

### Literals

```rust
let a = 5u8;              // suffix pins the type
let b = 1_000_000;        // underscores anywhere, ignored
let c = 0xff;             // hex
let d = 0b1010_0101;      // binary, grouped by nibble
let e = 0o755;            // octal
let f = b'A';             // a byte literal: u8, value 65
```

The separator is free and the suffix is how you settle an ambiguity on the spot
without writing a type annotation four lines away.

## Overflow

### Panics in debug, wraps in release

```rust,bad
let mut count: u8 = 250;
for _ in 0..10 {
    count += 1;          // debug: panics on the sixth
}                        // release: wraps to 4
```

Two behaviours from one program, and the split is deliberate.

Checking every arithmetic operation costs a branch. In a debug build that is
irrelevant and catching the bug is everything, so the check is on. In a release
build the cost is real, so the check is off. The operation still has to do
*something*, so it is defined to wrap two's-complement style.

:::compare
**C.** Signed overflow is *undefined behaviour*. Not "wraps", not "unspecified":
the compiler is entitled to assume it never happens and delete the code that
checked for it. This is a real source of removed bounds checks in shipped C.

Rust's release behaviour is wrapping. That may still be the wrong answer for your
program, but it is defined and reproducible, and it leaves the optimiser's
reasoning about the rest of your function intact.
:::

:::gotcha
Overflow the compiler can see is a compile error, not a runtime panic:

```rust,bad
let x: u8 = 255 + 1;   // error: this arithmetic operation will overflow
```

The `arithmetic_overflow` lint is deny-by-default. It only catches constants, so
it is a safety net, not the rule.
:::

### Say what you meant

Wrapping is right for a hash and wrong for a bank balance, so the standard
library makes you choose. Every integer has four explicit forms of every
operation.

| method | on overflow | reach for it when |
|---|---|---|
| `a.checked_add(b)` | `None` | overflow is a real possibility and you must handle it |
| `a.saturating_add(b)` | clamps to `MAX` / `MIN` | a pixel value, a volume, any clamped quantity |
| `a.wrapping_add(b)` | wraps | hashes, checksums, PRNGs, ring buffers, where wrapping *is* the algorithm |
| `a.overflowing_add(b)` | `(wrapped, true)` | implementing bignum arithmetic; you want the carry flag |

```rust
let total: u8 = 250;
assert_eq!(total.checked_add(10), None);
assert_eq!(total.saturating_add(10), 255);
assert_eq!(total.wrapping_add(10), 4);
assert_eq!(total.overflowing_add(10), (4, true));
```

### The subtraction that actually bites people

```rust,bad
let names: Vec<&str> = Vec::new();
let last = names[names.len() - 1];   // 0usize - 1 → panic
```

`usize` has no negative half, so `0 - 1` overflows immediately. This is the most
common arithmetic panic in real Rust, and it is always the same shape: a length
minus something, on an empty collection.

```rust,good
let last = names.last();                       // Option<&&str>
let i = names.len().checked_sub(1);            // Option<usize>
```

## Floats

`f32` and `f64` are IEEE-754, the same as every other language. `f64` is the
default for an unsuffixed float literal, and the type you should use unless you
have measured a reason not to.

### Equality is a trap

```rust
let a = 0.1 + 0.2;
assert!(a != 0.3);          // true. 0.1 and 0.2 are not representable in binary
```

The values are stored as the nearest binary fraction, the errors do not cancel,
and `==` reports the truth about the bits rather than about the arithmetic you
had in mind. Compare against a tolerance instead:

```rust
fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-9
}
```

### NaN is not equal to itself

```rust
let n = f64::NAN;
assert!(n != n);           // true
```

IEEE-754 says a NaN compares unequal to everything, including another NaN. That
one rule has a visible consequence in the type system: `f64` implements
`PartialEq` and `PartialOrd` but **not** `Eq` and **not** `Ord`, because those
traits promise a total order that NaN breaks.

```rust,bad
let mut xs = vec![3.0, 1.0, 2.0];
xs.sort();                 // error[E0277]: the trait `Ord` is not implemented for `f64`
```

```rust,good
xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
```

The compiler is not being awkward. A sort needs a total order to be correct, and
a slice containing a NaN does not have one. In C++ the same sort is undefined
behaviour and can walk off the end of the array.

## char, bool, tuples, arrays

### char is four bytes, not one

A `char` is a **Unicode scalar value**: any code point except the surrogate
range. It is stored as a 4-byte `u32`, so every `char` is the same size whatever
it holds.

A `String` does not store chars. It stores UTF-8, where a code point takes one
to four bytes.

:::memory let s = String::from("héllo"): 6 bytes, 5 chars
       STACK                            HEAP  (UTF-8 bytes)
     ┌──────────────────────┐         ┌────┬────┬────┬────┬────┬────┐
 s   │ ptr      ●───────────┼────────▶│ 68 │ c3 │ a9 │ 6c │ 6c │ 6f │
     │ len      6           │         └────┴────┴────┴────┴────┴────┘
     │ capacity 6           │            h   └── é ──┘   l    l    o
     └──────────────────────┘
     s.len() == 6      (bytes)
     s.chars().count() == 5
:::

:::gotcha
`s.len()` is a byte count, not a character count, and `s[0]` does not compile at
all. Indexing a `String` by number is forbidden precisely because byte 1 of
`"héllo"` is half of a letter. Use `.chars()` when you mean characters, `.bytes()`
or `.as_bytes()` when you mean bytes, and know which one your problem wants.
:::

### bool, tuples, and the unit type

`bool` is one byte and takes no part in arithmetic. An integer will not stand in
for a condition, and `1` is not `true`. If you want the number, ask for it:
`flag as u8`.

A tuple is a fixed-length, mixed-type product. The empty tuple `()` is the
**unit type**, which has exactly one value and occupies zero bytes. It is what a
function returns when it returns nothing, and it will come up constantly in the
next unit.

```rust
let point = (3, -7);
let (x, y) = point;              // destructure
let mixed = ("retries", 3u8, true);
let n = mixed.1;                 // index with a dot
```

### Arrays carry their length in the type

```rust
let counts: [u32; 4] = [0; 4];   // four zeros, on the stack
```

`[u32; 4]` and `[u32; 5]` are **different types**, and a function taking one will
not accept the other. The length is compile-time knowledge, which is what lets
the array sit directly on the stack, storing its elements and nothing else.
When you want a run-time length, you want `Vec<T>`; when you want to accept any
length, you want a **slice**, `&[T]`, which is the subject of unit 7.

## Casts

### `as` truncates and does not tell you

```rust
let big: i32 = 300;
let small = big as u8;          // 44. The top bits are simply gone.

let negative: i32 = -1;
let huge = negative as u32;     // 4294967295. Same bits, read differently.
```

Nothing there panics, warns, or hands you a `Result`. `as` is a request to
reinterpret the bits, and it does exactly what you asked.

| cast | what happens |
|---|---|
| wider → narrower integer | keeps the low bits, discards the rest |
| narrower → wider, unsigned | zero-extends |
| narrower → wider, signed | sign-extends |
| signed ↔ unsigned, same width | bits unchanged, meaning changes |
| float → integer | truncates toward zero, saturates at the bounds, NaN → 0 |
| integer → float | rounds; above 2^53 an `i64` loses precision |
| `u8 as char`, `char as u32` | allowed; other char casts are not |

`as` also only works between primitives. `some_string as u32` is `error[E0605]`.

### try_into fails honestly

```rust
use std::convert::TryInto;

let big: i32 = 300;
let small: Result<u8, _> = big.try_into();   // Err, 300 does not fit
let ok: u8 = 200i32.try_into().unwrap();     // 200
```

`TryFrom`/`TryInto` return a `Result`, so the conversion that cannot succeed says
so rather than inventing a number. For conversions that always fit, `From`/`Into`
is infallible and free: `u32::from(some_u8)`, `i64::from(some_i32)`.

:::note
Use `as` when you have proved the value fits, or when the truncation *is* the
intent: packing a byte, hashing, talking to hardware. Use `try_into` everywhere
a value came from outside your control: a file, a socket, a user. A silently
truncated length is how a bounds check gets bypassed.
:::

## Inference and when it needs help

Rust infers from use, across the whole function body, not just from the right
of the `=`.

```rust
let mut v = Vec::new();   // Vec<what>?
v.push(3u16);             // settled here, four lines later
```

When nothing settles it, you get `error[E0282]: type annotations needed`, and
there are two ways to answer.

```rust
let n: u32 = "42".parse().unwrap();      // annotate the binding
let m = "42".parse::<u32>().unwrap();    // or the call, with the turbofish
```

`::<>` is the **turbofish**. It exists because `parse::<u32>` would be ambiguous
with a comparison in expression position, so the `::` disambiguates it.

:::gotcha
Method calls resolve before the fallback to `i32`/`f64` happens, so a bare
literal with a method on it can fail where a bound literal succeeds:

```rust,bad
let x = 2.0.powi(2);      // error[E0689]: can't call method on ambiguous numeric type
```

```rust,good
let x = 2.0_f64.powi(2);
```
:::
