# Runtime delivery validation — 2026-10-28

This follow-up validates downstream compatibility, local packaging and a real
Letta edit/test/fix execution. It does not certify a product feature, performance
improvement, fresh-machine installation or published release.

## Stock compatibility

Stock's caller and mutation tests had already been updated concurrently before
this follow-up edited any files. They were preserved, not rewritten here.
`scripts/windows_scheduler/Test-AgentRuntimeStatus.ps1` passed and reported:

- `APPROVED INSTALLED STOCK LETTA COMPANION AND MUTATION TESTS PASSED`
- `ALL STOCK LETTA STATUS CONTRACT AND BOUNDED TIMEOUT TESTS PASSED`

The pure compatibility assertion also passed against the installed Runtime
2026-10-28.2. The live financial scheduler was not executed.

## Packaging and CI

- The exporter includes only the reviewed current Runtime README,
  `rules/shared-development-preflight.mdc` and its direct dependency
  `rules/runtime-anti-loop-triage.mdc`, alongside the existing skill whitelist.
  Private rules and historical documents remain excluded.
- Both the exporter and Complete builder require the Letta worker, contract and
  maintenance helpers, README, both rules and runtime usage skill. Existing
  cross-checks caught an initial mismatch between these two lists; the final
  lists match and the Complete candidate was rebuilt afterward.
- `dependencies.lock.json` now pins the fresh 2,968-file core export, including
  Runtime 2026-10-28.2 and Shell Policy 2. Eight critical exported source and
  policy files were independently compared with the installed files by SHA256.
- The manual GitHub Actions workflow now includes Node 22.19.0 contract and
  update-safety tests. Its existing manual trigger is preserved. The same command
  passed all 20 tests locally; no remote Actions run is claimed.
- Full `tests/validate.ps1` passed with `SOURCE_VALIDATION_PASSED`, including
  syntax, installer dry-runs, synthetic package/rollback tests, export filtering
  and locked-asset verification. `git diff --check` also passed.

Local artifacts, relative to the Naos-Agent-Stack checkout:

| Artifact | SHA256 |
| --- | --- |
| `payload/naos-headless-stack-bundle.zip` | `196883AAC82E09136547D2D0B3E04604333E3D742A522EE84E4BBE9B362B7F04` |
| `../Naos-Agent-Stack-v0.2.3-Complete-runtime-20261028-candidate.zip` | `8AC983B7E4986063BBA6D3D9F61DC1C0F7CE0D310C12F906875A285AB98A17C7` |

The final Complete ZIP is 285,699,384 bytes. Its embedded builder, bootstrap,
dependency lock and core ZIP were independently compared with the final local
files by SHA256. The sibling `.sha256.txt` records the package hash.

## Real Letta write/test/fix execution

- Project: `letta-poc`; existing session: `architecture-health-smoke-20261022`;
  conversation: `local-conv-84`.
- Operation: `op_66b9627018534db9`.
- Task reference: `lean-runtime-20261028/write-test-fix-e2e`.
- Fixture: `Letta-POC/tests/runtime-write-fix-20261028/`.
- Five external calls: two file reads, a failing test run, one implementation
  write and a passing test run. No denied requests or blockers.
- The model changed only `sum-inclusive.mjs`: `current < end` became
  `current <= end`. It did not change the four existing tests.
- Exact completed external-tool ledger records confirm the first shell exit
  code was 1 (three failures: `3 !== 6`, `0 !== 4`, `-2 !== 0`) and the second
  exit code was 0 (four passes). This is tool evidence, not just model narration.
- The root Developer independently reran the same test file: four passes,
  exit 0. Its SHA256 before and after was
  `5268BEC5B787146F6AF6F26A352C0CEC818E236FDC15D4ACE3A1B263BA4537EE`.
- Public run/poll returned Runtime 2026-10-28.2, the same task reference,
  ProjectExecutor API 1 and Shell Policy 2. The development receipt was null.
  Execution completed while delivery stayed `not_evaluated` with
  `acceptanceVerified=false`; the next action was to check existing acceptance.

Ledger tool-call IDs, in order (scoped to this project/conversation):

```text
call_9892a4b281c74cc289fbfe6eb7f3131d|fc_030b660ef2652c65016ae1d0b9912c81919b3008fafd1b4f8b
call_6994cb1ddcd24c019947b3afaed6814c|fc_030b660ef2652c65016ae1d0bde140819193cddedf0322d68b
call_7ddcb67809b74ed6ae4d8af401036839|fc_030b660ef2652c65016ae1d0c06d088191ac22fe96824eefb7
```

This fixture was limited by task instructions and existing Project permissions;
it was not a newly created OS sandbox. Codebase graph navigation was not tested:
the POC is explicitly excluded by `codebase-index.json`, with sync status
`skipped/AUTO_INDEX_EXCLUDED`. The generic `CODEBASE_INDEX_QUERY_FAILED` message
therefore did not imply a global outage. A control query for `naos-agent-stack`
returned ready (268 nodes, 529 edges).

## Remaining delivery boundaries

The follow-up source edits remain local and uncommitted. Installer files already
contain substantial unrelated changes, which were preserved. No push, PR,
publication, merge, live product task or installation on another machine was
performed. A clean Windows / NAOS-PC installation still requires its own
acceptance. Automatic recovery after process termination or power loss and
full task-reference integration across other callers remain separate work.
