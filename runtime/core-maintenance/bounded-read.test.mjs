import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('./baseline/project-executor.js',import.meta.url),'utf8');
// Execute the actual read branch with an instrumented filesystem. The fixture
// represents a large file without allocating that file in test memory.
const start=source.indexOf('export async function executeProjectTool');
const branch=source.slice(source.indexOf('        if (toolName === "openchatx_read_file")',start),source.indexOf('        if (toolName === "openchatx_write_file")',start));
async function read(text,limit,{file=true,permission=true}={}){
 const reads=[];let closed=0;
 const fs={stat:async()=>({isFile:()=>file}),open:async()=>({stat:async()=>({isFile:()=>file}),
  read:async(buffer,offset,length)=>{reads.push(length);if(reads.length>1)return {bytesRead:0};
   const data=text===null?Buffer.alloc(length,65):Buffer.from(text);const n=Math.min(length,data.length);data.copy(buffer,offset,0,n);return {bytesRead:n};},
  close:async()=>closed++})};
 const run=new Function('fs','requirePermission','resolveProjectPath','assertRealPathAllowed','truncate',
  'return async function(project,toolName,input){'+branch+'}')(fs,()=>{if(!permission)throw Error('DENIED');},()=>'/fixture',async()=>'/fixture',
  (raw,n)=>({text:raw.slice(0,n),truncated:raw.length>n}));
 const result=await run({},'openchatx_read_file',{path:'large',max_chars:limit});
 return {...JSON.parse(result.content[0].text),reads,closed};
}
test('large file actual read is bounded, handle closes, and truncation is truthful',async()=>{
 const r=await read(null,3000);assert.equal(r.content.length,3000);assert.equal(r.truncated,true);
 assert.deepEqual(r.reads,[12004]);assert.equal(r.closed,1);
});
test('UTF-8, empty files, exact limits and invalid limits preserve bounded semantics',async()=>{
 for(const text of ['', '漢字🙂', 'abcdef']){const r=await read(text,6);assert.equal(r.content,text);assert.equal(r.truncated,false);assert.equal(r.closed,1);}
 const r=await read(null,NaN);assert.equal(r.content.length,20000);assert.deepEqual(r.reads,[80004]);
});
test('non-files and denied reads fail before opening a handle',async()=>{
 await assert.rejects(read('',2,{file:false}),/NOT_A_FILE/);
 await assert.rejects(read('',2,{permission:false}),/DENIED/);
});
