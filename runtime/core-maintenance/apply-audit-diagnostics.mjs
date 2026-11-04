import { readFile, writeFile, mkdir, rename, unlink, lstat, mkdtemp } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireRuntimeMaintenance } from '../lean-runtime/runtime_maintenance.mjs';
import { inspectRuntimeMaintenanceEligibility, inspectTerminalWorkerPid } from '../lean-runtime/runtime_readiness.mjs';
import { verifyCore } from './verify-core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const run = promisify(execFile);
export const journalName = '.audit-update-pending.json';

// PM2's delayed exit handler can relabel an already stopped process as
// "waiting restart" even when its stop flag prevented scheduling a restart.
// Reissue stop once only for that PID-less state; never treat it as stopped.
export async function stopServiceForUpdate({ stop, inspect, wait = delay }) {
  await stop();
  await wait(250);
  let app = await inspect();
  if (app.pm2_env.status === 'waiting restart' && app.pid === 0) {
    await stop();
    await wait(250);
    app = await inspect();
  }
  if (app.pm2_env.status !== 'stopped' || app.pid !== 0)
    throw Error('AUDIT_UPDATE_STOP_UNVERIFIED');
}

async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function noLinks(path) {
  for (let cursor = resolve(path); ; cursor = dirname(cursor)) {
    try { if ((await lstat(cursor)).isSymbolicLink()) throw Error('AUDIT_UPDATE_LINK_REFUSED'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (dirname(cursor) === cursor) break;
  }
}
async function digest(path) {
  await noLinks(path);
  try { return sha(await readFile(path)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// All installed targets must match the *same* approved revision. Mixing a
// partially updated state with a different pinset never becomes an upgrade path.
export function choosePinnedPreimages(keys, pinsets, observed) {
  if (!Array.isArray(keys) || !keys.length || new Set(keys).size !== keys.length
      || !Array.isArray(pinsets) || !(observed instanceof Map))
    throw Error('AUDIT_UPDATE_BASE_SCOPE_INVALID');
  const selected = pinsets.find(pins => pins && !Array.isArray(pins)
    && typeof pins === 'object'
    && keys.every(key => Object.hasOwn(pins,key)
      && (pins[key] === null || /^[A-F0-9]{64}$/.test(pins[key]))
      && pins[key] === observed.get(key)));
  if (!selected) throw Error('AUDIT_UPDATE_PREIMAGE_MISMATCH');
  return selected;
}

// Fixed installation scope. Neither a CLI caller nor a journal chooses targets.
export async function preparePlan(runtimeRoot, headlessRoot) {
  const pkg = JSON.parse(await readFile(join(runtimeRoot, 'package.json'), 'utf8'));
  if (pkg.name !== 'openchatx-mcp' || pkg.version !== '1.0.0-beta.2') throw Error('AUDIT_UPDATE_VERSION_MISMATCH');
  const core = join(headlessRoot, 'core-maintenance');
  const manifest = JSON.parse(await readFile(join(here, 'manifest.json'), 'utf8'));
  // Two fixed, version-pinned origins: initial bootstrap and the verified
  // 2026-11-02 core overlay. Never infer an acceptable "before" hash from
  // whichever bytes happen to be installed.
  const preimages = await Promise.all([
    'bootstrap-preimages.json',
    'upgrade-preimages-20261102.json',
  ].map(async name => JSON.parse((await readFile(join(here, name), 'utf8')).replace(/^\uFEFF/, ''))));
  const rows = [];
  for (const entry of manifest.files) {
    rows.push({key: entry.relativePath, source: entry.snapshot, target: join(runtimeRoot, entry.relativePath)});
    rows.push({key: 'snapshot/' + entry.snapshot, source: entry.snapshot, target: join(core, entry.snapshot)});
  }
  for (const name of ['manifest.json', 'verify-core.mjs', 'README.md'])
    rows.push({key: 'metadata/' + name, source: name, target: join(core, name)});
  const observed = new Map();
  for (const item of rows) {
    await noLinks(join(here, item.source));
    observed.set(item.key, await digest(item.target));
  }
  const pinned = choosePinnedPreimages(rows.map(x => x.key), preimages, observed);
  const plan = [];
  for (const {key, source, target} of rows) {
    const bytes = await readFile(join(here, source));
    plan.push({ target, before: pinned[key], after: sha(bytes), bytes });
  }
  return plan;
}

// The service is stopped and the Runtime admission mutex is held by the caller.
// Exported only for isolated fault-injection tests; no arbitrary plan CLI exists.
export async function applyVerifiedFiles(plan, journalPath, backupParent,
  { replaceFile = rename, verify = async () => {} } = {}) {
  await noLinks(journalPath);
  await noLinks(backupParent);
  if (await exists(journalPath)) throw Error('CORE_AUDIT_RECOVERY_REQUIRED');
  for (const item of plan) {
    if (await digest(item.target) !== item.before || sha(item.bytes) !== item.after)
      throw Error('AUDIT_UPDATE_PREIMAGE_MISMATCH');
  }
  await mkdir(backupParent, { recursive: true });
  const backup = await mkdtemp(join(backupParent, 'core-audit-'));
  const records = [];
  for (const [index, item] of plan.entries()) {
    const preimage = item.before === null ? null : await readFile(item.target);
    if ((preimage === null ? null : sha(preimage)) !== item.before) throw Error('AUDIT_UPDATE_CONCURRENT_EDIT');
    const saved = join(backup, `${index}.before`);
    if (preimage !== null) await writeFile(saved, preimage, { flag: 'wx' });
    records.push({ ...item, saved, temporary: `${item.target}.audit-${randomUUID()}` });
  }
  const manifest = { schema: 1, backup, files: records.map(({ bytes, ...entry }) => entry) };
  await writeFile(join(backup, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  await writeFile(journalPath, JSON.stringify(manifest), { flag: 'wx' });
  const changed = [];
  try {
    for (const item of records) {
      if (await digest(item.target) !== item.before) throw Error('AUDIT_UPDATE_CONCURRENT_EDIT');
      await writeFile(item.temporary, item.bytes, { flag: 'wx' });
      await replaceFile(item.temporary, item.target);
      changed.push(item);
    }
    for (const item of records) {
      if (await digest(item.target) !== item.after) throw Error('AUDIT_UPDATE_VERIFY_FAILED');
    }
    await verify();
    await unlink(journalPath);
    return { backup, files: records.length };
  } catch (failure) {
    const rollbackFailures = [];
    for (const item of [...changed].reverse()) {
      try {
        if (await digest(item.target) !== item.after) throw Error('AUDIT_ROLLBACK_CONCURRENT_EDIT');
        if (item.before === null) await unlink(item.target);
        else {
          const bytes = await readFile(item.saved);
          if (sha(bytes) !== item.before) throw Error('AUDIT_ROLLBACK_BACKUP_MISMATCH');
          await writeFile(item.temporary, bytes, { flag: 'wx' });
          await replaceFile(item.temporary, item.target);
        }
      } catch (error) { rollbackFailures.push(error); }
    }
    if (rollbackFailures.length) throw new AggregateError([failure, ...rollbackFailures], 'CORE_AUDIT_RECOVERY_REQUIRED');
    await unlink(journalPath);
    throw failure;
  } finally {
    for (const item of records) if (await exists(item.temporary)) await unlink(item.temporary);
  }
}

async function assertNoActiveJobs(headlessRoot) {
  const state = JSON.parse(await readFile(join(dirname(headlessRoot), 'jobs/jobs.json'), 'utf8'));
  if (!Array.isArray(state.jobs) || state.jobs.some(job => !job || typeof job.status !== 'string'))
    throw Error('AUDIT_UPDATE_JOBS_UNVERIFIED');
  const active = state.jobs.filter(job => !['completed', 'failed', 'cancelled'].includes(job.status));
  if (active.length) throw Error(`AUDIT_UPDATE_JOBS_ACTIVE: ${active.length}`);
}
// Called again while holding the exclusive Runtime maintenance lock, both
// before and after stopping MCP. Historical unresolved records are retained;
// a live Worker, corrupt registry, or unverifiable PID still blocks updates.
export async function assertNoOperations(toolbox, { probePid, inspectProcess } = {}) {
  let state;
  try { state = JSON.parse(await readFile(join(toolbox, 'operations.json'), 'utf8')); }
  catch { throw Error('AUDIT_UPDATE_OPERATIONS_UNVERIFIED'); }
  if (!state || Array.isArray(state) || typeof state !== 'object')
    throw Error('AUDIT_UPDATE_OPERATIONS_UNVERIFIED');
  for (const item of Object.values(state)) {
    if (!item || !['completed', 'failed', 'cancelled'].includes(item.state))
      throw Error('AUDIT_UPDATE_OPERATIONS_ACTIVE_OR_UNVERIFIED');
    const check = await inspectTerminalWorkerPid(item, {probePid,inspectProcess});
    if (!check.safe) throw Error('AUDIT_UPDATE_' + check.reason);
  }
}
async function waitForNoActiveJobs(headlessRoot) {
  const deadline = Date.now() + 120000;
  let nextNotice = 0;
  while (true) {
    try { await assertNoActiveJobs(headlessRoot); return; }
    catch (error) {
      if (!error.message.startsWith('AUDIT_UPDATE_JOBS_ACTIVE:') || Date.now() >= deadline) throw error;
      if (Date.now() >= nextNotice) {
        process.stdout.write(`AUDIT_WAITING_FOR_JOBS ${error.message}; no service stopped\n`);
        nextNotice = Date.now() + 30000;
      }
      await delay(1000);
    }
  }
}
async function install(runtimeRoot, headlessRoot) {
  const toolbox = join(headlessRoot, 'toolboxes/agent-runtime');
  const core = join(headlessRoot, 'core-maintenance');
  const journal = join(core, journalName);
  if (!(await exists(join(headlessRoot, 'health-watch.paused')))) throw Error('AUDIT_UPDATE_WATCHDOG_NOT_PAUSED');
  if (await exists(journal)) throw Error('CORE_AUDIT_RECOVERY_REQUIRED');
  const maintenance = await inspectRuntimeMaintenanceEligibility(toolbox);
  if (!maintenance.allowed) throw Error(`AUDIT_UPDATE_RUNTIME_NOT_QUIESCENT: ${maintenance.reason}`);
  // A historical unresolved Operation must remain untouched by this installer.
  if (maintenance.unresolved > 0)
    process.stdout.write(`AUDIT_HISTORICAL_OPERATIONS_PRESERVED count=${maintenance.unresolved}\n`);
  const plan = await preparePlan(runtimeRoot, headlessRoot);
  const release = await acquireRuntimeMaintenance(toolbox);
  const pm2 = async args => (await run(process.execPath, [join(headlessRoot, 'node_modules/pm2/bin/pm2'), ...args], {
    env: { ...process.env, PM2_HOME: join(headlessRoot, 'pm2') }, windowsHide: true, timeout: 30000,
  })).stdout;
  const mcp = async () => {
    const apps = JSON.parse(await pm2(['jlist'])).filter(app => app.name === 'openchatx-mcp');
    if (apps.length !== 1) throw Error('AUDIT_UPDATE_MCP_AMBIGUOUS');
    return apps[0];
  };
  let stopped = false;
  try {
    await assertNoOperations(toolbox);
    await waitForNoActiveJobs(headlessRoot);
    if ((await mcp()).pm2_env.status !== 'online') throw Error('AUDIT_UPDATE_MCP_NOT_ONLINE');
    // Record the stop attempt before dispatch so an uncertain PM2 response still
    // attempts to restore service, provided no recovery journal remains.
    stopped = true;
    await stopServiceForUpdate({ stop: () => pm2(['stop', 'openchatx-mcp']), inspect: mcp });
    await assertNoOperations(toolbox);
    await assertNoActiveJobs(headlessRoot);
    const result = await applyVerifiedFiles(plan, journal, join(headlessRoot, 'backups'), {
      verify: async () => {
        const check = await verifyCore({ runtimeRoot, manifestPath: join(here, 'manifest.json'), snapshotRoot: join(core, 'baseline') });
        if (!check.ok) throw Error(`AUDIT_UPDATE_CORE_VERIFY_FAILED: ${check.failures.join('; ')}`);
      },
    });
    process.stdout.write(`AUDIT_OVERLAY_APPLIED ${JSON.stringify(result)}\n`);
  } finally {
    try {
      if (stopped && !(await exists(journal))) {
        await pm2(['restart', 'openchatx-mcp']);
        if ((await mcp()).pm2_env.status !== 'online') throw Error('AUDIT_UPDATE_RESTART_UNVERIFIED');
        let healthy = false;
        for (let attempt = 0; attempt < 15; attempt++) {
          try { healthy = (await fetch('http://127.0.0.1:8001/healthz', { signal: AbortSignal.timeout(1000) })).ok; }
          catch { /* bounded startup wait */ }
          if (healthy) break;
          await delay(500);
        }
        if (!healthy) throw Error('AUDIT_UPDATE_HEALTH_UNVERIFIED');
        process.stdout.write('AUDIT_MCP_RESTART_VERIFIED\n');
      }
    } finally { await release(); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw Error('Usage: node apply-audit-diagnostics.mjs <runtime-root> <headless-root>');
    await install(resolve(process.argv[2]), resolve(process.argv[3]));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
