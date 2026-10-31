# Runtime reliability validation — 2026-10-28.3

This record supersedes the installed-version and packaging status in APPLIED.md
and DELIVERY_VALIDATION.md. Their earlier execution evidence remains historical.
The later [core audit application](../core-maintenance/ROUTING_DIAGNOSIS.md)
supersedes this record's core-package hashes and current OpenClaw routing status;
Runtime policy remains .3.

## Applied on this machine

- Runtime policy `2026-10-28.3` was applied with the guarded updater; all ten
  installed targets passed SHA256 verification. No service restart was needed.
- Health observers were installed with the dedicated replacement/rollback
  script; all five installed files matched their reviewed sources.
- Stock's Runtime compatibility hashes and mutation-test component list were
  updated for this version. The financial scheduler was not executed.

Runtime backup:

```text
C:\Users\Naos\.openchatx-mcp\headless\toolboxes\agent-runtime\backups\lean-runtime-2026-10-28T11-23-37-154Z-c9cffd41-68a5-4637-82a0-a694a45f38ed
```

Observer backup:

```text
C:\Users\Naos\.openchatx-mcp\headless\backups\health-observers-20261028-112651-694023ff50c043a89101ff21a92b1c32
```

## Behavior

- Health now includes the maintenance mutex, pending recovery journal, registry
  schema, stale workers and recorded unresolved side effects. Unknown/corrupt
  state is non-ready. A live, short admission mutex is distinguished from a
  maintenance lock. Monitoring never deletes a lock or repairs operation state.
- The offline updater explicitly supports PowerShell 5.1; its PM2 parser no
  longer depends on `ConvertFrom-Json -AsHashtable` and rejects native failures.
- Poll returns structured reconciliation derived from recorded execution
  evidence, including remote identifiers and completed idempotency/tool records.
  Unknown tool effects remain unresolved even if a remote run is idle. Automatic
  retry is never authorized by these diagnostics. Unresolved records and their
  input evidence survive the ordinary 200-operation pruning limit.
- Audit archive policy is explicit: 90 days, a 2 GiB soft quota and preservation
  of the newest three archives. It is **report-only**. Active logs, unresolved
  evidence and replay/QA records are protected; no automatic deletion or hard
  disk bound is claimed.
- Reviewed facade, worker, policy and existing compiled core fixes have local
  source copies. A fixed base ZIP plus 23 SHA-pinned overlays reconstructs the
  candidate core without reading the installed runtime.

## Verification performed

- 30 Node tests passed across runtime contract, update safety, readiness,
  reconciliation, audit retention and core-patch suites.
- One additional source-lock/rebuild-contract test passed, including facade and
  worker patch idempotence; it was rerun after the final line-ending policy fix.
- Seven existing worker-entrypoint/recovery tests passed against the candidate.
  Candidate TypeScript transformation and JavaScript syntax checks also passed.
  The real candidate entrypoint refused dispatch while maintenance held its lock.
- Native Windows PowerShell 5.1 fixture tests passed for watchdog decisions,
  corrupt/unresolved/pending state, the actual offline PM2 parser, observer file
  replacement and rollback after a second-file sharing violation.
- Full source validation passed with `SOURCE_VALIDATION_PASSED`. Stock's status,
  mutation and bounded-timeout regression tests passed after the live update.
- Live watchdog CheckOnly reported HEALTHY; the final read-only readiness probe
  returned ready=true, running=0, stale=0 and unresolved=0. Audit inspection
  returned archiveCount=0, overQuota=false and automaticDeletionAllowed=false.
- Public polling of existing operation `op_66b9627018534db9` returned policy .3
  and structured recorded-evidence reconciliation. It retained the original
  task reference and completed tool records. This did **not** rerun the task,
  initiate a new model operation or perform a fresh remote interruption test.
- Two independent core rebuilds had identical content manifests for all 2,959
  payload files. ZIP timestamps/createdUtc differ, so archive hashes differ.
- Final Complete-package Doctor, builder, dependency lock, bootstrap and embedded
  core matched current working files. `git diff --check` passed.

No remote CI run, new .3 model E2E or product feature acceptance is claimed.

## Local candidate artifacts

Paths below are relative to the repository root.

| Artifact | SHA256 |
| --- | --- |
| `../Naos-Agent-Stack-core-base-20261028.zip` | `196883AAC82E09136547D2D0B3E04604333E3D742A522EE84E4BBE9B362B7F04` |
| `../Naos-Agent-Stack-core-runtime-20261028.3.zip` | `A583B96C4A63E80713DECE72573AF76770375F0D5097079B8998553F224EAC45` |
| `../Naos-Agent-Stack-core-runtime-20261028.3-rebuild-check.zip` | `4C5228B0ABB9C00EB6378208C672C332A1EBC6C708218778A370CF6D4C6E7233` |
| `../Naos-Agent-Stack-v0.2.3-Complete-runtime-20261028.3-candidate.zip` | `C654AD81ECD673C3ED0DEE4F606116587DE4660D6B4518DC18DA5E45700F4EF0` |

The main rebuilt core is also `payload/naos-headless-stack-bundle.zip`, pinned by
dependencies.lock.json. Exact input bytes are protected by explicit LF attributes
for runtime sources and the existing CRLF policy for the bootstrap PowerShell.

## Remaining boundaries

- Fresh Windows installation, reboot and cross-host operation need a disposable
  machine or VM. The current machine contains existing dependencies and cannot
  prove those scenarios. This does not block current-machine development.
- The .2-to-.3 Runtime update was applied and checked. The complete installer
  still preserves existing installations; generic full-platform upgrade and
  clean-machine installation have not been accepted.
- The rebuild uses pinned compiled core files. It does not reproduce missing
  upstream TypeScript sources or claim byte-identical ZIP archives.
- Letta recovery diagnostics do not make interrupted approvals resumable or
  establish exactly-once remote execution. A fresh interruption/reconciliation
  E2E remains separate from the recorded-result polling check.
- WSL argument/path controls are not a Linux OS sandbox. No new OS isolation
  boundary was added.
- Caught observer-install errors roll back. Power loss/process termination may
  still require inspection and manual recovery using retained backups.
- This .3 work and the candidate packaging remain local and uncommitted. Existing
  unrelated changes in both repositories were preserved. No release, push,
  production deployment or unrelated change was included in a commit.

## OpenClaw blocking diagnosis

The recent conversation `取得OpenClaw進度`
(`6ae09f5f-e9e8-83ee-894a-ef6faedcb616`) reports a platform safety/approval rejection
of `project_manage(action=use, project_id=openclaw)`, followed by
`PROJECT_ROUTING_REQUIRED`. The available conversation read contains assistant
summaries, not the original rejection response. These are reported observations,
not independently verified platform decision evidence.

Subsequent inspection of the original local audit found successful initialization
at 18:15 on October 28 (UTC+08:00) but no `use` entry for that session. It found a
failed health call at 18:46 and two successful project-list calls at 18:47. The
same day contains 19 successful OpenClaw `use` calls from other sessions. This
supports a missing selection request at the local boundary; it does not establish
the platform's reason. See [routing diagnosis](../core-maintenance/ROUTING_DIAGNOSIS.md).

The local registry contains OpenClaw with its expected path and read/write/shell
permissions. The inspected Runtime state had its latest operation polled and
completed with exit code 0. The observed blocker is therefore not evidence of a
WSL argument failure, insufficient project permissions or a stuck Letta worker.

Relevant local evidence:

- `C:/Users/Naos/.openchatx-mcp/projects.json` — registered project.
- Installed toolbox `state.json` / `operations.json` — latest completion.
- Installed core `dist/mcp/tool-registration-boundary.js` — routing guard runs
  before project execution.
- Installed core `dist/tools/projects/project-tools.js` — the multi-action
  `project_manage` tool is annotated destructive=true/readOnly=false and includes
  both project selection and higher-impact management actions.
- Installed core `dist/projects/project-scope.js` — `use` selects the registered
  project/session identity.

The shared annotation is a design concern, not a proven rejection cause. The
schema presentation layer also omits default-valued annotations, so the source
declaration must not be mistaken for a captured client-side decision trace. The
routing guard and annotations were not weakened, and the denied selection was
not retried through another tool.
This diagnosis does not claim that OpenClaw has been unblocked.

Its separate D5 pipeline acceptance/migration TODOs remain development work;
historical news-timing/canonical acceptance issues do not explain this platform
selection rejection. No OpenClaw source, Live state or release was changed.
