# MSI task-based model routing — 2026-10-30

MSI now supports conversation-scoped selection on `agent_runtime(action=run)`.
The supervising conversation classifies the approved task; the runtime applies
and verifies a deterministic profile. No extra classifier call or Agent is added.
An explicit user model/effort takes precedence. Missing classification uses
standard, and uncertainty must not be presented as a semantic classification.

| Task | Model | Reasoning |
| --- | --- | --- |
| Small, well-defined task | `openai-codex/gpt-6-luna` | medium |
| Normal development / unspecified | `openai-codex/gpt-6.1-sol` | high |
| Ambiguous analysis / substantial design | `openai-codex/gpt-6-astra` | high |

## Implementation

- `lean-runtime/model_routing.mjs` owns selection, public metadata, catalog and
  effort validation, conversation ownership, readback and Agent-default checks.
- `lean-runtime/source/agent_runtime.ts` accepts the model, reasoning and
  complexity fields, records the planned decision and exposes applied results.
- `lean-runtime/source/letta_worker.ts` applies the selection after binding the
  persisted conversation and verifying idle state, before input dispatch.
- The current rules, runtime skill and README explain classification and explicit
  preference precedence. Error paths do not perform fallback inference or replay.
- The guarded updater now verifies 11 files. Rebuild and package contracts include
  the helper, with 40 pinned source overlays. Lifecycle policy remains
  `2026-10-28.3`; routing and model observations are separately versioned as v1.

Only the current conversation override changes. Agent defaults, project
permissions, replay protection, task ownership and release gates are retained.
Existing legacy `model=letta/agent-config` callers preserve the effective current
conversation configuration. Selection fields apply only to `run`.

## Verification

The final affected regression suite passed **55/55**: routing, observed-model
metadata, operation contract, update rollback/concurrency, readiness/reconciliation
and exact rebuild hashes. Candidate transformation/syntax and the existing
Worker entrypoint/recovery tests passed **7/7**; the actual Worker entrypoint also
refused dispatch under a maintenance lock.

The installed MSI path completed these read-only integration checks using the
same Agent and conversation `local-conv-84`:

| Check | Operation | Observed configuration | Result |
| --- | --- | --- | --- |
| Simple profile | `op_5f99a9c5ab174ac5` | Luna / medium | Read TASK.md, identified range/cache/invoice |
| Complex profile | `op_9fa6284269cf4ed8` | Astra / high | Read cache source, explained rejection recovery and shared work |
| Explicit Sol with simple classification | `op_6740b25a7b224781` | Sol 6.1 / high | Read range source, identified inclusive endpoints |

Each completed with exit code 0, one successful external file read, no denied
request, no changed file and no unresolved blocker. Observations come from
`letta.conversation_retrieve` before the turn, not a provider execution attestation.
Usage was null; no speed, cost, quality or token-saving comparison is claimed.

An initial check (`op_40d4484dce504c8a`) used my incorrect filename TASKS.md and
reported ENOENT. It verified model selection but did not complete the intended
file read. The corrected Luna check above used the observed filename TASK.md.
The existing automatic compaction threshold was reached between those checks:
82 messages became one summary, with the same Agent and conversation retained.

Read-only before/after snapshots around Astra-to-Sol selection confirmed the
shared Agent default remained Sol 6.1/high and sibling conversation
`local-conv-6` retained null overrides. The current conversation ended at Sol
6.1/high. Evidence is preserved in `benchmarks/model-routing-v1/`.

The final readiness check reported ready, zero running/stale/unresolved
operations and no maintenance lock. Installed verification matched all 11 files.
Windows PowerShell 5.1 `tests/validate.ps1` passed, including synthetic package
hash, failed-publication rollback, bootstrap validation and non-mutating plans.
This is not a clean-machine installation or reboot acceptance result.

## Local delivery and recovery

The guarded updater created these backups under
`C:/Users/Naos/.openchatx-mcp/headless/toolboxes/agent-runtime/backups/`:

- `lean-runtime-2026-10-30T14-38-55-655Z-27ec49f3-cb1d-4b61-a988-b0838a19aba9`
- `lean-runtime-2026-10-30T14-42-30-455Z-0985368e-711f-4259-a7eb-508e7fe7b2e2`

Final artifacts are in `C:/Naos/02.Git/personal/`:

| Artifact | SHA256 |
| --- | --- |
| `Naos-Agent-Stack-core-model-routing-20261030.2.zip` | `2C3A2388FA72F36D88013A81A58AF83532810C82587CA47E56254C64B9D9C408` |
| `Naos-Agent-Stack-v0.2.3-Complete-model-routing-20261030.2-candidate.zip` | `DF517DA79A57758BB46B0396FE0481131B94ECFC3238953B5C2C3A7FE3175FC8` |

The Complete ZIP is 285674253 bytes. All 40 core overlay hashes and four critical
Complete entries matched the checkout. The payload and dependency lock reference
this core. It supersedes model-routing.1 and the previous handoff-only candidate;
the compiled core itself remains revision `2026-10-30.handoff.2`.

PC2 was not accessed or synchronized. No production release, merge or Git push
was performed. The checkout still includes prior unrelated changes; this work
did not stage or commit that mixed working tree.

## Practical limits

Letta offers no atomic idle-check/model-update transaction across independent
external clients. OpenChatX retains its operation guards and checks idle state
before selection, before update and before input; other clients must not mutate
the same conversation concurrently. A verified override persists if a later turn
fails, and uncertain operations require reconciliation rather than replay.
Catalog validation is not a guarantee of future provider availability.

The Astra check reported a generic index-query failure, and authorized direct
file inspection completed normally. Later investigation found that Letta-POC
had no index and was excluded from automatic indexing; the index service was
available. The narrower diagnosis and its repair are documented in
[MSI context validation](MSI_CONTEXT_VALIDATION_20261030.md). Neither change
establishes Codex-equivalent task quality.
