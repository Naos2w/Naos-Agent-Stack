# Shared, read-only adapter for Windows PowerShell 5.1 and PowerShell 7.
function Get-NaosRuntimeReadiness {
    param(
        [Parameter(Mandatory=$true)][string]$HeadlessRoot,
        [string]$Node = (Join-Path $env:LOCALAPPDATA 'Programs\OpenChatX\runtime\bin\node.exe')
    )
    $toolbox = Join-Path $HeadlessRoot 'toolboxes\agent-runtime'
    $helper = Join-Path $toolbox 'tools\runtime_readiness.mjs'
    try {
        if (-not (Test-Path -LiteralPath $Node -PathType Leaf) -or
            -not (Test-Path -LiteralPath $helper -PathType Leaf)) { throw 'READINESS_HELPER_MISSING' }
        $output = @(& $Node $helper $toolbox 2>$null)
        $code = $LASTEXITCODE
        $snapshot = ($output -join "`n") | ConvertFrom-Json -ErrorAction Stop
        if ($snapshot.schema -ne 1 -or $snapshot.ready -isnot [bool] -or
            ($snapshot.ready -and $code -ne 0) -or (-not $snapshot.ready -and $code -ne 2)) {
            throw 'READINESS_PROTOCOL_INVALID'
        }
        return $snapshot
    } catch {
        return [pscustomobject]@{ schema=1; ready=$false; state='unknown'; reason='READINESS_PROBE_FAILED'; running=-1; stale=-1; unresolved=-1 }
    }
}

function Get-NaosAuditRetention {
    param([Parameter(Mandatory=$true)][string]$HeadlessRoot,
        [string]$Node=(Join-Path $env:LOCALAPPDATA 'Programs\OpenChatX\runtime\bin\node.exe'))
    try {
        $output=@(& $Node (Join-Path $HeadlessRoot 'audit-retention.mjs') 2>$null)
        if($LASTEXITCODE -ne 0){throw 'RETENTION_PROBE_FAILED'}
        $report=($output -join "`n") | ConvertFrom-Json -ErrorAction Stop
        if($report.schema -ne 1 -or $report.mode -ne 'report_only'){throw 'RETENTION_PROTOCOL_INVALID'}
        return $report
    } catch {
        return [pscustomobject]@{schema=1;mode='report_only';action='inspect_retention_probe';overQuota=$false;archiveBytes=$null;archiveCount=$null;coldArchiveCount=$null;automaticDeletionAllowed=$false}
    }
}
