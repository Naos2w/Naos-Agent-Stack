# Lean runtime update

This is the reproducible source for the local `2026-10-28.2` runtime contract.
It changes the existing Headless runtime; it does not create another runtime,
task database or agent, or publish a new installer release.

From the Naos-Agent-Stack checkout:

```powershell
node runtime/lean-runtime/update-runtime.mjs prepare
node --test runtime/lean-runtime/runtime-contract.test.mjs
node --test runtime/lean-runtime/update-safety.test.mjs
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

[Local application record](APPLIED.md) records the installed version, validation
and backup location for this machine.

The existing Headless exporter includes the updated TypeScript sources. A future
Complete installer still requires its own package/build/fresh-install acceptance;
this local change makes no claim that such a release has been published.
