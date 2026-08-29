/* Headless smoke test for the views.
 *
 * app.js is written against the DOM, so this stubs just enough of one to load
 * it, then calls each view function and checks the HTML it produced. It is not
 * a browser and it does not prove the page looks right — it proves the templates
 * are well-formed, that every view reads fields the data actually has, and that
 * no view throws. Those are the failures that would otherwise show up as a blank
 * page with one line in the console.
 *
 *   node test_views.mjs      (needs `python3 build.py` to have run)
 */

import fs from 'fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? `\n          ${extra}` : ''}`);
};

// --- the smallest DOM that lets app.js load ---------------------------
const noop = () => {};
const el = () => new Proxy({
  innerHTML: '', textContent: '', style: {}, dataset: {}, hidden: false, value: '',
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  addEventListener: noop, removeEventListener: noop, appendChild: noop, remove: noop,
  querySelector: () => el(), querySelectorAll: () => [], closest: () => null,
  getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  scrollIntoView: noop, focus: noop, setRangeText: noop, getAttribute: () => '',
  offsetWidth: 0, offsetHeight: 0, scrollWidth: 0,
}, { get: (t, k) => (k in t ? t[k] : el()) });

const store = {};
globalThis.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
};
globalThis.document = {
  documentElement: { dataset: {}, scrollHeight: 1000, clientHeight: 500, scrollTop: 0 },
  body: { classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, style: {}, appendChild: noop },
  querySelector: () => el(),
  querySelectorAll: () => [],
  addEventListener: noop,
  createElement: () => el(),
};
globalThis.window = globalThis;
globalThis.addEventListener = noop;
globalThis.scrollTo = noop;
globalThis.location = { hash: '#/' };
globalThis.innerWidth = 1200;
globalThis.scrollX = 0; globalThis.scrollY = 0;
globalThis.confirm = () => false;
globalThis.setTimeout = (f) => f;
globalThis.clearTimeout = noop;

// data/ is read off disk rather than over HTTP
globalThis.fetch = async (url) => {
  const p = url.replace(/^\//, '');
  if (!fs.existsSync(p)) return { ok: false, status: 404 };
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) };
};

// --- load the real files ----------------------------------------------
globalThis.Vim = eval(fs.readFileSync('assets/vim.js', 'utf8') + '\nVim');
const WB = eval(fs.readFileSync('assets/workbench.js', 'utf8') + '\nWB');
globalThis.WB = WB;
globalThis.Companion = { cheer: noop, say: noop, hide: noop };

const appSrc = fs.readFileSync('assets/app.js', 'utf8');
// The IIFE at the bottom kicks off a fetch we do not want during import.
const ctx = eval(
  appSrc.replace(/\(async function start\(\)[\s\S]*$/, '') +
  '\n({viewHome, viewTrack, viewUnit, viewWork, viewDrills, viewProgress, viewGlossary,' +
  ' viewSearch, notFound, unitCard, ring, renderOutput, setDB: (d) => { DB = d; }, getP: () => P})'
);

const DB = JSON.parse(fs.readFileSync('data/manifest.json', 'utf8'));
ctx.setDB(DB);

// --- an HTML well-formedness check ------------------------------------
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'path', 'circle', 'source']);
function unbalanced(html) {
  const stack = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let m;
  while ((m = re.exec(html))) {
    const [, close, tag, self] = m;
    if (VOID.has(tag.toLowerCase()) || self) continue;
    if (close) {
      if (stack.pop() !== tag) return `</${tag}> did not close the open element`;
    } else stack.push(tag);
  }
  return stack.length ? `never closed: <${stack.join('>, <')}>` : null;
}

const check = (name, html, mustContain = []) => {
  const bad = unbalanced(html);
  ok(`${name} — balanced tags`, !bad, bad || '');
  ok(`${name} — no stray undefined`, !/\bundefined\b/.test(html),
     (html.match(/.{40}undefined.{40}/) || [''])[0]);
  for (const s of mustContain) ok(`${name} — contains ${JSON.stringify(s)}`, html.includes(s));
};

console.log('--- views render ---');
check('viewHome', ctx.viewHome(), ['Learn Rust by', 'Ownership', 'day streak']);
check('viewTrack', ctx.viewTrack(), ['The track', 'Lifetimes']);
check('notFound', ctx.notFound());
check('viewProgress', ctx.viewProgress(), ['exercises passed']);
check('viewSearch', await ctx.viewSearch('ownership'), ['result', 'Ownership']);

console.log('--- async views ---');
check('viewUnit', await ctx.viewUnit('05-ownership'),
      // structural, not prose — headings get reworded, the shape should not
      ['class="readercol"', 'class="rail"', 'Open the workbench',
       'class="memory"', 'class="term"', 'class="callout gotcha"', 'class="codeblock bad"']);
check('viewWork ex1', await ctx.viewWork('05-ownership', 1),
      ['The function ate your string', 'id="ed"', 'Run', 'id="vim"', 'aria-pressed']);
check('viewWork ex8', await ctx.viewWork('05-ownership', 8), ['Drop runs in reverse']);
check('viewDrills', await ctx.viewDrills('05-ownership'), ['drills', 'class="opt"']);
// term COUNT is content that grows; assert the shape, not the number
check('viewGlossary', await ctx.viewGlossary(),
      ['Glossary', 'terms, each in one plain sentence', 'class="gcard"', 'id="letters"']);

console.log('--- contents links are routes, not bare fragments ---');
/* Regression: rail links used to be href="#some-heading". This app is a hash
   router, so that hash was parsed as a route, matched nothing, and rendered the
   404 — clicking any contents entry threw you off the page. */
{
  const html = await ctx.viewUnit('05-ownership');
  const hrefs = [...html.matchAll(/<a class="h[23]" href="([^"]+)"/g)].map((m) => m[1]);
  ok('rail has links', hrefs.length > 10, String(hrefs.length));
  ok('every rail link is a /unit/ route',
     hrefs.every((h) => h.startsWith('#/unit/05-ownership/')),
     hrefs.filter((h) => !h.startsWith('#/unit/')).slice(0, 3).join(', '));
  ok('no bare-fragment link anywhere in the unit view',
     !/href="#[a-z][^/"]*"/.test(html),
     (html.match(/href="#[a-z][^/"]*"/) || [''])[0]);
  // and the router must recognise that shape as a jump within the same unit
  const [, route, a, b] = '#/unit/05-ownership/moving'.split('/');
  ok('router splits it into unit + slug + section', route === 'unit' && a === '05-ownership' && b === 'moving');
}

console.log('--- compiler output rendering ---');
/* Regression: a batch edit once dropped the ok/no class from the test rows, so
   every dot rendered grey and a failing test looked identical to a passing one.
   Nothing caught it, because the rendering lived inside a closure. It is a pure
   function now, so it is checkable. */
{
  const ex = (await (await fetch('data/ex/05-ownership.json')).json()).exercises[0];
  const rec = { tries: 2, hints: 1 };

  const fail = ctx.renderOutput({
    res: { success: false, stdout: '', stderr: '' },
    d: { errors: [{ code: 'E0382', msg: 'borrow of moved value: `s`', line: 8, col: 16,
                    inTests: false, raw: 'error[E0382]: ...' }], warnings: [], tests: [] },
    ex, code: 'a\nb\nc\nd\ne\nf\ng\nlet x = s;\n', rec, ok: false, testsRan: false,
  });
  ok('failure verdict', fail.includes('verdict landing fail'));
  ok('error code shown', fail.includes('>E0382<'));
  ok('our explanation is attached', fail.includes('What that actually means'));
  ok('links to the error index', fail.includes('error_codes/E0382.html'));
  ok('raw rustc output kept', fail.includes("rustc's own output"));
  ok('fail html is balanced', !unbalanced(fail), unbalanced(fail) || '');

  const mixed = ctx.renderOutput({
    res: { success: true, stdout: 'running 2 tests', stderr: '' },
    d: { errors: [], warnings: [],
         tests: [{ name: 't::a', ok: true, panic: null },
                 { name: 't::b', ok: false, panic: 'assertion failed' }] },
    ex, code: '', rec, ok: false, testsRan: true,
  });
  ok('passing test row carries .ok', /testrow landing ok["\s]/.test(mixed), mixed.match(/testrow[^"]*/)?.[0]);
  ok('failing test row carries .no', /testrow landing no["\s]/.test(mixed));
  ok('pass and fail rows differ', mixed.includes('landing ok') && mixed.includes('landing no'));
  ok('panic surfaced', mixed.includes('assertion failed'));
  ok('mixed html is balanced', !unbalanced(mixed), unbalanced(mixed) || '');

  const pass = ctx.renderOutput({
    res: { success: true, stdout: '', stderr: '' },
    d: { errors: [], warnings: [], tests: [{ name: 't::a', ok: true, panic: null }] },
    ex, code: '', rec, ok: true, testsRan: true,
  });
  ok('pass verdict', pass.includes('verdict landing pass') && pass.includes('every test passes'));

  const hidden = ctx.renderOutput({
    res: { success: false, stdout: '', stderr: '' },
    d: { errors: [{ code: 'E0425', msg: 'cannot find function', line: 40, col: 1,
                    inTests: true, raw: 'x' }], warnings: [], tests: [] },
    ex, code: 'one line\n', rec, ok: false, testsRan: false,
  });
  ok('hidden-test error is explained as such', hidden.includes('in the hidden tests'));
  ok('hidden-test error does not echo a line the reader cannot see', !hidden.includes('class="snip"'));
}

console.log('--- stub units do not link ---');
/* Synthesised rather than searched for. Every unit is `ready` now, so a search
   returned undefined and killed the whole suite before its last three checks —
   but the stub branch of unitCard is live code and deserves coverage whatever
   the content happens to look like today. */
const stub = { ...DB.units[0], ready: false, exercises: 0, drills: 0 };
const card = ctx.unitCard(stub, 0);
ok('stub card is not a link', !card.includes('<a '), card.slice(0, 80));
ok('stub card says soon', card.includes('soon'));

console.log('--- out-of-range exercise clamps rather than throwing ---');
const clamped = await ctx.viewWork('05-ownership', 99);
ok('clamped to the last exercise', clamped.includes('Drop runs in reverse'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
