$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pm2 = Join-Path $root "node_modules\.bin\pm2.cmd"
$env:PM2_HOME = Join-Path $root "pm2"

if (Test-Path $pm2) {
    & $pm2 status
}

try {
    $mcp = Invoke-RestMethod -Uri "http://127.0.0.1:8001/healthz" -TimeoutSec 3
    Write-Output ("MCP health: " + ($mcp | ConvertTo-Json -Compress))
}
catch {
    Write-Output ("MCP health: DOWN - " + $_.Exception.Message)
}

try {
    $tunnel = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8080/readyz" -TimeoutSec 3
    Write-Output ("Tunnel ready: HTTP " + [int]$tunnel.StatusCode)
}
catch {
    Write-Output ("Tunnel ready: DOWN - " + $_.Exception.Message)
}

$readinessAdapter = Join-Path $root 'runtime-readiness.ps1'
if (-not (Test-Path -LiteralPath $readinessAdapter -PathType Leaf)) {
    Write-Output 'Runtime readiness: DEGRADED - READINESS_HELPER_MISSING'
    exit 2
}
. $readinessAdapter
$readiness = Get-NaosRuntimeReadiness -HeadlessRoot $root
Write-Output ('Runtime readiness: ' + ($readiness | ConvertTo-Json -Compress -Depth 4))
Write-Output ('Audit retention: ' + ((Get-NaosAuditRetention -HeadlessRoot $root) | ConvertTo-Json -Compress -Depth 4))
if (-not $readiness.ready) { exit 2 }
