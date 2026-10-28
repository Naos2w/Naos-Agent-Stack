import { lstat, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
async function exists(path) {
  try { const stat = await lstat(path); if (stat.isSymbolicLink()) throw Error('LINKED_STATE'); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

// Pure observation: never acquire an activity lease, contact a model, repair
// state or remove an abandoned lock. HTTP liveness is a separate concern.
export async function inspectRuntimeReadiness(root, { probePid = processAlive } = {}) {
  const result = { schema: 1, ready: true, state: 'ready', reason: 'READY',
    running: 0, stale: 0, unresolved: 0, registry: 'present', lock: null };
  const block = (state, reason) => ({ ...result, ready: false, state, reason });
  try {
    if (await exists(join(root, '.runtime-update-pending.json'))) {
      return block('recovery_required', 'RUNTIME_UPDATE_RECOVERY_REQUIRED');
    }
    const lockPath = join(root, '.runtime-maintenance.lock');
    if (await exists(lockPath)) {
      let owner;
      try { owner = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8')); }
      catch (error) {
        // Bound a retry across mkdir -> owner creation and normal release.
        await delay(25);
        if (!(await exists(lockPath))) owner = null;
        else {
          try { owner = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8')); }
          catch { return block('unknown', 'RUNTIME_LOCK_OWNER_UNVERIFIED'); }
        }
      }
      if (owner !== null) {
        if (!object(owner) || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.token !== 'string') {
          return block('unknown', 'RUNTIME_LOCK_OWNER_INVALID');
        }
        if (!probePid(owner.pid)) return block('recovery_required', 'RUNTIME_LOCK_OWNER_DEAD');
        result.lock = { pid: owner.pid, purpose: owner.purpose ?? 'unknown' };
        if (owner.purpose === 'maintenance') return block('maintenance', 'RUNTIME_MAINTENANCE_BUSY');
        if (owner.purpose !== 'admission') return block('unknown', 'RUNTIME_LOCK_PURPOSE_UNVERIFIED');
        // A normal lease registration briefly holds this same mutex.
        result.state = 'busy';
        result.reason = 'RUNTIME_ADMISSION_BUSY';
      }
    }
    const operationsPath = join(root, 'operations.json');
    if (!(await exists(operationsPath))) {
      // Match the runtime's ENOENT default for a fresh installation.
      result.registry = 'absent';
      return result;
    }
    let registry;
    try { registry = JSON.parse(await readFile(operationsPath, 'utf8')); }
    catch { return block('degraded', 'OPERATION_REGISTRY_UNREADABLE'); }
    if (!object(registry)) return block('degraded', 'OPERATION_REGISTRY_INVALID');
    for (const operation of Object.values(registry)) {
      if (!object(operation) || !['running', 'completed', 'failed', 'cancelled'].includes(operation.state)) {
        return block('degraded', 'OPERATION_REGISTRY_INVALID');
      }
      if (operation.state === 'running') {
        result.running++;
        if (!Number.isSafeInteger(operation.pid) || operation.pid <= 0 || !probePid(operation.pid)) result.stale++;
      }
      if (operation.reconciliation?.requiresReconciliation === true) result.unresolved++;
    }
    if (result.stale) return block('degraded', 'STALE_OPERATIONS');
    if (result.unresolved) return block('degraded', 'OPERATIONS_REQUIRE_RECONCILIATION');
    return result;
  } catch (error) {
    return block('unknown', 'RUNTIME_STATE_UNVERIFIED');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? dirname(dirname(fileURLToPath(import.meta.url)));
  const result = await inspectRuntimeReadiness(root);
  console.log(JSON.stringify(result));
  process.exitCode = result.ready ? 0 : 2;
}
