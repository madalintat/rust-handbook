---
num: 7
slug: 07-slices
title: Slices and fat pointers
accent: ferris
concepts: slice, fat pointer, str, String, deref coercion, utf-8, char boundary, windows
needs: 05-ownership, 06-borrowing
blurb: A pointer that carries its own length, why every function should take &str, and why a string cannot be indexed by a number.
---

%% A function that takes `Vec<i32>` can be called with a `Vec<i32>` and nothing else. Not an array, not a fixed buffer on the stack, not the middle three elements of another vector. That is an absurd restriction for a function that only reads, and the slice is the fix: a borrowed view into a run of elements that carries its own length, so it never needs to know what it is a view *of*.

Slices are also where Rust's strings stop resembling Python's and start behaving like the bytes they actually are.

## A view with a length attached

### The problem with a bare pointer

C's answer to "a run of bytes" is a pointer, and the length is somebody else's problem — a second parameter, a trailing NUL, a comment above the prototype. Each of those is a place to be wrong, and being wrong means reading memory you do not own.

Rust puts the length *in* the reference.

```rust
let v = vec![10, 20, 30, 40, 50];
let all: &[i32] = &v;          // all five
let mid: &[i32] = &v[1..4];    // 20, 30, 40
```

`mid` is a **slice**: an address and a count, borrowed from `v`. `&v[1..4]` allocates nothing and copies no elements — it is two words of arithmetic.

:::memory let mid = &v[1..4]
       STACK                                  HEAP
     ┌─────────────────────┐       ┌────┬────┬────┬────┬────┐
 v   │ ptr      ●──────────┼──────▶│ 10 │ 20 │ 30 │ 40 │ 50 │
     │ len      5          │       └────┴────┴────┴────┴────┘
     │ capacity 5          │                ▲
     ├─────────────────────┤                │
 mid │ ptr      ●──────────┼────────────────┘
     │ len      3          │       16 bytes on the stack.
     └─────────────────────┘       Nothing on the heap.
:::

### Why the pointer is fat

`&i32` is one word. An address is enough, because the compiler already knows an `i32` occupies four bytes. `[i32]` has no fixed width — it means "some number of `i32`s" — so an address alone cannot describe it. The reference carries the missing half.

| type | words | what it holds |
|---|---|---|
| `&i32` | 1 | address |
| `&[i32]` | 2 | address, element count |
| `&str` | 2 | address, length in **bytes** |
| `&dyn Trait` | 2 | address, vtable pointer |

A reference with a second word attached is a **fat pointer**. `size_of::<&i32>()` is 8; `size_of::<&[i32]>()` is 16. That extra word is the entire mechanism, and it is why a slice can be bounds-checked at all.

:::note
A slice is a **borrowed view**: pointer plus length, two words, owning nothing and allocating nothing. `&[T]` over arrays, vectors and other slices; `&str` over UTF-8 bytes.
:::

## String and &str

### One owns, one looks

```rust
let owned: String = String::from("ferris");  // heap buffer, growable, owned
let view:  &str   = &owned;                  // ptr + len into that buffer
let lit:   &str   = "ferris";                // ptr + len into the executable
```

| | `String` | `&str` |
|---|---|---|
| size on stack | 24 bytes (ptr, len, capacity) | 16 bytes (ptr, len) |
| owns the bytes | yes — frees them on drop | no |
| can grow | `push_str`, `push` | never |
| where the bytes live | heap | anywhere: heap, binary, stack |

`String` is to `&str` exactly what `Vec<T>` is to `&[T]`: an owning, growable buffer versus a window onto one.

### Take `&str`, return `String`

```rust,bad
fn shout(s: &String) -> String { s.to_uppercase() }

shout("ferris");     // error[E0308]: expected `&String`, found `&str`
```

A `&String` can only ever point at a heap-allocated `String`. The literal is not one, so it is rejected — for a function that only reads six bytes.

```rust,good
fn shout(s: &str) -> String { s.to_uppercase() }

shout("ferris");     // fine
shout(&owned);       // also fine — &String coerces to &str
```

:::note
**Accept the borrowed form, return the owned one.** `&str` in, `String` out. `&[T]` in, `Vec<T>` out. Taking `&String` or `&Vec<T>` costs you callers and buys you nothing.
:::

### Literals are `&'static str`

The bytes of `"ferris"` are baked into the read-only section of your executable before the program starts, and are never freed. So the view onto them is valid for the whole run, which is what `'static` says.

```rust,bad
fn banner() -> &str { "rust handbook" }   // error[E0106]
```

```rust,good
fn banner() -> &'static str { "rust handbook" }
```

Rust will not guess the lifetime of a returned reference when there is no argument to borrow from. Written out, the claim is honest: *this points at something that outlives everything*.

## Slices of anything

### Array, slice, Vec

```rust
let arr: [i32; 3] = [1, 2, 3];    // fixed size, part of the type
let v:   Vec<i32> = vec![1, 2, 3]; // heap, growable
let s:   &[i32]   = &arr[..];      // view onto either
```

| | `[T; N]` | `&[T]` | `Vec<T>` |
|---|---|---|---|
| lives | inline, wherever it is | nowhere — it is a view | heap |
| size known at compile time | yes, `N` is in the type | no | no |
| owns its elements | yes | no | yes |
| resizeable | no | no | yes |
| cost to pass by value | copies all `N` elements | 16 bytes | moves 24 bytes |

`N` being part of the type is the sharp edge: `[i32; 3]` and `[i32; 4]` are different types, so a function taking `[i32; 3]` is useless for anything else. `&[i32]` accepts every one of them.

### Why `&v` works where `&[T]` is wanted

```rust
fn total(v: &[i32]) -> i32 { v.iter().sum() }

let v = vec![1, 2, 3];
total(&v);          // &Vec<i32> — accepted
total(&v[1..]);     // &[i32]
total(&[7, 8, 9]);  // &[i32; 3] — accepted
```

`Vec<T>` implements `Deref<Target = [T]>`, so where a `&[T]` is expected the compiler will insert the dereference for you. This is **deref coercion**, and it is why `&String` satisfies `&str` and `&Box<T>` satisfies `&T`. It happens only at coercion sites — argument passing, `let` with a type annotation, method lookup — never as part of type inference in general.

:::compare
**Python** — `v[1:4]` copies. In Rust it does not: `&v[1..4]` borrows, so it cannot outlive `v`, and mutating `v` while the slice is alive is a compile error rather than a surprise.

**C++** — `&[T]` is `std::span<const T>` and `&str` is `std::string_view`, promoted into the language and checked. The dangling-view footgun both of those carry is a borrow-check error here.

**Go** — a Go slice owns a capacity and can be appended to. A Rust slice cannot grow at all; growth belongs to `Vec`.
:::

## UTF-8, and why `s[0]` is a compile error

### Bytes are not characters

Rust strings are UTF-8, always. A `char` is a 32-bit Unicode scalar value; a `str` is a sequence of bytes, where one character occupies one to four of them.

:::memory "héllo" — five characters, six bytes
   byte  0    1    2    3    4    5
       ┌────┬────┬────┬────┬────┬────┐
       │ h  │ c3 │ a9 │ l  │ l  │ o  │
       └────┴────┴────┴────┴────┴────┘
              └─── é ───┘
       s.len() == 6      s.chars().count() == 5
:::

```rust,bad
let s = String::from("héllo");
let first = s[0];      // error[E0277]: `String` cannot be indexed by `{integer}`
```

This is deliberate. `s[0]` would have to return *something* in constant time, and every candidate is a lie: a byte is not a character, and the character requires a scan. Python 3 pays for `s[0]` with a fixed-width internal representation and a copy on encode; Rust declines and makes you say which one you meant.

```rust
s.len()                  // 6 — bytes, and it is O(1)
s.chars().count()        // 5 — a full scan, O(n)
s.bytes().nth(1)         // Some(0xc3)
s.chars().nth(1)         // Some('é')
s.char_indices()         // (0,'h') (1,'é') (3,'l') (4,'l') (5,'o')
```

`char_indices` is the one to reach for when you need a byte offset you can slice at — it yields exactly the offsets that are valid.

### The panic Rust chose to keep

Ranges *are* allowed, and they are byte offsets:

```rust
&s[0..1]     // "h"
&s[0..2]     // panic: byte index 2 is not a char boundary
```

That second line compiles and then panics at runtime, because byte 2 is not a **char boundary** — one of very few places Rust picks a panic over a compile error. The reason is that the index is a value, not a type: `&s[0..n]` for a runtime `n` cannot be checked statically without dependent types. The alternative was to return garbage or an invalid `&str`, and an invalid `&str` is undefined behaviour, because every other function in the standard library trusts that it is valid UTF-8. Given a choice between corrupting the invariant and stopping the program, Rust stops the program.

:::gotcha
`s.len()` is bytes. Everywhere. Truncating user input to "100 characters" with `&s[..100]` works on every ASCII test you write and panics the first time somebody types an emoji.

```rust
let end = (0..=100).rev().find(|&i| s.is_char_boundary(i)).unwrap();
&s[..end]
```
:::

## Indexing, `get`, and bounds

Every slice index is bounds-checked. You choose what happens when it fails.

```rust
let v = vec![1, 2, 3];

v[7]                  // panics: index out of bounds: the len is 3
v.get(7)              // None
v.get(1)              // Some(&2)
v.first(); v.last()   // Option<&i32>
&v[1..9]              // panics: range end index 9 out of range
v.get(1..9)           // None
```

:::gotcha
The check is not free, but it is close to it: a compare and a predictable branch, and the optimiser removes it entirely when the bound is provable — `for x in &v`, or an index derived from `0..v.len()`. Reaching for `get_unchecked` before you have profiled trades a guaranteed panic for possible undefined behaviour.
:::

## Carving a slice up

```rust
let v = [1, 2, 3, 4, 5, 6];

let (head, tail) = v.split_at(2);   // [1,2] and [3,4,5,6]

for c in v.chunks(2) { }            // [1,2] [3,4] [5,6]  — disjoint
for w in v.windows(2) { }           // [1,2] [2,3] [3,4] [4,5] [5,6]  — overlapping
```

`chunks` partitions; `windows` slides. A final short chunk is yielded as-is by `chunks` (use `chunks_exact` to drop it), while `windows(n)` yields nothing at all when the slice is shorter than `n`. Both allocate nothing: each item is a fat pointer into the same buffer.

## Mutable slices

`&mut [T]` is the same two words with unique access, which is enough to reorder elements in place.

```rust
let mut v = vec![3, 1, 2];
let s: &mut [i32] = &mut v;

s.sort();            // in place, no allocation
s.swap(0, 2);
s.reverse();
s.fill(0);
```

Sorting lives on the slice, not on `Vec` — `v.sort()` works by deref coercion, which is also why sorting a sub-range is just `v[2..5].sort()`.

:::gotcha
Two mutable slices of one vector look impossible:

```rust,bad
let left  = &mut v[..3];
let right = &mut v[3..];   // error[E0499]: cannot borrow `v` as mutable twice
```

The borrow checker sees two `index_mut` calls on the whole vector and cannot tell the ranges are disjoint. `split_at_mut` is the escape hatch — it is `unsafe` inside and safe outside, because splitting at one point *provably* yields two non-overlapping halves:

```rust,good
let (left, right) = v.split_at_mut(3);
```
:::

:::note
**The habit.** Write `&str` and `&[T]` in every signature that only reads. Write `String` and `Vec<T>` when you must own or grow. A function that takes `&str` costs no more and accepts literals, owned strings, and sub-ranges of both.
:::
