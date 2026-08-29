/* Vim mode for the workbench editor.
 *
 * Hand-written, because this project ships no JavaScript libraries and pulling
 * in CodeMirror to get @codemirror/vim would mean replacing the editor and
 * breaking that rule for one feature.
 *
 * What it covers is the subset you actually use while fixing a twenty-line Rust
 * exercise: motions, operators, counts, registers, visual mode, undo. What it
 * deliberately does not cover is named registers, macros, marks, `.` repeat, and
 * ex commands beyond :w. Those matter in a real editing session and would
 * double the size of this file for a workbench where the longest starter is 53
 * lines. `Vim.UNSUPPORTED` lists them so the UI can be honest.
 *
 * The motion and operator logic is pure: it takes (text, index) and returns a
 * new index or a new state, so it is testable without a DOM. Only `attach`
 * touches the textarea.
 */

const Vim = (() => {
'use strict';

const UNSUPPORTED = ['named registers', 'macros (q)', 'marks', '. repeat', 'ex commands beyond :w'];

/* ===================================================================== */
/* text helpers, all pure, all index-based                              */
/* ===================================================================== */

const lineStart = (v, i) => v.lastIndexOf('\n', Math.max(0, i - 1)) + 1;
const lineEnd = (v, i) => {
  const n = v.indexOf('\n', i);
  return n === -1 ? v.length : n;
};
const lineNo = (v, i) => (v.slice(0, i).match(/\n/g) || []).length;
const col = (v, i) => i - lineStart(v, i);

function lineAt(v, n) {
  // Start index of line n, clamped.
  const lines = v.split('\n');
  n = Math.max(0, Math.min(n, lines.length - 1));
  let at = 0;
  for (let k = 0; k < n; k++) at += lines[k].length + 1;
  return at;
}

const firstNonBlank = (v, i) => {
  const s = lineStart(v, i), e = lineEnd(v, i);
  const m = /\S/.exec(v.slice(s, e));
  return m ? s + m.index : s;
};

/* Vim's word classes: a word is either a run of \w, or a run of punctuation.
   A WORD (capital motions) is any run of non-whitespace. */
const isWord = (c) => /[A-Za-z0-9_]/.test(c);
const isSpace = (c) => /\s/.test(c);
const klass = (c, big) => (isSpace(c) ? 0 : big ? 1 : isWord(c) ? 1 : 2);

function wordFwd(v, i, big) {
  const k = klass(v[i], big);
  if (k) while (i < v.length && klass(v[i], big) === k) i++;
  while (i < v.length && isSpace(v[i])) i++;
  return Math.min(i, v.length);
}

function wordBack(v, i, big) {
  i--;
  while (i > 0 && isSpace(v[i])) i--;
  if (i <= 0) return 0;
  const k = klass(v[i], big);
  while (i > 0 && klass(v[i - 1], big) === k) i--;
  return Math.max(0, i);
}

function wordEnd(v, i, big) {
  i++;
  while (i < v.length && isSpace(v[i])) i++;
  const k = klass(v[i], big);
  while (i + 1 < v.length && klass(v[i + 1], big) === k) i++;
  return Math.min(i, Math.max(0, v.length - 1));
}

function paraFwd(v, i) {
  let n = lineNo(v, i);
  const lines = v.split('\n');
  n++;
  while (n < lines.length && lines[n].trim() !== '') n++;
  return lineAt(v, Math.min(n, lines.length - 1));
}

function paraBack(v, i) {
  let n = lineNo(v, i);
  const lines = v.split('\n');
  n--;
  while (n > 0 && lines[n].trim() !== '') n--;
  return lineAt(v, Math.max(n, 0));
}

/* f/F/t/T stay within the line, which is the whole point of them. */
function findChar(v, i, ch, { back, till }) {
  const s = lineStart(v, i), e = lineEnd(v, i);
  if (back) {
    for (let k = i - 1; k >= s; k--) {
      if (v[k] === ch) return till ? k + 1 : k;
    }
  } else {
    for (let k = i + 1; k < e; k++) {
      if (v[k] === ch) return till ? k - 1 : k;
    }
  }
  return -1;
}

/* Text objects: the `iw` in `ciw` and the `a"` in `da"`. `i` takes the inside,
   `a` takes the surrounding delimiters or trailing whitespace too. Returns
   [from, to) or null. */
const PAIRS = { '(': ')', ')': ')', b: ')', '[': ']', ']': ']',
                '{': '}', '}': '}', B: '}', '<': '>', '>': '>' };
const OPENERS = { ')': '(', ']': '[', '}': '{', '>': '<' };

function textObject(v, i, kind, obj) {
  if (obj === 'w' || obj === 'W') {
    const big = obj === 'W';
    if (i >= v.length) return null;
    const k = klass(v[i], big);
    let a = i, b = i;
    while (a > 0 && v[a - 1] !== '\n' && klass(v[a - 1], big) === k) a--;
    while (b + 1 < v.length && v[b + 1] !== '\n' && klass(v[b + 1], big) === k) b++;
    b++;
    // `aw` also eats the whitespace after the word, or before it if there is
    // none after. That asymmetry is real Vim and it is what makes `daw` leave a
    // sentence correctly spaced.
    if (kind === 'a') {
      const before = b;
      while (b < v.length && v[b] !== '\n' && isSpace(v[b])) b++;
      if (b === before) while (a > 0 && v[a - 1] !== '\n' && isSpace(v[a - 1])) a--;
    }
    return [a, b];
  }

  if (obj === '"' || obj === "'" || obj === '`') {
    // Quotes have no nesting, so scan the line and take the pair we are inside.
    const s0 = lineStart(v, i), e0 = lineEnd(v, i);
    const at = [];
    for (let k = s0; k < e0; k++) {
      if (v[k] === obj && v[k - 1] !== '\\') at.push(k);
    }
    for (let k = 0; k + 1 < at.length; k += 2) {
      if (i >= at[k] && i <= at[k + 1]) {
        return kind === 'i' ? [at[k] + 1, at[k + 1]] : [at[k], at[k + 1] + 1];
      }
    }
    return null;
  }

  const close = PAIRS[obj];
  if (!close) return null;
  const open = OPENERS[close];
  // Walk out to the enclosing pair, counting depth so nested brackets work.
  let depth = 0, a = -1;
  for (let k = v[i] === close ? i - 1 : i; k >= 0; k--) {
    if (v[k] === close && k !== i) depth++;
    else if (v[k] === open) { if (depth === 0) { a = k; break; } depth--; }
  }
  if (a < 0) return null;
  depth = 0;
  let b = -1;
  for (let k = a + 1; k < v.length; k++) {
    if (v[k] === open) depth++;
    else if (v[k] === close) { if (depth === 0) { b = k; break; } depth--; }
  }
  if (b < 0) return null;
  return kind === 'i' ? [a + 1, b] : [a, b + 1];
}

/* Vertical movement keeps the column you were aiming for, so a run of j through
   a short line and out the other side lands where you expect. */
function vertical(v, i, delta, want) {
  const n = lineNo(v, i) + delta;
  const lines = v.split('\n');
  if (n < 0 || n >= lines.length) return null;
  const at = lineAt(v, n);
  return at + Math.min(want, Math.max(0, lines[n].length));
}

/* gc, from Comment.nvim. Rust line comments only, which is all this editor
   ever holds. Toggling is per-block: if every non-blank line is already
   commented the block is uncommented, otherwise all of them are commented, so a
   half-commented block ends up fully commented rather than inverted. */
function toggleComment(v, from, to) {
  const a = lineStart(v, from), b = lineEnd(v, to);
  const body = v.slice(a, b).split('\n');
  const live = body.filter((l) => l.trim() !== '');
  const allOn = live.length > 0 && live.every((l) => /^\s*\/\//.test(l));
  const indent = Math.min(...(live.length ? live : ['']).map((l) => /^\s*/.exec(l)[0].length));
  const out = body.map((l) => {
    if (l.trim() === '') return l;
    if (allOn) return l.replace(/^(\s*)\/\/ ?/, '$1');
    return l.slice(0, indent) + '// ' + l.slice(indent);
  });
  return [a, b, out.join('\n')];
}

/* Ctrl-A and Ctrl-X, which the config maps to <leader>+ and <leader>-. Finds
   the number under or after the cursor on this line and steps it. */
function stepNumber(v, i, by) {
  const s0 = lineStart(v, i), e0 = lineEnd(v, i);
  const line = v.slice(s0, e0);
  const re = /-?\d+/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const a = s0 + m.index, b = a + m[0].length;
    if (b > i) return [a, b, String(parseInt(m[0], 10) + by)];
  }
  return null;
}

/* smartcase, as the config sets it: a lower-case pattern matches either case, a
   pattern with any capital in it is taken literally. */
function searchFrom(v, i, pat, back) {
  if (!pat) return -1;
  const smart = /[A-Z]/.test(pat);
  const hay = smart ? v : v.toLowerCase();
  const needle = smart ? pat : pat.toLowerCase();
  if (back) {
    const at = hay.lastIndexOf(needle, Math.max(0, i - 1));
    return at >= 0 ? at : hay.lastIndexOf(needle);           // wrap
  }
  const at = hay.indexOf(needle, i + 1);
  return at >= 0 ? at : hay.indexOf(needle);                 // wrap
}

/* ===================================================================== */
/* the machine                                                           */
/* ===================================================================== */

function create(opts = {}) {
  const st = {
    mode: 'normal',      // normal | insert | visual | vline
    cur: 0,
    want: 0,             // desired column for j/k
    count: '',
    opCount: '',   // the count typed BEFORE the operator
    op: null,            // pending operator: d c y > <
    anchor: 0,           // visual start
    reg: { text: '', linewise: false },
    await: null,         // f F t T r, or 'g'
    cmd: null,           // the : command line, while one is open
    find: '',            // the last / pattern, for n and N
    search: null,        // the / prompt, while one is open
    undo: [],
    redo: [],
    status: '',
  };

  let text = '';
  const emit = () => opts.onChange && opts.onChange(text, st);

  const clampNormal = (i) => {
    // In normal mode the cursor sits ON a character, so it may not rest past the
    // last one, the difference that makes `$` behave.
    const s = lineStart(text, i), e = lineEnd(text, i);
    return Math.max(s, Math.min(i, Math.max(s, e - (st.mode === 'insert' ? 0 : 1))));
  };

  const snapshot = () => {
    st.undo.push({ text, cur: st.cur });
    if (st.undo.length > 200) st.undo.shift();
    st.redo.length = 0;
  };

  function replace(from, to, insert) {
    text = text.slice(0, from) + insert + text.slice(to);
  }

  /* Vim multiplies the count before an operator by the count after it, so
     `2d3w` deletes six words. One string cannot hold two numbers: appending the
     second to the first made `2d3w` mean 23. */
  const num = (c) => Math.max(1, parseInt(c || '1', 10));
  const n = () => num(st.opCount) * num(st.count);
  const hasCount = () => !!(st.count || st.opCount);

  /* Every pending-state branch ends one of two ways. Spelling the epilogue out
     per branch is how `r` and `f` came to leave an operator armed after the
     command was over: the next motion then executed an edit nobody asked for. */
  const done = () => {
    st.count = st.opCount = '';
    st.op = null;
    emit();
    return true;
  };
  const abandon = (why) => {
    if (why) st.status = why;
    reset();
    emit();
    return true;
  };

  /* --- motions ------------------------------------------------------- */
  /* Returns {to, linewise, inclusive} or null. `to` is where the cursor goes;
     an operator uses [min(cur,to), max(cur,to)) with inclusive adding one. */
  function motion(key, count) {
    const v = text, i = st.cur;
    switch (key) {
      case 'h': return { to: Math.max(lineStart(v, i), i - count) };
      case 'l': return { to: Math.min(lineEnd(v, i), i + count) };
      case ' ': return { to: Math.min(v.length, i + count) };
      case 'j': case 'k': {
        const to = vertical(v, i, key === 'j' ? count : -count, st.want);
        return to === null ? null : { to, linewise: true };
      }
      case 'w': case 'W': {
        let x = i;
        for (let c = 0; c < count; c++) x = wordFwd(v, x, key === 'W');
        return { to: x };
      }
      case 'b': case 'B': {
        let x = i;
        for (let c = 0; c < count; c++) x = wordBack(v, x, key === 'B');
        return { to: x };
      }
      case 'e': case 'E': {
        let x = i;
        for (let c = 0; c < count; c++) x = wordEnd(v, x, key === 'E');
        return { to: x, inclusive: true };
      }
      case '0': return { to: lineStart(v, i) };
      case '^': return { to: firstNonBlank(v, i) };
      case '$': return { to: lineEnd(v, i), inclusive: true };
      case '{': return { to: paraBack(v, i), linewise: true };
      case '}': return { to: paraFwd(v, i), linewise: true };
      case 'G': return { to: firstNonBlank(v, hasCount() ? lineAt(v, count - 1) : lineAt(v, 1e9)), linewise: true };
      case 'H': return { to: 0, linewise: true };
      default: return null;
    }
  }

  /* --- operators ------------------------------------------------------ */
  function applyOp(op, from, to, linewise) {
    if (linewise) {
      from = lineStart(text, from);
      to = Math.min(text.length, lineEnd(text, to) + 1);
    }
    const cut = text.slice(from, to);

    if (op === 'y') {
      st.reg = { text: cut, linewise: !!linewise };
      st.cur = clampNormal(from);
      return;
    }
    if (op === '>' || op === '<') {
      snapshot();
      const body = text.slice(from, to).split('\n');
      const shifted = body.map((l) =>
        (op === '>' ? '    ' + l : l.replace(/^ {1,4}/, ''))).join('\n');
      replace(from, to, shifted);
      st.cur = firstNonBlank(text, from);
      return;
    }
    if (op === 'S') {
      // substitute.nvim's gs: replace the range with the register, and do NOT
      // clobber the register with what was there. That is the whole point of it.
      snapshot();
      replace(from, to, st.reg.text);
      st.cur = clampNormal(from);
      return;
    }
    snapshot();
    st.reg = { text: cut, linewise: !!linewise };
    if (op === 'c' && linewise) {
      // cc keeps the line, empties it, and leaves you inserting on it.
      const indent = (/^[ \t]*/.exec(text.slice(from, lineEnd(text, from))) || [''])[0];
      replace(from, to, indent + '\n');
      st.cur = from + indent.length;
      st.mode = 'insert';
      return;
    }
    replace(from, to, '');
    st.cur = op === 'c' ? from : clampNormal(from);
    if (op === 'c') st.mode = 'insert';
  }

  function paste(before) {
    const { text: r, linewise } = st.reg;
    // Guard first. snapshot() clears the redo stack, so snapshotting before
    // deciding there is nothing to paste meant a stray `p` after a `u` threw
    // away the redo you were about to use.
    if (!r) return;
    snapshot();
    if (linewise) {
      const body = r.endsWith('\n') ? r.slice(0, -1) : r;
      if (before) {
        const at = lineStart(text, st.cur);
        replace(at, at, body + '\n');
        st.cur = firstNonBlank(text, at);
      } else {
        // Insert the newline BEFORE the body, at the end of the current line.
        // That works whether or not a line follows and whether or not the buffer
        // ends with a newline. Appending to it does not.
        const at = lineEnd(text, st.cur);
        replace(at, at, '\n' + body);
        st.cur = firstNonBlank(text, at + 1);
      }
    } else {
      const at = before ? st.cur : Math.min(text.length, st.cur + 1);
      replace(at, at, r);
      st.cur = at + r.length - 1;
    }
  }

  /* --- the key handler ------------------------------------------------ */
  /* Returns true if the key was consumed. */
  function key(k, mods = {}) {
    st.status = '';

    if (st.mode === 'insert') {
      if (k === 'Escape' || (mods.ctrl && k === '[')) {
        st.mode = 'normal';
        st.cur = clampNormal(Math.max(0, st.cur - 1));
        emit();
        return true;
      }
      return false; // let the textarea handle real typing
    }

    // waiting for the argument of f/F/t/T/r, or the second key of g
    // The / prompt. smartcase, and the pattern is remembered for n and N.
    if (st.search !== null) {
      if (k === 'Escape') { st.search = null; }
      else if (k === 'Enter') {
        const pat = st.search;
        st.search = null;
        if (pat) {
          st.find = pat;
          const at = searchFrom(text, st.cur, pat, false);
          if (at >= 0) { st.cur = clampNormal(at); st.want = col(text, st.cur); }
          else st.status = `not found: ${pat}`;
        }
      } else if (k === 'Backspace') {
        if (!st.search) st.search = null; else st.search = st.search.slice(0, -1);
      } else if (k.length === 1) st.search += k;
      emit();
      return true;
    }

    // The : command line. Only :w and :x do anything. They run the code, which
    // is the muscle memory worth honouring here. Everything else says so.
    if (st.cmd !== null) {
      if (k === 'Escape') { st.cmd = null; }
      else if (k === 'Enter') {
        const c = st.cmd.trim();
        st.cmd = null;
        if (c === 'w' || c === 'x' || c === 'wq') {
          st.status = 'running';
          if (opts.onRun) opts.onRun();
        } else if (c === 'q' || c === 'q!') {
          st.status = 'nothing to quit. This is a workbench';
        } else {
          st.status = `not a command: :${c}`;
        }
      } else if (k === 'Backspace') {
        if (!st.cmd) { st.cmd = null; } else st.cmd = st.cmd.slice(0, -1);
      } else if (k.length === 1) {
        st.cmd += k;
      }
      emit();
      return true;
    }

    if (st.await) {
      const a = st.await;
      st.await = null;
      if (k === 'Escape') return abandon();
      if (a === 'g') {
        if (k === 'g') {
          st.cur = firstNonBlank(text, hasCount() ? lineAt(text, n() - 1) : 0);
          if (st.op) { doPendingLinewise(st.cur); } else { st.want = col(text, st.cur); }
        } else if (k === 'c') {
          // gcc, or gc over a visual selection. Comment.nvim's mapping.
          if (st.mode === 'visual' || st.mode === 'vline') {
            const [a2, b2, body] = toggleComment(text, Math.min(st.anchor, st.cur),
                                                 Math.max(st.anchor, st.cur));
            snapshot();
            replace(a2, b2, body);
            st.mode = 'normal';
            st.cur = clampNormal(firstNonBlank(text, a2));
          } else {
            st.await = 'gc';
            emit();
            return true;
          }
        } else if (k === 's') {
          // substitute.nvim: gs replaces a motion's text with the register.
          st.op = 'S';
          st.count = '';
          emit();
          return true;
        } else if (k === 'S') {
          if (st.reg.text) {
            snapshot();
            replace(st.cur, lineEnd(text, st.cur), st.reg.text);
            st.cur = clampNormal(st.cur);
          }
        } else {
          // `gz` and friends are not commands.
          return abandon();
        }
        return done();
      }
      if (a === 'gc') {
        // gcc toggles this line; gc{motion} toggles the lines it spans.
        let from = st.cur, to = st.cur;
        if (k !== 'c') {
          const m = motion(k, n());
          if (!m) return abandon(`not a motion: ${k}`);
          from = Math.min(st.cur, m.to);
          to = Math.max(st.cur, m.to);
        } else if (n() > 1) {
          to = lineAt(text, lineNo(text, st.cur) + n() - 1);
        }
        const [a2, b2, body] = toggleComment(text, from, to);
        snapshot();
        replace(a2, b2, body);
        st.cur = clampNormal(firstNonBlank(text, a2));
        return done();
      }
      if (a === 'i' || a === 'a') {
        const range = textObject(text, st.cur, a, k);
        if (!range) return abandon(`no ${a}${k} here`);
        if (st.op) applyOp(st.op, range[0], range[1], false);
        else st.cur = clampNormal(range[0]);
        return done();
      }
      if (a === 'r') {
        if (k.length === 1) {
          snapshot();
          replace(st.cur, st.cur + 1, k);
        }
        return done();
      }
      // f F t T
      const found = findChar(text, st.cur, k,
        { back: a === 'F' || a === 'T', till: a === 't' || a === 'T' });
      if (found >= 0) {
        if (st.op) {
          const inclusive = a === 'f' || a === 't';
          const from = Math.min(st.cur, found), to = Math.max(st.cur, found) + (inclusive ? 1 : 0);
          applyOp(st.op, from, to, false);
        } else {
          st.cur = found;
          st.want = col(text, st.cur);
        }
      } else {
        return abandon(`no '${k}' on this line`);
      }
      return done();
    }

    if (k === 'Escape') { reset(); emit(); return true; }

    // counts. `0` is a motion when no count is building.
    if (/[1-9]/.test(k) || (k === '0' && st.count)) {
      st.count += k;
      emit();
      return true;
    }

    // operator, doubled -> linewise on `count` lines (dd, yy, cc, >>, <<)
    if (st.op && (k === st.op || (st.op === 'c' && k === 'c'))) {
      const from = lineStart(text, st.cur);
      const to = lineAt(text, lineNo(text, st.cur) + n() - 1);
      applyOp(st.op, from, to, true);
      return done();
    }

    // `di(`, `ciw`, `ya"`: the operator waits for the object kind, then the object.
    if (st.op && (k === 'i' || k === 'a')) {
      st.await = k;
      emit();
      return true;
    }

    // A motion, possibly completing a pending operator. motion() returning null
    // IS the membership test; a separate MOTION_KEYS string was a second copy of
    // the same list and had already drifted (it omitted the space motion, which
    // was therefore unreachable).
    const mo = motion(k, n());
    if (mo) {
      const m = mo;
      if (st.op) {
        const from = Math.min(st.cur, m.to);
        const to = Math.max(st.cur, m.to) + (m.inclusive ? 1 : 0);
        applyOp(st.op, from, to, m.linewise);
      } else {
        st.cur = st.mode === 'visual' || st.mode === 'vline' ? m.to : clampNormal(m.to);
        if (k !== 'j' && k !== 'k') st.want = col(text, st.cur);
      }
      return done();
    }

    switch (k) {
      case 'g': st.await = 'g'; emit(); return true;
      case 'f': case 'F': case 't': case 'T': case 'r':
        st.await = k; emit(); return true;
      case '/': st.search = ''; emit(); return true;
      case 'n': case 'N': {
        if (!st.find) { st.status = 'no previous search'; break; }
        const at = searchFrom(text, st.cur, st.find, k === 'N');
        if (at >= 0) st.cur = clampNormal(at);
        else st.status = `not found: ${st.find}`;
        break;
      }
      case 'A_INC': case 'A_DEC': {
        const r = stepNumber(text, st.cur, k === 'A_INC' ? n() : -n());
        if (!r) { st.status = 'no number on this line'; break; }
        snapshot();
        replace(r[0], r[1], r[2]);
        st.cur = clampNormal(r[0] + r[2].length - 1);
        break;
      }

      case 'i': snapshot(); st.mode = 'insert'; break;
      case 'I': st.cur = firstNonBlank(text, st.cur); snapshot(); st.mode = 'insert'; break;
      case 'a': st.cur = Math.min(text.length, st.cur + 1); snapshot(); st.mode = 'insert'; break;
      case 'A': st.cur = lineEnd(text, st.cur); snapshot(); st.mode = 'insert'; break;
      case 'o': case 'O': {
        snapshot();
        const ls = lineStart(text, st.cur);
        const indent = (/^[ \t]*/.exec(text.slice(ls, lineEnd(text, ls))) || [''])[0];
        if (k === 'o') {
          const e = lineEnd(text, st.cur);
          replace(e, e, '\n' + indent);
          st.cur = e + 1 + indent.length;
        } else {
          replace(ls, ls, indent + '\n');
          st.cur = ls + indent.length;
        }
        st.mode = 'insert';
        break;
      }

      case 'd': case 'c': case 'y': case '>': case '<':
        if (st.mode === 'visual' || st.mode === 'vline') {
          const from = Math.min(st.anchor, st.cur), to = Math.max(st.anchor, st.cur) + 1;
          applyOp(k, from, to, st.mode === 'vline');
          if (st.mode !== 'insert') st.mode = 'normal';
          break;
        }
        // The count typed so far belongs to the operator. Digits typed after it
        // are a second, independent count, and the two multiply.
        st.op = k;
        st.opCount = st.count;
        st.count = '';
        emit();
        return true;

      case 'x': case 'X': {
        snapshot();
        const from = k === 'x' ? st.cur : Math.max(lineStart(text, st.cur), st.cur - n());
        const to = k === 'x' ? Math.min(lineEnd(text, st.cur), st.cur + n()) : st.cur;
        st.reg = { text: text.slice(from, to), linewise: false };
        replace(from, to, '');
        st.cur = clampNormal(from);
        break;
      }
      case 'D': applyOp('d', st.cur, lineEnd(text, st.cur), false); break;
      case 'C': applyOp('c', st.cur, lineEnd(text, st.cur), false); break;
      case 'Y': applyOp('y', st.cur, st.cur, true); break;
      case 's': applyOp('c', st.cur, Math.min(lineEnd(text, st.cur), st.cur + n()), false); break;
      case 'S': applyOp('c', st.cur, st.cur, true); break;

      case 'p': paste(false); break;
      case 'P': paste(true); break;

      case 'v':
        st.mode = st.mode === 'visual' ? 'normal' : 'visual';
        st.anchor = st.cur;
        break;
      case 'V':
        st.mode = st.mode === 'vline' ? 'normal' : 'vline';
        st.anchor = st.cur;
        break;

      case 'J': {
        const e = lineEnd(text, st.cur);
        if (e < text.length) {
          snapshot();
          // Drop the newline and the next line's indent, leaving one space.
          text = text.slice(0, e) + ' ' + text.slice(e + 1).replace(/^[ \t]*/, '');
          st.cur = e;
        }
        break;
      }
      case '~': {
        snapshot();
        const c = text[st.cur] || '';
        replace(st.cur, st.cur + 1, c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase());
        st.cur = clampNormal(st.cur + 1);
        break;
      }

      case 'u': {
        const prev = st.undo.pop();
        if (prev) {
          st.redo.push({ text, cur: st.cur });
          text = prev.text;
          st.cur = clampNormal(prev.cur);
        } else st.status = 'already at oldest change';
        break;
      }
      case 'R': {  // Ctrl-r arrives as 'R' with mods.ctrl
        if (!mods.ctrl) break;
        const nx = st.redo.pop();
        if (nx) {
          st.undo.push({ text, cur: st.cur });
          text = nx.text;
          st.cur = clampNormal(nx.cur);
        } else st.status = 'already at newest change';
        break;
      }

      case ':': st.cmd = ''; emit(); return true;

      default:
        st.count = '';
        emit();
        return true;
    }

    if (st.mode === 'normal') st.cur = clampNormal(st.cur);
    st.want = col(text, st.cur);
    // done() clears the operator as well. Spelling this epilogue out by hand
    // was the third, unnamed terminator: every `break` in the switch above
    // left `d` armed, so `d` then `p` then `w` deleted a word nobody asked to
    // delete. Motions never reach here; they return at the motion() branch.
    return done();
  }

  function doPendingLinewise(to) {
    applyOp(st.op, Math.min(st.cur, to), Math.max(st.cur, to), true);
    st.op = null;
  }

  function reset() {
    st.op = null;
    st.count = st.opCount = '';
    st.await = null;
    if (st.mode !== 'insert') st.mode = 'normal';
    st.cur = clampNormal(st.cur);
  }

  return {
    state: st,
    key,
    get text() { return text; },
    set text(v) { text = v; },
    setCursor(i) { st.cur = i; st.want = col(text, i); },
    label() {
      if (st.search !== null) return '/' + st.search;
      if (st.cmd !== null) return ':' + st.cmd;
      if (st.mode === 'insert') return 'INSERT';
      const pend = (st.opCount || '') + (st.op || '') + (st.count || '') + (st.await || '');
      if (st.mode === 'visual') return 'VISUAL';
      if (st.mode === 'vline') return 'V-LINE';
      return pend || 'NORMAL';
    },
  };
}

/* ===================================================================== */
/* DOM wiring                                                            */
/* ===================================================================== */

const KEY = 'rh-vim';
const isOn = () => {
  try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
};
const setOn = (on) => {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
};

/* Attaches to a textarea. Returns handles the editor uses; enabling and
   disabling is a live toggle, so the reader can flip it mid-exercise. */
function attach(ta, { paint, onRun, badge, gutter }) {
  const vim = create({ onRun });
  let on = false;
  let lastJ = 0;   // when a `j` was typed in insert mode, for the jk mapping

  const render = () => {
    ta.value = vim.text;
    const m = vim.state.mode;
    if (m === 'insert') {
      ta.setSelectionRange(vim.state.cur, vim.state.cur);
    } else if (m === 'visual' || m === 'vline') {
      let a = Math.min(vim.state.anchor, vim.state.cur);
      let b = Math.max(vim.state.anchor, vim.state.cur) + 1;
      if (m === 'vline') { a = lineStart(vim.text, a); b = Math.min(vim.text.length, lineEnd(vim.text, b - 1) + 1); }
      ta.setSelectionRange(a, b);
    } else {
      // A block cursor: normal mode's cursor sits ON a character, so show it as
      // a one-character selection. Without this you cannot tell h from i.
      const c = vim.state.cur;
      ta.setSelectionRange(c, Math.min(vim.text.length, c + 1));
    }
    const cls = on ? 'vim-' + (m === 'vline' ? 'visual' : m) : '';
    ta.parentElement.parentElement.dataset.vim = cls;
    // relativenumber + number, as the config sets them: distances from the
    // cursor, with the cursor's own line showing its absolute number. That
    // pairing is what makes 7j and d4k something you can read off the screen.
    if (gutter) gutter(on ? lineNo(vim.text, vim.state.cur) : null);
    if (badge) {
      badge.hidden = !on;
      badge.textContent = vim.label();
      badge.dataset.mode = m;
      badge.title = vim.state.status || '';
    }
    paint();
  };

  function onKeyDown(e) {
    if (!on) return;

    // `jk` to leave insert mode. This is a personal mapping, not stock Vim, and
    // it only fires when the j was typed a moment ago: `jk` inside a word you
    // are deliberately writing must survive.
    if (vim.state.mode === 'insert' && e.key === 'k' && !e.ctrlKey && !e.metaKey) {
      const at = ta.selectionStart;
      if (ta.value[at - 1] === 'j' && Date.now() - lastJ < 400) {
        e.preventDefault();
        ta.setRangeText('', at - 1, at, 'end');
        vim.text = ta.value;
        vim.setCursor(Math.max(0, at - 1));
        vim.key('Escape');
        render();
        return;
      }
    }
    if (vim.state.mode === 'insert' && e.key === 'j') lastJ = Date.now();

    const CTRL = { a: 'A_INC', x: 'A_DEC', r: 'R' };
    const ctrlCmd = e.ctrlKey && !e.metaKey ? CTRL[e.key] : null;
    // Let the browser's own shortcuts through untouched.
    if (e.metaKey || (e.ctrlKey && !ctrlCmd && e.key !== '[')) return;

    vim.text = ta.value;
    vim.setCursor(ta.selectionStart);
    // setCursor resets `want`; restore what the machine was tracking so a run of
    // j/k through short lines keeps its column.
    const k = ctrlCmd || e.key;
    const allowLong = ['Escape', 'Enter', 'Backspace', 'A_INC', 'A_DEC', 'R'];
    if (k === 'Tab' && vim.state.mode !== 'insert') {
      // Not a command, but it must not reach the editor's own Tab handler
      // and indent the line. `>>` is how you indent in normal mode.
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (k.length > 1 && !allowLong.includes(k)) return;  // arrows, Home, F-keys: leave alone

    const consumed = vim.key(k, { ctrl: e.ctrlKey });
    if (!consumed) return;
    e.preventDefault();
    // mountEditor has its own keydown listener on this same textarea, and
    // preventDefault does not stop a sibling. Without this, Enter in normal mode
    // was consumed here and THEN inserted a newline down there.
    e.stopImmediatePropagation();

    render();
  }

  // Typing in insert mode goes through the textarea normally; keep the machine
  // in step so a later Escape lands on the right character.
  function onInput() {
    if (!on) return;
    vim.text = ta.value;
    vim.setCursor(ta.selectionStart);
  }

  ta.addEventListener('keydown', onKeyDown, true);
  ta.addEventListener('input', onInput);
  ta.addEventListener('mouseup', onInput);

  return {
    isOn: () => on,
    enable() {
      on = true;
      setOn(true);
      vim.text = ta.value;
      vim.state.mode = 'normal';
      vim.setCursor(ta.selectionStart);
      render();
      ta.focus();
    },
    disable() {
      on = false;
      setOn(false);
      if (gutter) gutter(null);
      if (badge) badge.hidden = true;
      ta.parentElement.parentElement.dataset.vim = '';
      const c = ta.selectionStart;
      ta.setSelectionRange(c, c);
      paint();
    },
    toggle() { return this.isOn() ? (this.disable(), false) : (this.enable(), true); },
    sync() { vim.text = ta.value; vim.setCursor(ta.selectionStart); if (on) render(); },
  };
}

return {
  create, attach, isOn, setOn, UNSUPPORTED,
  // exported for tests
  _t: { lineStart, lineEnd, lineNo, col, lineAt, firstNonBlank,
        wordFwd, wordBack, wordEnd, findChar, paraFwd, paraBack, vertical },
};
})();
