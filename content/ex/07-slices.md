---
unit: 07-slices
---

## 1. The signature that refuses a literal

@kind fix
@concept str
@expect E0308

`word_count` reads a string and counts the spaces between words. It never keeps
the string and it never grows it. Its parameter type is `&String` though, which
insists on a heap-allocated `String` behind the reference, so the literal on the
second call is rejected.

Widen the function so both calls work. Change nothing else.

```starter
pub fn word_count(s: &String) -> usize {
    s.split_whitespace().count()
}

pub fn run() -> usize {
    let owned = String::from("one two three");
    word_count(&owned) + word_count("four five")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_both() {
        assert_eq!(run(), 5);
    }
    #[test]
    fn takes_a_literal() {
        assert_eq!(word_count("a b c d"), 4);
    }
}
```

```solution
pub fn word_count(s: &str) -> usize {
    s.split_whitespace().count()
}

pub fn run() -> usize {
    let owned = String::from("one two three");
    word_count(&owned) + word_count("four five")
}
```

@hint A string literal is not a `String`. It is a view onto bytes stored in the executable.
@hint There is a borrowed string type that describes *any* run of UTF-8 bytes, wherever they live.
@hint `pub fn word_count(s: &str) -> usize`. The `word_count(&owned)` call still compiles, because `&String` coerces to `&str` automatically.

@diagnose E0308
`expected `&String`, found `&str``. Both are references to text and neither is
wrong in itself; they simply describe different things.

`&String` points at the three-word handle (pointer, length, capacity) that owns
a heap buffer. Only a real `String` has one. `&str` points at the bytes directly:
address plus length, two words, with no claim about where those bytes came from.

`"four five"` lives in the read-only data of your binary. There is no `String`
anywhere for a `&String` to point at, so the call cannot be made. Note that the
other call, `word_count(&owned)`, is fine either way: a `&String` coerces down
to a `&str`, though never the other way round.

@diagnose E0277
You may have reached for `.to_string()` or `String::from` inside the call and
then hit a trait bound instead. That works, but it allocates a fresh heap buffer
and copies nine bytes in order to pass them to a function that only counts
spaces. The type is the thing to change, not the argument.

@after
`&str` over `&String` is not a style preference, it is strictly more capacity for
strictly less. The function now accepts literals, owned strings, slices of either,
and the output of anything that returns a `&str`, and it costs exactly the same
two words to pass.

The same rule one level up: `&[T]` rather than `&Vec<T>`, `&Path` rather than
`&PathBuf`. **Accept the borrowed view, return the owned value.** If you ever
find yourself writing `&String` in a signature, the compiler is about to teach
you this anyway.

## 2. A reference to what?

@kind fix
@concept str
@expect E0106

The constant compiles. The function, which returns the very same thing, does not.

Read the error, then say out loud how long the returned reference is valid for.
The fix is writing that sentence down.

```starter
pub const NAME: &str = "ferris";

pub fn banner() -> &str {
    NAME
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn returns_the_name() {
        assert_eq!(banner(), "ferris");
    }
    #[test]
    fn outlives_everything() {
        let s: &'static str = banner();
        assert_eq!(s.len(), 6);
    }
}
```

```solution
pub const NAME: &str = "ferris";

pub fn banner() -> &'static str {
    NAME
}
```

@hint The bytes of a string literal are compiled into the executable. When are they freed?
@hint They are never freed. There is a lifetime name for exactly that.
@hint `pub fn banner() -> &'static str`.

@diagnose E0106
`missing lifetime specifier`, and underneath it, `this function's return type
contains a borrowed value, but there are no arguments for it to be borrowed
from`.

Every reference has a lifetime. Usually the compiler works it out for you: a
function with one reference parameter gives its lifetime to the return, which
covers most signatures you will write. `banner` has no parameters at all, so
there is nothing to copy a lifetime from, and rustc will not guess.

The constant escapes the same complaint because constants and statics have a
built-in rule: an elided lifetime in their type is always `'static`. The function
has to say it.

@after
`'static` does not mean "lives a long time"; it means "valid for the remaining
duration of the program". A string literal earns it honestly: its bytes sit in
the read-only section of the binary, mapped before `main` runs and never freed.

This is why `&'static str` costs nothing and appears everywhere: error messages,
`const` tables, enum-to-name conversions. It is also worth knowing what it does
*not* let you do. You cannot return `&'static str` built from a local `String`,
because that buffer really is freed at the end of the function. `'static` is a
claim the compiler checks, not a wish you express.

## 3. The first character

@kind fix
@concept utf-8
@expect E0277

`initial` should give back the first character of a string. Indexing is the
obvious way to write it, and it does not compile. That is deliberate, and the
second test name says why.

```starter
pub fn initial(s: &str) -> char {
    s[0]
}

pub fn run() -> String {
    format!("{} {}", initial("ferris"), initial("émile"))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ascii_name() {
        assert_eq!(initial("ferris"), 'f');
    }
    #[test]
    fn multibyte_name() {
        assert_eq!(initial("émile"), 'é');
    }
    #[test]
    fn formats_both() {
        assert_eq!(run(), "f é");
    }
}
```

```solution
pub fn initial(s: &str) -> char {
    s.chars().next().unwrap()
}

pub fn run() -> String {
    format!("{} {}", initial("ferris"), initial("émile"))
}
```

@hint A `str` is a sequence of bytes, and a character can occupy up to four of them. Which one would `s[0]` return?
@hint Rust makes you say which sequence you want to walk: the bytes, or the characters.
@hint `s.chars()` is an iterator of `char`. Take the first one.

@diagnose E0277
`the type `str` cannot be indexed by `{integer}``, and below it, `the trait
`Index<{integer}>` is not implemented for `str``.

That trait is missing on purpose. Indexing is expected to be O(1), and in UTF-8
the *n*th character is not at a constant offset: `é` is two bytes, an emoji is
four. So `s[0]` would have to return either a byte, which is not a character, or
the result of a scan, which is not constant time. Both would be a quiet lie, so
the operation simply does not exist.

What does exist is a choice: `s.bytes()` walks bytes, `s.chars()` walks Unicode
scalar values, and `s.char_indices()` walks both together. Range indexing,
`&s[0..2]`, does exist, but the numbers in it are byte offsets.

@diagnose E0308
Something in your expression is a `&str` or a `u8` where a `char` is wanted. A
common near-miss is `s.as_bytes()[0]`, which is a `u8`; casting it with `as char`
compiles but is wrong for `"émile"`, because the first byte of `é` is `0xC3` and
that cast produces `Ã`. The other near-miss is `&s[0..1]`, a `&str` of one
byte, which panics on a multibyte first character.

@after
`chars().next()` is honest about the cost: it decodes one UTF-8 sequence and
stops. That is a handful of instructions, not a scan, so the "slow" version is
also the fast one here. `chars().count()`, by contrast, really does walk the
whole string, which is why `len()` and the number of characters are different
functions with different costs.

`unwrap()` is doing real work in that solution: an empty string has no first
character. `chars().next()` returns `Option<char>`, and in production you would
propagate it rather than panic. The type is telling you about a case you have not
handled yet.

## 4. One function, three shapes of data

@kind fix
@concept slice
@expect E0308

`total` sums some integers. It is written to take `&Vec<i32>`, which means it can
be called with a vector and nothing else: not an array, and not a sub-range of
the vector it was just handed.

`run` wants all three. Make it work.

```starter
pub fn total(v: &Vec<i32>) -> i32 {
    v.iter().sum()
}

pub fn run() -> i32 {
    let v = vec![1, 2, 3];
    let arr = [10, 20];
    total(&v) + total(&arr) + total(&v[1..])
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sums_all_three() {
        assert_eq!(run(), 41);
    }
    #[test]
    fn accepts_an_array_literal() {
        assert_eq!(total(&[7, 8, 9]), 24);
    }
}
```

```solution
pub fn total(v: &[i32]) -> i32 {
    v.iter().sum()
}

pub fn run() -> i32 {
    let v = vec![1, 2, 3];
    let arr = [10, 20];
    total(&v) + total(&arr) + total(&v[1..])
}
```

@hint All three arguments are runs of `i32` in memory. Only one of them happens to be owned by a `Vec`.
@hint A slice is a pointer and a length. It does not care who allocated the elements.
@hint `pub fn total(v: &[i32]) -> i32`. Every call site stays exactly as it is.

@diagnose E0308
Two of the three calls fail, and they fail differently.

`total(&arr)` gives `expected `&Vec<i32>`, found `&[i32; 2]``. An array's length
is part of its type; there is no `Vec` here at all, and no heap allocation for a
`&Vec` to point at.

`total(&v[1..])` gives `expected `&Vec<i32>`, found `&[i32]``. Indexing a `Vec`
with a range produces a slice, not another `Vec`. It borrows a window into the
same buffer.

Only `total(&v)` compiles, and even that is not exact: `&Vec<i32>` is being
accepted where the parameter says `&Vec<i32>`. Widen the parameter to `&[i32]`
and all three go through, the first by deref coercion.

@after
The reason `total(&v)` still works after the change is **deref coercion**.
`Vec<T>` implements `Deref<Target = [T]>`, so at a coercion site (passing an
argument, a `let` with a type annotation, method lookup) the compiler will
insert the dereference and hand over `&*v`, which is a `&[T]`.

The same machinery gives you `&String` to `&str` and `&Box<T>` to `&T`. It is
also why `v.sort()` compiles when `sort` is defined on `[T]` and not on `Vec<T>`:
method lookup walks the deref chain. That is one rule doing the work in every
one of those places.

## 5. Ask, do not assume

@kind fix
@concept slice
@expect E0308

`nth` is supposed to answer "is there an element here, and what is it" without
crashing when the answer is no. It currently indexes, which answers only the
first half of that question and panics for the second.

The signature already tells you the shape of the answer. Make the body match it.

```starter
pub fn nth(v: &[i32], i: usize) -> Option<i32> {
    v[i]
}

pub fn run() -> (Option<i32>, Option<i32>) {
    let v = vec![7, 8, 9];
    (nth(&v, 1), nth(&v, 99))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hit_and_miss() {
        assert_eq!(run(), (Some(8), None));
    }
    #[test]
    fn empty_slice_is_none() {
        assert_eq!(nth(&[], 0), None);
    }
}
```

```solution
pub fn nth(v: &[i32], i: usize) -> Option<i32> {
    v.get(i).copied()
}

pub fn run() -> (Option<i32>, Option<i32>) {
    let v = vec![7, 8, 9];
    (nth(&v, 1), nth(&v, 99))
}
```

@hint Indexing has already decided what to do about a bad index: panic. You want the decision handed back to the caller.
@hint Slices have a method that returns `Option<&T>` instead of panicking.
@hint `v.get(i)` gives `Option<&i32>`. You need `Option<i32>`, so `.copied()` or `.map(|x| *x)` will get you there.

@diagnose E0308
`expected `Option<i32>`, found `i32``.

`v[i]` is sugar for `*v.index(i)`, and `Index::index` has no way to report
failure: its return type is the element itself, so an out-of-range index has
nowhere to go except a panic. That is the right default for a bug, since an index
you computed wrongly should stop the program near the mistake. It is the wrong
default for input you do not control.

`get` is the same lookup with the failure written into the type: `Option<&T>`.
Nothing panics, and the caller has to acknowledge the `None` case before it can
touch the value.

@diagnose E0277
If you wrote `v.get(i)` on its own you will see a mismatch between `Option<&i32>`
and `Option<i32>`. One is a reference to an element in the slice, the other a
copy of it. Since `i32` is `Copy`, `.copied()` converts between them for free.
Returning the reference instead would work too, but it would tie the caller's
value to the lifetime of the slice for no benefit.

@after
Both forms exist because both are right, in different places. `v[i]` where the
index is provably in range, say a loop counter over `0..v.len()`, is clear, and
the bounds check is usually optimised away once the compiler can see the
bound. `v.get(i)` where the index came from a user, a file, or an arithmetic
result you have not proved anything about.

The same pair appears throughout the standard library: `HashMap` has `[]` and
`get`, `str` has `&s[a..b]` and `s.get(a..b)`, and `Vec` has `remove` and
`pop`. One panics, one returns `Option`. Choosing between them is choosing who
handles the failure.

## 6. Two halves of one vector

@kind fix
@concept slice
@expect E0499

`swap_halves` exchanges the front half of a slice with the back half. The logic
is right. The borrow is not: the two `&mut` expressions are, as far as the
compiler can tell, two mutable borrows of the whole slice at once.

There is a single method that produces both halves in one step, and it exists
precisely because of this error.

```starter
pub fn swap_halves(v: &mut [i32]) {
    let n = v.len() / 2;
    let left = &mut v[..n];
    let right = &mut v[n..];
    for i in 0..n {
        std::mem::swap(&mut left[i], &mut right[i]);
    }
}

pub fn run() -> Vec<i32> {
    let mut v = vec![1, 2, 3, 4, 5, 6];
    swap_halves(&mut v);
    v
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn swaps_six() {
        assert_eq!(run(), vec![4, 5, 6, 1, 2, 3]);
    }
    #[test]
    fn odd_length_leaves_the_last_one() {
        let mut v = vec![1, 2, 3, 4, 5];
        swap_halves(&mut v);
        assert_eq!(v, vec![3, 4, 1, 2, 5]);
    }
}
```

```solution
pub fn swap_halves(v: &mut [i32]) {
    let n = v.len() / 2;
    let (left, right) = v.split_at_mut(n);
    for i in 0..n {
        std::mem::swap(&mut left[i], &mut right[i]);
    }
}

pub fn run() -> Vec<i32> {
    let mut v = vec![1, 2, 3, 4, 5, 6];
    swap_halves(&mut v);
    v
}
```

@hint The two ranges do not overlap, but nothing in the two separate expressions tells the compiler that.
@hint Look for a slice method that takes one index and returns a pair of mutable slices.
@hint `let (left, right) = v.split_at_mut(n);` is one call, one borrow, and two disjoint halves.

@diagnose E0499
`cannot borrow `*v` as mutable more than once at a time`.

`&mut v[..n]` desugars to `IndexMut::index_mut(&mut *v, ..n)`, which takes a
mutable borrow of the **entire** slice and returns a piece of it. The second line
does the same thing again, and the first borrow is still live because `left` is
used further down. Two unique borrows of one value, which is the rule the
borrow checker exists to enforce.

The compiler is not being obtuse: it reasons about types and borrow regions, not
about arithmetic on range bounds. It cannot see that `..n` and `n..` are
disjoint, and a general rule that tried to would be a rule about proving integer
inequalities.

@diagnose E0502
If you rearranged the code you may have hit the shared-versus-unique form of the
same problem: a `v.len()` or an index read while a `&mut` borrow of `v` is
alive. Compute the length into a local `usize` *before* taking any mutable
borrow; after that, `n` is a plain number that borrows nothing.

@after
`split_at_mut` is the sanctioned answer, and it is worth knowing what it is: an
`unsafe` block inside the standard library, wrapped in a safe signature. It
takes one `&mut [T]`, forms two raw pointers, and hands back two mutable slices
whose non-overlap it guarantees by construction rather than by proof.

That is the pattern for the whole language. `unsafe` is not a mode you write your
program in; it is a small, audited implementation detail underneath a safe
interface. When you meet a borrow error that you are *certain* is safe, the
first move is to look for the standard library function that already encapsulates
it: `split_at_mut`, `iter_mut`, `chunks_mut`, `split_first_mut`. There usually
is one.

## 7. Reversing in place

@kind fix
@concept slice
@expect E0596

`reverse_in_place` walks in from both ends swapping pairs, which is the right
algorithm. What it cannot do is modify anything: its parameter is a shared slice,
and `swap` needs unique access.

Fix the signature and the call site. Do not reach for a temporary `Vec`.

```starter
pub fn reverse_in_place(v: &[i32]) {
    let n = v.len();
    for i in 0..n / 2 {
        v.swap(i, n - 1 - i);
    }
}

pub fn run() -> Vec<i32> {
    let mut v = vec![1, 2, 3, 4, 5];
    reverse_in_place(&v);
    v
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reverses_odd_length() {
        assert_eq!(run(), vec![5, 4, 3, 2, 1]);
    }
    #[test]
    fn works_on_a_sub_range() {
        let mut v = vec![9, 1, 2, 3, 9];
        reverse_in_place(&mut v[1..4]);
        assert_eq!(v, vec![9, 3, 2, 1, 9]);
    }
}
```

```solution
pub fn reverse_in_place(v: &mut [i32]) {
    let n = v.len();
    for i in 0..n / 2 {
        v.swap(i, n - 1 - i);
    }
}

pub fn run() -> Vec<i32> {
    let mut v = vec![1, 2, 3, 4, 5];
    reverse_in_place(&mut v);
    v
}
```

@hint `swap` moves elements around, so it needs more than permission to look.
@hint A shared slice `&[T]` grants read access to every holder at once. Writing needs the unique form.
@hint `pub fn reverse_in_place(v: &mut [i32])`, called as `reverse_in_place(&mut v)`.

@diagnose E0596
`cannot borrow `*v` as mutable, as it is behind a `&` reference`.

The note underneath is the useful half: `consider changing this to be a mutable
reference`. `swap` is declared `fn swap(&mut self, a: usize, b: usize)`, so
calling it requires a `&mut [i32]`, and you cannot manufacture one from a
`&[i32]`. A shared reference can be duplicated freely, so if it could be upgraded
to a unique one, two writers could exist at once. That is the data race the
whole system is built to prevent.

Notice that `v.len()` is fine on the same line. Reading needs nothing more than
the shared borrow you already have. Only the write is rejected.

@diagnose E0308
Once the parameter is `&mut [i32]`, the call site has to match: `reverse_in_place(&v)`
passes a `&Vec<i32>`, which coerces to `&[i32]` but not to `&mut [i32]`. Pass
`&mut v`. Rust never inserts a mutable borrow implicitly, because taking unique
access is a decision the caller must be seen to have made.

@after
The second test is the interesting one. `reverse_in_place(&mut v[1..4])` reverses
three elements in the middle of a five-element vector, in place, without
allocating or copying anything. `&mut [i32]` is a pointer and a length, and
nothing in the function cares that there are other elements either side.

This is why the standard library puts `sort`, `reverse`, `swap`, `fill` and
`rotate_left` on `[T]` rather than on `Vec<T>`. Define them once on the view and
every owner gets them for free, at every granularity, through deref coercion.

## 8. Truncate without splitting a character

@kind fix
@concept char boundary
@expect E0308

`truncate` should cut a string down to at most `max_bytes` bytes and never split
a character in half. The starter reaches for `get`, which is the right
instinct, since `get` returns `None` rather than panicking on a bad boundary.
The types do not line up, though, and returning "nothing" is not what the caller
asked for anyway.

Look at the third test before you start. `"héllo"` truncated to two bytes is
`"h"`, because byte 2 lands in the middle of `é`.

```starter
pub fn truncate(s: &str, max_bytes: usize) -> &str {
    s.get(..max_bytes)
}

pub fn run() -> (&'static str, &'static str) {
    (truncate("ferris", 3), truncate("héllo", 2))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ascii_cuts_exactly() {
        assert_eq!(truncate("ferris", 3), "fer");
    }
    #[test]
    fn longer_than_the_string_is_the_whole_string() {
        assert_eq!(truncate("ferris", 99), "ferris");
    }
    #[test]
    fn backs_off_a_split_character() {
        assert_eq!(truncate("héllo", 2), "h");
        assert_eq!(truncate("héllo", 3), "hé");
    }
    #[test]
    fn zero_is_empty() {
        assert_eq!(truncate("héllo", 0), "");
    }
    #[test]
    fn run_returns_both() {
        assert_eq!(run(), ("fer", "h"));
    }
}
```

```solution
pub fn truncate(s: &str, max_bytes: usize) -> &str {
    if max_bytes >= s.len() {
        return s;
    }
    let mut end = max_bytes;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

pub fn run() -> (&'static str, &'static str) {
    (truncate("ferris", 3), truncate("héllo", 2))
}
```

@hint `s.get(..n)` returns `Option<&str>`, and the signature promises a `&str`. Unwrapping it is not the answer either, because for `("héllo", 2)` there is nothing to unwrap.
@hint When the requested cut is not a valid boundary, you have to move it. Which direction keeps the result within `max_bytes`?
@hint `str::is_char_boundary(n)` is `true` at 0 and at the end, and at the start of every character. Walk `end` down until it returns `true`, then slice.

@diagnose E0308
`expected `&str`, found `Option<&str>``.

`get` deliberately hands back an `Option` because there are two separate ways the
request can fail: the range can run past the end of the string, and it can land
in the middle of a multi-byte character. Both produce `None`.

You cannot paper over it with `.unwrap()`. `truncate("héllo", 2)` really is
`None`, because byte 2 is the second half of `é`, so unwrapping panics on the
very case the exercise is about. The `Option` is not noise in the signature; it is the
problem you have been asked to solve, and solving it means choosing a different
byte offset.

@diagnose E0507
If you tried to build the answer out of `chars()` you may have hit an ownership
error instead. Collecting characters produces a new `String`, which cannot be
returned as a `&str` borrowed from the argument, because that buffer is freed at
the end of the function. The whole point of returning `&str` here is that
truncation copies nothing: the answer is a shorter view of the same bytes.

@after
The interesting part is the panic you avoided. `&s[..2]` on `"héllo"` compiles
without complaint and then panics at runtime with *byte index 2 is not a char
boundary*. This is one of the very few places Rust chooses a runtime panic over a
compile error, and the reason is that the index is a value, not a type. The
compiler cannot check `&s[..n]` for an `n` it will not know until the program
runs.

The alternative was to hand back a `&str` containing half a character, and every
other function in the standard library is allowed to assume that a `&str` is
valid UTF-8. Breaking that assumption is undefined behaviour, not a wrong answer.
Given a choice between corrupting the invariant and stopping the program, Rust
stops the program, and hands you `get` and `is_char_boundary` so you never have
to reach that point.
