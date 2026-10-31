[CmdletBinding()]
param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$startup = Join-Path $root 'start-headless.ps1'
$logPath = Join-Path $root 'logs\health-watch.log'
$pauseMarker = Join-Path $root 'health-watch.paused'
. (Join-Path $root 'runtime-readiness.ps1')

function Test-McpReady {
    try {
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8001/healthz' -UseBasicParsing -TimeoutSec 3
        return ([int]$response.StatusCode -eq 200)
    } catch {
        return $false
    }
}

function Test-TunnelPresent {
    return (@(Get-Process -Name 'tunnel-client' -ErrorAction SilentlyContinue).Count -gt 0)
}

function Get-HeadlessDiskFreeBytes {
    $driveName = (Get-Item -LiteralPath $root).PSDrive.Name
    return [int64](Get-PSDrive -Name $driveName -PSProvider FileSystem -ErrorAction Stop).Free
}

function Write-WatchLog([string]$message) {
    $line = '{0} {1}' -f (Get-Date -Format o), $message
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

# Observability only. Letta is on-demand: a stopped server with no active
# operations is idle, not a reason to restart the MCP process.
function Get-AgentRuntimeSnapshot {
    $serviceFile = Join-Path $root 'toolboxes\agent-runtime\letta-service.json'
    $readiness = Get-NaosRuntimeReadiness -HeadlessRoot $root
    $letta = 'idle'
    if (Test-Path -LiteralPath $serviceFile -PathType Leaf) {
        try {
            $service = Get-Content -LiteralPath $serviceFile -Raw -Encoding UTF8 | ConvertFrom-Json
            $process = Get-Process -Id ([int]$service.pid) -ErrorAction SilentlyContinue
            if ($process) {
                $port = ([uri]$service.serverUrl).Port
                $listening = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
                    Where-Object { $_.OwningProcess -eq [int]$service.pid })
                $letta = if ($listening.Count -gt 0) { 'listening' } else { 'unreachable' }
            }
        } catch {
            $letta = 'unknown'
        }
    }
    return [pscustomobject]@{ letta = $letta; running = $readiness.running; stale = $readiness.stale; readiness = $readiness }
}

function Assert-ObservableRuntimeReady {
    param($Agent)
    if (-not $Agent.readiness.ready -or $Agent.letta -in @('unknown','unreachable')) {
        Write-Output ('DEGRADED: readiness={0} reason={1} letta={2}; no automatic restore or restart' -f
            $Agent.readiness.state, $Agent.readiness.reason, $Agent.letta)
        exit 2
    }
}

function Get-CorePatchSnapshot {
    $checker = Join-Path $root 'core-maintenance\Test-OpenChatXCorePatch.ps1'
    if (-not (Test-Path -LiteralPath $checker -PathType Leaf)) {
        return [pscustomobject]@{ ok = $false; detail = 'CORE_CHECKER_MISSING' }
    }
    try {
        $messages = @(& $checker 2>&1)
        $code = $LASTEXITCODE
        $summary = (@($messages) | ForEach-Object { [string]$_ } | Select-Object -First 3) -join '; '
        return [pscustomobject]@{
            ok = ($code -eq 0 -and $summary -match 'CORE_PATCH_VERIFIED')
            detail = $summary
        }
    }
    catch {
        return [pscustomobject]@{
            ok = $false
            detail = 'CORE_CHECK_FAILED: ' + $_.Exception.GetType().Name
        }
    }
}

function Get-HealthEvidence {
    $agent = Get-AgentRuntimeSnapshot
    $retention = Get-NaosAuditRetention -HeadlessRoot $root
    $core = Get-CorePatchSnapshot
    $diskFree = Get-HeadlessDiskFreeBytes
    $auditPath = Join-Path $root 'logs\agent-commands.yaml'
    $auditBytes = if (Test-Path -LiteralPath $auditPath -PathType Leaf) {
        (Get-Item -LiteralPath $auditPath).Length
    } else { 0 }
    return [pscustomobject]@{
        agent = $agent
        core = $core
        diskFree = $diskFree
        auditMB = [Math]::Round($auditBytes / 1MB, 1)
        retention = $retention
        text = ('letta={0} runningOperations={1} staleOperations={2} diskFreeGB={3:N1} auditLogMB={4:N1}' -f
            $agent.letta, $agent.running, $agent.stale, ($diskFree / 1GB), ($auditBytes / 1MB))
    }
}

if (Test-Path -LiteralPath $pauseMarker) {
    Write-Output 'PAUSED: marker present; no recovery attempted'
    exit 0
}

$mcpReady = Test-McpReady
$tunnelPresent = Test-TunnelPresent
$evidence = Get-HealthEvidence
Assert-ObservableRuntimeReady $evidence.agent
if (-not $evidence.core.ok) {
    Write-Output ('DEGRADED: CORE_PATCH_DRIFT; {0}; {1}; no automatic restore or restart' -f
        $evidence.core.detail, $evidence.text)
    exit 7
}
if ($mcpReady -and $tunnelPresent) {
    if ($evidence.diskFree -lt 2GB) {
        Write-Output ('DEGRADED: LOW_DISK; {0}; core MCP/tunnel responding; no restart' -f $evidence.text)
        exit 6
    }
    if ($evidence.agent.stale -gt 0 -or $evidence.agent.letta -eq 'unreachable') {
        Write-Output ('DEGRADED: agent runtime requires inspection; {0}; core MCP/tunnel responding; no restart' -f $evidence.text)
        exit 2
    }
    $logWarning = if ($evidence.auditMB -ge 64) { '; AUDIT_ROTATION_DUE' } else { '' }
    if ($evidence.retention.action -ne 'none') { $logWarning += '; AUDIT_RETENTION_REVIEW_DUE' }
    Write-Output ('HEALTHY: core MCP/tunnel; corePatch=verified; {0}{1}; Letta protocol and external MCPs not verified; no action' -f $evidence.text, $logWarning)
    exit 0
}

if ($CheckOnly) {
    Write-Output ('DEGRADED: mcp={0} tunnel={1}; {2}; read-only check' -f $mcpReady, $tunnelPresent, $evidence.text)
    exit 2
}

# Avoid competing recovery runs. The existing headless startup script is idempotent:
# it leaves healthy PM2-managed processes untouched and starts missing ones only.
$mutex = [System.Threading.Mutex]::new($false, 'Local\Naos.OpenChatX.HealthWatch')
$acquired = $false
try {
    $acquired = $mutex.WaitOne(0)
    if (-not $acquired) {
        Write-Output 'SKIPPED: another health-watch recovery is active'
        exit 0
    }

    Start-Sleep -Seconds 5
    $mcpReady = Test-McpReady
    $tunnelPresent = Test-TunnelPresent
    if (Test-Path -LiteralPath $pauseMarker) { Write-Output 'PAUSED: maintenance; no recovery attempted'; exit 0 }
    Assert-ObservableRuntimeReady (Get-AgentRuntimeSnapshot)
    if ($mcpReady -and $tunnelPresent) {
        Write-Output 'HEALTHY: core MCP/tunnel recovered; Letta and external MCPs not verified; no action'
        exit 0
    }

    # ENOSPC previously caused repeated PM2 restarts. A low-disk outage needs
    # storage remediation, not another identical startup attempt.
    $diskFreeBytes = Get-HeadlessDiskFreeBytes
    if ($diskFreeBytes -lt 2GB) {
        Write-WatchLog ('RECOVERY_SUPPRESSED reason=LOW_DISK freeBytes={0}' -f $diskFreeBytes)
        Write-Output ('DEGRADED: disk free {0} bytes; skipping restart to avoid ENOSPC loop' -f $diskFreeBytes)
        exit 6
    }

    Write-WatchLog ('RECOVERY_REQUESTED mcp={0} tunnel={1}' -f $mcpReady, $tunnelPresent)
    if (-not (Test-Path -LiteralPath $startup -PathType Leaf)) {
        Write-WatchLog 'ERROR missing existing headless startup script'
        exit 3
    }

    try {
        & $startup | Out-Null
    } catch {
        Write-WatchLog ('ERROR startup_exception={0}' -f $_.Exception.GetType().Name)
        exit 4
    }

    Start-Sleep -Seconds 3
    $mcpReady = Test-McpReady
    $tunnelPresent = Test-TunnelPresent
    Assert-ObservableRuntimeReady (Get-AgentRuntimeSnapshot)
    if ($mcpReady -and $tunnelPresent) {
        Write-WatchLog 'RECOVERED mcp=True tunnel=True'
        Write-Output 'RECOVERED: MCP and tunnel process healthy'
        exit 0
    }
    Write-WatchLog ('STILL_DEGRADED mcp={0} tunnel={1}' -f $mcpReady, $tunnelPresent)
    Write-Output 'DEGRADED: startup attempted without forcibly stopping processes'
    exit 5
} finally {
    if ($acquired) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
