---
project: json-parser
tier: core
domain: languages
title: A JSON parser
accent: moss
blurb: Eight stages from an enum to a program that reads a real document, reports the character an error sits on, and prints back what it parsed.
needs: 09-enums, 10-option, 12-errors
mins: 70
---

A JSON value is one of six things. It is null, or a boolean, or a number, or a
string, or an ordered list of values, or an ordered set of name-and-value pairs.
That sentence is a type in Rust, written in nine lines, and the rest of the
parser falls out of it.

That is why this is the first project. In a language without sum types you
model a JSON value as a class hierarchy, or a tagged struct with five nullable
fields, or a dictionary of `Any`. All three work and all three leak: nothing
stops an "array" carrying a number payload, and nothing tells you when you have
forgotten to handle objects in the printer you wrote last month. Here the enum
holds exactly one shape at a time, and every `match` over it is checked against
the full list of variants.

You will build a recursive-descent parser, which is the same design `serde_json`
uses and the same design behind most hand-written compilers. A lexer walks the
characters and produces tokens. A parser reads tokens and produces values,
calling itself when a value turns out to contain other values. Errors come back
as a `Result` carrying the character position, so a bad document tells you where
it went wrong rather than panicking.

By stage eight you will have around 300 lines that parse a document with nested
objects, arrays, escapes including `\u`, and numbers in exponent form, then
print the result back as JSON that parses to the same value.

What the real thing adds: streaming from a reader instead of a `String`, integer
and float kept apart so that large integers survive, surrogate-pair handling for
characters outside the basic multilingual plane, a hash map for objects with
large key counts, and derive macros that map values onto your own structs. The
grammar, though, is the grammar you are about to write.

## 1. Six things and only one at a time

@kind fix
@concept enum
@expect E0004

The `Value` enum is already written and it is the whole data model. Two methods
are not. `type_name` names the variant, and `count` says how many values the
tree holds in total, counting containers themselves. Make both work.

```starter
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    Str(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    pub fn type_name(&self) -> &'static str {
        match self {
            Value::Null => "null",
            Value::Bool(_) => "bool",
            Value::Number(_) => "number",
            Value::Str(_) => "string",
        }
    }

    pub fn count(&self) -> usize {
        todo!("one for this value, plus the count of everything inside it")
    }
}

pub fn sample() -> Value {
    Value::Object(vec![
        ("name".to_string(), Value::Str("ferris".to_string())),
        ("id".to_string(), Value::Number(42.0)),
        (
            "tags".to_string(),
            Value::Array(vec![
                Value::Str("rust".to_string()),
                Value::Bool(true),
                Value::Null,
            ]),
        ),
    ])
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_every_kind() {
        assert_eq!(Value::Null.type_name(), "null");
        assert_eq!(Value::Number(1.0).type_name(), "number");
        assert_eq!(Value::Array(Vec::new()).type_name(), "array");
        assert_eq!(sample().type_name(), "object");
    }

    #[test]
    fn counts_the_whole_tree() {
        assert_eq!(Value::Null.count(), 1);
        assert_eq!(sample().count(), 7);
        println!("{:?}", sample());
    }
}
```

```solution
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    Str(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    pub fn type_name(&self) -> &'static str {
        match self {
            Value::Null => "null",
            Value::Bool(_) => "bool",
            Value::Number(_) => "number",
            Value::Str(_) => "string",
            Value::Array(_) => "array",
            Value::Object(_) => "object",
        }
    }

    pub fn count(&self) -> usize {
        match self {
            Value::Array(items) => 1 + items.iter().map(|v| v.count()).sum::<usize>(),
            Value::Object(members) => 1 + members.iter().map(|(_, v)| v.count()).sum::<usize>(),
            _ => 1,
        }
    }
}

pub fn sample() -> Value {
    Value::Object(vec![
        ("name".to_string(), Value::Str("ferris".to_string())),
        ("id".to_string(), Value::Number(42.0)),
        (
            "tags".to_string(),
            Value::Array(vec![
                Value::Str("rust".to_string()),
                Value::Bool(true),
                Value::Null,
            ]),
        ),
    ])
}
```

@hint Two variants have no arm. rustc names both of them in the error.
@hint `count` is recursive because the type is recursive. An array of three scalars is four values: the array plus its three items.
@hint `1 + items.iter().map(|v| v.count()).sum::<usize>()` for the array arm, the same shape over `(_, v)` for the object arm, and `_ => 1` for every scalar.

@diagnose E0004
`non-exhaustive patterns: Value::Array(_) and Value::Object(_) not covered`. The
match has to produce a `&'static str` for every possible `Value`, and two
variants have nowhere to go.

Look at where rustc puts the underline: on `self`, the scrutinee, not on any of
the arms. It is not saying an arm is wrong. It is saying the set of arms is
incomplete, and it computed which ones are missing from the enum definition
rather than guessing.

Adding `_ => "other"` would also compile and would be the wrong fix here. A
catch-all switches this check off permanently, so the day someone adds a
seventh variant this function silently reports it as "other" instead of failing
to build.

@after
The recursion in `count` is the shape of everything that follows. A parser for
this type is a function that calls itself, because the type contains itself.

Worth knowing why the enum compiles at all. `Value::Array(Value)` would not:
rustc would reject it with `error[E0072]: recursive type Value has infinite
size`, because computing the size of `Value` would require already knowing the
size of `Value`. `Vec<Value>` breaks that loop, since a `Vec` is three words on
the stack whatever it points at. For a variant holding exactly one nested value,
`Box<Value>` does the same job for one word.

## 2. Characters in, tokens out

@kind fix
@concept lexer
@expect E0308

A lexer turns a run of characters into tokens, so the parser never has to think
about whitespace or spelling. This one tracks its position for error messages,
which is why `ParseError` exists already.

`next_token` handles two characters and returns the wrong type. Finish it. It
knows nothing about strings or numbers yet, and that is fine.

```starter
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    Str(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    pub fn type_name(&self) -> &'static str {
        match self {
            Value::Null => "null",
            Value::Bool(_) => "bool",
            Value::Number(_) => "number",
            Value::Str(_) => "string",
            Value::Array(_) => "array",
            Value::Object(_) => "object",
        }
    }

    pub fn count(&self) -> usize {
        match self {
            Value::Array(items) => 1 + items.iter().map(|v| v.count()).sum::<usize>(),
            Value::Object(members) => 1 + members.iter().map(|(_, v)| v.count()).sum::<usize>(),
            _ => 1,
        }
    }
}

pub fn sample() -> Value {
    Value::Object(vec![
        ("name".to_string(), Value::Str("ferris".to_string())),
        ("id".to_string(), Value::Number(42.0)),
        (
            "tags".to_string(),
            Value::Array(vec![
                Value::Str("rust".to_string()),
                Value::Bool(true),
                Value::Null,
            ]),
        ),
    ])
}

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Colon,
    Comma,
    Null,
    True,
    False,
    Num(f64),
    Str(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParseError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at character {}", self.msg, self.pos)
    }
}

impl std::error::Error for ParseError {}

pub struct Lexer {
    src: Vec<char>,
    pos: usize,
}

impl Lexer {
    pub fn new(input: &str) -> Lexer {
        Lexer { src: input.chars().collect(), pos: 0 }
    }

    pub fn pos(&self) -> usize {
        self.pos
    }

    fn peek(&self) -> Option<char> {
        self.src.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    fn err<T>(&self, msg: &str) -> Result<T, ParseError> {
        Err(ParseError { pos: self.pos, msg: msg.to_string() })
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(' ') | Some('\t') | Some('\n') | Some('\r')) {
            self.pos += 1;
        }
    }

    fn keyword(&mut self, word: &str, tok: Token) -> Result<Token, ParseError> {
        for want in word.chars() {
            if self.bump() != Some(want) {
                return self.err(&format!("expected `{word}`"));
            }
        }
        Ok(tok)
    }

    pub fn next_token(&mut self) -> Result<Option<Token>, ParseError> {
        self.skip_ws();
        let c = match self.peek() {
            Some(c) => c,
            None => return Ok(None),
        };
        let tok = match c {
            '{' => { self.pos += 1; Token::LBrace }
            '}' => { self.pos += 1; Token::RBrace }
            other => return self.err(&format!("unexpected character `{other}`")),
        };
        tok
    }
}

pub fn tokenize(input: &str) -> Result<Vec<Token>, ParseError> {
    let mut lex = Lexer::new(input);
    let mut out = Vec::new();
    while let Some(t) = lex.next_token()? {
        out.push(t);
    }
    Ok(out)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lexes_structure_and_keywords() {
        let toks = tokenize(" [ { } : , null true false ] ").unwrap();
        assert_eq!(
            toks,
            vec![
                Token::LBracket,
                Token::LBrace,
                Token::RBrace,
                Token::Colon,
                Token::Comma,
                Token::Null,
                Token::True,
                Token::False,
                Token::RBracket,
            ]
        );
        println!("{toks:?}");
    }

    #[test]
    fn empty_input_yields_no_tokens() {
        assert_eq!(tokenize("   \n\t ").unwrap(), Vec::new());
    }

    #[test]
    fn a_bad_character_carries_its_position() {
        let e = tokenize("[ ~ ]").unwrap_err();
        assert_eq!(e.pos, 2);
        assert_eq!(e.to_string(), "unexpected character `~` at character 2");
    }

    #[test]
    fn a_misspelled_keyword_is_rejected() {
        assert!(tokenize("nul").is_err());
    }
}
```

```solution
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    Str(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    pub fn type_name(&self) -> &'static str {
        match self {
            Value::Null => "null",
            Value::Bool(_) => "bool",
            Value::Number(_) => "number",
            Value::Str(_) => "string",
            Value::Array(_) => "array",
            Value::Object(_) => "object",
        }
    }

    pub fn count(&self) -> usize {
        match self {
            Value::Array(items) => 1 + items.iter().map(|v| v.count()).sum::<usize>(),
            Value::Object(members) => 1 + members.iter().map(|(_, v)| v.count()).sum::<usize>(),
            _ => 1,
        }
    }
}

pub fn sample() -> Value {
    Value::Object(vec![
        ("name".to_string(), Value::Str("ferris".to_string())),
        ("id".to_string(), Value::Number(42.0)),
        (
            "tags".to_string(),
            Value::Array(vec![
                Value::Str("rust".to_string()),
                Value::Bool(true),
                Value::Null,
            ]),
        ),
    ])
}

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Colon,
    Comma,
    Null,
    True,
    False,
    Num(f64),
    Str(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParseError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at character {}", self.msg, self.pos)
    }
}

impl std::error::Error for ParseError {}

pub struct Lexer {
    src: Vec<char>,
    pos: usize,
}

impl Lexer {
    pub fn new(input: &str) -> Lexer {
        Lexer { src: input.chars().collect(), pos: 0 }
    }

    pub fn pos(&self) -> usize {
        self.pos
    }

    fn peek(&self) -> Option<char> {
        self.src.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    fn err<T>(&self, msg: &str) -> Result<T, ParseError> {
        Err(ParseError { pos: self.pos, msg: msg.to_string() })
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(' ') | Some('\t') | Some('\n') | Some('\r')) {
            self.pos += 1;
        }
    }

    fn keyword(&mut self, word: &str, tok: Token) -> Result<Token, ParseError> {
        for want in word.chars() {
            if self.bump() != Some(want) {
                return self.err(&format!("expected `{word}`"));
            }
        }
        Ok(tok)
    }

    pub fn next_token(&mut self) -> Result<Option<Token>, ParseError> {
        self.skip_ws();
        let c = match self.peek() {
            Some(c) => c,
            None => return Ok(None),
        };
        let tok = match c {
            '{' => { self.pos += 1; Token::LBrace }
            '}' => { self.pos += 1; Token::RBrace }
            '[' => { self.pos += 1; Token::LBracket }
            ']' => { self.pos += 1; Token::RBracket }
            ':' => { self.pos += 1; Token::Colon }
            ',' => { self.pos += 1; Token::Comma }
            'n' => self.keyword("null", Token::Null)?,
            't' => self.keyword("true", Token::True)?,
            'f' => self.keyword("false", Token::False)?,
            other => return self.err(&format!("unexpected character `{other}`")),
        };
        Ok(Some(tok))
    }
}

pub fn tokenize(input: &str) -> Result<Vec<Token>, ParseError> {
    let mut lex = Lexer::new(input);
    let mut out = Vec::new();
    while let Some(t) = lex.next_token()? {
        out.push(t);
    }
    Ok(out)
}
```

@hint The return type says three things at once: it can fail, it can run out of input, and otherwise it has a token.
@hint `Ok(None)` already covers "no more input". The tail expression has to cover "here is a token".
@hint `Ok(Some(tok))`. Then add the four remaining punctuation characters and three `self.keyword(...)` calls for `null`, `true` and `false`.

@diagnose E0308
`expected Result<Option<Token>, ParseError>, found Token`. The match produced a
`Token` and the function promised a `Result<Option<Token>, ParseError>`, so the
tail expression is two layers short.

The three layers are each carrying one fact. `Result` says the lexer can fail on
a character it does not recognise. `Option` says it can legitimately run out of
input, which is not a failure. `Token` is the answer when neither of those
happened. Wrapping is how you say "no error, not the end, here it is":
`Ok(Some(tok))`.

Getting the nesting backwards gives the same error with the layers swapped.
`Option` goes inside, because running out of input is a normal outcome and only
`Result` should short-circuit a `?`.

@diagnose E0004
Your match on `c` has no catch-all. `char` has more than a million values and
you have listed a handful, so rustc wants an arm for the rest. Keep the
`other => return self.err(...)` arm at the bottom; unlike an enum, an open set
like `char` genuinely needs one.

@after
The `src: Vec<char>` is a deliberate simplification and worth naming. Real
lexers index into `&[u8]` and decode UTF-8 as they go, which avoids allocating a
vector the size of the document. Collecting to `Vec<char>` costs four bytes per
character and one pass up front, and buys you `self.src[i]` with no chance of
splitting a multi-byte character in half.

The position it reports is therefore a character index, not a byte offset.
`serde_json` reports line and column, which it tracks by counting newlines in
the same loop that skips whitespace.

## 3. Strings, and the seven escapes plus one

@kind fix
@concept option
@expect E0277

JSON strings carry escapes: the obvious `\n` and `\"`, and `\uXXXX` for an
arbitrary code point. `lex_string` is written apart from one line that does not
compile and one escape it does not know. `lex_unicode` is not written at all.

Four hex digits, most significant first.

```starter
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    Str(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    pub fn type_name(&self) -> &'static str {
        match self {
            Value::Null => "null",
            Value::Bool(_) => "bool",
            Value::Number(_) => "number",
            Value::Str(_) => "string",
            Value::Array(_) => "array",
            Value::Object(_) => "object",
        }
    }

    pub fn count(&self) -> usize {
        match self {
            Value::Array(items) => 1 + items.iter().map(|v| v.count()).sum::<usize>(),
            Value::Object(members) => 1 + members.iter().map(|(_, v)| v.count()).sum::<usize>(),
            _ => 1,
        }
    }
}

pub fn sample() -> Value {
    Value::Object(vec![
        ("name".to_string(), Value::Str("ferris".to_string())),
        ("id".to_string(), Value::Number(42.0)),
        (
            "tags".to_string(),
            Value::Array(vec![
                Value::Str("rust".to_string()),
                Value::Bool(true),
                Value::Null,
            ]),
        ),
    ])
}

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Colon,
    Comma,
    Null,
    True,
    False,
    Num(f64),
    Str(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParseError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at character {}", self.msg, self.pos)
    }
}

impl std::error::Error for ParseError {}

pub struct Lexer {
    src: Vec<char>,
    pos: usize,
}

impl Lexer {
    pub fn new(input: &str) -> Lexer {
        Lexer { src: input.chars().collect(), pos: 0 }
    }

    pub fn pos(&self) -> usize {
        self.pos
    }

    fn peek(&self) -> Option<char> {
        self.src.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    fn err<T>(&self, msg: &str) -> Result<T, ParseError> {
        Err(ParseError { pos: self.pos, msg: msg.to_string() })
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(' ') | Some('\t') | Some('\n') | Some('\r')) {
            self.pos += 1;
        }
    }

    fn keyword(&mut self, word: &str, tok: Token) -> Result<Token, ParseError> {
        for want in word.chars() {
            if self.bump() != Some(want) {
                return self.err(&format!("expected `{word}`"));
            }
        }
        Ok(tok)
    }

    fn lex_unicode(&mut self) -> Result<char, ParseError> {
        todo!("read four hex digits, build a u32, turn it into a char")
    }

    fn lex_string(&mut self) -> Result<String, ParseError> {
        self.pos += 1;
        let mut out = String::new();
        loop {
            let c = self.bump()?;
            match c {
                '"' => return Ok(out),
                '\\' => {
                    let e = match self.bump() {
                        Some(e) => e,
                        None => return self.err("unterminated escape"),
                    };
                    match e {
                        '"' => out.push('"'),
                        '\\' => out.push('\\'),
                        '/' => out.push('/'),
                        'b' => out.push('\u{8}'),
                        'f' => out.push('\u{c}'),
                        'n' => out.push('\n'),
                        'r' => out.push('\r'),
                        't' => out.push('\t'),
                        other => return self.err(&format!("unknown escape `\\{other}`")),
                    }
                }
                c => out.push(c),
            }
        }
    }

    pub fn next_token(&mut self) -> Result<Option<Token>, ParseError> {
        self.skip_ws();
        let c = match self.peek() {
            Some(c) => c,
            None => return Ok(None),
        };
        let tok = match c {
            '{' => { self.pos += 1; Token::LBrace }
            '}' => { self.pos += 1; Token::RBrace }
            '[' => { self.pos += 1; Token::LBracket }
            ']' => { self.pos += 1; Token::RBracket }
            ':' => { self.pos += 1; Token::Colon }
            ',' => { self.pos += 1; Token::Comma }
            'n' => self.keyword("null", Token::Null)?,
            't' => self.keyword("true", Token::True)?,
            'f' => self.keyword("false", Token::False)?,
            '"' => Token::Str(self.lex_string()?),
            other => return self.err(&format!("unexpected character `{other}`")),
        };
        Ok(Some(tok))
    }
}

pub fn tokenize(input: &str) -> Result<Vec<Token>, ParseError> {
    let mut lex = Lexer::new(input);
    let mut out = Vec::new();
    while let Some(t) = lex.next_token()? {
        out.push(t);
    }
    Ok(out)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_strings() {
        assert_eq!(
            tokenize(r#""ferris" "" "a b""#).unwrap(),
            vec![
                Token::Str("ferris".to_string()),
                Token::Str(String::new()),
                Token::Str("a b".to_string()),
            ]
        );
    }

    #[test]
    fn the_simple_escapes() {
        let toks = tokenize(r#""a\nb\tc\\d\"e\/f""#).unwrap();
        assert_eq!(toks, vec![Token::Str("a\nb\tc\\d\"e/f".to_string())]);
        println!("{toks:?}");
    }

    #[test]
    fn four_hex_digits() {
        assert_eq!(
            tokenize(r#""A❤""#).unwrap(),
            vec![Token::Str("A\u{2764}".to_string())]
        );
    }

    #[test]
    fn broken_strings_are_errors_not_panics() {
        assert!(tokenize(r#""no end"#).is_err());
        assert!(tokenize(r#""\q""#).is_err());
        assert!(tokenize(r#""\u00ZZ""#).is_err());
        assert!(tokenize(r#""\u12""#).is_err());
    }
}
```

```solution
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    Str(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    pub fn type_name(&self) -> &'static str {
        match self {
            Value::Null => "null",
            Value::Bool(_) => "bool",
            Value::Number(_) => "number",
            Value::Str(_) => "string",
            Value::Array(_) => "array",
            Value::Object(_) => "object",
        }
    }

    pub fn count(&self) -> usize {
        match self {
            Value::Array(items) => 1 + items.iter().map(|v| v.count()).sum::<usize>(),
            Value::Object(members) => 1 + members.iter().map(|(_, v)| v.count()).sum::<usize>(),
            _ => 1,
        }
    }
}

pub fn sample() -> Value {
    Value::Object(vec![
        ("name".to_string(), Value::Str("ferris".to_string())),
        ("id".to_string(), Value::Number(42.0)),
        (
            "tags".to_string(),
            Value::Array(vec![
                Value::Str("rust".to_string()),
                Value::Bool(true),
                Value::Null,
            ]),
        ),
    ])
}

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Colon,
    Comma,
    Null,
    True,
    False,
    Num(f64),
    Str(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParseError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at character {}", self.msg, self.pos)
    }
}

impl std::error::Error for ParseError {}

pub struct Lexer {
    src: Vec<char>,
    pos: usize,
}

impl Lexer {
    pub fn new(input: &str) -> Lexer {
        Lexer { src: input.chars().collect(), pos: 0 }
    }

    pub fn pos(&self) -> usize {
        self.pos
    }

    fn peek(&self) -> Option<char> {
        self.src.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    fn err<T>(&self, msg: &str) -> Result<T, ParseError> {
        Err(ParseError { pos: self.pos, msg: msg.to_string() })
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(' ') | Some('\t') | Some('\n') | Some('\r')) {
            self.pos += 1;
        }
    }

    fn keyword(&mut self, word: &str, tok: Token) -> Result<Token, ParseError> {
        for want in word.chars() {
            if self.bump() != Some(want) {
                return self.err(&format!("expected `{word}`"));
            }
        }
        Ok(tok)
    }

    fn lex_unicode(&mut self) -> Result<char, ParseError> {
        let mut n: u32 = 0;
        for _ in 0..4 {
            let c = match self.bump() {
                Some(c) => c,
                None => return self.err("`\\u` needs four hex digits"),
            };
            match c.to_digit(16) {
                Some(d) => n = n * 16 + d,
                None => return self.err("`\\u` needs four hex digits"),
            }
        }
        match char::from_u32(n) {
            Some(c) => Ok(c),
            None => self.err("`\\u` escape is not a character"),
        }
    }

    fn lex_string(&mut self) -> Result<String, ParseError> {
        self.pos += 1;
        let mut out = String::new();
        loop {
            let c = match self.bump() {
                Some(c) => c,
                None => return self.err("unterminated string"),
            };
            match c {
                '"' => return Ok(out),
                '\\' => {
                    let e = match self.bump() {
                        Some(e) => e,
                        None => return self.err("unterminated escape"),
                    };
                    match e {
                        '"' => out.push('"'),
                        '\\' => out.push('\\'),
                        '/' => out.push('/'),
                        'b' => out.push('\u{8}'),
                        'f' => out.push('\u{c}'),
                        'n' => out.push('\n'),
                        'r' => out.push('\r'),
                        't' => out.push('\t'),
                        'u' => {
                            let ch = self.lex_unicode()?;
                            out.push(ch);
                        }
                        other => return self.err(&format!("unknown escape `\\{other}`")),
                    }
                }
                c => out.push(c),
            }
        }
    }

    pub fn next_token(&mut self) -> Result<Option<Token>, ParseError> {
        self.skip_ws();
        let c = match self.peek() {
            Some(c) => c,
            None => return Ok(None),
        };
        let tok = match c {
            '{' => { self.pos += 1; Token::LBrace }
            '}' => { self.pos += 1; Token::RBrace }
            '[' => { self.pos += 1; Token::LBracket }
            ']' => { self.pos += 1; Token::RBracket }
            ':' => { self.pos += 1; Token::Colon }
            ',' => { self.pos += 1; Token::Comma }
            'n' => self.keyword("null", Token::Null)?,
            't' => self.keyword("true", Token::True)?,
            'f' => self.keyword("false", Token::False)?,
            '"' => Token::Str(self.lex_string()?),
            other => return self.err(&format!("unexpected character `{other}`")),
        };
        Ok(Some(tok))
    }
}

pub fn tokenize(input: &str) -> Result<Vec<Token>, ParseError> {
    let mut lex = Lexer::new(input);
    let mut out = Vec::new();
    while let Some(t) = lex.next_token()? {
        out.push(t);
    }
    Ok(out)
}
```

@hint Running out of characters mid-string is a real failure with a position, not a `None` that some caller will interpret. The escape branch a few lines below already handles it the right way.
@hint `char::to_digit(16)` turns `'a'` into `Some(10)` and `'z'` into `None`, so it does the validation for you.
@hint Build the number with `n = n * 16 + d`, then `char::from_u32(n)` to finish. Both the digit and the conversion can fail, so both need a `None` arm that calls `self.err(...)`.

@diagnose E0277
`the ? operator can only be used on Results, not Options, in a function that
returns Result`. `bump` gives back an `Option<char>`, and `?` on an `Option`
wants to return `None` from the enclosing function. This function returns
`Result<String, ParseError>`, so there is nothing for `None` to become.

That mismatch is the useful part. `None` from `bump` here means the document
ended in the middle of a string, which is a real error with a character
position. The compiler is refusing to let you throw that information away.

Write the `match` out, as the escape branch below already does, and give the
`None` arm a message. `ok_or_else` composes the same fix into one expression if
you prefer it.

@diagnose E0004
The inner `match e` covers a set of `char` values and has no catch-all. Keep the
`other => return self.err(...)` arm and put the new `'u'` arm above it.

@after
`\u` handles one code point in the range `U+0000` to `U+FFFF`, which is what
`char::from_u32` accepts minus the surrogate range `U+D800` to `U+DFFF`.
Characters above `U+FFFF` are written in JSON as a surrogate *pair*, two `\u`
escapes in a row, and this parser rejects the first half of one rather than
combining them. `serde_json` reads the second escape and recombines the pair.

The rejection is at least correct behaviour rather than a silent replacement
character, which is what a naive `from_u32(n).unwrap_or('?')` would have given
you.

## 4. Numbers, including the exponent

@kind fix
@concept lexer
@expect E0599

JSON numbers are an optional minus, digits, an optional fraction, and an
optional exponent: `-0.5`, `42`, `1.5e3`, `2E-8`. `lex_number` scans the sign
and the digits, then fails to turn what it scanned into an `f64`.

Fix the conversion and extend the scan so that fractions and exponents survive.

```starter
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    Str(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    pub fn type_name(&self) -> &'static str {
        match self {
            Value::Null => "null",
            Value::Bool(_) => "bool",
            Value::Number(_) => "number",
            Value::Str(_) => "string",
            Value::Array(_) => "array",
            Value::Object(_) => "object",
        }
    }

    pub fn count(&self) -> usize {
        match self {
            Value::Array(items) => 1 + items.iter().map(|v| v.count()).sum::<usize>(),
            Value::Object(members) => 1 + members.iter().map(|(_, v)| v.count()).sum::<usize>(),
            _ => 1,
        }
    }
}

pub fn sample() -> Value {
    Value::Object(vec![
        ("name".to_string(), Value::Str("ferris".to_string())),
        ("id".to_string(), Value::Number(42.0)),
        (
            "tags".to_string(),
            Value::Array(vec![
                Value::Str("rust".to_string()),
                Value::Bool(true),
                Value::Null,
            ]),
        ),
    ])
}

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Colon,
    Comma,
    Null,
    True,
    False,
    Num(f64),
    Str(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParseError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at character {}", self.msg, self.pos)
    }
}

impl std::error::Error for ParseError {}

pub struct Lexer {
    src: Vec<char>,
    pos: usize,
}

impl Lexer {
    pub fn new(input: &str) -> Lexer {
        Lexer { src: input.chars().collect(), pos: 0 }
    }

    pub fn pos(&self) -> usize {
        self.pos
    }

    fn peek(&self) -> Option<char> {
        self.src.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    fn err<T>(&self, msg: &str) -> Result<T, ParseError> {
        Err(ParseError { pos: self.pos, msg: msg.to_string() })
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(' ') | Some('\t') | Some('\n') | Some('\r')) {
            self.pos += 1;
        }
    }

    fn keyword(&mut self, word: &str, tok: Token) -> Result<Token, ParseError> {
        for want in word.chars() {
            if self.bump() != Some(want) {
                return self.err(&format!("expected `{word}`"));
            }
        }
        Ok(tok)
    }

    fn lex_unicode(&mut self) -> Result<char, ParseError> {
        let mut n: u32 = 0;
        for _ in 0..4 {
            let c = match self.bump() {
                Some(c) => c,
                None => return self.err("`\\u` needs four hex digits"),
            };
            match c.to_digit(16) {
                Some(d) => n = n * 16 + d,
                None => return self.err("`\\u` needs four hex digits"),
            }
        }
        match char::from_u32(n) {
            Some(c) => Ok(c),
            None => self.err("`\\u` escape is not a character"),
        }
    }

    fn lex_string(&mut self) -> Result<String, ParseError> {
        self.pos += 1;
        let mut out = String::new();
        loop {
            let c = match self.bump() {
                Some(c) => c,
                None => return self.err("unterminated string"),
            };
            match c {
                '"' => return Ok(out),
                '\\' => {
                    let e = match self.bump() {
                        Some(e) => e,
                        None => return self.err("unterminated escape"),
                    };
                    match e {
                        '"' => out.push('"'),
                        '\\' => out.push('\\'),
                        '/' => out.push('/'),
                        'b' => out.push('\u{8}'),
                        'f' => out.push('\u{c}'),
                        'n' => out.push('\n'),
                        'r' => out.push('\r'),
                        't' => out.push('\t'),
                        'u' => {
                            let ch = self.lex_unicode()?;
                            out.push(ch);
                        }
                        other => return self.err(&format!("unknown escape `\\{other}`")),
                    }
                }
                c => out.push(c),
            }
        }
    }

    fn lex_number(&mut self) -> Result<f64, ParseError> {
        let start = self.pos;
        if self.peek() == Some('-') {
            self.pos += 1;
        }
        while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
            self.pos += 1;
        }
        let text = &self.src[start..self.pos];
        match text.parse::<f64>() {
            Ok(n) => Ok(n),
            Err(_) => Err(ParseError { pos: start, msg: format!("bad number `{text}`") }),
        }
    }

    pub fn next_token(&mut self) -> Result<Option<Token>, ParseError> {
        self.skip_ws();
        let c = match self.peek() {
            Some(c) => c,
            None => return Ok(None),
        };
        let tok = match c {
            '{' => { self.pos += 1; Token::LBrace }
            '}' => { self.pos += 1; Token::RBrace }
            '[' => { self.pos += 1; Token::LBracket }
            ']' => { self.pos += 1; Token::RBracket }
            ':' => { self.pos += 1; Token::Colon }
            ',' => { self.pos += 1; Token::Comma }
            'n' => self.keyword("null", Token::Null)?,
            't' => self.keyword("true", Token::True)?,
            'f' => self.keyword("false", Token::False)?,
            '"' => Token::Str(self.lex_string()?),
            '-' | '0'..='9' => Token::Num(self.lex_number()?),
            other => return self.err(&format!("unexpected character `{other}`")),
        };
        Ok(Some(tok))
    }
}

pub fn tokenize(input: &str) -> Result<Vec<Token>, ParseError> {
    let mut lex = Lexer::new(input);
    let mut out = Vec::new();
    while let Some(t) = lex.next_token()? {
        out.push(t);
    }
    Ok(out)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    fn nums(src: &str) -> Vec<f64> {
        tokenize(src)
            .unwrap()
            .into_iter()
            .filter_map(|t| match t {
                Token::Num(n) => Some(n),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn integers_and_signs() {
        assert_eq!(nums("0 42 -7"), vec![0.0, 42.0, -7.0]);
    }

    #[test]
    fn fractions() {
        assert_eq!(nums("0.5 -0.25 3.0"), vec![0.5, -0.25, 3.0]);
    }

    #[test]
    fn exponents() {
        let got = nums("1e3 1.5e3 2E-8 6.02e+23");
        println!("{got:?}");
        assert_eq!(got, vec![1000.0, 1500.0, 2e-8, 6.02e23]);
    }

    #[test]
    fn numbers_sit_next_to_punctuation() {
        assert_eq!(
            tokenize("[1,2.5e1]").unwrap(),
            vec![
                Token::LBracket,
                Token::Num(1.0),
                Token::Comma,
                Token::Num(25.0),
                Token::RBracket,
            ]
        );
    }
}
```

```solution
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    Str(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    pub fn type_name(&self) -> &'static str {
        match self {
            Value::Null => "null",
            Value::Bool(_) => "bool",
            Value::Number(_) => "number",
            Value::Str(_) => "string",
            Value::Array(_) => "array",
            Value::Object(_) => "object",
        }
    }

    pub fn count(&self) -> usize {
        match self {
            Value::Array(items) => 1 + items.iter().map(|v| v.count()).sum::<usize>(),
            Value::Object(members) => 1 + members.iter().map(|(_, v)| v.count()).sum::<usize>(),
            _ => 1,
        }
    }
}

pub fn sample() -> Value {
    Value::Object(vec![
        ("name".to_string(), Value::Str("ferris".to_string())),
        ("id".to_string(), Value::Number(42.0)),
        (
            "tags".to_string(),
            Value::Array(vec![
                Value::Str("rust".to_string()),
                Value::Bool(true),
                Value::Null,
            ]),
        ),
    ])
}

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Colon,
    Comma,
    Null,
    True,
    False,
    Num(f64),
    Str(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParseError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at character {}", self.msg, self.pos)
    }
}

impl std::error::Error for ParseError {}

pub struct Lexer {
    src: Vec<char>,
    pos: usize,
}

impl Lexer {
    pub fn new(input: &str) -> Lexer {
        Lexer { src: input.chars().collect(), pos: 0 }
    }

    pub fn pos(&self) -> usize {
        self.pos
    }

    fn peek(&self) -> Option<char> {
        self.src.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    fn err<T>(&self, msg: &str) -> Result<T, ParseError> {
        Err(ParseError { pos: self.pos, msg: msg.to_string() })
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(' ') | Some('\t') | Some('\n') | Some('\r')) {
            self.pos += 1;
        }
    }

    fn keyword(&mut self, word: &str, tok: Token) -> Result<Token, ParseError> {
        for want in word.chars() {
            if self.bump() != Some(want) {
                return self.err(&format!("expected `{word}`"));
            }
        }
        Ok(tok)
    }

    fn lex_unicode(&mut self) -> Result<char, ParseError> {
        let mut n: u32 = 0;
        for _ in 0..4 {
            let c = match self.bump() {
                Some(c) => c,
                None => return self.err("`\\u` needs four hex digits"),
            };
            match c.to_digit(16) {
                Some(d) => n = n * 16 + d,
                None => return self.err("`\\u` needs four hex digits"),
            }
        }
        match char::from_u32(n) {
            Some(c) => Ok(c),
            None => self.err("`\\u` escape is not a character"),
        }
    }

    fn lex_string(&mut self) -> Result<String, ParseError> {
        self.pos += 1;
        let mut out = String::new();
        loop {
            let c = match self.bump() {
                Some(c) => c,
                None => return self.err("unterminated string"),
            };
            match c {
                '"' => return Ok(out),
                '\\' => {
                    let e = match self.bump() {
                        Some(e) => e,
                        None => return self.err("unterminated escape"),
                    };
                    match e {
                        '"' => out.push('"'),
                        '\\' => out.push('\\'),
                        '/' => out.push('/'),
                        'b' => out.push('\u{8}'),
                        'f' => out.push('\u{c}'),
                        'n' => out.push('\n'),
                        'r' => out.push('\r'),
                        't' => out.push('\t'),
                        'u' => {
                            let ch = self.lex_unicode()?;
                            out.push(ch);
                        }
                        other => return self.err(&format!("unknown escape `\\{other}`")),
                    }
                }
                c => out.push(c),
            }
        }
    }

    fn lex_number(&mut self) -> Result<f64, ParseError> {
        let start = self.pos;
        if self.peek() == Some('-') {
            self.pos += 1;
        }
        while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
            self.pos += 1;
        }
        if self.peek() == Some('.') {
            self.pos += 1;
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.pos += 1;
            }
        }
        if matches!(self.peek(), Some('e') | Some('E')) {
            self.pos += 1;
            if matches!(self.peek(), Some('+') | Some('-')) {
                self.pos += 1;
            }
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.pos += 1;
            }
        }
        let text: String = self.src[start..self.pos].iter().collect();
        match text.parse::<f64>() {
            Ok(n) => Ok(n),
            Err(_) => Err(ParseError { pos: start, msg: format!("bad number `{text}`") }),
        }
    }

    pub fn next_token(&mut self) -> Result<Option<Token>, ParseError> {
        self.skip_ws();
        let c = match self.peek() {
            Some(c) => c,
            None => return Ok(None),
        };
        let tok = match c {
            '{' => { self.pos += 1; Token::LBrace }
            '}' => { self.pos += 1; Token::RBrace }
            '[' => { self.pos += 1; Token::LBracket }
            ']' => { self.pos += 1; Token::RBracket }
            ':' => { self.pos += 1; Token::Colon }
            ',' => { self.pos += 1; Token::Comma }
            'n' => self.keyword("null", Token::Null)?,
            't' => self.keyword("true", Token::True)?,
            'f' => self.keyword("false", Token::False)?,
            '"' => Token::Str(self.lex_string()?),
            '-' | '0'..='9' => Token::Num(self.lex_number()?),
            other => return self.err(&format!("unexpected character `{other}`")),
        };
        Ok(Some(tok))
    }
}

pub fn tokenize(input: &str) -> Result<Vec<Token>, ParseError> {
    let mut lex = Lexer::new(input);
    let mut out = Vec::new();
    while let Some(t) = lex.next_token()? {
        out.push(t);
    }
    Ok(out)
}
```

@hint `self.src` is a `Vec<char>`, so slicing it gives you characters, not text. The parsing method you want lives on `str`.
@hint `self.src[start..self.pos].iter().collect::<String>()` builds the text. A turbofish or a type annotation on the binding tells `collect` what to build.
@hint After the digits, accept an optional `.` followed by more digits, then an optional `e` or `E` followed by an optional sign and more digits. Then let `f64::from_str` do the arithmetic.

@diagnose E0599
`no method named parse found for reference &[char]`. Slicing a `Vec<char>` gives
a `[char]`, which is a run of four-byte scalar values. `parse` is a method on
`str`, which is a run of UTF-8 bytes. They are different types with different
layouts, so the method genuinely is not there.

`.iter().collect::<String>()` rebuilds the text, allocating once per number.
`collect` needs to be told what to build, so either the turbofish or a
`let text: String = ...` annotation is required; without one you get
`error[E0282]: type annotations needed`.

This is the price of `Vec<char>` from stage 2. A byte-slice lexer would have had
`std::str::from_utf8` here for free.

@diagnose E0282
`collect` can build a `String`, a `Vec<char>`, a `HashSet<char>` and a long list
of other things, and nothing in this expression says which. Annotate the
binding as `let text: String = ...` or write `.collect::<String>()`.

@after
Delegating to `f64::from_str` is the right call and it is also what
`serde_json` does not do. Correctly rounded decimal to binary conversion is
subtle, and the standard library already has a correct implementation, so
scanning the extent and handing over the text is both shorter and more accurate
than accumulating digits by hand.

What is lost is the integer. JSON has one number type, and this parser makes it
`f64`, so any integer beyond 2^53 comes back rounded. `serde_json` keeps `u64`,
`i64` and `f64` in separate variants of its `Number` type for exactly this
reason.

## 5. From tokens to values

@kind fix
@concept match
@expect E0004

The parser sits on top of the lexer with one token of lookahead, which is all
recursive descent needs for JSON. `parse_value` turns the next token into a
`Value`, and this stage covers the five scalars.

The match is missing something, and the top-level `parse` is not written. A
document with anything left over after the value is an error.

```starter
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    Str(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    pub fn type_name(&self) -> &'static str {
        match self {
            Value::Null => "null",
            Value::Bool(_) => "bool",
            Value::Number(_) => "number",
            Value::Str(_) => "string",
            Value::Array(_) => "array",
            Value::Object(_) => "object",
        }
    }

    pub fn count(&self) -> usize {
        match self {
            Value::Array(items) => 1 + items.iter().map(|v| v.count()).sum::<usize>(),
            Value::Object(members) => 1 + members.iter().map(|(_, v)| v.count()).sum::<usize>(),
            _ => 1,
        }
    }
}

pub fn sample() -> Value {
    Value::Object(vec![
        ("name".to_string(), Value::Str("ferris".to_string())),
        ("id".to_string(), Value::Number(42.0)),
        (
            "tags".to_string(),
            Value::Array(vec![
                Value::Str("rust".to_string()),
                Value::Bool(true),
                Value::Null,
            ]),
        ),
    ])
}

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Colon,
    Comma,
    Null,
    True,
    False,
    Num(f64),
    Str(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParseError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at character {}", self.msg, self.pos)
    }
}

impl std::error::Error for ParseError {}

pub struct Lexer {
    src: Vec<char>,
    pos: usize,
}

impl Lexer {
    pub fn new(input: &str) -> Lexer {
        Lexer { src: input.chars().collect(), pos: 0 }
    }

    pub fn pos(&self) -> usize {
        self.pos
    }

    fn peek(&self) -> Option<char> {
        self.src.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    fn err<T>(&self, msg: &str) -> Result<T, ParseError> {
        Err(ParseError { pos: self.pos, msg: msg.to_string() })
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(' ') | Some('\t') | Some('\n') | Some('\r')) {
            self.pos += 1;
        }
    }

    fn keyword(&mut self, word: &str, tok: Token) -> Result<Token, ParseError> {
        for want in word.chars() {
            if self.bump() != Some(want) {
                return self.err(&format!("expected `{word}`"));
            }
        }
        Ok(tok)
    }

    fn lex_unicode(&mut self) -> Result<char, ParseError> {
        let mut n: u32 = 0;
        for _ in 0..4 {
            let c = match self.bump() {
                Some(c) => c,
                None => return self.err("`\\u` needs four hex digits"),
            };
            match c.to_digit(16) {
                Some(d) => n = n * 16 + d,
                None => return self.err("`\\u` needs four hex digits"),
            }
        }
        match char::from_u32(n) {
            Some(c) => Ok(c),
            None => self.err("`\\u` escape is not a character"),
        }
    }

    fn lex_string(&mut self) -> Result<String, ParseError> {
        self.pos += 1;
        let mut out = String::new();
        loop {
            let c = match self.bump() {
                Some(c) => c,
                None => return self.err("unterminated string"),
            };
            match c {
                '"' => return Ok(out),
                '\\' => {
                    let e = match self.bump() {
                        Some(e) => e,
                        None => return self.err("unterminated escape"),
                    };
                    match e {
                        '"' => out.push('"'),
                        '\\' => out.push('\\'),
                        '/' => out.push('/'),
                        'b' => out.push('\u{8}'),
                        'f' => out.push('\u{c}'),
                        'n' => out.push('\n'),
                        'r' => out.push('\r'),
                        't' => out.push('\t'),
                        'u' => {
                            let ch = self.lex_unicode()?;
                            out.push(ch);
                        }
                        other => return self.err(&format!("unknown escape `\\{other}`")),
                    }
                }
                c => out.push(c),
            }
        }
    }

    fn lex_number(&mut self) -> Result<f64, ParseError> {
        let start = self.pos;
        if self.peek() == Some('-') {
            self.pos += 1;
        }
        while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
            self.pos += 1;
        }
        if self.peek() == Some('.') {
            self.pos += 1;
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.pos += 1;
            }
        }
        if matches!(self.peek(), Some('e') | Some('E')) {
            self.pos += 1;
            if matches!(self.peek(), Some('+') | Some('-')) {
                self.pos += 1;
            }
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.pos += 1;
            }
        }
        let text: String = self.src[start..self.pos].iter().collect();
        match text.parse::<f64>() {
            Ok(n) => Ok(n),
            Err(_) => Err(ParseError { pos: start, msg: format!("bad number `{text}`") }),
        }
    }

    pub fn next_token(&mut self) -> Result<Option<Token>, ParseError> {
        self.skip_ws();
        let c = match self.peek() {
            Some(c) => c,
            None => return Ok(None),
        };
        let tok = match c {
            '{' => { self.pos += 1; Token::LBrace }
            '}' => { self.pos += 1; Token::RBrace }
            '[' => { self.pos += 1; Token::LBracket }
            ']' => { self.pos += 1; Token::RBracket }
            ':' => { self.pos += 1; Token::Colon }
            ',' => { self.pos += 1; Token::Comma }
            'n' => self.keyword("null", Token::Null)?,
            't' => self.keyword("true", Token::True)?,
            'f' => self.keyword("false", Token::False)?,
            '"' => Token::Str(self.lex_string()?),
            '-' | '0'..='9' => Token::Num(self.lex_number()?),
            other => return self.err(&format!("unexpected character `{other}`")),
        };
        Ok(Some(tok))
    }
}

pub fn tokenize(input: &str) -> Result<Vec<Token>, ParseError> {
    let mut lex = Lexer::new(input);
    let mut out = Vec::new();
    while let Some(t) = lex.next_token()? {
        out.push(t);
    }
    Ok(out)
}

pub struct Parser {
    lexer: Lexer,
    peeked: Option<Token>,
}

impl Parser {
    pub fn new(input: &str) -> Parser {
        Parser { lexer: Lexer::new(input), peeked: None }
    }

    fn take(&mut self) -> Result<Option<Token>, ParseError> {
        match self.peeked.take() {
            Some(t) => Ok(Some(t)),
            None => self.lexer.next_token(),
        }
    }

    fn peek_is(&mut self, want: &Token) -> Result<bool, ParseError> {
        if self.peeked.is_none() {
            self.peeked = self.lexer.next_token()?;
        }
        Ok(self.peeked.as_ref() == Some(want))
    }

    fn expect(&mut self, want: Token, what: &str) -> Result<(), ParseError> {
        let pos = self.lexer.pos();
        match self.take()? {
            Some(t) if t == want => Ok(()),
            _ => Err(ParseError { pos, msg: format!("expected {what}") }),
        }
    }

    pub fn parse_value(&mut self) -> Result<Value, ParseError> {
        let pos = self.lexer.pos();
        let tok = match self.take()? {
            Some(t) => t,
            None => return Err(ParseError { pos, msg: "unexpected end of input".to_string() }),
        };
        match tok {
            Token::Null => Ok(Value::Null),
            Token::True => Ok(Value::Bool(true)),
            Token::False => Ok(Value::Bool(false)),
            Token::Num(n) => Ok(Value::Number(n)),
            Token::Str(s) => Ok(Value::Str(s)),
        }
    }
}

pub fn parse(input: &str) -> Result<Value, ParseError> {
    todo!("parse one value, then insist that nothing follows it")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_scalar() {
        assert_eq!(parse("null"), Ok(Value::Null));
        assert_eq!(parse(" true "), Ok(Value::Bool(true)));
        assert_eq!(parse("false"), Ok(Value::Bool(false)));
        assert_eq!(parse("-1.5e2"), Ok(Value::Number(-150.0)));
        assert_eq!(parse(r#""hi\n""#), Ok(Value::Str("hi\n".to_string())));
        println!("{:?}", parse("-1.5e2"));
    }

    #[test]
    fn an_empty_document_is_an_error() {
        let e = parse("   ").unwrap_err();
        assert_eq!(e.msg, "unexpected end of input");
    }

    #[test]
    fn trailing_junk_is_rejected() {
        assert!(parse("1 2").is_err());
        assert!(parse("null null").is_err());
    }

    #[test]
    fn a_container_is_not_a_scalar() {
        let e = parse("[").unwrap_err();
        assert!(e.msg.starts_with("unexpected token"));
        assert!(e.to_string().contains("at character"));
    }
}
```

```solution
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    Str(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    pub fn type_name(&self) -> &'static str {
        match self {
            Value::Null => "null",
            Value::Bool(_) => "bool",
            Value::Number(_) => "number",
            Value::Str(_) => "string",
            Value::Array(_) => "array",
            Value::Object(_) => "object",
        }
    }

    pub fn count(&self) -> usize {
        match self {
            Value::Array(items) => 1 + items.iter().map(|v| v.count()).sum::<usize>(),
            Value::Object(members) => 1 + members.iter().map(|(_, v)| v.count()).sum::<usize>(),
            _ => 1,
        }
    }
}

pub fn sample() -> Value {
    Value::Object(vec![
        ("name".to_string(), Value::Str("ferris".to_string())),
        ("id".to_string(), Value::Number(42.0)),
        (
            "tags".to_string(),
            Value::Array(vec![
                Value::Str("rust".to_string()),
                Value::Bool(true),
                Value::Null,
            ]),
        ),
    ])
}

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Colon,
    Comma,
    Null,
    True,
    False,
    Num(f64),
    Str(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParseError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at character {}", self.msg, self.pos)
    }
}

impl std::error::Error for ParseError {}

pub struct Lexer {
    src: Vec<char>,
    pos: usize,
}

impl Lexer {
    pub fn new(input: &str) -> Lexer {
        Lexer { src: input.chars().collect(), pos: 0 }
    }

    pub fn pos(&self) -> usize {
        self.pos
    }

    fn peek(&self) -> Option<char> {
        self.src.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    fn err<T>(&self, msg: &str) -> Result<T, ParseError> {
        Err(ParseError { pos: self.pos, msg: msg.to_string() })
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(' ') | Some('\t') | Some('\n') | Some('\r')) {
            self.pos += 1;
        }
    }

    fn keyword(&mut self, word: &str, tok: Token) -> Result<Token, ParseError> {
        for want in word.chars() {
            if self.bump() != Some(want) {
                return self.err(&format!("expected `{word}`"));
            }
        }
        Ok(tok)
    }

    fn lex_unicode(&mut self) -> Result<char, ParseError> {
        let mut n: u32 = 0;
        for _ in 0..4 {
            let c = match self.bump() {
                Some(c) => c,
                None => return self.err("`\\u` needs four hex digits"),
            };
            match c.to_digit(16) {
                Some(d) => n = n * 16 + d,
                None => return self.err("`\\u` needs four hex digits"),
            }
        }
        match char::from_u32(n) {
            Some(c) => Ok(c),
            None => self.err("`\\u` escape is not a character"),
        }
    }

    fn lex_string(&mut self) -> Result<String, ParseError> {
        self.pos += 1;
        let mut out = String::new();
        loop {
            let c = match self.bump() {
                Some(c) => c,
                None => return self.err("unterminated string"),
            };
            match c {
                '"' => return Ok(out),
                '\\' => {
                    let e = match self.bump() {
                        Some(e) => e,
                        None => return self.err("unterminated escape"),
                    };
                    match e {
                        '"' => out.push('"'),
                        '\\' => out.push('\\'),
                        '/' => out.push('/'),
                        'b' => out.push('\u{8}'),
                        'f' => out.push('\u{c}'),
                        'n' => out.push('\n'),
                        'r' => out.push('\r'),
                        't' => out.push('\t'),
                        'u' => {
                            let ch = self.lex_unicode()?;
                            out.push(ch);
                        }
                        other => return self.err(&format!("unknown escape `\\{other}`")),
                    }
                }
                c => out.push(c),
            }
        }
    }

    fn lex_number(&mut self) -> Result<f64, ParseError> {
        let start = self.pos;
        if self.peek() == Some('-') {
            self.pos += 1;
        }
        while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
            self.pos += 1;
        }
        if self.peek() == Some('.') {
            self.pos += 1;
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.pos += 1;
            }
        }
        if matches!(self.peek(), Some('e') | Some('E')) {
            self.pos += 1;
            if matches!(self.peek(), Some('+') | Some('-')) {
                self.pos += 1;
            }
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.pos += 1;
            }
        }
        let text: String = self.src[start..self.pos].iter().collect();
        match text.parse::<f64>() {
            Ok(n) => Ok(n),
            Err(_) => Err(ParseError { pos: start, msg: format!("bad number `{text}`") }),
        }
    }

    pub fn next_token(&mut self) -> Result<Option<Token>, ParseError> {
        self.skip_ws();
        let c = match self.peek() {
            Some(c) => c,
            None => return Ok(None),
        };
        let tok = match c {
            '{' => { self.pos += 1; Token::LBrace }
            '}' => { self.pos += 1; Token::RBrace }
            '[' => { self.pos += 1; Token::LBracket }
            ']' => { self.pos += 1; Token::RBracket }
            ':' => { self.pos += 1; Token::Colon }
            ',' => { self.pos += 1; Token::Comma }
            'n' => self.keyword("null", Token::Null)?,
            't' => self.keyword("true", Token::True)?,
            'f' => self.keyword("false", Token::False)?,
            '"' => Token::Str(self.lex_string()?),
            '-' | '0'..='9' => Token::Num(self.lex_number()?),
            other => return self.err(&format!("unexpected character `{other}`")),
        };
        Ok(Some(tok))
    }
}

pub fn tokenize(input: &str) -> Result<Vec<Token>, ParseError> {
    let mut lex = Lexer::new(input);
    let mut out = Vec::new();
    while let Some(t) = lex.next_token()? {
        out.push(t);
    }
    Ok(out)
}

pub struct Parser {
    lexer: Lexer,
    peeked: Option<Token>,
}

impl Parser {
    pub fn new(input: &str) -> Parser {
        Parser { lexer: Lexer::new(input), peeked: None }
    }

    fn take(&mut self) -> Result<Option<Token>, ParseError> {
        match self.peeked.take() {
            Some(t) => Ok(Some(t)),
            None => self.lexer.next_token(),
        }
    }

    fn peek_is(&mut self, want: &Token) -> Result<bool, ParseError> {
        if self.peeked.is_none() {
            self.peeked = self.lexer.next_token()?;
        }
        Ok(self.peeked.as_ref() == Some(want))
    }

    fn expect(&mut self, want: Token, what: &str) -> Result<(), ParseError> {
        let pos = self.lexer.pos();
        match self.take()? {
            Some(t) if t == want => Ok(()),
            _ => Err(ParseError { pos, msg: format!("expected {what}") }),
        }
    }

    pub fn parse_value(&mut self) -> Result<Value, ParseError> {
        let pos = self.lexer.pos();
        let tok = match self.take()? {
            Some(t) => t,
            None => return Err(ParseError { pos, msg: "unexpected end of input".to_string() }),
        };
        match tok {
            Token::Null => Ok(Value::Null),
            Token::True => Ok(Value::Bool(true)),
            Token::False => Ok(Value::Bool(false)),
            Token::Num(n) => Ok(Value::Number(n)),
            Token::Str(s) => Ok(Value::Str(s)),
            other => Err(ParseError { pos, msg: format!("unexpected token {other:?}") }),
        }
    }
}

pub fn parse(input: &str) -> Result<Value, ParseError> {
    let mut p = Parser::new(input);
    let v = p.parse_value()?;
    let pos = p.lexer.pos();
    match p.take()? {
        Some(t) => Err(ParseError { pos, msg: format!("trailing token {t:?}") }),
        None => Ok(v),
    }
}
```

@hint Six token kinds cannot start a scalar. They will start something later, but not in this stage.
@hint Capture the offending token in a binding so the error message can name it: `other => Err(...)` with `{other:?}` in the message.
@hint `parse` builds a `Parser`, calls `parse_value`, and then calls `take` once more. If that call gives `Some(t)`, the document had more than one value in it.

@diagnose E0004
`non-exhaustive patterns: Token::LBrace, Token::RBrace and 4 more not covered`.
The five scalar tokens are handled and the six structural ones are not, so
`match tok` cannot produce a `Result` for every input.

Note the error names the *tokens*, not the values. This is the enum from stage 2
being checked against a different match, in a different function, written two
stages later. Nothing had to be kept in sync by hand.

Two of those six get real arms in stages 6 and 7. The other four (`RBrace`,
`RBracket`, `Colon`, `Comma`) never start a value at all, so the catch-all arm
you add now stays as the permanent home for them.

@diagnose E0308
`parse` promises `Result<Value, ParseError>`. `parse_value` gives you a
`Result<Value, ParseError>` too, so `let v = p.parse_value()?;` unwraps it and
leaves a `Value`. The final `match` then has to produce the wrapped form again
in both arms: `Ok(v)` on one side, `Err(...)` on the other.

@after
The `peeked: Option<Token>` field is the whole lookahead machinery. `take()`
consumes it if it is full and otherwise pulls from the lexer, so the parser can
ask "is the next token a comma" without losing it. `Option::take` is what makes
that one line: it swaps the field with `None` and hands you what was there,
which is a move out of a field the borrow checker would otherwise refuse.

Insisting that nothing follows the value matters more than it looks. Without
that check, `parse("1 2")` returns `1` and quietly drops the rest of your
document.

## 6. Arrays, which contain values, which may be arrays

@kind fix
@concept recursion
@expect E0308

An array is a bracket, then values separated by commas, then a closing bracket.
Each of those values is parsed by the function that called this one, which is
what makes the parser recursive and what makes nesting free.

`parse_array` drops a value on the floor and cannot handle `[]`. Fix both.

```starter
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    Str(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    pub fn type_name(&self) -> &'static str {
        match self {
            Value::Null => "null",
            Value::Bool(_) => "bool",
            Value::Number(_) => "number",
            Value::Str(_) => "string",
            Value::Array(_) => "array",
            Value::Object(_) => "object",
        }
    }

    pub fn count(&self) -> usize {
        match self {
            Value::Array(items) => 1 + items.iter().map(|v| v.count()).sum::<usize>(),
            Value::Object(members) => 1 + members.iter().map(|(_, v)| v.count()).sum::<usize>(),
            _ => 1,
        }
    }
}

pub fn sample() -> Value {
    Value::Object(vec![
        ("name".to_string(), Value::Str("ferris".to_string())),
        ("id".to_string(), Value::Number(42.0)),
        (
            "tags".to_string(),
            Value::Array(vec![
                Value::Str("rust".to_string()),
                Value::Bool(true),
                Value::Null,
            ]),
        ),
    ])
}

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Colon,
    Comma,
    Null,
    True,
    False,
    Num(f64),
    Str(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParseError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at character {}", self.msg, self.pos)
    }
}

impl std::error::Error for ParseError {}

pub struct Lexer {
    src: Vec<char>,
    pos: usize,
}

impl Lexer {
    pub fn new(input: &str) -> Lexer {
        Lexer { src: input.chars().collect(), pos: 0 }
    }

    pub fn pos(&self) -> usize {
        self.pos
    }

    fn peek(&self) -> Option<char> {
        self.src.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    fn err<T>(&self, msg: &str) -> Result<T, ParseError> {
        Err(ParseError { pos: self.pos, msg: msg.to_string() })
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(' ') | Some('\t') | Some('\n') | Some('\r')) {
            self.pos += 1;
        }
    }

    fn keyword(&mut self, word: &str, tok: Token) -> Result<Token, ParseError> {
        for want in word.chars() {
            if self.bump() != Some(want) {
                return self.err(&format!("expected `{word}`"));
            }
        }
        Ok(tok)
    }

    fn lex_unicode(&mut self) -> Result<char, ParseError> {
        let mut n: u32 = 0;
        for _ in 0..4 {
            let c = match self.bump() {
                Some(c) => c,
                None => return self.err("`\\u` needs four hex digits"),
            };
            match c.to_digit(16) {
                Some(d) => n = n * 16 + d,
                None => return self.err("`\\u` needs four hex digits"),
            }
        }
        match char::from_u32(n) {
            Some(c) => Ok(c),
            None => self.err("`\\u` escape is not a character"),
        }
    }

    fn lex_string(&mut self) -> Result<String, ParseError> {
        self.pos += 1;
        let mut out = String::new();
        loop {
            let c = match self.bump() {
                Some(c) => c,
                None => return self.err("unterminated string"),
            };
            match c {
                '"' => return Ok(out),
                '\\' => {
                    let e = match self.bump() {
                        Some(e) => e,
                        None => return self.err("unterminated escape"),
                    };
                    match e {
                        '"' => out.push('"'),
                        '\\' => out.push('\\'),
                        '/' => out.push('/'),
                        'b' => out.push('\u{8}'),
                        'f' => out.push('\u{c}'),
                        'n' => out.push('\n'),
                        'r' => out.push('\r'),
                        't' => out.push('\t'),
                        'u' => {
                            let ch = self.lex_unicode()?;
                            out.push(ch);
                        }
                        other => return self.err(&format!("unknown escape `\\{other}`")),
                    }
                }
                c => out.push(c),
            }
        }
    }

    fn lex_number(&mut self) -> Result<f64, ParseError> {
        let start = self.pos;
        if self.peek() == Some('-') {
            self.pos += 1;
        }
        while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
            self.pos += 1;
        }
        if self.peek() == Some('.') {
            self.pos += 1;
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.pos += 1;
            }
        }
        if matches!(self.peek(), Some('e') | Some('E')) {
            self.pos += 1;
            if matches!(self.peek(), Some('+') | Some('-')) {
                self.pos += 1;
            }
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.pos += 1;
            }
        }
        let text: String = self.src[start..self.pos].iter().collect();
        match text.parse::<f64>() {
            Ok(n) => Ok(n),
            Err(_) => Err(ParseError { pos: start, msg: format!("bad number `{text}`") }),
        }
    }

    pub fn next_token(&mut self) -> Result<Option<Token>, ParseError> {
        self.skip_ws();
        let c = match self.peek() {
            Some(c) => c,
            None => return Ok(None),
        };
        let tok = match c {
            '{' => { self.pos += 1; Token::LBrace }
            '}' => { self.pos += 1; Token::RBrace }
            '[' => { self.pos += 1; Token::LBracket }
            ']' => { self.pos += 1; Token::RBracket }
            ':' => { self.pos += 1; Token::Colon }
            ',' => { self.pos += 1; Token::Comma }
            'n' => self.keyword("null", Token::Null)?,
            't' => self.keyword("true", Token::True)?,
            'f' => self.keyword("false", Token::False)?,
            '"' => Token::Str(self.lex_string()?),
            '-' | '0'..='9' => Token::Num(self.lex_number()?),
            other => return self.err(&format!("unexpected character `{other}`")),
        };
        Ok(Some(tok))
    }
}

pub fn tokenize(input: &str) -> Result<Vec<Token>, ParseError> {
    let mut lex = Lexer::new(input);
    let mut out = Vec::new();
    while let Some(t) = lex.next_token()? {
        out.push(t);
    }
    Ok(out)
}

pub struct Parser {
    lexer: Lexer,
    peeked: Option<Token>,
}

impl Parser {
    pub fn new(input: &str) -> Parser {
        Parser { lexer: Lexer::new(input), peeked: None }
    }

    fn take(&mut self) -> Result<Option<Token>, ParseError> {
        match self.peeked.take() {
            Some(t) => Ok(Some(t)),
            None => self.lexer.next_token(),
        }
    }

    fn peek_is(&mut self, want: &Token) -> Result<bool, ParseError> {
        if self.peeked.is_none() {
            self.peeked = self.lexer.next_token()?;
        }
        Ok(self.peeked.as_ref() == Some(want))
    }

    fn expect(&mut self, want: Token, what: &str) -> Result<(), ParseError> {
        let pos = self.lexer.pos();
        match self.take()? {
            Some(t) if t == want => Ok(()),
            _ => Err(ParseError { pos, msg: format!("expected {what}") }),
        }
    }

    fn parse_array(&mut self) -> Result<Value, ParseError> {
        let mut items = Vec::new();
        loop {
            items.push(self.parse_value());
            if self.peek_is(&Token::Comma)? {
                self.take()?;
                continue;
            }
            self.expect(Token::RBracket, "`]` or `,`")?;
            return Ok(Value::Array(items));
        }
    }

    pub fn parse_value(&mut self) -> Result<Value, ParseError> {
        let pos = self.lexer.pos();
        let tok = match self.take()? {
            Some(t) => t,
            None => return Err(ParseError { pos, msg: "unexpected end of input".to_string() }),
        };
        match tok {
            Token::Null => Ok(Value::Null),
            Token::True => Ok(Value::Bool(true)),
            Token::False => Ok(Value::Bool(false)),
            Token::Num(n) => Ok(Value::Number(n)),
            Token::Str(s) => Ok(Value::Str(s)),
            Token::LBracket => self.parse_array(),
            other => Err(ParseError { pos, msg: format!("unexpected token {other:?}") }),
        }
    }
}

pub fn parse(input: &str) -> Result<Value, ParseError> {
    let mut p = Parser::new(input);
    let v = p.parse_value()?;
    let pos = p.lexer.pos();
    match p.take()? {
        Some(t) => Err(ParseError { pos, msg: format!("trailing token {t:?}") }),
        None => Ok(v),
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_flat_array() {
        assert_eq!(
            parse("[1, true, null]"),
            Ok(Value::Array(vec![
                Value::Number(1.0),
                Value::Bool(true),
                Value::Null,
            ]))
        );
    }

    #[test]
    fn the_empty_array() {
        assert_eq!(parse("[]"), Ok(Value::Array(Vec::new())));
        assert_eq!(parse("[ ]"), Ok(Value::Array(Vec::new())));
    }

    #[test]
    fn nesting_is_free() {
        let v = parse("[[1, [2]], [], [[[3]]]]").unwrap();
        println!("{v:?}");
        assert_eq!(v.count(), 10);
        assert_eq!(v.type_name(), "array");
    }

    #[test]
    fn malformed_arrays_are_errors() {
        assert!(parse("[1,]").is_err());
        assert!(parse("[1 2]").is_err());
        assert!(parse("[1").is_err());
    }
}
```

```solution
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    Str(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    pub fn type_name(&self) -> &'static str {
        match self {
            Value::Null => "null",
            Value::Bool(_) => "bool",
            Value::Number(_) => "number",
            Value::Str(_) => "string",
            Value::Array(_) => "array",
            Value::Object(_) => "object",
        }
    }

    pub fn count(&self) -> usize {
        match self {
            Value::Array(items) => 1 + items.iter().map(|v| v.count()).sum::<usize>(),
            Value::Object(members) => 1 + members.iter().map(|(_, v)| v.count()).sum::<usize>(),
            _ => 1,
        }
    }
}

pub fn sample() -> Value {
    Value::Object(vec![
        ("name".to_string(), Value::Str("ferris".to_string())),
        ("id".to_string(), Value::Number(42.0)),
        (
            "tags".to_string(),
            Value::Array(vec![
                Value::Str("rust".to_string()),
                Value::Bool(true),
                Value::Null,
            ]),
        ),
    ])
}

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Colon,
    Comma,
    Null,
    True,
    False,
    Num(f64),
    Str(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParseError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at character {}", self.msg, self.pos)
    }
}

impl std::error::Error for ParseError {}

pub struct Lexer {
    src: Vec<char>,
    pos: usize,
}

impl Lexer {
    pub fn new(input: &str) -> Lexer {
        Lexer { src: input.chars().collect(), pos: 0 }
    }

    pub fn pos(&self) -> usize {
        self.pos
    }

    fn peek(&self) -> Option<char> {
        self.src.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    fn err<T>(&self, msg: &str) -> Result<T, ParseError> {
        Err(ParseError { pos: self.pos, msg: msg.to_string() })
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(' ') | Some('\t') | Some('\n') | Some('\r')) {
            self.pos += 1;
        }
    }

    fn keyword(&mut self, word: &str, tok: Token) -> Result<Token, ParseError> {
        for want in word.chars() {
            if self.bump() != Some(want) {
                return self.err(&format!("expected `{word}`"));
            }
        }
        Ok(tok)
    }

    fn lex_unicode(&mut self) -> Result<char, ParseError> {
        let mut n: u32 = 0;
        for _ in 0..4 {
            let c = match self.bump() {
                Some(c) => c,
                None => return self.err("`\\u` needs four hex digits"),
            };
            match c.to_digit(16) {
                Some(d) => n = n * 16 + d,
                None => return self.err("`\\u` needs four hex digits"),
            }
        }
        match char::from_u32(n) {
            Some(c) => Ok(c),
            None => self.err("`\\u` escape is not a character"),
        }
    }

    fn lex_string(&mut self) -> Result<String, ParseError> {
        self.pos += 1;
        let mut out = String::new();
        loop {
            let c = match self.bump() {
                Some(c) => c,
                None => return self.err("unterminated string"),
            };
            match c {
                '"' => return Ok(out),
                '\\' => {
                    let e = match self.bump() {
                        Some(e) => e,
                        None => return self.err("unterminated escape"),
                    };
                    match e {
                        '"' => out.push('"'),
                        '\\' => out.push('\\'),
                        '/' => out.push('/'),
                        'b' => out.push('\u{8}'),
                        'f' => out.push('\u{c}'),
                        'n' => out.push('\n'),
                        'r' => out.push('\r'),
                        't' => out.push('\t'),
                        'u' => {
                            let ch = self.lex_unicode()?;
                            out.push(ch);
                        }
                        other => return self.err(&format!("unknown escape `\\{other}`")),
                    }
                }
                c => out.push(c),
            }
        }
    }

    fn lex_number(&mut self) -> Result<f64, ParseError> {
        let start = self.pos;
        if self.peek() == Some('-') {
            self.pos += 1;
        }
        while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
            self.pos += 1;
        }
        if self.peek() == Some('.') {
            self.pos += 1;
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.pos += 1;
            }
        }
        if matches!(self.peek(), Some('e') | Some('E')) {
            self.pos += 1;
            if matches!(self.peek(), Some('+') | Some('-')) {
                self.pos += 1;
            }
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.pos += 1;
            }
        }
        let text: String = self.src[start..self.pos].iter().collect();
        match text.parse::<f64>() {
            Ok(n) => Ok(n),
            Err(_) => Err(ParseError { pos: start, msg: format!("bad number `{text}`") }),
        }
    }

    pub fn next_token(&mut self) -> Result<Option<Token>, ParseError> {
        self.skip_ws();
        let c = match self.peek() {
            Some(c) => c,
            None => return Ok(None),
        };
        let tok = match c {
            '{' => { self.pos += 1; Token::LBrace }
            '}' => { self.pos += 1; Token::RBrace }
            '[' => { self.pos += 1; Token::LBracket }
            ']' => { self.pos += 1; Token::RBracket }
            ':' => { self.pos += 1; Token::Colon }
            ',' => { self.pos += 1; Token::Comma }
            'n' => self.keyword("null", Token::Null)?,
            't' => self.keyword("true", Token::True)?,
            'f' => self.keyword("false", Token::False)?,
            '"' => Token::Str(self.lex_string()?),
            '-' | '0'..='9' => Token::Num(self.lex_number()?),
            other => return self.err(&format!("unexpected character `{other}`")),
        };
        Ok(Some(tok))
    }
}

pub fn tokenize(input: &str) -> Result<Vec<Token>, ParseError> {
    let mut lex = Lexer::new(input);
    let mut out = Vec::new();
    while let Some(t) = lex.next_token()? {
        out.push(t);
    }
    Ok(out)
}

pub struct Parser {
    lexer: Lexer,
    peeked: Option<Token>,
}

impl Parser {
    pub fn new(input: &str) -> Parser {
        Parser { lexer: Lexer::new(input), peeked: None }
    }

    fn take(&mut self) -> Result<Option<Token>, ParseError> {
        match self.peeked.take() {
            Some(t) => Ok(Some(t)),
            None => self.lexer.next_token(),
        }
    }

    fn peek_is(&mut self, want: &Token) -> Result<bool, ParseError> {
        if self.peeked.is_none() {
            self.peeked = self.lexer.next_token()?;
        }
        Ok(self.peeked.as_ref() == Some(want))
    }

    fn expect(&mut self, want: Token, what: &str) -> Result<(), ParseError> {
        let pos = self.lexer.pos();
        match self.take()? {
            Some(t) if t == want => Ok(()),
            _ => Err(ParseError { pos, msg: format!("expected {what}") }),
        }
    }

    fn parse_array(&mut self) -> Result<Value, ParseError> {
        let mut items = Vec::new();
        if self.peek_is(&Token::RBracket)? {
            self.take()?;
            return Ok(Value::Array(items));
        }
        loop {
            items.push(self.parse_value()?);
            if self.peek_is(&Token::Comma)? {
                self.take()?;
                continue;
            }
            self.expect(Token::RBracket, "`]` or `,`")?;
            return Ok(Value::Array(items));
        }
    }

    pub fn parse_value(&mut self) -> Result<Value, ParseError> {
        let pos = self.lexer.pos();
        let tok = match self.take()? {
            Some(t) => t,
            None => return Err(ParseError { pos, msg: "unexpected end of input".to_string() }),
        };
        match tok {
            Token::Null => Ok(Value::Null),
            Token::True => Ok(Value::Bool(true)),
            Token::False => Ok(Value::Bool(false)),
            Token::Num(n) => Ok(Value::Number(n)),
            Token::Str(s) => Ok(Value::Str(s)),
            Token::LBracket => self.parse_array(),
            other => Err(ParseError { pos, msg: format!("unexpected token {other:?}") }),
        }
    }
}

pub fn parse(input: &str) -> Result<Value, ParseError> {
    let mut p = Parser::new(input);
    let v = p.parse_value()?;
    let pos = p.lexer.pos();
    match p.take()? {
        Some(t) => Err(ParseError { pos, msg: format!("trailing token {t:?}") }),
        None => Ok(v),
    }
}
```

@hint `items` is a `Vec<Value>` and `parse_value` hands back something that still has the failure case attached.
@hint `[]` never reaches the loop body correctly, because the loop starts by demanding a value. Check for `]` before entering it, using `peek_is`.
@hint `if self.peek_is(&Token::RBracket)? { self.take()?; return Ok(Value::Array(items)); }` above the loop, and `items.push(self.parse_value()?)` inside it.

@diagnose E0308
`expected Value, found Result<Value, ParseError>`. `Vec::<Value>::push` takes a
`Value`, and `parse_value` returns a `Result`, because parsing the element can
fail. The compiler will not let you store the possibility of failure in a
collection of successes.

`?` is the operator that resolves it: on `Ok(v)` it evaluates to `v`, and on
`Err(e)` it returns from `parse_array` immediately with that error. Since
`parse_array` returns `Result<Value, ParseError>` and the error types match,
nothing else is needed.

The propagation is what makes a bad element deep inside `[[1, [2, x]]]` surface
at the top with the character position from the innermost call.

@diagnose E0004
Adding `Token::LBracket => self.parse_array()` removed one variant from the
catch-all's job. Keep the `other =>` arm; the closing bracket, the colon and the
comma still never start a value.

@after
Two mutually recursive functions, `parse_value` and `parse_array`, now handle
arbitrarily deep nesting, and the call stack is doing the bookkeeping a manual
stack would otherwise have to. That is the appeal of recursive descent: the
shape of the code is the shape of the grammar.

It also means a document nested ten thousand deep overflows the stack and
aborts the process. `serde_json` counts depth and returns
`RecursionLimitExceeded` at 128 levels by default. Any parser reading untrusted
input needs that counter.

## 7. Objects, and what to do when a key repeats

@kind fix
@concept error
@expect E0277

An object is the same loop as an array with a string key and a colon in front of
each value. The interesting decision is what happens when the same key appears
twice, because JSON says nothing about it and every parser picks.

`parse_object` is written apart from the comparison in its duplicate check.
`Value::get` is not written.

```starter
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    Str(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    pub fn type_name(&self) -> &'static str {
        match self {
            Value::Null => "null",
            Value::Bool(_) => "bool",
            Value::Number(_) => "number",
            Value::Str(_) => "string",
            Value::Array(_) => "array",
            Value::Object(_) => "object",
        }
    }

    pub fn count(&self) -> usize {
        match self {
            Value::Array(items) => 1 + items.iter().map(|v| v.count()).sum::<usize>(),
            Value::Object(members) => 1 + members.iter().map(|(_, v)| v.count()).sum::<usize>(),
            _ => 1,
        }
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        todo!("find the member with this key, if this is an object at all")
    }
}

pub fn sample() -> Value {
    Value::Object(vec![
        ("name".to_string(), Value::Str("ferris".to_string())),
        ("id".to_string(), Value::Number(42.0)),
        (
            "tags".to_string(),
            Value::Array(vec![
                Value::Str("rust".to_string()),
                Value::Bool(true),
                Value::Null,
            ]),
        ),
    ])
}

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Colon,
    Comma,
    Null,
    True,
    False,
    Num(f64),
    Str(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParseError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at character {}", self.msg, self.pos)
    }
}

impl std::error::Error for ParseError {}

pub struct Lexer {
    src: Vec<char>,
    pos: usize,
}

impl Lexer {
    pub fn new(input: &str) -> Lexer {
        Lexer { src: input.chars().collect(), pos: 0 }
    }

    pub fn pos(&self) -> usize {
        self.pos
    }

    fn peek(&self) -> Option<char> {
        self.src.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    fn err<T>(&self, msg: &str) -> Result<T, ParseError> {
        Err(ParseError { pos: self.pos, msg: msg.to_string() })
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(' ') | Some('\t') | Some('\n') | Some('\r')) {
            self.pos += 1;
        }
    }

    fn keyword(&mut self, word: &str, tok: Token) -> Result<Token, ParseError> {
        for want in word.chars() {
            if self.bump() != Some(want) {
                return self.err(&format!("expected `{word}`"));
            }
        }
        Ok(tok)
    }

    fn lex_unicode(&mut self) -> Result<char, ParseError> {
        let mut n: u32 = 0;
        for _ in 0..4 {
            let c = match self.bump() {
                Some(c) => c,
                None => return self.err("`\\u` needs four hex digits"),
            };
            match c.to_digit(16) {
                Some(d) => n = n * 16 + d,
                None => return self.err("`\\u` needs four hex digits"),
            }
        }
        match char::from_u32(n) {
            Some(c) => Ok(c),
            None => self.err("`\\u` escape is not a character"),
        }
    }

    fn lex_string(&mut self) -> Result<String, ParseError> {
        self.pos += 1;
        let mut out = String::new();
        loop {
            let c = match self.bump() {
                Some(c) => c,
                None => return self.err("unterminated string"),
            };
            match c {
                '"' => return Ok(out),
                '\\' => {
                    let e = match self.bump() {
                        Some(e) => e,
                        None => return self.err("unterminated escape"),
                    };
                    match e {
                        '"' => out.push('"'),
                        '\\' => out.push('\\'),
                        '/' => out.push('/'),
                        'b' => out.push('\u{8}'),
                        'f' => out.push('\u{c}'),
                        'n' => out.push('\n'),
                        'r' => out.push('\r'),
                        't' => out.push('\t'),
                        'u' => {
                            let ch = self.lex_unicode()?;
                            out.push(ch);
                        }
                        other => return self.err(&format!("unknown escape `\\{other}`")),
                    }
                }
                c => out.push(c),
            }
        }
    }

    fn lex_number(&mut self) -> Result<f64, ParseError> {
        let start = self.pos;
        if self.peek() == Some('-') {
            self.pos += 1;
        }
        while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
            self.pos += 1;
        }
        if self.peek() == Some('.') {
            self.pos += 1;
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.pos += 1;
            }
        }
        if matches!(self.peek(), Some('e') | Some('E')) {
            self.pos += 1;
            if matches!(self.peek(), Some('+') | Some('-')) {
                self.pos += 1;
            }
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.pos += 1;
            }
        }
        let text: String = self.src[start..self.pos].iter().collect();
        match text.parse::<f64>() {
            Ok(n) => Ok(n),
            Err(_) => Err(ParseError { pos: start, msg: format!("bad number `{text}`") }),
        }
    }

    pub fn next_token(&mut self) -> Result<Option<Token>, ParseError> {
        self.skip_ws();
        let c = match self.peek() {
            Some(c) => c,
            None => return Ok(None),
        };
        let tok = match c {
            '{' => { self.pos += 1; Token::LBrace }
            '}' => { self.pos += 1; Token::RBrace }
            '[' => { self.pos += 1; Token::LBracket }
            ']' => { self.pos += 1; Token::RBracket }
            ':' => { self.pos += 1; Token::Colon }
            ',' => { self.pos += 1; Token::Comma }
            'n' => self.keyword("null", Token::Null)?,
            't' => self.keyword("true", Token::True)?,
            'f' => self.keyword("false", Token::False)?,
            '"' => Token::Str(self.lex_string()?),
            '-' | '0'..='9' => Token::Num(self.lex_number()?),
            other => return self.err(&format!("unexpected character `{other}`")),
        };
        Ok(Some(tok))
    }
}

pub fn tokenize(input: &str) -> Result<Vec<Token>, ParseError> {
    let mut lex = Lexer::new(input);
    let mut out = Vec::new();
    while let Some(t) = lex.next_token()? {
        out.push(t);
    }
    Ok(out)
}

pub struct Parser {
    lexer: Lexer,
    peeked: Option<Token>,
}

impl Parser {
    pub fn new(input: &str) -> Parser {
        Parser { lexer: Lexer::new(input), peeked: None }
    }

    fn take(&mut self) -> Result<Option<Token>, ParseError> {
        match self.peeked.take() {
            Some(t) => Ok(Some(t)),
            None => self.lexer.next_token(),
        }
    }

    fn peek_is(&mut self, want: &Token) -> Result<bool, ParseError> {
        if self.peeked.is_none() {
            self.peeked = self.lexer.next_token()?;
        }
        Ok(self.peeked.as_ref() == Some(want))
    }

    fn expect(&mut self, want: Token, what: &str) -> Result<(), ParseError> {
        let pos = self.lexer.pos();
        match self.take()? {
            Some(t) if t == want => Ok(()),
            _ => Err(ParseError { pos, msg: format!("expected {what}") }),
        }
    }

    fn parse_array(&mut self) -> Result<Value, ParseError> {
        let mut items = Vec::new();
        if self.peek_is(&Token::RBracket)? {
            self.take()?;
            return Ok(Value::Array(items));
        }
        loop {
            items.push(self.parse_value()?);
            if self.peek_is(&Token::Comma)? {
                self.take()?;
                continue;
            }
            self.expect(Token::RBracket, "`]` or `,`")?;
            return Ok(Value::Array(items));
        }
    }

    fn parse_object(&mut self) -> Result<Value, ParseError> {
        let mut members: Vec<(String, Value)> = Vec::new();
        if self.peek_is(&Token::RBrace)? {
            self.take()?;
            return Ok(Value::Object(members));
        }
        loop {
            let pos = self.lexer.pos();
            let key = match self.take()? {
                Some(Token::Str(s)) => s,
                _ => return Err(ParseError { pos, msg: "expected a string key".to_string() }),
            };
            self.expect(Token::Colon, "`:`")?;
            let val = self.parse_value()?;
            match members.iter().position(|(k, _)| k == key) {
                Some(i) => members[i] = (key, val),
                None => members.push((key, val)),
            }
            if self.peek_is(&Token::Comma)? {
                self.take()?;
                continue;
            }
            self.expect(Token::RBrace, "`}` or `,`")?;
            return Ok(Value::Object(members));
        }
    }

    pub fn parse_value(&mut self) -> Result<Value, ParseError> {
        let pos = self.lexer.pos();
        let tok = match self.take()? {
            Some(t) => t,
            None => return Err(ParseError { pos, msg: "unexpected end of input".to_string() }),
        };
        match tok {
            Token::Null => Ok(Value::Null),
            Token::True => Ok(Value::Bool(true)),
            Token::False => Ok(Value::Bool(false)),
            Token::Num(n) => Ok(Value::Number(n)),
            Token::Str(s) => Ok(Value::Str(s)),
            Token::LBracket => self.parse_array(),
            Token::LBrace => self.parse_object(),
            other => Err(ParseError { pos, msg: format!("unexpected token {other:?}") }),
        }
    }
}

pub fn parse(input: &str) -> Result<Value, ParseError> {
    let mut p = Parser::new(input);
    let v = p.parse_value()?;
    let pos = p.lexer.pos();
    match p.take()? {
        Some(t) => Err(ParseError { pos, msg: format!("trailing token {t:?}") }),
        None => Ok(v),
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_flat_object() {
        let v = parse(r#"{"a": 1, "b": null}"#).unwrap();
        assert_eq!(v.get("a"), Some(&Value::Number(1.0)));
        assert_eq!(v.get("b"), Some(&Value::Null));
        assert_eq!(v.get("c"), None);
        println!("{v:?}");
    }

    #[test]
    fn the_empty_object() {
        assert_eq!(parse("{}"), Ok(Value::Object(Vec::new())));
    }

    #[test]
    fn a_repeated_key_keeps_the_last_value() {
        let v = parse(r#"{"id": 1, "name": "x", "id": 2}"#).unwrap();
        assert_eq!(v.get("id"), Some(&Value::Number(2.0)));
        assert_eq!(v.count(), 3);
    }

    #[test]
    fn objects_and_arrays_nest_in_each_other() {
        let v = parse(r#"{"a": [{"b": [1]}]}"#).unwrap();
        let inner = v.get("a").unwrap();
        assert_eq!(inner.type_name(), "array");
        assert!(Value::Null.get("a").is_none());
        assert!(parse(r#"{1: 2}"#).is_err());
        assert!(parse(r#"{"a" 2}"#).is_err());
    }
}
```

```solution
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    Str(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    pub fn type_name(&self) -> &'static str {
        match self {
            Value::Null => "null",
            Value::Bool(_) => "bool",
            Value::Number(_) => "number",
            Value::Str(_) => "string",
            Value::Array(_) => "array",
            Value::Object(_) => "object",
        }
    }

    pub fn count(&self) -> usize {
        match self {
            Value::Array(items) => 1 + items.iter().map(|v| v.count()).sum::<usize>(),
            Value::Object(members) => 1 + members.iter().map(|(_, v)| v.count()).sum::<usize>(),
            _ => 1,
        }
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Object(members) => members.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
}

pub fn sample() -> Value {
    Value::Object(vec![
        ("name".to_string(), Value::Str("ferris".to_string())),
        ("id".to_string(), Value::Number(42.0)),
        (
            "tags".to_string(),
            Value::Array(vec![
                Value::Str("rust".to_string()),
                Value::Bool(true),
                Value::Null,
            ]),
        ),
    ])
}

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Colon,
    Comma,
    Null,
    True,
    False,
    Num(f64),
    Str(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParseError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at character {}", self.msg, self.pos)
    }
}

impl std::error::Error for ParseError {}

pub struct Lexer {
    src: Vec<char>,
    pos: usize,
}

impl Lexer {
    pub fn new(input: &str) -> Lexer {
        Lexer { src: input.chars().collect(), pos: 0 }
    }

    pub fn pos(&self) -> usize {
        self.pos
    }

    fn peek(&self) -> Option<char> {
        self.src.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    fn err<T>(&self, msg: &str) -> Result<T, ParseError> {
        Err(ParseError { pos: self.pos, msg: msg.to_string() })
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(' ') | Some('\t') | Some('\n') | Some('\r')) {
            self.pos += 1;
        }
    }

    fn keyword(&mut self, word: &str, tok: Token) -> Result<Token, ParseError> {
        for want in word.chars() {
            if self.bump() != Some(want) {
                return self.err(&format!("expected `{word}`"));
            }
        }
        Ok(tok)
    }

    fn lex_unicode(&mut self) -> Result<char, ParseError> {
        let mut n: u32 = 0;
        for _ in 0..4 {
            let c = match self.bump() {
                Some(c) => c,
                None => return self.err("`\\u` needs four hex digits"),
            };
            match c.to_digit(16) {
                Some(d) => n = n * 16 + d,
                None => return self.err("`\\u` needs four hex digits"),
            }
        }
        match char::from_u32(n) {
            Some(c) => Ok(c),
            None => self.err("`\\u` escape is not a character"),
        }
    }

    fn lex_string(&mut self) -> Result<String, ParseError> {
        self.pos += 1;
        let mut out = String::new();
        loop {
            let c = match self.bump() {
                Some(c) => c,
                None => return self.err("unterminated string"),
            };
            match c {
                '"' => return Ok(out),
                '\\' => {
                    let e = match self.bump() {
                        Some(e) => e,
                        None => return self.err("unterminated escape"),
                    };
                    match e {
                        '"' => out.push('"'),
                        '\\' => out.push('\\'),
                        '/' => out.push('/'),
                        'b' => out.push('\u{8}'),
                        'f' => out.push('\u{c}'),
                        'n' => out.push('\n'),
                        'r' => out.push('\r'),
                        't' => out.push('\t'),
                        'u' => {
                            let ch = self.lex_unicode()?;
                            out.push(ch);
                        }
                        other => return self.err(&format!("unknown escape `\\{other}`")),
                    }
                }
                c => out.push(c),
            }
        }
    }

    fn lex_number(&mut self) -> Result<f64, ParseError> {
        let start = self.pos;
        if self.peek() == Some('-') {
            self.pos += 1;
        }
        while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
            self.pos += 1;
        }
        if self.peek() == Some('.') {
            self.pos += 1;
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.pos += 1;
            }
        }
        if matches!(self.peek(), Some('e') | Some('E')) {
            self.pos += 1;
            if matches!(self.peek(), Some('+') | Some('-')) {
                self.pos += 1;
            }
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.pos += 1;
            }
        }
        let text: String = self.src[start..self.pos].iter().collect();
        match text.parse::<f64>() {
            Ok(n) => Ok(n),
            Err(_) => Err(ParseError { pos: start, msg: format!("bad number `{text}`") }),
        }
    }

    pub fn next_token(&mut self) -> Result<Option<Token>, ParseError> {
        self.skip_ws();
        let c = match self.peek() {
            Some(c) => c,
            None => return Ok(None),
        };
        let tok = match c {
            '{' => { self.pos += 1; Token::LBrace }
            '}' => { self.pos += 1; Token::RBrace }
            '[' => { self.pos += 1; Token::LBracket }
            ']' => { self.pos += 1; Token::RBracket }
            ':' => { self.pos += 1; Token::Colon }
            ',' => { self.pos += 1; Token::Comma }
            'n' => self.keyword("null", Token::Null)?,
            't' => self.keyword("true", Token::True)?,
            'f' => self.keyword("false", Token::False)?,
            '"' => Token::Str(self.lex_string()?),
            '-' | '0'..='9' => Token::Num(self.lex_number()?),
            other => return self.err(&format!("unexpected character `{other}`")),
        };
        Ok(Some(tok))
    }
}

pub fn tokenize(input: &str) -> Result<Vec<Token>, ParseError> {
    let mut lex = Lexer::new(input);
    let mut out = Vec::new();
    while let Some(t) = lex.next_token()? {
        out.push(t);
    }
    Ok(out)
}

pub struct Parser {
    lexer: Lexer,
    peeked: Option<Token>,
}

impl Parser {
    pub fn new(input: &str) -> Parser {
        Parser { lexer: Lexer::new(input), peeked: None }
    }

    fn take(&mut self) -> Result<Option<Token>, ParseError> {
        match self.peeked.take() {
            Some(t) => Ok(Some(t)),
            None => self.lexer.next_token(),
        }
    }

    fn peek_is(&mut self, want: &Token) -> Result<bool, ParseError> {
        if self.peeked.is_none() {
            self.peeked = self.lexer.next_token()?;
        }
        Ok(self.peeked.as_ref() == Some(want))
    }

    fn expect(&mut self, want: Token, what: &str) -> Result<(), ParseError> {
        let pos = self.lexer.pos();
        match self.take()? {
            Some(t) if t == want => Ok(()),
            _ => Err(ParseError { pos, msg: format!("expected {what}") }),
        }
    }

    fn parse_array(&mut self) -> Result<Value, ParseError> {
        let mut items = Vec::new();
        if self.peek_is(&Token::RBracket)? {
            self.take()?;
            return Ok(Value::Array(items));
        }
        loop {
            items.push(self.parse_value()?);
            if self.peek_is(&Token::Comma)? {
                self.take()?;
                continue;
            }
            self.expect(Token::RBracket, "`]` or `,`")?;
            return Ok(Value::Array(items));
        }
    }

    fn parse_object(&mut self) -> Result<Value, ParseError> {
        let mut members: Vec<(String, Value)> = Vec::new();
        if self.peek_is(&Token::RBrace)? {
            self.take()?;
            return Ok(Value::Object(members));
        }
        loop {
            let pos = self.lexer.pos();
            let key = match self.take()? {
                Some(Token::Str(s)) => s,
                _ => return Err(ParseError { pos, msg: "expected a string key".to_string() }),
            };
            self.expect(Token::Colon, "`:`")?;
            let val = self.parse_value()?;
            match members.iter().position(|(k, _)| *k == key) {
                Some(i) => members[i] = (key, val),
                None => members.push((key, val)),
            }
            if self.peek_is(&Token::Comma)? {
                self.take()?;
                continue;
            }
            self.expect(Token::RBrace, "`}` or `,`")?;
            return Ok(Value::Object(members));
        }
    }

    pub fn parse_value(&mut self) -> Result<Value, ParseError> {
        let pos = self.lexer.pos();
        let tok = match self.take()? {
            Some(t) => t,
            None => return Err(ParseError { pos, msg: "unexpected end of input".to_string() }),
        };
        match tok {
            Token::Null => Ok(Value::Null),
            Token::True => Ok(Value::Bool(true)),
            Token::False => Ok(Value::Bool(false)),
            Token::Num(n) => Ok(Value::Number(n)),
            Token::Str(s) => Ok(Value::Str(s)),
            Token::LBracket => self.parse_array(),
            Token::LBrace => self.parse_object(),
            other => Err(ParseError { pos, msg: format!("unexpected token {other:?}") }),
        }
    }
}

pub fn parse(input: &str) -> Result<Value, ParseError> {
    let mut p = Parser::new(input);
    let v = p.parse_value()?;
    let pos = p.lexer.pos();
    match p.take()? {
        Some(t) => Err(ParseError { pos, msg: format!("trailing token {t:?}") }),
        None => Ok(v),
    }
}
```

@hint The closure destructures a `&(String, Value)`, so the pattern `(k, _)` gives you a reference where the other side of the comparison is not one.
@hint Dereference the left side with `*k == key`, or borrow the right with `k == &key`. Both compile; the first reads better.
@hint For `get`, only the `Object` variant can have members, so match on `self` and return `None` for everything else. `iter().find(...).map(...)` does the rest.

@diagnose E0277
`can't compare &String with String`. The closure parameter pattern `(k, _)`
binds against a `&(String, Value)`, and match ergonomics makes every binding
under it a reference, so `k` is a `&String`. `key` is an owned `String`.

The standard library provides `PartialEq<String> for String` and
`PartialEq<&str> for String`, but not `PartialEq<String> for &String`. Rather
than add impls for every combination of reference depth, the language expects
you to line the two sides up yourself.

`*k == key` dereferences and compares `String` with `String`. This is the same
adjustment behind `find(|(k, _)| k == key)` in `Value::get`, where the other
side is a `&str` and `&String` derefs to `&str` on its own.

@diagnose E0507
Reading `key` in the comparison and then moving it into `members[i] = (key, val)`
is fine, because the comparison only borrows. If you tried to build the tuple
before the lookup you would move `key` first and have nothing left to compare.
Keep the search above the insert.

@after
Last one wins is what `serde_json` does, and what almost every JSON library
does, because its object is backed by a map and the second insert overwrites.
The specification allows anything: keeping the first, keeping the last, or
rejecting the document.

That ambiguity has been exploited. Two services parsing the same body with
different libraries can disagree about `{"amount": 1, "amount": 1000}`, which
turns a parser detail into an authorisation bug. Rejecting duplicates outright
is the safest policy for anything security-sensitive, and it is one `return
Err(...)` where the `Some(i)` arm currently sits.

Keeping members in a `Vec` rather than a `HashMap` preserves document order and
makes lookup linear. `serde_json` defaults to `BTreeMap`, which sorts keys, and
offers `preserve_order` to switch to an insertion-ordered map.

## 8. Print it back

@kind fix
@concept display
@expect E0046

The parser is finished. What is missing is the other direction: a `Display` impl
that turns a `Value` back into JSON text, so that parsing the output gives the
same value again.

`write_json_string` handles the quoting. Write `fmt`. Six arms, two of them
recursive.

```starter
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    Str(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    pub fn type_name(&self) -> &'static str {
        match self {
            Value::Null => "null",
            Value::Bool(_) => "bool",
            Value::Number(_) => "number",
            Value::Str(_) => "string",
            Value::Array(_) => "array",
            Value::Object(_) => "object",
        }
    }

    pub fn count(&self) -> usize {
        match self {
            Value::Array(items) => 1 + items.iter().map(|v| v.count()).sum::<usize>(),
            Value::Object(members) => 1 + members.iter().map(|(_, v)| v.count()).sum::<usize>(),
            _ => 1,
        }
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Object(members) => members.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
}

pub fn sample() -> Value {
    Value::Object(vec![
        ("name".to_string(), Value::Str("ferris".to_string())),
        ("id".to_string(), Value::Number(42.0)),
        (
            "tags".to_string(),
            Value::Array(vec![
                Value::Str("rust".to_string()),
                Value::Bool(true),
                Value::Null,
            ]),
        ),
    ])
}

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Colon,
    Comma,
    Null,
    True,
    False,
    Num(f64),
    Str(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParseError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at character {}", self.msg, self.pos)
    }
}

impl std::error::Error for ParseError {}

pub struct Lexer {
    src: Vec<char>,
    pos: usize,
}

impl Lexer {
    pub fn new(input: &str) -> Lexer {
        Lexer { src: input.chars().collect(), pos: 0 }
    }

    pub fn pos(&self) -> usize {
        self.pos
    }

    fn peek(&self) -> Option<char> {
        self.src.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    fn err<T>(&self, msg: &str) -> Result<T, ParseError> {
        Err(ParseError { pos: self.pos, msg: msg.to_string() })
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(' ') | Some('\t') | Some('\n') | Some('\r')) {
            self.pos += 1;
        }
    }

    fn keyword(&mut self, word: &str, tok: Token) -> Result<Token, ParseError> {
        for want in word.chars() {
            if self.bump() != Some(want) {
                return self.err(&format!("expected `{word}`"));
            }
        }
        Ok(tok)
    }

    fn lex_unicode(&mut self) -> Result<char, ParseError> {
        let mut n: u32 = 0;
        for _ in 0..4 {
            let c = match self.bump() {
                Some(c) => c,
                None => return self.err("`\\u` needs four hex digits"),
            };
            match c.to_digit(16) {
                Some(d) => n = n * 16 + d,
                None => return self.err("`\\u` needs four hex digits"),
            }
        }
        match char::from_u32(n) {
            Some(c) => Ok(c),
            None => self.err("`\\u` escape is not a character"),
        }
    }

    fn lex_string(&mut self) -> Result<String, ParseError> {
        self.pos += 1;
        let mut out = String::new();
        loop {
            let c = match self.bump() {
                Some(c) => c,
                None => return self.err("unterminated string"),
            };
            match c {
                '"' => return Ok(out),
                '\\' => {
                    let e = match self.bump() {
                        Some(e) => e,
                        None => return self.err("unterminated escape"),
                    };
                    match e {
                        '"' => out.push('"'),
                        '\\' => out.push('\\'),
                        '/' => out.push('/'),
                        'b' => out.push('\u{8}'),
                        'f' => out.push('\u{c}'),
                        'n' => out.push('\n'),
                        'r' => out.push('\r'),
                        't' => out.push('\t'),
                        'u' => {
                            let ch = self.lex_unicode()?;
                            out.push(ch);
                        }
                        other => return self.err(&format!("unknown escape `\\{other}`")),
                    }
                }
                c => out.push(c),
            }
        }
    }

    fn lex_number(&mut self) -> Result<f64, ParseError> {
        let start = self.pos;
        if self.peek() == Some('-') {
            self.pos += 1;
        }
        while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
            self.pos += 1;
        }
        if self.peek() == Some('.') {
            self.pos += 1;
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.pos += 1;
            }
        }
        if matches!(self.peek(), Some('e') | Some('E')) {
            self.pos += 1;
            if matches!(self.peek(), Some('+') | Some('-')) {
                self.pos += 1;
            }
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.pos += 1;
            }
        }
        let text: String = self.src[start..self.pos].iter().collect();
        match text.parse::<f64>() {
            Ok(n) => Ok(n),
            Err(_) => Err(ParseError { pos: start, msg: format!("bad number `{text}`") }),
        }
    }

    pub fn next_token(&mut self) -> Result<Option<Token>, ParseError> {
        self.skip_ws();
        let c = match self.peek() {
            Some(c) => c,
            None => return Ok(None),
        };
        let tok = match c {
            '{' => { self.pos += 1; Token::LBrace }
            '}' => { self.pos += 1; Token::RBrace }
            '[' => { self.pos += 1; Token::LBracket }
            ']' => { self.pos += 1; Token::RBracket }
            ':' => { self.pos += 1; Token::Colon }
            ',' => { self.pos += 1; Token::Comma }
            'n' => self.keyword("null", Token::Null)?,
            't' => self.keyword("true", Token::True)?,
            'f' => self.keyword("false", Token::False)?,
            '"' => Token::Str(self.lex_string()?),
            '-' | '0'..='9' => Token::Num(self.lex_number()?),
            other => return self.err(&format!("unexpected character `{other}`")),
        };
        Ok(Some(tok))
    }
}

pub fn tokenize(input: &str) -> Result<Vec<Token>, ParseError> {
    let mut lex = Lexer::new(input);
    let mut out = Vec::new();
    while let Some(t) = lex.next_token()? {
        out.push(t);
    }
    Ok(out)
}

pub struct Parser {
    lexer: Lexer,
    peeked: Option<Token>,
}

impl Parser {
    pub fn new(input: &str) -> Parser {
        Parser { lexer: Lexer::new(input), peeked: None }
    }

    fn take(&mut self) -> Result<Option<Token>, ParseError> {
        match self.peeked.take() {
            Some(t) => Ok(Some(t)),
            None => self.lexer.next_token(),
        }
    }

    fn peek_is(&mut self, want: &Token) -> Result<bool, ParseError> {
        if self.peeked.is_none() {
            self.peeked = self.lexer.next_token()?;
        }
        Ok(self.peeked.as_ref() == Some(want))
    }

    fn expect(&mut self, want: Token, what: &str) -> Result<(), ParseError> {
        let pos = self.lexer.pos();
        match self.take()? {
            Some(t) if t == want => Ok(()),
            _ => Err(ParseError { pos, msg: format!("expected {what}") }),
        }
    }

    fn parse_array(&mut self) -> Result<Value, ParseError> {
        let mut items = Vec::new();
        if self.peek_is(&Token::RBracket)? {
            self.take()?;
            return Ok(Value::Array(items));
        }
        loop {
            items.push(self.parse_value()?);
            if self.peek_is(&Token::Comma)? {
                self.take()?;
                continue;
            }
            self.expect(Token::RBracket, "`]` or `,`")?;
            return Ok(Value::Array(items));
        }
    }

    fn parse_object(&mut self) -> Result<Value, ParseError> {
        let mut members: Vec<(String, Value)> = Vec::new();
        if self.peek_is(&Token::RBrace)? {
            self.take()?;
            return Ok(Value::Object(members));
        }
        loop {
            let pos = self.lexer.pos();
            let key = match self.take()? {
                Some(Token::Str(s)) => s,
                _ => return Err(ParseError { pos, msg: "expected a string key".to_string() }),
            };
            self.expect(Token::Colon, "`:`")?;
            let val = self.parse_value()?;
            match members.iter().position(|(k, _)| *k == key) {
                Some(i) => members[i] = (key, val),
                None => members.push((key, val)),
            }
            if self.peek_is(&Token::Comma)? {
                self.take()?;
                continue;
            }
            self.expect(Token::RBrace, "`}` or `,`")?;
            return Ok(Value::Object(members));
        }
    }

    pub fn parse_value(&mut self) -> Result<Value, ParseError> {
        let pos = self.lexer.pos();
        let tok = match self.take()? {
            Some(t) => t,
            None => return Err(ParseError { pos, msg: "unexpected end of input".to_string() }),
        };
        match tok {
            Token::Null => Ok(Value::Null),
            Token::True => Ok(Value::Bool(true)),
            Token::False => Ok(Value::Bool(false)),
            Token::Num(n) => Ok(Value::Number(n)),
            Token::Str(s) => Ok(Value::Str(s)),
            Token::LBracket => self.parse_array(),
            Token::LBrace => self.parse_object(),
            other => Err(ParseError { pos, msg: format!("unexpected token {other:?}") }),
        }
    }
}

pub fn parse(input: &str) -> Result<Value, ParseError> {
    let mut p = Parser::new(input);
    let v = p.parse_value()?;
    let pos = p.lexer.pos();
    match p.take()? {
        Some(t) => Err(ParseError { pos, msg: format!("trailing token {t:?}") }),
        None => Ok(v),
    }
}

fn write_json_string(f: &mut fmt::Formatter, s: &str) -> fmt::Result {
    write!(f, "\"")?;
    for c in s.chars() {
        match c {
            '"' => write!(f, "\\\"")?,
            '\\' => write!(f, "\\\\")?,
            '\n' => write!(f, "\\n")?,
            '\r' => write!(f, "\\r")?,
            '\t' => write!(f, "\\t")?,
            c if (c as u32) < 0x20 => write!(f, "\\u{:04x}", c as u32)?,
            c => write!(f, "{c}")?,
        }
    }
    write!(f, "\"")
}

impl fmt::Display for Value {
}

pub const DOC: &str = r#"{
    "name": "ferris ❤",
    "id": 42,
    "scale": 1.5e3,
    "tags": ["rust", "crab", []],
    "meta": { "active": true, "parent": null },
    "id": 43
}"#;

pub fn demo() -> String {
    match parse(DOC) {
        Ok(v) => v.to_string(),
        Err(e) => format!("error: {e}"),
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_realistic_document() {
        let v = parse(DOC).expect("document should parse");
        assert_eq!(v.get("name"), Some(&Value::Str("ferris \u{2764}".to_string())));
        assert_eq!(v.get("scale"), Some(&Value::Number(1500.0)));
        assert_eq!(v.get("id"), Some(&Value::Number(43.0)));
        assert_eq!(v.get("meta").and_then(|m| m.get("parent")), Some(&Value::Null));
    }

    #[test]
    fn display_round_trips() {
        let v = parse(DOC).unwrap();
        let text = v.to_string();
        println!("{text}");
        assert_eq!(parse(&text).unwrap(), v);
    }

    #[test]
    fn escapes_survive_a_round_trip() {
        let v = parse(r#"{"a":"line\none\ttab"}"#).unwrap();
        assert_eq!(v.to_string(), r#"{"a":"line\none\ttab"}"#);
        assert_eq!(parse(&v.to_string()).unwrap(), v);
    }

    #[test]
    fn the_scalars_and_the_empty_containers() {
        assert_eq!(Value::Null.to_string(), "null");
        assert_eq!(Value::Bool(false).to_string(), "false");
        assert_eq!(Value::Number(1.0).to_string(), "1");
        assert_eq!(Value::Array(Vec::new()).to_string(), "[]");
        assert_eq!(Value::Object(Vec::new()).to_string(), "{}");
        assert_eq!(sample().count(), 7);
    }

    #[test]
    fn demo_prints_the_document() {
        println!("{}", demo());
        assert!(demo().starts_with("{\"name\""));
    }
}
```

```solution
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    Str(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    pub fn type_name(&self) -> &'static str {
        match self {
            Value::Null => "null",
            Value::Bool(_) => "bool",
            Value::Number(_) => "number",
            Value::Str(_) => "string",
            Value::Array(_) => "array",
            Value::Object(_) => "object",
        }
    }

    pub fn count(&self) -> usize {
        match self {
            Value::Array(items) => 1 + items.iter().map(|v| v.count()).sum::<usize>(),
            Value::Object(members) => 1 + members.iter().map(|(_, v)| v.count()).sum::<usize>(),
            _ => 1,
        }
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Object(members) => members.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
}

pub fn sample() -> Value {
    Value::Object(vec![
        ("name".to_string(), Value::Str("ferris".to_string())),
        ("id".to_string(), Value::Number(42.0)),
        (
            "tags".to_string(),
            Value::Array(vec![
                Value::Str("rust".to_string()),
                Value::Bool(true),
                Value::Null,
            ]),
        ),
    ])
}

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Colon,
    Comma,
    Null,
    True,
    False,
    Num(f64),
    Str(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParseError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at character {}", self.msg, self.pos)
    }
}

impl std::error::Error for ParseError {}

pub struct Lexer {
    src: Vec<char>,
    pos: usize,
}

impl Lexer {
    pub fn new(input: &str) -> Lexer {
        Lexer { src: input.chars().collect(), pos: 0 }
    }

    pub fn pos(&self) -> usize {
        self.pos
    }

    fn peek(&self) -> Option<char> {
        self.src.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    fn err<T>(&self, msg: &str) -> Result<T, ParseError> {
        Err(ParseError { pos: self.pos, msg: msg.to_string() })
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(' ') | Some('\t') | Some('\n') | Some('\r')) {
            self.pos += 1;
        }
    }

    fn keyword(&mut self, word: &str, tok: Token) -> Result<Token, ParseError> {
        for want in word.chars() {
            if self.bump() != Some(want) {
                return self.err(&format!("expected `{word}`"));
            }
        }
        Ok(tok)
    }

    fn lex_unicode(&mut self) -> Result<char, ParseError> {
        let mut n: u32 = 0;
        for _ in 0..4 {
            let c = match self.bump() {
                Some(c) => c,
                None => return self.err("`\\u` needs four hex digits"),
            };
            match c.to_digit(16) {
                Some(d) => n = n * 16 + d,
                None => return self.err("`\\u` needs four hex digits"),
            }
        }
        match char::from_u32(n) {
            Some(c) => Ok(c),
            None => self.err("`\\u` escape is not a character"),
        }
    }

    fn lex_string(&mut self) -> Result<String, ParseError> {
        self.pos += 1;
        let mut out = String::new();
        loop {
            let c = match self.bump() {
                Some(c) => c,
                None => return self.err("unterminated string"),
            };
            match c {
                '"' => return Ok(out),
                '\\' => {
                    let e = match self.bump() {
                        Some(e) => e,
                        None => return self.err("unterminated escape"),
                    };
                    match e {
                        '"' => out.push('"'),
                        '\\' => out.push('\\'),
                        '/' => out.push('/'),
                        'b' => out.push('\u{8}'),
                        'f' => out.push('\u{c}'),
                        'n' => out.push('\n'),
                        'r' => out.push('\r'),
                        't' => out.push('\t'),
                        'u' => {
                            let ch = self.lex_unicode()?;
                            out.push(ch);
                        }
                        other => return self.err(&format!("unknown escape `\\{other}`")),
                    }
                }
                c => out.push(c),
            }
        }
    }

    fn lex_number(&mut self) -> Result<f64, ParseError> {
        let start = self.pos;
        if self.peek() == Some('-') {
            self.pos += 1;
        }
        while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
            self.pos += 1;
        }
        if self.peek() == Some('.') {
            self.pos += 1;
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.pos += 1;
            }
        }
        if matches!(self.peek(), Some('e') | Some('E')) {
            self.pos += 1;
            if matches!(self.peek(), Some('+') | Some('-')) {
                self.pos += 1;
            }
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.pos += 1;
            }
        }
        let text: String = self.src[start..self.pos].iter().collect();
        match text.parse::<f64>() {
            Ok(n) => Ok(n),
            Err(_) => Err(ParseError { pos: start, msg: format!("bad number `{text}`") }),
        }
    }

    pub fn next_token(&mut self) -> Result<Option<Token>, ParseError> {
        self.skip_ws();
        let c = match self.peek() {
            Some(c) => c,
            None => return Ok(None),
        };
        let tok = match c {
            '{' => { self.pos += 1; Token::LBrace }
            '}' => { self.pos += 1; Token::RBrace }
            '[' => { self.pos += 1; Token::LBracket }
            ']' => { self.pos += 1; Token::RBracket }
            ':' => { self.pos += 1; Token::Colon }
            ',' => { self.pos += 1; Token::Comma }
            'n' => self.keyword("null", Token::Null)?,
            't' => self.keyword("true", Token::True)?,
            'f' => self.keyword("false", Token::False)?,
            '"' => Token::Str(self.lex_string()?),
            '-' | '0'..='9' => Token::Num(self.lex_number()?),
            other => return self.err(&format!("unexpected character `{other}`")),
        };
        Ok(Some(tok))
    }
}

pub fn tokenize(input: &str) -> Result<Vec<Token>, ParseError> {
    let mut lex = Lexer::new(input);
    let mut out = Vec::new();
    while let Some(t) = lex.next_token()? {
        out.push(t);
    }
    Ok(out)
}

pub struct Parser {
    lexer: Lexer,
    peeked: Option<Token>,
}

impl Parser {
    pub fn new(input: &str) -> Parser {
        Parser { lexer: Lexer::new(input), peeked: None }
    }

    fn take(&mut self) -> Result<Option<Token>, ParseError> {
        match self.peeked.take() {
            Some(t) => Ok(Some(t)),
            None => self.lexer.next_token(),
        }
    }

    fn peek_is(&mut self, want: &Token) -> Result<bool, ParseError> {
        if self.peeked.is_none() {
            self.peeked = self.lexer.next_token()?;
        }
        Ok(self.peeked.as_ref() == Some(want))
    }

    fn expect(&mut self, want: Token, what: &str) -> Result<(), ParseError> {
        let pos = self.lexer.pos();
        match self.take()? {
            Some(t) if t == want => Ok(()),
            _ => Err(ParseError { pos, msg: format!("expected {what}") }),
        }
    }

    fn parse_array(&mut self) -> Result<Value, ParseError> {
        let mut items = Vec::new();
        if self.peek_is(&Token::RBracket)? {
            self.take()?;
            return Ok(Value::Array(items));
        }
        loop {
            items.push(self.parse_value()?);
            if self.peek_is(&Token::Comma)? {
                self.take()?;
                continue;
            }
            self.expect(Token::RBracket, "`]` or `,`")?;
            return Ok(Value::Array(items));
        }
    }

    fn parse_object(&mut self) -> Result<Value, ParseError> {
        let mut members: Vec<(String, Value)> = Vec::new();
        if self.peek_is(&Token::RBrace)? {
            self.take()?;
            return Ok(Value::Object(members));
        }
        loop {
            let pos = self.lexer.pos();
            let key = match self.take()? {
                Some(Token::Str(s)) => s,
                _ => return Err(ParseError { pos, msg: "expected a string key".to_string() }),
            };
            self.expect(Token::Colon, "`:`")?;
            let val = self.parse_value()?;
            match members.iter().position(|(k, _)| *k == key) {
                Some(i) => members[i] = (key, val),
                None => members.push((key, val)),
            }
            if self.peek_is(&Token::Comma)? {
                self.take()?;
                continue;
            }
            self.expect(Token::RBrace, "`}` or `,`")?;
            return Ok(Value::Object(members));
        }
    }

    pub fn parse_value(&mut self) -> Result<Value, ParseError> {
        let pos = self.lexer.pos();
        let tok = match self.take()? {
            Some(t) => t,
            None => return Err(ParseError { pos, msg: "unexpected end of input".to_string() }),
        };
        match tok {
            Token::Null => Ok(Value::Null),
            Token::True => Ok(Value::Bool(true)),
            Token::False => Ok(Value::Bool(false)),
            Token::Num(n) => Ok(Value::Number(n)),
            Token::Str(s) => Ok(Value::Str(s)),
            Token::LBracket => self.parse_array(),
            Token::LBrace => self.parse_object(),
            other => Err(ParseError { pos, msg: format!("unexpected token {other:?}") }),
        }
    }
}

pub fn parse(input: &str) -> Result<Value, ParseError> {
    let mut p = Parser::new(input);
    let v = p.parse_value()?;
    let pos = p.lexer.pos();
    match p.take()? {
        Some(t) => Err(ParseError { pos, msg: format!("trailing token {t:?}") }),
        None => Ok(v),
    }
}

fn write_json_string(f: &mut fmt::Formatter, s: &str) -> fmt::Result {
    write!(f, "\"")?;
    for c in s.chars() {
        match c {
            '"' => write!(f, "\\\"")?,
            '\\' => write!(f, "\\\\")?,
            '\n' => write!(f, "\\n")?,
            '\r' => write!(f, "\\r")?,
            '\t' => write!(f, "\\t")?,
            c if (c as u32) < 0x20 => write!(f, "\\u{:04x}", c as u32)?,
            c => write!(f, "{c}")?,
        }
    }
    write!(f, "\"")
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Value::Null => write!(f, "null"),
            Value::Bool(b) => write!(f, "{b}"),
            Value::Number(n) => write!(f, "{n}"),
            Value::Str(s) => write_json_string(f, s),
            Value::Array(items) => {
                write!(f, "[")?;
                for (i, v) in items.iter().enumerate() {
                    if i > 0 {
                        write!(f, ",")?;
                    }
                    write!(f, "{v}")?;
                }
                write!(f, "]")
            }
            Value::Object(members) => {
                write!(f, "{{")?;
                for (i, (k, v)) in members.iter().enumerate() {
                    if i > 0 {
                        write!(f, ",")?;
                    }
                    write_json_string(f, k)?;
                    write!(f, ":{v}")?;
                }
                write!(f, "}}")
            }
        }
    }
}

pub const DOC: &str = r#"{
    "name": "ferris ❤",
    "id": 42,
    "scale": 1.5e3,
    "tags": ["rust", "crab", []],
    "meta": { "active": true, "parent": null },
    "id": 43
}"#;

pub fn demo() -> String {
    match parse(DOC) {
        Ok(v) => v.to_string(),
        Err(e) => format!("error: {e}"),
    }
}
```

@hint The trait has exactly one required method, and its signature is right there on the `ParseError` impl a few hundred lines above.
@hint Inside `fmt`, `write!(f, "{v}")` on a nested `Value` calls this same method recursively, which is how arrays and objects print their contents.
@hint A literal brace in a format string is written `{{` or `}}`, so the object arm opens with `write!(f, "{{")?`.

@diagnose E0046
`not all trait items implemented, missing: fmt`. `Display` has one required
method and the impl block is empty, so the impl is a promise with nothing behind
it.

Note that `demo` and `v.to_string()` compile fine. `ToString` has a blanket impl
for every `T: Display`, so the moment the impl block exists, `to_string` is
available; only the body is missing. That is why this is the one error rather
than a pile of "method not found".

The signature to copy is
`fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result`. Every arm has to return
that `fmt::Result`, which is why the intermediate `write!` calls end in `?` and
the last one does not.

@diagnose E0004
The match inside `fmt` needs an arm for all six variants. There is no sensible
catch-all here: a printer that silently emits nothing for one kind of value
produces output that will not parse.

@after
Writing through a `Formatter` rather than building a `String` is the reason this
scales. `write!` appends into whatever the caller supplied, so
`println!("{v}")` streams straight to stdout and `v.to_string()` allocates
exactly once, with no intermediate strings per nesting level.

The round trip in the test is a real property and a good one to reach for. Parse
a document, print it, parse the output: the two values must be equal.
Any escaping bug, any dropped member, any number that prints in a form the lexer
cannot read shows up immediately, and the test writes itself.

What is missing compared to `serde_json` is indentation (a second impl using
`{:#}` and `f.alternate()`), sorted keys, and escaping of non-ASCII characters
for transports that are not eight-bit clean. The parser underneath is the same
one you just wrote.
