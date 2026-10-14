# Naos-owned PowerShell 7 launcher; never modifies the user's $PROFILE.
$ErrorActionPreference='Continue'
$config=Join-Path $PSScriptRoot 'terminal-tools.json'
if(Test-Path -LiteralPath $config){
    try {
        $tools=Get-Content -LiteralPath $config -Raw -Encoding UTF8|ConvertFrom-Json
        if((Test-Path -LiteralPath ([string]$tools.posh)) -and
           (Test-Path -LiteralPath ([string]$tools.theme))){
            $init=(& ([string]$tools.posh) init pwsh --config ([string]$tools.theme) 2>$null) -join [Environment]::NewLine
            if($LASTEXITCODE -eq 0 -and $init){Invoke-Expression $init}
        }
    }catch{
        Write-Warning 'Oh My Posh initialization skipped; ordinary PowerShell remains available.'
    }
}
