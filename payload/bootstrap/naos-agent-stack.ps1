[CmdletBinding()]
param(
  [Parameter(Position=0)][ValidateSet('export','verify','install','doctor','tunnel')][string]$Mode='doctor',
  [string]$BundlePath="$HOME\Desktop\naos-headless-stack-bundle.zip",
  [string]$LettaRoot='C:\Naos\02.Git\personal\Letta-POC',
  [string]$TunnelId='',
  [switch]$DryRun,
  [switch]$Start,
  [switch]$Force
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$Headless=Join-Path $HOME '.openchatx-mcp\headless'
$Runtime=Join-Path $env:LOCALAPPDATA 'Programs\OpenChatX\runtime'
function Log([string]$s){Write-Host "[Naos Headless] $s"}
function Fail([string]$s){throw "[Naos Headless] $s"}
function EnsureDir([string]$p){if(-not(Test-Path -LiteralPath $p)){New-Item -ItemType Directory -Force -Path $p|Out-Null}}
function Require([string]$p){if(-not(Test-Path -LiteralPath $p)){Fail "Missing $p"}}
function WriteUtf8([string]$p,[string]$s){EnsureDir (Split-Path -Parent $p);[IO.File]::WriteAllText($p,$s,[Text.UTF8Encoding]::new($false))}
function ReadJson([string]$p){return (Get-Content -LiteralPath $p -Raw -Encoding UTF8|ConvertFrom-Json)}
function AddFile([System.Collections.ArrayList]$a,[string]$source,[string]$key){
  if(-not(Test-Path -LiteralPath $source -PathType Leaf)){return}
  # Individually selected entry points (scripts, manifests, toolboxes) must
  # receive the same linked-source protection as recursive exports.
  $cursor=[IO.Path]::GetFullPath($source)
  while($cursor){
    $node=Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
    if(($node.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){
      Fail ('Linked bundle source refused: '+$key)
    }
    $parent=Split-Path -Path $cursor -Parent
    if(-not $parent -or $parent -eq $cursor){break}
    $cursor=$parent
  }
  [void]$a.Add([pscustomobject]@{Source=$source;Key=$key.Replace('\','/')})
}
function AddTree([System.Collections.ArrayList]$a,[string]$root,[string]$prefix,[string]$type){
  if(-not(Test-Path -LiteralPath $root)){return}
  $root=(Resolve-Path -LiteralPath $root).Path.TrimEnd('\')
  foreach($f in (Get-ChildItem -LiteralPath $root -Recurse -File)){
    $rel=$f.FullName.Substring($root.Length).TrimStart('\').Replace('\','/')
    if($type -ne 'runtime' -and $rel -match '(?i)(^|/)node_modules(/|$)'){continue}
    if($rel -match '(?i)(^|/)(\.env(?:\.[^/]*)?|\.git|\.ssh|\.aws|\.letta|\.ops|\.services|\.external-tool-ledger|tunnel-profiles|backups|logs|secrets|credentials)(/|$)|(^|/)(state|operations|letta-service|projects|mcp-servers|subagents)\.json$|(\.pem|\.p12|\.pfx|\.key|\.log|\.db|\.sqlite|\.zst)$'){continue}
    # Runtime dependencies can contain registry credentials too; never ship local npm/pip config.
    if($rel -match '(?i)(^|/)(\.npmrc|\.yarnrc(\.yml)?|\.pypirc|\.netrc)$'){continue}
    if($type -ne 'runtime' -and $rel -match '(?i)(^|/)(private|memory|memories|sessions|session|state|storage|profiles|auth|tokens|cache|tmp|temp|artifacts|fixtures)(/|$)'){continue}
    if($type -eq 'toolboxes' -and -not($rel -match '(?i)(\.ts|\.mjs|\.cjs|\.md|\.mdc|toolbox\.json)$')){continue}
    # Only these reviewed current-policy documents accompany executable runtime
    # source. Historical reports and arbitrary user rules remain excluded.
    $currentRuntimeDocument=($prefix -eq 'toolboxes/agent-runtime' -and
      $rel -cin @('README.md','rules/shared-development-preflight.mdc','rules/runtime-anti-loop-triage.mdc'))
    if($type -eq 'toolboxes' -and $rel -match '(?i)\.mdc?$' -and
      $rel -notmatch '(?i)^skills/[^/]+/SKILL\.md$' -and -not $currentRuntimeDocument){continue}
    if($type -eq 'codebase-index' -and ($rel -notmatch '(?i)\.(mjs|cjs)$' -or $rel -match '(?i)\.(test|spec)\.(mjs|cjs)$')){continue}
    # Letta's private runtime state is not application source; only ship the minimal POC scripts.
    if($type -eq 'letta' -and $rel -notmatch '(?i)^(package(-lock)?\.json|compact-poc\.mjs|scripts/([a-z0-9._-]+/)*[a-z0-9._-]+\.(js|mjs|ps1))$'){continue}
    # Reject reparse points for Runtime dependencies as well as source files.
    # A linked node_modules subtree could otherwise import files from outside the approved roots.
    if(($f.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){Fail ('Symlinked bundle source refused: '+$prefix+'/'+$rel)}
    $directory=$f.Directory
    while($null -ne $directory -and $directory.FullName.Length -ge $root.Length){
      if(($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){Fail ('Junction bundle source refused: '+$prefix+'/'+$rel)}
      if($directory.FullName -eq $root){break}
      $directory=$directory.Parent
    }
    AddFile $a $f.FullName ($prefix+'/'+$rel)
  }
}
# Rewrite only packaging metadata and the portable tunnel executable locator.
# Never modify the running MSI/NAOS-PC source, and hash the actual ZIP bytes.
function GetPortableBundleText([string]$source,[string]$key) {
  if($key -eq 'headless/tunnel-wrapper.ps1'){
    $content=[IO.File]::ReadAllText($source,[Text.Encoding]::UTF8)
    $pattern='(?m)^\$tunnelExe\s*=\s*(?:"[^"\r\n]*"|Join-Path\s+\$env:LOCALAPPDATA\s+"[^"\r\n]*")\s*$'
    if(@([regex]::Matches($content,$pattern)).Count -ne 1){Fail 'Unknown tunnel-wrapper source; cannot export portable runtime path'}
    $replacement='$tunnelExe = Join-Path $env:LOCALAPPDATA "Programs\OpenChatX\runtime\bin\tunnel-client.exe"'
    return [regex]::Replace($content,$pattern,$replacement)
  }
  if($key -match '(?i)^toolboxes/agent-runtime/tools/[a-z0-9._-]+\.openchatx\.mjs$'){
    $content=[IO.File]::ReadAllText($source,[Text.Encoding]::UTF8)
    # Generated debugger sourceURL comments expose the builder's home directory.
    # They are not runtime dependencies; stripping them leaves module logic intact.
    $portable=[regex]::Replace($content,'(?m)^[ \t]*//# sourceURL=[^\r\n]*(?:\r?\n)?','')
    if($portable -match '(?i)[a-z]:[\\/](?:Users|Naos)[\\/]'){Fail ('Compiled toolbox embeds source-machine path: '+$key)}
    return $portable
  }
  return $null
}
function AddBundleZipEntry([IO.Compression.ZipArchive]$zip,[pscustomobject]$item){
  $portable=GetPortableBundleText $item.Source $item.Key
  if($null -ne $portable){
    $bytes=[Text.UTF8Encoding]::new($false).GetBytes($portable)
    $entry=$zip.CreateEntry($item.Key,[IO.Compression.CompressionLevel]::Optimal)
    $stream=$entry.Open()
    try{$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
    $hash=[Security.Cryptography.SHA256]::Create()
    try{$digest=([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
  }else{
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$item.Source,$item.Key,[IO.Compression.CompressionLevel]::Optimal)|Out-Null
    $digest=(Get-FileHash -LiteralPath $item.Source -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  return [ordered]@{path=$item.Key;sha256=$digest}
}
function RequiredBundleEntries {
  @(
    'runtime/package.json',
    'runtime/dist/index.js',
    'runtime/bin/node.exe',
    'runtime/bin/tunnel-client.exe',
    'headless/package.json',
    'headless/package-lock.json',
    'headless/start-headless.ps1',
    'headless/stop-headless.ps1',
    'headless/status-headless.ps1',
    'headless/Watch-OpenChatXHealth.ps1',
    'headless/runtime-readiness.ps1',
    'headless/audit-retention.mjs',
    'headless/audit-retention-policy.json',
    'headless/core-maintenance/verify-core.mjs',
    'headless/core-maintenance/Test-OpenChatXCorePatch.ps1',
    'headless/core-maintenance/manifest.json',
    'headless/core-maintenance/baseline/project-executor.js',
    'headless/core-maintenance/baseline/audit-log.js',
    'headless/core-maintenance/baseline/audit-format.js',
    'headless/core-maintenance/baseline/audit-request.js',
    'headless/core-maintenance/baseline/audit-response.js',
    'headless/core-maintenance/baseline/http-server.js',
    'headless/core-maintenance/baseline/tool-schema-presentation.js',

    'headless/core-maintenance/baseline/config.js',

    'headless/core-maintenance/baseline/summary-registry.js',

    'headless/core-maintenance/baseline/summarize-tool.js',
    'headless/tunnel-launcher.cjs',
    'headless/tunnel-wrapper.ps1',
    'headless/import-persistent-environment.ps1',
    'headless/codebase-project-sync.mjs',
    'headless/codebase-index/ecosystem.config.cjs',
    'headless/codebase-index/qa-review-bundle-source.mjs',
    'toolboxes/agent-runtime/toolbox.json',
    'toolboxes/skills/toolbox.json',
    'toolboxes/agent-runtime/tools/agent_runtime.ts',
    'toolboxes/agent-runtime/tools/letta_worker.ts',
    'toolboxes/agent-runtime/tools/external_tool_idempotency.ts',
    'toolboxes/agent-runtime/tools/runtime_contract.ts',
    'toolboxes/agent-runtime/tools/model_routing.mjs',
    'toolboxes/agent-runtime/tools/tool_evidence.mjs',
    'toolboxes/agent-runtime/tools/agent_capabilities.ts',
    'toolboxes/agent-runtime/tools/runtime_maintenance.mjs',
    'toolboxes/agent-runtime/tools/runtime_readiness.mjs',
    'toolboxes/agent-runtime/tools/operation_reconciliation.mjs',
    'toolboxes/agent-runtime/README.md',
    'toolboxes/agent-runtime/rules/shared-development-preflight.mdc',
    'toolboxes/agent-runtime/rules/runtime-anti-loop-triage.mdc',
    'toolboxes/agent-runtime/skills/agent-runtime-usage/SKILL.md',
    'letta-poc/package.json',
    'letta-poc/package-lock.json',
    'letta-poc/compact-poc.mjs',
    'letta-poc/scripts/postinstall-patches.mjs',
    'naos-agent-stack.ps1',
    'README.md'
  )
}
# Validate the complete staged archive before changing an existing export.
# A partial write or bad manifest must leave the previously verified ZIP intact.
function PublishCoreExport([string]$staged,[string]$target,[bool]$allowReplace) {
  $hadTarget=Test-Path -LiteralPath $target
  if($hadTarget -and -not $allowReplace){Fail 'Bundle already exists; use -Force'}
  $backup=$target+'.'+[guid]::NewGuid().ToString('N')+'.backup'
  $published=$false
  try {
    $null=VerifyBundle $staged
    if($hadTarget){[IO.File]::Replace($staged,$target,$backup)}
    else{[IO.File]::Move($staged,$target)}
    $published=$true
  }finally{
    if(Test-Path -LiteralPath $staged){Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue}
    if($published -and (Test-Path -LiteralPath $backup)){
      Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
    }
    # Preserve the backup on a failed replacement so recovery is possible.
  }
}
function ExportStack {
  foreach($p in @((Join-Path $Runtime 'package.json'),(Join-Path $Runtime 'bin\node.exe'),(Join-Path $Runtime 'bin\tunnel-client.exe'),(Join-Path $Headless 'package-lock.json'),(Join-Path $Headless 'start-headless.ps1'),(Join-Path $Headless 'codebase-project-sync.mjs'),(Join-Path $Headless 'codebase-index\ecosystem.config.cjs'),(Join-Path $Headless 'codebase-index\qa-review-bundle-source.mjs'),(Join-Path $Headless 'toolboxes\agent-runtime\toolbox.json'),(Join-Path $Headless 'toolboxes\skills\toolbox.json'),(Join-Path $Headless 'toolboxes\agent-runtime\tools\agent_runtime.ts'),(Join-Path $LettaRoot 'package-lock.json'),(Join-Path $LettaRoot 'scripts\postinstall-patches.mjs'))){Require $p}
  $items=New-Object System.Collections.ArrayList
  foreach($d in @('dist','node_modules','ui\dist')){AddTree $items (Join-Path $Runtime $d) ('runtime/'+$d.Replace('\','/')) 'runtime'}
  foreach($f in @('package.json','bin\node.exe','bin\tunnel-client.exe')){AddFile $items (Join-Path $Runtime $f) ('runtime/'+$f.Replace('\','/'))}
  foreach($f in @('package.json','package-lock.json','start-headless.ps1','stop-headless.ps1','status-headless.ps1','tunnel-launcher.cjs','tunnel-wrapper.ps1','import-persistent-environment.ps1','codebase-project-sync.mjs','codebase-index\ecosystem.config.cjs')){AddFile $items (Join-Path $Headless $f) ('headless/'+$f)}
  # Do not publish user-installed skills/toolboxes from the active MSI profile.
  foreach($f in @('Watch-OpenChatXHealth.ps1','runtime-readiness.ps1','audit-retention.mjs','audit-retention-policy.json','core-maintenance/verify-core.mjs','core-maintenance/Test-OpenChatXCorePatch.ps1','core-maintenance/manifest.json','core-maintenance/baseline/project-executor.js','core-maintenance/baseline/audit-log.js','core-maintenance/baseline/audit-format.js','core-maintenance/baseline/audit-request.js','core-maintenance/baseline/audit-response.js','core-maintenance/baseline/http-server.js','core-maintenance/baseline/tool-schema-presentation.js','core-maintenance/baseline/config.js','core-maintenance/baseline/summary-registry.js','core-maintenance/baseline/summarize-tool.js')){
    AddFile $items (Join-Path $Headless $f) ('headless/'+$f)
  }
  # Built-in toolboxes are compiled into the runtime; include their safe descriptors
  # and the Agent Runtime source, including disabled QA modules still statically imported.
  $coreToolboxes=@('agent-runtime','files','goals','jobs','mcp-manager','media','nodes','projects','providers','rules','search','shell','skills','store','subagents','system','teams','toolbox-manager')
  foreach($name in $coreToolboxes){
    $toolboxRoot=Join-Path $Headless ('toolboxes\'+$name)
    if($name -eq 'agent-runtime'){
      AddTree $items $toolboxRoot ('toolboxes/'+$name) 'toolboxes'
    }else{
      # Other built-ins run from the bundled Runtime; include descriptors, not user rules or skills.
      AddFile $items (Join-Path $toolboxRoot 'toolbox.json') ('toolboxes/'+$name+'/toolbox.json')
    }
  }
  # Some enabled Letta worker imports still reference disabled QA helper modules.
  # Package source modules without historical reports, fixtures, test data or private indexes.
  AddTree $items (Join-Path $Headless 'codebase-index') 'headless/codebase-index' 'codebase-index'
  AddTree $items $LettaRoot 'letta-poc' 'letta'
  AddFile $items $PSCommandPath 'naos-agent-stack.ps1'
  $base=Split-Path -Parent $PSCommandPath
  $readme=Join-Path $base 'README_HEADLESS.md'
  if(-not(Test-Path -LiteralPath $readme)){$readme=Join-Path $base 'README.md'}
  # Source checkout and Complete installer put the README two levels above payload/bootstrap.
  if(-not(Test-Path -LiteralPath $readme)){$readme=Join-Path $base '..\..\README.md'}
  AddFile $items $readme 'README.md'
  $items=@($items|Sort-Object Key -Unique)
  $included=@($items|ForEach-Object {$_.Key})
  foreach($required in (RequiredBundleEntries)){
    if($included -notcontains $required){Fail ('Required export source missing: '+$required)}
  }
  foreach($name in $coreToolboxes){
    if($included -notcontains ('toolboxes/'+$name+'/toolbox.json')){Fail ('Required core toolbox descriptor missing: '+$name)}
  }
  if($DryRun){Log ('Would bundle '+$items.Count+' whitelisted files; no changes');return}
  $target=[IO.Path]::GetFullPath($BundlePath)
  EnsureDir (Split-Path -Parent $target)
  if((Test-Path -LiteralPath $target) -and -not $Force){Fail 'Bundle already exists; use -Force'}
  $staged=Join-Path (Split-Path -Parent $target) ('.'+[IO.Path]::GetFileName($target)+'.'+[guid]::NewGuid().ToString('N')+'.staging')
  try{
    $zip=[IO.Compression.ZipFile]::Open($staged,[IO.Compression.ZipArchiveMode]::Create)
    try{
      $meta=New-Object System.Collections.ArrayList
      foreach($item in $items){
        [void]$meta.Add((AddBundleZipEntry $zip $item))
      }
      $version=(ReadJson (Join-Path $Runtime 'package.json')).version
      $manifest=[ordered]@{format=2;arch=$env:PROCESSOR_ARCHITECTURE;version=$version;createdUtc=[DateTime]::UtcNow.ToString('o');files=@($meta.ToArray());excluded=@('Tunnel secrets and profiles','OAuth','Letta Agent memory','Project registry','Session state','Logs')}
      $entry=$zip.CreateEntry('manifest.json')
      $writer=New-Object IO.StreamWriter($entry.Open(),[Text.UTF8Encoding]::new($false))
      try{$writer.Write(($manifest|ConvertTo-Json -Depth 10))}finally{$writer.Dispose()}
    }finally{$zip.Dispose()}
    PublishCoreExport $staged $target ([bool]$Force)
  }finally{
    if(Test-Path -LiteralPath $staged){Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue}
  }
  Log ('Created '+$target+' from MSI Headless; '+$items.Count+' files; runtime '+$version)
}
function VerifyBundle([string]$bundle){
  Require $bundle
  $zip=[IO.Compression.ZipFile]::OpenRead($bundle)
  try{
    $entries=@{}
    foreach($e in $zip.Entries){
      $n=$e.FullName.Replace('\','/')
      if(-not $n -or $n.EndsWith('/') -or
         $n -match '(^/|(^|/)\.\.?(/|$)|//|:)'){
        Fail ('Unsafe ZIP entry: '+$n)
      }
      if($entries.ContainsKey($n)){Fail ('Duplicate ZIP entry: '+$n)}
      # Apply the Complete builder's public-core policy to standalone installs.
      # A self-consistent manifest cannot authorize credentials or private state.
      if($n -ne 'manifest.json'){
        if(-not($n -cmatch '^(runtime|headless|toolboxes|letta-poc)/' -or
                 $n -cin @('naos-agent-stack.ps1','README.md'))){
          Fail ('Unexpected bundle path: '+$n)
        }
        if($n -match '(?i)(^|/)(\.env(?:\.[^/]*)?|\.npmrc|\.yarnrc(?:\.yml)?|\.pypirc|\.netrc|\.ssh|\.aws|\.git|\.letta|logs|secrets|credentials|tunnel-profiles|backups|sessions|memories|tokens)(/|$)|\.(pem|p12|pfx|key|log|db|sqlite|zst)$' -or
           $n -match '(?i)^(runtime|headless|letta-poc)/(config|projects|state|storage|auth|profiles|cache|tmp|temp|artifacts|fixtures|user-data|userdata)/|^(?i:letta-poc/node_modules/)'){
          Fail ('Private bundle path refused: '+$n)
        }
      }
      $entries[$n]=$e
    }
    if(-not $entries.ContainsKey('manifest.json')){Fail 'Bundle manifest missing'}
    # Match the Complete builder: reject oversized metadata before allocating it.
    if($entries['manifest.json'].Length -gt 4194304){Fail 'Bundle manifest too large'}
    $reader=New-Object IO.StreamReader($entries['manifest.json'].Open())
    try{$m=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose()}
    if($m.format -ne 2){Fail 'Old Desktop bundle is incompatible; export new Headless v2'}
    if($m.arch -ne $env:PROCESSOR_ARCHITECTURE){Fail 'Windows CPU architecture mismatch'}
    if($m.version -ne '1.0.0-beta.2'){Fail 'Unverified OpenChatX core version; cannot apply local patches'}
    $declared=@($m.files|ForEach-Object {[string]$_.path})
    foreach($required in (RequiredBundleEntries)){
      if($declared -notcontains $required){Fail ('Required bundle component missing: '+$required)}
    }
    if($declared -contains 'manifest.json' -or @($declared|Select-Object -Unique).Count -ne $declared.Count){
      Fail 'Bundle manifest has duplicate or reserved paths'
    }
    foreach($name in $entries.Keys){
      if($name -ne 'manifest.json' -and $declared -notcontains $name){Fail ('Unlisted bundle entry refused: '+$name)}
    }
    foreach($f in $m.files){
      if(-not $entries.ContainsKey([string]$f.path)){Fail ('Bundle missing '+$f.path)}
      $hash=[Security.Cryptography.SHA256]::Create();$stream=$entries[[string]$f.path].Open()
      try{$actual=([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose();$stream.Dispose()}
      if($actual -ne [string]$f.sha256){Fail ('Checksum mismatch '+$f.path)}
    }
    return $m
  }finally{$zip.Dispose()}
}
function ExpandSafe([string]$archive,[string]$dest){
  $zip=[IO.Compression.ZipFile]::OpenRead($archive)
  try{
    foreach($e in $zip.Entries){
      $name=$e.FullName.Replace('\','/')
      if($name -eq 'manifest.json' -or $name.EndsWith('/')){continue}
      if($name -match '(^/|(^|/)\.\.(/|$)|:)'){Fail 'Unsafe archive path'}
      if(-not($name -match '^(runtime|headless|toolboxes|letta-poc)/' -or $name -in @('naos-agent-stack.ps1','README.md'))){Fail ('Unexpected archive path '+$name)}
      $target=Join-Path $dest ($name.Replace('/','\'))
      EnsureDir (Split-Path -Parent $target)
      $inputStream=$e.Open();$outputStream=[IO.File]::Open($target,[IO.FileMode]::CreateNew)
      try{$inputStream.CopyTo($outputStream)}finally{$inputStream.Dispose();$outputStream.Dispose()}
    }
  }finally{$zip.Dispose()}
}
function CreateHeadlessConfiguration {
  $js=@'
const path=require("node:path"),fs=require("node:fs");
const root=__dirname,rt=path.join(process.env.LOCALAPPDATA,"Programs","OpenChatX","runtime");
const node=path.join(rt,"bin","node.exe"),logs=path.join(root,"logs"),cfg=path.join(root,"config");
const apps=[{name:"openchatx-mcp",script:path.join(rt,"dist","index.js"),cwd:rt,interpreter:node,
 instances:1,exec_mode:"fork",autorestart:true,restart_delay:1000,time:true,
 out_file:path.join(logs,"mcp.out.log"),error_file:path.join(logs,"mcp.error.log"),env:{
 NODE_ENV:"production",OPENCHATX_APP_DATA:root,OPENCHATX_PUBLIC_CONFIG:path.join(cfg,"openchatx.toml"),
 OPENCHATX_TOOLBOX_ROOT:path.join(root,"toolboxes"),OPENCHATX_EXTERNAL_MCP_CONFIG:path.join(cfg,"mcp-servers.json"),
 OPENCHATX_SUBAGENT_CONFIG:path.join(cfg,"subagents.json"),OPENCHATX_AUDIT_LOG:path.join(logs,"agent-commands.yaml")}}];
if(fs.existsSync(path.join(root,"tunnel-profiles","openchatx.yaml")))apps.push({
 name:"openchatx-tunnel",script:path.join(root,"tunnel-launcher.cjs"),cwd:root,interpreter:node,
 instances:1,exec_mode:"fork",autorestart:true,restart_delay:1000,time:true,
 out_file:path.join(logs,"tunnel.out.log"),error_file:path.join(logs,"tunnel.error.log")});
module.exports={apps};
'@
  WriteUtf8 (Join-Path $Headless 'ecosystem.config.cjs') $js
  WriteUtf8 (Join-Path $Headless 'config\openchatx.toml') ('# Safe defaults; per-machine config'+[Environment]::NewLine)
  $cfg=[ordered]@{version=2;engine='letta';defaultModel='letta/agent-config';lettaServerUrl='ws://127.0.0.1:4500';lettaServerCwd=$LettaRoot;lettaNodeBinary=(Join-Path $LettaRoot 'node_modules\node\bin\node.exe');lettaAutoStart=$true;compactResults=$true;maxResultChars=6000;statusOperationLimit=3;autoCompactEnabled=$true;autoCompactTurns=8}
  WriteUtf8 (Join-Path $Headless 'toolboxes\agent-runtime\config.json') ($cfg|ConvertTo-Json -Depth 6)
  $wrapper=Join-Path $Headless 'tunnel-wrapper.ps1';Require $wrapper
  $existing=Get-Content -LiteralPath $wrapper -Raw -Encoding UTF8
  $pattern='(?m)^\$tunnelExe\s*=\s*(?:"[^"\r\n]*"|Join-Path\s+\$env:LOCALAPPDATA\s+"[^"\r\n]*")\s*$'
  if(@([regex]::Matches($existing,$pattern)).Count -ne 1){Fail 'Unknown tunnel-wrapper source; cannot rewrite portable runtime path'}
  $replacement='$tunnelExe = Join-Path $env:LOCALAPPDATA "Programs\OpenChatX\runtime\bin\tunnel-client.exe"'
  WriteUtf8 $wrapper ([regex]::Replace($existing,$pattern,$replacement))
}
function CheckNpm {
  $cmd=Get-Command npm.cmd -ErrorAction SilentlyContinue
  if(-not $cmd){Fail 'Node.js/npm required. Install Node.js 22.19+, reopen PowerShell'}
  $version=(& node --version).TrimStart('v')
  if([version]$version -lt [version]'22.19.0'){Fail 'Node.js 22.19+ required'}
  return $cmd.Source
}
function NpmCi([string]$dir){Push-Location $dir;try{& npm.cmd ci --no-audit;if($LASTEXITCODE -ne 0){Fail ('npm ci failed in '+$dir)}}finally{Pop-Location}}
function InstallStack {
  $zipPath=[IO.Path]::GetFullPath($BundlePath)
  $manifest=VerifyBundle $zipPath
  # The standalone bootstrap may be invoked without Engine's preflight.
  # Reject overlapping roots before extracting or creating installation paths.
  $targets=@($Runtime,$Headless,$LettaRoot)
  for($i=0;$i -lt $targets.Count;$i++){
    $left=[IO.Path]::GetFullPath($targets[$i]).TrimEnd('\')
    for($j=$i+1;$j -lt $targets.Count;$j++){
      $right=[IO.Path]::GetFullPath($targets[$j]).TrimEnd('\')
      if($left.Equals($right,[StringComparison]::OrdinalIgnoreCase) -or
         $left.StartsWith($right+'\',[StringComparison]::OrdinalIgnoreCase) -or
         $right.StartsWith($left+'\',[StringComparison]::OrdinalIgnoreCase)){
        Fail ('Install targets overlap: '+$targets[$i]+' / '+$targets[$j])
      }
    }
  }
  foreach($p in $targets){
    # Direct bootstrap must reject a non-existent leaf below a junction or
    # symlink too; such a path can redirect fresh-install writes elsewhere.
    $cursor=[IO.Path]::GetFullPath($p)
    while($cursor){
      if(Test-Path -LiteralPath $cursor){
        $node=Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
        if(($node.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){
          Fail ('Install target linked ancestor refused: '+$cursor)
        }
      }
      $parent=Split-Path -Path $cursor -Parent
      if(-not $parent -or $parent -eq $cursor){break}
      $cursor=$parent
    }
  }
  foreach($p in $targets){if(Test-Path -LiteralPath $p){Fail ('Target already exists: '+$p+'; refuse overwrite')}}
  if($DryRun){Log ('Install dry-run OK: '+$manifest.files.Count+' verified files');return}
  $npm=CheckNpm
  $stage=Join-Path $env:TEMP ('naos-headless-'+[guid]::NewGuid().ToString('N'))
  EnsureDir $stage
  try{
    ExpandSafe $zipPath $stage
    foreach($tuple in @(@('runtime',$Runtime),@('headless',$Headless),@('toolboxes',(Join-Path $Headless 'toolboxes')),@('letta-poc',$LettaRoot))){
      EnsureDir $tuple[1]
      Copy-Item -Path (Join-Path $stage ($tuple[0]+'\*')) -Destination $tuple[1] -Recurse -Force
    }
    CreateHeadlessConfiguration
    EnsureDir (Join-Path $Headless 'logs')
    NpmCi $Headless
    NpmCi $LettaRoot
    & $npm install -g 'codebase-memory-mcp@0.11.0'
    if($LASTEXITCODE -ne 0){Fail 'Global tool installation failed'}
    $npmRoot=[string]((& $npm root -g)|Select-Object -First 1)
    $cbm=Join-Path $npmRoot.Trim() 'codebase-memory-mcp\bin\codebase-memory-mcp.exe';Require $cbm
    $indexConfig=[ordered]@{binary=$cbm;indexMode='fast';scanIntervalMs=30000;gitCheckIntervalMs=600000;fallbackRefreshMs=86400000;maxPerSweep=1;maxGitChecksPerSweep=3;priorityProjects=@();excludedProjects=@()}
    WriteUtf8 (Join-Path $Headless 'config\codebase-index.json') ($indexConfig|ConvertTo-Json -Depth 6)
    $servers=@{'codebase-memory'=@{type='local';command=@($cbm);enabled=$true;timeout=30000;description='Local code graph and project index'}}
    WriteUtf8 (Join-Path $Headless 'config\mcp-servers.json') ($servers|ConvertTo-Json -Depth 6)
    # The exported Headless synchronizer and PM2 ecosystem are authoritative.
    # Do not invoke the older Letta-POC installer: it rewrites the synchronizer
    # and index config, silently downgrading a clean v0.2.3 installation.
    $watcher=Join-Path $Headless 'codebase-project-sync.mjs';Require $watcher
    $nodeExe=Join-Path $Runtime 'bin\node.exe';Require $nodeExe
    & $nodeExe --check $watcher
    if($LASTEXITCODE -ne 0){Fail 'Bundled Codebase Memory synchronizer syntax check failed'}
    $task=Get-ScheduledTask -TaskName 'OpenChatX Headless' -ErrorAction SilentlyContinue
    if(-not $task){
      try{
        $start=Join-Path $Headless 'start-headless.ps1'
        $args='-NoProfile -ExecutionPolicy Bypass -File "'+$start+'"'
        $action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $args
        $trigger=New-ScheduledTaskTrigger -AtLogOn -User ($env:USERDOMAIN+'\'+$env:USERNAME)
        Register-ScheduledTask -TaskName 'OpenChatX Headless' -Action $action -Trigger $trigger -Description 'Naos Headless OpenChatX PM2 startup'|Out-Null
        Log 'Created Windows logon task'
      }catch{Log ('Register task manually: '+$_.Exception.Message)}
    }
    Log 'Installed: OpenChatX Headless + PM2 + Letta + codebase-memory, no Desktop installer'
    if($Start){& (Join-Path $Headless 'start-headless.ps1')}
    Log 'Next: create unique PC2 Tunnel, store new key securely, and complete Letta ChatGPT OAuth'
  }finally{Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue}
}
function ConfigureTunnel {
  if($TunnelId -notmatch '^tunnel_[A-Za-z0-9_-]+$'){Fail 'Supply the second machine TunnelId (tunnel_...)'}
  $exe=Join-Path $Runtime 'bin\tunnel-client.exe';Require $exe
  $profiles=Join-Path $Headless 'tunnel-profiles'
  EnsureDir $profiles
  if(Test-Path -LiteralPath (Join-Path $profiles 'openchatx.yaml')){Fail 'Tunnel profile already exists; will not overwrite'}
  & $exe init --profile-dir $profiles --profile openchatx --tunnel-id $TunnelId --mcp-server-url 'http://127.0.0.1:8001/mcp' --control-plane-api-key-ref 'env:CONTROL_PLANE_API_KEY'
  if($LASTEXITCODE -ne 0){Fail 'Tunnel profile init failed'}
  Log 'Tunnel profile saved WITHOUT key. Add your new Runtime API key to Windows Credential Manager generic target OpenChatX/CONTROL_PLANE_API_KEY.'
  Log 'Then start Headless, and configure the new Tunnel as a ChatGPT MCP App.'
}
function Doctor {
  $items=@((Join-Path $Runtime 'package.json'),(Join-Path $Runtime 'bin\node.exe'),(Join-Path $Runtime 'bin\tunnel-client.exe'),(Join-Path $Headless 'start-headless.ps1'),(Join-Path $Headless 'ecosystem.config.cjs'),(Join-Path $Headless 'node_modules\.bin\pm2.cmd'),(Join-Path $Headless 'toolboxes\agent-runtime\tools\agent_runtime.ts'),(Join-Path $Headless 'codebase-project-sync.mjs'),(Join-Path $Headless 'codebase-index\ecosystem.config.cjs'),(Join-Path $Headless 'config\codebase-index.json'),(Join-Path $Headless 'config\mcp-servers.json'),(Join-Path $LettaRoot 'node_modules\node\bin\node.exe'))
  $missing=0
  foreach($i in $items){if(Test-Path -LiteralPath $i){Log ('OK '+$i)}else{Log ('MISSING '+$i);$missing++}}
  if($missing){Fail ("Doctor: $missing missing components")}
  Log ('OpenChatX Runtime version='+(ReadJson (Join-Path $Runtime 'package.json')).version)
  try{$r=Invoke-WebRequest -Uri 'http://127.0.0.1:8001/healthz' -UseBasicParsing -TimeoutSec 3;Log ('MCP HTTP '+[int]$r.StatusCode)}catch{Log 'MCP not currently listening; start PM2'}
  if(-not(Test-Path -LiteralPath (Join-Path $Headless 'tunnel-profiles\openchatx.yaml'))){Log 'Tunnel not configured on this computer'}
  Log 'Letta OAuth must be authorized separately on the new computer'
}
# Read-only package verification is independent of installed paths and npm.
# The outer installer runs it before confirming or installing prerequisites.
switch($Mode){'export'{ExportStack};'verify'{$null=VerifyBundle $BundlePath;Log 'Verified core bundle (read-only)'};'install'{InstallStack};'doctor'{Doctor};'tunnel'{ConfigureTunnel}}
