/* The workbench: everything that touches Rust source text.
 *
 * Four things live here, and they are together because they all know how Rust
 * is spelled:
 *
 *   mountEditor(host, code, cb) -> a live editor over that highlighter
 *   run(code, {tests})          -> the real compiler, on play.rust-lang.org
 *   parse(stderr, userLines)    -> diagnostics we can render as objects
 *
 * Exposed as one global, `WB`, because index.html loads plain scripts in order
 * and two files sharing a top-level `const esc` would be a redeclaration error.
 */

const WB = (() => {
'use strict';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ===================================================================== */
/* the tokenizer                                                         */
/* ===================================================================== */

/* Two keyword classes rather than one. The first is structure, the words that
   tell you what kind of thing you are looking at. The second is the modifiers,
   which in Rust carry most of the meaning a newcomer misses: `mut`, `ref`,
   `move`, `dyn`. Colouring them apart makes `&mut` visibly different from `&`,
   which is the single most useful thing highlighting can do in this language. */
const KW = new Set(('as break const continue crate else enum extern false fn for if ' +
  'let loop match mod return self Self struct super trait true type use while ' +
  'macro_rules union yield').split(' '));

const KW2 = new Set(('async await dyn impl in move mut pub ref static unsafe where ' +
  'box try').split(' '));

const PRIM = new Set(('i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 ' +
  'bool char str').split(' '));

/* One pass, one regex, left to right. Order inside the alternation is the whole
   correctness argument: a char literal must be tried before a lifetime or `'a'`
   reads as the lifetime `'a` followed by a stray quote. */
const TOK = new RegExp([
  /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/,                                   // 1 comments
  /(r#"[\s\S]*?"#|r"[^"]*"|b?"(?:\\.|[^"\\])*")/,                    // 2 strings
  /('(?:\\.|[^'\\])')/,                                              // 3 char literals
  /('[a-zA-Z_][a-zA-Z0-9_]*)/,                                       // 4 lifetimes
  /(#!?\[[^\]]*\])/,                                                 // 5 attributes
  /(\b(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)(?:[iuf](?:8|16|32|64|128|size))?)/, // 6 numbers
  /([A-Za-z_][A-Za-z0-9_]*!)/,                                       // 7 macros
  /([A-Za-z_][A-Za-z0-9_]*)/,                                        // 8 identifiers
].map((r) => r.source).join('|'), 'g');

function hlRust(src) {
  let out = '', last = 0, m;
  TOK.lastIndex = 0;
  while ((m = TOK.exec(src)) !== null) {
    out += esc(src.slice(last, m.index));
    const t = m[0];
    let cls = null;

    if (m[1]) cls = 't-cmt';
    else if (m[2] || m[3]) cls = 't-str';
    else if (m[4]) cls = 't-life';
    else if (m[5]) cls = 't-attr';
    else if (m[6]) cls = 't-num';
    else if (m[7]) cls = 't-mac';
    else if (m[8]) {
      if (KW.has(t)) cls = 't-kw';
      else if (KW2.has(t)) cls = 't-kw2';
      else if (PRIM.has(t) || /^[A-Z]/.test(t)) cls = 't-type';
      // A bare identifier immediately followed by `(` is being called.
      else if (src[TOK.lastIndex] === '(') cls = 't-fn';
    }

    out += cls ? `<span class="${cls}">${esc(t)}</span>` : esc(t);
    last = TOK.lastIndex;
  }
  return out + esc(src.slice(last));
}

/* ===================================================================== */
/* the compiler                                                          */
/* ===================================================================== */

const PLAY = 'https://play.rust-lang.org/execute';
const VERSIONS = 'https://play.rust-lang.org/meta/versions';

/* Which rustc is answering right now. Fetched once, lazily, and never blocking
   a run: if it fails you simply do not get a version badge. */
let _tc = null;
function toolchain() {
  // The promise is cached, not the result. Caching the result meant two callers
  // in flight before it resolved (the footer and the workbench) each fetched.
  if (!_tc) {
    _tc = fetch(VERSIONS)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return null;
        const v = d.stable.rustc;
        return { version: v.version, date: v.date, hash: String(v.hash).slice(0, 9) };
      })
      .catch(() => { _tc = null; return null; });
  }
  return _tc;
}

/* Hidden tests are appended, never prepended, so that every line number rustc
   reports about the reader's own code still points at the line they are
   looking at. Anything past `userLines` came from the tests. */
function assemble(code, tests) {
  return {
    source: tests ? code + '\n\n' + tests + '\n' : code,
    userLines: code.split('\n').length,
  };
}

async function run(code, { tests = null, edition = '2024' } = {}) {
  const { source, userLines } = assemble(code, tests);
  let res;
  try {
    res = await fetch(PLAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'stable',
        mode: 'debug',
        edition,
        crateType: tests ? 'lib' : 'bin',
        tests: !!tests,
        backtrace: false,
        code: source,
      }),
    });
  } catch (e) {
    // Naming the network is the whole point: a silent failure here reads as
    // "my code is so broken it did not even produce an error".
    throw new Error('offline');
  }
  if (!res.ok) throw new Error('playground returned ' + res.status);
  const out = await res.json();
  return { ...out, userLines };
}

/* ===================================================================== */
/* reading what rustc said                                               */
/* ===================================================================== */

const RE_DIAG = /^(error|warning)(?:\[(E\d{4})\])?: (.+)$/;
const RE_LOC = /^\s*-->\s+src\/\w+\.rs:(\d+):(\d+)/;
const RE_TEST = /^test (\S+) \.\.\. (ok|FAILED|ignored)$/;

/* Compiler diagnostics arrive on stderr; the test harness reports on stdout.
   Getting that backwards silently produces a run that "passed" because no test
   was found, so this takes the whole result object rather than a string and
   reads each stream from the right place.

   rustc's output is a stream of blocks: a headline, then an indented body that
   may contain the location. Walk it linearly and close each block when the next
   headline starts. Everything we cannot classify is still kept verbatim, because
   the raw text stays available to the reader. */
function parse(res) {
  const stderr = res.stderr || '';
  const stdout = res.stdout || '';
  const userLines = res.userLines ?? Infinity;
  const lines = String(stderr).split('\n');
  const errors = [], warnings = [], tests = [];
  let cur = null;

  const close = () => {
    if (!cur) return;
    cur.raw = cur.body.join('\n');
    (cur.kind === 'error' ? errors : warnings).push(cur);
    cur = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];

    const d = RE_DIAG.exec(ln);
    if (d) {
      close();
      // Cargo's own bookkeeping is not a diagnostic. Dropping it matters: a
      // reader shown "generated 1 warning (run `cargo fix`)" as a numbered
      // finding goes looking for a second problem that does not exist.
      if (/^aborting due to|^could not compile|previous error|generated \d+ warning/.test(d[3])) continue;
      cur = { kind: d[1], code: d[2] || null, msg: d[3], line: null, col: null, body: [ln] };
      continue;
    }

    if (cur) {
      cur.body.push(ln);
      if (cur.line === null) {
        const loc = RE_LOC.exec(ln);
        if (loc) {
          cur.line = +loc[1];
          cur.col = +loc[2];
          cur.inTests = cur.line > userLines;
        }
      }
    }
  }
  close();

  // The test harness writes to stdout, not stderr. `test name ... ok` per test,
  // then a failures section carrying each panic.
  for (const ln of String(stdout).split('\n')) {
    const t = RE_TEST.exec(ln);
    if (t) tests.push({ name: t[1], ok: t[2] === 'ok', ignored: t[2] === 'ignored', panic: null });
  }

  // Panic messages arrive in their own section, keyed by test name.
  const panicRe = /---- (\S+) stdout ----\n([\s\S]*?)(?=\n----|\n\nfailures:|\n\ntest result:|$)/g;
  let p;
  while ((p = panicRe.exec(stdout)) !== null) {
    const hit = tests.find((x) => x.name === p[1]);
    if (hit) {
      const m = /panicked at [^\n]*\n([\s\S]*?)(?:\nnote: run with|$)/.exec(p[2]);
      hit.panic = (m ? m[1] : p[2]).trim().split('\n').slice(0, 4).join('\n');
    }
  }

  return { errors, warnings, tests };
}

/* The offending line, echoed from the reader's own buffer with a caret under
   the column rustc named. Showing it here rather than making them count lines
   in the editor is most of what a good error display does. */
function snippet(code, line, col) {
  const src = code.split('\n');
  if (!line || line > src.length) return '';
  const text = src[line - 1] ?? '';
  const width = String(line).length;
  const pad = ' '.repeat(width);
  const caretPad = ' '.repeat(Math.max(0, (col || 1) - 1));
  return `<div class="snip"><pre><code>${
    `${pad} |\n${line} | ${hlRust(text)}\n${pad} | ${caretPad}<span class="caret">^</span>`
  }</code></pre></div>`;
}

/* ===================================================================== */
/* the editor                                                            */
/* ===================================================================== */

const TAB = '    ';

/* A textarea with transparent text laid exactly over a highlighted <pre>. The
   caret and the selection are the textarea's; every visible glyph is the pre's.
   They stay aligned only while they agree on font, size, line-height, padding,
   tab-size and wrapping, all of which is asserted in the stylesheet, not here.
   The one metric CSS cannot settle is width, because the textarea cannot size
   itself to its longest line, so that gets pushed across after each paint. */
function mountEditor(host, starter, onRun) {
  host.innerHTML =
    `<div class="gutter"></div>` +
    `<div class="stack"><pre class="hl" aria-hidden="true"></pre>` +
    `<textarea spellcheck="false" autocapitalize="off" autocomplete="off" ` +
    `autocorrect="off" wrap="off" aria-label="Rust source"></textarea></div>` +
    `<div class="vimbadge" hidden></div>`;

  const gutter = host.querySelector('.gutter');
  const pre = host.querySelector('pre.hl');
  const ta = host.querySelector('textarea');
  const badge = host.querySelector('.vimbadge');
  let errLines = [];
  let lastLines = -1;
  let lastErrs = '';
  let relTo = null;   // cursor line for relative numbering, or null for absolute

  ta.value = starter;

  let lastHl = null;

  function paint() {
    const v = ta.value;
    // Only re-highlight when the text actually changed. paint() runs on every
    // keystroke AND on every consumed vim key, and most vim keys are motions
    // that change nothing. On the largest project stage the highlight is 1.4 ms
    // of JS plus a 62 KB innerHTML parse and ~4000 nodes rebuilt, per key.
    if (v !== lastHl) {
      // A trailing newline collapses in a <pre>, so the last line loses its row
      // and everything below the caret drifts up by one. One space fixes it.
      pre.innerHTML = hlRust(v) + (v.endsWith('\n') ? ' ' : '');
      lastHl = v;
    }

    // The gutter depends only on the line count and the error set, neither of
    // which changes on the overwhelming majority of keystrokes. Rebuilding up to
    // 53 <div>s per character typed was pure waste.
    const n = v.split('\n').length;
    const errs = errLines.join(',') + '|' + relTo;
    if (n !== lastLines || errs !== lastErrs) {
      let g = '';
      for (let i = 1; i <= n; i++) {
        const cls = (errLines.includes(i) ? ' err' : '')
          + (relTo !== null && i === relTo + 1 ? ' cur' : '');
        const label = relTo === null || i === relTo + 1 ? i : Math.abs(i - 1 - relTo);
        g += `<div class="gl${cls}">${label}</div>`;
      }
      gutter.innerHTML = g;
      lastLines = n;
      lastErrs = errs;
    }

    // Reading scrollWidth right after an innerHTML write forces a synchronous
    // layout; deferring it keeps that off the keystroke's critical path.
    requestAnimationFrame(() => { ta.style.width = pre.scrollWidth + 'px'; });
  }

  /* Vim mode, if the reader has it on. It intercepts keys before the handlers
     below, so Tab and Enter behave normally in insert mode and are Vim's in
     normal mode. The preference is per-browser and survives navigation. */
  const vim = Vim.attach(ta, {
    paint, onRun, badge,
    gutter(line) { relTo = line; },
  });

  ta.addEventListener('input', paint);
  ta.addEventListener('scroll', () => { pre.parentElement.scrollLeft = ta.scrollLeft; });

  ta.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onRun && onRun(); return; }

    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: a, selectionEnd: b, value: v } = ta;

      if (e.shiftKey || a !== b) {
        // Indent or dedent every line the selection touches. The two differ only
        // in the per-line map.
        const from = v.lastIndexOf('\n', a - 1) + 1;
        const f = e.shiftKey ? (l) => l.replace(/^ {1,4}/, '') : (l) => TAB + l;
        ta.setRangeText(v.slice(from, b).split('\n').map(f).join('\n'), from, b, 'select');
      } else {
        ta.setRangeText(TAB, a, b, 'end');
      }
      paint();
      return;
    }

    if (e.key === 'Enter') {
      // Carry the current line's indentation, and add one level after a brace.
      const { selectionStart: a, value: v } = ta;
      const from = v.lastIndexOf('\n', a - 1) + 1;
      const indent = (/^[ \t]*/.exec(v.slice(from, a)) || [''])[0];
      const deeper = /[{([]\s*$/.test(v.slice(from, a)) ? TAB : '';
      e.preventDefault();
      ta.setRangeText('\n' + indent + deeper, a, ta.selectionEnd, 'end');
      paint();
    }
  });

  paint();
  if (Vim.isOn()) vim.enable();

  return {
    value: () => ta.value,
    set(v) { ta.value = v; errLines = []; lastHl = null; paint(); vim.sync(); },
    reset() { this.set(starter); },
    focus() { ta.focus(); },
    mark(ls) { errLines = ls || []; paint(); },
    /* Soft wrap. The editor owns this rather than exposing a repaint hook,
       because paint() sizes the textarea to the widest line with an inline
       width that CSS cannot express: a caller that toggled the class and
       forgot the repaint would leave the caret on the old line width while the
       glyphs folded to the new one. */
    wrap(on) { host.classList.toggle('softwrap', on); paint(); },
    vim,
  };
}

/* hlRust is exported for a consumer outside the browser: the clip project in
   ~/cetusian/content/the-rust-handbook highlights its source with this function
   at build time, so a video and a page tokenize Rust the same way. It was
   dropped from here once as unused, and a second tokenizer is the alternative. */
return { hlRust, run, parse, snippet, mountEditor, toolchain, esc };
})();
