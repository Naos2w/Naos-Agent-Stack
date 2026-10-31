import { readFile, writeFile, mkdir, rename, unlink, lstat, mkdtemp } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireRuntimeMaintenance } from '../lean-runtime/runtime_maintenance.mjs';
import { inspectRuntimeReadiness } from '../lean-runtime/runtime_readiness.mjs';
import { verifyCore } from './verify-core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const run = promisify(execFile);
export const journalName = '.audit-update-pending.json';

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

// Fixed installation scope. Neither a CLI caller nor a journal chooses targets.
async function preparePlan(runtimeRoot, headlessRoot) {
  const pkg = JSON.parse(await readFile(join(runtimeRoot, 'package.json'), 'utf8'));
  if (pkg.name !== 'openchatx-mcp' || pkg.version !== '1.0.0-beta.2') throw Error('AUDIT_UPDATE_VERSION_MISMATCH');
  const core = join(headlessRoot, 'core-maintenance');
  // The nine existing modules must retain their exact verified MSI identities.
  const manifest = JSON.parse(await readFile(join(here, 'manifest.json'), 'utf8'));
  const priorFiles = manifest.files.filter(entry => entry.snapshot !== 'baseline/config.js');
  if (priorFiles.length !== 9) throw Error('AUDIT_UPDATE_BASE_SCOPE_INVALID');
  for (const entry of priorFiles) {
    for (const target of [join(runtimeRoot, entry.relativePath), join(core, entry.snapshot)]) {
      if (await digest(target) !== entry.sha256) throw Error('AUDIT_UPDATE_BASE_UNRECOGNIZED: ' + entry.relativePath);
    }
  }
  const rows = [
    ['baseline/config.js', join(runtimeRoot, 'dist/config.js'), '44B8DB235A495804877F8CBE9391126682A3E841EA68FC52E94469772218A110'],
    ['baseline/config.js', join(core, 'baseline/config.js'), null],
    ['manifest.json', join(core, 'manifest.json'), '3BDF1733C2A7C6DAD702D2F53472AEC8D89FC2B6ABFD8E09954B995C49AD4304'],
    ['verify-core.mjs', join(core, 'verify-core.mjs'), 'CC2ACCDE4F3633A5C8CF3D3156C5AF072F942BF650280CA7E4B07E35DA990C22'],
    ['README.md', join(core, 'README.md'), 'E3412C988B6F9E0FFAECE3BA527034A88D0C4254EB1C4FBB25F5EE1B48D6E8A1'],
  ];
  const plan = [];
  for (const [source, target, before] of rows) {
    await noLinks(join(here, source));
    const bytes = await readFile(join(here, source));
    if (await digest(target) !== before) throw Error(`AUDIT_UPDATE_PREIMAGE_MISMATCH: ${source}`);
    plan.push({ target, before, after: sha(bytes), bytes });
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
async function assertNoOperations(toolbox) {
  const state = JSON.parse(await readFile(join(toolbox, 'operations.json'), 'utf8'));
  if (!state || Array.isArray(state) || typeof state !== 'object' ||
      Object.values(state).some(item => !['completed', 'failed', 'cancelled'].includes(item?.state)))
    throw Error('AUDIT_UPDATE_OPERATIONS_ACTIVE_OR_UNVERIFIED');
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
  const ready = await inspectRuntimeReadiness(toolbox);
  if (!ready.ready || ready.running) throw Error(`AUDIT_UPDATE_RUNTIME_NOT_READY: ${ready.reason}`);
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
    await pm2(['stop', 'openchatx-mcp']);
    if ((await mcp()).pm2_env.status !== 'stopped') throw Error('AUDIT_UPDATE_STOP_UNVERIFIED');
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
