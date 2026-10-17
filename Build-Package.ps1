# Naos Agent Stack v0.2.2 - ONE complete, self-contained Windows x64 installer.
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
if(-not $OutputPath){$OutputPath=Join-Path (Split-Path -Parent $root) 'Naos-Agent-Stack-v0.2.2-Complete-pre-release.zip'}
if(-not $CoreBundlePath){$CoreBundlePath=Join-Path $root 'payload\naos-headless-stack-bundle.zip'}
if(-not $PrerequisiteRoot){$PrerequisiteRoot=Join-Path $root 'payload\prerequisites'}
if(-not $TerminalAssetRoot){$TerminalAssetRoot=Join-Path $root 'payload\terminal'}

$dependencyLock=Get-Content -LiteralPath (Join-Path $root 'dependencies.lock.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$terminalLock=Get-Content -LiteralPath (Join-Path $root 'terminal.lock.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if($dependencyLock.schema -ne 1 -or $dependencyLock.packageVersion -ne '0.2.2' -or
   $terminalLock.schema -ne 1 -or $terminalLock.packageVersion -ne '0.2.2'){
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
$items=New-Object 'System.Collections.Generic.List[object]'
foreach($rel in $sourceFiles){
    $sourcePath=Join-Path $root $rel
    if(-not(Test-Path -LiteralPath $sourcePath -PathType Leaf)){throw ('SOURCE_MISSING: '+$rel)}
    [void]$items.Add([pscustomobject]@{Relative=$rel;Source=$sourcePath})
}
function Add-VerifiedPayload([string]$Relative,[string]$SourcePath,[string]$Expected) {
    if(-not(Test-Path -LiteralPath $SourcePath -PathType Leaf)){throw ('COMPLETE_PAYLOAD_MISSING: '+$Relative)}
    $actual=(Get-FileHash -LiteralPath $SourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if($actual -ne $Expected.ToLowerInvariant()){throw ('COMPLETE_PAYLOAD_SHA256_MISMATCH: '+$Relative)}
    [void]$items.Add([pscustomobject]@{Relative=$Relative;Source=$SourcePath})
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
$destination=[IO.Path]::GetFullPath($OutputPath)
if(Test-Path -LiteralPath $destination){
    if(-not $Force){throw ('RELEASE_ZIP_ALREADY_EXISTS: '+$destination)}
    Remove-Item -LiteralPath $destination -Force -ErrorAction Stop
}
$parent=Split-Path -Parent $destination
if(-not(Test-Path -LiteralPath $parent)){New-Item -ItemType Directory -Path $parent -Force|Out-Null}
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
    version='0.2.2'
    edition='Complete'
    selectionMode='interactive; Git, Terminal enhancements and sharing disabled by default'
    generatedUtc=[DateTime]::UtcNow.ToString('o')
    supportedWindowsArchitectures=@('AMD64')
    contents=@($manifestFiles.ToArray())
    excluded=@('SSH private keys','OAuth/API tokens','Git credentials','Letta Agent state','user files and projects')
    note='One installer ZIP contains all verified official dependencies; only selected components are installed. OpenChatX npm dependencies still require Internet.'
}
$manifestBytes=[Text.UTF8Encoding]::new($false).GetBytes(($manifest|ConvertTo-Json -Depth 10))
$zipStream=[IO.File]::Open($destination,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
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
if(-not(Test-Path -LiteralPath $destination -PathType Leaf)){throw 'COMPLETE_RELEASE_BUILD_FAILED'}
$hash=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
$hashFile=[IO.Path]::ChangeExtension($destination,'.sha256.txt')
[IO.File]::WriteAllText($hashFile,($hash+'  '+[IO.Path]::GetFileName($destination)+[Environment]::NewLine),[Text.Encoding]::ASCII)
Write-Output ('COMPLETE_RELEASE_PACKAGE='+$destination)
Write-Output ('COMPLETE_RELEASE_BYTES='+(Get-Item $destination).Length)
Write-Output ('COMPLETE_RELEASE_SHA256='+$hash)
Write-Output ('COMPLETE_RELEASE_HASH_FILE='+$hashFile)
Write-Output 'All seven core/tool/terminal payloads are bundled; optional tools install only when selected. npm registry access is still required for first-time OpenChatX installation.'
