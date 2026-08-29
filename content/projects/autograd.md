---
project: autograd
tier: core
domain: ai
title: Backprop from scratch
accent: rust
blurb: Build the reverse-mode autodiff engine that sits underneath PyTorch, then train a tiny network on XOR and watch the loss fall.
needs: 18-smart-ptr, 14-traits, 16-closures
mins: 75
---

Every neural network anyone has ever trained was trained by the same procedure:
run the network forward, measure how wrong it was, then work out how much each
individual number inside it contributed to that wrongness, and nudge each one in
the direction that makes the wrongness smaller. The second half of that sentence
is the hard part, and it has a name: reverse-mode automatic differentiation, or
backpropagation.

PyTorch, JAX and TensorFlow are large libraries, but the differentiation engine
at the centre of each is small. It records the arithmetic as it happens, builds
a graph of what depended on what, then walks that graph backwards applying the
chain rule at each node. Nothing more. You are going to write that engine in
about a hundred and fifty lines of Rust, and then use it to train a network on
XOR, a problem that a single linear layer provably cannot solve.

The graph nodes are shared: one weight feeds four neurons, so four nodes hold
the same parent. That is the shape `Rc<RefCell<T>>` exists for, and this is a
real reason to reach for it rather than a demonstration of the syntax. Shared
ownership, interior mutability, `std::ops` operator overloading and closures all
show up because the problem asks for them.

What the real thing adds: tensors instead of scalars, so one node holds a
million numbers and the backward pass is a matrix multiply; kernels that run on
a GPU; and enough operators to build a transformer. The engine underneath is
what you are about to write.

## 1. A number that remembers where it came from

@kind fix
@concept Rc
@expect E0594

A `Value` is one number in the graph, plus the gradient that will be written
into it later, plus the values it was computed from. Sharing is the whole point:
cloning a `Value` must hand back the same node, not a copy of it.

The struct below cannot record a gradient. Fix the container.

```starter
use std::rc::Rc;

pub struct Node {
    pub data: f64,
    pub grad: f64,
    pub prev: Vec<Value>,
}

#[derive(Clone)]
pub struct Value(pub Rc<Node>);

impl Value {
    pub fn new(data: f64) -> Value {
        Value(Rc::new(Node { data, grad: 0.0, prev: Vec::new() }))
    }

    pub fn data(&self) -> f64 {
        self.0.data
    }

    pub fn grad(&self) -> f64 {
        self.0.grad
    }

    pub fn set_grad(&self, g: f64) {
        self.0.grad = g;
    }

    pub fn parents(&self) -> Vec<Value> {
        self.0.prev.clone()
    }

    pub fn same_node(&self, other: &Value) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn a_leaf_holds_a_number_and_no_history() {
        let a = Value::new(2.5);
        assert!(close(a.data(), 2.5));
        assert!(close(a.grad(), 0.0));
        assert!(a.parents().is_empty());
    }

    #[test]
    fn a_clone_is_the_same_node() {
        let a = Value::new(1.0);
        let b = a.clone();
        b.set_grad(4.0);
        assert!(close(a.grad(), 4.0));
        assert!(a.same_node(&b));
    }

    #[test]
    fn equal_numbers_are_still_different_nodes() {
        let a = Value::new(1.0);
        let b = Value::new(1.0);
        a.set_grad(1.0);
        assert!(close(b.grad(), 0.0));
        assert!(!a.same_node(&b));
    }
}
```

```solution
use std::cell::RefCell;
use std::rc::Rc;

pub struct Node {
    pub data: f64,
    pub grad: f64,
    pub prev: Vec<Value>,
}

#[derive(Clone)]
pub struct Value(pub Rc<RefCell<Node>>);

impl Value {
    pub fn new(data: f64) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, prev: Vec::new() })))
    }

    pub fn data(&self) -> f64 {
        self.0.borrow().data
    }

    pub fn grad(&self) -> f64 {
        self.0.borrow().grad
    }

    pub fn set_grad(&self, g: f64) {
        self.0.borrow_mut().grad = g;
    }

    pub fn parents(&self) -> Vec<Value> {
        self.0.borrow().prev.clone()
    }

    pub fn same_node(&self, other: &Value) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }
}
```

@hint `Rc<T>` hands out shared ownership, and shared ownership only ever derefs to `&T`. Count how many owners can exist at the moment you want to write.
@hint The gradient has to be written through a shared handle. That is exactly the job of a cell type from `std::cell`.
@hint `Rc<RefCell<Node>>`. Construct with `Rc::new(RefCell::new(node))`, read with `self.0.borrow().data`, write with `self.0.borrow_mut().grad = g`.

@diagnose E0594
`cannot assign to data in an Rc`. The reference count is the reason. An `Rc`
exists so several owners can hold the same allocation, and the compiler has no
idea how many of them exist right now or what they are doing. If it let one
owner take a `&mut Node` out of an `Rc`, another owner could be reading the same
`Node` at the same time, which is precisely the aliasing that `&mut` promises
cannot happen.

So `Rc<T>` only ever derefs to `&T`. To mutate you need a type that does the
exclusivity check itself, at runtime, and `RefCell<T>` is that type: `borrow()`
and `borrow_mut()` keep a count and panic if the rule is broken, rather than
refusing to compile.

@diagnose E0596
You have tried to take `&mut` out of something that only gives out `&`, most
likely by calling a `&mut self` method on `self.0`. Adding `mut` to a binding
will not help here, because the restriction comes from `Rc`, not from the
binding. The fix is a cell type inside the `Rc`.

@diagnose E0308
Check where a `RefCell` starts and stops. `self.0.borrow()` gives you a
`Ref<Node>`, which derefs to `Node`, so `self.0.borrow().data` is an `f64` and
`self.0.borrow()` on its own is not. Also note `Value::new` now needs two
constructor calls, `Rc::new(RefCell::new(..))`, not one.

@after
`Rc<RefCell<T>>` gets called a code smell often enough that it is worth saying
when it is the right answer. It is right when a value genuinely has several
owners with no single obvious one, and any of them may write. A node in a
computation graph is exactly that: the weight `w` is a parent of four different
sums, none of those sums is more of an owner than the others, and the backward
pass writes into every node.

The cost is two words of counter per node and a runtime borrow check per access.
For an autodiff engine that cost is real but small, and the alternative designs
(an arena of indices, unsafe pointers) trade it for bookkeeping you would have to
get right yourself.

## 2. Arithmetic that leaves a trail

@kind write
@concept trait
@expect E0369

Now the graph builds itself. `&a * &b` should produce a new `Value` holding the
product **and** holding on to `a` and `b`, so that later something can ask the
product where it came from.

Implement `Add` and `Mul` for `&Value` so the tests below compile.

```starter
use std::cell::RefCell;
use std::rc::Rc;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Op {
    Leaf,
    Add,
    Mul,
}

pub struct Node {
    pub data: f64,
    pub grad: f64,
    pub op: Op,
    pub prev: Vec<Value>,
}

#[derive(Clone)]
pub struct Value(pub Rc<RefCell<Node>>);

impl Value {
    pub fn new(data: f64) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op: Op::Leaf, prev: Vec::new() })))
    }

    pub fn from_op(data: f64, op: Op, prev: Vec<Value>) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op, prev })))
    }

    pub fn data(&self) -> f64 {
        self.0.borrow().data
    }

    pub fn grad(&self) -> f64 {
        self.0.borrow().grad
    }

    pub fn op(&self) -> Op {
        self.0.borrow().op
    }

    pub fn set_grad(&self, g: f64) {
        self.0.borrow_mut().grad = g;
    }

    pub fn parents(&self) -> Vec<Value> {
        self.0.borrow().prev.clone()
    }

    pub fn same_node(&self, other: &Value) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }
}

// The two impls go here. Both take &Value on each side and return an owned Value.
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn the_arithmetic_is_still_arithmetic() {
        let a = Value::new(2.0);
        let b = Value::new(-3.0);
        assert!(close((&a * &b).data(), -6.0));
        assert!(close((&a + &b).data(), -1.0));
    }

    #[test]
    fn a_result_remembers_both_parents() {
        let a = Value::new(2.0);
        let b = Value::new(-3.0);
        let c = &a * &b;
        assert_eq!(c.op(), Op::Mul);
        let p = c.parents();
        assert_eq!(p.len(), 2);
        assert!(p[0].same_node(&a));
        assert!(p[1].same_node(&b));
    }

    #[test]
    fn an_expression_builds_a_graph() {
        let a = Value::new(2.0);
        let b = Value::new(-3.0);
        let c = Value::new(10.0);
        let d = &(&a * &b) + &c;
        assert!(close(d.data(), 4.0));
        assert_eq!(d.op(), Op::Add);
        assert_eq!(d.parents()[0].op(), Op::Mul);
        assert!(d.parents()[1].same_node(&c));
    }

    #[test]
    fn a_value_used_twice_is_one_node() {
        let a = Value::new(3.0);
        let d = &a + &a;
        assert!(close(d.data(), 6.0));
        assert!(d.parents()[0].same_node(&d.parents()[1]));
    }
}
```

```solution
use std::cell::RefCell;
use std::rc::Rc;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Op {
    Leaf,
    Add,
    Mul,
}

pub struct Node {
    pub data: f64,
    pub grad: f64,
    pub op: Op,
    pub prev: Vec<Value>,
}

#[derive(Clone)]
pub struct Value(pub Rc<RefCell<Node>>);

impl Value {
    pub fn new(data: f64) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op: Op::Leaf, prev: Vec::new() })))
    }

    pub fn from_op(data: f64, op: Op, prev: Vec<Value>) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op, prev })))
    }

    pub fn data(&self) -> f64 {
        self.0.borrow().data
    }

    pub fn grad(&self) -> f64 {
        self.0.borrow().grad
    }

    pub fn op(&self) -> Op {
        self.0.borrow().op
    }

    pub fn set_grad(&self, g: f64) {
        self.0.borrow_mut().grad = g;
    }

    pub fn parents(&self) -> Vec<Value> {
        self.0.borrow().prev.clone()
    }

    pub fn same_node(&self, other: &Value) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }
}

impl std::ops::Add for &Value {
    type Output = Value;
    fn add(self, rhs: &Value) -> Value {
        Value::from_op(self.data() + rhs.data(), Op::Add, vec![self.clone(), rhs.clone()])
    }
}

impl std::ops::Mul for &Value {
    type Output = Value;
    fn mul(self, rhs: &Value) -> Value {
        Value::from_op(self.data() * rhs.data(), Op::Mul, vec![self.clone(), rhs.clone()])
    }
}
```

@hint The operator traits live in `std::ops`. `Add` has one associated type and one method, and the method takes `self` by value, which is why implementing it for `&Value` rather than `Value` is what you want.
@hint `impl std::ops::Add for &Value` means `Self` is `&Value`, so `self` is a `&Value` and the default `Rhs` is `&Value` too. Set `type Output = Value;` and build the node with `Value::from_op`.
@hint The body is one call: `Value::from_op(self.data() + rhs.data(), Op::Add, vec![self.clone(), rhs.clone()])`. Cloning a `Value` bumps a reference count, so the new node and the caller point at the same parents.

@diagnose E0369
`cannot add &Value to &Value`. The `+` in Rust is not built in for your types; it
is sugar for `std::ops::Add::add`, and rustc looked for an implementation whose
`Self` is `&Value` and found none. The note it prints, `the trait Add is not
implemented for &Value`, names exactly the impl you have to write.

The reason the impl goes on `&Value` and not on `Value` is ownership. `add`
takes `self` by value, so `impl Add for Value` would consume both operands, and
`&(&a * &b) + &c` would destroy the intermediate node you are trying to keep a
handle on. Implementing it for the reference means the operator borrows, and the
new node takes its own reference-counted handles.

@diagnose E0046
`not all trait items implemented, missing: Output`. `Add` has an associated type
saying what the expression evaluates to. Write `type Output = Value;` as the
first line of the impl block, above `fn add`.

@diagnose E0308
The method must return `Self::Output`, which is `Value`, not `&Value` and not
`f64`. `Value::from_op` already hands you an owned `Value`, so the body is one
expression with no trailing semicolon.

@after
Operator overloading here is not decoration. The whole trick of an autodiff
engine is that recording the graph is a **side effect of ordinary arithmetic**:
you write `&(&w * &x) + &b` the way you would write the maths, and a graph
appears without anyone calling a `record` function. PyTorch does the same thing
by overloading `__mul__` on `Tensor`.

Notice what `vec![self.clone(), rhs.clone()]` costs: two atomic-free counter
increments. The parent nodes are not copied, which is why a node used by forty
downstream nodes still exists once.

## 3. Putting the graph in order

@kind fix
@concept Rc
@expect E0599

The backward pass has to visit a node only after every node that used it, so it
needs the graph sorted. A depth-first walk that pushes a node after its parents
gives exactly that order, provided each node is visited once.

The visited set below does not compile. Work out what identity a node has.

```starter
use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Op {
    Leaf,
    Add,
    Mul,
}

pub struct Node {
    pub data: f64,
    pub grad: f64,
    pub op: Op,
    pub prev: Vec<Value>,
}

#[derive(Clone)]
pub struct Value(pub Rc<RefCell<Node>>);

impl Value {
    pub fn new(data: f64) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op: Op::Leaf, prev: Vec::new() })))
    }

    pub fn from_op(data: f64, op: Op, prev: Vec<Value>) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op, prev })))
    }

    pub fn data(&self) -> f64 {
        self.0.borrow().data
    }

    pub fn grad(&self) -> f64 {
        self.0.borrow().grad
    }

    pub fn op(&self) -> Op {
        self.0.borrow().op
    }

    pub fn set_grad(&self, g: f64) {
        self.0.borrow_mut().grad = g;
    }

    pub fn parents(&self) -> Vec<Value> {
        self.0.borrow().prev.clone()
    }

    pub fn same_node(&self, other: &Value) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }

    pub fn topo(&self) -> Vec<Value> {
        let mut seen: HashSet<Value> = HashSet::new();
        let mut out: Vec<Value> = Vec::new();
        self.visit(&mut seen, &mut out);
        out
    }

    fn visit(&self, seen: &mut HashSet<Value>, out: &mut Vec<Value>) {
        if !seen.insert(self.clone()) {
            return;
        }
        for p in self.parents() {
            p.visit(seen, out);
        }
        out.push(self.clone());
    }
}

impl std::ops::Add for &Value {
    type Output = Value;
    fn add(self, rhs: &Value) -> Value {
        Value::from_op(self.data() + rhs.data(), Op::Add, vec![self.clone(), rhs.clone()])
    }
}

impl std::ops::Mul for &Value {
    type Output = Value;
    fn mul(self, rhs: &Value) -> Value {
        Value::from_op(self.data() * rhs.data(), Op::Mul, vec![self.clone(), rhs.clone()])
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    fn expr() -> (Value, Value, Value, Value) {
        let a = Value::new(2.0);
        let b = Value::new(-3.0);
        let c = Value::new(10.0);
        let d = &(&a * &b) + &c;
        (a, b, c, d)
    }

    #[test]
    fn every_node_is_listed_once() {
        let (_a, _b, _c, d) = expr();
        assert_eq!(d.topo().len(), 5);
        assert!(close(d.data(), 4.0));
    }

    #[test]
    fn a_shared_node_is_listed_once() {
        let a = Value::new(3.0);
        let d = &a + &a;
        assert_eq!(d.topo().len(), 2);
    }

    #[test]
    fn the_root_comes_last() {
        let (_a, _b, _c, d) = expr();
        let order = d.topo();
        assert!(order.last().unwrap().same_node(&d));
    }

    #[test]
    fn every_parent_comes_before_its_child() {
        let (_a, _b, _c, d) = expr();
        let order = d.topo();
        for (i, v) in order.iter().enumerate() {
            for p in v.parents() {
                let at = order.iter().position(|u| u.same_node(&p)).unwrap();
                assert!(at < i, "a parent was listed after its child");
            }
        }
    }
}
```

```solution
use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Op {
    Leaf,
    Add,
    Mul,
}

pub struct Node {
    pub data: f64,
    pub grad: f64,
    pub op: Op,
    pub prev: Vec<Value>,
}

#[derive(Clone)]
pub struct Value(pub Rc<RefCell<Node>>);

impl Value {
    pub fn new(data: f64) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op: Op::Leaf, prev: Vec::new() })))
    }

    pub fn from_op(data: f64, op: Op, prev: Vec<Value>) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op, prev })))
    }

    pub fn data(&self) -> f64 {
        self.0.borrow().data
    }

    pub fn grad(&self) -> f64 {
        self.0.borrow().grad
    }

    pub fn op(&self) -> Op {
        self.0.borrow().op
    }

    pub fn set_grad(&self, g: f64) {
        self.0.borrow_mut().grad = g;
    }

    pub fn parents(&self) -> Vec<Value> {
        self.0.borrow().prev.clone()
    }

    pub fn same_node(&self, other: &Value) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }

    pub fn topo(&self) -> Vec<Value> {
        let mut seen: HashSet<usize> = HashSet::new();
        let mut out: Vec<Value> = Vec::new();
        self.visit(&mut seen, &mut out);
        out
    }

    fn visit(&self, seen: &mut HashSet<usize>, out: &mut Vec<Value>) {
        if !seen.insert(Rc::as_ptr(&self.0) as usize) {
            return;
        }
        for p in self.parents() {
            p.visit(seen, out);
        }
        out.push(self.clone());
    }
}

impl std::ops::Add for &Value {
    type Output = Value;
    fn add(self, rhs: &Value) -> Value {
        Value::from_op(self.data() + rhs.data(), Op::Add, vec![self.clone(), rhs.clone()])
    }
}

impl std::ops::Mul for &Value {
    type Output = Value;
    fn mul(self, rhs: &Value) -> Value {
        Value::from_op(self.data() * rhs.data(), Op::Mul, vec![self.clone(), rhs.clone()])
    }
}
```

@hint A `HashSet` needs to hash and compare what you put in it. Ask what it would mean to hash a `Value` whose contents change during the backward pass.
@hint Two nodes are the same node when they are the same allocation. `same_node` already answers that with `Rc::ptr_eq`, and a set wants a value it can hash.
@hint `Rc::as_ptr(&self.0) as usize` is the node's address as a plain integer. Store those in a `HashSet<usize>`.

@diagnose E0599
`the method insert exists for mutable reference &mut HashSet<Value>, but its
trait bounds were not satisfied`, followed by `Value: Eq` and `Value: Hash`.
Every `HashSet` operation is bounded on those two traits, so with neither
derived the method is invisible rather than merely rejected.

Do not take the `#[derive(Eq, Hash, PartialEq)]` the compiler offers. Hashing a
`Value` would have to hash the `Node` behind the `Rc`, and that `Node` holds a
`grad` the backward pass is about to overwrite. A key whose hash changes while
it sits in a set corrupts the set. Two separately created `Value::new(1.0)`
nodes would also compare equal while being different nodes.

You want identity rather than equality, and a node's identity is its address.

@diagnose E0277
`the trait bound f64: Hash is not satisfied`. This is where the compiler's
suggested derive leads: `Hash` on `Value` needs `Hash` on `Node`, which needs it
on `data: f64`, and floats do not implement `Hash` because `NaN != NaN` breaks
the contract that equal keys hash equally.

Rust is refusing to let you key a hash map on a number that is not reliably
equal to itself. Store the address instead.

@after
The ordering property is the whole reason for this stage. `visit` pushes a node
only after every one of its parents has been pushed, so `topo` returns parents
before children, and reversing it gives children before parents. That is the
order the backward pass needs: by the time a node hands gradient to its parents,
every node that used it has already handed gradient to it.

The `seen` set is what keeps a shared weight from being visited four times.
Without it a wide graph is walked exponentially, which is the difference between
an engine that trains and one that hangs.

## 4. The chain rule, twice

@kind fill
@concept RefCell
@expect E0004

`backward` seeds the root with a gradient of 1 (the output's derivative with
respect to itself) and walks the sorted graph in reverse. Each node hands its
own gradient to its parents, scaled by the local derivative.

Fill in the two arms. Addition and multiplication scale it differently.

```starter
use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Op {
    Leaf,
    Add,
    Mul,
}

pub struct Node {
    pub data: f64,
    pub grad: f64,
    pub op: Op,
    pub prev: Vec<Value>,
}

#[derive(Clone)]
pub struct Value(pub Rc<RefCell<Node>>);

impl Value {
    pub fn new(data: f64) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op: Op::Leaf, prev: Vec::new() })))
    }

    pub fn from_op(data: f64, op: Op, prev: Vec<Value>) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op, prev })))
    }

    pub fn data(&self) -> f64 {
        self.0.borrow().data
    }

    pub fn grad(&self) -> f64 {
        self.0.borrow().grad
    }

    pub fn op(&self) -> Op {
        self.0.borrow().op
    }

    pub fn set_grad(&self, g: f64) {
        self.0.borrow_mut().grad = g;
    }

    pub fn add_grad(&self, g: f64) {
        self.0.borrow_mut().grad += g;
    }

    pub fn parents(&self) -> Vec<Value> {
        self.0.borrow().prev.clone()
    }

    pub fn same_node(&self, other: &Value) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }

    pub fn topo(&self) -> Vec<Value> {
        let mut seen: HashSet<usize> = HashSet::new();
        let mut out: Vec<Value> = Vec::new();
        self.visit(&mut seen, &mut out);
        out
    }

    fn visit(&self, seen: &mut HashSet<usize>, out: &mut Vec<Value>) {
        if !seen.insert(Rc::as_ptr(&self.0) as usize) {
            return;
        }
        for p in self.parents() {
            p.visit(seen, out);
        }
        out.push(self.clone());
    }

    pub fn backward(&self) {
        let order = self.topo();
        self.set_grad(1.0);
        for v in order.iter().rev() {
            v.push_grad();
        }
    }

    fn push_grad(&self) {
        let (op, grad, prev) = {
            let n = self.0.borrow();
            (n.op, n.grad, n.prev.clone())
        };
        match op {
            Op::Leaf => {}
        }
    }
}

impl std::ops::Add for &Value {
    type Output = Value;
    fn add(self, rhs: &Value) -> Value {
        Value::from_op(self.data() + rhs.data(), Op::Add, vec![self.clone(), rhs.clone()])
    }
}

impl std::ops::Mul for &Value {
    type Output = Value;
    fn mul(self, rhs: &Value) -> Value {
        Value::from_op(self.data() * rhs.data(), Op::Mul, vec![self.clone(), rhs.clone()])
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn add_passes_the_gradient_straight_through() {
        let a = Value::new(2.0);
        let b = Value::new(-3.0);
        let c = &a + &b;
        c.backward();
        assert!(close(c.grad(), 1.0));
        assert!(close(a.grad(), 1.0));
        assert!(close(b.grad(), 1.0));
    }

    #[test]
    fn mul_hands_each_parent_the_other_one() {
        let a = Value::new(2.0);
        let b = Value::new(-3.0);
        let c = &a * &b;
        c.backward();
        assert!(close(a.grad(), -3.0));
        assert!(close(b.grad(), 2.0));
    }

    #[test]
    fn the_chain_rule_reaches_the_leaves() {
        let a = Value::new(2.0);
        let b = Value::new(-3.0);
        let c = Value::new(10.0);
        let f = Value::new(-2.0);
        let d = &(&a * &b) + &c;
        let e = &d * &f;
        e.backward();
        assert!(close(e.data(), -8.0));
        assert!(close(d.grad(), -2.0));
        assert!(close(f.grad(), 4.0));
        assert!(close(a.grad(), 6.0));
        assert!(close(b.grad(), -4.0));
        assert!(close(c.grad(), -2.0));
    }

    #[test]
    fn a_node_used_twice_collects_both_contributions() {
        let a = Value::new(3.0);
        let d = &a + &a;
        d.backward();
        assert!(close(a.grad(), 2.0));
    }
}
```

```solution
use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Op {
    Leaf,
    Add,
    Mul,
}

pub struct Node {
    pub data: f64,
    pub grad: f64,
    pub op: Op,
    pub prev: Vec<Value>,
}

#[derive(Clone)]
pub struct Value(pub Rc<RefCell<Node>>);

impl Value {
    pub fn new(data: f64) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op: Op::Leaf, prev: Vec::new() })))
    }

    pub fn from_op(data: f64, op: Op, prev: Vec<Value>) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op, prev })))
    }

    pub fn data(&self) -> f64 {
        self.0.borrow().data
    }

    pub fn grad(&self) -> f64 {
        self.0.borrow().grad
    }

    pub fn op(&self) -> Op {
        self.0.borrow().op
    }

    pub fn set_grad(&self, g: f64) {
        self.0.borrow_mut().grad = g;
    }

    pub fn add_grad(&self, g: f64) {
        self.0.borrow_mut().grad += g;
    }

    pub fn parents(&self) -> Vec<Value> {
        self.0.borrow().prev.clone()
    }

    pub fn same_node(&self, other: &Value) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }

    pub fn topo(&self) -> Vec<Value> {
        let mut seen: HashSet<usize> = HashSet::new();
        let mut out: Vec<Value> = Vec::new();
        self.visit(&mut seen, &mut out);
        out
    }

    fn visit(&self, seen: &mut HashSet<usize>, out: &mut Vec<Value>) {
        if !seen.insert(Rc::as_ptr(&self.0) as usize) {
            return;
        }
        for p in self.parents() {
            p.visit(seen, out);
        }
        out.push(self.clone());
    }

    pub fn backward(&self) {
        let order = self.topo();
        self.set_grad(1.0);
        for v in order.iter().rev() {
            v.push_grad();
        }
    }

    fn push_grad(&self) {
        let (op, grad, prev) = {
            let n = self.0.borrow();
            (n.op, n.grad, n.prev.clone())
        };
        match op {
            Op::Leaf => {}
            Op::Add => {
                prev[0].add_grad(grad);
                prev[1].add_grad(grad);
            }
            Op::Mul => {
                let (a, b) = (prev[0].data(), prev[1].data());
                prev[0].add_grad(b * grad);
                prev[1].add_grad(a * grad);
            }
        }
    }
}

impl std::ops::Add for &Value {
    type Output = Value;
    fn add(self, rhs: &Value) -> Value {
        Value::from_op(self.data() + rhs.data(), Op::Add, vec![self.clone(), rhs.clone()])
    }
}

impl std::ops::Mul for &Value {
    type Output = Value;
    fn mul(self, rhs: &Value) -> Value {
        Value::from_op(self.data() * rhs.data(), Op::Mul, vec![self.clone(), rhs.clone()])
    }
}
```

@hint For `c = a + b`, moving `a` by a tiny amount moves `c` by the same amount. The local derivative is 1, so the gradient arrives at both parents unchanged.
@hint For `c = a * b`, moving `a` by a tiny amount moves `c` by `b` times that amount. So `a` gets `b.data() * grad` and `b` gets `a.data() * grad`.
@hint Use `add_grad`, never `set_grad`, inside `push_grad`. A node with two children receives one contribution from each, and they have to sum.

@diagnose E0004
`non-exhaustive patterns: Op::Add and Op::Mul not covered`. A `match` on an enum
must handle every variant, and the compiler is listing the two you left out.

This is the error you want from an autodiff engine. Every operator you add to
`Op` from now on will produce this same message pointing at `push_grad`, which
is the one place in the program that must learn the new derivative. A wildcard
arm `_ => {}` would silence it and give you an operator that silently
contributes no gradient, and the symptom of that is a network that trains a
little worse than it should for reasons nobody can find.

@diagnose E0502
You are holding the `borrow()` of this node while calling `add_grad` on a
parent, and if that parent turns out to be this same node (`&a + &a`) the
runtime borrow check panics. The starter already avoids it: the block that ends
with `(n.op, n.grad, n.prev.clone())` copies out what is needed and drops the
borrow before the match runs. Keep that shape.

@diagnose E0308
`grad` and `data` are `f64`, and `prev` is a `Vec<Value>`, so `prev[0]` is a
`Value` and `prev[0].data()` is its number. `add_grad` wants an `f64`.

@after
Three lines each, and that is backpropagation in full.

Addition is a router: it copies the incoming gradient to both parents, because
each contributed one to one. Multiplication swaps: the derivative with respect to
one operand is the value of the other, so the parents trade data. The accumulate
in `add_grad` is what handles a value feeding several places, which in a network
is every single weight.

Run this on a graph a hundred thousand nodes wide and it costs one pass. That is
what makes reverse mode the right choice when you have many inputs and one
output, which is the exact shape of a loss function.

## 5. The bend that makes depth matter

@kind fix
@concept match
@expect E0425

`tanh` squashes any number into the range minus one to one, and its derivative
has a famously convenient form: if `t` is the output, the derivative is
`1 - t * t`. The node already knows `t`, because `t` is its own `data`.

The new arm refers to a `t` that is not in scope. Get it there.

```starter
use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Op {
    Leaf,
    Add,
    Mul,
    Tanh,
}

pub struct Node {
    pub data: f64,
    pub grad: f64,
    pub op: Op,
    pub prev: Vec<Value>,
}

#[derive(Clone)]
pub struct Value(pub Rc<RefCell<Node>>);

impl Value {
    pub fn new(data: f64) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op: Op::Leaf, prev: Vec::new() })))
    }

    pub fn from_op(data: f64, op: Op, prev: Vec<Value>) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op, prev })))
    }

    pub fn data(&self) -> f64 {
        self.0.borrow().data
    }

    pub fn grad(&self) -> f64 {
        self.0.borrow().grad
    }

    pub fn op(&self) -> Op {
        self.0.borrow().op
    }

    pub fn set_grad(&self, g: f64) {
        self.0.borrow_mut().grad = g;
    }

    pub fn add_grad(&self, g: f64) {
        self.0.borrow_mut().grad += g;
    }

    pub fn parents(&self) -> Vec<Value> {
        self.0.borrow().prev.clone()
    }

    pub fn same_node(&self, other: &Value) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }

    pub fn tanh(&self) -> Value {
        Value::from_op(self.data().tanh(), Op::Tanh, vec![self.clone()])
    }

    pub fn topo(&self) -> Vec<Value> {
        let mut seen: HashSet<usize> = HashSet::new();
        let mut out: Vec<Value> = Vec::new();
        self.visit(&mut seen, &mut out);
        out
    }

    fn visit(&self, seen: &mut HashSet<usize>, out: &mut Vec<Value>) {
        if !seen.insert(Rc::as_ptr(&self.0) as usize) {
            return;
        }
        for p in self.parents() {
            p.visit(seen, out);
        }
        out.push(self.clone());
    }

    pub fn backward(&self) {
        let order = self.topo();
        self.set_grad(1.0);
        for v in order.iter().rev() {
            v.push_grad();
        }
    }

    fn push_grad(&self) {
        let (op, grad, prev) = {
            let n = self.0.borrow();
            (n.op, n.grad, n.prev.clone())
        };
        match op {
            Op::Leaf => {}
            Op::Add => {
                prev[0].add_grad(grad);
                prev[1].add_grad(grad);
            }
            Op::Mul => {
                let (a, b) = (prev[0].data(), prev[1].data());
                prev[0].add_grad(b * grad);
                prev[1].add_grad(a * grad);
            }
            Op::Tanh => {
                prev[0].add_grad((1.0 - t * t) * grad);
            }
        }
    }
}

impl std::ops::Add for &Value {
    type Output = Value;
    fn add(self, rhs: &Value) -> Value {
        Value::from_op(self.data() + rhs.data(), Op::Add, vec![self.clone(), rhs.clone()])
    }
}

impl std::ops::Mul for &Value {
    type Output = Value;
    fn mul(self, rhs: &Value) -> Value {
        Value::from_op(self.data() * rhs.data(), Op::Mul, vec![self.clone(), rhs.clone()])
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn tanh_squashes_into_minus_one_to_one() {
        assert!(close(Value::new(0.0).tanh().data(), 0.0));
        let big = Value::new(3.0).tanh().data();
        assert!(big < 1.0 && big > 0.99);
        let small = Value::new(-3.0).tanh().data();
        assert!(small > -1.0 && small < -0.99);
    }

    #[test]
    fn the_derivative_is_one_minus_t_squared() {
        let a = Value::new(0.8);
        let t = a.tanh();
        t.backward();
        assert!(close(a.grad(), 1.0 - t.data() * t.data()));
    }

    #[test]
    fn the_gradient_flows_on_through_the_bend() {
        let w = Value::new(0.5);
        let x = Value::new(2.0);
        let b = Value::new(-1.0);
        let y = (&(&w * &x) + &b).tanh();
        y.backward();
        let d = 1.0 - y.data() * y.data();
        assert!(close(w.grad(), 2.0 * d));
        assert!(close(x.grad(), 0.5 * d));
        assert!(close(b.grad(), d));
    }

    #[test]
    fn two_linear_layers_collapse_into_one() {
        let x = Value::new(1.7);
        let w1 = Value::new(0.5);
        let b1 = Value::new(-0.25);
        let w2 = Value::new(-1.5);
        let b2 = Value::new(0.75);

        let stacked = &(&w2 * &(&(&w1 * &x) + &b1)) + &b2;

        let w = &w2 * &w1;
        let b = &(&w2 * &b1) + &b2;
        let single = &(&w * &x) + &b;

        assert!(close(stacked.data(), single.data()));
    }
}
```

```solution
use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Op {
    Leaf,
    Add,
    Mul,
    Tanh,
}

pub struct Node {
    pub data: f64,
    pub grad: f64,
    pub op: Op,
    pub prev: Vec<Value>,
}

#[derive(Clone)]
pub struct Value(pub Rc<RefCell<Node>>);

impl Value {
    pub fn new(data: f64) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op: Op::Leaf, prev: Vec::new() })))
    }

    pub fn from_op(data: f64, op: Op, prev: Vec<Value>) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op, prev })))
    }

    pub fn data(&self) -> f64 {
        self.0.borrow().data
    }

    pub fn grad(&self) -> f64 {
        self.0.borrow().grad
    }

    pub fn op(&self) -> Op {
        self.0.borrow().op
    }

    pub fn set_grad(&self, g: f64) {
        self.0.borrow_mut().grad = g;
    }

    pub fn add_grad(&self, g: f64) {
        self.0.borrow_mut().grad += g;
    }

    pub fn parents(&self) -> Vec<Value> {
        self.0.borrow().prev.clone()
    }

    pub fn same_node(&self, other: &Value) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }

    pub fn tanh(&self) -> Value {
        Value::from_op(self.data().tanh(), Op::Tanh, vec![self.clone()])
    }

    pub fn topo(&self) -> Vec<Value> {
        let mut seen: HashSet<usize> = HashSet::new();
        let mut out: Vec<Value> = Vec::new();
        self.visit(&mut seen, &mut out);
        out
    }

    fn visit(&self, seen: &mut HashSet<usize>, out: &mut Vec<Value>) {
        if !seen.insert(Rc::as_ptr(&self.0) as usize) {
            return;
        }
        for p in self.parents() {
            p.visit(seen, out);
        }
        out.push(self.clone());
    }

    pub fn backward(&self) {
        let order = self.topo();
        self.set_grad(1.0);
        for v in order.iter().rev() {
            v.push_grad();
        }
    }

    fn push_grad(&self) {
        let (op, t, grad, prev) = {
            let n = self.0.borrow();
            (n.op, n.data, n.grad, n.prev.clone())
        };
        match op {
            Op::Leaf => {}
            Op::Add => {
                prev[0].add_grad(grad);
                prev[1].add_grad(grad);
            }
            Op::Mul => {
                let (a, b) = (prev[0].data(), prev[1].data());
                prev[0].add_grad(b * grad);
                prev[1].add_grad(a * grad);
            }
            Op::Tanh => {
                prev[0].add_grad((1.0 - t * t) * grad);
            }
        }
    }
}

impl std::ops::Add for &Value {
    type Output = Value;
    fn add(self, rhs: &Value) -> Value {
        Value::from_op(self.data() + rhs.data(), Op::Add, vec![self.clone(), rhs.clone()])
    }
}

impl std::ops::Mul for &Value {
    type Output = Value;
    fn mul(self, rhs: &Value) -> Value {
        Value::from_op(self.data() * rhs.data(), Op::Mul, vec![self.clone(), rhs.clone()])
    }
}
```

@hint `t` is the output of the tanh, which is this node's own `data`. The other arms never needed it, so the destructuring at the top of `push_grad` never pulled it out.
@hint Widen the tuple that comes out of the borrow block to four elements and take `n.data` along with the rest.
@hint `let (op, t, grad, prev) = { let n = self.0.borrow(); (n.op, n.data, n.grad, n.prev.clone()) };`

@diagnose E0425
`cannot find value t in this scope`. The tanh arm needs the node's forward
output, and `push_grad` deliberately copies everything it needs out of the
`RefCell` in one short block so the borrow is released before any parent is
touched. `t` was simply not on the list.

Take `n.data` inside that block. Reading it later, with `self.data()`, would
work too but re-borrows the cell for no reason, and the point of the block is to
make the borrow's lifetime obvious at a glance.

@diagnose E0004
You added `Tanh` to `Op` and the `match` in `push_grad` no longer covers every
variant. That is the compiler doing the job you gave it in stage 4: one enum,
one match, and adding an operator forces you to state its derivative.

@after
Storing `1 - t * t` in terms of the **output** rather than the input is the
reason tanh was the standard nonlinearity for decades. The backward pass already
has `t` sitting in the node, so the derivative costs one multiply and no calls
to `exp`.

The last test is the argument for having a nonlinearity at all. Two linear
layers compose to `w2 * (w1 * x + b1) + b2`, which is `(w2 * w1) * x + (w2 * b1
+ b2)`: a single linear layer with different constants. Stack fifty of them and
it is still one line. Every bit of expressive power a deep network has comes
from the bend between the layers.

## 6. A neuron, then a row of them

@kind fix
@concept ownership
@expect E0507

A neuron holds one weight per input plus a bias, and computes
`tanh(w1*x1 + w2*x2 + ... + b)`. A layer is a row of neurons, all reading the
same inputs and each producing one output.

`forward` starts from the bias and cannot. Fix it, and notice what the fix costs.

```starter
use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Op {
    Leaf,
    Add,
    Mul,
    Tanh,
}

pub struct Node {
    pub data: f64,
    pub grad: f64,
    pub op: Op,
    pub prev: Vec<Value>,
}

#[derive(Clone)]
pub struct Value(pub Rc<RefCell<Node>>);

impl Value {
    pub fn new(data: f64) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op: Op::Leaf, prev: Vec::new() })))
    }

    pub fn from_op(data: f64, op: Op, prev: Vec<Value>) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op, prev })))
    }

    pub fn data(&self) -> f64 {
        self.0.borrow().data
    }

    pub fn grad(&self) -> f64 {
        self.0.borrow().grad
    }

    pub fn op(&self) -> Op {
        self.0.borrow().op
    }

    pub fn set_grad(&self, g: f64) {
        self.0.borrow_mut().grad = g;
    }

    pub fn add_grad(&self, g: f64) {
        self.0.borrow_mut().grad += g;
    }

    pub fn parents(&self) -> Vec<Value> {
        self.0.borrow().prev.clone()
    }

    pub fn same_node(&self, other: &Value) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }

    pub fn tanh(&self) -> Value {
        Value::from_op(self.data().tanh(), Op::Tanh, vec![self.clone()])
    }

    pub fn topo(&self) -> Vec<Value> {
        let mut seen: HashSet<usize> = HashSet::new();
        let mut out: Vec<Value> = Vec::new();
        self.visit(&mut seen, &mut out);
        out
    }

    fn visit(&self, seen: &mut HashSet<usize>, out: &mut Vec<Value>) {
        if !seen.insert(Rc::as_ptr(&self.0) as usize) {
            return;
        }
        for p in self.parents() {
            p.visit(seen, out);
        }
        out.push(self.clone());
    }

    pub fn backward(&self) {
        let order = self.topo();
        self.set_grad(1.0);
        for v in order.iter().rev() {
            v.push_grad();
        }
    }

    fn push_grad(&self) {
        let (op, t, grad, prev) = {
            let n = self.0.borrow();
            (n.op, n.data, n.grad, n.prev.clone())
        };
        match op {
            Op::Leaf => {}
            Op::Add => {
                prev[0].add_grad(grad);
                prev[1].add_grad(grad);
            }
            Op::Mul => {
                let (a, b) = (prev[0].data(), prev[1].data());
                prev[0].add_grad(b * grad);
                prev[1].add_grad(a * grad);
            }
            Op::Tanh => {
                prev[0].add_grad((1.0 - t * t) * grad);
            }
        }
    }
}

impl std::ops::Add for &Value {
    type Output = Value;
    fn add(self, rhs: &Value) -> Value {
        Value::from_op(self.data() + rhs.data(), Op::Add, vec![self.clone(), rhs.clone()])
    }
}

impl std::ops::Mul for &Value {
    type Output = Value;
    fn mul(self, rhs: &Value) -> Value {
        Value::from_op(self.data() * rhs.data(), Op::Mul, vec![self.clone(), rhs.clone()])
    }
}

pub struct Lcg(pub u64);

impl Lcg {
    pub fn new(seed: u64) -> Lcg {
        Lcg(seed)
    }

    /// A number in (-1, 1), from the same linear congruential generator
    /// Knuth used. Same seed, same sequence, every run.
    pub fn next_f64(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((self.0 >> 11) as f64) / ((1u64 << 53) as f64) * 2.0 - 1.0
    }
}

pub struct Neuron {
    pub w: Vec<Value>,
    pub b: Value,
}

impl Neuron {
    pub fn new(nin: usize, rng: &mut Lcg) -> Neuron {
        Neuron {
            w: (0..nin).map(|_| Value::new(rng.next_f64())).collect(),
            b: Value::new(0.0),
        }
    }

    pub fn forward(&self, xs: &[Value]) -> Value {
        let mut sum = self.b;
        for (w, x) in self.w.iter().zip(xs) {
            sum = &sum + &(w * x);
        }
        sum.tanh()
    }

    pub fn parameters(&self) -> Vec<Value> {
        let mut ps = self.w.clone();
        ps.push(self.b.clone());
        ps
    }
}

pub struct Layer {
    pub neurons: Vec<Neuron>,
}

impl Layer {
    pub fn new(nin: usize, nout: usize, rng: &mut Lcg) -> Layer {
        Layer { neurons: (0..nout).map(|_| Neuron::new(nin, rng)).collect() }
    }

    pub fn forward(&self, xs: &[Value]) -> Vec<Value> {
        self.neurons.iter().map(|n| n.forward(xs)).collect()
    }

    pub fn parameters(&self) -> Vec<Value> {
        self.neurons.iter().flat_map(|n| n.parameters()).collect()
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn the_generator_repeats_for_a_given_seed() {
        let mut a = Lcg::new(7);
        let mut b = Lcg::new(7);
        for _ in 0..5 {
            let x = a.next_f64();
            assert!(close(x, b.next_f64()));
            assert!(x > -1.0 && x < 1.0);
        }
    }

    #[test]
    fn a_neuron_has_one_weight_per_input_and_a_bias() {
        let mut rng = Lcg::new(7);
        let n = Neuron::new(3, &mut rng);
        assert_eq!(n.w.len(), 3);
        assert_eq!(n.parameters().len(), 4);
    }

    #[test]
    fn a_neuron_output_is_squashed_and_differentiable() {
        let mut rng = Lcg::new(7);
        let n = Neuron::new(2, &mut rng);
        let xs = vec![Value::new(1.0), Value::new(-1.0)];
        let out = n.forward(&xs);
        assert!(out.data() > -1.0 && out.data() < 1.0);

        out.backward();
        let d = 1.0 - out.data() * out.data();
        assert!(close(n.w[0].grad(), d));
        assert!(close(n.w[1].grad(), -d));
        assert!(close(n.b.grad(), d));
    }

    #[test]
    fn a_layer_is_a_row_of_neurons_reading_the_same_inputs() {
        let mut rng = Lcg::new(7);
        let l = Layer::new(2, 3, &mut rng);
        let xs = vec![Value::new(0.5), Value::new(-0.5)];
        assert_eq!(l.forward(&xs).len(), 3);
        assert_eq!(l.parameters().len(), 9);
    }
}
```

```solution
use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Op {
    Leaf,
    Add,
    Mul,
    Tanh,
}

pub struct Node {
    pub data: f64,
    pub grad: f64,
    pub op: Op,
    pub prev: Vec<Value>,
}

#[derive(Clone)]
pub struct Value(pub Rc<RefCell<Node>>);

impl Value {
    pub fn new(data: f64) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op: Op::Leaf, prev: Vec::new() })))
    }

    pub fn from_op(data: f64, op: Op, prev: Vec<Value>) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op, prev })))
    }

    pub fn data(&self) -> f64 {
        self.0.borrow().data
    }

    pub fn grad(&self) -> f64 {
        self.0.borrow().grad
    }

    pub fn op(&self) -> Op {
        self.0.borrow().op
    }

    pub fn set_grad(&self, g: f64) {
        self.0.borrow_mut().grad = g;
    }

    pub fn add_grad(&self, g: f64) {
        self.0.borrow_mut().grad += g;
    }

    pub fn parents(&self) -> Vec<Value> {
        self.0.borrow().prev.clone()
    }

    pub fn same_node(&self, other: &Value) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }

    pub fn tanh(&self) -> Value {
        Value::from_op(self.data().tanh(), Op::Tanh, vec![self.clone()])
    }

    pub fn topo(&self) -> Vec<Value> {
        let mut seen: HashSet<usize> = HashSet::new();
        let mut out: Vec<Value> = Vec::new();
        self.visit(&mut seen, &mut out);
        out
    }

    fn visit(&self, seen: &mut HashSet<usize>, out: &mut Vec<Value>) {
        if !seen.insert(Rc::as_ptr(&self.0) as usize) {
            return;
        }
        for p in self.parents() {
            p.visit(seen, out);
        }
        out.push(self.clone());
    }

    pub fn backward(&self) {
        let order = self.topo();
        self.set_grad(1.0);
        for v in order.iter().rev() {
            v.push_grad();
        }
    }

    fn push_grad(&self) {
        let (op, t, grad, prev) = {
            let n = self.0.borrow();
            (n.op, n.data, n.grad, n.prev.clone())
        };
        match op {
            Op::Leaf => {}
            Op::Add => {
                prev[0].add_grad(grad);
                prev[1].add_grad(grad);
            }
            Op::Mul => {
                let (a, b) = (prev[0].data(), prev[1].data());
                prev[0].add_grad(b * grad);
                prev[1].add_grad(a * grad);
            }
            Op::Tanh => {
                prev[0].add_grad((1.0 - t * t) * grad);
            }
        }
    }
}

impl std::ops::Add for &Value {
    type Output = Value;
    fn add(self, rhs: &Value) -> Value {
        Value::from_op(self.data() + rhs.data(), Op::Add, vec![self.clone(), rhs.clone()])
    }
}

impl std::ops::Mul for &Value {
    type Output = Value;
    fn mul(self, rhs: &Value) -> Value {
        Value::from_op(self.data() * rhs.data(), Op::Mul, vec![self.clone(), rhs.clone()])
    }
}

pub struct Lcg(pub u64);

impl Lcg {
    pub fn new(seed: u64) -> Lcg {
        Lcg(seed)
    }

    /// A number in (-1, 1), from the same linear congruential generator
    /// Knuth used. Same seed, same sequence, every run.
    pub fn next_f64(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((self.0 >> 11) as f64) / ((1u64 << 53) as f64) * 2.0 - 1.0
    }
}

pub struct Neuron {
    pub w: Vec<Value>,
    pub b: Value,
}

impl Neuron {
    pub fn new(nin: usize, rng: &mut Lcg) -> Neuron {
        Neuron {
            w: (0..nin).map(|_| Value::new(rng.next_f64())).collect(),
            b: Value::new(0.0),
        }
    }

    pub fn forward(&self, xs: &[Value]) -> Value {
        let mut sum = self.b.clone();
        for (w, x) in self.w.iter().zip(xs) {
            sum = &sum + &(w * x);
        }
        sum.tanh()
    }

    pub fn parameters(&self) -> Vec<Value> {
        let mut ps = self.w.clone();
        ps.push(self.b.clone());
        ps
    }
}

pub struct Layer {
    pub neurons: Vec<Neuron>,
}

impl Layer {
    pub fn new(nin: usize, nout: usize, rng: &mut Lcg) -> Layer {
        Layer { neurons: (0..nout).map(|_| Neuron::new(nin, rng)).collect() }
    }

    pub fn forward(&self, xs: &[Value]) -> Vec<Value> {
        self.neurons.iter().map(|n| n.forward(xs)).collect()
    }

    pub fn parameters(&self) -> Vec<Value> {
        self.neurons.iter().flat_map(|n| n.parameters()).collect()
    }
}
```

@hint `forward` takes `&self`, so the neuron is borrowed, and `self.b` is a field of a borrowed struct. Moving it out would leave the neuron with a hole in it.
@hint You want a second handle to the same bias node, not a second bias. Which method on `Value` gives you that, and what does it actually copy?
@hint `let mut sum = self.b.clone();` A `Value` is a reference-counted handle, so the clone is a counter increment and both handles point at the one node.

@diagnose E0507
`cannot move out of self.b which is behind a shared reference`. `forward` only
borrowed the neuron, and moving the bias out would destroy a struct the caller
still owns. The compiler stops it before the neuron is half-empty.

`clone()` is the right answer here for a reason worth stating precisely. Cloning
a `Value` clones the `Rc`, which increments a count and copies a pointer. It
does not copy the `Node`, so the bias node in the graph is still one node, and
the gradient the backward pass writes into it lands where `self.b` can see it.
This is the one situation where reaching for `clone` is not a retreat.

@diagnose E0382
Same cause, different shape: you assigned the bias into `sum` and then used
`self.b` again, or moved it inside a loop that runs more than once. `clone` the
handle each time you need one.

@after
The layer is four lines because the graph does the work. `Layer::forward` maps
each neuron over the same input slice, and every neuron clones handles to those
same input nodes, so one input node ends up as a parent of every neuron in the
layer. When the backward pass reaches it, the accumulate in `add_grad` sums all
those contributions.

`Lcg` is ten lines and deterministic, which matters more here than statistical
quality. A test that trains a network is only a test if the same seed gives the
same run.

## 7. A network, a loss, and one step downhill

@kind fix
@concept closure
@expect E0277

An `Mlp` chains layers, feeding each layer's outputs into the next. The loss is
mean squared error: average the squared gap between each prediction and its
target. Then one step of gradient descent nudges every parameter against its
gradient.

`mse` will not compile. Build the total a different way.

```starter
use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Op {
    Leaf,
    Add,
    Mul,
    Tanh,
}

pub struct Node {
    pub data: f64,
    pub grad: f64,
    pub op: Op,
    pub prev: Vec<Value>,
}

#[derive(Clone)]
pub struct Value(pub Rc<RefCell<Node>>);

impl Value {
    pub fn new(data: f64) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op: Op::Leaf, prev: Vec::new() })))
    }

    pub fn from_op(data: f64, op: Op, prev: Vec<Value>) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op, prev })))
    }

    pub fn data(&self) -> f64 {
        self.0.borrow().data
    }

    pub fn grad(&self) -> f64 {
        self.0.borrow().grad
    }

    pub fn op(&self) -> Op {
        self.0.borrow().op
    }

    pub fn set_grad(&self, g: f64) {
        self.0.borrow_mut().grad = g;
    }

    pub fn add_grad(&self, g: f64) {
        self.0.borrow_mut().grad += g;
    }

    pub fn parents(&self) -> Vec<Value> {
        self.0.borrow().prev.clone()
    }

    pub fn same_node(&self, other: &Value) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }

    pub fn tanh(&self) -> Value {
        Value::from_op(self.data().tanh(), Op::Tanh, vec![self.clone()])
    }

    pub fn topo(&self) -> Vec<Value> {
        let mut seen: HashSet<usize> = HashSet::new();
        let mut out: Vec<Value> = Vec::new();
        self.visit(&mut seen, &mut out);
        out
    }

    fn visit(&self, seen: &mut HashSet<usize>, out: &mut Vec<Value>) {
        if !seen.insert(Rc::as_ptr(&self.0) as usize) {
            return;
        }
        for p in self.parents() {
            p.visit(seen, out);
        }
        out.push(self.clone());
    }

    pub fn backward(&self) {
        let order = self.topo();
        self.set_grad(1.0);
        for v in order.iter().rev() {
            v.push_grad();
        }
    }

    fn push_grad(&self) {
        let (op, t, grad, prev) = {
            let n = self.0.borrow();
            (n.op, n.data, n.grad, n.prev.clone())
        };
        match op {
            Op::Leaf => {}
            Op::Add => {
                prev[0].add_grad(grad);
                prev[1].add_grad(grad);
            }
            Op::Mul => {
                let (a, b) = (prev[0].data(), prev[1].data());
                prev[0].add_grad(b * grad);
                prev[1].add_grad(a * grad);
            }
            Op::Tanh => {
                prev[0].add_grad((1.0 - t * t) * grad);
            }
        }
    }
}

impl std::ops::Add for &Value {
    type Output = Value;
    fn add(self, rhs: &Value) -> Value {
        Value::from_op(self.data() + rhs.data(), Op::Add, vec![self.clone(), rhs.clone()])
    }
}

impl std::ops::Mul for &Value {
    type Output = Value;
    fn mul(self, rhs: &Value) -> Value {
        Value::from_op(self.data() * rhs.data(), Op::Mul, vec![self.clone(), rhs.clone()])
    }
}

pub struct Lcg(pub u64);

impl Lcg {
    pub fn new(seed: u64) -> Lcg {
        Lcg(seed)
    }

    /// A number in (-1, 1), from the same linear congruential generator
    /// Knuth used. Same seed, same sequence, every run.
    pub fn next_f64(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((self.0 >> 11) as f64) / ((1u64 << 53) as f64) * 2.0 - 1.0
    }
}

pub struct Neuron {
    pub w: Vec<Value>,
    pub b: Value,
}

impl Neuron {
    pub fn new(nin: usize, rng: &mut Lcg) -> Neuron {
        Neuron {
            w: (0..nin).map(|_| Value::new(rng.next_f64())).collect(),
            b: Value::new(0.0),
        }
    }

    pub fn forward(&self, xs: &[Value]) -> Value {
        let mut sum = self.b.clone();
        for (w, x) in self.w.iter().zip(xs) {
            sum = &sum + &(w * x);
        }
        sum.tanh()
    }

    pub fn parameters(&self) -> Vec<Value> {
        let mut ps = self.w.clone();
        ps.push(self.b.clone());
        ps
    }
}

pub struct Layer {
    pub neurons: Vec<Neuron>,
}

impl Layer {
    pub fn new(nin: usize, nout: usize, rng: &mut Lcg) -> Layer {
        Layer { neurons: (0..nout).map(|_| Neuron::new(nin, rng)).collect() }
    }

    pub fn forward(&self, xs: &[Value]) -> Vec<Value> {
        self.neurons.iter().map(|n| n.forward(xs)).collect()
    }

    pub fn parameters(&self) -> Vec<Value> {
        self.neurons.iter().flat_map(|n| n.parameters()).collect()
    }
}

pub struct Mlp {
    pub layers: Vec<Layer>,
}

impl Mlp {
    pub fn new(sizes: &[usize], rng: &mut Lcg) -> Mlp {
        Mlp { layers: sizes.windows(2).map(|w| Layer::new(w[0], w[1], rng)).collect() }
    }

    pub fn forward(&self, xs: &[Value]) -> Vec<Value> {
        let mut out = xs.to_vec();
        for l in &self.layers {
            out = l.forward(&out);
        }
        out
    }

    pub fn parameters(&self) -> Vec<Value> {
        self.layers.iter().flat_map(|l| l.parameters()).collect()
    }
}

pub fn mse(preds: &[Value], targets: &[f64]) -> Value {
    let total: Value = preds
        .iter()
        .zip(targets)
        .map(|(p, t)| {
            let d = p + &Value::new(-t);
            &d * &d
        })
        .sum();
    &total * &Value::new(1.0 / preds.len() as f64)
}

pub fn zero_grad(params: &[Value]) {
    for p in params {
        p.set_grad(0.0);
    }
}

pub fn descend(params: &[Value], lr: f64) {
    for p in params {
        let g = p.grad();
        p.0.borrow_mut().data -= lr * g;
    }
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn an_mlp_chains_its_layers() {
        let mut rng = Lcg::new(1234);
        let net = Mlp::new(&[2, 4, 1], &mut rng);
        assert_eq!(net.layers.len(), 2);
        assert_eq!(net.parameters().len(), 17);
        let xs = vec![Value::new(1.0), Value::new(-1.0)];
        assert_eq!(net.forward(&xs).len(), 1);
    }

    #[test]
    fn a_perfect_prediction_costs_nothing() {
        let preds = vec![Value::new(0.5), Value::new(-0.5)];
        assert!(close(mse(&preds, &[0.5, -0.5]).data(), 0.0));
    }

    #[test]
    fn the_loss_gradient_points_at_the_target() {
        let p = Value::new(0.5);
        let loss = mse(&[p.clone()], &[-1.0]);
        assert!(close(loss.data(), 2.25));
        loss.backward();
        assert!(close(p.grad(), 3.0));
    }

    #[test]
    fn one_step_downhill_lowers_the_loss() {
        let mut rng = Lcg::new(1234);
        let net = Mlp::new(&[2, 4, 1], &mut rng);
        let params = net.parameters();
        let xs = vec![Value::new(1.0), Value::new(-1.0)];

        let before = mse(&net.forward(&xs), &[1.0]).data();
        let loss = mse(&net.forward(&xs), &[1.0]);
        zero_grad(&params);
        loss.backward();
        descend(&params, 0.1);
        let after = mse(&net.forward(&xs), &[1.0]).data();

        assert!(after < before, "loss went from {before} to {after}");
    }

    #[test]
    fn gradients_pile_up_until_you_zero_them() {
        let a = Value::new(3.0);
        let b = Value::new(4.0);
        let c = &a * &b;

        c.backward();
        assert!(close(a.grad(), 4.0));

        c.backward();
        assert!(close(a.grad(), 8.0));

        zero_grad(&[a.clone(), b.clone(), c.clone()]);
        c.backward();
        assert!(close(a.grad(), 4.0));
    }
}
```

```solution
use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Op {
    Leaf,
    Add,
    Mul,
    Tanh,
}

pub struct Node {
    pub data: f64,
    pub grad: f64,
    pub op: Op,
    pub prev: Vec<Value>,
}

#[derive(Clone)]
pub struct Value(pub Rc<RefCell<Node>>);

impl Value {
    pub fn new(data: f64) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op: Op::Leaf, prev: Vec::new() })))
    }

    pub fn from_op(data: f64, op: Op, prev: Vec<Value>) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op, prev })))
    }

    pub fn data(&self) -> f64 {
        self.0.borrow().data
    }

    pub fn grad(&self) -> f64 {
        self.0.borrow().grad
    }

    pub fn op(&self) -> Op {
        self.0.borrow().op
    }

    pub fn set_grad(&self, g: f64) {
        self.0.borrow_mut().grad = g;
    }

    pub fn add_grad(&self, g: f64) {
        self.0.borrow_mut().grad += g;
    }

    pub fn parents(&self) -> Vec<Value> {
        self.0.borrow().prev.clone()
    }

    pub fn same_node(&self, other: &Value) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }

    pub fn tanh(&self) -> Value {
        Value::from_op(self.data().tanh(), Op::Tanh, vec![self.clone()])
    }

    pub fn topo(&self) -> Vec<Value> {
        let mut seen: HashSet<usize> = HashSet::new();
        let mut out: Vec<Value> = Vec::new();
        self.visit(&mut seen, &mut out);
        out
    }

    fn visit(&self, seen: &mut HashSet<usize>, out: &mut Vec<Value>) {
        if !seen.insert(Rc::as_ptr(&self.0) as usize) {
            return;
        }
        for p in self.parents() {
            p.visit(seen, out);
        }
        out.push(self.clone());
    }

    pub fn backward(&self) {
        let order = self.topo();
        self.set_grad(1.0);
        for v in order.iter().rev() {
            v.push_grad();
        }
    }

    fn push_grad(&self) {
        let (op, t, grad, prev) = {
            let n = self.0.borrow();
            (n.op, n.data, n.grad, n.prev.clone())
        };
        match op {
            Op::Leaf => {}
            Op::Add => {
                prev[0].add_grad(grad);
                prev[1].add_grad(grad);
            }
            Op::Mul => {
                let (a, b) = (prev[0].data(), prev[1].data());
                prev[0].add_grad(b * grad);
                prev[1].add_grad(a * grad);
            }
            Op::Tanh => {
                prev[0].add_grad((1.0 - t * t) * grad);
            }
        }
    }
}

impl std::ops::Add for &Value {
    type Output = Value;
    fn add(self, rhs: &Value) -> Value {
        Value::from_op(self.data() + rhs.data(), Op::Add, vec![self.clone(), rhs.clone()])
    }
}

impl std::ops::Mul for &Value {
    type Output = Value;
    fn mul(self, rhs: &Value) -> Value {
        Value::from_op(self.data() * rhs.data(), Op::Mul, vec![self.clone(), rhs.clone()])
    }
}

pub struct Lcg(pub u64);

impl Lcg {
    pub fn new(seed: u64) -> Lcg {
        Lcg(seed)
    }

    /// A number in (-1, 1), from the same linear congruential generator
    /// Knuth used. Same seed, same sequence, every run.
    pub fn next_f64(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((self.0 >> 11) as f64) / ((1u64 << 53) as f64) * 2.0 - 1.0
    }
}

pub struct Neuron {
    pub w: Vec<Value>,
    pub b: Value,
}

impl Neuron {
    pub fn new(nin: usize, rng: &mut Lcg) -> Neuron {
        Neuron {
            w: (0..nin).map(|_| Value::new(rng.next_f64())).collect(),
            b: Value::new(0.0),
        }
    }

    pub fn forward(&self, xs: &[Value]) -> Value {
        let mut sum = self.b.clone();
        for (w, x) in self.w.iter().zip(xs) {
            sum = &sum + &(w * x);
        }
        sum.tanh()
    }

    pub fn parameters(&self) -> Vec<Value> {
        let mut ps = self.w.clone();
        ps.push(self.b.clone());
        ps
    }
}

pub struct Layer {
    pub neurons: Vec<Neuron>,
}

impl Layer {
    pub fn new(nin: usize, nout: usize, rng: &mut Lcg) -> Layer {
        Layer { neurons: (0..nout).map(|_| Neuron::new(nin, rng)).collect() }
    }

    pub fn forward(&self, xs: &[Value]) -> Vec<Value> {
        self.neurons.iter().map(|n| n.forward(xs)).collect()
    }

    pub fn parameters(&self) -> Vec<Value> {
        self.neurons.iter().flat_map(|n| n.parameters()).collect()
    }
}

pub struct Mlp {
    pub layers: Vec<Layer>,
}

impl Mlp {
    pub fn new(sizes: &[usize], rng: &mut Lcg) -> Mlp {
        Mlp { layers: sizes.windows(2).map(|w| Layer::new(w[0], w[1], rng)).collect() }
    }

    pub fn forward(&self, xs: &[Value]) -> Vec<Value> {
        let mut out = xs.to_vec();
        for l in &self.layers {
            out = l.forward(&out);
        }
        out
    }

    pub fn parameters(&self) -> Vec<Value> {
        self.layers.iter().flat_map(|l| l.parameters()).collect()
    }
}

pub fn mse(preds: &[Value], targets: &[f64]) -> Value {
    let mut total = Value::new(0.0);
    for (p, t) in preds.iter().zip(targets) {
        let d = p + &Value::new(-t);
        total = &total + &(&d * &d);
    }
    &total * &Value::new(1.0 / preds.len() as f64)
}

pub fn zero_grad(params: &[Value]) {
    for p in params {
        p.set_grad(0.0);
    }
}

pub fn descend(params: &[Value], lr: f64) {
    for p in params {
        let g = p.grad();
        p.0.borrow_mut().data -= lr * g;
    }
}
```

@hint `sum()` needs a type that knows what an empty sum is and how to add two of itself by value. `Value` has neither.
@hint Start from a node holding zero and fold the squared gaps into it one at a time. A plain `for` loop over `preds.iter().zip(targets)` is the clearest way.
@hint `let mut total = Value::new(0.0);` then inside the loop `let d = p + &Value::new(-t); total = &total + &(&d * &d);` and afterwards multiply by `1.0 / preds.len() as f64`.

@diagnose E0277
`the trait bound Value: Sum<Value> is not satisfied`. `Iterator::sum` is generic
over `Sum`, which needs an identity element (`Value::new(0.0)` would do) and an
`Add` impl that takes both sides **by value**. You implemented `Add` for
`&Value` on purpose, so `Sum` cannot use it.

You could write the `Sum` impl. The loop is shorter and it makes something else
visible: `total` is not a running number, it is a growing chain of `Op::Add`
nodes, one per example, each holding a handle to the one before. The loss is the
root of that chain and `backward` walks all of it.

@diagnose E0369
`cannot add &Value to &f64` or similar. A target is a plain `f64`, not a node, so
it has to be lifted into the graph before it can take part: `&Value::new(-t)`.
Note `t` is a `&f64` here because `zip` over a slice yields references, and `-t`
on a `&f64` gives you an `f64`.

@diagnose E0308
`mse` must return a `Value`, and the last expression is the mean, so it is
`&total * &Value::new(1.0 / preds.len() as f64)` with no semicolon after it.

@after
The last test is the one to remember. `backward` **adds** into every gradient,
because a node feeding two places must collect both contributions. That
accumulation does not know where one training step ends and the next begins, so
if you never zero, step ten descends along the sum of the first ten gradients.

On a problem this small the sum happens to point roughly the same way each time
and the run survives, which is precisely why the bug is so hard to catch: it
looks like a slightly odd learning rate, not a failure. On a real model, with
mini-batches drawn from different data, the stale gradients are pulling towards
examples the model has already moved past, and the loss either stalls or goes to
`NaN`. `zero_grad` before every `backward` is not optional hygiene; PyTorch makes
you write `optimizer.zero_grad()` by hand for the same reason.

## 8. XOR, and a loss you can watch fall

@kind fill
@concept borrow
@expect E0596

XOR is the classic proof that depth matters: no single linear boundary separates
the two positive corners from the two negative ones. A `[2, 4, 1]` network with a
bend in the middle can do it.

The loop below measures the loss and computes gradients, then ignores them. Add
the update, and fix the binding rustc objects to.

```starter
use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Op {
    Leaf,
    Add,
    Mul,
    Tanh,
}

pub struct Node {
    pub data: f64,
    pub grad: f64,
    pub op: Op,
    pub prev: Vec<Value>,
}

#[derive(Clone)]
pub struct Value(pub Rc<RefCell<Node>>);

impl Value {
    pub fn new(data: f64) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op: Op::Leaf, prev: Vec::new() })))
    }

    pub fn from_op(data: f64, op: Op, prev: Vec<Value>) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op, prev })))
    }

    pub fn data(&self) -> f64 {
        self.0.borrow().data
    }

    pub fn grad(&self) -> f64 {
        self.0.borrow().grad
    }

    pub fn op(&self) -> Op {
        self.0.borrow().op
    }

    pub fn set_grad(&self, g: f64) {
        self.0.borrow_mut().grad = g;
    }

    pub fn add_grad(&self, g: f64) {
        self.0.borrow_mut().grad += g;
    }

    pub fn parents(&self) -> Vec<Value> {
        self.0.borrow().prev.clone()
    }

    pub fn same_node(&self, other: &Value) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }

    pub fn tanh(&self) -> Value {
        Value::from_op(self.data().tanh(), Op::Tanh, vec![self.clone()])
    }

    pub fn topo(&self) -> Vec<Value> {
        let mut seen: HashSet<usize> = HashSet::new();
        let mut out: Vec<Value> = Vec::new();
        self.visit(&mut seen, &mut out);
        out
    }

    fn visit(&self, seen: &mut HashSet<usize>, out: &mut Vec<Value>) {
        if !seen.insert(Rc::as_ptr(&self.0) as usize) {
            return;
        }
        for p in self.parents() {
            p.visit(seen, out);
        }
        out.push(self.clone());
    }

    pub fn backward(&self) {
        let order = self.topo();
        self.set_grad(1.0);
        for v in order.iter().rev() {
            v.push_grad();
        }
    }

    fn push_grad(&self) {
        let (op, t, grad, prev) = {
            let n = self.0.borrow();
            (n.op, n.data, n.grad, n.prev.clone())
        };
        match op {
            Op::Leaf => {}
            Op::Add => {
                prev[0].add_grad(grad);
                prev[1].add_grad(grad);
            }
            Op::Mul => {
                let (a, b) = (prev[0].data(), prev[1].data());
                prev[0].add_grad(b * grad);
                prev[1].add_grad(a * grad);
            }
            Op::Tanh => {
                prev[0].add_grad((1.0 - t * t) * grad);
            }
        }
    }
}

impl std::ops::Add for &Value {
    type Output = Value;
    fn add(self, rhs: &Value) -> Value {
        Value::from_op(self.data() + rhs.data(), Op::Add, vec![self.clone(), rhs.clone()])
    }
}

impl std::ops::Mul for &Value {
    type Output = Value;
    fn mul(self, rhs: &Value) -> Value {
        Value::from_op(self.data() * rhs.data(), Op::Mul, vec![self.clone(), rhs.clone()])
    }
}

pub struct Lcg(pub u64);

impl Lcg {
    pub fn new(seed: u64) -> Lcg {
        Lcg(seed)
    }

    /// A number in (-1, 1), from the same linear congruential generator
    /// Knuth used. Same seed, same sequence, every run.
    pub fn next_f64(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((self.0 >> 11) as f64) / ((1u64 << 53) as f64) * 2.0 - 1.0
    }
}

pub struct Neuron {
    pub w: Vec<Value>,
    pub b: Value,
}

impl Neuron {
    pub fn new(nin: usize, rng: &mut Lcg) -> Neuron {
        Neuron {
            w: (0..nin).map(|_| Value::new(rng.next_f64())).collect(),
            b: Value::new(0.0),
        }
    }

    pub fn forward(&self, xs: &[Value]) -> Value {
        let mut sum = self.b.clone();
        for (w, x) in self.w.iter().zip(xs) {
            sum = &sum + &(w * x);
        }
        sum.tanh()
    }

    pub fn parameters(&self) -> Vec<Value> {
        let mut ps = self.w.clone();
        ps.push(self.b.clone());
        ps
    }
}

pub struct Layer {
    pub neurons: Vec<Neuron>,
}

impl Layer {
    pub fn new(nin: usize, nout: usize, rng: &mut Lcg) -> Layer {
        Layer { neurons: (0..nout).map(|_| Neuron::new(nin, rng)).collect() }
    }

    pub fn forward(&self, xs: &[Value]) -> Vec<Value> {
        self.neurons.iter().map(|n| n.forward(xs)).collect()
    }

    pub fn parameters(&self) -> Vec<Value> {
        self.neurons.iter().flat_map(|n| n.parameters()).collect()
    }
}

pub struct Mlp {
    pub layers: Vec<Layer>,
}

impl Mlp {
    pub fn new(sizes: &[usize], rng: &mut Lcg) -> Mlp {
        Mlp { layers: sizes.windows(2).map(|w| Layer::new(w[0], w[1], rng)).collect() }
    }

    pub fn forward(&self, xs: &[Value]) -> Vec<Value> {
        let mut out = xs.to_vec();
        for l in &self.layers {
            out = l.forward(&out);
        }
        out
    }

    pub fn parameters(&self) -> Vec<Value> {
        self.layers.iter().flat_map(|l| l.parameters()).collect()
    }
}

pub fn mse(preds: &[Value], targets: &[f64]) -> Value {
    let mut total = Value::new(0.0);
    for (p, t) in preds.iter().zip(targets) {
        let d = p + &Value::new(-t);
        total = &total + &(&d * &d);
    }
    &total * &Value::new(1.0 / preds.len() as f64)
}

pub fn zero_grad(params: &[Value]) {
    for p in params {
        p.set_grad(0.0);
    }
}

pub fn descend(params: &[Value], lr: f64) {
    for p in params {
        let g = p.grad();
        p.0.borrow_mut().data -= lr * g;
    }
}

pub fn train_xor(steps: usize, lr: f64) -> (Mlp, Vec<f64>) {
    let rng = Lcg::new(1234);
    let net = Mlp::new(&[2, 4, 1], &mut rng);
    let params = net.parameters();

    let inputs = [[-1.0, -1.0], [-1.0, 1.0], [1.0, -1.0], [1.0, 1.0]];
    let targets = [-1.0, 1.0, 1.0, -1.0];
    let mut history = Vec::new();

    for step in 0..steps {
        let mut preds = Vec::new();
        for row in &inputs {
            let xs: Vec<Value> = row.iter().map(|v| Value::new(*v)).collect();
            preds.push(net.forward(&xs).remove(0));
        }
        let loss = mse(&preds, &targets);

        zero_grad(&params);
        loss.backward();
        // one step downhill goes here

        if step % 20 == 0 {
            println!("step {step:4}  loss {:.6}", loss.data());
        }
        history.push(loss.data());
    }

    (net, history)
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn the_loss_falls_by_two_orders_of_magnitude() {
        let (_net, history) = train_xor(400, 0.1);
        assert_eq!(history.len(), 400);
        assert!(history[0] > 0.5, "started at {}", history[0]);
        let last = *history.last().unwrap();
        assert!(last < 0.01, "loss stalled at {last}");
    }

    #[test]
    fn the_run_is_reproducible() {
        let (_a, one) = train_xor(50, 0.1);
        let (_b, two) = train_xor(50, 0.1);
        assert!(close(one[49], two[49]));
    }

    #[test]
    fn the_trained_network_answers_all_four_corners() {
        let (net, _history) = train_xor(400, 0.1);
        let cases = [
            ([-1.0, -1.0], -1.0),
            ([-1.0, 1.0], 1.0),
            ([1.0, -1.0], 1.0),
            ([1.0, 1.0], -1.0),
        ];
        for (row, want) in cases {
            let xs: Vec<Value> = row.iter().map(|v| Value::new(*v)).collect();
            let got = net.forward(&xs)[0].data();
            assert!(got * want > 0.0, "wrong sign for {row:?}: {got}");
            assert!(got.abs() > 0.8, "not confident for {row:?}: {got}");
        }
    }
}
```

```solution
use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Op {
    Leaf,
    Add,
    Mul,
    Tanh,
}

pub struct Node {
    pub data: f64,
    pub grad: f64,
    pub op: Op,
    pub prev: Vec<Value>,
}

#[derive(Clone)]
pub struct Value(pub Rc<RefCell<Node>>);

impl Value {
    pub fn new(data: f64) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op: Op::Leaf, prev: Vec::new() })))
    }

    pub fn from_op(data: f64, op: Op, prev: Vec<Value>) -> Value {
        Value(Rc::new(RefCell::new(Node { data, grad: 0.0, op, prev })))
    }

    pub fn data(&self) -> f64 {
        self.0.borrow().data
    }

    pub fn grad(&self) -> f64 {
        self.0.borrow().grad
    }

    pub fn op(&self) -> Op {
        self.0.borrow().op
    }

    pub fn set_grad(&self, g: f64) {
        self.0.borrow_mut().grad = g;
    }

    pub fn add_grad(&self, g: f64) {
        self.0.borrow_mut().grad += g;
    }

    pub fn parents(&self) -> Vec<Value> {
        self.0.borrow().prev.clone()
    }

    pub fn same_node(&self, other: &Value) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }

    pub fn tanh(&self) -> Value {
        Value::from_op(self.data().tanh(), Op::Tanh, vec![self.clone()])
    }

    pub fn topo(&self) -> Vec<Value> {
        let mut seen: HashSet<usize> = HashSet::new();
        let mut out: Vec<Value> = Vec::new();
        self.visit(&mut seen, &mut out);
        out
    }

    fn visit(&self, seen: &mut HashSet<usize>, out: &mut Vec<Value>) {
        if !seen.insert(Rc::as_ptr(&self.0) as usize) {
            return;
        }
        for p in self.parents() {
            p.visit(seen, out);
        }
        out.push(self.clone());
    }

    pub fn backward(&self) {
        let order = self.topo();
        self.set_grad(1.0);
        for v in order.iter().rev() {
            v.push_grad();
        }
    }

    fn push_grad(&self) {
        let (op, t, grad, prev) = {
            let n = self.0.borrow();
            (n.op, n.data, n.grad, n.prev.clone())
        };
        match op {
            Op::Leaf => {}
            Op::Add => {
                prev[0].add_grad(grad);
                prev[1].add_grad(grad);
            }
            Op::Mul => {
                let (a, b) = (prev[0].data(), prev[1].data());
                prev[0].add_grad(b * grad);
                prev[1].add_grad(a * grad);
            }
            Op::Tanh => {
                prev[0].add_grad((1.0 - t * t) * grad);
            }
        }
    }
}

impl std::ops::Add for &Value {
    type Output = Value;
    fn add(self, rhs: &Value) -> Value {
        Value::from_op(self.data() + rhs.data(), Op::Add, vec![self.clone(), rhs.clone()])
    }
}

impl std::ops::Mul for &Value {
    type Output = Value;
    fn mul(self, rhs: &Value) -> Value {
        Value::from_op(self.data() * rhs.data(), Op::Mul, vec![self.clone(), rhs.clone()])
    }
}

pub struct Lcg(pub u64);

impl Lcg {
    pub fn new(seed: u64) -> Lcg {
        Lcg(seed)
    }

    /// A number in (-1, 1), from the same linear congruential generator
    /// Knuth used. Same seed, same sequence, every run.
    pub fn next_f64(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((self.0 >> 11) as f64) / ((1u64 << 53) as f64) * 2.0 - 1.0
    }
}

pub struct Neuron {
    pub w: Vec<Value>,
    pub b: Value,
}

impl Neuron {
    pub fn new(nin: usize, rng: &mut Lcg) -> Neuron {
        Neuron {
            w: (0..nin).map(|_| Value::new(rng.next_f64())).collect(),
            b: Value::new(0.0),
        }
    }

    pub fn forward(&self, xs: &[Value]) -> Value {
        let mut sum = self.b.clone();
        for (w, x) in self.w.iter().zip(xs) {
            sum = &sum + &(w * x);
        }
        sum.tanh()
    }

    pub fn parameters(&self) -> Vec<Value> {
        let mut ps = self.w.clone();
        ps.push(self.b.clone());
        ps
    }
}

pub struct Layer {
    pub neurons: Vec<Neuron>,
}

impl Layer {
    pub fn new(nin: usize, nout: usize, rng: &mut Lcg) -> Layer {
        Layer { neurons: (0..nout).map(|_| Neuron::new(nin, rng)).collect() }
    }

    pub fn forward(&self, xs: &[Value]) -> Vec<Value> {
        self.neurons.iter().map(|n| n.forward(xs)).collect()
    }

    pub fn parameters(&self) -> Vec<Value> {
        self.neurons.iter().flat_map(|n| n.parameters()).collect()
    }
}

pub struct Mlp {
    pub layers: Vec<Layer>,
}

impl Mlp {
    pub fn new(sizes: &[usize], rng: &mut Lcg) -> Mlp {
        Mlp { layers: sizes.windows(2).map(|w| Layer::new(w[0], w[1], rng)).collect() }
    }

    pub fn forward(&self, xs: &[Value]) -> Vec<Value> {
        let mut out = xs.to_vec();
        for l in &self.layers {
            out = l.forward(&out);
        }
        out
    }

    pub fn parameters(&self) -> Vec<Value> {
        self.layers.iter().flat_map(|l| l.parameters()).collect()
    }
}

pub fn mse(preds: &[Value], targets: &[f64]) -> Value {
    let mut total = Value::new(0.0);
    for (p, t) in preds.iter().zip(targets) {
        let d = p + &Value::new(-t);
        total = &total + &(&d * &d);
    }
    &total * &Value::new(1.0 / preds.len() as f64)
}

pub fn zero_grad(params: &[Value]) {
    for p in params {
        p.set_grad(0.0);
    }
}

pub fn descend(params: &[Value], lr: f64) {
    for p in params {
        let g = p.grad();
        p.0.borrow_mut().data -= lr * g;
    }
}

pub fn train_xor(steps: usize, lr: f64) -> (Mlp, Vec<f64>) {
    let mut rng = Lcg::new(1234);
    let net = Mlp::new(&[2, 4, 1], &mut rng);
    let params = net.parameters();

    let inputs = [[-1.0, -1.0], [-1.0, 1.0], [1.0, -1.0], [1.0, 1.0]];
    let targets = [-1.0, 1.0, 1.0, -1.0];
    let mut history = Vec::new();

    for step in 0..steps {
        let mut preds = Vec::new();
        for row in &inputs {
            let xs: Vec<Value> = row.iter().map(|v| Value::new(*v)).collect();
            preds.push(net.forward(&xs).remove(0));
        }
        let loss = mse(&preds, &targets);

        zero_grad(&params);
        loss.backward();
        descend(&params, lr);

        if step % 20 == 0 {
            println!("step {step:4}  loss {:.6}", loss.data());
        }
        history.push(loss.data());
    }

    (net, history)
}
```

@hint `Mlp::new` draws weights from the generator, so it advances it, so it needs `&mut Lcg`. A binding you hand out mutably has to say `mut`.
@hint The missing line is the one that actually changes the network. Every parameter has a gradient by then, and `descend` knows what to do with it.
@hint `let mut rng = Lcg::new(1234);` and `descend(&params, lr);` straight after `loss.backward()`.

@diagnose E0596
`cannot borrow rng as mutable, as it is not declared as mutable`. `&mut rng`
asks for exclusive access to a binding that never claimed it could be modified.
The `mut` in `let mut rng` is not decoration on the type; it is the binding
promising that this name may be written through.

Rust makes you write it because a `&mut` is a statement that nothing else can
observe this value while you hold it, and that promise is only meaningful if the
owner opted in. Add `mut` and the sixteen weights come out of the generator in a
fixed order, the same order on every run.

@diagnose E0499
Two `&mut` borrows of the generator alive at once, most likely from restructuring
the `Mlp::new` call. The generator is threaded through one call at a time:
`Mlp::new` lends it to `Layer::new`, which lends it to `Neuron::new`, and each
lend ends before the next begins.

@diagnose E0308
`train_xor` returns `(Mlp, Vec<f64>)`. The tail expression is the tuple
`(net, history)`, and `history` is a `Vec<f64>` built by pushing `loss.data()`,
not the `Value` nodes themselves.

@after
Four training examples, seventeen parameters, and a loss that falls from about
1.1 to below 0.005 in four hundred steps. Every gradient in that run was
computed by the forty lines you wrote in stages 3 to 5.

Worth sitting with: the graph is rebuilt from scratch on every step, several
hundred nodes allocated and dropped per iteration, and that is what PyTorch does
too. It is called define-by-run, and the reason it won is that the network is
just the code that ran, so a loop or an `if` in the forward pass needs no special
support.

What is missing before this is a real engine: tensors, so one node holds a whole
matrix; more operators (`exp`, `log`, `pow`, a proper softmax); and an optimiser
with momentum, since plain gradient descent is slow on anything with an awkward
curvature. None of those change the machinery you just built.

