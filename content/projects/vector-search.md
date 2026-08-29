---
project: vector-search
tier: core
domain: ai
title: A vector search index
accent: ferris
blurb: Build the retrieval half of a RAG system, from cosine similarity to an approximate index, and measure exactly what the approximation costs you.
needs: 11-collections, 13-generics, 17-iterators
mins: 75
---

Retrieval augmented generation has two halves. Everyone talks about the
generation. The half that decides whether the answer is any good is the other
one: given a question and a pile of documents, hand back the few passages that
actually bear on it. That is a search problem, and the trick that makes it
tractable is to stop treating text as text. Turn every passage into a vector of
numbers, turn the question into a vector the same way, and "find me documents
like this one" becomes "find the vectors closest to this one", which is
arithmetic.

The mapping from text to vector is the embedding. In production it is a neural
encoder: `text-embedding-3-small`, `bge-base`, `all-MiniLM`. None of those run
here, so stage 2 derives its vectors from the text directly, by hashing tokens
into buckets and counting. That is a real technique with a real name, the
hashing trick, and it was how large scale text classification worked before
transformers. It is also much worse than a neural encoder, because it can only
match words that literally appear in both texts.

Read that as the point rather than as a compromise. Every stage after the second
one takes a `&[f32]` and knows nothing about where it came from. Swap the body
of `embed` for a call to an encoder and the index, the ranking, the chunking and
the approximate search are unchanged. The interface between the model and the
retrieval system is one function returning a fixed length vector, and once you
have built the second half you can see exactly how small that interface is.

Eight stages: cosine similarity, hashed embeddings, a bounded heap for k nearest
neighbours, an index with add and search, inverse document frequency weighting
measured on a labelled set, chunking with overlap, an approximate index built
from random projections, and a final run that prints ranked results and the
recall the approximation costs. Everything is deterministic. The hash is
written out by hand, the random planes come from a fixed seed, and every tie in
the ranking is broken explicitly, so the numbers below are the numbers you will
see.

## 1. Cosine, and why not distance

@kind fix
@concept closure

@expect E0593

A document vector's length says how much text there was. Its direction says
what the text was about, and only the direction should decide whether two
documents match. Cosine similarity is the dot product divided by both lengths,
which cancels the magnitudes out. `dot` does not compile, because `zip` hands
its closure one thing, not two.

```starter
pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|x, y| x * y).sum()
}

pub fn norm(v: &[f32]) -> f32 {
    dot(v, v).sqrt()
}

pub fn normalise(v: &mut [f32]) {
    let n = norm(v);
    if n > 0.0 {
        for x in v.iter_mut() {
            *x /= n;
        }
    }
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let d = norm(a) * norm(b);
    if d == 0.0 { 0.0 } else { dot(a, b) / d }
}

pub fn euclidean(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| (x - y) * (x - y)).sum::<f32>().sqrt()
}

pub fn run() -> (f32, f32, f32) {
    let short = [2.0f32, 1.0, 0.0, 3.0];
    let twice = [4.0f32, 2.0, 0.0, 6.0];
    let other = [0.0f32, 3.0, 5.0, 0.0];

    println!("cosine(short, twice) = {:.3}", cosine(&short, &twice));
    println!("euclid(short, twice) = {:.3}", euclidean(&short, &twice));
    println!("cosine(short, other) = {:.3}", cosine(&short, &other));

    let mut a = short;
    let mut b = twice;
    normalise(&mut a);
    normalise(&mut b);
    println!("dot of the normalised pair = {:.3}", dot(&a, &b));

    (cosine(&short, &twice), euclidean(&short, &twice), cosine(&short, &other))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn length_changes_the_distance_but_not_the_angle() {
        let (same, dist, other) = run();
        assert!((same - 1.0).abs() < 1e-5, "{same}");
        assert!((dist - 3.741_657_5).abs() < 1e-4, "{dist}");
        assert!(other < 0.2, "{other}");
    }

    #[test]
    fn normalising_turns_cosine_into_a_dot_product() {
        let a = [1.0f32, 2.0, 3.0];
        let b = [4.0f32, 0.0, 1.0];
        let before = cosine(&a, &b);
        let (mut x, mut y) = (a, b);
        normalise(&mut x);
        normalise(&mut y);
        assert!((norm(&x) - 1.0).abs() < 1e-6);
        assert!((dot(&x, &y) - before).abs() < 1e-6);
    }

    #[test]
    fn a_zero_vector_has_no_direction_to_compare() {
        let mut zero = [0.0f32; 4];
        normalise(&mut zero);
        assert_eq!(zero, [0.0; 4]);
        assert_eq!(cosine(&zero, &[1.0, 2.0, 3.0, 4.0]), 0.0);
    }
}
```

```solution
pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

pub fn norm(v: &[f32]) -> f32 {
    dot(v, v).sqrt()
}

pub fn normalise(v: &mut [f32]) {
    let n = norm(v);
    if n > 0.0 {
        for x in v.iter_mut() {
            *x /= n;
        }
    }
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let d = norm(a) * norm(b);
    if d == 0.0 { 0.0 } else { dot(a, b) / d }
}

pub fn euclidean(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| (x - y) * (x - y)).sum::<f32>().sqrt()
}

pub fn run() -> (f32, f32, f32) {
    let short = [2.0f32, 1.0, 0.0, 3.0];
    let twice = [4.0f32, 2.0, 0.0, 6.0];
    let other = [0.0f32, 3.0, 5.0, 0.0];

    println!("cosine(short, twice) = {:.3}", cosine(&short, &twice));
    println!("euclid(short, twice) = {:.3}", euclidean(&short, &twice));
    println!("cosine(short, other) = {:.3}", cosine(&short, &other));

    let mut a = short;
    let mut b = twice;
    normalise(&mut a);
    normalise(&mut b);
    println!("dot of the normalised pair = {:.3}", dot(&a, &b));

    (cosine(&short, &twice), euclidean(&short, &twice), cosine(&short, &other))
}
```

@hint `zip` produces an iterator of pairs. One item per step, and that item happens to be a tuple.
@hint A closure taking `|x, y|` has two parameters. The item arriving is a single `(f32, f32)`.
@hint Destructure the tuple in the parameter list: `.map(|(x, y)| x * y)`.

@diagnose E0593
`closure is expected to take a single 2-tuple as argument, but it takes 2
distinct arguments`.

`Iterator::map` calls its closure with exactly one argument, the item. `zip`
makes that item a tuple, so what arrives is one `(&f32, &f32)`. Writing
`|x, y|` declares a closure of two parameters, and there is no call site that
would ever supply the second.

Some languages spread a tuple across parameters automatically. Rust does not,
because a closure's arity is part of the trait it implements, and `FnMut((A, B))`
is a different trait from `FnMut(A, B)`. The fix is to match on the tuple where
you bind it, which is what `|(x, y)|` does: one parameter, taken apart by
pattern.

@diagnose E0369
If you reached inside and wrote something like `x * y` where one side is a
reference and the other is not, rustc will say the operator is not implemented
for that pair. Arithmetic on `&f32` works when both sides are references or
neither is. Here the iterator hands out `&f32` on both sides, so the
multiplication is fine once the tuple is destructured.

@after
The output is the argument for cosine in three lines. `short` and `twice` are
the same document, one of them written out twice, and the euclidean distance
between them is 3.742 while the cosine is exactly 1.0. Distance sees a long
document and a short one as far apart even when they say the same thing, because
distance measures magnitude and magnitude here is just word count.

The last line matters for everything that follows. Once both vectors are
normalised, `norm(a) * norm(b)` is 1, so cosine collapses into a plain dot
product. Normalise once when the document is indexed and every later comparison
is a multiply and add over the whole vector, with no square roots. That is why
production indexes store unit vectors and never store the originals.

## 2. Text into a vector, by hashing

@kind fix
@concept cast

@expect E0308

Now the embedding. Split the text into lowercase word-shaped tokens, hash each
one, take the hash modulo `DIM` to pick a bucket, add one there, and normalise
at the end. No vocabulary is stored anywhere, which is the appeal: an unseen
word still lands in a bucket. The line that picks the bucket has the wrong
type.

```starter
pub const DIM: usize = 256;

pub fn hash64(token: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in token.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

pub fn tokens(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_ascii_lowercase())
        .collect()
}

pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

pub fn norm(v: &[f32]) -> f32 {
    dot(v, v).sqrt()
}

pub fn normalise(v: &mut [f32]) {
    let n = norm(v);
    if n > 0.0 {
        for x in v.iter_mut() {
            *x /= n;
        }
    }
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let d = norm(a) * norm(b);
    if d == 0.0 { 0.0 } else { dot(a, b) / d }
}

pub fn euclidean(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| (x - y) * (x - y)).sum::<f32>().sqrt()
}

pub fn embed(text: &str) -> Vec<f32> {
    let mut v = vec![0.0f32; DIM];
    for t in tokens(text) {
        let bucket: usize = hash64(&t) % DIM as u64;
        v[bucket] += 1.0;
    }
    normalise(&mut v);
    v
}

pub fn run() -> Vec<f32> {
    let a = embed("the owner of the value frees the memory");
    let b = embed("memory is freed when the owner goes out of scope");
    let c = embed("the sender grows its window until a packet is lost");

    for (name, v) in [("a", &a), ("b", &b), ("c", &c)] {
        println!("{name}: {} of {DIM} buckets used, norm {:.3}",
                 v.iter().filter(|x| **x != 0.0).count(), norm(v));
    }
    println!("cosine(a, b) = {:.3}", dot(&a, &b));
    println!("cosine(a, c) = {:.3}", dot(&a, &c));

    vec![dot(&a, &b), dot(&a, &c)]
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_hash_is_pinned_not_seeded() {
        assert_eq!(hash64(""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(hash64("memory"), 0x2e78_eb99_a161_2fee);
        assert_ne!(hash64("memory"), hash64("owner"));
    }

    #[test]
    fn tokenising_lowercases_and_drops_punctuation() {
        assert_eq!(tokens("The owner's value, dropped!"), ["the", "owner", "s", "value", "dropped"]);
        assert!(tokens("   ").is_empty());
    }

    #[test]
    fn related_text_scores_higher_and_the_result_is_stable() {
        let scores = run();
        assert!(scores[0] > scores[1], "{scores:?}");
        assert!(scores[0] > 0.4 && scores[1] < 0.4, "{scores:?}");

        let v = embed("the owner of the value frees the memory");
        assert_eq!(v.len(), DIM);
        assert!((norm(&v) - 1.0).abs() < 1e-5);
        assert_eq!(v, embed("the owner of the value frees the memory"));
        assert_eq!(embed(""), vec![0.0f32; DIM]);
    }
}
```

```solution
pub const DIM: usize = 256;

pub fn hash64(token: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in token.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

pub fn tokens(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_ascii_lowercase())
        .collect()
}

pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

pub fn norm(v: &[f32]) -> f32 {
    dot(v, v).sqrt()
}

pub fn normalise(v: &mut [f32]) {
    let n = norm(v);
    if n > 0.0 {
        for x in v.iter_mut() {
            *x /= n;
        }
    }
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let d = norm(a) * norm(b);
    if d == 0.0 { 0.0 } else { dot(a, b) / d }
}

pub fn euclidean(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| (x - y) * (x - y)).sum::<f32>().sqrt()
}

pub fn embed(text: &str) -> Vec<f32> {
    let mut v = vec![0.0f32; DIM];
    for t in tokens(text) {
        let bucket: usize = (hash64(&t) % DIM as u64) as usize;
        v[bucket] += 1.0;
    }
    normalise(&mut v);
    v
}

pub fn run() -> Vec<f32> {
    let a = embed("the owner of the value frees the memory");
    let b = embed("memory is freed when the owner goes out of scope");
    let c = embed("the sender grows its window until a packet is lost");

    for (name, v) in [("a", &a), ("b", &b), ("c", &c)] {
        println!("{name}: {} of {DIM} buckets used, norm {:.3}",
                 v.iter().filter(|x| **x != 0.0).count(), norm(v));
    }
    println!("cosine(a, b) = {:.3}", dot(&a, &b));
    println!("cosine(a, c) = {:.3}", dot(&a, &c));

    vec![dot(&a, &b), dot(&a, &c)]
}
```

@hint `hash64` returns `u64` and `DIM as u64` is a `u64`, so the remainder is a `u64` too. The binding asks for `usize`.
@hint Rust never widens or narrows an integer on its own, not even where the values would fit.
@hint `(hash64(&t) % DIM as u64) as usize`.

@diagnose E0308
`expected usize, found u64`, with the annotation on the binding underlined as
`expected due to this`.

`u64 % u64` is a `u64`. You asked for a `usize`, and although the two are the
same width on any machine that will run this, they are different types and Rust
converts between numeric types only where you write `as`. Indexing needs a
`usize` specifically, because that is the type `Index` for slices is implemented
for.

The order of the casts is worth reading carefully. `DIM as u64` widens the
modulus so the remainder happens in 64 bits; the outer `as usize` narrows the
result afterwards, which is safe because a remainder modulo `DIM` is smaller
than `DIM`. Cast the hash down to `usize` first instead and you would be
throwing away the top bits before taking the remainder.

@diagnose E0277
`cannot mod u64 by usize`, or `the trait Rem<usize> is not implemented for u64`.
Operators are trait methods, and the standard library implements each of them
only for matching pairs of numeric types. There is no mixed `u64 % usize`, so
one side has to be converted before the `%` runs.

@after
Two sentences about ownership score 0.507 against each other and 0.254 against
a sentence about TCP. That gap is the entire signal this project runs on.

Three details are doing work here. The hash is FNV-1a, written out by hand,
because `HashMap`'s default hasher is seeded randomly for each process and
`DefaultHasher`'s output is explicitly not guaranteed to stay the same between
Rust releases. An index built on Monday has to put "memory" in the same bucket
on Tuesday, so the hash function has to be part of your code. Tokens are
lowercased so that `Memory` and `memory` collide on purpose. And the vector is
normalised at the end, so a long passage and a short one about the same subject
are comparable.

Two different words landing in the same bucket is a real collision and it adds
noise. With `DIM` at 256 and a few hundred distinct words there will be plenty.
Production hashing tricks use 2^18 buckets or more, which makes collisions rare
enough to ignore.

## 3. k nearest, in a heap that stays small

@kind fix
@concept ord

@expect E0599

Scoring every document is unavoidable in an exact search, but sorting every
score is not. Keep a heap of the best `k` seen so far, push each new score, and
pop whenever the heap grows past `k`. For that the heap has to know which of two
`Scored` values is worse, and `Scored` has no ordering yet. Write one, and make
it break ties on the id so two equal scores always come back in the same
order.

```starter
use std::collections::BinaryHeap;

use std::cmp::Ordering;

pub const DIM: usize = 256;

pub fn hash64(token: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in token.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

pub fn tokens(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_ascii_lowercase())
        .collect()
}

pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

pub fn norm(v: &[f32]) -> f32 {
    dot(v, v).sqrt()
}

pub fn normalise(v: &mut [f32]) {
    let n = norm(v);
    if n > 0.0 {
        for x in v.iter_mut() {
            *x /= n;
        }
    }
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let d = norm(a) * norm(b);
    if d == 0.0 { 0.0 } else { dot(a, b) / d }
}

pub fn euclidean(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| (x - y) * (x - y)).sum::<f32>().sqrt()
}

pub fn embed(text: &str) -> Vec<f32> {
    let mut v = vec![0.0f32; DIM];
    for t in tokens(text) {
        let bucket: usize = (hash64(&t) % DIM as u64) as usize;
        v[bucket] += 1.0;
    }
    normalise(&mut v);
    v
}

#[derive(Debug, Clone, Copy)]
pub struct Scored {
    pub score: f32,
    pub id: usize,
}

pub fn top_k(query: &[f32], vecs: &[Vec<f32>], candidates: &[usize], k: usize) -> Vec<Scored> {
    let mut heap: BinaryHeap<Scored> = BinaryHeap::new();
    for &id in candidates {
        heap.push(Scored { score: dot(query, &vecs[id]), id });
        if heap.len() > k {
            heap.pop();
        }
    }
    heap.into_sorted_vec()
}

pub const SENTENCES: [&str; 5] = [
    "the owner of the value frees the memory when it goes out of scope",
    "a tracing collector frees memory once nobody can reach the object",
    "the sender grows its window until a packet is lost",
    "a hash table turns a key into a bucket number",
    "two threads writing the same memory at once is a data race",
];

pub fn run() -> Vec<usize> {
    let vecs: Vec<Vec<f32>> = SENTENCES.iter().map(|s| embed(s)).collect();
    let q = embed("when is it safe to free the memory");
    let all: Vec<usize> = (0..vecs.len()).collect();

    let hits = top_k(&q, &vecs, &all, 3);
    for h in &hits {
        println!("{:.3}  {}", h.score, SENTENCES[h.id]);
    }
    hits.iter().map(|h| h.id).collect()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_closest_sentence_comes_first() {
        assert_eq!(run(), vec![0, 4, 2]);
    }

    #[test]
    fn the_heap_never_grows_past_k() {
        let vecs: Vec<Vec<f32>> = (0..50).map(|i| vec![i as f32, 1.0]).collect();
        let all: Vec<usize> = (0..vecs.len()).collect();
        let hits = top_k(&[1.0, 0.0], &vecs, &all, 3);
        assert_eq!(hits.len(), 3);
        assert_eq!(hits.iter().map(|h| h.id).collect::<Vec<_>>(), vec![49, 48, 47]);
        assert!(hits[0].score > hits[1].score);
        assert_eq!(top_k(&[1.0, 0.0], &vecs, &[], 3).len(), 0);
    }

    #[test]
    fn a_tie_goes_to_the_lower_id() {
        let vecs = vec![vec![1.0f32, 0.0], vec![1.0, 0.0], vec![1.0, 0.0]];
        let hits = top_k(&[1.0, 0.0], &vecs, &[0, 1, 2], 2);
        assert_eq!(hits.iter().map(|h| h.id).collect::<Vec<_>>(), vec![0, 1]);
    }
}
```

```solution
use std::collections::BinaryHeap;

use std::cmp::Ordering;

pub const DIM: usize = 256;

pub fn hash64(token: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in token.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

pub fn tokens(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_ascii_lowercase())
        .collect()
}

pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

pub fn norm(v: &[f32]) -> f32 {
    dot(v, v).sqrt()
}

pub fn normalise(v: &mut [f32]) {
    let n = norm(v);
    if n > 0.0 {
        for x in v.iter_mut() {
            *x /= n;
        }
    }
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let d = norm(a) * norm(b);
    if d == 0.0 { 0.0 } else { dot(a, b) / d }
}

pub fn euclidean(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| (x - y) * (x - y)).sum::<f32>().sqrt()
}

pub fn embed(text: &str) -> Vec<f32> {
    let mut v = vec![0.0f32; DIM];
    for t in tokens(text) {
        let bucket: usize = (hash64(&t) % DIM as u64) as usize;
        v[bucket] += 1.0;
    }
    normalise(&mut v);
    v
}

#[derive(Debug, Clone, Copy)]
pub struct Scored {
    pub score: f32,
    pub id: usize,
}

impl Ord for Scored {
    fn cmp(&self, other: &Self) -> Ordering {
        other.score.total_cmp(&self.score).then(self.id.cmp(&other.id))
    }
}
impl PartialOrd for Scored {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> { Some(self.cmp(other)) }
}
impl PartialEq for Scored {
    fn eq(&self, other: &Self) -> bool { self.cmp(other) == Ordering::Equal }
}
impl Eq for Scored {}

pub fn top_k(query: &[f32], vecs: &[Vec<f32>], candidates: &[usize], k: usize) -> Vec<Scored> {
    let mut heap: BinaryHeap<Scored> = BinaryHeap::new();
    for &id in candidates {
        heap.push(Scored { score: dot(query, &vecs[id]), id });
        if heap.len() > k {
            heap.pop();
        }
    }
    heap.into_sorted_vec()
}

pub const SENTENCES: [&str; 5] = [
    "the owner of the value frees the memory when it goes out of scope",
    "a tracing collector frees memory once nobody can reach the object",
    "the sender grows its window until a packet is lost",
    "a hash table turns a key into a bucket number",
    "two threads writing the same memory at once is a data race",
];

pub fn run() -> Vec<usize> {
    let vecs: Vec<Vec<f32>> = SENTENCES.iter().map(|s| embed(s)).collect();
    let q = embed("when is it safe to free the memory");
    let all: Vec<usize> = (0..vecs.len()).collect();

    let hits = top_k(&q, &vecs, &all, 3);
    for h in &hits {
        println!("{:.3}  {}", h.score, SENTENCES[h.id]);
    }
    hits.iter().map(|h| h.id).collect()
}
```

@hint `BinaryHeap` is a max-heap and requires `T: Ord`. `f32` is only `PartialOrd`, because of NaN, so the ordering has to be written by hand.
@hint `f32::total_cmp` gives a total order over floats. Reverse it, so that the value the heap calls greatest is the one with the lowest score, and popping removes the worst.
@hint `impl Ord`, `impl PartialOrd`, `impl PartialEq` and `impl Eq`, with `cmp` as `other.score.total_cmp(&self.score).then(self.id.cmp(&other.id))`.

@diagnose E0599
`the method push exists for struct BinaryHeap<Scored>, but its trait bounds were
not satisfied`, and underneath it, `the trait Ord is not implemented for Scored`.

A binary heap compares elements on every push, so its methods are declared in an
`impl<T: Ord> BinaryHeap<T>` block. The type `BinaryHeap<Scored>` can be named
for any `T` at all; it is the methods that carry the bound. So the type checks
out and then the method vanishes, which is why rustc phrases this as a missing
method rather than a missing trait.

`Ord` means a total order: every pair compares one way or the other, the
relation is transitive, and it agrees with `Eq`. `f32` cannot promise that,
because NaN compares false against everything including itself, so the standard
library stops at `PartialOrd` for floats. That is why the scores are not simply
in a `BinaryHeap<(f32, usize)>`. Writing `Ord` over `total_cmp` by hand is you
promising what the compiler cannot check.

@diagnose E0277
`the trait bound Scored: Ord is not satisfied`, raised wherever the heap is
constructed or consumed. Same cause as above, reported from a different
position: `BinaryHeap::new` and `into_sorted_vec` are in the same bounded impl
block as `push`. Implementing all four of `Ord`, `PartialOrd`, `PartialEq` and
`Eq` clears every one of them at once, and they have to agree with each other,
which is why `PartialEq` here is written in terms of `cmp` rather than derived.

@diagnose E0284
If you wrote `partial_cmp` in terms of `cmp` and `cmp` in terms of `partial_cmp`,
rustc loses track of which implementation to pick. Only one of them should hold
the real logic. Put it in `cmp` and make `partial_cmp` return
`Some(self.cmp(other))`.

@after
The heap holds at most `k` items and the comparison is reversed, so the element
the heap calls greatest is the worst of the survivors, and that is exactly the
one `pop` removes. Cost is `n` pushes at `log k` each rather than a sort at
`n log n`. With a thousand documents and `k` of five, that is roughly 2,300
comparisons against 10,000.

`into_sorted_vec` then gives ascending order by this `Ord`, which because the
comparison is reversed means the highest score first.

The tie break is not decoration. Two chunks that share the same words score
identically to the last bit, and without `.then(self.id.cmp(&other.id))` the
order between them would depend on the order the heap happened to sift them,
which is stable but arbitrary and would change if you inserted a document
earlier in the corpus. An explicit tie break makes the ranking a function of the
data alone.

## 4. An index you can add to and search

@kind fix
@concept borrow

@expect E0596

Wrap the pieces in something worth calling a search index: a list of titles, the
documents themselves, and one vector per document, with `add` to put a document
in and `search` to ask a question. Twelve short documents on unrelated subjects
go in. `add` will not compile, and the reason is one character in its
signature.

```starter
use std::collections::BinaryHeap;

use std::cmp::Ordering;

pub const DIM: usize = 256;

pub fn hash64(token: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in token.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

pub fn tokens(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_ascii_lowercase())
        .collect()
}

pub const CORPUS: [(&str, &str); 12] = [
    ("ownership", "Every value in a Rust program has exactly one owner, and when that owner goes out of scope the value is dropped and its memory returned. Passing a value to a function moves it, so the old binding is dead and the compiler refuses to let you read it."),
    ("garbage collection", "A tracing garbage collector decides when memory can be freed by waiting until nobody is looking. It walks the graph of live objects from a set of roots and reclaims everything it did not reach. The cost is a pause while the walk happens and a heap larger than the data."),
    ("btree index", "A database index is a sorted structure that turns a scan of every row into a walk of a few pages. B-trees keep keys sorted and nodes wide, so each step down the tree reads one page. A query on an unindexed column has to look at every row."),
    ("http caching", "An HTTP cache stores a response so the next request for the same resource does not reach the origin server. The cache control header says how long the copy stays fresh, and an entity tag lets a client ask whether the copy it holds is still good."),
    ("congestion control", "TCP cannot see the state of the network, so it infers it from loss and delay. The sender grows its window until a packet goes missing, then cuts the window and grows again more slowly. Every connection sharing a link runs the same loop and they divide the bandwidth."),
    ("training a network", "Training a neural network means computing a loss over a batch of examples, taking the gradient of that loss with respect to every weight, and stepping the weights a small distance in the direction that reduces it. The learning rate sets how big that step is."),
    ("embeddings", "An embedding model maps a piece of text to a fixed length vector of numbers, arranged so texts about the same thing land near one another. Retrieval becomes geometry: embed the question, find the nearest document vectors, and hand those documents to whatever needs them."),
    ("hash tables", "A hash table turns a key into a bucket number and stores the entry there, so a lookup touches one bucket rather than the whole table. Two keys that land in the same bucket collide, and the table must keep both and compare them on the way out."),
    ("type checking", "A compiler checks types by walking the syntax tree and asking at every node whether the operation makes sense for the types of its parts. Where a type is not written down it is inferred from how the value is used. A program that passes cannot add a number to a function."),
    ("data races", "A data race happens when two threads touch the same memory at the same time and at least one of them is writing. The result is undefined behaviour and it usually will not reproduce. Rust allows either one writer or any number of readers to hold a reference, never both."),
    ("journalling", "A file system that writes a change straight to disk can be interrupted halfway and left inconsistent. A journal writes the intent first, in one place, and only then applies the change. After a crash the recovery pass replays the journal and every recorded operation is applied or absent."),
    ("cryptographic hashing", "A cryptographic hash function takes a message of any length and returns a short digest, such that finding two messages with the same digest is not feasible. Git names every object by the digest of its contents, so a repository can check that nothing was corrupted on disk."),
];

pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

pub fn norm(v: &[f32]) -> f32 {
    dot(v, v).sqrt()
}

pub fn normalise(v: &mut [f32]) {
    let n = norm(v);
    if n > 0.0 {
        for x in v.iter_mut() {
            *x /= n;
        }
    }
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let d = norm(a) * norm(b);
    if d == 0.0 { 0.0 } else { dot(a, b) / d }
}

pub fn euclidean(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| (x - y) * (x - y)).sum::<f32>().sqrt()
}

pub fn embed(text: &str) -> Vec<f32> {
    let mut v = vec![0.0f32; DIM];
    for t in tokens(text) {
        let bucket: usize = (hash64(&t) % DIM as u64) as usize;
        v[bucket] += 1.0;
    }
    normalise(&mut v);
    v
}

#[derive(Debug, Clone, Copy)]
pub struct Scored {
    pub score: f32,
    pub id: usize,
}

impl Ord for Scored {
    fn cmp(&self, other: &Self) -> Ordering {
        other.score.total_cmp(&self.score).then(self.id.cmp(&other.id))
    }
}
impl PartialOrd for Scored {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> { Some(self.cmp(other)) }
}
impl PartialEq for Scored {
    fn eq(&self, other: &Self) -> bool { self.cmp(other) == Ordering::Equal }
}
impl Eq for Scored {}

pub fn top_k(query: &[f32], vecs: &[Vec<f32>], candidates: &[usize], k: usize) -> Vec<Scored> {
    let mut heap: BinaryHeap<Scored> = BinaryHeap::new();
    for &id in candidates {
        heap.push(Scored { score: dot(query, &vecs[id]), id });
        if heap.len() > k {
            heap.pop();
        }
    }
    heap.into_sorted_vec()
}

pub struct Index {
    pub titles: Vec<String>,
    pub docs: Vec<String>,
    pub vecs: Vec<Vec<f32>>,
}

impl Index {
    pub fn new() -> Self {
        Index { titles: Vec::new(), docs: Vec::new(), vecs: Vec::new() }
    }

    pub fn add(&self, title: &str, text: &str) {
        self.vecs.push(embed(text));
        self.docs.push(text.to_string());
        self.titles.push(title.to_string());
    }

    pub fn search(&self, query: &str, k: usize) -> Vec<Scored> {
        let q = embed(query);
        let all: Vec<usize> = (0..self.vecs.len()).collect();
        top_k(&q, &self.vecs, &all, k)
    }
}

pub fn run() -> Vec<String> {
    let mut index = Index::new();
    for (title, text) in CORPUS {
        index.add(title, text);
    }
    println!("{} documents indexed", index.docs.len());

    let hits = index.search("what happens to the memory when the value goes out of scope", 3);
    for h in &hits {
        println!("{:.3}  [{}]", h.score, index.titles[h.id]);
    }
    hits.iter().map(|h| index.titles[h.id].clone()).collect()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_vector_per_document() {
        let mut index = Index::new();
        for (title, text) in CORPUS {
            index.add(title, text);
        }
        assert_eq!(index.vecs.len(), 12);
        assert_eq!(index.docs.len(), index.vecs.len());
        assert_eq!(index.titles.len(), index.vecs.len());
        assert!(index.vecs.iter().all(|v| (norm(v) - 1.0).abs() < 1e-5));
    }

    #[test]
    fn the_ownership_question_finds_the_ownership_document() {
        let titles = run();
        assert_eq!(titles.len(), 3);
        assert_eq!(titles[0], "ownership");
    }

    #[test]
    fn asking_for_more_than_there_is_returns_what_there_is() {
        let mut index = Index::new();
        index.add("only", "a hash table turns a key into a bucket number");
        assert_eq!(index.search("bucket", 5).len(), 1);
        assert_eq!(Index::new().search("bucket", 5).len(), 0);
    }
}
```

```solution
use std::collections::BinaryHeap;

use std::cmp::Ordering;

pub const DIM: usize = 256;

pub fn hash64(token: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in token.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

pub fn tokens(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_ascii_lowercase())
        .collect()
}

pub const CORPUS: [(&str, &str); 12] = [
    ("ownership", "Every value in a Rust program has exactly one owner, and when that owner goes out of scope the value is dropped and its memory returned. Passing a value to a function moves it, so the old binding is dead and the compiler refuses to let you read it."),
    ("garbage collection", "A tracing garbage collector decides when memory can be freed by waiting until nobody is looking. It walks the graph of live objects from a set of roots and reclaims everything it did not reach. The cost is a pause while the walk happens and a heap larger than the data."),
    ("btree index", "A database index is a sorted structure that turns a scan of every row into a walk of a few pages. B-trees keep keys sorted and nodes wide, so each step down the tree reads one page. A query on an unindexed column has to look at every row."),
    ("http caching", "An HTTP cache stores a response so the next request for the same resource does not reach the origin server. The cache control header says how long the copy stays fresh, and an entity tag lets a client ask whether the copy it holds is still good."),
    ("congestion control", "TCP cannot see the state of the network, so it infers it from loss and delay. The sender grows its window until a packet goes missing, then cuts the window and grows again more slowly. Every connection sharing a link runs the same loop and they divide the bandwidth."),
    ("training a network", "Training a neural network means computing a loss over a batch of examples, taking the gradient of that loss with respect to every weight, and stepping the weights a small distance in the direction that reduces it. The learning rate sets how big that step is."),
    ("embeddings", "An embedding model maps a piece of text to a fixed length vector of numbers, arranged so texts about the same thing land near one another. Retrieval becomes geometry: embed the question, find the nearest document vectors, and hand those documents to whatever needs them."),
    ("hash tables", "A hash table turns a key into a bucket number and stores the entry there, so a lookup touches one bucket rather than the whole table. Two keys that land in the same bucket collide, and the table must keep both and compare them on the way out."),
    ("type checking", "A compiler checks types by walking the syntax tree and asking at every node whether the operation makes sense for the types of its parts. Where a type is not written down it is inferred from how the value is used. A program that passes cannot add a number to a function."),
    ("data races", "A data race happens when two threads touch the same memory at the same time and at least one of them is writing. The result is undefined behaviour and it usually will not reproduce. Rust allows either one writer or any number of readers to hold a reference, never both."),
    ("journalling", "A file system that writes a change straight to disk can be interrupted halfway and left inconsistent. A journal writes the intent first, in one place, and only then applies the change. After a crash the recovery pass replays the journal and every recorded operation is applied or absent."),
    ("cryptographic hashing", "A cryptographic hash function takes a message of any length and returns a short digest, such that finding two messages with the same digest is not feasible. Git names every object by the digest of its contents, so a repository can check that nothing was corrupted on disk."),
];

pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

pub fn norm(v: &[f32]) -> f32 {
    dot(v, v).sqrt()
}

pub fn normalise(v: &mut [f32]) {
    let n = norm(v);
    if n > 0.0 {
        for x in v.iter_mut() {
            *x /= n;
        }
    }
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let d = norm(a) * norm(b);
    if d == 0.0 { 0.0 } else { dot(a, b) / d }
}

pub fn euclidean(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| (x - y) * (x - y)).sum::<f32>().sqrt()
}

pub fn embed(text: &str) -> Vec<f32> {
    let mut v = vec![0.0f32; DIM];
    for t in tokens(text) {
        let bucket: usize = (hash64(&t) % DIM as u64) as usize;
        v[bucket] += 1.0;
    }
    normalise(&mut v);
    v
}

#[derive(Debug, Clone, Copy)]
pub struct Scored {
    pub score: f32,
    pub id: usize,
}

impl Ord for Scored {
    fn cmp(&self, other: &Self) -> Ordering {
        other.score.total_cmp(&self.score).then(self.id.cmp(&other.id))
    }
}
impl PartialOrd for Scored {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> { Some(self.cmp(other)) }
}
impl PartialEq for Scored {
    fn eq(&self, other: &Self) -> bool { self.cmp(other) == Ordering::Equal }
}
impl Eq for Scored {}

pub fn top_k(query: &[f32], vecs: &[Vec<f32>], candidates: &[usize], k: usize) -> Vec<Scored> {
    let mut heap: BinaryHeap<Scored> = BinaryHeap::new();
    for &id in candidates {
        heap.push(Scored { score: dot(query, &vecs[id]), id });
        if heap.len() > k {
            heap.pop();
        }
    }
    heap.into_sorted_vec()
}

pub struct Index {
    pub titles: Vec<String>,
    pub docs: Vec<String>,
    pub vecs: Vec<Vec<f32>>,
}

impl Index {
    pub fn new() -> Self {
        Index { titles: Vec::new(), docs: Vec::new(), vecs: Vec::new() }
    }

    pub fn add(&mut self, title: &str, text: &str) {
        self.vecs.push(embed(text));
        self.docs.push(text.to_string());
        self.titles.push(title.to_string());
    }

    pub fn search(&self, query: &str, k: usize) -> Vec<Scored> {
        let q = embed(query);
        let all: Vec<usize> = (0..self.vecs.len()).collect();
        top_k(&q, &self.vecs, &all, k)
    }
}

pub fn run() -> Vec<String> {
    let mut index = Index::new();
    for (title, text) in CORPUS {
        index.add(title, text);
    }
    println!("{} documents indexed", index.docs.len());

    let hits = index.search("what happens to the memory when the value goes out of scope", 3);
    for h in &hits {
        println!("{:.3}  [{}]", h.score, index.titles[h.id]);
    }
    hits.iter().map(|h| index.titles[h.id].clone()).collect()
}
```

@hint `add` puts things into the index, so it changes the index.
@hint `&self` is a shared borrow and nothing reachable through it can be mutated. `push` needs a unique one.
@hint `pub fn add(&mut self, title: &str, text: &str)`.

@diagnose E0596
`cannot borrow self.vecs as mutable, as it is behind a & reference`, with a note
that `self` is a `&` reference and a suggestion to make it `&mut self`.

The receiver's type is the method's contract with every caller. `&self` says the
call cannot change anything, which means the compiler can allow several shared
borrows of the same index at once, and callers can rely on nothing moving under
them. `Vec::push` needs `&mut self` on the vector, and mutability does not
appear out of nowhere: it has to be threaded all the way from the caller who
owns the index.

This is the whole shared-versus-unique borrow rule showing up in a signature.
`search` really is `&self`, because it only reads, and keeping it that way means
several threads could search the same index at once without any locking.

@diagnose E0502
If you tried to fix this by borrowing `self` twice in the same expression, for
instance reading `self.docs` while pushing to `self.vecs` through a method call
on `self`, rustc reports the conflict. Borrows of distinct fields are fine when
they are written as field accesses; it is going through `&mut self` again while
a field borrow is alive that overlaps.

@after
Twelve documents, one vector each, and asking what happens to memory when a
value goes out of scope puts the ownership document on top at 0.528. Look at
what is second, though: congestion control at 0.407, which has nothing to do
with memory. It scores that high because it shares "the", "to", "a", "it" and
"of" with the question, and in a bag of words every word counts the same.

That is the flaw stage 5 fixes. Notice also that `search` returns `Vec<Scored>`
holding ids rather than references into the index. Returning `&str` borrowed
from `self` would work here and would tie the results' lifetime to the index,
which becomes awkward the moment you want to hold results while adding a
document. Ids are cheap and they stay valid across an ordinary borrow.

## 5. Weighting words by how rare they are

@kind fix
@concept iterator

@expect E0277

A word appearing in every document tells you nothing about which document you
want. Inverse document frequency turns that into a number: count how many
documents each word appears in, and weight the word by the log of the inverse.
`fit` then recomputes every vector with the weights applied. Measure the result
with mean reciprocal rank over eight labelled questions, before and after. The
weight formula does not compile.

```starter
use std::collections::{BinaryHeap, HashMap};

use std::cmp::Ordering;

pub const DIM: usize = 256;

pub fn hash64(token: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in token.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

pub fn tokens(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_ascii_lowercase())
        .collect()
}

pub const CORPUS: [(&str, &str); 12] = [
    ("ownership", "Every value in a Rust program has exactly one owner, and when that owner goes out of scope the value is dropped and its memory returned. Passing a value to a function moves it, so the old binding is dead and the compiler refuses to let you read it."),
    ("garbage collection", "A tracing garbage collector decides when memory can be freed by waiting until nobody is looking. It walks the graph of live objects from a set of roots and reclaims everything it did not reach. The cost is a pause while the walk happens and a heap larger than the data."),
    ("btree index", "A database index is a sorted structure that turns a scan of every row into a walk of a few pages. B-trees keep keys sorted and nodes wide, so each step down the tree reads one page. A query on an unindexed column has to look at every row."),
    ("http caching", "An HTTP cache stores a response so the next request for the same resource does not reach the origin server. The cache control header says how long the copy stays fresh, and an entity tag lets a client ask whether the copy it holds is still good."),
    ("congestion control", "TCP cannot see the state of the network, so it infers it from loss and delay. The sender grows its window until a packet goes missing, then cuts the window and grows again more slowly. Every connection sharing a link runs the same loop and they divide the bandwidth."),
    ("training a network", "Training a neural network means computing a loss over a batch of examples, taking the gradient of that loss with respect to every weight, and stepping the weights a small distance in the direction that reduces it. The learning rate sets how big that step is."),
    ("embeddings", "An embedding model maps a piece of text to a fixed length vector of numbers, arranged so texts about the same thing land near one another. Retrieval becomes geometry: embed the question, find the nearest document vectors, and hand those documents to whatever needs them."),
    ("hash tables", "A hash table turns a key into a bucket number and stores the entry there, so a lookup touches one bucket rather than the whole table. Two keys that land in the same bucket collide, and the table must keep both and compare them on the way out."),
    ("type checking", "A compiler checks types by walking the syntax tree and asking at every node whether the operation makes sense for the types of its parts. Where a type is not written down it is inferred from how the value is used. A program that passes cannot add a number to a function."),
    ("data races", "A data race happens when two threads touch the same memory at the same time and at least one of them is writing. The result is undefined behaviour and it usually will not reproduce. Rust allows either one writer or any number of readers to hold a reference, never both."),
    ("journalling", "A file system that writes a change straight to disk can be interrupted halfway and left inconsistent. A journal writes the intent first, in one place, and only then applies the change. After a crash the recovery pass replays the journal and every recorded operation is applied or absent."),
    ("cryptographic hashing", "A cryptographic hash function takes a message of any length and returns a short digest, such that finding two messages with the same digest is not feasible. Git names every object by the digest of its contents, so a repository can check that nothing was corrupted on disk."),
];

pub const QUERIES: [(&str, &str); 8] = [
    ("what happens to the memory when the value goes out of scope", "ownership"),
    ("why does a query on a column with no index have to look at every row", "btree index"),
    ("how big is the step that the weights take on each batch", "training a network"),
    ("what goes wrong when two threads write to the same place", "data races"),
    ("how does the sender decide how large to make its window", "congestion control"),
    ("how long does a cached copy of a response stay fresh", "http caching"),
    ("what happens when two keys land in the same bucket", "hash tables"),
    ("how does the system get back to a consistent state after a crash", "journalling"),
];

pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

pub fn norm(v: &[f32]) -> f32 {
    dot(v, v).sqrt()
}

pub fn normalise(v: &mut [f32]) {
    let n = norm(v);
    if n > 0.0 {
        for x in v.iter_mut() {
            *x /= n;
        }
    }
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let d = norm(a) * norm(b);
    if d == 0.0 { 0.0 } else { dot(a, b) / d }
}

pub fn euclidean(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| (x - y) * (x - y)).sum::<f32>().sqrt()
}

pub fn embed(text: &str, idf: &HashMap<String, f32>) -> Vec<f32> {
    let mut v = vec![0.0f32; DIM];
    for t in tokens(text) {
        let bucket: usize = (hash64(&t) % DIM as u64) as usize;
        v[bucket] += idf.get(&t).copied().unwrap_or(1.0);
    }
    normalise(&mut v);
    v
}

pub fn idf_table(docs: &[String]) -> HashMap<String, f32> {
    let n = docs.len() as f32;
    let mut df: HashMap<String, usize> = HashMap::new();
    for d in docs {
        let mut seen = tokens(d);
        seen.sort();
        seen.dedup();
        for t in seen {
            *df.entry(t).or_insert(0) += 1;
        }
    }
    df.into_iter()
        .map(|(t, c)| (t, ((n + 1.0) / (c + 1.0)).ln() + 1.0))
        .collect()
}

#[derive(Debug, Clone, Copy)]
pub struct Scored {
    pub score: f32,
    pub id: usize,
}

impl Ord for Scored {
    fn cmp(&self, other: &Self) -> Ordering {
        other.score.total_cmp(&self.score).then(self.id.cmp(&other.id))
    }
}
impl PartialOrd for Scored {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> { Some(self.cmp(other)) }
}
impl PartialEq for Scored {
    fn eq(&self, other: &Self) -> bool { self.cmp(other) == Ordering::Equal }
}
impl Eq for Scored {}

pub fn top_k(query: &[f32], vecs: &[Vec<f32>], candidates: &[usize], k: usize) -> Vec<Scored> {
    let mut heap: BinaryHeap<Scored> = BinaryHeap::new();
    for &id in candidates {
        heap.push(Scored { score: dot(query, &vecs[id]), id });
        if heap.len() > k {
            heap.pop();
        }
    }
    heap.into_sorted_vec()
}

pub struct Index {
    pub titles: Vec<String>,
    pub docs: Vec<String>,
    pub vecs: Vec<Vec<f32>>,
    pub idf: HashMap<String, f32>,
}

impl Index {
    pub fn new() -> Self {
        Index { titles: Vec::new(), docs: Vec::new(), vecs: Vec::new(), idf: HashMap::new() }
    }

    pub fn add(&mut self, title: &str, text: &str) {
        self.vecs.push(embed(text, &self.idf));
        self.docs.push(text.to_string());
        self.titles.push(title.to_string());
    }

    pub fn fit(&mut self) {
        self.idf = idf_table(&self.docs);
        let vecs: Vec<Vec<f32>> = self.docs.iter().map(|d| embed(d, &self.idf)).collect();
        self.vecs = vecs;
    }

    pub fn search(&self, query: &str, k: usize) -> Vec<Scored> {
        let q = embed(query, &self.idf);
        let all: Vec<usize> = (0..self.vecs.len()).collect();
        top_k(&q, &self.vecs, &all, k)
    }
}

pub fn mrr(index: &Index) -> f32 {
    let mut total = 0.0;
    for (query, want) in QUERIES {
        let hits = index.search(query, 10);
        if let Some(rank) = hits.iter().position(|h| index.titles[h.id] == want) {
            total += 1.0 / (rank as f32 + 1.0);
        }
    }
    total / QUERIES.len() as f32
}

pub fn run() -> (f32, f32) {
    let mut index = Index::new();
    for (title, text) in CORPUS {
        index.add(title, text);
    }
    let plain = mrr(&index);
    index.fit();
    let weighted = mrr(&index);

    for (query, want) in QUERIES {
        let hits = index.search(query, 3);
        println!("{:.3}  [{}] want [{want}]  {query}", hits[0].score, index.titles[hits[0].id]);
    }
    let mut ranked: Vec<(&String, &f32)> = index.idf.iter().collect();
    ranked.sort_by(|a, b| a.1.total_cmp(b.1).then(a.0.cmp(b.0)));
    println!("lowest weight: {:?}", &ranked[..5]);

    println!("mean reciprocal rank: counts {plain:.4}, idf weighted {weighted:.4}");
    (plain, weighted)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weighting_improves_the_ranking() {
        let (plain, weighted) = run();
        assert!(weighted > plain, "counts {plain}, idf {weighted}");
        assert!(weighted >= 0.99, "{weighted}");
        assert!(plain < 0.95, "{plain}");
    }

    #[test]
    fn a_word_in_every_document_carries_no_weight() {
        let docs: Vec<String> = CORPUS.iter().map(|(_, text)| text.to_string()).collect();
        let idf = idf_table(&docs);
        assert!((idf["the"] - 1.0).abs() < 1e-6, "{}", idf["the"]);
        assert!(idf["memory"] > idf["the"]);
        assert!(idf["window"] > idf["memory"]);
    }

    #[test]
    fn every_labelled_query_lands_on_its_document() {
        let mut index = Index::new();
        for (title, text) in CORPUS {
            index.add(title, text);
        }
        index.fit();
        for (query, want) in QUERIES {
            assert_eq!(index.titles[index.search(query, 1)[0].id], want, "{query}");
        }
    }
}
```

```solution
use std::collections::{BinaryHeap, HashMap};

use std::cmp::Ordering;

pub const DIM: usize = 256;

pub fn hash64(token: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in token.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

pub fn tokens(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_ascii_lowercase())
        .collect()
}

pub const CORPUS: [(&str, &str); 12] = [
    ("ownership", "Every value in a Rust program has exactly one owner, and when that owner goes out of scope the value is dropped and its memory returned. Passing a value to a function moves it, so the old binding is dead and the compiler refuses to let you read it."),
    ("garbage collection", "A tracing garbage collector decides when memory can be freed by waiting until nobody is looking. It walks the graph of live objects from a set of roots and reclaims everything it did not reach. The cost is a pause while the walk happens and a heap larger than the data."),
    ("btree index", "A database index is a sorted structure that turns a scan of every row into a walk of a few pages. B-trees keep keys sorted and nodes wide, so each step down the tree reads one page. A query on an unindexed column has to look at every row."),
    ("http caching", "An HTTP cache stores a response so the next request for the same resource does not reach the origin server. The cache control header says how long the copy stays fresh, and an entity tag lets a client ask whether the copy it holds is still good."),
    ("congestion control", "TCP cannot see the state of the network, so it infers it from loss and delay. The sender grows its window until a packet goes missing, then cuts the window and grows again more slowly. Every connection sharing a link runs the same loop and they divide the bandwidth."),
    ("training a network", "Training a neural network means computing a loss over a batch of examples, taking the gradient of that loss with respect to every weight, and stepping the weights a small distance in the direction that reduces it. The learning rate sets how big that step is."),
    ("embeddings", "An embedding model maps a piece of text to a fixed length vector of numbers, arranged so texts about the same thing land near one another. Retrieval becomes geometry: embed the question, find the nearest document vectors, and hand those documents to whatever needs them."),
    ("hash tables", "A hash table turns a key into a bucket number and stores the entry there, so a lookup touches one bucket rather than the whole table. Two keys that land in the same bucket collide, and the table must keep both and compare them on the way out."),
    ("type checking", "A compiler checks types by walking the syntax tree and asking at every node whether the operation makes sense for the types of its parts. Where a type is not written down it is inferred from how the value is used. A program that passes cannot add a number to a function."),
    ("data races", "A data race happens when two threads touch the same memory at the same time and at least one of them is writing. The result is undefined behaviour and it usually will not reproduce. Rust allows either one writer or any number of readers to hold a reference, never both."),
    ("journalling", "A file system that writes a change straight to disk can be interrupted halfway and left inconsistent. A journal writes the intent first, in one place, and only then applies the change. After a crash the recovery pass replays the journal and every recorded operation is applied or absent."),
    ("cryptographic hashing", "A cryptographic hash function takes a message of any length and returns a short digest, such that finding two messages with the same digest is not feasible. Git names every object by the digest of its contents, so a repository can check that nothing was corrupted on disk."),
];

pub const QUERIES: [(&str, &str); 8] = [
    ("what happens to the memory when the value goes out of scope", "ownership"),
    ("why does a query on a column with no index have to look at every row", "btree index"),
    ("how big is the step that the weights take on each batch", "training a network"),
    ("what goes wrong when two threads write to the same place", "data races"),
    ("how does the sender decide how large to make its window", "congestion control"),
    ("how long does a cached copy of a response stay fresh", "http caching"),
    ("what happens when two keys land in the same bucket", "hash tables"),
    ("how does the system get back to a consistent state after a crash", "journalling"),
];

pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

pub fn norm(v: &[f32]) -> f32 {
    dot(v, v).sqrt()
}

pub fn normalise(v: &mut [f32]) {
    let n = norm(v);
    if n > 0.0 {
        for x in v.iter_mut() {
            *x /= n;
        }
    }
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let d = norm(a) * norm(b);
    if d == 0.0 { 0.0 } else { dot(a, b) / d }
}

pub fn euclidean(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| (x - y) * (x - y)).sum::<f32>().sqrt()
}

pub fn embed(text: &str, idf: &HashMap<String, f32>) -> Vec<f32> {
    let mut v = vec![0.0f32; DIM];
    for t in tokens(text) {
        let bucket: usize = (hash64(&t) % DIM as u64) as usize;
        v[bucket] += idf.get(&t).copied().unwrap_or(1.0);
    }
    normalise(&mut v);
    v
}

pub fn idf_table(docs: &[String]) -> HashMap<String, f32> {
    let n = docs.len() as f32;
    let mut df: HashMap<String, usize> = HashMap::new();
    for d in docs {
        let mut seen = tokens(d);
        seen.sort();
        seen.dedup();
        for t in seen {
            *df.entry(t).or_insert(0) += 1;
        }
    }
    df.into_iter()
        .map(|(t, c)| (t, ((n + 1.0) / (c as f32 + 1.0)).ln() + 1.0))
        .collect()
}

#[derive(Debug, Clone, Copy)]
pub struct Scored {
    pub score: f32,
    pub id: usize,
}

impl Ord for Scored {
    fn cmp(&self, other: &Self) -> Ordering {
        other.score.total_cmp(&self.score).then(self.id.cmp(&other.id))
    }
}
impl PartialOrd for Scored {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> { Some(self.cmp(other)) }
}
impl PartialEq for Scored {
    fn eq(&self, other: &Self) -> bool { self.cmp(other) == Ordering::Equal }
}
impl Eq for Scored {}

pub fn top_k(query: &[f32], vecs: &[Vec<f32>], candidates: &[usize], k: usize) -> Vec<Scored> {
    let mut heap: BinaryHeap<Scored> = BinaryHeap::new();
    for &id in candidates {
        heap.push(Scored { score: dot(query, &vecs[id]), id });
        if heap.len() > k {
            heap.pop();
        }
    }
    heap.into_sorted_vec()
}

pub struct Index {
    pub titles: Vec<String>,
    pub docs: Vec<String>,
    pub vecs: Vec<Vec<f32>>,
    pub idf: HashMap<String, f32>,
}

impl Index {
    pub fn new() -> Self {
        Index { titles: Vec::new(), docs: Vec::new(), vecs: Vec::new(), idf: HashMap::new() }
    }

    pub fn add(&mut self, title: &str, text: &str) {
        self.vecs.push(embed(text, &self.idf));
        self.docs.push(text.to_string());
        self.titles.push(title.to_string());
    }

    pub fn fit(&mut self) {
        self.idf = idf_table(&self.docs);
        let vecs: Vec<Vec<f32>> = self.docs.iter().map(|d| embed(d, &self.idf)).collect();
        self.vecs = vecs;
    }

    pub fn search(&self, query: &str, k: usize) -> Vec<Scored> {
        let q = embed(query, &self.idf);
        let all: Vec<usize> = (0..self.vecs.len()).collect();
        top_k(&q, &self.vecs, &all, k)
    }
}

pub fn mrr(index: &Index) -> f32 {
    let mut total = 0.0;
    for (query, want) in QUERIES {
        let hits = index.search(query, 10);
        if let Some(rank) = hits.iter().position(|h| index.titles[h.id] == want) {
            total += 1.0 / (rank as f32 + 1.0);
        }
    }
    total / QUERIES.len() as f32
}

pub fn run() -> (f32, f32) {
    let mut index = Index::new();
    for (title, text) in CORPUS {
        index.add(title, text);
    }
    let plain = mrr(&index);
    index.fit();
    let weighted = mrr(&index);

    for (query, want) in QUERIES {
        let hits = index.search(query, 3);
        println!("{:.3}  [{}] want [{want}]  {query}", hits[0].score, index.titles[hits[0].id]);
    }
    let mut ranked: Vec<(&String, &f32)> = index.idf.iter().collect();
    ranked.sort_by(|a, b| a.1.total_cmp(b.1).then(a.0.cmp(b.0)));
    println!("lowest weight: {:?}", &ranked[..5]);

    println!("mean reciprocal rank: counts {plain:.4}, idf weighted {weighted:.4}");
    (plain, weighted)
}
```

@hint `c` is the document count for one token and it is a `usize`. The rest of that expression is floating point.
@hint There is no `usize + f32`. The conversion has to be written where the count is used.
@hint `(c as f32 + 1.0)`.

@diagnose E0277
`cannot add {float} to usize`, or `the trait bound usize: Add<f32> is not
satisfied`.

`+` is `Add::add`, and the standard library implements `Add<usize> for usize`
and `Add<f32> for f32` but never a pair that mixes them. So the compiler is not
failing to find a conversion, it is reporting that the function you called does
not exist.

Rust could have picked a rule here, and deliberately did not, because every
rule is wrong somewhere: integer to float is lossy above 2^24 for `f32`, and
float to integer has to decide about rounding and about values that do not fit.
Writing `c as f32` says which of those you accepted. The `+ 1.0` inside the
fraction and the `+ 1.0` outside the log are the standard smoothing, and they
keep the weight finite for a word in every document and above zero for a word
in one.

@diagnose E0308
An `as f32` in the wrong place. `as` binds tighter than the arithmetic around it
and applies to a single operand, so `c + 1.0 as f32` casts the literal, which
was already a float, and leaves the `usize` untouched. Put the cast directly on
`c`.

@after
Mean reciprocal rank goes from 0.9000 to 1.0000. Every one of the eight
questions now puts its document first; with plain counts, one of them had its
answer down at rank two.

The weights explain it. "the", "a" and "and" appear in all twelve documents and
come out at exactly 1.0, the floor of this formula. "memory" gets 2.18 and
"window" gets 2.87, so a question mentioning windows is pulled hard toward the
one document that talks about them. The formula is `ln((n + 1) / (df + 1)) + 1`,
the smoothed variant scikit-learn uses, which never divides by zero and never
returns a weight of zero for a word that is merely common.

Two things are worth being clear about. Eight labelled questions is a tiny
evaluation set, and the honest reading of "0.9 to 1.0" is "it helped on this
set", not a measurement with error bars. And `fit` has to run after the last
document is added, because idf depends on the whole corpus. Adding a document to
a fitted index leaves the weights slightly stale, which real systems live with
and repair on a schedule.

## 6. Chunking, because one vector cannot hold a page

@kind fix
@concept slice

@expect E0599

One vector for a whole document averages everything specific into mush: a page
covering four topics gets a vector that is close to nothing. Split each document
into overlapping windows of words and index those instead, keeping the source
title on each piece. The overlap exists so that a sentence spanning a boundary
still lands whole inside some chunk. `chunk` does not compile.

```starter
use std::collections::{BinaryHeap, HashMap};

use std::cmp::Ordering;

pub const DIM: usize = 256;

pub fn hash64(token: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in token.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

pub fn tokens(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_ascii_lowercase())
        .collect()
}

pub const CORPUS: [(&str, &str); 12] = [
    ("ownership", "Every value in a Rust program has exactly one owner, and when that owner goes out of scope the value is dropped and its memory returned. Passing a value to a function moves it, so the old binding is dead and the compiler refuses to let you read it."),
    ("garbage collection", "A tracing garbage collector decides when memory can be freed by waiting until nobody is looking. It walks the graph of live objects from a set of roots and reclaims everything it did not reach. The cost is a pause while the walk happens and a heap larger than the data."),
    ("btree index", "A database index is a sorted structure that turns a scan of every row into a walk of a few pages. B-trees keep keys sorted and nodes wide, so each step down the tree reads one page. A query on an unindexed column has to look at every row."),
    ("http caching", "An HTTP cache stores a response so the next request for the same resource does not reach the origin server. The cache control header says how long the copy stays fresh, and an entity tag lets a client ask whether the copy it holds is still good."),
    ("congestion control", "TCP cannot see the state of the network, so it infers it from loss and delay. The sender grows its window until a packet goes missing, then cuts the window and grows again more slowly. Every connection sharing a link runs the same loop and they divide the bandwidth."),
    ("training a network", "Training a neural network means computing a loss over a batch of examples, taking the gradient of that loss with respect to every weight, and stepping the weights a small distance in the direction that reduces it. The learning rate sets how big that step is."),
    ("embeddings", "An embedding model maps a piece of text to a fixed length vector of numbers, arranged so texts about the same thing land near one another. Retrieval becomes geometry: embed the question, find the nearest document vectors, and hand those documents to whatever needs them."),
    ("hash tables", "A hash table turns a key into a bucket number and stores the entry there, so a lookup touches one bucket rather than the whole table. Two keys that land in the same bucket collide, and the table must keep both and compare them on the way out."),
    ("type checking", "A compiler checks types by walking the syntax tree and asking at every node whether the operation makes sense for the types of its parts. Where a type is not written down it is inferred from how the value is used. A program that passes cannot add a number to a function."),
    ("data races", "A data race happens when two threads touch the same memory at the same time and at least one of them is writing. The result is undefined behaviour and it usually will not reproduce. Rust allows either one writer or any number of readers to hold a reference, never both."),
    ("journalling", "A file system that writes a change straight to disk can be interrupted halfway and left inconsistent. A journal writes the intent first, in one place, and only then applies the change. After a crash the recovery pass replays the journal and every recorded operation is applied or absent."),
    ("cryptographic hashing", "A cryptographic hash function takes a message of any length and returns a short digest, such that finding two messages with the same digest is not feasible. Git names every object by the digest of its contents, so a repository can check that nothing was corrupted on disk."),
];

pub const QUERIES: [(&str, &str); 8] = [
    ("what happens to the memory when the value goes out of scope", "ownership"),
    ("why does a query on a column with no index have to look at every row", "btree index"),
    ("how big is the step that the weights take on each batch", "training a network"),
    ("what goes wrong when two threads write to the same place", "data races"),
    ("how does the sender decide how large to make its window", "congestion control"),
    ("how long does a cached copy of a response stay fresh", "http caching"),
    ("what happens when two keys land in the same bucket", "hash tables"),
    ("how does the system get back to a consistent state after a crash", "journalling"),
];

pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

pub fn norm(v: &[f32]) -> f32 {
    dot(v, v).sqrt()
}

pub fn normalise(v: &mut [f32]) {
    let n = norm(v);
    if n > 0.0 {
        for x in v.iter_mut() {
            *x /= n;
        }
    }
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let d = norm(a) * norm(b);
    if d == 0.0 { 0.0 } else { dot(a, b) / d }
}

pub fn euclidean(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| (x - y) * (x - y)).sum::<f32>().sqrt()
}

pub fn embed(text: &str, idf: &HashMap<String, f32>) -> Vec<f32> {
    let mut v = vec![0.0f32; DIM];
    for t in tokens(text) {
        let bucket: usize = (hash64(&t) % DIM as u64) as usize;
        v[bucket] += idf.get(&t).copied().unwrap_or(1.0);
    }
    normalise(&mut v);
    v
}

pub fn idf_table(docs: &[String]) -> HashMap<String, f32> {
    let n = docs.len() as f32;
    let mut df: HashMap<String, usize> = HashMap::new();
    for d in docs {
        let mut seen = tokens(d);
        seen.sort();
        seen.dedup();
        for t in seen {
            *df.entry(t).or_insert(0) += 1;
        }
    }
    df.into_iter()
        .map(|(t, c)| (t, ((n + 1.0) / (c as f32 + 1.0)).ln() + 1.0))
        .collect()
}

pub fn chunk(text: &str, size: usize, overlap: usize) -> Vec<String> {
    let step = size - overlap;
    text.split_whitespace()
        .windows(size)
        .step_by(step)
        .map(|w| w.join(" "))
        .collect()
}

#[derive(Debug, Clone, Copy)]
pub struct Scored {
    pub score: f32,
    pub id: usize,
}

impl Ord for Scored {
    fn cmp(&self, other: &Self) -> Ordering {
        other.score.total_cmp(&self.score).then(self.id.cmp(&other.id))
    }
}
impl PartialOrd for Scored {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> { Some(self.cmp(other)) }
}
impl PartialEq for Scored {
    fn eq(&self, other: &Self) -> bool { self.cmp(other) == Ordering::Equal }
}
impl Eq for Scored {}

pub fn top_k(query: &[f32], vecs: &[Vec<f32>], candidates: &[usize], k: usize) -> Vec<Scored> {
    let mut heap: BinaryHeap<Scored> = BinaryHeap::new();
    for &id in candidates {
        heap.push(Scored { score: dot(query, &vecs[id]), id });
        if heap.len() > k {
            heap.pop();
        }
    }
    heap.into_sorted_vec()
}

pub struct Index {
    pub titles: Vec<String>,
    pub docs: Vec<String>,
    pub vecs: Vec<Vec<f32>>,
    pub idf: HashMap<String, f32>,
}

impl Index {
    pub fn new() -> Self {
        Index { titles: Vec::new(), docs: Vec::new(), vecs: Vec::new(), idf: HashMap::new() }
    }

    pub fn add(&mut self, title: &str, text: &str) {
        for piece in chunk(text, 24, 8) {
            self.vecs.push(embed(&piece, &self.idf));
            self.docs.push(piece);
            self.titles.push(title.to_string());
        }
    }

    pub fn fit(&mut self) {
        self.idf = idf_table(&self.docs);
        let vecs: Vec<Vec<f32>> = self.docs.iter().map(|d| embed(d, &self.idf)).collect();
        self.vecs = vecs;
    }

    pub fn search(&self, query: &str, k: usize) -> Vec<Scored> {
        let q = embed(query, &self.idf);
        let all: Vec<usize> = (0..self.vecs.len()).collect();
        top_k(&q, &self.vecs, &all, k)
    }
}

pub fn mrr(index: &Index) -> f32 {
    let mut total = 0.0;
    for (query, want) in QUERIES {
        let hits = index.search(query, 10);
        if let Some(rank) = hits.iter().position(|h| index.titles[h.id] == want) {
            total += 1.0 / (rank as f32 + 1.0);
        }
    }
    total / QUERIES.len() as f32
}

pub fn run() -> (usize, f32) {
    let mut index = Index::new();
    for (title, text) in CORPUS {
        index.add(title, text);
    }
    index.fit();
    println!("{} chunks from {} documents", index.docs.len(), CORPUS.len());

    let hits = index.search(QUERIES[4].0, 3);
    for h in &hits {
        println!("{:.3}  [{}] {}", h.score, index.titles[h.id], index.docs[h.id]);
    }
    let score = mrr(&index);
    println!("mean reciprocal rank over {} chunks: {score:.4}", index.docs.len());
    (index.docs.len(), score)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_overlap_and_cover_the_whole_text() {
        let text: String = (1..=50).map(|i| i.to_string()).collect::<Vec<_>>().join(" ");
        let pieces = chunk(&text, 24, 8);
        assert_eq!(pieces.len(), 3);
        assert!(pieces[0].starts_with("1 2 3"));
        assert!(pieces[1].starts_with("17 18"));
        assert!(pieces[2].ends_with("49 50"));
    }

    #[test]
    fn a_short_document_stays_in_one_piece() {
        assert_eq!(chunk("a b c", 24, 8), vec!["a b c"]);
        assert!(chunk("", 24, 8).is_empty());
    }

    #[test]
    fn chunking_keeps_every_query_on_target() {
        let (pieces, score) = run();
        assert_eq!(pieces, 36);
        assert!(score >= 0.99, "{score}");
    }
}
```

```solution
use std::collections::{BinaryHeap, HashMap};

use std::cmp::Ordering;

pub const DIM: usize = 256;

pub fn hash64(token: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in token.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

pub fn tokens(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_ascii_lowercase())
        .collect()
}

pub const CORPUS: [(&str, &str); 12] = [
    ("ownership", "Every value in a Rust program has exactly one owner, and when that owner goes out of scope the value is dropped and its memory returned. Passing a value to a function moves it, so the old binding is dead and the compiler refuses to let you read it."),
    ("garbage collection", "A tracing garbage collector decides when memory can be freed by waiting until nobody is looking. It walks the graph of live objects from a set of roots and reclaims everything it did not reach. The cost is a pause while the walk happens and a heap larger than the data."),
    ("btree index", "A database index is a sorted structure that turns a scan of every row into a walk of a few pages. B-trees keep keys sorted and nodes wide, so each step down the tree reads one page. A query on an unindexed column has to look at every row."),
    ("http caching", "An HTTP cache stores a response so the next request for the same resource does not reach the origin server. The cache control header says how long the copy stays fresh, and an entity tag lets a client ask whether the copy it holds is still good."),
    ("congestion control", "TCP cannot see the state of the network, so it infers it from loss and delay. The sender grows its window until a packet goes missing, then cuts the window and grows again more slowly. Every connection sharing a link runs the same loop and they divide the bandwidth."),
    ("training a network", "Training a neural network means computing a loss over a batch of examples, taking the gradient of that loss with respect to every weight, and stepping the weights a small distance in the direction that reduces it. The learning rate sets how big that step is."),
    ("embeddings", "An embedding model maps a piece of text to a fixed length vector of numbers, arranged so texts about the same thing land near one another. Retrieval becomes geometry: embed the question, find the nearest document vectors, and hand those documents to whatever needs them."),
    ("hash tables", "A hash table turns a key into a bucket number and stores the entry there, so a lookup touches one bucket rather than the whole table. Two keys that land in the same bucket collide, and the table must keep both and compare them on the way out."),
    ("type checking", "A compiler checks types by walking the syntax tree and asking at every node whether the operation makes sense for the types of its parts. Where a type is not written down it is inferred from how the value is used. A program that passes cannot add a number to a function."),
    ("data races", "A data race happens when two threads touch the same memory at the same time and at least one of them is writing. The result is undefined behaviour and it usually will not reproduce. Rust allows either one writer or any number of readers to hold a reference, never both."),
    ("journalling", "A file system that writes a change straight to disk can be interrupted halfway and left inconsistent. A journal writes the intent first, in one place, and only then applies the change. After a crash the recovery pass replays the journal and every recorded operation is applied or absent."),
    ("cryptographic hashing", "A cryptographic hash function takes a message of any length and returns a short digest, such that finding two messages with the same digest is not feasible. Git names every object by the digest of its contents, so a repository can check that nothing was corrupted on disk."),
];

pub const QUERIES: [(&str, &str); 8] = [
    ("what happens to the memory when the value goes out of scope", "ownership"),
    ("why does a query on a column with no index have to look at every row", "btree index"),
    ("how big is the step that the weights take on each batch", "training a network"),
    ("what goes wrong when two threads write to the same place", "data races"),
    ("how does the sender decide how large to make its window", "congestion control"),
    ("how long does a cached copy of a response stay fresh", "http caching"),
    ("what happens when two keys land in the same bucket", "hash tables"),
    ("how does the system get back to a consistent state after a crash", "journalling"),
];

pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

pub fn norm(v: &[f32]) -> f32 {
    dot(v, v).sqrt()
}

pub fn normalise(v: &mut [f32]) {
    let n = norm(v);
    if n > 0.0 {
        for x in v.iter_mut() {
            *x /= n;
        }
    }
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let d = norm(a) * norm(b);
    if d == 0.0 { 0.0 } else { dot(a, b) / d }
}

pub fn euclidean(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| (x - y) * (x - y)).sum::<f32>().sqrt()
}

pub fn embed(text: &str, idf: &HashMap<String, f32>) -> Vec<f32> {
    let mut v = vec![0.0f32; DIM];
    for t in tokens(text) {
        let bucket: usize = (hash64(&t) % DIM as u64) as usize;
        v[bucket] += idf.get(&t).copied().unwrap_or(1.0);
    }
    normalise(&mut v);
    v
}

pub fn idf_table(docs: &[String]) -> HashMap<String, f32> {
    let n = docs.len() as f32;
    let mut df: HashMap<String, usize> = HashMap::new();
    for d in docs {
        let mut seen = tokens(d);
        seen.sort();
        seen.dedup();
        for t in seen {
            *df.entry(t).or_insert(0) += 1;
        }
    }
    df.into_iter()
        .map(|(t, c)| (t, ((n + 1.0) / (c as f32 + 1.0)).ln() + 1.0))
        .collect()
}

pub fn chunk(text: &str, size: usize, overlap: usize) -> Vec<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let step = size - overlap;
    let mut out = Vec::new();
    let mut start = 0;
    while start < words.len() {
        let end = (start + size).min(words.len());
        out.push(words[start..end].join(" "));
        if end == words.len() {
            break;
        }
        start += step;
    }
    out
}

#[derive(Debug, Clone, Copy)]
pub struct Scored {
    pub score: f32,
    pub id: usize,
}

impl Ord for Scored {
    fn cmp(&self, other: &Self) -> Ordering {
        other.score.total_cmp(&self.score).then(self.id.cmp(&other.id))
    }
}
impl PartialOrd for Scored {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> { Some(self.cmp(other)) }
}
impl PartialEq for Scored {
    fn eq(&self, other: &Self) -> bool { self.cmp(other) == Ordering::Equal }
}
impl Eq for Scored {}

pub fn top_k(query: &[f32], vecs: &[Vec<f32>], candidates: &[usize], k: usize) -> Vec<Scored> {
    let mut heap: BinaryHeap<Scored> = BinaryHeap::new();
    for &id in candidates {
        heap.push(Scored { score: dot(query, &vecs[id]), id });
        if heap.len() > k {
            heap.pop();
        }
    }
    heap.into_sorted_vec()
}

pub struct Index {
    pub titles: Vec<String>,
    pub docs: Vec<String>,
    pub vecs: Vec<Vec<f32>>,
    pub idf: HashMap<String, f32>,
}

impl Index {
    pub fn new() -> Self {
        Index { titles: Vec::new(), docs: Vec::new(), vecs: Vec::new(), idf: HashMap::new() }
    }

    pub fn add(&mut self, title: &str, text: &str) {
        for piece in chunk(text, 24, 8) {
            self.vecs.push(embed(&piece, &self.idf));
            self.docs.push(piece);
            self.titles.push(title.to_string());
        }
    }

    pub fn fit(&mut self) {
        self.idf = idf_table(&self.docs);
        let vecs: Vec<Vec<f32>> = self.docs.iter().map(|d| embed(d, &self.idf)).collect();
        self.vecs = vecs;
    }

    pub fn search(&self, query: &str, k: usize) -> Vec<Scored> {
        let q = embed(query, &self.idf);
        let all: Vec<usize> = (0..self.vecs.len()).collect();
        top_k(&q, &self.vecs, &all, k)
    }
}

pub fn mrr(index: &Index) -> f32 {
    let mut total = 0.0;
    for (query, want) in QUERIES {
        let hits = index.search(query, 10);
        if let Some(rank) = hits.iter().position(|h| index.titles[h.id] == want) {
            total += 1.0 / (rank as f32 + 1.0);
        }
    }
    total / QUERIES.len() as f32
}

pub fn run() -> (usize, f32) {
    let mut index = Index::new();
    for (title, text) in CORPUS {
        index.add(title, text);
    }
    index.fit();
    println!("{} chunks from {} documents", index.docs.len(), CORPUS.len());

    let hits = index.search(QUERIES[4].0, 3);
    for h in &hits {
        println!("{:.3}  [{}] {}", h.score, index.titles[h.id], index.docs[h.id]);
    }
    let score = mrr(&index);
    println!("mean reciprocal rank over {} chunks: {score:.4}", index.docs.len());
    (index.docs.len(), score)
}
```

@hint `windows` is a method on slices, not on iterators. `split_whitespace` gives you an iterator.
@hint Collect the words into a `Vec<&str>` first. Then think about what `windows` does at the end of the text: it stops early rather than yielding a short final window.
@hint Walk `start` from 0 in steps of `size - overlap`, take `words[start..end]` with `end` clamped to the length, and stop once `end` reaches the end.

@diagnose E0599
`no method named windows found for struct SplitWhitespace in the current scope`.

`windows` belongs to `[T]`. A slice knows its length and its elements are laid
out contiguously, so handing out overlapping views into it costs nothing.
`SplitWhitespace` is a lazy iterator that has not looked at the rest of the
string yet, so it cannot hand you a window over items it has not produced.
`.collect::<Vec<&str>>()` first and the method appears.

There is a second reason not to use `windows` even then. It yields nothing at
all when the slice is shorter than the window, and it stops as soon as a full
window no longer fits, so the tail of every document would be silently dropped.
The loop keeps a short final chunk instead, which is why a three word document
survives.

@diagnose E0277
If you kept the iterator and reached for `step_by` or `chunks`, the error moves
to whichever bound is unmet. `chunks` is also a slice method, and it gives
adjacent pieces with no overlap, which is the thing this stage exists to
avoid.

@after
Twelve documents become 36 chunks of at most 24 words, each overlapping its
neighbour by 8, and the ranking still answers all eight questions at rank one.
More usefully, the top hit is now a passage rather than a document: the winning
chunk for the window question is the two sentences that actually mention
growing and cutting the window, not the whole TCP paragraph.

That is the point of chunking for retrieval augmented generation. What you hand
the model is what you retrieved, and a whole document spends the context budget
on paragraphs that are not about the question.

Size and overlap are a real tuning decision. Chunks that are too small lose the
context that makes a passage interpretable, and pronouns end up in a chunk with
no antecedent. Chunks that are too large go back to averaging. Real systems
chunk on sentence or heading boundaries rather than fixed word counts, keep an
overlap of ten to twenty percent, and often store the parent document alongside
so the model can be shown more than the matching passage.

## 7. An approximate index, and what it costs

@kind fix
@concept index

@expect E0507

Exact search reads every vector. To read fewer, give each vector a short code:
pick `PLANES` random hyperplanes through the origin and record which side of
each one the vector falls on. Vectors pointing in similar directions usually get
the same code. A search then scores only the buckets whose code is within
`radius` bits of the query's. Pulling a bucket out of the map does not
compile.

```starter
use std::collections::{BinaryHeap, HashMap};

use std::cmp::Ordering;

pub const DIM: usize = 256;

pub fn hash64(token: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in token.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

pub fn tokens(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_ascii_lowercase())
        .collect()
}

pub const PLANES: usize = 4;
pub const SEED: u64 = 0x2545_f491_4f6c_dd1d;

pub fn next_rand(state: &mut u64) -> f32 {
    *state = state.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
    (*state >> 33) as f32 / (1u32 << 31) as f32 * 2.0 - 1.0
}

pub fn make_planes() -> Vec<Vec<f32>> {
    let mut state = SEED;
    (0..PLANES)
        .map(|_| {
            let mut p: Vec<f32> = (0..DIM).map(|_| next_rand(&mut state)).collect();
            normalise(&mut p);
            p
        })
        .collect()
}

pub fn code_of(v: &[f32], planes: &[Vec<f32>]) -> u32 {
    let mut code = 0u32;
    for (i, p) in planes.iter().enumerate() {
        if dot(v, p) > 0.0 {
            code |= 1 << i;
        }
    }
    code
}

pub const CORPUS: [(&str, &str); 12] = [
    ("ownership", "Every value in a Rust program has exactly one owner, and when that owner goes out of scope the value is dropped and its memory returned. Passing a value to a function moves it, so the old binding is dead and the compiler refuses to let you read it."),
    ("garbage collection", "A tracing garbage collector decides when memory can be freed by waiting until nobody is looking. It walks the graph of live objects from a set of roots and reclaims everything it did not reach. The cost is a pause while the walk happens and a heap larger than the data."),
    ("btree index", "A database index is a sorted structure that turns a scan of every row into a walk of a few pages. B-trees keep keys sorted and nodes wide, so each step down the tree reads one page. A query on an unindexed column has to look at every row."),
    ("http caching", "An HTTP cache stores a response so the next request for the same resource does not reach the origin server. The cache control header says how long the copy stays fresh, and an entity tag lets a client ask whether the copy it holds is still good."),
    ("congestion control", "TCP cannot see the state of the network, so it infers it from loss and delay. The sender grows its window until a packet goes missing, then cuts the window and grows again more slowly. Every connection sharing a link runs the same loop and they divide the bandwidth."),
    ("training a network", "Training a neural network means computing a loss over a batch of examples, taking the gradient of that loss with respect to every weight, and stepping the weights a small distance in the direction that reduces it. The learning rate sets how big that step is."),
    ("embeddings", "An embedding model maps a piece of text to a fixed length vector of numbers, arranged so texts about the same thing land near one another. Retrieval becomes geometry: embed the question, find the nearest document vectors, and hand those documents to whatever needs them."),
    ("hash tables", "A hash table turns a key into a bucket number and stores the entry there, so a lookup touches one bucket rather than the whole table. Two keys that land in the same bucket collide, and the table must keep both and compare them on the way out."),
    ("type checking", "A compiler checks types by walking the syntax tree and asking at every node whether the operation makes sense for the types of its parts. Where a type is not written down it is inferred from how the value is used. A program that passes cannot add a number to a function."),
    ("data races", "A data race happens when two threads touch the same memory at the same time and at least one of them is writing. The result is undefined behaviour and it usually will not reproduce. Rust allows either one writer or any number of readers to hold a reference, never both."),
    ("journalling", "A file system that writes a change straight to disk can be interrupted halfway and left inconsistent. A journal writes the intent first, in one place, and only then applies the change. After a crash the recovery pass replays the journal and every recorded operation is applied or absent."),
    ("cryptographic hashing", "A cryptographic hash function takes a message of any length and returns a short digest, such that finding two messages with the same digest is not feasible. Git names every object by the digest of its contents, so a repository can check that nothing was corrupted on disk."),
];

pub const QUERIES: [(&str, &str); 8] = [
    ("what happens to the memory when the value goes out of scope", "ownership"),
    ("why does a query on a column with no index have to look at every row", "btree index"),
    ("how big is the step that the weights take on each batch", "training a network"),
    ("what goes wrong when two threads write to the same place", "data races"),
    ("how does the sender decide how large to make its window", "congestion control"),
    ("how long does a cached copy of a response stay fresh", "http caching"),
    ("what happens when two keys land in the same bucket", "hash tables"),
    ("how does the system get back to a consistent state after a crash", "journalling"),
];

pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

pub fn norm(v: &[f32]) -> f32 {
    dot(v, v).sqrt()
}

pub fn normalise(v: &mut [f32]) {
    let n = norm(v);
    if n > 0.0 {
        for x in v.iter_mut() {
            *x /= n;
        }
    }
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let d = norm(a) * norm(b);
    if d == 0.0 { 0.0 } else { dot(a, b) / d }
}

pub fn euclidean(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| (x - y) * (x - y)).sum::<f32>().sqrt()
}

pub fn embed(text: &str, idf: &HashMap<String, f32>) -> Vec<f32> {
    let mut v = vec![0.0f32; DIM];
    for t in tokens(text) {
        let bucket: usize = (hash64(&t) % DIM as u64) as usize;
        v[bucket] += idf.get(&t).copied().unwrap_or(1.0);
    }
    normalise(&mut v);
    v
}

pub fn idf_table(docs: &[String]) -> HashMap<String, f32> {
    let n = docs.len() as f32;
    let mut df: HashMap<String, usize> = HashMap::new();
    for d in docs {
        let mut seen = tokens(d);
        seen.sort();
        seen.dedup();
        for t in seen {
            *df.entry(t).or_insert(0) += 1;
        }
    }
    df.into_iter()
        .map(|(t, c)| (t, ((n + 1.0) / (c as f32 + 1.0)).ln() + 1.0))
        .collect()
}

pub fn chunk(text: &str, size: usize, overlap: usize) -> Vec<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let step = size - overlap;
    let mut out = Vec::new();
    let mut start = 0;
    while start < words.len() {
        let end = (start + size).min(words.len());
        out.push(words[start..end].join(" "));
        if end == words.len() {
            break;
        }
        start += step;
    }
    out
}

#[derive(Debug, Clone, Copy)]
pub struct Scored {
    pub score: f32,
    pub id: usize,
}

impl Ord for Scored {
    fn cmp(&self, other: &Self) -> Ordering {
        other.score.total_cmp(&self.score).then(self.id.cmp(&other.id))
    }
}
impl PartialOrd for Scored {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> { Some(self.cmp(other)) }
}
impl PartialEq for Scored {
    fn eq(&self, other: &Self) -> bool { self.cmp(other) == Ordering::Equal }
}
impl Eq for Scored {}

pub fn top_k(query: &[f32], vecs: &[Vec<f32>], candidates: &[usize], k: usize) -> Vec<Scored> {
    let mut heap: BinaryHeap<Scored> = BinaryHeap::new();
    for &id in candidates {
        heap.push(Scored { score: dot(query, &vecs[id]), id });
        if heap.len() > k {
            heap.pop();
        }
    }
    heap.into_sorted_vec()
}

pub struct Index {
    pub titles: Vec<String>,
    pub docs: Vec<String>,
    pub vecs: Vec<Vec<f32>>,
    pub idf: HashMap<String, f32>,
    pub planes: Vec<Vec<f32>>,
    pub buckets: HashMap<u32, Vec<usize>>,
}

impl Index {
    pub fn new() -> Self {
        Index { titles: Vec::new(), docs: Vec::new(), vecs: Vec::new(), idf: HashMap::new(), planes: make_planes(), buckets: HashMap::new() }
    }

    pub fn add(&mut self, title: &str, text: &str) {
        for piece in chunk(text, 24, 8) {
            self.vecs.push(embed(&piece, &self.idf));
            self.docs.push(piece);
            self.titles.push(title.to_string());
        }
    }

    pub fn fit(&mut self) {
        self.idf = idf_table(&self.docs);
        let vecs: Vec<Vec<f32>> = self.docs.iter().map(|d| embed(d, &self.idf)).collect();
        self.vecs = vecs;
        self.buckets = HashMap::new();
        for (i, v) in self.vecs.iter().enumerate() {
            self.buckets.entry(code_of(v, &self.planes)).or_default().push(i);
        }
    }

    pub fn search(&self, query: &str, k: usize) -> Vec<Scored> {
        let q = embed(query, &self.idf);
        let all: Vec<usize> = (0..self.vecs.len()).collect();
        top_k(&q, &self.vecs, &all, k)
    }

    pub fn search_approx(&self, query: &str, k: usize, radius: u32) -> (Vec<Scored>, usize) {
        let q = embed(query, &self.idf);
        let code = code_of(&q, &self.planes);
        let mut ids: Vec<usize> = Vec::new();
        for other in 0..(1u32 << PLANES) {
            if (code ^ other).count_ones() <= radius {
            let bucket = self.buckets[&other];
            ids.extend_from_slice(&bucket);
            }
        }
        (top_k(&q, &self.vecs, &ids, k), ids.len())
    }
}

pub fn mrr(index: &Index) -> f32 {
    let mut total = 0.0;
    for (query, want) in QUERIES {
        let hits = index.search(query, 10);
        if let Some(rank) = hits.iter().position(|h| index.titles[h.id] == want) {
            total += 1.0 / (rank as f32 + 1.0);
        }
    }
    total / QUERIES.len() as f32
}

pub fn run() -> Vec<(f32, usize)> {
    let mut index = Index::new();
    for (title, text) in CORPUS {
        index.add(title, text);
    }
    index.fit();

    let mut sizes: Vec<usize> = index.buckets.values().map(|b| b.len()).collect();
    sizes.sort();
    println!("{} chunks in {} buckets, sizes {sizes:?}", index.vecs.len(), index.buckets.len());

    let mut out = Vec::new();
    for radius in 0..3u32 {
        let mut recall = 0.0;
        let mut compared = 0;
        for (query, _) in QUERIES {
            let exact: Vec<usize> = index.search(query, 5).iter().map(|h| h.id).collect();
            let (approx, n) = index.search_approx(query, 5, radius);
            compared += n;
            recall += approx.iter().filter(|h| exact.contains(&h.id)).count() as f32 / 5.0;
        }
        let recall = recall / QUERIES.len() as f32;
        let compared = compared / QUERIES.len();
        println!("radius {radius}: recall {recall:.2}, compared {compared} of {}", index.vecs.len());
        out.push((recall, compared));
    }
    out
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_planes_are_the_same_on_every_run() {
        assert_eq!(make_planes(), make_planes());
        assert_eq!(make_planes().len(), PLANES);
        assert!((norm(&make_planes()[0]) - 1.0).abs() < 1e-5);
    }

    #[test]
    fn every_vector_lands_in_exactly_one_bucket() {
        let mut index = Index::new();
        for (title, text) in CORPUS {
            index.add(title, text);
        }
        index.fit();
        let total: usize = index.buckets.values().map(|b| b.len()).sum();
        assert_eq!(total, index.vecs.len());
        let (hits, seen) = index.search_approx(QUERIES[0].0, 5, PLANES as u32);
        assert_eq!(seen, index.vecs.len());
        assert_eq!(hits, index.search(QUERIES[0].0, 5));
    }

    #[test]
    fn a_wider_probe_costs_more_and_finds_more() {
        let curve = run();
        assert_eq!(curve.len(), 3);
        assert!(curve[0].0 < curve[1].0 && curve[1].0 < curve[2].0, "{curve:?}");
        assert!(curve[0].1 < curve[1].1 && curve[1].1 < curve[2].1, "{curve:?}");
        assert!(curve[2].1 < 36, "{curve:?}");
        assert!(curve[2].0 >= 0.6, "{curve:?}");
    }
}
```

```solution
use std::collections::{BinaryHeap, HashMap};

use std::cmp::Ordering;

pub const DIM: usize = 256;

pub fn hash64(token: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in token.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

pub fn tokens(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_ascii_lowercase())
        .collect()
}

pub const PLANES: usize = 4;
pub const SEED: u64 = 0x2545_f491_4f6c_dd1d;

pub fn next_rand(state: &mut u64) -> f32 {
    *state = state.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
    (*state >> 33) as f32 / (1u32 << 31) as f32 * 2.0 - 1.0
}

pub fn make_planes() -> Vec<Vec<f32>> {
    let mut state = SEED;
    (0..PLANES)
        .map(|_| {
            let mut p: Vec<f32> = (0..DIM).map(|_| next_rand(&mut state)).collect();
            normalise(&mut p);
            p
        })
        .collect()
}

pub fn code_of(v: &[f32], planes: &[Vec<f32>]) -> u32 {
    let mut code = 0u32;
    for (i, p) in planes.iter().enumerate() {
        if dot(v, p) > 0.0 {
            code |= 1 << i;
        }
    }
    code
}

pub const CORPUS: [(&str, &str); 12] = [
    ("ownership", "Every value in a Rust program has exactly one owner, and when that owner goes out of scope the value is dropped and its memory returned. Passing a value to a function moves it, so the old binding is dead and the compiler refuses to let you read it."),
    ("garbage collection", "A tracing garbage collector decides when memory can be freed by waiting until nobody is looking. It walks the graph of live objects from a set of roots and reclaims everything it did not reach. The cost is a pause while the walk happens and a heap larger than the data."),
    ("btree index", "A database index is a sorted structure that turns a scan of every row into a walk of a few pages. B-trees keep keys sorted and nodes wide, so each step down the tree reads one page. A query on an unindexed column has to look at every row."),
    ("http caching", "An HTTP cache stores a response so the next request for the same resource does not reach the origin server. The cache control header says how long the copy stays fresh, and an entity tag lets a client ask whether the copy it holds is still good."),
    ("congestion control", "TCP cannot see the state of the network, so it infers it from loss and delay. The sender grows its window until a packet goes missing, then cuts the window and grows again more slowly. Every connection sharing a link runs the same loop and they divide the bandwidth."),
    ("training a network", "Training a neural network means computing a loss over a batch of examples, taking the gradient of that loss with respect to every weight, and stepping the weights a small distance in the direction that reduces it. The learning rate sets how big that step is."),
    ("embeddings", "An embedding model maps a piece of text to a fixed length vector of numbers, arranged so texts about the same thing land near one another. Retrieval becomes geometry: embed the question, find the nearest document vectors, and hand those documents to whatever needs them."),
    ("hash tables", "A hash table turns a key into a bucket number and stores the entry there, so a lookup touches one bucket rather than the whole table. Two keys that land in the same bucket collide, and the table must keep both and compare them on the way out."),
    ("type checking", "A compiler checks types by walking the syntax tree and asking at every node whether the operation makes sense for the types of its parts. Where a type is not written down it is inferred from how the value is used. A program that passes cannot add a number to a function."),
    ("data races", "A data race happens when two threads touch the same memory at the same time and at least one of them is writing. The result is undefined behaviour and it usually will not reproduce. Rust allows either one writer or any number of readers to hold a reference, never both."),
    ("journalling", "A file system that writes a change straight to disk can be interrupted halfway and left inconsistent. A journal writes the intent first, in one place, and only then applies the change. After a crash the recovery pass replays the journal and every recorded operation is applied or absent."),
    ("cryptographic hashing", "A cryptographic hash function takes a message of any length and returns a short digest, such that finding two messages with the same digest is not feasible. Git names every object by the digest of its contents, so a repository can check that nothing was corrupted on disk."),
];

pub const QUERIES: [(&str, &str); 8] = [
    ("what happens to the memory when the value goes out of scope", "ownership"),
    ("why does a query on a column with no index have to look at every row", "btree index"),
    ("how big is the step that the weights take on each batch", "training a network"),
    ("what goes wrong when two threads write to the same place", "data races"),
    ("how does the sender decide how large to make its window", "congestion control"),
    ("how long does a cached copy of a response stay fresh", "http caching"),
    ("what happens when two keys land in the same bucket", "hash tables"),
    ("how does the system get back to a consistent state after a crash", "journalling"),
];

pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

pub fn norm(v: &[f32]) -> f32 {
    dot(v, v).sqrt()
}

pub fn normalise(v: &mut [f32]) {
    let n = norm(v);
    if n > 0.0 {
        for x in v.iter_mut() {
            *x /= n;
        }
    }
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let d = norm(a) * norm(b);
    if d == 0.0 { 0.0 } else { dot(a, b) / d }
}

pub fn euclidean(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| (x - y) * (x - y)).sum::<f32>().sqrt()
}

pub fn embed(text: &str, idf: &HashMap<String, f32>) -> Vec<f32> {
    let mut v = vec![0.0f32; DIM];
    for t in tokens(text) {
        let bucket: usize = (hash64(&t) % DIM as u64) as usize;
        v[bucket] += idf.get(&t).copied().unwrap_or(1.0);
    }
    normalise(&mut v);
    v
}

pub fn idf_table(docs: &[String]) -> HashMap<String, f32> {
    let n = docs.len() as f32;
    let mut df: HashMap<String, usize> = HashMap::new();
    for d in docs {
        let mut seen = tokens(d);
        seen.sort();
        seen.dedup();
        for t in seen {
            *df.entry(t).or_insert(0) += 1;
        }
    }
    df.into_iter()
        .map(|(t, c)| (t, ((n + 1.0) / (c as f32 + 1.0)).ln() + 1.0))
        .collect()
}

pub fn chunk(text: &str, size: usize, overlap: usize) -> Vec<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let step = size - overlap;
    let mut out = Vec::new();
    let mut start = 0;
    while start < words.len() {
        let end = (start + size).min(words.len());
        out.push(words[start..end].join(" "));
        if end == words.len() {
            break;
        }
        start += step;
    }
    out
}

#[derive(Debug, Clone, Copy)]
pub struct Scored {
    pub score: f32,
    pub id: usize,
}

impl Ord for Scored {
    fn cmp(&self, other: &Self) -> Ordering {
        other.score.total_cmp(&self.score).then(self.id.cmp(&other.id))
    }
}
impl PartialOrd for Scored {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> { Some(self.cmp(other)) }
}
impl PartialEq for Scored {
    fn eq(&self, other: &Self) -> bool { self.cmp(other) == Ordering::Equal }
}
impl Eq for Scored {}

pub fn top_k(query: &[f32], vecs: &[Vec<f32>], candidates: &[usize], k: usize) -> Vec<Scored> {
    let mut heap: BinaryHeap<Scored> = BinaryHeap::new();
    for &id in candidates {
        heap.push(Scored { score: dot(query, &vecs[id]), id });
        if heap.len() > k {
            heap.pop();
        }
    }
    heap.into_sorted_vec()
}

pub struct Index {
    pub titles: Vec<String>,
    pub docs: Vec<String>,
    pub vecs: Vec<Vec<f32>>,
    pub idf: HashMap<String, f32>,
    pub planes: Vec<Vec<f32>>,
    pub buckets: HashMap<u32, Vec<usize>>,
}

impl Index {
    pub fn new() -> Self {
        Index { titles: Vec::new(), docs: Vec::new(), vecs: Vec::new(), idf: HashMap::new(), planes: make_planes(), buckets: HashMap::new() }
    }

    pub fn add(&mut self, title: &str, text: &str) {
        for piece in chunk(text, 24, 8) {
            self.vecs.push(embed(&piece, &self.idf));
            self.docs.push(piece);
            self.titles.push(title.to_string());
        }
    }

    pub fn fit(&mut self) {
        self.idf = idf_table(&self.docs);
        let vecs: Vec<Vec<f32>> = self.docs.iter().map(|d| embed(d, &self.idf)).collect();
        self.vecs = vecs;
        self.buckets = HashMap::new();
        for (i, v) in self.vecs.iter().enumerate() {
            self.buckets.entry(code_of(v, &self.planes)).or_default().push(i);
        }
    }

    pub fn search(&self, query: &str, k: usize) -> Vec<Scored> {
        let q = embed(query, &self.idf);
        let all: Vec<usize> = (0..self.vecs.len()).collect();
        top_k(&q, &self.vecs, &all, k)
    }

    pub fn search_approx(&self, query: &str, k: usize, radius: u32) -> (Vec<Scored>, usize) {
        let q = embed(query, &self.idf);
        let code = code_of(&q, &self.planes);
        let mut ids: Vec<usize> = Vec::new();
        for other in 0..(1u32 << PLANES) {
            if (code ^ other).count_ones() <= radius {
            if let Some(bucket) = self.buckets.get(&other) {
                ids.extend_from_slice(bucket);
            }
            }
        }
        (top_k(&q, &self.vecs, &ids, k), ids.len())
    }
}

pub fn mrr(index: &Index) -> f32 {
    let mut total = 0.0;
    for (query, want) in QUERIES {
        let hits = index.search(query, 10);
        if let Some(rank) = hits.iter().position(|h| index.titles[h.id] == want) {
            total += 1.0 / (rank as f32 + 1.0);
        }
    }
    total / QUERIES.len() as f32
}

pub fn run() -> Vec<(f32, usize)> {
    let mut index = Index::new();
    for (title, text) in CORPUS {
        index.add(title, text);
    }
    index.fit();

    let mut sizes: Vec<usize> = index.buckets.values().map(|b| b.len()).collect();
    sizes.sort();
    println!("{} chunks in {} buckets, sizes {sizes:?}", index.vecs.len(), index.buckets.len());

    let mut out = Vec::new();
    for radius in 0..3u32 {
        let mut recall = 0.0;
        let mut compared = 0;
        for (query, _) in QUERIES {
            let exact: Vec<usize> = index.search(query, 5).iter().map(|h| h.id).collect();
            let (approx, n) = index.search_approx(query, 5, radius);
            compared += n;
            recall += approx.iter().filter(|h| exact.contains(&h.id)).count() as f32 / 5.0;
        }
        let recall = recall / QUERIES.len() as f32;
        let compared = compared / QUERIES.len();
        println!("radius {radius}: recall {recall:.2}, compared {compared} of {}", index.vecs.len());
        out.push((recall, compared));
    }
    out
}
```

@hint Indexing a `HashMap` gives you the value itself, and `Vec<usize>` is not `Copy`, so taking it by value would move it out of the map.
@hint You want to read the bucket, not own it. Also, most of the codes you are looping over have no bucket at all, so indexing would panic on them.
@hint `if let Some(bucket) = self.buckets.get(&other) { ids.extend_from_slice(bucket); }`.

@diagnose E0507
`cannot move out of index of HashMap<u32, Vec<usize>>`, with a note that
`Vec<usize>` does not implement `Copy`.

`map[&key]` desugars to `*map.index(&key)`, and `index` returns `&V`. The
dereference then tries to produce a `V` by value, which for a type that is not
`Copy` means moving it, and moving a value out of a map would leave the map with
a hole in it. The borrow checker refuses. For `HashMap<u32, u32>` the same line
compiles, because a `u32` is copied rather than moved, which is why this error
tends to surprise people who have only ever indexed maps of numbers.

Borrowing with `&self.buckets[&other]` would compile. It would also panic here,
because with `PLANES` at 4 there are 16 possible codes and only 11 of them have
any vectors. `get` returns `Option`, so the missing ones are handled rather than
fatal.

@diagnose E0502
If you built the bucket list by pushing into a vector borrowed from the map
while still holding the map's borrow, the two overlap. Copy the ids out with
`extend_from_slice`, which reads through the shared borrow and writes into a
vector the map knows nothing about.

@after
The 36 chunks fall into 11 of the 16 possible buckets, unevenly: sizes run from
1 to 9. Then the trade, measured over the eight labelled questions:

```text
radius 0: recall 0.12, compared  3 of 36
radius 1: recall 0.38, compared 13 of 36
radius 2: recall 0.70, compared 26 of 36
```

Recall here is the fraction of the true top five that the approximate search
also returned. At radius 1 it looks at about a third of the index and finds
about a third of the right answers. That is a bad trade, and saying so is the
point of measuring it.

Two honest reasons it is bad. The corpus has 36 vectors, and no index beats a
linear scan of 36 anything; random projection is built for the case where the
scan takes seconds. And the collision probability for two vectors under a random
hyperplane is `1 - theta / pi`, so it depends entirely on the angle between
them. These hashed bag-of-words vectors put a question about 65 degrees away
from its own answer, which gives roughly a 0.64 chance per plane of matching
bits, and four planes of that is a coin flip. A neural encoder that pulls the
same pair to 30 degrees would give 0.83 per plane and a far better curve for
identical code.

Which is the substitution argument again, from the other side. The approximate
index is not a fixed quality of the algorithm. It inherits the geometry the
embedding gives it.

## 8. A retrieval query, end to end

@kind fix
@concept move

@expect E0382

The last stage runs the whole thing: index twelve documents as 36 weighted
chunks, ask a question, print the ranked passages with their scores, then put
exact and approximate search side by side over all eight labelled questions.
Printing the results and then counting them does not compile, and the reason is
what a `for` loop does to the thing it loops over.

```starter
use std::collections::{BinaryHeap, HashMap};

use std::cmp::Ordering;

pub const DIM: usize = 256;

pub fn hash64(token: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in token.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

pub fn tokens(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_ascii_lowercase())
        .collect()
}

pub const PLANES: usize = 4;
pub const SEED: u64 = 0x2545_f491_4f6c_dd1d;

pub fn next_rand(state: &mut u64) -> f32 {
    *state = state.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
    (*state >> 33) as f32 / (1u32 << 31) as f32 * 2.0 - 1.0
}

pub fn make_planes() -> Vec<Vec<f32>> {
    let mut state = SEED;
    (0..PLANES)
        .map(|_| {
            let mut p: Vec<f32> = (0..DIM).map(|_| next_rand(&mut state)).collect();
            normalise(&mut p);
            p
        })
        .collect()
}

pub fn code_of(v: &[f32], planes: &[Vec<f32>]) -> u32 {
    let mut code = 0u32;
    for (i, p) in planes.iter().enumerate() {
        if dot(v, p) > 0.0 {
            code |= 1 << i;
        }
    }
    code
}

pub const CORPUS: [(&str, &str); 12] = [
    ("ownership", "Every value in a Rust program has exactly one owner, and when that owner goes out of scope the value is dropped and its memory returned. Passing a value to a function moves it, so the old binding is dead and the compiler refuses to let you read it."),
    ("garbage collection", "A tracing garbage collector decides when memory can be freed by waiting until nobody is looking. It walks the graph of live objects from a set of roots and reclaims everything it did not reach. The cost is a pause while the walk happens and a heap larger than the data."),
    ("btree index", "A database index is a sorted structure that turns a scan of every row into a walk of a few pages. B-trees keep keys sorted and nodes wide, so each step down the tree reads one page. A query on an unindexed column has to look at every row."),
    ("http caching", "An HTTP cache stores a response so the next request for the same resource does not reach the origin server. The cache control header says how long the copy stays fresh, and an entity tag lets a client ask whether the copy it holds is still good."),
    ("congestion control", "TCP cannot see the state of the network, so it infers it from loss and delay. The sender grows its window until a packet goes missing, then cuts the window and grows again more slowly. Every connection sharing a link runs the same loop and they divide the bandwidth."),
    ("training a network", "Training a neural network means computing a loss over a batch of examples, taking the gradient of that loss with respect to every weight, and stepping the weights a small distance in the direction that reduces it. The learning rate sets how big that step is."),
    ("embeddings", "An embedding model maps a piece of text to a fixed length vector of numbers, arranged so texts about the same thing land near one another. Retrieval becomes geometry: embed the question, find the nearest document vectors, and hand those documents to whatever needs them."),
    ("hash tables", "A hash table turns a key into a bucket number and stores the entry there, so a lookup touches one bucket rather than the whole table. Two keys that land in the same bucket collide, and the table must keep both and compare them on the way out."),
    ("type checking", "A compiler checks types by walking the syntax tree and asking at every node whether the operation makes sense for the types of its parts. Where a type is not written down it is inferred from how the value is used. A program that passes cannot add a number to a function."),
    ("data races", "A data race happens when two threads touch the same memory at the same time and at least one of them is writing. The result is undefined behaviour and it usually will not reproduce. Rust allows either one writer or any number of readers to hold a reference, never both."),
    ("journalling", "A file system that writes a change straight to disk can be interrupted halfway and left inconsistent. A journal writes the intent first, in one place, and only then applies the change. After a crash the recovery pass replays the journal and every recorded operation is applied or absent."),
    ("cryptographic hashing", "A cryptographic hash function takes a message of any length and returns a short digest, such that finding two messages with the same digest is not feasible. Git names every object by the digest of its contents, so a repository can check that nothing was corrupted on disk."),
];

pub const QUERIES: [(&str, &str); 8] = [
    ("what happens to the memory when the value goes out of scope", "ownership"),
    ("why does a query on a column with no index have to look at every row", "btree index"),
    ("how big is the step that the weights take on each batch", "training a network"),
    ("what goes wrong when two threads write to the same place", "data races"),
    ("how does the sender decide how large to make its window", "congestion control"),
    ("how long does a cached copy of a response stay fresh", "http caching"),
    ("what happens when two keys land in the same bucket", "hash tables"),
    ("how does the system get back to a consistent state after a crash", "journalling"),
];

pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

pub fn norm(v: &[f32]) -> f32 {
    dot(v, v).sqrt()
}

pub fn normalise(v: &mut [f32]) {
    let n = norm(v);
    if n > 0.0 {
        for x in v.iter_mut() {
            *x /= n;
        }
    }
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let d = norm(a) * norm(b);
    if d == 0.0 { 0.0 } else { dot(a, b) / d }
}

pub fn euclidean(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| (x - y) * (x - y)).sum::<f32>().sqrt()
}

pub fn embed(text: &str, idf: &HashMap<String, f32>) -> Vec<f32> {
    let mut v = vec![0.0f32; DIM];
    for t in tokens(text) {
        let bucket: usize = (hash64(&t) % DIM as u64) as usize;
        v[bucket] += idf.get(&t).copied().unwrap_or(1.0);
    }
    normalise(&mut v);
    v
}

pub fn idf_table(docs: &[String]) -> HashMap<String, f32> {
    let n = docs.len() as f32;
    let mut df: HashMap<String, usize> = HashMap::new();
    for d in docs {
        let mut seen = tokens(d);
        seen.sort();
        seen.dedup();
        for t in seen {
            *df.entry(t).or_insert(0) += 1;
        }
    }
    df.into_iter()
        .map(|(t, c)| (t, ((n + 1.0) / (c as f32 + 1.0)).ln() + 1.0))
        .collect()
}

pub fn chunk(text: &str, size: usize, overlap: usize) -> Vec<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let step = size - overlap;
    let mut out = Vec::new();
    let mut start = 0;
    while start < words.len() {
        let end = (start + size).min(words.len());
        out.push(words[start..end].join(" "));
        if end == words.len() {
            break;
        }
        start += step;
    }
    out
}

#[derive(Debug, Clone, Copy)]
pub struct Scored {
    pub score: f32,
    pub id: usize,
}

impl Ord for Scored {
    fn cmp(&self, other: &Self) -> Ordering {
        other.score.total_cmp(&self.score).then(self.id.cmp(&other.id))
    }
}
impl PartialOrd for Scored {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> { Some(self.cmp(other)) }
}
impl PartialEq for Scored {
    fn eq(&self, other: &Self) -> bool { self.cmp(other) == Ordering::Equal }
}
impl Eq for Scored {}

pub fn top_k(query: &[f32], vecs: &[Vec<f32>], candidates: &[usize], k: usize) -> Vec<Scored> {
    let mut heap: BinaryHeap<Scored> = BinaryHeap::new();
    for &id in candidates {
        heap.push(Scored { score: dot(query, &vecs[id]), id });
        if heap.len() > k {
            heap.pop();
        }
    }
    heap.into_sorted_vec()
}

pub struct Index {
    pub titles: Vec<String>,
    pub docs: Vec<String>,
    pub vecs: Vec<Vec<f32>>,
    pub idf: HashMap<String, f32>,
    pub planes: Vec<Vec<f32>>,
    pub buckets: HashMap<u32, Vec<usize>>,
}

impl Index {
    pub fn new() -> Self {
        Index { titles: Vec::new(), docs: Vec::new(), vecs: Vec::new(), idf: HashMap::new(), planes: make_planes(), buckets: HashMap::new() }
    }

    pub fn add(&mut self, title: &str, text: &str) {
        for piece in chunk(text, 24, 8) {
            self.vecs.push(embed(&piece, &self.idf));
            self.docs.push(piece);
            self.titles.push(title.to_string());
        }
    }

    pub fn fit(&mut self) {
        self.idf = idf_table(&self.docs);
        let vecs: Vec<Vec<f32>> = self.docs.iter().map(|d| embed(d, &self.idf)).collect();
        self.vecs = vecs;
        self.buckets = HashMap::new();
        for (i, v) in self.vecs.iter().enumerate() {
            self.buckets.entry(code_of(v, &self.planes)).or_default().push(i);
        }
    }

    pub fn search(&self, query: &str, k: usize) -> Vec<Scored> {
        let q = embed(query, &self.idf);
        let all: Vec<usize> = (0..self.vecs.len()).collect();
        top_k(&q, &self.vecs, &all, k)
    }

    pub fn search_approx(&self, query: &str, k: usize, radius: u32) -> (Vec<Scored>, usize) {
        let q = embed(query, &self.idf);
        let code = code_of(&q, &self.planes);
        let mut ids: Vec<usize> = Vec::new();
        for other in 0..(1u32 << PLANES) {
            if (code ^ other).count_ones() <= radius {
            if let Some(bucket) = self.buckets.get(&other) {
                ids.extend_from_slice(bucket);
            }
            }
        }
        (top_k(&q, &self.vecs, &ids, k), ids.len())
    }
}

pub fn mrr(index: &Index) -> f32 {
    let mut total = 0.0;
    for (query, want) in QUERIES {
        let hits = index.search(query, 10);
        if let Some(rank) = hits.iter().position(|h| index.titles[h.id] == want) {
            total += 1.0 / (rank as f32 + 1.0);
        }
    }
    total / QUERIES.len() as f32
}

pub fn run() -> (String, f32, usize) {
    let mut index = Index::new();
    for (title, text) in CORPUS {
        index.add(title, text);
    }
    index.fit();
    println!("{} chunks, {} buckets\n", index.vecs.len(), index.buckets.len());

    let question = "how does the sender decide how large to make its window";
    println!("query: {question}\n");
    let hits = index.search(question, 5);
    for h in hits {
        println!("  {:.3}  [{}]  {}", h.score, index.titles[h.id], index.docs[h.id]);
    }
    println!("\n{} results returned", hits.len());

    let mut recall = 0.0;
    let mut compared = 0;
    println!("\nexact against approximate, radius 1, k = 5");
    for (query, want) in QUERIES {
        let exact: Vec<usize> = index.search(query, 5).iter().map(|h| h.id).collect();
        let (approx, n) = index.search_approx(query, 5, 1);
        let shared = approx.iter().filter(|h| exact.contains(&h.id)).count();
        compared += n;
        recall += shared as f32 / 5.0;
        println!("  {:.2}  {n:2} of {} compared  [{want}]  {query}", shared as f32 / 5.0, index.vecs.len());
    }
    let recall = recall / QUERIES.len() as f32;
    let compared = compared / QUERIES.len();
    println!("\nmean recall@5 {recall:.2}, {compared} of {} vectors compared per query",
             index.vecs.len());
    println!("mean reciprocal rank of the exact search: {:.4}", mrr(&index));

    let top = index.titles[hits[0].id].clone();
    (top, recall, compared)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_retrieval_query_returns_the_right_passage() {
        let (top, recall, compared) = run();
        assert_eq!(top, "congestion control");
        assert!(compared < 18, "{compared}");
        assert!(recall > 0.2 && recall < 1.0, "{recall}");
    }

    #[test]
    fn exact_search_answers_every_labelled_query() {
        let mut index = Index::new();
        for (title, text) in CORPUS {
            index.add(title, text);
        }
        index.fit();
        for (query, want) in QUERIES {
            assert_eq!(index.titles[index.search(query, 1)[0].id], want, "{query}");
        }
        assert!((mrr(&index) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn the_approximate_index_never_beats_the_exact_one() {
        let mut index = Index::new();
        for (title, text) in CORPUS {
            index.add(title, text);
        }
        index.fit();
        for (query, _) in QUERIES {
            let exact = index.search(query, 5);
            let (approx, seen) = index.search_approx(query, 5, 1);
            assert!(seen <= index.vecs.len());
            if let Some(best) = approx.first() {
                assert!(best.score <= exact[0].score + 1e-6, "{query}");
            }
        }
    }
}
```

```solution
use std::collections::{BinaryHeap, HashMap};

use std::cmp::Ordering;

pub const DIM: usize = 256;

pub fn hash64(token: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in token.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

pub fn tokens(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_ascii_lowercase())
        .collect()
}

pub const PLANES: usize = 4;
pub const SEED: u64 = 0x2545_f491_4f6c_dd1d;

pub fn next_rand(state: &mut u64) -> f32 {
    *state = state.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
    (*state >> 33) as f32 / (1u32 << 31) as f32 * 2.0 - 1.0
}

pub fn make_planes() -> Vec<Vec<f32>> {
    let mut state = SEED;
    (0..PLANES)
        .map(|_| {
            let mut p: Vec<f32> = (0..DIM).map(|_| next_rand(&mut state)).collect();
            normalise(&mut p);
            p
        })
        .collect()
}

pub fn code_of(v: &[f32], planes: &[Vec<f32>]) -> u32 {
    let mut code = 0u32;
    for (i, p) in planes.iter().enumerate() {
        if dot(v, p) > 0.0 {
            code |= 1 << i;
        }
    }
    code
}

pub const CORPUS: [(&str, &str); 12] = [
    ("ownership", "Every value in a Rust program has exactly one owner, and when that owner goes out of scope the value is dropped and its memory returned. Passing a value to a function moves it, so the old binding is dead and the compiler refuses to let you read it."),
    ("garbage collection", "A tracing garbage collector decides when memory can be freed by waiting until nobody is looking. It walks the graph of live objects from a set of roots and reclaims everything it did not reach. The cost is a pause while the walk happens and a heap larger than the data."),
    ("btree index", "A database index is a sorted structure that turns a scan of every row into a walk of a few pages. B-trees keep keys sorted and nodes wide, so each step down the tree reads one page. A query on an unindexed column has to look at every row."),
    ("http caching", "An HTTP cache stores a response so the next request for the same resource does not reach the origin server. The cache control header says how long the copy stays fresh, and an entity tag lets a client ask whether the copy it holds is still good."),
    ("congestion control", "TCP cannot see the state of the network, so it infers it from loss and delay. The sender grows its window until a packet goes missing, then cuts the window and grows again more slowly. Every connection sharing a link runs the same loop and they divide the bandwidth."),
    ("training a network", "Training a neural network means computing a loss over a batch of examples, taking the gradient of that loss with respect to every weight, and stepping the weights a small distance in the direction that reduces it. The learning rate sets how big that step is."),
    ("embeddings", "An embedding model maps a piece of text to a fixed length vector of numbers, arranged so texts about the same thing land near one another. Retrieval becomes geometry: embed the question, find the nearest document vectors, and hand those documents to whatever needs them."),
    ("hash tables", "A hash table turns a key into a bucket number and stores the entry there, so a lookup touches one bucket rather than the whole table. Two keys that land in the same bucket collide, and the table must keep both and compare them on the way out."),
    ("type checking", "A compiler checks types by walking the syntax tree and asking at every node whether the operation makes sense for the types of its parts. Where a type is not written down it is inferred from how the value is used. A program that passes cannot add a number to a function."),
    ("data races", "A data race happens when two threads touch the same memory at the same time and at least one of them is writing. The result is undefined behaviour and it usually will not reproduce. Rust allows either one writer or any number of readers to hold a reference, never both."),
    ("journalling", "A file system that writes a change straight to disk can be interrupted halfway and left inconsistent. A journal writes the intent first, in one place, and only then applies the change. After a crash the recovery pass replays the journal and every recorded operation is applied or absent."),
    ("cryptographic hashing", "A cryptographic hash function takes a message of any length and returns a short digest, such that finding two messages with the same digest is not feasible. Git names every object by the digest of its contents, so a repository can check that nothing was corrupted on disk."),
];

pub const QUERIES: [(&str, &str); 8] = [
    ("what happens to the memory when the value goes out of scope", "ownership"),
    ("why does a query on a column with no index have to look at every row", "btree index"),
    ("how big is the step that the weights take on each batch", "training a network"),
    ("what goes wrong when two threads write to the same place", "data races"),
    ("how does the sender decide how large to make its window", "congestion control"),
    ("how long does a cached copy of a response stay fresh", "http caching"),
    ("what happens when two keys land in the same bucket", "hash tables"),
    ("how does the system get back to a consistent state after a crash", "journalling"),
];

pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

pub fn norm(v: &[f32]) -> f32 {
    dot(v, v).sqrt()
}

pub fn normalise(v: &mut [f32]) {
    let n = norm(v);
    if n > 0.0 {
        for x in v.iter_mut() {
            *x /= n;
        }
    }
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let d = norm(a) * norm(b);
    if d == 0.0 { 0.0 } else { dot(a, b) / d }
}

pub fn euclidean(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| (x - y) * (x - y)).sum::<f32>().sqrt()
}

pub fn embed(text: &str, idf: &HashMap<String, f32>) -> Vec<f32> {
    let mut v = vec![0.0f32; DIM];
    for t in tokens(text) {
        let bucket: usize = (hash64(&t) % DIM as u64) as usize;
        v[bucket] += idf.get(&t).copied().unwrap_or(1.0);
    }
    normalise(&mut v);
    v
}

pub fn idf_table(docs: &[String]) -> HashMap<String, f32> {
    let n = docs.len() as f32;
    let mut df: HashMap<String, usize> = HashMap::new();
    for d in docs {
        let mut seen = tokens(d);
        seen.sort();
        seen.dedup();
        for t in seen {
            *df.entry(t).or_insert(0) += 1;
        }
    }
    df.into_iter()
        .map(|(t, c)| (t, ((n + 1.0) / (c as f32 + 1.0)).ln() + 1.0))
        .collect()
}

pub fn chunk(text: &str, size: usize, overlap: usize) -> Vec<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let step = size - overlap;
    let mut out = Vec::new();
    let mut start = 0;
    while start < words.len() {
        let end = (start + size).min(words.len());
        out.push(words[start..end].join(" "));
        if end == words.len() {
            break;
        }
        start += step;
    }
    out
}

#[derive(Debug, Clone, Copy)]
pub struct Scored {
    pub score: f32,
    pub id: usize,
}

impl Ord for Scored {
    fn cmp(&self, other: &Self) -> Ordering {
        other.score.total_cmp(&self.score).then(self.id.cmp(&other.id))
    }
}
impl PartialOrd for Scored {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> { Some(self.cmp(other)) }
}
impl PartialEq for Scored {
    fn eq(&self, other: &Self) -> bool { self.cmp(other) == Ordering::Equal }
}
impl Eq for Scored {}

pub fn top_k(query: &[f32], vecs: &[Vec<f32>], candidates: &[usize], k: usize) -> Vec<Scored> {
    let mut heap: BinaryHeap<Scored> = BinaryHeap::new();
    for &id in candidates {
        heap.push(Scored { score: dot(query, &vecs[id]), id });
        if heap.len() > k {
            heap.pop();
        }
    }
    heap.into_sorted_vec()
}

pub struct Index {
    pub titles: Vec<String>,
    pub docs: Vec<String>,
    pub vecs: Vec<Vec<f32>>,
    pub idf: HashMap<String, f32>,
    pub planes: Vec<Vec<f32>>,
    pub buckets: HashMap<u32, Vec<usize>>,
}

impl Index {
    pub fn new() -> Self {
        Index { titles: Vec::new(), docs: Vec::new(), vecs: Vec::new(), idf: HashMap::new(), planes: make_planes(), buckets: HashMap::new() }
    }

    pub fn add(&mut self, title: &str, text: &str) {
        for piece in chunk(text, 24, 8) {
            self.vecs.push(embed(&piece, &self.idf));
            self.docs.push(piece);
            self.titles.push(title.to_string());
        }
    }

    pub fn fit(&mut self) {
        self.idf = idf_table(&self.docs);
        let vecs: Vec<Vec<f32>> = self.docs.iter().map(|d| embed(d, &self.idf)).collect();
        self.vecs = vecs;
        self.buckets = HashMap::new();
        for (i, v) in self.vecs.iter().enumerate() {
            self.buckets.entry(code_of(v, &self.planes)).or_default().push(i);
        }
    }

    pub fn search(&self, query: &str, k: usize) -> Vec<Scored> {
        let q = embed(query, &self.idf);
        let all: Vec<usize> = (0..self.vecs.len()).collect();
        top_k(&q, &self.vecs, &all, k)
    }

    pub fn search_approx(&self, query: &str, k: usize, radius: u32) -> (Vec<Scored>, usize) {
        let q = embed(query, &self.idf);
        let code = code_of(&q, &self.planes);
        let mut ids: Vec<usize> = Vec::new();
        for other in 0..(1u32 << PLANES) {
            if (code ^ other).count_ones() <= radius {
            if let Some(bucket) = self.buckets.get(&other) {
                ids.extend_from_slice(bucket);
            }
            }
        }
        (top_k(&q, &self.vecs, &ids, k), ids.len())
    }
}

pub fn mrr(index: &Index) -> f32 {
    let mut total = 0.0;
    for (query, want) in QUERIES {
        let hits = index.search(query, 10);
        if let Some(rank) = hits.iter().position(|h| index.titles[h.id] == want) {
            total += 1.0 / (rank as f32 + 1.0);
        }
    }
    total / QUERIES.len() as f32
}

pub fn run() -> (String, f32, usize) {
    let mut index = Index::new();
    for (title, text) in CORPUS {
        index.add(title, text);
    }
    index.fit();
    println!("{} chunks, {} buckets\n", index.vecs.len(), index.buckets.len());

    let question = "how does the sender decide how large to make its window";
    println!("query: {question}\n");
    let hits = index.search(question, 5);
    for h in &hits {
        println!("  {:.3}  [{}]  {}", h.score, index.titles[h.id], index.docs[h.id]);
    }
    println!("\n{} results returned", hits.len());

    let mut recall = 0.0;
    let mut compared = 0;
    println!("\nexact against approximate, radius 1, k = 5");
    for (query, want) in QUERIES {
        let exact: Vec<usize> = index.search(query, 5).iter().map(|h| h.id).collect();
        let (approx, n) = index.search_approx(query, 5, 1);
        let shared = approx.iter().filter(|h| exact.contains(&h.id)).count();
        compared += n;
        recall += shared as f32 / 5.0;
        println!("  {:.2}  {n:2} of {} compared  [{want}]  {query}", shared as f32 / 5.0, index.vecs.len());
    }
    let recall = recall / QUERIES.len() as f32;
    let compared = compared / QUERIES.len();
    println!("\nmean recall@5 {recall:.2}, {compared} of {} vectors compared per query",
             index.vecs.len());
    println!("mean reciprocal rank of the exact search: {:.4}", mrr(&index));

    let top = index.titles[hits[0].id].clone();
    (top, recall, compared)
}
```

@hint A `for` loop takes its subject by value. After the loop, `hits` has been consumed.
@hint You do not need to own the results to print them. Iterating over a reference borrows the vector instead of eating it.
@hint `for h in &hits`.

@diagnose E0382
`borrow of moved value: hits`, with `hits` moved into the `for` loop above and
the note that `Vec<Scored>` does not implement `Copy`.

`for x in collection` calls `IntoIterator::into_iter(collection)`, which for a
`Vec` takes it by value and hands out owned elements. The vector is gone by the
end of the loop, and the heap buffer behind it has been freed, so `hits.len()`
afterwards is reading a dead binding. This is the same rule that makes a moved
`String` unusable, arriving through a piece of syntax that does not look like a
function call.

`&Vec<T>` also implements `IntoIterator`, yielding `&T`, so `for h in &hits`
borrows and leaves the vector intact. `hits.iter()` is the same thing written
out. Since the loop body only reads `h.score` and `h.id`, borrowing loses
nothing.

@diagnose E0502
If you moved the `len` call above the loop and stored it, that compiles. Doing
the same with something that mutates the index while the results borrow it does
not, because `search` returns data derived from the index and the index cannot
change underneath it.

@after
The whole retrieval half, in about 130 lines. The window question returns the
two congestion control chunks first, at 0.323 and 0.269, and then some noise:
type checking at 0.225, which shares "it", "is", "the" and "a" and nothing else.
That noise floor is the hashing trick's ceiling, not the index's.

The comparison at the bottom is the number to take away. Exact search reads 36
vectors and answers all eight questions correctly. The approximate index at
radius 1 reads 13 and keeps 38 percent of the true top five. Two of the eight
questions do better than that and one gets nothing at all, which is what
variance looks like at this size.

What a production system does differently, in order of how much it matters.
It uses a neural encoder, which changes the geometry and therefore everything
downstream. It uses HNSW or IVF-PQ rather than random projections, and reaches
95 percent recall while touching one or two percent of the index, because a
navigable graph follows the data instead of cutting it with planes drawn before
the data arrived. It stores vectors quantised to eight bits or fewer, which cuts
memory by four and costs almost no accuracy. And it usually keeps a keyword
index alongside the vector one, because exact term matches are still the best
signal for names, error codes and numbers, and merges the two rankings.

None of that changes the shape of what you built: embed, store, score, rank.
