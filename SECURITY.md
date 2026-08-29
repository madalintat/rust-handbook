# Security

## Reporting

Use [private vulnerability reporting](https://github.com/madalintat/rust-handbook/security/advisories/new).
Please do not open a public issue for a vulnerability.

You should get an acknowledgement within a few days.

## What is in scope

This is a static site with no server, no accounts, no database and no secrets.
Progress is kept in the visitor's own browser and is never transmitted. So the
realistic surface is small:

- Cross-site scripting through content that reaches the page unescaped
- Anything that lets a page write to a visitor's storage in a way it should not
- A supply-chain problem in the GitHub Actions workflows

## What is out of scope

- The site sends code you type to [play.rust-lang.org](https://play.rust-lang.org)
  to be compiled. That is the entire point of it, and it is stated on the page.
  Do not paste anything secret into the editor.
- Missing security headers on GitHub Pages, which the platform controls.
- Reports from automated scanners with no demonstrated impact.
