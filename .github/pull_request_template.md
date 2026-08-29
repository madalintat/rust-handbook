## What this changes

<!-- One or two sentences. What is different after this lands. -->

## Why

<!-- The problem, or the thing that was wrong. -->

## Checks

- [ ] `python3 build.py` runs and I committed the regenerated `data/`
- [ ] `python3 test_build.py`, `node test_views.mjs` and `node test_vim.mjs` pass
- [ ] If I touched exercises: `python3 build.py --check content/ex/<slug>.md` prints `N clean`
- [ ] No em dashes or en dashes
- [ ] No new dependency
