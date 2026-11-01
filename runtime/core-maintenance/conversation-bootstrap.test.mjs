import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { appendConversationContext, projectContinuation, readRuntimeIdentity, WORK_GUIDANCE } from './baseline/conversation-bootstrap.js';

test('entry guidance uses exact routing and qualified Skills with evidence-based completion', () => {
  assert.match(WORK_GUIDANCE, /project_id:<exact ID>/);
  assert.match(WORK_GUIDANCE, /name:agent-runtime\.agent-runtime-usage/);
  assert.match(WORK_GUIDANCE, /pre-existing changes/);
  assert.match(WORK_GUIDANCE, /each acceptance criterion/);
  assert.match(WORK_GUIDANCE, /uncertain side effects/);
});

async function fixture(work) {
  const root = await mkdtemp(join(tmpdir(), 'bootstrap-test-'));
  const toolbox = join(root, 'toolboxes/agent-runtime');
  await mkdir(join(toolbox, 'tools'), { recursive: true });
  try { await work(root, toolbox); }
  finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('bootstrap-test-'));
    await rm(root, { recursive: true, force: true });
  }
}
const context = result => JSON.parse(result.content.at(-1).text).openchatx_context;
const project = { id: 'a', permissions: { read: true } };

test('new conversation and existing conversation receive guidance once per actual version', () => fixture(async root => {
  const agent = { projectId: 'a', projectRouting: 'project' };
  let version = 'one';
  const opts = { name: 'file_read', input: {}, agent, stateDir: root,
    identityReader: async () => ({ bootstrap: version, worker_sha256: version }),
    readinessReader: async () => ({ ready: true, state: 'ready' }), projectScope: { current: async () => project } };
  const original = { content: [{ type: 'text', text: 'original file' }], structuredContent: { preserved: true } };
  const first = await appendConversationContext(original, opts);
  assert.deepEqual(first.content[0], original.content[0]);
  assert.equal(first.structuredContent, original.structuredContent);
  assert.equal(context(first).context_refresh, 'first_observed');
  assert.match(context(first).guidance, /one Developer/);
  const second = context(await appendConversationContext(original, opts));
  assert.equal(second.guidance, undefined);
  assert.equal(second.execution_receipt.model, null);
  version = 'two';
  assert.equal(context(await appendConversationContext(original, opts)).context_refresh, 'version_changed');
  opts.name = 'project_manage'; opts.input = { action: 'use' };
  assert.ok(context(await appendConversationContext(original, opts)).continuation);
}));

test('continuation filters other projects and does not reveal prompts, model config or authorization', () => fixture(async (_, root) => {
  await writeFile(join(root, 'operations.json'), JSON.stringify({
    a: { id: 'op-a', projectId: 'a', state: 'failed', prompt: 'SECRET', sessionName: 'main', taskRef: 'TODO.md', reconciliation: { requiresReconciliation: true } },
    b: { id: 'op-b', projectId: 'b', state: 'completed', prompt: 'OTHER_PROJECT' },
  }));
  await writeFile(join(root, 'state.json'), JSON.stringify({ projects: { a: { activeSession: 'main', sessions: { main: { name: 'main', engine: 'letta', token: 'SECRET' } } } } }));
  const goals = { open: async () => [{ id: 'a', projectId: 'a', title: 'Existing task' }, { id: 'b', projectId: 'b', title: 'PRIVATE' }] };
  const result = await projectContinuation(project, goals, root);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.operations.length, 1);
  assert.equal(result.operations[0].requires_reconciliation, true);
  assert.equal(result.sessions[0].active, true);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|OTHER_PROJECT|PRIVATE|op-b/);
  assert.deepEqual(await projectContinuation({ ...project, permissions: { read: false } }, goals, root), { status: 'read_not_granted' });
  assert.deepEqual(await projectContinuation(null, goals, root), { status: 'unscoped' });
}));

test('corrupt registries and unavailable readiness are unknown, not healthy or empty success', () => fixture(async (stateDir, root) => {
  await writeFile(join(root, 'operations.json'), '{broken');
  await writeFile(join(root, 'state.json'), '{}');
  const result = await projectContinuation(project, undefined, root);
  assert.equal(result.operation_status, 'unverified');
  assert.equal(result.session_status, 'unverified');
  const enriched = await appendConversationContext({ content: [] }, { name: 'start_here', input: {}, agent: {}, stateDir });
  assert.equal(context(enriched).readiness.ready, false);
  assert.equal(context(enriched).runtime.discovery, 'unverified');
}));

test('runtime control is observed without claiming a Worker ran; errors remain errors', () => fixture(async stateDir => {
  const result = await appendConversationContext({ isError: true, content: [{ type: 'text', text: 'DENIED' }] }, {
    name: 'tool_call', input: { tool: 'custom:agent-runtime:agent_runtime' }, agent: { projectId: 'a' }, stateDir,
  });
  assert.equal(result.isError, true);
  assert.equal(context(result).execution_receipt.path, 'runtime_control');
  assert.equal(context(result).execution_receipt.model, null);
  assert.equal(context(result).continuation, undefined);
}));

test('installed worker identity changes when its actual bytes change; disabled toolbox stays disabled', () => fixture(async (stateDir, root) => {
  await writeFile(join(root, 'toolbox.json'), JSON.stringify({ enabled: false, tools: { agent_runtime: { enabled: true } } }));
  await writeFile(join(root, 'tools/letta_worker.ts'), 'before');
  const before = await readRuntimeIdentity(stateDir);
  await writeFile(join(root, 'tools/letta_worker.ts'), 'after');
  const after = await readRuntimeIdentity(stateDir);
  assert.equal(before.discovery, 'disabled');
  assert.notEqual(before.worker_sha256, after.worker_sha256);
}));

test('oversize registries are bounded and left untouched', () => fixture(async (_, root) => {
  await writeFile(join(root, 'operations.json'), ' '.repeat(4 * 1024 * 1024 + 1));
  assert.equal((await projectContinuation(project, undefined, root)).operation_status, 'unverified');
}));

test('configured Toolbox root is independent of MCP state directory', () => fixture(async (stateDir, root) => {
  await writeFile(join(root, 'toolbox.json'), JSON.stringify({ enabled: true, tools: { agent_runtime: { enabled: true } } }));
  await writeFile(join(root, 'tools/letta_worker.ts'), 'worker');
  await mkdir(join(root, 'rules'));
  await writeFile(join(root, 'rules/shared-development-preflight.mdc'), '## Current runtime contract — 2026-10-28.3');
  let observed;
  const result = context(await appendConversationContext({ content: [] }, {
    name: 'start_here', input: {}, agent: {}, stateDir: join(stateDir, 'separate-state'), toolboxRoot: dirname(root),
    readinessReader: async actual => { observed = actual; return { ready: true, state: 'ready' }; },
  }));
  assert.equal(result.runtime.discovery, 'enabled');
  assert.equal(result.runtime.policy_version, '2026-10-28.3');
  assert.equal(observed, root);
}));
