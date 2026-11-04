import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isCodexUsageLimitError, summarizeReconciliation, assertNoUnresolvedToolEffects } from './operation_reconciliation.mjs';
import { describeOperationOutcome } from './runtime_contract.ts';
import { patchQuotaWorker } from './quota-handoff-patch.mjs';
import { patchWorker } from './update-runtime.mjs';

const quota = 'LETTA_TURN_FAILED: ' + JSON.stringify({
  error: {
    error: { type: 'local_backend_error', message: 'Codex error: The usage limit has been reached',
      detail: 'Codex error: The usage limit has been reached' },
    run_id: 'local-run-2',
  },
});
const operation = Object.freeze({
  id: 'op_fixture', projectId: 'fixture', engine: 'letta',
  sessionName: 'main-letta', sessionId: 'local-conv-26',
  state: 'failed', createdAt: '2026-11-04T07:22:10.278Z',
});
const result = {ok:false,engine:'letta',error:quota};
const terminal = (overrides={}) => JSON.stringify({
  kind:'LETTA_TURN_TERMINAL_FAILURE',
  client_message_id:'openchatx-op_fixture', external_execution_schema:1,
  external_requests:0, external_completed:0, idempotency:[], ...overrides,
});

test('recognises exact structured Codex quota failure; never generic or forged errors', () => {
  assert.equal(isCodexUsageLimitError(quota),true);
  for (const bad of [
    'usage limit has been reached',
    quota.replace('local_backend_error','permission_denied'),
    quota.replace('local-run-2','other-run'),
    quota.replace('The usage limit has been reached','network unavailable'),
    quota.replace('"detail":"Codex error: The usage limit has been reached"',
      '"detail":"other failure"'),
    'LETTA_TURN_FAILED: {not-json',
  ]) assert.equal(isCodexUsageLimitError(bad),false,bad);
});

test('verified terminal quota with zero external effects safely offers interactive ChatGPT direct MCP', () => {
  const summary=summarizeReconciliation(operation,result,terminal());
  assert.equal(summary.requiresReconciliation,false);
  assert.equal(summary.remoteState,'settled');
  assert.equal(summary.reason,'PROVIDER_QUOTA_EXHAUSTED');
  assert.equal(summary.externalRequests,0);
  assert.equal(summary.externalCompleted,0);
  assert.doesNotThrow(()=>assertNoUnresolvedToolEffects([{...operation,reconciliation:summary}],
    operation.projectId,operation.sessionName,operation.sessionId));
  const outcome=describeOperationOutcome({state:'failed',taskRef:'tasks/current.md',reconciliation:summary});
  assert.equal(outcome.next_move.action,'handoff_to_chatgpt_direct_mcp');
  assert.equal(outcome.next_move.executionPath,'chatgpt_direct_openchatx_mcp');
  assert.equal(outcome.next_move.interactiveOnly,true);
  assert.equal(outcome.next_move.automaticPromptReplay,false);
  assert.equal(outcome.next_move.automaticRetryAllowed,false);
  assert.equal(outcome.delivery.acceptanceVerified,false);
});

test('historical quota logs without terminal evidence remain uncertain, not falsely cleared', () => {
  const summary=summarizeReconciliation(operation,result,'');
  assert.equal(summary.reason,'PROVIDER_QUOTA_EXHAUSTED_UNVERIFIED');
  assert.equal(summary.requiresReconciliation,true);
  assert.equal(summary.remoteState,'uncertain');
  assert.equal(describeOperationOutcome({state:'failed',reconciliation:summary}).next_move.action,
    'reconcile_before_retry');
});

test('old listener-idle settlement preserves the true quota cause without clearing unknown effects',()=>{
  const remoteSettlement={schema:1,source:'explicit_cancel',operationId:operation.id,
    projectId:operation.projectId,conversationId:operation.sessionId,
    clientMessageId:'openchatx-op_fixture',status:'already_idle',
    observedAt:'2026-11-04T08:00:00.000Z'};
  const older=summarizeReconciliation({...operation,remoteSettlement},result,'');
  assert.equal(older.reason,'PROVIDER_QUOTA_EXHAUSTED_UNVERIFIED');
  assert.equal(older.requiresReconciliation,true);
  const proven=summarizeReconciliation({...operation,remoteSettlement},result,terminal());
  assert.equal(proven.reason,'PROVIDER_QUOTA_EXHAUSTED');
  assert.equal(proven.requiresReconciliation,false);
});

test('missing, incorrect, or contradictory execution proof blocks fallback', () => {
  const variants=[
    terminal({client_message_id:'openchatx-another'}),
    terminal({external_requests:1,external_completed:0}),
    terminal({external_requests:1,external_completed:1}),
    terminal({idempotency:[{status:'executed'}]}),
    terminal({external_execution_schema:2}),
    terminal({external_completed:-1}),
    terminal()+'\n'+JSON.stringify({kind:'EXTERNAL_TOOL_EXECUTION',phase:'started',sequence:1,sideEffecting:true}),
    terminal()+'\n'+JSON.stringify({kind:'LETTA_TURN_TIMEOUT_DIAGNOSTIC',external_requests:1,
      external_completed:0,external_execution_schema:1}),
  ];
  for(const stderr of variants){
    const summary=summarizeReconciliation(operation,result,stderr);
    assert.equal(summary.requiresReconciliation,true,stderr);
    assert.notEqual(summary.reason,'PROVIDER_QUOTA_EXHAUSTED',stderr);
  }
});

test('terminal marker alone never settles another provider failure or success',()=>{
  const other={ok:false,error:quota.replace('The usage limit has been reached','Other error')};
  assert.equal(summarizeReconciliation(operation,other,terminal()).requiresReconciliation,true);
  const cancelled=summarizeReconciliation({...operation,state:'cancelled'},result,terminal());
  assert.equal(cancelled.requiresReconciliation,true);
});

test('installed worker patch is strict, idempotent and matches reviewed source snapshot',async()=>{
  const source=await readFile(new URL('./source/letta_worker.ts',import.meta.url),'utf8');
  assert.match(source,/LETTA_TURN_TERMINAL_FAILURE/);
  assert.equal(patchWorker(source),source);
  assert.equal(patchQuotaWorker(source),source);
  const prior=source.replace(/      process\.stderr\.write\(JSON\.stringify\(\{\n        kind: "LETTA_TURN_TERMINAL_FAILURE",[\s\S]*?      \}\) \+ "\\n"\)\n/,'');
  assert.notEqual(prior,source);
  assert.equal(patchQuotaWorker(prior),source);
  assert.throws(()=>patchQuotaWorker('source changed unexpectedly'),/anchor missing/);
});
