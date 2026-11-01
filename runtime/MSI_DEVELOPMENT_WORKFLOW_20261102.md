# MSI development workflow and paired acceptance

## Delivered behavior

- MSI bootstrap `2026-11-02.1` explains direct activation of known Project IDs,
  the separate read-only resolve operation, and fully qualified Skill names.
  Both public tool descriptions and start_here use the same contract.
- A missing `project_id` on `project_manage(use)` now fails with
  `PROJECT_ARGUMENT_REQUIRED` before the callback; explicit null still clears
  routing. Missing resolve ID receives a precise diagnostic, never a guessed path.
  Existing annotations and Project permissions are unchanged.
- Conversation and Worker guidance require task-relevant source, current scoped
  status/diff where available, preservation of pre-existing edits, diagnosis
  before retry, affected checks and criterion-to-evidence mapping. These are
  execution instructions, not automatic repository reads or a new planner.
- Operation results expose additive acceptance evidence guidance while retaining
  `not_evaluated`. A successful process never automatically certifies product
  delivery. UI requires actual render/interaction evidence; uncertain effects
  retain the original reconciliation path. One Developer remains the default.
- Existing maintenance, rollback, interruption and rebuild locks are preserved.
  No new dependencies, mandatory agents, receipt system or automatic publishing
  were introduced. PC2 and production projects were not updated.

## Verification

The affected contract/context/update/reconnection/inflight/rebuild suite passed
57 tests. After the final routing guard, its affected registration/core/rebuild
checks passed 13 tests, including the new missing-ID regression. These overlap;
do not report 70 unique tests. The real MCP check verified current bootstrap,
tool descriptions, qualified Skill load, preserved Project after both invalid
calls, direct receipts, scoped continuation and explicit routing clear.

Lean Runtime installed and verified 15 files. Core overlay verified 14 modules
and installed 31 files including snapshots/metadata, using backups and locks.
The first `.4` installation's short health wait timed out; a later independent
health check returned 200 and the pause was cleared. Final `.1` installation
reported `AUDIT_MCP_RESTART_VERIFIED` and passed live protocol acceptance.

Backups:
- Lean: `lean-runtime-2026-11-01T15-54-23-957Z-e9b12737-b65b-4708-9cca-d370a0b4d526`.
- Core initial update: `core-audit-E8MVi3`.
- Core final update: `core-audit-yfqSUp`.

## Paired comparison

See `benchmarks/development-v2/RESULT_20261102.json` and the adjacent README for
provenance, limitations and reproduction. The owner explicitly authorized the
independent Codex task. Both observed GPT-6.1 Sol / High, with identical frozen
candidate files and tests. No solution was passed between candidates.

| Case | Codex initial implementation | OpenChatX initial implementation |
| --- | --- | --- |
| Integer validation / inclusive bounds | 2/2 | 2/2 |
| Shared async cache / rejected load retry | 3/3 | 3/3 |
| Invoice producer/consumer contract | 3/3 | 3/3 |
| Real Edge filter / safe text / keyboard / mobile | 2/2 | 2/2 |
| Planned diagnosis-to-implementation handoff | Passed | Passed, same `local-conv-106` |
| Unapproved file changes or removed files | None | None |

The evaluator independently reran both suites and checked every candidate file,
including tooling. Both changed only the four permitted modules and PROGRESS.md.
Both agents honestly distinguished browser assertions from screenshot review.
The evaluator additionally inspected desktop/mobile captures for both: visible
keyboard focus, readable literal text, preserved layout and no observed overflow.
This is a small synthetic interaction case, not a complete visual/a11y audit.

An exploratory **post-hoc** numeric probe then exposed weaknesses in both:
`sumInclusive(1e20, 1e20 + 16384)` timed out in OpenChatX's loop; Codex's arithmetic
formula rounded intermediate values. Both received one identical extra feedback
round with an explicit integer oracle. Their corrected implementations use exact
integer arithmetic followed by one Number conversion. Initial failures remain
separate evidence; correction must not be counted as first-pass success.

Initial diagnosis/implementation time was approximately 175/124 seconds for
Codex and 206/128 seconds for OpenChatX. Runs overlapped on one computer and had
different harness overhead; this is not a reliable speed ranking. Letta token
usage was unavailable. No cost or memory reduction percentage is asserted.

Environment events are retained: OpenChatX rejected four parent-traversal Node
paths before execution, then used the same authorized in-project binary's
canonical path; Codex initially needed authorized execution for headless Edge.
The future harness now states the canonical-path requirement. Neither frozen
candidate was rebaselined, and no Project permission was broadened.

## Interpretation

The requested workflow improvements and this bounded comparison are complete.
Results establish scoped repair, evidence reporting and planned continuation on
these cases; they do not establish overall Codex parity. The earlier Naosledge M9
historical replay supplies separate real-project evidence. Arbitrary crash
recovery has separate deterministic regression tests; the planned handoff here
is not a substitute for those tests. More varied real tasks and repeated runs
are needed before making general reliability or performance claims.

No full Windows reinstall, production deployment, Git push or PC2 sync was run.
