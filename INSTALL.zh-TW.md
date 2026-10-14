# Naos Agent Stack 安裝指南（繁體中文）

> **適用版本：v0.2.1 Pre-release｜Windows x64**  
> [下載最新版安裝附件](https://github.com/Naos2w/Naos-Agent-Stack/releases/tag/v0.2.1) · [README](README.md) · [Terminal Add-on 詳細說明](README.Terminal.zh-TW.md)

本頁提供從 GitHub 下載、校驗、安裝及驗收的完整步驟。**請使用 GitHub Release 的 ZIP，勿使用 GitHub 自動產生的 Source code ZIP**：原始碼 ZIP 不含必要的 Headless 核心或 Node/npm 部署檔。

## 1. 選擇安裝包

| 附件 | 適合 | 內容 | 下載 |
| --- | --- | --- | --- |
| **Standard** | 一般 AI / OpenChatX / Letta 使用者 | 核心、Node.js/npm、安裝選單與 Doctor；**不含 Git** | [Standard ZIP](https://github.com/Naos2w/Naos-Agent-Stack/releases/download/v0.2.1/Naos-Agent-Stack-v0.2.1-Standard-pre-release.zip) |
| **Developer** | 要使用 Git Repository、git clone/pull/push | Standard 全部內容，另含**可選**的 MinGit CLI | [Developer ZIP](https://github.com/Naos2w/Naos-Agent-Stack/releases/download/v0.2.1/Naos-Agent-Stack-v0.2.1-Developer-pre-release.zip) |
| **Terminal Add-on** | 額外需要美化或切換 PowerShell 終端機 | PowerShell 7.6.6、Oh My Posh 31.8.0、JetBrainsMono Nerd Font Mono 3.5.1 | [Terminal Add-on ZIP](https://github.com/Naos2w/Naos-Agent-Stack/releases/download/v0.2.1/Naos-Agent-Stack-v0.2.1-TerminalAddon.zip) |

**Standard 與 Developer 二選一**；Terminal Add-on 可視需要額外下載。若只想使用 AI，不寫程式也不操作 Git，選 Standard 即可。

安裝前請確認：Windows **x64**、內建 Windows PowerShell 5.1，以及可連線 npm registry 的網路。Node/npm 會從 ZIP 部署，但 OpenChatX/Letta 首次安裝仍可能需要透過 npm 下載相依套件；**不是完全離線安裝**。

## 2. 下載後先驗證 SHA256

可以使用 [SHA256SUMS.txt](https://github.com/Naos2w/Naos-Agent-Stack/releases/download/v0.2.1/SHA256SUMS.txt) 或各 ZIP 附帶的 SHA256 檔案。

| ZIP | SHA256 |
| --- | --- |
| Standard | `EAC9AA081BA9234DEDCFB23019610B5C7D3B5F52E1758075FCDE2035A53A8A93` |
| Developer | `3E2821F94F78F1B1890C23C0C4417924542D7E743FCC18189B75AEF3A21C556F` |
| Terminal Add-on | `F46D13DD19B30E47D492FBDA95F92E4631B0F62B1E48511501851104413222BA` |

下例使用 Standard。若下載在其他地方請修改 `$zip`；Developer 請使用對應的檔名與 SHA256：

```powershell
$zip = Join-Path $HOME 'Downloads\Naos-Agent-Stack-v0.2.1-Standard-pre-release.zip'
$expected = 'EAC9AA081BA9234DEDCFB23019610B5C7D3B5F52E1758075FCDE2035A53A8A93'

if (-not (Test-Path -LiteralPath $zip -PathType Leaf)) {
    throw "找不到 ZIP：$zip"
}
if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $expected) {
    throw 'SHA256 不符，請停止安裝並重新下載。'
}
Write-Host '[PASS] ZIP SHA256 驗證成功'
```

## 3. 解壓縮安裝包

可以用 Windows 檔案總管右鍵「**全部解壓縮**」至全新目錄；**不要在 ZIP 壓縮檔內直接執行腳本**。

也可在 PowerShell 接續前面的 `$zip`：

```powershell
$installDir = Join-Path $HOME 'Downloads\Naos-Agent-Stack-v0.2.1'
if (Test-Path -LiteralPath $installDir) {
    throw "目標目錄已存在，請改用新的解壓縮目錄：$installDir"
}
Expand-Archive -LiteralPath $zip -DestinationPath $installDir
Set-Location -LiteralPath $installDir
Test-Path -LiteralPath '.\naos-agent-stack.ps1'
```

最後一行應回傳 `True`。

## 4. 先執行唯讀安裝預覽

在**解壓縮後的主安裝目錄**執行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\naos-agent-stack.ps1 plan -Interactive
```

選單會詢問：

- **模式**：單機（預設）、雙電腦共享主機、雙電腦共享用戶端，或維護現有安裝。
- **Git CLI（MinGit）**：預設 **No**；只有 Developer 包內有安裝檔。不開發程式或不操作 Git Repository 就不需要安裝。
- **Git 專案唯讀掃描**：預設 No。
- **終端機強化**：預設 No；只有選擇使用時才需要 Terminal Add-on。

`plan` 只顯示計畫，**不會安裝程式或修改設定**。

## 5. 執行安裝

確認選項後，執行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\naos-agent-stack.ps1 install
```

安裝選單會顯示選擇結果及安裝預覽。最後出現 `Type INSTALL to apply the selected options` 時，**輸入大寫 `INSTALL`** 才會正式套用；取消則不安裝。

缺少 Node.js/npm 的新電腦會使用套件內官方 Node.js 22.23.3 LTS / npm 10.9.9；已安裝的相容版本會保留。一般單機模式不需要 Tailscale、SSH 或 Git。

此處 `-ExecutionPolicy Bypass` 只套用在該次 PowerShell 程序，**不是永久變更執行原則**。安裝器不會自動要求重開機。

## 6. 選配 Terminal Add-on：PowerShell、Oh My Posh、NF 字體

先下載並解壓 Terminal Add-on ZIP 至另一個資料夾，再將裡面的 **`payload\terminal` 資料夾**複製到主安裝目錄的 `payload` 底下。**只複製這個資料夾**，不需要覆寫主安裝包的其他檔案。

合併後目錄應有：

```text
Naos-Agent-Stack-v0.2.1/
├── naos-agent-stack.ps1
├── Install-Wizard.ps1
└── payload/
    ├── naos-headless-stack-bundle.zip
    ├── prerequisites/
    └── terminal/
        ├── PowerShell-7.6.6-win-x64.zip
        ├── posh-windows-amd64.exe
        ├── themes.zip
        └── JetBrainsMono.tar.xz
```

之後再次執行 `install`，選取需要的終端機元件。如果 OpenChatX 已經安裝，請選「維護現有安裝」，不必重裝核心。

- **PowerShell 7** 與內建 Windows PowerShell 5.1 並存。
- **Oh My Posh** 使用獨立 Naos PowerShell 設定檔，不覆寫使用者原有的 PowerShell Profile。
- **Nerd Font** 預設字體 `JetBrainsMono NFM`；安裝後可能需要重啟 Windows Terminal 視窗才會顯示。
- 可將新增的 **Naos PowerShell 7 Profile** 設為 Windows Terminal 預設。修改既有 Windows Terminal 設定之前會建立備份。
- **Windows Terminal 應用程式本身未包含在 Add-on**；若尚未安裝 Windows Terminal，需另外安裝。預設 Profile 不等於 Windows 系統的預設終端機應用程式。

詳細請見：[終端機附加包安裝與設定](README.Terminal.zh-TW.md)。

## 7. 安裝後驗收：Doctor

安裝後建議重新開啟 PowerShell，讓使用者 PATH 生效，並回到原安裝目錄：

```powershell
.\naos-agent-stack.ps1 doctor
.\naos-agent-stack.ps1 doctor -Deep
.\naos-agent-stack.ps1 doctor -Deep -Json
```

重點確認 Node.js、npm、OpenChatX runtime、Headless、Letta 設定及 MCP HTTP 的 `PASS` / `WARN` / `FAIL`。

- 若未選 Git，Git 顯示 `WARN` 可能是正常的；**一般 AI 單機使用者不必因此補安裝 Git**。
- OpenChatX、Letta 或 npm 有 `FAIL` 時，請依 Doctor 的提示排查，勿假定已安裝成功。
- 若要雙電腦共享，請先完成 Tailscale 登入、SSH 主機指紋確認與公鑰授權，再使用 Host / Client 角色設定。共享的是 Letta Agent 記憶，不是 Git 分支、檔案、密碼或 Conversation 的直接同步。

## 8. 常見問題

| 症狀 | 建議 |
| --- | --- |
| `Node.js/npm required` | 使用 v0.2.1 的 **Release ZIP**，不是 v0.2.0 或 Source code ZIP。 |
| `Git unavailable` | Standard 不提供 Git；一般 AI 使用者可以不裝，需要 Git 請改用 Developer。 |
| `TERMINAL_ADDON_MISSING` | 檢查 `payload\terminal` 下是否具有四個官方元件檔案。 |
| npm 安裝失敗 | 確認網路、公司防火牆及 npm registry 存取；安裝非完全離線。 |
| MCP HTTP 或 Letta 無法連線 | 使用 `doctor -Deep` 檢查服務、安裝狀態及新機授權。 |
| Oh My Posh 圖示顯示異常 | 確認 Nerd Font 安裝完成，Profile 字體為 `JetBrainsMono NFM`，重新開啟 Windows Terminal。 |

## 支援狀態

**v0.2.1 為 Pre-release**：已通過 Windows PowerShell 5.1 CI、三份 ZIP 的 SHA256 與內部 Manifest 驗證、ZIP 解壓後 `help` 與唯讀 `plan` 檢查；但**全新 Windows 環境完整首次安裝及重開機後驗收尚未完成**。

問題回報：[GitHub Issues](https://github.com/Naos2w/Naos-Agent-Stack/issues)。建議附 Windows 版本、使用的 ZIP、安裝指令、錯誤訊息及 `doctor -Deep` 結果；分享日誌前請移除 Token、密碼、私鑰及其他敏感資料。

[返回 GitHub 首頁](README.md) · [下載 v0.2.1](https://github.com/Naos2w/Naos-Agent-Stack/releases/tag/v0.2.1)
