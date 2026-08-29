---
project: huffman
tier: mini
domain: data
title: Huffman coding
accent: moss
blurb: Count the bytes, grow a tree out of a heap, and pack a paragraph of English into a bit over half its size, then get every byte of it back.
needs: 09-enums, 11-collections, 18-smart-ptr
mins: 30
---

A byte is eight bits whether it is a space or a capital J, and English does not
use them anywhere near equally. In the paragraph you will compress here, the
space character occurs 78 times and the letter J occurs once. Spending eight
bits on both is the waste that Huffman coding removes: give the common symbols
short codes and the rare ones long codes, and the total shrinks.

The trick that makes it work is the tree. Every symbol sits at a leaf, its code
is the path from the root, and because symbols only ever live at leaves, no
code can be a prefix of another. That property is what lets a decoder read a
stream of bits with no separators in it and still know where each symbol ends.
Build the tree by repeatedly joining the two least frequent nodes and you get
the provably shortest such code for those frequencies, which David Huffman
proved as a graduate student in 1951 while trying to avoid an exam.

Four stages: count the bytes, walk the tree into a code table, pack the bits
into a `Vec<u8>`, and walk the tree back the other way. About ninety lines. The
result is real compression, 430 bytes down to 233, and it round trips.

DEFLATE, which is what `gzip` and PNG and every `.zip` file use, is Huffman
coding on top of a sliding-window match finder, so this is genuinely half of
the most deployed compressor in the world. What it is missing: a way to store
the tree alongside the data (this version keeps it in memory, which is cheating
if you want to write a file), and the LZ77 stage that finds repeated
substrings before any counting happens.

## 1. Frequencies, and a heap that gives you the smallest

@kind fix
@concept ord

@expect E0277

`build_tree` joins the two rarest nodes over and over until one is left. It
wants a min-heap, and `BinaryHeap` is a max-heap, so every node goes in wrapped
in `Reverse`. That wrapper needs something from `Node` that `Node` does not yet
provide.

```starter
use std::cmp::{Ordering, Reverse};
use std::collections::{BinaryHeap, HashMap};

pub const CORPUS: &str = "Every language answers one question: when is it safe to free this memory? C makes you answer by hand and punishes mistakes. Java and Python refuse to answer and pay a collector to keep asking. Rust answers at compile time, and the price is that you say who owns what. Every value has one owner. When the owner goes out of scope, the value is dropped. Ownership can be given away, and afterwards the old binding is statically dead.";

#[derive(Debug, PartialEq, Eq)]
pub enum Node {
    Leaf { byte: u8, freq: usize },
    Internal { freq: usize, left: Box<Node>, right: Box<Node> },
}

impl Node {
    pub fn freq(&self) -> usize {
        match self {
            Node::Leaf { freq, .. } | Node::Internal { freq, .. } => *freq,
        }
    }

    /// The smallest byte anywhere under this node. Every byte appears at
    /// exactly one leaf, so no two nodes can share this value.
    pub fn low_byte(&self) -> u8 {
        match self {
            Node::Leaf { byte, .. } => *byte,
            Node::Internal { left, right, .. } => left.low_byte().min(right.low_byte()),
        }
    }
}

pub fn frequencies(data: &[u8]) -> HashMap<u8, usize> {
    let mut counts = HashMap::new();
    for &b in data {
        *counts.entry(b).or_insert(0) += 1;
    }
    counts
}

pub fn build_tree(freqs: &HashMap<u8, usize>) -> Option<Node> {
    let mut heap: BinaryHeap<Reverse<Node>> = freqs
        .iter()
        .map(|(&byte, &freq)| Reverse(Node::Leaf { byte, freq }))
        .collect();

    while heap.len() > 1 {
        let Reverse(left) = heap.pop()?;
        let Reverse(right) = heap.pop()?;
        heap.push(Reverse(Node::Internal {
            freq: left.freq() + right.freq(),
            left: Box::new(left),
            right: Box::new(right),
        }));
    }
    heap.pop().map(|Reverse(root)| root)
}

pub fn run() -> (usize, usize) {
    let freqs = frequencies(CORPUS.as_bytes());

    let mut ranked: Vec<(u8, usize)> = freqs.iter().map(|(&b, &n)| (b, n)).collect();
    ranked.sort_by_key(|&(b, n)| (Reverse(n), b));
    for &(b, n) in ranked.iter().take(6) {
        println!("{:?} appears {n} times", b as char);
    }

    let tree = build_tree(&freqs).expect("the corpus is not empty");
    println!("{} distinct bytes, root frequency {}", freqs.len(), tree.freq());
    (freqs.len(), tree.freq())
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_root_holds_every_byte() {
        let (distinct, total) = run();
        assert_eq!(distinct, 35);
        assert_eq!(total, CORPUS.len());
        assert_eq!(total, 430);
    }

    #[test]
    fn ties_break_on_the_lowest_byte() {
        let z = Node::Leaf { byte: b'z', freq: 3 };
        let a = Node::Leaf { byte: b'a', freq: 3 };
        assert!(a < z, "same frequency, so the lower byte must sort first");
        assert!(Node::Leaf { byte: b'z', freq: 1 } < a, "frequency wins over byte");
    }

    #[test]
    fn the_tree_does_not_depend_on_hash_order() {
        let mut one = HashMap::new();
        for (b, n) in [(b'a', 3usize), (b'b', 3), (b'c', 3), (b'd', 5)] {
            one.insert(b, n);
        }
        let mut two = HashMap::new();
        for (b, n) in [(b'd', 5usize), (b'c', 3), (b'b', 3), (b'a', 3)] {
            two.insert(b, n);
        }
        assert_eq!(build_tree(&one), build_tree(&two));
    }

    #[test]
    fn nothing_in_nothing_out() {
        assert_eq!(build_tree(&frequencies(b"")), None);
        assert_eq!(
            build_tree(&frequencies(b"aaa")),
            Some(Node::Leaf { byte: b'a', freq: 3 })
        );
    }
}
```

```solution
use std::cmp::{Ordering, Reverse};
use std::collections::{BinaryHeap, HashMap};

pub const CORPUS: &str = "Every language answers one question: when is it safe to free this memory? C makes you answer by hand and punishes mistakes. Java and Python refuse to answer and pay a collector to keep asking. Rust answers at compile time, and the price is that you say who owns what. Every value has one owner. When the owner goes out of scope, the value is dropped. Ownership can be given away, and afterwards the old binding is statically dead.";

#[derive(Debug, PartialEq, Eq)]
pub enum Node {
    Leaf { byte: u8, freq: usize },
    Internal { freq: usize, left: Box<Node>, right: Box<Node> },
}

impl Node {
    pub fn freq(&self) -> usize {
        match self {
            Node::Leaf { freq, .. } | Node::Internal { freq, .. } => *freq,
        }
    }

    /// The smallest byte anywhere under this node. Every byte appears at
    /// exactly one leaf, so no two nodes can share this value.
    pub fn low_byte(&self) -> u8 {
        match self {
            Node::Leaf { byte, .. } => *byte,
            Node::Internal { left, right, .. } => left.low_byte().min(right.low_byte()),
        }
    }
}

impl Ord for Node {
    fn cmp(&self, other: &Node) -> Ordering {
        self.freq()
            .cmp(&other.freq())
            .then_with(|| self.low_byte().cmp(&other.low_byte()))
    }
}

impl PartialOrd for Node {
    fn partial_cmp(&self, other: &Node) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

pub fn frequencies(data: &[u8]) -> HashMap<u8, usize> {
    let mut counts = HashMap::new();
    for &b in data {
        *counts.entry(b).or_insert(0) += 1;
    }
    counts
}

pub fn build_tree(freqs: &HashMap<u8, usize>) -> Option<Node> {
    let mut heap: BinaryHeap<Reverse<Node>> = freqs
        .iter()
        .map(|(&byte, &freq)| Reverse(Node::Leaf { byte, freq }))
        .collect();

    while heap.len() > 1 {
        let Reverse(left) = heap.pop()?;
        let Reverse(right) = heap.pop()?;
        heap.push(Reverse(Node::Internal {
            freq: left.freq() + right.freq(),
            left: Box::new(left),
            right: Box::new(right),
        }));
    }
    heap.pop().map(|Reverse(root)| root)
}

pub fn run() -> (usize, usize) {
    let freqs = frequencies(CORPUS.as_bytes());

    let mut ranked: Vec<(u8, usize)> = freqs.iter().map(|(&b, &n)| (b, n)).collect();
    ranked.sort_by_key(|&(b, n)| (Reverse(n), b));
    for &(b, n) in ranked.iter().take(6) {
        println!("{:?} appears {n} times", b as char);
    }

    let tree = build_tree(&freqs).expect("the corpus is not empty");
    println!("{} distinct bytes, root frequency {}", freqs.len(), tree.freq());
    (freqs.len(), tree.freq())
}
```

@hint `BinaryHeap<T>` sorts by `T`'s ordering, and `Reverse<Node>` can only be ordered if `Node` can be. Nothing in the file says how two nodes compare.
@hint Write `impl Ord for Node`. Compare `freq()` first. When the frequencies are equal, compare `low_byte()`, so that the answer never depends on which node arrived first.
@hint `Ord` has `PartialOrd` as a supertrait, so you need both. The second one is one line: `Some(self.cmp(other))`. In the first, `Ordering::then_with` chains the tie-break.

@diagnose E0277
`the trait bound `Node: Ord` is not satisfied`, pointing at the `collect` (or
at `push`) with a note that `Reverse<Node>: Ord` requires it.

A heap has to know which of two elements is smaller, and in Rust that knowledge
is a trait rather than a comparison operator or a callback. `BinaryHeap<T>`
declares `T: Ord` on every method that reorders anything, so the bound is
checked here at the call site and never again inside the heap.

`Reverse<T>` implements `Ord` by delegating to `T` and flipping the answer,
which is why the error names `Node` and not `Reverse`. `#[derive(Eq)]` is not
enough. `Eq` says two values can be compared for equality; `Ord` says they can
be put in order, and only the second one lets a heap work.

You will see this code a second time after writing `impl Ord for Node` alone,
now as `the trait bound `Node: PartialOrd` is not satisfied`. `Ord: Eq +
PartialOrd` is a supertrait relationship, so both impls have to exist. Delegate
the second to the first rather than writing the comparison twice, which is the
usual way to end up with a type whose `<` and whose `cmp` disagree.

@diagnose E0308
Probably in `cmp`. The signature returns `Ordering`, not `bool` and not
`Option<Ordering>`. `usize::cmp` already gives you an `Ordering`, so
`self.freq().cmp(&other.freq())` is the whole first half. Note the `&`:
`Ord::cmp` takes its argument by reference.

@after
The tie-break is not decoration. `HashMap` iteration order is randomised per
process, so the nodes enter the heap in a different sequence every run, and if
two nodes compare equal the heap is free to hand back either one. Run this with
the `low_byte` comparison deleted and the code table comes out different on
every execution. The compressed size stays at 1859 bits (Huffman is optimal
whichever way you break ties), but an encoder and a decoder built in separate
processes would disagree about what the bits mean. Any structure whose output
you intend to reproduce needs a total order, not a nearly total one.

## 2. The tree becomes a table

@kind fix
@concept recursion

@expect E0308

A code is the path from the root to a leaf, left for 0 and right for 1.
`walk` carries one mutable path down the tree, pushing before each descent and
popping after, and records the path when it reaches a leaf. Recording it is
where it goes wrong.

```starter
use std::cmp::{Ordering, Reverse};
use std::collections::{BinaryHeap, HashMap};

pub const CORPUS: &str = "Every language answers one question: when is it safe to free this memory? C makes you answer by hand and punishes mistakes. Java and Python refuse to answer and pay a collector to keep asking. Rust answers at compile time, and the price is that you say who owns what. Every value has one owner. When the owner goes out of scope, the value is dropped. Ownership can be given away, and afterwards the old binding is statically dead.";

#[derive(Debug, PartialEq, Eq)]
pub enum Node {
    Leaf { byte: u8, freq: usize },
    Internal { freq: usize, left: Box<Node>, right: Box<Node> },
}

impl Node {
    pub fn freq(&self) -> usize {
        match self {
            Node::Leaf { freq, .. } | Node::Internal { freq, .. } => *freq,
        }
    }

    /// The smallest byte anywhere under this node. Every byte appears at
    /// exactly one leaf, so no two nodes can share this value.
    pub fn low_byte(&self) -> u8 {
        match self {
            Node::Leaf { byte, .. } => *byte,
            Node::Internal { left, right, .. } => left.low_byte().min(right.low_byte()),
        }
    }
}

impl Ord for Node {
    fn cmp(&self, other: &Node) -> Ordering {
        self.freq()
            .cmp(&other.freq())
            .then_with(|| self.low_byte().cmp(&other.low_byte()))
    }
}

impl PartialOrd for Node {
    fn partial_cmp(&self, other: &Node) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

pub fn frequencies(data: &[u8]) -> HashMap<u8, usize> {
    let mut counts = HashMap::new();
    for &b in data {
        *counts.entry(b).or_insert(0) += 1;
    }
    counts
}

pub fn build_tree(freqs: &HashMap<u8, usize>) -> Option<Node> {
    let mut heap: BinaryHeap<Reverse<Node>> = freqs
        .iter()
        .map(|(&byte, &freq)| Reverse(Node::Leaf { byte, freq }))
        .collect();

    while heap.len() > 1 {
        let Reverse(left) = heap.pop()?;
        let Reverse(right) = heap.pop()?;
        heap.push(Reverse(Node::Internal {
            freq: left.freq() + right.freq(),
            left: Box::new(left),
            right: Box::new(right),
        }));
    }
    heap.pop().map(|Reverse(root)| root)
}

pub fn build_codes(root: &Node) -> HashMap<u8, Vec<bool>> {
    let mut codes = HashMap::new();
    let mut path = Vec::new();
    walk(root, &mut path, &mut codes);
    codes
}

fn walk(node: &Node, path: &mut Vec<bool>, codes: &mut HashMap<u8, Vec<bool>>) {
    match node {
        Node::Leaf { byte, .. } => {
            // A one-symbol corpus has a leaf for a root and an empty path,
            // so that case gets a single 0 bit instead of no bits at all.
            let code = if path.is_empty() { vec![false] } else { path };
            codes.insert(*byte, code);
        }
        Node::Internal { left, right, .. } => {
            path.push(false);
            walk(left, path, codes);
            path.pop();
            path.push(true);
            walk(right, path, codes);
            path.pop();
        }
    }
}

pub fn run() -> Vec<(u8, String)> {
    let freqs = frequencies(CORPUS.as_bytes());
    let tree = build_tree(&freqs).expect("the corpus is not empty");
    let codes = build_codes(&tree);

    let mut listed: Vec<(u8, String)> = codes
        .iter()
        .map(|(&b, c)| (b, c.iter().map(|&x| if x { '1' } else { '0' }).collect()))
        .collect();
    listed.sort_by_key(|(b, c)| (c.len(), *b));

    for (b, c) in listed.iter().take(8) {
        println!("{:?}  {c}", *b as char);
    }
    let bits: usize = codes.iter().map(|(b, c)| c.len() * freqs[b]).sum();
    println!(
        "{} codes, {bits} bits for {} bytes, {:.2} bits per byte",
        codes.len(),
        CORPUS.len(),
        bits as f64 / CORPUS.len() as f64
    );
    listed
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_space_gets_the_shortest_code() {
        let listed = run();
        assert_eq!(listed.len(), 35);
        assert_eq!(listed[0], (b' ', "111".to_string()));
        assert_eq!(listed[1], (b'e', "001".to_string()));
    }

    #[test]
    fn no_code_is_a_prefix_of_another() {
        let tree = build_tree(&frequencies(CORPUS.as_bytes())).unwrap();
        let codes = build_codes(&tree);
        let all: Vec<Vec<bool>> = codes.values().cloned().collect();
        for a in &all {
            for b in &all {
                if a != b {
                    assert!(!b.starts_with(a), "{a:?} is a prefix of {b:?}");
                }
            }
        }
    }

    #[test]
    fn rarer_bytes_get_longer_codes() {
        let freqs = frequencies(CORPUS.as_bytes());
        let codes = build_codes(&build_tree(&freqs).unwrap());
        assert!(codes[&b' '].len() < codes[&b'J'].len());
        let total: usize = codes.iter().map(|(b, c)| c.len() * freqs[b]).sum();
        assert_eq!(total, 1859);
    }

    #[test]
    fn one_symbol_still_needs_one_bit() {
        let codes = build_codes(&build_tree(&frequencies(b"aaaa")).unwrap());
        assert_eq!(codes[&b'a'], vec![false]);
    }
}
```

```solution
use std::cmp::{Ordering, Reverse};
use std::collections::{BinaryHeap, HashMap};

pub const CORPUS: &str = "Every language answers one question: when is it safe to free this memory? C makes you answer by hand and punishes mistakes. Java and Python refuse to answer and pay a collector to keep asking. Rust answers at compile time, and the price is that you say who owns what. Every value has one owner. When the owner goes out of scope, the value is dropped. Ownership can be given away, and afterwards the old binding is statically dead.";

#[derive(Debug, PartialEq, Eq)]
pub enum Node {
    Leaf { byte: u8, freq: usize },
    Internal { freq: usize, left: Box<Node>, right: Box<Node> },
}

impl Node {
    pub fn freq(&self) -> usize {
        match self {
            Node::Leaf { freq, .. } | Node::Internal { freq, .. } => *freq,
        }
    }

    /// The smallest byte anywhere under this node. Every byte appears at
    /// exactly one leaf, so no two nodes can share this value.
    pub fn low_byte(&self) -> u8 {
        match self {
            Node::Leaf { byte, .. } => *byte,
            Node::Internal { left, right, .. } => left.low_byte().min(right.low_byte()),
        }
    }
}

impl Ord for Node {
    fn cmp(&self, other: &Node) -> Ordering {
        self.freq()
            .cmp(&other.freq())
            .then_with(|| self.low_byte().cmp(&other.low_byte()))
    }
}

impl PartialOrd for Node {
    fn partial_cmp(&self, other: &Node) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

pub fn frequencies(data: &[u8]) -> HashMap<u8, usize> {
    let mut counts = HashMap::new();
    for &b in data {
        *counts.entry(b).or_insert(0) += 1;
    }
    counts
}

pub fn build_tree(freqs: &HashMap<u8, usize>) -> Option<Node> {
    let mut heap: BinaryHeap<Reverse<Node>> = freqs
        .iter()
        .map(|(&byte, &freq)| Reverse(Node::Leaf { byte, freq }))
        .collect();

    while heap.len() > 1 {
        let Reverse(left) = heap.pop()?;
        let Reverse(right) = heap.pop()?;
        heap.push(Reverse(Node::Internal {
            freq: left.freq() + right.freq(),
            left: Box::new(left),
            right: Box::new(right),
        }));
    }
    heap.pop().map(|Reverse(root)| root)
}

pub fn build_codes(root: &Node) -> HashMap<u8, Vec<bool>> {
    let mut codes = HashMap::new();
    let mut path = Vec::new();
    walk(root, &mut path, &mut codes);
    codes
}

fn walk(node: &Node, path: &mut Vec<bool>, codes: &mut HashMap<u8, Vec<bool>>) {
    match node {
        Node::Leaf { byte, .. } => {
            // A one-symbol corpus has a leaf for a root and an empty path,
            // so that case gets a single 0 bit instead of no bits at all.
            let code = if path.is_empty() { vec![false] } else { path.clone() };
            codes.insert(*byte, code);
        }
        Node::Internal { left, right, .. } => {
            path.push(false);
            walk(left, path, codes);
            path.pop();
            path.push(true);
            walk(right, path, codes);
            path.pop();
        }
    }
}

pub fn run() -> Vec<(u8, String)> {
    let freqs = frequencies(CORPUS.as_bytes());
    let tree = build_tree(&freqs).expect("the corpus is not empty");
    let codes = build_codes(&tree);

    let mut listed: Vec<(u8, String)> = codes
        .iter()
        .map(|(&b, c)| (b, c.iter().map(|&x| if x { '1' } else { '0' }).collect()))
        .collect();
    listed.sort_by_key(|(b, c)| (c.len(), *b));

    for (b, c) in listed.iter().take(8) {
        println!("{:?}  {c}", *b as char);
    }
    let bits: usize = codes.iter().map(|(b, c)| c.len() * freqs[b]).sum();
    println!(
        "{} codes, {bits} bits for {} bytes, {:.2} bits per byte",
        codes.len(),
        CORPUS.len(),
        bits as f64 / CORPUS.len() as f64
    );
    listed
}
```

@hint The map owns its values. `path` is borrowed from the caller and about to be modified again, so it cannot be the thing stored.
@hint After this leaf is recorded, the walk pops a bit and descends somewhere else. Whatever went into the map must be a snapshot taken now.
@hint `path.clone()`.

@diagnose E0308
`expected `Vec<bool>`, found `&mut Vec<bool>``, on the `else` branch of the
`if`. The two arms of an `if` must have one type, and `vec![false]` has already
pinned that type to `Vec<bool>`.

Underneath the type error is an ownership question with only one answer.
`HashMap<u8, Vec<bool>>` stores its values by value, and `path` is a mutable
borrow of a vector that lives in `build_codes` and that this function is going
to push and pop several thousand more times. Storing a reference to it would
mean every entry in the table pointed at the same buffer, showing whatever the
walk happened to be doing last. `clone` takes the snapshot: three to nine
`bool`s, one small allocation per symbol, done once per leaf.

@diagnose E0502
You reached for `codes.insert(*byte, path.to_vec())` inside a match on
`*path`, or otherwise held a borrow of `path` across the `insert`. Take the
copy first, into a local, then insert it. `path.clone()` finishes with the
borrow before `insert` starts.

@diagnose E0004
A missing arm in `walk`. `Node` has two variants and the recursion needs both:
`Leaf` is where a code gets written down, `Internal` is where the path grows by
one bit in each direction. Leaving out `Internal` gives a table of one entry.

@after
The walk mutates one `Vec<bool>` and clones only at the leaves, which is the
difference between one allocation per symbol and one per edge. For a 35-symbol
alphabet that is nothing, but the same shape scales: DEFLATE's literal tree has
286 symbols and gets rebuilt for every block.

Look at the output. Space is `111` at three bits, `e` is `001`, and `J` is nine
bits long. Weighted by how often each byte actually occurs, the paragraph needs
1859 bits instead of 3440, which is 4.32 bits per byte. Now it has to be
written down.

## 3. Bits do not have addresses

@kind fix
@concept struct

@expect E0063

Codes are three to nine bits long and memory is addressed in bytes, so the
concatenated bit string has to be packed eight at a time. The last byte will
almost never be full, and the leftover zeros are indistinguishable from real
zeros. `Encoded` has a field for exactly that problem and the constructor
ignores it.

```starter
use std::cmp::{Ordering, Reverse};
use std::collections::{BinaryHeap, HashMap};

pub const CORPUS: &str = "Every language answers one question: when is it safe to free this memory? C makes you answer by hand and punishes mistakes. Java and Python refuse to answer and pay a collector to keep asking. Rust answers at compile time, and the price is that you say who owns what. Every value has one owner. When the owner goes out of scope, the value is dropped. Ownership can be given away, and afterwards the old binding is statically dead.";

#[derive(Debug, PartialEq, Eq)]
pub enum Node {
    Leaf { byte: u8, freq: usize },
    Internal { freq: usize, left: Box<Node>, right: Box<Node> },
}

impl Node {
    pub fn freq(&self) -> usize {
        match self {
            Node::Leaf { freq, .. } | Node::Internal { freq, .. } => *freq,
        }
    }

    /// The smallest byte anywhere under this node. Every byte appears at
    /// exactly one leaf, so no two nodes can share this value.
    pub fn low_byte(&self) -> u8 {
        match self {
            Node::Leaf { byte, .. } => *byte,
            Node::Internal { left, right, .. } => left.low_byte().min(right.low_byte()),
        }
    }
}

impl Ord for Node {
    fn cmp(&self, other: &Node) -> Ordering {
        self.freq()
            .cmp(&other.freq())
            .then_with(|| self.low_byte().cmp(&other.low_byte()))
    }
}

impl PartialOrd for Node {
    fn partial_cmp(&self, other: &Node) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

pub fn frequencies(data: &[u8]) -> HashMap<u8, usize> {
    let mut counts = HashMap::new();
    for &b in data {
        *counts.entry(b).or_insert(0) += 1;
    }
    counts
}

pub fn build_tree(freqs: &HashMap<u8, usize>) -> Option<Node> {
    let mut heap: BinaryHeap<Reverse<Node>> = freqs
        .iter()
        .map(|(&byte, &freq)| Reverse(Node::Leaf { byte, freq }))
        .collect();

    while heap.len() > 1 {
        let Reverse(left) = heap.pop()?;
        let Reverse(right) = heap.pop()?;
        heap.push(Reverse(Node::Internal {
            freq: left.freq() + right.freq(),
            left: Box::new(left),
            right: Box::new(right),
        }));
    }
    heap.pop().map(|Reverse(root)| root)
}

pub fn build_codes(root: &Node) -> HashMap<u8, Vec<bool>> {
    let mut codes = HashMap::new();
    let mut path = Vec::new();
    walk(root, &mut path, &mut codes);
    codes
}

fn walk(node: &Node, path: &mut Vec<bool>, codes: &mut HashMap<u8, Vec<bool>>) {
    match node {
        Node::Leaf { byte, .. } => {
            let code = if path.is_empty() { vec![false] } else { path.clone() };
            codes.insert(*byte, code);
        }
        Node::Internal { left, right, .. } => {
            path.push(false);
            walk(left, path, codes);
            path.pop();
            path.push(true);
            walk(right, path, codes);
            path.pop();
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Encoded {
    pub bytes: Vec<u8>,
    /// How many of the bits in `bytes` are real. Without this the decoder
    /// reads the padding at the end as data.
    pub bits: usize,
}

pub fn encode(data: &[u8], codes: &HashMap<u8, Vec<bool>>) -> Encoded {
    let mut bits: Vec<bool> = Vec::new();
    for b in data {
        bits.extend_from_slice(&codes[b]);
    }

    let mut bytes = vec![0u8; bits.len().div_ceil(8)];
    for (i, &bit) in bits.iter().enumerate() {
        if bit {
            bytes[i / 8] |= 1 << (7 - i % 8);
        }
    }
    Encoded { bytes }
}

pub fn run() -> Encoded {
    let data = CORPUS.as_bytes();
    let tree = build_tree(&frequencies(data)).expect("the corpus is not empty");
    let enc = encode(data, &build_codes(&tree));

    println!("{} bytes in", data.len());
    println!("{} bits out, packed into {} bytes", enc.bits, enc.bytes.len());
    println!("{} padding bits on the end", enc.bytes.len() * 8 - enc.bits);
    enc
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_corpus_packs_into_233_bytes() {
        let enc = run();
        assert_eq!(enc.bits, 1859);
        assert_eq!(enc.bytes.len(), 233);
        assert_eq!(enc.bytes.len() * 8 - enc.bits, 5);
    }

    #[test]
    fn the_packed_bits_are_the_codes_in_order() {
        let data = CORPUS.as_bytes();
        let codes = build_codes(&build_tree(&frequencies(data)).unwrap());
        let enc = encode(data, &codes);

        let flat: Vec<bool> = data.iter().flat_map(|b| codes[b].clone()).collect();
        assert_eq!(flat.len(), enc.bits);
        for (i, &want) in flat.iter().enumerate() {
            let got = enc.bytes[i / 8] >> (7 - i % 8) & 1 == 1;
            assert_eq!(got, want, "bit {i}");
        }
    }

    #[test]
    fn a_partial_last_byte_is_still_a_whole_byte() {
        let codes = build_codes(&build_tree(&frequencies(b"aaaa")).unwrap());
        let enc = encode(b"aaaa", &codes);
        assert_eq!(enc.bits, 4);
        assert_eq!(enc.bytes, vec![0u8]);
    }

    #[test]
    fn nothing_encodes_to_nothing() {
        let codes = build_codes(&build_tree(&frequencies(b"ab")).unwrap());
        let enc = encode(b"", &codes);
        assert_eq!(enc.bits, 0);
        assert!(enc.bytes.is_empty());
    }
}
```

```solution
use std::cmp::{Ordering, Reverse};
use std::collections::{BinaryHeap, HashMap};

pub const CORPUS: &str = "Every language answers one question: when is it safe to free this memory? C makes you answer by hand and punishes mistakes. Java and Python refuse to answer and pay a collector to keep asking. Rust answers at compile time, and the price is that you say who owns what. Every value has one owner. When the owner goes out of scope, the value is dropped. Ownership can be given away, and afterwards the old binding is statically dead.";

#[derive(Debug, PartialEq, Eq)]
pub enum Node {
    Leaf { byte: u8, freq: usize },
    Internal { freq: usize, left: Box<Node>, right: Box<Node> },
}

impl Node {
    pub fn freq(&self) -> usize {
        match self {
            Node::Leaf { freq, .. } | Node::Internal { freq, .. } => *freq,
        }
    }

    /// The smallest byte anywhere under this node. Every byte appears at
    /// exactly one leaf, so no two nodes can share this value.
    pub fn low_byte(&self) -> u8 {
        match self {
            Node::Leaf { byte, .. } => *byte,
            Node::Internal { left, right, .. } => left.low_byte().min(right.low_byte()),
        }
    }
}

impl Ord for Node {
    fn cmp(&self, other: &Node) -> Ordering {
        self.freq()
            .cmp(&other.freq())
            .then_with(|| self.low_byte().cmp(&other.low_byte()))
    }
}

impl PartialOrd for Node {
    fn partial_cmp(&self, other: &Node) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

pub fn frequencies(data: &[u8]) -> HashMap<u8, usize> {
    let mut counts = HashMap::new();
    for &b in data {
        *counts.entry(b).or_insert(0) += 1;
    }
    counts
}

pub fn build_tree(freqs: &HashMap<u8, usize>) -> Option<Node> {
    let mut heap: BinaryHeap<Reverse<Node>> = freqs
        .iter()
        .map(|(&byte, &freq)| Reverse(Node::Leaf { byte, freq }))
        .collect();

    while heap.len() > 1 {
        let Reverse(left) = heap.pop()?;
        let Reverse(right) = heap.pop()?;
        heap.push(Reverse(Node::Internal {
            freq: left.freq() + right.freq(),
            left: Box::new(left),
            right: Box::new(right),
        }));
    }
    heap.pop().map(|Reverse(root)| root)
}

pub fn build_codes(root: &Node) -> HashMap<u8, Vec<bool>> {
    let mut codes = HashMap::new();
    let mut path = Vec::new();
    walk(root, &mut path, &mut codes);
    codes
}

fn walk(node: &Node, path: &mut Vec<bool>, codes: &mut HashMap<u8, Vec<bool>>) {
    match node {
        Node::Leaf { byte, .. } => {
            let code = if path.is_empty() { vec![false] } else { path.clone() };
            codes.insert(*byte, code);
        }
        Node::Internal { left, right, .. } => {
            path.push(false);
            walk(left, path, codes);
            path.pop();
            path.push(true);
            walk(right, path, codes);
            path.pop();
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Encoded {
    pub bytes: Vec<u8>,
    /// How many of the bits in `bytes` are real. Without this the decoder
    /// reads the padding at the end as data.
    pub bits: usize,
}

pub fn encode(data: &[u8], codes: &HashMap<u8, Vec<bool>>) -> Encoded {
    let mut bits: Vec<bool> = Vec::new();
    for b in data {
        bits.extend_from_slice(&codes[b]);
    }

    let mut bytes = vec![0u8; bits.len().div_ceil(8)];
    for (i, &bit) in bits.iter().enumerate() {
        if bit {
            bytes[i / 8] |= 1 << (7 - i % 8);
        }
    }
    Encoded { bits: bits.len(), bytes }
}

pub fn run() -> Encoded {
    let data = CORPUS.as_bytes();
    let tree = build_tree(&frequencies(data)).expect("the corpus is not empty");
    let enc = encode(data, &build_codes(&tree));

    println!("{} bytes in", data.len());
    println!("{} bits out, packed into {} bytes", enc.bits, enc.bytes.len());
    println!("{} padding bits on the end", enc.bytes.len() * 8 - enc.bits);
    enc
}
```

@hint The struct has two fields and the initialiser lists one. The compiler will tell you which.
@hint `bits.len()` is the number of real bits, and it has to be read before `bits` goes out of scope.
@hint `Encoded { bits: bits.len(), bytes }`.

@diagnose E0063
`missing field `bits` in initializer of `Encoded``.

Rust has no default field values and no partial construction. A struct literal
either names every field or ends with `..other` to take the rest from an
existing value, because a half-built struct is a value whose invariants nobody
has established.

That rule is doing real work here. The padding bug is one of the standard ways
a bit-level format goes wrong: 1859 bits round up to 233 bytes, the last five
bits are zeros nobody wrote, and a decoder that reads all 1864 will walk five
more edges down the tree and emit a phantom symbol. The type system cannot know
that `bits` is the field that prevents it, but it can refuse to let you forget
the field exists.

@diagnose E0308
`bits.len()` is a `usize` and the field is a `usize`, so if this fires you
probably wrote `bits` (the `Vec<bool>`) where the length was wanted, or moved
`bytes` before reading it. Fill `bits` from `bits.len()` before the vector is
consumed by anything else.

@diagnose E0382
`borrow of moved value: bits`. Struct fields are evaluated in the order you
write them, so `Encoded { bytes, bits: bits.len() }` is fine but a version that
moves `bits` into the struct first and then calls `.len()` on it is not. Read
the length into a local, or put the `bits:` field first.

@after
Packing is most significant bit first inside each byte, which is arbitrary but
has to be agreed on: DEFLATE packs the other way round for its literal codes
and the same way for its Huffman codes, and mixing the two is a classic
half-day of debugging.

The 5 padding bits are the reason `bits` exists as a field rather than being
recomputed from `bytes.len() * 8`. Every real container solves this somehow. A
gzip member ends with an explicit uncompressed length, PNG chunks carry a byte
count, and a bare Huffman stream like this one carries a bit count. Something
has to say where the data stops.

## 4. Back down the tree

@kind fill
@concept match

@expect E0004

Decoding is the walk in reverse: start at the root, read one bit, go left on 0
and right on 1, and every time you land on a leaf emit its byte and jump back
to the root. The descent is written as a `match` and it is missing a case that
cannot happen.

```starter
use std::cmp::{Ordering, Reverse};
use std::collections::{BinaryHeap, HashMap};

pub const CORPUS: &str = "Every language answers one question: when is it safe to free this memory? C makes you answer by hand and punishes mistakes. Java and Python refuse to answer and pay a collector to keep asking. Rust answers at compile time, and the price is that you say who owns what. Every value has one owner. When the owner goes out of scope, the value is dropped. Ownership can be given away, and afterwards the old binding is statically dead.";

#[derive(Debug, PartialEq, Eq)]
pub enum Node {
    Leaf { byte: u8, freq: usize },
    Internal { freq: usize, left: Box<Node>, right: Box<Node> },
}

impl Node {
    pub fn freq(&self) -> usize {
        match self {
            Node::Leaf { freq, .. } | Node::Internal { freq, .. } => *freq,
        }
    }

    /// The smallest byte anywhere under this node. Every byte appears at
    /// exactly one leaf, so no two nodes can share this value.
    pub fn low_byte(&self) -> u8 {
        match self {
            Node::Leaf { byte, .. } => *byte,
            Node::Internal { left, right, .. } => left.low_byte().min(right.low_byte()),
        }
    }
}

impl Ord for Node {
    fn cmp(&self, other: &Node) -> Ordering {
        self.freq()
            .cmp(&other.freq())
            .then_with(|| self.low_byte().cmp(&other.low_byte()))
    }
}

impl PartialOrd for Node {
    fn partial_cmp(&self, other: &Node) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

pub fn frequencies(data: &[u8]) -> HashMap<u8, usize> {
    let mut counts = HashMap::new();
    for &b in data {
        *counts.entry(b).or_insert(0) += 1;
    }
    counts
}

pub fn build_tree(freqs: &HashMap<u8, usize>) -> Option<Node> {
    let mut heap: BinaryHeap<Reverse<Node>> = freqs
        .iter()
        .map(|(&byte, &freq)| Reverse(Node::Leaf { byte, freq }))
        .collect();

    while heap.len() > 1 {
        let Reverse(left) = heap.pop()?;
        let Reverse(right) = heap.pop()?;
        heap.push(Reverse(Node::Internal {
            freq: left.freq() + right.freq(),
            left: Box::new(left),
            right: Box::new(right),
        }));
    }
    heap.pop().map(|Reverse(root)| root)
}

pub fn build_codes(root: &Node) -> HashMap<u8, Vec<bool>> {
    let mut codes = HashMap::new();
    let mut path = Vec::new();
    walk(root, &mut path, &mut codes);
    codes
}

fn walk(node: &Node, path: &mut Vec<bool>, codes: &mut HashMap<u8, Vec<bool>>) {
    match node {
        Node::Leaf { byte, .. } => {
            let code = if path.is_empty() { vec![false] } else { path.clone() };
            codes.insert(*byte, code);
        }
        Node::Internal { left, right, .. } => {
            path.push(false);
            walk(left, path, codes);
            path.pop();
            path.push(true);
            walk(right, path, codes);
            path.pop();
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Encoded {
    pub bytes: Vec<u8>,
    pub bits: usize,
}

pub fn encode(data: &[u8], codes: &HashMap<u8, Vec<bool>>) -> Encoded {
    let mut bits: Vec<bool> = Vec::new();
    for b in data {
        bits.extend_from_slice(&codes[b]);
    }

    let mut bytes = vec![0u8; bits.len().div_ceil(8)];
    for (i, &bit) in bits.iter().enumerate() {
        if bit {
            bytes[i / 8] |= 1 << (7 - i % 8);
        }
    }
    Encoded { bits: bits.len(), bytes }
}

pub fn decode(enc: &Encoded, root: &Node) -> Vec<u8> {
    // A one-symbol tree has no edges, so each bit stands for the only byte.
    if let Node::Leaf { byte, .. } = root {
        return vec![*byte; enc.bits];
    }

    let mut out = Vec::new();
    let mut node = root;
    for i in 0..enc.bits {
        let bit = enc.bytes[i / 8] >> (7 - i % 8) & 1 == 1;
        node = match node {
            Node::Internal { left, right, .. } => {
                if bit {
                    right
                } else {
                    left
                }
            }
        };
        if let Node::Leaf { byte, .. } = node {
            out.push(*byte);
            node = root;
        }
    }
    out
}

pub fn run() -> (usize, usize) {
    let data = CORPUS.as_bytes();
    let tree = build_tree(&frequencies(data)).expect("the corpus is not empty");
    let codes = build_codes(&tree);
    let enc = encode(data, &codes);

    let back = decode(&enc, &tree);
    assert_eq!(back, data, "the round trip lost something");
    println!("{}", String::from_utf8_lossy(&back[..60]));

    let before = data.len();
    let after = enc.bytes.len();
    println!(
        "{before} bytes -> {after} bytes, {:.2}x smaller, {:.2} bits per byte",
        before as f64 / after as f64,
        enc.bits as f64 / before as f64
    );
    (before, after)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_paragraph_shrinks_and_comes_back() {
        let (before, after) = run();
        assert_eq!(before, 430);
        assert_eq!(after, 233);
        assert!(before as f64 / after as f64 > 1.8);
    }

    #[test]
    fn everything_round_trips() {
        for text in ["a", "ab", "aaaa", "hello world", CORPUS, "\u{0}\u{7f}\u{ff}"] {
            let data = text.as_bytes();
            let tree = build_tree(&frequencies(data)).unwrap();
            let codes = build_codes(&tree);
            let enc = encode(data, &codes);
            assert_eq!(decode(&enc, &tree), data, "{text:?}");
        }
    }

    #[test]
    fn the_padding_is_not_decoded() {
        let data = CORPUS.as_bytes();
        let tree = build_tree(&frequencies(data)).unwrap();
        let enc = encode(data, &build_codes(&tree));
        assert_eq!(enc.bytes.len() * 8 - enc.bits, 5);

        let overrun = Encoded { bytes: enc.bytes.clone(), bits: enc.bytes.len() * 8 };
        assert!(decode(&overrun, &tree).len() > data.len());
    }

    #[test]
    fn a_tree_with_one_leaf_still_decodes() {
        let data = b"zzzzzzz";
        let tree = build_tree(&frequencies(data)).unwrap();
        let enc = encode(data, &build_codes(&tree));
        assert_eq!(enc.bits, 7);
        assert_eq!(decode(&enc, &tree), data);
    }
}
```

```solution
use std::cmp::{Ordering, Reverse};
use std::collections::{BinaryHeap, HashMap};

pub const CORPUS: &str = "Every language answers one question: when is it safe to free this memory? C makes you answer by hand and punishes mistakes. Java and Python refuse to answer and pay a collector to keep asking. Rust answers at compile time, and the price is that you say who owns what. Every value has one owner. When the owner goes out of scope, the value is dropped. Ownership can be given away, and afterwards the old binding is statically dead.";

#[derive(Debug, PartialEq, Eq)]
pub enum Node {
    Leaf { byte: u8, freq: usize },
    Internal { freq: usize, left: Box<Node>, right: Box<Node> },
}

impl Node {
    pub fn freq(&self) -> usize {
        match self {
            Node::Leaf { freq, .. } | Node::Internal { freq, .. } => *freq,
        }
    }

    /// The smallest byte anywhere under this node. Every byte appears at
    /// exactly one leaf, so no two nodes can share this value.
    pub fn low_byte(&self) -> u8 {
        match self {
            Node::Leaf { byte, .. } => *byte,
            Node::Internal { left, right, .. } => left.low_byte().min(right.low_byte()),
        }
    }
}

impl Ord for Node {
    fn cmp(&self, other: &Node) -> Ordering {
        self.freq()
            .cmp(&other.freq())
            .then_with(|| self.low_byte().cmp(&other.low_byte()))
    }
}

impl PartialOrd for Node {
    fn partial_cmp(&self, other: &Node) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

pub fn frequencies(data: &[u8]) -> HashMap<u8, usize> {
    let mut counts = HashMap::new();
    for &b in data {
        *counts.entry(b).or_insert(0) += 1;
    }
    counts
}

pub fn build_tree(freqs: &HashMap<u8, usize>) -> Option<Node> {
    let mut heap: BinaryHeap<Reverse<Node>> = freqs
        .iter()
        .map(|(&byte, &freq)| Reverse(Node::Leaf { byte, freq }))
        .collect();

    while heap.len() > 1 {
        let Reverse(left) = heap.pop()?;
        let Reverse(right) = heap.pop()?;
        heap.push(Reverse(Node::Internal {
            freq: left.freq() + right.freq(),
            left: Box::new(left),
            right: Box::new(right),
        }));
    }
    heap.pop().map(|Reverse(root)| root)
}

pub fn build_codes(root: &Node) -> HashMap<u8, Vec<bool>> {
    let mut codes = HashMap::new();
    let mut path = Vec::new();
    walk(root, &mut path, &mut codes);
    codes
}

fn walk(node: &Node, path: &mut Vec<bool>, codes: &mut HashMap<u8, Vec<bool>>) {
    match node {
        Node::Leaf { byte, .. } => {
            let code = if path.is_empty() { vec![false] } else { path.clone() };
            codes.insert(*byte, code);
        }
        Node::Internal { left, right, .. } => {
            path.push(false);
            walk(left, path, codes);
            path.pop();
            path.push(true);
            walk(right, path, codes);
            path.pop();
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Encoded {
    pub bytes: Vec<u8>,
    pub bits: usize,
}

pub fn encode(data: &[u8], codes: &HashMap<u8, Vec<bool>>) -> Encoded {
    let mut bits: Vec<bool> = Vec::new();
    for b in data {
        bits.extend_from_slice(&codes[b]);
    }

    let mut bytes = vec![0u8; bits.len().div_ceil(8)];
    for (i, &bit) in bits.iter().enumerate() {
        if bit {
            bytes[i / 8] |= 1 << (7 - i % 8);
        }
    }
    Encoded { bits: bits.len(), bytes }
}

pub fn decode(enc: &Encoded, root: &Node) -> Vec<u8> {
    // A one-symbol tree has no edges, so each bit stands for the only byte.
    if let Node::Leaf { byte, .. } = root {
        return vec![*byte; enc.bits];
    }

    let mut out = Vec::new();
    let mut node = root;
    for i in 0..enc.bits {
        let bit = enc.bytes[i / 8] >> (7 - i % 8) & 1 == 1;
        node = match node {
            Node::Internal { left, right, .. } => {
                if bit {
                    right
                } else {
                    left
                }
            }
            Node::Leaf { .. } => unreachable!("a leaf is reset to the root immediately"),
        };
        if let Node::Leaf { byte, .. } = node {
            out.push(*byte);
            node = root;
        }
    }
    out
}

pub fn run() -> (usize, usize) {
    let data = CORPUS.as_bytes();
    let tree = build_tree(&frequencies(data)).expect("the corpus is not empty");
    let codes = build_codes(&tree);
    let enc = encode(data, &codes);

    let back = decode(&enc, &tree);
    assert_eq!(back, data, "the round trip lost something");
    println!("{}", String::from_utf8_lossy(&back[..60]));

    let before = data.len();
    let after = enc.bytes.len();
    println!(
        "{before} bytes -> {after} bytes, {:.2}x smaller, {:.2} bits per byte",
        before as f64 / after as f64,
        enc.bits as f64 / before as f64
    );
    (before, after)
}
```

@hint `Node` has two variants and the `match` handles one. The other is reachable as far as the compiler can tell.
@hint The loop resets `node` to the root the instant it lands on a leaf, so a leaf is never the thing being descended from. The compiler cannot see that, and wants the arm anyway.
@hint `Node::Leaf { .. } => unreachable!("a leaf is reset to the root immediately")`.

@diagnose E0004
`non-exhaustive patterns: `&Node::Leaf { .. }` not covered`.

Exhaustiveness is checked against the type, not against what the surrounding
code makes possible. `node` is a `&Node`, `Node` has two variants, so two arms
have to exist even though the loop guarantees one of them never runs.

That is a fair trade. The invariant lives in the two lines just below, and
those lines could be changed by someone who never reads this `match`.
`unreachable!` states the assumption where it applies, panics with your message
if it is ever wrong, and keeps working when a third variant is added: at that
point the compiler points here again. A `_ =>` arm would swallow the new
variant instead, which is why naming the variant is worth the extra characters.

@diagnose E0308
`expected `&Node`, found `&Box<Node>``, if the arm returns `left` or `right`
directly and the coercion cannot be applied. Assignment is a coercion site and
`&Box<Node>` derefs to `&Node`, so this usually resolves on its own. When it
does not, `left.as_ref()` says it explicitly.

@diagnose E0716
A temporary dropped while borrowed, from writing something like `node = &*root
.left` on a value that does not outlive the loop. Every node in this walk is
borrowed out of the tree that `run` owns, so keep `node` a plain `&Node` into
that tree and never build an intermediate.

@after
430 bytes of English become 233, about 1.85 times smaller, at 4.32 bits per
byte where the original spent 8. That is close to the entropy of the byte
distribution, which is the most a code with one fixed codeword per symbol can
ever get.

Doing better means dropping that restriction. Arithmetic coding gives symbols
fractional bit lengths and beats Huffman by a few percent. LZ77, which is the
other half of DEFLATE, notices that `answers` appears four times in this
paragraph and replaces the repeats with a distance and a length before Huffman
ever sees them; on this corpus `gzip` reaches about 2.4 times. Both are
attacking the same weakness, which is that counting single bytes throws away
everything about the order they came in.

One honest gap: nothing here writes the tree down. Compressing to 233 bytes is
only a saving if the decoder can rebuild the same tree, and a real format
either ships a canonical code table (DEFLATE spends a few dozen bytes on it) or
agrees on a fixed one in advance.
