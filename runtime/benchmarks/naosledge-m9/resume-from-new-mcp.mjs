// A fresh MCP transport session, not a new ChatGPT/model conversation.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const project = 'architecture-naosledge-m9-20261101';
const session = 'm9-new-mcp-' + randomUUID();
let id = 0;
async function rpc(method, params) {
  const response = await fetch('http://127.0.0.1:8001/mcp', {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-openai-session': session },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  assert.equal(response.status, 200);
  const raw = await response.text();
  const frames = response.headers.get('content-type')?.includes('text/event-stream')
    ? raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5))) : [JSON.parse(raw)];
  const message = frames.find(row => row.id === id);
  assert.ok(message); assert.equal(message.error, undefined);
  assert.notEqual(message.result?.isError, true, JSON.stringify(message.result));
  return message.result;
}
const call = (name, args) => rpc('tools/call', { name, arguments: args });
const parsed = result => result.content.flatMap(block => { try { return [JSON.parse(block.text)]; } catch { return []; } });
await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'm9-continuation-acceptance', version: '1' } });
const start = parsed(await call('start_here', { mode: 'coding', task_id: session, project_id: project }));
const context = start.find(row => row.openchatx_context)?.openchatx_context;
assert.equal(context.runtime.bootstrap, '2026-11-01.3');
assert.equal(context.continuation.project_id, project);
assert.ok(context.continuation.operations.some(row => row.id === 'op_204c9aa23c5b4707' && row.state === 'completed'));
const found = parsed(await call('tool_search', { query: 'agent_runtime', limit: 1 }));
const tool = found.flatMap(row => row.tools ?? []).find(row => row.name === 'agent_runtime__agent_runtime');
assert.ok(tool);
const runtime = args => call('tool_call', { tool: tool.id, arguments_json: JSON.stringify({ project_id: project, ...args }) });
const status = parsed(await runtime({ action: 'status', detail: 'compact' })).find(row => row.ok);
assert.equal(status.activeSession, 'm9-replay-20261101');
const accepted = parsed(await runtime({ action: 'run', session_name: 'm9-replay-20261101', engine: 'letta',
  model: 'gpt-6.1-sol', reasoning_effort: 'high', task_ref: 'TASK.md', timeout_ms: 480000,
  context_paths: ['TASK.md', 'PROGRESS.md', 'lib/obsidian-m9-signed-auto-cycle.ts', 'lib/obsidian-m9-windows-auto-agent.ts'],
  prompt: 'Continue the authorized offline repair recorded in TASK.md and PROGRESS.md. Implement the next approved step, run the stated affected tests, and update the same progress note with actual validation and remaining limitations. The owner explicitly authorized the existing Node executable for this isolated test; a hash-verified copy is now provided at .tools/node.exe and TASK.md has the updated in-project command. Keep this tool immutable. Respect AGENTS.md and the original file scope. Do not consult sibling/reference files or Git history. No production actions, external services, dependency changes or extra agents. UI work is not applicable. Finish when the task acceptance is met; distinguish isolated validation from production delivery.'
})).find(row => row.accepted);
assert.ok(accepted?.operationId);
const evidence = { checkedAt: new Date().toISOString(), mcpSession: session,
  bootstrap: context.runtime.bootstrap, recoveredTaskRef: context.continuation.operations.find(row => row.id === 'op_204c9aa23c5b4707').task_ref,
  previousOperation: 'op_204c9aa23c5b4707', sameNamedSession: status.activeSession,
  accepted, actualNewChatGPTConversation: false };
await writeFile(new URL('./.cache/run-20261101/handoff.json', import.meta.url), JSON.stringify(evidence, null, 2), { flag: 'wx' });
console.log(JSON.stringify(evidence));
