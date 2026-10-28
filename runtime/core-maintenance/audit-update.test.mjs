import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rename, rm, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { applyVerifiedFiles, journalName } from './apply-audit-diagnostics.mjs';
import { verifyCore } from './verify-core.mjs';
const sha = value => createHash('sha256').update(value).digest('hex').toUpperCase();
async function fixture(work) {
  const root = await mkdtemp(join(tmpdir(), 'naos-audit-update-test-'));
  const originals = ['old-first', 'old-second', null];
  const plan = originals.map((before, index) => {
    const bytes = Buffer.from(`new-${index}`);
    return { target: join(root, `${index}.js`), before: before === null ? null : sha(before), after: sha(bytes), bytes };
  });
  for (let i = 0; i < originals.length; i++) if (originals[i] !== null) await writeFile(plan[i].target, originals[i]);
  const journal = join(root, journalName);
  const apply = options => applyVerifiedFiles(plan, journal, join(root, 'backups'), options);
  try { await work({ root, originals, plan, journal, apply }); }
  finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('naos-audit-update-test-'));
    await rm(root, { recursive: true, force: true });
  }
}
async function assertOriginals(plan, originals) {
  for (let i = 0; i < originals.length; i++) {
    if (originals[i] === null) await assert.rejects(lstat(plan[i].target), { code: 'ENOENT' });
    else assert.equal(await readFile(plan[i].target, 'utf8'), originals[i]);
  }
}
test('successful update keeps exact backups and removes its journal', () => fixture(async ({ plan, apply, journal }) => {
  const result = await apply();
  assert.equal(result.files, 3);
  assert.equal(await readFile(join(result.backup, '0.before'), 'utf8'), 'old-first');
  for (const item of plan) assert.equal(sha(await readFile(item.target)), item.after);
  await assert.rejects(lstat(journal), { code: 'ENOENT' });
}));
test('second replacement failure restores already replaced files', () => fixture(async ({ plan, originals, apply, journal }) => {
  let calls = 0;
  await assert.rejects(apply({ replaceFile: async (...args) => {
    if (++calls === 2) throw Error('INJECTED_SECOND_FAILURE');
    await rename(...args);
  } }), /INJECTED_SECOND_FAILURE/);
  await assertOriginals(plan, originals);
  await assert.rejects(lstat(journal), { code: 'ENOENT' });
}));
test('post-install verification failure also removes newly introduced files', () => fixture(async ({ plan, originals, apply, journal }) => {
  await assert.rejects(apply({ verify: async () => { throw Error('INJECTED_VERIFY_FAILURE'); } }), /INJECTED_VERIFY_FAILURE/);
  await assertOriginals(plan, originals);
  await assert.rejects(lstat(journal), { code: 'ENOENT' });
}));
test('rollback preserves a concurrent edit and keeps recovery evidence', () => fixture(async ({ root, plan, apply, journal }) => {
  await assert.rejects(apply({ verify: async () => {
    await writeFile(plan[0].target, 'concurrent-user-edit');
    throw Error('INJECTED_VERIFY_FAILURE');
  } }), /CORE_AUDIT_RECOVERY_REQUIRED/);
  assert.equal(await readFile(plan[0].target, 'utf8'), 'concurrent-user-edit');
  const retained = JSON.parse(await readFile(journal, 'utf8'));
  assert.equal(retained.files.length, 3);
  await assert.rejects(verifyCore({ runtimeRoot: root, manifestPath: join(root, 'manifest.json') }), /CORE_AUDIT_RECOVERY_REQUIRED/);
}));
test('rollback replacement failure retains the journal', () => fixture(async ({ apply, journal }) => {
  let calls = 0;
  await assert.rejects(apply({ replaceFile: async (...args) => {
    if (++calls >= 2) throw Error('INJECTED_REPLACE_FAILURE');
    await rename(...args);
  } }), /CORE_AUDIT_RECOVERY_REQUIRED/);
  assert.equal(JSON.parse(await readFile(journal, 'utf8')).schema, 1);
}));
test('changed preimages and existing journals prevent all replacement', () => fixture(async ({ plan, apply, journal }) => {
  await writeFile(plan[0].target, 'concurrent-before-apply');
  await assert.rejects(apply(), /AUDIT_UPDATE_PREIMAGE_MISMATCH/);
  assert.equal(await readFile(plan[1].target, 'utf8'), 'old-second');
  await writeFile(journal, 'preserve-existing-journal');
  await assert.rejects(apply(), /CORE_AUDIT_RECOVERY_REQUIRED/);
  assert.equal(await readFile(journal, 'utf8'), 'preserve-existing-journal');
}));
