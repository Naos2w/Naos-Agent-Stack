import { describeToolResult, observeWriteTarget, describeFileEffect, summarizeToolEvidence } from "./tool_evidence.mjs"
import { withRuntimeActivity } from "./runtime_maintenance.mjs"
import { promises as fs } from "node:fs"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  executeSideEffectOnce,
  isSideEffectingExternalTool,
} from "./external_tool_idempotency.ts"
import {
  PROJECT_EXECUTOR_API_VERSION,
  SHELL_POLICY_VERSION,
  decideProjectToolApproval,
  executeProjectTool,
  getProject as getProjectFromExecutor,
  isProjectToolName,
  projectToolDefinitions,
  type ProjectRecord,
} from "./project_executor.ts"
import {
  capabilityToolDefinitions,
  executeCapabilityTool,
  isCapabilityTool,
  validateCapabilityApproval,
} from "./agent_capabilities.ts"
import { describeOperationOutcome, prepareWorkerRunContext, describeModelConfiguration, publicTokenUsage } from "./runtime_contract.ts"

import { planModelSelection, applyConversationModelSelection } from "./model_routing.mjs"
import { assertRemoteStateIdle } from "./operation_invariants.ts"

const SERVER_URL =
  process.env.LETTA_APP_SERVER_URL?.trim() || "ws://127.0.0.1:4500"
const SUPPORTED_PROTOCOL_VERSION = 1
const REQUEST_TIMEOUT_MS = 30_000
const TURN_TIMEOUT_MS = 180_000
const MAX_RESULT_CHARS = 12_000
const SESSION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

type ConversationBinding = {
  name: string
  conversationId: string
  archived: boolean
  createdAt: string
  updatedAt: string
  lastCompactedAt?: string
}

type ProjectBinding = {
  agentId: string
  activeConversation: string | null
  conversations: Record<string, ConversationBinding>
  createdAt: string
  updatedAt: string
}

type PendingRequest = {
  resolve: (message: Record<string, unknown>) => void
  reject: (error: Error) => void
  predicate: (message: Record<string, unknown>) => boolean
  timer: ReturnType<typeof setTimeout>
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>
  is_error?: boolean
}

function now() {
  return new Date().toISOString()
}

async function getProject(projectId: string): Promise<ProjectRecord> {
  return getProjectFromExecutor(projectId)
}

function validateSessionName(name: string) {
  if (!SESSION_NAME_PATTERN.test(name)) {
    throw new Error(
      "SESSION_NAME_INVALID: use 1-64 characters [A-Za-z0-9._-], starting with an alphanumeric character",
    )
  }
}

function truncate(value: string, max = MAX_RESULT_CHARS) {
  if (value.length <= max) return { text: value, truncated: false }
  return {
    text: `${value.slice(0, max)}\n…[truncated]`,
    truncated: true,
  }
}

function validateMemoryPath(input: string) {
  const normalized = input.replaceAll("\\", "/").trim()
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((part) => part === "..")
  ) {
    throw new Error(`MEMORY_PATH_INVALID: ${input}`)
  }
  return normalized
}

function externalToolDefinitions(project: ProjectRecord) {
  const memoryTools: Array<Record<string, unknown>> = [
    {
      name: "openchatx_memory_read",
      label: "OpenChatX Memory Read",
      description:
        "Read UTF-8 durable memory for this Letta Agent only. Paths are relative to the Agent MemFS root. Use durable memory for decisions and working context, never as a replacement for authoritative project files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          max_chars: {
            type: "integer",
            minimum: 1,
            maximum: 50000,
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
      timeout_ms: 30_000,
      auto_background: false,
    },
    {
      name: "openchatx_memory_write",
      label: "OpenChatX Memory Write",
      description:
        "Write and commit UTF-8 durable memory for this Letta Agent only. Paths are relative to the Agent MemFS root. Root MEMORY.md is a frontmatter-free index; every other memory Markdown file must start with YAML frontmatter containing exactly non-empty name and description fields. Prefer projects.md for durable project decisions; project files remain the source of truth.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          commit_message: { type: "string" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
      timeout_ms: 30_000,
      auto_background: false,
    },
  ]

  return [...projectToolDefinitions(project), ...memoryTools, ...capabilityToolDefinitions(project)]
}

async function executeExternalTool(
  client: LettaSocket,
  project: ProjectRecord,
  agentId: string,
  toolName: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    if (isProjectToolName(toolName)) {
      return executeProjectTool(project, toolName, input)
    }
    if (isCapabilityTool(toolName)) {
      return executeCapabilityTool(project, toolName, input)
    }

    if (toolName === "openchatx_memory_read") {
      const requested = validateMemoryPath(String(input.path ?? ""))
      const maxChars = Math.min(
        Math.max(Number(input.max_chars ?? 20000), 1),
        50000,
      )
      const response = await client.request(
        {
          type: "read_memory_file",
          request_id: client.nextRequestId("memory-read"),
          agent_id: agentId,
          path: requested,
          encoding: "utf8",
        },
        "read_memory_file_response",
      )
      requireSuccess(response, "LETTA_MEMORY_READ_FAILED")
      const content =
        typeof response.content === "string" ? response.content : ""
      const clipped = truncate(content, maxChars)
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                path: requested,
                content: clipped.text,
                truncated: clipped.truncated,
              },
              null,
              2,
            ),
          },
        ],
      }
    }

    if (toolName === "openchatx_memory_write") {
      const requested = validateMemoryPath(String(input.path ?? ""))
      const content = String(input.content ?? "")
      if (content.length > 100_000) {
        throw new Error("MEMORY_CONTENT_TOO_LARGE")
      }
      const commitMessage =
        typeof input.commit_message === "string" &&
        input.commit_message.trim()
          ? input.commit_message.trim().slice(0, 200)
          : "memory: update via OpenChatX"
      const response = await client.request(
        {
          type: "write_memory_file",
          request_id: client.nextRequestId("memory-write"),
          agent_id: agentId,
          path: requested,
          content,
          encoding: "utf8",
          commit_message: commitMessage,
        },
        "write_memory_file_response",
      )
      requireSuccess(response, "LETTA_MEMORY_WRITE_FAILED")
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                path: requested,
                committed: response.committed === true,
                commit_sha:
                  typeof response.commit_sha === "string"
                    ? response.commit_sha
                    : null,
                chars_written: content.length,
              },
              null,
              2,
            ),
          },
        ],
      }
    }

    throw new Error(`EXTERNAL_TOOL_UNKNOWN: ${toolName}`)
  } catch (error) {
    return {
      is_error: true,
      content: [
        {
          type: "text",
          text: error instanceof Error ? error.message : String(error),
        },
      ],
    }
  }
}

async function decideExternalToolApproval(
  project: ProjectRecord,
  toolName: string,
  input: Record<string, unknown>,
) {
  if (isProjectToolName(toolName)) {
    return decideProjectToolApproval(project, toolName, input)
  }
  if (isCapabilityTool(toolName)) {
    try {
      validateCapabilityApproval(project, toolName, input)
      return {
        behavior: "allow" as const,
        message: "Approved read-only project capability",
        updated_input: null,
        selected_permission_suggestion_ids: [] as string[],
      }
    } catch (error) {
      return { behavior: "deny" as const, message: String(error instanceof Error ? error.message : error) }
    }
  }

  try {
    if (toolName === "openchatx_memory_read") {
      validateMemoryPath(String(input.path ?? ""))
    } else if (toolName === "openchatx_memory_write") {
      validateMemoryPath(String(input.path ?? ""))
      const content = String(input.content ?? "")
      if (content.length > 100_000) {
        throw new Error("MEMORY_CONTENT_TOO_LARGE")
      }
    } else {
      throw new Error(`EXTERNAL_TOOL_UNKNOWN: ${toolName}`)
    }

    return {
      behavior: "allow" as const,
      message: "Approved durable memory tool for Letta Agent",
      updated_input: null,
      selected_permission_suggestion_ids: [] as string[],
    }
  } catch (error) {
    return {
      behavior: "deny" as const,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

function registerApprovalHandler(
  client: LettaSocket,
  project: ProjectRecord,
  decisions: Array<Record<string, unknown>>,
) {
  const cache = new Map<string, Record<string, unknown>>()

  return client.onMessage(async (message) => {
    if (message.type !== "control_request") return
    const request =
      message.request && typeof message.request === "object"
        ? (message.request as Record<string, unknown>)
        : null
    if (!request || request.subtype !== "can_use_tool") return

    const requestId =
      typeof message.request_id === "string" ? message.request_id : ""
    const runtime =
      message.runtime && typeof message.runtime === "object"
        ? (message.runtime as Record<string, unknown>)
        : typeof message.agent_id === "string" &&
            typeof message.conversation_id === "string"
          ? {
              agent_id: message.agent_id,
              conversation_id: message.conversation_id,
            }
          : null
    if (!requestId || !runtime) return

    const toolName =
      typeof request.tool_name === "string" ? request.tool_name : "unknown"
    const input =
      request.input && typeof request.input === "object"
        ? (request.input as Record<string, unknown>)
        : {}

    let decision = cache.get(requestId)
    if (!decision) {
      decision = await decideExternalToolApproval(project, toolName, input)

      if (decision.behavior === "allow") {
        const registration = await client.request(
          {
            type: "runtime_external_tools_update",
            request_id: client.nextRequestId("external-tools-rebind"),
            updates: [
              {
                runtimes: [runtime],
                external_tools: [
                  {
                    tools: externalToolDefinitions(project),
                  },
                ],
              },
            ],
          },
          "runtime_external_tools_update_response",
        )

        if (registration.success !== true) {
          decision = {
            behavior: "deny",
            message:
              typeof registration.error === "string"
                ? `External tool controller rebind failed: ${registration.error}`
                : "External tool controller rebind failed",
          }
        }
      }

      cache.set(requestId, decision)
      decisions.push({
        requestId,
        toolName,
        input,
        decision,
      })
    }

    client.send({
      type: "input",
      runtime,
      payload: {
        kind: "approval_response",
        request_id: requestId,
        decision,
      },
    })
  })
}

class LettaSocket {
  private socket: any
  private pending = new Map<string, PendingRequest>()
  private handlers = new Set<
    (message: Record<string, unknown>) => void | Promise<void>
  >()
  private requestCounter = 0
  private closed = false
  private readonly url: string

  constructor(url: string) {
    this.url = url
    const WebSocketCtor = (globalThis as any).WebSocket
    if (typeof WebSocketCtor !== "function") {
      throw new Error("WEBSOCKET_UNAVAILABLE: Node 22+ global WebSocket required")
    }
    this.socket = new WebSocketCtor(url)
    this.socket.addEventListener("message", (event: any) => {
      void this.handleData(event.data)
    })
    this.socket.addEventListener("close", () => {
      if (!this.closed) {
        this.rejectAll(new Error("LETTA_SOCKET_CLOSED"))
      }
    })
  }

  async connect(timeoutMs = 5000) {
    if (this.socket.readyState === 1) return
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        rejectPromise(new Error(`LETTA_CONNECT_TIMEOUT: ${this.url}`))
      }, timeoutMs)
      const onOpen = () => {
        clearTimeout(timer)
        resolvePromise()
      }
      const onError = () => {
        clearTimeout(timer)
        rejectPromise(new Error(`LETTA_CONNECT_FAILED: ${this.url}`))
      }
      this.socket.addEventListener("open", onOpen, { once: true })
      this.socket.addEventListener("error", onError, { once: true })
    })
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.rejectAll(new Error("LETTA_SOCKET_CLOSED"))
    try {
      this.socket.close()
    } catch {
      // Best effort.
    }
  }

  nextRequestId(prefix = "openchatx") {
    this.requestCounter += 1
    return `${prefix}-${Date.now()}-${this.requestCounter}`
  }

  onMessage(handler: (message: Record<string, unknown>) => void | Promise<void>) {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  send(command: Record<string, unknown>) {
    if (this.socket.readyState !== 1) {
      throw new Error("LETTA_SOCKET_NOT_OPEN")
    }
    this.socket.send(JSON.stringify(command))
  }

  request(
    command: Record<string, unknown>,
    expectedType: string,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ) {
    const requestId =
      typeof command.request_id === "string"
        ? command.request_id
        : this.nextRequestId(String(command.type ?? "request"))
    const payload = { ...command, request_id: requestId }

    return new Promise<Record<string, unknown>>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        rejectPromise(
          new Error(`LETTA_REQUEST_TIMEOUT: ${String(command.type)}`),
        )
      }, timeoutMs)

      this.pending.set(requestId, {
        resolve: resolvePromise,
        reject: rejectPromise,
        predicate: (message) =>
          message.type === expectedType &&
          message.request_id === requestId,
        timer,
      })

      try {
        this.send(payload)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(requestId)
        rejectPromise(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  waitFor(
    predicate: (message: Record<string, unknown>) => boolean,
    timeoutMs: number,
    signal?: AbortSignal,
  ) {
    return new Promise<Record<string, unknown>>((resolvePromise, rejectPromise) => {
      const cleanup = () => {
        clearTimeout(timer)
        remove()
        signal?.removeEventListener("abort", onAbort)
      }
      const onAbort = () => {
        cleanup()
        rejectPromise(new Error("LETTA_EVENT_CANCELLED"))
      }
      const remove = this.onMessage((message) => {
        if (!predicate(message)) return
        cleanup()
        resolvePromise(message)
      })
      const timer = setTimeout(() => {
        cleanup()
        rejectPromise(new Error("LETTA_EVENT_TIMEOUT"))
      }, timeoutMs)
      if (signal) {
        if (signal.aborted) {
          onAbort()
        } else {
          signal.addEventListener("abort", onAbort, { once: true })
        }
      }
    })
  }

  private async handleData(data: unknown) {
    try {
      let text: string
      if (typeof data === "string") {
        text = data
      } else if (data instanceof ArrayBuffer) {
        text = new TextDecoder().decode(data)
      } else if (ArrayBuffer.isView(data)) {
        text = new TextDecoder().decode(data as ArrayBufferView<ArrayBuffer>)
      } else if (
        data &&
        typeof (data as { text?: () => Promise<string> }).text === "function"
      ) {
        text = await (data as { text: () => Promise<string> }).text()
      } else {
        text = String(data)
      }

      const message = JSON.parse(text) as Record<string, unknown>
      for (const handler of [...this.handlers]) {
        void Promise.resolve(handler(message))
      }

      const requestId =
        typeof message.request_id === "string" ? message.request_id : undefined
      if (!requestId) return
      const pending = this.pending.get(requestId)
      if (!pending || !pending.predicate(message)) return
      clearTimeout(pending.timer)
      this.pending.delete(requestId)
      pending.resolve(message)
    } catch {
      // Ignore malformed transport events; protocol requests still time out clearly.
    }
  }

  private rejectAll(error: Error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
      this.pending.delete(id)
    }
  }
}

async function withClient<T>(fn: (client: LettaSocket) => Promise<T>) {
  const client = new LettaSocket(SERVER_URL)
  try {
    await client.connect()
    return await fn(client)
  } finally {
    client.close()
  }
}

function requireSuccess(
  response: Record<string, unknown>,
  fallback: string,
) {
  if (response.success !== true) {
    throw new Error(
      typeof response.error === "string" ? response.error : fallback,
    )
  }
}

function runtimeMatches(
  message: Record<string, unknown>,
  runtime: Record<string, unknown>,
) {
  const messageRuntime = message.runtime
  if (!messageRuntime || typeof messageRuntime !== "object") return false
  const observed = messageRuntime as Record<string, unknown>
  // The conversation alone is not a sufficient terminal identity. Another
  // agent or runtime can use the same conversation scope; fail closed when
  // any identifier supplied by runtime_start does not match turn_finished.
  for (const field of ["conversation_id", "agent_id", "runtime_id"] as const) {
    const expected = runtime[field]
    const actual = observed[field]
    if (field === "conversation_id" || expected !== undefined) {
      if (
        typeof expected !== "string" || !expected.trim() ||
        typeof actual !== "string" || actual !== expected
      ) {
        return false
      }
    }
  }
  return true
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object") return []
      const record = part as Record<string, unknown>
      if (typeof record.text === "string") return [record.text]
      if (typeof record.content === "string") return [record.content]
      return []
    })
    .join("\n")
    .trim()
}

function latestAssistantText(messages: unknown) {
  if (!Array.isArray(messages)) return ""
  const assistants = messages.filter(
    (item): item is Record<string, unknown> =>
      Boolean(
        item &&
          typeof item === "object" &&
          (item as Record<string, unknown>).message_type ===
            "assistant_message",
      ),
  )
  assistants.sort((a, b) => {
    const aSeq = typeof a.seq_id === "number" ? a.seq_id : -1
    const bSeq = typeof b.seq_id === "number" ? b.seq_id : -1
    if (aSeq !== bSeq) return aSeq - bSeq
    return String(a.date ?? "").localeCompare(String(b.date ?? ""))
  })
  return contentText(assistants.at(-1)?.content)
}

async function registerExternalToolHandler(
  client: LettaSocket,
  project: ProjectRecord,
  agentId: string,
  calls: Array<Record<string, unknown>>,
) {
  return client.onMessage(async (message) => {
    if (message.type !== "external_tool_call_request") return
    const requestId =
      typeof message.request_id === "string" ? message.request_id : ""
    const toolName =
      typeof message.tool_name === "string" ? message.tool_name : ""
    const input =
      message.input && typeof message.input === "object"
        ? (message.input as Record<string, unknown>)
        : {}
    const runtime =
      message.runtime && typeof message.runtime === "object"
        ? (message.runtime as Record<string, unknown>)
        : null
    const conversationId =
      typeof runtime?.conversation_id === "string"
        ? runtime.conversation_id
        : typeof message.conversation_id === "string"
          ? message.conversation_id
          : "unknown"
    const toolCallId =
      typeof message.tool_call_id === "string" && message.tool_call_id.trim()
        ? message.tool_call_id.trim()
        : requestId

    const toolStartMs = Date.now()
    let result: ToolResult
    let replayed = false
    let idempotencyStatus = "not_applicable"
    let fileEffect: Record<string, unknown> | undefined
    const executeObserved = async () => {
      const before = toolName === "openchatx_write_file"
        ? await observeWriteTarget(project, input, decideProjectToolApproval) : null
      const output = await executeExternalTool(client, project, agentId, toolName, input)
      if (toolName === "openchatx_write_file") {
        const after = await observeWriteTarget(project, input, decideProjectToolApproval)
        fileEffect = describeFileEffect(before, after)
      }
      return output
    }

    try {
    if (isSideEffectingExternalTool(toolName)) {
      if (!toolCallId) {
        result = {
          is_error: true,
          content: [
            {
              type: "text",
              text: "EXTERNAL_TOOL_IDEMPOTENCY_KEY_MISSING: side-effecting tool calls require tool_call_id or request_id",
            },
          ],
        }
        idempotencyStatus = "missing_key"
      } else {
        const guarded = await executeSideEffectOnce({
          projectId: project.id,
          conversationId,
          toolCallId,
          toolName,
          input,
          execute: executeObserved,
        })
        result = guarded.result
        replayed = guarded.replayed
        idempotencyStatus = guarded.status
      }
    } else {
      result = await executeObserved()
    }
    } catch {
      // A ledger/dispatch exception may follow a side effect. Preserve unknown
      // settlement, return a bounded error, and never execute it again here.
      if (isSideEffectingExternalTool(toolName)) idempotencyStatus = "uncertain"
      result = { is_error: true, content: [{ type: "text", text: "EXTERNAL_TOOL_DISPATCH_FAILED: inspect execution and ledger state before retrying" }] }
    }

    calls.push({
      toolCallId: toolCallId || null,
      toolName,
      input,
      replayed,
      idempotencyStatus,
      durationMs: Date.now() - toolStartMs,
      toolResult: describeToolResult(toolName, result),
      fileEffect,
    })

    client.send({
      type: "external_tool_call_response",
      request_id: requestId,
      result,
    })
  })
}

function runtimeStartCommand(
  client: LettaSocket,
  project: ProjectRecord,
  agentId: string,
  conversationId?: string,
  newConversationName?: string,
) {
  const command: Record<string, unknown> = {
    type: "runtime_start",
    request_id: client.nextRequestId("runtime-start"),
    agent_id: agentId,
    cwd: project.path,
    mode: "strict",
    recover_approvals: true,
    force_device_status: true,
    wait_for_replay: true,
    client_info: {
      name: "openchatx-letta-runtime",
      title: "OpenChatX Letta Runtime",
      version: "phase2-poc",
    },
    external_tools: [
      {
        tools: externalToolDefinitions(project),
      },
    ],
  }

  if (conversationId) {
    command.conversation_id = conversationId
  } else {
    command.create_conversation = {
      body: newConversationName ? { name: newConversationName } : {},
    }
  }

  return command
}

async function createConversation(
  project: ProjectRecord,
  binding: ProjectBinding,
  sessionName: string,
) {
  validateSessionName(sessionName)
  const existing = binding.conversations[sessionName]
  if (existing && !existing.archived) {
    throw new Error(`SESSION_ALREADY_EXISTS: ${sessionName}`)
  }

  const response = await withClient(async (client) => {
    return client.request(
      runtimeStartCommand(
        client,
        project,
        binding.agentId,
        undefined,
        sessionName,
      ),
      "runtime_start_response",
      TURN_TIMEOUT_MS,
    )
  })
  requireSuccess(response, "LETTA_RUNTIME_START_FAILED")

  const runtime =
    response.runtime && typeof response.runtime === "object"
      ? (response.runtime as Record<string, unknown>)
      : null
  const conversationId =
    typeof runtime?.conversation_id === "string"
      ? runtime.conversation_id
      : response.conversation &&
          typeof response.conversation === "object" &&
          typeof (response.conversation as Record<string, unknown>).id ===
            "string"
        ? String((response.conversation as Record<string, unknown>).id)
        : ""

  if (!conversationId) {
    throw new Error("LETTA_CONVERSATION_ID_MISSING")
  }

  const timestamp = now()
  const created: ConversationBinding = {
    name: sessionName,
    conversationId,
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  binding.conversations[sessionName] = created
  binding.activeConversation = sessionName
  binding.updatedAt = timestamp
  return created
}

async function runTurn(
  project: ProjectRecord,
  binding: ProjectBinding,
  conversation: ConversationBinding,
  prompt: string,
  timeoutMs: number,
  requestMessageId?: string,
  modelSelection = planModelSelection({ model: "letta/agent-config" }),
) {
  return withClient(async (client) => {
    const externalCalls: Array<Record<string, unknown>> = []
    const approvalDecisions: Array<Record<string, unknown>> = []
    registerExternalToolHandler(
      client,
      project,
      binding.agentId,
      externalCalls,
    )
    registerApprovalHandler(client, project, approvalDecisions)

    const start = await client.request(
      runtimeStartCommand(
        client,
        project,
        binding.agentId,
        conversation.conversationId,
      ),
      "runtime_start_response",
      timeoutMs,
    )
    requireSuccess(start, "LETTA_RUNTIME_START_FAILED")

    const runtime =
      start.runtime && typeof start.runtime === "object"
        ? (start.runtime as Record<string, unknown>)
        : null
    if (!runtime) throw new Error("LETTA_RUNTIME_SCOPE_MISSING")
    const selectedModel = await applyConversationModelSelection(client, runtime, modelSelection, async () => {
      const remote = await workerInspect({ action: "inspect", agentId: binding.agentId, conversationId: conversation.conversationId })
      assertRemoteStateIdle(remote)
    })
    const clientMessageId = requestMessageId || client.nextRequestId("user-message")

    // Timeout-only, content-free trace. Do not retain prompts, event payloads,
    // account data, tool arguments or credentials in failure diagnostics.
    const turnWaitStartMs = Date.now()
    let lastProgressMs = turnWaitStartMs
    let lastProgressType = "none"
    let externalRequests = 0
    let unmatchedFinishEvents = 0
    let lastToolCategory: "project_tool" | "memory_tool" | "capability_tool" | "unrecognized" | null = null
    const removeProgressListener = client.onMessage((message) => {
      const type = typeof message.type === "string" ? message.type : ""
      if (
        type === "external_tool_call_request" ||
        type === "control_request" ||
        type === "input_accepted" ||
        type === "turn_finished"
      ) {
        lastProgressType = type
        lastProgressMs = Date.now()
      }
      if (type === "external_tool_call_request") {
        externalRequests += 1
        const name = typeof message.tool_name === "string" ? message.tool_name : ""
        // Never put any provider-controlled tool_name into stderr, even if it
        // happens to match a safe-looking regex (e.g. account_123456).
        lastToolCategory =
          name === "openchatx_memory_read" || name === "openchatx_memory_write"
            ? "memory_tool"
            : isProjectToolName(name)
              ? "project_tool"
              : isCapabilityTool(name)
                ? "capability_tool"
                : "unrecognized"
      }
      if (type === "turn_finished" && !runtimeMatches(message, runtime)) {
        unmatchedFinishEvents += 1
      }
    })

    try {
    const terminalAbortController = new AbortController()
    // Attach both outcomes immediately: input rejection / RPC failure must
    // never leave a pending terminal promise to reject unhandled later.
    const finishedOutcome = client.waitFor(
      (message) =>
        message.type === "turn_finished" &&
        runtimeMatches(message, runtime),
      timeoutMs,
      terminalAbortController.signal,
    ).then(
      (message) => ({ ok: true as const, message }),
      (error: unknown) => ({
        ok: false as const,
        error: error instanceof Error ? error : new Error(String(error)),
      }),
    )

    try {
      const accepted = await client.request(
      {
        type: "input",
        request_id: client.nextRequestId("input"),
        runtime,
        payload: {
          kind: "create_message",
          messages: [
            {
              role: "user",
              content: prompt,
              client_message_id: clientMessageId,
            },
          ],
          client_tool_allowlist: externalToolDefinitions(project).map(
            (tool) => String(tool.name),
          ),
          exclude_interactive_tools: true,
        },
      },
      "input_accepted",
      timeoutMs,
    )

      if (accepted.accepted !== true) {
        throw new Error(
          typeof accepted.error === "string"
            ? accepted.error
            : "LETTA_INPUT_REJECTED",
        )
      }
    } catch (error) {
      // All early exits cancel the terminal timer + listener. Its rejection
      // was already consumed by finishedOutcome, so no orphaned rejection.
      terminalAbortController.abort()
      await finishedOutcome
      throw error
    }

    const outcome = await finishedOutcome
    if (!outcome.ok) {
      const error = outcome.error
      if (error instanceof Error && error.message === "LETTA_EVENT_TIMEOUT") {
        const lastCompleted = externalCalls.at(-1)
        const lastCompletedDuration = lastCompleted?.durationMs
        const diagnostic = {
          kind: "LETTA_TURN_TIMEOUT_DIAGNOSTIC",
          client_message_id: clientMessageId,
          idempotency: summarizeRunTrace({ external_tool_calls: externalCalls }).validation.idempotency,
          elapsed_ms: Date.now() - turnWaitStartMs,
          configured_timeout_ms: timeoutMs,
          last_progress_type: lastProgressType,
          last_progress_age_ms: Date.now() - lastProgressMs,
          external_requests: externalRequests,
          external_completed: externalCalls.length,
          last_tool_category: lastToolCategory,
          last_completed_tool_ms: typeof lastCompletedDuration === "number" ? lastCompletedDuration : null,
          unmatched_finish_events: unmatchedFinishEvents,
        }
        process.stderr.write(JSON.stringify(diagnostic) + "\n")
        // The local socket timing out does not end the Letta Server's run.
        // Do not interrupt a run when an external side effect may be in flight.
        let recovery: {
          status: "cancelled" | "already_idle" | "uncertain"
          runId?: string
          reason?: string
        }
        if (externalRequests !== externalCalls.length) {
          recovery = { status: "uncertain", reason: "EXTERNAL_TOOL_IN_FLIGHT" }
        } else {
          try {
            recovery = await recoverTimedOutRun(client, runtime, clientMessageId)
          } catch {
            // Preserve uncertainty instead of blindly resending the prompt.
            recovery = { status: "uncertain", reason: "REMOTE_RECOVERY_FAILED" }
          }
        }
        process.stderr.write(JSON.stringify({
          kind: "LETTA_TIMEOUT_RECOVERY",
          clientMessageId,
          conversationId: conversation.conversationId,
          status: recovery.status,
          runId: recovery.runId ?? null,
          reason: recovery.reason ?? null,
        }) + "\n")
        throw new Error(
          recovery.status === "uncertain"
            ? "LETTA_TURN_TIMEOUT_REMOTE_UNCERTAIN"
            : "LETTA_TURN_TIMEOUT_REMOTE_SETTLED",
        )
      }
      throw error
    }
    const finished = outcome.message
    if (typeof finished.error === "string" && finished.error) {
      throw new Error(`LETTA_TURN_FAILED: ${finished.error}`)
    }

    const messagesResponse = await client.request(
      {
        type: "conversation_messages_list",
        request_id: client.nextRequestId("messages"),
        conversation_id: conversation.conversationId,
        query: {
          limit: 20,
          include_err: true,
        },
      },
      "conversation_messages_list_response",
      timeoutMs,
    )
    requireSuccess(messagesResponse, "LETTA_MESSAGES_LIST_FAILED")

    const assistantText = latestAssistantText(messagesResponse.messages)
    const clipped = truncate(assistantText || "(no assistant text returned)")

    return {
      status: "completed",
      summary: clipped.text,
      output_truncated: clipped.truncated,
      stop_reason: finished.stop_reason ?? null,
      run_id: finished.run_id ?? null,
      usage: finished.usage ?? null,
      ...selectedModel,
      approval_decisions: approvalDecisions,
      approval_decision_count: approvalDecisions.length,
      external_tool_calls: externalCalls,
      external_tool_call_count: externalCalls.length,
    }
    } finally {
      // The current client is per-turn, but release this turn's diagnostic
      // observer explicitly on every success, input failure and timeout.
      removeProgressListener()
    }
  })
}

function summarizeRunTrace(result: Record<string, any>) {
  const approvals = Array.isArray(result.approval_decisions)
    ? result.approval_decisions
    : []
  const calls = Array.isArray(result.external_tool_calls)
    ? result.external_tool_calls
    : []

  const evidence = summarizeToolEvidence(calls)
  const changedFiles = evidence.changedFiles

  const denied = approvals
    .filter((item: any) => item?.decision?.behavior === "deny")
    .map((item: any) => ({
      tool: String(item?.toolName ?? "unknown"),
      reason: String(item?.decision?.message ?? "Denied"),
    }))

  const toolsUsed = [
    ...new Set(
      calls
        .map((item: any) => item?.toolName)
        .filter((item: unknown): item is string => typeof item === "string"),
    ),
  ]

  const idempotency = calls
    .filter(
      (item: any) =>
        typeof item?.idempotencyStatus === "string" &&
        item.idempotencyStatus !== "not_applicable",
    )
    .map((item: any) => ({
      tool: String(item?.toolName ?? "unknown"),
      tool_call_id:
        typeof item?.toolCallId === "string" ? item.toolCallId : null,
      status: String(item.idempotencyStatus),
      replayed: item?.replayed === true,
    }))

  return {
    changedFiles,
    validation: {
      stop_reason: result.stop_reason ?? null,
      approval_decision_count: approvals.length,
      external_tool_call_count: calls.length,
      tool_outcomes: evidence.toolOutcomes,
      file_effects: evidence.fileEffects,
      tools_used: toolsUsed,
      denied_requests: denied,
      idempotency,
      project_executor_api_version: PROJECT_EXECUTOR_API_VERSION,
      shell_policy_version: SHELL_POLICY_VERSION,
    },
    blockers: [...evidence.blockers, ...denied.map(
      (item: { tool: string; reason: string }) =>
        `${item.tool}: ${item.reason}`,
    )],
  }
}



type WorkerInput = {
  action: "probe" | "run" | "compact" | "inspect" | "cancel" | "recover-orphan"
  projectId?: string
  sessionName?: string
  agentId?: string
  conversationId?: string
  prompt?: string
  timeoutMs?: number
  clientMessageId?: string
  taskRef?: string | null
  modelSelection?: Record<string, unknown>
  contextPaths?: string[]
  runId?: string
}

export function findOwnedActiveRunId(loop: unknown, clientMessageId: string): string | null {
  if (!loop || typeof loop !== "object" || !clientMessageId) return null
  const status = loop as Record<string, unknown>
  if (!Array.isArray(status.active_run_ids) ||
      !status.client_message_ids_by_run_id ||
      typeof status.client_message_ids_by_run_id !== "object") return null
  const correlations = status.client_message_ids_by_run_id as Record<string, unknown>
  const owned = status.active_run_ids.filter((id: unknown): id is string =>
    typeof id === "string" && Array.isArray(correlations[id]) &&
    (correlations[id] as unknown[]).includes(clientMessageId),
  )
  return owned.length === 1 ? owned[0] : null
}

export async function recoverTimedOutRun(
  client: LettaSocket,
  runtime: Record<string, unknown>,
  clientMessageId: string,
  inspect: (scope: WorkerInput) => Promise<Record<string, any>> = workerInspect,
) {
  const agentId = runtime.agent_id
  const conversationId = runtime.conversation_id
  if (typeof agentId !== "string" || !agentId ||
      typeof conversationId !== "string" || !conversationId) {
    return { status: "uncertain" as const }
  }
  const scope: WorkerInput = { action: "inspect", agentId, conversationId }
  const before = await inspect(scope)
  if (before.ok !== true || !Array.isArray(before.activeRunIds)) {
    return { status: "uncertain" as const }
  }
  if (before.activeRunIds.length === 0 && before.queueLength === 0 &&
      before.status === "WAITING_ON_INPUT") {
    return { status: "already_idle" as const }
  }
  // Correlation is mandatory: never abort someone else's run or dequeue
  // someone else's message just because it shares the conversation.
  const ownedRunId = findOwnedActiveRunId({
    active_run_ids: before.activeRunIds,
    client_message_ids_by_run_id: before.clientMessageIdsByRunId,
  }, clientMessageId)
  let removedQueueItemId: string | null = null

  if (ownedRunId) {
    const response = await client.request({
      type: "abort_message",
      request_id: client.nextRequestId("timeout-abort"),
      runtime: { agent_id: agentId, conversation_id: conversationId },
      run_id: ownedRunId,
    }, "abort_message_response", 6_000)
    if (response.success !== true || response.aborted !== true) {
      return { status: "uncertain" as const, runId: ownedRunId }
    }
  } else if (before.activeRunIds.length === 0 && before.queueLength > 0) {
    const ownedQueueItems = Array.isArray(before.queuedMessages)
      ? before.queuedMessages.filter((item: any) =>
          item?.clientMessageId === clientMessageId &&
          typeof item.id === "string" && item.id.length > 0)
      : []
    if (ownedQueueItems.length !== 1) return { status: "uncertain" as const }
    removedQueueItemId = ownedQueueItems[0].id
    const response = await client.request({
      type: "remove_queue_item",
      request_id: client.nextRequestId("timeout-dequeue"),
      runtime: { agent_id: agentId, conversation_id: conversationId },
      item_id: removedQueueItemId,
    }, "remove_queue_item_response", 6_000)
    if (response.success !== true || response.item_id !== removedQueueItemId) {
      return { status: "uncertain" as const }
    }
  } else {
    return { status: "uncertain" as const }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const after = await inspect(scope)
    if (after.ok === true && after.status === "WAITING_ON_INPUT" &&
        Array.isArray(after.activeRunIds) && after.activeRunIds.length === 0 &&
        after.queueLength === 0) {
      return {
        status: "cancelled" as const,
        ...(ownedRunId ? { runId: ownedRunId } : {}),
        ...(removedQueueItemId ? { queueItemId: removedQueueItemId } : {}),
      }
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return { status: "uncertain" as const, runId: ownedRunId ?? null }
}

// Query the server-owned conversation status without starting a turn. The
// caller must treat missing state as unknown rather than "idle".
export async function workerInspect(input: WorkerInput) {
  const agentId = input.agentId?.trim()
  const conversationId = input.conversationId?.trim()
  if (!agentId || !conversationId) throw new Error("LETTA_INSPECT_SCOPE_REQUIRED")

  return withClient(async (client) => {
    const runtime = { agent_id: agentId, conversation_id: conversationId }
    let observed: Record<string, unknown> | null = null
    let queueLength: number | null = null
    let queuedMessages: Array<{ id: string; clientMessageId: string }> | null = null
    const remove = client.onMessage((message) => {
      if (message.type === "update_queue" && runtimeMatches(message, runtime) &&
          Array.isArray(message.queue)) {
        queueLength = message.queue.length
        queuedMessages = message.queue.flatMap((value: unknown) => {
          if (!value || typeof value !== "object") return []
          const item = value as Record<string, unknown>
          return typeof item.id === "string" &&
            typeof item.client_message_id === "string"
              ? [{ id: item.id, clientMessageId: item.client_message_id }]
              : []
        })
        return
      }
      if (message.type !== "update_loop_status" || !runtimeMatches(message, runtime)) return
      if (message.loop_status && typeof message.loop_status === "object") {
        observed = message.loop_status as Record<string, unknown>
      }
    })
    try {
      const response = await client.request({
        type: "sync",
        request_id: client.nextRequestId("inspect"),
        runtime,
        recover_approvals: false,
        resume_interrupted_turn: false,
      }, "sync_response", 10_000)
      requireSuccess(response, "LETTA_INSPECT_SYNC_FAILED")
      const snapshot = observed as Record<string, unknown> | null
      if (!snapshot || !Array.isArray(snapshot.active_run_ids) ||
          typeof snapshot.status !== "string") {
        throw new Error("LETTA_REMOTE_STATE_UNVERIFIED")
      }
      return {
        ok: true,
        engine: "letta",
        agentId,
        conversationId,
        status: snapshot.status,
        queueLength,
        queuedMessages,
        clientMessageIdsByRunId: snapshot.client_message_ids_by_run_id ?? {},
        activeRunIds: snapshot.active_run_ids.filter(
          (id: unknown): id is string => typeof id === "string" && id.length > 0,
        ),
      }
    } finally {
      remove()
    }
  })
}

async function workerProbe() {
  try {
    return await withClient(async (client) => {
      const info = await client.request(
        {
          type: "app_server_info",
          request_id: client.nextRequestId("info"),
        },
        "app_server_info_response",
      )
      const protocolVersion =
        typeof info.protocol_version === "number" ? info.protocol_version : null
      const protocolCompatible =
        protocolVersion === SUPPORTED_PROTOCOL_VERSION
      return {
        ok: info.success === true && protocolCompatible,
        available: true,
        engine: "letta",
        serverUrl: SERVER_URL,
        backend: info.backend ?? null,
        lettaCodeVersion: info.letta_code_version ?? info.version ?? null,
        protocolVersion,
        supportedProtocolVersion: SUPPORTED_PROTOCOL_VERSION,
        protocolCompatible,
        projectExecutorApiVersion: PROJECT_EXECUTOR_API_VERSION,
        shellPolicyVersion: SHELL_POLICY_VERSION,
        capabilities: info.capabilities ?? {},
        error: protocolCompatible
          ? null
          : `PROTOCOL_VERSION_UNSUPPORTED: expected ${SUPPORTED_PROTOCOL_VERSION}, got ${String(protocolVersion)}`,
      }
    })
  } catch (error) {
    return {
      ok: false,
      available: false,
      engine: "letta",
      serverUrl: SERVER_URL,
      backend: null,
      lettaCodeVersion: null,
      protocolVersion: null,
      supportedProtocolVersion: SUPPORTED_PROTOCOL_VERSION,
      protocolCompatible: false,
      projectExecutorApiVersion: PROJECT_EXECUTOR_API_VERSION,
      shellPolicyVersion: SHELL_POLICY_VERSION,
      capabilities: {},
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

const execFileAsync = promisify(execFile)

async function configureNewAgentModel(agentId: string) {
  const root = process.env.OPENCHATX_LETTA_SERVER_CWD?.trim()
  const model = process.env.OPENCHATX_LETTA_NEW_AGENT_MODEL?.trim()
  if (!root || !model || model.length > 128 || !/^[a-z0-9][a-z0-9./_-]+$/i.test(model)) {
    throw new Error("LETTA_NEW_AGENT_MODEL_CONFIG_INVALID")
  }
  const cli = join(root, "node_modules", "@letta-ai", "letta-code", "letta.js")
  const { stdout } = await execFileAsync(process.execPath, [
    cli, "model", "set", model, "--reasoning", "medium", "--agent", agentId,
  ], { cwd: root, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 })
  const response = JSON.parse(stdout)
  if (response.agent?.model !== model) {
    throw new Error("LETTA_NEW_AGENT_MODEL_NOT_APPLIED")
  }
}

async function ensureWorkerAgent(
  project: ProjectRecord,
  requestedAgentId?: string,
) {
  return withClient(async (client) => {
    if (requestedAgentId?.trim()) {
      const agentId = requestedAgentId.trim()
      const response = await client.request(
        {
          type: "agent_retrieve",
          request_id: client.nextRequestId("agent-retrieve"),
          agent_id: agentId,
        },
        "agent_retrieve_response",
      )
      requireSuccess(response, "LETTA_AGENT_RETRIEVE_FAILED")
      if (!response.agent) throw new Error("LETTA_AGENT_NOT_FOUND")
      return { agentId, modelConfiguration: describeModelConfiguration(response.agent) }
    }

    const response = await client.request(
      {
        type: "create_agent",
        request_id: client.nextRequestId("create-agent"),
        personality: "blank",
        tags: ["openchatx", "agent-runtime", `project:${project.id}`],
        pin_global: false,
      },
      "create_agent_response",
      TURN_TIMEOUT_MS,
    )
    requireSuccess(response, "LETTA_AGENT_CREATE_FAILED")
    if (typeof response.agent_id !== "string") {
      throw new Error("LETTA_AGENT_ID_MISSING")
    }
    await configureNewAgentModel(response.agent_id)
    const observed = await client.request({
      type: "agent_retrieve", request_id: client.nextRequestId("agent-model"),
      agent_id: response.agent_id,
    }, "agent_retrieve_response")
    requireSuccess(observed, "LETTA_AGENT_RETRIEVE_FAILED")
    if (!observed.agent) throw new Error("LETTA_AGENT_NOT_FOUND")
    return { agentId: response.agent_id, modelConfiguration: describeModelConfiguration(observed.agent) }
  })
}

async function workerRun(input: WorkerInput) {
  if (!input.projectId) throw new Error("PROJECT_ID_REQUIRED")
  if (!input.prompt?.trim()) throw new Error("PROMPT_REQUIRED")

  const project = await getProject(input.projectId)
  const sessionName = input.sessionName || "main"
  validateSessionName(sessionName)
  const { inspectDevelopmentContext } = await import("./development_gate.ts")
  const preflight = await prepareWorkerRunContext(project, input.prompt, inspectDevelopmentContext, input.taskRef, input.contextPaths)
  const { agentId, modelConfiguration } = await ensureWorkerAgent(project, input.agentId)
  const timestamp = now()
  const binding: ProjectBinding = {
    agentId,
    activeConversation: sessionName,
    conversations: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  let conversation: ConversationBinding
  if (input.conversationId?.trim()) {
    conversation = {
      name: sessionName,
      conversationId: input.conversationId.trim(),
      archived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    binding.conversations[sessionName] = conversation
  } else {
    conversation = await createConversation(project, binding, sessionName)
  }

  const result = await runTurn(
    project,
    binding,
    conversation,
    preflight.prompt,
    input.timeoutMs ?? TURN_TIMEOUT_MS,
    input.clientMessageId,
    input.modelSelection ?? planModelSelection(),
  )
  const traceSummary = summarizeRunTrace(
    result as unknown as Record<string, any>,
  )

  return {
    ok: true,
    engine: "letta",
    projectId: project.id,
    agentId,
    sessionName,
    conversationId: conversation.conversationId,
    sessionId: conversation.conversationId,
    state: "completed",
    assistantText: result.summary,
    outputTruncated: result.output_truncated,
    runId: result.run_id,
    modelConfiguration: result.modelConfiguration,
    modelSelection: result.modelSelection,
    usage: publicTokenUsage(result.usage),
    changed_files: traceSummary.changedFiles,
    validation: {
      ...traceSummary.validation,
      capability_evidence: preflight.evidence,
      development_preflight_receipt_id: null,
      capability_agent_tool_calls: {
        codebase: traceSummary.validation.tools_used.includes("openchatx_codebase_context"),
        ui_skills: traceSummary.validation.tools_used.includes("openchatx_ui_skill_load"),
      },
    },
    blockers: traceSummary.blockers,
    ...describeOperationOutcome({
      state: "completed", taskRef: input.taskRef, blockers: traceSummary.blockers,
      idempotency: traceSummary.validation.idempotency,
    }),
  }
}

async function workerCompact(input: WorkerInput) {
  if (!input.projectId) throw new Error("PROJECT_ID_REQUIRED")
  if (!input.agentId?.trim()) throw new Error("LETTA_AGENT_ID_REQUIRED")
  if (!input.conversationId?.trim()) {
    throw new Error("SESSION_NOT_STARTED")
  }

  await getProject(input.projectId)
  const response = await withClient(async (client) =>
    client.request(
      {
        type: "conversation_compact",
        request_id: client.nextRequestId("compact"),
        conversation_id: input.conversationId!.trim(),
        body: {
          agent_id: input.agentId!.trim(),
          compaction_settings: {
            mode: "all",
            clip_chars: 8000,
          },
        },
      },
      "conversation_compact_response",
      input.timeoutMs ?? TURN_TIMEOUT_MS,
    ),
  )
  requireSuccess(response, "LETTA_COMPACTION_FAILED")
  const compaction =
    response.compaction && typeof response.compaction === "object"
      ? (response.compaction as Record<string, unknown>)
      : {}
  const before =
    typeof compaction.num_messages_before === "number"
      ? compaction.num_messages_before
      : null
  const after =
    typeof compaction.num_messages_after === "number"
      ? compaction.num_messages_after
      : null

  return {
    ok: true,
    engine: "letta",
    projectId: input.projectId,
    agentId: input.agentId.trim(),
    conversationId: input.conversationId.trim(),
    sessionId: input.conversationId.trim(),
    compactAccepted: true,
    numMessagesBefore: before,
    numMessagesAfter: after,
    summary:
      before !== null && after !== null
        ? `Conversation compacted from ${before} messages to ${after}.`
        : "Conversation compacted successfully.",
  }
}

// Explicit cancel needs the exact input's client-message identity. Never
// infer ownership from whichever run happens to be active on the conversation.
async function workerCancel(input: WorkerInput) {
  if (!input.projectId) throw new Error("PROJECT_ID_REQUIRED")
  const project = await getProject(input.projectId)
  if (project.permissions?.read !== true) throw new Error("PROJECT_PERMISSION_DENIED: read")
  const agentId = input.agentId?.trim()
  const conversationId = input.conversationId?.trim()
  const clientMessageId = input.clientMessageId?.trim()
  if (!agentId || !conversationId || !clientMessageId) {
    throw new Error("LETTA_CANCEL_REMOTE_OWNERSHIP_UNVERIFIED")
  }
  const recovered = await withClient((client) => recoverTimedOutRun(
    client, { agent_id: agentId, conversation_id: conversationId }, clientMessageId,
  ))
  return {
    ok: recovered.status !== "uncertain",
    engine: "letta",
    projectId: project.id,
    status: recovered.status,
    runId: recovered.runId ?? null,
  }
}

// Recover a backend-only Run after a caller has verified the precise prior
// timed-out Operation and a later same-Conversation conflict. This worker does
// not choose an arbitrary active Run; the Runtime must supply the proven ID.
async function workerRecoverOrphan(input: WorkerInput) {
  if (!input.projectId) throw new Error("PROJECT_ID_REQUIRED")
  const project = await getProject(input.projectId)
  if (project.permissions?.read !== true) throw new Error("PROJECT_PERMISSION_DENIED: read")
  const agentId = input.agentId?.trim()
  const conversationId = input.conversationId?.trim()
  const runId = input.runId?.trim()
  if (!agentId || !conversationId || !/^local-run-\d+$/.test(runId ?? "")) {
    throw new Error("LETTA_ORPHAN_RECOVERY_SCOPE_INVALID")
  }

  const scope = { agentId, conversationId }
  const before = await workerInspect({ action: "inspect", ...scope })
  if (before.status !== "WAITING_ON_INPUT" ||
      before.activeRunIds.length !== 0 || before.queueLength !== 0) {
    throw new Error("LETTA_ORPHAN_RECOVERY_LISTENER_BUSY")
  }

  const response = await withClient((client) => client.request({
    type: "abort_message",
    request_id: client.nextRequestId("recover-backend-orphan"),
    runtime: { agent_id: agentId, conversation_id: conversationId },
    run_id: runId,
  }, "abort_message_response", 8_000))
  if (response.success !== true || response.aborted !== true) {
    throw new Error("LETTA_ORPHAN_RECOVERY_NOT_CONFIRMED")
  }

  const after = await workerInspect({ action: "inspect", ...scope })
  if (after.status !== "WAITING_ON_INPUT" ||
      after.activeRunIds.length !== 0 || after.queueLength !== 0) {
    throw new Error("LETTA_ORPHAN_RECOVERY_POSTCHECK_FAILED")
  }
  return {
    ok: true, engine: "letta", projectId: project.id,
    conversationId, runId, status: "cancelled",
  }
}

async function workerMain() {
  const inputPath = process.argv[2]
  if (!inputPath) throw new Error("WORKER_INPUT_PATH_REQUIRED")
  const input = JSON.parse(await fs.readFile(inputPath, "utf8")) as WorkerInput

  let result: unknown
  if (input.action === "probe") {
    result = await workerProbe()
  } else if (input.action === "inspect") {
    result = await workerInspect(input)
  } else if (input.action === "cancel") {
    result = await workerCancel(input)
  } else if (input.action === "recover-orphan") {
    result = await workerRecoverOrphan(input)
  } else if (input.action === "run") {
    result = await workerRun(input)
  } else if (input.action === "compact") {
    result = await workerCompact(input)
  } else {
    throw new Error(`WORKER_ACTION_UNSUPPORTED: ${String((input as any).action)}`)
  }

  process.stdout.write(JSON.stringify(result))
}

// OpenChatX may import toolbox modules while discovering tools. Only run the
// CLI worker when Node was explicitly launched with this file as its entrypoint.
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
const modulePath = fileURLToPath(import.meta.url)
const isEntrypoint =
  invokedPath !== null &&
  (process.platform === "win32"
    ? invokedPath.toLowerCase() === modulePath.toLowerCase()
    : invokedPath === modulePath)

if (isEntrypoint) {
  void withRuntimeActivity(dirname(dirname(modulePath)), workerMain).catch((error) => {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        engine: "letta",
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    process.exitCode = 1
  })
}
