# MSI conversation bootstrap acceptance

Date: 2026-11-01 (Asia/Taipei). Installed overlay: `2026-11-01.bootstrap.3`.
Bootstrap contract: `2026-11-01.3`. Letta policy remains `2026-10-28.3`.

## Delivered

- The existing MCP registration boundary attaches current guidance on first
  observation, `start_here`, Project selection and identity changes. A successful
  subsequent call needs only a compact execution receipt.
- Identity uses the configured Toolbox root, independent of the MCP state
  directory, and hashes actual Worker and policy bytes. The bootstrap version
  identifies loaded core code; updated core modules require service restart.
- Read-permitted active Projects receive bounded existing Goal and recent
  Session/Operation metadata. Repository TODOs and applicable rules still need
  to be read using scoped tools. No new task ledger or automatic replay exists.
- Guidance describes direct MCP versus persistent Letta execution, one Developer,
  task/acceptance handoff, proportionate checks and evidence-based completion.
- The existing audit logger persists only execution version, route and Worker
  hash. Outer model identity stays unknown. Runtime control is not evidence that
  a Worker ran; inspect the existing Operation's model selection evidence.
- Rebuild overlays and hashes include all changed core modules and snapshots.

## Verification

- 55 core-maintenance tests passed, including seven bootstrap tests and an audit
  field privacy test. Existing rollback and failure-diagnostic tests also passed.
- Initial rollback tests encountered sandbox temporary-directory rename EPERM;
  the unchanged tests passed using a writable workspace temporary directory.
- Live loopback MCP initialization, Project selection, Runtime discovery, direct
  tool receipt and clearing Project context passed via `verify-bootstrap-live.mjs`.
- The actual OpenChatX connector `start_here` also returned bootstrap 2026-11-01.3,
  enabled Runtime, ready state and scoped `letta-poc` continuation.
- On-disk audit entries contain the expected context/direct_mcp execution fields.
- 14/14 installed core modules and snapshots verified. Runtime readiness is ready,
  with zero running, stale or unresolved Operations and no maintenance lock.
- No pending update journal or health-watcher pause remained after installation.
- Final installation backup: `%USERPROFILE%/.openchatx-mcp/headless/backups/core-audit-Jt0oEh`.

## Limits

This validates delivery through the actual MCP entry points, not an autonomous
new ChatGPT dialogue completing a real development task. Version-change handling
was exercised in isolated tests; the current connector observed the new version.
The overlay cannot rewrite earlier conversation messages or guarantee that a
model follows guidance. Failed initialization/routing remains enforced.

No Letta/model task was started for these checks, no existing Operation replayed,
and no Codex-equivalence claim is made. PC2 was not updated. No fresh Windows
installation, published installer, Git push or production deployment was done.
The installer preimages describe the final MSI incremental upgrade from
bootstrap.2; they are not an updater for an unknown or older PC2 installation.

Next acceptance is an ordinary new project dialogue: verify the trace shows the
current bootstrap, the existing task is resumed, scope remains fixed, and the
requested outcome is actually checked. Compare execution engines only after this
shared entry and continuation behavior is stable in real use.
