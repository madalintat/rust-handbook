---
unit: 19-modules
---

## 1

What is a crate?

- A. A directory containing a `Cargo.toml`
- *B. One unit of compilation: what `rustc` is invoked on, once
- C. Any `.rs` file
- D. A published package on crates.io

@why
A crate is one compilation. `rustc` is run once per crate, and that is why the
crate is the unit of so much else: `use` paths, `pub(crate)`, trait coherence,
semver, and incremental rebuilds.

A is a **package**: one `Cargo.toml`, which may contain one library crate and
any number of binary crates. C is tempting because in Python a file is a module,
but a `.rs` file that no `mod` declaration names is not compiled at all.

## 2

`src/lib.rs` contains `mod parse;`. Where may the body of `parse` live? Choose all that apply.

- *A. `src/parse.rs`
- *B. `src/parse/mod.rs`
- C. `src/modules/parse.rs`
- D. Anywhere: Cargo searches the whole `src` tree

@why
Exactly two locations, and having both is an error. `src/parse.rs` is the modern
style; `src/parse/mod.rs` is the older one and still supported.

The modern style pairs `src/parse.rs` with a `src/parse/` directory for its
children, so the module's own code and its submodules sort next to each other,
instead of a project accumulating nine files all called `mod.rs`.

D is the Python intuition and it is wrong in a way that bites: a file nobody
declares is silently ignored, with no error, no warning and no module.

## 3

Does this compile?

```rust
mod store {
    fn secret() -> u32 { 7 }
    pub mod index {
        pub fn get() -> u32 { super::secret() }
    }
}
```

- *A. Yes, a child module can see its parent's private items
- B. No, `secret` is private
- C. No, `super` is only valid at the crate root
- D. Yes, but only because `index` is `pub`

@why
Private means *visible in this module and in every module below it*. `index` is
below `store`, so `store`'s private `secret` is in scope there.

B is the near-universal first guess, and it has the direction backwards.
Privacy points downwards: a child can reach up into its parent's internals,
which is exactly what makes a private helper shared between submodules possible.
A parent cannot reach down into a child.

## 4

What is the difference between E0433 and E0603?

- A. Nothing, they are two names for an unresolved path
- *B. E0433 means the name does not exist; E0603 means it exists and you may not use it
- C. E0433 is for functions, E0603 is for modules
- D. E0603 is a warning, E0433 is an error

@why
Resolution happens first, permission second. E0433 (`failed to resolve: use of
undeclared crate or module`) means rustc looked in the current module and found
nothing of that name. E0603 (`... is private`) means it found the item and
refused.

Knowing which you have tells you which fix to reach for. E0433 wants a corrected
path or a `use`; E0603 wants a `pub`, often on a module partway along the path
rather than on the item the call names.

## 5

Does this compile?

```rust
pub mod store {
    mod index {
        pub fn lookup() -> u32 { 7 }
    }
}

fn main() { store::index::lookup(); }
```

- A. Yes, `lookup` is `pub`
- *B. No, the module `index` is private
- C. No, `lookup` needs to be `pub(crate)`
- D. Yes, because `store` is `pub`

@why
Reachability is a chain, and every segment of the path has to be visible from
where you stand. `store` is `pub`, `index` is not, and the chain breaks at the
second segment. Marking `lookup` as `pub` opened the last door in a corridor
whose second door is locked.

This is what makes a private module a real implementation detail: mark
everything inside it `pub` for its siblings' convenience and none of it leaks a
millimetre further. The way out without publishing `index` is
`pub use index::lookup;` inside `store`.

## 6

`pub(super)` on an item in `crate::app::engine::raw` makes it visible where?

- A. In `crate::app` and everything below it
- *B. In `crate::app::engine` and everything below it
- C. In `crate::app::engine::raw` only
- D. Anywhere in the crate

@why
`super` is relative to where the item is *written*, not to where you want it
read. The item lives in `raw`, so `super` is `engine`, and the grant covers
`engine` and its descendants.

A is the trap, and it is what people usually mean when they type `pub(super)` in
a deep tree. If you want the whole of `app`, the form is
`pub(in crate::app)`, since the path must name an ancestor module of the item.

## 7

Which of these are breaking changes to a published library? Choose all that apply.

- *A. Adding a field to a `pub struct` whose fields are all `pub`
- *B. Adding a variant to a `pub enum`
- C. Adding a new `pub fn`
- *D. Adding a required method to a `pub trait`
- E. Renaming a private module

@why
A breaks every downstream struct literal, which must name every field. B breaks
every downstream `match` that was exhaustive and now is not. D breaks every
downstream `impl`, which no longer implements the whole trait.

C is safe unless it collides with a name in a trait the caller has in scope. E
is safe because a private module is not part of your API at all, which is the
argument for keeping modules private and re-exporting with `pub use`.

A and B are the ones `#[non_exhaustive]` exists to prevent, and it has to be
applied before the fact.

## 8

What does `#[non_exhaustive]` on a `pub struct` do?

- A. Prevents the struct from being constructed at all
- *B. Stops downstream crates using a struct literal or an exhaustive pattern, so fields may be added later
- C. Makes every field private
- D. Adds a hidden field

@why
It restricts *other* crates only. Inside the defining crate the struct behaves
normally, and you can still write a literal, so the type is not made awkward for
its own author.

C is close but wrong in a way that matters: the fields keep their own
visibility, so downstream code can still read `config.retries` if that field is
`pub`. What it cannot do is construct the value with a literal or destructure it
without a `..`, which is exactly the pair of things that would break when you
add a field.

## 9

What does a `use` statement do?

- *A. Creates a local alias for a path in the current module
- B. Compiles the named module into the binary
- C. Loads a file from disk
- D. Marks a dependency as required

@why
`use` is a naming convenience and nothing else. The whole crate is compiled
whether you write it or not, and an external dependency is pulled in by
`Cargo.toml`, not by `use`.

That it is purely a name is why `use` is an *item* with visibility of its own:
plain `use` keeps the alias to yourself, and `pub use` re-exports the name so
anyone who can see your module can reach the item through it.

## 10

Does this compile?

```rust
mod json { pub struct Value; }
mod toml { pub struct Value; }

use json::Value;
use toml::Value;
```

- A. Yes, the two types are distinct
- *B. No, the name `Value` is defined twice in this module
- C. No, you cannot `use` from a private module
- D. Yes, and the second `use` shadows the first

@why
`error[E0252]: the name Value is defined multiple times`. The two *types* are
genuinely distinct; the two *aliases* are not, and a module cannot hold two
items of the same name in the same namespace.

D is the tempting one, because shadowing works for `let` bindings. It does not
work for items: items in a module are unordered, so there is no "second" one to
win. The fix is `as`, spelled `use toml::Value as TomlValue;`, or importing the
modules and writing `json::Value` in full.

## 11

Why does `Option` need no `use` but `HashMap` does?

- *A. `Option` is in the standard prelude, which the compiler injects into every module
- B. `Option` is a keyword
- C. `Option` is built into the language, `HashMap` is a library type
- D. `HashMap` is in a different crate

@why
The prelude is a small list of names re-exported into every module
automatically: `Option`, `Result`, `String`, `Vec`, `Box`, `Clone`, `Iterator`,
`Drop` and a few dozen more.

C is wrong and worth correcting: `Option` is an ordinary `enum` defined in the
standard library, with no compiler magic beyond the prelude entry. The prelude
is kept deliberately small because every name in it is a name you can no longer
use for your own type without shadowing it.

## 12

A workspace shares which of these across its members? Choose all that apply.

- *A. One `Cargo.lock`
- *B. One `target/` directory
- C. One crate root
- *D. A single `cargo test` at the root that runs everything

@why
The shared lockfile is the real prize: every member resolves to the same version
of every dependency, so a workspace cannot end up with two incompatible `serde`
versions linked into one binary. The shared `target/` means a dependency built
for one member is not rebuilt for the next.

C is not a thing. Each member is its own package with its own crates. And
because crates form a DAG, two members cannot depend on each other cyclically,
so a workspace split has to follow a real layering.

## 13

Why put the logic of a command-line tool in `src/lib.rs` rather than `src/main.rs`?

- *A. A binary crate cannot be `use`d, so nothing in `main.rs` can be reached by an integration test
- B. Binaries compile more slowly than libraries
- C. `main.rs` cannot contain modules
- D. Cargo will not run tests in a binary crate

@why
A binary crate has no importable name. `tests/cli.rs` is compiled as its own
crate and can `use my_tool::...`, the library, but there is no path by which
it could reach anything defined in `main.rs`.

D is nearly true and worth being precise about: `#[cfg(test)]` unit tests inside
`main.rs` do run. What you lose is the integration test, which is the one that
exercises your code through the same public API a user has. So `main.rs` gets
argument parsing and exit codes, and everything else lives in the library.

## 14

`src/util.rs` exists in your package. `src/lib.rs` does not mention it. What happens?

- A. A compile error: an undeclared file
- B. A warning about an unused file
- *C. Nothing at all; the file is not compiled
- D. It is compiled and available as `crate::util`

@why
`mod` declares; the filesystem does not. A `.rs` file that no `mod` names is
inert text as far as `rustc` is concerned, with no error, no warning and no
module.

This is the most disorienting difference from Python and JavaScript, where the
filesystem *is* the module graph. The symptom is usually "my new function does
not exist", and the fix is one line in the parent: `mod util;`.

## 15

You want a type defined in `crate::internal::v2` to be reachable by users as `my_crate::Client`, without exposing `internal`. What do you write?

- A. `pub mod internal;` at the root
- *B. `pub use internal::v2::Client;` at the root
- C. Move the file to `src/client.rs`
- D. `#[macro_export]` on the type

@why
`pub use` publishes an item at a new path without moving it and without opening
the modules above it. `internal` stays private, so it can be renamed, split, or
rewritten, and no user is affected, because nobody ever wrote that path.

A does the opposite of what you want: it makes every module name in your
internal tree part of your semver commitment. This is why a well-designed
`lib.rs` is mostly private `mod` lines and a short list of `pub use` lines, and
that short list is the API design.
