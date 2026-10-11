# Naos Agent Stack — PowerShell v0.2.0 使用說明

主要入口：`naos-agent-stack.ps1`。支援 Windows PowerShell 5.1，提供 `install`、`plan`、`doctor`、`help`。

## 先驗證，再安裝

```powershell
.\naos-agent-stack.ps1 doctor
.\naos-agent-stack.ps1 doctor -Deep
.\naos-agent-stack.ps1 doctor -Json
.\naos-agent-stack.ps1 doctor -Deep -Strict
.\naos-agent-stack.ps1 plan -Role single
```

- `doctor` 是唯讀檢查，預設判別單機／主機／用戶端角色。
- `-Deep` 額外檢查 Letta Agent、Conversation、Git repository remote 與共享 manifest。
- `-Json` 提供機器可讀結果。
- `-Strict` 將警告也列為失敗。檢查失敗回傳非零退出碼。
- `plan` 不會套用設定；`install` 需要輸入 `INSTALL`，或刻意指定 `-Yes`。

## 單機

```powershell
.\naos-agent-stack.ps1 plan -Role single
.\naos-agent-stack.ps1 install -Role single
.\naos-agent-stack.ps1 doctor -Role single
```

單機沒有雙機 SSH、Tailscale 轉送，並且不會建立重連排程。

新電腦的安裝需要 `payload/naos-headless-stack-bundle.zip`。此 ZIP 不在 Git 歷史中，應從可信任的發布檔提供並核對 SHA256。沒有 ZIP 時，來源版仍可執行 `doctor`／`plan`，但正式核心安裝會被阻擋。

## 雙電腦共享記憶

前置條件：兩台電腦各自安裝 Tailscale、登入同一個 Tailnet，SSH Server 由主機授權第二台的 **.pub 公鑰**。用戶端持有自己的私鑰，先核對 SSH 主機指紋，並透過 Windows `ssh-agent` 載入私鑰。

主機（系統管理員 PowerShell）：

```powershell
# $hostIp = Read-Host '本機的 Tailscale IPv4'
$clientIp = Read-Host '另一台電腦的 Tailscale IPv4'
$windowsUser = Read-Host '本機 SSH Windows 帳號'
.\naos-agent-stack.ps1 plan -Role host -NoCore -HostIp $hostIp -PeerIp $clientIp -SshUser $windowsUser

.\naos-agent-stack.ps1 install -Role host -NoCore -HostIp $hostIp -PeerIp $clientIp -SshUser $windowsUser -PublicKeyPath C:\Temp\client.pub

.\naos-agent-stack.ps1 doctor -Role host -Deep
```

若主機尚無 Windows OpenSSH Server，需明確指定 `-InstallOpenSSH`。Windows 選用功能可能需要 Windows Update，安裝器不會要求重開機。遇到已存在且不相容的 `sshd_config` 時不會直接覆寫；其他 SSH／RustDesk 防火牆規則不會被刪除。

用戶端：

```powershell
$hostIp = Read-Host '主機 Tailscale IPv4'
$windowsUser = Read-Host '主機的 SSH Windows 帳號'
.\naos-agent-stack.ps1 plan -Role client -NoCore -HostIp $hostIp -SshUser $windowsUser
.\naos-agent-stack.ps1 install -Role client -NoCore -HostIp $hostIp -SshUser $windowsUser -KeyPath "$HOME\.ssh\id_ed25519_msi_letta"
.\naos-agent-stack.ps1 doctor -Role client -Deep -ProjectRoot C:\Projects
```

SSH 私有轉送僅監聽 `127.0.0.1:4501`，透過 SSH 指向主機 `127.0.0.1:4500`。定期重連排程於使用者登入後運作。除非確認相符的 SSH 程序與轉送，否則不會改變現有 Letta Runtime 的連線位置。

可用 `-LettaRoot` 指定本機 Letta 安裝位置。新安裝預設使用 `%LOCALAPPDATA%\NaosAgentSetup\Letta-POC`。

## 既有環境的 Doctor

```powershell
.\naos-agent-stack.ps1 doctor -Deep -Json
.\naos-agent-stack.ps1 doctor -Role client -Deep -ProjectRoot C:\Projects -ExtraRoot C:\ExtraProjects
```

檢查 Windows、Node.js、Git、OpenChatX Headless、PM2、MCP HTTP 健康端點、Letta WebSocket、Tailscale、SSH 和排程，以及 Git 與共享 Agent／Conversation 綁定。Doctor 不會建立 Agent、執行 Git clone、索引程式碼或修復系統。

**兩台電腦的 Agent ID 可相同，但 Conversation ID 必須獨立。** Letta 共用記憶不能取代 Git，同時寫入共享記憶時應避免競爭。

## 安全與發佈

Git 僅儲存 PowerShell 腳本、說明及小型 bootstrap；完整核心 ZIP、私鑰、OAuth、`.env`、Session／Agent state、Git 憑證、日誌、Tailscale 實際 IP 不上傳。請使用 Releases 下載大型產物，並核對 SHA256。

原有打包腳本 `Build-Package.ps1` 在取得已核對的 Headless ZIP 後才能產生完整 ZIP。套件中的 npm 相依安裝仍可能需要網際網路。

## 驗證範圍

過去在已設定完成的兩台 Windows 電腦上，唯讀 Doctor 分別得到 27 PASS／0 WARN／0 FAIL（主機）與 28 PASS／0 WARN／0 FAIL（用戶端），九個共享 Agent/Git 對應通過。**這不代表新電腦的首次安裝已完成驗收**；尚未進行全新 VM 及重開機測試，本次亦不安排重開機測試。
