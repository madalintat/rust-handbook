---
num: 11
slug: 11-collections
title: Collections
accent: moss
concepts: Vec, capacity, amortised growth, reallocation, String, HashMap, entry, BTreeMap, HashSet, VecDeque, ring buffer, hashing
needs: 05-ownership, 06-borrowing, 10-option
blurb: Vec, String, HashMap, VecDeque and BTreeMap. What each one costs, when it reallocates, and why the entry API is the best thing in the standard library.
---

%% A collection is a decision about cost. Every one of them makes some operation fast by making another one slow, and the whole skill is knowing which trade you just signed. Rust makes that trade legible: the types are thin, and every allocation happens where you asked for it.

Start with `Vec`. Move only when you can name the operation that is too slow.

## Vec: three words and a buffer

### The layout is the whole story

A `Vec<T>` is exactly three machine words on the stack: pointer, length, capacity.

:::memory let mut v: Vec<i32> = vec![1, 2, 3]
       STACK                                HEAP  (capacity 4)
     ┌───────────────────────────┐        ┌───┬───┬───┬───┐
 v   │ ptr      ●────────────────┼───────▶│ 1 │ 2 │ 3 │ ? │
     │ len      3                │        └───┴───┴───┴───┘
     │ capacity 4                │          used ───▶│  spare
     └───────────────────────────┘
     24 bytes, for 3 elements or 3 million
:::

**`len` is what you can see. `capacity` is what you have paid for.** The gap
between them is spare room bought in advance, and it is the reason `push` is
usually free.

```rust
let mut v = Vec::new();
println!("{} {}", v.len(), v.capacity());   // 0 0, no allocation yet
v.push(1);
println!("{} {}", v.len(), v.capacity());   // 1 4
```

An empty `Vec` does not allocate, because it does not yet know it will ever be
used. The first `push` calls the allocator.

### Doubling, and why push is O(1)

When `len == capacity`, `push` cannot write anywhere. So it asks for a **new** buffer of double the size, copies every element across, frees the old one, and then writes. That single **reallocation** costs O(n).

Copying n elements sounds fatal. It is not, because of how rarely it happens.

| pushes | reallocations | elements copied |
|---|---|---|
| 8 | 4 | 1+2+4 = 7 |
| 1,024 | 9 | 1,023 |
| 1,000,000 | 19 | ~1,000,000 |

Growing to n costs about n copies **in total**, spread over n pushes. One copy
per push, on average. That is what **amortised** means: not "each push is
cheap", but "any run of pushes averages out cheap, and the expensive ones are
paid for by the many that were not".

:::note
`push` is O(1) **amortised**. Individual pushes are occasionally O(n).

If you cannot tolerate one push in a thousand taking a millisecond, as in an
audio callback or a control loop, that average is not good enough for you. The
fix is `with_capacity`.
:::

### with_capacity

If you know the size, buy it once.

```rust
let lines: Vec<&str> = source.lines().collect();

let mut out = Vec::with_capacity(lines.len());   // one allocation, ever
for l in &lines {
    out.push(l.trim());
}
```

One `malloc` instead of log₂(n) of them, and not one element gets copied. This
is the cheapest performance win in Rust, and most code leaves it on the table. `collect()`
already does it when the iterator knows its length.

### Reallocation invalidates references

This is the part that connects `Vec` to the borrow checker.

```rust,bad
let mut v = vec![1, 2, 3];
let first = &v[0];      // borrows v
v.push(4);              // needs &mut v, and may move the buffer
println!("{first}");    // error[E0502]
```

If `push` reallocates, the old buffer is freed and `first` points into it. In
C++ that is a rule you are expected to remember (`std::vector` iterator
invalidation), and a segfault when you forget. Here it is `error[E0502]`, at
compile time.

:::gotcha
The borrow checker is not being clever about reallocation. It does not know
whether `push` will reallocate. It forbids the pattern outright, because `push`
takes `&mut self` while a shared borrow is live.

That is stricter than strictly necessary, and it is why it is *checkable*. A
rule that needed to predict allocator behaviour would not be.
:::

## Removing from a Vec

### remove is O(n), swap_remove is O(1)

```rust
let mut v = vec!["a", "b", "c", "d"];

v.remove(1);        // ["a", "c", "d"]  (shifts everything after it left)
v.swap_remove(0);   // ["d", "c"]       (last element fills the hole)
```

`remove` preserves order and moves every later element down one slot.
`swap_remove` moves exactly one element and destroys order.

If order does not matter, as with a set of active connections or a pool of
workers, `swap_remove` turns an O(n) operation into two pointer writes. Removing 10,000
items from a 100,000-element vector: 500 million moves versus 10,000.

### retain, and the loop that eats itself

Removing while iterating by index is the classic off-by-one:

```rust,bad
for i in 0..v.len() {
    if v[i].is_empty() { v.remove(i); }   // skips the next one, then panics
}
```

After `v.remove(i)` every later element has shifted down, so index `i` now
holds what used to be at `i + 1` and the loop skips it. `v.len()` shrank too,
and the range was computed once, so the tail of the loop indexes off the end
and panics.

`retain` does the whole job in one pass, in place, in O(n):

```rust,good
v.retain(|s| !s.is_empty());
```

## String is a Vec<u8> that promises UTF-8

### The invariant, and why indexing is gone

`String` has the identical three-word layout as `Vec<u8>`, because that is what
it is. The only difference is an invariant: the bytes are always valid UTF-8,
enforced at every entry point.

```rust,bad
let s = String::from("héllo");
let c = s[1];        // error[E0277]: `String` cannot be indexed by `usize`
```

`s` is 6 bytes for 5 characters, because `é` takes two of them, so byte 1 is
half a character. There is nothing useful for `s[1]` to return, so the operation
does not exist at all.

### Bytes, characters, views

```rust
let s = String::from("héllo");
s.len();                  // 6  (bytes, always)
s.chars().count();        // 5  (a scan, O(n))
&s[0..1];                 // "h" (byte range, panics if it splits a character)
```

| you want | use |
|---|---|
| bytes | `s.as_bytes()`, a `&[u8]`, O(1) |
| characters | `s.chars()`, an iterator, O(n) to reach the nth |
| a borrowed view | `&s` or `&s[a..b]`, a `&str`, no allocation |
| to append | `push_str`, `push`, amortised like `Vec` |

`String` grows by doubling for exactly the same reason `Vec` does, so
`String::with_capacity` is the same win. Building a 1 MB string with `push_str`
from empty does about twenty reallocations and copies 2 MB in total.

## HashMap

### What it is doing

`HashMap<K, V>` hashes the key to a number, uses that number to pick a bucket,
and looks only in that bucket. Lookup does not depend on how many entries
exist, and that is what the O(1) means.

The hash function matters more than it looks. Rust's default is **SipHash**, seeded randomly at program start, and it is deliberately *not* the fastest
available.

:::note
The default hasher is chosen to be **DoS-resistant**, not fast.

If an attacker can pick your keys (HTTP headers, JSON fields, usernames) and
your hash is predictable, they can send a thousand keys that all land in one
bucket. Your O(1) map becomes an O(n) list and one request pins a core. This is
a real, repeatedly-exploited class of attack.
:::

For keys you control, a faster hasher (`FxHashMap`, `ahash`) is a legitimate and
easy swap. For anything a stranger can influence, keep the default.

### get, and why indexing is a trap

```rust
let mut scores = HashMap::new();
scores.insert("ferris", 10);

scores.get("ferris");      // Some(&10)
scores.get("nobody");      // None
scores["nobody"];          // panics
```

`get` returns `Option<&V>` because absence is normal, not an error. Indexing
exists but panics on a missing key, which makes it wrong for almost every real
map.

:::compare
**Python**: `d["missing"]` raising `KeyError` is the same design; the
difference is that Rust makes `.get()` the ergonomic path rather than the
verbose one.

**C++**: `map[k]` *inserts* a default-constructed value when the key is
missing, so reading a map can silently grow it. Rust's indexing panics instead,
and inserting-on-miss is a separate, named operation: `entry`.
:::

### entry, the best thing in the type

The shape you write constantly is "look it up; if it is not there, put something
there; then update it". Done naively that is two lookups and a borrow problem:

```rust,bad
let mut counts: HashMap<&str, i32> = HashMap::new();
for word in text.split_whitespace() {
    if counts.contains_key(word) {           // hash #1
        *counts.get_mut(word).unwrap() += 1; // hash #2
    } else {
        counts.insert(word, 1);              // hash #3
    }
}
```

The **entry API** does it in one hash. It hands you the *slot*, occupied or vacant, and
lets you decide what goes in it.

```rust,good
for word in text.split_whitespace() {
    *counts.entry(word).or_insert(0) += 1;
}
```

`entry` returns an `Entry` enum. `or_insert(0)` says "if vacant, put a 0 there",
and either way returns `&mut V` pointing into the map. The `*` dereferences it
and adds one. The whole thing costs one hash and one lookup, and there is
nothing left to unwrap.

| method | when to use it |
|---|---|
| `or_insert(v)` | the default is cheap to build |
| `or_insert_with(make)` | the default allocates, and `make` runs only on a miss |
| `or_default()` | `V: Default`, so 0, empty `Vec`, empty `String` |
| `and_modify(...).or_insert(v)` | different work for present and absent |

The grouping idiom, which you will write a hundred times:

```rust
let mut by_dept: HashMap<&str, Vec<&str>> = HashMap::new();
for (name, dept) in staff {
    by_dept.entry(dept).or_default().push(name);
}
```

`or_default()` builds an empty `Vec` only on the first sighting of a
department, and returns `&mut Vec<&str>` either way.

:::gotcha
`or_insert_with` versus `or_insert` is not style. `or_insert(String::new())`
constructs the `String` on every iteration and throws it away on a hit;
`or_insert_with(String::new)` constructs it only when the key is missing.

With an allocation in the default, in a loop over a million rows, that is a
million wasted allocations.
:::

## The other four

### BTreeMap: ordered, at a price

`BTreeMap` keeps keys sorted. Lookup is O(log n), genuinely slower than a hash
map: several cache-friendly comparisons instead of one hash. In exchange you get
things a `HashMap` structurally cannot give you:

```rust
let mut events = BTreeMap::new();
events.insert(1_700_000_000u64, "deploy");
events.insert(1_700_003_600, "alert");

events.iter();                          // in key order, always
events.range(1_700_000_000..=1_700_001_000);  // every key in a window
events.first_key_value();               // the smallest
```

Iterating a `HashMap` gives you an arbitrary order that changes between runs,
because the seed is random. If you need sorted output, a stable snapshot, or a
range query, `BTreeMap` is not a compromise. It is the only one of the two that
does the job.

### HashSet and BTreeSet

A set is the same structure with `V = ()`: `HashSet` for membership, `BTreeSet`
for membership plus order.

```rust
let seen: HashSet<u32> = vec![1, 2, 2, 3].into_iter().collect();
seen.contains(&2);              // true, O(1)
```

`insert` returns a `bool`, `true` when the value was new. That return value is a
complete deduplication check on its own, and it saves you the second lookup.

### VecDeque: a ring buffer

`Vec::remove(0)` shifts every remaining element. A queue built on `Vec` is
therefore O(n) per pop, which is a real and common performance bug.

`VecDeque` is a **ring buffer**: one allocation with two indices that wrap around.

:::memory VecDeque after pushing 4 and popping the front twice
       ┌───┬───┬───┬───┬───┬───┐
       │ ? │ ? │ c │ d │ ? │ ? │      capacity 6, len 2
       └───┴───┴───┴───┴───┴───┘
               ▲       ▲
             head    tail

  push_back writes at tail and steps right, wrapping to index 0
  pop_front reads at head and steps right. Nothing ever shifts.
:::

Both ends are O(1). The cost is that the elements are not one contiguous run, so
you cannot take a `&[T]` view of the whole thing. `make_contiguous` will build
one for you by moving elements.

## Choosing

### The cost table

| | `Vec` | `VecDeque` | `HashMap` | `BTreeMap` |
|---|---|---|---|---|
| push/pop back | O(1) amortised | O(1) amortised | n/a | n/a |
| push/pop front | O(n) | O(1) amortised | n/a | n/a |
| index by position | O(1) | O(1) | n/a | n/a |
| find by value/key | O(n) | O(n) | O(1) | O(log n) |
| insert in middle | O(n) | O(n) | O(1) | O(log n) |
| remove by key | O(n) | O(n) | O(1) | O(log n) |
| ordered iteration | sorted first | sorted first | no | free |
| memory per element | lowest | low | +bucket overhead | node overhead |

### Start with Vec

A linear scan of a `Vec` beats a `HashMap` lookup up to around 30 elements, and
often further. The vector's elements are contiguous, so the prefetcher gets them
free; the hash map costs a hash and a cache miss at any size. Big-O describes the
slope, not the intercept.

:::note
**Start with `Vec`. Move only when you can name the operation that is too
slow.**

"This is a lookup-heavy workload" is not naming it. "We scan 40,000 sessions on
every request to find one by id" is.
:::

The honest decision procedure:

- Do you need it in order? `Vec`.
- Do you look things up by a key that is not a position? `HashMap`.
- ...and need it sorted, or need range queries? `BTreeMap`.
- Do you add and remove at both ends? `VecDeque`.
- Do you only care whether a thing is present? `HashSet`.
- Anything else (`LinkedList`, a hand-rolled tree) needs a measurement behind
  it, not an intuition.
