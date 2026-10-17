# Naos Agent Stack v0.2.2: read-only, selection-aware preflight.
# Guarantees selected core / Node / Git files are present and SHA256-valid BEFORE
# the user types INSTALL. Optional terminal files are checked by Terminal-Extras.ps1.
# Dot-sourcing this module does not access any files or modify the machine.
Set-StrictMode -Version Latest

function Assert-NaosSelectedPayload {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$PackageRoot,
        [switch]$RequireCore,
        [switch]$RequireNode,
        [switch]$RequireGit
    )
    $lockFile=Join-Path $PackageRoot 'dependencies.lock.json'
    if(-not(Test-Path -LiteralPath $lockFile -PathType Leaf)){
        throw 'INSTALL_PREFLIGHT_MISSING: dependencies.lock.json. Re-download the single v0.2.2 Complete installer ZIP; do not use the GitHub Source code ZIP.'
    }
    $lock=Get-Content -LiteralPath $lockFile -Raw -Encoding UTF8|ConvertFrom-Json
    if($lock.schema -ne 1 -or $lock.packageVersion -ne '0.2.2'){
        throw 'INSTALL_PREFLIGHT_VERSION_MISMATCH: the package must be v0.2.2 Complete.'
    }
    $items=New-Object 'System.Collections.Generic.List[object]'
    if($RequireCore){
        $items.Add([pscustomobject]@{Path='payload\naos-headless-stack-bundle.zip';Sha=[string]$lock.core.sha256})
        $bootstrap=Join-Path $PackageRoot 'payload\bootstrap\naos-agent-stack.ps1'
        if(-not(Test-Path -LiteralPath $bootstrap -PathType Leaf)){
            throw 'INSTALL_PREFLIGHT_MISSING: payload/bootstrap/naos-agent-stack.ps1. Re-download the Complete installer ZIP.'
        }
    }
    if($RequireNode){
        $items.Add([pscustomobject]@{Path=('payload\prerequisites\'+[string]$lock.node.package);Sha=[string]$lock.node.sha256})
    }
    if($RequireGit){
        $items.Add([pscustomobject]@{Path=('payload\prerequisites\'+[string]$lock.git.package);Sha=[string]$lock.git.sha256})
    }
    foreach($entry in $items){
        $relative=[string]$entry.Path
        if($relative -match '(^|[\\/])\.\.([\\/]|$)|:'){throw 'INSTALL_PREFLIGHT_UNSAFE_PAYLOAD_PATH'}
        $absolute=Join-Path $PackageRoot $relative
        if(-not(Test-Path -LiteralPath $absolute -PathType Leaf)){
            throw ('INSTALL_PREFLIGHT_MISSING: '+$relative.Replace('\','/')+'. This selected component is absent. Re-download the single v0.2.2 Complete ZIP; no separate add-on is needed.')
        }
        if(-not([string]$entry.Sha -match '^[a-fA-F0-9]{64}$')){throw 'INSTALL_PREFLIGHT_SHA256_LOCK_INVALID'}
        if($relative -like '*.zip' -and (Get-Command Assert-NaosTrustedArchive -ErrorAction SilentlyContinue)){
            Assert-NaosTrustedArchive $absolute ([string]$entry.Sha)
        }else{
            if((Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash -ne [string]$entry.Sha){
                throw ('INSTALL_PREFLIGHT_SHA256_MISMATCH: '+$relative.Replace('\','/'))
            }
        }
        Write-Output ('[PASS] Verified selected installer component: '+$relative.Replace('\','/'))
    }
    Write-Output '[PASS] SELECTED_PAYLOAD_PREFLIGHT_OK'
}
