import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, appendFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workerHarness } from './test-fixtures/turn-reconnect-harness.mjs';
import { executeSideEffectOnce } from './source/external_tool_idempotency.ts';
import { summarizeReconciliation } from './operation_reconciliation.mjs';

const runtime = {agent_id: 'agent-fixture', conversation_id: 'conversation-fixture'};
function server(mode) {
  const commands = [], sockets = [], approvalIds = [];
  let rebinds = 0, primaryStarts = 0;
  class Socket extends EventTarget {
    readyState = 0;
    constructor() { super(); sockets.push(this); queueMicrotask(() => {this.readyState = 1; this.dispatchEvent(new Event('open'));}); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new Event('close')); }
    emit(message) { if (this.readyState === 1) this.dispatchEvent(new MessageEvent('message', {data: JSON.stringify(message)})); }
    approval() { this.emit({type: 'control_request', runtime, request_id: 'approval-original', request: {subtype: 'can_use_tool', tool_name: 'openchatx_shell', input: {}}}); }
    send(text) {
      const m = JSON.parse(text); commands.push(m);
      const reply = body => queueMicrotask(() => this.emit({...body, request_id: m.request_id}));
      if (m.type === 'runtime_start') {
        const toolConnection = m.external_tools?.length > 0;
        if (!toolConnection) primaryStarts++;
        const recovery = !toolConnection && primaryStarts > 1;
        if (recovery && mode === 'exhausted') {queueMicrotask(() => this.close()); return;}
        reply({type: 'runtime_start_response', success: true,
          runtime: recovery && mode === 'wrong-scope' ? {...runtime, conversation_id: 'other'} : runtime});
        if (recovery && !['wrong-scope', 'server-restarted', 'inflight'].includes(mode)) queueMicrotask(() => this.approval());
      } else if (m.type === 'input' && m.payload.kind === 'create_message') {
        if (mode === 'lost-input-ack') {queueMicrotask(() => this.close()); return;}
        reply({type: 'input_accepted', accepted: true});
        setTimeout(() => this.approval(), 5);
      } else if (m.type === 'runtime_external_tools_update') {
        rebinds++;
        reply({type: 'runtime_external_tools_update_response', success: true});
      } else if (m.type === 'input' && m.payload.kind === 'approval_response') {
        if (sockets.length === 2 && !['inflight', 'tool-connection-lost', 'finish-during-disconnect'].includes(mode)) {queueMicrotask(() => this.close()); return;}
        approvalIds.push(m.payload.request_id);
        queueMicrotask(() => sockets[1].emit({type: 'external_tool_call_request', runtime,
          request_id: 'external-original', tool_call_id: 'tool-original', tool_name: 'openchatx_shell', input: {}}));
      } else if (m.type === 'external_tool_call_response') {
        if (mode === 'finish-during-disconnect') sockets[0].close();
        queueMicrotask(() => {for (const socket of sockets) socket.emit({type: 'turn_finished', runtime, run_id: 'run-original', stop_reason: 'end_turn'});});
      } else if (m.type === 'conversation_messages_list') reply({type: 'conversation_messages_list_response', success: true,
        messages: [{message_type: 'assistant_message', content: 'fixture complete'}]});
    }
  }
  return {Socket, commands, sockets, approvalIds};
}

async function fixture(mode, verify) {
  const root = await mkdtemp(join(tmpdir(), 'naos-turn-reconnect-'));
  const remote = server(mode), logs = [];
  let executions = 0, release;
  const toolBarrier = new Promise(resolve => { release = resolve; });
  const worker = workerHarness({globalThis: {WebSocket: remote.Socket}, process: {stderr: {write: text => logs.push(text)}},
    executeSideEffectOnce: args => executeSideEffectOnce({...args, ledgerDir: join(root, 'ledger')}),
    executeExternalTool: async () => {
      executions++; await appendFile(join(root, 'effect.txt'), 'one effect\n');
      if (mode === 'inflight') {remote.sockets[0].close(); setTimeout(release, 10); await toolBarrier;}
      if (mode === 'tool-connection-lost') {remote.sockets[1].close(); await toolBarrier;}
      return {content: [{type: 'text', text: 'fixture complete'}]};
    }});
  try {
    const result = await worker.runTurn({id: 'fixture'}, {agentId: runtime.agent_id},
      {conversationId: runtime.conversation_id}, 'fixed fixture prompt', 1500, 'message-original')
      .then(value => ({value}), error => ({error}));
    await verify({result, remote, logs, executions, root});
  } finally {release(); await new Promise(resolve => setTimeout(resolve, 20)); await rm(root, {recursive: true, force: true, maxRetries: 12, retryDelay: 50});}
}

test('an interrupted live approval reattaches the original conversation and executes exactly once', () => fixture('recover', async ({result, remote, executions, root}) => {
  assert.ifError(result.error); assert.equal(result.value.status, 'completed');
  assert.equal(executions, 1); assert.equal(await readFile(join(root, 'effect.txt'), 'utf8'), 'one effect\n');
  assert.equal(remote.commands.filter(m => m.payload?.kind === 'create_message').length, 1);
  assert.deepEqual(remote.approvalIds, ['approval-original']);
  const starts = remote.commands.filter(m => m.type === 'runtime_start' && m.external_tools.length === 0);
  assert.equal(starts.length, 2); assert.equal(starts[1].recover_approvals, false);
  assert.equal(starts[1].resume_interrupted_turn, false);
  assert.equal(starts[1].conversation_id, runtime.conversation_id);
}));

test('control interruption during a side effect keeps the same live tool owner and executes once', () => fixture('inflight', async ({result, executions, root}) => {
  assert.ifError(result.error); assert.equal(executions, 1);
  assert.equal(await readFile(join(root, 'effect.txt'), 'utf8'), 'one effect\n');
}));

test('terminal delivery during control reconnection is observed through the tool channel', () => fixture('finish-during-disconnect', async ({result, executions, remote}) => {
  assert.ifError(result.error); assert.equal(executions, 1);
  assert.equal(remote.commands.filter(m => m.payload?.kind === 'create_message').length, 1);
  assert.ok(remote.sockets.every(s => s.readyState === 3));
}));

for (const mode of ['exhausted', 'wrong-scope', 'lost-input-ack', 'server-restarted', 'tool-connection-lost']) {
  test(`${mode} preserves uncertainty and never resends the input`, () => fixture(mode, async ({result, remote, logs, executions}) => {
    assert.ok(result.error); assert.equal(remote.commands.filter(m => m.payload?.kind === 'create_message').length, 1);
    assert.equal(executions, mode === 'tool-connection-lost' ? 1 : 0);
    assert.ok(remote.sockets.length <= 4);
    if (mode === 'tool-connection-lost') {
      assert.equal(remote.sockets.length, 2);
      const summary = summarizeReconciliation({id: 'op_fixture', projectId: 'fixture', sessionId: runtime.conversation_id, state: 'failed'}, {error: result.error.message}, logs.join(''));
      assert.equal(summary.requiresReconciliation, true); assert.equal(summary.externalRequests, 1); assert.equal(summary.externalCompleted, 0);
    }
  }));
}

test('reconnected socket ignores late frames from its old connection and foreign tool scopes', async () => {
  const remote = server('recover'), messages = [];
  const {LettaSocket} = workerHarness({globalThis: {WebSocket: remote.Socket}});
  const client = new LettaSocket('ws://fixture');
  await client.connect(); client.setToolScope(runtime); client.onMessage(m => messages.push(m));
  const old = remote.sockets[0]; await client.reconnect(100);
  old.dispatchEvent(new MessageEvent('message', {data: JSON.stringify({type: 'turn_finished', runtime})}));
  remote.sockets[1].emit({type: 'external_tool_call_request', runtime: {...runtime, agent_id: 'other'}});
  assert.equal(messages.length, 0); client.close();
});
