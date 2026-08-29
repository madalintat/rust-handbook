---
unit: 24-macros
---

## 1

When does a `macro_rules!` macro run?

- A. At run time, on the values passed to it
- *B. At compile time, on tokens, before names are resolved and types are checked
- C. At compile time, after type checking, so it can see the types of its arguments
- D. At link time

@why
Expansion happens between lexing and parsing. A macro sees a stream of tokens
and produces a stream of tokens; the rest of the compiler then runs on the
output.

C is the answer people want to be true, and its falsity explains most macro
frustration. A macro cannot ask whether its argument implements `Display`,
cannot look up the definition of a type you named, and cannot see any value. It
matches shapes. That is why `#[derive(Serialize)]` generates code that *calls*
trait methods rather than inspecting anything.

## 2

What does this print?

```rust
macro_rules! square { ($x:expr) => { $x * $x }; }
println!("{}", square!(3 + 1));
```

- A. 7, because the expansion is `3 + 1 * 3 + 1`
- *B. 16
- C. It does not compile, because the macro needs parentheses
- D. 10

@why
16. Once `3 + 1` has matched an `expr` fragment it is a parsed expression node,
one opaque unit, so substituting it cannot change how anything around it
groups.

A is the C answer, and it is correct *in C*: `#define SQUARE(x) x * x` really
does expand to `3 + 1 * 3 + 1`, which is 7, and every C programmer learns to
write `((x) * (x))`. Rust needs no defensive parentheses because it substitutes
syntax trees rather than text.

## 3

Which of these can a macro do that a function cannot? Choose all that apply.

- *A. Take a different number of arguments at different call sites
- *B. Take a type as an argument
- *C. Define a new `struct` or `impl`
- *D. Recover the source text of its argument
- E. Return different types at different call sites

@why
A, B, C and D are the four capabilities that justify the feature, and if your
problem is none of them you want a function or a generic.

E is the trap. A generic function already does this: `fn first<T>(v: &[T]) -> &T`
returns whatever `T` is, and `"3".parse::<u8>()` is decided by the call site.
Returning a call-site-dependent type is exactly what generics are for, and using
a macro to get it is choosing a worse tool.

## 4

Does this compile?

```rust
macro_rules! bump { () => { count += 1; }; }

let mut count = 0;
bump!();
```

- A. Yes, because `count` is in scope at the call site
- *B. No: `error[E0425]: cannot find value count in this scope`
- C. Yes, but `count` stays 0
- D. No, because a macro cannot contain an assignment

@why
This is **hygiene**. Identifiers written inside a macro body are resolved where
the macro was *defined*, not where it was called, so the macro's `count` and
yours are different identifiers that happen to be spelled the same.

C is the tempting wrong answer because it assumes the macro quietly operates on
some other `count`. It does not. There is no other `count`, and the compiler
says so rather than guessing. That refusal is the entire safety property.

## 5

Which of these does hygiene protect? Choose all that apply.

- *A. A local variable the macro declares cannot shadow one at the call site
- *B. A local at the call site cannot be captured by a name the macro wrote
- C. A type named in the macro body always means what it meant at the definition site
- D. A function called by the macro body always resolves to the definition site's crate

@why
`macro_rules!` hygiene covers local variables and lifetimes, which is A and B.

C and D are the ones people assume and they are false, which is a real hazard.
A macro body naming `Vec` gets whatever `Vec` means at the *call* site, so a
caller with `struct Vec;` in scope breaks your macro. That is why exported
macros write `::std::vec::Vec` and `$crate::helper` in full rather than bare
paths.

## 6

Which fragment specifier should `$t` be here?

```rust
macro_rules! zeroed { ($t:???) => { <$t>::default() }; }
zeroed!(Vec<u8>);
```

- A. `expr`
- *B. `ty`
- C. `ident`
- D. `tt`

@why
`<$t>::default()` uses the fragment in **type** position, so it must be matched
as a type. The rule is to choose for the role the fragment plays in the output,
not for what the caller happens to type.

C is wrong for a specific and useful reason: `Vec<u8>` is not one identifier, it
is four tokens. A is the common mistake and produces `expected type, found
expression`, pointing at a line inside the macro that the reader never wrote.
D would match, since `tt` matches nearly anything, but only the first token
tree, so it would capture `Vec` and choke on `<`.

## 7

What does `$(,)?` add to a matcher like `($($x:expr),* $(,)?)`?

- A. It makes the comma separator optional between arguments
- *B. It allows one optional trailing comma after the last argument
- C. It allows the macro to be called with no arguments
- D. Nothing; it is a formatting convention

@why
`$( ... )?` means zero or one occurrence, so `$(,)?` permits a single trailing
comma. Without it, `labels!["a", "b",]` is a syntax error while `labels!["a",
"b"]` is fine. That is an inconsistency `rustfmt` will happily create for you
when a list wraps onto several lines.

C is already handled by the `*`, which allows zero repetitions. Put `$(,)?` on
every list-shaped macro you write; `vec!` has it.

## 8

What is the difference between `$(...),*` and `$(...),+`?

- A. `*` separates with commas, `+` separates with plus signs
- *B. `*` allows zero repetitions, `+` requires at least one
- C. `+` is for the transcriber, `*` for the matcher
- D. None; they are interchangeable

@why
The separator is whatever you write before the `*` or `+`; the sigil itself only
says how many repetitions are allowed. `+` requiring at least one is genuinely
useful: an enum-generating macro should use `+` so that
`named_enum!(Empty {})` is rejected at the call site rather than producing an
enum nobody can construct.

## 9

Does this compile?

```rust
macro_rules! push_all {
    ($v:ident, $($x:expr),*) => { $v.push($x); };
}
```

- A. Yes
- *B. No, because `$x` is used outside a repetition
- C. No, because `ident` cannot be a receiver
- D. Yes, but it only pushes the first argument

@why
`error: variable 'x' is still repeating at this depth`. `$x` was bound inside a
repetition, so every use of it must also be inside one: `$( $v.push($x); )*`.

D is the plausible-sounding guess and it is worth knowing why it is wrong. The
compiler will not silently pick one match out of several; depth mismatches are
errors, not defaults. The mirror-image error, wrapping something in `$( )*` that
mentions no metavariable, is `attempted to repeat an expression containing no
syntax variables`, since the compiler would have no idea how many times to
repeat it.

## 10

A recursive macro hits `error: recursion limit reached while expanding`. What are reasonable responses? Choose all that apply.

- A. Rewrite the macro as a procedural macro
- B. Nothing; the code is wrong and cannot work
- *C. Ask whether the recursion should have been a `$(...)*` repetition or an ordinary loop
- *D. Raise it with `#![recursion_limit = "256"]` if the recursion is genuinely that deep

@why
The default limit is 128 nested expansions. D is the honest fix when you really
do need the depth, since long token-munching macros hit it legitimately.

C is the better first question. Expansion happens before everything else, so
deep recursion is compile-time cost with nothing to show for it at run time, and
most macros that recurse deeply were trying to do something a repetition or a
plain function loop does better and faster.

## 11

Where does `#[macro_export]` put a macro?

- *A. At the crate root, regardless of which module defines it
- B. In the module that defines it, made public
- C. In every module of the crate
- D. In the prelude of any crate that depends on yours

@why
It lifts the macro to the crate root, so a macro defined in `mod internal` is
imported as `use my_crate::retry;`, because the module it lives in is not part
of its path. That surprises everybody exactly once.

B is the reasonable expectation from how `pub` works everywhere else, and it is
wrong because macros are resolved during expansion, before the module tree
matters. The related tool is `$crate`, a metavariable expanding to the defining
crate's root: without it, a macro that calls a helper works in its own crate and
breaks in every other one.

## 12

Which is the better tool for "the same logic over `i32`, `i64` and `u8`"?

- A. A `macro_rules!` macro taking `$t:ty`
- *B. A generic function with a trait bound
- C. A procedural macro
- D. Three copies of the function

@why
A generic. It is a real function with a real signature, so rust-analyzer can
complete it, the debugger can step into it, errors point at your source, and
`monomorphisation` makes it exactly as fast.

A works and is the most common unnecessary macro in the wild. The test to apply:
**if a function or a generic can do it, the macro is a worse function or a worse
generic.** Macros earn their place when they generate items, take a variable
number of arguments, or need the *name* of something as well as the thing.

## 13

What does a procedural macro receive and return?

- A. A syntax tree, and a syntax tree
- *B. A `TokenStream`, and a `TokenStream`
- C. The values of its arguments, evaluated at compile time
- D. A string of source text

@why
Tokens in, tokens out, and no type information whatsoever. A derive macro cannot
look up the definition of a type you named in a field.

A is close enough to be misleading. Nobody manipulates a raw `TokenStream` by
hand: `syn` parses one into a syntax tree and `quote!` builds a new one from a
template. But that tree is `syn`'s, built from tokens, and not the compiler's.
The compiler's does not exist yet.

## 14

Which of these are true of procedural macros? Choose all that apply.

- *A. They must live in their own crate with `proc-macro = true`
- *B. They cannot be used in the crate that defines them
- *C. They can run arbitrary code at compile time, including reading files
- D. They can inspect the types of the code they are attached to

@why
A and B follow from the same fact: a proc-macro crate is compiled for the host
and linked into the compiler, not into your program, so it has to be built
first and separately.

C is why `sqlx::query!` can check your SQL against a live database at compile
time, and why a proc macro is code you are choosing to trust.

D is the recurring wish and it is false. `#[derive(Serialize)]` on a struct
sees the tokens of that struct and nothing else; it cannot find out what any
field's type actually is, which is why the generated code calls trait methods
and lets normal resolution sort it out later.

## 15

A `#[derive]` produces a confusing error. What is the fastest way to see what it generated?

- A. Read the macro's source in the dependency
- *B. `cargo expand`
- C. `cargo build --verbose`
- D. Add `println!` calls to the macro

@why
`cargo expand` prints your crate with every macro expanded, `#[derive]` output
included, as ordinary readable Rust.

A is the instinct and it is the slow path: reading a macro means simulating
expansion in your head, and `syn`-based derives are thousands of lines. D cannot
work at all: a proc macro runs in the compiler, so its output goes to the
compiler's stdout rather than your program's.

The habit: when a macro misbehaves, do not read the macro. Read what it
produced, fix the ordinary bug you find there, then work backwards to the line
of the transcriber that emitted it.
