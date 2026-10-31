# Synthetic, isolated regression: release builder must verify ZIP bytes and
# preserve a previous candidate if a later -Force publication fails.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('naos-package-builder-'+[guid]::NewGuid().ToString('N'))
$utf8=New-Object System.Text.UTF8Encoding($false)
New-Item -ItemType Directory -Path $fixture -Force | Out-Null

function Write-FixtureFile([string]$relative,[string]$contents){
    $path=Join-Path $fixture $relative
    $folder=Split-Path -Parent $path
    if(-not(Test-Path -LiteralPath $folder)){New-Item -ItemType Directory -Path $folder -Force|Out-Null}
    [IO.File]::WriteAllText($path,$contents,$utf8)
    return $path
}
function Run-FixtureBuild([string]$output,[switch]$force){
    $args=@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',(Join-Path $fixture 'Build-Package.ps1'),'-OutputPath',$output)
    if($force){$args+='-Force'}
    $previous=$ErrorActionPreference
    $ErrorActionPreference='Continue'
    try {
        $lines=@(& powershell.exe @args 2>&1 | ForEach-Object { $_.ToString() })
        $code=$LASTEXITCODE
    }finally{$ErrorActionPreference=$previous}
    return [pscustomobject]@{ExitCode=$code;Text=($lines -join [Environment]::NewLine)}
}
function Assert-VerifiedZip([string]$path){
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive=[IO.Compression.ZipFile]::OpenRead($path)
    try {
        $entry=$archive.GetEntry('manifest.json')
        if(-not $entry){throw 'SYNTHETIC_MANIFEST_MISSING'}
        $stream=New-Object IO.StreamReader($entry.Open())
        try{$manifest=$stream.ReadToEnd()|ConvertFrom-Json}finally{$stream.Dispose()}
        if($manifest.version -ne '0.2.3' -or $manifest.edition -ne 'Complete' -or
           @($manifest.contents).Count -ne 27 -or $archive.Entries.Count -ne 28){
            throw 'SYNTHETIC_MANIFEST_INCORRECT'
        }
        foreach($record in $manifest.contents){
            $file=$archive.GetEntry([string]$record.path)
            if(-not $file -or $file.Length -ne [long]$record.bytes){throw ('SYNTHETIC_ENTRY_MISSING: '+$record.path)}
            $sha=[Security.Cryptography.SHA256]::Create()
            $bytes=$file.Open()
            try{$actual=[BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()}
            finally{$bytes.Dispose();$sha.Dispose()}
            if($actual -ne [string]$record.sha256){throw ('SYNTHETIC_ENTRY_HASH_MISMATCH: '+$record.path)}
        }
    }finally{$archive.Dispose()}
    $hash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    $hashFile=[IO.Path]::ChangeExtension($path,'.sha256.txt')
    if(-not(Test-Path -LiteralPath $hashFile -PathType Leaf)){throw 'SYNTHETIC_HASH_FILE_MISSING'}
    $check=([IO.File]::ReadAllText($hashFile)).Trim()
    if($check -ne ($hash+'  '+[IO.Path]::GetFileName($path))){throw 'SYNTHETIC_ARCHIVE_HASH_MISMATCH'}
    return $hash
}
# A synthetically valid Headless v2 bundle: the actual MSI runtime is never
# read, copied, or treated as a clean-machine installation test.
function Write-SyntheticCore([string]$path,[string]$extraPath='', [switch]$badHash,[string]$omitPath=''){
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if(Test-Path -LiteralPath $path){Remove-Item -LiteralPath $path -Force}
    $entries=@($script:syntheticCoreEntries)
    if($omitPath){$entries=@($entries | Where-Object {$_ -cne $omitPath})}
    if($extraPath){$entries+= $extraPath}
    $rows=New-Object 'System.Collections.Generic.List[object]'
    $zip=[IO.Compression.ZipFile]::Open($path,[IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach($name in $entries){
            $bytes=$utf8.GetBytes('SYNTHETIC_TEST_ONLY:'+ $name)
            $entry=$zip.CreateEntry($name)
            $stream=$entry.Open()
            try{$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
            $sha=[Security.Cryptography.SHA256]::Create()
            try{$digest=[BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()}
            finally{$sha.Dispose()}
            if($badHash -and $name -eq 'runtime/package.json'){$digest=('0'*64)}
            [void]$rows.Add([ordered]@{path=$name;sha256=$digest})
        }
        $manifest=[ordered]@{format=2;arch='AMD64';version='1.0.0-beta.2';files=@($rows.ToArray())}
        $bytes=$utf8.GetBytes(($manifest|ConvertTo-Json -Depth 8))
        $entry=$zip.CreateEntry('manifest.json')
        $stream=$entry.Open()
        try{$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
    }finally{$zip.Dispose()}
}
function Get-QuotedList([string]$source,[string]$pattern,[string]$label){
    $match=[regex]::Match($source,$pattern)
    if(-not $match.Success){throw ('SYNTHETIC_CONTRACT_UNREADABLE: '+$label)}
    return @([regex]::Matches($match.Groups[1].Value,"'([^']+)'") |
        ForEach-Object {[string]$_.Groups[1].Value})
}
try {
    $builder=Get-Content -LiteralPath (Join-Path $root 'Build-Package.ps1') -Raw -Encoding UTF8
    $bootstrap=Get-Content -LiteralPath (Join-Path $root 'payload\bootstrap\naos-agent-stack.ps1') -Raw -Encoding UTF8
    $bootstrapRequired=@(Get-QuotedList $bootstrap '(?s)function RequiredBundleEntries\s*\{\s*@\((.*?)\r?\n\s*\)' 'bootstrap required files')
    $builderRequired=@(Get-QuotedList $builder '(?s)\$required=@\((.*?)\r?\n\s*\)' 'builder required files')
    if(@(Compare-Object -ReferenceObject $bootstrapRequired -DifferenceObject $builderRequired -CaseSensitive).Count){
        throw 'SYNTHETIC_CORE_REQUIREMENTS_DRIFT: the Complete builder does not match bootstrap RequiredBundleEntries'
    }
    $bootstrapToolboxes=@(Get-QuotedList $bootstrap '(?s)\$coreToolboxes=@\((.*?)\)' 'bootstrap built-in toolboxes')
    $builderToolboxes=@(Get-QuotedList $builder '(?s)foreach\(\$name in @\((.*?)\r?\n\s*\)\)\s*\{' 'builder built-in toolboxes')
    if(@(Compare-Object -ReferenceObject $bootstrapToolboxes -DifferenceObject $builderToolboxes -CaseSensitive).Count){
        throw 'SYNTHETIC_CORE_TOOLBOXES_DRIFT: the Complete builder does not match bootstrap built-ins'
    }
    $toolboxDescriptors=@($bootstrapToolboxes | ForEach-Object {'toolboxes/'+$_+'/toolbox.json'})
    $script:syntheticCoreEntries=@($bootstrapRequired + $toolboxDescriptors | Select-Object -Unique)
    Write-Output ('[PASS] Core requirements aligned: '+$bootstrapRequired.Count+' bootstrap files, '+$bootstrapToolboxes.Count+' built-in toolboxes')
    $list=[regex]::Match($builder,'(?s)\$sourceFiles=@\((.*?)\r?\n\)')
    if(-not $list.Success){throw 'SYNTHETIC_BUILDER_SOURCES_UNREADABLE'}
    $sourceMatches=[regex]::Matches($list.Groups[1].Value,"'([^']+)'")
    if($sourceMatches.Count -ne 20){throw 'SYNTHETIC_SOURCE_LIST_UNEXPECTED'}
    foreach($match in $sourceMatches){
        $relative=$match.Groups[1].Value
        $origin=Join-Path $root $relative
        if(-not(Test-Path -LiteralPath $origin -PathType Leaf)){throw ('SYNTHETIC_MISSING_SOURCE: '+$relative)}
        $target=Join-Path $fixture $relative
        $folder=Split-Path -Parent $target
        if(-not(Test-Path -LiteralPath $folder)){New-Item -ItemType Directory -Path $folder -Force|Out-Null}
        Copy-Item -LiteralPath $origin -Destination $target
    }
    $dep=Get-Content -LiteralPath (Join-Path $root 'dependencies.lock.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $terminal=Get-Content -LiteralPath (Join-Path $root 'terminal.lock.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $assets=@(
        [pscustomobject]@{Relative=('payload\'+[string]$dep.core.package);Data=$dep.core},
        [pscustomobject]@{Relative=('payload\prerequisites\'+[string]$dep.node.package);Data=$dep.node},
        [pscustomobject]@{Relative=('payload\prerequisites\'+[string]$dep.git.package);Data=$dep.git}
    )
    foreach($item in @($terminal.pwsh,$terminal.posh,$terminal.themes,$terminal.nerdFont)){
        $assets+=([pscustomobject]@{Relative=('payload\terminal\'+[string]$item.file);Data=$item})
    }
    foreach($asset in $assets){
        $path=Write-FixtureFile $asset.Relative ('SYNTHETIC_TEST_ONLY:'+ $asset.Relative)
        $asset.Data.sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $corePath=Join-Path $fixture ([string]$assets[0].Relative)
    Write-SyntheticCore $corePath
    $dep.core.sha256=(Get-FileHash -LiteralPath $corePath -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $fixture 'dependencies.lock.json'),($dep|ConvertTo-Json -Depth 8),$utf8)
    [IO.File]::WriteAllText((Join-Path $fixture 'terminal.lock.json'),($terminal|ConvertTo-Json -Depth 8),$utf8)
    $candidate=Join-Path $fixture 'candidate.zip'
    $result=Run-FixtureBuild $candidate
    if($result.ExitCode -ne 0){throw ('SYNTHETIC_INITIAL_BUILD_FAILED: '+$result.Text)}
    $hash1=Assert-VerifiedZip $candidate
    Write-Output '[PASS] Synthetic Complete ZIP: all 27 entries and checksums verified'

    # A matching outer SHA256 is not sufficient: the nested core must
    # contain all bootstrap startup files and built-in toolbox descriptors.
    $trustedCore=[IO.File]::ReadAllBytes($corePath)
    $badCores=@(
        @{Path='headless/config/oauth.json';Expected='CORE_BUNDLE_PRIVATE_PATH'},
        @{Path='runtime/config/oauth.json';Expected='CORE_BUNDLE_PRIVATE_PATH'},
        @{Path='runtime/user-data/profile.json';Expected='CORE_BUNDLE_PRIVATE_PATH'},
        @{Path='letta-poc/config/agent.json';Expected='CORE_BUNDLE_PRIVATE_PATH'},
        @{Path='headless/logs/mcp.log';Expected='CORE_BUNDLE_PRIVATE_PATH'},
        @{Path='letta-poc/memories/conversation.json';Expected='CORE_BUNDLE_PRIVATE_PATH'},
        @{Path='runtime/../secrets/token';Expected='CORE_BUNDLE_UNSAFE_OR_DUPLICATE_PATH'},
        @{Path='';Expected='CORE_BUNDLE_ENTRY_SHA256_MISMATCH';BadHash=$true},
        @{Path='';Expected='CORE_BUNDLE_REQUIRED_MISSING: headless/stop-headless.ps1';OmitPath='headless/stop-headless.ps1'},
        @{Path='';Expected='CORE_BUNDLE_REQUIRED_MISSING: toolboxes/jobs/toolbox.json';OmitPath='toolboxes/jobs/toolbox.json'}
    )
    try {
        foreach($attack in $badCores){
            $omit=if($attack.ContainsKey('OmitPath')){[string]$attack.OmitPath}else{''}
            Write-SyntheticCore $corePath ([string]$attack.Path) -badHash:($attack.ContainsKey('BadHash')) -omitPath $omit
            $dep.core.sha256=(Get-FileHash -LiteralPath $corePath -Algorithm SHA256).Hash.ToLowerInvariant()
            [IO.File]::WriteAllText((Join-Path $fixture 'dependencies.lock.json'),($dep|ConvertTo-Json -Depth 8),$utf8)
            $failed=Run-FixtureBuild $candidate -force
            if($failed.ExitCode -eq 0 -or $failed.Text -notmatch [regex]::Escape([string]$attack.Expected)){
                throw ('SYNTHETIC_PRIVATE_CORE_NOT_REJECTED: '+$attack.Expected+'; '+$failed.Text)
            }
            if((Assert-VerifiedZip $candidate) -ne $hash1){throw 'SYNTHETIC_BAD_CORE_OVERWROTE_ZIP'}
        }
    }finally{
        [IO.File]::WriteAllBytes($corePath,$trustedCore)
        $dep.core.sha256=(Get-FileHash -LiteralPath $corePath -Algorithm SHA256).Hash.ToLowerInvariant()
        [IO.File]::WriteAllText((Join-Path $fixture 'dependencies.lock.json'),($dep|ConvertTo-Json -Depth 8),$utf8)
    }
    Write-Output '[PASS] Locked malicious/private nested core archives rejected; prior ZIP preserved'

    # Whitelisting a filename is not sufficient if a source directory is a
    # junction: both release source files and locked assets must refuse links.
    foreach($relative in @('third_party','payload\prerequisites')){
        $linkedPath=Join-Path $fixture $relative
        $privateFixture=Join-Path $fixture ('synthetic-private-target-'+[guid]::NewGuid().ToString('N'))
        Move-Item -LiteralPath $linkedPath -Destination $privateFixture
        try {
            New-Item -ItemType Junction -Path $linkedPath -Target $privateFixture -ErrorAction Stop | Out-Null
            $failed=Run-FixtureBuild $candidate -force
            if($failed.ExitCode -eq 0 -or $failed.Text -notmatch 'UNSAFE_RELEASE_SOURCE_REPARSE_POINT'){
                throw ('SYNTHETIC_LINKED_SOURCE_NOT_REJECTED: '+$relative+'; '+$failed.Text)
            }
            if((Assert-VerifiedZip $candidate) -ne $hash1){throw 'SYNTHETIC_LINKED_SOURCE_OVERWROTE_ZIP'}
        }finally {
            $node=Get-Item -LiteralPath $linkedPath -Force -ErrorAction SilentlyContinue
            if($node -and ($node.Attributes -band [IO.FileAttributes]::ReparsePoint)){
                [IO.Directory]::Delete($linkedPath) # Remove junction, never follow its target.
            }
            Move-Item -LiteralPath $privateFixture -Destination $linkedPath
        }
    }
    Write-Output '[PASS] Source and payload junctions rejected; prior ZIP preserved'

    # A successful force rebuild replaces both published files consistently.
    [IO.File]::AppendAllText((Join-Path $fixture 'README.md'),[Environment]::NewLine+'synthetic-change',$utf8)
    $result=Run-FixtureBuild $candidate -force
    if($result.ExitCode -ne 0){throw ('SYNTHETIC_FORCE_BUILD_FAILED: '+$result.Text)}
    $hash2=Assert-VerifiedZip $candidate
    if($hash1 -eq $hash2){throw 'SYNTHETIC_FORCE_DID_NOT_REPLACE'}
    Write-Output '[PASS] Synthetic -Force rebuild replaces verified ZIP and checksum'

    # Simulate publication failure AFTER the ZIP has been verified and
    # atomically replaced; ZIP must roll back to the previous good bytes.
    $hashFile=[IO.Path]::ChangeExtension($candidate,'.sha256.txt')
    Remove-Item -LiteralPath $hashFile -Force
    New-Item -ItemType Directory -Path $hashFile|Out-Null
    $failed=Run-FixtureBuild $candidate -force
    if($failed.ExitCode -eq 0){throw 'SYNTHETIC_CHECKSUM_PUBLICATION_MUST_FAIL'}
    if((Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash -ne $hash2){
        throw ('SYNTHETIC_FAILED_PUBLICATION_DESTROYED_ZIP: '+$failed.Text)
    }
    Remove-Item -LiteralPath $hashFile -Recurse -Force
    [IO.File]::WriteAllText($hashFile,($hash2+'  candidate.zip'+[Environment]::NewLine),[Text.Encoding]::ASCII)
    if((Assert-VerifiedZip $candidate) -ne $hash2){throw 'SYNTHETIC_ROLLBACK_HASH_MISMATCH'}
    Write-Output '[PASS] Synthetic failed checksum publication rolls ZIP back intact'

    # Input validation fails before replacing any existing good candidate.
    $missing=Join-Path $fixture ([string]$assets[0].Relative)
    Remove-Item -LiteralPath $missing -Force
    $failed=Run-FixtureBuild $candidate -force
    if($failed.ExitCode -eq 0 -or $failed.Text -notmatch 'COMPLETE_PAYLOAD_MISSING'){
        throw 'SYNTHETIC_MISSING_CORE_NOT_REJECTED'
    }
    if((Assert-VerifiedZip $candidate) -ne $hash2){throw 'SYNTHETIC_REJECTED_BUILD_OVERWROTE_ZIP'}
    $leftovers=@(Get-ChildItem -LiteralPath $fixture -File -Force |
        Where-Object {$_.Name -match '\.(staging|backup)$'})
    if($leftovers.Count){throw 'SYNTHETIC_BUILD_LEFT_STAGING_FILES'}
    Write-Output '[PASS] Missing core fails closed and preserves the prior ZIP'

    # A single preflight must enumerate *all* missing assets, rather than
    # forcing the operator to rediscover them one at a time.
    foreach($asset in $assets){
        $path=Join-Path $fixture ([string]$asset.Relative)
        if(Test-Path -LiteralPath $path){Remove-Item -LiteralPath $path -Force}
    }
    $failed=Run-FixtureBuild $candidate -force
    if($failed.ExitCode -eq 0 -or $failed.Text -notmatch 'COMPLETE_PAYLOAD_PREFLIGHT_FAILED'){
        throw ('SYNTHETIC_ALL_MISSING_ASSETS_NOT_REJECTED: '+$failed.Text)
    }
    foreach($asset in $assets){
        $name=[IO.Path]::GetFileName([string]$asset.Relative)
        if($failed.Text -notmatch [regex]::Escape($name)){
            throw ('SYNTHETIC_PREFLIGHT_OMITTED_ASSET: '+$name)
        }
    }
    if((Assert-VerifiedZip $candidate) -ne $hash2){throw 'SYNTHETIC_ALL_MISSING_ASSETS_OVERWROTE_ZIP'}
    Write-Output '[PASS] All seven missing dependencies reported together; good ZIP preserved'

    # Likewise, report multiple checksum failures while leaving ZIP untouched.
    foreach($asset in $assets){
        [void](Write-FixtureFile $asset.Relative ('SYNTHETIC_TEST_ONLY:'+ $asset.Relative))
    }
    [IO.File]::AppendAllText((Join-Path $fixture ([string]$assets[0].Relative)),'tampered',$utf8)
    [IO.File]::AppendAllText((Join-Path $fixture ([string]$assets[1].Relative)),'tampered',$utf8)
    $failed=Run-FixtureBuild $candidate -force
    # Windows PowerShell repeats error text in its error record and can wrap
    # long paths, so assert both distinct failing filenames, not a raw count.
    if($failed.ExitCode -eq 0 -or $failed.Text -notmatch 'COMPLETE_PAYLOAD_SHA256_MISMATCH'){
        throw ('SYNTHETIC_MULTI_HASH_MISMATCH_NOT_REJECTED: '+$failed.Text)
    }
    foreach($asset in @($assets[0],$assets[1])){
        if($failed.Text -notmatch [regex]::Escape([IO.Path]::GetFileName([string]$asset.Relative))){
            throw ('SYNTHETIC_HASH_PREFLIGHT_OMITTED_ASSET: '+$asset.Relative)
        }
    }
    if((Assert-VerifiedZip $candidate) -ne $hash2){throw 'SYNTHETIC_MISMATCH_OVERWROTE_ZIP'}
    Write-Output '[PASS] Both tampered dependency hashes rejected without replacing ZIP'
    Write-Output 'PACKAGE_BUILDER_VALIDATION_PASSED'
}finally{
    if(Test-Path -LiteralPath $fixture){Remove-Item -LiteralPath $fixture -Recurse -Force}
}
exit 0
