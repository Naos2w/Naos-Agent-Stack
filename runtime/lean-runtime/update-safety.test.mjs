import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { apply, recover, targets, POLICY_VERSION } from './update-runtime.mjs';
import { acquireRuntimeMaintenance, withRuntimeActivity, RECOVERY_FILE } from './runtime_maintenance.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'naos-update-safety-'));
  const root = join(base, 'runtime'), stage = join(base, 'stage');
  const files = [];
  for (const [index, path] of targets.entries()) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await mkdir(join(stage, 'candidate', path, '..'), { recursive: true });
    // First target is a newly introduced dependency: rollback must delete it.
    if (index !== 0) await writeFile(join(root, path), 'old:' + path);
    await writeFile(join(stage, 'candidate', path), 'new:' + path);
    files.push({ path, before: index === 0 ? null : hash('old:' + path), after: hash('new:' + path) });
  }
  await writeFile(join(root, 'operations.json'), '{}');
  await writeFile(join(stage, 'manifest.json'), JSON.stringify({ version: 2, policyVersion: POLICY_VERSION,
    requiresOfflineBootstrap: false, targetRoot: root, files }));
  return { base, root, stage };
}
async function originals(root) {
  await assert.rejects(readFile(join(root, targets[0])), { code: 'ENOENT' });
  for (const path of targets.slice(1)) assert.equal(await readFile(join(root, path), 'utf8'), 'old:' + path);
  await assert.rejects(readFile(join(root, RECOVERY_FILE)), { code: 'ENOENT' });
}

test('failure on the second replacement restores all originals and removes a new file', async () => {
  const f = await fixture(); let count = 0;
  try {
    await assert.rejects(apply(f.root, f.stage, { renameFile: async (...args) => {
      if (++count === 2) throw Error('injected second-file failure');
      return rename(...args);
    } }), /UPDATE_FAILED_ROLLED_BACK/);
    await originals(f.root);
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

test('failure in final verification rolls back the entire update', async () => {
  const f = await fixture();
  try {
    await assert.rejects(apply(f.root, f.stage, { verifyInstalled: async () => { throw Error('injected verify failure'); } }), /ROLLED_BACK/);
    await originals(f.root);
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

test('failed rollback blocks dispatch until explicit recovery succeeds', async () => {
  const f = await fixture();
  try {
    await assert.rejects(apply(f.root, f.stage, {
      verifyInstalled: async () => { throw Error('verify failure'); },
      renameFile: async (from, to) => { if (from.includes('.restore-')) throw Error('restore blocked'); return rename(from, to); },
    }), /RECOVERY_REQUIRED/);
    await assert.rejects(withRuntimeActivity(f.root, async () => assert.fail('must not start')), /RECOVERY_REQUIRED/);
    assert.equal((await recover(f.root)).recovered, true);
    await originals(f.root);
    assert.equal(await withRuntimeActivity(f.root, async () => 'ready'), 'ready');
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

test('rollback preserves a concurrent edit and reports the exact conflict', async () => {
  const f = await fixture();
  try {
    await assert.rejects(apply(f.root, f.stage, { verifyInstalled: async () => {
      await writeFile(join(f.root, targets[2]), 'external-edit'); throw Error('verify failure');
    } }), /tools\/letta_worker.ts: concurrent change preserved/);
    assert.equal(await readFile(join(f.root, targets[2]), 'utf8'), 'external-edit');
    await assert.rejects(recover(f.root), /RECOVERY_INCOMPLETE/);
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

test('activity registered after preparation prevents any replacement', async () => {
  const f = await fixture();
  try {
    await withRuntimeActivity(f.root, async () => {
      await assert.rejects(apply(f.root, f.stage), /RUNTIME_ACTIVITY_BUSY/);
      await originals(f.root);
    });
    assert.equal((await apply(f.root, f.stage)).verified, targets.length);
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

const maintenanceUrl = new URL('./runtime_maintenance.mjs', import.meta.url).href;
function child(root, mode) {
  return spawn(process.execPath, ['--input-type=module', '-e', `
    import { withRuntimeActivity } from ${JSON.stringify(maintenanceUrl)};
    try { await withRuntimeActivity(${JSON.stringify(root)}, async () => {
      process.send('entered');
      if (${JSON.stringify(mode)} === 'hold') await new Promise(r => process.once('message', r));
    }); process.send('done'); }
    catch (error) { process.send(error.message); }
  `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
}

test('another process cannot dispatch after maintenance admission', { timeout: 15000 }, async () => {
  const f = await fixture(); let processChild;
  try {
    const release = await acquireRuntimeMaintenance(f.root);
    try {
      processChild = child(f.root, 'once');
      const exit = once(processChild, 'exit');
      assert.match((await once(processChild, 'message'))[0], /RUNTIME_MAINTENANCE_BUSY/);
      await exit;
    } finally { await release(); }
    await originals(f.root);
  } finally { processChild?.kill(); await rm(f.base, { recursive: true, force: true }); }
});

test('a separate live worker prevents maintenance until it finishes', { timeout: 15000 }, async () => {
  const f = await fixture(); let processChild;
  try {
    processChild = child(f.root, 'hold');
    assert.equal((await once(processChild, 'message'))[0], 'entered');
    await assert.rejects(apply(f.root, f.stage), /RUNTIME_ACTIVITY_BUSY/);
    const exit = once(processChild, 'exit');
    processChild.send('release');
    await exit;
    assert.equal((await apply(f.root, f.stage)).verified, targets.length);
    assert.deepEqual(await readdir(join(f.root, '.runtime-activity')), []);
  } finally { processChild?.kill(); await rm(f.base, { recursive: true, force: true }); }
});

test('nested facade and worker activities do not deadlock or permit maintenance', async () => {
  const f = await fixture();
  try {
    await withRuntimeActivity(f.root, () => withRuntimeActivity(f.root, async () => {
      await assert.rejects(acquireRuntimeMaintenance(f.root), /RUNTIME_ACTIVITY_BUSY/);
    }));
    const release = await acquireRuntimeMaintenance(f.root); await release();
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

test('real apply holds admission after operations check through replacement', { timeout: 15000 }, async () => {
  const f = await fixture(); let processChild, checked = false;
  try {
    const result = await apply(f.root, f.stage, { renameFile: async (...args) => {
      if (!checked) {
        checked = true;
        processChild = child(f.root, 'once');
        const exit = once(processChild, 'exit');
        assert.match((await once(processChild, 'message'))[0], /RUNTIME_MAINTENANCE_BUSY/);
        await exit;
      }
      return rename(...args);
    } });
    assert.equal(result.verified, targets.length);
    assert.equal(checked, true);
  } finally { processChild?.kill(); await rm(f.base, { recursive: true, force: true }); }
});
