// Opt-in MSI loopback acceptance. Creates only a synthetic handoff and then
// explicitly acknowledges it; it never reads existing summaries or credentials.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const session = 'msi-handoff-validation-' + randomUUID();
let id = 0;
async function rpc(method, params) {
  const response = await fetch('http://127.0.0.1:8001/mcp', {
    method: 'POST', signal: AbortSignal.timeout(20_000),
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-openai-session': session },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  assert.equal(response.status, 200, 'loopback HTTP status');
  const body = await response.text();
  const frames = response.headers.get('content-type')?.includes('text/event-stream')
    ? body.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)))
    : [JSON.parse(body)];
  const message = frames.find(frame => frame.id === id);
  assert.ok(message, 'correlated response');
  assert.equal(message.error, undefined, 'RPC error');
  assert.notEqual(message.result?.isError, true, 'tool error');
  return message.result;
}
const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'msi-handoff-acceptance', version: '1' } });
assert.match(init.instructions, /retrieval is repeatable and does not delete/);
assert.doesNotMatch(init.instructions, /retrieval consumes and deletes/);
const catalog = await rpc('tools/list', {});
const tool = catalog.tools.find(tool => tool.name === 'summarize');
assert.ok(tool);
assert.match(JSON.stringify(tool.inputSchema), /ack_uuid/);
assert.equal(tool.annotations.destructiveHint, true);
await rpc('tools/call', { name: 'start_here', arguments: { mode: 'general', task_id: session } });
await rpc('tools/call', { name: 'project_manage', arguments: { action: 'use', project_id: 'letta-poc' } });
const call = args => rpc('tools/call', { name: 'summarize', arguments: args });
const saved = await call({ summary: 'Synthetic MSI handoff acceptance. No private data.', recent_context: 'Verify repeatable retrieval and explicit acknowledgment only.' });
const uuid = saved.content[0].text;
assert.match(uuid, /^[0-9a-f-]{36}$/);
const first = await call({ uuid });
const second = await call({ uuid });
assert.deepEqual(first.content, second.content);
const { handoff } = JSON.parse(first.content[0].text);
const receipt = JSON.parse((await call({ ack_uuid: uuid, revision: handoff.revision })).content[0].text);
assert.equal(receipt.acknowledged, true);
const retry = JSON.parse((await call({ ack_uuid: uuid, revision: handoff.revision })).content[0].text);
assert.equal(retry.alreadyAcknowledged, true);
console.log(JSON.stringify({ verified: true, toolCount: catalog.tools.length, instructions: 'revision_acknowledgment', repeatedRead: true, acknowledgmentRetry: true }));
