---
unit: 08-structs
---

## 1. The field you forgot

@kind fix
@concept struct
@expect E0063

A struct literal has to name every field. Not most of them, not the interesting
ones — all of them, because a half-initialised struct is exactly the thing Rust
refuses to let exist.

Give `retries` the value the test expects.

```starter
pub struct Config {
    pub host: String,
    pub port: u16,
    pub retries: u8,
}

pub fn run() -> Config {
    Config {
        host: String::from("localhost"),
        port: 8080,
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fully_initialised() {
        let c = run();
        assert_eq!(c.host, "localhost");
        assert_eq!(c.port, 8080);
        assert_eq!(c.retries, 3);
    }
}
```

```solution
pub struct Config {
    pub host: String,
    pub port: u16,
    pub retries: u8,
}

pub fn run() -> Config {
    Config {
        host: String::from("localhost"),
        port: 8080,
        retries: 3,
    }
}
```

@hint Read the error's last line. It names the field it could not find a value for.
@hint The test says what the value should be.

@diagnose E0063
`missing field `retries` in initializer of `Config``.

There is no partial construction in Rust and no default that quietly fills the
gap. A `Config` value either has all three fields or does not exist, which is why
you never have to write a "is this fully built yet" check and never meet a field
holding whatever was in that memory before.

Two things do let you write fewer field names, and neither is an exception to the
rule. `..other` copies the rest from another value of the same type, and
`..Default::default()` takes them from a `Default` impl. Both still produce a
complete struct; they just source the values elsewhere.

@after
Compare this with the languages where a constructor can return early, or where a
field is `null` until some `init()` runs. Those states are real and reachable, and
every method has to defend against them.

Rust's position is that a type should not be able to represent a value that makes
no sense. Requiring every field is the cheapest instance of that idea. `Option<T>`
for a genuinely absent field is the next one — and it is honest, because then the
absence is in the type and every reader can see it.

## 2. The method that cannot count

@kind fix
@concept receiver
@expect E0594

`Counter::new` is fine. `bump` is not: it is declared with `&self`, which is
permission to read, and it is trying to write.

Change the one thing that needs to change.

```starter
pub struct Counter {
    pub n: u32,
}

impl Counter {
    pub fn new() -> Self {
        Counter { n: 0 }
    }

    pub fn bump(&self) {
        self.n += 1;
    }
}

pub fn run() -> u32 {
    let mut c = Counter::new();
    c.bump();
    c.bump();
    c.n
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_two() {
        assert_eq!(run(), 2);
    }
    #[test]
    fn starts_at_zero() {
        assert_eq!(Counter::new().n, 0);
    }
}
```

```solution
pub struct Counter {
    pub n: u32,
}

impl Counter {
    pub fn new() -> Self {
        Counter { n: 0 }
    }

    pub fn bump(&mut self) {
        self.n += 1;
    }
}

pub fn run() -> u32 {
    let mut c = Counter::new();
    c.bump();
    c.bump();
    c.n
}
```

@hint The receiver of a method says what the method is allowed to do to the value.
@hint `&self` reads. There is a second form for writing.
@hint `pub fn bump(&mut self)`. The call sites do not change — `c` is already `mut`.

@diagnose E0594
`cannot assign to `self.n`, which is behind a `&` reference`, followed by the
note that matters: *`self` is a `&` reference, so the data it refers to cannot be
written*.

A shared reference can be handed to any number of holders at once. If writing
through one were allowed, two of them could write at the same moment, which is
the data race the borrow rules exist to make impossible. So the permission has to
be requested in the type, and `&mut self` is how a method requests it.

Note that the compiler points at the assignment, not at the signature — but the
signature is where the fix goes. The body is a correct statement of what the
method wants to do; it is the declared permission that is too narrow.

@diagnose E0596
Once `bump` takes `&mut self`, calling it needs a mutable borrow of `c`, which
needs `c` to be declared `mut`. It already is here. If you see this error you have
probably dropped the `mut` from `let mut c` — a binding is immutable by default,
and `&mut` cannot be taken from one.

@after
`new()` returning `Self` and taking no receiver is an **associated function**: no
`self` parameter, called with `::` rather than `.`. Nothing in the language knows
the name `new`; it is a convention, and a type may have several constructors —
`Vec::new`, `Vec::with_capacity`, `Vec::from`.

Worth knowing for later: a `Counter` that increments through a `&self` is not
impossible, just explicit. `Cell<u32>` and `RefCell<T>` provide **interior
mutability**, moving the check to runtime for the cases where the compiler's
static rule is stricter than your program needs.

## 3. The method that ate the rectangle

@kind fix
@concept receiver
@expect E0382

`area` takes `self` by value. That is a real choice with a real consequence:
calling it consumes the rectangle, so the second use in `run` has nothing left to
work with.

Fix `area`. Leave `scaled` exactly as it is — it consumes on purpose, and the
order of the calls means that is fine.

```starter
pub struct Rect {
    pub w: u32,
    pub h: u32,
}

impl Rect {
    pub fn area(self) -> u32 {
        self.w * self.h
    }

    pub fn scaled(self, k: u32) -> Rect {
        Rect { w: self.w * k, h: self.h * k }
    }
}

pub fn run() -> (u32, u32) {
    let r = Rect { w: 3, h: 4 };
    (r.area(), r.scaled(2).area())
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn both_areas() {
        assert_eq!(run(), (12, 48));
    }
    #[test]
    fn area_can_be_called_twice() {
        let r = Rect { w: 2, h: 5 };
        assert_eq!(r.area(), 10);
        assert_eq!(r.area(), 10);
    }
}
```

```solution
pub struct Rect {
    pub w: u32,
    pub h: u32,
}

impl Rect {
    pub fn area(&self) -> u32 {
        self.w * self.h
    }

    pub fn scaled(self, k: u32) -> Rect {
        Rect { w: self.w * k, h: self.h * k }
    }
}

pub fn run() -> (u32, u32) {
    let r = Rect { w: 3, h: 4 };
    (r.area(), r.scaled(2).area())
}
```

@hint `area` multiplies two numbers out of the struct. Does it need to own it to do that?
@hint A method taking `self` by value is saying "give me the value, you will not need it again". That is a strong claim for a getter.
@hint `pub fn area(&self) -> u32`. The body does not change — field access works the same through a reference.

@diagnose E0382
`use of moved value: r`. The tuple is evaluated left to right: `r.area()` moves
`r` into `area`, and then `r.scaled(2)` has nothing to move.

The compiler's note is the precise version: *`Rect::area` takes ownership of the
receiver `self`, which moves `r`*. Method calls hide the argument passing, so the
move is easy to miss — `r.area()` is `Rect::area(r)` with the receiver written on
the left.

Because `Rect` has only `u32` fields it *could* have been `Copy`, and adding
`#[derive(Copy, Clone)]` would also make this compile. That silences the symptom
and leaves the bad signature in place; the moment somebody adds a `String` field
the whole thing collapses.

@after
Note that `scaled` still takes `self` and nothing complains. Consuming receivers
are not a mistake — they are the right shape when the method logically replaces
the value, and here `r.scaled(2)` is used immediately, so there is nothing left to
want afterwards.

The rule of thumb: **`&self` unless you must mutate, `&mut self` unless you must
consume.** Take `self` for exactly two reasons — you need to move a field out
without copying it (`String::into_bytes`), or you are deliberately ending the
value's life (`build`, `close`, `finish`). Reaching for `self` out of habit
compiles fine while you write the type and forces `.clone()` on everyone who
later uses it.

## 4. Printing a struct

@kind fix
@concept derive
@expect E0277

`{}` formats things for a user and a struct has no obvious user-facing form, so
`Display` is never derived. `{:?}` formats things for a programmer and *is*
derivable — but the derive has to be asked for.

Ask for it. Both tests are checking the exact output, so read them.

```starter
pub struct Point {
    pub x: i32,
    pub y: i32,
}

pub fn run() -> String {
    format!("{:?}", Point { x: 3, y: -1 })
}

pub fn pretty() -> String {
    format!("{:#?}", Point { x: 3, y: -1 })
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compact_form() {
        assert_eq!(run(), "Point { x: 3, y: -1 }");
    }
    #[test]
    fn pretty_form() {
        assert_eq!(pretty(), "Point {\n    x: 3,\n    y: -1,\n}");
    }
}
```

```solution
#[derive(Debug)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

pub fn run() -> String {
    format!("{:?}", Point { x: 3, y: -1 })
}

pub fn pretty() -> String {
    format!("{:#?}", Point { x: 3, y: -1 })
}
```

@hint The error names the trait it wants and even suggests the attribute.
@hint `#[derive(Debug)]` on the struct, above the definition.

@diagnose E0277
`Point doesn't implement Debug`, with the help line: *add `#[derive(Debug)]` to
`Point` or manually `impl Debug for Point`*.

Formatting in Rust is trait-driven. `{}` calls `Display`, `{:?}` calls `Debug`,
and neither exists for your type until somebody writes it. `Display` is never
derived on purpose — how a value should be shown to a user is a decision with no
mechanical answer, and getting it wrong silently is worse than a compile error.

`Debug` is different. Its audience is you, at a breakpoint, and "the type name
then each field" is a perfectly good mechanical answer, so the derive writes it.
The derive is also inherited: every field must itself be `Debug`, which every
standard library type already is.

@diagnose E0599
If you tried `Point { .. }.to_string()` you will be told the method does not
exist. `to_string` comes from `Display` via a blanket impl, not from `Debug`, so
deriving `Debug` does not provide it. Use `format!("{:?}", p)`.

@after
`{:#?}` is the alternate form: one field per line, indented, closing brace on its
own line. The single-line `{:?}` stops being readable at about three fields and
is hopeless once structs nest, so `{:#?}` is what you actually want when
debugging.

Two things worth carrying forward. `dbg!(&p)` prints file, line, the expression
source *and* the `{:#?}` form, then gives the value back — it is strictly better
than a `println!` you have to delete later. And `#[derive(Debug)]` on absolutely
everything is normal, idiomatic Rust; the generated code is dropped by the linker
if nothing calls it.

## 5. Two dots and a move

@kind fix
@concept struct update syntax
@expect E0382

`..base` is struct update syntax: fill in every field I did not list from that
other value. It reads like a copy. It is not one.

`run` needs both structs afterwards. Make that work.

```starter
#[derive(Debug, Clone, PartialEq)]
pub struct Settings {
    pub host: String,
    pub port: u16,
    pub debug: bool,
}

pub fn run() -> (Settings, Settings) {
    let base = Settings {
        host: String::from("localhost"),
        port: 80,
        debug: false,
    };
    let dev = Settings { port: 3000, ..base };
    (base, dev)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn base_survives() {
        let (base, dev) = run();
        assert_eq!(base.port, 80);
        assert_eq!(dev.port, 3000);
    }
    #[test]
    fn only_the_port_differs() {
        let (base, dev) = run();
        assert_eq!(base.host, dev.host);
        assert_eq!(base.debug, dev.debug);
    }
}
```

```solution
#[derive(Debug, Clone, PartialEq)]
pub struct Settings {
    pub host: String,
    pub port: u16,
    pub debug: bool,
}

pub fn run() -> (Settings, Settings) {
    let base = Settings {
        host: String::from("localhost"),
        port: 80,
        debug: false,
    };
    let dev = Settings { port: 3000, ..base.clone() };
    (base, dev)
}
```

@hint Which field of `base` did `..base` have to take, and what type is it?
@hint `host` is a `String`. Taking it out of `base` moves it, and a struct with a moved-out field cannot be used as a whole.
@hint The derive list already contains what you need. `..base.clone()`.

@diagnose E0382
`use of partially moved value: base`, with the note *partial move occurs because
`base.host` has type `String`, which does not implement the `Copy` trait*.

That word *partial* is the whole lesson. `..base` did not copy the struct; it
moved each field it needed, one at a time. `port` was listed explicitly so it was
not touched, `debug` is `bool` and therefore `Copy`, and `host` is a `String` —
so its heap handle moved into `dev`.

`base` is now in a half-alive state: `base.port` would still be readable, but
`base` as a value is gone, because one of its fields no longer belongs to it.
Putting it in the returned tuple needs the whole thing.

@after
The trap is that this depends entirely on the field types. Take the `String` out
of `Settings` and leave `port` and `debug`, and `..base` copies rather than moves,
`base` stays perfectly usable, and the code compiles. Add one owned field back and
it breaks — with an error at the tuple, several lines away from the `..`.

`..base.clone()` is the honest fix and costs one allocation. The alternative worth
knowing is `..Default::default()`, which takes the remaining fields from a fresh
value instead of an existing one, so nothing is moved out of anything. That is the
common shape in real code: list what differs, default the rest.

## 6. Cents are not dollars

@kind fix
@concept newtype
@expect E0308

Both of these are a single `i64` at runtime. The wrappers exist so that the
compiler will not let you add one to the other by accident — which is exactly
what `run` does.

Convert, do not cast. The wrapper's field is public.

```starter
pub struct Cents(pub i64);
pub struct Dollars(pub i64);

pub fn add(a: Cents, b: Cents) -> Cents {
    Cents(a.0 + b.0)
}

pub fn run() -> i64 {
    let price = Cents(250);
    let discount = Dollars(2);
    add(price, discount).0
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn two_fifty_plus_two_dollars() {
        assert_eq!(run(), 450);
    }
    #[test]
    fn add_still_takes_cents() {
        assert_eq!(add(Cents(1), Cents(2)).0, 3);
    }
}
```

```solution
pub struct Cents(pub i64);
pub struct Dollars(pub i64);

impl Dollars {
    pub fn to_cents(self) -> Cents {
        Cents(self.0 * 100)
    }
}

pub fn add(a: Cents, b: Cents) -> Cents {
    Cents(a.0 + b.0)
}

pub fn run() -> i64 {
    let price = Cents(250);
    let discount = Dollars(2);
    add(price, discount.to_cents()).0
}
```

@hint `add` wants two `Cents`. You have one `Cents` and one `Dollars`.
@hint The conversion is not free information — a dollar is a hundred cents, and something has to say so.
@hint Give `Dollars` a method: `pub fn to_cents(self) -> Cents { Cents(self.0 * 100) }`, then call it at the call site.

@diagnose E0308
`expected `Cents`, found `Dollars``, and the note underneath is the point: *the
types are structurally identical but have different names*.

That is not the compiler being pedantic; it is the entire reason the two types
exist. `i64` would have accepted both, and the program would have quietly
subtracted two cents from a two-pound discount. A **newtype** takes a unit,
an identifier, or an invariant that lived in a variable name and puts it in the
type system, where it is checked.

The cost is zero. `Cents` has exactly the layout of `i64` — one field, no tag, no
header — so the wrapper is gone entirely after compilation and the arithmetic is
the same instruction it would have been.

@diagnose E0609
`no field `0` on type ...` means you are unwrapping something that is not a tuple
struct — most likely you have converted to `Cents` already and are calling `.0` on
the result of `add`, which is fine, or on a plain `i64`, which is not. A tuple
struct's fields are `.0`, `.1`; a plain integer has none.

@after
The conversion taking `self` rather than `&self` is deliberate and idiomatic.
`Dollars` is `Copy`-shaped but not derived `Copy`, and a conversion that consumes
says *this value has become that value* — the same statement `String::into_bytes`
makes.

The second thing newtypes buy you is trait implementations. You cannot write
`impl Display for Vec<String>`: neither the trait nor the type is yours, and the
coherence rules forbid it. `struct Csv(Vec<String>);` makes the type local, and
the impl is allowed. That is why you see newtypes throughout real crates —
`Duration`, `PathBuf`, `NonZeroU32` are all this pattern with a name you already
trust.

## 7. Defaults that mean something

@kind fix
@concept Default
@expect E0277

`..Default::default()` fills every unlisted field from the type's `Default` impl.
`Request` has not got one.

You could derive it. Read the test first — the numbers it expects are not zeros,
and a derived `Default` gives you the zero of every field.

```starter
#[derive(Debug, PartialEq)]
pub struct Request {
    pub url: String,
    pub timeout_ms: u32,
    pub retries: u8,
}

pub fn run() -> Request {
    Request {
        url: String::from("/health"),
        ..Default::default()
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keeps_the_url_and_defaults_the_rest() {
        assert_eq!(
            run(),
            Request {
                url: String::from("/health"),
                timeout_ms: 5000,
                retries: 3,
            }
        );
    }
    #[test]
    fn default_alone_is_the_same_but_empty_url() {
        let d = Request::default();
        assert_eq!(d.url, "");
        assert_eq!(d.timeout_ms, 5000);
        assert_eq!(d.retries, 3);
    }
}
```

```solution
#[derive(Debug, PartialEq)]
pub struct Request {
    pub url: String,
    pub timeout_ms: u32,
    pub retries: u8,
}

impl Default for Request {
    fn default() -> Self {
        Request {
            url: String::new(),
            timeout_ms: 5000,
            retries: 3,
        }
    }
}

pub fn run() -> Request {
    Request {
        url: String::from("/health"),
        ..Default::default()
    }
}
```

@hint `#[derive(Default)]` would compile. Run the tests in your head against it first.
@hint A derived `Default` sets numbers to `0`, `bool` to `false` and `String` to empty. The test wants 5000 and 3.
@hint Write the impl by hand: `impl Default for Request { fn default() -> Self { ... } }`.

@diagnose E0277
`the trait bound `Request: Default` is not satisfied`, pointing at
`Default::default()`.

The struct update syntax needs a value of the same type to take the remaining
fields from, and `Default::default()` is a call whose return type is inferred from
where it is used — here, `Request`. So the compiler goes looking for
`impl Default for Request` and finds nothing.

The suggestion rustc offers is `#[derive(Default)]`, which is correct as far as it
goes. It generates a `default()` that calls `Default::default()` on every field,
so you would get `""`, `0` and `0`. Whether that is right is a question about your
domain, not about the language, and the tests here say it is not.

@diagnose E0308
If you wrote the impl but returned something other than `Self` — a tuple, or a
value of a different type — the signature `fn default() -> Self` is what you have
to satisfy. `Self` inside `impl Default for Request` means `Request`.

@after
A timeout of zero and zero retries are not neutral values, they are a broken
client, and the derive would have produced them without a word. Deriving `Default`
is right when the zero really is the sensible starting point — a counter, an empty
collection, an accumulator — and wrong the moment a field has a meaningful default
that is not the zero.

`..Default::default()` is worth the habit even so. It is the closest Rust has to
named optional arguments: list the two fields that differ, let the impl supply the
other six, and adding a seventh field later does not break a single call site.

## 8. A builder that cannot build

@kind fix
@concept builder
@expect E0507

The chain reads exactly as intended and does not compile. The setters take
`&mut self` and hand back `&mut Self`, which is a perfectly good way to write a
builder — right up to `build`, which needs the value itself and is holding a
reference.

Change the receivers so the value travels along the chain instead of a borrow of
it.

```starter
#[derive(Debug, PartialEq)]
pub struct Query {
    pub table: String,
    pub limit: Option<u32>,
    pub order: Option<String>,
}

pub struct QueryBuilder {
    table: String,
    limit: Option<u32>,
    order: Option<String>,
}

impl QueryBuilder {
    pub fn new(table: &str) -> Self {
        QueryBuilder { table: table.to_string(), limit: None, order: None }
    }

    pub fn limit(&mut self, n: u32) -> &mut Self {
        self.limit = Some(n);
        self
    }

    pub fn order(&mut self, by: &str) -> &mut Self {
        self.order = Some(by.to_string());
        self
    }

    pub fn build(self) -> Query {
        Query { table: self.table, limit: self.limit, order: self.order }
    }
}

pub fn run() -> Query {
    QueryBuilder::new("users").limit(10).order("name").build()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn builds_the_full_query() {
        assert_eq!(
            run(),
            Query {
                table: String::from("users"),
                limit: Some(10),
                order: Some(String::from("name")),
            }
        );
    }
    #[test]
    fn setters_are_optional() {
        let q = QueryBuilder::new("logs").build();
        assert_eq!(q.table, "logs");
        assert_eq!(q.limit, None);
        assert_eq!(q.order, None);
    }
    #[test]
    fn one_setter_only() {
        let q = QueryBuilder::new("logs").limit(5).build();
        assert_eq!(q.limit, Some(5));
        assert_eq!(q.order, None);
    }
}
```

```solution
#[derive(Debug, PartialEq)]
pub struct Query {
    pub table: String,
    pub limit: Option<u32>,
    pub order: Option<String>,
}

pub struct QueryBuilder {
    table: String,
    limit: Option<u32>,
    order: Option<String>,
}

impl QueryBuilder {
    pub fn new(table: &str) -> Self {
        QueryBuilder { table: table.to_string(), limit: None, order: None }
    }

    pub fn limit(mut self, n: u32) -> Self {
        self.limit = Some(n);
        self
    }

    pub fn order(mut self, by: &str) -> Self {
        self.order = Some(by.to_string());
        self
    }

    pub fn build(self) -> Query {
        Query { table: self.table, limit: self.limit, order: self.order }
    }
}

pub fn run() -> Query {
    QueryBuilder::new("users").limit(10).order("name").build()
}
```

@hint `build` takes `self` by value. What does `order("name")` actually give it?
@hint It gives it a `&mut QueryBuilder`, and you cannot move a value out of a reference — the reference does not own it.
@hint Make the setters take `mut self` and return `Self`. The bodies stay identical; only the receiver and the return type change.

@diagnose E0507
`cannot move out of `*self` which is behind a mutable reference` — or, depending
on where the chain breaks, `cannot move out of a mutable reference`.

`order("name")` returns `&mut QueryBuilder`. `build(self)` needs a
`QueryBuilder`, by value, because it moves the `String` and the two `Option`s out
of it into the `Query`. Moving out of a borrow is never allowed: the borrow is a
promise to give the value back intact, and a moved-from value is not intact.

Taking `mut self` instead solves it by never borrowing in the first place. Each
setter receives the whole builder, mutates its own local copy of the handle, and
returns it. Ownership walks down the chain one call at a time and arrives at
`build` still owned.

@diagnose E0505
If you converted only some of the setters you may see `cannot move out of X
because it is borrowed`. The chain has to be consistent: a `&mut Self` in the
middle of it poisons everything downstream, because the borrow it hands out stays
live until the last method that uses it.

@diagnose E0596
Assigning the chain to a variable first — `let b = QueryBuilder::new("users");`
then `b.limit(10)` — needs `b` to be `mut` while the setters still take
`&mut self`. Once they take `mut self`, the `mut` moves into the parameter list
and the caller's binding does not need it at all, which is one of the quieter
advantages of the consuming form.

@after
`mut self` in a parameter list is not a third kind of receiver. It is `self` — the
value is moved in — with the local binding marked mutable so the body can write to
it. The caller sees no difference; mutability of a parameter is never part of a
signature's contract.

The `&mut self` form is not wrong in general, and you will see it: it avoids
moving the struct at every step, which matters if the builder is large. The usual
fix there is `build(&mut self) -> Query` that clones, or `fn build(&mut self)`
taking the fields with `std::mem::take`. Every real builder crate ends up choosing
between those three, and the choice is exactly the receiver question from earlier
in this unit — asked once, at the end of a chain, where it is hardest to change
later.
