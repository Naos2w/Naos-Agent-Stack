# Naos Agent Stack

Windows PowerShell 安裝／診斷工具，支援 OpenChatX Headless、Letta Agent 和選配的雙電腦共享記憶。

**原則：腳本進 Git，較大的核心部署包放 GitHub Releases，不把金鑰或 Letta state 提交到 Git。**

## 用法

在 Windows PowerShell 5.1：

```powershell
git clone https://github.com/Naos2w/Naos-Agent-Stack.git
cd Naos-Agent-Stack

# 直接檢查目前電腦，唯讀
.\naos-agent-stack.ps1 doctor

# 深度核對已註冊 Git 專案與 Letta Agent/Session
.\naos-agent-stack.ps1 doctor -Deep

# 輸出供自動化讀取的 JSON
.\naos-agent-stack.ps1 doctor -Deep -Json

# 單機安裝計畫預覽，不修改系統
.\naos-agent-stack.ps1 plan -Role single

# 查看所有可用選項
.\naos-agent-stack.ps1 help
```

若執行政策阻擋，可在**目前的 PowerShell 工作階段**執行 `Set-ExecutionPolicy -Scope Process Bypass`，不需關閉防毒。

| 角色 | 目的 | 雙機元件 |
|---|---|---|
| `single` | 本機 OpenChatX / Letta | 不安裝 |
| `host` | 持有共用 Letta 後端 | 選配 Windows SSH Server 與限制式 Tailnet 防火牆 |
| `client` | 經 SSH 使用主機 Letta 記憶 | 選配 loopback 私有轉送、登入後重連 |
| `existing` | 健康檢查及既有環境維護 | 只按需求操作 |

**`install` 會先要求明確輸入 `INSTALL`，除非主動加上 `-Yes`。** `plan` 和 `doctor` 不會修改設定，也不會重開機。

## 發行檔與安裝

本 Git 儲存庫僅含來源碼及 `payload/bootstrap` 的小型腳本。完整核心部署 ZIP（約 80 MB）**不在 Git 歷史中**。

- 只執行 `doctor`、`plan`：從 Git clone 即可使用。
- 在全新電腦正式執行 `install`：需先取得經核對的 `payload/naos-headless-stack-bundle.zip`；日後由 GitHub Releases 分發。**目前若沒有這個 ZIP，安裝會安全停止，不會假稱安裝完成。**
- 若你已安裝核心，只需配置雙機功能，可使用 `-NoCore`，不會重裝既有服務。
- `Build-Package.ps1` 只在你自己持有上述核對過的核心 ZIP 時產生完整可攜式 ZIP。

雙機共享的是**Letta Agent 記憶**，不是兩台電腦的程式碼、工作目錄或 Git 分支。主機／用戶端分別建立自己的 Conversation；SSH 與 Tailscale 必須經過正常授權，密碼和憑證不會自動複製。

詳細安裝參數、前置條件及限制請看 [繁體中文手冊](README.zh-TW.md)。

## 安全與驗證

`doctor` 支援 `-Json`、`-Strict`、`-Deep`，會檢查服務、WebSocket、SSH loopback、排程和共享 Agent/Git 身分。失敗以非零退出碼回報。

本版在既有 MSI（主機）及 NAOS-PC（用戶端）執行過唯讀深度驗證；**尚未在全新 Windows VM 完成從零安裝及重新開機驗收**。安裝器不包含 OpenClaw、Naos-Teams 或其他不在範圍內的舊專案。

> 私鑰、`.env`、OAuth、Git Credential、`state.json`、Session、部署 ZIP、測試記錄與機器特定設定不會被提交。若要發佈 Release，應先檢查來源與產物。
