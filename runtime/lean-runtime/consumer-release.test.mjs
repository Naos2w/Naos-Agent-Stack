import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { apply, targets, POLICY_VERSION } from './update-runtime.mjs';
import { CONSUMER_REGISTRY, STOCK_SOURCE_NAMES, parseStockSourcePins } from './consumer-release.mjs';
import { RECOVERY_FILE } from './runtime_maintenance.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'naos-publisher-consumer-'));
  const root = join(base, 'runtime'), stage = join(base, 'stage');
  const files = [];
  for (const [index, path] of targets.entries()) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await mkdir(dirname(join(stage, 'candidate', path)), { recursive: true });
    if (index !== 0) await writeFile(join(root, path), 'old:' + path);
    await writeFile(join(stage, 'candidate', path), 'new:' + path);
    files.push({ path, before: index === 0 ? null : hash('old:' + path),
      after: hash('new:' + path) });
  }
  await writeFile(join(root, 'operations.json'), '{}');
  await writeFile(join(stage, 'manifest.json'), JSON.stringify({
    version: 2, policyVersion: POLICY_VERSION,
    requiresOfflineBootstrap: false, targetRoot: root, files,
  }));
  return { base, root, stage };
}

async function registerStockConsumer(f) {
  const pinFile = join(f.base, 'independent-stock', 'AgentRuntimeStatus.ps1');
  await mkdir(dirname(pinFile), { recursive: true });
  const digests = new Map();
  for (const name of STOCK_SOURCE_NAMES) {
    const relative = 'tools/' + name;
    let bytes;
    if (targets.includes(relative)) {
      bytes = await readFile(join(f.stage, 'candidate', relative));
    } else {
      bytes = Buffer.from('approved-existing:' + name);
      await mkdir(dirname(join(f.root, relative)), { recursive: true });
      await writeFile(join(f.root, relative), bytes);
    }
    digests.set(name, hash(bytes));
  }
  const source = [
    '$reviewedRuntimeSha256 = "' + digests.get('agent_runtime.ts').toUpperCase() + '"',
    '$reviewedWorkerSha256 = "' + digests.get('letta_worker.ts').toUpperCase() + '"',
    '$reviewedWorkerDependencies = @(',
    ...STOCK_SOURCE_NAMES.slice(2).map(
      name => ' @{ Name = "' + name + '"; Sha256 = "' + digests.get(name).toUpperCase() + '" }'
    ),
    ')',
  ].join('\n') + '\n';
  await writeFile(pinFile, source);
  await writeFile(join(f.root, CONSUMER_REGISTRY), JSON.stringify({
    schema: 1, consumers: [
      { id: 'stock', contract: 'stock-reviewed-11-source-pins-v1', pin_file: pinFile },
    ],
  }));
  return { pinFile, source, digests };
}

async function assertUnchangedOriginals(f) {
  for (const [index, relative] of targets.entries()) {
    if (index === 0) {
      await assert.rejects(readFile(join(f.root, relative)), { code: 'ENOENT' });
    } else {
      assert.equal(await readFile(join(f.root, relative), 'utf8'), 'old:' + relative);
    }
  }
  await assert.rejects(readFile(join(f.root, RECOVERY_FILE)), { code: 'ENOENT' });
}

test('publisher refuses any unreviewed candidate SHA before replacing first file', async () => {
  const f = await fixture();
  try {
    const att = await registerStockConsumer(f);
    await writeFile(att.pinFile, att.source.replace(
      att.digests.get('letta_worker.ts').toUpperCase(), '0'.repeat(64),
    ));
    await assert.rejects(apply(f.root, f.stage),
      /RUNTIME_CONSUMER_PIN_MISMATCH: stock\/letta_worker.ts/);
    await assertUnchangedOriginals(f);
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

test('publisher accepts exact independent reviewed Stock eleven-file closure', async () => {
  const f = await fixture();
  try {
    const att = await registerStockConsumer(f);
    assert.equal(parseStockSourcePins(att.source).size, STOCK_SOURCE_NAMES.length);
    const result = await apply(f.root, f.stage);
    assert.equal(result.verified, targets.length);
    for (const name of STOCK_SOURCE_NAMES) {
      assert.equal(hash(await readFile(join(f.root, 'tools', name))), att.digests.get(name));
    }
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

test('consumer review mutation during replacement triggers complete rollback', async () => {
  const f = await fixture();
  try {
    const att = await registerStockConsumer(f);
    await assert.rejects(apply(f.root, f.stage, {
      verifyInstalled: async () => {
        await writeFile(att.pinFile, att.source + '# changed during maintenance\n');
        return { verified: targets.length };
      },
    }), /UPDATE_FAILED_ROLLED_BACK: RUNTIME_CONSUMER_APPROVAL_CHANGED_DURING_RELEASE/);
    await assertUnchangedOriginals(f);
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

test('invalid or partially missing consumer registry never authorizes publishing', async () => {
  const f = await fixture();
  try {
    const att = await registerStockConsumer(f);
    await writeFile(join(f.root, CONSUMER_REGISTRY), JSON.stringify({
      schema: 1, consumers: [
        { id: 'stock', contract: 'unexpected-reviewer-contract', pin_file: att.pinFile },
      ],
    }));
    await assert.rejects(apply(f.root, f.stage), /RUNTIME_CONSUMER_REGISTRY_INVALID/);
    await assertUnchangedOriginals(f);
  } finally { await rm(f.base, { recursive: true, force: true }); }
});
