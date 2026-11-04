# Use the Naos2w GitHub credential for this repository, independent of the globally active `gh` account.
# From PowerShell: & .\runtime\Invoke-Naos2wGh.ps1 -GhArgs @('pr','view','9')
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string[]]$GhArgs)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$expectedOrigin = '^(?:https://github\.com/|git@github\.com:)Naos2w/Naos-Agent-Stack(?:\.git)?$'
$origin = (& git -C $root remote get-url origin)
if ($LASTEXITCODE -ne 0 -or -not $origin -or $origin.Trim() -cnotmatch $expectedOrigin) {
    throw 'GH_REPOSITORY_OWNER_MISMATCH: expected Naos2w/Naos-Agent-Stack'
}
if ($GhArgs.Count -eq 0) { throw 'GH_ARGUMENTS_REQUIRED' }
$saved = @{}
foreach ($name in @('GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN')) {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$token = $null
try {
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
    $token = (& gh auth token --hostname github.com --user Naos2w)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($token)) { throw 'GH_NAOS2W_CREDENTIAL_UNAVAILABLE' }
    $env:GH_TOKEN = $token.Trim()
    $actual = (& gh api user --jq .login)
    if ($LASTEXITCODE -ne 0 -or $actual.Trim() -cne 'Naos2w') { throw 'GH_AUTHENTICATED_IDENTITY_MISMATCH' }
    & gh @GhArgs
    if ($LASTEXITCODE -ne 0) { throw ('GH_COMMAND_EXIT_' + $LASTEXITCODE) }
} finally {
    $token = $null
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}
