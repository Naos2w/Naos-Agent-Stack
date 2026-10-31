import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
const runtime = process.env.NAOS_OPENCHATX_RUNTIME_ROOT;
const zod = runtime && join(runtime, 'node_modules/zod/index.js');
let available = false;
if (zod) { await access(zod); available = true; }
const data = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
let SummaryRegistry, registerSummarizeTool, faults;
if (available) {
  const io = data(`export {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
    import {rename as original} from 'node:fs/promises';
    export const faults={failRename:false};
    export async function rename(...args){if(faults.failRename)throw Error('INJECTED_RENAME_FAILURE');return original(...args);}`);
  faults = (await import(io)).faults;
  const config = data('export const MCP_CONFIG={stateDir:"must-use-fixture"};');
  let source = await readFile(new URL('./baseline/summary-registry.js', import.meta.url), 'utf8');
  source = source.replace('"zod"', JSON.stringify(pathToFileURL(zod).href))
    .replace('"../config.js"', JSON.stringify(config)).replace('"node:fs/promises"', JSON.stringify(io));
  ({SummaryRegistry} = await import(data(source)));
  source = await readFile(new URL('./baseline/summarize-tool.js', import.meta.url), 'utf8');
  source = source.replace('"zod"', JSON.stringify(pathToFileURL(zod).href))
    .replace('"../../mcp/tool-error.js"', JSON.stringify(data('export const toToolError=e=>e;')));
  ({registerSummarizeTool} = await import(data(source)));
}
const options = {skip: !available && 'Set NAOS_OPENCHATX_RUNTIME_ROOT to use the installed Zod dependency.'};
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'naos-summary-test-'));
  const path = join(root, 'summaries.json'), registry = new SummaryRegistry(path);
  try { await run({registry, root, path}); }
  finally {
    faults.failRename = false;
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('naos-summary-test-'));
    await rm(root, {recursive: true, force: true});
  }
}
test('lost retrieval response can be reread after restart; acknowledgment is retryable', options, () => fixture(async ({registry, path}) => {
  const saved = await registry.create('objective', 'recent context');
  await registry.consume(saved.uuid); // Simulate the caller losing this response.
  const restarted = new SummaryRegistry(path), read = await restarted.get(saved.uuid);
  assert.equal(read.content, 'objective');
  assert.equal(read.revision, saved.revision);
  await restarted.acknowledge(read.uuid, read.revision);
  await assert.rejects(restarted.get(read.uuid), /SUMMARY_NOT_FOUND/);
  assert.equal((await new SummaryRegistry(path).acknowledge(read.uuid, read.revision)).alreadyAcknowledged, true);
  assert.doesNotMatch(await readFile(path, 'utf8'), /objective|recent context/);
}));
test('stale acknowledgment never deletes an updated handoff', options, () => fixture(async ({registry}) => {
  const saved = await registry.create('before');
  const updated = await registry.update(saved.uuid, 'after');
  await assert.rejects(registry.acknowledge(saved.uuid, saved.revision), /SUMMARY_REVISION_MISMATCH/);
  assert.equal((await registry.get(saved.uuid)).content, 'after');
  await registry.acknowledge(updated.uuid, updated.revision);
}));
test('failed atomic replacement preserves disk and memory and allows a later retry', options, () => fixture(async ({registry, path, root}) => {
  const saved = await registry.create('preserve me');
  const before = await readFile(path, 'utf8');
  faults.failRename = true;
  await assert.rejects(registry.acknowledge(saved.uuid, saved.revision), /INJECTED_RENAME_FAILURE/);
  assert.equal(await readFile(path, 'utf8'), before);
  assert.equal((await registry.get(saved.uuid)).content, 'preserve me');
  faults.failRename = false;
  await registry.acknowledge(saved.uuid, saved.revision);
  assert.deepEqual(await readdir(root), ['summaries.json']);
}));
test('concurrent writes and acknowledgments keep a valid consistent registry', options, () => fixture(async ({registry, path}) => {
  const created = await Promise.all(Array.from({length: 12}, (_, i) => registry.create('item-' + i)));
  await Promise.all(created.slice(0, 6).map(s => registry.acknowledge(s.uuid, s.revision)));
  const restarted = new SummaryRegistry(path);
  assert.equal((await restarted.list()).length, 6);
  for (const s of created.slice(6)) assert.equal((await restarted.get(s.uuid)).content, s.content);
}));
test('legacy summaries remain available; new expirations do not imply acknowledgment', options, () => fixture(async ({registry, path}) => {
  const saved = await registry.create('legacy');
  const state = JSON.parse(await readFile(path, 'utf8'));
  delete state.summaries[0].expiresAt;
  state.summaries[0].createdAt = '2000-01-01T00:00:00.000Z';
  await writeFile(path, JSON.stringify(state));
  assert.equal((await new SummaryRegistry(path).get(saved.uuid)).content, 'legacy');
  state.summaries[0].expiresAt = '2000-01-08T00:00:00.000Z';
  await writeFile(path, JSON.stringify(state));
  const expired = new SummaryRegistry(path);
  await assert.rejects(expired.get(saved.uuid), /SUMMARY_EXPIRED/);
  await assert.rejects(expired.acknowledge(saved.uuid, saved.revision), /SUMMARY_NOT_FOUND/);
}));
test('malformed storage fails without overwriting evidence', options, () => fixture(async ({path}) => {
  await writeFile(path, '{broken');
  await assert.rejects(new SummaryRegistry(path).create('new'));
  assert.equal(await readFile(path, 'utf8'), '{broken');
}));
test('actual public tool retrieves without deleting and accepts explicit versioned acknowledgment', options, () => fixture(async ({registry}) => {
  let config, callback;
  registerSummarizeTool({registerTool(name, c, cb) {assert.equal(name, 'summarize');config=c;callback=cb;}}, registry);
  assert.equal(config.annotations.destructiveHint, true);
  const call = args => callback(config.inputSchema.parse(args));
  const created = await call({summary: 'Objective', recent_context: 'remaining work'});
  const uuid = created.content[0].text;
  const result = await call({uuid});
  assert.match(result.content[1].text, /Objective.*\n.*Recent Context/s);
  const metadata = JSON.parse(result.content[0].text).handoff;
  assert.equal(metadata.acknowledgmentRequired, true);
  assert.equal((await registry.get(uuid)).content, 'Objective');
  assert.equal(JSON.parse((await call({ack_uuid: uuid, revision: metadata.revision})).content[0].text).acknowledged, true);
}));
