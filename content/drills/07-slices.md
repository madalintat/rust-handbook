---
unit: 07-slices
---

## 1

What is `std::mem::size_of::<&[i32]>()` on a 64-bit machine?

- A. 8 — it is a pointer
- *B. 16 — a pointer and a length
- C. 24 — a pointer, a length and a capacity
- D. It depends on how many elements the slice has

@why
A slice reference is a **fat pointer**: an address plus an element count, two
words, sixteen bytes. The length has to be carried because `[i32]` has no fixed
width, so an address alone would not describe it.

C is the tempting one, and it is the answer for `Vec<i32>` and `String`. Those
own their buffer, so they also track capacity — how much room the allocation has
before it must grow. A slice owns nothing and can never grow, so a capacity
would be meaningless.

D confuses the view with the data. The elements live elsewhere; the number of
them is a `usize` in the pointer, and it is the same size whether there are three
or three million.

## 2

Does this compile?

```rust
fn shout(s: &String) -> String { s.to_uppercase() }

fn main() {
    println!("{}", shout("ferris"));
}
```

- A. Yes — a literal is a string
- *B. No — a literal is a `&str`, and `&str` does not coerce to `&String`
- C. No — `to_uppercase` is not defined on `String`
- D. Yes, but it allocates twice

@why
`error[E0308]: expected `&String`, found `&str``. The coercion runs one way only:
`&String` derefs to `&str`, never the reverse. There is no `String` here for a
`&String` to point at — the bytes of `"ferris"` sit in the executable's read-only
data, with no heap allocation and no capacity field anywhere.

A is the intuition from Python or Java, where there is one string type. Rust has
two, and they answer different questions: who owns these bytes, and where do I
find them.

The fix is to take `&str`, which then accepts both.

## 3

`let s = String::from("héllo");` — what is `s.len()`?

- A. 5
- *B. 6
- C. 10
- D. Undefined without a locale

@why
`len` on a string is **bytes**, and it is O(1) because the length is right there
in the handle. `é` is two bytes in UTF-8, so five characters occupy six bytes.

A is what you want most of the time and is not what the method gives you. The
character count is `s.chars().count()`, which is O(n) because it has to decode
the whole string, and the difference in cost is exactly why they are separate
methods with honest names.

Worth internalising before you write a length check on user input: every byte
index in Rust's string API — `len`, ranges, `is_char_boundary`, `find` — is a
byte offset.

## 4

What happens here?

```rust
let s = "héllo";
let part = &s[0..2];
```

- A. It fails to compile — `str` cannot be indexed
- B. `part` is `"hé"`
- *C. It compiles, then panics at runtime
- D. `part` is `"h"` and the extra byte is dropped

@why
Range indexing on a `str` **is** implemented, so this compiles. Byte 2 is the
second half of the two-byte `é`, so the slice would be invalid UTF-8, and the
runtime check panics: *byte index 2 is not a char boundary*.

A is the near-miss. `s[0]` — a bare integer — really does not compile, because
`Index<usize>` is not implemented for `str`. `s[0..2]` — a range — is a different
trait impl and it exists.

D is what a language that silently repairs input would do. Rust will not hand
back a `&str` that is not valid UTF-8, because every other function in the
standard library is allowed to assume it is.

## 5

Why is the panic in the previous question a panic rather than a compile error?

- A. Because checking it would slow compilation down too much
- *B. Because the index is a runtime value, so no type-level check can see it
- C. Because the standard library authors did not get round to it
- D. Because `str` has no bounds information at compile time

@why
`&s[..n]` for an `n` that comes from a file, a socket or a subtraction cannot be
checked before the program runs — that would need types that carry values.

So the design question was only what to do at runtime, and there the choice is
between returning an invalid `&str` and stopping. An invalid `&str` is undefined
behaviour, not a wrong answer, so the panic is the conservative option. `get`
exists for when failure is expected rather than a bug: it returns `None` for both
out-of-range and mid-character.

D is wrong on the facts — a `str` knows its length perfectly well; that is the
second word of the fat pointer.

## 6

Which of these can be passed to `fn total(v: &[i32]) -> i32`? Choose all that apply.

```rust
let v: Vec<i32> = vec![1, 2, 3];
let a: [i32; 3] = [1, 2, 3];
```

- *A. `&v`
- *B. `&a`
- *C. `&v[1..]`
- *D. `&[7, 8, 9]`
- E. `v`

@why
All four references work. A and B go through **deref coercion** and an unsized
coercion respectively — `Vec<i32>` derefs to `[i32]`, and `[i32; 3]` coerces to
`[i32]` by forgetting its compile-time length into the pointer's second word. C
is already a slice. D is a reference to a temporary array, coerced the same way
as B.

E is the odd one out: `v` is a `Vec<i32>` by value, and a `Vec` is not a slice —
it is an owner. You would be moving the vector into a parameter that wants a
borrow.

This is the whole argument for writing `&[T]` in signatures. One parameter type,
four call shapes, no allocations.

## 7

Why is `sort` defined on `[T]` rather than on `Vec<T>`?

- *A. So that every owner of a contiguous buffer gets it, including sub-ranges
- B. Because `Vec` cannot be mutated in place
- C. Because sorting requires a fixed size
- D. It is defined on both, identically

@why
Define it once on the view and `Vec<T>`, `[T; N]`, `Box<[T]>` and every
sub-range all get it through deref coercion. `v.sort()` works because method
lookup walks the deref chain from `Vec<i32>` to `[i32]`; `v[2..5].sort()` works
for exactly the same reason and sorts three elements in place.

The same reasoning puts `reverse`, `swap`, `fill`, `binary_search` and
`rotate_left` on the slice. The methods on `Vec` itself are the ones that need
ownership or the capacity field — `push`, `pop`, `insert`, `reserve`,
`truncate`.

## 8

Does this compile?

```rust
fn first(v: &Vec<i32>) -> i32 {
    v.sort();
    v[0]
}
```

- A. Yes
- *B. No — `sort` needs `&mut`, and `v` is behind a shared reference
- C. No — `sort` is not a method on `Vec`
- D. Yes, but the sort has no effect outside the function

@why
`error[E0596]: cannot borrow `*v` as mutable, as it is behind a `&` reference`.
`sort` takes `&mut self`, and a shared reference cannot be upgraded to a unique
one — shared references can be duplicated freely, so allowing the upgrade would
permit two writers at once.

D is the intuition from a language with copied parameters, and it is worth
killing. `&Vec<i32>` points at the caller's vector; if the sort were allowed it
would very much be visible outside. Rust's answer is not "it does not matter" but
"say so in the signature": `&mut [i32]`.

## 9

What does this print?

```rust
let v = [1, 2, 3, 4];
println!("{} {}", v.chunks(2).count(), v.windows(2).count());
```

- A. `2 2`
- *B. `2 3`
- C. `2 4`
- D. `4 3`

@why
`chunks(2)` partitions into disjoint pieces: `[1,2]` and `[3,4]` — two of them.
`windows(2)` slides one element at a time: `[1,2]`, `[2,3]`, `[3,4]` — three, and
in general `len - n + 1`.

Reach for `windows` when you are comparing neighbours (is this sequence sorted,
where are the jumps) and `chunks` when you are batching (rows of a grid, records
of a fixed width). Two edge cases worth remembering: `chunks` yields a short final
piece if the length does not divide evenly, and `windows(n)` yields nothing at all
when the slice is shorter than `n`.

## 10

`v` is a `Vec<i32>` with three elements. Which of these panics? Choose all that apply.

- *A. `v[5]`
- B. `v.get(5)`
- *C. `&v[1..9]`
- D. `v.get(1..9)`
- E. `v.first()`

@why
Indexing panics on a bad index or a bad range; `get` returns `None` for both.
That is the whole distinction, and it is repeated all over the standard library —
`HashMap`, `str`, `VecDeque` all have the pair.

`first` returns `Option<&i32>` and never panics, even on an empty slice.

Choose by where the index came from. A loop counter you derived from `v.len()`
cannot be out of range, so `v[i]` is clearer and the bounds check is usually
optimised away. An index from a config file, a network message, or a subtraction
you have not proved anything about wants `get`.

## 11

Does this compile?

```rust
let mut v = vec![1, 2, 3, 4];
let left = &mut v[..2];
let right = &mut v[2..];
left[0] += right[0];
```

- A. Yes — the ranges do not overlap
- *B. No — two mutable borrows of `v` at once
- C. No — you cannot index with a range
- D. Yes, but only in release mode

@why
`error[E0499]`. Each `&mut v[..]` desugars to `index_mut(&mut *v, ..)`, which
mutably borrows the **whole** vector and returns a piece of it. Two such calls
with both results still live is two unique borrows of one value.

A states a true fact that the compiler cannot use. Borrow checking reasons about
types and regions, not about arithmetic on range endpoints; a rule that could see
`..2` and `2..` are disjoint would be a rule about proving integer inequalities.

`v.split_at_mut(2)` is the answer: one borrow in, two disjoint slices out, with
the non-overlap guaranteed by construction. Inside, it is a small `unsafe` block
in the standard library — which is the normal shape of things, not a cheat.

## 12

Given `let s = "héllo";`, which expression yields `'é'`?

- A. `s.as_bytes()[1] as char`
- *B. `s.chars().nth(1).unwrap()`
- C. `s[1..2].chars().next().unwrap()`
- D. `s.bytes().nth(1).unwrap() as char`

@why
`chars()` decodes UTF-8 and yields `char` values, so the second one is `é`.

A and D are the same mistake written two ways: the second *byte* of `"héllo"` is
`0xC3`, the first half of the two-byte sequence for `é`. Casting a `u8` to `char`
reinterprets it as a Unicode code point, giving `Ã`. It compiles, it is wrong,
and it is wrong only for non-ASCII input — so it passes every test you wrote in
English.

C panics rather than misbehaving: byte 2 is not a character boundary.

When you need a byte offset you can safely slice at, `char_indices()` gives you
exactly those offsets alongside the characters.

## 13

Which of these is the reason `&'static str` needs no lifetime plumbing?

- A. Because `str` is a primitive type
- *B. Because the bytes are in the binary and are never freed
- C. Because the compiler copies the literal into every function that uses it
- D. Because `'static` disables the borrow checker for that reference

@why
A string literal's bytes are laid into the read-only section of the executable,
mapped before `main` starts and never released. A reference to them is valid for
the whole run, and `'static` is the name for that.

D is a genuinely common misreading. `'static` is a claim, not an exemption — the
compiler checks it, and it will refuse `&'static str` built from a local
`String`, because that heap buffer really is freed when the function returns.

That refusal is the useful half. `fn banner() -> &str` is `error[E0106]` not
because the compiler is fussy, but because it will not invent a promise about how
long the returned reference is good for.

## 14

What is the cost of `&v[1..4]` on a `Vec<i32>` with a thousand elements?

- *A. A bounds check and two words written to the stack
- B. A heap allocation and three elements copied
- C. Nothing at all — slices are a compile-time concept
- D. Proportional to the length of the vector

@why
A slice expression adds the start offset to the base pointer and stores that plus
the length. Three elements are not copied and no allocator is touched, which is
why passing sub-ranges around is free enough to do in a loop.

B is the Python intuition — `v[1:4]` there builds a new list. The consequence of
Rust's choice is that the slice **borrows**: it cannot outlive `v`, and `v`
cannot be pushed to or dropped while it is alive. That restriction is the price
of the zero cost, and the borrow checker is where you pay it.

The bounds check is real but cheap, and it disappears entirely when the range is
provable from surrounding code.

## 15

You are writing a function that takes some text, and you want it to be callable
with as many argument types as possible while allocating nothing. What should the
parameter be?

- A. `String`
- B. `&String`
- *C. `&str`
- D. `AsRef<str>` by value

@why
`&str` accepts a literal, a `&String` by deref coercion, a slice of either, and
the output of any function returning a `&str`. It costs two words to pass and
allocates nothing.

`String` forces every caller to hand over ownership, and a caller holding a
literal has to allocate one just to make the call. `&String` is the worst of
both: it demands a heap-allocated `String` behind the reference and gives you no
extra ability once you have it.

D is not a type — `AsRef<str>` is a trait, so it would have to be
`impl AsRef<str>` or a generic parameter. That is a real pattern and it buys you
`String`, `&str` and `PathBuf` in one signature, at the cost of monomorphising a
copy per argument type. `&str` first; reach for the generic when you actually
need it.
