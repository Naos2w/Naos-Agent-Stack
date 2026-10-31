import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { installLettaRecovery } from './letta-recovery-provider-patch.mjs';

// Preserve the existing version-pinned orphan cancellation correction.
const target = resolve('node_modules/@letta-ai/letta-code/letta.js');
const before = `  if (params.command.run_id && params.command.run_id !== scopedRuntime.activeRunId) {
    return false;
  }
  if (!hasActiveTurn && !hasPendingApprovals) {
    return false;
  }`;
const after = `  if (params.command.run_id && params.command.run_id !== scopedRuntime.activeRunId) {
    if (!hasActiveTurn && !hasPendingApprovals) {
      try {
        await resolvedDeps.cancelConversationRun(scope.conversation_id, params.command.run_id);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
  if (!hasActiveTurn && !hasPendingApprovals) {
    try {
      await resolvedDeps.cancelConversationRun(scope.conversation_id, params.command.run_id ?? null);
      return true;
    } catch {
      return false;
    }
  }`;
const source = await readFile(target, 'utf8');
if (!source.includes(after)) {
  if (source.split(before).length !== 2) throw Error('LETTA_ORPHAN_CANCEL_PATCH_PATTERN_NOT_FOUND');
  await writeFile(target, source.replace(before, after), 'utf8');
}
console.log(JSON.stringify(await installLettaRecovery(target)));
