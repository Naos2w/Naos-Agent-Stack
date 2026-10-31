import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compactToolAnnotations, prepareToolRegistration } from './baseline/tool-schema-presentation.js';

const conservative = {
  readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true,
};
const fixtures = [
  { name: 'bash', annotations: { ...conservative } },
  { name: 'file_edit', annotations: { ...conservative, openWorldHint: false } },
  { name: 'file_read', annotations: {
    readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
  } },
  { name: 'external_missing', annotations: undefined, external: true, expected: conservative },
  { name: 'external_partial', annotations: { title: 'External fixture', readOnlyHint: true },
    external: true, expected: { ...conservative, title: 'External fixture', readOnlyHint: true } },
];

for (const fixture of fixtures) {
  test(`${fixture.name} keeps explicit tool risk annotations`, () => {
    const config = {
      annotations: fixture.annotations && { ...fixture.annotations },
      ...(fixture.external ? { _meta: { 'shellby/externalMcp': true } } : {}),
    };
    const original = config.annotations && { ...config.annotations };
    const registration = prepareToolRegistration(fixture.name, config, false);
    assert.deepEqual(config.annotations, fixture.expected ?? fixture.annotations);
    assert.deepEqual(fixture.annotations, original);
    assert.equal(registration.acceptsInput, false);
    assert.equal(registration.nativeContent, fixture.external === true || fixture.name === 'file_read');
  });
}

test('read-only declarations retain explicit destructive and idempotent values and metadata', () => {
  const declared = Object.freeze({
    title: 'Declared semantics', readOnlyHint: true, destructiveHint: true,
    idempotentHint: false, openWorldHint: true, vendorHint: 'retained',
  });
  assert.deepEqual(compactToolAnnotations(declared), declared);
  assert.notEqual(compactToolAnnotations(declared), declared);
});

test('missing and malformed annotations cannot imply reduced tool risk', () => {
  for (const value of [undefined, null, [], 'read-only', {}, {
    readOnlyHint: 'true', destructiveHint: undefined, idempotentHint: null, openWorldHint: 0,
  }]) {
    assert.deepEqual(compactToolAnnotations(value), conservative);
  }
});

test('annotation preservation does not change compact-output or native-content registration', () => {
  const output = { type: 'object' };
  const input = { type: 'object' };
  const shell = { inputSchema: input, outputSchema: output, annotations: conservative };
  assert.deepEqual(prepareToolRegistration('bash', shell, false), {
    acceptsInput: true, nativeContent: false,
  });
  assert.equal(shell.inputSchema, input);
  assert.equal(shell.outputSchema, undefined);
  for (const [name, structuredOutput, metadata] of [
    ['bash', true, undefined], ['file_read', false, undefined],
    ['external_fixture', false, { 'shellby/externalMcp': true }],
  ]) {
    const config = { outputSchema: output, _meta: metadata };
    prepareToolRegistration(name, config, structuredOutput);
    assert.equal(config.outputSchema, output);
  }
});

// Use the packaged SDK without network or a running OpenChatX service. CI can
// point at an extracted runtime; an explicit missing path is a test failure.
const runtimeRoot = process.env.NAOS_OPENCHATX_RUNTIME_ROOT ||
  (process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'OpenChatX', 'runtime'));
const sdkPaths = runtimeRoot && ['server', 'client'].map(name =>
  join(runtimeRoot, 'node_modules', '@modelcontextprotocol', name, 'dist', 'index.mjs'));
let sdkAvailable = false;
if (sdkPaths) {
  try {
    await Promise.all(sdkPaths.map(path => access(path)));
    sdkAvailable = true;
  } catch (error) {
    if (process.env.NAOS_OPENCHATX_RUNTIME_ROOT) throw error;
    if (error.code !== 'ENOENT') throw error;
  }
}

test('actual SDK tools/list preserves all annotations without executing callbacks', {
  skip: !sdkAvailable && 'Set NAOS_OPENCHATX_RUNTIME_ROOT to a packaged OpenChatX runtime with its MCP SDK.',
  timeout: 10_000,
}, async () => {
  const [{ McpServer, InMemoryTransport }, { Client }] = await Promise.all(
    sdkPaths.map(path => import(pathToFileURL(path).href)),
  );
  const server = new McpServer({ name: 'annotation-offline-fixture', version: '1.0.0' });
  const client = new Client({ name: 'annotation-offline-test', version: '1.0.0' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  let callbackCount = 0;
  for (const fixture of fixtures) {
    const config = {
      description: 'Offline annotation fixture only.',
      annotations: fixture.annotations && { ...fixture.annotations },
      ...(fixture.external ? { _meta: { 'shellby/externalMcp': true } } : {}),
    };
    prepareToolRegistration(fixture.name, config, false);
    server.registerTool(fixture.name, config, () => {
      callbackCount++;
      throw new Error('Tool execution is forbidden in this tools/list test.');
    });
  }
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = await client.listTools();
    assert.equal(listed.tools.length, fixtures.length);
    for (const fixture of fixtures) {
      const actual = listed.tools.find(tool => tool.name === fixture.name);
      assert.ok(actual, fixture.name);
      assert.deepEqual(actual.annotations, fixture.expected ?? fixture.annotations, fixture.name);
    }
    assert.equal(callbackCount, 0);
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
});
