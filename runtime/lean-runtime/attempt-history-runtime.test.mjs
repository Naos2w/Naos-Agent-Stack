import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, unlink } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarizeReconciliation, summarizeAttemptHistory } from './operation_reconciliation.mjs';

const source=await readFile(new URL('./source/agent_runtime.ts',import.meta.url),'utf8');
const start=source.indexOf('async function summarizeRetainedAttempts(');
const end=source.indexOf('\nasync function pollOperation(',start);
assert.ok(start>0 && end>start);
const fn=stripTypeScriptTypes(source.slice(start,end),{mode:'transform'});
const stderr=JSON.stringify({kind:'LETTA_TURN_TIMEOUT_DIAGNOSTIC',
  client_message_id:'openchatx-op_fixture',external_execution_schema:1,
  external_requests:0,external_completed:0,idempotency:[]});
const scope={projectId:'fixture',conversationId:'local-conv-50',
  clientMessageId:'openchatx-op_fixture'};
const originalError=JSON.stringify({ok:false,error:'LETTA_TURN_TIMEOUT_REMOTE_UNCERTAIN'});
const recoveredError=JSON.stringify({ok:false,error:'RECOVERY_NO_PENDING_TOOLS'});

async function fixture({omit=false,mismatch=false,missing=false}={}) {
  const root=await mkdtemp(join(tmpdir(),'naos-reconciliation-history-'));
  const id='op_fixture';
  const base=join(root,id);
  const latest=base+'.recover-12345678';
  await writeFile(base+'.input.json',JSON.stringify({...scope,action:'run',
    ...(mismatch?{projectId:'foreign'}:{})}));
  await writeFile(base+'.stdout.log',originalError);
  await writeFile(base+'.stderr.log',stderr);
  await writeFile(latest+'.input.json',JSON.stringify({...scope,action:'recover'}));
  await writeFile(latest+'.stdout.log',recoveredError);
  await writeFile(latest+'.stderr.log','');
  if(missing) await unlink(base+'.stderr.log');
  const op={id,engine:'letta',projectId:'fixture',sessionName:'main-letta',
    sessionId:'local-conv-50',state:'failed',inputPath:latest+'.input.json',
    stdoutPath:latest+'.stdout.log',stderrPath:latest+'.stderr.log',
    ...(omit?{}:{recoveryHistory:[{inputPath:base+'.input.json',
      stdoutPath:base+'.stdout.log',stderrPath:base+'.stderr.log'}]})};
  const dependencies={fs:await import('node:fs/promises'),OPS_DIR:root,join,
    parseLettaWorkerOutput:JSON.parse,summarizeReconciliation,summarizeAttemptHistory};
  const get=new Function(...Object.keys(dependencies),fn+';return summarizeRetainedAttempts;')(...Object.values(dependencies));
  return {root,op,read:()=>get(op,JSON.parse(recoveredError),'')};
}

for (const [label,opts,reason,attempts] of [
  ['verified original history',{},'ORIGINAL_TURN_TIMEOUT_UNVERIFIED',2],
  ['missing retained stderr',{missing:true},'ATTEMPT_HISTORY_INCOMPLETE',2],
  ['foreign original input identity',{mismatch:true},'ATTEMPT_HISTORY_INCOMPLETE',2],
  ['no history uses existing single-attempt logic',{omit:true},'RECOVERY_NO_PENDING_TOOLS',null],
]) {
  test(label,async()=>{
    const f=await fixture(opts);
    try {
      const summary=await f.read();
      assert.equal(summary.reason,reason);
      assert.equal(summary.requiresReconciliation,true);
      assert.equal(summary.attemptHistory?.count??null,attempts);
      assert.equal(summary.automaticRetryAllowed,false);
    } finally {await rm(f.root,{recursive:true,force:true});}
  });
}
