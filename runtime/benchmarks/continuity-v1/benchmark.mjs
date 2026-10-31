import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const [mode, runId, phase = '2'] = process.argv.slice(2);
if (!['prepare', 'grade'].includes(mode) || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(runId ?? '') || !['1', '2'].includes(phase))
  throw Error('Usage: benchmark.mjs prepare|grade <new-run-id> [1|2]');
const fixture = resolve(here, '../../../../Letta-POC/tests/runtime-continuity-v1', runId);
const taskPath = `tests/runtime-continuity-v1/${runId}`;
const hash = text => createHash('sha256').update(text).digest('hex');
const fixtures = {
  'src/pricing.mjs': `export function lineSubtotalCents(quantity, unitCents) {
  if (!Number.isInteger(quantity) || quantity < 1 || !Number.isInteger(unitCents) || unitCents < 0) throw new RangeError('invalid line');
  return (quantity - 1) * unitCents;
}
`,
  'src/invoice.mjs': `import { lineSubtotalCents } from './pricing.mjs';
export function invoiceTotalCents(lines, discountBps) {
  if (!Number.isInteger(discountBps) || discountBps < 0 || discountBps > 10000) throw new RangeError('invalid discount');
  const subtotal = lines.reduce((sum, line) => sum + lineSubtotalCents(line.quantity, line.unitCents), 0);
  return Math.round(subtotal - discountBps);
}
`,
  'tests/pricing.test.mjs': `import test from 'node:test';import assert from 'node:assert/strict';
import {lineSubtotalCents} from '../src/pricing.mjs';
test('exact positive quantities including zero-price items',()=>{assert.equal(lineSubtotalCents(3,125),375);assert.equal(lineSubtotalCents(1,0),0);});
test('reject invalid line inputs',()=>{for(const [q,p] of [[0,100],[-1,100],[1.5,100],[1,-1],[1,1.2]])assert.throws(()=>lineSubtotalCents(q,p),RangeError);});
`,
  'tests/invoice.test.mjs': `import test from 'node:test';import assert from 'node:assert/strict';
import {invoiceTotalCents} from '../src/invoice.mjs';
test('apply basis points to the aggregate subtotal',()=>{const lines=[{quantity:2,unitCents:100},{quantity:1,unitCents:200}];assert.equal(invoiceTotalCents(lines,1250),350);assert.equal(invoiceTotalCents(lines,0),400);assert.equal(invoiceTotalCents(lines,10000),0);});
test('round once after aggregation, never per line',()=>{assert.equal(invoiceTotalCents([{quantity:1,unitCents:1},{quantity:1,unitCents:1}],5000),1);assert.equal(invoiceTotalCents([],5000),0);});
test('invalid discounts and invalid lines remain rejected',()=>{for(const bps of [-1,10001,0.5])assert.throws(()=>invoiceTotalCents([],bps),RangeError);assert.throws(()=>invoiceTotalCents([{quantity:0,unitCents:1}],0),RangeError);});
`,
  'UNCHANGED.txt': 'continuity-fixture: preserve these exact bytes\n',
  'TASK.md': `# Existing task: invoice calculation

Goal: repair two existing modules without changing their exports or adding dependencies.
Approved decisions: quantities are positive integers; prices are nonnegative integer cents.
Discounts are integer basis points from 0 to 10000. Apply the discount to the aggregate
subtotal and round once at the end, never per line. Keep all input validation.

Allowed writes: src/pricing.mjs, src/invoice.mjs, TASK.md and an identical rewrite of UNCHANGED.txt.
Tests and all other files are immutable. No new files, Agents, indexing, dependencies or deployment.

Phase 1 ONLY:
1. Read this task and current source.
2. As an intentional diagnostic, call openchatx_read_file once on the existing directory
   ${taskPath}/src. A NOT_A_FILE (or EISDIR) execution failure is expected; do not retry or modify the directory.
   Record it as the expected negative probe, not a product blocker.
3. Fix only src/pricing.mjs. Leave src/invoice.mjs for phase 2.
4. Rewrite UNCHANGED.txt with the exact same bytes using openchatx_write_file once.
   This verifies that an unchanged write is not listed as a changed file.
5. Run node --test --test-concurrency=1 ${taskPath}/tests/pricing.test.mjs from the Project root.
6. Update this existing TASK.md with completed work, exact validation, expected probe failure,
   approved decisions and the next remaining action. Preserve these requirements. Then stop.

Phase 2, only after the resume request:
Reread this task and current files. Fix only src/invoice.mjs; leave the already verified
pricing module unchanged. Run both test files with one test worker. Update this existing
task with actual evidence and remaining work, without inventing acceptance or publication.
`,
};
await mkdir(join(here, 'runs'), { recursive: true });
const recordPath = join(here, 'runs', runId + '.initial.json');
const tests = selected => {
  const files = selected === '1' ? ['tests/pricing.test.mjs'] : ['tests/pricing.test.mjs', 'tests/invoice.test.mjs'];
  const result = spawnSync(process.execPath, ['--max-old-space-size=256', '--test', '--test-concurrency=1', ...files],
    { cwd: fixture, timeout: 15000, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  return { exitCode: result.status, output: result.stdout + result.stderr };
};
if (mode === 'prepare') {
  await mkdir(fixture, { recursive: false });
  for (const [name, text] of Object.entries(fixtures)) {
    await mkdir(dirname(join(fixture, name)), { recursive: true });
    await writeFile(join(fixture, name), text, { flag: 'wx' });
  }
  const initial = tests('2'); assert.equal(initial.exitCode, 1);
  const record = { fixture, taskPath, files: Object.fromEntries(Object.entries(fixtures).map(([p, text]) => [p, hash(text)])), initial };
  await writeFile(recordPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ fixture, taskPath, initialExit: initial.exitCode }));
} else {
  const initial = JSON.parse(await readFile(recordPath, 'utf8'));
  const walk = async dir => (await Promise.all((await readdir(dir, { withFileTypes: true })).map(async entry =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]))).flat();
  const observed = (await walk(fixture)).map(p => p.slice(fixture.length + 1).replaceAll('\\', '/')).sort();
  assert.deepEqual(observed, Object.keys(initial.files).sort(), 'Unexpected files');
  const hashes = Object.fromEntries(await Promise.all(observed.map(async p => [p, hash(await readFile(join(fixture, p)))])));
  for (const p of ['tests/pricing.test.mjs', 'tests/invoice.test.mjs', 'UNCHANGED.txt'])
    assert.equal(hashes[p], initial.files[p], 'Immutable file changed: ' + p);
  if (phase === '1') assert.equal(hashes['src/invoice.mjs'], initial.files['src/invoice.mjs'], 'Phase 2 started early');
  else {
    const prior = JSON.parse(await readFile(join(here, 'runs', runId + '.phase1.json'), 'utf8'));
    assert.equal(hashes['src/pricing.mjs'], prior.hashes['src/pricing.mjs'], 'Completed phase 1 code changed after compaction');
  }
  const result = tests(phase); assert.equal(result.exitCode, 0, result.output);
  const record = { phase, observedAt: new Date().toISOString(), hashes, result };
  await writeFile(join(here, 'runs', runId + '.phase' + phase + '.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify(record));
}
