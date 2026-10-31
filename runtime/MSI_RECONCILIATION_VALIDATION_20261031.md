# MSI stopped-operation reconciliation — 2026-10-31

## Reproduced defect and correction

The existing Letta test Agent and conversation accepted a read-only, one-second
timeout probe (`op_ee8d98ebbd1f403c`). Its Worker exited with
`LETTA_TURN_TIMEOUT_REMOTE_UNCERTAIN`, zero external tool requests and zero
completed external tools. A later read-only server inspection found the same
conversation idle with an empty queue and no active runs.

The facade's `cancel` branch returned immediately when a Worker had already
stopped, except for a separately proven backend-orphan case. Consequently, it
had no general path to persist a later confirmed settlement. Polling repeatedly
derived the original uncertain result from the preserved Worker output.

Explicit cancellation now verifies the retained project, Agent, conversation
and exact client-message identity before calling the existing ownership-aware
remote cancellation protocol. It records the confirmed settlement under the
Operation lock and preserves it across later or racing polls. A changed
Operation cannot receive another Operation's settlement.

Remote settlement does not convert failed work into success, prove rollback,
or permit automatic retries. In-flight tools, uncertain idempotency records and
missing execution evidence remain unresolved. A settled failure asks for
`inspect_failure_before_retry`, avoiding repeated reconciliation guidance.

## Verification and local application

- Final Node CI list: **143 passed, 0 failed, 0 skipped**, including installed
  dependency-enabled handoff tests.
- Candidate TypeScript transformation, syntax, seven Worker entrypoint/recovery
  tests, and actual maintenance admission refusal passed.
- Windows PowerShell 5.1 source/isolated packaging suite passed in this turn,
  including the three new core rebuild scenarios.
- Updater used maintenance admission, backups and transactional replacement.
  All **13 installed targets** match the final candidate.
- The original timeout Operation was explicitly cancelled through OpenChatX.
  The server confirmed `already_idle`; reconciliation became `settled` with
  `requiresReconciliation=false`. Repeated polling preserved the receipt and
  retained the original failed state and error. No prompt was replayed.
- Runtime readiness after the live check: ready, running=0, stale=0,
  unresolved=0, no maintenance lock.
- Final core and Complete candidates were rebuilt. All **42 core overlays**
  and five critical Complete entries match their exact source bytes.

Final updater backup:
`C:/Users/Naos/.openchatx-mcp/headless/toolboxes/agent-runtime/backups/lean-runtime-2026-10-31T04-28-50-956Z-2543a295-6a21-4130-a05f-92bc83600c21`.

See [live evidence](benchmarks/reconciliation-v1/msi-20261031.json) and
[candidate hashes](benchmarks/reconciliation-v1/packages-20261031.json).

## Delivery status and limits

The earlier 112 source/evidence files are saved in local commits `5f6567d`,
`cf2a131`, and `1e3d3aa`. The real core rebuild optimization is `f8048f9`;
[its measured result](benchmarks/rebuild-v1/README.md) is 183.174 s to 20.500 s
for one local pair, with all 2,970 payload files unchanged and essentially
unchanged process memory. This does not measure general Agent development speed.

This live probe validates stopped-Worker reconciliation without external tools.
It does not establish recovery of interrupted tool approvals, effects in flight,
power loss, or exactly-once remote execution. Letta 0.34.1 limitations remain.

Fresh Windows installation, reboot and a generic full-platform upgrade remain
unaccepted. The current account's read-only `Get-VM` query returned insufficient
Hyper-V authorization, so no disposable VM was identified or modified. No
production installation, release, Git push or PC2 synchronization was performed.
