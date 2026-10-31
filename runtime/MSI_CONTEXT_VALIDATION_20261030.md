# MSI codebase context evidence — 2026-10-30

This update corrects the interpretation of codebase context in the existing
Letta/OpenChatX architecture. It does not add Agents, change model selection,
reindex projects, alter exclusions or synchronize PC2.

## Confirmed causes

The local index service was available when inspected. `naos-agent-stack` reported
ready, 684 nodes and seven partially parsed files. Its snapshot timestamp was
2026-10-28T13:50:40Z; availability did not establish current-source freshness.

`letta-poc` was absent from the index and present in the existing
`excludedProjects` automatic-indexing configuration. The CLI returned a
structured missing-project error with exit code 1. The old adapter discarded that
response in a generic process-error catch and reported `CODEBASE_INDEX_QUERY_FAILED`.
Preflight then flattened all query errors into `missing`, describing an
unavailable index without distinguishing the cause.

Separately, the old status aggregation inferred complete root coverage from a
project-root scope, discarding parser coverage gaps. A scope is not evidence that
every file or symbol was indexed successfully.

A restricted local CLI probe also failed to create its coordination endpoint;
the same read-only probe in MSI's native execution environment succeeded. That
diagnostic environment failure was not evidence that the installed service was
offline. The earlier routing record's blanket offline interpretation is therefore
superseded by this narrower diagnosis.

## Change

`lean-runtime/source/agent_capabilities.ts` now:

- Decodes structured CLI error responses before categorizing process failure.
  Missing projects retain `PROJECT_NOT_INDEXED`, even on exit code 1.
- Separates missing indexes from query errors: timeout, missing executable, local
  process permission, output limit, invalid/unknown response and root mismatch.
- Preserves `autoIndexExcluded` as diagnostic context. Exclusion from automatic
  indexing does not prevent use of an existing manually built index.
- Retains best-effort partial/unusable/skipped counts. Complete root coverage and
  requested-file verification remain false; freshness stays `not_checked`.
- Keeps authorized source inspection available, with no automatic retry/rebuild.
  Raw stderr, command lines and the CLI's unrelated project inventory are omitted
  from error evidence sent to the Agent.

The guarded updater accepts only the reviewed capability preimage or the already
applied source, preserving unexpected local edits. It now verifies 12 installed
files. The rebuild lock includes the capability source as its 41st overlay;
package validation requires that file. The current runtime README documents the
evidence contract. Lifecycle policy remains 2026-10-28.3.

## Verification

- Final affected suite: **38/38** (9 context tests, 19 model-routing tests,
  9 update-safety tests, one exact rebuild contract check).
- Candidate TypeScript transformation/syntax and existing Worker entrypoint/
  recovery tests: **7/7**, plus actual entrypoint refusal during maintenance.
- Native read-only preflight: `naos-agent-stack` returned verified root,
  coverage=partial, partialFiles=7, completeRootCoverage=false and
  freshness=not_checked. `letta-poc` returned missing, PROJECT_NOT_INDEXED,
  autoIndexExcluded=true, and unknown counts/freshness.
- Actual installed run `op_3b47b31c64bd41fb` reused conversation `local-conv-84`
  and Sol 6.1/high. One successful external file read, exit code 0, no changed
  files, denied requests, blockers or unresolved effects. The response explained
  the cache failure behavior and accurately distinguished project index absence
  from service failure.
- Final readiness observation: ready; zero running, stale or unresolved
  operations; no maintenance lock.

The initial rebuild contract check caught a stale bootstrap content hash. The
lock was updated to the reviewed bootstrap bytes and the final 38-test suite
passed. No failing check is counted as passed without its successful rerun.

## Recovery and delivery

Installed backup:
`C:/Users/Naos/.openchatx-mcp/headless/toolboxes/agent-runtime/backups/lean-runtime-2026-10-30T15-06-57-749Z-b40ec907-aa8d-4ec3-8abc-74f611618f52`.

Final packages in `C:/Naos/02.Git/personal/`:

| Package | SHA256 |
| --- | --- |
| `Naos-Agent-Stack-core-context-20261030.1.zip` | `28EC3760871B26515CE0CC2B6EA47D4F1BB4E07042301C7DF5474BE7F4540901` |
| `Naos-Agent-Stack-v0.2.3-Complete-context-20261030.1-candidate.zip` | `8F85DB9B5D137B304C6409405583BD8AB25EA85657EED66D74AEA2D4267147B2` |

The Complete ZIP is 285675992 bytes. All 41 core overlay hashes and four critical
Complete entries matched the checkout. The workspace payload and dependency lock
point to this core. The installed verifier matched all 12 files. Windows
PowerShell 5.1 `tests/validate.ps1` passed its source, synthetic package rollback,
bootstrap and non-mutating installation-plan checks. These local candidates
supersede the model-routing-only delivery; model routing and the compiled core
revision `2026-10-30.handoff.2` are retained.

## Limits

The subsequent [exact-file context update](MSI_FILE_CONTEXT_VALIDATION_20261030.md)
implements optional bounded file checks. The paragraph below records the limit
at the time of this earlier diagnostic-only update.

Index freshness and exact requested-file coverage are now explicitly unknown,
not newly implemented checks. The index's parser gaps remain; direct source
inspection is authoritative. This change prevents misleading context evidence,
but does not establish a quantified development-speed improvement or
Codex-equivalent task quality.

PC2, clean-machine installation, reboot acceptance, production publication,
merge and Git push were not performed. Existing unrelated checkout changes
remain untouched and uncommitted.
