import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {patchLettaRecovery} from './letta-recovery-provider-patch.mjs';
import {configureOpenchatxStreamOptions, recoveryToolAllowlist} from './source/letta_recovery.mjs';

// Opt in against the installed, version-pinned dependency without modifying it.
const bundlePath=process.env.LETTA_BUNDLE_TEST_PATH;
const source=bundlePath ? await readFile(bundlePath,'utf8') : '';
function body(start,end) {
  const from=source.indexOf(start), to=source.indexOf(end,from);
  assert.ok(from>=0 && to>from,'pinned provider source changed');
  return source.slice(from,to);
}

test('provider patch upgrades the installed adapter exactly once', {skip:!bundlePath}, () => {
  const patched=patchLettaRecovery(source);
  assert.equal(patchLettaRecovery(patched),patched);
  assert.equal(patched.split('if (parsed.type === "openchatx_recovery")').length,2);
  assert.equal(patched.split('registeredTools: () => [...getRegisteredTools(runtime).values()].flat(),').length,2);
  assert.equal(patched.split('configureOpenchatxStreamOptions(resolved2.model.api, tools, options)').length,2);
});

test('provider persists exact tool error status instead of always recording success', {skip:!bundlePath}, () => {
  const patched=patchLettaRecovery(source);
  const start=patched.indexOf('  applyApprovalResults(conversationId, agentId, approvals) {');
  const end=patched.indexOf('  settleInterruptedToolCallsForConversation(',start);
  assert.ok(start>=0 && end>start);
  const snippet=patched.slice(start,end);
  assert.match(snippet,/isError: approval.status === "error"/);
  const methods=new Function('isRecord2','return ({'+snippet+'});')(
    v=>v!==null && typeof v==='object' && !Array.isArray(v));
  const recorded=[];
  const backend={...methods,
    findToolCall:(_,__,id)=>({content:{id,name:'openchatx_shell'}}),
    findToolResult:()=>null,
    appendToolResultMessage:record=>recorded.push(record),
    toolResultContentFromUnknown:result=>[{type:'text',text:result}],
  };
  backend.applyApprovalResults('local-conv-50','agent-test',[
    {type:'tool',tool_call_id:'a',tool_return:'failed fixture',status:'error'},
    {type:'tool',tool_call_id:'b',tool_return:'success fixture',status:'success'},
    {type:'tool',tool_call_id:'c',tool_return:'legacy fixture'},
  ]);
  assert.deepEqual(recorded.map(x=>x.isError),[true,false,false]);
  assert.deepEqual(recorded.map(x=>x.toolCall.id),['a','b','c']);
});

test('real provider filter removes native ApplyPatch after recovery', {skip:!bundlePath}, () => {
  const filters=new Function('TOOL_NAME_MAPPINGS',body('function getServerToolName(', 'function shouldIncludeWorktreeTool(')+
    body('function filterExternalToolsByClientAllowlist(', 'function filterToolRegistryByClientAllowlist(')+
    ';return {native:filterBuiltInToolNamesByClientAllowlist,external:filterExternalToolsByClientAllowlist};')({ApplyPatch:'apply_patch',Bash:'bash'});
  const scope={agent_id:'a',conversation_id:'c'};
  const registrations=[{name:'openchatx_shell',runtime:{agentId:'a',conversationId:'c'}}];
  const allowlist=recoveryToolAllowlist(registrations,scope);
  assert.deepEqual(filters.native(['ApplyPatch','Bash','Read','Write'],allowlist),[]);
  const selected=filters.external(new Map([['openchatx_shell',{name:'openchatx_shell'}],['foreign',{name:'foreign'}]]),allowlist);
  assert.deepEqual([...selected.keys()],['openchatx_shell']);
});

test('real provider parser expires silence, resets on progress and closes without replay', {skip:!bundlePath}, async () => {
  const timers=new Set();let closed=0;
  const parse=new Function('decodeWebSocketData','closeWebSocketSilently','setTimeout','clearTimeout',
    body('async function* parseWebSocket(', 'async function* startWebSocketOutputOnFirstEvent(')+';return parseWebSocket;')(
      async data=>data,()=>closed++, (callback,ms)=>{const timer={callback,ms};timers.add(timer);return timer;},timer=>timers.delete(timer));
  const socket=new EventTarget();
  const options=configureOpenchatxStreamOptions('openai-codex-responses',[{name:'openchatx_shell'}],{timeoutMs:300000});
  const iterator=parse(socket,undefined,options.timeoutMs);
  const first=iterator.next();
  assert.equal([...timers][0].ms,120000);
  socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'response.output_text.delta',delta:'progress'})}));
  assert.equal((await first).value.delta,'progress');
  assert.equal(timers.size,0);
  const next=iterator.next();
  assert.equal([...timers][0].ms,120000);
  const rejected=assert.rejects(next,/WebSocket idle timeout after 120000ms/);
  [...timers][0].callback();
  await rejected;
  assert.equal(closed,1);assert.equal(timers.size,0);
});
