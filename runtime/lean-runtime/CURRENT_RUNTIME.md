# Current OpenChatX Agent Runtime

Policy version: **2026-10-28.3**. Active execution uses **Letta only**.
OpenCode and the standalone Phase 2 toolbox are retired. Their records and
POC results are historical evidence, not current operating instructions.

## Live connection interruption recovery

Each active turn now uses two scoped WebSocket connections to the same Agent
and conversation: one control connection handles input/approvals; a stable tool
connection owns external tool registrations and results. This is one Worker and
one model turn, not another Agent or a second execution of the task.
Letta's supported subscriber failover keeps the turn alive when control drops.
The Worker reattaches control at most twice within the original turn deadline,
with stale-approval recovery disabled, and handles the original approval IDs.
It never resends `create_message`. Tools already running finish through the same
tool connection and unchanged idempotency ledger. Terminal events from either
connection can complete the turn. Both connections close at the end of the Worker.

This covers a control-connection loss while the Worker, Letta process and tool
connection remain alive. Loss of the tool connection, both connections, Worker
or Letta process is not transparent recovery. Such operations retain uncertain
effect evidence and require reconciliation. Missing input acceptance, changed
runtime scope and exhausted reconnect attempts also cannot authorize a replay.
No provider source, permissions, denial decision or replay claim is overridden.

The authoritative installed workflow is
`rules/shared-development-preflight.mdc`. Explicit current user instructions,
Project permissions and applicable repository release requirements retain
their existing precedence. This document does not grant permission to publish.

## Responsibilities

Explicit backend-only exclusions such as "no UI" do not request design Skills.
Positive UI work elsewhere in the task or concrete frontend paths still does.
The public read-only development preflight refreshes its gate/capability/review
dependency versions on each call, so a long-lived tool cannot keep obsolete
classification or index coverage after a supported Runtime update.

The read-only `runtime_readiness.mjs` helper distinguishes transport liveness
from Runtime readiness. Maintenance, pending recovery, stale workers, invalid
registries and unresolved operations must not be reported as healthy. A normal
brief admission mutex is informational; no observer deletes locks or repairs state.

Polling records `reconciliation` evidence for the same operation. It reports
remote settlement separately from external tool results and never authorizes a
retry. Unresolved operations retain their inputs and logs beyond ordinary count
limits. Letta interruption recovery remains bounded by its protocol; a remote
idle state is not proof that a side effect did not occur.

For the same actual conversation, `run` refuses `OPERATION_EFFECTS_UNRESOLVED`
when a retained reconciliation record has incomplete, invalid, in-flight or
uncertain tool-effect evidence. Reading the result, renaming the session or a
newer successful operation cannot clear that condition. The check runs before
remote inspection and again inside the dispatch lock. Manual and automatic
compaction also preserve that unresolved context. Inspect the identified
original operation; do not create a replacement identity to retry it.
Independent conversations remain usable. Proven zero-call timeouts and complete
recorded tool outcomes retain the existing remote-state checks and recovery
path; passing this effect-specific check does not mark remote state settled.

For an already-polled failed operation whose Worker has stopped, an explicitly
authorized `cancel` also rechecks remote settlement using that operation's
retained project, Agent, conversation and client-message identity. It records a
durable settlement receipt without changing `failed` into task success. Later
polls preserve that receipt, including a poll that raced the cancellation.
In-flight tools, uncertain writes and missing execution evidence remain
unresolved even when the remote conversation is idle. No automatic retry or
resumption of interrupted tool approval is implied.

Letta 0.34.1 listener idle is not sufficient backend-settlement evidence: a
backend-only Run may still reject the next input. `already_idle` therefore
keeps reconciliation unresolved. When a new input is explicitly rejected by
that backend Run, recovery of the preceding read-only timeout additionally
checks the latest remote user-message identity, Agent and conversation, with
no intervening tool activity. It cancels only the exact conflicting Run,
requires backend cancellation confirmation, and saves settlement for both the
original timeout and the input rejected before execution. It never relies on
elapsed time alone, clears an unknown execution claim, or replays either prompt.

Workers emit bounded, content-free tool start/completion records before sending
tool responses. If a tool finishes after the turn timeout, later polling can
observe that completion; a closed response socket cannot erase it or trigger
re-execution. The original timeout counts remain visible separately. These
records contain local sequence numbers and fixed status enums, not arguments,
commands, paths or result content. At most 256 calls are considered for automatic
evidence reconciliation; incomplete, contradictory or overflowing traces remain
unresolved. Confirmed remote settlement is still required.

The unchanged idempotency guard is now source-controlled and hash-pinned with
the Runtime. A completed identical tool identity can return its saved result;
an incomplete execution claim remains uncertain after a process restart. Never
delete that claim or replace the identity to force a retry. Hard interruption
without complete execution evidence and interrupted Letta approvals still need
explicit investigation; the Runtime does not claim automatic resumption.

- The existing project task/TODO owns the goal, acceptance criteria and next
  approved action. Keep using that record; do not create a second task ledger.
- `agent_runtime` owns operation/session lifecycle, permissions, cancellation,
  replay protection and execution evidence. It does not certify product delivery.
- Actual tests, repository CI, user approvals and deployment evidence determine
  readiness at the appropriate stage. Optional review is explicit opt-in.

## Normal work

1. Select the authorized Project and existing named Letta session.
2. Read the current task and relevant source. Use one Developer by default.
3. Run the next actionable item. Optional `task_ref` identifies the existing
   item, for example `tasks/todo.md#D5`; it is not a filesystem access grant.
4. Poll the accepted operation before starting another turn in that session.
5. Check the existing task's acceptance criteria against real evidence. Update
   that task and continue independent authorized work when one operation is blocked.

Normal runs inspect development context without writing development receipts.
Read-only inspection still enforces existing Project/task/applicable skill
checks. Public disabled QA tools stay disabled. An audit receipt is neither a
new task nor merge/deploy authorization.

## Result contract

- Existing `state` and `ok` retain operation lifecycle semantics.
- `execution.state` makes that scope explicit.
- `delivery.state=not_evaluated` and `acceptanceVerified=false` mean the runtime
  has not evaluated the product acceptance criteria, even after a successful run.
- `delivery.taskRef` preserves the caller's existing task identifier in the
  operation registry and polling result. Omission remains compatible with old callers.
- `next_move` identifies polling, checking acceptance, resolving the affected
  operation, or reconciling uncertain side effects. It never authorizes a retry.
- A stale poll cannot direct work for a newer operation. It asks the caller to
  inspect the current operation instead.
- `runtimePolicy` identifies this contract and the current rules entrypoint.
- Successful run results and the latest polled session expose `modelConfiguration`
  version 1: the effective conversation model, reasoning setting and context limit observed before
  that turn. This is a configuration snapshot, not proof of provider-side execution
  or a live context-usage meter. Unknown values remain null; a prior session
  observation includes its timestamp and must not be treated as a fresh lookup.
- Polling returns allowlisted token `usage` when reported by Letta. Missing usage
  remains null and cannot be converted into a claimed cost or token saving.

## Tool execution evidence (version 1)

`validation.tool_outcomes` distinguishes successful, failed and unknown tool
responses. It preserves bounded error codes/exit codes without copying tool
content, commands or stderr. Failure counts remain visible after a later
identical executed request succeeds; `later_identical_success` describes only
that tool attempt, not delivery acceptance or permission to retry. Unresolved
failures/unknown replies are review items in `blockers`, not an assertion that
the entire project is unusable. Existing uncertain-side-effect reconciliation
still takes precedence. Calls rejected before reaching this Worker are outside
this evidence scope; historical records without outcomes remain unverified.

`changed_files` now includes only successful direct write calls with observed
before/after byte changes. Observation uses existing ProjectExecutor approvals,
reads at most 1 MiB per snapshot, and never grants read access to a write-only
project. An unchanged write, replay or unavailable observation cannot assert a
new change. `validation.file_effects` also exposes observed partial changes
around failed writes for inspection. This is point-in-time evidence, not proof
against concurrent editors. Shell and external-editor changes are not covered;
use actual source/diff and acceptance checks for delivery.

## Task continuity

For multi-step work, retain the current goal, approved constraints, completed
changes, real test evidence, unresolved issues and next action in the existing
project TODO when writing it is authorized. Read-only work reports this context
without a new file. On resumption/compaction, reread that task record and relevant
current source. `task_ref` stays an opaque identifier, not a path-read grant;
known files can be passed in `context_paths`. No second task database, automatic
checkpoint writer or additional Agent is introduced. The existing compaction
trigger remains unchanged; continuity must be checked by actual resumed work.

## Task-based model selection (version 1)

On `run`, an explicit `model` wins over `task_complexity`; explicit
`reasoning_effort` wins over the profile. Otherwise the supervising conversation
classifies the approved task: `simple` selects `openai-codex/gpt-6-luna` / medium,
`standard` selects `openai-codex/gpt-6.1-sol` / high, and `complex` selects
`openai-codex/gpt-6-astra` / high. Omission or uncertainty uses standard.
The runtime applies this deterministic policy; it does not make a second model
call or guess complexity from prompt keywords. The current user choice takes
precedence over these defaults.

`model=auto` uses the same profiles. `gpt-*` aliases are normalized to
`openai-codex/*`. The compatibility value `letta/agent-config` preserves the
current conversation configuration and cannot be combined with selection fields.
Model selection is run-only; compact/session creation retain their existing contract.

`modelSelection` version 1 records mode, complexity, selected model, reasoning,
reason, effort source and conversation scope. Acceptance reports `state=planned`;
only verified readback reports `state=applied`. `modelConfiguration.source` is
`letta.conversation_retrieve` for routed turns and can still be
`letta.agent_retrieve` for historical observations. A configuration snapshot
does not prove which model the provider actually executed.

Selection reuses the existing Agent and named conversation. It verifies the
catalog, effort, current ChatGPT OAuth provider, conversation ownership and remote
idle state, then updates only that conversation and reads back the result before
sending input. Shared Agent defaults and other conversations remain unchanged.
Runtime operations are serialized by existing guards; external clients must not
mutate this conversation concurrently because Letta does not offer an atomic
idle-check/update transaction across clients.

A selection failure stops the operation without automatic fallback or inference
replay. A successfully applied conversation override persists even if a later
turn fails; reconcile that operation before further work. Catalog availability
is checked but does not guarantee provider access. Lifecycle policy remains
2026-10-28.3; model routing is an additive, separately versioned contract.

## Codebase context evidence

Codebase status separates a missing project index (`PROJECT_NOT_INDEXED`) from
a failed query. Nonzero CLI exits with a structured missing-index response are
interpreted before generic process failure. Timeout, unavailable binary, local
process permissions, output limits, invalid replies and root mismatch retain
distinct bounded codes; raw stderr and other indexed project names are not
forwarded to the Agent.

`autoIndexExcluded` explains the existing synchronization configuration. It does
not prohibit reading a manually created index, authorize indexing, or imply a
service outage. Missing indexes use authorized source inspection without
automatic retries or rebuilds. Query failures report `codebase.status=error`;
they do not establish that the project lacks permissions or an index.

`status=verified` means an index-status query and root check succeeded. Coverage
counts preserve partial/unusable/skipped files; zero counts are not proof of
completeness. `completeRootCoverage` is false, `requestedFilesVerified` is false
and freshness remains `not_checked` when no exact-file observations are available.
The existing source reads remain authoritative before edits. These diagnostics
do not change model selection, operation guards or project access boundaries.

`run.context_paths` optionally supplies up to 16 known project-relative exact
files (512 characters each). The facade normalizes and deduplicates these hints,
and the worker passes them to the existing read-only context inspection. They
are not a write allowlist or acceptance criteria. Omit them until paths are
known; the Agent can later call `openchatx_codebase_context` with
`action=coverage` and `paths` for newly discovered files.

Only matching index scopes are queried, with the most specific scope owning each
file. Existing ProjectExecutor read approval, including realpath boundaries, and
an actual file check precede coverage queries. A shared 20-second CLI budget,
at most two concurrent scope processes and 12-second individual timeouts bound
the queries. There is no automatic reindex, retry or directory coverage scan.

`pathChecks` version 1 records requested/observed counts, observation time and
per-file coverage/freshness or a bounded unavailability reason. Its `checked`
state means the metadata response matched all requested files and the observed
index generation; it does not certify current contents or complete parsing.
`freshness=path_metadata_observed` has the same limited meaning. Missing indexes,
unreadable paths, directories, truncated replies, changed generations and query
failures cannot become successful file observations. `metadata_changed` alone
does not prove content changed; `no_recorded_issue` is not a completeness claim.

## Permissions and recovery

Project read/write/shell boundaries use the existing ProjectExecutor API v1.
The installed core uses Shell Policy v2; its version is independent of the
ProjectExecutor API version.
The external-tool replay ledger, operation locks, session ownership and
cancellation correlation remain authoritative. A failed or cancelled operation
must be reconciled before retrying a possible side effect. Letta's interrupted
external-tool approval limitation is not permission to repeat the operation.

`run`/`compact` manage the configured local App Server on demand. `status` and
`probe` do not start it. Never start a model CLI for routine verification.

## Source and maintenance

The installed `.ts` files are the runtime sources; the toolbox loader generates
`.openchatx.mjs` files. New workers read current TypeScript source. Initial
maintenance-protocol installation requires a brief stop/restart of the managed
MCP process, coordinated with its health watcher. Product services are unaffected.

The reproducible change, regression tests and guarded installer live in
`Naos-Agent-Stack/runtime/lean-runtime`. `prepare` captures the exact installed
preimages, builds a candidate and records hashes; `apply` refuses drift or
running operations, keeps backups and only changes the listed runtime files.
The facade and every CLI worker acquire activity leases through the same
cross-process admission mutex used by the installer. Maintenance refuses live
leases or running operations and prevents new dispatch throughout replacement,
verification and rollback. It also covers synchronous inspection/compaction.

Caught apply/verify failures restore exact preimages (including removal of newly
introduced files). Concurrent edits are preserved and reported. A failed rollback
leaves a recovery journal that blocks all new runtime actions until `recover`
completes. Backups and journal support recovery after process interruption; there
is no claim of automatic recovery from power loss. An abandoned mutex is never
stolen on a timer: stop MCP/watchdog, verify its recorded owner PID has exited,
and remove only that stale mutex directory before explicit recovery.

`verify` checks installed bytes. No credentials, session data, operation records
or permissions are changed. This is a local runtime update, not publication of
a new Naos-Agent-Stack release or completion of clean-Windows installer acceptance.

Earlier runtime notes are preserved in `docs/history/runtime-before-20261028.md`.
Use those only to investigate a specifically dated event.
