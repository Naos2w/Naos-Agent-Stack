# Lean runtime update

This is the reproducible source for the local `2026-10-28.3` runtime contract.
It changes the existing Headless runtime; it does not create another runtime,
task database or agent, or publish a new installer release.

From the Naos-Agent-Stack checkout:

```powershell
node runtime/lean-runtime/update-runtime.mjs prepare
node --test runtime/lean-runtime/runtime-contract.test.mjs
node --test runtime/lean-runtime/update-safety.test.mjs
node --test runtime/lean-runtime/model-routing.test.mjs runtime/lean-runtime/model-observation.test.mjs
node --test runtime/lean-runtime/codebase-context.test.mjs runtime/lean-runtime/context-paths.test.mjs
node --test runtime/lean-runtime/tool-evidence.test.mjs
node runtime/lean-runtime/verify-candidate.mjs
node runtime/lean-runtime/update-runtime.mjs apply
node runtime/lean-runtime/update-runtime.mjs verify
```

`prepare` reads the installed source and produces `.candidate/manifest.json`,
exact preimages and candidate files. Inspect the diff before `apply`.
`apply` only targets the current user's installed agent-runtime. It shares a
cross-process admission mutex with the facade and every CLI worker, refuses
active operations/leases and concurrent source changes, and keeps exact backups.
Mid-update or final verification failure triggers rollback. A failed rollback
preserves a recovery journal and blocks dispatch until `recover` completes.
It requires permission to write that installation directory. Do not use it to
override an authorization denial or a concurrent editor.

The generated `.openchatx.mjs` files belong to the existing toolbox loader.
New workers use updated `.ts` source. The first migration from the unguarded
runtime requires offline bootstrap: use `apply-offline.ps1 -Node <Node22Path>`
instead of direct `apply`. It coordinates the existing health-watch mutex and
pause marker, stops only `openchatx-mcp`, applies the update and restores that
service. Direct bootstrap apply refuses an online MCP or unpaused watchdog.
No product-service restart is needed.
For recovery, the backup includes each replaced file and the manifest identifying
new files. `node runtime/lean-runtime/update-runtime.mjs recover` restores matching
installed bytes from the pending journal; it preserves conflicting later edits.
An interrupted updater can leave the admission mutex behind. With MCP/watchdog
stopped and its recorded owner PID confirmed dead, remove only the stale
`.runtime-maintenance.lock` directory, then run recovery. This is explicit
recovery, not a promise of automatic power-loss/crash recovery.

[Current behavior and policy](CURRENT_RUNTIME.md) is also installed as the
runtime README. Historical runtime notes are preserved separately.

[MSI model routing validation](../MSI_MODEL_ROUTING_20261030.md) records the
conversation-scoped profiles, explicit user preference, live model/tool checks,
guarded application and current reproducible candidate packages.

[MSI context validation](../MSI_CONTEXT_VALIDATION_20261030.md) records the later
missing-index/query-error distinction, honest coverage metadata and updated
local delivery.

[MSI exact-file context validation](../MSI_FILE_CONTEXT_VALIDATION_20261030.md)
records the subsequent optional task-file hints, bounded per-file metadata
queries, live Worker/tool verification and corresponding package delivery.

[MSI tool evidence and continuity validation](../MSI_TOOL_EVIDENCE_CONTINUITY_20261031.md)
records successful/failed tool outcomes, observed direct-write effects, and a
real two-stage development task resumed after compaction in the same conversation.

[Current reliability validation](RELIABILITY_VALIDATION.md) records the installed
.3 version, tests, backups, local candidates and remaining acceptance work.
[Local application record](APPLIED.md) preserves the earlier .2 application.

[MSI unresolved-effect dispatch validation](../MSI_DISPATCH_RECONCILIATION_20261031.md)
records same-conversation dispatch/compaction protection, the current installed
revision and rebuilt candidates. Fresh Windows and whole-stack acceptance are
excluded from the current MSI task by the owner.

[MSI/PC2 closeout](../MSI_PC2_CLOSEOUT_20261031.md) records the subsequent real
model/tool checks on both hosts, completed PC2 migration and PM2 compatibility fix.

[MSI Letta reconnect repair](../MSI_LETTA_RECONNECT_20261031.md) records the later
control-connection recovery, actual approval/in-flight fault injection, 175-test
CI run and guarded MSI installation. This repair is not yet synchronized to PC2.

The existing Headless exporter includes the updated TypeScript sources. A future
Complete installer still requires its own package/build/fresh-install acceptance;
this local change makes no claim that such a release has been published.

The reviewed facade/worker are also preserved in `source/`; `policy/` contains
their current documentation overlays. `../rebuild.lock.json` pins their content
and an exact base core ZIP. Rebuild without inspecting an installed runtime:

```powershell
powershell.exe -NoProfile -File runtime/Rebuild-CoreBundle.ps1 -BaseBundlePath <PinnedBaseZip> -OutputPath <NewCoreZip>
```

This reconstructs the pinned compiled overlay, not missing upstream TypeScript
sources. Verify per-file content identity; ZIP creation timestamps can differ.
`runtime/Install-HealthObservers.ps1` updates only the read-only observer files,
with backups, verified replacement and rollback on caught errors. It does not
restart services or promise automatic recovery after process/power interruption.

The current full installer preserves existing installations. It remains a
fresh-install candidate, not a generic full-platform upgrader. Test a clean
Windows VM, reboot and cross-host behavior separately before a release claim.
