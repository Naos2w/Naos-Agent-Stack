import { defineTool, z } from "openchatx-mcp/toolbox"
import { execFile, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { closeSync, createWriteStream, openSync, promises as fs } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
// Dynamic import follows the toolbox loader's supported Windows ESM path.
const operationGuardsUrl = new URL("./operation_invariants.ts", import.meta.url)
operationGuardsUrl.searchParams.set(
  "source_mtime", String((await fs.stat(fileURLToPath(operationGuardsUrl))).mtimeMs),
)
const {
  assertOperationDispatchReady,
  assertRemoteStateIdle,
  collectUnpolledOperationIds,
  findRecoverableBackendRun,
  isCurrentSessionOperation,
  withOperationRegistryLock,
} = await import(operationGuardsUrl.href)
const runtimeContractUrl = new URL("./runtime_contract.ts", import.meta.url)
runtimeContractUrl.searchParams.set("source_mtime", String((await fs.stat(fileURLToPath(runtimeContractUrl))).mtimeMs))
const { describeOperationOutcome, normalizeTaskRef, publicModelConfiguration, publicTokenUsage, assertLettaModelSelection, normalizeContextPaths } = await import(runtimeContractUrl.href)

const routingUrl = new URL("./model_routing.mjs", import.meta.url)
routingUrl.searchParams.set("source_mtime", String((await fs.stat(fileURLToPath(routingUrl))).mtimeMs))
const { planModelSelection, publicModelSelection } = await import(routingUrl.href)

const qaArchiveUrl = new URL("./qa_operation_archive.ts", import.meta.url)
qaArchiveUrl.searchParams.set("source_mtime", String((await fs.stat(fileURLToPath(qaArchiveUrl))).mtimeMs))
const { archiveQaOperation } = await import(qaArchiveUrl.href)

const maintenanceUrl = new URL("./runtime_maintenance.mjs", import.meta.url)
maintenanceUrl.searchParams.set("source_mtime", String((await fs.stat(fileURLToPath(maintenanceUrl))).mtimeMs))
const { withRuntimeActivity } = await import(maintenanceUrl.href)

const reconciliationUrl = new URL("./operation_reconciliation.mjs", import.meta.url)
reconciliationUrl.searchParams.set("source_mtime", String((await fs.stat(fileURLToPath(reconciliationUrl))).mtimeMs))
const { summarizeReconciliation, retainUnresolvedOperation, applyRemoteSettlement } = await import(reconciliationUrl.href)

const execFileAsync = promisify(execFile)

const TOOLBOX_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OPENCHATX_RUNTIME_ROOT = dirname(dirname(process.execPath))
const STATE_PATH = join(TOOLBOX_ROOT, "state.json")
const OPERATIONS_PATH = join(TOOLBOX_ROOT, "operations.json")
const CONFIG_PATH = join(TOOLBOX_ROOT, "config.json")
const OPS_DIR = join(TOOLBOX_ROOT, ".ops")
const PROJECTS_PATH = join(homedir(), ".openchatx-mcp", "projects.json")
const POC_BINDINGS_PATH = join(
  dirname(TOOLBOX_ROOT),
  "opencode-runtime-poc",
  "bindings.json",
)
const LETTA_POC_STATE_PATH = join(
  dirname(TOOLBOX_ROOT),
  "letta-runtime",
  "state.json",
)
const LETTA_WORKER_PATH = join(TOOLBOX_ROOT, "tools", "letta_worker.ts")
const LETTA_SERVICE_PATH = join(TOOLBOX_ROOT, "letta-service.json")

const OPENCODE_BINARY =
  process.platform === "win32"
    ? join(
        process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
        "npm",
        "node_modules",
        "@opencode",
        "cli",
        "bin",
        "opencode.exe",
      )
    : "opencode"

const STATE_VERSION = 1
const CONFIG_VERSION = 2
const DEFAULT_MODEL = "letta/agent-config"
const DEFAULT_LETTA_MODEL = "letta/agent-config"
// Verified on the existing Stock Letta Agent; affects newly created Agents only.
const DEFAULT_LETTA_NEW_AGENT_MODEL = "openai-codex/gpt-6.1-sol"
const DEFAULT_LETTA_SERVER_URL = "ws://127.0.0.1:4500"
const LETTA_STARTUP_TIMEOUT_MS = 30_000
const DEFAULT_MAX_RESULT_CHARS = 6_000
const MAX_RESULT_CHARS = DEFAULT_MAX_RESULT_CHARS
const DEFAULT_STATUS_OPERATION_LIMIT = 3
const DEFAULT_AUTO_COMPACT_TURNS = 8
const MAX_RETAINED_OPERATIONS = 200
const SESSION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

type ProjectRecord = {
  id: string
  name: string
  path: string
  permissions?: {
    read?: boolean
    write?: boolean
    shell?: boolean
  }
}

type RuntimeEngine = "opencode" | "letta"

type RuntimeConfig = {
  version: number
  engine: RuntimeEngine
  defaultModel: string
  lettaServerUrl?: string
  lettaServerCwd?: string
  lettaNodeBinary?: string
  lettaAutoStart?: boolean
  lettaNewAgentModel?: string
  compactResults?: boolean
  maxResultChars?: number
  statusOperationLimit?: number
  autoCompactEnabled?: boolean
  autoCompactTurns?: number
}

type LettaServiceState = {
  managed: true
  pid: number
  serverUrl: string
  cwd: string
  nodeBinary?: string
  command: string
  stdoutPath: string
  stderrPath: string
  startedAt: string
}

type RuntimeSession = {
  name: string
  engine: RuntimeEngine
  sessionId?: string
  model: string
  archived: boolean
  createdAt: string
  updatedAt: string
  lastCompactedAt?: string
  lastOperationId?: string
  lastPolledOperationId?: string
  turnsSinceCompaction?: number
  autoCompactCount?: number
  lastCompactionReason?: "manual" | "auto"
  lastCompactionBefore?: number | null
  lastCompactionAfter?: number | null
  modelConfiguration?: Record<string, unknown> | null
  modelSelection?: Record<string, unknown> | null
}

type ProjectRuntimeState = {
  activeSession: string | null
  sessions: Record<string, RuntimeSession>
  lettaAgentId?: string
  migratedFromPocAt?: string
  migratedFromLettaPocAt?: string
}

type RuntimeState = {
  version: number
  projects: Record<string, ProjectRuntimeState>
}

type OperationState = "running" | "completed" | "failed" | "cancelled"

type RuntimeOperation = {
  id: string
  projectId: string
  sessionName: string
  pid: number
  engine?: RuntimeEngine
  sessionId?: string
  model: string
  inputPath?: string
  taskRef?: string | null
  modelSelection?: Record<string, unknown>
  contextPaths?: string[]
  reconciliation?: Record<string, any>
  remoteSettlement?: Record<string, any>

  state: OperationState
  stdoutPath: string
  stderrPath: string
  createdAt: string
  updatedAt: string
  exitCode?: number | null
}

type OperationsFile = Record<string, RuntimeOperation>

type PocBinding = {
  projectId: string
  sessionId: string
  directory: string
  model?: string
  createdAt?: string
  updatedAt?: string
}

type LettaPocConversation = {
  name: string
  conversationId: string
  archived: boolean
  createdAt: string
  updatedAt: string
  lastCompactedAt?: string
}

type LettaPocProject = {
  agentId: string
  activeConversation: string | null
  conversations: Record<string, LettaPocConversation>
  createdAt: string
  updatedAt: string
}

type LettaPocState = {
  version: number
  projects: Record<string, LettaPocProject>
}

function now() {
  return new Date().toISOString()
}

function textResult(value: unknown) {
  const output = typeof value === "string" ? value : JSON.stringify(value, null, 2)
  // Keep one MCP representation only. Full logs stay local under .ops/.
  return {
    content: [{ type: "text" as const, text: output }],
  }
}

function clampInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function clipResultText(value: unknown, maxChars: number) {
  const text = typeof value === "string" ? value : ""
  if (text.length <= maxChars) return { text, truncated: false }
  return {
    text: `${text.slice(0, maxChars)}\n…[truncated; full output retained locally]`,
    truncated: true,
  }
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path, "utf8")) as T
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT") return fallback
    throw error
  }
}

const JSON_WRITE_QUEUE_KEY = "__openchatxAgentRuntimeJsonWriteQueue"
const SESSION_STATE_QUEUE_KEY = "__openchatxAgentRuntimeSessionStateQueue"

function withGlobalQueue<T>(
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const shared = globalThis as Record<string, unknown>
  const previous =
    (shared[key] as Promise<unknown> | undefined) ?? Promise.resolve()
  const current = previous
    .catch(() => undefined)
    .then(work)
  shared[key] = current.then(
    () => undefined,
    () => undefined,
  )
  return current
}

async function writeJsonFile(path: string, value: unknown) {
  return withGlobalQueue(JSON_WRITE_QUEUE_KEY, async () => {
    const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8")
      await fs.rename(tmp, path)
    } finally {
      await fs.rm(tmp, { force: true })
    }
  })
}

function withOperationsLock<T>(work: () => Promise<T>) {
  return withOperationRegistryLock(work)
}

function withSessionStateLock<T>(work: () => Promise<T>) {
  return withGlobalQueue(SESSION_STATE_QUEUE_KEY, work)
}

async function readText(path: string) {
  try {
    return await fs.readFile(path, "utf8")
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT") return ""
    throw error
  }
}

async function inferLettaServerCwd() {
  const registry = await readJsonFile<{ projects?: ProjectRecord[] }>(
    PROJECTS_PATH,
    {},
  )
  const preferred = registry.projects?.find((item) => item.id === "letta-poc")
  if (!preferred?.path) return undefined

  const cli = join(
    preferred.path,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "letta.cmd" : "letta",
  )
  try {
    await fs.access(cli)
    return preferred.path
  } catch {
    return undefined
  }
}

async function inferLettaNodeBinary(lettaServerCwd?: string) {
  if (!lettaServerCwd) return process.execPath
  const candidate = join(
    lettaServerCwd,
    "node_modules",
    "node",
    "bin",
    process.platform === "win32" ? "node.exe" : "node",
  )
  try {
    await fs.access(candidate)
    return candidate
  } catch {
    return process.execPath
  }
}

async function ensureConfig(): Promise<RuntimeConfig> {
  const existing = await readJsonFile<RuntimeConfig | null>(CONFIG_PATH, null)
  const engine: RuntimeEngine =
    "letta"
  const lettaServerCwd =
    existing?.lettaServerCwd?.trim() || (await inferLettaServerCwd())
  const lettaNodeBinary =
    existing?.lettaNodeBinary?.trim() ||
    (await inferLettaNodeBinary(lettaServerCwd))
  const config: RuntimeConfig = {
    version: CONFIG_VERSION,
    engine,
    defaultModel: existing?.defaultModel || DEFAULT_MODEL,
    lettaServerUrl:
      existing?.lettaServerUrl?.trim() || DEFAULT_LETTA_SERVER_URL,
    ...(lettaServerCwd ? { lettaServerCwd } : {}),
    ...(lettaNodeBinary ? { lettaNodeBinary } : {}),
    lettaAutoStart: existing?.lettaAutoStart !== false,
    lettaNewAgentModel: existing?.lettaNewAgentModel?.trim() || DEFAULT_LETTA_NEW_AGENT_MODEL,
    compactResults: existing?.compactResults !== false,
    maxResultChars: clampInteger(
      existing?.maxResultChars,
      DEFAULT_MAX_RESULT_CHARS,
      1_000,
      12_000,
    ),
    statusOperationLimit: clampInteger(
      existing?.statusOperationLimit,
      DEFAULT_STATUS_OPERATION_LIMIT,
      1,
      20,
    ),
    autoCompactEnabled: existing?.autoCompactEnabled !== false,
    autoCompactTurns: clampInteger(
      existing?.autoCompactTurns,
      DEFAULT_AUTO_COMPACT_TURNS,
      2,
      50,
    ),
  }

  if (
    existing?.version !== CONFIG_VERSION ||
    existing.engine !== config.engine ||
    existing.defaultModel !== config.defaultModel ||
    existing.lettaServerUrl !== config.lettaServerUrl ||
    existing.lettaServerCwd !== config.lettaServerCwd ||
    existing.lettaNodeBinary !== config.lettaNodeBinary ||
    existing.lettaAutoStart !== config.lettaAutoStart ||
    existing.lettaNewAgentModel !== config.lettaNewAgentModel ||
    existing.compactResults !== config.compactResults ||
    existing.maxResultChars !== config.maxResultChars ||
    existing.statusOperationLimit !== config.statusOperationLimit ||
    existing.autoCompactEnabled !== config.autoCompactEnabled ||
    existing.autoCompactTurns !== config.autoCompactTurns
  ) {
    await writeJsonFile(CONFIG_PATH, config)
  }

  return config
}

async function ensureState(): Promise<RuntimeState> {
  const state = await readJsonFile<RuntimeState>(STATE_PATH, {
    version: STATE_VERSION,
    projects: {},
  })

  if (state.version !== STATE_VERSION) {
    throw new Error(
      `AGENT_RUNTIME_STATE_VERSION_UNSUPPORTED: expected ${STATE_VERSION}, got ${state.version}`,
    )
  }

  const pocBindings = await readJsonFile<Record<string, PocBinding>>(
    POC_BINDINGS_PATH,
    {},
  )
  let changed = false

  for (const [projectId, binding] of Object.entries(pocBindings)) {
    if (state.projects[projectId]) continue
    const timestamp = now()
    state.projects[projectId] = {
      activeSession: "main",
      migratedFromPocAt: timestamp,
      sessions: {
        main: {
          name: "main",
          engine: "opencode",
          sessionId: binding.sessionId,
          model: binding.model || DEFAULT_MODEL,
          archived: false,
          createdAt: binding.createdAt || timestamp,
          updatedAt: binding.updatedAt || timestamp,
        },
      },
    }
    changed = true
  }

  const lettaPocState = await readJsonFile<LettaPocState>(
    LETTA_POC_STATE_PATH,
    { version: 1, projects: {} },
  )

  for (const [projectId, binding] of Object.entries(lettaPocState.projects)) {
    if (state.projects[projectId]) continue
    const timestamp = now()
    const sessions = Object.fromEntries(
      Object.entries(binding.conversations).map(([name, conversation]) => [
        name,
        {
          name,
          engine: "letta" as const,
          sessionId: conversation.conversationId,
          model: DEFAULT_LETTA_MODEL,
          archived: conversation.archived,
          createdAt: conversation.createdAt || timestamp,
          updatedAt: conversation.updatedAt || timestamp,
          ...(conversation.lastCompactedAt
            ? { lastCompactedAt: conversation.lastCompactedAt }
            : {}),
        },
      ]),
    )

    state.projects[projectId] = {
      activeSession:
        binding.activeConversation &&
        sessions[binding.activeConversation] &&
        !sessions[binding.activeConversation].archived
          ? binding.activeConversation
          : Object.values(sessions).find((item) => !item.archived)?.name ?? null,
      sessions,
      lettaAgentId: binding.agentId,
      migratedFromLettaPocAt: timestamp,
    }
    changed = true
  }

  if (changed) {
    await writeJsonFile(STATE_PATH, state)
  }

  return state
}

async function saveState(state: RuntimeState) {
  await writeJsonFile(STATE_PATH, state)
}

async function getProject(projectId: string): Promise<ProjectRecord> {
  const registry = await readJsonFile<{ projects?: ProjectRecord[] }>(
    PROJECTS_PATH,
    {},
  )
  const project = registry.projects?.find((item) => item.id === projectId)
  if (!project) {
    throw new Error(`PROJECT_NOT_REGISTERED: ${projectId}`)
  }
  return project
}

function requireOpenCodePermissions(project: ProjectRecord, auto = false) {
  if (!project.permissions?.read || !project.permissions?.shell) {
    throw new Error(
      `PROJECT_PERMISSION_DENIED: ${project.id} requires read+shell permission for OpenCode`,
    )
  }
  if (auto && !project.permissions?.write) {
    throw new Error(
      `PROJECT_PERMISSION_DENIED: ${project.id} requires write permission when auto=true`,
    )
  }
}

function validateSessionName(name: string) {
  if (!SESSION_NAME_PATTERN.test(name)) {
    throw new Error(
      "SESSION_NAME_INVALID: use 1-64 characters [A-Za-z0-9._-], starting with an alphanumeric character",
    )
  }
}

function ensureProjectState(state: RuntimeState, projectId: string) {
  if (!state.projects[projectId]) {
    state.projects[projectId] = {
      activeSession: null,
      sessions: {},
    }
  }
  return state.projects[projectId]
}

function defaultModelForEngine(
  engine: RuntimeEngine,
  config: RuntimeConfig,
) {
  return engine === "opencode" ? config.defaultModel : DEFAULT_LETTA_MODEL
}

function ensureSession(
  projectState: ProjectRuntimeState,
  name: string,
  engine: RuntimeEngine,
  model: string,
) {
  validateSessionName(name)
  const existing = projectState.sessions[name]
  if (existing) {
    if (existing.archived) {
      throw new Error(`SESSION_ARCHIVED: ${name}`)
    }
    if (existing.engine !== engine) {
      throw new Error(
        `SESSION_ENGINE_CONFLICT: ${name} uses ${existing.engine}, not ${engine}`,
      )
    }
    return existing
  }

  const timestamp = now()
  const created: RuntimeSession = {
    name,
    engine,
    model,
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  projectState.sessions[name] = created
  if (!projectState.activeSession) {
    projectState.activeSession = name
  }
  return created
}

function resolveSession(
  projectState: ProjectRuntimeState,
  sessionName: string | undefined,
  requestedEngine: RuntimeEngine | undefined,
  requestedModel: string | undefined,
  config: RuntimeConfig,
) {
  const name = sessionName || projectState.activeSession || "main"
  const existing = projectState.sessions[name]
  if (existing) {
    if (existing.archived) {
      throw new Error(`SESSION_ARCHIVED: ${name}`)
    }
    if (requestedEngine && requestedEngine !== existing.engine) {
      throw new Error(
        `SESSION_ENGINE_CONFLICT: ${name} uses ${existing.engine}, not ${requestedEngine}`,
      )
    }
    return existing
  }

  const engine = requestedEngine || config.engine
  return ensureSession(
    projectState,
    name,
    engine,
    requestedModel || defaultModelForEngine(engine, config),
  )
}

async function readOperations(): Promise<OperationsFile> {
  return readJsonFile<OperationsFile>(OPERATIONS_PATH, {})
}

async function saveOperations(operations: OperationsFile) {
  await writeJsonFile(OPERATIONS_PATH, operations)
}

async function updateOperation(
  id: string,
  patch: Partial<RuntimeOperation>,
) {
  return withOperationsLock(async () => {
    const operations = await readOperations()
    const existing = operations[id]
    if (!existing) return
    const protectedPatch =
      existing.state === "cancelled" &&
      patch.state &&
      patch.state !== "cancelled"
        ? { ...patch, state: "cancelled" as const }
        : patch
    if (protectedPatch.reconciliation) {
      protectedPatch.reconciliation = applyRemoteSettlement(
        { ...existing, ...protectedPatch }, protectedPatch.reconciliation,
      )
    }
    operations[id] = {
      ...existing,
      ...protectedPatch,
      updatedAt: now(),
    }
    await saveOperations(operations)
  })
}

function isProcessRunning(pid: number) {
  if (pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function pruneOperations() {
  const operations = await readOperations()
  const protectedIds = collectUnpolledOperationIds(await ensureState())
  const ordered = Object.values(operations).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )

  for (const operation of ordered.slice(MAX_RETAINED_OPERATIONS)) {
    if (protectedIds.has(operation.id)) continue
    if (operation.state === "running" && isProcessRunning(operation.pid)) {
      continue
    }
    if (operation.engine === "letta") {
      try {
        const output = await readText(operation.stdoutPath)
        const parsed = output.trim() ? parseLettaWorkerOutput(output) : {}
        if (retainUnresolvedOperation(operation, parsed, await readText(operation.stderrPath))) continue
      } catch { continue } // Missing/invalid evidence must not be pruned.
    }
    if (operation.projectId === "openchatx-qa-reviewer") {
      // Retain existing execution evidence before removing queue/log entries.
      // Running/uncertain QA or an archive failure must retain the originals.
      if (operation.state === "running") continue
      try {
        await archiveQaOperation(TOOLBOX_ROOT, operation)
      } catch {
        console.warn("QA_OPERATION_ARCHIVE_RETAINED: " + operation.id)
        continue
      }
    }
    delete operations[operation.id]
    await Promise.all([
      fs.rm(operation.stdoutPath, { force: true }),
      fs.rm(operation.stderrPath, { force: true }),
      ...(operation.inputPath
        ? [fs.rm(operation.inputPath, { force: true })]
        : []),
    ])
  }

  await saveOperations(operations)
}

async function runOpenCode(args: string[], cwd?: string, timeout = 30_000) {
  throw new Error("OPENCODE_ENGINE_RETIRED: the CLI was uninstalled")
  try {
    const result = await execFileAsync(OPENCODE_BINARY, args, {
      cwd,
      windowsHide: true,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf8",
    })
    return {
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    }
  } catch (error) {
    const failure = error as Error & {
      stdout?: string
      stderr?: string
      code?: string | number
    }
    const stderr = failure.stderr?.trim().slice(-4000) ?? ""
    const stdout = failure.stdout?.trim().slice(-4000) ?? ""
    throw new Error(
      `OPENCODE_COMMAND_FAILED: ${failure.message}${
        stderr ? `\nstderr: ${stderr}` : ""
      }${stdout ? `\nstdout: ${stdout}` : ""}`,
    )
  }
}

async function ensureService() {
  throw new Error("OPENCODE_ENGINE_RETIRED: the CLI was uninstalled")
  try {
    return (await runOpenCode(["service", "status"])).stdout
  } catch {
    return (await runOpenCode(["service", "start"])).stdout
  }
}

function parseRunOutput(
  stdout: string,
  maxResultChars = DEFAULT_MAX_RESULT_CHARS,
) {
  const events = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>]
      } catch {
        return []
      }
    })

  const sessionId = events.find(
    (event) => typeof event.sessionID === "string",
  )?.sessionID as string | undefined

  const fullText = events
    .filter((event) => event.type === "text")
    .map((event) => event.part as Record<string, unknown> | undefined)
    .filter(
      (part): part is Record<string, unknown> =>
        typeof part?.text === "string",
    )
    .map((part) => part.text as string)
    .join("\n")
    .trim()

  const outputTruncated = fullText.length > maxResultChars
  const assistantText = outputTruncated
    ? `${fullText.slice(0, maxResultChars)}\n…[truncated; full output retained locally]`
    : fullText

  return {
    sessionId,
    assistantText,
    outputTruncated,
    eventCount: events.length,
  }
}

async function listOpenCodeSessions(project: ProjectRecord) {
  const { stdout } = await runOpenCode(
    ["session", "list", "--format", "json", "--max-count", "100"],
    project.path,
  )
  if (!stdout) return []
  return JSON.parse(stdout) as Array<Record<string, unknown>>
}

function parseLettaWorkerOutput(stdout: string) {
  const raw = stdout.trim()
  if (!raw) {
    throw new Error("LETTA_WORKER_OUTPUT_EMPTY")
  }
  try {
    return JSON.parse(raw) as Record<string, any>
  } catch {
    throw new Error(
      `LETTA_WORKER_OUTPUT_INVALID: ${raw.slice(-2000)}`,
    )
  }
}

function lettaWorkerEnv(config: RuntimeConfig) {
  return {
    ...process.env,
    OPENCHATX_RUNTIME_ROOT,
    OPENCHATX_LETTA_SERVER_CWD: config.lettaServerCwd || "",
    OPENCHATX_LETTA_NEW_AGENT_MODEL: config.lettaNewAgentModel || DEFAULT_LETTA_NEW_AGENT_MODEL,
    LETTA_APP_SERVER_URL:
      config.lettaServerUrl?.trim() || DEFAULT_LETTA_SERVER_URL,
  }
}

function lettaNodeBinary(config: RuntimeConfig) {
  return config.lettaNodeBinary?.trim() || process.execPath
}

async function runLettaWorkerSync(
  input: Record<string, unknown>,
  config: RuntimeConfig,
  timeout = 60_000,
) {
  await fs.mkdir(OPS_DIR, { recursive: true })
  const id = `letta_cmd_${randomUUID().replaceAll("-", "").slice(0, 16)}`
  const inputPath = join(OPS_DIR, `${id}.input.json`)
  await writeJsonFile(inputPath, input)

  try {
    const result = await execFileAsync(
      lettaNodeBinary(config),
      [LETTA_WORKER_PATH, inputPath],
      {
        cwd: TOOLBOX_ROOT,
        env: lettaWorkerEnv(config),
        windowsHide: true,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf8",
      },
    )
    return parseLettaWorkerOutput(result.stdout)
  } catch (error) {
    const failure = error as Error & {
      stdout?: string
      stderr?: string
    }
    if (failure.stdout?.trim()) {
      const parsed = parseLettaWorkerOutput(failure.stdout)
      if (typeof parsed.error === "string") {
        throw new Error(`LETTA_WORKER_FAILED: ${parsed.error}`)
      }
    }
    const stderr = failure.stderr?.trim().slice(-4000) ?? ""
    throw new Error(
      `LETTA_WORKER_FAILED: ${failure.message}${stderr ? `\nstderr: ${stderr}` : ""}`,
    )
  } finally {
    await fs.rm(inputPath, { force: true })
  }
}

function normaliseLocalLettaServerUrl(input: string) {
  try {
    const url = new URL(input)
    if (url.protocol !== "ws:") return null
    if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) return null
    if (!url.port || !/^\d+$/.test(url.port)) return null
    const port = Number(url.port)
    if (port < 1 || port > 65535) return null
    if (url.username || url.password || url.search || url.hash) return null
    if (url.pathname !== "/") return null
    return url.toString().replace(/\/$/, "")
  } catch {
    return null
  }
}

async function probeLettaHealth(
  config: RuntimeConfig,
  timeout = 5_000,
): Promise<Record<string, any>> {
  try {
    return await runLettaWorkerSync({ action: "probe" }, config, timeout)
  } catch (error) {
    return {
      ok: false,
      available: false,
      engine: "letta",
      serverUrl:
        config.lettaServerUrl?.trim() || DEFAULT_LETTA_SERVER_URL,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function readLettaServiceState() {
  return readJsonFile<LettaServiceState | null>(LETTA_SERVICE_PATH, null)
}

async function tailFile(path: string, maxChars = 4_000) {
  const value = await readText(path)
  return value.length <= maxChars ? value : value.slice(-maxChars)
}

async function publicLettaServiceState(config: RuntimeConfig) {
  const service = await readLettaServiceState()
  if (!service) {
    return {
      managed: false,
      running: false,
      configMatches: false,
      stateFile: LETTA_SERVICE_PATH,
    }
  }

  const configuredUrl =
    config.lettaServerUrl?.trim() || DEFAULT_LETTA_SERVER_URL
  return {
    ...service,
    running: isProcessRunning(service.pid),
    configMatches:
      service.serverUrl === configuredUrl &&
      service.cwd === config.lettaServerCwd &&
      (service.nodeBinary ?? process.execPath) === lettaNodeBinary(config),
    stateFile: LETTA_SERVICE_PATH,
  }
}

async function terminateManagedProcess(pid: number) {
  if (!isProcessRunning(pid)) return
  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill.exe", [
        "/PID",
        String(pid),
        "/T",
        "/F",
      ])
      return
    } catch {
      if (!isProcessRunning(pid)) return
      throw new Error(`LETTA_SERVICE_STOP_FAILED: pid=${pid}`)
    }
  }
  process.kill(pid, "SIGTERM")
}

async function startLettaService(config: RuntimeConfig) {
  const rawUrl =
    config.lettaServerUrl?.trim() || DEFAULT_LETTA_SERVER_URL
  const serverUrl = normaliseLocalLettaServerUrl(rawUrl)
  if (!serverUrl) {
    throw new Error(
      `LETTA_SERVER_AUTOSTART_REFUSED_NON_LOOPBACK: ${rawUrl}`,
    )
  }
  if (config.lettaAutoStart === false) {
    throw new Error("LETTA_SERVER_AUTOSTART_DISABLED")
  }

  const cwd = config.lettaServerCwd?.trim()
  if (!cwd) throw new Error("LETTA_SERVER_CWD_REQUIRED")

  const entry = join(
    cwd,
    "node_modules",
    "@letta-ai",
    "letta-code",
    "letta.js",
  )
  try {
    await fs.access(entry)
  } catch {
    throw new Error(`LETTA_SERVER_ENTRY_NOT_FOUND: ${entry}`)
  }

  const serviceDir = join(TOOLBOX_ROOT, ".services")
  await fs.mkdir(serviceDir, { recursive: true })
  const stdoutPath = join(serviceDir, "letta-server.stdout.log")
  const stderrPath = join(serviceDir, "letta-server.stderr.log")
  const stdoutFd = openSync(stdoutPath, "a")
  const stderrFd = openSync(stderrPath, "a")

  let child
  try {
    child = spawn(
      lettaNodeBinary(config),
      [entry, "server", "--listen", serverUrl],
      {
        cwd,
        env: {
          ...process.env,
          LETTA_APP_SERVER_URL: serverUrl,
        },
        detached: true,
        windowsHide: true,
        stdio: ["ignore", stdoutFd, stderrFd],
      },
    )
  } finally {
    closeSync(stdoutFd)
    closeSync(stderrFd)
  }

  const pid = child.pid ?? -1
  if (pid <= 0) throw new Error("LETTA_SERVER_PID_MISSING")
  child.unref()

  const service: LettaServiceState = {
    managed: true,
    pid,
    serverUrl,
    cwd,
    nodeBinary: lettaNodeBinary(config),
    command: `${lettaNodeBinary(config)} ${entry} server --listen ${serverUrl}`,
    stdoutPath,
    stderrPath,
    startedAt: now(),
  }
  await writeJsonFile(LETTA_SERVICE_PATH, service)

  const deadline = Date.now() + LETTA_STARTUP_TIMEOUT_MS
  let lastHealth: Record<string, any> = {
    ok: false,
    available: false,
    error: "startup pending",
  }

  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) break
    await new Promise((resolve) => setTimeout(resolve, 500))
    lastHealth = await probeLettaHealth(config, 4_000)
    if (lastHealth.available === true && lastHealth.ok !== false) {
      return {
        health: lastHealth,
        service: await publicLettaServiceState(config),
        started: true,
      }
    }
  }

  if (isProcessRunning(pid)) {
    await terminateManagedProcess(pid)
  }

  const [stdout, stderr] = await Promise.all([
    tailFile(stdoutPath),
    tailFile(stderrPath),
  ])
  throw new Error(
    `LETTA_SERVER_START_FAILED: ${String(lastHealth.error ?? "health check failed")}` +
      `${stdout ? `\nstdout: ${stdout}` : ""}` +
      `${stderr ? `\nstderr: ${stderr}` : ""}`,
  )
}

async function ensureLettaService(config: RuntimeConfig) {
  const rawUrl =
    config.lettaServerUrl?.trim() || DEFAULT_LETTA_SERVER_URL
  const managed = await readLettaServiceState()
  const managedRunning = Boolean(
    managed && isProcessRunning(managed.pid),
  )
  const managedMatches =
    managedRunning &&
    managed!.serverUrl === rawUrl &&
    managed!.cwd === config.lettaServerCwd &&
    (managed!.nodeBinary ?? process.execPath) === lettaNodeBinary(config)

  const health = await probeLettaHealth(config, 5_000)
  if (health.available === true && health.ok !== false) {
    if (managedRunning && !managedMatches) {
      if (config.lettaAutoStart === false) {
        return {
          health,
          service: await publicLettaServiceState(config),
          started: false,
        }
      }
      if (!normaliseLocalLettaServerUrl(rawUrl)) {
        throw new Error(
          `LETTA_MANAGED_SERVER_CONFIG_MISMATCH: pid=${managed!.pid}`,
        )
      }
      await terminateManagedProcess(managed!.pid)
      return startLettaService(config)
    }

    return {
      health,
      service: await publicLettaServiceState(config),
      started: false,
    }
  }

  if (config.lettaAutoStart === false) {
    throw new Error(
      `LETTA_SERVER_UNAVAILABLE: autostart disabled; ${String(health.error ?? "unknown error")}`,
    )
  }

  if (!normaliseLocalLettaServerUrl(rawUrl)) {
    throw new Error(
      `LETTA_SERVER_UNAVAILABLE: refusing to auto-start non-loopback server ${rawUrl}`,
    )
  }

  if (managedRunning) {
    if (!managedMatches) {
      await terminateManagedProcess(managed!.pid)
      return startLettaService(config)
    }
    throw new Error(
      `LETTA_MANAGED_SERVER_UNHEALTHY: pid=${managed!.pid}; ${String(health.error ?? "health check failed")}`,
    )
  }

  return startLettaService(config)
}

async function dispatchLettaRun(args: {
  project: ProjectRecord
  projectState: ProjectRuntimeState
  session: RuntimeSession
  prompt: string
  config: RuntimeConfig
  timeoutMs: number
  taskRef?: string | null
  modelSelection?: Record<string, unknown>
  contextPaths?: string[]
}) {
  const { project, projectState, session, prompt, config, timeoutMs, taskRef, modelSelection, contextPaths } = args
  await ensureLettaService(config)

  // This is a read-only server sync. A dead local worker does not prove the
  // remote conversation is idle; never enqueue on an active or unknown Run.
  if (session.sessionId) {
    if (!projectState.lettaAgentId) {
      throw new Error("LETTA_EXISTING_CONVERSATION_AGENT_ID_MISSING")
    }
    const remote = await runLettaWorkerSync({
      action: "inspect",
      agentId: projectState.lettaAgentId,
      conversationId: session.sessionId,
    }, config, 15_000)
    assertRemoteStateIdle(remote)
  }
  await fs.mkdir(OPS_DIR, { recursive: true })

  // Reservation and registry persistence are one critical section. A second
  // caller must not pass the active-run check before the first worker is stored.
  return withOperationsLock(async () => {
    const operations = await readOperations()
    const latestState = await ensureState()
    const cursor = latestState.projects[project.id]?.sessions[session.name] ?? {}
    assertOperationDispatchReady(
      Object.values(operations), project.id, session.name, cursor, isProcessRunning,
    )

    const operationId = `op_${randomUUID().replaceAll("-", "").slice(0, 16)}`
    const stdoutPath = join(OPS_DIR, `${operationId}.stdout.log`)
    const stderrPath = join(OPS_DIR, `${operationId}.stderr.log`)
    const inputPath = join(OPS_DIR, `${operationId}.input.json`)
    await writeJsonFile(inputPath, {
      action: "run",
      projectId: project.id,
      sessionName: session.name,
      agentId: projectState.lettaAgentId,
      conversationId: session.sessionId,
      clientMessageId: `openchatx-${operationId}`,
      modelSelection,
      contextPaths,
      taskRef,
      prompt,
      timeoutMs,
    })

    const stdoutStream = createWriteStream(stdoutPath, { flags: "w" })
    const stderrStream = createWriteStream(stderrPath, { flags: "w" })
    const child = spawn(lettaNodeBinary(config), [LETTA_WORKER_PATH, inputPath], {
      cwd: TOOLBOX_ROOT,
      env: lettaWorkerEnv(config),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })

    child.stdout?.pipe(stdoutStream)
    child.stderr?.pipe(stderrStream)

    const operation: RuntimeOperation = {
      id: operationId,
      projectId: project.id,
      sessionName: session.name,
      pid: child.pid ?? -1,
      engine: "letta",
      sessionId: session.sessionId,
      model: session.model,
      inputPath,
      contextPaths,
      modelSelection,
      taskRef: taskRef ?? null,
      state: "running",
      stdoutPath,
      stderrPath,
      createdAt: now(),
      updatedAt: now(),
    }

    operations[operationId] = operation
    await saveOperations(operations)
    await pruneOperations()

    child.on("error", async () => {
      stdoutStream.end()
      stderrStream.end()
      await updateOperation(operationId, { state: "failed" })
    })

    child.on("close", async (code) => {
      stdoutStream.end()
      stderrStream.end()
      await updateOperation(operationId, {
        state: code === 0 ? "completed" : "failed",
        exitCode: code,
      })
    })

    return operation
  })
}

async function dispatchOpenCodeRun(args: {
  project: ProjectRecord
  session: RuntimeSession
  prompt: string
  model: string
  auto: boolean
}) {
  throw new Error("OPENCODE_ENGINE_RETIRED: do not dispatch legacy CLI sessions")
  const { project, session, prompt, model, auto } = args
  await fs.mkdir(OPS_DIR, { recursive: true })

  const operations = await readOperations()
  const active = Object.values(operations).find(
    (item) =>
      item.projectId === project.id &&
      item.sessionName === session.name &&
      item.state === "running" &&
      isProcessRunning(item.pid),
  )
  if (active) {
    throw new Error(`OPERATION_ALREADY_RUNNING: ${active.id}`)
  }

  const operationId = `op_${randomUUID().replaceAll("-", "").slice(0, 16)}`
  const stdoutPath = join(OPS_DIR, `${operationId}.stdout.log`)
  const stderrPath = join(OPS_DIR, `${operationId}.stderr.log`)
  const commandArgs = ["run"]

  if (session.sessionId) {
    commandArgs.push("--session", session.sessionId)
  }

  commandArgs.push("--model", model, "--format", "json")

  if (auto) {
    commandArgs.push("--auto")
  }

  if (!session.sessionId) {
    commandArgs.push("--title", `OpenChatX: ${project.name} / ${session.name}`)
  }

  commandArgs.push(prompt)

  const stdoutStream = createWriteStream(stdoutPath, { flags: "w" })
  const stderrStream = createWriteStream(stderrPath, { flags: "w" })
  const child = spawn(OPENCODE_BINARY, commandArgs, {
    cwd: project.path,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  })

  child.stdout?.pipe(stdoutStream)
  child.stderr?.pipe(stderrStream)

  const operation: RuntimeOperation = {
    id: operationId,
    projectId: project.id,
    sessionName: session.name,
    pid: child.pid ?? -1,
    engine: "opencode",
    sessionId: session.sessionId,
    model,
    state: "running",
    stdoutPath,
    stderrPath,
    createdAt: now(),
    updatedAt: now(),
  }

  operations[operationId] = operation
  await saveOperations(operations)
  await pruneOperations()

  child.on("error", async () => {
    stdoutStream.end()
    stderrStream.end()
    await updateOperation(operationId, { state: "failed" })
  })

  child.on("close", async (code) => {
    stdoutStream.end()
    stderrStream.end()
    await updateOperation(operationId, {
      state: code === 0 ? "completed" : "failed",
      exitCode: code,
    })
  })

  return operation
}

async function pollOperation(
  project: ProjectRecord,
  operationId?: string,
  detail: "compact" | "full" = "compact",
) {
  const operations = await readOperations()
  let operation: RuntimeOperation | undefined

  if (operationId) {
    operation = operations[operationId]
  } else {
    operation = Object.values(operations)
      .filter((item) => item.projectId === project.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  }

  if (!operation || operation.projectId !== project.id) {
    throw new Error("OPERATION_NOT_FOUND")
  }

  const engine: RuntimeEngine = operation.engine || "opencode"
  const stillRunning =
    operation.state === "running" && isProcessRunning(operation.pid)

  if (stillRunning) {
    return {
      ok: true,
      engine,
      operationId: operation.id,
      projectId: project.id,
      sessionName: operation.sessionName,
      state: "running" as const,
      modelSelection: publicModelSelection(operation.modelSelection),
      ...describeOperationOutcome({ state: "running", taskRef: operation.taskRef }),
      sessionId: operation.sessionId ?? null,
    }
  }

  const stdout = await readText(operation.stdoutPath)
  const stderr = await readText(operation.stderrPath)
  const state = await ensureState()
  const projectState = ensureProjectState(state, project.id)
  const config = await ensureConfig()
  const fullDetail = detail === "full" || config.compactResults === false
  const maxResultChars = config.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS

  if (engine === "letta") {
    const parsed = stdout.trim()
      ? parseLettaWorkerOutput(stdout)
      : ({} as Record<string, any>)
    const sessionId =
      typeof parsed.sessionId === "string"
        ? parsed.sessionId
        : typeof parsed.conversationId === "string"
          ? parsed.conversationId
          : operation.sessionId

    const operationPatch: Partial<RuntimeOperation> = {}
    if (sessionId && sessionId !== operation.sessionId) {
      operationPatch.sessionId = sessionId
    }
    if (operation.state === "running") {
      operationPatch.state = parsed.ok === true ? "completed" : "failed"
    }
    operationPatch.reconciliation = summarizeReconciliation(
      { ...operation, ...operationPatch }, parsed, stderr,
    )
    if (Object.keys(operationPatch).length > 0) {
      await updateOperation(operation.id, operationPatch)
      operation = (await readOperations())[operation.id] ?? operation
    }

    // A late poll may return its own result, but must not rewrite a newer
    // session's Agent/Conversation, lastOperationId or compaction counters.
    const sessionUpdate = await withSessionStateLock(async () => {
      const latestState = await ensureState()
      const latestProject = ensureProjectState(latestState, project.id)
      const latestSession = ensureSession(
        latestProject,
        operation.sessionName,
        "letta",
        operation.model || DEFAULT_LETTA_MODEL,
      )
      const current = isCurrentSessionOperation(latestSession, operation.id)
      if (current) {
        if (sessionId) latestSession.sessionId = sessionId
        if (typeof parsed.agentId === "string") latestProject.lettaAgentId = parsed.agentId
        const firstPoll = latestSession.lastPolledOperationId !== operation.id
        latestSession.model = operation.model || DEFAULT_LETTA_MODEL
        latestSession.modelConfiguration = publicModelConfiguration(parsed.modelConfiguration)
        latestSession.modelSelection = publicModelSelection(parsed.modelSelection ?? operation.modelSelection)
        latestSession.updatedAt = now()
        latestSession.lastOperationId = operation.id
        latestProject.activeSession = latestSession.name
        if (firstPoll && operation.state === "completed" && parsed.ok !== false) {
          latestSession.turnsSinceCompaction = (latestSession.turnsSinceCompaction ?? 0) + 1
        }
        latestSession.lastPolledOperationId = operation.id
        await saveState(latestState)
      }
      return { current, agentId: latestProject.lettaAgentId ?? null }
    })
    if (operation.inputPath && !operation.reconciliation?.requiresReconciliation) {
      await fs.rm(operation.inputPath, { force: true })
    }

    return {
      ok:
        (operation.state === "completed" && parsed.ok !== false) ||
        operation.state === "cancelled",
      engine,
      operationId: operation.id,
      projectId: project.id,
      sessionName: operation.sessionName,
      state: operation.state,
      exitCode: operation.exitCode ?? null,
      sessionId: sessionId ?? null,
      agentId: sessionUpdate.agentId,
      stalePoll: !sessionUpdate.current,
      reconciliation: operation.reconciliation,
      modelConfiguration: publicModelConfiguration(parsed.modelConfiguration),
      modelSelection: publicModelSelection(parsed.modelSelection ?? operation.modelSelection),
      usage: publicTokenUsage(parsed.usage),
      assistantText: clipResultText(parsed.assistantText, maxResultChars).text,
      outputTruncated:
        parsed.outputTruncated === true ||
        clipResultText(parsed.assistantText, maxResultChars).truncated,
      changed_files: Array.isArray(parsed.changed_files)
        ? parsed.changed_files
        : [],
      validation:
        parsed.validation && typeof parsed.validation === "object"
          ? parsed.validation
          : {},
      blockers: Array.isArray(parsed.blockers) ? parsed.blockers : [],
      ...describeOperationOutcome({
        state: operation.state, taskRef: operation.taskRef, blockers: parsed.blockers,
        idempotency: parsed.validation?.idempotency, stalePoll: !sessionUpdate.current,
        reconciliation: operation.reconciliation,
      }),
      error: typeof parsed.error === "string" ? parsed.error : undefined,
      stderr:
        stderr.trim().slice(fullDetail ? -4000 : -1000) || undefined,
    }
  }

  const parsed = parseRunOutput(
    stdout,
    fullDetail ? 12_000 : maxResultChars,
  )
  const session = ensureSession(
    projectState,
    operation.sessionName,
    "opencode",
    operation.model || config.defaultModel,
  )

  if (parsed.sessionId) {
    session.sessionId = parsed.sessionId
    session.model = operation.model
  }
  session.updatedAt = now()
  session.lastOperationId = operation.id
  session.lastPolledOperationId = operation.id
  projectState.activeSession = session.name
  await saveState(state)

  if (operation.state === "running") {
    await updateOperation(operation.id, {
      state: parsed.sessionId ? "completed" : "failed",
    })
    operation = (await readOperations())[operation.id] ?? operation
  }

  return {
    ok:
      operation.state === "completed" ||
      Boolean(parsed.sessionId) ||
      operation.state === "cancelled",
    engine,
    operationId: operation.id,
    projectId: project.id,
    sessionName: operation.sessionName,
    state: operation.state,
    exitCode: operation.exitCode ?? null,
    sessionId: parsed.sessionId ?? operation.sessionId ?? null,
    assistantText: parsed.assistantText,
    outputTruncated: parsed.outputTruncated,
    eventCount: parsed.eventCount,
    stderr:
      stderr.trim().slice(fullDetail ? -4000 : -1000) || undefined,
  }
}

async function reconcileStoppedLettaOperation(project: ProjectRecord, before: RuntimeOperation) {
  const input = before.inputPath ? await readJsonFile<Record<string, any>>(before.inputPath, {}) : {}
  const state = await ensureState()
  const projectState = ensureProjectState(state, project.id)
  if (input.projectId !== project.id || !input.agentId || input.agentId !== projectState.lettaAgentId ||
      !input.conversationId || input.conversationId !== before.sessionId ||
      input.clientMessageId !== `openchatx-${before.id}`) {
    throw new Error(`LETTA_CANCEL_REMOTE_OWNERSHIP_UNVERIFIED: ${before.id}`)
  }
  const config = await ensureConfig()
  const remote = await runLettaWorkerSync({
    action: "cancel", projectId: project.id, agentId: input.agentId,
    conversationId: input.conversationId, clientMessageId: input.clientMessageId,
  }, config, 25_000)
  if (remote.ok !== true || !["cancelled", "already_idle"].includes(remote.status)) {
    throw new Error(`LETTA_CANCEL_REMOTE_UNCERTAIN: ${before.id}`)
  }
  return withOperationsLock(async () => {
    const operations = await readOperations()
    const current = operations[before.id]
    if (!current || current.projectId !== project.id || current.engine !== "letta" ||
        current.inputPath !== before.inputPath || current.sessionId !== before.sessionId ||
        current.pid !== before.pid || current.state === "running" || isProcessRunning(current.pid)) {
      throw new Error(`OPERATION_CHANGED_DURING_CANCEL: ${before.id}`)
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

async function cancelOperation(project: ProjectRecord, operationId: string) {
  const before = (await readOperations())[operationId]
  if (!before || before.projectId !== project.id) {
    throw new Error("OPERATION_NOT_FOUND")
  }
  if (before.state !== "running" || !isProcessRunning(before.pid)) {
    // A failed Letta turn may have been rejected by an orphan backend Run
    // that a preceding, unconfirmed timeout left behind. Reconcile only on
    // an explicit cancel of the most recent, already-polled failed operation;
    // never restart, fabricate a successful turn or cancel an arbitrary Run.
    if (before.engine === "letta" && before.state === "failed" && before.sessionId) {
      const operations = await readOperations()
      const state = await ensureState()
      const projectState = ensureProjectState(state, project.id)
      const session = projectState.sessions[before.sessionName]
      const matching = Object.values(operations)
        .filter((item) => item.projectId === project.id &&
          item.sessionName === before.sessionName)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      if (session?.lastOperationId === before.id &&
          session.lastPolledOperationId === before.id &&
          projectState.lettaAgentId && matching[0]?.id === before.id &&
          matching[1]) {
        const prior = matching[1]
        const readError = async (path: string): Promise<string> => {
          const output = await readText(path)
          try {
            const parsed = parseLettaWorkerOutput(output)
            return typeof parsed.error === "string" ? parsed.error : ""
          } catch {
            return ""
          }
        }
        const [currentError, previousError, previousStderr] = await Promise.all([
          readError(before.stdoutPath),
          readError(prior.stdoutPath),
          readText(prior.stderrPath),
        ])
        const proof = findRecoverableBackendRun(
          before, currentError, prior, previousError, previousStderr,
        )
        if (proof) {
          const config = await ensureConfig()
          const recovered = await runLettaWorkerSync({
            action: "recover-orphan",
            projectId: project.id,
            agentId: projectState.lettaAgentId,
            conversationId: proof.conversationId,
            runId: proof.runId,
          }, config, 25_000)
          if (recovered.ok !== true || recovered.status !== "cancelled" ||
              recovered.runId !== proof.runId ||
              recovered.conversationId !== proof.conversationId) {
            throw new Error(`LETTA_ORPHAN_RECOVERY_NOT_CONFIRMED: ${operationId}`)
          }
          return {
            ok: true, operationId, state: before.state,
            alreadyStopped: true, remoteStatus: "backend_orphan_cancelled",
            orphanRunId: proof.runId,
          }
        }
      }
    }
    if (before.engine === "letta" && before.reconciliation?.requiresReconciliation === true) {
      return reconcileStoppedLettaOperation(project, before)
    }
    return { ok: true, operationId, state: before.state, alreadyStopped: true }
  }

  let remoteStatus: string | null = null
  if (before.engine === "letta") {
    // The Worker PID belongs to OpenChatX, not to the remote Letta run.
    // Never kill a worker and falsely report cancellation while its Server
    // run may continue executing tools.
    const input = before.inputPath
      ? await readJsonFile<{
          projectId?: string
          agentId?: string
          conversationId?: string
          clientMessageId?: string
        }>(before.inputPath, {})
      : {}
    if (!input.clientMessageId || input.projectId !== project.id ||
        !input.conversationId || input.conversationId !== before.sessionId ||
        !input.agentId) {
      throw new Error(`LETTA_CANCEL_REMOTE_OWNERSHIP_UNVERIFIED: ${operationId}`)
    }
    const config = await ensureConfig()
    const remote = await runLettaWorkerSync({
      action: "cancel",
      projectId: project.id,
      agentId: input.agentId,
      conversationId: input.conversationId,
      clientMessageId: input.clientMessageId,
    }, config, 25_000)
    if (remote.ok !== true || !["cancelled", "already_idle"].includes(remote.status)) {
      throw new Error(`LETTA_CANCEL_REMOTE_UNCERTAIN: ${operationId}`)
    }
    remoteStatus = remote.status
  }

  return withOperationsLock(async () => {
    const operations = await readOperations()
    const operation = operations[operationId]
    if (!operation || operation.projectId !== project.id) {
      throw new Error("OPERATION_NOT_FOUND")
    }
    if (operation.state !== "running" || !isProcessRunning(operation.pid)) {
      return {
        ok: true, operationId, state: operation.state,
        alreadyStopped: true, remoteStatus,
      }
    }
    if (operation.pid !== before.pid || operation.inputPath !== before.inputPath) {
      throw new Error(`OPERATION_CHANGED_DURING_CANCEL: ${operationId}`)
    }

    try {
      if (process.platform === "win32") {
        await execFileAsync("taskkill.exe", ["/PID", String(operation.pid), "/T", "/F"])
      } else {
        process.kill(operation.pid, "SIGTERM")
      }
    } catch {
      if (isProcessRunning(operation.pid)) {
        throw new Error(`OPERATION_CANCEL_FAILED: ${operationId}`)
      }
    }

    operation.state = "cancelled"
    operation.updatedAt = now()
    operations[operationId] = operation
    await saveOperations(operations)
    return { ok: true, operationId, state: "cancelled", remoteStatus }
  })
}

type CompactionReason = "manual" | "auto"

async function compactSessionInPlace(args: {
  project: ProjectRecord
  projectState: ProjectRuntimeState
  session: RuntimeSession
  config: RuntimeConfig
  timeoutMs: number
  reason: CompactionReason
}) {
  const { project, projectState, session, config, timeoutMs, reason } = args
  if (!session.sessionId) {
    throw new Error(`SESSION_NOT_STARTED: ${session.name}`)
  }

  const operations = await readOperations()
  const running = Object.values(operations).find(
    (item) =>
      item.projectId === project.id &&
      item.sessionName === session.name &&
      item.state === "running" &&
      isProcessRunning(item.pid),
  )
  if (running) {
    throw new Error(`SESSION_HAS_RUNNING_OPERATION: ${running.id}`)
  }

  let before: number | null = null
  let after: number | null = null
  let summary = "Session compacted successfully."

  if (session.engine === "letta") {
    if (!projectState.lettaAgentId) throw new Error("LETTA_AGENT_ID_REQUIRED")
    await ensureLettaService(config)
    const response = await runLettaWorkerSync(
      {
        action: "compact",
        projectId: project.id,
        agentId: projectState.lettaAgentId,
        conversationId: session.sessionId,
        timeoutMs,
      },
      config,
      timeoutMs,
    )
    before =
      typeof response.numMessagesBefore === "number"
        ? response.numMessagesBefore
        : null
    after =
      typeof response.numMessagesAfter === "number"
        ? response.numMessagesAfter
        : null
    summary =
      typeof response.summary === "string"
        ? response.summary
        : "Letta conversation compacted successfully."
  } else {
    requireOpenCodePermissions(project)
    await ensureService()
    await runOpenCode(
      [
        "api",
        "POST",
        `/api/session/${session.sessionId}/compact`,
        "--data",
        "{}",
      ],
      project.path,
    )
    summary = "OpenCode session compacted successfully."
  }

  session.lastCompactedAt = now()
  session.updatedAt = session.lastCompactedAt
  session.turnsSinceCompaction = 0
  session.lastCompactionReason = reason
  session.lastCompactionBefore = before
  session.lastCompactionAfter = after
  if (reason === "auto") {
    session.autoCompactCount = (session.autoCompactCount ?? 0) + 1
  }
  projectState.activeSession = session.name

  return {
    compactAccepted: true,
    reason,
    sessionId: session.sessionId,
    numMessagesBefore: before,
    numMessagesAfter: after,
    summary,
  }
}

function publicSession(session: RuntimeSession, active: boolean) {
  return {
    name: session.name,
    engine: session.engine,
    sessionId: session.sessionId ?? null,
    model: session.model,
    modelConfiguration: publicModelConfiguration(session.modelConfiguration),
    modelSelection: publicModelSelection(session.modelSelection),
    archived: session.archived,
    active,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastCompactedAt: session.lastCompactedAt ?? null,
    lastOperationId: session.lastOperationId ?? null,
    lastPolledOperationId: session.lastPolledOperationId ?? null,
    turnsSinceCompaction: session.turnsSinceCompaction ?? 0,
    autoCompactCount: session.autoCompactCount ?? 0,
    lastCompactionReason: session.lastCompactionReason ?? null,
    lastCompactionBefore: session.lastCompactionBefore ?? null,
    lastCompactionAfter: session.lastCompactionAfter ?? null,
  }
}

export default defineTool({
  name: "agent_runtime",
  description:
    "Manage persistent project-scoped Letta sessions behind OpenChatX, including run, poll, cancel, compact, switch, archive, and historical read-only session inspection. Retired OpenCode engine cannot run.",
  inputSchema: z.object({
    action: z.enum([
      "probe",
      "configure",
      "status",
      "run",
      "poll",
      "cancel",
      "compact",
      "session_new",
      "session_switch",
      "session_list",
      "session_archive",
    ]),
    project_id: z.string().optional(),
    session_name: z.string().optional(),
    operation_id: z.string().optional(),
    prompt: z.string().optional(),
    task_ref: z.string().trim().min(1).max(512).optional(),
    context_paths: z.array(z.string().min(1).max(512)).max(16).optional().describe("run only: known exact files relevant to this task, relative to the Project root. No directories, globs or traversal. Enables bounded per-file index freshness/coverage checks; not a write allowlist or permission grant. Omit when files are not yet known."),
    engine: z.enum(["letta"]).optional(),
    model: z.string().optional().describe("run only: explicit user-selected openai-codex handle or gpt-* alias; auto/omitted routes by task_complexity. letta/agent-config preserves the current conversation."),
    reasoning_effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional().describe("run only: honor an explicit user reasoning preference; otherwise use the task profile."),
    task_complexity: z.enum(["simple", "standard", "complex"]).optional().describe("run only: classify the current authorized task. simple=small well-defined edit/summary; standard=normal development; complex=ambiguous architecture or difficult root-cause work. Omission conservatively uses standard. User model selection takes priority."),
    default_model: z.string().optional(),
    letta_server_url: z.string().optional(),
    letta_server_cwd: z.string().optional(),
    letta_node_binary: z.string().optional(),
    letta_autostart: z.boolean().optional(),
    letta_new_agent_model: z.string().min(3).max(128).optional(),
    compact_results: z.boolean().optional(),
    max_result_chars: z.number().int().min(1000).max(12000).optional(),
    status_operation_limit: z.number().int().min(1).max(20).optional(),
    auto_compact: z.boolean().optional(),
    auto_compact_turns: z.number().int().min(2).max(50).optional(),
    detail: z.enum(["compact", "full"]).optional(),
    // 480s bounded Stock premarket/close-review worker budget; caller retains
    // a separate 30s+ status/poll reserve before its Windows task deadline.
    timeout_ms: z.number().int().min(1000).max(480000).optional(),
    auto: z.boolean().optional(),
  }),
  async execute({
    action,
    project_id,
    session_name,
    operation_id,
    prompt,
    task_ref,
    context_paths,
    reasoning_effort,
    task_complexity,
    engine,
    model,
    default_model,
    letta_server_url,
    letta_server_cwd,
    letta_node_binary,
    letta_autostart,
    letta_new_agent_model,
    compact_results,
    max_result_chars,
    status_operation_limit,
    auto_compact,
    auto_compact_turns,
    detail,
    timeout_ms,
    auto,
  }) {
    return withRuntimeActivity(TOOLBOX_ROOT, async () => {
    if (action !== "run" && context_paths !== undefined) throw new Error("CONTEXT_PATHS_RUN_ONLY")
    const config = await ensureConfig()

    if (action === "probe") {
      const state = await ensureState()
      let opencodeHealth: Record<string, unknown>
      try {
        const service = await ensureService()
        const version = (await runOpenCode(["--version"])).stdout
        opencodeHealth = {
          ok: true,
          available: true,
          version,
          service,
          error: null,
        }
      } catch (error) {
        opencodeHealth = {
          ok: false,
          available: false,
          version: null,
          service: null,
          error: error instanceof Error ? error.message : String(error),
        }
      }

      const lettaHealth = await probeLettaHealth(config, 30_000)
      const lettaService = await publicLettaServiceState(config)

      const selectedHealth =
        config.engine === "letta" ? lettaHealth : opencodeHealth

      return textResult({
        ok: selectedHealth.available === true,
        engine: config.engine,
        defaultEngine: config.engine,
        defaultModel: config.defaultModel,
        lettaNewAgentModel: config.lettaNewAgentModel,
        lettaServerUrl:
          config.lettaServerUrl || DEFAULT_LETTA_SERVER_URL,
        lettaServerCwd: config.lettaServerCwd ?? null,
        lettaNodeBinary: config.lettaNodeBinary ?? null,
        lettaAutoStart: config.lettaAutoStart !== false,
        lettaService,
        engines: {
          opencode: opencodeHealth,
          letta: lettaHealth,
        },
        stateVersion: state.version,
        projectsRegistry: PROJECTS_PATH,
        stateFile: STATE_PATH,
        operationsFile: OPERATIONS_PATH,
        migrationSources: {
          opencode: POC_BINDINGS_PATH,
          letta: LETTA_POC_STATE_PATH,
        },
      })
    }

    if (action === "configure") {
      if (
        !engine &&
        !default_model?.trim() &&
        !letta_server_url?.trim() &&
        !letta_server_cwd?.trim() &&
        !letta_node_binary?.trim() &&
        letta_autostart === undefined &&
        !letta_new_agent_model?.trim() &&
        compact_results === undefined &&
        max_result_chars === undefined &&
        status_operation_limit === undefined &&
        auto_compact === undefined &&
        auto_compact_turns === undefined
      ) {
        throw new Error("CONFIG_UPDATE_REQUIRED")
      }
      const next: RuntimeConfig = {
        ...config,
        ...(engine ? { engine } : {}),
        ...(default_model?.trim()
          ? { defaultModel: default_model.trim() }
          : {}),
        ...(letta_server_url?.trim()
          ? { lettaServerUrl: letta_server_url.trim() }
          : {}),
        ...(letta_server_cwd?.trim()
          ? { lettaServerCwd: letta_server_cwd.trim() }
          : {}),
        ...(letta_node_binary?.trim()
          ? { lettaNodeBinary: letta_node_binary.trim() }
          : {}),
        ...(letta_autostart !== undefined
          ? { lettaAutoStart: letta_autostart }
          : {}),
        ...(letta_new_agent_model?.trim()
          ? { lettaNewAgentModel: letta_new_agent_model.trim() }
          : {}),
        ...(compact_results !== undefined
          ? { compactResults: compact_results }
          : {}),
        ...(max_result_chars !== undefined
          ? { maxResultChars: max_result_chars }
          : {}),
        ...(status_operation_limit !== undefined
          ? { statusOperationLimit: status_operation_limit }
          : {}),
        ...(auto_compact !== undefined
          ? { autoCompactEnabled: auto_compact }
          : {}),
        ...(auto_compact_turns !== undefined
          ? { autoCompactTurns: auto_compact_turns }
          : {}),
      }
      await writeJsonFile(CONFIG_PATH, next)
      return textResult({ ok: true, config: next })
    }

    if (!project_id) {
      throw new Error("PROJECT_ID_REQUIRED")
    }

    const project = await getProject(project_id)
    const state = await ensureState()
    const projectState = ensureProjectState(state, project.id)

    if (action !== "run" && (reasoning_effort !== undefined || task_complexity !== undefined)) throw new Error("MODEL_SELECTION_RUN_ONLY")
    if (["session_new", "compact"].includes(action)) assertLettaModelSelection(model)

    if (action === "session_new") {
      const name = session_name || "main"
      validateSessionName(name)

      const existing = projectState.sessions[name]
      if (existing && !existing.archived) {
        throw new Error(`SESSION_ALREADY_EXISTS: ${name}`)
      }

      const selectedEngine: RuntimeEngine = "letta"
      const timestamp = now()
      const created: RuntimeSession = {
        name,
        engine: selectedEngine,
        model:
          model || defaultModelForEngine(selectedEngine, config),
        archived: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      projectState.sessions[name] = created
      projectState.activeSession = name
      await saveState(state)

      return textResult({
        ok: true,
        projectId: project.id,
        activeSession: name,
        session: publicSession(created, true),
      })
    }

    if (action === "session_switch") {
      if (!session_name) throw new Error("SESSION_NAME_REQUIRED")
      const target = projectState.sessions[session_name]
      if (!target) throw new Error(`SESSION_NOT_FOUND: ${session_name}`)
      if (target.archived) throw new Error(`SESSION_ARCHIVED: ${session_name}`)
      if (target.engine !== "letta") throw new Error("OPENCODE_ENGINE_RETIRED: legacy session is read-only")
      projectState.activeSession = target.name
      target.updatedAt = now()
      await saveState(state)

      return textResult({
        ok: true,
        projectId: project.id,
        activeSession: target.name,
        session: publicSession(target, true),
      })
    }

    if (action === "session_archive") {
      const name = session_name || projectState.activeSession
      if (!name) throw new Error("NO_ACTIVE_SESSION")
      const target = projectState.sessions[name]
      if (!target) throw new Error(`SESSION_NOT_FOUND: ${name}`)

      const operations = await readOperations()
      const running = Object.values(operations).find(
        (item) =>
          item.projectId === project.id &&
          item.sessionName === name &&
          item.state === "running" &&
          isProcessRunning(item.pid),
      )
      if (running) {
        throw new Error(`SESSION_HAS_RUNNING_OPERATION: ${running.id}`)
      }

      target.archived = true
      target.updatedAt = now()
      if (projectState.activeSession === name) {
        projectState.activeSession =
          Object.values(projectState.sessions).find(
            (item) => !item.archived && item.name !== name,
          )?.name ?? null
      }
      await saveState(state)

      return textResult({
        ok: true,
        projectId: project.id,
        archivedSession: name,
        activeSession: projectState.activeSession,
      })
    }

    if (action === "session_list") {
      const sessions = Object.values(projectState.sessions)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((item) =>
          publicSession(item, item.name === projectState.activeSession),
        )

      return textResult({
        ok: true,
        projectId: project.id,
        activeSession: projectState.activeSession,
        lettaAgentId: projectState.lettaAgentId ?? null,
        sessions,
      })
    }

    if (action === "status") {
      const fullDetail = detail === "full" || config.compactResults === false
      const operationLimit = fullDetail
        ? 20
        : config.statusOperationLimit ?? DEFAULT_STATUS_OPERATION_LIMIT
      const operations = Object.values(await readOperations())
        .filter((item) => item.projectId === project.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, operationLimit)
        .map((item) => ({
          id: item.id,
          engine: item.engine || "opencode",
          sessionName: item.sessionName,
          sessionId: item.sessionId ?? null,
          model: item.model,
          state:
            item.state === "running" && !isProcessRunning(item.pid)
              ? "stopped"
              : item.state,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        }))

      const sessions = Object.values(projectState.sessions)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((item) =>
          publicSession(item, item.name === projectState.activeSession),
        )

      if (!fullDetail) {
        const activeSession = projectState.activeSession
          ? projectState.sessions[projectState.activeSession]
          : undefined
        const lettaService = await publicLettaServiceState(config)
        let lettaSummary: Record<string, unknown> = {
          available: null,
          protocolCompatible: null,
        }
        if (activeSession?.engine === "letta") {
          const activeLocalRuns = Object.values(await readOperations()).some(
            (item) => item.state === "running" && isProcessRunning(item.pid),
          )
          if (config.lettaAutoStart !== false &&
              lettaService.running === false && !activeLocalRuns) {
            // On-demand service stopped without work is not an outage.
            lettaSummary = {
              available: null,
              serviceState: "idle_on_demand",
              protocolCompatible: null,
              error: null,
            }
          } else {
            const health = await probeLettaHealth(config, 5_000)
            lettaSummary = {
              available: health.available === true,
              serviceState: health.available === true ? "ready" : "unavailable",
              lettaCodeVersion: health.lettaCodeVersion ?? null,
              protocolCompatible: health.protocolCompatible ?? null,
              error: health.error ?? null,
            }
          }
        }

        return textResult({
          ok: true,
          project: { id: project.id, name: project.name },
          defaultEngine: config.engine,
          activeSession: projectState.activeSession,
          activeSessionState: activeSession
            ? publicSession(activeSession, true)
            : null,
          sessionCount: sessions.length,
          lettaAgentId: projectState.lettaAgentId ?? null,
          recentOperations: operations,
          engineHealth: { letta: lettaSummary },
          lettaService: {
            managed: lettaService.managed,
            running: lettaService.running,
            configMatches: lettaService.configMatches,
          },
          phase4: {
            compactResults: config.compactResults !== false,
            maxResultChars:
              config.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS,
            statusOperationLimit:
              config.statusOperationLimit ?? DEFAULT_STATUS_OPERATION_LIMIT,
            autoCompactEnabled: config.autoCompactEnabled !== false,
            autoCompactTurns:
              config.autoCompactTurns ?? DEFAULT_AUTO_COMPACT_TURNS,
          },
        })
      }

      let engineSessions: Array<Record<string, unknown>> = []
      let opencodeHealth: Record<string, unknown> = {
        available: false,
        error: null,
      }
      if (project.permissions?.read && project.permissions?.shell) {
        try {
          const service = await ensureService()
          engineSessions = await listOpenCodeSessions(project)
          opencodeHealth = { available: true, service, error: null }
        } catch (error) {
          opencodeHealth = {
            available: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      } else {
        opencodeHealth = {
          available: false,
          error: "PROJECT_PERMISSION_DENIED: read+shell required for OpenCode",
        }
      }

      const lettaHealth = await probeLettaHealth(config, 30_000)
      const lettaService = await publicLettaServiceState(config)

      return textResult({
        ok: true,
        project: {
          id: project.id,
          name: project.name,
          path: project.path,
          permissions: project.permissions,
        },
        engine: config.engine,
        defaultEngine: config.engine,
        activeSession: projectState.activeSession,
        lettaAgentId: projectState.lettaAgentId ?? null,
        sessions,
        operations,
        engineHealth: {
          opencode: opencodeHealth,
          letta: lettaHealth,
        },
        lettaService,
        service: opencodeHealth.service ?? null,
        engineSessions: engineSessions.slice(0, 30),
      })
    }

    if (action === "poll") {
      return textResult(
        await pollOperation(project, operation_id, detail || "compact"),
      )
    }

    if (action === "cancel") {
      if (!operation_id) throw new Error("OPERATION_ID_REQUIRED")
      return textResult(await cancelOperation(project, operation_id))
    }

    if (action === "compact") {
      const session = resolveSession(
        projectState,
        session_name,
        engine,
        model,
        config,
      )
      if (session.engine !== "letta") throw new Error("OPENCODE_ENGINE_RETIRED: legacy compact is disabled")
      const compactResult = await compactSessionInPlace({
        project,
        projectState,
        session,
        config,
        timeoutMs: timeout_ms ?? 180_000,
        reason: "manual",
      })
      await saveState(state)

      return textResult({
        ok: true,
        engine: session.engine,
        projectId: project.id,
        sessionName: session.name,
        lastCompactedAt: session.lastCompactedAt,
        ...compactResult,
      })
    }
    if (action === "run") {
      if (!prompt?.trim()) throw new Error("PROMPT_REQUIRED")
      const taskRef = normalizeTaskRef(task_ref)
      const contextPaths = normalizeContextPaths(context_paths)
      const modelSelection = planModelSelection({ model, reasoningEffort: reasoning_effort, taskComplexity: task_complexity })

      const session = resolveSession(
        projectState,
        session_name,
        engine,
        DEFAULT_LETTA_MODEL,
        config,
      )
      if (session.engine === "opencode") {
        throw new Error("OPENCODE_ENGINE_RETIRED: select a Letta session with authorized project routing")
      }

      if (
        session.lastOperationId &&
        session.lastOperationId !== session.lastPolledOperationId
      ) {
        const operations = await readOperations()
        const pending = operations[session.lastOperationId]
        if (pending) {
          throw new Error(
            `OPERATION_RESULT_PENDING: poll ${pending.id} before starting the next turn for session ${session.name}`,
          )
        }
        session.lastPolledOperationId = session.lastOperationId
      }

      let autoCompaction: Record<string, unknown> | null = null
      const autoCompactTurns =
        config.autoCompactTurns ?? DEFAULT_AUTO_COMPACT_TURNS
      if (
        session.engine === "letta" &&
        session.sessionId &&
        config.autoCompactEnabled !== false &&
        (session.turnsSinceCompaction ?? 0) >= autoCompactTurns
      ) {
        autoCompaction = await compactSessionInPlace({
          project,
          projectState,
          session,
          config,
          timeoutMs: timeout_ms ?? 180_000,
          reason: "auto",
        })
        await saveState(state)
      }

      const runtimePrompt = prompt.trim()

      const chosenModel =
        session.engine === "opencode"
          ? model || session.model || config.defaultModel
          : DEFAULT_LETTA_MODEL
      const operation =
        session.engine === "letta"
          ? await dispatchLettaRun({
              project,
              projectState,
              session,
              prompt: runtimePrompt,
              config,
              timeoutMs: timeout_ms ?? 300_000,
              taskRef,
              modelSelection,
              contextPaths,
            })
          : await dispatchOpenCodeRun({
              project,
              session,
              prompt: runtimePrompt,
              model: chosenModel,
              auto: Boolean(auto),
            })

      // Commit the cursor from fresh persisted state. Concurrent operations in
      // different sessions must not overwrite each other's progress.
      await withSessionStateLock(async () => {
        const latestState = await ensureState()
        const latestProject = ensureProjectState(latestState, project.id)
        const latestSession = ensureSession(
          latestProject, session.name, session.engine, chosenModel,
        )
        latestSession.model = chosenModel
        latestSession.lastOperationId = operation.id
        latestSession.updatedAt = now()
        latestProject.activeSession = latestSession.name
        await saveState(latestState)
      })
      session.model = chosenModel
      session.lastOperationId = operation.id

      return textResult({
        ok: true,
        accepted: true,
        engine: session.engine,
        projectId: project.id,
        sessionName: session.name,
        sessionId: session.sessionId ?? null,
        resumed: Boolean(session.sessionId),
        autoCompacted: autoCompaction !== null,
        autoCompaction,
        operationId: operation.id,
        model: chosenModel,
        modelSelection: publicModelSelection(operation.modelSelection),
        contextPaths: operation.contextPaths ?? [],
        state: operation.state,
        ...describeOperationOutcome({ state: operation.state, taskRef: operation.taskRef }),
        note: "Work is running asynchronously. Call action=poll with project_id and operation_id.",
      })
    }

    throw new Error(`UNSUPPORTED_ACTION: ${action}`)
    })
  },
})
