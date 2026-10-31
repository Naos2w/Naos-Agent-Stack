import { defineTool, z } from "openchatx-mcp/toolbox"
const executorUrl = new URL("./project_executor.ts", import.meta.url)
executorUrl.searchParams.set("source_mtime", String((await stat(fileURLToPath(executorUrl))).mtimeMs))
const { getProject } = await import(executorUrl.href)
import { stat } from "node:fs/promises"
import { fileURLToPath } from "node:url"
// A loaded tool can outlive a Runtime update. The gate captures both policies
// at initialization, so refresh its dependency key on each call, not only when
// this entrypoint is first loaded. Unchanged versions retain Node's module cache.
async function loadDevelopmentGate() {
  const gateUrl = new URL("./development_gate.ts", import.meta.url)
  const dependencies = [
    ["source_mtime", "development_gate.ts"],
    ["review_policy_mtime", "review_policy.ts"],
    ["capabilities_mtime", "agent_capabilities.ts"],
  ]
  const versions = await Promise.all(dependencies.map(async ([key, file]) =>
    [key, String((await stat(fileURLToPath(new URL(file, import.meta.url)))).mtimeMs)]))
  for (const [key, value] of versions) gateUrl.searchParams.set(key, value)
  return import(gateUrl.href)
}

// Only reads project code-index status, installed Skill documents or an existing
// receipt. This tool never creates/updates an audit receipt.
export default defineTool({
  name: "development_preflight",
  description:
    "Read-only project-scoped development preflight. For action=prepare, inspect the " +
    "codebase-memory index, classify the intended source paths and load applicable " +
    "installed UI/UX Skills. Does NOT create a receipt or modify files. " +
    "For audit creation or verification use the separately authorized development_receipt tool; " +
    "do not treat this preflight as platform approval.",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: z.object({
    action: z.enum(["prepare", "inspect"]).default("prepare"),
    project_id: z.string().min(1),
    task: z.string().min(1).max(12000).optional(),
    paths: z.array(z.string().min(1)).max(40).default([]),
    receipt_id: z.string().optional(),
  }),
  async execute({ action, project_id, task, paths, receipt_id }) {
    const project = await getProject(project_id)
    const { inspectDevelopmentContext, inspectDevelopmentGate } = await loadDevelopmentGate()
    if (action === "prepare") {
      if (!task?.trim()) throw new Error("DEVELOPMENT_GATE_TASK_REQUIRED")
      const context = await inspectDevelopmentContext(project, task.trim(), paths)
      const guidance = context.prompt.slice(task.trim().length).slice(0, 17000)
      return {
        content: [{ type: "text", text: JSON.stringify({
          ok: true,
          action: "prepare",
          effects: "read_only",
          receipt_id: null,
          project_id: context.projectId,
          classification: context.classification,
          risk: context.risk,
          evidence: context.evidence,
          guidance,
          note: "Preflight read-only check completed; no audit receipt was created. " +
            "Only use the explicitly mutating development_receipt tool if allowed by the platform and Project. " +
            "Do not retry a platform-rejected call through another route.",
        }, null, 2) }],
      }
    }
    if (!receipt_id) throw new Error("DEVELOPMENT_GATE_RECEIPT_REQUIRED")
    const receipt = await inspectDevelopmentGate(project, receipt_id)
    return {
      content: [{ type: "text", text: JSON.stringify({
        ok: true,
        action: "inspect",
        effects: "read_only",
        receipt_id,
        project_id: receipt.projectId,
        created_at: receipt.createdAt,
        classification: receipt.classification,
        risk: receipt.risk,
        codebase: receipt.codebase,
        design: receipt.design,
        acceptance: receipt.acceptance ?? null,
      }, null, 2) }],
    }
  },
})
