# Naos Agent Stack v0.2 - unified Windows PowerShell entrypoint.
# install | plan | doctor | help
[CmdletBinding()]
param(
    [Parameter(Position=0)][Alias('Mode','Action')]
    [ValidateSet('install','plan','doctor','help')][string]$Command='doctor',
    [ValidateSet('auto','single','host','client','existing')][string]$Role='auto',
    [switch]$Sharing,
    [switch]$NoSharing,
    [switch]$NoCore,
    [switch]$InstallOpenSSH,
    [switch]$ScanProjects,
    [switch]$Deep,
    [switch]$Json,
    [switch]$Strict,
    [switch]$Yes,
    [string]$LettaRoot='',
    [string]$HostIp='',
    [string]$PeerIp='',
    [string]$SshUser='',
    [string]$KeyPath='',
    [string]$PublicKeyPath='',
    [string]$ProjectRoot='',
    [string]$ExtraRoot='',
    [int]$SshPort=2222,
    [int]$LocalPort=4501,
    [int]$RemotePort=4500
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$engine=Join-Path $PSScriptRoot 'Engine.ps1'
$doctor=Join-Path $PSScriptRoot 'Doctor.ps1'

if($Command -eq 'help') {
    @'
Naos Agent Stack v0.2.0 - Windows PowerShell installer

Usage:
  .\naos-agent-stack.ps1 doctor [-Deep] [-Json] [-Strict]
  .\naos-agent-stack.ps1 plan -Role single
  .\naos-agent-stack.ps1 install -Role single [-Yes]
  .\naos-agent-stack.ps1 plan -Role host -HostIp HOST_TAILNET_IP -PeerIp PC2_TAILNET_IP -SshUser WINDOWS_USER
  .\naos-agent-stack.ps1 install -Role host -HostIp HOST_IP -PeerIp PC2_IP -SshUser WINDOWS_USER -PublicKeyPath PATH_TO_PUBKEY [-InstallOpenSSH] [-Yes]
  .\naos-agent-stack.ps1 plan -Role client -HostIp HOST_TAILNET_IP -SshUser WINDOWS_USER [-NoCore]
  .\naos-agent-stack.ps1 install -Role client -HostIp HOST_IP -SshUser WINDOWS_USER -KeyPath PATH_TO_KEY [-NoCore] [-Yes]
  .\naos-agent-stack.ps1 doctor -Role client -Deep -ProjectRoot C:\Projects -ExtraRoot C:\OtherProjects

Options:
  install     Only execute with confirmation or -Yes; never requests reboot.
  plan        Read-only installation plan, never modifies any settings.
  doctor      Read-only health check with PASS/WARN/FAIL, returns nonzero on FAIL.
  -Deep       Verify existing shared Letta Agent/Project bindings against Git remotes.
  -Json       Emit machine-readable doctor report.
  -Strict     Treat doctor warnings as a failure exit.
  -NoCore     Configure sharing using an already installed Headless core.
  -NoSharing  Use only core install; no SSH/Tailscale configuration.
  -ScanProjects -ProjectRoot PATH [-ExtraRoot PATH]  Read-only Git checkout discovery.
  -Yes        Explicitly approve installer configuration changes.

Double-computer sharing requires separately configured Tailscale, SSH host key
trust, and ssh-agent (client). OAuth and credentials are not copied between PCs.
Do not treat Letta Agent memory sharing as Git/file synchronization.
'@ | Write-Output
    exit 0
}
if(-not(Test-Path $engine -PathType Leaf)){throw 'Engine.ps1 not found'}
if(-not(Test-Path $doctor -PathType Leaf)){throw 'Doctor.ps1 not found'}

$targetRole=if($Role -eq 'auto'){if($Command -eq 'doctor'){'auto'}else{'single'}}else{$Role}
if($Command -eq 'doctor'){
    $opts=@{
        Role=$targetRole
        Deep=$Deep
        Json=$Json
        Strict=$Strict
        LocalPort=$LocalPort
        HostSshPort=$SshPort
        ProjectRoot=$ProjectRoot
        ExtraRoot=$ExtraRoot
    }
    & $doctor @opts
    exit $LASTEXITCODE
}
$engineRole=if($targetRole -eq 'auto'){'single'}else{$targetRole}
$roleUsesSharing=$engineRole -in @('host','client')
$share=$roleUsesSharing -and -not $NoSharing
if($Sharing -and $NoSharing){throw 'Choose either -Sharing or -NoSharing, not both.'}
if($Sharing){$share=$true}
if($engineRole -in @('single','existing') -and $share){
    throw 'Sharing requires -Role host or -Role client'
}
$core=($engineRole -ne 'existing' -and -not $NoCore)
if($InstallOpenSSH -and $engineRole -ne 'host'){
    throw '-InstallOpenSSH is only valid for -Role host'
}
if($Command -eq 'install' -and $engineRole -eq 'host' -and $share) {
    # Requiring explicit public-key preflight before changing firewall/service.
    if(-not $PublicKeyPath -and -not(Test-Path (Join-Path $env:ProgramData 'ssh\administrators_authorized_keys'))){
        throw 'Host needs -PublicKeyPath pointing to an authorized .pub key, or an existing authorized key file.'
    }
}
$opts=@{
    Mode=if($Command -eq 'plan'){'Plan'}else{'Apply'}
    Role=$engineRole
    InstallCore=$core
    ConfigureSharing=$share
    InstallOpenSSH=$InstallOpenSSH
    ScanProjects=$ScanProjects
    HostIp=$HostIp
    PeerIp=$PeerIp
    SshUser=$SshUser
    LettaRoot=$LettaRoot
    KeyPath=$KeyPath
    PublicKeyPath=$PublicKeyPath
    ProjectRoot=$ProjectRoot
    ExtraRoot=$ExtraRoot
    SshPort=$SshPort
    LocalPort=$LocalPort
    RemotePort=$RemotePort
}
if($Command -eq 'plan'){
    & $engine @opts
    exit 0
}
Write-Output 'Naos Agent Stack INSTALL: the selected modules can modify Windows configuration.'
Write-Output ('Role='+$engineRole+' InstallCore='+$core+' ConfigureSharing='+$share)
if(-not $Yes){
    $answer=Read-Host "Type INSTALL to apply the selected options"
    if($answer -cne 'INSTALL'){Write-Output 'Cancelled: no settings modified.';exit 1}
}
& $engine @opts
Write-Output 'Run .\naos-agent-stack.ps1 doctor -Deep after installation.'
exit 0
