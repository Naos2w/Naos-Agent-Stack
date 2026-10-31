# Naos Agent Stack v0.2.3: read-only, selection-aware preflight.
# Guarantees selected core / Node / Git files are present and SHA256-valid BEFORE
# the user types INSTALL. Optional terminal files are checked by Terminal-Extras.ps1.
# Dot-sourcing this module does not access any files or modify the machine.
Set-StrictMode -Version Latest

# Check the complete target directories, not just package.json/start-headless.ps1.
# Bootstrap refuses to overwrite any existing target; detect that BEFORE
# prerequisite installation so a failed fresh install changes nothing.
function Assert-NaosFreshInstallTargets {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$RuntimeRoot,
        [Parameter(Mandatory=$true)][string]$HeadlessRoot,
        [Parameter(Mandatory=$true)][string]$LettaRoot
    )
    $targets=@(
        [pscustomobject]@{Name='Runtime';Path=$RuntimeRoot},
        [pscustomobject]@{Name='Headless';Path=$HeadlessRoot},
        [pscustomobject]@{Name='Letta';Path=$LettaRoot}
    )
    # Reject custom install roots that overlap before creating any directory.
    # Otherwise copying one component can clobber another (or create a false
    # "existing install" after the first component is written).
    for($i=0;$i -lt $targets.Count;$i++){
        $left=[IO.Path]::GetFullPath($targets[$i].Path).TrimEnd('\')
        for($j=$i+1;$j -lt $targets.Count;$j++){
            $right=[IO.Path]::GetFullPath($targets[$j].Path).TrimEnd('\')
            if($left.Equals($right,[StringComparison]::OrdinalIgnoreCase) -or
               $left.StartsWith($right+'\',[StringComparison]::OrdinalIgnoreCase) -or
               $right.StartsWith($left+'\',[StringComparison]::OrdinalIgnoreCase)){
                throw ('INSTALL_PREFLIGHT_TARGET_OVERLAP: '+$targets[$i].Name+' / '+$targets[$j].Name)
            }
        }
    }
    foreach($target in $targets){
        # A missing leaf under an existing junction/symlink still writes outside
        # the selected path. Reject linked ancestors before changing anything.
        $cursor=[IO.Path]::GetFullPath($target.Path)
        while($cursor){
            if(Test-Path -LiteralPath $cursor){
                $node=Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
                if(($node.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){
                    throw ('INSTALL_PREFLIGHT_TARGET_LINKED_ANCESTOR: '+$target.Name+' ('+$cursor+')')
                }
            }
            $parent=Split-Path -Path $cursor -Parent
            if(-not $parent -or $parent -eq $cursor){break}
            $cursor=$parent
        }
        if(Test-Path -LiteralPath $target.Path){
            throw ('INSTALL_PREFLIGHT_TARGET_EXISTS: '+$target.Name+' ('+$target.Path+'). Existing/partial installation; do not overwrite. Repair or migrate explicitly.')
        }
    }
    Write-Output '[PASS] FRESH_INSTALL_TARGETS_EMPTY'
}

# An existing pair of sentinel files does not prove a complete installation.
# The installer must never claim to have skipped a healthy core if an earlier
# attempt stopped before Letta, PM2, or Codebase Memory was installed. This is
# read-only: existing installations require an explicit repair/upgrade plan.
function Assert-NaosExistingCoreComplete {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$RuntimeRoot,
        [Parameter(Mandatory=$true)][string]$HeadlessRoot,
        [Parameter(Mandatory=$true)][string]$LettaRoot
    )
    $required=@(
        [pscustomobject]@{Label='Runtime package';Path=(Join-Path $RuntimeRoot 'package.json')},
        [pscustomobject]@{Label='Runtime entry';Path=(Join-Path $RuntimeRoot 'dist\index.js')},
        [pscustomobject]@{Label='Runtime Node';Path=(Join-Path $RuntimeRoot 'bin\node.exe')},
        [pscustomobject]@{Label='Headless entry';Path=(Join-Path $HeadlessRoot 'start-headless.ps1')},
        [pscustomobject]@{Label='Headless PM2';Path=(Join-Path $HeadlessRoot 'node_modules\.bin\pm2.cmd')},
        [pscustomobject]@{Label='Agent Runtime';Path=(Join-Path $HeadlessRoot 'toolboxes\agent-runtime\tools\agent_runtime.ts')},
        [pscustomobject]@{Label='Codebase sync';Path=(Join-Path $HeadlessRoot 'codebase-project-sync.mjs')},
        [pscustomobject]@{Label='Letta package';Path=(Join-Path $LettaRoot 'package.json')},
        [pscustomobject]@{Label='Letta dependencies';Path=(Join-Path $LettaRoot 'node_modules\node\bin\node.exe')}
    )
    foreach($item in $required){
        if(-not(Test-Path -LiteralPath $item.Path -PathType Leaf)){
            throw ('INSTALL_PREFLIGHT_EXISTING_CORE_INCOMPLETE: '+$item.Label+' missing. Existing/partial installation is protected; do not overwrite. Repair or upgrade explicitly.')
        }
    }
    Write-Output '[PASS] EXISTING_CORE_MINIMUM_FILES_PRESENT_NO_UPGRADE'
}

# Run the bootstrap's canonical nested-manifest and per-file SHA256 verifier
# before installing Node/npm or changing any Windows installation target.
# This does not depend on existing Headless/Letta state or require network access.
function Assert-NaosCoreBundleStructure {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$BootstrapPath,
        [Parameter(Mandatory=$true)][string]$BundlePath
    )
    if(-not(Test-Path -LiteralPath $BootstrapPath -PathType Leaf)){
        throw 'INSTALL_PREFLIGHT_BOOTSTRAP_MISSING'
    }
    if(-not(Test-Path -LiteralPath $BundlePath -PathType Leaf)){
        throw 'INSTALL_PREFLIGHT_CORE_MISSING'
    }
    # Capture the bootstrap's expected negative-test stderr without printing
    # a stack trace; emit a single actionable error with its verifier reason.
    $previousPreference=$ErrorActionPreference
    $ErrorActionPreference='Continue'
    try {
        $output=@(& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $BootstrapPath -Mode verify -BundlePath $BundlePath 2>&1 |
            ForEach-Object {$_.ToString()})
        $code=$LASTEXITCODE
    }finally{$ErrorActionPreference=$previousPreference}
    if($code -ne 0){
        $reason=@($output | Where-Object {$_ -match '^\[Naos Headless\]'})
        $detail=if($reason.Count){[string]$reason[0]}else{'Core manifest or file SHA256 is invalid.'}
        throw ('INSTALL_PREFLIGHT_CORE_STRUCTURE_INVALID: '+$detail+' No prerequisites installed.')
    }
    Write-Output '[PASS] CORE_BUNDLE_STRUCTURE_VERIFIED_BEFORE_INSTALL'
}

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
        throw 'INSTALL_PREFLIGHT_MISSING: dependencies.lock.json. Re-download the single v0.2.3 Complete installer ZIP; do not use the GitHub Source code ZIP.'
    }
    $lock=Get-Content -LiteralPath $lockFile -Raw -Encoding UTF8|ConvertFrom-Json
    if($lock.schema -ne 1 -or $lock.packageVersion -ne '0.2.3'){
        throw 'INSTALL_PREFLIGHT_VERSION_MISMATCH: the package must be v0.2.3 Complete.'
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
            throw ('INSTALL_PREFLIGHT_MISSING: '+$relative.Replace('\','/')+'. This selected component is absent. Re-download the single v0.2.3 Complete ZIP; no separate add-on is needed.')
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
