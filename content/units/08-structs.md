---
num: 8
slug: 08-structs
title: Structs and methods
accent: moss
concepts: struct, tuple struct, newtype, impl, method, associated function, receiver, derive, Default, struct update syntax, padding
needs: 05-ownership, 07-slices
blurb: Data with a name, three ways to write one, and what &self versus self commits every caller to.
---

%% A tuple of `(String, u32, bool)` compiles perfectly and tells you nothing. Six months later nobody remembers whether the boolean was "active" or "suspended", and `.2` appears in fourteen places. A struct is the same bytes with the names kept, and the names are checked.

The methods are the more interesting half. Choosing between `&self`, `&mut self` and `self` is the ownership unit applied to your own types, and it is a promise made to every caller you will ever have.

## Three shapes, three jobs

### Named fields

```rust
struct Config {
    host: String,
    port: u16,
    retries: u8,
}

let c = Config { host: String::from("localhost"), port: 8080, retries: 3 };
```

The default, and the right answer whenever a reader would have to guess what a
position means. Fields are private outside the module unless marked `pub`.

### Tuple structs

```rust
struct Rgb(u8, u8, u8);
struct Meters(f64);

let red = Rgb(255, 0, 0);
let d = Meters(9.8);
```

Fields are `.0`, `.1`, and so on. Worth it only when the order is the meaning —
coordinates, colour channels — or when there is exactly one field and the name
would just repeat the type.

### Unit structs

```rust
struct Metric;
```

No fields, no bytes, no runtime existence at all. It exists to hang behaviour on:
a marker type parameter, a `struct Logger;` that implements a trait and holds no
state.

| | use it when |
|---|---|
| named fields | more than one field, or the name carries meaning |
| tuple struct | one field (a newtype), or position *is* the meaning |
| unit struct | you need a type to implement a trait, not to store data |

## The newtype

A one-field tuple struct wrapping an existing type is a real tool, not a
formality.

```rust,bad
fn transfer(amount: u64, from: u64, to: u64) { }

transfer(account_a, 500, account_b);   // compiles. wrong argument order.
```

```rust,good
struct Cents(u64);
struct AccountId(u64);

fn transfer(amount: Cents, from: AccountId, to: AccountId) { }

transfer(account_a, Cents(500), account_b);  // error[E0308]
```

Same machine code — a **newtype** has exactly the layout of the thing it wraps,
and the wrapper is gone after compilation. What you bought is a type error where
you previously had a bank transfer to the wrong account.

The second use is trait implementations. You cannot implement `Display` for
`Vec<T>`, because neither the trait nor the type is yours. Wrap it in
`struct Csv(Vec<String>);` and both halves are local, so the impl is allowed.

## impl blocks

### Associated functions and methods

```rust
impl Config {
    pub fn new(host: &str) -> Self {          // associated function
        Config { host: host.to_string(), port: 8080, retries: 3 }
    }

    pub fn url(&self) -> String {             // method
        format!("{}:{}", self.host, self.port)
    }
}

let c = Config::new("localhost");   // ::  no receiver
let u = c.url();                    // .   c is the receiver
```

The only difference is whether the first parameter is a form of `self`. A method
takes a receiver and is called with `.`; an **associated function** does not, and
is called with `::`.

`Self` is an alias for the type the block is about. Writing `Self` rather than
`Config` means renaming the struct does not touch the body.

:::note
`new` is a **convention**, not a keyword. Nothing in the language knows the name.
A type may have several constructors — `Vec::new`, `Vec::with_capacity`,
`Vec::from` — and any of them may be called something else entirely.
:::

### Where the method call goes

`c.url()` is sugar. The compiler inserts the borrow: `Config::url(&c)`. It will
also insert derefs, which is why `v.sort()` works on a `Vec` when `sort` is
defined on `[T]`, and why you almost never write `(*boxed).method()`.

## The receiver is a promise

The **receiver** is the `self` parameter. This is the ownership unit, applied to
types you wrote.

| receiver | the caller must | the caller may afterwards | typical |
|---|---|---|---|
| `&self` | have any access | keep using the value, share it | `len`, `get`, `url` |
| `&mut self` | have unique access | keep using it, no other borrows live | `push`, `sort`, `set_port` |
| `self` | give up ownership | never name it again | `into_bytes`, `build`, `unwrap` |

```rust
impl Config {
    fn port(&self) -> u16 { self.port }
    fn set_port(&mut self, p: u16) { self.port = p; }
    fn into_host(self) -> String { self.host }   // consumes
}
```

```rust,bad
let c = Config::new("localhost");
let h = c.into_host();
println!("{}", c.port());   // error[E0382]: borrow of moved value
```

:::gotcha
Taking `self` where `&self` would do is the most common self-inflicted wound in a
new API. It compiles fine while you are writing the type and forces `.clone()` on
everyone who uses it.

Take `self` for exactly two reasons: you need to **move a field out**
(`into_host` above returns the `String` without copying it), or you are
deliberately ending the value's life — `build`, `close`, `finish`.
:::

:::compare
**Python** — `self` is always a reference and mutation is always allowed. Rust
splits that one word into three, and the split is visible in the signature, so
you know before calling whether a method can change what you passed.

**C++** — `&self` is `const T&`, `&mut self` is `T&`, `self` is `T&&`. The
difference is that constness is transitive and enforced here, and there is no
`const_cast`.
:::

## Building values

### Field init shorthand

```rust
fn make(host: String, port: u16) -> Config {
    Config { host, port, retries: 3 }   // not host: host, port: port
}
```

### Struct update syntax

```rust
let base = Config { host: String::from("localhost"), port: 80, retries: 3 };
let dev  = Config { port: 3000, ..base };
```

**Struct update syntax** fills every field you did not list. It is not a copy.

:::gotcha
`..base` **moves** out of `base`, field by field, for every field it takes. After
the line above, `base.host` is a moved-from `String` and `base` as a whole is
unusable — `error[E0382]`.

If the untouched fields all happen to be `Copy`, `base` survives. If any one of
them owns a heap allocation, it does not. Use `..base.clone()` when you need both.
:::

### The builder

When there are eight fields and six of them have sensible defaults, a
constructor with eight parameters is unreadable. The builder trades one
allocation for named arguments the language does not have:

```rust
let q = Query::builder("users")
    .limit(10)
    .order("name")
    .build();
```

Each method takes `self` and returns `Self`, so the chain moves one value along
and `build` consumes it. Taking `&mut self` and returning `&mut Self` also works
and reads the same, right up to `build`, which needs the value and cannot get it
out of a reference — `error[E0507]`.

## Derives

```rust
#[derive(Debug, Clone, PartialEq, Default)]
struct Config { host: String, port: u16, retries: u8 }
```

A derive writes an `impl` block for you, mechanically, from the fields.

| derive | generates | requires |
|---|---|---|
| `Debug` | `{:?}` formatting: `Config { host: "x", port: 80 }` | every field `Debug` |
| `Clone` | `clone()` calling `clone()` on each field | every field `Clone` |
| `Copy` | nothing — a marker permitting implicit duplication | every field `Copy`, and no `Drop` |
| `PartialEq` | `==` comparing field by field, in declaration order | every field `PartialEq` |
| `Default` | `default()` with every field at *its* default: `0`, `false`, `""` | every field `Default` |

The requirement is the useful part: a derive is a rule inherited from the fields.
One `String` and `#[derive(Copy)]` is `error[E0204]`, permanently.

```rust
println!("{:?}", c);    // Config { host: "localhost", port: 80, retries: 3 }
println!("{:#?}", c);   // the same, one field per line, indented
```

Reach for `{:#?}` the moment a struct has nested structs; the single-line form
stops being readable at about three fields.

:::gotcha
Derived `Default` gives you the zero of every field, which is very often not a
sensible default. A timeout of `0` and `retries: 0` will compile and then behave
badly. Write the impl by hand when the defaults have meaning:

```rust
impl Default for Config {
    fn default() -> Self {
        Config { host: String::from("localhost"), port: 8080, retries: 3 }
    }
}
```

`Default` earns its place mostly through `..Default::default()` and through
generic code that needs to make a value out of nothing.
:::

## What it looks like in memory

A struct is its fields laid out contiguously, with padding so each one lands on
an address it can be read from. There is no header, no vtable, no type tag — a
struct of two `u32`s is eight bytes and nothing else.

The compiler is free to **reorder** the fields to waste less of that padding.

:::memory struct Record { id: u8, count: u32, flag: bool }
  declared order, as C would lay it out — 12 bytes
  ┌────┬────────────┬──────────────┬────┬───────────┐
  │ id │  padding   │    count     │flag│  padding  │
  │ 1  │     3      │      4       │ 1  │     3     │
  └────┴────────────┴──────────────┴────┴───────────┘

  what rustc actually emits — 8 bytes
  ┌──────────────┬────┬────┬──────┐
  │    count     │ id │flag│ pad  │
  │      4       │ 1  │ 1  │  2   │
  └──────────────┴────┴────┴──────┘
:::

Padding exists because a `u32` must sit at an address divisible by four; a
misaligned load is slower on x86 and a fault on some architectures. Reordering
puts the wide fields first so the narrow ones share one gap.

That freedom is why Rust's layout is unspecified, and why field order in your
source is a readability decision rather than a performance one.

```rust
#[repr(C)]
struct Header { magic: u32, version: u8 }
```

`#[repr(C)]` switches the reordering off and pins the layout to C's rules. You
need it exactly when the bytes are shared with something outside Rust — an FFI
call, a memory-mapped device register, a file format. Everywhere else, leave it
off and let the compiler save you the bytes.

:::note
**The habit.** Name the data, then decide what each method commits its caller to.
`&self` unless you must mutate, `&mut self` unless you must consume, `self` only
to move a field out or to end the value.
:::
