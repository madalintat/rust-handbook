---
project: raytracer
tier: core
domain: graphics
title: A ray tracer
accent: slate
blurb: Operator overloading turns the vector maths back into maths and one trait turns "anything a ray can hit" into a type, and eight stages later an image comes out.
needs: 08-structs, 14-traits, 17-iterators
mins: 80
---

A ray tracer asks one question per pixel: fire a line out through it, and what
does that line meet first? Everything else in a renderer hangs off the answer.
Cycles, Arnold and RenderMan are that question asked a few billion times, with
far better sampling and a great deal of care about which rays are worth firing
at all.

The maths is vector arithmetic and one quadratic, so the code can be short.
Rust makes it shorter than you might expect. `std::ops` lets a struct own `+`
and `*`, so the parametric line a textbook writes as `p = origin + dir * t` is
that line here, rather than `vec3_add(origin, vec3_scale(dir, t))`. And the
scene is a genuinely mixed bag: a sphere is a centre and a radius, a plane is a
height, and the two share no fields whatsoever. What they share is that a ray
can hit them and come back with a distance. That is a trait, and the scene is a
`Vec<Box<dyn Hittable>>`.

Eight stages: a vector type with operators, a camera that turns pixel
coordinates into rays, sphere intersection, a world of trait objects, surface
normals against a sky gradient, antialiasing from a seeded generator,
lambertian and metal materials, and a PPM file you can open. Around 250 lines
by the end, rendering 40 by 20 pixels at four samples each so that it finishes
while you watch.

It is a toy, and the honest list of what a real renderer adds is long. A
bounding volume hierarchy, so a scene of a million triangles does not test
every one of them against every ray. Importance sampling, so a pixel settles in
tens of samples instead of thousands. Triangle meshes, textures, refraction,
depth of field. None of that changes the loop below. It changes how many rays
you need, and how quickly each one finds its answer.

## 1. Vectors that add up

@kind fix
@concept associated type

@expect E0046

Everything in a renderer is a three-component vector: points, directions,
colours. These five operator impls are the whole of the vector arithmetic, and
one of them is missing a line that every `std::ops` impl has to carry. `dot`
and `cross` are already written.

```starter
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

pub const fn vec3(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3 { x, y, z }
}

impl std::ops::Add for Vec3 {
    type Output = Vec3;
    fn add(self, o: Vec3) -> Vec3 { vec3(self.x + o.x, self.y + o.y, self.z + o.z) }
}

impl std::ops::Sub for Vec3 {
    type Output = Vec3;
    fn sub(self, o: Vec3) -> Vec3 { vec3(self.x - o.x, self.y - o.y, self.z - o.z) }
}

impl std::ops::Mul<f64> for Vec3 {
    fn mul(self, k: f64) -> Vec3 { vec3(self.x * k, self.y * k, self.z * k) }
}

impl std::ops::Mul<Vec3> for Vec3 {
    type Output = Vec3;
    fn mul(self, o: Vec3) -> Vec3 { vec3(self.x * o.x, self.y * o.y, self.z * o.z) }
}

impl std::ops::Neg for Vec3 {
    type Output = Vec3;
    fn neg(self) -> Vec3 { vec3(-self.x, -self.y, -self.z) }
}

impl Vec3 {
    pub fn dot(self, o: Vec3) -> f64 { self.x * o.x + self.y * o.y + self.z * o.z }

    pub fn cross(self, o: Vec3) -> Vec3 {
        vec3(self.y * o.z - self.z * o.y,
             self.z * o.x - self.x * o.z,
             self.x * o.y - self.y * o.x)
    }

    pub fn length_squared(self) -> f64 { self.dot(self) }

    pub fn length(self) -> f64 { self.length_squared().sqrt() }

    pub fn unit(self) -> Vec3 { self * (1.0 / self.length()) }
}
pub fn run() -> Vec3 {
    let a = vec3(3.0, 0.0, 0.0);
    let b = vec3(0.0, 4.0, 0.0);
    println!("a       = {a:?}");
    println!("b       = {b:?}");
    println!("a + b   = {:?}", a + b);
    println!("a - b   = {:?}", a - b);
    println!("a * 2   = {:?}", a * 2.0);
    println!("-a      = {:?}", -a);
    println!("a . b   = {}", a.dot(b));
    println!("a x b   = {:?}", a.cross(b));
    println!("|a + b| = {}", (a + b).length());
    (a + b).unit()
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: Vec3, b: Vec3) -> bool { (a - b).length() < 1e-12 }

    #[test]
    fn run_normalises_three_four_zero() {
        assert!(close(run(), vec3(0.6, 0.8, 0.0)));
    }

    #[test]
    fn arithmetic_is_componentwise() {
        let a = vec3(1.0, 2.0, 3.0);
        let b = vec3(0.5, 0.5, 0.5);
        assert!(close(a + b, vec3(1.5, 2.5, 3.5)));
        assert!(close(a - b, vec3(0.5, 1.5, 2.5)));
        assert!(close(a * 2.0, vec3(2.0, 4.0, 6.0)));
        assert!(close(a * b, vec3(0.5, 1.0, 1.5)));
        assert!(close(-a, vec3(-1.0, -2.0, -3.0)));
        assert!(close(a + -a, vec3(0.0, 0.0, 0.0)));
    }

    #[test]
    fn dot_measures_alignment() {
        let x = vec3(1.0, 0.0, 0.0);
        let y = vec3(0.0, 1.0, 0.0);
        assert!(x.dot(y).abs() < 1e-12);
        assert!((x.dot(x) - 1.0).abs() < 1e-12);
        assert!((x.dot(-x) + 1.0).abs() < 1e-12);
    }

    #[test]
    fn cross_is_perpendicular_and_right_handed() {
        let x = vec3(1.0, 0.0, 0.0);
        let y = vec3(0.0, 1.0, 0.0);
        assert!(close(x.cross(y), vec3(0.0, 0.0, 1.0)));
        assert!(close(y.cross(x), vec3(0.0, 0.0, -1.0)));

        let a = vec3(2.0, -1.0, 4.0);
        let b = vec3(0.5, 3.0, -2.0);
        assert!(a.cross(b).dot(a).abs() < 1e-12);
        assert!(a.cross(b).dot(b).abs() < 1e-12);
    }

    #[test]
    fn unit_keeps_the_direction_and_drops_the_length() {
        let d = vec3(3.0, -4.0, 12.0);
        assert!((d.length() - 13.0).abs() < 1e-12);
        assert!((d.unit().length() - 1.0).abs() < 1e-12);
        assert!(close(d.unit() * 13.0, d));
    }
}
```

```solution
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

pub const fn vec3(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3 { x, y, z }
}

impl std::ops::Add for Vec3 {
    type Output = Vec3;
    fn add(self, o: Vec3) -> Vec3 { vec3(self.x + o.x, self.y + o.y, self.z + o.z) }
}

impl std::ops::Sub for Vec3 {
    type Output = Vec3;
    fn sub(self, o: Vec3) -> Vec3 { vec3(self.x - o.x, self.y - o.y, self.z - o.z) }
}

impl std::ops::Mul<f64> for Vec3 {
    type Output = Vec3;
    fn mul(self, k: f64) -> Vec3 { vec3(self.x * k, self.y * k, self.z * k) }
}

impl std::ops::Mul<Vec3> for Vec3 {
    type Output = Vec3;
    fn mul(self, o: Vec3) -> Vec3 { vec3(self.x * o.x, self.y * o.y, self.z * o.z) }
}

impl std::ops::Neg for Vec3 {
    type Output = Vec3;
    fn neg(self) -> Vec3 { vec3(-self.x, -self.y, -self.z) }
}

impl Vec3 {
    pub fn dot(self, o: Vec3) -> f64 { self.x * o.x + self.y * o.y + self.z * o.z }

    pub fn cross(self, o: Vec3) -> Vec3 {
        vec3(self.y * o.z - self.z * o.y,
             self.z * o.x - self.x * o.z,
             self.x * o.y - self.y * o.x)
    }

    pub fn length_squared(self) -> f64 { self.dot(self) }

    pub fn length(self) -> f64 { self.length_squared().sqrt() }

    pub fn unit(self) -> Vec3 { self * (1.0 / self.length()) }
}
pub fn run() -> Vec3 {
    let a = vec3(3.0, 0.0, 0.0);
    let b = vec3(0.0, 4.0, 0.0);
    println!("a       = {a:?}");
    println!("b       = {b:?}");
    println!("a + b   = {:?}", a + b);
    println!("a - b   = {:?}", a - b);
    println!("a * 2   = {:?}", a * 2.0);
    println!("-a      = {:?}", -a);
    println!("a . b   = {}", a.dot(b));
    println!("a x b   = {:?}", a.cross(b));
    println!("|a + b| = {}", (a + b).length());
    (a + b).unit()
}
```

@hint Compare the `Mul<f64>` block with the `Add` block above it. One of them has a line the other does not.
@hint `std::ops::Mul` declares an associated type as well as a method, and an impl owes both. rustc will not infer it from the body of `mul`.
@hint `type Output = Vec3;` as the first line inside the impl block.

@diagnose E0046
`not all trait items implemented, missing: Output`.

A trait is a list of items an impl has to supply, and an associated type counts
as one. `Mul` is declared roughly as `trait Mul<Rhs = Self> { type Output; fn
mul(self, rhs: Rhs) -> Self::Output; }`, so your impl owes a type and a
function. rustc will not read the `-> Vec3` you wrote on `mul` and work
backwards, because inference operates inside a function body and never across a
signature.

`Output` exists because multiplication need not return the type it started
from. `Vec3 * f64` gives a `Vec3`, `Matrix * Vector` would give a `Vector`, and
`Duration * u32` gives a `Duration`. The associated type is where each impl
states what comes out.

@diagnose E0308
Look at what you set `Output` to against what `mul` returns. If `Output` is
`f64` and the body builds a `Vec3`, rustc reports the body as wrong, because
the associated type is the declaration and the function has to match it. The
one to change is whichever is lying.

@after
Operator overloading has a bad name from languages where `+` can be made to
mean anything at all. Rust's version is narrower on purpose. `+` is `Add::add`
and nothing else, so a reader who knows the trait knows the method that runs.
The orphan rule adds the other half: only the crate defining `Vec3` or the
crate defining `Add` may write this impl, so two libraries cannot disagree
about what `Vec3 + Vec3` means.

The payoff arrives in the next seven stages. `origin + dir * t` stays the
parametric line from the textbook instead of turning into nested function
calls.

## 2. A camera that fires rays

@kind fix
@concept receiver

@expect E0382

A ray is a starting point and a direction. The camera turns a pixel
coordinate `(u, v)` in the unit square into one, through a viewport two units
tall sitting one unit in front of the eye. `ray` is correct in isolation. The
loop that calls it five times is not.

```starter
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

pub const fn vec3(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3 { x, y, z }
}

impl std::ops::Add for Vec3 {
    type Output = Vec3;
    fn add(self, o: Vec3) -> Vec3 { vec3(self.x + o.x, self.y + o.y, self.z + o.z) }
}

impl std::ops::Sub for Vec3 {
    type Output = Vec3;
    fn sub(self, o: Vec3) -> Vec3 { vec3(self.x - o.x, self.y - o.y, self.z - o.z) }
}

impl std::ops::Mul<f64> for Vec3 {
    type Output = Vec3;
    fn mul(self, k: f64) -> Vec3 { vec3(self.x * k, self.y * k, self.z * k) }
}

impl std::ops::Mul<Vec3> for Vec3 {
    type Output = Vec3;
    fn mul(self, o: Vec3) -> Vec3 { vec3(self.x * o.x, self.y * o.y, self.z * o.z) }
}

impl std::ops::Neg for Vec3 {
    type Output = Vec3;
    fn neg(self) -> Vec3 { vec3(-self.x, -self.y, -self.z) }
}

impl Vec3 {
    pub fn dot(self, o: Vec3) -> f64 { self.x * o.x + self.y * o.y + self.z * o.z }

    pub fn cross(self, o: Vec3) -> Vec3 {
        vec3(self.y * o.z - self.z * o.y,
             self.z * o.x - self.x * o.z,
             self.x * o.y - self.y * o.x)
    }

    pub fn length_squared(self) -> f64 { self.dot(self) }

    pub fn length(self) -> f64 { self.length_squared().sqrt() }

    pub fn unit(self) -> Vec3 { self * (1.0 / self.length()) }
}
#[derive(Debug, Clone, Copy)]
pub struct Ray {
    pub origin: Vec3,
    pub dir: Vec3,
}

impl Ray {
    pub fn at(self, t: f64) -> Vec3 { self.origin + self.dir * t }
}

pub struct Camera {
    pub origin: Vec3,
    pub lower_left: Vec3,
    pub horizontal: Vec3,
    pub vertical: Vec3,
}

impl Camera {
    pub fn new(aspect: f64) -> Camera {
        let height = 2.0;
        let origin = vec3(0.0, 0.0, 0.0);
        let horizontal = vec3(aspect * height, 0.0, 0.0);
        let vertical = vec3(0.0, height, 0.0);
        Camera {
            origin,
            horizontal,
            vertical,
            lower_left: origin - horizontal * 0.5 - vertical * 0.5 - vec3(0.0, 0.0, 1.0),
        }
    }

    pub fn ray(self, u: f64, v: f64) -> Ray {
        Ray {
            origin: self.origin,
            dir: self.lower_left + self.horizontal * u + self.vertical * v - self.origin,
        }
    }
}
/// Five pixel coordinates: bottom left, top right, then three across the middle.
pub const PROBES: [(f64, f64); 5] =
    [(0.0, 0.0), (1.0, 1.0), (0.4, 0.5), (0.5, 0.5), (0.65, 0.5)];
pub fn run() -> Vec<Ray> {
    let camera = Camera::new(2.0);
    let mut rays = Vec::new();
    for &(u, v) in &PROBES {
        rays.push(camera.ray(u, v));
    }
    for (r, &(u, v)) in rays.iter().zip(&PROBES) {
        println!("pixel ({u}, {v}) -> direction {:?}", r.dir);
    }
    println!("two units along the centre ray: {:?}", rays[3].at(2.0));
    rays
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: Vec3, b: Vec3) -> bool { (a - b).length() < 1e-12 }

    #[test]
    fn the_centre_pixel_looks_straight_ahead() {
        let rays = run();
        assert_eq!(rays.len(), 5);
        assert!(close(rays[3].dir, vec3(0.0, 0.0, -1.0)));
    }

    #[test]
    fn every_ray_leaves_the_same_point() {
        for r in run() {
            assert!(close(r.origin, vec3(0.0, 0.0, 0.0)));
        }
    }

    #[test]
    fn the_corners_span_the_viewport() {
        let camera = Camera::new(2.0);
        assert!(close(camera.ray(0.0, 0.0).dir, vec3(-2.0, -1.0, -1.0)));
        assert!(close(camera.ray(1.0, 1.0).dir, vec3(2.0, 1.0, -1.0)));
        // u runs left to right, v runs bottom to top
        assert!(camera.ray(0.0, 0.5).dir.x < camera.ray(1.0, 0.5).dir.x);
        assert!(camera.ray(0.5, 0.0).dir.y < camera.ray(0.5, 1.0).dir.y);
    }

    #[test]
    fn at_walks_along_the_ray() {
        let r = Ray { origin: vec3(1.0, 2.0, 3.0), dir: vec3(0.0, 0.0, -1.0) };
        assert!(close(r.at(0.0), r.origin));
        assert!(close(r.at(2.5), vec3(1.0, 2.0, 0.5)));
        assert!(close(r.at(-1.0), vec3(1.0, 2.0, 4.0)));
    }

    #[test]
    fn a_wider_aspect_widens_only_the_x_axis() {
        let square = Camera::new(1.0);
        let wide = Camera::new(4.0);
        assert!((square.horizontal.x - 2.0).abs() < 1e-12);
        assert!((wide.horizontal.x - 8.0).abs() < 1e-12);
        assert!((square.vertical.y - wide.vertical.y).abs() < 1e-12);
    }
}
```

```solution
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

pub const fn vec3(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3 { x, y, z }
}

impl std::ops::Add for Vec3 {
    type Output = Vec3;
    fn add(self, o: Vec3) -> Vec3 { vec3(self.x + o.x, self.y + o.y, self.z + o.z) }
}

impl std::ops::Sub for Vec3 {
    type Output = Vec3;
    fn sub(self, o: Vec3) -> Vec3 { vec3(self.x - o.x, self.y - o.y, self.z - o.z) }
}

impl std::ops::Mul<f64> for Vec3 {
    type Output = Vec3;
    fn mul(self, k: f64) -> Vec3 { vec3(self.x * k, self.y * k, self.z * k) }
}

impl std::ops::Mul<Vec3> for Vec3 {
    type Output = Vec3;
    fn mul(self, o: Vec3) -> Vec3 { vec3(self.x * o.x, self.y * o.y, self.z * o.z) }
}

impl std::ops::Neg for Vec3 {
    type Output = Vec3;
    fn neg(self) -> Vec3 { vec3(-self.x, -self.y, -self.z) }
}

impl Vec3 {
    pub fn dot(self, o: Vec3) -> f64 { self.x * o.x + self.y * o.y + self.z * o.z }

    pub fn cross(self, o: Vec3) -> Vec3 {
        vec3(self.y * o.z - self.z * o.y,
             self.z * o.x - self.x * o.z,
             self.x * o.y - self.y * o.x)
    }

    pub fn length_squared(self) -> f64 { self.dot(self) }

    pub fn length(self) -> f64 { self.length_squared().sqrt() }

    pub fn unit(self) -> Vec3 { self * (1.0 / self.length()) }
}
#[derive(Debug, Clone, Copy)]
pub struct Ray {
    pub origin: Vec3,
    pub dir: Vec3,
}

impl Ray {
    pub fn at(self, t: f64) -> Vec3 { self.origin + self.dir * t }
}

pub struct Camera {
    pub origin: Vec3,
    pub lower_left: Vec3,
    pub horizontal: Vec3,
    pub vertical: Vec3,
}

impl Camera {
    pub fn new(aspect: f64) -> Camera {
        let height = 2.0;
        let origin = vec3(0.0, 0.0, 0.0);
        let horizontal = vec3(aspect * height, 0.0, 0.0);
        let vertical = vec3(0.0, height, 0.0);
        Camera {
            origin,
            horizontal,
            vertical,
            lower_left: origin - horizontal * 0.5 - vertical * 0.5 - vec3(0.0, 0.0, 1.0),
        }
    }

    pub fn ray(&self, u: f64, v: f64) -> Ray {
        Ray {
            origin: self.origin,
            dir: self.lower_left + self.horizontal * u + self.vertical * v - self.origin,
        }
    }
}
/// Five pixel coordinates: bottom left, top right, then three across the middle.
pub const PROBES: [(f64, f64); 5] =
    [(0.0, 0.0), (1.0, 1.0), (0.4, 0.5), (0.5, 0.5), (0.65, 0.5)];
pub fn run() -> Vec<Ray> {
    let camera = Camera::new(2.0);
    let mut rays = Vec::new();
    for &(u, v) in &PROBES {
        rays.push(camera.ray(u, v));
    }
    for (r, &(u, v)) in rays.iter().zip(&PROBES) {
        println!("pixel ({u}, {v}) -> direction {:?}", r.dir);
    }
    println!("two units along the centre ray: {:?}", rays[3].at(2.0));
    rays
}
```

@hint The error is not inside `ray`. It is about what `ray` does to the camera, which the next iteration then wants back.
@hint A method whose receiver is `self` consumes it. `Camera` holds four `Vec3` fields and does not derive `Copy`, so the first call is the only call.
@hint `pub fn ray(&self, u: f64, v: f64) -> Ray`. The body needs no change, because it only reads fields.

@diagnose E0382
`use of moved value: camera`, and underneath, `camera moved due to this method
call, in previous iteration of loop`.

The receiver is the first parameter of a method and it comes in three forms.
`&self` borrows and gives back. `&mut self` borrows exclusively and gives back.
Plain `self` takes ownership, and the caller's binding is dead from that point
on. You wrote the third and meant the first.

Notice the phrase `in previous iteration of loop`. A single call would have
compiled: moving out of `camera` once is legal if nothing reads it afterwards.
The loop is what makes it an error, because the second iteration reaches for a
binding the first gave away. rustc reports the use, not the move, since the use
is the part that would have been unsound.

@diagnose E0507
`cannot move out of camera, a captured variable in an FnMut closure`. Same
cause, reached through a closure instead of a loop. A closure that calls a
`self` method has to move the camera into itself, and `map` needs to call that
closure once per item, so it must be `FnMut`, which cannot give away what it
captured. Taking `&self` makes the closure borrow rather than consume.

@after
`&self` is the default for a reason beyond correctness. `Camera` is four
`Vec3` values, 96 bytes, and this loop runs once per sample per pixel. Taking
`self` by value would copy those 96 bytes every time, where `&self` passes one
8-byte address.

Deriving `Copy` would also have made the error go away, and it is the wrong
fix here for the same reason: it silences the compiler by agreeing to the
copy rather than by not making one.

## 3. The quadratic, and the nearer root

@kind fix
@concept Option

@expect E0308

A ray meets a sphere where the distance from the centre equals the radius,
which multiplies out into a quadratic in `t`. A negative discriminant is a
miss. Two roots mean the ray goes in one side and out the other. The body picks
the right root and then fails to return it.

```starter
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

pub const fn vec3(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3 { x, y, z }
}

impl std::ops::Add for Vec3 {
    type Output = Vec3;
    fn add(self, o: Vec3) -> Vec3 { vec3(self.x + o.x, self.y + o.y, self.z + o.z) }
}

impl std::ops::Sub for Vec3 {
    type Output = Vec3;
    fn sub(self, o: Vec3) -> Vec3 { vec3(self.x - o.x, self.y - o.y, self.z - o.z) }
}

impl std::ops::Mul<f64> for Vec3 {
    type Output = Vec3;
    fn mul(self, k: f64) -> Vec3 { vec3(self.x * k, self.y * k, self.z * k) }
}

impl std::ops::Mul<Vec3> for Vec3 {
    type Output = Vec3;
    fn mul(self, o: Vec3) -> Vec3 { vec3(self.x * o.x, self.y * o.y, self.z * o.z) }
}

impl std::ops::Neg for Vec3 {
    type Output = Vec3;
    fn neg(self) -> Vec3 { vec3(-self.x, -self.y, -self.z) }
}

impl Vec3 {
    pub fn dot(self, o: Vec3) -> f64 { self.x * o.x + self.y * o.y + self.z * o.z }

    pub fn cross(self, o: Vec3) -> Vec3 {
        vec3(self.y * o.z - self.z * o.y,
             self.z * o.x - self.x * o.z,
             self.x * o.y - self.y * o.x)
    }

    pub fn length_squared(self) -> f64 { self.dot(self) }

    pub fn length(self) -> f64 { self.length_squared().sqrt() }

    pub fn unit(self) -> Vec3 { self * (1.0 / self.length()) }
}
#[derive(Debug, Clone, Copy)]
pub struct Ray {
    pub origin: Vec3,
    pub dir: Vec3,
}

impl Ray {
    pub fn at(self, t: f64) -> Vec3 { self.origin + self.dir * t }
}

pub struct Camera {
    pub origin: Vec3,
    pub lower_left: Vec3,
    pub horizontal: Vec3,
    pub vertical: Vec3,
}

impl Camera {
    pub fn new(aspect: f64) -> Camera {
        let height = 2.0;
        let origin = vec3(0.0, 0.0, 0.0);
        let horizontal = vec3(aspect * height, 0.0, 0.0);
        let vertical = vec3(0.0, height, 0.0);
        Camera {
            origin,
            horizontal,
            vertical,
            lower_left: origin - horizontal * 0.5 - vertical * 0.5 - vec3(0.0, 0.0, 1.0),
        }
    }

    pub fn ray(&self, u: f64, v: f64) -> Ray {
        Ray {
            origin: self.origin,
            dir: self.lower_left + self.horizontal * u + self.vertical * v - self.origin,
        }
    }
}
/// Five pixel coordinates: bottom left, top right, then three across the middle.
pub const PROBES: [(f64, f64); 5] =
    [(0.0, 0.0), (1.0, 1.0), (0.4, 0.5), (0.5, 0.5), (0.65, 0.5)];
pub fn hit_sphere(centre: Vec3, radius: f64, r: &Ray, t_min: f64, t_max: f64) -> Option<f64> {
    let oc = r.origin - centre;
    let a = r.dir.length_squared();
    let half_b = oc.dot(r.dir);
    let c = oc.length_squared() - radius * radius;

    let disc = half_b * half_b - a * c;
    if disc < 0.0 {
        return None;
    }
    let sqrtd = disc.sqrt();

    let mut root = (-half_b - sqrtd) / a;
    if root < t_min || root > t_max {
        root = (-half_b + sqrtd) / a;
        if root < t_min || root > t_max {
            return None;
        }
    }
    root
}
pub fn run() -> Vec<Option<f64>> {
    let centre = vec3(0.0, 0.0, -2.0);
    let camera = Camera::new(2.0);
    let mut roots = Vec::new();
    for &(u, v) in &PROBES {
        let r = camera.ray(u, v);
        let root = hit_sphere(centre, 1.0, &r, 0.001, f64::INFINITY);
        match root {
            Some(t) => println!("pixel ({u}, {v}) hits at t = {t:.4}, point {:?}", r.at(t)),
            None => println!("pixel ({u}, {v}) misses"),
        }
        roots.push(root);
    }
    roots
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    const FAR: f64 = f64::INFINITY;

    #[test]
    fn the_centre_ray_reaches_the_front_of_the_sphere() {
        let roots = run();
        assert_eq!(roots.len(), 5);
        assert!(roots[0].is_none());
        assert!(roots[1].is_none());
        assert!((roots[3].unwrap() - 1.0).abs() < 1e-9);
    }

    #[test]
    fn the_nearer_root_wins() {
        // Centre 2 away, radius 0.5: the two roots are 1.5 and 2.5.
        let r = Ray { origin: vec3(0.0, 0.0, 0.0), dir: vec3(0.0, 0.0, -1.0) };
        let t = hit_sphere(vec3(0.0, 0.0, -2.0), 0.5, &r, 0.001, FAR).unwrap();
        assert!((t - 1.5).abs() < 1e-9);
    }

    #[test]
    fn the_far_root_is_the_fallback_not_the_answer() {
        let r = Ray { origin: vec3(0.0, 0.0, 0.0), dir: vec3(0.0, 0.0, -1.0) };
        // Ruling out everything nearer than 2.0 leaves the second root.
        let t = hit_sphere(vec3(0.0, 0.0, -2.0), 0.5, &r, 2.0, FAR).unwrap();
        assert!((t - 2.5).abs() < 1e-9);
        // And ruling out both leaves nothing.
        assert!(hit_sphere(vec3(0.0, 0.0, -2.0), 0.5, &r, 0.001, 1.0).is_none());
    }

    #[test]
    fn a_ray_that_starts_inside_leaves_through_the_back() {
        let r = Ray { origin: vec3(0.0, 0.0, -2.0), dir: vec3(0.0, 0.0, -1.0) };
        let t = hit_sphere(vec3(0.0, 0.0, -2.0), 0.5, &r, 0.001, FAR).unwrap();
        assert!((t - 0.5).abs() < 1e-9);
    }

    #[test]
    fn a_miss_is_none_and_behind_is_none() {
        let r = Ray { origin: vec3(0.0, 0.0, 0.0), dir: vec3(0.0, 1.0, 0.0) };
        assert!(hit_sphere(vec3(0.0, 0.0, -2.0), 0.5, &r, 0.001, FAR).is_none());

        // The sphere is behind the camera, so both roots are negative.
        let back = Ray { origin: vec3(0.0, 0.0, 0.0), dir: vec3(0.0, 0.0, 1.0) };
        assert!(hit_sphere(vec3(0.0, 0.0, -2.0), 0.5, &back, 0.001, FAR).is_none());
    }

    #[test]
    fn the_hit_point_sits_on_the_surface() {
        let camera = Camera::new(2.0);
        let centre = vec3(0.0, 0.0, -2.0);
        for &(u, v) in &PROBES {
            let r = camera.ray(u, v);
            if let Some(t) = hit_sphere(centre, 1.0, &r, 0.001, FAR) {
                assert!(((r.at(t) - centre).length() - 1.0).abs() < 1e-9);
            }
        }
    }
}
```

```solution
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

pub const fn vec3(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3 { x, y, z }
}

impl std::ops::Add for Vec3 {
    type Output = Vec3;
    fn add(self, o: Vec3) -> Vec3 { vec3(self.x + o.x, self.y + o.y, self.z + o.z) }
}

impl std::ops::Sub for Vec3 {
    type Output = Vec3;
    fn sub(self, o: Vec3) -> Vec3 { vec3(self.x - o.x, self.y - o.y, self.z - o.z) }
}

impl std::ops::Mul<f64> for Vec3 {
    type Output = Vec3;
    fn mul(self, k: f64) -> Vec3 { vec3(self.x * k, self.y * k, self.z * k) }
}

impl std::ops::Mul<Vec3> for Vec3 {
    type Output = Vec3;
    fn mul(self, o: Vec3) -> Vec3 { vec3(self.x * o.x, self.y * o.y, self.z * o.z) }
}

impl std::ops::Neg for Vec3 {
    type Output = Vec3;
    fn neg(self) -> Vec3 { vec3(-self.x, -self.y, -self.z) }
}

impl Vec3 {
    pub fn dot(self, o: Vec3) -> f64 { self.x * o.x + self.y * o.y + self.z * o.z }

    pub fn cross(self, o: Vec3) -> Vec3 {
        vec3(self.y * o.z - self.z * o.y,
             self.z * o.x - self.x * o.z,
             self.x * o.y - self.y * o.x)
    }

    pub fn length_squared(self) -> f64 { self.dot(self) }

    pub fn length(self) -> f64 { self.length_squared().sqrt() }

    pub fn unit(self) -> Vec3 { self * (1.0 / self.length()) }
}
#[derive(Debug, Clone, Copy)]
pub struct Ray {
    pub origin: Vec3,
    pub dir: Vec3,
}

impl Ray {
    pub fn at(self, t: f64) -> Vec3 { self.origin + self.dir * t }
}

pub struct Camera {
    pub origin: Vec3,
    pub lower_left: Vec3,
    pub horizontal: Vec3,
    pub vertical: Vec3,
}

impl Camera {
    pub fn new(aspect: f64) -> Camera {
        let height = 2.0;
        let origin = vec3(0.0, 0.0, 0.0);
        let horizontal = vec3(aspect * height, 0.0, 0.0);
        let vertical = vec3(0.0, height, 0.0);
        Camera {
            origin,
            horizontal,
            vertical,
            lower_left: origin - horizontal * 0.5 - vertical * 0.5 - vec3(0.0, 0.0, 1.0),
        }
    }

    pub fn ray(&self, u: f64, v: f64) -> Ray {
        Ray {
            origin: self.origin,
            dir: self.lower_left + self.horizontal * u + self.vertical * v - self.origin,
        }
    }
}
/// Five pixel coordinates: bottom left, top right, then three across the middle.
pub const PROBES: [(f64, f64); 5] =
    [(0.0, 0.0), (1.0, 1.0), (0.4, 0.5), (0.5, 0.5), (0.65, 0.5)];
pub fn hit_sphere(centre: Vec3, radius: f64, r: &Ray, t_min: f64, t_max: f64) -> Option<f64> {
    let oc = r.origin - centre;
    let a = r.dir.length_squared();
    let half_b = oc.dot(r.dir);
    let c = oc.length_squared() - radius * radius;

    let disc = half_b * half_b - a * c;
    if disc < 0.0 {
        return None;
    }
    let sqrtd = disc.sqrt();

    let mut root = (-half_b - sqrtd) / a;
    if root < t_min || root > t_max {
        root = (-half_b + sqrtd) / a;
        if root < t_min || root > t_max {
            return None;
        }
    }
    Some(root)
}
pub fn run() -> Vec<Option<f64>> {
    let centre = vec3(0.0, 0.0, -2.0);
    let camera = Camera::new(2.0);
    let mut roots = Vec::new();
    for &(u, v) in &PROBES {
        let r = camera.ray(u, v);
        let root = hit_sphere(centre, 1.0, &r, 0.001, f64::INFINITY);
        match root {
            Some(t) => println!("pixel ({u}, {v}) hits at t = {t:.4}, point {:?}", r.at(t)),
            None => println!("pixel ({u}, {v}) misses"),
        }
        roots.push(root);
    }
    roots
}
```

@hint Read the return type, then read the last expression of the function.
@hint A function promising `Option<f64>` cannot hand back a bare `f64`, even at a point where it definitely has one.
@hint `Some(root)`.

@diagnose E0308
`expected Option<f64>, found f64`.

`Option` is an ordinary enum, not an annotation on the type, so wrapping is a
constructor call rather than a coercion. Rust has no implicit boxing of a value
into an optional, which is exactly why an `Option<f64>` in a signature is worth
something: every path out of the function has to say which variant it is
producing.

The two early returns already say `None`. The last line is the one that found
an answer, so it says `Some`. Notice that the compiler caught this without any
help from you, and that in a language with a nullable float the same mistake
compiles and returns a number that means "no intersection" to nobody.

@diagnose E0599
`no method named sqrt found for type {integer}`. A literal with no decimal
point is an integer, and integers have no `sqrt`. If `disc` came out as an
integer, one of the values feeding it was written `0` or `2` rather than `0.0`
or `2.0`, and the inference propagated backwards from there. Give every literal
in this function a decimal point.

@after
Two details in that function are worth keeping.

The quadratic is usually written with `b`, and here it is written with
`half_b`, which is `b / 2`. Substituting it into the formula cancels the 2 in
the denominator and turns the 4 under the square root into a 1, so the
arithmetic gets shorter and one multiplication disappears. Every renderer does
this.

And `t_min` is 0.001 rather than 0. A ray that has just bounced off a surface
starts exactly on it, and floating point will sometimes place that start point
a hair inside. Without the epsilon the ray immediately hits the surface it left
and the picture fills with black speckles.

## 4. Anything a ray can hit

@kind fix
@concept trait object

@expect E0277

A sphere is a centre and a radius. A plane is a height. They share no fields,
and the renderer does not care: it wants the nearest hit along a ray.
`Hittable` is that contract. `scene` tries to return the two shapes in one
`Vec` and asks for an element type that cannot exist.

```starter
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

pub const fn vec3(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3 { x, y, z }
}

impl std::ops::Add for Vec3 {
    type Output = Vec3;
    fn add(self, o: Vec3) -> Vec3 { vec3(self.x + o.x, self.y + o.y, self.z + o.z) }
}

impl std::ops::Sub for Vec3 {
    type Output = Vec3;
    fn sub(self, o: Vec3) -> Vec3 { vec3(self.x - o.x, self.y - o.y, self.z - o.z) }
}

impl std::ops::Mul<f64> for Vec3 {
    type Output = Vec3;
    fn mul(self, k: f64) -> Vec3 { vec3(self.x * k, self.y * k, self.z * k) }
}

impl std::ops::Mul<Vec3> for Vec3 {
    type Output = Vec3;
    fn mul(self, o: Vec3) -> Vec3 { vec3(self.x * o.x, self.y * o.y, self.z * o.z) }
}

impl std::ops::Neg for Vec3 {
    type Output = Vec3;
    fn neg(self) -> Vec3 { vec3(-self.x, -self.y, -self.z) }
}

impl Vec3 {
    pub fn dot(self, o: Vec3) -> f64 { self.x * o.x + self.y * o.y + self.z * o.z }

    pub fn cross(self, o: Vec3) -> Vec3 {
        vec3(self.y * o.z - self.z * o.y,
             self.z * o.x - self.x * o.z,
             self.x * o.y - self.y * o.x)
    }

    pub fn length_squared(self) -> f64 { self.dot(self) }

    pub fn length(self) -> f64 { self.length_squared().sqrt() }

    pub fn unit(self) -> Vec3 { self * (1.0 / self.length()) }
}
#[derive(Debug, Clone, Copy)]
pub struct Ray {
    pub origin: Vec3,
    pub dir: Vec3,
}

impl Ray {
    pub fn at(self, t: f64) -> Vec3 { self.origin + self.dir * t }
}

pub struct Camera {
    pub origin: Vec3,
    pub lower_left: Vec3,
    pub horizontal: Vec3,
    pub vertical: Vec3,
}

impl Camera {
    pub fn new(aspect: f64) -> Camera {
        let height = 2.0;
        let origin = vec3(0.0, 0.0, 0.0);
        let horizontal = vec3(aspect * height, 0.0, 0.0);
        let vertical = vec3(0.0, height, 0.0);
        Camera {
            origin,
            horizontal,
            vertical,
            lower_left: origin - horizontal * 0.5 - vertical * 0.5 - vec3(0.0, 0.0, 1.0),
        }
    }

    pub fn ray(&self, u: f64, v: f64) -> Ray {
        Ray {
            origin: self.origin,
            dir: self.lower_left + self.horizontal * u + self.vertical * v - self.origin,
        }
    }
}
/// Five pixel coordinates: bottom left, top right, then three across the middle.
pub const PROBES: [(f64, f64); 5] =
    [(0.0, 0.0), (1.0, 1.0), (0.4, 0.5), (0.5, 0.5), (0.65, 0.5)];
pub fn hit_sphere(centre: Vec3, radius: f64, r: &Ray, t_min: f64, t_max: f64) -> Option<f64> {
    let oc = r.origin - centre;
    let a = r.dir.length_squared();
    let half_b = oc.dot(r.dir);
    let c = oc.length_squared() - radius * radius;

    let disc = half_b * half_b - a * c;
    if disc < 0.0 {
        return None;
    }
    let sqrtd = disc.sqrt();

    let mut root = (-half_b - sqrtd) / a;
    if root < t_min || root > t_max {
        root = (-half_b + sqrtd) / a;
        if root < t_min || root > t_max {
            return None;
        }
    }
    Some(root)
}
pub struct Hit {
    pub t: f64,
    pub p: Vec3,
}

pub trait Hittable {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit>;
}

pub struct Sphere {
    pub centre: Vec3,
    pub radius: f64,
}

pub struct Plane {
    pub y: f64,
}

impl Hittable for Sphere {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
        let t = hit_sphere(self.centre, self.radius, r, t_min, t_max)?;
        Some(Hit { t, p: r.at(t) })
    }
}

impl Hittable for Plane {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
        if r.dir.y.abs() < 1e-9 {
            return None;
        }
        let t = (self.y - r.origin.y) / r.dir.y;
        if t < t_min || t > t_max {
            return None;
        }
        Some(Hit { t, p: r.at(t) })
    }
}

pub fn hit_world(world: &[Box<dyn Hittable>], r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
    let mut best: Option<Hit> = None;
    let mut closest = t_max;
    for object in world {
        if let Some(h) = object.hit(r, t_min, closest) {
            closest = h.t;
            best = Some(h);
        }
    }
    best
}

pub fn scene() -> Vec<dyn Hittable> {
    vec![
        Box::new(Plane { y: -0.5 }),
        Box::new(Sphere { centre: vec3(-0.6, 0.0, -1.4), radius: 0.5 }),
        Box::new(Sphere { centre: vec3(0.7, 0.0, -1.2), radius: 0.5 }),
    ]
}
pub fn run() -> Vec<Option<f64>> {
    let camera = Camera::new(2.0);
    let world = scene();
    let mut hits = Vec::new();
    for &(u, v) in &PROBES {
        let r = camera.ray(u, v);
        let hit = hit_world(&world, &r, 0.001, f64::INFINITY);
        match &hit {
            Some(h) => println!("pixel ({u}, {v}) hits at t = {:.4}, point {:?}", h.t, h.p),
            None => println!("pixel ({u}, {v}) escapes to the sky"),
        }
        hits.push(hit.map(|h| h.t));
    }
    println!("{} objects in the world, one Vec, two shapes", world.len());
    hits
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    const FAR: f64 = f64::INFINITY;

    fn down() -> Ray {
        Ray { origin: vec3(0.0, 0.0, 0.0), dir: vec3(0.0, -1.0, 0.0) }
    }

    #[test]
    fn the_run_hits_a_plane_two_spheres_and_the_sky() {
        let hits = run();
        assert_eq!(hits.len(), 5);
        assert!((hits[0].unwrap() - 0.5).abs() < 1e-9);
        assert!(hits[1].is_none());
        assert!(hits[3].is_none());
        assert!(hits[2].unwrap() > 0.9 && hits[2].unwrap() < 1.0);
        assert!(hits[4].unwrap() > 0.7 && hits[4].unwrap() < 0.8);
    }

    #[test]
    fn one_vector_holds_two_different_shapes() {
        let world = scene();
        assert_eq!(world.len(), 3);
        let h = hit_world(&world, &down(), 0.001, FAR).unwrap();
        assert!((h.t - 0.5).abs() < 1e-9);
        assert!((h.p.y + 0.5).abs() < 1e-9);
    }

    #[test]
    fn the_nearest_object_wins_whatever_the_order() {
        let near: Box<dyn Hittable> = Box::new(Sphere { centre: vec3(0.0, 0.0, -2.0), radius: 1.0 });
        let far: Box<dyn Hittable> = Box::new(Sphere { centre: vec3(0.0, 0.0, -5.0), radius: 1.0 });
        let r = Ray { origin: vec3(0.0, 0.0, 0.0), dir: vec3(0.0, 0.0, -1.0) };

        let forwards: Vec<Box<dyn Hittable>> = vec![
            Box::new(Sphere { centre: vec3(0.0, 0.0, -2.0), radius: 1.0 }),
            Box::new(Sphere { centre: vec3(0.0, 0.0, -5.0), radius: 1.0 }),
        ];
        let backwards: Vec<Box<dyn Hittable>> = vec![far, near];

        assert!((hit_world(&forwards, &r, 0.001, FAR).unwrap().t - 1.0).abs() < 1e-9);
        assert!((hit_world(&backwards, &r, 0.001, FAR).unwrap().t - 1.0).abs() < 1e-9);
    }

    #[test]
    fn an_empty_world_hits_nothing() {
        let world: Vec<Box<dyn Hittable>> = Vec::new();
        assert!(hit_world(&world, &down(), 0.001, FAR).is_none());
    }

    #[test]
    fn a_ray_parallel_to_the_plane_never_meets_it() {
        let world: Vec<Box<dyn Hittable>> = vec![Box::new(Plane { y: -0.5 })];
        let flat = Ray { origin: vec3(0.0, 0.0, 0.0), dir: vec3(0.0, 0.0, -1.0) };
        assert!(hit_world(&world, &flat, 0.001, FAR).is_none());

        // and a plane above the camera is not hit by a ray going down
        let above: Vec<Box<dyn Hittable>> = vec![Box::new(Plane { y: 3.0 })];
        assert!(hit_world(&above, &down(), 0.001, FAR).is_none());
    }
}
```

```solution
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

pub const fn vec3(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3 { x, y, z }
}

impl std::ops::Add for Vec3 {
    type Output = Vec3;
    fn add(self, o: Vec3) -> Vec3 { vec3(self.x + o.x, self.y + o.y, self.z + o.z) }
}

impl std::ops::Sub for Vec3 {
    type Output = Vec3;
    fn sub(self, o: Vec3) -> Vec3 { vec3(self.x - o.x, self.y - o.y, self.z - o.z) }
}

impl std::ops::Mul<f64> for Vec3 {
    type Output = Vec3;
    fn mul(self, k: f64) -> Vec3 { vec3(self.x * k, self.y * k, self.z * k) }
}

impl std::ops::Mul<Vec3> for Vec3 {
    type Output = Vec3;
    fn mul(self, o: Vec3) -> Vec3 { vec3(self.x * o.x, self.y * o.y, self.z * o.z) }
}

impl std::ops::Neg for Vec3 {
    type Output = Vec3;
    fn neg(self) -> Vec3 { vec3(-self.x, -self.y, -self.z) }
}

impl Vec3 {
    pub fn dot(self, o: Vec3) -> f64 { self.x * o.x + self.y * o.y + self.z * o.z }

    pub fn cross(self, o: Vec3) -> Vec3 {
        vec3(self.y * o.z - self.z * o.y,
             self.z * o.x - self.x * o.z,
             self.x * o.y - self.y * o.x)
    }

    pub fn length_squared(self) -> f64 { self.dot(self) }

    pub fn length(self) -> f64 { self.length_squared().sqrt() }

    pub fn unit(self) -> Vec3 { self * (1.0 / self.length()) }
}
#[derive(Debug, Clone, Copy)]
pub struct Ray {
    pub origin: Vec3,
    pub dir: Vec3,
}

impl Ray {
    pub fn at(self, t: f64) -> Vec3 { self.origin + self.dir * t }
}

pub struct Camera {
    pub origin: Vec3,
    pub lower_left: Vec3,
    pub horizontal: Vec3,
    pub vertical: Vec3,
}

impl Camera {
    pub fn new(aspect: f64) -> Camera {
        let height = 2.0;
        let origin = vec3(0.0, 0.0, 0.0);
        let horizontal = vec3(aspect * height, 0.0, 0.0);
        let vertical = vec3(0.0, height, 0.0);
        Camera {
            origin,
            horizontal,
            vertical,
            lower_left: origin - horizontal * 0.5 - vertical * 0.5 - vec3(0.0, 0.0, 1.0),
        }
    }

    pub fn ray(&self, u: f64, v: f64) -> Ray {
        Ray {
            origin: self.origin,
            dir: self.lower_left + self.horizontal * u + self.vertical * v - self.origin,
        }
    }
}
/// Five pixel coordinates: bottom left, top right, then three across the middle.
pub const PROBES: [(f64, f64); 5] =
    [(0.0, 0.0), (1.0, 1.0), (0.4, 0.5), (0.5, 0.5), (0.65, 0.5)];
pub fn hit_sphere(centre: Vec3, radius: f64, r: &Ray, t_min: f64, t_max: f64) -> Option<f64> {
    let oc = r.origin - centre;
    let a = r.dir.length_squared();
    let half_b = oc.dot(r.dir);
    let c = oc.length_squared() - radius * radius;

    let disc = half_b * half_b - a * c;
    if disc < 0.0 {
        return None;
    }
    let sqrtd = disc.sqrt();

    let mut root = (-half_b - sqrtd) / a;
    if root < t_min || root > t_max {
        root = (-half_b + sqrtd) / a;
        if root < t_min || root > t_max {
            return None;
        }
    }
    Some(root)
}
pub struct Hit {
    pub t: f64,
    pub p: Vec3,
}

pub trait Hittable {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit>;
}

pub struct Sphere {
    pub centre: Vec3,
    pub radius: f64,
}

pub struct Plane {
    pub y: f64,
}

impl Hittable for Sphere {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
        let t = hit_sphere(self.centre, self.radius, r, t_min, t_max)?;
        Some(Hit { t, p: r.at(t) })
    }
}

impl Hittable for Plane {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
        if r.dir.y.abs() < 1e-9 {
            return None;
        }
        let t = (self.y - r.origin.y) / r.dir.y;
        if t < t_min || t > t_max {
            return None;
        }
        Some(Hit { t, p: r.at(t) })
    }
}

pub fn hit_world(world: &[Box<dyn Hittable>], r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
    let mut best: Option<Hit> = None;
    let mut closest = t_max;
    for object in world {
        if let Some(h) = object.hit(r, t_min, closest) {
            closest = h.t;
            best = Some(h);
        }
    }
    best
}

pub fn scene() -> Vec<Box<dyn Hittable>> {
    vec![
        Box::new(Plane { y: -0.5 }),
        Box::new(Sphere { centre: vec3(-0.6, 0.0, -1.4), radius: 0.5 }),
        Box::new(Sphere { centre: vec3(0.7, 0.0, -1.2), radius: 0.5 }),
    ]
}
pub fn run() -> Vec<Option<f64>> {
    let camera = Camera::new(2.0);
    let world = scene();
    let mut hits = Vec::new();
    for &(u, v) in &PROBES {
        let r = camera.ray(u, v);
        let hit = hit_world(&world, &r, 0.001, f64::INFINITY);
        match &hit {
            Some(h) => println!("pixel ({u}, {v}) hits at t = {:.4}, point {:?}", h.t, h.p),
            None => println!("pixel ({u}, {v}) escapes to the sky"),
        }
        hits.push(hit.map(|h| h.t));
    }
    println!("{} objects in the world, one Vec, two shapes", world.len());
    hits
}
```

@hint `dyn Hittable` names a value whose concrete type is only known at run time. Ask what `Vec` has to know about its elements before it can allocate.
@hint A `Vec<T>` stores elements inline and back to back, so it needs the size of one. A trait object has no size, because a `Sphere` and a `Plane` are different sizes.
@hint Put each shape behind a pointer. `Vec<Box<dyn Hittable>>` for the return type, and `Box::new(..)` around each element.

@diagnose E0277
`the size for values of type (dyn Hittable + 'static) cannot be known at
compilation time`, and below it, `required by an implicit Sized bound in Vec`.

Every generic parameter in Rust carries a silent `T: Sized` unless it opts out
with `?Sized`, and `Vec<T>` is one of them. It has to be: a `Vec` is a pointer
to `n` elements laid end to end, and computing the address of element 3 means
multiplying 3 by the size of one element.

`dyn Hittable` deliberately has no size. It stands for whichever type is
actually there, which might be a 32-byte `Sphere` or a 16-byte `Plane`. The
usual answer is to store a pointer instead, since every pointer is the same
size, and `Box<dyn Hittable>` is that pointer.

@diagnose E0308
`expected Box<dyn Hittable>, found Sphere`. The second half of the same
mistake: the `Vec` now asks for boxes and the elements are still bare structs.
The coercion from `Box<Sphere>` to `Box<dyn Hittable>` happens on its own, but
something has to do the allocation first, so each element needs its own
`Box::new`.

@after
A `Box<dyn Hittable>` is two words, not one.

```text
    world: Vec<Box<dyn Hittable>>, three fat pointers end to end

      element 0            element 1            element 2
    ┌──────────┐         ┌──────────┐         ┌──────────┐
    │ data ●   │         │ data ●   │         │ data ●   │
    │ vtable ● │         │ vtable ● │         │ vtable ● │
    └──────┼─┼─┘         └──────────┘         └──────────┘
           │ │
           │ └───▶ vtable for Plane: drop, size, align, hit
           └─────▶ Plane { y: -0.5 }, on the heap
```

The call `object.hit(..)` loads the function address out of the vtable and
jumps through it. That costs an indirect branch the CPU cannot always predict,
and it blocks inlining, so a `Vec<Sphere>` would be measurably faster. It also
could not hold a plane.

Look at what `hit_world` gets in exchange. It shrinks `closest` on every hit,
so anything further away is rejected before its own maths runs, and it never
mentions a shape by name. Adding a triangle later means writing one `impl` and
adding one line to `scene`.

## 5. Normals, and the first picture

@kind fix
@concept coherence

@expect E0277

A surface normal is the direction a surface faces at a point, and painting it
as a colour is how everyone checks their geometry. Rays that hit nothing get a
vertical gradient instead. One multiplication is written the way a maths paper
writes it, which is the way Rust will not take it.

```starter
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

pub const fn vec3(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3 { x, y, z }
}

impl std::ops::Add for Vec3 {
    type Output = Vec3;
    fn add(self, o: Vec3) -> Vec3 { vec3(self.x + o.x, self.y + o.y, self.z + o.z) }
}

impl std::ops::Sub for Vec3 {
    type Output = Vec3;
    fn sub(self, o: Vec3) -> Vec3 { vec3(self.x - o.x, self.y - o.y, self.z - o.z) }
}

impl std::ops::Mul<f64> for Vec3 {
    type Output = Vec3;
    fn mul(self, k: f64) -> Vec3 { vec3(self.x * k, self.y * k, self.z * k) }
}

impl std::ops::Mul<Vec3> for Vec3 {
    type Output = Vec3;
    fn mul(self, o: Vec3) -> Vec3 { vec3(self.x * o.x, self.y * o.y, self.z * o.z) }
}

impl std::ops::Neg for Vec3 {
    type Output = Vec3;
    fn neg(self) -> Vec3 { vec3(-self.x, -self.y, -self.z) }
}

impl Vec3 {
    pub fn dot(self, o: Vec3) -> f64 { self.x * o.x + self.y * o.y + self.z * o.z }

    pub fn cross(self, o: Vec3) -> Vec3 {
        vec3(self.y * o.z - self.z * o.y,
             self.z * o.x - self.x * o.z,
             self.x * o.y - self.y * o.x)
    }

    pub fn length_squared(self) -> f64 { self.dot(self) }

    pub fn length(self) -> f64 { self.length_squared().sqrt() }

    pub fn unit(self) -> Vec3 { self * (1.0 / self.length()) }
}
#[derive(Debug, Clone, Copy)]
pub struct Ray {
    pub origin: Vec3,
    pub dir: Vec3,
}

impl Ray {
    pub fn at(self, t: f64) -> Vec3 { self.origin + self.dir * t }
}

pub struct Camera {
    pub origin: Vec3,
    pub lower_left: Vec3,
    pub horizontal: Vec3,
    pub vertical: Vec3,
}

impl Camera {
    pub fn new(aspect: f64) -> Camera {
        let height = 2.0;
        let origin = vec3(0.0, 0.0, 0.0);
        let horizontal = vec3(aspect * height, 0.0, 0.0);
        let vertical = vec3(0.0, height, 0.0);
        Camera {
            origin,
            horizontal,
            vertical,
            lower_left: origin - horizontal * 0.5 - vertical * 0.5 - vec3(0.0, 0.0, 1.0),
        }
    }

    pub fn ray(&self, u: f64, v: f64) -> Ray {
        Ray {
            origin: self.origin,
            dir: self.lower_left + self.horizontal * u + self.vertical * v - self.origin,
        }
    }
}
/// Five pixel coordinates: bottom left, top right, then three across the middle.
pub const PROBES: [(f64, f64); 5] =
    [(0.0, 0.0), (1.0, 1.0), (0.4, 0.5), (0.5, 0.5), (0.65, 0.5)];
pub fn hit_sphere(centre: Vec3, radius: f64, r: &Ray, t_min: f64, t_max: f64) -> Option<f64> {
    let oc = r.origin - centre;
    let a = r.dir.length_squared();
    let half_b = oc.dot(r.dir);
    let c = oc.length_squared() - radius * radius;

    let disc = half_b * half_b - a * c;
    if disc < 0.0 {
        return None;
    }
    let sqrtd = disc.sqrt();

    let mut root = (-half_b - sqrtd) / a;
    if root < t_min || root > t_max {
        root = (-half_b + sqrtd) / a;
        if root < t_min || root > t_max {
            return None;
        }
    }
    Some(root)
}
pub struct Hit {
    pub t: f64,
    pub p: Vec3,
    pub normal: Vec3,
    pub front_face: bool,
}

/// An outward normal, flipped to face the ray, and which side we are on.
pub fn face_normal(r: &Ray, outward: Vec3) -> (Vec3, bool) {
    let front = r.dir.dot(outward) < 0.0;
    (if front { outward } else { -outward }, front)
}

pub trait Hittable {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit>;
}

pub struct Sphere {
    pub centre: Vec3,
    pub radius: f64,
}

pub struct Plane {
    pub y: f64,
}

impl Hittable for Sphere {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
        let t = hit_sphere(self.centre, self.radius, r, t_min, t_max)?;
        let p = r.at(t);
        let (normal, front_face) = face_normal(r, (p - self.centre) * (1.0 / self.radius));
        Some(Hit { t, p, normal, front_face })
    }
}

impl Hittable for Plane {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
        if r.dir.y.abs() < 1e-9 {
            return None;
        }
        let t = (self.y - r.origin.y) / r.dir.y;
        if t < t_min || t > t_max {
            return None;
        }
        let (normal, front_face) = face_normal(r, vec3(0.0, 1.0, 0.0));
        Some(Hit { t, p: r.at(t), normal, front_face })
    }
}

pub fn hit_world(world: &[Box<dyn Hittable>], r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
    let mut best: Option<Hit> = None;
    let mut closest = t_max;
    for object in world {
        if let Some(h) = object.hit(r, t_min, closest) {
            closest = h.t;
            best = Some(h);
        }
    }
    best
}

pub fn scene() -> Vec<Box<dyn Hittable>> {
    vec![
        Box::new(Plane { y: -0.5 }),
        Box::new(Sphere { centre: vec3(-0.6, 0.0, -1.4), radius: 0.5 }),
        Box::new(Sphere { centre: vec3(0.7, 0.0, -1.2), radius: 0.5 }),
    ]
}
pub const WIDTH: usize = 40;
pub const HEIGHT: usize = 20;
/// The image as characters, darkest to brightest, so a stage can be seen.
pub fn ascii(pixels: &[Vec3]) -> String {
    const RAMP: [char; 10] = [' ', '.', ':', '-', '=', '+', '*', '#', '%', '@'];
    let mut out = String::new();
    for j in 0..HEIGHT {
        for i in 0..WIDTH {
            let c = pixels[j * WIDTH + i];
            let brightness = ((c.x + c.y + c.z) / 3.0).max(0.0).sqrt().min(0.999);
            out.push(RAMP[(brightness * 10.0) as usize]);
        }
        out.push('\n');
    }
    out
}
pub fn ray_colour(r: &Ray, world: &[Box<dyn Hittable>]) -> Vec3 {
    if let Some(h) = hit_world(world, r, 0.001, f64::INFINITY) {
        return 0.5 * (h.normal + vec3(1.0, 1.0, 1.0));
    }
    let t = 0.5 * (r.dir.unit().y + 1.0);
    vec3(1.0, 1.0, 1.0) * (1.0 - t) + vec3(0.5, 0.7, 1.0) * t
}
pub fn render() -> Vec<Vec3> {
    let camera = Camera::new(WIDTH as f64 / HEIGHT as f64);
    let world = scene();
    let mut pixels = Vec::with_capacity(WIDTH * HEIGHT);
    for j in 0..HEIGHT {
        for i in 0..WIDTH {
            let u = (i as f64 + 0.5) / WIDTH as f64;
            let v = ((HEIGHT - 1 - j) as f64 + 0.5) / HEIGHT as f64;
            pixels.push(ray_colour(&camera.ray(u, v), &world));
        }
    }
    pixels
}
pub fn run() -> Vec<Vec3> {
    let pixels = render();
    print!("{}", ascii(&pixels));
    println!("{} pixels, one ray each", pixels.len());
    pixels
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: Vec3, b: Vec3) -> bool { (a - b).length() < 1e-9 }

    #[test]
    fn the_image_is_the_right_size_and_in_range() {
        let pixels = run();
        assert_eq!(pixels.len(), WIDTH * HEIGHT);
        for c in &pixels {
            for channel in [c.x, c.y, c.z] {
                assert!((0.0..=1.0).contains(&channel));
            }
        }
    }

    #[test]
    fn the_sky_darkens_towards_the_horizon() {
        let pixels = render();
        let top = pixels[1];
        let middle = pixels[WIDTH * 4 + 1];
        assert!(top.z > top.x);
        assert!(top.x < middle.x);
        assert!((top.z - 1.0).abs() < 1e-9);
    }

    #[test]
    fn a_normal_facing_the_camera_points_back_down_z() {
        let world = scene();
        let r = Ray { origin: vec3(0.0, 0.0, 0.0), dir: vec3(-0.6, 0.0, -1.4) };
        let h = hit_world(&world, &r, 0.001, f64::INFINITY).unwrap();
        assert!((h.normal.length() - 1.0).abs() < 1e-9);
        assert!(h.normal.z > 0.9);
        assert!(h.front_face);
    }

    #[test]
    fn a_normal_always_faces_the_ray() {
        let world = scene();
        for &(u, v) in &PROBES {
            let camera = Camera::new(WIDTH as f64 / HEIGHT as f64);
            let r = camera.ray(u, v);
            if let Some(h) = hit_world(&world, &r, 0.001, f64::INFINITY) {
                assert!(r.dir.dot(h.normal) < 0.0);
            }
        }
    }

    #[test]
    fn inside_the_sphere_the_normal_flips() {
        let outward = vec3(0.0, 0.0, 1.0);
        let towards = Ray { origin: vec3(0.0, 0.0, 0.0), dir: vec3(0.0, 0.0, -1.0) };
        let away = Ray { origin: vec3(0.0, 0.0, 0.0), dir: vec3(0.0, 0.0, 1.0) };
        assert_eq!(face_normal(&towards, outward), (outward, true));
        assert!(close(face_normal(&away, outward).0, -outward));
        assert!(!face_normal(&away, outward).1);
    }

    #[test]
    fn the_picture_has_something_in_it() {
        let art = ascii(&render());
        assert_eq!(art.lines().count(), HEIGHT);
        assert!(art.lines().all(|l| l.chars().count() == WIDTH));
        // more than one shade, so it is a picture rather than a wall
        let mut shades: Vec<char> = art.chars().filter(|c| *c != '\n').collect();
        shades.sort_unstable();
        shades.dedup();
        assert!(shades.len() >= 4);
    }
}
```

```solution
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

pub const fn vec3(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3 { x, y, z }
}

impl std::ops::Add for Vec3 {
    type Output = Vec3;
    fn add(self, o: Vec3) -> Vec3 { vec3(self.x + o.x, self.y + o.y, self.z + o.z) }
}

impl std::ops::Sub for Vec3 {
    type Output = Vec3;
    fn sub(self, o: Vec3) -> Vec3 { vec3(self.x - o.x, self.y - o.y, self.z - o.z) }
}

impl std::ops::Mul<f64> for Vec3 {
    type Output = Vec3;
    fn mul(self, k: f64) -> Vec3 { vec3(self.x * k, self.y * k, self.z * k) }
}

impl std::ops::Mul<Vec3> for Vec3 {
    type Output = Vec3;
    fn mul(self, o: Vec3) -> Vec3 { vec3(self.x * o.x, self.y * o.y, self.z * o.z) }
}

impl std::ops::Neg for Vec3 {
    type Output = Vec3;
    fn neg(self) -> Vec3 { vec3(-self.x, -self.y, -self.z) }
}

impl Vec3 {
    pub fn dot(self, o: Vec3) -> f64 { self.x * o.x + self.y * o.y + self.z * o.z }

    pub fn cross(self, o: Vec3) -> Vec3 {
        vec3(self.y * o.z - self.z * o.y,
             self.z * o.x - self.x * o.z,
             self.x * o.y - self.y * o.x)
    }

    pub fn length_squared(self) -> f64 { self.dot(self) }

    pub fn length(self) -> f64 { self.length_squared().sqrt() }

    pub fn unit(self) -> Vec3 { self * (1.0 / self.length()) }
}
#[derive(Debug, Clone, Copy)]
pub struct Ray {
    pub origin: Vec3,
    pub dir: Vec3,
}

impl Ray {
    pub fn at(self, t: f64) -> Vec3 { self.origin + self.dir * t }
}

pub struct Camera {
    pub origin: Vec3,
    pub lower_left: Vec3,
    pub horizontal: Vec3,
    pub vertical: Vec3,
}

impl Camera {
    pub fn new(aspect: f64) -> Camera {
        let height = 2.0;
        let origin = vec3(0.0, 0.0, 0.0);
        let horizontal = vec3(aspect * height, 0.0, 0.0);
        let vertical = vec3(0.0, height, 0.0);
        Camera {
            origin,
            horizontal,
            vertical,
            lower_left: origin - horizontal * 0.5 - vertical * 0.5 - vec3(0.0, 0.0, 1.0),
        }
    }

    pub fn ray(&self, u: f64, v: f64) -> Ray {
        Ray {
            origin: self.origin,
            dir: self.lower_left + self.horizontal * u + self.vertical * v - self.origin,
        }
    }
}
/// Five pixel coordinates: bottom left, top right, then three across the middle.
pub const PROBES: [(f64, f64); 5] =
    [(0.0, 0.0), (1.0, 1.0), (0.4, 0.5), (0.5, 0.5), (0.65, 0.5)];
pub fn hit_sphere(centre: Vec3, radius: f64, r: &Ray, t_min: f64, t_max: f64) -> Option<f64> {
    let oc = r.origin - centre;
    let a = r.dir.length_squared();
    let half_b = oc.dot(r.dir);
    let c = oc.length_squared() - radius * radius;

    let disc = half_b * half_b - a * c;
    if disc < 0.0 {
        return None;
    }
    let sqrtd = disc.sqrt();

    let mut root = (-half_b - sqrtd) / a;
    if root < t_min || root > t_max {
        root = (-half_b + sqrtd) / a;
        if root < t_min || root > t_max {
            return None;
        }
    }
    Some(root)
}
pub struct Hit {
    pub t: f64,
    pub p: Vec3,
    pub normal: Vec3,
    pub front_face: bool,
}

/// An outward normal, flipped to face the ray, and which side we are on.
pub fn face_normal(r: &Ray, outward: Vec3) -> (Vec3, bool) {
    let front = r.dir.dot(outward) < 0.0;
    (if front { outward } else { -outward }, front)
}

pub trait Hittable {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit>;
}

pub struct Sphere {
    pub centre: Vec3,
    pub radius: f64,
}

pub struct Plane {
    pub y: f64,
}

impl Hittable for Sphere {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
        let t = hit_sphere(self.centre, self.radius, r, t_min, t_max)?;
        let p = r.at(t);
        let (normal, front_face) = face_normal(r, (p - self.centre) * (1.0 / self.radius));
        Some(Hit { t, p, normal, front_face })
    }
}

impl Hittable for Plane {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
        if r.dir.y.abs() < 1e-9 {
            return None;
        }
        let t = (self.y - r.origin.y) / r.dir.y;
        if t < t_min || t > t_max {
            return None;
        }
        let (normal, front_face) = face_normal(r, vec3(0.0, 1.0, 0.0));
        Some(Hit { t, p: r.at(t), normal, front_face })
    }
}

pub fn hit_world(world: &[Box<dyn Hittable>], r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
    let mut best: Option<Hit> = None;
    let mut closest = t_max;
    for object in world {
        if let Some(h) = object.hit(r, t_min, closest) {
            closest = h.t;
            best = Some(h);
        }
    }
    best
}

pub fn scene() -> Vec<Box<dyn Hittable>> {
    vec![
        Box::new(Plane { y: -0.5 }),
        Box::new(Sphere { centre: vec3(-0.6, 0.0, -1.4), radius: 0.5 }),
        Box::new(Sphere { centre: vec3(0.7, 0.0, -1.2), radius: 0.5 }),
    ]
}
pub const WIDTH: usize = 40;
pub const HEIGHT: usize = 20;
/// The image as characters, darkest to brightest, so a stage can be seen.
pub fn ascii(pixels: &[Vec3]) -> String {
    const RAMP: [char; 10] = [' ', '.', ':', '-', '=', '+', '*', '#', '%', '@'];
    let mut out = String::new();
    for j in 0..HEIGHT {
        for i in 0..WIDTH {
            let c = pixels[j * WIDTH + i];
            let brightness = ((c.x + c.y + c.z) / 3.0).max(0.0).sqrt().min(0.999);
            out.push(RAMP[(brightness * 10.0) as usize]);
        }
        out.push('\n');
    }
    out
}
pub fn ray_colour(r: &Ray, world: &[Box<dyn Hittable>]) -> Vec3 {
    if let Some(h) = hit_world(world, r, 0.001, f64::INFINITY) {
        return (h.normal + vec3(1.0, 1.0, 1.0)) * 0.5;
    }
    let t = 0.5 * (r.dir.unit().y + 1.0);
    vec3(1.0, 1.0, 1.0) * (1.0 - t) + vec3(0.5, 0.7, 1.0) * t
}
pub fn render() -> Vec<Vec3> {
    let camera = Camera::new(WIDTH as f64 / HEIGHT as f64);
    let world = scene();
    let mut pixels = Vec::with_capacity(WIDTH * HEIGHT);
    for j in 0..HEIGHT {
        for i in 0..WIDTH {
            let u = (i as f64 + 0.5) / WIDTH as f64;
            let v = ((HEIGHT - 1 - j) as f64 + 0.5) / HEIGHT as f64;
            pixels.push(ray_colour(&camera.ray(u, v), &world));
        }
    }
    pixels
}
pub fn run() -> Vec<Vec3> {
    let pixels = render();
    print!("{}", ascii(&pixels));
    println!("{} pixels, one ray each", pixels.len());
    pixels
}
```

@hint Which of the two operands has the impl you wrote in stage 1?
@hint `impl Mul<f64> for Vec3` gives `Vec3 * f64`. It says nothing about `f64 * Vec3`, which would have to be an impl on `f64`.
@hint Turn it round: `(h.normal + vec3(1.0, 1.0, 1.0)) * 0.5`.

@diagnose E0277
`cannot multiply {float} by Vec3`, and then `the trait Mul<Vec3> is not
implemented for {float}`.

`a * b` is `Mul::mul(a, b)`, so the impl that runs belongs to the type on the
left. Multiplication commutes in arithmetic and not in the trait system: your
`impl Mul<f64> for Vec3` teaches `Vec3` about floats and teaches `f64`
nothing.

You could write `impl std::ops::Mul<Vec3> for f64` yourself, and it would
compile, because the orphan rule allows an impl when either the trait or the
type is local and `Vec3` is yours. The standard library cannot do it for you,
since `Vec3` did not exist when `f64` was written. Most vector libraries write
both impls. Swapping the operands is free.

@diagnose E0308
`if and else have incompatible types`. This turns up if you restructure the
function into a single `if let ... else`. The two arms of an `if` are one
expression with one type, so a branch returning a `Vec3` and a branch returning
`()` (which is what a branch ending in a semicolon returns) cannot be joined.
Either give both arms a value, or keep the early `return`.

@after
The sky is a linear blend between white and a pale blue, keyed on the y
component of the ray direction after normalising. Normalising is what makes it
a gradient rather than a mess: without it, rays towards the corners of the
frame are longer, and the colour would depend on how wide the viewport is.

Painting the normal as a colour is a debugging habit worth keeping. Each
component runs from -1 to 1, so mapping it to 0 to 1 gives red for a surface
facing right, green for up, blue for towards the camera. A dent in a mesh, a
flipped triangle winding or a normal that was never normalised all show up
immediately.

## 6. Four rays per pixel

@kind fix
@concept borrow

@expect E0596

One ray through the centre of a pixel makes every edge a staircase. Four rays
at random spots inside the pixel, averaged, make it a ramp. The generator is a
64-bit congruential one with Knuth's constants, so every run draws the same
picture. The binding holding it is missing a word.

```starter
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

pub const fn vec3(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3 { x, y, z }
}

impl std::ops::Add for Vec3 {
    type Output = Vec3;
    fn add(self, o: Vec3) -> Vec3 { vec3(self.x + o.x, self.y + o.y, self.z + o.z) }
}

impl std::ops::Sub for Vec3 {
    type Output = Vec3;
    fn sub(self, o: Vec3) -> Vec3 { vec3(self.x - o.x, self.y - o.y, self.z - o.z) }
}

impl std::ops::Mul<f64> for Vec3 {
    type Output = Vec3;
    fn mul(self, k: f64) -> Vec3 { vec3(self.x * k, self.y * k, self.z * k) }
}

impl std::ops::Mul<Vec3> for Vec3 {
    type Output = Vec3;
    fn mul(self, o: Vec3) -> Vec3 { vec3(self.x * o.x, self.y * o.y, self.z * o.z) }
}

impl std::ops::Neg for Vec3 {
    type Output = Vec3;
    fn neg(self) -> Vec3 { vec3(-self.x, -self.y, -self.z) }
}

impl Vec3 {
    pub fn dot(self, o: Vec3) -> f64 { self.x * o.x + self.y * o.y + self.z * o.z }

    pub fn cross(self, o: Vec3) -> Vec3 {
        vec3(self.y * o.z - self.z * o.y,
             self.z * o.x - self.x * o.z,
             self.x * o.y - self.y * o.x)
    }

    pub fn length_squared(self) -> f64 { self.dot(self) }

    pub fn length(self) -> f64 { self.length_squared().sqrt() }

    pub fn unit(self) -> Vec3 { self * (1.0 / self.length()) }
}
#[derive(Debug, Clone, Copy)]
pub struct Ray {
    pub origin: Vec3,
    pub dir: Vec3,
}

impl Ray {
    pub fn at(self, t: f64) -> Vec3 { self.origin + self.dir * t }
}

pub struct Camera {
    pub origin: Vec3,
    pub lower_left: Vec3,
    pub horizontal: Vec3,
    pub vertical: Vec3,
}

impl Camera {
    pub fn new(aspect: f64) -> Camera {
        let height = 2.0;
        let origin = vec3(0.0, 0.0, 0.0);
        let horizontal = vec3(aspect * height, 0.0, 0.0);
        let vertical = vec3(0.0, height, 0.0);
        Camera {
            origin,
            horizontal,
            vertical,
            lower_left: origin - horizontal * 0.5 - vertical * 0.5 - vec3(0.0, 0.0, 1.0),
        }
    }

    pub fn ray(&self, u: f64, v: f64) -> Ray {
        Ray {
            origin: self.origin,
            dir: self.lower_left + self.horizontal * u + self.vertical * v - self.origin,
        }
    }
}
/// Five pixel coordinates: bottom left, top right, then three across the middle.
pub const PROBES: [(f64, f64); 5] =
    [(0.0, 0.0), (1.0, 1.0), (0.4, 0.5), (0.5, 0.5), (0.65, 0.5)];
pub fn hit_sphere(centre: Vec3, radius: f64, r: &Ray, t_min: f64, t_max: f64) -> Option<f64> {
    let oc = r.origin - centre;
    let a = r.dir.length_squared();
    let half_b = oc.dot(r.dir);
    let c = oc.length_squared() - radius * radius;

    let disc = half_b * half_b - a * c;
    if disc < 0.0 {
        return None;
    }
    let sqrtd = disc.sqrt();

    let mut root = (-half_b - sqrtd) / a;
    if root < t_min || root > t_max {
        root = (-half_b + sqrtd) / a;
        if root < t_min || root > t_max {
            return None;
        }
    }
    Some(root)
}
pub struct Hit {
    pub t: f64,
    pub p: Vec3,
    pub normal: Vec3,
    pub front_face: bool,
}

/// An outward normal, flipped to face the ray, and which side we are on.
pub fn face_normal(r: &Ray, outward: Vec3) -> (Vec3, bool) {
    let front = r.dir.dot(outward) < 0.0;
    (if front { outward } else { -outward }, front)
}

pub trait Hittable {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit>;
}

pub struct Sphere {
    pub centre: Vec3,
    pub radius: f64,
}

pub struct Plane {
    pub y: f64,
}

impl Hittable for Sphere {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
        let t = hit_sphere(self.centre, self.radius, r, t_min, t_max)?;
        let p = r.at(t);
        let (normal, front_face) = face_normal(r, (p - self.centre) * (1.0 / self.radius));
        Some(Hit { t, p, normal, front_face })
    }
}

impl Hittable for Plane {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
        if r.dir.y.abs() < 1e-9 {
            return None;
        }
        let t = (self.y - r.origin.y) / r.dir.y;
        if t < t_min || t > t_max {
            return None;
        }
        let (normal, front_face) = face_normal(r, vec3(0.0, 1.0, 0.0));
        Some(Hit { t, p: r.at(t), normal, front_face })
    }
}

pub fn hit_world(world: &[Box<dyn Hittable>], r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
    let mut best: Option<Hit> = None;
    let mut closest = t_max;
    for object in world {
        if let Some(h) = object.hit(r, t_min, closest) {
            closest = h.t;
            best = Some(h);
        }
    }
    best
}

pub fn scene() -> Vec<Box<dyn Hittable>> {
    vec![
        Box::new(Plane { y: -0.5 }),
        Box::new(Sphere { centre: vec3(-0.6, 0.0, -1.4), radius: 0.5 }),
        Box::new(Sphere { centre: vec3(0.7, 0.0, -1.2), radius: 0.5 }),
    ]
}
/// A linear congruential generator: the constants are the ones Knuth lists for
/// a 64-bit modulus. Seeded, so every render is the same render.
pub struct Lcg(u64);

impl Lcg {
    pub fn new(seed: u64) -> Lcg { Lcg(seed) }

    /// A fraction in [0, 1), from the top 53 bits, which is all an f64 holds.
    pub fn next_f64(&mut self) -> f64 {
        self.0 = self.0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }
}
pub const WIDTH: usize = 40;
pub const HEIGHT: usize = 20;
pub const SAMPLES: usize = 4;
/// The image as characters, darkest to brightest, so a stage can be seen.
pub fn ascii(pixels: &[Vec3]) -> String {
    const RAMP: [char; 10] = [' ', '.', ':', '-', '=', '+', '*', '#', '%', '@'];
    let mut out = String::new();
    for j in 0..HEIGHT {
        for i in 0..WIDTH {
            let c = pixels[j * WIDTH + i];
            let brightness = ((c.x + c.y + c.z) / 3.0).max(0.0).sqrt().min(0.999);
            out.push(RAMP[(brightness * 10.0) as usize]);
        }
        out.push('\n');
    }
    out
}
pub fn ray_colour(r: &Ray, world: &[Box<dyn Hittable>]) -> Vec3 {
    if let Some(h) = hit_world(world, r, 0.001, f64::INFINITY) {
        return (h.normal + vec3(1.0, 1.0, 1.0)) * 0.5;
    }
    let t = 0.5 * (r.dir.unit().y + 1.0);
    vec3(1.0, 1.0, 1.0) * (1.0 - t) + vec3(0.5, 0.7, 1.0) * t
}
pub fn render() -> Vec<Vec3> {
    let camera = Camera::new(WIDTH as f64 / HEIGHT as f64);
    let world = scene();
    let rng = Lcg::new(0x5eed);
    let mut pixels = Vec::with_capacity(WIDTH * HEIGHT);
    for j in 0..HEIGHT {
        for i in 0..WIDTH {
            let mut sum = vec3(0.0, 0.0, 0.0);
            for _ in 0..SAMPLES {
                let u = (i as f64 + rng.next_f64()) / WIDTH as f64;
                let v = ((HEIGHT - 1 - j) as f64 + rng.next_f64()) / HEIGHT as f64;
                sum = sum + ray_colour(&camera.ray(u, v), &world);
            }
            pixels.push(sum * (1.0 / SAMPLES as f64));
        }
    }
    pixels
}
pub fn run() -> Vec<Vec3> {
    let pixels = render();
    print!("{}", ascii(&pixels));
    println!("{} pixels, {SAMPLES} rays each", pixels.len());
    pixels
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_generator_stays_inside_zero_and_one() {
        let mut rng = Lcg::new(1);
        let mut sum = 0.0;
        for _ in 0..2000 {
            let x = rng.next_f64();
            assert!((0.0..1.0).contains(&x));
            sum += x;
        }
        assert!((sum / 2000.0 - 0.5).abs() < 0.03);
    }

    #[test]
    fn the_same_seed_gives_the_same_numbers() {
        let mut a = Lcg::new(0x5eed);
        let mut b = Lcg::new(0x5eed);
        for _ in 0..100 {
            assert!((a.next_f64() - b.next_f64()).abs() < 1e-15);
        }

        let mut c = Lcg::new(0x5eed);
        let mut d = Lcg::new(0x5eee);
        let mut same = 0;
        for _ in 0..100 {
            if (c.next_f64() - d.next_f64()).abs() < 1e-15 {
                same += 1;
            }
        }
        assert!(same < 5);
    }

    #[test]
    fn the_render_is_reproducible() {
        let first = run();
        let second = render();
        assert_eq!(first.len(), WIDTH * HEIGHT);
        for (a, b) in first.iter().zip(&second) {
            assert!((*a - *b).length() < 1e-15);
        }
    }

    #[test]
    fn sampling_changed_the_image_it_did_not_wreck_it() {
        let pixels = render();
        for c in &pixels {
            for channel in [c.x, c.y, c.z] {
                assert!((0.0..=1.0).contains(&channel));
            }
        }
        // the top row is still sky, and still blue
        assert!(pixels[1].z > pixels[1].x);
    }

    #[test]
    fn the_edge_of_a_sphere_is_no_longer_all_or_nothing() {
        // Sixteen pixels along the row through the sphere centres, counted by
        // how many distinct colours appear. One sample per pixel gives blocks;
        // four give a spread.
        let pixels = render();
        let row: Vec<Vec3> = pixels[WIDTH * 8..WIDTH * 8 + WIDTH].to_vec();
        let mut edges = 0;
        for w in row.windows(2) {
            if (w[0] - w[1]).length() > 1e-6 {
                edges += 1;
            }
        }
        assert!(edges > 20);
    }
}
```

```solution
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

pub const fn vec3(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3 { x, y, z }
}

impl std::ops::Add for Vec3 {
    type Output = Vec3;
    fn add(self, o: Vec3) -> Vec3 { vec3(self.x + o.x, self.y + o.y, self.z + o.z) }
}

impl std::ops::Sub for Vec3 {
    type Output = Vec3;
    fn sub(self, o: Vec3) -> Vec3 { vec3(self.x - o.x, self.y - o.y, self.z - o.z) }
}

impl std::ops::Mul<f64> for Vec3 {
    type Output = Vec3;
    fn mul(self, k: f64) -> Vec3 { vec3(self.x * k, self.y * k, self.z * k) }
}

impl std::ops::Mul<Vec3> for Vec3 {
    type Output = Vec3;
    fn mul(self, o: Vec3) -> Vec3 { vec3(self.x * o.x, self.y * o.y, self.z * o.z) }
}

impl std::ops::Neg for Vec3 {
    type Output = Vec3;
    fn neg(self) -> Vec3 { vec3(-self.x, -self.y, -self.z) }
}

impl Vec3 {
    pub fn dot(self, o: Vec3) -> f64 { self.x * o.x + self.y * o.y + self.z * o.z }

    pub fn cross(self, o: Vec3) -> Vec3 {
        vec3(self.y * o.z - self.z * o.y,
             self.z * o.x - self.x * o.z,
             self.x * o.y - self.y * o.x)
    }

    pub fn length_squared(self) -> f64 { self.dot(self) }

    pub fn length(self) -> f64 { self.length_squared().sqrt() }

    pub fn unit(self) -> Vec3 { self * (1.0 / self.length()) }
}
#[derive(Debug, Clone, Copy)]
pub struct Ray {
    pub origin: Vec3,
    pub dir: Vec3,
}

impl Ray {
    pub fn at(self, t: f64) -> Vec3 { self.origin + self.dir * t }
}

pub struct Camera {
    pub origin: Vec3,
    pub lower_left: Vec3,
    pub horizontal: Vec3,
    pub vertical: Vec3,
}

impl Camera {
    pub fn new(aspect: f64) -> Camera {
        let height = 2.0;
        let origin = vec3(0.0, 0.0, 0.0);
        let horizontal = vec3(aspect * height, 0.0, 0.0);
        let vertical = vec3(0.0, height, 0.0);
        Camera {
            origin,
            horizontal,
            vertical,
            lower_left: origin - horizontal * 0.5 - vertical * 0.5 - vec3(0.0, 0.0, 1.0),
        }
    }

    pub fn ray(&self, u: f64, v: f64) -> Ray {
        Ray {
            origin: self.origin,
            dir: self.lower_left + self.horizontal * u + self.vertical * v - self.origin,
        }
    }
}
/// Five pixel coordinates: bottom left, top right, then three across the middle.
pub const PROBES: [(f64, f64); 5] =
    [(0.0, 0.0), (1.0, 1.0), (0.4, 0.5), (0.5, 0.5), (0.65, 0.5)];
pub fn hit_sphere(centre: Vec3, radius: f64, r: &Ray, t_min: f64, t_max: f64) -> Option<f64> {
    let oc = r.origin - centre;
    let a = r.dir.length_squared();
    let half_b = oc.dot(r.dir);
    let c = oc.length_squared() - radius * radius;

    let disc = half_b * half_b - a * c;
    if disc < 0.0 {
        return None;
    }
    let sqrtd = disc.sqrt();

    let mut root = (-half_b - sqrtd) / a;
    if root < t_min || root > t_max {
        root = (-half_b + sqrtd) / a;
        if root < t_min || root > t_max {
            return None;
        }
    }
    Some(root)
}
pub struct Hit {
    pub t: f64,
    pub p: Vec3,
    pub normal: Vec3,
    pub front_face: bool,
}

/// An outward normal, flipped to face the ray, and which side we are on.
pub fn face_normal(r: &Ray, outward: Vec3) -> (Vec3, bool) {
    let front = r.dir.dot(outward) < 0.0;
    (if front { outward } else { -outward }, front)
}

pub trait Hittable {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit>;
}

pub struct Sphere {
    pub centre: Vec3,
    pub radius: f64,
}

pub struct Plane {
    pub y: f64,
}

impl Hittable for Sphere {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
        let t = hit_sphere(self.centre, self.radius, r, t_min, t_max)?;
        let p = r.at(t);
        let (normal, front_face) = face_normal(r, (p - self.centre) * (1.0 / self.radius));
        Some(Hit { t, p, normal, front_face })
    }
}

impl Hittable for Plane {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
        if r.dir.y.abs() < 1e-9 {
            return None;
        }
        let t = (self.y - r.origin.y) / r.dir.y;
        if t < t_min || t > t_max {
            return None;
        }
        let (normal, front_face) = face_normal(r, vec3(0.0, 1.0, 0.0));
        Some(Hit { t, p: r.at(t), normal, front_face })
    }
}

pub fn hit_world(world: &[Box<dyn Hittable>], r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
    let mut best: Option<Hit> = None;
    let mut closest = t_max;
    for object in world {
        if let Some(h) = object.hit(r, t_min, closest) {
            closest = h.t;
            best = Some(h);
        }
    }
    best
}

pub fn scene() -> Vec<Box<dyn Hittable>> {
    vec![
        Box::new(Plane { y: -0.5 }),
        Box::new(Sphere { centre: vec3(-0.6, 0.0, -1.4), radius: 0.5 }),
        Box::new(Sphere { centre: vec3(0.7, 0.0, -1.2), radius: 0.5 }),
    ]
}
/// A linear congruential generator: the constants are the ones Knuth lists for
/// a 64-bit modulus. Seeded, so every render is the same render.
pub struct Lcg(u64);

impl Lcg {
    pub fn new(seed: u64) -> Lcg { Lcg(seed) }

    /// A fraction in [0, 1), from the top 53 bits, which is all an f64 holds.
    pub fn next_f64(&mut self) -> f64 {
        self.0 = self.0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }
}
pub const WIDTH: usize = 40;
pub const HEIGHT: usize = 20;
pub const SAMPLES: usize = 4;
/// The image as characters, darkest to brightest, so a stage can be seen.
pub fn ascii(pixels: &[Vec3]) -> String {
    const RAMP: [char; 10] = [' ', '.', ':', '-', '=', '+', '*', '#', '%', '@'];
    let mut out = String::new();
    for j in 0..HEIGHT {
        for i in 0..WIDTH {
            let c = pixels[j * WIDTH + i];
            let brightness = ((c.x + c.y + c.z) / 3.0).max(0.0).sqrt().min(0.999);
            out.push(RAMP[(brightness * 10.0) as usize]);
        }
        out.push('\n');
    }
    out
}
pub fn ray_colour(r: &Ray, world: &[Box<dyn Hittable>]) -> Vec3 {
    if let Some(h) = hit_world(world, r, 0.001, f64::INFINITY) {
        return (h.normal + vec3(1.0, 1.0, 1.0)) * 0.5;
    }
    let t = 0.5 * (r.dir.unit().y + 1.0);
    vec3(1.0, 1.0, 1.0) * (1.0 - t) + vec3(0.5, 0.7, 1.0) * t
}
pub fn render() -> Vec<Vec3> {
    let camera = Camera::new(WIDTH as f64 / HEIGHT as f64);
    let world = scene();
    let mut rng = Lcg::new(0x5eed);
    let mut pixels = Vec::with_capacity(WIDTH * HEIGHT);
    for j in 0..HEIGHT {
        for i in 0..WIDTH {
            let mut sum = vec3(0.0, 0.0, 0.0);
            for _ in 0..SAMPLES {
                let u = (i as f64 + rng.next_f64()) / WIDTH as f64;
                let v = ((HEIGHT - 1 - j) as f64 + rng.next_f64()) / HEIGHT as f64;
                sum = sum + ray_colour(&camera.ray(u, v), &world);
            }
            pixels.push(sum * (1.0 / SAMPLES as f64));
        }
    }
    pixels
}
pub fn run() -> Vec<Vec3> {
    let pixels = render();
    print!("{}", ascii(&pixels));
    println!("{} pixels, {SAMPLES} rays each", pixels.len());
    pixels
}
```

@hint `next_f64` writes the new state back into the generator. What does that require of the binding it lives in?
@hint `&mut self` on a method means the caller has to be able to produce a mutable borrow, and a plain `let` binding cannot.
@hint `let mut rng = Lcg::new(0x5eed);`

@diagnose E0596
`cannot borrow rng as mutable, as it is not declared as mutable`.

Mutability in Rust belongs to the binding, not to the type. `Lcg` has a method
that changes it, but whether any particular `Lcg` may be changed is decided
where it was bound. `rng.next_f64()` inserts an automatic `&mut rng`, and a
binding made with `let` cannot hand one out.

This looks like bureaucracy until you read someone else's function. Every
local that changes during the body says `mut` at its declaration, so scanning
the `let` lines tells you which values are stable for the rest of the
function. The compiler also warns about a `mut` nothing uses, which keeps the
marks honest.

@diagnose E0384
`cannot assign twice to immutable variable sum`. The accumulator inside the
sample loop has the same problem as `rng`: `sum = sum + ..` is a second
assignment to a binding that was only allowed one. `let mut sum` fixes it. The
error is `E0384` rather than `E0596` because assigning to a place is not the
same operation as borrowing it mutably.

@after
Seeding matters more here than it looks. A renderer that draws a different
picture every run cannot be tested, cannot be bisected when it regresses, and
cannot be compared against a reference image. Everything random in this program
comes from one `Lcg` created with one constant, so the whole render is a pure
function of the scene.

The shift by 11 before dividing is not decoration. The low bits of a linear
congruential generator are badly non-random, cycling with period 2 in the
bottom bit, so taking the top 53 and dividing by 2^53 gives both a better
sequence and exactly the number of bits an `f64` mantissa can hold.

Four samples is not many. The edges of the spheres are noticeably smoother than
one sample and still visibly rough, and error falls as the square root of the
count, so smooth costs hundreds.

## 7. What a surface does to light

@kind fix
@concept object safety

@expect E0038

A material answers one question: given a ray and where it landed, which ray
leaves and how much of each colour survives. Lambertian scatters near the
normal, metal reflects. Every `Hit` now carries a reference to the material it
landed on, and the trait as written cannot be referred to that way.

```starter
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

pub const fn vec3(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3 { x, y, z }
}

impl std::ops::Add for Vec3 {
    type Output = Vec3;
    fn add(self, o: Vec3) -> Vec3 { vec3(self.x + o.x, self.y + o.y, self.z + o.z) }
}

impl std::ops::Sub for Vec3 {
    type Output = Vec3;
    fn sub(self, o: Vec3) -> Vec3 { vec3(self.x - o.x, self.y - o.y, self.z - o.z) }
}

impl std::ops::Mul<f64> for Vec3 {
    type Output = Vec3;
    fn mul(self, k: f64) -> Vec3 { vec3(self.x * k, self.y * k, self.z * k) }
}

impl std::ops::Mul<Vec3> for Vec3 {
    type Output = Vec3;
    fn mul(self, o: Vec3) -> Vec3 { vec3(self.x * o.x, self.y * o.y, self.z * o.z) }
}

impl std::ops::Neg for Vec3 {
    type Output = Vec3;
    fn neg(self) -> Vec3 { vec3(-self.x, -self.y, -self.z) }
}

impl Vec3 {
    pub fn dot(self, o: Vec3) -> f64 { self.x * o.x + self.y * o.y + self.z * o.z }

    pub fn cross(self, o: Vec3) -> Vec3 {
        vec3(self.y * o.z - self.z * o.y,
             self.z * o.x - self.x * o.z,
             self.x * o.y - self.y * o.x)
    }

    pub fn length_squared(self) -> f64 { self.dot(self) }

    pub fn length(self) -> f64 { self.length_squared().sqrt() }

    pub fn unit(self) -> Vec3 { self * (1.0 / self.length()) }
}
#[derive(Debug, Clone, Copy)]
pub struct Ray {
    pub origin: Vec3,
    pub dir: Vec3,
}

impl Ray {
    pub fn at(self, t: f64) -> Vec3 { self.origin + self.dir * t }
}

pub struct Camera {
    pub origin: Vec3,
    pub lower_left: Vec3,
    pub horizontal: Vec3,
    pub vertical: Vec3,
}

impl Camera {
    pub fn new(aspect: f64) -> Camera {
        let height = 2.0;
        let origin = vec3(0.0, 0.0, 0.0);
        let horizontal = vec3(aspect * height, 0.0, 0.0);
        let vertical = vec3(0.0, height, 0.0);
        Camera {
            origin,
            horizontal,
            vertical,
            lower_left: origin - horizontal * 0.5 - vertical * 0.5 - vec3(0.0, 0.0, 1.0),
        }
    }

    pub fn ray(&self, u: f64, v: f64) -> Ray {
        Ray {
            origin: self.origin,
            dir: self.lower_left + self.horizontal * u + self.vertical * v - self.origin,
        }
    }
}
/// Five pixel coordinates: bottom left, top right, then three across the middle.
pub const PROBES: [(f64, f64); 5] =
    [(0.0, 0.0), (1.0, 1.0), (0.4, 0.5), (0.5, 0.5), (0.65, 0.5)];
pub fn hit_sphere(centre: Vec3, radius: f64, r: &Ray, t_min: f64, t_max: f64) -> Option<f64> {
    let oc = r.origin - centre;
    let a = r.dir.length_squared();
    let half_b = oc.dot(r.dir);
    let c = oc.length_squared() - radius * radius;

    let disc = half_b * half_b - a * c;
    if disc < 0.0 {
        return None;
    }
    let sqrtd = disc.sqrt();

    let mut root = (-half_b - sqrtd) / a;
    if root < t_min || root > t_max {
        root = (-half_b + sqrtd) / a;
        if root < t_min || root > t_max {
            return None;
        }
    }
    Some(root)
}
pub struct Hit {
    pub t: f64,
    pub p: Vec3,
    pub normal: Vec3,
    pub front_face: bool,
    pub material: &'static dyn Material,
}

/// An outward normal, flipped to face the ray, and which side we are on.
pub fn face_normal(r: &Ray, outward: Vec3) -> (Vec3, bool) {
    let front = r.dir.dot(outward) < 0.0;
    (if front { outward } else { -outward }, front)
}

pub trait Hittable {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit>;
}

pub struct Sphere {
    pub centre: Vec3,
    pub radius: f64,
    pub material: &'static dyn Material,
}

pub struct Plane {
    pub y: f64,
    pub material: &'static dyn Material,
}

impl Hittable for Sphere {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
        let t = hit_sphere(self.centre, self.radius, r, t_min, t_max)?;
        let p = r.at(t);
        let (normal, front_face) = face_normal(r, (p - self.centre) * (1.0 / self.radius));
        Some(Hit { t, p, normal, front_face, material: self.material })
    }
}

impl Hittable for Plane {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
        if r.dir.y.abs() < 1e-9 {
            return None;
        }
        let t = (self.y - r.origin.y) / r.dir.y;
        if t < t_min || t > t_max {
            return None;
        }
        let (normal, front_face) = face_normal(r, vec3(0.0, 1.0, 0.0));
        Some(Hit { t, p: r.at(t), normal, front_face, material: self.material })
    }
}

pub fn hit_world(world: &[Box<dyn Hittable>], r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
    let mut best: Option<Hit> = None;
    let mut closest = t_max;
    for object in world {
        if let Some(h) = object.hit(r, t_min, closest) {
            closest = h.t;
            best = Some(h);
        }
    }
    best
}

pub fn scene() -> Vec<Box<dyn Hittable>> {
    vec![
        Box::new(Plane { y: -0.5, material: &GROUND }),
        Box::new(Sphere { centre: vec3(-0.6, 0.0, -1.4), radius: 0.5, material: &CLAY }),
        Box::new(Sphere { centre: vec3(0.7, 0.0, -1.2), radius: 0.5, material: &CHROME }),
    ]
}
/// A linear congruential generator: the constants are the ones Knuth lists for
/// a 64-bit modulus. Seeded, so every render is the same render.
pub struct Lcg(u64);

impl Lcg {
    pub fn new(seed: u64) -> Lcg { Lcg(seed) }

    /// A fraction in [0, 1), from the top 53 bits, which is all an f64 holds.
    pub fn next_f64(&mut self) -> f64 {
        self.0 = self.0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }
}
/// A direction drawn uniformly from the unit sphere, by throwing darts at the
/// cube around it and keeping the ones that land inside.
pub fn random_unit(rng: &mut Lcg) -> Vec3 {
    loop {
        let p = vec3(rng.next_f64() * 2.0 - 1.0,
                     rng.next_f64() * 2.0 - 1.0,
                     rng.next_f64() * 2.0 - 1.0);
        let l2 = p.length_squared();
        if l2 > 1e-9 && l2 <= 1.0 {
            return p * (1.0 / l2.sqrt());
        }
    }
}

pub fn reflect(d: Vec3, n: Vec3) -> Vec3 {
    d - n * (2.0 * d.dot(n))
}

pub trait Material {
    /// The outgoing ray and how much of each colour survives the bounce.
    /// `None` means the ray was absorbed.
    fn scatter(&self, r: &Ray, hit: &Hit, rng: &mut Lcg) -> Option<(Ray, Vec3)>;

    /// The same material, darker. Concrete callers only.
    fn tinted(&self, k: f64) -> Self;
}

pub struct Lambertian {
    pub albedo: Vec3,
}

pub struct Metal {
    pub albedo: Vec3,
    pub fuzz: f64,
}

impl Material for Lambertian {
    fn scatter(&self, _r: &Ray, hit: &Hit, rng: &mut Lcg) -> Option<(Ray, Vec3)> {
        let mut dir = hit.normal + random_unit(rng);
        if dir.length_squared() < 1e-9 {
            dir = hit.normal;
        }
        Some((Ray { origin: hit.p, dir }, self.albedo))
    }

    fn tinted(&self, k: f64) -> Lambertian {
        Lambertian { albedo: self.albedo * k }
    }
}

impl Material for Metal {
    fn scatter(&self, r: &Ray, hit: &Hit, rng: &mut Lcg) -> Option<(Ray, Vec3)> {
        let dir = reflect(r.dir.unit(), hit.normal) + random_unit(rng) * self.fuzz;
        if dir.dot(hit.normal) > 0.0 {
            Some((Ray { origin: hit.p, dir }, self.albedo))
        } else {
            None
        }
    }

    fn tinted(&self, k: f64) -> Metal {
        Metal { albedo: self.albedo * k, fuzz: self.fuzz }
    }
}

pub static GROUND: Lambertian = Lambertian { albedo: vec3(0.55, 0.55, 0.50) };
pub static CLAY: Lambertian = Lambertian { albedo: vec3(0.80, 0.35, 0.30) };
pub static CHROME: Metal = Metal { albedo: vec3(0.85, 0.85, 0.88), fuzz: 0.05 };
pub const WIDTH: usize = 40;
pub const HEIGHT: usize = 20;
pub const SAMPLES: usize = 4;
pub const MAX_DEPTH: u32 = 8;
/// The image as characters, darkest to brightest, so a stage can be seen.
pub fn ascii(pixels: &[Vec3]) -> String {
    const RAMP: [char; 10] = [' ', '.', ':', '-', '=', '+', '*', '#', '%', '@'];
    let mut out = String::new();
    for j in 0..HEIGHT {
        for i in 0..WIDTH {
            let c = pixels[j * WIDTH + i];
            let brightness = ((c.x + c.y + c.z) / 3.0).max(0.0).sqrt().min(0.999);
            out.push(RAMP[(brightness * 10.0) as usize]);
        }
        out.push('\n');
    }
    out
}
pub fn ray_colour(r: &Ray, world: &[Box<dyn Hittable>], rng: &mut Lcg, depth: u32) -> Vec3 {
    if depth == 0 {
        return vec3(0.0, 0.0, 0.0);
    }
    if let Some(h) = hit_world(world, r, 0.001, f64::INFINITY) {
        return match h.material.scatter(r, &h, rng) {
            Some((scattered, albedo)) => albedo * ray_colour(&scattered, world, rng, depth - 1),
            None => vec3(0.0, 0.0, 0.0),
        };
    }
    let t = 0.5 * (r.dir.unit().y + 1.0);
    vec3(1.0, 1.0, 1.0) * (1.0 - t) + vec3(0.5, 0.7, 1.0) * t
}
pub fn render() -> Vec<Vec3> {
    let camera = Camera::new(WIDTH as f64 / HEIGHT as f64);
    let world = scene();
    let mut rng = Lcg::new(0x5eed);
    let mut pixels = Vec::with_capacity(WIDTH * HEIGHT);
    for j in 0..HEIGHT {
        for i in 0..WIDTH {
            let mut sum = vec3(0.0, 0.0, 0.0);
            for _ in 0..SAMPLES {
                let u = (i as f64 + rng.next_f64()) / WIDTH as f64;
                let v = ((HEIGHT - 1 - j) as f64 + rng.next_f64()) / HEIGHT as f64;
                sum = sum + ray_colour(&camera.ray(u, v), &world, &mut rng, MAX_DEPTH);
            }
            pixels.push(sum * (1.0 / SAMPLES as f64));
        }
    }
    pixels
}
pub fn run() -> Vec<Vec3> {
    let pixels = render();
    print!("{}", ascii(&pixels));
    println!("{} pixels, {SAMPLES} rays each, up to {MAX_DEPTH} bounces", pixels.len());
    println!("clay tinted by a half: {:?}", CLAY.tinted(0.5).albedo);
    pixels
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: Vec3, b: Vec3) -> bool { (a - b).length() < 1e-9 }

    fn hit_at(normal: Vec3) -> Hit {
        Hit { t: 1.0, p: vec3(0.0, 0.0, 0.0), normal, front_face: true, material: &CLAY }
    }

    #[test]
    fn reflection_mirrors_the_component_along_the_normal() {
        let n = vec3(0.0, 1.0, 0.0);
        assert!(close(reflect(vec3(1.0, -1.0, 0.0), n), vec3(1.0, 1.0, 0.0)));
        // straight down comes straight back up
        assert!(close(reflect(vec3(0.0, -1.0, 0.0), n), vec3(0.0, 1.0, 0.0)));
        // and the angle is preserved
        let d = vec3(0.3, -0.7, 0.2);
        assert!((reflect(d, n).length() - d.length()).abs() < 1e-9);
    }

    #[test]
    fn every_random_direction_is_a_unit_vector() {
        let mut rng = Lcg::new(7);
        for _ in 0..500 {
            assert!((random_unit(&mut rng).length() - 1.0).abs() < 1e-9);
        }
    }

    #[test]
    fn a_lambertian_scatters_off_the_surface_and_keeps_its_colour() {
        let mut rng = Lcg::new(11);
        let n = vec3(0.0, 1.0, 0.0);
        for _ in 0..200 {
            let (scattered, albedo) = CLAY.scatter(&Ray {
                origin: vec3(0.0, 2.0, 0.0),
                dir: vec3(0.0, -1.0, 0.0),
            }, &hit_at(n), &mut rng).unwrap();
            assert!(close(albedo, vec3(0.80, 0.35, 0.30)));
            assert!(close(scattered.origin, vec3(0.0, 0.0, 0.0)));
            assert!(scattered.dir.dot(n) > -1e-9);
        }
    }

    #[test]
    fn a_mirror_obeys_the_reflection_law() {
        let mirror = Metal { albedo: vec3(1.0, 1.0, 1.0), fuzz: 0.0 };
        let mut rng = Lcg::new(3);
        let n = vec3(0.0, 1.0, 0.0);
        let incoming = Ray { origin: vec3(0.0, 1.0, 0.0), dir: vec3(1.0, -1.0, 0.0) };
        let (scattered, _) = mirror.scatter(&incoming, &hit_at(n), &mut rng).unwrap();
        assert!(close(scattered.dir.unit(), vec3(1.0, 1.0, 0.0).unit()));
    }

    #[test]
    fn a_grazing_ray_is_absorbed_rather_than_sent_underground() {
        let rough = Metal { albedo: vec3(1.0, 1.0, 1.0), fuzz: 1.0 };
        let mut rng = Lcg::new(5);
        let n = vec3(0.0, 1.0, 0.0);
        let grazing = Ray { origin: vec3(0.0, 1.0, 0.0), dir: vec3(1.0, -0.02, 0.0) };
        let mut absorbed = 0;
        for _ in 0..400 {
            match rough.scatter(&grazing, &hit_at(n), &mut rng) {
                Some((s, _)) => assert!(s.dir.dot(n) > 0.0),
                None => absorbed += 1,
            }
        }
        assert!(absorbed > 0);
    }

    #[test]
    fn the_render_still_works_and_the_clay_is_redder_than_it_is_blue() {
        let pixels = run();
        assert_eq!(pixels.len(), WIDTH * HEIGHT);
        let clay = pixels[WIDTH * 8 + 13];
        assert!(clay.x > clay.z);
        // the sky above is still brighter than the shaded sphere
        assert!(pixels[13].x > clay.x);
    }
}
```

```solution
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

pub const fn vec3(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3 { x, y, z }
}

impl std::ops::Add for Vec3 {
    type Output = Vec3;
    fn add(self, o: Vec3) -> Vec3 { vec3(self.x + o.x, self.y + o.y, self.z + o.z) }
}

impl std::ops::Sub for Vec3 {
    type Output = Vec3;
    fn sub(self, o: Vec3) -> Vec3 { vec3(self.x - o.x, self.y - o.y, self.z - o.z) }
}

impl std::ops::Mul<f64> for Vec3 {
    type Output = Vec3;
    fn mul(self, k: f64) -> Vec3 { vec3(self.x * k, self.y * k, self.z * k) }
}

impl std::ops::Mul<Vec3> for Vec3 {
    type Output = Vec3;
    fn mul(self, o: Vec3) -> Vec3 { vec3(self.x * o.x, self.y * o.y, self.z * o.z) }
}

impl std::ops::Neg for Vec3 {
    type Output = Vec3;
    fn neg(self) -> Vec3 { vec3(-self.x, -self.y, -self.z) }
}

impl Vec3 {
    pub fn dot(self, o: Vec3) -> f64 { self.x * o.x + self.y * o.y + self.z * o.z }

    pub fn cross(self, o: Vec3) -> Vec3 {
        vec3(self.y * o.z - self.z * o.y,
             self.z * o.x - self.x * o.z,
             self.x * o.y - self.y * o.x)
    }

    pub fn length_squared(self) -> f64 { self.dot(self) }

    pub fn length(self) -> f64 { self.length_squared().sqrt() }

    pub fn unit(self) -> Vec3 { self * (1.0 / self.length()) }
}
#[derive(Debug, Clone, Copy)]
pub struct Ray {
    pub origin: Vec3,
    pub dir: Vec3,
}

impl Ray {
    pub fn at(self, t: f64) -> Vec3 { self.origin + self.dir * t }
}

pub struct Camera {
    pub origin: Vec3,
    pub lower_left: Vec3,
    pub horizontal: Vec3,
    pub vertical: Vec3,
}

impl Camera {
    pub fn new(aspect: f64) -> Camera {
        let height = 2.0;
        let origin = vec3(0.0, 0.0, 0.0);
        let horizontal = vec3(aspect * height, 0.0, 0.0);
        let vertical = vec3(0.0, height, 0.0);
        Camera {
            origin,
            horizontal,
            vertical,
            lower_left: origin - horizontal * 0.5 - vertical * 0.5 - vec3(0.0, 0.0, 1.0),
        }
    }

    pub fn ray(&self, u: f64, v: f64) -> Ray {
        Ray {
            origin: self.origin,
            dir: self.lower_left + self.horizontal * u + self.vertical * v - self.origin,
        }
    }
}
/// Five pixel coordinates: bottom left, top right, then three across the middle.
pub const PROBES: [(f64, f64); 5] =
    [(0.0, 0.0), (1.0, 1.0), (0.4, 0.5), (0.5, 0.5), (0.65, 0.5)];
pub fn hit_sphere(centre: Vec3, radius: f64, r: &Ray, t_min: f64, t_max: f64) -> Option<f64> {
    let oc = r.origin - centre;
    let a = r.dir.length_squared();
    let half_b = oc.dot(r.dir);
    let c = oc.length_squared() - radius * radius;

    let disc = half_b * half_b - a * c;
    if disc < 0.0 {
        return None;
    }
    let sqrtd = disc.sqrt();

    let mut root = (-half_b - sqrtd) / a;
    if root < t_min || root > t_max {
        root = (-half_b + sqrtd) / a;
        if root < t_min || root > t_max {
            return None;
        }
    }
    Some(root)
}
pub struct Hit {
    pub t: f64,
    pub p: Vec3,
    pub normal: Vec3,
    pub front_face: bool,
    pub material: &'static dyn Material,
}

/// An outward normal, flipped to face the ray, and which side we are on.
pub fn face_normal(r: &Ray, outward: Vec3) -> (Vec3, bool) {
    let front = r.dir.dot(outward) < 0.0;
    (if front { outward } else { -outward }, front)
}

pub trait Hittable {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit>;
}

pub struct Sphere {
    pub centre: Vec3,
    pub radius: f64,
    pub material: &'static dyn Material,
}

pub struct Plane {
    pub y: f64,
    pub material: &'static dyn Material,
}

impl Hittable for Sphere {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
        let t = hit_sphere(self.centre, self.radius, r, t_min, t_max)?;
        let p = r.at(t);
        let (normal, front_face) = face_normal(r, (p - self.centre) * (1.0 / self.radius));
        Some(Hit { t, p, normal, front_face, material: self.material })
    }
}

impl Hittable for Plane {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
        if r.dir.y.abs() < 1e-9 {
            return None;
        }
        let t = (self.y - r.origin.y) / r.dir.y;
        if t < t_min || t > t_max {
            return None;
        }
        let (normal, front_face) = face_normal(r, vec3(0.0, 1.0, 0.0));
        Some(Hit { t, p: r.at(t), normal, front_face, material: self.material })
    }
}

pub fn hit_world(world: &[Box<dyn Hittable>], r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
    let mut best: Option<Hit> = None;
    let mut closest = t_max;
    for object in world {
        if let Some(h) = object.hit(r, t_min, closest) {
            closest = h.t;
            best = Some(h);
        }
    }
    best
}

pub fn scene() -> Vec<Box<dyn Hittable>> {
    vec![
        Box::new(Plane { y: -0.5, material: &GROUND }),
        Box::new(Sphere { centre: vec3(-0.6, 0.0, -1.4), radius: 0.5, material: &CLAY }),
        Box::new(Sphere { centre: vec3(0.7, 0.0, -1.2), radius: 0.5, material: &CHROME }),
    ]
}
/// A linear congruential generator: the constants are the ones Knuth lists for
/// a 64-bit modulus. Seeded, so every render is the same render.
pub struct Lcg(u64);

impl Lcg {
    pub fn new(seed: u64) -> Lcg { Lcg(seed) }

    /// A fraction in [0, 1), from the top 53 bits, which is all an f64 holds.
    pub fn next_f64(&mut self) -> f64 {
        self.0 = self.0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }
}
/// A direction drawn uniformly from the unit sphere, by throwing darts at the
/// cube around it and keeping the ones that land inside.
pub fn random_unit(rng: &mut Lcg) -> Vec3 {
    loop {
        let p = vec3(rng.next_f64() * 2.0 - 1.0,
                     rng.next_f64() * 2.0 - 1.0,
                     rng.next_f64() * 2.0 - 1.0);
        let l2 = p.length_squared();
        if l2 > 1e-9 && l2 <= 1.0 {
            return p * (1.0 / l2.sqrt());
        }
    }
}

pub fn reflect(d: Vec3, n: Vec3) -> Vec3 {
    d - n * (2.0 * d.dot(n))
}

pub trait Material {
    /// The outgoing ray and how much of each colour survives the bounce.
    /// `None` means the ray was absorbed.
    fn scatter(&self, r: &Ray, hit: &Hit, rng: &mut Lcg) -> Option<(Ray, Vec3)>;

    /// The same material, darker. Concrete callers only.
    fn tinted(&self, k: f64) -> Self
    where
        Self: Sized;
}

pub struct Lambertian {
    pub albedo: Vec3,
}

pub struct Metal {
    pub albedo: Vec3,
    pub fuzz: f64,
}

impl Material for Lambertian {
    fn scatter(&self, _r: &Ray, hit: &Hit, rng: &mut Lcg) -> Option<(Ray, Vec3)> {
        let mut dir = hit.normal + random_unit(rng);
        if dir.length_squared() < 1e-9 {
            dir = hit.normal;
        }
        Some((Ray { origin: hit.p, dir }, self.albedo))
    }

    fn tinted(&self, k: f64) -> Lambertian {
        Lambertian { albedo: self.albedo * k }
    }
}

impl Material for Metal {
    fn scatter(&self, r: &Ray, hit: &Hit, rng: &mut Lcg) -> Option<(Ray, Vec3)> {
        let dir = reflect(r.dir.unit(), hit.normal) + random_unit(rng) * self.fuzz;
        if dir.dot(hit.normal) > 0.0 {
            Some((Ray { origin: hit.p, dir }, self.albedo))
        } else {
            None
        }
    }

    fn tinted(&self, k: f64) -> Metal {
        Metal { albedo: self.albedo * k, fuzz: self.fuzz }
    }
}

pub static GROUND: Lambertian = Lambertian { albedo: vec3(0.55, 0.55, 0.50) };
pub static CLAY: Lambertian = Lambertian { albedo: vec3(0.80, 0.35, 0.30) };
pub static CHROME: Metal = Metal { albedo: vec3(0.85, 0.85, 0.88), fuzz: 0.05 };
pub const WIDTH: usize = 40;
pub const HEIGHT: usize = 20;
pub const SAMPLES: usize = 4;
pub const MAX_DEPTH: u32 = 8;
/// The image as characters, darkest to brightest, so a stage can be seen.
pub fn ascii(pixels: &[Vec3]) -> String {
    const RAMP: [char; 10] = [' ', '.', ':', '-', '=', '+', '*', '#', '%', '@'];
    let mut out = String::new();
    for j in 0..HEIGHT {
        for i in 0..WIDTH {
            let c = pixels[j * WIDTH + i];
            let brightness = ((c.x + c.y + c.z) / 3.0).max(0.0).sqrt().min(0.999);
            out.push(RAMP[(brightness * 10.0) as usize]);
        }
        out.push('\n');
    }
    out
}
pub fn ray_colour(r: &Ray, world: &[Box<dyn Hittable>], rng: &mut Lcg, depth: u32) -> Vec3 {
    if depth == 0 {
        return vec3(0.0, 0.0, 0.0);
    }
    if let Some(h) = hit_world(world, r, 0.001, f64::INFINITY) {
        return match h.material.scatter(r, &h, rng) {
            Some((scattered, albedo)) => albedo * ray_colour(&scattered, world, rng, depth - 1),
            None => vec3(0.0, 0.0, 0.0),
        };
    }
    let t = 0.5 * (r.dir.unit().y + 1.0);
    vec3(1.0, 1.0, 1.0) * (1.0 - t) + vec3(0.5, 0.7, 1.0) * t
}
pub fn render() -> Vec<Vec3> {
    let camera = Camera::new(WIDTH as f64 / HEIGHT as f64);
    let world = scene();
    let mut rng = Lcg::new(0x5eed);
    let mut pixels = Vec::with_capacity(WIDTH * HEIGHT);
    for j in 0..HEIGHT {
        for i in 0..WIDTH {
            let mut sum = vec3(0.0, 0.0, 0.0);
            for _ in 0..SAMPLES {
                let u = (i as f64 + rng.next_f64()) / WIDTH as f64;
                let v = ((HEIGHT - 1 - j) as f64 + rng.next_f64()) / HEIGHT as f64;
                sum = sum + ray_colour(&camera.ray(u, v), &world, &mut rng, MAX_DEPTH);
            }
            pixels.push(sum * (1.0 / SAMPLES as f64));
        }
    }
    pixels
}
pub fn run() -> Vec<Vec3> {
    let pixels = render();
    print!("{}", ascii(&pixels));
    println!("{} pixels, {SAMPLES} rays each, up to {MAX_DEPTH} bounces", pixels.len());
    println!("clay tinted by a half: {:?}", CLAY.tinted(0.5).albedo);
    pixels
}
```

@hint The error points at `&'static dyn Material`, and the cause is in the trait declaration above it.
@hint A call through a trait object goes via a vtable, and the caller holds only a pointer. Which of the two methods could it not generate a call to?
@hint `tinted` returns `Self`, whose size a caller with a trait object cannot know. Keep the method and leave it out of the vtable: `fn tinted(&self, k: f64) -> Self where Self: Sized;`

@diagnose E0038
`the trait Material is not dyn compatible`, then `because method tinted
references the Self type in its return type`. Older compilers word this as
`cannot be made into an object`.

A `&dyn Material` is two pointers: one at the value, one at a vtable of
function addresses. Everything the caller knows about the value comes through
that table. `scatter` is fine, because every type in its signature has a size
known at the call site. `tinted` returns `Self`, and the caller has no idea
whether `Self` is a 24-byte `Lambertian` or a 32-byte `Metal`, so it cannot
reserve space for the result.

`where Self: Sized` says the method exists only where the concrete type is
known. It stays callable on a `Lambertian`, it is left out of the vtable, and
the trait becomes usable as `dyn`.

@diagnose E0106
`missing lifetime specifier`. A reference in a struct field has to say how long
the thing it points at lives, and `&dyn Material` says nothing. The materials
here are `static` items that exist for the whole program, so `&'static dyn
Material` is the honest answer and it keeps `Hit` free of a lifetime parameter.
A renderer building its scene at run time would write `Hit<'a>` and thread the
lifetime through instead, or reach for `Rc<dyn Material>`.

@after
The picture just got darker and noisier, and that is correct. Until now every
surface reported its normal and the renderer painted it. Now a ray has to
actually find its way to the sky, bouncing and losing energy at each surface,
and with four samples per pixel many of them wander into shadow instead.
`MAX_DEPTH` caps the wandering at eight bounces and returns black, which
slightly darkens deep corners and stops the recursion from running away.

`Metal::scatter` can return `None`. With a non-zero fuzz the perturbed
reflection sometimes points below the surface, and rather than let a ray leave
through the inside of an object, the material absorbs it.

## 8. A file you can open

@kind fix
@concept trait

@expect E0599

PPM is three header lines and then one `r g b` line per pixel, and every image
viewer written since 1988 reads it. Gamma goes on at the end, because the
renderer works in linear light and a screen does not. Building the string does
not compile.

```starter
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

pub const fn vec3(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3 { x, y, z }
}

impl std::ops::Add for Vec3 {
    type Output = Vec3;
    fn add(self, o: Vec3) -> Vec3 { vec3(self.x + o.x, self.y + o.y, self.z + o.z) }
}

impl std::ops::Sub for Vec3 {
    type Output = Vec3;
    fn sub(self, o: Vec3) -> Vec3 { vec3(self.x - o.x, self.y - o.y, self.z - o.z) }
}

impl std::ops::Mul<f64> for Vec3 {
    type Output = Vec3;
    fn mul(self, k: f64) -> Vec3 { vec3(self.x * k, self.y * k, self.z * k) }
}

impl std::ops::Mul<Vec3> for Vec3 {
    type Output = Vec3;
    fn mul(self, o: Vec3) -> Vec3 { vec3(self.x * o.x, self.y * o.y, self.z * o.z) }
}

impl std::ops::Neg for Vec3 {
    type Output = Vec3;
    fn neg(self) -> Vec3 { vec3(-self.x, -self.y, -self.z) }
}

impl Vec3 {
    pub fn dot(self, o: Vec3) -> f64 { self.x * o.x + self.y * o.y + self.z * o.z }

    pub fn cross(self, o: Vec3) -> Vec3 {
        vec3(self.y * o.z - self.z * o.y,
             self.z * o.x - self.x * o.z,
             self.x * o.y - self.y * o.x)
    }

    pub fn length_squared(self) -> f64 { self.dot(self) }

    pub fn length(self) -> f64 { self.length_squared().sqrt() }

    pub fn unit(self) -> Vec3 { self * (1.0 / self.length()) }
}
#[derive(Debug, Clone, Copy)]
pub struct Ray {
    pub origin: Vec3,
    pub dir: Vec3,
}

impl Ray {
    pub fn at(self, t: f64) -> Vec3 { self.origin + self.dir * t }
}

pub struct Camera {
    pub origin: Vec3,
    pub lower_left: Vec3,
    pub horizontal: Vec3,
    pub vertical: Vec3,
}

impl Camera {
    pub fn new(aspect: f64) -> Camera {
        let height = 2.0;
        let origin = vec3(0.0, 0.0, 0.0);
        let horizontal = vec3(aspect * height, 0.0, 0.0);
        let vertical = vec3(0.0, height, 0.0);
        Camera {
            origin,
            horizontal,
            vertical,
            lower_left: origin - horizontal * 0.5 - vertical * 0.5 - vec3(0.0, 0.0, 1.0),
        }
    }

    pub fn ray(&self, u: f64, v: f64) -> Ray {
        Ray {
            origin: self.origin,
            dir: self.lower_left + self.horizontal * u + self.vertical * v - self.origin,
        }
    }
}
/// Five pixel coordinates: bottom left, top right, then three across the middle.
pub const PROBES: [(f64, f64); 5] =
    [(0.0, 0.0), (1.0, 1.0), (0.4, 0.5), (0.5, 0.5), (0.65, 0.5)];
pub fn hit_sphere(centre: Vec3, radius: f64, r: &Ray, t_min: f64, t_max: f64) -> Option<f64> {
    let oc = r.origin - centre;
    let a = r.dir.length_squared();
    let half_b = oc.dot(r.dir);
    let c = oc.length_squared() - radius * radius;

    let disc = half_b * half_b - a * c;
    if disc < 0.0 {
        return None;
    }
    let sqrtd = disc.sqrt();

    let mut root = (-half_b - sqrtd) / a;
    if root < t_min || root > t_max {
        root = (-half_b + sqrtd) / a;
        if root < t_min || root > t_max {
            return None;
        }
    }
    Some(root)
}
pub struct Hit {
    pub t: f64,
    pub p: Vec3,
    pub normal: Vec3,
    pub front_face: bool,
    pub material: &'static dyn Material,
}

/// An outward normal, flipped to face the ray, and which side we are on.
pub fn face_normal(r: &Ray, outward: Vec3) -> (Vec3, bool) {
    let front = r.dir.dot(outward) < 0.0;
    (if front { outward } else { -outward }, front)
}

pub trait Hittable {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit>;
}

pub struct Sphere {
    pub centre: Vec3,
    pub radius: f64,
    pub material: &'static dyn Material,
}

pub struct Plane {
    pub y: f64,
    pub material: &'static dyn Material,
}

impl Hittable for Sphere {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
        let t = hit_sphere(self.centre, self.radius, r, t_min, t_max)?;
        let p = r.at(t);
        let (normal, front_face) = face_normal(r, (p - self.centre) * (1.0 / self.radius));
        Some(Hit { t, p, normal, front_face, material: self.material })
    }
}

impl Hittable for Plane {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
        if r.dir.y.abs() < 1e-9 {
            return None;
        }
        let t = (self.y - r.origin.y) / r.dir.y;
        if t < t_min || t > t_max {
            return None;
        }
        let (normal, front_face) = face_normal(r, vec3(0.0, 1.0, 0.0));
        Some(Hit { t, p: r.at(t), normal, front_face, material: self.material })
    }
}

pub fn hit_world(world: &[Box<dyn Hittable>], r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
    let mut best: Option<Hit> = None;
    let mut closest = t_max;
    for object in world {
        if let Some(h) = object.hit(r, t_min, closest) {
            closest = h.t;
            best = Some(h);
        }
    }
    best
}

pub fn scene() -> Vec<Box<dyn Hittable>> {
    vec![
        Box::new(Plane { y: -0.5, material: &GROUND }),
        Box::new(Sphere { centre: vec3(-0.6, 0.0, -1.4), radius: 0.5, material: &CLAY }),
        Box::new(Sphere { centre: vec3(0.7, 0.0, -1.2), radius: 0.5, material: &CHROME }),
    ]
}
/// A linear congruential generator: the constants are the ones Knuth lists for
/// a 64-bit modulus. Seeded, so every render is the same render.
pub struct Lcg(u64);

impl Lcg {
    pub fn new(seed: u64) -> Lcg { Lcg(seed) }

    /// A fraction in [0, 1), from the top 53 bits, which is all an f64 holds.
    pub fn next_f64(&mut self) -> f64 {
        self.0 = self.0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }
}
/// A direction drawn uniformly from the unit sphere, by throwing darts at the
/// cube around it and keeping the ones that land inside.
pub fn random_unit(rng: &mut Lcg) -> Vec3 {
    loop {
        let p = vec3(rng.next_f64() * 2.0 - 1.0,
                     rng.next_f64() * 2.0 - 1.0,
                     rng.next_f64() * 2.0 - 1.0);
        let l2 = p.length_squared();
        if l2 > 1e-9 && l2 <= 1.0 {
            return p * (1.0 / l2.sqrt());
        }
    }
}

pub fn reflect(d: Vec3, n: Vec3) -> Vec3 {
    d - n * (2.0 * d.dot(n))
}

pub trait Material {
    /// The outgoing ray and how much of each colour survives the bounce.
    /// `None` means the ray was absorbed.
    fn scatter(&self, r: &Ray, hit: &Hit, rng: &mut Lcg) -> Option<(Ray, Vec3)>;

    /// The same material, darker. Concrete callers only.
    fn tinted(&self, k: f64) -> Self
    where
        Self: Sized;
}

pub struct Lambertian {
    pub albedo: Vec3,
}

pub struct Metal {
    pub albedo: Vec3,
    pub fuzz: f64,
}

impl Material for Lambertian {
    fn scatter(&self, _r: &Ray, hit: &Hit, rng: &mut Lcg) -> Option<(Ray, Vec3)> {
        let mut dir = hit.normal + random_unit(rng);
        if dir.length_squared() < 1e-9 {
            dir = hit.normal;
        }
        Some((Ray { origin: hit.p, dir }, self.albedo))
    }

    fn tinted(&self, k: f64) -> Lambertian {
        Lambertian { albedo: self.albedo * k }
    }
}

impl Material for Metal {
    fn scatter(&self, r: &Ray, hit: &Hit, rng: &mut Lcg) -> Option<(Ray, Vec3)> {
        let dir = reflect(r.dir.unit(), hit.normal) + random_unit(rng) * self.fuzz;
        if dir.dot(hit.normal) > 0.0 {
            Some((Ray { origin: hit.p, dir }, self.albedo))
        } else {
            None
        }
    }

    fn tinted(&self, k: f64) -> Metal {
        Metal { albedo: self.albedo * k, fuzz: self.fuzz }
    }
}

pub static GROUND: Lambertian = Lambertian { albedo: vec3(0.55, 0.55, 0.50) };
pub static CLAY: Lambertian = Lambertian { albedo: vec3(0.80, 0.35, 0.30) };
pub static CHROME: Metal = Metal { albedo: vec3(0.85, 0.85, 0.88), fuzz: 0.05 };
pub const WIDTH: usize = 40;
pub const HEIGHT: usize = 20;
pub const SAMPLES: usize = 4;
pub const MAX_DEPTH: u32 = 8;
/// The image as characters, darkest to brightest, so a stage can be seen.
pub fn ascii(pixels: &[Vec3]) -> String {
    const RAMP: [char; 10] = [' ', '.', ':', '-', '=', '+', '*', '#', '%', '@'];
    let mut out = String::new();
    for j in 0..HEIGHT {
        for i in 0..WIDTH {
            let c = pixels[j * WIDTH + i];
            let brightness = ((c.x + c.y + c.z) / 3.0).max(0.0).sqrt().min(0.999);
            out.push(RAMP[(brightness * 10.0) as usize]);
        }
        out.push('\n');
    }
    out
}
pub fn ray_colour(r: &Ray, world: &[Box<dyn Hittable>], rng: &mut Lcg, depth: u32) -> Vec3 {
    if depth == 0 {
        return vec3(0.0, 0.0, 0.0);
    }
    if let Some(h) = hit_world(world, r, 0.001, f64::INFINITY) {
        return match h.material.scatter(r, &h, rng) {
            Some((scattered, albedo)) => albedo * ray_colour(&scattered, world, rng, depth - 1),
            None => vec3(0.0, 0.0, 0.0),
        };
    }
    let t = 0.5 * (r.dir.unit().y + 1.0);
    vec3(1.0, 1.0, 1.0) * (1.0 - t) + vec3(0.5, 0.7, 1.0) * t
}
pub fn render() -> Vec<Vec3> {
    let camera = Camera::new(WIDTH as f64 / HEIGHT as f64);
    let world = scene();
    let mut rng = Lcg::new(0x5eed);
    let mut pixels = Vec::with_capacity(WIDTH * HEIGHT);
    for j in 0..HEIGHT {
        for i in 0..WIDTH {
            let mut sum = vec3(0.0, 0.0, 0.0);
            for _ in 0..SAMPLES {
                let u = (i as f64 + rng.next_f64()) / WIDTH as f64;
                let v = ((HEIGHT - 1 - j) as f64 + rng.next_f64()) / HEIGHT as f64;
                sum = sum + ray_colour(&camera.ray(u, v), &world, &mut rng, MAX_DEPTH);
            }
            pixels.push(sum * (1.0 / SAMPLES as f64));
        }
    }
    pixels
}
pub fn to_ppm(pixels: &[Vec3]) -> String {
    // Gamma 2 on the way out, because a renderer works in linear light and a
    // screen does not.
    let channel = |x: f64| (x.max(0.0).sqrt().min(0.999) * 256.0) as u32;

    let mut out = String::new();
    writeln!(out, "P3").unwrap();
    writeln!(out, "{WIDTH} {HEIGHT}").unwrap();
    writeln!(out, "255").unwrap();
    for c in pixels {
        writeln!(out, "{} {} {}", channel(c.x), channel(c.y), channel(c.z)).unwrap();
    }
    out
}
pub fn run() -> String {
    let pixels = render();
    print!("{}", ascii(&pixels));

    let ppm = to_ppm(&pixels);
    for line in ppm.lines().take(6) {
        println!("{line}");
    }
    println!("... {} lines of PPM in total", ppm.lines().count());
    ppm
}
```

```tests
#[cfg(test)]
mod tests {
    use super::*;

    fn pixels_of(ppm: &str) -> Vec<[u32; 3]> {
        ppm.lines()
            .skip(3)
            .map(|l| {
                let n: Vec<u32> = l.split_whitespace().map(|w| w.parse().unwrap()).collect();
                [n[0], n[1], n[2]]
            })
            .collect()
    }

    #[test]
    fn the_header_says_what_the_file_is() {
        let ppm = run();
        let mut lines = ppm.lines();
        assert_eq!(lines.next(), Some("P3"));
        assert_eq!(lines.next(), Some("40 20"));
        assert_eq!(lines.next(), Some("255"));
        assert_eq!(ppm.lines().count(), 3 + WIDTH * HEIGHT);
    }

    #[test]
    fn every_pixel_is_three_numbers_a_byte_wide() {
        let px = pixels_of(&run());
        assert_eq!(px.len(), WIDTH * HEIGHT);
        for c in &px {
            for channel in c {
                assert!(*channel <= 255);
            }
        }
    }

    #[test]
    fn the_top_of_the_frame_is_sky() {
        let px = pixels_of(&to_ppm(&render()));
        let top = px[0];
        assert_eq!(top[2], 255);
        assert!((top[0] as i32 - 206).abs() <= 3);
        assert!((top[1] as i32 - 227).abs() <= 3);
        assert!(top[0] < top[1] && top[1] < top[2]);
    }

    #[test]
    fn the_bottom_of_the_frame_is_ground_and_darker_than_the_sky() {
        let px = pixels_of(&to_ppm(&render()));
        let sky: u32 = px[..WIDTH].iter().map(|c| c[0] + c[1] + c[2]).sum();
        let ground: u32 = px[px.len() - WIDTH..].iter().map(|c| c[0] + c[1] + c[2]).sum();
        assert!(ground < sky);
        assert!(ground > 0);
    }

    #[test]
    fn gamma_lifts_the_dark_half_of_the_image() {
        // A linear 0.25 is a quarter of the light and just over half the byte.
        let straight = to_ppm(&[vec3(0.25, 0.5, 1.0)]);
        let line = straight.lines().nth(3).unwrap();
        let n: Vec<u32> = line.split_whitespace().map(|w| w.parse().unwrap()).collect();
        assert_eq!(n[0], 128);
        assert!((n[1] as i32 - 181).abs() <= 1);
        assert_eq!(n[2], 255);
    }
}
```

```solution
use std::fmt::Write;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

pub const fn vec3(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3 { x, y, z }
}

impl std::ops::Add for Vec3 {
    type Output = Vec3;
    fn add(self, o: Vec3) -> Vec3 { vec3(self.x + o.x, self.y + o.y, self.z + o.z) }
}

impl std::ops::Sub for Vec3 {
    type Output = Vec3;
    fn sub(self, o: Vec3) -> Vec3 { vec3(self.x - o.x, self.y - o.y, self.z - o.z) }
}

impl std::ops::Mul<f64> for Vec3 {
    type Output = Vec3;
    fn mul(self, k: f64) -> Vec3 { vec3(self.x * k, self.y * k, self.z * k) }
}

impl std::ops::Mul<Vec3> for Vec3 {
    type Output = Vec3;
    fn mul(self, o: Vec3) -> Vec3 { vec3(self.x * o.x, self.y * o.y, self.z * o.z) }
}

impl std::ops::Neg for Vec3 {
    type Output = Vec3;
    fn neg(self) -> Vec3 { vec3(-self.x, -self.y, -self.z) }
}

impl Vec3 {
    pub fn dot(self, o: Vec3) -> f64 { self.x * o.x + self.y * o.y + self.z * o.z }

    pub fn cross(self, o: Vec3) -> Vec3 {
        vec3(self.y * o.z - self.z * o.y,
             self.z * o.x - self.x * o.z,
             self.x * o.y - self.y * o.x)
    }

    pub fn length_squared(self) -> f64 { self.dot(self) }

    pub fn length(self) -> f64 { self.length_squared().sqrt() }

    pub fn unit(self) -> Vec3 { self * (1.0 / self.length()) }
}
#[derive(Debug, Clone, Copy)]
pub struct Ray {
    pub origin: Vec3,
    pub dir: Vec3,
}

impl Ray {
    pub fn at(self, t: f64) -> Vec3 { self.origin + self.dir * t }
}

pub struct Camera {
    pub origin: Vec3,
    pub lower_left: Vec3,
    pub horizontal: Vec3,
    pub vertical: Vec3,
}

impl Camera {
    pub fn new(aspect: f64) -> Camera {
        let height = 2.0;
        let origin = vec3(0.0, 0.0, 0.0);
        let horizontal = vec3(aspect * height, 0.0, 0.0);
        let vertical = vec3(0.0, height, 0.0);
        Camera {
            origin,
            horizontal,
            vertical,
            lower_left: origin - horizontal * 0.5 - vertical * 0.5 - vec3(0.0, 0.0, 1.0),
        }
    }

    pub fn ray(&self, u: f64, v: f64) -> Ray {
        Ray {
            origin: self.origin,
            dir: self.lower_left + self.horizontal * u + self.vertical * v - self.origin,
        }
    }
}
/// Five pixel coordinates: bottom left, top right, then three across the middle.
pub const PROBES: [(f64, f64); 5] =
    [(0.0, 0.0), (1.0, 1.0), (0.4, 0.5), (0.5, 0.5), (0.65, 0.5)];
pub fn hit_sphere(centre: Vec3, radius: f64, r: &Ray, t_min: f64, t_max: f64) -> Option<f64> {
    let oc = r.origin - centre;
    let a = r.dir.length_squared();
    let half_b = oc.dot(r.dir);
    let c = oc.length_squared() - radius * radius;

    let disc = half_b * half_b - a * c;
    if disc < 0.0 {
        return None;
    }
    let sqrtd = disc.sqrt();

    let mut root = (-half_b - sqrtd) / a;
    if root < t_min || root > t_max {
        root = (-half_b + sqrtd) / a;
        if root < t_min || root > t_max {
            return None;
        }
    }
    Some(root)
}
pub struct Hit {
    pub t: f64,
    pub p: Vec3,
    pub normal: Vec3,
    pub front_face: bool,
    pub material: &'static dyn Material,
}

/// An outward normal, flipped to face the ray, and which side we are on.
pub fn face_normal(r: &Ray, outward: Vec3) -> (Vec3, bool) {
    let front = r.dir.dot(outward) < 0.0;
    (if front { outward } else { -outward }, front)
}

pub trait Hittable {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit>;
}

pub struct Sphere {
    pub centre: Vec3,
    pub radius: f64,
    pub material: &'static dyn Material,
}

pub struct Plane {
    pub y: f64,
    pub material: &'static dyn Material,
}

impl Hittable for Sphere {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
        let t = hit_sphere(self.centre, self.radius, r, t_min, t_max)?;
        let p = r.at(t);
        let (normal, front_face) = face_normal(r, (p - self.centre) * (1.0 / self.radius));
        Some(Hit { t, p, normal, front_face, material: self.material })
    }
}

impl Hittable for Plane {
    fn hit(&self, r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
        if r.dir.y.abs() < 1e-9 {
            return None;
        }
        let t = (self.y - r.origin.y) / r.dir.y;
        if t < t_min || t > t_max {
            return None;
        }
        let (normal, front_face) = face_normal(r, vec3(0.0, 1.0, 0.0));
        Some(Hit { t, p: r.at(t), normal, front_face, material: self.material })
    }
}

pub fn hit_world(world: &[Box<dyn Hittable>], r: &Ray, t_min: f64, t_max: f64) -> Option<Hit> {
    let mut best: Option<Hit> = None;
    let mut closest = t_max;
    for object in world {
        if let Some(h) = object.hit(r, t_min, closest) {
            closest = h.t;
            best = Some(h);
        }
    }
    best
}

pub fn scene() -> Vec<Box<dyn Hittable>> {
    vec![
        Box::new(Plane { y: -0.5, material: &GROUND }),
        Box::new(Sphere { centre: vec3(-0.6, 0.0, -1.4), radius: 0.5, material: &CLAY }),
        Box::new(Sphere { centre: vec3(0.7, 0.0, -1.2), radius: 0.5, material: &CHROME }),
    ]
}
/// A linear congruential generator: the constants are the ones Knuth lists for
/// a 64-bit modulus. Seeded, so every render is the same render.
pub struct Lcg(u64);

impl Lcg {
    pub fn new(seed: u64) -> Lcg { Lcg(seed) }

    /// A fraction in [0, 1), from the top 53 bits, which is all an f64 holds.
    pub fn next_f64(&mut self) -> f64 {
        self.0 = self.0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }
}
/// A direction drawn uniformly from the unit sphere, by throwing darts at the
/// cube around it and keeping the ones that land inside.
pub fn random_unit(rng: &mut Lcg) -> Vec3 {
    loop {
        let p = vec3(rng.next_f64() * 2.0 - 1.0,
                     rng.next_f64() * 2.0 - 1.0,
                     rng.next_f64() * 2.0 - 1.0);
        let l2 = p.length_squared();
        if l2 > 1e-9 && l2 <= 1.0 {
            return p * (1.0 / l2.sqrt());
        }
    }
}

pub fn reflect(d: Vec3, n: Vec3) -> Vec3 {
    d - n * (2.0 * d.dot(n))
}

pub trait Material {
    /// The outgoing ray and how much of each colour survives the bounce.
    /// `None` means the ray was absorbed.
    fn scatter(&self, r: &Ray, hit: &Hit, rng: &mut Lcg) -> Option<(Ray, Vec3)>;

    /// The same material, darker. Concrete callers only.
    fn tinted(&self, k: f64) -> Self
    where
        Self: Sized;
}

pub struct Lambertian {
    pub albedo: Vec3,
}

pub struct Metal {
    pub albedo: Vec3,
    pub fuzz: f64,
}

impl Material for Lambertian {
    fn scatter(&self, _r: &Ray, hit: &Hit, rng: &mut Lcg) -> Option<(Ray, Vec3)> {
        let mut dir = hit.normal + random_unit(rng);
        if dir.length_squared() < 1e-9 {
            dir = hit.normal;
        }
        Some((Ray { origin: hit.p, dir }, self.albedo))
    }

    fn tinted(&self, k: f64) -> Lambertian {
        Lambertian { albedo: self.albedo * k }
    }
}

impl Material for Metal {
    fn scatter(&self, r: &Ray, hit: &Hit, rng: &mut Lcg) -> Option<(Ray, Vec3)> {
        let dir = reflect(r.dir.unit(), hit.normal) + random_unit(rng) * self.fuzz;
        if dir.dot(hit.normal) > 0.0 {
            Some((Ray { origin: hit.p, dir }, self.albedo))
        } else {
            None
        }
    }

    fn tinted(&self, k: f64) -> Metal {
        Metal { albedo: self.albedo * k, fuzz: self.fuzz }
    }
}

pub static GROUND: Lambertian = Lambertian { albedo: vec3(0.55, 0.55, 0.50) };
pub static CLAY: Lambertian = Lambertian { albedo: vec3(0.80, 0.35, 0.30) };
pub static CHROME: Metal = Metal { albedo: vec3(0.85, 0.85, 0.88), fuzz: 0.05 };
pub const WIDTH: usize = 40;
pub const HEIGHT: usize = 20;
pub const SAMPLES: usize = 4;
pub const MAX_DEPTH: u32 = 8;
/// The image as characters, darkest to brightest, so a stage can be seen.
pub fn ascii(pixels: &[Vec3]) -> String {
    const RAMP: [char; 10] = [' ', '.', ':', '-', '=', '+', '*', '#', '%', '@'];
    let mut out = String::new();
    for j in 0..HEIGHT {
        for i in 0..WIDTH {
            let c = pixels[j * WIDTH + i];
            let brightness = ((c.x + c.y + c.z) / 3.0).max(0.0).sqrt().min(0.999);
            out.push(RAMP[(brightness * 10.0) as usize]);
        }
        out.push('\n');
    }
    out
}
pub fn ray_colour(r: &Ray, world: &[Box<dyn Hittable>], rng: &mut Lcg, depth: u32) -> Vec3 {
    if depth == 0 {
        return vec3(0.0, 0.0, 0.0);
    }
    if let Some(h) = hit_world(world, r, 0.001, f64::INFINITY) {
        return match h.material.scatter(r, &h, rng) {
            Some((scattered, albedo)) => albedo * ray_colour(&scattered, world, rng, depth - 1),
            None => vec3(0.0, 0.0, 0.0),
        };
    }
    let t = 0.5 * (r.dir.unit().y + 1.0);
    vec3(1.0, 1.0, 1.0) * (1.0 - t) + vec3(0.5, 0.7, 1.0) * t
}
pub fn render() -> Vec<Vec3> {
    let camera = Camera::new(WIDTH as f64 / HEIGHT as f64);
    let world = scene();
    let mut rng = Lcg::new(0x5eed);
    let mut pixels = Vec::with_capacity(WIDTH * HEIGHT);
    for j in 0..HEIGHT {
        for i in 0..WIDTH {
            let mut sum = vec3(0.0, 0.0, 0.0);
            for _ in 0..SAMPLES {
                let u = (i as f64 + rng.next_f64()) / WIDTH as f64;
                let v = ((HEIGHT - 1 - j) as f64 + rng.next_f64()) / HEIGHT as f64;
                sum = sum + ray_colour(&camera.ray(u, v), &world, &mut rng, MAX_DEPTH);
            }
            pixels.push(sum * (1.0 / SAMPLES as f64));
        }
    }
    pixels
}
pub fn to_ppm(pixels: &[Vec3]) -> String {
    // Gamma 2 on the way out, because a renderer works in linear light and a
    // screen does not.
    let channel = |x: f64| (x.max(0.0).sqrt().min(0.999) * 256.0) as u32;

    let mut out = String::new();
    writeln!(out, "P3").unwrap();
    writeln!(out, "{WIDTH} {HEIGHT}").unwrap();
    writeln!(out, "255").unwrap();
    for c in pixels {
        writeln!(out, "{} {} {}", channel(c.x), channel(c.y), channel(c.z)).unwrap();
    }
    out
}
pub fn run() -> String {
    let pixels = render();
    print!("{}", ascii(&pixels));

    let ppm = to_ppm(&pixels);
    for line in ppm.lines().take(6) {
        println!("{line}");
    }
    println!("... {} lines of PPM in total", ppm.lines().count());
    ppm
}
```

@hint `writeln!` expands into a call to a method named `write_fmt`. Ask which type that method is on.
@hint `String` does implement the trait that provides it. Read the error again: the method is not in scope rather than not implemented.
@hint `use std::fmt::Write;` at the top of the file.

@diagnose E0599
`cannot write into String`, then `items from traits can only be used if the
trait is in scope`.

`write!` and `writeln!` expand to `dest.write_fmt(format_args!(..))`, and
`write_fmt` arrives from a trait rather than from `String` itself. Two traits
in the standard library provide it. `std::fmt::Write` writes text and its
methods return `fmt::Result`. `std::io::Write` writes bytes to a file, a
socket or a pipe, and returns `io::Result`.

Neither is in the prelude, and that is deliberate: importing both into one
scope makes every `write!` ambiguous. So you name the one you mean.
`String` implements only the `fmt` one, since a `String` has to stay valid
UTF-8 and arbitrary bytes would break that.

@diagnose E0433
`failed to resolve: use of undeclared crate or module fmt`. A `use` path starts
at a crate root, so `use fmt::Write;` looks for a top-level crate called `fmt`.
The full path is `use std::fmt::Write;`. Inside the body of a function a bare
`fmt::Write` would work if `std::fmt` had been imported, which is the
distinction the error is drawing.

@after
Open the output. Redirect it to a file with a `.ppm` extension and most
viewers will show it, and `convert out.ppm out.png` turns it into something a
browser will take.

The gamma step is one `sqrt` and it matters more than any other single line in
`to_ppm`. The renderer averages light linearly, which is physically right, but
a display maps byte values to brightness by roughly the 2.2 power, so writing
linear values straight out makes everything too dark. Taking the square root
first is a cheap approximation of the sRGB transfer curve, and the real curve
is a piecewise thing with a linear toe near black.

That is the whole renderer. Around 250 lines: a vector type, a camera, two
shapes behind one trait, two materials behind another, a seeded generator and a
file format. What separates it from a production path tracer is not the ideas
in it. It is a bounding volume hierarchy so that shape count stops mattering,
sampling that aims rays at lights instead of guessing, and enough samples per
pixel that the noise goes away.
