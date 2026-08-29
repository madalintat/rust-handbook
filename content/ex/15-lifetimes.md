---
unit: 15-lifetimes
---

## 1. Which one did it borrow from

@kind fix
@concept lifetime
@expect E0106

`longest` takes two references and gives one back. The compiler cannot work out
which of the two the result borrows from, and it refuses to guess — so it asks
you.

Nothing about this function is wrong. It is missing one piece of information
that only the signature can carry.

```starter
pub fn longest(a: &str, b: &str) -> &str {
    if a.len() >= b.len() { a } else { b }
}

pub fn run() -> String {
    let short = String::from("traits");
    let long = String::from("lifetimes");
    longest(&short, &long).to_string()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn picks_the_longer() {
        assert_eq!(run(), "lifetimes");
    }
}
```

```solution
pub fn longest<'a>(a: &'a str, b: &'a str) -> &'a str {
    if a.len() >= b.len() { a } else { b }
}

pub fn run() -> String {
    let short = String::from("traits");
    let long = String::from("lifetimes");
    longest(&short, &long).to_string()
}
```

@hint The returned reference borrows from `a` on one path and from `b` on the other. Say so.
@hint Declare a lifetime parameter on the function and give it to all three positions.
@hint `pub fn longest<'a>(a: &'a str, b: &'a str) -> &'a str`. The call site needs no change at all.

@diagnose E0106
`missing lifetime specifier — expected named lifetime parameter`, with a note
that the signature says whether it is borrowed from `a` or `b`.

Read that literally. The compiler is not asking how long anything lives. It is
asking *which input the output borrows from*, because that is a fact about your
function that the body knows and the signature does not state. Callers only ever
see the signature, so the answer has to live there.

Writing `<'a>` on all three positions answers "from either — treat them as one
region". That claim is checked: the caller must supply two references whose
regions overlap far enough to cover the result. It does not make anything live
longer.

@diagnose E0621
You annotated some positions and not others. If the output is `&'a str`, then
every input it could be returned from must also be `&'a`. Give `a` and `b` the
same lifetime name as the return type.

@after
`'a` here is deliberately weaker than the truth. The result really borrows from
`a` *or* `b`, but the type system has no "or", so both inputs are pushed into one
region — the shorter of the two lives. That costs you nothing here and is
occasionally too strict in real code.

Notice what did not change: the call site. Lifetime parameters are inferred at
every call, the same way generic type parameters are. You will write turbofish
for a type long before you write one for a lifetime.

## 2. A struct that holds a borrow

@kind fix
@concept lifetime
@expect E0106

A struct field of type `&str` is a reference to something the struct does not
own. That means a value of this type is only valid while whatever it points at
is still alive — and the type has to say so.

```starter
pub struct Excerpt {
    pub part: &str,
}

pub fn run() -> String {
    let novel = String::from("Call me Ishmael. Some years ago I sailed.");
    let first = novel.split('.').next().expect("no sentence");
    let e = Excerpt { part: first };
    e.part.to_string()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn holds_a_slice() {
        assert_eq!(run(), "Call me Ishmael");
    }
}
```

```solution
pub struct Excerpt<'a> {
    pub part: &'a str,
}

pub fn run() -> String {
    let novel = String::from("Call me Ishmael. Some years ago I sailed.");
    let first = novel.split('.').next().expect("no sentence");
    let e = Excerpt { part: first };
    e.part.to_string()
}
```

@hint Elision has three rules and all of them are about `fn` signatures. Struct fields get none of them.
@hint The struct needs a lifetime parameter, declared where a generic type parameter would go, and used on the field.
@hint `pub struct Excerpt<'a> { pub part: &'a str }`.

@diagnose E0106
`missing lifetime specifier` on the field, with `expected named lifetime
parameter` and a suggestion to add `<'a>`.

Lifetime elision only applies to function signatures. A struct field gets no
rules at all, because there is nothing to elide *from* — a struct has no
arguments to borrow one from.

What `<'a>` adds is a constraint, not a field. It makes the type read: *an
`Excerpt<'a>` may not outlive the `'a` its `part` came from.* The struct still
occupies exactly sixteen bytes, a pointer and a length. The parameter costs
nothing and exists only so the checker can reject an `Excerpt` that outlives its
novel.

@diagnose E0261
`use of undeclared lifetime name 'a`. You used `'a` on the field but did not
declare it on the struct. Lifetime parameters are declared in the same angle
brackets as type parameters: `struct Excerpt<'a>`.

@after
A struct holding `&'a str` is a **view** over someone else's buffer: no
allocation, no copying, and it can never outlive what it borrowed. That is the
right shape for a parser, a tokeniser, or a zero-copy request header.

It is the wrong shape the moment the value has to be stored somewhere long-lived
or sent to another thread. Then the field wanted to be a `String`. The choice
between the two is a design decision about your data, and the annotation is only
how you write the decision down.

## 3. You cannot return a local

@kind fix
@concept dangling reference
@expect E0515

`banner` builds a new string and hands back a slice of it. The string is a local,
so it is dropped when `banner` returns — and the slice would point at freed
memory.

No lifetime annotation can fix this one. Change the signature so it can be true.

```starter
pub fn banner(title: &str) -> &str {
    let framed = format!("== {title} ==");
    &framed
}

pub fn run() -> String {
    banner("lifetimes").to_string()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn frames_the_title() {
        assert_eq!(run(), "== lifetimes ==");
    }
}
```

```solution
pub fn banner(title: &str) -> String {
    format!("== {title} ==")
}

pub fn run() -> String {
    banner("lifetimes")
}
```

@hint Ask what the returned reference would point at once `banner`'s frame is gone.
@hint There is nothing in the caller for this slice to borrow from — `framed` is created inside the function and belongs to it.
@hint Return the owned `String` itself. `format!` already allocated one; hand it over instead of pointing at it.

@diagnose E0515
`cannot return reference to local variable framed — returns a reference to data
owned by the current function`.

This is the exact bug the borrow checker exists to prevent, in its purest form:
in C, returning `&framed` compiles, works in a debug build, and reads reused
stack memory under load.

The important part is that **no annotation fixes it.** Beginners try `-> &'static
str`, and `'static` is a well-formed claim that is simply false. Others try
adding `<'a>`, but `'a` would have to come from an input, and `framed` came from
neither input. The value was created here, so it must leave here by value.

@diagnose E0106
You removed the reference from the return type but not from the body, or the
other way round. With no input reference to borrow from, `-> &str` has no region
it could possibly name — which is `E0106` telling you the same thing `E0515`
did, one step earlier.

@after
The rule to carry: **return owned, accept borrowed.** `fn banner(title: &str) ->
String` is the shape almost every string-building function in the standard
library has — `to_uppercase`, `join`, `replace`, `format!`. They all take a view
and produce an allocation, because there is no other honest option.

The mirror image is a function like `str::trim`, which returns `&str` — it can,
because it returns a slice *of its input*, which the caller already owns.

## 4. Something died too early

@kind fix
@concept borrow checker
@expect E0597

The loop finds the longest word and keeps a slice of it. The slice outlives the
string it points into, by exactly one closing brace.

The annotation is not the problem here. The *scopes* are.

```starter
pub fn run() -> usize {
    let words = vec!["a", "bb", "ccc"];
    let mut best: &str = "";

    {
        let joined = words.join("-");
        for w in joined.split('-') {
            if w.len() > best.len() {
                best = w;
            }
        }
    }

    best.len()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finds_the_longest() {
        assert_eq!(run(), 3);
    }
}
```

```solution
pub fn run() -> usize {
    let words = vec!["a", "bb", "ccc"];
    let mut best: &str = "";

    let joined = words.join("-");
    for w in joined.split('-') {
        if w.len() > best.len() {
            best = w;
        }
    }

    best.len()
}
```

@hint `best` is used after the inner block. What is it pointing at by then?
@hint `joined` owns a heap buffer and every slice from `split` points into it. The buffer is freed at the closing brace.
@hint The borrowed value has to outlive every use of the borrow. Move `let joined = ...` out to the function's scope.

@diagnose E0597
`joined does not live long enough — borrowed value does not live long enough`,
with `joined dropped here while still borrowed` on the closing brace and
`borrow later used here` on `best.len()`.

Follow the three underlines in order and the whole argument is there: the borrow
starts inside the block, the owner is dropped at the brace, and the borrow is
read after that. Those three facts cannot all be true, so one has to move.

`best` is not doing anything exotic. Its type is `&'x str` for some region `'x`
the compiler is solving for, and `'x` has to stretch to `best.len()`. Every slice
assigned into it must be valid for all of `'x`, and slices of `joined` are not.

@diagnose E0716
Same story with a temporary instead of a named local: the value was never bound
to anything, so it is dropped at the end of its statement. Bind it to a `let`
first, in a scope that outlives the borrow.

@after
The fix was to change where the *data* lives, not to change an annotation — and
that is the usual shape of an `E0597` fix. The error is a statement about scopes,
so the repair is almost always in the scopes.

Worth noticing that the compiler tracks this at the level of individual borrows,
not whole scopes. Since non-lexical lifetimes landed, a borrow ends at its last
*use*, not at the end of the block, which is why plenty of code that would have
been rejected years ago now compiles unchanged.

## 5. Elision guessed self

@kind fix
@concept lifetime elision
@expect E0621

The signature below is what elision produces for `fn find_in(&self, text: &str)
-> Option<&str>`, written out longhand so you can see it. Rule 3 tied the output
to `self`. The body returns a slice of `text`.

Fix the signature so it describes what the body actually does.

```starter
pub struct Matcher {
    pub pattern: String,
}

impl Matcher {
    pub fn find_in<'a>(&'a self, text: &str) -> Option<&'a str> {
        let i = text.find(&self.pattern)?;
        Some(&text[i..i + self.pattern.len()])
    }
}

pub fn run() -> String {
    let m = Matcher { pattern: String::from("rust") };
    let text = String::from("learning rust today");
    m.find_in(&text).unwrap_or("none").to_string()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finds_the_pattern() {
        assert_eq!(run(), "rust");
    }
}
```

```solution
pub struct Matcher {
    pub pattern: String,
}

impl Matcher {
    pub fn find_in<'t>(&self, text: &'t str) -> Option<&'t str> {
        let i = text.find(&self.pattern)?;
        Some(&text[i..i + self.pattern.len()])
    }
}

pub fn run() -> String {
    let m = Matcher { pattern: String::from("rust") };
    let text = String::from("learning rust today");
    m.find_in(&text).unwrap_or("none").to_string()
}
```

@hint The output is tied to `&'a self`, but the value returned came from `text`. Which of those two is the slice actually part of?
@hint The returned slice comes from `text`, not from the `Matcher`. Give `text` a lifetime name and use it on the return type.
@hint `pub fn find_in<'t>(&self, text: &'t str) -> Option<&'t str>`. Leave `&self` elided — it is genuinely unrelated.

@diagnose E0621
`explicit lifetime required in the type of text`, with a suggestion to add
`&'a str`.

Apply the elision rules by hand and the complaint is obvious. Rule 1 gives every
input reference its own parameter: `&'s self` and `text: &'t str`. Rule 3 then
fires — a `&self` parameter is present, so every elided *output* lifetime becomes
`'s`. The signature the compiler ended up with is `fn find_in<'s, 't>(&'s self,
text: &'t str) -> Option<&'s str>` — the output tied to `self`.

Your body returns a slice of `text`, which is `&'t str`. Nothing relates `'t` to
`'s`, so the claim cannot be checked, and rustc asks you to state the real one.

@diagnose E0106
You gave the return type a name that is not declared, or declared `'t` without
attaching it to `text`. The lifetime on the output must come from a parameter
that is actually annotated with it.

@after
Rule 3 exists because it is right almost every time. Methods overwhelmingly
return a piece of `self` — `as_str`, `iter`, `get`, `last`. Making that the
default removes an annotation from nearly every method in every codebase.

The price is this exercise: when a method returns something borrowed from an
*argument*, elision quietly produces the wrong signature and you get an error
about a lifetime you never wrote. The tell is `E0621` naming a parameter. When
you see it, write the elided signature out longhand — the mismatch is always
visible once it is on the page.

## 6. The bound, not the reference

@kind fix
@concept static
@expect E0310

`boxed` puts any `Debug` value in a box. That box is a `Box<dyn Debug>`, which
carries a hidden `+ 'static` — so the compiler wants a promise about `T` that the
signature does not make.

This is the second meaning of `'static`, and it is not the one about literals.

```starter
use std::fmt::Debug;

pub fn boxed<T: Debug>(v: T) -> Box<dyn Debug> {
    Box::new(v)
}

pub fn run() -> String {
    format!("{:?} {:?}", boxed(7), boxed(String::from("ferris")))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn boxes_anything_owned() {
        assert_eq!(run(), "7 \"ferris\"");
    }
}
```

```solution
use std::fmt::Debug;

pub fn boxed<T: Debug + 'static>(v: T) -> Box<dyn Debug> {
    Box::new(v)
}

pub fn run() -> String {
    format!("{:?} {:?}", boxed(7), boxed(String::from("ferris")))
}
```

@hint `Box<dyn Debug>` is shorthand. Write out the lifetime it defaults to.
@hint The trait object promises it holds no short-lived borrows, so `T` has to promise the same thing.
@hint Add the bound the compiler names: `T: Debug + 'static`. Both `i32` and `String` satisfy it.

@diagnose E0310
`the parameter type T may not live long enough`, with `consider adding an
explicit lifetime bound: T: 'static`.

`Box<dyn Debug>` is sugar for `Box<dyn Debug + 'static>`; a trait object gets
`'static` by default in this position. So the return type promises the boxed
value holds no borrow that could expire, while `T` is any type at all — possibly
`&'a str` for some caller's short `'a`.

Read `T: 'static` correctly and the bound stops being frightening. It does not
mean *lives forever*, and it does not mean *is a literal*. It means **this type
contains no reference with a lifetime shorter than the program**. `String`,
`i32`, `Vec<u8>` and `&'static str` all satisfy it. `&'a str` for a local `'a`
does not.

@diagnose E0277
`T doesn't implement Debug` — you removed the `Debug` bound while adding
`'static`. `T` needs both: `T: Debug + 'static`.

@after
The reference form and the bound form share five characters and almost nothing
else.

| written | means |
|---|---|
| `&'static str` | *this reference* is valid for the whole program run |
| `T: 'static` | *this type* holds no borrow shorter than the program |

`thread::spawn` is where this matters in practice. It requires `F: Send +
'static`, and reading that as "must live forever" sends people looking for
`Box::leak`. It only means the closure may not capture a borrow of a local,
because the thread can outlive the frame it was spawned from. Moving an owned
`String` in satisfies it perfectly.

## 7. The parser outlived by its output

@kind fix
@concept lifetime
@expect E0597

`Parser<'a>` borrows a source string. `rest` returns a slice — but of *what*?
Elision says "of the parser", so the slice dies when the parser does. The body
says "of the source text", which lives much longer.

One annotation makes the signature tell the truth.

```starter
pub struct Parser<'a> {
    pub src: &'a str,
    pub pos: usize,
}

impl<'a> Parser<'a> {
    pub fn rest(&self) -> &str {
        &self.src[self.pos..]
    }
}

pub fn run() -> String {
    let text = String::from("key=value");
    let tail;

    {
        let p = Parser { src: &text, pos: 4 };
        tail = p.rest();
    }

    tail.to_string()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tail_outlives_the_parser() {
        assert_eq!(run(), "value");
    }
}
```

```solution
pub struct Parser<'a> {
    pub src: &'a str,
    pub pos: usize,
}

impl<'a> Parser<'a> {
    pub fn rest(&self) -> &'a str {
        &self.src[self.pos..]
    }
}

pub fn run() -> String {
    let text = String::from("key=value");
    let tail;

    {
        let p = Parser { src: &text, pos: 4 };
        tail = p.rest();
    }

    tail.to_string()
}
```

@hint Do not touch `run`. The scopes there are correct — `text` outlives everything that borrows it.
@hint `self.src` is a `&'a str`, and slicing it gives another `&'a str`. The return type is throwing that away.
@hint Name the lifetime on the return type: `pub fn rest(&self) -> &'a str`.

@diagnose E0597
`p does not live long enough`, pointing at the inner block's closing brace and
at `tail.to_string()`.

The complaint is about `p`, and `p` is not what the data came from. That mismatch
is the lesson. Elision rule 3 gave `rest` the signature `fn rest<'s>(&'s self) ->
&'s str`, so as far as every caller is concerned, the returned slice borrows the
*parser*. `p` dies at the brace, so the borrow must end there too.

The body was always returning a slice of `self.src`, which is `&'a str` — good
for as long as `text` lives. `'a` outlives `'s`; the signature simply threw the
information away. Writing `-> &'a str` puts it back.

@diagnose E0621
You annotated the argument rather than the return type, or introduced a fresh
lifetime with no relation to `'a`. The lifetime you want is the one already on
the `impl` block, because that is the one the source string has.

@after
This is what `struct Parser<'a>` buys you and it is worth seeing at least once.
The parser is a cursor: cheap to make, cheap to throw away, and the tokens it
hands out are slices of the original input that keep working after it is gone. No
allocation happens anywhere in the whole design.

That is the shape of every fast parser in Rust — `serde_json`'s borrowed strings,
`nom`'s combinators, `httparse`'s headers. The `'a` on the struct is what makes
the output outlive the machinery that produced it.

## 8. An iterator that yields borrows

@kind write
@concept lifetime
@expect E0726

`Words` is a hand-written iterator over the whitespace-separated words of a
string. It yields slices of the original rather than allocating a `String` per
word, which is the whole reason to write it by hand.

Two things are wrong. The `impl` header does not mention the lifetime the type
carries, and `next` is unwritten. Take the compiler's suggested fix here with
suspicion — it is mechanical, and it is not the one you want.

```starter
pub struct Words<'a> {
    rest: &'a str,
}

impl<'a> Words<'a> {
    pub fn new(src: &'a str) -> Self {
        Words { rest: src }
    }
}

impl<'a> Iterator for Words {
    type Item = &'a str;

    fn next(&mut self) -> Option<Self::Item> {
        todo!("skip leading spaces, split off one word, keep the remainder")
    }
}

pub fn run() -> String {
    Words::new("  one two   three ").collect::<Vec<_>>().join("|")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn splits_on_runs_of_spaces() {
        assert_eq!(run(), "one|two|three");
    }

    #[test]
    fn empty_input_yields_nothing() {
        assert_eq!(Words::new("   ").count(), 0);
    }
}
```

```solution
pub struct Words<'a> {
    rest: &'a str,
}

impl<'a> Words<'a> {
    pub fn new(src: &'a str) -> Self {
        Words { rest: src }
    }
}

impl<'a> Iterator for Words<'a> {
    type Item = &'a str;

    fn next(&mut self) -> Option<Self::Item> {
        let trimmed = self.rest.trim_start();
        if trimmed.is_empty() {
            return None;
        }
        let end = trimmed.find(' ').unwrap_or(trimmed.len());
        let (word, rest) = trimmed.split_at(end);
        self.rest = rest;
        Some(word)
    }
}

pub fn run() -> String {
    Words::new("  one two   three ").collect::<Vec<_>>().join("|")
}
```

@hint `Words` is not a type on its own. `Words<'a>` is. The header has to name the parameter it is implementing for.
@hint For `next`: `trim_start` the remainder, return `None` if nothing is left, then `find(' ')` to locate the end of the word — falling back to the whole string when there is no space.
@hint `impl<'a> Iterator for Words<'a>`, and `str::split_at(end)` hands you `(word, remainder)` in one step. Store the remainder back into `self.rest` and return the word.

@diagnose E0726
`implicit elided lifetime not allowed here — expected lifetime parameter`,
pointing at `Words` in the `impl` header, with a suggestion to write `Words<'_>`.

`Words` on its own is not a type. Every `Words` value is a `Words<'a>` for some
particular `'a`, so an `impl` block has to say which one, exactly as it would for
a generic type parameter. The `<'a>` after `impl` *declares* a name; the `<'a>`
after `Words` is where you *use* it.

Take the suggestion literally and you trade this error for a worse one.
`Words<'_>` means "some anonymous lifetime", which leaves the `'a` in
`type Item = &'a str` unconstrained and unrelated to the struct's slice. The
declared name and the used name have to be the same one.

@diagnose E0207
`the lifetime parameter 'a is not constrained by the impl trait, self type, or
predicates`. You declared `impl<'a>` but wrote `Words<'_>` or plain `Words`
after it, so `'a` appears nowhere the compiler can infer it from. Use it on the
self type: `impl<'a> Iterator for Words<'a>`.

@diagnose E0308
`next` is returning the wrong shape. Every path must produce
`Option<Self::Item>` — `None`, or `Some(slice)`. A bare `&str`, or an
`Option<String>` from calling `to_string`, will both land here.

@after
Note where `Item`'s lifetime came from: the **struct**, not `&mut self`. That is
what lets the slices outlive the iterator — you can `collect` them, sort them,
and still be holding them long after the `Words` value is gone.

An iterator whose items borrowed from `&mut self` instead could not do that, and
`Iterator` cannot even express one: `Item` is declared without lifetime
parameters, so it has no way to mention the borrow `next` was called with. That
limitation is the reason `std` has a `windows` but no `windows_mut`, and the
reason lending iterators need generic associated types.

The payoff is that `Words` never allocates. `collect::<Vec<_>>()` builds a vector
of sixteen-byte slice handles all pointing into one string, where the obvious
version would have made three separate heap allocations.
