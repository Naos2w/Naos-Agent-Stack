// Explicit integration probe: existing Agent/conversation, one local fixture
// append, real Letta/model, and one dropped loopback controller connection.
import assert from 'node:assert/strict';
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { workerHarness } from '../../lean-runtime/test-fixtures/turn-reconnect-harness.mjs';
import { executeSideEffectOnce } from '../../lean-runtime/source/external_tool_idempotency.ts';

const [lettaRoot, agentId, conversationId, outputRoot, phase = 'approval'] = process.argv.slice(2);
assert.ok(['approval', 'inflight'].includes(phase));
if (!outputRoot || !agentId || !conversationId) throw Error('Usage: node probe-live.mjs <Letta-POC-root> <agent-id> <existing-conversation-id> <new-output-directory>');
await mkdir(outputRoot); // Never overwrite an earlier probe.
const {WebSocket, WebSocketServer} = await import(pathToFileURL(join(lettaRoot, 'node_modules/ws/wrapper.mjs')).href);
const upstreamUrl = 'ws://127.0.0.1:4500/ws';
const logs = [], commands = [], approvals = [], calls = [], connections = new Set();
let dropped = false, executionCount = 0, connectionCount = 0;
let controlPair;
const {LettaSocket} = workerHarness();
const inspector = new LettaSocket(upstreamUrl);
await inspector.connect();
let loop, queue;
inspector.onMessage(m => {
  if (m.runtime?.agent_id !== agentId || m.runtime?.conversation_id !== conversationId) return;
  if (m.type === 'update_loop_status') loop = m.loop_status;
  if (m.type === 'update_queue') queue = m.queue;
});
const sync = await inspector.request({type: 'sync', runtime: {agent_id: agentId, conversation_id: conversationId}, recover_approvals: false, resume_interrupted_turn: false}, 'sync_response');
assert.equal(sync.success, true);
assert.equal(loop?.status, 'WAITING_ON_INPUT');
assert.equal(queue?.length, 0);
assert.equal(loop?.active_run_ids?.length ?? loop?.activeRunIds?.length ?? 0, 0);
const conversation = await inspector.request({type: 'conversation_retrieve', conversation_id: conversationId}, 'conversation_retrieve_response');
assert.equal(conversation.success, true);
assert.equal(conversation.conversation.agent_id, agentId);
inspector.close();

const proxy = new WebSocketServer({host: '127.0.0.1', port: 0});
await once(proxy, 'listening');
proxy.on('connection', downstream => {
  connectionCount++;
  const upstream = new WebSocket(upstreamUrl), pending = [];
  connections.add(downstream); connections.add(upstream);
  upstream.on('open', () => {for (const data of pending) upstream.send(data);});
  downstream.on('message', data => {
    const m = JSON.parse(data.toString());
    if (m.type === 'runtime_start' && m.external_tools?.length === 0) controlPair = [downstream, upstream];
    commands.push({type: m.type, kind: m.payload?.kind, clientMessageId: m.payload?.messages?.[0]?.client_message_id,
      recoverApprovals: m.recover_approvals, conversationId: m.conversation_id});
    if (phase === 'approval' && m.type === 'input' && m.payload?.kind === 'approval_response' && !dropped) {
      dropped = true; downstream.terminate(); upstream.terminate(); return;
    }
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data); else pending.push(data);
  });
  upstream.on('message', data => {
    const m = JSON.parse(data.toString());
    if (m.type === 'control_request') approvals.push(m.request_id);
    if (m.type === 'external_tool_call_request') calls.push(m.tool_call_id);
    if (downstream.readyState === WebSocket.OPEN) downstream.send(data);
  });
  upstream.on('error', () => downstream.close()); downstream.on('error', () => upstream.close());
  downstream.on('close', () => {upstream.close(); connections.delete(downstream);});
  upstream.on('close', () => {downstream.close(); connections.delete(upstream);});
});
const marker = 'letta-reconnect-one-effect\n';
const worker = workerHarness({SERVER_URL: `ws://127.0.0.1:${proxy.address().port}`,
  process: {stderr: {write: text => {logs.push(text); process.stderr.write(text);}}},
  decideExternalToolApproval: async (_project, name, input) => {
    assert.equal(name, 'openchatx_shell'); assert.deepEqual(input, {});
    return {behavior: 'allow', updated_input: null, selected_permission_suggestion_ids: []};
  },
  executeSideEffectOnce: args => executeSideEffectOnce({...args, ledgerDir: join(outputRoot, 'ledger')}),
  executeExternalTool: async (_client, _project, _agent, name, input) => {
    assert.equal(name, 'openchatx_shell'); assert.deepEqual(input, {});
    executionCount++; await appendFile(join(outputRoot, 'effect.txt'), marker);
    if (phase === 'inflight' && !dropped) {
      assert.ok(controlPair); dropped = true; for (const socket of controlPair) socket.terminate();
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return {content: [{type: 'text', text: '{"exit_code":0,"stdout":"RECONNECT_FIXTURE_OK"}'}]};
  }});
const clientMessageId = 'openchatx-reconnect-probe-' + Date.now();
const started = Date.now();
try {
  const result = await worker.runTurn({id: 'letta-poc', path: resolve(lettaRoot)}, {agentId}, {conversationId},
    'Controlled transport recovery test. Call the provided openchatx_shell fixture exactly once with the empty JSON object {}. This registered tool only appends a fixed local test marker; it is not a general shell. Then reply RECONNECT_FIXTURE_OK. Do not call other tools or repeat this tool.',
    180000, clientMessageId);
  assert.equal(result.status, 'completed'); assert.equal(dropped, true); assert.equal(executionCount, 1);
  assert.equal(await readFile(join(outputRoot, 'effect.txt'), 'utf8'), marker);
  assert.equal(commands.filter(m => m.kind === 'create_message').length, 1);
  assert.equal(new Set(approvals).size, 1); assert.ok(approvals.length >= 2);
  assert.equal(calls.length, 1);
  const evidence = {schema: 1, timestamp: new Date().toISOString(), status: 'passed', agentId, conversationId,
    clientMessageId, runId: result.run_id, phase, connectionCount, droppedConnections: 1, executionCount,
    createMessageCount: 1, originalApprovalReplayed: phase === 'approval', toolCallIds: calls,
    elapsedMs: Date.now() - started, modelConfigurationBefore: conversation.conversation.model ?? conversation.conversation.model_settings ?? null,
    workerSourceSha256: createHash('sha256').update(await readFile(new URL('../../lean-runtime/source/letta_worker.ts', import.meta.url))).digest('hex'),
    scope: 'Real installed Letta/model and WebSocket loss; source Worker transport/approval/turn code, fixed local fixture tool and existing conversation. No provider or live installation patch.'};
  await writeFile(join(outputRoot, 'result.json'), JSON.stringify(evidence, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify(evidence));
} catch (error) {
  await writeFile(join(outputRoot, 'failure.json'), JSON.stringify({error: error.message, agentId, conversationId, clientMessageId,
    executionCount, dropped, connectionCount, commands, approvalIds: approvals, toolCallIds: calls}, null, 2) + '\n');
  throw error;
} finally {
  await writeFile(join(outputRoot, 'trace.jsonl'), logs.join(''));
  for (const socket of connections) socket.terminate();
  await new Promise(resolve => proxy.close(resolve));
}
