#!/usr/bin/env python3
"""Checks for the markdown pipeline in build.py.

The fence reader earned this file. Its first version assumed exactly three
backticks and did a dict lookup on the info string, so an author writing about
the format, with the ````markdown blocks that AUTHORING.md itself uses, closed
the outer fence on the first inner line, shredded the rest of the section, and
then crashed the whole build on a KeyError. Two authors hit it independently.

    python3 test_build.py
"""

import json
import pathlib
import sys

import build

PASS, FAIL = [], []


def ok(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"\n          {extra}" if not cond and extra else ""))


# --------------------------------------------------------------------------
# fences
# --------------------------------------------------------------------------
print("--- fence reader ---")

lines = "```rust\nlet x = 1;\n```\nafter".split("\n")
info, code, nxt, raw = build.read_fence(lines, 0)
ok("three backticks: info", info == "rust", repr(info))
ok("three backticks: code", code == "let x = 1;", repr(code))
ok("three backticks: resumes after the close", lines[nxt] == "after", repr(lines[nxt]))

# The one that broke everything: a four-backtick fence wrapping three-backtick ones.
nested = "````markdown\n```rust\ninner\n```\nstill inside\n````\nafter".split("\n")
info, code, nxt, raw = build.read_fence(nested, 0)
ok("four backticks: info", info == "markdown", repr(info))
ok("four backticks: does NOT close on the inner fence",
   "still inside" in code, repr(code))
ok("four backticks: keeps the inner fence verbatim", "```rust" in code, repr(code))
ok("four backticks: resumes after the outer close", nested[nxt] == "after", repr(nested[nxt]))
ok("raw keeps the original tick count", raw.startswith("````") and raw.endswith("````"), repr(raw[:20]))


unterminated = "```rust\nlet x = 1;".split("\n")
info, code, nxt, raw = build.read_fence(unterminated, 0)
ok("unterminated fence does not hang or crash", code == "let x = 1;" and nxt >= len(unterminated))

# Regression: parse_exercise and build_drills used to REBUILD the fence with
# exactly three backticks, so a ````markdown example inside an @after was cut off
# at the first inner fence and the prose after it was swallowed. AUTHORING.md
# promises this works.
NESTED_EX = """@kind fix
@expect E0382

Brief.

```starter
fn main() {}
```

@after
Here is the format:

````markdown
```rust
let x = 1;
```
still inside
````

Tail prose.
"""
_ex = build.parse_exercise(("1. t", NESTED_EX), 1)
ok("nested fence in @after survives whole",
   "still inside" in _ex["after"] and "<p>still inside</p>" not in _ex["after"],
   _ex["after"][:180])
ok("prose after a nested fence is not swallowed",
   "<p>Tail prose.</p>" in _ex["after"], _ex["after"][-120:])
ok("the starter block is still captured", _ex["starter"].strip() == "fn main() {}",
   repr(_ex["starter"]))

print("--- fence info strings ---")
cases = [
    ("rust",            ("rust", "",     "rust")),
    ("",                ("rust", "",     "rust")),
    ("rust,bad",        ("rust", "bad",  "will not compile")),
    ("rust,good",       ("rust", "good", "compiles")),
    ("rust, bad",       ("rust", "bad",  "will not compile")),
    # Anything else is a label, never a lookup. These are the shapes that crashed.
    ("no_run",          ("no_run", "",   "no_run")),
    ("no_run     compile, do not run: opens a socket", None),
    ("text",            ("text", "",     "text")),
    ("sh",              ("sh", "",       "sh")),
    ("toml",            ("toml", "",     "toml")),
]
for info, want in cases:
    try:
        got = build.fence_meta(info)
        crashed = False
    except Exception as e:  # noqa: BLE001 - the point is that nothing may raise
        got, crashed = repr(e), True
    if want is None:
        ok(f"info {info[:28]!r} does not raise", not crashed, got)
    else:
        ok(f"info {info!r} -> {want}", got == want, repr(got))

# --------------------------------------------------------------------------
# rendering
# --------------------------------------------------------------------------
print("--- render ---")

h = build.render("```rust,bad\nlet x: i32 = \"s\";\n```")
ok("bad fence gets the bad class", 'class="codeblock bad"' in h, h[:90])
ok("bad fence is labelled", "will not compile" in h)
# html.escape(quote=False) deliberately leaves " alone: inside <pre><code> it
# needs no escaping. What must be escaped is < and &, or a generic like Vec<T>
# would open a tag.
h2 = build.render("```rust\nlet v: Vec<&str> = a && b;\n```")
ok("angle brackets escaped in code", "Vec&lt;&amp;str&gt;" in h2, h2)
ok("ampersands escaped in code", "a &amp;&amp; b" in h2, h2)

h = build.render("````markdown\n```rust\nx\n```\n````")
ok("nested fence survives render", "```rust" in h, h[:140])

h = build.render(":::gotcha\nWatch out.\n:::")
ok("gotcha callout", 'class="callout gotcha"' in h and "Watch out." in h, h[:120])

h = build.render(":::memory a title\n  A -> B\n:::")
ok("memory diagram", 'class="memory"' in h and "a title" in h, h[:120])
ok("memory body is not inline-processed",
   "-&gt;" in h or "->" in h, h)  # arrows must not become &rarr; inside a diagram

h = build.render("| a | b |\n|---|---|\n| 1 | 2 |")
ok("table", h.count("<td>") == 2 and "<th>" in h, h[:120])

h = build.render("- one\n- two")
ok("bullet list", h == "<ul><li>one</li><li>two</li></ul>", h)

h = build.render("1. one\n2. two")
ok("ordered list", h.startswith("<ol>") and h.count("<li>") == 2, h)

# build.py used to substitute ASCII
# lookalikes, but the arrow rule was dead code (escaping ran first, so `->` was
# already `-&gt;` and never matched) and the dash rule fired on three instances
# against 511 real em dashes. Both removed. Text now passes through verbatim.
h = build.render("Use `a -> b` in code.")
ok("arrows in code spans pass through", "-&gt;" in h and "&rarr;" not in h, h)

h = build.render("An arrow -> and a dash -- here.")
ok("no arrow substitution in prose", "&rarr;" not in h, h)
ok("no dash substitution in prose", "&mdash;" not in h, h)

h = build.render("An arrow \u2192 and an ellipsis \u2026 survive.")
ok("real unicode punctuation survives", "\u2192" in h and "\u2026" in h, h)

seen, toc = {}, []
build.render("## One\n\n## One", seen, toc)
ok("duplicate headings get distinct ids", toc[0]["id"] != toc[1]["id"],
   f'{toc[0]["id"]} vs {toc[1]["id"]}')

# --------------------------------------------------------------------------
# exercise parsing
# --------------------------------------------------------------------------
print("--- exercise parser ---")

EX = """@kind fix
@concept move
@expect E0382

The brief.

```rust
let hint = 1;
```

```starter
fn main() {}
```

```tests
#[test] fn t() {}
```

```solution
fn main() {}
```

@hint first
@hint second

@diagnose E0382
Prose in the diagnose.

```rust
let inside_diagnose = 2;
```

@after
Prose after.

```rust
let inside_after = 3;
```
"""
ex = build.parse_exercise(("1. A title", EX), 1)
ok("number and title", ex["n"] == 1 and ex["title"] == "A title", repr(ex["title"]))
ok("kind / concept / expect", ex["kind"] == "fix" and ex["concept"] == "move"
   and ex["expect"] == {"code": "E0382"}, repr(ex["expect"]))
ok("starter captured", "fn main" in ex["starter"], repr(ex["starter"]))
ok("tests captured", "#[test]" in ex["tests"], repr(ex["tests"]))
ok("solution captured", "fn main" in ex["solution"])
ok("both hints", ex["hints"] == ["first", "second"], repr(ex["hints"]))
ok("brief keeps its own fence", "let hint = 1;" in ex["brief"], ex["brief"][:120])

# Regression: a fence inside @diagnose used to be handled before the sink was
# consulted, so it landed in the brief, giving the answer away up front.
ok("fence inside @diagnose stays in the diagnose",
   "let inside_diagnose = 2;" in ex["diagnose"]["E0382"], ex["diagnose"]["E0382"][:160])
ok("fence inside @diagnose does NOT leak into the brief",
   "let inside_diagnose" not in ex["brief"], ex["brief"][:160])
ok("fence inside @after stays in after",
   "let inside_after = 3;" in ex["after"], ex["after"][:160])
ok("fence inside @after does NOT leak into the brief",
   "let inside_after" not in ex["brief"], ex["brief"][:160])

print("--- the cache covers an item only while its key matches ---")
# Regression: the carry-forward asked "is there an entry for this ref", while
# validate() asked "does the entry's key still match". An exercise edited since
# the last run therefore counted as validated and replayed a stale finding.
import tempfile

_EX = {"starter": "a", "tests": "t", "solution": "s", "kind": "fix",
       "expect": {"code": "E0382"}, "diagnose": {"E0382": "x"}}
_items = {"u": [dict(_EX, n=1)]}
_real_cache = build.CACHE

with tempfile.TemporaryDirectory() as _d:
    build.CACHE = pathlib.Path(_d) / "c.json"

    _, fresh, stale = build.cache_split(_items)
    ok("with no cache, nothing is fresh", not fresh and stale == {"u#1"}, f"{fresh} {stale}")

    build.CACHE.write_text(json.dumps(
        {"u#1": {"key": build.cache_key(_items["u"][0]), "findings": []}}))
    _, fresh, stale = build.cache_split(_items)
    ok("a matching key is fresh", fresh == {"u#1"} and not stale, f"{fresh} {stale}")

    # the same ref, but the starter has changed underneath it
    _, fresh, stale = build.cache_split({"u": [dict(_EX, n=1, starter="a2")]})
    ok("an edited starter is stale, not fresh", stale == {"u#1"} and not fresh,
       f"{fresh} {stale}")

    build.CACHE.write_text(json.dumps({"u#1": {"key": "nope", "findings": []}}))
    _, fresh, stale = build.cache_split(_items)
    ok("an entry with a wrong key is stale", stale == {"u#1"}, f"{fresh} {stale}")

build.CACHE = _real_cache
ok("ref_of is the one spelling", build.ref_of("u", {"n": 3}) == "u#3",
   build.ref_of("u", {"n": 3}))

print("--- @expect forms ---")
mk = lambda v: build.parse_exercise(("1. t", f"@expect {v}\n\nbrief\n"), 1)["expect"]
ok("E-code form", mk("E0382") == {"code": "E0382"}, repr(mk("E0382")))
ok("quoted message form", mk('"missing type"') == {"msg": "missing type"}, repr(mk('"missing type"')))
ok("bare message form", mk("literal out of range") == {"msg": "literal out of range"},
   repr(mk("literal out of range")))
ok("absent", mk("") is None, repr(mk("")))

E = lambda expect, diag: {"expect": expect, "diagnose": diag}
ok("matching code passes",
   not build.expect_findings(E({"code": "E0382"}, {"E0382": "x"}), "error[E0382]: moved"))
ok("wrong code is caught",
   any("E0505" in w for w in build.expect_findings(
       E({"code": "E0382"}, {"E0505": "x"}), "error[E0505]: moved")))
ok("missing @diagnose is caught",
   any("no @diagnose" in w for w in build.expect_findings(
       E({"code": "E0382"}, {}), "error[E0382]: moved")))
ok("matching message passes",
   not build.expect_findings(E({"msg": "missing type"}, {}),
                             "error: missing type for `const` item"))
ok("message match is case-insensitive",
   not build.expect_findings(E({"msg": "MISSING TYPE"}, {}),
                             "error: missing type for `const` item"))
ok("wrong message is caught",
   any("does not say" in w for w in build.expect_findings(
       E({"msg": "something else"}, {}), "error: missing type")))
ok("no @expect asserts nothing about the message",
   not build.expect_findings(E(None, {}), "error: anything at all"))

print("--- check_exercise: the single verdict both runners use ---")
# --validate and --check had separate hand-written copies of this logic and had
# already drifted apart. compile_once is stubbed so these stay offline.
_real_compile = build.compile_once

def stub(results):
    """results: list of (success, stdout, stderr), consumed in call order."""
    seq = list(results)
    def fake(code, tests=None):
        ok, out, err = seq.pop(0)
        return {"success": ok, "stdout": out, "stderr": err}
    return fake

def ex_of(**kw):
    base = {"starter": "s", "tests": "t", "solution": "sol", "kind": "fix",
            "expect": {"code": "E0382"}, "diagnose": {"E0382": "x"}}
    base.update(kw)
    return base

build.compile_once = stub([(False, "", "error[E0382]: moved"), (True, "test result: ok", "")])
ok("a sound exercise reports nothing", build.check_exercise(ex_of()) == [],
   repr(build.check_exercise))

build.compile_once = stub([(True, "test result: ok", ""), (True, "test result: ok", "")])
ok("a starter that compiles is caught",
   any("nothing to fix" in w for w in build.check_exercise(ex_of())))

build.compile_once = stub([(False, "", "error[E0505]: x"), (True, "test result: ok", "")])
r = build.check_exercise(ex_of())
ok("a starter raising the wrong code is caught", any("E0505" in w for w in r), repr(r))

build.compile_once = stub([(False, "", "error[E0382]: moved"), (False, "", "error[E0277]: nope")])
ok("a solution that does not build is caught",
   any("solution does not build" in w for w in build.check_exercise(ex_of())))

build.compile_once = stub([(False, "", "error[E0382]: moved"),
                           (True, "test t::a ... FAILED\ntest result: FAILED", "")])
r = build.check_exercise(ex_of())
ok("a failing hidden test is caught and NAMED", any("t::a" in w for w in r), repr(r))

build.compile_once = stub([(False, "", "error[E0382]: moved")])
ok("a missing solution is caught",
   any("no solution" in w for w in build.check_exercise(ex_of(solution=""))))

build.compile_once = stub([(False, "", "error[E0382]: moved"), (True, "test result: ok", "")])
ok("a missing tests block is caught",
   any(w == "no tests" for w in build.check_exercise(ex_of(tests=None))))

# predict exercises never compile the starter, so only the solution call happens
build.compile_once = stub([(True, "test result: ok", "")])
ok("predict skips the starter compile",
   build.check_exercise(ex_of(kind="predict", expect=None)) == [])

build.compile_once = _real_compile

# --------------------------------------------------------------------------
# front matter
# --------------------------------------------------------------------------
print("--- front matter ---")
meta, body = build.front_matter("---\nnum: 5\nslug: x-y\n---\n\nBody here.")
ok("keys parsed", meta == {"num": "5", "slug": "x-y"}, repr(meta))
ok("body starts after the fence", body == "Body here.", repr(body))
meta, body = build.front_matter("No front matter.")
ok("absent front matter is not an error", meta == {} and body == "No front matter.")

# --------------------------------------------------------------------------
print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
