// Read-only forensic evidence for an interrupted, original Letta Operation.
// Does not repair the registry, clear safeguards, execute tools or infer delivery.
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

const SIDE_EFFECTS = new Set(["openchatx_shell", "openchatx_write_file", "openchatx_memory_write"]);
const READ_ONLY = new Set(["openchatx_read_file", "openchatx_memory_read", "openchatx_ui_skill_load"]);
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const OP_ID = /^op_[a-f0-9]{16}$/;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stable(item)]));
  return value;
}
const sha = value => createHash("sha256").update(value).digest("hex");
const fail = code => ({ verified: false, reason: code, mayClearReconciliation: false });
const messageContent = message => Array.isArray(message?.content) ? message.content : [];

export function evaluateDurableTurnEvidence(operation, messages, ledgers, { historicalErrorFlagBugVerified = false } = {}) {
  if (!operation || operation.engine !== "letta" || operation.state !== "failed"
      || !OP_ID.test(operation.id) || !operation.projectId || !operation.sessionId)
    return fail("OPERATION_SCOPE_UNVERIFIED");
  const clientId = `openchatx-${operation.id}`;
  const settlement = operation.remoteSettlement;
  if (settlement?.schema !== 1 || settlement.source !== "explicit_cancel"
      || settlement.status !== "already_idle" || settlement.operationId !== operation.id
      || settlement.projectId !== operation.projectId
      || settlement.conversationId !== operation.sessionId
      || settlement.clientMessageId !== clientId
      || !Number.isFinite(Date.parse(settlement.observedAt)))
    return fail("REMOTE_IDLE_RECEIPT_UNVERIFIED");

  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 10000)
    return fail("TRANSCRIPT_INVALID");
  const userIndices = messages.flatMap((msg, i) =>
    msg?.role === "user" && msg.otid === clientId ? [i] : []);
  if (userIndices.length !== 1)
    return fail("ORIGINAL_INPUT_UNVERIFIED");
  const tail = messages.slice(userIndices[0] + 1);
  if (tail.some(msg => msg?.role === "user"))
    return fail("NEWER_REMOTE_INPUT_PRESENT");
  if (tail.some(msg => msg?.role === "assistant" && msg.stopReason === "stop"))
    return fail("OPERATION_TERMINAL_RESULT_PRESENT");

  const calls = new Map();
  const returns = new Map();
  for (const msg of tail) {
    if (msg?.role === "assistant") {
      for (const part of messageContent(msg)) {
        if (part?.type !== "toolCall") continue;
        if (typeof part.id !== "string" || !part.id || typeof part.name !== "string"
            || (!SIDE_EFFECTS.has(part.name) && !READ_ONLY.has(part.name))
            || calls.has(part.id)) return fail("TOOL_CALL_IDENTITY_UNVERIFIED");
        calls.set(part.id, { name: part.name, arguments: part.arguments });
      }
    } else if (msg?.role === "toolResult") {
      if (typeof msg.toolCallId !== "string" || !msg.toolCallId || returns.has(msg.toolCallId))
        return fail("TOOL_RETURN_IDENTITY_UNVERIFIED");
      returns.set(msg.toolCallId, msg);
    } else if (msg?.role !== "reasoning") {
      return fail("UNRECOGNISED_REMOTE_MESSAGE");
    }
  }
  if (calls.size !== returns.size || [...calls.keys()].some(key => !returns.has(key)))
    return fail("TOOL_CALLS_IN_FLIGHT");
  if ([...calls.entries()].some(([id, c]) => returns.get(id).toolName !== c.name))
    return fail("TOOL_RETURN_MISMATCH");
  const effects = [...calls].filter(([, call]) => SIDE_EFFECTS.has(call.name));
  if (!(ledgers instanceof Map) || ledgers.size !== effects.length)
    return fail("SIDE_EFFECT_LEDGER_COVERAGE_UNKNOWN");

  let persistedErrorFlagLoss = 0;
  for (const [id, call] of effects) {
    const record = ledgers.get(id);
    const input = typeof call.arguments === "string" ? (() => {
      try { return JSON.parse(call.arguments); } catch { return null; }
    })() : call.arguments;
    if (!input || typeof input !== "object" || Array.isArray(input) || !record
        || record.state !== "completed"
        || record.projectId !== operation.projectId || record.conversationId !== operation.sessionId
        || record.toolCallId !== id || record.toolName !== call.name
        || record.inputFingerprint !== sha(JSON.stringify(stable(input)))
        || !record.result || !Array.isArray(record.result.content))
      return fail("SIDE_EFFECT_LEDGER_MISMATCH");
    const reply = returns.get(id);
    if (!Array.isArray(reply.content) || reply.content.length < record.result.content.length
        || reply.content.length > record.result.content.length + 1)
      return fail("SIDE_EFFECT_CONTENT_UNVERIFIED");
    const offset = reply.content.length - record.result.content.length;
    if (offset && (reply.content[0]?.type !== "text"
        || typeof reply.content[0].text !== "string" || reply.content[0].text.length > 256))
      return fail("SIDE_EFFECT_UNEXPECTED_PREFIX");
    if (record.result.content.some((part, index) =>
        JSON.stringify(part) !== JSON.stringify(reply.content[offset + index])))
      return fail("SIDE_EFFECT_CONTENT_UNVERIFIED");
    const ledgerError = record.result.is_error === true;
    const transcriptError = reply.isError === true;
    if (ledgerError !== transcriptError) {
      if (!(historicalErrorFlagBugVerified && ledgerError && reply.isError === false))
        return fail("SIDE_EFFECT_OUTCOME_MISMATCH");
      persistedErrorFlagLoss += 1;
    }
  }

  return {
    verified: true,
    reason: "ORIGINAL_TOOL_EFFECTS_ACCOUNTED_FOR",
    operationId: operation.id,
    originalPromptResubmitted: false,
    remoteIdleObserved: true,
    toolCalls: calls.size,
    pairedResults: returns.size,
    completedDurableSideEffects: effects.length,
    historicalProviderErrorFlagLoss: persistedErrorFlagLoss,
    failedSideEffectReplies: effects.filter(([id]) => Boolean(ledgers.get(id)?.result?.is_error)).length,
    terminalAssistantReply: false,
    deliveryVerified: false,
    // Additional registry/backend reconciliation is intentionally required.
    mayClearReconciliation: false,
  };
}

async function readRegularFile(path, maxBytes = MAX_FILE_BYTES) {
  const s = await lstat(path);
  if (!s.isFile() || s.isSymbolicLink() || s.size > maxBytes) throw Error("FORENSIC_FILE_UNTRUSTED");
  return readFile(path, "utf8");
}

export async function inspectOriginalOperation({ operationId, runtimeRoot, backendRoot, historicalErrorFlagBugVerified = false }) {
  if (!OP_ID.test(operationId)) throw Error("FORENSIC_OPERATION_ID_INVALID");
  const operations = JSON.parse(await readRegularFile(join(runtimeRoot, "operations.json")));
  const operation = operations?.[operationId];
  if (!operation || operation.id !== operationId || !operation.projectId || !operation.sessionId)
    return fail("ORIGINAL_OPERATION_NOT_FOUND");
  const key = Buffer.from(`conversation:${operation.sessionId}`).toString("base64url");
  const path = join(backendRoot, "conversations", key, "messages.jsonl");
  const lines = (await readRegularFile(path)).split(/\r?\n/).filter(Boolean);
  if (lines.length > 10000) return fail("TRANSCRIPT_TOO_LARGE");
  const messages = lines.map(s => JSON.parse(s))
    .filter(entry => entry.type === "message")
    .map(entry => entry.message);
  const clientId = `openchatx-${operation.id}`;
  const start = messages.findIndex(m => m?.role === "user" && m.otid === clientId);
  if (start < 0) return fail("ORIGINAL_INPUT_UNVERIFIED");
  const toolCalls = messages.slice(start + 1)
    .filter(m => m?.role === "assistant")
    .flatMap(m => messageContent(m).filter(part => part?.type === "toolCall"));
  const effectCalls = toolCalls.filter(call => SIDE_EFFECTS.has(call?.name));
  if (effectCalls.length > 256) return fail("SIDE_EFFECT_LIMIT_EXCEEDED");

  const ledgers = new Map();
  for (const call of effectCalls) {
    if (typeof call.id !== "string") return fail("TOOL_CALL_IDENTITY_UNVERIFIED");
    const key = sha(JSON.stringify([operation.projectId, operation.sessionId, call.id]));
    const path = join(runtimeRoot, ".external-tool-ledger", key + ".json");
    try { ledgers.set(call.id, JSON.parse(await readRegularFile(path, 1024 * 1024))); }
    catch { return fail("SIDE_EFFECT_LEDGER_MISSING_OR_UNREADABLE"); }
  }
  return evaluateDurableTurnEvidence(operation, messages, ledgers, { historicalErrorFlagBugVerified });
}
