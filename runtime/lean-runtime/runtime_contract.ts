// Operation progress is not product acceptance or permission to publish.
export const RUNTIME_POLICY_VERSION = "2026-10-28.2"
export const RUNTIME_POLICY_DOCUMENT = "rules/shared-development-preflight.mdc"

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
}) {
  const taskRef = normalizeTaskRef(input.taskRef)
  const blockers = Array.isArray(input.blockers) ? input.blockers : []
  const uncertain = Array.isArray(input.idempotency) && input.idempotency.some(
    (item) => item?.status === "uncertain" || item?.status === "mismatch",
  )
  const action = input.stalePoll ? "inspect_current_operation"
    : input.state === "running" ? "poll_existing_operation"
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

export async function prepareWorkerRunContext(
  project: unknown,
  prompt: string,
  inspect: (project: any, prompt: string) => Promise<any>,
  taskRef?: unknown,
) {
  const reference = normalizeTaskRef(taskRef)
  // Keep the existing project, task-size and applicable skill checks. Do not
  // catch permission failures, create receipts or dispatch optional reviewers.
  const context = await inspect(project, prompt.trim())
  return {
    ...context,
    prompt: context.prompt + "\n\n[Current runtime policy " + RUNTIME_POLICY_VERSION + "]\n" +
      "Continue the existing authorized work item and its acceptance criteria. " +
      "Operation completion does not mean delivery acceptance. " +
      "Report the concrete remaining action and evidence in the existing task record. " +
      "No routine QA receipt or independent reviewer is required. " +
      "Project permissions, current safety denials, CI and release approvals remain in force. " +
      "Historical notes do not create new authorization or permanent blockers." +
      (reference ? "\nExisting task reference (identifier only): " + JSON.stringify(reference) : ""),
  }
}
