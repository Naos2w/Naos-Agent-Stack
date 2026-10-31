import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as reconciliation from './operation_reconciliation.mjs';
import { patchDispatchReconciliation } from './update-runtime.mjs';

const source=await readFile(new URL('./source/agent_runtime.ts',import.meta.url),'utf8');
const start=source.indexOf('async function dispatchLettaRun(');
const code=stripTypeScriptTypes(source.slice(start,source.indexOf('\nasync function dispatchOpenCodeRun(',start)),{mode:'transform'});
const uncertain={id:'op_uncertain',projectId:'fixture',engine:'letta',sessionName:'existing',
  sessionId:'conv_fixture',state:'failed',pid:123,createdAt:'2026-10-31T00:00:00Z',
  reconciliation:{requiresReconciliation:true,externalRequests:1,externalCompleted:0,idempotency:[]}};

function fixture(records=[structuredClone(uncertain)], afterRemote=null) {
  let writes=0,starts=0,remoteReads=0,locked=false;
  const operations=Object.fromEntries(records.map(record=>[record.id,record]));
  const session={name:'existing',sessionId:'conv_fixture',model:'letta/agent-config'};
  const deps={...reconciliation,
    ensureLettaService:async()=>{},runLettaWorkerSync:async()=>{remoteReads++;afterRemote?.(operations);return {ok:true,status:'WAITING_ON_INPUT',activeRunIds:[],queueLength:0};},
    assertRemoteStateIdle:()=>{},withOperationsLock:async fn=>{locked=true;try{return await fn();}finally{locked=false;}},
    readOperations:async()=>operations,
    ensureState:async()=>({projects:{fixture:{sessions:{existing:{lastOperationId:'op_uncertain',lastPolledOperationId:'op_uncertain'}}}}}),
    assertOperationDispatchReady:()=>{},isProcessRunning:()=>false,
    fs:{mkdir:async()=>{}},OPS_DIR:'fixture-ops',randomUUID:()=> '00000000-0000-4000-8000-000000000000',join:(...parts)=>parts.join('/'),
    writeJsonFile:async()=>{writes++;assert.equal(locked,true);},createWriteStream:()=>({end(){}}),
    spawn:()=>{starts++;return {pid:999,stdout:{pipe(){}},stderr:{pipe(){}},on(){}};},
    lettaNodeBinary:()=> 'fixture-node',LETTA_WORKER_PATH:'worker',TOOLBOX_ROOT:'root',lettaWorkerEnv:()=>({}),
    now:()=> '2026-10-31T01:00:00Z',saveOperations:async()=>{},pruneOperations:async()=>{},updateOperation:async()=>{},
  };
  const dispatch=new Function(...Object.keys(deps),code+';return dispatchLettaRun;')(...Object.values(deps));
  return {run:()=>dispatch({project:{id:'fixture'},projectState:{lettaAgentId:'agent_fixture'},session,config:{},prompt:'Continue the authorized task',timeoutMs:1000}),
    get writes(){return writes;},get starts(){return starts;},get remoteReads(){return remoteReads;}};
}

test('actual dispatch refuses polled uncertain effects even when the remote listener is idle',async()=>{
  const f=fixture();
  await assert.rejects(f.run(),/OPERATION_EFFECTS_UNRESOLVED: op_uncertain/);
  assert.equal(f.writes,0);assert.equal(f.starts,0);
  assert.equal(f.remoteReads,0);
});

test('a later successful operation or renamed session cannot conceal older uncertain effects',async()=>{
  for(const records of [[{...uncertain,sessionName:'another-alias'}],
    [uncertain,{...uncertain,id:'op_later',state:'completed',createdAt:'2026-10-31T00:30:00Z',reconciliation:{requiresReconciliation:false}}]]) {
    const f=fixture(records);await assert.rejects(f.run(),/OPERATION_EFFECTS_UNRESOLVED/);
    assert.equal(f.starts,0);
  }
});

test('uncertainty appearing during remote inspection is checked again inside the dispatch lock',async()=>{
  const f=fixture([],operations=>{operations[uncertain.id]=structuredClone(uncertain);});
  await assert.rejects(f.run(),/OPERATION_EFFECTS_UNRESOLVED/);
  assert.equal(f.remoteReads,1);assert.equal(f.writes,0);assert.equal(f.starts,0);
});

test('independent conversations and confirmed tool outcomes remain dispatchable',async()=>{
  for(const record of [{...uncertain,projectId:'other'},
    {...uncertain,sessionId:'conv_independent'},
    {...uncertain,reconciliation:{requiresReconciliation:false}},
    {...uncertain,reconciliation:{requiresReconciliation:true,externalRequests:0,externalCompleted:0,idempotency:[]}},
    {...uncertain,reconciliation:{requiresReconciliation:true,externalRequests:1,externalCompleted:1,idempotency:[{status:'executed'}]}},
  ]) {
    const before=JSON.stringify(record),f=fixture([record]);await f.run();
    assert.equal(f.starts,1);assert.equal(JSON.stringify(record),before);
  }
});

test('missing, malformed and uncertain effect evidence never becomes permission to dispatch',()=>{
  for(const summary of [{}, {externalRequests:1,externalCompleted:1},
    {externalRequests:1,externalCompleted:1,idempotency:[{status:'uncertain'}]},
    {externalRequests:0,externalCompleted:0,idempotency:[],externalExecution:{integrity:'invalid'}},
    {externalRequests:1,externalCompleted:1,idempotency:[],externalExecution:{integrity:'verified',uncertain:1}},
  ]) assert.throws(()=>reconciliation.assertNoUnresolvedToolEffects([
    {...uncertain,reconciliation:{...summary,requiresReconciliation:true}}],
    'fixture','existing','conv_fixture'),/OPERATION_EFFECTS_UNRESOLVED/);
});

test('actual manual and automatic compaction path preserves unresolved tool context',async()=>{
  const a=source.indexOf('async function compactSessionInPlace(');
  const compactCode=stripTypeScriptTypes(source.slice(a,source.indexOf('\nfunction publicSession(',a)),{mode:'transform'});
  let remote=0;
  const deps={...reconciliation,readOperations:async()=>({[uncertain.id]:uncertain}),isProcessRunning:()=>false,
    ensureLettaService:async()=>{},runLettaWorkerSync:async()=>{remote++;throw Error('Must not compact');}};
  const compact=new Function(...Object.keys(deps),compactCode+';return compactSessionInPlace;')(...Object.values(deps));
  for(const reason of ['manual','auto']) await assert.rejects(compact({project:{id:'fixture'},projectState:{lettaAgentId:'agent_fixture'},
    session:{name:'existing',sessionId:'conv_fixture',engine:'letta'},config:{},timeoutMs:1000,reason}),/OPERATION_EFFECTS_UNRESOLVED/);
  assert.equal(remote,0);
});

test('reviewed dispatch migration is idempotent and rejects unknown source',()=>{
  assert.equal(patchDispatchReconciliation(source),source);
  assert.throws(()=>patchDispatchReconciliation('unrecognized source'),/Source anchor/);
});
