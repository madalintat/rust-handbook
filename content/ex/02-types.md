---
unit: 02-types
---

## 1. An index is not just a number

@kind fix
@concept usize

@expect E0277

`nth` takes its index as an `i32`, which is a perfectly good integer type and the
wrong one for this job. Indexing a slice needs a specific type, and the error
message names it.

Change the signature so the call works. Do not cast at the call site.

```starter
pub fn nth(values: &[i32], index: i32) -> i32 {
    values[index]
}

pub fn run() -> i32 {
    let scores = [10, 20, 30, 40];
    nth(&scores, 2)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_the_third() {
        assert_eq!(run(), 30);
    }
}
```

```solution
pub fn nth(values: &[i32], index: usize) -> i32 {
    values[index]
}

pub fn run() -> i32 {
    let scores = [10, 20, 30, 40];
    nth(&scores, 2)
}
```

@hint The error names the only type a slice can be indexed by. Use it in the signature.
@hint `usize` — as wide as a pointer on the target, and unable to go negative.
@hint `pub fn nth(values: &[i32], index: usize) -> i32`. The literal `2` at the call site will infer as `usize` on its own.

@diagnose E0277
`the type [i32] cannot be indexed by i32` is a trait error wearing a familiar
coat. Indexing desugars to `Index::index`, and `[i32]` implements `Index<usize>`
and `Index<Range<usize>>` — and nothing else. `i32` is not in the list, so the
trait bound is unsatisfied.

The reason is not style. An index is an offset added to a base address, so the
largest index that can be meaningful is the largest address, which is what
`usize` is defined to be — 8 bytes on x86-64, 4 on a 32-bit target. It is also
unsigned, because an offset before the start of the slice is not a thing you can
ask for. Making the index type match the address type removes a whole class of
"it worked on my laptop" bugs on 32-bit hardware.

@after
`usize` is the type of every count of things in memory: `len()`, `capacity()`,
slice ranges, `size_of::<T>()`. The habit worth forming is the reverse one —
*not* using `usize` for quantities in your problem domain. A retry count is a
`u8`, a port is a `u16`, a user id is whatever your database says. Reaching for
`usize` because it is "the integer that indexes" gives every number in your
program the same type, and then nothing catches the day you pass a user id where
a length belonged.

## 2. Two integer types will not add

@kind fix
@concept integer

@expect E0308

`header` is a `u32` and `body.len()` is a `usize`. Both are integers, both are
non-negative, and Rust still refuses to add them.

Fix it, and think about which conversion is honest. One direction can never lose
information; the other can.

```starter
pub fn total_bytes(header: u32, body: &[u8]) -> u64 {
    header + body.len()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn adds_both_halves() {
        assert_eq!(total_bytes(100, &[1, 2, 3]), 103);
        assert_eq!(total_bytes(0, &[]), 0);
    }
}
```

```solution
pub fn total_bytes(header: u32, body: &[u8]) -> u64 {
    u64::from(header) + body.len() as u64
}
```

@hint The return type is `u64`. Get both operands there before adding, not after.
@hint A `u32` always fits in a `u64`, so that conversion cannot fail — `u64::from` says so in the type. A `usize` might be wider than `u64` on some exotic target, so that one needs `as`.
@hint `u64::from(header) + body.len() as u64`.

@diagnose E0308
`mismatched types: expected u32, found usize`. Note where rustc put the caret: on
`body.len()`, the *second* operand. It inferred the whole expression's type from
the first one, then found the second did not agree.

There is no implicit integer promotion in Rust. C would quietly widen both sides
to a common type, which is convenient right up to the point where it widens a
`-1` into a very large unsigned number and your bounds check passes. Rust makes
every width change visible, so the place where a value could change meaning is a
place you can grep for.

A second error is hiding behind this one: even added, `u32 + usize` is not the
`u64` the signature promised. Fix the widths first and that one goes with it.

@after
Two conversion tools, and the distinction is worth keeping straight.

`From`/`Into` is for conversions that **cannot** fail: `u64::from(x)` where `x`
is a `u32` compiles because the standard library has proved every `u32` fits.
There is no `u32::from(some_u64)` — the impl does not exist, because it would be
a lie.

`as` is for everything else, and it never fails, which is exactly the problem: it
truncates instead. Preferring `From` where it exists means the compiler catches
the narrowing conversions you did not mean to write.

## 3. char is not a small integer

@kind fix
@concept char

@expect E0369

`shift` should move a letter one place up the alphabet: `h` becomes `i`. Adding
one to a `char` looks like the obvious way to do that, and Rust does not have an
operator for it.

Make it work for ASCII letters.

```starter
pub fn shift(c: char) -> char {
    c + 1
}

pub fn run() -> String {
    "hal".chars().map(shift).collect()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn moves_each_letter_up_one() {
        assert_eq!(run(), "ibm");
    }
}
```

```solution
pub fn shift(c: char) -> char {
    (c as u8 + 1) as char
}

pub fn run() -> String {
    "hal".chars().map(shift).collect()
}
```

@hint `char` has no `Add` implementation. Get to a numeric type, do the arithmetic there, and come back.
@hint `c as u8` gives the byte value for an ASCII character, and `as char` converts a `u8` back. Only `u8` may be cast to `char` — no other integer type can.
@hint `(c as u8 + 1) as char`.

@diagnose E0369
`cannot add {integer} to char`. The `+` operator is the `Add` trait, and `char`
does not implement it — deliberately, not by oversight.

A `char` is a **Unicode scalar value**, not a number. The code points are not a
contiguous, uniformly meaningful sequence: adding one to `'z'` gives `'{'`,
adding one to the last character of a script lands in a completely unrelated
block, and the surrogate range `D800..DFFF` is not a valid `char` at all. An
`Add` impl would suggest the arithmetic means something, and for most of Unicode
it does not.

So Rust makes you go through an integer, where the arithmetic is honestly just
arithmetic and the conversion back is the step where you take responsibility.

@after
Two routes back to `char`, and they differ in honesty. `as char` only works from
`u8`, and every `u8` is a valid `char` (the first 256 code points, Latin-1), so
it cannot fail. From any wider integer you need `char::from_u32(n)`, which
returns an `Option<char>` because most `u32` values are not valid scalar values.

The general shape, for the rest of the language: when a conversion can fail, the
standard library gives you a type that can say so. When it cannot fail, it gives
you a plain function. If a conversion that can fail hands you a plain value
anyway, that is `as`, and it is the one to be suspicious of.

## 4. checked_add hands you an Option

@kind fix
@concept overflow

@expect E0308

`add_retries` should add to a retry counter and stop at the ceiling rather than
overflowing. `checked_add` is the right family of method to be reaching for; the
type it returns is the point of it.

The counter must saturate at 255, not wrap and not panic.

```starter
pub fn add_retries(current: u8, extra: u8) -> u8 {
    current.checked_add(extra)
}

pub fn run() -> (u8, u8) {
    (add_retries(250, 3), add_retries(250, 10))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clamps_at_the_ceiling() {
        assert_eq!(run(), (253, 255));
        assert_eq!(add_retries(0, 0), 0);
    }
}
```

```solution
pub fn add_retries(current: u8, extra: u8) -> u8 {
    current.checked_add(extra).unwrap_or(u8::MAX)
}

pub fn run() -> (u8, u8) {
    (add_retries(250, 3), add_retries(250, 10))
}
```

@hint `checked_add` returns `Option<u8>`, and the signature promises `u8`. Decide what the `None` case should produce.
@hint The brief says clamp at 255. `Option` has a method for "use this value if there is nothing here".
@hint `current.checked_add(extra).unwrap_or(u8::MAX)`. `saturating_add` does the same thing in one call.

@diagnose E0308
`expected u8, found Option<u8>`. That `Option` is the entire value of
`checked_add`: it is the method saying *this might not have a sensible answer,
and here is the shape of "no answer"*.

Compare the four members of the family, which all exist because "what should
overflow do" has four legitimate answers:

- `checked_add` → `None`. Handle it explicitly.
- `saturating_add` → clamps to `u8::MAX`. For quantities with a natural ceiling.
- `wrapping_add` → 4. Correct when wrapping *is* the algorithm — hashes, PRNGs.
- `overflowing_add` → `(4, true)`. The wrapped value plus a carry flag.

Plain `+` is a fifth: panic in a debug build, wrap in a release build. That split
is why the explicit family exists at all — `+` behaves differently depending on
how you compiled, so anywhere overflow is a real possibility you should be saying
which of the four you meant.

@after
`unwrap_or(u8::MAX)` and `saturating_add` produce identical machine code here, and
the difference is what a reader learns from the line. The `checked_add` version
shows the decision; the `saturating_add` version states it. In real code, reach
for `saturating_*` when the clamp is the whole intent, and `checked_*` when the
`None` deserves different handling — a log line, an error, an early return.

The habit worth building: a `+` on a value that came from outside the program is
a decision you have not made yet.

## 5. Floats do not mix either

@kind fix
@concept float

@expect E0308

`mean` averages a slice of `f32` and returns an `f64`. There are two float types
in this function and they do not meet in the middle by themselves.

Get the arithmetic into one type. The test compares with a tolerance rather than
`==`, and the `@after` explains why.

```starter
pub fn mean(values: &[f32]) -> f64 {
    let mut sum = 0.0;
    for v in values {
        sum += v;
    }
    sum / values.len() as f64
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn averages_three() {
        assert!((mean(&[1.0, 2.0, 4.0]) - 2.333_333_333_333_333_5).abs() < 1e-12);
    }
    #[test]
    fn averages_one() {
        assert!((mean(&[7.5]) - 7.5).abs() < 1e-12);
    }
}
```

```solution
pub fn mean(values: &[f32]) -> f64 {
    let mut sum = 0.0f64;
    for v in values {
        sum += *v as f64;
    }
    sum / values.len() as f64
}
```

@hint `sum` has no annotation, so inference picks its type from the first thing that constrains it — the `+=` against an `f32`.
@hint Pin `sum` to `f64` with a suffix, then widen each element as it comes in.
@hint `let mut sum = 0.0f64;` and `sum += *v as f64;`. The `*` is because iterating a slice yields references.

@diagnose E0308
`expected f32, found f64`. Follow how `sum` got its type: it starts as an
unconstrained float literal, then `sum += v` unifies it with the element type,
`f32`. By the time the last line runs, `sum` is an `f32` and `values.len() as
f64` is not, so the division has nothing to do.

Rust has no implicit float widening for the same reason it has no implicit
integer promotion: every change of representation should be visible. `f32` has
24 bits of significand and `f64` has 53, so summing in `f32` and reporting in
`f64` would produce a number that *looks* precise to fifteen digits and is
accurate to seven. Making you write the `as f64` puts the decision where the
error is introduced.

@diagnose E0614
You have written `sum += v` where `v` is a `&f32`, then tried to dereference
something that is not a reference — or the reverse. Iterating `&[f32]` with
`for v in values` yields `&f32`, one reference per element. `*v` gets the `f32`
out. If you iterate with `for &v in values` instead, the pattern does the
dereference and `v` is already an `f32`.

@after
Note what the tests do not do: compare floats with `==`. `0.1 + 0.2 == 0.3` is
`false`, because neither operand is exactly representable in binary and the
rounding errors do not cancel. A tolerance — `(a - b).abs() < 1e-12` — asks the
question you actually meant.

The type system carries a trace of this. `f64` implements `PartialEq` and
`PartialOrd` but not `Eq` and not `Ord`, because `NaN != NaN` and a total order
cannot survive that. It is why `vec_of_floats.sort()` does not compile and you
need `sort_by(|a, b| a.partial_cmp(b).unwrap())` — the compiler making you
acknowledge the case it cannot order.

## 6. `as` is only for primitives

@kind fix
@concept cast

@expect E0606

A port number arrives as text from a config file and needs to become a `u16`.
`as` is a conversion operator, so `as u16` looks like the tool. It is not, and
the error explains the boundary of what `as` can do.

```starter
pub fn parse_port(s: &str) -> u16 {
    s as u16
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_a_port() {
        assert_eq!(parse_port("8080"), 8080);
        assert_eq!(parse_port("0"), 0);
    }
}
```

```solution
pub fn parse_port(s: &str) -> u16 {
    s.parse::<u16>().unwrap()
}
```

@hint `as` reinterprets bits between primitive types. Text to a number is not a reinterpretation of bits — it is parsing, and it can fail.
@hint `str::parse` returns a `Result`, and the type it parses into comes from context or from a turbofish.
@hint `s.parse::<u16>().unwrap()`, or `let n: u16 = s.parse().unwrap();`.

@diagnose E0606
`casting &str as u16 is invalid`. `as` is defined only between primitive types —
the integers, the floats, `bool`, `char`, and raw pointers — plus a couple of
coercions. It is a bit-level operation, and there is no arrangement of the bits
of a `&str` (a pointer and a length) that is a sensible `u16`. The `help: cast
through a raw pointer first` at the bottom is rustc telling you the only route
that exists, and it is not one you want here.

What `"8080"` → `8080` needs is *parsing*: reading decimal digits and building a
number, which allocates no memory but can absolutely fail — on `"abc"`, on
`"70000"`, on `""`. So it lives on `FromStr` and returns a `Result`, and you have
to say what happens when the config file is wrong.

The general lesson is that `as` never fails, which sounds convenient and means
it can only be used where failure is impossible or where you have decided that
silently producing the wrong number is acceptable.

@diagnose E0605
`non-primitive cast: String as u16`. Same rule, sharper wording: you cast from an
owned `String` rather than a `&str`, and `String` is not a primitive at all, so
rustc rejects it one step earlier. Either way the answer is the same — text
becomes a number by parsing, not by casting.

@after
The turbofish is worth a second look: `s.parse::<u16>()`. `parse` is generic over
its output type, so without either a turbofish or an annotation on the binding
there is nothing to infer from and you get `error[E0284]` or `E0282`. Here the
`-> u16` on the function would in fact have been enough, because the `unwrap()`
result flows straight into the return position — the explicit form is for the
reader.

In real code, `unwrap()` on config parsing is a placeholder. `parse::<u16>()`
returning a `Result` is the whole point; unit 12 is about the `?` operator that
lets you propagate it in one character.

## 7. try_into fails honestly

@kind fix
@concept TryFrom

@expect E0308

`to_port` narrows an `i64` from an external source down to a `u16`. Most of the
time it fits. Sometimes it does not, and the signature already says so — it
returns `Option<u16>`, not `u16`.

Wire the conversion up so an out-of-range number becomes `None` rather than a
wrong number.

```starter
pub fn to_port(n: i64) -> Option<u16> {
    Some(n.try_into())
}

pub fn run() -> (Option<u16>, Option<u16>, Option<u16>) {
    (to_port(8080), to_port(70_000), to_port(-1))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_and_rejects() {
        assert_eq!(run(), (Some(8080), None, None));
    }
}
```

```solution
pub fn to_port(n: i64) -> Option<u16> {
    n.try_into().ok()
}

pub fn run() -> (Option<u16>, Option<u16>, Option<u16>) {
    (to_port(8080), to_port(70_000), to_port(-1))
}
```

@hint `try_into` already returns a fallible type. Wrapping it in `Some` claims it always succeeded.
@hint `Result<T, E>` has a method that throws the error away and gives you `Option<T>`.
@hint `n.try_into().ok()`. No `Some` needed — `.ok()` produces the `Option` for you.

@diagnose E0308
`expected u16, found Result<u16, TryFromIntError>`. `Some(...)` promised an
`Option<u16>`, so whatever is inside the parentheses must be a `u16`, and
`try_into` gave you a `Result` instead.

That `Result` is the whole difference between this and `n as u16`. The cast
version compiles, never complains, and turns `70_000` into `4464` and `-1` into
`65535` by keeping the low sixteen bits. Both are legal `u16` values and both are
wrong, and nothing in the program will ever mention it.

`TryFrom` exists to make that failure a value you must handle. `.ok()` is the
shortest handling: discard *why* it failed and keep *whether* it did.

@diagnose E0277
`the trait bound u16: From<i64> is not satisfied` means you reached for `into()`
or `u16::from(n)`. Those are the infallible conversions, and they only exist
where every input value fits in the output type — `u16::from(some_u8)` is fine,
`u16::from(some_i64)` cannot be, because most `i64` values have nowhere to go.
The fallible cousins are `TryFrom` and `try_into`, and they return a `Result`
precisely because the impl above could not be written honestly.

@after
Three conversions, three honesty levels, and the choice is a design decision
every time:

| | fails how | use when |
|---|---|---|
| `u16::from(x)` | cannot fail — no impl exists if it could | widening, always |
| `x.try_into()` | `Result` | the value came from a file, a socket, a user |
| `x as u16` | silently, by truncating | you proved it fits, or truncation is the intent |

The third row is where CVEs come from. A length that arrives as a `u64`, gets
cast to a `u32` for a buffer calculation, and wraps — that is a heap overflow
with a compile-clean cast in the middle of it.

## 8. The compiler will not guess the width

@kind fix
@concept turbofish

@expect E0284

`widest` reads a comma-separated list of byte counts and reports the largest.
Nothing in the function says what kind of number a field parses into, and the
compiler refuses to pick one for you.

Say what you mean. Note the values in the test before you choose — the obvious
first guess does not survive them.

```starter
pub fn widest(raw: &str) -> String {
    let best = raw
        .split(',')
        .map(|f| f.trim().parse().unwrap())
        .max()
        .unwrap();
    format!("{best}")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finds_the_largest() {
        assert_eq!(widest("1024, 65536, 300"), "65536");
    }
    #[test]
    fn handles_one_field() {
        assert_eq!(widest("42"), "42");
    }
}
```

```solution
pub fn widest(raw: &str) -> String {
    let best = raw
        .split(',')
        .map(|f| f.trim().parse::<u32>().unwrap())
        .max()
        .unwrap();
    format!("{best}")
}
```

@hint Trace what could pin the type of the parsed value. `max()` only needs `Ord`, and `format!` accepts anything that can be displayed. Nothing in that chain names a type.
@hint Give `parse` a type with the turbofish — `parse::<T>()` — or annotate the binding and let inference flow backwards from there.
@hint `65536` does not fit in a `u16`, so that guess compiles and then fails its test at run time. `u32` holds it comfortably.

@diagnose E0284
`type annotations needed`. `str::parse` is generic: `fn parse<F: FromStr>(&self)
-> Result<F, F::Err>`. Dozens of types implement `FromStr`, so the compiler needs
something in this function to pick one.

Follow what it had to work with. `parse()` produces an unknown `F`. `unwrap()`
keeps it unknown. `max()` requires only that `F: Ord`, which narrows nothing.
`format!("{best}")` accepts any `Display` type. At no point does anything commit
to a concrete type, and the integer fallback to `i32` cannot rescue it — that
fallback settles unconstrained integer *literals*, and there is no literal here,
only an unresolved trait obligation.

The fix goes wherever it reads best: `parse::<u32>()` puts the type on the
operation, `let best: u32 = ...` puts it on the binding. Inference runs over the
whole body, so both reach the same place.

@diagnose E0282
Same situation, stated more bluntly: `type annotations needed`. Something in the
function has no type and nothing later in the body settles it. The error's arrow
points at where rustc gave up, not necessarily at where the fix belongs — Rust
infers across the whole body, so annotating the binding, the `parse` call, or the
closure's return type all work equally.

@diagnose E0308
`expected u16, found ...`, or a test that panics on `65536`. If you picked `u16`
the code compiles cleanly and then `parse::<u16>()` returns `Err` for a number
above 65535, which `unwrap` turns into a panic. The compiler cannot help here:
the value lives in a string that is only read at run time. Choosing the width is
choosing what the program refuses to represent.

@after
The interesting part of this exercise is not the annotation, it is that you had
to choose a width. `u16` compiles perfectly and then panics on `65536`, because
`parse` correctly reports that the number does not fit and `unwrap` turns that
into a panic. The compiler could not have caught it — the data is only known at
run time.

That is the real content of this unit. A type is a claim about a range of
values, and choosing it is choosing what your program refuses to represent. Get
it right and out-of-range input becomes an error you handle; get it wrong and it
becomes a panic in production, or with `as`, a plausible wrong number that nobody
notices.
