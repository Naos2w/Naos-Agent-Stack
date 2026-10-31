import { readFile, readdir, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Metadata only. No log contents are printed or deleted. Quota is a visible
// soft limit until an explicit cleanup decision accounts for investigation holds.
export async function inspectAuditRetention(logRoot, policy, now = Date.now()) {
  if (policy.schema !== 1 || policy.mode !== 'report_only' ||
      !Number.isSafeInteger(policy.archiveMaxBytes) || policy.archiveMaxBytes <= 0 ||
      !Number.isSafeInteger(policy.archiveMaxAgeDays) || policy.archiveMaxAgeDays <= 0 ||
      !Number.isSafeInteger(policy.minimumArchiveCount) || policy.minimumArchiveCount < 1) {
    throw Error('AUDIT_RETENTION_POLICY_INVALID');
  }
  let names;
  try { names = await readdir(logRoot); } catch (error) { if (error.code === 'ENOENT') names = []; else throw error; }
  const archives = [];
  for (const name of names) {
    if (!/^agent-commands\.yaml\.\d{4}-\d{2}-\d{2}T[\d-]+Z\.[0-9a-f-]{36}\.archive\.gz$/u.test(name)) continue;
    const info = await lstat(join(logRoot, name));
    if (!info.isFile() || info.isSymbolicLink()) throw Error('AUDIT_ARCHIVE_NOT_REGULAR_FILE');
    archives.push({ name, bytes: info.size, modifiedMs: info.mtimeMs });
  }
  archives.sort((a,b) => b.modifiedMs - a.modifiedMs || a.name.localeCompare(b.name));
  const bytes = archives.reduce((sum, item) => sum + item.bytes, 0);
  const cold = archives.slice(policy.minimumArchiveCount).filter(item => now - item.modifiedMs > policy.archiveMaxAgeDays * 86400000);
  return { schema:1, mode:'report_only', archiveCount:archives.length, archiveBytes:bytes,
    maxArchiveBytes:policy.archiveMaxBytes, maxArchiveAgeDays:policy.archiveMaxAgeDays,
    overQuota:bytes > policy.archiveMaxBytes, coldArchiveCount:cold.length,
    action: bytes > policy.archiveMaxBytes || cold.length ? 'review_retention_and_investigation_holds' : 'none',
    automaticDeletionAllowed:false };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = dirname(fileURLToPath(import.meta.url));
  const policy = JSON.parse(await readFile(join(root, 'audit-retention-policy.json'), 'utf8'));
  console.log(JSON.stringify(await inspectAuditRetention(join(root, 'logs'), policy)));
}
