[CmdletBinding()]
param(
  [Parameter(Position=0)][ValidateSet('export','install','doctor','tunnel')][string]$Mode='doctor',
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
  if(Test-Path -LiteralPath $source){[void]$a.Add([pscustomobject]@{Source=$source;Key=$key.Replace('\','/')})}
}
function AddTree([System.Collections.ArrayList]$a,[string]$root,[string]$prefix,[string]$type){
  if(-not(Test-Path -LiteralPath $root)){return}
  $root=(Resolve-Path -LiteralPath $root).Path.TrimEnd('\')
  foreach($f in (Get-ChildItem -LiteralPath $root -Recurse -File)){
    $rel=$f.FullName.Substring($root.Length).TrimStart('\').Replace('\','/')
    if($type -ne 'runtime' -and $rel -match '(?i)(^|/)node_modules(/|$)'){continue}
    if($rel -match '(?i)(^|/)(\.env($|\.)|\.git|\.ssh|\.aws|\.letta|\.ops|\.services|\.external-tool-ledger|tunnel-profiles|backups|logs|secrets|credentials)(/|$)|(^|/)(state|operations|letta-service|projects|mcp-servers|subagents)\.json$|(\.pem|\.p12|\.pfx|\.key|\.log|\.db|\.sqlite|\.zst)$'){continue}
    if($type -eq 'toolboxes' -and -not($rel -match '(?i)(\.ts|\.mjs|\.cjs|\.md|\.mdc|toolbox\.json)$')){continue}
    if($type -eq 'letta' -and -not($rel -match '(?i)(\.json|\.js|\.mjs|\.ps1|\.md)$')){continue}
    AddFile $a $f.FullName ($prefix+'/'+$rel)
  }
}
function ExportStack {
  foreach($p in @((Join-Path $Runtime 'package.json'),(Join-Path $Runtime 'bin\node.exe'),(Join-Path $Runtime 'bin\tunnel-client.exe'),(Join-Path $Headless 'package-lock.json'),(Join-Path $Headless 'start-headless.ps1'),(Join-Path $Headless 'toolboxes\agent-runtime\tools\agent_runtime.ts'),(Join-Path $LettaRoot 'package-lock.json'))){Require $p}
  $items=New-Object System.Collections.ArrayList
  foreach($d in @('dist','node_modules','ui\dist')){AddTree $items (Join-Path $Runtime $d) ('runtime/'+$d.Replace('\','/')) 'runtime'}
  foreach($f in @('package.json','bin\node.exe','bin\tunnel-client.exe')){AddFile $items (Join-Path $Runtime $f) ('runtime/'+$f.Replace('\','/'))}
  foreach($f in @('package.json','package-lock.json','start-headless.ps1','stop-headless.ps1','status-headless.ps1','tunnel-launcher.cjs','tunnel-wrapper.ps1','import-persistent-environment.ps1')){AddFile $items (Join-Path $Headless $f) ('headless/'+$f)}
  AddTree $items (Join-Path $Headless 'toolboxes') 'toolboxes' 'toolboxes'
  AddTree $items $LettaRoot 'letta-poc' 'letta'
  AddFile $items $PSCommandPath 'naos-agent-stack.ps1'
  $base=Split-Path -Parent $PSCommandPath
  $readme=Join-Path $base 'README_HEADLESS.md'
  if(-not(Test-Path -LiteralPath $readme)){$readme=Join-Path $base 'README.md'}
  AddFile $items $readme 'README.md'
  $items=@($items|Sort-Object Key -Unique)
  if($DryRun){Log ('Would bundle '+$items.Count+' whitelisted files; no changes');return}
  $target=[IO.Path]::GetFullPath($BundlePath)
  EnsureDir (Split-Path -Parent $target)
  if(Test-Path -LiteralPath $target){if(-not $Force){Fail 'Bundle already exists; use -Force'};Remove-Item -LiteralPath $target -Force}
  $zip=[IO.Compression.ZipFile]::Open($target,[IO.Compression.ZipArchiveMode]::Create)
  try{
    $meta=New-Object System.Collections.ArrayList
    foreach($item in $items){
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$item.Source,$item.Key,[IO.Compression.CompressionLevel]::Optimal)|Out-Null
      [void]$meta.Add([ordered]@{path=$item.Key;sha256=(Get-FileHash -LiteralPath $item.Source -Algorithm SHA256).Hash.ToLowerInvariant()})
    }
    $version=(ReadJson (Join-Path $Runtime 'package.json')).version
    $manifest=[ordered]@{format=2;sourceHost=$env:COMPUTERNAME;arch=$env:PROCESSOR_ARCHITECTURE;version=$version;createdUtc=[DateTime]::UtcNow.ToString('o');files=@($meta.ToArray());excluded=@('Tunnel secrets and profiles','OAuth','Letta Agent memory','Project registry','Session state','Logs')}
    $entry=$zip.CreateEntry('manifest.json')
    $writer=New-Object IO.StreamWriter($entry.Open(),[Text.UTF8Encoding]::new($false))
    try{$writer.Write(($manifest|ConvertTo-Json -Depth 10))}finally{$writer.Dispose()}
  }finally{$zip.Dispose()}
  Log ('Created '+$target+' from MSI Headless; '+$items.Count+' files; runtime '+$version)
}
function VerifyBundle([string]$bundle){
  Require $bundle
  $zip=[IO.Compression.ZipFile]::OpenRead($bundle)
  try{
    $entries=@{}
    foreach($e in $zip.Entries){
      $n=$e.FullName.Replace('\','/')
      if($n -match '(^/|(^|/)\.\.(/|$)|:)'){Fail ('Unsafe ZIP entry: '+$n)}
      if($entries.ContainsKey($n)){Fail ('Duplicate ZIP entry: '+$n)}
      $entries[$n]=$e
    }
    if(-not $entries.ContainsKey('manifest.json')){Fail 'Bundle manifest missing'}
    $reader=New-Object IO.StreamReader($entries['manifest.json'].Open())
    try{$m=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose()}
    if($m.format -ne 2){Fail 'Old Desktop bundle is incompatible; export new Headless v2'}
    if($m.arch -ne $env:PROCESSOR_ARCHITECTURE){Fail 'Windows CPU architecture mismatch'}
    if($m.version -ne '1.0.0-beta.2'){Fail 'Unverified OpenChatX core version; cannot apply local patches'}
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
  $cfg=[ordered]@{version=2;engine='letta';defaultModel='opencode/nemotron-3-ultra-free';lettaServerUrl='ws://127.0.0.1:4500';lettaServerCwd=$LettaRoot;lettaNodeBinary=(Join-Path $LettaRoot 'node_modules\node\bin\node.exe');lettaAutoStart=$true;compactResults=$true;maxResultChars=6000;statusOperationLimit=3;autoCompactEnabled=$true;autoCompactTurns=8}
  WriteUtf8 (Join-Path $Headless 'toolboxes\agent-runtime\config.json') ($cfg|ConvertTo-Json -Depth 6)
  $wrapper=Join-Path $Headless 'tunnel-wrapper.ps1';Require $wrapper
  $existing=Get-Content -LiteralPath $wrapper -Raw -Encoding UTF8
  $pattern='(?m)^\$tunnelExe\s*=\s*".*"\s*$'
  if(-not [regex]::IsMatch($existing,$pattern)){Fail 'Unknown tunnel-wrapper source; cannot rewrite portable runtime path'}
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
  if($manifest.sourceHost -eq $env:COMPUTERNAME){Fail 'Do not install over the source MSI host'}
  foreach($p in @($Runtime,$Headless,$LettaRoot)){if(Test-Path -LiteralPath $p){Fail ('Target already exists: '+$p+'; refuse overwrite')}}
  if($DryRun){Log ('Install dry-run OK: '+$manifest.files.Count+' verified files from '+$manifest.sourceHost);return}
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
    & $npm install -g 'codebase-memory-mcp@0.11.0' '@opencode/cli@2.0.21'
    if($LASTEXITCODE -ne 0){Fail 'Global tool installation failed'}
    $npmRoot=[string]((& $npm root -g)|Select-Object -First 1)
    $cbm=Join-Path $npmRoot.Trim() 'codebase-memory-mcp\bin\codebase-memory-mcp.exe';Require $cbm
    $servers=@{'codebase-memory'=@{type='local';command=@($cbm);enabled=$true;timeout=30000;description='Local code graph and project index'}}
    WriteUtf8 (Join-Path $Headless 'config\mcp-servers.json') ($servers|ConvertTo-Json -Depth 6)
    $addon=Join-Path $LettaRoot 'scripts\install-codebase-memory.ps1';Require $addon
    & $addon -Mode install -NativeBinary $cbm -SkipPackageInstall -SkipStart
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
  $items=@((Join-Path $Runtime 'package.json'),(Join-Path $Runtime 'bin\node.exe'),(Join-Path $Runtime 'bin\tunnel-client.exe'),(Join-Path $Headless 'start-headless.ps1'),(Join-Path $Headless 'ecosystem.config.cjs'),(Join-Path $Headless 'node_modules\.bin\pm2.cmd'),(Join-Path $Headless 'toolboxes\agent-runtime\tools\agent_runtime.ts'),(Join-Path $Headless 'codebase-project-sync.mjs'),(Join-Path $Headless 'config\mcp-servers.json'),(Join-Path $LettaRoot 'node_modules\node\bin\node.exe'))
  $missing=0
  foreach($i in $items){if(Test-Path -LiteralPath $i){Log ('OK '+$i)}else{Log ('MISSING '+$i);$missing++}}
  if($missing){Fail ("Doctor: $missing missing components")}
  Log ('OpenChatX Runtime version='+(ReadJson (Join-Path $Runtime 'package.json')).version)
  try{$r=Invoke-WebRequest -Uri 'http://127.0.0.1:8001/healthz' -UseBasicParsing -TimeoutSec 3;Log ('MCP HTTP '+[int]$r.StatusCode)}catch{Log 'MCP not currently listening; start PM2'}
  if(-not(Test-Path -LiteralPath (Join-Path $Headless 'tunnel-profiles\openchatx.yaml'))){Log 'Tunnel not configured on this computer'}
  Log 'Letta OAuth must be authorized separately on the new computer'
}
switch($Mode){'export'{ExportStack};'install'{InstallStack};'doctor'{Doctor};'tunnel'{ConfigureTunnel}}
