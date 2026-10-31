// Operation progress is not product acceptance or permission to publish.
export const RUNTIME_POLICY_VERSION = "2026-10-28.3"
export const RUNTIME_POLICY_DOCUMENT = "rules/shared-development-preflight.mdc"

// Report only known model metadata. Never copy the agent record, endpoints,
// credentials, memory or arbitrary provider configuration into public results.
export function describeModelConfiguration(agent: any, observedAt = new Date().toISOString(), source = "letta.agent_retrieve") {
  const config = agent?.llm_config
  const safeModel = (value: unknown) => typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value) ? value : null
  const effectiveModel = safeModel(agent?.model) ?? safeModel(config?.model)
  const modernReasoning = agent?.model_settings?.reasoning
  const reasoningConfig = modernReasoning && Object.hasOwn(modernReasoning, "reasoning_effort")
    ? modernReasoning : config
  const effort = reasoningConfig?.reasoning_effort
  const reasoningEffort = typeof effort === "string" &&
    ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(effort)
    ? effort : null
  return {
    version: 1,
    effectiveModel,
    reasoningEffort,
    reasoningState: reasoningEffort ? "observed"
      : reasoningConfig && Object.hasOwn(reasoningConfig, "reasoning_effort") && effort === null
        ? "provider_default" : "unavailable",
    reasoningSource: reasoningConfig && Object.hasOwn(reasoningConfig, "reasoning_effort")
      ? reasoningConfig === modernReasoning ? "model_settings.reasoning" : "llm_config" : null,
    contextWindow: Number.isSafeInteger(config?.context_window) && config.context_window > 0
      ? config.context_window : null,
    source,
    observedAt,
    scope: "before_turn",
  }
}

export function publicModelConfiguration(value: any) {
  if (value?.version !== 1 || !["letta.agent_retrieve", "letta.conversation_retrieve"].includes(value.source) ||
      value.scope !== "before_turn" || typeof value.observedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.observedAt)) return null
  return describeModelConfiguration({
    model: value.effectiveModel,
    ...(value.reasoningSource === "model_settings.reasoning" ? { model_settings: { reasoning: {
      reasoning_effort: value.reasoningState === "provider_default" ? null : value.reasoningEffort ?? undefined,
    } } } : {}),
    llm_config: {
      ...(value.reasoningSource === "llm_config" ? { reasoning_effort:
        value.reasoningState === "provider_default" ? null : value.reasoningEffort ?? undefined } : {}),
      context_window: value.contextWindow,
    },
  }, value.observedAt, value.source)
}

export function publicTokenUsage(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const usage: Record<string, number> = {}
  for (const key of ["prompt_tokens", "completion_tokens", "total_tokens", "step_count",
    "input_tokens", "output_tokens", "cached_input_tokens", "reasoning_tokens"]) {
    if (Number.isSafeInteger(value[key]) && value[key] >= 0) usage[key] = value[key]
  }
  return Object.keys(usage).length ? usage : null
}

export function assertLettaModelSelection(model?: string) {
  if (model?.trim() && model.trim() !== "letta/agent-config") {
    throw new Error("LETTA_MODEL_SELECTION_UNSUPPORTED: the model parameter cannot change an existing Letta Agent; inspect its effective configuration instead")
  }
}

export function normalizeTaskRef(value?: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "string" || !value.trim() || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("TASK_REFERENCE_INVALID")
  }
  // An identifier only: never read a path or grant access from this value.
  return value.trim()
}

export function runtimePolicy() {
  return {
    version: RUNTIME_POLICY_VERSION,
    document: RUNTIME_POLICY_DOCUMENT,
    automaticDevelopmentReceipts: false,
    independentReview: "explicit_opt_in_only",
    releaseAuthorized: false,
  }
}

export function describeOperationOutcome(input: {
  state: string,
  taskRef?: unknown,
  blockers?: unknown,
  idempotency?: unknown,
  stalePoll?: boolean,
  reconciliation?: { remoteState?: string, requiresReconciliation?: boolean },
}) {
  const taskRef = normalizeTaskRef(input.taskRef)
  const blockers = Array.isArray(input.blockers) ? input.blockers : []
  const uncertain = Array.isArray(input.idempotency) && input.idempotency.some(
    (item) => item?.status === "uncertain" || item?.status === "mismatch",
  )
  const action = input.stalePoll ? "inspect_current_operation"
    : input.state === "running" ? "poll_existing_operation"
    : !uncertain && input.reconciliation?.remoteState === "settled" &&
      input.reconciliation.requiresReconciliation === false &&
      (input.state === "failed" || input.state === "cancelled") ? "inspect_failure_before_retry"
    : uncertain || input.state === "failed" || input.state === "cancelled" ? "reconcile_before_retry"
    : blockers.length ? "resolve_affected_operation"
    : "check_existing_task_acceptance"
  return {
    runtimePolicy: runtimePolicy(),
    execution: { state: input.state, scope: "operation" },
    delivery: { state: "not_evaluated", taskRef, acceptanceVerified: false },
    next_move: { action, taskRef, automaticRetryAllowed: false },
  }
}

export function normalizeContextPaths(value: unknown = undefined): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 16) throw new Error("CONTEXT_PATHS_INVALID")
  const paths: string[] = []
  for (const item of value) {
    if (typeof item !== "string" || !item.trim() || item.length > 512 ||
        /[\x00-\x1f\x7f:*?<>|\"]/.test(item)) throw new Error("CONTEXT_PATH_INVALID")
    const path = item.replaceAll("\\", "/")
    const parts = path.split("/")
    if (path.startsWith("/") || parts.some(part => !part || part === ".." || /[. ]$/.test(part) && part !== "."))
      throw new Error("CONTEXT_PATH_INVALID")
    const normalized = parts.filter(part => part !== ".").join("/")
    if (!normalized) throw new Error("CONTEXT_PATH_INVALID")
    if (!paths.some(path => path.toLowerCase() === normalized.toLowerCase())) paths.push(normalized)
  }
  return paths
}

export async function prepareWorkerRunContext(
  project: unknown,
  prompt: string,
  inspect: (project: any, prompt: string, paths?: string[]) => Promise<any>,
  taskRef?: unknown,
  contextPaths?: unknown,
) {
  const reference = normalizeTaskRef(taskRef)
  const paths = normalizeContextPaths(contextPaths)
  // Keep the existing project, task-size and applicable skill checks. Do not
  // catch permission failures, create receipts or dispatch optional reviewers.
  const context = await inspect(project, prompt.trim(), paths)
  return {
    ...context,
    contextPaths: paths,
    prompt: context.prompt + "\n\n[Current runtime policy " + RUNTIME_POLICY_VERSION + "]\n" +
      "Continue the existing authorized work item and its acceptance criteria. " +
      "Operation completion does not mean delivery acceptance. " +
      "Report the concrete remaining action and evidence in the existing task record. " +
      "No routine QA receipt or independent reviewer is required. " +
      "Project permissions, current safety denials, CI and release approvals remain in force. " +
      "Historical notes do not create new authorization or permanent blockers." +
      " On resumed or compacted work, reread the existing task record and relevant current source. " +
      "Keep approved constraints, verified progress, real test evidence, unresolved issues and the next action in the existing TODO when writing it is authorized; do not create a second task ledger." +
      (reference ? "\nExisting task reference (identifier only): " + JSON.stringify(reference) : ""),
  }
}
