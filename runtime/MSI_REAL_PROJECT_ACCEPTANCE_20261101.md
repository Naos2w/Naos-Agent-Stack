# MSI real-project acceptance — Naosledge M9

## Selection and result

Selected a historical Naosledge M9 crash-recovery defect spanning the signed
cycle and Windows host. It has deterministic offline acceptance and avoids real
Vault/database permissions, market-day waits, uncertain image labels and visual
judgment. Source, test provenance and reproduction are under
`benchmarks/naosledge-m9/`.

- Frozen starting source: `707c856541f7806a2bad816b2d365f2203564b0e`.
- Existing repair used only as the evaluator reference:
  `2476363cbcf60f00076b358bf2ba53c6dbb841c3`.
- Initial candidate: 17 PASS / 2 FAIL. Reference: 19 PASS / 0 FAIL.
- Letta candidate after repair: independently verified 19 PASS / 0 FAIL.
- Changed exactly the two permitted implementation files and PROGRESS.md;
  no removed or unexpected files. Tests, executable and task stayed unchanged
  after the explicitly authorized harness correction.
- The real Naosledge M9 worktree remained clean. No production writes, deployment,
  messaging, schedule execution or sync occurred.

## Execution evidence

Both Operations observed `openai-codex/gpt-6.1-sol` with `high` reasoning.
Usage/cost was not exposed and is not reported as zero.

1. `op_204c9aa23c5b4707`: diagnosis and durable PROGRESS.md; approximately 104 s.
2. A new MCP transport session received bootstrap `2026-11-01.3`, the original
   completed operation and TASK.md reference, and resumed the existing named
   Letta session `m9-replay-20261101` / `local-conv-105`.
3. `op_7d516b748a1947ff`: scoped implementation and validation; approximately 301 s.
   The expected initial test failure was retained and reconciled as
   `later_identical_success`; final blockers were empty. Operation completion
   remained separate from delivery acceptance, which the external grader checked.

These times are model-operation intervals, not end-to-end elapsed time; setup,
fixture calibration and the owner's permission response are excluded. No coding
solution was supplied after the handoff. This is a single real historical case,
not a performance improvement percentage or a matched Codex comparison.

## Problems found and handled

- The test initially named an executable outside its isolated Project. Shell
  Policy rejected it. The owner explicitly authorized the existing Node tool;
  a hash-identical copy was placed inside this Project and the task command was
  updated. The rejection remains in phase-1 evidence. No global allowlist or
  Program Files access was granted.
- `UI work is not applicable` incorrectly triggered UI Skills. The classifier now
  strips that explicit exclusion while preserving separate positive UI work and
  concrete frontend paths. Phase 2 observed design `not_applicable` and no loaded
  UI Skills. 18 classification/context tests and 13 update/context tests passed.
- The classifier was installed using the existing maintenance/rollback updater:
  15/15 Runtime files verified. The exact prior installed capability hash matched
  committed source before it was admitted by the updater. Rebuild hashes updated.
- Fixture calibration required the existing Markdown dependencies, two static
  inputs and the original Windows replacement helper; early setup failures were
  not attributed to the Agent. Native filesystem tests needed approved execution
  outside the desktop filesystem sandbox's realpath restrictions.

Final readiness: ready, zero running/stale/unresolved Operations, no lock.

## Actual fresh ChatGPT conversation

The owner opened a separate ChatGPT conversation and sent:

> 使用 MSI 的 OpenChatX，繼續 architecture-naosledge-m9-20261101 專案。

Conversation `6ae75d6d-677c-83ee-8af5-2a11a3e3202f` (使用 OpenChatX 繼續專案)
completed on 2026-11-01 at approximately 23:44 Taipei. Its final response was
checked against MSI `agent-commands.yaml`, session
`agent-4/architecture-naosledge-m9-20261101`:

- `start_here` received bootstrap `2026-11-01.3`.
- `project_manage(use)` selected the isolated Project by its exact ID.
- Read TASK.md, AGENTS.md, both implementation files and PROGRESS.md.
- Inspected the existing named Letta session and polled `op_7d516b748a1947ff`.
- Ran the prescribed offline suites from the isolated candidate directory:
  exit code 0; its final response reported 19/19 passing.
- Recognized the historical repair was already complete. No new Worker run or
  source mutation was observed; it explicitly distinguished offline acceptance
  from production integration and real-data end-to-end testing.

Two calls initially failed: `project_manage(resolve)` supplied a path instead of
the required ID, and Skill loading used the unqualified `agent-runtime-usage`.
The dialogue recovered unaided with exact Project `use` and Skill search followed
by `agent-runtime.agent-runtime-usage`. These were OpenChatX argument/lookup
failures, not evidence of a platform safety refusal. Thus continuation acceptance
passed with two self-recovered tool errors, not a perfect first-call success rate.
This observer did not send follow-up instructions into that conversation.

## Limits and follow-up

PC2 sync and a matched Codex-engine comparison have not been performed. One
historical case establishes this continuation and repair path, not general coding
parity. The two recovered discovery errors remain useful targets for a separate
tool-contract usability improvement; neither prevented this acceptance.
