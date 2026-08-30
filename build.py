#!/usr/bin/env python3
"""Rust Handbook: content/ -> data/.

Everything computable once is computed here: word counts, reading minutes,
heading ids, the table of contents, the glossary's back-references, and, with --validate,
whether each exercise actually behaves the way its author claimed.

    python3 build.py                       rebuild data/
    python3 build.py --validate            rebuild, then compile every exercise
                                           for real. Cached by content hash.
    python3 build.py --check content/ex/X.md
                                           compile one unit's exercises and
                                           report. Writes nothing, so several
                                           authors can run it at once.

An exercise passes when its starter fails the way the exercise claims and its
solution compiles and passes every hidden test. That is what stops the content
rotting: rustc changes its diagnostics between releases, and an exercise
promising E0382 that quietly starts emitting E0505 is now a build failure rather
than a confused reader.

No dependencies. Standard library only.
"""

import concurrent.futures
import hashlib
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
CONTENT = ROOT / "content"
OUT = ROOT / "data"

WPM = 230  # a careful read of technical prose, not a skim
SITE = "https://github.com/madalintat/rust-handbook"
LIVE = "https://the-rust-handbook.com"

# The full track. Units without a file in content/units are emitted as stubs so
# the map is honest about what exists and what is still to come.
TRACK = [
    ("00-toolchain",    "The toolchain",              "slate",  "What rustc, cargo and an edition actually are, and what `cargo run` does to your file."),
    ("01-bindings",     "Bindings and mutability",    "amber",  "Why `let` is not assignment, what shadowing is for, and why mutability is a property of the binding."),
    ("02-types",        "Types, overflow and casts",  "amber",  "Fixed-width integers that panic in debug and wrap in release, and why `as` is the dangerous one."),
    ("03-expressions",  "Expressions and blocks",     "amber",  "Almost everything is an expression, which is why `if` returns a value and a stray semicolon changes a type."),
    ("04-control-flow", "Control flow",               "amber",  "`loop` as an expression, `while let`, labelled breaks, and the shape of a `for`."),
    ("05-ownership",    "Ownership",                  "ferris", "One owner, one drop. What a move copies, what it does not, and which bug the whole rule exists to prevent."),
    ("06-borrowing",    "Borrowing and references",   "ferris", "Shared or unique, never both. The rule that makes data races a compile error rather than a Tuesday."),
    ("07-slices",       "Slices and fat pointers",    "ferris", "A pointer that carries a length, and why `&str` and `String` are not the same kind of thing."),
    ("08-structs",      "Structs and methods",        "moss",   "Data with a name, `impl` blocks, and what `&self` versus `self` commits you to."),
    ("09-enums",        "Enums and pattern matching", "moss",   "Sum types, exhaustiveness as a tool rather than a chore, and why `match` catches bugs `switch` cannot."),
    ("10-option",       "Option",                     "moss",   "The null that cannot bite you, and the combinators that keep it from becoming a pyramid."),
    ("11-collections",  "Collections",                "moss",   "Vec, String, HashMap, VecDeque, BTreeMap, what each one costs and when it reallocates."),
    ("12-errors",       "Error handling",             "clay",   "Result, `?`, and the difference between an error you handle and a bug you panic on."),
    ("13-generics",     "Generics",                   "slate",  "Monomorphisation: what the compiler actually emits, and why generic Rust costs nothing at runtime."),
    ("14-traits",       "Traits",                     "slate",  "Shared behaviour, coherence, blanket impls, and static versus dynamic dispatch."),
    ("15-lifetimes",    "Lifetimes",                  "ferris", "Not how long a value lives, a claim the compiler checks. Elision, and why `'a` is not a duration."),
    ("16-closures",     "Closures",                   "plum",   "Fn, FnMut, FnOnce: three traits that describe what a closure does to what it captured."),
    ("17-iterators",    "Iterators",                  "plum",   "Lazy by construction, fused by adapters, and compiled down to the loop you would have written."),
    ("18-smart-ptr",    "Smart pointers",             "plum",   "Box, Rc, RefCell: moving ownership to the heap, sharing it, and moving the borrow check to runtime."),
    ("19-modules",      "Modules and crates",         "slate",  "Paths, visibility, `use`, and how a workspace is laid out."),
    ("20-testing",      "Testing and docs",           "moss",   "`#[test]`, integration tests, and doc comments that are compiled and run."),
    ("21-concurrency",  "Concurrency",                "rust",   "Send and Sync, threads, channels, and Arc<Mutex<T>>, fearless because the checker is watching."),
    ("22-async",        "Async",                      "rust",   "Futures do nothing until polled, what `.await` compiles into, and where Pin comes from."),
    ("23-unsafe",       "Unsafe",                     "rust",   "The five things it unlocks, the invariants it does not check, and why it is not a licence."),
    ("24-macros",       "Macros",                     "plum",   "macro_rules! matching, hygiene, and what a procedural macro sees."),
    # The three that are not in any single book, and are the reason this exists.
    ("25-diagnostics",  "Reading the compiler",       "ferris", "The thirty error codes you will actually meet, what each one is really saying, and how to read a diagnostic you have never seen."),
    ("26-ship-it",      "Ship it",                    "rust",   "A real command-line tool end to end: cargo, clap, anyhow, tests, docs, release. Everything so far, used at once."),
    ("27-no-std",       "No_std and embedded",        "slate",  "What the standard library actually is, what survives without it, and how the same language runs on a microcontroller."),
]

# TRACK is the registry. num, title and accent come from here and nowhere else:
# reading them from front matter too gave a unit two identities, and a card could
# show one number while the page it opened showed another.
TITLES = {slug: title for slug, title, _, _ in TRACK}
ACCENTS = {slug: accent for slug, _, accent, _ in TRACK}
ORDER = {slug: i for i, (slug, _, _, _) in enumerate(TRACK)}

# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------


def slug_id(text, seen):
    """A stable, readable id for a heading. Collisions get a numeric suffix."""
    s = re.sub(r"[^a-z0-9]+", "-", re.sub(r"<[^>]+>", "", text).lower()).strip("-")
    s = s or "section"
    if s in seen:
        seen[s] += 1
        s = f"{s}-{seen[s]}"
    else:
        seen[s] = 0
    return s


def sections(md, hashes="##"):
    """Split markdown at a heading level. Returns (lead, [(title, body), ...]).

    Five call sites used to spell out `re.split` then walk `range(1, len(c), 2)`
    reading `c[k]` and `c[k+1]`, which is the same off-by-one waiting to be made
    five times.
    """
    c = re.split(rf"^{hashes}\s+(.+)$", md, flags=re.M)
    return c[0], list(zip(c[1::2], c[2::2]))


def words_of(html_text):
    return len(re.sub(r"<[^>]+>", " ", html_text).split())


def mins_of(n_words):
    return max(1, round(n_words / WPM))


def front_matter(text):
    """`---` delimited key: value header. Values are strings; a few keys that are
    naturally lists are split on commas by the caller."""
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end < 0:
        # An unterminated block used to raise ValueError from deep inside the
        # build, with a traceback naming no file, leaving the author to bisect
        # 56 markdown files by hand.
        raise ValueError("front matter opened with --- but never closed")
    meta = {}
    for line in text[3:end].strip().split("\n"):
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    return meta, text[end + 4 :].lstrip("\n")


GLOSSARY = {}
GLOSS_USE = {}
_CUR = {"unit": None, "title": None, "kind": "unit"}


def load_glossary():
    """The shared file, then one optional file per unit.

    Per-unit files exist so several authors can add terms at once without
    editing, and corrupting, one shared JSON document. Later files win on a
    duplicate key, which is fine: the definitions agree or the later author had
    a reason.
    """
    sources = []
    p = CONTENT / "glossary.json"
    if p.exists():
        sources.append(p)
    sources.extend(sorted((CONTENT / "gloss").glob("*.json")))
    for src in sources:
        try:
            data = json.loads(src.read_text())
        except json.JSONDecodeError as e:
            print(f"  ! {src.name} is not valid JSON: {e}")
            continue
        for e in data.get("terms", []):
            GLOSSARY[e["t"].lower()] = e


# --------------------------------------------------------------------------
# inline
# --------------------------------------------------------------------------

# Code spans are pulled out before anything else touches the text, because a
# `*` or a `_` inside `let x = a * b` is not emphasis and an escaped underscore
# in every code sample would make the source unreadable to write.
def inline(text):
    stash = []

    def keep(m):
        stash.append(m.group(1))
        return f"\x00{len(stash) - 1}\x00"

    text = re.sub(r"`([^`]+)`", keep, text)
    text = html.escape(text, quote=False)

    # links first, so their text can still carry emphasis
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', text)

    def bold(m):
        term = m.group(1)
        entry = GLOSSARY.get(re.sub(r"<[^>]+>", "", term).lower())
        if entry:
            GLOSS_USE.setdefault(entry["t"].lower(), set()).add(
                (_CUR["unit"], _CUR["title"], _CUR["kind"])
            )
            return (
                f'<span class="term" data-g="{html.escape(entry["p"], quote=True)}"'
                f' data-t="{html.escape(entry["t"], quote=True)}">{term}</span>'
            )
        return f"<strong>{term}</strong>"

    text = re.sub(r"\*\*([^*]+)\*\*", bold, text)
    text = re.sub(r"(?<![*\w])\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", text)

    for i, c in enumerate(stash):
        text = text.replace(f"\x00{i}\x00", f"<code>{html.escape(c, quote=False)}</code>")
    return text


# --------------------------------------------------------------------------
# blocks
# --------------------------------------------------------------------------

# A fence opens with three or more backticks and closes with at least as many.
# Supporting the longer form is not a nicety: AUTHORING.md documents this very
# format using ````markdown blocks, so an author writing about the format will
# nest fences, and a parser that only knows ``` closes on the first inner line
# and shreds everything after it.
FENCE = re.compile(r"^(`{3,})(.*)$")


def read_fence(lines, i):
    """Consume a fenced block starting at lines[i].

    Returns (info, code, next_i, raw). `raw` is the block exactly as written,
    fences and all, because a caller that only wants to ROUTE the block must
    not re-serialise it. Two of the three callers used to rebuild it with three
    backticks, which silently truncated every ````markdown example an author
    put inside an @after or @diagnose, at the first inner fence.
    """
    start = i
    m = FENCE.match(lines[i].strip())
    ticks = len(m.group(1))
    info = m.group(2).strip()
    close = re.compile(r"^\s*`{" + str(ticks) + r",}\s*$")
    body = []
    i += 1
    while i < len(lines) and not close.match(lines[i]):
        body.append(lines[i])
        i += 1
    end = min(i + 1, len(lines))
    return info, "\n".join(body), end, "\n".join(lines[start:end])


# ```rust,bad marks code that is supposed to fail; the border says so before the
# reader has read a character of it. Any other info string is just a label, 
# never a lookup that can fail, because authors write ```no_run and ```text too.
TONES = {"bad": "will not compile", "good": "compiles"}


def fence_meta(info):
    """(lang, tone, label) for a fence's info string."""
    head, _, rest = info.partition(",")
    flag = rest.strip()
    if flag in TONES:
        return (head.strip() or "rust"), flag, TONES[flag]
    return (info or "rust"), "", (info or "rust")


# Every block opener render() branches on. It lives here rather than inline in
# the paragraph loop so the two cannot drift apart unnoticed. They already had.
BLOCK_START = re.compile(r"^\s*(```|:::|#{1,4}\s|>\s|[-*]\s|\d+\.\s|\|)")

CALLOUTS = {
    "note": ("callout", "Note"),
    "gotcha": ("callout gotcha", "Gotcha"),
    "compare": ("callout compare", "Coming from elsewhere"),
}


def render(md, seen=None, toc=None):
    """Markdown -> HTML. A line-oriented block parser: enough of the language to
    write a textbook in, and nothing else."""
    seen = seen if seen is not None else {}
    lines = md.split("\n")
    out = []
    i = 0

    while i < len(lines):
        ln = lines[i]
        s = ln.strip()

        if not s:
            i += 1
            continue

        # ---- fenced code ------------------------------------------------
        if FENCE.match(s):
            info, code, i, _ = read_fence(lines, i)
            lang, tone, label = fence_meta(info)
            out.append(
                f'<div class="codeblock {tone}" data-lang="{lang}">'
                f'<div class="cb-head"><span>{html.escape(label)}</span></div>'
                f"<pre><code>{html.escape(code, quote=False)}</code></pre></div>"
            )
            continue

        # ---- ::: callouts and memory diagrams ---------------------------
        if s.startswith(":::"):
            kind = s[3:].strip() or "note"
            body = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith(":::"):
                body.append(lines[i])
                i += 1
            i += 1
            if kind.startswith("memory"):
                title = kind[6:].strip() or "In memory"
                out.append(
                    f'<div class="memory"><div class="mt">{html.escape(title)}</div>'
                    f'<pre>{html.escape(chr(10).join(body), quote=False)}</pre></div>'
                )
            else:
                cls, label = CALLOUTS.get(kind, CALLOUTS["note"])
                out.append(
                    f'<div class="{cls}"><div class="ct">{html.escape(label)}</div>'
                    f"{render(chr(10).join(body), seen)}</div>"
                )
            continue

        # ---- headings ---------------------------------------------------
        m = re.match(r"^(#{1,4})\s+(.*)$", s)
        if m:
            level = len(m.group(1))
            text = inline(m.group(2))
            hid = slug_id(m.group(2), seen)
            if toc is not None and level in (2, 3):
                toc.append({"id": hid, "text": re.sub(r"<[^>]+>", "", text), "level": level})
            out.append(f'<h{level} id="{hid}">{text}</h{level}>')
            i += 1
            continue

        # ---- table ------------------------------------------------------
        if s.startswith("|") and i + 1 < len(lines) and re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]):
            head = [c.strip() for c in s.strip("|").split("|")]
            i += 2
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            th = "".join(f"<th>{inline(c)}</th>" for c in head)
            tb = "".join(
                "<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in rows
            )
            out.append(f"<table><thead><tr>{th}</tr></thead><tbody>{tb}</tbody></table>")
            continue

        # ---- blockquote -------------------------------------------------
        if s.startswith("> "):
            body = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                body.append(lines[i].strip()[1:].lstrip())
                i += 1
            out.append(f"<blockquote>{render(chr(10).join(body), seen)}</blockquote>")
            continue

        # ---- lists ------------------------------------------------------
        m = re.match(r"^([-*]|\d+\.)\s+(.*)$", s)
        if m:
            ordered = not m.group(1) in ("-", "*")
            items = []
            while i < len(lines):
                mm = re.match(r"^\s*([-*]|\d+\.)\s+(.*)$", lines[i])
                if not mm:
                    # a continuation line, indented under the current item
                    if lines[i].startswith(("  ", "\t")) and lines[i].strip() and items:
                        items[-1] += " " + lines[i].strip()
                        i += 1
                        continue
                    break
                items.append(mm.group(2))
                i += 1
            tag = "ol" if ordered else "ul"
            li = "".join(f"<li>{inline(x)}</li>" for x in items)
            out.append(f"<{tag}>{li}</{tag}>")
            continue

        # ---- paragraph --------------------------------------------------
        body = []
        while i < len(lines) and lines[i].strip() and not BLOCK_START.match(lines[i]):
            body.append(lines[i].strip())
            i += 1
        if body:
            text = " ".join(body)
            cls = ' class="lede"' if text.startswith("%%") else ""
            out.append(f"<p{cls}>{inline(text.lstrip('%').strip())}</p>")

    return "".join(out)


# --------------------------------------------------------------------------
# units
# --------------------------------------------------------------------------


def split_parts(body, seen, toc):
    """A unit is cut at its `##` boundaries into parts, and a long part is cut
    again at `###` into sub-topics. That is the whole readability trick: nobody
    opens a 5,000-word page, but everybody opens a four-minute section."""
    parts = []
    lead_raw, blocks = sections(body)
    lead = render(lead_raw, seen, toc) if lead_raw.strip() else ""

    for title, raw in blocks:
        title = title.strip()
        pid = slug_id(title, seen)
        toc.append({"id": pid, "text": title, "level": 2})

        intro_raw, sub_blocks = sections(raw, "###")
        intro = render(intro_raw, seen) if intro_raw.strip() else ""
        subs = []
        for st, sraw in sub_blocks:
            st = st.strip()
            sid = slug_id(st, seen)
            toc.append({"id": sid, "text": st, "level": 3})
            shtml = render(sraw, seen)
            w = words_of(shtml)
            subs.append({"id": sid, "text": st, "html": shtml, "words": w, "mins": mins_of(w)})

        full = intro + "".join(s["html"] for s in subs)
        w = words_of(full)
        parts.append(
            {
                "id": pid,
                "title": title,
                # One field, not two. `html` and `intro` were provably equal for
                # every part in the book, so the reader was downloading each
                # part's markup twice: 118 KB of 705 KB.
                "intro": intro,
                "subs": subs,
                "words": w,
                "mins": mins_of(w),
            }
        )
    return lead, parts


def build_units():
    units = {}
    for path in sorted((CONTENT / "units").glob("*.md")):
        meta, body = front_matter(path.read_text())
        slug = meta.get("slug", path.stem)
        if slug not in ORDER:
            # Without this the unit builds, prints its word count, satisfies the
            # author's definition of done, and is invisible in the app, because
            # only TRACK produces manifest entries.
            raise ValueError(
                f"{path.name}: slug {slug!r} is not in TRACK. "
                f"Add it to build.py's TRACK list or fix the slug."
            )
        for key, want in (("num", ORDER[slug]), ("title", TITLES[slug]), ("accent", ACCENTS[slug])):
            got = meta.get(key)
            if got is not None and str(got) != str(want):
                print(f"  ! {path.name}: front-matter {key}={got!r} ignored; TRACK says {want!r}")
        _CUR["unit"], _CUR["title"], _CUR["kind"] = slug, TITLES[slug], "unit"

        seen, toc = {}, []
        lead, parts = split_parts(body, seen, toc)
        w = words_of(lead) + sum(p["words"] for p in parts)

        unit = {
            "slug": slug,
            "num": ORDER[slug],
            "title": TITLES[slug],
            "blurb": meta.get("blurb", ""),
            "concepts": [c.strip() for c in meta.get("concepts", "").split(",") if c.strip()],
            "words": w,
            "mins": mins_of(w),
            "lead": lead,
            "parts": parts,
        }
        (OUT / "unit").mkdir(parents=True, exist_ok=True)
        (OUT / "unit" / f"{slug}.json").write_text(json.dumps(unit))
        units[slug] = unit
        lo, hi = NOTE_WORDS
        if not lo <= w <= hi:
            raise ValueError(f"{path.name}: {w:,} words, the note should be "
                             f"{lo:,} to {hi:,}")
        print(f"  unit  {slug:18s} {w:6,d} words  {unit['mins']:3d}m  {len(parts)} parts")
    return units


# --------------------------------------------------------------------------
# exercises
# --------------------------------------------------------------------------

# An exercise is a `## N. Title` heading, some `@directives`, some prose, and a
# set of fenced blocks named by their language tag.
DIRECTIVE = re.compile(r"^@(\w+)(?:\s+(.*))?$")


def parse_exercise(block, n_default):
    """One exercise, from its heading to the next. Returns the dict the app
    renders and --validate checks."""
    head, body = block
    m = re.match(r"^(\d+)\.\s*(.+)$", head.strip())
    num = int(m.group(1)) if m else n_default
    title = (m.group(2) if m else head).strip()

    ex = {
        "n": num,
        "title": title,
        "kind": "fix",
        "concept": "",
        "expect": None,
        "starter": "",
        "tests": None,
        "solution": "",
        "hints": [],
        "diagnose": {},
        "brief": "",
        "after": "",
    }

    lines = body.split("\n")
    i = 0
    brief, after = [], []
    sink = None  # where loose content currently goes

    def emit(text):
        """Route one chunk to the active sink. Written twice, once for prose,
        once for fences, the two copies disagreed, and a fence inside a
        @diagnose landed in the brief, giving the answer away."""
        if isinstance(sink, tuple) and sink[0] == "diagnose":
            ex["diagnose"][sink[1]].append(text)
        elif sink == "after":
            after.append(text)
        else:
            brief.append(text)

    while i < len(lines):
        ln = lines[i]
        s = ln.strip()

        if FENCE.match(s):
            tag, text, i, raw = read_fence(lines, i)
            if tag in ("starter", "tests", "solution"):
                ex[tag] = text
                continue
            emit(raw)
            continue

        d = DIRECTIVE.match(s)
        if d:
            key, val = d.group(1), (d.group(2) or "").strip()
            if key in ("kind", "concept"):
                ex[key] = val
                sink = None
            elif key == "expect":
                # Not every rustc error has a code. `const LIMIT = 4;` gives a
                # bare "missing type for const item", and an exercise built on
                # one could previously assert nothing at all about why its
                # starter failed, so it would keep passing validation even if
                # it began failing for a completely different reason.
                if not val:
                    ex["expect"] = None
                elif val in ("test-failure", "none"):
                    # The starter must still fail; there is just no compiler
                    # message to pin. A mismatched #[should_panic], a stale
                    # doctest.
                    ex["expect"] = {"any": True}
                elif re.fullmatch(r"E\d{4}", val):
                    ex["expect"] = {"code": val}
                else:
                    ex["expect"] = {"msg": val.strip('"\'')}
                sink = None
            elif key == "hint":
                ex["hints"].append(val)
                sink = None
            elif key == "diagnose":
                sink = ("diagnose", val)
                ex["diagnose"][val] = []
            elif key == "after":
                sink = "after"
            i += 1
            continue

        emit(ln)
        i += 1

    ex["brief"] = render("\n".join(brief))
    ex["after"] = render("\n".join(after))
    ex["diagnose"] = {k: render("\n".join(v)) for k, v in ex["diagnose"].items()}
    ex["mins"] = max(2, mins_of(words_of(ex["brief"])) + len(ex["starter"].split("\n")) // 12)
    return ex


def parse_exercise_file(path):
    """One exercise or project file -> (meta, slug, lead, items).

    The single parser for anything shaped as `## N. Title` blocks: a unit's
    exercises, a project's stages, and whatever --check is pointed at. Three
    copies of this existed at various times and each one drifted in the line
    that sets _CUR, which is how glossary terms ended up filed under the wrong
    unit and then under the wrong kind.
    """
    meta, body = front_matter(path.read_text())
    slug = meta.get("unit") or meta.get("project") or path.stem
    kind = "project" if meta.get("project") else "unit"
    # inline() attributes each glossary hit to _CUR, and a chip built from the
    # wrong slug or kind links to a route that does not exist.
    _CUR["unit"] = slug
    _CUR["title"] = TITLES.get(slug, meta.get("title", slug))
    _CUR["kind"] = kind
    lead, blocks = sections(body)
    items = sorted((parse_exercise(b, i) for i, b in enumerate(blocks, 1)),
                   key=lambda e: e["n"])
    return meta, slug, lead, items


def build_exercises():
    got = {}
    d = CONTENT / "ex"
    if not d.exists():
        return got
    for path in sorted(d.glob("*.md")):
        _, slug, _, exs = parse_exercise_file(path)
        (OUT / "ex").mkdir(parents=True, exist_ok=True)
        (OUT / "ex" / f"{slug}.json").write_text(json.dumps({"unit": slug, "exercises": exs}))
        if len(exs) != PER_UNIT["exercises"]:
            raise ValueError(f"{path.name}: {len(exs)} exercises, "
                             f"the contract is {PER_UNIT['exercises']}")
        got[slug] = exs
        print(f"  ex    {slug:18s} {len(exs):3d} exercises")
    return got


# --------------------------------------------------------------------------
# projects
# --------------------------------------------------------------------------


# Tiers, so the section reads as a shelf rather than a pile. A mini is one idea
# done properly in an evening; a core project is a real program; a deep one is a
# weekend and leaves you with something you would actually reach for.
# Label, description, and the stage count the description promises. The third
# field is checked: docs/AUTHORING.md stated all three counts and nothing
# verified any of them, so a tier was a label a project could simply contradict.
# docs/AUTHORING.md states these. Every one of them held by discipline alone
# until now, and a number a build prints without checking is decoration.
PER_UNIT = {"exercises": 8, "drills": 15}
NOTE_WORDS = (1400, 2200)

TIERS = {
    "mini": ("Mini", "four stages, one idea, about twenty minutes", 4),
    "core": ("Core", "eight stages, a real program end to end", 8),
    "deep": ("Deep", "twelve stages or more, a weekend, something you would use", 12),
}
TIER_ORDER = ["mini", "core", "deep"]

DOMAINS = ["ai", "systems", "languages", "network", "graphics",
           "data", "crypto", "games", "tools", "embedded"]


def build_projects():
    """One real program, built in eight stages.

    A stage is an exercise, so this reuses the exercise parser wholesale. What a
    project adds is an introduction and the promise that stage N's starter is
    stage N-1's finished code: the reader edits one growing program rather than
    eight unrelated snippets.
    """
    got = {}
    d = CONTENT / "projects"
    if not d.exists():
        return got
    for path in sorted(d.glob("*.md")):
        meta, slug, intro_raw, stages = parse_exercise_file(path)
        intro = render(intro_raw) if intro_raw.strip() else ""

        words = words_of(intro) + sum(words_of(s["brief"]) + words_of(s["after"]) for s in stages)
        if slug in ORDER:
            # The two are merged by slug for validation and share a cache key
            # space, so a collision would silently drop a unit's exercises.
            raise ValueError(
                f"{path.name}: project slug {slug!r} collides with a unit slug"
            )
        tier = meta.get("tier", "core")
        if tier not in TIERS:
            raise ValueError(f"{path.name}: tier {tier!r} is not one of {list(TIERS)}")
        domain = meta.get("domain", "tools")
        if domain not in DOMAINS:
            raise ValueError(f"{path.name}: domain {domain!r} is not one of {DOMAINS}")
        want = TIERS[tier][2]
        if len(stages) < want or (tier != "deep" and len(stages) != want):
            raise ValueError(
                f"{path.name}: tier {tier} promises {TIERS[tier][1]}, "
                f"but this has {len(stages)} stages"
            )

        project = {
            "slug": slug,
            "title": meta.get("title", slug),
            "accent": meta.get("accent", "plum"),
            "blurb": meta.get("blurb", ""),
            "tier": tier,
            "domain": domain,
            "needs": [x.strip() for x in meta.get("needs", "").split(",") if x.strip()],
            "mins": int(meta.get("mins", 0)) or max(20, mins_of(words) + 4 * len(stages)),
            "words": words,
            "intro": intro,
            "stages": stages,
        }
        (OUT / "project").mkdir(parents=True, exist_ok=True)
        (OUT / "project" / f"{slug}.json").write_text(json.dumps(project))
        got[slug] = stages
        print(f"  proj  {slug:18s} {len(stages):3d} stages  {words:5,d} words")
    return got


# --------------------------------------------------------------------------
# drills
# --------------------------------------------------------------------------


def build_drills():
    got = {}
    d = CONTENT / "drills"
    if not d.exists():
        return got
    for path in sorted(d.glob("*.md")):
        meta, body = front_matter(path.read_text())
        slug = meta.get("unit", path.stem)
        _CUR["unit"], _CUR["title"], _CUR["kind"] = slug, TITLES.get(slug, slug), "unit"
        _, blocks = sections(body)
        qs = []
        for head, raw in blocks:
            n = int(re.match(r"^(\d+)", head.strip()).group(1))
            lines = raw.split("\n")
            stem, opts, why, sink = [], [], [], "stem"
            i = 0
            while i < len(lines):
                s = lines[i].strip()
                if FENCE.match(s):
                    _, _, i, raw = read_fence(lines, i)
                    (why if sink == "why" else stem).append(raw)
                    continue
                if s == "@why":
                    sink = "why"
                    i += 1
                    continue
                mo = re.match(r"^-\s*(\*?)\s*([A-E])\.\s+(.*)$", s)
                if mo and sink != "why":
                    opts.append({"key": mo.group(2), "text": inline(mo.group(3)),
                                 "correct": mo.group(1) == "*"})
                    i += 1
                    continue
                (why if sink == "why" else stem).append(lines[i])
                i += 1
            qs.append({
                "n": n,
                "stem": render("\n".join(stem)),
                "options": opts,
                "answer": "".join(o["key"] for o in opts if o["correct"]),
                "why": render("\n".join(why)),
            })
        qs.sort(key=lambda q: q["n"])
        (OUT / "drills").mkdir(parents=True, exist_ok=True)
        (OUT / "drills" / f"{slug}.json").write_text(json.dumps({"unit": slug, "questions": qs}))
        if len(qs) != PER_UNIT["drills"]:
            raise ValueError(f"{path.name}: {len(qs)} drills, "
                             f"the contract is {PER_UNIT['drills']}")
        got[slug] = qs
        print(f"  drill {slug:18s} {len(qs):3d} questions")
    return got


# --------------------------------------------------------------------------
# validation, the only opinion in this file the compiler can overrule
# --------------------------------------------------------------------------

PLAY = "https://play.rust-lang.org/execute"
VERSIONS = "https://play.rust-lang.org/meta/versions"


def toolchain():
    """Which rustc the exercises were validated against.

    Worth recording rather than assuming: the playground tracks stable, so the
    compiler under the exercises moves on its own every six weeks. When the
    version in the manifest and the version answering today diverge, that is
    exactly the window in which a diagnostic can change out from under an
    exercise, which is the whole reason --validate exists.
    """
    try:
        req = urllib.request.Request(VERSIONS, headers={"User-Agent": "rust-handbook-build"})
        with urllib.request.urlopen(req, timeout=15) as r:
            v = json.load(r)["stable"]["rustc"]
        return {"version": v["version"], "date": v["date"], "hash": v["hash"][:9]}
    except Exception:
        return None
CACHE = OUT / ".validate-cache.json"


def compile_once(code, tests=None):
    payload = {
        "channel": "stable",
        "mode": "debug",
        "edition": "2024",
        "crateType": "lib" if tests else "bin",
        "tests": bool(tests),
        "backtrace": False,
        "code": code + ("\n\n" + tests + "\n" if tests else ""),
    }
    req = urllib.request.Request(
        PLAY,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "rust-handbook-build"},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.load(r)
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))


def first_error_code(stderr):
    m = re.search(r"^error\[(E\d{4})\]", stderr or "", re.M)
    return m.group(1) if m else None


def first_error_line(stderr):
    """The first line that is actually an error, not cargo's "Compiling" banner."""
    return next((l for l in (stderr or "").split("\n") if l.startswith("error")),
                "unknown failure")


def ref_of(slug, ex):
    """The one spelling of a cache ref. It was written out in two places, and a
    change to the format would have silently emptied the carry-forward's set
    intersection, reporting every item as never validated."""
    return f"{slug}#{ex['n']}"


def cache_split(items):
    """(cache, refs the cache still speaks for, refs it does not).

    "The cache covers this item" means its key still matches, not merely that an
    entry exists. validate() always knew that; the carry-forward used presence
    alone, so an exercise edited since the last run counted as validated and
    replayed the finding from the version that no longer exists. That is the
    exact bug cache_key was introduced to fix, returning one layer up.
    """
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    fresh, stale = set(), set()
    for slug, exs in items.items():
        for ex in exs:
            ref = ref_of(slug, ex)
            (fresh if cache.get(ref, {}).get("key") == cache_key(ex) else stale).add(ref)
    return cache, fresh, stale


def carry(old, fresh, stale):
    """The verdict a plain build inherits: what the cache still speaks for.

    What speaks for an item is the cache, not the previous run's `ran` flag.
    Gating on the flag made it a latch: one plain build over a manifest saying
    `ran: false` and nothing short of --validate could set it back, so a false
    committed once shipped a live site whose footer named no rustc version at
    all. Carrying only the covered items matters just as much: a wholesale copy
    of the old verdict once claimed "308 validated, no findings" over stages
    nothing had ever compiled.
    """
    if not fresh:
        return {"checked": 0, "cached": 0, "findings": [], "ran": False}
    return {**old, "ran": True, "checked": 0, "cached": len(fresh),
            "findings": [f for f in old.get("findings", [])
                         if f.get("ref") in fresh],
            "unvalidated": sorted(stale)[:20],
            "unvalidated_count": len(stale)}


def cache_key(ex):
    """Everything a verdict depends on.

    The first version hashed only starter/tests/solution and the expected code,
    which meant the fix for "no @diagnose written for E0382" did not change the
    key: the author added the block, re-ran, and got the identical stale finding
    replayed out of the cache with no way to clear it short of deleting the file.
    `kind` matters too, flipping to `predict` skips the starter compile
    entirely.
    """
    payload = "\x00".join([
        ex["starter"],
        ex["tests"] or "",
        ex["solution"],
        json.dumps(ex["expect"], sort_keys=True),
        ",".join(sorted(ex["diagnose"])),
        ex["kind"],
    ])
    return hashlib.sha256(payload.encode()).hexdigest()


def expect_findings(ex, stderr):
    """Does the starter fail the way the exercise claims? Returns plain strings;
    only validate() needs them stamped with a ref, and it does that itself."""
    out = []
    got = first_error_code(stderr)
    want = ex["expect"] or {}

    if "code" in want:
        if got and got != want["code"]:
            out.append(f"starter raises {got}, exercise explains {want['code']}")
        elif not got:
            out.append(f"starter fails without an error code; {want['code']} expected")
    elif "msg" in want and want["msg"].lower() not in (stderr or "").lower():
        out.append(
            f"starter does not say {want['msg']!r}; it says {first_error_line(stderr)!r}"
        )

    if got and got not in ex["diagnose"]:
        out.append(f"no @diagnose written for {got}")
    return out


def check_exercise(ex):
    """The single definition of "this exercise is sound". Both --validate and
    --check call it, so the two runners cannot drift into grading content by
    different rulebooks, which they had already started to do."""
    out = []
    if not ex["starter"]:
        out.append("no starter")
    if not ex["tests"]:
        out.append("no tests")
    # Without this, a forgotten @expect is indistinguishable from a deliberately
    # omitted one, and the exercise asserts nothing about WHY its starter fails.
    if ex["kind"] != "predict" and not ex["expect"]:
        out.append('no @expect (use `@expect E0382`, `@expect "message"`, '
                   'or `@expect test-failure` when the starter fails a test '
                   'rather than the compiler)')

    # The starter must fail, and fail the way the exercise says it will.
    if ex["starter"] and ex["kind"] != "predict":
        r = compile_once(ex["starter"], ex["tests"])
        if r["success"]:
            out.append("starter compiles and passes; nothing to fix")
        else:
            out.extend(expect_findings(ex, r["stderr"]))

    # The solution must compile and pass every hidden test.
    if ex["solution"]:
        r = compile_once(ex["solution"], ex["tests"])
        if not r["success"]:
            err = first_error_code(r["stderr"]) or first_error_line(r["stderr"])
            out.append(f"solution does not build: {err}")
        elif ex["tests"] and "test result: ok" not in (r["stdout"] or ""):
            failed = re.findall(r"^test (\S+) \.\.\. FAILED", r["stdout"] or "", re.M)
            out.append("solution builds but fails its own tests: " + (", ".join(failed) or "?"))
    else:
        out.append("no solution given")

    return out


def validate(exercises, workers=4):
    """Compile every starter and every solution, and hold the content to what it
    claims. A starter that no longer fails, or fails with a different code than
    the note explains, is a broken exercise even though nothing crashed.

    446 round-trips at roughly 1.5s each is 11 minutes of sitting in urlopen, so
    they run four at a time. Concurrency does not increase the load on the
    playground, the same 446 requests either way, only its density, and the
    content hash means an unchanged rebuild sends none at all. Four is chosen to
    stay comfortably inside what one ordinary user of a free service looks like.
    """
    cache, fresh, _ = cache_split(exercises)
    findings, checked, cached = [], 0, 0
    todo = []

    for slug, exs in exercises.items():
        for ex in exs:
            ref = ref_of(slug, ex)
            if ref in fresh:
                cached += 1
                findings.extend(cache[ref]["findings"])
            else:
                todo.append((ref, cache_key(ex), ex))

    def record(ref, key, local):
        cache[ref] = {"key": key, "findings": local}
        findings.extend(local)
        print(f"    {'FAIL' if local else 'ok  '}  {ref}"
              + ("".join(f"\n           {f['what']}" for f in local)))

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(check_exercise, ex): (ref, key)
                       for ref, key, ex in todo}
            for fut in concurrent.futures.as_completed(futures):
                ref, key = futures[fut]
                checked += 1
                record(ref, key, [{"ref": ref, "what": w} for w in fut.result()])
    finally:
        # Written whatever happens. Losing eleven minutes of someone else's CPU
        # to a Ctrl-C, and then asking the same free service for it again, is
        # not a reasonable thing to do.
        CACHE.write_text(json.dumps(cache))

    return {"checked": checked, "cached": cached, "findings": findings}


# --------------------------------------------------------------------------
# manifest
# --------------------------------------------------------------------------


def build_manifest(units, exercises, drills, projects, audit):
    entries = []
    for i, (slug, title, accent, blurb) in enumerate(TRACK):
        u = units.get(slug)
        exs = exercises.get(slug, [])
        entries.append({
            "slug": slug,
            "num": i,
            "title": title,
            "accent": accent,
            "blurb": u["blurb"] if u and u.get("blurb") else blurb,
            "ready": bool(u),
            "words": u["words"] if u else 0,
            "mins": u["mins"] if u else 0,
            "exercises": len(exs),
            "drills": len(drills.get(slug, [])),
        })

    project_entries = []
    for slug in sorted(projects):
        pj = json.loads((OUT / "project" / f"{slug}.json").read_text())
        project_entries.append({k: pj[k] for k in
                                ("slug", "title", "accent", "blurb", "tier", "domain",
                                 "needs", "mins", "words")}
                               | {"stages": len(pj["stages"])})

    # Ordered by tier, then by how far into the track their prerequisites reach,
    # so reading the list top to bottom is a sensible order to actually do them in.
    project_entries.sort(key=lambda p: (
        TIER_ORDER.index(p["tier"]),
        max([ORDER.get(n, 0) for n in p["needs"]] or [0]),
        p["title"],
    ))

    manifest = {
        "title": "Rust Handbook",
        "units": entries,
        "projects": project_entries,
        "tiers": {k: {"name": v[0], "note": v[1]} for k, v in TIERS.items()},
        "totals": {
            "units": len(entries),
            "ready": sum(1 for e in entries if e["ready"]),
            "words": sum(e["words"] for e in entries) + sum(p["words"] for p in project_entries),
            "unit_words": sum(e["words"] for e in entries),
            # Reading minutes, derived from words the same way for both. A
            # project's own `mins` is how long the whole build takes, which is a
            # different quantity and lives in `project_mins`; adding it here
            # would put "17 hours of reading" under a word count of 72,000.
            "mins": sum(e["mins"] for e in entries)
                    + sum(mins_of(p["words"]) for p in project_entries),
            "project_mins": sum(p["mins"] for p in project_entries),
            "exercises": sum(e["exercises"] for e in entries),
            "drills": sum(e["drills"] for e in entries),
            "projects": len(project_entries),
            "stages": sum(p["stages"] for p in project_entries),
        },
        "audit": audit,
        "edition": "2024",
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest))

    # Section titles and concept lists are read by search and by nothing else,
    # and they were 45% of a file every page view downloads. They live in their
    # own document now, fetched only if someone actually searches.
    (OUT / "search.json").write_text(json.dumps({
        "units": [{
            "slug": slug,
            "sections": [p["title"] for p in units[slug]["parts"]],
            "concepts": units[slug]["concepts"],
        } for slug, *_ in TRACK if slug in units],
    }))
    return manifest


def onboarding():
    """The first thing an assistant reads after being handed llms.txt.

    Someone who pastes this file into an assistant wants one of three things and
    the assistant cannot tell which from the file alone. Guessing wastes the
    turn: it explains ownership to someone who wanted to fork the design, or
    starts scaffolding a project for someone who wanted to read unit 5. So the
    file opens by naming the three, and by saying what to ask for each.
    """
    return [
        "## Start here",
        "",
        f"Repository: {SITE}",
        f"Live: {LIVE}",
        "",
        "Someone has handed you this file. They want one of three things and this",
        "file cannot tell you which. Ask before doing anything else, in one short",
        "message, and offer these three:",
        "",
        "1. **Build a handbook like this one for another subject.** Same design,",
        "   different mascot, different topics, different colours.",
        "2. **Work on this handbook.** A unit, a project, a feature, a bug.",
        "3. **Learn Rust with it.** Use the units, exercises and drills as the",
        "   material for a course you run with them.",
        "",
        "Then follow the path they pick. Do not do more than one.",
        "",
        "### 1. Build your own",
        "",
        "Read `## Build your own` at the end of this file. It is the whole",
        "reproduction guide: palette, type scale, layout rules, architecture,",
        "content pipeline and the order to build in. Before writing anything, ask:",
        "",
        "- What is the subject, and what is the sequence of units? A handbook needs",
        "  a spine where each unit depends on the ones before it.",
        "- What can execute the learner's work and complain specifically about it?",
        "  A compiler, a type checker, a linter, a test runner, a solver. This is",
        "  the load bearing question. If the answer is nothing, say so plainly: the",
        "  shape is wasted without it, and a quiz site is the honest alternative.",
        "- What is the mascot, and what is the accent colour? Warm or cool decides",
        "  which way the neutrals rotate.",
        "- Who is the reader, and what do they already know?",
        "",
        "Then work in the order the guide gives: shell, palette, mascot, manifest,",
        "one complete unit, the execution backend, then the rest of the content.",
        "Do not restyle first. Do not write twenty units before one of them is",
        "finished end to end.",
        "",
        "### 2. Work on this handbook",
        "",
        "- `docs/AUTHORING.md` is the contract for a unit or a project. It is not a",
        "  suggestion; the build enforces most of it.",
        "- `CONTRIBUTING.md` names the one command that runs every check:",
        "  `./release.sh --check`, and `--net` to also compile every exercise.",
        "- An exercise is finished when `python3 build.py --check content/ex/<slug>.md`",
        "  prints `N clean`. Never `--validate` for a single file.",
        "- If you touched `content/`, commit the regenerated `data/` with it.",
        "- Ask which unit or feature, and whether they want the whole unit or just",
        "  the exercises. Read the three `05-ownership` files first; they are the",
        "  reference.",
        "",
        "### 3. Learn Rust with it",
        "",
        "- Ask what they already know, what they want to build, and how long they",
        "  have. Those three answers pick the route through the track.",
        "- The units below are in dependency order. Do not skip ahead of a unit's",
        "  `needs`.",
        "- Every unit is a note, eight exercises and fifteen drills. The exercises",
        "  compile for real, so send them to the workbench rather than checking",
        "  their code yourself.",
        "- There are hints and no answers, deliberately. Match that. Give the",
        "  smallest push that makes them see the error, not the corrected code.",
        "",
    ]


def build_your_own(path=None):
    """docs/BUILD-YOUR-OWN.md, inlined so the assistant needs no second fetch.

    Linked rather than copied would be tidier, and useless: whoever pastes this
    file into an assistant is usually somewhere the assistant cannot fetch from.
    One authored source, two destinations, headings demoted one level so the
    document still has exactly one h1.
    """
    src = (path or ROOT / "docs" / "BUILD-YOUR-OWN.md").read_text().strip().splitlines()
    body, i = [], 1                           # its own h1 becomes the section head
    while i < len(src):
        # read_fence, not a three-backtick toggle: a guide about writing this
        # repo's markdown is exactly where a ````markdown block appears, and a
        # scanner that closes on the first inner fence would then demote every
        # heading after it on the wrong side of the block. That bug is already
        # written down in read_fence's docstring; do not rediscover it here.
        if FENCE.match(src[i].strip()):
            _, _, i, raw = read_fence(src, i)
            body += raw.splitlines()
            continue
        body.append("#" + src[i] if src[i].startswith("#") else src[i])
        i += 1
    return ["", "## Build your own", "",
            f"The full text of [docs/BUILD-YOUR-OWN.md]({SITE}/blob/main/docs/BUILD-YOUR-OWN.md), "
            "so you can act on it without fetching anything.", *body, ""]


def build_llms_txt(m):
    """A description of the whole handbook that an assistant can read in one go.

    Follows the llmstxt.org shape: a title, one paragraph of what this is, then
    linked sections. Generated from the manifest rather than written by hand, so
    it cannot drift from the content the way a hand-kept summary does.
    """
    t = m["totals"]
    tc = (m.get("audit") or {}).get("toolchain") or {}
    out = [
        "# Rust Handbook",
        "",
        f"> Learn Rust by fighting the compiler. {t['units']} units and "
        f"{len(m['projects'])} projects, {t['words']:,} words, and "
        f"{t['exercises'] + t['stages']} exercises that compile for real on "
        f"play.rust-lang.org. When rustc rejects your code you get its actual "
        f"diagnostic and, beside it, a written reading of that specific error.",
        "",
        "Every exercise ships a `diagnose` map from error code to prose, so the",
        "explanation you see is about the error you hit rather than the topic you",
        "are on. `build.py --validate` compiles every starter and solution and",
        "fails the build if a starter stops raising the code its explanation",
        "describes, which is what stops the content rotting when rustc changes its",
        "diagnostics.",
        "",
        f"Built and verified against rustc {tc.get('version', 'stable')}, "
        f"edition {m.get('edition', '2024')}. No dependencies: no npm, no CDN, no",
        "framework. `build.py` turns authored markdown into JSON once and the",
        "browser routes and paints.",
        "",
    ]
    out += onboarding()
    out += [
        "## Units",
        "",
        "The track, in order. Each unit is a note, eight exercises and fifteen drills.",
        "",
    ]
    for u in m["units"]:
        if not u["ready"]:
            continue
        out.append(f"- [{u['num']:02d} {u['title']}]({SITE}/blob/main/content/units/{u['slug']}.md): "
                   f"{u['blurb']}")

    out += ["", "## Projects", "",
            "One real program each, built in stages that accumulate. "
            f"{t['project_mins'] // 60}h {t['project_mins'] % 60:02d}m of building in total.",
            ""]
    for pj in m["projects"]:
        out.append(f"- [{pj['title']}]({SITE}/blob/main/content/projects/{pj['slug']}.md) "
                   f"({pj['tier']}, {pj['domain']}, {pj['stages']} stages): {pj['blurb']}")

    out += ["", "## How the content is written", "",
            f"- [Build your own]({SITE}/blob/main/docs/BUILD-YOUR-OWN.md): the design "
            "system, the architecture and the order to build a handbook like this one "
            "for another subject. Inlined in full at the end of this file",
            f"- [Authoring guide]({SITE}/blob/main/docs/AUTHORING.md): the contract every "
            "unit and project follows, including the exercise format and the prose rules",
            f"- [Sources]({SITE}/blob/main/docs/SOURCES.md): which of the twelve official "
            "Rust books each unit draws on",
            f"- [Design]({SITE}/blob/main/docs/superpowers/specs/2026-08-29-rust-handbook-design.md): "
            "why the platform is shaped this way",
            "",
            "## Optional", "",
            f"- [build.py]({SITE}/blob/main/build.py): content to JSON, and the validator",
            f"- [assets/workbench.js]({SITE}/blob/main/assets/workbench.js): the Rust "
            "tokenizer, the playground client and the diagnostics parser",
            f"- [assets/vim.js]({SITE}/blob/main/assets/vim.js): the editor's Vim mode",
            ""]

    out += build_your_own()

    text = "\n".join(out)
    (ROOT / "llms.txt").write_text(text)
    return text


def build_glossary():
    terms = []
    for key, e in sorted(GLOSSARY.items()):
        used = sorted(GLOSS_USE.get(key, []))
        terms.append({
            "t": e["t"],
            "p": e["p"],
            "x": e.get("x", ""),
            "in": [{"s": slug, "n": name, "k": kind} for slug, name, kind in used if slug],
        })
    (OUT / "glossary.json").write_text(json.dumps({"terms": terms}))
    return terms


# --------------------------------------------------------------------------


def check_one(path):
    """Validate a single exercise file without touching data/.

    Parallel authors each run this on their own file. A full --validate writes
    the shared manifest and cache, so several at once would race; this writes
    nothing and is safe to run concurrently. The verdict comes from the same
    check_exercise() that --validate uses, so the two cannot disagree.
    """
    p = Path(path)
    if not p.exists():
        print(f"no such file: {p}")
        return 1

    _, slug, _, exs = parse_exercise_file(p)
    print(f"{slug}: {len(exs)} exercises")

    findings = []
    for ex in exs:
        local = check_exercise(ex)
        print(f"  {'FAIL' if local else 'ok  '}  {ex['n']}. {ex['title']}"
              + "".join(f"\n          {x}" for x in local))
        findings.extend(local)

    if findings:
        print(f"\n{len(findings)} finding(s). Fix and re-run.")
        return 1
    print(f"\n{len(exs)} clean")
    return 0


def main():
    if "--check" in sys.argv:
        i = sys.argv.index("--check")
        return check_one(sys.argv[i + 1])

    OUT.mkdir(exist_ok=True)
    load_glossary()
    print(f"glossary: {len(GLOSSARY)} terms")

    units = build_units()
    exercises = build_exercises()
    projects = build_projects()
    drills = build_drills()

    # data/ is a pure function of content/. Without this a deleted source left
    # its JSON behind, and CI's `git status --porcelain data/` can only report
    # files the build wrote, never one it should have removed: an abandoned
    # test project stayed live on the site long after its source was gone.
    for sub, keep in (("unit", units), ("ex", exercises),
                      ("project", projects), ("drills", drills)):
        for f in (OUT / sub).glob("*.json"):
            if f.stem not in keep:
                f.unlink()
                print(f"removed data/{sub}/{f.name}, its source is gone")

    # A rebuild that does not validate carries the previous verdict forward
    # rather than erasing it. Editing a paragraph is not evidence that the
    # exercises stopped compiling, and blanking the record would take the
    # toolchain the UI reports with it.
    audit = {"checked": 0, "cached": 0, "findings": [], "ran": False}
    prev = OUT / "manifest.json"
    if prev.exists():
        try:
            old = json.loads(prev.read_text()).get("audit", {})
            audit = carry(old, *cache_split({**exercises, **projects})[1:])
        except (json.JSONDecodeError, OSError):
            pass

    if "--validate" in sys.argv:
        tc = toolchain()
        print(f"validating against play.rust-lang.org, rustc "
              f"{tc['version'] if tc else 'unknown'} …")
        audit = validate({**exercises, **projects})
        # After validate(), which returns a fresh dict.
        audit["ran"] = True
        audit["unvalidated"] = []
        audit["unvalidated_count"] = 0
        audit["toolchain"] = tc

    _CUR["unit"] = _CUR["title"] = None
    _CUR["kind"] = "unit"
    terms = build_glossary()
    m = build_manifest(units, exercises, drills, projects, audit)
    llms = build_llms_txt(m)

    t = m["totals"]
    print(f"llms.txt: {len(llms.splitlines())} lines")
    print(
        f"\n{t['ready']}/{t['units']} units · {t['words']:,} words · "
        f"{t['exercises']} exercises · {t['stages']} project stages · "
        f"{t['drills']} drills · {len(terms)} terms"
    )
    if audit["ran"] and "--validate" not in sys.argv:
        n = audit.get("unvalidated_count", 0)
        print(f"verdict carried from the last --validate"
              + (f", {n} item(s) added since" if n else ", covering everything"))

    if audit["ran"]:
        tc = audit.get("toolchain")
        if tc:
            print(f"toolchain: rustc {tc['version']} ({tc['date']})")
        n = len(audit["findings"])
        print(f"validated {audit['checked']} (+{audit['cached']} cached) · "
              + (f"{n} finding(s)" if n else "all clean"))
        for f in audit["findings"]:
            print(f"  ! {f['ref']}: {f['what']}")
        return 1 if audit["findings"] else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
