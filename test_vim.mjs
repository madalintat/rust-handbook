/* Vim mode checks.
 *
 * The motion and operator logic is pure, so none of this needs a DOM. Each case
 * writes the buffer with | marking the cursor, sends keys, and compares against
 * the expected buffer-with-cursor. That notation is worth the small parser: a
 * failing case reads as the edit you meant to make.
 *
 *   node test_vim.mjs
 */

import fs from 'fs';

const Vim = eval(fs.readFileSync('assets/vim.js', 'utf8') + '\nVim');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? `\n          ${extra}` : ''}`);
};

/* "ab|c" -> {text: "abc", cur: 2} */
function parse(s) {
  const cur = s.indexOf('|');
  return { text: s.replace('|', ''), cur: cur < 0 ? 0 : cur };
}
const show = (text, cur) => text.slice(0, cur) + '|' + text.slice(cur);

/* Send a key string. Keys are single characters; <Esc> and <C-r> are spelled. */
function keys(v, s) {
  const seq = s.match(/<[^>]+>|./gs) || [];
  for (const k of seq) {
    if (k === '<Esc>') v.key('Escape');
    else if (k === '<CR>') v.key('Enter');
    else if (k === '<C-r>') v.key('R', { ctrl: true });
    else if (v.state.mode === 'insert') {
      // The real editor lets the textarea type; emulate that here.
      const { cur } = v.state;
      v.text = v.text.slice(0, cur) + k + v.text.slice(cur);
      v.setCursor(cur + 1);
    } else v.key(k);
  }
}

function t(name, start, seq, want) {
  const { text, cur } = parse(start);
  const v = Vim.create();
  v.text = text;
  v.setCursor(cur);
  keys(v, seq);
  const got = show(v.text, v.state.cur);
  ok(`${name.padEnd(34)} ${JSON.stringify(seq)}`, got === want,
     `want ${JSON.stringify(want)}\n          got  ${JSON.stringify(got)}`);
}

const L = 'let x = 1;\nlet y = 2;\nlet z = 3;';

console.log('--- motions ---');
t('h and l', 'ab|cd', 'hh', '|abcd');
t('l stops at end of line', 'abc|d\nef', 'lll', 'abc|d\nef');
t('h stops at start of line', 'ab\nc|d', 'hhh', 'ab\n|cd');
t('w by word', '|let x = 1;', 'w', 'let |x = 1;');
t('w three times', '|let x = 1;', 'www', 'let x = |1;');
t('b back a word', 'let x = |1;', 'b', 'let x |= 1;');
t('e to word end', '|let x', 'e', 'le|t x');
t('0 to line start', 'let |x', '0', '|let x');
t('^ to first non-blank', '    let |x', '^', '    |let x');
t('$ to line end', '|let x;', '$', 'let x|;');
t('j keeps the column', 'let |x = 1;\nlet y = 2;', 'j', 'let x = 1;\nlet |y = 2;');
t('j past a short line keeps want', 'let x = |1;\nab\nlet z = 3;', 'jj', 'let x = 1;\nab\nlet z = |3;');
t('gg to top', L, 'jjgg', '|let x = 1;\nlet y = 2;\nlet z = 3;');
t('G to bottom', L, 'G', 'let x = 1;\nlet y = 2;\n|let z = 3;');
t('2G to line 2', L, '2G', 'let x = 1;\n|let y = 2;\nlet z = 3;');
t('f finds forward', '|let x = 1;', 'f=', 'let x |= 1;');
t('t stops before', '|let x = 1;', 't=', 'let x| = 1;');
t('F finds back', 'let x = |1;', 'F=', 'let x |= 1;');
t('f reports a miss', '|abc', 'fz', '|abc');

console.log('\n--- counts ---');
t('3l', '|abcdef', '3l', 'abc|def');
t('2w', '|let x = 1;', '2w', 'let x |= 1;');
t('2j', L, '2j', 'let x = 1;\nlet y = 2;\n|let z = 3;');

console.log('\n--- insert ---');
t('i inserts before', 'ab|c', 'iX<Esc>', 'ab|Xc');
t('a inserts after', 'ab|c', 'aX<Esc>', 'abc|X');
t('A appends at end', 'a|bc\nz', 'AX<Esc>', 'abc|X\nz');
t('I inserts at first non-blank', '  ab|c', 'IX<Esc>', '  |Xabc');
t('o opens below', 'a|b\ncd', 'oX<Esc>', 'ab\n|X\ncd');
t('o keeps indent', '    a|b', 'oX<Esc>', '    ab\n    |X');
t('O opens above', 'ab\nc|d', 'OX<Esc>', 'ab\n|X\ncd');

console.log('\n--- delete and change ---');
t('x deletes a char', 'a|bc', 'x', 'a|c');
t('3x deletes three', 'a|bcde', '3x', 'a|e');
t('x stops at line end', 'ab|c\nde', '3x', 'a|b\nde');
t('dw deletes a word', 'let |x = 1;', 'dw', 'let |= 1;');
t('d$ to end of line', 'let |x = 1;', 'd$', 'let| ');
t('dd deletes the line', 'a\n|b\nc', 'dd', 'a\n|c');
t('2dd deletes two', '|a\nb\nc', '2dd', '|c');
t('D to end of line', 'ab|cd\nef', 'D', 'a|b\nef');
t('cw changes a word', 'let |x = 1;', 'cwY<Esc>', 'let |Y= 1;');
t('cc empties the line', 'a\n  b|b\nc', 'ccX<Esc>', 'a\n  |X\nc');
t('s substitutes a char', 'a|bc', 'sX<Esc>', 'a|Xc');

console.log('\n--- yank and put ---');
t('yy then p', '|ab\ncd', 'yyp', 'ab\n|ab\ncd');
t('dd then p', '|ab\ncd', 'ddp', 'cd\n|ab');
t('yw then P', '|ab cd', 'ywP', 'ab| ab cd');
t('x then p pastes after', '|abc', 'xp', 'b|ac');

console.log('\n--- undo ---');
t('u undoes a delete', '|abc', 'ddu', '|abc');
t('u undoes an insert', 'a|bc', 'iX<Esc>u', 'a|bc');
t('u then C-r redoes', '|abc', 'ddu<C-r>', '|');
t('u at the oldest change is safe', '|abc', 'uuu', '|abc');

console.log('\n--- visual ---');
t('v then l then d', '|abcd', 'vld', '|cd');
t('V then d takes the line', 'a\n|bb\nc', 'Vd', 'a\n|c');
t('v then y then p', '|abcd', 'vly$p', 'abcda|b');

console.log('\n--- indent ---');
t('>> indents', '|ab', '>>', '    |ab');
t('<< dedents', '    |ab', '<<', '|ab');
t('>> then << round-trips', '|ab', '>><<', '|ab');

console.log('\n--- misc ---');
t('r replaces a char', 'a|bc', 'rZ', 'a|Zc');
t('~ toggles case', '|abc', '~', 'A|bc');
t('J joins the next line', 'a|b\n  cd', 'J', 'ab| cd');
t('J at the last line does nothing', 'ab\nc|d', 'J', 'ab\nc|d');
t('Esc from a pending operator', 'a|bc', 'd<Esc>x', 'a|c');
t('an unknown key is swallowed', 'a|bc', 'Qx', 'a|c');

console.log('\n--- the cursor may not sit past the last character ---');
t('$ on a one-char line', 'a\n|b\nc', '$', 'a\n|b\nc');
t('l cannot leave the line', '|a\nb', 'lll', '|a\nb');

console.log('\n--- the : command line ---');
{
  let ran = 0;
  const v = Vim.create({ onRun: () => ran++ });
  v.text = 'abc'; v.setCursor(0);
  v.key(':'); ok('": " opens a command line', v.label() === ':', v.label());
  v.key('w'); ok('typing shows in the label', v.label() === ':w', v.label());
  v.key('Enter'); ok(':w runs the code', ran === 1, String(ran));
  ok('and closes the command line', v.label() === 'NORMAL', v.label());

  v.key(':'); v.key('q'); v.key('Enter');
  ok(':q says there is nothing to quit', /nothing to quit/.test(v.state.status), v.state.status);
  ok(':q does not run', ran === 1, String(ran));

  v.key(':'); v.key('z'); v.key('Enter');
  ok('an unknown command is named', v.state.status === 'not a command: :z', v.state.status);

  v.key(':'); v.key('w'); v.key('Escape');
  ok('Escape cancels without running', ran === 1 && v.label() === 'NORMAL', v.label());

  v.key(':'); v.key('w'); v.key('Backspace');
  ok('Backspace edits the command', v.label() === ':', v.label());
  v.key('Backspace');
  ok('Backspace on an empty command closes it', v.label() === 'NORMAL', v.label());

  const before = v.text;
  v.key(':'); v.key('w'); v.key('Enter');
  ok('a command never edits the buffer', v.text === before, v.text);
}

console.log('\n--- mode labels ---');
{
  const v = Vim.create(); v.text = 'abc'; v.setCursor(0);
  ok('starts in NORMAL', v.label() === 'NORMAL', v.label());
  v.key('i'); ok('i -> INSERT', v.label() === 'INSERT', v.label());
  v.key('Escape'); ok('Esc -> NORMAL', v.label() === 'NORMAL', v.label());
  v.key('v'); ok('v -> VISUAL', v.label() === 'VISUAL', v.label());
  v.key('Escape'); v.key('V'); ok('V -> V-LINE', v.label() === 'V-LINE', v.label());
  v.key('Escape'); v.key('2'); ok('a pending count shows', v.label() === '2', v.label());
  v.key('Escape'); v.key('d'); ok('a pending operator shows', v.label() === 'd', v.label());
}

console.log('\n--- the preference survives, which is the whole point ---');
{
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
  };
  ok('off by default', Vim.isOn() === false);
  Vim.setOn(true);
  ok('turning it on writes to storage', store['rh-vim'] === '1', JSON.stringify(store));
  ok('and reads back on', Vim.isOn() === true);
  Vim.setOn(false);
  ok('turning it off persists too', Vim.isOn() === false && store['rh-vim'] === '0');

  // A browser that refuses storage (private window, blocked site data) must not
  // throw — it just means the preference does not stick.
  globalThis.localStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  let threw = false;
  try { Vim.isOn(); Vim.setOn(true); } catch (e) { threw = true; }
  ok('blocked storage does not throw', !threw);
  ok('and reports off rather than crashing', Vim.isOn() === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
