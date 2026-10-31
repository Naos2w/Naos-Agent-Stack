// Observe bounded protocol envelopes while forwarding the original bytes unchanged.
// Never persist response bodies, error messages, request headers or auth subjects.
export const MAX_AUDIT_FRAME_BYTES = 64 * 1024;
export const MAX_AUDIT_RESPONSE_BYTES = 256 * 1024;

export function observeMcpResponse(response, auditRequest) {
    if (!response.body || !auditRequest?.hasPending()) return response;
    const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (type !== "application/json" && type !== "text/event-stream") return response;
    const decoder = new TextDecoder();
    let buffer = "", received = 0, disabled = false;
    const parse = text => {
        try { auditRequest.observeProtocolMessage(JSON.parse(text)); }
        catch { /* An unreadable envelope remains unverified, never successful. */ }
    };
    const feed = text => {
        buffer += text;
        if (type === "text/event-stream") {
            let match;
            while ((match = /\r?\n\r?\n/.exec(buffer))) {
                const frame = buffer.slice(0, match.index);
                buffer = buffer.slice(match.index + match[0].length);
                if (Buffer.byteLength(frame, "utf8") > MAX_AUDIT_FRAME_BYTES) {
                    disabled = true;
                    buffer = "";
                    return;
                }
                const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:"))
                    .map(line => line.slice(5).replace(/^ /, "")).join("\n");
                if (data) parse(data);
            }
        }
        if (Buffer.byteLength(buffer, "utf8") > MAX_AUDIT_FRAME_BYTES) {
            disabled = true;
            buffer = "";
        }
    };
    const body = response.body.pipeThrough(new TransformStream({
        transform(chunk, controller) {
            if (!disabled && auditRequest.hasPending()) {
                received += chunk.byteLength;
                if (received > MAX_AUDIT_RESPONSE_BYTES || chunk.byteLength > MAX_AUDIT_FRAME_BYTES) {
                    disabled = true;
                    buffer = "";
                } else {
                    try { feed(decoder.decode(chunk, { stream: true })); }
                    catch { disabled = true; buffer = ""; }
                }
            }
            controller.enqueue(chunk);
        },
        flush() {
            if (disabled) return;
            try {
                feed(decoder.decode());
                if (type === "application/json" && buffer) parse(buffer);
            } catch { /* Diagnostic observation must not change the response. */ }
        },
    }));
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

export function recordRemoteAuthFailure(auditLogger, payload, httpStatus, code) {
    if (!auditLogger) return;
    // Auth has failed: do not trust or store arguments or identity headers.
    const requests = (Array.isArray(payload) ? payload : [payload]).slice(0, 32)
        .filter(value => value?.method === "tools/call" && typeof value.params?.name === "string")
        .map(value => ({ jsonrpc: "2.0", id: value.id, method: "tools/call", params: {
            name: /^[A-Za-z0-9_.:/-]{1,128}$/.test(value.params.name) ? value.params.name : "invalid_tool_name",
            arguments: {},
        } }));
    try {
        auditLogger.startRequest(requests, { redactArguments: true }).finishTransport({
            httpStatus, state: "finished", observation: {
                phase: "remote_auth", outcome: "error", kind: "authentication", code, codeSource: "json_rpc",
            },
        });
    } catch { console.warn("Remote MCP authentication audit unavailable."); }
}
