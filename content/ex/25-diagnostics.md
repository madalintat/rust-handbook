---
unit: 25-diagnostics
---

## 1. The annotation that lied

@kind fix
@concept mismatched types
@expect E0308

The most common error in the language, and the easiest to read once you know the
shape. rustc prints two types: the one it **expected** and the one it **found**.
Expected always comes from the thing that was declared; found always comes from
the thing that was written.

Read which is which, then decide which of the two is wrong.

```starter
pub fn line_count(text: &str) -> usize {
    text.lines().count()
}

pub fn run() -> String {
    let text = "alpha\nbeta\ngamma";
    let n: String = line_count(text);
    format!("{n} lines")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_lines() {
        assert_eq!(run(), "3 lines");
    }
}
```

```solution
pub fn line_count(text: &str) -> usize {
    text.lines().count()
}

pub fn run() -> String {
    let text = "alpha\nbeta\ngamma";
    let n = line_count(text);
    format!("{n} lines")
}
```

@hint Two things declare a type on that line. One of them is right.
@hint `line_count` returns `usize`. The annotation on `n` claims otherwise, and the annotation is the thing that was invented.
@hint Delete `: String`. Inference will take the type from the call.

@diagnose E0308
`expected String, found usize` — and the word order is the whole message.
**Expected** is what the surrounding context demanded; **found** is what the
expression actually produced. Here the context is your own annotation
`let n: String`, and the expression is `line_count(text)`, which returns `usize`.

Look at what rustc underlines. The primary `^^^^^^^^^^^^^^^^` sits under the
call — the expression that produced the wrong type — and a secondary `------`
sits under `String`, labelled `expected due to this`. That secondary marker is
rustc telling you *where the expectation came from*. Nine times out of ten the
bug is at the secondary marker, not the primary one.

@diagnose E0277
You probably reached for `to_string()` or `format!` in the wrong place and left
something that cannot be displayed. `{n}` inside `format!` requires `n` to
implement `Display`; every primitive and `String` does, so if this fired you have
given it something else — a `Vec`, a tuple, or a `Result`. `{:?}` and `Debug`
cover far more types, but here the fix is to make `n` a plain number.

@after
`expected ... found ...` is worth reading as a sentence with a subject. The
compiler never guesses at intent: it takes an expectation from the nearest thing
that declared one — an annotation, a function's return type, a struct field, the
other arm of an `if` — and reports the first expression that fails to match it.

Which means the fix is a choice, not a lookup. Either the expectation is wrong
(delete or change the annotation) or the expression is wrong (convert it). An
annotation you wrote yourself is the more suspicious of the two, because
inference would otherwise have got it right for free.

## 2. The variant nobody handled

@kind fix
@concept exhaustiveness
@expect E0004

A new variant was added to the enum and one `match` was not updated. This is the
error that makes adding an enum variant safe: the compiler finds every place
that now has a hole.

The diagnostic names the missing pattern explicitly. Use it.

```starter
pub enum Level {
    Info,
    Warn,
    Error,
}

pub fn label(l: &Level) -> &'static str {
    match l {
        Level::Info => "info",
        Level::Warn => "warn",
    }
}

pub fn run() -> String {
    let levels = [Level::Info, Level::Warn, Level::Error];
    levels.iter().map(label).collect::<Vec<_>>().join(",")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn labels_every_level() {
        assert_eq!(run(), "info,warn,error");
    }
}
```

```solution
pub enum Level {
    Info,
    Warn,
    Error,
}

pub fn label(l: &Level) -> &'static str {
    match l {
        Level::Info => "info",
        Level::Warn => "warn",
        Level::Error => "error",
    }
}

pub fn run() -> String {
    let levels = [Level::Info, Level::Warn, Level::Error];
    levels.iter().map(label).collect::<Vec<_>>().join(",")
}
```

@hint rustc has already told you the name of the pattern that is missing. Read the `note:`.
@hint Add the third arm. Resist adding `_ =>` instead — think about what happens the next time a variant is added.

@diagnose E0004
`non-exhaustive patterns: &Level::Error not covered`. The headline names the
exact pattern missing, which is unusual generosity — most errors describe a
problem, this one hands you the fix.

The primary underline is under `l`, the **scrutinee**, not under any arm. That is
deliberate: no single arm is wrong, the *set* of them is incomplete, so the
compiler points at the value being matched. A secondary marker sits on the
variant's definition in the enum, labelled `not covered`, so you can jump
straight to what you forgot.

The `help:` suggests `ensure the match is exhaustive by adding the missing
arm` — take it literally. `_ => ...` also compiles, and gives up the guarantee.

@after
This is exhaustiveness earning its keep. Add a fourth variant to `Level` and
every `match` on it becomes a compile error until you have thought about the new
case. That is a refactoring tool: change the type, then let the compiler give you
the to-do list.

`_ => "unknown"` switches it off. That arm silently absorbs every future variant,
and the bug it hides — a new `Level::Fatal` labelled `unknown` in production —
is exactly what the check existed to prevent. Use `_` when the remaining cases
genuinely are interchangeable, not to make a message go away.

## 3. Borrowed for reading, then written

@kind fix
@concept borrow
@expect E0502

`first` is a shared borrow into the vector. `push` needs a unique borrow of the
same vector. The borrow is still alive when `push` runs, so the compiler refuses.

There is a one-line fix. Find one that does not clone.

```starter
pub fn run() -> Vec<String> {
    let mut log = vec![String::from("start")];
    let first = &log[0];
    log.push(String::from("next"));
    log.push(format!("after {first}"));
    log
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn appends_using_the_first_entry() {
        assert_eq!(
            run(),
            vec!["start".to_string(), "next".to_string(), "after start".to_string()]
        );
    }
}
```

```solution
pub fn run() -> Vec<String> {
    let mut log = vec![String::from("start")];
    let entry = format!("after {}", log[0]);
    log.push(String::from("next"));
    log.push(entry);
    log
}
```

@hint The borrow is only a problem because `first` is read *after* the first `push`. Ask when the borrow could end instead.
@hint Build the new string early, while nothing else is happening to the vector. Once the `format!` has run, nothing borrows `log` any more.
@hint `let entry = format!("after {}", log[0]);` at the top, then push it last.

@diagnose E0502
Three markers, and the order they appear in tells the story backwards from the
crime.

The primary `^^^^^^^^^` is on the first `log.push(...)` — `mutable borrow occurs
here`. That is where the compiler stopped, not where the problem started. A
secondary `----` on `&log[0]` says `immutable borrow occurs here`, and a third on
`{first}` two lines below says `immutable borrow later used here`.

Read the last one first. The shared borrow is still alive *because you use it
after the push begins*. Kill that last use and the borrow ends before `push`
starts, and the error evaporates without changing a single type. Borrows end at
their last use, not at the closing brace.

@diagnose E0499
You have two unique borrows of `log` alive at once — probably from adding
`&mut` while the first borrow was still in play. Only one `&mut` to a value may
exist at a time; that is the entire rule. The fix is the same shape as for
E0502: shorten the first borrow so it ends before the second begins.

@after
The mechanism worth naming here is **non-lexical lifetimes**. A borrow lives from
where it is created to its *last use*, not to the end of the block. Which is why
moving one line up the file is a real fix and not a trick: it changes where the
last use is.

That also explains why the third marker — `immutable borrow later used here` —
is the important one. If nothing used `first` after the `push`, the borrow would
already have been dead and there would be no conflict. When you hit E0502, look
for the `later used here` label and ask whether that use can move earlier or
disappear.

## 4. No method named, which is not about the method

@kind fix
@concept trait bound
@expect E0599

`Retry` implements `Describe`, and `describe` is spelled correctly. rustc still
says no such method exists. Both facts are true at once, and the reason is the
single most misread diagnostic in Rust.

Read the `help:` line at the bottom before you touch anything.

```starter
pub trait Describe {
    fn describe(&self) -> String;
}

pub struct Retry(pub u32);

impl Describe for Retry {
    fn describe(&self) -> String {
        format!("retry {}", self.0)
    }
}

pub fn summarise<T>(items: &[T]) -> String {
    items.iter().map(|i| i.describe()).collect::<Vec<_>>().join(", ")
}

pub fn run() -> String {
    summarise(&[Retry(1), Retry(2)])
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn summarises_each_item() {
        assert_eq!(run(), "retry 1, retry 2");
    }
}
```

```solution
pub trait Describe {
    fn describe(&self) -> String;
}

pub struct Retry(pub u32);

impl Describe for Retry {
    fn describe(&self) -> String {
        format!("retry {}", self.0)
    }
}

pub fn summarise<T: Describe>(items: &[T]) -> String {
    items.iter().map(|i| i.describe()).collect::<Vec<_>>().join(", ")
}

pub fn run() -> String {
    summarise(&[Retry(1), Retry(2)])
}
```

@hint Inside `summarise`, what does the compiler know about `T`? Not that it is a `Retry` — it only knows what the signature promised.
@hint The signature promised nothing, so `T` could be `u8` or `File`. Neither has `describe`.
@hint `pub fn summarise<T: Describe>(items: &[T]) -> String`

@diagnose E0599
`no method named describe found for reference &T in the current scope`. Almost
nobody reads this correctly the first time, because it sounds like a typo report.
It is not.

The compiler is checking `summarise` **once**, generically, knowing only what the
signature declares about `T` — which here is nothing. So `T` might be `u8`. `u8`
has no `describe`. Error. The `impl Describe for Retry` is irrelevant, because
the compiler is not looking at `Retry` yet.

The tell is the `help:` at the bottom: `consider restricting type parameter T`
with a suggested `T: Describe`. When E0599 offers that help, the method exists
and the bound is missing.

@diagnose E0308
Your bound probably landed in the wrong place, or the closure now returns
something other than `String`. `map(|i| i.describe())` yields `String`, and
`collect::<Vec<_>>().join(", ")` needs a `Vec<String>` or `Vec<&str>`. Check that
you did not change the closure body while adding the bound.

@after
E0599 has three causes and only one of them is a typo:

| what the help says | what is really wrong |
|---|---|
| `consider restricting type parameter T` | a **trait bound** is missing on a generic |
| `items from traits can only be used if the trait is in scope` | the trait exists but you need `use some::Trait;` |
| `there is a method with a similar name` | it genuinely is a typo |

The second is the one that catches everyone with `std::io::Write`: `write!` on a
`File` fails with E0599 until `use std::io::Write;` is at the top. The method was
always implemented — you just had not imported the vocabulary to name it.

## 5. Printable, but not Display

@kind fix
@concept trait bound
@expect E0277

`{}` and `{:?}` are not two spellings of the same thing. One asks for a
user-facing rendering the type's author had to write; the other asks for a
developer-facing one that can be derived.

Give this type the rendering the format string is asking for.

```starter
pub struct Config {
    pub retries: u32,
    pub verbose: bool,
}

pub fn run() -> String {
    let c = Config { retries: 3, verbose: true };
    format!("{c}")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn renders_config() {
        assert_eq!(run(), "retries=3 verbose=true");
    }
}
```

```solution
use std::fmt;

pub struct Config {
    pub retries: u32,
    pub verbose: bool,
}

impl fmt::Display for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "retries={} verbose={}", self.retries, self.verbose)
    }
}

pub fn run() -> String {
    let c = Config { retries: 3, verbose: true };
    format!("{c}")
}
```

@hint The note says `Config` cannot be formatted with the default formatter. Something has to supply that formatting.
@hint `Display` is never derived — it is a deliberate, human-facing decision, so you write the `impl` by hand.
@hint `impl std::fmt::Display for Config { fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { write!(f, "retries={} verbose={}", self.retries, self.verbose) } }`

@diagnose E0277
`Config doesn't implement std::fmt::Display` — the headline is a *trait bound*
failure dressed in friendly words. Underneath, `format!` requires its arguments
to satisfy `T: Display`, and `Config` does not.

Two lines below are the ones that matter. `note: in format strings you may be
able to use {:?} (or {:#?} for pretty-print) instead` is rustc offering the
escape hatch: `Debug` can be derived, `Display` cannot. And `note: required by a
bound in ...` names the trait bound that was actually violated, which is where
the real explanation lives whenever E0277 fires from inside a library function.

Read `required by a bound` first. It says *who* wanted the trait, and that is
usually the part you did not know.

@diagnose E0119
You wrote a second `impl Display for Config`, or derived something that already
exists. Only one implementation of a trait for a type may exist in the whole
program — that is **coherence**. Delete the duplicate.

@after
The split is a design decision, not an oversight. `Debug` is for you: derivable,
allowed to be ugly, allowed to change between releases. `Display` is for your
user: it is part of your public interface, so the language refuses to guess it.

Two consequences worth carrying. Implementing `Display` gives you `.to_string()`
free, through a blanket impl of `ToString` for every `T: Display`. And `Display`
is what `Box<dyn Error>` and most error-reporting machinery print, which is why a
custom error type without it is so awkward to report.

E0277 in general reads "you needed trait X here and did not have it". Its most
misleading form is the one where the type is nearly right: passing `String` to
something wanting `&str`, or an iterator of `&T` to a `collect` wanting `T`. The
`required by a bound` note is what tells them apart.

## 6. The compiler cannot tell which one

@kind fix
@concept lifetime
@expect E0106

Two references go in, one comes out. rustc says it needs a lifetime specifier.
That is not a request for syntax — it is a question, and the question is *which
of the two inputs does the output borrow from?*

Answer it.

```starter
pub fn longer(a: &str, b: &str) -> &str {
    if a.len() >= b.len() { a } else { b }
}

pub fn run() -> String {
    longer("ferris", "rustacean").to_string()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn picks_the_longer() {
        assert_eq!(run(), "rustacean");
    }
}
```

```solution
pub fn longer<'a>(a: &'a str, b: &'a str) -> &'a str {
    if a.len() >= b.len() { a } else { b }
}

pub fn run() -> String {
    longer("ferris", "rustacean").to_string()
}
```

@hint The function returns `a` on one path and `b` on the other. The compiler needs one answer that covers both.
@hint Tie all three references to the same name, so the claim becomes "the result is valid for as long as *both* inputs are".
@hint `pub fn longer<'a>(a: &'a str, b: &'a str) -> &'a str`

@diagnose E0106
`missing lifetime specifier` with `expected named lifetime parameter`, and the
primary `^` sits on the `&` of the return type. The `help:` says `this
function's return type contains a borrowed value, but the signature does not say
whether it is borrowed from a or b`.

That sentence is the actual error, and it is a question about *meaning*, not
punctuation. Adding `'a` does not create anything; it records which input the
output is tied to, so callers know how long the result stays valid.

**Lifetime elision** normally writes this for you: one input reference, or a
`&self`, and the output silently borrows from it. Two candidate inputs and no
`self` is exactly the case the rules refuse to guess.

@diagnose E0621
`explicit lifetime required in the type of a` — you named a lifetime on the
return type but not on every input it can come from. If the function can return
either argument, both parameters need the same `'a`. Giving `b` its own `'b`
compiles only if `b` is never returned.

@after
`'a` is not a duration and it is not a hint. It is a **claim**: the returned
reference will not outlive whatever the caller passed in for `'a`. The compiler
then checks the claim on both sides — inside the body (do you only return things
that live that long?) and at every call site (does the caller keep the result
past the inputs?).

`longer<'a>(a: &'a str, b: &'a str) -> &'a str` says the result lives as long as
the *shorter* of the two, since `'a` unifies to whatever region satisfies both.
That is exactly right, and it is why callers keeping the result alive after one
argument dies get a clean E0597 rather than a dangling pointer.

## 7. A reference to something already gone

@kind fix
@concept lifetime
@expect E0515

`banner` builds a fresh `String` and hands out a reference to it. The `String`
lives in `banner`'s stack frame, which is dismantled the instant the function
returns.

You are free to change any signature except `run`'s.

```starter
pub fn banner(name: &str) -> &str {
    let s = format!("== {name} ==");
    &s
}

pub fn run() -> String {
    banner("ferris").to_string()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn builds_a_banner() {
        assert_eq!(run(), "== ferris ==");
    }
}
```

```solution
pub fn banner(name: &str) -> String {
    format!("== {name} ==")
}

pub fn run() -> String {
    banner("ferris")
}
```

@hint There is no way to return a reference to `s`. `s` does not survive the return, and no lifetime annotation can change that.
@hint If you built it, you own it. Return the ownership rather than a pointer into a frame that is about to disappear.
@hint `pub fn banner(name: &str) -> String { format!("== {name} ==") }` — then `run` no longer needs `.to_string()`.

@diagnose E0515
`cannot return reference to local variable s` — and the primary underline is on
`&s`, the expression being returned, with the note `returns a reference to data
owned by the current function`.

This is the one error you cannot annotate your way out of. Every other borrow
error asks you to rearrange borrows; this one says the data is about to cease
existing. In C the same code compiles and returns a pointer into a dead stack
frame, which works right up until something else reuses it.

The fix is always one of three: return the owned value, take a buffer to write
into, or return a reference derived from an *input* rather than a local. Here
the first is right.

@diagnose E0106
You changed the return type to `&'a str` and now the compiler wants to know where
`'a` comes from. It cannot come from anywhere useful: the string is built inside
the function, so no input lifetime describes it. Return `String` instead.

@after
Notice that `name` could have been returned safely — it is an input reference,
and it is alive in the caller by construction. What cannot escape is anything
created inside the frame. That is the whole distinction: a function may hand back
borrows it was *given*, never borrows it *made*.

The idiom to carry forward is **accept borrowed, return owned**. `fn banner(name:
&str) -> String` takes the most general input (a literal, a `String`, a slice of
either) and returns a value the caller owns outright. `to_uppercase`,
`to_string`, `join` and `format!` all have exactly this shape, and it is why they
compose without a single lifetime annotation.

## 8. Two unique borrows into the same vector

@kind fix
@concept borrow
@expect E0499

Index `0` and index `n - 1` are obviously different slots. rustc still refuses
two `&mut` into the same `Vec`, and understanding *why* is more useful than the
fix.

The standard library has a method for exactly this. Find it.

```starter
pub fn rebalance(counts: &mut Vec<i32>) {
    let n = counts.len();
    let first = &mut counts[0];
    let last = &mut counts[n - 1];
    let mid = (*first + *last) / 2;
    *first = mid;
    *last = mid;
}

pub fn run() -> Vec<i32> {
    let mut c = vec![10, 5, 4];
    rebalance(&mut c);
    c
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn levels_both_ends() {
        assert_eq!(run(), vec![7, 5, 7]);
    }
}
```

```solution
pub fn rebalance(counts: &mut Vec<i32>) {
    let n = counts.len();
    let (head, tail) = counts.split_at_mut(n - 1);
    let first = &mut head[0];
    let last = &mut tail[0];
    let mid = (*first + *last) / 2;
    *first = mid;
    *last = mid;
}

pub fn run() -> Vec<i32> {
    let mut c = vec![10, 5, 4];
    rebalance(&mut c);
    c
}
```

@hint `counts[0]` does not borrow the element. It calls `IndexMut` on the whole vector, and that takes `&mut self`.
@hint You need something that hands you two disjoint pieces in one call, so the compiler sees one borrow split rather than two overlapping ones.
@hint `slice::split_at_mut` returns `(&mut [T], &mut [T])` — two non-overlapping halves from a single borrow. Split at `n - 1`.

@diagnose E0499
`cannot borrow *counts as mutable more than once at a time`. Three markers: the
primary `^^^^^^` on `&mut counts[n - 1]` (`second mutable borrow occurs here`), a
secondary on `&mut counts[0]` (`first mutable borrow occurs here`), and a third
on `*first` (`first borrow later used here`).

The compiler is not being pedantic about indices — it never sees them. `counts[0]`
desugars to `IndexMut::index_mut(&mut *counts, 0)`, which borrows the **entire
vector**. Two such calls are two whole-collection borrows, and their indices are
runtime values the borrow checker has no way to compare.

That is why the fix is a different API rather than a rearrangement.

@diagnose E0502
You mixed a shared and a unique borrow — often by leaving `counts.len()` between
the two `&mut`, since `len` needs `&self`. Compute the length before the first
mutable borrow, as the starter already does.

@diagnose E0716
A temporary you borrowed was dropped at the end of its statement. Usually this
means a `&mut` was taken from something built in place — bind the value to a
variable first so it outlives the borrow.

@after
`split_at_mut` is the escape hatch, and it is worth knowing that internally it is
`unsafe`: it hands out two `&mut` derived from one, and the compiler cannot prove
they are disjoint. A human proved it once, wrote the bounds check, and published
the guarantee as a safe signature. That is the intended role of `unsafe` — a
small audited kernel exposing a checkable interface, not an escape used at the
call site.

The same shape recurs everywhere: `iter_mut` (one borrow, many disjoint items),
`chunks_mut`, `get_many_mut`, `Cell` and `RefCell` for when the disjointness is
genuinely dynamic. When you hit E0499 and the accesses really are disjoint, the
question is not "how do I persuade the checker" but "which library type already
made this argument for me".
