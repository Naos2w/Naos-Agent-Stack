# Naos Agent Stack

Windows PowerShell installer and read-only Doctor for OpenChatX Headless / Letta. Supports local-only and optional private SSH/Tailscale shared-memory setups.

**v0.2.1 is a pre-release candidate for clean Windows x64 machines.** The earlier v0.2.0 package contains the Headless core but **does not bundle Node.js/npm or Git**, which caused a first-install failure on a fresh Windows PC.

## First installation (Windows x64)

Download the **complete v0.2.1 pre-release ZIP** (once published), verify the SHA256 checksum, and extract it. Do not use the Git source archive for fresh installation: dependencies are deliberately excluded from Git history.

Open Windows PowerShell 5.1 in the extracted directory:

    .\naos-agent-stack.ps1 plan -Role single -InstallGit
    .\naos-agent-stack.ps1 install -Role single -InstallGit
    .\naos-agent-stack.ps1 doctor -Deep

When prompted, type **INSTALL**. -InstallGit is optional; without it, Git remains a Doctor warning on a new machine. The installer automatically uses its verified **Node.js 22.20.0 + npm 10.9.3 portable ZIP** if no compatible Node/npm is available. With -InstallGit, it installs verified **MinGit 2.56.0.2 command-line tools** when Git is missing. Both install under the current user's %LOCALAPPDATA%\NaosAgentStack\tools; no MSI or administrator rights are required just for these portable prerequisites.

**Important:** The prerequisite tools are bundled locally, but the core's subsequent npm ci / npm install -g commands still require network access to the npm registry. This is **not a fully offline OpenChatX installation**. On a freshly configured computer, ChatGPT Tunnel credentials, Letta OAuth and provider authorization must be configured separately.

## What is included in the complete v0.2.1 ZIP?

| File | Purpose |
|---|---|
| naos-agent-stack.ps1 | install / plan / doctor / help |
| Prerequisites.ps1 | Verify and install portable x64 Node/npm and optional MinGit |
| Doctor.ps1 | Read-only health and Agent/Git binding checks (-Deep / -Json / -Strict) |
| Engine.ps1 | Single-machine or optional two-machine setup |
| ForwardWatchdog.ps1 | Private SSH port-forward reconnect monitor |
| payload/bootstrap/naos-agent-stack.ps1 | Original Headless core installer |
| payload/naos-headless-stack-bundle.zip | Headless application runtime |
| payload/prerequisites/node-v22.20.0-win-x64.zip | **Offline** Node.js and npm |
| payload/prerequisites/MinGit-2.56.0.2-64-bit.zip | Optional **offline** CLI Git |
| manifest.json | Per-file SHA256 hashes and package metadata |

Portable Node/npm and MinGit are sourced from official upstream releases. The source, version and pinned SHA256 checks are recorded in dependencies.lock.json. The installer refuses mismatched or absent dependencies instead of silently downloading and executing unverified programs. The complete ZIP is substantially larger than v0.2.0; its binaries belong in **GitHub Releases**, not commits.

MinGit provides command-line Git, not the complete Git for Windows UI or full interactive credential setup. Install full [Git for Windows](https://git-scm.com/install/windows) separately if you need Git Bash, Git Credential Manager integration or developer extras.

## Existing host and client installations

Do **not** reinstall the working Headless core. You can simply update the source tools and run:

    .\naos-agent-stack.ps1 doctor
    .\naos-agent-stack.ps1 doctor -Role client -Deep -Json

For two-machine sharing, first use plan -Role client -NoCore with actual Tailscale host IP / SSH account; do not change the existing endpoint unless the host identity has been verified.

Two-machine sharing is **only optional**. It shares Letta Agent memory, not working trees, personal files, Git commits or credentials. Existing Agent and Conversation state must never be copied between machines.

## Source developer workflow

The Git repository intentionally contains only scripts, docs, tests and dependency SHA256 metadata. Building a distributable ZIP requires locally provided, SHA256-verified binaries:

    .\tests\validate.ps1
    .\Build-Package.ps1 -CoreBundlePath C:\Packages\naos-headless-stack-bundle.zip -PrerequisiteRoot C:\Packages\prerequisites -OutputPath C:\Packages\Naos-Agent-Stack-v0.2.1-pre-release.zip

The builder validates both pinned portable-tool hashes and generates SHA256 for each item plus the final ZIP. None of the large ZIPs are committed to Git.

## Doctor commands

    .\naos-agent-stack.ps1 doctor
    .\naos-agent-stack.ps1 doctor -Deep
    .\naos-agent-stack.ps1 doctor -Deep -Json
    .\naos-agent-stack.ps1 doctor -Strict

Doctor validates executable versions, npm, the OpenChatX runtime, Letta WebSocket, MCP HTTP, optional SSH/Tailscale, reconnect tasks and shared Agent/Git mappings. It is strictly read-only. Exit code 0 indicates no errors; nonzero indicates errors or warnings under -Strict.

**Validation status:** Existing host/client installations and isolated portable Node/npm + MinGit extraction tests have passed. The full fresh-install lifecycle on a clean Windows VM is **not yet validated**. No reboot test is performed. This installer does not install OpenClaw or Naos-Teams.
