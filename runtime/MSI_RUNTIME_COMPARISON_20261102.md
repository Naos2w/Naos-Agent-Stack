# Runtime context, evidence and repeated comparison — 2026-11-02

**The reviewed runtime is installed and verified on MSI and PC2.** Stock PR #169
passed CI and was merged with explicit owner authorization. The Stock consumer
pins now match the installed runtime. Both machines passed real model/tool smoke
tests and finish `READY`, without running, stale or unresolved Operations.
The preparation history below is retained; final deployment evidence is linked
in the last section.

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

The planned release order was: finish Stock's explicit merge/publication approval gate, publish MSI with
the transactional updater, verify shared-runtime behavior, then perform PC2's
code-only sync and live smoke. No full clean Windows reinstall is requested or
claimed. The owner authorized this task to own the Stock handoff.

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

## Stock handoff prepared and verified

- Code-only [Stock PR #169](https://github.com/Naos2w/Stock-Analysts/pull/169),
  head `dadcdeabd20a3bf25689305fdd70ddc6814d5565`, changes three files in an
  isolated worktree. It updates three exact source pins and the Worker reader
  callback assertion while retaining all eleven source checks.
- Local PowerShell 7 candidate contract/mutation tests and mocked pending-result
  drain/timeout/no-replay tests passed. Full Stock offline CI run
  [41374424245](https://github.com/Naos2w/Stock-Analysts/actions/runs/41374424245)
  completed successfully, including every configured Python and PowerShell step.
  This is a PR-triggered Stock run, separate from the denied manual upstream run.
- MSI read-only preflight: readiness `READY`, zero running/stale/unresolved
  operations; all fifteen Runtime preimages and thirty-one core preimages match.
  No core recovery journal or health pause exists at this check.
- PC2's old synchronizer pinned the October candidate. The revised local
  synchronizer pins the final core ZIP above and selects exactly 82 code files.
  It now respects any registered consumer approval before replacement and
  rechecks approval inside the rollback-protected verification step. Configuration,
  sessions, projects and consumer registries are excluded from the payload.
- Five consumer-admission/rollback/path-scope tests passed with temporary files
  under the writable workspace. An initial run under the restricted system temp
  directory hit Windows rename `EPERM`; it was not a passing run.
- Local payload `pc2-runtime-v3-payload.json`: SHA256
  `87F179E7F9EFBF2386E9BAB154FC9C71B8674C1DDDD190EF081A3025DAECB11C`.
  Transfer staging is `pc2-runtime-v3-stage` alongside the core ZIP, with a hash
  manifest for its nine transfer files. Nothing has been sent to PC2.

The user's supplied AGENTS.md originally prohibited automatic merge/deployment.
After the passing PR was prepared, the owner explicitly authorized automatic
merge/deployment for this work. The global AGENTS.md was not changed: automatic
review rejected the attempted broader permanent policy edit, and no alternate
tool or path was used to carry it out. The owner was asked separately to clarify
the scope of the future standing preference. This does not block this release.

## Completed shared MSI and PC2 deployment

- Stock #169 merged as `786879117956faf6ae2761ac95107b459ed74d7f`. Only its
  reviewed runtime pin source was copied into the Stock daily worktree, after
  exact preimage verification and backup. Daily HEAD and the existing staged
  index entry remain unchanged; private reports/data were not staged or pushed.
- MSI installed and verified all 15 Runtime files and 31 core/snapshot/metadata
  targets. Stock contract/mutation tests passed against the actual installed
  companion; mocked pending-result/no-replay tests also passed.
- The first core update stopped before replacing files because PM2 reported
  `waiting restart`. Installed PM2 source confirmed that its delayed exit handler
  can overwrite the stopped label even when no restart is scheduled. The updater
  now reissues stop once only for that PID-less state, then still requires
  `stopped` and PID zero. Eight stop/rollback tests passed, and the next real MSI
  update completed with verified restart. PC2 reuses this same helper.
- MSI real operation `op_8e86226cb72146bd` observed Sol/high, received both bounded
  source snapshots, and executed the declared fixture test successfully. The
  synthetic manual criterion correctly remained `manual_required`; no files
  changed and no permission denial or uncertain effect occurred.
- PC2's 74 prior release hashes matched before staging; all 82 planned hashes
  matched the local candidate. The transaction changed 28 files, verified 14 core
  modules, preserved config/session/operation/project/search bytes and restarted
  MCP successfully. Its temporary limited-user scheduled task exited zero and
  was removed. All 82 installed hashes were rechecked before the smoke run.
- PC2 operation `op_fc1ed4bf2fa341aa` reused `go-travel/pc2-main`, Agent and
  conversation `local-conv-49`. It observed Sol/high, received package context,
  and made one successful host read. It returned `go-travel` / `1.5.0`; the clean
  worktree and package hash stayed unchanged. Normal runtime session/operation
  metadata advanced only after the migration preservation check.
- Final readiness is `READY` on both machines, with zero running/stale/unresolved
  Operations. PC2 has no maintenance pause or pending recovery journal. The
  release does not claim a clean Windows reinstall or general Codex parity.

[Machine-readable deployment and smoke evidence](benchmarks/runtime-v3/deployment-20261102.json).

## Real product task after installation

The owner approved using the installed runtime on a real bounded development
task. An isolated Naosledge worktree started from the current M9 PR #63 head
`b20bd695b07b215fd357291f94a2b24a159631c5`; the original worktree stayed clean.
No credentials, actual Vault, Neon calls, product deployment or publication were
used. This was not a fresh paired Codex comparison.

The Worker found a real stale-local-proof defect: M9's second local inventory
preceded later awaited remote/journal/mode reads, so an edit during those reads
could falsely satisfy equality and allow manual fault-marker archive. It added
two deterministic filesystem/HTTP-fixture interleavings, then moved the final
local scan after those awaits. The archive implementation and its consent gates
remain unchanged. Independent supervisor validation reproduced **16 pass / 2 fail**
against the original source and **18 pass / 0 fail** against the candidate.
The three-file repair and existing TODO record are saved as local Naosledge
commit `c748ae2`, branch `naos/fix/m9-runtime-verification-20261102`. It is not
merged, pushed, deployed or evidence of real-user recovery acceptance.

Execution was not uninterrupted: Operation `op_5d78d55d32af4467` reached its
480-second bound after 19 completed host calls, with no pending/uncertain effects
but no final report. One explicit recovery of the **same** Operation/Agent and
conversation `local-conv-112` completed the work without resubmitting the prompt.
Recovered model observation confirms GPT-6.1 Sol/high; the final declared check
passed. The first attempt's missing terminal progress is unresolved, not proven
to be a platform rejection, memory problem or model-quality failure.

The recovered result also contains `ApplyPatch: EXTERNAL_TOOL_UNKNOWN: ApplyPatch`.
This local tool-name mismatch remains visible as a blocker despite successful
subsequent tool calls. Do not erase that evidence or label this zero-intervention
success. The recovered trace covers its own segment; actual Git diff and prior
logs remain necessary because shell edits are outside direct-write accounting.

Next evidence-driven improvements are to diagnose the post-tool progress/timeout
path and align the model's advertised editing tools with the host contract. Do
not merely extend timeouts or suppress genuine denials. The local Worker was
observed at about 68 MiB RSS / 94 MiB peak-to-that-point; this excludes the model
backend and does not establish whole-system memory use.

[Real-task execution and verification evidence](benchmarks/runtime-v3/real-development-20261102.json).

## Recovery tool scope and provider idle bound (v3d; MSI deployed)

The target conversation's durable transcript narrows the earlier timeout:
after the last successful host result at `02:48:12.766Z`, the provider recorded
an assistant error at `02:54:16.215Z`: `WebSocket idle timeout after 300000ms`.
This establishes a stalled model stream, not a still-running regression test.
It does not identify why the upstream connection stopped delivering events.

The native `ApplyPatch` call occurred only after recovery. Normal Worker input
already carries `client_tool_allowlist`; the recovery adapter's continuation
omitted it. Recovery now selects only `openchatx_*` tools registered for the
same Agent/conversation and supplies the provider's normal allowlist and
interactive-tool exclusion. Missing controllers fail before writing recovery
state. Existing host permission decisions and exactly-once checks still apply;
historical denied-call evidence is retained.

For OpenChatX-only Codex model streams, the provider's existing idle timer is
capped at 120 seconds, preserving tighter limits, cancellation and retry rules.
This reduces a single silent-stream wait from 300 to 120 seconds (60%); it is
not a total Operation deadline or a promise that a whole task is 60% faster.
It contains the observed stall but cannot prevent upstream network failures.
Other clients, providers and mixed/native toolsets keep their existing options.

Validation: 38 affected tests passed, including the actual pinned provider's
tool filters, idle parser, patch upgrade/idempotence, cold/in-flight recovery,
reconnection and all rebuild overlay hashes. The real isolated Letta probe
also passed after terminating both backend and Worker: one marker effect,
one initial prompt submission, zero recovery prompt submissions, and successful
continuation. Its helper and bundle now live in a private probe directory;
the probe no longer replaces the shared service's helper.

Rebuilt artifacts corresponding to the deployed provider changes:
- Core `core-runtime-v3d-20261102.zip`, SHA256
  `32F2B8C93A7C535D99AA9EADAA20A3E013C1FB6F5E66B602F6E36811C0428BD3`.
- Complete `Naos-Agent-Stack-v023-runtime-v3d-Complete.zip`, 288,298,081 bytes,
  SHA256 `ABAF3A0A9785C560B2229E773F164E9D449EF7A6FE37C753707276F2E5835F88`.

The initial delivery remained candidate-only while PC2 was unreachable and
the owner deferred updating the shared service. After the owner requested the
Naos2w account, PR #6 was created and subsequently merged by the owner as
`93006d5b489984c13e204f91b74fd2ac086e10e0`. The owner then authorized continuation
and confirmed PC2 was powered off and would remain off throughout maintenance.

MSI's four provider/installer-source files were updated at
`2026-11-02T04:07:34.486Z` under the existing Runtime maintenance lock. The update
checked terminal Operations and Stock consumer pins, verified the service PID's
executable, and used the existing transactional file replacement/rollback helper.
Backup: `C:/Users/Naos/.openchatx-mcp/headless/toolboxes/agent-runtime/backups/core-audit-aYOG4F`.
Letta restarted from PID 57460 to 28376; protocol 1 / version 0.34.1 health passed.
Worker/facade sources and Stock's 11-source consumer contract remain unchanged.

Installed verification passed:
- Three contract tests against the installed bundle, including native-tool
  filtering and the idle parser.
- Actual MCP Operation `op_6ec136bfe7d64caf`, conversation `local-conv-113`,
  observed GPT-6.1 Sol/high: one successful bounded file read, no denied calls,
  no blockers, no file changes. The model appended an unrelated personality
  preference question; this output-quality issue was not changed by this patch.
- Live service recovery fixture, conversation `local-conv-114`: terminate only
  the test Worker after its fixed marker is durably recorded, then recover the
  original tool ID. One effect, one original prompt, zero recovery prompt
  submissions; completion passed without restarting the shared service again.
- Final readiness READY: zero running, stale or unresolved Operations.

PC2 client verification remains pending until it is powered on. Its existing
client connects to this shared MSI backend; no PC2 client files changed in this
provider-only release. Upstream silence remains a separate unresolved cause:
the original diagnostic records `eventsEmitted: true`, phase
`after_message_stream_start`, and a 240,628-byte request; it does not establish
why the connection stopped receiving events.

[Installed deployment evidence](benchmarks/runtime-v3/recovery-tools-deployment-20261102.json).
