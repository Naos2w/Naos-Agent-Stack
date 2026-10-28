[CmdletBinding()]
param(
    [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA 'Programs\OpenChatX\runtime'),
    [string]$ManifestPath = (Join-Path $PSScriptRoot 'manifest.json'),
    [string]$SnapshotRoot = (Join-Path $PSScriptRoot 'baseline')
)

$ErrorActionPreference = 'Stop'
# Keep the source of truth in verify-core.mjs and use the Node bundled with
# OpenChatX. Health Watch does not spawn an extra PowerShell instance.
$node = Join-Path $env:LOCALAPPDATA 'Programs\OpenChatX\runtime\bin\node.exe'
$verifier = Join-Path $PSScriptRoot 'verify-core.mjs'
if (-not (Test-Path -LiteralPath $node -PathType Leaf) -or
    -not (Test-Path -LiteralPath $verifier -PathType Leaf)) {
    Write-Output 'CORE_PATCH_CHECK_FAILED: verifier runtime missing'
    exit 7
}
& $node $verifier --runtime-root $RuntimeRoot --manifest $ManifestPath --snapshot-root $SnapshotRoot
exit $LASTEXITCODE
