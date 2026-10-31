// Apply an explicit, identity-bound remote settlement without erasing effects.
export function applyRemoteSettlement(operation, summary) {
  const receipt = operation.remoteSettlement;
  if (receipt?.schema !== 1 || receipt.source !== 'explicit_cancel'
      || receipt.operationId !== operation.id || receipt.projectId !== operation.projectId
      || receipt.conversationId !== operation.sessionId
      || receipt.clientMessageId !== `openchatx-${operation.id}`
      || receipt.clientMessageId !== summary.clientMessageId
      || !['cancelled', 'already_idle'].includes(receipt.status)
      || !Number.isFinite(Date.parse(receipt.observedAt))) return summary;
  const countsKnown = [summary.externalRequests, summary.externalCompleted]
    .every(value => Number.isSafeInteger(value) && value >= 0);
  const inFlight = countsKnown && summary.externalRequests !== summary.externalCompleted;
  const uncertainEffects = !Array.isArray(summary.idempotency)
    || summary.idempotency.some(item => !['executed', 'replayed'].includes(item.status));
  return { ...summary, remoteState: 'settled',
    requiresReconciliation: !countsKnown || inFlight || uncertainEffects,
    automaticRetryAllowed: false,
    reason: !countsKnown ? 'EXECUTION_EVIDENCE_INCOMPLETE' : inFlight ? 'EXTERNAL_TOOL_IN_FLIGHT'
      : uncertainEffects ? 'SIDE_EFFECT_UNCERTAIN' : 'REMOTE_SETTLED_EFFECTS_NOT_ROLLED_BACK',
    settlement: receipt };
}

// Summarize existing execution evidence. This does not contact Letta, retry a
// tool, declare side effects absent, or authorize removal of replay records.
export function summarizeReconciliation(operation, result = {}, stderr = '') {
  let timeout = null, recovery = null;
  for (const line of String(stderr).split(/\r?\n/)) {
    if (!line.startsWith('{')) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.kind === 'LETTA_TURN_TIMEOUT_DIAGNOSTIC') timeout = entry;
      if (entry.kind === 'LETTA_TIMEOUT_RECOVERY') recovery = entry;
    } catch { /* Non-JSON stderr is not recovery evidence. */ }
  }
  const error = typeof result.error === 'string' ? result.error : '';
  const idempotency = (Array.isArray(result.validation?.idempotency)
    ? result.validation.idempotency : Array.isArray(timeout?.idempotency) ? timeout.idempotency : [])
    .map(item => ({ tool: String(item?.tool ?? 'unknown'),
      toolCallId: typeof item?.tool_call_id === 'string' ? item.tool_call_id : null,
      status: String(item?.status ?? 'unknown') }));
  const sideEffectUncertain = idempotency.some(item => ['uncertain', 'mismatch', 'unknown'].includes(item.status));
  const completed = operation.state === 'completed' && result.ok === true;
  const settled = recovery && ['cancelled', 'already_idle'].includes(recovery.status)
    && error === 'LETTA_TURN_TIMEOUT_REMOTE_SETTLED';
  const externalInFlight = timeout && Number.isInteger(timeout.external_requests)
    && Number.isInteger(timeout.external_completed) && timeout.external_requests !== timeout.external_completed;
  const requiresReconciliation = Boolean(sideEffectUncertain || externalInFlight || (!completed && !settled));
  return applyRemoteSettlement(operation, {
    schema: 1,
    source: 'recorded_execution_evidence',
    remoteState: completed ? 'completed' : settled ? 'settled' : 'uncertain',
    requiresReconciliation,
    automaticRetryAllowed: false,
    reason: externalInFlight ? 'EXTERNAL_TOOL_IN_FLIGHT' : sideEffectUncertain ? 'SIDE_EFFECT_UNCERTAIN'
      : completed ? 'COMPLETED_RESULT' : settled ? 'REMOTE_SETTLED_EFFECTS_NOT_ROLLED_BACK'
        : recovery?.reason ?? (error || 'EXECUTION_EVIDENCE_INCOMPLETE'),
    clientMessageId: recovery?.clientMessageId ?? timeout?.client_message_id ?? `openchatx-${operation.id}`,
    conversationId: recovery?.conversationId ?? operation.sessionId ?? null,
    runId: recovery?.runId ?? result.run_id ?? null,
    externalRequests: Number.isInteger(timeout?.external_requests) ? timeout.external_requests : null,
    externalCompleted: Number.isInteger(timeout?.external_completed) ? timeout.external_completed : null,
    idempotency,
  });
}

export function retainUnresolvedOperation(operation, result, stderr) {
  if (operation.engine !== 'letta') return false;
  // Keep existing unresolved evidence unless an explicit reconciliation path
  // replaces it. A later unrelated successful operation cannot clear it.
  return operation.reconciliation?.requiresReconciliation === true
    || summarizeReconciliation(operation, result, stderr).requiresReconciliation;
}
