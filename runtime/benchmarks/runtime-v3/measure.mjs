// Validator process only; never label this as model/agent/machine memory.
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const here=dirname(fileURLToPath(import.meta.url)),cache=join(here,'.cache');
const preload='data:text/javascript,'+encodeURIComponent('process.on("exit",()=>console.error("RESOURCE_JSON="+JSON.stringify({maxRssKiB:process.resourceUsage().maxRSS,rssBytes:process.memoryUsage().rss})));');
const rows=[];
for(let round=1;round<=3;round++)for(const engine of ['codex','openchatx']){
 const id=`${engine}-${round}`,grade=JSON.parse(await readFile(join(cache,id+'.grade.json')));
 if(!grade.passed)throw Error('CANDIDATE_NOT_PASSED: '+id);
 const root=join(cache,id),samples=[];
 for(let i=0;i<3;i++){
  const start=performance.now();const r=spawnSync(join(root,'.tools/node.exe'),['--max-old-space-size=256','--import',preload,'--test-isolation=none','--test','--test-concurrency=1','acceptance.test.mjs'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024*1024});
  const measurement=r.stderr.match(/RESOURCE_JSON=(\{[^\n]+\})/);
  if(r.status!==0||!measurement)throw Error('MEASUREMENT_FAILED: '+id+' '+r.stderr.slice(-1000));
  samples.push({elapsedMs:Math.round(performance.now()-start),...JSON.parse(measurement[1])});
 }
 rows.push({id,sourceSha256:grade.sourceSha256,samples});
}
const result={scope:'isolated Node validator process; excludes model inference, Codex app, Letta server and machine memory',node:process.version,measuredAt:new Date().toISOString(),rows};
await writeFile(join(cache,'resources.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
