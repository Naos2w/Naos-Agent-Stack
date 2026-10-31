import { mkdir, readdir, readFile, writeFile, cp } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const [mode, runId] = process.argv.slice(2);
if (!['prepare', 'grade'].includes(mode) || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(runId || ''))
  throw Error('Usage: node benchmark.mjs prepare|grade <lowercase-run-id>');
const project = resolve(here, '../../../../Letta-POC');
const root = join(project, 'tests/agent-development-benchmark-v1', runId);
const cases = [
  { id: 'range', editable: ['src/range.mjs'], requirement: 'sumInclusive must sum both inclusive integer endpoints, including negative values and a single point. Throw RangeError for non-integer, non-finite or reversed bounds.' },
  { id: 'cache', editable: ['src/cache.mjs'], requirement: 'Concurrent same-key callers must share one load; successful values stay cached, including zero. A synchronous or asynchronous loader failure must reject the callers and allow a later retry for that key. Keep other cached keys intact.' },
  { id: 'invoice', editable: ['src/total.mjs'], requirement: 'Repair invoiceTotal using the existing normalizeInvoice public contract. Sum unitCents times quantity, subtract discountCents, floor the total at zero and preserve the input. The normalized contract must remain unchanged.' },
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function inventory(folder, prefix = '') {
  const result = {};
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isSymbolicLink()) throw Error('BENCHMARK_LINK_REFUSED');
    if (entry.isDirectory()) Object.assign(result, await inventory(join(folder, entry.name), relative + '/'));
    else if (entry.isFile()) result[relative] = sha(await readFile(join(folder, entry.name)));
    else throw Error('BENCHMARK_NON_REGULAR_FILE');
  }
  return result;
}
function gradeCase(id) {
  const started = performance.now();
  const result = spawnSync(process.execPath, ['--max-old-space-size=256', '--test', '--test-concurrency=1', 'acceptance.test.mjs'], {
    cwd: join(root, id), windowsHide: true, encoding: 'utf8', timeout: 15_000, maxBuffer: 128 * 1024,
  });
  return { exitCode: result.status, elapsedMs: Math.round(performance.now() - started),
    error: result.error?.code ?? null, output: (result.stdout || '') + (result.stderr || '') };
}
if (mode === 'prepare') {
  await mkdir(dirname(root), { recursive: true });
  await mkdir(root); // Never overwrite a prior attempt.
  for (const item of cases) await cp(join(here, 'fixtures', item.id), join(root, item.id), { recursive: true, errorOnExist: true, force: false });
  const task = '# Approved development benchmark v1\n\n' +
    'Only change the explicitly allowed source files below. Inspect source, run each existing test, fix the failure and rerun the tests. Do not modify tests, task text, manifests, configuration or unrelated project files. Do not add dependencies, publish, commit or contact external services. Report the actual test result for each case and any blocker.\n\n' +
    cases.map(item => '## ' + item.id + '\n\n' + item.requirement + '\n\nAllowed: ' + item.id + '/' + item.editable.join(', ') + '\n\nTest from this case directory: `node --max-old-space-size=256 --test --test-concurrency=1 acceptance.test.mjs`\n').join('\n');
  await writeFile(join(root, 'TASK.md'), task, { flag: 'wx' });
  const initial = await inventory(root);
  const baseline = Object.fromEntries(cases.map(item => [item.id, gradeCase(item.id)]));
  if (Object.values(baseline).some(result => result.exitCode !== 1 || result.error)) throw Error('BENCHMARK_EXPECTED_ASSERTION_FAILURE');
  const record = { version: 1, runId, root, preparedAt: new Date().toISOString(), initial, cases, baseline };
  await mkdir(join(here, 'runs'), { recursive: true });
  await writeFile(join(here, 'runs', runId + '.initial.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ root, baseline: Object.fromEntries(cases.map(item => [item.id, baseline[item.id].exitCode])) }));
} else {
  const record = JSON.parse(await readFile(join(here, 'runs', runId + '.initial.json'), 'utf8'));
  const current = await inventory(root);
  const editable = new Set(cases.flatMap(item => item.editable.map(file => item.id + '/' + file)));
  const immutableChanges = Object.keys(record.initial).filter(file => !editable.has(file) && current[file] !== record.initial[file]);
  const additions = Object.keys(current).filter(file => !(file in record.initial));
  const results = Object.fromEntries(cases.map(item => [item.id, gradeCase(item.id)]));
  const result = { version: 1, runId, gradedAt: new Date().toISOString(), immutableChanges, additions,
    completed: immutableChanges.length === 0 && additions.length === 0 && Object.values(results).every(value => value.exitCode === 0 && !value.error), results };
  await writeFile(join(here, 'runs', runId + '.grade.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (!result.completed) process.exitCode = 1;
}
