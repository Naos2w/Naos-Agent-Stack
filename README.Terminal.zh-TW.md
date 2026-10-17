# 終端機強化套件 — 單一 ZIP 內的可選功能

自 v0.2.2 起，**不需要另外下載 Terminal Add-on**。PowerShell 7、Oh My Posh、Nerd Font 都放在 `Naos-Agent-Stack-v0.2.2-Complete-pre-release.zip` 內，但**預設不會安裝**。

## 安裝方式

1. 先到 [GitHub Releases](https://github.com/Naos2w/Naos-Agent-Stack/releases) 確認 v0.2.2 Complete Pre-release 附件存在，再下載並驗證 **Complete ZIP**。請勿使用 v0.2.1 Standard ZIP 或 GitHub Source code ZIP 期待取得終端機元件。
2. 解壓到新目錄，進入 Windows PowerShell 5.1。
3. 執行 `.\naos-agent-stack.ps1 install`。
4. 在「終端機強化」提示選 `y`，接著可**個別決定**要不要 PowerShell 7、Oh My Posh、JetBrainsMono Nerd Font Mono，以及是否將新的 Naos PowerShell 7 Profile 設成 Windows Terminal 預設。
5. 安裝器在要求輸入 `INSTALL` 之前，會核對所有選中工具的發布檔案與 SHA256。

或使用唯讀預覽：

```powershell
.\naos-agent-stack.ps1 plan -Role single -InstallTerminal
```

非互動腳本使用：`.\naos-agent-stack.ps1 install -Role single -InstallTerminal -Yes`（請先明確核准；不顯示安裝確認）。

## 提供的工具與系統影響

| 可選項 | 版本 | 行為 |
| --- | --- | --- |
| Microsoft PowerShell | 7.6.6 | 安裝為目前使用者的可攜版本，保留內建 PowerShell 5.1 |
| Oh My Posh | 31.8.0 | 安裝執行檔與官方主題，不覆寫原本 `$PROFILE` |
| JetBrainsMono Nerd Font Mono | 3.5.1 | 僅未安裝且勾選時加入目前使用者字體，預設 `JetBrainsMono NFM` |
| Windows Terminal Profile | 安裝器設定 | 建立 Naos PowerShell 7 設定檔；選擇設成預設時先備份 `settings.json` |

Windows Terminal 應用程式本身**未打包**，如果電腦尚未安裝，需自行安裝。設定 Windows Terminal 的預設 Profile 並不等於更改整個 Windows 的預設終端機應用程式。

## 故障排查

- `INSTALL_PREFLIGHT_MISSING: payload/terminal/...`：代表選到的檔案不在安裝資料夾；請重新下載**完整 v0.2.2 Complete ZIP**，不要補裝獨立附件。
- 提示 `TERMINAL_ADDON_SHA256_MISMATCH`：檔案雜湊不一致，請停止安裝並重抓完整 ZIP。
- 沒有 Oh My Posh 圖示：檢查字體是否設定成 `JetBrainsMono NFM`，然後重新開啟 Windows Terminal。

工具的官方發布來源及 SHA256 鎖定在 `terminal.lock.json`；授權聲明位於 `third_party`，字體原始壓縮檔附有 OFL。

**v0.2.1 Release 仍使用舊的分包模式**。本頁僅適用於 [Releases](https://github.com/Naos2w/Naos-Agent-Stack/releases) 提供的 v0.2.2 Complete ZIP。
