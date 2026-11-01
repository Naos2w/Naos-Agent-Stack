import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise the complete candidate formatter, isolating its two unchanged
// presentation helpers so the tests do not require an installed MCP server.
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const helperModules = new Map([
  ['../../utils.js', dataModule(`export const asRecord = value =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;`)],
  ['../../mcp/tool-output.js', dataModule(`export const modelFacingToolResultText = value =>
    value.content?.filter(item => item.type === 'text').map(item => item.text).join('\\n');`)],
]);
let source = await readFile(process.env.NAOS_AUDIT_FORMAT_SOURCE ||
  new URL('./baseline/audit-format.js', import.meta.url), 'utf8');
for (const [specifier, replacement] of helperModules) {
  assert.equal(source.split(JSON.stringify(specifier)).length, 2, specifier);
  source = source.replace(JSON.stringify(specifier), JSON.stringify(replacement));
}
const { formatAuditEntry, summarizeToolResult } = await import(dataModule(source));

function render(summary, overrides = {}) {
  return formatAuditEntry({
    time: new Date('2026-10-28T10:46:00Z'), toolName: 'capability_list',
    argumentsValue: { action: 'health' }, durationMs: 1, inputTokens: 1,
    httpStatus: 200, state: 'finished', agentLabel: 'fixture-only',
    toolFailed: summary.failed, failureMessage: summary.failureMessage,
    responseSummary: summary, ...overrides,
  });
}
function failure(output) {
  const line = output.split('\n').find(value => value.startsWith('failure: '));
  assert.ok(line, output);
  return JSON.parse(line.slice('failure: '.length));
}

test('audit records only server execution version/path/hash and never guessed models or private context', () => {
  const original = { content: [{ type: 'text', text: 'PRIVATE_CONTENT' }] };
  const model = { ...original, _meta: { openchatxExecution: {
    version: '2026-11-01.3', path: 'runtime_control', worker_sha256: 'a'.repeat(64),
    model: 'GUESS', secret: 'PRIVATE_TOKEN', project_id: 'PRIVATE_PROJECT',
  } } };
  const output = render(summarizeToolResult(original, model));
  assert.match(output, /execution:.*runtime_control/);
  assert.match(output, /inspect_operation_result/);
  assert.doesNotMatch(output, /PRIVATE|GUESS/);
  assert.doesNotMatch(render(summarizeToolResult(original, original)), /execution:/);
});

test('thrown routing errors retain the explicit code without logging the private message', () => {
  const error = Object.assign(new Error('private-path-and-token-do-not-log'),
    { code: 'PROJECT_ROUTING_REQUIRED' });
  const summary = summarizeToolResult(undefined, undefined, error);
  const output = render(summary);
  assert.deepEqual(failure(output), {
    observed_at: 'openchatx_mcp', kind: 'tool',
    code: 'PROJECT_ROUTING_REQUIRED', code_source: 'exception',
  });
  assert.match(output, /# ! capability_list/);
  assert.doesNotMatch(output, /private-path-and-token/);
});

test('generic structured failures retain codes and existing arguments', () => {
  const result = { isError: true, structuredContent: {
    error_code: 'PROJECT_MANAGE_FAILED', output: 'private-server-response',
  }, content: [] };
  const summary = summarizeToolResult(result, result);
  const output = render(summary, {
    toolName: 'project_manage', argumentsValue: { action: 'use', project_id: 'fixture' },
  });
  assert.equal(failure(output).code, 'PROJECT_MANAGE_FAILED');
  assert.equal(failure(output).code_source, 'structured_result');
  assert.match(output, /args: \{"action":"use","project_id":"fixture"\}/);
  assert.doesNotMatch(output, /private-server-response/);
});

test('invalid machine codes cannot inject additional log fields', () => {
  for (const code of ['PROJECT_ERROR\nsecret: hidden', 'x'.repeat(300), {}, Infinity]) {
    const error = Object.assign(new Error('private-message'), { code });
    const output = render(summarizeToolResult(undefined, undefined, error));
    assert.equal(failure(output).code, null);
    assert.equal(failure(output).code_source, 'unavailable');
    assert.doesNotMatch(output, /secret|hidden|private-message/);
  }
});

test('text-only failures remain unclassified instead of inventing a platform cause', () => {
  const result = { isError: true, content: [
    { type: 'text', text: 'PROJECT_ROUTING_REQUIRED: a text prefix is not structured evidence' },
  ] };
  const output = render(summarizeToolResult(result, result));
  assert.equal(failure(output).code, null);
  assert.equal(failure(output).code_source, 'unavailable');
  assert.doesNotMatch(output, /PROJECT_ROUTING_REQUIRED|platform/);
});

test('transport failures are distinct and cannot claim a platform decision', () => {
  const summary = summarizeToolResult(undefined, undefined);
  const output = render(summary, { httpStatus: 503, state: 'aborted' });
  assert.deepEqual(failure(output), {
    observed_at: 'openchatx_mcp', kind: 'transport', code: null, code_source: 'unavailable',
  });
  assert.match(output, /HTTP 503 aborted/);
});

test('successful tools do not gain failure metadata', () => {
  const result = { structuredContent: { error_code: 'NOT_AN_ERROR' }, content: [] };
  const output = render(summarizeToolResult(result, result));
  assert.doesNotMatch(output, /failure:|# !|NOT_AN_ERROR/);
});

test('integer RPC codes and generic calls without argument objects are retained safely', () => {
  const error = Object.assign(new Error('private-message'), { code: -32602 });
  const summary = summarizeToolResult(undefined, undefined, error);
  for (const argumentsValue of [undefined, null, [], 'fixture']) {
    const output = render(summary, { argumentsValue });
    assert.equal(failure(output).code, -32602);
    assert.doesNotMatch(output, /private-message/);
  }
});
