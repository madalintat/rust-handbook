---
unit: 10-option
---

## 1. Absence is a different type

@kind fix
@concept Option
@expect E0308

`first_even` promises to return an `Option<i32>`, a value that might not be
there. The early `return` inside the loop hands back a bare `i32` instead, and
those are not the same type.

Make the signature and the returns agree.

```starter
pub fn first_even(v: &[i32]) -> Option<i32> {
    for &n in v {
        if n % 2 == 0 {
            return n;
        }
    }
    None
}

pub fn run() -> (Option<i32>, Option<i32>) {
    (first_even(&[1, 3, 4, 5]), first_even(&[1, 3, 5]))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finds_or_reports_absence() {
        assert_eq!(run(), (Some(4), None));
    }
}
```

```solution
pub fn first_even(v: &[i32]) -> Option<i32> {
    for &n in v {
        if n % 2 == 0 {
            return Some(n);
        }
    }
    None
}

pub fn run() -> (Option<i32>, Option<i32>) {
    (first_even(&[1, 3, 4, 5]), first_even(&[1, 3, 5]))
}
```

@hint The function's two exits must produce the same type. One of them already does.
@hint `None` is an `Option<i32>`. `n` is an `i32`. Wrap it.
@hint `return Some(n);`

@diagnose E0308
`mismatched types: expected Option<i32>, found i32`, underlining `n` in the
`return`, with a second underline on the return type in the signature showing
where the expectation came from. rustc usually adds
`help: try wrapping the expression in Some`.

This is the entire value of `Option` in one error. In a language with null, a
function declared to return an integer can return "no integer" and nothing in
the type says so. Here presence and absence are genuinely different types, so
the mismatch is caught the moment you type it rather than at the caller's first
dereference.

@after
`Some(n)` is a constructor call: it takes an `i32` and builds an `Option<i32>`
around it. Because it is an ordinary function value, it composes:
`v.iter().copied().map(Some)` is legal, and `ok_or` and friends take it the same
way.

The idiomatic form of this whole function is one line:

```rust
v.iter().copied().find(|n| n % 2 == 0)
```

`Iterator::find` returns `Option<T>` precisely because "no element matched" is a
normal outcome, not an error.

## 2. An Option is not the thing inside it

@kind fix
@concept Option
@expect E0599

`shout` wants an uppercase name. It calls a `String` method on something that is
not a `String`. The receiver is an `Option<String>`, and the whole point of that
type is that the value might not be there.

Uppercase the name when there is one, and produce `"ANONYMOUS"` when there is
not.

```starter
pub fn shout(name: Option<String>) -> String {
    name.to_uppercase()
}

pub fn run() -> (String, String) {
    (
        shout(Some(String::from("ferris"))),
        shout(None),
    )
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shouts_or_falls_back() {
        assert_eq!(
            run(),
            (String::from("FERRIS"), String::from("ANONYMOUS"))
        );
    }
}
```

```solution
pub fn shout(name: Option<String>) -> String {
    name.map(|n| n.to_uppercase())
        .unwrap_or_else(|| String::from("ANONYMOUS"))
}

pub fn run() -> (String, String) {
    (
        shout(Some(String::from("ferris"))),
        shout(None),
    )
}
```

@hint You cannot call a `String` method on an `Option<String>` until you have said what happens when it is `None`.
@hint `map` applies a closure to the value inside, if there is one, and leaves `None` alone. That gets you an `Option<String>`.
@hint Then collapse it: `.unwrap_or_else(|| String::from("ANONYMOUS"))`. A `match` with two arms is equally correct.

@diagnose E0599
`no method named to_uppercase found for enum Option<String> in the current
scope`, with the note `method not found in Option<String>`.

Rust does not auto-unwrap. There is no implicit "if it is there, use it"
anywhere in the language, because that is exactly the behaviour that makes null
dangerous: it lets code that never considered absence compile.

The methods that *do* exist on `Option` are the ones that make you say what
happens in both cases: `map` transforms the present case, `unwrap_or` supplies
the absent one, `match` handles both explicitly. Pick whichever states your
intent; there is no way to say nothing.

@diagnose E0308
Your `map` closure and your fallback are producing different types, or the chain
is still an `Option<String>` where a `String` was promised. `map` leaves you
inside the `Option`, and something has to take you out of it. `unwrap_or`,
`unwrap_or_else` and `unwrap_or_default` all do.

@after
Note which fallback to reach for. `unwrap_or_else` takes a closure, so
`String::from("ANONYMOUS")` only allocates when the name is missing.
`unwrap_or(String::from("ANONYMOUS"))` allocates on every call including the
happy path, because arguments are evaluated before the call.

The rule: `unwrap_or` for values already sitting there (an integer, a `&'static
str`), `unwrap_or_else` for anything that has to be built,
`unwrap_or_default()` when the fallback is the type's own default: `0`, `""`,
`vec![]`.

## 3. One Option too many

@kind fix
@concept combinator
@expect E0308

`first_number` takes the first string in the slice and parses it. Both steps can
fail, so both produce an `Option`. Stacking them the obvious way gives you
an `Option` inside an `Option`.

Return a single `Option<i32>`: `None` if the slice is empty *or* the first entry
does not parse.

```starter
pub fn first_number(v: &[&str]) -> Option<i32> {
    v.first().map(|s| s.parse::<i32>().ok())
}

pub fn run() -> (Option<i32>, Option<i32>, Option<i32>) {
    (
        first_number(&["42", "x"]),
        first_number(&["nope"]),
        first_number(&[]),
    )
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn flattens_both_failures() {
        assert_eq!(run(), (Some(42), None, None));
    }
}
```

```solution
pub fn first_number(v: &[&str]) -> Option<i32> {
    v.first().and_then(|s| s.parse::<i32>().ok())
}

pub fn run() -> (Option<i32>, Option<i32>, Option<i32>) {
    (
        first_number(&["42", "x"]),
        first_number(&["nope"]),
        first_number(&[]),
    )
}
```

@hint Read the error's "found" type carefully. Count the `Option`s.
@hint `map` wraps whatever the closure returns in a `Some`. Your closure already returns an `Option`, so you get two layers.
@hint The combinator that does not add a layer is `and_then`. Or keep `map` and add `.flatten()`.

@diagnose E0308
`mismatched types: expected Option<i32>, found Option<Option<i32>>`.

`map` has signature `fn map<U>(self, f: impl FnOnce(T) -> U) -> Option<U>`. It
always wraps the closure's result in one `Option`. Your closure returns
`Option<i32>`, so `U` is `Option<i32>` and you get `Option<Option<i32>>`, where
the outer layer means "the slice was empty" and the inner means "it did not
parse".

`and_then` is the one whose closure is allowed to fail:
`fn and_then<U>(self, f: impl FnOnce(T) -> Option<U>) -> Option<U>`. It does not
add a layer, so the two failure modes collapse into one `None`.

The rule of thumb: **if the closure returns an `Option`, you want `and_then`.**

@after
This is the same distinction as `map` versus `flat_map` on iterators, and
`.then()` versus `.then()`-returning-a-promise in JavaScript. Mathematically
`and_then` is monadic bind and `map` is `fmap`; practically, `and_then` is
"flatten afterwards" and `x.map(f).flatten()` compiles to exactly the same
thing.

Worth knowing `.ok()` too. `str::parse` returns a `Result<i32, ParseIntError>`,
and `.ok()` throws the error away and gives you an `Option<i32>`. That is a
deliberate loss of information, so reach for it only when *why* it failed
genuinely does not matter.

## 4. Propagate, do not nest

@kind fix
@concept the question mark operator
@expect E0308

`initials` uses `?` to bail out early when either string is empty. The two `?`s
are correct. The last line is not: a function returning `Option<String>` has to
hand back an `Option`.

```starter
pub fn initials(first: &str, last: &str) -> Option<String> {
    let a = first.chars().next()?;
    let b = last.chars().next()?;
    format!("{a}{b}")
}

pub fn run() -> (Option<String>, Option<String>) {
    (initials("ferris", "crab"), initials("", "crab"))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn builds_or_bails() {
        assert_eq!(run(), (Some(String::from("fc")), None));
    }
}
```

```solution
pub fn initials(first: &str, last: &str) -> Option<String> {
    let a = first.chars().next()?;
    let b = last.chars().next()?;
    Some(format!("{a}{b}"))
}

pub fn run() -> (Option<String>, Option<String>) {
    (initials("ferris", "crab"), initials("", "crab"))
}
```

@hint `?` unwraps on the way in. Nothing wraps on the way out.
@hint The tail expression is a `String` and the signature promises an `Option<String>`.
@hint `Some(format!("{a}{b}"))`.

@diagnose E0308
`mismatched types: expected Option<String>, found String`, on the `format!` call,
with `help: try wrapping the expression in Some`.

This is the most common error in `?`-using code and it is worth understanding
rather than just fixing. `?` is asymmetric: it takes an `Option<T>` and gives
you a `T`, returning `None` from the whole function if there was not one. It
never wraps anything on the way back out. So the body of the function works in
plain `T` and the final expression has to re-enter the `Option`.

Every function returning `Option` that uses `?` ends in either `Some(...)`, a
`None`, or an expression that is already an `Option`.

@after
Compare the shapes. With `?`:

```rust
let a = first.chars().next()?;
let b = last.chars().next()?;
Some(format!("{a}{b}"))
```

Without it, the same logic is a nested `match` two levels deep, and the
interesting line is the most indented one. `?` is what keeps the happy path
flat.

One boundary to remember: `?` on an `Option` only works in a function that
returns an `Option`. It does not work in one returning `Result`. To cross over,
convert first: `opt.ok_or("no first character")?` turns the `None` into an
`Err` and then propagates that.

## 5. Look, do not take

@kind fix
@concept as_ref
@expect E0507

`greet` borrows the config, so it may read the name but not take it. The `match`
here tries to take it, and the name would be missing from the caller's struct
afterwards.

Fix it without changing `greet`'s signature.

```starter
pub struct Config {
    pub name: Option<String>,
}

pub fn greet(c: &Config) -> String {
    match c.name {
        Some(n) => format!("hi {n}"),
        None => String::from("hi stranger"),
    }
}

pub fn run() -> (String, String, bool) {
    let named = Config { name: Some(String::from("ferris")) };
    let anon = Config { name: None };
    let first = greet(&named);
    let second = greet(&anon);
    (first, second, named.name.is_some())
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn greets_without_consuming() {
        assert_eq!(
            run(),
            (
                String::from("hi ferris"),
                String::from("hi stranger"),
                true
            )
        );
    }
}
```

```solution
pub struct Config {
    pub name: Option<String>,
}

pub fn greet(c: &Config) -> String {
    match c.name.as_deref() {
        Some(n) => format!("hi {n}"),
        None => String::from("hi stranger"),
    }
}

pub fn run() -> (String, String, bool) {
    let named = Config { name: Some(String::from("ferris")) };
    let anon = Config { name: None };
    let first = greet(&named);
    let second = greet(&anon);
    (first, second, named.name.is_some())
}
```

@hint `Some(n)` on an owned scrutinee means "move the `String` out and call it `n`". You are only borrowing `c`.
@hint You want an `Option` whose payload is a reference (`Option<&String>` or `Option<&str>`) rather than the owned one.
@hint `c.name.as_ref()` gives `Option<&String>`; `c.name.as_deref()` gives `Option<&str>`. Either works, and `match &c.name` does too.

@diagnose E0507
`cannot move out of c.name which is behind a shared reference`, with
`move occurs because c.name has type Option<String>, which does not implement
the Copy trait` and `data moved here` under `n`.

The pattern is asking for the `String` itself. Granting that would leave
`c.name` as a `Some` whose payload has been removed, and `c` belongs to the
caller. So it is refused.

rustc suggests `c.name.as_ref()` in the help text, and that is the right answer.
`as_ref` maps `&Option<T>` to `Option<&T>`: it copies the tag and turns the
payload into a borrow, moving nothing. `as_deref` does the same and then derefs the
payload, giving `Option<&str>`.

@diagnose E0308
The two arms are no longer producing the same type, or the arm's value is not
the `String` the function promised. After `as_ref()`, `n` is a `&String`; after
`as_deref()`, it is a `&str`. Both interpolate fine in `format!`, which produces
an owned `String`, so the fix is usually in the `None` arm, which must also
produce an owned `String` rather than a `&str`.

@after
`&Option<T>` and `Option<&T>` are genuinely different and the difference is worth
holding on to. The first is one pointer to the whole enum, tag included. The
second is an enum 8 bytes wide whose payload is a borrow, and it is `Copy`, so
you can pass it around freely.

`Option<&T>` is the form you want in a function signature. It says "I may be
given a thing to look at" without requiring the caller to have an `Option`
sitting somewhere for you to point at.

The whole family: `as_ref` for `Option<&T>`, `as_mut` for `Option<&mut T>`,
`as_deref` for `Option<&str>` and `Option<&[T]>`, `cloned`/`copied` to go back to
an owned `Option<T>`.

## 6. Moving out of a &mut

@kind fix
@concept Option
@expect E0596

`pop` should hand back whatever is in `head` and leave the queue empty. The
method it needs exists and is already written here. The problem is the
receiver.

```starter
pub struct Queue {
    pub head: Option<String>,
}

impl Queue {
    pub fn pop(&self) -> Option<String> {
        self.head.take()
    }
}

pub fn run() -> (Option<String>, Option<String>) {
    let mut q = Queue { head: Some(String::from("job-1")) };
    let first = q.pop();
    let second = q.pop();
    (first, second)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empties_the_queue() {
        assert_eq!(run(), (Some(String::from("job-1")), None));
    }
}
```

```solution
pub struct Queue {
    pub head: Option<String>,
}

impl Queue {
    pub fn pop(&mut self) -> Option<String> {
        self.head.take()
    }
}

pub fn run() -> (Option<String>, Option<String>) {
    let mut q = Queue { head: Some(String::from("job-1")) };
    let first = q.pop();
    let second = q.pop();
    (first, second)
}
```

@hint `take` does not only read; it writes `None` back into the field.
@hint Writing to a field through `&self` is impossible. Look at the receiver in the signature.
@hint `pub fn pop(&mut self) -> Option<String>`.

@diagnose E0596
`cannot borrow self.head as mutable, as it is behind a & reference`, with
`self is a & reference, so the data it refers to cannot be borrowed as mutable`
and a help line suggesting `&mut self`.

Look at what `take` actually does: `fn take(&mut self) -> Option<T>`. It swaps
`None` into the place and returns what was there. That is a write, and `&self`
grants read access only.

The receiver in a method signature is a promise to the caller. `&self` says "I
will not change anything"; the body then has to keep that promise. Changing it
to `&mut self` is not a workaround, it is correcting the signature to describe
what the method really does.

@diagnose E0507
You reached for `self.head` directly instead of `self.head.take()`. Moving the
`String` out of a borrowed struct would leave the caller's `Queue` holding a
`Some` with nothing in it. `take` is the sanctioned move: it puts `None` in the
hole, so the struct is always in a valid state.

@after
`take` is a two-word swap, `mem::replace(&mut self.head, None)`, with nothing
allocated and nothing cloned. It is how every linked structure in Rust is written,
because it is the only way to move a value out of a field you only have `&mut`
access to while leaving the field valid.

Its siblings: `replace(v)` puts `v` in and returns the old contents;
`get_or_insert_with(f)` fills a `None` and hands back a `&mut T`; `insert(v)`
overwrites and returns a `&mut T` to the new value.

Note the caller needed `let mut q` too. `&mut self` at the method is only half
of it: the binding has to be mutable for the borrow to be available.

## 7. Two values at once

@kind fix
@concept combinator
@expect E0593

`area` needs both a width and a height. `zip` is the combinator for "I need both
of these to be present". It produces a single value though, not two, and the
closure below was written as if it produced two.

Return `Err("missing dimension")` when either is absent.

```starter
pub fn area(w: Option<u32>, h: Option<u32>) -> Result<u32, &'static str> {
    w.zip(h).map(|a, b| a * b).ok_or("missing dimension")
}

pub fn run() -> (Result<u32, &'static str>, Result<u32, &'static str>) {
    (area(Some(3), Some(4)), area(Some(3), None))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn multiplies_or_reports() {
        assert_eq!(run(), (Ok(12), Err("missing dimension")));
    }
}
```

```solution
pub fn area(w: Option<u32>, h: Option<u32>) -> Result<u32, &'static str> {
    w.zip(h).map(|(a, b)| a * b).ok_or("missing dimension")
}

pub fn run() -> (Result<u32, &'static str>, Result<u32, &'static str>) {
    (area(Some(3), Some(4)), area(Some(3), None))
}
```

@hint What is the type of `w.zip(h)`? Write it out.
@hint It is `Option<(u32, u32)>`: one value, which happens to be a pair. So the closure receives one argument.
@hint Destructure it in the parameter list: `|(a, b)| a * b`.

@diagnose E0593
`closure is expected to take 1 argument, but it takes 2 arguments`, underlining
the `|a, b|` and pointing at `map` with `expected closure that takes 1 argument`.

`zip` has signature `fn zip<U>(self, other: Option<U>) -> Option<(T, U)>`. It
returns `Some` only when both inputs are `Some`, and the payload is a **tuple**,
which is one value. `map` therefore hands your closure one argument.

A closure parameter can be any irrefutable pattern, so `|(a, b)|` destructures
the tuple in place. That is a pattern, not a two-parameter list, and the
parentheses are what make the difference.

@diagnose E0308
`ok_or` turns `Option<T>` into `Result<T, E>`, so the `E` you pass has to match
the function's declared error type. Here that is `&'static str`, so a string
literal works directly. If the error names `String`, you passed a `String` where
a `&str` was declared, or the other way round.

@after
`zip` is the two-value form of the same idea `?` gives you for one. When there
are three or more, the chain gets unreadable and `?` is clearly better:

```rust
fn area(w: Option<u32>, h: Option<u32>) -> Option<u32> {
    Some(w? * h?)
}
```

`ok_or` versus `ok_or_else` follows the same rule as `unwrap_or`: the argument
to `ok_or` is evaluated eagerly, so if building the error allocates or formats,
use `ok_or_else(|| ...)` and it only happens on the failing path.

## 8. The unwrap in the loop

@kind fix
@concept the question mark operator
@expect E0277

`total` parses every entry and sums them. The obvious first draft calls
`.unwrap()` inside the loop, which turns one malformed line into a panic that
takes the process down. This draft avoids the panic and instead tries to add an
`Option<i64>` to an `i64`, which is not a thing.

Make it return `None` if any entry fails to parse, and `Some(sum)` otherwise,
without a single `unwrap`.

```starter
pub fn total(raw: &[&str]) -> Option<i64> {
    let mut sum = 0i64;
    for s in raw {
        sum += s.parse::<i64>().ok();
    }
    Some(sum)
}

pub fn run() -> (Option<i64>, Option<i64>, Option<i64>) {
    (
        total(&["1", "2", "39"]),
        total(&["1", "oops", "39"]),
        total(&[]),
    )
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sums_or_gives_up() {
        assert_eq!(run(), (Some(42), None, Some(0)));
    }
}
```

```solution
pub fn total(raw: &[&str]) -> Option<i64> {
    let mut sum = 0i64;
    for s in raw {
        sum += s.parse::<i64>().ok()?;
    }
    Some(sum)
}

pub fn run() -> (Option<i64>, Option<i64>, Option<i64>) {
    (
        total(&["1", "2", "39"]),
        total(&["1", "oops", "39"]),
        total(&[]),
    )
}
```

@hint `.ok()` gives you an `Option<i64>`, and you cannot add that to an `i64`. Something has to get the number out.
@hint The function already returns `Option<i64>`, so there is an operator that unwraps and bails out of the whole function in one character.
@hint `sum += s.parse::<i64>().ok()?;` and remember that `?` inside a loop returns from the *function*, not the loop.

@diagnose E0277
`cannot add-assign Option<i64> to i64`, with the note
`the trait AddAssign<Option<i64>> is not implemented for i64`.

Trait errors read backwards from syntax errors. `+=` is `AddAssign::add_assign`,
the compiler went looking for an implementation that accepts an `Option<i64>` on
the right, and there is none, deliberately. Adding "maybe a number" to a number
has no defined answer, so the standard library declines to invent one.

You have to say what absence means here. `?` says "it means the whole function
gives up", `unwrap_or(0)` says "it means zero", `.unwrap()` says "it cannot
happen and I am willing to crash". Only the first matches what the tests ask
for.

@diagnose E0308
Your `?` is in a function whose return type is not an `Option`, or the tail
expression lost its `Some`. `?` on an `Option` requires the enclosing function to
return `Option` too, and the final `Some(sum)` must stay, because `?` unwraps on
the way in and never wraps on the way out.

@after
`?` inside a loop returns from the **function**, not from the loop. That is what
makes this work: the first unparseable entry ends `total` immediately with
`None`, and nothing after it runs.

Two other shapes worth knowing for the same job. To skip bad entries instead of
failing: `raw.iter().filter_map(|s| s.parse::<i64>().ok()).sum()`. To fail on the
first bad one, declaratively:

```rust
raw.iter().map(|s| s.parse::<i64>().ok()).sum::<Option<i64>>()
```

`Sum` is implemented for `Option<T>`, so a single `None` anywhere makes the whole
sum `None`. Same semantics in one line, with no mutable accumulator to keep straight.
