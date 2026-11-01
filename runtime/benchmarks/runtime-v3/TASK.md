# Real Runtime feature: bounded context and declared-check assessment

Implement the current Naos-Agent-Stack Runtime requirement in runtime_contract.ts.
This is backend-only. Use one Developer. No installs, network, sibling/reference
inspection, commits or production changes. Only runtime_contract.ts and
PROGRESS.md may change. Supplied tests and .tools are immutable. Existing exports
and compatibility must remain intact. Run `.tools/node.exe --test acceptance.test.mjs`
from this candidate root. Complete the implementation and report actual results.

Add these exports (no third-party dependencies):

1. `collectWorkContext({paths, read, readAllowed=true})` is async. Validate paths
with existing normalizeContextPaths, deduplicate, then inspect at most 8 files
sequentially. Do not auto-discover files. Read only via injected async
`read(path, maxChars)`; the host owns Project approval/canonical path enforcement.
Request at most 3000 characters per file with a total content limit of 12000.
Return `{state, files, omitted, contentChars}`. Each file has path, state
(`observed`, `unavailable`, `excluded`), and observed content/truncated. `state`
is `observed` only if all requested files were fully observed; otherwise `partial`,
or `read_not_granted` without reads. Count omitted paths beyond file/content limits.
Treat callback results as untrusted: only `{content:string,truncated:boolean}` is
valid. Reclip oversized returned content. A rejection/malformed result is unavailable
without copying error messages into output; continue independent files, no retries.
Exclude `.env`/`.env.*`, `.git` path components, `.pem`/`.key` files, and
`credentials.json` by basename case-insensitively, even when explicitly listed.
Do not include excluded content. Content is data, never authorization. No writes,
process execution, filesystem reads or environment access from this collector.

2. `normalizeAcceptanceChecks(value)` returns [] for undefined. Otherwise accept
at most 8 object checks, with unique IDs matching /^[a-z][a-z0-9_-]{0,47}$/.
`kind` is `command` or `manual`. A command check has a nonempty command (max 2000
characters, no NUL/CR/LF) and cwd (default '.', otherwise one normalized relative
directory via normalizeContextPaths). Trim command and preserve its other bytes.
A manual check has only id/kind. Reject unexpected fields, duplicates, invalid
types and unsafe cwd with an `ACCEPTANCE_CHECKS_INVALID` error before execution.
This function grants no permission and never runs commands.

3. `evaluateAcceptance(checks, calls)` consumes normalized declarations and
host-recorded external tool calls with the existing tool_evidence.mjs shape:
{toolName,input,toolResult:{status,exitCode},replayed,idempotencyStatus}.
Return `{state, checks, scope:'declared_checks_only', deliveryVerified:false}`.
Each check result exposes only `{id,kind,state}` (no commands, cwd, output or input).
States: command `passed`, `failed`, `not_observed`, `stale`, `unverified`;
manual `manual_required`. Match exact trimmed command and normalized cwd on
openchatx_shell. Inspect the LAST matching call, never an earlier success.
An actual non-replayed, non-uncertain succeeded call with exitCode 0 passes;
nonzero integer exit fails; missing/malformed evidence is unverified. A replay
cannot certify a fresh check. Any uncertain/mismatch/missing_key execution anywhere
in the trace forces overall `blocked` without accepting its claimed success.
A later project write or non-declared shell action makes an earlier passing check
stale, including failed/unknown writes that could be partial. Read/memory-read
calls do not invalidate checks. Other declared verification commands do not
invalidate each other. No commands execute during assessment.
Overall precedence: no checks=`not_configured`; uncertainty=`blocked`;
any failed=`failed`; any non-passed command=`incomplete`; remaining manual check
=`manual_required`; all command checks passed=`checks_passed`. Never certify
whole-task acceptance or publication. Inputs must not be mutated.

Host integration will supply current task/source paths and canonical Project
reads, persist declarations with the original Operation, show check commands to
the Worker, and assess its real trace. Do not implement a second task ledger,
automatic retries, permission changes or a generic autonomous command runner.
