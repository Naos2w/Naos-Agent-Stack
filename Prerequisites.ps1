# Naos Agent Stack - self-contained optional Windows x64 tool prerequisites.
# Node/npm are required for first install; MinGit is optional and installed only with -InstallGit.
# This module only declares functions and has no side effects when dot-sourced.
Set-StrictMode -Version Latest

function Get-NaosPrerequisiteDefinition([string]$Name) {
    switch ($Name) {
        'node' {
            return [pscustomobject]@{
                Name='Node.js'; Version='22.20.0'; Archive='node-v22.20.0-win-x64.zip';
                Sha256='BB819D6EB8F5BFDA294BBC83A7E4EC6539DA67C4233D54B0D655B9248B15E29D';
                Root='node-v22.20.0-win-x64'; Directory='node-v22.20.0';
                Executable='node.exe'; BinRelative=''; ExpectedVersion='v22.20.0'
            }
        }
        'git' {
            return [pscustomobject]@{
                Name='MinGit'; Version='2.56.0.2'; Archive='MinGit-2.56.0.2-64-bit.zip';
                Sha256='DA35E72AA21C005A5A0D298CFBAE110BC1609A815730EA0DDE84B01A1B3CD3BE';
                Root=''; Directory='mingit-2.56.0.2';
                Executable='git.exe'; BinRelative='cmd'; ExpectedVersion='git version 2.56.0.windows.2'
            }
        }
        default { throw ('Unknown dependency '+$Name) }
    }
}

function Test-NaosSystemNode {
    $exe=Get-Command node.exe -ErrorAction SilentlyContinue
    $npm=Get-Command npm.cmd -ErrorAction SilentlyContinue
    if(-not $exe -or -not $npm){return $false}
    try {
        $version=([string](& $exe.Source --version 2>$null)).Trim().TrimStart('v')
        $parsed=[version]$version
        if($parsed -lt [version]'22.19.0'){return $false}
        $npmVersion=([string](& $npm.Source --version 2>$null)).Trim()
        return ($LASTEXITCODE -eq 0 -and $npmVersion -match '^\d+\.\d+\.\d+')
    }catch{return $false}
}

function Test-NaosSystemGit {
    $exe=Get-Command git.exe -ErrorAction SilentlyContinue
    if(-not $exe){return $false}
    try{
        $output=[string](& $exe.Source --version 2>$null)
        return ($LASTEXITCODE -eq 0 -and $output -match '^git version \d+\.\d+')
    }catch{return $false}
}

function Assert-NaosTrustedArchive([string]$Path,[string]$Sha256) {
    if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){
        throw ('OFFLINE_DEPENDENCY_MISSING: '+[IO.Path]::GetFileName($Path))
    }
    $actual=(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    if($actual -ne $Sha256){throw ('OFFLINE_DEPENDENCY_HASH_MISMATCH: '+[IO.Path]::GetFileName($Path))}
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip=[IO.Compression.ZipFile]::OpenRead($Path)
    try{
        $size=[long]0
        foreach($entry in $zip.Entries){
            $name=$entry.FullName.Replace('\','/')
            if($name.StartsWith('/') -or $name -match '(^|/)\.\.(/|$)|:|(^|/)\.ssh(/|$)'){
                throw ('UNSAFE_DEPENDENCY_ZIP_PATH: '+$name)
            }
            $size += [long]$entry.Length
            if($size -gt 1073741824){throw 'DEPENDENCY_ARCHIVE_TOO_LARGE'}
        }
    }finally{$zip.Dispose()}
}

function Test-NaosInstalledTool([string]$Name,[string]$Root) {
    $spec=Get-NaosPrerequisiteDefinition $Name
    $bin=if($spec.BinRelative){Join-Path $Root $spec.BinRelative}else{$Root}
    $exe=Join-Path $bin $spec.Executable
    if(-not(Test-Path -LiteralPath $exe -PathType Leaf)){return $false}
    try{
        $version=([string](& $exe --version 2>$null)).Trim()
        if($LASTEXITCODE -ne 0 -or $version -ne $spec.ExpectedVersion){return $false}
        if($Name -eq 'node') {
            $npm=Join-Path $Root 'npm.cmd'
            if(-not(Test-Path -LiteralPath $npm -PathType Leaf)){return $false}
            $npmVersion=([string](& $npm --version 2>$null)).Trim()
            return ($LASTEXITCODE -eq 0 -and $npmVersion -match '^\d+\.\d+\.\d+')
        }
        return $true
    }catch{return $false}
}

function Add-NaosPortablePath([string]$Path,[bool]$Persist) {
    $elements=@($env:Path -split ';'|Where-Object{$_})
    if(-not @($elements|Where-Object {$_ -ieq $Path}).Count){
        $env:Path=$Path+';'+$env:Path
    }
    if($Persist){
        $old=[Environment]::GetEnvironmentVariable('Path','User')
        $oldParts=@([string]$old -split ';'|Where-Object{$_})
        if(-not @($oldParts|Where-Object {$_ -ieq $Path}).Count){
            [Environment]::SetEnvironmentVariable('Path',($Path+';'+[string]$old).TrimEnd(';'),'User')
        }
    }
}

function Install-NaosPortablePrerequisite {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][ValidateSet('node','git')][string]$Name,
        [Parameter(Mandatory=$true)][string]$PackageRoot,
        [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'NaosAgentStack\tools'),
        [bool]$PersistUserPath=$true,
        [switch]$ForceBundled
    )
    if($env:PROCESSOR_ARCHITECTURE -ne 'AMD64'){
        throw 'ARCHITECTURE_UNSUPPORTED: This offline dependency payload is Windows x64 only.'
    }
    $available=if($Name -eq 'node'){Test-NaosSystemNode}else{Test-NaosSystemGit}
    if($available -and -not $ForceBundled){
        Write-Output ('[PASS] '+$Name+' already available; no portable installation required.')
        return
    }
    $spec=Get-NaosPrerequisiteDefinition $Name
    $archive=Join-Path $PackageRoot $spec.Archive
    Assert-NaosTrustedArchive $archive $spec.Sha256
    $destination=Join-Path $InstallRoot $spec.Directory
    if(Test-Path -LiteralPath $destination) {
        if(-not(Test-NaosInstalledTool $Name $destination)){
            throw ('EXISTING_PORTABLE_TOOL_UNHEALTHY_REFUSING_OVERWRITE: '+$destination)
        }
    }else{
        if(-not(Test-Path -LiteralPath $InstallRoot)){New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null}
        $scratch=Join-Path $InstallRoot ('.install-'+$Name+'-'+[guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $scratch -Force | Out-Null
        try {
            Expand-Archive -LiteralPath $archive -DestinationPath $scratch -ErrorAction Stop
            $candidate=if($spec.Root){Join-Path $scratch $spec.Root}else{$scratch}
            if(-not(Test-NaosInstalledTool $Name $candidate)){
                throw ('OFFLINE_DEPENDENCY_EXECUTION_FAILED: '+$Name)
            }
            Move-Item -LiteralPath $candidate -Destination $destination -ErrorAction Stop
        } finally {
            if(Test-Path -LiteralPath $scratch){Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue}
        }
    }
    $bin=if($spec.BinRelative){Join-Path $destination $spec.BinRelative}else{$destination}
    Add-NaosPortablePath $bin $PersistUserPath
    if(-not(Test-NaosInstalledTool $Name $destination)){
        throw ('DEPENDENCY_INSTALLED_BUT_INVALID: '+$Name)
    }
    Write-Output ('[PASS] Installed verified portable '+$spec.Name+' v'+$spec.Version+' to '+$destination)
    if($PersistUserPath){Write-Output '[INFO] Updated current-user PATH. Reopen PowerShell to see it in a new session.'}
}

function Assert-NaosInstallPrerequisites {
    [CmdletBinding()]
    param(
        [string]$PackageRoot=(Join-Path $PSScriptRoot 'payload\prerequisites'),
        [switch]$IncludeGit,
        [string]$InstallRoot=(Join-Path $env:LOCALAPPDATA 'NaosAgentStack\tools'),
        [bool]$PersistUserPath=$true,
        [switch]$ForceBundled
    )
    Install-NaosPortablePrerequisite -Name node -PackageRoot $PackageRoot -InstallRoot $InstallRoot -PersistUserPath $PersistUserPath -ForceBundled:$ForceBundled
    if($IncludeGit){
        Install-NaosPortablePrerequisite -Name git -PackageRoot $PackageRoot -InstallRoot $InstallRoot -PersistUserPath $PersistUserPath -ForceBundled:$ForceBundled
    }
    if(-not(Test-NaosSystemNode)){throw 'NODE_NPM_NOT_READY_AFTER_PREPARATION'}
    if($IncludeGit -and -not(Test-NaosSystemGit)){throw 'GIT_NOT_READY_AFTER_PREPARATION'}
}
