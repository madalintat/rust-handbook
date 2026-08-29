---
unit: 03-expressions
---

## 1. One character too many

@kind fix
@concept tail expression

@expect E0308

This function counts lines and returns nothing at all. The body is right, the
signature is right, and there is exactly one character wrong.

```starter
pub fn line_count(text: &str) -> usize {
    text.lines().count();
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_three() {
        assert_eq!(line_count("a\nb\nc"), 3);
    }
    #[test]
    fn counts_none() {
        assert_eq!(line_count(""), 0);
    }
}
```

```solution
pub fn line_count(text: &str) -> usize {
    text.lines().count()
}
```

@hint The error says the body produces `()`. Something is throwing a value away.
@hint A semicolon turns an expression into a statement and discards its value. Remove it and the expression becomes the block's value.

@diagnose E0308
`expected usize, found ()`. Read the two underlines together. The caret is on
`usize` in the signature, which is the claim being checked, and the note beneath
the function name says `implicitly returns () as its body has no tail
expression`.

A block is worth its last expression *if that expression has no semicolon*. With
the semicolon, `text.lines().count()` is a statement: it runs, produces a
`usize`, and the semicolon throws it away. The block then has nothing left to be
worth, so it is `()`, and `()` is not a `usize`.

The `help: remove this semicolon to return this value` at the bottom is rustc
telling you the fix outright, and here it is correct.

@after
This error is the single most common thing new Rust programmers hit, and it is
worth stating the rule as one sentence you will not forget: **a semicolon on the
last line means "this function produces nothing".**

Which is why it is not always wrong. A function declared with no `->` returns
`()`, and every line of its body, including the last, should end in a semicolon.
The semicolon is not punctuation for the end of a line. It is an operator that
discards a value, and you use it deliberately.

## 2. The branch that lost its value

@kind fix
@concept if expression

@expect E0308

Same character, harder to see. An `if` is an expression, so it has a type, so
both of its branches must produce the same one. Here they do not.

```starter
pub fn label(n: i32) -> &'static str {
    if n > 10 {
        "big";
    } else {
        "small"
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn labels_both_sides() {
        assert_eq!(label(50), "big");
        assert_eq!(label(2), "small");
    }
    #[test]
    fn ten_is_small() {
        assert_eq!(label(10), "small");
    }
}
```

```solution
pub fn label(n: i32) -> &'static str {
    if n > 10 {
        "big"
    } else {
        "small"
    }
}
```

@hint The `else` branch is fine. Compare it with the other one, character by character.
@hint A branch is a block, and a block with a trailing semicolon is worth `()`. One branch is worth `&str` and the other is worth nothing.

@diagnose E0308
`if and else have incompatible types: expected (), found &str`. Note the
direction. rustc typed the *first* branch, got `()` because of the semicolon,
and then complained that the `else` disagreed. The error points at the innocent
branch, which is why this one takes longer to spot than a bare tail semicolon.

The rule underneath is that an `if` is an expression with a single type, and the
compiler has to know that type without running the program. It cannot be `&str`
on Tuesdays and `()` on Wednesdays, so both branches have to agree.

Once they agree, the `if` is the tail expression of the function body and its
value is the function's value, with no `return` written anywhere.

@diagnose E0317
`if may be missing an else clause`. You removed the `else` rather than the
semicolon. With no `else` there is a path through the function that produces
nothing, and "nothing" is not a `&'static str`, so the `if` is forced to be `()`.
Every branch that can be taken must produce a value of the same type; that
includes the invisible empty branch you get by leaving `else` out.

@after
Because `if` is an expression, Rust gets by without a ternary operator.
`if c { a } else { b }` occupies the same slot as `c ? a : b` and reads better in
the multi-line case. And because every branch must produce a value, the compiler
catches the missing case rather than silently leaving a variable unset.

That is the trade. A statement-`if` language lets you write half a branch and
find out at run time. An expression-`if` language makes the half-branch a type
error.

## 3. Two branches, two types

@kind fix
@concept if expression

@expect E0308

No semicolons wrong here. The two branches genuinely produce different types, and
only one of them matches the signature.

```starter
pub fn describe(n: i32) -> String {
    if n == 0 {
        "zero"
    } else {
        format!("{n}")
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn zero_is_special() {
        assert_eq!(describe(0), "zero");
    }
    #[test]
    fn others_are_printed() {
        assert_eq!(describe(-4), "-4");
    }
}
```

```solution
pub fn describe(n: i32) -> String {
    if n == 0 {
        String::from("zero")
    } else {
        format!("{n}")
    }
}
```

@hint `"zero"` is a `&'static str` baked into the binary. `format!` builds a `String` on the heap. They are different types.
@hint Bring the literal up to the owned type: `String::from("zero")`, or `"zero".to_string()`.

@diagnose E0308
`if and else have incompatible types: expected &str, found String`. The literal
`"zero"` is a `&'static str`: a pointer and a length aimed at bytes stored in
the executable itself. `format!` allocates and gives you a `String`. Both are
text; neither is the other.

Rust will not silently convert one branch to match the other, because doing so
would mean picking an allocation on your behalf. The conversion costs one trip to
the allocator and a copy of five bytes, and the language's habit is to make you
write the line where the cost happens.

`String::from("zero")` and `"zero".to_string()` are identical in effect. The
first says what it does slightly more plainly.

@after
There is a third answer worth knowing, even though it is more machinery than this
function deserves: return `Cow<'static, str>`, which is either a borrow or an
owned value, and allocates only in the branch that has to. It is what you would
reach for if `describe` were called in a hot loop and the zero case dominated.

For everything else, allocate. A `String::from` on a five-byte literal is a few
nanoseconds, and reaching for `Cow` before you have measured is how a codebase
grows lifetimes that nobody can read.

## 4. An if with nowhere to go

@kind fix
@concept if expression

@expect E0317

`cap` should hold a number, and the `if` that is supposed to produce it only
covers half the possibilities.

```starter
pub fn clamp_high(n: i32) -> i32 {
    let cap = if n > 100 { 100 };
    cap
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn caps_the_top() {
        assert_eq!(clamp_high(250), 100);
    }
    #[test]
    fn leaves_the_rest() {
        assert_eq!(clamp_high(7), 7);
        assert_eq!(clamp_high(-3), -3);
    }
}
```

```solution
pub fn clamp_high(n: i32) -> i32 {
    let cap = if n > 100 { 100 } else { n };
    cap
}
```

@hint What is the value of this `if` when `n` is 7? There is no branch to answer that.
@hint Add the `else`, and make it produce the value you want in the uncapped case.
@hint `let cap = if n > 100 { 100 } else { n };`

@diagnose E0317
`if may be missing an else clause: expected i32, found ()`. An `if` with no
`else` has an implicit empty `else` branch, and an empty block is worth `()`. So
the whole expression is `()`, and `let cap = ();` is not the `i32` the next line
needs.

This is the same rule as exercise 2 seen from the other side: every path through
an expression must produce a value of the expression's type, and "fall off the
end without deciding" is a path.

An `else`-less `if` is still perfectly legal as a *statement*, where the value
`()` is what you wanted:

```rust
if n > 100 {
    log("capped");
}
```

The moment you assign from it, the missing branch becomes a missing value.

@after
The standard library has `n.min(100)` for exactly this, and `n.clamp(0, 100)` for
both ends. Reach for those in real code.

The point of writing it by hand once is the shape of the fix. In a
statement-oriented language you would declare `let mut cap = n;` and then
conditionally overwrite it, which works and leaves a mutable binding lying around
for the rest of the function. The expression form computes the value once,
binds it immutably, and makes the compiler check that every case was considered.

## 5. The arm that prints instead of answering

@kind fix
@concept match expression

@expect E0308

Every arm of a `match` is a branch of one expression, so every arm has to produce
the same type. Three of these produce a `u8`. The fourth produces something else.

An unknown level is a programming error here. The caller should never reach it.

```starter
pub fn level(name: &str) -> u8 {
    match name {
        "off" => 0,
        "warn" => 1,
        "error" => 2,
        other => println!("unknown level: {other}"),
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maps_the_known_levels() {
        assert_eq!(level("off"), 0);
        assert_eq!(level("warn"), 1);
        assert_eq!(level("error"), 2);
    }
}
```

```solution
pub fn level(name: &str) -> u8 {
    match name {
        "off" => 0,
        "warn" => 1,
        "error" => 2,
        other => panic!("unknown level: {other}"),
    }
}
```

@hint `println!` produces `()`. The other three arms produce a `u8`.
@hint The brief says an unknown level is a bug, not a value. There is a macro for "control does not continue past here", and it type-checks as anything.
@hint `other => panic!("unknown level: {other}")`. Its type is `!`, the never type, which coerces to `u8`, or to any other type you like.

@diagnose E0308
`match arms have incompatible types: expected u8, found ()`. rustc types the
first arm, gets `u8`, and holds every later arm to it. `println!` writes to
stdout and evaluates to `()`, so the last arm produces nothing.

The interesting part is why `panic!` is allowed where `println!` is not, when
neither of them produces a `u8`. `panic!` has type `!`, the **never type**, the
type of an expression that does not return control at all. Since no value of
type `!` can ever exist, letting it coerce to any type cannot produce a
contradiction: there is no value that could turn up and disagree.

That is also why `todo!()`, `unreachable!()`, `return`, `break` and
`std::process::exit` can appear in any expression position.

@after
Three honest endings for that arm, and they say different things:

- `panic!("unknown level: {other}")` says this cannot happen; if it does, the program is wrong.
- `_ => 1` says anything unrecognised is a warning. A policy decision, made visible.
- changing the return type to `Option<u8>` and returning `None` says unknown input is expected, and the caller decides.

The third is what real code usually wants, and the second is what real code
usually ships. What you should not do is print and continue, which is what the
starter tried: it turns a bug into a log line nobody reads and a wrong value that
keeps travelling.

## 6. break can carry a value

@kind fix
@concept break value

@expect E0308

`loop` is the only loop that can produce a value, because `break` is the only way
out of it. The `break` here leaves without bringing anything back.

```starter
pub fn first_multiple(of: u32, above: u32) -> u32 {
    let mut n = above;
    let found = loop {
        if n % of == 0 {
            break;
        }
        n += 1;
    };
    found
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finds_the_next_multiple() {
        assert_eq!(first_multiple(7, 50), 56);
    }
    #[test]
    fn already_a_multiple() {
        assert_eq!(first_multiple(7, 49), 49);
    }
}
```

```solution
pub fn first_multiple(of: u32, above: u32) -> u32 {
    let mut n = above;
    let found = loop {
        if n % of == 0 {
            break n;
        }
        n += 1;
    };
    found
}
```

@hint The loop knows the answer at the moment it decides to stop. It just is not handing it over.
@hint `break` takes an optional value, and that value becomes the value of the whole `loop` expression.
@hint `break n;`

@diagnose E0308
`expected u32, found ()`. A bare `break` gives the `loop` nothing, so the loop
expression is `()`, so `found` is `()`, so the last line does not match the
signature.

`break n` is the fix and it is worth understanding rather than memorising. A
`while` or a `for` can end in two ways: the body broke out, or the condition
failed. Only one of those has a value to offer, so those loops are always `()`. A `loop` has exactly one exit, `break`, so every exit can carry a value and
the loop as a whole can have a type.

This is the idiomatic retry shape in Rust. The alternative is an `Option`
declared before the loop, assigned inside it, and unwrapped afterwards. That
leaves an `unwrap` that can never fire, which is a small lie in the code.

@diagnose E0317
You converted the `loop` into an `if`-driven shape without an `else`, and now
there is a path that produces nothing. If the loop is the right structure, put
the value on the `break` instead of restructuring around it.

@after
Two extensions worth having in your head.

Labels: `'outer: loop { ... break 'outer value; }` breaks out of a named loop
from inside a nested one, with a value. That is the clean version of the `found`
flag that a nested search would otherwise need.

And `loop` is the only loop the compiler treats as certainly-running, so `let x =
loop {}` type-checks as any type at all. An infinite loop with no `break` has
type `!`, exactly like `panic!`.

## 7. A block that forgot to produce anything

@kind fix
@concept block

@expect E0308

The block is doing the right work. It walks the lines and tracks the longest,
and then keeps the answer to itself.

```starter
pub fn summary(text: &str) -> String {
    let longest: &str = {
        let mut best = "";
        for line in text.lines() {
            if line.len() > best.len() {
                best = line;
            }
        }
    };
    format!("{longest} ({} lines)", text.lines().count())
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reports_the_longest() {
        assert_eq!(summary("ab\nabcd\nc"), "abcd (3 lines)");
    }
    #[test]
    fn handles_a_single_line() {
        assert_eq!(summary("only"), "only (1 lines)");
    }
}
```

```solution
pub fn summary(text: &str) -> String {
    let longest: &str = {
        let mut best = "";
        for line in text.lines() {
            if line.len() > best.len() {
                best = line;
            }
        }
        best
    };
    format!("{longest} ({} lines)", text.lines().count())
}
```

@hint The block's last item is a `for` loop, and a `for` loop is always worth `()`.
@hint Name the value you want on a line of its own, with no semicolon, as the last thing in the block.
@hint Add `best` as the final line inside the braces.

@diagnose E0308
`expected &str, found ()`. The annotation on `longest` is what makes this error
readable. It states the claim, so rustc can point at the block and say the block
does not meet it.

The block's last item is a `for` loop. `for` and `while` always evaluate to `()`,
because a loop that finishes by running out of items has no value to hand back.
So the block has no tail expression, and a block with no tail expression is `()`.

Adding `best` on its own line, with no semicolon, makes it the tail. `best` is
still in scope at that point, because the block has not closed yet, and the value
flows out while the binding itself is dropped at the brace.

@after
This shape is worth keeping. A block expression lets you compute something with
several intermediate values and let exactly one of them escape:

```rust
let checksum = {
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)?;
    crc32(&buf)
};
```

`buf` is visibly scratch and is dropped at the closing brace. In a language where
the loop body is not a scope, `buf` would still be alive at the bottom of the
function, and the next person would have to read the whole thing to know whether
it mattered.

The same trick releases a lock early: put the guard inside a block and it unlocks
at the brace rather than at the end of the function.

## 8. Two statements pretending to be an expression

@kind fix
@concept expression

@expect E0381

This is the statement-oriented way to write a conditional value: declare the
variable, then assign to it in each branch. Rust rejects it, and the error names
the exact hole in the reasoning.

Restructure so that the compiler can see a value is always produced.

```starter
pub fn grade(score: u32) -> String {
    let letter;
    if score >= 90 {
        letter = "A";
    } else if score >= 80 {
        letter = "B";
    }
    format!("{score}: {letter}")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn top_marks() {
        assert_eq!(grade(95), "95: A");
        assert_eq!(grade(90), "90: A");
    }
    #[test]
    fn middle() {
        assert_eq!(grade(85), "85: B");
    }
    #[test]
    fn the_rest() {
        assert_eq!(grade(10), "10: C");
    }
}
```

```solution
pub fn grade(score: u32) -> String {
    let letter = if score >= 90 {
        "A"
    } else if score >= 80 {
        "B"
    } else {
        "C"
    };
    format!("{score}: {letter}")
}
```

@hint Ask what `letter` holds when `score` is 10. Both branches were skipped.
@hint You could add a final `else` that assigns `"C"`. Better: make the whole `if` chain one expression and bind its value directly.
@hint `let letter = if score >= 90 { "A" } else if score >= 80 { "B" } else { "C" };`. Note the semicolon at the end, because this is a `let` statement.

@diagnose E0381
`used binding letter is possibly-uninitialized`. `let letter;` with no value is
legal, because Rust allows deferred initialisation. The compiler then tracks
every path to make sure exactly one assignment has happened before the binding
is read.

Walk the paths. `score >= 90` assigns. `score >= 80` assigns. And the third,
invisible path, where neither condition holds, assigns nothing and falls straight
into the `format!`. That path is the error. C would print whatever was in that
stack slot; Rust refuses to compile it.

Adding a final `else { letter = "C"; }` satisfies the checker. Turning the whole
chain into one expression is better, because then the check is structural: an
`if` used as a value *must* have an `else`, so the missing case cannot be written
in the first place.

@diagnose E0308
You made the `if` chain into an expression but left a semicolon on one of the
branch values, or dropped the final `else`. Every branch of a value-producing
`if` must produce the same type, including the `else`; a branch ending in a
semicolon produces `()` instead.

@after
Both fixes compile. Only one of them makes the next bug impossible.

With `let letter;` and four assignments, adding a fifth branch next year and
forgetting to assign gives you the same E0381. The compiler catches it, but only
because it does this whole-path analysis. With `let letter = if ... else ...`,
the missing branch is not a thing you can express: an `if` used as a value
without an `else` is `error[E0317]` on the spot.

That is the general argument for expression-oriented code, and it is not
aesthetic. **Prefer the form where the invalid state has no syntax.** Deferred
initialisation exists for the cases where a value genuinely has to be built
across several statements: a loop that accumulates, a branch that opens a file.
For a simple conditional it is a habit imported from a weaker language.
