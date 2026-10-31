import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, appendFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { executeSideEffectOnce } from './source/external_tool_idempotency.ts';
import { createHandler, timeout, operation, request } from './test-fixtures/external-handler-harness.mjs';
import { summarizeReconciliation } from './operation_reconciliation.mjs';

test('tool completion after timeout remains observable when the response socket has closed',async()=>{
  const root=await mkdtemp(join(tmpdir(),'naos-late-tool-'));
  let release, started;
  const barrier=new Promise(resolve=>{release=resolve;});
  const effectObserved=new Promise(resolve=>{started=resolve;});
  const logs=[],calls=[];let handler;
  const dependencies={
    executeSideEffectOnce:args=>executeSideEffectOnce({...args,ledgerDir:join(root,'ledger')}),
    executeExternalTool:async()=>{await writeFile(join(root,'effect.txt'),'one effect');started();await barrier;return {content:[{type:'text',text:'{"exit_code":0}'}]};},
    decideProjectToolApproval:()=>{throw Error('Unexpected file observation');},
    process:{stderr:{write:text=>logs.push(text)}},
  };
  const register=createHandler(dependencies);
  const client={onMessage:fn=>{handler=fn;return()=>{};},send:()=>{throw Error('LETTA_SOCKET_NOT_OPEN');}};
  try{
    await register(client,{id:'fixture'},'fixture-agent',calls);
    const pending=handler({...request,input:{test:'DO_NOT_LOG_TEST_CONTENT'}});
    // Consume rejection immediately: the test checks the actual handler promise.
    const outcome=pending.then(()=>null,error=>error);
    await effectObserved;
    logs.push(JSON.stringify(timeout)+'\n');
    release();
    assert.equal(await outcome,null,'a lost response must not cause an unhandled handler rejection');
    const summary=summarizeReconciliation(operation,{error:'LETTA_TURN_TIMEOUT_REMOTE_UNCERTAIN'},logs.join(''));
    assert.equal(summary.externalCompletedAtTimeout,0);
    assert.equal(summary.externalCompleted,1);
    assert.equal(summary.requiresReconciliation,false);
    assert.equal(summary.automaticRetryAllowed,false);
    assert.equal(summary.externalExecution.deliveryFailures,1);
    assert.ok(!logs.join('').includes('DO_NOT_LOG_TEST_CONTENT'));
    assert.equal(await readFile(join(root,'effect.txt'),'utf8'),'one effect');
  } finally {release();await rm(root,{recursive:true,force:true});}
});

for(const phase of ['before-effect','after-effect','after-ledger']) {
  test(`process interruption ${phase} never executes a repeated tool identity twice`,{timeout:15000},async()=>{
    const root=await mkdtemp(join(tmpdir(),'naos-inflight-kill-'));
    const child=fork(new URL('./test-fixtures/inflight-child.mjs',import.meta.url),[root,phase],
      {silent:true,windowsHide:true,execArgv:['--max-old-space-size=128']});
    let stderr='',timer;
    child.stderr.on('data',chunk=>{stderr+=chunk;});child.stdout.resume();
    const closed=once(child,'close');
    try{
      await new Promise((resolve,reject)=>{
        timer=setTimeout(()=>reject(Error('Fixture checkpoint timed out')),8000);
        child.once('error',reject);
        child.once('exit',()=>reject(Error('Fixture exited before checkpoint: '+stderr)));
        child.once('message',message=>message.checkpoint===phase?resolve():reject(Error('Unexpected checkpoint')));
      });
      clearTimeout(timer);
      child.kill('SIGKILL');await closed;
      const ledgerDir=join(root,'ledger');
      const files=await readdir(ledgerDir);assert.equal(files.length,1);
      const before=await readFile(join(ledgerDir,files[0]),'utf8');
      assert.equal(JSON.parse(before).state,phase==='after-ledger'?'completed':'running');
      let repeats=0;
      const replay=await executeSideEffectOnce({projectId:'fixture',conversationId:'fixture-conversation',toolCallId:'call_fixture',toolName:'openchatx_shell',input:request.input,ledgerDir,
        execute:async()=>{repeats++;await appendFile(join(root,'effect.txt'),'REPEATED\n');return {content:[]};}});
      assert.equal(repeats,0);
      assert.equal(replay.status,phase==='after-ledger'?'replayed':'uncertain');
      assert.equal(await readFile(join(ledgerDir,files[0]),'utf8'),before);
      const effect=await readFile(join(root,'effect.txt'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
      assert.equal(effect,phase==='before-effect'?'':'one effect\n');
      const summary=summarizeReconciliation(operation,{error:'LETTA_TURN_TIMEOUT_REMOTE_UNCERTAIN'},stderr);
      assert.equal(summary.requiresReconciliation,phase!=='after-ledger');
      assert.equal(summary.automaticRetryAllowed,false);
    } finally {
      clearTimeout(timer);
      if(child.exitCode===null && child.signalCode===null){child.kill('SIGKILL');await closed;}
      await rm(root,{recursive:true,force:true});
    }
  });
}

test('incomplete, duplicated, contradictory and oversized traces cannot clear uncertain effects',()=>{
  const begin={kind:'EXTERNAL_TOOL_EXECUTION',phase:'started',sequence:1,sideEffecting:true};
  const end={kind:'EXTERNAL_TOOL_EXECUTION',phase:'completed',sequence:1,idempotencyStatus:'executed',outcome:'succeeded'};
  const scenarios=[
    [begin], [end], [begin,begin,end], [begin,end,end],
    [begin,{...end,idempotencyStatus:'uncertain'}],
    [begin,{...end,outcome:'unknown'}],
    [begin,end,{...begin,sequence:257}],
    [begin,{...end,phase:'unrecognized'}],
  ];
  for(const events of scenarios){
    const summary=summarizeReconciliation(operation,{error:'LETTA_TURN_TIMEOUT_REMOTE_UNCERTAIN'},[timeout,...events].map(JSON.stringify).join('\n'));
    assert.equal(summary.requiresReconciliation,true,JSON.stringify(events));
    assert.equal(summary.automaticRetryAllowed,false);
  }
});

test('late completion alone cannot prove remote settlement',()=>{
  const events=[timeout,{kind:'EXTERNAL_TOOL_EXECUTION',phase:'started',sequence:1,sideEffecting:false},
    {kind:'EXTERNAL_TOOL_EXECUTION',phase:'completed',sequence:1,idempotencyStatus:'not_applicable',outcome:'succeeded'}];
  const summary=summarizeReconciliation({...operation,remoteSettlement:undefined},{error:'LETTA_TURN_TIMEOUT_REMOTE_UNCERTAIN'},events.map(JSON.stringify).join('\n'));
  assert.equal(summary.externalCompleted,1);
  assert.equal(summary.remoteState,'uncertain');assert.equal(summary.requiresReconciliation,true);
});
