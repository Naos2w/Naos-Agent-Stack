import { readdir, readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import assert from 'node:assert/strict';
import { acquireRuntimeMaintenance } from './runtime_maintenance.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const source = join(homedir(), '.openchatx-mcp/headless');
const stage = join(here, '.test-stage');
const tools = join(stage, 'toolboxes/agent-runtime/tools');
await mkdir(tools, { recursive: true });
await mkdir(join(stage, 'codebase-index'), { recursive: true });
for (const name of await readdir(join(source, 'toolboxes/agent-runtime/tools'))) {
  if (/\.(ts|mjs)$/.test(name)) await copyFile(join(source, 'toolboxes/agent-runtime/tools', name), join(tools, name));
}
await copyFile(join(here, '.candidate/candidate/tools/runtime_maintenance.mjs'), join(tools, 'runtime_maintenance.mjs'));
for (const name of ['runtime_readiness.mjs', 'operation_reconciliation.mjs', 'model_routing.mjs', 'tool_evidence.mjs']) {
  await copyFile(join(here, '.candidate/candidate/tools', name), join(tools, name));
}
for (const name of ['letta_worker.ts', 'agent_runtime.ts', 'runtime_contract.ts', 'agent_capabilities.ts']) {
  const input = await readFile(join(here, '.candidate/candidate/tools', name), 'utf8');
  await writeFile(join(tools, name), input);
  const output = stripTypeScriptTypes(input, { mode: 'transform', sourceMap: false });
  const generated = join(tools, name.replace(/\.ts$/, '.candidate.mjs'));
  await writeFile(generated, output);
  const syntax = spawnSync(process.execPath, ['--check', generated], { encoding: 'utf8', windowsHide: true });
  if (syntax.status !== 0) throw Error(syntax.stderr || 'Syntax check failed');
}
const tests = ['letta-worker-entrypoint.test.mjs'];
for (const name of tests) await copyFile(join(source, 'codebase-index', name), join(stage, 'codebase-index', name));
const run = spawnSync(process.execPath, ['--test', ...tests.map(name => join(stage, 'codebase-index', name))], {
  encoding: 'utf8', timeout: 60_000, windowsHide: true,
});
process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');
if (run.error) throw run.error;
if (run.status !== 0) process.exitCode = run.status ?? 1;
else console.log('Candidate: TypeScript transform + JS syntax + existing worker entrypoint/recovery tests passed.');
const release = await acquireRuntimeMaintenance(dirname(tools));
try {
  const blocked = spawnSync(process.execPath, [join(tools, 'letta_worker.ts'), 'must-not-read-this-input.json'], {
    encoding: 'utf8', timeout: 15000, windowsHide: true,
  });
  assert.equal(blocked.status, 1, blocked.stderr);
  assert.match(JSON.parse(blocked.stdout).error, /RUNTIME_MAINTENANCE_BUSY/);
  console.log('Candidate: actual worker entrypoint refuses dispatch during maintenance.');
} finally { await release(); }
