import { open, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Bounded metadata only. Tool content, commands, stdout and stderr stay out of
// public execution evidence. An empty/malformed result is never a success.
const ERROR_CODES = new Set(['ENOENT', 'EISDIR', 'NOT_A_FILE', 'ENOTDIR', 'EACCES', 'EPERM', 'ETIMEDOUT',
  'WRITE_CONTENT_TOO_LARGE', 'EXTERNAL_TOOL_DISPATCH_FAILED', 'CODEBASE_QUERY_TIMEOUT',
  'CODEBASE_BINARY_UNAVAILABLE', 'CODEBASE_INDEX_ROOT_MISMATCH', 'CODEBASE_QUERY_FAILED']);
export function describeToolResult(toolName, result) {
  const valid = result && Array.isArray(result.content) && result.content.length > 0 &&
    result.content.every(part => part?.type === 'text' && typeof part.text === 'string') &&
    (result.is_error === undefined || typeof result.is_error === 'boolean');
  let exitCode = null;
  if (valid && toolName === 'openchatx_shell') {
    try {
      const value = JSON.parse(result.content[0].text).exit_code;
      if (Number.isSafeInteger(value)) exitCode = value;
    } catch { /* Unknown command outcome remains unknown. */ }
  }
  const status = result?.is_error === true || exitCode !== null && exitCode !== 0 ? 'failed'
    : !valid || toolName === 'openchatx_shell' && exitCode === null ? 'unknown' : 'succeeded';
  const prefix = valid ? result.content[0].text.match(/^([A-Z][A-Z0-9_]+)(?=:|\s|$)/)?.[1] : null;
  return { version: 1, status, exitCode, errorCode: status !== 'succeeded' && ERROR_CODES.has(prefix) ? prefix : null,
    reason: status === 'failed' ? 'TOOL_EXECUTION_FAILED' : status === 'unknown' ? 'TOOL_RESULT_UNVERIFIED' : null };
}

const SNAPSHOT_LIMIT = 1024 * 1024;
export async function observeWriteTarget(project, input, approve) {
  const unavailable = reason => ({ state: 'unavailable', reason });
  if (project.permissions?.read !== true) return unavailable('READ_PERMISSION_REQUIRED');
  if (typeof input.path !== 'string' || !input.path || input.path.length > 512)
    return unavailable('WRITE_PATH_UNVERIFIED');
  let handle;
  try {
    // Existing write approval validates parents even before a new file exists.
    if ((await approve(project, 'openchatx_write_file', input)).behavior !== 'allow')
      return unavailable('WRITE_APPROVAL_DENIED');
    let actual;
    try { actual = await realpath(resolve(project.path, input.path)); }
    catch (error) {
      return error.code === 'ENOENT' ? { state: 'absent' } : unavailable('FILE_OBSERVATION_UNAVAILABLE');
    }
    if ((await approve(project, 'openchatx_read_file', { path: actual })).behavior !== 'allow')
      return unavailable('READ_APPROVAL_DENIED');
    if (!(await stat(actual)).isFile()) return unavailable('FILE_NOT_REGULAR');
    handle = await open(actual, 'r');
    const before = await handle.stat();
    if (!before.isFile()) return unavailable('FILE_NOT_REGULAR');
    if (before.size > SNAPSHOT_LIMIT) return unavailable('FILE_TOO_LARGE');
    const buffer = Buffer.alloc(SNAPSHOT_LIMIT + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat();
    if (length > SNAPSHOT_LIMIT) return unavailable('FILE_TOO_LARGE');
    if (before.size !== length || after.size !== length || before.mtimeMs !== after.mtimeMs)
      return unavailable('FILE_CHANGED_DURING_OBSERVATION');
    return { state: 'observed', bytes: length,
      sha256: createHash('sha256').update(buffer.subarray(0, length)).digest('hex') };
  } catch { return unavailable('FILE_OBSERVATION_UNAVAILABLE'); }
  finally { await handle?.close().catch(() => {}); }
}

export function describeFileEffect(before, after) {
  if (['absent', 'observed'].includes(before?.state) && after?.state === 'observed')
    return { state: before.state === 'absent' || before.sha256 !== after.sha256 ? 'changed' : 'unchanged',
      verification: 'sha256_before_after', beforeHash: before.sha256 ?? null, afterHash: after.sha256 };
  return { state: 'unverified', verification: 'unavailable',
    reason: before?.reason ?? after?.reason ?? 'FILE_EFFECT_UNVERIFIED' };
}

export function summarizeToolEvidence(calls = []) {
  const safe = value => typeof value === 'string' && /^[A-Za-z0-9._:|+-]{1,256}$/.test(value) ? value : null;
  const status = call => ['succeeded', 'failed', 'unknown'].includes(call?.toolResult?.status)
    ? call.toolResult.status : 'unknown';
  const identity = call => JSON.stringify([call.toolName, call.input]);
  const uncertain = call => ['uncertain', 'mismatch', 'missing_key'].includes(call.idempotencyStatus);
  const failures = calls.flatMap((call, i) => {
    if (status(call) === 'succeeded' && !uncertain(call)) return [];
    // A later, actually executed identical request is observable recovery of
    // that tool attempt, never proof of task acceptance or permission to retry.
    const recovered = status(call) === 'failed' && !uncertain(call) && calls.slice(i + 1).some(later =>
      status(later) === 'succeeded' && !uncertain(later) && later.replayed !== true &&
      later.idempotencyStatus !== 'replayed' && identity(later) === identity(call));
    return [{ tool: safe(call.toolName) ?? 'unknown', toolCallId: safe(call.toolCallId),
      status: status(call), reason: uncertain(call) ? 'SIDE_EFFECT_REQUIRES_RECONCILIATION'
        : status(call) === 'failed' ? 'TOOL_EXECUTION_FAILED' : 'TOOL_RESULT_UNVERIFIED',
      exitCode: Number.isSafeInteger(call.toolResult?.exitCode) ? call.toolResult.exitCode : null,
      errorCode: ERROR_CODES.has(call.toolResult?.errorCode) ? call.toolResult.errorCode : null,
      recovery: recovered ? 'later_identical_success' : 'review_required' }];
  });
  const writes = calls.filter(call => call.toolName === 'openchatx_write_file');
  const fileEffects = writes.map(call => {
    const path = typeof call.input?.path === 'string' && call.input.path.length <= 512 &&
      !/[\x00-\x1f\x7f]/.test(call.input.path) ? call.input.path : null;
    const replay = call.replayed === true || call.idempotencyStatus === 'replayed';
    const effect = call.fileEffect;
    const verified = effect?.verification === 'sha256_before_after' &&
      /^[a-f0-9]{64}$/.test(effect.afterHash) &&
      (effect.beforeHash === null || /^[a-f0-9]{64}$/.test(effect.beforeHash));
    return { path, toolCallId: safe(call.toolCallId), toolStatus: status(call),
      state: replay ? 'replayed' : uncertain(call) ? 'unverified' : verified ? (effect.beforeHash !== effect.afterHash ? 'changed' : 'unchanged') : 'unverified',
      verification: !replay && verified ? 'sha256_before_after' : 'unavailable' };
  });
  const changedFiles = [...new Set(fileEffects.filter(effect => effect.path &&
    effect.toolStatus === 'succeeded' && effect.state === 'changed').map(effect => effect.path))];
  const unresolved = failures.filter(failure => failure.recovery === 'review_required');
  return { changedFiles,
    toolOutcomes: { version: 1, scope: 'runtime_recorded_calls', total: calls.length,
      succeeded: calls.filter(call => status(call) === 'succeeded').length,
      failed: calls.filter(call => status(call) === 'failed').length,
      unknown: calls.filter(call => status(call) === 'unknown').length,
      recovered: failures.length - unresolved.length, reviewRequired: unresolved.length,
      failures: failures.slice(0, 32), failuresTruncated: failures.length > 32 },
    fileEffects: { version: 1, scope: 'direct_write_calls_only', shellEffects: 'not_checked',
      total: fileEffects.length, files: fileEffects.slice(0, 32), truncated: fileEffects.length > 32 },
    blockers: unresolved.slice(0, 32).map(failure => `${failure.tool}: ${failure.reason}; inspect the tool result before continuing the affected action`) };
}
