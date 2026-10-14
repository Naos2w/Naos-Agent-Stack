# Optional, SHA256-pinned Windows x64 terminal enhancements.
# Plan and Preflight are read-only. Apply requires explicit selection.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

function Get-NaosTerminalLock {
    $p=Join-Path $PSScriptRoot 'terminal.lock.json'
    if(-not(Test-Path -LiteralPath $p)){throw 'TERMINAL_LOCK_MISSING'}
    $lock=Get-Content -LiteralPath $p -Raw -Encoding UTF8|ConvertFrom-Json
    if($lock.schema -ne 1 -or $lock.packageVersion -ne '0.2.1'){throw 'TERMINAL_LOCK_INVALID'}
    return $lock
}
function Assert-NaosTerminalAsset([string]$Root,$Item) {
    $file=[string]$Item.file
    if($file -notmatch '^[A-Za-z0-9._-]+$'){throw 'UNSAFE_TERMINAL_ASSET_NAME'}
    $path=Join-Path $Root $file
    if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw ('TERMINAL_ADDON_MISSING: '+$file)}
    if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne [string]$Item.sha256){
        throw ('TERMINAL_ADDON_SHA256_MISMATCH: '+$file)
    }
    return $path
}
function Test-NaosShell([string]$Executable,[string]$Version) {
    if(-not(Test-Path -LiteralPath $Executable -PathType Leaf)){return $false}
    try {
        $result=([string](& $Executable -NoProfile -NonInteractive -Command '$PSVersionTable.PSVersion.ToString()' 2>$null)).Trim()
        return ($LASTEXITCODE -eq 0 -and ([version]$result -ge [version]$Version))
    }catch{return $false}
}
function Get-NaosExistingShell {
    $p=Get-Command pwsh.exe -ErrorAction SilentlyContinue
    if($p -and (Test-NaosShell $p.Source '7.4.0')){return $p.Source}
    return ''
}
function Test-NaosInstalledNF {
    foreach($reg in @('HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts',
                      'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts')){
        $item=Get-ItemProperty -Path $reg -ErrorAction SilentlyContinue
        if($item -and @($item.PSObject.Properties|Where-Object{$_.Name -match '(?i)JetBrainsMono.*(NFM|Nerd Font Mono)'}).Count){return $true}
    }
    return $false
}
function Install-NaosTerminalPwsh([string]$File,[string]$Root,[bool]$PersistPath) {
    $dest=Join-Path $Root 'PowerShell-7.6.6'
    if(Test-Path $dest){
        if(-not(Test-NaosShell (Join-Path $dest 'pwsh.exe') '7.6.6')){throw 'EXISTING_PORTABLE_PWSH_UNHEALTHY'}
    }else{
        if(-not(Test-Path $Root)){New-Item -ItemType Directory -Path $Root -Force|Out-Null}
        $tmp=Join-Path $Root ('.pwsh-'+[guid]::NewGuid().ToString('N'))
        try{
            Expand-Archive -LiteralPath $File -DestinationPath $tmp -ErrorAction Stop
            if(-not(Test-NaosShell (Join-Path $tmp 'pwsh.exe') '7.6.6')){throw 'BUNDLED_PWSH_EXECUTION_FAILED'}
            Move-Item -LiteralPath $tmp -Destination $dest -ErrorAction Stop
        }finally{if(Test-Path $tmp){Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue}}
    }
    if(Get-Command Add-NaosPortablePath -ErrorAction SilentlyContinue){
        Add-NaosPortablePath $dest $PersistPath
    }elseif(-not @($env:PATH -split ';'|Where-Object{$_ -ieq $dest}).Count){$env:PATH=$dest+';'+$env:PATH}
    Write-Host ('[PASS] Microsoft PowerShell 7.6.6 portable: '+$dest)
    return (Join-Path $dest 'pwsh.exe')
}
function Install-NaosTerminalPosh([string]$Binary,[string]$Themes,[string]$Root,[bool]$PersistPath) {
    $dest=Join-Path $Root 'OhMyPosh-31.8.0'
    $exe=Join-Path $dest 'oh-my-posh.exe'
    $theme=Join-Path $dest 'themes\jandedobbeleer.omp.json'
    if(Test-Path $dest){
        if(-not(Test-Path $exe) -or -not(Test-Path $theme)){throw 'EXISTING_OH_MY_POSH_INSTALL_INCOMPLETE'}
    }else{
        if(-not(Test-Path $Root)){New-Item -ItemType Directory -Path $Root -Force|Out-Null}
        $tmp=Join-Path $Root ('.posh-'+[guid]::NewGuid().ToString('N'))
        try{
            New-Item -ItemType Directory -Path $tmp -Force|Out-Null
            Copy-Item -LiteralPath $Binary -Destination (Join-Path $tmp 'oh-my-posh.exe') -ErrorAction Stop
            Expand-Archive -LiteralPath $Themes -DestinationPath (Join-Path $tmp 'themes') -ErrorAction Stop
            $version=([string](& (Join-Path $tmp 'oh-my-posh.exe') version 2>$null)).Trim()
            if($LASTEXITCODE -ne 0 -or $version -ne '31.8.0'){throw 'BUNDLED_OH_MY_POSH_VERSION_INVALID'}
            if(-not(Test-Path (Join-Path $tmp 'themes\jandedobbeleer.omp.json'))){throw 'OH_MY_POSH_THEME_MISSING'}
            Move-Item -LiteralPath $tmp -Destination $dest -ErrorAction Stop
        }finally{if(Test-Path $tmp){Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue}}
    }
    if(Get-Command Add-NaosPortablePath -ErrorAction SilentlyContinue){Add-NaosPortablePath $dest $PersistPath}
    elseif(-not @($env:PATH -split ';'|Where-Object{$_ -ieq $dest}).Count){$env:PATH=$dest+';'+$env:PATH}
    Write-Host ('[PASS] Oh My Posh 31.8.0 portable: '+$dest)
    return [pscustomobject]@{Executable=$exe;Theme=$theme}
}
function Install-NaosTerminalFont([string]$Archive,[string]$ToolRoot) {
    if(Test-NaosInstalledNF){Write-Output '[PASS] JetBrainsMono NFM already present; no font changes.';return}
    $tar=Get-Command tar.exe -ErrorAction SilentlyContinue
    if(-not $tar){throw 'WINDOWS_TAR_REQUIRED_FOR_FONT'}
    $names=@('Regular','Bold','Italic','BoldItalic')
    $members=@($names|ForEach-Object{'JetBrainsMonoNerdFontMono-'+$_+'.ttf'})+@('OFL.txt')
    $temp=Join-Path $env:TEMP ('naos-font-stage-'+[guid]::NewGuid().ToString('N'))
    try{
        New-Item -Path $temp -ItemType Directory -Force|Out-Null
        & $tar.Source -xJf $Archive -C $temp @members
        if($LASTEXITCODE -ne 0){throw 'FONT_ARCHIVE_EXTRACTION_FAILED'}
        $fonts=Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts'
        $registry='HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts'
        if(-not(Test-Path $fonts)){New-Item -Path $fonts -ItemType Directory -Force|Out-Null}
        if(-not(Test-Path $registry)){New-Item -Path $registry -Force|Out-Null}
        foreach($name in $names){
            $filename='JetBrainsMonoNerdFontMono-'+$name+'.ttf'
            $src=Join-Path $temp $filename
            if(-not(Test-Path $src)){throw ('NFM_FILE_MISSING: '+$filename)}
            $dest=Join-Path $fonts $filename
            if(Test-Path $dest){
                if((Get-FileHash $dest -Algorithm SHA256).Hash -ne (Get-FileHash $src -Algorithm SHA256).Hash){throw ('FONT_FILE_ALREADY_EXISTS: '+$filename)}
            }else{Copy-Item -LiteralPath $src -Destination $dest -ErrorAction Stop}
            $keyName='JetBrainsMono NFM '+$name+' (TrueType)'
            $current=Get-ItemProperty -Path $registry -Name $keyName -ErrorAction SilentlyContinue
            if($current){
                if([string]$current.$keyName -ne $dest){throw ('FONT_REGISTRY_CONFLICT: '+$keyName)}
            }else{New-ItemProperty -Path $registry -Name $keyName -Value $dest -PropertyType String|Out-Null}
        }
        $licenses=Join-Path $ToolRoot 'licenses'
        if(-not(Test-Path $licenses)){New-Item -ItemType Directory -Path $licenses -Force|Out-Null}
        Copy-Item -LiteralPath (Join-Path $temp 'OFL.txt') -Destination (Join-Path $licenses 'JetBrainsMono-NerdFont-OFL.txt') -ErrorAction Stop
        Write-Output '[PASS] JetBrainsMono Nerd Font Mono installed for current Windows user.'
    }finally{if(Test-Path $temp){Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue}}
}
function Set-NaosWindowsTerminalDefault {
    param([string]$Pwsh,[string]$PoshExe,[string]$Theme,[bool]$Font,
          [string]$SettingsFile='', [string]$FragmentDir='',[string]$LaunchDir='')
    $guid='{0f0a2605-6ae4-4f5c-92ba-70bfb6aafe21}'
    if(-not $FragmentDir){$FragmentDir=Join-Path $env:LOCALAPPDATA 'Microsoft\Windows Terminal\Fragments\NaosAgentStack'}
    if(-not $LaunchDir){$LaunchDir=Join-Path $env:LOCALAPPDATA 'NaosAgentStack'}
    if(-not $SettingsFile){
        foreach($p in @((Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json'),
                        (Join-Path $env:LOCALAPPDATA 'Microsoft\Windows Terminal\settings.json'))){
            if(Test-Path -LiteralPath $p){$SettingsFile=$p;break}
        }
    }
    $command='"'+$Pwsh+'" -NoLogo'
    if($PoshExe){
        if(-not(Test-Path $LaunchDir)){New-Item -Path $LaunchDir -ItemType Directory -Force|Out-Null}
        $launcher=Join-Path $LaunchDir 'Launch-NaosPowerShell.ps1'
        if(Test-Path $launcher){
            $previous=[IO.File]::ReadAllText($launcher,[Text.Encoding]::UTF8)
            if($previous -notmatch 'Naos-owned PowerShell 7 launcher'){throw 'UNRECOGNIZED_POWERSHELL_LAUNCHER_REFUSE_OVERWRITE'}
            Copy-Item $launcher ($launcher+'.backup-'+(Get-Date -Format yyyyMMddHHmmss)) -ErrorAction Stop
        }
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Launch-NaosPowerShell.ps1') -Destination $launcher -Force
        [IO.File]::WriteAllText((Join-Path $LaunchDir 'terminal-tools.json'),(@{posh=$PoshExe;theme=$Theme}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
        $command+=' -NoExit -File "'+$launcher+'"'
    }
    $profile=[ordered]@{guid=$guid;name='Naos PowerShell 7';commandline=$command}
    if($Font){$profile.font=@{face='JetBrainsMono NFM'}}
    $data=@{profiles=@($profile)}|ConvertTo-Json -Depth 6
    if(-not(Test-Path $FragmentDir)){New-Item -Path $FragmentDir -ItemType Directory -Force|Out-Null}
    $fragment=Join-Path $FragmentDir 'PowerShell.json'
    if(Test-Path $fragment){Copy-Item $fragment ($fragment+'.backup-'+(Get-Date -Format yyyyMMddHHmmss)) -ErrorAction Stop}
    [IO.File]::WriteAllText($fragment,$data,[Text.UTF8Encoding]::new($false))
    Write-Output '[PASS] Added Naos PowerShell 7 Terminal profile fragment (other profiles unchanged).'
    if(-not $SettingsFile -or -not(Test-Path -LiteralPath $SettingsFile)){
        Write-Output '[WARN] Windows Terminal not detected; set Naos PowerShell 7 as default in Terminal Settings > Startup after installation.'
        return
    }
    $raw=[IO.File]::ReadAllText($SettingsFile,[Text.Encoding]::UTF8)
    $regex=[regex]'(?m)^(?<indent>[ \t]*)"defaultProfile"(?<gap>[ \t]*:[ \t]*)"(?<value>\{[A-Fa-f0-9-]+\})"'
    $matches=$regex.Matches($raw)
    if($matches.Count -ne 1){
        Write-Output '[WARN] Terminal defaultProfile ambiguous/missing: settings left unchanged; choose Naos PowerShell 7 in Settings > Startup.'
        return
    }
    $replacement='$'+'{indent}"defaultProfile"$'+'{gap}"'+$guid+'"'
    $modified=$regex.Replace($raw,$replacement,1)
    if($modified -ceq $raw){Write-Output '[PASS] Terminal default profile is already Naos PowerShell 7.';return}
    $candidate=Join-Path $env:TEMP ('naos-terminal-settings-'+[guid]::NewGuid().ToString('N')+'.json')
    try{
        [IO.File]::WriteAllText($candidate,$modified,[Text.UTF8Encoding]::new($false))
        foreach($testFile in @($SettingsFile,$candidate)){
            & $Pwsh -NoProfile -NonInteractive -File (Join-Path $PSScriptRoot 'Terminal-Json-Validate.ps1') -Path $testFile
            if($LASTEXITCODE -ne 0){throw ('TERMINAL_JSONC_INVALID_REFUSE_MODIFICATION: '+$testFile)}
        }
        $backup=$SettingsFile+'.naos-backup-'+(Get-Date -Format yyyyMMddHHmmssfff)
        Copy-Item -LiteralPath $SettingsFile -Destination $backup -ErrorAction Stop
        [IO.File]::WriteAllText($SettingsFile,$modified,[Text.UTF8Encoding]::new($false))
        Write-Output ('[PASS] Windows Terminal default profile is now PowerShell 7. Backup: '+$backup)
    }finally{if(Test-Path $candidate){Remove-Item $candidate -Force -ErrorAction SilentlyContinue}}
}
function Invoke-NaosTerminalSetup {
    [CmdletBinding()]
    param(
        [ValidateSet('Plan','Preflight','Apply')][string]$Mode='Plan',
        [switch]$PowerShell7,[switch]$OhMyPosh,[switch]$NerdFont,[switch]$TerminalDefault,
        [string]$AssetsRoot=(Join-Path $PSScriptRoot 'payload\terminal'),
        [string]$ToolsRoot=(Join-Path $env:LOCALAPPDATA 'NaosAgentStack\tools'),
        [bool]$PersistUserPath=$true,
        [string]$SettingsFile='', [string]$FragmentDir='',[string]$LaunchDir='',
        [switch]$ForceBundled
    )
    if(-not($PowerShell7 -or $OhMyPosh -or $NerdFont -or $TerminalDefault)){return}
    if($env:PROCESSOR_ARCHITECTURE -ne 'AMD64'){throw 'TERMINAL_ADDON_WINDOWS_X64_ONLY'}
    $lock=Get-NaosTerminalLock
    $cmd=Get-NaosExistingShell
    $portable=Join-Path $ToolsRoot 'PowerShell-7.6.6'
    $havePortable=Test-NaosShell (Join-Path $portable 'pwsh.exe') '7.6.6'
    $wantPwsh=($PowerShell7 -or $TerminalDefault) -and ($ForceBundled -or (-not $cmd -and -not $havePortable))
    $poshRoot=Join-Path $ToolsRoot 'OhMyPosh-31.8.0'
    $poshExists=Test-Path (Join-Path $poshRoot 'themes\jandedobbeleer.omp.json')
    $wantPosh=$OhMyPosh -and ($ForceBundled -or -not $poshExists)
    $wantFont=$NerdFont -and -not(Test-NaosInstalledNF)
    $assets=New-Object System.Collections.Generic.List[object]
    if($wantPwsh){$assets.Add($lock.pwsh)}
    if($wantPosh){$assets.Add($lock.posh);$assets.Add($lock.themes)}
    if($wantFont){$assets.Add($lock.nerdFont)}
    if($Mode -eq 'Plan'){
        Write-Output ('[INFO] Terminal add-on: pwsh='+[bool]$PowerShell7+' oh-my-posh='+[bool]$OhMyPosh+' JetBrainsMono NFM='+[bool]$NerdFont+' default PowerShell='+[bool]$TerminalDefault)
        foreach($item in $assets){
            $present=Test-Path -LiteralPath (Join-Path $AssetsRoot $item.file)
            Write-Output ('[INFO] '+$item.file+': '+$(if($present){'bundled'}else{'requires optional Terminal add-on ZIP'}))
        }
        Write-Output '[PASS] TERMINAL_PLAN_ONLY_NO_CHANGES'
        return
    }
    $verified=@{}
    foreach($item in $assets){$verified[[string]$item.file]=Assert-NaosTerminalAsset $AssetsRoot $item}
    if($TerminalDefault -and -not ($wantPwsh -or $cmd -or $havePortable)){throw 'PWSH_REQUIRED_TO_SET_TERMINAL_DEFAULT'}
    if($wantFont -and -not(Get-Command tar.exe -ErrorAction SilentlyContinue)){throw 'WINDOWS_TAR_REQUIRED'}
    if($Mode -eq 'Preflight'){Write-Output '[PASS] TERMINAL_ADDON_PREFLIGHT_OK';return}
    $pwshPath=if($havePortable){Join-Path $portable 'pwsh.exe'}else{$cmd}
    $poshExe=''
    $theme=''
    if($wantPwsh){
        $pwshPath=Install-NaosTerminalPwsh $verified[[string]$lock.pwsh.file] $ToolsRoot $PersistUserPath
    }
    if($OhMyPosh){
        if($wantPosh){
            $posh=Install-NaosTerminalPosh $verified[[string]$lock.posh.file] $verified[[string]$lock.themes.file] $ToolsRoot $PersistUserPath
        }else{
            $posh=[pscustomobject]@{Executable=(Join-Path $poshRoot 'oh-my-posh.exe');Theme=(Join-Path $poshRoot 'themes\jandedobbeleer.omp.json')}
        }
        $poshExe=$posh.Executable;$theme=$posh.Theme
    }
    if($wantFont){Install-NaosTerminalFont $verified[[string]$lock.nerdFont.file] $ToolsRoot}
    if($TerminalDefault){
        Set-NaosWindowsTerminalDefault -Pwsh $pwshPath -PoshExe $poshExe -Theme $theme -Font ([bool]$NerdFont) -SettingsFile $SettingsFile -FragmentDir $FragmentDir -LaunchDir $LaunchDir
    }
    Write-Output '[PASS] TERMINAL_ADDON_INSTALL_COMPLETE'
}
