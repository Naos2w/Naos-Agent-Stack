import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { POLICY_VERSION, patchRuntime, patchWorker } from './lean-runtime/update-runtime.mjs';
const root=new URL('../',import.meta.url);
test('all repository rebuild overlays match their exact content locks and runtime policy', async () => {
  const lock=JSON.parse(await readFile(new URL('runtime/rebuild.lock.json',root),'utf8'));
  assert.equal(lock.schema,1);
  assert.equal(lock.runtimePolicy,POLICY_VERSION);
  assert.equal(lock.runtimeVersion,'1.0.0-beta.2');
  assert.match(lock.baseSha256,/^[A-F0-9]{64}$/);
  assert.equal(new Set(lock.overlays.map(item=>item.target)).size,lock.overlays.length);
  for(const item of lock.overlays){
    assert.doesNotMatch(item.source,/(^\/|\.\.|:)/);
    const bytes=await readFile(new URL(item.source,root));
    assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(),item.sha256,item.source);
    // Hashes must survive the repository's checkout line-ending rules.
    if(item.source.startsWith('runtime/')) assert.ok(!bytes.includes(Buffer.from('\r\n')),item.source+' must use LF');
    if(item.source==='payload/bootstrap/naos-agent-stack.ps1')
      assert.doesNotMatch(bytes.toString('utf8'),/(?<!\r)\n/,'bootstrap must retain CRLF');
  }
  const runtime=await readFile(new URL('runtime/lean-runtime/source/agent_runtime.ts',root),'utf8');
  const worker=await readFile(new URL('runtime/lean-runtime/source/letta_worker.ts',root),'utf8');
  assert.equal(patchRuntime(runtime),runtime);
  assert.equal(patchWorker(worker),worker);
});
