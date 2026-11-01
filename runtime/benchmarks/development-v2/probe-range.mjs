// Exploratory post-acceptance probe, deliberately separate from the frozen tests.
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url));
const label=process.argv[2];
if(!['before-feedback','after-feedback'].includes(label))throw Error('Use before-feedback or after-feedback');
const results=[];
for(const engine of ['codex','openchatx']){
 const source=join(here,'.cache',engine,'range/src/range.mjs');
 const code=`import {sumInclusive} from ${JSON.stringify(pathToFileURL(source).href)};
 const a=1e20,b=a+16384;
 const expected=Number((BigInt(a)+BigInt(b))*(BigInt(b)-BigInt(a)+1n)/2n);
 const actual=sumInclusive(a,b);console.log(JSON.stringify({actual,expected}));
 if(actual!==expected)process.exitCode=1;`;
 const r=spawnSync(process.execPath,['--max-old-space-size=128','--input-type=module','-e',code],{encoding:'utf8',timeout:2000,windowsHide:true});
 results.push({engine,sourceSha256:createHash('sha256').update(await readFile(source)).digest('hex'),exitCode:r.status,error:r.error?.code??null,output:r.stdout+r.stderr});
}
const result={scope:'exploratory post-hoc numeric boundary; not in initial frozen acceptance',label,checkedAt:new Date().toISOString(),results};
await writeFile(join(here,'.cache',label+'.json'),JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify(result));
if(results.some(r=>r.exitCode!==0||r.error))process.exitCode=1;
