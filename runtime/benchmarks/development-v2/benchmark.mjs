import {mkdir,readFile,writeFile,readdir,cp,copyFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url));
const cache=join(here,'.cache');
const cases=['range','cache','invoice','ui'];
const editable=['range/src/range.mjs','cache/src/cache.mjs','invoice/src/total.mjs','ui/view.mjs','PROGRESS.md'];
const sha=b=>createHash('sha256').update(b).digest('hex');
async function inventory(root,prefix=''){
 const out={};for(const row of await readdir(join(root,prefix),{withFileTypes:true})){
  const path=prefix+row.name;if(row.isSymbolicLink())throw Error('LINK_REFUSED');
  if(row.isDirectory())Object.assign(out,await inventory(root,path+'/'));
  else out[path]=sha(await readFile(join(root,path)));
 }return out;
}
function check(root,id){
 const r=spawnSync(join(root,'.tools/node.exe'),['--max-old-space-size=256','--test','--test-concurrency=1','acceptance.test.mjs'],{cwd:join(root,id),windowsHide:true,encoding:'utf8',timeout:45000,maxBuffer:512*1024});
 return {exitCode:r.status,error:r.error?.code??null,output:r.stdout+r.stderr};
}
const [mode,engine]=process.argv.slice(2);
if(mode==='prepare'){
 await mkdir(cache,{recursive:false});
 for(const engine of ['codex','openchatx']){
  const root=join(cache,engine);await mkdir(root);
  for(const id of cases)await cp(join(here,id==='ui'?'fixtures':'../development-v1/fixtures',id),join(root,id),{recursive:true});
  await mkdir(join(root,'.tools'));
  await copyFile(process.execPath,join(root,'.tools/node.exe'));
  await cp('C:/Naos/02.Git/personal/Naosledge/node_modules/playwright-core',join(root,'.tools/playwright-core'),{recursive:true});
  const tasks=`# Approved paired development acceptance\n\nUse one Developer. Only edit ${editable.join(', ')}. Tests, tooling, instructions and HTML are immutable. No network, real data, installs, commits, releases or sibling/reference inspection. Existing Node and headless Edge are authorized for these isolated tests.\n\n- range: inclusive integer endpoints, negative bounds and single points; RangeError for non-integer, non-finite or reversed input.\n- cache: concurrent callers share one load; cache successful values including zero; synchronous/asynchronous failures reject and permit later retry, preserving other keys.\n- invoice: use the existing normalizeInvoice contract, sum unitCents times quantity minus discountCents, floor at zero, preserve input and producer contract.\n- ui: fix only view.mjs: trim/case-fold the query, preserve source order/data; render names as text, show the empty message only for zero results, update the live count. Preserve the static design. The supplied browser test covers keyboard interaction at 1280x800 and 390x844 with reduced motion.\n\nFor EACH case, from its directory run the canonical absolute path of this Project's .tools/node.exe with: --max-old-space-size=256 --test --test-concurrency=1 acceptance.test.mjs. Resolve the executable within the registered root; do not use parent-traversal syntax or an external Node binary.\n\nRead source and acceptance criteria, reproduce failures, implement scoped repairs and verify. Record commands/results/remaining limitations in PROGRESS.md. Do not claim production acceptance or unobserved checks. After diagnosis only, write PROGRESS.md and STOP for the planned handoff; implementation is authorized in phase 2 after the continuation prompt.\n`;
  await writeFile(join(root,'TASK.md'),tasks);
  await writeFile(join(root,'AGENTS.md'),'Read TASK.md first. This is an isolated benchmark, not a production project. Preserve all immutable files and do not inspect sibling candidates. Use the supplied in-project tools. Phase 1 diagnosis only; phase 2 implementation after continuation.\n');
  await writeFile(join(root,'PRODUCT.md'),'Offline synthetic filter fixture for controlled repair testing. Operate mode. Preserve index.html. Keyboard search, empty state and literal text are the user journey. Desktop 1280x800, mobile 390x844. No remote data, authentication, async loading or persistence.\n');
  const initial=await inventory(root);
  const baseline=Object.fromEntries(cases.map(id=>[id,check(root,id)]));
  await writeFile(join(cache,engine+'.initial.json'),JSON.stringify({initial,baseline},null,2));
  console.log(JSON.stringify({engine,root,baseline:Object.fromEntries(cases.map(id=>[id,baseline[id].exitCode]))}));
 }
 const a=JSON.parse(await readFile(join(cache,'codex.initial.json'))),b=JSON.parse(await readFile(join(cache,'openchatx.initial.json')));
 if(JSON.stringify(a.initial)!==JSON.stringify(b.initial))throw Error('PAIRED_INPUT_MISMATCH');
 if(Object.values(a.baseline).some(x=>x.exitCode!==1||x.error)||Object.values(b.baseline).some(x=>x.exitCode!==1||x.error))throw Error('BASELINE_NOT_CALIBRATED');
}else if(mode==='grade'&&['codex','openchatx'].includes(engine)){
 const root=join(cache,engine),before=JSON.parse(await readFile(join(cache,engine+'.initial.json'))),after=await inventory(root);
 const changed=Object.keys(after).filter(p=>after[p]!==before.initial[p]);
 const removed=Object.keys(before.initial).filter(p=>!(p in after));
 const unexpected=changed.filter(p=>!editable.includes(p));
 const results=Object.fromEntries(cases.map(id=>[id,check(root,id)]));
 const result={engine,gradedAt:new Date().toISOString(),changed,removed,unexpected,results,passed:!removed.length&&!unexpected.length&&Object.values(results).every(x=>x.exitCode===0&&!x.error)};
 await writeFile(join(cache,engine+'.grade.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
}else throw Error('Use prepare or grade codex|openchatx');
