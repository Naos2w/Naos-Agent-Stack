# Read-only tests: one Complete v0.2.3 ZIP, selected tools checked before INSTALL.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'Prerequisites.ps1')
. (Join-Path $root 'Installer-Preflight.ps1')
$dep=Get-Content (Join-Path $root 'dependencies.lock.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$terminal=Get-Content (Join-Path $root 'terminal.lock.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if($dep.packageVersion -ne '0.2.3' -or $terminal.packageVersion -ne '0.2.3'){throw 'UNIFIED_RELEASE_VERSION_INVALID'}
if($dep.git.sha256 -notmatch '^[a-f0-9]{64}$'){throw 'VERIFIED_MINGIT_PIN_MISSING'}
if(@($terminal.pwsh,$terminal.posh,$terminal.themes,$terminal.nerdFont).Count -ne 4){throw 'REQUIRED_TERMINAL_METADATA_MISSING'}
Write-Output '[PASS] Complete installer lock pins Node, MinGit and four terminal files'

# Isolated fresh-install target checks; never probe or modify live runtime paths.
$targetFixture=Join-Path ([IO.Path]::GetTempPath()) ('naos-target-preflight-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $targetFixture -Force|Out-Null
try {
    $targetPaths=@{
        RuntimeRoot=(Join-Path $targetFixture 'runtime')
        HeadlessRoot=(Join-Path $targetFixture 'headless')
        LettaRoot=(Join-Path $targetFixture 'letta')
    }
    $ok=@(Assert-NaosFreshInstallTargets @targetPaths)
    if(-not ($ok -match 'FRESH_INSTALL_TARGETS_EMPTY')){throw 'FRESH_INSTALL_EMPTY_TARGETS_REJECTED'}
    # User-supplied Letta paths must not alias either core location. Test
    # equality, nesting in both directions, and a harmless sibling prefix.
    $overlaps=@(
        @{RuntimeRoot=$targetPaths.RuntimeRoot;HeadlessRoot=$targetPaths.HeadlessRoot;LettaRoot=$targetPaths.RuntimeRoot.ToUpperInvariant()},
        @{RuntimeRoot=$targetPaths.RuntimeRoot;HeadlessRoot=$targetPaths.HeadlessRoot;LettaRoot=(Join-Path $targetPaths.HeadlessRoot 'letta')},
        @{RuntimeRoot=$targetPaths.RuntimeRoot;HeadlessRoot=(Join-Path $targetPaths.RuntimeRoot 'headless');LettaRoot=$targetPaths.LettaRoot},
        @{RuntimeRoot=$targetPaths.RuntimeRoot;HeadlessRoot=$targetPaths.HeadlessRoot;LettaRoot=(Split-Path -Parent $targetPaths.RuntimeRoot)}
    )
    foreach($paths in $overlaps){
        $blocked=$false
        try{$null=Assert-NaosFreshInstallTargets @paths}
        catch{if($_.Exception.Message -match 'INSTALL_PREFLIGHT_TARGET_OVERLAP'){$blocked=$true}else{throw}}
        if(-not $blocked){throw 'FRESH_INSTALL_OVERLAPPING_TARGETS_ALLOWED'}
    }
    $sibling=@{RuntimeRoot=$targetPaths.RuntimeRoot;HeadlessRoot=$targetPaths.HeadlessRoot;LettaRoot=$targetPaths.RuntimeRoot+'-letta'}
    $ok=@(Assert-NaosFreshInstallTargets @sibling)
    if(-not($ok -match 'FRESH_INSTALL_TARGETS_EMPTY')){throw 'FRESH_INSTALL_DISTINCT_SIBLING_REJECTED'}
    Write-Output '[PASS] Overlapping install roots rejected; distinct sibling paths allowed'
    foreach($component in @('RuntimeRoot','HeadlessRoot','LettaRoot')){
        $existing=$targetPaths[$component]
        New-Item -ItemType Directory -Path $existing|Out-Null
        try {
            $blocked=$false
            try{$null=Assert-NaosFreshInstallTargets @targetPaths}
            catch{if($_.Exception.Message -match 'INSTALL_PREFLIGHT_TARGET_EXISTS'){$blocked=$true}else{throw}}
            if(-not $blocked){throw ('FRESH_INSTALL_EXISTING_TARGET_ALLOWED: '+$component)}
        }finally{Remove-Item -LiteralPath $existing -Recurse -Force}
    }
    # The target leaf can be absent while a parent is a junction that points
    # somewhere else. This must be rejected before extracting any payload.
    $realParent=Join-Path $targetFixture 'real-parent'
    $linkedParent=Join-Path $targetFixture 'linked-parent'
    New-Item -ItemType Directory -Path $realParent|Out-Null
    New-Item -ItemType Junction -Path $linkedParent -Target $realParent|Out-Null
    try {
        $linkedTargets=@{RuntimeRoot=$targetPaths.RuntimeRoot;HeadlessRoot=$targetPaths.HeadlessRoot;LettaRoot=(Join-Path $linkedParent 'letta')}
        $blocked=$false
        try{$null=Assert-NaosFreshInstallTargets @linkedTargets}
        catch{if($_.Exception.Message -match 'INSTALL_PREFLIGHT_TARGET_LINKED_ANCESTOR'){$blocked=$true}else{throw}}
        if(-not $blocked){throw 'FRESH_INSTALL_LINKED_ANCESTOR_ALLOWED'}
        if(Test-Path -LiteralPath (Join-Path $realParent 'letta')){throw 'FRESH_INSTALL_LINK_TEST_MODIFIED_TARGET'}
    }finally{Remove-Item -LiteralPath $linkedParent -Force}
    Write-Output '[PASS] Fresh-install preflight rejects junction ancestors without touching destination'

    # Two existing entrypoint files can conceal a failed earlier installation.
    # Reject it before any Git/Node/Terminal installation, and do not repair
    # the fixture implicitly. Only an explicitly complete fixture may be kept.
    $existingRuntime=Join-Path $targetFixture 'existing-runtime'
    $existingHeadless=Join-Path $targetFixture 'existing-headless'
    $existingLetta=Join-Path $targetFixture 'existing-letta'
    $existingFiles=@(
        [pscustomobject]@{Base=$existingRuntime;Relative='package.json'},
        [pscustomobject]@{Base=$existingHeadless;Relative='start-headless.ps1'},
        [pscustomobject]@{Base=$existingRuntime;Relative='dist\index.js'},
        [pscustomobject]@{Base=$existingRuntime;Relative='bin\node.exe'},
        [pscustomobject]@{Base=$existingHeadless;Relative='node_modules\.bin\pm2.cmd'},
        [pscustomobject]@{Base=$existingHeadless;Relative='toolboxes\agent-runtime\tools\agent_runtime.ts'},
        [pscustomobject]@{Base=$existingHeadless;Relative='codebase-project-sync.mjs'},
        [pscustomobject]@{Base=$existingLetta;Relative='package.json'},
        [pscustomobject]@{Base=$existingLetta;Relative='node_modules\node\bin\node.exe'}
    )
    foreach($f in @($existingFiles[0],$existingFiles[1])){
        $p=Join-Path $f.Base $f.Relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $p) -Force|Out-Null
        [IO.File]::WriteAllText($p,'SYNTHETIC_ONLY')
    }
    $existingArgs=@{RuntimeRoot=$existingRuntime;HeadlessRoot=$existingHeadless;LettaRoot=$existingLetta}
    $blocked=$false
    try{$null=Assert-NaosExistingCoreComplete @existingArgs}
    catch{if($_.Exception.Message -match 'INSTALL_PREFLIGHT_EXISTING_CORE_INCOMPLETE'){$blocked=$true}else{throw}}
    if(-not $blocked){throw 'EXISTING_CORE_SENTINELS_ONLY_WRONGLY_ACCEPTED'}
    foreach($f in $existingFiles[2..($existingFiles.Count-1)]){
        $p=Join-Path $f.Base $f.Relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $p) -Force|Out-Null
        [IO.File]::WriteAllText($p,'SYNTHETIC_ONLY')
    }
    $ok=@(Assert-NaosExistingCoreComplete @existingArgs)
    if(-not ($ok -match 'EXISTING_CORE_MINIMUM_FILES_PRESENT_NO_UPGRADE')){throw 'EXISTING_CORE_COMPLETE_FIXTURE_REJECTED'}
    Write-Output '[PASS] Existing partial core cannot masquerade as healthy; complete core is preserved without upgrade'
}finally{Remove-Item -LiteralPath $targetFixture -Recurse -Force}
$engineSource=Get-Content -LiteralPath (Join-Path $root 'Engine.ps1') -Raw -Encoding UTF8
$preflightStart=$engineSource.IndexOf("if(`$Mode -eq 'Preflight' -or `$Mode -eq 'Apply')",[StringComparison]::Ordinal)
$guardPosition=$engineSource.IndexOf('Assert-NaosFreshInstallTargets -RuntimeRoot $runtimeRoot -HeadlessRoot $headlessRoot -LettaRoot $letRoot',$preflightStart,[StringComparison]::Ordinal)
$payloadPosition=$engineSource.IndexOf('Assert-NaosSelectedPayload',$preflightStart,[StringComparison]::Ordinal)
if($preflightStart -lt 0 -or $guardPosition -lt $preflightStart -or $payloadPosition -lt $guardPosition){
    throw 'FRESH_INSTALL_TARGET_CHECK_MUST_PRECEDE_PAYLOAD_AND_PREREQUISITES'
}
Write-Output '[PASS] Existing/partial install targets rejected before prerequisite changes'

# The outer ZIP checksum alone cannot validate the nested Headless manifest.
# Exercise the actual read-only bootstrap verifier in an isolated fixture:
# a self-consistent v2 archive passes, but one whose inner hash is wrong
# fails *before* Node, Git, npm or other installation operations run.
$verifiedSource=$engineSource.IndexOf('Assert-NaosCoreBundleStructure -BootstrapPath $installerScript -BundlePath $bundle',$payloadPosition,[StringComparison]::Ordinal)
if($verifiedSource -lt $payloadPosition -or $verifiedSource -gt $engineSource.IndexOf("if(`$Mode -eq 'Preflight'){",$payloadPosition,[StringComparison]::Ordinal)){
    throw 'CORE_STRUCTURE_VERIFICATION_MUST_PRECEDE_PREREQUISITE_INSTALL'
}
$coreFixture=Join-Path ([IO.Path]::GetTempPath()) ('naos-core-preflight-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $coreFixture 'payload\bootstrap') -Force | Out-Null
try {
    $fixtureBootstrap=Join-Path $coreFixture 'payload\bootstrap\naos-agent-stack.ps1'
    Copy-Item -LiteralPath (Join-Path $root 'payload\bootstrap\naos-agent-stack.ps1') -Destination $fixtureBootstrap
    $fixtureCore=Join-Path $coreFixture 'payload\naos-headless-stack-bundle.zip'
    $source=[IO.File]::ReadAllText($fixtureBootstrap)
    $contract=[regex]::Match($source,'(?s)function RequiredBundleEntries\s*\{\s*@\((.*?)\r?\n\s*\)')
    if(-not $contract.Success){throw 'CORE_VERIFIER_REQUIRED_LIST_UNAVAILABLE'}
    $requiredFiles=@([regex]::Matches($contract.Groups[1].Value,"'([^']+)'") |
        ForEach-Object {[string]$_.Groups[1].Value})
    if($requiredFiles.Count -lt 20){throw 'CORE_VERIFIER_REQUIRED_LIST_INCOMPLETE'}
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    foreach($corrupt in @($false,$true)){
        $rows=New-Object 'System.Collections.Generic.List[object]'
        $zip=[IO.Compression.ZipFile]::Open($fixtureCore,[IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach($path in $requiredFiles){
                $bytes=[Text.UTF8Encoding]::new($false).GetBytes('SYNTHETIC_ONLY:'+ $path)
                $entry=$zip.CreateEntry($path)
                $stream=$entry.Open()
                try {$stream.Write($bytes,0,$bytes.Length)} finally {$stream.Dispose()}
                $hash=[Security.Cryptography.SHA256]::Create()
                try {$digest=[BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()}
                finally {$hash.Dispose()}
                if($corrupt -and $path -eq 'runtime/package.json'){$digest=('0'*64)}
                [void]$rows.Add([ordered]@{path=$path;sha256=$digest})
            }
            $manifest=[ordered]@{format=2;arch='AMD64';version='1.0.0-beta.2';files=@($rows.ToArray())}
            $json=[Text.UTF8Encoding]::new($false).GetBytes(($manifest|ConvertTo-Json -Depth 6))
            $entry=$zip.CreateEntry('manifest.json')
            $stream=$entry.Open()
            try {$stream.Write($json,0,$json.Length)} finally {$stream.Dispose()}
        }finally{$zip.Dispose()}
        $fixtureLock=Get-Content -LiteralPath (Join-Path $root 'dependencies.lock.json') -Raw -Encoding UTF8|ConvertFrom-Json
        $fixtureLock.core.sha256=(Get-FileHash -LiteralPath $fixtureCore -Algorithm SHA256).Hash.ToLowerInvariant()
        [IO.File]::WriteAllText((Join-Path $coreFixture 'dependencies.lock.json'),
            ($fixtureLock|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
        $outer=@(Assert-NaosSelectedPayload -PackageRoot $coreFixture -RequireCore)
        if(-not($outer -match 'SELECTED_PAYLOAD_PREFLIGHT_OK')){throw 'CORE_FIXTURE_OUTER_HASH_REJECTED'}
        if($corrupt){
            $blocked=$false
            try {$null=Assert-NaosCoreBundleStructure -BootstrapPath $fixtureBootstrap -BundlePath $fixtureCore}
            catch {if($_.Exception.Message -match 'INSTALL_PREFLIGHT_CORE_STRUCTURE_INVALID'){$blocked=$true}else{throw}}
            if(-not $blocked){throw 'CORE_BAD_INNER_HASH_ACCEPTED_BY_READONLY_PREFLIGHT'}
            Write-Output '[PASS] Correct outer SHA cannot hide wrong nested file SHA; no prerequisites touched'
        }else{
            $verified=@(Assert-NaosCoreBundleStructure -BootstrapPath $fixtureBootstrap -BundlePath $fixtureCore)
            if(-not($verified -match 'CORE_BUNDLE_STRUCTURE_VERIFIED_BEFORE_INSTALL')){throw 'CORE_VALID_BUNDLE_PREFLIGHT_FAILED'}
            Write-Output '[PASS] Valid synthetic core passes bootstrap verification without install'
            # Direct bootstrap entrypoint must enforce the same non-overlap
            # invariant; this is a negative DryRun with synthetic-only input.
            $badLetta=Join-Path $env:LOCALAPPDATA 'Programs\OpenChatX\runtime\letta'
            $priorPreference=$ErrorActionPreference
            $ErrorActionPreference='Continue'
            try {
                $result=@(& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $fixtureBootstrap -Mode install -BundlePath $fixtureCore -LettaRoot $badLetta -DryRun 2>&1 |
                    ForEach-Object {$_.ToString()})
                $code=$LASTEXITCODE
            } finally {$ErrorActionPreference=$priorPreference}
            if($code -eq 0 -or ($result -join ' ') -notmatch 'Install targets overlap:'){
                throw 'DIRECT_BOOTSTRAP_OVERLAPPING_TARGETS_ALLOWED'
            }
            Write-Output '[PASS] Direct bootstrap rejects overlapping Letta/runtime roots before install'
            # Exercise the direct entrypoint with a missing Letta leaf under a
            # junction, not just the unified Engine preflight.
            $realParent=Join-Path $coreFixture 'real-parent'
            $linkedParent=Join-Path $coreFixture 'linked-parent'
            New-Item -ItemType Directory -Path $realParent|Out-Null
            New-Item -ItemType Junction -Path $linkedParent -Target $realParent|Out-Null
            try {
                $linkedLetta=Join-Path $linkedParent 'letta'
                $priorPreference=$ErrorActionPreference
                $ErrorActionPreference='Continue'
                try {
                    $result=@(& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $fixtureBootstrap -Mode install -BundlePath $fixtureCore -LettaRoot $linkedLetta -DryRun 2>&1 |
                        ForEach-Object {$_.ToString()})
                    $code=$LASTEXITCODE
                } finally {$ErrorActionPreference=$priorPreference}
                if($code -eq 0 -or ($result -join ' ') -notmatch 'Install target linked ancestor refused:'){
                    throw 'DIRECT_BOOTSTRAP_LINKED_ANCESTOR_ALLOWED'
                }
                if(Test-Path -LiteralPath (Join-Path $realParent 'letta')){throw 'DIRECT_BOOTSTRAP_LINK_TEST_MODIFIED_TARGET'}
            } finally {Remove-Item -LiteralPath $linkedParent -Force}
            Write-Output '[PASS] Direct bootstrap rejects junction ancestors without touching destination'
        }
        Remove-Item -LiteralPath $fixtureCore -Force
    }
}finally {
    if(Test-Path -LiteralPath $coreFixture){Remove-Item -LiteralPath $coreFixture -Recurse -Force}
}

$builder=Get-Content (Join-Path $root 'Build-Package.ps1') -Raw -Encoding UTF8
foreach($required in @('edition=''Complete''','dependencyLock.git','terminalLock.pwsh','terminalLock.posh','terminalLock.themes','terminalLock.nerdFont',"version='0.2.3'")) {
    if(-not $builder.Contains($required)){throw ('UNIFIED_BUILDER_REQUIRED_COMPONENT_MISSING: '+$required)}
}
if($builder -match "ValidateSet\('Standard','Developer'\)"){throw 'LEGACY_SPLIT_EDITIONS_STILL_ENABLED'}
Write-Output '[PASS] Single ZIP builder always contains all seven official payloads'

# Missing-asset negatives must run in a disposable fixture: official release
# binaries may now be present in payload, while source-only CI has none.
$missingFixture=Join-Path ([IO.Path]::GetTempPath()) ('naos-missing-payload-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $missingFixture -Force|Out-Null
try {
    Copy-Item -LiteralPath (Join-Path $root 'dependencies.lock.json') -Destination $missingFixture
    $bootstrapDir=Join-Path $missingFixture 'payload\bootstrap'
    New-Item -ItemType Directory -Path $bootstrapDir -Force|Out-Null
    Copy-Item -LiteralPath (Join-Path $root 'payload\bootstrap\naos-agent-stack.ps1') -Destination $bootstrapDir
    foreach($scenario in @(
        [pscustomobject]@{Label='Core';Flags=@{RequireCore=$true}},
        [pscustomobject]@{Label='Node/npm';Flags=@{RequireNode=$true}},
        [pscustomobject]@{Label='Optional Git';Flags=@{RequireGit=$true}}
    )){
        $blocked=$false
        try{
            $selectedFlags=$scenario.Flags
            $null=Assert-NaosSelectedPayload -PackageRoot $missingFixture @selectedFlags
        }catch{
            if($_.Exception.Message -match 'INSTALL_PREFLIGHT_MISSING'){$blocked=$true}
            else{throw}
        }
        if(-not $blocked){throw ('SELECTED_MISSING_COMPONENT_ALLOWED: '+$scenario.Label)}
        Write-Output ('[PASS] Early preflight rejects missing '+$scenario.Label+' before install')
    }

    # With no optional components selected, no binary needs to be installed.
    $none=@(Assert-NaosSelectedPayload -PackageRoot $missingFixture)
    if(-not ($none -match 'SELECTED_PAYLOAD_PREFLIGHT_OK')){throw 'UNSELECTED_ARCHIVES_NOT_SKIPPED'}
    Write-Output '[PASS] Unselected optional tools do not block installation'
}finally{
    if(Test-Path -LiteralPath $missingFixture){Remove-Item -LiteralPath $missingFixture -Recurse -Force}
}

$entry=Get-Content (Join-Path $root 'naos-agent-stack.ps1') -Raw -Encoding UTF8
if($entry -match 'requires optional Terminal add-on'){throw 'LEGACY_SEPARATE_ADDON_HELP_TEXT'}
$pre=$entry.IndexOf("Mode='Preflight'",[StringComparison]::Ordinal)
$confirmation=$entry.IndexOf('Type INSTALL to apply the selected options',[StringComparison]::Ordinal)
if($pre -lt 0 -or $confirmation -lt 0 -or $pre -gt $confirmation){
    throw 'INSTALLER_MUST_PREFLIGHT_BEFORE_INSTALL_CONFIRMATION'
}
Write-Output '[PASS] Interactive install validates selected dependencies before INSTALL prompt'

# Keep release instructions in sync with the actual package version. A candidate
# must never be advertised as downloadable before its release assets exist.
foreach($doc in @('README.md','README.zh-TW.md','README.Terminal.zh-TW.md','INSTALL.zh-TW.md')){
    $text=Get-Content -LiteralPath (Join-Path $root $doc) -Raw -Encoding UTF8
    if(-not $text.Contains('v0.2.3')){throw ('V023_DOC_VERSION_MISSING: '+$doc)}
    if($text.Contains('Naos-Agent-Stack-v0.2.2-Complete-pre-release.zip')){
        throw ('V023_DOC_STALE_PACKAGE_FILENAME: '+$doc)
    }
}
$english=Get-Content -LiteralPath (Join-Path $root 'README.md') -Raw -Encoding UTF8
$chinese=Get-Content -LiteralPath (Join-Path $root 'INSTALL.zh-TW.md') -Raw -Encoding UTF8
# This test script may be parsed as ANSI on Windows PowerShell 5.1; construct
# the Chinese release-status phrase from Unicode code points instead of a literal.
$unpublishedWarning=-join @([char]0x5c1a,[char]0x7121,[char]0x516c,[char]0x958b,[char]0x9644,[char]0x4ef6)
if(-not $english.Contains('v0.2.3 has not been published') -or
   -not $chinese.Contains(('v0.2.3 '+$unpublishedWarning))){
    throw 'V023_DOC_UNPUBLISHED_WARNING_MISSING'
}
Write-Output '[PASS] v0.2.3 documentation uses the matching package filename and discloses unpublished status'
Write-Output 'UNIFIED_SOURCE_VALIDATION_PASSED'
exit 0
