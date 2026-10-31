import { readFile, writeFile, mkdir, rename, lstat, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { acquireRuntimeMaintenance, RECOVERY_FILE } from './runtime_maintenance.mjs';
import { patchModelWorker, patchModelRuntime } from './model-observation-patch.mjs';
import { patchRoutingWorker, patchRoutingRuntime, patchRoutingGuidance } from './model-routing-patch.mjs';
import { patchStoppedReconciliation } from './stopped-reconciliation-patch.mjs';
import { patchInflightRecovery } from './inflight-recovery-patch.mjs';
import { patchBackendOrphanWorker, patchBackendOrphanRuntime } from './backend-orphan-patch.mjs';
import { patchContextWorker, patchContextRuntime, patchContextGuidance } from './context-paths-patch.mjs';
import { patchToolEvidenceWorker, patchEvidenceGuidance } from './tool-evidence-patch.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const targets = [
  'tools/runtime_maintenance.mjs',
  'tools/runtime_readiness.mjs', 'tools/operation_reconciliation.mjs',
  'tools/external_tool_idempotency.ts',
  'tools/development_preflight.ts',
  'tools/runtime_contract.ts', 'tools/model_routing.mjs', 'tools/tool_evidence.mjs', 'tools/letta_worker.ts', 'tools/agent_runtime.ts', 'tools/agent_capabilities.ts',
  'docs/history/runtime-before-20261028.md', 'README.md',
  'rules/shared-development-preflight.mdc', 'skills/agent-runtime-usage/SKILL.md',
];
export const POLICY_VERSION = '2026-10-28.3';
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

function patchWorkerBase(original) {
  let text = normalize(original);
  if (!text.includes('prepareWorkerRunContext')) text = patchLegacyWorker(text);
  if (!text.includes('withRuntimeActivity')) {
    text = replaceOnce(text, 'import { join, resolve } from "node:path"', 'import { dirname, join, resolve } from "node:path"');
    text = 'import { withRuntimeActivity } from "./runtime_maintenance.mjs"\n' + text;
    text = replaceOnce(text, '  void workerMain().catch((error) => {',
      '  void withRuntimeActivity(dirname(dirname(modulePath)), workerMain).catch((error) => {');
  }
  if (text.includes('client_message_id: clientMessageId,\n          idempotency: summarizeRunTrace')) return text;
  text = replaceOnce(text, '          kind: "LETTA_TURN_TIMEOUT_DIAGNOSTIC",',
    '          kind: "LETTA_TURN_TIMEOUT_DIAGNOSTIC",\n' +
    '          client_message_id: clientMessageId,\n' +
    '          idempotency: summarizeRunTrace({ external_tool_calls: externalCalls }).validation.idempotency,');
  return replaceOnce(text, '          kind: "LETTA_TIMEOUT_RECOVERY",',
    '          kind: "LETTA_TIMEOUT_RECOVERY",\n' +
    '          clientMessageId,\n          conversationId: conversation.conversationId,');
}

function patchRuntimeBase(original) {
  let text = normalize(original);
  if (!text.includes('normalizeTaskRef')) text = patchLegacyRuntime(text);
  if (!text.includes('withRuntimeActivity')) {
  text = replaceOnce(text, 'const execFileAsync = promisify(execFile)',
    'const maintenanceUrl = new URL("./runtime_maintenance.mjs", import.meta.url)\n' +
    'maintenanceUrl.searchParams.set("source_mtime", String((await fs.stat(fileURLToPath(maintenanceUrl))).mtimeMs))\n' +
    'const { withRuntimeActivity } = await import(maintenanceUrl.href)\n\n' +
    'const execFileAsync = promisify(execFile)');
  text = replaceOnce(text, '  }) {\n    const config = await ensureConfig()',
    '  }) {\n    return withRuntimeActivity(TOOLBOX_ROOT, async () => {\n    const config = await ensureConfig()');
  text = replaceOnce(text, '    throw new Error(`UNSUPPORTED_ACTION: ${action}`)\n  },',
    '    throw new Error(`UNSUPPORTED_ACTION: ${action}`)\n    })\n  },');
  }
  if (text.includes('summarizeReconciliation')) return text;
  text = replaceOnce(text, 'const execFileAsync = promisify(execFile)',
    'const reconciliationUrl = new URL("./operation_reconciliation.mjs", import.meta.url)\n' +
    'reconciliationUrl.searchParams.set("source_mtime", String((await fs.stat(fileURLToPath(reconciliationUrl))).mtimeMs))\n' +
    'const { summarizeReconciliation, retainUnresolvedOperation } = await import(reconciliationUrl.href)\n\n' +
    'const execFileAsync = promisify(execFile)');
  text = replaceOnce(text, '  taskRef?: string | null\n\n  state: OperationState',
    '  taskRef?: string | null\n  reconciliation?: Record<string, any>\n\n  state: OperationState');
  text = replaceOnce(text, '    if (operation.projectId === "openchatx-qa-reviewer") {',
    '    if (operation.engine === "letta") {\n' +
    '      try {\n' +
    '        const output = await readText(operation.stdoutPath)\n' +
    '        const parsed = output.trim() ? parseLettaWorkerOutput(output) : {}\n' +
    '        if (retainUnresolvedOperation(operation, parsed, await readText(operation.stderrPath))) continue\n' +
    '      } catch { continue } // Missing/invalid evidence must not be pruned.\n' +
    '    }\n' +
    '    if (operation.projectId === "openchatx-qa-reviewer") {');
  text = replaceOnce(text, '    if (Object.keys(operationPatch).length > 0) {',
    '    operationPatch.reconciliation = summarizeReconciliation(\n' +
    '      { ...operation, ...operationPatch }, parsed, stderr,\n' +
    '    )\n' +
    '    if (Object.keys(operationPatch).length > 0) {');
  text = replaceOnce(text, '    if (operation.inputPath) {\n      await fs.rm(operation.inputPath, { force: true })\n    }',
    '    if (operation.inputPath && !operation.reconciliation?.requiresReconciliation) {\n' +
    '      await fs.rm(operation.inputPath, { force: true })\n    }');
  return replaceOnce(text, '      stalePoll: !sessionUpdate.current,',
    '      stalePoll: !sessionUpdate.current,\n      reconciliation: operation.reconciliation,');
}

export function patchWorker(original) { return patchBackendOrphanWorker(patchInflightRecovery(patchToolEvidenceWorker(patchContextWorker(patchRoutingWorker(patchModelWorker(patchWorkerBase(original))))))); }
export function patchRuntime(original) { return patchDispatchReconciliation(patchBackendOrphanRuntime(patchStoppedReconciliation(patchContextRuntime(patchRoutingRuntime(patchModelRuntime(patchRuntimeBase(original))))))); }

export function patchDispatchReconciliation(text) {
  if (text.includes('assertNoUnresolvedToolEffects')) return text;
  text = replaceOnce(text, 'describeReadOnlyBackendConflict }',
    'describeReadOnlyBackendConflict, assertNoUnresolvedToolEffects }');
  text = replaceOnce(text,
    '  const { project, projectState, session, prompt, config, timeoutMs, taskRef, modelSelection, contextPaths } = args\n',
    '  const { project, projectState, session, prompt, config, timeoutMs, taskRef, modelSelection, contextPaths } = args\n' +
    '  assertNoUnresolvedToolEffects(Object.values(await readOperations()), project.id, session.name, session.sessionId)\n');
  text = replaceOnce(text,
    '  // caller must not pass the active-run check before the first worker is stored.\n  return withOperationsLock(async () => {\n    const operations = await readOperations()\n',
    '  // caller must not pass the active-run check before the first worker is stored.\n  return withOperationsLock(async () => {\n    const operations = await readOperations()\n' +
    '    assertNoUnresolvedToolEffects(Object.values(operations), project.id, session.name, session.sessionId)\n');
  return replaceOnce(text,
    '  const operations = await readOperations()\n  const running = Object.values(operations).find(',
    '  const operations = await readOperations()\n' +
    '  assertNoUnresolvedToolEffects(Object.values(operations), project.id, session.name, session.sessionId)\n' +
    '  const running = Object.values(operations).find(');
}

export function patchCapabilities(original, candidate) {
  if (normalize(original) === normalize(candidate)) return candidate;
  if (!['19cf235bbaec0e5767b78a83f93acfd851fa0b5480746abc563f61b0e217933d', 'b0c33d5282afb2963190fdbd5c903c1dae88b7b55d351fb6624f1eb1709da96c', '449d1a75102ea1879227018ac340be5617736f1e2839be67d5758c0c15afbdc0'].includes(sha(original)))
    throw Error('CAPABILITY_SOURCE_CHANGED: inspect the installed source before preparing this update');
  return candidate;
}

export function patchPreflight(original, candidate) {
  if (normalize(original) === normalize(candidate)) return candidate;
  if (sha(original) !== '161bafad4a438e89e93cc2f53c740f68a5a022a98315c5fa83aaacd7a35578db')
    throw Error('PREFLIGHT_SOURCE_CHANGED: inspect the installed entrypoint before updating');
  return candidate;
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
  const preflight = patchPreflight(await readFile(join(root, 'tools/development_preflight.ts'), 'utf8'),
    await readFile(join(here, 'source/development_preflight.ts'), 'utf8'));
  const idempotency = normalize(await readFile(join(here, 'source/external_tool_idempotency.ts'), 'utf8'));
  if (normalize(await readFile(join(root, 'tools/external_tool_idempotency.ts'), 'utf8')) !== idempotency)
    throw Error('IDEMPOTENCY_SOURCE_CHANGED: preserve the installed change and review it before updating');
  let newRule = normalize(rule);
  if (!newRule.includes('## Current runtime contract')) newRule = replaceOnce(newRule,
    'Letta Runtime 對有寫入權的 Project 仍可能自動產生內部稽核 receipt；**這不是 QA 派工、發布許可或日常新待辦**。',
    'Letta 一般 run 僅做唯讀開發情境檢查，不自動建立稽核 receipt；既有歷史 receipt 不是 QA 派工、發布許可或日常新待辦。') +
    '\n## Current runtime contract — 2026-10-28.1\n\n' +
    '- Existing task/TODO records own acceptance and the next approved action. Use optional `task_ref` to identify the same work item.\n' +
    '- `state=completed` means this operation ended. `delivery.state=not_evaluated` is not product acceptance; check actual evidence and update the existing task.\n' +
    '- Follow `next_move` for polling or reconciliation. It never authorizes retries, creates a new task, or replaces repository release gates.\n' +
    '- Current runtime README and this rule supersede older POC engine/QA descriptions; preserve historical evidence without promoting it into current policy.\n';
  newRule = newRule.replace(/2026-10-28\.[12]/g, POLICY_VERSION);
  let newSkill = normalize(skill);
  if (!newSkill.includes('## Current policy and delivery contract')) newSkill += '\n## Current policy and delivery contract\n\n' +
    'Policy `2026-10-28.1`: read the installed `rules/shared-development-preflight.mdc` and current runtime README. Older Phase 2/3/4 descriptions are historical.\n\n' +
    'Normal runs inspect context without creating audit receipts. Pass optional `task_ref` for the existing task; poll the accepted operation, distinguish operation completion from unevaluated delivery, then check actual acceptance and continue the same authorized task. `next_move` is guidance, never retry/deploy permission.\n';
  newSkill = newSkill.replace(/2026-10-28\.[12]/g, POLICY_VERSION)
    .replaceAll('shell_policy_version=1', 'shell_policy_version=2')
    .replaceAll('shell policy v1', 'shell policy v2');
  newRule = patchEvidenceGuidance(patchContextGuidance(patchRoutingGuidance(newRule)));
  newSkill = patchEvidenceGuidance(patchContextGuidance(patchRoutingGuidance(newSkill)));
  const history = await bytesOrNull(join(root, 'docs/history/runtime-before-20261028.md'));
  const contents = new Map([
    ['tools/runtime_maintenance.mjs', await readFile(join(here, 'runtime_maintenance.mjs'), 'utf8')],
    ['tools/runtime_readiness.mjs', await readFile(join(here, 'runtime_readiness.mjs'), 'utf8')],
    ['tools/operation_reconciliation.mjs', await readFile(join(here, 'operation_reconciliation.mjs'), 'utf8')],
    ['tools/external_tool_idempotency.ts', idempotency],
    ['tools/development_preflight.ts', preflight],
    ['tools/runtime_contract.ts', await readFile(join(here, 'runtime_contract.ts'), 'utf8')],
    ['tools/model_routing.mjs', await readFile(join(here, 'model_routing.mjs'), 'utf8')],
    ['tools/tool_evidence.mjs', await readFile(join(here, 'tool_evidence.mjs'), 'utf8')],
    ['tools/letta_worker.ts', patchWorker(worker)], ['tools/agent_runtime.ts', patchRuntime(runtime)],
    ['tools/agent_capabilities.ts', patchCapabilities(await readFile(join(root, 'tools/agent_capabilities.ts'), 'utf8'), await readFile(join(here, 'source/agent_capabilities.ts'), 'utf8'))],
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
