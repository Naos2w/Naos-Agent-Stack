# Exercise the real rebuilder against small isolated bundles, without installing.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression,System.IO.Compression.FileSystem
$repo=Split-Path -Parent $PSScriptRoot
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('naos-rebuild-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $fixture 'runtime'),(Join-Path $fixture 'payload/bootstrap') -Force | Out-Null
try {
    $builder=Join-Path $fixture 'runtime/Rebuild-CoreBundle.ps1'
    $bootstrap=Join-Path $repo 'payload/bootstrap/naos-agent-stack.ps1'
    Copy-Item -LiteralPath (Join-Path $repo 'runtime/Rebuild-CoreBundle.ps1') -Destination $builder
    Copy-Item -LiteralPath $bootstrap -Destination (Join-Path $fixture 'payload/bootstrap/naos-agent-stack.ps1')
    $tokens=$null;$errors=$null
    $ast=[Management.Automation.Language.Parser]::ParseFile($bootstrap,[ref]$tokens,[ref]$errors)
    if($errors.Count){throw 'Bootstrap parse failed'}
    $definition=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'RequiredBundleEntries'},$true))
    if($definition.Count -ne 1){throw 'Required component helper missing'}
    Invoke-Expression $definition[0].Extent.Text
    $required=@(RequiredBundleEntries)
    foreach($scenario in @('valid','case-mismatch','duplicate')){
        $base=Join-Path $fixture ($scenario+'-base.zip')
        $target=Join-Path $fixture ($scenario+'-output.zip')
        $zip=[IO.Compression.ZipFile]::Open($base,[IO.Compression.ZipArchiveMode]::Create)
        try {
            $rows=New-Object System.Collections.ArrayList
            foreach($path in $required){
                $bytes=[Text.Encoding]::UTF8.GetBytes('fixture: '+$path)
                $entry=$zip.CreateEntry($path);$stream=$entry.Open()
                try{$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
                $hash=[Security.Cryptography.SHA256]::Create()
                try{$sha=([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
                [void]$rows.Add([pscustomobject]@{path=$path;sha256=$sha})
            }
            if($scenario -eq 'case-mismatch'){$rows[0].path=$rows[0].path.ToUpperInvariant()}
            if($scenario -eq 'duplicate'){[void]$rows.Add($rows[0])}
            $manifest=[ordered]@{format=2;arch='AMD64';version='1.0.0-beta.2';files=@($rows.ToArray());excluded=@()}
            $writer=[IO.StreamWriter]::new($zip.CreateEntry('manifest.json').Open(),[Text.UTF8Encoding]::new($false))
            try{$writer.Write(($manifest|ConvertTo-Json -Depth 8))}finally{$writer.Dispose()}
        }finally{$zip.Dispose()}
        $lock=[ordered]@{schema=1;runtimeVersion='1.0.0-beta.2';runtimePolicy='fixture';baseSha256=(Get-FileHash -LiteralPath $base -Algorithm SHA256).Hash;overlays=@()}
        [IO.File]::WriteAllText((Join-Path $fixture 'runtime/rebuild.lock.json'),($lock|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
        if($scenario -eq 'valid'){
            & $builder -BaseBundlePath $base -OutputPath $target | Out-Null
            if(-not (Test-Path -LiteralPath $target)){throw 'Verified bundle was not published'}
            $result=[IO.Compression.ZipFile]::OpenRead($target)
            try{if($result.Entries.Count -ne ($required.Count+1)){throw 'Rebuilt file set differs'}}finally{$result.Dispose()}
        } else {
            [IO.File]::WriteAllText($target,'preserve prior artifact')
            $expected=if($scenario -eq 'duplicate'){'REBUILD_DUPLICATE_BASE_ENTRY'}else{'REBUILD_UNDECLARED_BASE_ENTRY'}
            $caught=$null
            try{& $builder -BaseBundlePath $base -OutputPath $target -Force | Out-Null}catch{$caught=$_.Exception.Message}
            if(-not $caught -or -not $caught.Contains($expected)){throw ('Unexpected rejection for '+$scenario+': '+$caught)}
            if([IO.File]::ReadAllText($target) -ne 'preserve prior artifact'){throw 'Failure replaced published artifact'}
        }
        if(@(Get-ChildItem -LiteralPath $fixture -Force -Filter '*.staging').Count){throw 'Staging artifact leaked'}
        Write-Output ('[PASS] Core rebuild '+$scenario)
    }
    Write-Output 'CORE_REBUILD_VALIDATION_PASSED'
} finally {
    # Only remove the unique fixture directory created by this test.
    $tempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
    $resolved=[IO.Path]::GetFullPath($fixture)
    if(-not $resolved.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolved) -notmatch '^naos-rebuild-test-[a-f0-9]{32}$'){throw 'Unsafe fixture cleanup path'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
