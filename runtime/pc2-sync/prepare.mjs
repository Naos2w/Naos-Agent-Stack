// One reviewed NAOS-PC migration from the pinned MSI candidate, not a generic upgrader.
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {homedir,hostname} from 'node:os';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex').toUpperCase();
export function targetPath(roots,row) {
  if(!Object.hasOwn(roots,row.root)||typeof row.path!=='string'||!row.path||/[\\:]|(^|\/)\.\.?($|\/)/.test(row.path)||row.path.startsWith('/'))throw Error('SYNC_PATH_INVALID');
  const allowed=row.root==='runtime'?row.path.startsWith('dist/'):
    /^(toolboxes\/agent-runtime\/(tools\/|rules\/|skills\/|README\.md$|toolbox\.json$)|codebase-index\/[^/]+\.mjs$|core-maintenance\/|(?:runtime-readiness\.ps1|audit-retention\.mjs|audit-retention-policy\.json|status-headless\.ps1|Watch-OpenChatXHealth\.ps1)$)/.test(row.path);
  if(!allowed)throw Error('SYNC_SCOPE_INVALID');
  return join(roots[row.root],row.path);
}
export async function digest(path){try{return sha(await readFile(path));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export async function noLinks(path){for(let p=resolve(path);;p=dirname(p)){try{if((await lstat(p)).isSymbolicLink())throw Error('SYNC_LINK_REFUSED');}catch(e){if(e.code!=='ENOENT')throw e;}if(dirname(p)===p)break;}}
export async function prepare(stage) {
  if(hostname().toUpperCase()!=='NAOS-PC')throw Error('SYNC_WRONG_HOST');
  const roots={runtime:join(process.env.LOCALAPPDATA,'Programs/OpenChatX/runtime'),headless:join(homedir(),'.openchatx-mcp/headless')};
  const payload=JSON.parse(gunzipSync(Buffer.from((await readFile(join(stage,'payload.json.gz.b64'),'utf8')).trim(),'base64')));
  if(payload.schema!==1||payload.host!=='NAOS-PC'||payload.files.length!==74||payload.sourceBundleSha256!=='C5529684ED996667A6290CA2E326029C15570E8B5AA9CD61E3594C197B544FA8')throw Error('SYNC_BUNDLE_UNRECOGNIZED');
  const pkg=JSON.parse(await readFile(join(roots.runtime,'package.json'),'utf8'));
  if(pkg.name!=='openchatx-mcp'||pkg.version!=='1.0.0-beta.2')throw Error('SYNC_VERSION_MISMATCH');
  const seen=new Set(),files=[];
  for(const row of payload.files){
    const target=targetPath(roots,row);if(seen.has(target))throw Error('SYNC_DUPLICATE_TARGET');seen.add(target);await noLinks(target);
    const bytes=Buffer.from(row.data,'base64');if(sha(bytes)!==row.sha256.toUpperCase())throw Error('SYNC_CONTENT_HASH_MISMATCH');
    const source=join(stage,'candidate',row.root,row.path);await mkdir(dirname(source),{recursive:true});await writeFile(source,bytes,{flag:'wx'});
    const before=await digest(target);files.push({root:row.root,path:row.path,target,source,before,after:sha(bytes)});
    if(before){const saved=join(stage,'before',row.root,row.path);await mkdir(dirname(saved),{recursive:true});await writeFile(saved,await readFile(target),{flag:'wx'});}
  }
  const preserve=['config.json','state.json','operations.json'].map(p=>join(roots.headless,'toolboxes/agent-runtime',p));
  preserve.push(join(dirname(roots.headless),'projects.json'),join(roots.runtime,'dist/tools/search/search-tools.js'));
  const preserved=await Promise.all(preserve.map(async path=>({path,sha256:await digest(path)})));
  const plan={schema:1,host:'NAOS-PC',roots,sourceCommit:payload.sourceCommit,sourceBundleSha256:payload.sourceBundleSha256,files,preserved};
  await writeFile(join(stage,'plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
  return {files:files.length,changed:files.filter(f=>f.before!==f.after).length,existing:files.filter(f=>f.before).length,preserved,planSha256:sha(await readFile(join(stage,'plan.json')))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await prepare(dirname(fileURLToPath(import.meta.url)))));
