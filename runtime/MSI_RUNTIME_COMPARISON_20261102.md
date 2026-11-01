# Runtime context, evidence and repeated comparison — 2026-11-02

Implementation and isolated MSI integration are complete. **The new shared MSI
Runtime is not deployed. PC2 is unchanged.** The registered Stock consumer still
pins the current shared version, so publication correctly requires its separate
source review and version handoff. No Stock pin was changed by this task.

## Actual comparison

Both engines used observed GPT-6.1 Sol / high settings, identical frozen input,
the same 17 visible tests and three fresh, sequential attempts. The approved task
was a real Runtime feature, not an unrelated puzzle. Each candidate changed only
runtime_contract.ts and PROGRESS.md; immutable input and scope hashes passed.

| Engine | Attempts passing 17/17 | Supervisor repair hints | Recorded durations | Median |
| --- | --- | --- | --- | --- |
| Codex | 3/3 | 0 | 181.296 / 239.089 / 156.450 s | 181.296 s |
| OpenChatX / Letta | 3/3 | 0 | 175.876 / 163.002 / 220.197 s | 175.876 s |

Codex durations are recorded turn durations; OpenChatX durations span local
dispatch creation to final Worker stdout, excluding later polling delay. Root
integration/build work shared the host. These timings do not establish a speed
advantage. The 18 separate validator measurements used roughly 58–61 MiB peak
RSS each; this is **validator memory**, not model, agent or machine memory.
Comparable generation token cost and total agent memory were unavailable.

One backend feature repeated three times cannot establish general Codex parity.
The experiment validates this feature and workflow, not arbitrary large projects,
UI, hidden criteria, long-term reliability or product release acceptance.

Protocol and raw numeric summary:
[benchmark](benchmarks/runtime-v3/README.md),
[results](benchmarks/runtime-v3/results-20261102.json).

## Implemented behavior

- Explicit known task/source paths supply an automatic bounded snapshot: 8
  entries, 3,000 characters per file and 12,000 total. Reads retain canonical
  Project approval. Missing, excluded and truncated context stays visible;
  source text is untrusted data and task_ref grants no file access.
- Declared command/manual checks persist with the original Operation and Worker
  input, including recovery. Host-recorded command/cwd/exit evidence determines
  the result. Last matching execution wins; replay/unknown cannot pass,
  uncertainty blocks, and later mutations invalidate earlier passing checks.
- Public checks describe the operation-end snapshot only. Manual criteria remain
  manual, old-operation polls are stale, and delivery acceptance stays false.
- Canonical read_file now bounds actual allocation/reads instead of loading a
  whole file before truncation. A 3,000-character request reads at most 12,004
  bytes. This is a byte-bound improvement, not a measured total-memory percentage.
- OpenChatX attempts 2 and 3 exposed an optional missing PROGRESS.md read being
  reported as a blocker after successful work. Missing read inputs are now
  classified as source_unavailable and retained in diagnostics; real permission
  denials and failed writes/shell requests remain blockers. No denial is bypassed.
- CI now limits simultaneous test files to 2 and includes the new regression
  suites. No additional agents, dependencies or task ledger were introduced.

## Validation

The Runtime CI list passed 213 tests; its 7 dependency-gated cases subsequently
passed with the installed Zod dependency (220 distinct tests total). A final
read-result type cleanup passed the 6 affected integration/source-lock tests.
The candidate also passed 7 existing Worker entrypoint/recovery tests plus the
real maintenance-admission refusal. Windows PowerShell 5.1 source/packaging
validation passed in a clean source snapshot. The live checkout's source scan
correctly rejected ignored test Node binaries; its rules were not weakened.

The selected first Codex implementation was reviewed, then integrated into the
actual facade, Worker and canonical executor. Real model validation ran on MSI
in an isolated toolbox with independent state/Operation files and existing
Project permissions. Test-only module hooks selected the candidate executor and
the normal installed configuration/ProjectRegistry dependencies; the shared
installed source was not replaced.

`op_b98e817d5445402b` observed the task/source marker, fixed the isolated fixture,
ran its real test and returned command=passed/manual=manual_required. The next
operation `op_7b6ce861509d4233` reused `local-conv-110`, verified the command,
returned checks_passed and made the previous poll report stale_operation.
Neither certified delivery. Both had no unresolved blockers.
[Integration evidence](benchmarks/runtime-v3/integration-20261102.json).

## Exact release boundary

Read-only publication admission returned:

`RUNTIME_CONSUMER_PIN_MISMATCH: stock/agent_runtime.ts`

All 11 current installed files match Stock's reviewed pins. The candidate differs
only in agent_runtime.ts, letta_worker.ts and runtime_contract.ts. Applying it
before the independent Stock review would recreate the known startup outage.
The parallel Stock publisher work was preserved separately; its registered
consumer guard was not removed, relaxed or bypassed.
[Exact handoff hashes](benchmarks/runtime-v3/stock-handoff-20261102.json).

Remaining order: obtain ownership of the Stock handoff, review/test those three
source changes through Stock's existing Git/CI/approval gates, publish MSI with
the transactional updater, verify shared-runtime behavior, then perform PC2's
code-only sync and live smoke. No full clean Windows reinstall is requested or
claimed. The owner was asked whether this task should also own the Stock handoff.

Final local candidate artifacts (not a public release):

- Core: `core-runtime-v3-20261102c.zip`, SHA256
  `5EF43AC710910899D857140ACAABC6AE1AD382F3C1FEF113BA7BE04FBE5AA893`.
- Complete: `Naos-Agent-Stack-v023-runtime-v3c-Complete.zip`, 285,728,559 bytes,
  SHA256 `7D71D3A0ABC8446FD24BA7A81EDB625089D101127195C041D18C20DDC479D3A6`.
- Both are in `C:/Users/Naos/Documents/Codex/2026-10-30/codex/`.
- The core is reproducible from the existing pinned base and 55 locked repository
  overlays; the complete builder verified its seven bundled release assets.

The feature and evidence were pushed to the existing v0.2.3 fix branch, with
the already-merged Stock publisher admission preserved (`43392ff`). Its four
consumer-admission regressions and six affected integration/source-lock checks
passed after local integration. The repository workflow is manual-only. An
attempt to dispatch it with the existing GitHub CLI credentials returned HTTP
403 (`Must have admin rights to Repository`); no remote CI run was started and
no alternate identity was used. Local validation above remains the available
test evidence. No PR was merged and no production deployment was performed.
