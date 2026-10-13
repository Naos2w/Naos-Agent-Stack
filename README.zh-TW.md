# Naos Agent Stack v0.2.1 — PowerShell 安裝與 Doctor

## 全新 Windows 電腦首次安裝問題

在 v0.2.0 的新電腦安裝紀錄中，Doctor 出現 Node.js、OpenChatX、PM2 及 Letta 缺失，並非 ZIP 核心不存在，而是**完整 Node/npm 前置環境未打包**。核心 bootstrap 在 npm.cmd 不存在時便停止。Git 不存在造成 Doctor 警告，不是當次中止主因。

**修復方向：** v0.2.1 完整 Release 新增官方 Windows x64 Node.js 22.23.3（含 npm）與可選 MinGit 2.56.0.2 ZIP。新機安裝時可在不需管理員權限的使用者工具目錄解壓使用；既有可用的 Node/npm、Git 不會被改動。

## 新 Windows x64 電腦安裝

下載 **v0.2.1 的完整 Pre-release ZIP**（不是舊 v0.2.0，不是 GitHub 的 Source code ZIP）。先核對搭配發布的 .sha256.txt，再解壓縮。

從 Windows PowerShell 5.1 進入解壓縮目錄：

    # 先檢查與預覽（只讀）
    .\naos-agent-stack.ps1 doctor
    .\naos-agent-stack.ps1 plan -Role single -InstallGit

    # 真正開始單機安裝（會提示輸入 INSTALL）
    .\naos-agent-stack.ps1 install -Role single -InstallGit

    # 安裝後確認，重新開啟 PowerShell 可更新使用者 PATH
    .\naos-agent-stack.ps1 doctor

若僅使用 OpenChatX / Letta、不需要 Git，請移除 -InstallGit。若現有電腦已安裝 Node/npm 與 Git，安裝器會檢查並保留現有版本。

**安裝檔包含的前置工具：**
- payload/prerequisites/node-v22.23.3-win-x64.zip — Node.js 22.23.3 + npm 10.9.9。
- payload/prerequisites/MinGit-2.56.0.2-64-bit.zip — 可選 Git CLI，非完整 Git for Windows。
- payload/naos-headless-stack-bundle.zip — OpenChatX Headless 核心程式。
- dependencies.lock.json — 官方來源網址與預期 SHA256，安裝會驗證哈希，拒絕使用不符的檔案。

**重要限制：** 前置 Node/npm/Git 由 ZIP 提供，但 OpenChatX / Letta 第一次安裝仍會執行 npm ci 與 npm install，需可連線 npm registry，因此不是 100% 離線安裝；還需要另外設定 ChatGPT Tunnel、OAuth、模型供應商等授權。

本版僅明確支援 Windows x64。如果電腦是 ARM64，會安全停止並回報不支援，避免裝錯架構。

## 雙電腦模式（選配）

雙機共享的是 Letta Agent 記憶，**不是 Git、檔案、分支或密碼同步**。需要 Tailscale、Windows SSH Server、用戶端獨有的 SSH 私鑰與人工核對主機指紋。既有主機與用戶端都不需要重裝核心。

主機端預覽（在系統管理員 PowerShell；請替換為實際 IP）：

    $hostIp = Read-Host '本機 Tailscale IPv4'
    $peerIp = Read-Host '另一台電腦 Tailscale IPv4'
    $user = Read-Host 'SSH Windows 使用者'
    .\naos-agent-stack.ps1 plan -Role host -NoCore -HostIp $hostIp -PeerIp $peerIp -SshUser $user

用戶端預覽（先確認 ssh-agent / 主機指紋）：

    $hostIp = Read-Host 'Letta 主機 Tailscale IPv4'
    $user = Read-Host 'Letta 主機 SSH 帳號'
    .\naos-agent-stack.ps1 plan -Role client -NoCore -HostIp $hostIp -SshUser $user

計畫核對無誤後，install 指令才真正套用；會要求輸入 INSTALL。新機沒有 OpenChatX 時，請勿使用 -NoCore。用戶端轉送僅在 127.0.0.1:4501，主機 Letta 僅在 127.0.0.1:4500。

## Doctor 用法與驗收

    .\naos-agent-stack.ps1 doctor
    .\naos-agent-stack.ps1 doctor -Deep
    .\naos-agent-stack.ps1 doctor -Deep -Json
    .\naos-agent-stack.ps1 doctor -Strict

Doctor 會檢查 Node、npm、Git、OpenChatX、PM2、Letta WebSocket、MCP 健康端點、Tailscale、SSH、重連排程以及 Project/Git/Agent 綁定。檢查只讀，不會對系統執行自動修復，並提供正確退出碼。

## 從來源碼自行打包

Git Repository 刻意不包含大型 ZIP 和任何私密憑證；完整 Pre-release ZIP 透過 GitHub Releases 另行發佈。

    .\tests\validate.ps1
    .\Build-Package.ps1 -CoreBundlePath C:\Packages\naos-headless-stack-bundle.zip -PrerequisiteRoot C:\Packages\prerequisites -OutputPath C:\Packages\Naos-Agent-Stack-v0.2.1-pre-release.zip

Build-Package.ps1 會比對 Node/npm、MinGit 官方 SHA256，並產生最終 ZIP 與 .sha256.txt，避免未經驗證的下載被打包執行。含原始碼與授權通知；不包含 SSH 私鑰、OAuth、Letta Agent 記憶或個人 Git 儲存庫。

## 已驗證與尚未驗證

- v0.2.0 的既有主機與用戶端 9 個共享 Agent 健康檢查通過。
- v0.2.1 新增的 Node/npm 與 MinGit 已在隔離的暫存安裝目錄中成功解壓、執行、清除；未動現有程式或使用者 PATH。
- 新的 PowerShell Source tests、plan/doctor 需在 CI 再驗證。

**尚未完成全新 Windows VM 的完整首次安裝。** 也未進行重新開機測試；請保持本版為 Pre-release。此工具不安裝 OpenClaw、Naos-Teams 或其他排除的舊專案。
