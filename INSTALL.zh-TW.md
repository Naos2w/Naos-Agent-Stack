# Naos Agent Stack 安裝指南（繁體中文）

> **適用版本：v0.2.2 Complete Pre-release（新機端到端驗收尚待完成）** · [GitHub Releases](https://github.com/Naos2w/Naos-Agent-Stack/releases) · [回到 README](README.md)

> 舊版 [v0.2.1](https://github.com/Naos2w/Naos-Agent-Stack/releases/tag/v0.2.1) 仍使用 Standard / Developer / Terminal Add-on 分包模式。請在 [Releases](https://github.com/Naos2w/Naos-Agent-Stack/releases) 確認 v0.2.2 Complete Pre-release 附件存在後再依本文操作。

## 1. 一次只下載一個 ZIP

v0.2.2 將**所有安裝檔打包在一份 Complete ZIP，執行 install 時再決定安裝哪些工具。**

下載名為 `Naos-Agent-Stack-v0.2.2-Complete-pre-release.zip` 的官方 Release 附件。請勿下載 GitHub 自動產生的 Source code ZIP（缺少大型的 Node/npm、Headless 和可選工具）。

| 元件 | 檔案已包含 | 預設安裝 |
| --- | --- | --- |
| OpenChatX Headless + Letta | 是 | 新電腦必要；已有正常核心則保留 |
| Node.js 22.23.3 / npm | 是 | 需要時自動安裝 |
| MinGit 2.56.0.2 | 是 | **否**；要開發或操作 Git 再選 y |
| PowerShell 7.6.6 | 是 | **否** |
| Oh My Posh 31.8.0 / themes | 是 | **否** |
| JetBrainsMono Nerd Font Mono 3.5.1 | 是 | **否** |
| Windows Terminal PowerShell Profile | 是，設定邏輯 | **否**，選取後才建立 |
| 雙電腦記憶共享 | 是，設定邏輯 | **否**，需自行準備 Tailscale / SSH |

完全不需要另外下載 Terminal Add-on 或 Developer ZIP。若只是使用 AI，不寫程式也不操作 Git Repository，安裝選單的 Git、終端機強化及雙電腦共享都保持預設 `n` 即可。

**必要條件**：Windows x64、Windows PowerShell 5.1、可連上 npm registry 的網路。首次安裝 Headless 可能要透過 npm 下載相依套件，因此不是 100% 離線安裝。

## 2. 檢查 ZIP SHA256

從 [GitHub Releases](https://github.com/Naos2w/Naos-Agent-Stack/releases) 下載完整 ZIP 和同名 `.sha256.txt`。以 Release 公布的 SHA256 為準，下載後執行：

```powershell
$zip = Join-Path $HOME 'Downloads\Naos-Agent-Stack-v0.2.2-Complete-pre-release.zip'
$hashFile = [IO.Path]::ChangeExtension($zip, '.sha256.txt')
if (-not (Test-Path -LiteralPath $zip -PathType Leaf) -or
    -not (Test-Path -LiteralPath $hashFile -PathType Leaf)) {
    throw '缺少 ZIP 或對應的 SHA256 檔案；請先從 GitHub Releases 下載。'
}
$expected = ((Get-Content -LiteralPath $hashFile -Raw).Trim() -split '\s+')[0]
$actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
if ($actual -ne $expected) { throw 'SHA256 不一致；請停止安裝並重新下載。' }
Write-Host '[PASS] 下載 ZIP 驗證成功'
```

## 3. 解壓並開啟 PowerShell

在 ZIP 上按滑鼠右鍵選擇「全部解壓縮」，放入**全新資料夾**。也可接續前面的 `$zip`：

```powershell
$installDir = Join-Path $HOME 'Downloads\Naos-Agent-Stack-v0.2.2'
if (Test-Path $installDir) { throw "資料夾已存在：$installDir，請改選新的資料夾。" }
Expand-Archive -LiteralPath $zip -DestinationPath $installDir
Set-Location -LiteralPath $installDir
Test-Path -LiteralPath '.\naos-agent-stack.ps1'
```

最後一行應該是 `True`。

## 4. 先跑唯讀預覽

在剛解壓的資料夾執行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\naos-agent-stack.ps1 plan -Interactive
```

可以選擇單機、雙電腦主機、雙電腦用戶端或維護現有安裝；Git、Git 專案掃描、PowerShell 7、Oh My Posh、Nerd Font、Windows Terminal Profile 都可個別選。**一般使用者推薦單機，選配維持 No。**

`plan` 只顯示安裝計畫，不改動現有環境。預覽正常不等於完全驗收，真正的選取檔案 SHA256 預檢會在下一步、輸入 INSTALL 前執行。

## 5. 開始安裝（重要：先檢查依賴，再確認）

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\naos-agent-stack.ps1 install
```

完成選單後，v0.2.2 會先檢查**所有已選擇的元件**。必須看到類似以下訊息，才會詢問是否安裝：

```text
[PASS] SELECTED_PAYLOAD_PREFLIGHT_OK
[PASS] TERMINAL_ADDON_PREFLIGHT_OK   (有選終端機時)
[PASS] ALL_SELECTED_COMPONENTS_READY_BEFORE_INSTALL_CONFIRMATION
Type INSTALL to apply the selected options:
```

只有確認所有必要安裝檔存在且 SHA256 合格後，使用者才能輸入大寫 `INSTALL` 真正套用。若有缺檔或校驗錯誤，安裝器會**提前停止**，並提示重新下載 Complete ZIP，不會要求使用者去找額外的 Terminal Add-on 或 MinGit 包。

`-ExecutionPolicy Bypass` 只作用於這次 PowerShell 程序，不會永久改變整台電腦的執行原則；不會自動重開機。

## 6. 選配終端機強化

同一個 ZIP 已經包含：
- Microsoft PowerShell 7.6.6，可與內建 Windows PowerShell 5.1 並存；
- Oh My Posh 31.8.0，使用獨立啟動器，不覆寫使用者現有 PowerShell Profile；
- JetBrainsMono Nerd Font Mono 3.5.1（Windows Terminal Profile 字體設定為 `JetBrainsMono NFM`）。

只需在安裝選單選 `y`，再個別選取即可。修改 Windows Terminal 設定前會備份原始檔。

注意：**Windows Terminal GUI 本身未包含在 ZIP**，如電腦未安裝 Windows Terminal，仍須另外安裝。預設 PowerShell Profile 和 Windows 系統預設終端機程式不是同一個選項。

## 7. 安裝後 Doctor 驗收

重新開啟 PowerShell，使使用者 PATH 更新，回到剛才解壓的資料夾，執行：

```powershell
.\naos-agent-stack.ps1 doctor
.\naos-agent-stack.ps1 doctor -Deep
.\naos-agent-stack.ps1 doctor -Deep -Json
```

確認 Node.js、npm、OpenChatX Runtime、Headless、PM2、Letta config / WebSocket、MCP HTTP 的 PASS/WARN/FAIL。**沒有選 Git 時，Git 的 WARN 不代表一般 AI 使用者必須安裝 Git。**

## 8. 常見問題

| 錯誤 | 建議 |
| --- | --- |
| `INSTALL_PREFLIGHT_MISSING: payload/terminal/...` | 下載資料夾不完整或下載錯版本；**重新解壓 v0.2.2 Complete ZIP**。 |
| `INSTALL_PREFLIGHT_MISSING: payload/prerequisites/...` | 缺少 Node/npm 或 MinGit 的已選檔案，重新下載 Complete ZIP。 |
| `INSTALL_PREFLIGHT_SHA256_MISMATCH` / `TERMINAL_ADDON_SHA256_MISMATCH` | 安裝檔 SHA256 不符，停止安裝，不要略過檢查。 |
| npm 套件安裝失敗 | 檢查網路、npm registry / 公司防火牆；完整 ZIP 仍不是完全離線。 |
| Git 未安裝 | 一般使用者可保持不安裝；需要 Git 指令時重跑安裝選單選取。 |
| Oh My Posh 圖示缺字 | 確認 `JetBrainsMono NFM` 字體與 Windows Terminal 設定，重新開啟 Terminal。 |

**雙電腦共享**需要另外登入 Tailscale、核對 SSH 主機指紋、設定公鑰與適當權限；分享的是 Letta Agent 記憶，不是 Git、密碼或檔案。

**發行狀態**：v0.2.2 在完成 GitHub CI、整份 ZIP 完整性驗證及新 Windows 安裝測試前，維持 Pre-release；v0.2.1 舊版不會被覆蓋。問題請至 [GitHub Issues](https://github.com/Naos2w/Naos-Agent-Stack/issues) 回報，分享日誌前移除 Token、密碼與 SSH 私鑰。
