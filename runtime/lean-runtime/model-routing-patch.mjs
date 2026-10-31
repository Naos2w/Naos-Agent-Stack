function once(text, before, after) {
  if (text.split(before).length !== 2) throw Error('Model routing anchor missing or ambiguous: ' + before.slice(0, 90));
  return text.replace(before, after);
}
export function patchRoutingWorker(text) {
  if (text.includes('const selectedModel = await applyConversationModelSelection')) return text;
  text = once(text, 'const SERVER_URL =',
    'import { planModelSelection, applyConversationModelSelection } from "./model_routing.mjs"\n' +
    'import { assertRemoteStateIdle } from "./operation_invariants.ts"\n\nconst SERVER_URL =');
  text = once(text, '  taskRef?: string | null\n  runId?: string',
    '  taskRef?: string | null\n  modelSelection?: Record<string, unknown>\n  runId?: string');
  text = once(text, '  requestMessageId?: string,\n) {',
    '  requestMessageId?: string,\n  modelSelection = planModelSelection({ model: "letta/agent-config" }),\n) {');
  text = once(text, '    if (!runtime) throw new Error("LETTA_RUNTIME_SCOPE_MISSING")\n    const clientMessageId',
    '    if (!runtime) throw new Error("LETTA_RUNTIME_SCOPE_MISSING")\n' +
    '    const selectedModel = await applyConversationModelSelection(client, runtime, modelSelection, async () => {\n' +
    '      const remote = await workerInspect({ action: "inspect", agentId: binding.agentId, conversationId: conversation.conversationId })\n' +
    '      assertRemoteStateIdle(remote)\n' +
    '    })\n    const clientMessageId');
  text = once(text, '      usage: finished.usage ?? null,', '      usage: finished.usage ?? null,\n      ...selectedModel,');
  text = once(text, '    input.clientMessageId,\n  )',
    '    input.clientMessageId,\n    input.modelSelection ?? planModelSelection(),\n  )');
  text = once(text, '    modelConfiguration,\n    usage: publicTokenUsage(result.usage),',
    '    modelConfiguration: result.modelConfiguration,\n    modelSelection: result.modelSelection,\n    usage: publicTokenUsage(result.usage),');
  // Keep the pre-existing observation call for Agent identity validation; the
  // returned public observation now comes from the effective conversation.
  return text;
}
export function patchRoutingRuntime(text) {
  if (text.includes('const modelSelection = planModelSelection({')) return text;
  text = once(text, 'const qaArchiveUrl =',
    'const routingUrl = new URL("./model_routing.mjs", import.meta.url)\n' +
    'routingUrl.searchParams.set("source_mtime", String((await fs.stat(fileURLToPath(routingUrl))).mtimeMs))\n' +
    'const { planModelSelection, publicModelSelection } = await import(routingUrl.href)\n\nconst qaArchiveUrl =');
  text = once(text, '  inputPath?: string\n  taskRef?: string | null\n', '  inputPath?: string\n  taskRef?: string | null\n  modelSelection?: Record<string, unknown>\n');
  text = once(text, '  modelConfiguration?: Record<string, unknown> | null\n}',
    '  modelConfiguration?: Record<string, unknown> | null\n  modelSelection?: Record<string, unknown> | null\n}');
  text = once(text, '  taskRef?: string | null\n}) {\n  const { project, projectState, session, prompt, config, timeoutMs, taskRef } = args',
    '  taskRef?: string | null\n  modelSelection?: Record<string, unknown>\n}) {\n  const { project, projectState, session, prompt, config, timeoutMs, taskRef, modelSelection } = args');
  text = once(text, '      clientMessageId: `openchatx-${operationId}`,\n      taskRef,',
    '      clientMessageId: `openchatx-${operationId}`,\n      modelSelection,\n      taskRef,');
  text = once(text, '      inputPath,\n      taskRef: taskRef ?? null,', '      inputPath,\n      modelSelection,\n      taskRef: taskRef ?? null,');
  text = once(text, '      state: "running" as const,\n      ...describeOperationOutcome',
    '      state: "running" as const,\n      modelSelection: publicModelSelection(operation.modelSelection),\n      ...describeOperationOutcome');
  text = once(text, '        latestSession.modelConfiguration = publicModelConfiguration(parsed.modelConfiguration)',
    '        latestSession.modelConfiguration = publicModelConfiguration(parsed.modelConfiguration)\n' +
    '        latestSession.modelSelection = publicModelSelection(parsed.modelSelection ?? operation.modelSelection)');
  text = once(text, '      modelConfiguration: publicModelConfiguration(parsed.modelConfiguration),',
    '      modelConfiguration: publicModelConfiguration(parsed.modelConfiguration),\n' +
    '      modelSelection: publicModelSelection(parsed.modelSelection ?? operation.modelSelection),');
  text = once(text, '    modelConfiguration: publicModelConfiguration(session.modelConfiguration),',
    '    modelConfiguration: publicModelConfiguration(session.modelConfiguration),\n' +
    '    modelSelection: publicModelSelection(session.modelSelection),');
  text = once(text, '    model: z.string().optional().describe("Legacy compatibility only. Letta uses its Agent configuration; a different value is rejected."),',
    '    model: z.string().optional().describe("run only: explicit user-selected openai-codex handle or gpt-* alias; auto/omitted routes by task_complexity. letta/agent-config preserves the current conversation."),\n' +
    '    reasoning_effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional().describe("run only: honor an explicit user reasoning preference; otherwise use the task profile."),\n' +
    '    task_complexity: z.enum(["simple", "standard", "complex"]).optional().describe("run only: classify the current authorized task. simple=small well-defined edit/summary; standard=normal development; complex=ambiguous architecture or difficult root-cause work. Omission conservatively uses standard. User model selection takes priority."),');
  text = once(text, '    task_ref,\n    engine,', '    task_ref,\n    reasoning_effort,\n    task_complexity,\n    engine,');
  text = once(text, '    if (["session_new", "run", "compact"].includes(action)) assertLettaModelSelection(model)',
    '    if (action !== "run" && (reasoning_effort !== undefined || task_complexity !== undefined)) throw new Error("MODEL_SELECTION_RUN_ONLY")\n' +
    '    if (["session_new", "compact"].includes(action)) assertLettaModelSelection(model)');
  text = once(text, '      const taskRef = normalizeTaskRef(task_ref)',
    '      const taskRef = normalizeTaskRef(task_ref)\n' +
    '      const modelSelection = planModelSelection({ model, reasoningEffort: reasoning_effort, taskComplexity: task_complexity })');
  const runStart = text.indexOf('    if (action === "run") {');
  if (runStart < 0) throw Error('Missing run action');
  let run = text.slice(runStart);
  run = once(run, '        engine,\n        model,\n        config,', '        engine,\n        DEFAULT_LETTA_MODEL,\n        config,');
  run = once(run, '              taskRef,\n            })', '              taskRef,\n              modelSelection,\n            })');
  run = once(run, '        model: chosenModel,\n        state: operation.state,',
    '        model: chosenModel,\n        modelSelection: publicModelSelection(operation.modelSelection),\n        state: operation.state,');
  return text.slice(0, runStart) + run;
}
const guidance = `
## Task-based model selection — version 1

- When delegating a run, honor the user's current explicit model and reasoning choice first via model and reasoning_effort. Do not overwrite that choice with a task profile.
- Otherwise the supervising conversation classifies the approved task with task_complexity: simple for bounded, unambiguous edits or checks; standard for normal development; complex for ambiguous root causes or substantial design reasoning. Choose standard when uncertain. Classification is part of normal supervision, not another Agent or model call.
- Automatic profiles: simple = openai-codex/gpt-6-luna / medium; standard = openai-codex/gpt-6.1-sol / high; complex = openai-codex/gpt-6-astra / high. Omitted classification uses standard. model=auto enables the same policy; explicit reasoning_effort still wins.
- Reuse the same project Agent and named conversation. Selection applies at the next idle run boundary only to that conversation. Do not change Agent defaults or another session, spawn extra reviewers, or switch providers.
- model=letta/agent-config preserves the conversation's current effective setting for compatibility; do not combine it with task_complexity or reasoning_effort. Selection fields apply only to run.
- Distinguish planned modelSelection from applied selection and the observed modelConfiguration. Report the selection reason and actual observed setting; unknown usage is not zero.
- If catalog availability, idle state, update scope or readback cannot be verified, stop that operation and retain its error and operation ID. Never silently fall back to another model, replay work after a failure, or treat routing as permission to bypass a denial.
`;

export function patchRoutingGuidance(text) {
  return text.includes('## Task-based model selection — version 1') ? text : text.trimEnd() + '\n' + guidance;
}
