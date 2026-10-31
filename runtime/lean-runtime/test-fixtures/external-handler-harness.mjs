import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as evidence from '../tool_evidence.mjs';
import { executeSideEffectOnce, isSideEffectingExternalTool } from '../source/external_tool_idempotency.ts';
const source=await readFile(new URL('../source/letta_worker.ts',import.meta.url),'utf8');
const start=source.indexOf('async function registerExternalToolHandler(');
const end=source.indexOf('\nfunction runtimeStartCommand(',start);
if(start<0 || end<=start) throw Error('Worker handler anchor missing');
const code=stripTypeScriptTypes(source.slice(start,end),{mode:'transform'});

// Use the shipped handler and guard. Only tool execution and transport are fakes.
export function createHandler(dependencies) {
  const values={...evidence,isSideEffectingExternalTool,executeSideEffectOnce,...dependencies};
  return new Function(...Object.keys(values),code+';return registerExternalToolHandler;')(...Object.values(values));
}
export const timeout={kind:'LETTA_TURN_TIMEOUT_DIAGNOSTIC',client_message_id:'openchatx-op_fixture',external_requests:1,external_completed:0,idempotency:[],external_execution_schema:1};
export const operation={id:'op_fixture',projectId:'fixture',sessionId:'fixture-conversation',state:'failed',remoteSettlement:{schema:1,source:'explicit_cancel',operationId:'op_fixture',projectId:'fixture',conversationId:'fixture-conversation',clientMessageId:'openchatx-op_fixture',status:'cancelled',observedAt:'2026-10-31T00:00:00Z'}};
export const request={type:'external_tool_call_request',request_id:'request_fixture',tool_call_id:'call_fixture',tool_name:'openchatx_shell',runtime:{agent_id:'fixture-agent',conversation_id:'fixture-conversation'},input:{test:'fixed-fixture-input'}};
