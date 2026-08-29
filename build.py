#!/usr/bin/env python3
"""Rust Handbook — content/ -> data/.

Everything computable once is computed here: word counts, reading minutes,
heading ids, the table of contents, the glossary's back-references, and — with
--validate — whether each exercise actually behaves the way its author claimed.

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
    ("11-collections",  "Collections",                "moss",   "Vec, String, HashMap, VecDeque, BTreeMap — what each one costs and when it reallocates."),
    ("12-errors",       "Error handling",             "clay",   "Result, `?`, and the difference between an error you handle and a bug you panic on."),
    ("13-generics",     "Generics",                   "slate",  "Monomorphisation: what the compiler actually emits, and why generic Rust costs nothing at runtime."),
    ("14-traits",       "Traits",                     "slate",  "Shared behaviour, coherence, blanket impls, and static versus dynamic dispatch."),
    ("15-lifetimes",    "Lifetimes",                  "ferris", "Not how long a value lives — a claim the compiler checks. Elision, and why `'a` is not a duration."),
    ("16-closures",     "Closures",                   "plum",   "Fn, FnMut, FnOnce: three traits that describe what a closure does to what it captured."),
    ("17-iterators",    "Iterators",                  "plum",   "Lazy by construction, fused by adapters, and compiled down to the loop you would have written."),
    ("18-smart-ptr",    "Smart pointers",             "plum",   "Box, Rc, RefCell: moving ownership to the heap, sharing it, and moving the borrow check to runtime."),
    ("19-modules",      "Modules and crates",         "slate",  "Paths, visibility, `use`, and how a workspace is laid out."),
    ("20-testing",      "Testing and docs",           "moss",   "`#[test]`, integration tests, and doc comments that are compiled and run."),
    ("21-concurrency",  "Concurrency",                "rust",   "Send and Sync, threads, channels, and Arc<Mutex<T>> — fearless because the checker is watching."),
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
        # build, with a traceback naming no file — leaving the author to bisect
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
_CUR = {"unit": None, "title": None}


def load_glossary():
    """The shared file, then one optional file per unit.

    Per-unit files exist so several authors can add terms at once without
    editing — and corrupting — one shared JSON document. Later files win on a
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
                (_CUR["unit"], _CUR["title"])
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
    fences and all — because a caller that only wants to ROUTE the block must
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
# reader has read a character of it. Any other info string is just a label —
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
# the paragraph loop so the two cannot drift apart unnoticed — they already had.
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
                # part's markup twice — 118 KB of 705 KB.
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
            # author's definition of done — and is invisible in the app, because
            # only TRACK produces manifest entries.
            raise ValueError(
                f"{path.name}: slug {slug!r} is not in TRACK. "
                f"Add it to build.py's TRACK list or fix the slug."
            )
        for key, want in (("num", ORDER[slug]), ("title", TITLES[slug]), ("accent", ACCENTS[slug])):
            got = meta.get(key)
            if got is not None and str(got) != str(want):
                print(f"  ! {path.name}: front-matter {key}={got!r} ignored; TRACK says {want!r}")
        _CUR["unit"], _CUR["title"] = slug, TITLES[slug]

        seen, toc = {}, []
        lead, parts = split_parts(body, seen, toc)
        w = words_of(lead) + sum(p["words"] for p in parts)

        unit = {
            "slug": slug,
            "num": ORDER[slug],
            "title": TITLES[slug],
            "blurb": meta.get("blurb", ""),
            "concepts": [c.strip() for c in meta.get("concepts", "").split(",") if c.strip()],
            "needs": [c.strip() for c in meta.get("needs", "").split(",") if c.strip()],
            "words": w,
            "mins": mins_of(w),
            "toc": toc,
            "lead": lead,
            "parts": parts,
        }
        (OUT / "unit").mkdir(parents=True, exist_ok=True)
        (OUT / "unit" / f"{slug}.json").write_text(json.dumps(unit))
        units[slug] = unit
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
        """Route one chunk to the active sink. Written twice — once for prose,
        once for fences — the two copies disagreed, and a fence inside a
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
                # starter failed — so it would keep passing validation even if
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
    """One `content/ex/*.md` -> (slug, exercises). Shared by the builder and by
    --check, which used to keep its own copy of this and quietly dropped the
    _CUR line, misfiling every glossary term it saw."""
    meta, body = front_matter(path.read_text())
    slug = meta.get("unit", path.stem)
    # inline() attributes each glossary hit to _CUR. Leaving it pointing at the
    # last unit build_units() saw made every term bolded in an exercise or drill
    # claim to live in whichever unit sorted last.
    _CUR["unit"], _CUR["title"] = slug, TITLES.get(slug, slug)
    _, blocks = sections(body)
    exs = [parse_exercise(b, i) for i, b in enumerate(blocks, 1)]
    exs.sort(key=lambda e: e["n"])
    return slug, exs


def build_exercises():
    got = {}
    d = CONTENT / "ex"
    if not d.exists():
        return got
    for path in sorted(d.glob("*.md")):
        slug, exs = parse_exercise_file(path)
        (OUT / "ex").mkdir(parents=True, exist_ok=True)
        (OUT / "ex" / f"{slug}.json").write_text(json.dumps({"unit": slug, "exercises": exs}))
        got[slug] = exs
        print(f"  ex    {slug:18s} {len(exs):3d} exercises")
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
        _CUR["unit"], _CUR["title"] = slug, TITLES.get(slug, slug)
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
        got[slug] = qs
        print(f"  drill {slug:18s} {len(qs):3d} questions")
    return got


# --------------------------------------------------------------------------
# validation — the only opinion in this file the compiler can overrule
# --------------------------------------------------------------------------

PLAY = "https://play.rust-lang.org/execute"
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


def cache_key(ex):
    """Everything a verdict depends on.

    The first version hashed only starter/tests/solution and the expected code,
    which meant the fix for "no @diagnose written for E0382" did not change the
    key: the author added the block, re-ran, and got the identical stale finding
    replayed out of the cache with no way to clear it short of deleting the file.
    `kind` matters too — flipping to `predict` skips the starter compile
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
    different rulebooks — which they had already started to do."""
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
    playground — the same 446 requests either way — only its density, and the
    content hash means an unchanged rebuild sends none at all. Four is chosen to
    stay comfortably inside what one ordinary user of a free service looks like.
    """
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    findings, checked, cached = [], 0, 0
    todo = []

    for slug, exs in exercises.items():
        for ex in exs:
            ref, key = f"{slug}#{ex['n']}", cache_key(ex)
            if cache.get(ref, {}).get("key") == key:
                cached += 1
                findings.extend(cache[ref]["findings"])
            else:
                todo.append((ref, key, ex))

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
        # to a Ctrl-C — and then asking the same free service for it again — is
        # not a reasonable thing to do.
        CACHE.write_text(json.dumps(cache))

    return {"checked": checked, "cached": cached, "findings": findings}


# --------------------------------------------------------------------------
# manifest
# --------------------------------------------------------------------------


def build_manifest(units, exercises, drills, audit):
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
            "parts": len(u["parts"]) if u else 0,
            "exercises": len(exs),
            "drills": len(drills.get(slug, [])),
        })

    manifest = {
        "title": "Rust Handbook",
        "units": entries,
        "totals": {
            "units": len(entries),
            "ready": sum(1 for e in entries if e["ready"]),
            "words": sum(e["words"] for e in entries),
            "mins": sum(e["mins"] for e in entries),
            "exercises": sum(e["exercises"] for e in entries),
            "drills": sum(e["drills"] for e in entries),
            "terms": len(GLOSSARY),
        },
        "audit": audit,
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


def build_glossary():
    terms = []
    for key, e in sorted(GLOSSARY.items()):
        used = sorted(GLOSS_USE.get(key, []))
        terms.append({
            "t": e["t"],
            "p": e["p"],
            "x": e.get("x", ""),
            "in": [{"s": s, "n": n} for s, n in used if s],
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

    slug, exs = parse_exercise_file(p)
    print(f"{slug}: {len(exs)} exercises")

    findings = []
    for ex in exs:
        local = check_exercise(ex)
        print(f"  {'FAIL' if local else 'ok  '}  {ex['n']}. {ex['title']}"
              + "".join(f"\n          {x}" for x in local))
        findings.extend(local)

    if findings:
        print(f"\n{len(findings)} finding(s) — fix and re-run")
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
    drills = build_drills()

    audit = {"checked": 0, "cached": 0, "findings": [], "ran": False}
    if "--validate" in sys.argv:
        print("validating against play.rust-lang.org …")
        audit = validate(exercises)
        audit["ran"] = True

    _CUR["unit"] = _CUR["title"] = None
    terms = build_glossary()
    m = build_manifest(units, exercises, drills, audit)

    t = m["totals"]
    print(
        f"\n{t['ready']}/{t['units']} units · {t['words']:,} words · "
        f"{t['exercises']} exercises · {t['drills']} drills · {len(terms)} terms"
    )
    if audit["ran"]:
        n = len(audit["findings"])
        print(f"validated {audit['checked']} (+{audit['cached']} cached) · "
              + (f"{n} finding(s)" if n else "all clean"))
        for f in audit["findings"]:
            print(f"  ! {f['ref']}: {f['what']}")
        return 1 if audit["findings"] else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
