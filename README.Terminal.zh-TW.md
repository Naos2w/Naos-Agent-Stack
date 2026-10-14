# Naos Agent Stack v0.2.1：可選終端機強化套件

安裝套件分為 Standard、Developer、Terminal Add-on。

| 套件 | 內容 |
|---|---|
| Standard | OpenChatX / Letta、Node.js/npm、Doctor、互動安裝器；不含 Git |
| Developer | Standard 加上可選 MinGit CLI |
| Terminal Add-on | 官方 Microsoft PowerShell 7.6.6、Oh My Posh 31.8.0、JetBrainsMono Nerd Font Mono 3.5.1 |

**Git 預設不安裝，Terminal Add-on 也預設不安裝。** 大型二進位檔只放 GitHub Releases，不放 Git 歷史。

下載 Standard 或 Developer ZIP，並將 Terminal Add-on ZIP 解壓到同一個主安裝資料夾，官方工具檔應位於 payload/terminal/ 下。下載附加包本身不會修改任何設定。

## 安裝指令

    # 在 PowerShell 5.1 中進入安裝資料夾
    .\naos-agent-stack.ps1 install

    # 不套用的選項預覽
    .\naos-agent-stack.ps1 plan -Interactive

    # 選取整套終端機功能
    .\naos-agent-stack.ps1 plan -Role single -InstallTerminal

    # 非互動式，使用者明確核准後
    .\naos-agent-stack.ps1 install -Role single -InstallTerminal -Yes

可各自選取 -PowerShell7、-OhMyPosh、-NerdFont、-SetTerminalDefault。沒有勾選的工具或設定不會被更動。若沒有相應 Terminal Add-on 檔案，安裝前會明確拒絕，避免部分安裝。

## 終端機設定

- Microsoft PowerShell 7 只安裝在目前使用者的工具目錄，保留 Windows PowerShell 5.1 與已有 PowerShell。
- Oh My Posh 只在使用者目錄安裝官方執行檔與主題，不改動目前的 PowerShell 全域 Profile。
- JetBrainsMono Nerd Font Mono 只有選取後且尚未安裝才會裝進目前使用者的字體目錄，預設字體名稱使用 JetBrainsMono NFM。
- Windows Terminal 會透過官方 JSON Fragment 新增「Naos PowerShell 7」設定檔。只有使用者選擇設定預設 Profile 時才更改 settings.json 中的 defaultProfile，原檔先備份，不觸碰 WSL 或 CMD 設定。會保留原始註解。
- Windows Terminal 若尚未安裝，會提示使用者先安裝，再從 Windows Terminal Settings → Startup 選擇「Naos PowerShell 7」。
- Windows Terminal 的「預設 Profile」和 Windows 本身的「預設終端機應用程式」是不同設定；不會擅自修改後者。

## 安全及授權

官方元件的版本、URL 和 SHA256 寫在 terminal.lock.json：

- PowerShell-7.6.6-win-x64.zip：Microsoft PowerShell GitHub Release
- posh-windows-amd64.exe / themes.zip：Oh My Posh v31.8.0 GitHub Release
- JetBrainsMono.tar.xz：Nerd Fonts v3.5.1 GitHub Release，內含 OFL.txt

PowerShell 與 Oh My Posh 的 MIT 授權聲明由 third_party/ 收錄；字體 OFL 由官方原始 tar.xz 提供。

本版只支援 Windows x64。終端機模組的測試只在隔離目錄與合成 Windows Terminal 設定檔中執行，不對正式使用者設定進行測試修改。

注意：OpenChatX 與 Letta 的 npm 依賴仍可能需要連線 npm registry，所以整套安裝不是完全離線。
