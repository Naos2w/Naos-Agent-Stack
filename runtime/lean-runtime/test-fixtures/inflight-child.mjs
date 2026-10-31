import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { executeSideEffectOnce } from '../source/external_tool_idempotency.ts';
import { createHandler, request, timeout } from './external-handler-harness.mjs';
const [root,phase]=process.argv.slice(2);
if(!root || !['before-effect','after-effect','after-ledger'].includes(phase)) throw Error('Invalid fixture arguments');
let handler;
function checkpoint() {
  // Keep only this owned child alive until the parent terminates it.
  setInterval(()=>{},1000);
  process.stderr.write('',()=>process.send({checkpoint:phase}));
}
const register=createHandler({
  process,
  executeSideEffectOnce:args=>executeSideEffectOnce({...args,ledgerDir:join(root,'ledger')}),
  executeExternalTool:async()=>{
    process.stderr.write(JSON.stringify(timeout)+'\n');
    if(phase==='before-effect'){checkpoint();await new Promise(()=>{});}
    await appendFile(join(root,'effect.txt'),'one effect\n');
    if(phase==='after-effect'){checkpoint();await new Promise(()=>{});}
    return {content:[{type:'text',text:'{"exit_code":0}'}]};
  },
  decideProjectToolApproval:()=>{throw Error('Unexpected direct file observation');},
});
await register({onMessage:fn=>{handler=fn;return()=>{};},send:()=>checkpoint()}, {id:'fixture'},'fixture-agent',[]);
await handler(request);
