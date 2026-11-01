import test from 'node:test';
import assert from 'node:assert/strict';
import * as runtime from './runtime_contract.ts';
const {collectWorkContext:collect,normalizeAcceptanceChecks:normalize,evaluateAcceptance:evaluate}=runtime;
const ok={status:'succeeded',exitCode:0};
const shell=(command='node check',extra={})=>({toolName:'openchatx_shell',input:{command,cwd:'.'},toolResult:{...ok},idempotencyStatus:'executed',...extra});
const check=()=>normalize([{id:'unit',kind:'command',command:'node check'}]);

test('existing Runtime API remains compatible',()=>{
 assert.deepEqual(runtime.normalizeContextPaths(['src\\a.ts','src/a.ts']),['src/a.ts']);
 assert.equal(runtime.describeOperationOutcome({state:'completed'}).delivery.acceptanceVerified,false);
});
test('context: exact reads, deduplication and unchanged inputs',async()=>{
 const paths=Object.freeze(['TASK.md','./TASK.md','src\\a.ts']);const calls=[];
 const r=await collect({paths,read:async(p,n)=>{calls.push([p,n]);return {content:p,truncated:false};}});
 assert.equal(r.state,'observed');assert.equal(r.files.length,2);assert.equal(r.contentChars,15);
 assert.deepEqual(calls,[['TASK.md',3000],['src/a.ts',3000]]);
});
test('context: no permission means no reads',async()=>{
 const r=await collect({paths:['TASK.md'],readAllowed:false,read:()=>assert.fail('read denied')});
 assert.equal(r.state,'read_not_granted');assert.equal(r.contentChars,0);
});
test('context: reject traversal and absolute paths before any callback',async()=>{
 for(const paths of [['../secret'],['C:/secret'],['/secret'],['a\n.md']])await assert.rejects(collect({paths,read:()=>assert.fail('unsafe')}));
});
test('context: secret and metadata exclusions are case-insensitive',async()=>{
 const r=await collect({paths:['.env','.ENV.local','.git/config','x/KEY.PEM','x/private.key','x/CREDENTIALS.JSON','TASK.md'],read:async p=>{assert.equal(p,'TASK.md');return {content:'task',truncated:false};}});
 assert.equal(r.files.filter(f=>f.state==='excluded').length,6);assert.equal(r.state,'partial');
});
test('context: bounded file count and content even when reader ignores maxChars',async()=>{
 let count=0;const r=await collect({paths:Array.from({length:12},(_,i)=>`f${i}.md`),read:async()=>{count++;return {content:'x'.repeat(50000),truncated:false};}});
 assert.ok(count<=8);assert.ok(r.contentChars<=12000);assert.equal(r.state,'partial');
 assert.ok(r.omitted>0);assert.ok(r.files.filter(f=>f.state==='observed').every(f=>f.content.length<=3000&&f.truncated));
});
test('context: malformed and failed reads are unavailable with no error leakage or retries',async()=>{
 const calls=[];const r=await collect({paths:['a','b','c'],read:async p=>{calls.push(p);if(p==='a')throw Error('PRIVATE_ERROR');if(p==='b')return {content:42};return {content:'valid',truncated:false};}});
 assert.deepEqual(calls,['a','b','c']);assert.equal(r.state,'partial');
 assert.deepEqual(r.files.map(f=>f.state),['unavailable','unavailable','observed']);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_ERROR/);
});
test('context: upstream truncation and empty content remain truthful',async()=>{
 const r=await collect({paths:['empty','partial'],read:async p=>({content:p==='empty'?'':'small',truncated:p==='partial'})});
 assert.equal(r.state,'partial');assert.equal(r.files[0].state,'observed');assert.equal(r.files[1].truncated,true);
});
test('checks: optional, bounded, canonical declarations',()=>{
 assert.deepEqual(normalize(),[]);
 assert.deepEqual(normalize([{id:'unit',kind:'command',command:'  node check  ',cwd:'./src'},{id:'visual',kind:'manual'}]),[{id:'unit',kind:'command',command:'node check',cwd:'src'},{id:'visual',kind:'manual'}]);
});
test('checks: malformed plans fail closed',()=>{
 for(const x of [null,{},['a'],Array(9).fill({id:'x',kind:'manual'}),[{id:'X',kind:'manual'}],[{id:'x',kind:'manual',command:'x'}],[{id:'x',kind:'command',command:'a\nb'}],[{id:'x',kind:'command',command:'a',cwd:'../private'}],[{id:'x',kind:'command',command:'a',cwd:'C:/private'}],[{id:'x',kind:'manual'},{id:'x',kind:'manual'}],[{id:'x',kind:'command',command:'a',extra:true}],[{id:'x',kind:'command',command:'x'.repeat(2001)}]])assert.throws(()=>normalize(x),/ACCEPTANCE_CHECKS_INVALID/);
});
test('assessment: no plan is not accepted; matching success is scoped',()=>{
 assert.equal(evaluate([],[]).state,'not_configured');const r=evaluate(check(),[shell()]);
 assert.equal(r.state,'checks_passed');assert.equal(r.scope,'declared_checks_only');assert.equal(r.deliveryVerified,false);
 assert.deepEqual(r.checks,[{id:'unit',kind:'command',state:'passed'}]);assert.doesNotMatch(JSON.stringify(r),/node check/);
});
test('assessment: last matching result overrides old success',()=>{
 assert.equal(evaluate(check(),[shell(),shell('node check',{toolResult:{status:'failed',exitCode:2}})]).state,'failed');
 assert.equal(evaluate(check(),[shell('other')]).checks[0].state,'not_observed');
 assert.equal(evaluate(check(),[shell('node check',{input:{command:'node check',cwd:'other'}})]).state,'incomplete');
});
test('assessment: replays and malformed tool evidence are not fresh success',()=>{
 for(const extra of [{replayed:true},{idempotencyStatus:'replayed'},{toolResult:{}},{toolResult:{status:'unknown',exitCode:0}},{toolResult:{status:'succeeded',exitCode:null}}])assert.equal(evaluate(check(),[shell('node check',extra)]).checks[0].state,'unverified');
});
test('assessment: uncertain effects block even after successful tests',()=>{
 for(const status of ['uncertain','mismatch','missing_key']){
 const r=evaluate(check(),[{toolName:'openchatx_write_file',idempotencyStatus:status},shell()]);assert.equal(r.state,'blocked');assert.equal(r.deliveryVerified,false);
 }
});
test('assessment: later writes and arbitrary shell make earlier pass stale',()=>{
 for(const later of [{toolName:'openchatx_write_file',toolResult:{status:'succeeded'}},{toolName:'openchatx_write_file',toolResult:{status:'failed'}},shell('build')])assert.equal(evaluate(check(),[shell(),later]).checks[0].state,'stale');
 assert.equal(evaluate(check(),[{toolName:'openchatx_write_file'},shell()]).state,'checks_passed');
});
test('assessment: declared verification commands and reads do not invalidate each other',()=>{
 const plan=normalize([{id:'unit',kind:'command',command:'node check'},{id:'lint',kind:'command',command:'node lint'}]);
 assert.equal(evaluate(plan,[shell(),{toolName:'openchatx_read_file'},shell('node lint')]).state,'checks_passed');
});
test('assessment: manual remains manual and caller inputs are not mutated',()=>{
 const plan=normalize([{id:'unit',kind:'command',command:'node check'},{id:'visual',kind:'manual'}]);const calls=[shell()];
 const before=JSON.stringify({plan,calls});assert.equal(evaluate(plan,calls).state,'manual_required');assert.equal(JSON.stringify({plan,calls}),before);
});
