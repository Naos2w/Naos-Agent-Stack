param(
    [Parameter(Mandatory = $true)][string]$Node
)
$ErrorActionPreference = 'Stop'
$headlessRoot = Join-Path $env:USERPROFILE '.openchatx-mcp\headless'
$toolboxRoot = Join-Path $headlessRoot 'toolboxes\agent-runtime'
$pausePath = Join-Path $headlessRoot 'health-watch.paused'
$pm2Cli = Join-Path $headlessRoot 'node_modules\pm2\bin\pm2'
$previousPm2Home = $env:PM2_HOME
$env:PM2_HOME = Join-Path $headlessRoot 'pm2'
$watchMutex = [System.Threading.Mutex]::new($false, 'Local\Naos.OpenChatX.HealthWatch')
$ownsMutex = $false
$createdPause = $false
$stopped = $false
$restored = $false
try {
    try { $ownsMutex = $watchMutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) { throw 'Health watcher is active; retry when it has finished.' }
    $initialApps = (& $Node $pm2Cli jlist | Out-String) | ConvertFrom-Json -AsHashtable
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect managed MCP.' }
    $initialMcp = @($initialApps | Where-Object name -eq 'openchatx-mcp')
    if ($initialMcp.Count -ne 1 -or $initialMcp[0].pm2_env.status -ne 'online') {
        throw 'Expected exactly one online managed MCP; preserve existing stopped state.'
    }
    $operations = Get-Content -LiteralPath (Join-Path $toolboxRoot 'operations.json') -Raw | ConvertFrom-Json
    if (@($operations.PSObject.Properties.Value | Where-Object state -eq 'running').Count -gt 0) {
        throw 'Runtime has running operations; wait without interrupting them.'
    }
    if (-not (Test-Path -LiteralPath $pausePath)) {
        [System.IO.File]::WriteAllText($pausePath, 'Temporary lean-runtime maintenance')
        $createdPause = $true
    }
    & $Node $pm2Cli stop openchatx-mcp | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop managed MCP.' }
    $stopped = $true
    # A legacy inspector may not have an operations.json entry. Never kill it.
    $legacyWorkers = @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'node.exe' -and $_.CommandLine -and
        $_.CommandLine.IndexOf((Join-Path $toolboxRoot 'tools\letta_worker.ts'), [StringComparison]::OrdinalIgnoreCase) -ge 0
    })
    if ($legacyWorkers.Count -gt 0) { throw 'A legacy worker is still active; retry after it exits.' }
    & $Node (Join-Path $PSScriptRoot 'update-runtime.mjs') apply
    if ($LASTEXITCODE -ne 0) { throw 'Runtime apply failed; inspect rollback/recovery output.' }
} finally {
    try {
        if ($stopped -and -not (Test-Path -LiteralPath (Join-Path $toolboxRoot '.runtime-update-pending.json'))) {
            & $Node $pm2Cli restart openchatx-mcp | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'MCP restart failed; health watcher remains paused.' }
            $apps = (& $Node $pm2Cli jlist | Out-String) | ConvertFrom-Json -AsHashtable
            $mcp = @($apps | Where-Object name -eq 'openchatx-mcp')
            if ($LASTEXITCODE -ne 0 -or $mcp.Count -ne 1 -or $mcp[0].pm2_env.status -ne 'online' -or $mcp[0].pid -le 0) {
                throw 'MCP restart not confirmed; health watcher remains paused.'
            }
            $restored = $true
            $apps | ForEach-Object { [pscustomobject]@{ name=$_.name; pid=$_.pid; status=$_.pm2_env.status } } | ConvertTo-Json
        }
        if ($createdPause -and (-not $stopped -or $restored)) { Remove-Item -LiteralPath $pausePath }
        if ($stopped -and -not $restored) { Write-Warning 'MCP remains stopped and watchdog paused until recovery completes.' }
    } finally {
        if ($ownsMutex) { $watchMutex.ReleaseMutex() }
        $watchMutex.Dispose()
        $env:PM2_HOME = $previousPm2Home
    }
}
