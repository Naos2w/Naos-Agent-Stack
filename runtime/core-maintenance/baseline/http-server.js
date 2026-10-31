import { AsyncLocalStorage } from "node:async_hooks";
import { createServer } from "node:http";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { runWithAgent } from "../agent/context.js";
import { createDashboardRouter } from "../agent/dashboard-routes.js";
import { OpenChatXAuthError } from "../auth/store.js";
import { MCP_CONFIG } from "../config.js";
import { asRecord } from "../utils.js";
import { observeMcpResponse, recordRemoteAuthFailure } from "./audit/audit-response.js";
const MCP_ROUTE = /^\/mcp$/u;
export async function startMcpHttpServer(services, profileOverrides = {}) {
    const host = profileOverrides.host ?? MCP_CONFIG.host;
    const port = profileOverrides.port ?? MCP_CONFIG.port;
    const instanceId = profileOverrides.instanceId ?? MCP_CONFIG.instanceId;
    const { createMcpServer, auditLogger, authStore, agentObserver, toolboxRegistry, subagentRuntime, externalMcp, capabilityHealth, capabilityRegistry, capabilityStore, platformOverview, projectRegistry, summaryRegistry, contextBudget, } = services;
    const requestRuntime = new AsyncLocalStorage();
    const app = createMcpExpressApp({ host, jsonLimit: "10mb" });
    const mcpHandler = createMcpHandler(() => {
        const requestContext = requestRuntime.getStore();
        return createMcpServer({
            auditRequest: requestContext?.auditRequest,
            agentObserver,
        });
    }, {
        legacy: "stateless",
        onerror: reportMcpError,
    });
    const nodeMcpHandler = toNodeHandler({ fetch: async (...args) =>
        observeMcpResponse(await mcpHandler.fetch(...args), requestRuntime.getStore()?.auditRequest)
    }, { onerror: reportMcpError });
    app.get("/healthz", (_req, res) => {
        res.setHeader("x-openchatx-instance", instanceId);
        res.json({ ok: true });
    });
    if (agentObserver)
        app.use("/ui", createDashboardRouter(agentObserver, {
            toolboxRegistry,
            subagentRuntime,
            externalMcp,
            capabilityHealth,
            capabilityRegistry,
            capabilityStore,
            platformOverview,
            projectRegistry,
            summaryRegistry,
            contextBudget,
        }));
    const handleMcpRequest = async (req, res) => {
        const sessionId = requestSessionId(req);
        await runWithAgent(sessionId, async () => {
            const auditRequest = auditLogger?.startRequest(req.body);
            let auditFinished = false;
            const finishAudit = (state) => {
                if (auditFinished)
                    return;
                auditFinished = true;
                auditRequest?.finishTransport({ httpStatus: res.statusCode, state });
            };
            res.once("finish", () => finishAudit("finished"));
            res.once("close", () => finishAudit("closed"));
            await requestRuntime.run({ auditRequest }, () => nodeMcpHandler(req, res, req.body));
        });
    };
    app.all(MCP_ROUTE, async (req, res) => {
        if (req.method === "POST" &&
            authStore &&
            (req.get("x-openai-subject") || req.get("x-openchatx-remote") === "1") &&
            containsToolCall(req.body)) {
            try {
                await authStore.authorizeToolCall(req.get("x-openai-subject"));
            }
            catch (error) {
                remoteAuthError(res, error, auditLogger, req.body);
                return;
            }
        }
        await handleMcpRequest(req, res);
    });
    const httpServer = createServer(app);
    let boundPort;
    try {
        await listen(httpServer, port, host);
        const address = httpServer.address();
        if (!address || typeof address === "string") {
            throw new Error("HTTP server did not expose a TCP address.");
        }
        boundPort = address.port;
    }
    catch (error) {
        const httpClose = closeHttpServerIfListening(httpServer);
        await Promise.allSettled([mcpHandler.close(), httpClose]);
        throw error;
    }
    let closed = false;
    return {
        host,
        port: boundPort,
        url: `http://${host}:${boundPort}/mcp`,
        close: async () => {
            if (closed)
                return;
            closed = true;
            await Promise.allSettled([mcpHandler.close(), closeHttpServerIfListening(httpServer)]);
        },
    };
}
function containsToolCall(payload) {
    const requests = Array.isArray(payload) ? payload : [payload];
    return requests.some((value) => {
        const request = asRecord(value);
        if (request?.method !== "tools/call")
            return false;
        const params = asRecord(request.params);
        return typeof params?.name === "string" && params.name.length > 0;
    });
}
function requestSessionId(req) {
    const value = req.get("x-openai-session")?.trim();
    return value || undefined;
}
function reportMcpError(error) {
    console.error("MCP handler error:", error);
}
function remoteAuthError(res, error, auditLogger, payload) {
    if (error instanceof OpenChatXAuthError) {
        if (error.code === "subject_missing" || error.code === "subject_mismatch") {
            recordRemoteAuthFailure(auditLogger, payload, 403, -32002);
            jsonRpcError(res, 403, -32002, "Remote MCP access denied.");
            return;
        }
        recordRemoteAuthFailure(auditLogger, payload, 503, -32003);
        jsonRpcError(res, 503, -32003, "Remote MCP authentication is unavailable.");
        return;
    }
    console.error("Remote MCP authentication failed; details omitted from unauthenticated diagnostics.");
    recordRemoteAuthFailure(auditLogger, payload, 503, -32003);
    jsonRpcError(res, 503, -32003, "Remote MCP authentication is unavailable.");
}
function jsonRpcError(res, status, code, message) {
    res.status(status).json({
        jsonrpc: "2.0",
        error: { code, message },
        id: null,
    });
}
function listen(server, port, host) {
    return new Promise((resolve, reject) => {
        const onError = (error) => {
            server.off("listening", onListening);
            reject(error);
        };
        const onListening = () => {
            server.off("error", onError);
            resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
    });
}
function closeHttpServerIfListening(server) {
    return server.listening ? closeHttpServer(server) : Promise.resolve();
}
function closeHttpServer(server) {
    return new Promise((resolve, reject) => {
        server.close((error) => {
            if (error)
                reject(error);
            else
                resolve();
        });
    });
}
