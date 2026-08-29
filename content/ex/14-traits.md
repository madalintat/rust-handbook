---
unit: 14-traits
---

## 1. Printable is a promise, not a default

@kind fix
@concept trait
@expect E0277

`{}` is not a built-in. It is a call to a trait method, and `Version` has never
said it can do that. `#[derive(Debug)]` would give you `{:?}`, but the format
string here asks for the human-facing one.

Implement the trait so `run` prints `v1.4`.

```starter
use std::fmt;

pub struct Version {
    pub major: u32,
    pub minor: u32,
}

pub fn run() -> String {
    format!("v{}", Version { major: 1, minor: 4 })
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn formats_the_version() {
        assert_eq!(run(), "v1.4");
    }

    #[test]
    fn to_string_comes_free() {
        assert_eq!(Version { major: 2, minor: 0 }.to_string(), "2.0");
    }
}
```

```solution
use std::fmt;

pub struct Version {
    pub major: u32,
    pub minor: u32,
}

impl fmt::Display for Version {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}.{}", self.major, self.minor)
    }
}

pub fn run() -> String {
    format!("v{}", Version { major: 1, minor: 4 })
}
```

@hint The trait behind `{}` is `std::fmt::Display`, and unlike `Debug` it cannot be derived.
@hint It has one required method: `fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result`.
@hint Inside `fmt`, use the `write!` macro on `f`: `write!(f, "{}.{}", self.major, self.minor)`.

@diagnose E0277
`` `Version` doesn't implement `std::fmt::Display` ``, with the note *in format
strings you may be able to use `{:?}` (or `{:#?}` for pretty-print) instead*.

That note is rustc pointing at the other trait, and the distinction is worth
keeping. `Debug` is for programmers: derivable, allowed to be ugly, prints
structure. `Display` is for users: written by hand, because only you know how
your type should read in a sentence, and there is no sensible default.

Note also *required for `Version` to implement `ToString`* if you called
`.to_string()`. You never implement `ToString`; a blanket impl in the standard
library hands it to every `Display` type.

@diagnose E0308
`expected `Result<(), std::fmt::Error>`, found `()``. Your `fmt` body used
`writeln!` or `write!` without returning its value — a stray semicolon on the
last line. `write!` returns a `Result`, and `fmt` must hand it back, so the macro
call is the tail expression with no semicolon.

@after
`Display` cannot be derived and that is deliberate. A derived `Debug` prints
`Version { major: 1, minor: 4 }`, which is correct and useless in a user-facing
message. There is no way to guess that the separator should be a dot rather than
a dash, a space or nothing.

Two things arrive with the impl at no extra cost: `.to_string()`, via a blanket
`impl<T: Display> ToString for T`, and the ability to be used anywhere a bound
says `T: Display`. One impl, several capabilities — that is the normal shape of
trait design in Rust.

## 2. Default methods and the ones you must write

@kind fix
@concept default method
@expect E0046

`Shape` has three methods and only two of them need writing: `describe` is
already defined in terms of the other two. The impl block below supplies one of
the required pair.

```starter
pub trait Shape {
    fn area(&self) -> f64;
    fn name(&self) -> &'static str;

    fn describe(&self) -> String {
        format!("{} of area {:.1}", self.name(), self.area())
    }
}

pub struct Square {
    pub side: f64,
}

impl Shape for Square {
    fn name(&self) -> &'static str {
        "square"
    }
}

pub fn run() -> String {
    Square { side: 3.0 }.describe()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn uses_the_default_method() {
        assert_eq!(run(), "square of area 9.0");
    }
}
```

```solution
pub trait Shape {
    fn area(&self) -> f64;
    fn name(&self) -> &'static str;

    fn describe(&self) -> String {
        format!("{} of area {:.1}", self.name(), self.area())
    }
}

pub struct Square {
    pub side: f64,
}

impl Shape for Square {
    fn name(&self) -> &'static str {
        "square"
    }

    fn area(&self) -> f64 {
        self.side * self.side
    }
}

pub fn run() -> String {
    Square { side: 3.0 }.describe()
}
```

@hint Count the methods in the trait, then count the ones with a body. The impl owes you the difference.
@hint `describe` has a default body, so you never have to write it. `area` does not.
@hint Add `fn area(&self) -> f64 { self.side * self.side }` to the impl block.

@diagnose E0046
`` not all trait items implemented, missing: `area` ``, with *`area` from trait*
pointing back at the declaration.

A trait method with a body is a **default**: the implementor may take it or
override it. A method without one is a requirement, and an impl block that skips
it is not an implementation of the trait. The compiler can be exact about this
because a trait declares its full surface up front — there is no partial
conformance, no abstract subclass, no "implement it later".

That completeness is what makes `describe` safe to write. It calls `self.name()`
and `self.area()` without knowing the type, because every implementor is
guaranteed to have supplied both.

@after
The economy of default methods is the point of `Iterator`. Implement `next` —
one method — and you receive `map`, `filter`, `take`, `zip`, `chain`, `fold`,
`collect` and around seventy more, every one of them a default written in terms
of `next`.

The trade to keep in mind when designing your own: each required method is work
for every implementor forever, and each default is a body you must keep correct
for types you have never seen. The usual shape is a small required core and a
generous set of defaults over it, with defaults overridable where a specific type
can do better — `Iterator::count` is a default that walks the whole iterator, and
`Vec`'s iterator overrides it to return a number it already knows.

## 3. The method is missing because the bound is

@kind fix
@concept trait bound
@expect E0599

`total` sums the price of anything priced. Both types below implement `Priced`,
both calls pass a slice of one of them, and it still does not compile — because
the function never said its elements are priced.

This is the error people find hardest to read. It says a method does not exist,
and the method plainly does.

```starter
pub trait Priced {
    fn price(&self) -> u32;
}

pub struct Book {
    pub cents: u32,
}

impl Priced for Book {
    fn price(&self) -> u32 {
        self.cents
    }
}

pub struct Coffee;

impl Priced for Coffee {
    fn price(&self) -> u32 {
        350
    }
}

pub fn total<T>(items: &[T]) -> u32 {
    items.iter().map(|i| i.price()).sum()
}

pub fn run() -> (u32, u32) {
    (
        total(&[Book { cents: 1200 }, Book { cents: 800 }]),
        total(&[Coffee, Coffee]),
    )
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn totals_both_kinds() {
        assert_eq!(run(), (2000, 700));
    }
}
```

```solution
pub trait Priced {
    fn price(&self) -> u32;
}

pub struct Book {
    pub cents: u32,
}

impl Priced for Book {
    fn price(&self) -> u32 {
        self.cents
    }
}

pub struct Coffee;

impl Priced for Coffee {
    fn price(&self) -> u32 {
        350
    }
}

pub fn total<T: Priced>(items: &[T]) -> u32 {
    items.iter().map(|i| i.price()).sum()
}

pub fn run() -> (u32, u32) {
    (
        total(&[Book { cents: 1200 }, Book { cents: 800 }]),
        total(&[Coffee, Coffee]),
    )
}
```

@hint The error is inside `total`, not at either call. Ask what `total` knows about `T`.
@hint It knows nothing. Both call sites pass a `Priced` type, but rustc checks the generic body once, on its own, before looking at any caller.
@hint `pub fn total<T: Priced>(items: &[T]) -> u32`.

@diagnose E0599
`` no method named `price` found for reference `&T` in the current scope ``, with
the note *items from traits can only be used if the type parameter is bounded by
the trait*.

Take the message literally, because it is literally true. Inside `total`, `T` is
not `Book` and not `Coffee` — it is a placeholder standing for every type at
once, and every type at once has no methods. The impls you wrote are irrelevant
here; rustc is not looking at your callers.

This is the important habit for reading `E0599`. On a **concrete** type it
usually means a typo, or a trait you forgot to bring into scope with `use`. On a
**type parameter** it almost always means a missing bound, and rustc's help line
names the exact bound to add.

@after
The contrast with C++ is the whole design. A C++ template would compile this
definition happily and only complain when someone instantiated it with a type
lacking `price` — reported inside your template, on a line the caller has never
read, with the instantiation stack attached.

Rust checks the body once, against the bounds. The consequence is a promise worth
having: **if a generic function compiles, it works for every type satisfying its
bounds.** A bad call is then reported at the call site as one line —
`the trait bound Sandwich: Priced is not satisfied` — and the person who has to
fix it is the person reading it.

## 4. You may not implement std's trait for std's type

@kind fix
@concept orphan rule
@expect E0117

The impl below is perfectly sensible, would do exactly what it says, and is
rejected outright. Nothing about the body is wrong. The problem is who owns the
two names in the first line.

Get the same output through a type you do own.

```starter
use std::fmt;

impl fmt::Display for Vec<String> {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", self.join(", "))
    }
}

pub fn run() -> String {
    let names = vec![String::from("ferris"), String::from("gorris")];
    format!("{}", names)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn joins_with_commas() {
        assert_eq!(run(), "ferris, gorris");
    }
}
```

```solution
use std::fmt;

pub struct Csv(pub Vec<String>);

impl fmt::Display for Csv {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", self.0.join(", "))
    }
}

pub fn run() -> String {
    let names = vec![String::from("ferris"), String::from("gorris")];
    format!("{}", Csv(names))
}
```

@hint You own neither `Display` nor `Vec`. An impl needs you to own at least one of the two.
@hint Make a type of your own that holds the vector: a one-field tuple struct.
@hint `pub struct Csv(pub Vec<String>);`, implement `Display` for `Csv`, and wrap the vector at the call: `format!("{}", Csv(names))`.

@diagnose E0117
`` only traits defined in the current crate can be implemented for types defined
outside of the crate ``, with `Vec<String>` underlined and labelled *`Vec` is not
defined in the current crate*.

This is **coherence**, and the rule is: you may write `impl Trait for Type` only
if you own the trait or you own the type. Both foreign is refused.

The reason is what would happen otherwise. Crate `alpha` implements
`Display for Vec<String>` joining with commas; crate `beta` implements it joining
with newlines; your program depends on both. Now `format!("{v}")` has two
candidate impls, neither author is wrong, neither can see the other, and the
linker has no principled way to choose. Adding an unrelated dependency could
silently change what your program prints.

The orphan rule buys one guarantee: for any (trait, type) pair, at most one impl
exists in any program that links.

@diagnose E0308
`expected `Vec<String>`, found `Csv`` — or the reverse. You added the newtype but
one side of the code is still passing the raw vector, or reading `self` where it
now needs `self.0`. A newtype is a distinct type, not an alias; the compiler will
not slide between them for you.

@after
The **newtype** pattern is the standard answer and it costs nothing. A
single-field tuple struct has the same size and layout as the field it wraps, so
`Csv` *is* a `Vec<String>` in memory — the wrapper exists only in the type
checker and is gone by codegen. Add `impl Deref for Csv` if you want the `Vec`
methods to show through.

It earns its place beyond the orphan rule, too. `struct UserId(u64)` and
`struct OrderId(u64)` are both a `u64` and cannot be passed to the wrong function
by accident. That is a whole category of bug deleted with two lines and no
runtime cost.

## 5. A trait that requires another trait

@kind fix
@concept supertrait
@expect E0277

`Greet` has a default method and no required ones, so `impl Greet for Bot {}`
looks like it should be enough. It is not, and the first line of the trait
declaration says why.

```starter
pub trait Named {
    fn name(&self) -> String;
}

pub trait Greet: Named {
    fn greet(&self) -> String {
        format!("hello, {}", self.name())
    }
}

pub struct Bot {
    pub id: u32,
}

impl Greet for Bot {}

pub fn run() -> String {
    Bot { id: 7 }.greet()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn greets_by_name() {
        assert_eq!(run(), "hello, bot-7");
    }
}
```

```solution
pub trait Named {
    fn name(&self) -> String;
}

pub trait Greet: Named {
    fn greet(&self) -> String {
        format!("hello, {}", self.name())
    }
}

pub struct Bot {
    pub id: u32,
}

impl Named for Bot {
    fn name(&self) -> String {
        format!("bot-{}", self.id)
    }
}

impl Greet for Bot {}

pub fn run() -> String {
    Bot { id: 7 }.greet()
}
```

@hint `trait Greet: Named` is not inheritance. Read it as a requirement on anything that implements `Greet`.
@hint `greet`'s default body calls `self.name()`. Where would that method come from?
@hint Add a second impl block: `impl Named for Bot { fn name(&self) -> String { format!("bot-{}", self.id) } }`.

@diagnose E0277
`` the trait bound `Bot: Named` is not satisfied ``, with the note *required by a
bound in `Greet`* pointing at the `: Named` in the declaration.

The colon in `trait Greet: Named` looks like inheritance and is not. It is a
bound on `Self`: *anything implementing `Greet` must also implement `Named`*. No
methods are inherited, no fields, no layout — the two traits stay entirely
separate, and `Bot` needs an impl of each.

What the supertrait buys is exactly one thing: `greet`'s default body is allowed
to call `self.name()`. Without the supertrait that call would be `E0599`, because
a bare `Self: Greet` promises nothing about naming.

@diagnose E0046
`` not all trait items implemented, missing: `name` ``. You put `fn name` in the
wrong impl block — inside `impl Greet for Bot` rather than a separate
`impl Named for Bot`. Rust has no merged namespace for a trait and its
supertrait; each trait's methods are implemented in that trait's own block.

@after
Supertraits are how the standard library layers guarantees rather than
duplicating them. `Ord: Eq + PartialOrd` says a totally ordered type is
necessarily equatable, and `Ord::cmp` may rely on it. `Copy: Clone` says every
implicitly duplicable type also has an explicit `.clone()`.

The design question when writing your own: does the default body *need* the other
trait's behaviour? If yes, a supertrait. If it merely tends to be present, leave
the traits independent and put the bound on the functions that need both. A
supertrait is a permanent obligation on every future implementor, and they are
easy to add and painful to remove.

## 6. Not every trait can be a `dyn`

@kind fix
@concept object safety
@expect E0038

A heterogeneous collection is precisely the case generics cannot express, so
`Vec<Box<dyn Renderer>>` is the right shape. The trait, as written, cannot be
made into one.

Work out which method is the problem and why a vtable could not hold it.

```starter
use std::fmt::Display;

pub trait Renderer {
    fn render(&self) -> String;
    fn render_with<T: Display>(&self, extra: T) -> String;
}

pub struct Plain;

impl Renderer for Plain {
    fn render(&self) -> String {
        String::from("plain")
    }
    fn render_with<T: Display>(&self, extra: T) -> String {
        format!("plain+{extra}")
    }
}

pub struct Bold;

impl Renderer for Bold {
    fn render(&self) -> String {
        String::from("*bold*")
    }
    fn render_with<T: Display>(&self, extra: T) -> String {
        format!("*bold*+{extra}")
    }
}

pub fn run() -> String {
    let widgets: Vec<Box<dyn Renderer>> = vec![Box::new(Plain), Box::new(Bold)];
    widgets
        .iter()
        .map(|w| w.render())
        .collect::<Vec<_>>()
        .join(" ")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn renders_a_mixed_collection() {
        assert_eq!(run(), "plain *bold*");
    }

    #[test]
    fn the_generic_method_still_works_on_a_concrete_type() {
        assert_eq!(Plain.render_with(7), "plain+7");
    }
}
```

```solution
use std::fmt::Display;

pub trait Renderer {
    fn render(&self) -> String;
    fn render_with<T: Display>(&self, extra: T) -> String
    where
        Self: Sized;
}

pub struct Plain;

impl Renderer for Plain {
    fn render(&self) -> String {
        String::from("plain")
    }
    fn render_with<T: Display>(&self, extra: T) -> String {
        format!("plain+{extra}")
    }
}

pub struct Bold;

impl Renderer for Bold {
    fn render(&self) -> String {
        String::from("*bold*")
    }
    fn render_with<T: Display>(&self, extra: T) -> String {
        format!("*bold*+{extra}")
    }
}

pub fn run() -> String {
    let widgets: Vec<Box<dyn Renderer>> = vec![Box::new(Plain), Box::new(Bold)];
    widgets
        .iter()
        .map(|w| w.render())
        .collect::<Vec<_>>()
        .join(" ")
}
```

@hint A vtable is a fixed array of function pointers, built once when the crate is compiled. Which of the two methods has no single address?
@hint `render_with<T>` is monomorphised — one machine-code function per `T` a caller picks — so there is no one pointer to store, and the set of `T`s is not even known yet.
@hint Exclude it from the vtable with `where Self: Sized` on the method. The trait becomes usable as `dyn`, and concrete types keep the method.

@diagnose E0038
`` the trait `Renderer` cannot be made into an object `` — recent compilers say
*is not dyn compatible* — with `render_with` underlined and labelled *method has
generic type parameters*.

A trait object is a fat pointer: the data, plus a pointer to a vtable that holds
one function address per method. That table is built at compile time and is a
fixed size. `render_with<T>` is monomorphised, so it is not one function; it is
one function per `T` that anybody ever passes, across the whole program including
crates not yet written. There is no address to put in the slot.

The same reasoning rules out the other cases. A method with no `self` has no
receiver to dispatch on. A method returning `Self` by value has no known size at
the call site, since the caller only has a `dyn`.

@diagnose E0277
`` the trait bound `Plain: Renderer` is not satisfied `` — or a complaint that
`Box<Plain>` cannot be coerced. You changed the trait's method signature without
changing the impls to match, or the reverse. A `where Self: Sized` clause is part
of the signature, so it must appear identically in both places or the impl does
not implement the method it claims to.

@after
`where Self: Sized` is the escape hatch and it is used heavily. It means *this
method exists only where the concrete type is known*, which removes it from the
vtable and leaves the rest of the trait dyn-compatible.

`Iterator` is the proof. It has around seventy generic methods — `map`, `filter`,
`fold`, `zip` — every one of them carrying `where Self: Sized`, and exactly one
that does not: `next`. So `Box<dyn Iterator<Item = u8>>` works, its vtable holds
a handful of slots, and you can still call `.map()` on any concrete iterator.

Design consequence: put the generic conveniences in the trait behind
`Self: Sized`, or in a separate extension trait with a blanket impl. Keep the
dyn-visible core small.

## 7. The associated type is a promise about output

@kind fix
@concept associated type
@expect E0308

Implementing `Iterator` takes one method and one associated type. The method
below is right. The associated type disagrees with it, and the compiler believes
the associated type.

```starter
pub struct Countdown {
    remaining: u32,
}

impl Countdown {
    pub fn new(from: u32) -> Self {
        Countdown { remaining: from }
    }
}

impl Iterator for Countdown {
    type Item = String;

    fn next(&mut self) -> Option<Self::Item> {
        if self.remaining == 0 {
            None
        } else {
            self.remaining -= 1;
            Some(self.remaining + 1)
        }
    }
}

pub fn run() -> Vec<u32> {
    Countdown::new(3).collect()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_down() {
        assert_eq!(run(), vec![3, 2, 1]);
    }

    #[test]
    fn adapters_come_free() {
        let doubled: Vec<u32> = Countdown::new(3).map(|n| n * 2).collect();
        assert_eq!(doubled, vec![6, 4, 2]);
    }
}
```

```solution
pub struct Countdown {
    remaining: u32,
}

impl Countdown {
    pub fn new(from: u32) -> Self {
        Countdown { remaining: from }
    }
}

impl Iterator for Countdown {
    type Item = u32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.remaining == 0 {
            None
        } else {
            self.remaining -= 1;
            Some(self.remaining + 1)
        }
    }
}

pub fn run() -> Vec<u32> {
    Countdown::new(3).collect()
}
```

@hint `Self::Item` in the return type is not a fresh type. It is whatever the `type Item = ...` line says it is.
@hint The body yields numbers. The declaration says strings. One of the two is lying, and `run` tells you which.
@hint `type Item = u32;`

@diagnose E0308
`` mismatched types: expected `String`, found `u32` ``, pointing at
`Some(self.remaining + 1)`.

`Self::Item` is not a type variable to be inferred — it is a name for whatever
the impl's `type Item = ...` line fixed it to. You declared `String`, so
`Option<Self::Item>` means `Option<String>`, and the body hands back
`Option<u32>`.

A second error follows from the same cause, at `run`: `collect` produces a
collection of `Self::Item`, so `Vec<u32>` cannot be built from an iterator of
`String`. Fix the declaration and both disappear. When one wrong line produces
several errors, work from the first.

@after
`Iterator` uses an associated type rather than a parameter, and the reason is
decisive. A `Countdown` yields `u32` and nothing else; there is exactly one right
answer, and it belongs to the implementor. Were it `Iterator<T>`, every
`for x in c` would be ambiguous — which impl? — and you would annotate constantly.

Compare `From<T>`, which *is* a parameter, because `String` genuinely converts
from `&str`, from `char`, from `Box<str>`. Several answers, and the caller picks.

The rule to carry: **one answer per implementing type, chosen by the implementor
— associated type. Several answers, chosen by the caller — type parameter.**

## 8. `?` converts the error for you, if you let it

@kind fix
@concept trait
@expect E0277

`parse_port` returns its own error type, but `parse::<u16>()` returns
`ParseIntError`. The `?` on that line is supposed to bridge the two, and it is
asking you for something first.

Implement the one trait that makes `?` work, and nothing else needs to change.

```starter
use std::num::ParseIntError;

#[derive(Debug, PartialEq)]
pub enum ConfigError {
    BadPort(String),
    Empty,
}

pub fn parse_port(s: &str) -> Result<u16, ConfigError> {
    if s.trim().is_empty() {
        return Err(ConfigError::Empty);
    }
    let port = s.trim().parse::<u16>()?;
    Ok(port)
}

pub fn run() -> (
    Result<u16, ConfigError>,
    Result<u16, ConfigError>,
    Result<u16, ConfigError>,
) {
    (parse_port("8080"), parse_port("http"), parse_port("  "))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn converts_the_parse_error() {
        let (good, bad, empty) = run();
        assert_eq!(good, Ok(8080));
        assert!(matches!(bad, Err(ConfigError::BadPort(_))));
        assert_eq!(empty, Err(ConfigError::Empty));
    }

    #[test]
    fn overflow_is_also_a_bad_port() {
        assert!(matches!(parse_port("99999"), Err(ConfigError::BadPort(_))));
    }
}
```

```solution
use std::num::ParseIntError;

#[derive(Debug, PartialEq)]
pub enum ConfigError {
    BadPort(String),
    Empty,
}

impl From<ParseIntError> for ConfigError {
    fn from(e: ParseIntError) -> Self {
        ConfigError::BadPort(e.to_string())
    }
}

pub fn parse_port(s: &str) -> Result<u16, ConfigError> {
    if s.trim().is_empty() {
        return Err(ConfigError::Empty);
    }
    let port = s.trim().parse::<u16>()?;
    Ok(port)
}

pub fn run() -> (
    Result<u16, ConfigError>,
    Result<u16, ConfigError>,
    Result<u16, ConfigError>,
) {
    (parse_port("8080"), parse_port("http"), parse_port("  "))
}
```

@hint Read the error's help line. It names a trait bound, and the bound names the impl you have to write.
@hint `?` calls `From::from` on the error before returning it. So `ConfigError` needs `From<ParseIntError>`.
@hint `impl From<ParseIntError> for ConfigError { fn from(e: ParseIntError) -> Self { ConfigError::BadPort(e.to_string()) } }`.

@diagnose E0277
`` `?` couldn't convert the error to `ConfigError` ``, with *the trait bound
`ConfigError: From<ParseIntError>` is not satisfied* and the help *consider
implementing `From<ParseIntError>` for `ConfigError`*.

That is the whole mechanism of `?`, spelled out. It is not magic: on the error
path it calls `From::from` on whatever it caught and returns the result. So `?`
works across error types exactly when a `From` impl exists, and refuses when one
does not.

Note it asks for `From`, never `Into`. A blanket
`impl<T, U: From<T>> Into<U> for T` in the standard library gives you `Into` free
in the other direction, so one impl covers both. Writing `Into` by hand gives you
only `Into`, and usually trips the orphan rule as well, since `Into` and the
foreign error type are both somebody else's.

@diagnose E0117
`` only traits defined in the current crate can be implemented for types defined
outside of the crate ``. You wrote the impl the other way round —
`impl Into<ConfigError> for ParseIntError`. `Into` is std's and `ParseIntError`
is std's, so you own neither name and coherence refuses it.

Turn it around: `impl From<ParseIntError> for ConfigError`. `ConfigError` is
yours, so the impl is legal, and the `Into` direction arrives free.

@after
This one impl is what makes error handling in Rust pleasant rather than a chain
of `match` blocks. Give your error enum a `From` impl per underlying error type
and `?` composes across all of them — `io::Error`, `ParseIntError`, your own
variants — with no conversion code at any call site.

Two habits follow. **Implement `From`, never `Into`**: you get both, and `From`
is the direction the orphan rule usually permits. And keep the conversion lossy
in one direction only — here the `ParseIntError`'s message is preserved inside
`BadPort`, so nothing a user would want to read is thrown away. An error type
that swallows its cause is worse than no error type.
