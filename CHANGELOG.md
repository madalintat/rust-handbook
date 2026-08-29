# Changelog

Notable changes to the Rust Handbook. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html), read as:

- **major** removes or restructures units and projects, or breaks a route people
  may have bookmarked
- **minor** adds units, projects, exercises or features
- **patch** fixes content, prose, or the site itself

## [Unreleased]

Nothing yet.

## [1.0.0] - 2026-08-29

The first complete release: the whole track, the projects, and the workbench.

### Added

- 28 units covering the language, each with 8 compiled exercises and 15 drills.
  Units 25 to 27 cover ground no single official book does: reading rustc
  diagnostics, shipping a real command-line tool, and `no_std`.
- 13 projects in three tiers, from a four-stage Game of Life to a twelve-stage
  memory allocator. Stages accumulate, so each one starts from the last one's
  finished code.
- A workbench that compiles your code on play.rust-lang.org and shows rustc's
  own diagnostic beside a written reading of that specific error.
- Vim mode: motions, operators with counts, text objects, visual mode, registers,
  undo, `gc`, `gs`, search with smartcase, and `:w` to run.
- A glossary of 218 terms, with hover definitions and back-references.
- Progress tracking and a day streak, kept in the browser and sent nowhere.
- `llms.txt`, generated from the manifest so an assistant can read the whole
  project in one go.

### Verified

Every exercise and project stage compiled against rustc 1.98.0, edition 2024.
`build.py --validate` asserts that each starter fails with the error its
explanation describes and that each solution passes its own hidden tests, so a
change in rustc's diagnostics becomes a build failure rather than a confused
reader.

[Unreleased]: https://github.com/madalintat/rust-handbook/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/madalintat/rust-handbook/releases/tag/v1.0.0
