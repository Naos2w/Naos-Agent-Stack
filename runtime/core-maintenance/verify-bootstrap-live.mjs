// Read-only MSI loopback protocol acceptance; independent synthetic conversation.
// Does not run a Worker, change project files, or replay an existing Operation.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const session = 'msi-bootstrap-validation-' + randomUUID();
let id = 0;
async function rpc(method, params) {
  const response = await fetch('http://127.0.0.1:8001/mcp', {
    method: 'POST', signal: AbortSignal.timeout(20_000),
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-openai-session': session },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  assert.equal(response.status, 200);
  const body = await response.text();
  const frames = response.headers.get('content-type')?.includes('text/event-stream')
    ? body.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5))) : [JSON.parse(body)];
  const message = frames.find(frame => frame.id === id);
  assert.ok(message); assert.equal(message.error, undefined);
  assert.notEqual(message.result?.isError, true, JSON.stringify(message.result));
  return message.result;
}
const call = (name, args) => rpc('tools/call', { name, arguments: args });
function contexts(result) {
  return result.content.flatMap(block => {
    try { const value = JSON.parse(block.text); return value.openchatx_context ? [value.openchatx_context] : []; }
    catch { return []; }
  });
}
const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'msi-bootstrap-acceptance', version: '1' } });
assert.match(init.instructions, /openchatx_context/);
const start = contexts(await call('start_here', { mode: 'general', task_id: session }));
assert.equal(start.at(-1).runtime.bootstrap, '2026-11-01.3');
assert.equal(start.at(-1).runtime.policy_version, '2026-10-28.3');
assert.equal(start.at(-1).runtime.discovery, 'enabled');
assert.equal(start.at(-1).readiness.ready, true);
const selected = contexts(await call('project_manage', { action: 'use', project_id: 'letta-poc' })).at(-1);
assert.equal(selected.continuation.project_id, 'letta-poc');
assert.ok(selected.continuation.operations.length > 0);
assert.ok(selected.continuation.operations.every(row => row.id && !('prompt' in row)));
const search = await call('tool_search', { query: 'agent_runtime', limit: 3 });
assert.match(JSON.stringify(search), /agent_runtime/);
const listed = contexts(await call('goal_list', {})).at(-1);
assert.equal(listed.execution_receipt.path, 'direct_mcp');
assert.equal(listed.guidance, undefined);
assert.equal(listed.execution_receipt.model, null);
const clear = contexts(await call('project_manage', { action: 'use', project_id: null })).at(-1);
assert.equal(clear.continuation.status, 'unscoped');
assert.equal(clear.continuation.operations, undefined);
console.log(JSON.stringify({ verified: true, bootstrap: start.at(-1).runtime.bootstrap,
  initialization: true, projectContinuation: true, lazyRuntimeDiscovery: true,
  directReceipt: true, clearedProjectIsolation: true, modelRun: false }));
