import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Exercise the candidate modules without installed-file mutations, real tool
// audit files, credentials, or installed-service requests. The final fixture
// uses only a temporary loopback listener and synthetic echo/unknown tools.
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const utilities = dataModule(`export const asRecord = value =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;`);
const identity = dataModule(`export const getAgentIdentity = () => undefined;
  export const runWithAgent = (_session, callback) => callback();`);
const tokenizer = dataModule('export const countTokens = value => value.length;');
const output = dataModule(`export const modelFacingToolResultText = value =>
  value.content?.filter(item => item.type === 'text').map(item => item.text).join('\\n');`);
async function candidate(name, replacements = {}) {
  let source = await readFile(new URL(`./baseline/${name}`, import.meta.url), 'utf8');
  for (const [specifier, replacement] of Object.entries(replacements)) {
    assert.ok(source.includes(JSON.stringify(specifier)), `${name}: ${specifier}`);
    source = source.replaceAll(JSON.stringify(specifier), JSON.stringify(replacement));
  }
  return dataModule(source);
}
const formatUrl = await candidate('audit-format.js', {
  '../../utils.js': utilities, '../../mcp/tool-output.js': output,
});
const requestUrl = await candidate('audit-request.js', { '../../utils.js': utilities });
const responseUrl = await candidate('audit-response.js');
const logUrl = await candidate('audit-log.js', {
  '../../agent/context.js': identity, '../../tokenizer.js': tokenizer,
  './audit-format.js': formatUrl, './audit-request.js': requestUrl,
});
const { McpAuditLogger } = await import(logUrl);
const { createAuditRequest } = await import(requestUrl);
const { observeMcpResponse, recordRemoteAuthFailure,
  MAX_AUDIT_FRAME_BYTES, MAX_AUDIT_RESPONSE_BYTES } = await import(responseUrl);

function memoryLogger() {
  const entries = [];
  // Keep the real startRequest/startToolCall implementation and replace only
  // its storage boundary; the constructor's archive recovery is irrelevant.
  const logger = Object.assign(Object.create(McpAuditLogger.prototype), {
    now: () => new Date('2026-10-29T01:00:00Z'), clock: () => 1,
    append: entry => entries.push(entry),
  });
  return { logger, entries };
}
const call = (id = 'fixture-id', name = 'fixture_read', args = {}) => ({
  jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args },
});
function metadata(entry, key) {
  const line = entry.split('\n').find(value => value.startsWith(`${key}: `));
  return line ? JSON.parse(line.slice(key.length + 2)) : undefined;
}
function chunksOf(text, size) {
  const bytes = Buffer.from(text);
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += size) chunks.push(bytes.subarray(offset, offset + size));
  return chunks;
}
async function exchange(payload, chunks, contentType = 'application/json', status = 200) {
  const { logger, entries } = memoryLogger();
  const request = logger.startRequest(payload);
  const original = new Response(new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
  } }), { status, headers: { 'content-type': contentType, 'x-fixture': 'retained' } });
  const observed = observeMcpResponse(original, request);
  assert.equal(observed.status, status);
  assert.equal(observed.headers.get('x-fixture'), 'retained');
  const forwarded = Buffer.from(await observed.arrayBuffer());
  assert.ok(forwarded.equals(Buffer.concat(chunks)), 'Protocol observation must forward bytes unchanged.');
  request.finishTransport({ httpStatus: status, state: 'finished' });
  return entries;
}

test('HTTP 200 JSON-RPC errors retain codes and hashed IDs without private response bodies', async () => {
  const id = 'private-request-id-do-not-log';
  const text = JSON.stringify({ jsonrpc: '2.0', id, error: {
    code: -32602, message: 'private-response-token-do-not-log', data: { credential: 'private-data' },
  } });
  const [entry] = await exchange(call(id), chunksOf(text, 11));
  assert.deepEqual(metadata(entry, 'failure'), {
    observed_at: 'openchatx_mcp', kind: 'protocol', code: -32602, code_source: 'json_rpc',
  });
  assert.deepEqual(metadata(entry, 'observation'), { phase: 'mcp_protocol', outcome: 'error' });
  assert.match(entry, /# ! fixture_read/);
  const ref = createHash('sha256').update(JSON.stringify(id)).digest('hex').slice(0, 16);
  assert.ok(entry.includes(`request_ref: ${ref}`));
  assert.doesNotMatch(entry, /private-request|private-response|private-data|credential/);
});

test('batch responses match typed IDs and distinguish success, error, and unverified', async () => {
  const requests = [call(7, 'numeric'), call('7', 'string'), call('tool', 'tool'),
    call('missing', 'missing'), call(undefined, 'notification')];
  delete requests[4].id;
  const responses = [
    { jsonrpc: '2.0', id: '7', error: { code: -32601, message: 'private' } },
    { jsonrpc: '2.0', id: 7, result: { content: [] } },
    { jsonrpc: '2.0', id: 'tool', result: { isError: true, structuredContent: { error_code: 'LOCAL_FAILURE' } } },
    { jsonrpc: '2.0', id: 'unrelated', result: { content: [] } },
    { jsonrpc: '2.0', result: { content: [] } },
  ];
  const entries = await exchange(requests, chunksOf(JSON.stringify(responses), 37));
  assert.equal(entries.length, 5);
  assert.equal(metadata(entries[0], 'observation').outcome, 'success');
  assert.equal(metadata(entries[0], 'failure'), undefined);
  assert.equal(metadata(entries[1], 'failure').code, -32601);
  assert.deepEqual(metadata(entries[2], 'failure'), {
    observed_at: 'openchatx_mcp', kind: 'tool', code: 'LOCAL_FAILURE', code_source: 'structured_result',
  });
  for (const entry of entries.slice(3)) {
    assert.equal(metadata(entry, 'observation').outcome, 'unverified');
    assert.match(entry, /# \? /);
    assert.equal(metadata(entry, 'failure'), undefined);
  }
});

test('SSE split frames, multiline data, CRLF, and UTF-8 preserve envelope identity', async () => {
  const body = ': heartbeat\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0",\r\n' +
    'data: "id":"fixture-id","error":{"code":-32602,"message":"私人內容"}}\r\n\r\n';
  const [entry] = await exchange(call(), chunksOf(body, 1), 'text/event-stream; charset=utf-8');
  assert.equal(metadata(entry, 'failure').code, -32602);
  assert.doesNotMatch(entry, /私人內容/);
});

test('malformed or unrelated JSON envelopes remain unverified with unchanged bytes', async () => {
  for (const body of ['{broken', '{}', 'null', '[]',
    '{"jsonrpc":"1.0","id":"fixture-id","result":{}}',
    '{"jsonrpc":"2.0","id":"fixture-id","result":"invalid-result"}',
    '{"jsonrpc":"2.0","id":"other","error":{"code":-32602}}']) {
    const [entry] = await exchange(call(), chunksOf(body, 9));
    assert.equal(metadata(entry, 'observation').outcome, 'unverified');
    assert.match(entry, /# \? /);
  }
});

test('a valid SSE envelope can follow a malformed frame without recording frame text', async () => {
  const body = 'data: not-json\n\ndata: {"jsonrpc":"2.0","id":"fixture-id","result":{"content":[]}}\n\n';
  const [entry] = await exchange(call(), chunksOf(body, 17), 'text/event-stream');
  assert.equal(metadata(entry, 'observation').outcome, 'success');
  assert.doesNotMatch(entry, /not-json/);
});

test('oversized JSON chunks and accumulated JSON bodies remain unverified and pass through', async () => {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 'fixture-id', result: {
    content: [], padding: 'x'.repeat(MAX_AUDIT_FRAME_BYTES),
  } });
  for (const chunkSize of [body.length, 4096]) {
    const [entry] = await exchange(call(), chunksOf(body, chunkSize));
    assert.equal(metadata(entry, 'observation').outcome, 'unverified');
  }
});

test('an oversized SSE frame split across bounded chunks is never classified', async () => {
  const body = 'data: ' + JSON.stringify({ jsonrpc: '2.0', id: 'fixture-id', result: {
    content: [], padding: 'x'.repeat(MAX_AUDIT_FRAME_BYTES),
  } }) + '\n\n';
  const [entry] = await exchange(call(), chunksOf(body, MAX_AUDIT_FRAME_BYTES), 'text/event-stream');
  assert.equal(metadata(entry, 'observation').outcome, 'unverified');
});

test('total SSE observation is bounded even when every individual frame is small', async () => {
  const heartbeat = ': ' + 'x'.repeat(1020) + '\n\n';
  const prefix = heartbeat.repeat(Math.ceil(MAX_AUDIT_RESPONSE_BYTES / Buffer.byteLength(heartbeat)) + 1);
  const body = prefix + 'data: {"jsonrpc":"2.0","id":"fixture-id","result":{"content":[]}}\n\n';
  const [entry] = await exchange(call(), chunksOf(body, 4096), 'text/event-stream');
  assert.equal(metadata(entry, 'observation').outcome, 'unverified');
});

test('unsupported content, absent bodies, and completed requests are not wrapped', () => {
  const { logger } = memoryLogger();
  const request = logger.startRequest(call());
  const unsupported = new Response('unchanged', { headers: { 'content-type': 'text/plain' } });
  assert.equal(observeMcpResponse(unsupported, request), unsupported);
  const noBody = new Response(null, { status: 204 });
  assert.equal(observeMcpResponse(noBody, request), noBody);
  request.finishTransport({ httpStatus: 200, state: 'finished' });
  const completed = new Response('{}', { headers: { 'content-type': 'application/json' } });
  assert.equal(observeMcpResponse(completed, request), completed);
});

test('observer failures do not replace or truncate forwarded response bytes', async () => {
  const body = Buffer.from('{"jsonrpc":"2.0","id":1,"result":{}}');
  const response = new Response(body, { headers: { 'content-type': 'application/json' } });
  const observed = observeMcpResponse(response, {
    hasPending: () => true, observeProtocolMessage: () => { throw new Error('fixture observer failure'); },
  });
  assert.ok(Buffer.from(await observed.arrayBuffer()).equals(body));
});

test('claimed callbacks are not finished twice by transport or protocol observations', () => {
  const finishes = [];
  const request = createAuditRequest([call(1, 'claimed'), call(2, 'unclaimed')],
    name => ({ finish: result => finishes.push({ name, result }) }), () => {});
  assert.equal(request.claimTool(1, 'wrong'), undefined);
  const claimed = request.claimTool(1, 'claimed');
  assert.ok(claimed);
  assert.equal(request.claimTool(1, 'claimed'), undefined);
  claimed.finish({ toolResult: { content: [] } });
  request.observeProtocolMessage([
    { jsonrpc: '2.0', id: 1, error: { code: -32602 } },
    { jsonrpc: '2.0', id: 2, result: { content: [] } },
  ]);
  request.finishTransport({ httpStatus: 200, state: 'finished' });
  request.finishTransport({ httpStatus: 500, state: 'closed' });
  assert.equal(request.hasPending(), false);
  assert.deepEqual(finishes.map(value => value.name), ['claimed', 'unclaimed']);
  assert.equal(finishes[1].result.observation.outcome, 'success');
});

test('real audit logger also makes handler finish idempotent', () => {
  const { logger, entries } = memoryLogger();
  const request = logger.startRequest(call(1));
  const claimed = request.claimTool(1, 'fixture_read');
  claimed.finish({ toolResult: { content: [] } });
  claimed.finish({ error: Object.assign(new Error('should-not-record'), { code: 'UNEXPECTED' }) });
  request.finishTransport({ httpStatus: 500, state: 'closed' });
  assert.equal(entries.length, 1);
  assert.doesNotMatch(entries[0], /failure:|should-not-record|UNEXPECTED/);
});

test('unauthenticated batch audit drops arguments, sanitizes names, hashes IDs, and caps work', () => {
  const { logger, entries } = memoryLogger();
  const requests = Array.from({ length: 40 }, (_, index) => call(`private-id-${index}`,
    index === 0 ? 'bad\nsecret: injected' : 'fixture_read', {
      token: 'private-credential', authorization: 'Bearer private-token', command: 'private-command',
    }));
  recordRemoteAuthFailure(logger, requests, 403, -32002);
  assert.equal(entries.length, 32);
  assert.match(entries[0], /invalid_tool_name/);
  for (const entry of entries) {
    assert.deepEqual(metadata(entry, 'observation'), { phase: 'remote_auth', outcome: 'error' });
    assert.deepEqual(metadata(entry, 'failure'), {
      observed_at: 'openchatx_mcp', kind: 'authentication', code: -32002, code_source: 'json_rpc',
    });
    assert.match(entry, /HTTP 403 finished/);
    assert.match(entry, /args: \{\}/);
    assert.match(entry, /request_ref: [a-f0-9]{16}/);
    assert.doesNotMatch(entry, /private-|Bearer|authorization|injected|session:/);
  }
});

test('authentication 503 remains distinct and skips non-tool payload entries', () => {
  const { logger, entries } = memoryLogger();
  recordRemoteAuthFailure(logger, [null, {}, { method: 'tools/list' }, call(1)], 503, -32003);
  assert.equal(entries.length, 1);
  assert.equal(metadata(entries[0], 'failure').code, -32003);
  assert.match(entries[0], /HTTP 503 finished/);
});

test('authentication audit failure is isolated and warns without its private cause', t => {
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
  assert.doesNotThrow(() => recordRemoteAuthFailure({ startRequest() {
    throw new Error('private-credential-in-exception');
  } }, call(), 503, -32003));
  assert.equal(warnings.length, 1);
  assert.doesNotMatch(warnings.join('\n'), /private-credential/);
});

// The auth-gate fixture uses the actual SDK handler factory with in-process
// HTTP/Express/Node adapter doubles. No listener or network request is created.
const runtimeRoot = process.env.NAOS_OPENCHATX_RUNTIME_ROOT ||
  (process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'OpenChatX', 'runtime'));
const sdkPath = runtimeRoot && join(runtimeRoot, 'node_modules', '@modelcontextprotocol', 'server', 'dist', 'index.mjs');
let sdkAvailable = false;
if (sdkPath) {
  try { await access(sdkPath); sdkAvailable = true; }
  catch (error) {
    if (process.env.NAOS_OPENCHATX_RUNTIME_ROOT || error.code !== 'ENOENT') throw error;
  }
}
test('candidate HTTP auth gate audits 403/503 before dispatch with actual SDK factory', {
  skip: !sdkAvailable && 'Set NAOS_OPENCHATX_RUNTIME_ROOT to a runtime with its MCP SDK.',
  timeout: 10_000,
}, async () => {
  const adapterUrl = dataModule(`
    import { EventEmitter } from 'node:events';
    export let route;
    export let dispatchCount = 0;
    export function createMcpExpressApp() {
      return { get() {}, use() {}, all(_path, callback) { route = callback; } };
    }
    export function toNodeHandler() {
      return async () => { dispatchCount++; throw new Error('Auth rejection must precede dispatch.'); };
    }
    export function createServer() {
      const server = new EventEmitter();
      server.listening = false;
      server.listen = () => { server.listening = true; queueMicrotask(() => server.emit('listening')); };
      server.address = () => ({ port: 12345 });
      server.close = callback => { server.listening = false; callback(); };
      return server;
    }
    export class OpenChatXAuthError extends Error {
      constructor(code) { super('private-auth-error'); this.code = code; }
    }
  `);
  const httpUrl = await candidate('http-server.js', {
    'node:http': adapterUrl, '@modelcontextprotocol/express': adapterUrl,
    '@modelcontextprotocol/node': adapterUrl,
    '@modelcontextprotocol/server': pathToFileURL(sdkPath).href,
    '../agent/context.js': identity,
    '../agent/dashboard-routes.js': dataModule('export const createDashboardRouter = () => {};'),
    '../auth/store.js': adapterUrl,
    '../config.js': dataModule(`export const MCP_CONFIG = { host: '127.0.0.1', port: 0, instanceId: 'offline' };`),
    '../utils.js': utilities, './audit/audit-response.js': responseUrl,
  });
  const { startMcpHttpServer } = await import(httpUrl);
  const adapter = await import(adapterUrl);
  const { logger, entries } = memoryLogger();
  let mode = 'subject_mismatch', factoryCalls = 0;
  const running = await startMcpHttpServer({
    auditLogger: logger,
    authStore: { async authorizeToolCall() { throw new adapter.OpenChatXAuthError(mode); } },
    createMcpServer() { factoryCalls++; throw new Error('Server dispatch is forbidden.'); },
  });
  try {
    for (const [code, status] of [['subject_mismatch', 403], ['store_unavailable', 503]]) {
      mode = code;
      let observedStatus, responseBody;
      const request = {
        method: 'POST', body: call('private-auth-request-id', 'fixture_read', { token: 'private-auth-token' }),
        get: name => ({ 'x-openai-subject': 'private-auth-subject',
          'x-openai-session': 'private-auth-session' })[name],
      };
      const response = {
        status(value) { observedStatus = value; return this; },
        json(value) { responseBody = value; assert.equal(entries.length, status === 403 ? 1 : 2); },
      };
      await adapter.route(request, response);
      assert.equal(observedStatus, status);
      assert.equal(responseBody.error.code, status === 403 ? -32002 : -32003);
    }
    assert.equal(factoryCalls, 0);
    assert.equal(adapter.dispatchCount, 0);
    assert.equal(entries.length, 2);
    assert.doesNotMatch(entries.join('\n'), /private-auth-|token|subject|session:/);
    assert.ok(entries.every(entry => metadata(entry, 'observation').phase === 'remote_auth'));
  } finally {
    await running.close();
  }
});

test('actual SDK/Express/Node adapters preserve HTTP 200 errors, response data, and request-local audit', {
  skip: !sdkAvailable && 'Set NAOS_OPENCHATX_RUNTIME_ROOT to a runtime with its MCP SDK.',
  timeout: 15_000,
}, async () => {
  const packageUrl = name => pathToFileURL(join(runtimeRoot, 'node_modules',
    '@modelcontextprotocol', name, 'dist', 'index.mjs')).href;
  const httpUrl = await candidate('http-server.js', {
    '@modelcontextprotocol/express': packageUrl('express'),
    '@modelcontextprotocol/node': packageUrl('node'),
    '@modelcontextprotocol/server': packageUrl('server'),
    '../agent/context.js': identity,
    '../agent/dashboard-routes.js': dataModule('export const createDashboardRouter = () => {};'),
    '../auth/store.js': dataModule('export class OpenChatXAuthError extends Error {}'),
    '../config.js': dataModule(`export const MCP_CONFIG = { host: '127.0.0.1', port: 0, instanceId: 'synthetic-only' };`),
    '../utils.js': utilities, './audit/audit-response.js': responseUrl,
  });
  const [{ startMcpHttpServer }, { McpServer, fromJsonSchema }] = await Promise.all([
    import(httpUrl), import(packageUrl('server')),
  ]);
  const { logger, entries } = memoryLogger();
  const callbackIds = [];
  const claimedIds = [];
  const echoText = 'Synthetic echo 完整回應\n'.repeat(128);
  const running = await startMcpHttpServer({
    auditLogger: logger,
    createMcpServer({ auditRequest }) {
      const server = new McpServer({ name: 'synthetic-audit-fixture', version: '1.0.0' });
      server.registerTool('fixture_echo', {
        description: 'Synthetic echo only; no project or operating-system actions.',
        inputSchema: fromJsonSchema({ type: 'object', properties: {
          marker: { type: 'string' },
        }, required: ['marker'], additionalProperties: false }),
      }, async ({ marker }, context) => {
        callbackIds.push(context.mcpReq.id);
        const auditCall = auditRequest?.claimTool(context.mcpReq.id, 'fixture_echo');
        assert.ok(auditCall, 'The callback must receive the audit request from its own HTTP context.');
        claimedIds.push(context.mcpReq.id);
        // Overlap requests across an async boundary to exercise AsyncLocalStorage.
        await new Promise(resolve => setImmediate(resolve));
        const result = { content: [{ type: 'text', text: `${marker}:${echoText}` }] };
        auditCall.finish({ toolResult: result });
        return result;
      });
      return server;
    },
  }, { host: '127.0.0.1', port: 0 });
  assert.match(running.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  async function post(payload) {
    const response = await fetch(running.url, {
      method: 'POST', headers: {
        'content-type': 'application/json', accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-03-26',
      }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5_000),
    });
    const body = await response.text();
    const messages = response.headers.get('content-type')?.startsWith('text/event-stream')
      ? body.split(/\r?\n\r?\n/).map(frame => frame.split(/\r?\n/)
        .filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'))
        .filter(Boolean).map(text => JSON.parse(text))
      : [JSON.parse(body)];
    return { status: response.status, envelope: messages.find(message => message.id === payload.id) };
  }
  try {
    const requests = [call('synthetic-echo-a', 'fixture_echo', { marker: 'alpha' }),
      call('synthetic-unknown', 'fixture_unknown'),
      call('synthetic-echo-b', 'fixture_echo', { marker: 'beta' })];
    const results = await Promise.all(requests.map(post));
    for (const result of results) {
      assert.equal(result.status, 200);
      assert.ok(result.envelope, 'The actual adapter must deliver the matching response envelope.');
    }
    assert.equal(results[0].envelope.result.content[0].text, `alpha:${echoText}`);
    assert.equal(results[2].envelope.result.content[0].text, `beta:${echoText}`);
    assert.equal(results[1].envelope.error.code, -32602);
    assert.match(results[1].envelope.error.message, /fixture_unknown.*not found/);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(entries.length, 3, 'Each HTTP call must produce exactly one audit entry.');
    assert.deepEqual(callbackIds.sort(), ['synthetic-echo-a', 'synthetic-echo-b']);
    assert.deepEqual(claimedIds.sort(), ['synthetic-echo-a', 'synthetic-echo-b']);
    for (const request of requests) {
      const ref = createHash('sha256').update(JSON.stringify(request.id)).digest('hex').slice(0, 16);
      const matches = entries.filter(entry => entry.includes(`request_ref: ${ref}`));
      assert.equal(matches.length, 1, request.id);
      if (request.params.name === 'fixture_unknown') {
        assert.deepEqual(metadata(matches[0], 'observation'), { phase: 'mcp_protocol', outcome: 'error' });
        assert.deepEqual(metadata(matches[0], 'failure'), {
          observed_at: 'openchatx_mcp', kind: 'protocol', code: -32602, code_source: 'json_rpc',
        });
      } else {
        assert.equal(metadata(matches[0], 'failure'), undefined);
        assert.equal(metadata(matches[0], 'observation'), undefined,
          'The transport observer must not append another outcome for a claimed callback.');
      }
    }
  } finally {
    await running.close();
  }
});
