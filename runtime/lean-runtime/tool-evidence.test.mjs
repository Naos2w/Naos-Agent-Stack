import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { describeToolResult, observeWriteTarget, describeFileEffect, summarizeToolEvidence } from './tool_evidence.mjs';
import { patchToolEvidenceWorker, patchEvidenceGuidance } from './tool-evidence-patch.mjs';

const ok = { content: [{ type: 'text', text: 'done' }] };
const error = { is_error: true, content: [{ type: 'text', text: 'ENOENT: private path and secret' }] };
const allow = async () => ({ behavior: 'allow' });
const changed = { state: 'changed', verification: 'sha256_before_after', beforeHash: 'a'.repeat(64), afterHash: 'b'.repeat(64) };
const call = (result, extra = {}) => ({ toolCallId: 'call-1', toolName: 'openchatx_write_file',
  input: { path: 'src/file.txt', content: 'private-content' }, idempotencyStatus: 'executed',
  replayed: false, toolResult: describeToolResult('openchatx_write_file', result), fileEffect: changed, ...extra });

test('tool failures, command exits and malformed replies remain distinct without raw output', () => {
  assert.equal(describeToolResult('openchatx_read_file', ok).status, 'succeeded');
  const result = describeToolResult('openchatx_read_file', error);
  assert.equal(result.status, 'failed'); assert.equal(result.errorCode, 'ENOENT');
  assert.doesNotMatch(JSON.stringify(result), /private|secret/);
  assert.equal(describeToolResult('openchatx_read_file', { is_error: true, content: [{ type: 'text', text: 'NOT_A_FILE: private' }] }).errorCode, 'NOT_A_FILE');
  assert.equal(describeToolResult('openchatx_shell', { content: [{ type: 'text', text: '{"exit_code":3,"stderr":"private"}' }] }).status, 'failed');
  assert.equal(describeToolResult('openchatx_shell', ok).status, 'unknown');
  for (const reply of [null, {}, { content: [] }, { content: [{ type: 'text' }] }, { ...ok, is_error: 'false' }])
    assert.equal(describeToolResult('openchatx_read_file', reply).status, 'unknown');
});

test('only successful observed byte changes count as changed files; partial failure stays visible', () => {
  const result = summarizeToolEvidence([
    call(ok), call(error, { input: { path: 'partial.txt' } }),
    call(ok, { input: { path: 'same.txt' }, fileEffect: { ...changed, afterHash: changed.beforeHash } }),
    call(ok, { input: { path: 'unknown.txt' }, fileEffect: null }),
    call(ok, { input: { path: 'replayed.txt' }, replayed: true, idempotencyStatus: 'replayed' }),
    call(ok, { input: { path: 'uncertain.txt' }, idempotencyStatus: 'uncertain' }),
    call(ok, { input: { path: 'legacy.txt' }, toolResult: undefined }),
  ]);
  assert.deepEqual(result.changedFiles, ['src/file.txt']);
  assert.equal(result.fileEffects.files[1].state, 'changed');
  assert.equal(result.fileEffects.files[1].toolStatus, 'failed');
  assert.equal(result.toolOutcomes.unknown, 1);
  assert.equal(result.toolOutcomes.reviewRequired, 3);
  assert.equal(result.fileEffects.shellEffects, 'not_checked');
  assert.doesNotMatch(JSON.stringify(result), /private-content|secret/);
});

test('later identical executed success reports recovery; changed input or replay never hides a failure', () => {
  assert.equal(summarizeToolEvidence([call(error), call(ok)]).toolOutcomes.recovered, 1);
  for (const later of [call(ok, { replayed: true }), call(ok, { idempotencyStatus: 'replayed' }),
    call(ok, { input: { path: 'different.txt' } }), call(ok, { idempotencyStatus: 'uncertain' })])
    assert.equal(summarizeToolEvidence([call(error), later]).toolOutcomes.recovered, 0);
  assert.equal(summarizeToolEvidence([call(error, { idempotencyStatus: 'uncertain' }), call(ok)]).toolOutcomes.recovered, 0);
});

test('bounded summaries keep full counts and cannot copy unrecognized error fields', () => {
  const r = summarizeToolEvidence(Array.from({ length: 40 }, (_, i) => call(error, {
    toolCallId: 'call-' + i, toolResult: { status: 'failed', errorCode: 'PRIVATE_SECRET', private: 'secret' } })));
  assert.equal(r.toolOutcomes.failed, 40); assert.equal(r.toolOutcomes.failures.length, 32);
  assert.equal(r.toolOutcomes.failuresTruncated, true); assert.equal(r.fileEffects.truncated, true);
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE_SECRET|private-content/);
});

test('provider compound call identifiers remain correlatable without accepting control characters', () => {
  const id = 'call_8de3ea923feb42ac8273540c089d060e|fc_0653f6372a0442cd016ae4ca9c8e7481918b949ec89002532a';
  const result = summarizeToolEvidence([call(error, { toolCallId: id }), call(error, { toolCallId: 'private\nline' })]);
  assert.equal(result.toolOutcomes.failures[0].toolCallId, id);
  assert.equal(result.fileEffects.files[0].toolCallId, id);
  assert.equal(result.toolOutcomes.failures[1].toolCallId, null);
});

test('real snapshots distinguish new, unchanged and changed UTF-8 files including append', async () => {
  const root = await mkdtemp(join(tmpdir(), 'naos-evidence-'));
  const project = { path: root, permissions: { read: true, write: true } }, input = { path: 'a.txt', content: 'hello' };
  try {
    const missing = await observeWriteTarget(project, input, allow);
    assert.equal(missing.state, 'absent');
    await writeFile(join(root, input.path), 'hello');
    const first = await observeWriteTarget(project, input, allow);
    assert.equal(describeFileEffect(missing, first).state, 'changed');
    assert.equal(describeFileEffect(first, await observeWriteTarget(project, input, allow)).state, 'unchanged');
    await writeFile(join(root, input.path), '世界', { flag: 'a' });
    assert.equal(describeFileEffect(first, await observeWriteTarget(project, input, allow)).state, 'changed');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('observation obeys existing permissions and bounds without preventing the authorized write itself', async () => {
  const root = await mkdtemp(join(tmpdir(), 'naos-evidence-'));
  try {
    const project = { path: root, permissions: { read: true, write: true } };
    assert.equal((await observeWriteTarget({ ...project, permissions: { write: true } }, { path: 'x' }, () => assert.fail())).reason, 'READ_PERMISSION_REQUIRED');
    assert.equal((await observeWriteTarget(project, { path: 'x' }, async () => ({ behavior: 'deny' }))).reason, 'WRITE_APPROVAL_DENIED');
    await mkdir(join(root, 'dir'));
    assert.equal((await observeWriteTarget(project, { path: 'dir' }, allow)).reason, 'FILE_NOT_REGULAR');
    await writeFile(join(root, 'large'), Buffer.alloc(1024 * 1024 + 1));
    assert.equal((await observeWriteTarget(project, { path: 'large' }, allow)).reason, 'FILE_TOO_LARGE');
    assert.equal((await observeWriteTarget(project, { path: 'large' }, async (_, name) => ({ behavior: name === 'openchatx_read_file' ? 'deny' : 'allow' }))).reason, 'READ_APPROVAL_DENIED');
  } finally { await rm(root, { recursive: true, force: true }); }
});

const source = await readFile(new URL('./source/letta_worker.ts', import.meta.url), 'utf8');
function extract(name, next) {
  return stripTypeScriptTypes(source.slice(source.indexOf('async function ' + name), source.indexOf('\nfunction ' + next)), { mode: 'transform' });
}

test('actual handler records failure and replay without executing a side effect twice', async () => {
  const records = [], sent = []; let handler, executions = 0, saved;
  const dependencies = { describeToolResult, observeWriteTarget: async () => ({ state: 'unavailable' }), describeFileEffect,
    decideProjectToolApproval: allow, isSideEffectingExternalTool: () => true,
    executeExternalTool: async () => { executions++; return error; },
    executeSideEffectOnce: async args => saved ? { result: saved, replayed: true, status: 'replayed' }
      : { result: (saved = await args.execute()), replayed: false, status: 'executed' } };
  const client = { onMessage: fn => { handler = fn; }, send: message => sent.push(message) };
  const register = new Function(...Object.keys(dependencies), extract('registerExternalToolHandler', 'runtimeStartCommand') + ';return registerExternalToolHandler;')(...Object.values(dependencies));
  await register(client, {}, 'agent', records);
  const request = { type: 'external_tool_call_request', request_id: 'call-1', tool_name: 'openchatx_write_file', input: { path: 'x' } };
  await handler(request); await handler(request);
  assert.equal(executions, 1); assert.equal(sent.length, 2);
  assert.equal(records[0].toolResult.status, 'failed'); assert.equal(records[1].replayed, true);
  assert.deepEqual(summarizeToolEvidence(records).changedFiles, []);
});

test('actual handler marks dispatch exceptions uncertain and never retries', async () => {
  const records = [], sent = []; let handler, attempts = 0;
  const deps = { describeToolResult, observeWriteTarget, describeFileEffect, decideProjectToolApproval: allow,
    isSideEffectingExternalTool: () => true, executeExternalTool: () => assert.fail(),
    executeSideEffectOnce: async () => { attempts++; throw Error('private ledger path'); } };
  const register = new Function(...Object.keys(deps), extract('registerExternalToolHandler', 'runtimeStartCommand') + ';return registerExternalToolHandler;')(...Object.values(deps));
  await register({ onMessage: fn => { handler = fn; }, send: m => sent.push(m) }, {}, 'agent', records);
  await handler({ type: 'external_tool_call_request', request_id: 'call-1', tool_name: 'openchatx_write_file', input: { path: 'x' } });
  assert.equal(attempts, 1); assert.equal(records[0].idempotencyStatus, 'uncertain');
  assert.equal(sent[0].result.is_error, true); assert.doesNotMatch(JSON.stringify(sent), /private/);
});

test('actual run summary propagates failures, verified changes and existing denial evidence', () => {
  const start = source.indexOf('function summarizeRunTrace('), end = source.indexOf('\ntype WorkerInput', start);
  const body = stripTypeScriptTypes(source.slice(start, end), { mode: 'transform' });
  const summarize = new Function('summarizeToolEvidence', 'PROJECT_EXECUTOR_API_VERSION', 'SHELL_POLICY_VERSION', body + ';return summarizeRunTrace;')(summarizeToolEvidence, 1, 2);
  const result = summarize({ external_tool_calls: [call(error)], approval_decisions: [{ toolName: 'openchatx_shell', decision: { behavior: 'deny', message: 'fixture denial' } }] });
  assert.equal(result.validation.tool_outcomes.failed, 1); assert.equal(result.blockers.length, 2);
  assert.deepEqual(result.changedFiles, []);
  const missing = summarize({approval_decisions:[{toolName:'openchatx_read_file',decision:{behavior:'deny',message:'ENOENT: fixture'}}]});
  assert.equal(missing.blockers.length,0);
  assert.equal(missing.validation.denied_requests[0].classification,'source_unavailable');
  for(const [toolName,message] of [['openchatx_read_file','PROJECT_PERMISSION_DENIED: read'],['openchatx_shell','ENOENT: executable'],['openchatx_write_file','ENOENT: parent']]){
    const denied=summarize({approval_decisions:[{toolName,decision:{behavior:'deny',message}}]});
    assert.equal(denied.blockers.length,1);assert.equal(denied.validation.denied_requests[0].classification,'denied');
  }
});

test('migration is idempotent and continuation guidance keeps existing task ownership', () => {
  assert.equal(patchToolEvidenceWorker(source), source);
  const policy = patchEvidenceGuidance('existing policy');
  assert.equal(patchEvidenceGuidance(policy), policy);
  assert.match(policy, /existing project TODO/); assert.match(policy, /Read-only work/);
});
