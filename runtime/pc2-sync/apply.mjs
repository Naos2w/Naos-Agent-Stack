// Run outside the MCP process tree using the owner's temporary scheduled task.
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {hostname} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {sha,digest,noLinks,targetPath} from './prepare.mjs';
import {applyVerifiedFiles,stopServiceForUpdate} from './lib/core-maintenance/apply-audit-diagnostics.mjs';
import {acquireRuntimeMaintenance} from './lib/lean-runtime/runtime_maintenance.mjs';
import {inspectRuntimeReadiness} from './lib/lean-runtime/runtime_readiness.mjs';
import {inspectConsumerRelease,assertConsumerReleaseUnchanged} from './lib/lean-runtime/consumer-release.mjs';
import {verifyCore} from './lib/core-maintenance/verify-core.mjs';
const stage=dirname(fileURLToPath(import.meta.url)),run=promisify(execFile);
const planBytes=await readFile(join(stage,'plan.json'));
if(sha(planBytes)!==process.argv[2]||hostname().toUpperCase()!=='NAOS-PC')throw Error('SYNC_PLAN_OR_HOST_CHANGED');
const plan=JSON.parse(planBytes),{runtime,headless}=plan.roots,toolbox=join(headless,'toolboxes/agent-runtime');
const journal=join(headless,'core-maintenance/.audit-update-pending.json'),pause=join(headless,'health-watch.paused');
const pm2=async args=>(await run(process.execPath,[join(headless,'node_modules/pm2/bin/pm2'),...args],{env:{...process.env,PM2_HOME:join(headless,'pm2')},windowsHide:true,timeout:30000,maxBuffer:20*1024*1024})).stdout;
async function mcp(){const rows=JSON.parse(await pm2(['jlist'])).filter(a=>a.name==='openchatx-mcp');if(rows.length!==1)throw Error('SYNC_MCP_AMBIGUOUS');return rows[0];}
async function preserved(){for(const f of plan.preserved)if(await digest(f.path)!==f.sha256)throw Error('SYNC_PRESERVED_STATE_CHANGED: '+f.path);}
async function quiet(){
 const ops=JSON.parse(await readFile(join(toolbox,'operations.json'),'utf8'));
 if(!ops||Array.isArray(ops)||Object.values(ops).some(o=>!['completed','failed','cancelled'].includes(o?.state)||o.reconciliation?.requiresReconciliation))throw Error('SYNC_OPERATIONS_ACTIVE_OR_UNCERTAIN');
 try{const jobs=JSON.parse(await readFile(join(dirname(headless),'jobs/jobs.json'),'utf8'));if(!Array.isArray(jobs.jobs)||jobs.jobs.some(j=>!['completed','failed','cancelled'].includes(j?.status)))throw Error('SYNC_JOBS_ACTIVE');}catch(e){if(e.code!=='ENOENT')throw e;}
}
async function healthy(){for(let i=0;i<30;i++){try{if((await fetch('http://127.0.0.1:8001/healthz',{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}await delay(500);}throw Error('SYNC_HEALTH_UNVERIFIED');}
let release,stopped=false,createdPause=false,receipt;
try{
 await quiet();await preserved();await healthy();
 if(await digest(journal)!==null||await digest(pause)!==null)throw Error('SYNC_EXISTING_MAINTENANCE');
 const files=[];
 for(const row of plan.files){
  if(targetPath(plan.roots,row)!==row.target)throw Error('SYNC_TARGET_CHANGED');
  await noLinks(row.target);const bytes=await readFile(row.source);
  if(sha(bytes)!==row.after||await digest(row.target)!==row.before)throw Error('SYNC_PREIMAGE_CHANGED: '+row.path);
  files.push({...row,bytes});
 }
 if((await mcp()).pm2_env.status!=='online')throw Error('SYNC_MCP_NOT_ONLINE');
 await writeFile(pause,'Reviewed PC2 migration in progress',{flag:'wx'});createdPause=true;
 release=await acquireRuntimeMaintenance(toolbox);
 const consumers=await inspectConsumerRelease(toolbox,new Map(files
  .filter(f=>f.root==='headless'&&f.path.startsWith('toolboxes/agent-runtime/'))
  .map(f=>[f.path.slice('toolboxes/agent-runtime/'.length),f.bytes])));
 await quiet();await preserved();stopped=true;
 await stopServiceForUpdate({stop:()=>pm2(['stop','openchatx-mcp']),inspect:mcp});
 await quiet();await preserved();
 for(const f of files)await mkdir(dirname(f.target),{recursive:true});
 receipt=await applyVerifiedFiles(files,journal,join(headless,'backups'),{verify:async()=>{
  try{
   await preserved();
   const core=await verifyCore({runtimeRoot:runtime,manifestPath:join(stage,'candidate/headless/core-maintenance/manifest.json'),snapshotRoot:join(headless,'core-maintenance/baseline')});
   if(!core.ok)throw Error('SYNC_CORE_VERIFY_FAILED: '+core.failures.join(';'));
   const worker=pathToFileURL(join(toolbox,'tools/letta_worker.ts')).href;
   const executor=pathToFileURL(join(runtime,'dist/projects/project-executor.js')).href;
   const code='await import('+JSON.stringify(worker)+');const c=await import('+JSON.stringify(executor)+');if(c.SHELL_POLICY_VERSION!==2)throw Error("SHELL_POLICY_MISMATCH");';
   await run(process.execPath,['--input-type=module','-e',code],{env:{...process.env,OPENCHATX_RUNTIME_ROOT:runtime,OPENCHATX_PUBLIC_CONFIG:join(headless,'config/openchatx.toml'),OPENCHATX_APP_DATA:headless},windowsHide:true,timeout:20000});
   await pm2(['restart','openchatx-mcp']);await healthy();
   await assertConsumerReleaseUnchanged(toolbox,consumers);
  }catch(e){await pm2(['stop','openchatx-mcp']);throw e;}
 }});
 await preserved();
 await release();release=null;
 const readiness=await inspectRuntimeReadiness(toolbox);
 if(!readiness.ready||readiness.running)throw Error('SYNC_FINAL_READINESS_FAILED');
 await unlink(pause);createdPause=false;
 await writeFile(join(stage,'result.json'),JSON.stringify({ok:true,...receipt,readiness,preserved:true,sourceCommit:plan.sourceCommit,completedAt:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
 console.log('PC2_SYNC_VERIFIED '+JSON.stringify(receipt));
}catch(e){
 await writeFile(join(stage,'failure.json'),JSON.stringify({ok:false,error:e.message,journal:await digest(journal)!==null,receipt:receipt??null,at:new Date().toISOString()},null,2)+'\n');
 console.error(e.message);process.exitCode=1;
}finally{
 try{
  if(stopped&&await digest(journal)===null){if((await mcp()).pm2_env.status!=='online')await pm2(['restart','openchatx-mcp']);await healthy();if(createdPause){await unlink(pause);createdPause=false;}}
  else if(!stopped&&createdPause){await unlink(pause);createdPause=false;}
 }finally{if(release)await release();}
}
