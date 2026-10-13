# Naos Agent Stack - interactive selection only; no installer side effects.
# Windows PowerShell 5.1 compatible.
Set-StrictMode -Version Latest

function Read-NaosSetupChoice {
    param(
        [scriptblock]$Ask,
        [string]$Prompt,
        [string[]]$Valid,
        [string]$Default
    )
    for($attempt=0;$attempt -lt 3;$attempt++){
        $raw=& $Ask $Prompt
        if($null -eq $raw){throw 'WIZARD_INPUT_UNAVAILABLE: For automation use explicit options and -Yes.'}
        $choice=([string]$raw).Trim()
        if(-not $choice){$choice=$Default}
        if($Valid -contains $choice){return $choice.ToLowerInvariant()}
        Write-Host '輸入無效，請選擇畫面上的選項。'
    }
    throw 'WIZARD_INVALID_CHOICE: no changes made.'
}
function Read-NaosSetupValue {
    param([scriptblock]$Ask,[string]$Prompt,[string]$Default='',[bool]$Required=$true)
    for($attempt=0;$attempt -lt 3;$attempt++){
        $raw=& $Ask $Prompt
        if($null -eq $raw){throw 'WIZARD_INPUT_UNAVAILABLE'}
        $text=([string]$raw).Trim()
        if(-not $text){$text=$Default}
        if($text -or -not $Required){return $text}
        Write-Host '這是必要欄位，請輸入後繼續。'
    }
    throw 'WIZARD_REQUIRED_INPUT_MISSING'
}
function Assert-NaosTailnetAddress([string]$Address) {
    $parsed=$null
    if(-not [Net.IPAddress]::TryParse($Address,[ref]$parsed)){throw 'INVALID_TAILSCALE_IP'}
    if($parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork){throw 'TAILSCALE_IPV4_REQUIRED'}
    $octets=$parsed.GetAddressBytes()
    if($octets[0] -ne 100 -or $octets[1] -lt 64 -or $octets[1] -gt 127){
        throw 'TAILSCALE_IPV4_REQUIRED: 100.64.0.0/10'
    }
}

function Invoke-NaosSetupWizard {
    [CmdletBinding()]
    param(
        [ValidateSet('auto','single','host','client','existing')][string]$Role='auto',
        [bool]$CoreInstalled=$false,
        [bool]$CorePartial=$false,
        [bool]$GitInstalled=$false,
        [bool]$SshdInstalled=$false,
        [bool]$HasAuthorizedKey=$false,
        [bool]$InstallGit=$false,
        [bool]$GitExplicit=$false,
        [bool]$ScanProjects=$false,
        [bool]$ScanExplicit=$false,
        [bool]$SharingExplicit=$false,
        [bool]$ConfigureSharing=$false,
        [bool]$OpenSshExplicit=$false,
        [bool]$InstallOpenSSH=$false,
        [bool]$NoCore=$false,
        [string]$HostIp='',
        [string]$PeerIp='',
        [string]$SshUser='',
        [string]$PublicKeyPath='',
        [string]$KeyPath='',
        [string]$ProjectRoot='',
        [string]$ExtraRoot='',
        [scriptblock]$Ask={param([string]$prompt) Read-Host $prompt}
    )
    if($CorePartial){throw 'PARTIAL_CORE_DETECTED: repair is required, no changes made.'}
    Write-Host ''
    Write-Host '===== Naos Agent Stack v0.2.1 安裝選單 ====='
    Write-Host '[必要] OpenChatX Headless / Letta 核心；Node.js 和 npm 不存在時自動安裝。'
    if($CoreInstalled){Write-Host '[已存在] 核心已安裝，會保留而不覆蓋。'}
    Write-Host '[選配] Git 命令列、雙電腦 Letta 記憶共享、Git 目錄唯讀掃描。'
    Write-Host '注意：npm 套件依賴仍需要網際網路。'
    Write-Host ''

    if($Role -eq 'auto'){
        Write-Host '1. 單機模式（預設；無 SSH / Tailscale）'
        Write-Host '2. 雙電腦共享：Letta 主機'
        Write-Host '3. 雙電腦共享：Letta 用戶端'
        if($CoreInstalled){Write-Host '4. 僅維護已安裝核心'}
        Write-Host '0. 取消'
        $valid=if($CoreInstalled){@('0','1','2','3','4')}else{@('0','1','2','3')}
        $choice=Read-NaosSetupChoice -Ask $Ask -Prompt '安裝模式 [1]' -Valid $valid -Default '1'
        switch($choice){
            '0' {throw 'WIZARD_CANCELLED: no changes made.'}
            '1' {$Role='single'}
            '2' {$Role='host'}
            '3' {$Role='client'}
            '4' {$Role='existing'}
        }
    }
    if($Role -eq 'existing' -and -not $CoreInstalled){
        throw 'EXISTING_MODE_REQUIRES_INSTALLED_CORE'
    }
    if($NoCore -and -not $CoreInstalled){
        throw 'NOCORE_NOT_ALLOWED_ON_CLEAN_MACHINE'
    }
    $share=($Role -in @('host','client'))
    if($SharingExplicit){$share=$ConfigureSharing}
    if($share -and $Role -notin @('host','client')){
        throw 'SHARING_REQUIRES_HOST_OR_CLIENT_ROLE'
    }

    if(-not $GitExplicit){
        if($GitInstalled){
            Write-Host '[已安裝] Git：不重新安裝。'
            $InstallGit=$false
        }else{
            $selection=Read-NaosSetupChoice -Ask $Ask -Prompt '選配：安裝 Git CLI (MinGit)？ [y/N]' -Valid @('y','n') -Default 'n'
            $InstallGit=($selection -eq 'y')
        }
    }
    if(-not $ScanExplicit){
        $selection=Read-NaosSetupChoice -Ask $Ask -Prompt '選配：唯讀掃描現有 Git 專案目錄？ [y/N]' -Valid @('y','n') -Default 'n'
        $ScanProjects=($selection -eq 'y')
    }
    if($ScanProjects -and -not $ProjectRoot){
        $ProjectRoot=Read-NaosSetupValue -Ask $Ask -Prompt '要掃描的主要資料夾路徑'
        $ExtraRoot=Read-NaosSetupValue -Ask $Ask -Prompt '其他資料夾路徑（可留空）' -Required $false
    }

    if($share){
        Write-Host ''
        Write-Host '[必要] 兩台電腦請先自行登入 Tailscale；本工具不會搬移任何憑證。'
        if(-not $HostIp){$HostIp=Read-NaosSetupValue -Ask $Ask -Prompt 'Letta 主機的 Tailscale IPv4'}
        Assert-NaosTailnetAddress $HostIp
        if(-not $SshUser){
            $userDefault=if($Role -eq 'host'){$env:USERNAME}else{''}
            $SshUser=Read-NaosSetupValue -Ask $Ask -Prompt '主機 Windows SSH 使用者' -Default $userDefault
        }
        if($SshUser -notmatch '^[A-Za-z0-9_.-]{1,80}$'){throw 'INVALID_SSH_USER'}
        if($Role -eq 'host'){
            if(-not $PeerIp){$PeerIp=Read-NaosSetupValue -Ask $Ask -Prompt '用戶端的 Tailscale IPv4'}
            Assert-NaosTailnetAddress $PeerIp
            if(-not $SshdInstalled){
                if($OpenSshExplicit -and -not $InstallOpenSSH){throw 'OPENSSH_SERVER_REQUIRED_FOR_SHARED_HOST'}
                $InstallOpenSSH=$true
                Write-Host '[必要] 尚未安裝 Windows OpenSSH Server，會列入主機安裝（需系統管理員）。'
            }else{
                $InstallOpenSSH=$false
                Write-Host '[已存在] SSH Server：不需要重新安裝。'
            }
            if(-not $PublicKeyPath -and -not $HasAuthorizedKey){
                $PublicKeyPath=Read-NaosSetupValue -Ask $Ask -Prompt '用戶端已核對的 SSH 公鑰檔 (.pub) 路徑'
            }
        }else{
            if(-not $KeyPath){
                $defaultKey=Join-Path (Join-Path $HOME '.ssh') 'id_ed25519'
                $KeyPath=Read-NaosSetupValue -Ask $Ask -Prompt '本機 SSH 私鑰的路徑（不讀取內容）' -Default $defaultKey
            }
            Write-Host '[必要] 請先核對 SSH 主機指紋、授權公鑰並透過 ssh-agent 解鎖私鑰。'
        }
    }else{
        Write-Host '[略過] 雙電腦共享及其 SSH/Tailscale 設定。'
    }
    $skipCore=$NoCore -or ($Role -eq 'existing')
    Write-Host ''
    Write-Host '----- 本次選擇（尚未修改電腦）-----'
    Write-Host ('模式：'+$Role)
    Write-Host ('必要核心：'+$(if($skipCore){'保留既有核心'}else{'安裝或保留現有核心'}))
    Write-Host ('選配 Git：'+$(if($InstallGit){'安裝'}else{'不安裝'}))
    Write-Host ('雙電腦共享：'+$(if($share){'啟用'}else{'不啟用'}))
    Write-Host ('Git 資料夾唯讀掃描：'+$(if($ScanProjects){'啟用'}else{'不啟用'}))
    if($Role -eq 'host' -and $share){
        Write-Host ('OpenSSH Server：'+$(if($InstallOpenSSH){'必要時安裝'}else{'保留既有'}))
    }
    return [pscustomobject]@{
        Role=$Role
        InstallGit=[bool]$InstallGit
        ScanProjects=[bool]$ScanProjects
        ConfigureSharing=[bool]$share
        InstallOpenSSH=[bool]$InstallOpenSSH
        NoCore=[bool]$skipCore
        HostIp=$HostIp
        PeerIp=$PeerIp
        SshUser=$SshUser
        KeyPath=$KeyPath
        PublicKeyPath=$PublicKeyPath
        ProjectRoot=$ProjectRoot
        ExtraRoot=$ExtraRoot
    }
}
