import { modelFacingToolResultText } from "../../mcp/tool-output.js";
import { asRecord } from "../../utils.js";
const MAX_INLINE_ARGUMENT_CHARS = 600;
const MAX_COMMAND_CHARS = 2_000;
const MAX_FAILED_PATCH_CHARS = 32_000;
const MAX_FAILED_MESSAGE_CHARS = 1_000;
const SLOW_CALL_MS = 5_000;
export function formatAuditEntry(input) {
    const abnormal = input.httpStatus >= 400 || input.state !== "finished"
        ? ` - HTTP ${input.httpStatus} ${input.state}`
        : "";
    const tokenCounts = ` - ${input.inputTokens} in${input.outputTokens !== undefined ? ` / ${input.outputTokens} out` : ""}`;
    const tag = auditTag(input);
    const tagPrefix = tag ? `${tag} ` : "";
    const heading = `--- # ${tagPrefix}${input.toolName} - ${input.durationMs}ms${tokenCounts}${abnormal} - ${formatAuditTime(input.time)}`;
    const details = [
        formatAgentLabel(input.agentLabel),
        /^[a-f0-9]{16}$/.test(input.requestRef ?? "") ? `request_ref: ${input.requestRef}` : "",
        formatProtocolObservation(input.responseSummary),
        formatArguments(input.toolName, input.argumentsValue, input.toolFailed, input.failureMessage),
        formatFailureMetadata(input),
        formatResponseSummary(input.toolName, input.responseSummary),
    ]
        .filter(Boolean)
        .join("\n");
    return details ? `${heading}\n${details}\n\n` : `${heading}\n\n`;
}
export function summarizeToolResult(toolResult, modelResult, error, observation) {
    if (["remote_auth", "mcp_protocol"].includes(observation?.phase) &&
        ["success", "error", "unverified"].includes(observation?.outcome)) {
        return {
            failed: observation.outcome === "error",
            phase: observation.phase,
            outcome: observation.outcome,
            ...(["authentication", "protocol", "tool"].includes(observation.kind) ? { failureKind: observation.kind } : {}),
            ...(["json_rpc", "structured_result"].includes(observation.codeSource)
                ? failureCodeMetadata(observation.code, observation.codeSource) : {}),
        };
    }
    if (error !== undefined)
        return {
            failed: true,
            failureMessage: errorMessage(error),
            ...failureCodeMetadata(asRecord(error)?.code, "exception"),
        };
    const toolRecord = asRecord(toolResult);
    const modelRecord = asRecord(modelResult);
    const modelOutput = modelRecord ? modelFacingToolResultText(modelRecord) : undefined;
    if (!toolRecord)
        return { failed: false, modelOutput };
    const structuredContent = asRecord(toolRecord.structuredContent);
    if (toolRecord.isError !== true)
        return { failed: false, modelOutput, structuredContent };
    const resultOutput = structuredContent && typeof structuredContent.output === "string"
        ? structuredContent.output
        : undefined;
    const failureMetadata = failureCodeMetadata(structuredContent?.error_code, "structured_result");
    if (resultOutput)
        return { failed: true, failureMessage: resultOutput, modelOutput, structuredContent, ...failureMetadata };
    const content = toolRecord.content;
    if (Array.isArray(content)) {
        const message = content
            .map((item) => asRecord(item))
            .filter((item) => item !== undefined)
            .flatMap((item) => (item.type === "text" && typeof item.text === "string" ? [item.text] : []))
            .join("\n");
        if (message)
            return { failed: true, failureMessage: message, modelOutput, structuredContent, ...failureMetadata };
    }
    return { failed: true, modelOutput, structuredContent, ...failureMetadata };
}
function failureCodeMetadata(value, source) {
    // Record explicit machine codes only, never guess from error messages or
    // copy arbitrary exception bodies (which may contain credentials/paths).
    if ((typeof value === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(value)) ||
        (typeof value === "number" && Number.isSafeInteger(value))) {
        return { failureCode: value, failureCodeSource: source };
    }
    return {};
}
function formatFailureMetadata(input) {
    if (!input.toolFailed && input.httpStatus < 400 && input.state === "finished")
        return "";
    const summary = input.responseSummary;
    const source = summary.failureCodeSource;
    const metadata = source === "exception" || source === "structured_result" || source === "json_rpc"
        ? failureCodeMetadata(summary.failureCode, source)
        : {};
    return `failure: ${JSON.stringify({
        observed_at: "openchatx_mcp",
        kind: summary.failureKind ?? (input.toolFailed ? "tool" : "transport"),
        code: metadata.failureCode ?? null,
        code_source: metadata.failureCodeSource ?? "unavailable",
    })}`;
}
function formatProtocolObservation(summary) {
    if (!["remote_auth", "mcp_protocol"].includes(summary?.phase)) return "";
    return `observation: ${JSON.stringify({ phase: summary.phase, outcome: summary.outcome })}`;
}
export function formatAuditTime(date) {
    const hours = date.getHours();
    const hour = hours % 12 || 12;
    const meridiem = hours < 12 ? "AM" : "PM";
    return `${MONTH_NAMES[date.getMonth()]} ${date.getDate()} ${hour}:${twoDigits(date.getMinutes())} ${meridiem}`;
}
function characterCount(value) {
    return Array.from(value).length;
}
export function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function formatAgentLabel(agentLabel) {
    return agentLabel ? `session: ${yamlString(agentLabel)}` : "";
}
function auditTag(input) {
    if (input.toolFailed || input.httpStatus >= 400 || input.state !== "finished")
        return "!";
    if (input.responseSummary?.outcome === "unverified") return "?";
    if (input.durationMs >= SLOW_CALL_MS)
        return "~";
    return "";
}
function formatArguments(toolName, value, toolFailed, failureMessage) {
    const argumentsRecord = asRecord(value);
    if (!argumentsRecord)
        return formatGenericArguments(value);
    switch (toolName) {
        case "apply_patch":
            return formatApplyPatchArguments(argumentsRecord, toolFailed, failureMessage);
        case "file_write":
            return formatFileWriteArguments(argumentsRecord, toolFailed, failureMessage);
        case "summarize":
            return formatSummarizeArguments(argumentsRecord, toolFailed, failureMessage);
        case "bash":
            return formatBashArguments(argumentsRecord, toolFailed, failureMessage);
        default:
            return formatGenericArguments(value);
    }
}
function formatFileWriteArguments(argumentsRecord, toolFailed, failureMessage) {
    const fields = [
        typeof argumentsRecord.filePath === "string"
            ? `filePath: ${yamlString(argumentsRecord.filePath)}`
            : "",
        typeof argumentsRecord.content === "string"
            ? `content_chars: ${argumentsRecord.content.length}`
            : "",
    ].filter(Boolean);
    if (toolFailed && failureMessage)
        fields.push(`message: ${yamlString(truncate(failureMessage, MAX_FAILED_MESSAGE_CHARS))}`);
    return fields.join("\n");
}
function formatSummarizeArguments(argumentsRecord, toolFailed, failureMessage) {
    const fields = [
        typeof argumentsRecord.uuid === "string" ? `uuid: ${yamlString(argumentsRecord.uuid)}` : "",
        typeof argumentsRecord.summary === "string"
            ? `summary_chars: ${characterCount(argumentsRecord.summary)}`
            : "",
        typeof argumentsRecord.recent_context === "string"
            ? `recent_context_chars: ${characterCount(argumentsRecord.recent_context)}`
            : "",
    ].filter(Boolean);
    if (toolFailed && failureMessage)
        fields.push(`message: ${yamlString(truncate(failureMessage, MAX_FAILED_MESSAGE_CHARS))}`);
    return fields.join("\n");
}
function formatApplyPatchArguments(argumentsRecord, toolFailed, failureMessage) {
    const patch = typeof argumentsRecord.patch === "string" ? argumentsRecord.patch : "";
    const cwd = typeof argumentsRecord.cwd === "string" ? argumentsRecord.cwd : "";
    const summary = `cwd: ${yamlString(cwd)}\npatch_chars: ${characterCount(patch)}`;
    if (!toolFailed)
        return summary;
    const message = failureMessage
        ? `\nmessage: ${yamlString(truncate(failureMessage, MAX_FAILED_MESSAGE_CHARS))}`
        : "";
    return `${summary}${message}\npatch: |-\n${indentBlock(truncate(patch, MAX_FAILED_PATCH_CHARS))}`;
}
function formatBashArguments(argumentsRecord, toolFailed, failureMessage) {
    const command = typeof argumentsRecord.command === "string" ? argumentsRecord.command : "";
    const workdir = typeof argumentsRecord.workdir === "string"
        ? `workdir: ${yamlString(argumentsRecord.workdir)}`
        : "";
    const message = toolFailed && failureMessage
        ? `message: ${yamlString(truncate(failureMessage, MAX_FAILED_MESSAGE_CHARS))}`
        : "";
    const fields = [];
    if (workdir)
        fields.push(workdir);
    pushExplicitNumberArgument(fields, argumentsRecord, "timeout_ms");
    if (argumentsRecord.keep === true)
        fields.push("keep: true");
    pushExplicitNumberArgument(fields, argumentsRecord, "max_output_tokens");
    if (message)
        fields.push(message);
    if (command)
        fields.push(`command: |-\n${indentBlock(truncate(command, MAX_COMMAND_CHARS))}`);
    return fields.join("\n");
}
function pushExplicitNumberArgument(fields, argumentsRecord, key) {
    const value = argumentsRecord[key];
    if (Object.hasOwn(argumentsRecord, key) && typeof value === "number" && Number.isFinite(value))
        fields.push(`${key}: ${value}`);
}
function formatGenericArguments(value) {
    const serialized = JSON.stringify(value ?? {});
    if (characterCount(serialized) <= MAX_INLINE_ARGUMENT_CHARS)
        return `args: ${serialized}`;
    return `args: ${yamlString(truncate(serialized, MAX_INLINE_ARGUMENT_CHARS))}`;
}
function formatResponseSummary(toolName, summary) {
    const value = summary.structuredContent;
    if (!value)
        return "";
    if (toolName === "bash") {
        const parts = [
            typeof value.exit_code === "number" ? `exit_code=${value.exit_code}` : "",
            value.kept === true ? "kept=true" : "",
            typeof value.process_id === "string" ? `process_id=${yamlString(value.process_id)}` : "",
            typeof value.pid === "number" ? `pid=${value.pid}` : "",
            typeof value.log_path === "string" ? `log_path=${yamlString(value.log_path)}` : "",
            typeof value.cwd === "string" ? `cwd=${yamlString(value.cwd)}` : "",
            value.timed_out === true ? "timed_out=true" : "",
            value.output_truncated === true ? "output_truncated=true" : "",
        ].filter(Boolean);
        return parts.length ? `result: ${parts.join(" ")}` : "";
    }
    return toolName.startsWith("computer_") ? formatComputerResponseSummary(value) : "";
}
function formatComputerResponseSummary(value) {
    const parts = [
        typeof value.snapshot_id === "string" ? `snapshot_id=${yamlString(value.snapshot_id)}` : "",
        typeof value.application_name === "string" ? `app=${yamlString(value.application_name)}` : "",
        typeof value.window_title === "string" ? `window=${yamlString(value.window_title)}` : "",
        typeof value.is_dialog === "boolean" ? `dialog=${value.is_dialog}` : "",
        typeof value.capture_mode === "string" ? `capture_mode=${yamlString(value.capture_mode)}` : "",
        typeof value.element_count === "number" ? `elements=${value.element_count}` : "",
        typeof value.interactable_count === "number" ? `interactable=${value.interactable_count}` : "",
    ].filter(Boolean);
    return parts.length ? `result: ${parts.join(" ")}` : "";
}
function indentBlock(content) {
    return content
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n");
}
function yamlString(value) {
    return JSON.stringify(value);
}
function truncate(value, maxChars) {
    const characters = Array.from(value);
    if (characters.length <= maxChars)
        return value;
    const omitted = characters.length - maxChars;
    return `${characters.slice(0, maxChars).join("")}… [${omitted} chars omitted]`;
}
function twoDigits(value) {
    return String(value).padStart(2, "0");
}
const MONTH_NAMES = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
];
