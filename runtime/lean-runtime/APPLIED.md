# Local application record

For the 2026-10-30 MSI model-observation, handoff and development-benchmark
acceptance, see [the current MSI record](../MSI_OPTIMIZATION_20261030.md).

Historical .2 record. The installed version is now .3; see
[current reliability validation](RELIABILITY_VALIDATION.md).

Policy version `2026-10-28.2` was applied on MSI on 2026-10-28 at 17:18
Asia/Taipei. It supersedes the `2026-10-28.1` local update from 16:38.

## Installed changes

- Normal Letta worker runs inspect the existing development context without
  creating development receipts. Existing permission and applicable skill
  checks remain in place.
- An optional `task_ref` follows the existing work item through operation
  creation and polling; it does not create another task database.
- Operation results explicitly distinguish execution from delivery acceptance
  and identify the next action. Successful execution does not certify delivery
  or authorize a retry, merge or deployment.
- Current runtime guidance is separated from historical notes. The Letta-POC
  README also identifies its dual-engine material as historical.
- The installer and Runtime facade/CLI workers share a cross-process admission
  mutex and activity leases. Updates cannot race new worker dispatch.
- Caught replacement/verification failures roll back exact original bytes and
  remove newly created files. Rollback conflicts preserve later edits, retain a
  recovery journal and block new Runtime actions until explicit recovery.
- Current usage documentation identifies Shell Policy v2 while retaining the
  distinct ProjectExecutor API v1 version.

The eight installed source/document files match the prepared manifest hashes.
The generated facade imports the maintenance guard. The first migration was
performed offline with the existing health-watch mutex held and its pause
marker temporarily present; only the MCP process was stopped/restarted. MCP,
codebase-index and tunnel were confirmed online afterwards. The temporary
pause marker and recovery journal were absent after successful application.

## Validation

Using the configured Node.js 22.19.0 binary:

- 20 runtime-contract, guarded-installer and update-safety tests passed.
- 7 existing worker-entrypoint and recovery tests passed against the candidate.
- Native TypeScript transformation and JavaScript syntax checks passed for
  the changed worker, facade and contract helper.
- The actual candidate worker entrypoint refused startup while maintenance held
  the admission mutex, before reading input or contacting the model server.
- Fault injection covered the second replacement failing, final verification
  failing, rollback failing, and concurrent edits during rollback. Separate
  child-process tests covered both admission orders and attempted dispatch after
  the real installer's operations check, during replacement.

## Live Letta execution

One real model operation completed through the public tool, existing Letta
session, external-tool approval/execution and public polling:

- Project: `letta-poc`; session: `architecture-health-smoke-20261022`.
- Operation: `op_f8b91cf690dc452c`; task reference:
  `lean-runtime-20261028/read-only-e2e`.
- Exactly one external call: `openchatx_read_file`. The returned text was
  `PHASE2_EXTERNAL_TOOL_OK`; there were no denied requests, blockers or changed
  files, and `development_preflight_receipt_id` was null.
- Both run and poll returned policy `2026-10-28.2` and the same task reference.
  Final execution state was `completed`; delivery remained `not_evaluated` with
  `acceptanceVerified=false`; next action was `check_existing_task_acceptance`.
- The operation reported ProjectExecutor API 1 and Shell Policy 2.
- Fixture `Letta-POC/phase2-tool-proof.txt` SHA256 before and after:
  `2B26A570B95BD74782B758E3787C171BC611038DBBBBE1779B85B079B1370C55`.
- No activity lease remained after the worker and poll completed.

This initial check validates the read-only model/tool execution chain. It is not
product feature acceptance or a performance benchmark. At that point no installer
release had been built or published. The subsequent local candidate, Stock
compatibility and real write/test/fix check are recorded in
[delivery validation](DELIVERY_VALIDATION.md). No product feature was changed.

## Recovery

Exact preimages and the application manifest are stored at:

```text
C:\Users\Naos\.openchatx-mcp\headless\toolboxes\agent-runtime\backups\lean-runtime-2026-10-28T09-18-28-687Z-2902eaed-78a3-4afe-9deb-bd4098529ee0
```

The workspace `.candidate/manifest.json` records before/after hashes. The
installed backup has its own manifest. A pending failure can be recovered with
the documented `recover` command. Files whose preimage is null were newly
created by this patch. Power loss/process termination can leave an abandoned
mutex requiring explicit offline inspection; automatic crash recovery was not
implemented or claimed.

Session data, operation records, credentials and Project permissions were not
changed by the installer. The E2E intentionally added one operation to the
existing POC session. Existing unrelated checkout changes were retained.
