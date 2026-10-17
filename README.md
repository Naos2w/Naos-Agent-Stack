# Naos Agent Stack

**One installer ZIP. Choose your components when you run `install`.**

Naos Agent Stack sets up OpenChatX Headless and Letta on Windows x64 using Windows PowerShell 5.1. It offers optional Git, terminal enhancements, and private two-PC shared-memory configuration. You do not need Git for general AI usage.

> [**繁體中文安裝指南**](INSTALL.zh-TW.md) · [中文說明](README.zh-TW.md) · [Terminal customization](README.Terminal.zh-TW.md) · [GitHub Releases](https://github.com/Naos2w/Naos-Agent-Stack/releases)

## One Complete installer — v0.2.2 candidate

The next pre-release consolidates the former **Standard, Developer and Terminal Add-on** downloads into a single versioned ZIP:

`Naos-Agent-Stack-v0.2.2-Complete-pre-release.zip`

All verified upstream binaries are **included**, but **not installed unless the user selects them**.

| Component | Included in ZIP | Installed by default? |
| --- | --- | --- |
| OpenChatX Headless + Letta | Yes | Required on a new machine |
| Node.js 22.23.3 and npm | Yes | Only if a compatible version is missing |
| MinGit 2.56.0.2 CLI | Yes | **No**, opt-in development/Git workflows |
| Microsoft PowerShell 7.6.6 | Yes | **No** |
| Oh My Posh 31.8.0 + themes | Yes | **No** |
| JetBrainsMono Nerd Font Mono 3.5.1 | Yes | **No** |
| Windows Terminal PowerShell 7 profile | Installer config only | **No**, explicitly opt-in |
| SSH/Tailscale shared-memory configuration | Installer config only | **No**, explicit host/client choice |

The installer does **not** bundle the Windows Terminal app, Tailscale login, SSH credentials, OAuth credentials, private keys, or Letta Agent state. First-time Headless npm dependencies still require Internet.

**Compatibility:** The already published [v0.2.1 Release](https://github.com/Naos2w/Naos-Agent-Stack/releases/tag/v0.2.1) remains unchanged and uses separate downloads. The single-ZIP v0.2.2 candidate is **not released until its new PR and CI have passed**; do not use the GitHub Source code ZIP for installation.

## Quick start (when v0.2.2 Complete is published)

1. Download the Complete ZIP from [Releases](https://github.com/Naos2w/Naos-Agent-Stack/releases), verify the published SHA256, and extract it to a new directory.
2. Open Windows PowerShell in that directory and run:

```powershell
# Optional, read-only preview
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\naos-agent-stack.ps1 plan -Interactive

# Interactive installation (optional Git/Terminal defaults to No)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\naos-agent-stack.ps1 install

# Health check after installation
.\naos-agent-stack.ps1 doctor -Deep
```

The installation wizard performs a **read-only preflight for all selected components, including SHA256**, before offering the `INSTALL` confirmation. Missing or corrupted files stop the process *before* any selected tool is installed. The preflight also protects scripted `-Yes` installs.

Use `.\naos-agent-stack.ps1 help` for advanced host/client and automation options. `plan` and `doctor` are read-only.

## Development and packaging

Source code contains scripts, tests, dependency locks and license notices only. Large official ZIPs and executables are added to **GitHub Releases**, not committed to Git. From a development checkout, provide already downloaded and hash-verified assets to the single builder:

```powershell
.\tests\validate.ps1
.\Build-Package.ps1 -CoreBundlePath C:\Packages\naos-headless-stack-bundle.zip -PrerequisiteRoot C:\Packages\prerequisites -TerminalAssetRoot C:\Packages\terminal -OutputPath C:\Packages\Naos-Agent-Stack-v0.2.2-Complete-pre-release.zip
```

The builder requires and verifies **all seven packaged upstream payloads**. The generated manifest lists SHA256 for every included file. This v0.2.2 package remains a **pre-release** pending a real clean Windows end-to-end installation test.

For a Windows x64 non-developer, Git is not required. Optional two-computer sharing uses Tailscale and restricted Windows OpenSSH, and shares Letta memory rather than copying Git repositories or private user files.
