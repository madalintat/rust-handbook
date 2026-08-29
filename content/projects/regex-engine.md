---
project: regex-engine
tier: core
domain: languages
title: A regex engine
accent: plum
blurb: Parse a pattern, compile it to a tiny instruction set, and run it two ways: the obvious one that takes three million steps on a nineteen character pattern, and Thompson's, which takes 893.
needs: 09-enums, 11-collections, 12-errors
mins: 75
---

Almost every regex engine you have used is a backtracker. Perl, PCRE, Python's
`re`, JavaScript's `RegExp`, Java's `Pattern`: they try one path through the
pattern, and when it fails they rewind the input and try the next one. That is
simple to write, it supports backreferences, and on some patterns it takes
time exponential in the length of the input. Stack Overflow went down for
half an hour in 2016 because of a regex that trimmed trailing whitespace.
Cloudflare took most of its network offline in 2019 for the same reason. The
class of bug has a name, ReDoS, and it exists because of an implementation
choice rather than anything about regular expressions.

There is another way, and Ken Thompson published it in 1968. Compile the
pattern into a small program, then run every possible path at once: keep a set
of active positions in that program, advance all of them by one input
character, and refuse to put the same instruction into the set twice. The
number of states is bounded by the size of the pattern, so the work is the
pattern size times the input length. Always. This is what Rust's `regex` crate
does, and Go's `regexp`, and RE2. It is why none of them offer
backreferences: a backreference is not a regular expression, and supporting it
would mean giving up the guarantee.

You will build both engines and measure the difference on the standard
pathological case. Eight stages: a syntax tree, a parser with real precedence,
a compiler to four instructions, the backtracker, the blowup, the Thompson
simulation, the measurement, and capture groups on top. About two hundred and
fifty lines.

What a production engine adds: a literal prefilter (`memchr` before the
automaton ever starts), a lazy DFA that caches state sets so the common case
runs one table lookup per byte, and unanchored search. The algorithm in stage
6 is still underneath all of it.

## 1. A pattern is a tree

@kind fix
@concept enum

@expect E0072

`a(b|c)*` is a concatenation of a character and a repetition of an
alternation. Every construct in a regex holds smaller constructs, which makes
`Ast` a recursive enum, and this version of it is one the compiler cannot lay
out in memory.

```starter
#[derive(Debug, Clone, PartialEq)]
pub enum Ast {
    Char(char),
    Dot,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Concat(Vec<Ast>),
    Alternate(Ast, Ast),
    Star(Ast),
    Plus(Ast),
    Optional(Ast),
}

pub fn show(ast: &Ast) -> String {
    match ast {
        Ast::Char(c) => c.to_string(),
        Ast::Dot => ".".to_string(),
        Ast::Class { negated, ranges } => {
            let mut s = String::from("[");
            if *negated {
                s.push('^');
            }
            for &(lo, hi) in ranges {
                s.push(lo);
                if lo != hi {
                    s.push('-');
                    s.push(hi);
                }
            }
            s.push(']');
            s
        }
        Ast::Concat(items) => items.iter().map(show).collect(),
        Ast::Alternate(a, b) => format!("{}|{}", show(a), show(b)),
        Ast::Star(a) => format!("{}*", atom(a)),
        Ast::Plus(a) => format!("{}+", atom(a)),
        Ast::Optional(a) => format!("{}?", atom(a)),
    }
}

/// A repeat operator binds to one atom, so anything bigger needs brackets
/// putting back when the tree is printed.
fn atom(ast: &Ast) -> String {
    match ast {
        Ast::Char(_) | Ast::Dot | Ast::Class { .. } => show(ast),
        _ => format!("({})", show(ast)),
    }
}

pub fn run() -> String {
    // a(b|c)*  built by hand, since there is no parser until the next stage.
    let ast = Ast::Concat(vec![
        Ast::Char('a'),
        Ast::Star(Box::new(Ast::Alternate(
            Box::new(Ast::Char('b')),
            Box::new(Ast::Char('c')),
        ))),
    ]);
    println!("{ast:#?}");
    let text = show(&ast);
    println!("prints back as {text}");
    text
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_star_over_an_alternation_prints_back() {
        assert_eq!(run(), "a(b|c)*");
    }

    #[test]
    fn brackets_come_back_only_where_a_reader_needs_them() {
        let ab = Ast::Concat(vec![Ast::Char('a'), Ast::Char('b')]);
        assert_eq!(show(&ab), "ab");
        assert_eq!(show(&Ast::Star(Box::new(ab))), "(ab)*");
        assert_eq!(show(&Ast::Star(Box::new(Ast::Char('a')))), "a*");
        assert_eq!(show(&Ast::Plus(Box::new(Ast::Dot))), ".+");
    }

    #[test]
    fn classes_render_their_ranges() {
        assert_eq!(
            show(&Ast::Class { negated: false, ranges: vec![('a', 'z'), ('0', '9')] }),
            "[a-z0-9]"
        );
        assert_eq!(
            show(&Ast::Class { negated: true, ranges: vec![('x', 'x')] }),
            "[^x]"
        );
    }

    #[test]
    fn the_tree_is_one_word_per_child() {
        // Every recursive child is behind a pointer, so the enum has a size.
        assert!(std::mem::size_of::<Ast>() <= 40, "{}", std::mem::size_of::<Ast>());
    }
}
```

```solution
#[derive(Debug, Clone, PartialEq)]
pub enum Ast {
    Char(char),
    Dot,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Concat(Vec<Ast>),
    Alternate(Box<Ast>, Box<Ast>),
    Star(Box<Ast>),
    Plus(Box<Ast>),
    Optional(Box<Ast>),
}

pub fn show(ast: &Ast) -> String {
    match ast {
        Ast::Char(c) => c.to_string(),
        Ast::Dot => ".".to_string(),
        Ast::Class { negated, ranges } => {
            let mut s = String::from("[");
            if *negated {
                s.push('^');
            }
            for &(lo, hi) in ranges {
                s.push(lo);
                if lo != hi {
                    s.push('-');
                    s.push(hi);
                }
            }
            s.push(']');
            s
        }
        Ast::Concat(items) => items.iter().map(show).collect(),
        Ast::Alternate(a, b) => format!("{}|{}", show(a), show(b)),
        Ast::Star(a) => format!("{}*", atom(a)),
        Ast::Plus(a) => format!("{}+", atom(a)),
        Ast::Optional(a) => format!("{}?", atom(a)),
    }
}

/// A repeat operator binds to one atom, so anything bigger needs brackets
/// putting back when the tree is printed.
fn atom(ast: &Ast) -> String {
    match ast {
        Ast::Char(_) | Ast::Dot | Ast::Class { .. } => show(ast),
        _ => format!("({})", show(ast)),
    }
}

pub fn run() -> String {
    // a(b|c)*  built by hand, since there is no parser until the next stage.
    let ast = Ast::Concat(vec![
        Ast::Char('a'),
        Ast::Star(Box::new(Ast::Alternate(
            Box::new(Ast::Char('b')),
            Box::new(Ast::Char('c')),
        ))),
    ]);
    println!("{ast:#?}");
    let text = show(&ast);
    println!("prints back as {text}");
    text
}
```

@hint The compiler is being asked how many bytes an `Ast` occupies. Work through it: a `Star` holds an `Ast`, which might be a `Star`, which holds an `Ast`.
@hint The answer has to be a fixed number, and the only way to get one is for a child to live somewhere else, with a pointer here. `Concat` already does this, because `Vec` is a pointer.
@hint `Star(Box<Ast>)`, and the same for `Plus`, `Optional`, and both sides of `Alternate`.

@diagnose E0072
`recursive type `Ast` has infinite size`, with `recursive without
indirection` under the offending variant.

The compiler lays out an enum as a tag plus enough room for the largest
variant, and it needs a number. `Star(Ast)` says a `Star` is at least as big as
an `Ast`, and an `Ast` is at least as big as a `Star`, so the only solution is
infinity. Nothing about the definition is illegal, it just has no size.

`Box<Ast>` fixes it because a `Box` is one pointer, eight bytes, whatever it
points at. The child moves to the heap and the parent holds an address.
`Concat(Vec<Ast>)` was already fine for the same reason: `Vec` is a pointer, a
length and a capacity, and none of those depend on `Ast`.

The finished enum is 32 bytes, set by the `Class` variant's `Vec` plus its
`bool`.

@diagnose E0308
`arguments to this enum variant are incorrect`, expected `Ast`, found
`Box<Ast>`, pointing at `run`. This is the second error the broken definition
produces rather than a separate problem: `run` builds the tree the way the
finished enum wants it, with `Box::new` around each child, and the current
`Star(Ast)` takes a bare `Ast`. Fix the enum and this goes with it. Take the
suggestion to write `*Box::new(...)` and you will be back at E0072.

@after
`show` is not decoration. Printing a tree back as source is the cheapest
way to find out whether the parser you write next agrees with you about
precedence, because a wrong tree comes back as a different string.

Notice where the brackets come from. Nothing in the tree records that the
original pattern had a `(` in it, so `atom` puts brackets back wherever a
repeat applies to something that is not a single character. `a(b|c)*` and
`a((b|c))*` parse to the same tree and print as the same string, which is
correct: they mean the same thing.

## 2. Alternation binds loosest

@kind fix
@concept result

@expect E0308

Three functions, one per precedence level: `alternate` splits on `|`,
`concat` collects a run of items, `repeat` sticks postfix operators onto a
single atom. Each returns a `Result` because a pattern can be malformed, and
`alternate` is not dealing with that.

```starter
#[derive(Debug, Clone, PartialEq)]
pub enum Ast {
    Char(char),
    Dot,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Concat(Vec<Ast>),
    Alternate(Box<Ast>, Box<Ast>),
    Star(Box<Ast>),
    Plus(Box<Ast>),
    Optional(Box<Ast>),
}

pub fn show(ast: &Ast) -> String {
    match ast {
        Ast::Char(c) => c.to_string(),
        Ast::Dot => ".".to_string(),
        Ast::Class { negated, ranges } => {
            let mut s = String::from("[");
            if *negated {
                s.push('^');
            }
            for &(lo, hi) in ranges {
                s.push(lo);
                if lo != hi {
                    s.push('-');
                    s.push(hi);
                }
            }
            s.push(']');
            s
        }
        Ast::Concat(items) => items.iter().map(show).collect(),
        Ast::Alternate(a, b) => format!("{}|{}", show(a), show(b)),
        Ast::Star(a) => format!("{}*", atom(a)),
        Ast::Plus(a) => format!("{}+", atom(a)),
        Ast::Optional(a) => format!("{}?", atom(a)),
    }
}

/// A repeat operator binds to one atom, so anything bigger needs brackets
/// putting back when the tree is printed.
fn atom(ast: &Ast) -> String {
    match ast {
        Ast::Char(_) | Ast::Dot | Ast::Class { .. } => show(ast),
        _ => format!("({})", show(ast)),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    UnexpectedEnd,
    UnclosedGroup(usize),
    StrayParen(usize),
    NothingToRepeat(usize),
    UnclosedClass(usize),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::UnexpectedEnd => write!(f, "pattern ends early"),
            ParseError::UnclosedGroup(i) => write!(f, "unclosed ( at {i}"),
            ParseError::StrayParen(i) => write!(f, "unmatched ) at {i}"),
            ParseError::NothingToRepeat(i) => write!(f, "nothing to repeat at {i}"),
            ParseError::UnclosedClass(i) => write!(f, "unclosed [ at {i}"),
        }
    }
}

pub struct Parser {
    chars: Vec<char>,
    pos: usize,
}

impl Parser {
    pub fn new(pattern: &str) -> Parser {
        Parser { chars: pattern.chars().collect(), pos: 0 }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    /// Loosest binding: everything up to a `|`, then everything after it.
    fn alternate(&mut self) -> Result<Ast, ParseError> {
        let mut left = self.concat();
        while self.peek() == Some('|') {
            self.bump();
            let right = self.concat();
            left = Ast::Alternate(Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    /// Tighter: a run of repeated atoms, stopping at `|` or `)`.
    fn concat(&mut self) -> Result<Ast, ParseError> {
        let mut items = Vec::new();
        while let Some(c) = self.peek() {
            if c == '|' || c == ')' {
                break;
            }
            items.push(self.repeat()?);
        }
        Ok(Ast::Concat(items))
    }

    /// Tightest: one atom with any number of postfix operators on it.
    fn repeat(&mut self) -> Result<Ast, ParseError> {
        let mut node = self.single()?;
        loop {
            match self.peek() {
                Some('*') => {
                    self.bump();
                    node = Ast::Star(Box::new(node));
                }
                Some('+') => {
                    self.bump();
                    node = Ast::Plus(Box::new(node));
                }
                Some('?') => {
                    self.bump();
                    node = Ast::Optional(Box::new(node));
                }
                _ => return Ok(node),
            }
        }
    }

    fn single(&mut self) -> Result<Ast, ParseError> {
        let start = self.pos;
        match self.bump() {
            None => Err(ParseError::UnexpectedEnd),
            Some('(') => {
                let inner = self.alternate()?;
                if self.bump() != Some(')') {
                    return Err(ParseError::UnclosedGroup(start));
                }
                Ok(inner)
            }
            Some(')') => Err(ParseError::StrayParen(start)),
            Some('.') => Ok(Ast::Dot),
            Some('[') => self.class(start),
            Some('*' | '+' | '?') => Err(ParseError::NothingToRepeat(start)),
            Some('\\') => match self.bump() {
                None => Err(ParseError::UnexpectedEnd),
                Some(c) => Ok(Ast::Char(c)),
            },
            Some(c) => Ok(Ast::Char(c)),
        }
    }

    fn class(&mut self, start: usize) -> Result<Ast, ParseError> {
        let negated = self.peek() == Some('^');
        if negated {
            self.bump();
        }
        let mut ranges = Vec::new();
        loop {
            let lo = match self.bump() {
                None => return Err(ParseError::UnclosedClass(start)),
                Some(']') => break,
                Some(c) => c,
            };
            let dashed = self.peek() == Some('-')
                && self.chars.get(self.pos + 1).is_some_and(|&n| n != ']');
            if dashed {
                self.bump();
                let hi = self.bump().ok_or(ParseError::UnclosedClass(start))?;
                ranges.push((lo, hi));
            } else {
                ranges.push((lo, lo));
            }
        }
        Ok(Ast::Class { negated, ranges })
    }
}

pub fn parse(pattern: &str) -> Result<Ast, ParseError> {
    let mut p = Parser::new(pattern);
    let ast = p.alternate()?;
    if p.pos < p.chars.len() {
        return Err(ParseError::StrayParen(p.pos));
    }
    Ok(ast)
}

pub fn run() -> Vec<String> {
    let mut out = Vec::new();
    for pattern in ["ab|cd", "a(b|c)*", "(ab)*c", "a+b?", "[a-z0-9]+", "a.c"] {
        let ast = parse(pattern).expect("pattern parses");
        println!("{pattern:10}  {ast:?}");
        out.push(show(&ast));
    }
    println!("(ab      {}", parse("(ab").unwrap_err());
    println!("*a       {}", parse("*a").unwrap_err());
    out
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_pattern_prints_back_as_itself() {
        assert_eq!(
            run(),
            ["ab|cd", "a(b|c)*", "(ab)*c", "a+b?", "[a-z0-9]+", "a.c"]
        );
    }

    #[test]
    fn alternation_binds_looser_than_concatenation() {
        assert_eq!(
            parse("ab|cd"),
            Ok(Ast::Alternate(
                Box::new(Ast::Concat(vec![Ast::Char('a'), Ast::Char('b')])),
                Box::new(Ast::Concat(vec![Ast::Char('c'), Ast::Char('d')])),
            ))
        );
    }

    #[test]
    fn a_repeat_binds_tighter_than_concatenation() {
        assert_eq!(
            parse("ab*"),
            Ok(Ast::Concat(vec![
                Ast::Char('a'),
                Ast::Star(Box::new(Ast::Char('b'))),
            ]))
        );
    }

    #[test]
    fn broken_patterns_come_back_as_errors() {
        assert_eq!(parse("(ab"), Err(ParseError::UnclosedGroup(0)));
        assert_eq!(parse("a)"), Err(ParseError::StrayParen(1)));
        assert_eq!(parse("*a"), Err(ParseError::NothingToRepeat(0)));
        assert_eq!(parse("[a-z"), Err(ParseError::UnclosedClass(0)));
        assert_eq!(parse("a\\"), Err(ParseError::UnexpectedEnd));
    }

    #[test]
    fn an_escape_is_an_ordinary_character() {
        assert_eq!(parse("a\\.b"), Ok(Ast::Concat(vec![
            Ast::Char('a'),
            Ast::Char('.'),
            Ast::Char('b'),
        ])));
    }
}
```

```solution
#[derive(Debug, Clone, PartialEq)]
pub enum Ast {
    Char(char),
    Dot,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Concat(Vec<Ast>),
    Alternate(Box<Ast>, Box<Ast>),
    Star(Box<Ast>),
    Plus(Box<Ast>),
    Optional(Box<Ast>),
}

pub fn show(ast: &Ast) -> String {
    match ast {
        Ast::Char(c) => c.to_string(),
        Ast::Dot => ".".to_string(),
        Ast::Class { negated, ranges } => {
            let mut s = String::from("[");
            if *negated {
                s.push('^');
            }
            for &(lo, hi) in ranges {
                s.push(lo);
                if lo != hi {
                    s.push('-');
                    s.push(hi);
                }
            }
            s.push(']');
            s
        }
        Ast::Concat(items) => items.iter().map(show).collect(),
        Ast::Alternate(a, b) => format!("{}|{}", show(a), show(b)),
        Ast::Star(a) => format!("{}*", atom(a)),
        Ast::Plus(a) => format!("{}+", atom(a)),
        Ast::Optional(a) => format!("{}?", atom(a)),
    }
}

/// A repeat operator binds to one atom, so anything bigger needs brackets
/// putting back when the tree is printed.
fn atom(ast: &Ast) -> String {
    match ast {
        Ast::Char(_) | Ast::Dot | Ast::Class { .. } => show(ast),
        _ => format!("({})", show(ast)),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    UnexpectedEnd,
    UnclosedGroup(usize),
    StrayParen(usize),
    NothingToRepeat(usize),
    UnclosedClass(usize),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::UnexpectedEnd => write!(f, "pattern ends early"),
            ParseError::UnclosedGroup(i) => write!(f, "unclosed ( at {i}"),
            ParseError::StrayParen(i) => write!(f, "unmatched ) at {i}"),
            ParseError::NothingToRepeat(i) => write!(f, "nothing to repeat at {i}"),
            ParseError::UnclosedClass(i) => write!(f, "unclosed [ at {i}"),
        }
    }
}

pub struct Parser {
    chars: Vec<char>,
    pos: usize,
}

impl Parser {
    pub fn new(pattern: &str) -> Parser {
        Parser { chars: pattern.chars().collect(), pos: 0 }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    /// Loosest binding: everything up to a `|`, then everything after it.
    fn alternate(&mut self) -> Result<Ast, ParseError> {
        let mut left = self.concat()?;
        while self.peek() == Some('|') {
            self.bump();
            let right = self.concat()?;
            left = Ast::Alternate(Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    /// Tighter: a run of repeated atoms, stopping at `|` or `)`.
    fn concat(&mut self) -> Result<Ast, ParseError> {
        let mut items = Vec::new();
        while let Some(c) = self.peek() {
            if c == '|' || c == ')' {
                break;
            }
            items.push(self.repeat()?);
        }
        Ok(Ast::Concat(items))
    }

    /// Tightest: one atom with any number of postfix operators on it.
    fn repeat(&mut self) -> Result<Ast, ParseError> {
        let mut node = self.single()?;
        loop {
            match self.peek() {
                Some('*') => {
                    self.bump();
                    node = Ast::Star(Box::new(node));
                }
                Some('+') => {
                    self.bump();
                    node = Ast::Plus(Box::new(node));
                }
                Some('?') => {
                    self.bump();
                    node = Ast::Optional(Box::new(node));
                }
                _ => return Ok(node),
            }
        }
    }

    fn single(&mut self) -> Result<Ast, ParseError> {
        let start = self.pos;
        match self.bump() {
            None => Err(ParseError::UnexpectedEnd),
            Some('(') => {
                let inner = self.alternate()?;
                if self.bump() != Some(')') {
                    return Err(ParseError::UnclosedGroup(start));
                }
                Ok(inner)
            }
            Some(')') => Err(ParseError::StrayParen(start)),
            Some('.') => Ok(Ast::Dot),
            Some('[') => self.class(start),
            Some('*' | '+' | '?') => Err(ParseError::NothingToRepeat(start)),
            Some('\\') => match self.bump() {
                None => Err(ParseError::UnexpectedEnd),
                Some(c) => Ok(Ast::Char(c)),
            },
            Some(c) => Ok(Ast::Char(c)),
        }
    }

    fn class(&mut self, start: usize) -> Result<Ast, ParseError> {
        let negated = self.peek() == Some('^');
        if negated {
            self.bump();
        }
        let mut ranges = Vec::new();
        loop {
            let lo = match self.bump() {
                None => return Err(ParseError::UnclosedClass(start)),
                Some(']') => break,
                Some(c) => c,
            };
            let dashed = self.peek() == Some('-')
                && self.chars.get(self.pos + 1).is_some_and(|&n| n != ']');
            if dashed {
                self.bump();
                let hi = self.bump().ok_or(ParseError::UnclosedClass(start))?;
                ranges.push((lo, hi));
            } else {
                ranges.push((lo, lo));
            }
        }
        Ok(Ast::Class { negated, ranges })
    }
}

pub fn parse(pattern: &str) -> Result<Ast, ParseError> {
    let mut p = Parser::new(pattern);
    let ast = p.alternate()?;
    if p.pos < p.chars.len() {
        return Err(ParseError::StrayParen(p.pos));
    }
    Ok(ast)
}

pub fn run() -> Vec<String> {
    let mut out = Vec::new();
    for pattern in ["ab|cd", "a(b|c)*", "(ab)*c", "a+b?", "[a-z0-9]+", "a.c"] {
        let ast = parse(pattern).expect("pattern parses");
        println!("{pattern:10}  {ast:?}");
        out.push(show(&ast));
    }
    println!("(ab      {}", parse("(ab").unwrap_err());
    println!("*a       {}", parse("*a").unwrap_err());
    out
}
```

@hint `concat` returns `Result<Ast, ParseError>`. The two places its result is used treat it as an `Ast`.
@hint Inside a function that itself returns `Result`, `?` unwraps the success case and returns early on the error, which is exactly what is wanted at both call sites.
@hint `let mut left = self.concat()?;` and `let right = self.concat()?;`.

@diagnose E0308
`expected `Ast`, found `Result<Ast, ParseError>``, at the arguments to
`Box::new`. rustc even offers the fix: `use the `?` operator to extract the
`Result<Ast, ParseError>` value`.

The interesting part is why it is a type error at all. In a language with
exceptions, a call that might fail has the same type as one that cannot, and
the failure travels invisibly. In Rust the possibility of failure is in the
return type, so a caller has to say what it does about it: `?` to propagate,
`match` to handle, `unwrap` to panic. There is no fourth option where the
question is skipped.

`?` here expands to a `match` that returns `Err(From::from(e))` on the error
branch. Both error types are `ParseError`, so the conversion is the identity.

@diagnose E0277
`the `?` operator can only be used in a function that returns Result
or Option`. You put `?` on a call inside a function whose return type is a
plain `Ast`, probably `show` or a helper. `?` needs somewhere to return the
`Err` to, so the enclosing signature has to be `Result<_, E>` with `ParseError`
convertible into `E`. Change the signature, or handle the error there with a
`match`.

@diagnose E0599
`no method named `class` found`, or similar, if you renamed one of
the three level functions but not its call sites. The chain is
`parse` calls `alternate` calls `concat` calls `repeat` calls `single`, and
`single` calls back up to `alternate` for the inside of a bracket. That last
edge is what makes the grammar recursive.

@after
The precedence is in the call order and nowhere else. `alternate` calls
`concat` before it ever looks for a `|`, so by the time a `|` is considered,
everything to its left is already one node. `repeat` calls `single` for exactly
one atom, so `ab*` puts the star on `b` alone. Move the calls around and the
language changes.

This shape is called recursive descent, and it is what most real parsers use,
including rustc's. `single` recursing back into `alternate` for the contents of
a bracket is what makes the grammar handle nesting to any depth without any
extra machinery.

The error type is a plain enum with the offset in each variant. `Display` turns
it into a line a user can read, which is why `parse("(ab")` reports `unclosed (
at 0` rather than a debug dump.

## 3. Split is the whole idea

@kind fill
@concept compile

@expect E0425

The tree becomes a flat program of four instructions. `Char` consumes
one character, `Jump` moves the program counter, `Match` succeeds, and `Split`
goes to two places at once. Star needs the address of the instruction after the
loop, and that name has not been bound.

```starter
#[derive(Debug, Clone, PartialEq)]
pub enum Ast {
    Char(char),
    Dot,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Concat(Vec<Ast>),
    Alternate(Box<Ast>, Box<Ast>),
    Star(Box<Ast>),
    Plus(Box<Ast>),
    Optional(Box<Ast>),
}

pub fn show(ast: &Ast) -> String {
    match ast {
        Ast::Char(c) => c.to_string(),
        Ast::Dot => ".".to_string(),
        Ast::Class { negated, ranges } => {
            let mut s = String::from("[");
            if *negated {
                s.push('^');
            }
            for &(lo, hi) in ranges {
                s.push(lo);
                if lo != hi {
                    s.push('-');
                    s.push(hi);
                }
            }
            s.push(']');
            s
        }
        Ast::Concat(items) => items.iter().map(show).collect(),
        Ast::Alternate(a, b) => format!("{}|{}", show(a), show(b)),
        Ast::Star(a) => format!("{}*", atom(a)),
        Ast::Plus(a) => format!("{}+", atom(a)),
        Ast::Optional(a) => format!("{}?", atom(a)),
    }
}

/// A repeat operator binds to one atom, so anything bigger needs brackets
/// putting back when the tree is printed.
fn atom(ast: &Ast) -> String {
    match ast {
        Ast::Char(_) | Ast::Dot | Ast::Class { .. } => show(ast),
        _ => format!("({})", show(ast)),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    UnexpectedEnd,
    UnclosedGroup(usize),
    StrayParen(usize),
    NothingToRepeat(usize),
    UnclosedClass(usize),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::UnexpectedEnd => write!(f, "pattern ends early"),
            ParseError::UnclosedGroup(i) => write!(f, "unclosed ( at {i}"),
            ParseError::StrayParen(i) => write!(f, "unmatched ) at {i}"),
            ParseError::NothingToRepeat(i) => write!(f, "nothing to repeat at {i}"),
            ParseError::UnclosedClass(i) => write!(f, "unclosed [ at {i}"),
        }
    }
}

pub struct Parser {
    chars: Vec<char>,
    pos: usize,
}

impl Parser {
    pub fn new(pattern: &str) -> Parser {
        Parser { chars: pattern.chars().collect(), pos: 0 }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    /// Loosest binding: everything up to a `|`, then everything after it.
    fn alternate(&mut self) -> Result<Ast, ParseError> {
        let mut left = self.concat()?;
        while self.peek() == Some('|') {
            self.bump();
            let right = self.concat()?;
            left = Ast::Alternate(Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    /// Tighter: a run of repeated atoms, stopping at `|` or `)`.
    fn concat(&mut self) -> Result<Ast, ParseError> {
        let mut items = Vec::new();
        while let Some(c) = self.peek() {
            if c == '|' || c == ')' {
                break;
            }
            items.push(self.repeat()?);
        }
        Ok(Ast::Concat(items))
    }

    /// Tightest: one atom with any number of postfix operators on it.
    fn repeat(&mut self) -> Result<Ast, ParseError> {
        let mut node = self.single()?;
        loop {
            match self.peek() {
                Some('*') => {
                    self.bump();
                    node = Ast::Star(Box::new(node));
                }
                Some('+') => {
                    self.bump();
                    node = Ast::Plus(Box::new(node));
                }
                Some('?') => {
                    self.bump();
                    node = Ast::Optional(Box::new(node));
                }
                _ => return Ok(node),
            }
        }
    }

    fn single(&mut self) -> Result<Ast, ParseError> {
        let start = self.pos;
        match self.bump() {
            None => Err(ParseError::UnexpectedEnd),
            Some('(') => {
                let inner = self.alternate()?;
                if self.bump() != Some(')') {
                    return Err(ParseError::UnclosedGroup(start));
                }
                Ok(inner)
            }
            Some(')') => Err(ParseError::StrayParen(start)),
            Some('.') => Ok(Ast::Dot),
            Some('[') => self.class(start),
            Some('*' | '+' | '?') => Err(ParseError::NothingToRepeat(start)),
            Some('\\') => match self.bump() {
                None => Err(ParseError::UnexpectedEnd),
                Some(c) => Ok(Ast::Char(c)),
            },
            Some(c) => Ok(Ast::Char(c)),
        }
    }

    fn class(&mut self, start: usize) -> Result<Ast, ParseError> {
        let negated = self.peek() == Some('^');
        if negated {
            self.bump();
        }
        let mut ranges = Vec::new();
        loop {
            let lo = match self.bump() {
                None => return Err(ParseError::UnclosedClass(start)),
                Some(']') => break,
                Some(c) => c,
            };
            let dashed = self.peek() == Some('-')
                && self.chars.get(self.pos + 1).is_some_and(|&n| n != ']');
            if dashed {
                self.bump();
                let hi = self.bump().ok_or(ParseError::UnclosedClass(start))?;
                ranges.push((lo, hi));
            } else {
                ranges.push((lo, lo));
            }
        }
        Ok(Ast::Class { negated, ranges })
    }
}

pub fn parse(pattern: &str) -> Result<Ast, ParseError> {
    let mut p = Parser::new(pattern);
    let ast = p.alternate()?;
    if p.pos < p.chars.len() {
        return Err(ParseError::StrayParen(p.pos));
    }
    Ok(ast)
}

#[derive(Debug, Clone, PartialEq)]
pub enum Inst {
    Char(char),
    Any,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Split(usize, usize),
    Jump(usize),
    Match,
}

pub type Program = Vec<Inst>;

pub fn compile(ast: &Ast) -> Program {
    let mut prog = Vec::new();
    emit(ast, &mut prog);
    prog.push(Inst::Match);
    prog
}

fn emit(ast: &Ast, prog: &mut Program) {
    match ast {
        Ast::Char(c) => prog.push(Inst::Char(*c)),
        Ast::Dot => prog.push(Inst::Any),
        Ast::Class { negated, ranges } => {
            prog.push(Inst::Class { negated: *negated, ranges: ranges.clone() })
        }
        Ast::Concat(items) => {
            for item in items {
                emit(item, prog);
            }
        }
        Ast::Alternate(a, b) => {
            //     split left, right
            // left:  <a>
            //     jmp after
            // right: <b>
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let jump = prog.len();
            prog.push(Inst::Jump(0));
            let right = prog.len();
            emit(b, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, right);
            prog[jump] = Inst::Jump(after);
        }
        Ast::Star(a) => {
            // split: split body, after
            // body:  <a>
            //        jmp split
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            prog.push(Inst::Jump(split));
            // `after` is the index one past the jump, which is where the loop
            // exits to. Bind it.
            prog[split] = Inst::Split(split + 1, after);
        }
        Ast::Plus(a) => {
            // body: <a>
            //       split body, after
            let body = prog.len();
            emit(a, prog);
            let split = prog.len();
            prog.push(Inst::Split(body, split + 1));
        }
        Ast::Optional(a) => {
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, after);
        }
    }
}

pub fn listing(prog: &Program) -> String {
    let mut out = String::new();
    for (i, inst) in prog.iter().enumerate() {
        let text = match inst {
            Inst::Char(c) => format!("char {c:?}"),
            Inst::Any => "any".to_string(),
            Inst::Class { negated, ranges } => {
                format!("class {}{:?}", if *negated { "^" } else { "" }, ranges)
            }
            Inst::Split(a, b) => format!("split {a}, {b}"),
            Inst::Jump(t) => format!("jmp {t}"),
            Inst::Match => "match".to_string(),
        };
        out.push_str(&format!("{i:>3}  {text}\n"));
    }
    out
}

pub fn run() -> String {
    let ast = parse("a(b|c)*d").expect("pattern parses");
    let text = listing(&compile(&ast));
    print!("{text}");
    text
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_loop_splits_between_the_body_and_the_exit() {
        let text = run();
        assert_eq!(text.lines().count(), 9);
        assert!(text.contains("split 2, 7"), "{text}");
        assert!(text.contains("jmp 1"), "{text}");
        assert!(text.trim_end().ends_with("match"), "{text}");
    }

    #[test]
    fn star_is_a_split_a_body_and_a_jump_back() {
        assert_eq!(
            compile(&parse("a*").unwrap()),
            vec![Inst::Split(1, 3), Inst::Char('a'), Inst::Jump(0), Inst::Match]
        );
    }

    #[test]
    fn plus_runs_the_body_before_it_asks() {
        assert_eq!(
            compile(&parse("a+").unwrap()),
            vec![Inst::Char('a'), Inst::Split(0, 2), Inst::Match]
        );
    }

    #[test]
    fn alternation_jumps_over_the_branch_it_did_not_take() {
        assert_eq!(
            compile(&parse("a|b").unwrap()),
            vec![
                Inst::Split(1, 3),
                Inst::Char('a'),
                Inst::Jump(4),
                Inst::Char('b'),
                Inst::Match,
            ]
        );
    }
}
```

```solution
#[derive(Debug, Clone, PartialEq)]
pub enum Ast {
    Char(char),
    Dot,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Concat(Vec<Ast>),
    Alternate(Box<Ast>, Box<Ast>),
    Star(Box<Ast>),
    Plus(Box<Ast>),
    Optional(Box<Ast>),
}

pub fn show(ast: &Ast) -> String {
    match ast {
        Ast::Char(c) => c.to_string(),
        Ast::Dot => ".".to_string(),
        Ast::Class { negated, ranges } => {
            let mut s = String::from("[");
            if *negated {
                s.push('^');
            }
            for &(lo, hi) in ranges {
                s.push(lo);
                if lo != hi {
                    s.push('-');
                    s.push(hi);
                }
            }
            s.push(']');
            s
        }
        Ast::Concat(items) => items.iter().map(show).collect(),
        Ast::Alternate(a, b) => format!("{}|{}", show(a), show(b)),
        Ast::Star(a) => format!("{}*", atom(a)),
        Ast::Plus(a) => format!("{}+", atom(a)),
        Ast::Optional(a) => format!("{}?", atom(a)),
    }
}

/// A repeat operator binds to one atom, so anything bigger needs brackets
/// putting back when the tree is printed.
fn atom(ast: &Ast) -> String {
    match ast {
        Ast::Char(_) | Ast::Dot | Ast::Class { .. } => show(ast),
        _ => format!("({})", show(ast)),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    UnexpectedEnd,
    UnclosedGroup(usize),
    StrayParen(usize),
    NothingToRepeat(usize),
    UnclosedClass(usize),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::UnexpectedEnd => write!(f, "pattern ends early"),
            ParseError::UnclosedGroup(i) => write!(f, "unclosed ( at {i}"),
            ParseError::StrayParen(i) => write!(f, "unmatched ) at {i}"),
            ParseError::NothingToRepeat(i) => write!(f, "nothing to repeat at {i}"),
            ParseError::UnclosedClass(i) => write!(f, "unclosed [ at {i}"),
        }
    }
}

pub struct Parser {
    chars: Vec<char>,
    pos: usize,
}

impl Parser {
    pub fn new(pattern: &str) -> Parser {
        Parser { chars: pattern.chars().collect(), pos: 0 }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    /// Loosest binding: everything up to a `|`, then everything after it.
    fn alternate(&mut self) -> Result<Ast, ParseError> {
        let mut left = self.concat()?;
        while self.peek() == Some('|') {
            self.bump();
            let right = self.concat()?;
            left = Ast::Alternate(Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    /// Tighter: a run of repeated atoms, stopping at `|` or `)`.
    fn concat(&mut self) -> Result<Ast, ParseError> {
        let mut items = Vec::new();
        while let Some(c) = self.peek() {
            if c == '|' || c == ')' {
                break;
            }
            items.push(self.repeat()?);
        }
        Ok(Ast::Concat(items))
    }

    /// Tightest: one atom with any number of postfix operators on it.
    fn repeat(&mut self) -> Result<Ast, ParseError> {
        let mut node = self.single()?;
        loop {
            match self.peek() {
                Some('*') => {
                    self.bump();
                    node = Ast::Star(Box::new(node));
                }
                Some('+') => {
                    self.bump();
                    node = Ast::Plus(Box::new(node));
                }
                Some('?') => {
                    self.bump();
                    node = Ast::Optional(Box::new(node));
                }
                _ => return Ok(node),
            }
        }
    }

    fn single(&mut self) -> Result<Ast, ParseError> {
        let start = self.pos;
        match self.bump() {
            None => Err(ParseError::UnexpectedEnd),
            Some('(') => {
                let inner = self.alternate()?;
                if self.bump() != Some(')') {
                    return Err(ParseError::UnclosedGroup(start));
                }
                Ok(inner)
            }
            Some(')') => Err(ParseError::StrayParen(start)),
            Some('.') => Ok(Ast::Dot),
            Some('[') => self.class(start),
            Some('*' | '+' | '?') => Err(ParseError::NothingToRepeat(start)),
            Some('\\') => match self.bump() {
                None => Err(ParseError::UnexpectedEnd),
                Some(c) => Ok(Ast::Char(c)),
            },
            Some(c) => Ok(Ast::Char(c)),
        }
    }

    fn class(&mut self, start: usize) -> Result<Ast, ParseError> {
        let negated = self.peek() == Some('^');
        if negated {
            self.bump();
        }
        let mut ranges = Vec::new();
        loop {
            let lo = match self.bump() {
                None => return Err(ParseError::UnclosedClass(start)),
                Some(']') => break,
                Some(c) => c,
            };
            let dashed = self.peek() == Some('-')
                && self.chars.get(self.pos + 1).is_some_and(|&n| n != ']');
            if dashed {
                self.bump();
                let hi = self.bump().ok_or(ParseError::UnclosedClass(start))?;
                ranges.push((lo, hi));
            } else {
                ranges.push((lo, lo));
            }
        }
        Ok(Ast::Class { negated, ranges })
    }
}

pub fn parse(pattern: &str) -> Result<Ast, ParseError> {
    let mut p = Parser::new(pattern);
    let ast = p.alternate()?;
    if p.pos < p.chars.len() {
        return Err(ParseError::StrayParen(p.pos));
    }
    Ok(ast)
}

#[derive(Debug, Clone, PartialEq)]
pub enum Inst {
    Char(char),
    Any,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Split(usize, usize),
    Jump(usize),
    Match,
}

pub type Program = Vec<Inst>;

pub fn compile(ast: &Ast) -> Program {
    let mut prog = Vec::new();
    emit(ast, &mut prog);
    prog.push(Inst::Match);
    prog
}

fn emit(ast: &Ast, prog: &mut Program) {
    match ast {
        Ast::Char(c) => prog.push(Inst::Char(*c)),
        Ast::Dot => prog.push(Inst::Any),
        Ast::Class { negated, ranges } => {
            prog.push(Inst::Class { negated: *negated, ranges: ranges.clone() })
        }
        Ast::Concat(items) => {
            for item in items {
                emit(item, prog);
            }
        }
        Ast::Alternate(a, b) => {
            //     split left, right
            // left:  <a>
            //     jmp after
            // right: <b>
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let jump = prog.len();
            prog.push(Inst::Jump(0));
            let right = prog.len();
            emit(b, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, right);
            prog[jump] = Inst::Jump(after);
        }
        Ast::Star(a) => {
            // split: split body, after
            // body:  <a>
            //        jmp split
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            prog.push(Inst::Jump(split));
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, after);
        }
        Ast::Plus(a) => {
            // body: <a>
            //       split body, after
            let body = prog.len();
            emit(a, prog);
            let split = prog.len();
            prog.push(Inst::Split(body, split + 1));
        }
        Ast::Optional(a) => {
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, after);
        }
    }
}

pub fn listing(prog: &Program) -> String {
    let mut out = String::new();
    for (i, inst) in prog.iter().enumerate() {
        let text = match inst {
            Inst::Char(c) => format!("char {c:?}"),
            Inst::Any => "any".to_string(),
            Inst::Class { negated, ranges } => {
                format!("class {}{:?}", if *negated { "^" } else { "" }, ranges)
            }
            Inst::Split(a, b) => format!("split {a}, {b}"),
            Inst::Jump(t) => format!("jmp {t}"),
            Inst::Match => "match".to_string(),
        };
        out.push_str(&format!("{i:>3}  {text}\n"));
    }
    out
}

pub fn run() -> String {
    let ast = parse("a(b|c)*d").expect("pattern parses");
    let text = listing(&compile(&ast));
    print!("{text}");
    text
}
```

@hint The `Split` at the top of a loop has two targets: the body, and whatever comes after the loop. Only one of them is known when the `Split` is pushed.
@hint The body is emitted after the placeholder, then a `Jump` back. After that, `prog.len()` is the index the loop exits to. Bind it before patching.
@hint `let after = prog.len();` between the `prog.push(Inst::Jump(split));` line and the patch.

@diagnose E0425
`cannot find value `after` in this scope`, with a helpful note that a
binding of that name exists in a different scope in the same function. That is
the one in the `Alternate` arm, and match arms do not share bindings.

The two-pass shape here is worth understanding. `Split` needs a forward
address, and at the moment it is pushed nobody knows what that address is,
because the body has not been emitted yet. So a placeholder `Split(0, 0)` goes
in, its index is remembered, the body is emitted, and then the placeholder is
overwritten now that `prog.len()` gives the answer. Assemblers call this
backpatching, and every compiler that emits jumps does some version of it.

@diagnose E0502
`cannot borrow `*prog` as immutable because it is also borrowed as
mutable`, from writing something like `prog[split] = Inst::Split(split + 1,
prog.len())`. Index assignment takes a mutable borrow of `prog` for the whole
statement, so the read on the right cannot happen inside it. Put `prog.len()`
in a local first, which you had to do anyway to get the value before the
`Match` is appended.

@diagnose E0308
`expected `usize`, found `Inst`` or the reverse, usually from
patching with the wrong thing. `prog[split]` is an `Inst` and has to be
assigned a whole `Inst::Split(a, b)`, not just a number. The two fields inside
are the `usize` indices.

@after
Look at the listing for `a(b|c)*d`.

```text
  0  char 'a'
  1  split 2, 7
  2  split 3, 5
  3  char 'b'
  4  jmp 6
  5  char 'c'
  6  jmp 1
  7  char 'd'
  8  match
```

Instruction 1 is the star: go into the loop at 2, or leave it at 7. Instruction
2 is the alternation: try `b` at 3, or `c` at 5. Neither of them is a choice
the machine is equipped to make, because it has no way to know which branch
will work out. That is the entire problem with running this program, and the
next two stages are the two answers to it.

The program is linear in the pattern. `a(b|c)*d` is eight characters and nine
instructions, and that ratio does not change with nesting depth.

## 4. The obvious matcher

@kind fix
@concept borrow

@expect E0507

The direct way to run this program: at a `Split`, try the first target,
and if the whole rest of the match fails, come back and try the second. That is
recursion, and `||` gives the backtracking for free. The `match` at the top
takes the instruction the wrong way.

```starter
#[derive(Debug, Clone, PartialEq)]
pub enum Ast {
    Char(char),
    Dot,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Concat(Vec<Ast>),
    Alternate(Box<Ast>, Box<Ast>),
    Star(Box<Ast>),
    Plus(Box<Ast>),
    Optional(Box<Ast>),
}

pub fn show(ast: &Ast) -> String {
    match ast {
        Ast::Char(c) => c.to_string(),
        Ast::Dot => ".".to_string(),
        Ast::Class { negated, ranges } => {
            let mut s = String::from("[");
            if *negated {
                s.push('^');
            }
            for &(lo, hi) in ranges {
                s.push(lo);
                if lo != hi {
                    s.push('-');
                    s.push(hi);
                }
            }
            s.push(']');
            s
        }
        Ast::Concat(items) => items.iter().map(show).collect(),
        Ast::Alternate(a, b) => format!("{}|{}", show(a), show(b)),
        Ast::Star(a) => format!("{}*", atom(a)),
        Ast::Plus(a) => format!("{}+", atom(a)),
        Ast::Optional(a) => format!("{}?", atom(a)),
    }
}

/// A repeat operator binds to one atom, so anything bigger needs brackets
/// putting back when the tree is printed.
fn atom(ast: &Ast) -> String {
    match ast {
        Ast::Char(_) | Ast::Dot | Ast::Class { .. } => show(ast),
        _ => format!("({})", show(ast)),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    UnexpectedEnd,
    UnclosedGroup(usize),
    StrayParen(usize),
    NothingToRepeat(usize),
    UnclosedClass(usize),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::UnexpectedEnd => write!(f, "pattern ends early"),
            ParseError::UnclosedGroup(i) => write!(f, "unclosed ( at {i}"),
            ParseError::StrayParen(i) => write!(f, "unmatched ) at {i}"),
            ParseError::NothingToRepeat(i) => write!(f, "nothing to repeat at {i}"),
            ParseError::UnclosedClass(i) => write!(f, "unclosed [ at {i}"),
        }
    }
}

pub struct Parser {
    chars: Vec<char>,
    pos: usize,
}

impl Parser {
    pub fn new(pattern: &str) -> Parser {
        Parser { chars: pattern.chars().collect(), pos: 0 }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    /// Loosest binding: everything up to a `|`, then everything after it.
    fn alternate(&mut self) -> Result<Ast, ParseError> {
        let mut left = self.concat()?;
        while self.peek() == Some('|') {
            self.bump();
            let right = self.concat()?;
            left = Ast::Alternate(Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    /// Tighter: a run of repeated atoms, stopping at `|` or `)`.
    fn concat(&mut self) -> Result<Ast, ParseError> {
        let mut items = Vec::new();
        while let Some(c) = self.peek() {
            if c == '|' || c == ')' {
                break;
            }
            items.push(self.repeat()?);
        }
        Ok(Ast::Concat(items))
    }

    /// Tightest: one atom with any number of postfix operators on it.
    fn repeat(&mut self) -> Result<Ast, ParseError> {
        let mut node = self.single()?;
        loop {
            match self.peek() {
                Some('*') => {
                    self.bump();
                    node = Ast::Star(Box::new(node));
                }
                Some('+') => {
                    self.bump();
                    node = Ast::Plus(Box::new(node));
                }
                Some('?') => {
                    self.bump();
                    node = Ast::Optional(Box::new(node));
                }
                _ => return Ok(node),
            }
        }
    }

    fn single(&mut self) -> Result<Ast, ParseError> {
        let start = self.pos;
        match self.bump() {
            None => Err(ParseError::UnexpectedEnd),
            Some('(') => {
                let inner = self.alternate()?;
                if self.bump() != Some(')') {
                    return Err(ParseError::UnclosedGroup(start));
                }
                Ok(inner)
            }
            Some(')') => Err(ParseError::StrayParen(start)),
            Some('.') => Ok(Ast::Dot),
            Some('[') => self.class(start),
            Some('*' | '+' | '?') => Err(ParseError::NothingToRepeat(start)),
            Some('\\') => match self.bump() {
                None => Err(ParseError::UnexpectedEnd),
                Some(c) => Ok(Ast::Char(c)),
            },
            Some(c) => Ok(Ast::Char(c)),
        }
    }

    fn class(&mut self, start: usize) -> Result<Ast, ParseError> {
        let negated = self.peek() == Some('^');
        if negated {
            self.bump();
        }
        let mut ranges = Vec::new();
        loop {
            let lo = match self.bump() {
                None => return Err(ParseError::UnclosedClass(start)),
                Some(']') => break,
                Some(c) => c,
            };
            let dashed = self.peek() == Some('-')
                && self.chars.get(self.pos + 1).is_some_and(|&n| n != ']');
            if dashed {
                self.bump();
                let hi = self.bump().ok_or(ParseError::UnclosedClass(start))?;
                ranges.push((lo, hi));
            } else {
                ranges.push((lo, lo));
            }
        }
        Ok(Ast::Class { negated, ranges })
    }
}

pub fn parse(pattern: &str) -> Result<Ast, ParseError> {
    let mut p = Parser::new(pattern);
    let ast = p.alternate()?;
    if p.pos < p.chars.len() {
        return Err(ParseError::StrayParen(p.pos));
    }
    Ok(ast)
}

#[derive(Debug, Clone, PartialEq)]
pub enum Inst {
    Char(char),
    Any,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Split(usize, usize),
    Jump(usize),
    Match,
}

pub type Program = Vec<Inst>;

pub fn compile(ast: &Ast) -> Program {
    let mut prog = Vec::new();
    emit(ast, &mut prog);
    prog.push(Inst::Match);
    prog
}

fn emit(ast: &Ast, prog: &mut Program) {
    match ast {
        Ast::Char(c) => prog.push(Inst::Char(*c)),
        Ast::Dot => prog.push(Inst::Any),
        Ast::Class { negated, ranges } => {
            prog.push(Inst::Class { negated: *negated, ranges: ranges.clone() })
        }
        Ast::Concat(items) => {
            for item in items {
                emit(item, prog);
            }
        }
        Ast::Alternate(a, b) => {
            //     split left, right
            // left:  <a>
            //     jmp after
            // right: <b>
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let jump = prog.len();
            prog.push(Inst::Jump(0));
            let right = prog.len();
            emit(b, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, right);
            prog[jump] = Inst::Jump(after);
        }
        Ast::Star(a) => {
            // split: split body, after
            // body:  <a>
            //        jmp split
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            prog.push(Inst::Jump(split));
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, after);
        }
        Ast::Plus(a) => {
            // body: <a>
            //       split body, after
            let body = prog.len();
            emit(a, prog);
            let split = prog.len();
            prog.push(Inst::Split(body, split + 1));
        }
        Ast::Optional(a) => {
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, after);
        }
    }
}

pub fn listing(prog: &Program) -> String {
    let mut out = String::new();
    for (i, inst) in prog.iter().enumerate() {
        let text = match inst {
            Inst::Char(c) => format!("char {c:?}"),
            Inst::Any => "any".to_string(),
            Inst::Class { negated, ranges } => {
                format!("class {}{:?}", if *negated { "^" } else { "" }, ranges)
            }
            Inst::Split(a, b) => format!("split {a}, {b}"),
            Inst::Jump(t) => format!("jmp {t}"),
            Inst::Match => "match".to_string(),
        };
        out.push_str(&format!("{i:>3}  {text}\n"));
    }
    out
}

fn in_class(negated: bool, ranges: &[(char, char)], c: char) -> bool {
    ranges.iter().any(|&(lo, hi)| lo <= c && c <= hi) != negated
}

/// Returns whether the whole input matched, and how many instructions were
/// executed getting to that answer.
pub fn backtrack(prog: &Program, input: &[char]) -> (bool, u64) {
    let mut steps = 0u64;
    let hit = walk(prog, input, 0, 0, &mut steps);
    (hit, steps)
}

fn walk(prog: &Program, input: &[char], pc: usize, sp: usize, steps: &mut u64) -> bool {
    *steps += 1;
    match prog[pc] {
        Inst::Match => sp == input.len(),
        Inst::Char(c) => {
            sp < input.len() && input[sp] == c && walk(prog, input, pc + 1, sp + 1, steps)
        }
        Inst::Any => sp < input.len() && walk(prog, input, pc + 1, sp + 1, steps),
        Inst::Class { negated, ranges } => {
            sp < input.len()
                && in_class(negated, &ranges, input[sp])
                && walk(prog, input, pc + 1, sp + 1, steps)
        }
        Inst::Split(a, b) => walk(prog, input, a, sp, steps) || walk(prog, input, b, sp, steps),
        Inst::Jump(t) => walk(prog, input, t, sp, steps),
    }
}

pub fn run() -> Vec<(bool, u64)> {
    let prog = compile(&parse("a(b|c)*d").expect("pattern parses"));
    let mut out = Vec::new();
    for text in ["ad", "abd", "abcbcd", "abx", ""] {
        let input: Vec<char> = text.chars().collect();
        let (hit, steps) = backtrack(&prog, &input);
        println!("{:10} {hit:5}  {steps} steps", format!("{text:?}"));
        out.push((hit, steps));
    }
    out
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_loop_matches_any_number_of_times() {
        let hits: Vec<bool> = run().iter().map(|&(hit, _)| hit).collect();
        assert_eq!(hits, [true, true, true, false, false]);
        assert!(run().iter().all(|&(_, steps)| steps > 0));
    }

    #[test]
    fn dots_and_classes_consume_one_character() {
        let hit = |p: &str, s: &str| {
            let prog = compile(&parse(p).unwrap());
            backtrack(&prog, &s.chars().collect::<Vec<char>>()).0
        };
        assert!(hit("a.c", "abc"));
        assert!(!hit("a.c", "ac"));
        assert!(hit("[a-z0-9]+", "rust2024"));
        assert!(!hit("[a-z0-9]+", "Rust"));
        assert!(hit("[^0-9]+", "rust"));
    }

    #[test]
    fn a_match_has_to_reach_the_end_of_the_input() {
        let prog = compile(&parse("ab").unwrap());
        assert!(backtrack(&prog, &"ab".chars().collect::<Vec<char>>()).0);
        assert!(!backtrack(&prog, &"abc".chars().collect::<Vec<char>>()).0);
    }

    #[test]
    fn an_empty_pattern_matches_only_an_empty_input() {
        let prog = compile(&parse("").unwrap());
        assert!(backtrack(&prog, &[]).0);
        assert!(!backtrack(&prog, &['x']).0);
    }
}
```

```solution
#[derive(Debug, Clone, PartialEq)]
pub enum Ast {
    Char(char),
    Dot,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Concat(Vec<Ast>),
    Alternate(Box<Ast>, Box<Ast>),
    Star(Box<Ast>),
    Plus(Box<Ast>),
    Optional(Box<Ast>),
}

pub fn show(ast: &Ast) -> String {
    match ast {
        Ast::Char(c) => c.to_string(),
        Ast::Dot => ".".to_string(),
        Ast::Class { negated, ranges } => {
            let mut s = String::from("[");
            if *negated {
                s.push('^');
            }
            for &(lo, hi) in ranges {
                s.push(lo);
                if lo != hi {
                    s.push('-');
                    s.push(hi);
                }
            }
            s.push(']');
            s
        }
        Ast::Concat(items) => items.iter().map(show).collect(),
        Ast::Alternate(a, b) => format!("{}|{}", show(a), show(b)),
        Ast::Star(a) => format!("{}*", atom(a)),
        Ast::Plus(a) => format!("{}+", atom(a)),
        Ast::Optional(a) => format!("{}?", atom(a)),
    }
}

/// A repeat operator binds to one atom, so anything bigger needs brackets
/// putting back when the tree is printed.
fn atom(ast: &Ast) -> String {
    match ast {
        Ast::Char(_) | Ast::Dot | Ast::Class { .. } => show(ast),
        _ => format!("({})", show(ast)),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    UnexpectedEnd,
    UnclosedGroup(usize),
    StrayParen(usize),
    NothingToRepeat(usize),
    UnclosedClass(usize),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::UnexpectedEnd => write!(f, "pattern ends early"),
            ParseError::UnclosedGroup(i) => write!(f, "unclosed ( at {i}"),
            ParseError::StrayParen(i) => write!(f, "unmatched ) at {i}"),
            ParseError::NothingToRepeat(i) => write!(f, "nothing to repeat at {i}"),
            ParseError::UnclosedClass(i) => write!(f, "unclosed [ at {i}"),
        }
    }
}

pub struct Parser {
    chars: Vec<char>,
    pos: usize,
}

impl Parser {
    pub fn new(pattern: &str) -> Parser {
        Parser { chars: pattern.chars().collect(), pos: 0 }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    /// Loosest binding: everything up to a `|`, then everything after it.
    fn alternate(&mut self) -> Result<Ast, ParseError> {
        let mut left = self.concat()?;
        while self.peek() == Some('|') {
            self.bump();
            let right = self.concat()?;
            left = Ast::Alternate(Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    /// Tighter: a run of repeated atoms, stopping at `|` or `)`.
    fn concat(&mut self) -> Result<Ast, ParseError> {
        let mut items = Vec::new();
        while let Some(c) = self.peek() {
            if c == '|' || c == ')' {
                break;
            }
            items.push(self.repeat()?);
        }
        Ok(Ast::Concat(items))
    }

    /// Tightest: one atom with any number of postfix operators on it.
    fn repeat(&mut self) -> Result<Ast, ParseError> {
        let mut node = self.single()?;
        loop {
            match self.peek() {
                Some('*') => {
                    self.bump();
                    node = Ast::Star(Box::new(node));
                }
                Some('+') => {
                    self.bump();
                    node = Ast::Plus(Box::new(node));
                }
                Some('?') => {
                    self.bump();
                    node = Ast::Optional(Box::new(node));
                }
                _ => return Ok(node),
            }
        }
    }

    fn single(&mut self) -> Result<Ast, ParseError> {
        let start = self.pos;
        match self.bump() {
            None => Err(ParseError::UnexpectedEnd),
            Some('(') => {
                let inner = self.alternate()?;
                if self.bump() != Some(')') {
                    return Err(ParseError::UnclosedGroup(start));
                }
                Ok(inner)
            }
            Some(')') => Err(ParseError::StrayParen(start)),
            Some('.') => Ok(Ast::Dot),
            Some('[') => self.class(start),
            Some('*' | '+' | '?') => Err(ParseError::NothingToRepeat(start)),
            Some('\\') => match self.bump() {
                None => Err(ParseError::UnexpectedEnd),
                Some(c) => Ok(Ast::Char(c)),
            },
            Some(c) => Ok(Ast::Char(c)),
        }
    }

    fn class(&mut self, start: usize) -> Result<Ast, ParseError> {
        let negated = self.peek() == Some('^');
        if negated {
            self.bump();
        }
        let mut ranges = Vec::new();
        loop {
            let lo = match self.bump() {
                None => return Err(ParseError::UnclosedClass(start)),
                Some(']') => break,
                Some(c) => c,
            };
            let dashed = self.peek() == Some('-')
                && self.chars.get(self.pos + 1).is_some_and(|&n| n != ']');
            if dashed {
                self.bump();
                let hi = self.bump().ok_or(ParseError::UnclosedClass(start))?;
                ranges.push((lo, hi));
            } else {
                ranges.push((lo, lo));
            }
        }
        Ok(Ast::Class { negated, ranges })
    }
}

pub fn parse(pattern: &str) -> Result<Ast, ParseError> {
    let mut p = Parser::new(pattern);
    let ast = p.alternate()?;
    if p.pos < p.chars.len() {
        return Err(ParseError::StrayParen(p.pos));
    }
    Ok(ast)
}

#[derive(Debug, Clone, PartialEq)]
pub enum Inst {
    Char(char),
    Any,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Split(usize, usize),
    Jump(usize),
    Match,
}

pub type Program = Vec<Inst>;

pub fn compile(ast: &Ast) -> Program {
    let mut prog = Vec::new();
    emit(ast, &mut prog);
    prog.push(Inst::Match);
    prog
}

fn emit(ast: &Ast, prog: &mut Program) {
    match ast {
        Ast::Char(c) => prog.push(Inst::Char(*c)),
        Ast::Dot => prog.push(Inst::Any),
        Ast::Class { negated, ranges } => {
            prog.push(Inst::Class { negated: *negated, ranges: ranges.clone() })
        }
        Ast::Concat(items) => {
            for item in items {
                emit(item, prog);
            }
        }
        Ast::Alternate(a, b) => {
            //     split left, right
            // left:  <a>
            //     jmp after
            // right: <b>
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let jump = prog.len();
            prog.push(Inst::Jump(0));
            let right = prog.len();
            emit(b, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, right);
            prog[jump] = Inst::Jump(after);
        }
        Ast::Star(a) => {
            // split: split body, after
            // body:  <a>
            //        jmp split
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            prog.push(Inst::Jump(split));
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, after);
        }
        Ast::Plus(a) => {
            // body: <a>
            //       split body, after
            let body = prog.len();
            emit(a, prog);
            let split = prog.len();
            prog.push(Inst::Split(body, split + 1));
        }
        Ast::Optional(a) => {
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, after);
        }
    }
}

pub fn listing(prog: &Program) -> String {
    let mut out = String::new();
    for (i, inst) in prog.iter().enumerate() {
        let text = match inst {
            Inst::Char(c) => format!("char {c:?}"),
            Inst::Any => "any".to_string(),
            Inst::Class { negated, ranges } => {
                format!("class {}{:?}", if *negated { "^" } else { "" }, ranges)
            }
            Inst::Split(a, b) => format!("split {a}, {b}"),
            Inst::Jump(t) => format!("jmp {t}"),
            Inst::Match => "match".to_string(),
        };
        out.push_str(&format!("{i:>3}  {text}\n"));
    }
    out
}

fn in_class(negated: bool, ranges: &[(char, char)], c: char) -> bool {
    ranges.iter().any(|&(lo, hi)| lo <= c && c <= hi) != negated
}

/// Returns whether the whole input matched, and how many instructions were
/// executed getting to that answer.
pub fn backtrack(prog: &Program, input: &[char]) -> (bool, u64) {
    let mut steps = 0u64;
    let hit = walk(prog, input, 0, 0, &mut steps);
    (hit, steps)
}

fn walk(prog: &Program, input: &[char], pc: usize, sp: usize, steps: &mut u64) -> bool {
    *steps += 1;
    match &prog[pc] {
        Inst::Match => sp == input.len(),
        Inst::Char(c) => {
            sp < input.len() && input[sp] == *c && walk(prog, input, pc + 1, sp + 1, steps)
        }
        Inst::Any => sp < input.len() && walk(prog, input, pc + 1, sp + 1, steps),
        Inst::Class { negated, ranges } => {
            sp < input.len()
                && in_class(*negated, ranges, input[sp])
                && walk(prog, input, pc + 1, sp + 1, steps)
        }
        Inst::Split(a, b) => walk(prog, input, *a, sp, steps) || walk(prog, input, *b, sp, steps),
        Inst::Jump(t) => walk(prog, input, *t, sp, steps),
    }
}

pub fn run() -> Vec<(bool, u64)> {
    let prog = compile(&parse("a(b|c)*d").expect("pattern parses"));
    let mut out = Vec::new();
    for text in ["ad", "abd", "abcbcd", "abx", ""] {
        let input: Vec<char> = text.chars().collect();
        let (hit, steps) = backtrack(&prog, &input);
        println!("{:10} {hit:5}  {steps} steps", format!("{text:?}"));
        out.push((hit, steps));
    }
    out
}
```

@hint `prog[pc]` is a place, not a value. Matching on it by value asks to move the instruction out of the vector, and the vector is borrowed.
@hint Only one variant causes the problem: `Class` holds a `Vec`, which is not `Copy`. Borrow the instruction instead of taking it.
@hint `match &prog[pc]`, then the bindings become references, so `*c` and `*a` where a value is wanted.

@diagnose E0507
`cannot move out of index of `Vec<Inst>``, with `move occurs because
`ranges` has type `Vec<(char, char)>`, which does not implement the `Copy`
trait`.

`prog[pc]` desugars to `*prog.index(pc)`, which is a place expression. Matching
on a place by value means the arms may move fields out of it, and moving out of
something behind a shared reference would leave the vector holding a hole.

Note how precise the complaint is. `Inst::Char(c)` binds a `char`, which is
`Copy`, so that arm is fine on its own. It is `Inst::Class { negated, ranges }`
that would move a heap-allocated `Vec` out of a program the caller still owns.
Borrow with `match &prog[pc]` and every binding becomes a reference, which
costs nothing and copies nothing.

@diagnose E0308
After adding the `&`, `expected `char`, found `&char``. The
bindings are references now, so comparisons against a value need a `*`:
`input[sp] == *c`, `walk(prog, input, *a, sp, steps)`. `ranges` is already a
`&Vec<(char, char)>` and coerces to the `&[(char, char)]` that `in_class`
takes, so that one needs no change.

@diagnose E0004
`non-exhaustive patterns`. Every variant of `Inst` needs an arm here,
including `Match`, which is the only one that returns without recursing.
`Match` succeeds when `sp` has reached the end of the input, because this
engine matches the whole string rather than searching inside it.

@after
`||` is the backtracking. `walk(a) || walk(b)` runs the left branch to
completion, and Rust's short circuit means the right branch runs only when the
left one returned false, having explored every path underneath it. The whole
search is four characters of operator.

This engine is correct and it is what most languages ship. It also has a
property the code makes easy to miss: nothing stops it visiting the same
instruction at the same input position twice. On `a(b|c)*d` against a short
string that never happens enough to notice.

The step counter is here to make the next stage measurable rather than
rhetorical.

## 5. Where the obvious matcher falls over

@kind fix
@concept string

@expect E0308

`(a?){n}` followed by `a{n}`, against a string of n letters. Every input
matches, so the backtracker never gets to stop early, and it has to work through
every way of choosing which optional letters to skip. Building the pattern is
one `+` away from compiling.

```starter
#[derive(Debug, Clone, PartialEq)]
pub enum Ast {
    Char(char),
    Dot,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Concat(Vec<Ast>),
    Alternate(Box<Ast>, Box<Ast>),
    Star(Box<Ast>),
    Plus(Box<Ast>),
    Optional(Box<Ast>),
}

pub fn show(ast: &Ast) -> String {
    match ast {
        Ast::Char(c) => c.to_string(),
        Ast::Dot => ".".to_string(),
        Ast::Class { negated, ranges } => {
            let mut s = String::from("[");
            if *negated {
                s.push('^');
            }
            for &(lo, hi) in ranges {
                s.push(lo);
                if lo != hi {
                    s.push('-');
                    s.push(hi);
                }
            }
            s.push(']');
            s
        }
        Ast::Concat(items) => items.iter().map(show).collect(),
        Ast::Alternate(a, b) => format!("{}|{}", show(a), show(b)),
        Ast::Star(a) => format!("{}*", atom(a)),
        Ast::Plus(a) => format!("{}+", atom(a)),
        Ast::Optional(a) => format!("{}?", atom(a)),
    }
}

/// A repeat operator binds to one atom, so anything bigger needs brackets
/// putting back when the tree is printed.
fn atom(ast: &Ast) -> String {
    match ast {
        Ast::Char(_) | Ast::Dot | Ast::Class { .. } => show(ast),
        _ => format!("({})", show(ast)),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    UnexpectedEnd,
    UnclosedGroup(usize),
    StrayParen(usize),
    NothingToRepeat(usize),
    UnclosedClass(usize),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::UnexpectedEnd => write!(f, "pattern ends early"),
            ParseError::UnclosedGroup(i) => write!(f, "unclosed ( at {i}"),
            ParseError::StrayParen(i) => write!(f, "unmatched ) at {i}"),
            ParseError::NothingToRepeat(i) => write!(f, "nothing to repeat at {i}"),
            ParseError::UnclosedClass(i) => write!(f, "unclosed [ at {i}"),
        }
    }
}

pub struct Parser {
    chars: Vec<char>,
    pos: usize,
}

impl Parser {
    pub fn new(pattern: &str) -> Parser {
        Parser { chars: pattern.chars().collect(), pos: 0 }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    /// Loosest binding: everything up to a `|`, then everything after it.
    fn alternate(&mut self) -> Result<Ast, ParseError> {
        let mut left = self.concat()?;
        while self.peek() == Some('|') {
            self.bump();
            let right = self.concat()?;
            left = Ast::Alternate(Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    /// Tighter: a run of repeated atoms, stopping at `|` or `)`.
    fn concat(&mut self) -> Result<Ast, ParseError> {
        let mut items = Vec::new();
        while let Some(c) = self.peek() {
            if c == '|' || c == ')' {
                break;
            }
            items.push(self.repeat()?);
        }
        Ok(Ast::Concat(items))
    }

    /// Tightest: one atom with any number of postfix operators on it.
    fn repeat(&mut self) -> Result<Ast, ParseError> {
        let mut node = self.single()?;
        loop {
            match self.peek() {
                Some('*') => {
                    self.bump();
                    node = Ast::Star(Box::new(node));
                }
                Some('+') => {
                    self.bump();
                    node = Ast::Plus(Box::new(node));
                }
                Some('?') => {
                    self.bump();
                    node = Ast::Optional(Box::new(node));
                }
                _ => return Ok(node),
            }
        }
    }

    fn single(&mut self) -> Result<Ast, ParseError> {
        let start = self.pos;
        match self.bump() {
            None => Err(ParseError::UnexpectedEnd),
            Some('(') => {
                let inner = self.alternate()?;
                if self.bump() != Some(')') {
                    return Err(ParseError::UnclosedGroup(start));
                }
                Ok(inner)
            }
            Some(')') => Err(ParseError::StrayParen(start)),
            Some('.') => Ok(Ast::Dot),
            Some('[') => self.class(start),
            Some('*' | '+' | '?') => Err(ParseError::NothingToRepeat(start)),
            Some('\\') => match self.bump() {
                None => Err(ParseError::UnexpectedEnd),
                Some(c) => Ok(Ast::Char(c)),
            },
            Some(c) => Ok(Ast::Char(c)),
        }
    }

    fn class(&mut self, start: usize) -> Result<Ast, ParseError> {
        let negated = self.peek() == Some('^');
        if negated {
            self.bump();
        }
        let mut ranges = Vec::new();
        loop {
            let lo = match self.bump() {
                None => return Err(ParseError::UnclosedClass(start)),
                Some(']') => break,
                Some(c) => c,
            };
            let dashed = self.peek() == Some('-')
                && self.chars.get(self.pos + 1).is_some_and(|&n| n != ']');
            if dashed {
                self.bump();
                let hi = self.bump().ok_or(ParseError::UnclosedClass(start))?;
                ranges.push((lo, hi));
            } else {
                ranges.push((lo, lo));
            }
        }
        Ok(Ast::Class { negated, ranges })
    }
}

pub fn parse(pattern: &str) -> Result<Ast, ParseError> {
    let mut p = Parser::new(pattern);
    let ast = p.alternate()?;
    if p.pos < p.chars.len() {
        return Err(ParseError::StrayParen(p.pos));
    }
    Ok(ast)
}

#[derive(Debug, Clone, PartialEq)]
pub enum Inst {
    Char(char),
    Any,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Split(usize, usize),
    Jump(usize),
    Match,
}

pub type Program = Vec<Inst>;

pub fn compile(ast: &Ast) -> Program {
    let mut prog = Vec::new();
    emit(ast, &mut prog);
    prog.push(Inst::Match);
    prog
}

fn emit(ast: &Ast, prog: &mut Program) {
    match ast {
        Ast::Char(c) => prog.push(Inst::Char(*c)),
        Ast::Dot => prog.push(Inst::Any),
        Ast::Class { negated, ranges } => {
            prog.push(Inst::Class { negated: *negated, ranges: ranges.clone() })
        }
        Ast::Concat(items) => {
            for item in items {
                emit(item, prog);
            }
        }
        Ast::Alternate(a, b) => {
            //     split left, right
            // left:  <a>
            //     jmp after
            // right: <b>
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let jump = prog.len();
            prog.push(Inst::Jump(0));
            let right = prog.len();
            emit(b, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, right);
            prog[jump] = Inst::Jump(after);
        }
        Ast::Star(a) => {
            // split: split body, after
            // body:  <a>
            //        jmp split
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            prog.push(Inst::Jump(split));
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, after);
        }
        Ast::Plus(a) => {
            // body: <a>
            //       split body, after
            let body = prog.len();
            emit(a, prog);
            let split = prog.len();
            prog.push(Inst::Split(body, split + 1));
        }
        Ast::Optional(a) => {
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, after);
        }
    }
}

pub fn listing(prog: &Program) -> String {
    let mut out = String::new();
    for (i, inst) in prog.iter().enumerate() {
        let text = match inst {
            Inst::Char(c) => format!("char {c:?}"),
            Inst::Any => "any".to_string(),
            Inst::Class { negated, ranges } => {
                format!("class {}{:?}", if *negated { "^" } else { "" }, ranges)
            }
            Inst::Split(a, b) => format!("split {a}, {b}"),
            Inst::Jump(t) => format!("jmp {t}"),
            Inst::Match => "match".to_string(),
        };
        out.push_str(&format!("{i:>3}  {text}\n"));
    }
    out
}

fn in_class(negated: bool, ranges: &[(char, char)], c: char) -> bool {
    ranges.iter().any(|&(lo, hi)| lo <= c && c <= hi) != negated
}

/// Returns whether the whole input matched, and how many instructions were
/// executed getting to that answer.
pub fn backtrack(prog: &Program, input: &[char]) -> (bool, u64) {
    let mut steps = 0u64;
    let hit = walk(prog, input, 0, 0, &mut steps);
    (hit, steps)
}

fn walk(prog: &Program, input: &[char], pc: usize, sp: usize, steps: &mut u64) -> bool {
    *steps += 1;
    match &prog[pc] {
        Inst::Match => sp == input.len(),
        Inst::Char(c) => {
            sp < input.len() && input[sp] == *c && walk(prog, input, pc + 1, sp + 1, steps)
        }
        Inst::Any => sp < input.len() && walk(prog, input, pc + 1, sp + 1, steps),
        Inst::Class { negated, ranges } => {
            sp < input.len()
                && in_class(*negated, ranges, input[sp])
                && walk(prog, input, pc + 1, sp + 1, steps)
        }
        Inst::Split(a, b) => walk(prog, input, *a, sp, steps) || walk(prog, input, *b, sp, steps),
        Inst::Jump(t) => walk(prog, input, *t, sp, steps),
    }
}

/// `(a?)^n a^n`: n optional letters followed by n required ones. Every input
/// of n `a`s matches, and a backtracker has to discover which of the optional
/// letters to give up on.
pub fn pathological(n: usize) -> String {
    "a?".repeat(n) + "a".repeat(n)
}

pub fn run() -> Vec<(usize, u64)> {
    let mut rows = Vec::new();
    println!(" n   pattern       steps");
    for n in [2usize, 4, 6, 8, 10, 12, 14, 16, 18] {
        let pattern = pathological(n);
        let prog = compile(&parse(&pattern).expect("pattern parses"));
        let input: Vec<char> = "a".repeat(n).chars().collect();
        let (hit, steps) = backtrack(&prog, &input);
        assert!(hit, "{pattern} does match {n} letters");
        println!("{n:2}   {:2} chars      {steps:>9}", pattern.len());
        rows.push((n, steps));
    }
    rows
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pattern_is_n_optional_letters_then_n_required_ones() {
        assert_eq!(pathological(3), "a?a?a?aaa");
        assert_eq!(pathological(0), "");
    }

    #[test]
    fn every_extra_pair_of_letters_multiplies_the_work() {
        let rows = run();
        assert_eq!(rows[0], (2, 14));
        assert_eq!(rows[3], (8, 1790));
        assert_eq!(*rows.last().unwrap(), (18, 3_145_726));

        for pair in rows.windows(2) {
            let (n, before) = pair[0];
            let (_, after) = pair[1];
            if n >= 6 {
                assert!(after >= 4 * before, "n = {n}: {before} then {after}");
            }
        }
    }

    #[test]
    fn the_program_itself_stays_small() {
        let prog = compile(&parse(&pathological(18)).unwrap());
        assert_eq!(prog.len(), 55);
    }
}
```

```solution
#[derive(Debug, Clone, PartialEq)]
pub enum Ast {
    Char(char),
    Dot,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Concat(Vec<Ast>),
    Alternate(Box<Ast>, Box<Ast>),
    Star(Box<Ast>),
    Plus(Box<Ast>),
    Optional(Box<Ast>),
}

pub fn show(ast: &Ast) -> String {
    match ast {
        Ast::Char(c) => c.to_string(),
        Ast::Dot => ".".to_string(),
        Ast::Class { negated, ranges } => {
            let mut s = String::from("[");
            if *negated {
                s.push('^');
            }
            for &(lo, hi) in ranges {
                s.push(lo);
                if lo != hi {
                    s.push('-');
                    s.push(hi);
                }
            }
            s.push(']');
            s
        }
        Ast::Concat(items) => items.iter().map(show).collect(),
        Ast::Alternate(a, b) => format!("{}|{}", show(a), show(b)),
        Ast::Star(a) => format!("{}*", atom(a)),
        Ast::Plus(a) => format!("{}+", atom(a)),
        Ast::Optional(a) => format!("{}?", atom(a)),
    }
}

/// A repeat operator binds to one atom, so anything bigger needs brackets
/// putting back when the tree is printed.
fn atom(ast: &Ast) -> String {
    match ast {
        Ast::Char(_) | Ast::Dot | Ast::Class { .. } => show(ast),
        _ => format!("({})", show(ast)),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    UnexpectedEnd,
    UnclosedGroup(usize),
    StrayParen(usize),
    NothingToRepeat(usize),
    UnclosedClass(usize),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::UnexpectedEnd => write!(f, "pattern ends early"),
            ParseError::UnclosedGroup(i) => write!(f, "unclosed ( at {i}"),
            ParseError::StrayParen(i) => write!(f, "unmatched ) at {i}"),
            ParseError::NothingToRepeat(i) => write!(f, "nothing to repeat at {i}"),
            ParseError::UnclosedClass(i) => write!(f, "unclosed [ at {i}"),
        }
    }
}

pub struct Parser {
    chars: Vec<char>,
    pos: usize,
}

impl Parser {
    pub fn new(pattern: &str) -> Parser {
        Parser { chars: pattern.chars().collect(), pos: 0 }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    /// Loosest binding: everything up to a `|`, then everything after it.
    fn alternate(&mut self) -> Result<Ast, ParseError> {
        let mut left = self.concat()?;
        while self.peek() == Some('|') {
            self.bump();
            let right = self.concat()?;
            left = Ast::Alternate(Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    /// Tighter: a run of repeated atoms, stopping at `|` or `)`.
    fn concat(&mut self) -> Result<Ast, ParseError> {
        let mut items = Vec::new();
        while let Some(c) = self.peek() {
            if c == '|' || c == ')' {
                break;
            }
            items.push(self.repeat()?);
        }
        Ok(Ast::Concat(items))
    }

    /// Tightest: one atom with any number of postfix operators on it.
    fn repeat(&mut self) -> Result<Ast, ParseError> {
        let mut node = self.single()?;
        loop {
            match self.peek() {
                Some('*') => {
                    self.bump();
                    node = Ast::Star(Box::new(node));
                }
                Some('+') => {
                    self.bump();
                    node = Ast::Plus(Box::new(node));
                }
                Some('?') => {
                    self.bump();
                    node = Ast::Optional(Box::new(node));
                }
                _ => return Ok(node),
            }
        }
    }

    fn single(&mut self) -> Result<Ast, ParseError> {
        let start = self.pos;
        match self.bump() {
            None => Err(ParseError::UnexpectedEnd),
            Some('(') => {
                let inner = self.alternate()?;
                if self.bump() != Some(')') {
                    return Err(ParseError::UnclosedGroup(start));
                }
                Ok(inner)
            }
            Some(')') => Err(ParseError::StrayParen(start)),
            Some('.') => Ok(Ast::Dot),
            Some('[') => self.class(start),
            Some('*' | '+' | '?') => Err(ParseError::NothingToRepeat(start)),
            Some('\\') => match self.bump() {
                None => Err(ParseError::UnexpectedEnd),
                Some(c) => Ok(Ast::Char(c)),
            },
            Some(c) => Ok(Ast::Char(c)),
        }
    }

    fn class(&mut self, start: usize) -> Result<Ast, ParseError> {
        let negated = self.peek() == Some('^');
        if negated {
            self.bump();
        }
        let mut ranges = Vec::new();
        loop {
            let lo = match self.bump() {
                None => return Err(ParseError::UnclosedClass(start)),
                Some(']') => break,
                Some(c) => c,
            };
            let dashed = self.peek() == Some('-')
                && self.chars.get(self.pos + 1).is_some_and(|&n| n != ']');
            if dashed {
                self.bump();
                let hi = self.bump().ok_or(ParseError::UnclosedClass(start))?;
                ranges.push((lo, hi));
            } else {
                ranges.push((lo, lo));
            }
        }
        Ok(Ast::Class { negated, ranges })
    }
}

pub fn parse(pattern: &str) -> Result<Ast, ParseError> {
    let mut p = Parser::new(pattern);
    let ast = p.alternate()?;
    if p.pos < p.chars.len() {
        return Err(ParseError::StrayParen(p.pos));
    }
    Ok(ast)
}

#[derive(Debug, Clone, PartialEq)]
pub enum Inst {
    Char(char),
    Any,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Split(usize, usize),
    Jump(usize),
    Match,
}

pub type Program = Vec<Inst>;

pub fn compile(ast: &Ast) -> Program {
    let mut prog = Vec::new();
    emit(ast, &mut prog);
    prog.push(Inst::Match);
    prog
}

fn emit(ast: &Ast, prog: &mut Program) {
    match ast {
        Ast::Char(c) => prog.push(Inst::Char(*c)),
        Ast::Dot => prog.push(Inst::Any),
        Ast::Class { negated, ranges } => {
            prog.push(Inst::Class { negated: *negated, ranges: ranges.clone() })
        }
        Ast::Concat(items) => {
            for item in items {
                emit(item, prog);
            }
        }
        Ast::Alternate(a, b) => {
            //     split left, right
            // left:  <a>
            //     jmp after
            // right: <b>
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let jump = prog.len();
            prog.push(Inst::Jump(0));
            let right = prog.len();
            emit(b, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, right);
            prog[jump] = Inst::Jump(after);
        }
        Ast::Star(a) => {
            // split: split body, after
            // body:  <a>
            //        jmp split
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            prog.push(Inst::Jump(split));
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, after);
        }
        Ast::Plus(a) => {
            // body: <a>
            //       split body, after
            let body = prog.len();
            emit(a, prog);
            let split = prog.len();
            prog.push(Inst::Split(body, split + 1));
        }
        Ast::Optional(a) => {
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, after);
        }
    }
}

pub fn listing(prog: &Program) -> String {
    let mut out = String::new();
    for (i, inst) in prog.iter().enumerate() {
        let text = match inst {
            Inst::Char(c) => format!("char {c:?}"),
            Inst::Any => "any".to_string(),
            Inst::Class { negated, ranges } => {
                format!("class {}{:?}", if *negated { "^" } else { "" }, ranges)
            }
            Inst::Split(a, b) => format!("split {a}, {b}"),
            Inst::Jump(t) => format!("jmp {t}"),
            Inst::Match => "match".to_string(),
        };
        out.push_str(&format!("{i:>3}  {text}\n"));
    }
    out
}

fn in_class(negated: bool, ranges: &[(char, char)], c: char) -> bool {
    ranges.iter().any(|&(lo, hi)| lo <= c && c <= hi) != negated
}

/// Returns whether the whole input matched, and how many instructions were
/// executed getting to that answer.
pub fn backtrack(prog: &Program, input: &[char]) -> (bool, u64) {
    let mut steps = 0u64;
    let hit = walk(prog, input, 0, 0, &mut steps);
    (hit, steps)
}

fn walk(prog: &Program, input: &[char], pc: usize, sp: usize, steps: &mut u64) -> bool {
    *steps += 1;
    match &prog[pc] {
        Inst::Match => sp == input.len(),
        Inst::Char(c) => {
            sp < input.len() && input[sp] == *c && walk(prog, input, pc + 1, sp + 1, steps)
        }
        Inst::Any => sp < input.len() && walk(prog, input, pc + 1, sp + 1, steps),
        Inst::Class { negated, ranges } => {
            sp < input.len()
                && in_class(*negated, ranges, input[sp])
                && walk(prog, input, pc + 1, sp + 1, steps)
        }
        Inst::Split(a, b) => walk(prog, input, *a, sp, steps) || walk(prog, input, *b, sp, steps),
        Inst::Jump(t) => walk(prog, input, *t, sp, steps),
    }
}

/// `(a?)^n a^n`: n optional letters followed by n required ones. Every input
/// of n `a`s matches, and a backtracker has to discover which of the optional
/// letters to give up on.
pub fn pathological(n: usize) -> String {
    "a?".repeat(n) + &"a".repeat(n)
}

pub fn run() -> Vec<(usize, u64)> {
    let mut rows = Vec::new();
    println!(" n   pattern       steps");
    for n in [2usize, 4, 6, 8, 10, 12, 14, 16, 18] {
        let pattern = pathological(n);
        let prog = compile(&parse(&pattern).expect("pattern parses"));
        let input: Vec<char> = "a".repeat(n).chars().collect();
        let (hit, steps) = backtrack(&prog, &input);
        assert!(hit, "{pattern} does match {n} letters");
        println!("{n:2}   {:2} chars      {steps:>9}", pattern.len());
        rows.push((n, steps));
    }
    rows
}
```

@hint `String + String` is not an operation. Look at what the left operand's `Add` implementation actually accepts.
@hint `impl Add<&str> for String` is the only one there is: append a borrowed string to an owned one, reusing the owned buffer.
@hint `"a?".repeat(n) + &"a".repeat(n)`.

@diagnose E0308
`expected `&str`, found `String``, with `consider borrowing here`.

`String` implements exactly one `Add`: `impl Add<&str> for String`. It takes
the left side by value, appends the right side's bytes into its existing
allocation, and gives the `String` back. That signature is the whole design.
Taking the left by value means the buffer can be reused instead of a third
`String` being allocated, and taking the right by reference means the caller
keeps it.

`String + String` would have to decide which of two buffers to keep and drop
the other, so the standard library declines to guess. An `&` on the right is
the entire fix, and it is free: `&String` derefs to `&str`.

@diagnose E0369
`cannot add `String` to `&str``, from getting the operands the other
way round. The owned side has to be on the left, because that is the buffer the
result is built in. `&str` has no `Add` at all, since it owns nothing to append
into. If both sides are borrowed, use `format!` or `concat`.

@diagnose E0277
`the trait bound `String: Add<String>` is not satisfied`, which is
the same problem stated as a missing implementation rather than a type
mismatch. Operators are trait methods, so an unsupported combination shows up
as a trait that was never implemented.

@after
```text
 n   pattern       steps
 2    6 chars             14
 6   18 chars            382
10   30 chars           8190
14   42 chars         163838
18   54 chars        3145726
```

Two more characters on the pattern, four times the work. The program itself
grows by six instructions per step, from 7 to 55, so the machine being run
stays small; it is the number of paths through it that doubles with each
optional letter.

This is a real attack. Give a web server a pattern like this in a WAF rule and
a request body of a few dozen bytes, and one core is gone for the afternoon.
The published mitigations are all forms of giving up: a step budget, a timeout,
a rule that rejects patterns with nested quantifiers. The engine you write next
does not need any of them.

## 6. Every position at once

@kind fix
@concept borrow

@expect E0502

Rather than picking a branch, follow both. Keep a list of instructions
waiting for a character, advance every one of them by the same character, and
build the next list as you go. The line that adds a thread is adding it to the
wrong list, and the borrow checker has noticed.

```starter
#[derive(Debug, Clone, PartialEq)]
pub enum Ast {
    Char(char),
    Dot,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Concat(Vec<Ast>),
    Alternate(Box<Ast>, Box<Ast>),
    Star(Box<Ast>),
    Plus(Box<Ast>),
    Optional(Box<Ast>),
}

pub fn show(ast: &Ast) -> String {
    match ast {
        Ast::Char(c) => c.to_string(),
        Ast::Dot => ".".to_string(),
        Ast::Class { negated, ranges } => {
            let mut s = String::from("[");
            if *negated {
                s.push('^');
            }
            for &(lo, hi) in ranges {
                s.push(lo);
                if lo != hi {
                    s.push('-');
                    s.push(hi);
                }
            }
            s.push(']');
            s
        }
        Ast::Concat(items) => items.iter().map(show).collect(),
        Ast::Alternate(a, b) => format!("{}|{}", show(a), show(b)),
        Ast::Star(a) => format!("{}*", atom(a)),
        Ast::Plus(a) => format!("{}+", atom(a)),
        Ast::Optional(a) => format!("{}?", atom(a)),
    }
}

/// A repeat operator binds to one atom, so anything bigger needs brackets
/// putting back when the tree is printed.
fn atom(ast: &Ast) -> String {
    match ast {
        Ast::Char(_) | Ast::Dot | Ast::Class { .. } => show(ast),
        _ => format!("({})", show(ast)),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    UnexpectedEnd,
    UnclosedGroup(usize),
    StrayParen(usize),
    NothingToRepeat(usize),
    UnclosedClass(usize),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::UnexpectedEnd => write!(f, "pattern ends early"),
            ParseError::UnclosedGroup(i) => write!(f, "unclosed ( at {i}"),
            ParseError::StrayParen(i) => write!(f, "unmatched ) at {i}"),
            ParseError::NothingToRepeat(i) => write!(f, "nothing to repeat at {i}"),
            ParseError::UnclosedClass(i) => write!(f, "unclosed [ at {i}"),
        }
    }
}

pub struct Parser {
    chars: Vec<char>,
    pos: usize,
}

impl Parser {
    pub fn new(pattern: &str) -> Parser {
        Parser { chars: pattern.chars().collect(), pos: 0 }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    /// Loosest binding: everything up to a `|`, then everything after it.
    fn alternate(&mut self) -> Result<Ast, ParseError> {
        let mut left = self.concat()?;
        while self.peek() == Some('|') {
            self.bump();
            let right = self.concat()?;
            left = Ast::Alternate(Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    /// Tighter: a run of repeated atoms, stopping at `|` or `)`.
    fn concat(&mut self) -> Result<Ast, ParseError> {
        let mut items = Vec::new();
        while let Some(c) = self.peek() {
            if c == '|' || c == ')' {
                break;
            }
            items.push(self.repeat()?);
        }
        Ok(Ast::Concat(items))
    }

    /// Tightest: one atom with any number of postfix operators on it.
    fn repeat(&mut self) -> Result<Ast, ParseError> {
        let mut node = self.single()?;
        loop {
            match self.peek() {
                Some('*') => {
                    self.bump();
                    node = Ast::Star(Box::new(node));
                }
                Some('+') => {
                    self.bump();
                    node = Ast::Plus(Box::new(node));
                }
                Some('?') => {
                    self.bump();
                    node = Ast::Optional(Box::new(node));
                }
                _ => return Ok(node),
            }
        }
    }

    fn single(&mut self) -> Result<Ast, ParseError> {
        let start = self.pos;
        match self.bump() {
            None => Err(ParseError::UnexpectedEnd),
            Some('(') => {
                let inner = self.alternate()?;
                if self.bump() != Some(')') {
                    return Err(ParseError::UnclosedGroup(start));
                }
                Ok(inner)
            }
            Some(')') => Err(ParseError::StrayParen(start)),
            Some('.') => Ok(Ast::Dot),
            Some('[') => self.class(start),
            Some('*' | '+' | '?') => Err(ParseError::NothingToRepeat(start)),
            Some('\\') => match self.bump() {
                None => Err(ParseError::UnexpectedEnd),
                Some(c) => Ok(Ast::Char(c)),
            },
            Some(c) => Ok(Ast::Char(c)),
        }
    }

    fn class(&mut self, start: usize) -> Result<Ast, ParseError> {
        let negated = self.peek() == Some('^');
        if negated {
            self.bump();
        }
        let mut ranges = Vec::new();
        loop {
            let lo = match self.bump() {
                None => return Err(ParseError::UnclosedClass(start)),
                Some(']') => break,
                Some(c) => c,
            };
            let dashed = self.peek() == Some('-')
                && self.chars.get(self.pos + 1).is_some_and(|&n| n != ']');
            if dashed {
                self.bump();
                let hi = self.bump().ok_or(ParseError::UnclosedClass(start))?;
                ranges.push((lo, hi));
            } else {
                ranges.push((lo, lo));
            }
        }
        Ok(Ast::Class { negated, ranges })
    }
}

pub fn parse(pattern: &str) -> Result<Ast, ParseError> {
    let mut p = Parser::new(pattern);
    let ast = p.alternate()?;
    if p.pos < p.chars.len() {
        return Err(ParseError::StrayParen(p.pos));
    }
    Ok(ast)
}

#[derive(Debug, Clone, PartialEq)]
pub enum Inst {
    Char(char),
    Any,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Split(usize, usize),
    Jump(usize),
    Match,
}

pub type Program = Vec<Inst>;

pub fn compile(ast: &Ast) -> Program {
    let mut prog = Vec::new();
    emit(ast, &mut prog);
    prog.push(Inst::Match);
    prog
}

fn emit(ast: &Ast, prog: &mut Program) {
    match ast {
        Ast::Char(c) => prog.push(Inst::Char(*c)),
        Ast::Dot => prog.push(Inst::Any),
        Ast::Class { negated, ranges } => {
            prog.push(Inst::Class { negated: *negated, ranges: ranges.clone() })
        }
        Ast::Concat(items) => {
            for item in items {
                emit(item, prog);
            }
        }
        Ast::Alternate(a, b) => {
            //     split left, right
            // left:  <a>
            //     jmp after
            // right: <b>
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let jump = prog.len();
            prog.push(Inst::Jump(0));
            let right = prog.len();
            emit(b, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, right);
            prog[jump] = Inst::Jump(after);
        }
        Ast::Star(a) => {
            // split: split body, after
            // body:  <a>
            //        jmp split
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            prog.push(Inst::Jump(split));
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, after);
        }
        Ast::Plus(a) => {
            // body: <a>
            //       split body, after
            let body = prog.len();
            emit(a, prog);
            let split = prog.len();
            prog.push(Inst::Split(body, split + 1));
        }
        Ast::Optional(a) => {
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, after);
        }
    }
}

pub fn listing(prog: &Program) -> String {
    let mut out = String::new();
    for (i, inst) in prog.iter().enumerate() {
        let text = match inst {
            Inst::Char(c) => format!("char {c:?}"),
            Inst::Any => "any".to_string(),
            Inst::Class { negated, ranges } => {
                format!("class {}{:?}", if *negated { "^" } else { "" }, ranges)
            }
            Inst::Split(a, b) => format!("split {a}, {b}"),
            Inst::Jump(t) => format!("jmp {t}"),
            Inst::Match => "match".to_string(),
        };
        out.push_str(&format!("{i:>3}  {text}\n"));
    }
    out
}

fn in_class(negated: bool, ranges: &[(char, char)], c: char) -> bool {
    ranges.iter().any(|&(lo, hi)| lo <= c && c <= hi) != negated
}

/// Returns whether the whole input matched, and how many instructions were
/// executed getting to that answer.
pub fn backtrack(prog: &Program, input: &[char]) -> (bool, u64) {
    let mut steps = 0u64;
    let hit = walk(prog, input, 0, 0, &mut steps);
    (hit, steps)
}

fn walk(prog: &Program, input: &[char], pc: usize, sp: usize, steps: &mut u64) -> bool {
    *steps += 1;
    match &prog[pc] {
        Inst::Match => sp == input.len(),
        Inst::Char(c) => {
            sp < input.len() && input[sp] == *c && walk(prog, input, pc + 1, sp + 1, steps)
        }
        Inst::Any => sp < input.len() && walk(prog, input, pc + 1, sp + 1, steps),
        Inst::Class { negated, ranges } => {
            sp < input.len()
                && in_class(*negated, ranges, input[sp])
                && walk(prog, input, pc + 1, sp + 1, steps)
        }
        Inst::Split(a, b) => walk(prog, input, *a, sp, steps) || walk(prog, input, *b, sp, steps),
        Inst::Jump(t) => walk(prog, input, *t, sp, steps),
    }
}

/// `(a?)^n a^n`: n optional letters followed by n required ones. Every input
/// of n `a`s matches, and a backtracker has to discover which of the optional
/// letters to give up on.
pub fn pathological(n: usize) -> String {
    "a?".repeat(n) + &"a".repeat(n)
}

/// Follow every Jump and Split now, at this input position, and park the
/// instructions that need a character in `list`. `seen` makes each instruction
/// enter the list at most once per position, which is the whole trick.
fn add(prog: &Program, pc: usize, list: &mut Vec<usize>, seen: &mut [bool], steps: &mut u64) {
    if seen[pc] {
        return;
    }
    seen[pc] = true;
    *steps += 1;
    match &prog[pc] {
        Inst::Jump(t) => add(prog, *t, list, seen, steps),
        Inst::Split(a, b) => {
            add(prog, *a, list, seen, steps);
            add(prog, *b, list, seen, steps);
        }
        _ => list.push(pc),
    }
}

pub fn thompson(prog: &Program, input: &[char]) -> (bool, u64) {
    let mut steps = 0u64;
    let mut clist = Vec::new();
    let mut seen = vec![false; prog.len()];
    add(prog, 0, &mut clist, &mut seen, &mut steps);

    for sp in 0..=input.len() {
        let mut nlist = Vec::new();
        let mut nseen = vec![false; prog.len()];
        for &pc in &clist {
            steps += 1;
            let advance = match &prog[pc] {
                Inst::Match => {
                    if sp == input.len() {
                        return (true, steps);
                    }
                    false
                }
                Inst::Char(c) => sp < input.len() && input[sp] == *c,
                Inst::Any => sp < input.len(),
                Inst::Class { negated, ranges } => {
                    sp < input.len() && in_class(*negated, ranges, input[sp])
                }
                _ => false,
            };
            if advance {
                add(prog, pc + 1, &mut clist, &mut nseen, &mut steps);
            }
        }
        clist = nlist;
    }
    (false, steps)
}

pub fn run() -> Vec<(bool, u64)> {
    let prog = compile(&parse("a(b|c)*d").expect("pattern parses"));
    let mut out = Vec::new();
    for text in ["ad", "abd", "abcbcd", "abx", ""] {
        let input: Vec<char> = text.chars().collect();
        let (hit, steps) = thompson(&prog, &input);
        assert_eq!(hit, backtrack(&prog, &input).0, "the engines disagree on {text:?}");
        println!("{:10} {hit:5}  {steps} steps", format!("{text:?}"));
        out.push((hit, steps));
    }
    out
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_agrees_with_the_backtracker_on_the_demo() {
        let hits: Vec<bool> = run().iter().map(|&(hit, _)| hit).collect();
        assert_eq!(hits, [true, true, true, false, false]);
    }

    #[test]
    fn the_two_engines_never_disagree() {
        let patterns = [
            "", "a", "ab|cd", "a(b|c)*", "(ab)*c", "a+b?", "[a-z0-9]+",
            "[^0-9]+", "a.c", "(a|b)*abb", "x?y?z?",
        ];
        let inputs = ["", "a", "ab", "cd", "abc", "abcbcd", "rust2024", "xz", "aabb", "abb"];
        for p in patterns {
            let prog = compile(&parse(p).unwrap());
            for s in inputs {
                let input: Vec<char> = s.chars().collect();
                assert_eq!(
                    thompson(&prog, &input).0,
                    backtrack(&prog, &input).0,
                    "{p:?} against {s:?}"
                );
            }
        }
    }

    #[test]
    fn no_instruction_is_visited_twice_at_one_position() {
        // 9 instructions, 7 input positions: the bound is a product, not a power.
        let prog = compile(&parse("a(b|c)*d").unwrap());
        let input: Vec<char> = "abcbcd".chars().collect();
        let (hit, steps) = thompson(&prog, &input);
        assert!(hit);
        assert!(steps <= (prog.len() * (input.len() + 1)) as u64 * 2, "{steps}");
    }
}
```

```solution
#[derive(Debug, Clone, PartialEq)]
pub enum Ast {
    Char(char),
    Dot,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Concat(Vec<Ast>),
    Alternate(Box<Ast>, Box<Ast>),
    Star(Box<Ast>),
    Plus(Box<Ast>),
    Optional(Box<Ast>),
}

pub fn show(ast: &Ast) -> String {
    match ast {
        Ast::Char(c) => c.to_string(),
        Ast::Dot => ".".to_string(),
        Ast::Class { negated, ranges } => {
            let mut s = String::from("[");
            if *negated {
                s.push('^');
            }
            for &(lo, hi) in ranges {
                s.push(lo);
                if lo != hi {
                    s.push('-');
                    s.push(hi);
                }
            }
            s.push(']');
            s
        }
        Ast::Concat(items) => items.iter().map(show).collect(),
        Ast::Alternate(a, b) => format!("{}|{}", show(a), show(b)),
        Ast::Star(a) => format!("{}*", atom(a)),
        Ast::Plus(a) => format!("{}+", atom(a)),
        Ast::Optional(a) => format!("{}?", atom(a)),
    }
}

/// A repeat operator binds to one atom, so anything bigger needs brackets
/// putting back when the tree is printed.
fn atom(ast: &Ast) -> String {
    match ast {
        Ast::Char(_) | Ast::Dot | Ast::Class { .. } => show(ast),
        _ => format!("({})", show(ast)),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    UnexpectedEnd,
    UnclosedGroup(usize),
    StrayParen(usize),
    NothingToRepeat(usize),
    UnclosedClass(usize),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::UnexpectedEnd => write!(f, "pattern ends early"),
            ParseError::UnclosedGroup(i) => write!(f, "unclosed ( at {i}"),
            ParseError::StrayParen(i) => write!(f, "unmatched ) at {i}"),
            ParseError::NothingToRepeat(i) => write!(f, "nothing to repeat at {i}"),
            ParseError::UnclosedClass(i) => write!(f, "unclosed [ at {i}"),
        }
    }
}

pub struct Parser {
    chars: Vec<char>,
    pos: usize,
}

impl Parser {
    pub fn new(pattern: &str) -> Parser {
        Parser { chars: pattern.chars().collect(), pos: 0 }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    /// Loosest binding: everything up to a `|`, then everything after it.
    fn alternate(&mut self) -> Result<Ast, ParseError> {
        let mut left = self.concat()?;
        while self.peek() == Some('|') {
            self.bump();
            let right = self.concat()?;
            left = Ast::Alternate(Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    /// Tighter: a run of repeated atoms, stopping at `|` or `)`.
    fn concat(&mut self) -> Result<Ast, ParseError> {
        let mut items = Vec::new();
        while let Some(c) = self.peek() {
            if c == '|' || c == ')' {
                break;
            }
            items.push(self.repeat()?);
        }
        Ok(Ast::Concat(items))
    }

    /// Tightest: one atom with any number of postfix operators on it.
    fn repeat(&mut self) -> Result<Ast, ParseError> {
        let mut node = self.single()?;
        loop {
            match self.peek() {
                Some('*') => {
                    self.bump();
                    node = Ast::Star(Box::new(node));
                }
                Some('+') => {
                    self.bump();
                    node = Ast::Plus(Box::new(node));
                }
                Some('?') => {
                    self.bump();
                    node = Ast::Optional(Box::new(node));
                }
                _ => return Ok(node),
            }
        }
    }

    fn single(&mut self) -> Result<Ast, ParseError> {
        let start = self.pos;
        match self.bump() {
            None => Err(ParseError::UnexpectedEnd),
            Some('(') => {
                let inner = self.alternate()?;
                if self.bump() != Some(')') {
                    return Err(ParseError::UnclosedGroup(start));
                }
                Ok(inner)
            }
            Some(')') => Err(ParseError::StrayParen(start)),
            Some('.') => Ok(Ast::Dot),
            Some('[') => self.class(start),
            Some('*' | '+' | '?') => Err(ParseError::NothingToRepeat(start)),
            Some('\\') => match self.bump() {
                None => Err(ParseError::UnexpectedEnd),
                Some(c) => Ok(Ast::Char(c)),
            },
            Some(c) => Ok(Ast::Char(c)),
        }
    }

    fn class(&mut self, start: usize) -> Result<Ast, ParseError> {
        let negated = self.peek() == Some('^');
        if negated {
            self.bump();
        }
        let mut ranges = Vec::new();
        loop {
            let lo = match self.bump() {
                None => return Err(ParseError::UnclosedClass(start)),
                Some(']') => break,
                Some(c) => c,
            };
            let dashed = self.peek() == Some('-')
                && self.chars.get(self.pos + 1).is_some_and(|&n| n != ']');
            if dashed {
                self.bump();
                let hi = self.bump().ok_or(ParseError::UnclosedClass(start))?;
                ranges.push((lo, hi));
            } else {
                ranges.push((lo, lo));
            }
        }
        Ok(Ast::Class { negated, ranges })
    }
}

pub fn parse(pattern: &str) -> Result<Ast, ParseError> {
    let mut p = Parser::new(pattern);
    let ast = p.alternate()?;
    if p.pos < p.chars.len() {
        return Err(ParseError::StrayParen(p.pos));
    }
    Ok(ast)
}

#[derive(Debug, Clone, PartialEq)]
pub enum Inst {
    Char(char),
    Any,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Split(usize, usize),
    Jump(usize),
    Match,
}

pub type Program = Vec<Inst>;

pub fn compile(ast: &Ast) -> Program {
    let mut prog = Vec::new();
    emit(ast, &mut prog);
    prog.push(Inst::Match);
    prog
}

fn emit(ast: &Ast, prog: &mut Program) {
    match ast {
        Ast::Char(c) => prog.push(Inst::Char(*c)),
        Ast::Dot => prog.push(Inst::Any),
        Ast::Class { negated, ranges } => {
            prog.push(Inst::Class { negated: *negated, ranges: ranges.clone() })
        }
        Ast::Concat(items) => {
            for item in items {
                emit(item, prog);
            }
        }
        Ast::Alternate(a, b) => {
            //     split left, right
            // left:  <a>
            //     jmp after
            // right: <b>
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let jump = prog.len();
            prog.push(Inst::Jump(0));
            let right = prog.len();
            emit(b, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, right);
            prog[jump] = Inst::Jump(after);
        }
        Ast::Star(a) => {
            // split: split body, after
            // body:  <a>
            //        jmp split
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            prog.push(Inst::Jump(split));
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, after);
        }
        Ast::Plus(a) => {
            // body: <a>
            //       split body, after
            let body = prog.len();
            emit(a, prog);
            let split = prog.len();
            prog.push(Inst::Split(body, split + 1));
        }
        Ast::Optional(a) => {
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, after);
        }
    }
}

pub fn listing(prog: &Program) -> String {
    let mut out = String::new();
    for (i, inst) in prog.iter().enumerate() {
        let text = match inst {
            Inst::Char(c) => format!("char {c:?}"),
            Inst::Any => "any".to_string(),
            Inst::Class { negated, ranges } => {
                format!("class {}{:?}", if *negated { "^" } else { "" }, ranges)
            }
            Inst::Split(a, b) => format!("split {a}, {b}"),
            Inst::Jump(t) => format!("jmp {t}"),
            Inst::Match => "match".to_string(),
        };
        out.push_str(&format!("{i:>3}  {text}\n"));
    }
    out
}

fn in_class(negated: bool, ranges: &[(char, char)], c: char) -> bool {
    ranges.iter().any(|&(lo, hi)| lo <= c && c <= hi) != negated
}

/// Returns whether the whole input matched, and how many instructions were
/// executed getting to that answer.
pub fn backtrack(prog: &Program, input: &[char]) -> (bool, u64) {
    let mut steps = 0u64;
    let hit = walk(prog, input, 0, 0, &mut steps);
    (hit, steps)
}

fn walk(prog: &Program, input: &[char], pc: usize, sp: usize, steps: &mut u64) -> bool {
    *steps += 1;
    match &prog[pc] {
        Inst::Match => sp == input.len(),
        Inst::Char(c) => {
            sp < input.len() && input[sp] == *c && walk(prog, input, pc + 1, sp + 1, steps)
        }
        Inst::Any => sp < input.len() && walk(prog, input, pc + 1, sp + 1, steps),
        Inst::Class { negated, ranges } => {
            sp < input.len()
                && in_class(*negated, ranges, input[sp])
                && walk(prog, input, pc + 1, sp + 1, steps)
        }
        Inst::Split(a, b) => walk(prog, input, *a, sp, steps) || walk(prog, input, *b, sp, steps),
        Inst::Jump(t) => walk(prog, input, *t, sp, steps),
    }
}

/// `(a?)^n a^n`: n optional letters followed by n required ones. Every input
/// of n `a`s matches, and a backtracker has to discover which of the optional
/// letters to give up on.
pub fn pathological(n: usize) -> String {
    "a?".repeat(n) + &"a".repeat(n)
}

/// Follow every Jump and Split now, at this input position, and park the
/// instructions that need a character in `list`. `seen` makes each instruction
/// enter the list at most once per position, which is the whole trick.
fn add(prog: &Program, pc: usize, list: &mut Vec<usize>, seen: &mut [bool], steps: &mut u64) {
    if seen[pc] {
        return;
    }
    seen[pc] = true;
    *steps += 1;
    match &prog[pc] {
        Inst::Jump(t) => add(prog, *t, list, seen, steps),
        Inst::Split(a, b) => {
            add(prog, *a, list, seen, steps);
            add(prog, *b, list, seen, steps);
        }
        _ => list.push(pc),
    }
}

pub fn thompson(prog: &Program, input: &[char]) -> (bool, u64) {
    let mut steps = 0u64;
    let mut clist = Vec::new();
    let mut seen = vec![false; prog.len()];
    add(prog, 0, &mut clist, &mut seen, &mut steps);

    for sp in 0..=input.len() {
        let mut nlist = Vec::new();
        let mut nseen = vec![false; prog.len()];
        for &pc in &clist {
            steps += 1;
            let advance = match &prog[pc] {
                Inst::Match => {
                    if sp == input.len() {
                        return (true, steps);
                    }
                    false
                }
                Inst::Char(c) => sp < input.len() && input[sp] == *c,
                Inst::Any => sp < input.len(),
                Inst::Class { negated, ranges } => {
                    sp < input.len() && in_class(*negated, ranges, input[sp])
                }
                _ => false,
            };
            if advance {
                add(prog, pc + 1, &mut nlist, &mut nseen, &mut steps);
            }
        }
        clist = nlist;
    }
    (false, steps)
}

pub fn run() -> Vec<(bool, u64)> {
    let prog = compile(&parse("a(b|c)*d").expect("pattern parses"));
    let mut out = Vec::new();
    for text in ["ad", "abd", "abcbcd", "abx", ""] {
        let input: Vec<char> = text.chars().collect();
        let (hit, steps) = thompson(&prog, &input);
        assert_eq!(hit, backtrack(&prog, &input).0, "the engines disagree on {text:?}");
        println!("{:10} {hit:5}  {steps} steps", format!("{text:?}"));
        out.push((hit, steps));
    }
    out
}
```

@hint The loop is reading `clist` while something inside it wants to write. Which list is the new thread for?
@hint A thread that just consumed the character at `sp` belongs at position `sp + 1`, not at the position currently being processed.
@hint `&mut nlist`, which is what `nseen` is already paired with.

@diagnose E0502
`cannot borrow `clist` as mutable because it is also borrowed as
immutable`, with the `for &pc in &clist` underlined as the immutable borrow and
`later used here`.

The borrow checker is right on the mechanics: pushing to a `Vec` can reallocate
it, which would invalidate the iterator walking it. Most languages discover
this at runtime, or not at all.

It is also right on the algorithm, which is the better reason. `clist` holds
the instructions live at input position `sp`. A thread created by consuming the
character at `sp` is live at `sp + 1` and belongs in `nlist`. Appending it to
`clist` would process it against the same character again, and the loop would
run forever on any pattern containing a star. The two lists are two positions
in time, and the compiler will not let you conflate them.

@diagnose E0499
`cannot borrow `nlist` as mutable more than once at a time`. You are
holding a `&mut` to the list across the `add` call, probably by binding
something out of it first. `add` wants the only mutable borrow for the length
of the call; let it have it, and read anything you need from the list before or
after.

@diagnose E0382
`use of moved value: nlist`, from `clist = nlist` inside the inner
loop rather than after it. The swap happens once per input position, when every
thread at this position has been processed. Doing it per thread throws away the
rest of the current list.

@after
`seen` is the whole algorithm. Without it, `add` on a program containing
a star would follow `Split` targets around the loop forever. With it, each
instruction enters a list at most once per input position, so a list is at most
as long as the program, and there is one list per position. The bound is
program length times input length, and it holds for every pattern.

What was lost is real. There is no notion of a preferred branch in this
version, so it cannot say which alternative matched or where a group started,
only whether the whole thing matched. Stage 8 puts that back.

Thompson wrote this in 1968 for an IBM 7094, and compiled the pattern to actual
machine code rather than an interpreted instruction list. The list of active
states is the same.

## 7. The same pattern, counted

@kind fix
@concept display

@expect E0277

Both engines, the same pathological pattern, the same inputs, with the
step counts side by side and an assertion that the Thompson number stays
polynomial. The table does not print: a `Vec` is not something `{}` knows how
to format.

```starter
#[derive(Debug, Clone, PartialEq)]
pub enum Ast {
    Char(char),
    Dot,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Concat(Vec<Ast>),
    Alternate(Box<Ast>, Box<Ast>),
    Star(Box<Ast>),
    Plus(Box<Ast>),
    Optional(Box<Ast>),
}

pub fn show(ast: &Ast) -> String {
    match ast {
        Ast::Char(c) => c.to_string(),
        Ast::Dot => ".".to_string(),
        Ast::Class { negated, ranges } => {
            let mut s = String::from("[");
            if *negated {
                s.push('^');
            }
            for &(lo, hi) in ranges {
                s.push(lo);
                if lo != hi {
                    s.push('-');
                    s.push(hi);
                }
            }
            s.push(']');
            s
        }
        Ast::Concat(items) => items.iter().map(show).collect(),
        Ast::Alternate(a, b) => format!("{}|{}", show(a), show(b)),
        Ast::Star(a) => format!("{}*", atom(a)),
        Ast::Plus(a) => format!("{}+", atom(a)),
        Ast::Optional(a) => format!("{}?", atom(a)),
    }
}

/// A repeat operator binds to one atom, so anything bigger needs brackets
/// putting back when the tree is printed.
fn atom(ast: &Ast) -> String {
    match ast {
        Ast::Char(_) | Ast::Dot | Ast::Class { .. } => show(ast),
        _ => format!("({})", show(ast)),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    UnexpectedEnd,
    UnclosedGroup(usize),
    StrayParen(usize),
    NothingToRepeat(usize),
    UnclosedClass(usize),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::UnexpectedEnd => write!(f, "pattern ends early"),
            ParseError::UnclosedGroup(i) => write!(f, "unclosed ( at {i}"),
            ParseError::StrayParen(i) => write!(f, "unmatched ) at {i}"),
            ParseError::NothingToRepeat(i) => write!(f, "nothing to repeat at {i}"),
            ParseError::UnclosedClass(i) => write!(f, "unclosed [ at {i}"),
        }
    }
}

pub struct Parser {
    chars: Vec<char>,
    pos: usize,
}

impl Parser {
    pub fn new(pattern: &str) -> Parser {
        Parser { chars: pattern.chars().collect(), pos: 0 }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    /// Loosest binding: everything up to a `|`, then everything after it.
    fn alternate(&mut self) -> Result<Ast, ParseError> {
        let mut left = self.concat()?;
        while self.peek() == Some('|') {
            self.bump();
            let right = self.concat()?;
            left = Ast::Alternate(Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    /// Tighter: a run of repeated atoms, stopping at `|` or `)`.
    fn concat(&mut self) -> Result<Ast, ParseError> {
        let mut items = Vec::new();
        while let Some(c) = self.peek() {
            if c == '|' || c == ')' {
                break;
            }
            items.push(self.repeat()?);
        }
        Ok(Ast::Concat(items))
    }

    /// Tightest: one atom with any number of postfix operators on it.
    fn repeat(&mut self) -> Result<Ast, ParseError> {
        let mut node = self.single()?;
        loop {
            match self.peek() {
                Some('*') => {
                    self.bump();
                    node = Ast::Star(Box::new(node));
                }
                Some('+') => {
                    self.bump();
                    node = Ast::Plus(Box::new(node));
                }
                Some('?') => {
                    self.bump();
                    node = Ast::Optional(Box::new(node));
                }
                _ => return Ok(node),
            }
        }
    }

    fn single(&mut self) -> Result<Ast, ParseError> {
        let start = self.pos;
        match self.bump() {
            None => Err(ParseError::UnexpectedEnd),
            Some('(') => {
                let inner = self.alternate()?;
                if self.bump() != Some(')') {
                    return Err(ParseError::UnclosedGroup(start));
                }
                Ok(inner)
            }
            Some(')') => Err(ParseError::StrayParen(start)),
            Some('.') => Ok(Ast::Dot),
            Some('[') => self.class(start),
            Some('*' | '+' | '?') => Err(ParseError::NothingToRepeat(start)),
            Some('\\') => match self.bump() {
                None => Err(ParseError::UnexpectedEnd),
                Some(c) => Ok(Ast::Char(c)),
            },
            Some(c) => Ok(Ast::Char(c)),
        }
    }

    fn class(&mut self, start: usize) -> Result<Ast, ParseError> {
        let negated = self.peek() == Some('^');
        if negated {
            self.bump();
        }
        let mut ranges = Vec::new();
        loop {
            let lo = match self.bump() {
                None => return Err(ParseError::UnclosedClass(start)),
                Some(']') => break,
                Some(c) => c,
            };
            let dashed = self.peek() == Some('-')
                && self.chars.get(self.pos + 1).is_some_and(|&n| n != ']');
            if dashed {
                self.bump();
                let hi = self.bump().ok_or(ParseError::UnclosedClass(start))?;
                ranges.push((lo, hi));
            } else {
                ranges.push((lo, lo));
            }
        }
        Ok(Ast::Class { negated, ranges })
    }
}

pub fn parse(pattern: &str) -> Result<Ast, ParseError> {
    let mut p = Parser::new(pattern);
    let ast = p.alternate()?;
    if p.pos < p.chars.len() {
        return Err(ParseError::StrayParen(p.pos));
    }
    Ok(ast)
}

#[derive(Debug, Clone, PartialEq)]
pub enum Inst {
    Char(char),
    Any,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Split(usize, usize),
    Jump(usize),
    Match,
}

pub type Program = Vec<Inst>;

pub fn compile(ast: &Ast) -> Program {
    let mut prog = Vec::new();
    emit(ast, &mut prog);
    prog.push(Inst::Match);
    prog
}

fn emit(ast: &Ast, prog: &mut Program) {
    match ast {
        Ast::Char(c) => prog.push(Inst::Char(*c)),
        Ast::Dot => prog.push(Inst::Any),
        Ast::Class { negated, ranges } => {
            prog.push(Inst::Class { negated: *negated, ranges: ranges.clone() })
        }
        Ast::Concat(items) => {
            for item in items {
                emit(item, prog);
            }
        }
        Ast::Alternate(a, b) => {
            //     split left, right
            // left:  <a>
            //     jmp after
            // right: <b>
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let jump = prog.len();
            prog.push(Inst::Jump(0));
            let right = prog.len();
            emit(b, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, right);
            prog[jump] = Inst::Jump(after);
        }
        Ast::Star(a) => {
            // split: split body, after
            // body:  <a>
            //        jmp split
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            prog.push(Inst::Jump(split));
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, after);
        }
        Ast::Plus(a) => {
            // body: <a>
            //       split body, after
            let body = prog.len();
            emit(a, prog);
            let split = prog.len();
            prog.push(Inst::Split(body, split + 1));
        }
        Ast::Optional(a) => {
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, after);
        }
    }
}

pub fn listing(prog: &Program) -> String {
    let mut out = String::new();
    for (i, inst) in prog.iter().enumerate() {
        let text = match inst {
            Inst::Char(c) => format!("char {c:?}"),
            Inst::Any => "any".to_string(),
            Inst::Class { negated, ranges } => {
                format!("class {}{:?}", if *negated { "^" } else { "" }, ranges)
            }
            Inst::Split(a, b) => format!("split {a}, {b}"),
            Inst::Jump(t) => format!("jmp {t}"),
            Inst::Match => "match".to_string(),
        };
        out.push_str(&format!("{i:>3}  {text}\n"));
    }
    out
}

fn in_class(negated: bool, ranges: &[(char, char)], c: char) -> bool {
    ranges.iter().any(|&(lo, hi)| lo <= c && c <= hi) != negated
}

/// Returns whether the whole input matched, and how many instructions were
/// executed getting to that answer.
pub fn backtrack(prog: &Program, input: &[char]) -> (bool, u64) {
    let mut steps = 0u64;
    let hit = walk(prog, input, 0, 0, &mut steps);
    (hit, steps)
}

fn walk(prog: &Program, input: &[char], pc: usize, sp: usize, steps: &mut u64) -> bool {
    *steps += 1;
    match &prog[pc] {
        Inst::Match => sp == input.len(),
        Inst::Char(c) => {
            sp < input.len() && input[sp] == *c && walk(prog, input, pc + 1, sp + 1, steps)
        }
        Inst::Any => sp < input.len() && walk(prog, input, pc + 1, sp + 1, steps),
        Inst::Class { negated, ranges } => {
            sp < input.len()
                && in_class(*negated, ranges, input[sp])
                && walk(prog, input, pc + 1, sp + 1, steps)
        }
        Inst::Split(a, b) => walk(prog, input, *a, sp, steps) || walk(prog, input, *b, sp, steps),
        Inst::Jump(t) => walk(prog, input, *t, sp, steps),
    }
}

/// `(a?)^n a^n`: n optional letters followed by n required ones. Every input
/// of n `a`s matches, and a backtracker has to discover which of the optional
/// letters to give up on.
pub fn pathological(n: usize) -> String {
    "a?".repeat(n) + &"a".repeat(n)
}

/// Follow every Jump and Split now, at this input position, and park the
/// instructions that need a character in `list`. `seen` makes each instruction
/// enter the list at most once per position, which is the whole trick.
fn add(prog: &Program, pc: usize, list: &mut Vec<usize>, seen: &mut [bool], steps: &mut u64) {
    if seen[pc] {
        return;
    }
    seen[pc] = true;
    *steps += 1;
    match &prog[pc] {
        Inst::Jump(t) => add(prog, *t, list, seen, steps),
        Inst::Split(a, b) => {
            add(prog, *a, list, seen, steps);
            add(prog, *b, list, seen, steps);
        }
        _ => list.push(pc),
    }
}

pub fn thompson(prog: &Program, input: &[char]) -> (bool, u64) {
    let mut steps = 0u64;
    let mut clist = Vec::new();
    let mut seen = vec![false; prog.len()];
    add(prog, 0, &mut clist, &mut seen, &mut steps);

    for sp in 0..=input.len() {
        let mut nlist = Vec::new();
        let mut nseen = vec![false; prog.len()];
        for &pc in &clist {
            steps += 1;
            let advance = match &prog[pc] {
                Inst::Match => {
                    if sp == input.len() {
                        return (true, steps);
                    }
                    false
                }
                Inst::Char(c) => sp < input.len() && input[sp] == *c,
                Inst::Any => sp < input.len(),
                Inst::Class { negated, ranges } => {
                    sp < input.len() && in_class(*negated, ranges, input[sp])
                }
                _ => false,
            };
            if advance {
                add(prog, pc + 1, &mut nlist, &mut nseen, &mut steps);
            }
        }
        clist = nlist;
    }
    (false, steps)
}

pub fn run() -> Vec<(usize, u64, u64)> {
    let mut rows = Vec::new();
    for n in [2usize, 4, 6, 8, 10, 12, 14, 16, 18] {
        let prog = compile(&parse(&pathological(n)).expect("pattern parses"));
        let input: Vec<char> = "a".repeat(n).chars().collect();
        let (hit_b, steps_b) = backtrack(&prog, &input);
        let (hit_t, steps_t) = thompson(&prog, &input);
        assert_eq!(hit_b, hit_t, "the engines disagree at n = {n}");
        rows.push((n, steps_b, steps_t));
    }

    println!(" n   backtracking   thompson");
    println!("{rows}");
    rows
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_engine_explodes_and_the_other_does_not() {
        let rows = run();
        assert_eq!(rows[0], (2, 14, 21));
        assert_eq!(*rows.last().unwrap(), (18, 3_145_726, 893));

        for &(n, _, thompson_steps) in &rows {
            let bound = 3 * n as u64 * n as u64 + 50;
            assert!(thompson_steps < bound, "n = {n}: {thompson_steps} steps");
        }

        let &(_, backtracking, thompson_steps) = rows.last().unwrap();
        assert!(backtracking / thompson_steps > 3000);
    }

    #[test]
    fn the_thompson_cost_tracks_the_program_times_the_input() {
        for n in [4usize, 12, 20] {
            let prog = compile(&parse(&pathological(n)).unwrap());
            let input: Vec<char> = "a".repeat(n).chars().collect();
            let (hit, steps) = thompson(&prog, &input);
            assert!(hit);
            assert!(steps <= (prog.len() * (input.len() + 1)) as u64 * 2, "n = {n}: {steps}");
        }
    }
}
```

```solution
#[derive(Debug, Clone, PartialEq)]
pub enum Ast {
    Char(char),
    Dot,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Concat(Vec<Ast>),
    Alternate(Box<Ast>, Box<Ast>),
    Star(Box<Ast>),
    Plus(Box<Ast>),
    Optional(Box<Ast>),
}

pub fn show(ast: &Ast) -> String {
    match ast {
        Ast::Char(c) => c.to_string(),
        Ast::Dot => ".".to_string(),
        Ast::Class { negated, ranges } => {
            let mut s = String::from("[");
            if *negated {
                s.push('^');
            }
            for &(lo, hi) in ranges {
                s.push(lo);
                if lo != hi {
                    s.push('-');
                    s.push(hi);
                }
            }
            s.push(']');
            s
        }
        Ast::Concat(items) => items.iter().map(show).collect(),
        Ast::Alternate(a, b) => format!("{}|{}", show(a), show(b)),
        Ast::Star(a) => format!("{}*", atom(a)),
        Ast::Plus(a) => format!("{}+", atom(a)),
        Ast::Optional(a) => format!("{}?", atom(a)),
    }
}

/// A repeat operator binds to one atom, so anything bigger needs brackets
/// putting back when the tree is printed.
fn atom(ast: &Ast) -> String {
    match ast {
        Ast::Char(_) | Ast::Dot | Ast::Class { .. } => show(ast),
        _ => format!("({})", show(ast)),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    UnexpectedEnd,
    UnclosedGroup(usize),
    StrayParen(usize),
    NothingToRepeat(usize),
    UnclosedClass(usize),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::UnexpectedEnd => write!(f, "pattern ends early"),
            ParseError::UnclosedGroup(i) => write!(f, "unclosed ( at {i}"),
            ParseError::StrayParen(i) => write!(f, "unmatched ) at {i}"),
            ParseError::NothingToRepeat(i) => write!(f, "nothing to repeat at {i}"),
            ParseError::UnclosedClass(i) => write!(f, "unclosed [ at {i}"),
        }
    }
}

pub struct Parser {
    chars: Vec<char>,
    pos: usize,
}

impl Parser {
    pub fn new(pattern: &str) -> Parser {
        Parser { chars: pattern.chars().collect(), pos: 0 }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    /// Loosest binding: everything up to a `|`, then everything after it.
    fn alternate(&mut self) -> Result<Ast, ParseError> {
        let mut left = self.concat()?;
        while self.peek() == Some('|') {
            self.bump();
            let right = self.concat()?;
            left = Ast::Alternate(Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    /// Tighter: a run of repeated atoms, stopping at `|` or `)`.
    fn concat(&mut self) -> Result<Ast, ParseError> {
        let mut items = Vec::new();
        while let Some(c) = self.peek() {
            if c == '|' || c == ')' {
                break;
            }
            items.push(self.repeat()?);
        }
        Ok(Ast::Concat(items))
    }

    /// Tightest: one atom with any number of postfix operators on it.
    fn repeat(&mut self) -> Result<Ast, ParseError> {
        let mut node = self.single()?;
        loop {
            match self.peek() {
                Some('*') => {
                    self.bump();
                    node = Ast::Star(Box::new(node));
                }
                Some('+') => {
                    self.bump();
                    node = Ast::Plus(Box::new(node));
                }
                Some('?') => {
                    self.bump();
                    node = Ast::Optional(Box::new(node));
                }
                _ => return Ok(node),
            }
        }
    }

    fn single(&mut self) -> Result<Ast, ParseError> {
        let start = self.pos;
        match self.bump() {
            None => Err(ParseError::UnexpectedEnd),
            Some('(') => {
                let inner = self.alternate()?;
                if self.bump() != Some(')') {
                    return Err(ParseError::UnclosedGroup(start));
                }
                Ok(inner)
            }
            Some(')') => Err(ParseError::StrayParen(start)),
            Some('.') => Ok(Ast::Dot),
            Some('[') => self.class(start),
            Some('*' | '+' | '?') => Err(ParseError::NothingToRepeat(start)),
            Some('\\') => match self.bump() {
                None => Err(ParseError::UnexpectedEnd),
                Some(c) => Ok(Ast::Char(c)),
            },
            Some(c) => Ok(Ast::Char(c)),
        }
    }

    fn class(&mut self, start: usize) -> Result<Ast, ParseError> {
        let negated = self.peek() == Some('^');
        if negated {
            self.bump();
        }
        let mut ranges = Vec::new();
        loop {
            let lo = match self.bump() {
                None => return Err(ParseError::UnclosedClass(start)),
                Some(']') => break,
                Some(c) => c,
            };
            let dashed = self.peek() == Some('-')
                && self.chars.get(self.pos + 1).is_some_and(|&n| n != ']');
            if dashed {
                self.bump();
                let hi = self.bump().ok_or(ParseError::UnclosedClass(start))?;
                ranges.push((lo, hi));
            } else {
                ranges.push((lo, lo));
            }
        }
        Ok(Ast::Class { negated, ranges })
    }
}

pub fn parse(pattern: &str) -> Result<Ast, ParseError> {
    let mut p = Parser::new(pattern);
    let ast = p.alternate()?;
    if p.pos < p.chars.len() {
        return Err(ParseError::StrayParen(p.pos));
    }
    Ok(ast)
}

#[derive(Debug, Clone, PartialEq)]
pub enum Inst {
    Char(char),
    Any,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Split(usize, usize),
    Jump(usize),
    Match,
}

pub type Program = Vec<Inst>;

pub fn compile(ast: &Ast) -> Program {
    let mut prog = Vec::new();
    emit(ast, &mut prog);
    prog.push(Inst::Match);
    prog
}

fn emit(ast: &Ast, prog: &mut Program) {
    match ast {
        Ast::Char(c) => prog.push(Inst::Char(*c)),
        Ast::Dot => prog.push(Inst::Any),
        Ast::Class { negated, ranges } => {
            prog.push(Inst::Class { negated: *negated, ranges: ranges.clone() })
        }
        Ast::Concat(items) => {
            for item in items {
                emit(item, prog);
            }
        }
        Ast::Alternate(a, b) => {
            //     split left, right
            // left:  <a>
            //     jmp after
            // right: <b>
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let jump = prog.len();
            prog.push(Inst::Jump(0));
            let right = prog.len();
            emit(b, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, right);
            prog[jump] = Inst::Jump(after);
        }
        Ast::Star(a) => {
            // split: split body, after
            // body:  <a>
            //        jmp split
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            prog.push(Inst::Jump(split));
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, after);
        }
        Ast::Plus(a) => {
            // body: <a>
            //       split body, after
            let body = prog.len();
            emit(a, prog);
            let split = prog.len();
            prog.push(Inst::Split(body, split + 1));
        }
        Ast::Optional(a) => {
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, after);
        }
    }
}

pub fn listing(prog: &Program) -> String {
    let mut out = String::new();
    for (i, inst) in prog.iter().enumerate() {
        let text = match inst {
            Inst::Char(c) => format!("char {c:?}"),
            Inst::Any => "any".to_string(),
            Inst::Class { negated, ranges } => {
                format!("class {}{:?}", if *negated { "^" } else { "" }, ranges)
            }
            Inst::Split(a, b) => format!("split {a}, {b}"),
            Inst::Jump(t) => format!("jmp {t}"),
            Inst::Match => "match".to_string(),
        };
        out.push_str(&format!("{i:>3}  {text}\n"));
    }
    out
}

fn in_class(negated: bool, ranges: &[(char, char)], c: char) -> bool {
    ranges.iter().any(|&(lo, hi)| lo <= c && c <= hi) != negated
}

/// Returns whether the whole input matched, and how many instructions were
/// executed getting to that answer.
pub fn backtrack(prog: &Program, input: &[char]) -> (bool, u64) {
    let mut steps = 0u64;
    let hit = walk(prog, input, 0, 0, &mut steps);
    (hit, steps)
}

fn walk(prog: &Program, input: &[char], pc: usize, sp: usize, steps: &mut u64) -> bool {
    *steps += 1;
    match &prog[pc] {
        Inst::Match => sp == input.len(),
        Inst::Char(c) => {
            sp < input.len() && input[sp] == *c && walk(prog, input, pc + 1, sp + 1, steps)
        }
        Inst::Any => sp < input.len() && walk(prog, input, pc + 1, sp + 1, steps),
        Inst::Class { negated, ranges } => {
            sp < input.len()
                && in_class(*negated, ranges, input[sp])
                && walk(prog, input, pc + 1, sp + 1, steps)
        }
        Inst::Split(a, b) => walk(prog, input, *a, sp, steps) || walk(prog, input, *b, sp, steps),
        Inst::Jump(t) => walk(prog, input, *t, sp, steps),
    }
}

/// `(a?)^n a^n`: n optional letters followed by n required ones. Every input
/// of n `a`s matches, and a backtracker has to discover which of the optional
/// letters to give up on.
pub fn pathological(n: usize) -> String {
    "a?".repeat(n) + &"a".repeat(n)
}

/// Follow every Jump and Split now, at this input position, and park the
/// instructions that need a character in `list`. `seen` makes each instruction
/// enter the list at most once per position, which is the whole trick.
fn add(prog: &Program, pc: usize, list: &mut Vec<usize>, seen: &mut [bool], steps: &mut u64) {
    if seen[pc] {
        return;
    }
    seen[pc] = true;
    *steps += 1;
    match &prog[pc] {
        Inst::Jump(t) => add(prog, *t, list, seen, steps),
        Inst::Split(a, b) => {
            add(prog, *a, list, seen, steps);
            add(prog, *b, list, seen, steps);
        }
        _ => list.push(pc),
    }
}

pub fn thompson(prog: &Program, input: &[char]) -> (bool, u64) {
    let mut steps = 0u64;
    let mut clist = Vec::new();
    let mut seen = vec![false; prog.len()];
    add(prog, 0, &mut clist, &mut seen, &mut steps);

    for sp in 0..=input.len() {
        let mut nlist = Vec::new();
        let mut nseen = vec![false; prog.len()];
        for &pc in &clist {
            steps += 1;
            let advance = match &prog[pc] {
                Inst::Match => {
                    if sp == input.len() {
                        return (true, steps);
                    }
                    false
                }
                Inst::Char(c) => sp < input.len() && input[sp] == *c,
                Inst::Any => sp < input.len(),
                Inst::Class { negated, ranges } => {
                    sp < input.len() && in_class(*negated, ranges, input[sp])
                }
                _ => false,
            };
            if advance {
                add(prog, pc + 1, &mut nlist, &mut nseen, &mut steps);
            }
        }
        clist = nlist;
    }
    (false, steps)
}

pub fn run() -> Vec<(usize, u64, u64)> {
    let mut rows = Vec::new();
    for n in [2usize, 4, 6, 8, 10, 12, 14, 16, 18] {
        let prog = compile(&parse(&pathological(n)).expect("pattern parses"));
        let input: Vec<char> = "a".repeat(n).chars().collect();
        let (hit_b, steps_b) = backtrack(&prog, &input);
        let (hit_t, steps_t) = thompson(&prog, &input);
        assert_eq!(hit_b, hit_t, "the engines disagree at n = {n}");
        rows.push((n, steps_b, steps_t));
    }

    println!(" n   backtracking   thompson");
    for &(n, b, t) in &rows {
        println!("{n:2}   {b:>12}   {t:>8}");
    }
    rows
}
```

@hint `{}` asks for `Display`, which is a promise about how a type should look to a user. Nobody can make that promise on behalf of `Vec`.
@hint You want one line per row anyway, with the columns lined up. Loop over `&rows` and print each tuple with its own width specifiers.
@hint `for &(n, b, t) in &rows { println!("{n:2}   {b:>12}   {t:>8}"); }`

@diagnose E0277
``Vec<(usize, u64, u64)>` doesn't implement `std::fmt::Display``, with
the note that it `cannot be formatted with the default formatter`.

`Display` is deliberately not derivable and deliberately not implemented for
containers. It means "the way a user should see this", and there is no answer
to that for a `Vec` that would be right in more than one program: comma
separated, one per line, bracketed. The standard library declines rather than
picking.

`Debug` is the opposite: derivable, implemented for every container, and
explicitly formatted for programmers rather than users. `{:?}` would compile
here. It would also print a wall of tuples, which is not the table.

@diagnose E0308
`expected `u64`, found `usize`` in the assertion. `n` is a `usize`
because it came from an array of them, and the step counts are `u64`.
Comparison operators need both sides to be one type, so cast: `n as u64`. The
bound in the test is `3 * n * n + 50`, which needs the multiplication done in
`u64` to avoid overflowing on larger inputs.

@diagnose E0425
`cannot find value `rows` in this scope`, if the printing loop was
moved above where `rows` is built. The vector has to be complete before it is
printed, so the table comes after the measuring loop, not inside it.

@after
```text
 n   backtracking   thompson
 2             14         21
 6            382        119
10           8190        297
14         163838        555
18        3145726        893
```

At n = 18 the backtracker takes 3,145,726 steps and the simulation takes 893,
which is 3,522 times fewer. At n = 2 the simulation is slower, because
maintaining two lists and a seen-set costs something the backtracker does not
pay. That crossover is real and it is why the comparison is a table.

The assertion is the part that matters: every Thompson row comes in under
`3n^2 + 50`, where the program is 3n + 1 instructions long and the input is n
characters. Program size times input size, and the constant is small. The
backtracker has no bound to assert, which is the point.

This is why `regex` in Rust, `RE2` in C++, and Go's `regexp` all refuse
backreferences. A backreference makes the language non-regular, the state set
stops being bounded by the pattern, and the guarantee this table demonstrates
is gone.

## 8. Which part matched what

@kind fill
@concept exhaustiveness

@expect E0004

A match that says only yes or no is not much use. Give each bracketed
group a number, emit a `Save` instruction at each end of it, and let every
thread carry its own array of slot positions. `Ast` has a `Group` variant now,
and `emit` has not been told what to do with it.

```starter
#[derive(Debug, Clone, PartialEq)]
pub enum Ast {
    Char(char),
    Dot,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Concat(Vec<Ast>),
    Alternate(Box<Ast>, Box<Ast>),
    Star(Box<Ast>),
    Plus(Box<Ast>),
    Optional(Box<Ast>),
    Group(usize, Box<Ast>),
}

pub fn show(ast: &Ast) -> String {
    match ast {
        Ast::Char(c) => c.to_string(),
        Ast::Dot => ".".to_string(),
        Ast::Class { negated, ranges } => {
            let mut s = String::from("[");
            if *negated {
                s.push('^');
            }
            for &(lo, hi) in ranges {
                s.push(lo);
                if lo != hi {
                    s.push('-');
                    s.push(hi);
                }
            }
            s.push(']');
            s
        }
        Ast::Concat(items) => items.iter().map(show).collect(),
        Ast::Alternate(a, b) => format!("{}|{}", show(a), show(b)),
        Ast::Star(a) => format!("{}*", atom(a)),
        Ast::Plus(a) => format!("{}+", atom(a)),
        Ast::Optional(a) => format!("{}?", atom(a)),
        Ast::Group(_, inner) => format!("({})", show(inner)),
    }
}

/// A repeat operator binds to one atom, so anything bigger needs brackets
/// putting back when the tree is printed.
fn atom(ast: &Ast) -> String {
    match ast {
        Ast::Char(_) | Ast::Dot | Ast::Class { .. } | Ast::Group(..) => show(ast),
        _ => format!("({})", show(ast)),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    UnexpectedEnd,
    UnclosedGroup(usize),
    StrayParen(usize),
    NothingToRepeat(usize),
    UnclosedClass(usize),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::UnexpectedEnd => write!(f, "pattern ends early"),
            ParseError::UnclosedGroup(i) => write!(f, "unclosed ( at {i}"),
            ParseError::StrayParen(i) => write!(f, "unmatched ) at {i}"),
            ParseError::NothingToRepeat(i) => write!(f, "nothing to repeat at {i}"),
            ParseError::UnclosedClass(i) => write!(f, "unclosed [ at {i}"),
        }
    }
}

pub struct Parser {
    chars: Vec<char>,
    pos: usize,
    groups: usize,
}

impl Parser {
    pub fn new(pattern: &str) -> Parser {
        Parser { chars: pattern.chars().collect(), pos: 0, groups: 0 }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    /// Loosest binding: everything up to a `|`, then everything after it.
    fn alternate(&mut self) -> Result<Ast, ParseError> {
        let mut left = self.concat()?;
        while self.peek() == Some('|') {
            self.bump();
            let right = self.concat()?;
            left = Ast::Alternate(Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    /// Tighter: a run of repeated atoms, stopping at `|` or `)`.
    fn concat(&mut self) -> Result<Ast, ParseError> {
        let mut items = Vec::new();
        while let Some(c) = self.peek() {
            if c == '|' || c == ')' {
                break;
            }
            items.push(self.repeat()?);
        }
        Ok(Ast::Concat(items))
    }

    /// Tightest: one atom with any number of postfix operators on it.
    fn repeat(&mut self) -> Result<Ast, ParseError> {
        let mut node = self.single()?;
        loop {
            match self.peek() {
                Some('*') => {
                    self.bump();
                    node = Ast::Star(Box::new(node));
                }
                Some('+') => {
                    self.bump();
                    node = Ast::Plus(Box::new(node));
                }
                Some('?') => {
                    self.bump();
                    node = Ast::Optional(Box::new(node));
                }
                _ => return Ok(node),
            }
        }
    }

    fn single(&mut self) -> Result<Ast, ParseError> {
        let start = self.pos;
        match self.bump() {
            None => Err(ParseError::UnexpectedEnd),
            Some('(') => {
                // Numbered in the order the brackets open, so the index has to
                // be taken before the inside is parsed.
                self.groups += 1;
                let index = self.groups;
                let inner = self.alternate()?;
                if self.bump() != Some(')') {
                    return Err(ParseError::UnclosedGroup(start));
                }
                Ok(Ast::Group(index, Box::new(inner)))
            }
            Some(')') => Err(ParseError::StrayParen(start)),
            Some('.') => Ok(Ast::Dot),
            Some('[') => self.class(start),
            Some('*' | '+' | '?') => Err(ParseError::NothingToRepeat(start)),
            Some('\\') => match self.bump() {
                None => Err(ParseError::UnexpectedEnd),
                Some(c) => Ok(Ast::Char(c)),
            },
            Some(c) => Ok(Ast::Char(c)),
        }
    }

    fn class(&mut self, start: usize) -> Result<Ast, ParseError> {
        let negated = self.peek() == Some('^');
        if negated {
            self.bump();
        }
        let mut ranges = Vec::new();
        loop {
            let lo = match self.bump() {
                None => return Err(ParseError::UnclosedClass(start)),
                Some(']') => break,
                Some(c) => c,
            };
            let dashed = self.peek() == Some('-')
                && self.chars.get(self.pos + 1).is_some_and(|&n| n != ']');
            if dashed {
                self.bump();
                let hi = self.bump().ok_or(ParseError::UnclosedClass(start))?;
                ranges.push((lo, hi));
            } else {
                ranges.push((lo, lo));
            }
        }
        Ok(Ast::Class { negated, ranges })
    }
}

pub fn parse(pattern: &str) -> Result<Ast, ParseError> {
    let mut p = Parser::new(pattern);
    let ast = p.alternate()?;
    if p.pos < p.chars.len() {
        return Err(ParseError::StrayParen(p.pos));
    }
    Ok(ast)
}

pub fn group_count(ast: &Ast) -> usize {
    match ast {
        Ast::Group(i, inner) => (*i).max(group_count(inner)),
        Ast::Concat(items) => items.iter().map(group_count).max().unwrap_or(0),
        Ast::Alternate(a, b) => group_count(a).max(group_count(b)),
        Ast::Star(a) | Ast::Plus(a) | Ast::Optional(a) => group_count(a),
        _ => 0,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Inst {
    Char(char),
    Any,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Split(usize, usize),
    Jump(usize),
    Save(usize),
    Match,
}

pub type Program = Vec<Inst>;

pub fn compile(ast: &Ast) -> Program {
    // Slots 0 and 1 hold the extent of the whole match.
    let mut prog = vec![Inst::Save(0)];
    emit(ast, &mut prog);
    prog.push(Inst::Save(1));
    prog.push(Inst::Match);
    prog
}

fn emit(ast: &Ast, prog: &mut Program) {
    match ast {
        Ast::Char(c) => prog.push(Inst::Char(*c)),
        Ast::Dot => prog.push(Inst::Any),
        Ast::Class { negated, ranges } => {
            prog.push(Inst::Class { negated: *negated, ranges: ranges.clone() })
        }
        Ast::Concat(items) => {
            for item in items {
                emit(item, prog);
            }
        }
        Ast::Alternate(a, b) => {
            //     split left, right
            // left:  <a>
            //     jmp after
            // right: <b>
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let jump = prog.len();
            prog.push(Inst::Jump(0));
            let right = prog.len();
            emit(b, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, right);
            prog[jump] = Inst::Jump(after);
        }
        Ast::Star(a) => {
            // split: split body, after
            // body:  <a>
            //        jmp split
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            prog.push(Inst::Jump(split));
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, after);
        }
        Ast::Plus(a) => {
            // body: <a>
            //       split body, after
            let body = prog.len();
            emit(a, prog);
            let split = prog.len();
            prog.push(Inst::Split(body, split + 1));
        }
        Ast::Optional(a) => {
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, after);
        }
    }
}

pub fn listing(prog: &Program) -> String {
    let mut out = String::new();
    for (i, inst) in prog.iter().enumerate() {
        let text = match inst {
            Inst::Char(c) => format!("char {c:?}"),
            Inst::Any => "any".to_string(),
            Inst::Class { negated, ranges } => {
                format!("class {}{:?}", if *negated { "^" } else { "" }, ranges)
            }
            Inst::Split(a, b) => format!("split {a}, {b}"),
            Inst::Jump(t) => format!("jmp {t}"),
            Inst::Save(s) => format!("save {s}"),
            Inst::Match => "match".to_string(),
        };
        out.push_str(&format!("{i:>3}  {text}\n"));
    }
    out
}

fn in_class(negated: bool, ranges: &[(char, char)], c: char) -> bool {
    ranges.iter().any(|&(lo, hi)| lo <= c && c <= hi) != negated
}

/// Returns whether the whole input matched, and how many instructions were
/// executed getting to that answer.
pub fn backtrack(prog: &Program, input: &[char]) -> (bool, u64) {
    let mut steps = 0u64;
    let hit = walk(prog, input, 0, 0, &mut steps);
    (hit, steps)
}

fn walk(prog: &Program, input: &[char], pc: usize, sp: usize, steps: &mut u64) -> bool {
    *steps += 1;
    match &prog[pc] {
        Inst::Match => sp == input.len(),
        Inst::Char(c) => {
            sp < input.len() && input[sp] == *c && walk(prog, input, pc + 1, sp + 1, steps)
        }
        Inst::Any => sp < input.len() && walk(prog, input, pc + 1, sp + 1, steps),
        Inst::Class { negated, ranges } => {
            sp < input.len()
                && in_class(*negated, ranges, input[sp])
                && walk(prog, input, pc + 1, sp + 1, steps)
        }
        Inst::Split(a, b) => walk(prog, input, *a, sp, steps) || walk(prog, input, *b, sp, steps),
        Inst::Jump(t) => walk(prog, input, *t, sp, steps),
        Inst::Save(_) => walk(prog, input, pc + 1, sp, steps),
    }
}

/// `(a?)^n a^n`: n optional letters followed by n required ones. Every input
/// of n `a`s matches, and a backtracker has to discover which of the optional
/// letters to give up on.
pub fn pathological(n: usize) -> String {
    "a?".repeat(n) + &"a".repeat(n)
}

/// Follow every Jump and Split now, at this input position, and park the
/// instructions that need a character in `list`. `seen` makes each instruction
/// enter the list at most once per position, which is the whole trick.
fn add(prog: &Program, pc: usize, list: &mut Vec<usize>, seen: &mut [bool], steps: &mut u64) {
    if seen[pc] {
        return;
    }
    seen[pc] = true;
    *steps += 1;
    match &prog[pc] {
        Inst::Jump(t) => add(prog, *t, list, seen, steps),
        Inst::Split(a, b) => {
            add(prog, *a, list, seen, steps);
            add(prog, *b, list, seen, steps);
        }
        Inst::Save(_) => add(prog, pc + 1, list, seen, steps),
        _ => list.push(pc),
    }
}

pub fn thompson(prog: &Program, input: &[char]) -> (bool, u64) {
    let mut steps = 0u64;
    let mut clist = Vec::new();
    let mut seen = vec![false; prog.len()];
    add(prog, 0, &mut clist, &mut seen, &mut steps);

    for sp in 0..=input.len() {
        let mut nlist = Vec::new();
        let mut nseen = vec![false; prog.len()];
        for &pc in &clist {
            steps += 1;
            let advance = match &prog[pc] {
                Inst::Match => {
                    if sp == input.len() {
                        return (true, steps);
                    }
                    false
                }
                Inst::Char(c) => sp < input.len() && input[sp] == *c,
                Inst::Any => sp < input.len(),
                Inst::Class { negated, ranges } => {
                    sp < input.len() && in_class(*negated, ranges, input[sp])
                }
                _ => false,
            };
            if advance {
                add(prog, pc + 1, &mut nlist, &mut nseen, &mut steps);
            }
        }
        clist = nlist;
    }
    (false, steps)
}

/// The same simulation again, except each thread carries its own slot array
/// and threads are kept in priority order, so the first one to reach Match
/// wins. This is what the regex crate calls the Pike VM.
#[derive(Clone)]
struct Thread {
    pc: usize,
    slots: Vec<Option<usize>>,
}

fn add_saving(
    prog: &Program,
    pc: usize,
    sp: usize,
    slots: &[Option<usize>],
    list: &mut Vec<Thread>,
    seen: &mut [bool],
) {
    if seen[pc] {
        return;
    }
    seen[pc] = true;
    match &prog[pc] {
        Inst::Jump(t) => add_saving(prog, *t, sp, slots, list, seen),
        Inst::Split(a, b) => {
            add_saving(prog, *a, sp, slots, list, seen);
            add_saving(prog, *b, sp, slots, list, seen);
        }
        Inst::Save(slot) => {
            let mut next = slots.to_vec();
            if *slot < next.len() {
                next[*slot] = Some(sp);
            }
            add_saving(prog, pc + 1, sp, &next, list, seen);
        }
        _ => list.push(Thread { pc, slots: slots.to_vec() }),
    }
}

pub fn pike(prog: &Program, input: &[char], nslots: usize) -> Option<Vec<Option<usize>>> {
    let mut clist: Vec<Thread> = Vec::new();
    let mut seen = vec![false; prog.len()];
    add_saving(prog, 0, 0, &vec![None; nslots], &mut clist, &mut seen);

    for sp in 0..=input.len() {
        let mut nlist: Vec<Thread> = Vec::new();
        let mut nseen = vec![false; prog.len()];
        for i in 0..clist.len() {
            let pc = clist[i].pc;
            let advance = match &prog[pc] {
                Inst::Match => {
                    if sp == input.len() {
                        return Some(clist[i].slots.clone());
                    }
                    false
                }
                Inst::Char(c) => sp < input.len() && input[sp] == *c,
                Inst::Any => sp < input.len(),
                Inst::Class { negated, ranges } => {
                    sp < input.len() && in_class(*negated, ranges, input[sp])
                }
                _ => false,
            };
            if advance {
                let slots = clist[i].slots.clone();
                add_saving(prog, pc + 1, sp + 1, &slots, &mut nlist, &mut nseen);
            }
        }
        clist = nlist;
    }
    None
}

pub struct Regex {
    pub prog: Program,
    pub groups: usize,
}

pub fn build(pattern: &str) -> Result<Regex, ParseError> {
    let ast = parse(pattern)?;
    Ok(Regex { prog: compile(&ast), groups: group_count(&ast) })
}

impl Regex {
    pub fn is_match(&self, text: &str) -> bool {
        thompson(&self.prog, &text.chars().collect::<Vec<char>>()).0
    }

    /// Group 0 is the whole match. A group inside an alternative that was not
    /// taken never has its slots filled, so it comes back as None.
    pub fn captures(&self, text: &str) -> Option<Vec<Option<String>>> {
        let input: Vec<char> = text.chars().collect();
        let slots = pike(&self.prog, &input, 2 * (self.groups + 1))?;
        Some(
            (0..=self.groups)
                .map(|g| match (slots[2 * g], slots[2 * g + 1]) {
                    (Some(a), Some(b)) if a <= b => Some(input[a..b].iter().collect()),
                    _ => None,
                })
                .collect(),
        )
    }
}

pub fn run() -> Vec<Option<String>> {
    let re = build(r"([a-z]+)@([a-z]+)\.(com|org)").expect("pattern parses");
    print!("{}", listing(&re.prog));

    let caps = re.captures("ferris@rustlang.org").expect("the address matches");
    for (i, group) in caps.iter().enumerate() {
        println!("group {i}: {group:?}");
    }
    caps
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_groups_come_back_in_source_order() {
        let caps = run();
        assert_eq!(
            caps,
            vec![
                Some("ferris@rustlang.org".to_string()),
                Some("ferris".to_string()),
                Some("rustlang".to_string()),
                Some("org".to_string()),
            ]
        );
    }

    #[test]
    fn a_branch_that_was_not_taken_leaves_its_group_empty() {
        let re = build("(a)|(b)").unwrap();
        assert_eq!(
            re.captures("b"),
            Some(vec![Some("b".to_string()), None, Some("b".to_string())])
        );
        assert_eq!(re.captures("c"), None);
    }

    #[test]
    fn the_first_thread_to_reach_match_wins() {
        // Priority order comes from Split visiting its left target first, so
        // the greedy star takes everything and the second group gets nothing.
        let re = build("(a*)(a*)").unwrap();
        assert_eq!(
            re.captures("aaa"),
            Some(vec![
                Some("aaa".to_string()),
                Some("aaa".to_string()),
                Some("".to_string()),
            ])
        );
    }

    #[test]
    fn saving_slots_did_not_cost_the_linear_bound() {
        let re = build(&pathological(18)).unwrap();
        assert_eq!(re.groups, 0);
        assert!(re.is_match(&"a".repeat(18)));

        let prog = compile(&parse(&pathological(18)).unwrap());
        let input: Vec<char> = "a".repeat(18).chars().collect();
        let (hit, steps) = thompson(&prog, &input);
        assert!(hit);
        assert!(steps < 1000, "{steps}");
    }

    #[test]
    fn nested_groups_still_number_by_the_opening_bracket() {
        let re = build("((a)(b))c").unwrap();
        assert_eq!(re.groups, 3);
        assert_eq!(
            re.captures("abc"),
            Some(vec![
                Some("abc".to_string()),
                Some("ab".to_string()),
                Some("a".to_string()),
                Some("b".to_string()),
            ])
        );
    }
}
```

```solution
#[derive(Debug, Clone, PartialEq)]
pub enum Ast {
    Char(char),
    Dot,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Concat(Vec<Ast>),
    Alternate(Box<Ast>, Box<Ast>),
    Star(Box<Ast>),
    Plus(Box<Ast>),
    Optional(Box<Ast>),
    Group(usize, Box<Ast>),
}

pub fn show(ast: &Ast) -> String {
    match ast {
        Ast::Char(c) => c.to_string(),
        Ast::Dot => ".".to_string(),
        Ast::Class { negated, ranges } => {
            let mut s = String::from("[");
            if *negated {
                s.push('^');
            }
            for &(lo, hi) in ranges {
                s.push(lo);
                if lo != hi {
                    s.push('-');
                    s.push(hi);
                }
            }
            s.push(']');
            s
        }
        Ast::Concat(items) => items.iter().map(show).collect(),
        Ast::Alternate(a, b) => format!("{}|{}", show(a), show(b)),
        Ast::Star(a) => format!("{}*", atom(a)),
        Ast::Plus(a) => format!("{}+", atom(a)),
        Ast::Optional(a) => format!("{}?", atom(a)),
        Ast::Group(_, inner) => format!("({})", show(inner)),
    }
}

/// A repeat operator binds to one atom, so anything bigger needs brackets
/// putting back when the tree is printed.
fn atom(ast: &Ast) -> String {
    match ast {
        Ast::Char(_) | Ast::Dot | Ast::Class { .. } | Ast::Group(..) => show(ast),
        _ => format!("({})", show(ast)),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    UnexpectedEnd,
    UnclosedGroup(usize),
    StrayParen(usize),
    NothingToRepeat(usize),
    UnclosedClass(usize),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::UnexpectedEnd => write!(f, "pattern ends early"),
            ParseError::UnclosedGroup(i) => write!(f, "unclosed ( at {i}"),
            ParseError::StrayParen(i) => write!(f, "unmatched ) at {i}"),
            ParseError::NothingToRepeat(i) => write!(f, "nothing to repeat at {i}"),
            ParseError::UnclosedClass(i) => write!(f, "unclosed [ at {i}"),
        }
    }
}

pub struct Parser {
    chars: Vec<char>,
    pos: usize,
    groups: usize,
}

impl Parser {
    pub fn new(pattern: &str) -> Parser {
        Parser { chars: pattern.chars().collect(), pos: 0, groups: 0 }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    /// Loosest binding: everything up to a `|`, then everything after it.
    fn alternate(&mut self) -> Result<Ast, ParseError> {
        let mut left = self.concat()?;
        while self.peek() == Some('|') {
            self.bump();
            let right = self.concat()?;
            left = Ast::Alternate(Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    /// Tighter: a run of repeated atoms, stopping at `|` or `)`.
    fn concat(&mut self) -> Result<Ast, ParseError> {
        let mut items = Vec::new();
        while let Some(c) = self.peek() {
            if c == '|' || c == ')' {
                break;
            }
            items.push(self.repeat()?);
        }
        Ok(Ast::Concat(items))
    }

    /// Tightest: one atom with any number of postfix operators on it.
    fn repeat(&mut self) -> Result<Ast, ParseError> {
        let mut node = self.single()?;
        loop {
            match self.peek() {
                Some('*') => {
                    self.bump();
                    node = Ast::Star(Box::new(node));
                }
                Some('+') => {
                    self.bump();
                    node = Ast::Plus(Box::new(node));
                }
                Some('?') => {
                    self.bump();
                    node = Ast::Optional(Box::new(node));
                }
                _ => return Ok(node),
            }
        }
    }

    fn single(&mut self) -> Result<Ast, ParseError> {
        let start = self.pos;
        match self.bump() {
            None => Err(ParseError::UnexpectedEnd),
            Some('(') => {
                // Numbered in the order the brackets open, so the index has to
                // be taken before the inside is parsed.
                self.groups += 1;
                let index = self.groups;
                let inner = self.alternate()?;
                if self.bump() != Some(')') {
                    return Err(ParseError::UnclosedGroup(start));
                }
                Ok(Ast::Group(index, Box::new(inner)))
            }
            Some(')') => Err(ParseError::StrayParen(start)),
            Some('.') => Ok(Ast::Dot),
            Some('[') => self.class(start),
            Some('*' | '+' | '?') => Err(ParseError::NothingToRepeat(start)),
            Some('\\') => match self.bump() {
                None => Err(ParseError::UnexpectedEnd),
                Some(c) => Ok(Ast::Char(c)),
            },
            Some(c) => Ok(Ast::Char(c)),
        }
    }

    fn class(&mut self, start: usize) -> Result<Ast, ParseError> {
        let negated = self.peek() == Some('^');
        if negated {
            self.bump();
        }
        let mut ranges = Vec::new();
        loop {
            let lo = match self.bump() {
                None => return Err(ParseError::UnclosedClass(start)),
                Some(']') => break,
                Some(c) => c,
            };
            let dashed = self.peek() == Some('-')
                && self.chars.get(self.pos + 1).is_some_and(|&n| n != ']');
            if dashed {
                self.bump();
                let hi = self.bump().ok_or(ParseError::UnclosedClass(start))?;
                ranges.push((lo, hi));
            } else {
                ranges.push((lo, lo));
            }
        }
        Ok(Ast::Class { negated, ranges })
    }
}

pub fn parse(pattern: &str) -> Result<Ast, ParseError> {
    let mut p = Parser::new(pattern);
    let ast = p.alternate()?;
    if p.pos < p.chars.len() {
        return Err(ParseError::StrayParen(p.pos));
    }
    Ok(ast)
}

pub fn group_count(ast: &Ast) -> usize {
    match ast {
        Ast::Group(i, inner) => (*i).max(group_count(inner)),
        Ast::Concat(items) => items.iter().map(group_count).max().unwrap_or(0),
        Ast::Alternate(a, b) => group_count(a).max(group_count(b)),
        Ast::Star(a) | Ast::Plus(a) | Ast::Optional(a) => group_count(a),
        _ => 0,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Inst {
    Char(char),
    Any,
    Class { negated: bool, ranges: Vec<(char, char)> },
    Split(usize, usize),
    Jump(usize),
    Save(usize),
    Match,
}

pub type Program = Vec<Inst>;

pub fn compile(ast: &Ast) -> Program {
    // Slots 0 and 1 hold the extent of the whole match.
    let mut prog = vec![Inst::Save(0)];
    emit(ast, &mut prog);
    prog.push(Inst::Save(1));
    prog.push(Inst::Match);
    prog
}

fn emit(ast: &Ast, prog: &mut Program) {
    match ast {
        Ast::Char(c) => prog.push(Inst::Char(*c)),
        Ast::Dot => prog.push(Inst::Any),
        Ast::Class { negated, ranges } => {
            prog.push(Inst::Class { negated: *negated, ranges: ranges.clone() })
        }
        Ast::Concat(items) => {
            for item in items {
                emit(item, prog);
            }
        }
        Ast::Alternate(a, b) => {
            //     split left, right
            // left:  <a>
            //     jmp after
            // right: <b>
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let jump = prog.len();
            prog.push(Inst::Jump(0));
            let right = prog.len();
            emit(b, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, right);
            prog[jump] = Inst::Jump(after);
        }
        Ast::Star(a) => {
            // split: split body, after
            // body:  <a>
            //        jmp split
            // after:
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            prog.push(Inst::Jump(split));
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, after);
        }
        Ast::Plus(a) => {
            // body: <a>
            //       split body, after
            let body = prog.len();
            emit(a, prog);
            let split = prog.len();
            prog.push(Inst::Split(body, split + 1));
        }
        Ast::Optional(a) => {
            let split = prog.len();
            prog.push(Inst::Split(0, 0));
            emit(a, prog);
            let after = prog.len();
            prog[split] = Inst::Split(split + 1, after);
        }
        Ast::Group(i, inner) => {
            prog.push(Inst::Save(2 * i));
            emit(inner, prog);
            prog.push(Inst::Save(2 * i + 1));
        }
    }
}

pub fn listing(prog: &Program) -> String {
    let mut out = String::new();
    for (i, inst) in prog.iter().enumerate() {
        let text = match inst {
            Inst::Char(c) => format!("char {c:?}"),
            Inst::Any => "any".to_string(),
            Inst::Class { negated, ranges } => {
                format!("class {}{:?}", if *negated { "^" } else { "" }, ranges)
            }
            Inst::Split(a, b) => format!("split {a}, {b}"),
            Inst::Jump(t) => format!("jmp {t}"),
            Inst::Save(s) => format!("save {s}"),
            Inst::Match => "match".to_string(),
        };
        out.push_str(&format!("{i:>3}  {text}\n"));
    }
    out
}

fn in_class(negated: bool, ranges: &[(char, char)], c: char) -> bool {
    ranges.iter().any(|&(lo, hi)| lo <= c && c <= hi) != negated
}

/// Returns whether the whole input matched, and how many instructions were
/// executed getting to that answer.
pub fn backtrack(prog: &Program, input: &[char]) -> (bool, u64) {
    let mut steps = 0u64;
    let hit = walk(prog, input, 0, 0, &mut steps);
    (hit, steps)
}

fn walk(prog: &Program, input: &[char], pc: usize, sp: usize, steps: &mut u64) -> bool {
    *steps += 1;
    match &prog[pc] {
        Inst::Match => sp == input.len(),
        Inst::Char(c) => {
            sp < input.len() && input[sp] == *c && walk(prog, input, pc + 1, sp + 1, steps)
        }
        Inst::Any => sp < input.len() && walk(prog, input, pc + 1, sp + 1, steps),
        Inst::Class { negated, ranges } => {
            sp < input.len()
                && in_class(*negated, ranges, input[sp])
                && walk(prog, input, pc + 1, sp + 1, steps)
        }
        Inst::Split(a, b) => walk(prog, input, *a, sp, steps) || walk(prog, input, *b, sp, steps),
        Inst::Jump(t) => walk(prog, input, *t, sp, steps),
        Inst::Save(_) => walk(prog, input, pc + 1, sp, steps),
    }
}

/// `(a?)^n a^n`: n optional letters followed by n required ones. Every input
/// of n `a`s matches, and a backtracker has to discover which of the optional
/// letters to give up on.
pub fn pathological(n: usize) -> String {
    "a?".repeat(n) + &"a".repeat(n)
}

/// Follow every Jump and Split now, at this input position, and park the
/// instructions that need a character in `list`. `seen` makes each instruction
/// enter the list at most once per position, which is the whole trick.
fn add(prog: &Program, pc: usize, list: &mut Vec<usize>, seen: &mut [bool], steps: &mut u64) {
    if seen[pc] {
        return;
    }
    seen[pc] = true;
    *steps += 1;
    match &prog[pc] {
        Inst::Jump(t) => add(prog, *t, list, seen, steps),
        Inst::Split(a, b) => {
            add(prog, *a, list, seen, steps);
            add(prog, *b, list, seen, steps);
        }
        Inst::Save(_) => add(prog, pc + 1, list, seen, steps),
        _ => list.push(pc),
    }
}

pub fn thompson(prog: &Program, input: &[char]) -> (bool, u64) {
    let mut steps = 0u64;
    let mut clist = Vec::new();
    let mut seen = vec![false; prog.len()];
    add(prog, 0, &mut clist, &mut seen, &mut steps);

    for sp in 0..=input.len() {
        let mut nlist = Vec::new();
        let mut nseen = vec![false; prog.len()];
        for &pc in &clist {
            steps += 1;
            let advance = match &prog[pc] {
                Inst::Match => {
                    if sp == input.len() {
                        return (true, steps);
                    }
                    false
                }
                Inst::Char(c) => sp < input.len() && input[sp] == *c,
                Inst::Any => sp < input.len(),
                Inst::Class { negated, ranges } => {
                    sp < input.len() && in_class(*negated, ranges, input[sp])
                }
                _ => false,
            };
            if advance {
                add(prog, pc + 1, &mut nlist, &mut nseen, &mut steps);
            }
        }
        clist = nlist;
    }
    (false, steps)
}

/// The same simulation again, except each thread carries its own slot array
/// and threads are kept in priority order, so the first one to reach Match
/// wins. This is what the regex crate calls the Pike VM.
#[derive(Clone)]
struct Thread {
    pc: usize,
    slots: Vec<Option<usize>>,
}

fn add_saving(
    prog: &Program,
    pc: usize,
    sp: usize,
    slots: &[Option<usize>],
    list: &mut Vec<Thread>,
    seen: &mut [bool],
) {
    if seen[pc] {
        return;
    }
    seen[pc] = true;
    match &prog[pc] {
        Inst::Jump(t) => add_saving(prog, *t, sp, slots, list, seen),
        Inst::Split(a, b) => {
            add_saving(prog, *a, sp, slots, list, seen);
            add_saving(prog, *b, sp, slots, list, seen);
        }
        Inst::Save(slot) => {
            let mut next = slots.to_vec();
            if *slot < next.len() {
                next[*slot] = Some(sp);
            }
            add_saving(prog, pc + 1, sp, &next, list, seen);
        }
        _ => list.push(Thread { pc, slots: slots.to_vec() }),
    }
}

pub fn pike(prog: &Program, input: &[char], nslots: usize) -> Option<Vec<Option<usize>>> {
    let mut clist: Vec<Thread> = Vec::new();
    let mut seen = vec![false; prog.len()];
    add_saving(prog, 0, 0, &vec![None; nslots], &mut clist, &mut seen);

    for sp in 0..=input.len() {
        let mut nlist: Vec<Thread> = Vec::new();
        let mut nseen = vec![false; prog.len()];
        for i in 0..clist.len() {
            let pc = clist[i].pc;
            let advance = match &prog[pc] {
                Inst::Match => {
                    if sp == input.len() {
                        return Some(clist[i].slots.clone());
                    }
                    false
                }
                Inst::Char(c) => sp < input.len() && input[sp] == *c,
                Inst::Any => sp < input.len(),
                Inst::Class { negated, ranges } => {
                    sp < input.len() && in_class(*negated, ranges, input[sp])
                }
                _ => false,
            };
            if advance {
                let slots = clist[i].slots.clone();
                add_saving(prog, pc + 1, sp + 1, &slots, &mut nlist, &mut nseen);
            }
        }
        clist = nlist;
    }
    None
}

pub struct Regex {
    pub prog: Program,
    pub groups: usize,
}

pub fn build(pattern: &str) -> Result<Regex, ParseError> {
    let ast = parse(pattern)?;
    Ok(Regex { prog: compile(&ast), groups: group_count(&ast) })
}

impl Regex {
    pub fn is_match(&self, text: &str) -> bool {
        thompson(&self.prog, &text.chars().collect::<Vec<char>>()).0
    }

    /// Group 0 is the whole match. A group inside an alternative that was not
    /// taken never has its slots filled, so it comes back as None.
    pub fn captures(&self, text: &str) -> Option<Vec<Option<String>>> {
        let input: Vec<char> = text.chars().collect();
        let slots = pike(&self.prog, &input, 2 * (self.groups + 1))?;
        Some(
            (0..=self.groups)
                .map(|g| match (slots[2 * g], slots[2 * g + 1]) {
                    (Some(a), Some(b)) if a <= b => Some(input[a..b].iter().collect()),
                    _ => None,
                })
                .collect(),
        )
    }
}

pub fn run() -> Vec<Option<String>> {
    let re = build(r"([a-z]+)@([a-z]+)\.(com|org)").expect("pattern parses");
    print!("{}", listing(&re.prog));

    let caps = re.captures("ferris@rustlang.org").expect("the address matches");
    for (i, group) in caps.iter().enumerate() {
        println!("group {i}: {group:?}");
    }
    caps
}
```

@hint Group `i` writes the current input position into slot `2i` on the way in and slot `2i + 1` on the way out. Slots 0 and 1 are the whole match, so groups start at 1.
@hint The arm emits a `Save`, then the contents, then another `Save`. Nothing else about the group survives into the program.
@hint `prog.push(Inst::Save(2 * i)); emit(inner, prog); prog.push(Inst::Save(2 * i + 1));`

@diagnose E0004
`non-exhaustive patterns: `&Ast::Group(_, _)` not covered`, naming
the variant that was added to the enum.

This is the refactoring property that makes enums worth using. A new variant
turned every `match` on `Ast` into a compile error until it was handled, and
the compiler listed them. `show`, `atom` and `group_count` were updated with
it; `emit` is the one left, and no test had to catch that.

Take the suggested `_ => todo!()` and you throw the property away for every
variant added after this one. Write the real arm.

@diagnose E0308
`expected `usize`, found `&usize``. The `Group` variant holds its
index by value but the `match` binds by reference, so `i` is a `&usize`.
`2 * i` works through auto-deref on the operator, but `Inst::Save(2 * i)` needs
a `usize`, so write `*i` or dereference in the arithmetic.

@diagnose E0277
`cannot multiply `&usize` by `{integer}`` in some arrangements of the
same problem. Operators are traits, and the implementations for references are
there but do not cover every combination. `*i` first, then the arithmetic is
ordinary `usize` arithmetic.

@after
The simulation did not change shape. Threads still enter a list at most
once per position, so the linear bound survives, which the last test checks by
running the pathological pattern again. What each thread now carries is a slot
array, cloned when it forks. That clone is the cost of captures, and it is why
`regex` in Rust runs a match-only engine first and only re-runs the Pike VM on
the span that matched.

Priority is what makes `(a*)(a*)` against `aaa` give `aaa` and then the empty
string rather than some other split. `add_saving` visits a `Split`'s first
target before its second, threads keep that order in the list, and the first
thread to reach `Match` is the one whose answer is returned. Greedy repetition
falls out of the order the targets were emitted in, and swapping them in the
`Star` arm would make every star lazy.

Two hundred and fifty lines, and the guarantee holds: pattern size times input
size, for every pattern, with no timeout and no step budget anywhere in the
file. Search inside a string rather than matching all of it by compiling
`(?s:.)*?` in front of the program. A lazy DFA on top, which caches each set of
active instructions as a single state, is how the real crates get to roughly
one table lookup per byte, and it is built directly on the list you wrote in
stage 6.
