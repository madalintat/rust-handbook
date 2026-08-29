---
unit: 11-collections
---

## 1. Room for five

@kind fix
@concept capacity
@expect E0596

`with_capacity` buys the buffer up front, which is exactly right here — the size
is known before the loop starts. But the vector as written cannot accept a
single element.

One word is missing. Find it, and notice that the missing word is not on the
line the error points at.

```starter
pub fn run() -> Vec<i32> {
    let squares = Vec::with_capacity(5);
    for n in 1..=5 {
        squares.push(n * n);
    }
    squares
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn squares_one_to_five() {
        assert_eq!(run(), vec![1, 4, 9, 16, 25]);
    }
}
```

```solution
pub fn run() -> Vec<i32> {
    let mut squares = Vec::with_capacity(5);
    for n in 1..=5 {
        squares.push(n * n);
    }
    squares
}
```

@hint `push` has to change the vector. What does a method that changes its receiver take as `self`?
@hint `push(&mut self, ...)` needs a mutable borrow, and you can only take one of those from a binding declared `mut`.

@diagnose E0596
`cannot borrow squares as mutable, as it is not declared as mutable`.

Read the two spans. The error is reported at `squares.push(...)`, because that is
where a `&mut` was needed — `push` is declared `fn push(&mut self, value: T)`.
But the *fix* is at the `let`, and rustc says so with a second span:
`help: consider changing this to be mutable: mut squares`.

Mutability in Rust is a property of the **binding**, not of the value or the
type. `Vec::with_capacity(5)` produces the same vector either way; `let` versus
`let mut` decides whether anyone is allowed to hand out a unique borrow of it.

@after
`with_capacity` is the cheapest performance win in the language and most code
skips it. Starting from `Vec::new()`, filling five elements costs one allocation
and then reallocations at 4 — with the copying that implies. Starting from
`with_capacity(5)` costs exactly one allocation and no copying at all.

The rule: if you know how many elements are coming, say so. If you are
collecting from an iterator, `collect()` already asks the iterator for its size
hint and does this for you.

## 2. The letter that is not there

@kind fix
@concept String
@expect E0277

Getting the first character of a string looks like it should be indexing. It is
not, and the reason is the invariant `str` carries.

Return the first character of each name.

```starter
pub fn initial(name: &str) -> char {
    name[0]
}

pub fn run() -> String {
    format!("{}{}", initial("ferris"), initial("ada"))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn takes_two_initials() {
        assert_eq!(run(), "fa");
        assert_eq!(initial("hello"), 'h');
    }
}
```

```solution
pub fn initial(name: &str) -> char {
    name.chars().next().unwrap()
}

pub fn run() -> String {
    format!("{}{}", initial("ferris"), initial("ada"))
}
```

@hint A `str` is bytes with a promise. Byte 0 is not necessarily a whole character, so there is no `Index<usize>` impl at all.
@hint You want the iterator that decodes UTF-8 for you, and then its first item.
@hint `name.chars().next()` gives `Option<char>`. The tests never pass an empty string, so `.unwrap()` is honest here.

@diagnose E0277
`the type str cannot be indexed by {integer}`, and underneath,
`help: the trait Index<{integer}> is not implemented for str`.

This is not a bounds error. The operation genuinely does not exist. `str` is a
run of UTF-8 bytes, and a character can be one to four of them, so byte 0 might
be the whole of `h` or the first third of `€`. There is no answer `name[0]`
could return that is right in both cases, so the standard library declines to
guess.

What `str` *does* implement is `Index<Range<usize>>`, so `&name[0..1]` compiles
— and panics at runtime if that byte boundary splits a character. That is the
trade: byte ranges are O(1) and can panic, `chars()` is O(n) and cannot.

@diagnose E0308
Your expression has the wrong type for a `char`. `name.chars().next()` is an
`Option<char>`, not a `char` — you still have to get the value out of it, with
`unwrap`, `expect`, or a `match`. And `&name[0..1]` is a `&str` of length one,
which is also not a `char`; those are different types in Rust and neither
coerces to the other.

@after
`len()` on a string is bytes, always. `"héllo".len()` is 6 and
`"héllo".chars().count()` is 5, and the second one is a linear scan because
there is no way to know where character *n* starts without decoding everything
before it.

That is the cost UTF-8 imposes and Rust refuses to hide it. Languages that let
you write `s[3]` in constant time are either storing four bytes per character or
quietly giving you a code unit rather than a character — which is where the
emoji bugs come from.

## 3. Counting words

@kind fix
@concept entry
@expect E0368

The `entry` API is the right tool and it is already in the code. What is missing
is one character, and understanding why it is needed is the whole exercise:
think about what `or_insert` hands back.

```starter
use std::collections::HashMap;

pub fn count(text: &str) -> HashMap<&str, u32> {
    let mut counts = HashMap::new();
    for word in text.split_whitespace() {
        counts.entry(word).or_insert(0) += 1;
    }
    counts
}

pub fn run() -> (u32, u32) {
    let counts = count("the cat sat on the mat the end");
    (counts["the"], counts["cat"])
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_repeats() {
        assert_eq!(run(), (3, 1));
    }
    #[test]
    fn absent_words_are_absent() {
        let c = count("a b");
        assert_eq!(c.get("z"), None);
        assert_eq!(c.len(), 2);
    }
}
```

```solution
use std::collections::HashMap;

pub fn count(text: &str) -> HashMap<&str, u32> {
    let mut counts = HashMap::new();
    for word in text.split_whitespace() {
        *counts.entry(word).or_insert(0) += 1;
    }
    counts
}

pub fn run() -> (u32, u32) {
    let counts = count("the cat sat on the mat the end");
    (counts["the"], counts["cat"])
}
```

@hint `or_insert` does not return the number. Look up its return type.
@hint It returns `&mut V` — a mutable reference pointing into the map's own storage. You cannot add one to a reference.
@hint Dereference it: `*counts.entry(word).or_insert(0) += 1;`

@diagnose E0368
`binary assignment operation += cannot be applied to type &mut u32`.

`or_insert(0)` returns `&mut u32`, not `u32`. That is deliberate and it is the
whole reason `entry` is fast: instead of telling you what the value is, it hands
you a pointer straight into the map's storage, so you can change it in place
without a second lookup.

To add one to the thing the reference points at, you have to go through the
reference: `*slot += 1`. Without the `*` you are asking to add an integer to a
pointer, which Rust does not define.

@diagnose E0369
Same root cause, different operator. `counts.entry(w).or_insert(0) + 1` compares
or adds to the reference itself rather than to the value behind it. Put a `*` in
front of the whole expression.

@after
Count what the fixed line does: one hash of `word`, one bucket probe, and then
either an insert of `0` or nothing. That is it.

Compare the version people write first: `contains_key` (hash #1), then
`get_mut(...).unwrap()` (hash #2), or `insert` (hash #3) — three passes over the
same key, plus an `unwrap` that can never fail but which you now have to justify
to a reviewer.

And learn `or_insert_with` alongside it. `or_insert(Vec::new())` builds a vector
on *every* iteration and throws it away on a hit; `or_insert_with(Vec::new)`
builds one only when the key is missing. In a loop over a million rows that is a
million allocations you did not need.

## 4. get gives you a maybe

@kind fix
@concept HashMap

@expect E0308

The lookup must not panic on a missing name — a missing name scores zero. The
signature is right; the body has not accepted what `get` actually returns.

```starter
use std::collections::HashMap;

pub fn lookup(scores: &HashMap<&str, u32>, name: &str) -> u32 {
    let score: u32 = scores.get(name);
    score
}

pub fn run() -> (u32, u32) {
    let mut scores = HashMap::new();
    scores.insert("ferris", 10);
    scores.insert("ada", 7);
    (lookup(&scores, "ada"), lookup(&scores, "nobody"))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn present_and_absent() {
        assert_eq!(run(), (7, 0));
    }
}
```

```solution
use std::collections::HashMap;

pub fn lookup(scores: &HashMap<&str, u32>, name: &str) -> u32 {
    scores.get(name).copied().unwrap_or(0)
}

pub fn run() -> (u32, u32) {
    let mut scores = HashMap::new();
    scores.insert("ferris", 10);
    scores.insert("ada", 7);
    (lookup(&scores, "ada"), lookup(&scores, "nobody"))
}
```

@hint `get` returns `Option<&u32>`. There are two things wrong with that as a `u32`: the `Option` and the `&`.
@hint `unwrap_or(0)` handles the `Option`. `copied()` turns an `Option<&u32>` into an `Option<u32>` by copying the four bytes out.
@hint `scores.get(name).copied().unwrap_or(0)` — or equivalently `*scores.get(name).unwrap_or(&0)`.

@diagnose E0308
`mismatched types: expected u32, found Option<&u32>`.

Two mismatches stacked in one message, and it is worth separating them.

The `Option` is there because absence is not an error, it is a normal answer.
`get` cannot return a `u32` for a key that is not in the map, and it will not
invent a zero for you — that would be `HashMap` guessing what your program
means.

The `&` is there because the value belongs to the map. Handing you a `u32` by
value would be a copy the map cannot know you wanted; handing you a reference
costs nothing. For a `Copy` type, `.copied()` takes the copy explicitly.

@after
Indexing exists — `scores["ada"]` — and it panics on a missing key. It is right
for exactly one situation: you have already proven the key is present, and a
missing key means your program is broken. Everywhere else, use `get`.

Worth knowing the whole family, because each one answers a different question:
`get` → `Option<&V>`, `get_mut` → `Option<&mut V>`, `contains_key` → `bool`,
`remove` → `Option<V>` (the owned value, handed back to you), and `entry` when
you intend to write.

## 5. The reference that moved house

@kind fix
@concept reallocation
@expect E0502

Nothing here is unsafe, and in C++ the equivalent code compiles and usually
works — until the day the vector is one element longer and it does not.

Keep both the first reading and the final length.

```starter
pub fn run() -> (i32, usize) {
    let mut readings = vec![12, 7, 30];
    let first = &readings[0];
    readings.push(41);
    (*first, readings.len())
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keeps_the_first_reading() {
        assert_eq!(run(), (12, 4));
    }
}
```

```solution
pub fn run() -> (i32, usize) {
    let mut readings = vec![12, 7, 30];
    let first = readings[0];
    readings.push(41);
    (first, readings.len())
}
```

@hint You do not actually want a reference to the first element. You want its value, and `i32` is `Copy`.
@hint `let first = readings[0];` copies four bytes out and ends the borrow immediately, so `push` is free to do whatever it likes afterwards.

@diagnose E0502
`cannot borrow readings as mutable because it is also borrowed as immutable`.

Three spans: the shared borrow at `&readings[0]`, the mutable borrow at
`readings.push(41)`, and the use at `*first` that keeps the first one alive
across the second.

The reason is `Vec`'s growth strategy. `push` may find `len == capacity`, ask
the allocator for a buffer twice the size, copy the elements across, and **free
the old buffer**. If that happens, `first` points into memory that has been
handed back — a use after free.

The compiler is not predicting whether this particular `push` reallocates; it
cannot know that. It rejects the shape, because `push` takes `&mut self` and a
shared borrow was still live. Coarser than strictly necessary, and that
coarseness is exactly what makes it decidable.

@after
This is the same bug C++ calls iterator invalidation. There it is a documented
rule you are expected to remember, and a segfault or silent corruption when you
do not. Here it is a compile error with three underlines.

The general habit: hold a reference into a collection for as short a time as
possible, and never across a call that could modify it. If you need a value out
of a collection and then want to change the collection, take the value out first
— by copying it if it is `Copy`, by cloning if you must, or by `remove`/`pop`
if you wanted it gone anyway.

## 6. Taking one out

@kind fix
@concept swap_remove
@expect E0507

`take_any` is supposed to pull one job out of the queue and hand it over — the
caller then owns it. Order does not matter here; any job will do.

Indexing does not work for this, and the error says why in one line.

```starter
pub fn take_any(v: &mut Vec<String>) -> String {
    v[0]
}

pub fn run() -> (String, usize) {
    let mut jobs = vec![
        String::from("resize"),
        String::from("encode"),
        String::from("upload"),
    ];
    let one = take_any(&mut jobs);
    (one, jobs.len())
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hands_over_one_job() {
        assert_eq!(run(), (String::from("resize"), 2));
    }
    #[test]
    fn shrinks_the_queue() {
        let mut v = vec![String::from("a"), String::from("b")];
        let got = take_any(&mut v);
        assert_eq!(got, "a");
        assert_eq!(v, vec![String::from("b")]);
    }
}
```

```solution
pub fn take_any(v: &mut Vec<String>) -> String {
    v.swap_remove(0)
}

pub fn run() -> (String, usize) {
    let mut jobs = vec![
        String::from("resize"),
        String::from("encode"),
        String::from("upload"),
    ];
    let one = take_any(&mut jobs);
    (one, jobs.len())
}
```

@hint Indexing gives you a place inside the vector. You cannot move a `String` out of it and leave a hole.
@hint You need a method that removes the element and returns it, so the vector is left with no hole to worry about.
@hint The brief says order does not matter, which is the licence to use `swap_remove` rather than `remove`.

@diagnose E0507
`cannot move out of index of Vec<String>`, with `move occurs because value has
type String, which does not implement the Copy trait`.

`v[0]` is a *place*, not a value — it names a slot the vector owns. Returning it
by value would move the `String` out of that slot, leaving the vector holding
three elements one of which is uninitialised memory. `Vec` has no way to
represent that, and its destructor would later try to drop it.

Exercise 5 worked because `i32` is `Copy`: moving out of a place is fine when
"moving out" is just reading four bytes and leaving the original intact. A
`String` owns a heap buffer, so there is no such reading.

@diagnose E0308
Your fix returns the wrong type. `v.remove(0)` and `v.swap_remove(0)` both return
`String`, but `v.get(0)` returns `Option<&String>` and `v.first()` returns
`Option<&String>` — neither is a `String`, and neither takes the element out of
the vector.

@after
`swap_remove(0)` moves the **last** element into slot 0 and returns what was
there. Two pointer-sized writes, O(1), and the order of the remaining elements
is destroyed.

`remove(0)` would also have compiled and would also have passed the first test —
and it shifts every later element down one slot, O(n). On a three-element vector
that is invisible. On a hundred-thousand-element work queue popped from the
front in a loop, it is quadratic, and it is one of the most common accidental
performance bugs in Rust.

If you genuinely need FIFO order, neither is the answer: use `VecDeque`, which
is O(1) at both ends.

## 7. Everything in the window

@kind fix
@concept BTreeMap
@expect E0599

The events are keyed by timestamp and the job is to pull out everything inside a
time window, in order. The map type in the code cannot do that, and no amount of
fixing the call will make it.

Change the container.

```starter
use std::collections::HashMap;

pub fn build() -> HashMap<u64, String> {
    let mut m = HashMap::new();
    m.insert(1_700_000_100, String::from("deploy"));
    m.insert(1_700_000_500, String::from("alert"));
    m.insert(1_700_009_000, String::from("rollback"));
    m
}

pub fn run() -> Vec<String> {
    let events = build();
    events
        .range(1_700_000_000..1_700_001_000)
        .map(|(_, name)| name.clone())
        .collect()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn window_in_key_order() {
        assert_eq!(
            run(),
            vec![String::from("deploy"), String::from("alert")]
        );
    }
}
```

```solution
use std::collections::BTreeMap;

pub fn build() -> BTreeMap<u64, String> {
    let mut m = BTreeMap::new();
    m.insert(1_700_000_100, String::from("deploy"));
    m.insert(1_700_000_500, String::from("alert"));
    m.insert(1_700_009_000, String::from("rollback"));
    m
}

pub fn run() -> Vec<String> {
    let events = build();
    events
        .range(1_700_000_000..1_700_001_000)
        .map(|(_, name)| name.clone())
        .collect()
}
```

@hint A hash map scatters keys across buckets by their hash. Ask yourself whether "every key between a and b" is even answerable in that layout.
@hint The other map in `std::collections` keeps its keys sorted, which is precisely what a range query needs.
@hint Swap `HashMap` for `BTreeMap` in the `use`, the return type and the constructor. The rest of the code is already correct.

@diagnose E0599
`no method named range found for struct HashMap in the current scope`.

This is not a missing import or a typo. The method does not exist on `HashMap`
and could not: a hash map deliberately destroys the relationship between a key
and its position. `hash(1_700_000_100)` and `hash(1_700_000_101)` land in
unrelated buckets, so there is nowhere to start scanning and nothing to scan
towards. Answering a range query would mean visiting every bucket — O(n), which
is what a `Vec` already gives you.

`BTreeMap` stores keys sorted in a search tree, so `range` walks to the lower
bound in O(log n) and then iterates. Ordered iteration is free; single lookups
cost O(log n) instead of O(1). That is the trade.

@diagnose E0308
Check that all three mentions agree. If `build` still says
`-> HashMap<u64, String>` while its body constructs a `BTreeMap`, the return
type and the tail expression disagree and rustc reports the mismatch at the last
line of the function.

@after
Iterating a `HashMap` yields entries in an order that is not just unspecified
but *different on every run of the program*, because the SipHash seed is drawn
at startup. That is deliberate — a stable order would leak information about the
hash and reopen the collision-flooding attack the random seed exists to prevent.

The practical consequence is that a test asserting on `HashMap` iteration order
will pass locally and fail in CI. If you need a stable order you have two
choices: `BTreeMap`, or collect into a `Vec` and sort. The second is often
faster if you only need order at the end, since you pay the log n once rather
than on every insert.

## 8. Grouping by a key you wrote

@kind fix
@concept HashMap
@expect E0599

`entry(...).or_default().push(...)` is the grouping idiom and it is written
correctly here. What is missing is a promise about the key type, and until it is
made the map will not accept `Dept` at all.

The compiler will name the trait it wants. There is more than one.

```starter
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Dept {
    pub name: &'static str,
    pub floor: u8,
}

pub fn group(staff: &[(&'static str, Dept)]) -> HashMap<Dept, Vec<&'static str>> {
    let mut by_dept: HashMap<Dept, Vec<&'static str>> = HashMap::new();
    for (person, dept) in staff {
        by_dept.entry(dept.clone()).or_default().push(*person);
    }
    by_dept
}

pub fn run() -> (usize, usize) {
    let staff = [
        ("ada", Dept { name: "eng", floor: 2 }),
        ("grace", Dept { name: "eng", floor: 2 }),
        ("edsger", Dept { name: "ops", floor: 3 }),
    ];
    let grouped = group(&staff);
    let eng = grouped[&Dept { name: "eng", floor: 2 }].len();
    (grouped.len(), eng)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn two_groups_one_of_two() {
        assert_eq!(run(), (2, 2));
    }
}
```

```solution
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Dept {
    pub name: &'static str,
    pub floor: u8,
}

pub fn group(staff: &[(&'static str, Dept)]) -> HashMap<Dept, Vec<&'static str>> {
    let mut by_dept: HashMap<Dept, Vec<&'static str>> = HashMap::new();
    for (person, dept) in staff {
        by_dept.entry(dept.clone()).or_default().push(*person);
    }
    by_dept
}

pub fn run() -> (usize, usize) {
    let staff = [
        ("ada", Dept { name: "eng", floor: 2 }),
        ("grace", Dept { name: "eng", floor: 2 }),
        ("edsger", Dept { name: "ops", floor: 3 }),
    ];
    let grouped = group(&staff);
    let eng = grouped[&Dept { name: "eng", floor: 2 }].len();
    (grouped.len(), eng)
}
```

@hint To put a value in a bucket the map must be able to hash it. To then tell it apart from another value in the same bucket, it must be able to compare it.
@hint Both are derivable, and one of them needs its weaker sibling first.
@hint `#[derive(Debug, Clone, PartialEq, Eq, Hash)]`.

@diagnose E0599
`the method entry exists for struct HashMap<Dept, Vec<&str>>, but its trait
bounds were not satisfied`, then `Dept: Eq` and `Dept: Hash` listed underneath.

Read that first clause carefully, because it is a different claim from "no such
method". The method is there; the `impl<K, V> HashMap<K, V>` block that defines
it is written `where K: Eq + Hash`, so for `K = Dept` the whole block does not
apply and every method that touches a key vanishes at once. That is why a single
missing derive can make a type look like it has almost no methods.

The two traits are not decoration. `Hash` is how the map decides which bucket a key
belongs in. `Eq` is how it tells your key from the other keys that landed in the
same bucket, because different values can and do hash to the same number.

They also carry a contract the compiler cannot check for you: **equal values
must hash equally.** Derive both and it holds automatically. Hand-write one of
them and get it wrong, and your key will be filed in one bucket and looked for
in another — an entry that is present and unfindable, with no error anywhere.

@diagnose E0277
`the trait bound Dept: Eq is not satisfied`, pointing at
`grouped[&Dept { .. }]`. Indexing a map goes through
`impl Index<&Q> for HashMap<K, V> where K: Eq + Hash`, so it needs the same two
bounds the `entry` call did. Fix the derive once and both errors go.

@diagnose E0369
`binary operation == cannot be applied to type Dept`. You added `Hash` but not
the equality traits. `Eq` is a marker with no methods of its own and it requires
`PartialEq`, so the derive list needs both: `PartialEq, Eq`.

@after
`or_default()` is doing real work in that one line. On the first sighting of a
department it inserts an empty `Vec` and returns `&mut Vec<&str>`; on every
later sighting it returns the existing one. One hash, no `unwrap`, no
`contains_key`.

The `Eq`/`Hash` pair is worth carrying forward as a rule: **a type used as a map
key or a set element must implement both, and if you write either by hand you
must write both to agree.** That is why `f64` is not usable as a `HashMap` key —
`NaN != NaN`, so it cannot implement `Eq` at all, and a key you can never look
up again would be worse than a compile error.
