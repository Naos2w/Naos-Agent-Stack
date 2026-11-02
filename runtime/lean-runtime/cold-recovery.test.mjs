import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRecovery, verifyLocalCompletion, recoveryToolAllowlist, configureOpenchatxStreamOptions } from './source/letta_recovery.mjs';
import { executeSideEffectOnce, readCompletedToolResult } from './source/external_tool_idempotency.ts';
import { mkdtemp, rm, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { EventEmitter } from 'node:events';

const call = {toolCallId: 'original-call', toolName: 'openchatx_shell', input: {command: 'fixture'}};
const command = {runtime: {agent_id: 'agent', conversation_id: 'conversation'}, client_message_id: 'original-input', action: 'inspect'};
const result = {content: [{type: 'text', text: 'done'}]};
function fixture() {
  const writes = [], starts = [];
  const deps = {runtime: {turnLifecycle: {kind: 'idle'}, pendingApprovalResolvers: new Map()},
    registeredTools: () => [{name: call.toolName, runtime: {agentId:'agent', conversationId:'conversation'}}],
    canRecover: async () => true, cwd: () => '/fixture',
    backend: { retrieveConversation: async () => ({agent_id: 'agent'}), retrieveAgent: async () => ({id: 'agent'}),
      listConversationMessages: async () => ({getPaginatedItems: () => [{message_type: 'user_message', otid: 'original-input'}]})},
    resume: async () => ({pendingApprovals: [{toolCallId: call.toolCallId, toolName: call.toolName, toolArgs: call.input}]}),
    store: {write: record => writes.push(record)}, start: message => {starts.push(message); deps.runtime.turnLifecycle.kind = 'active';}};
  return {deps, writes, starts};
}
test('cold recovery submits saved results using original tool IDs and one stable continuation ID', async () => {
  const f = fixture(), snapshot = await handleRecovery(command, f.deps);
  const response = await handleRecovery({...command, action: 'resume', revision: snapshot.revision, results: [{...call, result}]}, f.deps);
  assert.equal(response.accepted, true);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.starts[0].clientToolAllowlist, ['openchatx_shell']);
  assert.equal(f.starts[0].excludeInteractiveTools, true);
  assert.deepEqual(f.starts[0].messages, [{type: 'approval', otid: f.writes[0].requestOtid,
    approvals: [{type: 'tool', tool_call_id: 'original-call', tool_return: 'done', status: 'success'}]}]);
  await assert.rejects(handleRecovery({...command, action: 'resume', revision: snapshot.revision, results: [{...call, result}]}, f.deps), /REMOTE_BUSY/);
});

test('recovery excludes native tools and foreign registrations, and fails before journaling without a controller', async () => {
  const scope = command.runtime;
  const local = {agentId:scope.agent_id, conversationId:scope.conversation_id};
  assert.deepEqual(recoveryToolAllowlist([
    {name:'ApplyPatch',runtime:local}, {name:'Bash',runtime:local},
    {name:'openchatx_shell',runtime:local}, {name:'openchatx_shell',runtime:local},
    {name:'openchatx_write_file',runtime:{...local,conversationId:'other'}},
    {name:'openchatx_read_file',runtime:{...local,agentId:'other'}},
  ], scope), ['openchatx_shell']);
  for (const registrations of [undefined, [], [{name:'openchatx_read_file',runtime:local}]]) {
    const f=fixture(), snapshot=await handleRecovery(command,f.deps);
    f.deps.registeredTools=()=>registrations;
    await assert.rejects(handleRecovery({...command,action:'resume',revision:snapshot.revision,results:[{...call,result}]},f.deps), /RECOVERY_TOOL_/);
    assert.equal(f.starts.length,0);assert.equal(f.writes.length,0);
  }
});

test('only OpenChatX Codex streams receive a bounded idle timeout, preserving tighter settings and cancellation', () => {
  const signal=new AbortController().signal;
  const options={timeoutMs:300_000,signal,maxRetries:0,transport:'auto'};
  const hostTools=[{name:'openchatx_shell'},{name:'openchatx_read_file'}];
  const scoped=configureOpenchatxStreamOptions('openai-codex-responses',hostTools,options);
  assert.deepEqual(scoped,{...options,timeoutMs:120_000});
  assert.equal(options.timeoutMs,300_000);
  assert.equal(configureOpenchatxStreamOptions('openai-codex-responses',hostTools,{timeoutMs:5000}).timeoutMs,5000);
  for(const tools of [undefined,[],[{name:'ApplyPatch'}],[...hostTools,{name:'Bash'}]])
    assert.equal(configureOpenchatxStreamOptions('openai-codex-responses',tools,options),options);
  assert.equal(configureOpenchatxStreamOptions('anthropic-messages',hostTools,options),options);
});
for (const scenario of ['wrong-agent','wrong-input','busy','foreign-tool','changed-call','duplicate-result','changed-arguments','journal-failure'])
  test(`cold recovery rejects ${scenario} without starting a continuation`, async () => {
    const f = fixture(); const snapshot = await handleRecovery(command, f.deps);
    const request = {...command, action: 'resume', revision: snapshot.revision, results: [{...call, result}]};
    if (scenario === 'wrong-agent') f.deps.backend.retrieveConversation = async () => ({agent_id: 'other'});
    if (scenario === 'wrong-input') f.deps.backend.listConversationMessages = async () => [{message_type:'user_message',otid:'newer-input'}];
    if (scenario === 'busy') f.deps.runtime.turnLifecycle.kind = 'active';
    if (scenario === 'foreign-tool') f.deps.resume = async () => ({pendingApprovals:[{toolCallId:'original-call',toolName:'Bash',toolArgs:{}}]});
    if (scenario === 'changed-call') request.revision = 'stale';
    if (scenario === 'duplicate-result') request.results.push(request.results[0]);
    if (scenario === 'changed-arguments') request.results[0] = {...call, input:{command:'different'}, result};
    if (scenario === 'journal-failure') f.deps.store.write = () => {throw Error('disk full');};
    await assert.rejects(handleRecovery(request, f.deps));
    assert.equal(f.starts.length, 0);
  });
test('recovery never turns an incomplete/corrupt/mismatched ledger into a fresh execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'naos-cold-ledger-'));
  const args = {projectId:'p',conversationId:'conversation',...call,ledgerDir:root};
  try {
    assert.equal(await readCompletedToolResult(args), null);
    await executeSideEffectOnce({...args,execute:async()=>result});
    assert.deepEqual(await readCompletedToolResult(args),result);
    await assert.rejects(readCompletedToolResult({...args,input:{different:true}}), /MISMATCH/);
    const file=join(root,(await readdir(root)).find(name=>name.endsWith('.json')));
    const saved=JSON.parse(await readFile(file,'utf8'));
    await writeFile(file,JSON.stringify({...saved,state:'running'}));
    await assert.rejects(readCompletedToolResult(args),/EFFECT_UNCERTAIN/);
    await writeFile(file,'{');
    await assert.rejects(readCompletedToolResult(args),/UNREADABLE/);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('a lost final Worker response can be reconciled from a completed original backend run', async () => {
  const f=fixture();
  f.deps.resume=async()=>({pendingApprovals:[]});
  f.deps.backend.listConversationMessages=async()=>[
    {message_type:'assistant_message',run_id:'original-run',content:'finished'},
    {message_type:'user_message',otid:'original-input'}];
  f.deps.backend.retrieveRun=async()=>({status:'completed'});
  const result=await handleRecovery(command,f.deps);
  assert.equal(result.settled,true);assert.equal(result.runId,'original-run');assert.equal(f.starts.length,0);
  f.deps.backend.retrieveRun=async()=>({status:'running'});
  await assert.rejects(handleRecovery(command,f.deps),/NO_PENDING_TOOLS/);
});

test('after a local provider restart, only a durable final stop for the original input proves completion',async()=>{
  const root=await mkdtemp(join(tmpdir(),'naos-local-stop-'));
  const dir=join(root,'conversations',Buffer.from('conversation:conversation').toString('base64url'));
  await mkdir(dir,{recursive:true});
  const backend={capabilities:{localModelCatalog:true},getLocalStorageDir:()=>root};
  const user={role:'user',otid:'original-input'};
  const last={id:'final-message',role:'assistant',stopReason:'stop',content:[{type:'text',text:'finished'}]};
  const save=async messages=>writeFile(join(dir,'messages.jsonl'),messages.map(message=>JSON.stringify({type:'message',message})).join('\n')+'\n');
  try{
    await save([user,last]);
    assert.equal(await verifyLocalCompletion(backend,command.runtime,'final-message','original-input'),true);
    for(const changed of [{...last,stopReason:'error'},{...last,stopReason:'toolUse'},
      {...last,content:[{type:'toolCall'}]},{...last,id:'different'}]){
      await save([user,changed]);assert.equal(await verifyLocalCompletion(backend,command.runtime,'final-message','original-input'),false);
    }
    await save([{...user,otid:'newer-input'},last]);
    assert.equal(await verifyLocalCompletion(backend,command.runtime,'final-message','original-input'),false);
    await writeFile(join(dir,'messages.jsonl'),'{');
    assert.equal(await verifyLocalCompletion(backend,command.runtime,'final-message','original-input'),false);
  }finally{await rm(root,{recursive:true,force:true});}
});

const facade=await readFile(new URL('./source/agent_runtime.ts',import.meta.url),'utf8');
const facadeBody=stripTypeScriptTypes(facade.slice(facade.indexOf('async function finishLettaWorker('),facade.indexOf('async function cancelOperation(')),{mode:'transform'});
function facadeFixture() {
  let operations={op_1:{id:'op_1',projectId:'p',sessionName:'main',sessionId:'conversation',engine:'letta',pid:70,
    state:'failed',inputPath:'original-input.json',stdoutPath:'old-out',stderrPath:'old-err'}};
  const state={projects:{p:{lettaAgentId:'agent',sessions:{main:{lastOperationId:'op_1',sessionId:'conversation'}}}}};
  const input={projectId:'p',sessionName:'main',agentId:'agent',conversationId:'conversation',clientMessageId:'openchatx-op_1',prompt:'original task'};
  const writes=[], alive=new Set(); let queue=Promise.resolve(), spawns=0;
  const deps={pollOperation:async()=>{},ensureLettaService:async()=>{},withOperationsLock:fn=>{const task=queue.then(fn);queue=task.catch(()=>{});return task;},
    readOperations:async()=>structuredClone(operations),saveOperations:async value=>{operations=structuredClone(value);},
    isProcessRunning:pid=>alive.has(pid),ensureState:async()=>state,readJsonFile:async()=>input,
    randomUUID:()=> 'fixture-attempt',join,OPS_DIR:'/ops',TOOLBOX_ROOT:'/toolbox',LETTA_WORKER_PATH:'/worker',
    writeJsonFile:async(path,value)=>writes.push({path,value}),planModelSelection:()=>({mode:'preserve'}),
    createWriteStream:()=>({end(){}}),lettaNodeBinary:()=>process.execPath,lettaWorkerEnv:()=>({}),
    spawn:()=>{spawns++;const child=new EventEmitter();child.pid=901;child.stdout=child.stderr={pipe(){}};alive.add(901);return child;},
    terminateManagedProcess:async pid=>alive.delete(pid),now:()=>new Date().toISOString()};
  const api=new Function(...Object.keys(deps),facadeBody+';return {recoverOperation,finishLettaWorker};')(...Object.values(deps));
  return {...api,state,input,writes,alive,get operations(){return operations;},get spawns(){return spawns;}};
}
test('facade reserves one recovery, retains original evidence and ignores late callbacks from the dead Worker',async()=>{
  const f=facadeFixture();
  const results=await Promise.allSettled([f.recoverOperation({id:'p'},'op_1',{}),f.recoverOperation({id:'p'},'op_1',{})]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.spawns,1);
  assert.equal(f.writes[0].value.action,'recover');assert.equal(f.writes[0].value.clientMessageId,'openchatx-op_1');
  assert.equal(f.operations.op_1.recoveryHistory[0].stderrPath,'old-err');
  await f.finishLettaWorker('op_1',70,{state:'failed'});
  assert.equal(f.operations.op_1.state,'running');
  await f.finishLettaWorker('op_1',901,{state:'completed'});
  assert.equal(f.operations.op_1.state,'completed');
});
for(const scenario of ['live-worker','moved-session','foreign-input','different-conversation'])
  test(`facade refuses ${scenario} before spawning a recovery Worker`,async()=>{
    const f=facadeFixture();
    if(scenario==='live-worker')f.alive.add(70);
    if(scenario==='moved-session')f.state.projects.p.sessions.main.lastOperationId='newer';
    if(scenario==='foreign-input')f.input.clientMessageId='another-operation';
    if(scenario==='different-conversation')f.input.conversationId='other';
    await assert.rejects(f.recoverOperation({id:'p'},'op_1',{}));assert.equal(f.spawns,0);
  });
