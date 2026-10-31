# MSI Letta interruption recovery — 2026-10-31

This extends the control-only reconnect repair in `MSI_LETTA_RECONNECT_20261031.md`.
The current approved scope is MSI interruption recovery. PC2 runtime sync and a
new packaged installer remain separate work. Fresh Windows installation testing
was explicitly excluded by the owner.

## Behavior delivered

- `agent_runtime(action=recover, operation_id=<original ID>)` recovers the same
  accepted Operation. It refuses a live Worker, moved Session, different input
  identity or competing live Operation. Poll reports this recovery action.
- The facade preserves old attempt logs, keeps the effective model and prevents
  late callbacks from an old Worker from overwriting its replacement's state.
  Existing retention rules also remove settled recovery-attempt files.
- Before sending the first prompt, the Worker durably saves any new conversation
  binding. Failed operations retain their input for reconciliation.
- The idempotency claim is flushed before execution. Completion is written to
  a flushed temporary file and renamed over the claim. Recovery checks original
  project, conversation, tool call ID, tool name and exact argument fingerprint.
- Letta verifies ownership, original latest input and the pending batch before
  accepting saved results. No original prompt is resubmitted. Unstarted tools
  still require current ProjectExecutor approval. Uncertain/corrupt claims stop
  recovery before execution; IDs/claims are never reset to force a retry.
- Provider corrections cancel the original turn when its tool controller dies
  and transfer control ownership to the surviving connection. Previously a null
  owner could leave an unowned live approval after both connections disappeared.
- A lost final response can be reconciled from a completed backend run. Local
  Letta loses ephemeral Run IDs at restart; the adapter then verifies the durable
  original input and final `stop` in at most 1 MiB of transcript tail. A missing
  Run ID remains null. Errors, tool-use stops and changed input do not qualify.

This is explicit reconciliation/resumption, not an unattended process watchdog.
It does not promise automatic recovery at every crash point. Missing ownership,
unknown remote work or unprovable side effects remain actionable blocked states.
A crash after a side effect but before durable completion cannot be converted
into success or automatic re-execution. Inspect that destination before deciding
how to proceed. Product acceptance remains separate from Operation completion.

## Validation

- **192 tests passed, 0 failed, 0 skipped** in the complete manual CI test list.
- PowerShell 5.1 health/offline-updater/observer rollback validation passed.
- PowerShell syntax, installer dry-run and source validation passed.
- Real Letta 0.34.1 and model probes used an isolated local backend and one fixed
  append fixture. Provider/Worker processes were actually terminated; these were
  not only mocked socket tests. Receipts are in `benchmarks/cold-v1/`.

| Case | Observed outcome |
|---|---|
| Worker and Letta killed after durable tool result | Original result resumed; one effect; one original prompt |
| Worker killed, Letta stays alive | Original result resumed; one effect |
| Both WebSocket connections closed | Original result resumed; one effect; no prompt replay |
| Worker killed before approval/execution | Current approval checked; original tool executes once |
| Worker killed after effect, before durable completion | Explicit uncertainty; one effect; no re-execution |
| Installed Worker reconciles a completed pre-restart conversation | Completed from durable transcript; no new model request/tool execution; Run ID null |
| Control-only disconnect against updated installed provider | Existing live reconnect still succeeds; one effect |

Earlier cold receipts precede the final new-conversation binding persistence;
their turn recovery code is unchanged. The combined final receipt and installed
control regression match Worker SHA-256
`834AA12F99824E70BAF327CFE260F59EA48C38416ED7BC062E134BEAC042F932`.
The installed completed-conversation check observed Sol 6.1 / high.

## Installation and preservation

MSI was idle before maintenance; PC2 had no running registered Operations. The
shared Letta service was restarted under MSI's maintenance lock. PC2 connectivity
was verified afterward; PC2 runtime files were not synchronized.

All **15/15** MSI runtime targets match the guarded candidate. Backup:
`C:/Users/Naos/.openchatx-mcp/headless/toolboxes/agent-runtime/backups/lean-runtime-2026-10-31T15-30-54-162Z-183f6836-929f-42af-acb7-79332bd37057`.

Provider source backup is `letta.js.before-openchatx-recovery` beside the installed
bundle. `letta-recovery-provider-patch.mjs` validates the 0.34.1 source anchors,
supports repeated application, replaces files atomically and restores preimages
on caught failures. Postinstall and helper source are copied to Letta-POC/scripts
and pinned as rebuild overlays. This preserves the patch across dependency
reinstallation without claiming a newly published installer.

The cold updater intentionally accepts the reviewed control-reconnect baseline
or the exact current candidate; unknown local edits fail closed. Current runtime
policy remains `2026-10-28.3`. Installed readiness: ready, running 0, stale 0,
unresolved 0. Local detailed CI/smoke/install logs are under the Codex workspace.
