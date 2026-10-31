#Requires -Version 5.1
param([Parameter(Mandatory=$true)][string]$PlanSha256)
$ErrorActionPreference='Stop'
$mutex=[Threading.Mutex]::new($false,'Local\Naos.OpenChatX.HealthWatch')
$owns=$false
try {
 try{$owns=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$owns=$true}
 if(-not $owns){throw 'Health watcher is active; no migration performed.'}
 Start-Sleep -Seconds 10 # Let the initiating MCP response finish before its restart.
 $node=Join-Path $env:LOCALAPPDATA 'Programs\OpenChatX\runtime\bin\node.exe'
 & $node (Join-Path $PSScriptRoot 'apply.mjs') $PlanSha256 *> (Join-Path $PSScriptRoot 'apply.log')
 exit $LASTEXITCODE
}finally{if($owns){$mutex.ReleaseMutex()};$mutex.Dispose()}
