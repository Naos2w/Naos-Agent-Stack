# Real-project M9 repair replay

This case uses Naosledge's real historical crash-safety defect, not an invented
toy problem and not a new production fix. Source starts at `707c856`; the known
repair is `2476363`. Two immutable test files come from the repair commit.
The candidate cannot inspect the reference snapshot. Existing Naosledge worktrees
and production data are not modified.

## Selection

Naosledge provides deterministic offline evidence for an asynchronous bug spanning
two modules. It exercises reading, diagnosis, scoped editing, durable task handoff
and truthful acceptance. Stock has temporal/external-data dependencies; Mushrooms
has uncertain image labels and ML generalization; HouseLook requires visual
judgment; OpenClaw's remaining items include conflicting migration expectations
and a previously denied release. These are useful later cases, less controlled
as the first architecture acceptance.

## Execution

Run with the existing Node 25 installation:

```powershell
node runtime/benchmarks/naosledge-m9/benchmark.mjs prepare
node runtime/benchmarks/naosledge-m9/benchmark.mjs grade
```

Preparation refuses to overwrite an existing run. It copies tracked source and
only the needed already-installed Markdown parser dependencies. No package is
downloaded. The initial preparation needed missing static fixture files and
dependencies; `setup-existing` is a pre-Agent calibration command for that case,
not a command to run after candidate edits (it refreshes initial hashes).

Tests use synthetic owner identities, temporary files and injected transports.
The preload rejects global fetch. The real Windows replacement helper is included;
local unrestricted test execution is needed when the desktop filesystem sandbox
rejects realpath/rename. These settings do not create a general OS sandbox.

Owner approval on 2026-11-01 permits copying the existing Node executable into
this isolated Project. Its bytes are hash-verified; executable, tests, input task,
and all files except the two allowed implementation modules and PROGRESS.md stay
immutable. The original rejected external Node-path command is retained in the
phase-1 evidence and is not retried through an alternative spelling.

Phase 1 diagnoses and writes PROGRESS.md. `resume-from-new-mcp.mjs` verifies a new
MCP session receives the current bootstrap, original completed Operation and task
reference, then resumes the same named Letta conversation for implementation.
It does not create a new ChatGPT conversation. Run it only once after phase 1 is
complete; it submits authorized model work and records the accepted operation ID.

The grader independently compares all candidate hashes and runs both suites.
Retain baseline/reference logs, initial manifest, handoff, Operation IDs, final
grade and model observations. A passing historical case is not a coding benchmark
score, production acceptance or Codex comparison.
