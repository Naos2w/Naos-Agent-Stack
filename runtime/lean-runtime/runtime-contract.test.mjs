import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describeOperationOutcome, normalizeTaskRef, prepareWorkerRunContext } from './runtime_contract.ts';
import { apply, verify, targets, POLICY_VERSION } from './update-runtime.mjs';

test('successful operation never certifies delivery, tests or publication', () => {
  const result = describeOperationOutcome({ state: 'completed', taskRef: 'tasks/todo.md#D5' });
  assert.equal(result.execution.state, 'completed');
  assert.deepEqual(result.delivery, { state: 'not_evaluated', taskRef: 'tasks/todo.md#D5', acceptanceVerified: false });
  assert.equal(result.next_move.action, 'check_existing_task_acceptance');
  assert.equal(result.runtimePolicy.releaseAuthorized, false);
  assert.equal(result.next_move.automaticRetryAllowed, false);
  assert.equal(result.acceptance.state, 'not_evaluated');
  assert.ok(result.acceptance.evidenceRequired.includes('current_scoped_diff'));
  assert.equal(result.acceptance.conditionalEvidence.ui, 'rendered_desktop_mobile_and_interaction');
});
test('pending, blocked and uncertain work have distinct next actions', () => {
  assert.equal(describeOperationOutcome({ state: 'running' }).next_move.action, 'poll_existing_operation');
  assert.equal(describeOperationOutcome({ state: 'completed', blockers: ['write denied'] }).next_move.action, 'resolve_affected_operation');
  for (const state of ['failed', 'cancelled']) {
    assert.equal(describeOperationOutcome({ state }).next_move.action, 'reconcile_before_retry');
  }
  for (const status of ['uncertain', 'mismatch']) {
    const result = describeOperationOutcome({ state: 'completed', idempotency: [{ status }] });
    assert.equal(result.next_move.action, 'reconcile_before_retry');
    assert.equal(result.next_move.automaticRetryAllowed, false);
  }
});
test('stale poll cannot direct or retry a newer operation', () => {
  const result = describeOperationOutcome({ state: 'failed', stalePoll: true, taskRef: 'old-task' });
  assert.equal(result.next_move.action, 'inspect_current_operation');
  assert.equal(result.delivery.acceptanceVerified, false);
});

test('settled failed work asks for failure inspection without repeating reconciliation or granting retry', () => {
  const input = {state:'failed',reconciliation:{remoteState:'settled',requiresReconciliation:false}};
  const result=describeOperationOutcome(input);
  assert.equal(result.next_move.action,'inspect_failure_before_retry');
  assert.equal(result.next_move.automaticRetryAllowed,false);
  assert.equal(result.delivery.acceptanceVerified,false);
  assert.equal(describeOperationOutcome({...input,idempotency:[{status:'uncertain'}]}).next_move.action,'reconcile_before_retry');
  assert.equal(describeOperationOutcome({...input,reconciliation:{remoteState:'settled',requiresReconciliation:true}}).next_move.action,'reconcile_before_retry');
});
test('old callers and completed replays remain compatible without creating a task', () => {
  const result = describeOperationOutcome({ state: 'completed', idempotency: [{ status: 'replayed' }] });
  assert.equal(result.delivery.taskRef, null);
  assert.equal(result.next_move.action, 'check_existing_task_acceptance');
});
test('task reference is an opaque bounded identifier', () => {
  assert.equal(normalizeTaskRef(' tasks/todo.md#D5 '), 'tasks/todo.md#D5');
  assert.equal(normalizeTaskRef(undefined), null);
  for (const invalid of ['', '  ', 42, 'a\nb', 'x'.repeat(513)]) {
    assert.throws(() => normalizeTaskRef(invalid), /TASK_REFERENCE_INVALID/);
  }
});
test('write-enabled runs inspect context once without creating audit records', async () => {
  const project = Object.freeze({ id: 'test-project', permissions: Object.freeze({ read: true, write: true, shell: false }) });
  const calls = [];
  const result = await prepareWorkerRunContext(project, '  implement approved task  ', async (...args) => {
    calls.push(args);
    return { prompt: args[1], evidence: { project: 'checked' } };
  }, 'tasks/todo.md#current');
  assert.deepEqual(calls, [[project, 'implement approved task', []]]);
  assert.deepEqual(result.evidence, { project: 'checked' });
  assert.equal(result.id, undefined);
  assert.match(result.prompt, /Operation completion does not mean delivery acceptance/);
  assert.match(result.prompt, /use Ponytail Full by default/);
  assert.match(result.prompt, /smallest complete correct change/);
  assert.match(result.prompt, /Never skip security, data integrity, error handling/);
  assert.match(result.prompt, /Explicit user and stricter project instructions take precedence/);
  assert.match(result.prompt, /Ponytail is a development style, not an additional release approval/);
  assert.match(result.prompt, /tasks\/todo.md#current/);
  assert.equal(project.permissions.shell, false);
});
test('permission, task-size and applicable skill failures still propagate unchanged', async () => {
  for (const code of ['PROJECT_PERMISSION_DENIED', 'DEVELOPMENT_GATE_TASK_INVALID', 'DEVELOPMENT_GATE_UI_SKILLS_REQUIRED']) {
    const failure = new Error(code);
    await assert.rejects(prepareWorkerRunContext({}, 'task', async () => { throw failure; }), error => error === failure);
  }
});
test('invalid references fail before context inspection', async () => {
  let calls = 0;
  await assert.rejects(prepareWorkerRunContext({}, 'task', async () => { calls++; }, '\0'), /TASK_REFERENCE_INVALID/);
  assert.equal(calls, 0);
});

async function installationFixture() {
  const base = await mkdtemp(join(tmpdir(), 'naos-runtime-contract-'));
  const root = join(base, 'runtime'), stage = join(base, 'stage');
  const files = [];
  const hash = text => createHash('sha256').update(text).digest('hex');
  for (const path of targets) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await mkdir(join(stage, 'candidate', path, '..'), { recursive: true });
    await writeFile(join(root, path), 'old:' + path);
    await writeFile(join(stage, 'candidate', path), 'new:' + path);
    files.push({ path, before: hash('old:' + path), after: hash('new:' + path) });
  }
  await writeFile(join(stage, 'manifest.json'), JSON.stringify({ version: 2, policyVersion: POLICY_VERSION, requiresOfflineBootstrap: false, targetRoot: root, files }));
  await writeFile(join(root, 'operations.json'), '{}');
  await writeFile(join(root, 'state.json'), 'preserved-session-state');
  return { base, root, stage };
}
test('installer backs up exact preimages and preserves session/operation records', async () => {
  const f = await installationFixture();
  try {
    const result = await apply(f.root, f.stage);
    assert.equal(result.verified, targets.length);
    for (const path of targets) assert.equal(await readFile(join(result.backup, path), 'utf8'), 'old:' + path);
    assert.equal(await readFile(join(f.root, 'state.json'), 'utf8'), 'preserved-session-state');
    assert.equal(await readFile(join(f.root, 'operations.json'), 'utf8'), '{}');
    assert.equal((await verify(f.root, f.stage)).verified, targets.length);
  } finally { await rm(f.base, { recursive: true, force: true }); }
});
test('installer refuses concurrent source edits before replacing any file', async () => {
  const f = await installationFixture();
  try {
    await writeFile(join(f.root, targets[2]), 'someone-elses-change');
    await assert.rejects(apply(f.root, f.stage), /Source changed/);
    assert.equal(await readFile(join(f.root, targets[0]), 'utf8'), 'old:' + targets[0]);
    assert.equal(await readFile(join(f.root, targets[2]), 'utf8'), 'someone-elses-change');
  } finally { await rm(f.base, { recursive: true, force: true }); }
});
test('installer does not modify an active runtime or tampered candidate', async () => {
  const f = await installationFixture();
  try {
    await writeFile(join(f.root, 'operations.json'), JSON.stringify({ one: { state: 'running' } }));
    await assert.rejects(apply(f.root, f.stage), /running operations/);
    await writeFile(join(f.root, 'operations.json'), '{}');
    await writeFile(join(f.stage, 'candidate', targets[0]), 'tampered');
    await assert.rejects(apply(f.root, f.stage), /Candidate hash mismatch/);
    assert.equal(await readFile(join(f.root, targets[0]), 'utf8'), 'old:' + targets[0]);
  } finally { await rm(f.base, { recursive: true, force: true }); }
});
