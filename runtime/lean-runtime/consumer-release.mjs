import { lstat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';

const sourceSha = bytes => createHash('sha256').update(bytes).digest('hex');
export const CONSUMER_REGISTRY = 'release-consumers.v1.json';
export const STOCK_SOURCE_NAMES = Object.freeze([
  'agent_runtime.ts', 'letta_worker.ts', 'agent_capabilities.ts',
  'development_gate.ts', 'operation_invariants.ts', 'runtime_contract.ts',
  'project_executor.ts', 'external_tool_idempotency.ts',
  'qa_operation_archive.ts', 'runtime_maintenance.mjs',
  'operation_reconciliation.mjs',
]);
const SHA = /^[a-f0-9]{64}$/i;

async function safeRead(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw Error('RUNTIME_CONSUMER_SOURCE_NOT_A_REGULAR_FILE');
  }
  return readFile(path);
}

function exact(pattern, source, label) {
  const found = [...source.matchAll(pattern)];
  if (found.length !== 1 || !SHA.test(found[0][1])) {
    throw Error('RUNTIME_CONSUMER_PIN_SCHEMA_INVALID: ' + label);
  }
  return found[0][1].toLowerCase();
}

// Parse the *reviewed Stock consumer source*, not an independently editable
// candidate-approved SHA map. Unknown/ambiguous contract syntax fails closed.
export function parseStockSourcePins(source) {
  const pins = new Map([
    ['agent_runtime.ts', exact(
      /^\s*\$reviewedRuntimeSha256\s*=\s*"([a-f0-9]{64})"\s*$/gim,
      source, 'agent_runtime.ts',
    )],
    ['letta_worker.ts', exact(
      /^\s*\$reviewedWorkerSha256\s*=\s*"([a-f0-9]{64})"\s*$/gim,
      source, 'letta_worker.ts',
    )],
  ]);
  for (const match of source.matchAll(
    /@\{\s*Name\s*=\s*"([^"]+)"\s*;\s*Sha256\s*=\s*"([a-f0-9]{64})"\s*\}/gi
  )) {
    const name = match[1], digest = match[2].toLowerCase();
    if (!STOCK_SOURCE_NAMES.includes(name) || pins.has(name)) {
      throw Error('RUNTIME_CONSUMER_PIN_SCHEMA_INVALID: unexpected or duplicate dependency');
    }
    pins.set(name, digest);
  }
  if (pins.size !== STOCK_SOURCE_NAMES.length ||
      STOCK_SOURCE_NAMES.some(name => !pins.has(name))) {
    throw Error('RUNTIME_CONSUMER_PIN_SCHEMA_INVALID: incomplete reviewed closure');
  }
  return pins;
}

async function registry(root) {
  const path = join(root, CONSUMER_REGISTRY);
  let bytes;
  try { bytes = await safeRead(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); }
  catch { throw Error('RUNTIME_CONSUMER_REGISTRY_INVALID'); }
  if (value?.schema !== 1 || !Array.isArray(value.consumers) ||
      value.consumers.length < 1 || value.consumers.length > 8) {
    throw Error('RUNTIME_CONSUMER_REGISTRY_INVALID');
  }
  const names = new Set();
  for (const consumer of value.consumers) {
    if (!consumer || !/^[a-z][a-z0-9-]{0,47}$/.test(consumer.id) ||
        consumer.contract !== 'stock-reviewed-11-source-pins-v1' ||
        !isAbsolute(consumer.pin_file) || names.has(consumer.id)) {
      throw Error('RUNTIME_CONSUMER_REGISTRY_INVALID');
    }
    names.add(consumer.id);
  }
  return { bytes, value };
}

// Called only while the existing publisher maintenance mutex is held.
// The post-image is from the reviewed/staged release, not an external SHA
// supplied by the caller. Anything Stock hasn't pinned cannot be published.
export async function inspectConsumerRelease(root, postImages = new Map()) {
  const configured = await registry(root);
  if (configured === null) return null; // Fresh/disposable runtimes are unregistered.
  const snapshot = {
    registrySha256: sourceSha(configured.bytes),
    consumers: [],
  };
  for (const consumer of configured.value.consumers) {
    const pinned = await safeRead(consumer.pin_file);
    const approved = parseStockSourcePins(pinned.toString('utf8'));
    for (const name of STOCK_SOURCE_NAMES) {
      const target = 'tools/' + name;
      const image = postImages.has(target)
        ? postImages.get(target)
        : await safeRead(join(root, target));
      if (sourceSha(image) !== approved.get(name)) {
        throw Error('RUNTIME_CONSUMER_PIN_MISMATCH: ' + consumer.id + '/' + name);
      }
    }
    snapshot.consumers.push({
      id: consumer.id, pinFile: consumer.pin_file, pinSha256: sourceSha(pinned),
    });
  }
  return snapshot;
}

// Other projects may edit their review file while the publisher is working.
// A changed consumer approval is not allowed to inherit this release.
export async function assertConsumerReleaseUnchanged(root, snapshot) {
  if (snapshot === null) return;
  const current = await registry(root);
  if (!current || sourceSha(current.bytes) !== snapshot.registrySha256) {
    throw Error('RUNTIME_CONSUMER_APPROVAL_CHANGED_DURING_RELEASE');
  }
  for (const consumer of snapshot.consumers) {
    const bytes = await safeRead(consumer.pinFile);
    if (sourceSha(bytes) !== consumer.pinSha256) {
      throw Error('RUNTIME_CONSUMER_APPROVAL_CHANGED_DURING_RELEASE: ' + consumer.id);
    }
  }
}
