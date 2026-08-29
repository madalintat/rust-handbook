---
project: life
tier: mini
domain: games
title: Conway's Game of Life
accent: moss
blurb: A flat Vec<bool> with index maths, neighbour counts that wrap at the edges and a four-line rule table, then a glider walks across the board.
needs: 11-collections, 17-iterators
mins: 25
---

Conway's rules fit in four lines, and people have been studying them since
1970 because something that simple producing a pattern that walks across the
board is genuinely surprising. This project is not really about that. It is
about the two decisions underneath it, which turn up again in image processing,
in convolution kernels and in every other grid-shaped problem.

The first is how to store a rectangle. `Vec<Vec<bool>>` is what most people
reach for, and it costs a separate heap allocation per row plus a pointer chase
to reach any cell. Worse, the type permits a ragged grid: nothing stops row 3
being shorter than row 2, so every piece of code that touches it either checks
or has a bug waiting. One flat `Vec<bool>` of `w * h` cells, addressed as
`y * w + x`, is a single allocation, contiguous for the cache prefetcher, and
rectangular because there is nowhere for a ragged row to live.

The second is that a generation has to be computed from the previous one in
full. Write a cell back into the grid you are reading and the cell to its right
counts a neighbour from the future, which quietly turns Life into a different
automaton that looks almost right.

Four stages: the grid and its index maths, counting the eight neighbours on a
board whose edges join up, the rule itself, and a glider run for four
generations so you can watch it move one cell diagonally.

## 1. One vector, not a vector of vectors

@kind fix
@concept Vec

@expect E0502

`Grid` keeps `w * h` bools in one `Vec` and turns `(x, y)` into an offset into
it. `get` reads through that offset. `set` writes through it, and does not
compile, because two things want the grid at the same instant.

```starter
/// The board. One `Vec<bool>`, `w * h` long, row by row.
#[derive(Clone, PartialEq)]
pub struct Grid {
    pub w: usize,
    pub h: usize,
    pub cells: Vec<bool>,
}

/// A glider, the smallest thing in Life that travels.
pub const GLIDER: [(usize, usize); 5] = [(1, 0), (2, 1), (0, 2), (1, 2), (2, 2)];

impl Grid {
    pub fn new(w: usize, h: usize) -> Grid {
        Grid { w, h, cells: vec![false; w * h] }
    }

    /// Row-major: (x, y) lives at y * w + x.
    pub fn index(&self, x: usize, y: usize) -> usize {
        y * self.w + x
    }

    pub fn get(&self, x: usize, y: usize) -> bool {
        self.cells[self.index(x, y)]
    }

    pub fn set(&mut self, x: usize, y: usize, alive: bool) {
        self.cells[self.index(x, y)] = alive;
    }

    pub fn render(&self) -> String {
        let mut out = String::new();
        for y in 0..self.h {
            for x in 0..self.w {
                out.push(if self.get(x, y) { '#' } else { '.' });
            }
            out.push('\n');
        }
        out
    }
}

pub fn seed() -> Grid {
    let mut g = Grid::new(10, 10);
    for (x, y) in GLIDER {
        g.set(x, y, true);
    }
    g
}
pub fn run() -> Grid {
    let g = seed();
    print!("{}", g.render());
    println!("{} by {}, {} cells in one allocation, {} alive",
             g.w, g.h, g.cells.len(), g.cells.iter().filter(|c| **c).count());
    g
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_seed_is_one_allocation_with_five_live_cells() {
        let g = run();
        assert_eq!((g.w, g.h), (10, 10));
        assert_eq!(g.cells.len(), 100);
        assert_eq!(g.cells.iter().filter(|c| **c).count(), 5);
    }

    #[test]
    fn the_index_maths_covers_every_cell_exactly_once() {
        let g = Grid::new(7, 4);
        let mut seen: Vec<usize> = Vec::new();
        for y in 0..g.h {
            for x in 0..g.w {
                seen.push(g.index(x, y));
            }
        }
        assert_eq!(seen.first(), Some(&0));
        assert_eq!(seen.last(), Some(&27));
        seen.sort_unstable();
        seen.dedup();
        assert_eq!(seen.len(), 28);
    }

    #[test]
    fn rows_are_contiguous_and_columns_are_a_stride_apart() {
        let g = Grid::new(7, 4);
        assert_eq!(g.index(1, 0) - g.index(0, 0), 1);
        assert_eq!(g.index(0, 1) - g.index(0, 0), 7);
    }

    #[test]
    fn setting_one_cell_leaves_the_rest_alone() {
        let mut g = Grid::new(5, 5);
        g.set(3, 2, true);
        assert!(g.get(3, 2));
        assert_eq!(g.cells.iter().filter(|c| **c).count(), 1);
        assert!(!g.get(2, 3));
        g.set(3, 2, false);
        assert_eq!(g.cells, vec![false; 25]);
    }

    #[test]
    fn render_draws_the_rows_in_order() {
        let g = seed();
        let drawn = g.render();
        let lines: Vec<&str> = drawn.lines().collect();
        assert_eq!(lines.len(), 10);
        assert_eq!(lines[0], ".#........");
        assert_eq!(lines[2], "###.......");
        assert!(lines.iter().all(|l| l.chars().count() == 10));
    }
}
```

```solution
/// The board. One `Vec<bool>`, `w * h` long, row by row.
#[derive(Clone, PartialEq)]
pub struct Grid {
    pub w: usize,
    pub h: usize,
    pub cells: Vec<bool>,
}

/// A glider, the smallest thing in Life that travels.
pub const GLIDER: [(usize, usize); 5] = [(1, 0), (2, 1), (0, 2), (1, 2), (2, 2)];

impl Grid {
    pub fn new(w: usize, h: usize) -> Grid {
        Grid { w, h, cells: vec![false; w * h] }
    }

    /// Row-major: (x, y) lives at y * w + x.
    pub fn index(&self, x: usize, y: usize) -> usize {
        y * self.w + x
    }

    pub fn get(&self, x: usize, y: usize) -> bool {
        self.cells[self.index(x, y)]
    }

    pub fn set(&mut self, x: usize, y: usize, alive: bool) {
        let i = self.index(x, y);
        self.cells[i] = alive;
    }

    pub fn render(&self) -> String {
        let mut out = String::new();
        for y in 0..self.h {
            for x in 0..self.w {
                out.push(if self.get(x, y) { '#' } else { '.' });
            }
            out.push('\n');
        }
        out
    }
}

pub fn seed() -> Grid {
    let mut g = Grid::new(10, 10);
    for (x, y) in GLIDER {
        g.set(x, y, true);
    }
    g
}
pub fn run() -> Grid {
    let g = seed();
    print!("{}", g.render());
    println!("{} by {}, {} cells in one allocation, {} alive",
             g.w, g.h, g.cells.len(), g.cells.iter().filter(|c| **c).count());
    g
}
```

@hint Look at what sits on each side of the `=`. Both halves need the grid, and they need it in different ways.
@hint `self.cells[i] = v` needs `&mut self.cells`. `self.index(x, y)` is a method call, so it needs `&self`, and the compiler wants that borrow before the assignment target is settled.
@hint Compute the offset into a local first: `let i = self.index(x, y);` then `self.cells[i] = alive;`

@diagnose E0502
`cannot borrow *self as immutable because it is also borrowed as mutable`.

The line desugars to `*IndexMut::index_mut(&mut self.cells, self.index(x, y)) =
alive`. The mutable borrow of `self.cells` is taken first, and the index
argument is evaluated while it is live. `self.index(x, y)` is a method taking
`&self`, so it borrows the whole struct, and two overlapping borrows with one
of them exclusive is the rule the checker exists to enforce.

Note how narrow the problem is. `self.cells[self.w - 1] = alive` compiles,
because reading the field `self.w` borrows only that field and the checker
tracks fields separately. It is the method call that widens the borrow to all
of `*self`, since a signature says `&self` and cannot say "only `w`".

@diagnose E0596
`cannot borrow *self as mutable, as it is behind a & reference`. The receiver
is `&self` rather than `&mut self`, so nothing in the body may write. A method
that changes the grid has to say so in its signature, which is also how a
caller can tell at a glance which of its own locals need `mut`.

@after
What the two layouts actually look like in memory:

```text
  Vec<Vec<bool>>                       Vec<bool>, flat
  ┌───────────────┐                    ┌───────────────┐
  │ ptr ●─────────┼──┐                 │ ptr ●─────────┼──┐
  │ len 4         │  │                 │ len 16        │  │
  └───────────────┘  │                 └───────────────┘  │
     ┌───────────────┘                    ┌───────────────┘
     ▼                                    ▼
   ┌────┬────┬────┬────┐                ┌──┬──┬──┬──┬──┬──┬── ...
   │ ●  │ ●  │ ●  │ ●  │                │y0│y0│y0│y0│y1│y1│y1
   └─┼──┴─┼──┴─┼──┴─┼──┘                └──┴──┴──┴──┴──┴──┴── ...
     ▼    ▼    ▼    ▼                    one allocation, one cache line
   4 more allocations, anywhere          holds two whole rows
```

Four rows means five allocations and five places for the prefetcher to lose
the thread. The flat version is one. At 10 by 10 none of this is measurable.
At 4000 by 4000, which is an ordinary image, it is the difference between a
frame and a slideshow.

`bool` is one byte here, not one bit, so the grid is eight times larger than a
bitset would be. That trade buys `cells[i]` as a single load rather than a
shift and a mask.

## 2. The eight around you, and the edge that is not there

@kind fix
@concept index

@expect E0308

Every cell has eight neighbours. On a board whose edges join up, an x of -1
means the far right column, so the offsets have to be signed while the width is
not. The line that folds a coordinate back into range has a type error, and
underneath it a bug.

```starter
/// The board. One `Vec<bool>`, `w * h` long, row by row.
#[derive(Clone, PartialEq)]
pub struct Grid {
    pub w: usize,
    pub h: usize,
    pub cells: Vec<bool>,
}

/// A glider, the smallest thing in Life that travels.
pub const GLIDER: [(usize, usize); 5] = [(1, 0), (2, 1), (0, 2), (1, 2), (2, 2)];

impl Grid {
    pub fn new(w: usize, h: usize) -> Grid {
        Grid { w, h, cells: vec![false; w * h] }
    }

    /// Row-major: (x, y) lives at y * w + x.
    pub fn index(&self, x: usize, y: usize) -> usize {
        y * self.w + x
    }

    pub fn get(&self, x: usize, y: usize) -> bool {
        self.cells[self.index(x, y)]
    }

    pub fn set(&mut self, x: usize, y: usize, alive: bool) {
        let i = self.index(x, y);
        self.cells[i] = alive;
    }

    pub fn render(&self) -> String {
        let mut out = String::new();
        for y in 0..self.h {
            for x in 0..self.w {
                out.push(if self.get(x, y) { '#' } else { '.' });
            }
            out.push('\n');
        }
        out
    }
}

pub fn seed() -> Grid {
    let mut g = Grid::new(10, 10);
    for (x, y) in GLIDER {
        g.set(x, y, true);
    }
    g
}
impl Grid {
    /// The eight cells around (x, y), on a board whose edges join up.
    pub fn neighbours(&self, x: usize, y: usize) -> usize {
        let mut alive = 0;
        for dy in -1i64..=1 {
            for dx in -1i64..=1 {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let nx = ((x as i64 + dx) % self.w) as usize;
                let ny = ((y as i64 + dy) % self.h) as usize;
                if self.get(nx, ny) {
                    alive += 1;
                }
            }
        }
        alive
    }
}
pub fn run() -> Vec<usize> {
    let g = seed();
    print!("{}", g.render());
    println!("neighbour counts:");

    let mut counts = Vec::with_capacity(g.w * g.h);
    for y in 0..g.h {
        let mut row = String::new();
        for x in 0..g.w {
            let n = g.neighbours(x, y);
            counts.push(n);
            row.push(char::from_digit(n as u32, 10).unwrap());
        }
        println!("{row}");
    }
    counts
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    fn all_alive(w: usize, h: usize) -> Grid {
        Grid { w, h, cells: vec![true; w * h] }
    }

    #[test]
    fn the_counts_line_up_with_the_glider() {
        let counts = run();
        assert_eq!(counts.len(), 100);
        // the cell at (0, 1) touches three of the five live cells
        assert_eq!(counts[10], 3);
        // and the middle of the glider touches all but one
        assert_eq!(counts[11], 5);
    }

    #[test]
    fn a_cell_never_counts_itself() {
        let mut g = Grid::new(10, 10);
        g.set(4, 4, true);
        assert_eq!(g.neighbours(4, 4), 0);
        assert_eq!(g.neighbours(3, 3), 1);
        assert_eq!(g.neighbours(5, 5), 1);
        assert_eq!(g.neighbours(4, 6), 0);
    }

    #[test]
    fn the_edges_join_up() {
        let mut g = Grid::new(10, 10);
        g.set(9, 9, true);
        // the opposite corner is diagonally adjacent once the board wraps
        assert_eq!(g.neighbours(0, 0), 1);
        assert_eq!(g.neighbours(0, 9), 1);
        assert_eq!(g.neighbours(9, 0), 1);
        assert_eq!(g.neighbours(5, 5), 0);
    }

    #[test]
    fn every_cell_of_a_full_board_has_eight() {
        let g = all_alive(4, 3);
        for y in 0..g.h {
            for x in 0..g.w {
                assert_eq!(g.neighbours(x, y), 8);
            }
        }
    }

    #[test]
    fn wrapping_is_symmetric_at_both_edges() {
        let mut left = Grid::new(6, 6);
        left.set(0, 3, true);
        assert_eq!(left.neighbours(5, 3), 1);

        let mut right = Grid::new(6, 6);
        right.set(5, 3, true);
        assert_eq!(right.neighbours(0, 3), 1);
    }
}
```

```solution
/// The board. One `Vec<bool>`, `w * h` long, row by row.
#[derive(Clone, PartialEq)]
pub struct Grid {
    pub w: usize,
    pub h: usize,
    pub cells: Vec<bool>,
}

/// A glider, the smallest thing in Life that travels.
pub const GLIDER: [(usize, usize); 5] = [(1, 0), (2, 1), (0, 2), (1, 2), (2, 2)];

impl Grid {
    pub fn new(w: usize, h: usize) -> Grid {
        Grid { w, h, cells: vec![false; w * h] }
    }

    /// Row-major: (x, y) lives at y * w + x.
    pub fn index(&self, x: usize, y: usize) -> usize {
        y * self.w + x
    }

    pub fn get(&self, x: usize, y: usize) -> bool {
        self.cells[self.index(x, y)]
    }

    pub fn set(&mut self, x: usize, y: usize, alive: bool) {
        let i = self.index(x, y);
        self.cells[i] = alive;
    }

    pub fn render(&self) -> String {
        let mut out = String::new();
        for y in 0..self.h {
            for x in 0..self.w {
                out.push(if self.get(x, y) { '#' } else { '.' });
            }
            out.push('\n');
        }
        out
    }
}

pub fn seed() -> Grid {
    let mut g = Grid::new(10, 10);
    for (x, y) in GLIDER {
        g.set(x, y, true);
    }
    g
}
impl Grid {
    /// The eight cells around (x, y), on a board whose edges join up.
    pub fn neighbours(&self, x: usize, y: usize) -> usize {
        let mut alive = 0;
        for dy in -1i64..=1 {
            for dx in -1i64..=1 {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let nx = (x as i64 + dx).rem_euclid(self.w as i64) as usize;
                let ny = (y as i64 + dy).rem_euclid(self.h as i64) as usize;
                if self.get(nx, ny) {
                    alive += 1;
                }
            }
        }
        alive
    }
}
pub fn run() -> Vec<usize> {
    let g = seed();
    print!("{}", g.render());
    println!("neighbour counts:");

    let mut counts = Vec::with_capacity(g.w * g.h);
    for y in 0..g.h {
        let mut row = String::new();
        for x in 0..g.w {
            let n = g.neighbours(x, y);
            counts.push(n);
            row.push(char::from_digit(n as u32, 10).unwrap());
        }
        println!("{row}");
    }
    counts
}
```

@hint The two sides of `%` are different types. Fix that, then ask what `%` actually returns when the left side is negative.
@hint In Rust `-1 % 10` is `-1`, because the remainder takes the sign of the dividend. Casting that to `usize` is a panic on the first cell in the left column.
@hint `(x as i64 + dx).rem_euclid(self.w as i64) as usize` is always in `0..w`.

@diagnose E0308
`mismatched types: expected i64, found usize`.

`self.w` is a `usize` because it indexes memory, and the offset has to be
signed because it can be -1. Rust performs no implicit numeric conversion, not
even a widening one, so the two sides of `%` have to be made the same type by
hand.

Casting is the easy half. The half worth stopping on is that `%` in Rust
truncates towards zero, exactly like C, Java and Go, so `-1 % 10` is `-1` and
not `9`. Fix only the types and the function compiles and then panics the first
time a cell on the left edge looks left, because `-1 as usize` is a very large
number. `rem_euclid` is the operation you meant: it always returns a value with
the sign of the divisor.

@diagnose E0277
`cannot calculate the remainder of i64 divided by usize`, which rustc reports
alongside the type error. Operators are trait methods, so `a % b` is
`Rem::rem(a, b)`, and the standard library implements `Rem<i64> for i64` and
`Rem<usize> for usize` but never a mixed pair. There is no missing conversion
for the compiler to insert; the function you asked for does not exist.

@after
The two operations, side by side:

| x + dx | `% 10` | `.rem_euclid(10)` |
|---|---|---|
| 11 | 1 | 1 |
| 5 | 5 | 5 |
| -1 | -1 | 9 |
| -3 | -3 | 7 |

They agree on everything non-negative, which is why this bug survives testing
of the middle of the board and dies at the edge. Python's `%` is the Euclidean
one, so a Python habit expects 9 here.

The other common fix is `(x + w - 1) % w`, adding a whole width before the
modulo so the value is never negative. It gives the same answer and needs a
comment to say why the `+ w` is there. `rem_euclid` says it in the name.

## 3. Four lines, and two buffers

@kind fix
@concept match

@expect E0596

All of Life: a live cell with two or three neighbours survives, a dead cell
with exactly three is born, everything else is dead next generation. `step`
reads this grid and has to write a different one. It currently tries to write
into the grid it is reading.

```starter
/// The board. One `Vec<bool>`, `w * h` long, row by row.
#[derive(Clone, PartialEq)]
pub struct Grid {
    pub w: usize,
    pub h: usize,
    pub cells: Vec<bool>,
}

/// A glider, the smallest thing in Life that travels.
pub const GLIDER: [(usize, usize); 5] = [(1, 0), (2, 1), (0, 2), (1, 2), (2, 2)];

impl Grid {
    pub fn new(w: usize, h: usize) -> Grid {
        Grid { w, h, cells: vec![false; w * h] }
    }

    /// Row-major: (x, y) lives at y * w + x.
    pub fn index(&self, x: usize, y: usize) -> usize {
        y * self.w + x
    }

    pub fn get(&self, x: usize, y: usize) -> bool {
        self.cells[self.index(x, y)]
    }

    pub fn set(&mut self, x: usize, y: usize, alive: bool) {
        let i = self.index(x, y);
        self.cells[i] = alive;
    }

    pub fn render(&self) -> String {
        let mut out = String::new();
        for y in 0..self.h {
            for x in 0..self.w {
                out.push(if self.get(x, y) { '#' } else { '.' });
            }
            out.push('\n');
        }
        out
    }
}

pub fn seed() -> Grid {
    let mut g = Grid::new(10, 10);
    for (x, y) in GLIDER {
        g.set(x, y, true);
    }
    g
}
impl Grid {
    /// The eight cells around (x, y), on a board whose edges join up.
    pub fn neighbours(&self, x: usize, y: usize) -> usize {
        let mut alive = 0;
        for dy in -1i64..=1 {
            for dx in -1i64..=1 {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let nx = (x as i64 + dx).rem_euclid(self.w as i64) as usize;
                let ny = (y as i64 + dy).rem_euclid(self.h as i64) as usize;
                if self.get(nx, ny) {
                    alive += 1;
                }
            }
        }
        alive
    }
}
impl Grid {
    /// One generation. Reads this grid, writes a fresh one.
    pub fn step(&self) -> Grid {
        for y in 0..self.h {
            for x in 0..self.w {
                let alive = match (self.get(x, y), self.neighbours(x, y)) {
                    (true, 2) => true,
                    (true, 3) => true,
                    (false, 3) => true,
                    _ => false,
                };
                self.set(x, y, alive);
            }
        }
        self.clone()
    }
}
pub fn run() -> Grid {
    let g = seed();
    print!("{}", g.render());
    println!("becomes");
    let next = g.step();
    print!("{}", next.render());
    println!("{} alive, was {}",
             next.cells.iter().filter(|c| **c).count(),
             g.cells.iter().filter(|c| **c).count());
    next
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    fn from_cells(w: usize, h: usize, live: &[(usize, usize)]) -> Grid {
        let mut g = Grid::new(w, h);
        for &(x, y) in live {
            g.set(x, y, true);
        }
        g
    }

    #[test]
    fn the_glider_takes_its_first_step() {
        let next = run();
        assert_eq!(next.render().lines().next(), Some(".........."));
        assert_eq!(next.render().lines().nth(1), Some("#.#......."));
        assert_eq!(next.render().lines().nth(2), Some(".##......."));
        assert_eq!(next.render().lines().nth(3), Some(".#........"));
    }

    #[test]
    fn a_block_sits_still_forever() {
        let block = from_cells(6, 6, &[(1, 1), (2, 1), (1, 2), (2, 2)]);
        let mut g = block.clone();
        for _ in 0..10 {
            g = g.step();
            assert!(g == block);
        }
    }

    #[test]
    fn a_blinker_has_period_two() {
        let flat = from_cells(6, 6, &[(1, 2), (2, 2), (3, 2)]);
        let upright = from_cells(6, 6, &[(2, 1), (2, 2), (2, 3)]);
        assert!(flat.step() == upright);
        assert!(upright.step() == flat);
    }

    #[test]
    fn stepping_leaves_the_old_generation_untouched() {
        let before = seed();
        let after = before.step();
        assert!(before == seed());
        assert!(after != before);
    }

    #[test]
    fn an_empty_board_stays_empty_and_a_full_one_dies_back() {
        let empty = Grid::new(5, 5);
        assert!(empty.step() == empty);

        // every cell of a full board has eight neighbours, so every cell dies
        let full = Grid { w: 5, h: 5, cells: vec![true; 25] };
        assert!(full.step() == empty);
    }

    #[test]
    fn a_lone_cell_dies_and_three_in_a_corner_give_birth() {
        let lonely = from_cells(6, 6, &[(3, 3)]);
        assert_eq!(lonely.step().cells.iter().filter(|c| **c).count(), 0);

        let corner = from_cells(6, 6, &[(1, 1), (2, 1), (1, 2)]);
        assert!(corner.step().get(2, 2));
    }
}
```

```solution
/// The board. One `Vec<bool>`, `w * h` long, row by row.
#[derive(Clone, PartialEq)]
pub struct Grid {
    pub w: usize,
    pub h: usize,
    pub cells: Vec<bool>,
}

/// A glider, the smallest thing in Life that travels.
pub const GLIDER: [(usize, usize); 5] = [(1, 0), (2, 1), (0, 2), (1, 2), (2, 2)];

impl Grid {
    pub fn new(w: usize, h: usize) -> Grid {
        Grid { w, h, cells: vec![false; w * h] }
    }

    /// Row-major: (x, y) lives at y * w + x.
    pub fn index(&self, x: usize, y: usize) -> usize {
        y * self.w + x
    }

    pub fn get(&self, x: usize, y: usize) -> bool {
        self.cells[self.index(x, y)]
    }

    pub fn set(&mut self, x: usize, y: usize, alive: bool) {
        let i = self.index(x, y);
        self.cells[i] = alive;
    }

    pub fn render(&self) -> String {
        let mut out = String::new();
        for y in 0..self.h {
            for x in 0..self.w {
                out.push(if self.get(x, y) { '#' } else { '.' });
            }
            out.push('\n');
        }
        out
    }
}

pub fn seed() -> Grid {
    let mut g = Grid::new(10, 10);
    for (x, y) in GLIDER {
        g.set(x, y, true);
    }
    g
}
impl Grid {
    /// The eight cells around (x, y), on a board whose edges join up.
    pub fn neighbours(&self, x: usize, y: usize) -> usize {
        let mut alive = 0;
        for dy in -1i64..=1 {
            for dx in -1i64..=1 {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let nx = (x as i64 + dx).rem_euclid(self.w as i64) as usize;
                let ny = (y as i64 + dy).rem_euclid(self.h as i64) as usize;
                if self.get(nx, ny) {
                    alive += 1;
                }
            }
        }
        alive
    }
}
impl Grid {
    /// One generation. Reads this grid, writes a fresh one.
    pub fn step(&self) -> Grid {
        let mut next = Grid::new(self.w, self.h);
        for y in 0..self.h {
            for x in 0..self.w {
                let alive = match (self.get(x, y), self.neighbours(x, y)) {
                    (true, 2) => true,
                    (true, 3) => true,
                    (false, 3) => true,
                    _ => false,
                };
                next.set(x, y, alive);
            }
        }
        next
    }
}
pub fn run() -> Grid {
    let g = seed();
    print!("{}", g.render());
    println!("becomes");
    let next = g.step();
    print!("{}", next.render());
    println!("{} alive, was {}",
             next.cells.iter().filter(|c| **c).count(),
             g.cells.iter().filter(|c| **c).count());
    next
}
```

@hint `&self` is a promise to the caller that nothing changes, and `set` needs the opposite. Look at where the new state should be going.
@hint Changing the receiver to `&mut self` compiles and then gives wrong answers. A cell you have already updated gets counted as a neighbour by the cell to its right.
@hint Build a fresh `Grid::new(self.w, self.h)`, write every cell into that, and return it.

@diagnose E0596
`cannot borrow *self as mutable, as it is behind a & reference`, with a
suggestion to change the receiver to `&mut self`.

Take the suggestion and it compiles. That is worth dwelling on, because the
suggestion is fixing your types and not your algorithm. Life is defined as a
function from one generation to the next, and every neighbour count has to be
read from the same generation. Updating in place means the cells above and to
the left have already moved on, so a cell counts a mixture of two generations
and the glider disintegrates.

The receiver is telling you something true: a function that computes the next
generation should not be able to touch this one. `&self` in, a brand new
`Grid` out.

@diagnose E0004
`non-exhaustive patterns`. A `match` on `(bool, usize)` has to cover every
count, and there are a lot of counts. The four interesting cases are `(true,
2)`, `(true, 3)` and `(false, 3)` alive, everything else dead, so the fourth
arm is `_ => false`. rustc counts the missing patterns rather than trusting
that you thought about them.

@after
The rule, as a table:

| this cell | live neighbours | next |
|---|---|---|
| alive | 2 or 3 | alive |
| alive | anything else | dead |
| dead | exactly 3 | alive |
| dead | anything else | dead |

Written as a `match` on the pair, that is four arms and no arithmetic. The
version people write first counts up and down with `if n < 2 || n > 3`, which
is the same thing said less directly.

Allocating a whole new `Grid` per generation is the honest version and not the
fast one. A renderer that runs this at sixty frames a second keeps two grids
allocated once and calls `std::mem::swap` on them, so the previous generation's
buffer becomes the next one's scratch space. Same algorithm, no allocator in
the loop.

## 4. Watch it walk

@kind fix
@concept clone

@expect E0382

Four generations turn a glider into the same five cells, one step down and one
step right, and it keeps going for as long as you let it. `run` wants to keep
the starting grid to compare against, and then keep stepping the grid it just
gave away.

```starter
/// The board. One `Vec<bool>`, `w * h` long, row by row.
#[derive(Clone, PartialEq)]
pub struct Grid {
    pub w: usize,
    pub h: usize,
    pub cells: Vec<bool>,
}

/// A glider, the smallest thing in Life that travels.
pub const GLIDER: [(usize, usize); 5] = [(1, 0), (2, 1), (0, 2), (1, 2), (2, 2)];

impl Grid {
    pub fn new(w: usize, h: usize) -> Grid {
        Grid { w, h, cells: vec![false; w * h] }
    }

    /// Row-major: (x, y) lives at y * w + x.
    pub fn index(&self, x: usize, y: usize) -> usize {
        y * self.w + x
    }

    pub fn get(&self, x: usize, y: usize) -> bool {
        self.cells[self.index(x, y)]
    }

    pub fn set(&mut self, x: usize, y: usize, alive: bool) {
        let i = self.index(x, y);
        self.cells[i] = alive;
    }

    pub fn render(&self) -> String {
        let mut out = String::new();
        for y in 0..self.h {
            for x in 0..self.w {
                out.push(if self.get(x, y) { '#' } else { '.' });
            }
            out.push('\n');
        }
        out
    }
}

pub fn seed() -> Grid {
    let mut g = Grid::new(10, 10);
    for (x, y) in GLIDER {
        g.set(x, y, true);
    }
    g
}
impl Grid {
    /// The eight cells around (x, y), on a board whose edges join up.
    pub fn neighbours(&self, x: usize, y: usize) -> usize {
        let mut alive = 0;
        for dy in -1i64..=1 {
            for dx in -1i64..=1 {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let nx = (x as i64 + dx).rem_euclid(self.w as i64) as usize;
                let ny = (y as i64 + dy).rem_euclid(self.h as i64) as usize;
                if self.get(nx, ny) {
                    alive += 1;
                }
            }
        }
        alive
    }
}
impl Grid {
    /// One generation. Reads this grid, writes a fresh one.
    pub fn step(&self) -> Grid {
        let mut next = Grid::new(self.w, self.h);
        for y in 0..self.h {
            for x in 0..self.w {
                let alive = match (self.get(x, y), self.neighbours(x, y)) {
                    (true, 2) => true,
                    (true, 3) => true,
                    (false, 3) => true,
                    _ => false,
                };
                next.set(x, y, alive);
            }
        }
        next
    }
}
impl Grid {
    /// Every live cell as (x, y), in row order.
    pub fn live_cells(&self) -> Vec<(usize, usize)> {
        self.cells
            .iter()
            .enumerate()
            .filter(|(_, alive)| **alive)
            .map(|(i, _)| (i % self.w, i / self.w))
            .collect()
    }
}
pub fn run() -> Grid {
    let mut g = seed();
    let start = g;
    print!("gen 0\n{}", g.render());
    for generation in 1..=4 {
        g = g.step();
        print!("gen {generation}\n{}", g.render());
    }
    println!("started at {:?}", start.live_cells());
    println!("ended at   {:?}", g.live_cells());
    g
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn four_generations_move_the_glider_one_cell_diagonally() {
        let end = run();
        let moved: Vec<(usize, usize)> = seed()
            .live_cells()
            .iter()
            .map(|&(x, y)| (x + 1, y + 1))
            .collect();
        assert_eq!(end.live_cells(), moved);
    }

    #[test]
    fn live_cells_reads_the_flat_vec_back_as_coordinates() {
        let g = seed();
        assert_eq!(g.live_cells(), GLIDER.to_vec());
        assert_eq!(Grid::new(4, 4).live_cells(), Vec::new());

        let mut one = Grid::new(4, 3);
        one.set(3, 2, true);
        assert_eq!(one.live_cells(), vec![(3, 2)]);
    }

    #[test]
    fn the_population_never_changes_while_it_travels() {
        let mut g = seed();
        for _ in 0..16 {
            g = g.step();
            assert_eq!(g.live_cells().len(), 5);
        }
    }

    #[test]
    fn forty_generations_carry_it_all_the_way_round_the_torus() {
        let start = seed();
        let mut g = start.clone();
        for _ in 0..40 {
            g = g.step();
        }
        assert!(g == start);
    }

    #[test]
    fn the_shape_returns_every_four_generations() {
        let mut g = seed();
        for _ in 0..4 {
            g = g.step();
        }
        let shifted: Vec<(usize, usize)> = g
            .live_cells()
            .iter()
            .map(|&(x, y)| (x + 1, y + 1))
            .collect();
        for _ in 0..4 {
            g = g.step();
        }
        assert_eq!(g.live_cells(), shifted);
    }
}
```

```solution
/// The board. One `Vec<bool>`, `w * h` long, row by row.
#[derive(Clone, PartialEq)]
pub struct Grid {
    pub w: usize,
    pub h: usize,
    pub cells: Vec<bool>,
}

/// A glider, the smallest thing in Life that travels.
pub const GLIDER: [(usize, usize); 5] = [(1, 0), (2, 1), (0, 2), (1, 2), (2, 2)];

impl Grid {
    pub fn new(w: usize, h: usize) -> Grid {
        Grid { w, h, cells: vec![false; w * h] }
    }

    /// Row-major: (x, y) lives at y * w + x.
    pub fn index(&self, x: usize, y: usize) -> usize {
        y * self.w + x
    }

    pub fn get(&self, x: usize, y: usize) -> bool {
        self.cells[self.index(x, y)]
    }

    pub fn set(&mut self, x: usize, y: usize, alive: bool) {
        let i = self.index(x, y);
        self.cells[i] = alive;
    }

    pub fn render(&self) -> String {
        let mut out = String::new();
        for y in 0..self.h {
            for x in 0..self.w {
                out.push(if self.get(x, y) { '#' } else { '.' });
            }
            out.push('\n');
        }
        out
    }
}

pub fn seed() -> Grid {
    let mut g = Grid::new(10, 10);
    for (x, y) in GLIDER {
        g.set(x, y, true);
    }
    g
}
impl Grid {
    /// The eight cells around (x, y), on a board whose edges join up.
    pub fn neighbours(&self, x: usize, y: usize) -> usize {
        let mut alive = 0;
        for dy in -1i64..=1 {
            for dx in -1i64..=1 {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let nx = (x as i64 + dx).rem_euclid(self.w as i64) as usize;
                let ny = (y as i64 + dy).rem_euclid(self.h as i64) as usize;
                if self.get(nx, ny) {
                    alive += 1;
                }
            }
        }
        alive
    }
}
impl Grid {
    /// One generation. Reads this grid, writes a fresh one.
    pub fn step(&self) -> Grid {
        let mut next = Grid::new(self.w, self.h);
        for y in 0..self.h {
            for x in 0..self.w {
                let alive = match (self.get(x, y), self.neighbours(x, y)) {
                    (true, 2) => true,
                    (true, 3) => true,
                    (false, 3) => true,
                    _ => false,
                };
                next.set(x, y, alive);
            }
        }
        next
    }
}
impl Grid {
    /// Every live cell as (x, y), in row order.
    pub fn live_cells(&self) -> Vec<(usize, usize)> {
        self.cells
            .iter()
            .enumerate()
            .filter(|(_, alive)| **alive)
            .map(|(i, _)| (i % self.w, i / self.w))
            .collect()
    }
}
pub fn run() -> Grid {
    let mut g = seed();
    let start = g.clone();
    print!("gen 0\n{}", g.render());
    for generation in 1..=4 {
        g = g.step();
        print!("gen {generation}\n{}", g.render());
    }
    println!("started at {:?}", start.live_cells());
    println!("ended at   {:?}", g.live_cells());
    g
}
```

@hint `Grid` owns a `Vec`, so binding it to a second name moves it rather than copying it.
@hint You want two grids here, not two names for one. `Grid` already derives `Clone`.
@hint `let start = g.clone();`

@diagnose E0382
`borrow of moved value: g`, with `move occurs because g has type Grid, which
does not implement the Copy trait`.

`let start = g;` hands the grid over. `Grid` owns a heap buffer through its
`Vec`, and exactly one binding may own that buffer, because whoever owns it
frees it. Copying the three words of the `Vec` header without copying the
buffer would leave two owners of one allocation, which is the bug the whole
ownership system exists to prevent. So the assignment is a move and `g` is dead
afterwards.

rustc suggests `.clone()`, and here the suggestion is right rather than a way
of quietening the compiler: you genuinely want a second grid, holding the
starting position, that survives while the first one steps forward.

@diagnose E0596
`cannot borrow g as mutable`. Reassigning `g` inside the loop needs the binding
to allow it, so it has to be `let mut g`. The `mut` is about the binding and
not the type, which is why the same `Grid` can be immutable in one function and
mutable in another.

@after
A glider is a period-4 oscillator that comes back one cell along each
diagonal, so four generations translate it by `(1, 1)` and forty carry it right
around a 10 by 10 torus and back to exactly where it started. The tests check
both, and the second one is a real test of the wrapping from stage 2: get
`rem_euclid` wrong and the pattern falls apart the moment it touches an edge.

Where to go from here. A board of a few thousand cells a side wants the bitset
that stage 1 traded away, packing 64 cells per `u64` and counting neighbours
with shifts. And once you are simulating millions of generations, HashLife is
waiting: it hashes repeated square regions of space and time, and because Life
patterns repeat themselves constantly, it can skip ahead by billions of
generations in seconds.
