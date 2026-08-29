---
unit: 11-collections
---

## 1

What does this print?

```rust
let v: Vec<i32> = Vec::new();
println!("{} {}", v.len(), v.capacity());
```

- *A. `0 0`
- B. `0 4`
- C. `0 8`
- D. It does not compile, since the type is ambiguous

@why
An empty `Vec` does not allocate. It has no pointer to a buffer because it has
no buffer; the pointer field holds a dangling but well-aligned address that is
never read. The first `push` is what calls the allocator.

B is the tempting one, because a `Vec` that has been pushed to once does report
capacity 4. But paying for a buffer at construction would mean every `Vec::new()`
in a struct field, in a loop, in a rarely-taken branch, cost an allocation.
Deferring it is free.

## 2

A `Vec<u64>` has been pushed to 1,000 times, starting empty. Roughly how many
times has it reallocated?

- A. 1,000
- B. 500
- *C. About 10
- D. 0, it grows in place

@why
Capacity doubles: 4, 8, 16, … 1024. That is around ten reallocations to reach a
thousand elements, and the total number of elements copied across all of them is
about 1,000, or roughly one copy per push.

That is what **amortised** O(1) means. It does not mean every push is cheap; it
means the expensive ones are rare enough that the average is constant. If you
cannot tolerate the occasional expensive one, `with_capacity` removes them
entirely.

D confuses `Vec` with a data structure that owns its address space. The
allocator makes no promise that the block after yours is free.

## 3

Does this compile?

```rust
let mut v = vec![1, 2, 3];
let first = &v[0];
v.push(4);
println!("{first}");
```

- A. Yes, `push` appends at the end, so the first element does not move
- *B. No, `push` needs `&mut v` while `first` is still borrowed
- C. No, you cannot take a reference to a vector element at all
- D. Yes, but `first` may print garbage

@why
`error[E0502]`. `push` takes `&mut self`, and a shared borrow of `v` is still
live at the `println!`.

A is the C++ intuition and it is exactly the bug. If `push` finds
`len == capacity` it allocates a new buffer, copies the elements over and frees
the old one, so the first element moves and `first` points into freed memory.

D describes what would happen in C++ if you got unlucky. Rust refuses to
compile the shape at all rather than reasoning about whether this particular
`push` reallocates, which is the only version of the rule that is decidable.

## 4

`v` is a `Vec<String>` with 100,000 elements and order does not matter. Which
removes element 0 in constant time?

- A. `v.remove(0)`
- *B. `v.swap_remove(0)`
- C. `v.drain(0..1)`
- D. `v.pop()`, which removes element 0

@why
`swap_remove(0)` moves the last element into slot 0 and returns what was there.
That is two pointer-sized writes, O(1), and the order is destroyed.

`remove(0)` returns the same value and shifts all 99,999 remaining elements down
one slot, which is O(n). In a loop that pops from the front it is quadratic, and it is
one of the most common accidental performance bugs in Rust.

D is wrong on which end: `pop` removes the *last* element and returns
`Option<T>`.

## 5

What is `"héllo".len()`?

- A. 5
- *B. 6
- C. 10
- D. It does not compile, since `len` is not defined on a literal

@why
`len` on a `str` is **bytes**, always, and `é` is two bytes in UTF-8. Five
characters, six bytes.

A is what you want it to be, and the way to get it is `.chars().count()`, which
is O(n), because there is no way to know where character *n* begins without
decoding everything before it. That cost is the reason `len` is not defined as
the character count: a method called `len` that walks the whole string would be
a trap.

## 6

Which of these compile? Choose all that apply.

```rust
let s = String::from("hello");
```

- A. `let c = s[0];`
- *B. `let sub = &s[0..2];`
- *C. `let b = s.as_bytes()[0];`
- *D. `let c = s.chars().nth(1);`
- E. `let c: char = s.get(0);`

@why
A does not compile: `String` has no `Index<usize>` impl, because byte 0 may be
part of a character rather than all of one.

B does: `Index<Range<usize>>` exists and gives a `&str`. It compiles and it
*panics at runtime* if either endpoint falls inside a character. Byte ranges are
the O(1) option and the one that can blow up.

C works and gives `u8`. D works and gives `Option<char>`, after decoding two
characters. E fails: `str::get` returns `Option<&str>` and takes a range, not a
`usize`.

## 7

Why is Rust's default `HashMap` hasher not the fastest one available?

- A. Faster hashers are not stable across platforms
- *B. It is chosen to resist attackers who can pick your keys
- C. SipHash produces fewer collisions on real data
- D. It is a historical accident nobody has fixed

@why
SipHash is keyed with a random seed drawn at program start. Without that, an
attacker who can choose your keys (header names, JSON fields, usernames) can
precompute a thousand keys that all hash into the same bucket, turning your O(1)
map into an O(n) linked list and pinning a core with one request. This attack
has been used repeatedly against real web frameworks.

C is the plausible wrong answer: SipHash is a good hash, but a faster
non-cryptographic hash like FxHash has perfectly acceptable collision behaviour
on ordinary data. Speed is what you give up for the seed, and for keys you
generate yourself, swapping the hasher is a legitimate move.

## 8

What is wrong with this?

```rust
let mut counts: HashMap<&str, Vec<u32>> = HashMap::new();
counts.entry(name).or_insert(Vec::new()).push(1);
```

- A. Nothing, this is the idiomatic form
- *B. `Vec::new()` is constructed on every call and discarded when the key exists
- C. `or_insert` returns the value, not a reference, so `push` cannot work
- D. It will not compile, since `Vec` is not `Default`

@why
It compiles and it is correct. It is also wasteful: the argument to `or_insert`
is evaluated *before* the call, every time, whether or not the key is missing.
An empty `Vec::new()` happens not to allocate, so this particular case is cheap.
But `or_insert(String::from("none"))` or `or_insert(expensive())` in a loop over
a million rows is a million wasted calls.

`or_insert_with(Vec::new)` takes a closure and runs it only on a miss.
`or_default()` is shorter still and does the same thing.

C is wrong in a useful way: `or_insert` returns `&mut V` precisely so you can
modify the value in place, which is why `push` works and why `*x += 1` needs
the star.

## 9

`m` is a `HashMap<String, u32>`. What is the type of `m.get("key")`?

- A. `u32`
- B. `Option<u32>`
- *C. `Option<&u32>`
- D. `&u32`

@why
`Option` because the key may be absent, and absence is a normal answer rather
than an error. A reference because the value belongs to the map: returning it
by value would be a copy the map cannot know you wanted, and would be impossible
for a non-`Copy` `V`.

B is the answer people expect, and the way to get it for a `Copy` type is
`.copied()` or `.cloned()`. Note also that `get` accepts `&str` even though `K`
is `String`: the `Borrow` trait means you do not have to allocate a `String`
just to look one up.

## 10

Which of these can `BTreeMap` do that `HashMap` cannot? Choose all that apply.

- *A. Iterate keys in sorted order
- *B. Return every entry whose key is in a range
- *C. Return the smallest key
- D. Look up a key in O(1)
- E. Store keys that do not implement `Ord`

@why
A, B and C all follow from the same property: a `BTreeMap` stores keys sorted in
a search tree, so position is related to value.

D is the one going the other way. That is `HashMap`'s trade, and `BTreeMap`
costs O(log n) per lookup instead.

E is backwards. `BTreeMap` *requires* `K: Ord`; it is `HashMap` that only needs
`Eq + Hash`, which is why `f64` can be neither (`NaN != NaN` rules out `Eq`, and
therefore `Ord` too).

## 11

A test asserts on the order of `for (k, v) in &my_hashmap`. What happens?

- A. It passes, because insertion order is preserved
- B. It passes, because keys come out sorted
- *C. It may pass locally and fail on another run, because the order changes every run
- D. It does not compile, since `HashMap` is not iterable

@why
`HashMap` iteration order is unspecified, and in Rust it is genuinely different
on **each execution of the program**, because the SipHash seed is drawn at
startup.

That is deliberate rather than sloppy: a stable order would leak information
about the hash function and reopen the collision-flooding attack the random seed
exists to prevent.

A is the Python 3.7+ intuition, where `dict` does preserve insertion order.
Rust's `HashMap` does not, and if you need that you want `BTreeMap`, or a `Vec`
you sort at the end.

## 12

Which collection gives O(1) insertion and removal at **both** ends?

- A. `Vec`
- *B. `VecDeque`
- C. `BTreeMap`
- D. `LinkedList`

@why
`VecDeque` is a ring buffer: one allocation with a head index and a tail index
that wrap around to the start. Pushing at either end writes one element and
steps one index. Nothing ever shifts.

`Vec` is O(1) at the back and O(n) at the front, because `remove(0)` shifts
everything down.

D is technically also O(1) at both ends and is almost always the wrong answer.
`LinkedList` allocates a node per element and scatters them across memory, so
every traversal is a chain of cache misses. `VecDeque` beats it in practice at
essentially every size.

## 13

What does `set.insert(x)` return for a `HashSet<u32>`?

- A. `()`
- *B. `bool`, `true` if the value was not already present
- C. `Option<u32>`, the value it replaced
- D. `&mut u32`

@why
`true` means the value was new. That single return value is a complete
deduplication check with no second lookup: `if !seen.insert(id) { continue; }`
skips anything already processed, in one hash.

C is `HashMap::insert`'s signature, which returns `Option<V>`, the old value if
the key was present. Mixing the two up is common. The difference makes
sense: a map replaces the value and might have something to hand back; a set has
nothing to hand back, only a yes or no.

## 14

You have 20 configuration keys and look one up occasionally. Which is the
better choice?

- *A. `Vec<(&str, &str)>` scanned linearly
- B. `HashMap<&str, &str>`
- C. `BTreeMap<&str, &str>`
- D. It makes no measurable difference which one, so pick the fastest to type

@why
At twenty elements a linear scan of a contiguous `Vec` usually wins. The pairs
sit in a handful of cache lines and the prefetcher gets them for free; the hash
map pays for hashing the key and then a cache miss on the bucket, at any size.
Big-O describes the slope, not the intercept, and the crossover is somewhere
around 30 elements.

D is tempting and is the wrong lesson even though the practical difference here
is tiny. The point is not that it does not matter. It is that the default
should be `Vec`, and moving off it should follow from naming the operation that
is too slow.

## 15

Which of these is the honest reason to move from `Vec` to `HashMap`?

- A. The collection has more than a hundred elements
- *B. You look things up by a key that is not a position, and the scan shows up in a profile
- C. `HashMap` is the more professional data structure
- D. You want the elements deduplicated

@why
B names an operation and has evidence. That is the bar: "we scan 40,000 sessions
on every request to find one by id" is a reason; "this is lookup-heavy" is a
feeling.

A is close but incomplete: size alone says nothing if you only ever iterate.
Iterating a `Vec` is faster than iterating a `HashMap` at any size.

D describes a `HashSet`, not a `HashMap`, and if the collection is small,
`sort` plus `dedup` on a `Vec` will beat both.
