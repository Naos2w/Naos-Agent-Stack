import { readFile, writeFile, copyFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function replaceOnce(text, before, after) {
  if (text.includes(after)) return text;
  if (text.split(before).length !== 2) throw Error('LETTA_RECOVERY_PATCH_SOURCE_CHANGED');
  return text.replace(before, after);
}
export function patchLettaRecovery(source) {
  let text = source.replaceAll('\r\n', '\n');
  const legacyRegistryLine = '            canRecover: canRecoverConversation, store: createInterruptedTurnStore(),\n            cwd:';
  text = text.replace(legacyRegistryLine,
    '            canRecover: canRecoverConversation, store: createInterruptedTurnStore(),\n            registeredTools: () => [...getRegisteredTools(runtime).values()].flat(),\n            cwd:');
  text = replaceOnce(text, `      const hasEligibleFailover = getSubscribedListenerConnections(runtime, {
        agent_id: conversationRuntime.agentId,
        conversation_id: conversationRuntime.conversationId
      }).some((connection) => connection.id !== connectionId);
      if (hasEligibleFailover) {
        conversationRuntime.activeConnectionId = null;`, `      const eligibleFailover = getSubscribedListenerConnections(runtime, {
        agent_id: conversationRuntime.agentId,
        conversation_id: conversationRuntime.conversationId
      }).find((connection) => connection.id !== connectionId);
      if (eligibleFailover) {
        conversationRuntime.activeConnectionId = eligibleFailover.id;`);
  text = replaceOnce(text, '        connectionId: connection.id,\n        resolve: (response) => {',
    '        connectionId: connection.id,\n        openchatxScope: toolName2.startsWith("openchatx_") ? requestRuntime : undefined,\n        resolve: (response) => {');
  text = replaceOnce(text, '    clearTimeout(pending.timeout);\n    pendingExternalToolCalls.delete(requestKey);',
    '    if (pending.openchatxScope?.agent_id) {\n      getOrCreateScopedRuntime(runtime, pending.openchatxScope.agent_id, pending.openchatxScope.conversation_id).turnLifecycle.requestCancellation();\n    }\n    clearTimeout(pending.timeout);\n    pendingExternalToolCalls.delete(requestKey);');
  text = replaceOnce(text, 'function createInterruptedTurnStore(directory = join69(homedir38(),',
    'function createInterruptedTurnStore(directory = process.env.LETTA_OPENCHATX_RECOVERY_STATE_DIR || join69(homedir38(),');
  text = replaceOnce(text, '    const legacyInput = legacyEnvironmentMessageToInputCommand(parsed);',
    '    if (parsed?.type === "openchatx_recovery" && typeof parsed.request_id === "string") return parsed;\n    const legacyInput = legacyEnvironmentMessageToInputCommand(parsed);');
  text = replaceOnce(text, '      if (parsed.type === "app_server_info") {', `      if (parsed.type === "openchatx_recovery") {
        try {
          const { handleRecovery } = await import("./openchatx-recovery.mjs");
          const scoped = getOrCreateScopedRuntime2(runtime, parsed.runtime.agent_id, parsed.runtime.conversation_id);
          const result = await handleRecovery(parsed, {
            runtime: scoped, backend: getBackend(), resume: getResumeDataFromBackend,
            canRecover: canRecoverConversation, store: createInterruptedTurnStore(),
            registeredTools: () => [...getRegisteredTools(runtime).values()].flat(),
            cwd: () => getConversationWorkingDirectory(runtime, parsed.runtime.agent_id, parsed.runtime.conversation_id),
            start: message => {
              const task = processIncomingMessage(message, getOrCreateProcessTransport(runtime), scoped, opts.onStatusChange, connectionId);
              runDetachedListenerTask("openchatx_recovery", () => task);
            }
          });
          safeSocketSend(socket, {type: "openchatx_recovery_response", request_id: parsed.request_id, ...result}, "openchatx_recovery_response", "openchatx_recovery");
        } catch (error) {
          safeSocketSend(socket, {type: "openchatx_recovery_response", request_id: parsed.request_id, success: false, error: error.message}, "openchatx_recovery_response", "openchatx_recovery");
        }
        return;
      }
      if (parsed.type === "app_server_info") {`);
  // Incomplete external work belongs to the controller's durable ledger. Do not
  // turn an unknown side effect into a stale-denial result on provider startup.
  text = replaceOnce(text, '        const approvals = recordedToolResults(record4, owned.map((approval) => approval.toolCallId));',
    '        if (owned.some(approval => approval.toolName?.startsWith("openchatx_") && !record4.results.some(result => result.tool_call_id === approval.toolCallId))) continue;\n        const approvals = recordedToolResults(record4, owned.map((approval) => approval.toolCallId));');
  // Letta 0.34.1 stores approved external-tool replies as successful even
  // when the verified external result had status="error". Preserve the source
  // result status in the durable transcript; do not rewrite historical turns.
  text = replaceOnce(text,
    '        content: this.toolResultContentFromUnknown(approval.tool_return),\n        isError: false',
    '        content: this.toolResultContentFromUnknown(approval.tool_return),\n        isError: approval.status === "error"');
  // Separate replacements also upgrade an already-installed recovery adapter.
  text = replaceOnce(text, '      const result = this.runStream(resolved2.model, context3, options);',
    '      const { configureOpenchatxStreamOptions } = await import("./openchatx-recovery.mjs");\n      const result = this.runStream(resolved2.model, context3, configureOpenchatxStreamOptions(resolved2.model.api, tools, options));');
  return text;
}
export async function installLettaRecovery(target) {
  const version = JSON.parse(await readFile(join(dirname(target), 'package.json'), 'utf8')).version;
  if (version !== '0.34.1') throw Error('LETTA_RECOVERY_VERSION_UNSUPPORTED');
  const original = await readFile(target, 'utf8');
  const next = patchLettaRecovery(original);
  const helper = join(dirname(target), 'openchatx-recovery.mjs');
  const oldHelper = await readFile(helper).catch(error => {if(error.code === 'ENOENT') return null;throw error;});
  const nextHelper = await readFile(new URL('./source/letta_recovery.mjs', import.meta.url));
  const replace = async (path, bytes) => {
    const temp = `${path}.${randomUUID()}.tmp`;
    try {await writeFile(temp, bytes, {flag:'wx',flush:true});await rename(temp,path);}
    finally {await rm(temp,{force:true});}
  };
  if (next !== original) await copyFile(target, `${target}.before-openchatx-recovery`, 1).catch(error => {if(error.code !== 'EEXIST')throw error;});
  try {await replace(helper,nextHelper);if(next !== original)await replace(target,next);}
  catch(error) {
    await replace(target,original);
    if(oldHelper === null)await rm(helper,{force:true});else await replace(helper,oldHelper);
    throw error;
  }
  return { version, changed: next !== original };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await installLettaRecovery(resolve(process.argv[2]))));
