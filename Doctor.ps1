# Naos Agent Stack v0.2 - read-only diagnostics (Windows PowerShell 5.1).
[CmdletBinding()]
param(
    [ValidateSet('auto','single','host','client','existing')][string]$Role='auto',
    [switch]$Deep,
    [switch]$Json,
    [switch]$Strict,
    [int]$LocalPort=4501,
    [int]$HostSshPort=2222,
    [string]$ProjectRoot='',
    [string]$ExtraRoot=''
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$results=New-Object 'System.Collections.Generic.List[object]'
$headless=Join-Path $HOME '.openchatx-mcp\headless'
$runtime=Join-Path $env:LOCALAPPDATA 'Programs\OpenChatX\runtime'
$runtimeConfig=Join-Path $headless 'toolboxes\agent-runtime\config.json'
$registryPath=Join-Path $HOME '.openchatx-mcp\projects.json'
$statePath=Join-Path $headless 'toolboxes\agent-runtime\state.json'
$manifestFolder=Join-Path $headless 'shared-letta'

function AddCheck([string]$Name,[string]$Status,[string]$Detail,[string]$Fix='') {
    $item=[pscustomobject]@{check=$Name;status=$Status;detail=$Detail;fix=$Fix}
    [void]$results.Add($item)
    if(-not $Json) {
        Write-Output ('['+$Status.ToUpperInvariant()+'] '+$Name+': '+$Detail)
        if($Fix -and $Status -ne 'pass') {Write-Output ('         -> '+$Fix)}
    }
}
function SafeJson([string]$Path) {
    if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){return $null}
    try {return Get-Content -LiteralPath $Path -Raw -Encoding UTF8|ConvertFrom-Json}
    catch{return $null}
}
function GitIdentity([string]$GitPath) {
    if(-not (Test-Path -LiteralPath $GitPath)){return ''}
    if(-not (Get-Command git -ErrorAction SilentlyContinue)){return ''}
    $allRemotes=@(& git -C $GitPath remote 2>$null)
    if(-not $allRemotes.Count){return ''}
    $names=@($allRemotes|Where-Object{$_ -eq 'origin'})+@($allRemotes|Where-Object{$_ -ne 'origin'})
    $pattern='(?i)(?:github\.com[:/])(?<slug>[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?/?$'
    foreach($name in $names){
        $origin=[string](& git -C $GitPath remote get-url $name 2>$null)
        if(-not $origin){continue}
        $match=[regex]::Match($origin,$pattern)
        if($match.Success){return 'github.com/'+(($match.Groups['slug'].Value -replace '\.git$','').ToLowerInvariant())}
    }
    return ''
}
function EndpointHandshake([string]$Endpoint) {
    if($Endpoint -notmatch '^ws://(127\.0\.0\.1|localhost):[0-9]{1,5}/?$'){return 'UNSAFE_NON_LOOPBACK_ENDPOINT'}
    $client=New-Object Net.WebSockets.ClientWebSocket
    $cts=New-Object Threading.CancellationTokenSource
    try {
        $cts.CancelAfter(5000)
        $uri=[Uri]$Endpoint
        $client.ConnectAsync($uri,$cts.Token).GetAwaiter().GetResult()
        if($client.State -eq [Net.WebSockets.WebSocketState]::Open){return 'OK'}
        return 'HANDSHAKE_NOT_OPEN'
    } catch {
        return ('ERROR_'+$_.Exception.GetType().Name)
    } finally {
        $client.Dispose()
        $cts.Dispose()
    }
}

if($env:OS -ne 'Windows_NT'){AddCheck 'Operating system' 'fail' 'Windows is required.'}
else{AddCheck 'Operating system' 'pass' ('Windows '+[Environment]::OSVersion.Version.ToString())}

$config=SafeJson $runtimeConfig
if((Test-Path -LiteralPath $runtimeConfig) -and -not $config) {
    AddCheck 'Letta configuration' 'fail' 'config.json cannot be parsed.' 'Review and restore the last configuration backup.'
}
$detected='single'
if($config -and ([string]$config.lettaServerUrl) -match '^ws://(?:127\.0\.0\.1|localhost):4501/?$') {
    $detected='client'
} elseif((Get-Service sshd -ErrorAction SilentlyContinue) -and $config -and [string]$config.lettaServerUrl -match ':4500/?$') {
    $detected='host'
}
$effectiveRole=if($Role -in @('auto','existing')){$detected}else{$Role}
if(-not $Json){Write-Output ('Naos Agent Stack Doctor | Host='+$env:COMPUTERNAME+' | Role='+$effectiveRole+' | Read-only=True')}
AddCheck 'Effective role' 'pass' $effectiveRole

$node=Get-Command node.exe -ErrorAction SilentlyContinue
if(-not $node){AddCheck 'Node.js' 'fail' 'Node.js not in PATH.' 'Install Node.js 22.19+.'}
else {
    $versionString=[string](& node.exe --version 2>$null)
    $nodeVer=$null
    try{$nodeVer=[version]($versionString.Trim().TrimStart('v'))}catch{}
    if($nodeVer -and $nodeVer -ge [version]'22.19.0'){AddCheck 'Node.js' 'pass' $versionString.Trim()}
    else{AddCheck 'Node.js' 'fail' ('Version '+$versionString+' too old.') 'Upgrade Node.js to at least v22.19.0.'}
}
 $npm=Get-Command npm.cmd -ErrorAction SilentlyContinue
if(-not $npm){
    AddCheck 'npm CLI' 'fail' 'npm.cmd not in PATH (required for fresh install).' 'Use the v0.2.2 Complete installer ZIP to prepare bundled portable Node/npm, or install official Node.js 22.19+.'
}else {
    try{
        $npmVersion=([string](& $npm.Source --version 2>$null)).Trim()
        if($LASTEXITCODE -eq 0 -and $npmVersion -match '^\d+\.\d+\.\d+'){
            AddCheck 'npm CLI' 'pass' ('npm '+$npmVersion)
        }else{AddCheck 'npm CLI' 'fail' 'npm command did not report a valid version.'}
    }catch{AddCheck 'npm CLI' 'fail' 'npm command could not run.'}
}
if(Get-Command git.exe -ErrorAction SilentlyContinue){
    $gitVersion=[string](& git.exe --version 2>$null)
    AddCheck 'Git' 'pass' $gitVersion.Trim()
}else{AddCheck 'Git' 'warn' 'Git is unavailable.' 'Install Git to validate and synchronize independent project checkouts.'}

$runtimePkg=Join-Path $runtime 'package.json'
if(Test-Path -LiteralPath $runtimePkg){
    $p=SafeJson $runtimePkg
    if($p -and $p.version){AddCheck 'OpenChatX runtime' 'pass' ('v'+$p.version)}
    else{AddCheck 'OpenChatX runtime' 'fail' 'package.json invalid.'}
}else{AddCheck 'OpenChatX runtime' 'fail' 'Runtime not installed.' 'Run install -Role single or install -Role client.'}
if(Test-Path -LiteralPath (Join-Path $headless 'start-headless.ps1')){
    AddCheck 'Headless bootstrap' 'pass' 'start-headless.ps1 exists.'
}else{AddCheck 'Headless bootstrap' 'fail' 'Missing headless startup.' 'Install or repair the Headless core.'}
$pm2=Join-Path $headless 'node_modules\.bin\pm2.cmd'
if(Test-Path -LiteralPath $pm2){AddCheck 'PM2' 'pass' 'Headless PM2 package installed.'}
else{AddCheck 'PM2' 'warn' 'PM2 not found under Headless node_modules.' 'Check npm ci / PM2 installation.'}

if($config){
    $url=[string]$config.lettaServerUrl
    AddCheck 'Letta config' 'pass' ('Endpoint='+$url+' AutoStart='+$config.lettaAutoStart)
    if($effectiveRole -eq 'client' -and [bool]$config.lettaAutoStart){
        AddCheck 'Letta client policy' 'fail' 'AutoStart is enabled on a client.' 'Set lettaAutoStart=false to avoid a competing local Letta backend.'
    }
    $handshake=EndpointHandshake $url
    if($handshake -eq 'OK'){AddCheck 'Letta WebSocket' 'pass' 'WebSocket handshake succeeded on configured loopback endpoint.'}
    else{AddCheck 'Letta WebSocket' 'fail' $handshake 'Check SSH forwarding (client) or local Letta server (host/single).'}
} elseif(-not(Test-Path -LiteralPath $runtimeConfig)) {
    AddCheck 'Letta config' 'fail' 'agent-runtime/config.json missing.' 'Run install and configure the local Letta runtime.'
}

try{
    $response=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8001/healthz' -TimeoutSec 4 -ErrorAction Stop
    if([int]$response.StatusCode -eq 200){AddCheck 'OpenChatX MCP HTTP' 'pass' 'HTTP 200 /healthz'}
    else{AddCheck 'OpenChatX MCP HTTP' 'fail' ('HTTP '+$response.StatusCode)}
}catch{AddCheck 'OpenChatX MCP HTTP' 'fail' '127.0.0.1:8001/healthz unreachable.' 'Check headless PM2 status/start-headless.ps1.'}

$projectRegistry=SafeJson $registryPath
$state=SafeJson $statePath
if($projectRegistry -and $null -ne $projectRegistry.projects){
    $projectCount=@($projectRegistry.projects).Count
    AddCheck 'OpenChatX Project Registry' 'pass' ($projectCount.ToString()+' registered projects.')
}else{
    AddCheck 'OpenChatX Project Registry' 'warn' 'Registry missing or invalid.' 'A new installation may not have projects yet.'
}
if($state -and $state.projects){
    $bindings=@($state.projects.PSObject.Properties|Where-Object{$_.Value.PSObject.Properties['lettaAgentId'] -and $_.Value.lettaAgentId})
    AddCheck 'Letta project state' 'pass' ($bindings.Count.ToString()+' linked agents; existing session IDs retained.')
}else{
    AddCheck 'Letta project state' 'warn' 'No local Agent/Session state yet.' 'New installations will create local sessions when first used.'
}

$tunnel=Join-Path $headless 'tunnel-profiles\openchatx.yaml'
if(Test-Path -LiteralPath $tunnel) {
    AddCheck 'OpenChatX Secure Tunnel' 'pass' 'Tunnel profile exists (secrets not inspected).'
}else{
    AddCheck 'OpenChatX Secure Tunnel' 'warn' 'Tunnel profile not configured.' 'A new computer needs its own Secure MCP Tunnel authorization.'
}

if($effectiveRole -in @('host','client')){
    $tailscale=Get-Service Tailscale -ErrorAction SilentlyContinue
    if($tailscale -and $tailscale.Status -eq 'Running'){
        AddCheck 'Tailscale' 'pass' 'Service running.'
    }else{AddCheck 'Tailscale' 'fail' 'Service not running.' 'Install/login to Tailscale on both machines.'}
}

if($effectiveRole -eq 'host'){
    $sshd=Get-Service sshd -ErrorAction SilentlyContinue
    if($sshd -and $sshd.Status -eq 'Running'){AddCheck 'Windows sshd' 'pass' 'OpenSSH Server running.'}
    else{AddCheck 'Windows sshd' 'fail' 'OpenSSH Server stopped or missing.' 'Configure SSH host with an elevated Administrator PowerShell.'}
    $sshListen=@(Get-NetTCPConnection -State Listen -LocalPort $HostSshPort -ErrorAction SilentlyContinue)
    if($sshListen.Count){AddCheck 'SSH host port' 'pass' ('TCP '+$HostSshPort+' listening.')}
    else{AddCheck 'SSH host port' 'fail' ('TCP '+$HostSshPort+' not listening.')}
    $defaultRule=Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue
    if($defaultRule -and $defaultRule.Enabled -eq 'True'){
        AddCheck 'Default SSH firewall exposure' 'warn' 'Default broad OpenSSH rule enabled.' 'Review before changing firewall; do not alter unrelated services.'
    }
    $rule=Get-NetFirewallRule -Name 'Naos-Letta-SSH-PC2' -ErrorAction SilentlyContinue
    if($rule -and $rule.Enabled -eq 'True'){
        $pf=$rule|Get-NetFirewallPortFilter
        $af=$rule|Get-NetFirewallAddressFilter
        $isLimited=([string]$pf.Protocol -eq 'TCP' -and [string]$pf.LocalPort -eq [string]$HostSshPort -and
            [string]$af.LocalAddress -match '^100\.' -and [string]$af.RemoteAddress -match '^100\.' -and
            [string]$af.RemoteAddress -ne 'Any')
        if($isLimited){AddCheck 'Dedicated SSH firewall rule' 'pass' ('TCP '+$HostSshPort+' limited to Tailnet address pair.')}
        else{AddCheck 'Dedicated SSH firewall rule' 'fail' 'Rule enabled but IP/port scope is not expected.' 'Inspect LocalAddress, RemoteAddress and LocalPort.'}
    }else{AddCheck 'Dedicated SSH firewall rule' 'warn' 'Restricted rule not found/enabled.' 'Inspect source IP, destination IP, and TCP port before enabling.'}
}

if($effectiveRole -eq 'client'){
    $agent=Get-Service ssh-agent -ErrorAction SilentlyContinue
    if($agent -and $agent.Status -eq 'Running'){
        AddCheck 'Windows ssh-agent' 'pass' 'Service running.'
        $identities=@(& ssh-add.exe -l 2>$null|Where-Object{$_ -match 'SHA256:'})
        if($identities.Count){AddCheck 'SSH identity' 'pass' ($identities.Count.ToString()+' key(s) unlocked in the agent.')}
        else{AddCheck 'SSH identity' 'warn' 'No unlocked SSH keys.' 'Run ssh-add for the passphrase-protected key.'}
    }else{AddCheck 'Windows ssh-agent' 'fail' 'Service stopped/disabled.' 'Enable ssh-agent, then ssh-add the user private key.'}

    $listener=@(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue)
    if($listener.Count -ne 1){
        AddCheck 'SSH private forwarding' 'fail' ('Expected one loopback SSH listener on '+$LocalPort+'.') 'Check forward task, Tailscale, and SSH key.'
    }else {
        $owner=Get-CimInstance Win32_Process -Filter ('ProcessId='+$listener[0].OwningProcess) -ErrorAction SilentlyContinue
        $cmd=if($owner){[string]$owner.CommandLine}else{''}
        $mapping='127.0.0.1:'+$LocalPort+':127.0.0.1:4500'
        if($owner -and $owner.Name -ieq 'ssh.exe' -and $cmd.Contains($mapping)){
            AddCheck 'SSH private forwarding' 'pass' ('ssh.exe owns 127.0.0.1:'+$LocalPort+' -> host Letta 4500.')
        }else{
            AddCheck 'SSH private forwarding' 'fail' ('Unexpected listener on 127.0.0.1:'+$LocalPort+'.') 'Do not trust this port as a Letta forward until inspected.'
        }
    }
    $task=Get-ScheduledTask -TaskName 'Naos Letta SSH Forward' -ErrorAction SilentlyContinue
    if(-not $task){
        AddCheck 'SSH reconnection task' 'fail' 'Task does not exist.' 'Run install -Role client -Sharing after SSH fingerprint verification.'
    }else{
        $info=Get-ScheduledTaskInfo -TaskName 'Naos Letta SSH Forward' -ErrorAction SilentlyContinue
        if($task.State -in @('Ready','Running') -and $info -and ($info.LastTaskResult -in @(0,267009))){
            AddCheck 'SSH reconnection task' 'pass' ('State='+$task.State+'; last result='+$info.LastTaskResult+'; missed='+$info.NumberOfMissedRuns)
        }else {
            AddCheck 'SSH reconnection task' 'warn' ('State='+$task.State+'; last result='+$(if($info){$info.LastTaskResult}else{'unknown'})) 'Inspect Task Scheduler history and watchdog log.'
        }
    }
}

if($Deep) {
    $manifests=@(Get-ChildItem -LiteralPath $manifestFolder -File -Filter '*.shared.json' -ErrorAction SilentlyContinue)
    if(-not $manifests.Count -and $effectiveRole -eq 'host'){
        $manifests=@(Get-ChildItem -LiteralPath (Join-Path $HOME 'Desktop') -File -Filter 'letta-*.shared.json' -ErrorAction SilentlyContinue)
    }
    if(-not $manifests.Count){
        AddCheck 'Shared Letta manifests' 'warn' 'No shared project manifests found.' 'Export/import project bindings after verifying Git identities.'
    }elseif(-not $state -or -not $projectRegistry){
        AddCheck 'Shared Letta manifests' 'fail' 'Cannot verify bindings without state.json and projects.json.'
    }else{
        $okCount=0
        foreach($manifestFile in $manifests) {
            $m=SafeJson $manifestFile.FullName
            if(-not $m -or -not $m.agentId -or -not $m.repository -or -not $m.projectId){
                AddCheck ('Manifest '+$manifestFile.Name) 'fail' 'Malformed binding manifest.'
                continue
            }
            $candidates=@($state.projects.PSObject.Properties | Where-Object{$_.Value.lettaAgentId -eq $m.agentId})
            if($candidates.Count -ne 1){
                AddCheck ('Agent '+$m.projectId) 'fail' ('Expected one local binding for agent '+$m.agentId+'; found '+$candidates.Count)
                continue
            }
            $localId=$candidates[0].Name
            $project=@($projectRegistry.projects|Where-Object {$_.id -eq $localId})
            if($project.Count -ne 1){
                AddCheck ('Agent '+$m.projectId) 'fail' ('Local Project ID '+$localId+' not registered.')
                continue
            }
            $repo=GitIdentity ([string]$project[0].path)
            if($repo -ne [string]$m.repository){
                AddCheck ('Agent '+$m.projectId) 'fail' ('Git remote mismatch for '+$localId+'.')
                continue
            }
            $conversations=@($candidates[0].Value.sessions.PSObject.Properties | Where-Object{$_.Value.engine -eq 'letta' -and $_.Value.sessionId})
            if(-not $conversations.Count){
                AddCheck ('Agent '+$m.projectId) 'warn' ('Bound to '+$localId+', no executed Letta conversation yet.')
                continue
            }
            $okCount++
            AddCheck ('Agent '+$m.projectId) 'pass' ('Local='+$localId+'; Git identity matches; '+$conversations.Count+' conversation(s).')
        }
        AddCheck 'Shared Letta summary' 'pass' ($okCount.ToString()+'/'+$manifests.Count+' validated and initialized.')
    }
}
foreach($r in @($ProjectRoot,$ExtraRoot)){
    if(-not $r){continue}
    if(Test-Path -LiteralPath $r -PathType Container){
        $dirs=@(Get-ChildItem -LiteralPath $r -Directory -ErrorAction SilentlyContinue)
        $count=@($dirs|Where-Object{Test-Path -LiteralPath (Join-Path $_.FullName '.git')}).Count
        if(Test-Path -LiteralPath (Join-Path $r '.git')){$count++}
        AddCheck ('Git root '+$r) 'pass' ($count.ToString()+' immediate Git checkout(s), no indexing performed.')
    }else {AddCheck ('Git root '+$r) 'warn' 'Directory not found.'}
}

$passCount=@($results|Where-Object {$_.status -eq 'pass'}).Count
$warnCount=@($results|Where-Object {$_.status -eq 'warn'}).Count
$failCount=@($results|Where-Object {$_.status -eq 'fail'}).Count
$exitCode=if($failCount -gt 0 -or ($Strict -and $warnCount -gt 0)){1}else{0}
$summary=[ordered]@{
    version='0.2.1'
    host=$env:COMPUTERNAME
    role=$effectiveRole
    readOnly=$true
    pass=$passCount
    warn=$warnCount
    fail=$failCount
    healthy=($exitCode -eq 0)
    checks=@($results.ToArray())
}
if($Json){Write-Output ($summary|ConvertTo-Json -Depth 8)}
else{Write-Output ('Doctor result: PASS='+$passCount+' WARN='+$warnCount+' FAIL='+$failCount+' EXIT='+$exitCode+' | no settings changed')}
exit $exitCode
