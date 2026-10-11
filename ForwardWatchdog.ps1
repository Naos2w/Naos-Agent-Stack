# Naos Agent Setup - SSH private forward watchdog (Windows PowerShell 5.1)
# Deliberately never stores, prints, or transfers a passphrase/private key.
[CmdletBinding()]
param([switch]$Status)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$configFile = Join-Path $env:LOCALAPPDATA 'NaosAgentSetup\client.json'
if (-not (Test-Path -LiteralPath $configFile -PathType Leaf)) {
    Write-Output 'NOT_CONFIGURED'
    exit 0
}
$config = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
$logRoot = Join-Path $env:LOCALAPPDATA 'NaosAgentSetup\logs'
$statusFile = Join-Path $logRoot 'forward.status'
$logFile = Join-Path $logRoot 'forward.log'
function Emit([string]$code) {
    if ($Status) { Write-Output $code; return }
    if (-not (Test-Path -LiteralPath $logRoot)) { New-Item -ItemType Directory -Path $logRoot -Force | Out-Null }
    $before = if (Test-Path -LiteralPath $statusFile) { (Get-Content $statusFile -Raw -ErrorAction SilentlyContinue).Trim() } else { '' }
    if ($before -eq $code) { return }
    [IO.File]::WriteAllText($statusFile, $code, [Text.UTF8Encoding]::new($false))
    if (Test-Path -LiteralPath $logFile) {
        if ((Get-Item $logFile).Length -gt 524288) { Move-Item $logFile "$logFile.old" -Force }
    }
    Add-Content -LiteralPath $logFile -Value ((Get-Date -Format s) + ' ' + $code) -Encoding UTF8
}
if ($config.role -ne 'client') { Emit 'NOT_A_CLIENT'; return }
if ((whoami).Trim() -ine [string]$config.runAs) { Emit 'WRONG_ACCOUNT'; return }
$hostIp = [string]$config.hostIp
$sshUser = [string]$config.sshUser
$sshPort = [int]$config.sshPort
$localPort = [int]$config.localPort
$remotePort = [int]$config.remotePort
$keyPath = [string]$config.keyPath
$mapping = '127.0.0.1:' + $localPort + ':127.0.0.1:' + $remotePort
$sshDir = Join-Path $env:WINDIR 'System32\OpenSSH'
$exe = Join-Path $sshDir 'ssh.exe'
$scan = Join-Path $sshDir 'ssh-keygen.exe'
$known = Join-Path $HOME '.ssh\known_hosts'
$listeners = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $localPort -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count) {
    $proc = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listeners[0].OwningProcess) -ErrorAction SilentlyContinue
    $command = if ($proc) { [string]$proc.CommandLine } else { '' }
    if ($proc -and $proc.Name -ieq 'ssh.exe' -and $command.Contains($mapping) -and $command.Contains($hostIp)) {
        Emit 'FORWARD_RUNNING'
    } else {
        Emit 'PORT_BUSY_NOT_OWNED'
    }
    return
}
if ($Status) { Emit 'FORWARD_NOT_RUNNING'; return }
foreach ($item in @($exe, $scan, $known, $keyPath)) {
    if (-not (Test-Path -LiteralPath $item -PathType Leaf)) { Emit 'PREREQUISITE_MISSING'; return }
}
$trusted = @(& $scan -F "[$hostIp]:$sshPort" -f $known 2>$null)
if (-not $trusted.Count) { Emit 'UNTRUSTED_HOST_NEEDS_INTERACTIVE_VERIFICATION'; return }
$agent = Get-Service ssh-agent -ErrorAction SilentlyContinue
if (-not $agent -or $agent.Status -ne 'Running') { Emit 'SSH_AGENT_NOT_RUNNING'; return }
$t = Get-Service Tailscale -ErrorAction SilentlyContinue
if (-not $t -or $t.Status -ne 'Running') { Emit 'TAILSCALE_NOT_RUNNING'; return }
$socket = New-Object Net.Sockets.TcpClient
try {
    $pending = $socket.BeginConnect($hostIp, $sshPort, $null, $null)
    if (-not $pending.AsyncWaitHandle.WaitOne(2500)) { Emit 'HOST_UNREACHABLE'; return }
    $socket.EndConnect($pending)
} catch { Emit 'HOST_UNREACHABLE'; return }
finally { $socket.Dispose() }
$arguments = @(
    '-N','-T',
    '-o','BatchMode=yes',
    '-o','IdentitiesOnly=yes',
    '-o','StrictHostKeyChecking=yes',
    '-o','ExitOnForwardFailure=yes',
    '-o','ConnectTimeout=8',
    '-o','ConnectionAttempts=1',
    '-o','ServerAliveInterval=30',
    '-o','ServerAliveCountMax=3',
    '-p',"$sshPort",
    '-i',('"' + $keyPath + '"'),
    '-L',$mapping,
    ($sshUser + '@' + $hostIp)
)
try {
    if (-not (Test-Path $logRoot)) { New-Item -ItemType Directory -Path $logRoot -Force | Out-Null }
    $child = Start-Process -FilePath $exe -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardError (Join-Path $logRoot 'ssh.stderr.log')
    Start-Sleep -Seconds 3
    $new = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $localPort -State Listen -ErrorAction SilentlyContinue)
    if ($new.Count -and [int]$new[0].OwningProcess -eq $child.Id) { Emit 'FORWARD_ESTABLISHED' }
    else { Emit 'SSH_START_FAILED_RETRY_LATER' }
} catch { Emit ('SSH_START_ERROR_' + $_.Exception.GetType().Name) }
