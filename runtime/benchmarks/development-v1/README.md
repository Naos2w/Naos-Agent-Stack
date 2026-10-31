# MSI development baseline v1

Three small, deterministic tasks exercise boundary handling, asynchronous error
recovery and a two-module contract repair. They use synthetic data only. The
existing Letta workflow executes them; this is not a general intelligence score.

Run `node benchmark.mjs prepare <run-id>` to create a fresh, bounded workspace
inside the registered sibling Letta-POC project. Preparation records the exact
starting files and failing tests; it never overwrites an earlier run. Give the
Agent the generated TASK.md and allow changes only to the listed source files.
Tests must remain unchanged. Use the same task text and initial fixture hashes
for future engine comparisons. Run `node benchmark.mjs grade <run-id>` afterward.

Each case has a 15-second test deadline, one test worker and a 256 MiB V8 heap
limit. These settings do not measure peak process memory. Grading independently
checks immutable files and unexpected additions before running assertions.
Compare task success, end-to-end time, manual interventions and reported usage.
Unavailable usage/cost stays unknown. Keep operation IDs and observed model
configuration in the result record. A single run is an initial baseline, not an
improvement percentage, a production acceptance test or a Codex comparison.

Case scopes:
- `range`: inclusive integer ranges, negative endpoints, validation.
- `cache`: concurrent callers share work; failed work can be retried.
- `invoice`: preserve a normalized producer contract and repair its consumer.
