---
unit: 19-modules
---

## 1. Private by default

@kind fix
@concept visibility

@expect E0603

`hello` is written, correct, and unreachable. Nothing about it says `private`,
because nothing has to: every item in Rust starts private to the module that
defines it, and the module boundary is a real wall rather than a naming
convention.

Make `run` able to call it.

```starter
pub mod greeting {
    fn hello() -> String {
        String::from("hello")
    }
}

pub fn run() -> String {
    greeting::hello()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn greets() {
        assert_eq!(run(), "hello");
    }
}
```

```solution
pub mod greeting {
    pub fn hello() -> String {
        String::from("hello")
    }
}

pub fn run() -> String {
    greeting::hello()
}
```

@hint The module is `pub`. The function inside it is not.
@hint Visibility is per item, not inherited from the module. `pub mod` makes the module reachable; it says nothing about what is inside.
@hint `pub fn hello() -> String`.

@diagnose E0603
`function hello is private`, with a second underline pointing at the definition
so you can see exactly which item it means.

This is the whole default: an item is visible in the module that defines it and
in every module *below* it, and nowhere else. `run` sits at the crate root,
which is `greeting`'s parent, so it is on the wrong side of the wall. A parent
cannot see into a child; a child can see up into its parent.

Note what rustc does *not* complain about: the path `greeting::hello` is fine,
and the module `greeting` is fine. Resolution succeeded and then permission was
refused. That distinction matters: E0603 means "found it, not allowed", while
E0433 means "no such thing".

@after
The rule is one line: **private items are visible downwards, never upwards.**

Which makes `pub` a decision rather than a formality. Every `pub` you write is a
name someone else may depend on, and inside a library that is published, a name
you cannot remove without a major version. Adding it later costs nothing; taking
it away costs a release. Start private and promote when something actually needs
it.

## 2. The path is not the name

@kind fix
@concept path

@expect E0433

`shout` exists and is public all the way down. The call still does not resolve,
because a path is read from *where you are standing*, and `run` is standing at
the crate root, where there is no module called `ascii`.

Write the path that actually reaches it.

```starter
pub mod text {
    pub mod ascii {
        pub fn shout(s: &str) -> String {
            s.to_uppercase()
        }
    }
}

pub fn run() -> String {
    ascii::shout("ready")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shouts() {
        assert_eq!(run(), "READY");
    }
}
```

```solution
pub mod text {
    pub mod ascii {
        pub fn shout(s: &str) -> String {
            s.to_uppercase()
        }
    }
}

pub fn run() -> String {
    text::ascii::shout("ready")
}
```

@hint `ascii` is not a top-level module. It is nested inside another one.
@hint A path with no `crate::`, `self::` or `super::` prefix starts at the current module. From the crate root, that means starting with `text`.
@hint `text::ascii::shout("ready")`, or add `use text::ascii;` at the top and keep the call as it is.

@diagnose E0433
`failed to resolve: use of undeclared crate or module ascii`.

Read the wording literally. rustc looked *in the current module*, which is the
crate root, for a `mod ascii` or an external crate named `ascii`, and found
neither. It is not a permission problem. Nothing named `ascii` exists at
that level at all.

Paths in Rust are not searched up the tree the way an unqualified name is in
Python. A leading segment must be an item in the current module, or one of the
three keywords: `crate` (the root of this crate), `self` (this module), `super`
(the parent).

@after
Two fixes, and the difference is worth knowing.

`text::ascii::shout(...)` is a relative path: it works from the crate root and
breaks the moment this code moves into a module. `crate::text::ascii::shout(...)`
is absolute and survives the move.

`use text::ascii;` does something else again. It creates the name `ascii` in this
module, so the original call site compiles unchanged. That is all `use`
ever does: it makes a local alias. It imports no code, changes no compilation,
and costs nothing.

## 3. Public inside private is still private

@kind fix
@concept visibility

@expect E0603

`lookup` is `pub`. It is still unreachable, and the error names something other
than `lookup`. Read it carefully, because this is the single most common module
mistake.

Get `run` to a working call. There is more than one answer; one of them is what
a library would actually ship.

```starter
pub mod store {
    mod index {
        pub fn lookup(key: &str) -> u32 {
            key.len() as u32
        }
    }
}

pub fn run() -> u32 {
    store::index::lookup("ferris")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn looks_up() {
        assert_eq!(run(), 6);
    }
}
```

```solution
pub mod store {
    mod index {
        pub fn lookup(key: &str) -> u32 {
            key.len() as u32
        }
    }

    pub use index::lookup;
}

pub fn run() -> u32 {
    store::lookup("ferris")
}
```

@hint The error does not mention `lookup`. What does it mention?
@hint Reachability needs every module on the path to be visible, not just the item at the end. `index` is private to `store`.
@hint Either make `index` public, or leave it private and add `pub use index::lookup;` inside `store`, then call `store::lookup(...)`.

@diagnose E0603
`module index is private`. Note the noun: the *module*, not the function.

Reachability is a chain. To use `store::index::lookup` from the root, every
segment must be visible from the root: `store` is `pub`, `index` is not, and the
chain breaks there. Marking `lookup` as `pub` only opened the last door in a
corridor whose second door is locked.

This is deliberate, and it is what makes a private module a genuine
implementation detail. You can mark everything inside it `pub` for the
convenience of its siblings and none of it leaks a millimetre further.

@after
The `pub use` answer is the one a real library uses, and it is the whole reason
modules are worth the trouble.

`index` stays private, so you can rename it, split it, or delete it. `lookup`
becomes `store::lookup`, a name that has nothing to do with where the code
lives. Your internal tree and your public API are now two separate designs, free
to change independently.

This is exactly what the standard library does. `Vec` is defined in `alloc`, not
`std`; you reach it as `std::vec::Vec` and usually just as `Vec`, because of two
re-exports and a prelude.

## 4. The import points at nothing

@kind fix
@concept re-export

@expect E0432

The `use` line names a path that does not exist. The function it is looking for
is real, and one level further down.

Fix the import. Then consider whether the import should have been right in the
first place.

```starter
mod util {
    pub mod math {
        pub fn round_to(n: f64, places: u32) -> f64 {
            let f = 10f64.powi(places as i32);
            (n * f).round() / f
        }
    }
}

use crate::util::round_to;

pub fn run() -> f64 {
    round_to(3.14159, 2)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rounds() {
        assert_eq!(run(), 3.14);
    }
}
```

```solution
mod util {
    pub mod math {
        pub fn round_to(n: f64, places: u32) -> f64 {
            let f = 10f64.powi(places as i32);
            (n * f).round() / f
        }
    }
}

use crate::util::math::round_to;

pub fn run() -> f64 {
    round_to(3.14159, 2)
}
```

@hint `round_to` is not an item of `util`. Which module actually defines it?
@hint The path in a `use` is an ordinary path and must name every module on the way down.
@hint `use crate::util::math::round_to;`, or add `pub use math::round_to;` inside `util` and leave the original import alone.

@diagnose E0432
`unresolved import crate::util::round_to`, with a note saying there is no
`round_to` in `util`.

E0432 is E0433's cousin: it is what you get when the thing that fails to resolve
is a `use` rather than an expression. In both cases the message is about
existence, not permission. rustc walked `crate` → `util`, looked for an item
called `round_to`, and there was none.

Worth noticing that `use` itself is never the problem. Deleting the `use` line
and writing the full path in `run` produces the same complaint one line lower.
The import is only a name.

@after
The other fix is the more interesting one. Adding `pub use math::round_to;`
inside `util` makes `crate::util::round_to` a real path, so the original import
becomes correct without being edited.

That is what a re-export is *for*. `util::math` is where the code is organised;
`util::round_to` is where a caller expects to find it. When those two want to
differ, `pub use` is the seam, and it costs nothing at runtime, because the
compiler resolves it to the same item.

## 5. One private field, one constructor

@kind fix
@concept visibility

@expect E0451

`Port` is public. Its field is not, and that single decision changes how the
type may be built.

The type refuses port zero. Work out why the struct literal is rejected, and
build a `Port` the way the module intends.

```starter
pub mod net {
    pub struct Port {
        n: u16,
    }

    impl Port {
        pub fn new(n: u16) -> Option<Port> {
            if n == 0 { None } else { Some(Port { n }) }
        }

        pub fn get(&self) -> u16 {
            self.n
        }
    }
}

pub fn run() -> (u16, bool) {
    let p = net::Port { n: 8080 };
    (p.get(), net::Port::new(0).is_none())
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn builds_through_the_constructor() {
        assert_eq!(run(), (8080, true));
    }
}
```

```solution
pub mod net {
    pub struct Port {
        n: u16,
    }

    impl Port {
        pub fn new(n: u16) -> Option<Port> {
            if n == 0 { None } else { Some(Port { n }) }
        }

        pub fn get(&self) -> u16 {
            self.n
        }
    }
}

pub fn run() -> (u16, bool) {
    let p = net::Port::new(8080).unwrap();
    (p.get(), net::Port::new(0).is_none())
}
```

@hint You do not need to change anything inside `net`. The module already offers a way to build a `Port`.
@hint A struct literal writes every field by name, so it needs every field to be visible. `new` does not, because it sits inside the module, where the field is visible.
@hint `net::Port::new(8080).unwrap()`.

@diagnose E0451
`field n of struct Port is private`.

The struct is `pub`, so you may name the type, hold one, and call its methods.
Constructing one with a literal is a different permission, because a struct
literal has to mention every field, so it requires every field to be visible to
you. One private field is enough to close the door.

That is not an inconvenience, it is the point. `Port::new` rejects zero. If
outside code could write `Port { n: 0 }`, the check would be advisory. Making
the field private makes `new` the only way in, and the invariant becomes a fact
about the type rather than a habit of its users.

@after
This is the standard shape for a type with an invariant: private fields, public
constructor that validates, public accessors. `String` is exactly this. Its
field is a private `Vec<u8>`, because a `String` promises to hold valid UTF-8
and a public field would let you break that promise with an assignment.

There is a second, quieter benefit. All-public fields freeze the field list
forever: adding one is a breaking change for every downstream struct literal.
Private fields plus a constructor means you can add a field in a patch release
and nobody notices.

## 6. Two crates, one name

@kind fix
@concept path

@expect E0252

Two format modules, each with its own `Value`. Both imports are correct; they
simply cannot both own the name.

Make the two types usable side by side.

```starter
pub mod json {
    pub struct Value(pub i64);
    pub fn parse(s: &str) -> Value {
        Value(s.len() as i64)
    }
}

pub mod toml {
    pub struct Value(pub bool);
    pub fn parse(s: &str) -> Value {
        Value(!s.is_empty())
    }
}

use json::Value;
use toml::Value;

pub fn run() -> (i64, bool) {
    let a: Value = json::parse("abc");
    let b: Value = toml::parse("x");
    (a.0, b.0)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn both_values() {
        assert_eq!(run(), (3, true));
    }
}
```

```solution
pub mod json {
    pub struct Value(pub i64);
    pub fn parse(s: &str) -> Value {
        Value(s.len() as i64)
    }
}

pub mod toml {
    pub struct Value(pub bool);
    pub fn parse(s: &str) -> Value {
        Value(!s.is_empty())
    }
}

use json::Value as JsonValue;
use toml::Value as TomlValue;

pub fn run() -> (i64, bool) {
    let a: JsonValue = json::parse("abc");
    let b: TomlValue = toml::parse("x");
    (a.0, b.0)
}
```

@hint A `use` creates a name in this module. Two of them cannot create the same name.
@hint `use` has a keyword for exactly this, and the type annotations below will need to follow.
@hint `use json::Value as JsonValue;` and `use toml::Value as TomlValue;`, then annotate `a` and `b` with the new names.

@diagnose E0252
`the name Value is defined multiple times`, with `first import` and
`re-imported here` underlines.

`use` is an item, like `fn` or `struct`, and a module cannot contain two items
with the same name in the same namespace. The two `Value` types are perfectly
distinct, since `json::Value` and `toml::Value` are different types with
different fields, but the *aliases* collide and rustc will not guess which one
you meant.

@diagnose E0308
Your annotations and your values disagree. If you renamed the imports but left
`let a: Value = ...`, the name `Value` no longer exists, and if you renamed only
one, one of the two bindings is now claiming the wrong type. Each `let` must be
annotated with the alias matching the function that produced it, or you can drop
the annotations entirely and let inference do the work.

@after
`as` is the general answer, and there is a second one worth knowing: import the
*modules* instead of the types and write `json::Value` and `toml::Value` in
full. That is what most real code does when the names are short, and it reads
better than a pair of invented aliases, since the module name is already the
disambiguator.

The convention when you must rename is to keep the original as a suffix or
prefix rather than inventing a new word. `io::Result as IoResult`,
`fmt::Result as FmtResult`. The standard library itself has this exact collision
and solves it exactly this way.

## 7. The public surface is a decision

@kind fix
@concept re-export

@expect E0433

`Client` works. `run` reaches it through a four-segment path into a private
module, and the hidden tests, which stand in for an outside user, expect to find
it at the crate root as `Client`.

Give the crate the public API it is supposed to have, without moving any code.

```starter
mod internal {
    pub mod v2 {
        pub struct Client {
            retries: u32,
        }

        impl Client {
            pub fn new() -> Client {
                Client { retries: 3 }
            }

            pub fn retries(&self) -> u32 {
                self.retries
            }
        }
    }
}

pub fn run() -> u32 {
    internal::v2::Client::new().retries()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn client_is_public() {
        let c = Client::new();
        assert_eq!(c.retries(), 3);
        assert_eq!(run(), 3);
    }
}
```

```solution
mod internal {
    pub mod v2 {
        pub struct Client {
            retries: u32,
        }

        impl Client {
            pub fn new() -> Client {
                Client { retries: 3 }
            }

            pub fn retries(&self) -> u32 {
                self.retries
            }
        }
    }
}

pub use internal::v2::Client;

pub fn run() -> u32 {
    internal::v2::Client::new().retries()
}
```

@hint The tests write `Client::new()`. Nothing at the crate root is called `Client` yet.
@hint You do not need to make `internal` public, and you should not want to. One line at the root is enough.
@hint `pub use internal::v2::Client;`. A re-export publishes the item at a new path without moving it or exposing the modules above it.

@diagnose E0433
`failed to resolve: use of undeclared type Client`.

The tests are compiled as part of your crate, and their `use super::*;` pulls in
whatever the crate root defines. The root defines `run` and `internal`, and
nothing called `Client`. Where the type actually lives is irrelevant, because
resolution only ever looks at names that are in scope.

Note that making `internal` `pub` would *not* fix this. It would make
`internal::v2::Client` reachable, but the tests are asking for `Client`, at the
root, with no path at all. That name has to be created deliberately.

@diagnose E0603
You made a module public somewhere along the way, but not all of them. E0603
means the item was found and permission was refused, so the chain from the root
to the item has a private link in it. Worth stopping here rather than adding `pub`
until it compiles: the intended answer creates a *new* name at the root and
leaves `internal` private, which is a much smaller promise.

@after
This is the design idea the unit is really about. The module tree you write for
yourself and the API you publish are two different things, and `pub use` is the
only connection between them.

Here `internal::v2` can become `internal::v3`, or split into three modules, or
be rewritten entirely, and as long as the one `pub use` line still resolves,
no user is affected, because no user ever wrote that path. Had you made
`internal` public instead, every module name in your crate would be part of your
semver commitment.

The rule of thumb: a library's `lib.rs` should be mostly `mod` lines that are
private and `pub use` lines that are not. That short list *is* the API design.

## 8. Exactly as public as it needs to be

@kind fix
@concept visibility

@expect E0603

`normalise` is shared plumbing. It should be visible to everything in `app` and
to nothing outside it: not to another crate, and not even to the crate root.

The visibility it currently has is too narrow. Widen it by exactly the right
amount, and no further; `pub` and `pub(crate)` both compile here and both give
away more than the design intends.

```starter
pub mod app {
    mod engine {
        pub mod raw {
            pub(super) fn normalise(s: &str) -> String {
                s.trim().to_lowercase()
            }
        }
    }

    pub mod api {
        pub fn handle(s: &str) -> String {
            super::engine::raw::normalise(s)
        }
    }
}

pub fn run() -> String {
    app::api::handle("  Ferris  ")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalises() {
        assert_eq!(run(), "ferris");
    }
}
```

```solution
pub mod app {
    mod engine {
        pub mod raw {
            pub(in crate::app) fn normalise(s: &str) -> String {
                s.trim().to_lowercase()
            }
        }
    }

    pub mod api {
        pub fn handle(s: &str) -> String {
            super::engine::raw::normalise(s)
        }
    }
}

pub fn run() -> String {
    app::api::handle("  Ferris  ")
}
```

@hint Work out which modules `pub(super)` actually reaches from where `normalise` is written, then work out where `api` sits relative to that set.
@hint `pub(super)` on an item in `app::engine::raw` means "visible in `app::engine` and everything below it". `api` is not below `engine`.
@hint There is a form that names the module exactly: `pub(in crate::app) fn normalise`. The path must be an ancestor module of the item.

@diagnose E0603
`function normalise is private`, with the definition underlined so you can see
the `pub(super)` you need to change.

`pub(super)` is relative to where the item is written, not to where you wish it
were visible. `normalise` lives in `crate::app::engine::raw`, so `super` is
`crate::app::engine`, and the item is visible in that module and its
descendants, meaning `raw` and anything else under `engine`. `api` is a sibling
of `engine`, one level up and back down, so it is outside that set.

`engine` being private is fine, incidentally: private means visible in `app` and
below, and `api` is below `app`.

@diagnose E0742
The path in `pub(in path)` has to name an **ancestor** of the item, a module the
item is actually inside. `pub(in crate::app::api)` is rejected because `raw` is
not inside `api`. Visibility can only ever be widened to a module that already
contains you; you cannot grant a specific sibling access and nobody else.

@after
Five visibilities, from narrowest to widest:

| form | visible in |
|---|---|
| *(nothing)* | this module and its descendants |
| `pub(super)` | the parent module and its descendants |
| `pub(in crate::a)` | that named ancestor and its descendants |
| `pub(crate)` | the whole crate, and nothing outside |
| `pub` | everywhere, including other crates |

In practice `pub(crate)` does ninety per cent of the work and is the one habit
worth forming. It says *shared plumbing, not a promise*, and it keeps the item
out of your published API. `pub(in path)` is rare and precise, and it is the
right tool when a subsystem has real internals it wants to share among its own
modules only.

The reason to care is semver. Only `pub` items reachable from the root are part
of what you have promised to support. Everything else can change on a Tuesday.
