import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeContextPaths, prepareWorkerRunContext } from './runtime_contract.ts';
import { patchContextRuntime, patchContextWorker, patchContextGuidance } from './context-paths-patch.mjs';

test('context paths are bounded exact relative files, with stable normalization and deduplication',()=>{
  assert.deepEqual(normalizeContextPaths(),[]);
  assert.deepEqual(normalizeContextPaths(['src\\a.ts','./src/a.ts','SRC/A.ts','src/b.ts']),['src/a.ts','src/b.ts']);
  for(const input of ['x',null,[''],['../private'],['a/../private'],['C:\\private'],['/absolute'],['x:stream'],
    ['*.ts'],['dir/'],['a\n.ts'],['a//b.ts'],['.'],['x.'],['x '],['a'.repeat(513)],Array(17).fill('a.ts')])
    assert.throws(()=>normalizeContextPaths(input),/CONTEXT_PATH/);
});
test('worker forwards selected files to the existing inspection without adding receipts or tasks',async()=>{
  const calls=[],project={id:'fixture'};
  const result=await prepareWorkerRunContext(project,'  fix cache  ',async(...args)=>{
    calls.push(args);return {prompt:'existing',evidence:{codebase:{status:'verified'}}};
  },'existing-todo',['src\\cache.ts']);
  assert.deepEqual(calls,[[project,'fix cache',['src/cache.ts']]]);
  assert.deepEqual(result.contextPaths,['src/cache.ts']);
  assert.equal(result.evidence.codebase.status,'verified');
});
test('invalid context paths stop before context inspection',async()=>{
  await assert.rejects(prepareWorkerRunContext({},'task',()=>assert.fail('must not inspect'),undefined,['../private']),/CONTEXT_PATH/);
});
test('owned facade/worker migration is idempotent and retains optional exact-file guidance',async()=>{
  const runtime=await readFile(new URL('./source/agent_runtime.ts',import.meta.url),'utf8');
  const worker=await readFile(new URL('./source/letta_worker.ts',import.meta.url),'utf8');
  assert.equal(patchContextRuntime(runtime),runtime);assert.equal(patchContextWorker(worker),worker);
  const text=patchContextGuidance('existing policy');assert.equal(patchContextGuidance(text),text);
  assert.match(text,/omit when unknown/i);
});
