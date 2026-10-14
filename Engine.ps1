# Naos Agent Setup - module orchestrator for Windows PowerShell 5.1.
# Existing machine configuration is never overwritten without a backup.
[CmdletBinding()]
param(
    [ValidateSet('Plan','Apply','Health')][string]$Mode = 'Plan',
    [ValidateSet('single','host','client','existing')][string]$Role = 'single',
    [switch]$InstallCore,
    [switch]$InstallGit,
    [switch]$PowerShell7,
    [switch]$OhMyPosh,
    [switch]$NerdFont,
    [switch]$SetTerminalDefault,
    [switch]$ConfigureSharing,
    [switch]$InstallOpenSSH,
    [switch]$ScanProjects,
    [string]$LettaRoot = '',
    [string]$HostIp = '',
    [string]$PeerIp = '',
    [string]$SshUser = '',
    [string]$KeyPath = '',
    [string]$PublicKeyPath = '',
    [string]$ProjectRoot = '',
    [string]$ExtraRoot = '',
    [int]$SshPort = 2222,
    [int]$LocalPort = 4501,
    [int]$RemotePort = 4500
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'Programs\OpenChatX\runtime'
$headlessRoot = Join-Path $HOME '.openchatx-mcp\headless'
$runtimeConfig = Join-Path $headlessRoot 'toolboxes\agent-runtime\config.json'
$machineRoot = Join-Path $env:LOCALAPPDATA 'NaosAgentSetup'
$clientConfig = Join-Path $machineRoot 'client.json'
$installerScript = Join-Path $root 'payload\bootstrap\naos-agent-stack.ps1'
$bundle = Join-Path $root 'payload\naos-headless-stack-bundle.zip'
$prerequisiteScript=Join-Path $root 'Prerequisites.ps1'
if(-not (Test-Path -LiteralPath $prerequisiteScript -PathType Leaf)){throw 'Prerequisites.ps1 missing from installation package.'}
. $prerequisiteScript
$offlinePackages=Join-Path $root 'payload\prerequisites'
$terminalFile=Join-Path $root 'Terminal-Extras.ps1'
if(-not(Test-Path -LiteralPath $terminalFile -PathType Leaf)){throw 'Terminal-Extras.ps1 missing from installer.'}
. $terminalFile
$terminalAssets=Join-Path $root 'payload\terminal'
$terminalSelected=([bool]$PowerShell7 -or [bool]$OhMyPosh -or [bool]$NerdFont -or [bool]$SetTerminalDefault)
$letRoot = if($LettaRoot){[IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($LettaRoot))}
           else {Join-Path $env:LOCALAPPDATA 'NaosAgentSetup\Letta-POC'}

function Note([string]$what) { Write-Output ('[INFO] ' + $what) }
function Good([string]$what) { Write-Output ('[PASS] ' + $what) }
function Caution([string]$what) { Write-Output ('[WARN] ' + $what) }
function Require([bool]$condition,[string]$message) { if(-not $condition) { throw ('[BLOCKED] ' + $message) } }
function Present([string]$path) { return Test-Path -LiteralPath $path }
function IsAdmin {
  $p=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function TailnetIp([string]$ip) {
  $parsed=$null
  if(-not [Net.IPAddress]::TryParse($ip,[ref]$parsed)){return $false}
  if($parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork){return $false}
  $octets=$parsed.GetAddressBytes()
  return ($octets[0] -eq 100 -and $octets[1] -ge 64 -and $octets[1] -le 127)
}
function ValidateNetworking {
  Require (TailnetIp $HostIp) 'Main host must have a Tailscale IPv4 address (100.64.0.0/10).'
  Require ($SshPort -ge 1024 -and $SshPort -le 65535) 'SSH port must be 1024..65535.'
  Require ($LocalPort -ge 1024 -and $LocalPort -le 65535) 'Local forward port must be 1024..65535.'
  Require ($RemotePort -ge 1024 -and $RemotePort -le 65535) 'Remote Letta port must be 1024..65535.'
  Require ($SshUser -match '^[A-Za-z0-9_.-]{1,80}$') 'SSH user must be a plain Windows account name.'
  if($Role -eq 'host'){Require (TailnetIp $PeerIp) 'Client Tailscale IPv4 address is required.'}
}
function ReadRuntimeState {
  $stateFile=Join-Path $headlessRoot 'toolboxes\agent-runtime\state.json'
  if(Present $stateFile){return (Get-Content $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json)}
  return $null
}
function SafelySaveJson([string]$path,$obj) {
  $dir=Split-Path -Parent $path
  if(-not (Present $dir)){New-Item -Path $dir -ItemType Directory -Force | Out-Null}
  if(Present $path){Copy-Item -LiteralPath $path -Destination ($path+'.backup-'+(Get-Date -Format yyyyMMddHHmmss)) -Force}
  $temporary=$path+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
  try {
    [IO.File]::WriteAllText($temporary,($obj | ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $path -Force
  } finally { if(Present $temporary){Remove-Item $temporary -Force} }
}
function ShowHealth {
  Note ('Computer=' + $env:COMPUTERNAME + ' User=' + (whoami))
  Note ('Role=' + $Role + ' Admin=' + (IsAdmin))
  foreach($pair in @(
    @('Headless runtime',(Join-Path $runtimeRoot 'package.json')),
    @('OpenChatX headless',(Join-Path $headlessRoot 'start-headless.ps1')),
    @('Letta config',$runtimeConfig),
    @('Bundled bootstrap',$installerScript),
    @('Offline headless bundle',$bundle))) {
    $found=Present $pair[1]
    Note ($pair[0] + '=' + $(if($found){'Present'}else{'Missing'}))
  }
  if(Present $runtimeConfig) {
    $c=Get-Content $runtimeConfig -Raw -Encoding UTF8|ConvertFrom-Json
    Note ('LettaURL=' + $c.lettaServerUrl + ' AutoStart=' + $c.lettaAutoStart)
  }
  foreach($svcName in @('Tailscale','sshd','ssh-agent')) {
    $svc=Get-Service $svcName -ErrorAction SilentlyContinue
    Note ($svcName + '=' + $(if($svc){$svc.Status.ToString()}else{'Not installed'}))
  }
  $listen=@(Get-NetTCPConnection -State Listen -LocalPort $LocalPort -LocalAddress '127.0.0.1' -ErrorAction SilentlyContinue)
  Note ('Loopback ' + $LocalPort + ' listener=' + $listen.Count)
  $task=Get-ScheduledTask -TaskName 'Naos Letta SSH Forward' -ErrorAction SilentlyContinue
  Note ('Reconnect task=' + $(if($task){$task.State.ToString()}else{'Not configured'}))
}
function DiscoverProjects {
  foreach($where in @($ProjectRoot,$ExtraRoot)) {
    if(-not $where){continue}
    if(-not (Present $where)){Caution ('Project root missing: '+$where);continue}
    Note ('Scanning project root (read-only): '+$where)
    $projects = @(Get-ChildItem -LiteralPath $where -Directory -ErrorAction SilentlyContinue)
    if(Present (Join-Path $where '.git')) {
      Note ('GIT '+$where)
    }
    foreach($p in $projects){
      if(Present (Join-Path $p.FullName '.git')) {Note ('GIT '+$p.FullName)}
    }
    Note 'No projects were registered or indexed during this scan.'
  }
}
function PrepareCore {
  if(-not $InstallCore){Note 'Core installation skipped (not selected).';return}
  $runtimeExists = Present (Join-Path $runtimeRoot 'package.json')
  $headlessExists = Present (Join-Path $headlessRoot 'start-headless.ps1')
  if($runtimeExists -and $headlessExists){Good 'Existing OpenChatX Headless detected: will not reinstall or overwrite.';return}
  Require (-not $runtimeExists -and -not $headlessExists) 'Partial OpenChatX installation detected. Refusing to overwrite; repair manually.'
  Require (Present $installerScript) 'Headless bootstrap script missing in payload/bootstrap.'
  $hasNode=Test-NaosSystemNode
  $hasGit=Test-NaosSystemGit
  if($Mode -ne 'Apply'){
    if(-not(Present $bundle)){Caution 'Headless core ZIP missing. Obtain v0.2.1 complete Release to install from scratch.'}
    if($hasNode){Good 'Node.js 22.19+ and npm already available.'}
    else{
      $node=(Get-NaosPrerequisiteDefinition node)
      Note ('PLAN: Install verified offline '+$node.Archive+' into current-user tools; no admin required.')
      if(-not(Present (Join-Path $offlinePackages $node.Archive))){Caution ('Offline Node/npm ZIP missing: '+$node.Archive)}
    }
    if($InstallGit){
      if($hasGit){Good 'Git already installed. Optional MinGit will not replace it.'}
      else{
        $mingit=(Get-NaosPrerequisiteDefinition git)
        Note ('PLAN: Install optional offline MinGit '+$mingit.Version+' into current-user tools.')
        if(-not(Present (Join-Path $offlinePackages $mingit.Archive))){Caution ('Offline MinGit ZIP missing: '+$mingit.Archive)}
      }
    }
    Note 'PLAN: Install Headless + Letta + PM2 + codebase-memory to empty paths; npm package installation still requires Internet (not a fully offline setup).'
    return
  }
  Require (Present $bundle) 'Headless core ZIP missing. Download the complete v0.2.1 Release before fresh install.'
  $lockFile=Join-Path $root 'dependencies.lock.json'
  Require (Present $lockFile) 'Dependency lock file missing.'
  $lock=Get-Content -LiteralPath $lockFile -Raw -Encoding UTF8|ConvertFrom-Json
  Require ($lock.packageVersion -eq '0.2.1' -and $lock.core.sha256 -match '^[a-fA-F0-9]{64}$') 'Dependency lock version/core checksum invalid.'
  Assert-NaosTrustedArchive $bundle $lock.core.sha256
  # Preflight every required offline archive before installing anything.
  if(-not $hasNode){$node=Get-NaosPrerequisiteDefinition node;Assert-NaosTrustedArchive (Join-Path $offlinePackages $node.Archive) $node.Sha256}
  if($InstallGit -and -not $hasGit){$mingit=Get-NaosPrerequisiteDefinition git;Assert-NaosTrustedArchive (Join-Path $offlinePackages $mingit.Archive) $mingit.Sha256}
  Assert-NaosInstallPrerequisites -PackageRoot $offlinePackages -IncludeGit:$InstallGit
  Note 'Installing Headless core (npm registry Internet access may be required). No reboot will be initiated.'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installerScript -Mode install -BundlePath $bundle -LettaRoot $letRoot
  Require ($LASTEXITCODE -eq 0) 'Headless bootstrap failed. See the output; not retrying automatically.'
  Good 'Headless bootstrap completed.'
}
function PrepareOptionalGitWhenCoreIsSkipped {
  if(-not $InstallGit){return}
  $coreAlreadyPresent=(Present (Join-Path $runtimeRoot 'package.json')) -and (Present (Join-Path $headlessRoot 'start-headless.ps1'))
  if($InstallCore -and -not $coreAlreadyPresent){return}  # Fresh install handles Git in PrepareCore.
  if(Test-NaosSystemGit){Good 'Git CLI already available; keeping the existing installation.';return}
  $spec=Get-NaosPrerequisiteDefinition git
  if($Mode -ne 'Apply'){
    Note ('PLAN: Install optional '+$spec.Archive+' into current-user tools without changing OpenChatX.')
    if(-not(Present (Join-Path $offlinePackages $spec.Archive))){Caution ('Offline Git ZIP missing: '+$spec.Archive)}
    return
  }
  Assert-NaosTrustedArchive (Join-Path $offlinePackages $spec.Archive) $spec.Sha256
  Install-NaosPortablePrerequisite -Name git -PackageRoot $offlinePackages
}
function SetupClient {
  ValidateNetworking
  $key=if($KeyPath){[Environment]::ExpandEnvironmentVariables($KeyPath)}else{Join-Path $HOME '.ssh\id_ed25519'}
  Require (Present $key) ('SSH key not found: '+$key)
  Require (Present "$key.pub") 'SSH public-key companion missing.'
  $expectedUrl='ws://127.0.0.1:'+$LocalPort
  $agent=Get-Service ssh-agent -ErrorAction SilentlyContinue
  if(-not $agent -or $agent.Status -ne 'Running'){
    Caution 'Windows ssh-agent must be Running; add your passphrase-protected key interactively using ssh-add.'
  }
  $config=[ordered]@{
    schema=1; role='client'; runAs=(whoami).Trim()
    hostIp=$HostIp; sshUser=$SshUser; sshPort=$SshPort
    localPort=$LocalPort; remotePort=$RemotePort
    keyPath=$key; projectRoot=$ProjectRoot; extraRoot=$ExtraRoot
  }
  if($Mode -ne 'Apply'){
    Note ('PLAN: Create local-only SSH forward ' + $LocalPort + ' -> ' + $HostIp + ':'+$RemotePort + ' with logon + 2-minute watchdog.')
    Note ('PLAN: Runtime endpoint ' + $expectedUrl + ' only after the forward is confirmed.')
    Note 'PLAN: Existing Git checkouts, Agent IDs, and Session IDs are not copied, overwritten, or deleted.'
    return
  }
  $scriptSrc=Join-Path $root 'ForwardWatchdog.ps1'
  Require (Present $scriptSrc) 'ForwardWatchdog.ps1 missing.'
  if(-not(Present $machineRoot)){New-Item -ItemType Directory -Path $machineRoot -Force|Out-Null}
  $scriptTarget=Join-Path $machineRoot 'ForwardWatchdog.ps1'
  if(Present $scriptTarget){Copy-Item $scriptTarget ($scriptTarget+'.backup-'+(Get-Date -Format yyyyMMddHHmmss)) -Force}
  Copy-Item -LiteralPath $scriptSrc -Destination $scriptTarget -Force
  SafelySaveJson $clientConfig $config
  $action=New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$scriptTarget+'"')
  $user=(whoami).Trim()
  $tLogon=New-ScheduledTaskTrigger -AtLogOn -User $user
  $tRetry=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2)
  $principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  $settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 1)
  $taskName='Naos Letta SSH Forward'
  $old=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if($old){
    $expectedPath=[string]$old.Actions[0].Arguments
    Require ($expectedPath.Contains('ForwardWatchdog.ps1') -or $expectedPath.Contains('ensure-msi-letta-ssh.ps1')) 'Existing reconnect task has unfamiliar action. Refusing to overwrite.'
    Set-ScheduledTask -TaskName $taskName -Action $action -Trigger @($tLogon,$tRetry) -Principal $principal -Settings $settings | Out-Null
  } else {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($tLogon,$tRetry) -Principal $principal -Settings $settings -Description 'Naos Agent Setup: Tailscale SSH Letta loopback forward; no saved password.' | Out-Null
  }
  Good 'Reconnect watchdog installed (only runs after user login).'
  Start-ScheduledTask -TaskName $taskName
  Start-Sleep -Seconds 4
  $forward=@(Get-NetTCPConnection -State Listen -LocalAddress '127.0.0.1' -LocalPort $LocalPort -ErrorAction SilentlyContinue)
  if(-not $forward.Count){
    Caution 'Forward not yet connected. Verify MSI host fingerprint, install public key, and add private key to ssh-agent. Letta runtime remains unchanged.'
    return
  }
  $owner=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $forward[0].OwningProcess) -ErrorAction SilentlyContinue
  $expectedMapping='127.0.0.1:'+$LocalPort+':127.0.0.1:'+$RemotePort
  if(-not $owner -or $owner.Name -ine 'ssh.exe' -or -not([string]$owner.CommandLine).Contains($expectedMapping) -or -not([string]$owner.CommandLine).Contains($HostIp)){
    Caution 'Forward listener is not the expected SSH process. Letta Runtime remains unchanged.'
    return
  }
  if(-not(Present $runtimeConfig)){
    Caution 'Headless Letta config not found. Re-run after installing core.'
    return
  }
  $cfg=Get-Content $runtimeConfig -Raw -Encoding UTF8|ConvertFrom-Json
  if($cfg.lettaServerUrl -ne $expectedUrl){
    $state=ReadRuntimeState
    if($state -and $state.projects){
      foreach($p in $state.projects.PSObject.Properties){
        if(-not $p.Value.sessions){continue}
        foreach($s in $p.Value.sessions.PSObject.Properties){
          if($s.Value.engine -eq 'letta' -and $s.Value.sessionId){
            throw '[BLOCKED] Existing Letta sessions point at another backend. Manual migration required.'
          }
        }
      }
    }
    $cfg.lettaServerUrl=$expectedUrl
  }
  $cfg.lettaAutoStart=$false
  SafelySaveJson $runtimeConfig $cfg
  Good ('Letta client configured for SSH private endpoint '+$expectedUrl+'.')
}
function SetupHost {
  ValidateNetworking
  Note ('Main host=' + $HostIp + ' / allowed client=' + $PeerIp)
  if($Mode -ne 'Apply'){
    Note ('PLAN: SSH Server TCP '+$SshPort+' restricted to '+$PeerIp+' on Tailnet '+$HostIp)
    Note ('PLAN: Password login disabled. Forwarding limited to 127.0.0.1:'+$RemotePort)
    Note 'PLAN: Refuses to overwrite an existing SSH config that does not already match. No RustDesk rules will change.'
    if($InstallOpenSSH){Note 'PLAN: Install Windows OpenSSH Server optional feature if missing (Windows Update may be required).'}
    return
  }
  Require (IsAdmin) 'Host setup needs an elevated Administrator PowerShell window.'
  $authPreflight=Join-Path $env:ProgramData 'ssh\administrators_authorized_keys'
  Require ([bool]($PublicKeyPath -or (Present $authPreflight))) 'A verified SSH public key is required before changing host SSH settings.'
  if($PublicKeyPath){
    Require (Present $PublicKeyPath) 'Selected .pub key file missing.'
    $pubLines=@(Get-Content -LiteralPath $PublicKeyPath -Encoding ASCII | Where-Object {$_ -and $_.Trim()})
    Require ($pubLines.Count -eq 1 -and $pubLines[0] -match '^ssh-ed25519 [A-Za-z0-9+/=]+( .*)?$') 'Invalid SSH public key format.'
  }
  $sshSvc=Get-Service sshd -ErrorAction SilentlyContinue
  if(-not $sshSvc){
    Require ([bool]$InstallOpenSSH) 'OpenSSH Server missing. Select optional installation or install it manually.'
    Note 'Installing Windows OpenSSH Server via Windows Optional Features; no reboot will be initiated.'
    Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0' | Out-Null
    $sshSvc=Get-Service sshd -ErrorAction SilentlyContinue
    Require ([bool]$sshSvc) 'OpenSSH Server installation did not complete.'
  }
  $sshDir=Join-Path $env:ProgramData 'ssh'
  if(-not(Present $sshDir)){New-Item -Path $sshDir -ItemType Directory -Force|Out-Null}
  $cfgPath=Join-Path $sshDir 'sshd_config'
  $configuration=@(
    'Port '+$SshPort,
    'AddressFamily inet',
    'PubkeyAuthentication yes',
    'PasswordAuthentication no',
    'AllowUsers '+$SshUser,
    'AllowTcpForwarding local',
    'PermitOpen 127.0.0.1:'+$RemotePort,
    'X11Forwarding no',
    '',
    'Match Group administrators',
    '    AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys'
  ) -join [Environment]::NewLine
  if(Present $cfgPath){
    $existing=Get-Content $cfgPath -Raw -Encoding UTF8
    foreach($line in @('Port '+$SshPort,'PasswordAuthentication no','AllowUsers '+$SshUser,'AllowTcpForwarding local','PermitOpen 127.0.0.1:'+$RemotePort)){
      Require ([bool]([regex]::IsMatch($existing,'(?m)^\s*'+[regex]::Escape($line)+'\s*$'))) ('Existing sshd_config does not match expected: '+$line+'. No changes made.')
    }
    Good 'Existing SSH config matches expected options; left unchanged.'
  } else {
    [IO.File]::WriteAllText($cfgPath,$configuration,[Text.Encoding]::ASCII)
    Good 'Created restricted SSH configuration.'
  }
  $auth=Join-Path $sshDir 'administrators_authorized_keys'
  if($PublicKeyPath){
    Require (Present $PublicKeyPath) 'Selected .pub key file missing.'
    $lines=@(Get-Content -LiteralPath $PublicKeyPath -Encoding ASCII | Where-Object {$_ -and $_.Trim()})
    Require ($lines.Count -eq 1 -and $lines[0] -match '^ssh-ed25519 [A-Za-z0-9+/=]+( .*)?$') 'Invalid SSH public key format.'
    if(Present $auth){Copy-Item $auth ($auth+'.backup-'+(Get-Date -Format yyyyMMddHHmmss)) -Force}
    $present=if(Present $auth){Get-Content $auth -Raw}else{''}
    if(-not $present.Contains($lines[0])){Add-Content -LiteralPath $auth -Value $lines[0] -Encoding ASCII}
  }
  Require (Present $auth) 'No authorized admin key. Provide a .pub file first; private key must stay on the client.'
  & icacls.exe $auth /inheritance:r | Out-Null
  & icacls.exe $auth /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
  $sshExe=Join-Path $env:WINDIR 'System32\OpenSSH\sshd.exe'
  $gen=Join-Path $env:WINDIR 'System32\OpenSSH\ssh-keygen.exe'
  & $gen -A | Out-Null
  & $sshExe -t -f $cfgPath
  Require ($LASTEXITCODE -eq 0) 'OpenSSH syntax/permissions check failed. Service not started.'
  Set-Service sshd -StartupType Automatic
  if((Get-Service sshd).Status -ne 'Running'){Start-Service sshd}
  $ruleName='Naos-Letta-SSH-PC2'
  $rule=Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
  if($rule){
    $addr=$rule|Get-NetFirewallAddressFilter
    $ports=$rule|Get-NetFirewallPortFilter
    Require ($rule.Enabled -eq 'True' -and $rule.Action -eq 'Allow' -and $rule.Direction -eq 'Inbound' -and
      [string]$ports.LocalPort -eq [string]$SshPort -and [string]$addr.LocalAddress -eq $HostIp -and [string]$addr.RemoteAddress -eq $PeerIp) 'Existing firewall rule differs; refusing overwrite.'
    Good 'Dedicated Tailnet firewall rule already correct.'
  } else {
    New-NetFirewallRule -Name $ruleName -DisplayName 'Letta SSH via Tailscale PC2' -Direction Inbound -Protocol TCP -LocalAddress $HostIp -RemoteAddress $PeerIp -LocalPort $SshPort -Action Allow -Profile Any | Out-Null
    Good 'Dedicated restrictive Tailnet firewall rule added.'
  }
  $generic=Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue
  if($generic -and $generic.Enabled -eq 'True'){Caution 'Default OpenSSH inbound rule is enabled; review it. Installer does not disable existing firewall rules automatically.'}
  Good 'Host SSH configured. No changes to RustDesk or unrelated services.'
}
if($env:OS -ne 'Windows_NT'){throw '[BLOCKED] Windows only.'}
Note ('Naos Agent Setup - Mode='+$Mode+' Role='+$Role)
if($Mode -eq 'Health'){
  ShowHealth
  if($ScanProjects){DiscoverProjects}
  exit 0
}
ShowHealth
if($ScanProjects){DiscoverProjects}
if($Mode -eq 'Plan'){
  PrepareOptionalGitWhenCoreIsSkipped
  PrepareCore
  if($terminalSelected){
    Invoke-NaosTerminalSetup -Mode Plan -PowerShell7:$PowerShell7 -OhMyPosh:$OhMyPosh -NerdFont:$NerdFont -TerminalDefault:$SetTerminalDefault -AssetsRoot $terminalAssets
  }
  if($ConfigureSharing){
    if($Role -eq 'client'){SetupClient}
    elseif($Role -eq 'host'){SetupHost}
    else {Note 'Sharing not selected for this role.'}
  }
  Good 'PLAN_ONLY_NO_CHANGES'
  exit 0
}
Require ($Mode -eq 'Apply') 'Unknown operation'
if($terminalSelected){
  # Verify selected optional binary payloads before changing anything in the core or user settings.
  Invoke-NaosTerminalSetup -Mode Preflight -PowerShell7:$PowerShell7 -OhMyPosh:$OhMyPosh -NerdFont:$NerdFont -TerminalDefault:$SetTerminalDefault -AssetsRoot $terminalAssets
}
if($ConfigureSharing){
  # Fail before installing the core or touching tasks/firewall when dual-PC prerequisites
  # are missing. Tailscale login and SSH credentials remain external manual steps.
  Require ($Role -in @('host','client')) 'Sharing requires host/client role.'
  ValidateNetworking
  $tailscaleService=Get-Service Tailscale -ErrorAction SilentlyContinue
  Require ([bool]($tailscaleService -and $tailscaleService.Status -eq 'Running')) 'Shared-memory setup requires a running Tailscale service; sign in and retry.'
  if($Role -eq 'host'){
    Require (IsAdmin) 'Shared-memory host setup requires Administrator PowerShell.'
    if($PublicKeyPath){Require (Present $PublicKeyPath) 'Verified SSH public key .pub file missing.'}
    else{
      $authorized=Join-Path $env:ProgramData 'ssh\administrators_authorized_keys'
      Require (Present $authorized) 'Shared host needs an authorized SSH public key before setup.'
    }
  }
  if($Role -eq 'client'){
    $key=if($KeyPath){[Environment]::ExpandEnvironmentVariables($KeyPath)}else{Join-Path $HOME '.ssh\id_ed25519'}
    Require (Present $key) 'Shared client requires a local SSH private key before setup.'
    Require (Present ($key+'.pub')) 'Shared client requires the matching public key before setup.'
    $sshAgent=Get-Service ssh-agent -ErrorAction SilentlyContinue
    Require ([bool]($sshAgent -and $sshAgent.Status -eq 'Running')) 'Shared client requires Windows ssh-agent running before setup.'
  }
}
PrepareOptionalGitWhenCoreIsSkipped
PrepareCore
if($ConfigureSharing){
  if($Role -eq 'client'){SetupClient}
  elseif($Role -eq 'host'){SetupHost}
  else {Caution 'Single-machine mode does not install any SSH/Tailscale forwarding.'}
}
if($terminalSelected){
  Invoke-NaosTerminalSetup -Mode Apply -PowerShell7:$PowerShell7 -OhMyPosh:$OhMyPosh -NerdFont:$NerdFont -TerminalDefault:$SetTerminalDefault -AssetsRoot $terminalAssets
}
Good 'APPLY_COMPLETE_NO_REBOOT'
