# Sources, and where each one lands

Every official book the track draws on, and the units that carry its material.
This exists so coverage is checkable rather than assumed — if a source has no
unit against it, that is a gap, not an oversight nobody noticed.

| Source | Where it lands |
|---|---|
| [The Book](https://doc.rust-lang.org/stable/book/title-page.html) | The spine. Units 00–24 follow its arc and go past it: it introduces ownership in one chapter, this takes three (05, 06, 07) and attaches every rule to the bug it prevents. |
| [Rust by Example](https://doc.rust-lang.org/rust-by-example/) | Absorbed into the exercises. RBE's value is that everything is runnable; here everything is runnable *and* verified by hidden tests, so a broken example is a build failure. |
| [rustlings](https://github.com/rust-lang/rustlings) | The exercise format, deepened. Rustlings gives a hint; every exercise here ships a written reading of the specific diagnostic you are about to hit. |
| [The Cargo Book](https://doc.rust-lang.org/cargo/index.html) | Unit 00 (what cargo does, profiles, editions, semver), unit 19 (workspaces, paths, visibility), unit 26 (dependencies, features, release). |
| [The rustdoc Book](https://doc.rust-lang.org/rustdoc/index.html) | Unit 20 — doc comments, `cargo doc`, and doctests, which are compiled and run so your documentation cannot silently rot. |
| [The rustc Book](https://doc.rust-lang.org/rustc/index.html) | Unit 00 (what rustc is, what a compilation actually does), unit 13 (what monomorphisation emits), unit 27 (targets and cross-compilation). |
| [The Error Index](https://doc.rust-lang.org/error_codes/error-index.html) | **Unit 25**, and the whole workbench. Every diagnostic the workbench shows links to its code in the index, and unit 25 is a guided tour of the thirty codes you will actually meet. |
| [The CLI Book](https://rust-cli.github.io/book/index.html) | **Unit 26** — argument parsing with clap, error reporting with anyhow, exit codes, stdout vs stderr, testing a binary. |
| [The Embedded Book](https://doc.rust-lang.org/stable/embedded-book/) | **Unit 27** — `no_std`, what the standard library actually is, `core` vs `alloc` vs `std`, and how the same language runs without an operating system. |
| [The Nomicon](https://doc.rust-lang.org/nomicon/index.html) | Unit 23 (unsafe: what it unlocks, what it does not check), unit 18 (why `Rc` is not `Send`), unit 15 (variance, mentioned honestly and not laboured). |
| [The Reference](https://doc.rust-lang.org/reference/index.html) | Woven throughout as the authority on exact behaviour — expression grammar (03), pattern syntax (09), trait coherence (14), drop order (05), macro matching (24). |
| [The Unstable Book](https://doc.rust-lang.org/nightly/unstable-book/index.html) | Mentioned where a stable gap is worth naming — never taught as if it were stable. |

## What is deliberately not here

The reference books are not reproduced. This is a **path through** them that
ends in you having typed the code, not a re-hosting of their text. Where a
reader needs the authority, the unit links out.

A future phase could mirror the Reference and the error index as a second,
browsable surface inside the app — the reader already has the seam for it, since
every diagnostic links to its code. That is a separate project.
