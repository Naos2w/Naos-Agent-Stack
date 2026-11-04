import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAttemptHistory, assertNoUnresolvedToolEffects } from './operation_reconciliation.mjs';

const quota='LETTA_TURN_FAILED: '+JSON.stringify({error:{error:{
  type:'local_backend_error',message:'Codex error: The usage limit has been reached',
},run_id:'local-run-1'}});
const base = {
  id:'op_fixture', projectId:'houselook', engine:'letta',
  sessionName:'main-letta',sessionId:'local-conv-50',state:'failed',
};
const result = error => ({ok:false,error});
const event=(phase,sequence,more={})=>JSON.stringify({kind:'EXTERNAL_TOOL_EXECUTION',phase,sequence,...more});
const line=record=>JSON.stringify(record);
const timeout=(requested,completed,other={})=>line({
  kind:'LETTA_TURN_TIMEOUT_DIAGNOSTIC',client_message_id:'openchatx-op_fixture',
  external_execution_schema:1,external_requests:requested,external_completed:completed,
  idempotency:[],...other,
});
function houseAttempt(){
  const events=[event('started',1,{sideEffecting:false}),
    event('completed',1,{idempotencyStatus:'not_applicable',outcome:'succeeded'}),
    event('started',2,{sideEffecting:true}),
    event('completed',2,{idempotencyStatus:'executed',outcome:'failed'}),
    event('started',3,{sideEffecting:true}),
    event('completed',3,{idempotencyStatus:'executed',outcome:'succeeded'}),
    event('started',4,{sideEffecting:true}),
    timeout(4,3),
    line({kind:'LETTA_TIMEOUT_RECOVERY',status:'uncertain',reason:'EXTERNAL_TOOL_IN_FLIGHT'}),
    event('completed',4,{idempotencyStatus:'executed',outcome:'succeeded'}),
    event('response_delivery_failed',4),
  ];
  return {result:result('LETTA_TURN_TIMEOUT_REMOTE_UNCERTAIN'),stderr:events.join('\n')};
}
const rejected = {result:result('LETTA_RECOVERY_APPROVAL_DENIED'),stderr:''};
test('HouseLook original four completed tool effects survive later failed recovery',()=>{
  const op={...base,remoteSettlement:{schema:1,source:'explicit_cancel',
    operationId:'op_fixture',projectId:'houselook',conversationId:'local-conv-50',
    clientMessageId:'openchatx-op_fixture',status:'already_idle',
    observedAt:'2026-11-04T13:00:00.000Z'}};
  const summary=summarizeAttemptHistory(op,[houseAttempt(),rejected]);
  assert.equal(summary.originalReason,'RESULT_DELIVERY_UNCONFIRMED');
  assert.equal(summary.reason,'RESULT_DELIVERY_UNCONFIRMED');
  assert.equal(summary.remoteState,'uncertain');
  assert.equal(summary.requiresReconciliation,true);
  assert.equal(summary.externalRequests,4);
  assert.equal(summary.externalCompleted,4);
  assert.equal(summary.externalExecution.integrity,'verified');
  assert.equal(summary.attemptHistory.externalDeliveryFailures,1);
  assert.equal(summary.attemptHistory.count,2);
  assert.throws(()=>assertNoUnresolvedToolEffects([{...op,reconciliation:summary}],
    'houselook','main-letta','local-conv-50'),/OPERATION_EFFECTS_UNRESOLVED/);
});
test('historical Stock quota remains visible after RECOVERY_NO_PENDING_TOOLS',()=>{
  const op={...base,projectId:'stock',remoteSettlement:{schema:1,source:'explicit_cancel',
    operationId:'op_fixture',projectId:'stock',conversationId:'local-conv-50',
    clientMessageId:'openchatx-op_fixture',status:'already_idle',
    observedAt:'2026-11-04T13:00:00.000Z'}};
  const summary=summarizeAttemptHistory(op,[
    {result:result(quota),stderr:''},
    {result:result('RECOVERY_NO_PENDING_TOOLS'),stderr:''}
  ]);
  assert.equal(summary.originalReason,'PROVIDER_QUOTA_EXHAUSTED_UNVERIFIED');
  assert.equal(summary.reason,'PROVIDER_QUOTA_EXHAUSTED_UNVERIFIED');
  assert.equal(summary.requiresReconciliation,true);
  assert.equal(summary.externalRequests,null);
  assert.equal(summary.attemptHistory.count,2);
});
test('a missing or mismatched retained log never becomes verified success',()=>{
  const summary=summarizeAttemptHistory(base,[
    {result:{},stderr:''},{result:result('RECOVERY_NO_PENDING_TOOLS'),stderr:''}
  ],{evidenceComplete:false});
  assert.equal(summary.reason,'ATTEMPT_HISTORY_INCOMPLETE');
  assert.equal(summary.requiresReconciliation,true);
  assert.equal(summary.attemptHistory.evidenceComplete,false);
});
test('historical tool uncertainty remains even with later zero-tool quota marker',()=>{
  const terminal=line({kind:'LETTA_TURN_TERMINAL_FAILURE',
    client_message_id:'openchatx-op_fixture',external_execution_schema:1,
    external_requests:0,external_completed:0,idempotency:[]});
  const summary=summarizeAttemptHistory(base,[
    houseAttempt(),{result:result(quota),stderr:terminal}
  ]);
  assert.equal(summary.externalRequests,4);
  assert.equal(summary.reason,'RESULT_DELIVERY_UNCONFIRMED');
  assert.equal(summary.requiresReconciliation,true);
});
test('stale or fabricated attempt history can never trigger automatic retry',()=>{
  for(const attempts of [[],[rejected],Array.from({length:18},()=>rejected)])
    assert.throws(()=>summarizeAttemptHistory(base,attempts),/ATTEMPT_HISTORY_INVALID/);
  const summary=summarizeAttemptHistory(base,[houseAttempt(),rejected]);
  assert.equal(summary.automaticRetryAllowed,false);
});
