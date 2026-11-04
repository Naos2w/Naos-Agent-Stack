# Pinned OpenChatX compiled overlay

These files preserve the existing MSI `openchatx-mcp@1.0.0-beta.2` overlay.
The manifest binds fifteen compiled modules and their snapshots by SHA256.
They are not an upstream TypeScript source build or a signed upstream release.
Never apply them to a different package version or an unrecognized base bundle.

`verify-core.mjs` only verifies; it never repairs or restarts a service.
The capability-health overlay separates live MCP/Tunnel availability from the
Agent Runtime Operation readiness state. It reports an aggregate degraded status
when an original Operation still needs reconciliation, even while OpenChatX and
the tunnel are connected. The read-only readiness helper is used with bounded
fixed diagnostic codes; absent/unreadable helpers fail closed. It does **not**
clear Operations, reissue prompts, or auto-restart services. This revision must
be applied only with the existing guarded updater, not copied over live files.
The modules provide scoped WSL argument handling, verified audit rotation and
explicit tool-error diagnostics, complete tool annotations, pre-dispatch remote
authentication auditing and bounded JSON-RPC response observation. Unknown failure codes remain unknown; no
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
It preserves Project routing, authentication and tool permissions. Declared tool
annotations are retained explicitly; missing flags use conservative MCP defaults.
Shell and file-edit tools keep their existing write/destructive classifications.
The current update source targets the pinned `2026-11-04.health.1` overlay
for OpenChatX `1.0.0-beta.2`. It accepts **only** two complete, unmodified
installed preimage sets: `bootstrap-preimages.json` for the original approved
bootstrap baseline and `upgrade-preimages-20261102.json` for the verified
`2026-11-02.context.1` overlay. A mixture of those versions, a changed file,
an unknown package version or a partial installation is refused. The
snapshot/installed checks and transactional rollback remain mandatory.

A failed/closed historical Operation whose tool-effect evidence still needs
reconciliation continues to make *dispatch readiness* degraded. It may permit
a **core maintenance update only** when every recorded Worker has terminated,
the registry is valid, no update/recovery journal or admission lock is active,
and all ordinary PM2, job, watchdog, preimage and rollback checks pass.
The installer neither clears unresolved Operation flags nor replays work.
A running/stale Worker, damaged state or unknown ownership is never an
acceptable maintenance starting point. Historical PIDs are evaluated with
bounded read-only Windows process-creation checks: a process created after
the original Operation's last update is proven unrelated, and two OS queries
that both find no matching PID establish its absence. Unknown or conflicting
process identity fails closed; a PID number alone is never decisive.
The existing `runtime-readiness.ps1` watcher remains a strict operational-
readiness check.

Bootstrap uses the configured Toolbox root, which may differ from the MCP
state directory. Existing execution audits, Project routing, remote tool
identity and privacy controls are preserved.

The 2026-11-01 bootstrap adds versioned guidance on initialization, Project use,
and the first response observed after an identity change. Every successful tool
dispatch includes a compact execution receipt in the existing result/audit path.
The receipt distinguishes direct MCP and Runtime control, without claiming a
Worker executed or guessing the outer model. Letta operation results retain
their existing model selection evidence. Existing sessions and Operations are
not restarted or replayed by context refresh.

Continuation exposes bounded, read-permitted active-Project goals and recent
Session/Operation metadata only. It does not read repository files outside the
Project executor, create a second task ledger, or treat historical task text as
authorization. The Developer still reads the actual task and applicable rules
through scoped tools. Unknown readiness or damaged registries remain unknown.
This is MCP protocol integration, not proof of autonomous ChatGPT adoption or
Codex-equivalent task success. User-visible product acceptance remains separate.

Summary reads are repeatable until an explicit acknowledgment of the exact
revision. A failed read response no longer consumes the handoff. Updates reject
stale acknowledgments; durable receipts make acknowledgment retries safe. New
summaries expire after seven days; legacy records without expiry remain available.
Registry writes are serialized within the service and committed by atomic rename.
An unsuccessful write preserves the prior in-memory and on-disk state. This is
not a multi-process registry or a guarantee against sudden power loss. Summaries
remain contextual data and never grant authorization for actions.

Authentication failures record only the tool name, a hashed request reference,
HTTP status and fixed protocol code. Arguments and authentication headers are
not logged on that path. At most 32 calls in a rejected batch are recorded.
Protocol observation forwards response bytes unchanged and retains only outcome
and explicit machine codes, never raw responses or error messages. Capture stops
at 64 KiB per frame/chunk or 256 KiB per response. Malformed, unsupported or
uncaptured responses remain `unverified`; HTTP 200 alone is not tool success.
The `?` audit marker identifies that uncertainty. Claimed tool callbacks retain
their existing result audit and are not recorded a second time by transport.

These repairs improve the MCP contract and local evidence. They do not establish
why an earlier OpenAI platform check refused a call, nor disable that check.
