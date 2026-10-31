import { createHash, randomUUID } from "node:crypto"
import { promises as fs } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const TOOLBOX_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DEFAULT_LEDGER_DIR = join(TOOLBOX_ROOT, ".external-tool-ledger")
const LEDGER_VERSION = 1

export type ExternalToolResult = {
  content: Array<{ type: "text"; text: string }>
  is_error?: boolean
}

type LedgerRecord = {
  version: number
  state: "running" | "completed" | "uncertain"
  projectId: string
  conversationId: string
  toolCallId: string
  toolName: string
  inputFingerprint: string
  startedAt: string
  updatedAt: string
  result?: ExternalToolResult
  error?: string
}

export type SideEffectExecutionResult = {
  result: ExternalToolResult
  replayed: boolean
  status: "executed" | "replayed" | "uncertain" | "mismatch"
}

const SIDE_EFFECTING_EXTERNAL_TOOLS = new Set([
  "openchatx_write_file",
  "openchatx_shell",
  "openchatx_memory_write",
])

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue)
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    )
  }
  return value
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function inputFingerprint(input: Record<string, unknown>) {
  return sha256(JSON.stringify(stableValue(input)))
}

function recordPath(
  ledgerDir: string,
  projectId: string,
  conversationId: string,
  toolCallId: string,
) {
  const key = sha256(
    JSON.stringify([projectId, conversationId, toolCallId]),
  )
  return join(ledgerDir, `${key}.json`)
}

function errorResult(message: string): ExternalToolResult {
  return {
    is_error: true,
    content: [{ type: "text", text: message }],
  }
}

function validateReplay(
  record: LedgerRecord,
  expected: {
    projectId: string
    conversationId: string
    toolCallId: string
    toolName: string
    inputFingerprint: string
  },
) {
  return (
    record.version === LEDGER_VERSION &&
    record.projectId === expected.projectId &&
    record.conversationId === expected.conversationId &&
    record.toolCallId === expected.toolCallId &&
    record.toolName === expected.toolName &&
    record.inputFingerprint === expected.inputFingerprint
  )
}

export function isSideEffectingExternalTool(toolName: string) {
  return SIDE_EFFECTING_EXTERNAL_TOOLS.has(toolName)
}

async function persistRecord(path: string, record: LedgerRecord) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx", flush: true })
    await fs.rename(temporary, path)
  } finally { await fs.rm(temporary, { force: true }) }
}

export async function readCompletedToolResult(args: {
  projectId: string; conversationId: string; toolCallId: string; toolName: string;
  input: Record<string, unknown>; ledgerDir?: string
}): Promise<ExternalToolResult | null> {
  let record: LedgerRecord
  try {
    record = JSON.parse(await fs.readFile(recordPath(args.ledgerDir ?? DEFAULT_LEDGER_DIR,
      args.projectId, args.conversationId, args.toolCallId), "utf8"))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw new Error("RECOVERY_LEDGER_UNREADABLE")
  }
  if (!validateReplay(record, { ...args, inputFingerprint: inputFingerprint(args.input) }))
    throw new Error("RECOVERY_LEDGER_MISMATCH")
  if (record.state !== "completed" || !record.result)
    throw new Error("RECOVERY_EFFECT_UNCERTAIN: inspect the original side effect before resuming")
  return record.result
}

export async function executeSideEffectOnce(args: {
  projectId: string
  conversationId: string
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  execute: () => Promise<ExternalToolResult>
  ledgerDir?: string
}): Promise<SideEffectExecutionResult> {
  const ledgerDir = args.ledgerDir ?? DEFAULT_LEDGER_DIR
  await fs.mkdir(ledgerDir, { recursive: true })

  const fingerprint = inputFingerprint(args.input)
  const path = recordPath(
    ledgerDir,
    args.projectId,
    args.conversationId,
    args.toolCallId,
  )
  const timestamp = new Date().toISOString()
  const claim: LedgerRecord = {
    version: LEDGER_VERSION,
    state: "running",
    projectId: args.projectId,
    conversationId: args.conversationId,
    toolCallId: args.toolCallId,
    toolName: args.toolName,
    inputFingerprint: fingerprint,
    startedAt: timestamp,
    updatedAt: timestamp,
  }

  try {
    await fs.writeFile(path, `${JSON.stringify(claim, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      flush: true,
    })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "EEXIST") throw error

    let existing: LedgerRecord
    try {
      existing = JSON.parse(await fs.readFile(path, "utf8")) as LedgerRecord
    } catch {
      return {
        result: errorResult(
          "EXTERNAL_TOOL_EXECUTION_UNCERTAIN: idempotency ledger record is unreadable; inspect side effects before retrying",
        ),
        replayed: true,
        status: "uncertain",
      }
    }

    if (
      !validateReplay(existing, {
        projectId: args.projectId,
        conversationId: args.conversationId,
        toolCallId: args.toolCallId,
        toolName: args.toolName,
        inputFingerprint: fingerprint,
      })
    ) {
      return {
        result: errorResult(
          "EXTERNAL_TOOL_REPLAY_MISMATCH: repeated tool call identity has different tool/input metadata",
        ),
        replayed: true,
        status: "mismatch",
      }
    }

    if (existing.state === "completed" && existing.result) {
      return {
        result: existing.result,
        replayed: true,
        status: "replayed",
      }
    }

    return {
      result: errorResult(
        "EXTERNAL_TOOL_EXECUTION_UNCERTAIN: a prior execution claim exists without a completed result; inspect side effects before retrying",
      ),
      replayed: true,
      status: "uncertain",
    }
  }

  try {
    const result = await args.execute()
    const completed: LedgerRecord = {
      ...claim,
      state: "completed",
      updatedAt: new Date().toISOString(),
      result,
    }
    await persistRecord(path, completed)
    return {
      result,
      replayed: false,
      status: "executed",
    }
  } catch (error) {
    const uncertain: LedgerRecord = {
      ...claim,
      state: "uncertain",
      updatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    }
    try {
      await persistRecord(path, uncertain)
    } catch {
      // The original claim remains, which safely blocks automatic re-execution.
    }
    throw error
  }
}
