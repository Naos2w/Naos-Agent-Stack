# OpenChatX protocol and audit repair — 2026-10-29

Installed overlay: `2026-10-29.protocol.1`, on `openchatx-mcp@1.0.0-beta.2`.
Runtime policy remains `2026-10-28.3`.

## Scope and evidence

- Preserve declared MCP tool annotations instead of pruning defaults. Missing or
  invalid booleans receive conservative defaults. Actual installed `tools/list`
  returned 24 tools with all four boolean hints present. `bash` and `file_edit`
  remain non-read-only and destructive; no permission was relaxed.
- Record remote authentication failures before dispatch as `remote_auth`, with
  HTTP status and explicit RPC code. Authentication headers, subjects and tool
  arguments are omitted. Rejected batch observation is capped at 32 calls.
- Match bounded JSON/SSE protocol observations to request IDs. HTTP 200 with an
  RPC error is an error; absent or unreadable evidence is `unverified` with a `?`
  marker. Preserve raw response bytes, HTTP headers and status. Do not retain
  response bodies or error messages in the new observer.
- Hash request IDs for correlation. Claimed callbacks continue to own their
  existing audit entry; transport completion does not duplicate it.
- Preserve an already-installed project executor change from the previous day:
  Windows execution uses `MCP_CONFIG.shell.path` rather than a hard-coded
  `powershell.exe`. Its installed bytes were not changed by this update. The
  repository and installed snapshots now match it.

## Validation

Node 22.19.0: **41 tests passed, zero failures, zero skips**, covering:
`core-patch`, `audit-diagnostics`, `audit-update`, `tool-annotations`,
`audit-protocol` and `rebuild-contract`.

The protocol suite includes actual MCP SDK, Express and Node adapter integration
on a temporary `127.0.0.1` port. Three concurrent synthetic requests delivered
two complete echo results and one HTTP 200 / RPC `-32602` error; three audit
entries were associated correctly, with no duplicate callback completion.
No installed-service tool execution or real product request was used.

Windows PowerShell 5.1 `tests/validate.ps1` passed with
`SOURCE_VALIDATION_PASSED`, including package rollback and installer dry-runs.
The initial restricted-environment attempts encountered temporary-file rename,
nested PowerShell initialization and loopback restrictions. Final Node tests
used a workspace temporary directory and explicit SDK path; native isolated
execution was approved for loopback and Windows 5.1 verification.

The first live update detected the stale project executor snapshot and rolled
back all replaced files, then restarted MCP successfully. After reviewing the
two-line existing difference and retaining it, the second application succeeded:

- 17 files applied transactionally; installed project executor left untouched.
- Backup: `C:\Users\Naos\.openchatx-mcp\headless\backups\core-audit-XYPQZk`.
- All seven installed core modules and snapshots matched their SHA256 manifest.
- `/healthz` returned HTTP 200; actual `tools/list` verified the new annotations.
- No maintenance pause or recovery journal remained.

## Rebuilt local delivery

The core bundle was rebuilt from the pinned base and 33 repository overlays.
All 33 packaged overlay hashes were independently checked against the rebuild
lock. The Complete ZIP's embedded builder, bootstrap, dependency lock and core
ZIP also matched the final workspace files. The default bundled core payload
and `dependencies.lock.json` now point to this revision.

Artifacts are in `C:\Naos\02.Git\personal`:

| Artifact | SHA256 |
| --- | --- |
| `Naos-Agent-Stack-core-protocol-20261029.1.zip` | `763319725A6EE6CDB255C04F83631269291450B6B949262B95AAD1AFEA8A1BE0` |
| `Naos-Agent-Stack-v0.2.3-Complete-protocol-20261029.1-candidate.zip` | `994E3824B4F5207340D71D3C5C9CCAB282ACDFA340853BC121B9A800B52DB201` |

The Complete ZIP is 285,657,212 bytes. Its sibling `.sha256.txt` records the hash.

## Limits

This repairs confirmed OpenChatX contract and observability defects. It does not
prove what triggered historical OpenAI platform refusals or guarantee that every
future tool call will be accepted. No previously denied HouseLook or S-Wallet
operation was replayed. Generic `tool_call` dispatch still exposes aggregate
annotations; splitting that interface remains separate architectural work.

No new-machine installation, reboot acceptance, production publication or Git
push is claimed. Source changes remain uncommitted in the existing checkout;
unrelated working-tree changes are preserved.
