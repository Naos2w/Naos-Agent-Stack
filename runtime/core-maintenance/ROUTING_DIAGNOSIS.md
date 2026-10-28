# OpenClaw routing diagnosis and applied audit fix

Status: core audit revision `2026-10-28.audit.1` is installed on MSI. The MCP
service was restarted and is healthy. Public `project_manage(action=use,
project_id=openclaw)` and a subsequent scoped read of `AGENTS.md` both succeeded
in the validation conversation. This confirms current routing/read access, not
the cause of the historical rejection or completion of OpenClaw product TODOs.

## Original local evidence

All times below are 2026-10-28, UTC+08:00. Source:
`C:/Users/Naos/.openchatx-mcp/headless/logs/agent-commands.yaml`.

| Time | Local evidence | Line |
| --- | --- | --- |
| 18:15 | Successful start_here, agent-9, task openclaw-ordered-live-release-20261028 | 761425 |
| 18:46 | Failed capability_list(action=health); error code was not logged | 763501 |
| 18:47 | Successful project_manage(action=list) | 763549 |
| 18:47 | Successful project_manage(action=list) | 763577 |

There is no project_manage(action=use) entry for this task in the active audit.
There are 19 successful OpenClaw use entries elsewhere that day, most recently
at 16:51. The local audit starts tracking incoming tools/call requests before
dispatch, including unclaimed SDK/transport outcomes. These facts support that
the reported rejected selection did not reach this local request boundary.
Absence does not identify a platform policy or prove a false positive.

The conversation's assistant reported a platform rejection and the later
PROJECT_ROUTING_REQUIRED error. The original platform response was not available
through the conversation reader. The local generic-tool audit records only a
failure marker and arguments, so it cannot retrospectively prove the health
call's exact error code either. Earlier reports were corrected accordingly.

## Confirmed defect and applied change

The original `dist/server/audit/audit-format.js` dropped ToolError.code when
summarizing exceptions and omitted failure diagnostics for generic tools. The
reviewed source in `baseline/audit-format.js` preserves explicit exception/structured-result codes
and writes bounded metadata for failed calls:

```yaml
failure: {"observed_at":"openchatx_mcp","kind":"tool","code":"PROJECT_ROUTING_REQUIRED","code_source":"exception"}
```

This records where the failure was observed and where the code came from. It
does not classify an external platform decision. Transport failures are distinct;
missing codes remain null/unavailable. The formatter does not infer a code from
arbitrary message text or add generic error bodies to the log. Existing specialized
tool logging behavior is retained. Successful calls do not gain failure fields.

Compatibility: openchatx-mcp@1.0.0-beta.2 only; exact installed preimage SHA256:
`ADE5949CD392FEA4C1F2D81BF1E1A8387ABC152A03F0B62EC40F7EA44E5EBB77`.
Installed and source SHA256:
`A6702EBA21A04B8CCD287781509AB3BC14E86EAD9F50968AE4DCFF258565DF87`.

## Validation

- Against the installed original formatter, six of seven diagnostic tests fail
  because failure metadata is absent; the unchanged-success test passes.
- Against the candidate, all seven tests pass, including code preservation,
  malformed codes, sensitive message suppression, numeric RPC codes, text-only
  uncertainty and transport failures.
- Node syntax checking passes.
- `verify-routing-diagnostics.mjs` uses the actual installed routing boundary,
  context, audit logger, tokenizer and helpers in a separate process. It injects
  the candidate formatter and writes only a generated temporary log. A simulated
  pending session still blocks the callback and retains pending status; the
  resulting real ToolError code reaches the log. Integration passes.
- The integration check verifies the installed formatter is byte-for-byte
  unchanged. It makes no service request, selects no real project and removes
  only its own validated temporary fixture directory.
- All 44 tests in the manual workflow's Node command pass in native Windows,
  including six new update/rollback tests. Sandboxed atomic replacement is
  restricted, so transaction tests were run outside the sandbox on their own
  disposable temporary files.
- Full source/package validation passes with `SOURCE_VALIDATION_PASSED`.
- `git diff --check` passes. No remote CI run or published release is claimed.

Commands from the repository root (Node 22.19.0):

```powershell
node --test runtime/core-maintenance/audit-diagnostics.test.mjs
node --check runtime/core-maintenance/baseline/audit-format.js
node runtime/core-maintenance/verify-routing-diagnostics.mjs <installed-runtime-root>
```

## Live application and verification

The first update attempt detected a newly started background job and exited
without stopping the service or changing files. The bounded-wait updater then
waited for an idle interval, held the Runtime admission mutex, paused the watchdog,
stopped only openchatx-mcp, applied six verified files and restarted the service.
The tunnel and product services were not stopped.

Backup: `C:/Users/Naos/.openchatx-mcp/headless/backups/core-audit-6u4hLl`.

The installed core verifier reports `CORE_PATCH_VERIFIED ... files=3`; watchdog
CheckOnly reports HEALTHY, with no stale/running operations. The temporary pause
and recovery journal are absent.

A public tool call after the restart returned INITIALIZATION_REQUIRED. The new
local audit retained its exact exception code. The connector envelope reported
INVALID_ARGUMENT while its text retained INITIALIZATION_REQUIRED; the logging fix
preserves the local distinction and does not claim to change connector behavior.
After start_here, the original project_manage tool successfully selected OpenClaw,
then file_read read its AGENTS.md under project_id=openclaw. The validation
conversation was returned to naos-agent-stack afterward.

No new tool alias, global-scope shortcut, permission expansion or annotation
downgrade was introduced. The route/read test did not edit OpenClaw, run its
financial workflows or deploy product code. Other conversations must initialize
and select their own project after the MCP restart; their state was not changed
by sending messages or performing work in them.

## Rebuilt local artifacts

The rebuild lock now contains 25 overlays. The exporter, required-entry lists,
core baseline verifier and Complete builder include audit-format.js. Runtime
policy remains 2026-10-28.3; its facade/worker and Stock compatibility hashes were
not changed by this audit-only update.

| Artifact (relative to repository root) | SHA256 |
| --- | --- |
| `../Naos-Agent-Stack-core-runtime-20261028.3-audit1.zip` | `D88719801FCAF49641ECCC8DC798488A4CF9911639671BD98BE7B971F46B1A2F` |
| `../Naos-Agent-Stack-v0.2.3-Complete-runtime-20261028.3-audit1-candidate.zip` | `7CB8181F1CF71C86007F76960D04AD3644503815F4E95E1AF623D571491BC894` |

The earlier .3 candidate ZIPs are preserved. Fresh-machine/reboot acceptance
remains outside this local maintenance check. The historical platform refusal's
exact cause remains unknown because its original response is unavailable; current
success does not establish why that earlier request did not reach the service.
