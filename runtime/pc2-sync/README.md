# Reviewed NAOS-PC migration

This directory records the one-time migration from PC2's legacy four-source-file
toolbox to the MSI candidate from commit `134d25c`. It is not a generic installer,
upstream version upgrade, model backend migration or credential synchronization.

`Build-Pc2Payload.ps1` accepts only the recorded core ZIP hash and selects 74 code,
policy and observer files. It excludes configuration, projects, sessions, tokens,
indexes, product source and the machine-specific search module. The ZIP also
contains disabled QA helper dependencies; their public tools remain disabled.
The existing Letta SSH endpoint and autostart choice are preserved.

`prepare.mjs` runs only on NAOS-PC. It expands source into a new staging directory,
captures exact preimages and records a plan without changing installed files.
Before application, compare every planned after-hash to the locally verified
payload and review the existing sources. `apply.mjs` requires that exact plan's
SHA256 and refuses source drift, active jobs/operations, unresolved effects,
links, existing maintenance or version mismatch. It reuses the established
transactional core updater, backup, rollback and recovery-journal behavior.

Stage `prepare.mjs`, `apply.mjs`, `Run-Pc2Sync.ps1`, the payload's `.gz.b64` as
`payload.json.gz.b64`, and the following unchanged library sources under `lib/`:
`core-maintenance/{apply-audit-diagnostics,verify-core}.mjs` and
`lean-runtime/{runtime_maintenance,runtime_readiness}.mjs`. Run prepare, inspect
`plan.json`, and provide its SHA256 to the scheduled wrapper. The wrapper must
run outside the MCP process tree so its own service stop cannot kill the updater.
Use a temporary limited-user task and remove it after confirmed completion.

Application checks core hashes, actual Worker import, Shell Policy v2 and MCP
health while preserving the captured configuration and registry bytes. A failed
post-update check stops MCP before rollback; successful rollback restarts it.
If rollback leaves a journal, the service and pause marker stay in place for
explicit recovery. No timer steals a maintenance lock. A power-loss test was not
performed and automatic recovery from every interruption is not claimed.

Final public probes and real read-only model/tool calls are recorded in
[the MSI/PC2 closeout](../MSI_PC2_CLOSEOUT_20261031.md). Historical state hashes in
the migration plan describe the instant before the later smoke operation, which
normally advances the existing session and its operation registry.
