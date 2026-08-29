---
unit: 12-errors
---

## 1

A JSON parser in a web server receives malformed input from a client. What
should it do?

- A. `panic!`, since the input is invalid and the program cannot continue
- *B. Return an `Err`, because bad input is normal operation for a parser
- C. `unwrap` the parse and let the caller catch it
- D. Log a warning and return a default value

@why
Bad input is the job, not a bug. The caller can reject the request with a 400
and keep serving everyone else, which is exactly the "could a caller do
something sensible about this?" test.

A is the mistake that turns a parser into a denial-of-service hole: one crafted
request kills the thread, or the process. C is A with extra steps: there is no
catch, and `unwrap` panics.

D is quietly the worst of the four. Substituting a default hides the failure
from every layer above and produces wrong answers instead of no answer.

## 2

What does `?` do that a plain early return does not?

- A. It logs the error before returning
- *B. It converts the error with `From` into the function's error type
- C. It unwinds the stack
- D. Nothing, it is pure syntax sugar for `match`

@why
The desugaring is `Err(e) => return Err(From::from(e))`, and that `From::from` is
the whole reason `?` composes. A function calling five libraries with five error
types can return one type, because each `?` converts on the way out.

D is the answer most people give and it is almost right, which is what makes it
worth naming. It *is* sugar for a `match`, but the `match` it expands to
contains a conversion, and missing that is why `error[E0277]: ? couldn't convert
the error` reads as mysterious rather than obvious.

## 3

Does this compile?

```rust
fn line_count(path: &str) -> usize {
    let text = std::fs::read_to_string(path)?;
    text.lines().count()
}
```

- A. Yes
- *B. No, `?` needs the function to return `Result` or `Option`
- C. No, `read_to_string` does not return a `Result`
- D. Yes, but it panics if the file is missing

@why
`error[E0277]: the ? operator can only be used in a function that returns
Result or Option`. `?` expands to a `return Err(...)`, and a function declared
`-> usize` has no way to express that.

D is the tempting one because it describes what `unwrap` would do. `?` is not an
unwrap and never panics; it propagates. The two are opposites: `?` hands the
decision to the caller, `unwrap` refuses to have one.

## 4

`ConfigError` is your own enum. Which of these make `let n = s.parse::<u32>()?;`
work inside `fn f() -> Result<u32, ConfigError>`? Choose all that apply.

- *A. `impl From<ParseIntError> for ConfigError`
- *B. Changing the return type to `Result<u32, Box<dyn Error>>`
- C. Adding `#[derive(From)]` to `ConfigError`
- *D. Marking a `ConfigError` field `#[from]` under `thiserror`
- E. Adding `#[derive(Debug)]` to `ConfigError`

@why
A is the manual version, D generates exactly that impl, and B sidesteps it:
`Box<dyn Error>` has a blanket `From` impl for every `E: Error`, so every `?`
already works.

C is invented: there is no `derive(From)` in the standard library. E is the
distractor that looks related because error types always derive `Debug`; `Debug`
is required by the `Error` trait but has nothing to do with `?`.

## 5

When is `unwrap` defensible in code that has to stay up?

- A. Never, under any circumstances
- *B. When the value is provably present and a failure would mean the code is wrong
- C. When you are in a hurry and will fix it later
- D. Whenever the error type does not implement `Display`

@why
`unwrap` is a claim that this cannot fail. Sometimes the claim is true, as with a
regex literal compiled at startup or an index you just bounds-checked. A panic
is then the correct response, because the alternative is continuing with a
broken invariant.

Where B is honest, `expect` is strictly better than `unwrap`: same behaviour,
plus the sentence explaining why you believed it could not fail. That sentence
ends up in the crash log, which is where you will want it.

A is a rule people state and nobody follows; tests and `main` are full of
justified unwraps.

## 6

What is the difference between `unwrap` and `expect`?

- A. `expect` returns a `Result`, `unwrap` panics
- *B. Only the panic message
- C. `expect` is checked at compile time
- D. `unwrap` works on `Option`, `expect` only on `Result`

@why
Both panic on the failure case and both return the value otherwise. The only
difference is what gets printed, and it is a bigger difference than it sounds:
`called Result::unwrap() on an Err value: ParseIntError { .. }` tells you what
broke, while `PORT must be a number: ParseIntError { .. }` tells you what the
code was trying to do.

Write the `expect` message as the assumption, meaning *why* you believed it
could not fail, rather than as a description of the failure. It is a comment that the
compiler puts in the crash log.

## 7

What does the `Error` trait require you to implement?

- A. `fn description(&self) -> &str`
- B. Nothing at all, it is a marker trait
- *C. Nothing directly, but it requires `Debug` and `Display` as supertraits
- D. `fn source(&self) -> Option<&dyn Error>`

@why
`pub trait Error: Debug + Display`, and every method has a default, so `impl
Error for MyType {}` is a legal body. What is not optional is the two supertraits, and
that is where `error[E0277]: the trait bound MyType: Display is not satisfied`
comes from.

B is nearly right and misses the supertraits, which is exactly the mistake that
produces that error. `source` is overridable and worth writing when your error
wraps another, since it builds the `Caused by:` chain, but it defaults to `None`.
`description` is long deprecated.

## 8

`Display` for an error should print…

- A. `Error: could not open the configuration file!`
- *B. `could not open app.toml`
- C. The full chain including the underlying cause
- D. A `Debug` dump of the struct

@why
Lowercase, no trailing punctuation, no `Error:` prefix, because whoever prints
it adds the framing. Say what failed and name the thing that failed, so the
message is useful without a stack trace.

C is the interesting wrong answer. The chain is built by `source()` and printed
by the consumer under `Caused by:`. If every `Display` also printed its cause,
the chain would appear duplicated at every level.

D is what `Debug` is for, and error types derive it for exactly that reason.

## 9

Which crate belongs where?

- *A. `thiserror` in a library, `anyhow` in a binary
- B. `anyhow` in a library, `thiserror` in a binary
- C. Both in both, since they do the same thing
- D. Neither; the standard library is enough

@why
The split follows from who reads the error. A library's caller is *code*, and
code needs a concrete enum it can `match` on to decide whether to retry, fall
back, or give up. `thiserror` generates the `Display`, `Error` and `From` impls
and then gets out of the way; the type you ship does not mention the crate.

A binary's caller is a *human reading a terminal*, who wants one clear line.
`anyhow` erases the type and carries a context chain instead.

D is defensible and is what the standard library alone gives you: a lot of
hand-written `Display` impls. The crates remove typing, not capability.

## 10

What does `.context("reading app.toml")` add?

- A. It converts the error into a `String`
- *B. A layer of explanation, preserved above the original error
- C. A stack trace
- D. Nothing at runtime, it is a compile-time annotation

@why
The original error is kept as the source; the context becomes the new `Display`.
Printing with `{:?}` gives:

```
reading app.toml

Caused by:
    No such file or directory (os error 2)
```

A is wrong in a way worth naming: if context replaced the error, you would lose
the only part that says what actually went wrong. It wraps rather than replaces.

C is a separate feature: `anyhow` can capture a backtrace, but that is
`RUST_BACKTRACE`, not `context`.

## 11

`fn main() -> Result<(), Box<dyn Error>>` returns an `Err`. What happens?

- A. Nothing is printed; the process exits 0
- *B. The error is printed with `Debug` and the process exits non-zero
- C. The error is printed with `Display` and the process exits 0
- D. It panics

@why
The runtime prints it using `Debug` and exits with a failure status.

`Debug`, not `Display`, is the detail people get wrong, and it explains something
otherwise strange: `anyhow` writes a *custom* `Debug` impl that prints the
message and the whole `Caused by:` chain nicely. It is written for this one
moment.

It also means a hand-rolled error type that only derives `Debug` will print as
`RetryLimit { attempts: 5 }` from `main`, which is technically fine and not the
message you wrote.

## 12

What does a panic do by default?

- *A. Unwinds the stack, running every destructor on the way out
- B. Aborts the process immediately
- C. Longjmps to the nearest `catch_unwind`
- D. Returns an `Err` from the enclosing function

@why
Unwinding walks back through every frame and runs the `Drop` impl of every live
value: locks released, files closed, buffers flushed. That is why Rust has no
`finally`: RAII holds under panic too.

B is the *other* mode, selected with `panic = "abort"` in a release profile. It
skips all cleanup, lets the compiler delete the landing-pad code, and produces a
smaller, slightly faster binary. Standard on embedded targets and anywhere a
panic means the process is finished regardless.

## 13

What is `std::panic::catch_unwind` for?

- A. Implementing try/catch in Rust
- *B. Stopping a panic at a thread or FFI boundary
- C. Recovering from a failed allocation
- D. Turning panics into `Result` in ordinary code

@why
A panic crossing into C is undefined behaviour, so a Rust callback catches it at
the edge; likewise a thread pool catches a panic rather than losing a worker.
That is the job.

A and D are the same misunderstanding and it fails three ways: it does nothing
under `panic = "abort"`, it cannot catch an abort at all, and what it hands you
is a `Box<dyn Any>` you must downcast to learn anything. If you are reaching for
it in ordinary code, the failure was recoverable and should have been a
`Result`.

## 14

What happens if a `Drop` impl panics while the stack is already unwinding from
another panic?

- A. The second panic is ignored
- B. Both panics are reported and unwinding continues
- *C. The process aborts
- D. It is caught by the nearest `catch_unwind`

@why
There is no second stack to unwind onto, so the runtime gives up and aborts.
Practically that means a destructor must not panic: no `unwrap` in `Drop`, no
assertions, no `expect` on a lock.

It is a rule that only bites during an incident: the first panic is the one you
were debugging, and the abort is why you have no useful output about it.

## 15

Which of these should be a `panic!` rather than a `Result`? Choose all that
apply.

- A. The config file does not exist
- *B. An internal index is out of bounds after your own bookkeeping
- C. The user typed letters into a number field
- *D. A `Mutex` is poisoned and continuing would use half-updated state
- E. A network request timed out

@why
B and D are bugs or broken invariants: no caller can do anything sensible, and
continuing means operating on state you know is wrong.

A, C and E are all things that happen to correct programs every day. Each has an
obvious caller response (fall back to defaults, re-prompt, retry with backoff),
which is precisely the test for `Result`.

The asymmetry is the thing to remember: a `Result` you should have panicked on
is annoying; a panic you should have returned is an outage.
