/* The lock screen.
 *
 * Be clear about what this is: the check runs in the browser, so anyone who
 * opens devtools can walk past it. It is a front door, not a vault. The real
 * lock is Vercel's Deployment Protection, which never serves the page at all to
 * someone who has not authenticated. This exists because Vercel's own password
 * screen cannot be styled, and arriving at a stranger's grey form is a bad way
 * to meet a handbook.
 *
 * The password is not in this file. Only a salted SHA-256 of it is, and the salt
 * means a rainbow table of common passwords does not open it either.
 *
 * To change the password, run:
 *   node -e "crypto.subtle.digest('SHA-256',new TextEncoder().encode('rh:'+process.argv[1])).then(b=>console.log(Buffer.from(b).toString('hex')))" YOURPASSWORD
 * and paste the result into HASH below.
 */

const HASH = '8f9e2eb0d15a92b8ed6c1e21e6c47e8b2e21b3c3d1e0e5cbd2ae5a3f4d6b7c81';
const OPEN = 'rh-open';

async function digest(pw) {
  const bytes = new TextEncoder().encode('rh:' + pw);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function unlocked() {
  try { return localStorage.getItem(OPEN) === HASH; } catch (e) { return false; }
}

function build() {
  const el = document.createElement('div');
  el.className = 'gate';
  el.innerHTML = `
    <div class="gate-bg" aria-hidden="true"></div>
    <div class="gate-card">
      <img src="assets/ferris.png" alt="">
      <h1>Rust Handbook</h1>
      <p>Learn Rust by fighting the compiler.</p>
      <form>
        <input type="password" placeholder="Password" autofocus autocomplete="current-password">
        <button class="btn" type="submit">Open</button>
      </form>
      <div class="err"></div>
    </div>`;

  const form = el.querySelector('form');
  const input = el.querySelector('input');
  const err = el.querySelector('.err');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await digest(input.value) === HASH) {
      try { localStorage.setItem(OPEN, HASH); } catch (e2) {}
      el.remove();
      document.body.style.overflow = '';
    } else {
      err.textContent = 'Not that one.';
      input.value = '';
      input.focus();
    }
  });

  return el;
}

/* Disabled by default: an open handbook is the point. Set GATE to true, and set
   a real HASH above, to put the door back. */
const GATE = false;

if (GATE && !unlocked()) {
  document.body.style.overflow = 'hidden';
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(build()));
}
