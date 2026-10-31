# MSI context efficiency and project checks — 2026-10-31

The later [unresolved-effect dispatch validation](MSI_DISPATCH_RECONCILIATION_20261031.md)
supersedes this installed/package revision. The measurements and provider probe
below remain the evidence for their stated scopes.

## Current owner scope

The owner explicitly removed fresh Windows and whole-stack installation testing
from this round. They are **out of scope**, not an unresolved blocker or a request
for a VM. This does not claim those scenarios passed or authorize a public release.
MSI remains the target; PC2 was not accessed or synchronized.

## Reproduced and corrected

1. The capability classifier treated the literal exclusion `no UI` as a positive
   UI request. A real backend preflight loaded two irrelevant design Skills.
   Explicit English/Chinese exclusions are now removed before classification.
   Concrete frontend paths and positive UI requirements elsewhere still win.
2. A long-lived `development_preflight` entry retained a gate module that had
   captured an older capability implementation. It reported complete root coverage
   and omitted exact-file checks even though newer files were installed. The entry
   now keys the gate on its own, capability and review-policy mtimes on each call.
   Unchanged dependencies retain the normal module cache. No service restart was
   needed. Both defects failed focused regression tests before the fixes.
3. OpenClaw's runtime default queried `openclaw`; the actual index is `OpenClaw`,
   with separate `OpenClaw-scripts`, `OpenClaw-tools` and `OpenClaw-deploy` indexes.
   All four names and roots were verified using the configured CLI. Only the missing
   MSI `projectIndexScopes.openclaw` mapping was added. The public preflight then
   correctly routed one test and one script to their respective indexes (2/2).
   Partial coverage and changed metadata remain visible; no index was rebuilt.

## Measured results

The same real Naos-Agent-Stack backend preflight was called three times before
and three times after application through the original OpenChatX tool:

| Observation | Before | After |
| --- | --- | --- |
| Design Skills loaded for backend task | 2 | 0 |
| Returned guidance characters | 17,000 (truncated) | 1,251 |
| Exact-file observations | absent | 2/2 |
| Connector elapsed time, milliseconds | 4,577 / 4,428 / 7,779 | 5,763 / 5,724 / 5,821 |

The returned context is **92.64% smaller**. This is not a token count, model
latency improvement or general development speedup. The corrected path also does
more accurate per-file work; these timings include connector overhead. There is
no demonstrated latency improvement from these three samples.

OpenClaw's existing industry-mapping self-test was run three times with its
normal public configuration, synthetic cases and a 256 MiB V8 heap limit:

- All **76 cases passed** in every run (the same 76 repeated, not 228 unique tests).
- Elapsed times: **2,331 / 2,104 / 2,111 ms**.
- Peak process working sets: **84,717,568 / 86,458,368 / 86,351,872 bytes**
  (80.8–82.5 MiB), observed from the OS every 20 ms.
- This measures one Node process only, not the whole service/process tree or
  complete regression. It does not reproduce or rule out a full-suite OOM.
- Source/config hashes were unchanged. No OpenClaw source/test edits, real model
  requests, live database workflow, publishing or scheduler operations occurred.

The confirmed OpenClaw Project and its current TODO/AGENTS were inspected.
Codebase Memory was used, then current source was read because graph metadata
was not proof of freshness. No dedicated installed backend profiling Skill was
found; the already loaded Naos coding/engineering standards guided this work.
UI/visual implementation was not applicable.

## Interrupted approvals

The actual installed Letta 0.34.1 recovery function was executed with a synthetic
idle runtime and synthetic backend pending approval. Both `resume_interrupted_turn`
false and true produced a stale-approval denial; neither transparently reapproved
the original tool. **2/2 probe cases passed**. The installed bundle hash is retained.

This confirms the provider limitation, not a successful end-to-end recovery of a
real interrupted model approval. No provider code or real conversation was changed.
Existing reconciliation and incomplete-effect protection remain in force; there
is no automatic retry, identity replacement or claim of full approval resumption.

## Validation and delivery

- Runtime CI suite: **158 passed, 0 failed, 0 skipped**.
- Candidate TypeScript transformation/syntax and **7 Worker entrypoint/recovery
  tests** passed; actual maintenance refusal passed.
- Installed verification: **15 targets matched**. Readiness at final check:
  `ready=true`, running/stale/unresolved all zero.
- Core and Complete candidates rebuilt; **44 core overlays** and five critical
  Complete entries match reviewed source hashes. No installer was executed.
- Runtime backup:
  `C:/Users/Naos/.openchatx-mcp/headless/toolboxes/agent-runtime/backups/lean-runtime-2026-10-31T06-49-00-004Z-ee257c10-8644-4cc9-b133-6737be91cf29`.
- MSI mapping backup:
  `C:/Users/Naos/.openchatx-mcp/headless/config/codebase-index.json.before-openclaw-scopes-20261031`.
  The first atomic replacement call rejected an empty backup-path parameter before
  changing the original. Its byte identity was rechecked, then replacement with
  a named swap backup succeeded. Only the intended mapping changed.

Evidence: [preflight comparison and mapping](benchmarks/project-tests-v1/preflight-20261031.json),
[OpenClaw measurements](benchmarks/project-tests-v1/openclaw-20261031.json),
[provider probe](benchmarks/inflight-v1/approval-provider-20261031.json),
[package hashes](benchmarks/project-tests-v1/packages-20261031.json).

MSI ordinary development can continue. General model/development throughput has
not been quantified; full remote approval resumption remains a provider boundary.
PC2 configuration and synchronization remain a subsequent task.
