---
project: http-server
tier: core
domain: network
title: An HTTP server
accent: clay
blurb: Parse HTTP/1.1 by hand, byte slice in and byte slice out, then wire the eight pure functions you wrote to a TcpListener and a thread per connection.
needs: 07-slices, 12-errors, 21-concurrency
mins: 80
---

HTTP/1.1 is a text protocol from 1997 and it still carries most of the traffic
you will ever have to debug. A request is one line, some headers, a blank line,
and possibly some bytes. That is small enough to write out by hand, and worth
writing once, because every framework you reach for afterwards is a pile of
decisions about the details you are about to meet: what a header name means when
the case differs, how a reader knows where a body ends, when a connection is
allowed to stay open.

Eight stages, and by the end you have a server. A request-line parser over raw
bytes. A header list with lookup that ignores ASCII case. Body framing from
`Content-Length`, including the two-framings-at-once case that gets real proxies
compromised. A `Response` type that serialises with the line endings the
specification actually requires. A router with parameters like `/users/:id`. A
404 that means something different from a 405. A keep-alive decision. Then the
accept loop, `TcpListener` and a thread per connection, written out in full.

Almost all of that is pure functions over `&[u8]` and `&str`, which is the point.
A socket delivers bytes and nothing else, so every decision a server makes is a
function of a byte slice, and a function of a byte slice can be tested by handing
it one. The tests here never bind a port. The final stage prints three pipelined
requests being answered out of a single buffer, and the socket code beside it is
there to copy into a Cargo project and point `curl` at.

It is a toy in the ways that matter for a public port: nothing times out, the
thread count is unbounded, there is no TLS, and a client may send as much as it
likes. Stage 8 says what each of those costs.

## 1. The request line

@kind fix
@concept slice

@expect E0277

The first line of a request is a method, a target and a version, separated by
single spaces. `parse_request_line` takes the raw bytes, because that is what a
socket hands you, and returns a `RequestLine` or an error. Anything malformed is
an `Err`, and the function never panics. One conversion is written as though it
could not fail.

```starter
pub const RAW: &[u8] = b"GET /users/7?tab=logs HTTP/1.1\r\nHost: localhost:8080\r\nUser-Agent: curl/8.4.0\r\nContent-Length: 11\r\n\r\nhello world";

#[derive(Debug, PartialEq)]
pub enum ParseError {
    NotUtf8,
    Malformed,
    UnsupportedVersion,
}

#[derive(Debug, PartialEq)]
pub struct RequestLine {
    pub method: String,
    pub target: String,
    pub version: String,
}

pub fn first_line(raw: &[u8]) -> &[u8] {
    let end = raw.windows(2).position(|w| w == b"\r\n").unwrap_or(raw.len());
    &raw[..end]
}

pub fn parse_request_line(line: &[u8]) -> Result<RequestLine, ParseError> {
    let text = std::str::from_utf8(line)?;
    let mut parts = text.split(' ');
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let version = parts.next().unwrap_or("");

    if parts.next().is_some() || method.is_empty() || target.is_empty() {
        return Err(ParseError::Malformed);
    }
    if version != "HTTP/1.0" && version != "HTTP/1.1" {
        return Err(ParseError::UnsupportedVersion);
    }
    Ok(RequestLine {
        method: method.to_string(),
        target: target.to_string(),
        version: version.to_string(),
    })
}

pub fn run() -> RequestLine {
    let line = parse_request_line(first_line(RAW)).expect("the sample line is well formed");
    println!("method  {}", line.method);
    println!("target  {}", line.target);
    println!("version {}", line.version);
    line
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_sample() {
        let line = run();
        assert_eq!(line.method, "GET");
        assert_eq!(line.target, "/users/7?tab=logs");
        assert_eq!(line.version, "HTTP/1.1");
    }

    #[test]
    fn first_line_stops_at_the_crlf() {
        assert_eq!(first_line(RAW), b"GET /users/7?tab=logs HTTP/1.1");
        assert_eq!(first_line(b"GET / HTTP/1.1"), b"GET / HTTP/1.1");
    }

    #[test]
    fn malformed_input_is_an_error_not_a_panic() {
        assert_eq!(parse_request_line(b""), Err(ParseError::Malformed));
        assert_eq!(parse_request_line(b"GET"), Err(ParseError::Malformed));
        assert_eq!(parse_request_line(b"GET  / HTTP/1.1"), Err(ParseError::Malformed));
        assert_eq!(parse_request_line(b"GET / HTTP/1.1 junk"), Err(ParseError::Malformed));
    }

    #[test]
    fn other_versions_are_refused() {
        assert_eq!(parse_request_line(b"GET / HTTP/2.0"), Err(ParseError::UnsupportedVersion));
        assert_eq!(parse_request_line(b"GET / http/1.1"), Err(ParseError::UnsupportedVersion));
    }

    #[test]
    fn bytes_that_are_not_utf8_are_an_error() {
        assert_eq!(parse_request_line(b"GET /\xff HTTP/1.1"), Err(ParseError::NotUtf8));
    }
}
```

```solution
pub const RAW: &[u8] = b"GET /users/7?tab=logs HTTP/1.1\r\nHost: localhost:8080\r\nUser-Agent: curl/8.4.0\r\nContent-Length: 11\r\n\r\nhello world";

#[derive(Debug, PartialEq)]
pub enum ParseError {
    NotUtf8,
    Malformed,
    UnsupportedVersion,
}

#[derive(Debug, PartialEq)]
pub struct RequestLine {
    pub method: String,
    pub target: String,
    pub version: String,
}

pub fn first_line(raw: &[u8]) -> &[u8] {
    let end = raw.windows(2).position(|w| w == b"\r\n").unwrap_or(raw.len());
    &raw[..end]
}

pub fn parse_request_line(line: &[u8]) -> Result<RequestLine, ParseError> {
    let text = std::str::from_utf8(line).map_err(|_| ParseError::NotUtf8)?;
    let mut parts = text.split(' ');
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let version = parts.next().unwrap_or("");

    if parts.next().is_some() || method.is_empty() || target.is_empty() {
        return Err(ParseError::Malformed);
    }
    if version != "HTTP/1.0" && version != "HTTP/1.1" {
        return Err(ParseError::UnsupportedVersion);
    }
    Ok(RequestLine {
        method: method.to_string(),
        target: target.to_string(),
        version: version.to_string(),
    })
}

pub fn run() -> RequestLine {
    let line = parse_request_line(first_line(RAW)).expect("the sample line is well formed");
    println!("method  {}", line.method);
    println!("target  {}", line.target);
    println!("version {}", line.version);
    line
}
```

@hint `std::str::from_utf8` returns a `Result`, but not one whose error is yours.
@hint `?` does not just unwrap. It converts the error into the function's error type, using `From`, and there is no `From<Utf8Error> for ParseError` in this file.
@hint `.map_err(|_| ParseError::NotUtf8)?` turns the error into yours before `?` sees it.

@diagnose E0277
`the trait bound ParseError: From<Utf8Error> is not satisfied`, reported as
"`?` couldn't convert the error to `ParseError`".

`?` is two operations. It returns early on `Err`, and on the way out it calls
`From::from` on the error value, so that a function can collect several failure
types into one. That second half is what fails here. `from_utf8` fails with
`Utf8Error`, this function fails with `ParseError`, and nothing tells rustc how
one becomes the other.

Two fixes, and both are used in real code. Write `impl From<Utf8Error> for
ParseError` and every `?` on a UTF-8 check works from then on. Or convert at the
call site with `map_err`, which is what this file does, because the error carries
no information worth keeping.

@diagnose E0308
`expected RequestLine, found Result<RequestLine, ParseError>`, or the mirror of
it. Every path out of this function has to produce the same type, and the
successful path has to be wrapped: `Ok(RequestLine { .. })`, not
`RequestLine { .. }`. Rust has no implicit lifting into `Result`. If instead the
mismatch is on `text`, remember that `from_utf8` gives you a `Result<&str, _>`
and you have to get the `&str` out of it before you can call `split` on it.

@after
Two decisions here are worth keeping. Parsing starts from `&[u8]` and validates
UTF-8 itself, rather than taking a `&str` and making the caller deal with it. A
client can send any bytes at all, and a server that assumes otherwise fails on
the first hostile request.

And `split(' ')` is strict about spaces: `"GET  / HTTP/1.1"` with two spaces
yields four fields and is rejected. Being lenient here is how servers end up
disagreeing with the proxy in front of them about where the target starts, which
is the same class of bug as stage 3.

## 2. Headers, and the case rule

@kind fix
@concept str

@expect E0308

A header block is lines of `Name: value`, and the name is compared without
regard to ASCII case, so `Host`, `host` and `HOST` are one header. `Headers::parse`
splits each line at the first colon. The destructuring of that split does not
compile, because splitting can fail.

```starter
pub const RAW: &[u8] = b"GET /users/7?tab=logs HTTP/1.1\r\nHost: localhost:8080\r\nUser-Agent: curl/8.4.0\r\nContent-Length: 11\r\n\r\nhello world";

#[derive(Debug, PartialEq)]
pub enum ParseError {
    NotUtf8,
    Malformed,
    UnsupportedVersion,
}

#[derive(Debug, PartialEq)]
pub struct RequestLine {
    pub method: String,
    pub target: String,
    pub version: String,
}

pub fn first_line(raw: &[u8]) -> &[u8] {
    let end = raw.windows(2).position(|w| w == b"\r\n").unwrap_or(raw.len());
    &raw[..end]
}

pub fn parse_request_line(line: &[u8]) -> Result<RequestLine, ParseError> {
    let text = std::str::from_utf8(line).map_err(|_| ParseError::NotUtf8)?;
    let mut parts = text.split(' ');
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let version = parts.next().unwrap_or("");

    if parts.next().is_some() || method.is_empty() || target.is_empty() {
        return Err(ParseError::Malformed);
    }
    if version != "HTTP/1.0" && version != "HTTP/1.1" {
        return Err(ParseError::UnsupportedVersion);
    }
    Ok(RequestLine {
        method: method.to_string(),
        target: target.to_string(),
        version: version.to_string(),
    })
}

#[derive(Debug, Default, PartialEq)]
pub struct Headers(Vec<(String, String)>);

impl Headers {
    pub fn parse(block: &str) -> Result<Headers, ParseError> {
        let mut fields = Vec::new();
        for line in block.split("\r\n").filter(|l| !l.is_empty()) {
            let (name, value) = line.split_once(':');
            if name.is_empty() || name.ends_with(' ') || name.ends_with('\t') {
                return Err(ParseError::Malformed);
            }
            fields.push((name.to_string(), value.trim().to_string()));
        }
        Ok(Headers(fields))
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(field, _)| field.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

pub fn run() -> Headers {
    let text = std::str::from_utf8(RAW).expect("the sample is ASCII");
    let (_, rest) = text.split_once("\r\n").unwrap_or((text, ""));
    let block = rest.split("\r\n\r\n").next().unwrap_or("");
    let headers = Headers::parse(block).expect("the sample headers are well formed");

    println!("{} headers", headers.len());
    for name in ["host", "HOST", "Content-Length", "connection"] {
        println!("{name:>14} -> {:?}", headers.get(name));
    }
    headers
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_sample_headers() {
        let headers = run();
        assert_eq!(headers.len(), 3);
        assert_eq!(headers.get("Host"), Some("localhost:8080"));
        assert_eq!(headers.get("content-length"), Some("11"));
        assert_eq!(headers.get("Connection"), None);
    }

    #[test]
    fn lookup_ignores_ascii_case_only() {
        let headers = Headers::parse("X-Trace-Id: abc\r\nSTRASSE: k").unwrap();
        assert_eq!(headers.get("x-trace-id"), Some("abc"));
        assert_eq!(headers.get("X-TRACE-ID"), Some("abc"));
        assert_eq!(headers.get("strasse"), Some("k"));
        assert_eq!(headers.get("stra\u{df}e"), None);
    }

    #[test]
    fn the_value_keeps_its_colons_and_loses_its_padding() {
        let headers = Headers::parse("Host:   localhost:8080   ").unwrap();
        assert_eq!(headers.get("host"), Some("localhost:8080"));
    }

    #[test]
    fn a_line_without_a_colon_is_malformed() {
        assert_eq!(Headers::parse("Host"), Err(ParseError::Malformed));
        assert_eq!(Headers::parse(": empty"), Err(ParseError::Malformed));
        assert_eq!(Headers::parse("Host : localhost"), Err(ParseError::Malformed));
        assert!(Headers::parse("").unwrap().is_empty());
    }
}
```

```solution
pub const RAW: &[u8] = b"GET /users/7?tab=logs HTTP/1.1\r\nHost: localhost:8080\r\nUser-Agent: curl/8.4.0\r\nContent-Length: 11\r\n\r\nhello world";

#[derive(Debug, PartialEq)]
pub enum ParseError {
    NotUtf8,
    Malformed,
    UnsupportedVersion,
}

#[derive(Debug, PartialEq)]
pub struct RequestLine {
    pub method: String,
    pub target: String,
    pub version: String,
}

pub fn first_line(raw: &[u8]) -> &[u8] {
    let end = raw.windows(2).position(|w| w == b"\r\n").unwrap_or(raw.len());
    &raw[..end]
}

pub fn parse_request_line(line: &[u8]) -> Result<RequestLine, ParseError> {
    let text = std::str::from_utf8(line).map_err(|_| ParseError::NotUtf8)?;
    let mut parts = text.split(' ');
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let version = parts.next().unwrap_or("");

    if parts.next().is_some() || method.is_empty() || target.is_empty() {
        return Err(ParseError::Malformed);
    }
    if version != "HTTP/1.0" && version != "HTTP/1.1" {
        return Err(ParseError::UnsupportedVersion);
    }
    Ok(RequestLine {
        method: method.to_string(),
        target: target.to_string(),
        version: version.to_string(),
    })
}

#[derive(Debug, Default, PartialEq)]
pub struct Headers(Vec<(String, String)>);

impl Headers {
    pub fn parse(block: &str) -> Result<Headers, ParseError> {
        let mut fields = Vec::new();
        for line in block.split("\r\n").filter(|l| !l.is_empty()) {
            let (name, value) = line.split_once(':').ok_or(ParseError::Malformed)?;
            if name.is_empty() || name.ends_with(' ') || name.ends_with('\t') {
                return Err(ParseError::Malformed);
            }
            fields.push((name.to_string(), value.trim().to_string()));
        }
        Ok(Headers(fields))
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(field, _)| field.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

pub fn run() -> Headers {
    let text = std::str::from_utf8(RAW).expect("the sample is ASCII");
    let (_, rest) = text.split_once("\r\n").unwrap_or((text, ""));
    let block = rest.split("\r\n\r\n").next().unwrap_or("");
    let headers = Headers::parse(block).expect("the sample headers are well formed");

    println!("{} headers", headers.len());
    for name in ["host", "HOST", "Content-Length", "connection"] {
        println!("{name:>14} -> {:?}", headers.get(name));
    }
    headers
}
```

@hint `split_once` cannot promise to find the colon, so it does not return a pair.
@hint The pattern `let (name, value) = ...` is irrefutable, so it can only destructure something that always is a pair. An `Option` is not.
@hint `.ok_or(ParseError::Malformed)?` turns the `Option` into a `Result` and then into the pair.

@diagnose E0308
`expected Option<(&str, &str)>, found (_, _)`. The pattern on the left is a
two-element tuple, the expression on the right is an `Option` wrapping one, and
`let` will not open the wrapper for you.

The honest reading of the error is that `split_once` is telling you about a case
you have not handled. A header line with no colon is possible, an attacker can
send one, and this function returns `Result` precisely so that it has somewhere
to put that. `ok_or` is the bridge from "there might be nothing" to "there might
be an error, and here is which one".

`unwrap()` would also compile, and would turn a malformed request into a crashed
connection handler.

@diagnose E0005
`refutable pattern in local binding`. You reached for `let Some((name, value)) =
line.split_once(':')`, which is closer, but a plain `let` has no arm to fall
through to when the pattern does not match. `let ... else { }` fixes it and needs
a diverging block, so inside a loop over lines you would write
`else { return Err(ParseError::Malformed) }` or `else { continue }`. In a
function that already returns `Result`, `ok_or(..)?` says the same thing in one
expression.

@diagnose E0599
`no method named split_once found for reference &str`, usually because the
argument is a `String` rather than a `char` or `&str` pattern, or because the
receiver is a `&&str` from a `filter` closure that was not dereferenced. The
`Pattern` trait accepts `char`, `&str`, and closures over `char`; `':'` in single
quotes is a `char` and is the cheapest of them, since it compares one byte at a
time with no substring search.

@after
Case-insensitivity is in the specification, and the reason is history: `Content-Length`
and `content-length` are the same field, HTTP/2 went further and requires names
to be lowercase on the wire. So a lookup that compares bytes exactly will find
the header from `curl` and miss the one from a browser.

`eq_ignore_ascii_case` is the right tool and the name is precise. It folds only
`A-Z` against `a-z` and leaves every byte above 127 alone, which is why the test
for `straße` expects no match. Full Unicode case folding is locale-dependent
and expensive, and applying it to a protocol whose field names are all ASCII
would be both slower and wrong.

Note also that the parser rejects `"Host : localhost"`. Whitespace before the
colon is forbidden, because two implementations disagreeing about whether to
trim it is one of the ways a request gets read differently by a proxy and the
server behind it.

## 3. Where the body ends

@kind fix
@concept match

@expect E0004

A reader has to know how many bytes of body to expect. `Content-Length` says so
directly. `Transfer-Encoding: chunked` says the body is self-delimiting. A
request carrying both is a request that two implementations will read
differently, so it is refused. The match over those two headers is missing a
case.

```starter
pub const RAW: &[u8] = b"GET /users/7?tab=logs HTTP/1.1\r\nHost: localhost:8080\r\nUser-Agent: curl/8.4.0\r\nContent-Length: 11\r\n\r\nhello world";

#[derive(Debug, PartialEq)]
pub enum ParseError {
    NotUtf8,
    Malformed,
    UnsupportedVersion,
    BadContentLength,
    Smuggled,
    Chunked,
    Incomplete,
}

#[derive(Debug, PartialEq)]
pub struct RequestLine {
    pub method: String,
    pub target: String,
    pub version: String,
}

pub fn first_line(raw: &[u8]) -> &[u8] {
    let end = raw.windows(2).position(|w| w == b"\r\n").unwrap_or(raw.len());
    &raw[..end]
}

pub fn parse_request_line(line: &[u8]) -> Result<RequestLine, ParseError> {
    let text = std::str::from_utf8(line).map_err(|_| ParseError::NotUtf8)?;
    let mut parts = text.split(' ');
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let version = parts.next().unwrap_or("");

    if parts.next().is_some() || method.is_empty() || target.is_empty() {
        return Err(ParseError::Malformed);
    }
    if version != "HTTP/1.0" && version != "HTTP/1.1" {
        return Err(ParseError::UnsupportedVersion);
    }
    Ok(RequestLine {
        method: method.to_string(),
        target: target.to_string(),
        version: version.to_string(),
    })
}

#[derive(Debug, Default, PartialEq)]
pub struct Headers(Vec<(String, String)>);

impl Headers {
    pub fn parse(block: &str) -> Result<Headers, ParseError> {
        let mut fields = Vec::new();
        for line in block.split("\r\n").filter(|l| !l.is_empty()) {
            let (name, value) = line.split_once(':').ok_or(ParseError::Malformed)?;
            if name.is_empty() || name.ends_with(' ') || name.ends_with('\t') {
                return Err(ParseError::Malformed);
            }
            fields.push((name.to_string(), value.trim().to_string()));
        }
        Ok(Headers(fields))
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(field, _)| field.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[derive(Debug, PartialEq)]
pub struct Request {
    pub line: RequestLine,
    pub headers: Headers,
    pub body: Vec<u8>,
}

pub fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

pub fn body_len(headers: &Headers) -> Result<usize, ParseError> {
    match (headers.get("content-length"), headers.get("transfer-encoding")) {
        (Some(_), Some(_)) => Err(ParseError::Smuggled),
        (Some(n), None) if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) => {
            n.parse::<usize>().map_err(|_| ParseError::BadContentLength)
        }
        (Some(_), None) => Err(ParseError::BadContentLength),
        (None, None) => Ok(0),
    }
}

pub fn parse_request(raw: &[u8]) -> Result<Request, ParseError> {
    let split = find(raw, b"\r\n\r\n").ok_or(ParseError::Incomplete)?;
    let head = std::str::from_utf8(&raw[..split]).map_err(|_| ParseError::NotUtf8)?;
    let line = parse_request_line(first_line(head.as_bytes()))?;
    let (_, fields) = head.split_once("\r\n").unwrap_or((head, ""));
    let headers = Headers::parse(fields)?;

    let len = body_len(&headers)?;
    let rest = &raw[split + 4..];
    if rest.len() < len {
        return Err(ParseError::Incomplete);
    }
    Ok(Request { line, headers, body: rest[..len].to_vec() })
}

pub fn run() -> Request {
    let req = parse_request(RAW).expect("the sample request is well formed");
    println!("{} {} {}", req.line.method, req.line.target, req.line.version);
    println!("{} headers, {} bytes of body", req.headers.len(), req.body.len());
    println!("body {:?}", String::from_utf8_lossy(&req.body));
    req
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_sample_request() {
        let req = run();
        assert_eq!(req.line.method, "GET");
        assert_eq!(req.headers.len(), 3);
        assert_eq!(req.body, b"hello world");
    }

    #[test]
    fn a_body_is_exactly_content_length_bytes() {
        let raw = b"POST /u HTTP/1.1\r\nContent-Length: 4\r\n\r\nabcdefgh";
        assert_eq!(parse_request(raw).unwrap().body, b"abcd");

        let short = b"POST /u HTTP/1.1\r\nContent-Length: 9\r\n\r\nabcd";
        assert_eq!(parse_request(short), Err(ParseError::Incomplete));
    }

    #[test]
    fn no_content_length_means_no_body() {
        let raw = b"GET /health HTTP/1.1\r\nHost: x\r\n\r\n";
        assert!(parse_request(raw).unwrap().body.is_empty());
    }

    #[test]
    fn both_framings_at_once_is_refused() {
        let smuggled = b"POST /u HTTP/1.1\r\nContent-Length: 4\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n";
        assert_eq!(parse_request(smuggled), Err(ParseError::Smuggled));

        let reversed = b"POST /u HTTP/1.1\r\nTransfer-Encoding: chunked\r\nContent-Length: 4\r\n\r\n0\r\n\r\n";
        assert_eq!(parse_request(reversed), Err(ParseError::Smuggled));
    }

    #[test]
    fn chunked_alone_is_unsupported_and_a_bad_length_is_rejected() {
        let chunked = b"POST /u HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n";
        assert_eq!(parse_request(chunked), Err(ParseError::Chunked));

        for bad in ["+4", "4 4", "0x4", "-1", "", "four"] {
            let raw = format!("POST /u HTTP/1.1\r\nContent-Length: {bad}\r\n\r\n");
            assert_eq!(parse_request(raw.as_bytes()), Err(ParseError::BadContentLength), "{bad:?}");
        }
    }

    #[test]
    fn a_head_with_no_blank_line_is_incomplete() {
        assert_eq!(parse_request(b"GET / HTTP/1.1\r\n"), Err(ParseError::Incomplete));
    }
}
```

```solution
pub const RAW: &[u8] = b"GET /users/7?tab=logs HTTP/1.1\r\nHost: localhost:8080\r\nUser-Agent: curl/8.4.0\r\nContent-Length: 11\r\n\r\nhello world";

#[derive(Debug, PartialEq)]
pub enum ParseError {
    NotUtf8,
    Malformed,
    UnsupportedVersion,
    BadContentLength,
    Smuggled,
    Chunked,
    Incomplete,
}

#[derive(Debug, PartialEq)]
pub struct RequestLine {
    pub method: String,
    pub target: String,
    pub version: String,
}

pub fn first_line(raw: &[u8]) -> &[u8] {
    let end = raw.windows(2).position(|w| w == b"\r\n").unwrap_or(raw.len());
    &raw[..end]
}

pub fn parse_request_line(line: &[u8]) -> Result<RequestLine, ParseError> {
    let text = std::str::from_utf8(line).map_err(|_| ParseError::NotUtf8)?;
    let mut parts = text.split(' ');
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let version = parts.next().unwrap_or("");

    if parts.next().is_some() || method.is_empty() || target.is_empty() {
        return Err(ParseError::Malformed);
    }
    if version != "HTTP/1.0" && version != "HTTP/1.1" {
        return Err(ParseError::UnsupportedVersion);
    }
    Ok(RequestLine {
        method: method.to_string(),
        target: target.to_string(),
        version: version.to_string(),
    })
}

#[derive(Debug, Default, PartialEq)]
pub struct Headers(Vec<(String, String)>);

impl Headers {
    pub fn parse(block: &str) -> Result<Headers, ParseError> {
        let mut fields = Vec::new();
        for line in block.split("\r\n").filter(|l| !l.is_empty()) {
            let (name, value) = line.split_once(':').ok_or(ParseError::Malformed)?;
            if name.is_empty() || name.ends_with(' ') || name.ends_with('\t') {
                return Err(ParseError::Malformed);
            }
            fields.push((name.to_string(), value.trim().to_string()));
        }
        Ok(Headers(fields))
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(field, _)| field.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[derive(Debug, PartialEq)]
pub struct Request {
    pub line: RequestLine,
    pub headers: Headers,
    pub body: Vec<u8>,
}

pub fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

pub fn body_len(headers: &Headers) -> Result<usize, ParseError> {
    match (headers.get("content-length"), headers.get("transfer-encoding")) {
        (Some(_), Some(_)) => Err(ParseError::Smuggled),
        (Some(n), None) if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) => {
            n.parse::<usize>().map_err(|_| ParseError::BadContentLength)
        }
        (Some(_), None) => Err(ParseError::BadContentLength),
        (None, Some(_)) => Err(ParseError::Chunked),
        (None, None) => Ok(0),
    }
}

pub fn parse_request(raw: &[u8]) -> Result<Request, ParseError> {
    let split = find(raw, b"\r\n\r\n").ok_or(ParseError::Incomplete)?;
    let head = std::str::from_utf8(&raw[..split]).map_err(|_| ParseError::NotUtf8)?;
    let line = parse_request_line(first_line(head.as_bytes()))?;
    let (_, fields) = head.split_once("\r\n").unwrap_or((head, ""));
    let headers = Headers::parse(fields)?;

    let len = body_len(&headers)?;
    let rest = &raw[split + 4..];
    if rest.len() < len {
        return Err(ParseError::Incomplete);
    }
    Ok(Request { line, headers, body: rest[..len].to_vec() })
}

pub fn run() -> Request {
    let req = parse_request(RAW).expect("the sample request is well formed");
    println!("{} {} {}", req.line.method, req.line.target, req.line.version);
    println!("{} headers, {} bytes of body", req.headers.len(), req.body.len());
    println!("body {:?}", String::from_utf8_lossy(&req.body));
    req
}
```

@hint The match scrutinee is a pair of `Option`s, so there are four combinations, and only three are written.
@hint What should happen for a request that has `Transfer-Encoding` and no `Content-Length`? Answering the question is the fix.
@hint Add `(None, Some(_)) => Err(ParseError::Chunked),`. Decoding chunked bodies is real work and this server declines to do it.

@diagnose E0004
`non-exhaustive patterns: (None, Some(_)) not covered`.

A `match` has to handle every value the scrutinee can take. The scrutinee here is
`(Option<&str>, Option<&str>)`, and rustc knows that type has exactly four
inhabited shapes, so it enumerates them and names the one you left out. It is not
guessing from your arms; it is computing the difference.

This is the check that makes the smuggling case hard to get wrong. Adding a
`_ => Ok(0)` arm would silence the error and would also silently accept the
chunked request whose body you are not going to read, which is the bug the
exhaustiveness check just handed to you for free. Write the arm you actually
mean.

@diagnose E0308
`expected usize, found Result<usize, ParseError>` or the reverse. Every arm of a
match has to produce the same type, and this one produces `Result<usize,
ParseError>`, so the arms that succeed need `Ok(..)` around them and the arms
that fail need `Err(..)`. `n.parse::<usize>()` already produces a `Result`, and
its error type is `ParseIntError` rather than yours, which is why it goes through
`map_err`.

@after
Request smuggling is what this stage is about. A front-end proxy and a back-end
server both parse the same bytes, and if they disagree about where request one
ends, the attacker gets to choose what the back end sees as the start of request
two. The classic pair is `Content-Length: 6` together with `Transfer-Encoding:
chunked`: the specification says chunked wins, so a proxy honouring the length
and a server honouring the encoding split the same stream at different points.
Everything after the split is attacker-controlled, and it arrives labelled with
the next user's connection.

The rule to keep is that ambiguity is refused rather than resolved. A request
with two framings gets a 400 and the connection is closed.

Note the strictness on the length itself. `"+4".parse::<usize>()` succeeds in
Rust and returns 4, and a length of `+4` is not a valid `Content-Length`. So the
check is that every byte is an ASCII digit, before parsing.

## 4. A response on the wire

@kind fix
@concept Vec

@expect E0599

A response is a status line, headers, a blank line, and the body. The separator
is CRLF everywhere, never a bare newline. `to_bytes` builds the head as a
`String` and then has to put the body after it, and the body is arbitrary bytes
rather than text. One line reaches for the wrong method.

```starter
pub const RAW: &[u8] = b"GET /users/7?tab=logs HTTP/1.1\r\nHost: localhost:8080\r\nUser-Agent: curl/8.4.0\r\nContent-Length: 11\r\n\r\nhello world";

#[derive(Debug, PartialEq)]
pub enum ParseError {
    NotUtf8,
    Malformed,
    UnsupportedVersion,
    BadContentLength,
    Smuggled,
    Chunked,
    Incomplete,
}

#[derive(Debug, PartialEq)]
pub struct RequestLine {
    pub method: String,
    pub target: String,
    pub version: String,
}

pub fn first_line(raw: &[u8]) -> &[u8] {
    let end = raw.windows(2).position(|w| w == b"\r\n").unwrap_or(raw.len());
    &raw[..end]
}

pub fn parse_request_line(line: &[u8]) -> Result<RequestLine, ParseError> {
    let text = std::str::from_utf8(line).map_err(|_| ParseError::NotUtf8)?;
    let mut parts = text.split(' ');
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let version = parts.next().unwrap_or("");

    if parts.next().is_some() || method.is_empty() || target.is_empty() {
        return Err(ParseError::Malformed);
    }
    if version != "HTTP/1.0" && version != "HTTP/1.1" {
        return Err(ParseError::UnsupportedVersion);
    }
    Ok(RequestLine {
        method: method.to_string(),
        target: target.to_string(),
        version: version.to_string(),
    })
}

#[derive(Debug, Default, PartialEq)]
pub struct Headers(Vec<(String, String)>);

impl Headers {
    pub fn parse(block: &str) -> Result<Headers, ParseError> {
        let mut fields = Vec::new();
        for line in block.split("\r\n").filter(|l| !l.is_empty()) {
            let (name, value) = line.split_once(':').ok_or(ParseError::Malformed)?;
            if name.is_empty() || name.ends_with(' ') || name.ends_with('\t') {
                return Err(ParseError::Malformed);
            }
            fields.push((name.to_string(), value.trim().to_string()));
        }
        Ok(Headers(fields))
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(field, _)| field.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[derive(Debug, PartialEq)]
pub struct Request {
    pub line: RequestLine,
    pub headers: Headers,
    pub body: Vec<u8>,
}

pub fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

pub fn body_len(headers: &Headers) -> Result<usize, ParseError> {
    match (headers.get("content-length"), headers.get("transfer-encoding")) {
        (Some(_), Some(_)) => Err(ParseError::Smuggled),
        (Some(n), None) if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) => {
            n.parse::<usize>().map_err(|_| ParseError::BadContentLength)
        }
        (Some(_), None) => Err(ParseError::BadContentLength),
        (None, Some(_)) => Err(ParseError::Chunked),
        (None, None) => Ok(0),
    }
}

pub fn parse_request(raw: &[u8]) -> Result<Request, ParseError> {
    let split = find(raw, b"\r\n\r\n").ok_or(ParseError::Incomplete)?;
    let head = std::str::from_utf8(&raw[..split]).map_err(|_| ParseError::NotUtf8)?;
    let line = parse_request_line(first_line(head.as_bytes()))?;
    let (_, fields) = head.split_once("\r\n").unwrap_or((head, ""));
    let headers = Headers::parse(fields)?;

    let len = body_len(&headers)?;
    let rest = &raw[split + 4..];
    if rest.len() < len {
        return Err(ParseError::Incomplete);
    }
    Ok(Request { line, headers, body: rest[..len].to_vec() })
}

#[derive(Debug, PartialEq)]
pub struct Response {
    pub status: u16,
    pub reason: &'static str,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Response {
    pub fn new(status: u16, reason: &'static str, body: impl Into<Vec<u8>>) -> Response {
        Response { status, reason, headers: Vec::new(), body: body.into() }
    }

    pub fn header(mut self, name: &str, value: &str) -> Response {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut head = format!("HTTP/1.1 {} {}\r\n", self.status, self.reason);
        head.push_str(&format!("Content-Length: {}\r\n", self.body.len()));
        for (name, value) in &self.headers {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        head.push_str("\r\n");

        let mut out = head.into_bytes();
        out.push_str(&self.body);
        out
    }
}

pub fn run() -> Vec<u8> {
    let res = Response::new(200, "OK", "hello").header("Content-Type", "text/plain");
    let bytes = res.to_bytes();
    println!("{}", String::from_utf8_lossy(&bytes).replace("\r\n", "[CRLF]\n"));
    bytes
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialises_byte_for_byte() {
        assert_eq!(
            run(),
            b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nContent-Type: text/plain\r\n\r\nhello".to_vec()
        );
    }

    #[test]
    fn every_line_ends_with_crlf_and_the_head_ends_with_a_blank_one() {
        let bytes = Response::new(404, "Not Found", "gone\n").to_bytes();
        let text = String::from_utf8(bytes).unwrap();
        let (head, body) = text.split_once("\r\n\r\n").expect("a blank line ends the head");
        assert_eq!(body, "gone\n");
        assert_eq!(head.matches('\n').count(), head.matches("\r\n").count());
        assert_eq!(head, "HTTP/1.1 404 Not Found\r\nContent-Length: 5");
    }

    #[test]
    fn content_length_counts_bytes_not_characters() {
        let res = Response::new(200, "OK", "café");
        assert_eq!(res.body.len(), 5);
        let text = String::from_utf8(res.to_bytes()).unwrap();
        assert!(text.contains("Content-Length: 5\r\n"));
    }

    #[test]
    fn an_empty_body_still_declares_its_length() {
        let bytes = Response::new(204, "No Content", "").to_bytes();
        assert_eq!(bytes, b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n".to_vec());
    }
}
```

```solution
pub const RAW: &[u8] = b"GET /users/7?tab=logs HTTP/1.1\r\nHost: localhost:8080\r\nUser-Agent: curl/8.4.0\r\nContent-Length: 11\r\n\r\nhello world";

#[derive(Debug, PartialEq)]
pub enum ParseError {
    NotUtf8,
    Malformed,
    UnsupportedVersion,
    BadContentLength,
    Smuggled,
    Chunked,
    Incomplete,
}

#[derive(Debug, PartialEq)]
pub struct RequestLine {
    pub method: String,
    pub target: String,
    pub version: String,
}

pub fn first_line(raw: &[u8]) -> &[u8] {
    let end = raw.windows(2).position(|w| w == b"\r\n").unwrap_or(raw.len());
    &raw[..end]
}

pub fn parse_request_line(line: &[u8]) -> Result<RequestLine, ParseError> {
    let text = std::str::from_utf8(line).map_err(|_| ParseError::NotUtf8)?;
    let mut parts = text.split(' ');
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let version = parts.next().unwrap_or("");

    if parts.next().is_some() || method.is_empty() || target.is_empty() {
        return Err(ParseError::Malformed);
    }
    if version != "HTTP/1.0" && version != "HTTP/1.1" {
        return Err(ParseError::UnsupportedVersion);
    }
    Ok(RequestLine {
        method: method.to_string(),
        target: target.to_string(),
        version: version.to_string(),
    })
}

#[derive(Debug, Default, PartialEq)]
pub struct Headers(Vec<(String, String)>);

impl Headers {
    pub fn parse(block: &str) -> Result<Headers, ParseError> {
        let mut fields = Vec::new();
        for line in block.split("\r\n").filter(|l| !l.is_empty()) {
            let (name, value) = line.split_once(':').ok_or(ParseError::Malformed)?;
            if name.is_empty() || name.ends_with(' ') || name.ends_with('\t') {
                return Err(ParseError::Malformed);
            }
            fields.push((name.to_string(), value.trim().to_string()));
        }
        Ok(Headers(fields))
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(field, _)| field.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[derive(Debug, PartialEq)]
pub struct Request {
    pub line: RequestLine,
    pub headers: Headers,
    pub body: Vec<u8>,
}

pub fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

pub fn body_len(headers: &Headers) -> Result<usize, ParseError> {
    match (headers.get("content-length"), headers.get("transfer-encoding")) {
        (Some(_), Some(_)) => Err(ParseError::Smuggled),
        (Some(n), None) if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) => {
            n.parse::<usize>().map_err(|_| ParseError::BadContentLength)
        }
        (Some(_), None) => Err(ParseError::BadContentLength),
        (None, Some(_)) => Err(ParseError::Chunked),
        (None, None) => Ok(0),
    }
}

pub fn parse_request(raw: &[u8]) -> Result<Request, ParseError> {
    let split = find(raw, b"\r\n\r\n").ok_or(ParseError::Incomplete)?;
    let head = std::str::from_utf8(&raw[..split]).map_err(|_| ParseError::NotUtf8)?;
    let line = parse_request_line(first_line(head.as_bytes()))?;
    let (_, fields) = head.split_once("\r\n").unwrap_or((head, ""));
    let headers = Headers::parse(fields)?;

    let len = body_len(&headers)?;
    let rest = &raw[split + 4..];
    if rest.len() < len {
        return Err(ParseError::Incomplete);
    }
    Ok(Request { line, headers, body: rest[..len].to_vec() })
}

#[derive(Debug, PartialEq)]
pub struct Response {
    pub status: u16,
    pub reason: &'static str,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Response {
    pub fn new(status: u16, reason: &'static str, body: impl Into<Vec<u8>>) -> Response {
        Response { status, reason, headers: Vec::new(), body: body.into() }
    }

    pub fn header(mut self, name: &str, value: &str) -> Response {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut head = format!("HTTP/1.1 {} {}\r\n", self.status, self.reason);
        head.push_str(&format!("Content-Length: {}\r\n", self.body.len()));
        for (name, value) in &self.headers {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        head.push_str("\r\n");

        let mut out = head.into_bytes();
        out.extend_from_slice(&self.body);
        out
    }
}

pub fn run() -> Vec<u8> {
    let res = Response::new(200, "OK", "hello").header("Content-Type", "text/plain");
    let bytes = res.to_bytes();
    println!("{}", String::from_utf8_lossy(&bytes).replace("\r\n", "[CRLF]\n"));
    bytes
}
```

@hint `push_str` is a `String` method. What is `out`?
@hint `into_bytes` has already turned the head into a `Vec<u8>`, and a body is not necessarily text: an image, a gzip stream, half a video.
@hint `out.extend_from_slice(&self.body)` appends one byte slice to another.

@diagnose E0599
`no method named push_str found for struct Vec<u8> in the current scope`.

`out` stopped being a `String` on the line above, where `into_bytes` consumed it
and handed back the `Vec<u8>` that was underneath all along. The conversion is
free, since a `String` is a `Vec<u8>` plus the promise that its contents are
valid UTF-8, and `into_bytes` drops the promise without touching the buffer.

That promise is exactly what a body cannot make. `Content-Type: image/png` is
not UTF-8 and never will be. So the head is built as text, where formatting is
convenient, and the moment the body has to be appended the type changes to bytes
and stays there.

@diagnose E0308
`expected Vec<u8>, found String`. The function promises bytes and the last
expression is still the `String` you built the head in. `into_bytes()` converts
without copying. Reaching for `as_bytes()` instead gives you a `&[u8]` borrowed
from a local that is about to be dropped, and the borrow checker will refuse that
separately: the buffer has to be moved out, not pointed at.

@after
CRLF is not decoration. `\r\n` ends every line of the head and an empty line
ends the head itself, which is why the parser in stage 3 looks for `\r\n\r\n`
and finds the split in one search. A response written with bare `\n` will be
accepted by some clients, rejected by others, and misframed by a proxy that
counts bytes, and that difference is another way into the smuggling problem.

`Content-Length` counts bytes, not characters. The test with `café` pins that
down: four characters, five bytes, and the number on the wire is 5. Getting this
wrong truncates the last character of every response containing anything outside
ASCII, and the client's decoder shows a replacement character where the tail
should be.

## 5. Routing with parameters

@kind fix
@concept lifetime

@expect E0106

A route pattern is a path with named holes: `/users/:id` matches `/users/7` and
binds `id` to `"7"`. `match_route` returns the bindings, borrowed from the two
strings it was given rather than copied. The signature does not say where those
borrows come from, and rustc will not guess.

```starter
pub const RAW: &[u8] = b"GET /users/7?tab=logs HTTP/1.1\r\nHost: localhost:8080\r\nUser-Agent: curl/8.4.0\r\nContent-Length: 11\r\n\r\nhello world";

#[derive(Debug, PartialEq)]
pub enum ParseError {
    NotUtf8,
    Malformed,
    UnsupportedVersion,
    BadContentLength,
    Smuggled,
    Chunked,
    Incomplete,
}

#[derive(Debug, PartialEq)]
pub struct RequestLine {
    pub method: String,
    pub target: String,
    pub version: String,
}

pub fn first_line(raw: &[u8]) -> &[u8] {
    let end = raw.windows(2).position(|w| w == b"\r\n").unwrap_or(raw.len());
    &raw[..end]
}

pub fn parse_request_line(line: &[u8]) -> Result<RequestLine, ParseError> {
    let text = std::str::from_utf8(line).map_err(|_| ParseError::NotUtf8)?;
    let mut parts = text.split(' ');
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let version = parts.next().unwrap_or("");

    if parts.next().is_some() || method.is_empty() || target.is_empty() {
        return Err(ParseError::Malformed);
    }
    if version != "HTTP/1.0" && version != "HTTP/1.1" {
        return Err(ParseError::UnsupportedVersion);
    }
    Ok(RequestLine {
        method: method.to_string(),
        target: target.to_string(),
        version: version.to_string(),
    })
}

#[derive(Debug, Default, PartialEq)]
pub struct Headers(Vec<(String, String)>);

impl Headers {
    pub fn parse(block: &str) -> Result<Headers, ParseError> {
        let mut fields = Vec::new();
        for line in block.split("\r\n").filter(|l| !l.is_empty()) {
            let (name, value) = line.split_once(':').ok_or(ParseError::Malformed)?;
            if name.is_empty() || name.ends_with(' ') || name.ends_with('\t') {
                return Err(ParseError::Malformed);
            }
            fields.push((name.to_string(), value.trim().to_string()));
        }
        Ok(Headers(fields))
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(field, _)| field.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[derive(Debug, PartialEq)]
pub struct Request {
    pub line: RequestLine,
    pub headers: Headers,
    pub body: Vec<u8>,
}

pub fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

pub fn body_len(headers: &Headers) -> Result<usize, ParseError> {
    match (headers.get("content-length"), headers.get("transfer-encoding")) {
        (Some(_), Some(_)) => Err(ParseError::Smuggled),
        (Some(n), None) if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) => {
            n.parse::<usize>().map_err(|_| ParseError::BadContentLength)
        }
        (Some(_), None) => Err(ParseError::BadContentLength),
        (None, Some(_)) => Err(ParseError::Chunked),
        (None, None) => Ok(0),
    }
}

pub fn parse_request(raw: &[u8]) -> Result<Request, ParseError> {
    let split = find(raw, b"\r\n\r\n").ok_or(ParseError::Incomplete)?;
    let head = std::str::from_utf8(&raw[..split]).map_err(|_| ParseError::NotUtf8)?;
    let line = parse_request_line(first_line(head.as_bytes()))?;
    let (_, fields) = head.split_once("\r\n").unwrap_or((head, ""));
    let headers = Headers::parse(fields)?;

    let len = body_len(&headers)?;
    let rest = &raw[split + 4..];
    if rest.len() < len {
        return Err(ParseError::Incomplete);
    }
    Ok(Request { line, headers, body: rest[..len].to_vec() })
}

#[derive(Debug, PartialEq)]
pub struct Response {
    pub status: u16,
    pub reason: &'static str,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Response {
    pub fn new(status: u16, reason: &'static str, body: impl Into<Vec<u8>>) -> Response {
        Response { status, reason, headers: Vec::new(), body: body.into() }
    }

    pub fn header(mut self, name: &str, value: &str) -> Response {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut head = format!("HTTP/1.1 {} {}\r\n", self.status, self.reason);
        head.push_str(&format!("Content-Length: {}\r\n", self.body.len()));
        for (name, value) in &self.headers {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        head.push_str("\r\n");

        let mut out = head.into_bytes();
        out.extend_from_slice(&self.body);
        out
    }
}

pub fn match_route(pattern: &str, path: &str) -> Option<Vec<(&str, &str)>> {
    let mut params = Vec::new();
    let mut segments = path.split('/');

    for expected in pattern.split('/') {
        let actual = segments.next()?;
        match expected.strip_prefix(':') {
            Some(name) if !actual.is_empty() => params.push((name, actual)),
            Some(_) => return None,
            None if expected == actual => {}
            None => return None,
        }
    }
    if segments.next().is_some() {
        return None;
    }
    Some(params)
}

pub fn run() -> Vec<(&'static str, &'static str)> {
    for path in ["/users/7", "/users", "/users/7/logs", "/health"] {
        println!("{path:>14} -> {:?}", match_route("/users/:id", path));
    }
    match_route("/users/:id", "/users/7").expect("that path matches")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binds_one_parameter() {
        assert_eq!(run(), vec![("id", "7")]);
        assert_eq!(match_route("/users/:id", "/users/7"), Some(vec![("id", "7")]));
    }

    #[test]
    fn a_literal_pattern_binds_nothing() {
        assert_eq!(match_route("/health", "/health"), Some(vec![]));
        assert_eq!(match_route("/", "/"), Some(vec![]));
        assert_eq!(match_route("/health", "/healthz"), None);
    }

    #[test]
    fn segment_counts_have_to_agree() {
        assert_eq!(match_route("/users/:id", "/users"), None);
        assert_eq!(match_route("/users/:id", "/users/7/logs"), None);
        assert_eq!(match_route("/users/:id", "/users/7/"), None);
        assert_eq!(match_route("/users/:id", "/users/"), None);
    }

    #[test]
    fn several_parameters_come_back_in_order() {
        assert_eq!(
            match_route("/users/:id/logs/:line", "/users/7/logs/42"),
            Some(vec![("id", "7"), ("line", "42")])
        );
    }

    #[test]
    fn a_parameter_matches_a_segment_not_a_path() {
        assert_eq!(match_route("/files/:name", "/files/a%2Fb"), Some(vec![("name", "a%2Fb")]));
        assert_eq!(match_route("/files/:name", "/files/a/b"), None);
    }
}
```

```solution
pub const RAW: &[u8] = b"GET /users/7?tab=logs HTTP/1.1\r\nHost: localhost:8080\r\nUser-Agent: curl/8.4.0\r\nContent-Length: 11\r\n\r\nhello world";

#[derive(Debug, PartialEq)]
pub enum ParseError {
    NotUtf8,
    Malformed,
    UnsupportedVersion,
    BadContentLength,
    Smuggled,
    Chunked,
    Incomplete,
}

#[derive(Debug, PartialEq)]
pub struct RequestLine {
    pub method: String,
    pub target: String,
    pub version: String,
}

pub fn first_line(raw: &[u8]) -> &[u8] {
    let end = raw.windows(2).position(|w| w == b"\r\n").unwrap_or(raw.len());
    &raw[..end]
}

pub fn parse_request_line(line: &[u8]) -> Result<RequestLine, ParseError> {
    let text = std::str::from_utf8(line).map_err(|_| ParseError::NotUtf8)?;
    let mut parts = text.split(' ');
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let version = parts.next().unwrap_or("");

    if parts.next().is_some() || method.is_empty() || target.is_empty() {
        return Err(ParseError::Malformed);
    }
    if version != "HTTP/1.0" && version != "HTTP/1.1" {
        return Err(ParseError::UnsupportedVersion);
    }
    Ok(RequestLine {
        method: method.to_string(),
        target: target.to_string(),
        version: version.to_string(),
    })
}

#[derive(Debug, Default, PartialEq)]
pub struct Headers(Vec<(String, String)>);

impl Headers {
    pub fn parse(block: &str) -> Result<Headers, ParseError> {
        let mut fields = Vec::new();
        for line in block.split("\r\n").filter(|l| !l.is_empty()) {
            let (name, value) = line.split_once(':').ok_or(ParseError::Malformed)?;
            if name.is_empty() || name.ends_with(' ') || name.ends_with('\t') {
                return Err(ParseError::Malformed);
            }
            fields.push((name.to_string(), value.trim().to_string()));
        }
        Ok(Headers(fields))
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(field, _)| field.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[derive(Debug, PartialEq)]
pub struct Request {
    pub line: RequestLine,
    pub headers: Headers,
    pub body: Vec<u8>,
}

pub fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

pub fn body_len(headers: &Headers) -> Result<usize, ParseError> {
    match (headers.get("content-length"), headers.get("transfer-encoding")) {
        (Some(_), Some(_)) => Err(ParseError::Smuggled),
        (Some(n), None) if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) => {
            n.parse::<usize>().map_err(|_| ParseError::BadContentLength)
        }
        (Some(_), None) => Err(ParseError::BadContentLength),
        (None, Some(_)) => Err(ParseError::Chunked),
        (None, None) => Ok(0),
    }
}

pub fn parse_request(raw: &[u8]) -> Result<Request, ParseError> {
    let split = find(raw, b"\r\n\r\n").ok_or(ParseError::Incomplete)?;
    let head = std::str::from_utf8(&raw[..split]).map_err(|_| ParseError::NotUtf8)?;
    let line = parse_request_line(first_line(head.as_bytes()))?;
    let (_, fields) = head.split_once("\r\n").unwrap_or((head, ""));
    let headers = Headers::parse(fields)?;

    let len = body_len(&headers)?;
    let rest = &raw[split + 4..];
    if rest.len() < len {
        return Err(ParseError::Incomplete);
    }
    Ok(Request { line, headers, body: rest[..len].to_vec() })
}

#[derive(Debug, PartialEq)]
pub struct Response {
    pub status: u16,
    pub reason: &'static str,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Response {
    pub fn new(status: u16, reason: &'static str, body: impl Into<Vec<u8>>) -> Response {
        Response { status, reason, headers: Vec::new(), body: body.into() }
    }

    pub fn header(mut self, name: &str, value: &str) -> Response {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut head = format!("HTTP/1.1 {} {}\r\n", self.status, self.reason);
        head.push_str(&format!("Content-Length: {}\r\n", self.body.len()));
        for (name, value) in &self.headers {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        head.push_str("\r\n");

        let mut out = head.into_bytes();
        out.extend_from_slice(&self.body);
        out
    }
}

pub fn match_route<'a>(pattern: &'a str, path: &'a str) -> Option<Vec<(&'a str, &'a str)>> {
    let mut params = Vec::new();
    let mut segments = path.split('/');

    for expected in pattern.split('/') {
        let actual = segments.next()?;
        match expected.strip_prefix(':') {
            Some(name) if !actual.is_empty() => params.push((name, actual)),
            Some(_) => return None,
            None if expected == actual => {}
            None => return None,
        }
    }
    if segments.next().is_some() {
        return None;
    }
    Some(params)
}

pub fn run() -> Vec<(&'static str, &'static str)> {
    for path in ["/users/7", "/users", "/users/7/logs", "/health"] {
        println!("{path:>14} -> {:?}", match_route("/users/:id", path));
    }
    match_route("/users/:id", "/users/7").expect("that path matches")
}
```

@hint The returned `&str` values point into memory owned by the caller. Which argument?
@hint With one reference argument, the compiler applies the elision rule and assumes the output borrows from it. With two, there is no rule to apply, and it stops.
@hint Give both arguments the same lifetime and use it on the output: `pub fn match_route<'a>(pattern: &'a str, path: &'a str) -> Option<Vec<(&'a str, &'a str)>>`.

@diagnose E0106
`missing lifetime specifier: expected named lifetime parameter`, with a note
saying the signature says whether it is borrowed from `pattern` or `path`.

Every reference has a lifetime. Usually you do not write it, because elision
fills it in: one input reference means every output reference borrows from that
one. Here there are two inputs, and the returned `&str` values genuinely come
from both, the names from `pattern` and the values from `path`, so there is
nothing to infer and no default that would be right.

Naming a single `'a` for both is the honest thing here. It says the result is
valid for as long as both inputs are, which is exactly the promise the function
can keep, and callers pass two strings that outlive the call anyway.

@diagnose E0621
`explicit lifetime required in the type of pattern`. You annotated one argument
and the output but not the other, so rustc is telling you which one is still
unconstrained. If you would rather give them separate lifetimes, the full form is
`fn match_route<'p, 'q>(pattern: &'p str, path: &'q str) -> Option<Vec<(&'p str,
&'q str)>>`, which is more precise and also more to read. It matters only if a
caller has a pattern and a path with genuinely different scopes.

@after
The matcher borrows rather than allocates, and for a router that is the whole
game: dispatching a request should not mean building a `HashMap<String, String>`
for every hit. Each parameter here is a pointer and a length into the request's
own target string.

Three details the tests pin down. A parameter binds exactly one segment, so
`/files/:name` does not match `/files/a/b`, and a client that wants a slash in
a value has to percent-encode it. An empty segment does not bind, so `/users/`
does not match `/users/:id` with an empty id. And segment counts have to agree,
which is why the trailing empty segment of `/users/7/` makes it a different path
from `/users/7`. Real routers make that last one configurable and then argue
about the default.

## 6. 404 and 405 are different answers

@kind fix
@concept borrow

@expect E0507

The router walks its routes, matching the path first and the method second. A
path nobody serves is a 404. A path that exists with a method it does not accept
is a 405, and it has to carry an `Allow` header listing what is accepted. The
loop as written tries to take the routes away from the router.

```starter
pub const RAW: &[u8] = b"GET /users/7?tab=logs HTTP/1.1\r\nHost: localhost:8080\r\nUser-Agent: curl/8.4.0\r\nContent-Length: 11\r\n\r\nhello world";

#[derive(Debug, PartialEq)]
pub enum ParseError {
    NotUtf8,
    Malformed,
    UnsupportedVersion,
    BadContentLength,
    Smuggled,
    Chunked,
    Incomplete,
}

#[derive(Debug, PartialEq)]
pub struct RequestLine {
    pub method: String,
    pub target: String,
    pub version: String,
}

pub fn first_line(raw: &[u8]) -> &[u8] {
    let end = raw.windows(2).position(|w| w == b"\r\n").unwrap_or(raw.len());
    &raw[..end]
}

pub fn parse_request_line(line: &[u8]) -> Result<RequestLine, ParseError> {
    let text = std::str::from_utf8(line).map_err(|_| ParseError::NotUtf8)?;
    let mut parts = text.split(' ');
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let version = parts.next().unwrap_or("");

    if parts.next().is_some() || method.is_empty() || target.is_empty() {
        return Err(ParseError::Malformed);
    }
    if version != "HTTP/1.0" && version != "HTTP/1.1" {
        return Err(ParseError::UnsupportedVersion);
    }
    Ok(RequestLine {
        method: method.to_string(),
        target: target.to_string(),
        version: version.to_string(),
    })
}

#[derive(Debug, Default, PartialEq)]
pub struct Headers(Vec<(String, String)>);

impl Headers {
    pub fn parse(block: &str) -> Result<Headers, ParseError> {
        let mut fields = Vec::new();
        for line in block.split("\r\n").filter(|l| !l.is_empty()) {
            let (name, value) = line.split_once(':').ok_or(ParseError::Malformed)?;
            if name.is_empty() || name.ends_with(' ') || name.ends_with('\t') {
                return Err(ParseError::Malformed);
            }
            fields.push((name.to_string(), value.trim().to_string()));
        }
        Ok(Headers(fields))
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(field, _)| field.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[derive(Debug, PartialEq)]
pub struct Request {
    pub line: RequestLine,
    pub headers: Headers,
    pub body: Vec<u8>,
}

pub fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

pub fn body_len(headers: &Headers) -> Result<usize, ParseError> {
    match (headers.get("content-length"), headers.get("transfer-encoding")) {
        (Some(_), Some(_)) => Err(ParseError::Smuggled),
        (Some(n), None) if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) => {
            n.parse::<usize>().map_err(|_| ParseError::BadContentLength)
        }
        (Some(_), None) => Err(ParseError::BadContentLength),
        (None, Some(_)) => Err(ParseError::Chunked),
        (None, None) => Ok(0),
    }
}

pub fn parse_request(raw: &[u8]) -> Result<Request, ParseError> {
    let split = find(raw, b"\r\n\r\n").ok_or(ParseError::Incomplete)?;
    let head = std::str::from_utf8(&raw[..split]).map_err(|_| ParseError::NotUtf8)?;
    let line = parse_request_line(first_line(head.as_bytes()))?;
    let (_, fields) = head.split_once("\r\n").unwrap_or((head, ""));
    let headers = Headers::parse(fields)?;

    let len = body_len(&headers)?;
    let rest = &raw[split + 4..];
    if rest.len() < len {
        return Err(ParseError::Incomplete);
    }
    Ok(Request { line, headers, body: rest[..len].to_vec() })
}

#[derive(Debug, PartialEq)]
pub struct Response {
    pub status: u16,
    pub reason: &'static str,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Response {
    pub fn new(status: u16, reason: &'static str, body: impl Into<Vec<u8>>) -> Response {
        Response { status, reason, headers: Vec::new(), body: body.into() }
    }

    pub fn header(mut self, name: &str, value: &str) -> Response {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut head = format!("HTTP/1.1 {} {}\r\n", self.status, self.reason);
        head.push_str(&format!("Content-Length: {}\r\n", self.body.len()));
        for (name, value) in &self.headers {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        head.push_str("\r\n");

        let mut out = head.into_bytes();
        out.extend_from_slice(&self.body);
        out
    }
}

pub fn match_route<'a>(pattern: &'a str, path: &'a str) -> Option<Vec<(&'a str, &'a str)>> {
    let mut params = Vec::new();
    let mut segments = path.split('/');

    for expected in pattern.split('/') {
        let actual = segments.next()?;
        match expected.strip_prefix(':') {
            Some(name) if !actual.is_empty() => params.push((name, actual)),
            Some(_) => return None,
            None if expected == actual => {}
            None => return None,
        }
    }
    if segments.next().is_some() {
        return None;
    }
    Some(params)
}

pub type Handler = fn(&Request, &[(&str, &str)]) -> Response;

pub struct Route {
    pub method: String,
    pub pattern: String,
    pub handler: Handler,
}

#[derive(Default)]
pub struct Router {
    pub routes: Vec<Route>,
}

impl Router {
    pub fn new() -> Router {
        Router { routes: Vec::new() }
    }

    pub fn add(mut self, method: &str, pattern: &str, handler: Handler) -> Router {
        self.routes.push(Route {
            method: method.to_string(),
            pattern: pattern.to_string(),
            handler,
        });
        self
    }

    pub fn dispatch(&self, req: &Request) -> Response {
        let path = req.line.target.split('?').next().unwrap_or("");
        let mut allowed: Vec<&str> = Vec::new();

        for route in self.routes {
            let Some(params) = match_route(&route.pattern, path) else { continue };
            if route.method == req.line.method {
                return (route.handler)(req, &params);
            }
            allowed.push(&route.method);
        }

        if allowed.is_empty() {
            Response::new(404, "Not Found", "no such path\n")
        } else {
            Response::new(405, "Method Not Allowed", "")
                .header("Allow", &allowed.join(", "))
        }
    }
}

pub fn show(req: &Request, params: &[(&str, &str)]) -> Response {
    let id = params.iter().find(|(k, _)| *k == "id").map(|(_, v)| *v).unwrap_or("?");
    Response::new(200, "OK", format!("user {id}\n"))
}

pub fn health(_req: &Request, _params: &[(&str, &str)]) -> Response {
    Response::new(200, "OK", "ok\n")
}

pub fn demo_router() -> Router {
    Router::new()
        .add("GET", "/users/:id", show)
        .add("POST", "/users/:id", show)
        .add("GET", "/health", health)
}

pub fn run() -> Vec<u16> {
    let router = demo_router();
    let mut codes = Vec::new();

    for raw in [
        &b"GET /users/7 HTTP/1.1\r\n\r\n"[..],
        &b"DELETE /users/7 HTTP/1.1\r\n\r\n"[..],
        &b"GET /orders/7 HTTP/1.1\r\n\r\n"[..],
    ] {
        let req = parse_request(raw).expect("well formed");
        let res = router.dispatch(&req);
        println!("{} {} -> {} {}", req.line.method, req.line.target, res.status, res.reason);
        codes.push(res.status);
    }
    codes
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    fn req(raw: &[u8]) -> Request {
        parse_request(raw).expect("the test request is well formed")
    }

    #[test]
    fn dispatches_and_distinguishes_the_two_failures() {
        assert_eq!(run(), vec![200, 405, 404]);
    }

    #[test]
    fn the_handler_sees_its_parameters() {
        let res = demo_router().dispatch(&req(b"GET /users/7 HTTP/1.1\r\n\r\n"));
        assert_eq!(res.status, 200);
        assert_eq!(res.body, b"user 7\n");
    }

    #[test]
    fn a_wrong_method_on_a_real_path_is_405_with_allow() {
        let res = demo_router().dispatch(&req(b"DELETE /users/7 HTTP/1.1\r\n\r\n"));
        assert_eq!((res.status, res.reason), (405, "Method Not Allowed"));
        assert_eq!(res.headers, vec![("Allow".to_string(), "GET, POST".to_string())]);
    }

    #[test]
    fn an_unknown_path_is_404_with_no_allow() {
        let res = demo_router().dispatch(&req(b"DELETE /orders/7 HTTP/1.1\r\n\r\n"));
        assert_eq!(res.status, 404);
        assert!(res.headers.is_empty());
    }

    #[test]
    fn the_query_string_is_not_part_of_the_path() {
        let res = demo_router().dispatch(&req(b"GET /users/7?tab=logs HTTP/1.1\r\n\r\n"));
        assert_eq!(res.body, b"user 7\n");
    }
}
```

```solution
pub const RAW: &[u8] = b"GET /users/7?tab=logs HTTP/1.1\r\nHost: localhost:8080\r\nUser-Agent: curl/8.4.0\r\nContent-Length: 11\r\n\r\nhello world";

#[derive(Debug, PartialEq)]
pub enum ParseError {
    NotUtf8,
    Malformed,
    UnsupportedVersion,
    BadContentLength,
    Smuggled,
    Chunked,
    Incomplete,
}

#[derive(Debug, PartialEq)]
pub struct RequestLine {
    pub method: String,
    pub target: String,
    pub version: String,
}

pub fn first_line(raw: &[u8]) -> &[u8] {
    let end = raw.windows(2).position(|w| w == b"\r\n").unwrap_or(raw.len());
    &raw[..end]
}

pub fn parse_request_line(line: &[u8]) -> Result<RequestLine, ParseError> {
    let text = std::str::from_utf8(line).map_err(|_| ParseError::NotUtf8)?;
    let mut parts = text.split(' ');
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let version = parts.next().unwrap_or("");

    if parts.next().is_some() || method.is_empty() || target.is_empty() {
        return Err(ParseError::Malformed);
    }
    if version != "HTTP/1.0" && version != "HTTP/1.1" {
        return Err(ParseError::UnsupportedVersion);
    }
    Ok(RequestLine {
        method: method.to_string(),
        target: target.to_string(),
        version: version.to_string(),
    })
}

#[derive(Debug, Default, PartialEq)]
pub struct Headers(Vec<(String, String)>);

impl Headers {
    pub fn parse(block: &str) -> Result<Headers, ParseError> {
        let mut fields = Vec::new();
        for line in block.split("\r\n").filter(|l| !l.is_empty()) {
            let (name, value) = line.split_once(':').ok_or(ParseError::Malformed)?;
            if name.is_empty() || name.ends_with(' ') || name.ends_with('\t') {
                return Err(ParseError::Malformed);
            }
            fields.push((name.to_string(), value.trim().to_string()));
        }
        Ok(Headers(fields))
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(field, _)| field.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[derive(Debug, PartialEq)]
pub struct Request {
    pub line: RequestLine,
    pub headers: Headers,
    pub body: Vec<u8>,
}

pub fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

pub fn body_len(headers: &Headers) -> Result<usize, ParseError> {
    match (headers.get("content-length"), headers.get("transfer-encoding")) {
        (Some(_), Some(_)) => Err(ParseError::Smuggled),
        (Some(n), None) if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) => {
            n.parse::<usize>().map_err(|_| ParseError::BadContentLength)
        }
        (Some(_), None) => Err(ParseError::BadContentLength),
        (None, Some(_)) => Err(ParseError::Chunked),
        (None, None) => Ok(0),
    }
}

pub fn parse_request(raw: &[u8]) -> Result<Request, ParseError> {
    let split = find(raw, b"\r\n\r\n").ok_or(ParseError::Incomplete)?;
    let head = std::str::from_utf8(&raw[..split]).map_err(|_| ParseError::NotUtf8)?;
    let line = parse_request_line(first_line(head.as_bytes()))?;
    let (_, fields) = head.split_once("\r\n").unwrap_or((head, ""));
    let headers = Headers::parse(fields)?;

    let len = body_len(&headers)?;
    let rest = &raw[split + 4..];
    if rest.len() < len {
        return Err(ParseError::Incomplete);
    }
    Ok(Request { line, headers, body: rest[..len].to_vec() })
}

#[derive(Debug, PartialEq)]
pub struct Response {
    pub status: u16,
    pub reason: &'static str,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Response {
    pub fn new(status: u16, reason: &'static str, body: impl Into<Vec<u8>>) -> Response {
        Response { status, reason, headers: Vec::new(), body: body.into() }
    }

    pub fn header(mut self, name: &str, value: &str) -> Response {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut head = format!("HTTP/1.1 {} {}\r\n", self.status, self.reason);
        head.push_str(&format!("Content-Length: {}\r\n", self.body.len()));
        for (name, value) in &self.headers {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        head.push_str("\r\n");

        let mut out = head.into_bytes();
        out.extend_from_slice(&self.body);
        out
    }
}

pub fn match_route<'a>(pattern: &'a str, path: &'a str) -> Option<Vec<(&'a str, &'a str)>> {
    let mut params = Vec::new();
    let mut segments = path.split('/');

    for expected in pattern.split('/') {
        let actual = segments.next()?;
        match expected.strip_prefix(':') {
            Some(name) if !actual.is_empty() => params.push((name, actual)),
            Some(_) => return None,
            None if expected == actual => {}
            None => return None,
        }
    }
    if segments.next().is_some() {
        return None;
    }
    Some(params)
}

pub type Handler = fn(&Request, &[(&str, &str)]) -> Response;

pub struct Route {
    pub method: String,
    pub pattern: String,
    pub handler: Handler,
}

#[derive(Default)]
pub struct Router {
    pub routes: Vec<Route>,
}

impl Router {
    pub fn new() -> Router {
        Router { routes: Vec::new() }
    }

    pub fn add(mut self, method: &str, pattern: &str, handler: Handler) -> Router {
        self.routes.push(Route {
            method: method.to_string(),
            pattern: pattern.to_string(),
            handler,
        });
        self
    }

    pub fn dispatch(&self, req: &Request) -> Response {
        let path = req.line.target.split('?').next().unwrap_or("");
        let mut allowed: Vec<&str> = Vec::new();

        for route in &self.routes {
            let Some(params) = match_route(&route.pattern, path) else { continue };
            if route.method == req.line.method {
                return (route.handler)(req, &params);
            }
            allowed.push(&route.method);
        }

        if allowed.is_empty() {
            Response::new(404, "Not Found", "no such path\n")
        } else {
            Response::new(405, "Method Not Allowed", "")
                .header("Allow", &allowed.join(", "))
        }
    }
}

pub fn show(req: &Request, params: &[(&str, &str)]) -> Response {
    let id = params.iter().find(|(k, _)| *k == "id").map(|(_, v)| *v).unwrap_or("?");
    Response::new(200, "OK", format!("user {id}\n"))
}

pub fn health(_req: &Request, _params: &[(&str, &str)]) -> Response {
    Response::new(200, "OK", "ok\n")
}

pub fn demo_router() -> Router {
    Router::new()
        .add("GET", "/users/:id", show)
        .add("POST", "/users/:id", show)
        .add("GET", "/health", health)
}

pub fn run() -> Vec<u16> {
    let router = demo_router();
    let mut codes = Vec::new();

    for raw in [
        &b"GET /users/7 HTTP/1.1\r\n\r\n"[..],
        &b"DELETE /users/7 HTTP/1.1\r\n\r\n"[..],
        &b"GET /orders/7 HTTP/1.1\r\n\r\n"[..],
    ] {
        let req = parse_request(raw).expect("well formed");
        let res = router.dispatch(&req);
        println!("{} {} -> {} {}", req.line.method, req.line.target, res.status, res.reason);
        codes.push(res.status);
    }
    codes
}
```

@hint `dispatch` takes `&self`, and the loop consumes what it iterates.
@hint `for x in collection` calls `IntoIterator::into_iter`, which for a `Vec` takes it by value and hands out owned items. Through a shared reference there is nothing to take.
@hint Iterate over a reference: `for route in &self.routes`, which yields `&Route` and leaves the router intact for the next request.

@diagnose E0507
`cannot move out of self.routes which is behind a shared reference`.

`for route in self.routes` desugars to `IntoIterator::into_iter(self.routes)`,
and the implementation chosen for `Vec<Route>` is the one that consumes the
vector so it can yield owned `Route` values. Consuming means moving, and you
cannot move a field out of something you only borrowed: the caller still owns the
router and expects it to be whole when the call returns.

`&self.routes` selects a different implementation, `IntoIterator for &Vec<T>`,
which yields `&Route`. Same syntax, different trait implementation, no move. This
is the reason `iter()` exists as a habit even where `into_iter()` would compile.

@diagnose E0597
`borrowed value does not live long enough`, usually pointing at `allowed`.
The vector holds `&str` values borrowed out of `self.routes`, so it can only live
as long as the borrow of `self`, and the borrow of `self` lasts the whole call.
Fine. If the error persists after fixing the loop, look at whether something in
the failing path builds a `String` inside the loop and pushes a reference to it:
the `String` dies at the end of the iteration and the reference outlives it.

@after
The distinction the tests pin is worth stating plainly. 404 means the server has
nothing at that path. 405 means the path is real and the method is not, and the
`Allow` header is required by the specification so the client can find out what
is. A router that answers 404 for both tells a client that a resource does not
exist when it does, which turns a fixable mistake into a confusing one.

Getting that requires the two-pass shape you just wrote: match every route's
path, collect the methods that matched, and only then decide. A router that
returns 404 the moment the first route fails cannot tell the two cases apart,
because the information is spread across the whole route list.

`Handler` is a plain `fn` pointer, which keeps `Router` simple and free of
generics. A framework uses `Box<dyn Fn(..)>` instead so that handlers can close
over a database pool, at the cost of an allocation and an indirect call per
route.

## 7. Whether the connection stays open

@kind fix
@concept derive

@expect E0369

HTTP/1.0 closed the connection after every response. HTTP/1.1 reversed the
default, so a connection stays open unless somebody says otherwise, and the
`Connection` header can override either default. `connection_for` decides.
Comparing two of its values does not compile.

```starter
pub const RAW: &[u8] = b"GET /users/7?tab=logs HTTP/1.1\r\nHost: localhost:8080\r\nUser-Agent: curl/8.4.0\r\nContent-Length: 11\r\n\r\nhello world";

#[derive(Debug, PartialEq)]
pub enum ParseError {
    NotUtf8,
    Malformed,
    UnsupportedVersion,
    BadContentLength,
    Smuggled,
    Chunked,
    Incomplete,
}

#[derive(Debug, PartialEq)]
pub struct RequestLine {
    pub method: String,
    pub target: String,
    pub version: String,
}

pub fn first_line(raw: &[u8]) -> &[u8] {
    let end = raw.windows(2).position(|w| w == b"\r\n").unwrap_or(raw.len());
    &raw[..end]
}

pub fn parse_request_line(line: &[u8]) -> Result<RequestLine, ParseError> {
    let text = std::str::from_utf8(line).map_err(|_| ParseError::NotUtf8)?;
    let mut parts = text.split(' ');
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let version = parts.next().unwrap_or("");

    if parts.next().is_some() || method.is_empty() || target.is_empty() {
        return Err(ParseError::Malformed);
    }
    if version != "HTTP/1.0" && version != "HTTP/1.1" {
        return Err(ParseError::UnsupportedVersion);
    }
    Ok(RequestLine {
        method: method.to_string(),
        target: target.to_string(),
        version: version.to_string(),
    })
}

#[derive(Debug, Default, PartialEq)]
pub struct Headers(Vec<(String, String)>);

impl Headers {
    pub fn parse(block: &str) -> Result<Headers, ParseError> {
        let mut fields = Vec::new();
        for line in block.split("\r\n").filter(|l| !l.is_empty()) {
            let (name, value) = line.split_once(':').ok_or(ParseError::Malformed)?;
            if name.is_empty() || name.ends_with(' ') || name.ends_with('\t') {
                return Err(ParseError::Malformed);
            }
            fields.push((name.to_string(), value.trim().to_string()));
        }
        Ok(Headers(fields))
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(field, _)| field.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[derive(Debug, PartialEq)]
pub struct Request {
    pub line: RequestLine,
    pub headers: Headers,
    pub body: Vec<u8>,
}

pub fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

pub fn body_len(headers: &Headers) -> Result<usize, ParseError> {
    match (headers.get("content-length"), headers.get("transfer-encoding")) {
        (Some(_), Some(_)) => Err(ParseError::Smuggled),
        (Some(n), None) if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) => {
            n.parse::<usize>().map_err(|_| ParseError::BadContentLength)
        }
        (Some(_), None) => Err(ParseError::BadContentLength),
        (None, Some(_)) => Err(ParseError::Chunked),
        (None, None) => Ok(0),
    }
}

pub fn parse_request(raw: &[u8]) -> Result<Request, ParseError> {
    let split = find(raw, b"\r\n\r\n").ok_or(ParseError::Incomplete)?;
    let head = std::str::from_utf8(&raw[..split]).map_err(|_| ParseError::NotUtf8)?;
    let line = parse_request_line(first_line(head.as_bytes()))?;
    let (_, fields) = head.split_once("\r\n").unwrap_or((head, ""));
    let headers = Headers::parse(fields)?;

    let len = body_len(&headers)?;
    let rest = &raw[split + 4..];
    if rest.len() < len {
        return Err(ParseError::Incomplete);
    }
    Ok(Request { line, headers, body: rest[..len].to_vec() })
}

#[derive(Debug, PartialEq)]
pub struct Response {
    pub status: u16,
    pub reason: &'static str,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Response {
    pub fn new(status: u16, reason: &'static str, body: impl Into<Vec<u8>>) -> Response {
        Response { status, reason, headers: Vec::new(), body: body.into() }
    }

    pub fn header(mut self, name: &str, value: &str) -> Response {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut head = format!("HTTP/1.1 {} {}\r\n", self.status, self.reason);
        head.push_str(&format!("Content-Length: {}\r\n", self.body.len()));
        for (name, value) in &self.headers {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        head.push_str("\r\n");

        let mut out = head.into_bytes();
        out.extend_from_slice(&self.body);
        out
    }
}

pub fn match_route<'a>(pattern: &'a str, path: &'a str) -> Option<Vec<(&'a str, &'a str)>> {
    let mut params = Vec::new();
    let mut segments = path.split('/');

    for expected in pattern.split('/') {
        let actual = segments.next()?;
        match expected.strip_prefix(':') {
            Some(name) if !actual.is_empty() => params.push((name, actual)),
            Some(_) => return None,
            None if expected == actual => {}
            None => return None,
        }
    }
    if segments.next().is_some() {
        return None;
    }
    Some(params)
}

pub type Handler = fn(&Request, &[(&str, &str)]) -> Response;

pub struct Route {
    pub method: String,
    pub pattern: String,
    pub handler: Handler,
}

#[derive(Default)]
pub struct Router {
    pub routes: Vec<Route>,
}

impl Router {
    pub fn new() -> Router {
        Router { routes: Vec::new() }
    }

    pub fn add(mut self, method: &str, pattern: &str, handler: Handler) -> Router {
        self.routes.push(Route {
            method: method.to_string(),
            pattern: pattern.to_string(),
            handler,
        });
        self
    }

    pub fn dispatch(&self, req: &Request) -> Response {
        let path = req.line.target.split('?').next().unwrap_or("");
        let mut allowed: Vec<&str> = Vec::new();

        for route in &self.routes {
            let Some(params) = match_route(&route.pattern, path) else { continue };
            if route.method == req.line.method {
                return (route.handler)(req, &params);
            }
            allowed.push(&route.method);
        }

        if allowed.is_empty() {
            Response::new(404, "Not Found", "no such path\n")
        } else {
            Response::new(405, "Method Not Allowed", "")
                .header("Allow", &allowed.join(", "))
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub enum Connection {
    KeepAlive,
    Close,
}

pub fn connection_for(version: &str, header: Option<&str>) -> Connection {
    let says = |want: &str| {
        header
            .unwrap_or("")
            .split(',')
            .any(|token| token.trim().eq_ignore_ascii_case(want))
    };

    if says("close") {
        Connection::Close
    } else if version == "HTTP/1.1" || says("keep-alive") {
        Connection::KeepAlive
    } else {
        Connection::Close
    }
}

pub fn respond(router: &Router, req: &Request) -> (Response, Connection) {
    let conn = connection_for(&req.line.version, req.headers.get("connection"));
    let res = router.dispatch(req);
    let res = if conn == Connection::Close {
        res.header("Connection", "close")
    } else {
        res.header("Connection", "keep-alive")
    };
    (res, conn)
}

pub fn show(req: &Request, params: &[(&str, &str)]) -> Response {
    let id = params.iter().find(|(k, _)| *k == "id").map(|(_, v)| *v).unwrap_or("?");
    Response::new(200, "OK", format!("user {id}\n"))
}

pub fn health(_req: &Request, _params: &[(&str, &str)]) -> Response {
    Response::new(200, "OK", "ok\n")
}

pub fn demo_router() -> Router {
    Router::new()
        .add("GET", "/users/:id", show)
        .add("POST", "/users/:id", show)
        .add("GET", "/health", health)
}

pub fn run() -> Vec<Connection> {
    let router = demo_router();
    let mut decisions = Vec::new();

    for raw in [
        &b"GET /health HTTP/1.1\r\n\r\n"[..],
        &b"GET /health HTTP/1.1\r\nConnection: close\r\n\r\n"[..],
        &b"GET /health HTTP/1.0\r\n\r\n"[..],
        &b"GET /health HTTP/1.0\r\nConnection: Keep-Alive\r\n\r\n"[..],
    ] {
        let req = parse_request(raw).expect("well formed");
        let (res, conn) = respond(&router, &req);
        println!("{} {:?} -> {conn:?}", req.line.version, req.headers.get("connection"));
        println!("{}", String::from_utf8_lossy(&res.to_bytes()).replace("\r\n", " | "));
        decisions.push(conn);
    }
    decisions
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    fn req(raw: &[u8]) -> Request {
        parse_request(raw).expect("the test request is well formed")
    }

    #[test]
    fn decides_for_the_four_sample_requests() {
        use Connection::*;
        assert_eq!(run(), vec![KeepAlive, Close, Close, KeepAlive]);
    }

    #[test]
    fn eleven_defaults_open_and_ten_defaults_closed() {
        assert_eq!(connection_for("HTTP/1.1", None), Connection::KeepAlive);
        assert_eq!(connection_for("HTTP/1.0", None), Connection::Close);
    }

    #[test]
    fn the_header_beats_the_version_in_both_directions() {
        assert_eq!(connection_for("HTTP/1.1", Some("close")), Connection::Close);
        assert_eq!(connection_for("HTTP/1.0", Some("keep-alive")), Connection::KeepAlive);
        assert_eq!(connection_for("HTTP/1.1", Some("Close")), Connection::Close);
        assert_eq!(connection_for("HTTP/1.0", Some("Keep-Alive")), Connection::KeepAlive);
    }

    #[test]
    fn the_header_is_a_comma_separated_list() {
        assert_eq!(connection_for("HTTP/1.1", Some("keep-alive, close")), Connection::Close);
        assert_eq!(connection_for("HTTP/1.0", Some("te, keep-alive")), Connection::KeepAlive);
        assert_eq!(connection_for("HTTP/1.1", Some("upgrade")), Connection::KeepAlive);
    }

    #[test]
    fn the_answer_reaches_the_wire() {
        let router = demo_router();
        let (res, conn) = respond(&router, &req(b"GET /health HTTP/1.1\r\nConnection: close\r\n\r\n"));
        assert_eq!(conn, Connection::Close);
        let text = String::from_utf8(res.to_bytes()).unwrap();
        assert!(text.contains("Connection: close\r\n"), "{text:?}");
    }
}
```

```solution
pub const RAW: &[u8] = b"GET /users/7?tab=logs HTTP/1.1\r\nHost: localhost:8080\r\nUser-Agent: curl/8.4.0\r\nContent-Length: 11\r\n\r\nhello world";

#[derive(Debug, PartialEq)]
pub enum ParseError {
    NotUtf8,
    Malformed,
    UnsupportedVersion,
    BadContentLength,
    Smuggled,
    Chunked,
    Incomplete,
}

#[derive(Debug, PartialEq)]
pub struct RequestLine {
    pub method: String,
    pub target: String,
    pub version: String,
}

pub fn first_line(raw: &[u8]) -> &[u8] {
    let end = raw.windows(2).position(|w| w == b"\r\n").unwrap_or(raw.len());
    &raw[..end]
}

pub fn parse_request_line(line: &[u8]) -> Result<RequestLine, ParseError> {
    let text = std::str::from_utf8(line).map_err(|_| ParseError::NotUtf8)?;
    let mut parts = text.split(' ');
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let version = parts.next().unwrap_or("");

    if parts.next().is_some() || method.is_empty() || target.is_empty() {
        return Err(ParseError::Malformed);
    }
    if version != "HTTP/1.0" && version != "HTTP/1.1" {
        return Err(ParseError::UnsupportedVersion);
    }
    Ok(RequestLine {
        method: method.to_string(),
        target: target.to_string(),
        version: version.to_string(),
    })
}

#[derive(Debug, Default, PartialEq)]
pub struct Headers(Vec<(String, String)>);

impl Headers {
    pub fn parse(block: &str) -> Result<Headers, ParseError> {
        let mut fields = Vec::new();
        for line in block.split("\r\n").filter(|l| !l.is_empty()) {
            let (name, value) = line.split_once(':').ok_or(ParseError::Malformed)?;
            if name.is_empty() || name.ends_with(' ') || name.ends_with('\t') {
                return Err(ParseError::Malformed);
            }
            fields.push((name.to_string(), value.trim().to_string()));
        }
        Ok(Headers(fields))
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(field, _)| field.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[derive(Debug, PartialEq)]
pub struct Request {
    pub line: RequestLine,
    pub headers: Headers,
    pub body: Vec<u8>,
}

pub fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

pub fn body_len(headers: &Headers) -> Result<usize, ParseError> {
    match (headers.get("content-length"), headers.get("transfer-encoding")) {
        (Some(_), Some(_)) => Err(ParseError::Smuggled),
        (Some(n), None) if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) => {
            n.parse::<usize>().map_err(|_| ParseError::BadContentLength)
        }
        (Some(_), None) => Err(ParseError::BadContentLength),
        (None, Some(_)) => Err(ParseError::Chunked),
        (None, None) => Ok(0),
    }
}

pub fn parse_request(raw: &[u8]) -> Result<Request, ParseError> {
    let split = find(raw, b"\r\n\r\n").ok_or(ParseError::Incomplete)?;
    let head = std::str::from_utf8(&raw[..split]).map_err(|_| ParseError::NotUtf8)?;
    let line = parse_request_line(first_line(head.as_bytes()))?;
    let (_, fields) = head.split_once("\r\n").unwrap_or((head, ""));
    let headers = Headers::parse(fields)?;

    let len = body_len(&headers)?;
    let rest = &raw[split + 4..];
    if rest.len() < len {
        return Err(ParseError::Incomplete);
    }
    Ok(Request { line, headers, body: rest[..len].to_vec() })
}

#[derive(Debug, PartialEq)]
pub struct Response {
    pub status: u16,
    pub reason: &'static str,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Response {
    pub fn new(status: u16, reason: &'static str, body: impl Into<Vec<u8>>) -> Response {
        Response { status, reason, headers: Vec::new(), body: body.into() }
    }

    pub fn header(mut self, name: &str, value: &str) -> Response {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut head = format!("HTTP/1.1 {} {}\r\n", self.status, self.reason);
        head.push_str(&format!("Content-Length: {}\r\n", self.body.len()));
        for (name, value) in &self.headers {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        head.push_str("\r\n");

        let mut out = head.into_bytes();
        out.extend_from_slice(&self.body);
        out
    }
}

pub fn match_route<'a>(pattern: &'a str, path: &'a str) -> Option<Vec<(&'a str, &'a str)>> {
    let mut params = Vec::new();
    let mut segments = path.split('/');

    for expected in pattern.split('/') {
        let actual = segments.next()?;
        match expected.strip_prefix(':') {
            Some(name) if !actual.is_empty() => params.push((name, actual)),
            Some(_) => return None,
            None if expected == actual => {}
            None => return None,
        }
    }
    if segments.next().is_some() {
        return None;
    }
    Some(params)
}

pub type Handler = fn(&Request, &[(&str, &str)]) -> Response;

pub struct Route {
    pub method: String,
    pub pattern: String,
    pub handler: Handler,
}

#[derive(Default)]
pub struct Router {
    pub routes: Vec<Route>,
}

impl Router {
    pub fn new() -> Router {
        Router { routes: Vec::new() }
    }

    pub fn add(mut self, method: &str, pattern: &str, handler: Handler) -> Router {
        self.routes.push(Route {
            method: method.to_string(),
            pattern: pattern.to_string(),
            handler,
        });
        self
    }

    pub fn dispatch(&self, req: &Request) -> Response {
        let path = req.line.target.split('?').next().unwrap_or("");
        let mut allowed: Vec<&str> = Vec::new();

        for route in &self.routes {
            let Some(params) = match_route(&route.pattern, path) else { continue };
            if route.method == req.line.method {
                return (route.handler)(req, &params);
            }
            allowed.push(&route.method);
        }

        if allowed.is_empty() {
            Response::new(404, "Not Found", "no such path\n")
        } else {
            Response::new(405, "Method Not Allowed", "")
                .header("Allow", &allowed.join(", "))
        }
    }
}

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Connection {
    KeepAlive,
    Close,
}

pub fn connection_for(version: &str, header: Option<&str>) -> Connection {
    let says = |want: &str| {
        header
            .unwrap_or("")
            .split(',')
            .any(|token| token.trim().eq_ignore_ascii_case(want))
    };

    if says("close") {
        Connection::Close
    } else if version == "HTTP/1.1" || says("keep-alive") {
        Connection::KeepAlive
    } else {
        Connection::Close
    }
}

pub fn respond(router: &Router, req: &Request) -> (Response, Connection) {
    let conn = connection_for(&req.line.version, req.headers.get("connection"));
    let res = router.dispatch(req);
    let res = if conn == Connection::Close {
        res.header("Connection", "close")
    } else {
        res.header("Connection", "keep-alive")
    };
    (res, conn)
}

pub fn show(req: &Request, params: &[(&str, &str)]) -> Response {
    let id = params.iter().find(|(k, _)| *k == "id").map(|(_, v)| *v).unwrap_or("?");
    Response::new(200, "OK", format!("user {id}\n"))
}

pub fn health(_req: &Request, _params: &[(&str, &str)]) -> Response {
    Response::new(200, "OK", "ok\n")
}

pub fn demo_router() -> Router {
    Router::new()
        .add("GET", "/users/:id", show)
        .add("POST", "/users/:id", show)
        .add("GET", "/health", health)
}

pub fn run() -> Vec<Connection> {
    let router = demo_router();
    let mut decisions = Vec::new();

    for raw in [
        &b"GET /health HTTP/1.1\r\n\r\n"[..],
        &b"GET /health HTTP/1.1\r\nConnection: close\r\n\r\n"[..],
        &b"GET /health HTTP/1.0\r\n\r\n"[..],
        &b"GET /health HTTP/1.0\r\nConnection: Keep-Alive\r\n\r\n"[..],
    ] {
        let req = parse_request(raw).expect("well formed");
        let (res, conn) = respond(&router, &req);
        println!("{} {:?} -> {conn:?}", req.line.version, req.headers.get("connection"));
        println!("{}", String::from_utf8_lossy(&res.to_bytes()).replace("\r\n", " | "));
        decisions.push(conn);
    }
    decisions
}
```

@hint `==` is not built into the language for your own types. It comes from a trait.
@hint `assert_eq!` and `==` both need `PartialEq`, and the enum only derives `Debug`.
@hint Add it to the derive list: `#[derive(Debug, PartialEq, Clone, Copy)]`.

@diagnose E0369
`binary operation == cannot be applied to type Connection`, with a note offering
to derive `PartialEq`.

`a == b` is `PartialEq::eq(&a, &b)`. For a type you defined, that implementation
exists only if you asked for it, and `#[derive(PartialEq)]` writes the obvious
one: two values are equal when they are the same variant with equal fields.

Rust could have made structural equality automatic, and chose not to, because
equality is a decision. A case-insensitive string wrapper, a floating-point
wrapper with `NaN` in it, a struct with a cached hash field: for each of those
the obvious comparison is the wrong one. Making you write `derive` is how the
language asks whether the obvious one is what you meant. Here it is.

@diagnose E0277
`Connection doesn't implement Debug`, from `assert_eq!` or a `{:?}` in a
`println!`. The macro prints both sides when the assertion fails, so it requires
`Debug` on top of `PartialEq`. `#[derive(Debug)]` prints the variant name.
The pair of them together is the usual derive list for a small enum, along with
`Clone, Copy` for one that is a byte wide and cheaper to copy than to reference.

@after
The rule the function encodes, in the order it is checked. An explicit `close`
wins over everything. Otherwise HTTP/1.1 stays open, because that is its default.
Otherwise HTTP/1.0 stays open only if the client asked with `Connection:
keep-alive`, which was the pre-standard extension that became the 1.1 default.

Two details make it correct rather than approximately correct. The header is a
comma-separated list, so `Connection: keep-alive, close` contains `close` and
means close. And the tokens are case-insensitive, like the field names in stage
2, so `Close` and `close` are the same instruction.

The point of keeping a connection open is the handshake it avoids. TCP costs a
round trip before any byte of the request is sent, and TLS costs one or two more.
On a page pulling forty small assets from one host, reusing the connection is the
difference between one setup and forty.

## 8. The accept loop

@kind fix
@concept thread

@expect E0382

The last piece. `request_len` says whether a complete request is sitting in the
buffer and how long it is, `handle` turns those bytes into a response, and
`serve` accepts connections and gives each one a thread. The router has to be
shared by every one of those threads, and the loop as written gives it away to
the first.

```starter
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::thread;

pub const RAW: &[u8] = b"GET /users/7?tab=logs HTTP/1.1\r\nHost: localhost:8080\r\nUser-Agent: curl/8.4.0\r\nContent-Length: 11\r\n\r\nhello world";

#[derive(Debug, PartialEq)]
pub enum ParseError {
    NotUtf8,
    Malformed,
    UnsupportedVersion,
    BadContentLength,
    Smuggled,
    Chunked,
    Incomplete,
}

#[derive(Debug, PartialEq)]
pub struct RequestLine {
    pub method: String,
    pub target: String,
    pub version: String,
}

pub fn first_line(raw: &[u8]) -> &[u8] {
    let end = raw.windows(2).position(|w| w == b"\r\n").unwrap_or(raw.len());
    &raw[..end]
}

pub fn parse_request_line(line: &[u8]) -> Result<RequestLine, ParseError> {
    let text = std::str::from_utf8(line).map_err(|_| ParseError::NotUtf8)?;
    let mut parts = text.split(' ');
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let version = parts.next().unwrap_or("");

    if parts.next().is_some() || method.is_empty() || target.is_empty() {
        return Err(ParseError::Malformed);
    }
    if version != "HTTP/1.0" && version != "HTTP/1.1" {
        return Err(ParseError::UnsupportedVersion);
    }
    Ok(RequestLine {
        method: method.to_string(),
        target: target.to_string(),
        version: version.to_string(),
    })
}

#[derive(Debug, Default, PartialEq)]
pub struct Headers(Vec<(String, String)>);

impl Headers {
    pub fn parse(block: &str) -> Result<Headers, ParseError> {
        let mut fields = Vec::new();
        for line in block.split("\r\n").filter(|l| !l.is_empty()) {
            let (name, value) = line.split_once(':').ok_or(ParseError::Malformed)?;
            if name.is_empty() || name.ends_with(' ') || name.ends_with('\t') {
                return Err(ParseError::Malformed);
            }
            fields.push((name.to_string(), value.trim().to_string()));
        }
        Ok(Headers(fields))
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(field, _)| field.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[derive(Debug, PartialEq)]
pub struct Request {
    pub line: RequestLine,
    pub headers: Headers,
    pub body: Vec<u8>,
}

pub fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

pub fn body_len(headers: &Headers) -> Result<usize, ParseError> {
    match (headers.get("content-length"), headers.get("transfer-encoding")) {
        (Some(_), Some(_)) => Err(ParseError::Smuggled),
        (Some(n), None) if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) => {
            n.parse::<usize>().map_err(|_| ParseError::BadContentLength)
        }
        (Some(_), None) => Err(ParseError::BadContentLength),
        (None, Some(_)) => Err(ParseError::Chunked),
        (None, None) => Ok(0),
    }
}

pub fn parse_request(raw: &[u8]) -> Result<Request, ParseError> {
    let split = find(raw, b"\r\n\r\n").ok_or(ParseError::Incomplete)?;
    let head = std::str::from_utf8(&raw[..split]).map_err(|_| ParseError::NotUtf8)?;
    let line = parse_request_line(first_line(head.as_bytes()))?;
    let (_, fields) = head.split_once("\r\n").unwrap_or((head, ""));
    let headers = Headers::parse(fields)?;

    let len = body_len(&headers)?;
    let rest = &raw[split + 4..];
    if rest.len() < len {
        return Err(ParseError::Incomplete);
    }
    Ok(Request { line, headers, body: rest[..len].to_vec() })
}

#[derive(Debug, PartialEq)]
pub struct Response {
    pub status: u16,
    pub reason: &'static str,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Response {
    pub fn new(status: u16, reason: &'static str, body: impl Into<Vec<u8>>) -> Response {
        Response { status, reason, headers: Vec::new(), body: body.into() }
    }

    pub fn header(mut self, name: &str, value: &str) -> Response {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut head = format!("HTTP/1.1 {} {}\r\n", self.status, self.reason);
        head.push_str(&format!("Content-Length: {}\r\n", self.body.len()));
        for (name, value) in &self.headers {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        head.push_str("\r\n");

        let mut out = head.into_bytes();
        out.extend_from_slice(&self.body);
        out
    }
}

pub fn match_route<'a>(pattern: &'a str, path: &'a str) -> Option<Vec<(&'a str, &'a str)>> {
    let mut params = Vec::new();
    let mut segments = path.split('/');

    for expected in pattern.split('/') {
        let actual = segments.next()?;
        match expected.strip_prefix(':') {
            Some(name) if !actual.is_empty() => params.push((name, actual)),
            Some(_) => return None,
            None if expected == actual => {}
            None => return None,
        }
    }
    if segments.next().is_some() {
        return None;
    }
    Some(params)
}

pub type Handler = fn(&Request, &[(&str, &str)]) -> Response;

pub struct Route {
    pub method: String,
    pub pattern: String,
    pub handler: Handler,
}

#[derive(Default)]
pub struct Router {
    pub routes: Vec<Route>,
}

impl Router {
    pub fn new() -> Router {
        Router { routes: Vec::new() }
    }

    pub fn add(mut self, method: &str, pattern: &str, handler: Handler) -> Router {
        self.routes.push(Route {
            method: method.to_string(),
            pattern: pattern.to_string(),
            handler,
        });
        self
    }

    pub fn dispatch(&self, req: &Request) -> Response {
        let path = req.line.target.split('?').next().unwrap_or("");
        let mut allowed: Vec<&str> = Vec::new();

        for route in &self.routes {
            let Some(params) = match_route(&route.pattern, path) else { continue };
            if route.method == req.line.method {
                return (route.handler)(req, &params);
            }
            allowed.push(&route.method);
        }

        if allowed.is_empty() {
            Response::new(404, "Not Found", "no such path\n")
        } else {
            Response::new(405, "Method Not Allowed", "")
                .header("Allow", &allowed.join(", "))
        }
    }
}

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Connection {
    KeepAlive,
    Close,
}

pub fn connection_for(version: &str, header: Option<&str>) -> Connection {
    let says = |want: &str| {
        header
            .unwrap_or("")
            .split(',')
            .any(|token| token.trim().eq_ignore_ascii_case(want))
    };

    if says("close") {
        Connection::Close
    } else if version == "HTTP/1.1" || says("keep-alive") {
        Connection::KeepAlive
    } else {
        Connection::Close
    }
}

pub fn respond(router: &Router, req: &Request) -> (Response, Connection) {
    let conn = connection_for(&req.line.version, req.headers.get("connection"));
    let res = router.dispatch(req);
    let res = if conn == Connection::Close {
        res.header("Connection", "close")
    } else {
        res.header("Connection", "keep-alive")
    };
    (res, conn)
}

pub fn request_len(raw: &[u8]) -> Option<usize> {
    let split = find(raw, b"\r\n\r\n")?;
    let head = std::str::from_utf8(&raw[..split]).ok()?;
    let (_, fields) = head.split_once("\r\n").unwrap_or((head, ""));
    let len = Headers::parse(fields)
        .and_then(|h| body_len(&h))
        .unwrap_or(0);

    let total = split + 4 + len;
    if raw.len() >= total { Some(total) } else { None }
}

pub fn handle(router: &Router, raw: &[u8]) -> (Vec<u8>, Connection) {
    match parse_request(raw) {
        Ok(req) => {
            let (res, conn) = respond(router, &req);
            (res.to_bytes(), conn)
        }
        Err(why) => {
            let res = Response::new(400, "Bad Request", format!("{why:?}\n"))
                .header("Connection", "close");
            (res.to_bytes(), Connection::Close)
        }
    }
}

pub fn serve(addr: &str, router: Router) -> std::io::Result<()> {
    let listener = TcpListener::bind(addr)?;

    for stream in listener.incoming() {
        let stream = stream?;
        thread::spawn(move || {
            let _ = serve_one(&router, stream);
        });
    }
    Ok(())
}

pub fn serve_one(router: &Router, mut stream: TcpStream) -> std::io::Result<()> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];

    loop {
        let n = stream.read(&mut chunk)?;
        if n == 0 {
            return Ok(());
        }
        buf.extend_from_slice(&chunk[..n]);

        while let Some(used) = request_len(&buf) {
            let (bytes, conn) = handle(router, &buf[..used]);
            stream.write_all(&bytes)?;
            buf.drain(..used);
            if conn == Connection::Close {
                return Ok(());
            }
        }
    }
}

pub fn show(req: &Request, params: &[(&str, &str)]) -> Response {
    let id = params.iter().find(|(k, _)| *k == "id").map(|(_, v)| *v).unwrap_or("?");
    Response::new(200, "OK", format!("user {id}\n"))
}

pub fn health(_req: &Request, _params: &[(&str, &str)]) -> Response {
    Response::new(200, "OK", "ok\n")
}

pub fn demo_router() -> Router {
    Router::new()
        .add("GET", "/users/:id", show)
        .add("POST", "/users/:id", show)
        .add("GET", "/health", health)
}

pub const PIPELINED: &[u8] = b"GET /health HTTP/1.1\r\n\r\nPOST /users/7 HTTP/1.1\r\nContent-Length: 4\r\n\r\nnameGET /health HTTP/1.1\r\nConnection: close\r\n\r\n";

pub fn run() -> usize {
    let router = demo_router();
    let mut buf = &PIPELINED[..];
    let mut served = 0;

    while let Some(used) = request_len(buf) {
        let (bytes, conn) = handle(&router, &buf[..used]);
        println!("--- request {served}, {used} bytes in");
        println!("{}", String::from_utf8_lossy(&bytes).replace("\r\n", " | "));
        buf = &buf[used..];
        served += 1;
        if conn == Connection::Close {
            println!("client asked to close");
            break;
        }
    }
    served
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn three_pipelined_requests_are_served_from_one_buffer() {
        assert_eq!(run(), 3);
    }

    #[test]
    fn request_len_measures_head_plus_body() {
        let one = b"GET /health HTTP/1.1\r\n\r\n";
        assert_eq!(request_len(one), Some(one.len()));
        assert_eq!(request_len(PIPELINED), Some(one.len()));

        let with_body = b"POST /users/7 HTTP/1.1\r\nContent-Length: 4\r\n\r\nname";
        assert_eq!(request_len(with_body), Some(with_body.len()));
    }

    #[test]
    fn a_half_arrived_request_is_not_ready() {
        assert_eq!(request_len(b"GET /health HTTP/1.1\r\n"), None);
        assert_eq!(request_len(b"POST /u HTTP/1.1\r\nContent-Length: 9\r\n\r\nabcd"), None);
    }

    #[test]
    fn the_handler_answers_a_real_request_without_a_socket() {
        let router = demo_router();
        let (bytes, conn) = handle(&router, b"GET /users/7 HTTP/1.1\r\n\r\n");
        assert_eq!(conn, Connection::KeepAlive);
        assert_eq!(
            String::from_utf8(bytes).unwrap(),
            "HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: keep-alive\r\n\r\nuser 7\n"
        );
    }

    #[test]
    fn garbage_gets_a_400_and_the_connection_shuts() {
        let router = demo_router();
        let (bytes, conn) = handle(&router, b"HELLO\r\n\r\n");
        assert_eq!(conn, Connection::Close);
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.starts_with("HTTP/1.1 400 Bad Request\r\n"), "{text:?}");
        assert!(text.contains("Connection: close\r\n"), "{text:?}");
    }
}
```

```solution
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::thread;

pub const RAW: &[u8] = b"GET /users/7?tab=logs HTTP/1.1\r\nHost: localhost:8080\r\nUser-Agent: curl/8.4.0\r\nContent-Length: 11\r\n\r\nhello world";

#[derive(Debug, PartialEq)]
pub enum ParseError {
    NotUtf8,
    Malformed,
    UnsupportedVersion,
    BadContentLength,
    Smuggled,
    Chunked,
    Incomplete,
}

#[derive(Debug, PartialEq)]
pub struct RequestLine {
    pub method: String,
    pub target: String,
    pub version: String,
}

pub fn first_line(raw: &[u8]) -> &[u8] {
    let end = raw.windows(2).position(|w| w == b"\r\n").unwrap_or(raw.len());
    &raw[..end]
}

pub fn parse_request_line(line: &[u8]) -> Result<RequestLine, ParseError> {
    let text = std::str::from_utf8(line).map_err(|_| ParseError::NotUtf8)?;
    let mut parts = text.split(' ');
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let version = parts.next().unwrap_or("");

    if parts.next().is_some() || method.is_empty() || target.is_empty() {
        return Err(ParseError::Malformed);
    }
    if version != "HTTP/1.0" && version != "HTTP/1.1" {
        return Err(ParseError::UnsupportedVersion);
    }
    Ok(RequestLine {
        method: method.to_string(),
        target: target.to_string(),
        version: version.to_string(),
    })
}

#[derive(Debug, Default, PartialEq)]
pub struct Headers(Vec<(String, String)>);

impl Headers {
    pub fn parse(block: &str) -> Result<Headers, ParseError> {
        let mut fields = Vec::new();
        for line in block.split("\r\n").filter(|l| !l.is_empty()) {
            let (name, value) = line.split_once(':').ok_or(ParseError::Malformed)?;
            if name.is_empty() || name.ends_with(' ') || name.ends_with('\t') {
                return Err(ParseError::Malformed);
            }
            fields.push((name.to_string(), value.trim().to_string()));
        }
        Ok(Headers(fields))
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(field, _)| field.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[derive(Debug, PartialEq)]
pub struct Request {
    pub line: RequestLine,
    pub headers: Headers,
    pub body: Vec<u8>,
}

pub fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

pub fn body_len(headers: &Headers) -> Result<usize, ParseError> {
    match (headers.get("content-length"), headers.get("transfer-encoding")) {
        (Some(_), Some(_)) => Err(ParseError::Smuggled),
        (Some(n), None) if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) => {
            n.parse::<usize>().map_err(|_| ParseError::BadContentLength)
        }
        (Some(_), None) => Err(ParseError::BadContentLength),
        (None, Some(_)) => Err(ParseError::Chunked),
        (None, None) => Ok(0),
    }
}

pub fn parse_request(raw: &[u8]) -> Result<Request, ParseError> {
    let split = find(raw, b"\r\n\r\n").ok_or(ParseError::Incomplete)?;
    let head = std::str::from_utf8(&raw[..split]).map_err(|_| ParseError::NotUtf8)?;
    let line = parse_request_line(first_line(head.as_bytes()))?;
    let (_, fields) = head.split_once("\r\n").unwrap_or((head, ""));
    let headers = Headers::parse(fields)?;

    let len = body_len(&headers)?;
    let rest = &raw[split + 4..];
    if rest.len() < len {
        return Err(ParseError::Incomplete);
    }
    Ok(Request { line, headers, body: rest[..len].to_vec() })
}

#[derive(Debug, PartialEq)]
pub struct Response {
    pub status: u16,
    pub reason: &'static str,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Response {
    pub fn new(status: u16, reason: &'static str, body: impl Into<Vec<u8>>) -> Response {
        Response { status, reason, headers: Vec::new(), body: body.into() }
    }

    pub fn header(mut self, name: &str, value: &str) -> Response {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut head = format!("HTTP/1.1 {} {}\r\n", self.status, self.reason);
        head.push_str(&format!("Content-Length: {}\r\n", self.body.len()));
        for (name, value) in &self.headers {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        head.push_str("\r\n");

        let mut out = head.into_bytes();
        out.extend_from_slice(&self.body);
        out
    }
}

pub fn match_route<'a>(pattern: &'a str, path: &'a str) -> Option<Vec<(&'a str, &'a str)>> {
    let mut params = Vec::new();
    let mut segments = path.split('/');

    for expected in pattern.split('/') {
        let actual = segments.next()?;
        match expected.strip_prefix(':') {
            Some(name) if !actual.is_empty() => params.push((name, actual)),
            Some(_) => return None,
            None if expected == actual => {}
            None => return None,
        }
    }
    if segments.next().is_some() {
        return None;
    }
    Some(params)
}

pub type Handler = fn(&Request, &[(&str, &str)]) -> Response;

pub struct Route {
    pub method: String,
    pub pattern: String,
    pub handler: Handler,
}

#[derive(Default)]
pub struct Router {
    pub routes: Vec<Route>,
}

impl Router {
    pub fn new() -> Router {
        Router { routes: Vec::new() }
    }

    pub fn add(mut self, method: &str, pattern: &str, handler: Handler) -> Router {
        self.routes.push(Route {
            method: method.to_string(),
            pattern: pattern.to_string(),
            handler,
        });
        self
    }

    pub fn dispatch(&self, req: &Request) -> Response {
        let path = req.line.target.split('?').next().unwrap_or("");
        let mut allowed: Vec<&str> = Vec::new();

        for route in &self.routes {
            let Some(params) = match_route(&route.pattern, path) else { continue };
            if route.method == req.line.method {
                return (route.handler)(req, &params);
            }
            allowed.push(&route.method);
        }

        if allowed.is_empty() {
            Response::new(404, "Not Found", "no such path\n")
        } else {
            Response::new(405, "Method Not Allowed", "")
                .header("Allow", &allowed.join(", "))
        }
    }
}

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Connection {
    KeepAlive,
    Close,
}

pub fn connection_for(version: &str, header: Option<&str>) -> Connection {
    let says = |want: &str| {
        header
            .unwrap_or("")
            .split(',')
            .any(|token| token.trim().eq_ignore_ascii_case(want))
    };

    if says("close") {
        Connection::Close
    } else if version == "HTTP/1.1" || says("keep-alive") {
        Connection::KeepAlive
    } else {
        Connection::Close
    }
}

pub fn respond(router: &Router, req: &Request) -> (Response, Connection) {
    let conn = connection_for(&req.line.version, req.headers.get("connection"));
    let res = router.dispatch(req);
    let res = if conn == Connection::Close {
        res.header("Connection", "close")
    } else {
        res.header("Connection", "keep-alive")
    };
    (res, conn)
}

pub fn request_len(raw: &[u8]) -> Option<usize> {
    let split = find(raw, b"\r\n\r\n")?;
    let head = std::str::from_utf8(&raw[..split]).ok()?;
    let (_, fields) = head.split_once("\r\n").unwrap_or((head, ""));
    let len = Headers::parse(fields)
        .and_then(|h| body_len(&h))
        .unwrap_or(0);

    let total = split + 4 + len;
    if raw.len() >= total { Some(total) } else { None }
}

pub fn handle(router: &Router, raw: &[u8]) -> (Vec<u8>, Connection) {
    match parse_request(raw) {
        Ok(req) => {
            let (res, conn) = respond(router, &req);
            (res.to_bytes(), conn)
        }
        Err(why) => {
            let res = Response::new(400, "Bad Request", format!("{why:?}\n"))
                .header("Connection", "close");
            (res.to_bytes(), Connection::Close)
        }
    }
}

pub fn serve(addr: &str, router: Router) -> std::io::Result<()> {
    let listener = TcpListener::bind(addr)?;
    let router = Arc::new(router);

    for stream in listener.incoming() {
        let stream = stream?;
        let router = Arc::clone(&router);
        thread::spawn(move || {
            let _ = serve_one(&router, stream);
        });
    }
    Ok(())
}

pub fn serve_one(router: &Router, mut stream: TcpStream) -> std::io::Result<()> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];

    loop {
        let n = stream.read(&mut chunk)?;
        if n == 0 {
            return Ok(());
        }
        buf.extend_from_slice(&chunk[..n]);

        while let Some(used) = request_len(&buf) {
            let (bytes, conn) = handle(router, &buf[..used]);
            stream.write_all(&bytes)?;
            buf.drain(..used);
            if conn == Connection::Close {
                return Ok(());
            }
        }
    }
}

pub fn show(req: &Request, params: &[(&str, &str)]) -> Response {
    let id = params.iter().find(|(k, _)| *k == "id").map(|(_, v)| *v).unwrap_or("?");
    Response::new(200, "OK", format!("user {id}\n"))
}

pub fn health(_req: &Request, _params: &[(&str, &str)]) -> Response {
    Response::new(200, "OK", "ok\n")
}

pub fn demo_router() -> Router {
    Router::new()
        .add("GET", "/users/:id", show)
        .add("POST", "/users/:id", show)
        .add("GET", "/health", health)
}

pub const PIPELINED: &[u8] = b"GET /health HTTP/1.1\r\n\r\nPOST /users/7 HTTP/1.1\r\nContent-Length: 4\r\n\r\nnameGET /health HTTP/1.1\r\nConnection: close\r\n\r\n";

pub fn run() -> usize {
    let router = demo_router();
    let mut buf = &PIPELINED[..];
    let mut served = 0;

    while let Some(used) = request_len(buf) {
        let (bytes, conn) = handle(&router, &buf[..used]);
        println!("--- request {served}, {used} bytes in");
        println!("{}", String::from_utf8_lossy(&bytes).replace("\r\n", " | "));
        buf = &buf[used..];
        served += 1;
        if conn == Connection::Close {
            println!("client asked to close");
            break;
        }
    }
    served
}
```

@hint Read the error's second line: the value moved in the previous iteration of the loop.
@hint `move` on a closure takes ownership of everything it names. There is one `Router` and there are many connections, so ownership is the wrong relationship.
@hint Wrap it once outside the loop, `let router = Arc::new(router);`, and hand each thread its own `Arc::clone(&router)` inside the loop.

@diagnose E0382
`use of moved value: router`, with `value moved into closure here, in previous
iteration of loop`.

`move` closures take ownership of every captured variable, and `thread::spawn`
requires that, because the new thread may outlive this stack frame and cannot be
allowed to hold references into it. So the first connection moves the router into
its thread. The second iteration then names a variable that has been given away,
and rustc stops it.

`Arc<T>` is the answer: one heap allocation holding the router and an atomic
count of how many handles exist. `Arc::clone` bumps the count and hands back a
second handle to the same router, which is cheap and, unlike `Rc`, safe to send
to another thread.

@diagnose E0373
`closure may outlive the current function, but it borrows router`. This is the
same problem with the `move` keyword left off. Without `move`, the closure
captures `&router`, and rustc points out that the thread it is handed to has no
relationship with this stack frame and may still be running after `serve`
returns. The suggestion it prints is to add `move`, which then produces E0382 in
a loop. Both errors are one fact: a spawned thread has to own what it uses.

@diagnose E0277
`Rc<Router> cannot be sent between threads safely`, if you reached for `Rc`
first. `Rc`'s reference count is an ordinary integer and two threads incrementing
it can lose an update, which frees the router while a thread is still using it.
`Rc` is therefore not `Send`, and `thread::spawn` requires `Send`. `Arc` is the
same type with an atomic count, and the atomic is the entire difference in cost.

@after
Run the last stage and three pipelined requests are answered out of one buffer,
which is keep-alive doing its job: the client sent them without waiting for a
response in between, and the third one asked to close.

What a server on a real port adds, honestly.

**Timeouts.** A connection that sends four bytes and stops holds a thread here
for ever. `set_read_timeout` on the socket, plus a deadline for the whole
request, are the minimum.

**A bound on concurrency.** A thread per connection is 8 MB of virtual stack
each and a scheduler that starts to struggle in the thousands. A fixed pool with
a queue caps it. Async runtimes replace the thread with a task of a few hundred
bytes, which is why they exist.

**Limits.** Maximum header count, maximum header size, maximum body size, all
enforced while reading rather than after. Without them, `Content-Length:
99999999999` is a memory exhaustion attack that costs the attacker one line.

**TLS.** Nobody serves plaintext HTTP any more. In Rust that usually means
wrapping the `TcpStream` in `rustls`, which changes nothing above this line,
since everything you wrote takes bytes.

**Chunked bodies and HTTP/2.** Stage 3 refuses chunked. Supporting it is a small
state machine. HTTP/2 is a different protocol entirely, binary and multiplexed,
sharing only the vocabulary of methods, headers and status codes.

The parsing, the routing and the framing decisions are the same in production
code. What changes is that every one of them gets a limit attached.
