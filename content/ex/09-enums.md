---
unit: 09-enums
---

## 1. The variant nobody handled

@kind fix
@concept exhaustiveness
@expect E0004

A traffic signal has three states. `action` handles two of them and the compiler
has noticed. This is the entire argument for enums in one error message: the
missing case is not a runtime surprise, it is a build failure with a line
number.

Handle the third state. Amber means "slow down".

```starter
pub enum Signal {
    Red,
    Amber,
    Green,
}

pub fn action(s: &Signal) -> &'static str {
    match s {
        Signal::Red => "stop",
        Signal::Green => "go",
    }
}

pub fn run() -> Vec<&'static str> {
    vec![action(&Signal::Red), action(&Signal::Amber), action(&Signal::Green)]
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn covers_every_signal() {
        assert_eq!(run(), vec!["stop", "slow down", "go"]);
    }
}
```

```solution
pub enum Signal {
    Red,
    Amber,
    Green,
}

pub fn action(s: &Signal) -> &'static str {
    match s {
        Signal::Red => "stop",
        Signal::Amber => "slow down",
        Signal::Green => "go",
    }
}

pub fn run() -> Vec<&'static str> {
    vec![action(&Signal::Red), action(&Signal::Amber), action(&Signal::Green)]
}
```

@hint Read the error text. It names the exact variant that has no arm.
@hint Add an arm for `Signal::Amber` between the other two.

@diagnose E0004
`non-exhaustive patterns: &Signal::Amber not covered`. Under the scrutinee `s`
rustc writes `pattern &Signal::Amber not covered`, and it points separately at
the enum definition with `not covered` beside the `Amber` line. That second
underline tells you where the case it is missing came from.

`match` is an expression: a value has to come out of it, on every possible
input. If `s` were `Amber` there is no arm to produce one, so the match has no
value and the program is rejected before it runs.

The suggestion at the bottom offers `_ => todo!()`. Do not take it here.
Spelling the variant out is what makes the *next* added variant a compile error
too.

@after
This is the property worth building a habit around. Add `Signal::Flashing` to
the enum in six months and every `match` in the codebase that must change turns
into a compile error naming a file and a line. The compiler produces that list
for you, and it does not skip any of them.

The same change to a Java class hierarchy or a C `switch` is a silent success:
existing code keeps compiling and quietly takes the default path. Exhaustiveness
is the difference between a refactor the compiler drives and one you drive with
your fingers crossed.

## 2. A pattern of the wrong shape

@kind fix
@concept pattern matching
@expect E0023

`Reading::Sample` carries two things: a value and a timestamp. The match arm
below destructures it as if it carried one.

Fix the pattern and use both pieces. The test wants `"22 at t=5"`.

```starter
pub enum Reading {
    Offline,
    Sample(i32, u64),
}

pub fn describe(r: &Reading) -> String {
    match r {
        Reading::Offline => String::from("offline"),
        Reading::Sample(value) => format!("{value} at t=?"),
    }
}

pub fn run() -> (String, String) {
    (
        describe(&Reading::Offline),
        describe(&Reading::Sample(22, 5)),
    )
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn destructures_both_fields() {
        assert_eq!(
            run(),
            (String::from("offline"), String::from("22 at t=5"))
        );
    }
}
```

```solution
pub enum Reading {
    Offline,
    Sample(i32, u64),
}

pub fn describe(r: &Reading) -> String {
    match r {
        Reading::Offline => String::from("offline"),
        Reading::Sample(value, at) => format!("{value} at t={at}"),
    }
}

pub fn run() -> (String, String) {
    (
        describe(&Reading::Offline),
        describe(&Reading::Sample(22, 5)),
    )
}
```

@hint A tuple variant's pattern must have one sub-pattern per field, in order.
@hint `Reading::Sample(value, at)` binds both. Then interpolate `at` instead of the `?`.

@diagnose E0023
`this pattern has 1 field, but the corresponding tuple variant has 2 fields`.

A pattern is a shape, and the shape has to match the declaration exactly. There
is no positional-arguments-style shortening: `Sample(value)` is a claim that the
variant holds one thing, and it holds two.

Two ways to say "I only want the first": `Sample(value, _)` names the second and
throws it away, and `Sample(value, ..)` skips however many remain. Prefer `_`
when there is exactly one to skip, because it breaks loudly if a field is added
later, which is usually what you want. `..` stays quiet.

@after
Struct-like variants destructure by name rather than position, which is worth
preferring once a variant has three or more fields:

```rust
enum Reading {
    Sample { value: i32, at: u64 },
}
// Reading::Sample { value, .. }
```

Named fields are order-independent, self-documenting at the match site, and let
you add a field without touching patterns that used `..`. Tuple variants are for
one or two obvious payloads, like `Some(t)`, `Ok(v)` and `Voucher(id)`.

## 3. The guards that cover everything

@kind fix
@concept match guard
@expect E0004

Look at these two arms. Between them they clearly handle every `i32`: one for
negatives, one for everything else. The compiler disagrees, and it has a real
reason.

Make it compile without changing the behaviour.

```starter
pub fn sign(n: i32) -> &'static str {
    match n {
        x if x < 0 => "negative",
        0 => "zero",
        x if x > 0 => "positive",
    }
}

pub fn run() -> Vec<&'static str> {
    vec![sign(-7), sign(0), sign(7)]
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn classifies_all_three() {
        assert_eq!(run(), vec!["negative", "zero", "positive"]);
    }
}
```

```solution
pub fn sign(n: i32) -> &'static str {
    match n {
        x if x < 0 => "negative",
        0 => "zero",
        _ => "positive",
    }
}

pub fn run() -> Vec<&'static str> {
    vec![sign(-7), sign(0), sign(7)]
}
```

@hint The compiler ignores what a guard says. Count the arms that have no guard.
@hint By the time control reaches the last arm, `n` is neither negative nor zero, so the guard is carrying no weight.
@hint Replace the final `x if x > 0` with an unguarded `_`.

@diagnose E0004
`non-exhaustive patterns: i32::MIN..=-1_i32 and 1_i32..=i32::MAX not covered`.
That range list is the giveaway: rustc has thrown away both guarded arms and is
reporting what the *unguarded* patterns cover, which is only `0`.

This is deliberate. A guard is an arbitrary expression: it can call a function,
read a global, ask the clock. Deciding whether a set of such expressions covers
every input is undecidable in general, so rather than special-case simple
arithmetic the rule is uniform: **an arm with a guard contributes nothing to
exhaustiveness**.

The consequence in practice: guards are fine, but the arm that closes the match
must not have one.

@after
Worth knowing that a guard applies to the whole arm, including every alternative
in an or-pattern: `1 | 2 | 3 if flag` guards all three, not just the `3`.

A guard also cannot mutate anything, because the bindings inside it are borrowed
rather than moved, so it stays a pure test. That restriction is what makes it safe for the
compiler to evaluate arms in order and stop at the first that matches, without
worrying that a failed guard left something changed behind it.

## 4. Every arm the same type

@kind fix
@concept match
@expect E0308

`match` is an expression, so all its arms must agree on a type. Two of these
build a `String`; the first one hands back something else entirely.

Make `describe` return an owned `String` in every case.

```starter
pub enum Reply {
    Text(String),
    Code(u16),
    Empty,
}

pub fn describe(r: &Reply) -> String {
    match r {
        Reply::Text(s) => s,
        Reply::Code(c) => format!("code {c}"),
        Reply::Empty => String::new(),
    }
}

pub fn run() -> Vec<String> {
    vec![
        describe(&Reply::Text(String::from("hello"))),
        describe(&Reply::Code(404)),
        describe(&Reply::Empty),
    ]
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_arms_produce_strings() {
        assert_eq!(
            run(),
            vec![
                String::from("hello"),
                String::from("code 404"),
                String::new()
            ]
        );
    }
}
```

```solution
pub enum Reply {
    Text(String),
    Code(u16),
    Empty,
}

pub fn describe(r: &Reply) -> String {
    match r {
        Reply::Text(s) => s.clone(),
        Reply::Code(c) => format!("code {c}"),
        Reply::Empty => String::new(),
    }
}

pub fn run() -> Vec<String> {
    vec![
        describe(&Reply::Text(String::from("hello"))),
        describe(&Reply::Code(404)),
        describe(&Reply::Empty),
    ]
}
```

@hint `r` is a `&Reply`, so what type does `s` actually have in that first arm?
@hint Matching through a reference makes every binding a reference. `s` is a `&String`, and the function promised a `String`.
@hint You cannot move the string out of a borrowed `Reply`, so make a copy: `s.clone()`.

@diagnose E0308
`mismatched types: expected String, found &String`, underlining `s` in the first
arm.

The cause is match ergonomics. The scrutinee is `&Reply` and the pattern
`Reply::Text(s)` is not a reference pattern, so the compiler shifts the binding
mode to by-reference rather than rejecting the pattern. Every binding underneath
comes out borrowed: `s: &String`, not `String`.

That is exactly what you want almost always, because the alternative would be
moving the string out of something you only borrowed. Here it means the arm's
value has the wrong type, and the fix is to produce an owned value from the
borrow.

@diagnose E0507
You matched on the value rather than a reference somewhere, perhaps `match *r`,
or a signature taking `Reply` changed to something borrowed. Moving a `String` out of
a `&Reply` would leave the caller's enum holding a freed buffer, so it is
refused. Match on the reference and clone, or take the enum by value if you
genuinely want to consume it.

@after
`s.clone()` is honest here: the function promised an owned `String` and the
caller only lent you one, so an allocation is the price.

The design question is whether it needed to be. `fn describe(r: &Reply) -> Cow<'_, str>`
would borrow in the `Text` case and allocate only for `Code`. Or turn the
signature around and take `Reply` by value, so the first arm can move the string
out for free. Both are real answers; which is right depends on whether callers
still want their `Reply` afterwards.

## 5. The else that did not leave

@kind fix
@concept pattern matching
@expect E0308

`let else` binds on the happy path and runs the block otherwise. The block has
one hard requirement, and this one does not meet it.

Make it compile. A missing or unparseable argument means port 8080.

```starter
pub fn port_or_default(arg: Option<&str>) -> u16 {
    let Some(s) = arg else {
        8080
    };
    s.parse().unwrap_or(8080)
}

pub fn run() -> (u16, u16, u16) {
    (
        port_or_default(None),
        port_or_default(Some("9000")),
        port_or_default(Some("not a port")),
    )
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn falls_back_to_8080() {
        assert_eq!(run(), (8080, 9000, 8080));
    }
}
```

```solution
pub fn port_or_default(arg: Option<&str>) -> u16 {
    let Some(s) = arg else {
        return 8080;
    };
    s.parse().unwrap_or(8080)
}

pub fn run() -> (u16, u16, u16) {
    (
        port_or_default(None),
        port_or_default(Some("9000")),
        port_or_default(Some("not a port")),
    )
}
```

@hint Ask what would happen if the `else` block finished normally. What value would `s` have?
@hint The block has to leave the enclosing scope, with `return`, `break`, `continue` or a panic. Producing a `u16` is not leaving.
@hint `return 8080;`

@diagnose E0308
`else clause of let...else does not diverge`, with a note that it is expected to
have type `!`.

The reason is structural rather than stylistic. After the statement, `s` must be
in scope and bound, and the only pattern that matched is `Some`. If the `else`
block could fall through, control would arrive at the next line with `s`
unbound. So the block is required to have type `!`, the never type, meaning it
does not finish: `return`, `break`, `continue`, `std::process::exit`, or a
panic.

The `8080` in your block has type `u16`, which is a perfectly good value, and a
value is precisely what is not allowed there.

@after
This is why `let else` reads so well as a guard clause. Each one removes a case
and leaves the happy path unindented at the top level of the function, rather
than nesting one level deeper per check the way `if let` does:

```rust
let Some(cfg) = load_config() else { return Err("no config"); };
let Some(port) = cfg.port      else { return Err("no port"); };
let Ok(sock)   = bind(port)    else { return Err("bind failed"); };
```

Three checks, zero indentation, and every binding live for the rest of the body.
Compare that with three nested `if let` blocks and the difference is the whole
point of the feature.

## 6. Matching what you only borrowed

@kind fix
@concept binding mode
@expect E0507

`greet` takes the config by reference, which means it may look but not take.
The match below tries to take.

Make it compile without changing `greet`'s signature.

```starter
pub struct Config {
    pub name: Option<String>,
}

pub fn greet(c: &Config) -> String {
    match c.name {
        Some(n) => format!("hi {n}"),
        None => String::from("hi stranger"),
    }
}

pub fn run() -> (String, String) {
    let named = Config { name: Some(String::from("ferris")) };
    let anon = Config { name: None };
    (greet(&named), greet(&anon))
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn greets_both() {
        assert_eq!(
            run(),
            (String::from("hi ferris"), String::from("hi stranger"))
        );
    }
}
```

```solution
pub struct Config {
    pub name: Option<String>,
}

pub fn greet(c: &Config) -> String {
    match &c.name {
        Some(n) => format!("hi {n}"),
        None => String::from("hi stranger"),
    }
}

pub fn run() -> (String, String) {
    let named = Config { name: Some(String::from("ferris")) };
    let anon = Config { name: None };
    (greet(&named), greet(&anon))
}
```

@hint The scrutinee is `c.name`, a `String`-holding `Option` living inside something you borrowed.
@hint Match on a reference instead of on the place itself, and the compiler will hand you a borrowed binding rather than trying to move.
@hint `match &c.name {`, one character. `c.name.as_ref()` also works.

@diagnose E0507
`cannot move out of c.name which is behind a shared reference`, with
`data moved here` under `n` and a note that `String` does not implement `Copy`.

Read what the pattern is asking for. `Some(n)` with a by-value scrutinee means
"take the `String` out and call it `n`". Doing that would leave `c.name` holding
a variant whose payload has been removed, and `c` belongs to the caller, who
would then be looking at a freed buffer.

Once you match on `&c.name` instead, match ergonomics take over: the binding
mode shifts to by-reference, `n` becomes a `&String`, nothing moves, and
`format!` is happy to interpolate a reference.

@diagnose E0308
You reached for `c.name.as_ref()` or `as_deref()` and the arm types no longer
line up. `as_ref()` turns `&Option<String>` into `Option<&String>`, so `n` is a
`&String`; `as_deref()` gives `Option<&str>`, so `n` is a `&str`. Both
interpolate fine in `format!`. If the error names the `None` arm instead, the
two arms are producing different types, so make both produce an owned `String`.

@after
`&Option<T>` and `Option<&T>` are different types, and the bridge between them
is `as_ref`. The first is a reference to the whole enum, tag included; the
second is an enum whose payload happens to be a reference, and is the shape you
want to pass to other functions because it is `Copy` and carries no borrow of
the container.

`as_deref` goes one step further, from `Option<String>` to `Option<&str>`, and
is the usual way to compare an optional owned string against a literal:
`cfg.name.as_deref() == Some("ferris")`.

## 7. One binding, two shapes

@kind fix
@concept pattern matching
@expect E0408

An or-pattern lets two variants share an arm. There is one rule about the
bindings, and this code breaks it. Read the two alternatives carefully and spot
the difference.

`horizontal` should return the `x` of a click or a move, and `0` for a key.

```starter
pub enum Event {
    Click { x: i32, y: i32 },
    Move { x: i32, y: i32 },
    Key(char),
}

pub fn horizontal(e: &Event) -> i32 {
    match e {
        Event::Click { x, .. } | Event::Move { y, .. } => *x,
        Event::Key(_) => 0,
    }
}

pub fn run() -> Vec<i32> {
    vec![
        horizontal(&Event::Click { x: 3, y: 9 }),
        horizontal(&Event::Move { x: 7, y: 1 }),
        horizontal(&Event::Key('q')),
    ]
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_x_from_both() {
        assert_eq!(run(), vec![3, 7, 0]);
    }
}
```

```solution
pub enum Event {
    Click { x: i32, y: i32 },
    Move { x: i32, y: i32 },
    Key(char),
}

pub fn horizontal(e: &Event) -> i32 {
    match e {
        Event::Click { x, .. } | Event::Move { x, .. } => *x,
        Event::Key(_) => 0,
    }
}

pub fn run() -> Vec<i32> {
    vec![
        horizontal(&Event::Click { x: 3, y: 9 }),
        horizontal(&Event::Move { x: 7, y: 1 }),
        horizontal(&Event::Key('q')),
    ]
}
```

@hint One alternative binds `x`, the other binds `y`. The arm body uses only one of them.
@hint Every alternative in an `|` pattern must bind the same names, with the same types.
@hint The `Move` alternative should destructure `x`, not `y`.

@diagnose E0408
`variable x is not bound in all patterns`. rustc underlines the `Move`
alternative with `pattern doesn't bind x` and the `Click` one with
`variable not in all patterns`.

The arm body is a single piece of code compiled once, and it names `x`. If
control could arrive there through the `Move` alternative, `x` would not exist.
So the rule is that every alternative in an or-pattern must bind exactly the
same set of names, at the same types, which is also why a rename is not
enough: `Move { y: x, .. }` would satisfy it too, by binding the *y* field under
the name `x`.

@diagnose E0409
`variable x is bound inconsistently across alternatives`. You bound the name in
both alternatives but with different modes or types: one by reference and one
by value, or one from an `i32` field and one from something else. Or-pattern
alternatives must agree on the type as well as the name.

@after
Or-patterns nest anywhere a pattern can go, which is more useful than the
top-level form suggests:

```rust
Some(Event::Click { .. } | Event::Move { .. }) => "pointer",
```

The alternatives sit inside the `Some`, so you write `Some` once. A guard added
to an arm applies to the whole arm, all alternatives included: `A | B if ready`
tests `ready` for both, not just `B`. That trips people up often enough to be
worth a parenthesis in your head.

## 8. Every transition, or none

@kind fix
@concept state machine
@expect E0004

A state machine is a `match` over `(state, event)`. That scrutinee is a tuple of
two enums, so the number of cases is the *product*: three states times three
events is nine pairs, and the compiler wants all nine accounted for.

`step` handles the three interesting transitions. Complete it so that any other
pair leaves the state unchanged.

```starter
pub enum State {
    Idle,
    Running { ticks: u32 },
    Done(u32),
}

pub enum Event {
    Start,
    Tick,
    Stop,
}

pub fn step(state: State, ev: Event) -> State {
    match (state, ev) {
        (State::Idle, Event::Start) => State::Running { ticks: 0 },
        (State::Running { ticks }, Event::Tick) => State::Running { ticks: ticks + 1 },
        (State::Running { ticks }, Event::Stop) => State::Done(ticks),
    }
}

pub fn run() -> u32 {
    let mut s = State::Idle;
    for ev in [Event::Tick, Event::Start, Event::Tick, Event::Tick, Event::Stop, Event::Start] {
        s = step(s, ev);
    }
    match s {
        State::Done(n) => n,
        _ => 999,
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ignores_impossible_transitions() {
        assert_eq!(run(), 2);
    }
}
```

```solution
pub enum State {
    Idle,
    Running { ticks: u32 },
    Done(u32),
}

pub enum Event {
    Start,
    Tick,
    Stop,
}

pub fn step(state: State, ev: Event) -> State {
    match (state, ev) {
        (State::Idle, Event::Start) => State::Running { ticks: 0 },
        (State::Running { ticks }, Event::Tick) => State::Running { ticks: ticks + 1 },
        (State::Running { ticks }, Event::Stop) => State::Done(ticks),
        (s, _) => s,
    }
}

pub fn run() -> u32 {
    let mut s = State::Idle;
    for ev in [Event::Tick, Event::Start, Event::Tick, Event::Tick, Event::Stop, Event::Start] {
        s = step(s, ev);
    }
    match s {
        State::Done(n) => n,
        _ => 999,
    }
}
```

@hint Every remaining pair means the same thing: the event does not apply, so the state stays as it was.
@hint You need one final arm that matches any pair and returns the state it was given. The state was moved into the tuple, so bind it back out.
@hint `(s, _) => s,` binds the whole state and ignores the event.

@diagnose E0004
`non-exhaustive patterns` followed by a long list: `(State::Idle, Event::Tick)`,
`(State::Idle, Event::Stop)`, `(State::Done(_), _)` and the rest. rustc computes
the uncovered set over the whole tuple and prints it, collapsing runs where it
can.

That list is worth reading before you silence it, because it is a complete
inventory of the transitions you have not thought about. Half the value of
modelling a state machine this way is being handed that list. `Done` receiving a
`Start` might well deserve a real arm rather than the catch-all.

Note the arm you add must bind the state back out: the tuple `(state, ev)` moved
`state` into it, so `(s, _) => s` is how you get it back. `_ => state` will not
compile, because `state` has been moved.

@diagnose E0382
`use of moved value: state`. Your catch-all arm names `state` directly, but
building the scrutinee tuple `(state, ev)` moved it in. The value is not gone; it is
inside the tuple being matched, so bind it out of the pattern:
`(s, _) => s`.

@after
Taking the old state **by value** and returning the new one is the shape worth
copying. Because `step` consumes its argument, a stale `State` cannot be used
after a transition. The borrow checker turns "we read the old state by accident"
into a compile error.

It also makes the fat-variant question concrete. Every `State` value is as large
as the biggest variant, so if `Running` held a 4 KB buffer, every `Idle` would
cost 4 KB and every transition would memcpy it. `Running(Box<Session>)` shrinks
the enum back to a word and the transition to a pointer move.
