import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { patchPreflight } from './update-runtime.mjs';

test('updater preserves an unexpected preflight edit',async()=>{
  const source=await readFile(new URL('./source/development_preflight.ts',import.meta.url),'utf8');
  assert.equal(patchPreflight(source,source),source);
  assert.throws(()=>patchPreflight('unknown local edit',source),/PREFLIGHT_SOURCE_CHANGED/);
});

test('one loaded preflight entry observes capability updates without a service restart',async()=>{
  const root=await mkdtemp(join(tmpdir(),'preflight-freshness-'));
  try {
    const source=await readFile(new URL('./source/development_preflight.ts',import.meta.url),'utf8');
    const shim=`const chain=new Proxy(function(){return chain},{get(){return chain}}); const z=chain; const defineTool=value=>value;`;
    await writeFile(join(root,'development_preflight.ts'),source.replace('import { defineTool, z } from "openchatx-mcp/toolbox"',shim));
    await writeFile(join(root,'project_executor.ts'),'export const getProject=async id=>({id,permissions:{read:true}});');
    await writeFile(join(root,'review_policy.ts'),'export const revision=1;');
    const capability=join(root,'agent_capabilities.ts');
    await writeFile(capability,'export const revision=1;');
    // The installed gate captures this dependency at module initialization.
    await writeFile(join(root,'development_gate.ts'),`
      import {stat} from 'node:fs/promises';
      const url=new URL('./agent_capabilities.ts',import.meta.url);
      url.searchParams.set('mtime',String((await stat(url)).mtimeMs));
      const {revision}=await import(url.href);
      export const inspectDevelopmentContext=async (project,task)=>({projectId:project.id,classification:{revision},risk:'standard',evidence:{},prompt:task});
      export const inspectDevelopmentGate=async()=>({id:'fixture'});
    `);
    const tool=(await import(pathToFileURL(join(root,'development_preflight.ts')).href)).default;
    const invoke=async()=>JSON.parse((await tool.execute({action:'prepare',project_id:'fixture',task:'backend test',paths:[]})).content[0].text);
    assert.equal((await invoke()).classification.revision,1);
    await writeFile(capability,'export const revision=2;');
    const nextTime=new Date(Date.now()+2000);await utimes(capability,nextTime,nextTime);
    assert.equal((await invoke()).classification.revision,2);
    assert.equal((await invoke()).classification.revision,2);
  } finally {await rm(root,{recursive:true,force:true});}
});
