import { lstat, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

const execFileAsync = promisify(execFile);

// Only a *newer process generation* conclusively proves that a currently
// alive Windows PID is not an old terminated Worker. The query is read-only
// and performed only for PIDs that process.kill reports as alive/uncertain.
async function windowsProcessCreatedAt(pid) {
  if (process.platform !== 'win32') return null;
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  if (!systemRoot) return null;
  const powershell = join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const command = `$a=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction Stop; $b=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction Stop; if(!$a -and !$b){'ABSENT_CONFIRMED'} elseif($a -and $b -and $a.CreationDate -eq $b.CreationDate){$b.CreationDate.ToUniversalTime().ToString('o')} else {'UNVERIFIED'}`;
  const {stdout} = await execFileAsync(powershell,['-NoProfile','-NonInteractive','-Command',command],{
    windowsHide:true,timeout:8000,maxBuffer:4096,
  });
  return stdout.trim() || null;
}

// A recycled PID must not hold architecture updates hostage forever. Never
// infer recycling from a mere name difference: compare OS process start time
// strictly after the recorded original Operation's last update (1s margin).
export async function inspectTerminalWorkerPid(operation, {
  probePid = processAlive, inspectProcess = windowsProcessCreatedAt,
} = {}) {
  if (operation.pid == null || operation.pid <= 0 && Number.isSafeInteger(operation.pid))
    return {safe:true,reason:'NO_LIVE_PID'};
  if (!Number.isSafeInteger(operation.pid) || operation.pid <= 0)
    return {safe:false,reason:'RUNTIME_WORKER_PID_UNVERIFIED'};
  let potentiallyAlive = true;
  try { potentiallyAlive = probePid(operation.pid); }
  catch { /* EPERM is uncertainty, not proof the Worker is dead. */ }
  if (potentiallyAlive === false) return {safe:true,reason:'PID_NOT_RUNNING'};
  let observedStart = null;
  try { observedStart = await inspectProcess(operation.pid); }
  catch { /* Permission or query failure is uncertainty. */ }
  if (observedStart === 'ABSENT_CONFIRMED') return {safe:true,reason:'OS_PID_ABSENCE_CONFIRMED'};
  if (observedStart === null || observedStart === '') {
    // The process may have exited between the PID probe and OS query.
    // Verify once again rather than equating an unavailable OS record to death.
    try {
      if (probePid(operation.pid) === false) return {safe:true,reason:'PID_EXITED_DURING_INSPECTION'};
    } catch { /* Unknown stays unknown. */ }
  }
  const createdAt = Date.parse(observedStart);
  const lastUpdated = Date.parse(operation.updatedAt);
  if (Number.isFinite(createdAt) && Number.isFinite(lastUpdated)
      && createdAt > lastUpdated + 1000)
    return {safe:true,reason:'REUSED_PID_PROVEN'};
  return {safe:false,reason:'RUNTIME_TERMINAL_WORKER_IDENTITY_UNVERIFIED'};
}

// Maintenance eligibility is deliberately narrower than dispatch readiness.
// A terminal failed turn may require historical tool-effect reconciliation, but
// that alone does not mean a Worker is still active. Never clear its evidence.
// This function is observation-only and must be rechecked under the exclusive
// Runtime maintenance lock before replacing installed files.
export async function inspectRuntimeMaintenanceEligibility(root, { probePid = processAlive, inspectProcess = windowsProcessCreatedAt } = {}) {
  const readiness = await inspectRuntimeReadiness(root, { probePid });
  const denied = reason => ({schema: 1, allowed: false, reason, unresolved: readiness.unresolved});
  const acceptable = readiness.registry === 'present' && readiness.lock === null
    && readiness.running === 0 && readiness.stale === 0
    && (readiness.ready && readiness.state === 'ready' && readiness.reason === 'READY'
      || !readiness.ready && readiness.state === 'degraded'
        && readiness.reason === 'OPERATIONS_REQUIRE_RECONCILIATION');
  if (!acceptable) return denied(readiness.reason === 'READY' ? 'RUNTIME_MAINTENANCE_NOT_QUIESCENT' : readiness.reason);
  try {
    const value = JSON.parse(await readFile(join(root,'operations.json'),'utf8'));
    if (!object(value)) return denied('OPERATION_REGISTRY_INVALID');
    let unresolved = 0;
    for (const item of Object.values(value)) {
      if (!object(item) || !['completed','failed','cancelled'].includes(item.state))
        return denied('RUNTIME_MAINTENANCE_NOT_QUIESCENT');
      if (item.reconciliation?.requiresReconciliation === true) unresolved++;
      // Only a proven newer OS process generation can explain a live PID
      // formerly assigned to a terminated Worker.
      const pid = await inspectTerminalWorkerPid(item,{probePid,inspectProcess});
      if (!pid.safe) return denied(pid.reason);
    }
    // Prevent a registry change while the admission precheck is in progress.
    if (unresolved !== readiness.unresolved) return denied('RUNTIME_REGISTRY_CHANGED');
    return { schema: 1, allowed: true,
      reason: unresolved ? 'HISTORICAL_RECONCILIATION_PRESERVED' : 'MAINTENANCE_QUIESCENT',
      unresolved };
  } catch {
    return denied('RUNTIME_MAINTENANCE_STATE_UNVERIFIED');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? dirname(dirname(fileURLToPath(import.meta.url)));
  const result = await inspectRuntimeReadiness(root);
  console.log(JSON.stringify(result));
  process.exitCode = result.ready ? 0 : 2;
}
