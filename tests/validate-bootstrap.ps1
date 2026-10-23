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
foreach($relative in @('codebase-project-sync.mjs','codebase-index\ecosystem.config.cjs')){
    if(([regex]::Matches($export,[regex]::Escape($relative))).Count -lt 2){
        throw ('BOOTSTRAP_EXPORT_MUST_REQUIRE_AND_INCLUDE: '+$relative)
    }
    Require-Text $doctor $relative ('BOOTSTRAP_DOCTOR_MISSING: '+$relative)
    Require-Text $verify ('headless/'+$relative.Replace('\','/')) ('BOOTSTRAP_VERIFY_MISSING: '+$relative)
}
Require-Text $install "'codebase-memory-mcp@0.11.0'" 'BOOTSTRAP_MISSING_CBM_INSTALL'
Require-Text $install "'config\codebase-index.json'" 'BOOTSTRAP_MISSING_INDEX_CONFIG'
Require-Text $doctor 'config\codebase-index.json' 'BOOTSTRAP_DOCTOR_MISSING_INDEX_CONFIG'
if($install.Contains('@opencode/cli') -or $export.Contains('sourceHost=') -or $install.Contains('$manifest.sourceHost')){
    throw 'BOOTSTRAP_RETIRED_CLI_OR_PRIVATE_HOST_METADATA'
}
Write-Output '[PASS] Core exporter requires and includes Codebase Memory synchronizer and PM2 ecosystem'
Write-Output '[PASS] Doctor and installer configure Codebase Memory; retired OpenCode CLI removed'

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
    if($code -eq 0 -or -not(($result -join [Environment]::NewLine) -match 'Required bundle component missing: headless/start-headless.ps1')){
        throw 'BOOTSTRAP_MISSING_CORE_BUNDLE_NOT_REJECTED'
    }
    Write-Output '[PASS] Missing mandatory core bundle entries rejected before installation'
} finally {
    Remove-Item -LiteralPath $fixture -Force -ErrorAction SilentlyContinue
}
Write-Output 'BOOTSTRAP_VALIDATION_PASSED'
exit 0
