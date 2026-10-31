# Naos Agent Stack v0.2.3 - ONE complete, self-contained Windows x64 installer.
# All optional binaries are bundled, but installed ONLY if selected by the user.
# This builder never downloads files or modifies a Windows installation.
[CmdletBinding()]
param(
    [string]$OutputPath='',
    [string]$CoreBundlePath='',
    [string]$PrerequisiteRoot='',
    [string]$TerminalAssetRoot='',
    [switch]$Force
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
if(-not $OutputPath){$OutputPath=Join-Path (Split-Path -Parent $root) 'Naos-Agent-Stack-v0.2.3-Complete-pre-release.zip'}
if(-not $CoreBundlePath){$CoreBundlePath=Join-Path $root 'payload\naos-headless-stack-bundle.zip'}
if(-not $PrerequisiteRoot){$PrerequisiteRoot=Join-Path $root 'payload\prerequisites'}
if(-not $TerminalAssetRoot){$TerminalAssetRoot=Join-Path $root 'payload\terminal'}

$dependencyLock=Get-Content -LiteralPath (Join-Path $root 'dependencies.lock.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$terminalLock=Get-Content -LiteralPath (Join-Path $root 'terminal.lock.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if($dependencyLock.schema -ne 1 -or $dependencyLock.packageVersion -ne '0.2.3' -or
   $terminalLock.schema -ne 1 -or $terminalLock.packageVersion -ne '0.2.3'){
    throw 'UNIFIED_RELEASE_LOCK_VERSION_MISMATCH'
}
$sourceFiles=@(
    'naos-agent-stack.ps1',
    'Engine.ps1',
    'Doctor.ps1',
    'Prerequisites.ps1',
    'Installer-Preflight.ps1',
    'Install-Wizard.ps1',
    'Terminal-Extras.ps1',
    'Terminal-Json-Validate.ps1',
    'Launch-NaosPowerShell.ps1',
    'ForwardWatchdog.ps1',
    'Build-Package.ps1',
    'README.md',
    'README.zh-TW.md',
    'README.Terminal.zh-TW.md',
    'INSTALL.zh-TW.md',
    'terminal.lock.json',
    'dependencies.lock.json',
    'third_party\PowerShell-LICENSE.txt',
    'third_party\OhMyPosh-COPYING.txt',
    'payload\bootstrap\naos-agent-stack.ps1'
)
# Do not follow a symlink/junction in a whitelisted release source or its
# parent directories: a linked README, license, or payload could expose a
# private file even though the ZIP entry name looks harmless.
function Assert-ReleaseSourceNotLinked([string]$SourcePath,[string]$Relative) {
    $cursor=[IO.Path]::GetFullPath($SourcePath)
    while($cursor){
        $node=Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
        if(($node.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){
            throw ('UNSAFE_RELEASE_SOURCE_REPARSE_POINT: '+$Relative)
        }
        $parent=Split-Path -Path $cursor -Parent
        if(-not $parent -or $parent -eq $cursor){break}
        $cursor=$parent
    }
}
$items=New-Object 'System.Collections.Generic.List[object]'
foreach($rel in $sourceFiles){
    $sourcePath=Join-Path $root $rel
    if(-not(Test-Path -LiteralPath $sourcePath -PathType Leaf)){throw ('SOURCE_MISSING: '+$rel)}
    Assert-ReleaseSourceNotLinked $sourcePath $rel
    [void]$items.Add([pscustomobject]@{Relative=$rel;Source=$sourcePath})
}
$assetFailures=New-Object 'System.Collections.Generic.List[string]'
function Add-VerifiedPayload([string]$Relative,[string]$SourcePath,[string]$Expected) {
    if(-not(Test-Path -LiteralPath $SourcePath -PathType Leaf)){
        [void]$assetFailures.Add('COMPLETE_PAYLOAD_MISSING: '+$Relative)
        return
    }
    if($Expected -notmatch '^[a-fA-F0-9]{64}$'){
        [void]$assetFailures.Add('COMPLETE_PAYLOAD_SHA256_LOCK_INVALID: '+$Relative)
        return
    }
    Assert-ReleaseSourceNotLinked $SourcePath $Relative
    $actual=(Get-FileHash -LiteralPath $SourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if($actual -ne $Expected.ToLowerInvariant()){
        [void]$assetFailures.Add('COMPLETE_PAYLOAD_SHA256_MISMATCH: '+$Relative)
        return
    }
    [void]$items.Add([pscustomobject]@{Relative=$Relative;Source=$SourcePath})
}
# The outer SHA lock proves byte identity, not suitability for public release.
# Inspect the nested Headless archive without extraction: a self-consistent
# manifest must never authorize user state, credentials, or unsafe paths.
function Assert-PublicCoreBundle([string]$SourcePath) {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive=[IO.Compression.ZipFile]::OpenRead($SourcePath)
    try {
        $entries=@{}
        foreach($entry in $archive.Entries){
            $name=$entry.FullName.Replace('\','/')
            if(-not $name -or $name.EndsWith('/') -or
               $name -match '(^/|(^|/)\.\.?(/|$)|//|:)' -or
               $entries.ContainsKey($name)){
                throw ('CORE_BUNDLE_UNSAFE_OR_DUPLICATE_PATH: '+$name)
            }
            if($name -ne 'manifest.json'){
                if(-not($name -cmatch '^(runtime|headless|toolboxes|letta-poc)/' -or
                         $name -cin @('naos-agent-stack.ps1','README.md'))){
                    throw ('CORE_BUNDLE_UNEXPECTED_PATH: '+$name)
                }
                if($name -match '(?i)(^|/)(\.env(?:\.[^/]*)?|\.npmrc|\.yarnrc(?:\.yml)?|\.pypirc|\.netrc|\.ssh|\.aws|\.git|\.letta|logs|secrets|credentials|tunnel-profiles|backups|sessions|memories|tokens)(/|$)|\.(pem|p12|pfx|key|log|db|sqlite|zst)$' -or
                   $name -match '(?i)^(runtime|headless|letta-poc)/(config|projects|state|storage|auth|profiles|cache|tmp|temp|artifacts|fixtures|user-data|userdata)/|^(?i:letta-poc/node_modules/)'){
                    throw ('CORE_BUNDLE_PRIVATE_PATH: '+$name)
                }
            }
            $entries[$name]=$entry
        }
        if(-not $entries.ContainsKey('manifest.json')){throw 'CORE_BUNDLE_MANIFEST_MISSING'}
        $manifestEntry=$entries['manifest.json']
        if($manifestEntry.Length -gt 4194304){throw 'CORE_BUNDLE_MANIFEST_TOO_LARGE'}
        $reader=[IO.StreamReader]::new($manifestEntry.Open())
        try{$manifest=$reader.ReadToEnd() | ConvertFrom-Json}finally{$reader.Dispose()}
        if($manifest.format -ne 2 -or $manifest.arch -ne 'AMD64' -or
           $manifest.version -ne '1.0.0-beta.2'){
            throw 'CORE_BUNDLE_MANIFEST_VERSION_OR_ARCH_MISMATCH'
        }
        # Match the bootstrap installer's RequiredBundleEntries contract.
        # A core archive with the correct SHA but missing startup/Letta helpers
        # must never become a publishable Complete ZIP.
        $required=@(
            'runtime/package.json','runtime/dist/index.js','runtime/bin/node.exe',
            'runtime/bin/tunnel-client.exe','headless/package.json',
            'headless/package-lock.json','headless/start-headless.ps1',
            'headless/stop-headless.ps1','headless/status-headless.ps1',
            'headless/Watch-OpenChatXHealth.ps1',
            'headless/runtime-readiness.ps1',
            'headless/audit-retention.mjs',
            'headless/audit-retention-policy.json',
            'headless/core-maintenance/verify-core.mjs',
            'headless/core-maintenance/Test-OpenChatXCorePatch.ps1',
            'headless/core-maintenance/manifest.json',
            'headless/core-maintenance/baseline/project-executor.js',
            'headless/core-maintenance/baseline/audit-log.js',
            'headless/core-maintenance/baseline/audit-format.js',
            'headless/core-maintenance/baseline/audit-request.js',
            'headless/core-maintenance/baseline/audit-response.js',
            'headless/core-maintenance/baseline/http-server.js',
            'headless/core-maintenance/baseline/tool-schema-presentation.js',

            'headless/core-maintenance/baseline/config.js',

            'headless/core-maintenance/baseline/summary-registry.js',

            'headless/core-maintenance/baseline/summarize-tool.js',
            'headless/tunnel-launcher.cjs','headless/tunnel-wrapper.ps1',
            'headless/import-persistent-environment.ps1',
            'headless/codebase-project-sync.mjs','headless/codebase-index/ecosystem.config.cjs',
            'headless/codebase-index/qa-review-bundle-source.mjs',
            'toolboxes/agent-runtime/toolbox.json','toolboxes/skills/toolbox.json',
            'toolboxes/agent-runtime/tools/agent_runtime.ts',
            'toolboxes/agent-runtime/tools/letta_worker.ts',
            'toolboxes/agent-runtime/tools/runtime_contract.ts',
            'toolboxes/agent-runtime/tools/model_routing.mjs',
            'toolboxes/agent-runtime/tools/tool_evidence.mjs',
            'toolboxes/agent-runtime/tools/agent_capabilities.ts',
            'toolboxes/agent-runtime/tools/runtime_maintenance.mjs',
            'toolboxes/agent-runtime/tools/runtime_readiness.mjs',
            'toolboxes/agent-runtime/tools/operation_reconciliation.mjs',
            'toolboxes/agent-runtime/README.md',
            'toolboxes/agent-runtime/rules/shared-development-preflight.mdc',
            'toolboxes/agent-runtime/rules/runtime-anti-loop-triage.mdc',
            'toolboxes/agent-runtime/skills/agent-runtime-usage/SKILL.md',
            'letta-poc/package.json','letta-poc/package-lock.json',
            'letta-poc/compact-poc.mjs','letta-poc/scripts/postinstall-patches.mjs',
            'naos-agent-stack.ps1','README.md'
        )
        # Built-in toolbox descriptors are required by the exported runtime.
        # Do not mistake inactive QA workflow modules for safe-to-delete static imports.
        foreach($name in @(
            'agent-runtime','files','goals','jobs','mcp-manager','media','nodes',
            'projects','providers','rules','search','shell','skills','store',
            'subagents','system','teams','toolbox-manager'
        )){
            $required+=('toolboxes/'+$name+'/toolbox.json')
        }
        $declared=@{}
        foreach($record in @($manifest.files)){
            $name=[string]$record.path
            if($name -eq 'manifest.json' -or $declared.ContainsKey($name) -or
               -not $entries.ContainsKey($name) -or
               [string]$record.sha256 -notmatch '^[a-fA-F0-9]{64}$'){
                throw ('CORE_BUNDLE_UNDECLARED_OR_INVALID_ENTRY: '+$name)
            }
            $declared[$name]=$true
        }
        foreach($name in $required){
            if(-not $declared.ContainsKey($name)){throw ('CORE_BUNDLE_REQUIRED_MISSING: '+$name)}
        }
        if($declared.Count -ne ($entries.Count-1)){throw 'CORE_BUNDLE_UNLISTED_ENTRY'}
        foreach($record in @($manifest.files)){
            $sha=[Security.Cryptography.SHA256]::Create()
            $stream=$entries[[string]$record.path].Open()
            try{$actual=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','')}
            finally{$stream.Dispose();$sha.Dispose()}
            if($actual -ne [string]$record.sha256){
                throw ('CORE_BUNDLE_ENTRY_SHA256_MISMATCH: '+$record.path)
            }
        }
    }finally{$archive.Dispose()}
}
Add-VerifiedPayload 'payload\naos-headless-stack-bundle.zip' $CoreBundlePath ([string]$dependencyLock.core.sha256)
foreach($pkg in @($dependencyLock.node,$dependencyLock.git)){
    $name=[string]$pkg.package
    if($name -notmatch '^[A-Za-z0-9._-]+\.zip$'){throw ('UNSAFE_DEPENDENCY_FILENAME: '+$name)}
    Add-VerifiedPayload ('payload\prerequisites\'+$name) (Join-Path $PrerequisiteRoot $name) ([string]$pkg.sha256)
}
foreach($pkg in @($terminalLock.pwsh,$terminalLock.posh,$terminalLock.themes,$terminalLock.nerdFont)){
    $name=[string]$pkg.file
    if($name -notmatch '^[A-Za-z0-9._-]+$'){throw ('UNSAFE_TERMINAL_ASSET_NAME: '+$name)}
    Add-VerifiedPayload ('payload\terminal\'+$name) (Join-Path $TerminalAssetRoot $name) ([string]$pkg.sha256)
}
# Report every absent, corrupted, or unpinned dependency in one pass,
# before creating any staging files or touching a previous candidate.
if($assetFailures.Count){
    foreach($failure in $assetFailures){Write-Output ('[BLOCKED] '+$failure)}
    throw ('COMPLETE_PAYLOAD_PREFLIGHT_FAILED: '+$assetFailures.Count+' dependency file(s) missing, altered, or unpinned.')
}
Assert-PublicCoreBundle $CoreBundlePath
$destination=[IO.Path]::GetFullPath($OutputPath)
$hadDestination=Test-Path -LiteralPath $destination
if($hadDestination -and -not $Force){throw ('RELEASE_ZIP_ALREADY_EXISTS: '+$destination)}
$parent=Split-Path -Parent $destination
if(-not(Test-Path -LiteralPath $parent)){New-Item -ItemType Directory -Path $parent -Force|Out-Null}
# Build beside the final output. A broken or interrupted build must not
# destroy the previous release candidate, including when -Force is used.
$stageId=[guid]::NewGuid().ToString('N')
$stagedZip=Join-Path $parent ('.'+[IO.Path]::GetFileName($destination)+'.'+$stageId+'.staging')
$backupZip=Join-Path $parent ('.'+[IO.Path]::GetFileName($destination)+'.'+$stageId+'.backup')
$hashFile=[IO.Path]::ChangeExtension($destination,'.sha256.txt')
$stagedHash=Join-Path $parent ('.'+[IO.Path]::GetFileName($hashFile)+'.'+$stageId+'.staging')
$backupHash=Join-Path $parent ('.'+[IO.Path]::GetFileName($hashFile)+'.'+$stageId+'.backup')
# Stream directly to ZIP. Upstream .zip/.exe/.tar.xz payloads are already
# compressed, so STORE them without wasting minutes recompressing the binaries.
# This also avoids a second ~300 MB extraction/staging copy.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$manifestFiles=New-Object 'System.Collections.Generic.List[object]'
foreach($item in $items){
    $relative=([string]$item.Relative).Replace('\','/')
    if($relative -match '(^/|(^|/)\.\.(/|$)|:)'){throw ('UNSAFE_RELEASE_PATH: '+$relative)}
    [void]$manifestFiles.Add([ordered]@{
        path=$relative
        bytes=(Get-Item -LiteralPath $item.Source).Length
        sha256=(Get-FileHash -LiteralPath $item.Source -Algorithm SHA256).Hash.ToLowerInvariant()
    })
}
$manifest=[ordered]@{
    format=1
    package='Naos Agent Stack'
    version='0.2.3'
    edition='Complete'
    selectionMode='interactive; Git, Terminal enhancements and sharing disabled by default'
    generatedUtc=[DateTime]::UtcNow.ToString('o')
    supportedWindowsArchitectures=@('AMD64')
    contents=@($manifestFiles.ToArray())
    excluded=@('SSH private keys','OAuth/API tokens','Git credentials','Letta Agent state','user files and projects')
    note='One installer ZIP contains all verified official dependencies; only selected components are installed. OpenChatX npm dependencies still require Internet.'
}
$manifestBytes=[Text.UTF8Encoding]::new($false).GetBytes(($manifest|ConvertTo-Json -Depth 10))
$canDiscardBackups=$false
try {
$zipStream=[IO.File]::Open($stagedZip,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try{
    $zip=[IO.Compression.ZipArchive]::new($zipStream,[IO.Compression.ZipArchiveMode]::Create,$false)
    try{
        foreach($item in $items){
            $relative=([string]$item.Relative).Replace('\','/')
            $store=($relative -match '(?i)\.(zip|exe|tar\.xz)$')
            $compression=if($store){[IO.Compression.CompressionLevel]::NoCompression}else{[IO.Compression.CompressionLevel]::Optimal}
            $entry=$zip.CreateEntry($relative,$compression)
            $from=[IO.File]::OpenRead([string]$item.Source)
            $to=$entry.Open()
            try{$from.CopyTo($to)}finally{$to.Dispose();$from.Dispose()}
        }
        $manifestEntry=$zip.CreateEntry('manifest.json',[IO.Compression.CompressionLevel]::Optimal)
        $stream=$manifestEntry.Open()
        try{$stream.Write($manifestBytes,0,$manifestBytes.Length)}finally{$stream.Dispose()}
    }finally{$zip.Dispose()}
}finally{$zipStream.Dispose()}
# Reopen the staged ZIP and verify its *stored contents*, not just source
# hashes. A source changing during streaming must never publish a bad ZIP.
$archive=[IO.Compression.ZipFile]::OpenRead($stagedZip)
try {
    if($archive.Entries.Count -ne ($manifestFiles.Count+1)){throw 'COMPLETE_RELEASE_ENTRY_COUNT_MISMATCH'}
    if(-not $archive.GetEntry('manifest.json')){throw 'COMPLETE_RELEASE_MANIFEST_MISSING'}
    foreach($record in $manifestFiles) {
        $entry=$archive.GetEntry([string]$record.path)
        if(-not $entry -or $entry.Length -ne [long]$record.bytes){
            throw ('COMPLETE_RELEASE_ENTRY_MISSING_OR_WRONG_SIZE: '+$record.path)
        }
        $sha=[Security.Cryptography.SHA256]::Create()
        $entryStream=$entry.Open()
        try {
            $actual=[BitConverter]::ToString($sha.ComputeHash($entryStream)).Replace('-','').ToLowerInvariant()
        }finally{$entryStream.Dispose();$sha.Dispose()}
        if($actual -ne [string]$record.sha256){
            throw ('COMPLETE_RELEASE_ENTRY_SHA256_MISMATCH: '+$record.path)
        }
    }
}finally{$archive.Dispose()}
$hash=(Get-FileHash -LiteralPath $stagedZip -Algorithm SHA256).Hash
[IO.File]::WriteAllText($stagedHash,($hash+'  '+[IO.Path]::GetFileName($destination)+[Environment]::NewLine),[Text.Encoding]::ASCII)
# Publish only after ZIP and checksum are complete. On a failed checksum
# publication, restore the prior ZIP; preserve backups if rollback fails.
$zipPublished=$false
$hashPublished=$false
$canDiscardBackups=$false
try {
    if($hadDestination){[IO.File]::Replace($stagedZip,$destination,$backupZip)}
    else{[IO.File]::Move($stagedZip,$destination)}
    $zipPublished=$true
    if(Test-Path -LiteralPath $hashFile){
        [IO.File]::Replace($stagedHash,$hashFile,$backupHash)
    }else{[IO.File]::Move($stagedHash,$hashFile)}
    $hashPublished=$true
    $canDiscardBackups=$true
}catch{
    $publicationError=$_.Exception.Message
    if($zipPublished -and -not $hashPublished) {
        try {
            if($hadDestination){[IO.File]::Copy($backupZip,$destination,$true)}
            else{[IO.File]::Delete($destination)}
            $canDiscardBackups=$true
        }catch{
            throw ('COMPLETE_RELEASE_ROLLBACK_FAILED: publish='+$publicationError+'; rollback='+$_.Exception.Message)
        }
    }
    throw
}
}finally{
    foreach($temporary in @($stagedZip,$stagedHash)){
        if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -Force}
    }
    if($canDiscardBackups){
        foreach($backup in @($backupZip,$backupHash)){
            if(Test-Path -LiteralPath $backup){Remove-Item -LiteralPath $backup -Force}
        }
    }
}
Write-Output ('COMPLETE_RELEASE_PACKAGE='+$destination)
Write-Output ('COMPLETE_RELEASE_BYTES='+(Get-Item $destination).Length)
Write-Output ('COMPLETE_RELEASE_SHA256='+$hash)
Write-Output ('COMPLETE_RELEASE_HASH_FILE='+$hashFile)
Write-Output 'All seven core/tool/terminal payloads are bundled; optional tools install only when selected. npm registry access is still required for first-time OpenChatX installation.'
