# Runtime real-feature comparison

This task implements the actual approved Runtime context/declared-check contract,
starting from commit `a3e1fd5`. It is one backend feature, repeated in three fresh
candidates per engine; it is not six independent types of development task.

Each candidate receives identical AGENTS.md, TASK.md, 17 visible acceptance tests,
the existing Runtime source and a private copy of Node 25.2.1. Only
runtime_contract.ts and PROGRESS.md can change. The harness inventories every
candidate file before and after; test/binary/input changes invalidate a result.
Candidates are instructed not to inspect siblings or parent solutions, delegate,
install, commit or publish. This is instruction-based experiment separation, not
an OS sandbox or proof that every possible outside read can be excluded.

The authorized model is GPT-6.1 Sol / high on both sides, checked against actual
Codex turn metadata and Letta conversation metadata. Executions are sequential:
Codex 1, OpenChatX 1, Codex 2, OpenChatX 2, Codex 3, OpenChatX 3. Other root-agent
integration/build checks may run on the same host, so timings are descriptive,
not a controlled model-speed study. The OpenChatX installed runtime remains
unchanged throughout all three attempts. No supervising repair hints are sent.

Run `node benchmark.mjs prepare` from this directory in a checkout with no
`.cache`. The pinned source hash must match; the resulting initial fingerprint
also depends on the Node executable. After each authorized executor finishes,
run `node benchmark.mjs grade codex-1` (and corresponding other IDs).
`node measure.mjs` repeats the identical evaluator three times per final source,
recording elapsed time and peak RSS for that isolated Node validator only.
This memory measurement excludes model inference, Codex, Letta and whole-host
memory. Validation runs are not additional model-task attempts.

Original results and artifacts remain under ignored `.cache`; the checked-in
result summary records IDs, scope checks, hashes, model observations and timing.
The 17 visible tests establish scoped behavior, not a hidden test benchmark,
general reasoning equivalence, UI acceptance, release permission or reliability
across unrelated repositories. The selected first Codex implementation was
reviewed and then integrated separately into the actual host and Worker.
