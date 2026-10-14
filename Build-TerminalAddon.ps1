# Reproducible offline optional terminal add-on ZIP.
# No installer execution, font registration, or Terminal settings changes.
[CmdletBinding()]
param(
    [string]$AssetRoot='',
    [string]$OutputPath='',
    [switch]$Force
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
if(-not $AssetRoot){$AssetRoot=Join-Path $root 'payload\terminal'}
if(-not $OutputPath){$OutputPath=Join-Path (Split-Path -Parent $root) 'Naos-Agent-Stack-v0.2.1-TerminalAddon.zip'}
$lock=Get-Content -LiteralPath (Join-Path $root 'terminal.lock.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($lock.schema -ne 1 -or $lock.packageVersion -ne '0.2.1' -or $lock.architecture -ne 'windows-x64'){
    throw 'TERMINAL_DEPENDENCY_LOCK_INVALID'
}
$assetDefinitions=@($lock.pwsh,$lock.posh,$lock.themes,$lock.nerdFont)
$dest=[IO.Path]::GetFullPath($OutputPath)
if(Test-Path -LiteralPath $dest) {
    if(-not $Force){throw 'ADDON_ARCHIVE_ALREADY_EXISTS'}
    Remove-Item -LiteralPath $dest -Force
}
$parent=Split-Path -Parent $dest
if(-not(Test-Path $parent)){New-Item -ItemType Directory -Path $parent -Force|Out-Null}
$stage=Join-Path $env:TEMP ('naos-terminal-addon-build-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage -Force|Out-Null
try {
    $items=New-Object 'System.Collections.Generic.List[object]'
    $sources=@(
        @('terminal.lock.json',(Join-Path $root 'terminal.lock.json')),
        @('README.Terminal.zh-TW.md',(Join-Path $root 'README.Terminal.zh-TW.md')),
        @('third_party\OhMyPosh-COPYING.txt',(Join-Path $root 'third_party\OhMyPosh-COPYING.txt')),
        @('third_party\PowerShell-LICENSE.txt',(Join-Path $root 'third_party\PowerShell-LICENSE.txt'))
    )
    foreach($def in $assetDefinitions){
        if([string]$def.file -notmatch '^[A-Za-z0-9._-]+$'){throw 'BAD_ASSET_NAME'}
        $input=Join-Path $AssetRoot ([string]$def.file)
        if(-not(Test-Path -LiteralPath $input -PathType Leaf)){throw ('TERMINAL_ASSET_MISSING '+$def.file)}
        $sha=(Get-FileHash -LiteralPath $input -Algorithm SHA256).Hash.ToLowerInvariant()
        if($sha -ne ([string]$def.sha256).ToLowerInvariant()){throw ('TERMINAL_ASSET_HASH_MISMATCH '+$def.file)}
        $relative='payload\terminal\'+[string]$def.file
        $sources+= ,@($relative,$input)
    }
    foreach($source in $sources){
        $rel=[string]$source[0]
        $src=[string]$source[1]
        if(-not(Test-Path -LiteralPath $src -PathType Leaf)){throw ('ADDON_SOURCE_MISSING '+$rel)}
        $file=Join-Path $stage $rel
        $dir=Split-Path -Parent $file
        if(-not(Test-Path -LiteralPath $dir)){New-Item -ItemType Directory -Path $dir -Force|Out-Null}
        Copy-Item -LiteralPath $src -Destination $file -ErrorAction Stop
        $hash=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
        [void]$items.Add([ordered]@{path=$rel.Replace('\','/');bytes=(Get-Item $file).Length;sha256=$hash})
    }
    $manifest=[ordered]@{
        schema=1
        title='Naos Agent Stack Optional Terminal Add-on'
        version='0.2.1'
        platform='windows-x64'
        defaultNF='JetBrainsMono NFM'
        optional=$true
        createdUtc=[DateTime]::UtcNow.ToString('o')
        files=@($items.ToArray())
    }
    [IO.File]::WriteAllText((Join-Path $stage 'terminal-addon-manifest.json'),($manifest|ConvertTo-Json -Depth 7),[Text.UTF8Encoding]::new($false))
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $dest -CompressionLevel Optimal -ErrorAction Stop
}finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
if(-not(Test-Path $dest)){throw 'ADDON_ZIP_BUILD_FAILED'}
$hash=(Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
$hashFile=[IO.Path]::ChangeExtension($dest,'.sha256.txt')
[IO.File]::WriteAllText($hashFile,($hash+'  '+[IO.Path]::GetFileName($dest)+[Environment]::NewLine),[Text.Encoding]::ASCII)
Write-Output ('TERMINAL_ADDON_PACKAGE='+$dest)
Write-Output ('TERMINAL_ADDON_BYTES='+(Get-Item $dest).Length)
Write-Output ('TERMINAL_ADDON_SHA256='+$hash)
Write-Output ('TERMINAL_ADDON_SHA256_FILE='+$hashFile)
