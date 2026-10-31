# MSI Letta control-connection recovery

The MSI Worker now recovers a lost control WebSocket without resending the
user message or executing a tool again. It retains the same Agent, conversation,
approval IDs and tool-call IDs. The installed provider remains Letta 0.34.1;
no provider source or approval policy was modified. PC2 was not changed.

## Root cause and implementation

The previous Worker used a single connection for input, approvals and tool
execution. Installed provider source shows two relevant behaviors:

- `cleanupListenerConnection` cancels an active turn when the last subscribed
  controller disconnects. Its pending approval can no longer simply be resumed.
- An approval executor can retain its original external-tool registration key.
  Re-registering the same tool on a new connection does not update that captured
  identity. The real model returned `External tool controller is not connected`
  when the original owner was lost, even after the approval was reattached.

The Worker now opens two ordinary bidirectional WebSockets for one turn. Input
and approval responses use the control connection. External tools are registered,
rebound and executed only on the stable tool connection. This uses the existing
provider subscriber failover and connection-scoped registration contracts;
neither legacy split-channel parameters nor a second Agent/task/service is used.

Control reconnect has a two-attempt cap within the original deadline. Reattach
sets `recover_approvals=false` and `resume_interrupted_turn=false`, validates
the original scope, and uses the provider's still-live approval replay. It does
not replay input. Tools already executing continue on their original live owner.
Either connection can deliver the original terminal event; the surviving tool
connection retrieves the final messages. Both connections are closed on exit.
Late frames from replaced sockets and foreign tool scopes are ignored.

Loss of the tool connection, both connections, Worker process or Letta process
remains a reconciliation case. Reconnect does not clear incomplete idempotency
claims, reapprove stale backend approvals, or infer that a write did not happen.
New interruption diagnostics are understood by the existing reconciliation
reader, and uncertain operations retain the existing dispatch guards.

## Actual verification

- Full repository Runtime CI: **175 passed, 0 failed, 0 skipped**, 5.271 seconds.
  Includes nine new transport/turn tests, existing idempotency/process-kill,
  cancellation ownership, model routing, rollback, maintenance and rebuild pins.
- Candidate TypeScript transform, JavaScript syntax, seven existing Worker
  entrypoint/cancellation checks and real maintenance-entrypoint refusal passed.
- Real installed Letta/model through a loopback fault-injection proxy:
  - Approval response interrupted: recovered; one user input, one tool effect,
    original approval ID replayed; `local-run-47`, 5.166 seconds.
  - Control lost after the fixture append had begun: recovered; one input and
    one tool effect; `local-run-49`, 7.613 seconds. The tool channel survived.
  These probes use the actual source Worker transport/approval/turn functions
  and unchanged idempotency guard, but a fixed local fixture tool rather than a
  product shell command. They are not cold-restart recovery tests.
- After installation, the full installed Worker with the real ProjectExecutor
  read `Letta-POC/package.json` exactly once and completed `local-run-51`.
  Result: `letta-poc`, `1.0.0`; observed model `openai-codex/gpt-6.1-sol`, high.
  No write/shell tool ran. Existing Agent and conversation were reused.
- Post-install readiness: `ready`, running=0, stale=0, unresolved=0, no lock.

The initial single-connection probe timed out with zero tool effects. A second
prototype retained a passive subscriber but moved the tool owner; it completed
with the controller-not-connected error and zero effects. Neither was counted
as success. They establish why preserving the original tool owner matters.
An attempted exact cancellation of the first test returned `aborted=false`;
no successful cancellation receipt is claimed. Later input processing used the
provider's unchanged stale-approval denial behavior for that test history.

Evidence directories under
`C:/Naos/02.Git/personal/.tmp-openchatx-tests/`:
`letta-reconnect-live-20261031a`/`b` retain the failed probes;
`letta-reconnect-live-20261031c`/`d` retain successful receipts, traces and
one-line fixture effects. Source-controlled copies of the successful receipts
are in `benchmarks/reconnect-v1/`. The first successful receipt predates the final
read-only response retrieval through the surviving tool channel; the second
matches the final installed Worker hash below. Full installed smoke output and
CI log are retained under the current Codex workspace.

## Installation and delivery

Applied through the existing guarded transactional updater; **15/15 installed
targets verified**. Changed behavior is limited to the Worker and reconciliation
reader, with the Runtime README updated. The idempotency implementation is
unchanged. Rebuild pins and the manual CI workflow include this repair.

Rollback backup:
`C:/Users/Naos/.openchatx-mcp/headless/toolboxes/agent-runtime/backups/lean-runtime-2026-10-31T13-54-27-188Z-30f6cd26-ea73-45d9-958e-d8d154127a6b`.

Installed Worker SHA-256:
`B6BC5213A6302D43DAE80C36ACC9B7E9C1E805DB77F10E04DB5BCDAC2CDC9775`.
Reconciliation reader SHA-256:
`104F1A0EC2A21487366E8F1DFED95C1F76160037965AE5989E0F5E46EB516B5C`.

Project `naos-agent-stack` was selected. The read-only development preflight
and Codebase Memory identified the Worker functions; changed metadata required
direct source verification. One Developer used the existing Naos coding and
engineering skills. UI work is not applicable. No PC2 sync, shared Letta restart,
installer publication, fresh Windows acceptance or product deployment occurred.
