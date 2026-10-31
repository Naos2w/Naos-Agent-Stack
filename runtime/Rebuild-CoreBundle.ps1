# Rebuild a pinned compiled overlay without reading the installed runtime.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$BaseBundlePath,
    [Parameter(Mandatory=$true)][string]$OutputPath,
    [switch]$Force
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repo=Split-Path -Parent $PSScriptRoot
$lock=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'rebuild.lock.json') -Raw | ConvertFrom-Json
if($lock.schema -ne 1){throw 'REBUILD_LOCK_SCHEMA_INVALID'}
$base=[IO.Path]::GetFullPath($BaseBundlePath)
$target=[IO.Path]::GetFullPath($OutputPath)
if($base -eq $target){throw 'REBUILD_MUST_PRESERVE_BASE'}
if((Get-FileHash -LiteralPath $base -Algorithm SHA256).Hash -ne $lock.baseSha256){throw 'REBUILD_BASE_HASH_MISMATCH'}
# Reuse the existing archive safety, portability and transactional publisher.
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $repo 'payload\bootstrap\naos-agent-stack.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'REBUILD_BOOTSTRAP_PARSE_FAILED'}
foreach($name in @('Fail','Require','EnsureDir','ReadJson','GetPortableBundleText','AddBundleZipEntry','RequiredBundleEntries','VerifyBundle','PublishCoreExport')){
    $definition=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true))
    if($definition.Count -ne 1){throw ('REBUILD_HELPER_MISSING: '+$name)}
    Invoke-Expression $definition[0].Extent.Text
}
$overlays=@{}
foreach($entry in $lock.overlays){
    if($entry.source -match '(^[\\/]|\.\.|:)' -or $entry.target -match '(^[\\/]|\.\.|:)' -or $overlays.ContainsKey($entry.target)) {throw 'REBUILD_OVERLAY_PATH_INVALID'}
    $source=Join-Path $repo $entry.source
    $cursor=[IO.Path]::GetFullPath($source)
    while($cursor){
        if((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'REBUILD_LINKED_SOURCE'}
        $parent=Split-Path -Parent $cursor
        if(-not $parent -or $parent -eq $cursor){break};$cursor=$parent
    }
    if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $entry.sha256){throw ('REBUILD_OVERLAY_HASH_MISMATCH: '+$entry.source)}
    $overlays[$entry.target]=[pscustomobject]@{Source=$source;Key=$entry.target}
}
EnsureDir (Split-Path -Parent $target)
$staged=Join-Path (Split-Path -Parent $target) ('.'+[IO.Path]::GetFileName($target)+'.'+[guid]::NewGuid().ToString('N')+'.staging')
try {
    $inputZip=[IO.Compression.ZipFile]::OpenRead($base)
    try {
        $reader=[IO.StreamReader]::new($inputZip.GetEntry('manifest.json').Open())
        try{$manifest=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose()}
        if($manifest.version -ne $lock.runtimeVersion -or $manifest.format -ne 2 -or $manifest.arch -ne 'AMD64'){throw 'REBUILD_BASE_VERSION_MISMATCH'}
        # Keep exact-case matching while avoiding a full manifest scan per ZIP entry.
        $manifestEntries=[Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
        foreach($row in $manifest.files){
            $path=[string]$row.path
            if($manifestEntries.ContainsKey($path)){throw ('REBUILD_DUPLICATE_BASE_ENTRY: '+$path)}
            $manifestEntries.Add($path,$row)
        }
        $outputZip=[IO.Compression.ZipFile]::Open($staged,[IO.Compression.ZipArchiveMode]::Create)
        try {
            $rows=New-Object System.Collections.ArrayList
            foreach($entry in $inputZip.Entries){
                $key=$entry.FullName
                if($key -eq 'manifest.json' -or $overlays.ContainsKey($key) -or $key -like '*.openchatx.mjs' -or $key.EndsWith('/')){continue}
                $copy=$outputZip.CreateEntry($key,[IO.Compression.CompressionLevel]::Optimal)
                $from=$entry.Open();$to=$copy.Open()
                try{$from.CopyTo($to)}finally{$from.Dispose();$to.Dispose()}
                if(-not $manifestEntries.ContainsKey($key)){throw ('REBUILD_UNDECLARED_BASE_ENTRY: '+$key)}
                [void]$rows.Add($manifestEntries[$key])
            }
            foreach($key in @($overlays.Keys|Sort-Object)){[void]$rows.Add((AddBundleZipEntry $outputZip $overlays[$key]))}
            $rebuilt=[ordered]@{format=2;arch='AMD64';version=$lock.runtimeVersion;createdUtc=[DateTime]::UtcNow.ToString('o');files=@($rows.ToArray());excluded=$manifest.excluded;rebuildBaseSha256=$lock.baseSha256;runtimePolicy=$lock.runtimePolicy}
            $entry=$outputZip.CreateEntry('manifest.json')
            $writer=[IO.StreamWriter]::new($entry.Open(),[Text.UTF8Encoding]::new($false))
            try{$writer.Write(($rebuilt|ConvertTo-Json -Depth 10))}finally{$writer.Dispose()}
        }finally{$outputZip.Dispose()}
    }finally{$inputZip.Dispose()}
    PublishCoreExport $staged $target ([bool]$Force)
    Write-Output ('REBUILT_CORE='+$target)
    Write-Output ('REBUILT_CORE_SHA256='+(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash)
} finally {
    if(Test-Path -LiteralPath $staged){Remove-Item -LiteralPath $staged -Force}
}
