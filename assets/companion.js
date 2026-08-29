/* Ferris, occasionally.
 *
 * Two voices, deliberately. The coach turns up when something went right and
 * says why it mattered. A bare "well done" is worth nothing, so every line
 * names the thing that was actually learned. The realist turns up when you have
 * been at it a while, and its job is to tell you to stop, because the failure
 * mode of a study tool is a person grinding at 2am and remembering none of it.
 *
 * It speaks rarely on purpose. A mascot that comments on everything is a mascot
 * you close, and then it cannot say the one thing that mattered.
 */

const Companion = (() => {
'use strict';

const START = Date.now();
let lastSpoke = 0;
let node = null;

/* Keyed by exercise number so the line can be specific about where you are in
   the unit rather than generic about effort. */
const FIRST = [
  'First one down. The compiler is not your adversary here. It is the only reviewer that reads every line.',
  'That is one. Notice you did not have to run it to find the bug: it was a compile error, so it could never have shipped.',
];

const MID = [
  'Halfway. The errors should be starting to look like sentences rather than noise.',
  'Still going. If a fix felt obvious that time, that is the model forming, not luck.',
  'Good. The ones that take three attempts are the ones you will still remember next month.',
];

const LAST = [
  'Unit finished. Every one of those compiled on real rustc, so you know it works rather than hoping.',
  'That is the unit. Worth going back and deliberately breaking one, reading an error you caused on purpose teaches more than reading one you did not.',
];

const REST = [
  'You have been at this a while. Reading a borrow error at hour two is a different skill from writing one at hour one. A break is not a loss.',
  'Long session. The compiler will still be here. Sleep is where the model actually consolidates.',
];

const pick = (a) => a[Math.floor(Math.random() * a.length)];

function say(text, ttl = 9000) {
  // At most one line every two minutes, whatever happens.
  if (Date.now() - lastSpoke < 120000) return;
  lastSpoke = Date.now();
  hide();
  node = document.createElement('div');
  node.className = 'companion';
  node.innerHTML = `<img src="assets/ferris.png" alt="">
    <div class="bubble">${text}</div>`;
  node.addEventListener('click', hide);
  document.body.appendChild(node);
  setTimeout(hide, ttl);
}

function hide() {
  if (node) { node.remove(); node = null; }
}

/* Called from the workbench when an exercise passes. `done` is how many of the
   unit's exercises are now green. */
function cheer(n, done) {
  const hours = (Date.now() - START) / 36e5;
  if (hours > 1.6) return say(pick(REST), 12000);
  if (done === 1) return say(pick(FIRST));
  if (n >= 7 || done >= 7) return say(pick(LAST), 11000);
  if (done % 3 === 0) return say(pick(MID));
}

return { cheer, say, hide };
})();
