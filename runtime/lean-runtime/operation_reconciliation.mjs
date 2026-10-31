// A stale local-backend conflict is only a candidate. The Worker must also
// prove the latest remote user message still belongs to this read-only turn.
export function describeReadOnlyBackendConflict(current, error, previous, previousError, stderr) {
  if(current.state!=='failed' || previous.state!=='failed' || current.projectId!==previous.projectId
      || current.sessionName!==previous.sessionName || !current.sessionId || current.sessionId!==previous.sessionId
      || previousError!=='LETTA_TURN_TIMEOUT_REMOTE_UNCERTAIN'
      || !(Date.parse(current.createdAt)>=Date.parse(previous.createdAt))) return null;
  const match=/^LETTA_TURN_FAILED: Conversation (local-conv-\d+) already has an active run \((local-run-\d+)\)$/.exec(error);
  if(!match || match[1]!==current.sessionId) return null;
  const summary=summarizeReconciliation({...previous,remoteSettlement:undefined},{error:previousError},stderr);
  if(summary.clientMessageId!==`openchatx-${previous.id}` || summary.externalRequests!==0
      || summary.externalCompleted!==0 || summary.externalExecution?.integrity==='invalid') return null;
  return {conversationId:match[1],runId:match[2],ownerOperationId:previous.id,clientMessageId:summary.clientMessageId};
}

export function verifyReadOnlyOrphanTail(messages, scope) {
  if(!Array.isArray(messages) || !messages.length || messages.length>20) return false;
  const userIndex=messages.findIndex(message=>message?.message_type==='user_message');
  if(userIndex<0) return false;
  const tail=messages.slice(0,userIndex+1);
  return tail.every(message=>message.agent_id===scope.agentId && message.conversation_id===scope.conversationId)
    && tail[userIndex].otid===scope.clientMessageId
    && tail.slice(0,-1).every(message=>['assistant_message','reasoning_message'].includes(message.message_type)
      && !message.tool_call && !message.tool_calls?.length);
}

// Read only bounded, content-free events emitted by this Operation's Worker.
// A missing start/end, truncated log, duplicate sequence or overflow stays unknown.
function inspectExternalExecution(events, timeout) {
  if (timeout?.external_execution_schema !== 1) return null;
  const started = new Map(); let invalid = false, deliveryFailures = 0;
  for (const event of events) {
    if (!Number.isSafeInteger(event.sequence) || event.sequence < 1 || event.sequence > 256) {invalid=true;continue;}
    if (event.phase === 'started') {
      if (started.has(event.sequence) || typeof event.sideEffecting !== 'boolean') {invalid=true;continue;}
      started.set(event.sequence,{sideEffecting:event.sideEffecting,completed:false,uncertain:false,deliveryFailed:false});
      continue;
    }
    const record=started.get(event.sequence);
    if (!record) {invalid=true;continue;}
    if (event.phase === 'completed') {
      if (record.completed || !['succeeded','failed','unknown'].includes(event.outcome)) {invalid=true;continue;}
      record.completed=true;
      record.uncertain=record.sideEffecting
        ? !['executed','replayed'].includes(event.idempotencyStatus) || event.outcome==='unknown'
        : event.idempotencyStatus!=='not_applicable';
    } else if (event.phase==='response_delivery_failed' && record.completed && !record.deliveryFailed) {
      record.deliveryFailed=true;deliveryFailures++;
    } else invalid=true;
  }
  const completed=[...started.values()].filter(item=>item.completed).length;
  const uncertain=[...started.values()].filter(item=>item.uncertain).length;
  if (!Number.isSafeInteger(timeout.external_requests) || !Number.isSafeInteger(timeout.external_completed)
      || timeout.external_requests < 0 || timeout.external_completed < 0
      || started.size !== timeout.external_requests || completed < timeout.external_completed) invalid=true;
  return {schema:1,source:'worker_lifecycle_events',integrity:invalid?'invalid':'verified',
    started:started.size,completed,pending:started.size-completed,uncertain,deliveryFailures};
}

function inspectEffectEvidence(summary) {
  const countsKnown = summary.externalExecution?.integrity !== 'invalid' && [summary.externalRequests, summary.externalCompleted]
    .every(value => Number.isSafeInteger(value) && value >= 0);
  const inFlight = countsKnown && summary.externalRequests !== summary.externalCompleted;
  const uncertainEffects = summary.externalExecution?.uncertain > 0 || !Array.isArray(summary.idempotency)
    || summary.idempotency.some(item => !['executed', 'replayed'].includes(item.status));
  return {countsKnown,inFlight,uncertainEffects};
}

// Polling is observation, not permission to repeat an uncertain effect under
// a new tool-call identity. Scope this check to the actual conversation; other
// independent conversations remain usable. Zero-call timeouts retain the
// existing remote-state/orphan-recovery path and are not fabricated as settled.
export function assertNoUnresolvedToolEffects(operations, projectId, sessionName, sessionId) {
  for (const operation of operations) {
    if (operation.engine !== 'letta' || operation.projectId !== projectId) continue;
    const sameConversation = sessionId && operation.sessionId
      ? sessionId === operation.sessionId : operation.sessionName === sessionName;
    if (!sameConversation || operation.reconciliation?.requiresReconciliation !== true) continue;
    const effects = inspectEffectEvidence(operation.reconciliation);
    if (!effects.countsKnown || effects.inFlight || effects.uncertainEffects)
      throw Error(`OPERATION_EFFECTS_UNRESOLVED: ${operation.id}; inspect and reconcile the original operation before continuing this conversation`);
  }
}

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
  const {countsKnown,inFlight,uncertainEffects} = inspectEffectEvidence(summary);
  const backendConfirmed=receipt.status==='cancelled';
  return { ...summary, remoteState: backendConfirmed ? 'settled' : 'uncertain',
    requiresReconciliation: !backendConfirmed || !countsKnown || inFlight || uncertainEffects,
    automaticRetryAllowed: false,
    reason: !backendConfirmed ? 'REMOTE_BACKEND_IDLE_UNVERIFIED' : !countsKnown ? 'EXECUTION_EVIDENCE_INCOMPLETE' : inFlight ? 'EXTERNAL_TOOL_IN_FLIGHT'
      : uncertainEffects ? 'SIDE_EFFECT_UNCERTAIN' : 'REMOTE_SETTLED_EFFECTS_NOT_ROLLED_BACK',
    settlement: receipt };
}

// Summarize existing execution evidence. This does not contact Letta, retry a
// tool, declare side effects absent, or authorize removal of replay records.
export function summarizeReconciliation(operation, result = {}, stderr = '') {
  let timeout = null, recovery = null;
  const events=[];
  for (const line of String(stderr).split(/\r?\n/)) {
    if (!line.startsWith('{')) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.kind === 'LETTA_TURN_TIMEOUT_DIAGNOSTIC') timeout = entry;
      if (entry.kind === 'LETTA_TIMEOUT_RECOVERY') recovery = entry;
      if (entry.kind === 'EXTERNAL_TOOL_EXECUTION') {
        // 256 calls x start/complete/delivery failure. Overflow is invalid.
        if(events.length<769) events.push(entry);
      }
    } catch { /* Non-JSON stderr is not recovery evidence. */ }
  }
  const error = typeof result.error === 'string' ? result.error : '';
  const conflict=/^LETTA_TURN_FAILED: Conversation (local-conv-\d+) already has an active run \((local-run-\d+)\)$/.exec(error);
  const rejectedBeforeExecution=conflict?.[1]===operation.sessionId
    && operation.remoteSettlement?.status==='cancelled'
    && operation.remoteSettlement?.runId===conflict?.[2]
    && operation.remoteSettlement?.ownerClientMessageId===`openchatx-${operation.remoteSettlement?.ownerOperationId}`
    && typeof operation.remoteSettlement?.ownerOperationId==='string';
  const idempotency = (Array.isArray(result.validation?.idempotency)
    ? result.validation.idempotency : Array.isArray(timeout?.idempotency) ? timeout.idempotency : [])
    .map(item => ({ tool: String(item?.tool ?? 'unknown'),
      toolCallId: typeof item?.tool_call_id === 'string' ? item.tool_call_id : null,
      status: String(item?.status ?? 'unknown') }));
  const externalExecution=inspectExternalExecution(events,timeout);
  const evidenceInvalid=externalExecution?.integrity==='invalid';
  const externalCompleted=rejectedBeforeExecution ? 0 : externalExecution?.integrity==='verified'
    ? externalExecution.completed : Number.isInteger(timeout?.external_completed) ? timeout.external_completed : null;
  const sideEffectUncertain = externalExecution?.uncertain > 0 || idempotency.some(item => ['uncertain', 'mismatch', 'unknown'].includes(item.status));
  const completed = operation.state === 'completed' && result.ok === true;
  const settled = recovery?.status === 'cancelled'
    && error === 'LETTA_TURN_TIMEOUT_REMOTE_SETTLED';
  const externalInFlight = timeout && Number.isInteger(timeout.external_requests)
    && Number.isInteger(externalCompleted) && timeout.external_requests !== externalCompleted;
  const requiresReconciliation = Boolean(evidenceInvalid || sideEffectUncertain || externalInFlight || (!completed && !settled));
  return applyRemoteSettlement(operation, {
    schema: 1,
    source: 'recorded_execution_evidence',
    remoteState: completed ? 'completed' : settled ? 'settled' : 'uncertain',
    requiresReconciliation,
    automaticRetryAllowed: false,
    reason: evidenceInvalid ? 'EXECUTION_EVIDENCE_INCOMPLETE' : externalInFlight ? 'EXTERNAL_TOOL_IN_FLIGHT' : sideEffectUncertain ? 'SIDE_EFFECT_UNCERTAIN'
      : completed ? 'COMPLETED_RESULT' : settled ? 'REMOTE_SETTLED_EFFECTS_NOT_ROLLED_BACK'
        : recovery?.reason ?? (error || 'EXECUTION_EVIDENCE_INCOMPLETE'),
    clientMessageId: recovery?.clientMessageId ?? timeout?.client_message_id ?? `openchatx-${operation.id}`,
    conversationId: recovery?.conversationId ?? operation.sessionId ?? null,
    runId: recovery?.runId ?? result.run_id ?? null,
    externalRequests: rejectedBeforeExecution ? 0 : Number.isInteger(timeout?.external_requests) ? timeout.external_requests : null,
    rejectedBeforeExecution: Boolean(rejectedBeforeExecution),
    externalCompleted,
    externalCompletedAtTimeout: Number.isInteger(timeout?.external_completed) ? timeout.external_completed : null,
    externalExecution,
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
