---
unit: 04-control-flow
---

## 1. A number is not a condition

@kind fix
@concept if
@expect E0308

`retries` is a count. The code treats it as a yes/no. In C or Python that would
work, because both give every value a truth value; Rust gives none of them one.

Say what you actually mean.

```starter
pub fn run(retries: u32) -> &'static str {
    if retries {
        "retrying"
    } else {
        "done"
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn zero_is_done() {
        assert_eq!(run(0), "done");
        assert_eq!(run(3), "retrying");
        assert_eq!(run(1), "retrying");
    }
}
```

```solution
pub fn run(retries: u32) -> &'static str {
    if retries > 0 {
        "retrying"
    } else {
        "done"
    }
}
```

@hint The condition of an `if` must have type `bool`. `retries` has type `u32`.
@hint Turn the count into a question: is it greater than zero?
@hint `if retries > 0 { .. }`.

@diagnose E0308
`expected bool, found u32`. The `if` keyword takes an expression of type `bool`
and nothing else. Integers, strings and collections have no truth value here,
and `None` is not falsy.

This looks like ceremony until you notice what it deletes. In Python,
`if items:` and `if items is not None:` agree almost always and disagree exactly
when `items` is an empty list, which is the bug. In C, `if (fd)` is wrong for
`fd == 0`, which is a real file descriptor. Rust makes you name the question:
`> 0`, `.is_empty()`, `.is_some()`. Three different questions, three different
spellings.

@after
The same rule closes the other famous C hole. `if (x = 0)` compiles in C and is
always false; in Rust `if x = 0` is `error[E0308]: expected bool, found ()`,
because assignment is an expression of type `()` rather than of the value
assigned.

Two bug classes gone for the price of typing four characters, and the compiler's
suggestion usually writes them for you.

## 2. A string is not an iterator

@kind fix
@concept for
@expect E0277

`for` accepts exactly one kind of thing: something that can turn into an
iterator. A `&str` is not one, and the reason is a design decision worth
knowing: a string could reasonably yield bytes, characters, or grapheme
clusters, and Rust refuses to guess.

```starter
pub fn count_lowercase(text: &str) -> usize {
    let mut n = 0;
    for c in text {
        if c.is_lowercase() {
            n += 1;
        }
    }
    n
}

pub fn run() -> usize {
    count_lowercase("Ferris The Crab")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_lowercase_letters() {
        assert_eq!(run(), 10);
        assert_eq!(count_lowercase("ABC"), 0);
        assert_eq!(count_lowercase(""), 0);
    }
}
```

```solution
pub fn count_lowercase(text: &str) -> usize {
    let mut n = 0;
    for c in text.chars() {
        if c.is_lowercase() {
            n += 1;
        }
    }
    n
}

pub fn run() -> usize {
    count_lowercase("Ferris The Crab")
}
```

@hint The loop needs to be told what a string should be broken into.
@hint You want characters, and there is a method that produces exactly that iterator.
@hint `for c in text.chars()`.

@diagnose E0277
`&str is not an iterator`, and then the useful half:
`the trait IntoIterator is not implemented for &str`.

`for x in thing` desugars to `IntoIterator::into_iter(thing)` followed by a
`while let Some(x) = it.next()`. So `for` does not have a list of things it
understands; it has one trait, and the error is simply that `&str` does not
implement it.

That omission is deliberate. A `Vec<T>` has one obvious element type. A string
has at least three defensible ones: bytes, `char`s and grapheme clusters. They
give different answers for accented text and emoji. Rather than pick,
`str` offers `.chars()`, `.bytes()` and `.lines()` and makes you say which.

@after
Every collection has the same shape of choice, just with a more obvious default.
`for x in v` moves the `Vec`, `for x in &v` borrows it and yields `&T`, and
`for x in &mut v` yields `&mut T`. Three `IntoIterator` impls, one syntax.

The habit worth forming: when `for` rejects something, ask what iterator you
wanted rather than how to make the type fit. The answer is nearly always a
method already on the type: `.iter()`, `.chars()`, `.values()`, `.lines()`.

## 3. An if used as a value needs both halves

@kind fix
@concept if
@expect E0317

`if` is an expression here, not a statement. Its value is being bound to
`label`. That puts a requirement on it that a statement `if` does not have.

```starter
pub fn tier(bytes: usize) -> &'static str {
    let label = if bytes > 1024 {
        "large"
    };
    label
}

pub fn run() -> (&'static str, &'static str) {
    (tier(2048), tier(10))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn labels_both_sizes() {
        assert_eq!(run(), ("large", "small"));
        assert_eq!(tier(1024), "small");
        assert_eq!(tier(1025), "large");
    }
}
```

```solution
pub fn tier(bytes: usize) -> &'static str {
    let label = if bytes > 1024 {
        "large"
    } else {
        "small"
    };
    label
}

pub fn run() -> (&'static str, &'static str) {
    (tier(2048), tier(10))
}
```

@hint Ask what `label` would hold when `bytes` is 10.
@hint An `if` with no `else` has type `()` on the path where the condition is false, so it cannot produce a `&str`.
@hint Add `else { "small" }`.

@diagnose E0317
`if may be missing an else clause`, then `expected &str, found ()`.

Trace both paths. When the condition is true the block produces `"large"`, a
`&str`. When it is false there is no block at all, so the expression produces
`()`. A `let` needs one type, and those are two.

An `if` without an `else` is perfectly legal as a *statement*, where its value
is discarded and both paths are `()`. The moment you bind it, pass it, or return
it, both arms have to produce a value and they have to agree on the type.

@diagnose E0308
The arms disagree. Check for a stray semicolon: `{ "large"; }` produces `()`
rather than `&str`, because the semicolon throws the value away. rustc usually
points at the *other* arm, which is why this one is hard to spot.

@after
This is why Rust has no ternary operator. `if` already is one, so `cond ? a : b`
would be a second spelling of something the language does already.

The same is true of `match`, `loop` and a bare block: all of them produce values,
which is why `let x = match .. { }` and `let x = loop { .. }` read naturally.
Once you see the pattern, the amount of `let mut x; ... x = ..` plumbing in your
code drops sharply, and a binding assigned exactly once can go back to being a
plain `let`.

## 4. Only one loop can hand back a value

@kind fix
@concept loop
@expect E0571

The intent is right: find the first power of three above a hundred and return
it. The loop chosen for the job cannot do it.

```starter
pub fn run() -> u32 {
    let mut n = 1;
    while n < 1000 {
        n *= 3;
        if n > 100 {
            break n;
        }
    }
    0
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn first_power_of_three_over_100() {
        assert_eq!(run(), 243);
    }
}
```

```solution
pub fn run() -> u32 {
    let mut n = 1;
    loop {
        n *= 3;
        if n > 100 {
            break n;
        }
    }
}
```

@hint Which of Rust's three loops can be used as an expression that produces a value?
@hint A `while` can also finish because its condition went false, and on that path there is no value to hand back. A `loop` has no such path.
@hint Replace `while n < 1000` with `loop`, and let the `break n` be the only exit. Then the loop itself is the function's tail expression.

@diagnose E0571
`can only break with a value inside loop or breakable block`.

A `while` has two ways to end: a `break`, or the condition testing false. If
`break n` produced a value, the compiler would need a second value for the
condition-false path, and there is nowhere to get one. So `break` in a `while` or
a `for` takes no argument, and their type is always `()`.

`loop` has exactly one way out, a `break` you wrote, so every exit can carry a
value and they all have to agree on its type. That is what makes `loop` an
expression and the other two statements.

@diagnose E0308
Your `loop` is the tail expression of the function now, so its type is the
function's return type. Every `break` inside it must carry a `u32`, and a bare
`break` carries `()`. Either give it a value or remove the trailing `0`, which
is now unreachable.

@after
`loop` earns its keyword for a second reason. A `loop` with no `break` never
finishes, so its type is `!`, the never type, and it satisfies any return type:

```rust
fn serve() -> ! {
    loop { handle(accept()); }
}
```

`while true` is not equivalent. The compiler does not evaluate the condition, so
the loop is assumed to be able to finish and its type is `()`. The same function
written with `while true` fails to type-check. This is the reason clippy nudges
you from `while true` to `loop`, and it is not a style rule.

## 5. Breaking out of two loops at once

@kind fix
@concept labelled break
@expect E0426

A plain `break` leaves the innermost loop only. The author knew that, reached for
the right feature, and left half of it out.

```starter
pub fn find(grid: &[[u8; 3]; 3], needle: u8) -> Option<(usize, usize)> {
    let mut found = None;
    for (r, row) in grid.iter().enumerate() {
        for (c, cell) in row.iter().enumerate() {
            if *cell == needle {
                found = Some((r, c));
                break 'search;
            }
        }
    }
    found
}

pub fn run() -> Option<(usize, usize)> {
    find(&[[1, 2, 3], [4, 5, 6], [7, 8, 9]], 6)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finds_the_cell() {
        assert_eq!(run(), Some((1, 2)));
        assert_eq!(find(&[[1, 2, 3], [4, 5, 6], [7, 8, 9]], 1), Some((0, 0)));
        assert_eq!(find(&[[1, 2, 3], [4, 5, 6], [7, 8, 9]], 99), None);
    }
}
```

```solution
pub fn find(grid: &[[u8; 3]; 3], needle: u8) -> Option<(usize, usize)> {
    let mut found = None;
    'search: for (r, row) in grid.iter().enumerate() {
        for (c, cell) in row.iter().enumerate() {
            if *cell == needle {
                found = Some((r, c));
                break 'search;
            }
        }
    }
    found
}

pub fn run() -> Option<(usize, usize)> {
    find(&[[1, 2, 3], [4, 5, 6], [7, 8, 9]], 6)
}
```

@hint `break 'search` names a label. Nothing in this function is called `'search`.
@hint A loop is labelled by writing the name and a colon in front of it.
@hint `'search: for (r, row) in grid.iter().enumerate() {`.

@diagnose E0426
`use of undeclared label 'search`.

Labels are declared, not global. A loop takes a label by being written
`'name: for ..` or `'name: loop ..`, and a `break 'name` may only refer to a
label on a loop or block that lexically encloses it. There is no way to break
into somewhere you are not already inside.

That restriction is what separates this from `goto`. Control can only move
outward, to the end of a construct you are currently within, so a reader always
knows where a labelled `break` lands: after the loop carrying the label.

@after
Without labels, the alternatives are a flag re-tested in the outer condition, or
extracting the nest into its own function so `return` can do the job. Both are
what C programmers reach for `goto` to avoid.

Labels also carry values, and since 1.65 they work on plain blocks as well as
loops, which gives a clean early exit from a stretch of straight-line code:

```rust
let idx = 'search: {
    for (i, line) in lines.iter().enumerate() {
        if line.starts_with("[server]") { break 'search Some(i); }
    }
    None
};
```

`continue 'label` exists too, and jumps to the next iteration of the named loop
rather than the innermost one.

## 6. Match the range and keep the number

@kind fix
@concept match
@expect E0425

Each arm wants the length it just matched. The last one has it. The first two
tested a range and threw the value away, then tried to use it anyway.

```starter
pub fn label(len: usize) -> String {
    match len {
        0..=63 => format!("small ({n} bytes)"),
        64..=1023 => format!("medium ({n} bytes)"),
        n => format!("large ({n} bytes)"),
    }
}

pub fn run() -> (String, String, String) {
    (label(10), label(200), label(5000))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn labels_three_sizes() {
        assert_eq!(
            run(),
            (
                String::from("small (10 bytes)"),
                String::from("medium (200 bytes)"),
                String::from("large (5000 bytes)")
            )
        );
    }
    #[test]
    fn boundaries() {
        assert_eq!(label(63), "small (63 bytes)");
        assert_eq!(label(64), "medium (64 bytes)");
        assert_eq!(label(1024), "large (1024 bytes)");
    }
}
```

```solution
pub fn label(len: usize) -> String {
    match len {
        n @ 0..=63 => format!("small ({n} bytes)"),
        n @ 64..=1023 => format!("medium ({n} bytes)"),
        n => format!("large ({n} bytes)"),
    }
}

pub fn run() -> (String, String, String) {
    (label(10), label(200), label(5000))
}
```

@hint The third arm works because `n` is a binding pattern: it matches anything and names it. The first two match without naming.
@hint There is a sigil that does both: test the pattern, and bind what matched to a name.
@hint Write `n @ 0..=63 => ..`: the name, the at sign, then the pattern it must match.

@diagnose E0425
`cannot find value n in this scope`, pointing inside the first two `format!`
calls. A `{n}` in a format string captures a variable called `n` from the
surrounding scope, and in those arms nothing introduced one.

Look at the third arm to see the difference. `n => ..` is not a special
catch-all: `n` is a *binding pattern*, which matches any value and gives it that
name. The range patterns `0..=63` and `64..=1023` match a value without naming
it, so inside those arms the number exists but is anonymous.

The `@` sigil combines the two: `name @ pattern` matches the pattern and binds
the matched value to `name`. Without it your choices are to lose the value or to
repeat the test inside the arm body.

@after
`@` composes with everything and gets more useful the deeper the pattern goes:

```rust
match response {
    Response { code: c @ 400..=499, .. } => client_error(c),
    Response { code: c @ 500..=599, .. } => server_error(c),
    _ => Ok(()),
}
```

One arm both classifies the code and hands it over. The alternative is matching
on `..` and re-reading `response.code` in the body, which duplicates the
condition and lets the two drift apart.

## 7. Guards do not count as coverage

@kind fix
@concept match guard
@expect E0004

Between them these three arms cover every `i32` there is. Read them and check.
The compiler will still reject the `match`, and its reason is a good one.

```starter
pub fn advice(retries: i32) -> &'static str {
    match retries {
        n if n <= 0 => "give up",
        n if n < 3 => "retry now",
        n if n < 10 => "retry with backoff",
    }
}

pub fn run() -> (&'static str, &'static str) {
    (advice(2), advice(50))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_band() {
        assert_eq!(advice(0), "give up");
        assert_eq!(advice(-4), "give up");
        assert_eq!(advice(2), "retry now");
        assert_eq!(advice(5), "retry with backoff");
        assert_eq!(advice(50), "page someone");
    }
    #[test]
    fn run_pair() {
        assert_eq!(run(), ("retry now", "page someone"));
    }
}
```

```solution
pub fn advice(retries: i32) -> &'static str {
    match retries {
        n if n <= 0 => "give up",
        n if n < 3 => "retry now",
        n if n < 10 => "retry with backoff",
        _ => "page someone",
    }
}

pub fn run() -> (&'static str, &'static str) {
    (advice(2), advice(50))
}
```

@hint The compiler is not checking your arithmetic. Ask what it *can* check.
@hint A guard is arbitrary code. It could call a function, read a global, or return a different answer each time. The exhaustiveness checker cannot evaluate it, so it ignores guarded arms entirely.
@hint Add a final unguarded arm, `_ => "page someone"`, which is also the honest answer for ten or more retries.

@diagnose E0004
`non-exhaustive patterns: i32::MIN..=i32::MAX not covered`.

The checker works on patterns, and every one of your patterns is the bare
binding `n`, which does cover all of `i32`. Each one is qualified by an `if`.
A guard is ordinary Rust: it can call a function, read an atomic, or return
`false` every second Tuesday. Proving that `n <= 0`, `n < 3` and `n < 10`
together cover the integers would mean evaluating your code at compile time, so
rustc does not try.

The rule is simple once stated: **a guarded arm never contributes to
exhaustiveness.** A `match` whose arms all have guards always needs one more arm
that does not.

@after
This looks like a limitation and is closer to a feature. Exhaustiveness is only
worth anything if it is decidable, and it stays decidable precisely because it
reasons about patterns rather than about conditions. That is what makes it
survive refactoring: add a variant to an enum and every `match` on it that lacks
a `_` becomes a compile error listing exactly what you forgot.

Which is also the argument for using `_` sparingly. A `_` arm is a promise that
future variants should be handled the same way, and it is often not true. Here it
is, because anything over ten retries really is one case.

## 8. Flatten the pyramid

@kind fix
@concept let else
@expect E0308

Three things can go wrong parsing `server=example.com:8080`, and all three fall
back to the same default. The author reached for `let ... else` to keep the
happy path at the left margin, and got one detail wrong. The same detail three
times.

```starter
/// Parse a line like "server=example.com:8080".
/// Anything malformed falls back to ("localhost", 8080).
pub fn endpoint(line: &str) -> (String, u16) {
    let Some(rest) = line.strip_prefix("server=") else {
        (String::from("localhost"), 8080)
    };
    let Some((host, port)) = rest.split_once(':') else {
        (String::from("localhost"), 8080)
    };
    let Ok(port) = port.parse::<u16>() else {
        (String::from("localhost"), 8080)
    };
    (String::from(host), port)
}

pub fn run() -> (String, u16) {
    endpoint("server=example.com:8080")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_a_good_line() {
        assert_eq!(run(), (String::from("example.com"), 8080));
    }
    #[test]
    fn falls_back() {
        let default = (String::from("localhost"), 8080);
        assert_eq!(endpoint("nope"), default);
        assert_eq!(endpoint("server=example.com"), default);
        assert_eq!(endpoint("server=example.com:not-a-port"), default);
        assert_eq!(endpoint("server=example.com:99999"), default);
    }
}
```

```solution
/// Parse a line like "server=example.com:8080".
/// Anything malformed falls back to ("localhost", 8080).
pub fn endpoint(line: &str) -> (String, u16) {
    let Some(rest) = line.strip_prefix("server=") else {
        return (String::from("localhost"), 8080);
    };
    let Some((host, port)) = rest.split_once(':') else {
        return (String::from("localhost"), 8080);
    };
    let Ok(port) = port.parse::<u16>() else {
        return (String::from("localhost"), 8080);
    };
    (String::from(host), port)
}

pub fn run() -> (String, u16) {
    endpoint("server=example.com:8080")
}
```

@hint Ask what happens after one of those `else` blocks finishes. What would `rest` be bound to?
@hint The `else` block of a `let ... else` is not allowed to fall through, because there would be no value to bind. It has to leave.
@hint Make each block `return` the fallback tuple rather than evaluating to it.

@diagnose E0308
`else clause of let...else does not diverge`, with the note
`expected type !`.

Read the construct literally. `let Some(rest) = expr else { .. };` binds `rest`
for the rest of the function when the pattern matches. When it does not match,
there is no `rest`, so the block cannot be allowed to reach the next line. That
line would name a binding that was never made.

The requirement is therefore stronger than "produce the right type": the block
must **diverge**. `return`, `break`, `continue`, or a `panic!`. Its type is `!`,
the never type, which is the type of an expression that does not finish. A block
whose last expression is a tuple finishes, and so is rejected.

@diagnose E0658
You are on an older compiler than this construct. `let ... else` stabilised in
Rust 1.65 (November 2022); before that it was a nightly feature. The nested
`if let` form is the fallback.

@after
Compare the shapes. With `if let`, the pyramid puts the success case at the
deepest indentation and the fallback a long way from any of the three tests that
need it. With `let else`, failure handling sits at the left margin next to the
thing that can fail, and the happy path runs straight down.

The whole difference is scope: **an `if let` binding is trapped inside its
block, and a `let else` binding escapes into the rest of the function.** That is
the entire feature, and it is the reason to reach for `let else` whenever the
failing branch is an exit rather than an alternative.

In a function returning `Result` the same shape usually collapses further, into
`?`. That is unit 12.
