// Exercise the installed provider's recovery function with synthetic backend
// state. Never start Letta, contact a model, or alter a real conversation.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const [packageRoot, output] = process.argv.slice(2);
if (!packageRoot || !output) throw Error('Usage: node probe-installed-approval.mjs <letta-code-package> <new-output-json>');
const manifest=JSON.parse(await readFile(join(packageRoot,'package.json'),'utf8'));
const source=await readFile(join(packageRoot,'letta.js'),'utf8');
function extract(start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  if(a<0 || b<0 || source.indexOf(start,a+start.length)>=0) throw Error('PROVIDER_SOURCE_CHANGED');
  return source.slice(a,b);
}
const helper=extract('function buildFreshDenialApprovals(', '\nfunction refreshInputOtidsForNewRequest(');
const recovery=extract('async function recoverApprovalStateForSync(', '\nvar init_recovery_sync');
const match=source.match(/STALE_APPROVAL_RECOVERY_DENIAL_REASON = ("(?:[^"\\]|\\.)*")/);
if(!match)throw Error('PROVIDER_REASON_CHANGED');
const denialReason=JSON.parse(match[1]);
const approval={toolCallId:'synthetic-approval',toolName:'synthetic-write'};
const scope={agent_id:'synthetic-agent',conversation_id:'synthetic-conversation'};
let reads=0;
const deps={getBackend:()=>({retrieveAgent:async()=>{reads++;return {id:scope.agent_id};}}),
  getResumeDataFromBackend:async()=>({pendingApprovals:[approval]}),
  clearRecoveredApprovalState:runtime=>{runtime.recoveredApprovalState=null;},
  hasInterruptedCacheForScope:()=>false,canRecoverConversation:async()=>true,
  isBackendNotFoundError2:()=>false,STALE_APPROVAL_RECOVERY_DENIAL_REASON:denialReason};
const recover=new Function(...Object.keys(deps),helper+'\n'+recovery+';return recoverApprovalStateForSync;')(...Object.values(deps));
const cases=[];
for(const resumeInterruptedTurn of [false,true]){
  const runtime={agentId:scope.agent_id,conversationId:scope.conversation_id,listener:{},
    turnLifecycle:{kind:'idle'},pendingApprovalResolvers:new Map(),continuationEpoch:1};
  await recover(runtime,scope,{}, {resumeInterruptedTurn});
  const decisions=resumeInterruptedTurn?runtime.recoveredApprovalState.autoDecisions:runtime.pendingInterruptedResults;
  assert.equal(decisions.length,1);
  assert.equal(resumeInterruptedTurn?decisions[0].type:decisions[0].approve,resumeInterruptedTurn?'deny':false);
  assert.equal(resumeInterruptedTurn?decisions[0].approval.toolCallId:decisions[0].tool_call_id,approval.toolCallId);
  cases.push({resumeInterruptedTurn,decision:'deny_stale_approval',originalToolCallIdPreserved:true});
}
assert.equal(reads,2);
const record={schema:1,providerVersion:manifest.version,sourceSha256:createHash('sha256').update(source).digest('hex'),
  cases,passed:2,failed:0,scope:'Installed recovery function; synthetic backend and idle runtime. No real model or interrupted approval end-to-end test.',
  implication:'resume_interrupted_turn is not transparent reapproval or replay of the original tool. Runtime must preserve uncertain-effect reconciliation and must not force a new tool identity.',timestampUtc:new Date().toISOString()};
await writeFile(resolve(output),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(record,null,2));
