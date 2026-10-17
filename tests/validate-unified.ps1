# Read-only tests: one Complete v0.2.2 ZIP, selected tools checked before INSTALL.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'Prerequisites.ps1')
. (Join-Path $root 'Installer-Preflight.ps1')
$dep=Get-Content (Join-Path $root 'dependencies.lock.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$terminal=Get-Content (Join-Path $root 'terminal.lock.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if($dep.packageVersion -ne '0.2.2' -or $terminal.packageVersion -ne '0.2.2'){throw 'UNIFIED_RELEASE_VERSION_INVALID'}
if($dep.git.sha256 -notmatch '^[a-f0-9]{64}$'){throw 'VERIFIED_MINGIT_PIN_MISSING'}
if(@($terminal.pwsh,$terminal.posh,$terminal.themes,$terminal.nerdFont).Count -ne 4){throw 'REQUIRED_TERMINAL_METADATA_MISSING'}
Write-Output '[PASS] Complete installer lock pins Node, MinGit and four terminal files'

$builder=Get-Content (Join-Path $root 'Build-Package.ps1') -Raw -Encoding UTF8
foreach($required in @('edition=''Complete''','dependencyLock.git','terminalLock.pwsh','terminalLock.posh','terminalLock.themes','terminalLock.nerdFont',"version='0.2.2'")) {
    if(-not $builder.Contains($required)){throw ('UNIFIED_BUILDER_REQUIRED_COMPONENT_MISSING: '+$required)}
}
if($builder -match "ValidateSet\('Standard','Developer'\)"){throw 'LEGACY_SPLIT_EDITIONS_STILL_ENABLED'}
Write-Output '[PASS] Single ZIP builder always contains all seven official payloads'

# The source repository intentionally has no large binary files; selected items
# must fail preflight before there can be any change to machine configuration.
foreach($scenario in @(
    [pscustomobject]@{Label='Core';Flags=@{RequireCore=$true};Path='payload/naos-headless-stack-bundle.zip'},
    [pscustomobject]@{Label='Node/npm';Flags=@{RequireNode=$true};Path='payload/prerequisites/node-v22.23.3-win-x64.zip'},
    [pscustomobject]@{Label='Optional Git';Flags=@{RequireGit=$true};Path='payload/prerequisites/MinGit-2.56.0.2-64-bit.zip'}
)){
    $blocked=$false
    try{
        $selectedFlags=$scenario.Flags
        $null=Assert-NaosSelectedPayload -PackageRoot $root @selectedFlags
    }catch{
        if($_.Exception.Message -match 'INSTALL_PREFLIGHT_MISSING'){$blocked=$true}
        else{throw}
    }
    if(-not $blocked){throw ('SELECTED_MISSING_COMPONENT_ALLOWED: '+$scenario.Label)}
    Write-Output ('[PASS] Early preflight rejects missing '+$scenario.Label+' before install')
}

# With no optional modules selected, dependency list is empty and the test does
# not require any offline binary to be checked or installed.
$none=@(Assert-NaosSelectedPayload -PackageRoot $root)
if(-not ($none -match 'SELECTED_PAYLOAD_PREFLIGHT_OK')){throw 'UNSELECTED_ARCHIVES_NOT_SKIPPED'}
Write-Output '[PASS] Unselected optional tools do not block installation'

$entry=Get-Content (Join-Path $root 'naos-agent-stack.ps1') -Raw -Encoding UTF8
if($entry -match 'requires optional Terminal add-on'){throw 'LEGACY_SEPARATE_ADDON_HELP_TEXT'}
$pre=$entry.IndexOf("Mode='Preflight'",[StringComparison]::Ordinal)
$confirmation=$entry.IndexOf('Type INSTALL to apply the selected options',[StringComparison]::Ordinal)
if($pre -lt 0 -or $confirmation -lt 0 -or $pre -gt $confirmation){
    throw 'INSTALLER_MUST_PREFLIGHT_BEFORE_INSTALL_CONFIRMATION'
}
Write-Output '[PASS] Interactive install validates selected dependencies before INSTALL prompt'
Write-Output 'UNIFIED_SOURCE_VALIDATION_PASSED'
exit 0
