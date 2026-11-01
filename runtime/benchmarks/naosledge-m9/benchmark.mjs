import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, cp, copyFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../../Naosledge');
const run = join(here, '.cache/run-20261101');
const candidate = join(run, 'candidate');
const reference = join(run, 'reference');
const before = '707c856541f7806a2bad816b2d365f2203564b0e';
const after = '2476363cbcf60f00076b358bf2ba53c6dbb841c3';
const mutable = ['lib/obsidian-m9-signed-auto-cycle.ts', 'lib/obsidian-m9-windows-auto-agent.ts'];
const tests = ['tests/obsidian-m9-signed-auto-cycle.test.mjs', 'tests/obsidian-m9-windows-auto-agent.test.mjs'];
const staticInputs = ['app/vault/sync/page.tsx', 'scripts/obsidian-m8-windows-readonly-agent.ts', 'scripts/obsidian-m8-windows-native-replace.ps1'];
const sha = data => createHash('sha256').update(data).digest('hex');
const git = args => execFileSync('git', ['-C', repo, ...args], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
async function inventory(root, prefix = '') {
  const result = {};
  for (const row of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${row.name}` : row.name;
    if (row.isSymbolicLink()) throw Error('Unexpected link');
    if (row.isDirectory()) Object.assign(result, await inventory(root, name));
    else result[name] = sha(await readFile(join(root, name)));
  }
  return result;
}
function check(root) {
  const proc = spawnSync(process.execPath, ['--import', './offline-only.mjs', '--max-old-space-size=256', '--test', '--test-concurrency=1', ...tests], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024,
  });
  return { exitCode: proc.status, error: proc.error?.message ?? null, output: proc.stdout + proc.stderr };
}
async function dependencies() {
  const seen = new Set();
  async function copy(name) {
    if (seen.has(name)) return;
    seen.add(name);
    const source = join(repo, 'node_modules', name);
    const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
    await cp(source, join(run, 'node_modules', name), { recursive: true, errorOnExist: false, force: false });
    for (const dependency of Object.keys(pkg.dependencies ?? {})) await copy(dependency);
  }
  for (const name of ['unified', 'remark-parse', 'remark-gfm']) await copy(name);
  return [...seen];
}
if (process.argv[2] === 'prepare') {
  await mkdir(dirname(run), { recursive: true });
  await mkdir(run, { recursive: false });
  await dependencies();
  const initialFiles = git(['ls-tree', '-r', '--name-only', before, 'lib']).toString().trim().split(/\r?\n/);
  for (const [root, revision] of [[candidate, before], [reference, after]]) {
    for (const name of [...initialFiles, ...tests, ...staticInputs]) {
      await mkdir(dirname(join(root, name)), { recursive: true });
      await writeFile(join(root, name), git(['show', `${tests.includes(name) ? after : revision}:${name}`]));
    }
    await writeFile(join(root, 'package.json'), '{"type":"module","private":true}\n');
    await writeFile(join(root, 'offline-only.mjs'), 'globalThis.fetch = async () => { throw new Error("BENCHMARK_NETWORK_DISABLED"); };\n');
    await writeFile(join(root, 'AGENTS.md'), '# Isolated Naosledge historical repair\n\nRead TASK.md. Use one Developer and only this Project root. No real Vault, database, credentials, deployment, Git history or network. Tests use synthetic owners and fake transports. This is a historical replay, not new production delivery.\n');
    await writeFile(join(root, 'TASK.md'), '# M9 crash-recovery regression replay\n\nRepair the historical M9 defect: an interrupted transfer can lose the in-memory uncertain-write flag before a durable review latch exists. No mutating request may begin if the asynchronous pre-write latch fails. A pending transfer must already have a durable latch, and only a verified completed transfer may clear the owned latch. Preserve one-writer ownership, stop/drain behavior, signed baseline validation and all existing failure semantics.\n\nOnly edit lib/obsidian-m9-signed-auto-cycle.ts and lib/obsidian-m9-windows-auto-agent.ts. You may create/update PROGRESS.md as the sole handoff note. Tests, dependencies, TASK.md and other files are immutable. Do not inspect sibling reference material.\n\nRun from this root: `& \'C:/Program Files/nodejs/node.exe\' --import ./offline-only.mjs --max-old-space-size=256 --test --test-concurrency=1 tests/obsidian-m9-signed-auto-cycle.test.mjs tests/obsidian-m9-windows-auto-agent.test.mjs`\n\nAcceptance: both suites pass, no unrelated changes, actual outcomes documented. Operation completion alone is not acceptance. UI work is not applicable.\n');
    // This tool copy was explicitly authorized for the isolated acceptance.
    await mkdir(join(root, '.tools'));
    await copyFile(process.execPath, join(root, '.tools/node.exe'));
    const task = join(root, 'TASK.md');
    await writeFile(task, (await readFile(task, 'utf8')).replace("'C:/Program Files/nodejs/node.exe'", "'./.tools/node.exe'"));
  }
  const baseline = check(candidate), knownFix = check(reference);
  await writeFile(join(run, 'baseline.log'), baseline.output);
  await writeFile(join(run, 'reference.log'), knownFix.output);
  const record = { before: git(['rev-parse', before]).toString().trim(), after: git(['rev-parse', after]).toString().trim(),
    node: process.version, candidate, reference, mutable, tests, preparedAt: new Date().toISOString(),
    initial: await inventory(candidate), baseline: { ...baseline, output: undefined }, referenceResult: { ...knownFix, output: undefined } };
  await writeFile(join(run, 'initial.json'), JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ candidate, baseline: record.baseline, reference: record.referenceResult, files: Object.keys(record.initial).length }));
  if (baseline.exitCode !== 1 || knownFix.exitCode !== 0 || baseline.error || knownFix.error) process.exitCode = 1;
} else if (process.argv[2] === 'setup-existing') {
  const packages = await dependencies();
  const record = JSON.parse(await readFile(join(run, 'initial.json'), 'utf8'));
  for (const [root, revision] of [[candidate, before], [reference, after]]) {
    for (const name of staticInputs) {
      await mkdir(dirname(join(root, name)), { recursive: true });
      await writeFile(join(root, name), git(['show', `${revision}:${name}`]));
    }
  }
  record.initial = await inventory(candidate);
  const baseline = check(candidate), knownFix = check(reference);
  await writeFile(join(run, 'baseline-ready.log'), baseline.output);
  await writeFile(join(run, 'reference-ready.log'), knownFix.output);
  record.baseline = { ...baseline, output: undefined };
  record.referenceResult = { ...knownFix, output: undefined };
  record.dependencyPackages = packages;
  await writeFile(join(run, 'initial.json'), JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ baseline: record.baseline, reference: record.referenceResult, dependencyPackages: packages.length }));
  if (baseline.exitCode !== 1 || knownFix.exitCode !== 0 || baseline.error || knownFix.error) process.exitCode = 1;
} else if (process.argv[2] === 'grade') {
  const record = JSON.parse(await readFile(join(run, 'initial.json'), 'utf8'));
  const current = await inventory(candidate);
  const changed = Object.keys(current).filter(name => current[name] !== record.initial[name]);
  const removed = Object.keys(record.initial).filter(name => !(name in current));
  const unexpected = changed.filter(name => !mutable.includes(name) && name !== 'PROGRESS.md');
  const result = check(candidate);
  await writeFile(join(run, 'final.log'), result.output);
  const grade = { gradedAt: new Date().toISOString(), changed, removed, unexpected,
    ...result, output: undefined, passed: result.exitCode === 0 && !result.error && !removed.length && !unexpected.length };
  await writeFile(join(run, 'grade.json'), JSON.stringify(grade, null, 2));
  console.log(JSON.stringify(grade));
  if (!grade.passed) process.exitCode = 1;
} else throw Error('Use prepare or grade');
