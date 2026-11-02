# OpenChatX Architecture Project Instructions

## Owner-authorized merge and deployment

On 2026-11-02, the owner authorized automatic PR merge and deployment for the
OpenChatX architecture project, without repeated confirmation after required
checks pass. This project-specific instruction overrides the blanket prohibition
on automatic merge and production deployment in the global Codex AGENTS.md only
within the scope below. All other global instructions still apply.

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
- This authorization does not apply to merges or deployments in other product
  repositories, including Stock, S-Wallet, HouseLook and openclaw; those retain
  their own owner authorization and release requirements.
- Report the real merge/deployment outcome and any remaining blocker. Do not
  ask again solely because the global instruction prohibits automatic release
  when this scoped authorization already applies.
