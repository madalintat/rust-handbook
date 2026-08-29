---
unit: 24-macros
---

## 1. A macro that writes functions

@kind fix
@concept macro

@expect E0308

`constant!` generates a whole function from a name and a value. No function can
do that, because a function cannot introduce an item. Two calls, two
functions, one definition.

The generated functions do not type check. The macro body is where the fix goes,
so that both invocations are fixed at once.

```starter
macro_rules! constant {
    ($name:ident, $value:expr) => {
        pub fn $name() -> String {
            $value
        }
    };
}

constant!(app_name, "handbook");
constant!(version, "0.3.1");

pub fn run() -> String {
    format!("{} {}", app_name(), version())
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn generates_both_functions() {
        assert_eq!(run(), "handbook 0.3.1");
    }
    #[test]
    fn they_are_separate_items() {
        assert_eq!(app_name(), "handbook");
        assert_eq!(version(), "0.3.1");
    }
}
```

```solution
macro_rules! constant {
    ($name:ident, $value:expr) => {
        pub fn $name() -> String {
            String::from($value)
        }
    };
}

constant!(app_name, "handbook");
constant!(version, "0.3.1");

pub fn run() -> String {
    format!("{} {}", app_name(), version())
}
```

@hint The error points inside the macro, but it is an ordinary type error: what type is `"handbook"`, and what does the generated function promise to return?
@hint A string literal is `&'static str`. The signature says `String`.
@hint `String::from($value)` in the transcriber: one edit, both functions fixed.

@diagnose E0308
`mismatched types: expected String, found &str`, with the underline inside the
`macro_rules!` body and a note saying `in this macro invocation` pointing at
`constant!(app_name, "handbook")`.

That two-part diagnostic is the standard shape of a macro error and worth
learning to read. The *type error* is in generated code, so rustc shows you the
transcriber line that produced it; the *context* is the call, so it shows you
that too. Neither location on its own would tell you enough.

Nothing subtle is happening here. Expansion produced
`pub fn app_name() -> String { "handbook" }`, which is a mistake you would spot
instantly if you had written it out by hand, which is exactly what
`cargo expand` shows you.

@after
Generating items is the first of the three things a macro can do that a function
cannot. A function can return a value; it cannot bring a new `fn`, `struct` or
`impl` into existence. That is why `#[derive(Debug)]` is a macro and could not
be anything else.

`$name:ident` is doing the load-bearing work. An identifier fragment can be used
wherever a name goes: a function name, a type name, a field. That is how one
line of macro becomes two named functions the rest of the crate can call
normally.

## 2. Hygiene: the macro cannot see your variable

@kind fix
@concept hygiene

@expect E0425

`bump!` looks like it should increment the local called `count`. It does not,
and the error is the single most important property of Rust macros, the one C
macros lack.

Fix it so that `run` returns 3. The `count` inside the macro is not the `count`
in the function, and no amount of renaming will make it so.

```starter
macro_rules! bump {
    () => {
        count += 1;
    };
}

pub fn run() -> i32 {
    let mut count = 0;
    bump!();
    bump!();
    bump!();
    count
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_three() {
        assert_eq!(run(), 3);
    }
}
```

```solution
macro_rules! bump {
    ($c:ident) => {
        $c += 1;
    };
}

pub fn run() -> i32 {
    let mut count = 0;
    bump!(count);
    bump!(count);
    bump!(count);
    count
}
```

@hint The macro body was written somewhere else, and that is where its `count` is looked up.
@hint The caller has to hand the macro the name it is allowed to touch.
@hint Take an `ident` fragment: `($c:ident) => { $c += 1; };`, called as `bump!(count)`.

@diagnose E0425
`cannot find value count in this scope`, pointing at the macro body.

This is **hygiene**. Identifiers written inside a macro body are resolved where
the macro was *defined*, not where it was *called*. The macro's `count` and the
function's `count` are spelled the same and are genuinely different identifiers,
so the macro's one refers to nothing.

The C preprocessor has no such rule, and the consequence is a famous class of
bug: `#define SWAP(a,b) { int tmp = a; a = b; b = tmp; }` silently corrupts a
call site that already has a variable called `tmp`. In Rust that cannot happen.
The macro cannot capture your name, and your name cannot capture the macro's.

@after
The seam is the interesting part. Hygiene applies to identifiers the macro
*wrote*; an identifier **passed in** as a fragment keeps its call-site context
and refers to the caller's variable. So `bump!(count)` works, and the caller has
explicitly named the one variable the macro may touch. Nothing leaks by
accident, and nothing is captured by accident.

One limit worth knowing: `macro_rules!` hygiene covers local variables and
lifetimes, not types, functions or modules. A macro body naming `Vec` gets
whatever `Vec` means at the call site, which is why generated code writes
`::std::vec::Vec` and `$crate::helper` rather than bare paths.

## 3. Repetition, and where the conversion goes

@kind fix
@concept repetition

@expect E0308

`labels!` takes any number of arguments of any types and turns them into a
`Vec<String>`. A function cannot have that signature; this is the second thing
macros are for.

The repetition machinery is correct. Something else is not, and the fix belongs
inside the macro so that every argument is handled the same way.

```starter
macro_rules! labels {
    ($($x:expr),* $(,)?) => {{
        let mut v: Vec<String> = Vec::new();
        $( v.push($x); )*
        v
    }};
}

pub fn run() -> Vec<String> {
    labels!["retries", 3, "timeout", 30]
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mixes_types() {
        assert_eq!(run(), vec!["retries", "3", "timeout", "30"]);
    }
    #[test]
    fn accepts_none_and_a_trailing_comma() {
        let empty: Vec<String> = labels![];
        assert!(empty.is_empty());
        assert_eq!(labels!["a", 1,], vec!["a", "1"]);
    }
}
```

```solution
macro_rules! labels {
    ($($x:expr),* $(,)?) => {{
        let mut v: Vec<String> = Vec::new();
        $( v.push($x.to_string()); )*
        v
    }};
}

pub fn run() -> Vec<String> {
    labels!["retries", 3, "timeout", 30]
}
```

@hint Two of the four arguments are `&str` and two are `i32`. The vector holds neither.
@hint You cannot fix this at the call site without giving up the point of the macro. Convert inside the repetition.
@hint `v.push($x.to_string())`, because `ToString` is implemented for both `&str` and `i32`.

@diagnose E0308
`mismatched types: expected String, found &str`, and separately
`expected String, found integer`: one error per argument, because the repetition
emitted one `push` per argument and each was type checked on its own.

That is the useful observation. `$( ... )*` is not a loop over a collection; it
is textual duplication that happens before type checking, so `labels!["a", 3]`
becomes two independent statements pushing two unrelated types. Nothing forces
the arguments to agree, which is precisely why a macro can accept a mixture and
a function cannot.

@diagnose E0277
`the trait bound X: ToString is not satisfied`. You have added `.to_string()`
but passed something with no `Display` implementation. Everything in the tests
has one; a custom struct would need `impl Display` first.

@after
The pieces of the matcher, spelled out: `$( ... ),*` means the group repeats
zero or more times separated by commas, and `$(,)?` allows one optional trailing
comma. Add that second part to every list-shaped macro you write. `vec!` has it,
and without it `labels!["a", 1,]` is a syntax error.

The double braces are not a typo either. The outer pair delimits the
transcriber; the inner pair is a real block, which is what lets an expansion
containing statements still be used as a single expression.

## 4. The identifier you were handed

@kind fix
@concept hygiene

@expect E0384

The other side of exercise 2. Here the macro *does* introduce a binding, using a
name the caller supplied, and because the name came from the call site, the
caller can see it afterwards.

That much works. What the macro declares about the binding does not.

```starter
macro_rules! counter {
    ($name:ident) => {
        let $name = 0;
    };
}

pub fn run() -> i32 {
    counter!(hits);
    hits += 1;
    hits += 1;
    hits
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_caller_can_use_the_binding() {
        assert_eq!(run(), 2);
    }
}
```

```solution
macro_rules! counter {
    ($name:ident) => {
        let mut $name = 0;
    };
}

pub fn run() -> i32 {
    counter!(hits);
    hits += 1;
    hits += 1;
    hits
}
```

@hint The binding exists and is visible, so that part is working. Read what the error says about it.
@hint Mutability is a property of the binding, and the binding is written in the macro.
@hint `let mut $name = 0;`

@diagnose E0384
`cannot assign twice to immutable variable hits`, with `first assignment to
hits` underlining the `let $name = 0;` **inside the macro** and the failing
`hits += 1` at the call site.

Read that diagnostic carefully, because it proves the hygiene rule from the
other direction. The compiler is linking a binding created in the macro body to
a use in the function, which it can only do because `$name` was passed in and
carries the call site's context. Had the macro written `let hits = 0;`
literally, the two would be different identifiers and the error would be E0425
instead.

So the caller decides which names the macro may introduce, by naming them. The
fix is `mut`, and it goes where the `let` is: in the transcriber.

@after
This is the whole design in two exercises. A name the macro writes is invisible
to you; a name you hand the macro is yours, and the macro may bind it, read it
or mutate it. Nothing crosses the boundary unless someone wrote it down.

A practical consequence: a macro that needs a temporary should just declare one,
because its temporary cannot collide with anything you have. `let tmp = ...;`
inside a macro body is safe in a way that the same line in a C macro is not, and
that single property is most of why `macro_rules!` is usable at all.

## 5. One impl, written twice

@kind fix
@concept macro

@expect E0277

This is the case where a macro is genuinely the right answer: the same `impl`
block, needed for several types, with nothing generic to hang it on because the
body reaches into a tuple field.

One of the two types has been left out.

```starter
macro_rules! display_newtype {
    ($t:ident) => {
        impl std::fmt::Display for $t {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "{}", self.0)
            }
        }
    };
}

pub struct Metres(pub f64);
pub struct Seconds(pub u32);

display_newtype!(Metres);

pub fn run() -> String {
    format!("{} in {}", Metres(3.5), Seconds(2))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn both_display() {
        assert_eq!(run(), "3.5 in 2");
    }
    #[test]
    fn each_type_prints_its_own_field() {
        assert_eq!(Metres(0.5).to_string(), "0.5");
        assert_eq!(Seconds(90).to_string(), "90");
    }
}
```

```solution
macro_rules! display_newtype {
    ($t:ident) => {
        impl std::fmt::Display for $t {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "{}", self.0)
            }
        }
    };
}

pub struct Metres(pub f64);
pub struct Seconds(pub u32);

display_newtype!(Metres);
display_newtype!(Seconds);

pub fn run() -> String {
    format!("{} in {}", Metres(3.5), Seconds(2))
}
```

@hint The macro is correct. Count how many types need the impl and how many invocations there are.
@hint `display_newtype!(Seconds);`

@diagnose E0277
`Seconds doesn't implement std::fmt::Display`, with the note
`in format strings you may be able to use {:?} instead`.

`Metres` implements it because `display_newtype!(Metres)` expanded into an
`impl` block; `Seconds` has no such block, so the bound `{}` requires is
unsatisfied. Adding the missing invocation is the fix, and it is the whole
selling point of the macro: one line per type instead of six.

Resist the `{:?}` the compiler suggests. It would need `#[derive(Debug)]` and
would print `Seconds(2)` rather than `2`, and the tests want the field.

@after
Why this cannot be a generic. A generic `impl<T> Display for T` is forbidden by
coherence, and even if it were not, `self.0` means nothing for an arbitrary `T`,
because the compiler cannot know the type has a field `0`. Macros work on syntax, so
`self.0` is just three tokens copied into each expansion, and it type checks
separately in each one.

That is the honest test for reaching for a macro: could a generic or a trait
with a default method do this? Here the answer is no, so the macro earns its
place. When the answer is yes, the macro is only a worse generic: opaque to the
reader, awkward in a debugger, and reporting its errors in code nobody wrote.

## 6. A type as an argument

@kind fix
@concept fragment specifier

@expect E0308

`parse_or!` takes a string, a **type**, and a fallback. A function cannot take a
type as an argument, which is exactly why this is a macro. `$t:ty` is
substituted straight into a turbofish.

The fragment specifiers are right. The transcriber is not finished.

```starter
macro_rules! parse_or {
    ($s:expr, $t:ty, $default:expr) => {
        $s.parse::<$t>()
    };
}

pub fn run() -> (i32, f64) {
    (parse_or!("41", i32, 0), parse_or!("banana", f64, 1.5))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_or_falls_back() {
        assert_eq!(run(), (41, 1.5));
    }
    #[test]
    fn the_type_argument_decides_the_result_type() {
        let n: u8 = parse_or!("7", u8, 0);
        assert_eq!(n, 7);
        assert_eq!(parse_or!("-2", i64, 99), -2);
    }
}
```

```solution
macro_rules! parse_or {
    ($s:expr, $t:ty, $default:expr) => {
        $s.parse::<$t>().unwrap_or($default)
    };
}

pub fn run() -> (i32, f64) {
    (parse_or!("41", i32, 0), parse_or!("banana", f64, 1.5))
}
```

@hint Read the type in the error message. What does `parse` actually return?
@hint The third argument is bound as `$default` and never used. That is the missing half.
@hint `$s.parse::<$t>().unwrap_or($default)`

@diagnose E0308
`mismatched types: expected i32, found Result<i32, ParseIntError>`. `parse`
returns a `Result` because parsing can fail, and `"banana"` is exactly the case
it exists for.

Notice that `$default` was matched and bound and then never appeared in the
transcriber. That is legal and silent, because an unused metavariable is not a
warning. It is a small hazard of macro writing: the compiler will not tell you
that you forgot half of your own design.

@diagnose E0277
`the trait bound X: FromStr is not satisfied`, or a complaint about
`unwrap_or`'s argument. The type you passed as `$t` must implement `FromStr`,
and the fallback must be that same type. `parse_or!("7", u8, 0)` works because
`0` infers as `u8`.

@after
`$t:ty` is the second capability on the list: a macro can take a type as an
argument. A generic function would also work here,
`fn parse_or<T: FromStr>(s: &str, d: T) -> T`, and would be better, because it
is a real function with a real signature that rust-analyzer understands.

That is the point worth taking away. Most macros that take a `ty` should have
been generics. The ones that genuinely cannot are the ones that also generate an
item, or take a variable number of arguments, or need the *name* of the type as
well as the type, via `stringify!($t)`. A generic reaches none of that.

## 7. A macro that calls itself

@kind fix
@concept recursion

@expect E0317

`max_of!` handles a list by peeling off the first element and re-invoking itself
with the rest, bottoming out on the single-element rule. It expands to one fully
unrolled expression with no loop and no allocation.

The recursion is correct. The expression it builds is not quite an expression.

```starter
macro_rules! max_of {
    ($a:expr) => { $a };
    ($a:expr, $($rest:expr),+) => {{
        let r = max_of!($($rest),+);
        if $a > r { $a }
    }};
}

pub fn run() -> i32 {
    max_of!(3, 17, 8, 2)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finds_the_largest() {
        assert_eq!(run(), 17);
    }
    #[test]
    fn works_at_every_length() {
        assert_eq!(max_of!(5), 5);
        assert_eq!(max_of!(5, 9), 9);
        assert_eq!(max_of!(9, 5), 9);
        assert_eq!(max_of!(1, 2, 3, 4, 5, 6, 7, 8), 8);
    }
}
```

```solution
macro_rules! max_of {
    ($a:expr) => { $a };
    ($a:expr, $($rest:expr),+) => {{
        let r = max_of!($($rest),+);
        if $a > r { $a } else { r }
    }};
}

pub fn run() -> i32 {
    max_of!(3, 17, 8, 2)
}
```

@hint The last line of the block is the block's value. What is that value when the condition is false?
@hint An `if` with no `else` has type `()`, and this one has to have the type of the elements.
@hint `if $a > r { $a } else { r }`

@diagnose E0317
`if may be missing an else clause: expected integer, found ()`, with the
underline on the `if` inside the transcriber and `in this macro invocation`
pointing at `max_of!(3, 17, 8, 2)`.

An `if` without `else` is a statement-shaped expression of type `()`, so the
block evaluates to `()` on the false branch and to an integer on the true one,
and a block has one type. The recursive rule already computed the answer for the
tail into `r`; the `else` just has to hand it back.

Worth noticing that the error is reported once, not four times, even though the
macro expanded four levels deep. The innermost expansion failed to type check
and the outer ones were never reached.

@after
The two rules are tried top to bottom and the first that matches wins. `($a:expr)`
cannot match `3, 17, 8, 2`, since the matcher would have leftover tokens, so
control falls to the second rule, which peels `3` and re-invokes with `17, 8, 2`.
Four levels later the single-element rule matches and the recursion bottoms out.

Recursion in a macro is not free. Expansion happens before anything else, so a
deeply recursive macro is compile-time cost with nothing to show for it at run
time, and the default limit is 128 nested expansions, after which you get
`error: recursion limit reached while expanding`. You can raise it with
`#![recursion_limit = "256"]`, but hitting it usually means the job wanted a
`$( ... )*` repetition, or an ordinary loop in an ordinary function.

## 8. Generating an enum and everything around it

@kind fix
@concept macro

@expect E0004

The real shape of a useful `macro_rules!`: a matcher with a nested structure, two
repetitions over the same fragment, and `stringify!` to turn an identifier into
the string that names it. One invocation produces the enum, a `name`, a
`from_name` and an `all`.

One of the four generated items does not compile. The macro cannot know
something the compiler insists on.

```starter
macro_rules! named_enum {
    ($name:ident { $($variant:ident),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum $name {
            $($variant),+
        }

        impl $name {
            pub fn name(&self) -> &'static str {
                match self {
                    $( $name::$variant => stringify!($variant), )+
                }
            }

            pub fn from_name(s: &str) -> Option<$name> {
                match s {
                    $( stringify!($variant) => Some($name::$variant), )+
                }
            }

            pub fn all() -> Vec<$name> {
                vec![$( $name::$variant ),+]
            }
        }
    };
}

named_enum!(Level { Trace, Info, Warn, Error });

pub fn run() -> (Vec<&'static str>, Option<Level>, Option<Level>) {
    (
        Level::all().iter().map(|l| l.name()).collect(),
        Level::from_name("Warn"),
        Level::from_name("Verbose"),
    )
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn round_trips_every_variant() {
        let (names, warn, unknown) = run();
        assert_eq!(names, vec!["Trace", "Info", "Warn", "Error"]);
        assert_eq!(warn, Some(Level::Warn));
        assert_eq!(unknown, None);
    }
    #[test]
    fn works_for_a_second_enum() {
        named_enum!(Colour { Red, Green });
        assert_eq!(Colour::all().len(), 2);
        assert_eq!(Colour::Green.name(), "Green");
        assert_eq!(Colour::from_name("Red"), Some(Colour::Red));
        assert_eq!(Colour::from_name("Blue"), None);
    }
}
```

```solution
macro_rules! named_enum {
    ($name:ident { $($variant:ident),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum $name {
            $($variant),+
        }

        impl $name {
            pub fn name(&self) -> &'static str {
                match self {
                    $( $name::$variant => stringify!($variant), )+
                }
            }

            pub fn from_name(s: &str) -> Option<$name> {
                match s {
                    $( stringify!($variant) => Some($name::$variant), )+
                    _ => None,
                }
            }

            pub fn all() -> Vec<$name> {
                vec![$( $name::$variant ),+]
            }
        }
    };
}

named_enum!(Level { Trace, Info, Warn, Error });

pub fn run() -> (Vec<&'static str>, Option<Level>, Option<Level>) {
    (
        Level::all().iter().map(|l| l.name()).collect(),
        Level::from_name("Warn"),
        Level::from_name("Verbose"),
    )
}
```

@hint Three of the four generated items are exhaustive by construction. One matches on something that is not an enum.
@hint `name` matches on `Self`, and the repetition covers every variant, so it is complete. `from_name` matches on a `&str`.
@hint Add `_ => None,` after the repetition in `from_name`.

@diagnose E0004
`non-exhaustive patterns: &_ not covered`, with the note `&str cannot be matched
exhaustively, so a wildcard _ is necessary`.

The two matches in this macro are not symmetrical, and that asymmetry is the
lesson. `name` matches on `Self`: the repetition generates one arm per variant
and the enum has no other variants, so the compiler can see it is complete.
`from_name` matches on a `&str`, which has infinitely many values, so no
repetition over variants can ever cover it.

A macro cannot reason about this. It emitted tokens and stopped. Exhaustiveness
is checked long afterwards, on the expanded tree, which is why the error names a
`match` that appears nowhere in your source.

@diagnose E0308
`expected Option<Level>, found ...`. Every arm of `from_name` must produce the
same type, so the wildcard arm has to be `_ => None,` rather than a bare `None`
in the wrong position or a variant on its own.

@after
Three details in that matcher are worth stealing.

`$name:ident { $($variant:ident),+ $(,)? }` puts literal braces in the matcher,
so the macro is *called* with braces and reads like a type declaration. Any
delimiter you write in the matcher must appear in the call.

`+` rather than `*` means at least one variant, so `named_enum!(Empty {})` is a
compile error at the call site rather than an enum nobody can construct.

`stringify!($variant)` recovers the source text of a token, one of the four
things only a macro can do, since a function receives values and has no access
to how they were spelled. It works in pattern position too, which is what makes
`from_name` possible at all.

When this goes wrong, run `cargo expand`. Reading the generated `enum` and its
`impl` as ordinary Rust is faster than reading any macro, and it is what the
compiler was looking at when it complained.
