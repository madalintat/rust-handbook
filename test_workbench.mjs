import fs from 'fs';
const WB = eval(fs.readFileSync('assets/workbench.js','utf8') + '\nWB');
let pass=0, fail=0;
const ok = (name, cond, extra='') => { cond?pass++:fail++; console.log(`  ${cond?'PASS':'FAIL'}  ${name}${extra&&!cond?'  <-- '+extra:''}`); };

console.log('--- compile error is parsed with code, line, col ---');
const code = `fn takes(s: String) { println!("{s}"); }
fn main() {
    let s = String::from("hi");
    takes(s);
    println!("{s}");
}`;
let r = await WB.run(code); let d = WB.parse(r);
ok('one error', d.errors.length===1, JSON.stringify(d.errors.map(e=>e.msg)));
ok('code is E0382', d.errors[0]?.code==='E0382', d.errors[0]?.code);
ok('line 5 col 16', d.errors[0]?.line===5 && d.errors[0]?.col===16, `${d.errors[0]?.line}:${d.errors[0]?.col}`);

console.log('--- test harness verdicts come off stdout ---');
r = await WB.run(`pub fn add(a:i32,b:i32)->i32{ a - b }`, {tests:`#[cfg(test)] mod t { use super::*;
#[test] fn adds(){ assert_eq!(add(2,2),4); }
#[test] fn zero(){ assert_eq!(add(0,0),0); } }`});
d = WB.parse(r);
ok('two tests found', d.tests.length===2, String(d.tests.length));
ok('adds failed', d.tests.find(t=>t.name==='t::adds')?.ok===false);
ok('zero passed', d.tests.find(t=>t.name==='t::zero')?.ok===true);
ok('panic captured', /left: 0/.test(d.tests.find(t=>!t.ok)?.panic||''), JSON.stringify(d.tests.find(t=>!t.ok)?.panic));

console.log('--- all-green run ---');
r = await WB.run(`pub fn add(a:i32,b:i32)->i32{ a + b }`, {tests:`#[cfg(test)] mod t { use super::*;
#[test] fn adds(){ assert_eq!(add(2,2),4); } }`});
d = WB.parse(r);
ok('success true', r.success===true);
ok('no errors', d.errors.length===0);
ok('test passed', d.tests[0]?.ok===true);

console.log('--- cargo bookkeeping is not a diagnostic ---');
r = await WB.run(`fn main(){ let x = 5; }`); d = WB.parse(r);
ok('exactly 1 warning', d.warnings.length===1, JSON.stringify(d.warnings.map(w=>w.msg)));
ok('warning is the unused var', /unused variable/.test(d.warnings[0]?.msg||''));

console.log('--- error inside hidden tests is flagged ---');
r = await WB.run(`pub fn f()->i32{1}`, {tests:`#[test] fn t(){ nope(); }`});
d = WB.parse(r);
ok('flagged inTests', d.errors[0]?.inTests===true, `line ${d.errors[0]?.line} > userLines ${r.userLines}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
