# MSI and PC2 architecture closeout — 2026-10-31

MSI verification and the subsequent PC2 synchronization are complete within the
owner's current scope. Fresh Windows and whole-stack installation testing remain
excluded. No release, Git push, product deployment or new Agent was performed.

## MSI final live verification

Operation `op_048effbaf262454e` reused the existing `local-conv-84` conversation.
It observed GPT-6.1 Sol / high and completed one `openchatx_read_file` call against
the known 47-byte synthetic marker. There were no writes, denied calls or pending
reconciliation. Independent byte/hash verification confirmed the marker was
unchanged. MSI readiness remained ready with running/stale/unresolved all zero.

## PC2 migration and live verification

PC2 was still on the earlier four-source-file toolbox and Shell Policy v1.
Its existing shared Letta endpoint `ws://127.0.0.1:4501` was available, with
autostart disabled. These host-specific choices were preserved.

The reviewed MSI core candidate from `134d25c` supplied 74 code/policy/observer
files: 73 changed bytes and one retained the same idempotency implementation.
Every planned after-hash matched the locally verified package. The 18 existing
targets were read before replacement. Other core sources matched MSI except
PC2's separate search modification, which was deliberately preserved.

A temporary limited-user scheduled task ran outside the MCP process tree,
paused maintenance, checked idle jobs and operations, captured exact backups and
used the existing transactional updater. Post-update checks verified all 10 core
modules, actual Worker imports, Shell Policy v2 and a healthy MCP restart.
Configuration, projects, sessions and operations matched their captured preimages
at migration completion. No credentials or MSI host configuration were copied.

Backup: `C:/Users/simpl/.openchatx-mcp/headless/backups/core-audit-HuALwO`.
The task finished with exit code 0 and was removed. All 74 installed target hashes
were checked again after the public smoke test. No maintenance pause, pending
journal, running operation, stale Worker or unresolved operation remained.

The refreshed public tool schema exposes Letta, model routing, task references
and exact-file hints. A live PC2 operation `op_86da65342bb448e0` reused
`go-travel/pc2-main`, conversation `local-conv-49`, with its existing Agent.
It applied the requested GPT-6.1 Sol / high setting to that conversation and
completed exactly one read of the inspected, credential-free `package.json`.
Its result was the correct package name/version, with one successful tool call,
zero denied calls, zero changed files and no reconciliation requirement. The
file hash and clean Git worktree were independently verified before and after.
Index metadata was honestly reported changed; no index rebuild was performed.
This normal smoke run advanced that existing session/operation registry after
the migration's byte-preservation check. The normal config reader also populated
its new-Agent default field; endpoint, credentials and autostart policy were not
reconfigured. Other conversations' model settings were not changed.

## Additional updater repair

PC2's real PM2 response contains both `username` and `USERNAME` environment keys.
PowerShell 5.1's case-insensitive JSON conversion rejected them. The old test's
PowerShell mock missed this real native-output behavior. A replacement regression
reproduced the failure before the fix.

`apply-offline.ps1` now asks Node to project only name/PID/service status before
passing JSON to PowerShell. Environment data is omitted. Windows PowerShell 5.1
validation passed for case-distinct keys, native command failure, invalid JSON,
health-state classification and observer rollback. The sync's existing Node
transaction also handles PM2 JSON natively. Seven scoped path/transaction tests
passed; the saved builder reproduced the applied payload byte-for-byte.
The final full Runtime CI command passed **166 tests, 0 failed, 0 skipped**.

Evidence: [migration hashes and live checks](pc2-sync/verification-20261031.json).
Source and reproduction notes: [reviewed PC2 migration](pc2-sync/README.md).

## Retained protocol boundary

Letta 0.34.1 cannot transparently resume every interrupted tool approval. Unknown
effects remain protected and require investigation of the original operation.
This remains an explicit operational limitation, not a claim of automatic
recovery, exactly-once remote execution, or Codex-equivalent development speed.
Both machines can now use the verified ordinary development workflow.
