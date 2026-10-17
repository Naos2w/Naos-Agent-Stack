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
    'Prerequisites.ps1',
    'Install-Wizard.ps1',
    'Installer-Preflight.ps1',
    'Terminal-Extras.ps1',
    'Terminal-Json-Validate.ps1',
    'Launch-NaosPowerShell.ps1',
    'tests\validate-unified.ps1',
    'tests\validate-wizard.ps1',
    'tests\validate-terminal.ps1',
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
$wizardTest=@(& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'validate-wizard.ps1'))
$wizardExit=$LASTEXITCODE
if($wizardExit -ne 0 -or -not ($wizardTest -match 'WIZARD_VALIDATION_PASSED')){
    throw 'Interactive wizard scripted tests or read-only plan failed.'
}
Write-Output '[PASS] Interactive wizard: mandatory core, optional Git, terminal, sharing, scan, and read-only plan'
$terminalTest=@(& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'validate-terminal.ps1'))
$terminalExit=$LASTEXITCODE
if($terminalExit -ne 0 -or -not ($terminalTest -match 'TERMINAL_VALIDATION_PASSED')){
    throw 'Optional terminal add-on synthetic tests failed.'
}
Write-Output '[PASS] Optional PowerShell 7, Oh My Posh, Nerd Font, Windows Terminal settings'
$unifiedOutput=@(& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'validate-unified.ps1'))
if($LASTEXITCODE -ne 0 -or -not($unifiedOutput -match 'UNIFIED_SOURCE_VALIDATION_PASSED')){
    throw 'Unified ZIP and pre-install dependency tests failed.'
}
Write-Output '[PASS] Single Complete ZIP, all optional packages, early pre-install checks'
$lockFile=Join-Path $root 'dependencies.lock.json'
if(-not(Test-Path -LiteralPath $lockFile)){throw 'Missing dependency lock file.'}
$lock=Get-Content -LiteralPath $lockFile -Raw -Encoding UTF8 | ConvertFrom-Json
if($lock.packageVersion -ne '0.2.2' -or
   $lock.core.sha256 -notmatch '^[a-f0-9]{64}$' -or
   $lock.core.package -ne 'naos-headless-stack-bundle.zip' -or
   $lock.node.sha256 -notmatch '^[a-f0-9]{64}$' -or
   $lock.git.sha256 -notmatch '^[a-f0-9]{64}$' -or
   $lock.node.source -notmatch '^https://nodejs\.org/' -or
   $lock.git.source -notmatch '^https://github\.com/git-for-windows/git/') {
    throw 'Offline dependency lock schema or trusted source invalid.'
}
Write-Output '[PASS] Verified dependency lock metadata'
. (Join-Path $root 'Prerequisites.ps1')
$nodeMetadata=Get-NaosPrerequisiteDefinition node
$gitMetadata=Get-NaosPrerequisiteDefinition git
if($nodeMetadata.Sha256.ToLowerInvariant() -ne $lock.node.sha256.ToLowerInvariant() -or
   $gitMetadata.Sha256.ToLowerInvariant() -ne $lock.git.sha256.ToLowerInvariant() -or
   $nodeMetadata.Archive -ne $lock.node.package -or $gitMetadata.Archive -ne $lock.git.package){
    throw 'Portable prerequisites definitions and SHA256 lock disagree.'
}
Write-Output '[PASS] Offline dependencies SHA256 definitions match pinned lock'
$missingArchive=Join-Path $env:TEMP ('naos-dependency-does-not-exist-'+[guid]::NewGuid().ToString('N')+'.zip')
$refused=$false
try{Assert-NaosTrustedArchive $missingArchive $nodeMetadata.Sha256}
catch{if($_.Exception.Message -match 'OFFLINE_DEPENDENCY_MISSING'){$refused=$true}else{throw}}
if(-not $refused){throw 'Missing Node/npm archive was not rejected.'}
Write-Output '[PASS] Missing bundled Node/npm archive rejected before installation'
$plan=@(& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $entry plan -Role single -NoCore)
if($LASTEXITCODE -ne 0 -or -not($plan -match 'PLAN_ONLY_NO_CHANGES')) {
    throw 'Single mode dry-run failed.'
}
Write-Output '[PASS] Single mode dry-run (no changes)'
$firstInstallPlan=@(& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $entry plan -Role single -InstallGit)
if($LASTEXITCODE -ne 0 -or -not($firstInstallPlan -match 'PLAN_ONLY_NO_CHANGES') -or
   (-not($firstInstallPlan -match 'Existing OpenChatX Headless detected') -and
    -not($firstInstallPlan -match 'npm package installation still requires Internet'))) {
    throw 'Fresh x64 install plan did not disclose npm registry requirement.'
}
Write-Output '[PASS] Fresh install plan declares offline tools and online npm dependency'
$priorErrorActionPreference=$ErrorActionPreference
$ErrorActionPreference='Continue'
$invalid=@(& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $entry plan -Role client -NoCore -Sharing -NoSharing 2>&1)
$negativeExitCode=$LASTEXITCODE
$ErrorActionPreference=$priorErrorActionPreference
if($negativeExitCode -eq 0 -or -not (($invalid -join [Environment]::NewLine) -match 'Choose either -Sharing or -NoSharing')) {
    throw 'Contradictory sharing flags did not fail for the expected reason.'
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
# The negative test intentionally returns 1; without an explicit exit here,
# GitHub Actions PowerShell's wrapper propagates that stale $LASTEXITCODE.
exit 0
