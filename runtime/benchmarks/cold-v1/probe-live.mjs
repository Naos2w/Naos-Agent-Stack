// Opt-in real Letta/model probe. Isolated backend; kill only processes we spawn.
import assert from 'node:assert/strict';
import {readFile,writeFile,appendFile,mkdir,copyFile,rm} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {fork,spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {workerHarness} from '../../lean-runtime/test-fixtures/turn-reconnect-harness.mjs';
import {executeSideEffectOnce,readCompletedToolResult} from '../../lean-runtime/source/external_tool_idempotency.ts';
import {patchLettaRecovery} from '../../lean-runtime/letta-recovery-provider-patch.mjs';
const [mode,lettaRoot,outputRoot,conversationId,phase='combined'] = process.argv.slice(2);
const agentId='agent-local-31166c4b-56a4-4e39-9bdb-04a2ed91e41c';
const url='ws://127.0.0.1:4504/ws';
const messageId='openchatx-cold-'+createHash('sha256').update(outputRoot).digest('hex').slice(0,16);
const marker='cold-recovery-one-effect\n';
if (mode==='worker'||mode==='recover') {
  const NativeSocket=globalThis.WebSocket, sockets=new Set();
  const counts={createMessages:0};
  process.on('exit',()=>writeFileSync(join(outputRoot,mode+'-counts.json'),JSON.stringify(counts)));
  const checkpoint=async()=>{await writeFile(join(outputRoot,mode+'-counts.json'),JSON.stringify(counts));process.send({checkpoint:'saved'});await new Promise(()=>{});};
  globalThis.WebSocket=class extends NativeSocket {
    constructor(...args){super(...args);sockets.add(this);this.addEventListener('close',()=>sockets.delete(this));}
    send(data){const message=JSON.parse(data);if(message.type==='input'&&message.payload?.kind==='create_message')counts.createMessages++;return super.send(data);}
  };
  const worker=workerHarness({SERVER_URL:url,
    decideExternalToolApproval:async(_p,name,input)=>{
      assert.equal(name,'openchatx_shell');assert.deepEqual(input,{});
      if(mode==='worker'&&phase==='approval')await checkpoint();
      return {behavior:'allow',updated_input:null,selected_permission_suggestion_ids:[]};},
    readCompletedToolResult:args=>readCompletedToolResult({...args,ledgerDir:join(outputRoot,'ledger')}),
    executeSideEffectOnce:async args=>{
      const result=await executeSideEffectOnce({...args,ledgerDir:join(outputRoot,'ledger')});
      if(mode==='worker'){
        await writeFile(join(outputRoot,mode+'-counts.json'),JSON.stringify(counts));
        process.send({checkpoint:'saved'});
        if(phase==='sockets'){for(const socket of sockets)socket.close();}
        else await new Promise(()=>{});
      }
      return result;
    },
    executeExternalTool:async(_c,_p,_a,name,input)=>{
      assert.equal(name,'openchatx_shell');assert.deepEqual(input,{});
      await appendFile(join(outputRoot,'effect.txt'),marker);
      if(mode==='worker'&&phase==='uncertain')await checkpoint();
      return {content:[{type:'text',text:'{"exit_code":0,"stdout":"COLD_FIXTURE_OK"}'}]};
    }});
  const result=await worker.runTurn({id:'letta-poc',path:resolve(lettaRoot)},{agentId},{conversationId},
    'Controlled crash recovery test. Call the provided openchatx_shell fixture once with {}. It appends a fixed local test marker only. Then reply COLD_FIXTURE_OK. Do not repeat this tool.',
    90000,messageId,undefined,mode==='recover');
  await writeFile(join(outputRoot,mode+'.json'),JSON.stringify(result,null,2));
  await writeFile(join(outputRoot,mode+'-counts.json'),JSON.stringify(counts));
  process.send?.({completed:true,status:result.status,runId:result.run_id});
} else {
  assert.equal(mode,'probe');
  await mkdir(outputRoot);
  const backend=join(outputRoot,'backend');
  await mkdir(join(backend,'agents'),{recursive:true});
  await mkdir(join(backend,'providers'),{recursive:true});
  const source=join(homedir(),'.letta','lc-local-backend');
  const agentFile=Buffer.from(agentId).toString('base64url')+'.json';
  await copyFile(join(source,'agents',agentFile),join(backend,'agents',agentFile));
  await copyFile(join(source,'providers','auth.json'),join(backend,'providers','auth.json'));
  const packageDir=join(lettaRoot,'node_modules/@letta-ai/letta-code');
  // Keep the candidate helper beside a private bundle. Never replace the live
  // service's dynamically imported helper merely to run an isolated probe.
  const candidateDir=join(lettaRoot,'.openchatx-probes',messageId);
  await mkdir(candidateDir,{recursive:true});
  await copyFile(join(packageDir,'package.json'),join(candidateDir,'package.json'));
  const entry=join(candidateDir,'letta.js');
  await writeFile(entry,patchLettaRecovery(await readFile(join(packageDir,'letta.js'),'utf8')));
  await copyFile(new URL('../../lean-runtime/source/letta_recovery.mjs',import.meta.url),join(candidateDir,'openchatx-recovery.mjs'));
  let server,child;let serverIndex=0;let serverText='';
  const startServer=async()=>{
    const index=++serverIndex;
    server=spawn(process.execPath,[entry,'server','--listen',url],{cwd:lettaRoot,windowsHide:true,
      env:{...process.env,LETTA_LOCAL_BACKEND_DIR:backend,LETTA_HOME:join(outputRoot,'home'),LETTA_OPENCHATX_RECOVERY_STATE_DIR:join(outputRoot,'listener-state')},stdio:['ignore','pipe','pipe']});
    for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>{serverText+=chunk;void appendFile(join(outputRoot,`server-${index}.log`),chunk);});
    const {LettaSocket}=workerHarness({REQUEST_TIMEOUT_MS:15000});
    for(let n=0;n<80;n++){
      if(server.exitCode!==null)throw Error('ISOLATED_SERVER_EXITED '+server.exitCode);
      const client=new LettaSocket(url);
      try{await client.connect(500);return client;}catch{client.close();await new Promise(r=>setTimeout(r,250));}
    }
    throw Error('ISOLATED_SERVER_START_TIMEOUT');
  };
  const stop=async process=>{if(!process||process.exitCode!==null)return;const closed=once(process,'close');process.kill('SIGKILL');await closed;};
  const startWorker=(kind,conv)=>{
    child=fork(fileURLToPath(import.meta.url),[kind,lettaRoot,outputRoot,conv,phase],{silent:true,windowsHide:true});
    for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{void appendFile(join(outputRoot,kind+'.log'),chunk);});
    return child;
  };
  try{
    const client=await startServer();
    const created=await client.request({type:'conversation_create',body:{agent_id:agentId,name:'isolated-cold-recovery'}},'conversation_create_response',15000);
    assert.equal(created.success,true,JSON.stringify(created));
    const conv=created.conversation.id;client.close();
    const original=startWorker('worker',conv);
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('CHECKPOINT_TIMEOUT')),100000);
      original.once('message',message=>{clearTimeout(timer);assert.equal(message.checkpoint,'saved');resolve();});
      original.once('exit',code=>{clearTimeout(timer);reject(Error('ORIGINAL_WORKER_EXITED '+code));});
    });
    if(phase==='combined'){await stop(server);await stop(original);const reconnected=await startServer();reconnected.close();}
    else {if(phase==='sockets')await once(original,'exit');else await stop(original);await new Promise(r=>setTimeout(r,1500));}
    const recovered=startWorker('recover',conv);
    const [code]=await once(recovered,'exit');
    let result={external_tool_calls:[]};
    if(phase==='uncertain'){
      assert.equal(code,1);assert.match(await readFile(join(outputRoot,'recover.log'),'utf8'),/RECOVERY_EFFECT_UNCERTAIN/);
    }else{
      assert.equal(code,0,'Recovery worker failed; see recover.log');
      result=JSON.parse(await readFile(join(outputRoot,'recover.json'),'utf8'));
      assert.equal(result.status,'completed');
      assert.ok(result.approval_decisions.every(item=>item.toolName==='openchatx_shell'));
    }
    assert.equal(await readFile(join(outputRoot,'effect.txt'),'utf8'),marker);
    const initialCounts=JSON.parse(await readFile(join(outputRoot,'worker-counts.json'),'utf8'));
    const recoveryCounts=JSON.parse(await readFile(join(outputRoot,'recover-counts.json'),'utf8'));
    assert.equal(initialCounts.createMessages,1);assert.equal(recoveryCounts.createMessages,0);
    const receipt={schema:1,status:'passed',outcome:phase==='uncertain'?'uncertain_effect_blocked':'resumed',phase,providerVersion:'0.34.1',agentId,conversationId:conv,clientMessageId:messageId,
      providerRestarts:serverIndex-1,workerRestarts:1,executionCount:1,runId:result.run_id,
      originalPromptSubmissions:initialCounts.createMessages,recoveryPromptSubmissions:recoveryCounts.createMessages,
      recoveredOriginalToolIds:result.external_tool_calls.filter(call=>call.replayed).map(call=>call.toolCallId),
      workerSourceSha256:createHash('sha256').update(await readFile(new URL('../../lean-runtime/source/letta_worker.ts',import.meta.url))).digest('hex'),
      timestamp:new Date().toISOString(),scope:'Isolated real Letta backend and model; hard process termination; source Worker and fixed append fixture. Shared MSI/PC2 service untouched.'};
    await writeFile(join(outputRoot,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
  }finally{await stop(child);await stop(server);await rm(join(backend,'providers','auth.json'),{force:true});}
}
