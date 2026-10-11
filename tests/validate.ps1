# Lightweight, non-mutating Windows PowerShell syntax and packaging validation.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$names = @(
    'naos-agent-stack.ps1',
    'Engine.ps1',
    'Doctor.ps1',
    'ForwardWatchdog.ps1',
    'Build-Package.ps1',
    'payload\bootstrap\naos-agent-stack.ps1'
)
foreach($name in $names) {
    $path=Join-Path $root $name
    if(-not(Test-Path -LiteralPath $path -PathType Leaf)) {throw "Missing required script: $name"}
    $tokens=$null
    $errors=$null
    [Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$errors) | Out-Null
    if(@($errors).Count) {
        $first=@($errors)[0]
        throw "PowerShell parser failed: $name line $($first.Extent.StartLineNumber): $($first.Message)"
    }
    Write-Output "[PASS] Parse $name"
}
$entry=Join-Path $root 'naos-agent-stack.ps1'
$help=@(& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $entry help)
if(-not($help -match 'doctor') -or -not($help -match 'install') -or -not($help -match 'plan')) {
    throw 'Entry point help does not advertise required commands.'
}
Write-Output '[PASS] Unified command help'
$plan=@(& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $entry plan -Role single -NoCore)
if($LASTEXITCODE -ne 0 -or -not($plan -match 'PLAN_ONLY_NO_CHANGES')) {
    throw 'Single mode dry-run failed.'
}
Write-Output '[PASS] Single mode dry-run (no changes)'
$priorErrorActionPreference=$ErrorActionPreference
$ErrorActionPreference='Continue'
$invalid=@(& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $entry plan -Role client -NoCore -Sharing -NoSharing 2>&1)
$negativeExitCode=$LASTEXITCODE
$ErrorActionPreference=$priorErrorActionPreference
if($negativeExitCode -eq 0) {
    throw 'Contradictory sharing flags were incorrectly accepted.'
}
Write-Output '[PASS] Contradictory sharing option rejected'
$requiredIgnore=@('*.zip','**/.ssh/','**/state.json','**/tunnel-profiles/')
$ignore=Get-Content -LiteralPath (Join-Path $root '.gitignore') -Raw -Encoding UTF8
foreach($rule in $requiredIgnore) {
    if(-not($ignore.Contains($rule))) {throw "Missing ignore rule: $rule"}
}
Write-Output '[PASS] Sensitive and large-file ignore policies'
$sourcePaths=@(Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction Stop |
    Where-Object {$_.FullName -notmatch '\\.git\\' -and $_.Name -ne '.gitignore'})
$sensitive=@($sourcePaths|Where-Object{$_.Name -match '(?i)^(?:id_ed25519.*|state\.json|operations\.json|\.env.*|.*\.key|.*\.pfx|.*\.pem)$'})
if($sensitive.Count) {throw 'Sensitive file name discovered in source tree.'}
$large=@($sourcePaths | Where-Object {$_.Length -gt 1048576})
if($large.Count){throw 'Source tree contains unexpectedly large files. Releases should hold binaries.'}
Write-Output '[PASS] Source tree excludes secrets and large binaries'
Write-Output 'SOURCE_VALIDATION_PASSED'
