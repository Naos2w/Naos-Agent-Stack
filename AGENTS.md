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

An identity mismatch must be reported rather than ignored. Existing
required CI, review, access-denial and release checks remain binding;
changing identity is not an authorization to retry an operation previously
denied by the platform.
