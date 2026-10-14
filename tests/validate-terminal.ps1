# Read-only/synthetic tests for the optional Terminal Add-on.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'Terminal-Extras.ps1')
$lock=Get-NaosTerminalLock
foreach($part in @($lock.pwsh,$lock.posh,$lock.themes,$lock.nerdFont)){
    if([string]$part.sha256 -notmatch '^[a-f0-9]{64}$' -or
       [string]$part.file -notmatch '^[A-Za-z0-9._-]+$' -or
       [string]$part.url -notmatch '^https://(github.com|nodejs.org)/'){
        throw 'TERMINAL_LOCK_INVALID_PIN_OR_URL'
    }
}
if($lock.nerdFont.defaultTerminalFace -ne 'JetBrainsMono NFM'){throw 'UNEXPECTED_NF_DEFAULT_FACE'}
Write-Output '[PASS] Official PowerShell, Oh My Posh, Nerd Font pins and default face'

$nonexistent=Join-Path $env:TEMP ('naos-missing-terminal-addon-'+[guid]::NewGuid().ToString('N'))
$plan=@(Invoke-NaosTerminalSetup -Mode Plan -PowerShell7 -OhMyPosh -NerdFont -TerminalDefault -AssetsRoot $nonexistent -ForceBundled)
if(-not($plan -match 'TERMINAL_PLAN_ONLY_NO_CHANGES') -or -not($plan -match 'requires optional Terminal add-on ZIP')){
    throw 'TERMINAL_PLAN_MISSING_PACKAGE_WARNING'
}
Write-Output '[PASS] Optional Terminal Add-on plan remains read-only'

$blocked=$false
try{
    $null=Invoke-NaosTerminalSetup -Mode Preflight -PowerShell7 -OhMyPosh -TerminalDefault -AssetsRoot $nonexistent -ForceBundled
}catch{
    if($_.Exception.Message -match 'TERMINAL_ADDON_MISSING'){$blocked=$true}else{throw}
}
if(-not $blocked){throw 'MISSING_TERMINAL_ADDON_DID_NOT_BLOCK'}
Write-Output '[PASS] Missing Terminal Add-on refused before any installation'

$pwsh=Get-Command pwsh.exe -ErrorAction SilentlyContinue
if($pwsh){
    $temp=Join-Path $env:TEMP ('naos-terminal-synthetic-'+[guid]::NewGuid().ToString('N'))
    $settings=Join-Path $temp 'settings.json'
    $fragment=Join-Path $temp 'fragments'
    $launch=Join-Path $temp 'launch'
    $initial=@'
// Synthetic Windows Terminal config, not the current user's configuration.
{
  "defaultProfile": "{00000000-0000-0000-0000-000000000001}",
  "profiles": {"list": []},
  "keepMe": 123,
}
'@
    New-Item -Path $temp -ItemType Directory -Force|Out-Null
    [IO.File]::WriteAllText($settings,$initial,[Text.UTF8Encoding]::new($false))
    try {
        Set-NaosWindowsTerminalDefault -Pwsh $pwsh.Source -PoshExe '' -Theme '' -Font $true -SettingsFile $settings -FragmentDir $fragment -LaunchDir $launch|Out-Null
        $after=[IO.File]::ReadAllText($settings,[Text.Encoding]::UTF8)
        if(-not $after.Contains('keepMe') -or -not $after.Contains('// Synthetic Windows Terminal config')){
            throw 'TERMINAL_JSONC_SETTINGS_REWRITTEN_UNEXPECTEDLY'
        }
        if(-not $after.Contains('{0f0a2605-6ae4-4f5c-92ba-70bfb6aafe21}')){
            throw 'TERMINAL_DEFAULT_PROFILE_NOT_SET'
        }
        $backups=@(Get-ChildItem -LiteralPath $temp -Filter '*.naos-backup-*' -File -ErrorAction SilentlyContinue)
        if($backups.Count -ne 1){throw 'TERMINAL_BACKUP_MISSING'}
        $fragmentJson=Get-Content -LiteralPath (Join-Path $fragment 'PowerShell.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if($fragmentJson.profiles[0].font.face -ne 'JetBrainsMono NFM'){throw 'TERMINAL_NFM_FONT_NOT_SET'}
        Write-Output '[PASS] Synthetic Windows Terminal JSONC comments, original settings and backup preserved'
    }finally{
        Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
    }
}else{Write-Output '[WARN] PowerShell 7 unavailable on runner: synthetic default-profile test skipped.'}

$builder=Get-Content -LiteralPath (Join-Path $root 'Build-Package.ps1') -Raw -Encoding UTF8
if($builder -notmatch "ValidateSet\('Standard','Developer'\)" -or $builder -notmatch "Edition -eq 'Developer'"){
    throw 'STANDARD_DEVELOPER_EDITION_SELECTORS_MISSING'
}
Write-Output '[PASS] Standard excludes optional MinGit; Developer selects MinGit'
Write-Output 'TERMINAL_VALIDATION_PASSED'
exit 0
