import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectAuditRetention } from './audit-retention.mjs';
test('retention reports total archive pressure and cold inventory without deleting protected evidence', async () => {
  const root = await mkdtemp(join(tmpdir(),'naos-retention-'));
  try {
    for (let i=0;i<4;i++) {
      const name=`agent-commands.yaml.2026-01-01T00-00-00-000Z.00000000-0000-0000-0000-00000000000${i}.archive.gz`;
      await writeFile(join(root,name),'fixture');
      await utimes(join(root,name),new Date('2026-01-01'),new Date('2026-01-01'));
    }
    for (const name of ['agent-commands.yaml','pending.archive','pending.archive.gz.tmp','ledger.json']) await writeFile(join(root,name),'preserve');
    const before = await readdir(root);
    const report = await inspectAuditRetention(root,{schema:1,mode:'report_only',archiveMaxBytes:20,archiveMaxAgeDays:90,minimumArchiveCount:3},Date.parse('2026-10-28'));
    assert.equal(report.overQuota,true);
    assert.equal(report.coldArchiveCount,1);
    assert.equal(report.automaticDeletionAllowed,false);
    assert.deepEqual(await readdir(root),before);
  } finally { await rm(root,{recursive:true,force:true}); }
});
