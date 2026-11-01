# Paired development acceptance v2

This is a controlled, synthetic comparison, not an intelligence score or a
production acceptance test. It extends the existing v1 fixtures with a real
headless Edge interaction case and a planned diagnosis/implementation handoff.
The historical Naosledge M9 case remains separate real-project evidence.

Both candidates start with identical SHA256 inventories, TASK.md, tests, Node
bytes and an already-installed Playwright Core copy. The owner authorized an
independent Codex task with GPT-6.1 Sol / High. OpenChatX uses the same selected
model and effort through Letta; effective settings are recorded separately from
requested settings. Harness prompts, toolsets, policies and runtime overhead
differ, so this is a workflow comparison, not a controlled model-quality study.

Run `node benchmark.mjs prepare` once from the repository with the installed
Node 25.2.1. Preparation refuses overwrite, downloads nothing, and requires the
existing Naosledge Playwright Core installation and Edge. It records failures
before either agent starts. Use `node benchmark.mjs grade codex` and
`node benchmark.mjs grade openchatx` for independent immutable-file and test checks.
The candidate roots and detailed local logs are ignored under `.cache/`.

Cases: integer boundaries, async cache rejection/retry, a producer/consumer
invoice contract, and UI filtering/literal-text/empty-state/keyboard behavior.
The UI runs at 1280x800 and 390x844 with reduced motion, blocks page network
requests, uses synthetic names and has no asynchronous loading, authentication
or persistence. No production data is used. An optional evaluator-owned
`BENCHMARK_SCREENSHOTS` directory receives desktop/mobile captures; the browser
tests alone are not a visual quality judgment or a complete accessibility audit.

Phase 1 diagnoses and writes only PROGRESS.md. Phase 2 receives the same
continuation prompt, rereads its own source/progress and implements only four
allowed modules. The evaluator checks file hashes independently; agents cannot
change acceptance tests to obtain a pass. A phase boundary is a planned handoff,
not proof of recovery from an arbitrary process kill. Existing interruption
regressions and M9 real-project continuation provide separate evidence.

Report per-case success, immutable-file violations, observed model, elapsed
operation/turn time, interventions and usage when exposed. Do not count missing
usage as zero, compare overlapping CPU time as reliable speed improvement, or
infer general parity from four small cases. Preserve initial failures and any
environment errors in the result record.

The recorded first run used `../.tools/node.exe` from each case directory.
OpenChatX rejected that syntax before execution; its Worker selected the same
authorized in-project executable by its canonical absolute path and retained the
denials in the phase-1 report. The future preparation template now states this
canonical-path requirement. Frozen candidates from the recorded run were not
changed or rebaselined by that harness correction.

After both frozen suites passed, evaluator source inspection prompted an extra
numeric-boundary probe (`probe-range.mjs`). The initial Codex solution rounded
intermediate arithmetic incorrectly; OpenChatX's loop did not advance for the
large endpoint and hit the two-second deadline. This exploratory probe was not
pre-registered acceptance. Both received the same oracle in one extra feedback
round; first-pass evidence is retained separately from corrected outcomes.
