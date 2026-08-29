---
unit: 26-ship-it
---

## 1. The signature that will not elide

@kind fix
@concept lib split
@expect E0106

The first function in `src/lib.rs`. It takes the pattern and the file contents,
and returns the lines that matched — as slices *into* the contents, so nothing is
copied.

That last part is the problem. The compiler cannot work out which of the two
inputs the returned slices borrow from, and it refuses to guess.

```starter
pub fn search(pattern: &str, contents: &str) -> Vec<&str> {
    contents
        .lines()
        .filter(|line| line.contains(pattern))
        .collect()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_matching_lines() {
        let contents = "\
Rust:
safe, fast, productive.
Pick three.";
        assert_eq!(search("fast", contents), vec!["safe, fast, productive."]);
    }

    #[test]
    fn no_match_is_empty() {
        assert!(search("Monomorphise", "Rust:\nsafe").is_empty());
    }
}
```

```solution
pub fn search<'a>(pattern: &str, contents: &'a str) -> Vec<&'a str> {
    contents
        .lines()
        .filter(|line| line.contains(pattern))
        .collect()
}
```

@hint The returned slices are cut out of exactly one of the two arguments. Which one?
@hint Name a lifetime, then attach it to the argument the slices come from and to the return type. The other argument does not need one.
@hint `pub fn search<'a>(pattern: &str, contents: &'a str) -> Vec<&'a str>`

@diagnose E0106
`missing lifetime specifier ... this function's return type contains a borrowed
value, but the signature does not say whether it is borrowed from pattern or
contents`.

Elision has one rule that could have saved you here: with exactly one input
reference, the output borrows from it. There are two, so the rule does not apply
and rustc will not pick. It is not being pedantic — the choice is load-bearing.
If the output borrowed from `pattern`, the caller could drop `contents` while
holding the results.

rustc's own suggestion ties *all three* to `'a`. That compiles, and it is
stricter than you need: it would force `pattern` to live as long as the results.
Tie only `contents`.

@after
This signature is the whole design of the tool in one line. Nothing is allocated
per match; a hit is a pointer and a length into the buffer you already read. On a
100 MB file that is the difference between a search and a memory problem.

It is also why the search logic lives in `src/lib.rs` and not in `main`. A
function taking `&str` and returning `Vec<&str>` needs no filesystem, no
arguments, no process — so it can be tested. `main` cannot be tested. Push
everything you can across that line.

## 2. Case-insensitive, and one type off

@kind fix
@concept lib split
@expect E0277

The `-i` flag needs a second search that lowercases both sides before comparing.
The shape is right, the borrow is not: one value is owned where a borrowed one
was wanted.

```starter
pub fn search_insensitive<'a>(pattern: &str, contents: &'a str) -> Vec<&'a str> {
    let pattern = pattern.to_lowercase();
    contents
        .lines()
        .filter(|line| line.to_lowercase().contains(pattern))
        .collect()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_case_on_both_sides() {
        let contents = "\
Rust:
Trust me.
Pick three.";
        assert_eq!(
            search_insensitive("rUsT", contents),
            vec!["Rust:", "Trust me."]
        );
    }
}
```

```solution
pub fn search_insensitive<'a>(pattern: &str, contents: &'a str) -> Vec<&'a str> {
    let pattern = pattern.to_lowercase();
    contents
        .lines()
        .filter(|line| line.to_lowercase().contains(&pattern))
        .collect()
}
```

@hint `to_lowercase` allocates, so `pattern` is now a `String`, not a `&str`.
@hint `contains` accepts anything implementing `Pattern`. `&str` and `&String` do. `String` itself does not.
@hint One `&` at the call: `.contains(&pattern)`.

@diagnose E0277
`the trait bound String: Pattern is not satisfied`.

`contains` is generic: `fn contains<P: Pattern>(&self, pat: P) -> bool`. That is
what lets you write `.contains('x')`, `.contains("xy")` and
`.contains(char::is_numeric)` with one method. The impls cover `char`, `&str`,
`&String`, `&[char]` and closures — every cheap, borrowed way of describing a
needle. `String` by value is deliberately not among them, because taking the
needle by value would mean consuming it on every call.

rustc's `help: consider borrowing here` is the fix verbatim. Note the second
problem it saves you from: `contains(pattern)` inside a closure that runs once
per line would try to move `pattern` out of the closure's environment.

@after
`to_lowercase` allocates a fresh `String` for every line, which for a search tool
is the hot loop. Real tools avoid it: `line.to_lowercase()` on a 10 MB file is 10
MB of allocation churn to answer a yes/no question.

The cheap alternative for ASCII is `eq_ignore_ascii_case`, and the correct one for
Unicode is a crate that does caseless matching without materialising a new string.
Correct first, then measure — but know that this line is where the time goes.

## 3. Line numbers, and the shape of a tuple

@kind fix
@concept lib split
@expect E0599

Results are more useful with line numbers, so the iterator gains an `enumerate`.
Everything downstream now sees a pair rather than a line, and one closure did not
get the memo.

```starter
#[derive(Debug, PartialEq)]
pub struct Hit {
    pub line_no: usize,
    pub text: String,
}

pub fn search(pattern: &str, contents: &str) -> Vec<Hit> {
    contents
        .lines()
        .enumerate()
        .filter(|line| line.contains(pattern))
        .map(|(i, line)| Hit { line_no: i + 1, text: line.to_string() })
        .collect()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_from_one() {
        let contents = "alpha\nbeta\ngamma beta";
        assert_eq!(
            search("beta", contents),
            vec![
                Hit { line_no: 2, text: "beta".to_string() },
                Hit { line_no: 3, text: "gamma beta".to_string() },
            ]
        );
    }
}
```

```solution
#[derive(Debug, PartialEq)]
pub struct Hit {
    pub line_no: usize,
    pub text: String,
}

pub fn search(pattern: &str, contents: &str) -> Vec<Hit> {
    contents
        .lines()
        .enumerate()
        .filter(|(_, line)| line.contains(pattern))
        .map(|(i, line)| Hit { line_no: i + 1, text: line.to_string() })
        .collect()
}
```

@hint `enumerate` changes the item type. What does `filter` receive now?
@hint The `map` closure already destructures the pair with `|(i, line)|`. The `filter` closure did not.
@hint `.filter(|(_, line)| line.contains(pattern))` — the index is not needed for the decision.

@diagnose E0599
`no method named contains found for reference &(usize, &str)`.

Read the receiver type in the message, not the method name. `enumerate` wraps
each item in a pair, so the closure's parameter is `&(usize, &str)` — a tuple,
which has no `contains`. The `map` on the next line already handles this by
destructuring in the pattern position, which is why only one of the two closures
is complaining.

`filter` hands out `&Item` rather than `Item`, which is why the pattern is
`|(_, line)|` and `line` comes out as `&&str`. Method resolution auto-derefs
through both layers, so `line.contains(...)` works untouched once the tuple is
opened.

@after
Note the index is `i + 1`. `enumerate` counts from zero and every editor, every
compiler and every human counts lines from one. Getting this wrong is invisible
in a unit test that only searches line one, which is a decent argument for
writing the test with a match on line three.

`Hit` allocating a `String` per match is a deliberate step back from exercise 1.
It buys an owned, `PartialEq` type that is easy to assert on. For a real tool you
would keep the borrow and pay nothing; for a first version, correctness first.

## 4. The library's own error type

@kind fix
@concept error type
@expect E0271

`--context 3` says to print three lines either side. Parsing that argument can
fail, and this is the library half, so it returns a type the caller can `match`
on rather than a string.

The `?` on the parse does not compile yet.

```starter
use std::num::ParseIntError;

#[derive(Debug, PartialEq)]
pub enum ConfigError {
    EmptyPattern,
    BadContext(ParseIntError),
    ContextTooLarge(usize),
}

pub fn parse_context(arg: &str) -> Result<usize, ConfigError> {
    let n: usize = arg.parse()?;
    if n > 100 {
        return Err(ConfigError::ContextTooLarge(n));
    }
    Ok(n)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_number() {
        assert_eq!(parse_context("3"), Ok(3));
    }

    #[test]
    fn rejects_nonsense_with_the_parse_error_inside() {
        match parse_context("three") {
            Err(ConfigError::BadContext(_)) => {}
            other => panic!("wanted BadContext, got {other:?}"),
        }
    }

    #[test]
    fn rejects_absurd_values() {
        assert_eq!(parse_context("9000"), Err(ConfigError::ContextTooLarge(9000)));
    }
}
```

```solution
use std::num::ParseIntError;

#[derive(Debug, PartialEq)]
pub enum ConfigError {
    EmptyPattern,
    BadContext(ParseIntError),
    ContextTooLarge(usize),
}

impl From<ParseIntError> for ConfigError {
    fn from(e: ParseIntError) -> Self {
        ConfigError::BadContext(e)
    }
}

pub fn parse_context(arg: &str) -> Result<usize, ConfigError> {
    let n: usize = arg.parse()?;
    if n > 100 {
        return Err(ConfigError::ContextTooLarge(n));
    }
    Ok(n)
}
```

@hint `?` does not just propagate — it converts. Which conversion is it looking for?
@hint It calls `From::from` on the error. There is no `From<ParseIntError>` for `ConfigError`, so write one.
@hint `impl From<ParseIntError> for ConfigError { fn from(e: ParseIntError) -> Self { ConfigError::BadContext(e) } }`

@diagnose E0271
`type mismatch resolving <usize as FromStr>::Err == ConfigError` — with
`expected ConfigError, found ParseIntError` under the `parse` call.

An unusual phrasing for what is a very ordinary problem. Because the function's
error type is written down, rustc pushes it backwards through the `?` and asks
whether `usize`'s `FromStr::Err` *is* `ConfigError`. It is `ParseIntError`, so the
two do not unify and you get a type mismatch rather than the missing-trait
message.

The fix is the same either way, and the desugaring is worth memorising because
every `?` question answers itself once you have it:

```rust
match expr {
    Ok(v) => v,
    Err(e) => return Err(From::from(e)),
}
```

That `From::from` is the entire mechanism. `?` will happily carry an error across
a type boundary, but only along a conversion you have written down. Writing the
`impl From` is not boilerplate you are appeasing the compiler with — it is you
deciding which variant a parse failure becomes, which is a real decision the
compiler cannot make.

@diagnose E0277
`the trait bound ConfigError: From<ParseIntError> is not satisfied`. The same
missing conversion, reported the plainer way — you get this wording when the
error type reaches `?` from a function call rather than from an inference
variable rustc was still resolving. Write the `impl From<ParseIntError> for
ConfigError` and both spellings go away.

@diagnose E0369
You may hit this if you tried to compare `ParseIntError` values by hand. It does
implement `PartialEq`, so `derive(PartialEq)` on the enum is fine; but the
`ParseIntError` inside is opaque and you cannot construct one to compare against.
That is why the test uses a `match` on the variant rather than `assert_eq!` for
that case.

@after
This is the library half of the split the whole unit is about. `ConfigError` is a
type: a caller can `match` on it, log `BadContext` differently from
`ContextTooLarge`, and recover from one and not the other.

The application half wants the opposite thing. `main` does not match on errors —
it prints them and exits — so there it is `anyhow::Error`, which flattens every
error into one type carrying a chain of human-readable context. Same `?`, two
different jobs. Libraries return types; applications return `anyhow::Result`.

## 5. Context is a trait, not a method

@kind fix
@concept anyhow
@expect E0599

Now the application half. `anyhow` lets any error be wrapped with a sentence
explaining what the program was trying to do — which is what a user staring at
`invalid digit found in string` actually needs.

The call is right and the compiler cannot find it.

```starter
use anyhow::Result;

pub fn parse_port(arg: &str) -> Result<u16> {
    let port: u16 = arg
        .parse()
        .context("--port must be a number between 0 and 65535")?;
    Ok(port)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_good_port() {
        assert_eq!(parse_port("8080").unwrap(), 8080);
    }

    #[test]
    fn keeps_both_halves_of_the_story() {
        let e = parse_port("http").unwrap_err();
        let full = format!("{e:#}");
        assert!(full.contains("--port must be a number"), "missing context: {full}");
        assert!(full.contains("invalid digit"), "missing cause: {full}");
    }
}
```

```solution
use anyhow::{Context, Result};

pub fn parse_port(arg: &str) -> Result<u16> {
    let port: u16 = arg
        .parse()
        .context("--port must be a number between 0 and 65535")?;
    Ok(port)
}
```

@hint The method exists. Read the second half of the error message, past the underline.
@hint `context` comes from the `anyhow::Context` trait, and a trait's methods are only callable where the trait is in scope.
@hint `use anyhow::{Context, Result};`

@diagnose E0599
`no method named context found for enum Result` — and then, crucially, `the
following trait is implemented but not in scope: anyhow::Context`.

That second line is the whole answer, and it is the standard shape of this error.
Rust will not let a trait's methods appear on a type unless you have imported the
trait, precisely so that adding a dependency can never silently change what
`x.context(...)` means in your file. The cost is one `use`; the benefit is that
method resolution is a local question.

Whenever E0599 names a method you are sure exists, look for `implemented but not
in scope` before you doubt the method.

@after
`format!("{e:#}")` on an `anyhow::Error` prints the whole chain on one line —
`--port must be...: invalid digit found in string`. Plain `{e}` prints only the
outermost message, and `{e:?}` prints the chain multi-line with a backtrace if
one was captured. `main` returning `anyhow::Result<()>` uses the `{:?}` form,
which is why an anyhow error from `main` already looks like a considered report.

`with_context(|| format!("reading {path}"))` is the version to reach for when the
message needs formatting: the closure only runs on the error path, so the happy
path pays nothing.

## 6. The parser is a derive

@kind fix
@concept clap
@expect E0599

`clap`'s derive API turns a struct into an argument parser: field names become
flags, types become validation, and `--help` writes itself. The struct here is
just a struct.

Make it parse. `-i` and `--ignore-case` should both set the flag, and the two
positionals come in the order written.

```starter
use clap::Parser;

#[derive(Debug)]
pub struct Args {
    pub pattern: String,
    pub path: String,
    pub ignore_case: bool,
}

pub fn parse(argv: Vec<&str>) -> Args {
    Args::parse_from(argv)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn positionals_in_order() {
        let a = parse(vec!["minigrep", "fast", "notes.md"]);
        assert_eq!(a.pattern, "fast");
        assert_eq!(a.path, "notes.md");
        assert!(!a.ignore_case);
    }

    #[test]
    fn short_and_long_both_set_the_flag() {
        assert!(parse(vec!["minigrep", "-i", "fast", "notes.md"]).ignore_case);
        assert!(parse(vec!["minigrep", "--ignore-case", "fast", "notes.md"]).ignore_case);
    }
}
```

```solution
use clap::Parser;

#[derive(Parser, Debug)]
pub struct Args {
    pub pattern: String,
    pub path: String,
    #[arg(short, long)]
    pub ignore_case: bool,
}

pub fn parse(argv: Vec<&str>) -> Args {
    Args::parse_from(argv)
}
```

@hint `parse_from` is not a method anybody wrote. It arrives with a derive.
@hint Add `Parser` to the derive list. Then decide how `ignore_case` should appear on the command line — by default a `bool` field is still a positional.
@hint `#[derive(Parser, Debug)]`, and `#[arg(short, long)]` above `ignore_case` to make it `-i` / `--ignore-case`.

@diagnose E0599
`no function or associated item named parse_from found for struct Args`.

`Parser` is a trait with a set of provided methods — `parse`, `parse_from`,
`try_parse_from` — and `#[derive(Parser)]` is what generates the impl. Without the
derive there is no impl, so there is no method, and the error is about a missing
function rather than a missing import.

If you add the derive and the tests still fail, the second half is the flag.
`ignore_case: bool` with no attribute is a *positional* argument of boolean type,
so `-i` is read as an unknown flag and `parse_from` exits the process. `#[arg(short,
long)]` derives `-i` and `--ignore-case` from the field name.

@diagnose E0433
`failed to resolve: use of undeclared crate or module clap` means the `use
clap::Parser;` line went missing. The trait has to be in scope for the derive to
name it.

@after
`parse_from` takes the argument list as a parameter; `parse` reads
`std::env::args_os()`. The first is testable and the second is not, which is the
same split as `lib.rs` versus `main.rs` at a smaller scale — and it is why
`main` should be four lines: parse, build config, call into the library, map the
result to an exit code.

Prefer `try_parse_from` in a library: `parse_from` calls `std::process::exit` on
bad input, which in a test aborts the test runner rather than failing a test.

## 7. Results to stdout, complaints to stderr

@kind fix
@concept stderr
@expect E0277

Two streams, and the difference matters: `minigrep foo *.txt | wc -l` must count
matches, not warnings. Matches go to stdout, everything else to stderr, and the
return value becomes the process exit code.

Writing can fail, and this function has nowhere to put that failure.

```starter
use std::io::Write;

pub fn report(
    out: &mut impl Write,
    err: &mut impl Write,
    hits: &[String],
    unreadable: &[String],
) -> u8 {
    for hit in hits {
        writeln!(out, "{hit}")?;
    }
    for path in unreadable {
        writeln!(err, "minigrep: {path}: could not be read")?;
    }
    if hits.is_empty() { 1 } else { 0 }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_the_two_streams() {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let code = report(
            &mut out,
            &mut err,
            &["src/lib.rs:4: fast".to_string()],
            &["locked.txt".to_string()],
        )
        .unwrap();

        assert_eq!(code, 0);
        assert_eq!(String::from_utf8(out).unwrap(), "src/lib.rs:4: fast\n");
        assert_eq!(
            String::from_utf8(err).unwrap(),
            "minigrep: locked.txt: could not be read\n"
        );
    }

    #[test]
    fn no_matches_is_exit_one() {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        assert_eq!(report(&mut out, &mut err, &[], &[]).unwrap(), 1);
        assert!(out.is_empty());
    }
}
```

```solution
use std::io::Write;

pub fn report(
    out: &mut impl Write,
    err: &mut impl Write,
    hits: &[String],
    unreadable: &[String],
) -> std::io::Result<u8> {
    for hit in hits {
        writeln!(out, "{hit}")?;
    }
    for path in unreadable {
        writeln!(err, "minigrep: {path}: could not be read")?;
    }
    Ok(if hits.is_empty() { 1 } else { 0 })
}
```

@hint `writeln!` returns a `Result`. `?` needs somewhere to send an `Err`.
@hint Change the return type, then wrap the final value.
@hint `-> std::io::Result<u8>`, and the last expression becomes `Ok(if hits.is_empty() { 1 } else { 0 })`.

@diagnose E0277
`the ? operator can only be used in a function that returns Result or Option (or
another type that implements FromResidual)`.

`?` is not a shorthand for "ignore this" — it is an early return of an `Err`, and
a function returning `u8` has no way to express one. rustc says as much:
`this function should return Result or Option to accept ?`.

Two fixes exist and only one is honest. Changing the return type propagates the
failure to a caller who can decide. Replacing `?` with `.unwrap()` makes a broken
pipe — `minigrep foo big.txt | head -3` — into a panic with a backtrace, which is
the single most common way a small tool embarrasses itself.

@after
Taking `&mut impl Write` rather than calling `println!` is what made this
testable: the test passes two `Vec<u8>` and reads back exactly what would have
been printed. In `main` you pass `io::stdout().lock()` and `io::stderr().lock()`,
and lock them once rather than per line — `println!` locks and unlocks on every
call, which is measurable in a loop.

The `u8` becomes the exit status: `ExitCode::from(code)`, returned from `main`,
where the convention is 0 found, 1 not found, 2 something went wrong. `grep` has
used exactly those three for forty years, and scripts depend on it.

## 8. A library error the application can carry

@kind fix
@concept error type
@expect E0277

The last seam. `search` is library code, so it returns `SearchError` — a type a
caller can match on. `run` is application code, so it returns `anyhow::Result`
and `?` should absorb anything.

It does not, and the reason is a bound `anyhow` places on what it will accept.

```starter
#[derive(Debug, PartialEq)]
pub enum SearchError {
    EmptyPattern,
    PatternTooLong { len: usize, max: usize },
}

pub fn search<'a>(pattern: &str, contents: &'a str) -> Result<Vec<&'a str>, SearchError> {
    if pattern.is_empty() {
        return Err(SearchError::EmptyPattern);
    }
    if pattern.len() > 64 {
        return Err(SearchError::PatternTooLong { len: pattern.len(), max: 64 });
    }
    Ok(contents.lines().filter(|line| line.contains(pattern)).collect())
}

pub fn run(pattern: &str, contents: &str) -> anyhow::Result<usize> {
    let hits = search(pattern, contents)?;
    Ok(hits.len())
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_library_returns_a_matchable_type() {
        assert_eq!(search("", "anything"), Err(SearchError::EmptyPattern));
        assert_eq!(
            search(&"x".repeat(65), "anything"),
            Err(SearchError::PatternTooLong { len: 65, max: 64 })
        );
    }

    #[test]
    fn the_application_gets_a_sentence() {
        assert_eq!(run("fast", "slow\nfast\n").unwrap(), 1);
        let e = run("", "anything").unwrap_err();
        assert_eq!(e.to_string(), "search pattern must not be empty");
    }

    #[test]
    fn the_long_pattern_message_names_the_numbers() {
        let e = run(&"x".repeat(65), "anything").unwrap_err();
        assert_eq!(e.to_string(), "search pattern is 65 bytes, the limit is 64");
    }
}
```

```solution
use std::fmt;

#[derive(Debug, PartialEq)]
pub enum SearchError {
    EmptyPattern,
    PatternTooLong { len: usize, max: usize },
}

impl fmt::Display for SearchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SearchError::EmptyPattern => write!(f, "search pattern must not be empty"),
            SearchError::PatternTooLong { len, max } => {
                write!(f, "search pattern is {len} bytes, the limit is {max}")
            }
        }
    }
}

impl std::error::Error for SearchError {}

pub fn search<'a>(pattern: &str, contents: &'a str) -> Result<Vec<&'a str>, SearchError> {
    if pattern.is_empty() {
        return Err(SearchError::EmptyPattern);
    }
    if pattern.len() > 64 {
        return Err(SearchError::PatternTooLong { len: pattern.len(), max: 64 });
    }
    Ok(contents.lines().filter(|line| line.contains(pattern)).collect())
}

pub fn run(pattern: &str, contents: &str) -> anyhow::Result<usize> {
    let hits = search(pattern, contents)?;
    Ok(hits.len())
}
```

@hint Read what `anyhow` requires of an error before it will hold one. The error message names the trait.
@hint `std::error::Error` has a supertrait: nothing can implement `Error` without implementing `Display` first. Write the `Display` impl and the tests tell you the exact wording.
@hint `impl fmt::Display for SearchError` with a `match` over the two variants, then a bare `impl std::error::Error for SearchError {}` — every method on `Error` has a default.

@diagnose E0277
`? couldn't convert the error: the trait std::error::Error is not implemented for
SearchError`.

`anyhow::Error` can hold any error, but "any error" has a definition:
`E: std::error::Error + Send + Sync + 'static`. That bound is what lets `anyhow`
print a chain, downcast back to your type, and cross a thread boundary. Your enum
satisfies `Send`, `Sync` and `'static` automatically — it holds only `usize`s —
and fails on `Error`.

Implementing `Error` means implementing `Display` first, because `Error` has
`Debug + Display` as supertraits. That is not ceremony: `Error` promises the value
can be shown to a human, and `Display` is that promise.

@diagnose E0119
Two `Display` impls for one type, or a `Display` impl clashing with a `derive`.
`Display` is never derivable in std — the compiler cannot invent your wording —
so if you wrote `#[derive(Display)]` it came from a crate that is not in scope
here. Write the impl by hand.

@after
Real code does not write these impls by hand. `thiserror` derives both from
attributes on the variants:

```rust
#[derive(Debug, thiserror::Error)]
pub enum SearchError {
    #[error("search pattern must not be empty")]
    EmptyPattern,
    #[error("search pattern is {len} bytes, the limit is {max}")]
    PatternTooLong { len: usize, max: usize },
}
```

That is the whole division of labour, and it is the shape of nearly every Rust
CLI worth reading: `thiserror` in `lib.rs` to define errors your caller can match
on, `anyhow` in `main.rs` to accumulate context and print it once. You have just
built both halves by hand, which is the only way the derive stops looking like
magic.
