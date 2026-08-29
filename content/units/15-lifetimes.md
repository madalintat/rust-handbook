---
num: 15
slug: 15-lifetimes
title: Lifetimes
accent: ferris
concepts: lifetime, lifetime elision, region, static, dangling reference, variance, borrow checker
needs: 05-ownership, 06-borrowing, 07-slices
blurb: Not how long a value lives — a claim the compiler checks. Elision, structs that borrow, and why 'a is not a duration.
---

%% Lifetimes are where people bounce off Rust, and it is usually the first thing they were told that did the damage. A lifetime annotation does not make anything live longer. It does not keep anything alive. It is not a dial you are setting.

`'a` is a **name for a region of code**. Writing `&'a str` makes a *claim* — this reference is valid for at least region `'a` — which the compiler then checks against what your program actually does. You are describing a relationship that already exists. You are not creating one.

Almost every lifetime misconception dissolves once that lands, so it is worth spending a part on before anything else.

## The sentence to unlearn

### You are not setting anything

```rust
fn longest<'a>(a: &'a str, b: &'a str) -> &'a str {
    if a.len() >= b.len() { a } else { b }
}
```

Nothing in that signature makes `a` or `b` live one instruction longer. Both
strings live exactly as long as the caller's scopes say they do, whether this
function exists or not. What the signature states is a contract in three parts:

- both arguments are valid for some region — call it `'a`
- the return value is valid for that same region
- it is the *caller's* job to find an `'a` where all three hold

The caller supplies the region. The function only gives it a name so the three
claims can refer to the same thing.

:::note
An annotation is a **claim**, checked. `&'a T` means "valid for at least `'a`",
never "made to last `'a`". A false claim gets you an error, not a longer-lived
value.
:::

### A region is a piece of code, not a stretch of time

:::memory what 'a actually names
 fn main() {
     let text  = String::from("hello world");     ┐
     let other = String::from("hi");              │  'a — the region over
     let best  = longest(&text, &other);          │       which both borrows
     println!("{best}");                          │       must be valid
 }   ← other dropped, then text dropped           ┘
:::

The compiler solves for `'a`: it picks the smallest region making every claim
true. Here `'a` runs from the two borrows to the last use of `best`. If no
region satisfies everything, that failure *is* the error you are reading.

:::compare
**C++** — `std::string_view` into a temporary compiles happily and reads freed
memory. The validity of a reference is documented, at best, in a comment. `'a`
is the same idea with a checker bolted on.

**Java / Python / Go** — nothing to learn here, because a collector keeps alive
anything still reachable. That is a real convenience and you pay a runtime for
it.
:::

## The bug this exists to prevent

### A reference outliving what it points at

```c
const char *greeting(void) {
    char buf[16];
    strcpy(buf, "hello");
    return buf;              // buf's frame is gone at return
}
```

The caller gets an address into a stack frame that has already been reused. It
usually prints correctly in a debug build and garbage under load — the worst
outcome, because then it ships.

```rust,bad
fn greeting() -> &str {      // error[E0106]: missing lifetime specifier
    let s = String::from("hello");
    &s
}
```

`E0106` is the compiler saying *I cannot tell what this borrows from.* There are
no input references, so there is no region to name and nothing to tie the output
to. Name one anyway and you get the second objection:

```rust,bad
fn greeting() -> &'static str {
    let s = String::from("hello");
    &s        // error[E0515]: cannot return reference to local variable `s`
}
```

The claim is now well-formed and false. `s` is dropped at the closing brace; the
reference would point at a dead frame.

:::gotcha
`E0515` can never be fixed by adding a lifetime. No annotation makes a local
outlive its own function — that is the entire point of the rule. The fix is to
return an owned value, or to borrow from something the caller already owns.

```rust,good
fn greeting() -> String {
    String::from("hello")
}
```
:::

## Elision: why you almost never write these

### The three rules

`fn first_word(s: &str) -> &str` compiles with no annotations at all. Not
because it has no lifetimes — because the compiler wrote them for you.

:::note
**Lifetime elision**, applied in order to every `fn` signature:

1. Each elided lifetime in a **parameter** becomes its own fresh parameter.
2. If there is exactly **one** input lifetime, it is assigned to every elided
   **output** lifetime.
3. If a parameter is `&self` or `&mut self`, **`self`'s** lifetime is assigned to
   every elided output lifetime.

If any output lifetime is still unassigned, that is `E0106`.
:::

| you write | rustc expands it to | why |
|---|---|---|
| `fn len(s: &str) -> usize` | `fn len<'a>(s: &'a str) -> usize` | rule 1; no output borrow |
| `fn trim(s: &str) -> &str` | `fn trim<'a>(s: &'a str) -> &'a str` | rules 1 then 2 |
| `fn pick(a: &str, b: &str) -> &str` | — | rule 1 gives `'a` and `'b`; 2 and 3 do not apply → `E0106` |
| `fn name(&self) -> &str` | `fn name<'a>(&'a self) -> &'a str` | rules 1 then 3 |

The rules are not clever, and that is deliberate. They encode the only sensible
reading: **if a function borrows from exactly one place, whatever it returns
borrows from that place.** Where more than one reading is sensible, elision
refuses to guess and makes you write it.

### When elision guesses, and guesses wrong

Rule 3 is the one that bites, because it fires silently.

```rust,bad
impl Matcher {
    fn find(&self, text: &str) -> &str {   // rule 3: returns &'self str
        text                               // error[E0621]
    }
}
```

You meant "a slice of `text`". Elision heard "a slice of `self`". Say what you
meant:

```rust,good
fn find<'t>(&self, text: &'t str) -> &'t str {
    text
}
```

Note what changed: one lifetime name, no change to any value's actual life. The
signature now describes the relationship that was true all along.

## Structs that borrow

### What `struct Parser<'a>` really means

```rust
struct Parser<'a> {
    src: &'a str,
    pos: usize,
}
```

:::note
`<'a>` on a struct means: **a value of this type may not outlive whatever it
borrowed.** The parameter is not a field and holds no data. It is a constraint
carried around in the type.
:::

Every `impl` block has to carry it too, because the type is not `Parser` — it is
`Parser<'a>` for some `'a`.

```rust
impl<'a> Parser<'a> {
    fn rest(&self) -> &'a str {
        &self.src[self.pos..]
    }
}
```

That `'a` on the return type is doing real work. Elided, rule 3 would tie the
result to `&self`, so the returned slice would die with the `Parser`. Written
out, it says the slice comes from the *source text* — which outlives the parser
— and callers may keep it after the parser is gone.

:::gotcha
A struct holding `&'a str` is a **view**. It cannot be stored in a `static`,
cannot be returned from the function that owns the buffer, and cannot be handed
to a thread. The moment one of those becomes a requirement, the field wanted to
be a `String`. Changing the field is a smaller change than winning the argument
about the annotation.
:::

## `'static`, which is two different things

The single most reliable source of confusion in the language, because the same
five characters mean unrelated things depending on where they sit.

| written | means | satisfied by |
|---|---|---|
| `&'static str` | *this reference* is valid for the whole run | `"hello"`, a leaked `Box`, a `static` item |
| `T: 'static` | *this type* contains no borrow shorter than the program | `String`, `i32`, `Vec<u8>`, `&'static str` |

The bound is the one people misread. `T: 'static` does **not** mean the value
lives forever, and does not mean it is a literal. It means the type has no
short-lived reference anywhere inside it, so a value of that type could be kept
around indefinitely if you chose to. A freshly allocated `String` satisfies it.
A `&'a str` for some local `'a` does not.

:::gotcha
`thread::spawn` requires `F: 'static`. Read as "must live forever", this sends
people to `Box::leak` or `&'static`. It only means the closure may not capture a
borrow of a local, because the thread may still be running after that local
dies. `move` an owned `String` in and the bound is satisfied.
:::

## When lifetimes fight you

### Variance, mentioned and then left alone

A `&'long T` is accepted where a `&'short T` is wanted — a longer-lived
reference is usable wherever a shorter one would do. That is **covariance**, and
it is why most code never notices lifetimes have a subtyping relation at all.

`&'a mut T` is **invariant** in `T`: no substituting a different lifetime
inside, because writing through the reference could store a short-lived value
where a long-lived one is expected. You will meet this perhaps twice, in a
message reading "lifetime may not live long enough" about a `&mut`. Look it up
on the day.

### The habit that actually resolves these

Reach for the annotation last, not first. Signatures needing three lifetime
parameters are usually describing data that is shaped wrong.

- borrowing where a `clone` costs less than the argument about it
- a struct of borrows that wanted to be a struct of values
- a returned view that wanted to be a returned `String`

:::note
**The habit.** When a lifetime error will not resolve, stop editing annotations
and ask: *should this own its data instead?* `String` over `&'a str`, `Vec<T>`
over `&'a [T]`.

The annotation was faithfully describing a constraint. You did not want the
constraint.
:::
