# MSI optimization acceptance — 2026-10-30

## Later user-requested model change

After the initial acceptance below, the user requested GPT-6.1 Sol with High
reasoning. The existing MSI Letta-POC Agent was changed from
`openai-codex/gpt-5.6-sol` / `low` to `openai-codex/gpt-6.1-sol` / `high`.
The existing `local-conv-84` conversation inherited the new Agent setting without
adding or changing a conversation override. The ChatGPT OAuth provider was
preserved. No other project's Agent, global new-Agent reasoning default, PC2
configuration or execution engine was changed.

The configured model catalog advertised the requested handle and High reasoning;
the [official model documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
also lists High as supported. A shared maintenance lock protected the setting
change and the previous redacted model configuration was saved before mutation.
Before/after records are in
`benchmarks/development-v1/runs/msi-sol61-high-20261030-a.config-*.json`.

Real operation `op_b8c0d3f90b21493e` resumed the same existing session. Its worker
observed `openai-codex/gpt-6.1-sol` / `high` at `2026-10-30T13:40:44.341Z`
(21:40:44 Asia/Taipei). It completed all three development fixtures with 18
external tool calls, no denial and no corrective follow-up prompt. Independent
grading confirmed all eight tests passed, immutable files remained unchanged and
no unexpected files were added. The Runtime returned to ready with no running,
stale or unresolved operations and no maintenance lock.

Run evidence: `benchmarks/development-v1/runs/msi-sol61-high-20261030-a.*.json`.
Initial fixture hashes matched the earlier baseline. This validates availability
and the development tool chain after the model change; the persistent session
had already seen the earlier tasks, so this is not an unbiased model comparison.
Reported usage remains unavailable. The local catalog's 272000 context limit was
preserved; this request did not change context-window policy.

## Earlier platform acceptance

Scope: improve the existing MSI Letta workflow before any PC2 synchronization.
PC2, product repositories, Agent model settings and the execution engine were
not changed. This record covers the first three agreed steps: model visibility,
reliable handoff and a reproducible development baseline.

## Applied behavior

- Runtime now reports an allowlisted, timestamped Agent configuration observed
  before a run. Successful polling and session status preserve that observation.
  A stale operation cannot overwrite a newer session's model observation.
- An ineffective `model` argument fails explicitly instead of silently keeping
  the existing Agent configuration. No model is automatically migrated.
- Token usage is returned only when reported by Letta; unavailable usage remains
  null. Configuration is not proof of the provider's execution or live context use.
- Summary retrieval is repeatable. Deletion requires acknowledgment of the exact
  revision; retries receive a durable receipt. Failed writes preserve prior state,
  concurrent mutations are serialized and stale acknowledgments cannot delete an
  updated summary. New summaries have a seven-day expiry; legacy records retain
  their existing lifetime. Server instructions and tool schema now agree.

Runtime policy remains `2026-10-28.3`; additive model observation is version 1.
The installed core overlay is `2026-10-30.handoff.2`, with ten hashed modules and
snapshots. Project routing, permissions, replay protection and release gates are
preserved.

## Validation performed

- 50 affected Runtime, summary, installer rollback and rebuild tests passed with
  zero skips. After the server-instruction correction, the 15 affected core,
  summary, updater and rebuild tests passed again.
- All three candidate TypeScript files transformed and passed syntax checks.
  Seven existing worker entrypoint/recovery tests passed. The real candidate
  entrypoint refused dispatch while maintenance held the admission lock.
- Windows PowerShell 5.1 source validation passed after the final source changes,
  including packaging checks, rollback fixtures and install dry-runs.
- MSI's actual loopback MCP endpoint exposed the new acknowledgment schema and
  instructions. A synthetic handoff survived two reads, acknowledged successfully
  and returned a successful receipt on acknowledgment retry. No existing summary
  or historical denied product operation was used.
- Both guarded core applications restarted MCP successfully. The installed core
  and Runtime source/document hashes were verified after application.

The first candidate-entrypoint check used a restricted environment's remapped
LocalAppData and failed to locate the installed executor. Explicitly pointing the
read-only check at the actual installation resolved it; the final run passed.

## First real development baseline

The [benchmark](benchmarks/development-v1/README.md) starts with three deliberately
failing fixtures and independently checks both acceptance tests and immutable
file hashes after the Agent finishes.

Run `msi-letta-20261030-a`, operation `op_df30548ce9af4ce4`, used the existing
`letta-poc` / `architecture-health-smoke-20261022` session and conversation
`local-conv-84`.

| Case | Initial test exit | Final test exit | Assertions grouped as tests |
| --- | --- | --- | --- |
| Inclusive range validation | 1 | 0 | 2 |
| Async cache failure recovery | 1 | 0 | 3 |
| Normalized invoice consumer | 1 | 0 | 3 |

All three tasks passed independent grading. Only the three allowed source files
changed; tests and task instructions were unchanged and no extra files appeared.
There was one run request, no corrective follow-up prompt, 16 external tool calls,
no denied request and no unresolved blocker. The operation registry's accepted
and completed-observation timestamps span 69.266 seconds; this includes polling
latency and is not pure model time.

The Agent reported `openai-codex/gpt-5.6-sol`, reasoning `low`, context limit
272000, observed at `2026-10-30T10:42:31.416Z`. This differs from the configured
new-Agent default, confirming that changing a default did not migrate this
existing Agent. Usage was null, so no cost or token-saving claim is made.
The exact prompt, observations, initial hashes and grader output are in
`benchmarks/development-v1/runs/msi-letta-20261030-a.*.json`.

## Recoverable local delivery

Runtime backup:
`C:\Users\Naos\.openchatx-mcp\headless\toolboxes\agent-runtime\backups\lean-runtime-2026-10-30T10-38-40-647Z-5d56cb63-3bcc-4385-9558-a54cbaf97f61`.

Core backups, in application order:
`C:\Users\Naos\.openchatx-mcp\headless\backups\core-audit-jJMGbb` and
`C:\Users\Naos\.openchatx-mcp\headless\backups\core-audit-pfdWYW`.

Final artifacts in `C:\Naos\02.Git\personal`:

| Artifact | SHA256 |
| --- | --- |
| `Naos-Agent-Stack-core-handoff-20261030.2.zip` | `B09C105279DB8AFA162BB6D103D9EA826765F07B1420CE64C375E63A630DFA03` |
| `Naos-Agent-Stack-v0.2.3-Complete-handoff-20261030.2-candidate.zip` | `697109B776D378068CA7EBF3F74A7E9D38FB6B99CBC32048BE02F951B1A25CC1` |

The core is rebuilt from the unchanged pinned base and 39 repository overlays.
The final Complete ZIP is 285668626 bytes. The bundled payload and dependency
lock point at this final core, superseding the local handoff.1 candidate.
All 39 packaged overlay hashes were independently verified against the final
rebuild lock. Four critical Complete ZIP entries (builder, bootstrap, dependency
lock and core payload) matched the workspace. No watchdog pause or core recovery
journal remained; Runtime verification still matched all ten installed files.

## Remaining boundaries

This is an initial small-task baseline, not evidence of a quantified improvement
or Codex-equivalent capability. A controlled comparison with Codex app-server and
an explicit model-setting comparison remain the next architecture evaluation.
No engine migration, PC2 sync, clean-machine installation, reboot acceptance,
production publication or Git push is claimed. Changes remain in the existing
dirty checkout; unrelated changes were preserved.

This already-open client still exposes the old cached direct summarize schema.
The running server's fresh `tools/list` and initialize response were validated
with the new contract; client metadata must be refreshed to expose ack_uuid in
that client. Legacy retrieval remains safe and repeatable in the meantime. The
server repair does not grant control over client-side tool caching.
# Later model routing delivery

The subsequent MSI task-based routing implementation and superseding local
candidate packages are recorded in [MSI model routing](MSI_MODEL_ROUTING_20261030.md).
The earlier observations below retain their original models and test scope.
