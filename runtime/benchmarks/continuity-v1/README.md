# Compaction continuity and tool evidence fixture

This is a two-stage development/continuation acceptance scenario, not a general
intelligence score or a full-day workload benchmark. It reuses the existing
MSI Letta-POC Agent/conversation and writes only a new isolated fixture.

1. Run `node benchmark.mjs prepare <new-run-id>` after ensuring the registered
   Letta-POC project's `tests/runtime-continuity-v1` parent exists.
2. Give the Agent the generated existing TASK.md and authorize phase 1 only.
   It repairs pricing, runs its tests, preserves the invoice module for later,
   performs one expected directory-read diagnostic and an identical file rewrite,
   then updates that same task record with progress and constraints.
3. Poll the accepted operation. Independently run
   `node benchmark.mjs grade <run-id> 1`. Inspect actual tool outcomes and file
   effects; the expected directory rejection (NOT_A_FILE or EISDIR) must stay visible, and the identical rewrite must
   not appear in changed_files.
4. Compact that same conversation through the public Runtime API. Resume phase 2
   by pointing to the existing task record; do not restate the implementation.
5. Poll and run `node benchmark.mjs grade <run-id> 2`. Both modules must pass all
   five tests. Pricing must remain byte-identical to phase 1, tests and the
   unchanged marker must match the initial hashes, and no extra files may exist.

Tests run with one test worker, a 256 MiB V8 heap limit and a 15-second deadline.
The deadline/heap setting does not measure peak process memory. The task record
is explicitly mutable; test files are independently pinned. `runs/` stores
initial state, grading and allowlisted public Runtime observations.

The negative probe is an intentional test execution error, not a permission
denial and not a request to replay a previously denied real-project action.
Reconciliation and current release gates remain in force. This workflow creates
no additional Agent or task database and does not enable automatic compaction
or change the existing compaction threshold.
