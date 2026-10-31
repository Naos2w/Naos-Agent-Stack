import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { planModelSelection, publicModelSelection, applyConversationModelSelection } from './model_routing.mjs';
import { publicModelConfiguration } from './runtime_contract.ts';

test('task classification selects three profiles; missing classification stays standard', () => {
  assert.equal(planModelSelection().selectedModel, 'openai-codex/gpt-6.1-sol');
  assert.equal(planModelSelection().reason, 'DEFAULT_STANDARD');
  assert.equal(planModelSelection({taskComplexity:'simple'}).selectedModel, 'openai-codex/gpt-6-luna');
  assert.equal(planModelSelection({taskComplexity:'simple'}).reasoningEffort, 'medium');
  assert.equal(planModelSelection({taskComplexity:'complex'}).selectedModel, 'openai-codex/gpt-6-astra');
});
test('explicit user model and effort win; automatic mode still honors explicit effort', () => {
  const selection = planModelSelection({model:'gpt-6.1-sol', reasoningEffort:'high', taskComplexity:'simple'});
  assert.equal(selection.mode, 'explicit');
  assert.equal(selection.selectedModel, 'openai-codex/gpt-6.1-sol');
  assert.equal(selection.reasoningEffort, 'high');
  assert.equal(planModelSelection({reasoningEffort:'low', taskComplexity:'complex'}).reasoningEffort,'low');
});
test('invalid inputs and cross-provider handles fail without silent substitutions', () => {
  for (const args of [{model:'openai/gpt-6.1-sol'}, {model:'unknown'}, {model:' gpt-6.1-sol'},
    {taskComplexity:'private'}, {reasoningEffort:'ultra'}, {model:'letta/agent-config',reasoningEffort:'high'}])
    assert.throws(() => planModelSelection(args), /MODEL_/);
});
test('public decisions are allowlisted, consistent and redact unexpected fields', () => {
  for (const args of [{}, {model:'auto',taskComplexity:'simple'}, {model:'gpt-6-astra',taskComplexity:'simple'}, {model:'letta/agent-config'}]) {
    const planned = planModelSelection(args);
    assert.deepEqual(publicModelSelection({...planned,secret:'private'}),planned);
    assert.equal(publicModelSelection({...planned,selectedModel:'private'}),null);
    assert.deepEqual(publicModelSelection({...planned,state:'applied'}),{...planned,state:'applied'});
  }
});
function fixture(options = {}) {
  const agent = {id:'a',model:'openai-codex/gpt-6.1-sol',model_settings:{provider_type:'chatgpt_oauth',reasoning:{reasoning_effort:'high'},context_window_limit:272000}, memory:'private'};
  const conversation = {id:'c',agent_id:'a',model:null,model_settings:null};
  const other = {id:'other',agent_id:'a',model:null,model_settings:null};
  const calls = [], runtime = {agent_id:'a',conversation_id:'c'};
  const client = {nextRequestId: () => 'fixture', async request(request) {
    calls.push(structuredClone(request));
    if (request.type === 'agent_retrieve') return {success:true,agent:structuredClone(agent)};
    if (request.type === 'conversation_retrieve') return {success:true,conversation:structuredClone(conversation)};
    if (request.type === 'list_models') return options.catalog ?? {success:true,
      available_handles:['openai-codex/gpt-6-luna','openai-codex/gpt-6.1-sol','openai-codex/gpt-6-astra'],
      entries: ['gpt-6-luna','gpt-6.1-sol','gpt-6-astra'].flatMap(name => ['medium','high'].map(effort =>
        ({id:name+'-'+effort,handle:'openai-codex/'+name,updateArgs:{reasoning_effort:effort}})))};
    if (request.type === 'update_model') {
      if (options.updateFailure) return {success:false,error:'private upstream error'};
      conversation.model = request.payload.model_handle;
      conversation.model_settings = {...agent.model_settings,reasoning:{reasoning_effort:request.payload.reasoning_effort}};
      if(options.wrongEffort)conversation.model_settings.reasoning.reasoning_effort='low';
      return {success:true,applied_to:options.wrongScope?'agent':'conversation',runtime};
    }
    throw Error('Unexpected request '+request.type);
  }};
  let idleChecks = 0;
  const idle = async () => {idleChecks++;if(options.busyAt===idleChecks)throw Error('REMOTE_BUSY');};
  return {client,runtime,agent,conversation,other,calls,idle,get idleChecks(){return idleChecks;}};
}
test('one conversation switches with readback; shared Agent and sibling remain unchanged', async () => {
  const f=fixture(), original=structuredClone([f.agent,f.other]);
  const selection=planModelSelection({taskComplexity:'simple'});
  const result=await applyConversationModelSelection(f.client,f.runtime,selection,f.idle);
  assert.equal(result.modelSelection.state,'applied');
  assert.equal(result.modelConfiguration.effectiveModel,'openai-codex/gpt-6-luna');
  assert.equal(result.modelConfiguration.reasoningEffort,'medium');
  assert.equal(result.modelConfiguration.source,'letta.conversation_retrieve');
  assert.deepEqual(publicModelConfiguration(result.modelConfiguration),result.modelConfiguration);
  assert.deepEqual([f.agent,f.other],original);
  assert.equal(f.calls.filter(c=>c.type==='update_model').length,1);
  assert.equal(f.idleChecks,3);
  assert.doesNotMatch(JSON.stringify(result),/private|memory/);
});
test('matching effective configuration is observed without a redundant update', async () => {
  const f=fixture();
  await applyConversationModelSelection(f.client,f.runtime,planModelSelection(),f.idle);
  assert.ok(!f.calls.some(c=>c.type==='update_model'));
});
test('legacy preserve reads the effective override and does not select or update', async () => {
  const f=fixture();f.conversation.model='openai-codex/gpt-6-luna';
  f.conversation.model_settings={provider_type:'chatgpt_oauth',reasoning:{reasoning_effort:'medium'}};
  const r=await applyConversationModelSelection(f.client,f.runtime,planModelSelection({model:'letta/agent-config'}),f.idle);
  assert.equal(r.modelConfiguration.effectiveModel,'openai-codex/gpt-6-luna');
  assert.ok(!f.calls.some(c=>['list_models','update_model'].includes(c.type)));
});
for(const [label,options,error] of [
  ['unavailable catalog',{catalog:{success:false}},'MODEL_CATALOG_UNAVAILABLE'],
  ['unknown availability',{catalog:{success:true,entries:[],available_handles:null}},'MODEL_NOT_AVAILABLE'],
  ['omitted availability',{catalog:{success:true,entries:[{id:'x',handle:'openai-codex/gpt-6-luna',updateArgs:{reasoning_effort:'medium'}}]}},'MODEL_NOT_AVAILABLE'],
  ['missing effort',{catalog:{success:true,available_handles:['openai-codex/gpt-6-luna'],entries:[{id:'x',handle:'openai-codex/gpt-6-luna',updateArgs:{reasoning_effort:'low'}}]}},'MODEL_REASONING_NOT_AVAILABLE'],
  ['failed update',{updateFailure:true},'MODEL_SELECTION_APPLY_FAILED'],
  ['unexpected update scope',{wrongScope:true},'MODEL_SELECTION_SCOPE_UNVERIFIED'],
  ['mismatched effective effort',{wrongEffort:true},'MODEL_SELECTION_VERIFY_FAILED'],
  ['busy before selection',{busyAt:1},'REMOTE_BUSY'],
  ['busy immediately before mutation',{busyAt:2},'REMOTE_BUSY'],
  ['busy before input',{busyAt:3},'REMOTE_BUSY'],
])test(label+' stops without fallback or input dispatch',async()=>{
  const f=fixture(options);
  await assert.rejects(applyConversationModelSelection(f.client,f.runtime,planModelSelection({taskComplexity:'simple'}),f.idle),new RegExp(error));
  assert.ok(!f.calls.some(c=>c.type==='input'));
  assert.ok(f.calls.filter(c=>c.type==='update_model').length<=1);
});
test('ownership, persisted scope and provider route are verified before mutation',async()=>{
  for(const kind of ['owner','default','provider']){
    const f=fixture();
    if(kind==='owner')f.conversation.agent_id='other-agent';
    if(kind==='default')f.runtime.conversation_id='default';
    if(kind==='provider')f.agent.model_settings.provider_type='openai';
    await assert.rejects(applyConversationModelSelection(f.client,f.runtime,planModelSelection({taskComplexity:'simple'}),f.idle),/MODEL_/);
    assert.ok(!f.calls.some(c=>c.type==='update_model'));
  }
});
test('actual runTurn sends input only after verified conversation selection',async()=>{
  const source=await readFile(new URL('./source/letta_worker.ts',import.meta.url),'utf8');
  const start=source.indexOf('async function runTurn('),end=source.indexOf('\nfunction summarizeRunTrace',start);
  const body=stripTypeScriptTypes(source.slice(start,end),{mode:'transform'});
  const f=fixture();
  const original=f.client.request;
  let inputSeen=false;
  f.client.request=async request=>{
    if(request.type==='runtime_start')return {success:true,runtime:f.runtime};
    if(request.type==='input'){
      assert.equal(f.conversation.model,'openai-codex/gpt-6-luna');
      assert.equal(f.conversation.model_settings.reasoning.reasoning_effort,'medium');
      inputSeen=true;return {accepted:true};
    }
    if(request.type==='conversation_messages_list')return {success:true,messages:[]};
    return original(request);
  };
  f.client.setToolScope=()=>{};f.client.onDisconnect=()=>()=>{};f.client.isOpen=()=>true;
  f.client.onMessage=()=>()=>{};f.client.waitFor=async()=>({stop_reason:'end_turn'});
  const dependencies={withClient:fn=>fn(f.client),registerExternalToolHandler:()=>{},registerApprovalHandler:()=>{},
    runtimeStartCommand:()=>({type:'runtime_start'}),requireSuccess:r=>assert.equal(r.success,true),
    runtimeMatches:(m,r)=>m.runtime===r,
    applyConversationModelSelection,workerInspect:async()=>({status:'idle'}),assertRemoteStateIdle:()=>{},
    externalToolDefinitions:()=>[],latestAssistantText:()=> 'verified',truncate:text=>({text,truncated:false}),planModelSelection};
  const run=new Function(...Object.keys(dependencies),'selection',body+'\nreturn runTurn({},{agentId:"a"},{conversationId:"c"},"fixture",1000,"message-fixture",selection);');
  const result=await run(...Object.values(dependencies),planModelSelection({taskComplexity:'simple'}));
  assert.equal(inputSeen,true);assert.equal(result.modelSelection.state,'applied');
});
