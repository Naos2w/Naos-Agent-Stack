import { mkdir, readFile, writeFile, readdir, unlink, rmdir, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const MAINTENANCE_PROTOCOL = 1;
export const RECOVERY_FILE = '.runtime-update-pending.json';
const LOCK = '.runtime-maintenance.lock';
const ACTIVITY = '.runtime-activity';

async function noLink(path) {
  try { if ((await lstat(path)).isSymbolicLink()) throw Error('RUNTIME_LINK_REFUSED: ' + path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

// mkdir is the cross-process admission mutex. Never steal it on a timer: a
// paused updater must not lose ownership. Orphaned locks require recovery.
export async function acquireRuntimeMutex(root, waitMs = 1500, purpose = 'admission') {
  const path = join(root, LOCK), token = randomUUID();
  const deadline = Date.now() + waitMs;
  await noLink(root);
  while (true) {
    try { await mkdir(path); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw Error('RUNTIME_MAINTENANCE_BUSY');
      await delay(25);
    }
  }
  try { await writeFile(join(path, 'owner.json'), JSON.stringify({ pid: process.pid, token, purpose }), { flag: 'wx' }); }
  catch (error) { await rmdir(path); throw error; }
  return async () => {
    const owner = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8'));
    if (owner.token !== token) throw Error('RUNTIME_LOCK_OWNERSHIP_CHANGED');
    await unlink(join(path, 'owner.json'));
    await rmdir(path);
  };
}

async function assertNoRecovery(root) {
  try { await lstat(join(root, RECOVERY_FILE)); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw Error('RUNTIME_UPDATE_RECOVERY_REQUIRED');
}

// Shared activity leases allow a facade to await its own child worker. The
// mutex serializes lease creation with maintenance admission, closing TOCTOU.
export async function withRuntimeActivity(root, work) {
  const release = await acquireRuntimeMutex(root);
  const directory = join(root, ACTIVITY);
  const lease = join(directory, `${process.pid}-${randomUUID()}.json`);
  try {
    await assertNoRecovery(root);
    await noLink(directory);
    await mkdir(directory, { recursive: true });
    await writeFile(lease, JSON.stringify({ pid: process.pid }), { flag: 'wx' });
  } finally { await release(); }
  try { return await work(); }
  finally { await unlink(lease); }
}

// Call only while owning the mutex. A dead process cannot still use files;
// ambiguous/reused PIDs are conservatively considered active.
export async function assertNoRuntimeActivity(root) {
  const directory = join(root, ACTIVITY);
  await noLink(directory);
  let names;
  try { names = await readdir(directory); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const name of names) {
    const path = join(directory, name);
    await noLink(path);
    const { pid } = JSON.parse(await readFile(path, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw Error('RUNTIME_ACTIVITY_INVALID');
    try { process.kill(pid, 0); }
    catch (error) {
      if (error.code === 'ESRCH') { await unlink(path); continue; }
      throw Error('RUNTIME_ACTIVITY_UNVERIFIED');
    }
    throw Error('RUNTIME_ACTIVITY_BUSY');
  }
}

export async function acquireRuntimeMaintenance(root, { recovery = false } = {}) {
  const release = await acquireRuntimeMutex(root, 1500, 'maintenance');
  try {
    if (!recovery) await assertNoRecovery(root);
    await assertNoRuntimeActivity(root);
    return release;
  } catch (error) { await release(); throw error; }
}
