# MSI interrupted tools and backend reconciliation — 2026-10-31

## Verified defects and corrections

The previous Worker recorded completed-tool counts only at the turn timeout.
A tool could subsequently finish and persist its idempotency result, while the
Operation remained permanently classified as in flight. Sending that result to
an already closed socket also rejected the asynchronous handler without a
consumer. The new regression reproduced `LETTA_SOCKET_NOT_OPEN` before the fix.

The Worker now records content-free start/completion events around the existing
tool handler. Completion is emitted after the idempotency result is saved and
before response delivery. Failed delivery is recorded without retry or an
unhandled rejection. Reconciliation preserves the original timeout counts and
recognizes later completion only when the bounded event sequence is consistent.
Incomplete, duplicate, contradictory or oversized evidence remains unresolved.
Commands, arguments, paths and result text are excluded from these new records.

Live verification uncovered a second boundary: Letta 0.34.1's listener reported
idle while its local backend retained `local-run-36` from the earlier read-only
timeout `op_ee8d98ebbd1f403c`. The next input `op_dadf867acfb646eb` was rejected
before execution. Thus the earlier listener-idle observation was insufficient
to prove backend settlement; this supersedes that interpretation in the earlier
[reconciliation record](MSI_RECONCILIATION_VALIDATION_20261031.md).

Listener `already_idle` now remains uncertain. Explicit backend-orphan recovery
requires the same Project/conversation, the preceding timeout's exact request
identity and zero external calls, plus a fresh remote check that the latest user
message still belongs to that request and no intervening tool activity exists.
It cancels only the Run identified by the backend conflict, requires confirmation
for that exact Run, and persists settlement for both failed Operations. It does
not rely on elapsed time alone, replay prompts or mark either failure successful.

## Checks actually completed

- **154 Node tests passed, 0 failed, 0 skipped**, with installed dependency-gated
  handoff tests enabled. Candidate transformation/syntax, seven Worker entrypoint
  tests and the actual maintenance-admission refusal also passed.
- Windows PowerShell 5.1 source and isolated packaging validation passed,
  including malformed-bundle rejection and failed-publication preservation.
- Three process-interruption scenarios used the actual Worker handler and
  unchanged idempotency guard in owned test children: before a write, after the
  write but before result persistence, and after persistence. Repeating the same
  identity never executed the write again. Incomplete claims stayed uncertain;
  a completed claim returned its saved result. Tool execution and transport were
  controlled fixtures, not a simulated successful provider run.
- Invalid remote ownership, a newer user message, another Agent, intervening
  tool activity and incomplete evidence are rejected by the recovery tests.
- Live OpenChatX cancellation confirmed `backend_orphan_cancelled` for
  `local-run-36`, preserving both original failure records and no automatic retry.
- After that explicit reconciliation, the same Agent and `local-conv-84`
  completed `op_92696cf9c9fc4cd6`: one successful `openchatx_read_file`, zero
  writes, no shell, observed Sol 6.1/high. The fixed 47-byte synthetic marker's
  SHA256 remained `999BE00564C899D12C53555B496689714BD12FCE757974419FD9214635DD6055`.
- The first smoke-test tool call was rejected by automatic approval review for
  unverified file sensitivity/destination authorization. A local byte comparison
  proved the file exactly matched the source-controlled synthetic constant;
  the same original tool request was then accepted. No alternative tool was used
  to execute the rejected read, and the platform's checks were not altered.
- **14 installed targets** match the final candidate. The existing idempotency
  guard is now source-controlled and pinned; its installed bytes are unchanged.
- Final core and Complete candidates were rebuilt; **43 core overlays** and
  five critical Complete entries match their source hashes.

Final updater backup:
`C:/Users/Naos/.openchatx-mcp/headless/toolboxes/agent-runtime/backups/lean-runtime-2026-10-31T06-20-40-529Z-a21c5be5-85cd-4e55-b3bd-e1854fe10ad7`.

See [execution evidence](benchmarks/inflight-v1/msi-20261031.json) and
[package hashes](benchmarks/inflight-v1/packages-20261031.json).
The earlier `inflight-20261031` candidates are superseded by `.2`.

## Remaining boundaries

Later owner scope update: fresh Windows and whole-stack acceptance were removed
from this round. See [the current context-efficiency record](MSI_CONTEXT_EFFICIENCY_20261031.md)
for that decision, subsequent measurements and confirmed provider limits.

These results do not establish full resumption of interrupted remote tool
approvals, automatic resolution of partial side effects, or recovery after every
power-loss scenario. Unknown claims remain protected. No new Agent, replacement
conversation, provider upgrade, service-wide restart, production installation,
Git push, Windows VM operation or PC2 synchronization was performed.

Real product-task efficiency evaluation and clean Windows/reboot/whole-platform
upgrade acceptance remain separate TODOs. The earlier 89% improvement applies
only to core-bundle rebuilding, not general model or development performance.
