import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { inspectRuntimeReadiness } from './runtime_readiness.mjs';
import { acquireRuntimeMutex, acquireRuntimeMaintenance } from './runtime_maintenance.mjs';
import { summarizeReconciliation, retainUnresolvedOperation } from './operation_reconciliation.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'naos-readiness-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
test('fresh and idle runtimes are ready; malformed or wrong-shape registries never are', () => fixture(async root => {
  assert.equal((await inspectRuntimeReadiness(root)).ready, true);
  for (const content of ['{', '', 'null', '[]', '42', '{"op":{"state":"mystery"}}']) {
    await writeFile(join(root, 'operations.json'), content);
    const snapshot = await inspectRuntimeReadiness(root);
    assert.equal(snapshot.ready, false, content);
    assert.match(snapshot.reason, /REGISTRY/);
    assert.equal(await readFile(join(root, 'operations.json'), 'utf8'), content);
  }
  await writeFile(join(root, 'operations.json'), '{}');
  assert.equal((await inspectRuntimeReadiness(root)).ready, true);
}));
test('normal admission is informational; maintenance and pending recovery block readiness', () => fixture(async root => {
  const release = await acquireRuntimeMutex(root);
  try { assert.equal((await inspectRuntimeReadiness(root)).ready, true); }
  finally { await release(); }
  const maintenance = await acquireRuntimeMaintenance(root);
  try { assert.equal((await inspectRuntimeReadiness(root)).state, 'maintenance'); }
  finally { await maintenance(); }
  await writeFile(join(root, '.runtime-update-pending.json'), '{corrupt journal');
  assert.equal((await inspectRuntimeReadiness(root)).state, 'recovery_required');
  assert.equal(await readFile(join(root, '.runtime-update-pending.json'), 'utf8'), '{corrupt journal');
}));
test('unreadable, unknown and abandoned owners fail closed without stealing the lock', () => fixture(async root => {
  const lock = join(root, '.runtime-maintenance.lock');
  await mkdir(lock);
  assert.equal((await inspectRuntimeReadiness(root)).ready, false);
  await writeFile(join(lock, 'owner.json'), JSON.stringify({pid:123,token:'fixture',purpose:'maintenance'}));
  assert.equal((await inspectRuntimeReadiness(root,{probePid:()=>false})).reason, 'RUNTIME_LOCK_OWNER_DEAD');
  assert.equal((await inspectRuntimeReadiness(root,{probePid:()=>{throw Error('denied');}})).state, 'unknown');
  await writeFile(join(lock, 'owner.json'), JSON.stringify({pid:123,token:'fixture'}));
  assert.equal((await inspectRuntimeReadiness(root,{probePid:()=>true})).reason, 'RUNTIME_LOCK_PURPOSE_UNVERIFIED');
}));
test('stale workers and unresolved operations are visible without contacting Letta', () => fixture(async root => {
  await writeFile(join(root, 'operations.json'), JSON.stringify({op:{state:'running',pid:123}}));
  assert.equal((await inspectRuntimeReadiness(root,{probePid:()=>false})).reason, 'STALE_OPERATIONS');
  await writeFile(join(root, 'operations.json'), JSON.stringify({op:{state:'failed',reconciliation:{requiresReconciliation:true}}}));
  assert.equal((await inspectRuntimeReadiness(root)).unresolved, 1);
}));

const failed = {id:'op_fixture',engine:'letta',state:'failed',sessionId:'local-conv-fixture'};
const timeout = {kind:'LETTA_TURN_TIMEOUT_DIAGNOSTIC',external_requests:1,external_completed:0};
const settled = {kind:'LETTA_TIMEOUT_RECOVERY',status:'cancelled',runId:'own-run'};
test('remote idle cannot erase an in-flight side effect or authorize a retry', () => {
  const result = {error:'LETTA_TURN_TIMEOUT_REMOTE_SETTLED'};
  const summary = summarizeReconciliation(failed,result,[timeout,settled].map(JSON.stringify).join('\n'));
  assert.equal(summary.requiresReconciliation, true);
  assert.equal(summary.reason, 'EXTERNAL_TOOL_IN_FLIGHT');
  assert.equal(summary.automaticRetryAllowed, false);
});
test('uncertain, missing and mismatched evidence survives ordinary retention', () => {
  assert.equal(retainUnresolvedOperation(failed,{error:'LETTA_TURN_TIMEOUT_REMOTE_UNCERTAIN'},''),true);
  assert.equal(retainUnresolvedOperation(failed,{},''),true);
  const completed = {...failed,state:'completed'};
  assert.equal(retainUnresolvedOperation(completed,{ok:true,validation:{idempotency:[{status:'mismatch'}]}},''),true);
  assert.equal(retainUnresolvedOperation(completed,{ok:true},''),false);
  assert.equal(retainUnresolvedOperation({...completed,reconciliation:{requiresReconciliation:true}},{ok:true},''),true);
});
test('settled timeout retains effect evidence and never claims rollback or automatic retry', () => {
  const trace = {...timeout,external_completed:1,idempotency:[{tool:'openchatx_shell',tool_call_id:'call_fixture',status:'executed'}]};
  const summary = summarizeReconciliation(failed,{error:'LETTA_TURN_TIMEOUT_REMOTE_SETTLED'},[trace,settled].map(JSON.stringify).join('\n'));
  assert.equal(summary.requiresReconciliation,false);
  assert.equal(summary.idempotency[0].toolCallId,'call_fixture');
  assert.equal(summary.automaticRetryAllowed,false);
  assert.match(summary.reason,/NOT_ROLLED_BACK/);
});

test('actual facade pruning retains already-polled uncertain operations beyond 200 entries', async () => {
  const source=await readFile(new URL('./source/agent_runtime.ts',import.meta.url),'utf8');
  const start=source.indexOf('async function pruneOperations()');
  const rest=source.slice(start+1);
  const next=/\n(?:async )?function /.exec(rest);
  assert.ok(start>=0 && next,'pruning function must be present in the shipped source');
  const body=stripTypeScriptTypes(source.slice(start,start+1+next.index),{mode:'transform'});
  const operations={};
  for(let i=0;i<200;i++) operations['new'+i]={id:'new'+i,createdAt:'2026-10-28',state:'completed'};
  for(const id of ['uncertain','completed','unpolled']) operations[id]={id,engine:'letta',state:id==='uncertain'?'failed':'completed',createdAt:'2026-01-01',stdoutPath:id+'.out',stderrPath:id+'.err',inputPath:id+'.input'};
  const removed=[];
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const run=new AsyncFunction('readOperations','collectUnpolledOperationIds','ensureState','MAX_RETAINED_OPERATIONS','isProcessRunning','readText','parseLettaWorkerOutput','retainUnresolvedOperation','archiveQaOperation','fs','saveOperations',body+'\nreturn pruneOperations();');
  await run(async()=>operations,()=>new Set(['unpolled']),async()=>({}),200,()=>false,
    async path=>path==='uncertain.out'?JSON.stringify({error:'LETTA_TURN_TIMEOUT_REMOTE_UNCERTAIN'}):path.endsWith('.out')?JSON.stringify({ok:true}):'',
    JSON.parse,retainUnresolvedOperation,async()=>{}, {rm:async path=>removed.push(path)},async()=>{});
  assert.ok(operations.uncertain);
  assert.ok(operations.unpolled);
  assert.equal(operations.completed,undefined);
  assert.deepEqual(removed.sort(),['completed.err','completed.input','completed.out']);
});
