// Read installed modules, exercise them in a separate process/session, and write
// only a temporary fixture log. This never calls the MCP service or selects a
// real Project. The candidate formatter is injected into a private logger.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

assert.equal(process.argv.length, 3, 'Usage: node verify-routing-diagnostics.mjs <installed-runtime-root>');
const runtime = resolve(process.argv[2]);
const formatPath = join(runtime, 'dist/server/audit/audit-format.js');
const loggerPath = join(runtime, 'dist/server/audit/audit-log.js');
const before = await readFile(formatPath);
assert.ok([
  'ADE5949CD392FEA4C1F2D81BF1E1A8387ABC152A03F0B62EC40F7EA44E5EBB77',
  'A6702EBA21A04B8CCD287781509AB3BC14E86EAD9F50968AE4DCFF258565DF87',
].includes(createHash('sha256').update(before).digest('hex').toUpperCase()),
  'Unknown installed formatter; review its compatibility before testing this overlay.');
const pkg = JSON.parse(await readFile(join(runtime, 'package.json'), 'utf8'));
assert.equal(pkg.name, 'openchatx-mcp');
assert.equal(pkg.version, '1.0.0-beta.2');

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
function rebase(source, origin, overrides = new Map()) {
  return source.replace(/from "(\.\.?\/[^"\n]+)"/g, (_, specifier) =>
    `from ${JSON.stringify(overrides.get(specifier) || new URL(specifier, pathToFileURL(origin)).href)}`);
}
const candidate = await readFile(new URL('./baseline/audit-format.js', import.meta.url), 'utf8');
const formatUrl = dataModule(rebase(candidate, formatPath));
const loggerUrl = dataModule(rebase(await readFile(loggerPath, 'utf8'), loggerPath,
  new Map([['./audit-format.js', formatUrl]])));
const { McpAuditLogger } = await import(loggerUrl);
const { installToolRegistrationBoundary } = await import(
  pathToFileURL(join(runtime, 'dist/mcp/tool-registration-boundary.js')).href);
const { runWithAgent, setAgentTaskSlug, initializeAgentProjectRouting, getAgentIdentity } =
  await import(pathToFileURL(join(runtime, 'dist/agent/context.js')).href);

const fixture = await mkdtemp(join(tmpdir(), 'naos-routing-diagnostics-'));
try {
  const logPath = join(fixture, 'audit.yaml');
  const logger = new McpAuditLogger(logPath);
  await runWithAgent(`isolated-diagnostics-${randomUUID()}`, async () => {
    setAgentTaskSlug('isolated-routing-diagnostics');
    initializeAgentProjectRouting(false);
    const args = { action: 'health' };
    const request = logger.startRequest({
      jsonrpc: '2.0', id: 17, method: 'tools/call',
      params: { name: 'capability_list', arguments: args },
    });
    let wrapped;
    let callbackCalled = false;
    const server = { registerTool(name, config, callback) { wrapped = callback; } };
    installToolRegistrationBoundary(server, { structuredOutput: true, auditRequest: request });
    server.registerTool('capability_list', { inputSchema: {} }, async () => {
      callbackCalled = true;
      return { content: [] };
    });
    const result = await wrapped(args, {
      mcpReq: { id: 17, signal: new AbortController().signal },
    });
    assert.equal(callbackCalled, false, 'Routing must still block work.');
    assert.equal(getAgentIdentity().projectRouting, 'pending');
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error_code, 'PROJECT_ROUTING_REQUIRED');
    const log = await readFile(logPath, 'utf8');
    const failureLine = log.split('\n').find(line => line.startsWith('failure: '));
    assert.ok(failureLine);
    assert.deepEqual(JSON.parse(failureLine.slice(9)), {
      observed_at: 'openchatx_mcp', kind: 'tool',
      code: 'PROJECT_ROUTING_REQUIRED', code_source: 'exception',
    });
  });
  assert.deepEqual(await readFile(formatPath), before, 'Installed formatter must remain unchanged.');
  process.stdout.write('ROUTING_DIAGNOSTICS_INTEGRATION_PASSED: real routing guard + real audit logger; fixture only\n');
} finally {
  assert.equal(dirname(resolve(fixture)), resolve(tmpdir()));
  assert.ok(basename(fixture).startsWith('naos-routing-diagnostics-'));
  await rm(fixture, { recursive: true, force: true });
}
