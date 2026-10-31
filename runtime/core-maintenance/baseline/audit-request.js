import { asRecord } from "../../utils.js";
export function createAuditRequest(payload, startToolCall, onToolList, { redactArguments = false } = {}) {
    const pending = [];
    for (const request of requestsFromPayload(payload)) {
        if (isToolListRequest(request)) {
            onToolList();
            continue;
        }
        const parsed = parseToolCall(request);
        if (!parsed)
            continue;
        pending.push({
            requestId: parsed.requestId,
            name: parsed.name,
            call: startToolCall(parsed.name, redactArguments ? {} : parsed.arguments, { requestId: parsed.requestId }),
            claimed: false,
        });
    }
    return {
        hasPending() { return pending.some(item => !item.claimed); },
        observeProtocolMessage(value) {
            for (const message of requestsFromPayload(value)) {
                const response = asRecord(message);
                if (response?.jsonrpc !== "2.0") continue;
                const error = asRecord(response.error);
                const result = asRecord(response.result);
                if (!error && !result) continue;
                for (const item of pending) {
                    if (item.claimed || item.requestId === undefined || item.requestId !== response.id) continue;
                    item.observation = error
                        ? { phase: "mcp_protocol", outcome: "error", kind: "protocol", code: error.code, codeSource: "json_rpc" }
                        : result.isError === true
                            ? { phase: "mcp_protocol", outcome: "error", kind: "tool", code: asRecord(result.structuredContent)?.error_code, codeSource: "structured_result" }
                            : { phase: "mcp_protocol", outcome: "success" };
                }
            }
        },
        claimTool(requestId, toolName) {
            const match = pending.find((item) => !item.claimed && item.requestId === requestId && item.name === toolName);
            if (!match)
                return;
            match.claimed = true;
            return match.call;
        },
        finishTransport({ httpStatus, state, observation }) {
            for (const item of pending) {
                if (item.claimed)
                    continue;
                item.claimed = true;
                // HTTP success alone is not evidence that a tool succeeded.
                item.call.finish({ httpStatus, state, observation: observation ?? item.observation ?? {
                    phase: "mcp_protocol", outcome: "unverified",
                } });
            }
        },
    };
}
function requestsFromPayload(payload) {
    return Array.isArray(payload) ? payload : [payload];
}
function parseToolCall(value) {
    const request = asRecord(value);
    if (!request)
        return undefined;
    if (request.method !== "tools/call")
        return undefined;
    const params = asRecord(request.params);
    const name = params?.name;
    if (typeof name !== "string" || !name)
        return undefined;
    const id = request.id;
    return {
        ...(typeof id === "string" || typeof id === "number" ? { requestId: id } : {}),
        name,
        arguments: params.arguments,
    };
}
function isToolListRequest(value) {
    return asRecord(value)?.method === "tools/list";
}
