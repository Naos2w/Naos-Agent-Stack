function once(text,before,after) {
  if(text.split(before).length!==2) throw Error('BACKEND_ORPHAN_SOURCE_CHANGED');
  return text.replace(before,after);
}
export function patchBackendOrphanWorker(text) {
  if(text.includes('LETTA_ORPHAN_REMOTE_TAIL_UNVERIFIED')) return text;
  text='import { verifyReadOnlyOrphanTail } from "./operation_reconciliation.mjs"\n'+text;
  text=once(text,'          recovery.status === "uncertain"','          recovery.status !== "cancelled"');
  text=once(text,
    '  const response = await withClient((client) => client.request({\n    type: "abort_message",\n    request_id: client.nextRequestId("recover-backend-orphan"),',
    `  if (!input.clientMessageId) throw new Error("LETTA_ORPHAN_REMOTE_TAIL_UNVERIFIED")
  const response = await withClient(async (client) => {
    const tail = await client.request({
      type: "conversation_messages_list", request_id: client.nextRequestId("orphan-ownership"),
      conversation_id: conversationId, query: {limit: 20, order: "desc", include_err: true},
    }, "conversation_messages_list_response", 8_000)
    if (tail.success !== true || !verifyReadOnlyOrphanTail(tail.messages, {
      agentId, conversationId, clientMessageId: input.clientMessageId,
    })) throw new Error("LETTA_ORPHAN_REMOTE_TAIL_UNVERIFIED")
    return client.request({
    type: "abort_message",
    request_id: client.nextRequestId("recover-backend-orphan"),`);
  return once(text,
    '  }, "abort_message_response", 8_000))', '  }, "abort_message_response", 8_000)\n  })');
}

export function patchBackendOrphanRuntime(text) {
  if(text.includes('ownerClientMessageId: proof.clientMessageId')) return text;
  text=once(text,'retainUnresolvedOperation, applyRemoteSettlement }',
    'retainUnresolvedOperation, applyRemoteSettlement, describeReadOnlyBackendConflict }');
  text=once(text,'        const proof = findRecoverableBackendRun(',
    '        const proof = describeReadOnlyBackendConflict(');
  text=once(text,'            runId: proof.runId,\n          }, config, 25_000)',
    '            runId: proof.runId,\n            clientMessageId: proof.clientMessageId,\n          }, config, 25_000)');
  return once(text,`          return {
            ok: true, operationId, state: before.state,
            alreadyStopped: true, remoteStatus: "backend_orphan_cancelled",
            orphanRunId: proof.runId,
          }`, `          return withOperationsLock(async () => {
            const latest = await readOperations()
            const current = latest[before.id]
            const owner = latest[proof.ownerOperationId]
            if (!current || !owner || current.state !== "failed" || current.inputPath !== before.inputPath ||
                current.sessionId !== proof.conversationId || owner.sessionId !== proof.conversationId ||
                current.projectId !== project.id || owner.projectId !== project.id ||
                isProcessRunning(current.pid) || isProcessRunning(owner.pid)) {
              throw new Error(\`OPERATION_CHANGED_DURING_CANCEL: \${operationId}\`)
            }
            const observedAt = now()
            for (const record of [owner, current]) {
              record.remoteSettlement = {
                schema: 1, source: "explicit_cancel", operationId: record.id, projectId: project.id,
                conversationId: proof.conversationId, clientMessageId: \`openchatx-\${record.id}\`,
                status: "cancelled", runId: proof.runId, observedAt,
                ownerOperationId: proof.ownerOperationId, ownerClientMessageId: proof.clientMessageId,
              }
              const output = await readText(record.stdoutPath)
              record.reconciliation = summarizeReconciliation(record,
                output.trim() ? parseLettaWorkerOutput(output) : {}, await readText(record.stderrPath))
              record.updatedAt = observedAt
            }
            await saveOperations(latest)
            return { ok: true, operationId, state: current.state, alreadyStopped: true,
              remoteStatus: "backend_orphan_cancelled", orphanRunId: proof.runId,
              reconciliation: current.reconciliation }
          })`);
}
