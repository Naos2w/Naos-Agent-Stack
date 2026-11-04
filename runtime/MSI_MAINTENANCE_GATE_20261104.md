# MSI architecture maintenance eligibility — 2026-11-04

This note documents the **OpenChatX → Letta architecture only**, not any downstream product task or delivery milestone.

## Root cause

The previous core-updater gate used `inspectRuntimeReadiness().ready` as a prerequisite for maintenance. A historical failed Operation with `requiresReconciliation=true` correctly degraded operational readiness, but then also blocked deploying the health/reconciliation corrections themselves. A second defect treated historical PIDs as current Workers: four old PIDs were demonstrably reused by later Windows processes, while a fifth PID had no process in Windows CIM despite a positive Node probe.

## Changes

- `runtime_readiness.mjs` retains the existing strict **operational** readiness semantics, and adds separate `inspectRuntimeMaintenanceEligibility`. Maintenance can proceed with unresolved historical Operations only when the registry is valid and quiescent, every Worker is terminal, and no admission/maintenance lock or pending recovery journal exists. The historical reconciliation count is preserved, never rewritten.
- Terminal Worker PID checks now use a bounded Windows process creation-time query only for potentially live PIDs. A process demonstrably created after the last recorded Operation update is a reused PID. Two independent OS queries finding no matching PID prove it absent. A missing/contradictory/permission-denied query, potentially still-running Worker, or PID of uncertain generation blocks maintenance.
- `core-maintenance/apply-audit-diagnostics.mjs` uses the separate eligibility check *before* acquiring the exclusive Runtime maintenance lock, and rechecks quiescence while holding that lock. Existing PM2 stop verification, active durable-job checks, watchdog pause, fixed-target source hashes, backups, transactional rollback, recovery journal, core SHA verification and restart health checks remain mandatory.
- The core updater now recognises exactly two **complete** approved preimage sets: `bootstrap-preimages.json` (original baseline) and `upgrade-preimages-20261102.json` (prior installed `2026-11-02.context.1` overlay). Partial mixtures and unknown bytes fail closed. The destination is the current `2026-11-04.health.1` 15-file overlay committed earlier.

## Checks observed

- Isolated maintenance/upgrade scenarios: 14/14 passed, including stale/running worker, corrupt registry, lock owner, incomplete update, reused PID and vanished PID.
- Full architecture tests: 32 test files; 255 total, 248 passed, 7 skipped, 0 failed. `git diff --check` clean; 57/57 pinned rebuild sources match.
- Actual MSI **read-only**: operational readiness `DEGRADED` with 3 preserved historical unresolved Operations, zero running and stale Workers; maintenance eligibility `allowed=true` with reason `HISTORICAL_RECONCILIATION_PRESERVED`.
- Actual MSI **read-only upgrade preflight**: 33 pinned target preimages matched, five target bytes need updating, one new snapshot file. No installed bytes were changed by this inspection.
- A separate Durable Job was active at the first deploy preflight. Never stop or replace such jobs just to release this patch. Production deployment, provider patch installation and PC2 synchronisation must be reported separately from source-level completion.

## Release guard

Only apply when the actual lock/job/watchdog and required CI/PR gates all pass. A source commit is not a deployed service; a healthy MCP connection is not proof that the Letta task layer is healthy. Never clear an unfinished Operation, reissue its tool side effect, override a platform denial, or mark a user project delivered as part of core maintenance.
