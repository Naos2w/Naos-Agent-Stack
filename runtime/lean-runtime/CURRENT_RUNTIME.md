# Current OpenChatX Agent Runtime

Policy version: **2026-10-28.2**. Active execution uses **Letta only**.
OpenCode and the standalone Phase 2 toolbox are retired. Their records and
POC results are historical evidence, not current operating instructions.

The authoritative installed workflow is
`rules/shared-development-preflight.mdc`. Explicit current user instructions,
Project permissions and applicable repository release requirements retain
their existing precedence. This document does not grant permission to publish.

## Responsibilities

- The existing project task/TODO owns the goal, acceptance criteria and next
  approved action. Keep using that record; do not create a second task ledger.
- `agent_runtime` owns operation/session lifecycle, permissions, cancellation,
  replay protection and execution evidence. It does not certify product delivery.
- Actual tests, repository CI, user approvals and deployment evidence determine
  readiness at the appropriate stage. Optional review is explicit opt-in.

## Normal work

1. Select the authorized Project and existing named Letta session.
2. Read the current task and relevant source. Use one Developer by default.
3. Run the next actionable item. Optional `task_ref` identifies the existing
   item, for example `tasks/todo.md#D5`; it is not a filesystem access grant.
4. Poll the accepted operation before starting another turn in that session.
5. Check the existing task's acceptance criteria against real evidence. Update
   that task and continue independent authorized work when one operation is blocked.

Normal runs inspect development context without writing development receipts.
Read-only inspection still enforces existing Project/task/applicable skill
checks. Public disabled QA tools stay disabled. An audit receipt is neither a
new task nor merge/deploy authorization.

## Result contract

- Existing `state` and `ok` retain operation lifecycle semantics.
- `execution.state` makes that scope explicit.
- `delivery.state=not_evaluated` and `acceptanceVerified=false` mean the runtime
  has not evaluated the product acceptance criteria, even after a successful run.
- `delivery.taskRef` preserves the caller's existing task identifier in the
  operation registry and polling result. Omission remains compatible with old callers.
- `next_move` identifies polling, checking acceptance, resolving the affected
  operation, or reconciling uncertain side effects. It never authorizes a retry.
- A stale poll cannot direct work for a newer operation. It asks the caller to
  inspect the current operation instead.
- `runtimePolicy` identifies this contract and the current rules entrypoint.

## Permissions and recovery

Project read/write/shell boundaries use the existing ProjectExecutor API v1.
The installed core uses Shell Policy v2; its version is independent of the
ProjectExecutor API version.
The external-tool replay ledger, operation locks, session ownership and
cancellation correlation remain authoritative. A failed or cancelled operation
must be reconciled before retrying a possible side effect. Letta's interrupted
external-tool approval limitation is not permission to repeat the operation.

`run`/`compact` manage the configured local App Server on demand. `status` and
`probe` do not start it. Never start a model CLI for routine verification.

## Source and maintenance

The installed `.ts` files are the runtime sources; the toolbox loader generates
`.openchatx.mjs` files. New workers read current TypeScript source. Initial
maintenance-protocol installation requires a brief stop/restart of the managed
MCP process, coordinated with its health watcher. Product services are unaffected.

The reproducible change, regression tests and guarded installer live in
`Naos-Agent-Stack/runtime/lean-runtime`. `prepare` captures the exact installed
preimages, builds a candidate and records hashes; `apply` refuses drift or
running operations, keeps backups and only changes the listed runtime files.
The facade and every CLI worker acquire activity leases through the same
cross-process admission mutex used by the installer. Maintenance refuses live
leases or running operations and prevents new dispatch throughout replacement,
verification and rollback. It also covers synchronous inspection/compaction.

Caught apply/verify failures restore exact preimages (including removal of newly
introduced files). Concurrent edits are preserved and reported. A failed rollback
leaves a recovery journal that blocks all new runtime actions until `recover`
completes. Backups and journal support recovery after process interruption; there
is no claim of automatic recovery from power loss. An abandoned mutex is never
stolen on a timer: stop MCP/watchdog, verify its recorded owner PID has exited,
and remove only that stale mutex directory before explicit recovery.

`verify` checks installed bytes. No credentials, session data, operation records
or permissions are changed. This is a local runtime update, not publication of
a new Naos-Agent-Stack release or completion of clean-Windows installer acceptance.

Earlier runtime notes are preserved in `docs/history/runtime-before-20261028.md`.
Use those only to investigate a specifically dated event.
