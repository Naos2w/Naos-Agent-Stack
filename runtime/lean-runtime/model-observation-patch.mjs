function once(text, from, to) {
  if (text.split(from).length !== 2) throw Error('Model observation anchor missing or ambiguous: ' + from.slice(0, 90));
  return text.replace(from, to);
}

export function patchModelWorker(text) {
  if (text.includes('const { agentId, modelConfiguration } = await ensureWorkerAgent')) return text;
  text = once(text,
    'import { describeOperationOutcome, prepareWorkerRunContext } from "./runtime_contract.ts"',
    'import { describeOperationOutcome, prepareWorkerRunContext, describeModelConfiguration, publicTokenUsage } from "./runtime_contract.ts"');
  text = once(text, '      return agentId\n    }\n\n    const response = await client.request(',
    '      return { agentId, modelConfiguration: describeModelConfiguration(response.agent) }\n    }\n\n    const response = await client.request(');
  text = once(text, '    await configureNewAgentModel(response.agent_id)\n    return response.agent_id',
    '    await configureNewAgentModel(response.agent_id)\n' +
    '    const observed = await client.request({\n' +
    '      type: "agent_retrieve", request_id: client.nextRequestId("agent-model"),\n' +
    '      agent_id: response.agent_id,\n' +
    '    }, "agent_retrieve_response")\n' +
    '    requireSuccess(observed, "LETTA_AGENT_RETRIEVE_FAILED")\n' +
    '    if (!observed.agent) throw new Error("LETTA_AGENT_NOT_FOUND")\n' +
    '    return { agentId: response.agent_id, modelConfiguration: describeModelConfiguration(observed.agent) }');
  text = once(text, '  const agentId = await ensureWorkerAgent(project, input.agentId)',
    '  const { agentId, modelConfiguration } = await ensureWorkerAgent(project, input.agentId)');
  return once(text, '    usage: result.usage,',
    '    modelConfiguration,\n    usage: publicTokenUsage(result.usage),');
}

export function patchModelRuntime(text) {
  if (text.includes('latestSession.modelConfiguration = publicModelConfiguration')) return text;
  text = once(text, 'const { describeOperationOutcome, normalizeTaskRef } = await import(runtimeContractUrl.href)',
    'const { describeOperationOutcome, normalizeTaskRef, publicModelConfiguration, publicTokenUsage, assertLettaModelSelection } = await import(runtimeContractUrl.href)');
  text = once(text, '  lastCompactionAfter?: number | null\n}',
    '  lastCompactionAfter?: number | null\n  modelConfiguration?: Record<string, unknown> | null\n}');
  text = once(text, '        latestSession.model = operation.model || DEFAULT_LETTA_MODEL',
    '        latestSession.model = operation.model || DEFAULT_LETTA_MODEL\n' +
    '        latestSession.modelConfiguration = publicModelConfiguration(parsed.modelConfiguration)');
  text = once(text, '      reconciliation: operation.reconciliation,\n      assistantText:',
    '      reconciliation: operation.reconciliation,\n' +
    '      modelConfiguration: publicModelConfiguration(parsed.modelConfiguration),\n' +
    '      usage: publicTokenUsage(parsed.usage),\n      assistantText:');
  text = once(text, '    model: session.model,\n    archived: session.archived,',
    '    model: session.model,\n' +
    '    modelConfiguration: publicModelConfiguration(session.modelConfiguration),\n    archived: session.archived,');
  text = once(text, '    model: z.string().optional(),',
    '    model: z.string().optional().describe("Legacy compatibility only. Letta uses its Agent configuration; a different value is rejected."),');
  text = once(text, '    if (action === "session_new") {',
    '    if (["session_new", "run", "compact"].includes(action)) assertLettaModelSelection(model)\n\n    if (action === "session_new") {');
  return text;
}
