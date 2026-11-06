import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { inspectRuntimeReadiness, inspectRuntimeMaintenanceEligibility, inspectTerminalWorkerPid } from './runtime_readiness.mjs';
import { acquireRuntimeMaintenance, acquireRuntimeMutex } from './runtime_maintenance.mjs';
import { assertNoOperations } from '../core-maintenance/apply-audit-diagnostics.mjs';

async function fixture(work) {
  const root = await mkdtemp(join(tmpdir(), 'naos-maintenance-gate-'));
  try { await work(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}
const writeOps = (root, operations) =>
  writeFile(join(root, 'operations.json'), JSON.stringify(operations));

test('failed history still degrades dispatch but permits quiescent, guarded maintenance without alteration', () => fixture(async root => {
  const originals = {
    old: { state:'failed', pid:-1, reconciliation:{requiresReconciliation:true,reason:'EXTERNAL_TOOL_IN_FLIGHT'} },
    older: { state:'completed', pid:-1, reconciliation:{requiresReconciliation:false} },
  };
  await writeOps(root, originals);
  const before = await readFile(join(root, 'operations.json'), 'utf8');
  const dispatch = await inspectRuntimeReadiness(root);
  assert.equal(dispatch.ready, false);
  assert.equal(dispatch.reason, 'OPERATIONS_REQUIRE_RECONCILIATION');
  const maintenance = await inspectRuntimeMaintenanceEligibility(root);
  assert.deepEqual(maintenance, {schema:1,allowed:true,reason:'HISTORICAL_RECONCILIATION_PRESERVED',unresolved:1});
  await assertNoOperations(root);
  assert.equal(await readFile(join(root, 'operations.json'), 'utf8'), before);
}));

test('CLI distinguishes historical health degradation from live publication eligibility', () => fixture(async root => {
  const registry = {old: {state:'failed',pid:-1,
    reconciliation:{requiresReconciliation:true,reason:'EXTERNAL_TOOL_IN_FLIGHT'}}};
  await writeOps(root,registry);
  const path = fileURLToPath(new URL('./runtime_readiness.mjs',import.meta.url));
  const run = args => spawnSync(process.execPath,[path,root,...args],{
    encoding:'utf8',timeout:8000,maxBuffer:4096});
  const health = run([]);
  assert.equal(health.status,2);
  assert.equal(JSON.parse(health.stdout).reason,'OPERATIONS_REQUIRE_RECONCILIATION');
  const release = run(['--maintenance']);
  assert.equal(release.status,0,release.stderr);
  const output = JSON.parse(release.stdout);
  assert.equal(output.allowed,true);
  assert.equal(output.reason,'HISTORICAL_RECONCILIATION_PRESERVED');
  assert.equal(output.unresolved,1);
  assert.equal(output.inspectionOnly,true);
  assert.equal(output.recheckUnderMaintenanceLock,true);
  assert.ok(Number.isFinite(Date.parse(output.observedAt)));
  await writeOps(root,{...registry,running:{state:'running',pid:process.pid}});
  const busy = run(['--maintenance']);
  assert.equal(busy.status,2);
  assert.equal(JSON.parse(busy.stdout).allowed,false);
}));

test('reused Windows PID is accepted only with verified newer process generation', () => fixture(async root => {
  await writeOps(root, {old:{state:'failed',pid:123,updatedAt:'2026-11-01T00:00:00Z',
    reconciliation:{requiresReconciliation:true}}});
  assert.equal((await inspectRuntimeMaintenanceEligibility(root,{probePid:()=>false})).allowed,true);
  const recycled={probePid:()=>true,inspectProcess:async()=> '2026-11-02T00:00:00.1234567Z'};
  assert.equal((await inspectRuntimeMaintenanceEligibility(root,recycled)).allowed,true);
  await assertNoOperations(root,recycled);
  const originalWorker={probePid:()=>true,inspectProcess:async()=> '2026-10-31T23:59:59Z'};
  assert.equal((await inspectRuntimeMaintenanceEligibility(root,originalWorker)).reason,
    'RUNTIME_TERMINAL_WORKER_IDENTITY_UNVERIFIED');
  await assert.rejects(assertNoOperations(root,originalWorker),/IDENTITY_UNVERIFIED/);
  const unknown={probePid:()=>{throw Error('access denied')},inspectProcess:async()=>null};
  assert.equal((await inspectRuntimeMaintenanceEligibility(root,unknown)).reason,
    'RUNTIME_TERMINAL_WORKER_IDENTITY_UNVERIFIED');
  await assert.rejects(assertNoOperations(root,unknown),/IDENTITY_UNVERIFIED/);
}));

test('a PID that exits during OS lookup requires a second negative liveness probe', async () => {
  const record={state:'failed',pid:123,updatedAt:'2026-11-01T00:00:00Z'};
  let count=0;
  const exit=await inspectTerminalWorkerPid(record, {
    probePid:()=>++count===1,inspectProcess:async()=>null,
  });
  assert.deepEqual(exit,{safe:true,reason:'PID_EXITED_DURING_INSPECTION'});
  const absent=await inspectTerminalWorkerPid(record,{
    probePid:()=>true,inspectProcess:async()=> 'ABSENT_CONFIRMED',
  });
  assert.deepEqual(absent,{safe:true,reason:'OS_PID_ABSENCE_CONFIRMED'});
  const unknown=await inspectTerminalWorkerPid(record,{
    probePid:()=>true,inspectProcess:async()=> 'UNVERIFIED',
  });
  assert.equal(unknown.safe,false);
  assert.equal(unknown.reason,'RUNTIME_TERMINAL_WORKER_IDENTITY_UNVERIFIED');
});

test('running/stale processes, malformed state and unknown PID prevent maintenance', () => fixture(async root => {
  await writeOps(root, {op:{state:'running',pid:456}});
  assert.equal((await inspectRuntimeMaintenanceEligibility(root,{probePid:()=>true})).allowed,false);
  assert.equal((await inspectRuntimeMaintenanceEligibility(root,{probePid:()=>false})).reason,'STALE_OPERATIONS');
  await assert.rejects(assertNoOperations(root,{probePid:()=>false}),/ACTIVE_OR_UNVERIFIED/);
  await writeOps(root, {op:{state:'failed',pid:'123',reconciliation:{requiresReconciliation:true}}});
  assert.equal((await inspectRuntimeMaintenanceEligibility(root)).reason,'RUNTIME_WORKER_PID_UNVERIFIED');
  await assert.rejects(assertNoOperations(root),/AUDIT_UPDATE_RUNTIME_WORKER_PID_UNVERIFIED/);
  await writeFile(join(root,'operations.json'), '{invalid-json');
  assert.equal((await inspectRuntimeMaintenanceEligibility(root)).allowed,false);
  await assert.rejects(assertNoOperations(root),/AUDIT_UPDATE_OPERATIONS_UNVERIFIED/);
}));

test('admission, maintenance and pending-recovery locks block updates, even with no running Worker', () => fixture(async root => {
  await writeOps(root, {old:{state:'failed',reconciliation:{requiresReconciliation:true}}});
  const admission = await acquireRuntimeMutex(root);
  try {
    const readiness = await inspectRuntimeReadiness(root);
    assert.equal(readiness.ready,false);
    assert.equal((await inspectRuntimeMaintenanceEligibility(root)).allowed,false);
  } finally { await admission(); }
  const maintenance = await acquireRuntimeMaintenance(root);
  try { assert.equal((await inspectRuntimeMaintenanceEligibility(root)).allowed,false); }
  finally { await maintenance(); }
  await writeFile(join(root,'.runtime-update-pending.json'),'{}');
  assert.equal((await inspectRuntimeMaintenanceEligibility(root)).reason,'RUNTIME_UPDATE_RECOVERY_REQUIRED');
}));
test('empty known registry is eligible, missing registry is not eligible for an update', () => fixture(async root => {
  assert.equal((await inspectRuntimeReadiness(root)).ready,true);
  assert.equal((await inspectRuntimeMaintenanceEligibility(root)).allowed,false);
  await writeOps(root, {});
  assert.equal((await inspectRuntimeMaintenanceEligibility(root)).allowed,true);
}));
