/* Rust Handbook.
 *
 * A hash router over view functions that return HTML strings. No framework, no
 * virtual DOM, no build step: the data was shaped by build.py, so a view is
 * mostly string concatenation and the browser's own parser does the rest.
 *
 * Wiring happens after the paint, in one wire<View> function per view, using
 * delegated listeners where the target is dynamic.
 */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');
const cache = new Map();
const esc = WB.esc;
const num = (n) => Number(n).toLocaleString('en-US');

let DB = null;

async function get(url) {
  if (!cache.has(url)) {
    const p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
    // Evict on failure. Caching the promise itself is what makes this fast, but
    // caching a REJECTED one means one network blip pins "Not here — that unit
    // may not be written yet" onto a unit that exists, for the whole session.
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return cache.get(url);
}

/* --------------------------------------------------------------------- */
/* icons — one per destination, so the eye learns the place before the label */
/* --------------------------------------------------------------------- */

const I = {
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z"/><path d="M4 17.5h16"/>',
  track: '<path d="M4 19h4V5H4zM10 19h4V9h-4zM16 19h4V13h-4z"/>',
  wrench: '<path d="M15 3a5 5 0 0 0-4.6 7L3 17.4 6.6 21 14 13.6A5 5 0 0 0 21 9l-3 3-3-3 3-3a5 5 0 0 0-3-3z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  chev: '<path d="m9 5 7 7-7 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 14 9 5 9-5"/>',
  check: '<path d="m4 12.5 5.2 5L20 6.5"/>',
  play: '<path d="M6 4.5v15l13-7.5z"/>',
  bulb: '<path d="M9 18h6M10 21.5h4"/><path d="M12 2.5a6 6 0 0 0-3.6 10.8c.6.5.9 1.1 1 1.7h5.2c.1-.6.4-1.2 1-1.7A6 6 0 0 0 12 2.5z"/>',
  reset: '<path d="M3 12a9 9 0 1 0 2.6-6.4M3 4v5h5"/>',
  book2: '<path d="M12 6.5S9.5 4 6 4H3v14h3c3.5 0 6 2 6 2s2.5-2 6-2h3V4h-3c-3.5 0-6 2.5-6 2.5z"/><path d="M12 6.5V20"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  flame: '<path d="M12 22c4 0 7-2.7 7-6.5 0-4.5-4.5-6-4.5-9.5 0 0-2 1.5-2 4C12.5 8 11 6 9 4.5c0 2-1 3-2 4.5S5 12 5 15.5C5 19.3 8 22 12 22z"/>',
};
const ico = (n, s = 18) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${I[n] || ''}</svg>`;

/* --------------------------------------------------------------------- */
/* progress — localStorage, and nothing leaves the browser                */
/* --------------------------------------------------------------------- */

const PKEY = 'rh-progress';
let P = { _streak: { last: null, days: 0, best: 0 } };

function loadProgress() {
  try {
    const raw = localStorage.getItem(PKEY);
    if (raw) P = { ...P, ...JSON.parse(raw) };
  } catch (e) {}
}
function saveProgress() {
  try { localStorage.setItem(PKEY, JSON.stringify(P)); } catch (e) {}
}
const today = () => new Date().toISOString().slice(0, 10);

/* A streak is only interesting if it is honest: same day does nothing, the next
   day increments, and any longer gap starts over at one. */
function touchStreak() {
  const s = P._streak;
  const t = today();
  if (s.last === t) return;
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  s.days = s.last === yesterday ? s.days + 1 : 1;
  s.last = t;
  s.best = Math.max(s.best || 0, s.days);
  saveProgress();
}

const exKey = (unit, n) => `${unit}/${n}`;
const passed = (unit, n) => !!P[exKey(unit, n)]?.passed;

function markAttempt(unit, n, ok, hints) {
  const k = exKey(unit, n);
  const rec = P[k] || { passed: false, tries: 0, hints: 0 };
  rec.tries++;
  rec.hints = Math.max(rec.hints, hints || 0);
  if (ok && !rec.passed) { rec.passed = true; rec.at = Date.now(); }
  P[k] = rec;
  touchStreak();
  saveProgress();
  return rec;
}

const unitDone = (u) => {
  if (!u.exercises) return 0;
  let n = 0;
  for (let i = 1; i <= u.exercises; i++) if (passed(u.slug, i)) n++;
  return n;
};

/* --------------------------------------------------------------------- */
/* shared fragments                                                       */
/* --------------------------------------------------------------------- */

function crumbs(parts) {
  return `<nav class="crumbs">${parts.map((p, i) =>
    (i ? '<span class="sep">/</span>' : '') +
    (p.href ? `<a class="btn ghost sm" href="${p.href}">${esc(p.t)}</a>`
            : `<span class="now">${esc(p.t)}</span>`)).join('')}</nav>`;
}

const mins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

/* Previous / next, for the reader and for the workbench. Both built this by hand
   with four copies of the same flex-spacer literal. Each side is {href, t}
   or null. */
function pagenav(prev, next) {
  const side = (o, cls, lbl) => (o
    ? `<a class="${cls}" href="${o.href}"><div class="lbl">${lbl}</div>
        <div class="t">${esc(o.t)}</div></a>`
    : '<span class="pagenav-gap"></span>');
  return `<nav class="pagenav">${side(prev, '', '\u2190 Previous')}${
    side(next, 'next', 'Next \u2192')}</nav>`;
}

/* Shown on the exercise page when it is already passed, and again the moment it
   passes. One wording, one place. */
const afterBox = (ex, ok) => (ok && ex.after
  ? `<div class="afterbox"><div class="lbl">Now that it compiles</div>${ex.after}</div>`
  : '');

/* Which exercise a URL names. viewWork and wireWork each had their own copy of
   this clamp, kept in step by hand. */
function pickEx(data, nRaw) {
  const n = Math.min(Math.max(1, +nRaw || 1), data.exercises.length);
  return data.exercises.find((e) => e.n === n) || data.exercises[0];
}

function ring(u) {
  if (!u.exercises) return '';
  const d = unitDone(u);
  const p = Math.round((d / u.exercises) * 100);
  return `<div class="ring${d === u.exercises ? ' done' : ''}" style="--p:${p}"
    data-n="${d}" title="${d} of ${u.exercises} exercises passed"></div>`;
}

function unitCard(u, i = 0) {
  if (!u.ready) {
    return `<div class="card unitcard stub stagger" style="--i:${i}" data-accent="${u.accent}">
      <div class="top"><span class="num">${String(u.num).padStart(2, '0')}</span>
        <span class="chip">soon</span></div>
      <h3>${esc(u.title)}</h3><p>${esc(u.blurb)}</p></div>`;
  }
  return `<a class="card unitcard stagger" style="--i:${i}" href="#/unit/${u.slug}" data-accent="${u.accent}">
    <div class="top">
      <span class="num">${String(u.num).padStart(2, '0')}</span>
      <span class="chip accent">${mins(u.mins)}</span>
      ${ring(u)}
    </div>
    <h3>${esc(u.title)}</h3>
    <p>${esc(u.blurb)}</p>
    <div class="foot">
      ${u.exercises ? `<span class="chip">${ico('wrench', 10)} ${u.exercises} exercises</span>` : ''}
      ${u.drills ? `<span class="chip">${ico('target', 10)} ${u.drills} drills</span>` : ''}
    </div>
  </a>`;
}

/* --------------------------------------------------------------------- */
/* home                                                                   */
/* --------------------------------------------------------------------- */

function viewHome() {
  const t = DB.totals;
  const ready = DB.units.filter((u) => u.ready);
  // "Where you left off" beats a fixed start button once you have started.
  const next = ready.find((u) => u.exercises && unitDone(u) < u.exercises) || ready[0];
  const s = P._streak;

  return `<div class="wrap">
    <section class="hero">
      <div>
        <span class="eyebrow">${t.ready} of ${t.units} units written</span>
        <h1>Learn Rust by <em>fighting the compiler</em>.</h1>
        <p class="lede">Every exercise here compiles for real — not a simulation, not a
          quiz. When rustc rejects your code, you get its actual diagnostic, and next to
          it a plain-English reading of what the borrow checker saw and why it cared.</p>
        <div class="actions">
          ${next ? `<a class="btn lg" href="#/unit/${next.slug}">${ico('play', 15)} ${
            unitDone(next) ? 'Continue' : 'Start'} — ${esc(next.title)}</a>` : ''}
          <a class="btn quiet lg" href="#/track">${ico('track', 15)} See the track</a>
        </div>
      </div>
      <div class="heroart"><img src="assets/ferris.png" alt="Ferris, the Rust mascot"></div>
    </section>

    <div class="statgrid">
      <div class="stat"><div class="n">${num(t.words)}</div><div class="l">words written</div></div>
      <div class="stat"><div class="n">${t.exercises}</div><div class="l">compiled exercises</div></div>
      <div class="stat"><div class="n">${t.drills}</div><div class="l">drills</div></div>
      <div class="stat"><div class="n">${mins(t.mins)}</div><div class="l">of reading</div></div>
      <div class="stat"><div class="n">${s.days || 0}${
        s.days ? ` <span style="font-size:.6em;color:var(--ferris)">${ico('flame', 13)}</span>` : ''
      }</div><div class="l">day streak${s.best > s.days ? ` · best ${s.best}` : ''}</div></div>
    </div>

    <div class="section-head"><h2>The track</h2>
      <span class="more">${t.ready} ready · ${t.units - t.ready} on the way</span></div>
    <div class="unitgrid">${DB.units.map(unitCard).join('')}</div>
  </div>`;
}

/* --------------------------------------------------------------------- */
/* the track                                                              */
/* --------------------------------------------------------------------- */

function viewTrack() {
  return `<div class="wrap" style="padding-top:26px">
    ${crumbs([{ t: 'Home', href: '#/' }, { t: 'The track' }])}
    <h1 class="pagetitle">The track</h1>
    <p style="color:var(--ink-2);max-width:70ch;margin:10px 0 24px">
      ${DB.totals.units} units, ordered so each one only needs what came before it.
      Read the note, then earn the unit at the workbench.</p>
    <div class="unitgrid">${DB.units.map(unitCard).join('')}</div>
  </div>`;
}

/* --------------------------------------------------------------------- */
/* the unit reader                                                        */
/* --------------------------------------------------------------------- */

/* A contents link names one section, which is almost always inside a collapsed
   <details>. Opening it is part of arriving — otherwise you land on a closed row
   and conclude the link is broken. */
function jumpTo(id) {
  const el = document.getElementById(id);
  if (!el) return;
  for (let n = el; n; n = n.parentElement) {
    if (n.tagName === 'DETAILS') n.open = true;
  }
  requestAnimationFrame(() => {
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    el.classList.add('landed');
    setTimeout(() => el.classList.remove('landed'), 2400);
  });
}

function sectionBlock(id, title, html, m, n, open) {
  return `<details class="sect" id="${id}" ${open ? 'open' : ''} data-mins="${m}">
    <summary>
      <span class="caret">${ico('chev', 15)}</span>
      ${n ? `<span class="n">${String(n).padStart(2, '0')}</span>` : ''}
      <h3>${esc(title)}</h3>
      <span class="chip">${m}m</span>
    </summary>
    <div class="body"><div class="prose">${html}</div></div>
  </details>`;
}

async function viewUnit(slug) {
  const meta = DB.units.find((u) => u.slug === slug);
  if (!meta || !meta.ready) return notFound();
  const u = await get(`data/unit/${slug}.json`);
  const idx = DB.units.findIndex((x) => x.slug === slug);
  const ready = DB.units.filter((x) => x.ready);
  const prev = DB.units.slice(0, idx).reverse().find((x) => x.ready);
  const next = DB.units.slice(idx + 1).find((x) => x.ready);

  /* Contents links are full routes, not bare fragments. A bare `#some-heading`
     would be parsed by this app's own hash router as a route, match nothing,
     and render the 404 — which is exactly what it did before. Routing the jump
     through `#/unit/<slug>/<id>` keeps deep links working and lets render()
     recognise it as a scroll within the page it is already showing. */
  const rail = u.parts.map((p) => {
    const head = `<li><a class="h2" href="#/unit/${slug}/${p.id}" data-id="${p.id}">${
      esc(p.title)}<span class="mins">${p.mins}m</span></a></li>`;
    return head + p.subs.map((s) =>
      `<li><a class="h3" href="#/unit/${slug}/${s.id}" data-id="${s.id}">${
        esc(s.text)}<span class="mins">${s.mins}m</span></a></li>`).join('');
  }).join('');

  // The first part opens by default: it carries the argument, and a page of
  // closed rows reads as an index rather than as something worth reading.
  const body = u.parts.map((p, pi) => {
    if (p.subs.length) {
      return `<div class="partband" id="${p.id}"><h2>${esc(p.title)}</h2><div class="line"></div>
          <span class="chip">${p.subs.length} topics · ${mins(p.mins)}</span></div>
        ${p.intro ? `<div class="prose">${p.intro}</div>` : ''}
        ${p.subs.map((s, i) => sectionBlock(s.id, s.text, s.html, s.mins, i + 1, pi === 0)).join('')}`;
    }
    return sectionBlock(p.id, p.title, p.intro, p.mins, null, pi === 0);
  }).join('');

  return `<div data-accent="${meta.accent}">
    <div class="readerbar"><div class="inner">
      <a class="btn ghost sm back" href="#/track">${ico('chev', 15)} <span>The track</span></a>
      <span class="title" style="flex:1">${esc(u.title)}</span>
      <button class="btn quiet sm" id="expandall" data-open="0">${ico('layers', 13)} <span>Expand all</span></button>
      <button class="btn quiet sm mobile-only" id="opensheet">${ico('layers', 13)} Contents</button>
      <button class="btn quiet sm toggle desk-only" data-toggle="hide-terms" data-key="rh-terms"
        title="Show or hide the highlighted terms">${ico('check', 12)} Terms</button>
      ${meta.exercises ? `<a class="btn sm" href="#/work/${slug}">${ico('wrench', 13)} Workbench</a>` : ''}
      <div class="progress" id="prog"></div>
    </div></div>

    <div class="wrap wide"><div class="readerlayout">
      <aside class="rail"><div class="eyebrow">In this unit</div><ol id="railol">${rail}</ol></aside>
      <div class="readercol">
        <header class="unithead">
          <span class="eyebrow">Unit ${String(u.num).padStart(2, '0')} · ${
            ready.findIndex((x) => x.slug === slug) + 1} of ${ready.length} written</span>
          <h1>${esc(u.title)}</h1>
          <div class="meta">
            <span class="chip accent">${ico('clock', 11)} ${mins(u.mins)}</span>
            <span class="chip">${num(u.words)} words</span>
            <span class="chip">${ico('layers', 11)} ${u.parts.length} parts</span>
            ${meta.exercises ? `<span class="chip">${ico('wrench', 11)} ${meta.exercises} exercises</span>` : ''}
            ${u.concepts.map((c) => `<span class="chip mono">${esc(c)}</span>`).join('')}
          </div>
        </header>
        ${u.lead ? `<div class="prose">${u.lead}</div>` : ''}
        ${body}
        ${meta.exercises ? `<div class="dashed" style="margin-top:36px;padding:20px;text-align:center">
          <div class="eyebrow">Now earn it</div>
          <p style="margin:8px 0 14px;color:var(--ink-2);font-size:var(--t-sm)">
            ${meta.exercises} exercises, compiled for real. ${unitDone(meta)} passed so far.</p>
          <a class="btn lg" href="#/work/${slug}">${ico('wrench', 15)} Open the workbench</a>
        </div>` : ''}
        ${pagenav(
          prev && { href: `#/unit/${prev.slug}`, t: prev.title },
          next && { href: `#/unit/${next.slug}`, t: next.title })}
      </div>
    </div></div>
  </div>`;
}

let railWatch = null;

function wireUnit() {
  const seg = $('#expandall');
  if (!seg) return;
  seg.addEventListener('click', () => {
    const open = seg.dataset.open === '0';
    $$('.sect').forEach((d) => { d.open = open; });
    seg.dataset.open = open ? '1' : '0';
    seg.querySelector('span').textContent = open ? 'Collapse all' : 'Expand all';
  });

  const sheetBtn = $('#opensheet');
  if (sheetBtn) sheetBtn.addEventListener('click', openSheet);

  const rail = $('#railol');
  const bar = $('#prog');
  const links = rail ? $$('a', rail) : [];
  const targets = links.map((a) => document.getElementById(a.dataset.id));

  /* Scroll fires up to ~120x/s during phone momentum scroll. Doing the work
     inline meant a full synchronous layout flush plus one getBoundingClientRect
     per heading — up to 22 — on every one of those. Coalesced to one pass per
     frame, and the class writes are skipped entirely when the active section has
     not changed, which is ~99% of frames. */
  let ticking = false;
  let active = -1;

  const measure = () => {
    ticking = false;
    if (bar) {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      bar.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + '%';
    }
    // The active rail entry is the last heading whose top is above the fold.
    let now = -1;
    for (let i = 0; i < targets.length; i++) {
      if (targets[i] && targets[i].getBoundingClientRect().top < 140) now = i;
    }
    if (now === active) return;
    active = now;
    links.forEach((a, i) => a.classList.toggle('on', i === active));
    if (active >= 0 && rail) {
      const a = links[active];
      const r = a.getBoundingClientRect(), rr = rail.parentElement.getBoundingClientRect();
      if (r.top < rr.top || r.bottom > rr.bottom) a.scrollIntoView({ block: 'nearest' });
    }
  };

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(measure);
  };

  addEventListener('scroll', onScroll, { passive: true, signal: railWatch.signal });
  measure();

  const sb = $('#sheetbody');
  if (sb && rail) sb.innerHTML = `<ol>${rail.innerHTML}</ol>`;
}

/* --------------------------------------------------------------------- */
/* the workbench                                                          */
/* --------------------------------------------------------------------- */

let ED = null;      // the mounted editor for the exercise on screen
let HINTS = 0;      // how many hints the reader has revealed here
let BUSY = false;

async function viewWork(slug, nRaw) {
  const meta = DB.units.find((u) => u.slug === slug);
  if (!meta || !meta.exercises) return notFound();
  const data = await get(`data/ex/${slug}.json`);
  const ex = pickEx(data, nRaw);

  const list = data.exercises.map((e) => `
    <a class="${e.n === ex.n ? 'on ' : ''}${passed(slug, e.n) ? 'passed' : ''}"
       href="#/work/${slug}/${e.n}">
      <span class="st">${passed(slug, e.n) ? '✓' : e.n}</span>
      <span class="nm">${esc(e.title)}</span>
    </a>`).join('');

  const done = unitDone(meta);

  return `<div class="wrap" data-accent="${meta.accent}">
    <div class="wblayout">
      <aside>
        <div class="eyebrow" style="padding:0 11px 8px">${esc(meta.title)} · ${done}/${meta.exercises}</div>
        <nav class="exlist">${list}</nav>
        <div style="padding:14px 11px 0;display:flex;flex-direction:column;gap:6px">
          <a class="btn quiet sm" href="#/unit/${slug}">${ico('book2', 13)} Back to the note</a>
          ${meta.drills ? `<a class="btn quiet sm" href="#/drills/${slug}">${ico('target', 13)} Drills</a>` : ''}
        </div>
      </aside>

      <div class="wb">
        ${crumbs([{ t: 'Track', href: '#/track' }, { t: meta.title, href: `#/unit/${slug}` },
                  { t: `Exercise ${ex.n}` }])}
        <div class="wbhead">
          <h1>${esc(ex.title)}</h1>
          <div class="meta">
            <span class="chip accent">${esc(ex.kind)}</span>
            ${ex.concept ? `<span class="chip mono">${esc(ex.concept)}</span>` : ''}
            ${ex.expect ? `<span class="chip mono">expect ${
              esc(ex.expect.code || ex.expect.msg)}</span>` : ''}
            ${passed(slug, ex.n) ? '<span class="chip ok">✓ passed</span>' : ''}
          </div>
        </div>
        <div class="wbbrief">${ex.brief}</div>

        <div class="editor" id="ed"></div>

        <div class="wbbar">
          <button class="btn" id="run">${ico('play', 14)} Run</button>
          <button class="btn quiet" id="hint">${ico('bulb', 13)} Hint</button>
          <button class="btn quiet" id="reset">${ico('reset', 13)} Reset</button>
          <button class="btn ghost" id="sol">Show solution</button>
          <span class="kbd desk-only"><kbd>⌘</kbd> <kbd>↵</kbd> to run</span>
        </div>

        <div id="hints"></div>
        <div class="out" id="out"></div>
        <div id="after">${afterBox(ex, passed(slug, ex.n))}</div>

        ${pagenav(
          data.exercises.find((e) => e.n === ex.n - 1) &&
            { href: `#/work/${slug}/${ex.n - 1}`,
              t: data.exercises.find((e) => e.n === ex.n - 1).title },
          data.exercises.find((e) => e.n === ex.n + 1) &&
            { href: `#/work/${slug}/${ex.n + 1}`,
              t: data.exercises.find((e) => e.n === ex.n + 1).title })}
      </div>
    </div>
  </div>`;
}

/* The compiler's answer, as HTML.
 *
 * Pulled out of doRun and made pure so it can be tested: it is the densest
 * markup in the app and the place a dropped class silently costs a reader the
 * difference between a passing and a failing test. Takes only data, touches no
 * DOM, returns a string.
 */
function renderOutput({ res, d, ex, code, rec, ok, testsRan }) {
  const verdict = ok
    ? (ex.tests ? 'Compiles, and every test passes.' : 'It compiles.')
    : (res.success ? 'It compiles, but the tests disagree.' : 'rustc said no.');

  let h = `<div class="verdict landing ${ok ? 'pass' : 'fail'}" style="--i:0">
    <span class="ic">${ok ? '\u2713' : '\u2715'}</span>
    <span>${verdict}</span>
    <span class="sub">attempt ${rec.tries}${
      rec.hints ? ` \u00b7 ${rec.hints} hint${rec.hints > 1 ? 's' : ''}` : ''}</span>
  </div>`;

  let i = 0;
  for (const e of d.errors) {
    h += `<div class="diag landing" style="--i:${++i}">
      <div class="dh">
        ${e.code ? `<span class="code">${esc(e.code)}</span>` : ''}
        <span class="msg">${esc(e.msg)}</span>
        ${e.line ? `<span class="where">line ${e.line}${e.inTests ? ' \u00b7 hidden tests' : ''}</span>` : ''}
      </div>
      ${e.inTests
        ? `<div class="why"><div class="lbl">${ico('bulb', 12)} This one is in the hidden tests</div>
           <p>The tests call into your code and could not. Usually that means a name or a
           signature does not match what they expect \u2014 check the exact function name,
           its parameters and its return type.</p></div>`
        : (e.line ? WB.snippet(code, e.line, e.col) : '')}
      ${!e.inTests && ex.diagnose[e.code] ? `<div class="why">
          <div class="lbl">${ico('bulb', 12)} What that actually means</div>
          ${ex.diagnose[e.code]}</div>` : ''}
      <details class="raw"><summary>rustc's own output</summary><pre>${esc(e.raw)}</pre></details>
    </div>`;
    if (e.code && !e.inTests) {
      h += `<div class="errlink"><a class="chip mono" target="_blank" rel="noopener"
        href="https://doc.rust-lang.org/error_codes/${esc(e.code)}.html">
        ${esc(e.code)} in the error index \u2197</a></div>`;
    }
  }

  if (testsRan) {
    h += d.tests.map((t) => `<div class="testrow landing ${t.ok ? 'ok' : 'no'}" style="--i:${++i}">
      <span class="dot"></span><span class="nm">${esc(t.name)}</span>
      ${t.panic ? `<span class="panic">${esc(t.panic.split('\n')[0])}</span>`
                : `<span class="panic quiet">${t.ok ? 'ok' : 'failed'}</span>`}
    </div>`).join('');
  }

  if (res.stdout && !testsRan) {
    h += `<div class="stdout landing" style="--i:${++i}"><div class="lbl">Program output</div>
      <pre>${esc(res.stdout)}</pre></div>`;
  }

  for (const w of d.warnings) {
    h += `<div class="testrow warn landing" style="--i:${++i}">
      <span class="dot"></span>
      <span class="nm">warning: ${esc(w.msg)}${w.line ? ` (line ${w.line})` : ''}</span></div>`;
  }

  return h;
}

function wireWork(slug, nRaw) {
  const host = $('#ed');
  if (!host) return;
  get(`data/ex/${slug}.json`).then((data) => {
    const ex = pickEx(data, nRaw);
    HINTS = 0;

    ED = WB.mountEditor(host, ex.starter, doRun);

    $('#reset').addEventListener('click', () => { ED.reset(); $('#out').innerHTML = ''; });
    $('#run').addEventListener('click', doRun);
    $('#sol').addEventListener('click', () => {
      ED.set(ex.solution);
      HINTS = (ex.hints || []).length;
      $('#hints').innerHTML = `<div class="hintbox"><div class="lbl">Solution</div>
        One correct answer, now in the editor. Run it, then change it and break it —
        that is where the understanding is.</div>`;
    });
    $('#hint').addEventListener('click', () => {
      const hs = ex.hints || [];
      if (HINTS >= hs.length) return;
      HINTS++;
      $('#hints').innerHTML = hs.slice(0, HINTS).map((h, i) =>
        `<div class="hintbox"><div class="lbl">Hint ${i + 1} of ${hs.length}</div>${esc(h)}</div>`).join('');
      if (HINTS >= hs.length) $('#hint').disabled = true;
    });

    /* A run takes a couple of seconds, and the reader can navigate during them.
       Every node this touches is therefore resolved BEFORE the await and checked
       for still being in the document after it — otherwise a compile that lands
       after a navigation writes its verdict into whatever exercise is on screen
       now. The whole body is wrapped so BUSY and the button are released on every
       path: leaving BUSY stuck true disables Run for the rest of the session. */
    async function doRun() {
      if (BUSY) return;
      BUSY = true;

      const btn = $('#run');
      const out = $('#out');
      const afterEl = $('#after');
      const stale = () => !out.isConnected;

      btn.disabled = true;
      host.classList.add('running');
      out.innerHTML = `<div class="verdict wait"><span class="ic"
        style="background:var(--ink-4)">…</span> compiling on play.rust-lang.org</div>`;

      const code = ED.value();
      try {
        let res;
        try {
          res = await WB.run(code, { tests: ex.tests });
        } catch (e) {
          if (stale()) return;
          out.innerHTML = `<div class="verdict fail"><span class="ic">!</span>
            ${e.message === 'offline'
              ? 'Could not reach the compiler. The workbench needs a network connection — this is not your code.'
              : esc(e.message)}</div>`;
          return;
        }
        if (stale()) return;

        const d = WB.parse(res);
        ED.mark(d.errors.filter((e) => !e.inTests).map((e) => e.line).filter(Boolean));

        const testsRan = d.tests.length > 0;
        const testsOk = testsRan && d.tests.every((t) => t.ok || t.ignored);
        // With no hidden tests the bar is simply "it compiles", which is the whole
        // task for a `fix` exercise. With tests, compiling is necessary and not enough.
        const ok = res.success && (!ex.tests || testsOk);

        const rec = markAttempt(slug, ex.n, ok, HINTS);

        out.innerHTML = renderOutput({ res, d, ex, code, rec, ok, testsRan });
        if (afterEl) afterEl.innerHTML = afterBox(ex, ok);

        if (ok) {
          $$('.exlist a').forEach((a) => {
            if (a.getAttribute('href').endsWith(`/${ex.n}`)) {
              a.classList.add('passed');
              const st = a.querySelector('.st');
              if (st) st.textContent = '\u2713';
            }
          });
          Companion.cheer(ex.n, unitDone(DB.units.find((u) => u.slug === slug)));
        }
      } finally {
        BUSY = false;
        btn.disabled = false;
        host.classList.remove('running');
      }
    }
  });
}

/* --------------------------------------------------------------------- */
/* drills                                                                 */
/* --------------------------------------------------------------------- */

async function viewDrills(slug) {
  const meta = DB.units.find((u) => u.slug === slug);
  if (!meta || !meta.drills) return notFound();
  const d = await get(`data/drills/${slug}.json`);
  return `<div class="wrap" data-accent="${meta.accent}" style="padding-top:24px;max-width:860px">
    ${crumbs([{ t: 'Track', href: '#/track' }, { t: meta.title, href: `#/unit/${slug}` }, { t: 'Drills' }])}
    <h1 class="pagetitle">${esc(meta.title)} · drills</h1>
    <p style="color:var(--ink-2);margin:8px 0 22px">Answer, then read why. ${d.questions.length} questions.</p>
    <div id="qs">${d.questions.map(questionCard).join('')}</div>
  </div>`;
}

function questionCard(q) {
  return `<div class="qcard" data-n="${q.n}" data-answer="${esc(q.answer)}">
    <div class="qtop"><span class="qn">${String(q.n).padStart(2, '0')}</span>
      ${q.answer.length > 1 ? '<span class="chip">choose all that apply</span>' : ''}</div>
    <div class="stem">${q.stem}</div>
    <div class="opts">${q.options.map((o) =>
      `<button class="opt" data-k="${o.key}"><span class="k">${o.key}</span><span>${o.text}</span></button>`
    ).join('')}</div>
    <div class="why" hidden><div class="lbl">Why</div>${q.why}</div>
  </div>`;
}

function wireDrills() {
  const host = $('#qs');
  if (!host) return;
  host.addEventListener('click', (e) => {
    const btn = e.target.closest('.opt');
    if (!btn) return;
    const card = btn.closest('.qcard');
    if (card.classList.contains('done')) return;
    const answer = card.dataset.answer;
    // Multi-answer questions accumulate until the count matches, then reveal.
    btn.classList.add('picked');
    if (card.querySelectorAll('.picked').length < answer.length) return;
    card.classList.add('done');
    $$('.opt', card).forEach((o) => {
      const right = answer.includes(o.dataset.k);
      if (right) o.classList.add('right');
      else if (o.classList.contains('picked')) o.classList.add('wrong');
    });
    card.querySelector('.why').hidden = false;
    touchStreak();
  });
}

/* --------------------------------------------------------------------- */
/* progress                                                               */
/* --------------------------------------------------------------------- */

function viewProgress() {
  const ready = DB.units.filter((u) => u.ready && u.exercises);
  const total = ready.reduce((n, u) => n + u.exercises, 0);
  const done = ready.reduce((n, u) => n + unitDone(u), 0);
  const s = P._streak;

  return `<div class="wrap" style="padding-top:26px;max-width:900px">
    ${crumbs([{ t: 'Home', href: '#/' }, { t: 'Progress' }])}
    <h1 class="pagetitle">Progress</h1>
    <div class="statgrid" style="margin-top:18px">
      <div class="stat"><div class="n">${done}/${total}</div><div class="l">exercises passed</div></div>
      <div class="stat"><div class="n">${s.days || 0}</div><div class="l">day streak</div></div>
      <div class="stat"><div class="n">${s.best || 0}</div><div class="l">best streak</div></div>
      <div class="stat"><div class="n">${
        Object.keys(P).filter((k) => k !== '_streak' && P[k].hints).length
      }</div><div class="l">needed a hint</div></div>
    </div>
    ${ready.map((u) => `
      <div class="section-head" data-accent="${u.accent}">
        <h2>${esc(u.title)}</h2>
        <span class="more">${unitDone(u)} of ${u.exercises}</span>
      </div>
      <div class="heat" data-accent="${u.accent}" style="max-width:420px">
        ${Array.from({ length: u.exercises }, (_, i) =>
          `<a href="#/work/${u.slug}/${i + 1}"><span class="${passed(u.slug, i + 1) ? 'on' : ''}"
             title="Exercise ${i + 1}"></span></a>`).join('')}
      </div>`).join('')}
    <div style="margin-top:34px" class="dashed">
      <div style="padding:14px 16px;font-size:var(--t-tiny);color:var(--ink-2)">
        Progress lives in this browser's local storage and is never sent anywhere.
        Clearing site data clears it.
        <button class="btn quiet sm" id="wipe" style="margin-left:10px">Reset everything</button>
      </div>
    </div>
  </div>`;
}

function wireProgress() {
  const b = $('#wipe');
  if (b) b.addEventListener('click', () => {
    if (!confirm('Erase all recorded progress in this browser?')) return;
    P = { _streak: { last: null, days: 0, best: 0 } };
    saveProgress();
    render();
  });
}

/* --------------------------------------------------------------------- */
/* glossary                                                               */
/* --------------------------------------------------------------------- */

let GLOSS = null;
let glossLetter = 'A';

/* Filtering lives here so the initial render and the search box cannot disagree
   about what counts as a match. */
function glossList(q) {
  return q
    ? GLOSS.filter((t) => t.t.toLowerCase().includes(q.toLowerCase()))
    : GLOSS.filter((t) => letterOf(t.t) === glossLetter);
}

async function viewGlossary() {
  if (!GLOSS) GLOSS = (await get('data/glossary.json')).terms;
  const letters = [...new Set(GLOSS.map((t) => letterOf(t.t)))].sort();
  if (!letters.includes(glossLetter)) glossLetter = letters[0] || 'A';
  const list = glossList('');
  return `<div class="wrap" style="padding-top:26px">
    ${crumbs([{ t: 'Home', href: '#/' }, { t: 'Glossary' }])}
    <h1 class="pagetitle">Glossary</h1>
    <p style="color:var(--ink-2);margin:8px 0 18px">${GLOSS.length} terms, each in one plain sentence.</p>
    <label class="searchbox" style="margin-bottom:14px;display:block;max-width:340px">
      <input id="gq" type="search" placeholder="Filter terms…"
        style="width:100%;padding-left:12px"></label>
    <div class="letters" id="letters">${letters.map((L) =>
      `<button ${L === glossLetter ? 'class="on"' : ''} data-l="${L}">${L}</button>`).join('')}</div>
    <div class="gridcards" id="gcards">${glossCards(list)}</div>
  </div>`;
}

const letterOf = (t) => {
  const c = t[0].toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
};

function glossCards(list) {
  if (!list.length) return '<p style="color:var(--ink-3)">Nothing matches.</p>';
  return list.map((t) => `<div class="gcard">
    <div class="t">${esc(t.t)}</div>
    ${t.x ? `<div class="x">${esc(t.x)}</div>` : ''}
    <div class="p">${esc(t.p)}</div>
    ${t.in?.length ? `<div class="in">${t.in.map((u) =>
      `<a class="chip" href="#/unit/${u.s}">${esc(u.n)}</a>`).join('')}</div>` : ''}
  </div>`).join('');
}

function wireGlossary() {
  const ls = $('#letters');
  if (ls) ls.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    glossLetter = b.dataset.l;
    $('#gq').value = '';
    render();
  });
  const gq = $('#gq');
  if (gq) {
    let t;
    gq.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        $('#gcards').innerHTML = glossCards(glossList(gq.value.trim()));
      }, 120);
    });
  }
}

/* --------------------------------------------------------------------- */
/* search                                                                 */
/* --------------------------------------------------------------------- */

/* Section titles and concepts live in their own document rather than in the
   manifest, because only this function reads them and the manifest loads on
   every page view. `get` caches, so it costs one fetch per session at most. */
async function searchAll(qs) {
  const q = qs.toLowerCase();
  const index = await get('data/search.json');
  const extra = Object.fromEntries(index.units.map((u) => [u.slug, u]));
  const hits = [];

  for (const u of DB.units) {
    if (!u.ready) continue;
    if (u.title.toLowerCase().includes(q) || u.blurb.toLowerCase().includes(q)) {
      hits.push({ k: 'Unit', t: u.title, s: u.blurb, href: `#/unit/${u.slug}` });
    }
    const e = extra[u.slug];
    if (!e) continue;
    for (const sec of e.sections) {
      if (sec.toLowerCase().includes(q)) {
        hits.push({ k: `${u.title} · section`, t: sec, s: '', href: `#/unit/${u.slug}` });
      }
    }
    for (const c of e.concepts) {
      if (c.toLowerCase().includes(q)) {
        hits.push({ k: `${u.title} · concept`, t: c, s: u.blurb, href: `#/unit/${u.slug}` });
      }
    }
  }
  return hits.slice(0, 60);
}

/* Split on the match in the RAW string, escape each piece, then join. Running
   the regex over already-escaped text lets a search for "amp" match inside the
   &amp; entity and render as literal broken markup. */
function hl(text, q) {
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
  return String(text).split(re).map((part, i) =>
    (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join('');
}

async function viewSearch(q) {
  const hits = await searchAll(q);
  return `<div class="wrap" style="padding-top:26px;max-width:820px">
    ${crumbs([{ t: 'Home', href: '#/' }, { t: 'Search' }])}
    <h1 style="font-size:var(--t-h3);font-weight:800">${hits.length} result${hits.length === 1 ? '' : 's'}
      for “${esc(q)}”</h1>
    <div class="card" style="margin-top:16px;padding:0;overflow:hidden">
      ${hits.map((h) => `<a class="hit" href="${h.href}">
        <div class="k">${esc(h.k)}</div>
        <div class="t">${hl(h.t, q)}</div>
        ${h.s ? `<div class="s">${hl(h.s.slice(0, 150), q)}</div>` : ''}
      </a>`).join('') || '<p style="padding:20px;color:var(--ink-3)">Nothing found.</p>'}
    </div>
  </div>`;
}

function notFound() {
  return `<div class="wrap" style="padding:70px 20px;text-align:center">
    <img src="assets/ferris.png" alt="" width="120" style="opacity:.55">
    <h1 style="font-size:var(--t-h3);font-weight:800;margin-top:14px">Not here.</h1>
    <p style="color:var(--ink-3);margin:8px 0 18px">That unit may not be written yet.</p>
    <a class="btn" href="#/track">See the track</a></div>`;
}

/* --------------------------------------------------------------------- */
/* the glossary popover                                                   */
/* --------------------------------------------------------------------- */

let pop = null;
function closePop() { if (pop) { pop.remove(); pop = null; } }

document.addEventListener('mouseover', (e) => {
  const t = e.target.closest('.term');
  if (!t || document.body.classList.contains('hide-terms')) return;
  closePop();
  pop = document.createElement('div');
  pop.className = 'pop';
  pop.innerHTML = `<div class="t">${esc(t.dataset.t)}</div>${esc(t.dataset.g)}`;
  document.body.appendChild(pop);
  const r = t.getBoundingClientRect();
  const w = pop.offsetWidth;
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + scrollX)) + 'px';
  // Above if there is room, below if not — a popover clipped by the viewport is
  // worse than one that flips.
  pop.style.top = (r.top > pop.offsetHeight + 16
    ? r.top + scrollY - pop.offsetHeight - 8
    : r.bottom + scrollY + 8) + 'px';
});
document.addEventListener('mouseout', (e) => {
  if (e.target.closest('.term')) closePop();
});
addEventListener('scroll', closePop, { passive: true });

/* --------------------------------------------------------------------- */
/* reading toggles                                                        */
/* --------------------------------------------------------------------- */

function syncToggles() {
  $$('[data-toggle]').forEach((b) => {
    let on = false;
    try { on = localStorage.getItem(b.dataset.key) === '1'; } catch (e) {}
    document.body.classList.toggle(b.dataset.toggle, on);
    b.style.opacity = on ? '0.55' : '1';
  });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-toggle]');
  if (!b) return;
  const on = !document.body.classList.contains(b.dataset.toggle);
  try { localStorage.setItem(b.dataset.key, on ? '1' : '0'); } catch (err) {}
  syncToggles();
});

/* --------------------------------------------------------------------- */
/* the mobile sheet                                                       */
/* --------------------------------------------------------------------- */

function openSheet() { $('#sheet').hidden = false; $('#scrim').hidden = false; }
function closeSheet() { $('#sheet').hidden = true; $('#scrim').hidden = true; }
$('#scrim').addEventListener('click', closeSheet);
$('#sheetclose').addEventListener('click', closeSheet);
$('#sheet').addEventListener('click', (e) => { if (e.target.closest('a')) closeSheet(); });

/* --------------------------------------------------------------------- */
/* chrome, router                                                         */
/* --------------------------------------------------------------------- */

const NAV = [
  { t: 'Track', href: '#/track', i: 'track' },
  { t: 'Progress', href: '#/progress', i: 'chart' },
  { t: 'Glossary', href: '#/glossary', i: 'book2' },
];

function paintChrome(hash) {
  $('#nav').innerHTML = NAV.map((n) =>
    `<a href="${n.href}" class="${hash.startsWith(n.href) ? 'on' : ''}">${esc(n.t)}</a>`).join('');
  $('#tabbar').innerHTML = [{ t: 'Home', href: '#/', i: 'book' }, ...NAV].map((n) =>
    `<a href="${n.href}" class="${
      n.href === '#/' ? (hash === '#/' ? 'on' : '') : (hash.startsWith(n.href) ? 'on' : '')
    }">${ico(n.i, 19)}${esc(n.t)}</a>`).join('');
  const t = DB?.totals;
  if (t) $('#footstats').textContent =
    `${t.ready}/${t.units} units · ${num(t.words)} words · ${t.exercises} exercises`;
}

/* What is currently painted, so an in-page jump can be told apart from a real
   navigation. Without this, clicking a contents entry would tear down and
   rebuild the whole unit just to scroll a few hundred pixels. */
let CURRENT = null;

async function render() {
  const hash = location.hash || '#/';
  const [, route, a, b] = hash.split('/');

  // A section link inside the unit already on screen is a scroll, not a route.
  if (route === 'unit' && b && CURRENT === `unit/${a}`) {
    closePop();
    closeSheet();
    jumpTo(b);
    return;
  }

  closePop();
  closeSheet();

  let html, after = null;
  try {
    if (!route) html = viewHome();
    else if (route === 'track') html = viewTrack();
    else if (route === 'unit') { html = await viewUnit(a); after = wireUnit; }
    else if (route === 'work') { html = await viewWork(a, b); after = () => wireWork(a, b); }
    else if (route === 'drills') { html = await viewDrills(a); after = wireDrills; }
    else if (route === 'progress') { html = viewProgress(); after = wireProgress; }
    else if (route === 'glossary') { html = await viewGlossary(); after = wireGlossary; }
    else if (route === 'search') { html = await viewSearch(decodeURIComponent(a || '')); }
    else html = notFound();
  } catch (e) {
    console.error(e);
    html = notFound();
  }

  app.innerHTML = html;
  CURRENT = route ? `${route}/${a ?? ''}` : '';
  paintChrome(hash);
  syncToggles();
  scrollTo({ top: 0, behavior: 'instant' });
  if (after) after();
  // Arriving at a unit via a section deep link: render first, then jump, so the
  // target exists and its <details> can be opened.
  if (route === 'unit' && b) jumpTo(b);
}

$('#theme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('rh-theme', next); } catch (e) {}
});

const qbox = $('#q');
qbox.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && qbox.value.trim()) {
    location.hash = '#/search/' + encodeURIComponent(qbox.value.trim());
  }
});

addEventListener('hashchange', render);

(async function start() {
  loadProgress();
  try {
    DB = await get('data/manifest.json');
  } catch (e) {
    app.innerHTML = '<div class="loading">Could not load the handbook data. '
      + 'Run <code>python3 build.py</code> and serve the directory.</div>';
    return;
  }
  await render();
})();
