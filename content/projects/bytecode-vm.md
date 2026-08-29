---
project: bytecode-vm
tier: core
domain: languages
title: A bytecode VM
accent: slate
blurb: Eight stages from an instruction enum to a machine that compiles `n = 6; f = 1; while n > 1 { f = f * n; n = n - 1 }; f`, prints its bytecode, and runs it.
needs: 09-enums, 11-collections, 12-errors
mins: 75
---

"Interpreted" is a word that hides a machine. CPython, Lua and the JVM do not
walk a syntax tree when they run your code. They compile it first, into a flat
list of small instructions for a machine that does not exist in silicon, and
then a loop reads those instructions one at a time and does what each one says.
That loop is a few hundred lines. This project builds one.

The machine here is a stack machine, which is what CPython and the JVM both
use. There are no registers to allocate. An instruction takes its operands off
a stack and puts its result back, so `2 + 3 * 4` becomes: push 2, push 3, push
4, multiply, add. That sequence is postfix, and turning infix source text into
it is the compiler's whole job.

Over eight stages you will write an `Op` enum, a `Chunk` holding a list of them
with constants in a side table, a virtual machine that executes the list, a
tokenizer, a compiler that respects operator precedence, global variables,
conditional jumps, and a disassembler that prints the program before it runs.
At the end you will feed it `n = 6; f = 1; while n > 1 { f = f * n; n = n - 1 };
f`, watch it print nineteen instructions, and get 720 back.

Where this stops short of a real VM: values are all `f64`, so there are no
strings, no objects and no garbage collector. Variables are global, so there
are no call frames and no functions. The instruction list is `Vec<Op>` rather
than `Vec<u8>`, which costs memory and buys clarity. Add local variables, call
frames and a heap and you have Lua. The dispatch loop stays the shape you are
about to write.

## 1. Instructions in a list, constants on the side

@kind fix
@concept enum
@expect E0004

`Op` is one instruction and `Chunk` is a program: a list of them plus a table
of the numbers they refer to. `line` disassembles one instruction and does not
cover the whole enum. `hand_written` should assemble `2 + 3 * 4` by hand, in
postfix, ending in `Return`.

```starter
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Op {
    Const(usize),
    Add,
    Sub,
    Mul,
    Div,
    Neg,
    Return,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Chunk {
    pub code: Vec<Op>,
    pub consts: Vec<f64>,
}

impl Chunk {
    pub fn new() -> Chunk {
        Chunk { code: Vec::new(), consts: Vec::new() }
    }

    pub fn push(&mut self, op: Op) -> usize {
        self.code.push(op);
        self.code.len() - 1
    }

    pub fn add_const(&mut self, n: f64) -> usize {
        for (i, c) in self.consts.iter().enumerate() {
            if *c == n {
                return i;
            }
        }
        self.consts.push(n);
        self.consts.len() - 1
    }

    pub fn line(&self, i: usize) -> String {
        match self.code[i] {
            Op::Const(k) => format!("{i:04}  CONST        {k}   ; {}", self.consts[k]),
            Op::Add => format!("{i:04}  ADD"),
            Op::Sub => format!("{i:04}  SUB"),
            Op::Mul => format!("{i:04}  MUL"),
            Op::Div => format!("{i:04}  DIV"),
        }
    }
}

pub fn hand_written() -> Chunk {
    todo!("hand-assemble 2 + 3 * 4: three constants, then Mul, Add, Return")
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constants_live_in_a_side_table() {
        let mut c = Chunk::new();
        assert_eq!(c.add_const(2.0), 0);
        assert_eq!(c.add_const(3.0), 1);
        assert_eq!(c.add_const(2.0), 0);
        assert_eq!(c.consts, vec![2.0, 3.0]);
    }

    #[test]
    fn push_reports_the_index_it_wrote_to() {
        let mut c = Chunk::new();
        assert_eq!(c.push(Op::Add), 0);
        assert_eq!(c.push(Op::Return), 1);
    }

    #[test]
    fn two_plus_three_times_four_in_postfix() {
        let c = hand_written();
        assert_eq!(c.consts, vec![2.0, 3.0, 4.0]);
        assert_eq!(
            c.code,
            vec![Op::Const(0), Op::Const(1), Op::Const(2), Op::Mul, Op::Add, Op::Return]
        );
    }

    #[test]
    fn every_op_disassembles() {
        let c = hand_written();
        println!("{}", (0..c.code.len()).map(|i| c.line(i)).collect::<Vec<_>>().join("\n"));
        assert_eq!(c.line(0), "0000  CONST        0   ; 2");
        assert_eq!(c.line(3), "0003  MUL");
        assert_eq!(c.line(5), "0005  RETURN");
        let mut n = Chunk::new();
        n.push(Op::Neg);
        assert_eq!(n.line(0), "0000  NEG");
    }
}
```

```solution
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Op {
    Const(usize),
    Add,
    Sub,
    Mul,
    Div,
    Neg,
    Return,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Chunk {
    pub code: Vec<Op>,
    pub consts: Vec<f64>,
}

impl Chunk {
    pub fn new() -> Chunk {
        Chunk { code: Vec::new(), consts: Vec::new() }
    }

    pub fn push(&mut self, op: Op) -> usize {
        self.code.push(op);
        self.code.len() - 1
    }

    pub fn add_const(&mut self, n: f64) -> usize {
        for (i, c) in self.consts.iter().enumerate() {
            if *c == n {
                return i;
            }
        }
        self.consts.push(n);
        self.consts.len() - 1
    }

    pub fn line(&self, i: usize) -> String {
        match self.code[i] {
            Op::Const(k) => format!("{i:04}  CONST        {k}   ; {}", self.consts[k]),
            Op::Add => format!("{i:04}  ADD"),
            Op::Sub => format!("{i:04}  SUB"),
            Op::Mul => format!("{i:04}  MUL"),
            Op::Div => format!("{i:04}  DIV"),
            Op::Neg => format!("{i:04}  NEG"),
            Op::Return => format!("{i:04}  RETURN"),
        }
    }
}

pub fn hand_written() -> Chunk {
    let mut c = Chunk::new();
    let two = c.add_const(2.0);
    let three = c.add_const(3.0);
    let four = c.add_const(4.0);
    c.push(Op::Const(two));
    c.push(Op::Const(three));
    c.push(Op::Const(four));
    c.push(Op::Mul);
    c.push(Op::Add);
    c.push(Op::Return);
    c
}
```

@hint rustc names the two variants that have no arm. Both print as a bare word with no operand.
@hint Postfix means every operand is already on the stack when its operator runs, so the three constants come first and `Mul` runs before `Add`.
@hint `add_const` gives you the index to put inside `Op::Const(..)`, and `push` appends the instruction. Six pushes: three `Const`, then `Mul`, `Add`, `Return`.

@diagnose E0004
`non-exhaustive patterns: Op::Neg and Op::Return not covered`. The match has to
produce a `String` for every `Op`, and two variants have no arm.

This error is the reason the instruction set is an enum rather than a `u8`. A
real bytecode format packs opcodes into single bytes, and a disassembler for one
is a `match` on an integer with a `_ => "unknown"` arm that hides every gap. Here
the gap is a build failure, and stage 7 adds five variants at once to make the
point again.

The scrutinee is `self.code[i]`, an `Op`, which is `Copy`, so the match moves
nothing and the arms can bind `k` and `t` by value.

@diagnose E0425
`cannot find value` usually means the operand binding in an arm does not match
the variant. `Op::Const(k)` binds the payload to `k`; the arms for variants with
no payload have nothing to bind and must not try.

@after
The side table is why bytecode is compact. `Op::Const(0)` refers to a slot
rather than carrying eight bytes of `f64` inline, so an instruction stays small
and a constant used twenty times is stored once. `add_const` scans for an
existing copy before appending, which is exactly what `clox` and CPython do.

Real formats go further: CPython's `co_consts` is a tuple beside the bytecode,
and the bytecode itself is pairs of bytes, opcode and argument. Widening a
`usize` index to a whole word here costs memory and saves you from writing an
instruction decoder.

## 2. Push, pop, and the arithmetic

@kind fix
@concept stack
@expect E0308

The machine is a `Vec<f64>` and a loop. Each instruction takes what it needs off
the top and puts its result back, which is why no instruction names a register.

`pop` does not return what it says it does, and five arithmetic operations are
stubbed out together. Split them and make the hand-written chunk evaluate.

```starter
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Op {
    Const(usize),
    Add,
    Sub,
    Mul,
    Div,
    Neg,
    Return,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Chunk {
    pub code: Vec<Op>,
    pub consts: Vec<f64>,
}

impl Chunk {
    pub fn new() -> Chunk {
        Chunk { code: Vec::new(), consts: Vec::new() }
    }

    pub fn push(&mut self, op: Op) -> usize {
        self.code.push(op);
        self.code.len() - 1
    }

    pub fn add_const(&mut self, n: f64) -> usize {
        for (i, c) in self.consts.iter().enumerate() {
            if *c == n {
                return i;
            }
        }
        self.consts.push(n);
        self.consts.len() - 1
    }

    pub fn line(&self, i: usize) -> String {
        match self.code[i] {
            Op::Const(k) => format!("{i:04}  CONST        {k}   ; {}", self.consts[k]),
            Op::Add => format!("{i:04}  ADD"),
            Op::Sub => format!("{i:04}  SUB"),
            Op::Mul => format!("{i:04}  MUL"),
            Op::Div => format!("{i:04}  DIV"),
            Op::Neg => format!("{i:04}  NEG"),
            Op::Return => format!("{i:04}  RETURN"),
        }
    }
}

#[derive(Debug, Default)]
pub struct Vm {
    stack: Vec<f64>,
}

impl Vm {
    pub fn new() -> Vm {
        Vm { stack: Vec::new() }
    }

    fn pop(&mut self) -> f64 {
        self.stack.pop()
    }

    pub fn run(&mut self, chunk: &Chunk) -> f64 {
        let mut ip = 0;
        while ip < chunk.code.len() {
            let op = chunk.code[ip];
            ip += 1;
            match op {
                Op::Const(k) => self.stack.push(chunk.consts[k]),
                Op::Add | Op::Sub | Op::Mul | Op::Div | Op::Neg => {
                    todo!("pop the operands, do the arithmetic, push the result")
                }
                Op::Return => return self.pop(),
            }
        }
        self.pop()
    }
}

pub fn hand_written() -> Chunk {
    let mut c = Chunk::new();
    let two = c.add_const(2.0);
    let three = c.add_const(3.0);
    let four = c.add_const(4.0);
    c.push(Op::Const(two));
    c.push(Op::Const(three));
    c.push(Op::Const(four));
    c.push(Op::Mul);
    c.push(Op::Add);
    c.push(Op::Return);
    c
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    fn build(consts: &[f64], ops: &[Op]) -> Chunk {
        let mut c = Chunk::new();
        for n in consts {
            c.add_const(*n);
        }
        for op in ops {
            c.push(*op);
        }
        c
    }

    #[test]
    fn the_hand_written_chunk_evaluates() {
        let c = hand_written();
        println!("{}", (0..c.code.len()).map(|i| c.line(i)).collect::<Vec<_>>().join("\n"));
        assert_eq!(Vm::new().run(&c), 14.0);
    }

    #[test]
    fn operand_order_matters() {
        let c = build(&[10.0, 4.0], &[Op::Const(0), Op::Const(1), Op::Sub, Op::Return]);
        assert_eq!(Vm::new().run(&c), 6.0);
    }

    #[test]
    fn division_and_negation() {
        let c = build(&[9.0, 3.0], &[Op::Const(0), Op::Const(1), Op::Div, Op::Neg, Op::Return]);
        assert_eq!(Vm::new().run(&c), -3.0);
    }

    #[test]
    fn one_stack_carries_two_subexpressions() {
        let c = build(
            &[2.0, 3.0, 4.0, 1.0],
            &[
                Op::Const(0), Op::Const(1), Op::Add,
                Op::Const(2), Op::Const(3), Op::Sub,
                Op::Mul, Op::Return,
            ],
        );
        assert_eq!(Vm::new().run(&c), 15.0);
    }
}
```

```solution
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Op {
    Const(usize),
    Add,
    Sub,
    Mul,
    Div,
    Neg,
    Return,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Chunk {
    pub code: Vec<Op>,
    pub consts: Vec<f64>,
}

impl Chunk {
    pub fn new() -> Chunk {
        Chunk { code: Vec::new(), consts: Vec::new() }
    }

    pub fn push(&mut self, op: Op) -> usize {
        self.code.push(op);
        self.code.len() - 1
    }

    pub fn add_const(&mut self, n: f64) -> usize {
        for (i, c) in self.consts.iter().enumerate() {
            if *c == n {
                return i;
            }
        }
        self.consts.push(n);
        self.consts.len() - 1
    }

    pub fn line(&self, i: usize) -> String {
        match self.code[i] {
            Op::Const(k) => format!("{i:04}  CONST        {k}   ; {}", self.consts[k]),
            Op::Add => format!("{i:04}  ADD"),
            Op::Sub => format!("{i:04}  SUB"),
            Op::Mul => format!("{i:04}  MUL"),
            Op::Div => format!("{i:04}  DIV"),
            Op::Neg => format!("{i:04}  NEG"),
            Op::Return => format!("{i:04}  RETURN"),
        }
    }
}

#[derive(Debug, Default)]
pub struct Vm {
    stack: Vec<f64>,
}

impl Vm {
    pub fn new() -> Vm {
        Vm { stack: Vec::new() }
    }

    fn pop(&mut self) -> f64 {
        self.stack.pop().expect("stack underflow")
    }

    pub fn run(&mut self, chunk: &Chunk) -> f64 {
        let mut ip = 0;
        while ip < chunk.code.len() {
            let op = chunk.code[ip];
            ip += 1;
            match op {
                Op::Const(k) => self.stack.push(chunk.consts[k]),
                Op::Add => {
                    let b = self.pop();
                    let a = self.pop();
                    self.stack.push(a + b);
                }
                Op::Sub => {
                    let b = self.pop();
                    let a = self.pop();
                    self.stack.push(a - b);
                }
                Op::Mul => {
                    let b = self.pop();
                    let a = self.pop();
                    self.stack.push(a * b);
                }
                Op::Div => {
                    let b = self.pop();
                    let a = self.pop();
                    self.stack.push(a / b);
                }
                Op::Neg => {
                    let a = self.pop();
                    self.stack.push(-a);
                }
                Op::Return => return self.pop(),
            }
        }
        self.pop()
    }
}

pub fn hand_written() -> Chunk {
    let mut c = Chunk::new();
    let two = c.add_const(2.0);
    let three = c.add_const(3.0);
    let four = c.add_const(4.0);
    c.push(Op::Const(two));
    c.push(Op::Const(three));
    c.push(Op::Const(four));
    c.push(Op::Mul);
    c.push(Op::Add);
    c.push(Op::Return);
    c
}
```

@hint `Vec::pop` cannot promise a value, because the vector might be empty. The signature here does promise one.
@hint For now, panicking on an empty stack is acceptable; stage 3 replaces it with a real error. `expect` with a message says what happened.
@hint Order matters for `Sub` and `Div`: the second operand is on top, so pop it into `b` first, then pop `a`, then push `a - b`.

@diagnose E0308
`expected f64, found Option<f64>`. `Vec::pop` returns `Option<f64>` because
popping an empty vector has to mean something, and `None` is what it means. The
function signature says it hands back an `f64`.

That mismatch is the entire question of what this VM does when the bytecode is
malformed. Three answers exist: panic (`expect`), return a `Result`, or return a
default and carry on. Stage 3 takes the second. For now `expect("stack
underflow")` is honest, because a chunk this compiler produced can only
underflow if the compiler has a bug, and a panic is the right response to that.

`unwrap()` compiles too. `expect` costs nothing extra and puts a sentence in the
panic message instead of a line number.

@diagnose E0004
The `todo!()` arm covers `Add | Sub | Mul | Div | Neg` as a group. Replacing it
with fewer arms than that leaves variants uncovered. Write all five.

@after
The loop is the interpreter, and its shape is worth memorising: read the
instruction at `ip`, advance `ip`, then act. Advancing before acting is what
lets a jump instruction overwrite `ip` in stage 7 without the increment
undoing it.

This is called a switch-threaded dispatch loop, and its cost is one indirect
branch per instruction. Faster designs exist. Computed goto, used by CPython,
puts a jump table at the end of every instruction so the branch predictor sees a
separate site per opcode. That is a two-times speedup and it needs a language
extension Rust does not have.

## 3. Errors that come back instead of aborting

@kind fix
@concept error
@expect E0277

A VM that aborts the process on bad input is not usable inside a larger program.
`run` now returns a `Result`, and `VmError` carries the instruction pointer so a
failure can say where it happened.

`pop` does not compile, and division still does the wrong thing when the divisor
is zero.

```starter
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Op {
    Const(usize),
    Add,
    Sub,
    Mul,
    Div,
    Neg,
    Return,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Chunk {
    pub code: Vec<Op>,
    pub consts: Vec<f64>,
}

impl Chunk {
    pub fn new() -> Chunk {
        Chunk { code: Vec::new(), consts: Vec::new() }
    }

    pub fn push(&mut self, op: Op) -> usize {
        self.code.push(op);
        self.code.len() - 1
    }

    pub fn add_const(&mut self, n: f64) -> usize {
        for (i, c) in self.consts.iter().enumerate() {
            if *c == n {
                return i;
            }
        }
        self.consts.push(n);
        self.consts.len() - 1
    }

    pub fn line(&self, i: usize) -> String {
        match self.code[i] {
            Op::Const(k) => format!("{i:04}  CONST        {k}   ; {}", self.consts[k]),
            Op::Add => format!("{i:04}  ADD"),
            Op::Sub => format!("{i:04}  SUB"),
            Op::Mul => format!("{i:04}  MUL"),
            Op::Div => format!("{i:04}  DIV"),
            Op::Neg => format!("{i:04}  NEG"),
            Op::Return => format!("{i:04}  RETURN"),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum VmError {
    DivideByZero { ip: usize },
    StackUnderflow { ip: usize },
    UndefinedName { ip: usize, name: String },
}

impl fmt::Display for VmError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            VmError::DivideByZero { ip } => write!(f, "divide by zero at {ip:04}"),
            VmError::StackUnderflow { ip } => write!(f, "stack underflow at {ip:04}"),
            VmError::UndefinedName { ip, name } => write!(f, "undefined name `{name}` at {ip:04}"),
        }
    }
}

impl std::error::Error for VmError {}

#[derive(Debug, Default)]
pub struct Vm {
    stack: Vec<f64>,
}

impl Vm {
    pub fn new() -> Vm {
        Vm { stack: Vec::new() }
    }

    fn pop(&mut self, ip: usize) -> Result<f64, VmError> {
        let v = self.stack.pop()?;
        Ok(v)
    }

    pub fn run(&mut self, chunk: &Chunk) -> Result<f64, VmError> {
        let mut ip = 0;
        while ip < chunk.code.len() {
            let here = ip;
            let op = chunk.code[ip];
            ip += 1;
            match op {
                Op::Const(k) => self.stack.push(chunk.consts[k]),
                Op::Add => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a + b);
                }
                Op::Sub => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a - b);
                }
                Op::Mul => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a * b);
                }
                Op::Div => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a / b);
                }
                Op::Neg => {
                    let a = self.pop(here)?;
                    self.stack.push(-a);
                }
                Op::Return => return self.pop(here),
            }
        }
        self.pop(ip)
    }
}

pub fn hand_written() -> Chunk {
    let mut c = Chunk::new();
    let two = c.add_const(2.0);
    let three = c.add_const(3.0);
    let four = c.add_const(4.0);
    c.push(Op::Const(two));
    c.push(Op::Const(three));
    c.push(Op::Const(four));
    c.push(Op::Mul);
    c.push(Op::Add);
    c.push(Op::Return);
    c
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    fn build(consts: &[f64], ops: &[Op]) -> Chunk {
        let mut c = Chunk::new();
        for n in consts {
            c.add_const(*n);
        }
        for op in ops {
            c.push(*op);
        }
        c
    }

    #[test]
    fn arithmetic_still_works() {
        assert_eq!(Vm::new().run(&hand_written()), Ok(14.0));
    }

    #[test]
    fn dividing_by_zero_is_an_error() {
        let c = build(&[1.0, 0.0], &[Op::Const(0), Op::Const(1), Op::Div, Op::Return]);
        let e = Vm::new().run(&c).unwrap_err();
        println!("{e}");
        assert_eq!(e, VmError::DivideByZero { ip: 2 });
    }

    #[test]
    fn an_empty_stack_is_an_error() {
        let c = build(&[], &[Op::Add, Op::Return]);
        assert_eq!(Vm::new().run(&c), Err(VmError::StackUnderflow { ip: 0 }));
        assert_eq!(
            VmError::StackUnderflow { ip: 0 }.to_string(),
            "stack underflow at 0000"
        );
    }

    #[test]
    fn dividing_by_anything_else_is_fine() {
        let c = build(&[9.0, 3.0], &[Op::Const(0), Op::Const(1), Op::Div, Op::Return]);
        assert_eq!(Vm::new().run(&c), Ok(3.0));
    }
}
```

```solution
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Op {
    Const(usize),
    Add,
    Sub,
    Mul,
    Div,
    Neg,
    Return,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Chunk {
    pub code: Vec<Op>,
    pub consts: Vec<f64>,
}

impl Chunk {
    pub fn new() -> Chunk {
        Chunk { code: Vec::new(), consts: Vec::new() }
    }

    pub fn push(&mut self, op: Op) -> usize {
        self.code.push(op);
        self.code.len() - 1
    }

    pub fn add_const(&mut self, n: f64) -> usize {
        for (i, c) in self.consts.iter().enumerate() {
            if *c == n {
                return i;
            }
        }
        self.consts.push(n);
        self.consts.len() - 1
    }

    pub fn line(&self, i: usize) -> String {
        match self.code[i] {
            Op::Const(k) => format!("{i:04}  CONST        {k}   ; {}", self.consts[k]),
            Op::Add => format!("{i:04}  ADD"),
            Op::Sub => format!("{i:04}  SUB"),
            Op::Mul => format!("{i:04}  MUL"),
            Op::Div => format!("{i:04}  DIV"),
            Op::Neg => format!("{i:04}  NEG"),
            Op::Return => format!("{i:04}  RETURN"),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum VmError {
    DivideByZero { ip: usize },
    StackUnderflow { ip: usize },
    UndefinedName { ip: usize, name: String },
}

impl fmt::Display for VmError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            VmError::DivideByZero { ip } => write!(f, "divide by zero at {ip:04}"),
            VmError::StackUnderflow { ip } => write!(f, "stack underflow at {ip:04}"),
            VmError::UndefinedName { ip, name } => write!(f, "undefined name `{name}` at {ip:04}"),
        }
    }
}

impl std::error::Error for VmError {}

#[derive(Debug, Default)]
pub struct Vm {
    stack: Vec<f64>,
}

impl Vm {
    pub fn new() -> Vm {
        Vm { stack: Vec::new() }
    }

    fn pop(&mut self, ip: usize) -> Result<f64, VmError> {
        match self.stack.pop() {
            Some(v) => Ok(v),
            None => Err(VmError::StackUnderflow { ip }),
        }
    }

    pub fn run(&mut self, chunk: &Chunk) -> Result<f64, VmError> {
        let mut ip = 0;
        while ip < chunk.code.len() {
            let here = ip;
            let op = chunk.code[ip];
            ip += 1;
            match op {
                Op::Const(k) => self.stack.push(chunk.consts[k]),
                Op::Add => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a + b);
                }
                Op::Sub => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a - b);
                }
                Op::Mul => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a * b);
                }
                Op::Div => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    if b == 0.0 {
                        return Err(VmError::DivideByZero { ip: here });
                    }
                    self.stack.push(a / b);
                }
                Op::Neg => {
                    let a = self.pop(here)?;
                    self.stack.push(-a);
                }
                Op::Return => return self.pop(here),
            }
        }
        self.pop(ip)
    }
}

pub fn hand_written() -> Chunk {
    let mut c = Chunk::new();
    let two = c.add_const(2.0);
    let three = c.add_const(3.0);
    let four = c.add_const(4.0);
    c.push(Op::Const(two));
    c.push(Op::Const(three));
    c.push(Op::Const(four));
    c.push(Op::Mul);
    c.push(Op::Add);
    c.push(Op::Return);
    c
}
```

@hint `Vec::pop` returns an `Option`, and this function returns a `Result`. `?` cannot bridge those two on its own.
@hint An empty stack here is `VmError::StackUnderflow { ip }`, and `ip` is already a parameter for exactly that reason.
@hint For division, check `b == 0.0` after both pops and before the push, and return `VmError::DivideByZero { ip: here }`.

@diagnose E0277
`the ? operator can only be used on Results, not Options, in a function that
returns Result`. `?` on an `Option` wants to return `None` from the enclosing
function, and this function has no `None` to return.

Rust will not invent the error value for you. `None` from `pop` means the
bytecode asked for an operand that is not there, and only you know that this
should be `StackUnderflow` with this `ip`. A `match`, or `ok_or` with the error
value, is where you say so.

Note that `2.0 / 0.0` in Rust is `inf` rather than a panic, so the divide check
is a policy choice about your language, not a rescue from undefined behaviour.
Integer division by zero would be the panic.

@diagnose E0308
Every arm of the loop now sits in a function returning
`Result<f64, VmError>`. `self.pop(here)` gives a `Result`, so each use needs `?`
to get the `f64` out, and `Op::Return => return self.pop(here)` returns the
`Result` itself with no `?` at all.

@after
`VmError` carries `ip` in every variant, which is what makes the message
`divide by zero at 0007` possible. That number indexes straight into the
disassembly, so a failure points at an instruction you can read.

Real VMs map the instruction pointer back to a source line, which means the
compiler has to record a line number per instruction. `clox` keeps a parallel
`Vec<usize>` of lines beside the code; CPython packs a compressed line table
into the code object. The pattern is the same: the error type carries a
position, and something on the side turns that position into a location a person
recognises.

## 4. Reading infix arithmetic

@kind fix
@concept lexer
@expect E0599

The compiler needs tokens, not characters. This tokenizer produces numbers and
the six punctuation marks that arithmetic uses, and reports the character index
when it meets something else.

The number branch cannot convert what it scanned, and four punctuation marks are
missing.

```starter
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Op {
    Const(usize),
    Add,
    Sub,
    Mul,
    Div,
    Neg,
    Return,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Chunk {
    pub code: Vec<Op>,
    pub consts: Vec<f64>,
}

impl Chunk {
    pub fn new() -> Chunk {
        Chunk { code: Vec::new(), consts: Vec::new() }
    }

    pub fn push(&mut self, op: Op) -> usize {
        self.code.push(op);
        self.code.len() - 1
    }

    pub fn add_const(&mut self, n: f64) -> usize {
        for (i, c) in self.consts.iter().enumerate() {
            if *c == n {
                return i;
            }
        }
        self.consts.push(n);
        self.consts.len() - 1
    }

    pub fn line(&self, i: usize) -> String {
        match self.code[i] {
            Op::Const(k) => format!("{i:04}  CONST        {k}   ; {}", self.consts[k]),
            Op::Add => format!("{i:04}  ADD"),
            Op::Sub => format!("{i:04}  SUB"),
            Op::Mul => format!("{i:04}  MUL"),
            Op::Div => format!("{i:04}  DIV"),
            Op::Neg => format!("{i:04}  NEG"),
            Op::Return => format!("{i:04}  RETURN"),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum VmError {
    DivideByZero { ip: usize },
    StackUnderflow { ip: usize },
    UndefinedName { ip: usize, name: String },
}

impl fmt::Display for VmError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            VmError::DivideByZero { ip } => write!(f, "divide by zero at {ip:04}"),
            VmError::StackUnderflow { ip } => write!(f, "stack underflow at {ip:04}"),
            VmError::UndefinedName { ip, name } => write!(f, "undefined name `{name}` at {ip:04}"),
        }
    }
}

impl std::error::Error for VmError {}

#[derive(Debug, Clone, PartialEq)]
pub struct CompileError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for CompileError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at token {}", self.msg, self.pos)
    }
}

impl std::error::Error for CompileError {}

#[derive(Debug, Default)]
pub struct Vm {
    stack: Vec<f64>,
}

impl Vm {
    pub fn new() -> Vm {
        Vm { stack: Vec::new() }
    }

    fn pop(&mut self, ip: usize) -> Result<f64, VmError> {
        match self.stack.pop() {
            Some(v) => Ok(v),
            None => Err(VmError::StackUnderflow { ip }),
        }
    }

    pub fn run(&mut self, chunk: &Chunk) -> Result<f64, VmError> {
        let mut ip = 0;
        while ip < chunk.code.len() {
            let here = ip;
            let op = chunk.code[ip];
            ip += 1;
            match op {
                Op::Const(k) => self.stack.push(chunk.consts[k]),
                Op::Add => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a + b);
                }
                Op::Sub => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a - b);
                }
                Op::Mul => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a * b);
                }
                Op::Div => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    if b == 0.0 {
                        return Err(VmError::DivideByZero { ip: here });
                    }
                    self.stack.push(a / b);
                }
                Op::Neg => {
                    let a = self.pop(here)?;
                    self.stack.push(-a);
                }
                Op::Return => return self.pop(here),
            }
        }
        self.pop(ip)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Tok {
    Num(f64),
    Plus,
    Minus,
    Star,
    Slash,
    LParen,
    RParen,
}

pub fn tokenize(src: &str) -> Result<Vec<Tok>, CompileError> {
    let chars: Vec<char> = src.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if c.is_ascii_digit() {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            let text = &chars[start..i];
            match text.parse::<f64>() {
                Ok(n) => out.push(Tok::Num(n)),
                Err(_) => return Err(CompileError { pos: start, msg: "bad number".to_string() }),
            }
            continue;
        }
        let t = match c {
            '+' => Tok::Plus,
            '-' => Tok::Minus,
            other => return Err(CompileError { pos: i, msg: format!("unexpected character `{other}`") }),
        };
        out.push(t);
        i += 1;
    }
    Ok(out)
}

pub fn hand_written() -> Chunk {
    let mut c = Chunk::new();
    let two = c.add_const(2.0);
    let three = c.add_const(3.0);
    let four = c.add_const(4.0);
    c.push(Op::Const(two));
    c.push(Op::Const(three));
    c.push(Op::Const(four));
    c.push(Op::Mul);
    c.push(Op::Add);
    c.push(Op::Return);
    c
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_arithmetic_tokens() {
        assert_eq!(
            tokenize("2 + 3 * 4").unwrap(),
            vec![Tok::Num(2.0), Tok::Plus, Tok::Num(3.0), Tok::Star, Tok::Num(4.0)]
        );
    }

    #[test]
    fn parentheses_and_division() {
        let t = tokenize("(1.5 - 0.5) / 2").unwrap();
        println!("{t:?}");
        assert_eq!(
            t,
            vec![
                Tok::LParen, Tok::Num(1.5), Tok::Minus, Tok::Num(0.5),
                Tok::RParen, Tok::Slash, Tok::Num(2.0),
            ]
        );
    }

    #[test]
    fn whitespace_disappears() {
        assert_eq!(tokenize("  \n 7  ").unwrap(), vec![Tok::Num(7.0)]);
        assert_eq!(tokenize("").unwrap(), Vec::new());
    }

    #[test]
    fn bad_input_carries_a_position() {
        let e = tokenize("1 + $").unwrap_err();
        println!("{e}");
        assert_eq!(e.pos, 4);
        assert!(e.to_string().contains("unexpected character"));
        assert!(tokenize("1.2.3").is_err());
    }
}
```

```solution
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Op {
    Const(usize),
    Add,
    Sub,
    Mul,
    Div,
    Neg,
    Return,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Chunk {
    pub code: Vec<Op>,
    pub consts: Vec<f64>,
}

impl Chunk {
    pub fn new() -> Chunk {
        Chunk { code: Vec::new(), consts: Vec::new() }
    }

    pub fn push(&mut self, op: Op) -> usize {
        self.code.push(op);
        self.code.len() - 1
    }

    pub fn add_const(&mut self, n: f64) -> usize {
        for (i, c) in self.consts.iter().enumerate() {
            if *c == n {
                return i;
            }
        }
        self.consts.push(n);
        self.consts.len() - 1
    }

    pub fn line(&self, i: usize) -> String {
        match self.code[i] {
            Op::Const(k) => format!("{i:04}  CONST        {k}   ; {}", self.consts[k]),
            Op::Add => format!("{i:04}  ADD"),
            Op::Sub => format!("{i:04}  SUB"),
            Op::Mul => format!("{i:04}  MUL"),
            Op::Div => format!("{i:04}  DIV"),
            Op::Neg => format!("{i:04}  NEG"),
            Op::Return => format!("{i:04}  RETURN"),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum VmError {
    DivideByZero { ip: usize },
    StackUnderflow { ip: usize },
    UndefinedName { ip: usize, name: String },
}

impl fmt::Display for VmError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            VmError::DivideByZero { ip } => write!(f, "divide by zero at {ip:04}"),
            VmError::StackUnderflow { ip } => write!(f, "stack underflow at {ip:04}"),
            VmError::UndefinedName { ip, name } => write!(f, "undefined name `{name}` at {ip:04}"),
        }
    }
}

impl std::error::Error for VmError {}

#[derive(Debug, Clone, PartialEq)]
pub struct CompileError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for CompileError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at token {}", self.msg, self.pos)
    }
}

impl std::error::Error for CompileError {}

#[derive(Debug, Default)]
pub struct Vm {
    stack: Vec<f64>,
}

impl Vm {
    pub fn new() -> Vm {
        Vm { stack: Vec::new() }
    }

    fn pop(&mut self, ip: usize) -> Result<f64, VmError> {
        match self.stack.pop() {
            Some(v) => Ok(v),
            None => Err(VmError::StackUnderflow { ip }),
        }
    }

    pub fn run(&mut self, chunk: &Chunk) -> Result<f64, VmError> {
        let mut ip = 0;
        while ip < chunk.code.len() {
            let here = ip;
            let op = chunk.code[ip];
            ip += 1;
            match op {
                Op::Const(k) => self.stack.push(chunk.consts[k]),
                Op::Add => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a + b);
                }
                Op::Sub => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a - b);
                }
                Op::Mul => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a * b);
                }
                Op::Div => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    if b == 0.0 {
                        return Err(VmError::DivideByZero { ip: here });
                    }
                    self.stack.push(a / b);
                }
                Op::Neg => {
                    let a = self.pop(here)?;
                    self.stack.push(-a);
                }
                Op::Return => return self.pop(here),
            }
        }
        self.pop(ip)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Tok {
    Num(f64),
    Plus,
    Minus,
    Star,
    Slash,
    LParen,
    RParen,
}

pub fn tokenize(src: &str) -> Result<Vec<Tok>, CompileError> {
    let chars: Vec<char> = src.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if c.is_ascii_digit() {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            let text: String = chars[start..i].iter().collect();
            match text.parse::<f64>() {
                Ok(n) => out.push(Tok::Num(n)),
                Err(_) => return Err(CompileError { pos: start, msg: format!("bad number `{text}`") }),
            }
            continue;
        }
        let t = match c {
            '+' => Tok::Plus,
            '-' => Tok::Minus,
            '*' => Tok::Star,
            '/' => Tok::Slash,
            '(' => Tok::LParen,
            ')' => Tok::RParen,
            other => return Err(CompileError { pos: i, msg: format!("unexpected character `{other}`") }),
        };
        out.push(t);
        i += 1;
    }
    Ok(out)
}

pub fn hand_written() -> Chunk {
    let mut c = Chunk::new();
    let two = c.add_const(2.0);
    let three = c.add_const(3.0);
    let four = c.add_const(4.0);
    c.push(Op::Const(two));
    c.push(Op::Const(three));
    c.push(Op::Const(four));
    c.push(Op::Mul);
    c.push(Op::Add);
    c.push(Op::Return);
    c
}
```

@hint `chars` is a `Vec<char>`, so slicing it gives characters rather than text, and the conversion you want is a method on `str`.
@hint `chars[start..i].iter().collect::<String>()` builds the text. `collect` needs to be told what to build.
@hint Then add `'*'`, `'/'`, `'('` and `')'` to the punctuation match, each mapping to its `Tok` variant.

@diagnose E0599
`no method named parse found for reference &[char]`. A `char` is a four-byte
scalar value and a `str` is a run of UTF-8 bytes, so a slice of the first is not
the second and `parse` genuinely is not there.

`.iter().collect::<String>()` rebuilds the text, allocating once per number
literal. That is the cost of scanning over `Vec<char>` instead of `&[u8]`, and
it buys indexing that cannot land in the middle of a multi-byte character.

Once `text` is a `String`, `format!("bad number `{text}`")` also starts working;
a `[char]` has no `Display` impl, so the error message could not have printed it
either.

@diagnose E0282
`collect` can build a `String`, a `Vec<char>`, a `HashSet<char>` and much else,
and nothing in the expression says which. Write `.collect::<String>()` or
annotate the binding as `let text: String = ...`.

@after
Scanning the extent and handing the text to `f64::from_str` is both shorter and
more accurate than accumulating digits by hand, because correctly rounded
decimal to binary conversion is subtle and the standard library already has it.

The tokenizer accepts `1.2.3` into its scan and lets the parse fail, which gives
a clear message at the right position. Rejecting it during the scan would need
a state machine tracking whether a dot has been seen. Letting a later, stricter
stage catch the error is a normal division of labour in a compiler front end.

## 5. Precedence, which is where the compiling happens

@kind fix
@concept precedence
@expect E0308

Turning `2 + 3 * 4` into postfix is the point of the whole project. The rule is
one number per operator, its binding power, and a loop that keeps consuming
operators while they bind at least as tightly as the caller allowed.

`unary` does not compile. `expr` parses one operand and then stops.

```starter
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Op {
    Const(usize),
    Add,
    Sub,
    Mul,
    Div,
    Neg,
    Return,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Chunk {
    pub code: Vec<Op>,
    pub consts: Vec<f64>,
}

impl Chunk {
    pub fn new() -> Chunk {
        Chunk { code: Vec::new(), consts: Vec::new() }
    }

    pub fn push(&mut self, op: Op) -> usize {
        self.code.push(op);
        self.code.len() - 1
    }

    pub fn add_const(&mut self, n: f64) -> usize {
        for (i, c) in self.consts.iter().enumerate() {
            if *c == n {
                return i;
            }
        }
        self.consts.push(n);
        self.consts.len() - 1
    }

    pub fn line(&self, i: usize) -> String {
        match self.code[i] {
            Op::Const(k) => format!("{i:04}  CONST        {k}   ; {}", self.consts[k]),
            Op::Add => format!("{i:04}  ADD"),
            Op::Sub => format!("{i:04}  SUB"),
            Op::Mul => format!("{i:04}  MUL"),
            Op::Div => format!("{i:04}  DIV"),
            Op::Neg => format!("{i:04}  NEG"),
            Op::Return => format!("{i:04}  RETURN"),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum VmError {
    DivideByZero { ip: usize },
    StackUnderflow { ip: usize },
    UndefinedName { ip: usize, name: String },
}

impl fmt::Display for VmError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            VmError::DivideByZero { ip } => write!(f, "divide by zero at {ip:04}"),
            VmError::StackUnderflow { ip } => write!(f, "stack underflow at {ip:04}"),
            VmError::UndefinedName { ip, name } => write!(f, "undefined name `{name}` at {ip:04}"),
        }
    }
}

impl std::error::Error for VmError {}

#[derive(Debug, Clone, PartialEq)]
pub struct CompileError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for CompileError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at token {}", self.msg, self.pos)
    }
}

impl std::error::Error for CompileError {}

#[derive(Debug, Clone, PartialEq)]
pub enum Error {
    Compile(CompileError),
    Runtime(VmError),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Error::Compile(e) => write!(f, "compile error: {e}"),
            Error::Runtime(e) => write!(f, "runtime error: {e}"),
        }
    }
}

impl From<CompileError> for Error {
    fn from(e: CompileError) -> Error {
        Error::Compile(e)
    }
}

impl From<VmError> for Error {
    fn from(e: VmError) -> Error {
        Error::Runtime(e)
    }
}

#[derive(Debug, Default)]
pub struct Vm {
    stack: Vec<f64>,
}

impl Vm {
    pub fn new() -> Vm {
        Vm { stack: Vec::new() }
    }

    fn pop(&mut self, ip: usize) -> Result<f64, VmError> {
        match self.stack.pop() {
            Some(v) => Ok(v),
            None => Err(VmError::StackUnderflow { ip }),
        }
    }

    pub fn run(&mut self, chunk: &Chunk) -> Result<f64, VmError> {
        let mut ip = 0;
        while ip < chunk.code.len() {
            let here = ip;
            let op = chunk.code[ip];
            ip += 1;
            match op {
                Op::Const(k) => self.stack.push(chunk.consts[k]),
                Op::Add => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a + b);
                }
                Op::Sub => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a - b);
                }
                Op::Mul => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a * b);
                }
                Op::Div => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    if b == 0.0 {
                        return Err(VmError::DivideByZero { ip: here });
                    }
                    self.stack.push(a / b);
                }
                Op::Neg => {
                    let a = self.pop(here)?;
                    self.stack.push(-a);
                }
                Op::Return => return self.pop(here),
            }
        }
        self.pop(ip)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Tok {
    Num(f64),
    Plus,
    Minus,
    Star,
    Slash,
    LParen,
    RParen,
}

pub fn tokenize(src: &str) -> Result<Vec<Tok>, CompileError> {
    let chars: Vec<char> = src.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if c.is_ascii_digit() {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            let text: String = chars[start..i].iter().collect();
            match text.parse::<f64>() {
                Ok(n) => out.push(Tok::Num(n)),
                Err(_) => return Err(CompileError { pos: start, msg: format!("bad number `{text}`") }),
            }
            continue;
        }
        let t = match c {
            '+' => Tok::Plus,
            '-' => Tok::Minus,
            '*' => Tok::Star,
            '/' => Tok::Slash,
            '(' => Tok::LParen,
            ')' => Tok::RParen,
            other => return Err(CompileError { pos: i, msg: format!("unexpected character `{other}`") }),
        };
        out.push(t);
        i += 1;
    }
    Ok(out)
}

pub struct Compiler {
    toks: Vec<Tok>,
    pos: usize,
    chunk: Chunk,
}

impl Compiler {
    pub fn new(toks: Vec<Tok>) -> Compiler {
        Compiler { toks, pos: 0, chunk: Chunk::new() }
    }

    fn at(&self, k: usize) -> Option<Tok> {
        self.toks.get(self.pos + k).cloned()
    }

    fn eat(&mut self, want: &Tok) -> bool {
        if self.toks.get(self.pos) == Some(want) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn expect(&mut self, want: &Tok, what: &str) -> Result<(), CompileError> {
        if self.eat(want) {
            Ok(())
        } else {
            Err(CompileError { pos: self.pos, msg: format!("expected {what}") })
        }
    }

    fn unary(&mut self) -> Result<(), CompileError> {
        match self.at(0) {
            Some(Tok::Minus) => {
                self.pos += 1;
                self.unary()?;
                self.chunk.push(Op::Neg);
                Ok(())
            }
            Some(Tok::Num(n)) => {
                self.pos += 1;
                let k = self.chunk.add_const(n);
                self.chunk.push(Op::Const(k))
            }
            Some(Tok::LParen) => {
                self.pos += 1;
                self.expr(1)?;
                self.expect(&Tok::RParen, "`)`")
            }
            _ => Err(CompileError { pos: self.pos, msg: "expected a value".to_string() }),
        }
    }

    fn expr(&mut self, min_bp: u8) -> Result<(), CompileError> {
        self.unary()?;
        // the loop that reads binary operators goes here
        Ok(())
    }

    pub fn finish(mut self) -> Result<Chunk, CompileError> {
        self.expr(1)?;
        if self.pos < self.toks.len() {
            return Err(CompileError { pos: self.pos, msg: "leftover input".to_string() });
        }
        self.chunk.push(Op::Return);
        Ok(self.chunk)
    }
}

pub fn compile(src: &str) -> Result<Chunk, CompileError> {
    Compiler::new(tokenize(src)?).finish()
}

pub fn eval(src: &str) -> Result<f64, Error> {
    let chunk = compile(src)?;
    let mut vm = Vm::new();
    Ok(vm.run(&chunk)?)
}

pub fn hand_written() -> Chunk {
    let mut c = Chunk::new();
    let two = c.add_const(2.0);
    let three = c.add_const(3.0);
    let four = c.add_const(4.0);
    c.push(Op::Const(two));
    c.push(Op::Const(three));
    c.push(Op::Const(four));
    c.push(Op::Mul);
    c.push(Op::Add);
    c.push(Op::Return);
    c
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multiplication_binds_tighter() {
        assert_eq!(eval("2 + 3 * 4"), Ok(14.0));
        assert_eq!(eval("2 * 3 + 4"), Ok(10.0));
    }

    #[test]
    fn parentheses_override_precedence() {
        assert_eq!(eval("(2 + 3) * 4"), Ok(20.0));
        assert_eq!(eval("2 * (3 + 4)"), Ok(14.0));
    }

    #[test]
    fn subtraction_groups_to_the_left() {
        assert_eq!(eval("10 - 3 - 4"), Ok(3.0));
        assert_eq!(eval("16 / 4 / 2"), Ok(2.0));
        assert_eq!(eval("-2 + 3"), Ok(1.0));
    }

    #[test]
    fn the_compiled_form_is_the_hand_written_one() {
        let c = compile("2 + 3 * 4").unwrap();
        println!("{}", (0..c.code.len()).map(|i| c.line(i)).collect::<Vec<_>>().join("\n"));
        assert_eq!(c.code, hand_written().code);
        assert_eq!(c.consts, vec![2.0, 3.0, 4.0]);
        assert!(matches!(eval("2 +"), Err(Error::Compile(_))));
        assert!(matches!(eval("1 / 0"), Err(Error::Runtime(VmError::DivideByZero { .. }))));
    }
}
```

```solution
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Op {
    Const(usize),
    Add,
    Sub,
    Mul,
    Div,
    Neg,
    Return,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Chunk {
    pub code: Vec<Op>,
    pub consts: Vec<f64>,
}

impl Chunk {
    pub fn new() -> Chunk {
        Chunk { code: Vec::new(), consts: Vec::new() }
    }

    pub fn push(&mut self, op: Op) -> usize {
        self.code.push(op);
        self.code.len() - 1
    }

    pub fn add_const(&mut self, n: f64) -> usize {
        for (i, c) in self.consts.iter().enumerate() {
            if *c == n {
                return i;
            }
        }
        self.consts.push(n);
        self.consts.len() - 1
    }

    pub fn line(&self, i: usize) -> String {
        match self.code[i] {
            Op::Const(k) => format!("{i:04}  CONST        {k}   ; {}", self.consts[k]),
            Op::Add => format!("{i:04}  ADD"),
            Op::Sub => format!("{i:04}  SUB"),
            Op::Mul => format!("{i:04}  MUL"),
            Op::Div => format!("{i:04}  DIV"),
            Op::Neg => format!("{i:04}  NEG"),
            Op::Return => format!("{i:04}  RETURN"),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum VmError {
    DivideByZero { ip: usize },
    StackUnderflow { ip: usize },
    UndefinedName { ip: usize, name: String },
}

impl fmt::Display for VmError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            VmError::DivideByZero { ip } => write!(f, "divide by zero at {ip:04}"),
            VmError::StackUnderflow { ip } => write!(f, "stack underflow at {ip:04}"),
            VmError::UndefinedName { ip, name } => write!(f, "undefined name `{name}` at {ip:04}"),
        }
    }
}

impl std::error::Error for VmError {}

#[derive(Debug, Clone, PartialEq)]
pub struct CompileError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for CompileError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at token {}", self.msg, self.pos)
    }
}

impl std::error::Error for CompileError {}

#[derive(Debug, Clone, PartialEq)]
pub enum Error {
    Compile(CompileError),
    Runtime(VmError),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Error::Compile(e) => write!(f, "compile error: {e}"),
            Error::Runtime(e) => write!(f, "runtime error: {e}"),
        }
    }
}

impl From<CompileError> for Error {
    fn from(e: CompileError) -> Error {
        Error::Compile(e)
    }
}

impl From<VmError> for Error {
    fn from(e: VmError) -> Error {
        Error::Runtime(e)
    }
}

#[derive(Debug, Default)]
pub struct Vm {
    stack: Vec<f64>,
}

impl Vm {
    pub fn new() -> Vm {
        Vm { stack: Vec::new() }
    }

    fn pop(&mut self, ip: usize) -> Result<f64, VmError> {
        match self.stack.pop() {
            Some(v) => Ok(v),
            None => Err(VmError::StackUnderflow { ip }),
        }
    }

    pub fn run(&mut self, chunk: &Chunk) -> Result<f64, VmError> {
        let mut ip = 0;
        while ip < chunk.code.len() {
            let here = ip;
            let op = chunk.code[ip];
            ip += 1;
            match op {
                Op::Const(k) => self.stack.push(chunk.consts[k]),
                Op::Add => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a + b);
                }
                Op::Sub => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a - b);
                }
                Op::Mul => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a * b);
                }
                Op::Div => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    if b == 0.0 {
                        return Err(VmError::DivideByZero { ip: here });
                    }
                    self.stack.push(a / b);
                }
                Op::Neg => {
                    let a = self.pop(here)?;
                    self.stack.push(-a);
                }
                Op::Return => return self.pop(here),
            }
        }
        self.pop(ip)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Tok {
    Num(f64),
    Plus,
    Minus,
    Star,
    Slash,
    LParen,
    RParen,
}

pub fn tokenize(src: &str) -> Result<Vec<Tok>, CompileError> {
    let chars: Vec<char> = src.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if c.is_ascii_digit() {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            let text: String = chars[start..i].iter().collect();
            match text.parse::<f64>() {
                Ok(n) => out.push(Tok::Num(n)),
                Err(_) => return Err(CompileError { pos: start, msg: format!("bad number `{text}`") }),
            }
            continue;
        }
        let t = match c {
            '+' => Tok::Plus,
            '-' => Tok::Minus,
            '*' => Tok::Star,
            '/' => Tok::Slash,
            '(' => Tok::LParen,
            ')' => Tok::RParen,
            other => return Err(CompileError { pos: i, msg: format!("unexpected character `{other}`") }),
        };
        out.push(t);
        i += 1;
    }
    Ok(out)
}

pub struct Compiler {
    toks: Vec<Tok>,
    pos: usize,
    chunk: Chunk,
}

impl Compiler {
    pub fn new(toks: Vec<Tok>) -> Compiler {
        Compiler { toks, pos: 0, chunk: Chunk::new() }
    }

    fn at(&self, k: usize) -> Option<Tok> {
        self.toks.get(self.pos + k).cloned()
    }

    fn eat(&mut self, want: &Tok) -> bool {
        if self.toks.get(self.pos) == Some(want) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn expect(&mut self, want: &Tok, what: &str) -> Result<(), CompileError> {
        if self.eat(want) {
            Ok(())
        } else {
            Err(CompileError { pos: self.pos, msg: format!("expected {what}") })
        }
    }

    fn unary(&mut self) -> Result<(), CompileError> {
        match self.at(0) {
            Some(Tok::Minus) => {
                self.pos += 1;
                self.unary()?;
                self.chunk.push(Op::Neg);
                Ok(())
            }
            Some(Tok::Num(n)) => {
                self.pos += 1;
                let k = self.chunk.add_const(n);
                self.chunk.push(Op::Const(k));
                Ok(())
            }
            Some(Tok::LParen) => {
                self.pos += 1;
                self.expr(1)?;
                self.expect(&Tok::RParen, "`)`")
            }
            _ => Err(CompileError { pos: self.pos, msg: "expected a value".to_string() }),
        }
    }

    fn expr(&mut self, min_bp: u8) -> Result<(), CompileError> {
        self.unary()?;
        loop {
            let (bp, op) = match self.at(0) {
                Some(Tok::Plus) => (2, Op::Add),
                Some(Tok::Minus) => (2, Op::Sub),
                Some(Tok::Star) => (3, Op::Mul),
                Some(Tok::Slash) => (3, Op::Div),
                _ => break,
            };
            if bp < min_bp {
                break;
            }
            self.pos += 1;
            self.expr(bp + 1)?;
            self.chunk.push(op);
        }
        Ok(())
    }

    pub fn finish(mut self) -> Result<Chunk, CompileError> {
        self.expr(1)?;
        if self.pos < self.toks.len() {
            return Err(CompileError { pos: self.pos, msg: "leftover input".to_string() });
        }
        self.chunk.push(Op::Return);
        Ok(self.chunk)
    }
}

pub fn compile(src: &str) -> Result<Chunk, CompileError> {
    Compiler::new(tokenize(src)?).finish()
}

pub fn eval(src: &str) -> Result<f64, Error> {
    let chunk = compile(src)?;
    let mut vm = Vm::new();
    Ok(vm.run(&chunk)?)
}

pub fn hand_written() -> Chunk {
    let mut c = Chunk::new();
    let two = c.add_const(2.0);
    let three = c.add_const(3.0);
    let four = c.add_const(4.0);
    c.push(Op::Const(two));
    c.push(Op::Const(three));
    c.push(Op::Const(four));
    c.push(Op::Mul);
    c.push(Op::Add);
    c.push(Op::Return);
    c
}
```

@hint `Chunk::push` returns the index it wrote to, which is useful in stage 7 and is not what a parsing method should hand back.
@hint In `expr`, read the next token, look up its binding power, and stop if that power is below `min_bp`. Otherwise consume it, parse the right side, and emit the operator.
@hint Recurse with `self.expr(bp + 1)` for the right side. The `+ 1` is what makes `10 - 3 - 4` group as `(10 - 3) - 4` rather than `10 - (3 - 4)`.

@diagnose E0308
`expected Result<(), CompileError>, found usize`. `Chunk::push` returns the index
of the instruction it appended, and that index is the value of the arm, while
every other arm ends in `Ok(())`.

A `match` is an expression whose arms must all have one type, so rustc reports
the arm that disagrees rather than the match. The fix is to end the arm with
`Ok(())` and let the index be discarded.

The return value of `push` is not decoration. Stage 7 uses it to remember where
a jump instruction sits so the target can be filled in once it is known.

@diagnose E0072
A recursive *type* has infinite size, but recursive *functions* are fine, which
is what `expr` and `unary` are: `expr` calls `unary`, `unary` calls `expr` for a
parenthesised subexpression, and the call stack does the bookkeeping. If you see
E0072 you have accidentally put an `Op` inside an `Op` rather than an index.

@after
This is precedence climbing, also called Pratt parsing, and it replaces the
usual ladder of one grammar rule per precedence level (`expression`, `term`,
`factor`, `primary`) with one function and a table. Adding an operator is adding
a line.

Binding power lives on the operator, not in the shape of the grammar, and
`bp + 1` on the recursive call is what makes an operator left-associative:
the right side refuses to swallow another operator at the same level, so it
comes back and the loop emits the left one first. Passing `bp` instead makes it
right-associative, which is what you want for exponentiation.

The output is already the postfix from stage 1. There is no tree in between,
because emitting the operator after its operands is exactly what recursive
descent does anyway.

## 6. Variables in a global table

@kind fix
@concept collections
@expect E0507

A variable is a name in a `HashMap` and two instructions: one that reads it onto
the stack and one that stores the top of the stack under it. The name itself
goes in a side table beside the constants, so the instruction stays an index.

`SetGlobal` does not compile, and `block` is unwritten. A program is statements
separated by `;`, ending in an expression.

```starter
use std::collections::HashMap;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Op {
    Const(usize),
    Add,
    Sub,
    Mul,
    Div,
    Neg,
    GetGlobal(usize),
    SetGlobal(usize),
    Pop,
    Return,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Chunk {
    pub code: Vec<Op>,
    pub consts: Vec<f64>,
    pub names: Vec<String>,
}

impl Chunk {
    pub fn new() -> Chunk {
        Chunk { code: Vec::new(), consts: Vec::new(), names: Vec::new() }
    }

    pub fn push(&mut self, op: Op) -> usize {
        self.code.push(op);
        self.code.len() - 1
    }

    pub fn add_const(&mut self, n: f64) -> usize {
        for (i, c) in self.consts.iter().enumerate() {
            if *c == n {
                return i;
            }
        }
        self.consts.push(n);
        self.consts.len() - 1
    }

    pub fn add_name(&mut self, name: &str) -> usize {
        for (i, s) in self.names.iter().enumerate() {
            if s == name {
                return i;
            }
        }
        self.names.push(name.to_string());
        self.names.len() - 1
    }

    pub fn line(&self, i: usize) -> String {
        match self.code[i] {
            Op::Const(k) => format!("{i:04}  CONST        {k}   ; {}", self.consts[k]),
            Op::Add => format!("{i:04}  ADD"),
            Op::Sub => format!("{i:04}  SUB"),
            Op::Mul => format!("{i:04}  MUL"),
            Op::Div => format!("{i:04}  DIV"),
            Op::Neg => format!("{i:04}  NEG"),
            Op::GetGlobal(k) => format!("{i:04}  GET_GLOBAL   {k}   ; {}", self.names[k]),
            Op::SetGlobal(k) => format!("{i:04}  SET_GLOBAL   {k}   ; {}", self.names[k]),
            Op::Pop => format!("{i:04}  POP"),
            Op::Return => format!("{i:04}  RETURN"),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum VmError {
    DivideByZero { ip: usize },
    StackUnderflow { ip: usize },
    UndefinedName { ip: usize, name: String },
}

impl fmt::Display for VmError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            VmError::DivideByZero { ip } => write!(f, "divide by zero at {ip:04}"),
            VmError::StackUnderflow { ip } => write!(f, "stack underflow at {ip:04}"),
            VmError::UndefinedName { ip, name } => write!(f, "undefined name `{name}` at {ip:04}"),
        }
    }
}

impl std::error::Error for VmError {}

#[derive(Debug, Clone, PartialEq)]
pub struct CompileError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for CompileError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at token {}", self.msg, self.pos)
    }
}

impl std::error::Error for CompileError {}

#[derive(Debug, Clone, PartialEq)]
pub enum Error {
    Compile(CompileError),
    Runtime(VmError),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Error::Compile(e) => write!(f, "compile error: {e}"),
            Error::Runtime(e) => write!(f, "runtime error: {e}"),
        }
    }
}

impl From<CompileError> for Error {
    fn from(e: CompileError) -> Error {
        Error::Compile(e)
    }
}

impl From<VmError> for Error {
    fn from(e: VmError) -> Error {
        Error::Runtime(e)
    }
}

#[derive(Debug, Default)]
pub struct Vm {
    stack: Vec<f64>,
    globals: HashMap<String, f64>,
}

impl Vm {
    pub fn new() -> Vm {
        Vm { stack: Vec::new(), globals: HashMap::new() }
    }

    fn pop(&mut self, ip: usize) -> Result<f64, VmError> {
        match self.stack.pop() {
            Some(v) => Ok(v),
            None => Err(VmError::StackUnderflow { ip }),
        }
    }

    pub fn run(&mut self, chunk: &Chunk) -> Result<f64, VmError> {
        let mut ip = 0;
        while ip < chunk.code.len() {
            let here = ip;
            let op = chunk.code[ip];
            ip += 1;
            match op {
                Op::Const(k) => self.stack.push(chunk.consts[k]),
                Op::Add => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a + b);
                }
                Op::Sub => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a - b);
                }
                Op::Mul => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a * b);
                }
                Op::Div => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    if b == 0.0 {
                        return Err(VmError::DivideByZero { ip: here });
                    }
                    self.stack.push(a / b);
                }
                Op::Neg => {
                    let a = self.pop(here)?;
                    self.stack.push(-a);
                }
                Op::GetGlobal(k) => match self.globals.get(&chunk.names[k]) {
                    Some(v) => self.stack.push(*v),
                    None => {
                        return Err(VmError::UndefinedName {
                            ip: here,
                            name: chunk.names[k].clone(),
                        })
                    }
                },
                Op::SetGlobal(k) => {
                    let v = self.pop(here)?;
                    self.globals.insert(chunk.names[k], v);
                }
                Op::Pop => {
                    self.pop(here)?;
                }
                Op::Return => return self.pop(here),
            }
        }
        self.pop(ip)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Tok {
    Num(f64),
    Name(String),
    Plus,
    Minus,
    Star,
    Slash,
    LParen,
    RParen,
    Assign,
    Semi,
}

pub fn tokenize(src: &str) -> Result<Vec<Tok>, CompileError> {
    let chars: Vec<char> = src.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if c.is_ascii_digit() {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            let text: String = chars[start..i].iter().collect();
            match text.parse::<f64>() {
                Ok(n) => out.push(Tok::Num(n)),
                Err(_) => return Err(CompileError { pos: start, msg: format!("bad number `{text}`") }),
            }
            continue;
        }
        if c.is_alphabetic() || c == '_' {
            let start = i;
            while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            out.push(match word.as_str() {
                _ => Tok::Name(word),
            });
            continue;
        }
        let t = match c {
            '+' => Tok::Plus,
            '-' => Tok::Minus,
            '*' => Tok::Star,
            '/' => Tok::Slash,
            '(' => Tok::LParen,
            ')' => Tok::RParen,
            '=' => Tok::Assign,
            ';' => Tok::Semi,
            other => return Err(CompileError { pos: i, msg: format!("unexpected character `{other}`") }),
        };
        out.push(t);
        i += 1;
    }
    Ok(out)
}

pub struct Compiler {
    toks: Vec<Tok>,
    pos: usize,
    chunk: Chunk,
}

impl Compiler {
    pub fn new(toks: Vec<Tok>) -> Compiler {
        Compiler { toks, pos: 0, chunk: Chunk::new() }
    }

    fn at(&self, k: usize) -> Option<Tok> {
        self.toks.get(self.pos + k).cloned()
    }

    fn eat(&mut self, want: &Tok) -> bool {
        if self.toks.get(self.pos) == Some(want) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn expect(&mut self, want: &Tok, what: &str) -> Result<(), CompileError> {
        if self.eat(want) {
            Ok(())
        } else {
            Err(CompileError { pos: self.pos, msg: format!("expected {what}") })
        }
    }

    fn unary(&mut self) -> Result<(), CompileError> {
        match self.at(0) {
            Some(Tok::Minus) => {
                self.pos += 1;
                self.unary()?;
                self.chunk.push(Op::Neg);
                Ok(())
            }
            Some(Tok::Num(n)) => {
                self.pos += 1;
                let k = self.chunk.add_const(n);
                self.chunk.push(Op::Const(k));
                Ok(())
            }
            Some(Tok::Name(name)) => {
                self.pos += 1;
                let k = self.chunk.add_name(&name);
                self.chunk.push(Op::GetGlobal(k));
                Ok(())
            }
            Some(Tok::LParen) => {
                self.pos += 1;
                self.expr(1)?;
                self.expect(&Tok::RParen, "`)`")
            }
            _ => Err(CompileError { pos: self.pos, msg: "expected a value".to_string() }),
        }
    }

    fn expr(&mut self, min_bp: u8) -> Result<(), CompileError> {
        self.unary()?;
        loop {
            let (bp, op) = match self.at(0) {
                Some(Tok::Plus) => (2, Op::Add),
                Some(Tok::Minus) => (2, Op::Sub),
                Some(Tok::Star) => (3, Op::Mul),
                Some(Tok::Slash) => (3, Op::Div),
                _ => break,
            };
            if bp < min_bp {
                break;
            }
            self.pos += 1;
            self.expr(bp + 1)?;
            self.chunk.push(op);
        }
        Ok(())
    }

    fn stmt(&mut self) -> Result<bool, CompileError> {
        if let (Some(Tok::Name(name)), Some(Tok::Assign)) = (self.at(0), self.at(1)) {
            self.pos += 2;
            self.expr(1)?;
            let k = self.chunk.add_name(&name);
            self.chunk.push(Op::SetGlobal(k));
            return Ok(false);
        }
        self.expr(1)?;
        Ok(true)
    }

    fn block(&mut self) -> Result<bool, CompileError> {
        todo!("statements separated by `;`; pop the value of every one but the last")
    }

    pub fn finish(mut self) -> Result<Chunk, CompileError> {
        let value = self.block()?;
        if self.pos < self.toks.len() {
            return Err(CompileError { pos: self.pos, msg: "leftover input".to_string() });
        }
        if !value {
            return Err(CompileError {
                pos: self.pos,
                msg: "the program must end with an expression".to_string(),
            });
        }
        self.chunk.push(Op::Return);
        Ok(self.chunk)
    }
}

pub fn compile(src: &str) -> Result<Chunk, CompileError> {
    Compiler::new(tokenize(src)?).finish()
}

pub fn eval(src: &str) -> Result<f64, Error> {
    let chunk = compile(src)?;
    let mut vm = Vm::new();
    Ok(vm.run(&chunk)?)
}

pub fn hand_written() -> Chunk {
    let mut c = Chunk::new();
    let two = c.add_const(2.0);
    let three = c.add_const(3.0);
    let four = c.add_const(4.0);
    c.push(Op::Const(two));
    c.push(Op::Const(three));
    c.push(Op::Const(four));
    c.push(Op::Mul);
    c.push(Op::Add);
    c.push(Op::Return);
    c
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_variable_survives_the_semicolon() {
        assert_eq!(eval("x = 2 + 3; x * 4"), Ok(20.0));
    }

    #[test]
    fn assignment_reads_the_old_value_first() {
        assert_eq!(eval("x = 1; x = x + 41; x"), Ok(42.0));
    }

    #[test]
    fn several_globals_and_a_discarded_value() {
        assert_eq!(eval("a = 3; b = 4; a * a + b * b"), Ok(25.0));
        assert_eq!(eval("1; 2"), Ok(2.0));
    }

    #[test]
    fn names_live_in_their_own_side_table() {
        let c = compile("x = 5; x").unwrap();
        println!("{}", (0..c.code.len()).map(|i| c.line(i)).collect::<Vec<_>>().join("\n"));
        assert_eq!(c.names, vec!["x".to_string()]);
        assert_eq!(
            c.code,
            vec![Op::Const(0), Op::SetGlobal(0), Op::GetGlobal(0), Op::Return]
        );
        assert!(matches!(eval("q + 1"), Err(Error::Runtime(VmError::UndefinedName { .. }))));
        assert!(matches!(eval("x = 1; x = 2"), Err(Error::Compile(_))));
    }
}
```

```solution
use std::collections::HashMap;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Op {
    Const(usize),
    Add,
    Sub,
    Mul,
    Div,
    Neg,
    GetGlobal(usize),
    SetGlobal(usize),
    Pop,
    Return,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Chunk {
    pub code: Vec<Op>,
    pub consts: Vec<f64>,
    pub names: Vec<String>,
}

impl Chunk {
    pub fn new() -> Chunk {
        Chunk { code: Vec::new(), consts: Vec::new(), names: Vec::new() }
    }

    pub fn push(&mut self, op: Op) -> usize {
        self.code.push(op);
        self.code.len() - 1
    }

    pub fn add_const(&mut self, n: f64) -> usize {
        for (i, c) in self.consts.iter().enumerate() {
            if *c == n {
                return i;
            }
        }
        self.consts.push(n);
        self.consts.len() - 1
    }

    pub fn add_name(&mut self, name: &str) -> usize {
        for (i, s) in self.names.iter().enumerate() {
            if s == name {
                return i;
            }
        }
        self.names.push(name.to_string());
        self.names.len() - 1
    }

    pub fn line(&self, i: usize) -> String {
        match self.code[i] {
            Op::Const(k) => format!("{i:04}  CONST        {k}   ; {}", self.consts[k]),
            Op::Add => format!("{i:04}  ADD"),
            Op::Sub => format!("{i:04}  SUB"),
            Op::Mul => format!("{i:04}  MUL"),
            Op::Div => format!("{i:04}  DIV"),
            Op::Neg => format!("{i:04}  NEG"),
            Op::GetGlobal(k) => format!("{i:04}  GET_GLOBAL   {k}   ; {}", self.names[k]),
            Op::SetGlobal(k) => format!("{i:04}  SET_GLOBAL   {k}   ; {}", self.names[k]),
            Op::Pop => format!("{i:04}  POP"),
            Op::Return => format!("{i:04}  RETURN"),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum VmError {
    DivideByZero { ip: usize },
    StackUnderflow { ip: usize },
    UndefinedName { ip: usize, name: String },
}

impl fmt::Display for VmError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            VmError::DivideByZero { ip } => write!(f, "divide by zero at {ip:04}"),
            VmError::StackUnderflow { ip } => write!(f, "stack underflow at {ip:04}"),
            VmError::UndefinedName { ip, name } => write!(f, "undefined name `{name}` at {ip:04}"),
        }
    }
}

impl std::error::Error for VmError {}

#[derive(Debug, Clone, PartialEq)]
pub struct CompileError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for CompileError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at token {}", self.msg, self.pos)
    }
}

impl std::error::Error for CompileError {}

#[derive(Debug, Clone, PartialEq)]
pub enum Error {
    Compile(CompileError),
    Runtime(VmError),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Error::Compile(e) => write!(f, "compile error: {e}"),
            Error::Runtime(e) => write!(f, "runtime error: {e}"),
        }
    }
}

impl From<CompileError> for Error {
    fn from(e: CompileError) -> Error {
        Error::Compile(e)
    }
}

impl From<VmError> for Error {
    fn from(e: VmError) -> Error {
        Error::Runtime(e)
    }
}

#[derive(Debug, Default)]
pub struct Vm {
    stack: Vec<f64>,
    globals: HashMap<String, f64>,
}

impl Vm {
    pub fn new() -> Vm {
        Vm { stack: Vec::new(), globals: HashMap::new() }
    }

    fn pop(&mut self, ip: usize) -> Result<f64, VmError> {
        match self.stack.pop() {
            Some(v) => Ok(v),
            None => Err(VmError::StackUnderflow { ip }),
        }
    }

    pub fn run(&mut self, chunk: &Chunk) -> Result<f64, VmError> {
        let mut ip = 0;
        while ip < chunk.code.len() {
            let here = ip;
            let op = chunk.code[ip];
            ip += 1;
            match op {
                Op::Const(k) => self.stack.push(chunk.consts[k]),
                Op::Add => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a + b);
                }
                Op::Sub => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a - b);
                }
                Op::Mul => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a * b);
                }
                Op::Div => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    if b == 0.0 {
                        return Err(VmError::DivideByZero { ip: here });
                    }
                    self.stack.push(a / b);
                }
                Op::Neg => {
                    let a = self.pop(here)?;
                    self.stack.push(-a);
                }
                Op::GetGlobal(k) => match self.globals.get(&chunk.names[k]) {
                    Some(v) => self.stack.push(*v),
                    None => {
                        return Err(VmError::UndefinedName {
                            ip: here,
                            name: chunk.names[k].clone(),
                        })
                    }
                },
                Op::SetGlobal(k) => {
                    let v = self.pop(here)?;
                    self.globals.insert(chunk.names[k].clone(), v);
                }
                Op::Pop => {
                    self.pop(here)?;
                }
                Op::Return => return self.pop(here),
            }
        }
        self.pop(ip)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Tok {
    Num(f64),
    Name(String),
    Plus,
    Minus,
    Star,
    Slash,
    LParen,
    RParen,
    Assign,
    Semi,
}

pub fn tokenize(src: &str) -> Result<Vec<Tok>, CompileError> {
    let chars: Vec<char> = src.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if c.is_ascii_digit() {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            let text: String = chars[start..i].iter().collect();
            match text.parse::<f64>() {
                Ok(n) => out.push(Tok::Num(n)),
                Err(_) => return Err(CompileError { pos: start, msg: format!("bad number `{text}`") }),
            }
            continue;
        }
        if c.is_alphabetic() || c == '_' {
            let start = i;
            while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            out.push(match word.as_str() {
                _ => Tok::Name(word),
            });
            continue;
        }
        let t = match c {
            '+' => Tok::Plus,
            '-' => Tok::Minus,
            '*' => Tok::Star,
            '/' => Tok::Slash,
            '(' => Tok::LParen,
            ')' => Tok::RParen,
            '=' => Tok::Assign,
            ';' => Tok::Semi,
            other => return Err(CompileError { pos: i, msg: format!("unexpected character `{other}`") }),
        };
        out.push(t);
        i += 1;
    }
    Ok(out)
}

pub struct Compiler {
    toks: Vec<Tok>,
    pos: usize,
    chunk: Chunk,
}

impl Compiler {
    pub fn new(toks: Vec<Tok>) -> Compiler {
        Compiler { toks, pos: 0, chunk: Chunk::new() }
    }

    fn at(&self, k: usize) -> Option<Tok> {
        self.toks.get(self.pos + k).cloned()
    }

    fn eat(&mut self, want: &Tok) -> bool {
        if self.toks.get(self.pos) == Some(want) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn expect(&mut self, want: &Tok, what: &str) -> Result<(), CompileError> {
        if self.eat(want) {
            Ok(())
        } else {
            Err(CompileError { pos: self.pos, msg: format!("expected {what}") })
        }
    }

    fn unary(&mut self) -> Result<(), CompileError> {
        match self.at(0) {
            Some(Tok::Minus) => {
                self.pos += 1;
                self.unary()?;
                self.chunk.push(Op::Neg);
                Ok(())
            }
            Some(Tok::Num(n)) => {
                self.pos += 1;
                let k = self.chunk.add_const(n);
                self.chunk.push(Op::Const(k));
                Ok(())
            }
            Some(Tok::Name(name)) => {
                self.pos += 1;
                let k = self.chunk.add_name(&name);
                self.chunk.push(Op::GetGlobal(k));
                Ok(())
            }
            Some(Tok::LParen) => {
                self.pos += 1;
                self.expr(1)?;
                self.expect(&Tok::RParen, "`)`")
            }
            _ => Err(CompileError { pos: self.pos, msg: "expected a value".to_string() }),
        }
    }

    fn expr(&mut self, min_bp: u8) -> Result<(), CompileError> {
        self.unary()?;
        loop {
            let (bp, op) = match self.at(0) {
                Some(Tok::Plus) => (2, Op::Add),
                Some(Tok::Minus) => (2, Op::Sub),
                Some(Tok::Star) => (3, Op::Mul),
                Some(Tok::Slash) => (3, Op::Div),
                _ => break,
            };
            if bp < min_bp {
                break;
            }
            self.pos += 1;
            self.expr(bp + 1)?;
            self.chunk.push(op);
        }
        Ok(())
    }

    fn stmt(&mut self) -> Result<bool, CompileError> {
        if let (Some(Tok::Name(name)), Some(Tok::Assign)) = (self.at(0), self.at(1)) {
            self.pos += 2;
            self.expr(1)?;
            let k = self.chunk.add_name(&name);
            self.chunk.push(Op::SetGlobal(k));
            return Ok(false);
        }
        self.expr(1)?;
        Ok(true)
    }

    fn block(&mut self) -> Result<bool, CompileError> {
        let mut value = false;
        while self.pos < self.toks.len() {
            if value {
                self.chunk.push(Op::Pop);
            }
            value = self.stmt()?;
            if !self.eat(&Tok::Semi) {
                break;
            }
        }
        Ok(value)
    }

    pub fn finish(mut self) -> Result<Chunk, CompileError> {
        let value = self.block()?;
        if self.pos < self.toks.len() {
            return Err(CompileError { pos: self.pos, msg: "leftover input".to_string() });
        }
        if !value {
            return Err(CompileError {
                pos: self.pos,
                msg: "the program must end with an expression".to_string(),
            });
        }
        self.chunk.push(Op::Return);
        Ok(self.chunk)
    }
}

pub fn compile(src: &str) -> Result<Chunk, CompileError> {
    Compiler::new(tokenize(src)?).finish()
}

pub fn eval(src: &str) -> Result<f64, Error> {
    let chunk = compile(src)?;
    let mut vm = Vm::new();
    Ok(vm.run(&chunk)?)
}

pub fn hand_written() -> Chunk {
    let mut c = Chunk::new();
    let two = c.add_const(2.0);
    let three = c.add_const(3.0);
    let four = c.add_const(4.0);
    c.push(Op::Const(two));
    c.push(Op::Const(three));
    c.push(Op::Const(four));
    c.push(Op::Mul);
    c.push(Op::Add);
    c.push(Op::Return);
    c
}
```

@hint `chunk` is a shared reference, so nothing can be moved out of the `Vec<String>` behind it. The map wants an owned key.
@hint For `block`: run statements while there are tokens left, stopping when there is no `;` to consume. `stmt` reports whether the statement left a value on the stack.
@hint Every statement but the last has its value discarded, so push `Op::Pop` before running the next one whenever the previous one produced a value.

@diagnose E0507
`cannot move out of index of Vec<String>`. `chunk: &Chunk` is a shared reference,
so `chunk.names[k]` is a place you may read, not a value you may take. Moving
the `String` out would leave a hole in a vector the caller still owns.

`HashMap::insert` takes the key by value, because the map has to own it for as
long as the entry lives. `.clone()` allocates a copy of the name once per
assignment, which is the honest price of a `HashMap<String, f64>`.

Interning avoids that price: store `usize` indices as keys and keep the strings
in the chunk, or use `Rc<str>` so the clone is a refcount bump. Real VMs intern
every identifier for exactly this reason.

@diagnose E0499
Two mutable borrows of `self` at once, usually from calling one method inside
the argument list of another. Bind the intermediate value to a variable first:
`let v = self.pop(here)?;` and then insert it.

@after
A global variable is a hash lookup on every read, which makes globals the
slowest kind of variable in most dynamic languages. Locals are faster because
the compiler can assign them stack slots at compile time and the instruction
becomes an offset. That single difference is why the standard advice in Python
and Lua is to copy a global into a local before a hot loop.

The undefined-name check happens at runtime rather than compile time, which is
also what Python does: a name that does not exist is a `NameError` when the line
executes, not when the module is compiled. Making it a compile error means the
compiler has to track scopes, which is the same work locals would need.

## 7. Jumps, and the `if` built out of them

@kind fix
@concept jump
@expect E0004

A conditional is a jump over the instructions you do not want to run. `if` needs
a comparison, a `JumpIfFalse` whose target is not known when it is emitted, and
a patch once the body has been compiled.

Five instructions have just been added to `Op`, and the compiler is telling you
where they are not handled. `if_stmt` is unwritten.

```starter
use std::collections::HashMap;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Op {
    Const(usize),
    Add,
    Sub,
    Mul,
    Div,
    Neg,
    Less,
    Greater,
    Equal,
    GetGlobal(usize),
    SetGlobal(usize),
    Pop,
    Jump(usize),
    JumpIfFalse(usize),
    Return,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Chunk {
    pub code: Vec<Op>,
    pub consts: Vec<f64>,
    pub names: Vec<String>,
}

impl Chunk {
    pub fn new() -> Chunk {
        Chunk { code: Vec::new(), consts: Vec::new(), names: Vec::new() }
    }

    pub fn push(&mut self, op: Op) -> usize {
        self.code.push(op);
        self.code.len() - 1
    }

    pub fn add_const(&mut self, n: f64) -> usize {
        for (i, c) in self.consts.iter().enumerate() {
            if *c == n {
                return i;
            }
        }
        self.consts.push(n);
        self.consts.len() - 1
    }

    pub fn add_name(&mut self, name: &str) -> usize {
        for (i, s) in self.names.iter().enumerate() {
            if s == name {
                return i;
            }
        }
        self.names.push(name.to_string());
        self.names.len() - 1
    }

    pub fn line(&self, i: usize) -> String {
        match self.code[i] {
            Op::Const(k) => format!("{i:04}  CONST        {k}   ; {}", self.consts[k]),
            Op::Add => format!("{i:04}  ADD"),
            Op::Sub => format!("{i:04}  SUB"),
            Op::Mul => format!("{i:04}  MUL"),
            Op::Div => format!("{i:04}  DIV"),
            Op::Neg => format!("{i:04}  NEG"),
            Op::GetGlobal(k) => format!("{i:04}  GET_GLOBAL   {k}   ; {}", self.names[k]),
            Op::SetGlobal(k) => format!("{i:04}  SET_GLOBAL   {k}   ; {}", self.names[k]),
            Op::Pop => format!("{i:04}  POP"),
            Op::Return => format!("{i:04}  RETURN"),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum VmError {
    DivideByZero { ip: usize },
    StackUnderflow { ip: usize },
    UndefinedName { ip: usize, name: String },
}

impl fmt::Display for VmError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            VmError::DivideByZero { ip } => write!(f, "divide by zero at {ip:04}"),
            VmError::StackUnderflow { ip } => write!(f, "stack underflow at {ip:04}"),
            VmError::UndefinedName { ip, name } => write!(f, "undefined name `{name}` at {ip:04}"),
        }
    }
}

impl std::error::Error for VmError {}

#[derive(Debug, Clone, PartialEq)]
pub struct CompileError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for CompileError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at token {}", self.msg, self.pos)
    }
}

impl std::error::Error for CompileError {}

#[derive(Debug, Clone, PartialEq)]
pub enum Error {
    Compile(CompileError),
    Runtime(VmError),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Error::Compile(e) => write!(f, "compile error: {e}"),
            Error::Runtime(e) => write!(f, "runtime error: {e}"),
        }
    }
}

impl From<CompileError> for Error {
    fn from(e: CompileError) -> Error {
        Error::Compile(e)
    }
}

impl From<VmError> for Error {
    fn from(e: VmError) -> Error {
        Error::Runtime(e)
    }
}

#[derive(Debug, Default)]
pub struct Vm {
    stack: Vec<f64>,
    globals: HashMap<String, f64>,
}

impl Vm {
    pub fn new() -> Vm {
        Vm { stack: Vec::new(), globals: HashMap::new() }
    }

    fn pop(&mut self, ip: usize) -> Result<f64, VmError> {
        match self.stack.pop() {
            Some(v) => Ok(v),
            None => Err(VmError::StackUnderflow { ip }),
        }
    }

    pub fn run(&mut self, chunk: &Chunk) -> Result<f64, VmError> {
        let mut ip = 0;
        while ip < chunk.code.len() {
            let here = ip;
            let op = chunk.code[ip];
            ip += 1;
            match op {
                Op::Const(k) => self.stack.push(chunk.consts[k]),
                Op::Add => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a + b);
                }
                Op::Sub => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a - b);
                }
                Op::Mul => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a * b);
                }
                Op::Div => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    if b == 0.0 {
                        return Err(VmError::DivideByZero { ip: here });
                    }
                    self.stack.push(a / b);
                }
                Op::Neg => {
                    let a = self.pop(here)?;
                    self.stack.push(-a);
                }
                Op::GetGlobal(k) => match self.globals.get(&chunk.names[k]) {
                    Some(v) => self.stack.push(*v),
                    None => {
                        return Err(VmError::UndefinedName {
                            ip: here,
                            name: chunk.names[k].clone(),
                        })
                    }
                },
                Op::SetGlobal(k) => {
                    let v = self.pop(here)?;
                    self.globals.insert(chunk.names[k].clone(), v);
                }
                Op::Pop => {
                    self.pop(here)?;
                }
                Op::Return => return self.pop(here),
            }
        }
        self.pop(ip)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Tok {
    Num(f64),
    Name(String),
    Plus,
    Minus,
    Star,
    Slash,
    LParen,
    RParen,
    LBrace,
    RBrace,
    Assign,
    Semi,
    Lt,
    Gt,
    EqEq,
    If,
}

pub fn tokenize(src: &str) -> Result<Vec<Tok>, CompileError> {
    let chars: Vec<char> = src.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if c.is_ascii_digit() {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            let text: String = chars[start..i].iter().collect();
            match text.parse::<f64>() {
                Ok(n) => out.push(Tok::Num(n)),
                Err(_) => return Err(CompileError { pos: start, msg: format!("bad number `{text}`") }),
            }
            continue;
        }
        if c.is_alphabetic() || c == '_' {
            let start = i;
            while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            out.push(match word.as_str() {
                "if" => Tok::If,
                _ => Tok::Name(word),
            });
            continue;
        }
        if c == '=' && chars.get(i + 1) == Some(&'=') {
            out.push(Tok::EqEq);
            i += 2;
            continue;
        }
        let t = match c {
            '+' => Tok::Plus,
            '-' => Tok::Minus,
            '*' => Tok::Star,
            '/' => Tok::Slash,
            '(' => Tok::LParen,
            ')' => Tok::RParen,
            '{' => Tok::LBrace,
            '}' => Tok::RBrace,
            '=' => Tok::Assign,
            ';' => Tok::Semi,
            '<' => Tok::Lt,
            '>' => Tok::Gt,
            other => return Err(CompileError { pos: i, msg: format!("unexpected character `{other}`") }),
        };
        out.push(t);
        i += 1;
    }
    Ok(out)
}

pub struct Compiler {
    toks: Vec<Tok>,
    pos: usize,
    chunk: Chunk,
}

impl Compiler {
    pub fn new(toks: Vec<Tok>) -> Compiler {
        Compiler { toks, pos: 0, chunk: Chunk::new() }
    }

    fn at(&self, k: usize) -> Option<Tok> {
        self.toks.get(self.pos + k).cloned()
    }

    fn eat(&mut self, want: &Tok) -> bool {
        if self.toks.get(self.pos) == Some(want) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn expect(&mut self, want: &Tok, what: &str) -> Result<(), CompileError> {
        if self.eat(want) {
            Ok(())
        } else {
            Err(CompileError { pos: self.pos, msg: format!("expected {what}") })
        }
    }

    fn unary(&mut self) -> Result<(), CompileError> {
        match self.at(0) {
            Some(Tok::Minus) => {
                self.pos += 1;
                self.unary()?;
                self.chunk.push(Op::Neg);
                Ok(())
            }
            Some(Tok::Num(n)) => {
                self.pos += 1;
                let k = self.chunk.add_const(n);
                self.chunk.push(Op::Const(k));
                Ok(())
            }
            Some(Tok::Name(name)) => {
                self.pos += 1;
                let k = self.chunk.add_name(&name);
                self.chunk.push(Op::GetGlobal(k));
                Ok(())
            }
            Some(Tok::LParen) => {
                self.pos += 1;
                self.expr(1)?;
                self.expect(&Tok::RParen, "`)`")
            }
            _ => Err(CompileError { pos: self.pos, msg: "expected a value".to_string() }),
        }
    }

    fn expr(&mut self, min_bp: u8) -> Result<(), CompileError> {
        self.unary()?;
        loop {
            let (bp, op) = match self.at(0) {
                Some(Tok::Plus) => (2, Op::Add),
                Some(Tok::Minus) => (2, Op::Sub),
                Some(Tok::Star) => (3, Op::Mul),
                Some(Tok::Slash) => (3, Op::Div),
                _ => break,
            };
            if bp < min_bp {
                break;
            }
            self.pos += 1;
            self.expr(bp + 1)?;
            self.chunk.push(op);
        }
        Ok(())
    }

    fn if_stmt(&mut self) -> Result<(), CompileError> {
        todo!("condition, a JumpIfFalse to patch, the braced block, then the patch")
    }

    fn stmt(&mut self) -> Result<bool, CompileError> {
        if self.at(0) == Some(Tok::If) {
            self.if_stmt()?;
            return Ok(false);
        }
        if let (Some(Tok::Name(name)), Some(Tok::Assign)) = (self.at(0), self.at(1)) {
            self.pos += 2;
            self.expr(1)?;
            let k = self.chunk.add_name(&name);
            self.chunk.push(Op::SetGlobal(k));
            return Ok(false);
        }
        self.expr(1)?;
        Ok(true)
    }

    fn block(&mut self) -> Result<bool, CompileError> {
        let mut value = false;
        while self.pos < self.toks.len() {
            if value {
                self.chunk.push(Op::Pop);
            }
            value = self.stmt()?;
            if !self.eat(&Tok::Semi) {
                break;
            }
        }
        Ok(value)
    }

    pub fn finish(mut self) -> Result<Chunk, CompileError> {
        let value = self.block()?;
        if self.pos < self.toks.len() {
            return Err(CompileError { pos: self.pos, msg: "leftover input".to_string() });
        }
        if !value {
            return Err(CompileError {
                pos: self.pos,
                msg: "the program must end with an expression".to_string(),
            });
        }
        self.chunk.push(Op::Return);
        Ok(self.chunk)
    }
}

pub fn compile(src: &str) -> Result<Chunk, CompileError> {
    Compiler::new(tokenize(src)?).finish()
}

pub fn eval(src: &str) -> Result<f64, Error> {
    let chunk = compile(src)?;
    let mut vm = Vm::new();
    Ok(vm.run(&chunk)?)
}

pub fn hand_written() -> Chunk {
    let mut c = Chunk::new();
    let two = c.add_const(2.0);
    let three = c.add_const(3.0);
    let four = c.add_const(4.0);
    c.push(Op::Const(two));
    c.push(Op::Const(three));
    c.push(Op::Const(four));
    c.push(Op::Mul);
    c.push(Op::Add);
    c.push(Op::Return);
    c
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comparisons_produce_one_or_zero() {
        assert_eq!(eval("1 < 2"), Ok(1.0));
        assert_eq!(eval("2 < 1"), Ok(0.0));
        assert_eq!(eval("2 == 2"), Ok(1.0));
        assert_eq!(eval("1 + 1 > 1"), Ok(1.0));
    }

    #[test]
    fn a_taken_branch() {
        assert_eq!(eval("x = 3; if x < 10 { x = x * 2 }; x"), Ok(6.0));
    }

    #[test]
    fn a_skipped_branch() {
        assert_eq!(eval("x = 30; if x < 10 { x = x * 2 }; x"), Ok(30.0));
    }

    #[test]
    fn the_jump_offset_is_visible_in_the_disassembly() {
        let c = compile("x = 3; if x < 10 { x = x * 2 }; x").unwrap();
        println!("{}", (0..c.code.len()).map(|i| c.line(i)).collect::<Vec<_>>().join("\n"));
        assert_eq!(c.code.len(), 12);
        assert_eq!(c.code[5], Op::JumpIfFalse(10));
        assert!(c.line(5).contains("-> 0010"));
    }
}
```

```solution
use std::collections::HashMap;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Op {
    Const(usize),
    Add,
    Sub,
    Mul,
    Div,
    Neg,
    Less,
    Greater,
    Equal,
    GetGlobal(usize),
    SetGlobal(usize),
    Pop,
    Jump(usize),
    JumpIfFalse(usize),
    Return,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Chunk {
    pub code: Vec<Op>,
    pub consts: Vec<f64>,
    pub names: Vec<String>,
}

impl Chunk {
    pub fn new() -> Chunk {
        Chunk { code: Vec::new(), consts: Vec::new(), names: Vec::new() }
    }

    pub fn push(&mut self, op: Op) -> usize {
        self.code.push(op);
        self.code.len() - 1
    }

    pub fn add_const(&mut self, n: f64) -> usize {
        for (i, c) in self.consts.iter().enumerate() {
            if *c == n {
                return i;
            }
        }
        self.consts.push(n);
        self.consts.len() - 1
    }

    pub fn add_name(&mut self, name: &str) -> usize {
        for (i, s) in self.names.iter().enumerate() {
            if s == name {
                return i;
            }
        }
        self.names.push(name.to_string());
        self.names.len() - 1
    }

    pub fn line(&self, i: usize) -> String {
        match self.code[i] {
            Op::Const(k) => format!("{i:04}  CONST        {k}   ; {}", self.consts[k]),
            Op::Add => format!("{i:04}  ADD"),
            Op::Sub => format!("{i:04}  SUB"),
            Op::Mul => format!("{i:04}  MUL"),
            Op::Div => format!("{i:04}  DIV"),
            Op::Neg => format!("{i:04}  NEG"),
            Op::Less => format!("{i:04}  LESS"),
            Op::Greater => format!("{i:04}  GREATER"),
            Op::Equal => format!("{i:04}  EQUAL"),
            Op::GetGlobal(k) => format!("{i:04}  GET_GLOBAL   {k}   ; {}", self.names[k]),
            Op::SetGlobal(k) => format!("{i:04}  SET_GLOBAL   {k}   ; {}", self.names[k]),
            Op::Pop => format!("{i:04}  POP"),
            Op::Jump(t) => format!("{i:04}  JUMP          -> {t:04}"),
            Op::JumpIfFalse(t) => format!("{i:04}  JUMP_IF_FALSE -> {t:04}"),
            Op::Return => format!("{i:04}  RETURN"),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum VmError {
    DivideByZero { ip: usize },
    StackUnderflow { ip: usize },
    UndefinedName { ip: usize, name: String },
}

impl fmt::Display for VmError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            VmError::DivideByZero { ip } => write!(f, "divide by zero at {ip:04}"),
            VmError::StackUnderflow { ip } => write!(f, "stack underflow at {ip:04}"),
            VmError::UndefinedName { ip, name } => write!(f, "undefined name `{name}` at {ip:04}"),
        }
    }
}

impl std::error::Error for VmError {}

#[derive(Debug, Clone, PartialEq)]
pub struct CompileError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for CompileError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at token {}", self.msg, self.pos)
    }
}

impl std::error::Error for CompileError {}

#[derive(Debug, Clone, PartialEq)]
pub enum Error {
    Compile(CompileError),
    Runtime(VmError),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Error::Compile(e) => write!(f, "compile error: {e}"),
            Error::Runtime(e) => write!(f, "runtime error: {e}"),
        }
    }
}

impl From<CompileError> for Error {
    fn from(e: CompileError) -> Error {
        Error::Compile(e)
    }
}

impl From<VmError> for Error {
    fn from(e: VmError) -> Error {
        Error::Runtime(e)
    }
}

#[derive(Debug, Default)]
pub struct Vm {
    stack: Vec<f64>,
    globals: HashMap<String, f64>,
}

impl Vm {
    pub fn new() -> Vm {
        Vm { stack: Vec::new(), globals: HashMap::new() }
    }

    fn pop(&mut self, ip: usize) -> Result<f64, VmError> {
        match self.stack.pop() {
            Some(v) => Ok(v),
            None => Err(VmError::StackUnderflow { ip }),
        }
    }

    pub fn run(&mut self, chunk: &Chunk) -> Result<f64, VmError> {
        let mut ip = 0;
        while ip < chunk.code.len() {
            let here = ip;
            let op = chunk.code[ip];
            ip += 1;
            match op {
                Op::Const(k) => self.stack.push(chunk.consts[k]),
                Op::Add => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a + b);
                }
                Op::Sub => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a - b);
                }
                Op::Mul => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a * b);
                }
                Op::Div => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    if b == 0.0 {
                        return Err(VmError::DivideByZero { ip: here });
                    }
                    self.stack.push(a / b);
                }
                Op::Neg => {
                    let a = self.pop(here)?;
                    self.stack.push(-a);
                }
                Op::Less => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(if a < b { 1.0 } else { 0.0 });
                }
                Op::Greater => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(if a > b { 1.0 } else { 0.0 });
                }
                Op::Equal => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(if a == b { 1.0 } else { 0.0 });
                }
                Op::GetGlobal(k) => match self.globals.get(&chunk.names[k]) {
                    Some(v) => self.stack.push(*v),
                    None => {
                        return Err(VmError::UndefinedName {
                            ip: here,
                            name: chunk.names[k].clone(),
                        })
                    }
                },
                Op::SetGlobal(k) => {
                    let v = self.pop(here)?;
                    self.globals.insert(chunk.names[k].clone(), v);
                }
                Op::Pop => {
                    self.pop(here)?;
                }
                Op::Jump(t) => ip = t,
                Op::JumpIfFalse(t) => {
                    let c = self.pop(here)?;
                    if c == 0.0 {
                        ip = t;
                    }
                }
                Op::Return => return self.pop(here),
            }
        }
        self.pop(ip)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Tok {
    Num(f64),
    Name(String),
    Plus,
    Minus,
    Star,
    Slash,
    LParen,
    RParen,
    LBrace,
    RBrace,
    Assign,
    Semi,
    Lt,
    Gt,
    EqEq,
    If,
}

pub fn tokenize(src: &str) -> Result<Vec<Tok>, CompileError> {
    let chars: Vec<char> = src.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if c.is_ascii_digit() {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            let text: String = chars[start..i].iter().collect();
            match text.parse::<f64>() {
                Ok(n) => out.push(Tok::Num(n)),
                Err(_) => return Err(CompileError { pos: start, msg: format!("bad number `{text}`") }),
            }
            continue;
        }
        if c.is_alphabetic() || c == '_' {
            let start = i;
            while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            out.push(match word.as_str() {
                "if" => Tok::If,
                _ => Tok::Name(word),
            });
            continue;
        }
        if c == '=' && chars.get(i + 1) == Some(&'=') {
            out.push(Tok::EqEq);
            i += 2;
            continue;
        }
        let t = match c {
            '+' => Tok::Plus,
            '-' => Tok::Minus,
            '*' => Tok::Star,
            '/' => Tok::Slash,
            '(' => Tok::LParen,
            ')' => Tok::RParen,
            '{' => Tok::LBrace,
            '}' => Tok::RBrace,
            '=' => Tok::Assign,
            ';' => Tok::Semi,
            '<' => Tok::Lt,
            '>' => Tok::Gt,
            other => return Err(CompileError { pos: i, msg: format!("unexpected character `{other}`") }),
        };
        out.push(t);
        i += 1;
    }
    Ok(out)
}

pub struct Compiler {
    toks: Vec<Tok>,
    pos: usize,
    chunk: Chunk,
}

impl Compiler {
    pub fn new(toks: Vec<Tok>) -> Compiler {
        Compiler { toks, pos: 0, chunk: Chunk::new() }
    }

    fn at(&self, k: usize) -> Option<Tok> {
        self.toks.get(self.pos + k).cloned()
    }

    fn eat(&mut self, want: &Tok) -> bool {
        if self.toks.get(self.pos) == Some(want) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn expect(&mut self, want: &Tok, what: &str) -> Result<(), CompileError> {
        if self.eat(want) {
            Ok(())
        } else {
            Err(CompileError { pos: self.pos, msg: format!("expected {what}") })
        }
    }

    fn unary(&mut self) -> Result<(), CompileError> {
        match self.at(0) {
            Some(Tok::Minus) => {
                self.pos += 1;
                self.unary()?;
                self.chunk.push(Op::Neg);
                Ok(())
            }
            Some(Tok::Num(n)) => {
                self.pos += 1;
                let k = self.chunk.add_const(n);
                self.chunk.push(Op::Const(k));
                Ok(())
            }
            Some(Tok::Name(name)) => {
                self.pos += 1;
                let k = self.chunk.add_name(&name);
                self.chunk.push(Op::GetGlobal(k));
                Ok(())
            }
            Some(Tok::LParen) => {
                self.pos += 1;
                self.expr(1)?;
                self.expect(&Tok::RParen, "`)`")
            }
            _ => Err(CompileError { pos: self.pos, msg: "expected a value".to_string() }),
        }
    }

    fn expr(&mut self, min_bp: u8) -> Result<(), CompileError> {
        self.unary()?;
        loop {
            let (bp, op) = match self.at(0) {
                Some(Tok::Lt) => (1, Op::Less),
                Some(Tok::Gt) => (1, Op::Greater),
                Some(Tok::EqEq) => (1, Op::Equal),
                Some(Tok::Plus) => (2, Op::Add),
                Some(Tok::Minus) => (2, Op::Sub),
                Some(Tok::Star) => (3, Op::Mul),
                Some(Tok::Slash) => (3, Op::Div),
                _ => break,
            };
            if bp < min_bp {
                break;
            }
            self.pos += 1;
            self.expr(bp + 1)?;
            self.chunk.push(op);
        }
        Ok(())
    }

    fn if_stmt(&mut self) -> Result<(), CompileError> {
        self.pos += 1;
        self.expr(1)?;
        let exit = self.chunk.push(Op::JumpIfFalse(0));
        self.expect(&Tok::LBrace, "`{`")?;
        self.block()?;
        self.expect(&Tok::RBrace, "`}`")?;
        let after = self.chunk.code.len();
        self.chunk.code[exit] = Op::JumpIfFalse(after);
        Ok(())
    }

    fn stmt(&mut self) -> Result<bool, CompileError> {
        if self.at(0) == Some(Tok::If) {
            self.if_stmt()?;
            return Ok(false);
        }
        if let (Some(Tok::Name(name)), Some(Tok::Assign)) = (self.at(0), self.at(1)) {
            self.pos += 2;
            self.expr(1)?;
            let k = self.chunk.add_name(&name);
            self.chunk.push(Op::SetGlobal(k));
            return Ok(false);
        }
        self.expr(1)?;
        Ok(true)
    }

    fn block(&mut self) -> Result<bool, CompileError> {
        let mut value = false;
        while self.pos < self.toks.len() && self.at(0) != Some(Tok::RBrace) {
            if value {
                self.chunk.push(Op::Pop);
            }
            value = self.stmt()?;
            if !self.eat(&Tok::Semi) {
                break;
            }
        }
        Ok(value)
    }

    pub fn finish(mut self) -> Result<Chunk, CompileError> {
        let value = self.block()?;
        if self.pos < self.toks.len() {
            return Err(CompileError { pos: self.pos, msg: "leftover input".to_string() });
        }
        if !value {
            return Err(CompileError {
                pos: self.pos,
                msg: "the program must end with an expression".to_string(),
            });
        }
        self.chunk.push(Op::Return);
        Ok(self.chunk)
    }
}

pub fn compile(src: &str) -> Result<Chunk, CompileError> {
    Compiler::new(tokenize(src)?).finish()
}

pub fn eval(src: &str) -> Result<f64, Error> {
    let chunk = compile(src)?;
    let mut vm = Vm::new();
    Ok(vm.run(&chunk)?)
}

pub fn hand_written() -> Chunk {
    let mut c = Chunk::new();
    let two = c.add_const(2.0);
    let three = c.add_const(3.0);
    let four = c.add_const(4.0);
    c.push(Op::Const(two));
    c.push(Op::Const(three));
    c.push(Op::Const(four));
    c.push(Op::Mul);
    c.push(Op::Add);
    c.push(Op::Return);
    c
}
```

@hint Adding a variant is meant to break every match. Two of them need new arms, and the disassembler is the first.
@hint Emit `Op::JumpIfFalse(0)` with a placeholder target and keep the index `push` returns. After the body is compiled, `self.chunk.code.len()` is the instruction the jump should skip to.
@hint `block` also needs to stop at `}` now, and `expr` needs the three comparison operators at a binding power below `+`.

@diagnose E0004
`non-exhaustive patterns` on the disassembler's match, and again on the
interpreter loop once you fix the first. This is the whole argument for enums,
happening to you: five variants appeared and the compiler produced a list of
every site that has to change, with line numbers.

Nothing had to be remembered, and nothing could be missed in review. Had `Op`
been a `u8` with a `_ => "unknown"` arm, both matches would have compiled and
the new instructions would have disassembled as `unknown` and executed as
nothing.

The arms to add print an operand as a target address, which is why `line` prints
`-> 0010` rather than a bare number.

@diagnose E0384
`cannot assign twice to immutable variable ip`. A jump is an assignment to the
instruction pointer, so the loop cannot use `for op in &chunk.code`. It needs
`let mut ip = 0;` and a `while` that the jump arms can write to, which is why
the loop was written that way in stage 2.

@after
Backpatching is the standard trick and it is worth seeing plainly: at the moment
you emit `JumpIfFalse` you do not yet know how far to jump, so you write a
placeholder, keep the index, compile the body, and overwrite the instruction
once `code.len()` is the answer.

The disassembly makes it concrete. `0005  JUMP_IF_FALSE -> 0010` says: if the
top of the stack is false, skip to instruction ten, which is the first
instruction after the body. Truth here is any non-zero `f64`, the same rule Lua
and C use.

Real bytecode stores a relative offset rather than an absolute address, usually
in two bytes, so that a chunk can be moved without rewriting its jumps. Absolute
targets are easier to read and identical in behaviour.

## 8. A loop, and a disassembler for the whole program

@kind fix
@concept disassembly
@expect E0046

A `while` loop is an `if` with one extra instruction: a jump back to the
condition, emitted before the exit target is patched. That is enough to compute
a factorial.

`while_stmt` is unwritten, and the `Display` impl that prints the whole
disassembly is empty.

```starter
use std::collections::HashMap;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Op {
    Const(usize),
    Add,
    Sub,
    Mul,
    Div,
    Neg,
    Less,
    Greater,
    Equal,
    GetGlobal(usize),
    SetGlobal(usize),
    Pop,
    Jump(usize),
    JumpIfFalse(usize),
    Return,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Chunk {
    pub code: Vec<Op>,
    pub consts: Vec<f64>,
    pub names: Vec<String>,
}

impl Chunk {
    pub fn new() -> Chunk {
        Chunk { code: Vec::new(), consts: Vec::new(), names: Vec::new() }
    }

    pub fn push(&mut self, op: Op) -> usize {
        self.code.push(op);
        self.code.len() - 1
    }

    pub fn add_const(&mut self, n: f64) -> usize {
        for (i, c) in self.consts.iter().enumerate() {
            if *c == n {
                return i;
            }
        }
        self.consts.push(n);
        self.consts.len() - 1
    }

    pub fn add_name(&mut self, name: &str) -> usize {
        for (i, s) in self.names.iter().enumerate() {
            if s == name {
                return i;
            }
        }
        self.names.push(name.to_string());
        self.names.len() - 1
    }

    pub fn line(&self, i: usize) -> String {
        match self.code[i] {
            Op::Const(k) => format!("{i:04}  CONST        {k}   ; {}", self.consts[k]),
            Op::Add => format!("{i:04}  ADD"),
            Op::Sub => format!("{i:04}  SUB"),
            Op::Mul => format!("{i:04}  MUL"),
            Op::Div => format!("{i:04}  DIV"),
            Op::Neg => format!("{i:04}  NEG"),
            Op::Less => format!("{i:04}  LESS"),
            Op::Greater => format!("{i:04}  GREATER"),
            Op::Equal => format!("{i:04}  EQUAL"),
            Op::GetGlobal(k) => format!("{i:04}  GET_GLOBAL   {k}   ; {}", self.names[k]),
            Op::SetGlobal(k) => format!("{i:04}  SET_GLOBAL   {k}   ; {}", self.names[k]),
            Op::Pop => format!("{i:04}  POP"),
            Op::Jump(t) => format!("{i:04}  JUMP          -> {t:04}"),
            Op::JumpIfFalse(t) => format!("{i:04}  JUMP_IF_FALSE -> {t:04}"),
            Op::Return => format!("{i:04}  RETURN"),
        }
    }
}

impl fmt::Display for Chunk {
}

#[derive(Debug, Clone, PartialEq)]
pub enum VmError {
    DivideByZero { ip: usize },
    StackUnderflow { ip: usize },
    UndefinedName { ip: usize, name: String },
}

impl fmt::Display for VmError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            VmError::DivideByZero { ip } => write!(f, "divide by zero at {ip:04}"),
            VmError::StackUnderflow { ip } => write!(f, "stack underflow at {ip:04}"),
            VmError::UndefinedName { ip, name } => write!(f, "undefined name `{name}` at {ip:04}"),
        }
    }
}

impl std::error::Error for VmError {}

#[derive(Debug, Clone, PartialEq)]
pub struct CompileError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for CompileError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at token {}", self.msg, self.pos)
    }
}

impl std::error::Error for CompileError {}

#[derive(Debug, Clone, PartialEq)]
pub enum Error {
    Compile(CompileError),
    Runtime(VmError),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Error::Compile(e) => write!(f, "compile error: {e}"),
            Error::Runtime(e) => write!(f, "runtime error: {e}"),
        }
    }
}

impl From<CompileError> for Error {
    fn from(e: CompileError) -> Error {
        Error::Compile(e)
    }
}

impl From<VmError> for Error {
    fn from(e: VmError) -> Error {
        Error::Runtime(e)
    }
}

#[derive(Debug, Default)]
pub struct Vm {
    stack: Vec<f64>,
    globals: HashMap<String, f64>,
}

impl Vm {
    pub fn new() -> Vm {
        Vm { stack: Vec::new(), globals: HashMap::new() }
    }

    fn pop(&mut self, ip: usize) -> Result<f64, VmError> {
        match self.stack.pop() {
            Some(v) => Ok(v),
            None => Err(VmError::StackUnderflow { ip }),
        }
    }

    pub fn run(&mut self, chunk: &Chunk) -> Result<f64, VmError> {
        let mut ip = 0;
        while ip < chunk.code.len() {
            let here = ip;
            let op = chunk.code[ip];
            ip += 1;
            match op {
                Op::Const(k) => self.stack.push(chunk.consts[k]),
                Op::Add => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a + b);
                }
                Op::Sub => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a - b);
                }
                Op::Mul => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a * b);
                }
                Op::Div => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    if b == 0.0 {
                        return Err(VmError::DivideByZero { ip: here });
                    }
                    self.stack.push(a / b);
                }
                Op::Neg => {
                    let a = self.pop(here)?;
                    self.stack.push(-a);
                }
                Op::Less => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(if a < b { 1.0 } else { 0.0 });
                }
                Op::Greater => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(if a > b { 1.0 } else { 0.0 });
                }
                Op::Equal => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(if a == b { 1.0 } else { 0.0 });
                }
                Op::GetGlobal(k) => match self.globals.get(&chunk.names[k]) {
                    Some(v) => self.stack.push(*v),
                    None => {
                        return Err(VmError::UndefinedName {
                            ip: here,
                            name: chunk.names[k].clone(),
                        })
                    }
                },
                Op::SetGlobal(k) => {
                    let v = self.pop(here)?;
                    self.globals.insert(chunk.names[k].clone(), v);
                }
                Op::Pop => {
                    self.pop(here)?;
                }
                Op::Jump(t) => ip = t,
                Op::JumpIfFalse(t) => {
                    let c = self.pop(here)?;
                    if c == 0.0 {
                        ip = t;
                    }
                }
                Op::Return => return self.pop(here),
            }
        }
        self.pop(ip)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Tok {
    Num(f64),
    Name(String),
    Plus,
    Minus,
    Star,
    Slash,
    LParen,
    RParen,
    LBrace,
    RBrace,
    Assign,
    Semi,
    Lt,
    Gt,
    EqEq,
    If,
    While,
}

pub fn tokenize(src: &str) -> Result<Vec<Tok>, CompileError> {
    let chars: Vec<char> = src.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if c.is_ascii_digit() {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            let text: String = chars[start..i].iter().collect();
            match text.parse::<f64>() {
                Ok(n) => out.push(Tok::Num(n)),
                Err(_) => return Err(CompileError { pos: start, msg: format!("bad number `{text}`") }),
            }
            continue;
        }
        if c.is_alphabetic() || c == '_' {
            let start = i;
            while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            out.push(match word.as_str() {
                "if" => Tok::If,
                "while" => Tok::While,
                _ => Tok::Name(word),
            });
            continue;
        }
        if c == '=' && chars.get(i + 1) == Some(&'=') {
            out.push(Tok::EqEq);
            i += 2;
            continue;
        }
        let t = match c {
            '+' => Tok::Plus,
            '-' => Tok::Minus,
            '*' => Tok::Star,
            '/' => Tok::Slash,
            '(' => Tok::LParen,
            ')' => Tok::RParen,
            '{' => Tok::LBrace,
            '}' => Tok::RBrace,
            '=' => Tok::Assign,
            ';' => Tok::Semi,
            '<' => Tok::Lt,
            '>' => Tok::Gt,
            other => return Err(CompileError { pos: i, msg: format!("unexpected character `{other}`") }),
        };
        out.push(t);
        i += 1;
    }
    Ok(out)
}

pub struct Compiler {
    toks: Vec<Tok>,
    pos: usize,
    chunk: Chunk,
}

impl Compiler {
    pub fn new(toks: Vec<Tok>) -> Compiler {
        Compiler { toks, pos: 0, chunk: Chunk::new() }
    }

    fn at(&self, k: usize) -> Option<Tok> {
        self.toks.get(self.pos + k).cloned()
    }

    fn eat(&mut self, want: &Tok) -> bool {
        if self.toks.get(self.pos) == Some(want) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn expect(&mut self, want: &Tok, what: &str) -> Result<(), CompileError> {
        if self.eat(want) {
            Ok(())
        } else {
            Err(CompileError { pos: self.pos, msg: format!("expected {what}") })
        }
    }

    fn unary(&mut self) -> Result<(), CompileError> {
        match self.at(0) {
            Some(Tok::Minus) => {
                self.pos += 1;
                self.unary()?;
                self.chunk.push(Op::Neg);
                Ok(())
            }
            Some(Tok::Num(n)) => {
                self.pos += 1;
                let k = self.chunk.add_const(n);
                self.chunk.push(Op::Const(k));
                Ok(())
            }
            Some(Tok::Name(name)) => {
                self.pos += 1;
                let k = self.chunk.add_name(&name);
                self.chunk.push(Op::GetGlobal(k));
                Ok(())
            }
            Some(Tok::LParen) => {
                self.pos += 1;
                self.expr(1)?;
                self.expect(&Tok::RParen, "`)`")
            }
            _ => Err(CompileError { pos: self.pos, msg: "expected a value".to_string() }),
        }
    }

    fn expr(&mut self, min_bp: u8) -> Result<(), CompileError> {
        self.unary()?;
        loop {
            let (bp, op) = match self.at(0) {
                Some(Tok::Lt) => (1, Op::Less),
                Some(Tok::Gt) => (1, Op::Greater),
                Some(Tok::EqEq) => (1, Op::Equal),
                Some(Tok::Plus) => (2, Op::Add),
                Some(Tok::Minus) => (2, Op::Sub),
                Some(Tok::Star) => (3, Op::Mul),
                Some(Tok::Slash) => (3, Op::Div),
                _ => break,
            };
            if bp < min_bp {
                break;
            }
            self.pos += 1;
            self.expr(bp + 1)?;
            self.chunk.push(op);
        }
        Ok(())
    }

    fn if_stmt(&mut self) -> Result<(), CompileError> {
        self.pos += 1;
        self.expr(1)?;
        let exit = self.chunk.push(Op::JumpIfFalse(0));
        self.expect(&Tok::LBrace, "`{`")?;
        self.block()?;
        self.expect(&Tok::RBrace, "`}`")?;
        let after = self.chunk.code.len();
        self.chunk.code[exit] = Op::JumpIfFalse(after);
        Ok(())
    }

    fn while_stmt(&mut self) -> Result<(), CompileError> {
        todo!("like `if`, plus a Jump back to the top before the exit target is known")
    }

    fn stmt(&mut self) -> Result<bool, CompileError> {
        if self.at(0) == Some(Tok::If) {
            self.if_stmt()?;
            return Ok(false);
        }
        if self.at(0) == Some(Tok::While) {
            self.while_stmt()?;
            return Ok(false);
        }
        if let (Some(Tok::Name(name)), Some(Tok::Assign)) = (self.at(0), self.at(1)) {
            self.pos += 2;
            self.expr(1)?;
            let k = self.chunk.add_name(&name);
            self.chunk.push(Op::SetGlobal(k));
            return Ok(false);
        }
        self.expr(1)?;
        Ok(true)
    }

    fn block(&mut self) -> Result<bool, CompileError> {
        let mut value = false;
        while self.pos < self.toks.len() && self.at(0) != Some(Tok::RBrace) {
            if value {
                self.chunk.push(Op::Pop);
            }
            value = self.stmt()?;
            if !self.eat(&Tok::Semi) {
                break;
            }
        }
        Ok(value)
    }

    pub fn finish(mut self) -> Result<Chunk, CompileError> {
        let value = self.block()?;
        if self.pos < self.toks.len() {
            return Err(CompileError { pos: self.pos, msg: "leftover input".to_string() });
        }
        if !value {
            return Err(CompileError {
                pos: self.pos,
                msg: "the program must end with an expression".to_string(),
            });
        }
        self.chunk.push(Op::Return);
        Ok(self.chunk)
    }
}

pub fn compile(src: &str) -> Result<Chunk, CompileError> {
    Compiler::new(tokenize(src)?).finish()
}

pub fn eval(src: &str) -> Result<f64, Error> {
    let chunk = compile(src)?;
    let mut vm = Vm::new();
    Ok(vm.run(&chunk)?)
}

pub fn hand_written() -> Chunk {
    let mut c = Chunk::new();
    let two = c.add_const(2.0);
    let three = c.add_const(3.0);
    let four = c.add_const(4.0);
    c.push(Op::Const(two));
    c.push(Op::Const(three));
    c.push(Op::Const(four));
    c.push(Op::Mul);
    c.push(Op::Add);
    c.push(Op::Return);
    c
}

pub const FACTORIAL: &str = "n = 6; f = 1; while n > 1 { f = f * n; n = n - 1 }; f";

pub fn demo() -> String {
    match compile(FACTORIAL) {
        Ok(chunk) => {
            let mut vm = Vm::new();
            let result = match vm.run(&chunk) {
                Ok(v) => format!("= {v}"),
                Err(e) => format!("! {e}"),
            };
            format!("{chunk}{result}")
        }
        Err(e) => format!("! {e}"),
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_factorial_of_six() {
        assert_eq!(eval(FACTORIAL), Ok(720.0));
    }

    #[test]
    fn a_loop_that_runs_zero_times() {
        assert_eq!(eval("n = 0; f = 1; while n > 1 { f = f * n; n = n - 1 }; f"), Ok(1.0));
    }

    #[test]
    fn the_back_jump_targets_the_condition() {
        let c = compile(FACTORIAL).unwrap();
        let jumps: Vec<Op> = c.code.iter().copied().filter(|o| matches!(o, Op::Jump(_))).collect();
        assert_eq!(jumps, vec![Op::Jump(4)]);
        assert_eq!(c.code[7], Op::JumpIfFalse(17));
    }

    #[test]
    fn everything_from_the_earlier_stages_still_holds() {
        assert_eq!(eval("2 + 3 * 4"), Ok(14.0));
        assert_eq!(eval("x = 3; if x < 10 { x = x * 2 }; x"), Ok(6.0));
        assert!(matches!(eval("1 / 0"), Err(Error::Runtime(VmError::DivideByZero { .. }))));
    }

    #[test]
    fn the_disassembler_prints_the_whole_program() {
        let text = demo();
        println!("{text}");
        assert!(text.contains("JUMP_IF_FALSE -> 0017"));
        assert!(text.contains("JUMP          -> 0004"));
        assert!(text.trim_end().ends_with("= 720"));
    }
}
```

```solution
use std::collections::HashMap;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Op {
    Const(usize),
    Add,
    Sub,
    Mul,
    Div,
    Neg,
    Less,
    Greater,
    Equal,
    GetGlobal(usize),
    SetGlobal(usize),
    Pop,
    Jump(usize),
    JumpIfFalse(usize),
    Return,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Chunk {
    pub code: Vec<Op>,
    pub consts: Vec<f64>,
    pub names: Vec<String>,
}

impl Chunk {
    pub fn new() -> Chunk {
        Chunk { code: Vec::new(), consts: Vec::new(), names: Vec::new() }
    }

    pub fn push(&mut self, op: Op) -> usize {
        self.code.push(op);
        self.code.len() - 1
    }

    pub fn add_const(&mut self, n: f64) -> usize {
        for (i, c) in self.consts.iter().enumerate() {
            if *c == n {
                return i;
            }
        }
        self.consts.push(n);
        self.consts.len() - 1
    }

    pub fn add_name(&mut self, name: &str) -> usize {
        for (i, s) in self.names.iter().enumerate() {
            if s == name {
                return i;
            }
        }
        self.names.push(name.to_string());
        self.names.len() - 1
    }

    pub fn line(&self, i: usize) -> String {
        match self.code[i] {
            Op::Const(k) => format!("{i:04}  CONST        {k}   ; {}", self.consts[k]),
            Op::Add => format!("{i:04}  ADD"),
            Op::Sub => format!("{i:04}  SUB"),
            Op::Mul => format!("{i:04}  MUL"),
            Op::Div => format!("{i:04}  DIV"),
            Op::Neg => format!("{i:04}  NEG"),
            Op::Less => format!("{i:04}  LESS"),
            Op::Greater => format!("{i:04}  GREATER"),
            Op::Equal => format!("{i:04}  EQUAL"),
            Op::GetGlobal(k) => format!("{i:04}  GET_GLOBAL   {k}   ; {}", self.names[k]),
            Op::SetGlobal(k) => format!("{i:04}  SET_GLOBAL   {k}   ; {}", self.names[k]),
            Op::Pop => format!("{i:04}  POP"),
            Op::Jump(t) => format!("{i:04}  JUMP          -> {t:04}"),
            Op::JumpIfFalse(t) => format!("{i:04}  JUMP_IF_FALSE -> {t:04}"),
            Op::Return => format!("{i:04}  RETURN"),
        }
    }
}

impl fmt::Display for Chunk {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        for i in 0..self.code.len() {
            writeln!(f, "{}", self.line(i))?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum VmError {
    DivideByZero { ip: usize },
    StackUnderflow { ip: usize },
    UndefinedName { ip: usize, name: String },
}

impl fmt::Display for VmError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            VmError::DivideByZero { ip } => write!(f, "divide by zero at {ip:04}"),
            VmError::StackUnderflow { ip } => write!(f, "stack underflow at {ip:04}"),
            VmError::UndefinedName { ip, name } => write!(f, "undefined name `{name}` at {ip:04}"),
        }
    }
}

impl std::error::Error for VmError {}

#[derive(Debug, Clone, PartialEq)]
pub struct CompileError {
    pub pos: usize,
    pub msg: String,
}

impl fmt::Display for CompileError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} at token {}", self.msg, self.pos)
    }
}

impl std::error::Error for CompileError {}

#[derive(Debug, Clone, PartialEq)]
pub enum Error {
    Compile(CompileError),
    Runtime(VmError),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Error::Compile(e) => write!(f, "compile error: {e}"),
            Error::Runtime(e) => write!(f, "runtime error: {e}"),
        }
    }
}

impl From<CompileError> for Error {
    fn from(e: CompileError) -> Error {
        Error::Compile(e)
    }
}

impl From<VmError> for Error {
    fn from(e: VmError) -> Error {
        Error::Runtime(e)
    }
}

#[derive(Debug, Default)]
pub struct Vm {
    stack: Vec<f64>,
    globals: HashMap<String, f64>,
}

impl Vm {
    pub fn new() -> Vm {
        Vm { stack: Vec::new(), globals: HashMap::new() }
    }

    fn pop(&mut self, ip: usize) -> Result<f64, VmError> {
        match self.stack.pop() {
            Some(v) => Ok(v),
            None => Err(VmError::StackUnderflow { ip }),
        }
    }

    pub fn run(&mut self, chunk: &Chunk) -> Result<f64, VmError> {
        let mut ip = 0;
        while ip < chunk.code.len() {
            let here = ip;
            let op = chunk.code[ip];
            ip += 1;
            match op {
                Op::Const(k) => self.stack.push(chunk.consts[k]),
                Op::Add => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a + b);
                }
                Op::Sub => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a - b);
                }
                Op::Mul => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(a * b);
                }
                Op::Div => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    if b == 0.0 {
                        return Err(VmError::DivideByZero { ip: here });
                    }
                    self.stack.push(a / b);
                }
                Op::Neg => {
                    let a = self.pop(here)?;
                    self.stack.push(-a);
                }
                Op::Less => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(if a < b { 1.0 } else { 0.0 });
                }
                Op::Greater => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(if a > b { 1.0 } else { 0.0 });
                }
                Op::Equal => {
                    let b = self.pop(here)?;
                    let a = self.pop(here)?;
                    self.stack.push(if a == b { 1.0 } else { 0.0 });
                }
                Op::GetGlobal(k) => match self.globals.get(&chunk.names[k]) {
                    Some(v) => self.stack.push(*v),
                    None => {
                        return Err(VmError::UndefinedName {
                            ip: here,
                            name: chunk.names[k].clone(),
                        })
                    }
                },
                Op::SetGlobal(k) => {
                    let v = self.pop(here)?;
                    self.globals.insert(chunk.names[k].clone(), v);
                }
                Op::Pop => {
                    self.pop(here)?;
                }
                Op::Jump(t) => ip = t,
                Op::JumpIfFalse(t) => {
                    let c = self.pop(here)?;
                    if c == 0.0 {
                        ip = t;
                    }
                }
                Op::Return => return self.pop(here),
            }
        }
        self.pop(ip)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Tok {
    Num(f64),
    Name(String),
    Plus,
    Minus,
    Star,
    Slash,
    LParen,
    RParen,
    LBrace,
    RBrace,
    Assign,
    Semi,
    Lt,
    Gt,
    EqEq,
    If,
    While,
}

pub fn tokenize(src: &str) -> Result<Vec<Tok>, CompileError> {
    let chars: Vec<char> = src.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if c.is_ascii_digit() {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            let text: String = chars[start..i].iter().collect();
            match text.parse::<f64>() {
                Ok(n) => out.push(Tok::Num(n)),
                Err(_) => return Err(CompileError { pos: start, msg: format!("bad number `{text}`") }),
            }
            continue;
        }
        if c.is_alphabetic() || c == '_' {
            let start = i;
            while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            out.push(match word.as_str() {
                "if" => Tok::If,
                "while" => Tok::While,
                _ => Tok::Name(word),
            });
            continue;
        }
        if c == '=' && chars.get(i + 1) == Some(&'=') {
            out.push(Tok::EqEq);
            i += 2;
            continue;
        }
        let t = match c {
            '+' => Tok::Plus,
            '-' => Tok::Minus,
            '*' => Tok::Star,
            '/' => Tok::Slash,
            '(' => Tok::LParen,
            ')' => Tok::RParen,
            '{' => Tok::LBrace,
            '}' => Tok::RBrace,
            '=' => Tok::Assign,
            ';' => Tok::Semi,
            '<' => Tok::Lt,
            '>' => Tok::Gt,
            other => return Err(CompileError { pos: i, msg: format!("unexpected character `{other}`") }),
        };
        out.push(t);
        i += 1;
    }
    Ok(out)
}

pub struct Compiler {
    toks: Vec<Tok>,
    pos: usize,
    chunk: Chunk,
}

impl Compiler {
    pub fn new(toks: Vec<Tok>) -> Compiler {
        Compiler { toks, pos: 0, chunk: Chunk::new() }
    }

    fn at(&self, k: usize) -> Option<Tok> {
        self.toks.get(self.pos + k).cloned()
    }

    fn eat(&mut self, want: &Tok) -> bool {
        if self.toks.get(self.pos) == Some(want) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn expect(&mut self, want: &Tok, what: &str) -> Result<(), CompileError> {
        if self.eat(want) {
            Ok(())
        } else {
            Err(CompileError { pos: self.pos, msg: format!("expected {what}") })
        }
    }

    fn unary(&mut self) -> Result<(), CompileError> {
        match self.at(0) {
            Some(Tok::Minus) => {
                self.pos += 1;
                self.unary()?;
                self.chunk.push(Op::Neg);
                Ok(())
            }
            Some(Tok::Num(n)) => {
                self.pos += 1;
                let k = self.chunk.add_const(n);
                self.chunk.push(Op::Const(k));
                Ok(())
            }
            Some(Tok::Name(name)) => {
                self.pos += 1;
                let k = self.chunk.add_name(&name);
                self.chunk.push(Op::GetGlobal(k));
                Ok(())
            }
            Some(Tok::LParen) => {
                self.pos += 1;
                self.expr(1)?;
                self.expect(&Tok::RParen, "`)`")
            }
            _ => Err(CompileError { pos: self.pos, msg: "expected a value".to_string() }),
        }
    }

    fn expr(&mut self, min_bp: u8) -> Result<(), CompileError> {
        self.unary()?;
        loop {
            let (bp, op) = match self.at(0) {
                Some(Tok::Lt) => (1, Op::Less),
                Some(Tok::Gt) => (1, Op::Greater),
                Some(Tok::EqEq) => (1, Op::Equal),
                Some(Tok::Plus) => (2, Op::Add),
                Some(Tok::Minus) => (2, Op::Sub),
                Some(Tok::Star) => (3, Op::Mul),
                Some(Tok::Slash) => (3, Op::Div),
                _ => break,
            };
            if bp < min_bp {
                break;
            }
            self.pos += 1;
            self.expr(bp + 1)?;
            self.chunk.push(op);
        }
        Ok(())
    }

    fn if_stmt(&mut self) -> Result<(), CompileError> {
        self.pos += 1;
        self.expr(1)?;
        let exit = self.chunk.push(Op::JumpIfFalse(0));
        self.expect(&Tok::LBrace, "`{`")?;
        self.block()?;
        self.expect(&Tok::RBrace, "`}`")?;
        let after = self.chunk.code.len();
        self.chunk.code[exit] = Op::JumpIfFalse(after);
        Ok(())
    }

    fn while_stmt(&mut self) -> Result<(), CompileError> {
        self.pos += 1;
        let top = self.chunk.code.len();
        self.expr(1)?;
        let exit = self.chunk.push(Op::JumpIfFalse(0));
        self.expect(&Tok::LBrace, "`{`")?;
        self.block()?;
        self.expect(&Tok::RBrace, "`}`")?;
        self.chunk.push(Op::Jump(top));
        let after = self.chunk.code.len();
        self.chunk.code[exit] = Op::JumpIfFalse(after);
        Ok(())
    }

    fn stmt(&mut self) -> Result<bool, CompileError> {
        if self.at(0) == Some(Tok::If) {
            self.if_stmt()?;
            return Ok(false);
        }
        if self.at(0) == Some(Tok::While) {
            self.while_stmt()?;
            return Ok(false);
        }
        if let (Some(Tok::Name(name)), Some(Tok::Assign)) = (self.at(0), self.at(1)) {
            self.pos += 2;
            self.expr(1)?;
            let k = self.chunk.add_name(&name);
            self.chunk.push(Op::SetGlobal(k));
            return Ok(false);
        }
        self.expr(1)?;
        Ok(true)
    }

    fn block(&mut self) -> Result<bool, CompileError> {
        let mut value = false;
        while self.pos < self.toks.len() && self.at(0) != Some(Tok::RBrace) {
            if value {
                self.chunk.push(Op::Pop);
            }
            value = self.stmt()?;
            if !self.eat(&Tok::Semi) {
                break;
            }
        }
        Ok(value)
    }

    pub fn finish(mut self) -> Result<Chunk, CompileError> {
        let value = self.block()?;
        if self.pos < self.toks.len() {
            return Err(CompileError { pos: self.pos, msg: "leftover input".to_string() });
        }
        if !value {
            return Err(CompileError {
                pos: self.pos,
                msg: "the program must end with an expression".to_string(),
            });
        }
        self.chunk.push(Op::Return);
        Ok(self.chunk)
    }
}

pub fn compile(src: &str) -> Result<Chunk, CompileError> {
    Compiler::new(tokenize(src)?).finish()
}

pub fn eval(src: &str) -> Result<f64, Error> {
    let chunk = compile(src)?;
    let mut vm = Vm::new();
    Ok(vm.run(&chunk)?)
}

pub fn hand_written() -> Chunk {
    let mut c = Chunk::new();
    let two = c.add_const(2.0);
    let three = c.add_const(3.0);
    let four = c.add_const(4.0);
    c.push(Op::Const(two));
    c.push(Op::Const(three));
    c.push(Op::Const(four));
    c.push(Op::Mul);
    c.push(Op::Add);
    c.push(Op::Return);
    c
}

pub const FACTORIAL: &str = "n = 6; f = 1; while n > 1 { f = f * n; n = n - 1 }; f";

pub fn demo() -> String {
    match compile(FACTORIAL) {
        Ok(chunk) => {
            let mut vm = Vm::new();
            let result = match vm.run(&chunk) {
                Ok(v) => format!("= {v}"),
                Err(e) => format!("! {e}"),
            };
            format!("{chunk}{result}")
        }
        Err(e) => format!("! {e}"),
    }
}
```

@hint The trait has one required method, and the impl on `VmError` a few hundred lines above shows its signature.
@hint Record `self.chunk.code.len()` before compiling the condition. That is where the back jump has to land.
@hint Order: mark the top, compile the condition, emit `JumpIfFalse(0)` and keep its index, compile the braced body, emit `Jump(top)`, then patch the `JumpIfFalse` to `code.len()`.

@diagnose E0046
`not all trait items implemented, missing: fmt`. The impl block exists and its
one required method does not, so `Display` is a promise with nothing behind it.

`demo` still compiles, and that is informative: `format!("{chunk}")` only needs
the impl to exist for name resolution to succeed, and `ToString` has a blanket
impl for every `T: Display`, so `to_string` appears at the same moment. Only the
body is missing.

The signature is `fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result`. Loop
over the instruction indices and `writeln!` each `self.line(i)`, propagating with
`?`, and finish with `Ok(())`.

@diagnose E0004
The interpreter loop or the disassembler is missing an arm. Both matches have to
cover every `Op`, and `Jump` and `JumpIfFalse` arrived in stage 7.

@after
Nineteen instructions, and the loop is four of them plus a back jump. Read the
disassembly next to the source and the correspondence is exact: `0016  JUMP ->
0004` returns to the condition, and `0007  JUMP_IF_FALSE -> 0017` leaves for the
instruction after the body. There is no loop construct in the machine at all,
only a jump backwards.

That is the thing worth carrying away. Every control structure in every language
that compiles to bytecode is conditional and unconditional jumps underneath:
`for`, `match`, `break`, short-circuiting `&&`, exception unwinding. A compiler
is largely the business of deciding where to jump and patching the address in
once it knows.

To take this further, the next pieces in order are locals with stack slots
instead of a hash lookup, then call frames so functions can exist, then a heap
with strings and objects. `clox`, from Crafting Interpreters, is this program
with those three additions and is worth reading next.
