import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import * as contract from './runtime_contract.ts';
import {patchRuntime,patchWorker} from './update-runtime.mjs';
const worker=await readFile(new URL('./source/letta_worker.ts',import.meta.url),'utf8');
const facade=await readFile(new URL('./source/agent_runtime.ts',import.meta.url),'utf8');
const body=stripTypeScriptTypes(worker.slice(worker.indexOf('async function workerRun('),worker.indexOf('async function workerCompact('))
 .replace('const { inspectDevelopmentContext } = await import("./development_gate.ts")','const inspectDevelopmentContext = inspect'),{mode:'transform'});
function fixture({allow=true,read=true,calls=[]}={}){
 const observations=[],project={id:'fixture',permissions:{read}},prompts=[];
 const deps={...contract,getProject:async()=>project,validateSessionName:()=>{},inspect:async(_,prompt)=>({prompt,evidence:{}}),
  decideProjectToolApproval:async(_,name,args)=>{observations.push({phase:'approve',name,args});return {behavior:allow?'allow':'deny'};},
  executeProjectTool:async(_,name,args)=>{observations.push({phase:'read',name,args});return {content:[{type:'text',text:JSON.stringify({content:'private source fixture',truncated:false})}]};},
  ensureWorkerAgent:async()=>({agentId:'agent',modelConfiguration:{}}),now:()=>new Date().toISOString(),
  createConversation:async()=>({conversationId:'conversation'}),TURN_TIMEOUT_MS:1000,planModelSelection:()=>({}),
  runTurn:async(_,__,___,prompt)=>{prompts.push(prompt);return {summary:'I claim all checks passed',external_tool_calls:calls};},
  summarizeRunTrace:()=>({changedFiles:[],blockers:[],validation:{tools_used:[]}})};
 const run=new Function(...Object.keys(deps),body+';return workerRun;')(...Object.values(deps));
 return {run,observations,prompts};
}
const input={projectId:'fixture',prompt:'approved change',contextPaths:['TASK.md','.env'],acceptanceChecks:[{id:'tests',kind:'command',command:'node test',cwd:'.'}]};
test('real Worker prepares bounded source through approval and exposes metadata, not content',async()=>{
 const f=fixture(),r=await f.run(input);
 assert.equal(f.observations.filter(x=>x.phase==='read').length,1);
 assert.equal(f.observations[0].args.max_chars,3000);
 assert.match(f.prompts[0],/private source fixture/);assert.match(f.prompts[0],/untrusted data/);
 assert.ok(!JSON.stringify(r).includes('private source fixture'));
 assert.equal(r.validation.declared_checks.state,'incomplete');
 assert.equal(r.delivery.acceptanceVerified,false);
});
test('permission refusal does not read, retry, or hide an unavailable context',async()=>{
 for(const config of [{allow:false},{read:false}]){
  const f=fixture(config),r=await f.run(input);
  assert.equal(f.observations.filter(x=>x.phase==='read').length,0);
  assert.ok(['partial','read_not_granted'].includes(r.validation.work_context.state));
 }
});
test('real Worker evaluates actual host calls; summary claims and replays cannot pass',async()=>{
 const call={toolName:'openchatx_shell',input:{command:'node test'},toolResult:{status:'succeeded',exitCode:0}};
 for(const [calls,state] of [[[call],'checks_passed'],[[{...call,replayed:true}],'incomplete'],[[call,{toolName:'openchatx_write_file'}],'incomplete']]){
  const r=await fixture({calls}).run(input);assert.equal(r.validation.declared_checks.state,state);
 }
});
test('invalid declarations stop before project reads or model dispatch',async()=>{
 const f=fixture();await assert.rejects(f.run({...input,acceptanceChecks:[{id:'bad',kind:'command',command:'test',cwd:'../private'}]}),/ACCEPTANCE_CHECKS_INVALID/);
 assert.equal(f.observations.length,0);assert.equal(f.prompts.length,0);
});
test('owned source upgrades are idempotent and preserve declared plan in original operation/input',()=>{
 assert.equal(patchRuntime(facade),facade);assert.equal(patchWorker(worker),worker);
 assert.doesNotThrow(()=>stripTypeScriptTypes(facade,{mode:'transform'}));
 assert.match(facade,/contextPaths,\s+acceptanceChecks,\s+taskRef,/);
 assert.match(facade,/inputPath,\s+contextPaths,\s+acceptanceChecks,/);
 assert.match(facade,/ACCEPTANCE_CHECKS_RUN_ONLY/);assert.match(facade,/state: "stale_operation"/);
});
