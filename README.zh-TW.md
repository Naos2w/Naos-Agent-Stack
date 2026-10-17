# Naos Agent Stack — Windows 安裝與健康檢查

> **安裝入口：[繁體中文完整安裝指南](INSTALL.zh-TW.md)** · [GitHub Releases](https://github.com/Naos2w/Naos-Agent-Stack/releases) · [終端機強化說明](README.Terminal.zh-TW.md)

## 為什麼調整成單一安裝包？

在 v0.2.1 的新電腦安裝測試中，使用者從選單勾選 **Git、PowerShell 7、Oh My Posh 與 Nerd Font**，但 Standard ZIP 不含 MinGit，而終端機元件必須再下載獨立的 Add-on，導致直到輸入 `INSTALL` 後才報缺檔。

**這是發行版架構和安裝預檢的設計缺陷**，不是使用者選錯選項。

因此 v0.2.2 改為 **Complete 單一 ZIP**。所有可選元件都打包進去，卻仍維持「**預設不安裝**」；選單決定使用哪些工具，而非下載時決定取得哪一種 ZIP。

| 元件 | Complete ZIP 內含 | 執行時選擇 |
| --- | --- | --- |
| OpenChatX Headless / Letta | 必備核心 | 全新安裝必要，既有正常安裝不覆寫 |
| Node.js 22.23.3 + npm | 必備前置工具 | 缺少相容版本時安裝 |
| MinGit 2.56.0.2 | 選配 | 不寫程式、不管理 Git 就保持 No |
| PowerShell 7.6.6 | 選配 | 預設 No |
| Oh My Posh 31.8.0 | 選配 | 預設 No |
| JetBrainsMono Nerd Font Mono 3.5.1 | 選配 | 預設 No |
| Windows Terminal 設定檔 | 選配 | 預設 No，修改前備份 |
| Tailscale / SSH 共享設定 | 選配 | 只在 Host 或 Client 模式要求 |

**v0.2.2 Complete 以 Pre-release 發布，正式實機驗收仍需完成。** 現有的 [v0.2.1 Release](https://github.com/Naos2w/Naos-Agent-Stack/releases/tag/v0.2.1) 不會被覆蓋，仍是舊版分包設計。請先到 [Releases](https://github.com/Naos2w/Naos-Agent-Stack/releases) 確認有 v0.2.2 **Complete ZIP** 附件再下載，不要下載 GitHub 自動產生的 Source code ZIP。

## 操作

解壓到新的資料夾，在 Windows PowerShell 5.1 進入該資料夾：

```powershell
# 只預覽，不修改設定
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\naos-agent-stack.ps1 plan -Interactive

# 開啟安裝選單
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\naos-agent-stack.ps1 install

# 安裝完成後
.\naos-agent-stack.ps1 doctor -Deep
```

`install` 會先顯示計畫，接著對**使用者選擇的必要及選配元件**進行唯讀檔案完整性及 SHA256 檢查。只有全部通過才要求輸入大寫 `INSTALL`。缺任何檔案都會提示重新下載單一 Complete ZIP，**不用另外找 MinGit 或 Terminal Add-on**。

一般單機安裝不用 Git、Tailscale 或 OpenSSH；雙電腦共享時必須另外登入 Tailscale 並完成 SSH 授權。

**限制：** 本版支援 Windows x64，OpenChatX 首次執行 `npm ci` 仍可能需要網路；Windows Terminal GUI 本身沒有隨包附上。完整乾淨 Windows 的實際安裝及重開機恢復還沒有端到端驗收，因此新版本應維持 **Pre-release**。

參考：[詳細安裝步驟](INSTALL.zh-TW.md) · [終端機設定](README.Terminal.zh-TW.md) · [提出問題](https://github.com/Naos2w/Naos-Agent-Stack/issues)
