# OpenChatX Architecture Project Instructions

## Owner-authorized merge and deployment

On 2026-11-02, the owner authorised automatic PR merge and deployment for the
OpenChatX architecture project without repeated confirmation after required
checks pass. On 2026-11-05, the global Codex and Claude user instructions were
updated to allow owner-approved end-to-end delivery, so no blanket merge or
deployment prohibition needs overriding. All other global instructions apply.

- Scope: approved architecture work in this Naos-Agent-Stack repository and its
  OpenChatX Runtime, installer and maintenance components on MSI and PC2.
- Complete the currently approved task, review the actual diff, and pass the
  required tests and release checks before merging or deploying. A general
  authorization does not create new work or authorize unrelated changes.
- Use PRs and preserve branch protection, required CI, repository verification
  requirements and platform-enforced approvals. Do not bypass a failed or
  unavailable required check, approval rejection or permission denial.
- Update and verify MSI first, then synchronize PC2. Use the existing maintenance
  locks, consumer compatibility checks, backups, transactional update and recovery
  procedures. Verify installed versions and actual runtime health afterward.
- Preserve credentials, private data, machine-specific settings, existing
  sessions and unrelated working-tree/index changes. Do not expose sensitive
  information or relax Project permissions to complete a deployment.
- Other repositories, including Stock, S-Wallet, HouseLook and openclaw, follow
  the global owner-approved delivery policy together with their own real CI,
  review, release and permission requirements. This project-specific rule does
  not itself authorise unrelated changes in those repositories.
- Report the real merge/deployment outcome and any remaining blocker. Do not
  ask again solely to reconfirm an already approved merge or deployment when
  the applicable release checks have passed.


## Release decisions must use current evidence

A previous PR, Operation, permission error, safety denial or CI marker is
history, **not** the result of the current release check. For each approved
merge/deploy, identify the exact repository, branch/PR, head SHA and target
environment and inspect the **current** GitHub identity/permission, required CI,
review requirements and release/consumer compatibility checks. Never conclude
"platform blocked" from past conversation, a stale TODO, a former 403 or a
historical `Degraded` health indicator.

In particular, `OPERATIONS_REQUIRE_RECONCILIATION` does not itself prohibit
publishing an independent, quiescent MSI Runtime update. Check the separate
read-only `runtime_readiness.mjs <runtime-root> --maintenance` result and the
publisher's actual guarded eligibility. Its `allowed=true` with
`HISTORICAL_RECONCILIATION_PRESERVED` permits the maintenance path while
preserving those failed Operations and their same-conversation no-replay gates.

Call an action "platform denied" **only after an actual present-tense platform
refusal of that precise action**. Report the relevant action, result/error and
which current gate is failing; use "not yet checked" if no current attempt was
made. Do not evade a real denial by switching tools, identities or scopes.
A new, separately authorised release after legitimately resolving an earlier
account/CI issue should receive fresh checks, not an inherited old verdict.
Continue other approved, independent work while one particular action is
blocked, and never fabricate approval or validation.

## MSI multi-account GitHub operations

This is the `Naos2w/Naos-Agent-Stack` repository. `git commit` uses the
personal `includeIf` Git configuration, but `gh` selects its own globally
active GitHub account. A successful Git push does **not** prove that a
subsequent `gh` command has the same identity.

For repository-specific GitHub CLI work, use
`runtime/Invoke-Naos2wGh.ps1 -GhArgs @('pr','view','9')` (with the
actual GitHub arguments) rather than relying on whichever account was last
activated with `gh auth switch`. The wrapper checks this repository's
origin, obtains only the stored Naos2w credential for this one invocation,
verifies the authenticated `Naos2w` login and restores pre-existing
process token variables. It must never print or persist the token. Work
repositories retain their own identity and workflows. When using the
connected GitHub app instead of the CLI, select the authenticated Naos2w
account for this repository.

An identity mismatch must be reported rather than ignored. A previously
denied action must not be retried through another tool or account to evade
that denial. After a legitimate account correction, a **new authorised**
release must be checked on its own current merits; do not treat old 403s as
permanent repository-wide restrictions. Required CI, reviews and release
checks remain binding.
