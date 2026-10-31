# MSI tool evidence and compaction continuity — 2026-10-31

Dates in this record use Asia/Taipei. Machine evidence timestamps remain UTC.
Scope: finish tool outcome reporting, observed direct-write changes, and a
two-stage compaction/resumption acceptance scenario on MSI. PC2 was not touched.

## Confirmed causes

The Worker passed each result to Letta but recorded only the tool/input,
idempotency state and duration. `summarizeRunTrace` therefore could not count
execution errors and constructed blockers only from approval denials. It also
listed attempted `openchatx_write_file` paths as changed without checking whether
the write succeeded or changed bytes.

Existing operation completion and delivery acceptance were already distinct.
The repair preserves that distinction: a completed turn may contain failed tool
attempts, and successful tools alone do not establish product acceptance.

## Implemented changes

- `tool_evidence.mjs` provides bounded, allowlisted outcome metadata: succeeded,
  failed, unknown, exit code and recognized error code. No commands, file contents,
  raw stderr or arbitrary provider fields enter this public evidence.
- Failure totals remain visible. A later actually executed identical request
  can be labelled `later_identical_success`; uncertainty and replay never satisfy
  that condition. Review-required attempts appear in blockers for the affected
  action. This does not stop independent authorized work or authorize retries.
- Dispatch/ledger exceptions return a bounded failure; a possible side effect
  remains uncertain and the handler does not execute it again.
- Direct writes have before/after byte observations through existing ProjectExecutor
  approvals. Each snapshot reads at most 1 MiB. Missing read permission, large or
  unreadable files remain unverified; observation does not block an otherwise
  authorized write or expand permissions.
- `changed_files` includes successful direct writes with observed byte changes.
  Unchanged writes and replays are excluded. `file_effects` retains observations
  around failed writes for inspection. Shell and external-editor changes remain
  outside this scope; concurrent-editor attribution is not claimed.
- Current policy and each Worker prompt tell resumed work to reread its existing
  task record and current source. Multi-step progress stays in that same TODO
  when writing is authorized: goal, constraints, completed work, test evidence,
  remaining issues and next action. No second task ledger, automatic checkpoint
  writer, new Agent or compaction-threshold change was introduced.
- The updater verifies 13 files. Bootstrap and Complete package validation now
  require the new helper, and the rebuild lock pins 42 overlays.

## Verification

The initial affected suite passed **85/85**: tool evidence, exact-file context,
runtime contracts, model selection/observation, readiness/reconciliation,
transactional update safety and rebuild hashes. Candidate TypeScript syntax and
Worker entrypoint/recovery tests passed **7/7**, plus an actual entrypoint refusal
during maintenance.

The first restricted-environment snapshot tests encountered EPERM from realpath.
Native MSI isolated tests passed with the existing permission checks intact.
The real phase-1 run exposed compound provider call IDs containing `|` and the
installed executor's `NOT_A_FILE` code. Those bounded metadata cases were added;
the final affected helper/update/rebuild suite passed **21/21**, including the
new correlation regression. Final phase-2 write evidence contains the actual IDs.

The existing Agent `agent-local-31166c4b-56a4-4e39-9bdb-04a2ed91e41c` and conversation
`local-conv-84` were reused, with observed Sol 6.1/high configuration:

| Stage | Operation/evidence | Observed result |
| --- | --- | --- |
| Initial fixture | `msi-20261031-a.initial.json` | 3 failing assertions grouped as tests; 2 passing tests |
| Phase 1 | `op_2b3dcf478ec54478` | 10 tool calls: 9 succeeded and one intentional directory-read failure; 2 pricing tests passed |
| Compaction | public `agent_runtime(action=compact)` | Same conversation; 42 messages became 1 |
| Phase 2 | `op_469fcee2c35f4cee` | 8 successful tools, no failed/unknown response or blocker; all 5 tests passed |

Independent grading verified immutable test hashes, the unchanged marker, no
extra files and byte-identical phase-1 pricing after phase 2. The identical marker
rewrite was explicitly `unchanged` and absent from `changed_files`. Phase 2
changed only the remaining invoice module and the existing task record.

The phase-1 negative probe was expected and reviewed, not a permission denial or
unresolved side effect; it remains visible in historical evidence. It was not
retried. Its recorded code/IDs were generic/null before the metadata correction;
those historical observations are preserved rather than rewritten.

The [reproducible fixture](benchmarks/continuity-v1/README.md),
[public run/compaction evidence](benchmarks/continuity-v1/runs/msi-20261031-a.execution.json),
[phase-1 grade](benchmarks/continuity-v1/runs/msi-20261031-a.phase1.json) and
[phase-2 grade](benchmarks/continuity-v1/runs/msi-20261031-a.phase2.json) retain the results.

Windows PowerShell 5.1 `tests/validate.ps1` passed source parsing, synthetic package
replacement/rollback, required payload checks and non-mutating installation plans.
Final source checks found LF in touched PowerShell release files whose Git policy
requires CRLF. Their existing CRLF format was restored; the rebuild contract now
asserts checkout-compatible line endings and passed again. Runtime sources remain
LF. This is a rebuild consistency repair, not a runtime behavior change.

## Local application and delivery

The guarded updater created two backups under
`C:/Users/Naos/.openchatx-mcp/headless/toolboxes/agent-runtime/backups/`:

- Initial application: `lean-runtime-2026-10-30T16-46-20-851Z-5d90002e-9ed8-4273-9f5e-9a239ad6da5b`.
- Metadata correction: `lean-runtime-2026-10-30T16-52-54-575Z-91d289ac-5071-417c-a145-9bbc6a2b239e`.

Installed verification matched all 13 files. Runtime readiness was ready with
zero running, stale or unresolved operations and no maintenance lock.

Final CRLF-corrected candidates in `C:/Naos/02.Git/personal/`:

| Package | SHA256 |
| --- | --- |
| `Naos-Agent-Stack-core-evidence-20261031.2.zip` | `0216DE8E79BA0B6FD74FDB346CB1FB75F3D82C940166C9773F34E8926E22D14B` |
| `Naos-Agent-Stack-v0.2.3-Complete-evidence-20261031.2-candidate.zip` | `BCC73CB4AED5DEC7B7003EDF4BDD40A1CACB4A28A713D8525FFD1BCD6B04C0BA` |

All 42 core overlay hashes and four critical Complete entries match the final
checkout. The Complete ZIP is 285685009 bytes. Workspace payload and dependency
lock reference the final core. [Package evidence](benchmarks/continuity-v1/runs/msi-20261031-a.packages.json)
records these checks. The evidence.1 candidates are superseded.

The unchanged pinned base is `Naos-Agent-Stack-core-base-20261028.zip`, SHA256
`196883AAC82E09136547D2D0B3E04604333E3D742A522EE84E4BBE9B362B7F04`.
Lifecycle policy remains 2026-10-28.3, and compiled core remains
2026-10-30.handoff.2. No model routing or project permission settings changed.

## Limits and remaining work

This is one two-stage resumption scenario, not proof of arbitrary long-task
reliability or Codex-equivalent quality. No token/cost or speed improvement is
claimed; usage was unavailable. Full phase timing/peak-memory profiling, broader
unbiased development comparisons and interrupted remote-approval recovery are
separate remaining work. No clean-machine installation, reboot acceptance, PC2
sync, production publication, merge or Git push was performed. The existing mixed
working tree remains uncommitted; unrelated changes were preserved.
