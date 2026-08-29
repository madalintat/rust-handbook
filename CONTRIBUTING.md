# Contributing

Contributions are welcome. The repository is set up so that anyone can fork it
and open a pull request, and every change lands on `main` through review.

## The shape of a contribution

1. Fork the repository and create a branch from `main`.
2. Make your change.
3. Run the checks below. They are the same ones CI runs, so a green run locally
   means a green run there.
4. Open a pull request. It needs an approving review and a green CI run before
   it can merge.

## Running the checks

```sh
./release.sh --check
```

That is the whole sequence, and it is the one CI runs: the build, a check that
`data/` matches `content/`, the prose rule, and the three offline suites. Add
`--net` to include the two that hit the network:

```sh
./release.sh --check --net
```

Those two compile against [play.rust-lang.org](https://play.rust-lang.org),
which is a free service, so CI runs them on `main` rather than on every pull
request. They are `python3 build.py --validate`, which compiles all 316
exercises and stages, and `node test_workbench.mjs`, which exercises the
playground client and the diagnostics parser.

If you touched anything under `content/`, commit the regenerated `data/` with
it. CI fails if the two disagree.

## Writing a unit or a project

Read [docs/AUTHORING.md](docs/AUTHORING.md) first. It is the contract: the file
format, the exercise format, the voice, and the definition of done. Then read
the three `05-ownership` files as the reference.

The short version:

- An exercise is not finished until `python3 build.py --check content/ex/<slug>.md`
  prints `N clean`. That means every starter fails with the error its
  explanation describes, and every solution compiles and passes its own tests.
- If a starter raises a different error than you expected, the compiler is
  right. Change `@expect` and write the explanation for the error it actually
  raises.
- No em dashes or en dashes. CI enforces this.

## Fixing content

Corrections to a unit, an exercise, a drill or a glossary term are the most
useful contributions. If a diagnostic explanation is wrong or misleading, say so
in an issue with the code you ran, or open a pull request with the fix.

## What is likely to be declined

- A new dependency. The site ships no JavaScript libraries and `build.py` uses
  only the standard library. That is deliberate and load bearing.
- A framework, a bundler, or a build step at deploy time.
- Prose that states a rule without the reason it exists.

## Commit messages

Describe what changed and why. No trailers, no tool attribution.
