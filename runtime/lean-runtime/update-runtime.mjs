import { readFile, writeFile, mkdir, rename, lstat, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { acquireRuntimeMaintenance, RECOVERY_FILE } from './runtime_maintenance.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const targets = [
  'tools/runtime_maintenance.mjs',
  'tools/runtime_contract.ts', 'tools/letta_worker.ts', 'tools/agent_runtime.ts',
  'docs/history/runtime-before-20261028.md', 'README.md',
  'rules/shared-development-preflight.mdc', 'skills/agent-runtime-usage/SKILL.md',
];
export const POLICY_VERSION = '2026-10-28.2';
const sha = data => createHash('sha256').update(data).digest('hex');
const normalize = text => text.replaceAll('\r\n', '\n');

function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) throw Error('Source anchor missing or ambiguous: ' + from.slice(0, 100));
  return text.replace(from, to);
}

function patchLegacyWorker(original) {
  let text = normalize(original);
  text = replaceOnce(text,
    'import { createDevelopmentReceipt, inspectDevelopmentContext } from "./development_gate.ts"',
    'import { describeOperationOutcome, prepareWorkerRunContext } from "./runtime_contract.ts"');
  text = replaceOnce(text, '  clientMessageId?: string\n  runId?: string', '  clientMessageId?: string\n  taskRef?: string | null\n  runId?: string');
  text = replaceOnce(text, '  validateSessionName(sessionName)\n  const agentId = await ensureWorkerAgent',
    '  validateSessionName(sessionName)\n  const { inspectDevelopmentContext } = await import("./development_gate.ts")\n' +
    '  const preflight = await prepareWorkerRunContext(project, input.prompt, inspectDevelopmentContext, input.taskRef)\n' +
    '  const agentId = await ensureWorkerAgent');
  text = replaceOnce(text,
    '  const preflight = project.permissions?.write === true\n    ? await createDevelopmentReceipt(project, input.prompt.trim(), [], "letta")\n    : await inspectDevelopmentContext(project, input.prompt.trim())\n', '');
  text = replaceOnce(text, '      development_preflight_receipt_id: "id" in preflight ? preflight.id : null,',
    '      development_preflight_receipt_id: null,');
  text = replaceOnce(text, '    blockers: traceSummary.blockers,\n    next_move: null,',
    '    blockers: traceSummary.blockers,\n    ...describeOperationOutcome({\n' +
    '      state: "completed", taskRef: input.taskRef, blockers: traceSummary.blockers,\n' +
    '      idempotency: traceSummary.validation.idempotency,\n    }),');
  return text;
}

function patchLegacyRuntime(original) {
  let text = normalize(original);
  text = replaceOnce(text,
    'const { createDevelopmentReceipt, inspectDevelopmentContext } =\n  await import(new URL("./development_gate.ts", import.meta.url).href)',
    'const runtimeContractUrl = new URL("./runtime_contract.ts", import.meta.url)\n' +
    'runtimeContractUrl.searchParams.set("source_mtime", String((await fs.stat(fileURLToPath(runtimeContractUrl))).mtimeMs))\n' +
    'const { describeOperationOutcome, normalizeTaskRef } = await import(runtimeContractUrl.href)');
  text = replaceOnce(text, '  inputPath?: string\n', '  inputPath?: string\n  taskRef?: string | null\n');
  text = replaceOnce(text, '  timeoutMs: number\n}) {\n  const { project, projectState, session, prompt, config, timeoutMs } = args',
    '  timeoutMs: number\n  taskRef?: string | null\n}) {\n  const { project, projectState, session, prompt, config, timeoutMs, taskRef } = args');
  text = replaceOnce(text, '      clientMessageId: `openchatx-${operationId}`,\n      prompt,',
    '      clientMessageId: `openchatx-${operationId}`,\n      taskRef,\n      prompt,');
  text = replaceOnce(text, '      inputPath,\n      state: "running",', '      inputPath,\n      taskRef: taskRef ?? null,\n      state: "running",');
  text = replaceOnce(text, '      state: "running" as const,\n      sessionId: operation.sessionId ?? null,',
    '      state: "running" as const,\n      ...describeOperationOutcome({ state: "running", taskRef: operation.taskRef }),\n      sessionId: operation.sessionId ?? null,');
  text = replaceOnce(text, '      next_move: parsed.next_move ?? null,',
    '      ...describeOperationOutcome({\n' +
    '        state: operation.state, taskRef: operation.taskRef, blockers: parsed.blockers,\n' +
    '        idempotency: parsed.validation?.idempotency, stalePoll: !sessionUpdate.current,\n      }),');
  text = replaceOnce(text, '    prompt: z.string().optional(),',
    '    prompt: z.string().optional(),\n    task_ref: z.string().trim().min(1).max(512).optional(),');
  text = replaceOnce(text, '    operation_id,\n    prompt,', '    operation_id,\n    prompt,\n    task_ref,');
  text = replaceOnce(text, '      if (!prompt?.trim()) throw new Error("PROMPT_REQUIRED")',
    '      if (!prompt?.trim()) throw new Error("PROMPT_REQUIRED")\n      const taskRef = normalizeTaskRef(task_ref)');
  const start = text.indexOf('      // OpenCode receives shared project-scoped context before delegation.');
  const end = text.indexOf('      const chosenModel =', start);
  if (start < 0 || end < 0) throw Error('Retired preflight section not found');
  text = text.slice(0, start) + '      const runtimePrompt = prompt.trim()\n\n' + text.slice(end);
  text = replaceOnce(text, '              timeoutMs: timeout_ms ?? 300_000,', '              timeoutMs: timeout_ms ?? 300_000,\n              taskRef,');
  text = replaceOnce(text, '        ...(developmentPreflight ? { developmentPreflight } : {}),',
    '        ...describeOperationOutcome({ state: operation.state, taskRef: operation.taskRef }),');
  return text;
}

export function patchWorker(original) {
  let text = normalize(original);
  if (!text.includes('prepareWorkerRunContext')) text = patchLegacyWorker(text);
  if (text.includes('withRuntimeActivity')) return text;
  text = replaceOnce(text, 'import { join, resolve } from "node:path"', 'import { dirname, join, resolve } from "node:path"');
  text = 'import { withRuntimeActivity } from "./runtime_maintenance.mjs"\n' + text;
  return replaceOnce(text, '  void workerMain().catch((error) => {',
    '  void withRuntimeActivity(dirname(dirname(modulePath)), workerMain).catch((error) => {');
}

export function patchRuntime(original) {
  let text = normalize(original);
  if (!text.includes('normalizeTaskRef')) text = patchLegacyRuntime(text);
  if (text.includes('withRuntimeActivity')) return text;
  text = replaceOnce(text, 'const execFileAsync = promisify(execFile)',
    'const maintenanceUrl = new URL("./runtime_maintenance.mjs", import.meta.url)\n' +
    'maintenanceUrl.searchParams.set("source_mtime", String((await fs.stat(fileURLToPath(maintenanceUrl))).mtimeMs))\n' +
    'const { withRuntimeActivity } = await import(maintenanceUrl.href)\n\n' +
    'const execFileAsync = promisify(execFile)');
  text = replaceOnce(text, '  }) {\n    const config = await ensureConfig()',
    '  }) {\n    return withRuntimeActivity(TOOLBOX_ROOT, async () => {\n    const config = await ensureConfig()');
  return replaceOnce(text, '    throw new Error(`UNSUPPORTED_ACTION: ${action}`)\n  },',
    '    throw new Error(`UNSUPPORTED_ACTION: ${action}`)\n    })\n  },');
}

async function bytesOrNull(path) {
  try { return await readFile(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function assertNoLinks(path) {
  let cursor = resolve(path);
  while (true) {
    try { if ((await lstat(cursor)).isSymbolicLink()) throw Error('Linked target refused: ' + cursor); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

export async function prepare(root, stage) {
  const worker = await readFile(join(root, 'tools/letta_worker.ts'), 'utf8');
  const runtime = await readFile(join(root, 'tools/agent_runtime.ts'), 'utf8');
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  const rule = await readFile(join(root, 'rules/shared-development-preflight.mdc'), 'utf8');
  const skill = await readFile(join(root, 'skills/agent-runtime-usage/SKILL.md'), 'utf8');
  let newRule = normalize(rule);
  if (!newRule.includes('## Current runtime contract')) newRule = replaceOnce(newRule,
    'Letta Runtime 對有寫入權的 Project 仍可能自動產生內部稽核 receipt；**這不是 QA 派工、發布許可或日常新待辦**。',
    'Letta 一般 run 僅做唯讀開發情境檢查，不自動建立稽核 receipt；既有歷史 receipt 不是 QA 派工、發布許可或日常新待辦。') +
    '\n## Current runtime contract — 2026-10-28.1\n\n' +
    '- Existing task/TODO records own acceptance and the next approved action. Use optional `task_ref` to identify the same work item.\n' +
    '- `state=completed` means this operation ended. `delivery.state=not_evaluated` is not product acceptance; check actual evidence and update the existing task.\n' +
    '- Follow `next_move` for polling or reconciliation. It never authorizes retries, creates a new task, or replaces repository release gates.\n' +
    '- Current runtime README and this rule supersede older POC engine/QA descriptions; preserve historical evidence without promoting it into current policy.\n';
  newRule = newRule.replaceAll('2026-10-28.1', POLICY_VERSION);
  let newSkill = normalize(skill);
  if (!newSkill.includes('## Current policy and delivery contract')) newSkill += '\n## Current policy and delivery contract\n\n' +
    'Policy `2026-10-28.1`: read the installed `rules/shared-development-preflight.mdc` and current runtime README. Older Phase 2/3/4 descriptions are historical.\n\n' +
    'Normal runs inspect context without creating audit receipts. Pass optional `task_ref` for the existing task; poll the accepted operation, distinguish operation completion from unevaluated delivery, then check actual acceptance and continue the same authorized task. `next_move` is guidance, never retry/deploy permission.\n';
  newSkill = newSkill.replaceAll('2026-10-28.1', POLICY_VERSION)
    .replaceAll('shell_policy_version=1', 'shell_policy_version=2')
    .replaceAll('shell policy v1', 'shell policy v2');
  const history = await bytesOrNull(join(root, 'docs/history/runtime-before-20261028.md'));
  const contents = new Map([
    ['tools/runtime_maintenance.mjs', await readFile(join(here, 'runtime_maintenance.mjs'), 'utf8')],
    ['tools/runtime_contract.ts', await readFile(join(here, 'runtime_contract.ts'), 'utf8')],
    ['tools/letta_worker.ts', patchWorker(worker)], ['tools/agent_runtime.ts', patchRuntime(runtime)],
    ['docs/history/runtime-before-20261028.md', history ?? '# Historical runtime notes — superseded 2026-10-28\n\nFor current behavior read ../../README.md and ../../rules/shared-development-preflight.mdc.\nThese dated notes do not establish current permissions or blockers.\n\n' + readme],
    ['README.md', await readFile(join(here, 'CURRENT_RUNTIME.md'), 'utf8')],
    ['rules/shared-development-preflight.mdc', newRule], ['skills/agent-runtime-usage/SKILL.md', newSkill],
  ]);
  await mkdir(stage, { recursive: true });
  const manifest = { version: 2, policyVersion: POLICY_VERSION, targetRoot: resolve(root),
    requiresOfflineBootstrap: !worker.includes('withRuntimeActivity') || !runtime.includes('withRuntimeActivity'), files: [] };
  for (const [relative, content] of contents) {
    const previous = await bytesOrNull(join(root, relative));
    const candidate = Buffer.from(content);
    for (const folder of ['candidate', 'before']) await mkdir(dirname(join(stage, folder, relative)), { recursive: true });
    await writeFile(join(stage, 'candidate', relative), candidate);
    if (previous) await writeFile(join(stage, 'before', relative), previous);
    manifest.files.push({ path: relative, before: previous ? sha(previous) : null, after: sha(candidate) });
  }
  await writeFile(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

function validateManifest(root, manifest) {
  if (manifest.version !== 2 || manifest.policyVersion !== POLICY_VERSION || manifest.targetRoot !== resolve(root) ||
      JSON.stringify(manifest.files.map(file => file.path)) !== JSON.stringify(targets) ||
      manifest.files.some(file => (file.before !== null && !/^[a-f0-9]{64}$/.test(file.before)) || !/^[a-f0-9]{64}$/.test(file.after))) {
    throw Error('Manifest target mismatch');
  }
}

async function assertNoOperations(root) {
  const operations = JSON.parse((await bytesOrNull(join(root, 'operations.json'))) ?? '{}');
  if (Object.values(operations).some(item => item?.state === 'running')) throw Error('Runtime has running operations; wait for them, do not interrupt');
}

// The old facade does not participate in maintenance admission. The first
// migration therefore requires this host's managed MCP to be verifiably stopped.
async function assertBootstrapOffline(root) {
  const headless = dirname(dirname(root));
  const pm2Home = join(headless, 'pm2');
  const daemonPid = Number((await readFile(join(pm2Home, 'pm2.pid'), 'utf8')).trim());
  if (!Number.isSafeInteger(daemonPid) || daemonPid <= 0) throw Error('PM2_DAEMON_UNVERIFIED');
  process.kill(daemonPid, 0);
  const { stdout } = await promisify(execFile)(process.execPath,
    [join(headless, 'node_modules/pm2/bin/pm2'), 'jlist'],
    { env: { ...process.env, PM2_HOME: pm2Home }, windowsHide: true, timeout: 15000 });
  const apps = JSON.parse(stdout);
  const mcp = apps.filter(app => app.name === 'openchatx-mcp');
  if (mcp.length !== 1 || mcp[0].pm2_env?.status !== 'stopped' || mcp[0].pid > 0) throw Error('OFFLINE_BOOTSTRAP_REQUIRED: stop openchatx-mcp first');
  // Prevent the scheduled health watcher from restarting the legacy process.
  await lstat(join(headless, 'health-watch.paused'));
}

async function restore(root, backup, manifest, renameFile = rename) {
  const errors = [];
  for (const file of [...manifest.files].reverse()) {
    const path = join(root, file.path);
    try {
      await assertNoLinks(path);
      const current = await bytesOrNull(path), currentHash = current === null ? null : sha(current);
      if (currentHash === file.before) continue;
      if (currentHash !== file.after) throw Error('concurrent change preserved');
      if (file.before === null) { await unlink(path); continue; }
      const original = await readFile(join(backup, file.path));
      if (sha(original) !== file.before) throw Error('backup hash mismatch');
      const temporary = path + '.restore-' + randomUUID();
      try { await writeFile(temporary, original, { flag: 'wx' }); await renameFile(temporary, path); }
      finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    } catch (error) { errors.push(`${file.path}: ${error.message}`); }
  }
  return errors;
}

export async function apply(root, stage, { renameFile = rename, verifyInstalled = verify } = {}) {
  const manifest = JSON.parse(await readFile(join(stage, 'manifest.json'), 'utf8'));
  validateManifest(root, manifest);
  const release = await acquireRuntimeMaintenance(root);
  const pending = join(root, RECOVERY_FILE);
  const temporaryFiles = [];
  let backup, journaled = false;
  try {
    await assertNoOperations(root);
    if (manifest.requiresOfflineBootstrap) await assertBootstrapOffline(root);
    const prepared = [];
    for (const file of manifest.files) {
      await assertNoLinks(join(root, file.path));
      const before = await bytesOrNull(join(root, file.path));
      if ((before === null ? null : sha(before)) !== file.before) throw Error('Source changed since prepare: ' + file.path);
      const candidate = await readFile(join(stage, 'candidate', file.path));
      if (sha(candidate) !== file.after) throw Error('Candidate hash mismatch: ' + file.path);
      prepared.push({ ...file, beforeBytes: before, candidate });
    }
    backup = join(root, 'backups', 'lean-runtime-' + new Date().toISOString().replaceAll(/[:.]/g, '-') + '-' + randomUUID());
    await assertNoLinks(backup);
    await mkdir(backup, { recursive: true });
    await writeFile(join(backup, 'manifest.json'), JSON.stringify(manifest, null, 2));
    for (const file of prepared) {
      if (file.before !== null) {
        await mkdir(dirname(join(backup, file.path)), { recursive: true });
        await writeFile(join(backup, file.path), file.beforeBytes, { flag: 'wx' });
      }
      const path = join(root, file.path);
      await mkdir(dirname(path), { recursive: true });
      const temporary = path + '.update-' + randomUUID();
      temporaryFiles.push(temporary);
      await writeFile(temporary, file.candidate, { flag: 'wx' });
      file.temporary = temporary;
    }
    await writeFile(pending, JSON.stringify({ version: 1, backup }), { flag: 'wx' });
    journaled = true;
    for (const file of prepared) {
      const path = join(root, file.path), current = await bytesOrNull(path);
      if ((current === null ? null : sha(current)) !== file.before) throw Error('Concurrent edit detected: ' + file.path);
      await renameFile(file.temporary, path);
    }
    const result = await verifyInstalled(root, stage);
    await unlink(pending);
    journaled = false;
    return { backup, ...result };
  } catch (error) {
    if (journaled) {
      const failures = await restore(root, backup, manifest, renameFile);
      if (failures.length) throw new Error(`UPDATE_FAILED_RECOVERY_REQUIRED: ${error.message}; ${failures.join('; ')}; backup=${backup}`, { cause: error });
      await unlink(pending);
      throw new Error(`UPDATE_FAILED_ROLLED_BACK: ${error.message}; backup=${backup}`, { cause: error });
    }
    throw error;
  } finally {
    try {
      for (const path of temporaryFiles) await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    } finally { await release(); }
  }
}

export async function recover(root) {
  const release = await acquireRuntimeMaintenance(root, { recovery: true });
  try {
    await assertNoOperations(root);
    const pending = join(root, RECOVERY_FILE);
    const journal = JSON.parse(await readFile(pending, 'utf8'));
    const backup = resolve(journal.backup);
    if (journal.version !== 1 || dirname(backup) !== resolve(root, 'backups')) throw Error('Recovery path mismatch');
    await assertNoLinks(backup);
    const manifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8'));
    validateManifest(root, manifest);
    if (manifest.requiresOfflineBootstrap) await assertBootstrapOffline(root);
    const failures = await restore(root, backup, manifest);
    if (failures.length) throw Error('RECOVERY_INCOMPLETE: ' + failures.join('; '));
    await unlink(pending);
    return { recovered: true, backup };
  } finally { await release(); }
}

export async function verify(root, stage) {
  const manifest = JSON.parse(await readFile(join(stage, 'manifest.json'), 'utf8'));
  validateManifest(root, manifest);
  for (const file of manifest.files) {
    if (sha(await readFile(join(root, file.path))) !== file.after) throw Error('Installed hash mismatch: ' + file.path);
  }
  return { verified: manifest.files.length, policyVersion: manifest.policyVersion };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode = 'prepare', stageArg] = process.argv.slice(2);
  const root = join(homedir(), '.openchatx-mcp', 'headless', 'toolboxes', 'agent-runtime');
  const stage = stageArg ? resolve(stageArg) : join(here, '.candidate');
  const operation = { prepare, apply, verify, recover }[mode];
  if (!operation) throw Error('Expected prepare, apply, verify or recover');
  console.log(JSON.stringify(await operation(root, stage), null, 2));
}
