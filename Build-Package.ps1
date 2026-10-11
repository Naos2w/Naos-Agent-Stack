# Naos Agent Stack v0.2 PowerShell-only package builder. No EXE or installer execution.
[CmdletBinding()]
param(
  [string]$OutputPath='',
  [switch]$Force
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
if(-not $OutputPath) {
    $OutputPath=Join-Path (Split-Path -Parent $root) 'Naos-Agent-Stack-v0.2.0-PS.zip'
}
$files=@(
    'naos-agent-stack.ps1',
    'Engine.ps1',
    'Doctor.ps1',
    'ForwardWatchdog.ps1',
    'Build-Package.ps1',
    'README.zh-TW.md',
    'payload\bootstrap\naos-agent-stack.ps1',
    'payload\naos-headless-stack-bundle.zip'
)
$items=New-Object System.Collections.Generic.List[object]
foreach($rel in $files){
    $path=Join-Path $root $rel
    if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw ('Missing required file: '+$rel)}
    if($rel -match '(?i)(\.ssh|\.env|state\.json|credentials|private_key|token|oauth)'){throw ('Sensitive path not allowed: '+$rel)}
    $sha=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    [void]$items.Add([ordered]@{path=$rel.Replace('\','/');bytes=(Get-Item -LiteralPath $path).Length;sha256=$sha})
}
$manifest=[ordered]@{
    format=1
    package='Naos Agent Stack'
    version='0.2.0'
    type='PowerShell script-first setup'
    generatedUtc=[DateTime]::UtcNow.ToString('o')
    contents=@($items.ToArray())
    excludes=@('private SSH keys','OAuth tokens','OpenChatX/Letta Agent state','Git credentials','tunnel profiles','personal project files')
}
$jsonPath=Join-Path $root 'manifest.json'
[IO.File]::WriteAllText($jsonPath,($manifest|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
$destination=[IO.Path]::GetFullPath($OutputPath)
if(Test-Path -LiteralPath $destination){
    if(-not $Force){throw ('Output already exists: '+$destination)}
    Remove-Item -LiteralPath $destination -Force
}
# Only package the explicit files. No user credentials, state or unrelated files.
$stage=Join-Path $env:TEMP ('naos-agent-stack-package-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage -Force | Out-Null
try{
    foreach($rel in $files+@('manifest.json')){
        $src=Join-Path $root $rel
        $dest=Join-Path $stage $rel
        $parent=Split-Path -Parent $dest
        if(-not(Test-Path -LiteralPath $parent)){New-Item -ItemType Directory -Path $parent -Force|Out-Null}
        Copy-Item -LiteralPath $src -Destination $dest -ErrorAction Stop
    }
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $destination -CompressionLevel Optimal -ErrorAction Stop
} finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
if(-not(Test-Path -LiteralPath $destination)){throw 'ZIP build failed'}
Write-Output ('PACKAGE='+$destination)
Write-Output ('PACKAGE_BYTES='+(Get-Item -LiteralPath $destination).Length)
$hash=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
Write-Output ('PACKAGE_SHA256='+$hash)
$hashFile=[IO.Path]::ChangeExtension($destination,'.sha256.txt')
[IO.File]::WriteAllText($hashFile,($hash+'  '+[IO.Path]::GetFileName($destination)+[Environment]::NewLine),[Text.Encoding]::ASCII)
Write-Output ('SHA256_FILE='+$hashFile)
Write-Output 'Only PowerShell scripts, README and verified Headless payload were packaged. No EXE.'
