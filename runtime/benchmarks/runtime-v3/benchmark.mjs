import {mkdir,readFile,writeFile,readdir,copyFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url)),cache=join(here,'.cache');
const hash=x=>createHash('sha256').update(x).digest('hex');
async function inventory(root){const result={};for(const entry of await readdir(root,{recursive:true,withFileTypes:true})){
 if(entry.isSymbolicLink())throw Error('LINK_REFUSED');if(entry.isFile()){
 const path=join(entry.parentPath,entry.name);result[path.slice(root.length+1).replaceAll('\\','/')]=hash(await readFile(path));
 }}return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b)));}
const [mode,id]=process.argv.slice(2);
if(mode==='prepare'){
 const baseline=spawnSync('git',['show','a3e1fd5:runtime/lean-runtime/runtime_contract.ts'],{cwd:join(here,'../../..'),encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
 if(baseline.status!==0||hash(baseline.stdout)!=='6ec30f77ae49e86482592211752ff8e4bf219dab09014afa305a827d5a6295ce')throw Error('BASELINE_UNAVAILABLE_OR_CHANGED');
 await mkdir(cache);let common;
 for(let round=1;round<=3;round++)for(const engine of ['codex','openchatx']){
  const id=`${engine}-${round}`,root=join(cache,id);await mkdir(root);await mkdir(join(root,'.tools'));
  for(const name of ['TASK.md','acceptance.test.mjs'])await copyFile(join(here,name),join(root,name));
  await writeFile(join(root,'runtime_contract.ts'),baseline.stdout);
  await copyFile(process.execPath,join(root,'.tools/node.exe'));
  await writeFile(join(root,'AGENTS.md'),'Read TASK.md. Work only in this isolated candidate. One Developer, no sibling/reference access or other agents. Only runtime_contract.ts and PROGRESS.md may change. Backend-only; no UI work.\n');
  const initial=await inventory(root);const fingerprint=hash(JSON.stringify(initial));
  if(common&&common!==fingerprint)throw Error('INPUTS_DIFFER');common=fingerprint;
  await writeFile(join(cache,id+'.initial.json'),JSON.stringify({id,initial,fingerprint},null,2));
 }
 console.log(JSON.stringify({candidates:6,fingerprint:common}));
}else if(mode==='grade'&&/^(codex|openchatx)-[123]$/.test(id)){
 const root=join(cache,id),before=JSON.parse(await readFile(join(cache,id+'.initial.json'))),after=await inventory(root);
 const changed=Object.keys(after).filter(p=>after[p]!==before.initial[p]);
 const removed=Object.keys(before.initial).filter(p=>!(p in after));
 const unexpected=changed.filter(p=>!['runtime_contract.ts','PROGRESS.md'].includes(p));
 const started=performance.now();const run=spawnSync(join(root,'.tools/node.exe'),['--max-old-space-size=256','--test','--test-concurrency=1','acceptance.test.mjs'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024*1024});
 const result={id,gradedAt:new Date().toISOString(),changed,removed,unexpected,sourceSha256:after['runtime_contract.ts'],elapsedMs:Math.round(performance.now()-started),exitCode:run.status,error:run.error?.code??null,output:run.stdout+run.stderr,passed:run.status===0&&!run.error&&!removed.length&&!unexpected.length};
 await writeFile(join(cache,id+'.grade.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
}else throw Error('Use prepare or grade <codex|openchatx>-<1|2|3>');
