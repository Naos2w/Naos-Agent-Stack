# Pinned OpenChatX compiled overlay

These files preserve the existing MSI `openchatx-mcp@1.0.0-beta.2` overlay.
The manifest binds three compiled modules and their snapshots by SHA256.
They are not an upstream TypeScript source build or a signed upstream release.
Never apply them to a different package version or an unrecognized base bundle.

`verify-core.mjs` only verifies; it never repairs or restarts a service.
The modules provide scoped WSL argument handling, verified audit rotation and
explicit tool-error diagnostics. Unknown failure codes remain unknown; no
platform rejection cause is inferred from an absent local request.
WSL remains a Windows-integrated execution environment, not an OS security
sandbox. Strict untrusted-code isolation requires a separately designed boundary.

The reproducible bundle builder combines a pinned base ZIP with repository-owned
overlays. Its per-file manifest is the content identity; ZIP timestamps need not
be byte-identical. A successful local rebuild does not certify a clean Windows
installation, a full-platform upgrade, reboot recovery or a published release.

`Apply-AuditDiagnostics.ps1` installs the version-pinned audit overlay with a
watchdog pause, shared Runtime maintenance lock, active-job checks, backups and
rollback on caught failures. A retained `.audit-update-pending.json` blocks a new
application and the core health check; inspect its backup before manual recovery.
It does not bypass Project routing or change tool permissions/annotations.
