#Requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Node)
$ErrorActionPreference='Stop'
$headlessRoot=Join-Path $env:USERPROFILE '.openchatx-mcp\headless'
$runtimeRoot=Join-Path $env:LOCALAPPDATA 'Programs\OpenChatX\runtime'
$pausePath=Join-Path $headlessRoot 'health-watch.paused'
$journal=Join-Path $headlessRoot 'core-maintenance\.audit-update-pending.json'
$mutex=[Threading.Mutex]::new($false,'Local\Naos.OpenChatX.HealthWatch')
$owns=$false;$createdPause=$false;$code=1
try {
    try{$owns=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$owns=$true}
    if(-not $owns){throw 'Health watcher is active; no files changed.'}
    foreach($taskRoot in @($headlessRoot,$runtimeRoot)){
        $cursor=[IO.Path]::GetFullPath($taskRoot)
        while($cursor){
            if((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked maintenance root refused.'}
            $parent=Split-Path -Parent $cursor
            if(-not $parent -or $parent -eq $cursor){break};$cursor=$parent
        }
    }
    if(Test-Path -LiteralPath $pausePath){throw 'Existing watchdog pause retained; inspect its owner before maintenance.'}
    if(Test-Path -LiteralPath $journal){throw 'CORE_AUDIT_RECOVERY_REQUIRED'}
    $stream=[IO.File]::Open($pausePath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    try{$bytes=[Text.Encoding]::UTF8.GetBytes('Core audit diagnostics maintenance');$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
    $createdPause=$true
    & $Node (Join-Path $PSScriptRoot 'apply-audit-diagnostics.mjs') $runtimeRoot $headlessRoot
    $code=$LASTEXITCODE
} finally {
    try {
        if($createdPause -and -not(Test-Path -LiteralPath $journal)){
            try {
                $response=Invoke-WebRequest -Uri 'http://127.0.0.1:8001/healthz' -UseBasicParsing -TimeoutSec 3
                if([int]$response.StatusCode -eq 200){Remove-Item -LiteralPath $pausePath}
            } catch { Write-Warning 'Watchdog pause retained: MCP health not confirmed.' }
        }
        if($createdPause -and (Test-Path -LiteralPath $pausePath)){Write-Warning 'Watchdog remains paused; inspect the backup/journal and MCP before resuming.'}
    } finally {if($owns){$mutex.ReleaseMutex()};$mutex.Dispose()}
}
exit $code
