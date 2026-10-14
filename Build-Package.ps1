# Naos Agent Stack v0.2.1: reproducible source + signed-upstream-hash offline tools release.
# No downloading or installation occurs during build.
[CmdletBinding()]
param(
    [string]$OutputPath='',
    [string]$CoreBundlePath='',
    [string]$PrerequisiteRoot='',
    [ValidateSet('Standard','Developer')][string]$Edition='Standard',
    [switch]$Force
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
if(-not $OutputPath){$OutputPath=Join-Path (Split-Path -Parent $root) ('Naos-Agent-Stack-v0.2.1-'+$Edition+'-pre-release.zip')}
if(-not $CoreBundlePath){$CoreBundlePath=Join-Path $root 'payload\naos-headless-stack-bundle.zip'}
if(-not $PrerequisiteRoot){$PrerequisiteRoot=Join-Path $root 'payload\prerequisites'}

$lockPath=Join-Path $root 'dependencies.lock.json'
if(-not(Test-Path -LiteralPath $lockPath)){throw 'DEPS_LOCK_MISSING'}
$lock=Get-Content $lockPath -Raw -Encoding UTF8 | ConvertFrom-Json
if($lock.schema -ne 1 -or $lock.packageVersion -ne '0.2.1'){throw 'DEPENDENCY_LOCK_VERSION_MISMATCH'}

$sourceFiles=@(
    'naos-agent-stack.ps1',
    'Engine.ps1',
    'Doctor.ps1',
    'Prerequisites.ps1',
    'Install-Wizard.ps1',
    'Terminal-Extras.ps1',
    'Terminal-Json-Validate.ps1',
    'Launch-NaosPowerShell.ps1',
    'ForwardWatchdog.ps1',
    'Build-Package.ps1',
    'README.md',
    'README.zh-TW.md',
    'README.Terminal.zh-TW.md',
    'terminal.lock.json',
    'dependencies.lock.json',
    'payload\bootstrap\naos-agent-stack.ps1'
)
$items=New-Object System.Collections.Generic.List[object]
foreach($rel in $sourceFiles){
    $src=Join-Path $root $rel
    if(-not(Test-Path -LiteralPath $src -PathType Leaf)){throw ('SOURCE_MISSING: '+$rel)}
    [void]$items.Add([pscustomobject]@{ Relative=$rel; Source=$src })
}
if(-not(Test-Path -LiteralPath $CoreBundlePath -PathType Leaf)){
    throw 'CORE_BUNDLE_MISSING: supply -CoreBundlePath or obtain the known-good Headless core ZIP.'
}
$coreSha=(Get-FileHash -LiteralPath $CoreBundlePath -Algorithm SHA256).Hash.ToLowerInvariant()
if($coreSha -ne ([string]$lock.core.sha256).ToLowerInvariant()){
    throw 'CORE_BUNDLE_HASH_MISMATCH: source archive is not the previously verified core payload.'
}
[void]$items.Add([pscustomobject]@{
    Relative='payload\naos-headless-stack-bundle.zip'; Source=$CoreBundlePath
})
$prerequisites=if($Edition -eq 'Developer'){@($lock.node,$lock.git)}else{@($lock.node)}
foreach($pkg in $prerequisites){
    $name=[string]$pkg.package
    if($name -notmatch '^[A-Za-z0-9_.-]+[.]zip$'){throw 'UNSAFE_DEPENDENCY_FILENAME'}
    $path=Join-Path $PrerequisiteRoot $name
    if(-not(Test-Path -LiteralPath $path -PathType Leaf)){
        throw ('VERIFIED_DEPENDENCY_MISSING: '+$name+'. Supply -PrerequisiteRoot.')
    }
    $hash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if($hash -ne ([string]$pkg.sha256).ToLowerInvariant()){
        throw ('DEPENDENCY_SHA256_MISMATCH: '+$name)
    }
    [void]$items.Add([pscustomobject]@{Relative=('payload\prerequisites\'+$name);Source=$path})
}
$destination=[IO.Path]::GetFullPath($OutputPath)
if(Test-Path -LiteralPath $destination){
    if(-not $Force){throw ('RELEASE_ZIP_ALREADY_EXISTS: '+$destination)}
    Remove-Item -LiteralPath $destination -Force
}
$parent=Split-Path -Parent $destination
if(-not(Test-Path -LiteralPath $parent)){New-Item -ItemType Directory -Path $parent -Force|Out-Null}
$stage=Join-Path $env:TEMP ('naos-release-build-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage -Force|Out-Null
try{
    $manifestFiles=New-Object System.Collections.Generic.List[object]
    foreach($item in $items){
        $relative=([string]$item.Relative).Replace('\','/')
        if($relative -match '(^/|(^|/)\.\.(/|$)|:)'){throw ('UNSAFE_RELEASE_PATH: '+$relative)}
        $src=[string]$item.Source
        $out=Join-Path $stage $item.Relative
        $dir=Split-Path -Parent $out
        if(-not(Test-Path -LiteralPath $dir)){New-Item -ItemType Directory -Path $dir -Force|Out-Null}
        Copy-Item -LiteralPath $src -Destination $out -ErrorAction Stop
        $sha=(Get-FileHash -LiteralPath $out -Algorithm SHA256).Hash.ToLowerInvariant()
        [void]$manifestFiles.Add([ordered]@{
            path=$relative
            bytes=(Get-Item -LiteralPath $out).Length
            sha256=$sha
        })
    }
    $manifest=[ordered]@{
        format=1
        package='Naos Agent Stack'
        version='0.2.1'
        edition=$Edition
        type='PowerShell-first setup, verified offline Node/npm; Git only in Developer edition; Terminal add-on separate'
        generatedUtc=[DateTime]::UtcNow.ToString('o')
        supportedWindowsArchitectures=@('AMD64')
        contents=@($manifestFiles.ToArray())
        excluded=@('private SSH keys','OAuth and API tokens','Git credentials','Letta Agents and Sessions','project registry and machine state')
        note='npm ci and npm install -g need online package registry. Terminal add-on is distributed separately. Not fully offline.'
    }
    [IO.File]::WriteAllText((Join-Path $stage 'manifest.json'),
        ($manifest|ConvertTo-Json -Depth 9),[Text.UTF8Encoding]::new($false))
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $destination -CompressionLevel Optimal -ErrorAction Stop
}finally{
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
if(-not(Test-Path -LiteralPath $destination)){throw 'ZIP_BUILD_FAILED'}
$finalHash=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
$shaFile=[IO.Path]::ChangeExtension($destination,'.sha256.txt')
[IO.File]::WriteAllText($shaFile,
    ($finalHash+'  '+[IO.Path]::GetFileName($destination)+[Environment]::NewLine),
    [Text.Encoding]::ASCII)
Write-Output ('RELEASE_PACKAGE='+$destination)
Write-Output ('RELEASE_BYTES='+(Get-Item -LiteralPath $destination).Length)
Write-Output ('RELEASE_SHA256='+$finalHash)
Write-Output ('RELEASE_HASH_FILE='+$shaFile)
Write-Output ('Release Edition='+$Edition+' includes verified Node/npm; Developer adds optional MinGit. Terminal add-on is separate.')
Write-Output 'Core npm registry access may still be required for first installation.'
