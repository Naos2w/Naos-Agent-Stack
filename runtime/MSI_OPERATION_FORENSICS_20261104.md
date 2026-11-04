# MSI original-operation forensic review — 2026-11-04

This is a bounded inspection of the **existing** failed Letta Operations, not a second task ledger, new Agent, acceptance receipt, or authorization to retry a tool. No prompt, tool, application data, or source file in a product repository was replayed, repaired or changed.

## Observed original evidence

| Operation | Project | Original persisted input | Exact tool call/result pairs | Durable side-effect ledgers | Terminal model reply |
| --- | --- | --- | --- | --- | --- |
| `op_b56e869a38d84720` | `houselook/main-letta` | One | 7 / 7 | 5 / 5 completed (`openchatx_shell`) | None |
| `op_6d586f2aacf5453d` | `stock/main-letta` | One | 0 / 0 | 0 | None |

- Both Operations remain **failed**, with original identities and `requiresReconciliation=true`. Their explicit, identity-bound `cancel` inspections reported `already_idle`, not confirmed remote cancellation; neither is evidence of delivery or permission to replay.
- HouseLook's original two Worker attempts recorded `EXTERNAL_TOOL_IN_FLIGHT` with inconsistent per-attempt counts (4 started/3 completed, then 3 started/4 completed). Those counters cannot be naively added or treated as final success. Durable transcript pairs and idempotency records were independently checked instead.
- The HouseLook transcript has seven matching calls and toolResult messages without a later user input; five side-effecting calls have completed ledger records bound to the **same Project, conversation, tool-call ID, exact arguments and result content**. Two ledger results are explicit errors; they must remain errors, not successful product changes.
- Letta 0.34.1's `applyApprovalResults` stored `isError:false` even when the returned approval carried `status:"error"`. The original ledger error text was preserved as an exact toolResult content part (four results also had a short approval annotation prepended), but the historical error flag was not. This is a **provider persistence bug**, not proof the tool was successful.
- Stock's original provider failure was `local_backend_error: ... usage limit has been reached`; the matched original user input has zero subsequent assistant tool calls and tool results. This does not prove model-side acceptance or official research delivery.

## Implementation and limits

- `lean-runtime/operation_forensics.mjs` verifies original Operation identity, the identity-bound remote-idle receipt, no newer input, exact call/result pair matching, supported tool types, completed ledger identity and argument fingerprint, and byte-exact ledger content retained in the transcript. It makes **no writes** and is not an operational settlement action.
- The historical provider error-flag mismatch is accepted for **evidence review only** when a caller separately verified the exact old 0.34.1 persistence behavior; it remains counted as a loss. Unverified or altered content fails closed. Every result explicitly has `mayClearReconciliation:false`, `deliveryVerified:false`, and no claim of terminal model output.
- `lean-runtime/letta-recovery-provider-patch.mjs` now preserves `approval.status === "error"` when persisting **future** approved tool results. Existing transcripts are not modified. `provider-contract.test.mjs` executes the resulting method from the installed, pinned provider source against error, success and legacy outcomes. The changed provider patch is pinned in `rebuild.lock.json`.

## Release and remaining acceptance

The current MCP `capability_list(health)` still reports only service/component availability as healthy, while `runtime_readiness.mjs` correctly reports both unresolved Operations and `DEGRADED`. The previously committed health aggregation fix `984a590` remains a **source candidate** and must use the existing lock/consumer checks/backups/transactional deploy. Do **not** weaken the readiness guard or edit the registry merely to deploy that fix.

Remaining: an explicitly verified remote settlement path that preserves completed/failed tool effects **without** converting either Operation into product success; then install and verify the pinned health/provider fixes, followed by separate HouseLook BR-08 and Stock natural-scheduler acceptance. A remote idle observation alone is not the missing settlement evidence.
