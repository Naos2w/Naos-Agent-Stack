import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { win32 } from 'node:path';
import { decodeCodebaseReply, codebaseFailureCode, summarizeCodebaseCoverage, decodePathCoverage,
  parseCodebaseStatus, resolveCodebaseScopes, classifyCapabilityTask } from './source/agent_capabilities.ts';
import { patchCapabilities } from './update-runtime.mjs';

const root = 'C:\\Synthetic\\project';
const project = {id:'fixture',path:root,permissions:{read:true}};
const ready = {status:'ready',root_path:root,nodes:12,indexed_at:'2026-10-30T00:00:00Z',
  parse_partial:{count:2},parse_unusable:{count:0},skipped:{count:0}};
const reply = (data,isError=false) => JSON.stringify({isError,structuredContent:data,
  content:[{type:'text',text:JSON.stringify(data)}]});
const missing = reply({error:'project not found or not indexed',available_projects:['private-project']},true);

test('missing index is recognized from a real nonzero-exit envelope without exposing other projects',()=>{
  const result=decodeCodebaseReply(missing,'status',1);
  assert.equal(result.data.status,'missing');
  assert.equal(result.data.reason,'PROJECT_NOT_INDEXED');
  assert.doesNotMatch(JSON.stringify(result),/private-project|available_projects/);
  assert.throws(()=>decodeCodebaseReply(missing,'search',1),/CODEBASE_QUERY_ERROR/);
});
test('malformed, unknown and nonzero successful output never becomes a ready index',()=>{
  for(const [text,exit] of [['not-json',0],[reply({status:'future-status'}),0],[reply(ready),1],['{}',0]])
    assert.throws(()=>decodeCodebaseReply(text,'status',exit),/CODEBASE_/);
  assert.equal(parseCodebaseStatus('error: status ready was unavailable').status,'unknown');
});
test('process failures retain bounded categories without returning stderr or command lines',()=>{
  for(const [input,expected] of [
    [{code:'ENOENT'},'CODEBASE_BINARY_UNAVAILABLE'],
    [{code:'EPERM'},'CODEBASE_PROCESS_PERMISSION_DENIED'],
    [{code:'EACCES'},'CODEBASE_PROCESS_PERMISSION_DENIED'],
    [{code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'},'CODEBASE_OUTPUT_LIMIT'],
    [{killed:true},'CODEBASE_QUERY_TIMEOUT'],
    [{code:7,stderr:'private',message:'private'},'CODEBASE_QUERY_FAILED'],
  ])assert.equal(codebaseFailureCode(input),expected);
});
test('coverage gaps survive aggregation; zero or absent counts never assert completeness',()=>{
  const partial=summarizeCodebaseCoverage([ready,{...ready,parse_partial:{count:3}}]);
  assert.equal(partial.partialFiles,5);assert.equal(partial.state,'partial');
  const zero=summarizeCodebaseCoverage([{...ready,parse_partial:{count:0}}]);
  assert.equal(zero.state,'unknown');assert.equal(zero.requestedFilesVerified,false);
  assert.equal(summarizeCodebaseCoverage([{}]).partialFiles,null);
});

// Exercise the real CLI adapter and preflight with process responses, without
// contacting or changing installed indexes in unit tests.
const source=await readFile(new URL('./source/agent_capabilities.ts',import.meta.url),'utf8');
const cliBody=source.slice(source.indexOf('async function codebaseCli('),source.indexOf('\nexport async function loadInstalledSkill'));
const preflightBody=source.slice(source.indexOf('export async function prepareAgentCapabilities')).replace('export async function','async function');
const body=stripTypeScriptTypes(cliBody+'\n'+preflightBody,{mode:'transform'});
function preflight({output=reply(ready),failure=null,excluded=false,coverageFailure=null,coverageData=null,pathReason=null,config={}}={}) {
  let calls=0;
  const requests=[];
  const deps={requireRead:p=>{if(!p.permissions?.read)throw Error('READ_DENIED');},
    fs:{readFile:async()=>JSON.stringify({binary:'configured.exe',excludedProjects:excluded?['fixture']:[],...config})},
    CONFIG_PATH:'config.json',asText:value=>String(value??'').trim(),resolveCodebaseScopes,
    execFileAsync:async(binary,argv,options)=>{
      calls++;const args=JSON.parse(argv[3]);requests.push({tool:argv[2],args,options});
      if(argv[2]==='check_index_coverage') {
        if(coverageFailure)throw coverageFailure;
        return {stdout:reply(coverageData??coverageResponse(args.project,args.paths))};
      }
      if(failure)throw failure;return {stdout:output};
    },
    decodeCodebaseReply,codebaseFailureCode,win32,bounded:text=>text,MAX_TOOL_CHARS:12000,
    summarizeCodebaseCoverage,classifyCapabilityTask,parseCodebaseStatus,decodePathCoverage,
    checkContextFile:async()=>pathReason};
  const run=new Function(...Object.keys(deps),body+';return prepareAgentCapabilities;')(...Object.values(deps));
  return {run:(paths=[])=>run(project,'Analyze codebase architecture',paths),requests,get calls(){return calls;}};
}

function coverageResponse(project,paths) {
  return {project,signal:'best_effort',indexed_at:ready.indexed_at,metadata:{generation_matches:true},
    path_total:paths.length,path_returned:paths.length,path_has_more:false,has_more:false,
    paths:paths.map(path=>({path,requested_path:path,status:'no_recorded_issue',freshness:'metadata_changed',
      recommended_action:'untrusted-provider-text',private:'do-not-copy'}))};
}
test('actual preflight reports an excluded missing index without inventing an outage or rebuilding',async()=>{
  const f=preflight({failure:{code:1,stdout:missing},excluded:true});
  const result=await f.run();
  assert.equal(result.evidence.codebase.status,'missing');
  assert.equal(result.evidence.codebase.reason,'PROJECT_NOT_INDEXED');
  assert.equal(result.evidence.codebase.autoIndexExcluded,true);
  assert.match(result.prompt,/not evidence of a service outage/);
  assert.doesNotMatch(result.prompt,/private-project/);assert.equal(f.calls,1);
});
test('automatic indexing exclusion does not hide an existing manually created index',async()=>{
  const result=await preflight({excluded:true}).run();
  assert.equal(result.evidence.codebase.status,'verified');
  assert.equal(result.evidence.codebase.completeRootCoverage,false);
  assert.equal(result.evidence.codebase.coverage.state,'partial');
  assert.equal(result.evidence.codebase.freshness,'not_checked');
  assert.match(result.prompt,/does not prove requested-file coverage/);
});
test('actual preflight distinguishes query timeout from missing index and does not retry',async()=>{
  const f=preflight({failure:{killed:true,stdout:reply(ready),stderr:'private'}});
  const result=await f.run();
  assert.equal(result.evidence.codebase.status,'error');
  assert.equal(result.evidence.codebase.reason,'CODEBASE_QUERY_TIMEOUT');
  assert.equal(f.calls,1);assert.doesNotMatch(result.prompt,/private/);
});
test('root mismatch cannot certify another project as usable context',async()=>{
  const result=await preflight({output:reply({...ready,root_path:'C:\\Another\\private'})}).run();
  assert.equal(result.evidence.codebase.status,'error');
  assert.equal(result.evidence.codebase.reason,'CODEBASE_INDEX_ROOT_MISMATCH');
  assert.doesNotMatch(result.prompt,/Another|private/);
});
test('updater refuses unexpected capability edits and accepts the already applied source',()=>{
  assert.throws(()=>patchCapabilities('unexpected custom source',source),/CAPABILITY_SOURCE_CHANGED/);
  assert.equal(patchCapabilities(source,source),source);
});

test('exact files get a bounded metadata query and no directory scan or automatic reindex',async()=>{
  const f=preflight(),result=await f.run(['src/main.ts','src/cache.ts']);
  assert.equal(result.evidence.codebase.pathChecks.state,'checked');
  assert.equal(result.evidence.codebase.pathChecks.checked,2);
  assert.equal(result.evidence.codebase.freshness,'path_metadata_observed');
  assert.deepEqual(f.requests.map(r=>r.tool),['index_status','check_index_coverage']);
  assert.deepEqual(f.requests[1].args.paths,['src/main.ts','src/cache.ts']);
  assert.equal(f.requests[1].args.path_limit,2);
  assert.ok(f.requests.every(r=>r.options.timeout<=12000));
  assert.doesNotMatch(JSON.stringify(result),/untrusted-provider-text|do-not-copy/);
  assert.equal(result.evidence.codebase.completeRootCoverage,false);
  assert.match(result.prompt,/Metadata changes do not prove content changed/);
});
test('configured subtree maps project-relative hints to index-relative exact files',async()=>{
  const f=preflight({config:{projectIndexScopes:{fixture:[{name:'source',relativePath:'src'},{name:'docs',relativePath:'docs'}]}},
    output:reply({...ready,root_path:root+'\\src'})});
  const result=await f.run(['src/cache.ts']);
  assert.equal(f.requests[0].args.project,'source');
  assert.deepEqual(f.requests[1].args.paths,['cache.ts']);
  assert.equal(result.evidence.codebase.pathChecks.files[0].path,'src/cache.ts');
  assert.equal(result.evidence.codebase.pathChecks.checked,1);
});
test('missing index and unreadable/non-file paths are never submitted to coverage',async()=>{
  for(const options of [{failure:{code:1,stdout:missing}}, {pathReason:'CONTEXT_PATH_NOT_READABLE'}, {pathReason:'CONTEXT_PATH_NOT_FILE'}]) {
    const f=preflight(options),r=await f.run(['src/main.ts']);
    assert.equal(r.evidence.codebase.pathChecks.state,'unavailable');
    assert.equal(f.calls,1);
  }
});

test('overlapping indexes and duplicate hints query a file once in the most specific scope',async()=>{
  const f=preflight({config:{projectIndexScopes:{fixture:[{name:'parent',relativePath:''},{name:'source',relativePath:'src'}]}},
    output:reply({...ready,root_path:root+'\\src'})});
  const result=await f.run(['src/cache.ts','src\\cache.ts']);
  assert.deepEqual(f.requests.map(r=>r.args.project),['source','source']);
  assert.equal(result.evidence.codebase.pathChecks.requested,1);
  assert.equal(result.evidence.codebase.pathChecks.checked,1);
});

test('known non-code files still request context without classifying them as UI',()=>{
  assert.deepEqual(classifyCapabilityTask('Read the selected setting',['settings.json']),
    {codebase:true,ui:false,motion:false,marketing:false,shadcn:false});
});
test('failed coverage retains verified root and marks the requested file as unverified without retry',async()=>{
  const f=preflight({coverageFailure:{killed:true,stderr:'private'}}),r=await f.run(['src/main.ts']);
  assert.equal(r.evidence.codebase.status,'verified');
  assert.equal(r.evidence.codebase.pathChecks.state,'unavailable');
  assert.equal(r.evidence.codebase.pathChecks.files[0].reason,'CODEBASE_QUERY_TIMEOUT');
  assert.equal(f.calls,2);
});
test('coverage rejects missing/duplicate/unrelated paths, incomplete pages and changed generation',()=>{
  const bindings=[{path:'src/main.ts',relative:'main.ts'}];
  for(const mutate of [r=>r.project='other',r=>r.paths=[],r=>r.path_has_more=true,
    r=>r.indexed_at='changed',r=>r.metadata.generation_matches=false,
    r=>r.paths[0].path='other.ts',r=>r.paths[0].requested_path='other.ts',
    r=>{r.paths.push(r.paths[0]);r.path_total=2;r.path_returned=2;}]) {
    const response=coverageResponse('source',['main.ts']);mutate(response);
    assert.throws(()=>decodePathCoverage(response,{name:'source'},ready.indexed_at,bindings),/CODEBASE_COVERAGE_/);
  }
});
