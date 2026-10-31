import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { summarizeReconciliation, applyRemoteSettlement } from './operation_reconciliation.mjs';
import { patchStoppedReconciliation } from './stopped-reconciliation-patch.mjs';

const source = await readFile(new URL('./source/agent_runtime.ts', import.meta.url), 'utf8');
const part = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const code = stripTypeScriptTypes(
  part('async function reconcileStoppedLettaOperation(', '\ntype CompactionReason') +
  part('async function updateOperation(', '\nfunction isProcessRunning('), {mode:'transform'});
const error = {ok:false,error:'LETTA_TURN_TIMEOUT_REMOTE_UNCERTAIN'};
const timeout = {kind:'LETTA_TURN_TIMEOUT_DIAGNOSTIC',client_message_id:'openchatx-op_test',external_requests:0,external_completed:0,idempotency:[]};

function fixture(options = {}) {
  const operation = {id:'op_test',projectId:'fixture',engine:'letta',sessionName:'existing',
    sessionId:'conv_fixture',state:'failed',pid:1234,inputPath:'input',stdoutPath:'stdout',stderrPath:'stderr',
    reconciliation:{requiresReconciliation:true},createdAt:'2026-10-31T00:00:00Z'};
  const operations = {op_test:operation};
  const input = {projectId:'fixture',agentId:'agent_fixture',conversationId:'conv_fixture',clientMessageId:'openchatx-op_test',...options.input};
  const diagnostic = options.noEvidence ? '' : JSON.stringify({...timeout,...options.timeout});
  const calls = []; let saves = 0;
  const projectState = {lettaAgentId:'agent_fixture',sessions:{existing:{lastOperationId:'op_test',lastPolledOperationId:'op_test'}}};
  const dependencies = {
    readOperations:async()=>operations,
    readJsonFile:async()=>input,
    ensureState:async()=>({}), ensureProjectState:()=>projectState,
    ensureConfig:async()=>({}),
    runLettaWorkerSync:async(...args)=>{calls.push(args);options.afterRemote?.(operations);return options.remote??{ok:true,status:'already_idle'};},
    withOperationsLock:async fn=>fn(), isProcessRunning:()=>false,
    readText:async path=>path==='stdout'?JSON.stringify(error):diagnostic,
    parseLettaWorkerOutput:JSON.parse, summarizeReconciliation, applyRemoteSettlement,
    saveOperations:async()=>{saves++;}, now:()=> '2026-10-31T01:00:00Z',
    findRecoverableBackendRun:()=>{throw Error('Unrelated orphan recovery must not run');},
  };
  const api = new Function(...Object.keys(dependencies), code+';return {cancelOperation,updateOperation};')(...Object.values(dependencies));
  return {operations,calls,input,get saves(){return saves;},
    cancel:()=>api.cancelOperation({id:'fixture'},'op_test'),
    pollPatch:()=>api.updateOperation('op_test',{reconciliation:summarizeReconciliation({...operation,remoteSettlement:undefined},error,diagnostic)})};
}

test('explicit cancel reconciles a stopped timeout without declaring task success or replaying work', async()=>{
  const f=fixture();const result=await f.cancel();
  assert.equal(result.state,'failed');assert.equal(result.remoteStatus,'already_idle');
  assert.equal(result.reconciliation.requiresReconciliation,false);
  assert.equal(result.reconciliation.automaticRetryAllowed,false);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0][0].action,'cancel');
  assert.equal(f.calls[0][0].clientMessageId,'openchatx-op_test');assert.equal(f.saves,1);
  assert.equal(f.operations.op_test.remoteSettlement.operationId,'op_test');
});

test('settled remote cannot clear in-flight tools, uncertain writes, or missing execution evidence', async()=>{
  for(const options of [{timeout:{external_requests:1}},{timeout:{idempotency:[{status:'uncertain'}]}},{noEvidence:true}]){
    const result=await fixture(options).cancel();
    assert.equal(result.reconciliation.remoteState,'settled');
    assert.equal(result.reconciliation.requiresReconciliation,true);
    assert.equal(result.reconciliation.automaticRetryAllowed,false);
  }
});

test('missing or mismatched input ownership refuses remote cancellation', async()=>{
  for(const input of [{projectId:'other'},{agentId:'other'},{conversationId:'other'},{clientMessageId:'other'}]){
    const f=fixture({input});await assert.rejects(f.cancel(),/OWNERSHIP_UNVERIFIED/);
    assert.equal(f.calls.length,0);assert.equal(f.saves,0);
  }
});

test('unconfirmed remote response preserves the unresolved record', async()=>{
  const f=fixture({remote:{ok:false,status:'uncertain'}});
  await assert.rejects(f.cancel(),/REMOTE_UNCERTAIN/);
  assert.equal(f.saves,0);assert.equal(f.operations.op_test.remoteSettlement,undefined);
});

test('a changed operation during cancellation cannot receive the old settlement', async()=>{
  const f=fixture({afterRemote:ops=>{ops.op_test={...ops.op_test,inputPath:'new-input'};}});
  await assert.rejects(f.cancel(),/OPERATION_CHANGED_DURING_CANCEL/);
  assert.equal(f.saves,0);assert.equal(f.operations.op_test.remoteSettlement,undefined);
});

test('a stale poll cannot erase the newer durable settlement', async()=>{
  const f=fixture();await f.cancel();await f.pollPatch();
  assert.equal(f.operations.op_test.state,'failed');
  assert.equal(f.operations.op_test.reconciliation.requiresReconciliation,false);
  assert.equal(f.operations.op_test.reconciliation.settlement.operationId,'op_test');
});

test('a settlement for another operation cannot resolve this operation', async()=>{
  const f=fixture();await f.cancel();
  const record={...f.operations.op_test,remoteSettlement:{...f.operations.op_test.remoteSettlement,operationId:'other'}};
  assert.equal(summarizeReconciliation(record,error,JSON.stringify(timeout)).requiresReconciliation,true);
});

test('updater keeps the reviewed reconciliation patch idempotent and refuses unknown source',()=>{
  assert.equal(patchStoppedReconciliation(source),source);
  assert.throws(()=>patchStoppedReconciliation('unrecognized source'),/SOURCE_CHANGED/);
});
