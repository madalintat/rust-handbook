---
num: 19
slug: 19-modules
title: Modules and crates
accent: slate
concepts: package, crate, module, module tree, path, visibility, re-export, prelude, workspace, semver
needs: 08-structs, 14-traits
blurb: A package holds crates, a crate is one compilation, and a module tree decides who is allowed to see what. The layer where a program stops being a file and becomes a library.
---

%% Most languages make a file a module and stop there. Rust does not: your directory layout is a *suggestion* that `mod` has to confirm, visibility is private by default and graded in five steps, and the public path of a type has nothing to do with where you defined it. That last one is not an accident. It is the only reason a library can have a clean API and a messy inside.

Three nouns get used interchangeably in conversation and mean three different things. Start there.

## Package, crate, module

### The three nouns

| | what it is | how many | where it is written |
|---|---|---|---|
| **package** | a thing with a `Cargo.toml` that Cargo can build, test and publish | one per `Cargo.toml` | `Cargo.toml` |
| **crate** | one unit of compilation, meaning what `rustc` is invoked on, once | at most one library, any number of binaries | `src/lib.rs`, `src/main.rs`, `src/bin/*.rs` |
| **module** | a namespace and a visibility boundary inside a crate | as many as you like | `mod` |

A crate is the interesting one. Its **module tree** is rooted at `src/main.rs`
or `src/lib.rs`, and the crate is the unit of almost everything: compilation,
`use` paths, coherence for trait impls, `pub(crate)`, semver, publication to
crates.io. When you read "in this crate", read "in this one `rustc`
invocation".

```
my-tool/                    the package
├── Cargo.toml
├── src/
│   ├── main.rs             crate #1: a binary, named my-tool
│   ├── lib.rs              crate #2: a library, named my_tool
│   └── parse/
│       └── mod.rs          a module inside the library crate
└── tests/
    └── cli.rs              crate #3: an integration test
```

Note the hyphen becoming an underscore. Package names may contain hyphens;
crate names are identifiers and may not, so Cargo converts.

### The binary-plus-library shape

A package with both `src/main.rs` and `src/lib.rs` is the standard layout for a
command-line tool, and it is worth doing from the first commit.

```rust
// src/main.rs: argument parsing, exit codes, and nothing else
fn main() {
    let path = std::env::args().nth(1).expect("usage: my-tool FILE");
    match my_tool::count_lines(&path) {
        Ok(n) => println!("{n}"),
        Err(e) => { eprintln!("{e}"); std::process::exit(1); }
    }
}
```

`main.rs` depends on the library exactly like any external user does, by name and
through its public API. Everything real lives in `lib.rs`, which means it can be
unit-tested, integration-tested, documented and depended on. A binary crate
cannot be `use`d by anything, so logic buried in `main.rs` can only be tested by
running the program.

## mod: declaring versus defining

### mod is a declaration, not an include

`mod parse;` does not mean "read the file". It means **there is a module named
`parse`, and it is part of this crate; go and find its body**. A `.rs` file that
no `mod` names is not compiled at all. It is dead text, and Cargo ignores it
without a word.

```rust
// src/lib.rs
mod parse;          // body lives in src/parse.rs
pub mod format;     // body lives in src/format.rs, and it is public
mod util {          // body right here
    pub fn clamp(n: i32) -> i32 { n.max(0) }
}
```

:::compare
**Python / JavaScript**: the filesystem *is* the module graph. Anything
importable is importable. In Rust the graph is written out in code, and a file
you forgot to declare produces no error, no warning, and no module.

**C**: `#include` is textual paste. `mod` is not: each module is compiled once
and has its own namespace.
:::

### Where the body may live

For `mod parse;` inside `src/lib.rs`, `rustc` looks for exactly two places:

| layout | status |
|---|---|
| `src/parse.rs` | modern style |
| `src/parse/mod.rs` | older style, still supported |

Both work; having both is an error. The modern style is `src/parse.rs` **plus** a
`src/parse/` directory for its children. The file and the folder sit side by
side, so a file explorer sorts them together and a module's own code does not end
up buried in a `mod.rs` among nine other `mod.rs` files.

```
src/parse.rs        mod lexer;  mod token;
src/parse/lexer.rs
src/parse/token.rs
```

## Paths

A path names an item. Three prefixes make it unambiguous.

| prefix | means | survives |
|---|---|---|
| `crate::` | from the root of *this* crate | moving the file |
| `self::` | this module | moving the file |
| `super::` | the parent module | being renamed |
| none | relative to this module | nothing much |

```rust
mod config {
    pub const RETRIES: u32 = 3;

    pub mod defaults {
        pub fn retries() -> u32 {
            super::RETRIES              // up one, to config
        }
        pub fn absolute() -> u32 {
            crate::config::RETRIES      // the same item, named from the root
        }
    }
}
```

`super` is the right choice inside a tightly-related group, because renaming the
group does not break it. `crate::` is the right choice for a reference across
the tree, because moving *this* file does not break it.

## Visibility

### Private by default, and which way privacy points

:::note
Every item is private to the module that defines it. A private item is visible
in that module **and in all of its descendants**. Its parent cannot see it, and
neither can a sibling.
:::

That direction surprises people. A child can reach up into its parent's private
guts; a parent cannot reach down into its child's.

:::memory who can see `secret`
     crate root
       │  fn caller()   ────────────✗ cannot see secret
       │
       └── mod store
             │  fn secret()          ← defined here
             │  fn helper()  ────────✓ same module
             │
             └── mod index
                   fn lookup() ──────✓ a descendant
:::

So `pub` on an item is necessary but not sufficient: every module on the path
from the root to the item must also be reachable. A `pub fn` inside a private
`mod` is unreachable from outside, and the error names the *module*, not the
function.

```rust,bad
mod store {
    mod index {                 // private
        pub fn lookup() -> u32 { 7 }
    }
}
fn main() {
    store::index::lookup();     // error[E0603]: module `index` is private
}
```

### The graded forms

Most people learn `pub` and stop, and then reach for `pub` when they meant
something much narrower. **Visibility** has five steps, not two.

| form | visible in |
|---|---|
| *(nothing)* | this module and its descendants |
| `pub(super)` | the parent module and everything under it |
| `pub(in crate::a::b)` | that module and everything under it |
| `pub(crate)` | anywhere in this crate, and nowhere outside it |
| `pub` | anywhere, including other crates |

`pub(crate)` is the workhorse and the one worth adopting today. It says *this is
shared plumbing, and it is not a promise to anyone*. Compare the consequences:
a `pub` item is part of your published API and changing it is a breaking
release; a `pub(crate)` item can be renamed on a Tuesday.

:::gotcha
`pub(crate)` on a struct field is not the same as `pub(crate)` on the struct. The
struct's visibility controls who can name the type; each field's visibility
controls who can read it, who can write it, and (this is the one people miss)
who can **construct the struct with a literal**. A single private field means
outside code must go through your constructor, which is how a type keeps an
invariant.

```rust,bad
pub struct Port { n: u16 }        // field private
let p = Port { n: 0 };            // error[E0451]: field `n` of struct `Port` is private
```
:::

## use and pub use

### use is a local alias, nothing more

```rust
use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::fmt::Result as FmtResult;   // when two Results would collide
```

`use` creates a name in the current module. It does not import code, does not
affect compilation order, and does not change what is compiled, since the whole
crate is compiled either way. It is purely a shorthand, and two `use` lines that bring
in the same name are a hard error (`E0252`), which `as` exists to resolve.

:::gotcha
`use` is itself an item, so it has visibility. `use` alone is private: the alias
is yours. `pub use` re-exports the name, so anyone who can see your module can
reach the item through it.
:::

### pub use is API design

This is the part worth taking seriously. A **re-export** decides the path a
user writes, and that path comes from your `pub use` lines rather than your
directory layout.

```rust
// src/lib.rs
mod parse;                 // private: nobody outside sees `parse`
mod format;
mod error;

pub use error::Error;      // users write my_tool::Error
pub use parse::Document;   // users write my_tool::Document
```

The internal tree can be six levels deep and reorganised twice a year. The
public surface is four lines, and it is the only thing anyone depends on. Move
`Document` from `parse` to `model` and update one `pub use`, and no user notices,
because no user ever wrote `my_tool::parse::Document`.

This is why `std` reads the way it does: `std::collections::HashMap` is defined
in a different crate entirely (`hashbrown`, wrapped), and `Vec` lives in `alloc`
but is re-exported into `std::vec::Vec` and again into the prelude.

### The prelude

The **prelude** is a small set of names that the compiler injects into every
module: `Option`, `Result`, `String`, `Vec`, `Box`, `Clone`, `Iterator`, `Drop`
and a few dozen more. That is why `Option` needs no `use` and `HashMap`
does. It is deliberately tiny: every name in a prelude is a name a user can no
longer use for their own type without shadowing.

Libraries sometimes ship their own, as in `use rayon::prelude::*;`. That is a
reasonable pattern for a crate whose traits must be in scope for its methods to
be callable at all.

## Workspaces

A **workspace** is several packages that build together.

```toml
# Cargo.toml at the root
[workspace]
members = ["cli", "core", "proto"]
resolver = "3"
```

Three things are shared, and they are the whole reason to bother:

- **one `Cargo.lock`**, so every member resolves to the same version of every dependency and there is exactly one `serde` in the build
- **one `target/`**, so a dependency compiled for `core` is not compiled again for `cli`
- **one `cargo test`** at the root runs everything

Splitting a large crate into workspace members also buys real incremental
rebuild time, because a crate is the unit of recompilation: touch `cli` and
`core` is not rebuilt. The cost is that a cyclic dependency between two members
is impossible, because crates form a DAG, so the split has to follow a real
layering.

## Semver and the public surface

**Semver** makes everything `pub` and reachable a promise. `cargo publish` cannot take it
back; a later release can only be a new version, and the number says how much
you broke.

| change | breaking? |
|---|---|
| adding a `pub fn` | no |
| adding a variant to a `pub enum` | **yes**; callers' `match` stops being exhaustive |
| adding a field to a `pub struct` with all-public fields | **yes**; callers' struct literals stop compiling |
| adding a private field to that struct | also yes, for the same reason |
| adding a method to a `pub trait` without a default | **yes**; implementors stop compiling |
| renaming a parameter | no (except for a caller using it as a named argument in `format!`) |
| making a `pub` item `pub(crate)` | **yes** |

The struct-field row is the one that catches everyone. A struct whose fields are
all `pub` has frozen its field list forever.

:::note
`#[non_exhaustive]` is the escape hatch, applied at definition time.

```rust
#[non_exhaustive]
pub struct Config { pub retries: u32 }

#[non_exhaustive]
pub enum Error { NotFound, Denied }
```

On a struct, downstream crates cannot use a struct literal or an exhaustive
pattern, so you can add fields later. On an enum, downstream `match` must have a
`_` arm, so you can add variants later. Inside the defining crate nothing
changes, because the restriction applies to *other* crates only.
:::

:::gotcha
`#[non_exhaustive]` cannot be added retroactively without breaking people, which
is the joke: the tool for avoiding a breaking change must be applied before you
need it. Put it on any public struct or enum you are not certain is final,
especially config structs and error enums, which are the two that always grow.
:::

:::note
**The habit.** Default to private. Promote to `pub(crate)` when a sibling needs
it, and to `pub` only when you have decided to support it forever. Then write
the `pub use` lines that say what your crate *is*, and treat that list as the
design document it actually is.
:::
