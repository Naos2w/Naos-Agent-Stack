# MSI unresolved-effect dispatch validation — 2026-10-31

The later [MSI/PC2 closeout](MSI_PC2_CLOSEOUT_20261031.md) records final live
verification and the completed PC2 synchronization. The scope below describes
this earlier MSI-only application.

Fresh Windows and whole-stack installation acceptance remain explicitly excluded
by the owner. MSI is the only target; PC2 was not accessed or synchronized.

## Reproduced defect and correction

The existing dispatch checks accepted a new turn after an uncertain failed
operation had been polled and the remote listener reported idle. They checked
active workers and the polling cursor, but not retained tool-effect evidence.
A new model turn can issue a new tool-call identity, outside the original
identity's replay protection. The extracted actual dispatch regression failed
before the fix with `Missing expected rejection` and started its fixture Worker.

The source-controlled reconciliation module now checks all retained operations
for the same Project and actual conversation. Incomplete, invalid, in-flight or
uncertain tool evidence produces `OPERATION_EFFECTS_UNRESOLVED` identifying the
original operation. Dispatch checks before contacting Letta and again inside
the existing operations lock. Manual and automatic compaction also refuse to
discard the affected conversation context.

A newer successful operation or a renamed session bound to the same conversation
cannot conceal the evidence. Independent conversations remain available. Proven
zero-call timeouts and complete recorded tool outcomes retain the existing
remote-state checks and backend-orphan recovery path. This guard does not clear
records, declare remote settlement, retry tools or authorize replacing identities.

## Verification and MSI application

- Seven new tests exercise the actual extracted dispatch/compaction functions,
  late-arriving uncertainty, conversation scope, malformed evidence and migration.
- The complete existing Runtime CI command passed: **165 tests, 0 failed, 0 skipped**.
- Candidate TypeScript transformation/syntax and **7 Worker entrypoint/recovery
  tests** passed. The real candidate Worker refused dispatch during maintenance.
- Existing Windows PowerShell 5.1 source/dry-run and runtime-health validation
  passed, including isolated observer rollback and offline-updater parsing.
- Guarded MSI application verified all **15 targets**; only the facade,
  reconciliation helper and installed README changed bytes. Exact preimages are
  retained in the backup recorded in the evidence file below.
- The public OpenChatX `agent_runtime(status)` returned `ok=true`, Letta 0.34.1
  `serviceState=ready` and `protocolCompatible=true`. Its generated facade contains
  all three new guard call sites, confirming loader refresh without a restart.
- Readiness after application: `ready=true`, running/stale/unresolved all zero.
- Core and Complete candidates rebuilt. **44 core overlays** and five critical
  Complete entries match source hashes; no installer was executed or published.

Package hashes, changed targets, backup and bounded validation metadata:
[dispatch evidence](benchmarks/inflight-v1/dispatch-20261031.json).

The same source was tested through extracted real functions and installed with
exact hashes. A real model was not deliberately interrupted this round; this
record does not claim live approval-resumption acceptance. Letta's previously
verified interrupted-approval limitation remains. Unknown effects still require
investigation of the original operation; local protection cannot invent their
outcome. Existing [context efficiency measurements](MSI_CONTEXT_EFFICIENCY_20261031.md)
remain valid, with this record superseding only their installed/package revision.
