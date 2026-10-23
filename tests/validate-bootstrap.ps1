# Non-mutating bootstrap contract tests; synthetic ZIP is created only under TEMP.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$bootstrap=Join-Path $root 'payload\bootstrap\naos-agent-stack.ps1'
$tokens=$null
$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($bootstrap,[ref]$tokens,[ref]$parseErrors)
if(@($parseErrors).Count){throw 'BOOTSTRAP_PARSE_FAILED'}
$definitions=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$true))
function Get-Body([string]$name) {
    $matches=@($definitions|Where-Object {$_.Name -eq $name})
    if($matches.Count -ne 1){throw ('BOOTSTRAP_FUNCTION_MISSING: '+$name)}
    return [string]$matches[0].Body.Extent.Text
}
function Require-Text([string]$body,[string]$value,[string]$failure) {
    if(-not $body.Contains($value)){throw $failure}
}
$export=Get-Body 'ExportStack'
$verify=Get-Body 'VerifyBundle'
$install=Get-Body 'InstallStack'
$doctor=Get-Body 'Doctor'
$requiredContract=Get-Body 'RequiredBundleEntries'
foreach($relative in @('codebase-project-sync.mjs','codebase-index\ecosystem.config.cjs')){
    if(([regex]::Matches($export,[regex]::Escape($relative))).Count -lt 2){
        throw ('BOOTSTRAP_EXPORT_MUST_REQUIRE_AND_INCLUDE: '+$relative)
    }
    Require-Text $doctor $relative ('BOOTSTRAP_DOCTOR_MISSING: '+$relative)
    Require-Text $requiredContract ('headless/'+$relative.Replace('\','/')) ('BOOTSTRAP_VERIFY_MISSING: '+$relative)
}
Require-Text $install "'codebase-memory-mcp@0.11.0'" 'BOOTSTRAP_MISSING_CBM_INSTALL'
Require-Text $install "'config\codebase-index.json'" 'BOOTSTRAP_MISSING_INDEX_CONFIG'
Require-Text $doctor 'config\codebase-index.json' 'BOOTSTRAP_DOCTOR_MISSING_INDEX_CONFIG'
Require-Text $install "'codebase-project-sync.mjs';Require " 'BOOTSTRAP_MISSING_BUNDLED_WATCHER_CHECK'
Require-Text $install '& $nodeExe --check $watcher' 'BOOTSTRAP_MISSING_WATCHER_SYNTAX_CHECK'
if($install.Contains('install-codebase-memory.ps1') -or $install.Contains('-SkipPackageInstall -SkipStart')){
    throw 'BOOTSTRAP_MUST_NOT_REPLACE_BUNDLED_CBM_WATCHER_WITH_OLDER_LETTA_SCRIPT'
}
if($install.Contains('@opencode/cli') -or $export.Contains('sourceHost=') -or $install.Contains('$manifest.sourceHost')){
    throw 'BOOTSTRAP_RETIRED_CLI_OR_PRIVATE_HOST_METADATA'
}
Write-Output '[PASS] Core exporter requires and includes Codebase Memory synchronizer and PM2 ecosystem'
Write-Output '[PASS] Doctor and installer configure Codebase Memory; retired OpenCode CLI removed'
Write-Output '[PASS] Installer preserves exported Codebase Memory watcher and checks its syntax without invoking obsolete Letta installer'

# A real install invocation must reject a ZIP whose manifest omits required core files
# during the verification stage, before touching any installation paths.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$fixture=Join-Path $env:TEMP ('naos-bootstrap-missing-core-'+[guid]::NewGuid().ToString('N')+'.zip')
try {
    $zip=[IO.Compression.ZipFile]::Open($fixture,[IO.Compression.ZipArchiveMode]::Create)
    try {
        $entry=$zip.CreateEntry('manifest.json')
        $writer=[IO.StreamWriter]::new($entry.Open(),[Text.UTF8Encoding]::new($false))
        try {
            $manifest=[ordered]@{format=2;arch=$env:PROCESSOR_ARCHITECTURE;version='1.0.0-beta.2';files=@()}
            $writer.Write(($manifest|ConvertTo-Json -Depth 5))
        } finally {$writer.Dispose()}
    } finally {$zip.Dispose()}
    $savedPreference=$ErrorActionPreference
    $ErrorActionPreference='Continue'
    try {
        $result=@(& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $bootstrap -Mode install -BundlePath $fixture -DryRun 2>&1)
        $code=$LASTEXITCODE
    } finally {$ErrorActionPreference=$savedPreference}
    if($code -eq 0 -or -not(($result -join [Environment]::NewLine) -match 'Required bundle component missing: runtime/package.json')){
        throw 'BOOTSTRAP_MISSING_CORE_BUNDLE_NOT_REJECTED'
    }
    Write-Output '[PASS] Missing mandatory core bundle entries rejected before installation'
} finally {
    Remove-Item -LiteralPath $fixture -Force -ErrorAction SilentlyContinue
}
# Exercise the actual exporter selector against synthetic files, never production state.
foreach($name in @('Fail','AddFile','AddTree','RequiredBundleEntries')){
    $fn=@($definitions|Where-Object {$_.Name -eq $name})
    if($fn.Count -ne 1){throw ('BOOTSTRAP_FUNCTION_MISSING: '+$name)}
    Invoke-Expression $fn[0].Extent.Text
}
if($export.Contains("AddTree " + '$items' + " (Join-Path " + '$Headless' + " 'toolboxes')") -or
   -not $export.Contains("coreToolboxes=@('agent-runtime','files'") -or
   -not $export.Contains("('toolboxes/'+") -or
   -not $export.Contains("AddTree " + '$items' + " (Join-Path " + '$Headless' + " 'codebase-index')")){
    throw 'BOOTSTRAP_EXPORT_USES_UNSCOPED_TOOLBOXES_OR_OMITS_INDEX_SOURCE'
}
foreach($required in @('headless/codebase-index/qa-review-bundle-source.mjs','toolboxes/agent-runtime/toolbox.json','toolboxes/skills/toolbox.json','letta-poc/scripts/postinstall-patches.mjs','runtime/dist/index.js','runtime/package.json','runtime/bin/node.exe','headless/package.json','headless/package-lock.json','headless/tunnel-wrapper.ps1','headless/import-persistent-environment.ps1','letta-poc/compact-poc.mjs')){
    Require-Text $requiredContract $required ('BOOTSTRAP_REQUIRED_CONTRACT_MISSING: '+$required)
}
Require-Text $verify '(RequiredBundleEntries)' 'BOOTSTRAP_VERIFIER_NOT_USING_REQUIRED_CONTRACT'
Require-Text $export '(RequiredBundleEntries)' 'BOOTSTRAP_EXPORTER_NOT_USING_REQUIRED_CONTRACT'
Require-Text $export 'Required export source missing:' 'BOOTSTRAP_EXPORT_MISSING_FAIL_CLOSED_SOURCE_CHECK'
Require-Text $export "'..\..\README.md'" 'BOOTSTRAP_SOURCE_ROOT_README_FALLBACK_MISSING'
$testRoot=Join-Path $env:TEMP ('naos-export-safety-'+[guid]::NewGuid().ToString('N'))
function New-SyntheticFile([string]$relative) {
    $target=Join-Path $testRoot $relative
    [IO.Directory]::CreateDirectory((Split-Path -Parent $target))|Out-Null
    [IO.File]::WriteAllText($target,'synthetic-no-private-content',[Text.UTF8Encoding]::new($false))
}
function Assert-SyntheticPaths([System.Collections.ArrayList]$entries,[string[]]$allowed,[string[]]$denied){
    $paths=@($entries|ForEach-Object {$_.Key})
    foreach($key in $allowed){if($paths -notcontains $key){throw ('BOOTSTRAP_EXPORT_MISSING_SAFE_SOURCE: '+$key)}}
    foreach($key in $denied){if($paths -contains $key){throw ('BOOTSTRAP_EXPORT_LEAKED_PRIVATE_SOURCE: '+$key)}}
}
try {
    foreach($file in @(
        'toolboxes\agent-runtime\toolbox.json',
        'toolboxes\agent-runtime\tools\agent_runtime.ts',
        'toolboxes\agent-runtime\README.md',
        'toolboxes\agent-runtime\skills\agent-runtime-usage\SKILL.md',
        'toolboxes\agent-runtime\skills\agent-runtime-usage\notes.md',
        'toolboxes\agent-runtime\memory\session.md',
        'toolboxes\agent-runtime\cache\artifact.ts',
        'toolboxes\agent-runtime\.env',
        'toolboxes\agent-runtime\config.json',
        'toolboxes\stock-investment\skills\daily-stock-workflow\SKILL.md',
        'letta\package.json',
        'letta\package-lock.json',
        'letta\compact-poc.mjs',
        'letta\scripts\postinstall-patches.mjs',
        'letta\README.md',
        'letta\config.json',
        'letta\.letta\state.json',
        'letta\scripts\private\secret.mjs',
        'letta\tests\phase3.test.mjs',
        'codebase-index\ecosystem.config.cjs',
        'codebase-index\qa-review-bundle-source.mjs',
        'codebase-index\sync.test.mjs',
        'codebase-index\profiles\private.mjs',
        'codebase-index\config.json'
    )){New-SyntheticFile $file}
    $toolboxItems=New-Object System.Collections.ArrayList
    AddTree $toolboxItems (Join-Path $testRoot 'toolboxes\agent-runtime') 'toolboxes/agent-runtime' 'toolboxes'
    Assert-SyntheticPaths $toolboxItems @('toolboxes/agent-runtime/toolbox.json','toolboxes/agent-runtime/tools/agent_runtime.ts','toolboxes/agent-runtime/skills/agent-runtime-usage/SKILL.md') @('toolboxes/agent-runtime/README.md','toolboxes/agent-runtime/skills/agent-runtime-usage/notes.md','toolboxes/agent-runtime/memory/session.md','toolboxes/agent-runtime/cache/artifact.ts','toolboxes/agent-runtime/.env','toolboxes/agent-runtime/config.json','toolboxes/stock-investment/skills/daily-stock-workflow/SKILL.md')
    $lettaItems=New-Object System.Collections.ArrayList
    AddTree $lettaItems (Join-Path $testRoot 'letta') 'letta-poc' 'letta'
    Assert-SyntheticPaths $lettaItems @('letta-poc/package.json','letta-poc/package-lock.json','letta-poc/compact-poc.mjs','letta-poc/scripts/postinstall-patches.mjs') @('letta-poc/README.md','letta-poc/config.json','letta-poc/.letta/state.json','letta-poc/scripts/private/secret.mjs','letta-poc/tests/phase3.test.mjs')
    $indexItems=New-Object System.Collections.ArrayList
    AddTree $indexItems (Join-Path $testRoot 'codebase-index') 'headless/codebase-index' 'codebase-index'
    Assert-SyntheticPaths $indexItems @('headless/codebase-index/ecosystem.config.cjs','headless/codebase-index/qa-review-bundle-source.mjs') @('headless/codebase-index/sync.test.mjs','headless/codebase-index/profiles/private.mjs','headless/codebase-index/config.json')
    Write-Output '[PASS] Exporter scopes core toolboxes, required Letta scripts and Codebase Memory helper sources'
    Write-Output '[PASS] Exporter excludes synthetic memory, runtime config, credentials and user-installed skills'
} finally {
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
# Exercise the fresh-install configuration writer only inside an isolated TEMP fixture.
# The active MSI Headless/Letta profiles must not be touched by source tests.
foreach($name in @('EnsureDir','Require','WriteUtf8','CreateHeadlessConfiguration')){
    $fn=@($definitions|Where-Object {$_.Name -eq $name})
    if($fn.Count -ne 1){throw ('BOOTSTRAP_FUNCTION_MISSING: '+$name)}
    Invoke-Expression $fn[0].Extent.Text
}
$configRoot=Join-Path $env:TEMP ('naos-letta-first-config-'+[guid]::NewGuid().ToString('N'))
try {
    $Headless=Join-Path $configRoot 'headless'
    $LettaRoot=Join-Path $configRoot 'letta'
    WriteUtf8 (Join-Path $Headless 'tunnel-wrapper.ps1') '$tunnelExe = "C:\Legacy\tunnel-client.exe"'
    CreateHeadlessConfiguration
    $generated=Get-Content -LiteralPath (Join-Path $Headless 'toolboxes\agent-runtime\config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if($generated.engine -ne 'letta' -or $generated.defaultModel -ne 'letta/agent-config' -or
       $generated.lettaServerCwd -ne $LettaRoot -or -not $generated.lettaAutoStart){
        throw 'BOOTSTRAP_FRESH_INSTALL_NOT_LETTA_FIRST'
    }
    if($generated.defaultModel -match 'opencode' -or $generated.lettaNodeBinary -ne (Join-Path $LettaRoot 'node_modules\node\bin\node.exe')){
        throw 'BOOTSTRAP_FRESH_INSTALL_USES_RETIRED_ENGINE_OR_WRONG_LETTA_PATH'
    }
    Write-Output '[PASS] Fresh-install generated Agent Runtime config uses canonical Letta-first model and per-install paths'
} finally {
    Remove-Item -LiteralPath $configRoot -Recurse -Force -ErrorAction SilentlyContinue
}
# A manifest-hashed archive must also reject *unlisted* entries, even when they
# use an otherwise allowed extraction prefix. This closes a ZIP injection path.
$extraBundle=Join-Path $env:TEMP ('naos-bootstrap-extra-entry-'+[guid]::NewGuid().ToString('N')+'.zip')
try {
    $required=@(RequiredBundleEntries)
    $zip=[IO.Compression.ZipFile]::Open($extraBundle,[IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach($path in $required){$zip.CreateEntry($path)|Out-Null}
        $zip.CreateEntry('letta-poc/private-undeclared.mjs')|Out-Null
        $manifest=[ordered]@{
            format=2;arch=$env:PROCESSOR_ARCHITECTURE;version='1.0.0-beta.2'
            files=@($required|ForEach-Object {
                [ordered]@{path=$_;sha256='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}
            })
        }
        $entry=$zip.CreateEntry('manifest.json')
        $writer=[IO.StreamWriter]::new($entry.Open(),[Text.UTF8Encoding]::new($false))
        try {$writer.Write(($manifest|ConvertTo-Json -Depth 6))} finally {$writer.Dispose()}
    } finally {$zip.Dispose()}
    $savedPreference=$ErrorActionPreference
    $ErrorActionPreference='Continue'
    try {
        $output=@(& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $bootstrap -Mode install -BundlePath $extraBundle -DryRun 2>&1)
        $code=$LASTEXITCODE
    } finally {$ErrorActionPreference=$savedPreference}
    if($code -eq 0 -or -not(($output -join [Environment]::NewLine) -match 'Unlisted bundle entry refused: letta-poc/private-undeclared.mjs')){
        throw 'BOOTSTRAP_UNLISTED_ENTRY_NOT_REJECTED'
    }
    Write-Output '[PASS] Verified archive rejects undeclared ZIP entries before install'
} finally {
    Remove-Item -LiteralPath $extraBundle -Force -ErrorAction SilentlyContinue
}
# A ZIP can pass all individual SHA-256 checks yet still be unusable if a
# required entry (such as the runtime entry point) is missing from its manifest.
$missingRuntimeBundle=Join-Path $env:TEMP ('naos-bootstrap-missing-runtime-'+[guid]::NewGuid().ToString('N')+'.zip')
try {
    $missing='runtime/dist/index.js'
    $required=@(RequiredBundleEntries|Where-Object {$_ -ne $missing})
    if($required.Count -ne (@(RequiredBundleEntries).Count - 1)){throw 'BOOTSTRAP_REQUIRED_RUNTIME_NOT_DEFINED'}
    $zip=[IO.Compression.ZipFile]::Open($missingRuntimeBundle,[IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach($path in $required){$zip.CreateEntry($path)|Out-Null}
        $manifest=[ordered]@{
            format=2;arch=$env:PROCESSOR_ARCHITECTURE;version='1.0.0-beta.2'
            files=@($required|ForEach-Object {
                [ordered]@{path=$_;sha256='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}
            })
        }
        $entry=$zip.CreateEntry('manifest.json')
        $writer=[IO.StreamWriter]::new($entry.Open(),[Text.UTF8Encoding]::new($false))
        try {$writer.Write(($manifest|ConvertTo-Json -Depth 6))} finally {$writer.Dispose()}
    } finally {$zip.Dispose()}
    $savedPreference=$ErrorActionPreference
    $ErrorActionPreference='Continue'
    try {
        $output=@(& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $bootstrap -Mode install -BundlePath $missingRuntimeBundle -DryRun 2>&1)
        $code=$LASTEXITCODE
    } finally {$ErrorActionPreference=$savedPreference}
    if($code -eq 0 -or -not(($output -join [Environment]::NewLine) -match 'Required bundle component missing: runtime/dist/index.js')){
        throw 'BOOTSTRAP_MISSING_RUNTIME_ENTRY_NOT_REJECTED'
    }
    Write-Output '[PASS] Verified archive rejects missing runtime entry point before installation'
} finally {
    Remove-Item -LiteralPath $missingRuntimeBundle -Force -ErrorAction SilentlyContinue
}
Write-Output 'BOOTSTRAP_VALIDATION_PASSED'
exit 0
