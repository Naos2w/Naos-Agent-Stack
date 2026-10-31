// Letta 0.34.1 adapter: resume original, backend-pending tool results only.
// No prompt replay, arbitrary result injection, or approval-policy override.
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { join } from 'node:path';

const locks = new Set();
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const items = page => Array.isArray(page) ? page : page?.getPaginatedItems?.() ?? page?.items ?? page?.data ?? [];
const fail = code => { throw new Error(code); };

export async function verifyLocalCompletion(backend, scope, messageId, inputId) {
  // Local 0.34.1 drops ephemeral run IDs after a server restart. Its durable
  // transcript still records the model stop reason. Read a bounded tail only.
  if (backend.capabilities?.localModelCatalog !== true || typeof backend.getLocalStorageDir !== 'function') return false;
  const root = backend.getLocalStorageDir();
  if (typeof root !== 'string' || !root || scope.conversation_id === 'default') return false;
  const key = Buffer.from(`conversation:${scope.conversation_id}`).toString('base64url');
  let file;
  try {
    file = await open(join(root, 'conversations', key, 'messages.jsonl'), 'r');
    const stat = await file.stat(), offset = Math.max(0, stat.size - 1024 * 1024);
    const buffer = Buffer.alloc(stat.size - offset);
    const {bytesRead} = await file.read(buffer, 0, buffer.length, offset);
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    if (offset) text = text.slice(text.indexOf('\n') + 1);
    const messages = text.split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(record => record.type === 'message').map(record => record.message);
    const last = messages.at(-1), user = [...messages].reverse().find(message => message.role === 'user');
    return last?.id === messageId && last.role === 'assistant' && last.stopReason === 'stop' &&
      !last.errorMessage && !last.content?.some(part => part.type === 'toolCall') && user?.otid === inputId;
  } catch { return false; }
  finally { await file?.close(); }
}

export async function handleRecovery(command, deps) {
  const { runtime, backend, resume, canRecover, store, start, cwd } = deps;
  const scope = command.runtime;
  if (!scope?.agent_id || !scope.conversation_id || !command.client_message_id ||
      !['inspect', 'resume'].includes(command.action)) fail('RECOVERY_SCOPE_INVALID');
  const key = JSON.stringify([scope.agent_id, scope.conversation_id]);
  if (locks.has(key)) fail('RECOVERY_BUSY');
  locks.add(key);
  try {
    const idle = () => runtime.turnLifecycle.kind === 'idle' && runtime.pendingApprovalResolvers.size === 0;
    if (!idle()) fail('RECOVERY_REMOTE_BUSY: listener active');
    if (!await canRecover(runtime)) fail('RECOVERY_REMOTE_BUSY: ownership unconfirmed');
    const conversation = await backend.retrieveConversation(scope.conversation_id);
    if (conversation.agent_id !== scope.agent_id) fail('RECOVERY_AGENT_MISMATCH');
    const tail = items(await backend.listConversationMessages(scope.conversation_id,
      { limit: 100, order: 'desc', include_err: true }));
    const user = tail.find(message => message.message_type === 'user_message');
    if (!user || (user.otid !== command.client_message_id && user.client_message_id !== command.client_message_id))
      fail('RECOVERY_ORIGINAL_INPUT_UNVERIFIED');
    const agent = await backend.retrieveAgent(scope.agent_id);
    const data = await resume(agent, scope.conversation_id, { includeMessageHistory: false });
    const pending = data.pendingApprovals;
    if (!Array.isArray(pending)) fail('RECOVERY_PENDING_UNKNOWN');
    if (!pending.length) {
      const assistant = tail[0];
      const run = assistant?.run_id ? await backend.retrieveRun(assistant.run_id) : null;
      const completed = run?.status === 'completed' || (!assistant?.run_id &&
        await verifyLocalCompletion(backend, scope, assistant?.id, command.client_message_id));
      if (command.action === 'inspect' && assistant?.message_type === 'assistant_message' &&
          completed && idle() && await canRecover(runtime)) {
        const current = await backend.retrieveConversation(scope.conversation_id);
        if (!idle() || JSON.stringify(current.in_context_message_ids) !== JSON.stringify(conversation.in_context_message_ids))
          fail('RECOVERY_PENDING_CHANGED');
        return {success: true, settled: true, messages: [assistant], runId: assistant.run_id ?? null};
      }
      fail('RECOVERY_NO_PENDING_TOOLS');
    }
    if (pending.length > 64) fail('RECOVERY_TOO_MANY_PENDING_TOOLS');
    const calls = pending.map(approval => ({ toolCallId: approval.toolCallId,
      toolName: approval.toolName, input: typeof approval.toolArgs === 'string' ? JSON.parse(approval.toolArgs) : approval.toolArgs }));
    if (new Set(calls.map(call => call.toolCallId)).size !== calls.length || calls.some(call =>
      !call.toolCallId || !call.toolName?.startsWith('openchatx_') || !call.input || typeof call.input !== 'object'))
      fail('RECOVERY_UNSUPPORTED_PENDING_TOOLS');
    const revision = hash({ scope, input: command.client_message_id, calls });
    if (!idle() || !await canRecover(runtime) || !idle()) fail('RECOVERY_REMOTE_BUSY');
    const current = await backend.retrieveConversation(scope.conversation_id);
    if (JSON.stringify(current.in_context_message_ids) !== JSON.stringify(conversation.in_context_message_ids) || !idle())
      fail('RECOVERY_PENDING_CHANGED');
    if (command.action === 'inspect') return { success: true, revision, calls };
    if (command.revision !== revision || !Array.isArray(command.results) || command.results.length !== calls.length)
      fail('RECOVERY_PENDING_CHANGED');
    const results = calls.map(call => {
      const matches = command.results.filter(result => result.toolCallId === call.toolCallId);
      const entry = matches[0];
      if (matches.length !== 1 || entry.toolName !== call.toolName || hash(entry.input) !== hash(call.input) ||
          !Array.isArray(entry.result?.content) || entry.result.content.some(part => part.type !== 'text' || typeof part.text !== 'string'))
        fail('RECOVERY_RESULT_MISMATCH');
      return { type: 'tool', tool_call_id: call.toolCallId,
        tool_return: entry.result.content.map(part => part.text).join('\n'),
        status: entry.result.is_error === true ? 'error' : 'success' };
    });
    // Stable continuation ID also survives loss of the acceptance response.
    const requestOtid = `openchatx-recovery-${revision}`;
    const record = { agentId: scope.agent_id, conversationId: scope.conversation_id,
      workingDirectory: cwd(), toolCallIds: calls.map(call => call.toolCallId), results, requestOtid };
    store.write(record);
    runtime.pendingInterruptedResults = null;
    runtime.pendingInterruptedContext = null;
    runtime.pendingInterruptedToolCallIds = null;
    runtime.recoveredApprovalState = null;
    // start() claims the lifecycle synchronously, before this lock is released.
    start({ type: 'message', agentId: scope.agent_id, conversationId: scope.conversation_id,
      messages: [{ type: 'approval', approvals: results, otid: requestOtid }] });
    return { success: true, accepted: true, revision, recoveredTools: results.length };
  } finally { locks.delete(key); }
}
