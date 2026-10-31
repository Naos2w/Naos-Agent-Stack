import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { describeReadOnlyBackendConflict,verifyReadOnlyOrphanTail,summarizeReconciliation } from './operation_reconciliation.mjs';
const previous={id:'op_old',engine:'letta',projectId:'fixture',sessionName:'test',sessionId:'local-conv-1',state:'failed',pid:111,createdAt:'2026-10-31T00:00:00Z',stdoutPath:'old.out',stderrPath:'old.err'};
const current={...previous,id:'op_new',pid:222,createdAt:'2026-10-31T02:00:00Z',inputPath:'new.input',stdoutPath:'new.out',stderrPath:'new.err'};
const previousError='LETTA_TURN_TIMEOUT_REMOTE_UNCERTAIN';
const error='LETTA_TURN_FAILED: Conversation local-conv-1 already has an active run (local-run-36)';
const trace={kind:'LETTA_TURN_TIMEOUT_DIAGNOSTIC',client_message_id:'openchatx-op_old',external_requests:0,external_completed:0};
const scope={agentId:'agent-fixture',conversationId:'local-conv-1',clientMessageId:'openchatx-op_old'};
const tail=[{agent_id:scope.agentId,conversation_id:scope.conversationId,message_type:'assistant_message'},
  {agent_id:scope.agentId,conversation_id:scope.conversationId,message_type:'user_message',otid:scope.clientMessageId}];

test('old read-only timeout is only a recovery candidate with exact operation correlation',()=>{
  const proof=describeReadOnlyBackendConflict(current,error,previous,previousError,JSON.stringify(trace));
  assert.equal(proof.clientMessageId,'openchatx-op_old');assert.equal(proof.runId,'local-run-36');
  for(const changed of [{external_requests:1},{client_message_id:'other'},{external_completed:1}])
    assert.equal(describeReadOnlyBackendConflict(current,error,previous,previousError,JSON.stringify({...trace,...changed})),null);
  assert.equal(describeReadOnlyBackendConflict({...current,sessionId:'local-conv-2'},error,previous,previousError,JSON.stringify(trace)),null);
});

test('remote tail proof refuses a newer user, tool activity, wrong Agent or truncated evidence',()=>{
  assert.equal(verifyReadOnlyOrphanTail(tail,scope),true);
  for(const messages of [[],tail.slice(0,1),[tail[0],{...tail[1],otid:'someone-else'}],
    [{...tail[0],message_type:'approval_request_message'},tail[1]],
    [{...tail[0],agent_id:'other'},tail[1]],[{...tail[0],tool_calls:[{}]},tail[1]]])
    assert.equal(verifyReadOnlyOrphanTail(messages,scope),false);
});

const workerSource=await readFile(new URL('./source/letta_worker.ts',import.meta.url),'utf8');
const workerStart=workerSource.indexOf('async function workerRecoverOrphan(');
const workerCode=stripTypeScriptTypes(workerSource.slice(workerStart,workerSource.indexOf('\nasync function workerMain(',workerStart)),{mode:'transform'});
test('actual orphan Worker verifies remote ownership before cancelling the exact backend Run',async()=>{
  for(const valid of [true,false]){
    const requests=[];
    const client={nextRequestId:()=> 'fixture',request:async command=>{
      requests.push(command);
      return command.type==='conversation_messages_list'
        ? {success:true,messages:valid?tail:[tail[0],{...tail[1],otid:'other'}]}
        : {success:true,aborted:true};
    }};
    const deps={getProject:async()=>({id:'fixture',permissions:{read:true}}),
      workerInspect:async()=>({status:'WAITING_ON_INPUT',activeRunIds:[],queueLength:0}),
      withClient:async fn=>fn(client),verifyReadOnlyOrphanTail};
    const run=new Function(...Object.keys(deps),workerCode+';return workerRecoverOrphan;')(...Object.values(deps));
    const input={projectId:'fixture',...scope,runId:'local-run-36'};
    if(valid){assert.equal((await run(input)).status,'cancelled');assert.equal(requests[1].run_id,'local-run-36');}
    else{await assert.rejects(run(input),/REMOTE_TAIL_UNVERIFIED/);assert.equal(requests.length,1);}
  }
});

const facadeSource=await readFile(new URL('./source/agent_runtime.ts',import.meta.url),'utf8');
const facadeStart=facadeSource.indexOf('async function cancelOperation(');
const facadeCode=stripTypeScriptTypes(facadeSource.slice(facadeStart,facadeSource.indexOf('\ntype CompactionReason',facadeStart)),{mode:'transform'});
test('confirmed backend cancellation resolves both original timeout and rejected follow-up without success or replay',async()=>{
  const records={op_old:structuredClone(previous),op_new:structuredClone(current)};
  const calls=[];let saved=0;
  const deps={readOperations:async()=>records,isProcessRunning:()=>false,ensureState:async()=>({}),
    ensureProjectState:()=>({lettaAgentId:scope.agentId,sessions:{test:{lastOperationId:'op_new',lastPolledOperationId:'op_new'}}}),
    readText:async path=>path==='old.err'?JSON.stringify(trace):path==='old.out'?JSON.stringify({error:previousError}):path==='new.out'?JSON.stringify({error}):'',
    parseLettaWorkerOutput:JSON.parse,describeReadOnlyBackendConflict,ensureConfig:async()=>({}),
    runLettaWorkerSync:async command=>{calls.push(command);return {ok:true,status:'cancelled',runId:'local-run-36',conversationId:'local-conv-1'};},
    withOperationsLock:async fn=>fn(),now:()=> '2026-10-31T03:00:00Z',summarizeReconciliation,
    saveOperations:async()=>{saved++;},reconcileStoppedLettaOperation:()=>{throw Error('Unexpected fallback');},
  };
  const cancel=new Function(...Object.keys(deps),facadeCode+';return cancelOperation;')(...Object.values(deps));
  const result=await cancel({id:'fixture'},'op_new');
  assert.equal(result.remoteStatus,'backend_orphan_cancelled');assert.equal(saved,1);assert.equal(calls.length,1);
  assert.equal(calls[0].action,'recover-orphan');assert.equal(calls[0].clientMessageId,'openchatx-op_old');
  for(const record of Object.values(records)){
    assert.equal(record.state,'failed');assert.equal(record.reconciliation.requiresReconciliation,false);
    assert.equal(record.reconciliation.automaticRetryAllowed,false);
  }
  assert.equal(records.op_new.reconciliation.rejectedBeforeExecution,true);
});
