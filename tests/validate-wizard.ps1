# Read-only PowerShell 5.1 tests for the interactive option selector.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'Install-Wizard.ps1')

function Assert-NaosTest([bool]$Condition,[string]$Message) {
    if(-not $Condition){throw ('WIZARD_TEST_FAILED: '+$Message)}
}
function New-NaosMockAnswerReader([string[]]$Answers) {
    $queue=New-Object System.Collections.Queue
    foreach($value in $Answers){$queue.Enqueue($value)}
    return {param([string]$Question)
        if($queue.Count -eq 0){throw ('UNEXPECTED_WIZARD_PROMPT: '+$Question)}
        return [string]$queue.Dequeue()
    }.GetNewClosure()
}

# A brand-new Windows computer: required core, Git and sharing unselected by default.
$reader=New-NaosMockAnswerReader @('','','','')
$single=Invoke-NaosSetupWizard -Role auto -CoreInstalled:$false -GitInstalled:$false -Ask $reader
Assert-NaosTest ($single.Role -eq 'single' -and -not $single.NoCore -and -not $single.InstallGit -and -not $single.ConfigureSharing -and -not $single.ScanProjects) 'clean default must be core only, no optional components'
Write-Output '[PASS] Wizard defaults: mandatory core + Node/npm, optional Git and sharing disabled'

# Explicit yes enables optional Git; never forces two-machine setup.
$reader=New-NaosMockAnswerReader @('1','y','n','n')
$withGit=Invoke-NaosSetupWizard -Role auto -GitInstalled:$false -Ask $reader
Assert-NaosTest ($withGit.InstallGit -and -not $withGit.ConfigureSharing) 'optional Git choice must be respected'
Write-Output '[PASS] Wizard optional MinGit can be selected independently'

# A sharing host without sshd requires Windows OpenSSH Server.
$reader=New-NaosMockAnswerReader @('2','n','n','n')
$hostOptions=Invoke-NaosSetupWizard -Role auto -GitInstalled:$false -SshdInstalled:$false -HasAuthorizedKey:$false -HostIp '100.64.20.1' -PeerIp '100.64.20.2' -SshUser 'ciuser' -PublicKeyPath 'C:\fixture\pubkey.pub' -Ask $reader
Assert-NaosTest ($hostOptions.Role -eq 'host' -and $hostOptions.ConfigureSharing -and $hostOptions.InstallOpenSSH -and -not $hostOptions.InstallGit) 'hosting should require sshd, but Git must remain optional'
Write-Output '[PASS] Wizard host selects required OpenSSH, not optional Git'

# A shared-memory client reuses its supplied SSH identity settings.
$reader=New-NaosMockAnswerReader @('3','n','n','n')
$client=Invoke-NaosSetupWizard -Role auto -HostIp '100.64.40.3' -SshUser 'ciuser' -KeyPath 'C:\fixture\id_ed25519' -Ask $reader
Assert-NaosTest ($client.Role -eq 'client' -and $client.ConfigureSharing -and -not $client.InstallOpenSSH -and $client.KeyPath -eq 'C:\fixture\id_ed25519') 'client must not install Windows sshd'
Write-Output '[PASS] Wizard client requires no SSH Server installation'

# Existing core can be selected for maintenance without reinstalling anything.
$reader=New-NaosMockAnswerReader @('4','n','n')
$existing=Invoke-NaosSetupWizard -Role auto -CoreInstalled:$true -GitInstalled:$true -Ask $reader
Assert-NaosTest ($existing.Role -eq 'existing' -and $existing.NoCore -and -not $existing.InstallGit) 'existing mode must skip core, not change Git'
Write-Output '[PASS] Wizard existing-core mode skips reinstallation'

# Optional read-only project discovery is independent of Git installation.
$reader=New-NaosMockAnswerReader @('1','n','y',$root,'','n')
$scan=Invoke-NaosSetupWizard -Role auto -GitInstalled:$false -Ask $reader
Assert-NaosTest ($scan.ScanProjects -and $scan.ProjectRoot -eq $root -and -not $scan.InstallGit) 'directory scan must remain optional'
Write-Output '[PASS] Wizard optional project scan selection'

# The terminal kit is entirely optional and selects its individual parts only after opting in.
$reader=New-NaosMockAnswerReader @('1','n','n','y','','','','')
$term=Invoke-NaosSetupWizard -Role auto -GitInstalled:$false -Ask $reader
Assert-NaosTest ($term.PowerShell7 -and $term.OhMyPosh -and $term.NerdFont -and $term.TerminalDefault -and -not $term.InstallGit) 'terminal group should be independent of Git and select all four parts'
Write-Output '[PASS] Wizard optional PowerShell, Oh My Posh, Nerd Font and Terminal defaults'

# Bad Tailnet IP must be rejected before any installation.
$refused=$false
try{
    $reader=New-NaosMockAnswerReader -Answers @()
    $null=Invoke-NaosSetupWizard -Role host -HostIp '192.168.0.1' -PeerIp '100.64.1.2' -SshUser 'ciuser' -GitExplicit:$true -ScanExplicit:$true -Ask $reader
}catch{if($_.Exception.Message -match 'TAILSCALE_IPV4_REQUIRED'){$refused=$true}else{throw}}
Assert-NaosTest $refused 'invalid sharing host address was accepted'
Write-Output '[PASS] Wizard rejects non-Tailnet shared-memory host'

# Core cannot be skipped on a brand-new computer.
$refused=$false
try {
    $reader=New-NaosMockAnswerReader -Answers @()
    $null=Invoke-NaosSetupWizard -Role single -NoCore:$true -GitExplicit:$true -ScanExplicit:$true -Ask $reader
}catch{if($_.Exception.Message -match 'NOCORE_NOT_ALLOWED_ON_CLEAN_MACHINE'){$refused=$true}else{throw}}
Assert-NaosTest $refused 'clean-machine core must not be optional'
Write-Output '[PASS] Wizard enforces required core on a clean PC'

# Cancelling the very first menu leaves the installer unselected, with no side effects.
$cancelled=$false
try {
    $reader=New-NaosMockAnswerReader @('0')
    $null=Invoke-NaosSetupWizard -Role auto -Ask $reader
}catch{if($_.Exception.Message -match 'WIZARD_CANCELLED'){$cancelled=$true}else{throw}}
Assert-NaosTest $cancelled 'explicit wizard cancellation was not respected'
Write-Output '[PASS] Wizard cancellation stops before installation'

# OpenSSH is mandatory only after selecting the sharing host role when sshd is absent.
$refused=$false
try {
    $reader=New-NaosMockAnswerReader -Answers @()
    $null=Invoke-NaosSetupWizard -Role host -GitExplicit:$true -ScanExplicit:$true -OpenSshExplicit:$true -InstallOpenSSH:$false -SshdInstalled:$false -HostIp '100.64.1.1' -PeerIp '100.64.1.2' -SshUser 'ciuser' -PublicKeyPath 'C:\fixture\pubkey.pub' -Ask $reader
}catch{if($_.Exception.Message -match 'OPENSSH_SERVER_REQUIRED_FOR_SHARED_HOST'){$refused=$true}else{throw}}
Assert-NaosTest $refused 'sharing host without sshd must not proceed'
Write-Output '[PASS] Wizard host enforces necessary SSH Server without making Git mandatory'

# The real entrypoint invokes the wizard in read-only plan mode.
# Override Read-Host only within a disposable child PowerShell.
$entry=Join-Path $root 'naos-agent-stack.ps1'
$scriptTemplate=@'
function global:Read-Host { param([string]$Prompt) if ($Prompt -match '\[1\]') { return '1' } else { return 'n' } }
& '__ENTRY__' plan -Interactive -InstallGit:$false -ScanProjects:$false
if ($LASTEXITCODE -ne 0) { exit 91 }
exit 0
'@
$script=$scriptTemplate.Replace('__ENTRY__',$entry.Replace("'","''"))
$encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
$output=@(& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $encoded 2>&1)
$status=$LASTEXITCODE
Assert-NaosTest ($status -eq 0 -and $output -match 'PLAN_ONLY_NO_CHANGES') ('interactive plan did not complete read-only; exit='+$status)
Write-Output '[PASS] Entrypoint plan -Interactive performs a read-only preview'

Write-Output 'WIZARD_VALIDATION_PASSED'
exit 0
