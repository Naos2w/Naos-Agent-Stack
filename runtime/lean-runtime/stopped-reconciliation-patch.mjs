const stoppedReconciliation = `async function reconcileStoppedLettaOperation(project: ProjectRecord, before: RuntimeOperation) {
  const input = before.inputPath ? await readJsonFile<Record<string, any>>(before.inputPath, {}) : {}
  const state = await ensureState()
  const projectState = ensureProjectState(state, project.id)
  if (input.projectId !== project.id || !input.agentId || input.agentId !== projectState.lettaAgentId ||
      !input.conversationId || input.conversationId !== before.sessionId ||
      input.clientMessageId !== \`openchatx-\${before.id}\`) {
    throw new Error(\`LETTA_CANCEL_REMOTE_OWNERSHIP_UNVERIFIED: \${before.id}\`)
  }
  const config = await ensureConfig()
  const remote = await runLettaWorkerSync({
    action: "cancel", projectId: project.id, agentId: input.agentId,
    conversationId: input.conversationId, clientMessageId: input.clientMessageId,
  }, config, 25_000)
  if (remote.ok !== true || !["cancelled", "already_idle"].includes(remote.status)) {
    throw new Error(\`LETTA_CANCEL_REMOTE_UNCERTAIN: \${before.id}\`)
  }
  return withOperationsLock(async () => {
    const operations = await readOperations()
    const current = operations[before.id]
    if (!current || current.projectId !== project.id || current.engine !== "letta" ||
        current.inputPath !== before.inputPath || current.sessionId !== before.sessionId ||
        current.pid !== before.pid || current.state === "running" || isProcessRunning(current.pid)) {
      throw new Error(\`OPERATION_CHANGED_DURING_CANCEL: \${before.id}\`)
    }
    const stdout = await readText(current.stdoutPath)
    const stderr = await readText(current.stderrPath)
    const parsed = stdout.trim() ? parseLettaWorkerOutput(stdout) : {}
    current.remoteSettlement = {
      schema: 1, source: "explicit_cancel", operationId: current.id, projectId: project.id,
      conversationId: input.conversationId, clientMessageId: input.clientMessageId,
      status: remote.status, runId: remote.runId ?? null, observedAt: now(),
    }
    current.reconciliation = summarizeReconciliation(current, parsed, stderr)
    current.updatedAt = now()
    await saveOperations(operations)
    return { ok: true, operationId: current.id, state: current.state, alreadyStopped: true,
      remoteStatus: remote.status, reconciliation: current.reconciliation }
  })
}

`;

function replaceOnce(text, old, next) {
  if (!text.includes(old) || text.indexOf(old) !== text.lastIndexOf(old)) {
    throw Error('STOPPED_RECONCILIATION_SOURCE_CHANGED');
  }
  return text.replace(old, next);
}

export function patchStoppedReconciliation(text) {
  if (!text.includes('reconciliation: operation.reconciliation,\n      }),')) {
    text = replaceOnce(text, 'idempotency: parsed.validation?.idempotency, stalePoll: !sessionUpdate.current,',
      'idempotency: parsed.validation?.idempotency, stalePoll: !sessionUpdate.current,\n        reconciliation: operation.reconciliation,');
  }
  if (text.includes('async function reconcileStoppedLettaOperation(')) return text;
  text = replaceOnce(text, 'const { summarizeReconciliation, retainUnresolvedOperation }',
    'const { summarizeReconciliation, retainUnresolvedOperation, applyRemoteSettlement }');
  text = replaceOnce(text, '  reconciliation?: Record<string, any>',
    '  reconciliation?: Record<string, any>\n  remoteSettlement?: Record<string, any>');
  text = replaceOnce(text, '    operations[id] = {\n      ...existing,\n      ...protectedPatch,',
    '    if (protectedPatch.reconciliation) {\n' +
    '      protectedPatch.reconciliation = applyRemoteSettlement(\n' +
    '        { ...existing, ...protectedPatch }, protectedPatch.reconciliation,\n' +
    '      )\n' +
    '    }\n    operations[id] = {\n      ...existing,\n      ...protectedPatch,');
  text = replaceOnce(text, 'async function cancelOperation(project: ProjectRecord, operationId: string) {',
    stoppedReconciliation + 'async function cancelOperation(project: ProjectRecord, operationId: string) {');
  return replaceOnce(text, '    return { ok: true, operationId, state: before.state, alreadyStopped: true }',
    '    if (before.engine === "letta" && before.reconciliation?.requiresReconciliation === true) {\n' +
    '      return reconcileStoppedLettaOperation(project, before)\n' +
    '    }\n    return { ok: true, operationId, state: before.state, alreadyStopped: true }');
}
