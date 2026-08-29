---
project: bpe-tokenizer
tier: core
domain: ai
title: A BPE tokenizer
accent: plum
blurb: Build the algorithm GPT and Llama actually use to turn text into integers, from counting byte pairs to a round trip that comes back exactly what went in.
needs: 09-enums, 11-collections, 17-iterators
mins: 70
---

A language model does not read text. It reads a list of integers, and something
has to turn one into the other. That something is the tokenizer, and for GPT,
Llama, Mistral and nearly everything shipped since 2019 it is Byte Pair
Encoding: a compression algorithm from 1994, repurposed.

BPE starts from the 256 possible byte values, counts which two symbols sit next
to each other most often, and replaces every occurrence of that pair with a
single new symbol. Then it does it again. Run it a few thousand times and the
frequent chunks of the training text (`" the"`, `"ing"`, `"fn "`) each collapse
into one integer, while text the algorithm has never seen still decodes byte by
byte. That last property is why BPE won. A byte-level tokenizer cannot produce
an unknown token, because it starts already knowing every byte there is.

Over eight stages you write the whole thing: counting pairs, picking a winner
deterministically, merging, training a merge list, encoding new text with it,
decoding back to a `String`, and a round trip over a real paragraph with the
compression ratio printed at the end. Around a hundred lines. It is the same
algorithm `tiktoken` runs, minus the speed.

What a production tokenizer adds, honestly. A regex pre-tokenizer chops the
text into word-shaped pieces before any counting happens, so no merge can ever
span a space and a letter, which stops `" the"` and `"the "` from both becoming
tokens. Special tokens such as `<|endoftext|>` are spliced in outside the merge
table. And GPT-2 maps raw bytes onto printable characters so the vocabulary
file can be stored as text. None of that changes the algorithm below. It
changes what the algorithm is allowed to merge.

## 1. Text is a list of bytes

@kind fix
@concept iterator

@expect E0277

The first decision in a tokenizer is what the starting symbols are. Not
characters: bytes. `to_ids` should hand back one `u32` per byte of the input,
each in the range 0 to 255. It does not compile yet, and the reason is a
conversion Rust will not perform for you.

```starter
pub fn to_ids(text: &str) -> Vec<u32> {
    text.as_bytes().iter().map(|&b| b).collect()
}

pub fn run() -> Vec<u32> {
    let ids = to_ids("Every value has one owner.");
    println!("{} bytes: {ids:?}", ids.len());
    ids
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_id_per_byte() {
        let ids = run();
        assert_eq!(ids.len(), 26);
        assert_eq!(&ids[..5], &[69, 118, 101, 114, 121]);
        assert!(ids.iter().all(|&id| id < 256));
    }

    #[test]
    fn a_multi_byte_character_is_several_ids() {
        assert_eq!(to_ids("café").len(), 5);
        assert_eq!("café".chars().count(), 4);
    }
}
```

```solution
pub fn to_ids(text: &str) -> Vec<u32> {
    text.as_bytes().iter().map(|&b| b as u32).collect()
}

pub fn run() -> Vec<u32> {
    let ids = to_ids("Every value has one owner.");
    println!("{} bytes: {ids:?}", ids.len());
    ids
}
```

@hint `as_bytes` gives you `&[u8]`. The return type asks for `Vec<u32>`. Nothing in between changes the width.
@hint Rust has no implicit numeric widening, not even from `u8` to `u32`. The cast has to be written.
@hint `.map(|&b| b as u32)`.

@diagnose E0277
`a value of type Vec<u32> cannot be built from an iterator over elements of type u8`.

`collect` is driven entirely by the type it is collecting *into*. You asked for
`Vec<u32>`, so rustc looked for `Vec<u32>: FromIterator<u8>` and did not find
it. There is only `FromIterator<u32>`.

Most languages would widen the `u8` silently here, because widening is lossless.
Rust does not, and the reason is consistency rather than safety: if `u8` to `u32`
were implicit, the same rule would have to answer for `u32` to `u8`, `i32` to
`u32`, and `u64` to `f64`, and those lose data or change sign. Rust draws the
line at zero implicit numeric conversions and makes you write `as`.

@diagnose E0308
You probably reached for `text.as_bytes().to_vec()`, which is the right shape
and the wrong element type: it gives `Vec<u8>` where the signature promises
`Vec<u32>`. There is no cast that works on a whole `Vec` in one step, because
the layouts differ (one byte per element against four). You have to go through
an iterator and convert element by element.

@after
Starting from bytes rather than `char` values is the single decision that lets
this tokenizer accept any input at all. There are 1,112,064 valid `char` values
and 256 byte values. A `char`-based vocabulary has to decide what to do about the ones it
never saw in training, which historically meant an `<UNK>` token and silently
destroyed text.

With bytes, the alphabet is complete before training starts. Emoji, Cyrillic, a
half-corrupted log line: all of them are just byte sequences already in the
vocabulary.

## 2. Counting adjacent pairs

@kind fix
@concept entry

@expect E0368

Training needs to know which two neighbouring symbols occur together most
often, so the first job is a tally. `count_pairs` walks the sequence and counts
every adjacent pair into a `HashMap`. The counting line is one character short
of correct.

```starter
use std::collections::HashMap;

pub const SAMPLE: &str = "aaabdaaabac";

pub fn to_ids(text: &str) -> Vec<u32> {
    text.as_bytes().iter().map(|&b| b as u32).collect()
}

pub fn count_pairs(ids: &[u32]) -> HashMap<(u32, u32), usize> {
    let mut counts: HashMap<(u32, u32), usize> = HashMap::new();
    for w in ids.windows(2) {
        counts.entry((w[0], w[1])).or_insert(0) += 1;
    }
    counts
}

pub fn run() -> Vec<((u32, u32), usize)> {
    let counts = count_pairs(&to_ids(SAMPLE));

    let mut ranked: Vec<((u32, u32), usize)> = counts.into_iter().collect();
    ranked.sort_by_key(|&(pair, n)| (std::cmp::Reverse(n), pair));

    for &((a, b), n) in &ranked {
        println!("({a}, {b}) appears {n} times");
    }
    ranked
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranks_the_sample() {
        let ranked = run();
        assert_eq!(ranked.len(), 6);
        assert_eq!(ranked[0], ((97, 97), 4));
        assert_eq!(ranked[1], ((97, 98), 2));
    }

    #[test]
    fn n_bytes_have_n_minus_one_pairs() {
        let ids = to_ids("abcd");
        let counts = count_pairs(&ids);
        assert_eq!(counts.values().sum::<usize>(), ids.len() - 1);
    }

    #[test]
    fn a_single_byte_has_no_pairs() {
        assert!(count_pairs(&to_ids("a")).is_empty());
        assert!(count_pairs(&[]).is_empty());
    }
}
```

```solution
use std::collections::HashMap;

pub const SAMPLE: &str = "aaabdaaabac";

pub fn to_ids(text: &str) -> Vec<u32> {
    text.as_bytes().iter().map(|&b| b as u32).collect()
}

pub fn count_pairs(ids: &[u32]) -> HashMap<(u32, u32), usize> {
    let mut counts: HashMap<(u32, u32), usize> = HashMap::new();
    for w in ids.windows(2) {
        *counts.entry((w[0], w[1])).or_insert(0) += 1;
    }
    counts
}

pub fn run() -> Vec<((u32, u32), usize)> {
    let counts = count_pairs(&to_ids(SAMPLE));

    let mut ranked: Vec<((u32, u32), usize)> = counts.into_iter().collect();
    ranked.sort_by_key(|&(pair, n)| (std::cmp::Reverse(n), pair));

    for &((a, b), n) in &ranked {
        println!("({a}, {b}) appears {n} times");
    }
    ranked
}
```

@hint Ask what type `or_insert` hands back. It is not a `usize`.
@hint `or_insert` returns `&mut usize`, a reference into the map's storage. `+=` needs the place it points at, not the reference.
@hint Put a `*` at the front of the statement: `*counts.entry(...).or_insert(0) += 1;`

@diagnose E0368
`binary assignment operation += cannot be applied to type &mut usize`.

`or_insert` returns `&mut usize` rather than `usize`, and that is deliberate: it
is a handle to the slot inside the map, so writing through it updates the map
without a second lookup. Rust will auto-deref a receiver for a *method* call,
which is why `v.len()` works on a `&Vec`, but operators are resolved by trait
and `AddAssign` is implemented for `usize`, not for `&mut usize`. So you write
the dereference yourself.

The whole statement is `*(expr) += 1`, where `expr` is everything up to
`or_insert(0)`. The `*` binds to the result of the full method chain, which is
why it goes at the very start of the line.

@diagnose E0614
`type Entry cannot be dereferenced`. You wrote `*counts.entry(k) += 1`, which
dereferences one step too early. `entry` returns an `Entry`, an enum with
`Occupied` and `Vacant` variants that has not yet decided whether a slot exists.
`or_insert(0)` is what forces that decision and yields the `&mut usize`. The
`*` goes outside `or_insert`, not inside it.

@after
`windows(2)` is the whole loop. It yields every overlapping slice of length two,
in order, and yields nothing at all when the input is shorter than two, which is
why the empty-input test passes without a special case.

Note the overlap. `"aaa"` has two `(a, a)` pairs, not one, so the count is 2
even though only one of them can be merged later. That double counting is in the
original BPE paper and every implementation since. It slightly over-weights runs
of a repeated byte, and nobody has found it worth fixing.

## 3. The most frequent pair, chosen the same way every time

@kind fix
@concept Option

@expect E0308

`best_pair` picks the winner from the tally: highest count, and on a tie the
numerically smallest pair, so two runs over the same text always learn the same
vocabulary. It returns `None` when nothing occurs twice. The body is nearly
there but the final type is wrong.

```starter
use std::collections::HashMap;

pub const SAMPLE: &str = "aaabdaaabac";

pub fn to_ids(text: &str) -> Vec<u32> {
    text.as_bytes().iter().map(|&b| b as u32).collect()
}

pub fn count_pairs(ids: &[u32]) -> HashMap<(u32, u32), usize> {
    let mut counts: HashMap<(u32, u32), usize> = HashMap::new();
    for w in ids.windows(2) {
        *counts.entry((w[0], w[1])).or_insert(0) += 1;
    }
    counts
}

pub fn best_pair(counts: &HashMap<(u32, u32), usize>) -> Option<(u32, u32)> {
    counts
        .iter()
        .filter(|(_, n)| **n >= 2)
        .max_by_key(|(pair, n)| (**n, std::cmp::Reverse(**pair)))
}

pub fn run() -> Option<(u32, u32)> {
    let counts = count_pairs(&to_ids(SAMPLE));
    let winner = best_pair(&counts);

    match winner {
        Some((a, b)) => println!("winner ({a}, {b}), seen {} times", counts[&(a, b)]),
        None => println!("nothing occurs twice; training would stop here"),
    }
    winner
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_most_frequent() {
        assert_eq!(run(), Some((97, 97)));
    }

    #[test]
    fn a_tie_goes_to_the_smallest_pair() {
        let mut counts: std::collections::HashMap<(u32, u32), usize> =
            std::collections::HashMap::new();
        counts.insert((200, 1), 3);
        counts.insert((9, 9), 3);
        counts.insert((5, 40), 3);
        assert_eq!(best_pair(&counts), Some((5, 40)));

        // and the same answer a hundred times over, whatever order the map iterates in
        for _ in 0..100 {
            assert_eq!(best_pair(&counts), Some((5, 40)));
        }
    }

    #[test]
    fn nothing_repeated_means_none() {
        assert_eq!(best_pair(&count_pairs(&to_ids("abcd"))), None);
        assert_eq!(best_pair(&count_pairs(&[])), None);
    }
}
```

```solution
use std::collections::HashMap;

pub const SAMPLE: &str = "aaabdaaabac";

pub fn to_ids(text: &str) -> Vec<u32> {
    text.as_bytes().iter().map(|&b| b as u32).collect()
}

pub fn count_pairs(ids: &[u32]) -> HashMap<(u32, u32), usize> {
    let mut counts: HashMap<(u32, u32), usize> = HashMap::new();
    for w in ids.windows(2) {
        *counts.entry((w[0], w[1])).or_insert(0) += 1;
    }
    counts
}

pub fn best_pair(counts: &HashMap<(u32, u32), usize>) -> Option<(u32, u32)> {
    counts
        .iter()
        .filter(|(_, n)| **n >= 2)
        .max_by_key(|(pair, n)| (**n, std::cmp::Reverse(**pair)))
        .map(|(pair, _)| *pair)
}

pub fn run() -> Option<(u32, u32)> {
    let counts = count_pairs(&to_ids(SAMPLE));
    let winner = best_pair(&counts);

    match winner {
        Some((a, b)) => println!("winner ({a}, {b}), seen {} times", counts[&(a, b)]),
        None => println!("nothing occurs twice; training would stop here"),
    }
    winner
}
```

@hint `max_by_key` on a `HashMap::iter()` gives you back an entry, not a key.
@hint The chain currently produces `Option<(&(u32, u32), &usize)>`. You want `Option<(u32, u32)>`, so you need to reach into the pair and copy it out.
@hint `.map(|(pair, _)| *pair)` on the end.

@diagnose E0308
`expected Option<(u32, u32)>, found Option<(&(u32, u32), &usize)>`.

`HashMap::iter` yields `(&K, &V)`, and every adaptor after it carries that shape
along. `filter` does not change the item type, and neither does `max_by_key`,
which only *uses* the key you compute to decide which item wins. So the winner
comes out still wrapped as a key reference beside a value reference.

`Option::map` is the tool: it reaches inside the `Some`, runs your closure, and
leaves `None` untouched. Copying the `(u32, u32)` out with `*` is free, since a
tuple of two `u32` is `Copy`.

@diagnose E0369
The comparison in `filter` is against the wrong number of references. The
closure receives `&(&(u32, u32), &usize)`, so destructuring with `(_, n)` makes
`n` a `&&usize`, two levels away from a number. `**n >= 2` peels both.

@after
The tie-break is not decoration. `HashMap` iteration order in Rust is randomised
per process, deliberately, to keep programs from depending on it. Without
`Reverse(**pair)` in the key, `max_by_key` would return whichever tied pair the
iterator happened to reach last, and the same corpus would train a different
vocabulary on every run.

That would be a genuine bug: a tokenizer is half of a model's interface. Change
which merge came first and every weight trained against the old ids is pointing
at the wrong token.

## 4. Minting a new symbol

@kind fix
@concept slice

@expect E0502

`merge` is the actual compression step. Given the sequence, a pair, and a fresh
id, it replaces every occurrence of that pair with the new id and leaves
everything else alone. The starter tries to edit the vector while scanning it,
and the borrow checker has an opinion about that.

```starter
use std::collections::HashMap;

pub const SAMPLE: &str = "aaabdaaabac";

pub fn to_ids(text: &str) -> Vec<u32> {
    text.as_bytes().iter().map(|&b| b as u32).collect()
}

pub fn count_pairs(ids: &[u32]) -> HashMap<(u32, u32), usize> {
    let mut counts: HashMap<(u32, u32), usize> = HashMap::new();
    for w in ids.windows(2) {
        *counts.entry((w[0], w[1])).or_insert(0) += 1;
    }
    counts
}

pub fn best_pair(counts: &HashMap<(u32, u32), usize>) -> Option<(u32, u32)> {
    counts
        .iter()
        .filter(|(_, n)| **n >= 2)
        .max_by_key(|(pair, n)| (**n, std::cmp::Reverse(**pair)))
        .map(|(pair, _)| *pair)
}

pub fn merge(ids: &[u32], pair: (u32, u32), new_id: u32) -> Vec<u32> {
    let mut out = ids.to_vec();
    for (i, w) in out.windows(2).enumerate() {
        if (w[0], w[1]) == pair {
            out.splice(i..i + 2, [new_id]);
        }
    }
    out
}

pub fn run() -> Vec<u32> {
    let ids = to_ids(SAMPLE);
    let pair = best_pair(&count_pairs(&ids)).expect("the sample repeats a pair");

    let merged = merge(&ids, pair, 256);
    println!("before {ids:?}");
    println!("merged ({}, {}) into 256", pair.0, pair.1);
    println!("after  {merged:?}   {} ids, was {}", merged.len(), ids.len());
    merged
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_every_occurrence() {
        assert_eq!(run(), vec![256, 97, 98, 100, 256, 97, 98, 97, 99]);
    }

    #[test]
    fn a_half_pair_at_the_end_survives() {
        assert_eq!(merge(&[1, 2, 1], (1, 2), 300), vec![300, 1]);
        assert_eq!(merge(&[1], (1, 2), 300), vec![1]);
        assert_eq!(merge(&[], (1, 2), 300), vec![]);
    }

    #[test]
    fn overlapping_runs_merge_left_to_right() {
        assert_eq!(merge(&[97, 97, 97], (97, 97), 256), vec![256, 97]);
        assert_eq!(merge(&[97, 97, 97, 97], (97, 97), 256), vec![256, 256]);
    }

    #[test]
    fn an_absent_pair_changes_nothing() {
        assert_eq!(merge(&[1, 2, 3], (7, 8), 300), vec![1, 2, 3]);
    }
}
```

```solution
use std::collections::HashMap;

pub const SAMPLE: &str = "aaabdaaabac";

pub fn to_ids(text: &str) -> Vec<u32> {
    text.as_bytes().iter().map(|&b| b as u32).collect()
}

pub fn count_pairs(ids: &[u32]) -> HashMap<(u32, u32), usize> {
    let mut counts: HashMap<(u32, u32), usize> = HashMap::new();
    for w in ids.windows(2) {
        *counts.entry((w[0], w[1])).or_insert(0) += 1;
    }
    counts
}

pub fn best_pair(counts: &HashMap<(u32, u32), usize>) -> Option<(u32, u32)> {
    counts
        .iter()
        .filter(|(_, n)| **n >= 2)
        .max_by_key(|(pair, n)| (**n, std::cmp::Reverse(**pair)))
        .map(|(pair, _)| *pair)
}

pub fn merge(ids: &[u32], pair: (u32, u32), new_id: u32) -> Vec<u32> {
    let mut out = Vec::with_capacity(ids.len());
    let mut i = 0;
    while i < ids.len() {
        if i + 1 < ids.len() && ids[i] == pair.0 && ids[i + 1] == pair.1 {
            out.push(new_id);
            i += 2;
        } else {
            out.push(ids[i]);
            i += 1;
        }
    }
    out
}

pub fn run() -> Vec<u32> {
    let ids = to_ids(SAMPLE);
    let pair = best_pair(&count_pairs(&ids)).expect("the sample repeats a pair");

    let merged = merge(&ids, pair, 256);
    println!("before {ids:?}");
    println!("merged ({}, {}) into 256", pair.0, pair.1);
    println!("after  {merged:?}   {} ids, was {}", merged.len(), ids.len());
    merged
}
```

@hint Editing a vector while an iterator is walking it is the one thing the borrow checker exists to stop. Build a second vector instead.
@hint You cannot use a `for` loop, because consuming a merged pair means stepping the cursor by two. Use `let mut i = 0;` and a `while` loop.
@hint The shape is: while `i` is in range, if the pair matches at `i` push `new_id` and `i += 2`, otherwise push `ids[i]` and `i += 1`. Guard the match with `i + 1 < ids.len()`.

@diagnose E0502
`cannot borrow out as mutable because it is also borrowed as immutable`.

`out.windows(2)` borrows `out` immutably, and the `for` loop holds that borrow
for its entire body, because the iterator has to still be there on the next
iteration. `out.splice(..)` wants a mutable borrow of the same vector at the same
moment. Two live borrows, one of them exclusive, so the compiler refuses.

This is not bureaucracy. `splice` can reallocate, which would leave the
iterator's internal pointer aimed at freed memory, and the loop would then read
it. In C++ that is iterator invalidation and it compiles fine. The rule
that stops it here is the same one that stops every other use after free.

The fix is not to fight the borrow. Read from `ids` and write to a fresh `Vec`,
and no value is ever borrowed twice.

@diagnose E0596
`cannot borrow out as mutable, as it is not declared as mutable`. You are
pushing into a binding declared with `let out = ...`. Bindings are immutable by
default and `push` takes `&mut self`. Write `let mut out`.

@after
Two subtleties are hiding in the tests you just passed.

The bounds guard `i + 1 < ids.len()` has to come before the comparisons, because
`&&` short circuits and without it the last element would index one past the end
and panic. Every implementation of this function has that guard.

And merging is left to right and non-overlapping: `[a, a, a]` with pair `(a, a)`
gives `[Z, a]`, not `[Z, Z]` or `[a, Z]`. The tally back in stage 2 counted two
occurrences, only one of which could survive. Counts are an estimate of what a
merge will buy you, not a promise.

## 5. Training: the merge list is the model

@kind fix
@concept match

@expect E0005

Now the loop. Count, pick, merge, mint the next id, repeat until the vocabulary
is the size you asked for or nothing repeats any more. `train` returns the
merges in the order it learned them, which is the entire trained model. One
binding in the loop is written as though it could not fail.

```starter
use std::collections::HashMap;

pub const SAMPLE: &str = "aaabdaaabac";

pub const CORPUS: &str = "Every language answers one question: when is it safe to free this memory? C makes you answer by hand and punishes mistakes. Java and Python refuse to answer and pay a collector to keep asking. Rust answers at compile time, and the price is that you say who owns what. Every value has one owner. When the owner goes out of scope, the value is dropped. Ownership can be given away, and afterwards the old binding is statically dead.";

pub fn to_ids(text: &str) -> Vec<u32> {
    text.as_bytes().iter().map(|&b| b as u32).collect()
}

pub fn count_pairs(ids: &[u32]) -> HashMap<(u32, u32), usize> {
    let mut counts: HashMap<(u32, u32), usize> = HashMap::new();
    for w in ids.windows(2) {
        *counts.entry((w[0], w[1])).or_insert(0) += 1;
    }
    counts
}

pub fn best_pair(counts: &HashMap<(u32, u32), usize>) -> Option<(u32, u32)> {
    counts
        .iter()
        .filter(|(_, n)| **n >= 2)
        .max_by_key(|(pair, n)| (**n, std::cmp::Reverse(**pair)))
        .map(|(pair, _)| *pair)
}

pub fn merge(ids: &[u32], pair: (u32, u32), new_id: u32) -> Vec<u32> {
    let mut out = Vec::with_capacity(ids.len());
    let mut i = 0;
    while i < ids.len() {
        if i + 1 < ids.len() && ids[i] == pair.0 && ids[i + 1] == pair.1 {
            out.push(new_id);
            i += 2;
        } else {
            out.push(ids[i]);
            i += 1;
        }
    }
    out
}

pub fn train(text: &str, vocab_size: usize) -> Vec<((u32, u32), u32)> {
    let mut ids = to_ids(text);
    let mut merges = Vec::new();
    let mut next_id = 256u32;

    while (next_id as usize) < vocab_size {
        let counts = count_pairs(&ids);
        let Some(pair) = best_pair(&counts);
        ids = merge(&ids, pair, next_id);
        merges.push((pair, next_id));
        next_id += 1;
    }
    merges
}

pub fn run() -> Vec<((u32, u32), u32)> {
    let merges = train(CORPUS, 300);
    for &((a, b), id) in &merges {
        println!("{id:4} <- ({a:3}, {b:3})");
    }
    println!("{} merges from {} bytes", merges.len(), CORPUS.len());
    merges
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn learns_a_full_vocabulary() {
        let merges = run();
        assert_eq!(merges.len(), 44);
        assert_eq!(merges[0], ((101, 32), 256));
    }

    #[test]
    fn ids_are_minted_in_order() {
        let merges = train(CORPUS, 300);
        for (i, &(_, id)) in merges.iter().enumerate() {
            assert_eq!(id as usize, 256 + i);
        }
    }

    #[test]
    fn a_merge_only_ever_uses_earlier_ids() {
        for &((a, b), id) in &train(CORPUS, 300) {
            assert!(a < id && b < id);
        }
    }

    #[test]
    fn training_stops_when_nothing_repeats() {
        assert_eq!(
            train(SAMPLE, 4000),
            vec![((97, 97), 256), ((97, 98), 257), ((256, 257), 258)]
        );
        assert!(train("abcd", 400).is_empty());
    }
}
```

```solution
use std::collections::HashMap;

pub const SAMPLE: &str = "aaabdaaabac";

pub const CORPUS: &str = "Every language answers one question: when is it safe to free this memory? C makes you answer by hand and punishes mistakes. Java and Python refuse to answer and pay a collector to keep asking. Rust answers at compile time, and the price is that you say who owns what. Every value has one owner. When the owner goes out of scope, the value is dropped. Ownership can be given away, and afterwards the old binding is statically dead.";

pub fn to_ids(text: &str) -> Vec<u32> {
    text.as_bytes().iter().map(|&b| b as u32).collect()
}

pub fn count_pairs(ids: &[u32]) -> HashMap<(u32, u32), usize> {
    let mut counts: HashMap<(u32, u32), usize> = HashMap::new();
    for w in ids.windows(2) {
        *counts.entry((w[0], w[1])).or_insert(0) += 1;
    }
    counts
}

pub fn best_pair(counts: &HashMap<(u32, u32), usize>) -> Option<(u32, u32)> {
    counts
        .iter()
        .filter(|(_, n)| **n >= 2)
        .max_by_key(|(pair, n)| (**n, std::cmp::Reverse(**pair)))
        .map(|(pair, _)| *pair)
}

pub fn merge(ids: &[u32], pair: (u32, u32), new_id: u32) -> Vec<u32> {
    let mut out = Vec::with_capacity(ids.len());
    let mut i = 0;
    while i < ids.len() {
        if i + 1 < ids.len() && ids[i] == pair.0 && ids[i + 1] == pair.1 {
            out.push(new_id);
            i += 2;
        } else {
            out.push(ids[i]);
            i += 1;
        }
    }
    out
}

pub fn train(text: &str, vocab_size: usize) -> Vec<((u32, u32), u32)> {
    let mut ids = to_ids(text);
    let mut merges = Vec::new();
    let mut next_id = 256u32;

    while (next_id as usize) < vocab_size {
        let counts = count_pairs(&ids);
        let Some(pair) = best_pair(&counts) else { break };
        ids = merge(&ids, pair, next_id);
        merges.push((pair, next_id));
        next_id += 1;
    }
    merges
}

pub fn run() -> Vec<((u32, u32), u32)> {
    let merges = train(CORPUS, 300);
    for &((a, b), id) in &merges {
        println!("{id:4} <- ({a:3}, {b:3})");
    }
    println!("{} merges from {} bytes", merges.len(), CORPUS.len());
    merges
}
```

@hint `best_pair` returns an `Option`, and `Some(pair)` matches only one of its two variants. What should the loop do on `None`?
@hint A corpus can run out of repeated pairs before the vocabulary target is reached, and when it does, training is finished. That is a `break`.
@hint `let ... else` is built for exactly this: `let Some(pair) = best_pair(&counts) else { break };`. The `else` block must diverge.

@diagnose E0005
`refutable pattern in local binding`.

A `let` binding must match. It has no other arm to fall through to, so the
pattern has to be **irrefutable**: one that succeeds for every possible value of
the type. `Some(pair)` is refutable, because `None` is also an `Option`, and
rustc will not let you write a binding that might simply have nothing to bind.

Three ways out. `match` handles both variants explicitly. `if let Some(pair) =
... { }` runs the body only on `Some`. And `let ... else` binds on `Some` and
runs a diverging block on `None`, which is the one you want here, because it
keeps `pair` in scope for the rest of the loop body rather than pushing
everything one level deeper.

@diagnose E0308
Compare `next_id` and `vocab_size`. One is a `u32` and the other a `usize`, and
Rust compares only same-typed values. Cast at the comparison:
`(next_id as usize) < vocab_size`.

@after
The list `train` returns is the model. Not a neural net, not a probability
table: an ordered list of pairs. Save it to a file and you have shipped a
tokenizer; GPT-2's `vocab.bpe` is literally this list, 50,000 lines of two
symbols each.

Notice what the tests pin down. Every merge's two components are ids smaller
than the id it mints, because a pair can only be built from symbols that already
existed when it was learned. That property is what makes the vocabulary
reconstructible from the merge list alone, and stage 7 leans on it.

The loop is also quadratic: it re-counts every pair in the whole sequence on
every merge. Real trainers keep the counts incrementally. For 430 bytes it does
not matter.

## 6. Encoding new text

@kind fix
@concept ownership

@expect E0384

Encoding is applying the learned merges to text the trainer never saw. Every
merge, once, in the order it was learned. The loop below rebinds the sequence
each round and one keyword is missing.

```starter
use std::collections::HashMap;

pub const SAMPLE: &str = "aaabdaaabac";

pub const CORPUS: &str = "Every language answers one question: when is it safe to free this memory? C makes you answer by hand and punishes mistakes. Java and Python refuse to answer and pay a collector to keep asking. Rust answers at compile time, and the price is that you say who owns what. Every value has one owner. When the owner goes out of scope, the value is dropped. Ownership can be given away, and afterwards the old binding is statically dead.";

pub const HELD_OUT: &str = "Every owner answers one question.";

pub fn to_ids(text: &str) -> Vec<u32> {
    text.as_bytes().iter().map(|&b| b as u32).collect()
}

pub fn count_pairs(ids: &[u32]) -> HashMap<(u32, u32), usize> {
    let mut counts: HashMap<(u32, u32), usize> = HashMap::new();
    for w in ids.windows(2) {
        *counts.entry((w[0], w[1])).or_insert(0) += 1;
    }
    counts
}

pub fn best_pair(counts: &HashMap<(u32, u32), usize>) -> Option<(u32, u32)> {
    counts
        .iter()
        .filter(|(_, n)| **n >= 2)
        .max_by_key(|(pair, n)| (**n, std::cmp::Reverse(**pair)))
        .map(|(pair, _)| *pair)
}

pub fn merge(ids: &[u32], pair: (u32, u32), new_id: u32) -> Vec<u32> {
    let mut out = Vec::with_capacity(ids.len());
    let mut i = 0;
    while i < ids.len() {
        if i + 1 < ids.len() && ids[i] == pair.0 && ids[i + 1] == pair.1 {
            out.push(new_id);
            i += 2;
        } else {
            out.push(ids[i]);
            i += 1;
        }
    }
    out
}

pub fn train(text: &str, vocab_size: usize) -> Vec<((u32, u32), u32)> {
    let mut ids = to_ids(text);
    let mut merges = Vec::new();
    let mut next_id = 256u32;

    while (next_id as usize) < vocab_size {
        let counts = count_pairs(&ids);
        let Some(pair) = best_pair(&counts) else { break };
        ids = merge(&ids, pair, next_id);
        merges.push((pair, next_id));
        next_id += 1;
    }
    merges
}

pub fn encode(text: &str, merges: &[((u32, u32), u32)]) -> Vec<u32> {
    let ids = to_ids(text);
    for &(pair, new_id) in merges {
        ids = merge(&ids, pair, new_id);
    }
    ids
}

pub fn run() -> Vec<u32> {
    let merges = train(CORPUS, 300);
    let tokens = encode(HELD_OUT, &merges);

    println!("{HELD_OUT:?}");
    println!("{} bytes -> {} tokens", HELD_OUT.len(), tokens.len());
    println!("{tokens:?}");
    tokens
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_held_out_text() {
        let tokens = run();
        assert_eq!(tokens.len(), 16);
        assert_eq!(tokens[0], 289);
    }

    #[test]
    fn learned_order_is_not_frequency_order() {
        let merges = train(SAMPLE, 259);
        assert_eq!(encode(SAMPLE, &merges), vec![258, 100, 258, 97, 99]);

        // the same three merges, applied newest first: 258 can never be built,
        // because the halves it is made of do not exist yet when its turn comes
        let shuffled = vec![merges[2], merges[0], merges[1]];
        assert_eq!(encode(SAMPLE, &shuffled), vec![256, 257, 100, 256, 257, 97, 99]);
    }

    #[test]
    fn unseen_bytes_still_encode() {
        let merges = train(CORPUS, 300);
        let tokens = encode("🦀", &merges);
        assert_eq!(tokens, vec![240, 159, 166, 128]);
    }

    #[test]
    fn encoding_the_corpus_agrees_with_training() {
        let merges = train(CORPUS, 300);
        assert!(encode(CORPUS, &merges).len() < CORPUS.len());
    }
}
```

```solution
use std::collections::HashMap;

pub const SAMPLE: &str = "aaabdaaabac";

pub const CORPUS: &str = "Every language answers one question: when is it safe to free this memory? C makes you answer by hand and punishes mistakes. Java and Python refuse to answer and pay a collector to keep asking. Rust answers at compile time, and the price is that you say who owns what. Every value has one owner. When the owner goes out of scope, the value is dropped. Ownership can be given away, and afterwards the old binding is statically dead.";

pub const HELD_OUT: &str = "Every owner answers one question.";

pub fn to_ids(text: &str) -> Vec<u32> {
    text.as_bytes().iter().map(|&b| b as u32).collect()
}

pub fn count_pairs(ids: &[u32]) -> HashMap<(u32, u32), usize> {
    let mut counts: HashMap<(u32, u32), usize> = HashMap::new();
    for w in ids.windows(2) {
        *counts.entry((w[0], w[1])).or_insert(0) += 1;
    }
    counts
}

pub fn best_pair(counts: &HashMap<(u32, u32), usize>) -> Option<(u32, u32)> {
    counts
        .iter()
        .filter(|(_, n)| **n >= 2)
        .max_by_key(|(pair, n)| (**n, std::cmp::Reverse(**pair)))
        .map(|(pair, _)| *pair)
}

pub fn merge(ids: &[u32], pair: (u32, u32), new_id: u32) -> Vec<u32> {
    let mut out = Vec::with_capacity(ids.len());
    let mut i = 0;
    while i < ids.len() {
        if i + 1 < ids.len() && ids[i] == pair.0 && ids[i + 1] == pair.1 {
            out.push(new_id);
            i += 2;
        } else {
            out.push(ids[i]);
            i += 1;
        }
    }
    out
}

pub fn train(text: &str, vocab_size: usize) -> Vec<((u32, u32), u32)> {
    let mut ids = to_ids(text);
    let mut merges = Vec::new();
    let mut next_id = 256u32;

    while (next_id as usize) < vocab_size {
        let counts = count_pairs(&ids);
        let Some(pair) = best_pair(&counts) else { break };
        ids = merge(&ids, pair, next_id);
        merges.push((pair, next_id));
        next_id += 1;
    }
    merges
}

pub fn encode(text: &str, merges: &[((u32, u32), u32)]) -> Vec<u32> {
    let mut ids = to_ids(text);
    for &(pair, new_id) in merges {
        ids = merge(&ids, pair, new_id);
    }
    ids
}

pub fn run() -> Vec<u32> {
    let merges = train(CORPUS, 300);
    let tokens = encode(HELD_OUT, &merges);

    println!("{HELD_OUT:?}");
    println!("{} bytes -> {} tokens", HELD_OUT.len(), tokens.len());
    println!("{tokens:?}");
    tokens
}
```

@hint `merge` returns a new `Vec` rather than editing in place, so `encode` has to point `ids` at the new one each round.
@hint Reassigning a binding requires permission that a plain `let` does not grant.
@hint `let mut ids = to_ids(text);`

@diagnose E0384
`cannot assign twice to immutable variable ids`.

`let ids = to_ids(text)` binds once, and `ids = merge(...)` inside the loop is a
second assignment to the same binding. Immutable is the default in Rust, and the
error is worth reading as documentation: the compiler is telling you that this
value changes over time, which is a fact about your algorithm, and it wants that
fact written down as `mut`.

The old `Vec` is dropped on each reassignment, so its buffer is freed the moment
the new one is bound. Encoding a long document allocates and frees one vector per
merge, which is why real implementations work in place over word-sized chunks.

@diagnose E0308
Look at how the loop destructures. `merges` is `&[((u32, u32), u32)]`, so
iterating it yields `&((u32, u32), u32)`. Without the `&` in the pattern, `pair`
comes out as `&(u32, u32)` and `merge` wants `(u32, u32)`. Write
`for &(pair, new_id) in merges` and the reference is peeled off in the pattern.

@after
Applying the merges in learned order is the part implementations get wrong, so
it is worth being precise about why it is correct.

A tempting alternative is to count pairs in the new text and merge the most
frequent one first, the way training did. That is wrong, and the test shows it.
Merge 258 is `(256, 257)`, so it can only match after 256 and 257 have been
built. Reorder the list and 258 finds nothing to merge, giving 7 tokens instead
of 5, for the same text and the same vocabulary.

One pass in learned order is also enough. A merge minting id `n` can never
create a new occurrence of an earlier pair, because every earlier pair is built
from ids smaller than `n`. So no merge ever needs a second look.

## 7. Decoding, and the split character

@kind fix
@concept Vec

@expect E0308

Decoding needs the bytes each id stands for. `build_vocab` reconstructs that
table from the merge list: 256 single bytes, then one entry per merge, each the
concatenation of its two halves. `decode` glues the bytes back together and
turns them into a `String`, and that last step returns something you have to
handle.

```starter
use std::collections::HashMap;

pub const SAMPLE: &str = "aaabdaaabac";

pub const CORPUS: &str = "Every language answers one question: when is it safe to free this memory? C makes you answer by hand and punishes mistakes. Java and Python refuse to answer and pay a collector to keep asking. Rust answers at compile time, and the price is that you say who owns what. Every value has one owner. When the owner goes out of scope, the value is dropped. Ownership can be given away, and afterwards the old binding is statically dead.";

pub const HELD_OUT: &str = "Every owner answers one question.";

pub fn to_ids(text: &str) -> Vec<u32> {
    text.as_bytes().iter().map(|&b| b as u32).collect()
}

pub fn count_pairs(ids: &[u32]) -> HashMap<(u32, u32), usize> {
    let mut counts: HashMap<(u32, u32), usize> = HashMap::new();
    for w in ids.windows(2) {
        *counts.entry((w[0], w[1])).or_insert(0) += 1;
    }
    counts
}

pub fn best_pair(counts: &HashMap<(u32, u32), usize>) -> Option<(u32, u32)> {
    counts
        .iter()
        .filter(|(_, n)| **n >= 2)
        .max_by_key(|(pair, n)| (**n, std::cmp::Reverse(**pair)))
        .map(|(pair, _)| *pair)
}

pub fn merge(ids: &[u32], pair: (u32, u32), new_id: u32) -> Vec<u32> {
    let mut out = Vec::with_capacity(ids.len());
    let mut i = 0;
    while i < ids.len() {
        if i + 1 < ids.len() && ids[i] == pair.0 && ids[i + 1] == pair.1 {
            out.push(new_id);
            i += 2;
        } else {
            out.push(ids[i]);
            i += 1;
        }
    }
    out
}

pub fn train(text: &str, vocab_size: usize) -> Vec<((u32, u32), u32)> {
    let mut ids = to_ids(text);
    let mut merges = Vec::new();
    let mut next_id = 256u32;

    while (next_id as usize) < vocab_size {
        let counts = count_pairs(&ids);
        let Some(pair) = best_pair(&counts) else { break };
        ids = merge(&ids, pair, next_id);
        merges.push((pair, next_id));
        next_id += 1;
    }
    merges
}

pub fn encode(text: &str, merges: &[((u32, u32), u32)]) -> Vec<u32> {
    let mut ids = to_ids(text);
    for &(pair, new_id) in merges {
        ids = merge(&ids, pair, new_id);
    }
    ids
}

pub fn build_vocab(merges: &[((u32, u32), u32)]) -> Vec<Vec<u8>> {
    let mut vocab: Vec<Vec<u8>> = (0..=255u32).map(|b| vec![b as u8]).collect();
    for &((a, b), _) in merges {
        let mut piece = vocab[a as usize].clone();
        piece.extend_from_slice(&vocab[b as usize]);
        vocab.push(piece);
    }
    vocab
}

pub fn decode(ids: &[u32], vocab: &[Vec<u8>]) -> String {
    let mut bytes = Vec::new();
    for &id in ids {
        bytes.extend_from_slice(&vocab[id as usize]);
    }
    String::from_utf8(bytes)
}

pub fn run() -> String {
    let merges = train(CORPUS, 300);
    let vocab = build_vocab(&merges);

    for &(_, id) in &merges {
        println!("{id:4} = {:?}", decode(&[id], &vocab));
    }

    let text = decode(&encode(HELD_OUT, &merges), &vocab);
    println!("{text}");
    text
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_undoes_encode() {
        assert_eq!(run(), HELD_OUT);
    }

    #[test]
    fn a_token_holds_the_bytes_of_its_two_halves() {
        let merges = train(CORPUS, 300);
        let vocab = build_vocab(&merges);
        assert_eq!(vocab.len(), 300);
        assert_eq!(vocab[97], b"a");
        for &((a, b), id) in &merges {
            let joined = [vocab[a as usize].clone(), vocab[b as usize].clone()].concat();
            assert_eq!(vocab[id as usize], joined);
        }
    }

    #[test]
    fn the_learned_tokens_are_readable() {
        let merges = train(CORPUS, 300);
        let vocab = build_vocab(&merges);
        assert_eq!(decode(&[256], &vocab), "e ");
        assert_eq!(decode(&[284], &vocab), " answer");
    }

    #[test]
    fn half_a_character_becomes_the_replacement_char() {
        let vocab = build_vocab(&[]);
        // "é" is 0xC3 0xA9. Hand decode only the first of the two.
        assert_eq!(decode(&[99, 97, 102, 0xC3], &vocab), "caf\u{fffd}");
        assert_eq!(decode(&[99, 97, 102, 0xC3, 0xA9], &vocab), "café");
    }
}
```

```solution
use std::collections::HashMap;

pub const SAMPLE: &str = "aaabdaaabac";

pub const CORPUS: &str = "Every language answers one question: when is it safe to free this memory? C makes you answer by hand and punishes mistakes. Java and Python refuse to answer and pay a collector to keep asking. Rust answers at compile time, and the price is that you say who owns what. Every value has one owner. When the owner goes out of scope, the value is dropped. Ownership can be given away, and afterwards the old binding is statically dead.";

pub const HELD_OUT: &str = "Every owner answers one question.";

pub fn to_ids(text: &str) -> Vec<u32> {
    text.as_bytes().iter().map(|&b| b as u32).collect()
}

pub fn count_pairs(ids: &[u32]) -> HashMap<(u32, u32), usize> {
    let mut counts: HashMap<(u32, u32), usize> = HashMap::new();
    for w in ids.windows(2) {
        *counts.entry((w[0], w[1])).or_insert(0) += 1;
    }
    counts
}

pub fn best_pair(counts: &HashMap<(u32, u32), usize>) -> Option<(u32, u32)> {
    counts
        .iter()
        .filter(|(_, n)| **n >= 2)
        .max_by_key(|(pair, n)| (**n, std::cmp::Reverse(**pair)))
        .map(|(pair, _)| *pair)
}

pub fn merge(ids: &[u32], pair: (u32, u32), new_id: u32) -> Vec<u32> {
    let mut out = Vec::with_capacity(ids.len());
    let mut i = 0;
    while i < ids.len() {
        if i + 1 < ids.len() && ids[i] == pair.0 && ids[i + 1] == pair.1 {
            out.push(new_id);
            i += 2;
        } else {
            out.push(ids[i]);
            i += 1;
        }
    }
    out
}

pub fn train(text: &str, vocab_size: usize) -> Vec<((u32, u32), u32)> {
    let mut ids = to_ids(text);
    let mut merges = Vec::new();
    let mut next_id = 256u32;

    while (next_id as usize) < vocab_size {
        let counts = count_pairs(&ids);
        let Some(pair) = best_pair(&counts) else { break };
        ids = merge(&ids, pair, next_id);
        merges.push((pair, next_id));
        next_id += 1;
    }
    merges
}

pub fn encode(text: &str, merges: &[((u32, u32), u32)]) -> Vec<u32> {
    let mut ids = to_ids(text);
    for &(pair, new_id) in merges {
        ids = merge(&ids, pair, new_id);
    }
    ids
}

pub fn build_vocab(merges: &[((u32, u32), u32)]) -> Vec<Vec<u8>> {
    let mut vocab: Vec<Vec<u8>> = (0..=255u32).map(|b| vec![b as u8]).collect();
    for &((a, b), _) in merges {
        let mut piece = vocab[a as usize].clone();
        piece.extend_from_slice(&vocab[b as usize]);
        vocab.push(piece);
    }
    vocab
}

pub fn decode(ids: &[u32], vocab: &[Vec<u8>]) -> String {
    let mut bytes = Vec::new();
    for &id in ids {
        bytes.extend_from_slice(&vocab[id as usize]);
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

pub fn run() -> String {
    let merges = train(CORPUS, 300);
    let vocab = build_vocab(&merges);

    for &(_, id) in &merges {
        println!("{id:4} = {:?}", decode(&[id], &vocab));
    }

    let text = decode(&encode(HELD_OUT, &merges), &vocab);
    println!("{text}");
    text
}
```

@hint `String::from_utf8` can fail, so it does not return a `String`. Read its return type.
@hint A token boundary can land in the middle of a multi-byte character, so a slice of ids is not guaranteed to be valid UTF-8. Panicking on that would be a poor tokenizer.
@hint `String::from_utf8_lossy(&bytes)` never fails; it substitutes U+FFFD for each bad sequence. It hands back a `Cow<str>`, so finish with `.into_owned()`.

@diagnose E0308
`expected String, found Result<String, FromUtf8Error>`.

`String::from_utf8` validates, and validation can fail, so the return type carries
both outcomes. Rust has no exceptions, so a fallible operation says so in its
type and you cannot ignore it by accident.

Three ways to satisfy the signature, and only one is right here. `.unwrap()`
compiles and panics on any invalid input, which for a tokenizer means crashing
on a truncated generation. `?` needs the function to return a `Result` too, which
pushes the problem to the caller. `String::from_utf8_lossy` decides here and now:
replace each invalid sequence with U+FFFD and carry on. That is what every
production decoder does.

@diagnose E0277
`from_utf8_lossy` returns `Cow<'_, str>`, not a `String`, and `Cow` is a
borrow-or-owned wrapper rather than an owned buffer. `.into_owned()` turns it
into a `String`, allocating only when the bytes actually needed repair.

@after
Look at what the failing case means. A model streaming one token at a time will
sometimes emit half of a multi-byte character, because a merge learned from
English can easily cut a UTF-8 sequence in two. Decode that prefix on its own
and you get U+FFFD, the replacement character. Decode the next token as well and
the character resolves.

This is why chat interfaces buffer. `from_utf8_lossy` gives correct final text
and a momentary `\u{fffd}` mid-stream, and the fix at the application layer is
to hold incomplete bytes back rather than to change the decoder.

Note also that `build_vocab` needs nothing but the merge list. The ordering
property from stage 5, every component id smaller than the id it builds, is what
lets a single forward pass fill the table.

## 8. The round trip

@kind fix
@concept iterator

@expect E0277

Everything is written. This stage puts it together: train, build the vocabulary,
encode the whole corpus, decode it, and assert that what comes out is exactly
what went in. Then print how much smaller the token sequence is than the byte
sequence. The ratio line does not compile.

```starter
use std::collections::HashMap;

pub const SAMPLE: &str = "aaabdaaabac";

pub const CORPUS: &str = "Every language answers one question: when is it safe to free this memory? C makes you answer by hand and punishes mistakes. Java and Python refuse to answer and pay a collector to keep asking. Rust answers at compile time, and the price is that you say who owns what. Every value has one owner. When the owner goes out of scope, the value is dropped. Ownership can be given away, and afterwards the old binding is statically dead.";

pub const HELD_OUT: &str = "Every owner answers one question.";

pub fn to_ids(text: &str) -> Vec<u32> {
    text.as_bytes().iter().map(|&b| b as u32).collect()
}

pub fn count_pairs(ids: &[u32]) -> HashMap<(u32, u32), usize> {
    let mut counts: HashMap<(u32, u32), usize> = HashMap::new();
    for w in ids.windows(2) {
        *counts.entry((w[0], w[1])).or_insert(0) += 1;
    }
    counts
}

pub fn best_pair(counts: &HashMap<(u32, u32), usize>) -> Option<(u32, u32)> {
    counts
        .iter()
        .filter(|(_, n)| **n >= 2)
        .max_by_key(|(pair, n)| (**n, std::cmp::Reverse(**pair)))
        .map(|(pair, _)| *pair)
}

pub fn merge(ids: &[u32], pair: (u32, u32), new_id: u32) -> Vec<u32> {
    let mut out = Vec::with_capacity(ids.len());
    let mut i = 0;
    while i < ids.len() {
        if i + 1 < ids.len() && ids[i] == pair.0 && ids[i + 1] == pair.1 {
            out.push(new_id);
            i += 2;
        } else {
            out.push(ids[i]);
            i += 1;
        }
    }
    out
}

pub fn train(text: &str, vocab_size: usize) -> Vec<((u32, u32), u32)> {
    let mut ids = to_ids(text);
    let mut merges = Vec::new();
    let mut next_id = 256u32;

    while (next_id as usize) < vocab_size {
        let counts = count_pairs(&ids);
        let Some(pair) = best_pair(&counts) else { break };
        ids = merge(&ids, pair, next_id);
        merges.push((pair, next_id));
        next_id += 1;
    }
    merges
}

pub fn encode(text: &str, merges: &[((u32, u32), u32)]) -> Vec<u32> {
    let mut ids = to_ids(text);
    for &(pair, new_id) in merges {
        ids = merge(&ids, pair, new_id);
    }
    ids
}

pub fn build_vocab(merges: &[((u32, u32), u32)]) -> Vec<Vec<u8>> {
    let mut vocab: Vec<Vec<u8>> = (0..=255u32).map(|b| vec![b as u8]).collect();
    for &((a, b), _) in merges {
        let mut piece = vocab[a as usize].clone();
        piece.extend_from_slice(&vocab[b as usize]);
        vocab.push(piece);
    }
    vocab
}

pub fn decode(ids: &[u32], vocab: &[Vec<u8>]) -> String {
    let mut bytes = Vec::new();
    for &id in ids {
        bytes.extend_from_slice(&vocab[id as usize]);
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

pub fn run() -> (usize, usize) {
    let merges = train(CORPUS, 300);
    let vocab = build_vocab(&merges);

    for &((a, b), id) in &merges {
        println!("{id:4} <- ({a:3}, {b:3})  {:?}", decode(&[id], &vocab));
    }

    let tokens = encode(CORPUS, &merges);
    assert_eq!(decode(&tokens, &vocab), CORPUS);

    let bytes = CORPUS.len();
    let ratio = bytes as f64 / tokens.len();
    println!("{bytes} bytes -> {} tokens, {ratio:.2} bytes per token", tokens.len());
    (bytes, tokens.len())
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_corpus_round_trips_and_shrinks() {
        let (bytes, tokens) = run();
        assert_eq!(bytes, 430);
        assert_eq!(tokens, 248);
        assert!(bytes as f64 / tokens as f64 > 1.7);
    }

    #[test]
    fn everything_round_trips() {
        let merges = train(CORPUS, 300);
        let vocab = build_vocab(&merges);
        for text in ["", "a", CORPUS, HELD_OUT, SAMPLE, "café ☕ 🦀", "\u{0}\u{7f}\u{80}"] {
            assert_eq!(decode(&encode(text, &merges), &vocab), text);
        }
    }

    #[test]
    fn a_bigger_vocabulary_gives_fewer_tokens() {
        let small = encode(CORPUS, &train(CORPUS, 280)).len();
        let big = encode(CORPUS, &train(CORPUS, 300)).len();
        assert!(big < small);
        assert!(small < CORPUS.len());
    }
}
```

```solution
use std::collections::HashMap;

pub const SAMPLE: &str = "aaabdaaabac";

pub const CORPUS: &str = "Every language answers one question: when is it safe to free this memory? C makes you answer by hand and punishes mistakes. Java and Python refuse to answer and pay a collector to keep asking. Rust answers at compile time, and the price is that you say who owns what. Every value has one owner. When the owner goes out of scope, the value is dropped. Ownership can be given away, and afterwards the old binding is statically dead.";

pub const HELD_OUT: &str = "Every owner answers one question.";

pub fn to_ids(text: &str) -> Vec<u32> {
    text.as_bytes().iter().map(|&b| b as u32).collect()
}

pub fn count_pairs(ids: &[u32]) -> HashMap<(u32, u32), usize> {
    let mut counts: HashMap<(u32, u32), usize> = HashMap::new();
    for w in ids.windows(2) {
        *counts.entry((w[0], w[1])).or_insert(0) += 1;
    }
    counts
}

pub fn best_pair(counts: &HashMap<(u32, u32), usize>) -> Option<(u32, u32)> {
    counts
        .iter()
        .filter(|(_, n)| **n >= 2)
        .max_by_key(|(pair, n)| (**n, std::cmp::Reverse(**pair)))
        .map(|(pair, _)| *pair)
}

pub fn merge(ids: &[u32], pair: (u32, u32), new_id: u32) -> Vec<u32> {
    let mut out = Vec::with_capacity(ids.len());
    let mut i = 0;
    while i < ids.len() {
        if i + 1 < ids.len() && ids[i] == pair.0 && ids[i + 1] == pair.1 {
            out.push(new_id);
            i += 2;
        } else {
            out.push(ids[i]);
            i += 1;
        }
    }
    out
}

pub fn train(text: &str, vocab_size: usize) -> Vec<((u32, u32), u32)> {
    let mut ids = to_ids(text);
    let mut merges = Vec::new();
    let mut next_id = 256u32;

    while (next_id as usize) < vocab_size {
        let counts = count_pairs(&ids);
        let Some(pair) = best_pair(&counts) else { break };
        ids = merge(&ids, pair, next_id);
        merges.push((pair, next_id));
        next_id += 1;
    }
    merges
}

pub fn encode(text: &str, merges: &[((u32, u32), u32)]) -> Vec<u32> {
    let mut ids = to_ids(text);
    for &(pair, new_id) in merges {
        ids = merge(&ids, pair, new_id);
    }
    ids
}

pub fn build_vocab(merges: &[((u32, u32), u32)]) -> Vec<Vec<u8>> {
    let mut vocab: Vec<Vec<u8>> = (0..=255u32).map(|b| vec![b as u8]).collect();
    for &((a, b), _) in merges {
        let mut piece = vocab[a as usize].clone();
        piece.extend_from_slice(&vocab[b as usize]);
        vocab.push(piece);
    }
    vocab
}

pub fn decode(ids: &[u32], vocab: &[Vec<u8>]) -> String {
    let mut bytes = Vec::new();
    for &id in ids {
        bytes.extend_from_slice(&vocab[id as usize]);
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

pub fn run() -> (usize, usize) {
    let merges = train(CORPUS, 300);
    let vocab = build_vocab(&merges);

    for &((a, b), id) in &merges {
        println!("{id:4} <- ({a:3}, {b:3})  {:?}", decode(&[id], &vocab));
    }

    let tokens = encode(CORPUS, &merges);
    assert_eq!(decode(&tokens, &vocab), CORPUS);

    let bytes = CORPUS.len();
    let ratio = bytes as f64 / tokens.len() as f64;
    println!("{bytes} bytes -> {} tokens, {ratio:.2} bytes per token", tokens.len());
    (bytes, tokens.len())
}
```

@hint `bytes as f64` fixed the left side. The right side is still a `usize`.
@hint Division needs both operands to be the same type, and `f64 / usize` is not an implementation that exists.
@hint `bytes as f64 / tokens.len() as f64`.

@diagnose E0277
`cannot divide f64 by usize`, and underneath, `the trait Div<usize> is not
implemented for f64`.

Operators in Rust are trait methods. `a / b` is `Div::div(a, b)`, and the
standard library implements `Div<f64> for f64` along with the matching pair for
every other numeric type, but never a mixed one. So the compiler is not missing a
conversion, it is reporting that the function you called does not exist.

The reason there is no mixed implementation is that the result type would have to
be argued about, and integer to float conversion is lossy above 2^53. Rust makes
you say which side you meant. Cast both operands and the division is the ordinary
`f64` one.

@diagnose E0308
An `as f64` in the wrong place. `bytes as f64 / tokens.len()` casts only the left
operand, and `bytes / tokens.len() as f64` casts only the right. Both halves need
the cast, because `as` binds tighter than `/` but applies to just one operand.

@after
430 bytes become 248 tokens, about 1.73 bytes per token, from a vocabulary of
300 learned on that same paragraph. GPT-4's tokenizer gets roughly 4 bytes per
token on English, from 100,000 merges trained on a very large corpus. The shape
of the curve is the same: every merge buys a little less than the one before,
which is why vocabulary size is a tuning decision rather than a maximisation.

You now have a working byte-level BPE tokenizer in about a hundred lines. Three
things separate it from `tiktoken`, and none of them are in this algorithm.

A regex pre-tokenizer runs first, splitting text on word boundaries so that a
merge can never span a space and a letter. Without it, a corpus about ownership
learns `" and the"` as one token and wastes vocabulary on phrases. Special
tokens such as `<|endoftext|>` are assigned ids above the merged range and
matched before any merging happens, which is why they cannot be produced by
ordinary text. And GPT-2 maps each byte to a printable character before
training, purely so the vocabulary file is readable.

The counting loop is also the wrong shape for real data. Re-counting the whole
sequence for every merge is fine at 430 bytes and hopeless at a gigabyte, where
trainers keep pair counts in a heap and update only the neighbourhoods a merge
disturbed. Same answer, different arithmetic.
