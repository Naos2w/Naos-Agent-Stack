# MSI exact-file context validation — 2026-10-30

The existing Runtime now carries known task file paths into its read-only
codebase context check. This extends the earlier missing-index diagnostic fix;
it does not change model routing, create Agents, reindex projects or sync PC2.

## Cause and change

`inspectDevelopmentContext` already accepted paths, but the Worker invoked it
without the current task's file list. Index readiness alone could therefore not
tell the Agent whether the files relevant to its work were tracked or stale.

`agent_runtime(action=run)` now accepts optional `context_paths`: up to 16 exact
project-relative files, at most 512 characters each. The facade normalizes and
deduplicates them, records them with the operation, and forwards them through
the Worker to the existing preflight. Unknown paths can be omitted. Files found
during execution can be checked through `openchatx_codebase_context`, using
`action=coverage` and `paths`.

The adapter checks only the matching index scopes and gives each file to its
most specific scope. Existing ProjectExecutor read/realpath approval and an
actual file check precede metadata queries. Queries share a 20-second CLI
budget, with at most two scope processes concurrently and 12 seconds per call.
No directory coverage scans, automatic retries or indexing writes are added.

`pathChecks` records requested/observed counts, timestamp, matching generation,
and per-file coverage/freshness or unavailability. Provider recommendations and
unrelated fields are not forwarded. Truncated or mismatched responses cannot
become successful observations. These are metadata observations: neither
`no_recorded_issue` nor `metadata_changed` proves complete/current source.
The Agent must still inspect actual source before editing.

## Verification

- Affected unit/regression suite: **67/67**. Includes exact-file context,
  normalization/dispatch, model routing/observation, runtime contracts,
  transactional update safety and exact rebuild hashes.
- Candidate TypeScript transformation/syntax and Worker entrypoint/recovery:
  **7/7**, plus an actual Worker entrypoint refusal during maintenance.
- Native MSI candidate preflight checked three actual files against the
  `naos-agent-stack` snapshot from 2026-10-28T13:50:40Z. The contract file reported
  `metadata_changed`; the new capability source reported `not_tracked`;
  `Build-Package.ps1` reported `partial` parsing and `metadata_changed`.
  A directory and nonexistent path returned unavailable, with no coverage query
  for those paths. The two combined probes took 3822 ms; this is a single
  observation, not a performance benchmark or improvement percentage.
- Guarded MSI application backed up preimages and verified all **12** files.
  All **11** matching installed-runtime rebuild overlays matched the candidate.
- Public run `op_d387d67ac2244526` reused Agent
  `agent-local-31166c4b-56a4-4e39-9bdb-04a2ed91e41c`, conversation `local-conv-84`
  and the observed Sol 6.1/high configuration. Accepted output contained the
  requested file. Completed output contained the exact-file preflight evidence.
  The Agent called the new coverage action and then read the actual file:
  two successful external tool calls, exit code 0, no changed files, denied
  requests, blockers or reconciliation requirement.
- The intentionally unindexed `letta-poc` remained excluded from automatic
  indexing. The live answer correctly distinguished index absence, unchecked
  freshness and the cache behavior established by source inspection.
- Final installed verification again matched all 12 files. Readiness was ready,
  with zero running, stale or unresolved operations and no maintenance lock.
- Windows PowerShell 5.1 `tests/validate.ps1` completed successfully, including
  source parsing, synthetic package replacement/rollback, bundled payload checks
  and non-mutating installation plans. The affected tracked diff passed
  `git diff --check`.

Evidence: [native preflight](benchmarks/file-context-v1/msi-preflight-20261030.json)
and [public runtime run](benchmarks/file-context-v1/msi-live-20261030.json).

Installed backup:
`C:/Users/Naos/.openchatx-mcp/headless/toolboxes/agent-runtime/backups/lean-runtime-2026-10-30T15-49-54-129Z-8f7663de-2955-4541-a79c-a47b9b7e4559`.

## Delivery status

The source, CI command and rebuild hashes are updated. Final candidates in
`C:/Naos/02.Git/personal/`:

| Package | SHA256 |
| --- | --- |
| `Naos-Agent-Stack-core-file-context-20261030.1.zip` | `4D0D1991E221835A35104B9F7E492641C5A6A26E996D7BB2E0649712994016C2` |
| `Naos-Agent-Stack-v0.2.3-Complete-file-context-20261030.1-candidate.zip` | `0C3957B2B2566D265B24076644C70FF47CA38A69B0A6E84DB606DA32BF26B722` |

The Complete ZIP is 285679866 bytes. All 41 core overlay hashes and four critical
Complete entries matched the checkout. The workspace payload and dependency
lock point to this core; [package evidence](benchmarks/file-context-v1/msi-packages-20261030.json)
records these checks. The pinned base remains
`Naos-Agent-Stack-core-base-20261028.zip`, SHA256
`196883AAC82E09136547D2D0B3E04604333E3D742A522EE84E4BBE9B362B7F04`.
These candidates supersede the diagnostic-only context packages. Lifecycle
policy 2026-10-28.3, model routing and compiled core revision
`2026-10-30.handoff.2` are retained.

## Limits

The check does not repair parser gaps, prove semantic completeness or guarantee
that a file stays unchanged after observation. No quantified speed improvement
or Codex-equivalent task quality is claimed. No new dependency or Agent was added.
PC2, clean-machine installation, reboot acceptance, production publication,
merge and Git push were not performed. The existing mixed checkout remains
uncommitted; unrelated changes are preserved.
